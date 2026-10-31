/* ============ tools/start.js — npm start 的真正入口 ============
   为什么不在 package.json 里直接写 "electron ."：

   1) 本机进程环境常年挂着 ELECTRON_RUN_AS_NODE=1（WorkBuddy 自己就是 Electron
      应用带来的）。带这个变量启动 electron.exe，它会退化成纯 Node
      （打印 v24 而不是 v45），require('electron') 返回字符串而不是 API，
      于是 app 是 undefined，直接报 "Cannot read properties of undefined"。
      而且必须"真正从 env 里删掉"—— 置空字符串照样会触发（已实测）。
      Windows 上 npm 默认走 cmd.exe，没有 env -u 可用，所以只能在 JS 里 delete。

   2) --debug 不能原样传给 electron.exe：Node 早就删掉了这个开关，
      带上会以 "DEP0062: node --debug ... are invalid" 退出（exit 9，已实测）。
      所以这里把 --debug 翻译成 PET_DEBUG 环境变量，由 electron/main.js 读。

   用法：
     node tools/start.js              正常启动（开发版默认自带调试面板）
     node tools/start.js --debug      强制开调试面板
     node tools/start.js --no-debug   强制关调试面板
     node tools/start.js --shot       自检：启动 5 秒截一张图然后退出
   ================================================================ */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

/* 纯 Node 里 require('electron') 返回的就是 electron.exe 的路径字符串 */
function findElectron() {
  try {
    const p = require('electron');
    if (typeof p === 'string' && fs.existsSync(p)) return p;
  } catch (e) { /* electron 没装，或装坏了 */ }
  return null;
}

const electronBin = findElectron();
if (!electronBin) {
  console.error('找不到 electron 可执行文件（node_modules/electron/dist/electron.exe）。');
  console.error('请先在项目目录执行：npm install');
  process.exit(1);
}

/* 环境：复制一份，把 ELECTRON_RUN_AS_NODE 真正删掉（置空无效） */
const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;

/* 参数：--debug / --no-debug 翻译成 PET_DEBUG，其余原样透传给应用 */
let debug = env.PET_DEBUG;
const childArgs = [];
for (const a of process.argv.slice(2)) {
  if (a === '--debug' || a === '--debug=1') { debug = '1'; continue; }
  if (a === '--no-debug' || a === '--debug=0') { debug = '0'; continue; }
  childArgs.push(a);
}
if (debug !== undefined) env.PET_DEBUG = debug;

/* 自检走独立的 userData、「吃掉的食物」目录、**假桌面**和兜底桌面：
   - 用户很可能正开着 npm start，同一个 userData 会抢单实例锁，新实例会静默退出
   - 假桌面（PET_DESKTOP_DIR）：listIcons 扫的是它，测试全程不碰用户真实桌面
   - 兜底桌面也必须劫持，不然"原位置写不进去退到桌面"那条分支
     会在用户真实桌面上留下测试文件 */
if (childArgs.indexOf('--selftest') >= 0) {
  const tmp = require('os').tmpdir();
  if (!env.PET_USERDATA) env.PET_USERDATA = path.join(tmp, 'desktop-pet-selftest-userdata');
  if (!env.PET_FOOD_DIR) env.PET_FOOD_DIR = path.join(tmp, 'desktop-pet-selftest-food');
  if (!env.PET_DESKTOP_DIR) env.PET_DESKTOP_DIR = path.join(tmp, 'desktop-pet-selftest-desk');
  if (!env.PET_FALLBACK_DESKTOP) env.PET_FALLBACK_DESKTOP = path.join(tmp, 'desktop-pet-selftest-fallback');
}

/* 用绝对路径当应用目录 ≡ 在项目根目录跑 electron . */
const child = spawn(electronBin, [ROOT].concat(childArgs), {
  cwd: ROOT,
  env,
  stdio: 'inherit',
  windowsHide: false
});

child.on('error', (err) => {
  console.error('启动 Electron 失败：', err.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code == null ? 0 : code));
});

/* Ctrl+C 时把 electron 一起带走，别留孤儿进程在后台占着桌面 */
['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => {
    try { child.kill(); } catch (e) { /* 已经退出了 */ }
  });
});
