import { expect, test } from "@playwright/test";

test("a person can create an evidence-backed daily nutrition reference", async ({ page }, testInfo) => {
  const projectKey = testInfo.project.name === "mobile-chromium" ? "m" : "d";
  await page.goto("/register");
  await page.getByLabel("用户名").fill(`planning_${projectKey}_${Date.now()}`);
  await page.getByLabel("密码").fill("a browser-only secure password");
  await page.getByRole("button", { name: "注册" }).click();
  await expect(page).toHaveURL(/\/today$/);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "基础资料" })).toBeVisible();
  const profile = page.getByRole("region", { name: "基础资料" });
  await profile.getByText("出生日期", { exact: true }).click();
  await expect(profile.getByLabel("出生日期")).toBeFocused();
  await profile.getByLabel("出生日期").fill("2004-08-26");
  await profile.getByLabel("性别").selectOption("female");
  await profile.getByLabel("身高（cm）").fill("165");
  await profile.getByLabel("日常活动水平").selectOption("low_active");
  await page.getByRole("button", { name: "下一步" }).click();

  const measurements = page.getByRole("region", { name: "身体测量" });
  await measurements.getByLabel("体重（kg）").fill("63");
  await measurements.getByLabel("腰围（cm，可选）").fill("72");
  await page.getByRole("button", { name: "下一步" }).click();

  const strategy = page.getByRole("region", { name: "目标与营养" });
  await strategy.getByLabel("维持体重").check();
  await strategy.getByLabel("均衡分配").check();
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByRole("region", { name: "训练提醒" })).toBeVisible();
  await page.getByRole("button", { name: "完成设置" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("region", { name: "设置项目" })).toContainText("63 kg");

  await page.goto("/nutrition");
  const dailyReference = page.getByRole("region", { name: "系统参考" });
  await expect(dailyReference.getByRole("heading", { name: "系统参考" })).toBeVisible();
  await expect(dailyReference.getByRole("definition").filter({ hasText: /^2275 kcal$/ })).toBeVisible();
  const remaining = page.getByRole("region", { name: "还可以吃" });
  await expect(remaining.getByRole("definition").filter({ hasText: /^2275 kcal$/ })).toBeVisible();
  await expect(remaining.getByText("尚未记录餐食").first()).toBeVisible();
  await dailyReference.getByText("计算依据", { exact: true }).click();
  await expect(page.getByText("方法 daily-reference-2026-08-26.1")).toBeVisible();
  await expect(page.getByText("这是群体方程形成的饮食规划参考，不是个人代谢测量。")).toBeVisible();

  await page.goto("/settings/measurement");
  await page.getByRole("button", { name: "修正" }).click();
  await page.getByLabel("体重（kg）").fill("64");
  await page.getByRole("button", { name: "保存修正" }).click();
  await expect(page.getByText("误录的身体测量已修正，旧值仍可追溯。")).toBeVisible();
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "今天还可以吃" })).toBeVisible();
  const measurementDate = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  await expect(page.getByText(`采用 ${measurementDate} 的体重`)).toBeVisible();
});
