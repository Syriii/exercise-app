import { expect, test } from "@playwright/test";

test("an empty history page shows one useful state instead of an empty trend report", async ({ page }, testInfo) => {
  const projectKey = testInfo.project.name === "mobile-chromium" ? "m" : "d";
  await page.goto("/register");
  await page.getByLabel("用户名").fill(`history_empty_${projectKey}_${Date.now()}`);
  await page.getByLabel("密码").fill("a browser-only secure password");
  await page.getByRole("button", { name: "注册" }).click();
  await expect(page).toHaveURL(/\/today$/);

  await page.goto("/history");
  await expect(page.getByText("最近 90 天还没有记录")).toBeVisible();
  await expect(page.getByText("完成的训练、保存的饮食和身体测量会按日期出现在这里。")).toBeVisible();
  await expect(page.getByRole("region", { name: "90 天概览" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "回到今天" })).toBeVisible();
});

test("today opens nutrition with the quick meal form ready", async ({ page }, testInfo) => {
  const projectKey = testInfo.project.name === "mobile-chromium" ? "m" : "d";
  await page.goto("/register");
  await page.getByLabel("用户名").fill(`quick_meal_${projectKey}_${Date.now()}`);
  await page.getByLabel("密码").fill("a browser-only secure password");
  await page.getByRole("button", { name: "注册" }).click();
  await expect(page).toHaveURL(/\/today$/);

  await page.getByRole("button", { name: "去记一顿" }).click();
  await expect(page).toHaveURL(/\/nutrition/);
  await expect(page.getByRole("region", { name: "快速记餐" })).toBeVisible();
  await expect(page.getByLabel("餐次名称（可选）")).toBeFocused();
});

test("a body measurement is a first-class history record", async ({ page }, testInfo) => {
  const projectKey = testInfo.project.name === "mobile-chromium" ? "m" : "d";
  await page.goto("/register");
  await page.getByLabel("用户名").fill(`measurement_history_${projectKey}_${Date.now()}`);
  await page.getByLabel("密码").fill("a browser-only secure password");
  await page.getByRole("button", { name: "注册" }).click();
  await expect(page).toHaveURL(/\/today$/);

  await page.goto("/settings/measurement");
  const measurements = page.getByRole("region", { name: "身体测量" });
  await measurements.getByLabel("体重（kg）").fill("63");
  await measurements.getByLabel("腰围（cm，可选）").fill("72");
  await measurements.getByRole("button", { name: "记录这次测量" }).click();

  await page.goto("/history");
  await expect(page.getByText("最近 90 天还没有记录")).toHaveCount(0);
  const datedHistory = page.getByLabel("按日期排列的训练、饮食与身体测量历史");
  await expect(datedHistory.getByText("身体测量 · 1 条")).toBeVisible();
  await expect(datedHistory.getByText("63 kg")).toBeVisible();
  await expect(datedHistory.getByText("腰围 72 cm")).toBeVisible();
  await page.locator(".history-filters").getByRole("button", { name: "测量", exact: true }).click();
  await expect(datedHistory.getByText("1 条测量")).toBeVisible();
});

test("a person can reuse matching foods, search public products, and manage common foods", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const projectKey = testInfo.project.name === "mobile-chromium" ? "m" : "d";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayDate = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(yesterday);
  await page.goto("/register");
  await page.getByLabel("用户名").fill(`food_reuse_${projectKey}_${Date.now()}`);
  await page.getByLabel("密码").fill("a browser-only secure password");
  await page.getByRole("button", { name: "注册" }).click();
  await expect(page).toHaveURL(/\/today$/);

  await page.goto(`/nutrition?date=${yesterdayDate}`);
  await page.getByRole("button", { name: "记一顿" }).click();
  await page.getByLabel("餐次名称（可选）").fill("早餐");
  await page.getByRole("button", { name: "建立餐次" }).click();
  const yesterdayMeal = page.locator("article.meal-card").filter({ hasText: "早餐" });
  const addFood = async (label: string, portion: string, unit: string, energy: string, saveAsCommon: boolean) => {
    await yesterdayMeal.getByLabel("名称").fill(label);
    await yesterdayMeal.getByLabel("份量").fill(portion);
    await yesterdayMeal.getByLabel("单位").fill(unit);
    await yesterdayMeal.getByLabel("能量 kcal").fill(energy);
    if (saveAsCommon) await yesterdayMeal.getByLabel("保存到“我的常用项”").check();
    await yesterdayMeal.getByRole("button", { name: "计入这顿饭" }).click();
    await expect(yesterdayMeal.locator(".meal-items").getByText(label, { exact: true })).toBeVisible();
  };
  await addFood("包子", "1", "个", "230", false);
  await addFood("鸡蛋", "2", "个", "140", true);
  await addFood("豆浆", "1", "碗", "90", true);

  await page.goto("/nutrition");
  await page.getByRole("button", { name: "记一顿" }).click();
  await page.getByLabel("餐次名称（可选）").fill("早餐");
  await page.getByRole("button", { name: "建立餐次" }).click();
  const todayMeal = page.locator("article.meal-card").filter({ hasText: "早餐" });
  const yesterdayGroup = todayMeal.locator("details.recent-meal-card").filter({ hasText: "昨天 · 早餐" });
  await yesterdayGroup.getByRole("checkbox", { name: /鸡蛋/ }).check();
  await yesterdayGroup.getByRole("checkbox", { name: /豆浆/ }).check();
  await yesterdayGroup.getByRole("button", { name: "加入选中的 2 项" }).click();
  const todayItems = todayMeal.locator(".meal-items");
  await expect(todayItems.getByText("鸡蛋", { exact: true })).toBeVisible();
  await expect(todayItems.getByText("豆浆", { exact: true })).toBeVisible();
  await expect(todayItems.getByText("包子", { exact: true })).toHaveCount(0);

  const publicFoodSearch = todayMeal.getByRole("region", { name: "搜索个人记录和公开包装食品" });
  await publicFoodSearch.getByLabel("食物或菜名").fill("豆奶");
  await publicFoodSearch.getByRole("button", { name: "搜索", exact: true }).click();
  const publicResults = publicFoodSearch.getByRole("region", { name: "公开包装食品结果" });
  await expect(publicResults.getByText("原浆豆奶", { exact: true })).toBeVisible();
  await expect(publicResults.getByText("Open Food Facts · ODbL")).toBeVisible();
  await publicResults.getByLabel("原浆豆奶实际重量（g）").fill("250");
  await publicResults.getByRole("button", { name: "按这个重量带入" }).press("Enter");
  await expect(todayMeal.getByLabel("份量")).toHaveValue("250");
  await expect(todayMeal.getByLabel("能量 kcal")).toHaveValue("155");
  await expect(todayMeal.getByLabel("蛋白质 g")).toHaveValue("15");
  await expect(todayMeal.getByLabel("估算基准")).toHaveValue(/Open Food Facts.*6907992515960.*250 g/);
  await todayMeal.getByRole("button", { name: "计入这顿饭" }).click();
  await expect(todayItems.getByText("原浆豆奶（示例品牌）", { exact: true })).toBeVisible();

  await todayMeal.getByLabel("名称").fill("夹馍");
  await todayMeal.getByLabel("份量").fill("1");
  await todayMeal.getByLabel("单位").fill("个");
  await todayMeal.getByLabel("能量 kcal").fill("420");
  await todayMeal.getByRole("button", { name: "计入这顿饭" }).click();
  await expect(todayItems.getByText("夹馍", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "记一顿" }).click();
  await page.getByLabel("餐次名称（可选）").fill("加餐");
  await page.getByRole("button", { name: "建立餐次" }).click();
  const snack = page.locator("article.meal-card").filter({ hasText: "加餐" });
  await snack.getByRole("button", { name: "直接加入豆浆" }).click();
  await expect(snack.locator(".meal-items").getByText("豆浆", { exact: true })).toBeVisible();

  const manager = page.getByRole("region", { name: "管理我的常用食物" });
  await manager.getByRole("button", { name: "管理常用食物" }).click();
  const eggTemplate = manager.locator(".template-manager-list > li").filter({ hasText: "鸡蛋" });
  await eggTemplate.getByRole("button", { name: "编辑" }).click();
  const eggEditForm = manager.locator(".template-edit-form");
  await eggEditForm.getByLabel("名称").fill("水煮蛋");
  await eggEditForm.getByRole("button", { name: "保存常用食物" }).click();
  await expect(manager.getByText("水煮蛋", { exact: true })).toBeVisible();
  const soyTemplate = manager.locator(".template-manager-list > li").filter({ hasText: "豆浆" });
  page.once("dialog", (dialog) => dialog.accept());
  await soyTemplate.getByRole("button", { name: "删除" }).click();
  await expect(manager.locator(".template-manager-list > li").filter({ hasText: "豆浆" })).toHaveCount(0);
  await expect(snack.locator(".meal-items").getByText("豆浆", { exact: true })).toBeVisible();
});

test("a person can record, correct, and review a meal without treating unknown nutrients as zero", async ({ page }, testInfo) => {
  const projectKey = testInfo.project.name === "mobile-chromium" ? "m" : "d";
  await page.goto("/register");
  await page.getByLabel("用户名").fill(`nutrition_${projectKey}_${Date.now()}`);
  await page.getByLabel("密码").fill("a browser-only secure password");
  await page.getByRole("button", { name: "注册" }).click();
  await expect(page).toHaveURL(/\/today$/);

  await page.goto("/settings/profile");
  const profile = page.getByRole("region", { name: "基础资料" });
  await profile.getByLabel("出生日期").fill("2004-08-26");
  await profile.getByLabel("性别").selectOption("female");
  await profile.getByLabel("身高（cm）").fill("165");
  await profile.getByLabel("日常活动水平").selectOption("low_active");
  await profile.getByRole("button", { name: "保存基础资料" }).click();
  await page.goto("/settings/measurement");
  const measurements = page.getByRole("region", { name: "身体测量" });
  await measurements.getByLabel("体重（kg）").fill("63");
  await measurements.getByRole("button", { name: "记录这次测量" }).click();

  await page.goto("/nutrition");
  const dietPlan = page.getByRole("region", { name: "我的饮食安排" });
  await dietPlan.getByRole("button", { name: "新建安排" }).click();
  await dietPlan.getByLabel("名称").fill("这周食堂安排");
  await dietPlan.getByLabel("整体原则（可选）").fill("每餐先选蔬菜和蛋白质，再按饥饿程度取主食");
  await dietPlan.getByRole("button", { name: "添加餐次或食物安排" }).click();
  await dietPlan.getByLabel("餐次（可选）").fill("午饭");
  await dietPlan.getByLabel("准备怎么吃").fill("米饭一份、荤菜一份、青菜一份");
  await dietPlan.getByRole("button", { name: "保存饮食安排" }).click();
  await expect(page.getByText("饮食安排已保存")).toBeVisible();
  await expect(dietPlan.getByText("这周食堂安排")).toBeVisible();
  await expect(dietPlan.getByText("米饭一份、荤菜一份、青菜一份")).toBeVisible();

  await page.getByRole("button", { name: "记一顿" }).click();
  await page.getByLabel("餐次名称（可选）").fill("午饭");
  await page.getByRole("button", { name: "建立餐次" }).click();
  const meal = page.locator("article.meal-card").filter({ hasText: "午饭" });
  await meal.getByLabel("名称").fill("米饭");
  await meal.getByLabel("份量").fill("200");
  await meal.getByLabel("能量 kcal").fill("232");
  await meal.getByLabel("蛋白质 g").fill("5.2");
  await meal.getByLabel("碳水 g").fill("51.8");
  await meal.getByLabel("保存到“我的常用项”").check();
  await meal.getByRole("button", { name: "计入这顿饭" }).click();

  await expect(page.getByText("已记录 232 kcal")).toBeVisible();
  await expect(page.getByText("有未知值")).toBeVisible();
  await expect(meal.getByText("脂肪 未知")).toBeVisible();
  await expect(meal.getByRole("combobox", { name: /我的常用项/ })).toContainText("米饭");

  await meal.getByRole("button", { name: "修正" }).click();
  await meal.getByLabel("能量 kcal").fill("250");
  await meal.getByRole("button", { name: "保存修正" }).click();
  await expect(page.getByText("已记录 250 kcal")).toBeVisible();
  await expect(page.getByText("营养记录已修正，旧值仍可追溯")).toBeVisible();

  const foodSearch = meal.getByRole("region", { name: "搜索个人记录和公开包装食品" });
  await foodSearch.getByLabel("食物或菜名").fill("米饭");
  await foodSearch.getByRole("button", { name: "搜索", exact: true }).click();
  const personalResult = foodSearch.getByRole("listitem").filter({ hasText: "我的常用" });
  await personalResult.getByRole("button", { name: "调整后加入" }).click();
  await expect(meal.getByLabel("能量 kcal")).toHaveValue("232");
  await expect(page.getByText("已记录 250 kcal")).toBeVisible();

  await page.goto("/history");
  await page.locator(".history-filters").getByRole("button", { name: "饮食", exact: true }).click();
  const datedHistory = page.getByLabel("按日期排列的训练、饮食与身体测量历史");
  const trends = page.getByRole("region", { name: "90 天概览" });
  await expect(datedHistory).toBeVisible();
  await expect(datedHistory.getByText("饮食 · 1 顿")).toBeVisible();
  await expect(trends.getByText("1 天")).toBeVisible();
  await expect(trends.getByText("250 kcal")).toBeVisible();
  await expect(trends.getByText("5.2 g")).toBeVisible();
  await expect(trends.getByText("63 kg")).toBeVisible();
  await expect(datedHistory.getByText("250 kcal", { exact: true })).toBeVisible();
  await expect(page.getByText("只汇总已经填写的营养数值。")).toBeVisible();
  const datedHistoryBox = await datedHistory.boundingBox();
  const trendsBox = await trends.boundingBox();
  expect(datedHistoryBox).not.toBeNull();
  expect(trendsBox).not.toBeNull();
  expect(trendsBox!.y).toBeGreaterThan(datedHistoryBox!.y + datedHistoryBox!.height - 1);
  await page.getByRole("button", { name: "查看或修正" }).click();
  await expect(page).toHaveURL(/\/nutrition\?date=/);
  await expect(page.locator("article.meal-card").filter({ hasText: "米饭" })).toBeVisible();
});
