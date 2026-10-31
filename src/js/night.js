/* ============ night.js — 深夜提醒 / 抖屏 ============ */
(function (w) {
  const Pet = w.Pet;
  const U = Pet.util;
  const C = Pet.config;

  let lastActive = Date.now();
  let lastRemind = 0;
  let timer = null;
  let forced = false;

  function markActive() { lastActive = Date.now(); }

  function inWindow(d) {
    const m = d.getHours() * 60 + d.getMinutes();
    /* 跨零点：23:30 - 05:00，必须按分钟比较 */
    return C.night.startMin > C.night.endMin
      ? (m >= C.night.startMin || m < C.night.endMin)
      : (m >= C.night.startMin && m < C.night.endMin);
  }

  const Night = {
    start() {
      ['pointerdown', 'pointermove', 'keydown', 'wheel'].forEach(ev => {
        w.addEventListener(ev, markActive, { passive: true });
      });
      clearInterval(timer);
      timer = setInterval(Night.check, 20000);
    },

    check() {
      if (!Pet.state || Pet.state.deadAt) return;
      if (!forced && !inWindow(new Date())) return;
      if (document.hidden) return;
      if (Date.now() - lastActive > C.night.idleMinMs) return;   /* 人不在，别对着空气喊 */
      if (Date.now() - lastRemind < C.night.gapMs) return;

      lastRemind = Date.now();
      Pet.pet.say(U.pick(C.lines.night), {
        ms: 9000,
        acts: [
          { label: '我这就睡', primary: true, onClick: () => Night.tuckIn() },
          { label: '再看会儿', onClick: () => Pet.pet.say('那说好了，就一会儿。') }
        ]
      });
    },

    tuckIn() {
      Pet.pet.sleep();
      lastRemind = Date.now();
    },

    force(on) { forced = !!on; if (on) Night.check(); },

    get forced() { return forced; }
  };

  Pet.night = Night;
})(window);
