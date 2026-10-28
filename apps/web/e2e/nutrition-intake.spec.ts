import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Meal } from "../src/api/nutrition";
import { completeSetup } from "./helpers/setup";

const date = "2099-11-01", otherDate = "2099-11-02";

async function register(page: Page) {
  await page.getByLabel("用户名").fill(`intake_${randomUUID().replaceAll("-", "").slice(0, 20)}`);
  await page.getByLabel("密码", { exact: true }).fill("only fake local intake password");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await completeSetup(page);
}
async function navigate(page: Page, name: "饮食" | "历史" | "我的") {
  await page.locator(".mobile-dock, .desktop-rail").getByRole("button", { name: new RegExp(`^${name}`) }).filter({ visible: true }).click();
}
async function readMeals(page: Page): Promise<Meal[]> {
  const result = await page.request.get(`/api/v1/nutrition/meals?from=${date}&to=${date}`);
  expect(result.status()).toBe(200); return result.json();
}
async function fixture(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/register"); await register(page);
  const created = await page.request.post("/api/v1/nutrition/meals", { data: { localDate: date, occurredAt: `${date}T04:00:00Z`, timeZone: "UTC", name: "本地假餐食", note: null } });
  expect(created.status()).toBe(201);
  let meal: Meal = await created.json();
  for (const item of [
    { label: "测试米饭", portionAmount: 100, portionUnit: "g", energyKcal: 200, proteinGrams: 10, carbohydrateGrams: 30, fatGrams: null },
    { label: "测试鸡腿", portionAmount: 1, portionUnit: "个", energyKcal: 150, proteinGrams: 15, carbohydrateGrams: null, fatGrams: 0 },
  ]) {
    const added = await page.request.post(`/api/v1/nutrition/meals/${meal.id}/contributions`, { data: { ...item, mode: "item", basisDescription: "本地假食物基准", mealRevision: meal.revision, replaceExisting: false } });
    expect(added.status()).toBe(201); meal = await added.json();
  }
  await page.goto(`/nutrition?date=${date}`);
  await page.locator(`#meal-${meal.id}`).getByRole("button", { name: "打开餐食", exact: true }).click();
  const rice = meal.contributions.find(item => item.label === "测试米饭")!;
  const chicken = meal.contributions.find(item => item.label === "测试鸡腿")!;
  return { meal, rice, chicken };
}
async function editor(page: Page, id: string, label: string) {
  await page.locator(`#meal-food-${id}`).getByRole("button", { name: `记录吃入量：${label}`, exact: true }).click();
  return page.getByRole("form", { name: `记录吃入量：${label}`, exact: true });
}
async function preview(form: Locator) {
  await form.getByRole("button", { name: "预览计算", exact: true }).click();
  await expect(form.locator(".intake-calculation")).toBeVisible();
}
async function changeDate(page: Page, value: string) {
  await page.getByLabel("查看日期", { exact: true }).fill(value);
  await page.getByLabel("查看日期", { exact: true }).dispatchEvent("change");
  await expect(page.getByText("正在读取这一天…", { exact: true })).toHaveCount(0);
}

test("gross/tare and eaten fraction preview without writing, then save only the original food with readable formulas", async ({ page }, info) => {
  const { meal, rice, chicken } = await fixture(page);
  const form = await editor(page, rice.id, rice.label);
  await form.getByRole("combobox", { name: "份量依据", exact: true }).selectOption("gross_tare");
  await form.getByLabel("含盒重量 g", { exact: true }).fill("350");
  await form.getByLabel("容器重量 g", { exact: true }).fill("50");
  await form.getByText("只吃了部分或有其他说明", { exact: true }).click();
  await form.getByLabel("这份实际吃入 %", { exact: true }).fill("50");
  const before = await readMeals(page);
  await preview(form);
  await expect(form.locator(".intake-calculation__total")).toContainText("150 g");
  await expect(form.locator(".intake-nutrients")).toContainText("300 kcal");
  expect(await readMeals(page)).toEqual(before);
  await form.getByText("怎么算的", { exact: true }).click();
  await expect(form.locator(".intake-equations")).toContainText("350 − 50 − 0 = 300 g");
  await expect(form.locator(".intake-equations")).toContainText("300 × 0.5 = 150 g");
  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 375, height: 900 });
  await page.screenshot({ path: info.outputPath("intake-weight-preview-375.png"), fullPage: true });
  await form.getByRole("button", { name: "保存吃入量", exact: true }).click();
  await expect(form).toHaveCount(0);
  const saved = (await readMeals(page)).find(value => value.id === meal.id)!;
  expect(saved.contributions.find(value => value.id === rice.id)).toMatchObject({ portionAmount: 150, energyKcal: 300, fatGrams: null, intakeEvidence: { quantitySource: "measured", input: { quantity: { kind: "gross_tare", grossGrams: 350, tareGrams: 50, fraction: .5 } } } });
  expect(saved.contributions.find(value => value.id === chicken.id)).toEqual(chicken);
  await page.reload();
  await page.locator(`#meal-${meal.id}`).getByRole("button", { name: "打开餐食", exact: true }).click();
  await page.locator(`#meal-food-${rice.id}`).getByText("查看计算依据", { exact: true }).click();
  await expect(page.locator(`#meal-food-${rice.id} .saved-intake-calculation`)).toContainText("150 g");
  const reopened = await editor(page, rice.id, rice.label);
  await expect(reopened.getByLabel("含盒重量 g", { exact: true })).toHaveValue("350");
  await expect(reopened.getByLabel("容器重量 g", { exact: true })).toHaveValue("50");
});

test("a count basis cannot invent grams; a per-100g kJ label keeps unknown nutrients distinct from zero", async ({ page }) => {
  const { chicken } = await fixture(page);
  const form = await editor(page, chicken.id, chicken.label);
  await form.getByRole("combobox", { name: "份量依据", exact: true }).selectOption("net_weight");
  await form.getByLabel("食物净重 g", { exact: true }).fill("200");
  const before = await readMeals(page);
  await form.getByRole("button", { name: "预览计算", exact: true }).click();
  await expect(form.getByRole("alert")).toBeVisible();
  await expect(form.getByLabel("食物净重 g", { exact: true })).toHaveValue("200");
  await expect(form.getByRole("button", { name: "保存吃入量", exact: true })).toBeDisabled();
  expect(await readMeals(page)).toEqual(before);
  await form.getByRole("combobox", { name: "营养依据", exact: true }).selectOption("label");
  await form.getByLabel("标签能量", { exact: true }).fill("836.8");
  await form.getByRole("combobox", { name: "能量单位", exact: true }).selectOption("kJ");
  await form.getByLabel("标签来源", { exact: true }).fill("本地假包装，每100克");
  await form.getByText("标签三项营养（可选）", { exact: true }).click();
  await form.getByLabel("标签碳水 g", { exact: true }).fill("0");
  await preview(form);
  await expect(form.locator(".intake-nutrients")).toContainText("400 kcal");
  await expect(form.locator(".intake-nutrients")).toContainText("蛋白质未知");
  await expect(form.locator(".intake-nutrients")).toContainText("碳水0 g");
  await form.getByText("怎么算的", { exact: true }).click();
  await expect(form.locator(".intake-equations")).toContainText("836.8 ÷ 4.184 = 200 kcal");
  await form.getByRole("button", { name: "保存吃入量", exact: true }).click();
  await expect(form).toHaveCount(0);
  const saved = (await readMeals(page))[0]!.contributions.find(value => value.id === chicken.id)!;
  expect(saved).toMatchObject({ portionAmount: 200, portionUnit: "g", energyKcal: 400, proteinGrams: null, carbohydrateGrams: 0, fatGrams: null });
});

test("multiple drafts survive dates, request failure and revision conflict; rereading keeps zero input and releases busy after leaving", async ({ page }) => {
  const { meal, rice, chicken } = await fixture(page);
  const form = await editor(page, rice.id, rice.label);
  await form.getByRole("combobox", { name: "份量依据", exact: true }).selectOption("net_weight");
  await form.getByLabel("食物净重 g", { exact: true }).fill("0");
  const other = await editor(page, chicken.id, chicken.label);
  await other.getByLabel("取用数量", { exact: true }).fill("0.5");
  await changeDate(page, otherDate);
  const recovery = page.getByRole("region", { name: `未保存的吃入量：${rice.label}`, exact: true });
  await recovery.getByText("查看保留的输入", { exact: true }).click();
  await expect(recovery.locator("dd").first()).toHaveText("0 g");
  await expect(recovery.locator("input,select")).toHaveCount(0);
  await expect(page.getByRole("region", { name: `未保存的吃入量：${chicken.label}`, exact: true })).toBeVisible();
  await recovery.getByRole("button", { name: `返回 ${date} 继续`, exact: true }).click();
  await expect(form.getByLabel("食物净重 g", { exact: true })).toHaveValue("0");
  await expect(other.getByLabel("取用数量", { exact: true })).toHaveValue("0.5");
  const path = `/api/v1/nutrition/meals/${meal.id}/contributions/${rice.id}/intake`;
  await page.route(`**${path}/preview`, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "fake_failure" }) }), { times: 1 });
  await form.getByRole("button", { name: "预览计算", exact: true }).click();
  await expect(form.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("查看日期", { exact: true })).toBeEnabled();
  await preview(form);
  const external = await page.request.patch(`/api/v1/nutrition/meals/${meal.id}/contributions/${rice.id}/portion`, { data: { mealRevision: meal.revision, contributionRevision: rice.revision, portionAmount: 125 } });
  expect(external.status()).toBe(200);
  const conflict = page.waitForResponse(value => new URL(value.url()).pathname === path && value.request().method() === "PUT");
  await form.getByRole("button", { name: "保存吃入量", exact: true }).click();
  expect((await conflict).status()).toBe(409);
  await expect(form.getByLabel("食物净重 g", { exact: true })).toHaveValue("0");
  await form.getByRole("button", { name: "重新读取原食物，保留输入", exact: true }).click();
  await expect(page.getByLabel("查看日期", { exact: true })).toBeEnabled();
  await expect(form.getByLabel("食物净重 g", { exact: true })).toHaveValue("0");
  await preview(form);
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${path}`, async route => { await released; await route.continue(); });
  const savedResponse = page.waitForResponse(value => new URL(value.url()).pathname === path && value.request().method() === "PUT");
  try {
    await form.getByRole("button", { name: "保存吃入量", exact: true }).click();
    await expect(page.getByLabel("查看日期", { exact: true })).toBeDisabled();
    await navigate(page, "历史");
  } finally { release(); }
  expect((await savedResponse).status()).toBe(200);
  await navigate(page, "饮食");
  await expect(page.getByLabel("查看日期", { exact: true })).toBeEnabled();
  expect((await readMeals(page))[0]!.contributions.find(value => value.id === rice.id)).toMatchObject({ portionAmount: 0, energyKcal: 0, fatGrams: null });
  await expect(other.getByLabel("取用数量", { exact: true })).toHaveValue("0.5");
});

test("same-container readings require confirmation, deleted originals stay read-only, and logout clears draft health data", async ({ page }) => {
  const { meal, rice, chicken } = await fixture(page);
  const form = await editor(page, rice.id, rice.label);
  await form.getByRole("combobox", { name: "份量依据", exact: true }).selectOption("before_after");
  await form.getByLabel("餐前重量 g", { exact: true }).fill("400");
  await form.getByLabel("餐后重量 g", { exact: true }).fill("250");
  let previews = 0;
  page.on("request", request => { if (request.url().endsWith("/intake/preview")) previews++; });
  await form.getByRole("button", { name: "预览计算", exact: true }).click();
  expect(previews).toBe(0);
  await form.getByLabel("餐前、餐后使用相同容器和称量口径", { exact: true }).check();
  await preview(form);
  await expect(form.locator(".intake-calculation__total")).toContainText("150 g");
  const other = await editor(page, chicken.id, chicken.label);
  await other.getByLabel("取用数量", { exact: true }).fill("");
  const removed = await page.request.delete(`/api/v1/nutrition/meals/${meal.id}/contributions/${rice.id}?mealRevision=${meal.revision}&contributionRevision=${rice.revision}`);
  expect(removed.status()).toBe(200);
  await navigate(page, "历史"); await navigate(page, "饮食");
  const recovery = page.getByRole("region", { name: `未保存的吃入量：${rice.label}`, exact: true });
  await expect(recovery).toContainText("原食物已不在当前记录中");
  await recovery.getByText("查看保留的输入", { exact: true }).click();
  await expect(recovery).toContainText("400 g");
  await expect(recovery.getByRole("button", { name: "保存吃入量", exact: true })).toHaveCount(0);
  await recovery.getByRole("button", { name: "放弃这份吃入量输入", exact: true }).click();
  await expect(recovery).toHaveCount(0);
  expect((await readMeals(page))[0]!.contributions.map(value => value.id)).toEqual([chicken.id]);
  await changeDate(page, otherDate);
  await expect(page.getByRole("region", { name: `未保存的吃入量：${chicken.label}`, exact: true })).toBeVisible();
  await navigate(page, "我的"); await page.getByRole("button", { name: /^应用设置/ }).click();
  await page.getByRole("button", { name: "数据与账号", exact: true }).click();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByRole("link", { name: "去注册", exact: true }).click(); await register(page); await navigate(page, "饮食");
  await expect(page.getByRole("region", { name: /^未保存的吃入量：/ })).toHaveCount(0);
  await expect(page.locator(".intake-editor, .meal-card")).toHaveCount(0);
});
