import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { completeSetup } from './helpers/setup';

const setupUrl = '**/api/v1/planning/setup';
async function register(page: Page) {
  await page.goto('/register');
  await page.getByLabel('用户名').fill(`setup_${randomUUID().slice(0, 18)}`);
  await page.getByLabel('密码', { exact: true }).fill('fake setup recovery password');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/setup$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('基础资料');
}

test('failed guard preserves destination and settings draft; retries never write setup', async ({ page }, info) => {
  await register(page); await completeSetup(page);
  await page.goto('/settings/measurement');
  await page.getByLabel('体重（kg）', { exact: true }).fill('72');
  let fail: 'server' | 'network' | null = 'server';
  let writes = 0;
  await page.route(setupUrl, async route => {
    if (route.request().method() !== 'GET') { writes++; await route.continue(); }
    else if (fail === 'server') await route.fulfill({ status: 503, json: { code: 'test_unavailable' } });
    else if (fail === 'network') await route.abort('failed');
    else await route.continue();
  });
  await page.getByRole('button', { name: /^今天/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('暂时无法读取设置');
  expect(new URL(page.url()).searchParams.get('redirect')).toBe('/today');
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('仍未能读取');
  fail = 'network';
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试', exact: true })).toBeEnabled();
  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`setup-error-${width}.png`) });
  }
  fail = null;
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
  await page.getByRole('button', { name: /^我的/ }).click();
  await page.getByRole('button', { name: /身体数据/ }).click();
  await expect(page.getByLabel('体重（kg）', { exact: true })).toHaveValue('72');
  expect(writes).toBe(0);
  // Reload an unrelated deep link: its query must survive the failed guard and retry.
  fail = 'server';
  page.once('dialog', dialog => dialog.accept());
  await page.goto('/history?filter=measurement&date=2026-09-10');
  await expect(page).toHaveURL(/\/account\/setup-unavailable\?/);
  fail = null;
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page).toHaveURL(/\/history\?filter=measurement&date=2026-09-10$/);
  expect(writes).toBe(0);
});

test('unknown setup state is not completed and a successful retry resumes the saved step', async ({ page }) => {
  await register(page);
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('身体数据');
  let fail = true;
  await page.route(setupUrl, route => fail && route.request().method() === 'GET'
    ? route.fulfill({ status: 503, json: { code: 'test_unavailable' } }) : route.continue());
  await page.goto('/history');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('暂时无法读取设置');
  fail = false;
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/setup$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('身体数据');
});

test('direct setup read failure shows no editable form and recovers without advancing', async ({ page }) => {
  await register(page);
  let fail = true;
  await page.route(setupUrl, route => fail && route.request().method() === 'GET'
    ? route.fulfill({ status: 503, json: { code: 'test_unavailable' } }) : route.continue());
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('暂时无法读取设置');
  await expect(page.getByLabel('身高（cm）')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '下一步', exact: true })).toHaveCount(0);
  expect(await (await page.request.get('/api/v1/planning/setup')).json()).toMatchObject({ profile: false, completed: false });
  fail = false;
  await page.getByRole('button', { name: '重试读取' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('基础资料');
});

test('expired session goes to login rather than setup or a connection retry loop', async ({ page }) => {
  await register(page); await completeSetup(page);
  await page.route(setupUrl, route => route.fulfill({ status: 401, json: { code: 'unauthorized' } }));
  await page.getByRole('button', { name: /^历史/ }).click();
  await expect(page).toHaveURL(/\/login\?/);
  expect(new URL(page.url()).searchParams.get('redirect')).toBe('/history');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('登录');
  await page.goto('/settings/setup');
  await expect(page).toHaveURL(/\/login\?/);
  expect(new URL(page.url()).searchParams.get('redirect')).toBe('/settings/setup');
});

test('onboarding stays compact with explicit health choices and reversible unknown measurement', async ({ page }, info) => {
  await register(page);
  await expect(page.getByLabel('孕期或哺乳期')).toBeVisible();
  await page.getByLabel('体脂或肌肉量明显特殊').check();
  await page.getByLabel('平时活动量').selectOption('low_active');
  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const next = page.getByRole('button', { name: '下一步', exact: true });
    await page.screenshot({ path: info.outputPath(`setup-profile-${width}.png`) });
    await next.scrollIntoViewIfNeeded();
    await expect(next).toBeInViewport();
    expect(await next.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
    const health = page.getByLabel('体脂或肌肉量明显特殊');
    await health.scrollIntoViewIfNeeded();
    expect(await health.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
    await page.screenshot({ path: info.outputPath(`setup-health-${width}.png`) });
  }
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('身体数据');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请填写体重');
  await page.getByLabel('体重（kg）', { exact: true }).fill('68');
  const unknown = page.getByLabel('暂时没有测量值，之后再记录');
  await unknown.check();
  await expect(page.getByLabel('体重（kg）', { exact: true })).toBeHidden();
  await unknown.uncheck();
  await expect(page.getByLabel('体重（kg）', { exact: true })).toHaveValue('68');
  await unknown.check();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('目标方向');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('button', { name: '跳过提醒，完成设置' }).click();
  await expect(page).toHaveURL(/\/today$/);
  expect(await (await page.request.get('/api/v1/planning/measurements')).json()).toEqual([]);
  expect(await (await page.request.get('/api/v1/planning/profile')).json()).toMatchObject({ specialBodyComposition: true, palCategory: 'low_active' });
});
