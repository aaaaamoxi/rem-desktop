/* ============ tools/selftest.js — 桌面版端到端自检 ============
   只在 `npm run selftest` 时被 electron/main.js require 一次。
   验证那些"截图看不出来"的东西：
     - 渲染层真的拿到了 ?debug=1（否则调试面板不会出现）
     - 调试面板的按钮真的能点（点「+3 天」，饥饿值要变）
     - 「重置全部」真的把存档清了（网页版以前因为 beforeunload 写回，其实是坏的）
   ================================================================ */
module.exports = async function selftest(win, ctx) {
  const fs = require('fs');
  const path = require('path');

  const out = { errors: [] };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* 挑一个真实快捷方式来测日志（要能读出 .lnk 的目标才有"应用"这一栏）。
     **只复制，不动用户原件** —— 测试吃的是副本。 */
  let logProbe = { path: '', name: '', dir: ctx.userDesktop || '' };
  try {
    const files = fs.readdirSync(logProbe.dir);
    /* 优先挑"微信"这种指向明确的应用，别挑到安装器之类的怪东西 */
    const lnks = files.filter(f => /\.lnk$/i.test(f));
    const lnk = lnks.find(f => /微信|wechat/i.test(f)) || lnks[0];
    if (lnk) {
      const probeDir = path.join(path.dirname(process.env.PET_FOOD_DIR || path.dirname(ctx.STATE_FILE())),
        'desktop-pet-selftest-probe');
      fs.rmSync(probeDir, { recursive: true, force: true });
      fs.mkdirSync(probeDir, { recursive: true });
      const copy = path.join(probeDir, lnk);
      fs.copyFileSync(path.join(logProbe.dir, lnk), copy);
      logProbe.name = lnk;
      logProbe.path = copy;
    }
  } catch (e) { /* 桌面读不到就跳过这项 */ }
  out.logProbe = logProbe;

  try {
    /* ---- 0. 桌面版的浮层都摆在哪儿 ----
       网页版 stage 撑满窗口，浮层 absolute 定位没问题；
       桌面版 .desktop 被隐藏，stage 会不会塌缩就得看实测。 */
    out.layout = await win.webContents.executeJavaScript(`(() => {
      const r = el => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
      const q = s => document.querySelector(s);
      return {
        win: { w: innerWidth, h: innerHeight },
        stage: r(q('#stage')),
        body: { w: Math.round(document.body.getBoundingClientRect().width), h: Math.round(document.body.getBoundingClientRect().height) },
        mask: r(q('#modalMask')),
        debugPanel: r(q('#debugPanel'))
      };
    })()`);

    /* ---- 1. 渲染层状态 + 点一次「+3 天」 ---- */
    const r = await win.webContents.executeJavaScript(`(() => {
      const out = {};
      out.search = location.search;
      const panel = document.getElementById('debugPanel');
      out.panelVisible = !!(panel && !panel.hidden);
      out.platform = Pet.bridge.platform;
      out.hasResetState = typeof Pet.bridge.resetState === 'function';
      out.hasPauseSave = typeof Pet.hunger.pauseSave === 'function';

      const btns = Array.from(document.querySelectorAll('#debugPanel .debug__btn'));
      const b3 = btns.find(b => b.textContent.indexOf('3 天') >= 0);
      out.foundBtn = !!b3;
      out.hungerBefore = Pet.state.hunger;
      if (b3) b3.click();
      out.hungerAfter = Pet.state.hunger;
      out.btns = btns.map(b => b.textContent);
      return out;
    })()`);
    out.renderer = r;

    /* ---- 2. 「重置全部」：点了要真的清档 ---- */
    /* 先往存档里塞点东西，方便确认被清掉了。
       注意：重置完页面会 reload，应用会立刻写回一份全新的初始存档，
       所以判据不是"文件没了"，而是"存档回到初始值"——
       如果 beforeunload 把旧存档写回来了，这里会是 999。 */
    const startHunger = await win.webContents.executeJavaScript('Pet.config.hunger.start');
    try {
      fs.mkdirSync(path.dirname(ctx.STATE_FILE()), { recursive: true });
      fs.writeFileSync(ctx.STATE_FILE(), JSON.stringify({ probe: true, hunger: 999, eaten: ['x'] }), 'utf8');
    } catch (e) { /* 写不进去就跳过这一步 */ }

    await win.webContents.executeJavaScript(`(() => {
      const b = Array.from(document.querySelectorAll('#debugPanel .debug__btn'))
        .find(x => x.textContent.indexOf('重置') >= 0);
      if (b) b.click();
      return !!b;
    })()`);

    /* 等页面 reload 完（重置完会 w.location.reload()） */
    await sleep(3000);
    out.startHunger = startHunger;
    out.afterReset = null;
    try {
      const st = JSON.parse(fs.readFileSync(ctx.STATE_FILE(), 'utf8'));
      out.afterReset = { hunger: st.hunger, eaten: (st.eaten || []).length };
    } catch (e) { /* 没文件 = 清掉了（更理想，但不强制） */ }

    /* ---- 3. 重新加载后调试面板还在吗 ----
       托盘「重新加载」走的是 win.webContents.reload()，URL 里的 ?debug=1
       必须留着，否则改完参数一点就没了面板。 */
    out.afterReload = await win.webContents.executeJavaScript(`({
      search: location.search,
      panelVisible: !!(document.getElementById('debugPanel') && !document.getElementById('debugPanel').hidden)
    })`);

    /* ---- 4. 弹窗的按钮能不能点 ----
       桌面版窗口常态是穿透的，只有"上报成可接鼠标区域"的地方收得到点击。
       弹窗以前漏报了，所以「关闭」按钮点不动 —— 这里验证它已经进了 hitRects。 */
    await win.webContents.executeJavaScript('Pet.app.showStats()');
    await sleep(500);
    const modalState = await win.webContents.executeJavaScript(`(() => {
      const mask = document.getElementById('modalMask');
      const box = document.getElementById('modalBox');
      const btn = box && box.querySelector('.modal__acts .btn');
      const br = box ? box.getBoundingClientRect() : null;
      return {
        open: !!(mask && !mask.hidden),
        hasBtn: !!btn,
        btnText: btn ? btn.textContent : '',
        box: br ? { x: br.left, y: br.top, w: br.width, h: br.height } : null
      };
    })()`);
    out.modal = modalState;
    /* 截一张带弹窗的桌面图，肉眼确认位置和样子 */
    try {
      const img = await win.webContents.capturePage();
      const fsx = require('fs');
      const dir = path.join(ctx.ROOT, '_shots');
      fsx.mkdirSync(dir, { recursive: true });
      fsx.writeFileSync(path.join(dir, 'electron-modal.png'), img.toPNG());
    } catch (e) { /* 截图失败不影响判定 */ }
    /* 主进程收到的可点区域里，得有一个覆盖弹窗盒子的 */
    const rects = (ctx.getHitRects && ctx.getHitRects()) || [];
    out.modalInHitRects = !!(modalState.box && rects.some(r =>
      r.x <= modalState.box.x && r.y <= modalState.box.y &&
      r.x + r.w >= modalState.box.x + modalState.box.w &&
      r.y + r.h >= modalState.box.y + modalState.box.h));
    out.hitRectsCount = rects.length;

    /* 关掉弹窗，别影响后面的状态 */
    await win.webContents.executeJavaScript(`(() => {
      const b = document.querySelector('#modalBox .modal__acts .btn');
      if (b) b.click();
    })()`);
    await sleep(300);
    out.modalClosed = await win.webContents.executeJavaScript(`document.getElementById('modalMask').hidden`);

    /* ---- 5. 吃货日志：真吃一个 .lnk（副本），看日志写没写、应用名解出来没有 ----
       桌面版的日志由主进程记，所以必须走 bridge.eatIcon（渲染层的 hunger.eat 不记） */
    const logTest = await win.webContents.executeJavaScript(`(async () => {
      const item = {
        id: ${JSON.stringify(logProbe.path)},
        label: ${JSON.stringify(logProbe.name)},
        glyph: 'link', kind: 'lnk', shortcut: true,
        dir: ${JSON.stringify(path.dirname(logProbe.path))},
        fileName: ${JSON.stringify(logProbe.name)},
        pos: { x: 0, y: 0 }
      };
      await Pet.bridge.eatIcon(item);
      await new Promise(r => setTimeout(r, 500));
      return await Pet.bridge.logRead(200);
    })()`).catch(() => []);
    out.log = { probe: logProbe, lines: (logTest || []).slice(0, 3) };
    /* 日志里**有一条**记着这个文件就行 —— 不能要求它是最新的那条，
       自检期间还写了别的记录（吃掉测试文件、吐回…） */
    out.logOk = !!(logTest && logTest.some(l =>
      l.indexOf(logProbe.name) >= 0 && /应用：/.test(l) && /来自 /.test(l)));
    /* 「应用」那栏应该解析出快捷方式真正指向的程序，而不是文件名本身 */
    const appLine = (logTest || []).find(l => l.indexOf(logProbe.name) >= 0 && /应用：/.test(l)) || '';
    const appM = appLine.match(/应用：([^|]+)/);
    out.logAppParsed = !!(appM && appM[1].trim() &&
      appM[1].trim() !== logProbe.name.replace(/\.[^.]+$/, ''));
    out.logApp = appM ? appM[1].trim() : '';

    /* ---- 6. 面板能拖 / 能接住拖进来的文件 / 「吃掉的食物」里的东西她不吃 ---- */
    out.features = await win.webContents.executeJavaScript(`(async () => {
      const r = {};
      const foodDir = ${JSON.stringify(process.env.PET_FOOD_DIR || '')};

      /* (1) 「吃掉的食物」里的东西不该出现在图标列表里，也不该被 nearest 选中 */
      const all = Pet.allIcons || [];
      r.totalIcons = all.length;
      const inside = all.filter(x => x.id.indexOf(foodDir + '\\\\') === 0 || x.dir === foodDir);
      r.insideCount = inside.length;
      r.insideIds = inside.map(x => x.id);
      const near = Pet.icons.nearest({ x: 0, y: 0 });
      r.nearestId = near && near.item ? near.item.id : '';
      r.nearestInFood = !!(near && near.item && near.item.id.indexOf(foodDir + '\\\\') === 0);
      /* locker 概念应该彻底没了 */
      r.hasLockerFlag = all.some(x => x.locker === true);

      /* (2) 调试面板能拖 */
      const panel = document.getElementById('debugPanel');
      const hd = panel && panel.querySelector('.debug__hd');
      if (hd) {
        /* 先摆到一个确定的位置：上次拖动留下的位置可能正好在视口边缘，
           再往那个方向拖会被 clamp 住，看起来就像"没拖动" */
        panel.style.left = '100px';
        panel.style.top = '100px';
        panel.style.bottom = 'auto';
        const b0 = panel.getBoundingClientRect();
        const before = { x: panel.offsetLeft, y: panel.offsetTop };
        const ev = (type, cx, cy) => hd.dispatchEvent(new PointerEvent(type, {
          clientX: cx, clientY: cy, button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 1
        }));
        ev('pointerdown', b0.left + 20, b0.top + 6);
        ev('pointermove', b0.left + 120, b0.top + 70);
        ev('pointerup', b0.left + 120, b0.top + 70);
        const after = { x: panel.offsetLeft, y: panel.offsetTop };
        r.dragMoved = (after.x !== before.x) || (after.y !== before.y);
        r.dragSaved = !!localStorage.getItem('pet.debug.pos');
        r.dragStyle = { left: panel.style.left, top: panel.style.top, before, after,
                        hasClamp: typeof Pet.util.clamp === 'function' };
      }

      /* (3) 拖放：dragover 要被 preventDefault（不然浏览器不让放） */
      const body = document.getElementById('petBody');
      const dt = new DataTransfer();
      const ov = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true });
      body.dispatchEvent(ov);
      r.dragoverPrevented = ov.defaultPrevented;
      r.dropClass = document.getElementById('pet').classList.contains('is-drop-ready');

      return r;
    })()`);

    /* ---- 7. 桌面文件：吃 → 进仓库；吐回 → 回原处，名字不能变 ----
       用一个假的"桌面"目录当试验田，绝不碰用户真实桌面。 */
    const foodDir = process.env.PET_FOOD_DIR || '';
    const tmpRoot = foodDir ? path.dirname(foodDir) : '';
    /* 假桌面 = listIcons 真正会扫的那个目录（PET_DESKTOP_DIR） */
    const fakeDesk = process.env.PET_DESKTOP_DIR
      || (foodDir ? path.join(tmpRoot, 'desktop-pet-selftest-desk') : '');
    if (foodDir && fakeDesk) {
      try { fs.rmSync(fakeDesk, { recursive: true, force: true }); fs.mkdirSync(fakeDesk, { recursive: true }); } catch (e) { /* 忽略 */ }

      const origName = '测试文件.txt';
      const src = path.join(fakeDesk, origName);
      fs.writeFileSync(src, 'x', 'utf8');
      /* 假桌面上也放一个「吃掉的食物」文件夹，模拟真实布局（它不该被当成图标） */
      try { fs.mkdirSync(path.join(fakeDesk, '吃掉的食物'), { recursive: true }); } catch (e) { /* 忽略 */ }

      /* 清场：只留主进程预置的那个存货（她不该吃的东西），其余删掉 */
      try {
        for (const f of fs.readdirSync(foodDir)) {
          if (f === 'manifest.json') continue;
          if (f === '1234_测试图标.txt') continue;
          fs.unlinkSync(path.join(foodDir, f));
        }
      } catch (e) { /* 清理失败就照常跑 */ }

      const eatRes = await win.webContents.executeJavaScript(`(async () => {
        return await Pet.bridge.eatIcon({
          id: ${JSON.stringify(src)}, label: '测试文件', glyph: 'txt',
          shortcut: false, fileName: ${JSON.stringify(origName)}, dir: ${JSON.stringify(fakeDesk)}
        });
      })()`);

      const inFood = fs.readdirSync(foodDir).filter(f => f !== 'manifest.json' && f.indexOf('测试文件') >= 0);
      let manifestEntry = null;
      try {
        const mf = path.join(foodDir, 'manifest.json');
        const arr = JSON.parse(fs.readFileSync(mf, 'utf8'));
        manifestEntry = arr.find(m => (m.stored || '').indexOf('测试文件') >= 0) || null;
      } catch (e) { /* 忽略 */ }

      const deskList0 = fs.existsSync(fakeDesk) ? fs.readdirSync(fakeDesk) : [];

      /* 弹窗 DOM：此时账上还有这一条，列表里应该有行、按钮是「吐回来」 */
      await win.webContents.executeJavaScript('Pet.app.syncLocker()');
      await win.webContents.executeJavaScript('Pet.app.openLocker()');
      await new Promise(r => setTimeout(r, 300));
      out.lockerDom = await win.webContents.executeJavaScript(`({
        rows: document.querySelectorAll('#modalBox .locker__row').length,
        digestedRows: document.querySelectorAll('#modalBox .locker__row.is-digested').length,
        tag: (document.querySelector('#modalBox .locker__tag') || {}).textContent,
        btn: (document.querySelector('#modalBox .locker__row .btn') || {}).textContent,
        groups: document.querySelectorAll('#modalBox .locker__group').length
      })`);
      await win.webContents.executeJavaScript('document.getElementById("modalMask").hidden = true');

      /* 吐回去 */
      const retRes = await win.webContents.executeJavaScript(`(async () => {
        return await Pet.bridge.returnIcon({
          id: ${JSON.stringify(src)}, label: '测试文件', glyph: 'txt',
          shortcut: false, fileName: ${JSON.stringify(origName)}, dir: ${JSON.stringify(fakeDesk)}
        });
      })()`);

      const deskList = fs.existsSync(fakeDesk) ? fs.readdirSync(fakeDesk) : [];
      out.roundTrip = {
        eaten: !!(eatRes && eatRes.ok),
        eatRes,
        inFood,
        /* 落点必须在「吃掉的食物」里，且带时间戳前缀 */
        intoFood: inFood.length === 1 && /^\d+_测试文件\.txt$/.test(inFood[0]),
        storedInFoodDir: !!(manifestEntry && path.resolve(manifestEntry.stored)
          .startsWith(path.resolve(foodDir) + path.sep)),
        /* 账本必须记着"原始位置" —— 吐回靠它 */
        manifestOk: !!(manifestEntry && manifestEntry.dir === fakeDesk &&
          manifestEntry.fileName === origName && manifestEntry.id === src),
        manifestEntry,
        returned: !!(retRes && retRes.ok),
        retRes,
        fakeDeskList: deskList,
        backHome: fs.existsSync(src),
        /* 名字不变：回到原处，文件名还是「测试文件.txt」，不能变成 (2) */
        sameName: deskList.indexOf(origName) >= 0,
        /* 吐回后「吃掉的食物」里不该剩这个文件（不能变成副本留在原地） */
        foodCleaned: fs.readdirSync(foodDir).filter(f => f.indexOf('测试文件') >= 0).length === 0
      };
    }

    /* ---- 8. 「吃掉的食物」里的东西她不吃 ----
       手动拖给她要被拒绝，文件还在原地，也不该进账本。 */
    const logPath = path.join(path.dirname(ctx.STATE_FILE()), '吃货日志.txt');
    const insideFile = foodDir ? path.join(foodDir, '1234_测试图标.txt') : '';
    let refuse = null;

    if (insideFile) {
      const rejRes = await win.webContents.executeJavaScript(`(async () => {
        return await Pet.bridge.eatIcon({
          id: ${JSON.stringify(insideFile)}, label: '测试图标', glyph: 'txt', shortcut: false,
          fileName: '1234_测试图标.txt', dir: ${JSON.stringify(foodDir)}
        });
      })()`).catch(() => null);

      let manifestIds = [];
      try {
        const mf = path.join(foodDir, 'manifest.json');
        manifestIds = JSON.parse(fs.readFileSync(mf, 'utf8')).map(m => m.id);
      } catch (e) { /* 忽略 */ }

      refuse = {
        rejected: !!(rejRes && rejRes.ok === false),
        code: rejRes && rejRes.code,
        msg: rejRes && rejRes.msg,
        stillInFood: fs.existsSync(insideFile),   /* 必须在原地，不能被搬走 */
        notInLedger: !manifestIds.some(id => id.indexOf('测试图标') >= 0)
      };
    }
    out.refuse = refuse;

    /* 日志：吃了、吐回了、失败原因，都得写进去（没有「消化」「拿回来」了） */
    try {
      const txt = fs.readFileSync(logPath, 'utf8');
      const lines = txt.trim().split('\n').filter(Boolean);
      out.logTail = lines.slice(-6);
      out.logHasEat = /\| 吃掉 \|/.test(txt);
      out.logHasFail = /\| (吃不下|还不了) \|/.test(txt);
      out.logHasReturn = /\| 吐回 \|/.test(txt);
      /* 旧功能已经删了，日志里不该再有这两种动作 */
      out.logNoDigest = !/\| 消化 \|/.test(txt);
      out.logNoTakeBack = !/\| 拿回来 \|/.test(txt);
    } catch (e) {
      out.logHasEat = out.logHasFail = out.logHasReturn = false;
      out.logNoDigest = out.logNoTakeBack = true;
      out.logTail = [];
    }

    /* 账本一致性：渲染层的每一条都要能在主进程账本里找到（防僵尸条目）
       先 syncLocker 重新投影 —— 上面是直接调 bridge.returnIcon 的，
       渲染层的 st.eaten 没跟着主进程一起变。 */
    try {
      await win.webContents.executeJavaScript('Pet.app.syncLocker()');
      const mf = path.join(foodDir || '', 'manifest.json');
      const ids = JSON.parse(fs.readFileSync(mf, 'utf8')).map(m => m.id);
      const stEaten = await win.webContents.executeJavaScript(
        '(Pet.state.eaten || []).map(e => e.id)');
      out.ledgerOk = stEaten.every(id => ids.indexOf(id) >= 0);
    } catch (e) {
      out.ledgerOk = false;
    }

    const h = out.renderer;
    const resetOk = out.afterReset
      ? (out.afterReset.hunger === startHunger && out.afterReset.eaten === 0)
      : true;
    const reloadOk = out.afterReload && out.afterReload.panelVisible &&
      /debug=1/.test(out.afterReload.search || '');
    const rt = out.roundTrip || {};
    const fd = out.features || {};
    const rf = out.refuse || {};
    const dom = out.lockerDom || {};
    out.pass = !!(h && h.panelVisible && h.foundBtn && h.hungerAfter > h.hungerBefore &&
      resetOk && reloadOk && out.modalInHitRects && out.modalClosed &&
      (!logProbe.name || out.logOk) &&
      fd.insideCount === 0 && !fd.nearestInFood && !fd.hasLockerFlag &&
      fd.dragMoved && fd.dragoverPrevented &&
      rt.eaten && rt.intoFood && rt.storedInFoodDir && rt.manifestOk &&
      rt.returned && rt.backHome && rt.sameName && rt.foodCleaned &&
      rf.rejected && rf.code === 'IN_FOOD' && rf.stillInFood && rf.notInLedger &&
      dom.digestedRows === 0 && !dom.tag && dom.btn === '吐回来' && dom.groups === 0 &&
      out.logHasEat && out.logHasReturn && out.logNoDigest && out.logNoTakeBack &&
      out.ledgerOk &&
      !out.errors.length);
  } catch (e) {
    out.errors.push(String((e && e.message) || e));
  }

  console.log('[selftest] ' + JSON.stringify(out, null, 1));
  return out;
};
