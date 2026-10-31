/* ============ bubble.js — 说话气泡 ============ */
(function (w) {
  const Pet = w.Pet;
  const U = Pet.util;

  let box, textEl, actsEl;
  let hideTimer = null, typeTimer = null, typing = false;
  let lastPlaceAt = 0;

  function init() {
    box = U.$('#bubble');
    textEl = U.$('#bubbleText');
    actsEl = U.$('#bubbleActs');
  }

  function place(rect) {
    if (!box || box.hidden) return;
    /* 每帧都量尺寸会强制重排，20fps 足够跟手 */
    const t = Date.now();
    if (t - lastPlaceAt < 50) return;
    lastPlaceAt = t;
    const pad = 10;
    const bw = box.offsetWidth;
    const bh = box.offsetHeight;
    const vw = w.innerWidth;
    const taskbarH = 44;

    let left = rect.cx - bw / 2;
    left = U.clamp(left, pad, vw - bw - pad);
    let top = rect.y - bh - 8;
    if (top < pad) top = rect.y + rect.h + 8;

    box.style.left = Math.round(left) + 'px';
    box.style.top = Math.round(top) + 'px';

    /* 气泡尾巴对准她的头 */
    box.classList.remove('is-above-left', 'is-above-right');
    const headX = rect.cx;
    if (headX < left + bw * 0.28) box.classList.add('is-above-left');
    else if (headX > left + bw * 0.72) box.classList.add('is-above-right');
    void taskbarH;
  }

  function clearActs() {
    if (actsEl) actsEl.innerHTML = '';
  }

  const Bubble = {
    init,
    place,

    /** 说一句话。opts: {ms, instant, acts:[{label, primary, danger, onClick}]} */
    say(text, opts = {}) {
      if (!box) init();
      if (!text) return;

      clearTimeout(hideTimer);
      clearTimeout(typeTimer);
      box.hidden = false;
      clearActs();

      const rect = Pet.pet ? Pet.pet.rect() : U.rectOf(U.$('#pet'));
      place(rect);

      if (opts.acts && opts.acts.length) {
        opts.acts.forEach(a => {
          const b = U.el('button', 'btn btn--sm' + (a.primary ? ' btn--primary' : '') + (a.danger ? ' btn--danger' : ''));
          b.textContent = a.label;
          b.addEventListener('click', ev => {
            ev.stopPropagation();
            Bubble.hide();
            a.onClick && a.onClick();
          });
          actsEl.appendChild(b);
        });
      }

      /* 打字机：一个字一个字蹦，比整句刷出来更"活" */
      const full = String(text);
      if (opts.instant) {
        textEl.textContent = full;
        this.done(full, opts);
        return;
      }
      textEl.textContent = '';
      typing = true;
      if (Pet.pet) Pet.pet.setTalking(true);
      let i = 0;
      const step = () => {
        i++;
        textEl.textContent = full.slice(0, i);
        place(Pet.pet ? Pet.pet.rect() : U.rectOf(U.$('#pet')));
        if (i < full.length) {
          typeTimer = setTimeout(step, 26);
        } else {
          this.done(full, opts);
        }
      };
      typeTimer = setTimeout(step, 40);
    },

    done(full, opts) {
      typing = false;
      if (Pet.pet) Pet.pet.setTalking(false);
      const hold = opts.ms || Math.max(2200, 1100 + full.length * 90);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => Bubble.hide(), hold);
    },

    hide() {
      clearTimeout(hideTimer);
      clearTimeout(typeTimer);
      typing = false;
      if (Pet.pet) Pet.pet.setTalking(false);
      if (box) box.hidden = true;
    },

    get visible() { return box && !box.hidden; },
    get typing() { return typing; }
  };

  Pet.bubble = Bubble;
})(window);
