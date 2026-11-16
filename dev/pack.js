// 打包：node dev/pack.js 输出目录
// 生成发布包（catlog/，16 个文件平铺）和开发包（catlog-dev/），并在输出目录里单独放一份 Code.gs 和部署文档。
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'dist'));
const V = require(path.join(ROOT, 'app', 'core.js')).VERSION;
const RELEASE = ['index.html', 'styles.css', 'core.js', 'charts.js', 'app.js', 'sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable.png', 'apple-touch-icon.png',
  'fredoka-500.woff2', 'fredoka-600.woff2', 'OFL-Fredoka.txt', 'Code.gs', 'README.md'];
const have = fs.readdirSync(path.join(ROOT, 'app')).sort();
if (JSON.stringify(have) !== JSON.stringify(RELEASE.slice().sort())) throw new Error('app/ 里的文件和发布清单对不上：\n' + have.join(' ') + '\n' + RELEASE.slice().sort().join(' '));
if (!new RegExp("const VERSION = '" + V.replace(/\./g, '\\.') + "';").test(fs.readFileSync(path.join(ROOT, 'app', 'Code.gs'), 'utf8'))) throw new Error('Code.gs 和 core.js 的版本号不一样');

const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'catlog-pack-'));
fs.mkdirSync(OUT, { recursive: true });
function zip(dir, name, out) { if (fs.existsSync(out)) fs.rmSync(out); execFileSync('zip', ['-r', '-X', '-q', out, name], { cwd: dir }); }

// 发布包
const rel = path.join(tmp, 'catlog');
fs.mkdirSync(rel);
RELEASE.forEach((f) => fs.copyFileSync(path.join(ROOT, 'app', f), path.join(rel, f)));
zip(tmp, 'catlog', path.join(OUT, '猫咪日志-CatLog-' + V + '.zip'));

// 开发包
const dev = path.join(tmp, 'catlog-dev');
fs.mkdirSync(dev);
fs.cpSync(path.join(ROOT, 'app'), path.join(dev, 'app'), { recursive: true });
fs.cpSync(path.join(ROOT, 'src'), path.join(dev, 'src'), { recursive: true });
fs.mkdirSync(path.join(dev, 'dev'));
fs.readdirSync(path.join(ROOT, 'dev')).filter((f) => /\.(js|py)$/.test(f)).forEach((f) => fs.copyFileSync(path.join(ROOT, 'dev', f), path.join(dev, 'dev', f)));
fs.cpSync(path.join(ROOT, 'dev', 'fixtures'), path.join(dev, 'dev', 'fixtures'), { recursive: true });      // 上一个版本的后端和网页，升级测试要用
fs.mkdirSync(path.join(dev, 'tools'));
['make-icons.js', 'make-fonts.sh'].forEach((f) => fs.copyFileSync(path.join(ROOT, 'tools', f), path.join(dev, 'tools', f)));
['package.json', 'README-dev.md'].forEach((f) => fs.copyFileSync(path.join(ROOT, f), path.join(dev, f)));
zip(tmp, 'catlog-dev', path.join(OUT, '猫咪日志-开发测试工具-' + V + '.zip'));

fs.copyFileSync(path.join(ROOT, 'app', 'Code.gs'), path.join(OUT, 'Code.gs'));
fs.copyFileSync(path.join(ROOT, 'app', 'README.md'), path.join(OUT, '部署文档-README.md'));
fs.rmSync(tmp, { recursive: true, force: true });
console.log('打包完成：' + OUT);
fs.readdirSync(OUT).forEach((f) => console.log('  ' + f + '  ' + (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1) + ' KB'));
