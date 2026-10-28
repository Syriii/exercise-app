import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type { Meal } from "../src/api/nutrition";
import { completeSetup } from "./helpers/setup";

const fakePhoto = { name: "local-meal.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") };
const retainedValues = { name: "米饭的未保存修正", energy: "275", protein: "7.5", carbohydrate: "58", fat: "0" };

async function photoMeal(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/register");
  await page.getByLabel("用户名").fill(`orphan_${randomUUID().replaceAll("-", "").slice(0, 20)}`);
  await page.getByLabel("密码", { exact: true }).fill("only fake local correction password");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await completeSetup(page);
  const settings = await (await page.request.get("/api/v1/photo-analysis-settings")).json();
  expect((await page.request.put("/api/v1/photo-analysis-settings", { data: { revision: settings.revision, automatic: true, consent: true } })).ok()).toBe(true);
  await page.goto("/nutrition");
  const camera = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "拍照记一餐", exact: true }).click();
  await (await camera).setFiles(fakePhoto);
  await page.getByRole("button", { name: "保存这餐并上传", exact: true }).click();
  const card = page.locator(".meal-card").filter({ visible: true });
  await expect(card.locator(".food-item")).toHaveCount(2);
  const date = await page.getByLabel("查看日期").inputValue();
  const meals: Meal[] = await (await page.request.get(`/api/v1/nutrition/meals?from=${date}&to=${date}`)).json();
  const meal = meals.find(value => value.contributions.some(item => item.label === "米饭"))!;
  return { card, meal, date };
}

async function fillCorrection(page: Page) {
  await page.getByRole("button", { name: "编辑食物：米饭", exact: true }).click();
  const form = page.getByRole("form", { name: "修正食物", exact: true });
  await form.getByLabel("食物名称", { exact: true }).fill(retainedValues.name);
  await form.getByText("修正已知营养", { exact: true }).click();
  await form.getByLabel("能量 kcal", { exact: true }).fill(retainedValues.energy);
  await form.getByLabel("蛋白质 g", { exact: true }).fill(retainedValues.protein);
  await form.getByLabel("碳水 g", { exact: true }).fill(retainedValues.carbohydrate);
  await form.getByLabel("脂肪 g", { exact: true }).fill(retainedValues.fat);
}

async function returnToNutrition(page: Page) {
  const navigation = page.locator(".mobile-dock, .desktop-rail");
  await navigation.getByRole("button", { name: /^历史/ }).filter({ visible: true }).click();
  await navigation.getByRole("button", { name: /^饮食/ }).filter({ visible: true }).click();
}

async function expectRetainedCorrection(page: Page, carbohydrate = retainedValues.carbohydrate) {
  const recovery = page.getByRole("region", { name: "未保存的食物修正", exact: true });
  await expect(recovery).toBeVisible();
  await expect(recovery).toContainText("原食物已不在当前记录中");
  await expect(recovery).toContainText("无法保存到原食物");
  for (const [label, value] of [["食物名称", retainedValues.name], ["能量 kcal", retainedValues.energy], ["蛋白质 g", retainedValues.protein], ["碳水 g", carbohydrate], ["脂肪 g", retainedValues.fat]]) {
    const retained = recovery.locator("dl > div").filter({ has: page.getByText(label!, { exact: true }) });
    await expect(retained.locator("dd")).toHaveText(value || "未填写");
  }
  await expect(recovery.locator("input, textarea")).toHaveCount(0);
  await expect(recovery.getByRole("button", { name: /保存修正|保存这餐/ })).toHaveCount(0);
  return recovery;
}

function watchBrowserWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/v1/") && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(`${request.method()} ${path}`);
  });
  return writes;
}

test("a photo food removed in another session retains its correction and can be discarded without restoring it", async ({ page }, info) => {
  if (info.project.name === "mobile-chromium") await page.setViewportSize({ width: 320, height: 800 });
  const { card, meal, date } = await photoMeal(page);
  await fillCorrection(page);
  const writes = watchBrowserWrites(page);
  const rice = meal.contributions.find(item => item.label === "米饭")!;
  // A real request against the isolated in-memory server represents another session.
  expect((await page.request.delete(`/api/v1/nutrition/meals/${meal.id}/contributions/${rice.id}?mealRevision=${meal.revision}&contributionRevision=${rice.revision}`)).status()).toBe(200);
  await returnToNutrition(page);
  const recovery = await expectRetainedCorrection(page);
  await expect(card.getByRole("button", { name: "编辑食物：米饭", exact: true })).toHaveCount(0);
  await card.getByRole("button", { name: "编辑食物：鸡腿", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("请先保存或取消正在修正的食物");
  await page.getByRole("button", { name: "继续未保存的修改", exact: true }).click();
  await expect(recovery).toBeFocused();
  const discard = await recovery.getByRole("button", { name: "放弃未保存的修改", exact: true }).boundingBox();
  expect(discard!.y + discard!.height).toBeLessThan(page.viewportSize()!.height - 64);
  expect(writes).toEqual([]);
  const before: Meal[] = await (await page.request.get(`/api/v1/nutrition/meals?from=${date}&to=${date}`)).json();
  expect(before.find(value => value.id === meal.id)!.contributions.map(item => item.label)).toEqual(["鸡腿"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("orphaned-photo-correction-retained.png"), fullPage: true });
  await recovery.getByRole("button", { name: "放弃未保存的修改", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(recovery).toHaveCount(0);
  await card.getByRole("button", { name: "编辑食物：鸡腿", exact: true }).click();
  const correction = page.getByRole("form", { name: "修正食物", exact: true });
  await correction.getByLabel("食物名称", { exact: true }).fill("鸡腿已核对");
  await correction.getByRole("button", { name: "保存修正", exact: true }).click();
  await expect(card.getByRole("button", { name: "编辑食物：鸡腿已核对", exact: true })).toBeVisible();
  const after: Meal[] = await (await page.request.get(`/api/v1/nutrition/meals?from=${date}&to=${date}`)).json();
  expect(after).toHaveLength(1);
  expect(after[0]!.contributions.map(item => item.label)).toEqual(["鸡腿已核对"]);
  expect(writes).toEqual([`PUT /api/v1/nutrition/meals/${meal.id}/contributions/${meal.contributions.find(item => item.label === "鸡腿")!.id}`]);
});

test("a photo meal removed in another session retains blank nutrients and does not leave an editing lock", async ({ page }, info) => {
  if (info.project.name === "mobile-chromium") await page.setViewportSize({ width: 375, height: 812 });
  const { meal, date } = await photoMeal(page);
  const otherResponse = await page.request.post("/api/v1/nutrition/meals", { data: { localDate: date, occurredAt: new Date().toISOString(), timeZone: "Asia/Shanghai", name: "保留的另一餐", note: null } });
  expect(otherResponse.status()).toBe(201);
  const other: Meal = await otherResponse.json();
  expect((await page.request.post(`/api/v1/nutrition/meals/${other.id}/contributions`, { data: {
    mealRevision: other.revision, replaceExisting: false, mode: "item", label: "另一餐食物", portionAmount: 1, portionUnit: "份", basisDescription: "local fake fixture",
    energyKcal: null, proteinGrams: null, carbohydrateGrams: null, fatGrams: null,
  } })).status()).toBe(201);
  await fillCorrection(page);
  await page.getByRole("form", { name: "修正食物", exact: true }).getByLabel("碳水 g", { exact: true }).fill("");
  const writes = watchBrowserWrites(page);
  expect((await page.request.delete(`/api/v1/nutrition/meals/${meal.id}?revision=${meal.revision}`)).status()).toBe(204);
  await returnToNutrition(page);
  const recovery = await expectRetainedCorrection(page, "");
  const otherCard = page.locator(`#meal-${other.id}`);
  await expect(page.getByRole("heading", { name: "这一天吃了什么", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "返回当天餐食", exact: true })).toHaveCount(0);
  await expect(otherCard).toBeVisible();
  await expect(otherCard.getByRole("button", { name: "打开餐食", exact: true })).toBeVisible();
  await otherCard.getByRole("button", { name: "打开餐食", exact: true }).click();
  await otherCard.getByRole("button", { name: "编辑食物：另一餐食物", exact: true }).click();
  await page.getByRole("button", { name: "继续未保存的修改", exact: true }).click();
  await expect(recovery).toBeFocused();
  const before: Meal[] = await (await page.request.get(`/api/v1/nutrition/meals?from=${date}&to=${date}`)).json();
  expect(before.map(value => value.id)).toEqual([other.id]);
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("orphaned-whole-meal-correction-retained.png"), fullPage: true });
  await recovery.getByRole("button", { name: "放弃未保存的修改", exact: true }).click();
  await expect(recovery).toHaveCount(0);
  await otherCard.getByRole("button", { name: "编辑食物：另一餐食物", exact: true }).click();
  await expect(page.getByRole("form", { name: "修正食物", exact: true }).getByLabel("食物名称", { exact: true })).toHaveValue("另一餐食物");
  await page.getByRole("form", { name: "修正食物", exact: true }).getByRole("button", { name: "取消修改", exact: true }).click();
  const after: Meal[] = await (await page.request.get(`/api/v1/nutrition/meals?from=${date}&to=${date}`)).json();
  expect(after.map(value => value.id)).toEqual([other.id]);
  expect(after[0]!.contributions.map(item => item.label)).toEqual(["另一餐食物"]);
  expect(writes).toEqual([]);
});
