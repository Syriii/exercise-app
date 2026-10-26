import { expect, test, type Page } from '@playwright/test';
import { completeSetup } from './helpers/setup';
import { reveal } from './helpers/disclosure';

const photo = { name: 'local-meal.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') };
async function register(page: Page) {
  await page.goto('/register');
  await page.getByLabel('用户名').fill(`recording_${Date.now()}_${Math.random().toString(36).slice(2,6)}`);
  await page.getByLabel('密码', {exact:true}).fill('only fake local recording password');
  await page.getByRole('button', {name:'注册', exact:true}).click();
  await completeSetup(page);
}

test('photo and gallery open the selected native source directly and cancellation creates no meal', async ({page}) => {
  await register(page);
  await page.goto('/nutrition');
  const selectedDate = await page.getByLabel('查看日期').inputValue();
  const camera = page.waitForEvent('filechooser');
  await page.getByRole('button', {name:'拍照记一餐', exact:true}).click();
  const cameraChooser = await camera;
  expect(await cameraChooser.element().getAttribute('capture')).toBe('environment');
  await cameraChooser.setFiles([]);
  expect(await (await page.request.get(`/api/v1/nutrition/meals?from=${selectedDate}&to=${selectedDate}`)).json()).toEqual([]);
  await page.getByRole('region', {name:'快速记餐'}).getByRole('button', {name:'收起', exact:true}).click();
  const gallery = page.waitForEvent('filechooser');
  await page.getByRole('button', {name:'相册记一餐', exact:true}).click();
  const galleryChooser = await gallery;
  expect(await galleryChooser.element().getAttribute('capture')).toBeNull();
  await galleryChooser.setFiles(photo);
  await expect(page.getByRole('region', {name:'快速记餐'}).getByRole('img', {name:'待上传的餐食照片'})).toBeVisible();
  const date = await page.getByRole('region', {name:'快速记餐'}).locator('.compact-metadata summary').innerText();
  expect(date).toMatch(/\d{4}-\d{2}-\d{2}/);
});

test('saved photo foods expose the original and local correction without another use-results step', async ({page}, info) => {
  await register(page);
  const settings = await (await page.request.get('/api/v1/photo-analysis-settings')).json();
  expect((await page.request.put('/api/v1/photo-analysis-settings', {data:{revision:settings.revision, automatic:true, consent:true}})).ok()).toBe(true);
  const camera = page.waitForEvent('filechooser');
  await page.getByRole('button', {name:'拍照记一餐', exact:true}).click();
  await (await camera).setFiles(photo);
  const composer = page.getByRole('region', {name:'快速记餐'});
  await expect(composer.getByRole('button', {name:'保存这餐并上传'})).toBeEnabled();
  await composer.getByRole('button', {name:'保存这餐并上传'}).click();
  const meal = page.locator('.meal-card').filter({visible:true});
  await expect(meal.locator('.food-item')).toHaveCount(2);
  await expect(meal.getByText('已保存 · 照片估算', {exact:true})).toBeVisible();
  await expect(meal.getByRole('img', {name:'当前餐食的已保存照片'})).toBeVisible();
  await expect(meal.getByRole('region', {name:'照片与当前食物核对'}).getByText('烹调油和实际剩余量', {exact:false})).toBeVisible();
  await expect(meal.getByRole('button', {name:'预览并使用这份结果'})).toHaveCount(0);
  const rice = meal.locator('.food-item').filter({hasText:'米饭'});
  await expect(rice.getByRole('button', {name:'换食物', exact:true})).toBeVisible();
  await rice.getByRole('button', {name:'编辑食物：米饭'}).click();
  const correction = rice.getByRole('form', {name:'修正食物'});
  await expect(correction.getByLabel('食物名称')).toHaveValue('米饭');
  await expect(correction.getByLabel('能量 kcal')).toBeHidden();
  await correction.getByRole('button', {name:'取消修改'}).click();
  const chip = meal.locator('.image-analysis-card .status-chip');
  const contrast = await chip.evaluate(element => {
    const canvas=document.createElement('canvas'), ctx=canvas.getContext('2d')!;
    function rgba(color:string) { ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data]; }
    function luminance(color:number[]) { const v=color.slice(0,3).map(x=>{const c=x/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});return .2126*v[0]!+.7152*v[1]!+.0722*v[2]!; }
    let parent:Element|null=element, background=[255,255,255,255];
    while(parent) { const value=rgba(getComputedStyle(parent).backgroundColor);if(value[3]===255){background=value;break;}parent=parent.parentElement; }
    const a=luminance(rgba(getComputedStyle(element).color)),b=luminance(background);
    return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  for(const width of [320,375,414,768]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    const title=await meal.locator('.meal-card-title').boundingBox();
    expect(title!.width).toBeGreaterThan(60);
    await meal.scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath(`meal-review-${width}.png`),animations:'disabled'});
  }
});

test('a photo from Today explicitly resolves an older meal draft instead of losing either selection', async ({page}) => {
  await register(page);
  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  await page.goto('/nutrition?date=2026-10-01');
  await page.getByRole('button', {name:'手动添加食物',exact:true}).click();
  const composer=page.getByRole('region', {name:'快速记餐'});
  await reveal(composer.getByLabel('餐次名称（可选）'));
  await composer.getByLabel('餐次名称（可选）').fill('旧日期未保存草稿');
  async function takeFromToday() {
    await page.locator('.mobile-dock, .rail-nav').getByRole('button',{name:/^今天/}).filter({visible:true}).click();
    const camera=page.waitForEvent('filechooser');
    await page.getByRole('button',{name:'拍照记一餐',exact:true}).click();
    await (await camera).setFiles(photo);
    await expect(page.getByRole('region',{name:'处理新选照片'})).toBeVisible();
  }
  await takeFromToday();
  await expect(composer.getByLabel('餐次名称（可选）')).toHaveValue('旧日期未保存草稿');
  await page.getByRole('button',{name:'取消新照片，保留当前草稿',exact:true}).click();
  await expect(composer.getByLabel('餐次名称（可选）')).toHaveValue('旧日期未保存草稿');
  await takeFromToday();
  page.once('dialog', dialog=>dialog.accept());
  await page.getByRole('button',{name:'放弃当前草稿，使用新照片',exact:true}).click();
  await expect(composer.getByRole('img',{name:'待上传的餐食照片'})).toBeVisible();
  await expect(composer.locator('.compact-metadata summary')).toContainText(today);
  await expect(composer.getByLabel('餐次名称（可选）')).toHaveValue('');
});

test('a second photo remains pending while the first photo is being prepared', async ({page}) => {
  await page.addInitScript(() => {
    const original=window.createImageBitmap.bind(window);let count=0;
    window.createImageBitmap=async (input:ImageBitmapSource)=>{
      const sequence=++count;
      if(sequence===1) await new Promise<void>(resolve=>{(window as Window & {releaseFirstPhoto?:()=>void}).releaseFirstPhoto=resolve;});
      const result=await original(input);
      if(sequence===1) (window as Window & {firstPreparationCompleted?:boolean}).firstPreparationCompleted=true;
      return result;
    };
  });
  await register(page);
  await page.goto('/nutrition');
  const gallery=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'相册记一餐',exact:true}).click();
  await (await gallery).setFiles({...photo,name:'first.png'});
  await expect(page.getByText('正在准备照片，请稍候…')).toBeVisible();
  await page.locator('.mobile-dock, .rail-nav').getByRole('button',{name:/^今天/}).filter({visible:true}).click();
  const camera=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'拍照记一餐',exact:true}).click();
  await (await camera).setFiles({...photo,name:'second.png'});
  await expect(page).toHaveURL(/\/nutrition/);
  await page.locator('.mobile-dock, .rail-nav').getByRole('button',{name:/^历史/}).filter({visible:true}).click();
  await page.evaluate(()=>(window as Window & {releaseFirstPhoto?:()=>void}).releaseFirstPhoto?.());
  await expect.poll(()=>page.evaluate(()=>(window as Window & {firstPreparationCompleted?:boolean}).firstPreparationCompleted)).toBe(true);
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await expect(page).toHaveURL(/\/history/);
  await page.locator('.mobile-dock, .rail-nav').getByRole('button',{name:/^饮食/}).filter({visible:true}).click();
  await expect(page.getByRole('region',{name:'处理新选照片'})).toBeVisible();
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'放弃当前草稿，使用新照片',exact:true}).click();
  await expect(page.getByRole('region',{name:'快速记餐'}).getByText('second.png',{exact:true})).toBeVisible();
});

test('an unavailable meal link returns the actual day list instead of hiding its meals', async ({page})=>{
  await register(page);
  const date=await page.evaluate(()=>new Date().toLocaleDateString('en-CA'));
  const response=await page.request.post('/api/v1/nutrition/meals',{data:{localDate:date,occurredAt:new Date().toISOString(),timeZone:'Asia/Shanghai',name:'仍然存在的餐食',note:null}});
  expect(response.ok()).toBe(true);
  await page.goto(`/nutrition?date=${date}&mealId=11111111-1111-4111-8111-111111111111`);
  await expect(page.getByText('这顿饭已改期或删除，当前显示这一天的餐食。')).toBeVisible();
  await expect(page.locator('.meal-card').getByText('仍然存在的餐食',{exact:true})).toBeVisible();
});

test('preparing an existing meal photo cannot enable an unfinished new photo submission', async ({page})=>{
  await page.addInitScript(()=>{
    const original=window.createImageBitmap.bind(window);let count=0;
    window.createImageBitmap=async(input:ImageBitmapSource)=>{
      const sequence=++count;
      if(sequence<=2) await new Promise<void>(resolve=>{(window as unknown as Record<string,unknown>)[`releasePhoto${sequence}`]=resolve;});
      return original(input);
    };
  });
  await register(page);
  const date=await page.evaluate(()=>new Date().toLocaleDateString('en-CA'));
  const meal=await (await page.request.post('/api/v1/nutrition/meals',{data:{localDate:date,occurredAt:new Date().toISOString(),timeZone:'Asia/Shanghai',name:'已有餐食',note:null}})).json();
  await page.goto(`/nutrition?date=${date}&mealId=${meal.id}`);
  await page.getByRole('button',{name:'照片与识别',exact:true}).click();
  await page.locator('.meal-card').getByLabel('从相册选择餐食照片',{exact:true}).setInputFiles({...photo,name:'existing.png'});
  await expect(page.getByText('正在准备照片，请稍候…')).toBeVisible();
  await page.locator('.mobile-dock, .rail-nav').getByRole('button',{name:/^今天/}).filter({visible:true}).click();
  const camera=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'拍照记一餐',exact:true}).click();
  await (await camera).setFiles({...photo,name:'new.png'});
  await expect(page).toHaveURL(/\/nutrition/);
  await page.evaluate(()=>(window as Window & {releasePhoto1?:()=>void}).releasePhoto1?.());
  await expect.poll(()=>page.evaluate(()=>typeof(window as Window & {releasePhoto2?:()=>void}).releasePhoto2)).toBe('function');
  const composer=page.getByRole('region',{name:'快速记餐'});
  await expect(composer.getByRole('button',{name:'保存这餐',exact:true})).toBeDisabled();
  await page.evaluate(()=>(window as Window & {releasePhoto2?:()=>void}).releasePhoto2?.());
  await expect(composer.getByText('new.png',{exact:true})).toBeVisible();
  await expect(composer.getByRole('button',{name:'保存这餐并上传',exact:true})).toBeEnabled();
  expect(await (await page.request.get(`/api/v1/nutrition/meals?from=${date}&to=${date}`)).json()).toHaveLength(1);
});

test('another meal cannot hide or replace an unsaved food correction', async ({page})=>{
  await register(page);
  const date=await page.evaluate(()=>new Date().toLocaleDateString('en-CA'));
  for(const name of ['餐食A','餐食B']) {
    const meal=await (await page.request.post('/api/v1/nutrition/meals',{data:{localDate:date,occurredAt:new Date().toISOString(),timeZone:'Asia/Shanghai',name,note:null}})).json();
    expect((await page.request.post(`/api/v1/nutrition/meals/${meal.id}/contributions`,{data:{mealRevision:meal.revision,replaceExisting:false,mode:'item',label:name+'的食物',portionAmount:1,portionUnit:'份',basisDescription:'fake local test',energyKcal:null,proteinGrams:null,carbohydrateGrams:null,fatGrams:null}})).ok()).toBe(true);
  }
  await page.goto(`/nutrition?date=${date}`);
  const a=page.locator('.meal-card').filter({has:page.locator('header strong',{hasText:'餐食A'})});
  const b=page.locator('.meal-card').filter({has:page.locator('header strong',{hasText:'餐食B'})});
  await a.getByRole('button',{name:'打开餐食',exact:true}).click();
  await a.getByRole('button',{name:'编辑食物：餐食A的食物'}).click();
  await a.getByLabel('食物名称').fill('未保存的A修改');
  await page.getByRole('button',{name:'返回当天餐食',exact:true}).click();
  await b.getByRole('button',{name:'打开餐食',exact:true}).click();
  await b.getByRole('button',{name:'编辑食物：餐食B的食物'}).click();
  await expect(page.getByRole('alert')).toContainText('请先保存或取消');
  await page.getByRole('button',{name:'继续未保存的修改',exact:true}).click();
  await expect(a.getByLabel('食物名称')).toHaveValue('未保存的A修改');
  await a.getByRole('button',{name:'取消修改'}).click();
  await page.getByRole('button',{name:'返回当天餐食',exact:true}).click();
  await b.getByRole('button',{name:'打开餐食',exact:true}).click();
  await b.getByRole('button',{name:'编辑食物：餐食B的食物'}).click();
  await expect(b.getByLabel('食物名称')).toHaveValue('餐食B的食物');
});
