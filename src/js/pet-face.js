/* ============ pet-face.js — 位图立绘上的表情叠加层 ============
   位图没法单独眨眼睛，所以在她的眼睛和嘴上贴一层极小的 SVG：
   先铺一块肤色补丁盖住"睁着的眼睛"，再画闭眼弧 / ^^ 弧 / 张嘴。

   坐标由 tools/face-calib.js 逐像素扫出来的（沿眼睛做逐行的横向范围扫描）：
     左眼 x 229..303（中点 266）  y 453..554（中点 502） → 半轴 (38, 51)
     右眼 x 449..515（中点 482）  y 457..556（中点 506） → 半轴 (34, 49)
   眼睛上半截是极暗的眼线（luma 26），下半截是一块亮到 luma 212 的浅粉反光，
   只按"暗且有色的连通域"去抓会把下半截整块漏掉 —— 补丁短一截就是这么来的。

   补丁尺寸、弧的宽深，都从「真实眼睛半轴」派生（patch / closed / happy 三个系数）。
   以前补丁和弧共用一套半轴，改补丁大小会连带改掉弧的深度，越调越歪 —— 现在解耦了。

   覆盖率的验收不靠肉眼（几次结论互相打架），靠 tools/facediff.js 数像素：
   在真眼睛范围内统计"原来是眼睛、补丁盖上后仍是眼睛色"的残留，目前 1.6% / 3.3%。

   注意：这张立绘是 3/4 侧脸，左右眼大小差不少，所以两只眼睛各写各的。
   雷姆是同一张图改色，坐标系一致，共用一套 —— 这不是假设，是量过的：
   assets/ram.png 与 assets/rem.png 的 alpha 通道 156240 个像素逐像素相同，
   连形状轮廓都没动过（tools/face-calib.js 的几何一致性检查）。
   ================================================================ */
(function (w) {
  const Pet = w.Pet;

  const SPEC = {
    srcW: 714,
    srcH: 1423,
    eyeL: { x: 266, y: 502, rx: 38, ry: 51 },
    eyeR: { x: 482, y: 506, rx: 34, ry: 49 },
    /* 嘴：立绘压根没画出嘴（鼻以下到下巴 y620~665 全是纯皮肤，
       y668 以下那片暗的是下颌线和衣服）。所以这一层是"凭空给她开个口"，
       放在眼睛下方约 1/5 头长处看着最自然，不要试图去对齐某个暗块。 */
    mouth: { x: 385, y: 628, rx: 26, ry: 20 },
    /* 补丁 = 真实眼睛 × 这个值。1.12 = 刚好盖住还留一圈边。别调大：
       左眼 230 之外紧接着就是鬓角的暗色头发，补丁外扩过头会啃掉头发 */
    patch: 1.12,
    /* 闭眼弧 ‿：宽 = 真实眼宽 × 0.88，向下鼓 = 真实眼高一半 × 0.40 */
    closed: { w: 0.88, deep: 0.40 },
    /* 开心眼 ^^：宽度同上，向上鼓 0.52。
       原来这套数是按补丁的半轴(50)算的，0.7 × 50 = 5.88 屏幕px，
       比眼睛半高 6.05 还大，弧顶直接顶穿上眼睑；现在按真实 ry 算只剩 3.1px */
    happy: { w: 0.88, rise: 0.52 }
  };

  Pet.faceSpec = SPEC;

  /**
   * 生成表情层 SVG（1 单位 = 1 盒子像素）
   * @param {number} w2 盒子宽
   * @param {number} h2 盒子高
   */
  Pet.faceSvg = function (w2, h2) {
    const sx = w2 / SPEC.srcW;
    const sy = h2 / SPEC.srcH;
    const map = k => ({
      cx: +(SPEC[k].x * sx).toFixed(2),
      cy: +(SPEC[k].y * sy).toFixed(2),
      rx: +(SPEC[k].rx * sx).toFixed(2),
      ry: +(SPEC[k].ry * sy).toFixed(2)
    });
    const L = map('eyeL');
    const R = map('eyeR');
    const M = map('mouth');

    /* 补丁不能用椭圆：眼睛的睫毛线横向比"同高度的椭圆宽度"宽不少，
       椭圆贴上去，眼睛顶上总会露一条。超椭圆（n 越大越接近矩形）能贴住。
       n=3 刚好：够方，又不会方到啃旁边的头发。 */
    const superPatch = (cx, cy, rx, ry, n) => {
      const steps = 40;
      let d = '';
      for (let i = 0; i <= steps; i++) {
        const t = i / steps * Math.PI * 2;
        const ct = Math.cos(t), st = Math.sin(t);
        const e = 2 / n;
        const x = rx * Math.sign(ct) * Math.pow(Math.abs(ct), e);
        const y = ry * Math.sign(st) * Math.pow(Math.abs(st), e);
        d += (i ? 'L' : 'M') + (cx + x).toFixed(2) + ',' + (cy + y).toFixed(2);
      }
      return d + 'Z';
    }; 

    const eye = o => {
      const prx = +(o.rx * SPEC.patch).toFixed(2);
      const pry = +(o.ry * SPEC.patch).toFixed(2);
      const chw = +(o.rx * SPEC.closed.w).toFixed(2);
      const hhw = +(o.rx * SPEC.happy.w).toFixed(2);
      const cdeep = +(o.ry * SPEC.closed.deep).toFixed(2);
      const hrise = +(o.ry * SPEC.happy.rise).toFixed(2);
      return `
      <g class="fx-eye">
        <path class="fx-patch" d="${superPatch(o.cx, o.cy, prx, pry, 3)}"/>
        <path class="fx-lid fx-closed" d="M${(o.cx - chw).toFixed(2)},${o.cy} Q${o.cx},${(o.cy + cdeep).toFixed(2)} ${(o.cx + chw).toFixed(2)},${o.cy}"/>
        <path class="fx-lid fx-happy" d="M${(o.cx - hhw).toFixed(2)},${o.cy} Q${o.cx},${(o.cy - hrise).toFixed(2)} ${(o.cx + hhw).toFixed(2)},${o.cy}"/>
      </g>`;
    };

    return `<svg class="pet__face" viewBox="0 0 ${w2} ${h2}" preserveAspectRatio="none" aria-hidden="true">
      ${eye(L)}
      ${eye(R)}
      <g class="fx-mouth">
        <ellipse class="fx-patch" cx="${M.cx}" cy="${M.cy}" rx="${M.rx}" ry="${M.ry}"/>
        <ellipse class="fx-open" cx="${M.cx}" cy="${M.cy}" rx="${(M.rx * 0.56).toFixed(2)}" ry="${(M.ry * 0.70).toFixed(2)}"/>
      </g>
    </svg>`;
  };
})(window);
