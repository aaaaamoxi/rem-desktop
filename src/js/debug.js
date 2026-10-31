/* ============ debug.js — ?debug=1 时间旅行面板 ============
   没有这个面板，验收"饿死剧情"要等 4 天，等于没法测。
   网页版打开 index.html?debug=1，桌面版 npm start 默认就带着（开发版自动开）。
   =========================================================*/
(function (w) {
  const Pet = w.Pet;
  const U = Pet.util;

  const BTNS = [
    { k: '+6h', fn: () => { Pet.hunger.addHours(6); U.toast('时间 +6 小时'); } },
    { k: '+1 天', fn: () => { Pet.hunger.addHours(24); U.toast('时间 +1 天'); } },
    { k: '+3 天', fn: () => { Pet.hunger.addHours(72); U.toast('时间 +3 天'); } },
    { k: '直接长眠', cls: 'is-danger', fn: () => Pet.debug.kill() },
    { k: '救回来', fn: () => Pet.debug.revive() },
    { k: '复位饥饿', fn: () => { Pet.hunger.reset(); Pet.app.applyState(); U.toast('已复位'); } },
    { k: '强制夜间', fn: () => { Pet.night.force(!Pet.night.forced); Pet.debug.paint(); U.toast(Pet.night.forced ? '已强制夜间' : '夜间提醒已恢复'); } },
    { k: '换形象', fn: () => { Pet.app.switchChar(); } },
    { k: '重置全部', cls: 'is-danger', fn: () => { Pet.app.resetAll(); } }
  ];

  const Debug = {
    init() {
      if (!/[?&]debug=1/.test(w.location.search)) return;
      const panel = U.$('#debugPanel');
      if (!panel) return;
      panel.hidden = false;

      const hd = U.el('div', 'debug__hd');
      hd.innerHTML = '<span>调试面板</span><span>?debug=1</span>';
      panel.appendChild(hd);
      Debug.enableDrag(panel, hd);

      const grid = U.el('div', 'debug__grid');
      BTNS.forEach(b => {
        const btn = U.el('button', 'debug__btn' + (b.cls ? ' ' + b.cls : ''));
        btn.textContent = b.k;
        btn.addEventListener('click', b.fn);
        grid.appendChild(btn);
      });
      panel.appendChild(grid);

      const stat = U.el('div', 'debug__stat');
      stat.id = 'debugStat';
      panel.appendChild(stat);

      /* 桌面版托盘菜单能折叠它；网页版没托盘，用 Ctrl+Shift+D 或 F12 */
      if (Pet.bridge && Pet.bridge.onTogglePanel) {
        Pet.bridge.onTogglePanel(() => Debug.toggle());
      }
      w.addEventListener('keydown', (e) => {
        const k = e.key;
        if ((e.ctrlKey && e.shiftKey && (k === 'D' || k === 'd')) || k === 'F12') {
          e.preventDefault();
          Debug.toggle();
        }
      });

      setInterval(() => Debug.paint(), 1000);
      Debug.paint();
    },

    /** 显示 / 隐藏面板 */
    toggle() {
      const panel = U.$('#debugPanel');
      if (!panel) return;
      panel.hidden = !panel.hidden;
    },

    /** 拖动面板：桌面版它浮在真实桌面上，挡住东西就拖到一边去。
     *  拖完把位置记下来，下次打开还在原地。 */
    enableDrag(panel, handle) {
      const KEY = 'pet.debug.pos';

      /* 恢复上次的位置 */
      const saved = U.store.get(KEY, null);
      if (saved && typeof saved.x === 'number') {
        panel.style.left = saved.x + 'px';
        panel.style.top = saved.y + 'px';
        panel.style.bottom = 'auto';
      }

      let dragging = false, dx = 0, dy = 0;
      handle.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        dragging = true;
        const r = panel.getBoundingClientRect();
        dx = e.clientX - r.left;
        dy = e.clientY - r.top;
        try { handle.setPointerCapture(e.pointerId); } catch (x) { /* 忽略 */ }
        e.preventDefault();
      });
      handle.addEventListener('pointermove', e => {
        if (!dragging) return;
        const x = U.clamp(e.clientX - dx, 0, Math.max(0, w.innerWidth - panel.offsetWidth));
        const y = U.clamp(e.clientY - dy, 0, Math.max(0, w.innerHeight - panel.offsetHeight));
        panel.style.left = x + 'px';
        panel.style.top = y + 'px';
        panel.style.bottom = 'auto';
      });
      const end = e => {
        if (!dragging) return;
        dragging = false;
        try { handle.releasePointerCapture(e.pointerId); } catch (x) { /* 忽略 */ }
        U.store.set(KEY, { x: panel.offsetLeft, y: panel.offsetTop });
      };
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    },

    paint() {
      const s = U.$('#debugStat');
      if (!s || !Pet.state) return;
      const st = Pet.state;
      s.innerHTML =
        `状态 ${Pet.fsm.state}<br>` +
        `饥饿 ${st.hunger.toFixed(1)} / 100<br>` +
        `离线 ${st.lastSeen ? U.humanGap(Date.now() - st.lastSeen) : '—'}<br>` +
        `长眠 ${st.deadAt ? U.fmtDate(st.deadAt) : '否'}${st.deadAt ? `（需喂 ${st.reviveNeed}）` : ''}<br>` +
        `已吃 ${st.eatCount || 0} 个 · 剩 ${Pet.icons.list().filter(i => !i.gone).length} 个`;
    },

    kill() {
      const st = Pet.state;
      st.hunger = 100;
      st.starveSince = Date.now() - Pet.config.hunger.deathHours * 3600000 - 1000;
      Pet.hunger.die(false);
      Pet.app.applyState();
      U.toast('她长眠了');
    },

    revive() {
      const st = Pet.state;
      if (!st.deadAt) { U.toast('她没长眠'); return; }
      st.reviveNeed = 1;
      /* fake:true —— 调试用假投喂，不去找真实文件。
         网页版原来靠 adapter-web 的"永远 ok"蒙混过关，桌面版会真的去找
         id='debug' 的文件，必然失败。两端统一走这条路。 */
      Pet.hunger.reviveByFeed(
        { id: 'debug', label: 'debug.txt', glyph: 'txt', kind: 'file', pos: { x: 0, y: 0 }, el: null },
        { fake: true });
      Pet.app.applyState();
    }
  };

  Pet.debug = Debug;
})(window);
