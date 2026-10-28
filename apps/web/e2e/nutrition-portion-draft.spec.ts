import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type { Meal } from "../src/api/nutrition";
import { completeSetup } from "./helpers/setup";

const fakePhoto = { name: "portion-draft.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") };

async function register(page: Page) {
  await page.getByLabel("用户名").fill(`portion_${randomUUID().replaceAll("-", "").slice(0, 20)}`);
  await page.getByLabel("密码", { exact: true }).fill("only fake local portion password");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await completeSetup(page);
}

async function navigate(page: Page, name: "饮食" | "历史" | "我的") {
  await page.locator(".mobile-dock, .desktop-rail").getByRole("button", { name: new RegExp(`^${name}`) }).filter({ visible: true }).click();
}

async function photoMeal(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/register");
  await register(page);
  const settings = await (await page.request.get("/api/v1/photo-analysis-settings")).json();
  expect((await page.request.put("/api/v1/photo-analysis-settings", { data: { revision: settings.revision, automatic: true, consent: true } })).ok()).toBe(true);
  await navigate(page, "饮食");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "拍照记一餐", exact: true }).click();
  await (await chooser).setFiles(fakePhoto);
  await page.getByRole("button", { name: "保存这餐并上传", exact: true }).click();
  await expect(page.locator(".food-item")).toHaveCount(2);
  const date = await page.getByLabel("查看日期", { exact: true }).inputValue();
  const meals = await readMeals(page, date);
  const meal = meals[0]!;
  const rice = meal.contributions.find(item => item.label === "米饭")!;
  const chicken = meal.contributions.find(item => item.label === "鸡腿")!;
  const otherDate = date === "2099-12-29" ? "2099-12-28" : "2099-12-29";
  return { meal, rice, chicken, date, otherDate };
}

async function readMeals(page: Page, date: string): Promise<Meal[]> {
  const response = await page.request.get(`/api/v1/nutrition/meals?from=${date}&to=${date}`);
  expect(response.status()).toBe(200);
  return response.json();
}

async function changeDate(page: Page, date: string) {
  await page.getByLabel("查看日期", { exact: true }).fill(date);
  await page.getByLabel("查看日期", { exact: true }).dispatchEvent("change");
  await expect(page.getByText("正在读取这一天…", { exact: true })).toHaveCount(0);
}

async function refreshNutrition(page: Page) {
  await navigate(page, "历史");
  await navigate(page, "饮食");
  await expect(page.getByText("正在读取这一天…", { exact: true })).toHaveCount(0);
}

function watchWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/v1/") && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(`${request.method()} ${path}`);
  });
  return writes;
}

async function expectRetainedPortion(page: Page, name: string, amount: string) {
  const recovery = page.getByRole("region", { name: `未保存的份量：${name}`, exact: true });
  await expect(recovery).toBeVisible();
  await expect(recovery.locator("dt")).toHaveText(`份量 ${name === "米饭" ? "g" : "个"}`);
  await expect(recovery.locator("dd")).toHaveText(amount === "" ? "未填写" : amount);
  await expect(recovery.locator("input, textarea")).toHaveCount(0);
  await expect(recovery.getByRole("button", { name: "保存份量", exact: true })).toHaveCount(0);
  return recovery;
}

test("photo portion drafts survive repeated opening and dates, and save only the original food", async ({ page }, info) => {
  if (info.project.name === "mobile-chromium") await page.setViewportSize({ width: 320, height: 800 });
  const { meal, rice, chicken, date, otherDate } = await photoMeal(page);
  const otherResponse = await page.request.post("/api/v1/nutrition/meals", { data: { localDate: otherDate, occurredAt: `${otherDate}T04:00:00Z`, timeZone: "UTC", name: "另一日保留的餐食", note: null } });
  expect(otherResponse.status()).toBe(201);
  const otherBefore = await readMeals(page, otherDate);
  const writes = watchWrites(page);
  const riceRow = page.locator(`#meal-food-${rice.id}`), chickenRow = page.locator(`#meal-food-${chicken.id}`);
  await riceRow.getByRole("button", { name: "改份量", exact: true }).click();
  await expect(riceRow.getByRole("spinbutton", { name: "米饭份量（g）", exact: true })).toHaveValue("200");
  await riceRow.getByRole("spinbutton", { name: "米饭份量（g）", exact: true }).fill("100");
  await riceRow.getByRole("button", { name: "改份量", exact: true }).click();
  await expect(riceRow.getByRole("spinbutton", { name: "米饭份量（g）", exact: true })).toHaveValue("100");
  await chickenRow.getByRole("button", { name: "改份量", exact: true }).click();
  await chickenRow.getByRole("spinbutton", { name: "鸡腿份量（个）", exact: true }).fill("0.5");
  await changeDate(page, otherDate);
  await expectRetainedPortion(page, "米饭", "100");
  await expectRetainedPortion(page, "鸡腿", "0.5");
  await changeDate(page, date);
  await expect(riceRow.getByRole("spinbutton", { name: "米饭份量（g）", exact: true })).toHaveValue("100");
  await expect(chickenRow.getByRole("spinbutton", { name: "鸡腿份量（个）", exact: true })).toHaveValue("0.5");
  await changeDate(page, otherDate);
  const recovery = await expectRetainedPortion(page, "米饭", "100");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("photo-portions-retained-on-another-date.png"), fullPage: true });
  await recovery.getByRole("button", { name: `返回 ${date} 继续修改米饭份量`, exact: true }).click();
  await expect(riceRow.getByRole("spinbutton", { name: "米饭份量（g）", exact: true })).toBeFocused();
  await expect(chickenRow.getByRole("spinbutton", { name: "鸡腿份量（个）", exact: true })).toHaveValue("0.5");
  expect(writes).toEqual([]);

  const path = `/api/v1/nutrition/meals/${meal.id}/contributions/${rice.id}/portion`;
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  const payloads: unknown[] = [];
  await page.route(`**${path}`, async route => {
    if (route.request().method() !== "PATCH") { await route.continue(); return; }
    payloads.push(route.request().postDataJSON());
    await released;
    await route.continue();
  });
  const response = page.waitForResponse(value => new URL(value.url()).pathname === path && value.request().method() === "PATCH");
  try {
    await riceRow.getByRole("button", { name: "保存份量", exact: true }).click();
    await expect.poll(() => payloads.length).toBe(1);
    await expect(page.getByLabel("查看日期", { exact: true })).toBeDisabled();
    await expect(riceRow.getByRole("button", { name: "保存中…", exact: true })).toBeDisabled();
  } finally { release(); }
  expect((await response).status()).toBe(200);
  await expect(page.getByLabel("查看日期", { exact: true })).toBeEnabled();
  await expect(riceRow.locator(".portion-editor")).toHaveCount(0);
  await expect(chickenRow.getByRole("spinbutton", { name: "鸡腿份量（个）", exact: true })).toHaveValue("0.5");
  expect(payloads).toEqual([{ mealRevision: meal.revision, contributionRevision: rice.revision, portionAmount: 100 }]);
  expect(writes).toEqual([`PATCH ${path}`]);
  const saved = (await readMeals(page, date))[0]!;
  expect(saved.contributions.find(item => item.id === rice.id)).toMatchObject({ portionAmount: 100, energyKcal: 120 });
  expect(saved.contributions.find(item => item.id === chicken.id)).toMatchObject({ portionAmount: 1, energyKcal: 380 });
  expect(await readMeals(page, otherDate)).toEqual(otherBefore);
});

test("a refreshed photo food keeps its local portion and old revision until the conflict is cancelled", async ({ page }) => {
  const { meal, rice, date } = await photoMeal(page);
  const row = page.locator(`#meal-food-${rice.id}`);
  await row.getByRole("button", { name: "改份量", exact: true }).click();
  await row.getByRole("spinbutton", { name: "米饭份量（g）", exact: true }).fill("100");
  const path = `/api/v1/nutrition/meals/${meal.id}/contributions/${rice.id}/portion`;
  const external = await page.request.patch(path, { data: { mealRevision: meal.revision, contributionRevision: rice.revision, portionAmount: 150 } });
  expect(external.status()).toBe(200);
  const writes = watchWrites(page);
  await refreshNutrition(page);
  await expect(row.locator(".food-item-summary > span")).toContainText("150 g");
  await expect(row.getByRole("spinbutton", { name: "米饭份量（g）", exact: true })).toHaveValue("100");
  const response = page.waitForResponse(value => new URL(value.url()).pathname === path && value.request().method() === "PATCH");
  await row.getByRole("button", { name: "保存份量", exact: true }).click();
  const conflict = await response;
  expect(conflict.status()).toBe(409);
  expect(conflict.request().postDataJSON()).toEqual({ mealRevision: meal.revision, contributionRevision: rice.revision, portionAmount: 100 });
  await expect(row.getByRole("alert")).toBeVisible();
  await expect(row.getByRole("spinbutton", { name: "米饭份量（g）", exact: true })).toHaveValue("100");
  expect((await readMeals(page, date))[0]!.contributions.find(item => item.id === rice.id)).toMatchObject({ portionAmount: 150, energyKcal: 180 });
  await row.getByRole("button", { name: "取消", exact: true }).click();
  await expect(row.locator(".portion-editor")).toHaveCount(0);
  await row.getByRole("button", { name: "改份量", exact: true }).click();
  await expect(row.getByRole("spinbutton", { name: "米饭份量（g）", exact: true })).toHaveValue("150");
  expect(writes).toEqual([`PATCH ${path}`]);
});

test("removed photo foods and meals retain zero or blank portions without recreating records", async ({ page }, info) => {
  if (info.project.name === "mobile-chromium") await page.setViewportSize({ width: 375, height: 812 });
  const { meal, rice, chicken, date } = await photoMeal(page);
  const riceRow = page.locator(`#meal-food-${rice.id}`), chickenRow = page.locator(`#meal-food-${chicken.id}`);
  await riceRow.getByRole("button", { name: "改份量", exact: true }).click();
  await riceRow.getByRole("spinbutton", { name: "米饭份量（g）", exact: true }).fill("0");
  await chickenRow.getByRole("button", { name: "改份量", exact: true }).click();
  await chickenRow.getByRole("spinbutton", { name: "鸡腿份量（个）", exact: true }).fill("");
  const writes = watchWrites(page);
  const removed = await page.request.delete(`/api/v1/nutrition/meals/${meal.id}/contributions/${rice.id}?mealRevision=${meal.revision}&contributionRevision=${rice.revision}`);
  expect(removed.status()).toBe(200);
  const current: Meal = await removed.json();
  await refreshNutrition(page);
  const riceRecovery = await expectRetainedPortion(page, "米饭", "0");
  await expect(riceRecovery).toContainText("原食物已不在当前记录中");
  await expect(riceRecovery.getByRole("button", { name: /返回.*继续修改/ })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("removed-photo-portion-zero.png"), fullPage: true });
  await riceRecovery.getByRole("button", { name: "放弃这份份量修改", exact: true }).click();
  await expect(riceRecovery).toHaveCount(0);
  expect((await readMeals(page, date))[0]!.contributions.map(item => item.id)).toEqual([chicken.id]);
  expect((await page.request.delete(`/api/v1/nutrition/meals/${meal.id}?revision=${current.revision}`)).status()).toBe(204);
  await refreshNutrition(page);
  const chickenRecovery = await expectRetainedPortion(page, "鸡腿", "");
  await expect(chickenRecovery).toContainText("原食物已不在当前记录中");
  await expect(page.locator(".meal-card")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("removed-photo-meal-portion-blank.png"), fullPage: true });
  await chickenRecovery.getByRole("button", { name: "放弃这份份量修改", exact: true }).click();
  await expect(chickenRecovery).toHaveCount(0);
  expect(await readMeals(page, date)).toEqual([]);
  expect(writes).toEqual([]);
});

test("photo portion drafts are cleared at explicit logout before another account opens nutrition", async ({ page }) => {
  const { rice, otherDate } = await photoMeal(page);
  const row = page.locator(`#meal-food-${rice.id}`);
  await row.getByRole("button", { name: "改份量", exact: true }).click();
  await row.getByRole("spinbutton", { name: "米饭份量（g）", exact: true }).fill("123.5");
  await changeDate(page, otherDate);
  await expectRetainedPortion(page, "米饭", "123.5");
  await navigate(page, "我的");
  await page.getByRole("button", { name: /^应用设置/ }).click();
  await page.getByRole("button", { name: "数据与账号", exact: true }).click();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("link", { name: "去注册", exact: true }).click();
  await register(page);
  await navigate(page, "饮食");
  await expect(page.getByRole("region", { name: /^未保存的份量：/ })).toHaveCount(0);
  await expect(page.locator(".portion-editor")).toHaveCount(0);
  await expect(page.locator(".meal-card")).toHaveCount(0);
  await expect(page.getByText("123.5", { exact: true })).toHaveCount(0);
});
