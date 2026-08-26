import { expect, test } from "@playwright/test";

test("the preset administrator must change the initial password", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("administrator test password");
  await page.getByRole("button", { name: "登录" }).click();

  await expect(page.getByRole("heading", { name: "修改密码" })).toBeVisible();
  await page.getByLabel("当前密码").fill("administrator test password");
  await page.getByLabel("新密码", { exact: true }).fill("new administrator browser password");
  await page.getByLabel("再输入一次").fill("new administrator browser password");
  await page.getByRole("button", { name: "保存新密码" }).click();

  await expect(page).toHaveURL(/\/today$/);
});
