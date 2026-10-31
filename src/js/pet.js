/* ============ pet.js — 角色控制器 ============
   唯一写 #pet 的 transform 的地方（位移 + 朝向）
   ============================================ */
(function (w) {
  const Pet = w.Pet;
  const U = Pet.util;
  const C = Pet.config;

  /* 尺寸跟着形象走，所以不能是常量 */
  let W = C.size.w;
  let H = C.size.h;
  let charId = C.char || 'ram';
  let ch = (Pet.chars && Pet.chars[charId]) || null;
  let mouthY = 0.45;
  let mouthX = 0.5;

  let el, bodyEl, tiltEl, shadowEl, fxEl;
  let artEl = null;            /* 位图立绘 <img> */
  let wrapEl = null;           /* 立绘 + 表情层的公共容器，姿态变换作用在它身上 */
  let faceW = 0, faceH = 0;    /* 表情层是按盒子尺寸生成的，尺寸变了要重建 */

  let px = 0, py = 0;          /* 左上角坐标 */
  let groundY = 0;
  let dir = 1;
  let targetX = null;
  let mode = 'idle';           /* idle | seek */
  let seekTarget = null;

  let dragging = false;
  let dragMoved = false;
  let dragOffset = { x: 0, y: 0 };
  let lastPointer = { x: 0, t: 0 };

  let planTimer = null;
  let sleepTimer = null;
  let lastIdleSay = 0;
  let lastHungrySay = 0;
  let lastArriveAt = 0;
  let pokeTimes = [];
  let lastPokeShake = 0;
  let eatCooldownUntil = 0;
  let eatLog = [];

  let speaking = false;
  let rafId = 0;
  let lastTs = 0;

  /* ---------------- 坐标 ---------------- */
  function bounds() {
    const s = Pet.bridge ? Pet.bridge.screen() : { w: w.innerWidth, h: w.innerHeight, taskbar: 44 };
    return {
      maxX: s.w - W - 8,
      minX: 8,
      /* 把"她的底"放到任务栏上沿：盒子底边 - 盒内空白 + 悬空高度 */
      ground: s.h - (s.taskbar || 44) - H + (ch ? ch.gap : 13) - (ch ? ch.float : 0)
    };
  }

  function render() {
    if (!el) return;
    const b = bounds();
    groundY = b.ground;
    el.style.setProperty('--dir', dir >= 0 ? 1 : -1);
    el.style.transform = `translate3d(${Math.round(px)}px, ${Math.round(py)}px, 0) scaleX(${dir >= 0 ? 1 : -1})`;
  }

  function rect() {
    return { x: px, y: py, w: W, h: H, cx: px + W / 2, cy: py + H / 2 };
  }

  function mouth() {
    /* 嘴位按形象的比例算，投喂和气泡才不会歪 */
    return { x: px + W * mouthX, y: py + H * mouthY };
  }

  /* ---------------- 表情：闪一下某个 class ---------------- */
  const flashT = {};
  function flash(cls, ms) {
    if (!el) return;
    el.classList.add(cls);
    clearTimeout(flashT[cls]);
    flashT[cls] = setTimeout(() => el.classList.remove(cls), ms);
  }

  /* 位图不会自己眨眼，只能定时贴一层闭眼弧 */
  let blinkTimer = null;
  function scheduleBlink() {
    clearTimeout(blinkTimer);
    blinkTimer = setTimeout(() => {
      const st = Pet.fsm.state;
      if (st !== 'DEAD' && st !== 'EATING' && st !== 'HELD' &&
          st !== 'SLEEP' && st !== 'DISTURBED' && st !== 'REVIVE') {
        flash('is-blink', 130);
      }
      scheduleBlink();
    }, U.rand(2600, 5600));
  }

  /* ---------------- 说 ---------------- */
  function say(text, opts) {
    if (!text) return;
    Pet.bubble.say(text, opts);
  }

  function sayPool(key, opts) {
    const arr = C.lines[key];
    if (!arr || !arr.length) return;
    say(U.pickFresh(arr, Pet.recentLines), opts);
  }

  /* ---------------- 行走 ---------------- */
  function walkTo(tx, purpose) {
    const b = bounds();
    targetX = U.clamp(tx, b.minX, b.maxX);
    mode = purpose || 'idle';
    if (Math.abs(targetX - px) < 3) {
      targetX = null;
      onArrive();
      return;
    }
    setStepDur();
    Pet.fsm.set('WALK', { reason: purpose });
  }

  function setStepDur() {
    if (!el) return;
    const dur = C.move.stepLen / C.move.speed;
    bodyEl.style.setProperty('--step-dur', dur.toFixed(2) + 's');
  }

  function walkRandom() {
    const b = bounds();
    const span = U.rand(80, 260) * (Math.random() < 0.5 ? -1 : 1);
    let tx = px + span;
    if (tx < b.minX + 20 || tx > b.maxX - 20) tx = px - span;
    walkTo(tx, 'idle');
  }

  function onArrive() {
    lastArriveAt = Date.now();
    if (mode === 'seek' && seekTarget) {
      const t = seekTarget;
      seekTarget = null;
      mode = 'idle';
      startEating(t);
      return;
    }
    mode = 'idle';
    Pet.fsm.set('IDLE', { reason: 'arrive' });
    scheduleNext(U.rand(C.move.idleMinMs, C.move.idleMaxMs));
  }

  function scheduleNext(delay) {
    clearTimeout(planTimer);
    planTimer = setTimeout(plan, delay == null ? U.rand(C.move.idleMinMs, C.move.idleMaxMs) : delay);
  }

  /* ---------------- 决策 ---------------- */
  function canEatNow() {
    if (Pet.state.deadAt) return false;
    if (Pet.state.reviveNeed > 0) return true;   /* 复活期间允许吃 */
    if (Date.now() < eatCooldownUntil) return false;
    const cutoff = Date.now() - 3600000;
    eatLog = eatLog.filter(t => t > cutoff);
    if (eatLog.length >= C.eat.perHourLimit) return false;
    return true;
  }

  function plan() {
    if (!Pet.state) return;
    const st = Pet.fsm.state;
    if (st === 'DEAD' || st === 'HELD' || st === 'EATING' || st === 'DISTURBED' || st === 'SLEEP') {
      scheduleNext(1600);
      return;
    }
    if (Pet.bubble.typing) { scheduleNext(900); return; }

    const hungry = Pet.state.hunger >= C.hunger.seekAt;
    if (hungry && canEatNow()) {
      if (startSeek()) return;
      if (Date.now() - lastHungrySay > 40000) {
        sayPool('hungry');
        lastHungrySay = Date.now();
      }
      scheduleNext(U.rand(4000, 7000));
      return;
    }

    const r = Math.random();
    if (r < 0.5) {
      walkRandom();
      scheduleNext(U.rand(C.move.walkMinMs, C.move.walkMaxMs) + 1200);
    } else {
      Pet.fsm.set('IDLE', { reason: 'plan' });
      if (Date.now() - lastIdleSay > 24000 && Math.random() < 0.5) {
        sayPool('idle');
        lastIdleSay = Date.now();
      }
      scheduleNext(U.rand(C.move.idleMinMs, C.move.idleMaxMs));
    }
  }

  /* ---------------- 吃 ---------------- */
  /* 吃完之后收拾一下：
     - 账目以主进程 manifest 为准（修 bug 1 的关键一步）
     - 刷新图标列表：桌面文件进了「吃掉的食物」，列表不刷新的话
       她还会去吃一个已经不存在的东西 */
  async function afterEat(res, item) {
    if (res && res.ok) {
      U.toast(`「${(item && item.label) || '它'}」吃掉了，放进「吃掉的食物」了`, 3200);
    }
    if (Pet.app && Pet.app.syncLocker) await Pet.app.syncLocker();
    setTimeout(async () => {
      try {
        Pet.allIcons = await Pet.bridge.listIcons();
        if (Pet.app && Pet.app.renderDesktop) Pet.app.renderDesktop();
      } catch (e) { /* 刷新失败不影响这次进食 */ }
    }, C.eat.eatLockMs + 300);
  }

  function startSeek() {
    if (!Pet.icons) return false;
    const near = Pet.icons.nearest({ x: px + W / 2, y: py + H * 0.7 });
    if (!near) return false;

    const iconCenterX = near.cx;
    /* 站到图标旁边，不要站在图标上 */
    let tx = iconCenterX + (px > iconCenterX ? 46 : -46 - W + 46);
    tx = iconCenterX < px ? iconCenterX + 52 : iconCenterX - W + 8;
    seekTarget = near.item;
    mode = 'seek';
    walkTo(tx, 'seek');
    return true;
  }

  async function startEating(item) {
    if (!item || item.gone) { Pet.fsm.set('IDLE'); scheduleNext(); return; }
    if (!canEatNow()) {
      sayPool('full');
      Pet.fsm.set('IDLE');
      scheduleNext(5000);
      return;
    }

    /* 真正动手之前先问一下：这个文件到底吃不吃得下 */
    const res = await Pet.bridge.eatIcon(item);
    if (!res || !res.ok) {
      say((res && res.msg) || '这个吃不下');
      Pet.fsm.set('IDLE', { force: true });
      scheduleNext(4000);
      return;
    }
    Pet.fsm.set('EATING', { force: true, reason: 'eat' });
    Pet.fsm.lock(C.eat.eatLockMs);

    /* 面向图标 */
    dir = (item.pos.x + 42) >= (px + W / 2) ? 1 : -1;
    render();

    eatLog.push(Date.now());
    eatCooldownUntil = Date.now() + C.eat.cooldownMs;

    Pet.icons.bite(item);
    Pet.hunger.eat(item);
    await afterEat(res, item);   /* 必须在 hunger.eat 之后：账目才准 */

    setTimeout(() => say(U.pick(C.lines.eat)), 220);

    setTimeout(() => {
      Pet.fsm.set('IDLE', { force: true, reason: 'ate' });
      Pet.fsm.unlock();
      scheduleNext(U.rand(2600, 5200));
    }, C.eat.eatLockMs);
  }

  /** 用户把图标拖到她嘴边 */
  async function feedByHand(item) {
    if (!item) return;
    if (Pet.state.deadAt) {
      Pet.hunger.reviveByFeed(item);
      return;
    }    if (!canEatNow()) {
      sayPool('full');
      if (item.el) {
        item.el.classList.add('is-refused');
        setTimeout(() => item.el && item.el.classList.remove('is-refused'), 340);
      }
      return;
    }

    const res = await Pet.bridge.eatIcon(item);
    if (!res || !res.ok) {
      say((res && res.msg) || '这个吃不下');
      return;
    }
    eatLog.push(Date.now());
    eatCooldownUntil = Date.now() + C.eat.cooldownMs;
    Pet.fsm.set('EATING', { force: true, reason: 'feed' });
    Pet.fsm.lock(C.eat.eatLockMs);
    Pet.icons.bite(item);
    Pet.hunger.eat(item);
    await afterEat(res, item);   /* 必须在 hunger.eat 之后 */
    setTimeout(() => say(U.pick(C.lines.eat)), 200);
    setTimeout(() => {
      Pet.fsm.set('IDLE', { force: true });
      Pet.fsm.unlock();
      scheduleNext(U.rand(2200, 4200));
    }, C.eat.eatLockMs);
  }

  /* ---------------- 戳 / 抖 ---------------- */
  function onPoke() {
    const now = Date.now();
    pokeTimes = pokeTimes.filter(t => now - t < C.poke.windowMs);
    pokeTimes.push(now);

    if (pokeTimes.length >= C.poke.count && now - lastPokeShake > C.poke.cooldownMs) {
      lastPokeShake = now;
      pokeTimes = [];
      disturb();
      return;
    }

    if (Pet.state.deadAt) {
      say('……');
      return;
    }
    if (Pet.fsm.is('SLEEP')) {
      Pet.fsm.set('IDLE', { force: true });
      sayPool('wake');
      flash('is-happy', 1200);
      return;
    }
    if (Math.random() < 0.45) flash('is-happy', 900);
    sayPool('idle', { ms: 1800 });
  }

  function disturb() {
    Pet.fsm.set('DISTURBED', { force: true });
    Pet.fsm.lock(C.poke.disturbMs);
    const stage = U.$('#stage');
    stage.classList.add('is-shaking');
    setTimeout(() => stage.classList.remove('is-shaking'), 460);
    sayPool('disturb', { instant: true, ms: 1500 });
    setTimeout(() => {
      Pet.fsm.set('IDLE', { force: true });
      Pet.fsm.unlock();
      scheduleNext(2400);
    }, C.poke.disturbMs);
  }

  /* ---------------- 拖文件投喂（桌面版） ----------------
     真实桌面上的图标是 Explorer 画的，不在我们能拖的 DOM 里，
     只能靠 HTML5 的拖放事件接住 —— 把文件拖到她身上就投喂。 */
  async function feedByPath(filePath) {
    if (!filePath) return;
    const name = filePath.split(/[\\/]/).pop() || '';
    const dir = filePath.slice(0, Math.max(0, filePath.length - name.length - 1));
    const plain = name.replace(/^\d+_/, '');            /* 仓库里带时间戳前缀的名字 */
    const isLnk = /\.lnk$/i.test(name);

    await feedByHand({
      id: filePath,
      label: plain.replace(/\.[^.]+$/, '') || plain,
      glyph: 'txt',
      kind: isLnk ? 'lnk' : 'file',
      shortcut: isLnk,
      fileName: name,
      dir,
      pos: { x: px, y: py },
      el: null
    });

    /* 吃完这个文件就变成仓库里的文件了，把图标列表刷新一下 */
    setTimeout(async () => {
      try {
        Pet.allIcons = await Pet.bridge.listIcons();
        if (Pet.app && Pet.app.renderDesktop) Pet.app.renderDesktop();
      } catch (e) { /* 刷新失败不影响这次投喂 */ }
    }, C.eat.eatLockMs + 300);
  }

  function bindFileDrop() {
    if (!w.petBridge || !w.petBridge.getPathForFile) return;
    if (!bodyEl) return;

    bodyEl.addEventListener('dragover', (e) => {
      /* 不 preventDefault 浏览器就不让放 */
      e.preventDefault();
      /* 'move' → Windows 显示"移动"图标。写成 'copy' 的话
         光标上是"复制"，用户会以为文件会被复制一份而不是被吃掉。 */
      try { e.dataTransfer.dropEffect = 'move'; } catch (x) { /* 老浏览器 */ }
      el.classList.add('is-drop-ready');
    });
    bodyEl.addEventListener('dragleave', (e) => {
      if (e.target === bodyEl) el.classList.remove('is-drop-ready');
    });
    bodyEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.classList.remove('is-drop-ready');
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      if (!files.length) return;
      let p = '';
      try { p = w.petBridge.getPathForFile(files[0]); } catch (err) { p = ''; }
      if (!p) { say('这个吃不下'); return; }
      await feedByPath(p);
    });
  }

  /* ---------------- 拖拽 ---------------- */
  function bindDrag() {
    bodyEl.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      dragging = true;
      dragMoved = false;
      dragOffset.x = e.clientX - px;
      dragOffset.y = e.clientY - py;
      lastPointer = { x: e.clientX, t: Date.now() };
      bodyEl.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    bodyEl.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dx = e.clientX - (px + dragOffset.x);
      const dy = e.clientY - (py + dragOffset.y);
      if (!dragMoved && Math.hypot(dx, dy) > 4) {
        dragMoved = true;
        Pet.fsm.set('HELD', { force: true });
        Pet.fsm.lock(999999);
        Pet.fsm.applyClass('HELD');
        if (Math.random() < 0.35) sayPool('held', { ms: 1200 });
      }
      if (!dragMoved) return;

      const b = bounds();
      px = U.clamp(e.clientX - dragOffset.x, -20, b.maxX + 20);
      py = U.clamp(e.clientY - dragOffset.y, -20, b.ground + 40);

      /* 倾倒：跟手的速度感 */
      const now = Date.now();
      const dt = Math.max(16, now - lastPointer.t);
      const vx = (e.clientX - lastPointer.x) / dt * 16;
      lastPointer = { x: e.clientX, t: now };
      const tilt = U.clamp(vx * 2.2, -22, 22);
      el.style.setProperty('--tilt', tilt.toFixed(1) + 'deg');
      el.style.transform = `translate3d(${Math.round(px)}px, ${Math.round(py)}px, 0) scaleX(${dir >= 0 ? 1 : -1})`;
    });

    const endDrag = e => {
      if (!dragging) return;
      dragging = false;
      el.style.setProperty('--tilt', '0deg');
      if (!dragMoved) {
        onPoke();
        return;
      }
      el.classList.add('is-release');
      setTimeout(() => el.classList.remove('is-release'), 460);
      Pet.fsm.unlock();
      Pet.fsm.set('IDLE', { force: true, reason: 'drop' });
      /* 落地：y 平滑回到地面（rAF 里做） */
      scheduleNext(1200);
    };

    bodyEl.addEventListener('pointerup', endDrag);
    bodyEl.addEventListener('pointercancel', endDrag);
  }

  /* ---------------- 循环 ---------------- */
  function frame(ts) {
    const dt = Math.min(60, ts - lastTs || 16) / 1000;
    lastTs = ts;

    if (targetX != null && !dragging) {
      const d = targetX - px;
      const dist = Math.abs(d);
      if (dist <= C.move.arrivePx) {
        px = targetX;
        targetX = null;
        onArrive();
      } else {
        const step = C.move.speed * dt;
        px += Math.min(step, dist) * Math.sign(d);
        const nd = d > 0 ? 1 : -1;
        if (nd !== dir) { dir = nd; }
      }
    }

    /* 掉回地面 */
    if (!dragging && Math.abs(py - groundY) > 0.6) {
      py += (groundY - py) * Math.min(1, dt * 10);
    } else if (!dragging) {
      py = groundY;
    }

    /* 左右夹住 */
    if (!dragging) {
      const b = bounds();
      if (px < b.minX) px = b.minX;
      if (px > b.maxX) px = b.maxX;
    }

    render();

    if (Pet.bubble && Pet.bubble.visible) Pet.bubble.place(rect());

    rafId = requestAnimationFrame(frame);
  }

  /* ---------------- 对外 ---------------- */
  const PetCtl = {
    init(id) {
      el = U.$('#pet');
      bodyEl = U.$('#petBody');
      tiltEl = U.$('#petTilt');
      shadowEl = U.$('#petShadow');
      fxEl = U.$('#petFx');

      const b0 = bounds();
      px = b0.maxX - 40;

      PetCtl.setChar(id || charId, { silent: true });

      bindDrag();
      bindFileDrop();
      Pet.fsm.applyClass('IDLE');
      scheduleBlink();

      lastTs = performance.now();
      frame(lastTs);
    },

    /** 换形象：只换立绘、尺寸、着地参数，剧情和状态一律不动 */
    setChar(id, opts) {
      const c = (Pet.chars && Pet.chars[id]) || (Pet.chars && Pet.chars.ram);
      if (!c) return;
      opts = opts || {};
      charId = c.id;
      ch = c;
      W = c.w;
      H = c.h;
      mouthY = c.mouth;
      mouthX = c.mouthX != null ? c.mouthX : 0.5;

      el.style.width = W + 'px';
      el.style.height = H + 'px';
      el.classList.remove('is-ram', 'is-rem');
      el.classList.add('is-' + c.id);
      el.dataset.char = c.id;
      document.documentElement.setAttribute('data-char', c.id);

      /* 立绘 + 表情层只搭一次，之后换形象只换 src —— 动画状态不会被打断 */
      if (!artEl) {
        bodyEl.innerHTML = '';
        wrapEl = document.createElement('div');
        wrapEl.className = 'pet__artwrap';
        artEl = document.createElement('img');
        artEl.className = 'pet__art';
        artEl.alt = '';
        artEl.draggable = false;
        wrapEl.appendChild(artEl);
        bodyEl.appendChild(wrapEl);
        faceW = faceH = 0;   /* 容器重建过，旧记录作废，强制重生成表情层 */
      }
      artEl.src = c.src;

      if (Pet.faceSvg && (faceW !== W || faceH !== H)) {
        const old = wrapEl.querySelector('.pet__face');
        if (old) old.remove();
        wrapEl.insertAdjacentHTML('beforeend', Pet.faceSvg(W, H));
        faceW = W; faceH = H;
      }

      const b = bounds();
      groundY = b.ground;
      px = U.clamp(px || 0, b.minX, b.maxX);
      py = groundY;
      render();
      setStepDur();
      if (Pet.bubble && Pet.bubble.visible) Pet.bubble.place(rect());
    },

    rect,
    mouth,
    say,
    sayPool,

    setTalking(v) {
      if (speaking === v || !el) return;
      speaking = v;
      el.classList.toggle('is-talking', v);
    },

    walkTo,
    walkRandom,
    feedByHand,
    feedByPath,
    disturb,
    onPoke,
    startSeek,
    startEating,
    scheduleNext,
    canEatNow,

    sleep() {
      if (Pet.state.deadAt) return;
      Pet.fsm.set('SLEEP', { force: true });
      Pet.fsm.lock(0);
      sayPool('sleep', { ms: 1800 });
      /* 睡够了要自己醒，不然会一直躺到下次刷新 */
      clearTimeout(sleepTimer);
      sleepTimer = setTimeout(() => {
        if (Pet.fsm.is('SLEEP') && !Pet.state.deadAt) {
          Pet.fsm.set('IDLE', { force: true });
          scheduleNext(U.rand(1200, 2600));
        }
      }, U.rand(45000, 130000));
      scheduleNext(U.rand(30000, 60000));
    },

    wake() {
      clearTimeout(sleepTimer);
      if (Pet.fsm.is('SLEEP')) {
        Pet.fsm.set('IDLE', { force: true });
        sayPool('wake');
        flash('is-happy', 1200);
      }
      scheduleNext(1200);
    },

    /** 笑一下（^^ 眼），戳她、睡醒、开场招呼时用 */
    setHappy(ms) { flash('is-happy', ms || 1200); },

    /* 刷新坐标（窗口尺寸变化后） */
    reflow() {
      const b = bounds();
      groundY = b.ground;
      px = U.clamp(px, b.minX, b.maxX);
      py = Math.min(py, b.ground);
      render();
    },

    get pos() { return { x: px, y: py, dir, groundY }; },
    get size() { return { w: W, h: H }; },
    get charId() { return charId; },
    get charName() { return ch ? ch.name : ''; },

    /** 下一个形象（右键菜单显示她的名字） */
    nextChar() {
      const order = Pet.charOrder || ['ram', 'rem'];
      const i = order.indexOf(charId);
      return order[(i + 1) % order.length];
    },

    get held() { return dragging; },
    setPos(x, y) { px = x; py = y; render(); },
    get seeking() { return mode === 'seek'; },

    stop() {
      cancelAnimationFrame(rafId);
      clearTimeout(planTimer);
      clearTimeout(blinkTimer);
      clearTimeout(sleepTimer);
      Object.keys(flashT).forEach(k => clearTimeout(flashT[k]));
    }
  };

  Pet.pet = PetCtl;
})(window);
