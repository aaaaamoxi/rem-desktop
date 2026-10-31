/* tools/shot-sheet.js — 把定稿预览页截成 PNG（2x），便于对照参考图 */
const path = require('path');
const puppeteer = require('puppeteer-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

(async () => {
  const out = process.argv[2] || 'ram-sheet.png';
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--allow-file-access-from-files', '--hide-scrollbars', '--force-device-scale-factor=2']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 720, height: 760, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('[err]', e.message));
  await page.goto('file:///' + path.resolve(__dirname, 'ram-sheet.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 400));
  const el = await page.$('#sheet');
  await el.screenshot({ path: path.join(__dirname, '..', '_shots', out), captureBeyondViewport: false });
  console.log('saved', out);
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
