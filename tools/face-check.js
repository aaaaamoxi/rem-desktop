/* ============ tools/face-check.js — 表情层贴合校验 ============
   两件事，都量化，不靠肉眼：

   A. 结构：换上 .pet__artwrap 之后，表情层必须和立绘受同一个 transform
      —— 否则睡觉压扁 / 咀嚼抖动时，眼睛上的贴图会原地不动。

   B. 几何：用 canvas 在立绘上反推出真眼睛的位置，再在 SVG 里插一个
      临时标记量它的屏幕矩形，跟肤色补丁 / 闭眼弧 / ^^ 弧 逐个比。
      偏差都用「相对真眼睛」的 CSS px 表示。

   用法：node tools/face-check.js
   输出：控制台 JSON；_shots/fx-<state>.png 与 -off.png 用于肉眼复核
   ================================================================ */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ROOT = path.resolve(__dirname, '..');

const STATES = ['idle', 'blink', 'sleeping', 'happy', 'eating', 'weak', 'dead'];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--allow-file-access-from-files', '--hide-scrollbars']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 620, deviceScaleFactor: 5 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1200));

  await page.evaluate(() => {
    Pet.pet.setPos(430, Pet.pet.pos.groundY);
    Pet.pet.stop();
    const st = document.createElement('style');
    st.textContent = [
      '.fx-eye,.fx-mouth,.fx-happy,.fx-closed{transition:none!important}',
      '.pet__body{animation:none!important}',
      '.pet.is-eating .pet__artwrap{animation:art-chew 0.36s ease-in-out infinite!important}'
    ].join('\n');
    document.head.appendChild(st);
  });
  await new Promise(r => setTimeout(r, 300));

/* 真眼睛位置的 ground truth —— 由 tools/face-calib.js 逐像素扫出来的，
   单位与 pet-face.js 的 SPEC 一致（714×1423 源图坐标系）。
   立绘或 SPEC 重新校准时，重跑 _probe-eye.js 更新这里。 */
const TRUTH = {
  L: { cx: 266, cy: 502, rx: 37, ry: 51 },
  R: { cx: 482, cy: 507, rx: 33, ry: 49 }
};

const out = { truth: TRUTH, steps: [], errors };

  for (const s of STATES) {
    await page.evaluate(st => {
      const p = document.getElementById('pet');
      p.className = 'pet' + (st === 'idle' ? '' : ' is-' + st);
      document.querySelectorAll('.fx-z').forEach(n => n.remove());
      document.getAnimations().forEach(a => {
        try { if (a.animationName === 'art-chew') { a.pause(); a.currentTime = 108; } } catch (e) { /* noop */ }
      });
    }, s);
    await new Promise(r => setTimeout(r, 260));

    const m = await page.evaluate(t => {
      const wrap = document.querySelector('.pet__artwrap');
      const face = document.querySelector('.pet__face');
      const art = document.querySelector('.pet__art');
      const r = el => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 }; };

      const wrapRect = r(wrap), faceRect = r(face), artRect = r(art);

      /* 临时标记：按真眼睛在源图里的位置画两个椭圆，它跟着 face 一起变形，
         于是它的屏幕位置 = 真眼睛在屏幕上的位置 */
      const NS = 'http://www.w3.org/2000/svg';
      const marks = ['L', 'R'].map(k => {
        const e = document.createElementNS(NS, 'ellipse');
        e.setAttribute('cx', (t[k].cx * 120 / 714).toFixed(2));
        e.setAttribute('cy', (t[k].cy * 239 / 1423).toFixed(2));
        e.setAttribute('rx', (t[k].rx * 120 / 714).toFixed(2));
        e.setAttribute('ry', (t[k].ry * 239 / 1423).toFixed(2));
        e.setAttribute('fill', 'none');
        face.appendChild(e);
        return e;
      });

      const grab = sel => Array.from(face.querySelectorAll(sel)).map(r);
      const res = {
        truthL: r(marks[0]), truthR: r(marks[1]),
        patch: grab('.fx-eye .fx-patch'),
        closed: grab('.fx-closed'),
        happy: grab('.fx-happy')
      };
      marks.forEach(e => e.remove());

      const round = o => ({ x: +o.x.toFixed(2), y: +o.y.toFixed(2), w: +o.w.toFixed(2), h: +o.h.toFixed(2), cx: +o.cx.toFixed(2), cy: +o.cy.toFixed(2) });
      const rel = (a, b) => ({ dx: +(a.cx - b.cx).toFixed(2), dy: +(a.cy - b.cy).toFixed(2), wr: +(a.w / b.w).toFixed(3), hr: +(a.h / b.h).toFixed(3) });

      return {
        sameBox: JSON.stringify(round(wrapRect)) === JSON.stringify(round(faceRect)),
        artFillsWrap: JSON.stringify(round(wrapRect)) === JSON.stringify(round(artRect)),
        wrapT: getComputedStyle(wrap).transform,
        /* 相对真眼睛的偏差：dx/dy 越接近 0 越贴合；wr/hr 是尺寸比 */
        patchL: rel(res.patch[0], res.truthL),
        patchR: rel(res.patch[1], res.truthR),
        closedL: rel(res.closed[0], res.truthL),
        closedR: rel(res.closed[1], res.truthR),
        happyL: rel(res.happy[0], res.truthL),
        happyR: rel(res.happy[1], res.truthR),
        /* ^^ 弧有没有顶出眼睛上沿 / ‿ 有没有沉出下沿（正数=溢出，单位 CSS px） */
        /* 补丁在页面坐标系里的矩形，供 facediff.js 裁 second 比对 */
        patchLRect: round(res.patch[0]),
        patchRRect: round(res.patch[1]),
        happyTopOut: +(res.truthL.y - res.happy[0].y).toFixed(2),
        happyTopOutR: +(res.truthR.y - res.happy[1].y).toFixed(2),
        closedBottomOut: +((res.closed[0].y + res.closed[0].h) - (res.truthL.y + res.truthL.h)).toFixed(2)
      };
    }, TRUTH);
    out.steps.push({ state: s, ...m });

    /* 脸部大图：开 / 关两张，同一位置同一相位 */
    const box = await page.evaluate(() => {
      const b = document.getElementById('pet').getBoundingClientRect();
      return { x: Math.round(b.x + 20), y: Math.round(b.y + 58), width: 80, height: 62 };
    });
    const dir = path.join(ROOT, '_shots');
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `fx-${s}.png`), clip: box, captureBeyondViewport: false });
    await page.evaluate(() => {
      const st = document.createElement('style');
      st.id = 'fxoff';
      st.textContent = '.fx-eye,.fx-mouth{opacity:0!important}';
      document.head.appendChild(st);
    });
    await new Promise(r => setTimeout(r, 120));
    await page.screenshot({ path: path.join(dir, `fx-${s}-off.png`), clip: box, captureBeyondViewport: false });
    await page.evaluate(() => { const n = document.getElementById('fxoff'); if (n) n.remove(); });
  }

  /* ---------- 一张「圈眼睛」的对照图：把真眼睛椭圆描边画出来，肉眼确认贴没贴准 ---------- */
  const patchScale = await page.evaluate(() => Pet.faceSpec.patch);
  const truthShot = await page.evaluate(t => {
    const petEl = document.getElementById('pet');
    petEl.className = 'pet';
    const face = document.querySelector('.pet__face');
    const NS = 'http://www.w3.org/2000/svg';
    ['L', 'R'].forEach(k => {
      const e = document.createElementNS(NS, 'ellipse');
      e.setAttribute('cx', (t[k].cx * 120 / 714).toFixed(2));
      e.setAttribute('cy', (t[k].cy * 239 / 1423).toFixed(2));
      e.setAttribute('rx', (t[k].rx * 120 / 714).toFixed(2));
      e.setAttribute('ry', (t[k].ry * 239 / 1423).toFixed(2));
      e.setAttribute('fill', 'none');
      e.setAttribute('stroke', '#00ff88');
      e.setAttribute('stroke-width', '0.4');
      face.appendChild(e);
    });
    const b = petEl.getBoundingClientRect();
    return { x: Math.round(b.x + 20), y: Math.round(b.y + 58), width: 80, height: 62 };
  }, TRUTH);
  await new Promise(r => setTimeout(r, 200));
  await page.screenshot({ path: path.join(ROOT, '_shots', 'fx-truth.png'), clip: truthShot, captureBeyondViewport: false });

  fs.writeFileSync(path.join(ROOT, '_shots', 'fx-geom.json'), JSON.stringify({
    truth: TRUTH, patchScale: patchScale, clip: { x: truthShot.x, y: truthShot.y, w: truthShot.width, h: truthShot.height }, dsf: 5, steps: out.steps
  }, null, 1));

  /* ---------- 汇总 ---------- */
  const summarize = ['sleeping', 'happy', 'eating'].map(k => {
    const s = out.steps.find(x => x.state === k);
    return `[${k}] patch±(${(Math.abs(s.patchL.dx) + Math.abs(s.patchR.dx)).toFixed(2)},${(Math.abs(s.patchL.dy) + Math.abs(s.patchR.dy)).toFixed(2)}) size ${s.patchL.wr}/${s.patchL.hr}`
      + ` | happy±(${(Math.abs(s.happyL.dx) + Math.abs(s.happyR.dx)).toFixed(2)},${(Math.abs(s.happyL.dy) + Math.abs(s.happyR.dy)).toFixed(2)}) topOut ${s.happyTopOut}/${s.happyTopOutR}`
      + ` | closed±(${(Math.abs(s.closedL.dx) + Math.abs(s.closedR.dx)).toFixed(2)},${(Math.abs(s.closedL.dy) + Math.abs(s.closedR.dy)).toFixed(2)}) botOut ${s.closedBottomOut}`;
  });
  const syncFails = out.steps.filter(s => !s.sameBox || !s.artFillsWrap).map(s => s.state);
  console.log(JSON.stringify({ truth: TRUTH, steps: out.steps, errors }, null, 1));
  console.log('\n--- 摘要 ---');
  summarize.forEach(l => console.log(l));
  console.log('同步失败的状态：', syncFails.length ? syncFails.join(',') : '无');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
