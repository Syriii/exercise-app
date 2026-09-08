import { expect, type Locator, type Page } from "@playwright/test";

export async function createMeal(page: Page, name: string) {
  await page.getByRole("group", { name: "记录餐食" }).getByRole("button", { name: "添加食物", exact: true }).click();
  await page.getByLabel("餐次名称（可选）").fill(name);
  await page.getByRole("button", { name: "建立餐次", exact: true }).click();
  const meal = page.locator("article.meal-card").filter({ has: page.locator("header strong", { hasText: name }) });
  await expect(meal.getByRole("button", { name: "收起餐食", exact: true })).toBeVisible();
  return meal;
}

export async function openPicker(meal: Locator) {
  const picker = meal.getByRole("region", { name: "添加食物", exact: true });
  if (await picker.getByRole("button", { name: "添加食物", exact: true }).count())
    await picker.getByRole("button", { name: "添加食物", exact: true }).click();
  return picker;
}

export async function addPersonalFood(meal: Locator, label: string, amount = "100", unit = "g", nutrients: { energy?: string; protein?: string; carbs?: string; fat?: string } = {}) {
  const picker = await openPicker(meal);
  if (!(await picker.getByLabel("个人食物名称").isVisible())) await picker.getByText("找不到？补充个人食物", { exact: true }).click();
  await picker.getByLabel("个人食物名称").fill(label);
  await picker.getByLabel("基准份量", { exact: true }).fill(amount);
  await picker.getByLabel("基准单位", { exact: true }).fill(unit);
  if (Object.keys(nutrients).length) {
    if (!(await picker.getByLabel("基准能量 kcal").isVisible())) await picker.getByText("补充营养（选填）", { exact: true }).click();
    await picker.getByLabel("基准能量 kcal").fill(nutrients.energy ?? "");
    await picker.getByLabel("基准蛋白质 g").fill(nutrients.protein ?? "");
    await picker.getByLabel("基准碳水 g").fill(nutrients.carbs ?? "");
    await picker.getByLabel("基准脂肪 g").fill(nutrients.fat ?? "");
  }
  await picker.getByRole("button", { name: "保存个人食物并选择" }).click();
  await picker.getByRole("button", { name: "加入这顿饭（1项）", exact: true }).click();
  await expect(meal.locator(".meal-items strong").getByText(label, { exact: true })).toBeVisible();
}
