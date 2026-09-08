import { expect, test } from "@playwright/test";
import { addPersonalFood, createMeal } from "./helpers/nutrition";

test.beforeEach(async ({ page }, info) => {
  await page.goto("/register");
  await page.getByLabel("用户名").fill(`diet_simple_${info.project.name[0]}_${Date.now()}`);
  await page.getByLabel("密码").fill("browser-only diet test password");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page).toHaveURL(/today$/);
  await page.goto("/nutrition?date=2026-09-06");
});

test("meals open on demand; metadata drafts survive failure and navigation, and moving a meal updates both days", async ({ page }, info) => {
  const meal = await createMeal(page, "待调整早餐");
  await addPersonalFood(meal, "自制豆浆", "250", "g", { energy: "80" });
  await page.reload();
  await expect(meal.getByRole("button", { name: "打开餐食", exact: true })).toBeVisible();
  await expect(meal.locator(".contribution-form")).toHaveCount(0);
  await expect(meal.getByRole("region", { name: "添加食物", exact: true })).not.toBeVisible();
  await meal.getByRole("button", { name: "打开餐食", exact: true }).click();
  await meal.getByRole("button", { name: "修改餐食信息", exact: true }).click();
  const form = meal.getByRole("form", { name: "修改餐食信息", exact: true });
  await form.getByLabel("餐食说明").fill("只喝了一半，份量已经按实际填写");
  await form.getByLabel("餐食日期").fill("2026-09-07");
  await page.route("**/api/v1/nutrition/meals/*", async route => {
    if (route.request().method() !== "PUT") return route.continue();
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "test_unavailable" }) });
  }, { times: 1 });
  await form.getByRole("button", { name: "保存餐食信息" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(form.getByLabel("餐食日期")).toHaveValue("2026-09-07");
  const nav = page.locator(".mobile-dock, .desktop-rail");
  await nav.getByRole("button", { name: /^历史/ }).filter({ visible: true }).click();
  await nav.getByRole("button", { name: /^饮食/ }).filter({ visible: true }).click();
  await expect(form.getByLabel("餐食说明")).toHaveValue("只喝了一半，份量已经按实际填写");
  await form.getByRole("button", { name: "保存餐食信息" }).click();
  await expect(page.getByText("餐食已移至 2026-09-07，原日期不再重复计入")).toBeVisible();
  await expect(page.locator(".meal-card")).toHaveCount(0);
  await expect(page.getByText("已记录 0 kcal", { exact: true })).toBeVisible();
  await page.getByLabel("查看日期").fill("2026-09-07");
  await page.getByLabel("查看日期").dispatchEvent("change");
  await expect(page.locator(".meal-card")).toHaveCount(1);
  await expect(page.getByText("已记录 80 kcal", { exact: true })).toBeVisible();
  if (info.project.name === "mobile-chromium") {
    await page.locator(".app-main").evaluate(element => { element.scrollTop = 0; });
    const photo = await page.getByRole("button", { name: "拍照记一餐", exact: true }).boundingBox();
    const dock = await page.locator(".mobile-dock").boundingBox();
    expect(photo!.y + photo!.height).toBeLessThan(dock!.y);
    await page.screenshot({ path: "/tmp/exercise-b2-diet-mobile.png", animations: "disabled" });
  }
});

test("expired original images never promise retry and food details still work", async ({ page }) => {
  const meal = await createMeal(page, "原图到期餐食");
  const mealId = (await meal.getAttribute("id"))!.slice(5);
  await page.route(`**/api/v1/image-analyses?mealId=${mealId}`, async route => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{
      id: "11111111-1111-4111-8111-111111111111", mealId, status: "failed", model: "fake-test-model", promptVersion: "test",
      candidate: null, lastErrorCode: "deepseek_timeout", imageAvailable: false, adoptedAt: null, revision: 1, attempts: [],
      createdAt: "2026-09-06T00:00:00Z", updatedAt: "2026-09-06T00:00:00Z",
    }]) });
  });
  await page.reload();
  await meal.getByRole("button", { name: "打开餐食", exact: true }).click();
  await meal.getByRole("button", { name: "照片与识别", exact: true }).click();
  await expect(meal.getByText("原图已不可用，请重新选择照片；已有食物记录不受影响。")).toBeVisible();
  await expect(meal.getByRole("button", { name: "重新分析", exact: true })).toHaveCount(0);
  await expect(meal.getByText(/原图仍在/)).toHaveCount(0);
  await addPersonalFood(meal, "手动补记的青菜");
  await expect(page.getByText("已记录 未知", { exact: true }).first()).toBeVisible();
});

test("reopening a photo draft keeps the attachment visible and removable", async ({ page }) => {
  await page.getByRole("button", { name: "拍照记一餐", exact: true }).click();
  const composer = page.getByRole("region", { name: "快速记餐", exact: true });
  await composer.getByLabel("餐次名称（可选）").fill("保留的草稿");
  await composer.getByLabel("餐食照片（可选）").setInputFiles({ name: "draft.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) });
  await expect(composer.getByText(/draft.png/)).toBeVisible();
  await composer.getByRole("button", { name: "收起", exact: true }).click();
  await page.getByRole("group", { name: "记录餐食" }).getByRole("button", { name: "添加食物", exact: true }).click();
  await expect(composer.getByText(/draft.png/)).toBeVisible();
  await expect(composer.getByLabel("餐次名称（可选）")).toHaveValue("保留的草稿");
  await composer.getByRole("button", { name: "移除待上传照片" }).click();
  await expect(composer.getByRole("button", { name: "建立餐次", exact: true })).toBeVisible();
  await expect(composer.getByText(/draft.png/)).toHaveCount(0);
});

test("opening another correction never replaces unsaved nutrition values", async ({ page }) => {
  const meal = await createMeal(page, "修正草稿");
  await addPersonalFood(meal, "鸡蛋", "100", "g", { energy: "120" });
  await addPersonalFood(meal, "豆浆", "250", "g", { energy: "80" });
  const egg = meal.locator(".food-item").filter({ has: page.locator("strong", { hasText: /^鸡蛋$/ }) });
  const soy = meal.locator(".food-item").filter({ has: page.locator("strong", { hasText: /^豆浆$/ }) });
  await egg.getByRole("button", { name: "修正", exact: true }).click();
  const correction = meal.getByRole("form", { name: "修正食物", exact: true });
  await correction.getByLabel("能量 kcal").fill("130");
  await soy.getByRole("button", { name: "修正", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("请先保存或取消");
  await expect(correction.getByLabel("食物名称")).toHaveValue("鸡蛋");
  await expect(correction.getByLabel("能量 kcal")).toHaveValue("130");
  await egg.getByRole("button", { name: "修正", exact: true }).click();
  await expect(correction.getByLabel("能量 kcal")).toHaveValue("130");
  await correction.getByRole("button", { name: "保存修正" }).click();
  await expect(egg).toContainText("130 kcal");
});
