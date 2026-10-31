/* ============ fsm.js — 状态机（优先级 + 锁 + 最短驻留） ============ */
(function (w) {
  const Pet = w.Pet;

  /* 硬状态能打断别人；软状态互相排队 */
  const PRI = {
    HELD: 100,
    DEAD: 90,
    REVIVE: 80,
    EATING: 70,
    DISTURBED: 60,
    SLEEP: 50,
    SEEK: 40,
    WALK: 30,
    IDLE: 20,
    SLEEPY: 10
  };

  const CLASS = {
    HELD: 'is-held',
    DEAD: 'is-dead',
    REVIVE: 'is-weak',
    EATING: 'is-eating',
    DISTURBED: 'is-disturbed',
    SLEEP: 'is-sleeping',
    WALK: 'is-walking'
  };

  const DWELL = {
    IDLE: 1000,
    WALK: 1400,
    EATING: 0,
    DISTURBED: 0,
    SLEEP: 0
  };

  const FSM = {
    state: 'IDLE',
    lockUntil: 0,
    enteredAt: 0,
    _listeners: [],

    priority(s) { return PRI[s] || 0; },

    is(s) { return FSM.state === s; },

    locked(now) { return now < FSM.lockUntil; },

    lock(ms) { FSM.lockUntil = Date.now() + ms; },

    unlock() { FSM.lockUntil = 0; },

    onChange(fn) { FSM._listeners.push(fn); },

    /**
     * 唯一入口。返回是否真的切换了。
     * opts: {force, silent, reason}
     */
    set(next, opts = {}) {
      const now = Date.now();
      if (next === FSM.state) return false;

      if (!opts.force) {
        if (FSM.locked(now)) return false;
        const cur = PRI[FSM.state] || 0;
        const nxt = PRI[next] || 0;
        /* 优先级更高才能打断；同级别必须等最短驻留结束 */
        if (nxt <= cur && now - FSM.enteredAt < (DWELL[FSM.state] || 0)) return false;
        if (nxt < cur) return false;
      }

      const prev = FSM.state;
      FSM.state = next;
      FSM.enteredAt = now;
      if (!opts.silent) FSM.applyClass(next);
      FSM._listeners.forEach(fn => {
        try { fn(next, prev, opts.reason); } catch (e) { console.warn(e); }
      });
      return true;
    },

    applyClass(next) {
      const el = document.getElementById('pet');
      if (!el) return;
      Object.keys(CLASS).forEach(k => el.classList.remove(CLASS[k]));
      if (CLASS[next]) el.classList.add(CLASS[next]);
      el.dataset.state = next;
    },

    reset() {
      FSM.state = 'IDLE';
      FSM.lockUntil = 0;
      FSM.enteredAt = Date.now();
      FSM.applyClass('IDLE');
    }
  };

  Pet.fsm = FSM;
})(window);
