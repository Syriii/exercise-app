import { expect, test } from "@playwright/test";

test("photo foods count automatically and can be scaled and reused independently", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const projectKey = testInfo.project.name === "mobile-chromium" ? "m" : "d";
  await page.goto("/register");
  await page.getByLabel("用户名").fill(`image_${projectKey}_${Date.now()}`);
  await page.getByLabel("密码").fill("a browser-only secure password");
  await page.getByRole("button", { name: "注册" }).click();
  await expect(page).toHaveURL(/\/today$/);

  await page.goto("/settings/profile");
  const profile = page.getByRole("region", { name: "基础资料" });
  await profile.getByLabel("出生日期").fill("2000-08-26");
  await profile.getByLabel("性别").selectOption("male");
  await profile.getByLabel("身高（cm）").fill("175");
  await profile.getByLabel("日常活动水平").selectOption("low_active");
  await profile.getByRole("button", { name: "保存基础资料" }).click();
  await page.goto("/settings/measurement");
  const measurements = page.getByRole("region", { name: "身体测量" });
  await measurements.getByLabel("体重（kg）").fill("70");
  await measurements.getByRole("button", { name: "记录这次测量" }).click();

  await page.goto("/nutrition");
  await page.getByRole("button", { name: "快速记餐" }).click();
  await page.getByLabel("餐次名称（可选）").fill("食堂午饭");
  await page.getByLabel("餐食照片（可选）").setInputFiles({
    name: "canteen.png",
    mimeType: "image/png",
    buffer: Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00,
    ]),
  });
  await expect(page.getByText("canteen.png")).toBeVisible();
  await expect(page.getByText(/保持原图/)).toBeVisible();
  await page.getByRole("button", { name: "建立餐次并上传" }).click();
  const meal = page.locator("article.meal-card").filter({ hasText: "食堂午饭" });
  await expect(page.getByText("照片已上传；识别完成后会按食物计入，你可以直接修改份量。已有记录不会被覆盖")).toBeVisible();

  const analysis = meal.locator("article.image-analysis-card").filter({ hasText: "食堂鸡腿套餐" });
  await expect(analysis.getByText("照片估算", { exact: true }).last()).toBeVisible({ timeout: 8_000 });
  await expect(analysis.getByRole("button", { name: "确认这些数值" })).toHaveCount(0);
  const items = meal.locator(".meal-items > li");
  await expect(items).toHaveCount(2);
  const rice = items.filter({ hasText: "米饭" });
  const chicken = items.filter({ hasText: "鸡腿" });
  await expect(page.getByText("已记录 620 kcal")).toBeVisible();
  await rice.getByRole("button", { name: "改份量" }).click();
  await rice.getByLabel("米饭份量（g）").fill("100");
  let failOnce = true;
  await page.route("**/contributions/*/portion", async (route) => {
    if (failOnce) {
      failOnce = false;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "test_failure", message: "测试保存失败" }) });
    } else await route.continue();
  });
  await rice.getByRole("button", { name: "保存份量" }).click();
  await expect(rice.getByRole("alert")).toBeVisible();
  await expect(rice.getByLabel("米饭份量（g）")).toHaveValue("100");
  await rice.getByRole("button", { name: "保存份量" }).click();
  await expect(page.getByText("已记录 500 kcal")).toBeVisible();
  await expect(rice.getByText(/120 kcal/)).toBeVisible();
  await expect(chicken.getByText(/380 kcal/)).toBeVisible();
  await rice.getByRole("button", { name: "设为常用" }).click();
  await expect(page.getByText("已设为常用，下次可以单独添加这项食物")).toBeVisible();
  await page.getByRole("button", { name: "快速记餐" }).click();
  await page.getByLabel("餐次名称（可选）").fill("复用晚饭");
  await page.getByRole("button", { name: "建立餐次", exact: true }).click();
  const dinner = page.locator("article.meal-card").filter({ hasText: "复用晚饭" });
  await dinner.getByRole("combobox", { name: "我的常用项", exact: true }).selectOption({ label: "米饭" });
  const form = dinner.locator(".contribution-form");
  await form.getByLabel("份量", { exact: true }).fill("50");
  await form.getByRole("button", { name: "计入这顿饭" }).click();
  await expect(dinner.locator(".meal-items > li")).toHaveCount(1);
  await expect(dinner.locator(".meal-items").getByText(/60 kcal/)).toBeVisible();
  await expect(rice.getByText(/120 kcal/)).toBeVisible();
  await expect(page.getByText("已记录 560 kcal")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await chicken.getByRole("button", { name: "移除" }).click();
  await expect(items).toHaveCount(1);
  await expect(page.getByText("已记录 180 kcal")).toBeVisible();
  await rice.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("photo-food-items.png") });
});

test("a failed quick photo upload keeps one meal and can retry without duplication", async ({ page }, testInfo) => {
  const projectKey = testInfo.project.name === "mobile-chromium" ? "m" : "d";
  await page.goto("/register");
  await page.getByLabel("用户名").fill(`image_retry_${projectKey}_${Date.now()}`);
  await page.getByLabel("密码").fill("a browser-only secure password");
  await page.getByRole("button", { name: "注册" }).click();
  await expect(page).toHaveURL(/\/today$/);

  let failedOnce = false;
  await page.route("**/api/v1/image-analyses?**", async (route) => {
    if (route.request().method() === "POST" && !failedOnce) {
      failedOnce = true;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: "image_analysis_unavailable", message: "temporary test failure" }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/nutrition");
  await page.getByRole("button", { name: "快速记餐" }).click();
  await page.getByLabel("餐次名称（可选）").fill("上传重试餐");
  await page.getByLabel("餐食照片（可选）").setInputFiles({
    name: "retry.png",
    mimeType: "image/png",
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  });
  await page.getByRole("button", { name: "建立餐次并上传" }).click();

  const meal = page.locator("article.meal-card").filter({ hasText: "上传重试餐" });
  await expect(page.getByText("服务器暂时无法处理请求，请稍后重试")).toBeVisible();
  await expect(page.locator("article.meal-card")).toHaveCount(1);
  await expect(meal.getByText("retry.png")).toBeVisible();
  await meal.getByRole("button", { name: "上传并分析" }).click();
  await expect(page.getByText("照片已上传；识别完成后会按食物计入，你可以直接修改份量。已有记录不会被覆盖")).toBeVisible();
  await expect(page.locator("article.meal-card")).toHaveCount(1);
});
