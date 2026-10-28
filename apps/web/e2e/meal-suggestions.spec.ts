import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Meal } from "../src/api/nutrition";
import type { MealSuggestionsResult } from "../src/features/nutrition/meal-suggestions";
import { reveal } from "./helpers/disclosure";
import { completeSetup } from "./helpers/setup";

const date = "2099-11-03";
const suggestionsPath = "/api/v1/nutrition/meal-suggestions";

async function fixture(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/register");
  await page.getByLabel("用户名").fill(`choices_${randomUUID().replaceAll("-", "").slice(0, 20)}`);
  await page.getByLabel("密码", { exact: true }).fill("only fake local suggestions password");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await completeSetup(page);
  await page.goto(`/nutrition?date=${date}`);
  await expect(page.getByRole("button", { name: "看看吃什么", exact: true })).toBeVisible();
}
async function readMeals(page: Page): Promise<Meal[]> {
  const result = await page.request.get(`/api/v1/nutrition/meals?from=${date}&to=${date}`);
  expect(result.status()).toBe(200); return result.json();
}
function watchMealWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/v1/nutrition/meals") && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(`${request.method()} ${path}`);
  });
  return writes;
}
async function openSuggestions(page: Page) {
  const response = page.waitForResponse(value => new URL(value.url()).pathname === suggestionsPath && value.request().method() === "POST");
  await page.getByRole("button", { name: "看看吃什么", exact: true }).click();
  const loaded = await response;
  expect(loaded.status()).toBe(200);
  const result: MealSuggestionsResult = await loaded.json();
  const panel = page.getByRole("region", { name: "这顿吃什么", exact: true });
  await expect(panel.locator(".suggestion-choice")).toHaveCount(3);
  return { panel, result };
}
async function updateSuggestions(page: Page, panel: Locator, button = "更新搭配") {
  const response = page.waitForResponse(value => new URL(value.url()).pathname === suggestionsPath && value.request().method() === "POST");
  await panel.getByRole("button", { name: button, exact: true }).click();
  const loaded = await response;
  expect(loaded.status()).toBe(200);
  const result: MealSuggestionsResult = await loaded.json();
  await expect(panel.locator(".suggestion-title h3")).toHaveText(result.choices.slice(0, 3).map(choice => choice.title));
  return { result, request: loaded.request().postDataJSON() };
}

test("on-demand choices show distinct meals and catalog evidence, rank preferences and existing food, and preserve results on retry", async ({ page }, info) => {
  await fixture(page);
  const writes = watchMealWrites(page);
  let calls = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === suggestionsPath) calls++; });
  await expect(page.getByRole("region", { name: "这顿吃什么", exact: true })).toHaveCount(0);
  expect(calls).toBe(0);
  const { panel, result } = await openSuggestions(page);
  expect(result.choices.length).toBeGreaterThanOrEqual(3);
  expect(new Set(result.choices.slice(0, 3).map(choice => choice.style)).size).toBe(3);
  await expect(panel.locator(".suggestion-title h3")).toHaveText(result.choices.slice(0, 3).map(choice => choice.title));
  await expect(panel).toContainText("选入后仍需核对实际吃入量再保存");
  const first = panel.locator(".suggestion-choice").first();
  await first.getByText("看怎么算与来源", { exact: true }).click();
  await expect(first.locator(".suggestion-calculations > li")).toHaveCount(result.choices[0]!.items.length);
  for (const item of result.choices[0]!.items) {
    const source = first.locator(".suggestion-calculations > li").filter({ has: page.getByText(item.food.label, { exact: true }) });
    await expect(source).toContainText(item.energyFormula);
    await expect(source).toContainText(item.food.sourceName);
    await expect(source).toContainText(item.food.version);
    if (item.food.sourceUrl) await expect(source.getByRole("link", { name: "查看数据来源", exact: true })).toHaveAttribute("href", new URL(item.food.sourceUrl).href);
  }
  await expect(first).toContainText("商家额外油、酱汁和不同配方");
  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`meal-choices-sources-${width}.png`), fullPage: true });
  }
  await panel.getByRole("button", { name: "再看几个搭配", exact: true }).click();
  await expect(panel.locator(".suggestion-choice")).toHaveCount(Math.min(6, result.choices.length));
  await panel.getByRole("combobox", { name: "这次优先", exact: true }).selectOption("breakfast");
  const breakfast = await updateSuggestions(page, panel);
  expect(breakfast.result.choices.slice(0, 3).every(choice => choice.style === "breakfast")).toBe(true);
  expect(breakfast.request).toEqual({ localDate: date, style: "breakfast", availableFoods: [] });
  await panel.getByRole("combobox", { name: "这次优先", exact: true }).selectOption("all");
  await panel.getByText("优先用已有食物", { exact: true }).click();
  await panel.getByLabel("已有食物", { exact: true }).fill("酸奶");
  const available = await updateSuggestions(page, panel);
  expect(available.request).toEqual({ localDate: date, style: "all", availableFoods: ["酸奶"] });
  expect(available.result.choices[0]!.items.some(item => item.food.label.includes("酸奶"))).toBe(true);
  await expect(panel.locator(".suggestion-choice").first()).toContainText("可优先用到你填写的已有食物");
  const retainedTitles = await panel.locator(".suggestion-title h3").allTextContents();
  await page.route(`**${suggestionsPath}`, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "fake_local_failure" }) }), { times: 1 });
  await panel.getByRole("button", { name: "更新搭配", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("仍显示上次读取的搭配");
  await expect(panel.locator(".suggestion-title h3")).toHaveText(retainedTitles);
  await expect(panel.getByLabel("已有食物", { exact: true })).toHaveValue("酸奶");
  const retried = await updateSuggestions(page, panel, "重新读取");
  expect(retried.request).toEqual(available.request);
  await expect(panel.getByRole("alert")).toHaveCount(0);
  expect(writes).toEqual([]);
  expect(await readMeals(page)).toEqual([]);
});

test("using a choice only creates an editable draft; confirmed actual portions save a meal and remain editable", async ({ page }) => {
  await fixture(page);
  const writes = watchMealWrites(page);
  const { panel, result } = await openSuggestions(page);
  const choice = result.choices[0]!;
  await panel.locator(".suggestion-choice").first().getByRole("button", { name: "用这份搭配记餐", exact: true }).click();
  const selected = page.getByRole("form", { name: "已选食物", exact: true });
  await expect(selected.locator(".catalog-selection-row")).toHaveCount(choice.items.length);
  await expect(page.locator(".form-notice[role='status']")).toContainText("保存后才计入饮食记录");
  for (const item of choice.items) await expect(selected.getByRole("spinbutton", { name: `${item.food.label}份量（${item.food.basisUnit}）`, exact: true })).toHaveValue(String(item.amount));
  expect(writes).toEqual([]);
  expect(await readMeals(page)).toEqual([]);
  const item = choice.items[0]!, actualAmount = item.amount / 2;
  await selected.getByRole("spinbutton", { name: `${item.food.label}份量（${item.food.basisUnit}）`, exact: true }).fill(String(actualAmount));
  const mealName = page.getByLabel("餐次名称（可选）", { exact: true });
  await reveal(mealName); await mealName.fill("已核对实际份量的搭配");
  expect(await readMeals(page)).toEqual([]);
  await page.getByRole("button", { name: `加入这顿饭（${choice.items.length}项）`, exact: true }).click();
  await expect(page.locator(".food-item")).toHaveCount(choice.items.length);
  const meals = await readMeals(page);
  expect(meals).toHaveLength(1);
  const saved = meals[0]!;
  expect(saved.name).toBe("已核对实际份量的搭配");
  expect(saved.contributions.map(value => value.label).sort()).toEqual(choice.items.map(value => value.food.label).sort());
  const first = saved.contributions.find(value => value.label === item.food.label)!;
  expect(first.portionAmount).toBe(actualAmount);
  if (item.food.energyKcal !== null) expect(first.energyKcal).toBeCloseTo(item.food.energyKcal * actualAmount / item.food.basisAmount!, 3);
  expect(writes).toEqual(["POST /api/v1/nutrition/meals", `POST /api/v1/nutrition/meals/${saved.id}/food-selections`]);
  const row = page.locator(`#meal-food-${first.id}`);
  await row.getByRole("button", { name: "改份量", exact: true }).click();
  await row.getByRole("spinbutton", { name: `${first.label}份量（${first.portionUnit}）`, exact: true }).fill(String(actualAmount + 25));
  await row.getByRole("button", { name: "保存份量", exact: true }).click();
  await expect(row.locator(".portion-editor")).toHaveCount(0);
  const edited = (await readMeals(page))[0]!;
  expect(edited.contributions.find(value => value.id === first.id)!.portionAmount).toBe(actualAmount + 25);
  expect(edited.contributions.filter(value => value.id !== first.id)).toEqual(saved.contributions.filter(value => value.id !== first.id));
});

test("replacing a same-day draft requires confirmation and cancelling preserves its name, foods and actual amount", async ({ page }) => {
  await fixture(page);
  const writes = watchMealWrites(page);
  const initial = await openSuggestions(page);
  const first = initial.result.choices[0]!;
  await initial.panel.locator(".suggestion-choice").first().getByRole("button", { name: "用这份搭配记餐", exact: true }).click();
  const selected = page.getByRole("form", { name: "已选食物", exact: true });
  const amountName = `${first.items[0]!.food.label}份量（${first.items[0]!.food.basisUnit}）`;
  await selected.getByRole("spinbutton", { name: amountName, exact: true }).fill("123.5");
  const mealName = page.getByLabel("餐次名称（可选）", { exact: true });
  await reveal(mealName); await mealName.fill("保留这份未保存草稿");
  await page.getByRole("region", { name: "快速记餐", exact: true }).getByRole("button", { name: "收起", exact: true }).click();
  const next = await openSuggestions(page);
  const second = next.result.choices[1]!;
  let dismissedMessage = "";
  page.once("dialog", async dialog => { dismissedMessage = dialog.message(); await dialog.dismiss(); });
  await next.panel.locator(".suggestion-choice").nth(1).getByRole("button", { name: "用这份搭配记餐", exact: true }).click();
  await expect.poll(() => dismissedMessage).toContain("放弃当前未保存的记餐草稿");
  await expect(next.panel).toBeVisible();
  await next.panel.getByRole("button", { name: "收起", exact: true }).click();
  await page.getByRole("button", { name: "手动添加食物", exact: true }).click();
  await expect(mealName).toHaveValue("保留这份未保存草稿");
  await expect(selected.getByRole("spinbutton", { name: amountName, exact: true })).toHaveValue("123.5");
  await expect(selected.locator(".selection-food-name > strong")).toHaveText(first.items.map(item => item.food.label));
  expect(await readMeals(page)).toEqual([]);
  await page.getByRole("region", { name: "快速记餐", exact: true }).getByRole("button", { name: "收起", exact: true }).click();
  const accepted = await openSuggestions(page);
  page.once("dialog", dialog => dialog.accept());
  await accepted.panel.locator(".suggestion-choice").nth(1).getByRole("button", { name: "用这份搭配记餐", exact: true }).click();
  await expect(mealName).toHaveValue(second.title);
  await expect(selected.locator(".selection-food-name > strong")).toHaveText(second.items.map(item => item.food.label));
  for (const item of second.items) await expect(selected.getByRole("spinbutton", { name: `${item.food.label}份量（${item.food.basisUnit}）`, exact: true })).toHaveValue(String(item.amount));
  expect(writes).toEqual([]);
  expect(await readMeals(page)).toEqual([]);
});
