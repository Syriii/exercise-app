import { expect, test } from "@playwright/test";
import { createMeal } from "./helpers/nutrition";

test("catalog browsing, favorites, multi-selection and lost-response retry preserve one meal", async ({ page }, testInfo) => {
  await page.goto("/register");
  await page.getByLabel("用户名").fill(`catalog_${testInfo.project.name.startsWith("mobile") ? "m" : "d"}_${Date.now()}`);
  await page.getByLabel("密码").fill("a browser-only secure password");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
  await page.goto("/nutrition");
  const meal = await createMeal(page, "目录早餐");
  const picker = meal.getByRole("region", { name: "添加食物", exact: true });
  await picker.getByRole("button", { name: "添加食物", exact: true }).click();
  const list = picker.getByRole("list", { name: "食物列表" });
  await expect(list.getByRole("listitem")).toHaveCount(12);
  await picker.getByRole("button", { name: "加载更多食物" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(16);
  await picker.getByLabel("食物分类", { exact: true }).selectOption("meat_eggs");
  await picker.getByRole("button", { name: "设为常用：鸡蛋（水煮全蛋）", exact: true }).click();
  await expect(list.getByRole("listitem").first()).toContainText("鸡蛋（水煮全蛋）");
  await picker.getByRole("button", { name: "选择：鸡蛋（水煮全蛋）", exact: true }).click();
  await picker.getByLabel("鸡蛋（水煮全蛋）份量（g）").fill("200");
  if (testInfo.project.name === "desktop-chromium") {
    const original = page.viewportSize()!;
    for (const width of [320, 375, 414, 768, 960, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => picker.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      expect(await picker.locator("button, input, select").evaluateAll((elements) => elements.filter((element) => element.getBoundingClientRect().height > 0).every((element) => element.getBoundingClientRect().height >= 44))).toBe(true);
      if (width === 414) {
        await picker.evaluate((element) => {
          const scroller = element.closest(".app-main");
          if (scroller) scroller.scrollTop += element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16;
        });
        await page.screenshot({ path: "/tmp/exercise-b1-picker-414.png" });
      }
    }
    await page.setViewportSize(original);
  }
  await picker.getByLabel("食物分类", { exact: true }).selectOption("vegetables");
  await picker.getByRole("button", { name: "选择：西兰花（水煮、沥干、无盐）", exact: true }).click();
  await picker.getByLabel("西兰花（水煮、沥干、无盐）份量（g）").fill("50");
  await picker.getByLabel("搜索食物", { exact: true }).fill("不存在的个人菜名");
  await picker.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(picker.getByText("没有匹配的食物。已选内容仍在，也可以补充个人食物。")).toBeVisible();
  await expect(picker.getByLabel("鸡蛋（水煮全蛋）份量（g）")).toHaveValue("200");

  // A normal navigation keeps the meal-specific draft in memory, not browser storage.
  await page.locator('.mobile-dock, .desktop-rail').getByRole("button", { name: /^历史/ }).filter({ visible: true }).click();
  await page.locator('.mobile-dock, .desktop-rail').getByRole("button", { name: /^饮食/ }).filter({ visible: true }).click();
  await expect(picker.getByLabel("鸡蛋（水煮全蛋）份量（g）")).toHaveValue("200");
  let responseLost = false;
  await page.route("**/api/v1/nutrition/meals/*/food-selections", async (route) => {
    const result = await route.fetch();
    expect(result.status()).toBe(201);
    responseLost = true;
    await route.abort("failed");
  }, { times: 1 });
  await picker.getByRole("button", { name: "加入这顿饭（2项）", exact: true }).click();
  await expect(picker.getByRole("alert")).toContainText("保留");
  expect(responseLost).toBe(true);
  await picker.getByRole("button", { name: "加入这顿饭（2项）", exact: true }).click();
  await expect(meal.locator(".meal-items > li")).toHaveCount(2);
  await expect(meal.locator(".meal-items")).toContainText("310 kcal");
  await expect(meal.locator(".meal-items")).toContainText("17.5 kcal");

  await picker.getByRole("button", { name: "添加食物", exact: true }).click();
  await picker.getByLabel("搜索食物", { exact: true }).fill("");
  await picker.getByLabel("食物分类", { exact: true }).selectOption("all");
  await expect(list.getByRole("listitem").first()).toContainText("鸡蛋（水煮全蛋）");
  await picker.getByRole("button", { name: "取消常用：鸡蛋（水煮全蛋）", exact: true }).click();
  await expect(picker.getByRole("button", { name: "设为常用：鸡蛋（水煮全蛋）", exact: true })).toBeVisible();
  await expect(meal.locator(".meal-items > li")).toHaveCount(2);
  await picker.getByText("找不到？补充个人食物", { exact: true }).click();
  await picker.getByLabel("个人食物名称").fill("未知配菜");
  const personalRequests: string[] = [];
  page.on("request", request => { if (request.url().endsWith("/food-catalog/personal") && request.method() === "POST") personalRequests.push(request.postDataJSON().submissionId); });
  await page.route("**/api/v1/nutrition/food-catalog/personal", async route => {
    const result = await route.fetch();
    expect(result.status()).toBe(201);
    await route.abort("failed");
  }, { times: 1 });
  await picker.getByRole("button", { name: "保存个人食物并选择" }).click();
  await expect(picker.getByRole("alert")).toContainText("不会重复新建");
  await expect(picker.getByLabel("个人食物名称")).toHaveValue("未知配菜");
  await expect(picker.getByLabel("个人食物名称")).toBeDisabled();
  await page.locator('.mobile-dock, .desktop-rail').getByRole("button", { name: /^历史/ }).filter({ visible: true }).click();
  await page.locator('.mobile-dock, .desktop-rail').getByRole("button", { name: /^饮食/ }).filter({ visible: true }).click();
  await picker.getByRole("button", { name: "重试上次保存" }).click();
  expect(personalRequests).toHaveLength(2);
  expect(personalRequests[0]).toBe(personalRequests[1]);
  const catalogResponse = await page.request.get("/api/v1/nutrition/food-catalog?query=未知配菜");
  expect((await catalogResponse.json()).total).toBe(1);
  await expect(picker.getByLabel("未知配菜份量（g）")).toHaveValue("100");
  await picker.getByRole("button", { name: "加入这顿饭（1项）" }).click();
  await expect(meal.locator(".meal-items > li")).toHaveCount(3);
  const unknown = meal.locator(".meal-items > li").filter({ hasText: "未知配菜" });
  await expect(unknown).toContainText("蛋白质 未知");
  await page.reload();
  await expect(meal.locator(".meal-items > li")).toHaveCount(3);
});
