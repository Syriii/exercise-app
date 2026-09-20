import { reveal } from "./helpers/disclosure";
import { expect, test, type Page } from "@playwright/test";
import { completeSetup } from "./helpers/setup";
import { randomUUID } from "node:crypto";

async function register(page: Page, suffix: string) {
  await page.goto("/register");
  await page.getByLabel("用户名").fill(`redesign_${suffix}_${Date.now()}`);
  await page.getByLabel("密码", { exact: true }).fill("only fake browser test password");
}
async function selectedBreakfast(page: Page) {
  await page.goto("/nutrition?date=2026-09-20");
  await page.getByRole("button", { name: "手动添加食物", exact: true }).click();
  const composer = page.getByRole("region", { name: "快速记餐" });
  await reveal(composer.getByLabel("餐次名称（可选）"));
  await composer.getByLabel("餐次名称（可选）").fill("手选早餐");
  const picker = composer.getByRole("region", { name: "添加食物", exact: true });
  await picker.getByLabel("搜索食物", { exact: true }).fill("豆浆(无糖)");
  await picker.getByRole("button", { name: "搜索", exact: true }).click();
  await picker.getByRole("button", { name: "选择：豆浆(无糖)", exact: true }).click();
  await picker.getByLabel("豆浆(无糖)份量（g）").fill("250");
  return { composer, picker };
}

test("registration keeps optional photo consent explicit and recovers settings failure without registering twice", async ({ page }, info) => {
  await register(page, info.project.name[0]!);
  await expect(page.getByLabel("拍照后自动识别（可选）")).not.toBeChecked();
  let registrations = 0;
  page.on("request", req => { if (req.method() === "POST" && req.url().endsWith("/auth/register")) registrations++; });
  await page.getByLabel("拍照后自动识别（可选）").check();
  await expect(page.getByLabel("我了解并同意上述照片发送范围")).not.toBeChecked();
  await page.getByLabel("我了解并同意上述照片发送范围").check();
  await page.route("**/photo-analysis-settings", async route => {
    if (route.request().method() === "PUT") { await route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"fake unavailable"}' }); await page.unroute("**/photo-analysis-settings"); }
    else await route.continue();
  });
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("账号已创建");
  await page.getByRole("button", { name: "继续进入", exact: true }).click();
  await completeSetup(page);
  expect(registrations).toBe(1);
  const settings = await (await page.request.get("/api/v1/photo-analysis-settings")).json();
  expect(settings.automatic).toBe(true);
  expect(settings.consentAt).not.toBeNull();
  await page.goto("/nutrition");
  await expect(page.getByText("拍照识别设置", { exact: true })).toHaveCount(0);
  await page.goto("/settings/preferences");
  await expect(page.getByText("拍照识别设置", { exact: true })).toBeVisible();
});

test("manual selection creates no empty meal on dismiss, preserves portions, and exposes collapsed meal deletion", async ({ page }, info) => {
  await register(page, info.project.name[0]!);
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await completeSetup(page);
  const { composer, picker } = await selectedBreakfast(page);
  const meals = () => page.request.get("/api/v1/nutrition/meals?from=2026-09-20&to=2026-09-20").then(r => r.json());
  expect(await meals()).toEqual([]);
  await composer.getByRole("button", { name: "收起", exact: true }).click();
  expect(await meals()).toEqual([]);
  await page.getByRole("button", { name: "手动添加食物", exact: true }).click();
  await expect(picker.getByLabel("豆浆(无糖)份量（g）")).toHaveValue("250");
  await page.screenshot({ animations: "disabled", path: info.outputPath("manual-food-picker.png") });
  const originalViewport = page.viewportSize()!;
  for (const width of [320, 375, 414]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    const bounds = await composer.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    const overflow = await page.locator(".quick-meal-panel, .view-stack, .app-main, .food-picker, .catalog-search, .catalog-selection, .catalog-selection-row").evaluateAll(nodes => nodes.map(node => ({ name: node.className, width: node.getBoundingClientRect().width, right: node.getBoundingClientRect().right, columns: getComputedStyle(node).gridTemplateColumns, min: getComputedStyle(node).minWidth })));
    expect(bounds!.x + bounds!.width, JSON.stringify(overflow)).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize(originalViewport);
  await picker.getByRole("button", { name: "加入这顿饭（1项）", exact: true }).click();
  const card = page.locator(".meal-card");
  await expect(card.locator(".food-item")).toHaveCount(1);
  expect((await meals()).length).toBe(1);
  await card.getByRole("button", { name: "收起餐食", exact: true }).click();
  await page.screenshot({ animations: "disabled", path: info.outputPath("meal-card.png") });
  await expect(card.getByRole("button", { name: "删除整顿", exact: true })).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await card.getByRole("button", { name: "删除整顿", exact: true }).click();
  await expect(card).toHaveCount(0);
  expect(await meals()).toEqual([]);
});

test("a failed food save reuses the already-created meal on retry", async ({ page }, info) => {
  await register(page, info.project.name[0]!);
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await completeSetup(page);
  const { picker } = await selectedBreakfast(page);
  await page.route("**/food-selections", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"fake save failure"}' }), { times: 1 });
  await picker.getByRole("button", { name: "加入这顿饭（1项）", exact: true }).click();
  await expect(picker.getByRole("alert")).toBeVisible();
  await picker.getByRole("button", { name: "加入这顿饭（1项）", exact: true }).click();
  await expect(page.locator(".meal-card .food-item")).toHaveCount(1);
  const meals = await (await page.request.get("/api/v1/nutrition/meals?from=2026-09-20&to=2026-09-20")).json();
  expect(meals).toHaveLength(1);
  expect(meals[0].contributions).toHaveLength(1);
});

test("a lost meal-creation response stops duplication and lets the user continue in the recovered meal", async ({ page }, info) => {
  await register(page, info.project.name[0]!);
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await completeSetup(page);
  const { composer, picker } = await selectedBreakfast(page);
  let creations = 0;
  await page.route("**/api/v1/nutrition/meals", async route => {
    if (route.request().method() !== "POST") return route.continue();
    creations++;
    await route.fetch();
    await route.abort();
  });
  await picker.getByRole("button", { name: "加入这顿饭（1项）", exact: true }).click();
  await expect(composer.getByText("建立结果待确认，不会自动重复建立。")).toBeVisible();
  await expect(picker.getByRole("button", { name: "加入这顿饭（1项）", exact: true })).toBeDisabled();
  page.once("dialog", dialog => dialog.accept());
  await composer.getByRole("button", { name: "重新读取餐食列表" }).click();
  await composer.getByRole("button", { name: /^继续添加到 手选早餐/ }).click();
  await picker.getByRole("button", { name: "加入这顿饭（1项）", exact: true }).click();
  await expect(page.locator(".meal-card .food-item")).toHaveCount(1);
  expect(creations).toBe(1);
});

test("camera and gallery are separate, selecting then cancelling preserves the attachment", async ({ page }, info) => {
  await page.addInitScript(() => {
    const original = window.createImageBitmap.bind(window);
    window.createImageBitmap = async (image: ImageBitmapSource) => {
      await new Promise<void>(resolve => { (window as Window & { releasePreparedPhoto?: () => void }).releasePreparedPhoto = resolve; });
      return original(image);
    };
  });
  await register(page, info.project.name[0]!);
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await completeSetup(page);
  await page.goto("/nutrition");
  await page.getByRole("button", { name: "相册记一餐", exact: true }).click();
  const composer = page.getByRole("region", { name: "快速记餐" });
  const gallery = composer.getByLabel("从相册选择餐食照片", { exact: true });
  await expect(gallery).not.toHaveAttribute("capture");
  await expect(composer.getByLabel("拍摄餐食照片", { exact: true })).toHaveAttribute("capture", "environment");
  await gallery.setInputFiles({ name: "gallery.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") });
  await expect(page.getByText("正在准备照片，请稍候…")).toBeVisible();
  await expect(composer.getByRole("button", { name: "建立餐次", exact: true })).toBeDisabled();
  await page.evaluate(() => (window as Window & { releasePreparedPhoto?: () => void }).releasePreparedPhoto?.());
  await expect(composer.getByRole("img", { name: "待上传的餐食照片" })).toBeVisible();
  await gallery.setInputFiles([]);
  await expect(composer.getByText("gallery.png", { exact: true })).toBeVisible();
  await composer.getByRole("button", { name: "移除待上传照片" }).click();
  await expect(composer.getByRole("img", { name: "待上传的餐食照片" })).toHaveCount(0);
});

test("body chart uses only actual measurements and my page keeps body recording prominent", async ({ page }, info) => {
  await register(page, info.project.name[0]!);
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await completeSetup(page);
  for (const [date, weight] of [["2026-09-01", 70], ["2026-09-08", 69.8]] as const) {
    const saved = await page.request.put(`/api/v1/planning/measurements/${randomUUID()}`, { data: { revision: 0, localDate: date, measuredAt: `${date}T04:00:00.000Z`, timeZone: "Asia/Shanghai", weightKg: weight, waistCm: null, note: null } });
    expect(saved.ok()).toBe(true);
  }
  await page.goto("/history?tab=trends&metric=body&from=2026-09-01&to=2026-09-20");
  await expect(page.locator(".body-trend-chart circle")).toHaveCount(2);
  await expect(page.locator(".body-trend-chart")).toContainText("不补算中间日期");
  await expect(page.locator(".measurement-list > li")).toHaveCount(2);
  await page.screenshot({ animations: "disabled", path: info.outputPath("body-trend.png") });
  await page.goto("/settings");
  await expect(page.getByRole("button", { name: /身体数据/ })).toContainText("69.8 kg");
  await page.screenshot({ animations: "disabled", path: info.outputPath("my-body.png") });
});
