// 生成图标：node tools/make-icons.js（需要 playwright）
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const OUT = path.join(__dirname, '..', 'app');
// 一个猫脸：肉垫粉的底，白色的头，两只眼睛一个鼻子
function svg(size, pad) {
  const s = 512, k = pad ? 0.8 : 1, o = (s - s * k) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#b83d63"/>
  <g transform="translate(${o} ${o}) scale(${k})">
    <path d="M134 214 L134 112 L216 164 Q256 152 296 164 L378 112 L378 214 Q396 252 396 292 C396 374 332 414 256 414 C180 414 116 374 116 292 Q116 252 134 214 Z" fill="#ffffff"/>
    <path d="M158 196 L158 156 L196 180 Z M354 196 L354 156 L316 180 Z" fill="#f6c3d1"/>
    <ellipse cx="204" cy="286" rx="17" ry="22" fill="#2a1820"/><ellipse cx="308" cy="286" rx="17" ry="22" fill="#2a1820"/>
    <circle cx="198" cy="278" r="6" fill="#ffffff"/><circle cx="302" cy="278" r="6" fill="#ffffff"/>
    <path d="M242 326 L270 326 L256 342 Z" fill="#e06b8c"/>
    <path d="M256 342 Q254 362 234 362 M256 342 Q258 362 278 362" fill="none" stroke="#2a1820" stroke-width="7" stroke-linecap="round"/>
  </g></svg>`;
}
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [name, size, pad] of [['icon-512.png', 512, false], ['icon-192.png', 192, false], ['apple-touch-icon.png', 180, false], ['icon-maskable.png', 512, true]]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent('<style>html,body{margin:0}svg{display:block}</style>' + svg(size, pad));
    await page.screenshot({ path: path.join(OUT, name), clip: { x: 0, y: 0, width: size, height: size } });
    console.log(name);
  }
  await browser.close();
})();
