// 端到端测试：Chromium 模拟 iPhone，接上模拟的 Apps Script 后端（真实的 Code.gs）。
// node dev/test-e2e.js            跑全部
// node dev/test-e2e.js 离线        只跑名字里带「离线」的
'use strict';
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const { start } = require('./server.js');

const ONLY = process.argv[2] || '';
// 页面元素的句柄不能直接拿去比：一旦对不上，assert 会把它连着的整个浏览器对象都展开来写报错，内存一下子吃光，测试进程被系统杀掉，什么也不说。
// 所以先把句柄换成一个短短的记号再比（p.$(…) 找不到时是 null，找到了就是这个记号）。
function plain(v) {
  if (Array.isArray(v)) return v.map(plain);
  return v && typeof v === 'object' && typeof v.evaluate === 'function' && typeof v.dispose === 'function' ? '[页面上有这个元素]' : v;
}
function eq(actual, expected, msg) {
  actual = plain(actual);
  try { assert.deepStrictEqual(actual, expected); }
  catch (e) { const err = new Error((msg ? msg + '\n' : '') + '实际：' + JSON.stringify(actual) + '\n期望：' + JSON.stringify(expected)); Error.captureStackTrace(err, eq); throw err; }
}
// 默认关掉动画（量颜色、量位置时不会正好量到动画的半路上）；第一项测试开着动画跑
const IPHONE = { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'zh-CN', timezoneId: 'America/Chicago', reducedMotion: 'reduce' };
let browser, pass = 0, fail = 0;
const tests = [];
function t(name, fn) { tests.push([name, fn]); }

// 一个「世界」：一套服务器 + 若干部手机
async function world(opts) {
  const s = await start(opts);
  const ctxs = [], errors = [];
  async function open(url, o) {
    const ctx = await browser.newContext(Object.assign({}, IPHONE, o || {}));
    ctxs.push(ctx);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|ERR_/.test(m.text())) errors.push('console: ' + m.text()); });
    if (o && o.init) await page.addInitScript(o.init);
    await page.goto(url);
    return page;
  }
  return {
    s, env: s.env, ctl: s.ctl, errors,
    phone: (who, o) => open(s.link(who), o),
    demo: async (o) => { const p = await open(s.site, o); await p.click('[data-act="demo-on"]'); await p.waitForSelector('.hero'); return p; },
    plain: (o) => open(s.site, o),
    async close() { for (const c of ctxs) await c.close(); s.stop(); },
  };
}
const synced = (page) => page.waitForFunction(() => { const p = document.querySelector('#syncpill'); return !!p && p.classList.contains('ok'); }, null, { timeout: 15000 });
const pill = (page) => page.$eval('#syncpill', (e) => e.textContent.trim());
const poke = (page) => page.evaluate(() => window.dispatchEvent(new Event('online')));   // 让这部手机马上同步一次
const save = (page) => page.click('.sheet-h [data-act="sheet-save"]');
const closeSheet = (page) => page.click('.sheet-h [data-act="sheet-close"]');
const tab = async (page, name) => { await page.click('#tabs [data-tab="' + name + '"]'); await page.waitForSelector('#view[data-tab="' + name + '"]'); };
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim());
const texts = (page, sel) => page.$$eval(sel, (es) => es.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
const toastText = (page) => page.waitForSelector('.toast').then((e) => e.textContent()).then((x) => x.replace(/撤销$/, '').trim());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reload = async (page) => { await page.reload(); await page.waitForSelector('#view[data-tab] > *'); };     // 重开页面（会回到刚才那个标签页）
// 页面上现在看得见的文字里，和背景对比不够的那些（正文 4.5，大字 3）
const lowContrast = (page) => page.evaluate(() => {
    function parse(c) { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const v = m[1].split(/[ ,/]+/).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; }
    function lum(c) { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); }
    function over(top, under) { const a = top.a; return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 }; }
    function bgOf(el) {
      const stack = [];
      for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (/gradient|url/.test(cs.backgroundImage) && e !== document.body && !e.matches('.tl-items')) return null; const c = parse(cs.backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } }
      let base = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
      return base;
    }
    const out = [], seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const s = n.nodeValue.trim(), el = n.parentElement;
      if (!s || !el || el.closest('script, style, noscript, .viewer, [hidden]')) continue;
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      if (cs.visibility === 'hidden' || cs.display === 'none' || !r.width || +cs.opacity < 0.5 || el.closest('button:disabled')) continue;
      let op = 1; for (let e = el; e; e = e.parentElement) op *= +getComputedStyle(e).opacity;
      if (op < 0.5) continue;
      const fg = parse(cs.color), bg = bgOf(el);
      if (!fg || !bg) continue;
      const c = over(Object.assign({}, fg, { a: fg.a * op }), bg), l1 = lum(c), l2 = lum(bg), ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 600, need = size >= 24 || (size >= 18.5 && bold) ? 3 : 4.5;
      const key = el.className + '|' + cs.color + '|' + Math.round(ratio * 10);
      if (ratio < need && !seen.has(key)) { seen.add(key); out.push(s.slice(0, 12) + ' [' + (el.className || el.tagName) + '] ' + ratio.toFixed(2) + ' < ' + need); }
    }
    return out;
  });
async function until(fn, what, ms) {
  const end = Date.now() + (ms || 8000);
  for (;;) { let v; try { v = await fn(); } catch (e) { v = false; } if (v) return v; if (Date.now() > end) throw new Error('等不到：' + what); await sleep(60); }
}
async function addPet(page, name, extra) {
  await page.click('[data-act="pet-add"]');
  await page.fill('#f-name', name);
  for (const k of Object.keys(extra || {})) await page.fill('#f-' + k, extra[k]);
  await save(page);
  await page.waitForSelector('.hero');
}
async function addWeight(page, v, date) {
  await page.click('.fab'); await page.click('.addgrid [data-kind="weight"]');
  await page.fill('#f-kg', String(v));
  if (date) await page.fill('#f-date', date);
  await save(page);
  await page.waitForSelector('#sheet-root:empty', { state: 'attached' });
}
// 在页面里画一张测试图片，返回可以交给文件选择框的东西
async function picture(page, name, w, h, hue) {
  const b64 = await page.evaluate(([w, h, hue]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, 'hsl(' + hue + ',70%,60%)'); gr.addColorStop(1, 'hsl(' + (hue + 80) + ',70%,35%)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) { g.fillStyle = 'hsla(' + (hue + i * 13) + ',80%,' + (30 + i % 50) + '%,.6)'; g.beginPath(); g.arc((i * 97) % w, (i * 57) % h, 20 + (i * 7) % 60, 0, 7); g.fill(); }
    return c.toDataURL(/\.png$/.test(name) ? 'image/png' : 'image/jpeg', 0.9).split(',')[1];
  }, [w || 1200, h || 900, hue || 200]).catch(() => '');
  return { name, mimeType: /\.png$/.test(name) ? 'image/png' : 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<</Type/Catalog>>\nendobj\ntrailer\n<</Root 1 0 R>>\n%%EOF\n' + 'x'.repeat(4000));
async function pick(page, sel, files) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(sel)]);
  await chooser.setFiles(files);
}
const loaded = (page, sel) => until(() => page.$eval(sel, (im) => im.complete && im.naturalWidth > 0), '图片显示出来：' + sel, 12000);
const live = (rows) => rows.filter((r) => r.deleted !== true);

/* ============ 演示模式 ============ */
t('演示：四个页面都能打开，不发任何接口请求，没有报错', async () => {
  const w = await world(); const p = await w.demo({ reducedMotion: 'no-preference' });
  eq(await text(p, '.hero h1'), '年糕妹妹');
  eq((await texts(p, '.rem-row b')).length, 3);
  for (const name of ['timeline', 'growth', 'records', 'home']) await tab(p, name);
  await tab(p, 'growth'); await p.waitForSelector('#wchart svg');
  await tab(p, 'records');
  for (const seg of ['deworm', 'health', 'docs', 'vaccine']) { await p.click('.seg.big [data-v="' + seg + '"]'); await p.waitForSelector('.seg.big [data-v="' + seg + '"].on'); }
  await p.click('[data-act="go"][data-tab="prefs"]'); await p.waitForSelector('#view[data-tab="prefs"]');
  eq(w.ctl.log.length, 0); eq(w.errors, []);
  await w.close();
});
t('演示：一键「一切正常」、撤销、逐项记录、日历和「异常」筛选', async () => {
  const w = await world(); const p = await w.demo();
  await p.click('[data-act="day-ok"]');
  eq(await text(p, '.today-ok'), '一切正常'); eq(await toastText(p), '记下了：一切正常');
  await p.click('[data-act="toast-undo"]');
  await p.waitForSelector('[data-act="day-ok"]');
  await p.click('.today [data-act="day"]');
  await p.click('#sheet-b [data-k="app"] [data-v="2"]'); await p.click('#sheet-b [data-k="vomit"] [data-v="2"]'); await p.click('#sheet-b [data-k="flags"] [data-v="eye"]');
  await p.click('[data-act="day-fill"]');
  eq(await p.$$eval('#sheet-b .chips[data-k] .chip[aria-pressed="true"]', (es) => es.map((e) => e.textContent)), ['偏少', '正常', '正常', '正常', '正常', '2 次', '流泪眼屎']);
  await p.fill('#f-note', '下午吐了两次'); await save(p);
  eq(await texts(p, '.today .st.s2, .today .st.s3'), ['食欲 偏少', '呕吐 2 次', '流泪眼屎']);
  await tab(p, 'growth');
  eq(await p.$eval('.cal-c.today', (e) => e.className.includes('lv3')), true);
  eq(await p.$eval('.cal-c.today', (e) => e.getAttribute('aria-label').endsWith('异常')), true);
  await tab(p, 'timeline'); await p.click('.chips [data-v="alert"]');
  eq((await text(p, '.tl-item')).includes('下午吐了两次'), true);
  // 把今天的清空：这一天的记录没了
  await p.click('.tl-item'); await p.click('[data-act="form-del"]');
  eq(await toastText(p), '删掉了');
  eq((await texts(p, '.tl-note')).includes('下午吐了两次'), false);
  await p.click('[data-act="toast-undo"]');
  await until(async () => (await texts(p, '.tl-note')).includes('下午吐了两次'), '撤销后回来');
  eq(w.errors, []); await w.close();
});
t('演示：记体重、填错的提示、修改、删除和撤销', async () => {
  const w = await world(); const p = await w.demo();
  await p.click('.hero-w');
  await save(p); eq(await text(p, '#sheet-err'), '体重要填一个数字，比如 4.25。');
  await p.fill('#f-kg', '四公斤'); await save(p); eq((await text(p, '#sheet-err')).length > 0, true);
  await p.fill('#f-kg', '4,80'); await p.fill('#f-note', '饭后'); await save(p);
  eq(await text(p, '.hero-w b'), '4.80'); eq(await text(p, '.hero-w em'), '+0.18');
  await tab(p, 'growth');
  eq(await text(p, '.wnow b'), '4.80'); eq(await text(p, '.wsvg .endlabel'), '4.80 kg');
  await p.click('[data-act="wlist"]');
  eq((await texts(p, '.wtable tbody tr:first-child td')).slice(2), ['4.80', '+0.18']);
  await p.click('.wtable tbody tr:first-child'); await p.click('[data-act="edit"]');
  eq(await p.inputValue('#f-kg'), '4.80'); await p.fill('#f-kg', '4.7'); await save(p);
  eq(await text(p, '.wnow b'), '4.70');
  await p.click('.wtable tbody tr:first-child'); await p.click('[data-act="edit"]'); await p.click('[data-act="form-del"]');
  eq(await text(p, '.wnow b'), '4.62');
  await p.click('[data-act="toast-undo"]'); await until(async () => (await text(p, '.wnow b')) === '4.70', '撤销删除');
  // 将来的日期不让记
  await p.click('.fab'); await p.click('.addgrid [data-kind="weight"]'); await p.fill('#f-kg', '5'); await p.fill('#f-date', '2031-01-01'); await save(p);
  eq(await text(p, '#sheet-err'), '日期不能是将来。');
  eq(w.errors, []); await w.close();
});
t('演示：体重曲线能拖着看，范围和单位能换', async () => {
  const w = await world(); const p = await w.demo();
  await tab(p, 'growth');
  const box = await p.$eval('#wchart svg', (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await p.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.5);
  await p.waitForSelector('.wtip:not([hidden])');
  const tip = await text(p, '.wtip');
  eq(/^\d\.\d\d kg[+−±]\d\.\d\d\d{4}\/\d+\/\d+ · /.test(tip), true, tip);
  await p.focus('#wchart'); await p.keyboard.press('End');
  eq((await text(p, '.wtip')).startsWith('4.62 kg'), true);
  await p.keyboard.press('ArrowLeft'); eq((await text(p, '.wtip')).startsWith('4.62 kg'), false);
  await p.keyboard.press('Home'); eq((await text(p, '.wtip')).startsWith('0.92 kg'), true);
  // 长大了：最近一次的点比第一次的点高（y 更小），并且在画框里面
  eq(await p.evaluate(() => { const e = document.querySelector('.wsvg .end'), d = document.querySelector('.wsvg .dot'), h = +document.querySelector('.wsvg').getAttribute('height'); return +e.getAttribute('cy') < +d.getAttribute('cy') && +e.getAttribute('cy') > 0 && +d.getAttribute('cy') < h; }), true);
  const all = await p.$$eval('.wsvg .dot', (e) => e.length);
  await p.click('.wcard .seg [data-v="3m"]');
  await until(async () => (await p.$$eval('.wsvg .dot', (e) => e.length)) < all, '范围缩小后点变少');
  eq(await p.$eval('.wsvg', (e) => e.getAttribute('aria-label').includes('体重曲线')), true);
  await p.click('[data-act="go"][data-tab="prefs"]'); await p.click('[data-act="unit"][data-v="lb"]');
  await p.click('[data-act="go"][data-tab="home"]');
  eq(await text(p, '.hero-w b'), '10.19'); eq((await text(p, '.hero-w i')).startsWith('lb'), true);
  await tab(p, 'growth'); eq(await text(p, '.wsvg .endlabel'), '10.19 lb');
  eq(w.errors, []); await w.close();
});
t('演示：疫苗表单、往后推的按钮、状态板上的章、提醒跳转', async () => {
  const w = await world(); const p = await w.demo();
  eq(await texts(p, '.rem-row b'), ['内外同驱已过期 5 天', '复查：牙龈有点红', '狂犬疫苗 还有 19 天']);
  await p.click('.rem-row.lv3');
  await p.waitForSelector('#view[data-tab="records"]');
  eq(await p.$eval('.seg.big .on', (e) => e.textContent), '驱虫');
  eq(await p.$eval('.shot', (e) => e.className.includes('st-over')), true); eq(await text(p, '.shot .stamp text'), '已过期');
  await p.click('.board [data-act="add"]');
  eq(await p.$('#sheet-b [data-presets] .chip[aria-pressed="true"]'), null);     // 从大按钮进来：哪种都没预选
  await closeSheet(p);
  await p.click('.shot'); await p.click('#sheet-b [data-act="add"]');
  eq(await p.inputValue('#f-name'), '内外同驱');
  await p.click('.steps [data-m="1"]');
  const today = await p.inputValue('#f-date'), next = await p.inputValue('#f-next_due');
  eq(next.slice(8), today.slice(8)); eq(next > today, true);
  await p.fill('#f-product', '示例滴剂'); await save(p);
  eq(await p.$eval('.shot', (e) => e.className.includes('st-ok')), true); eq(await text(p, '.shot .stamp text'), '有效');   // 一个月一次的，刚做完不算「快到期」
  await tab(p, 'home');
  eq(await texts(p, '.rem-row b'), ['复查：牙龈有点红', '狂犬疫苗 还有 19 天']);
  // 自己写名字的疫苗单独成一行；下次的日期不能早于这一次
  await tab(p, 'records'); await p.click('.seg.big [data-v="vaccine"]'); await p.click('.board [data-act="add"]');
  await save(p); eq(await text(p, '#sheet-err'), '选一种，或者写上名字。');
  await p.fill('#f-name', '猫传腹疫苗'); await p.fill('#f-next_due', '2020-01-01'); await save(p);
  eq(await text(p, '#sheet-err'), '下次的日期要晚于这一次。');
  await p.click('.steps [data-clear]'); await save(p);
  eq((await texts(p, '.shot-main b')).some((x) => x.startsWith('猫传腹疫苗')), true);
  eq((await texts(p, '.shot .stamp text')).includes('已做'), true);
  // 「疫苗本」这张图同时挂在一条疫苗记录和一份文件上：从疫苗记录里拿掉，文件那边还在
  await p.click('.rows .row:has(.i.dim:first-of-type):has-text("加强")'); await p.click('[data-act="edit"]');
  await p.click('#sheet-b .me-i .me-x'); await save(p);
  await p.click('.seg.big [data-v="docs"]'); await p.click('.row.doc:has-text("疫苗本")');
  await loaded(p, '#sheet-b .ph img'); await closeSheet(p);
  eq(w.errors, []); await w.close();
});
t('演示：加照片、看大图、左右换张、重开页面还在', async () => {
  const w = await world(); const p = await w.demo();
  await p.click('.quick [data-kind="moment"]');
  await save(p); eq(await text(p, '#sheet-err'), '加一张照片，或者写点什么。');
  await pick(p, '#sheet-b [data-act="media-add"]', [await picture(p, 'a.jpg', 3000, 2000, 10), await picture(p, 'b.png', 800, 1400, 120)]);
  await p.waitForSelector('#sheet-b .me-i:nth-child(2)');
  await p.fill('#f-note', '新玩具到了'); await save(p);
  await tab(p, 'timeline');
  eq(await text(p, '.tl-item .tl-note'), '新玩具到了');
  eq(await p.$eval('.tl-item', (e) => e.querySelectorAll('.ph img').length), 2);
  await loaded(p, '.tl-item .ph img');
  const dims = await p.$eval('.tl-item .ph img', (im) => [im.naturalWidth, im.naturalHeight]);
  eq(dims[0] <= 480 && dims[1] <= 480 && Math.min(dims[0], dims[1]) >= 200, true, '缩略图尺寸 ' + dims);
  await p.click('.tl-item .ph');
  await loaded(p, '#vw-img'); await p.waitForSelector('#vw-img.hd');
  eq(await p.$eval('#vw-img', (im) => Math.max(im.naturalWidth, im.naturalHeight)), 1600);       // 原图缩到最长边 1600
  eq(await text(p, '#vw-n'), '1 / 2'); eq(await text(p, '#vw-cap b'), '新玩具到了');
  await p.keyboard.press('ArrowRight'); eq(await text(p, '#vw-n'), '2 / 2');
  await loaded(p, '#vw-img');
  eq(await p.$eval('#vw-img', (im) => [im.naturalWidth, im.naturalHeight]), [800, 1400]);
  await p.keyboard.press('Escape'); eq(await p.$('#viewer-root .viewer'), null);
  await reload(p); await tab(p, 'timeline');
  eq(await text(p, '.tl-item .tl-note'), '新玩具到了'); await loaded(p, '.tl-item .ph img');
  await tab(p, 'growth');
  eq((await text(p, '.vs-i:last-child span')).length > 0, true);
  eq(w.errors, []); await w.close();
});
t('演示：传文件、取文件、内容原样；退出演示后回到欢迎页', async () => {
  const w = await world(); const p = await w.demo();
  await tab(p, 'records'); await p.click('.seg.big [data-v="docs"]');
  eq((await texts(p, '.row.doc .row-t b')).sort(), ['年度体检报告', '疫苗本', '绝育手术记录']);
  await p.click('[data-act="add"][data-kind="doc"]');
  await save(p); eq(await text(p, '#sheet-err'), '先选文件：拍照、相册里的图片或 PDF。');
  await pick(p, '#sheet-b [data-act="media-add"]', [{ name: '保险单 2026.pdf', mimeType: 'application/pdf', buffer: PDF }]);
  await p.waitForSelector('#sheet-b .me-f');
  eq(await p.inputValue('#f-title'), '保险单 2026');           // 没填名字时用文件名
  await p.click('#sheet-b [data-k="category"] [data-v="insure"]'); await save(p);
  eq((await texts(p, '.row.doc .row-t b'))[0], '保险单 2026');
  await p.click('.row.doc'); await p.click('.filechip'); await p.click('[data-act="file-get"]');
  await p.waitForSelector('#file-open');
  const got = await p.evaluate(async () => { const r = await fetch(document.querySelector('#file-open').href); return [r.headers.get('content-type'), (await r.text()).length, document.querySelector('#file-save').getAttribute('download')]; });
  eq(got, ['application/pdf', PDF.length, '保险单 2026.pdf']);
  await closeSheet(p);
  // 示例里画出来的 PDF 也能取到
  await p.click('.row.doc:has-text("年度体检报告")'); await p.click('.filechip'); await p.click('[data-act="file-get"]'); await p.waitForSelector('#file-open');
  eq(await p.evaluate(async () => (await (await fetch(document.querySelector('#file-open').href)).text()).slice(0, 8)), '%PDF-1.4');
  await closeSheet(p);
  await p.click('[data-act="go"][data-tab="prefs"]'); await p.click('[data-act="demo-off"]');
  await p.waitForSelector('#init-text');
  eq(await p.evaluate(() => Object.keys(localStorage).filter((k) => k.indexOf('catlog:v1:demo') !== 0)), []);
  eq(w.errors, []); await w.close();
});

t('演示：补记以前的日子、标成好了、相册、那年今日、饮食和活动、外观', async () => {
  const w = await world(); const p = await w.demo();
  // 那年今日 → 点开是那条记录
  eq(await text(p, '.memory-t small'), '1 年前的今天'); await p.click('.memory');
  eq(await text(p, '.sheet .tl-note'), '第一次敢在人腿上睡'); await closeSheet(p);
  // 猫咪资料
  await p.click('.hero-av'); eq((await texts(p, '.kvs .kv span')).includes('毛色'), true); await closeSheet(p);
  // 饮食：以前填过的名字做候选；活动：分钟数要是数字
  await p.click('.quick [data-kind="food"]');
  eq((await p.$$eval('#dl-name option', (o) => o.map((x) => x.value))).includes('成猫粮（鸡肉）'), true);
  await p.click('#sheet-b [data-k="type"] [data-v="treat"]'); await p.fill('#f-name', '猫条'); await p.click('#f-change'); await p.fill('#f-date', await p.evaluate(() => { const d = new Date(Date.now() - 3 * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })); await save(p);
  await p.click('.quick [data-kind="activity"]'); await p.fill('#f-mins', '很久'); await save(p); eq(await text(p, '#sheet-err'), '时间填分钟数，比如 15。');
  await p.fill('#f-mins', '20'); await p.click('#sheet-b [data-k="type"] [data-v="nail"]'); await save(p);
  await tab(p, 'timeline');
  eq(await text(p, '.tl-item .tl-t'), '剪指甲'); eq(await text(p, '.tl-item .tl-sub'), '20 分钟');
  await p.click('.chips [data-v="food"]');
  const mine = '.tl-item:has-text("猫条")';
  eq(await text(p, mine + ' .tl-t'), '零食 · 猫条'); eq(await text(p, mine + ' .pill.tag'), '换粮');
  eq(/^\d\d:\d\d/.test(await text(p, mine + ' .tl-meta')), false);       // 补记的不带「几点」
  await reload(p); eq(await p.$eval('.chips .chip.on', (e) => e.textContent), '饮食');   // 记得上次的筛选
  // 更早的记录
  await p.click('.chips [data-v="all"]');
  const n1 = await p.$$eval('.tl-item', (e) => e.length); await p.click('[data-act="tl-more"]');
  eq((await p.$$eval('.tl-item', (e) => e.length)) > n1, true);
  while (await p.$('[data-act="tl-more"]')) await p.click('[data-act="tl-more"]');      // 一直翻到最早
  eq((await texts(p, '.tl-mark')).some((x) => x === '1 岁生日'), true); eq((await texts(p, '.tl-mark')).some((x) => x === '到家第一天'), true);
  // 日历上点以前的一天，补记
  await tab(p, 'growth'); await p.click('.cal-nav [data-d="-1"]');
  const label = await p.$eval('.cal-c.lv0:not(:disabled)', (e) => e.getAttribute('aria-label'));
  await p.click('.cal-c.lv0:not(:disabled)');
  eq((await text(p, '.sheet-h b')).startsWith(label.split('：')[0]), true);
  await p.click('#sheet-b [data-k="energy"] [data-v="1"]'); await save(p);
  eq(await p.$eval('.cal-c[aria-label="' + label.split('：')[0] + '：异常"]', (e) => e.className.includes('lv3')), true);
  eq(await p.$eval('.cal-nav [data-d="1"]', (e) => e.disabled), false); await p.click('.cal-nav [data-d="1"]'); eq(await p.$eval('.cal-nav [data-d="1"]', (e) => e.disabled), true);
  // 相册：点开一格看这个月的几张
  const tile = await p.$eval('.alb:has(.alb-n)', (e) => +e.querySelector('.alb-n').textContent); await p.click('.alb:has(.alb-n)');
  eq(await text(p, '#vw-n'), '1 / ' + tile); await p.click('[data-act="vw-close"]');
  // 健康事件标成已经好了
  await tab(p, 'records'); await p.click('.seg.big [data-v="health"]');
  eq(await text(p, '.card .card-sub'), '1 件'); await p.click('.rows .row'); await p.click('[data-act="health-done"]');
  eq(await text(p, '.card .card-sub'), '0 件'); await tab(p, 'home'); eq((await texts(p, '.rem-row b')).some((x) => x.startsWith('复查')), false);
  await p.click('[data-act="toast-undo"]'); await until(async () => (await texts(p, '.rem-row b')).some((x) => x.startsWith('复查')), '撤销后提醒回来');
  // 外观
  await p.click('[data-act="go"][data-tab="prefs"]'); await p.click('[data-act="theme"][data-v="dark"]');
  eq(await p.evaluate(() => [document.documentElement.getAttribute('data-theme'), getComputedStyle(document.body).backgroundColor]), ['dark', 'rgb(18, 21, 27)']);
  await p.click('[data-act="theme"][data-v="auto"]'); eq(await p.evaluate(() => document.documentElement.hasAttribute('data-theme')), false);
  eq(w.errors, []); await w.close();
});

t('演示：护理板、一键「做了」、定间隔后到时间提醒、补记', async () => {
  const w = await world(); const p = await w.demo();
  // 首页的小卡片：记过的几种各是几天前
  eq(await texts(p, '.carechip'), ['剪指甲27 天前', '刷牙13 天前', '洗澡61 天前']);
  await p.click('.caremini [data-act="go-seg"]'); await p.waitForSelector('#view[data-tab="records"]');
  eq(await p.$eval('.seg.big .on', (e) => e.textContent), '护理');
  eq(await texts(p, '.care .care-main b'), ['剪指甲', '刷牙', '梳毛', '洗澡', '清耳朵']);
  eq((await texts(p, '.care .shot-l')).filter((x) => /^上次|^还没/.test(x)).map((x) => x.split(' · ')[0]), ['上次 27 天前', '上次 13 天前', '还没记过', '上次 61 天前', '还没记过']);
  eq(await text(p, '.care .shot-l.next'), '每 30 天一次 · 还有 3 天');
  // 一键「做了」：记成今天，可以撤销
  await p.click('.care [data-act="care-done"][data-type="brush"]');
  eq(await toastText(p), '梳毛：记成今天了');
  eq(await text(p, '.care[data-care="brush"] .pill'), '今天做了'); eq((await text(p, '.care[data-care="brush"] .shot-l')).startsWith('上次 今天'), true);
  await p.click('[data-act="toast-undo"]');
  await until(async () => (await text(p, '.care[data-care="brush"] .shot-l')) === '还没记过', '撤销');
  // 刷牙定成每周一次：上次是 13 天前，所以马上「该做了」，首页出提醒
  await p.click('.care-main[data-type="teeth"]');
  eq(await text(p, '.sheet-h b'), '刷牙'); eq(await p.$eval('.sheet [data-act="care-every"][aria-pressed="true"]', (e) => e.textContent), '不提醒');
  await p.click('.sheet [data-act="care-every"][data-v="7"]');
  eq(await p.$eval('.sheet [data-act="care-every"][aria-pressed="true"]', (e) => e.textContent), '每周');
  eq(await text(p, '.sheet .care .shot-l.next'), '每 7 天一次 · 超了 6 天');
  await closeSheet(p);
  eq(await p.$eval('.care[data-care="teeth"]', (e) => e.className.includes('st-due')), true);
  await tab(p, 'home');
  eq((await texts(p, '.rem-row b')).includes('该刷牙了'), true); eq(await p.$eval('.carechip[data-type="teeth"]', (e) => e.className.includes('due')), true);
  // 点提醒 → 这一种护理的面板 → 今天做了 → 提醒没了
  await p.click('.rem-row:has-text("该刷牙了")');
  eq(await text(p, '.sheet-h b'), '刷牙'); eq((await texts(p, '.sheet .rows .row b')).length, 1);
  await p.click('.sheet [data-act="care-done"]');
  eq(await text(p, '.sheet .care .shot-l.next'), '每 7 天一次 · 还有 7 天'); eq(await p.$('.sheet [data-act="care-done"]'), null); eq((await texts(p, '.sheet .rows .row b')).length, 2);
  await closeSheet(p);
  eq((await texts(p, '.rem-row b')).includes('该刷牙了'), false); eq(await text(p, '.carechip[data-type="teeth"] span'), '今天');
  // 补记以前的一次：表单里已经选好是哪一种
  await p.click('.carechip[data-type="nail"]'); await p.click('.sheet [data-act="care-past"]');
  eq(await p.$eval('#sheet-b [data-k="type"] .chip[aria-pressed="true"]', (e) => e.textContent), '剪指甲');
  const d5 = await p.evaluate(() => CL.addDays(CL.today(), -5)); await p.fill('#f-date', d5); await save(p);
  eq(await text(p, '.carechip[data-type="nail"] span'), '5 天前');
  // 每天一次：今天做过了就「还有 1 天」，不算该做
  await p.click('.carechip[data-type="teeth"]'); eq(await texts(p, '.sheet [data-act="care-every"]'), ['不提醒', '每天', '每周', '每两周', '每月', '每三个月']);
  await p.click('.sheet [data-act="care-every"][data-v="1"]'); eq(await text(p, '.sheet .care .shot-l.next'), '每天一次 · 还有 1 天'); await closeSheet(p);
  eq((await texts(p, '.rem-row b')).includes('该刷牙了'), false);
  // 取消间隔
  await p.click('.carechip[data-type="teeth"]'); await p.click('.sheet [data-act="care-every"][data-v=""]');
  eq(await p.$('.sheet .care .shot-l.next'), null); await closeSheet(p);
  await reload(p); eq(await texts(p, '.carechip'), ['剪指甲5 天前', '刷牙今天', '洗澡61 天前']);
  eq(w.errors, []); await w.close();
});
t('演示：保险的数字、记理赔、不限额、续保顺延、删除和撤销', async () => {
  const w = await world(); const p = await w.demo();
  await tab(p, 'records'); await p.click('.seg.big [data-v="insure"]');
  const days = await p.evaluate(() => { const t = CL.today(), s = CL.addMonths(t.slice(0, 8) + '01', -8); return CL.diffDays(t, CL.addMonths(s, 12)); });
  eq(await text(p, '.pol .card-t'), '示例宠物保险 意外和疾病');
  eq(await texts(p, '.pol .tile b'), ['$38.50', days + ' 天']); eq((await text(p, '.pol .tile')).includes('阿树在付'), true); eq((await text(p, '.pol .tile')).includes('一年 $462'), true);
  eq(await texts(p, '.pol .meter-h span'), ['已用 $28.80 / $10,000', '已抵 $250 / $250']);
  eq(await texts(p, '.pol .meter-f'), ['还剩 $9,971.20', '已经抵满']);
  eq(await texts(p, '.pol .rows .row-t b'), ['牙龈检查', '拉稀就诊']); eq(await texts(p, '.pol .rows .pill'), ['已提交', '已赔付']);
  eq((await text(p, '.pol .card-h:has(.sm) .card-sub')), '2 笔 · 账单合计 $406 · 1 笔还没赔下来');
  // 记一笔理赔：填错的提示，填了赔付金额就算已赔付
  await p.click('[data-act="claim-add"]');
  await save(p); eq(await text(p, '#sheet-err'), '写一下是什么事。');
  await p.fill('#f-title', '疫苗反应观察'); await p.fill('#f-bill', '很多'); await save(p); eq(await text(p, '#sheet-err'), '「账单金额」填数字，比如 286 或 28.80。');
  await p.fill('#f-bill', '500'); await p.fill('#f-paid', '600'); await save(p); eq(await text(p, '#sheet-err'), '赔的不会比账单还多，检查一下这两个数。');
  await p.fill('#f-paid', '$400.00'); await save(p);
  eq(await texts(p, '.pol .meter-h span'), ['已用 $428.80 / $10,000', '已抵 $250 / $250']); eq((await texts(p, '.pol .meter-f'))[0], '还剩 $9,571.20');
  eq((await texts(p, '.pol .rows .row-t b'))[0], '疫苗反应观察'); eq((await texts(p, '.pol .rows .pill'))[0], '已赔付');
  eq(await p.$eval('.pol .meter .bar i', (e) => e.style.width), '4%');
  // 把「已提交」的那笔改成被拒：不影响已用
  await p.click('.pol .row:has-text("牙龈检查")'); await p.click('#sheet-b [data-k="status"] [data-v="denied"]'); await save(p);
  eq((await texts(p, '.pol .meter-h span'))[0], '已用 $428.80 / $10,000'); eq(await texts(p, '.pol .rows .pill'), ['已赔付', '被拒', '已赔付']);
  // 改保单：不限额、手填已用
  await p.click('[data-act="policy-edit"]');
  eq([await p.inputValue('#f-company'), await p.inputValue('#f-premium'), await p.inputValue('#f-limit_amt'), await p.inputValue('#f-rate')], ['示例宠物保险', '38.5', '10000', '80']);
  await p.fill('#f-limit_amt', ''); await p.fill('#f-used0', '1,000'); await p.fill('#f-rate', '120'); await save(p);
  eq(await text(p, '#sheet-err'), '赔付比例填 0 到 100 之间的整数，比如 80。');
  await p.fill('#f-rate', '90'); await p.click('#sheet-b [data-k="payer"] [data-v="both"]'); await save(p);
  eq((await texts(p, '.pol .meter-h span'))[0], '不限额 · 已赔 $1,428.80'); eq(await p.$$eval('.pol .meter', (m) => m[0].querySelector('.bar')), null);
  eq((await text(p, '.pol .tile')).includes('两个人一起付'), true); eq((await texts(p, '.pol .kv b'))[0], '90%');
  // 续保日过了：首页提醒，点「顺延一年」
  await p.click('[data-act="policy-edit"]');
  const [st, rn] = await p.evaluate(() => { const t = CL.today(), r = CL.addDays(t, -5); return [CL.addMonths(r, -12), r]; });
  await p.fill('#f-start', st); await p.click('[data-act="renew-step"]'); eq(await p.inputValue('#f-renew'), rn); await save(p);
  eq(await texts(p, '.pol .tile b'), ['$38.50', '过了 5 天']);
  eq((await texts(p, '.pol .meter-h span'))[0], '不限额 · 已赔 $1,028.80');          // 今天记的那笔 400 已经不在这个年度里了
  await tab(p, 'home'); eq((await texts(p, '.rem-row b')).includes('保险的续保日过了 5 天'), true);
  await p.click('.rem-row:has-text("保险的续保日")'); await p.waitForSelector('.pol');
  await p.click('[data-act="policy-roll"]');
  const left = await p.evaluate(() => { const t = CL.today(); return CL.diffDays(t, CL.addMonths(CL.addDays(t, -5), 12)); });
  // 新年度从 5 天前开始：手填的已用清零；今天记的那笔 400 算进来；9 天前和 40 天前的两笔归到「不在本年度」
  eq(await texts(p, '.pol .tile b'), ['$38.50', left + ' 天']); eq((await texts(p, '.pol .meter-h span'))[0], '不限额 · 已赔 $400');
  eq((await text(p, '.pol .older summary')), '不在本年度的理赔（2 笔）'); eq(await p.$('[data-act="policy-roll"]'), null);
  await tab(p, 'home'); eq((await texts(p, '.rem-row b')).some((x) => x.startsWith('保险')), false);
  // 删掉保单（连同理赔），撤销后都回来
  await tab(p, 'records'); await p.click('[data-act="policy-edit"]'); await p.click('[data-act="form-del"]');
  eq(await toastText(p), '这份保险删掉了，连同 3 笔理赔'); eq(await text(p, '.empty b'), '还没有保险信息');
  await p.click('[data-act="toast-undo"]'); await p.waitForSelector('.pol');
  eq(await text(p, '.pol .older summary'), '不在本年度的理赔（2 笔）');
  // 新加一份：只填公司也行
  await p.click('#view > [data-act="policy-add"]'); await save(p); eq(await text(p, '#sheet-err'), '写上保险公司的名字。');
  await p.fill('#f-company', '另一家'); await save(p);
  eq(await p.$$eval('.pol', (e) => e.length), 2); eq(await texts(p, '.pol:nth-of-type(2) .tile b'), ['—', '—']);
  eq(w.errors, []); await w.close();
});

/* ============ 接上后端 ============ */
t('初始化：打开链接后地址栏清干净，建第一只猫，写进表格', async () => {
  const w = await world(); const a = await w.phone('a');
  await a.waitForSelector('[data-act="pet-add"]');
  eq(a.url(), w.s.site);                                        // 口令不留在地址栏
  eq(await a.evaluate(() => location.href), w.s.site);
  await until(async () => (await text(a, '.lead')) === '连上了。先添加你们的猫。', '首次同步完成');
  await addPet(a, '年糕', { birthday: '2025-06-10', home_date: '2025-08-20', breed: '英短' });
  await synced(a);
  const row = w.env.rows('pets')[0];
  eq([row.name, row.birthday, row.home_date, row.breed, row.species, row.created_by, row.deleted], ['年糕', '2025-06-10', '2025-08-20', '英短', 'cat', 'a', '']);
  eq(await text(a, '.hero h1'), '年糕');
  // 一条记录都没有的时候，每个页面都是说明和按钮，不是空白，也不报错
  eq((await text(a, '.empty b')).length > 0, true);
  await tab(a, 'timeline'); eq(await text(a, '.empty b'), '时间轴还是空的');
  await tab(a, 'growth'); eq(await texts(a, '.empty b'), ['还没有体重记录', '还没有照片']); eq(await a.$('#wchart'), null);
  await tab(a, 'records'); eq(await texts(a, '.shot .stamp text'), ['未记录', '未记录']);
  for (const seg of ['deworm', 'health', 'docs']) { await a.click('.seg.big [data-v="' + seg + '"]'); eq((await text(a, '#view .card')).length > 10, true); }
  await tab(a, 'home');
  // 请求的样子：全是 POST、text/plain、不带 cookie、没有预检
  eq([...new Set(w.ctl.log.map((x) => x.method))], ['POST']);
  eq(w.ctl.log.every((x) => /^text\/plain/.test(x.type) && !x.cookie), true);
  eq(w.errors, []); await w.close();
});
t('两部手机：一边记，另一边看到，谁记的也对', async () => {
  const w = await world(); const a = await w.phone('a');
  await addPet(a, '年糕', { birthday: '2025-06-10' }); await synced(a);
  const b = await w.phone('b'); await b.waitForSelector('.hero'); await synced(b);
  eq(await text(b, '.hero h1'), '年糕');
  await addWeight(a, '4.25'); await synced(a);
  await poke(b); await until(async () => (await text(b, '.hero-w b').catch(() => '')) === '4.25', 'B 看到体重');
  await tab(b, 'timeline');
  eq((await text(b, '.tl-item .tl-meta')).endsWith('成员 A'), true);
  // B 改名字、改这条体重；A 看到
  await b.click('[data-act="go"][data-tab="prefs"]'); await b.click('[data-act="me-edit"]'); await b.fill('#f-name', '小满');
  eq(await b.$eval('.sw-c[data-v="#2a78d6"]', (e) => e.disabled), true);     // 对方在用的颜色不能选
  await b.click('.sw-c[data-v="#1baf7a"]'); await save(b);
  await b.click('[data-act="go"][data-tab="timeline"]'); await b.click('.tl-item'); await b.click('[data-act="edit"]'); await b.fill('#f-kg', '4.3'); await b.fill('#f-note', '重新称了一次'); await save(b);
  await synced(b); await poke(a);
  await until(async () => (await text(a, '.hero-w b')) === '4.30', 'A 看到修改');
  const e = live(w.env.rows('entries'))[0];
  eq([e.kg, e.note, e.created_by, e.updated_by, e.summary], [4.3, '重新称了一次', 'a', 'b', '体重 4.30 kg']);
  eq(w.env.rows('members').map((m) => [m.id, m.name, m.color]), [['a', '成员 A', '#2a78d6'], ['b', '小满', '#1baf7a']]);
  await a.click('[data-act="go"][data-tab="prefs"]');
  eq((await texts(a, '.row.static b')), ['小满']);
  eq(w.errors, []); await w.close();
});
t('两部手机：同一天的日常状态记在同一行', async () => {
  const w = await world(); const a = await w.phone('a');
  await addPet(a, '年糕'); await synced(a);
  const b = await w.phone('b'); await b.waitForSelector('.hero');
  await a.click('[data-act="day-ok"]'); await synced(a);
  await poke(b); await b.waitForSelector('.today-ok');
  await b.click('.today [data-act="day"]'); await b.click('#sheet-b [data-k="poop"] [data-v="2"]'); await save(b); await synced(b);
  await poke(a); await until(async () => (await texts(a, '.today .st.s2')).join() === '大便 偏软', 'A 看到 B 的修改');
  const rows = live(w.env.rows('entries'));
  eq(rows.length, 1); eq(JSON.parse(rows[0].data), { app: 3, water: 2, energy: 2, poop: 2, pee: 1, vomit: 0, flags: [] });
  eq([rows[0].created_by, rows[0].updated_by], ['a', 'b']);
  eq(w.errors, []); await w.close();
});
t('离线：照常记录，关掉重开也不丢，联网后自动补传，不重复', async () => {
  const w = await world(); const a = await w.phone('a');
  await addPet(a, '年糕'); await synced(a);
  w.ctl.down = true;
  await addWeight(a, '4.1', '2026-11-01'); await addWeight(a, '4.2', '2026-11-08');
  await a.click('[data-act="day-ok"]');
  await until(async () => /3 条待传/.test(await pill(a)), '显示待传 3 条');
  eq(await text(a, '.hero-w b'), '4.20');
  await a.reload(); await a.waitForSelector('.hero');           // 断着网重开
  eq(await text(a, '.hero-w b'), '4.20'); eq(await text(a, '.today-ok'), '一切正常');
  eq(/3 条待传/.test(await pill(a)), true);
  eq(live(w.env.rows('entries')).length, 0);
  w.ctl.down = false; await poke(a); await synced(a);
  eq(live(w.env.rows('entries')).map((r) => r.summary).sort(), ['体重 4.10 kg', '体重 4.20 kg', '日常：一切正常']);
  await sleep(400); await poke(a); await synced(a);
  eq(w.env.rows('entries').length, 3);
  eq(await pill(a), '已同步');
  eq(w.errors, []); await w.close();
});
t('回应丢了：重发不会记两遍', async () => {
  const w = await world(); const a = await w.phone('a');
  await addPet(a, '年糕'); await synced(a);
  // 让下一次请求写进表格之后「回应丢失」
  const orig = w.env.postRaw; let cut = 1;
  w.env.postRaw = function (body) { const out = orig.call(w.env, body); if (cut && /"ops":\[\{/.test(body)) { cut--; w.ctl.down = true; setTimeout(() => { w.ctl.down = false; }, 300); } return out; };
  await addWeight(a, '4.4');
  await until(() => live(w.env.rows('entries')).length === 1, '第一次已经写进表格');
  await until(async () => (await pill(a)) === '已同步', '重试成功', 15000);
  eq(w.env.rows('entries').length, 1);
  const revBefore = w.env.props.get('REV');
  await poke(a); await sleep(300);
  eq(w.env.props.get('REV'), revBefore);
  eq(w.errors, []); await w.close();
});
t('照片：上传进 Drive，另一部手机看到缩略图和原图', async () => {
  const w = await world(); const a = await w.phone('a');
  await addPet(a, '年糕', { birthday: '2025-06-10' }); await synced(a);
  const b = await w.phone('b'); await b.waitForSelector('.hero');
  await a.click('.quick [data-kind="moment"]');
  await pick(a, '#sheet-b [data-act="media-add"]', [await picture(a, 'IMG_1.jpg', 2400, 1800, 30)]);
  await a.waitForSelector('#sheet-b .me-i'); await a.fill('#f-note', '趴在窗台'); await a.click('#f-star'); await a.fill('#f-title', '第一次上窗台'); await save(a);
  await until(() => w.env.files.size === 1 && live(w.env.rows('entries')).length === 1, '传完', 15000); await synced(a);
  const file = [...w.env.files.values()][0], m = w.env.rows('media')[0];
  eq([file.parent.name, file.mime, m.kind, m.w, m.h, m.created_by, m.drive_id === file.id], ['照片', 'image/jpeg', 'img', 1600, 1200, 'a', true]);
  eq(/^\d{4}-\d{2}-\d{2}_[0-9a-z]{12}\.jpg$/.test(file.name), true);
  eq(file.bytes.length > 20000 && file.bytes.length < 900000, true, '原图大小 ' + file.bytes.length);
  const th = w.env.rows('thumbs')[0].thumb; eq(/^data:image\/jpeg;base64,/.test(th) && th.length < 45000, true);
  eq(live(w.env.rows('entries'))[0].media, m.id);
  // B：缩略图、原图、相册、里程碑
  await poke(b); await tab(b, 'timeline'); await b.waitForSelector('.tl-item .ph img'); await loaded(b, '.tl-item .ph img');
  eq(await text(b, '.tl-item .tl-t'), '第一次上窗台');
  await b.click('.tl-item .ph'); await b.waitForSelector('#vw-img.hd', { timeout: 15000 }); await loaded(b, '#vw-img');
  eq(await b.$eval('#vw-img', (im) => [im.naturalWidth, im.naturalHeight]), [1600, 1200]);
  await b.keyboard.press('Escape');
  await tab(b, 'growth'); eq((await text(b, '.alb .alb-l')).length > 0, true); await loaded(b, '.alb img');
  // 设成头像
  await b.click('.petchip'); await b.click('#sheet-b [data-act="pet-edit"]');
  eq(w.errors, []); await w.close();
});
t('照片：离线时先存在手机上，联网后补传；选了又取消的不传', async () => {
  const w = await world(); const a = await w.phone('a');
  await addPet(a, '年糕'); await synced(a);
  w.ctl.down = true;
  await a.click('.quick [data-kind="moment"]');
  await pick(a, '#sheet-b [data-act="media-add"]', [await picture(a, 'x.jpg', 1000, 800, 200)]);
  await a.waitForSelector('#sheet-b .me-i'); await save(a);
  await tab(a, 'timeline'); await loaded(a, '.tl-item .ph img');
  eq(await text(a, '.tl-item .ph-tag'), '待上传');
  await reload(a); await tab(a, 'timeline'); await loaded(a, '.tl-item .ph img');   // 重开以后图还在
  eq(w.env.files.size, 0);
  // 选了照片又取消：不该留下待传的文件
  await a.click('.fab'); await a.click('.addgrid [data-kind="moment"]');
  await pick(a, '#sheet-b [data-act="media-add"]', [await picture(a, 'y.jpg', 600, 600, 90)]);
  await a.waitForSelector('#sheet-b .me-i'); await closeSheet(a);
  w.ctl.down = false; await poke(a);
  await until(() => w.env.files.size === 1, '补传', 15000); await synced(a);
  await until(async () => (await a.$('.tl-item .ph-tag')) === null, '「待上传」消失');
  await sleep(500); eq(w.env.files.size, 1); eq(w.env.rows('media').length, 1);
  // 联着网选了照片（已经在后台传上去了）又取消：传上去的那份进回收站
  await a.click('.fab'); await a.click('.addgrid [data-kind="moment"]');
  await pick(a, '#sheet-b [data-act="media-add"]', [await picture(a, 'z.jpg', 600, 600, 150)]);
  await until(() => w.env.files.size === 2, '后台已经传上去', 15000);
  await closeSheet(a);
  await until(() => [...w.env.files.values()].filter((f) => f.trashed).length === 1 && w.env.rows('media').filter((m) => m.deleted === true).length === 1, '没用上的那张进了回收站', 15000);
  await synced(a); eq(live(w.env.rows('entries')).length, 1);
  eq(w.errors, []); await w.close();
});
t('照片：从记录里拿掉以后进 Drive 回收站；还被别处用着的不删', async () => {
  const w = await world(); const a = await w.phone('a');
  await addPet(a, '年糕'); await synced(a);
  await a.click('.quick [data-kind="moment"]');
  await pick(a, '#sheet-b [data-act="media-add"]', [await picture(a, 'p1.jpg', 900, 700, 0), await picture(a, 'p2.jpg', 900, 700, 180)]);
  await a.waitForSelector('#sheet-b .me-i:nth-child(2)'); await save(a);
  await until(() => w.env.files.size === 2, '两张都传完', 15000); await synced(a);
  // 第一张设成头像
  await a.click('.hero-av'); await a.click('#sheet-b [data-act="pet-edit"]');
  await pick(a, '#sheet-b [data-k="avatar"] [data-act="media-add"]', [await picture(a, 'face.jpg', 700, 700, 300)]);
  await a.waitForSelector('#sheet-b [data-k="avatar"] .me-i'); await save(a);
  await until(() => w.env.files.size === 3, '头像传完', 15000); await synced(a);
  await loaded(a, '.hero .av img');
  // 修改记录：去掉第一张
  await tab(a, 'timeline'); await a.click('.tl-item .tl-h'); await a.click('[data-act="edit"]');
  await a.click('#sheet-b .me-i:first-child .me-x'); await save(a); await synced(a);
  const files = [...w.env.files.values()];
  eq(files.filter((f) => f.trashed).length, 1); eq(w.env.rows('media').filter((m) => m.deleted === true).length, 1);
  eq(await a.$$eval('.tl-item .ph img', (e) => e.length), 1);
  // 整条删掉：剩下那张照片也进回收站；撤销：记录和照片一起回来
  await a.click('.tl-item .tl-h'); await a.click('[data-act="edit"]'); await a.click('[data-act="form-del"]'); await synced(a);
  eq(files.filter((f) => f.trashed).length, 2); eq(live(w.env.rows('entries')).length, 0);
  await a.click('[data-act="toast-undo"]'); await synced(a);
  eq(files.filter((f) => f.trashed).length, 1); eq(await a.$$eval('.tl-item .ph img', (e) => e.length), 1); await loaded(a, '.tl-item .ph img');
  // 头像那张不在任何记录里，没受影响
  eq(files.filter((f) => !f.trashed).length, 2);
  eq(w.errors, []); await w.close();
});
t('文件：PDF 传上去，另一部手机取下来内容一样；太大的当场拦住', async () => {
  const w = await world(); const a = await w.phone('a');
  await addPet(a, '年糕'); await synced(a);
  const b = await w.phone('b'); await b.waitForSelector('.hero');
  await tab(a, 'records'); await a.click('.seg.big [data-v="docs"]'); await a.click('[data-act="add"][data-kind="doc"]');
  await pick(a, '#sheet-b [data-act="media-add"]', [{ name: '巨大的.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(13 * 1024 * 1024, 1) }]);
  eq(/上限是 12 MB/.test(await toastText(a)), true); eq(await a.$('#sheet-b .me-f'), null);
  await pick(a, '#sheet-b [data-act="media-add"]', [{ name: '体检报告.pdf', mimeType: 'application/pdf', buffer: PDF }, await picture(a, '疫苗本.jpg', 1500, 2000, 40)]);
  await a.waitForSelector('#sheet-b .me-i'); await a.fill('#f-title', '2026 年体检'); await a.click('#sheet-b [data-k="category"] [data-v="checkup"]'); await save(a);
  await until(() => w.env.files.size === 2, '传完', 15000); await synced(a);
  const pdf = [...w.env.files.values()].find((f) => f.mime === 'application/pdf');
  eq([pdf.parent.name, /_体检报告\.pdf$/.test(pdf.name), Buffer.from(pdf.bytes.map((x) => (x < 0 ? x + 256 : x))).equals(PDF)], ['文件', true, true]);
  const img = [...w.env.files.values()].find((f) => f.mime === 'image/jpeg');
  eq(img.parent.name, '照片');
  const d = w.env.rows('docs')[0]; eq([d.title, d.category, d.created_by, d.media.split(',').length], ['2026 年体检', 'checkup', 'a', 2]);
  await poke(b); await tab(b, 'records'); await b.click('.seg.big [data-v="docs"]'); await b.click('.row.doc');
  await loaded(b, '#sheet-b .ph img');
  await b.click('.filechip');
  eq(await b.$eval('#sheet-b a[href^="https://drive.google.com/file/d/"]', (e) => e.getAttribute('href')), 'https://drive.google.com/file/d/' + pdf.id + '/view');
  await b.click('[data-act="file-get"]'); await b.waitForSelector('#file-open', { timeout: 15000 });
  eq(await b.evaluate(async () => { const r = await fetch(document.querySelector('#file-open').href); return [r.headers.get('content-type'), (await r.arrayBuffer()).byteLength]; }), ['application/pdf', PDF.length]);
  // 表格里这一行的类型被人改成了网页：另一部手机取下来只当普通文件，不会当网页打开
  const ms = w.env.sheet('media'), mh = ms.rows[0], ri = ms.rows.findIndex((r) => r[mh.indexOf('mime')] === 'application/pdf');
  ms.rows[ri][mh.indexOf('mime')] = 'text/html';
  const c = await w.phone('a'); await c.waitForSelector('.hero'); await tab(c, 'records'); await c.click('.seg.big [data-v="docs"]'); await c.click('.row.doc'); await c.click('.filechip'); await c.click('[data-act="file-get"]'); await c.waitForSelector('#file-open', { timeout: 15000 });
  eq(await c.evaluate(async () => (await fetch(document.querySelector('#file-open').href)).headers.get('content-type')), 'application/octet-stream');
  eq(w.errors, []); await w.close();
});
t('删除和撤销在两部手机之间传开；疫苗和提醒也一样', async () => {
  const w = await world(); const a = await w.phone('a');
  await addPet(a, '年糕'); await synced(a);
  const b = await w.phone('b'); await b.waitForSelector('.hero');
  await tab(a, 'records'); await a.click('.board [data-act="add"]'); await a.click('#sheet-b [data-presets] .chip'); await a.fill('#f-date', '2025-11-01'); await a.click('.steps [data-m="12"]'); await a.fill('#f-lot', 'A1234'); await save(a); await synced(a);
  const srow = w.env.rows('shots')[0];
  eq([srow.name, srow.code, srow.date, srow.next_due, srow.lot, srow.kind], ['猫三联', 'fvrcp', '2025-11-01', '2026-11-01', 'A1234', 'vaccine']);
  await poke(b); await b.waitForSelector('.rem-row.lv3');
  eq((await text(b, '.rem-row.lv3 b')).startsWith('猫三联已过期'), true);
  // B 删掉，A 上消失；B 撤销，A 上回来
  await b.click('.rem-row.lv3'); await b.click('.rows .row'); await b.click('[data-act="edit"]'); await b.click('[data-act="form-del"]'); await synced(b);
  await poke(a); await until(async () => (await a.$('.rows .row')) === null, 'A 上消失');
  eq(w.env.rows('shots')[0].deleted, true);
  await b.click('[data-act="toast-undo"]'); await synced(b);
  await poke(a); await a.waitForSelector('.rows .row');
  eq(w.env.rows('shots').map((r) => r.deleted), ['']);
  eq(w.errors, []); await w.close();
});
t('两部手机：保险、理赔和护理的间隔都能互相看到，表格里是数字', async () => {
  const w = await world(); const a = await w.phone('a');
  await addPet(a, '年糕'); await synced(a);
  const b = await w.phone('b'); await b.waitForSelector('.hero');
  await tab(a, 'records'); await a.click('.seg.big [data-v="insure"]'); await a.click('[data-act="policy-add"]');
  await a.fill('#f-company', '某某保险'); await a.fill('#f-premium', '42.5'); await a.fill('#f-limit_amt', '5000'); await a.fill('#f-deductible', '500'); await a.fill('#f-rate', '80');
  await a.fill('#f-start', '2026-06-01'); await a.click('[data-act="renew-step"]'); await a.click('#sheet-b [data-k="payer"] [data-v="b"]');
  await pick(a, '#sheet-b [data-act="media-add"]', [{ name: '保单.pdf', mimeType: 'application/pdf', buffer: PDF }]); await a.waitForSelector('#sheet-b .me-f'); await save(a);
  await a.click('[data-act="claim-add"]'); await a.fill('#f-title', '看牙'); await a.fill('#f-bill', '800'); await a.fill('#f-paid', '240'); await a.fill('#f-ded', '500'); await save(a);
  await until(() => w.env.rows('claims').length === 1 && w.env.files.size === 1, '写进表格', 15000); await synced(a);
  const pr = w.env.rows('policies')[0], cr = w.env.rows('claims')[0];
  eq([pr.company, pr.premium, pr.limit_amt, pr.deductible, pr.rate, pr.start, pr.renew, pr.payer, pr.currency, pr.used0, pr.created_by, typeof pr.premium], ['某某保险', 42.5, 5000, 500, 80, '2026-06-01', '2027-06-01', 'b', '$', '', 'a', 'number']);
  eq([cr.title, cr.bill, cr.paid, cr.ded, cr.status, cr.policy_id === pr.id, cr.created_by], ['看牙', 800, 240, 500, 'paid', true, 'a']);
  await poke(b); await tab(b, 'records'); await b.click('.seg.big [data-v="insure"]'); await b.waitForSelector('.pol');
  eq(await texts(b, '.pol .meter-h span'), ['已用 $240 / $5,000', '已抵 $500 / $500']); eq((await text(b, '.pol .tile')).includes('成员 B在付'), true);
  eq(await text(b, '.pol .filechip span'), '保单.pdf');
  // B 定了剪指甲每两周一次（还没记过）：A 的首页出提醒
  await b.click('.seg.big [data-v="care"]'); await b.click('.care-main[data-type="nail"]'); await b.click('.sheet [data-act="care-every"][data-v="14"]'); await closeSheet(b); await synced(b);
  eq(w.env.rows('settings').filter((r) => /^care_/.test(r.id)).map((r) => [r.id.split('_')[2], r.value]), [['nail', '14']]);
  await poke(a); await tab(a, 'home'); await until(async () => (await texts(a, '.rem-row b')).includes('该剪指甲了'), 'A 看到提醒');
  await a.click('.rem-row:has-text("该剪指甲了")'); await a.click('.sheet [data-act="care-done"]'); await closeSheet(a); await synced(a);
  await poke(b); await until(async () => (await text(b, '.care .shot-l').catch(() => '')).startsWith('上次 今天'), 'B 看到 A 剪了');
  eq(live(w.env.rows('entries')).map((r) => [r.kind, r.summary, r.created_by]), [['activity', '护理：剪指甲', 'a']]);
  // A 给理赔也带上一份文件；B 把保单删了：理赔和两份文件跟着删（文件进 Drive 回收站），A 那边也没了；撤销以后都回来
  await tab(a, 'records'); await a.click('.seg.big [data-v="insure"]'); await a.click('.pol .row');
  await pick(a, '#sheet-b [data-act="media-add"]', [{ name: '账单.pdf', mimeType: 'application/pdf', buffer: PDF }]); await a.waitForSelector('#sheet-b .me-f'); await save(a);
  await until(() => w.env.files.size === 2, '账单传完', 15000); await synced(a);
  const flags = () => [w.env.rows('policies').map((r) => r.deleted === true), w.env.rows('claims').map((r) => r.deleted === true), w.env.rows('media').map((r) => r.deleted === true), [...w.env.files.values()].map((f) => !!f.trashed)];
  eq(flags(), [[false], [false], [false, false], [false, false]]);
  await poke(b); await b.click('.seg.big [data-v="insure"]'); await until(async () => (await b.$$('.pol .row svg')).length === 2, 'B 看到带文件的理赔（多一个回形针）');
  await b.click('[data-act="policy-edit"]'); await b.click('[data-act="form-del"]');
  eq(await toastText(b), '这份保险删掉了，连同 1 笔理赔'); await synced(b);
  eq(flags(), [[true], [true], [true, true], [true, true]]);
  await poke(a); await until(async () => (await text(a, '.empty b').catch(() => '')) === '还没有保险信息', 'A 那边也没了');
  await b.click('[data-act="toast-undo"]'); await b.waitForSelector('.pol'); await synced(b);
  eq(flags(), [[false], [false], [false, false], [false, false]]);
  await poke(a); await a.waitForSelector('.pol'); eq(await text(a, '.pol .filechip span'), '保单.pdf'); eq(await texts(a, '.pol .meter-h span'), ['已用 $240 / $5,000', '已抵 $500 / $500']);
  // 有人在表格里另建了一条文件记录，也指向保单的那份 PDF。把这条文件记录删掉：保单还在用，所以 Drive 里的那份不删
  w.env.post({ v: 1, token: w.env.token('b'), action: 'sync', since: 0, ops: [{ id: 'share1', table: 'docs', t: 'put', row: { id: 'dshare', pet_id: w.env.rows('pets')[0].id, title: '保单副本', category: 'other', date: '2026-11-01', media: w.env.rows('policies')[0].media } }] });
  await poke(a); await a.click('.seg.big [data-v="docs"]'); await a.waitForSelector('.row.doc'); await a.click('.row.doc'); await a.click('[data-act="doc-edit"]'); await a.click('[data-act="form-del"]'); await synced(a);
  eq([w.env.rows('docs').map((r) => r.deleted === true), flags()], [[true], [[false], [false], [false, false], [false, false]]]);
  eq(w.errors, []); await w.close();
});
t('后端还是 1.0.0：保险的改动先留在手机上，后端更新后自动传上去；别的照常同步', async () => {
  const w = await world({ code: path.join(__dirname, 'fixtures', 'Code-1.0.0.gs') }); const a = await w.phone('a');
  await addPet(a, '年糕'); await synced(a);
  await tab(a, 'records'); await a.click('.seg.big [data-v="insure"]');
  eq(await text(a, '.notice b'), '后端要先更新'); eq((await text(a, '.notice p')).includes('v1.0.0'), true);
  for (const scheme of ['dark', 'light']) { await a.emulateMedia({ colorScheme: scheme }); eq(await lowContrast(a), [], scheme + ' 旧后端的提示'); }
  eq(await a.evaluate(() => document.documentElement.scrollWidth <= 393), true);
  await a.click('[data-act="policy-add"]'); await a.fill('#f-company', '某某保险'); await a.fill('#f-premium', '30'); await save(a);
  await a.click('[data-act="claim-add"]'); await a.fill('#f-title', '看牙'); await a.fill('#f-bill', '100'); await save(a);
  eq(await text(a, '.pol .card-t'), '某某保险');                                   // 界面上已经有了
  await until(async () => (await pill(a)) === '2 条等后端更新', '显示在等后端更新');
  await addWeight(a, '4.4');                                                        // 别的记录照常同步
  await until(() => live(w.env.rows('entries')).length === 1, '体重照常写进表格');
  await until(async () => (await pill(a)) === '2 条等后端更新', '保险的两条还留着');
  const posts = w.ctl.log.length; await sleep(700); eq(w.ctl.log.length - posts <= 1, true, '没有一直空转地发请求');
  eq(w.env.sheet('policies'), null);
  await reload(a); eq(await pill(a), '2 条等后端更新'); eq(await text(a, '.pol .card-t'), '某某保险');      // 重开也不丢
  // 手机上存的快照没了（比如被系统清过），只剩没发出去的队列：还不知道后端是哪一版的时候，也先不发
  w.ctl.down = true;
  await a.evaluate(() => { indexedDB.deleteDatabase('catlog'); });      // 页面还开着，要等重开页面的那一下才真正删掉
  await a.reload(); await a.waitForSelector('#view[data-tab] > *');
  await until(async () => /有 2 条改动在这部手机上等着发送/.test(await text(a, '#view')), '快照没了，队列还在');
  w.ctl.down = false; await poke(a);
  await until(async () => (await pill(a)) === '2 条等后端更新', '问清楚后端是旧的以后，接着留着');
  eq([w.env.sheet('policies'), await text(a, '.pol .card-t')], [null, '某某保险']);
  // 后端换成新版本（表格和口令不变）
  w.env.setCode(path.join(process.env.CATLOG_APP || path.join(__dirname, '..', 'app'), 'Code.gs'));
  await poke(a); await until(async () => (await pill(a)) === '已同步', '更新后自动传上去', 15000);
  eq([w.env.rows('policies').map((r) => [r.company, r.premium]), w.env.rows('claims').map((r) => [r.title, r.bill])], [[['某某保险', 30]], [['看牙', 100]]]);
  eq(await a.$('.notice'), null);
  await a.click('[data-act="go"][data-tab="prefs"]'); eq((await text(a, '.about')).endsWith('后端 v' + require(path.join(process.env.CATLOG_APP || path.join(__dirname, '..', 'app'), 'core.js')).VERSION), true);
  eq(w.errors, []); await w.close();
});
t('从 1.0.0 升级网页：记过的、没传完的、照片都在；后端还没换时保险先留在手机上，换了以后自动传', async () => {
  const fs = require('fs'), os = require('os');
  const APP = process.env.CATLOG_APP || path.join(__dirname, '..', 'app'), ver = require(path.join(APP, 'core.js')).VERSION;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'catlog-up-'));
  fs.cpSync(path.join(__dirname, 'fixtures', 'web-1.0.0'), tmp, { recursive: true });        // 1.0.0 发布包里的网页文件，原样
  const w = await world({ app: tmp, code: path.join(__dirname, 'fixtures', 'Code-1.0.0.gs') });
  try {
    // 用 1.0.0 的网页和后端：建猫、记体重、记一次剪指甲（旧版里记在「活动」里）、传一张照片
    const a = await w.phone('a');
    await addPet(a, '年糕', { birthday: '2025-06-01' }); await addWeight(a, '4.2');
    await a.click('.quick [data-kind="activity"]'); await a.click('#sheet-b [data-k="type"] [data-v="nail"]'); await save(a);
    await a.click('.quick [data-kind="moment"]'); await pick(a, '#sheet-b [data-act="media-add"]', [await picture(a, 'p1.jpg', 900, 700, 40)]); await a.waitForSelector('#sheet-b .me-i'); await save(a);
    await until(() => w.env.files.size === 1, '照片传完', 15000); await synced(a);
    await a.click('[data-act="go"][data-tab="prefs"]'); eq(await text(a, '.about'), 'CatLog 猫咪日志 v1.0.0 · 后端 v1.0.0'); eq(await a.$('.carechip'), null);
    // 断着网再记一条，留在待传的队列里
    w.ctl.down = true; await addWeight(a, '4.3'); await until(async () => /1 条待传/.test(await pill(a)), '有一条待传');
    // 仓库里的文件换成新版（后端先不换），重开页面
    fs.cpSync(APP, tmp, { recursive: true });
    await a.reload(); await a.waitForSelector('#view[data-tab] > *'); await tab(a, 'home');
    eq([await text(a, '.hero h1'), await text(a, '.hero-w b'), await texts(a, '.carechip'), /1 条待传/.test(await pill(a))], ['年糕', '4.30', ['剪指甲今天', '刷牙还没记过'], true]);
    await tab(a, 'timeline'); await loaded(a, '.tl-item .ph img');                 // 存在手机上的照片还在（断着网也能看）
    // 还断着网：新网页从手机上存的快照里知道后端还是 1.0.0，马上有提示；这时候记的保险先留着
    await tab(a, 'records'); await a.click('.seg.big [data-v="insure"]'); eq(await text(a, '.notice b'), '后端要先更新');
    await a.click('[data-act="policy-add"]'); await a.fill('#f-company', '某某保险'); await a.fill('#f-premium', '25'); await save(a);
    await until(async () => /2 条待传/.test(await pill(a)), '两条待传');
    w.ctl.down = false; await poke(a);
    await until(async () => (await pill(a)) === '1 条等后端更新', '体重传上去了，保险等着后端更新');
    eq([live(w.env.rows('entries')).filter((r) => r.kind === 'weight').map((r) => r.kg), w.env.sheet('policies'), await text(a, '.notice b'), await text(a, '.pol h2.card-t')], [[4.2, 4.3], null, '后端要先更新', '某某保险']);
    await a.click('[data-act="go"][data-tab="prefs"]'); eq(await text(a, '.about'), 'CatLog 猫咪日志 v' + ver + ' · 后端 v1.0.0');
    // 护理的间隔存在设置表里，旧后端也认得
    await tab(a, 'records'); await a.click('.seg.big [data-v="care"]'); await a.click('.care-main[data-type="nail"]'); await a.click('.sheet [data-act="care-every"][data-v="14"]'); await closeSheet(a);
    await until(() => live(w.env.rows('settings')).some((r) => /^care_.*_nail$/.test(r.id) && String(r.value) === '14'), '护理间隔写进表格');
    eq(await text(a, '.care[data-care="nail"] .shot-l.next'), '每 14 天一次 · 还有 14 天');
    await until(async () => (await pill(a)) === '1 条等后端更新', '保险还留着'); eq(w.env.sheet('policies'), null);
    await a.click('.seg.big [data-v="insure"]');
    // 后端也换成新版（同一张表格，不重新 setup）：自动传上去，旧数据原样
    w.env.setCode(path.join(APP, 'Code.gs')); await poke(a); await until(async () => (await pill(a)) === '已同步', '保险传上去', 15000);
    eq([w.env.rows('policies').map((r) => [r.company, r.premium]), live(w.env.rows('entries')).length, w.env.files.size, await a.$('.notice')], [[['某某保险', 25]], 4, 1, null]);
    eq(w.errors, []);
  } finally { await w.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
t('演示数据升级：旧版本留下的演示数据里补上保险和护理的示例，自己在演示里记的不动', async () => {
  const fs = require('fs'), os = require('os');
  const APP = process.env.CATLOG_APP || path.join(__dirname, '..', 'app');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'catlog-demo-'));
  fs.cpSync(path.join(__dirname, 'fixtures', 'web-1.0.0'), tmp, { recursive: true });
  const w = await world({ app: tmp, code: path.join(__dirname, 'fixtures', 'Code-1.0.0.gs') });      // 演示不走后端，这里只是要有一份
  try {
    const p = await w.demo();                                                     // 1.0.0 的演示
    await p.click('.hero-w'); await p.fill('#f-kg', '4.9'); await save(p); eq(await text(p, '.hero-w b'), '4.90');
    await tab(p, 'records'); eq(await p.$('.seg.big [data-v="insure"]'), null);
    await sleep(300);
    fs.cpSync(APP, tmp, { recursive: true });                                    // 换成新版的文件
    await p.reload(); await p.waitForSelector('#view[data-tab] > *'); await tab(p, 'home');
    eq([await text(p, '.hero-w b'), await texts(p, '.carechip')], ['4.90', ['剪指甲27 天前', '刷牙13 天前', '洗澡61 天前']]);
    await p.click('.carechip[data-type="nail"]'); eq(await p.$eval('.sheet [data-act="care-every"][aria-pressed="true"]', (e) => e.textContent), '每月'); await closeSheet(p);
    await tab(p, 'records'); await p.click('.seg.big [data-v="insure"]'); await p.waitForSelector('.pol');
    eq([await text(p, '.pol h2.card-t'), await texts(p, '.pol .meter-f'), await texts(p, '.pol .rows .row-t b')], ['示例宠物保险 意外和疾病', ['还剩 $9,971.20', '已经抵满'], ['牙龈检查', '拉稀就诊']]);
    // 把示例保单删掉以后重开：不会又补回来
    await p.click('[data-act="policy-edit"]'); await p.click('[data-act="form-del"]'); await sleep(400);
    await p.reload(); await p.waitForSelector('.empty'); await sleep(700);        // 等演示的「后端」回过话
    eq([await text(p, '.empty b'), await p.$('.pol')], ['还没有保险信息', null]);
    eq(w.errors, []);
  } finally { await w.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
t('升级时先换后端、网页还是旧的（或者另一部手机还没更新）：旧网页接上新后端照常用', async () => {
  const APP = process.env.CATLOG_APP || path.join(__dirname, '..', 'app'), ver = require(path.join(APP, 'core.js')).VERSION;
  const w = await world({ app: path.join(__dirname, 'fixtures', 'web-1.0.0'), code: path.join(APP, 'Code.gs') });
  const a = await w.phone('a');
  await addPet(a, '年糕'); await addWeight(a, '4.2'); await synced(a);
  await a.click('[data-act="go"][data-tab="prefs"]'); eq(await text(a, '.about'), 'CatLog 猫咪日志 v1.0.0 · 后端 v' + ver);
  // 另一部手机已经是新网页，记了保险、理赔和护理间隔
  const pid = w.env.rows('pets')[0].id;
  eq(w.env.post({ v: 1, token: w.env.token('b'), action: 'sync', since: 0, ops: [
    { id: 'n1', table: 'policies', t: 'put', row: { id: 'pol1', pet_id: pid, company: '某某保险', premium: 30, currency: '$' } },
    { id: 'n2', table: 'claims', t: 'put', row: { id: 'clm1', pet_id: pid, policy_id: 'pol1', date: '2026-11-01', title: '看牙', bill: 100, status: 'sent' } },
    { id: 'n3', table: 'settings', t: 'put', row: { id: 'care_' + pid + '_nail', value: '14' } },
    { id: 'n4', table: 'entries', t: 'put', row: { id: 'en1', pet_id: pid, kind: 'activity', date: '2026-11-02', time: '', data: JSON.stringify({ type: 'nail' }), note: '' } },
  ] }).ok, true);
  // 旧网页：同步照常，护理记录显示成一条活动，不认识的两张表不理会；自己接着记也没问题；整份重新同步也一样
  await poke(a); await tab(a, 'timeline'); await until(async () => (await texts(a, '.tl-item')).some((x) => x.includes('剪指甲')), '旧网页看到新网页记的剪指甲');
  await addWeight(a, '4.4'); await synced(a);
  await a.click('[data-act="go"][data-tab="prefs"]'); await a.click('[data-act="resync"]'); await until(async () => (await toastText(a)) === '同步好了', '整份同步');
  await tab(a, 'home'); eq(await text(a, '.hero-w b'), '4.40');
  eq([live(w.env.rows('entries')).length, w.env.rows('policies').length, w.env.rows('claims').length], [3, 1, 1]);
  eq(w.errors, []); await w.close();
});
t('更新到一半：新旧文件混在一起时不往下跑；文件齐了以后正常，记过的不丢', async () => {
  const fs = require('fs'), os = require('os');
  const APP = process.env.CATLOG_APP || path.join(__dirname, '..', 'app');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'catlog-mixed-'));
  fs.cpSync(APP, tmp, { recursive: true });
  const good = fs.readFileSync(path.join(APP, 'core.js'), 'utf8'), old = good.replace(/VERSION: '[^']+'/, "VERSION: '1.0.0'"), ver = /VERSION: '([^']+)'/.exec(good)[1];
  eq([old === good, ver === '1.0.0'], [false, false]);
  const w = await world({ app: tmp });
  try {
    // 先用齐全的文件正常记一条
    const a = await w.phone('a'); await addPet(a, '年糕'); await addWeight(a, '4.2'); await synced(a);
    let loads = 0; a.on('load', () => loads++);
    // 手机上还留着一份旧的 core.js，服务器上是齐的：自己绕过缓存重新取一遍、重新加载一次就好了，不用人管
    w.ctl.once.set('core.js', old);
    await a.reload(); await a.waitForSelector('.hero', { timeout: 12000 });
    await until(() => loads === 2, '自动重新加载了一次'); eq([await text(a, '.hero-w b'), await a.$('#mixed')], ['4.20', null]);
    // 仓库里只传了一部分文件（core.js 还是另一版）：重新加载一次以后还是对不上 → 停在说明页，不往下跑，也不一直转圈
    fs.writeFileSync(path.join(tmp, 'core.js'), old); loads = 0;
    await a.reload(); await a.waitForSelector('#mixed-retry', { timeout: 12000 }); await until(() => loads === 2, '只自动重新加载一次');
    const msg = await text(a, '#mixed');
    eq([msg.includes('界面是 v' + ver), msg.includes('计算规则是 v1.0.0'), await a.$('.hero'), await a.evaluate(() => document.querySelector('#tabs').hidden)], [true, true, null, true]);
    eq(await lowContrast(a), []); await sleep(700); eq(loads, 2);
    await a.click('#mixed-retry'); await until(() => loads === 3, '点了以后重新加载'); await a.waitForSelector('#mixed-retry'); await sleep(400); eq(loads, 3);
    // 文件传齐了：点「再试一次」→ 正常打开，之前记的都在，口令也在
    fs.writeFileSync(path.join(tmp, 'core.js'), good);
    await a.click('#mixed-retry'); await a.waitForSelector('.hero', { timeout: 12000 });
    eq([await text(a, '.hero-w b'), await a.evaluate(() => sessionStorage.getItem('catlog:v1:reloaded'))], ['4.20', null]);
    await addWeight(a, '4.3'); await synced(a); eq(live(w.env.rows('entries')).map((r) => r.kg), [4.2, 4.3]);
    // core.js 压根没取到（断网又没缓存）：也是停在说明页，不报一串错
    const b = await w.plain({ init: () => { Object.defineProperty(window, 'CL', { get() { return undefined; }, set() {}, configurable: true }); } });
    await b.waitForSelector('#mixed-retry', { timeout: 12000 }); eq((await text(b, '#mixed')).includes('计算规则是 没加载到'), true);
    eq(w.errors, []);
  } finally { await w.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
t('口令失效：有提示，粘贴新链接后接着用，离线期间记的不丢', async () => {
  const w = await world(); const a = await w.phone('a');
  await addPet(a, '年糕'); await synced(a);
  w.env.call('resetTokens');
  await addWeight(a, '4.5');
  await a.waitForSelector('.notice'); eq(await pill(a), '需要重新初始化');
  eq(await text(a, '.hero-w b'), '4.50');
  await a.click('.notice [data-act="reinit"]'); await a.fill('#f-init', '乱写的'); await save(a);
  eq((await text(a, '#sheet-err')).startsWith('这不像是初始化链接'), true);
  await a.fill('#f-init', '给你新的链接：' + w.s.link('a') + ' 收到回一下'); await save(a);
  await synced(a); eq(await a.$('.notice'), null);
  eq(live(w.env.rows('entries')).map((r) => r.kg), [4.5]);
  eq(w.errors, []); await w.close();
});
t('后端出状况：返回登录页、临时出错、表格正忙，都会自己重试', async () => {
  const w = await world(); const a = await w.phone('a');
  await addPet(a, '年糕'); await synced(a);
  w.ctl.html = true;                                             // 部署时「谁可以访问」选错了，接口返回的是登录页
  await addWeight(a, '4.1');
  await until(async () => /稍后重试/.test(await pill(a)), '显示稍后重试');
  await a.click('#syncpill');
  eq(/谁可以访问/.test(await text(a, '#sync-line')), true);
  w.ctl.html = false; w.ctl.failNext = 1; w.env.lockBusy = true;
  setTimeout(() => { w.env.lockBusy = false; }, 2500);
  await until(async () => (await pill(a)) === '已同步', '最终同步成功', 25000);
  eq(live(w.env.rows('entries')).length, 1);
  eq(w.errors, []); await w.close();
});
t('有人直接改了表格：手机同步后看到；「重新同步全部数据」能对齐', async () => {
  const w = await world(); const a = await w.phone('a');
  await addPet(a, '年糕'); await addWeight(a, '4.0'); await synced(a);
  const sh = w.env.sheet('entries'), head = sh.rows[0];
  w.env.edit('entries', 2, head.indexOf('note') + 1, '在表格里补的');
  await poke(a); await tab(a, 'timeline');
  await until(async () => (await texts(a, '.tl-note')).includes('在表格里补的'), '看到表格里的修改');
  // 绕过触发器直接改（比如整行粘贴覆盖）：增量同步看不到，重新同步全部能看到
  sh.rows[1][head.indexOf('note')] = '悄悄改的';
  await poke(a); await sleep(500);
  eq((await texts(a, '.tl-note')).includes('悄悄改的'), false);
  await a.click('[data-act="go"][data-tab="prefs"]'); await a.click('[data-act="resync"]');
  await until(async () => (await toastText(a)) === '同步好了', '重新同步完成');
  await a.click('[data-act="go"][data-tab="timeline"]');
  eq((await texts(a, '.tl-note')).includes('悄悄改的'), true);
  // 有人在表格里把一整行删了：重新同步全部以后，手机上也没有了
  await addWeight(a, '4.6'); await synced(a);
  eq((await texts(a, '.tl-t .num')).sort(), ['4.00', '4.60']);
  sh.rows.splice(sh.rows.findIndex((r) => r[head.indexOf('kg')] === 4.6), 1);
  await a.click('[data-act="go"][data-tab="prefs"]'); await a.click('[data-act="resync"]');
  await until(async () => (await toastText(a)) === '同步好了', '重新同步完成');
  await a.click('[data-act="go"][data-tab="timeline"]');
  eq(await texts(a, '.tl-t .num'), ['4.00']);
  eq(w.errors, []); await w.close();
});
t('多只猫：各记各的，切换、删除和撤销', async () => {
  const w = await world(); const a = await w.phone('a');
  await addPet(a, '年糕'); await addWeight(a, '4.0');
  await a.click('[data-act="go"][data-tab="prefs"]'); await addPet(a, '汤圆', { birthday: '2026-05-01' });
  eq(await text(a, '.hero h1'), '汤圆'); eq(await a.$('.hero-w b'), null);
  await addWeight(a, '1.8');
  // 护理和保险也是各管各的：给汤圆定「剪指甲每周」、记一次刷牙、加一份保险
  eq(await texts(a, '.carechip'), ['剪指甲还没记过', '刷牙还没记过']);
  await a.click('.carechip[data-type="nail"]'); await a.click('.sheet [data-act="care-every"][data-v="7"]'); await closeSheet(a);
  await a.click('.carechip[data-type="teeth"]'); await a.click('.sheet [data-act="care-done"]'); await closeSheet(a);
  eq(await texts(a, '.carechip'), ['剪指甲还没记过', '刷牙今天']); eq((await texts(a, '.rem-row b')).includes('该剪指甲了'), true);
  await tab(a, 'records'); await a.click('.seg.big [data-v="insure"]'); await a.click('[data-act="policy-add"]'); await a.fill('#f-company', '汤圆的保险'); await save(a); await synced(a);
  await tab(a, 'timeline'); await a.click('.petchip'); await a.click('#sheet-b [data-act="pet-pick"]:has-text("年糕")');
  eq(await texts(a, '.tl-t .num'), ['4.00']);
  await tab(a, 'records'); eq(await text(a, '.empty b'), '还没有保险信息');
  await a.click('.seg.big [data-v="care"]'); eq(await texts(a, '.care .shot-l'), ['还没记过', '还没记过', '还没记过', '还没记过', '还没记过']);
  await tab(a, 'home'); eq(await texts(a, '.carechip'), ['剪指甲还没记过', '刷牙还没记过']); eq(await a.$('.rem-row'), null);
  eq([w.env.rows('policies').map((r) => r.pet_id), live(w.env.rows('settings')).filter((r) => /^care_/.test(r.id)).map((r) => r.id.split('_')[1])], [[w.env.rows('pets')[1].id], [w.env.rows('pets')[1].id]]);
  await tab(a, 'timeline');
  eq(live(w.env.rows('entries')).map((r) => [r.kind, w.env.rows('pets').findIndex((x) => x.id === r.pet_id)]), [['weight', 0], ['weight', 1], ['activity', 1]]);
  // 换一部手机也记得各自选的是哪只
  await a.click('.petchip'); await a.click('#sheet-b [data-act="pet-edit"]');
  await a.click('[data-act="pet-del"]'); eq((await text(a, '[data-act="pet-del"]')).startsWith('再点一次'), true);
  await a.click('[data-act="pet-del"]');
  await until(async () => (await text(a, '.petchip b').catch(() => '')) === '汤圆', '删掉后切到另一只'); await synced(a);
  eq(w.env.rows('pets').map((r) => [r.name, r.deleted]), [['年糕', true], ['汤圆', '']]);
  await a.click('[data-act="toast-undo"]'); await synced(a);
  eq(w.env.rows('pets').map((r) => r.deleted), ['', '']);
  eq(w.errors, []); await w.close();
});

/* ============ 稳不稳、安不安全、排版 ============ */
const EVIL = '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>"\'`&amp;';
t('不可信的文字：不管从表单还是从表格进来，都只当文字显示', async () => {
  const w = await world(); const a = await w.phone('a', { init: () => { window.__xss = 0; } });
  await addPet(a, EVIL.slice(0, 20), { breed: EVIL.slice(0, 30) }); await synced(a);
  await a.click('.quick [data-kind="food"]'); await a.fill('#f-name', EVIL); await a.fill('#f-amount', EVIL.slice(0, 30)); await a.fill('#f-note', EVIL); await save(a);
  await a.click('.fab'); await a.click('.addgrid [data-kind="health"]'); await a.fill('#f-title', EVIL); await a.fill('#f-clinic', EVIL); await save(a);
  await tab(a, 'records'); await a.click('.board [data-act="add"]'); await a.fill('#f-name', EVIL.slice(0, 40)); await a.fill('#f-product', EVIL); await a.fill('#f-clinic', EVIL); await save(a); await synced(a);
  await a.click('.seg.big [data-v="insure"]'); await a.click('[data-act="policy-add"]');
  await a.fill('#f-company', EVIL.slice(0, 40)); await a.fill('#f-plan', EVIL.slice(0, 40)); await a.fill('#f-policy_no', EVIL.slice(0, 40)); await a.fill('#f-note', EVIL); await save(a);
  await a.click('[data-act="claim-add"]'); await a.fill('#f-title', EVIL.slice(0, 60)); await a.fill('#f-note', EVIL); await save(a);
  await a.click('.seg.big [data-v="care"]'); await a.click('.care-main[data-type="nail"]'); await a.click('.sheet [data-act="care-past"]'); await a.fill('#f-note', EVIL); await save(a); await synced(a);
  // 表格里被人塞进来的东西
  const pid = w.env.rows('pets')[0].id, now = new Date().toISOString();
  w.env.post({ token: w.env.token('b'), action: 'sync', since: 0, ops: [
    { id: 'evil1', table: 'entries', t: 'put', row: { id: 'ev1', pet_id: pid, kind: 'moment', date: '2026-11-01', time: '<b>', data: JSON.stringify({ title: EVIL, star: true }), note: EVIL, media: 'evm1,"><img src=x onerror=window.__xss=1>' } },
    { id: 'evil2', table: 'docs', t: 'put', row: { id: 'ev2', pet_id: pid, title: EVIL, category: '"><script>window.__xss=1</script>', date: '2026-11-01', media: 'evm1' } },
    { id: 'evil3', table: 'settings', t: 'put', row: { id: 'unit', value: '"><script>window.__xss=1</script>' } },
    { id: 'evil4', table: 'members', t: 'put', row: { id: 'b', name: EVIL, color: 'red;background:url(javascript:window.__xss=1)' } },
    { id: 'evil5', table: 'settings', t: 'put', row: { id: 'care_' + pid + '_teeth', value: '7"><script>window.__xss=1</script>' } },
    { id: 'evil6', table: 'settings', t: 'put', row: { id: 'care_' + pid + '_bath', value: '30' } },
  ] });
  // 保险和理赔：直接往表格里塞整行，数字列里也放上不是数字的东西
  const inject = (table, o) => { const sh = w.env.sheet(table); sh.rows.push(sh.rows[0].map((h) => (h in o ? o[h] : ''))); w.env.props.set('REV_' + table, '999'); };
  const X = '"><script>window.__xss=1</script>', IMG = '<img src=x onerror=window.__xss=1>';
  inject('policies', { id: 'evp1', pet_id: pid, company: EVIL, plan: EVIL, policy_no: EVIL, payer: X, premium: IMG, currency: X, limit_amt: '1000' + X, deductible: 100, rate: X, start: IMG, renew: X, used0: EVIL, ded0: 'javascript:window.__xss=1', note: EVIL, media: 'evm1,' + X, rev: 999, created_by: '<i>', created_at: now });
  inject('policies', { id: 'evp2', pet_id: pid, company: 'ok', payer: 'b', premium: 12.5, currency: '¥', limit_amt: 100, deductible: 50, rate: 80, renew: '2026-11-20', rev: 999, created_by: 'a', created_at: now });
  inject('claims', { id: 'evc1', pet_id: pid, policy_id: 'evp1', date: '2026-11-01', title: EVIL, bill: IMG, paid: X, ded: EVIL, status: X, note: EVIL, media: 'evm1', rev: 999, created_by: '<i>', created_at: now });
  inject('claims', { id: 'evc2', pet_id: pid, policy_id: 'evp2', date: '2026-11-02', title: IMG, bill: 60, paid: 40, ded: 10, status: 'paid', note: X, media: X, rev: 999, created_by: 'b', created_at: now });
  const ms = w.env.sheet('media'), mh = ms.rows[0];
  const row = mh.map((h) => ({ id: 'evm1', kind: 'img', name: EVIL, mime: 'text/html', drive_id: '"><script>window.__xss=1</script>', rev: 999, created_by: '<i>', created_at: now }[h] || ''));
  ms.rows.push(row);
  w.env.sheet('thumbs').rows.push(['evm1', 'javascript:window.__xss=1']);
  w.env.props.set('REV', '999'); w.env.props.set('REV_media', '999');
  await a.click('[data-act="go"][data-tab="prefs"]'); await a.click('[data-act="resync"]');
  await until(async () => (await toastText(a)) === '同步好了', '同步完成');
  for (const name of ['home', 'timeline', 'growth', 'records']) { await a.click('[data-act="go"][data-tab="' + name + '"], #tabs [data-tab="' + name + '"]'); await sleep(250); }
  for (const seg of ['vaccine', 'care', 'health', 'insure', 'docs']) { await a.click('.seg.big [data-v="' + seg + '"]'); await sleep(150); }
  await a.click('.row.doc'); await sleep(200); await closeSheet(a);
  // 保险：三份都在（表单里填的一份、塞进来的两份），坏的数字当成没填，名字原样当文字显示
  await a.click('.seg.big [data-v="insure"]');
  eq(await texts(a, '.pol h2.card-t'), [EVIL.slice(0, 40) + ' ' + EVIL.slice(0, 40), EVIL.slice(0, 40) + ' ' + EVIL.slice(0, 40), 'ok']);
  eq(await texts(a, '.pol:nth-of-type(2) .tile b'), ['—', '—']); eq((await texts(a, '.pol:nth-of-type(2) .meter-h span')), ['不限额 · 已赔 $0', '已抵 $0 / $100']);
  eq(await texts(a, '.pol:nth-of-type(3) .tile b'), ['¥12.50', await a.evaluate(() => { const n = CL.diffDays(CL.today(), '2026-11-20'); return n >= 0 ? n + ' 天' : '过了 ' + (-n) + ' 天'; })]);
  eq((await text(a, '.pol:nth-of-type(3) .tile')).includes(EVIL.slice(0, 16) + '在付'), true);
  eq(await texts(a, '.pol:nth-of-type(3) .meter-h span'), ['已用 ¥40 / ¥100', '已抵 ¥10 / ¥50']);
  for (const sel of ['.pol:nth-of-type(2) [data-act="policy-edit"]', '.pol:nth-of-type(2) .row', '.pol:nth-of-type(3) .row', '.pol:nth-of-type(1) [data-act="claim-add"]']) { await a.click(sel); await sleep(200); await closeSheet(a); }
  // 护理：间隔里混了别的东西就当没定；正常的 30 照常算
  await a.click('.seg.big [data-v="care"]');
  eq(await a.$('.care[data-care="teeth"] .shot-l.next'), null); eq(await text(a, '.care[data-care="bath"] .shot-l.next'), '每 30 天一次 · 该做了');
  await a.click('.care-main[data-type="nail"]'); await sleep(200); eq((await text(a, '.sheet .rows .row small')).includes(EVIL), true); await closeSheet(a);
  await tab(a, 'timeline'); await a.click('.tl-item:has(.i.star) .tl-h'); await sleep(200); await closeSheet(a);
  await a.click('[data-act="go"][data-tab="prefs"]'); await sleep(200);
  eq(await a.evaluate(() => window.__xss), 0);
  eq(await a.evaluate(() => document.querySelectorAll('#app script, #app img[onerror], #sheet-root script').length), 0);
  eq(await a.$$eval('[style]', (es) => es.map((e) => e.getAttribute('style')).filter((s) => /url|javascript|expression/i.test(s))), []);
  eq(w.errors, []); await w.close();
});
t('排版：320 和 393 两种宽度都不超宽，能点的东西够大', async () => {
  for (const width of [320, 393]) {
    const w = await world(); const p = await w.demo({ viewport: { width, height: 760 } });
    const check = async (where) => {
      const r = await p.evaluate((W) => {
        // 手机浏览器里内容超宽时，整个页面会被缩小来放下它，所以要和手机本来的宽度比，不能和 innerWidth 比
        const out = { wide: Math.max(document.documentElement.scrollWidth, window.innerWidth) - W, small: [], clipped: [], who: [] };
        if (out.wide > 0) document.querySelectorAll('body *').forEach((el) => { const b = el.getBoundingClientRect(); if (b.width && b.right > W + 0.5 && out.who.length < 6 && !el.closest('.chips.scroll')) out.who.push((el.className.baseVal || el.className || el.tagName) + ' →' + Math.round(b.right)); });
        document.querySelectorAll('button, a.btn, [role="button"], input.sw').forEach((el) => {
          const b = (el.matches('input.sw') ? el.closest('label') : el).getBoundingClientRect();      // 开关：整行都能点
          if (!b.width || !b.height || el.closest('[hidden]')) return;
          const hit = el.matches('.syncpill') ? b.height + 14 : b.height;      // 同步状态的小药丸上下各多出 7px 的可点区域
          if ((hit < 39.5 || b.width < 39.5) && !el.matches('.seg button, .cal-c')) out.small.push(el.className + ' ' + Math.round(b.width) + 'x' + Math.round(b.height));
          if (b.right > W + 0.5 && !el.closest('.chips.scroll')) out.clipped.push(el.className);
        });
        return out;
      }, width);
      eq([r.wide <= 0, r.small, r.clipped], [true, [], []], width + 'px ' + where + ' ' + JSON.stringify(r));
    };
    await check('今天');
    await tab(p, 'timeline'); await check('时间轴');
    await tab(p, 'growth'); await check('成长'); await p.click('[data-act="wlist"]'); await check('成长（体重列表）');
    await tab(p, 'records'); await check('档案');
    for (const seg of ['deworm', 'care', 'health', 'insure', 'docs']) { await p.click('.seg.big [data-v="' + seg + '"]'); await check('档案 ' + seg); }
    // 护理面板（定了间隔、已经超了的样子）、保险和理赔的表单
    await p.click('.seg.big [data-v="care"]'); await p.click('.care-main[data-type="teeth"]'); await p.click('.sheet [data-act="care-every"][data-v="7"]'); await check('护理面板'); await closeSheet(p); await check('档案 care（该做了）');
    await p.click('.seg.big [data-v="insure"]'); await p.click('[data-act="policy-edit"]'); await check('保险表单'); await closeSheet(p);
    await p.click('[data-act="claim-add"]'); await check('理赔表单'); await closeSheet(p);
    await p.click('.pol .row'); await check('理赔（改）'); await closeSheet(p);
    await tab(p, 'home'); await check('今天（有护理提醒）'); await tab(p, 'records');
    await p.click('.fab'); await check('添加');
    for (const kind of ['weight', 'moment', 'food', 'activity', 'health', 'vaccine', 'doc']) { await p.click('.addgrid [data-kind="' + kind + '"]'); await check('表单 ' + kind); await closeSheet(p); await p.click('.fab'); }
    await p.click('.addgrid [data-act="day"]'); await check('日常'); await closeSheet(p);
    await tab(p, 'home'); await p.click('.hero-av'); await check('猫咪'); await p.click('#sheet-b [data-act="pet-edit"]'); await check('资料表单'); await closeSheet(p);
    await p.click('[data-act="go"][data-tab="prefs"]'); await check('设置');
    eq(w.errors, []); await w.close();
  }
});
t('对比度：浅色和深色下，文字和背景的对比都够', async () => {
  for (const scheme of ['light', 'dark']) {
    const w = await world(); const p = await w.demo({ colorScheme: scheme });
    const scan = async (where) => {
      const bad = await lowContrast(p);
      eq(bad, [], scheme + ' ' + where + '\n' + bad.join('\n'));
    };
    await p.click('[data-act="day-ok"]'); await scan('今天（带提示条）');
    await p.click('.today [data-act="day"]'); await p.click('#sheet-b [data-k="app"] [data-v="1"]'); await p.click('#sheet-b [data-k="poop"] [data-v="2"]'); await scan('日常面板'); await save(p); await scan('今天（有状况）');
    await tab(p, 'timeline'); await scan('时间轴');
    await tab(p, 'growth'); await p.click('[data-act="wlist"]'); await p.waitForTimeout(120); await scan('成长');
    await tab(p, 'records'); await scan('档案');
    for (const seg of ['deworm', 'care', 'health', 'insure', 'docs']) { await p.click('.seg.big [data-v="' + seg + '"]'); await scan('档案 ' + seg); }
    await p.click('.row.doc'); await scan('文件详情'); await closeSheet(p);
    // 护理：定了间隔、已经超了；做了以后的样子
    await p.click('.seg.big [data-v="care"]'); await p.click('.care-main[data-type="teeth"]'); await p.click('.sheet [data-act="care-every"][data-v="7"]'); await scan('护理面板（该做了）'); await closeSheet(p); await scan('档案 care（该做了）');
    await p.click('.care [data-act="care-done"][data-type="brush"]'); await scan('档案 care（今天做了）');
    await tab(p, 'home'); await scan('今天（有护理提醒）'); await tab(p, 'records');
    // 保险：快续保、额度快用完、被拒的理赔、表单和报错
    await p.click('.seg.big [data-v="insure"]'); await p.click('[data-act="policy-edit"]'); await scan('保险表单');
    await p.fill('#f-limit_amt', '30'); await p.fill('#f-deductible', '900'); await p.fill('#f-renew', await p.evaluate(() => CL.addDays(CL.today(), 6))); await p.fill('#f-rate', '300'); await save(p); await scan('保险表单报错');
    await p.fill('#f-rate', '70'); await save(p); await scan('档案 insure（快续保、额度快满）');
    await p.click('.pol .row'); await p.click('#sheet-b [data-k="status"] [data-v="denied"]'); await scan('理赔表单'); await save(p); await scan('档案 insure（被拒）');
    await p.click('[data-act="policy-edit"]'); await p.fill('#f-renew', await p.evaluate(() => CL.addDays(CL.today(), -3))); await p.fill('#f-start', ''); await p.fill('#f-limit_amt', '20'); await save(p); await scan('档案 insure（续保日已过、额度用完）');
    await tab(p, 'home'); await scan('今天（保险提醒）'); await tab(p, 'records');
    await p.click('.fab'); await scan('添加'); await p.click('.addgrid [data-kind="vaccine"]'); await scan('疫苗表单'); await save(p); await scan('表单报错'); await closeSheet(p);
    await p.click('[data-act="go"][data-tab="prefs"]'); await scan('设置');
    await p.click('[data-act="demo-off"]'); await p.waitForSelector('#init-text'); await p.fill('#init-text', 'x'); await p.click('[data-act="init-paste"]'); await scan('欢迎页');
    eq(w.errors, []); await w.close();
  }
});
t('别的工具的数据不碰：存储的名字都带 catlog 前缀，离线缓存只管自己的文件夹', async () => {
  const w = await world(); const a = await w.phone('a', { init: () => { try { if (!localStorage.getItem('homechores:v1:data')) { localStorage.setItem('homechores:v1:data', 'keep'); localStorage.setItem('mygear:v1:state', 'keep'); } } catch (e) { /* 页面还没有域名时会抛错 */ } } });
  await addPet(a, '年糕'); await addWeight(a, '4'); await synced(a);
  await a.evaluate(() => caches.open('footprint-cache-v1').then((c) => c.put('/footprint/x', new Response('other'))));
  await until(() => a.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => !!(r && r.active))), '离线缓存装好');
  await a.reload(); await a.waitForSelector('.hero');
  const st = await a.evaluate(async () => ({
    ls: Object.keys(localStorage).sort(), dbs: (await indexedDB.databases()).map((d) => d.name).sort(), caches: (await caches.keys()).sort(),
    scope: (await navigator.serviceWorker.getRegistration()).scope, other: await (await caches.open('footprint-cache-v1')).match('/footprint/x').then((r) => r.text()),
    keep: [localStorage.getItem('homechores:v1:data'), localStorage.getItem('mygear:v1:state')],
  }));
  eq(st.ls.filter((k) => !/^(homechores|mygear):/.test(k)).every((k) => k.indexOf('catlog:v1:') === 0), true, st.ls.join());
  eq([st.dbs, st.caches, st.other, st.keep], [['catlog'], ['catlog-cache-v1', 'footprint-cache-v1'], 'other', ['keep', 'keep']]);
  eq(st.scope, w.s.site);
  // 自己文件夹以外的请求：照常能发，但不进 CatLog 的缓存
  eq(await a.evaluate(() => fetch('/other/ping').then((r) => r.text())), 'pong');
  await sleep(200);
  eq(await a.evaluate(() => caches.open('catlog-cache-v1').then((c) => c.keys()).then((ks) => ks.map((k) => new URL(k.url).pathname).filter((p) => p.indexOf('/catlog/') !== 0))), []);
  // 断网（连页面都打不开）后重开：界面和上次的数据都在
  w.ctl.siteDown = true; w.ctl.down = true;
  await a.reload(); await a.waitForSelector('.hero');
  eq(await text(a, '.hero-w b'), '4.00');
  eq(w.errors, []); await w.close();
});
t('浏览器不让存东西（无痕模式）：照样能用，只是不记到下次', async () => {
  const w = await world();
  const a = await w.phone('a', { init: () => {
    const boom = () => { throw new DOMException('denied', 'SecurityError'); };
    Object.defineProperty(window, 'localStorage', { get: boom });
    Object.defineProperty(window, 'indexedDB', { get: boom });
  } });
  await addPet(a, '年糕'); await addWeight(a, '4.2');
  await a.click('.quick [data-kind="moment"]'); await pick(a, '#sheet-b [data-act="media-add"]', [await picture(a, 'n.jpg', 800, 600, 60)]); await a.waitForSelector('#sheet-b .me-i'); await save(a);
  await until(() => w.env.files.size === 1 && live(w.env.rows('entries')).length === 2, '都传上去了', 15000);
  await synced(a); await tab(a, 'timeline'); await loaded(a, '.tl-item .ph img');
  const p = await w.plain({ init: () => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('no'); } }); } });
  await p.waitForSelector('#init-text'); await p.click('[data-act="demo-on"]');
  eq(/演示开不了/.test(await toastText(p)), true);
  eq(w.errors, []); await w.close();
});
t('日期：按手机本地的日子算；过了半夜自动换成新的一天', async () => {
  const w = await world(); const a = await w.phone('a');
  await a.clock.install({ time: new Date('2026-11-14T05:20:00Z') });   // 芝加哥时间 11 月 13 日 23:20
  await a.reload();
  await addPet(a, '年糕'); await a.click('[data-act="day-ok"]');
  await until(() => live(w.env.rows('entries')).length === 1, '写进表格');
  eq(w.env.rows('entries')[0].date, '2026-11-13'); eq(w.env.rows('entries')[0].time, '23:20');
  eq(await text(a, '.today .card-sub'), '11 月 13 日 周五');
  await a.clock.fastForward('00:50:00');                         // 过了半夜
  await until(async () => (await text(a, '.today .card-sub')) === '11 月 14 日 周六', '换成新的一天', 12000);
  await a.waitForSelector('[data-act="day-ok"]');
  await tab(a, 'timeline'); eq(await text(a, '.tl-date b'), '13');
  eq(w.errors, []); await w.close();
});
t('键盘：回车保存、Esc 关闭、时间轴的条目能用键盘打开；初始化链接不对有提示', async () => {
  const w = await world(); const p = await w.plain();
  await p.waitForSelector('#init-text'); await p.fill('#init-text', 'https://example.com/#init=abc'); await p.click('[data-act="init-paste"]');
  eq((await text(p, '#init-err')).startsWith('这不像是初始化链接'), true);
  await p.fill('#init-text', w.s.link('b')); await p.click('[data-act="init-paste"]');
  await p.waitForSelector('[data-act="pet-add"]'); await p.click('[data-act="pet-add"]');
  await p.fill('#f-name', '年糕'); await p.keyboard.press('Enter'); await p.waitForSelector('.hero');
  await p.click('.hero-w'); await p.keyboard.press('Escape'); eq(await p.$('.sheet'), null);
  await p.click('.hero-w'); await p.fill('#f-kg', '3.9'); await p.keyboard.press('Enter'); await synced(p);
  eq(w.env.rows('entries')[0].created_by, 'b');
  await tab(p, 'timeline'); await p.focus('.tl-item'); await p.keyboard.press('Enter');
  await p.waitForSelector('.sheet'); eq(await text(p, '.sheet-h b'), '体重');
  eq(await p.evaluate(() => getComputedStyle(document.querySelector('.sheet-h .link')).outlineStyle), 'none');
  eq(w.errors, []); await w.close();
});

(async () => {
  browser = await chromium.launch();
  const list = tests.filter(([n]) => !ONLY || n.includes(ONLY));
  console.log('端到端测试（' + list.length + ' 项）');
  for (const [name, fn] of list) {
    const t0 = Date.now();
    try { await fn(); pass++; console.log('  ok  ' + name + '  ' + ((Date.now() - t0) / 1000).toFixed(1) + 's'); }
    catch (e) { fail++; console.log('FAIL  ' + name + '\n      ' + String(e && e.stack || e).split('\n').slice(0, 9).join('\n      ')); }
  }
  await browser.close();
  console.log('\n' + pass + ' 项通过' + (fail ? '，' + fail + ' 项失败' : ''));
  process.exit(fail ? 1 : 0);
})();
