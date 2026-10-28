import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Meal, MealImageAnalysis } from "../src/api/nutrition";
import { completeSetup } from "./helpers/setup";

// Auth, meals, binary uploads, metadata, queue and reads use the real in-memory
// E2E server. Its FixedImageAnalyzer returns local fixture foods, never a paid model.
// The two failure cases explicitly mock one HTTP 503 before the real service runs.
const date = "2099-11-11", otherDate = "2099-11-12";
const pixels = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const fakePhoto = (name: string) => ({ name, mimeType: "image/png", buffer: pixels });
type PhotoRole = "before" | "after" | "label" | "detail";

async function readMeals(page: Page, localDate = date): Promise<Meal[]> {
  const response = await page.request.get(`/api/v1/nutrition/meals?from=${localDate}&to=${localDate}`);
  expect(response.status()).toBe(200);
  return response.json();
}
async function readPhotos(page: Page, mealId: string): Promise<MealImageAnalysis[]> {
  const response = await page.request.get(`/api/v1/image-analyses?mealId=${mealId}`);
  expect(response.status()).toBe(200);
  return response.json();
}
async function showEvidence(card: Locator) {
  const evidence = card.locator(".photo-evidence");
  if (await evidence.getAttribute("open") === null)
    await evidence.getByText("补充餐前后、标签或细节照片", { exact: true }).click();
  await expect(evidence.getByLabel("这一餐的说明", { exact: true })).toBeVisible();
  return evidence;
}
async function fixture(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/register");
  await page.getByLabel("用户名").fill(`photoev_${randomUUID().replaceAll("-", "").slice(0, 20)}`);
  await page.getByLabel("密码", { exact: true }).fill("only local photo evidence test password");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await completeSetup(page);
  // Explicitly enable normal photo automation: evidence roles must still wait.
  const settingsResponse = await page.request.get("/api/v1/photo-analysis-settings");
  expect(settingsResponse.status()).toBe(200);
  const settings: { revision: number } = await settingsResponse.json();
  const enabled = await page.request.put("/api/v1/photo-analysis-settings", { data: { revision: settings.revision, automatic: true, consent: true } });
  expect(enabled.status()).toBe(200);
  const created = await page.request.post("/api/v1/nutrition/meals", { data: {
    occurredAt: `${date}T04:00:00.000Z`, localDate: date, timeZone: "UTC", name: "本地照片依据测试餐", note: null,
  } });
  expect(created.status()).toBe(201);
  const meal: Meal = await created.json();
  expect(meal.contributions).toEqual([]);
  await page.goto(`/nutrition?date=${date}`);
  const card = page.locator(`#meal-${meal.id}`);
  await card.getByRole("button", { name: "打开餐食", exact: true }).click();
  await card.getByRole("button", { name: "识别详情", exact: true }).click();
  return { meal, card, evidence: await showEvidence(card) };
}
async function upload(page: Page, evidence: Locator, mealId: string, role: PhotoRole, note: string) {
  await evidence.getByRole("combobox", { name: "照片用途", exact: true }).selectOption(role);
  await evidence.getByLabel("这一餐的说明", { exact: true }).fill(note);
  await evidence.getByLabel("从相册选择依据照片", { exact: true }).setInputFiles(fakePhoto(`${role}-local.png`));
  await expect(evidence.getByText(`${role}-local.png`, { exact: true })).toBeVisible();
  const responsePromise = page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === "POST" && url.pathname === "/api/v1/image-analyses" && url.searchParams.get("mealId") === mealId;
  });
  await evidence.getByRole("button", { name: "保存依据照片", exact: true }).click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(202);
  const photo: MealImageAnalysis = await response.json();
  expect(JSON.parse(decodeURIComponent(response.request().headers()["x-meal-photo-context"]!))).toEqual({ role, note: note.trim() || null, referenceAnalysisIds: [] });
  expect(photo).toMatchObject({ mealId, status: "waiting", candidate: null, imageAvailable: true, attempts: [], inputContext: { role, note: note.trim() || null, referenceAnalysisIds: [] } });
  await expect(evidence.getByRole("status")).toContainText("尚未调用模型，也未增加吃入记录");
  await expect(evidence.getByRole("combobox", { name: "主图", exact: true }).locator(`option[value="${photo.id}"]`)).toHaveCount(1);
  await expect(evidence.getByLabel("这一餐的说明", { exact: true })).toHaveValue("");
  return photo;
}
function submissions(page: Page) {
  const recorded: Array<{ path: string; body: unknown }> = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && /^\/api\/v1\/image-analyses\/[^/]+\/(retry|reanalyze)$/.test(path))
      recorded.push({ path, body: request.postDataJSON() });
  });
  return recorded;
}
async function changeDate(page: Page, localDate: string) {
  const control = page.getByLabel("查看日期", { exact: true });
  await control.fill(localDate);
  await control.dispatchEvent("change");
  await expect(page).toHaveURL(new RegExp(`date=${localDate}`));
  await expect(page.getByText("正在读取这一天…", { exact: true })).toHaveCount(0);
}
const consent = (evidence: Locator) => evidence.getByLabel("确认把主图、所选参考图和当前说明发给识别服务；可能产生费用。再次提交可能再次计费。", { exact: true });

test("before, after and label photos retain their notes and stay waiting even with automation enabled", async ({ page }, info) => {
  const { meal, evidence } = await fixture(page);
  const calls = submissions(page), before = await readMeals(page);
  const notes = { before: "  同一餐盒，餐前含盒 520g。  ", after: "餐后含盒 180g，骨头留在盒中。", label: "本地假包装标签，每100克，绝非真实营养依据。" };
  const photos = [];
  for (const role of ["before", "after", "label"] as const)
    photos.push(await upload(page, evidence, meal.id, role, notes[role]));
  const saved = await readPhotos(page, meal.id);
  expect(saved).toHaveLength(3);
  for (const photo of photos) {
    expect(saved.find(value => value.id === photo.id)).toMatchObject({ status: "waiting", candidate: null, attempts: [], inputContext: photo.inputContext });
    const original = await page.request.get(`/api/v1/image-analyses/${photo.id}/original`);
    expect(original.status()).toBe(200);
    expect(original.headers()["cache-control"]).toBe("private, no-store");
  }
  expect(await readMeals(page)).toEqual(before);
  expect(calls).toEqual([]);
  // Expand the complete controls at each supported width, without submitting.
  await evidence.getByRole("combobox", { name: "主图", exact: true }).selectOption(photos[0]!.id);
  await evidence.getByLabel(/^餐后剩余 · 参考图/).check();
  await evidence.getByLabel("这一餐的说明", { exact: true }).fill("同一餐的净重与剩余说明；长文本在窄屏中应保持可读。".repeat(8));
  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await evidence.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`photo-evidence-${width}.png`), fullPage: true, animations: "disabled" });
  }
  expect(await readMeals(page)).toEqual(before);
});

test("each explicitly confirmed analysis runs once, keeps intake unchanged and deduplicates the same photo after reanalysis", async ({ page }) => {
  const { meal, evidence } = await fixture(page);
  const calls = submissions(page), before = await readMeals(page);
  const after = await upload(page, evidence, meal.id, "after", "餐后照片的原说明");
  const label = await upload(page, evidence, meal.id, "label", "标签照片的原说明");
  // Use the latest photo as primary so the test cannot accidentally pass only
  // because an older primary is protected by the service's newer-photo guard.
  const primary = await upload(page, evidence, meal.id, "before", "餐前照片的原说明");
  const analyze = evidence.getByRole("button", { name: "结合所选依据分析", exact: true });
  await expect(analyze).toBeDisabled();
  await evidence.getByRole("combobox", { name: "主图", exact: true }).selectOption(primary.id);
  await evidence.getByLabel(/^餐后剩余 · 参考图/).check();
  await evidence.getByLabel(/^包装标签 · 参考图/).check();
  await evidence.getByLabel("这一餐的说明", { exact: true }).fill("  本次说明：只计算这一餐，餐前520g，餐后180g。  ");
  await expect(analyze).toBeDisabled();
  await consent(evidence).check();
  await expect(analyze).toBeEnabled();
  // Changing a reference invalidates the previous consent before any request.
  await evidence.getByLabel(/^包装标签 · 参考图/).uncheck();
  await expect(consent(evidence)).not.toBeChecked();
  await expect(analyze).toBeDisabled();
  await evidence.getByLabel(/^包装标签 · 参考图/).check();
  expect(calls).toEqual([]);
  await consent(evidence).check();
  const responsePromise = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/v1/image-analyses/${primary.id}/retry`);
  await analyze.click();
  expect((await responsePromise).status()).toBe(202);
  await expect(evidence.getByRole("status")).toContainText("请在识别结果中核对后采用");
  await expect.poll(async () => (await readPhotos(page, meal.id)).find(photo => photo.id === primary.id)?.status).toBe("succeeded");
  const saved = (await readPhotos(page, meal.id)).find(photo => photo.id === primary.id)!;
  expect(saved.attempts).toHaveLength(1);
  expect(saved.candidate?.foods?.map(food => food.label)).toEqual(["米饭", "鸡腿"]);
  expect(saved.inputContext).toMatchObject({ role: "before", note: "本次说明：只计算这一餐，餐前520g，餐后180g。" });
  expect([...saved.inputContext!.referenceAnalysisIds].sort()).toEqual([after.id, label.id].sort());
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ path: `/api/v1/image-analyses/${primary.id}/retry`, body: { revision: primary.revision, consent: true, inputContext: { role: "before", note: saved.inputContext!.note } } });
  expect(await readMeals(page)).toEqual(before);
  const untouched = (await readPhotos(page, meal.id)).filter(photo => photo.id !== primary.id);
  expect(untouched.every(photo => photo.status === "waiting" && photo.attempts.length === 0)).toBe(true);
  await expect(evidence.getByRole("combobox", { name: "主图", exact: true })).toHaveValue("");
  await expect(consent(evidence)).not.toBeChecked();
  await expect(analyze).toBeDisabled();

  const main = evidence.getByRole("combobox", { name: "主图", exact: true });
  await expect(main.locator("option")).toHaveCount(4); // Blank plus three original photos.
  await main.selectOption(primary.id);
  await evidence.getByLabel(/^餐后剩余 · 参考图/).check();
  await evidence.getByLabel("这一餐的说明", { exact: true }).fill("再次明确提交：同一餐前原图，只搭配餐后参考图。");
  await expect(consent(evidence)).not.toBeChecked();
  await expect(analyze).toBeDisabled();
  await consent(evidence).check();
  await expect(analyze).toBeEnabled();
  const secondResponsePromise = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/v1/image-analyses/${primary.id}/reanalyze`);
  await analyze.click();
  const secondResponse = await secondResponsePromise;
  expect(secondResponse.status()).toBe(202);
  const reanalysis: MealImageAnalysis = await secondResponse.json();
  expect(reanalysis.id).not.toBe(primary.id);
  expect(saved.photoId).toBeTruthy();
  expect(reanalysis.photoId).toBe(saved.photoId);
  await expect.poll(async () => (await readPhotos(page, meal.id)).find(photo => photo.id === reanalysis.id)?.status).toBe("succeeded");
  const all = await readPhotos(page, meal.id);
  expect(all).toHaveLength(4);
  const samePhoto = all.filter(photo => photo.photoId === saved.photoId);
  expect(samePhoto.map(photo => photo.id).sort()).toEqual([primary.id, reanalysis.id].sort());
  expect(samePhoto.every(photo => photo.attempts.length === 1)).toBe(true);
  expect(new Set(all.map(photo => photo.photoId)).size).toBe(3);
  expect(all.find(photo => photo.id === reanalysis.id)?.inputContext).toEqual({ role: "before", note: "再次明确提交：同一餐前原图，只搭配餐后参考图。", referenceAnalysisIds: [after.id] });
  expect(calls).toHaveLength(2);
  expect(calls[1]).toMatchObject({ path: `/api/v1/image-analyses/${primary.id}/reanalyze`, body: { consent: true, inputContext: { role: "before", referenceAnalysisIds: [after.id] } } });
  expect(await readMeals(page)).toEqual(before);
  // A second analysis of one saved image must not become another photo option,
  // or let either analysis of that image appear as its own reference image.
  await expect(main.locator(`option[value="${reanalysis.id}"]`)).toHaveCount(1);
  await expect(main.locator("option")).toHaveCount(4);
  await expect(main.locator(`option[value="${primary.id}"]`)).toHaveCount(0);
  await main.selectOption(reanalysis.id);
  const referenceInputs = evidence.locator('.reference-choices input[type="checkbox"]');
  await expect(referenceInputs).toHaveCount(2);
  const referenceIds = await referenceInputs.evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value));
  expect(referenceIds.sort()).toEqual([after.id, label.id].sort());
  expect(referenceIds.every(id => all.find(photo => photo.id === id)?.photoId !== saved.photoId)).toBe(true);
  await expect(consent(evidence)).not.toBeChecked();
  await expect(analyze).toBeDisabled();
});

test("picker cancellation and a mocked upload failure keep the role, note and file across dates until an explicit retry", async ({ page }) => {
  const { meal, card, evidence } = await fixture(page);
  const before = await readMeals(page), calls = submissions(page);
  let chooserPromise = page.waitForEvent("filechooser");
  await evidence.getByRole("button", { name: "从相册选择", exact: true }).click();
  await (await chooserPromise).setFiles([]);
  await expect(evidence.getByRole("button", { name: "保存依据照片", exact: true })).toBeDisabled();
  expect(await readPhotos(page, meal.id)).toEqual([]);
  await evidence.getByRole("combobox", { name: "照片用途", exact: true }).selectOption("after");
  await evidence.getByLabel("这一餐的说明", { exact: true }).fill("需保留：同一只盒子，餐后180g，未减容器重量。");
  await evidence.getByLabel("从相册选择依据照片", { exact: true }).setInputFiles(fakePhoto("retained-after.png"));
  chooserPromise = page.waitForEvent("filechooser");
  await evidence.getByRole("button", { name: "从相册选择", exact: true }).click();
  await (await chooserPromise).setFiles([]);
  await expect(evidence.getByText("retained-after.png", { exact: true })).toBeVisible();
  let uploadRequests = 0;
  await page.route("**/api/v1/image-analyses?**", async route => {
    if (route.request().method() === "POST" && new URL(route.request().url()).searchParams.get("mealId") === meal.id && ++uploadRequests === 1)
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "mock_upload_unavailable", message: "local mocked upload failure" }) });
    else await route.continue();
  });
  await evidence.getByRole("button", { name: "保存依据照片", exact: true }).click();
  await expect(evidence.getByRole("alert")).toBeVisible();
  await expect(evidence.getByRole("combobox", { name: "照片用途", exact: true })).toHaveValue("after");
  await expect(evidence.getByLabel("这一餐的说明", { exact: true })).toHaveValue("需保留：同一只盒子，餐后180g，未减容器重量。");
  await expect(evidence.getByText("retained-after.png", { exact: true })).toBeVisible();
  expect(await readPhotos(page, meal.id)).toEqual([]);
  expect(await readMeals(page)).toEqual(before);
  await changeDate(page, otherDate);
  const retained = page.getByRole("region", { name: "未保存的照片依据：本地照片依据测试餐", exact: true });
  await expect(retained).toContainText("retained-after.png");
  await expect(retained).toContainText("餐后剩余");
  await expect(retained).toContainText("需保留：同一只盒子，餐后180g，未减容器重量。");
  expect(await readMeals(page, otherDate)).toEqual([]);
  await retained.getByRole("button", { name: `返回 ${date} 继续`, exact: true }).click();
  await expect(page.getByLabel("查看日期", { exact: true })).toHaveValue(date);
  const reopened = await showEvidence(card);
  await expect(reopened.getByRole("combobox", { name: "照片用途", exact: true })).toHaveValue("after");
  await expect(reopened.getByText("retained-after.png", { exact: true })).toBeVisible();
  await reopened.getByRole("button", { name: "保存依据照片", exact: true }).click();
  await expect(reopened.getByRole("status")).toContainText("尚未调用模型，也未增加吃入记录");
  expect(uploadRequests).toBe(2);
  const photos = await readPhotos(page, meal.id);
  expect(photos).toHaveLength(1);
  expect(photos[0]).toMatchObject({ status: "waiting", attempts: [], inputContext: { role: "after", note: "需保留：同一只盒子，餐后180g，未减容器重量。" } });
  await reopened.getByRole("combobox", { name: "照片用途", exact: true }).selectOption("detail");
  await reopened.getByLabel("这一餐的说明", { exact: true }).fill("用户明确放弃的下一张草稿");
  await reopened.getByLabel("从相册选择依据照片", { exact: true }).setInputFiles(fakePhoto("discarded-detail.png"));
  await reopened.getByRole("button", { name: "放弃这份依据草稿", exact: true }).click();
  await expect(reopened.getByLabel("这一餐的说明", { exact: true })).toHaveValue("");
  await expect(reopened.getByText("discarded-detail.png", { exact: true })).toHaveCount(0);
  await expect(reopened.getByRole("button", { name: "保存依据照片", exact: true })).toBeDisabled();
  expect(await readPhotos(page, meal.id)).toEqual(photos);
  expect(await readMeals(page)).toEqual(before);
  expect(calls).toEqual([]);
});

test("a mocked analysis submission failure retains the selected group across dates and consent can be cancelled", async ({ page }) => {
  const { meal, card, evidence } = await fixture(page);
  const after = await upload(page, evidence, meal.id, "after", "餐后依据");
  const primary = await upload(page, evidence, meal.id, "before", "餐前依据");
  const calls = submissions(page), before = await readMeals(page);
  await evidence.getByRole("combobox", { name: "主图", exact: true }).selectOption(primary.id);
  await evidence.getByLabel(/^餐后剩余 · 参考图/).check();
  await evidence.getByLabel("这一餐的说明", { exact: true }).fill("这组还未发出，失败后保留。");
  await consent(evidence).check();
  // Mock failure at the transport boundary: no queued model attempt is created.
  await page.route(`**/api/v1/image-analyses/${primary.id}/retry`, route => route.fulfill({
    status: 503, contentType: "application/json", body: JSON.stringify({ code: "mock_submit_unavailable", message: "local mocked submission failure" }),
  }), { times: 1 });
  await evidence.getByRole("button", { name: "结合所选依据分析", exact: true }).click();
  await expect(evidence.getByRole("alert")).toBeVisible();
  await expect(evidence.getByRole("combobox", { name: "主图", exact: true })).toHaveValue(primary.id);
  await expect(evidence.getByLabel(/^餐后剩余 · 参考图/)).toBeChecked();
  await expect(consent(evidence)).toBeChecked();
  expect(calls).toHaveLength(1);
  expect((await readPhotos(page, meal.id)).every(photo => photo.status === "waiting" && photo.attempts.length === 0)).toBe(true);
  await changeDate(page, otherDate);
  const retained = page.getByRole("region", { name: "未保存的照片依据：本地照片依据测试餐", exact: true });
  await expect(retained).toContainText("这组还未发出，失败后保留。");
  await expect(retained.locator("dl > div").filter({ has: page.getByText("同餐参考图", { exact: true }) }).locator("dd")).toHaveText("1 张");
  await retained.getByRole("button", { name: `返回 ${date} 继续`, exact: true }).click();
  const reopened = await showEvidence(card);
  await expect(reopened.getByRole("combobox", { name: "主图", exact: true })).toHaveValue(primary.id);
  await expect(reopened.getByLabel(/^餐后剩余 · 参考图/)).toBeChecked();
  await expect(reopened.getByLabel("这一餐的说明", { exact: true })).toHaveValue("这组还未发出，失败后保留。");
  await consent(reopened).uncheck();
  await expect(reopened.getByRole("button", { name: "结合所选依据分析", exact: true })).toBeDisabled();
  await reopened.getByRole("button", { name: "放弃这份依据草稿", exact: true }).click();
  await expect(reopened.getByRole("combobox", { name: "主图", exact: true })).toHaveValue("");
  await expect(consent(reopened)).not.toBeChecked();
  expect(calls).toHaveLength(1);
  const photos = await readPhotos(page, meal.id);
  expect(photos.map(photo => photo.id).sort()).toEqual([primary.id, after.id].sort());
  expect(photos.every(photo => photo.status === "waiting" && photo.attempts.length === 0)).toBe(true);
  expect(await readMeals(page)).toEqual(before);
  expect(await readMeals(page, otherDate)).toEqual([]);
});
