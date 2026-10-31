/* ============ hunger.js — 饥饿 / 离线结算 / 长眠 / 复苏 ============ */
(function (w) {
  const Pet = w.Pet;
  const U = Pet.util;
  const C = Pet.config;

  let saveTimer = null;
  let tickTimer = null;

  function clampHunger() {
    Pet.state.hunger = U.clamp(Pet.state.hunger, 0, C.hunger.deathAt);
  }

  function paintBar() {
    const st = Pet.state;
    /* v 是"饥饿值"：0 = 不饿，100 = 快饿死了 */
    const v = st.deadAt ? 100 : st.hunger;
    const pct = Math.round(v) + '%';

    /* 她右上角那根（跟着她走） */
    const pb = U.$('#petHunger');
    if (pb) {
      pb.style.setProperty('--v', pct);
      pb.style.setProperty('--fill', v >= 70 ? '#ff7a6b' : v >= 30 ? '#ffd166' : '#7ed9b0');
      pb.classList.toggle('is-high', st.deadAt || v >= 70);
      pb.title = st.deadAt
        ? '她已经长眠了'
        : `饥饿值 ${Math.round(v)} / 100（饱腹 ${Math.round(100 - v)}%）`;
    }
  }

  /* 重置流程会先删存档再 reload，而 reload 会触发 beforeunload → save()，
     不暂停的话旧存档会被原样写回来，等于没重置。 */
  let savePaused = false;

  function save(now) {
    if (savePaused) return;
    Pet.state.lastSeen = Date.now();
    if (Pet.bridge) Pet.bridge.saveState(Pet.state);
    void now;
  }

  const Hunger = {
    /** 暂停/恢复自动存档。删档重载前要先暂停，否则 beforeunload 会把旧存档写回来 */
    pauseSave(v) { savePaused = !!v; },

    boot() {
      const st = Pet.state;
      const now = Date.now();

      /* 时间回拨：只当这一轮没离线，不判死、不提示 */
      let offlineSec = st.lastSeen ? (now - st.lastSeen) / 1000 : 0;
      if (offlineSec < 0) {
        offlineSec = 0;
        st.clockSkew = (st.clockSkew || 0) + 1;
      }

      let died = false, offlineApplied = 0;

      if (st.lastSeen && offlineSec > C.hunger.graceSec && !st.deadAt) {
        const offlineHours = offlineSec / 3600;
        offlineApplied = offlineHours * C.hunger.offlinePerHour;

        /* 精确算出"她是什么时候饿到 100 的"，而不是从现在开始算 */
        if (st.hunger < C.hunger.deathAt) {
          const hoursToFull = (C.hunger.deathAt - st.hunger) / C.hunger.offlinePerHour;
          if (offlineHours > hoursToFull) {
            st.starveSince = st.lastSeen + hoursToFull * 3600000;
          }
        } else if (!st.starveSince) {
          st.starveSince = st.lastSeen;
        }

        st.hunger += offlineApplied;
        clampHunger();

        /* 双条件：饿满 100 且 饿着的时长够久 */
        if (st.hunger >= C.hunger.deathAt && st.starveSince &&
            now - st.starveSince >= C.hunger.deathHours * 3600000) {
          died = Hunger.die(true);
        }
      }

      if (st.deadAt) {
        /* 上次已经死了：判断还在不在可复苏窗口内 */
        const hoursDead = (now - st.deadAt) / 3600000;
        if (hoursDead > C.hunger.reviveWindowHours) {
          st.reviveNeed = 0;
          st.gone = true;
        } else if (st.reviveNeed == null) {
          st.reviveNeed = C.hunger.reviveNeed;
        }
      }

      Hunger.paintBar();
      save();

      /* 在线时缓慢变饿 */
      clearInterval(tickTimer);
      tickTimer = setInterval(() => {
        if (Pet.state.deadAt) return;
        Pet.state.hunger += C.hunger.onlinePerSec * 5;
        clampHunger();
        Hunger.paintBar();
        if (Pet.state.hunger >= C.hunger.deathAt && !Pet.state.starveSince) {
          Pet.state.starveSince = Date.now();
        }
      }, 5000);

      /* 每 15 秒落盘一次 */
      clearInterval(saveTimer);
      saveTimer = setInterval(() => save(), 15000);
      w.addEventListener('beforeunload', () => save());

      return { offlineSec, offlineApplied, died };
    },

    save,
    paintBar,
    clampHunger,

    /** 吃一个图标 */
    eat(item) {
      const st = Pet.state;
      st.hunger = Math.max(0, st.hunger - C.hunger.eatValue);
      st.starveSince = null;
      st.eatCount = (st.eatCount || 0) + 1;

      /* 账由主进程的 manifest 管（id 是"原始路径"），渲染层只是它的投影 ——
         这里再 push 一份就是两套账，两边 id 对不上，
         findIndex 会找错条目，吐回就永远吐不回来。
         投影由 syncLocker() 做（main.js 里）。 */

      Hunger.paintBar();
      save();

      /* 吃货日志由主进程记 —— 只有它知道真实结果：
         放到哪儿了、失败是因为权限还是占用。 */
    },

    /** 长眠。silent = 不播动画（启动时直接就这个状态） */
    die(silent) {
      const st = Pet.state;
      if (st.deadAt) return false;
      st.deadAt = Date.now();
      st.hunger = C.hunger.deathAt;
      st.reviveNeed = C.hunger.reviveNeed;
      Hunger.paintBar();
      save();

      Pet.fsm.set('DEAD', { force: true });
      if (!silent && Pet.pet) {
        Pet.pet.say('我有点困……', { ms: 2600 });
      }
      if (Pet.onDeath) Pet.onDeath(st);
      return true;
    },

    /** 长眠状态下被投喂
     *  opts.fake = true → "假投喂"：不碰任何真实文件，只走复活流程。
     *  桌面版里调试面板的 id='debug' 根本不是真实文件，走真的 eatIcon
     *  主进程会回"这个已经不见了"，按钮必然失败 —— 调试必须走这条路。 */
    async reviveByFeed(item, opts) {
      const st = Pet.state;
      if (!st.deadAt) return;
      if (st.gone) {
        Pet.pet.say('……');
        U.toast('她已经走了很久了。');
        return;
      }

      const fake = !!(opts && opts.fake);
      if (!fake) {
        const res = await Pet.bridge.eatIcon(item);
        if (!res || !res.ok) {
          U.toast('这个喂不进去');
          return;
        }
      }

      st.reviveNeed = Math.max(0, (st.reviveNeed == null ? C.hunger.reviveNeed : st.reviveNeed) - 1);
      if (!fake) Pet.icons.bite(item);   /* 假投喂没有真的图标可咬 */
      save();

      if (st.reviveNeed > 0) {
        Pet.pet.say(U.pick(C.lines.weak), { instant: true, ms: 1600 });
        U.toast(`还差 ${st.reviveNeed} 个`);
        return;
      }

      /* 复苏 */
      st.deadAt = null;
      st.starveSince = null;
      st.hunger = 62;
      st.eatCount = (st.eatCount || 0) + 1;
      save();

      Pet.fsm.set('REVIVE', { force: true });
      Pet.pet.say(U.pick(C.lines.revive), { ms: 3400 });
      Hunger.paintBar();
      if (Pet.onRevive) Pet.onRevive(st);

      setTimeout(() => {
        if (!Pet.state.deadAt) {
          Pet.fsm.set('IDLE', { force: true });
          Pet.pet.scheduleNext(2400);
        }
      }, 4200);
    },

    /** 调试：直接加饥饿小时数 */
    addHours(h) {
      const st = Pet.state;
      st.hunger = U.clamp(st.hunger + h * C.hunger.offlinePerHour, 0, C.hunger.deathAt);
      if (st.hunger >= C.hunger.deathAt && !st.starveSince) st.starveSince = Date.now() - h * 3600000;
      if (st.hunger < C.hunger.deathAt) st.starveSince = null;
      Hunger.paintBar();
      save();
      return st.hunger;
    },

    /** 调试：模拟离线多久 */
    simulateOffline(hours) {
      const st = Pet.state;
      st.lastSeen = Date.now() - hours * 3600000;
      save();
      return Hunger.boot();
    },

    reset() {
      const st = Pet.state;
      st.hunger = C.hunger.start;
      st.deadAt = null;
      st.starveSince = null;
      st.reviveNeed = C.hunger.reviveNeed;
      st.gone = false;
      st.eaten = [];
      st.eatCount = 0;
      st.lastSeen = Date.now();
      save();
      Hunger.paintBar();
    },

    stop() {
      clearInterval(tickTimer);
      clearInterval(saveTimer);
    }
  };

  Pet.hunger = Hunger;
})(window);
