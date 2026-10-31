/* tools/make-icon.js — 用角色头像生成托盘/程序图标（PNG + ICO）
   纯 Node，不需要 ImageMagick。ICO 直接内嵌 PNG（Vista 以上都认）
*/
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

function pngToIco(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);         /* reserved */
  header.writeUInt16LE(1, 2);         /* type: icon */
  header.writeUInt16LE(1, 4);         /* count */

  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);             /* palette */
  entry.writeUInt8(0, 3);             /* reserved */
  entry.writeUInt16LE(1, 4);          /* planes */
  entry.writeUInt16LE(32, 6);         /* bpp */
  entry.writeUInt32LE(png.length, 8); /* bytes */
  entry.writeUInt32LE(22, 12);        /* offset */

  return Buffer.concat([header, entry, png]);
}

(async () => {
  const outDir = path.resolve(__dirname, '..', 'assets');
  fs.mkdirSync(outDir, { recursive: true });
  const file = 'file:///' + path.resolve(__dirname, '_icon.html').replace(/\\/g, '/');

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: ['--allow-file-access-from-files']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 300, height: 300, deviceScaleFactor: 1 });
  await page.goto(file, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 400));

  const plate = await page.$('#plate');
  const buf = await plate.screenshot({ omitBackground: true });

  fs.writeFileSync(path.join(outDir, 'icon.png'), buf);
  fs.writeFileSync(path.join(outDir, 'icon.ico'), pngToIco(buf, 256));
  console.log('icon.png / icon.ico ->', outDir, buf.length, 'bytes');

  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
