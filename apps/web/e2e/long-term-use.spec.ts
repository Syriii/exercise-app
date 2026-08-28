import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

async function register(page: import("@playwright/test").Page, username: string, password: string) {
  await page.goto("/register");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "注册" }).click();
  await expect(page).toHaveURL(/\/today$/);
}

test("a person can manage independent reminders and download a private JSON export", async ({ page }, testInfo) => {
  const projectKey = testInfo.project.name === "mobile-chromium" ? "m" : "d";
  await register(page, `long_${projectKey}_${Date.now()}`, "long-term browser password");
  await page.goto("/settings");

  const nutritionReminder = page.getByRole("region", { name: "饮食提醒" });
  await nutritionReminder.getByRole("checkbox").check();
  await nutritionReminder.getByLabel("提醒时间").fill("19:30");
  await nutritionReminder.getByRole("button", { name: "保存饮食提醒" }).click();
  await expect(page.getByRole("status")).toContainText("饮食提醒已开启");

  const measurementReminder = page.getByRole("region", { name: "身体测量提醒" });
  await measurementReminder.getByLabel("间隔天数").fill("14");
  await measurementReminder.getByRole("button", { name: "保存测量提醒" }).click();
  await expect(page.getByRole("status")).toContainText("每 14 天");

  await page.reload();
  await expect(nutritionReminder.getByRole("checkbox")).toBeChecked();
  await expect(nutritionReminder.getByLabel("提醒时间")).toHaveValue("19:30");
  await expect(measurementReminder.getByLabel("间隔天数")).toHaveValue("14");

  const dataSection = page.getByRole("region", { name: "我的数据" });
  await dataSection.getByRole("button", { name: "准备 JSON 导出" }).click();
  await expect(dataSection.getByText("导出已完成")).toBeVisible({ timeout: 10_000 });

  const downloadPromise = page.waitForEvent("download");
  await dataSection.getByRole("link", { name: "下载 JSON" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const exported = JSON.parse(await readFile(path!, "utf8")) as Record<string, unknown>;
  expect(exported).toMatchObject({
    schemaVersion: "exercise-app-user-export-v1",
    lifecycle: { includesOriginalPhotos: false, excludesCredentialsAndSessions: true },
  });
  const serialized = JSON.stringify(exported);
  expect(serialized).not.toContain("passwordHash");
  expect(serialized).not.toContain("sessionToken");
  expect(serialized).not.toContain("objectKey");
});

test("a person can copy and download a privacy-limited problem report", async ({ context, page }, testInfo) => {
  const projectKey = testInfo.project.name === "mobile-chromium" ? "m" : "d";
  const username = `report_${projectKey}_${Date.now()}`;
  const testOrigin = new URL(String(testInfo.project.use.baseURL)).origin;
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: testOrigin });
  await register(page, username, "problem report browser password");
  await page.goto("/settings");

  const reportSection = page.getByRole("region", { name: "问题报告" });
  await reportSection.getByLabel("发生了什么（可选）").fill("上传一张午餐照片后，页面没有显示新的候选结果。");
  await reportSection.getByRole("button", { name: "生成问题报告" }).click();
  await expect(reportSection.getByRole("status")).toContainText("报告已生成");

  const reportText = await reportSection.getByLabel("报告预览").inputValue();
  expect(reportText).toContain("EXERCISE APP 问题报告");
  expect(reportText).toContain("上传一张午餐照片后");
  expect(reportText).toContain("服务端：可用");
  expect(reportText).toContain("[近期前端事件");
  expect(reportText).not.toContain(username);
  expect(reportText).not.toContain("problem report browser password");

  await reportSection.getByRole("button", { name: "复制报告" }).click();
  await expect(reportSection.getByRole("status")).toContainText("已复制");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(reportText);

  const downloadPromise = page.waitForEvent("download");
  await reportSection.getByRole("button", { name: "下载 .txt" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^exercise-app-problem-report-.*\.txt$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(await readFile(path!, "utf8")).toBe(reportText);
});

test("account deletion requires explicit confirmation and immediately ends the session", async ({ page }, testInfo) => {
  const projectKey = testInfo.project.name === "mobile-chromium" ? "m" : "d";
  const username = `delete_${projectKey}_${Date.now()}`;
  const password = "account deletion browser password";
  await register(page, username, password);
  await page.goto("/settings");

  const dataSection = page.getByRole("region", { name: "我的数据" });
  await dataSection.getByLabel("输入当前用户名").fill(username);
  await dataSection.getByLabel("当前密码").fill(password);
  await dataSection.getByRole("checkbox", { name: /我理解这是整个账号的永久删除/ }).check();
  await dataSection.getByRole("button", { name: "永久删除我的账号" }).click();

  await expect(page).toHaveURL(/\/login\?accountDeletion=requested$/);
  await expect(page.getByRole("status")).toContainText("账号删除请求已提交");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
