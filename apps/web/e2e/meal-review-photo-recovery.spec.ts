import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { completeSetup } from "./helpers/setup";

const photo = { name: "recover-original.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") };

test("an original photo can be reloaded after temporary failures without reanalyzing or changing food", async ({ page }, info) => {
  if (info.project.name === "mobile-chromium") await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  let available = false, originalRequests = 0;
  await page.route("**/api/v1/image-analyses/*/original", async route => {
    originalRequests++;
    if (available) await route.continue();
    else await route.fulfill({ status: 503, contentType: "text/plain", headers: { "cache-control": "no-store" }, body: "local fake unavailable image" });
  });
  await page.goto("/register");
  await page.getByLabel("用户名").fill(`photo_load_${randomUUID().replaceAll("-", "").slice(0, 17)}`);
  await page.getByLabel("密码", { exact: true }).fill("only fake photo recovery password");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await completeSetup(page);
  const settings = await (await page.request.get("/api/v1/photo-analysis-settings")).json();
  expect((await page.request.put("/api/v1/photo-analysis-settings", { data: { revision: settings.revision, automatic: true, consent: true } })).ok()).toBe(true);
  await page.goto("/nutrition");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "拍照记一餐", exact: true }).click();
  await (await chooser).setFiles(photo);
  await page.getByRole("button", { name: "保存这餐并上传", exact: true }).click();
  await expect(page.locator(".food-item")).toHaveCount(2);
  const review = page.getByRole("region", { name: "照片与当前食物核对", exact: true });
  await expect(review.getByText("照片暂时未能载入，食物记录仍可查看和修改。", { exact: true })).toBeVisible();
  const date = await page.getByLabel("查看日期", { exact: true }).inputValue();
  const mealsUrl = `/api/v1/nutrition/meals?from=${date}&to=${date}`;
  const before = await (await page.request.get(mealsUrl)).json();
  const writes: string[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname.startsWith("/api/v1/") && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(request.method());
  });
  await review.screenshot({ path: info.outputPath("original-photo-load-failed.png") });
  const reload = review.getByRole("button", { name: "重新加载照片", exact: true });
  await expect(reload).toBeVisible({ timeout: 1_000 });
  const failedRequests = originalRequests;
  await reload.click();
  await expect.poll(() => originalRequests).toBeGreaterThan(failedRequests);
  await expect(reload).toBeVisible();
  available = true;
  await reload.click();
  const original = review.getByRole("img", { name: "当前餐食的已保存照片", exact: true });
  await expect.poll(() => original.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1);
  await expect(reload).toHaveCount(0);
  await expect(review.getByText("照片暂时未能载入，食物记录仍可查看和修改。", { exact: true })).toHaveCount(0);
  expect(writes).toEqual([]);
  expect(await (await page.request.get(mealsUrl)).json()).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await review.screenshot({ path: info.outputPath("original-photo-reloaded.png") });
});
