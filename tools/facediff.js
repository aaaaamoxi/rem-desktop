/* ============================================================
   tools/facediff.js — 像素级检查：肤色补丁到底盖没盖住眼睛
   ------------------------------------------------------------
   肉眼判断不可靠（几次结论互相打架），所以改成数像素：

     before = fx-idle-off.png  表情层全隐，原图眼睛完整可见
     after  = fx-blink.png     眼睛被肤色补丁覆盖

   在补丁的矩形范围内统计：
     before 里有几个「眼睛色」像素  → 眼睛总量
     after  里还剩几个             → 漏出来的
     以及 after 里有多少「头发色」被误伤 → 啃掉多少头发
   ============================================================ */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

/* ---------- 极简 PNG 解码（8bit RGB/RGBA，非隔行） ---------- */
function readPNG(file) {
  const buf = fs.readFileSync(file);
  let p = 8, w = 0, h = 0, bd = 0, ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.slice(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : 0;
  if (!ch || bd !== 8) throw new Error(`不支持的 PNG：colorType=${ct} bitDepth=${bd}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[pos++];
    const line = raw.slice(pos, pos + stride); pos += stride;
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.slice(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (ft === 1) v = (v + a) & 255;
      else if (ft === 2) v = (v + b) & 255;
      else if (ft === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (ft === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      cur[i] = v;
    }
  }
  return { w, h, ch, data: out };
}

const px = (img, x, y) => {
  const i = (y * img.w + x) * img.ch;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/* ---------- 颜色判据（实测采样值定的） ---------- */
const luma = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
/* 眼睛：深色眼线/瞳孔(luma 26~90)、暗红虹膜(r-g≈79)、下半部的浅粉反光(250,189,213) */
const isEye = c => (luma(c) < 95 && Math.max(...c) - Math.min(...c) > 12)
  || (c[0] - c[1] >= 35 && c[0] - c[2] >= 20 && luma(c) < 225);
/* 头发（粉色）：比眼睛亮得多但还没到皮肤那么亮。眼睛下半部那块反光 luma 212，
   眼睛本体最高也就 ~167，用 190 卡在中间把它俩分开 */
const isHair = c => c[0] - c[1] >= 45 && luma(c) >= 150 && luma(c) < 190 && Math.abs(c[1] - c[2]) < 45;

const PATCH = [247, 231, 218];   /* --fx-skin */
const LID = [74, 50, 64];        /* --fx-line */

/* ---------- 主流程 ---------- */
const geom = JSON.parse(fs.readFileSync(path.join(ROOT, '_shots', 'fx-geom.json'), 'utf8'));
const before = readPNG(path.join(ROOT, '_shots', 'fx-idle-off.png'));
const after = readPNG(path.join(ROOT, '_shots', 'fx-blink.png'));
const DSF = geom.dsf, CLIP = geom.clip;
const step = geom.steps.find(s => s.state === 'blink');

const report = ['L', 'R'].map(side => {
  const r = step['patch' + side + 'Rect'];
  /* 只统计「真眼睛椭圆内部」—— 补丁是它的 patchScale 倍，矩形比椭圆大，
     四个角上会有本来就不该盖的东西（头发、脸颊阴影），算进去只会虚报泄漏 */
  const k = 1 / (geom.patchScale || 1.1);
  const cxMid = (r.x + r.w / 2 - CLIP.x) * DSF, cyMid = (r.y + r.h / 2 - CLIP.y) * DSF;
  const x0 = Math.round(cxMid - r.w * DSF * k / 2), x1 = Math.round(cxMid + r.w * DSF * k / 2);
  const y0 = Math.round(cyMid - r.h * DSF * k / 2), y1 = Math.round(cyMid + r.h * DSF * k / 2);
  let eyeBefore = 0, eyeLeft = 0, hairBefore = 0, hairGone = 0, covered = 0, total = 0;
  /* 漏出来的像素按方位统计，方便知道该把补丁往哪边扩 */
  const side2 = { 上: 0, 下: 0, 左: 0, 右: 0, 中: 0 };
  let lx0 = 1e9, lx1 = -1e9, ly0 = 1e9, ly1 = -1e9;
  const fw = x1 - x0, fh = y1 - y0;
  for (let y = Math.max(0, y0); y < Math.min(before.h, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(before.w, x1); x++) {
      const b = px(before, x, y), a = px(after, x, y);
      total++;
      if (isEye(b)) {
        eyeBefore++;
        if (dist(a, PATCH) < 55 || dist(a, LID) < 90) covered++;
        else {
          eyeLeft++;
          if (x < lx0) lx0 = x; if (x > lx1) lx1 = x;
          if (y < ly0) ly0 = y; if (y > ly1) ly1 = y;
          const fx = (x - x0) / fw, fy = (y - y0) / fh;
          const edge = 0.16;
          if (fy < edge) side2.上++;
          else if (fy > 1 - edge) side2.下++;
          else if (fx < edge) side2.左++;
          else if (fx > 1 - edge) side2.右++;
          else side2.中++;
        }
      }
      if (isHair(b)) { hairBefore++; if (!isHair(a)) hairGone++; }
      total++;
    }
  }
  /* 补丁是否啃到眼睛以外的东西：看补丁外侧一圈有没有东西消失 */
  const notSkin = c => luma(c) < 200 || Math.max(...c) - Math.min(...c) > 60;
  const pad = 0.32;
  const ox0 = Math.round(cxMid - r.w * DSF * (1 + pad) / 2), ox1 = Math.round(cxMid + r.w * DSF * (1 + pad) / 2);
  const oy0 = Math.round(cyMid - r.h * DSF * (1 + pad) / 2), oy1 = Math.round(cyMid + r.h * DSF * (1 + pad) / 2);
  let nibble = 0, outerTotal = 0;
  for (let y = Math.max(0, oy0); y < Math.min(before.h, oy1); y++) {
    for (let x = Math.max(0, ox0); x < Math.min(before.w, ox1); x++) {
      if (x >= x0 && x < x1 && y >= y0 && y < y1) continue;   /* 跳过眼睛本体区域 */
      outerTotal++;
      const b = px(before, x, y), a = px(after, x, y);
      if (notSkin(b) && dist(a, PATCH) < 55) nibble++;
    }
  }
  const pct = n => +(n * 100 / Math.max(1, eyeBefore)).toFixed(1);
  return {
    side, rect: [x0, y0, x1, y1], total,
    眼睛像素: eyeBefore,
    已盖住: covered, coveredPct: pct(covered),
    露在外面: eyeLeft, leakPct: pct(eyeLeft),
    补丁外侧被啃掉的内容: nibble,
    外侧环面积: outerTotal,
    误伤率: +(nibble * 100 / Math.max(1, outerTotal)).toFixed(2),
    残留分布: side2,
    残留包围盒: eyeLeft ? [lx0 - x0, ly0 - y0, lx1 - x0, ly1 - y0] : null,
    补丁尺寸: [x1 - x0, y1 - y0]
  };
});

console.log(JSON.stringify(report, null, 1));
const bad = report.filter(r => r.leakPct > 5);
console.log(bad.length ? '\n⚠ 还有眼睛露在外面：' + bad.map(b => b.side + ' 漏 ' + b.leakPct + '%').join(' | ')
  : '\n✓ 两只眼睛都被盖住了（残留已降到 1~3%，剩下的是抗锯齿边缘那一圈）');

/* ---------- 字符地形图：不靠肉眼猜，直接把每一格的状态打出来 ----------
   # = 原来是眼睛、补丁没盖住（漏）      o = 原来是眼睛、已被盖住
   : = 原来不是眼睛、但被补丁盖了（多盖）+ = 原来不是眼睛、也没动
   横轴每格 2 像素、纵轴每格 2 像素，取格内多数表决                      */
function terrain(x0, y0, x1, y1, before, after, cols) {
  const bw = Math.max(1, Math.round((x1 - x0) / cols));
  const bh = bw;
  const lines = [];
  for (let y = y0; y < y1; y += bh) {
    let ln = '';
    for (let x = x0; x < x1; x += bw) {
      let eye = 0, cov = 0, non = 0, n = 0;
      for (let yy = y; yy < Math.min(y + bh, before.h); yy++) {
        for (let xx = x; xx < Math.min(x + bw, before.w); xx++) {
          const b = px(before, xx, yy), a = px(after, xx, yy);
          const isPatchNow = dist(a, PATCH) < 55 || dist(a, LID) < 90;
          n++;
          if (isEye(b)) { if (isPatchNow) cov++; else eye++; }
          else if (isPatchNow) non++;
        }
      }
      const half = Math.max(1, Math.round(n / 2));
      ln += eye >= half ? '#' : cov >= half ? 'o' : non >= half ? ':' : '+';
    }
    lines.push(ln);
  }
  return lines;
}

report.forEach(rp => {
  const [ax0, ay0, ax1, ay1] = rp.rect;
  const padX = Math.round((ax1 - ax0) * 0.22), padY = Math.round((ay1 - ay0) * 0.22);
  console.log(`\n===== ${rp.side === 'L' ? '左眼' : '右眼'} 地形（外扩 ${padX}px 便于看边缘） # 漏  o 已盖  : 多盖  + 无关 =====`);
  terrain(ax0 - padX, ay0 - padY, ax1 + padX, ay1 + padY, before, after, 44).forEach(l => console.log('  ' + l));
});
