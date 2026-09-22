import { expect, test } from '@playwright/test';
import { completeSetup } from './helpers/setup';
import { reveal } from './helpers/disclosure';

test.beforeEach(async ({ page }, info) => {
  await page.goto('/register');
  await page.getByLabel('用户名').fill(`polish_${info.project.name[0]}_${Date.now()}`);
  await page.getByLabel('密码', { exact: true }).fill('fake training polish password');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await completeSetup(page);
});

test('picked activity targets stay blank, survive switches and retry, and work in date and weekly plans', async ({ page }, info) => {
  await page.goto('/training/plans');
  await page.getByRole('button', { name: '新建计划', exact: true }).click();
  await page.getByLabel('计划名称').fill('力量与有氧');
  await page.getByRole('button', { name: '添加动作：跑步', exact: true }).click();
  const action = page.locator('.plan-action-editor').first();
  await expect(action.getByLabel('目标类型')).toHaveValue('true');
  await expect(action.getByLabel('目标时长（秒）')).toHaveValue('');
  await expect(action.getByLabel('目标距离（米）')).toHaveValue('');
  await expect(action.getByLabel('目标组数')).toHaveCount(0);
  await action.getByLabel('目标时长（秒）').fill('1234');
  await action.getByLabel('目标距离（米）').fill('2345.678');
  await action.getByLabel('目标类型').selectOption('false');
  await action.getByLabel('目标组数').fill('2');
  await action.getByLabel('目标类型').selectOption('true');
  await expect(action.getByLabel('目标时长（秒）')).toHaveValue('1234');
  await expect(action).toContainText('其他量已有填写');
  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await action.scrollIntoViewIfNeeded();
    const a = (await action.getByLabel('目标时长（秒）').boundingBox())!;
    const b = (await action.getByLabel('目标距离（米）').boundingBox())!;
    expect(Math.abs(a.y - b.y)).toBeLessThan(1);
    expect(Math.abs(a.width - b.width)).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const save = page.getByRole('button', { name: '保存计划', exact: true });
    await expect(save).toBeInViewport();
    expect(await save.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
    await page.screenshot({ path: info.outputPath(`activity-target-${width}.png`), animations: 'disabled' });
  }
  await page.route('**/api/v1/training/templates', async route => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"fake retry failure"}' });
    else await route.continue();
  }, { times: 1 });
  await page.getByRole('button', { name: '保存计划', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(action.getByLabel('目标距离（米）')).toHaveValue('2345.678');
  await page.getByRole('button', { name: '保存计划', exact: true }).click();
  const templates = await (await page.request.get('/api/v1/training/templates')).json();
  expect(templates[0].items[0]).toMatchObject({ targetSets: 2, targetDurationSeconds: 1234, targetDistanceMeters: '2345.678', targetRepsMin: null });
  expect(templates[0].items[0]).not.toHaveProperty('measurement');
  await reveal(page.getByRole('button', { includeHidden: true, name: '安排力量与有氧' }));
  await page.getByRole('button', { name: '安排力量与有氧' }).click();
  await page.getByLabel('日期', { exact: true }).fill('2026-10-02');
  await page.getByRole('button', { name: '保存安排' }).click();
  await expect(page.getByRole('status')).toContainText('已安排到');
  await page.goto('/training?date=2026-10-02');
  await reveal(page.getByRole('button', { includeHidden: true, name: '修改当天计划／改期' }));
  await page.getByRole('button', { name: '修改当天计划／改期' }).click();
  await expect(page.getByLabel('目标组数')).toHaveValue('2');
  await expect(page.getByLabel('目标时长（秒）')).toHaveValue('1234');
  await page.getByText('添加计划动作', { exact: true }).click();
  await page.getByRole('button', { name: '添加动作：步行', exact: true }).click();
  const walk = page.locator('.plan-item').last();
  await expect(walk.getByLabel('目标类型')).toHaveValue('true');
  await expect(walk.getByLabel('目标时长（秒）')).toHaveValue('');
  await walk.getByLabel('目标时长（秒）').fill('600');
  await page.getByRole('button', { name: '保存当天计划' }).click();
  await expect(page.getByRole('region', { name: '修改当天计划', exact: true })).toHaveCount(0);
  expect((await (await page.request.get('/api/v1/training/templates')).json())[0].items).toHaveLength(1);
  await page.goto('/training/plans');
  await page.getByText('更多安排方式', { exact: true }).click();
  await page.getByRole('button', { name: '按周编排', exact: true }).click();
  await page.getByRole('button', { name: '新建多周编排', exact: true }).click();
  await page.getByLabel('计划名称').fill('四周有氧');
  await page.getByRole('button', { name: '保存多周编排', exact: true }).click();
  await page.getByRole('button', { name: '添加训练日' }).click();
  await page.getByLabel('训练日名称').fill('骑行日');
  await page.getByRole('button', { name: '添加动作：骑行', exact: true }).click();
  await expect(page.getByLabel('目标类型')).toHaveValue('true');
  await page.getByLabel('目标距离（米）').fill('5000');
  await page.getByRole('button', { name: '保存训练日', exact: true }).click();
  await expect(page.locator('.program-unit-editor')).toHaveCount(0);
  const programs = await (await page.request.get('/api/v1/training/programs')).json();
  expect(programs[0].units[0].items[0]).toMatchObject({ exerciseName: '骑行', targetSets: null, targetDurationSeconds: null, targetDistanceMeters: '5000' });
});

test('populated records and plans have short previews but expose every full name and quantity', async ({ page }, info) => {
  const names = ['自定义器械坐姿划船左侧慢速控制动作', '右侧单臂哑铃支撑划船', '高位下拉', '绳索面拉', '拉伸'];
  await page.goto('/training');
  await page.getByRole('button', { name: '记录训练内容', exact: true }).click();
  await reveal(page.getByText('一次添加多个动作', { exact: true }));
  await page.getByText('一次添加多个动作', { exact: true }).click();
  await page.getByLabel('动作名称，每行一个').fill(names.join('\n'));
  await page.getByRole('button', { name: '加入这些动作' }).click();
  await page.getByRole('button', { name: '保存训练记录', exact: true }).click();
  const card = page.getByRole('article', { name: '已存训练记录' });
  await expect(card.locator('summary').first()).toContainText('5 个动作');
  await expect(card.locator('summary').first()).not.toContainText(names[3]!);
  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await card.scrollIntoViewIfNeeded();
    const preview = card.locator('.action-preview-names');
    const size = await preview.evaluate(el => ({ height: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight) }));
    expect(size.height).toBeLessThanOrEqual(size.line * 2 + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`populated-record-${width}.png`), animations: 'disabled' });
  }
  await card.locator('.record-summary').click();
  const rows = card.locator('.record-detail > ul > li');
  await expect(rows).toHaveCount(5);
  for (const [index, name] of names.entries()) { await expect(rows.nth(index)).toContainText(name); await expect(rows.nth(index)).toContainText('数量未记录'); }
  await reveal(card.getByRole('button', { includeHidden: true, name: '存为我的计划' }));
  page.once('dialog', dialog => dialog.accept('多动作计划'));
  await card.getByRole('button', { name: '存为我的计划' }).click();
  await expect(page.getByRole('status').filter({ hasText: '已存入我的计划' })).toBeVisible();
  await page.goto('/training/plans');
  const plan = page.locator('.template-card');
  await expect(plan.locator('.record-summary')).toContainText('5 个动作');
  await expect(plan.locator('.record-summary')).not.toContainText(names[3]!);
  await plan.locator('.record-summary').click();
  for (const name of names) await expect(plan).toContainText(name);
});
