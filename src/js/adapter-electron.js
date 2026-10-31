/* ============ adapter-electron.js — 桌面版适配器 ============
   图标是真实桌面上的文件；"吃掉" = 真把文件移进桌面的「吃掉的食物」
   ========================================================= */
(function (w) {
  const Pet = w.Pet;

  Pet.adapters.electron = function (native) {
    return {
      loadState() {
        try { return native.loadState(); } catch (e) { return null; }
      },

      saveState(s) {
        try { native.saveState(s); } catch (e) {}
      },

      async listIcons() {
        let list = [];
        try { list = await native.listIcons(); } catch (e) { list = []; }
        return list.map((x, i) => Object.assign({}, x, {
          /* 没识别出图标的用通用纸页 */
          glyph: x.glyph || 'txt',
          eatable: true,
          order: i
        }));
      },

      async eatIcon(record) {
        try {
          const r = await native.eatIcon(record);
          return r || { ok: false, msg: '这个吃不下' };
        } catch (e) {
          return { ok: false, msg: '这个吃不下' };
        }
      },

      async returnIcon(record) {
        try {
          const r = await native.returnIcon(record);
          return r || { ok: false, msg: '还不了' };
        } catch (e) {
          return { ok: false, msg: '还不了' };
        }
      },

      /* 仓库里到底有哪些文件（以主进程为准，文件才是真的） */
      async foodList() {
        try {
          const l = await native.foodList();
          return Array.isArray(l) ? l : [];
        } catch (e) {
          return [];
        }
      },

      /* 吃货日志：主进程补上"这是哪个应用"再写进文件 */
      async logAppend(entry) {
        try { native.logAppend(entry); return true; } catch (e) { return false; }
      },

      async logRead(limit) {
        try {
          const l = await native.logRead(limit);
          return Array.isArray(l) ? l : [];
        } catch (e) {
          return [];
        }
      },

      /* 打开桌面上的「吃掉的食物」文件夹 */
      async openFood() {
        try { await native.foodOpen(); return true; } catch (e) { return false; }
      },

      screen() {
        const s = native.screen();
        /* 窗口就是工作区，任务栏已经被排除在外，所以 taskbar 记 0 */
        return { w: s.w, h: s.h, taskbar: 0 };
      },

      /* 拖进来的文件 → 真实路径（Electron 32+ 只能用 webUtils） */
      getPathForFile(file) {
        try { return native.getPathForFile(file); } catch (e) { return ''; }
      },

      /* 清空存档 = 让主进程删掉 userData/pet-state.json */
      async resetState() {
        try {
          return await native.resetState();
        } catch (e) {
          return { ok: false, msg: '重置失败' };
        }
      },

      /* 托盘菜单折叠/展开调试面板 */
      onTogglePanel(cb) {
        try { native.onTogglePanel(cb); } catch (e) {}
      },

      onResume(cb) {
        try { native.onResume(cb); } catch (e) {}
      },

      async writeWill(text) {
        try { return await native.writeWill(text); } catch (e) { return false; }
      }
    };
  };
})(window);
