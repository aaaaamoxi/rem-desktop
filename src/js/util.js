/* ============ util.js — 小工具 ============ */
(function (w) {
  const Pet = w.Pet;

  const U = {
    now: () => Date.now(),

    rand(a, b) { return a + Math.random() * (b - a); },

    randInt(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },

    pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },

    /* 从台词池挑一句，尽量不和最近说过的一样 */
    pickFresh(arr, recent, keep = 5) {
      if (!arr || !arr.length) return '';
      if (arr.length === 1) return arr[0];
      let out = arr[0];
      for (let i = 0; i < 12; i++) {
        out = U.pick(arr);
        if (!recent || recent.indexOf(out) < 0) break;
      }
      if (recent) {
        recent.push(out);
        if (recent.length > keep) recent.shift();
      }
      return out;
    },

    clamp(v, a, b) { return v < a ? a : v > b ? b : v; },

    lerp(a, b, t) { return a + (b - a) * t; },

    $: (sel, root) => (root || document).querySelector(sel),

    el(tag, cls, html) {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (html != null) n.innerHTML = html;
      return n;
    },

    esc(s) {
      return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },

    /* localStorage 包一层，隐私模式下也别崩 */
    store: {
      get(k, def) {
        try {
          const raw = w.localStorage.getItem(k);
          return raw == null ? def : JSON.parse(raw);
        } catch (e) { return def; }
      },
      set(k, v) {
        try { w.localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
      },
      del(k) {
        try { w.localStorage.removeItem(k); } catch (e) {}
      }
    },

    throttle(fn, ms) {
      let last = 0, timer = null, lastArgs = null;
      return function (...args) {
        const t = Date.now();
        lastArgs = args;
        if (t - last >= ms) {
          last = t;
          fn.apply(this, args);
        } else if (!timer) {
          timer = setTimeout(() => {
            timer = null;
            last = Date.now();
            fn.apply(this, lastArgs);
          }, ms - (t - last));
        }
      };
    },

    fmtClock(d) {
      const p = n => String(n).padStart(2, '0');
      return `${p(d.getHours())}:${p(d.getMinutes())}`;
    },

    fmtDate(ts) {
      const d = new Date(ts);
      const p = n => String(n).padStart(2, '0');
      return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
    },

    /* 吃货日志用的完整时间戳：2026-10-31 11:47:23 */
    fmtStamp(ts) {
      const d = new Date(ts == null ? Date.now() : ts);
      const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
        `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    },

    /* 吃货日志的一行：时间 | 动作 | 吃了什么 | 应用 | 来自哪 */
    fmtLogLine(e) {
      return [
        this.fmtStamp(e.at),
        e.action || '吃掉',
        e.name || '',
        e.app ? ('应用：' + e.app) : '',
        e.from ? ('来自 ' + e.from) : ''
      ].filter(Boolean).join(' | ');
    },

    /* 把毫秒说成人话：3 天 4 小时 */
    humanGap(ms) {
      const h = Math.floor(ms / 3600000);
      if (h < 1) return `${Math.max(1, Math.floor(ms / 60000))} 分钟`;
      if (h < 24) return `${h} 小时`;
      const d = Math.floor(h / 24);
      const rh = h % 24;
      return rh ? `${d} 天 ${rh} 小时` : `${d} 天`;
    },

    rectOf(node) {
      const r = node.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    },

    toast(msg, ms = 1900) {
      const t = U.$('#toast');
      if (!t) return;
      t.textContent = msg;
      t.hidden = false;
      clearTimeout(U._toastTimer);
      U._toastTimer = setTimeout(() => { t.hidden = true; }, ms);
    }
  };

  Pet.util = U;
})(window);
