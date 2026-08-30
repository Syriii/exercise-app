import { expect, test } from "@playwright/test";

test("a person can turn an evidence-backed system suggestion into their own plan", async ({ page }, testInfo) => {
  const projectKey = testInfo.project.name === "mobile-chromium" ? "m" : "d";
  await page.goto("/register");
  await page.getByLabel("用户名").fill(`suggest_${projectKey}_${Date.now()}`);
  await page.getByLabel("密码").fill("a browser-only secure password");
  await page.getByRole("button", { name: "注册" }).click();
  await expect(page).toHaveURL(/\/today$/);

  await page.goto("/settings/profile");
  const profile = page.getByRole("region", { name: "基础资料" });
  await profile.getByLabel("出生日期").fill("1995-05-01");
  await profile.getByLabel("性别").selectOption("male");
  await profile.getByLabel("身高（cm）").fill("175");
  await profile.getByLabel("日常活动水平").selectOption("low_active");
  await profile.getByRole("button", { name: "保存基础资料" }).click();

  await page.goto("/training");
  const suggestionPanel = page.getByRole("region", { name: "帮我排一份" });
  await suggestionPanel.getByRole("button", { name: "填写条件" }).click();
  await suggestionPanel.getByLabel("主要目标").selectOption("hypertrophy");
  await suggestionPanel.getByLabel("每周可练几天").fill("3");
  await suggestionPanel.getByRole("button", { name: "按这些条件生成" }).click();

  await expect(suggestionPanel.getByText("全身训练草案", { exact: true })).toBeVisible();
  await suggestionPanel.getByRole("button", { name: "动作预览" }).first().click();
  await expect(suggestionPanel.getByRole("region", { name: /动作预览/ }).first()).toBeVisible();
  await suggestionPanel.getByText("适用范围和依据").click();
  await expect(suggestionPanel.getByText("E-013、E-014")).toBeVisible();
  await suggestionPanel.getByRole("button", { name: "存成单次方案" }).click();

  await expect(page.getByRole("status")).toContainText("已经存到单次方案");
  await expect(page.getByRole("heading", { name: "全身训练草案" })).toBeVisible();
  await expect(suggestionPanel.getByText("先看一遍动作和训练量，不合适就改。保存后才会成为你的方案。")).toHaveCount(0);
});
