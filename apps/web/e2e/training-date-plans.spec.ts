import { reveal } from "./helpers/disclosure";
import { completeSetup } from "./helpers/setup";
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const target = { targetSets: 3, targetRepsMin: 10, targetRepsMax: 10, targetWeightKg: "40",
  targetDurationSeconds: null, targetDistanceMeters: null, note: null, exerciseName: "卧推" };
async function setup(page: Page) {
  await page.goto("/register");
  await page.getByLabel("用户名").fill("date_" + randomUUID().replaceAll("-", "").slice(0, 24));
  await page.getByLabel("密码").fill("browser fake date-plan password");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await completeSetup(page);
  await expect(page).toHaveURL(/\/today$/);
  const template = await (await page.request.post("/api/v1/training/templates", { data: { name: "练胸", note: null, items: [target] } })).json();
  const date = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; });
  const schedule = await (await page.request.post("/api/v1/training/schedules", { data: { localDate: date, timeZone: "Asia/Shanghai", title: "当天练胸", note: null,
    sourceTemplateId: template.id, sourceProgramId: null, sourceProgramUnitId: null } })).json();
  await page.goto("/training");
  await expect(page.getByRole("article", { name: "当天计划" })).toContainText("已记录 0／3 组");
  return { schedule, template, date };
}
test("independent dated plan accumulates two post-workout records and recomputes edits and deletes", async ({ page }, info) => {
  const { template } = await setup(page);
  await page.request.put(`/api/v1/training/templates/${template.id}`, { data: { revision: template.revision, name: "来源已改", note: null, items: [{ ...target, exerciseName: "夹胸", targetSets: 8 }] } });
  await page.reload();
  const plan = page.getByRole("article", { name: "当天计划" });
  await expect(plan).toContainText("卧推"); await expect(plan).not.toContainText("夹胸");
  await plan.getByRole("button", { name: "从当天计划记录" }).click();
  await page.getByRole('checkbox', { name: '记录已做：卧推' }).check();
  await expect(page.getByLabel("组数", { exact: true })).toHaveValue("3");
  expect(await (await page.request.get("/api/v1/training/sessions")).json()).toHaveLength(0);
  await page.getByLabel("组数", { exact: true }).fill("2");
  await page.getByRole("button", { name: "保存训练记录", exact: true }).click();
  await expect(plan).toContainText("已记录 2／3 组");
  await plan.getByRole("button", { name: "从当天计划记录" }).click();
  await page.getByRole('checkbox', { name: '记录已做：卧推' }).check();
  await page.getByLabel("组数", { exact: true }).fill("1");
  await page.getByRole("button", { name: "保存训练记录", exact: true }).click();
  await expect(plan).toContainText("已记录 3／3 组");
  await expect(page.getByRole("article", { name: "已存训练记录" })).toHaveCount(2);
  await plan.getByRole("button", { name: "修改当天计划／改期" }).click();
  await page.getByLabel("目标组数", { exact: true }).fill("5");
  await page.locator('.app-main').evaluate(el => el.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: info.outputPath("dated-editor.png"), fullPage: true });
  await page.getByRole("button", { name: "保存当天计划" }).click();
  await expect(plan).toContainText("已记录 3／5 组");
  await page.locator('.app-main').evaluate(el => el.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: info.outputPath("dated-progress.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const records = page.getByRole("article", { name: "已存训练记录" });
  page.once("dialog", dialog => dialog.accept());
  await records.first().getByRole("button", { name: "删除记录", exact: true }).click();
  await expect(records).toHaveCount(1);
  await expect(plan).toContainText("已记录 2／5 组");
  await records.first().getByText("更多", { exact: true }).click();
  page.once("dialog", dialog => dialog.accept("实际内容存为计划"));
  await records.first().getByRole("button", { name: "存为我的计划", exact: true }).click();
  await expect(page.getByText("已存入我的计划，未安排日期；可在计划中继续调整。", { exact: true })).toBeVisible();
  const templates = await (await page.request.get("/api/v1/training/templates")).json();
  const saved = templates.find((item: { name: string }) => item.name === "实际内容存为计划");
  expect(saved.items[0]).toMatchObject({ exerciseName: "卧推", targetSets: 2, targetRepsMin: 10, targetWeightKg: "40" });
  expect(await (await page.request.get("/api/v1/training/schedules")).json()).toHaveLength(1);
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "今天的训练", exact: true })).toBeVisible();
  await expect(page.getByText(/按计划量：0 项完成，1 项部分记录/)).toBeVisible();
});

test("stale linked drafts preserve input and can detach without creating a duplicate record", async ({ page }) => {
  const { schedule } = await setup(page);
  await page.getByRole("button", { name: "从当天计划记录" }).click();
  await page.getByRole('checkbox', { name: '记录已做：卧推' }).check();
  await page.getByLabel("组数", { exact: true }).fill("2");
  const response = await page.request.post(`/api/v1/training/schedules/${schedule.id}/cancel`, { data: { revision: schedule.revision } });
  expect(response.ok()).toBe(true);
  await page.getByRole("button", { name: "保存训练记录", exact: true }).click();
  await expect(page.getByRole("button", { name: "保留实际内容，取消关联后保存" })).toBeVisible();
  await expect(page.getByLabel("组数", { exact: true })).toHaveValue("2");
  expect(await (await page.request.get("/api/v1/training/sessions")).json()).toHaveLength(0);
  await page.getByRole("button", { name: "保留实际内容，取消关联后保存" }).click();
  await page.getByRole("button", { name: "保存训练记录", exact: true }).click();
  await expect(page.getByRole("article", { name: "已存训练记录" })).toHaveCount(1);
  const records = await (await page.request.get("/api/v1/training/sessions")).json();
  expect(records[0].items[0].planLink).toBeNull();
});

test("rescheduling leaves facts in place and copying last actual content drops the old association", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "从当天计划记录" }).click();
  await page.getByRole('checkbox', { name: '记录已做：卧推' }).check();
  await page.getByRole("button", { name: "保存训练记录", exact: true }).click();
  await expect(page.getByRole("article", { name: "当天计划" })).toContainText("已记录 3／3 组");
  await page.getByRole("button", { name: "修改当天计划／改期" }).click();
  await reveal(page.getByLabel("安排日期"));
  await page.getByLabel("安排日期").fill("2027-01-01");
  await page.getByRole("button", { name: "保存当天计划" }).click();
  await expect(page.getByRole("article", { name: "当天计划" })).toContainText("已记录 0／3 组");
  await expect(page.getByRole("article", { name: "已存训练记录" })).toHaveCount(0);
  await page.getByRole("button", { name: "记录训练内容", exact: true }).click();
  await page.getByText("参考计划或上次内容", { exact: true }).click();
  await page.getByRole("button", { name: "使用上次实际内容" }).click();
  await page.getByRole("button", { name: "保存训练记录", exact: true }).click();
  await expect(page.getByRole("article", { name: "当天计划" })).toContainText("已记录 0／3 组");
  const records = await (await page.request.get("/api/v1/training/sessions")).json();
  expect(records).toHaveLength(2); expect(records.find((r: { localDate: string }) => r.localDate === "2027-01-01").items[0].planLink).toBeNull();
});
