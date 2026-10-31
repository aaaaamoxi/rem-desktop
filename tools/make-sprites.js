/* tools/make-sprites.js — 把 _art 下的立绘下采样成 2x 精灵，落到 assets/
   用法：node tools/make-sprites.js
   本机没有 PIL/ImageMagick，只能借浏览器 canvas 缩放。 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ROOT = path.resolve(__dirname, '..');

/* 目标尺寸 = 显示尺寸(140x279) 的 2 倍；比例必须和源图一致 */
const TARGET = { w: 280, h: 558 };

const JOBS = [
  { src: '_art/ram-cut.png', out: 'assets/ram.png' },
  { src: '_art/rem-cut.png', out: 'assets/rem.png' }
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: ['--allow-file-access-from-files']
  });
  const page = await browser.newPage();
  await page.goto('file:///' + path.join(__dirname, '_sprite.html').replace(/\\/g, '/'),
    { waitUntil: 'load' });

  for (const job of JOBS) {
    const srcAbs = path.join(ROOT, job.src);
    if (!fs.existsSync(srcAbs)) {
      console.error('缺少源图:', job.src);
      continue;
    }
    const url = 'file:///' + srcAbs.replace(/\\/g, '/');
    const b64 = await page.evaluate(
      (u, w, h) => window.makeSprite(u, w, h), url, TARGET.w, TARGET.h
    );
    const buf = Buffer.from(b64.split(',')[1], 'base64');
    const outAbs = path.join(ROOT, job.out);
    fs.writeFileSync(outAbs, buf);
    console.log(`${job.out}  ${TARGET.w}x${TARGET.h}  ${(buf.length / 1024).toFixed(0)} KB`);
  }

  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
