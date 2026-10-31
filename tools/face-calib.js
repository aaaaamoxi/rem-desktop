/* ============ tools/face-calib.js — 立绘五官位置校准器 ============
   换立绘、或怀疑 pet-face.js 的坐标不准时跑它，把量出来的数填回 SPEC。

     node tools/face-calib.js          默认：扫眼睛 + 明暗网格
     node tools/face-calib.js check    额外验证 ram/rem 是不是同一套几何

   输出分三段：
     1) 逐行横向扫描 —— 每一行里读到什么 x 范围的眼 / 嘴
     2) 明暗字符网格 —— 直观看形状，'#'最暗，空白是皮肤
     3) check 模式 —— 两张精灵图 alpha 通道逐像素比对
   ================================================================ */
const path = require('path');
const puppeteer = require('puppeteer-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ROOT = path.resolve(__dirname, '..');

/* 扫描区：源图坐标。脸 windowL/R 是两只眼睛，mouthWin 是鼻以下到下巴 */
const EYE = { y0: 445, y1: 565, winL: [205, 345], winR: [425, 535] };

(async () => {
  const mode = process.argv[2] || '';
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--allow-file-access-from-files'] });
  const p = await b.newPage();
  await p.goto('file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1200));

  const res = await p.evaluate(async (EYE) => {
    const load = src => new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
    const grab = async (src) => {
      const img = await load(src);
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data };
    };
    const A = await grab('assets/ram.png');
    const SX = 714 / A.w, SY = 1423 / A.h;
    const cell = (x, y) => {
      const px = Math.round(x / SX), py = Math.round(y / SY);
      if (px < 0 || px >= A.w || py < 0 || py >= A.h) return null;
      const i = (py * A.w + px) * 4;
      const r = A.d[i], gg = A.d[i + 1], bb = A.d[i + 2], a = A.d[i + 3];
      const mx = Math.max(r, gg, bb), mn = Math.min(r, gg, bb);
      return { a, sat: mx ? (mx - mn) / mx : 0, luma: 0.299 * r + 0.587 * gg + 0.114 * bb };
    };
    /* 皮肤判定要够宽：偏灰的脸颊阴影也算皮肤，否则会把阴影读成眼睛的一部分 */
    const isSkin = v => v && v.a >= 40 && v.luma > 185 && v.sat < 0.30;

    const scanRow = (y, x0, x1) => {
      const segs = [];
      let cur = null, gap = 0;
      for (let x = x0; x <= x1; x += 2) {
        if (!isSkin(cell(x, y))) {
          if (!cur) cur = { x0: x, x1: x }; else cur.x1 = x;
          gap = 0;
        } else if (cur) {
          gap += 2;
          if (gap > 18) { segs.push(cur); cur = null; gap = 0; }   /* 眼白高光不断眼 */
        }
      }
      if (cur) segs.push(cur);
      return segs.length ? segs.reduce((a, s) => (s.x1 - s.x0 > a.x1 - a.x0 ? s : a)) : null;
    };

    const out = { L: [], R: [] };
    for (let y = EYE.y0; y <= EYE.y1; y += 3) {
      const l = scanRow(y, EYE.winL[0], EYE.winL[1]);
      const r = scanRow(y, EYE.winR[0], EYE.winR[1]);
      out.L.push(`${y}: ${l ? l.x0 + '..' + l.x1 : '—'}`);
      out.R.push(`${y}: ${r ? r.x0 + '..' + r.x1 : '—'}`);
    }

    const grid = [];
    for (let y = 600; y <= 712; y += 3) {
      let ln = '';
      for (let x = 330; x <= 445; x += 2) {
        const v = cell(x, y), L = v && v.a >= 40 ? v.luma : 255;
        ln += L > 215 ? ' ' : L > 195 ? '.' : L > 170 ? ':' : L > 140 ? '~' : L > 105 ? '=' : L > 75 ? 'o' : '#';
      }
      grid.push(String(y).padStart(3) + ' |' + ln + '|');
    }

    let geo = null;
    if (EYE.check) {
      const B = await grab('assets/rem.png');
      let alphaDiff = 0, shapeDiff = 0;
      if (A.w === B.w && A.h === B.h) {
        for (let i = 0; i < A.d.length; i += 4) {
          if (Math.abs(A.d[i + 3] - B.d[i + 3]) > 2) alphaDiff++;
          if ((A.d[i + 3] > 40) !== (B.d[i + 3] > 40)) shapeDiff++;
        }
      }
      geo = { size: [A.w, A.h], alphaDiff, shapeDiff, total: A.w * A.h };
    }
    return { out, grid, geo };
  }, Object.assign({}, EYE, { check: mode === 'check' }));

  console.log('===== 左眼横向范围（源图坐标） =====');
  res.out.L.forEach(s => console.log('  ' + s));
  console.log('\n===== 右眼横向范围（源图坐标） =====');
  res.out.R.forEach(s => console.log('  ' + s));
  console.log('\n===== 鼻以下到下巴的明暗（空白=皮肤 # =最暗） =====');
  res.grid.forEach(s => console.log('  ' + s));
  if (res.geo) console.log('\n===== ram / rem 几何一致性 =====\n  ' + JSON.stringify(res.geo));
  await b.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
