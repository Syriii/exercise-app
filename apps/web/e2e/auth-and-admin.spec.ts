import { expect, test } from "@playwright/test";

test("a person can register and reach today's view", async ({ page }, testInfo) => {
  await page.goto("/register");
  const projectKey = testInfo.project.name === "mobile-chromium" ? "m" : "d";
  await page.getByLabel("用户名").fill(`friend_${projectKey}_${Date.now()}`);
  await page.getByLabel("密码").fill("a browser-only secure password");
  await page.getByRole("button", { name: "注册" }).click();

  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("heading", { name: "今天", exact: true })).toBeVisible();
});

test("an administrator can inspect runtime health", async ({ page }, testInfo) => {
  const username = testInfo.project.name === "mobile-chromium" ? "mobile_admin" : "desktop_admin";
  await page.goto("/login");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill("operations test password");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await page.goto("/admin");

  await expect(page.getByRole("heading", { name: "运行状态" })).toBeVisible();
  await expect(page.getByText("PostgreSQL")).toBeVisible();
  await expect(page.getByText("尚未确认")).toBeVisible();
  await expect(page.getByText("test-vision-model")).toBeVisible();
  await expect(page.getByText("最近备份")).toBeVisible();
  await expect(page.getByText("还需异机演练")).toBeVisible();
});

test("an administrator can issue a one-time password without seeing it again", async ({ page }, testInfo) => {
  const projectKey = testInfo.project.name === "mobile-chromium" ? "m" : "d";
  const username = `reset_${projectKey}_${Date.now()}`;
  const originalPassword = "original friend password";
  const temporaryPassword = "one-time friend password";
  await page.goto("/register");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(originalPassword);
  await page.getByRole("button", { name: "注册" }).click();
  await expect(page).toHaveURL(/\/today$/);

  await page.context().clearCookies();
  await page.goto("/login");
  const adminUsername = testInfo.project.name === "mobile-chromium" ? "mobile_admin" : "desktop_admin";
  await page.getByLabel("用户名").fill(adminUsername);
  await page.getByLabel("密码").fill("operations test password");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await page.goto("/admin");

  const account = page.locator(".account-row").filter({ hasText: username });
  await account.getByRole("button", { name: "设置临时密码" }).click();
  await account.getByLabel(`为 ${username} 设置临时密码`).fill(temporaryPassword);
  await account.getByRole("button", { name: "确认设置并退出旧会话" }).click();
  await expect(page.getByRole("status")).toContainText("下次登录必须改密");
  await expect(account.getByLabel(`为 ${username} 设置临时密码`)).toHaveCount(0);

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(temporaryPassword);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/account\/password$/);
  await expect(page.getByRole("heading", { name: "修改密码" })).toBeVisible();
});
