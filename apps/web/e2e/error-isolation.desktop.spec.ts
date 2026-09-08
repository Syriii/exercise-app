import { expect, test } from "@playwright/test";

test("a planning failure stays private and does not erase other page sections", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("用户名").fill("desktop_admin");
  await page.getByLabel("密码").fill("operations test password");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/today$/);

  await page.route("**/api/v1/planning/daily-reference**", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        code: "internal_error",
        message: 'Failed query: insert into "daily_planning_references" params: private-user-id',
        requestId: "safe-test-request-id",
      }),
    });
  });

  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "今天还可以吃" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "今天还要练" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("服务器暂时无法处理请求，请稍后重试");
  await expect(page.getByRole("alert")).not.toContainText("Failed query");
  await expect(page.getByRole("alert")).not.toContainText("private-user-id");

  await page.goto("/nutrition");
  await expect(page.getByRole("heading", { name: "当天营养" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "这一天吃了什么" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("服务器暂时无法处理请求，请稍后重试");
  await expect(page.getByRole("alert")).not.toContainText("daily_planning_references");
});

test("a failed date-scoped request never leaves the previous day's meals on screen", async ({ page }) => {
  const previousDate = "2099-12-30";
  const nextDate = "2099-12-31";
  const previousMealName = "只属于前一天的测试餐";

  await page.goto("/login");
  await page.getByLabel("用户名").fill("desktop_admin");
  await page.getByLabel("密码").fill("operations test password");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/today$/);

  await page.route("**/api/v1/nutrition/meals?**", async (route) => {
    const requestedDate = new URL(route.request().url()).searchParams.get("from");
    if (requestedDate === previousDate) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{
          id: "11111111-1111-4111-8111-111111111111",
          occurredAt: `${previousDate}T04:00:00.000Z`,
          localDate: previousDate,
          timeZone: "Asia/Shanghai",
          name: previousMealName,
          note: null,
          revision: 1,
          contributions: [],
          createdAt: `${previousDate}T04:00:00.000Z`,
          updatedAt: `${previousDate}T04:00:00.000Z`,
        }]),
      });
      return;
    }
    if (requestedDate === nextDate) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ code: "internal_error", message: "private database detail" }),
      });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/v1/image-analyses?mealId=11111111-1111-4111-8111-111111111111", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.goto(`/nutrition?date=${previousDate}`);
  await expect(page.getByText(previousMealName)).toBeVisible();

  await page.getByLabel("查看日期").fill(nextDate);
  await page.getByLabel("查看日期").dispatchEvent("change");

  await expect(page).toHaveURL(new RegExp(`/nutrition\\?date=${nextDate}$`));
  await expect(page.getByRole("alert")).toContainText("服务器暂时无法处理请求，请稍后重试");
  await expect(page.getByText(previousMealName)).toHaveCount(0);
  await expect(page.getByText("还没有餐食记录。")).toBeVisible();
});

test("nutrition works without the retired diet-plan, coverage and template-manager paths", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("用户名").fill("desktop_admin");
  await page.getByLabel("密码").fill("operations test password");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/today$/);
  const obsoleteRequests: string[] = [];
  page.on("request", request => {
    if (new RegExp("nutrition/(diet-plans|day-coverage|food-templates)").test(request.url())) obsoleteRequests.push(request.url());
  });
  await page.goto("/nutrition?date=2099-12-28");
  await expect(page.getByRole("heading", { name: "当天营养" })).toBeVisible();
  await expect(page.getByLabel("今天吃过的内容都已记录")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "管理我的常用食物" })).toHaveCount(0);
  await page.getByLabel("查看日期").fill("2099-12-29");
  await page.getByLabel("查看日期").dispatchEvent("change");
  await expect(page).toHaveURL(/date=2099-12-29/);
  await expect(page.getByText("还没有餐食记录。")).toBeVisible();
  expect(obsoleteRequests).toEqual([]);
});
