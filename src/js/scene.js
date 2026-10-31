/* ============ scene.js — 开场剧本（前 3 秒必须有戏，不能靠随机） ============ */
(function (w) {
  const Pet = w.Pet;
  const U = Pet.util;
  const C = Pet.config;

  const Scene = {
    opening(info = {}) {
      const pet = Pet.pet;
      const s = Pet.bridge.screen();
      const firstVisit = !info.hadState;

      /* 尺寸跟着形象走（拉姆比小女生小一圈） */
      const pw = pet.size.w;
      const startX = s.w - pw - 6;

      /* 从右边走进来 —— 走动比"凭空出现"更像活的 */
      pet.setPos(startX, pet.pos.groundY);

      const tx = Math.max(80, Math.round(s.w * 0.56));
      const dist = Math.abs(startX - tx);
      const walkMs = (dist / C.move.speed) * 1000;

      setTimeout(() => pet.walkTo(tx, 'idle'), 320);
      setTimeout(() => Scene.greet(info, firstVisit), 320 + walkMs + 200);
    },

    greet(info, firstVisit) {
      const st = Pet.state;
      if (st.deadAt) return;

      const off = info.offlineSec || 0;

      if (firstVisit) {
        Pet.pet.say('……你好。', { ms: 2600 });
        setTimeout(() => Pet.pet.say('我就住这儿了，行吗。', { ms: 3000 }), 3200);
        return;
      }

      if (off > 12 * 3600) {
        Pet.pet.say(`你有 ${U.humanGap(off * 1000)}没来了。`, { ms: 4200 });
        setTimeout(() => {
          if (st.deadAt) return;
          Pet.pet.say('我差点以为你不管我了。', { ms: 3600 });
        }, 4600);
        return;
      }

      if (off > 120) {
        Pet.pet.say(U.pick(C.lines.greet), { ms: 2600 });
        setTimeout(() => {
          if (Pet.state.deadAt) return;
          Pet.pet.say(`你走了 ${U.humanGap(off * 1000)}。`, { ms: 2600 });
        }, 3000);
        return;
      }

      /* 刷新页面这种几十秒的"离线"，就别说煽情的话了 */
      Pet.pet.say(U.pick(C.lines.greet), { ms: 2400 });
    },

    /** 开场之后的一小段"生活流"：走到某个图标旁边看一眼 */
    idleBeat() {
      if (!Pet.state || Pet.state.deadAt) return;
      if (Pet.fsm.state !== 'IDLE') return;
      const list = Pet.icons.list().filter(i => !i.gone);
      if (!list.length) return;
      const it = list[U.randInt(0, list.length - 1)];
      Pet.pet.walkTo(it.pos.x + 96, 'idle');
      setTimeout(() => {
        if (Pet.state.deadAt) return;
        Pet.pet.say(U.pickFresh(C.lines.idle, Pet.recentLines), { ms: 2600 });
      }, 1600);
    }
  };

  Pet.scene = Scene;
})(window);
