import { expect, test, type Page } from '@playwright/test';
import { completeSetup } from './helpers/setup';
import { reveal } from './helpers/disclosure';

async function register(page: Page, suffix: string) {
  await page.goto('/register');
  await page.getByLabel('用户名').fill(`whole_${suffix}_${Date.now()}`);
  await page.getByLabel('密码', { exact: true }).fill('fake whole app ui password');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await completeSetup(page);
}

test('plan selection, compact targets, reorder, independent schedule and summary detail remain usable', async ({ page }, info) => {
  await register(page, info.project.name[0]!);
  await page.goto('/training/plans');
  await expect(page.getByRole('button', { name: '填写条件' })).toBeHidden();
  await page.getByRole('button', { name: '新建计划', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的训练计划' })).toBeHidden();
  await page.getByLabel('计划名称').fill('我的力量与有氧');
  await expect(page.getByLabel('动作名称', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '添加动作：深蹲', exact: true }).click();
  const actions = page.locator('.plan-action-editor');
  await actions.first().getByLabel('目标组数').fill('3');
  await actions.first().getByLabel('最低次数').fill('8');
  await actions.first().getByLabel('目标重量 kg').fill('20');
  await expect(actions.first().getByLabel('最高次数')).toBeHidden();
  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ animations: 'disabled', path: info.outputPath(`plan-editor-${width}.png`) });
  }
  await reveal(actions.first().getByLabel('最高次数'));
  await actions.first().getByLabel('最高次数').fill('12');
  await reveal(actions.first().getByLabel('动作备注'));
  await actions.first().getByLabel('动作备注').fill('保留这条说明');
  await page.getByRole('button', { name: '选择计划动作', exact: true }).click();
  await page.getByRole('button', { name: '添加动作：跑步', exact: true }).click();
  await actions.last().getByLabel('目标类型').selectOption('true');
  await actions.last().getByLabel('目标时长（秒）').fill('1200');
  await reveal(actions.last().getByRole('button', { name: '上移', includeHidden: true }));
  await actions.last().getByRole('button', { name: '上移', exact: true }).click();
  await expect(actions.first()).toContainText('跑步');
  await expect(actions.first().getByLabel('目标时长（秒）')).toHaveValue('1200');
  await expect(actions.last().getByLabel('目标组数')).toHaveValue('3');
  await page.getByRole('button', { name: '保存计划', exact: true }).click();
  const card = page.locator('.template-card');
  await expect(card.getByRole('heading', { name: '我的力量与有氧' })).toBeVisible();
  await expect(card.getByRole('button', { name: '用来记录' })).toBeHidden();
  await page.setViewportSize({ width: 375, height: 900 });
  await page.screenshot({ animations: 'disabled', path: info.outputPath('plan-list.png') });
  await card.locator('.record-summary').click();
  await expect(card).toContainText('3 组 · 8–12 次 · 20 kg');
  await expect(card).toContainText('1200 秒');
  await page.screenshot({ animations: 'disabled', path: info.outputPath('plan-expanded.png') });
  await expect(card.getByRole('button', { name: '用来记录' })).toBeVisible();
  await expect(card.getByRole('button', { name: '归档' })).toBeHidden();
  await card.getByRole('button', { name: '安排我的力量与有氧' }).click();
  await expect(card).toHaveCount(0);
  await page.getByLabel('日期', { exact: true }).fill('2026-10-01');
  await page.getByRole('button', { name: '保存安排', exact: true }).click();
  const plans = await (await page.request.get('/api/v1/training/templates')).json();
  expect(plans[0].items.map((item: { exerciseName: string }) => item.exerciseName)).toEqual(['跑步', '深蹲']);
  expect(plans[0].items[1]).toMatchObject({ targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, targetWeightKg: '20', note: '保留这条说明' });
  await page.goto('/training?date=2026-10-01');
  await expect(page.getByRole('button', { name: '从当天计划记录' })).toBeHidden();
  await page.locator('.date-plan .record-summary').click();
  await page.getByRole('button', { name: '修改当天计划／改期' }).click();
  await page.screenshot({ animations: 'disabled', path: info.outputPath('date-plan-editor.png') });
  await page.getByLabel('目标组数').last().fill('4');
  await page.getByText('添加计划动作', { exact: true }).click();
  await page.getByRole('button', { name: '填写自定义动作', exact: true }).click();
  const customName = page.getByLabel('动作名称', { exact: true }).last();
  await customName.pressSequentially('custom walk', { delay: 10 });
  await expect(customName).toBeVisible();
  await expect(customName).toHaveValue('custom walk');
  await page.getByRole('button', { name: '保存当天计划' }).click();
  await expect(page.getByRole('region', { name: '修改当天计划', exact: true })).toHaveCount(0);
  expect((await (await page.request.get('/api/v1/training/templates')).json())[0].items[1].targetSets).toBe(3);
});

test('reminder changes expose save only when needed and failed saves preserve the form', async ({ page }, info) => {
  await register(page, info.project.name[0]!);
  await page.goto('/settings/reminders');
  const reminder = page.getByRole('region', { name: '饮食提醒', exact: true });
  await expect(reminder.getByRole('button', { name: '保存饮食提醒' })).toHaveCount(0);
  await reminder.getByRole('checkbox').check();
  await reminder.getByLabel('提醒时间').fill('19:15');
  await page.route('**/reminders/nutrition/settings', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"fake save failure"}' }), { times: 1 });
  await reminder.getByRole('button', { name: '保存饮食提醒' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(reminder.getByLabel('提醒时间')).toHaveValue('19:15');
  await reminder.getByRole('button', { name: '保存饮食提醒' }).click();
  await expect(page.getByRole('status')).toContainText('饮食提醒已开启');
  await expect(reminder.getByRole('button', { name: '保存饮食提醒' })).toHaveCount(0);
  await page.reload();
  await expect(reminder.getByLabel('提醒时间')).toHaveValue('19:15');
});

test('all routes and settings subpages fit small screens with labelled controls', async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/register');
  await page.screenshot({ animations: 'disabled', path: info.outputPath('register-375.png') });
  await register(page, info.project.name[0]!);
  const routes = ['/today', '/nutrition', '/training', '/training/plans', '/history', '/history?tab=trends', '/settings', '/settings/profile', '/settings/measurement', '/settings/strategy', '/settings/preferences', '/settings/reminders', '/settings/data', '/feedback', '/account/password'];
  for (const path of routes) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path} at ${width}`).toBe(true);
      const overflows = await page.locator('input:visible, select:visible, textarea:visible, button:visible').evaluateAll(nodes => nodes.filter(node => {
        if (node.closest('.category-chips')) return false;
        const r = node.getBoundingClientRect(); return r.width > innerWidth || r.left < -1 || r.right > innerWidth + 1;
      }).map(node => node.outerHTML.slice(0, 200)));
      expect(overflows, `${path} at ${width}`).toEqual([]);
      if (width === 375) await page.screenshot({ animations: 'disabled', path: info.outputPath(path.replaceAll(/[/?=]/g, '-') + '.png') });
    }
  }
  await page.goto('/settings/measurement');
  await expect(page.getByLabel('腰围（cm，可选）')).toBeHidden();
  await expect(page.getByLabel('备注（可选）')).toBeHidden();
  await page.goto('/settings/data');
  await expect(page.getByLabel('输入当前用户名')).toBeHidden();
  await reveal(page.getByLabel('输入当前用户名'));
  await expect(page.getByText('我理解这是整个账号的永久删除，不只是退出登录')).toBeVisible();
});
