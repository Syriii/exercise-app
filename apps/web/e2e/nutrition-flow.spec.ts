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
  await expect(page.getByText("完成的训练和保存的饮食会按日期出现在这里。")).toBeVisible();
  await expect(page.getByRole("region", { name: "90 天概览" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "回到今天" })).toBeVisible();
});

test("a person can record, correct, and review a meal without treating unknown nutrients as zero", async ({ page }, testInfo) => {
  const projectKey = testInfo.project.name === "mobile-chromium" ? "m" : "d";
  await page.goto("/register");
  await page.getByLabel("用户名").fill(`nutrition_${projectKey}_${Date.now()}`);
  await page.getByLabel("密码").fill("a browser-only secure password");
  await page.getByRole("button", { name: "注册" }).click();
  await expect(page).toHaveURL(/\/today$/);

  await page.goto("/settings");
  const profile = page.getByRole("region", { name: "个人档案" });
  await profile.getByLabel("出生日期").fill("2004-08-26");
  await profile.getByLabel("能量公式分类").selectOption("female");
  await profile.getByLabel("身高（cm）").fill("165");
  await profile.getByLabel("平常活动档位").selectOption("low_active");
  await profile.getByRole("button", { name: "保存个人档案" }).click();
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
  await expect(page.getByText("本项有未知值")).toBeVisible();
  await expect(meal.getByText("脂肪 未知")).toBeVisible();
  await expect(meal.getByRole("combobox", { name: /我的常用项/ })).toContainText("米饭");

  await meal.getByRole("button", { name: "修正" }).click();
  await meal.getByLabel("能量 kcal").fill("250");
  await meal.getByRole("button", { name: "保存修正" }).click();
  await expect(page.getByText("已记录 250 kcal")).toBeVisible();
  await expect(page.getByText("营养记录已修正，旧值仍可追溯")).toBeVisible();

  const foodSearch = meal.getByRole("region", { name: "从常用和最近记录中找" });
  await foodSearch.getByLabel("食物或菜名").fill("米饭");
  await foodSearch.getByRole("button", { name: "搜索", exact: true }).click();
  const personalResult = foodSearch.getByRole("listitem").filter({ hasText: "我的常用" });
  await personalResult.getByRole("button", { name: "带入" }).click();
  await expect(meal.getByLabel("能量 kcal")).toHaveValue("232");
  await expect(page.getByText("已记录 250 kcal")).toBeVisible();

  await page.goto("/history");
  await page.locator(".history-filters").getByRole("button", { name: "饮食", exact: true }).click();
  const datedHistory = page.getByLabel("按日期排列的训练与饮食历史");
  const trends = page.getByRole("region", { name: "90 天概览" });
  await expect(datedHistory).toBeVisible();
  await expect(datedHistory.getByText("饮食 · 1 顿")).toBeVisible();
  await expect(trends.getByText("1 天")).toBeVisible();
  await expect(trends.getByText("250 kcal")).toBeVisible();
  await expect(trends.getByText("5.2 g")).toBeVisible();
  await expect(trends.getByText("63 kg")).toBeVisible();
  await expect(datedHistory.getByText("250 kcal", { exact: true })).toBeVisible();
  await expect(page.getByText("仅汇总已经填写的数值；未知营养不会按 0 计算。")).toBeVisible();
  const datedHistoryBox = await datedHistory.boundingBox();
  const trendsBox = await trends.boundingBox();
  expect(datedHistoryBox).not.toBeNull();
  expect(trendsBox).not.toBeNull();
  expect(trendsBox!.y).toBeGreaterThan(datedHistoryBox!.y + datedHistoryBox!.height - 1);
  await page.getByRole("button", { name: "查看或修正" }).click();
  await expect(page).toHaveURL(/\/nutrition\?date=/);
  await expect(page.locator("article.meal-card").filter({ hasText: "米饭" })).toBeVisible();
});
