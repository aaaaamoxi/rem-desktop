/* ============ icons.js — 桌面版图标：只算位置，不画 DOM ============
   桌面版桌面上那些图标是 Windows 的 Explorer 画的，不在我们能操作的 DOM 里。
   我们只维护一份"图标在哪、是什么、有没有被吃掉"的清单，
   用来算"她该走到哪"和"她还剩几个能吃的"。

   真实图标长什么样由 Windows 负责，我们完全不管。
   ============================================================= */
(function (w) {
  const Pet = w.Pet;
  const U = Pet.util;

  /* 网格尺寸：贴近 Windows 的真实图标间距（100% 缩放约 75×96） */
  let CELL_W = 75;
  let CELL_H = 96;
  let PAD_X = 12;
  let PAD_Y = 10;

  let items = [];        /* [{id,label,glyph,kind,eatable,shortcut,pos}] */

  function cellPos(index) {
    /* 桌面版没有假任务栏，工作区高度就是窗口高度 */
    const deskH = w.innerHeight - PAD_Y * 2;
    const rows = Math.max(1, Math.floor(deskH / CELL_H));
    const col = Math.floor(index / rows);
    const row = index % rows;
    return { x: PAD_X + col * CELL_W, y: PAD_Y + row * CELL_H };
  }

  const Icons = {
    init(cbMouth, cbOpenWill) {
      /* 桌面版没有图标网格要渲染，但窗口尺寸变了要重排位置 */
      w.addEventListener('resize', U.throttle(() => Icons.layout(), 200));
    },

    /** 用图标列表重建清单 */
    render(list) {
      items = list.map((raw, i) => {
        const item = Object.assign({}, raw);
        item.slot = raw.slot != null ? raw.slot : i;
        item.pos = cellPos(item.slot);
        return item;
      });
    },

    layout() {
      items.forEach(item => {
        item.pos = cellPos(item.slot);
      });
    },

    /** 贴近 Windows 真实图标间距 */
    setCell(w2, h, padX, padY) {
      CELL_W = w2;
      CELL_H = h;
      if (padX != null) PAD_X = padX;
      if (padY != null) PAD_Y = padY;
      Icons.layout();
    },

    list() { return items; },

    byId(id) { return items.find(x => x.id === id); },

    /** 找离某个点最近的、可吃的图标 */
    nearest(point, excludeId) {
      let best = null, bestD = Infinity;
      items.forEach(it => {
        if (!it.eatable || it.gone || it.id === excludeId) return;
        const cx = it.pos.x + CELL_W / 2;
        const cy = it.pos.y + 44;
        const d = Math.hypot(cx - point.x, cy - point.y);
        if (d < bestD) { bestD = d; best = it; }
      });
      return best ? { item: best, dist: bestD, cx: best.pos.x + CELL_W / 2, cy: best.pos.y + CELL_H * 0.48 } : null;
    },

    /** 咬一口：文件已经被主进程移走了，这里只标记"这个没了" */
    async bite(item) {
      if (!item) return;
      item.gone = true;
    },

    /** 吐回：文件回到桌面了，重新加进清单 */
    async restore(record, index) {
      const pos = record.pos || cellPos(index);
      const item = Object.assign({}, record);
      item.pos = pos;
      item.gone = false;
      items.push(item);
      return item;
    },

    removeFromDom(id) {
      items = items.filter(x => x.id !== id);
    },

    addItem(record, index) {
      return Icons.restore(record, index);
    },

    cellPos
  };

  Pet.icons = Icons;
})(window);
