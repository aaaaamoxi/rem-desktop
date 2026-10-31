/* ============ bridge.js — 桌面版的数据出入口 ============
   业务代码永远不直接碰 fs / ipc，只认这个接口。
   preload.js 通过 contextBridge 把 window.petBridge 注入进来，
   这里把它包一层，渲染层就只用 Pet.bridge 这一套接口。

   接口：
     loadState() / saveState(s)   持久化（userData/pet-state.json）
     listIcons()                  → Promise<[真实桌面图标]>
     eatIcon(record)              → Promise<{ok, msg?}>  真把文件移进「吃掉的食物」
     returnIcon(record)           → Promise<{ok, msg?, renamed?, fallback?}> 真把文件放回去
     foodList()                   → Promise<[吃掉的食物清单]>
     screen()                     → {w, h, taskbar}
     resetState()                 → Promise<{ok}> 清空存档
     onTogglePanel(cb)            托盘折叠/展开调试面板
     onResume(cb)                 唤醒/合盖回来
     writeWill(text)              → Promise<bool> 写遗书文件
     logAppend(entry) / logRead(limit)  吃货日志
     getPathForFile(file)         拖进来的文件对应的真实路径
     openFood()                   打开桌面上的「吃掉的食物」文件夹
   ================================================= */
(function (w) {
  const Pet = w.Pet;

  Pet.adapters = Pet.adapters || {};

  Pet.initBridge = function () {
    const native = w.petBridge;
    if (!native) {
      /* 没注入成功就别往下走 —— 少了接口会一路报错，不如早点说清楚 */
      console.error('[pet] 缺少 petBridge，preload 没加载？');
    }
    const b = Pet.adapters.electron(native);

    Pet.bridge = b;
    /* 桌面版的外观开关：窗口透明、假桌面不画 */
    document.documentElement.classList.add('is-desktop');
    return b;
  };
})(window);
