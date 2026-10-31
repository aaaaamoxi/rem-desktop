/* ============ main.js — 启动 / 装配 / 菜单 / 弹窗 ============ */
(function (w) {
  const Pet = w.Pet;
  const U = Pet.util;
  const C = Pet.config;

  function defaultState() {
    return {
      v: 1,
      createdAt: Date.now(),
      lastSeen: null,
      hunger: C.hunger.start,
      deadAt: null,
      starveSince: null,
      reviveNeed: C.hunger.reviveNeed,
      gone: false,
      eaten: [],
      eatCount: 0,
      slots: {},
      char: C.char
    };
  }

  /* ---------------- 弹窗 ---------------- */
  function closeModal() {
    const mask = U.$('#modalMask');
    const box = U.$('#modalBox');
    if (box) box.innerHTML = '';
    if (mask) mask.hidden = true;
  }

  function modal(opts) {
    const mask = U.$('#modalMask');
    const box = U.$('#modalBox');
    box.innerHTML = '';

    if (opts.title) {
      const t = U.el('div', 'modal__title');
      t.textContent = opts.title;
      box.appendChild(t);
    }
    if (opts.sub) {
      const s = U.el('div', 'modal__sub');
      s.textContent = opts.sub;
      box.appendChild(s);
    }
    if (opts.html) {
      const b = U.el('div', 'modal__body');
      b.innerHTML = opts.html;
      box.appendChild(b);
    }
    if (opts.node) {
      const b = U.el('div', 'modal__body');
      b.appendChild(opts.node);
      box.appendChild(b);
    }

    const acts = U.el('div', 'modal__acts');
    (opts.acts || [{ label: '知道了', primary: true }]).forEach(a => {
      const b = U.el('button', 'btn' + (a.primary ? ' btn--primary' : '') + (a.danger ? ' btn--danger' : ''));
      b.textContent = a.label;
      b.addEventListener('click', () => {
        if (a.keepOpen !== true) closeModal();
        a.onClick && a.onClick();
      });
      acts.appendChild(b);
    });
    box.appendChild(acts);

    mask.hidden = false;
    mask.onclick = e => { if (e.target === mask) closeModal(); };
    return box;
  }

  /* ---------------- 右键菜单 ---------------- */
  function closeMenu() {
    const m = U.$('#menu');
    if (m) { m.hidden = true; m.innerHTML = ''; }
  }

  function openMenu(x, y, items) {
    const m = U.$('#menu');
    m.innerHTML = '';

    items.forEach(it => {
      if (it.sep) { m.appendChild(U.el('div', 'menu__sep')); return; }
      if (it.title) {
        const t = U.el('div', 'menu__title');
        t.textContent = it.title;
        m.appendChild(t);
        return;
      }
      const row = U.el('div', 'menu__item' + (it.danger ? ' is-danger' : ''));
      row.innerHTML = `<span>${U.esc(it.label)}</span>` + (it.k ? `<span class="k">${U.esc(it.k)}</span>` : '');
      row.addEventListener('click', () => {
        closeMenu();
        it.onClick && it.onClick();
      });
      m.appendChild(row);
    });

    m.hidden = false;
    m.style.left = '0px';
    m.style.top = '0px';
    const r = m.getBoundingClientRect();
    const left = U.clamp(x, 8, w.innerWidth - r.width - 8);
    const top = U.clamp(y, 8, w.innerHeight - r.height - 8);
    m.style.left = Math.round(left) + 'px';
    m.style.top = Math.round(top) + 'px';
  }

  /* ---------------- 列表 ---------------- */
  function buildList() {
    const st = Pet.state;
    const all = Pet.allIcons || [];
    st.slots = st.slots || {};

    let maxSlot = -1;
    Object.keys(st.slots).forEach(k => { maxSlot = Math.max(maxSlot, st.slots[k]); });

    const eatenIds = new Set(st.eaten.map(e => e.id));
    const list = [];

    all.forEach((ic, i) => {
      if (st.slots[ic.id] == null) st.slots[ic.id] = maxSlot + 1 + i;
      if (eatenIds.has(ic.id)) return;
      list.push(Object.assign({}, ic, { slot: st.slots[ic.id] }));
    });

    if (st.deadAt) {
      const used = list.map(x => x.slot);
      let slot = 0;
      while (used.indexOf(slot) >= 0 && slot < 40) slot++;
      list.push({
        id: 'will',
        label: C.will.title,
        glyph: 'will',
        kind: 'will',
        slot,
        eatable: false
      });
    }

    list.sort((a, b) => a.slot - b.slot);
    return list;
  }

  /* ---------------- 遗书 ---------------- */
  function openWill() {
    const letter = U.el('div', 'letter');
    letter.textContent = C.will.text;

    const acts = [
      {
        label: '放到桌面上',
        onClick: async () => {
          const ok = await Pet.bridge.writeWill(C.will.text);
          U.toast(ok ? '已经放到桌面上了' : '写不进去，可能没有权限');
        }
      },
      { label: '收起来', primary: true }
    ];

    if (Pet.state.deadAt) {
      acts.unshift({
        label: '试着喂她',
        onClick: () => U.toast(`拖 ${Pet.state.reviveNeed || 3} 个图标到她身上，也许还能救回来。`)
      });
    }

    modal({
      title: C.will.title,
      sub: Pet.state.deadAt ? `她长眠于 ${U.fmtDate(Pet.state.deadAt)}` : '一封留在桌面上的信',
      node: letter,
      acts
    });
  }

  /* ---------------- 食物仓库 ---------------- */
  function openLocker() {
    const st = Pet.state;
    const box = U.el('div');

    if (!st.eaten.length) {
      const e = U.el('div', 'locker__empty');
      e.textContent = '还没有东西。她还没吃过东西。';
      box.appendChild(e);
    } else {
      const ul = U.el('ul', 'locker');
      st.eaten.slice().reverse().forEach(rec => {
        const li = U.el('li', 'locker__row');
        const nm = U.el('span', 'nm');
        nm.textContent = rec.label || rec.fileName;
        const tm = U.el('span', 'tm');
        tm.textContent = U.fmtDate(rec.eatenAt);
        const btn = U.el('button', 'btn btn--sm');
        btn.textContent = '吐回来';
        btn.addEventListener('click', async () => {
          /* 必须 await：主进程那边要真把文件挪回去，
             不等就重开弹窗的话，列表还是老的，看着像"点了没反应" */
          await returnIcon(rec.id);
          await syncLocker();
          closeModal();
          openLocker();
        });
        li.appendChild(nm);
        li.appendChild(tm);
        li.appendChild(btn);
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }

    const acts = [];
    if (st.eaten.length) {
      acts.push({
        label: '全部吐回',
        onClick: async () => {
          /* 串行来，不能 forEach —— 那会把多个吐回请求一起丢给主进程，
             主进程同时读写同一份 manifest，会互相覆盖，丢文件。
             而且 silent=true 时不该一条一条弹 toast，最后汇总一次就够。 */
          const ids = st.eaten.map(r => r.id);
          let ok = 0, moved = 0, renamed = 0, fail = 0, gone = 0;
          for (const id of ids) {
            const r = await returnIcon(id, true);
            if (r === 'ok') ok++;
            else if (r === 'moved') { ok++; moved++; }
            else if (r === 'renamed') { ok++; renamed++; }
            else if (r === 'gone') gone++;
            else if (r === 'fail') fail++;
          }
          const extra = [];
          if (renamed) extra.push(`${renamed} 个改了名`);
          if (moved) extra.push(`${moved} 个放到了你桌面`);
          if (fail || gone) U.toast(`还了 ${ok} 个${extra.length ? '（' + extra.join('、') + '）' : ''}，${fail + gone} 个没成功`, 3800);
          else U.toast(`还了 ${ok} 个${extra.length ? '（' + extra.join('、') + '）' : ''}`, 3200);
          await syncLocker();
          openLocker();
        }
      });
    }
    if (st.eaten.length) {
      acts.push({
        label: '打开吃掉的食物',
        onClick: () => { if (Pet.bridge.openFood) Pet.bridge.openFood(); }
      });
    }
    acts.push({ label: '关闭', primary: true });

    modal({
      title: '吃掉的食物',
      sub: `她一共吃过 ${st.eatCount || 0} 个 · 桌上「吃掉的食物」里存着 ${st.eaten.length} 个`,
      node: box,
      acts
    });
  }

  /* 吐回一个文件。
     返回 'ok' | 'renamed' | 'moved' | 'gone' | 'fail'
     —— 每个状态都有自己的提示。 */
  async function returnIcon(id, silent) {
    const st = Pet.state;
    const idx = st.eaten.findIndex(e => e.id === id);
    if (idx < 0) {
      if (!silent) U.toast('这个已经不在了', 3000);
      return 'gone';
    }
    const rec = st.eaten[idx];
    const r = await Pet.bridge.returnIcon(rec);
    if (!r || !r.ok) {
      if (!silent) U.toast((r && r.msg) || '这个还不了', 3600);
      return 'fail';   /* 失败 → 条目留着（文件还在「吃掉的食物」里） */
    }

    st.eaten.splice(idx, 1);
    Pet.hunger.save();

    /* 文件真的回到文件系统了，得重新扫一遍图标列表，
       否则它回到桌面她也看不见、吃不着（得重启才行）。 */
    try {
      Pet.allIcons = await Pet.bridge.listIcons();
      App.renderDesktop();
    } catch (e) { /* 刷新失败不影响这次归还 */ }

    if (r.renamed) {
      const newName = (r.target || '').split(/[\\/]/).pop();
      if (!silent) U.toast(`原位置已有同名文件，改名成「${newName}」放回去了`, 3600);
      return 'renamed';
    }
    if (r.fallback) {
      if (!silent) U.toast(`原位置放不回去，「${rec.label}」放到你桌面上了`, 3600);
      return 'moved';
    }
    if (!silent) U.toast(`「${rec.label}」放回去了`);
    return 'ok';
  }

  /* 仓库里有什么，以主进程的清单为准 —— 文件才是真的。
     渲染层自己记的那份可能和它漂移（多一条少一条），
     漂移了就拿清单校正，弹窗里的数量才准。

     这里做的是**整体替换**（manifest → st.eaten 的投影），不做新旧合并 ——
     合并会留下改不掉的僵尸条目。而且投影之后 st.eaten[].id 恒等于
     manifest 的 id（原始路径），吐回时才对得上。 */
  async function syncLocker() {
    const st = Pet.state;
    let real = null;
    try { real = await Pet.bridge.foodList(); } catch (e) { real = null; }
    /* 取不到清单就原样不动 —— 千万别因为一次读取失败就把账清空 */
    if (!Array.isArray(real)) return;

    st.eaten = real.map(m => ({
      id: m.id,                                  /* ← 唯一口径：manifest 的 id */
      label: m.label || m.fileName,
      glyph: m.glyph || 'txt',
      kind: m.shortcut ? 'lnk' : 'file',
      shortcut: !!m.shortcut,
      pos: m.pos || { x: 0, y: 0 },
      eatenAt: m.eatenAt || 0,
      stored: m.stored,
      dir: m.dir,
      fileName: m.fileName
    }));
    Pet.hunger.save();
  }

  /* 读吃货日志（两端格式一致：都是已经排好版的行） */
  async function readLogLines(limit) {
    try {
      const l = await Pet.bridge.logRead(limit);
      return Array.isArray(l) ? l : [];
    } catch (e) { return []; }
  }

  /* ---------------- 菜单内容 ---------------- */
  function petMenu(x, y) {
    const st = Pet.state;
    const items = [
      { title: '小家伙' },
      { label: '说说话', onClick: () => Pet.pet.sayPool('idle', { ms: 2400 }) },
      {
        label: st.deadAt ? '叫叫她' : (Pet.fsm.is('SLEEP') ? '叫醒她' : '让她睡觉'),
        onClick: () => st.deadAt ? Pet.pet.say('……') : (Pet.fsm.is('SLEEP') ? Pet.pet.wake() : Pet.pet.sleep())
      },
      {
        label: '喂她吃东西',
        onClick: () => {
          if (st.deadAt) U.toast('先把图标拖到她身上试试');
          else if (!Pet.pet.startSeek()) U.toast('桌面上没东西可吃了');
        }
      },
      { sep: true },
      { label: '吃掉的食物', k: String(st.eaten.length), onClick: openLocker },
      { label: '换个形象', k: (Pet.chars[Pet.pet.nextChar()] || {}).name || '', onClick: () => App.switchChar() },
      { sep: true },
      { label: '她还记得什么', onClick: () => App.showStats },
      { label: '吃货日志', onClick: () => App.showLog },
      { label: '重置这一只', danger: true, onClick: App.confirmReset }
    ];
    openMenu(x, y, items);
  }

  /* ---------------- App ---------------- */
  const App = {
    /* 换形象：剧情、饥饿、吃过的图标全都不变，只换外面这层壳 */
    switchChar(id) {
      const target = id || Pet.pet.nextChar();
      const c = Pet.chars[target];
      if (!c) return;
      Pet.state.char = target;
      Pet.hunger && Pet.hunger.save();
      Pet.pet.setChar(target);
      App.renderDesktop();
      const hello = { ram: '……姐姐不在。', rem: '雷姆，来了。' };
      Pet.pet.say(hello[target] || '……', { ms: 2200 });
    },

    renderDesktop() {
      /* 真实桌面图标是 Explorer 画的，我们不画 DOM，
         位置只用来算"她该走到哪" */
      Pet.icons.render(buildList());
    },

    applyState() {
      const st = Pet.state;
      if (st.deadAt) {
        Pet.fsm.state = 'DEAD';
        Pet.fsm.applyClass('DEAD');
      } else if (Pet.fsm.state === 'DEAD') {
        Pet.fsm.set('IDLE', { force: true });
      }
      Pet.hunger.paintBar();
    },

    async showStats() {
      const st = Pet.state;
      const days = Math.max(1, Math.round((Date.now() - (st.createdAt || Date.now())) / 86400000));
      const log = await readLogLines(12);
      modal({
        title: '她还记得什么',
        sub: '全部存在你自己电脑上，没有联网',
        html:
          `<p>认识你 ${days} 天。</p>` +
          `<p>吃过 ${st.eatCount || 0} 个图标，桌上「吃掉的食物」里存着 ${st.eaten.length} 个。</p>` +
          `<p>现在饱腹度 ${Math.round(100 - st.hunger)}%。</p>` +
          `<p>上次见她 ${st.lastSeen ? U.humanGap(Date.now() - st.lastSeen) + '前' : '——'}</p>` +
          (log.length ? '<p class="loglist__t">最近吃过的</p><ul class="loglist">' +
            log.map(l => `<li>${U.esc(l)}</li>`).join('') + '</ul>' : '')
      });
    },

    /* 单独的吃货日志窗口 */
    async showLog() {
      const log = await readLogLines(60);
      modal({
        title: '吃货日志',
        sub: log.length ? '她吃过的每一个，都在上面' : '她还没吃过东西',
        html: log.length
          ? '<ul class="loglist">' + log.map(l => `<li>${U.esc(l)}</li>`).join('') + '</ul>'
          : '<p>空的呢。</p>'
      });
    },

    confirmReset() {
      modal({
        title: '重置这一只？',
        sub: '她会忘掉吃过的图标、饥饿度和配色，重新认识你。',
        acts: [
          { label: '算了' },
          {
            label: '确定重置',
            danger: true,
            onClick: () => App.resetAll()
          }
        ]
      });
    },

    /* 打开食物仓库弹窗（导出给自检做 DOM 断言） */
    openLocker() { openLocker(); },

    /* 从主进程清单同步仓库账目（导出给 pet.js 调用） */
    syncLocker() { return syncLocker(); },

    /* 清空存档并重新开始。
       存档在 userData/pet-state.json，所以走 bridge.resetState()，
       让主进程把文件删掉。
       关键：先 pauseSave —— reload 会触发 beforeunload → save()，
       不暂停的话刚删掉的存档会被原样写回来，等于没重置。 */
    async resetAll() {
      Pet.hunger.pauseSave(true);
      let r = null;
      try {
        r = await Pet.bridge.resetState();
      } catch (e) {
        r = { ok: false, msg: '重置失败' };
      }
      if (r && r.ok === false) {
        U.toast('重置失败：' + ((r && r.msg) || '未知错误'));
        Pet.hunger.pauseSave(false);
        return;
      }
      w.location.reload();
    },

    async boot() {
      Pet.initBridge();

      const saved = Pet.bridge.loadState();
      Pet.state = saved || defaultState();
      Pet.state.eaten = Pet.state.eaten || [];
      Pet.state.slots = Pet.state.slots || {};

      Pet.recentLines = [];

      /* 图标数据 */
      Pet.allIcons = await Pet.bridge.listIcons();
      console.log('[pet] 读到桌面图标 ' + Pet.allIcons.length + ' 个');
      /* 仓库清单以主进程为准（文件才是真的），两边对不上就校正 */
      await syncLocker();

      /* 角色先起来（mouth 依赖它） */
      Pet.pet.init(Pet.state.char || C.char);

      Pet.icons.init(() => Pet.pet.mouth(), openWill);

      /* 按 Windows 的图标间距走，别对着空气张嘴 */
      Pet.icons.setCell(75, 96, 12, 10);

      App.renderDesktop();

      /* 离线结算（可能直接判死） */
      const info = Pet.hunger.boot();
      info.hadState = !!saved;
      App.applyState();

      /* 死亡的后续 */
      Pet.onDeath = async () => {
        /* 桌面版没法替系统画图标，就直接把遗书写到桌面上 */
        await Pet.bridge.writeWill(C.will.text);
        U.toast('桌面上多了一个 遗书.txt。', 4200);
      };
      Pet.onRevive = () => {
        App.renderDesktop();
        U.toast('她站起来了。');
      };

      /* 互动 */
      document.addEventListener('pointerdown', e => {
        const m = U.$('#menu');
        if (m && !m.hidden && !m.contains(e.target)) closeMenu();
      });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape') { closeMenu(); closeModal(); }
      });

      const petEl = U.$('#pet');
      petEl.addEventListener('contextmenu', e => {
        e.preventDefault();
        petMenu(e.clientX, e.clientY);
      });

      /* 深夜提醒 */
      Pet.night.start();

      /* 调试面板 */
      Pet.debug.init();

      /* 唤醒 / 切回来重算离线 */
      Pet.bridge.onResume(() => {
        const i2 = Pet.hunger.boot();
        App.applyState();
        if (i2 && i2.died) U.toast('她没能等到你回来。', 3600);
      });

      w.addEventListener('resize', U.throttle(() => {
        Pet.pet.reflow();
        Pet.icons.layout();
      }, 180));

      /* 桌面版：告诉主进程"哪几块区域要接鼠标"，其余地方穿透到桌面。
         各块要分开报，不能合成一个矩形 —— 角色在屏幕中间、调试面板在左下角，
         合成一块的话中间那整片桌面都会被吃掉，桌面图标就全点不到了。 */
      if (w.petBridge && w.petBridge.reportHit) {
        setInterval(() => {
          if (Pet.pet.held) {
            /* 拖拽时整窗都要接事件，否则手一快就断了 */
            w.petBridge.reportHit([{ x: 0, y: 0, w: 9e4, h: 9e4 }]);
            return;
          }
          const rects = [];

          const p = Pet.pet.rect();
          rects.push({ x: p.x - 8, y: p.y - 8, w: p.w + 16, h: p.h + 16 });

          const bubble = U.$('#bubble');
          if (bubble && !bubble.hidden) {
            const br = bubble.getBoundingClientRect();
            rects.push({ x: br.left - 6, y: br.top - 6, w: br.width + 12, h: br.height + 12 });
          }
          const menu = U.$('#menu');
          if (menu && !menu.hidden) {
            const mr = menu.getBoundingClientRect();
            rects.push({ x: mr.left - 4, y: mr.top - 4, w: mr.width + 8, h: mr.height + 8 });
          }
          /* 调试面板单独一块，不跟角色合并 */
          const panel = U.$('#debugPanel');
          if (panel && !panel.hidden) {
            const pr = panel.getBoundingClientRect();
            rects.push({ x: pr.left - 4, y: pr.top - 4, w: pr.width + 8, h: pr.height + 8 });
          }
          /* 弹窗（食物仓库、记忆、确认框）也得接鼠标，否则上面的按钮点不动。
             只报盒子本身，不报那层全屏遮罩 —— 罩住的地方在桌面上要能点到桌面。 */
          const mask = U.$('#modalMask');
          if (mask && !mask.hidden) {
            const box = U.$('#modalBox');
            if (box) {
              const mr = box.getBoundingClientRect();
              rects.push({ x: mr.left - 4, y: mr.top - 4, w: mr.width + 8, h: mr.height + 8 });
            }
          }
          w.petBridge.reportHit(rects);
        }, 100);
      }

      /* 开场 */
      if (Pet.state.deadAt) {
        setTimeout(() => {
          U.toast('她睡着了，没有再醒。桌上留了一个文件。', 4200);
        }, 900);
      } else {
        Pet.scene.opening(info);
        setTimeout(() => Pet.scene.idleBeat(), 200);
      }
    }
  };

  Pet.app = App;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.boot());
  } else {
    App.boot();
  }
})(window);
