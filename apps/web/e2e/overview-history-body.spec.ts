import { reveal } from "./helpers/disclosure";
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { completeSetup } from "./helpers/setup";
async function register(page: Page) {
  await page.goto("/register");
  await page.getByLabel("用户名").fill("body_" + randomUUID().replaceAll("-", "").slice(0, 22));
  await page.getByLabel("密码").fill("a browser fake body password");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/setup$/);
}
test("mandatory setup resumes persisted steps and unknown values never become measurements", async ({ page }, info) => {
  await register(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("基础资料");
  await expect(page.getByLabel('身高（cm）')).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: info.outputPath('setup-profile.png') });
  await expect(page.getByRole("button", { name: "以后再设置" })).toHaveCount(0);
  await page.getByLabel("身高（cm）").fill("172");
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("身体数据");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("身体数据");
  await page.goto("/history");
  await expect(page).toHaveURL(/\/settings\/setup$/);
  await completeSetup(page);
  expect(await (await page.request.get("/api/v1/planning/measurements")).json()).toEqual([]);
  const profile = await (await page.request.get("/api/v1/planning/profile")).json();
  expect(profile).toMatchObject({ heightCm: 172, birthDate: null, sexCategory: null });
  for (const kind of ["training", "nutrition", "measurement"]) expect((await (await page.request.get(`/api/v1/reminders/${kind}/settings?timeZone=Asia%2FShanghai`)).json()).enabled).toBe(false);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("我的");
  await expect(page.getByRole("button", { name: "按步骤检查" })).toHaveCount(0);
});
test("body corrections preserve actual time, retry safely, and return to filtered history after deletion", async ({ page }, info) => {
  await register(page); await completeSetup(page);
  await page.goto("/settings/measurement");
  await page.getByLabel("测量日期", { exact: true }).fill("2026-09-10");
  await page.getByLabel("体重（kg）", { exact: true }).fill("70");
  let lose = true;
  await page.route("**/api/v1/planning/measurements/*", async route => {
    if (route.request().method() === "PUT" && lose) { lose = false; const response = await route.fetch(); expect(response.ok()).toBe(true); await route.fulfill({ status: 503, contentType: "application/json", body: '{"code":"test_lost_response"}' }); }
    else await route.continue();
  });
  await page.getByRole("button", { name: "记录这次测量" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "记录这次测量" }).click();
  await expect(page.getByRole("status")).toContainText("身体测量已记录");
  const first = await (await page.request.get("/api/v1/planning/measurements")).json();
  expect(first).toHaveLength(1);
  await page.getByLabel("测量日期", { exact: true }).fill("2026-08-01");
  await page.getByLabel("体重（kg）", { exact: true }).fill("80");
  await reveal(page.getByLabel("腰围（cm，可选）", { exact: true }));
  await page.getByLabel("腰围（cm，可选）", { exact: true }).fill("85");
  await page.getByRole("button", { name: "记录这次测量" }).click();
  await expect(page.locator('.body-summary > div').filter({ hasText: '当前体重' })).toContainText('70 kg');
  await expect(page.locator('.body-summary > div').filter({ hasText: '当前体重' })).toContainText('2026-09-10');
  await expect(page.locator('.body-summary > div').filter({ hasText: '当前腰围' })).toContainText('85 cm');
  await expect(page.locator('.body-summary > div').filter({ hasText: '当前腰围' })).toContainText('2026-08-01');
  await page.goto("/history?filter=measurement&from=2026-08-01&to=2026-09-16&date=2026-09-10");
  await page.getByRole("button", { name: "查看／修正身体记录" }).click();
  await expect(page.getByLabel("测量日期", { exact: true })).toHaveValue("2026-09-10");
  await reveal(page.getByLabel("备注（可选）", { exact: true }));
  await page.getByLabel("备注（可选）", { exact: true }).fill("只改备注");
  await page.getByRole("button", { name: "保存修正", exact: true }).click();
  await expect(page).toHaveURL(/\/history\?/);
  expect((await (await page.request.get("/api/v1/planning/measurements")).json())[0].measuredAt).toBe(first[0].measuredAt);
  await expect(page.getByRole("button", { name: "身体", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("定位日期")).toHaveValue("2026-09-10");
  await page.getByRole("button", { name: "查看／修正身体记录" }).click();
  page.once("dialog", dialog => dialog.accept());
  await page.locator(".measurement-list li").filter({ hasText: "2026-09-10" }).getByRole("button", { name: "删除", exact: true }).click();
  await expect(page).toHaveURL(/\/history\?/);
  await expect(page.getByText("这段时间没有符合筛选的记录。")).toBeVisible();
  await page.getByRole("button", { name: "趋势", exact: true }).click();
  await expect(page.getByRole("heading", { name: "身体趋势" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("body-history.png"), fullPage: true });
});
test("today shows four recorded nutrients and opens the shared photo composer", async ({ page }, info) => {
  await register(page); await completeSetup(page);
  await expect(page.getByRole("heading", { name: "今天已记录的饮食" })).toBeVisible();
  await expect(page.locator(".balance-panel dt")).toHaveText(["已记录能量", "蛋白质", "碳水化合物", "脂肪"]);
  await expect(page.getByText("今天还可以吃", { exact: true })).toHaveCount(0);
  await expect(page.locator(".view-stack > section")).toHaveCount(2);
  await page.screenshot({ path: info.outputPath("today-empty.png"), fullPage: true });
  await page.getByRole("button", { name: "拍照记一餐", exact: true }).click();
  await expect(page.getByRole('region', { name: '快速记餐' }).locator('.compact-metadata summary')).toContainText('修改信息');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("body drafts survive navigation and history returns to the same scroll position", async ({ page }) => {
  await register(page); await completeSetup(page);
  await page.goto("/settings/measurement");
  await page.getByLabel("体重（kg）", { exact: true }).fill("72");
  await page.getByRole("button", { name: /^今天/ }).click();
  await page.getByRole("button", { name: /^我的/ }).click();
  await page.getByRole("button", { name: /身体数据/ }).click();
  await expect(page.getByLabel("体重（kg）", { exact: true })).toHaveValue("72");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "记录新测量", exact: true }).click();
  await expect(page.getByLabel("体重（kg）", { exact: true })).toHaveValue("72");
  // Explicitly discard the unsaved value before opening a saved historical record.
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "记录新测量", exact: true }).click();
  for (let day = 1; day <= 18; day++) {
    const date = `2026-08-${String(day).padStart(2, "0")}`;
    expect((await page.request.put(`/api/v1/planning/measurements/${randomUUID()}`, { data: { revision: 0, localDate: date, measuredAt: `${date}T04:00:00.000Z`, timeZone: "Asia/Shanghai", weightKg: 70, waistCm: null, note: null } })).ok()).toBe(true);
  }
  await page.goto("/history?filter=measurement&from=2026-08-01&to=2026-08-31");
  await expect(page.getByRole("button", { name: "查看／修正身体记录" })).toHaveCount(18);
  const target = page.getByRole("button", { name: "查看／修正身体记录" }).nth(8);
  await target.scrollIntoViewIfNeeded();
  await target.click();
  await expect(page.getByRole("button", { name: "取消修正", exact: true })).toBeVisible();
  const returnPath = new URL(page.url()).searchParams.get("returnTo")!;
  const scroll = Number(new URL(returnPath, page.url()).searchParams.get("scroll"));
  expect(scroll).toBeGreaterThan(100);
  await page.getByRole("button", { name: "取消修正", exact: true }).click();
  await expect(page).toHaveURL(/\/history\?/);
  await expect.poll(() => page.locator(".app-main").evaluate((element, expected) => Math.abs(Math.max(element.scrollTop, window.scrollY) - expected), scroll)).toBeLessThan(3);
});
