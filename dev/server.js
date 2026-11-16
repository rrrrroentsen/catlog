// 本地测试用的服务器。
// 三个端口，模仿真实环境里的三个域名：
//   站点：把 app/ 放在 /catlog/ 子路径下（和 GitHub Pages 一样）
//   接口：模仿 Apps Script 网页应用 —— POST 之后回 302，跳到「回显」域名去拿结果；不处理 OPTIONS 预检
//   回显：模仿 script.googleusercontent.com
// 后端逻辑是真实的 Code.gs，跑在 gas-mock.js 模拟的环境里。
// 单独运行：node dev/server.js   然后按提示打开网页。
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createEnv } = require('./gas-mock.js');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.gs': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };

function listen(handler) {
  return new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => resolve(s)); });
}

async function start(opts) {
  opts = opts || {};
  const appDir = opts.app || process.env.CATLOG_APP || path.join(__dirname, '..', 'app');
  const env = createEnv({ code: opts.code || path.join(appDir, 'Code.gs') });
  env.call('setup');
  // once：某个文件的下一次请求回这份内容（只一次），用来模仿「手机上还留着一份旧文件」
  const ctl = { down: false, delay: 0, html: false, failNext: 0, log: [], siteDown: false, once: new Map() };
  const results = new Map();

  const site = await listen((req, res) => {
    if (ctl.siteDown) { req.socket.destroy(); return; }
    const url = new URL(req.url, 'http://x');
    let p = decodeURIComponent(url.pathname);
    if (p === '/catlog') { res.writeHead(301, { Location: '/catlog/' }); res.end(); return; }
    if (p === '/other/ping') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('pong'); return; }     // 假装是同一个域名下的别的工具
    if (p.indexOf('/catlog/') !== 0) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not here'); return; }
    p = p.slice('/catlog/'.length) || 'index.html';
    if (ctl.once.has(p)) { const body = ctl.once.get(p); ctl.once.delete(p); res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(body); return; }
    const file = path.join(appDir, path.normalize(p));
    if (file.indexOf(appDir) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });

  let echoPort = 0;
  const api = await listen((req, res) => {
    ctl.log.push({ method: req.method, type: req.headers['content-type'] || '', origin: req.headers.origin || '', cookie: req.headers.cookie || '' });
    if (ctl.down) { req.socket.destroy(); return; }
    if (req.method === 'OPTIONS') { res.writeHead(405); res.end(); return; }   // Apps Script 不回应预检
    if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(env.get())); return; }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      setTimeout(() => {
        if (ctl.down) { req.socket.destroy(); return; }
        let out;
        if (ctl.html) out = '<!doctype html><title>Sign in - Google Accounts</title>';
        else if (ctl.failNext > 0) { ctl.failNext--; out = JSON.stringify({ ok: false, error: 'server', message: '表格临时出错' }); }
        else { try { out = env.postRaw(body); } catch (e) { out = JSON.stringify({ ok: false, error: 'server', message: String(e.message || e) }); } }
        const key = crypto.randomBytes(12).toString('hex');
        results.set(key, out);
        res.writeHead(302, { Location: 'http://127.0.0.1:' + echoPort + '/macros/echo?user_content_key=' + key, 'Access-Control-Allow-Origin': '*' });
        res.end();
      }, ctl.delay);
    });
  });
  const echo = await listen((req, res) => {
    const key = new URL(req.url, 'http://x').searchParams.get('user_content_key');
    if (ctl.down || !results.has(key)) { req.socket.destroy(); return; }
    const out = results.get(key); results.delete(key);
    res.writeHead(200, { 'Content-Type': ctl.html ? 'text/html' : 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(out);
  });
  echoPort = echo.address().port;

  const siteUrl = 'http://127.0.0.1:' + site.address().port + '/catlog/';
  const apiUrl = 'http://127.0.0.1:' + api.address().port + '/macros/s/TEST/exec';
  function link(who) { return siteUrl + '#init=' + Buffer.from(JSON.stringify({ v: 1, u: apiUrl, t: env.token(who), w: who })).toString('base64url'); }
  return { site: siteUrl, api: apiUrl, env, ctl, link, stop() { [site, api, echo].forEach((s) => { s.closeAllConnections && s.closeAllConnections(); s.close(); }); } };
}

module.exports = { start };

if (require.main === module) {
  start().then((s) => {
    console.log('页面（演示模式点「先看看演示」）：\n  ' + s.site);
    console.log('\n接上模拟后端的两条初始化链接：\n  成员 A：' + s.link('a') + '\n  成员 B：' + s.link('b'));
    console.log('\nCtrl+C 结束。数据只在内存里，关掉就没了。');
  });
}
