import { expect, test } from '@playwright/test';
import { completeSetup } from './helpers/setup';

test.beforeEach(async ({ page }, info) => {
  await page.goto('/register');
  await page.getByLabel('用户名').fill(`compact_${info.project.name[0]}_${Date.now()}`);
  await page.getByLabel('密码', { exact: true }).fill('only fake compact test password');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await completeSetup(page);
});

test('food selection comes before optional metadata and compact portions save unchanged', async ({ page }, info) => {
  await page.goto('/nutrition');
  await page.getByRole('button', { name: '手动添加食物', exact: true }).click();
  const composer = page.getByRole('region', { name: '快速记餐' });
  await expect(composer.getByLabel('餐次名称（可选）')).toBeHidden();
  await expect(composer.getByLabel('备注（可选）')).toBeHidden();
  await expect(composer.getByLabel('用餐时间')).toBeHidden();
  await expect(composer.getByRole('list', { name: '食物列表' })).toBeVisible();
  const search = composer.getByLabel('搜索食物', { exact: true });
  await search.fill('鸡蛋（水煮全蛋）');
  await composer.getByRole('button', { name: '搜索', exact: true }).click();
  await composer.getByRole('button', { name: '选择：鸡蛋（水煮全蛋）', exact: true }).click();
  const portion = composer.getByLabel('鸡蛋（水煮全蛋）份量（g）');
  await portion.fill('150');
  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    expect((await portion.boundingBox())!.width).toBeLessThan(120);
    expect(await composer.locator('.category-chip').evaluateAll(items => items.every(item => item.scrollWidth <= item.clientWidth + 1))).toBe(true);
    await composer.locator('.compact-metadata summary').scrollIntoViewIfNeeded();
    await page.screenshot({ animations: 'disabled', path: info.outputPath(`food-${width}.png`) });
  }
  await composer.getByRole('button', { name: '加入这顿饭（1项）', exact: true }).click();
  await expect(page.locator('.meal-items')).toContainText('150 g');
  await expect(page.locator('.meal-items')).toContainText('232.5 kcal');
  const item = page.locator('.food-item');
  await expect(item.getByRole('button', { name: '修正', exact: true })).toBeHidden();
  await item.locator('summary').click();
  await expect(item.getByRole('button', { name: '换食物', exact: true })).toBeVisible();
});

test('training picks actions, uses compact amounts and preserves hidden notes and mixed set data', async ({ page }, info) => {
  await page.goto('/training');
  await page.getByRole('button', { name: '记录训练内容', exact: true }).click();
  await expect(page.getByLabel('训练日期', { exact: true })).toBeHidden();
  await expect(page.getByLabel('本次备注（可选）')).toBeHidden();
  await page.getByRole('button', { name: '添加动作：深蹲', exact: true }).click();
  const squat = page.getByRole('region', { name: '动作填写' }).first();
  await expect(squat.getByLabel('动作备注（可选）')).toBeHidden();
  await squat.getByLabel('组数', { exact: true }).fill('3');
  await squat.getByLabel('每组次数').fill('12');
  await squat.getByLabel('重量 kg（可选）').fill('20');
  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await squat.scrollIntoViewIfNeeded();
    const a = (await squat.getByLabel('组数', { exact: true }).boundingBox())!;
    const b = (await squat.getByLabel('每组次数').boundingBox())!;
    const c = (await squat.getByLabel('重量 kg（可选）').boundingBox())!;
    expect(Math.abs(a.y - b.y)).toBeLessThan(1);
    expect(Math.abs(a.y - c.y)).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ animations: 'disabled', path: info.outputPath(`training-${width}.png`) });
  }
  await squat.getByText('动作选项', { exact: true }).click();
  await squat.getByLabel('动作备注（可选）').fill('保留说明');
  await squat.getByText('动作选项', { exact: true }).click();
  await squat.getByRole('button', { name: '各组不同，展开调整' }).click();
  await squat.getByLabel('次数', { exact: true }).nth(2).fill('8');
  await page.getByRole('button', { name: '继续选择动作', exact: true }).click();
  await page.getByRole('button', { name: '添加动作：跑步', exact: true }).click();
  const run = page.getByRole('region', { name: '动作填写' }).last();
  await expect(run.getByLabel('组数', { exact: true })).toHaveCount(0);
  await run.getByLabel('时长（秒）').fill('1200');
  await run.getByLabel('距离（米）').fill('2000');
  await page.getByRole('button', { name: '保存训练记录', exact: true }).click();
  await expect(page.getByText('这次训练已保存。', { exact: true })).toBeVisible();
  const records = await (await page.request.get('/api/v1/training/sessions')).json();
  expect(records).toHaveLength(1);
  expect(records[0].items[0].actualNote).toBe('保留说明');
  expect(records[0].items[0].sets.map((s: { reps: number }) => s.reps)).toEqual([12,12,8]);
  expect(records[0].items[1].sets[0]).toMatchObject({ durationSeconds:1200, distanceMeters:'2000' });
});

test('plan targets are not actual records until selected and unchecked actions are excluded', async ({ page }) => {
  const target = { targetSets:3,targetRepsMin:10,targetRepsMax:10,targetWeightKg:null,targetDurationSeconds:null,targetDistanceMeters:null,note:null };
  const plan = await (await page.request.post('/api/v1/training/templates', { data: { name:'两动作参考',note:null,items:[{...target,exerciseName:'深蹲'},{...target,exerciseName:'卧推'}] } })).json();
  await page.goto(`/training?templateId=${plan.id}`);
  await expect(page.getByRole('checkbox', { name:'记录已做：深蹲' })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name:'记录已做：卧推' })).not.toBeChecked();
  await page.getByRole('button', { name:'保存训练记录',exact:true }).click();
  await expect(page.getByRole('alert')).toContainText('至少选择一个');
  expect(await (await page.request.get('/api/v1/training/sessions')).json()).toEqual([]);
  await page.getByRole('checkbox', { name:'记录已做：深蹲' }).check();
  await page.getByLabel('组数', { exact:true }).fill('2');
  await page.getByRole('button', { name:'保存训练记录',exact:true }).click();
  await expect(page.getByText('这次训练已保存。', { exact:true })).toBeVisible();
  const records = await (await page.request.get('/api/v1/training/sessions')).json();
  expect(records[0].items).toHaveLength(1);
  expect(records[0].items[0].sets).toHaveLength(2);
  expect((await (await page.request.get('/api/v1/training/templates')).json())[0].items[0].targetSets).toBe(3);
});
