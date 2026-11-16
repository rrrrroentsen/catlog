// 截图看界面：node dev/shots.js [light|dark] [输出目录]
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { start } = require('./server.js');
(async () => {
  const scheme = process.argv[2] === 'dark' ? 'dark' : 'light';
  const out = process.argv[3] || path.join(__dirname, '..', 'shots');
  fs.mkdirSync(out, { recursive: true });
  const s = await start();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: Number(process.env.DPR || 1), hasTouch: true, isMobile: true, colorScheme: scheme, locale: 'zh-CN', timezoneId: 'America/Chicago' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(s.site);
  await page.evaluate(() => localStorage.setItem('catlog:v1:demo', '1'));
  await page.reload();
  await page.waitForSelector('.hero');
  await page.waitForTimeout(900);
  const shot = async (name, full) => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(out, scheme + '-' + name + '.png'), fullPage: !!full }); };
  await shot('home', true);
  for (const tab of ['timeline', 'growth', 'records']) {
    await page.click('#tabs [data-tab="' + tab + '"]');
    await page.waitForTimeout(700);
    await shot(tab, tab !== 'timeline');
  }
  for (const seg of ['deworm', 'care', 'health', 'insure', 'docs']) { await page.click('.seg.big [data-v="' + seg + '"]'); await shot('records-' + seg, seg === 'insure'); }
  await page.click('.seg.big [data-v="care"]'); await page.click('.care-main'); await shot('care-sheet'); await page.click('.sheet-h [data-act="sheet-close"]');
  await page.click('.seg.big [data-v="insure"]'); await page.click('[data-act="claim-add"]'); await shot('form-claim'); await page.click('.sheet-h [data-act="sheet-close"]');
  await page.click('[data-act="policy-edit"]'); await shot('form-policy'); await page.click('.sheet-h [data-act="sheet-close"]');
  await page.click('#tabs .fab'); await shot('add-menu');
  await page.click('.addgrid [data-kind="vaccine"]'); await shot('form-vaccine');
  await page.click('.sheet-h [data-act="sheet-close"]');
  await page.click('#tabs [data-tab="home"]');
  await page.click('[data-act="day"]'); await shot('day-sheet');
  await page.click('.sheet-h [data-act="sheet-close"]');
  await page.click('.hero-w'); await shot('form-weight');
  await page.click('.sheet-h [data-act="sheet-close"]');
  await page.click('#tabs [data-tab="timeline"]');
  await page.click('.tl-item .ph'); await page.waitForTimeout(900); await shot('viewer');
  await page.click('[data-act="vw-close"]');
  await page.click('.tl-item'); await shot('detail');
  await page.click('.sheet-h [data-act="sheet-close"]');
  await page.click('[data-act="go"][data-tab="prefs"]'); await shot('prefs', true);
  if (errors.length) console.log('控制台报错：\n' + errors.join('\n'));
  console.log('截图在 ' + out);
  await browser.close(); s.stop();
})().catch((e) => { console.error(e); process.exit(1); });
