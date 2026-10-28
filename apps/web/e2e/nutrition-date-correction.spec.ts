import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type { Meal } from "../src/api/nutrition";
import { completeSetup } from "./helpers/setup";

const photo = { name: "date-correction.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") };
const retained = { label: "米饭的跨日未保存修正", energyKcal: "275", proteinGrams: "7.5", carbohydrateGrams: "", fatGrams: "0" };

async function register(page: Page) {
  await page.getByLabel("用户名").fill(`date_${randomUUID().replaceAll("-", "").slice(0, 20)}`);
  await page.getByLabel("密码", { exact: true }).fill("only fake date correction password");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await completeSetup(page);
}

async function navigate(page: Page, name: "饮食" | "我的") {
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
  await (await chooser).setFiles(photo);
  await page.getByRole("button", { name: "保存这餐并上传", exact: true }).click();
  await expect(page.locator(".food-item")).toHaveCount(2);
  const date = await page.getByLabel("查看日期").inputValue();
  const meals: Meal[] = await (await page.request.get(`/api/v1/nutrition/meals?from=${date}&to=${date}`)).json();
  const meal = meals[0]!;
  const otherDate = date === "2099-12-29" ? "2099-12-28" : "2099-12-29";
  const response = await page.request.post("/api/v1/nutrition/meals", { data: { localDate: otherDate, occurredAt: `${otherDate}T04:00:00Z`, timeZone: "UTC", name: "另一日餐食", note: null } });
  expect(response.status()).toBe(201);
  const other: Meal = await response.json();
  expect((await page.request.post(`/api/v1/nutrition/meals/${other.id}/contributions`, { data: {
    mealRevision: other.revision, replaceExisting: false, mode: "item", label: "另一日食物", portionAmount: 1, portionUnit: "份", basisDescription: "local fake fixture",
    energyKcal: 100, proteinGrams: null, carbohydrateGrams: null, fatGrams: null,
  } })).status()).toBe(201);
  await page.getByRole("button", { name: "编辑食物：米饭", exact: true }).click();
  const form = page.getByRole("form", { name: "修正食物", exact: true });
  await form.getByLabel("食物名称", { exact: true }).fill(retained.label);
  await form.getByText("修正已知营养", { exact: true }).click();
  for (const [label, value] of [["能量 kcal", retained.energyKcal], ["蛋白质 g", retained.proteinGrams], ["碳水 g", retained.carbohydrateGrams], ["脂肪 g", retained.fatGrams]]) {
    await form.getByLabel(label!, { exact: true }).fill(value!);
  }
  return { date, otherDate, meal, other };
}

async function changeDate(page: Page, date: string) {
  await page.getByLabel("查看日期", { exact: true }).fill(date);
  await page.getByLabel("查看日期", { exact: true }).dispatchEvent("change");
  await expect(page.getByText("正在读取这一天…", { exact: true })).toHaveCount(0);
}

async function expectRetained(page: Page, date: string) {
  const recovery = page.getByRole("region", { name: "未保存的食物修正", exact: true });
  await expect(recovery).toBeVisible();
  await expect(recovery).toContainText(`这份修改属于 ${date}`);
  await expect(recovery).not.toContainText("原食物已不在当前记录中");
  for (const [label, value] of [["食物名称", retained.label], ["能量 kcal", retained.energyKcal], ["蛋白质 g", retained.proteinGrams], ["碳水 g", "未填写"], ["脂肪 g", "0"]]) {
    await expect(recovery.locator("dl > div").filter({ has: page.getByText(label!, { exact: true }) }).locator("dd")).toHaveText(value!);
  }
  await expect(recovery.getByRole("button", { name: `返回 ${date} 继续修改`, exact: true })).toBeVisible();
  for (const name of [`返回 ${date} 继续修改`, "放弃未保存的修改"]) {
    const lines = await recovery.getByRole("button", { name, exact: true }).evaluate(button => {
      const range = document.createRange();
      range.selectNodeContents(button);
      return range.getClientRects().length;
    });
    expect(lines).toBe(1);
  }
  await expect(recovery.locator("input, textarea")).toHaveCount(0);
  return recovery;
}

function watchWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/v1/") && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(`${request.method()} ${path}`);
  });
  return writes;
}

test("photo corrections survive viewing another date and save only the original food once", async ({ page }, info) => {
  if (info.project.name === "mobile-chromium") await page.setViewportSize({ width: 320, height: 800 });
  const { date, otherDate, meal, other } = await photoMeal(page);
  const writes = watchWrites(page);
  await changeDate(page, otherDate);
  let recovery = await expectRetained(page, date);
  const otherCard = page.locator(`#meal-${other.id}`);
  await otherCard.getByRole("button", { name: "打开餐食", exact: true }).click();
  await otherCard.getByRole("button", { name: "编辑食物：另一日食物", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("请先保存或取消正在修正的食物");
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("correction-kept-on-another-date.png"), fullPage: true });
  await recovery.getByRole("button", { name: `返回 ${date} 继续修改`, exact: true }).click();
  const form = page.getByRole("form", { name: "修正食物", exact: true });
  await expect(form.getByLabel("食物名称", { exact: true })).toBeFocused();
  // The normal date picker also preserves the active correction through D1 → D2 → D1.
  await changeDate(page, otherDate);
  recovery = await expectRetained(page, date);
  await changeDate(page, date);
  await expect(recovery).toHaveCount(0);
  for (const [label, value] of [["食物名称", retained.label], ["能量 kcal", retained.energyKcal], ["蛋白质 g", retained.proteinGrams], ["碳水 g", retained.carbohydrateGrams], ["脂肪 g", retained.fatGrams]]) {
    await expect(form.getByLabel(label!, { exact: true })).toHaveValue(value!);
  }
  await form.getByRole("button", { name: "保存修正", exact: true }).click();
  await expect(page.getByRole("button", { name: `编辑食物：${retained.label}`, exact: true })).toBeVisible();
  const rice = meal.contributions.find(item => item.label === "米饭")!;
  expect(writes).toEqual([`PUT /api/v1/nutrition/meals/${meal.id}/contributions/${rice.id}`]);
  const saved: Meal[] = await (await page.request.get(`/api/v1/nutrition/meals?from=${date}&to=${date}`)).json();
  expect(saved[0]!.contributions.find(item => item.id === rice.id)).toMatchObject({ label: retained.label, energyKcal: 275, proteinGrams: 7.5, carbohydrateGrams: null, fatGrams: 0 });
  const otherSaved: Meal[] = await (await page.request.get(`/api/v1/nutrition/meals?from=${otherDate}&to=${otherDate}`)).json();
  expect(otherSaved[0]!.contributions).toEqual([expect.objectContaining({ label: "另一日食物", energyKcal: 100 })]);
});

test("discarding an earlier date correction releases the other date without changing either meal", async ({ page }) => {
  const { date, otherDate, meal, other } = await photoMeal(page);
  const writes = watchWrites(page);
  await changeDate(page, otherDate);
  const recovery = await expectRetained(page, date);
  await recovery.getByRole("button", { name: "放弃未保存的修改", exact: true }).click();
  await expect(recovery).toHaveCount(0);
  const card = page.locator(`#meal-${other.id}`);
  await card.getByRole("button", { name: "打开餐食", exact: true }).click();
  await card.getByRole("button", { name: "编辑食物：另一日食物", exact: true }).click();
  await expect(page.getByRole("form", { name: "修正食物", exact: true }).getByLabel("食物名称", { exact: true })).toHaveValue("另一日食物");
  await page.getByRole("button", { name: "取消修改", exact: true }).click();
  await changeDate(page, date);
  await page.locator(`#meal-${meal.id}`).getByRole("button", { name: "打开餐食", exact: true }).click();
  await page.getByRole("button", { name: "编辑食物：米饭", exact: true }).click();
  await expect(page.getByRole("form", { name: "修正食物", exact: true }).getByLabel("食物名称", { exact: true })).toHaveValue("米饭");
  expect(writes).toEqual([]);
});

test("an earlier date correction is cleared at explicit logout and cannot appear for another account", async ({ page }) => {
  const { date, otherDate } = await photoMeal(page);
  await changeDate(page, otherDate);
  await expectRetained(page, date);
  await navigate(page, "我的");
  await page.getByRole("button", { name: /^应用设置/ }).click();
  await page.getByRole("button", { name: "数据与账号", exact: true }).click();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("link", { name: "去注册", exact: true }).click();
  await register(page);
  await navigate(page, "饮食");
  await expect(page.getByRole("region", { name: "未保存的食物修正", exact: true })).toHaveCount(0);
  await expect(page.getByText(retained.label, { exact: true })).toHaveCount(0);
  await expect(page.locator(".meal-card")).toHaveCount(0);
});
