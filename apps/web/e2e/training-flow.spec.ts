import { expect, test } from "@playwright/test";

test("a person can turn a reusable plan into an actual workout", async ({ page }, testInfo) => {
  const projectKey = testInfo.project.name === "mobile-chromium" ? "m" : "d";
  await page.goto("/register");
  await page.getByLabel("用户名").fill(`training_${projectKey}_${Date.now()}`);
  await page.getByLabel("密码").fill("a browser-only secure password");
  await page.getByRole("button", { name: "注册" }).click();
  await expect(page).toHaveURL(/\/today$/);

  await page.goto("/training");
  await page.getByRole("button", { name: "新建方案" }).click();
  await page.getByLabel("方案名称").fill("全身简易");
  await page.getByLabel("动作名称").fill("深蹲");
  await page.getByLabel("目标组数").fill("3");
  await page.getByLabel("最低次数").fill("8");
  await page.getByLabel("最高次数").fill("12");
  await page.getByRole("button", { name: "保存方案" }).click();

  await expect(page.getByRole("heading", { name: "全身简易" })).toBeVisible();
  const templateCard = page.getByRole("article").filter({ hasText: "全身简易" }).first();
  await templateCard.getByRole("button", { name: "动作预览" }).click();
  await expect(templateCard.getByRole("region", { name: "深蹲动作预览" })).toContainText("内容草案");
  await expect(templateCard.getByRole("region", { name: "深蹲动作预览" })).toContainText("本地未配置可用的动作媒体");
  await templateCard.getByRole("button", { name: "收起预览" }).click();
  await page.getByRole("button", { name: "用这份开始" }).click();
  await expect(page.getByRole("heading", { name: "这次训练" })).toBeVisible();

  await page.getByRole("button", { name: "动作预览" }).click();
  await expect(page.getByRole("region", { name: "深蹲动作预览" })).toContainText("内容草案");
  await page.getByRole("button", { name: "收起预览" }).click();

  await page.getByLabel("次数").first().fill("10");
  await page.getByLabel("重量 kg").first().fill("60");
  await page.getByRole("button", { name: "保存实际数据" }).click();
  await expect(page.getByText("深蹲 已记下")).toBeVisible();

  await page.getByLabel("动作名称").fill("平板支撑");
  await page.getByLabel("实际备注").last().fill("训练收尾");
  await page.getByRole("button", { name: "加入本次训练" }).click();
  await expect(page.getByText("额外动作已加入本次训练")).toBeVisible();
  await expect(page.getByText("平板支撑")).toBeVisible();

  await page.getByRole("button", { name: "保存并结束" }).click();
  await expect(page.getByRole("heading", { name: "训练", exact: true })).toBeVisible();
  await expect(page.getByText("这次训练已保存")).toBeVisible();
});

test("a person can copy a single plan into a cycle and start that training day", async ({ page }, testInfo) => {
  const projectKey = testInfo.project.name === "mobile-chromium" ? "m" : "d";
  await page.goto("/register");
  await page.getByLabel("用户名").fill(`cycle_${projectKey}_${Date.now()}`);
  await page.getByLabel("密码").fill("a browser-only secure password");
  await page.getByRole("button", { name: "注册" }).click();
  await expect(page).toHaveURL(/\/today$/);

  await page.goto("/training");
  await page.getByRole("button", { name: "新建方案" }).click();
  await page.getByLabel("方案名称").fill("胸部 A");
  await page.getByLabel("动作名称").fill("杠铃卧推");
  await page.getByLabel("目标组数").fill("4");
  await page.getByRole("button", { name: "保存方案" }).click();
  await expect(page.getByRole("heading", { name: "胸部 A" })).toBeVisible();
  await page.getByRole("button", { name: "复制胸部 A" }).click();
  await expect(page.getByRole("heading", { name: "胸部 A 副本" })).toBeVisible();
  await expect(page.getByText("已复制“胸部 A”，两份方案之后可以分别修改")).toBeVisible();

  await page.getByRole("button", { name: /周期计划/ }).first().click();
  await page.getByRole("button", { name: "新建周期计划" }).click();
  await page.getByLabel("计划名称").fill("四周增肌");
  await page.getByLabel("包含几周").fill("4");
  await page.getByRole("button", { name: "保存周期计划" }).click();

  await expect(page.getByRole("heading", { name: "四周增肌" })).toBeVisible();
  await page.getByRole("button", { name: "添加训练日" }).click();
  await page.getByLabel("放在第几周").fill("2");
  await page.getByLabel("从单次方案复制（可选）").selectOption({ label: "胸部 A" });
  await page.getByRole("button", { name: "保存训练日" }).click();

  await expect(page.getByText("杠铃卧推")).toBeVisible();
  await page.getByRole("button", { name: "开始这天" }).click();
  await expect(page.getByText("四周增肌 · 第 2 周 · 胸部 A")).toBeVisible();
  await expect(page.getByRole("heading", { name: "杠铃卧推" })).toBeVisible();

  await page.getByRole("button", { name: "保存并结束" }).click();
  await expect(page.getByText("这次训练已保存")).toBeVisible();
});

test("a person can schedule today's workout and find the actual record in history", async ({ page }, testInfo) => {
  const projectKey = testInfo.project.name === "mobile-chromium" ? "m" : "d";
  await page.goto("/register");
  await page.getByLabel("用户名").fill(`scheduled_${projectKey}_${Date.now()}`);
  await page.getByLabel("密码").fill("a browser-only secure password");
  await page.getByRole("button", { name: "注册" }).click();
  await expect(page).toHaveURL(/\/today$/);

  await page.goto("/training");
  await page.getByRole("button", { name: "新建方案" }).click();
  await page.getByLabel("方案名称").fill("今天的力量训练");
  await page.getByLabel("动作名称").fill("硬拉");
  await page.getByLabel("目标组数").fill("3");
  await page.getByRole("button", { name: "保存方案" }).click();
  await expect(page.getByRole("heading", { name: "今天的力量训练" })).toBeVisible();

  await page.getByRole("button", { name: "安排今天的力量训练" }).click();
  const scheduleEditor = page.getByRole("region", { name: "安排训练日期" });
  await expect(page.getByRole("heading", { name: "安排训练日期" })).toBeVisible();
  const scheduledDate = await scheduleEditor.locator('input[type="date"]').inputValue();
  await page.getByRole("button", { name: "保存安排" }).click();
  await expect(page.getByText(/已安排到/)).toBeVisible();

  await page.goto("/settings/reminders");
  const reminderSettings = page.getByRole("region", { name: "训练提醒" });
  await reminderSettings.getByRole("checkbox").check();
  await reminderSettings.getByLabel("提醒时间").fill("00:00");
  await reminderSettings.getByRole("button", { name: "保存训练提醒" }).click();
  await expect(page.getByText(/训练提醒已开启/)).toBeVisible();

  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "还有 1 项训练安排未开始" })).toBeVisible();
  await page.getByRole("button", { name: "一小时后再提醒" }).click();
  await expect(page.getByRole("region", { name: "已暂缓的训练提醒" })).toContainText("再次提醒训练");
  const todayTraining = page.getByRole("region", { name: "今天还要练" });
  await expect(todayTraining.locator("strong").filter({ hasText: "今天的力量训练" })).toBeVisible();
  await todayTraining.getByRole("button", { name: "开始训练", exact: true }).click();
  await expect(page).toHaveURL(/\/training$/);
  await expect(page.getByText(/今天的力量训练/)).toBeVisible();

  await page.getByLabel("实际动作").fill("罗马尼亚硬拉");
  await page.getByLabel("次数").first().fill("5");
  await page.getByLabel("重量 kg").first().fill("80");
  await page.getByRole("button", { name: "保存实际数据" }).click();
  await expect(page.getByText("硬拉 已记下")).toBeVisible();
  await page.getByRole("button", { name: "保存并结束" }).click();
  await expect(page.getByText("这次训练已保存")).toBeVisible();

  await page.goto("/history");
  await expect(page.getByText("今天的力量训练", { exact: true })).toBeVisible();
  await expect(page.getByText("罗马尼亚硬拉", { exact: true })).toBeVisible();
  await expect(page.getByText(/已完成 · 1 个动作/)).toBeVisible();

  await page.getByRole("button", { name: "查看详情" }).click();
  await expect(page.getByText(/替代 硬拉 · 5 次 · 80 kg/)).toBeVisible();
  await page.getByRole("button", { name: "修正罗马尼亚硬拉" }).click();
  const correction = page.locator("form.history-correction");
  await correction.getByLabel("重量 kg").fill("85");
  await correction.getByRole("button", { name: "保存修正" }).click();
  await expect(page.getByText("训练记录已修正，原方案没有改变")).toBeVisible();
  await expect(page.getByText(/替代 硬拉 · 5 次 · 85 kg/)).toBeVisible();
  await page.getByText(/查看之前的 2 个版本/).click();
  await expect(page.getByText(/当时记录为 罗马尼亚硬拉，1 组/)).toBeVisible();

  await page.getByRole("button", { name: "修正日期或备注" }).click();
  const previousDate = new Date(`${scheduledDate}T12:00:00`);
  previousDate.setDate(previousDate.getDate() - 1);
  const correctedDate = previousDate.toISOString().slice(0, 10);
  await page.getByLabel("归属日期").fill(correctedDate);
  await page.getByLabel("整次训练备注（可选）").fill("跨日后补充");
  await page.getByRole("button", { name: "保存日期修正" }).click();
  await expect(page.getByText(/训练归属日期或备注已修正/)).toBeVisible();
  await page.getByText("查看日期与备注的之前版本").click();
  await expect(page.getByText(new RegExp(`${scheduledDate} · 当时没有备注`))).toBeVisible();

  await page.getByRole("button", { name: "补记实际动作" }).click();
  const extraCorrection = page.locator("form.history-extra-correction");
  await extraCorrection.getByLabel("遗漏的实际动作").fill("农夫行走");
  await extraCorrection.getByLabel("距离（米）").fill("200");
  await extraCorrection.getByRole("button", { name: "保存补记动作" }).click();
  await expect(page.getByText("遗漏的实际动作已补记到这次训练")).toBeVisible();
  await expect(page.getByText("农夫行走", { exact: true })).toBeVisible();
});
