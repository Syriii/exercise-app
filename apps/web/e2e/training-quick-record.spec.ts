import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { completeSetup } from "./helpers/setup";
import { reveal } from "./helpers/disclosure";
import { minutesToSeconds, shiftActivityDecimal } from "../src/features/training/activity-units";

test("activity conversions preserve decimal distances and unknown quantities", () => {
  expect(minutesToSeconds("")).toBe("");
  expect(minutesToSeconds("30.5")).toBe("1830");
  expect(minutesToSeconds("1.1")).toBe("66");
  expect(minutesToSeconds("0.001")).toBe("0.06");
  expect(minutesToSeconds(".5")).toBe("30");
  expect(shiftActivityDecimal("1.001", 3)).toBe("1001");
  expect(shiftActivityDecimal("2345.678", -3)).toBe("2.345678");
  expect(shiftActivityDecimal("2.345678", 3)).toBe("2345.678");
  expect(shiftActivityDecimal("", 3)).toBe("");
});

test.beforeEach(async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("用户名").fill(`quick_${randomUUID().replaceAll("-", "").slice(0, 20)}`);
  await page.getByLabel("密码", { exact: true }).fill("fake quick training password");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await completeSetup(page);
});

test("actions can be selected consecutively and minutes and kilometers save exact base units", async ({ page }, info) => {
  await page.goto("/training");
  await page.getByRole("button", { name: "记录训练内容", exact: true }).click();
  const sources = page.getByRole("group", { name: "训练记录来源" });
  for (const name of ["自选动作", "当天计划", "已有计划", "上次实际内容"]) await expect(sources.getByRole("button", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "添加动作：深蹲", exact: true }).click();
  await page.getByRole("button", { name: "添加动作：跑步", exact: true }).click();
  await page.getByRole("button", { name: "添加动作：拉伸", exact: true }).click();
  await expect(page.getByRole("button", { name: "添加动作：深蹲", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "完成选择，核对数量（3）", exact: true }).click();
  const actions = page.getByRole("region", { name: "动作填写" });
  await expect(actions.first().locator(".action-title")).toBeFocused();
  await expect(actions.first().getByLabel("组数", { exact: true })).toHaveValue("");
  await expect(actions.nth(1).getByLabel("时长（分钟）", { exact: true })).toHaveValue("");
  await expect(actions.nth(1).getByLabel("距离（公里）", { exact: true })).toHaveValue("");
  expect(await (await page.request.get("/api/v1/training/sessions")).json()).toEqual([]);
  await actions.first().getByLabel("组数", { exact: true }).fill("2");
  await actions.first().getByLabel("每组次数").fill("10");
  await actions.nth(1).getByLabel("时长（分钟）", { exact: true }).pressSequentially("30.5", {delay:15});
  await actions.nth(1).getByLabel("距离（公里）", { exact: true }).pressSequentially("1.001", {delay:15});
  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await actions.nth(1).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`quick-training-${width}.png`), animations: "disabled" });
  }
  await page.getByRole("button", { name: "保存训练记录", exact: true }).click();
  await expect(page.getByText("这次训练已保存。", { exact: true })).toBeVisible();
  const records = await (await page.request.get("/api/v1/training/sessions")).json();
  expect(records).toHaveLength(1);
  expect(records[0].items[1].sets[0]).toMatchObject({ durationSeconds: 1830, distanceMeters: "1001" });
  expect(records[0].items[2].sets).toEqual([]);
  await reveal(page.getByRole("button", { includeHidden: true, name: "修改整条记录", exact: true }));
  await page.getByRole("button", { name: "修改整条记录", exact: true }).click();
  const run = page.getByRole("region", { name: "动作填写" }).nth(1);
  await run.getByLabel("时长单位", { exact: true }).selectOption("seconds");
  await expect(run.getByLabel("时长（秒）", { exact: true })).toHaveValue("1830");
  await run.getByLabel("时长（秒）", { exact: true }).fill("95");
  await run.getByLabel("距离单位", { exact: true }).selectOption("meters");
  await run.getByLabel("距离（米）", { exact: true }).fill("2345.678");
  await page.getByRole("button", { name: "保存训练记录", exact: true }).click();
  await expect(page.getByText("这次训练已保存。", { exact: true })).toBeVisible();
  await reveal(page.getByRole("button", { includeHidden: true, name: "修改整条记录", exact: true }));
  await page.getByRole("button", { name: "修改整条记录", exact: true }).click();
  await expect(run.getByLabel("时长（秒）", { exact: true })).toHaveValue("95");
  await expect(run.getByLabel("距离（公里）", { exact: true })).toHaveValue("2.345678");
  await page.getByRole("button", { name: "保存训练记录", exact: true }).click();
  const unchanged = await (await page.request.get("/api/v1/training/sessions")).json();
  expect(unchanged[0].items[1].sets[0]).toMatchObject({ durationSeconds: 95, distanceMeters: "2345.678" });
});

test("visible plan sources keep reference actions unchecked and fractional seconds cannot be saved", async ({ page }) => {
  const item = { exerciseName: "跑步", targetSets: null, targetRepsMin: null, targetRepsMax: null, targetWeightKg: null, targetDurationSeconds: 1800, targetDistanceMeters: "5000", note: null };
  const template = await (await page.request.post("/api/v1/training/templates", { data: { name: "有氧参考", note: null, items: [item] } })).json();
  await page.goto("/training");
  await page.getByRole("button", { name: "记录训练内容", exact: true }).click();
  await page.getByRole("button", { name: "已有计划", exact: true }).click();
  await page.getByRole("combobox", { name:"选择计划", exact:true }).selectOption(template.id);
  await page.getByRole("button", { name: "加入参考内容", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "记录已做：跑步", exact: true })).not.toBeChecked();
  await page.getByRole("button", { name: "保存训练记录", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("至少选择一个");
  expect(await (await page.request.get("/api/v1/training/sessions")).json()).toEqual([]);
  await page.getByRole("checkbox", { name: "记录已做：跑步", exact: true }).check();
  const minutes = page.getByLabel("时长（分钟）", { exact: true });
  await expect(minutes).toHaveValue("30");
  await minutes.fill("0.001");
  expect(await minutes.evaluate((element: HTMLInputElement) => element.validity.valid)).toBe(false);
  await page.getByRole("button", { name: "保存训练记录", exact: true }).click();
  expect(await (await page.request.get("/api/v1/training/sessions")).json()).toEqual([]);
  await minutes.fill("30");
  await page.getByRole("button", { name: "保存训练记录", exact: true }).click();
  await expect(page.getByText("这次训练已保存。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "记录训练内容", exact: true }).click();
  await page.getByRole("button", { name: "上次实际内容", exact: true }).click();
  await page.getByRole("button", { name: "使用上次实际内容", exact: true }).click();
  await expect(page.getByLabel("时长（分钟）", { exact: true })).toHaveValue("30");
  expect(await (await page.request.get("/api/v1/training/sessions")).json()).toHaveLength(1);
});
