// 生成单文件的预览版（发布成 Claude 里的 Artifact 用）：node dev/build-preview.js [输出文件]
// 样式、字体、脚本全部内嵌；只有演示模式；不注册离线缓存；打开和保存文件的那段代码去掉（预览页面里用不了）。
'use strict';
const fs = require('fs');
const path = require('path');
const APP = process.env.CATLOG_APP || path.join(__dirname, '..', 'app');
const out = process.argv[2] || path.join(__dirname, '..', 'preview', 'catlog-preview.html');
const read = (f) => fs.readFileSync(path.join(APP, f), 'utf8');

let css = read('styles.css');
for (const w of ['500', '600']) {
  const b64 = fs.readFileSync(path.join(APP, 'fredoka-' + w + '.woff2')).toString('base64');
  css = css.replace('url("fredoka-' + w + '.woff2")', 'url("data:font/woff2;base64,' + b64 + '")');
}
if (/url\("fredoka/.test(css)) throw new Error('字体没有内嵌进去');
// 预览页面外面那层已经给整页留了刘海和底部横条的位置，这里不用再留一遍
css += '\nbody { padding-top: 0; }\n#app { min-height: 0; }\n';

const html = read('index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script src="core.js">')).replace(/<noscript>[\s\S]*?<\/noscript>/, '').trim();
let app = read('app.js').replace(/\/\*<save>\*\/[\s\S]*?\/\*<\/save>\*\//g, '');
if (/download=|navigator\.share|file-share/.test(app)) throw new Error('保存文件的代码没有去干净');
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');

const page = [
  '<title>CatLog 猫咪日志</title>',
  '<meta name="claude:viewport-fit-sides" content="cover">',
  '<style>\n' + css + '</style>',
  body,
  '<script>window.CATLOG_ENV = { preview: true };</script>',
  '<script>\n' + safe(read('core.js')) + '</script>',
  '<script>\n' + safe(read('charts.js')) + '</script>',
  '<script>\n' + safe(app) + '</script>',
  '',
].join('\n');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(out + '  ' + (page.length / 1024).toFixed(1) + ' KB');
