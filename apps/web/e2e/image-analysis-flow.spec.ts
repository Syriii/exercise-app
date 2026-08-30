import { expect, test } from "@playwright/test";

test("a person can turn a meal photo candidate into a corrected nutrition record", async ({ page }, testInfo) => {
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
  await page.getByRole("button", { name: "记一顿" }).click();
  await page.getByLabel("餐次名称（可选）").fill("食堂午饭");
  await page.getByRole("button", { name: "建立餐次" }).click();
  const meal = page.locator("article.meal-card").filter({ hasText: "食堂午饭" });
  await meal.getByLabel("拍照或选图").setInputFiles({
    name: "canteen.png",
    mimeType: "image/png",
    buffer: Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00,
    ]),
  });
  await expect(meal.getByText("canteen.png")).toBeVisible();
  await expect(meal.getByText(/保持原图/)).toBeVisible();
  await meal.getByRole("button", { name: "上传并分析" }).click();
  await expect(page.getByText("照片已上传；没有现有营养值时，分析完成后会先按暂定值计入，之后仍可核对或修正")).toBeVisible();

  const analysis = meal.locator("article.image-analysis-card").filter({ hasText: "食堂鸡腿套餐" });
  await expect(analysis.getByText("暂定计入", { exact: true }).last()).toBeVisible({ timeout: 8_000 });
  await expect(analysis.getByText("照片无法确认烹调油和实际剩余量，请在采用前修正。")).toBeVisible();
  await expect(analysis.getByText("米饭")).toBeVisible();
  await expect(meal.getByText("照片估算，待确认")).toBeVisible();
  await expect(page.getByText("已记录 620 kcal")).toBeVisible();
  await analysis.getByLabel("能量 kcal").fill("590");
  await analysis.getByLabel("脂肪 g").fill("18");
  await analysis.getByRole("button", { name: "确认这些数值" }).click();

  await expect(page.getByText("这份照片估算已确认；修正前的暂定值仍可追溯")).toBeVisible();
  await expect(analysis.getByText("已确认", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("已记录 590 kcal")).toBeVisible();
  await expect(meal.getByText("590 kcal")).toBeVisible();
  await expect(analysis.getByText("这份结果已按你确认的数值计入。原始估算仍保留用于追溯。")).toBeVisible();
});
