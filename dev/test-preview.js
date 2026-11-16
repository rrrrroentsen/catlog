// 预览版（单文件）的测试：放进一个模仿 Artifact 页面壳的页面里，禁止一切网络请求。node dev/test-preview.js
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const FILE = process.argv[2] || path.join(__dirname, '..', 'preview', 'catlog-preview.html');
const SHOTS = process.env.SHOTS || '';
const content = fs.readFileSync(FILE, 'utf8');
// 发布时外面会包上这样一层：只有字符集、视口、一点点基础样式
const shell = (theme, body) => '<!doctype html><html' + (theme ? ' data-theme="' + theme + '"' : '') + '><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
  '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>' + (body == null ? content : body) + '</body></html>';

(async () => {
  let pass = 0, fail = 0;
  const browser = await chromium.launch();
  async function open(o) {
    const ctx = await browser.newContext({ viewport: { width: o.width || 393, height: 800 }, hasTouch: true, isMobile: true, locale: 'zh-CN', colorScheme: o.scheme || 'light', reducedMotion: 'reduce', deviceScaleFactor: SHOTS ? 2 : 1 });
    const page = await ctx.newPage(), errors = [], requests = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url === 'https://preview.test/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: shell(o.theme, o.content ? o.content() : null) });
      requests.push(url); return route.abort();
    });
    if (o.blank) await page.setContent(shell(o.theme)); else await page.goto('https://preview.test/');
    await page.waitForSelector('.hero');
    return { page, errors, requests, ctx };
  }
  async function t(name, fn) {
    try { await fn(); pass++; console.log('  ok  ' + name); }
    catch (e) { fail++; console.log('FAIL  ' + name + '\n      ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n      ')); }
  }
  const text = (p, sel) => p.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim());

  for (const scheme of ['light', 'dark']) {
    await t('预览版（' + scheme + '）：打开就是示例数据，四个页面都正常，不向外发请求', async () => {
      const { page, errors, requests, ctx } = await open({ scheme });
      assert.strictEqual(await text(page, '#syncpill'), '演示数据');
      assert.strictEqual(await text(page, '.hero h1'), '年糕妹妹');
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'preview-' + scheme + '-home.png') });
      for (const tab of ['timeline', 'growth', 'records']) { await page.click('#tabs [data-tab="' + tab + '"]'); await page.waitForSelector('#view[data-tab="' + tab + '"]'); await page.waitForTimeout(200); if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'preview-' + scheme + '-' + tab + '.png') }); }
      await page.waitForFunction(() => [...document.querySelectorAll('#view img[data-mid]')].every((im) => im.complete && im.naturalWidth > 0));
      assert.strictEqual(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, window.innerWidth)), 393);
      assert.strictEqual(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), scheme === 'dark' ? 'rgb(18, 21, 27)' : 'rgb(236, 239, 244)');
      assert.strictEqual(await page.evaluate(() => 'serviceWorker' in navigator ? navigator.serviceWorker.getRegistrations().then((r) => r.length) : 0), 0);
      assert.deepStrictEqual([errors, requests], [[], []]);
      await ctx.close();
    });
  }
  await t('预览版：记体重、加照片、重开页面还在；没有「退出演示」', async () => {
    const { page, errors, ctx } = await open({});
    await page.click('.hero-w'); await page.fill('#f-kg', '4.9'); await page.click('.sheet-h [data-act="sheet-save"]');
    assert.strictEqual(await text(page, '.hero-w b'), '4.90');
    await page.click('.quick [data-kind="moment"]');
    const b64 = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 600; const g = c.getContext('2d'); g.fillStyle = '#c96'; g.fillRect(0, 0, 900, 600); return c.toDataURL('image/jpeg').split(',')[1]; });
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#sheet-b [data-act="media-add"]')]);
    await chooser.setFiles([{ name: 'p.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') }]);
    await page.waitForSelector('#sheet-b .me-i'); await page.fill('#f-note', '预览里加的'); await page.click('.sheet-h [data-act="sheet-save"]');
    await page.waitForTimeout(500);
    await page.reload(); await page.waitForSelector('.hero');
    assert.strictEqual(await text(page, '.hero-w b'), '4.90');
    await page.click('#tabs [data-tab="timeline"]');
    assert.strictEqual(await text(page, '.tl-item .tl-note'), '预览里加的');
    await page.waitForFunction(() => { const im = document.querySelector('.tl-item .ph img'); return im && im.complete && im.naturalWidth > 0; });
    await page.click('[data-act="go"][data-tab="prefs"]');
    assert.strictEqual(await page.$$eval('[data-act="demo-off"]', (e) => e.length), 0);
    assert.strictEqual(await page.$$eval('[data-act="resync"]', (e) => e.length), 0);
    // 文件：能取到，但预览里没有「打开」和「保存」的链接
    await page.click('[data-act="go"][data-tab="home"]'); await page.click('#tabs [data-tab="records"]'); await page.click('.seg.big [data-v="docs"]');
    await page.click('.row.doc:has-text("年度体检报告")'); await page.click('.filechip'); await page.click('[data-act="file-get"]'); await page.waitForSelector('#file-done');
    assert.strictEqual(await page.$$eval('#sheet-b a', (a) => a.length), 0);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });
  await t('预览版：护理「今天做了」、保险的数字、记一笔理赔，重开页面还在', async () => {
    const { page, errors, requests, ctx } = await open({});
    const texts = (sel) => page.$$eval(sel, (es) => es.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    assert.deepStrictEqual(await texts('.carechip'), ['剪指甲27 天前', '刷牙13 天前', '洗澡61 天前']);
    await page.click('.carechip[data-type="nail"]'); await page.click('.sheet [data-act="care-done"]'); await page.click('.sheet-h [data-act="sheet-close"]');
    assert.strictEqual(await text(page, '.carechip[data-type="nail"] span'), '今天');
    await page.click('#tabs [data-tab="records"]'); await page.click('.seg.big [data-v="insure"]');
    assert.strictEqual(await page.$$eval('.notice', (e) => e.length), 0);                       // 演示数据不走后端，不该出现「后端要先更新」
    assert.deepStrictEqual(await texts('.pol .meter-f'), ['还剩 $9,971.20', '已经抵满']);
    await page.click('[data-act="claim-add"]'); await page.fill('#f-title', '预览里的理赔'); await page.fill('#f-bill', '100'); await page.fill('#f-paid', '71.2'); await page.click('.sheet-h [data-act="sheet-save"]');
    assert.strictEqual((await texts('.pol .meter-f'))[0], '还剩 $9,900');
    assert.strictEqual(await text(page, '#syncpill'), '演示数据');
    await page.waitForTimeout(400);
    await page.reload(); await page.waitForSelector('.pol');                  // 重开以后还在刚才那一页
    assert.deepStrictEqual([(await texts('.pol .meter-f'))[0], (await texts('.pol .rows .row-t b'))[0]], ['还剩 $9,900', '预览里的理赔']);
    await page.click('#tabs [data-tab="home"]');
    assert.strictEqual(await text(page, '.carechip[data-type="nail"] span'), '今天');
    await page.click('#tabs [data-tab="records"]'); await page.click('.seg.big [data-v="insure"]');
    assert.deepStrictEqual([(await texts('.pol .meter-f'))[0], (await texts('.pol .rows .row-t b'))[0]], ['还剩 $9,900', '预览里的理赔']);
    assert.deepStrictEqual([errors, requests], [[], []]);
    await ctx.close();
  });
  await t('预览版：以前打开过上一版预览的人，这次也能看到保险和护理的示例；当时自己加的还在', async () => {
    // 用 1.0.0 的网页文件现拼一份旧的预览版，先打开它，再把同一个地址换成新的预览版
    const os = require('os'), { execFileSync } = require('child_process');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'catlog-oldpreview-')), oldFile = path.join(tmp, 'old.html');
    execFileSync('node', [path.join(__dirname, 'build-preview.js'), oldFile], { env: Object.assign({}, process.env, { CATLOG_APP: path.join(__dirname, 'fixtures', 'web-1.0.0') }), stdio: 'pipe' });
    let now = fs.readFileSync(oldFile, 'utf8');
    fs.rmSync(tmp, { recursive: true, force: true });
    const { page, errors, requests, ctx } = await open({ content: () => now });
    const texts = (sel) => page.$$eval(sel, (es) => es.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    await page.click('[data-act="go"][data-tab="prefs"]'); assert.strictEqual(await text(page, '.about'), 'CatLog 猫咪日志 v1.0.0 · 后端 v1.0.0');
    await page.click('[data-act="go"][data-tab="home"]'); await page.click('.hero-w'); await page.fill('#f-kg', '4.9'); await page.click('.sheet-h [data-act="sheet-save"]');
    assert.strictEqual(await text(page, '.hero-w b'), '4.90');
    await page.waitForTimeout(400);
    now = content;
    await page.reload(); await page.waitForSelector('.hero');
    assert.deepStrictEqual([await text(page, '.hero-w b'), await texts('.carechip')], ['4.90', ['剪指甲27 天前', '刷牙13 天前', '洗澡61 天前']]);
    await page.click('#tabs [data-tab="records"]'); await page.click('.seg.big [data-v="insure"]'); await page.waitForSelector('.pol');
    assert.deepStrictEqual(await texts('.pol .meter-f'), ['还剩 $9,971.20', '已经抵满']);
    assert.deepStrictEqual([errors, requests], [[], []]);
    await ctx.close();
  });
  await t('预览版：存不了东西的环境（生成缩略图时就是这样）也能显示', async () => {
    const { page, errors, ctx } = await open({ blank: true });
    assert.strictEqual(await text(page, '.hero h1'), '年糕妹妹');
    await page.click('[data-act="day-ok"]');
    assert.strictEqual(await text(page, '.today-ok'), '一切正常');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });
  await t('预览版：外面的页面指定了深色或浅色时跟着走；自己选了再改回「跟随系统」也不乱', async () => {
    const { page, ctx } = await open({ scheme: 'light', theme: 'dark' });
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.strictEqual(await bg(), 'rgb(18, 21, 27)');
    assert.strictEqual(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
    const b = await open({ scheme: 'dark', theme: 'light' });
    assert.strictEqual(await b.page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(236, 239, 244)');
    await b.ctx.close(); await ctx.close();
  });
  await t('预览版：320 宽也不超宽', async () => {
    const { page, ctx } = await open({ width: 320 });
    for (const tab of ['timeline', 'growth', 'home', 'records']) { await page.click('#tabs [data-tab="' + tab + '"]'); await page.waitForSelector('#view[data-tab="' + tab + '"]'); assert.strictEqual(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, window.innerWidth)), 320, tab); }
    for (const seg of ['deworm', 'care', 'health', 'insure', 'docs']) { await page.click('.seg.big [data-v="' + seg + '"]'); assert.strictEqual(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, window.innerWidth)), 320, seg); }
    await ctx.close();
  });
  await browser.close();
  console.log('\n' + pass + ' 项通过' + (fail ? '，' + fail + ' 项失败' : ''));
  process.exit(fail ? 1 : 0);
})();
