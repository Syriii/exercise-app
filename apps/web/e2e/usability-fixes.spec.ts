import { expect, test, type Page } from "@playwright/test";

async function navigate(page: Page, name: string) {
  const dock = page.locator('.mobile-dock');
  const nav = await dock.isVisible() ? dock : page.locator('.rail-nav');
  await nav.getByRole('button').filter({has:page.getByText(name, {exact:true})}).click();
}

test.beforeEach(async ({ page }, testInfo) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/register');
  await page.getByLabel('用户名').fill(`ux_${testInfo.project.name[0]}_${Date.now()}`);
  await page.getByLabel('密码').fill('local browser test password');
  await page.getByRole('button',{name:'注册',exact:true}).click();
  await expect(page).toHaveURL(/\/today$/);
});

test('completion saves all draft actions; a lost response can be retried without duplication', async ({ page }) => {
  await navigate(page,'训练');
  await page.getByRole('button',{name:'新建方案',exact:true}).click();
  await page.getByLabel('方案名称').fill('批量测试');
  await page.getByLabel('动作名称',{exact:true}).fill('深蹲');
  await page.getByRole('button',{name:'添加动作 →',exact:true}).click();
  await page.getByLabel('动作名称',{exact:true}).nth(1).fill('卧推');
  await page.getByRole('button',{name:'保存方案',exact:true}).click();
  await page.getByRole('button',{name:'用这份开始'}).click();
  const items = page.locator('.actual-exercise-list > li');
  await items.nth(0).getByLabel('次数',{exact:true}).fill('10');
  await items.nth(1).getByLabel('次数',{exact:true}).fill('12');
  await items.nth(0).getByRole('button',{name:'保存实际数据',exact:true}).click();
  await expect(page.getByText('深蹲 已记下',{exact:true})).toBeVisible();
  await expect(items.nth(1).getByLabel('次数',{exact:true})).toHaveValue('12');
  await navigate(page,'历史');
  await navigate(page,'训练');
  await expect(items.nth(1).getByLabel('次数',{exact:true})).toHaveValue('12');
  await page.getByLabel('动作名称',{exact:true}).fill('拉伸');
  let loseResponse = true;
  await page.route('**/sessions/*/finish', async route => {
    if (loseResponse) {
      loseResponse = false;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'test_lost_response'})});
    } else await route.continue();
  });
  await page.getByRole('button',{name:'保存并结束',exact:true}).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(items.nth(1).getByLabel('次数',{exact:true})).toHaveValue('12');
  await page.getByRole('button',{name:'保存并结束',exact:true}).click();
  await expect(page.getByText('这次训练已保存',{exact:true})).toBeVisible();
  await navigate(page,'历史');
  await page.getByRole('button',{name:'查看详情',exact:true}).click();
  await expect(page.locator('.history-session__details')).toContainText('12 次');
  await expect(page.locator('.history-session__details').getByText('拉伸',{exact:true})).toHaveCount(1);
});

test('food draft survives tab navigation; account actions are discoverable and logout clears drafts', async ({ page }) => {
  const profile = await page.request.put('/api/v1/planning/profile', {data: {
    revision:0,birthDate:null,sexCategory:null,heightCm:null,palCategory:null,
    pregnantOrBreastfeeding:false,medicalNutritionCondition:false,specialBodyComposition:false,
  }});
  expect(profile.ok()).toBeTruthy();
  await navigate(page,'饮食');
  await page.getByRole('button',{name:'快速记餐',exact:true}).click();
  await page.getByLabel('餐次名称（可选）').fill('待保存早餐');
  await navigate(page,'历史');
  await navigate(page,'饮食');
  await expect(page.getByLabel('餐次名称（可选）')).toHaveValue('待保存早餐');
  await navigate(page,'设置');
  await page.getByRole('button',{name:'数据与账号'}).click();
  await page.getByRole('button',{name:'修改密码',exact:true}).click();
  await page.getByRole('button',{name:'取消并返回账号'}).click();
  await expect(page).toHaveURL(/\/settings\/data$/);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button',{name:'退出登录',exact:true}).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('link',{name:'去注册'}).click();
  await page.getByLabel('用户名').fill(`other_${Date.now()}`);
  await page.getByLabel('密码').fill('other browser test password');
  await page.getByRole('button',{name:'注册',exact:true}).click();
  await expect(page).toHaveURL(/\/today$/);
  await navigate(page,'饮食');
  await expect(page.getByLabel('餐次名称（可选）')).toHaveCount(0);
  await expect(page.getByText('待保存早餐',{exact:true})).toHaveCount(0);
});

test('mobile headers leave the first feedback field visible and sharing remains explicit', async ({ page }, testInfo) => {
  await page.goto('/feedback');
  await expect(page.getByRole('heading',{name:'帮助与反馈',exact:true})).toBeVisible();
  await expect(page.getByText('本页不会自动提交反馈。复制或下载后，请通过你与应用维护者已有的联系方式发送。')).toBeVisible();
  await expect(page.getByRole('button',{name:'清除本机错误记录'})).toBeHidden();
  if (testInfo.project.name === 'mobile-chromium') {
    const field = await page.getByLabel('问题描述（可选）').boundingBox();
    expect(field).not.toBeNull();
    expect(field!.y+field!.height).toBeLessThan(page.viewportSize()!.height-80);
    await expect(page.locator('.mobile-brand')).toHaveText('EA');
  }
  await page.getByLabel('问题描述（可选）').fill('保存后没有看到记录');
  await page.getByRole('button',{name:'生成问题报告'}).click();
  await expect(page.getByLabel('报告预览')).toHaveValue(/保存后没有看到记录/);
  await page.getByText('报告包含什么',{exact:true}).click();
  await page.getByRole('button',{name:'清除本机错误记录'}).click();
  await expect(page.getByRole('status')).toContainText('训练、饮食和身体记录没有改变');
  await expect(page.getByLabel('问题描述（可选）')).toHaveValue('保存后没有看到记录');
});
