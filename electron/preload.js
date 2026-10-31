/* ============ electron/preload.js — 只暴露必要的接口 ============ */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('petBridge', {
  platform: 'electron',
  canTouchFiles: true,

  /* 从资源管理器拖进来的文件，取它的真实路径。
     Electron 32 起 File.path 被移除了，只能走 webUtils。 */
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch (e) { return ''; }
  },

  loadState: () => ipcRenderer.sendSync('state:load'),
  saveState: (s) => ipcRenderer.send('state:save', s),

  screen: () => ipcRenderer.sendSync('screen:get'),

  listIcons: () => ipcRenderer.invoke('icons:list'),
  foodList: () => ipcRenderer.invoke('food:list'),

  /* 吃货日志：写一行 / 读最近 N 行 */
  logAppend: (entry) => ipcRenderer.send('log:append', entry),
  logRead: (limit) => ipcRenderer.invoke('log:read', limit),

  /* 打开桌面上的「吃掉的食物」文件夹 */
  foodOpen: () => ipcRenderer.invoke('food:open'),
  eatIcon: (rec) => ipcRenderer.invoke('icon:eat', rec),
  returnIcon: (rec) => ipcRenderer.invoke('icon:return', rec),
  writeWill: (text) => ipcRenderer.invoke('will:write', text),

  reportHit: (rect) => ipcRenderer.send('click:report', rect),
  setClickThrough: () => {},

  /* 清空存档：桌面版的存档在 userData/pet-state.json，得让主进程删 */
  resetState: () => ipcRenderer.invoke('state:reset'),

  /* 托盘菜单折叠/展开调试面板 */
  onTogglePanel: (cb) => {
    ipcRenderer.on('debug:toggle-panel', () => cb());
  },

  onResume: (cb) => {
    ipcRenderer.on('power:resume', () => cb());
  }
});
