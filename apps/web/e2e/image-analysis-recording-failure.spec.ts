import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type { MealImageAnalysis } from "../src/api/nutrition";
import { completeSetup } from "./helpers/setup";

const fakePhoto = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const ordinaryConfirmation = "将这张照片发送给识别服务，估算食物与营养。已有食物和修正不会自动覆盖，是否继续？";
const recordingConfirmation = "识别服务可能已处理这次请求，重新分析可能再次计费，是否继续？";

async function failedPhoto(page: Page, code: string, imageAvailable = true) {
  await page.goto("/register");
  await page.getByLabel("用户名").fill(`billing_${randomUUID().replaceAll("-", "").slice(0, 20)}`);
  await page.getByLabel("密码", { exact: true }).fill("only fake local billing password");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await completeSetup(page);
  const date = await page.evaluate(() => new Date().toLocaleDateString("en-CA"));
  const mealResponse = await page.request.post("/api/v1/nutrition/meals", { data: {
    localDate: date, occurredAt: new Date().toISOString(), timeZone: "Asia/Shanghai", name: "本地测试餐食", note: null,
  } });
  expect(mealResponse.ok()).toBe(true);
  const meal = await mealResponse.json();
  expect((await page.request.post(`/api/v1/nutrition/meals/${meal.id}/contributions`, { data: {
    mealRevision: meal.revision, replaceExisting: false, mode: "item", label: "已保存食物", portionAmount: 1, portionUnit: "份",
    basisDescription: "local fake fixture", energyKcal: null, proteinGrams: null, carbohydrateGrams: null, fatGrams: null,
  } })).ok()).toBe(true);

  let analysis: MealImageAnalysis = {
    id: randomUUID(), mealId: meal.id, status: "failed", model: "fake-test-model", promptVersion: "fake-test-prompt",
    candidate: null, lastErrorCode: code, imageAvailable, adoptedAt: null, revision: 1, attempts: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  let retryRequests = 0;
  // The fixture represents a completed local failure; no model or queue is used.
  await page.route("**/api/v1/image-analyses?*", async route => {
    if (new URL(route.request().url()).searchParams.get("mealId") !== meal.id) { await route.continue(); return; }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([analysis]) });
  });
  await page.route(`**/api/v1/image-analyses/${analysis.id}/original`, route => route.fulfill({ status: 200, contentType: "image/png", body: fakePhoto }));
  await page.route(`**/api/v1/image-analyses/${analysis.id}/retry`, async route => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ revision: 1, consent: true });
    retryRequests++;
    analysis = { ...analysis, status: "pending", lastErrorCode: null, revision: 2 };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(analysis) });
  });
  await page.goto(`/nutrition?date=${date}&mealId=${meal.id}`);
  const card = page.locator(".meal-card").filter({ visible: true });
  await card.getByRole("button", { name: "识别详情", exact: true }).click();
  const failure = card.locator(".analysis-failure");
  await expect(failure).toBeVisible();
  return { card, failure, retryRequests: () => retryRequests, date, mealId: meal.id };
}

for (const scenario of [
  { code: "deepseek_call_recording_failed", message: "识别服务可能已处理请求", confirmation: recordingConfirmation },
  { code: "deepseek_call_preparation_failed", message: "本次准备的请求未发送给识别服务", confirmation: ordinaryConfirmation },
] as const) {
  test(`${scenario.code} explains the request stage and sends a manual retry only after consent`, async ({ page }) => {
    const fixture = await failedPhoto(page, scenario.code);
    await expect(fixture.failure).toContainText(scenario.message);
    await expect(fixture.failure).toContainText("原图仍在，已有食物未改动");
    await expect(fixture.failure).not.toContainText("已计费");
    if (scenario.code === "deepseek_call_preparation_failed") await expect(fixture.failure).not.toContainText("可能已处理请求");
    const dialogs: string[] = [];
    page.once("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
    await fixture.failure.getByRole("button", { name: "重新分析", exact: true }).click();
    expect(dialogs).toEqual([scenario.confirmation]);
    expect(fixture.retryRequests()).toBe(0);
    await expect(fixture.failure.getByRole("button", { name: "重新分析", exact: true })).toBeVisible();
    page.once("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
    await fixture.failure.getByRole("button", { name: "重新分析", exact: true }).click();
    await expect(page.getByText("已提交识别，可以离开页面稍后查看", { exact: true })).toBeVisible();
    expect(dialogs).toEqual([scenario.confirmation, scenario.confirmation]);
    expect(fixture.retryRequests()).toBe(1);
    await expect(fixture.card.locator(".meal-items")).toContainText("已保存食物");
    const meals = await (await page.request.get(`/api/v1/nutrition/meals?from=${fixture.date}&to=${fixture.date}`)).json();
    expect(meals.find((meal: { id: string }) => meal.id === fixture.mealId).contributions).toHaveLength(1);
  });
}

test("a recording failure with a deleted original preserves its explanation without offering a retry", async ({ page }) => {
  const fixture = await failedPhoto(page, "deepseek_call_recording_failed", false);
  await expect(fixture.failure).toContainText("识别服务可能已处理请求");
  await expect(fixture.failure).toContainText("已有食物记录仍保留");
  await expect(fixture.failure).not.toContainText("原图仍在");
  await expect(fixture.failure.getByRole("button", { name: "重新分析", exact: true })).toHaveCount(0);
  expect(fixture.retryRequests()).toBe(0);
});
