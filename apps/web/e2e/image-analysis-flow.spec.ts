import { expect, test, type Page } from "@playwright/test";
import { addPersonalFood, createMeal } from "./helpers/nutrition";

async function enableAutomaticPhotos(page: Page) {
  await page.getByText("拍照识别设置", { exact: true }).click();
  await page.getByLabel("拍照后自动识别", { exact: true }).check();
  await page.getByLabel("我了解并同意上述照片发送范围").check();
  await page.getByRole("button", { name: "保存识别设置" }).click();
  await expect(page.getByText("已保存，仅影响后续上传的照片。")).toBeVisible();
}

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
  await enableAutomaticPhotos(page);
  await page.getByRole("button", { name: "拍照记一餐" }).click();
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
  await page.getByRole("button", { name: "拍照记一餐" }).click();
  await page.getByLabel("餐次名称（可选）").fill("复用晚饭");
  await page.getByRole("button", { name: "建立餐次", exact: true }).click();
  const dinner = page.locator("article.meal-card").filter({ hasText: "复用晚饭" });
  const picker = dinner.getByRole("region", { name: "添加食物", exact: true });
  await picker.getByRole("button", { name: "添加食物", exact: true }).click();
  await picker.getByRole("button", { name: "选择：米饭", exact: true }).click();
  await picker.getByLabel("米饭份量（g）").fill("50");
  await picker.getByRole("button", { name: "加入这顿饭（1项）", exact: true }).click();
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
  await enableAutomaticPhotos(page);
  await page.getByRole("button", { name: "拍照记一餐" }).click();
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
  await meal.getByRole("button", { name: "上传并识别" }).click();
  await expect(page.getByText("照片已上传；识别完成后会按食物计入，你可以直接修改份量。已有记录不会被覆盖")).toBeVisible();
  await expect(page.locator("article.meal-card")).toHaveCount(1);
});

test("manual photo recognition previews a partial replacement, retries safely and restores the original foods", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/register");
  await page.getByLabel("用户名").fill(`photo_control_${testInfo.project.name[0]}_${Date.now()}`);
  await page.getByLabel("密码").fill("a browser-only secure password");
  await page.getByRole("button", { name: "注册" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await page.goto("/nutrition");
  const meal = await createMeal(page, "替换早餐");
  await addPersonalFood(meal, "原有主食", "100", "g", { energy: "200" });
  await addPersonalFood(meal, "保留豆浆", "200", "ml", { energy: "80" });
  await meal.getByRole("button", { name: "照片与识别" }).click();
  await meal.getByLabel("拍照或选图", { exact: true }).setInputFiles({ name: "breakfast.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) });
  await meal.getByRole("button", { name: "上传照片", exact: true }).click();
  const analysis = meal.locator("article.image-analysis-card").first();
  await expect(analysis.getByRole("button", { name: "识别这张照片" })).toBeVisible();
  await expect(meal.locator(".meal-items > li")).toHaveCount(2);
  await enableAutomaticPhotos(page);
  // Enabling automation must not silently submit a previously saved photo.
  await expect(analysis.getByRole("button", { name: "识别这张照片" })).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await analysis.getByRole("button", { name: "识别这张照片" }).click();
  await expect(analysis.getByRole("button", { name: "预览并使用这份结果" })).toBeVisible({ timeout: 8_000 });
  await expect(meal.locator(".meal-items > li")).toHaveCount(2);
  await analysis.getByRole("button", { name: "预览并使用这份结果" }).click();
  const preview = analysis.getByRole("form", { name: "照片结果替换预览" });
  await preview.getByLabel(/保留豆浆/).uncheck();
  await expect(preview.getByText(/替换 1 项，保留 1 项/)).toBeVisible();
  let failOnce = true;
  await page.route("**/replace-foods", async route => {
    if (failOnce) { failOnce = false; await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "test_failure", message: "测试保存失败" }) }); }
    else await route.continue();
  });
  await preview.getByRole("button", { name: "使用照片食物并保存" }).click();
  await expect(analysis.getByRole("alert")).toBeVisible();
  await expect(preview.getByLabel(/保留豆浆/)).not.toBeChecked();
  await expect(meal.locator(".meal-items > li")).toHaveCount(2);
  await preview.getByRole("button", { name: "使用照片食物并保存" }).click();
  await expect(meal.locator(".meal-items > li")).toHaveCount(3);
  await expect(meal.locator(".meal-items").getByText("保留豆浆", { exact: true })).toBeVisible();
  await expect(meal.locator(".meal-items").getByText("原有主食", { exact: true })).toHaveCount(0);
  await page.reload();
  await meal.getByRole("button", { name: "打开餐食", exact: true }).click();
  await meal.getByRole("button", { name: "照片与识别" }).click();
  page.once("dialog", dialog => dialog.accept());
  await analysis.getByRole("button", { name: "撤销这次结果替换" }).click();
  await expect(meal.locator(".meal-items > li")).toHaveCount(2);
  await expect(meal.locator(".meal-items").getByText("原有主食", { exact: true })).toBeVisible();
  await expect(analysis.getByRole("button", { name: "预览并使用这份结果" })).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await analysis.getByRole("button", { name: "重新识别这张照片" }).click();
  await expect(meal.locator("article.image-analysis-card")).toHaveCount(2);
  await expect(meal.locator("article.image-analysis-card").first().getByRole("button", { name: "预览并使用这份结果" })).toBeVisible({ timeout: 8_000 });
  await expect(meal.locator(".meal-items > li")).toHaveCount(2);
  const latest = meal.locator("article.image-analysis-card").first();
  await latest.getByRole("button", { name: "预览并使用这份结果" }).click();
  const latestPreview = latest.getByRole("form", { name: "照片结果替换预览" });
  await addPersonalFood(meal, "后来补的水果", "100", "g");
  await latestPreview.getByRole("button", { name: "使用照片食物并保存" }).click();
  await expect(latest.getByRole("alert")).toBeVisible();
  await latestPreview.getByRole("button", { name: "重新查看当前内容" }).click();
  await expect(latestPreview.getByLabel(/后来补的水果/)).toBeChecked();
  await latestPreview.getByLabel(/后来补的水果/).uncheck();
  await latestPreview.getByRole("button", { name: "使用照片食物并保存" }).click();
  await expect(meal.locator(".meal-items > li")).toHaveCount(3);
  await expect(meal.locator(".meal-items").getByText("后来补的水果", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("photo-replacement-restored.png") });
});
