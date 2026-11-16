// 把 src/ 里的几段源码拼成 app/app.js：node dev/build.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// 源码里不应该有看不见的字符（写文件的工具有时会把转义写成字符本身）。这里用数字写范围，不写转义。
const BAD = [[0, 8], [11, 12], [14, 31], [127, 127], [0x200b, 0x200f], [0x2028, 0x2029], [0xfeff, 0xfeff]];
function findBad(s) {
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (BAD.some(([a, b]) => c >= a && c <= b)) return i; }
  return -1;
}
function check(name, text) {
  const i = findBad(text);
  if (i >= 0) { console.error(name + ' 里有看不见的字符 U+' + text.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0') + '，在第 ' + text.slice(0, i).split('\n').length + ' 行'); process.exit(1); }
}

const parts = fs.readdirSync(path.join(ROOT, 'src')).filter((f) => /^\d\d-.*\.js$/.test(f)).sort();
// 版本号只写在 core.js 一处；拼的时候抄一份进 app.js（BUILD），打开页面时两边对一下，防止新旧文件混着跑
const ver = /VERSION: '(\d+\.\d+\.\d+)'/.exec(fs.readFileSync(path.join(ROOT, 'app', 'core.js'), 'utf8'));
if (!ver) { console.error('在 core.js 里找不到版本号'); process.exit(1); }
let out = '/* CatLog 猫咪日志 —— 界面。由 src/ 里的 ' + parts.length + ' 段源码拼成（node dev/build.js），不要直接改这个文件。 */\n(function () {\n\'use strict\';\nvar BUILD = \'' + ver[1] + '\';\n';
for (const f of parts) out += '\n' + fs.readFileSync(path.join(ROOT, 'src', f), 'utf8').replace(/\s+$/, '') + '\n';
out += '\n})();\n';
check('app.js', out);
for (const f of ['core.js', 'charts.js', 'Code.gs', 'styles.css', 'index.html', 'sw.js']) {
  const p = path.join(ROOT, 'app', f);
  if (fs.existsSync(p)) check(f, fs.readFileSync(p, 'utf8'));
}
// 顶层的名字不能和浏览器自带的全局名字撞上（撞上了，文件里再用那个全局就会拿到自己的函数）
const GLOBALS = ['history', 'location', 'navigator', 'document', 'window', 'screen', 'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'fetch', 'URL', 'Blob', 'File', 'FileReader', 'Image',
  'Promise', 'Map', 'Set', 'console', 'alert', 'confirm', 'prompt', 'open', 'close', 'print', 'focus', 'blur', 'stop', 'find', 'name', 'status', 'top', 'parent', 'self', 'length', 'event', 'origin',
  'performance', 'crypto', 'atob', 'btoa', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'scroll', 'scrollTo', 'frames', 'external', 'closed', 'Date', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Error'];
const declared = new Set();
for (const m of out.matchAll(/^(?:function\s+([A-Za-z_$][\w$]*)|var\s+([^;=]+?)(?:=|;))/gm)) {
  if (m[1]) declared.add(m[1]); else m[2].split(',').forEach((x) => { const n = x.trim().split(/\s/)[0]; if (/^[A-Za-z_$][\w$]*$/.test(n)) declared.add(n); });
}
const clash = GLOBALS.filter((g) => declared.has(g));
if (clash.length) { console.error('app.js 顶层的名字和浏览器的全局撞上了：' + clash.join('、')); process.exit(1); }
new Function(out);   // 只检查语法，不运行
fs.writeFileSync(path.join(ROOT, 'app', 'app.js'), out);
console.log('app.js：' + parts.join(' + ') + ' → ' + (out.length / 1024).toFixed(1) + ' KB');
if (require.main !== module) module.exports = { findBad, check };
