/* ============ electron/main.js — 桌面版外壳 ============
   全屏透明覆盖窗口 + 点击穿透 + 真桌面图标吃掉/吐回 + 托盘 + 开机自启
   ========================================================= */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

/* ============ 头号杀手：ELECTRON_RUN_AS_NODE ============
   某些环境（开发工具、CI、部分国产软件的启动器）会在全局环境里挂着
   ELECTRON_RUN_AS_NODE=1。这个变量会让 electron.exe 退化成**纯 Node 解释器**：
   它不再开窗口，而是把 main.js 当普通脚本跑。

   症状特别恶心：进程活着（任务管理器里能看到），但屏幕上什么也没有，
   用户只会觉得"双击没反应"。而且这变量是**从父进程继承的**，
   打包版也躲不掉 —— 我在这台机器上就撞上了。

   打包版的解法：检测到就**清掉这个变量，把自己重新拉起来**。
   （置空无效，必须从 env 里真正 delete —— 实测过。） */
if (process.env.ELECTRON_RUN_AS_NODE) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;   /* 置空照样会触发，必须真删 */

  try {
    const child = spawn(process.execPath, process.argv.slice(1), {
      env, detached: true, stdio: 'ignore'
    });
    child.unref();
    process.exit(0);
  } catch (e) {
    /* 拉不起来就至少给个提示文件 */
    const msg =
      '雷姆桌宠启动失败。\n\n' +
      '原因：环境变量 ELECTRON_RUN_AS_NODE 被设成了 ' +
      JSON.stringify(process.env.ELECTRON_RUN_AS_NODE) + '。\n' +
      '这个变量会让 Electron 退化成纯命令行模式，不开窗口。\n\n' +
      '解决办法：\n' +
      '1. 打开「系统属性 → 环境变量」，删掉 ELECTRON_RUN_AS_NODE 这一项；\n' +
      '   或者\n' +
      '2. 在 PowerShell 里先执行：\n' +
      '   Remove-Item Env:ELECTRON_RUN_AS_NODE\n' +
      '   然后再双击运行。\n\n' +
      '（这个变量通常不是你自己设的，是某个别的软件带进来的。）\n\n' +
      '自动重启也失败了：' + (e && e.message ? e.message : e);
    try {
      fs.writeFileSync(path.join(path.dirname(process.execPath), '启动失败-环境变量.txt'), msg, 'utf8');
    } catch (e2) { /* 写不了就算了 */ }
    try { console.error('[pet] ' + msg); } catch (e2) {}
    process.exit(1);
  }
}

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, shell, nativeImage, dialog } = require('electron');

/* ============ 启动诊断 ============
   打包版是 GUI 程序，没有终端，出错只能靠日志文件。
   这个函数必须在任何可能抛异常的代码之前就位 ——
   用户报"双击没反应"时，让他把这个文件发过来就能定位。

   写在两个地方（都失败就算了）：
     - exe 同级目录（打包后是安装目录，一眼能找到）
     - userData（装到 Program Files 时可能没写权限） */
function bootLog(line) {
  const text = new Date().toISOString() + ' ' + line + '\n';
  const targets = [];
  try { targets.push(path.join(path.dirname(process.execPath), '启动日志.log')); } catch (e) {}
  try { targets.push(path.join(app.getPath('userData'), '启动日志.log')); } catch (e) {}
  for (const t of targets) {
    try {
      fs.mkdirSync(path.dirname(t), { recursive: true });
      fs.appendFileSync(t, text, 'utf8');
      return;
    } catch (e) { /* 换下一个地方 */ }
  }
}
bootLog('main.js 已加载 | packaged=' + app.isPackaged +
        ' | argv=' + JSON.stringify(process.argv.slice(1)));

/* 有些显卡驱动下透明窗口会黑底/闪屏，设置 DESKTOP_PET_NO_GPU=1 可关硬件加速 */
if (process.env.DESKTOP_PET_NO_GPU === '1') app.disableHardwareAcceleration();

const ROOT = path.join(__dirname, '..');
const STATE_FILE = () => path.join(app.getPath('userData'), 'pet-state.json');

/* 启动期出错的话，GUI 程序没有终端可看，用户只会觉得"双击了没反应"。
   把错误写进数据文件夹里的 启动错误.log，用户至少能自己打开看看。 */
process.on('uncaughtException', (err) => {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.appendFileSync(
      path.join(app.getPath('userData'), '启动错误.log'),
      new Date().toISOString() + ' ' + (err && err.stack ? err.stack : String(err)) + '\n',
      'utf8'
    );
  } catch (e) { /* 连日志都写不了就算了 */ }
});
/* 食物仓库默认在桌面上，但自检要用独立目录（PET_FOOD_DIR），
   不然测试会真的动你桌面上的文件 */
/* 吃掉的东西放哪：桌面上一个叫「吃掉的食物」的文件夹。
   桌面上就这一个文件夹 —— 她吃掉的都进这儿，「吐回来」再放回原处。
   （早先是「桌宠的食物仓库」，后来说是 AppData 里的第二个目录，
     现在合并成桌面上这一个，用户一眼就能找到、也能自己打开。） */
const FOOD_DIR = () => process.env.PET_FOOD_DIR
  || path.join(app.getPath('desktop'), '吃掉的食物');
/* 自检用：把整个自检跑在假桌面上（listIcons 扫的就是它） */
const DESKTOP_DIR = () => process.env.PET_DESKTOP_DIR || app.getPath('desktop');
/* 原位置写不进去时的兜底目标（Public 桌面那种普通用户写不了的地方）。
   自检模式下劫持到临时目录，免得在用户真实桌面留文件。 */
const FALLBACK_DESKTOP = () => process.env.PET_FALLBACK_DESKTOP
  || app.getPath('desktop');
const MANIFEST = () => path.join(FOOD_DIR(), 'manifest.json');
const LOG_FILE = () => path.join(app.getPath('userData'), '吃货日志.txt');
const LOG_MAX = 2000;          /* 最多留这么多行，旧的截掉 */

/* ---------------- 三个小工具 ----------------
   文件名冲突时统一加 " (2)"（扩展名前插），跟 Windows 自己一个规矩。 */
function uniquePath(dir, fileName) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let cand = path.join(dir, fileName);
  let i = 2;
  while (fs.existsSync(cand)) {
    cand = path.join(dir, `${base} (${i})${ext}`);
    i++;
  }
  return cand;
}

/* 移动文件：rename 优先（同盘原子），失败退 copy + unlink */
function moveFile(src, dest) {
  try {
    fs.renameSync(src, dest);
    return true;
  } catch (e) {
    /* OneDrive 重定向 / 跨盘时 rename 会失败 */
    try {
      fs.copyFileSync(src, dest);
      try { fs.unlinkSync(src); } catch (e3) { /* 源删不掉就留着，不影响 */ }
      return true;
    } catch (e2) {
      return false;
    }
  }
}

/* 这个路径在食物仓库里吗（含仓库的子目录） */
function isInsideFoodDir(p) {
  if (!p) return false;
  const rel = path.relative(FOOD_DIR(), p);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/* ---------------- 一次性迁移 ----------------
 * 旧版把吃掉的��件放在桌面的「桌宠的食物仓库」，现在统一叫「吃掉的食物」。
 *
 * 必须在 createWindow() 之前跑完：渲染进程一开就会 listIcons + syncLocker，
 * 而 syncLocker 是**整体替换 + save()** —— 迁移没做完就等于读了空账本，
 * 旧账会被静默覆盖成空。更隐蔽的是 readManifest() 的僵尸过滤
 * （fs.existsSync(m.stored)）：文件搬走了但 stored 前缀没改，
 * 所有条目会被判成"文件已不存在" → 账本被清空。
 *
 * 所以这里必须原子完成：搬文件 + 改 stored 前缀 + 合并账本 + 删旧目录。
 *
 * 幂等判据 = "旧目录存在 && 里面有 manifest.json"：
 *   - 用户自己建个同名文件夹放东西 → 通常没有 manifest.json → 不认、不动、不删
 *   - 迁完旧目录被删 → 下次启动直接 return
 * 不写标记文件，免得 dev/打包版各写各的。
 */
function migrateFoodDir() {
  if (process.env.PET_FOOD_DIR) return;        /* 自检绝不动真实桌面 */
  const desk = app.getPath('desktop');
  const oldDir = path.join(desk, '桌宠的食物仓库');
  const newDir = path.join(desk, '吃掉的食物');
  if (!fs.existsSync(oldDir)) return;          /* 已迁过 / 没有 → 幂等 */

  const oldManifest = path.join(oldDir, 'manifest.json');
  if (!fs.existsSync(oldManifest)) return;    /* 不是我们建的 → 不碰 */

  let oldList = [];
  try {
    const a = JSON.parse(fs.readFileSync(oldManifest, 'utf8'));
    if (Array.isArray(a)) oldList = a;
  } catch (e) { oldList = []; }

  try { fs.mkdirSync(newDir, { recursive: true }); } catch (e) { /* 下面会报错 */ }

  /* 新目录可能已经有账本了（用户自己建过同名文件夹） */
  let newList = [];
  const newManifest = path.join(newDir, 'manifest.json');
  try {
    const a = JSON.parse(fs.readFileSync(newManifest, 'utf8'));
    if (Array.isArray(a)) newList = a;
  } catch (e) { newList = []; }

  /* --- 搬文件，记下 old→new 的真实落地路径 --- */
  const moved = new Map();
  try {
    for (const name of fs.readdirSync(oldDir)) {
      /* manifest.json 本身、以及 Explorer 备份出来的 manifest (2).json 都不算文件 */
      if (/^manifest( \(\d+\))?\.json$/i.test(name)) continue;
      const from = path.join(oldDir, name);
      try { if (!fs.statSync(from).isFile()) continue; } catch (e) { continue; }
      /* 同名已存在 → 加 " (2)"，绝不覆盖用户自己的文件 */
      const to = uniquePath(newDir, name);
      if (!moveFile(from, to)) continue;       /* 搬不动就留在原地，别删源 */
      moved.set(path.resolve(from), to);
    }
  } catch (e) { /* 目录读不了就只搬账本 */ }

  /* --- 改写 stored 前缀（只改 stored！id / dir 指向原处，动了就毁掉还原能力） --- */
  const oldAbs = path.resolve(oldDir) + path.sep;
  for (const m of oldList) {
    if (!m || !m.stored) continue;
    if (!path.resolve(m.stored).startsWith(oldAbs)) continue;
    const to = moved.get(path.resolve(m.stored));
    m.stored = to || path.join(newDir, path.basename(m.stored));
    /* dir 指向旧仓库的历史条目：它的"原处"已经没了，吐回时退到用户桌面 */
    if (m.dir && path.resolve(m.dir).startsWith(oldAbs)) m.dir = desk;
  }

  /* --- 合并两份账，按 id 去重；同 id 时留文件真实存在的那条 --- */
  const byId = new Map();
  for (const m of newList) if (m && m.id) byId.set(m.id, m);
  for (const m of oldList) {
    if (!m || !m.id) continue;
    const cur = byId.get(m.id);
    if (!cur) byId.set(m.id, m);
    else if ((cur.stored && !fs.existsSync(cur.stored)) &&
      m.stored && fs.existsSync(m.stored)) byId.set(m.id, m);
  }
  const merged = Array.from(byId.values())
    .filter(m => m && m.stored && fs.existsSync(m.stored));

  try {
    fs.writeFileSync(newManifest, JSON.stringify(merged, null, 2), 'utf8');
  } catch (e) {
    console.error('[migrate] 新账本写不进去', e);
  }

  /* --- 删旧目录 --- */
  try {
    fs.rmSync(oldDir, { recursive: true, force: true });
    console.log('[migrate] 桌宠的食物仓库 → 吃掉的食物，迁了', merged.length, '条账');
  } catch (e) {
    console.error('[migrate] 旧目录没删掉', e);
  }
}

/* ---------------- 开发版 / 打包版隔离 ----------------
 * 开发版（npm start）用独立的 userData：存档、Chromium 会话数据、单实例锁全部分开，
 * 于是"打包版正在跑"的时候也能同时起一个 npm start，互不干扰。
 *
 * 顺序是关键：单实例锁的服务端（Chromium 的 ProcessSingleton）创建时读的就是
 * chrome::DIR_USER_DATA，改晚了就还是抢同一把锁。
 * 另外 setPath 不会自动建目录，得自己先 mkdir。
 *
 * 打包版的 userData 也显式定成 ASCII 名（desktop-pet）：
 * Electron 默认拿 productName 当目录名，中文目录在某些系统上会有编码问题，
 * 而且老版本的存档就在 desktop-pet 里，换名等于把用户的记忆弄丢。
 */
{
  const devName = app.isPackaged
    ? 'desktop-pet'                       /* 打包版：固定 ASCII 名 */
    : (process.env.PET_USERDATA || 'desktop-pet-dev');   /* 开发版：可指定（自检用） */
  const userData = path.isAbsolute(devName)
    ? devName
    : path.join(app.getPath('appData'), devName);
  const session = path.join(userData, 'session');
  fs.mkdirSync(session, { recursive: true });
  app.setPath('userData', userData);
  app.setPath('sessionData', session);
}

/* ---------------- 调试面板开关 ----------------
 * 优先级：PET_DEBUG 环境变量 > --pet-debug / --no-pet-debug 命令行 > 默认。
 * 默认：开发版开、打包版关（!app.isPackaged）。
 * 为什么走环境变量而不是 --debug：Node 早已移除该开关，透传会让 electron.exe
 * 以 "DEP0062: node --debug ... are invalid" 退出（exit 9，已实测），
 * tools/start.js 负责把 --debug 翻译成 PET_DEBUG。
 */
function debugEnabled() {
  const env = process.env.PET_DEBUG;
  if (env === '1' || env === 'true') return true;
  if (env === '0' || env === 'false') return false;
  const argv = process.argv;
  if (argv.includes('--pet-debug') || argv.includes('--pet-debug=1')) return true;
  if (argv.includes('--no-pet-debug')) return false;
  if (argv.includes('--debug') || argv.includes('--debug=1')) return true;
  return !app.isPackaged;
}
const DEBUG = debugEnabled();

let win = null;
let tray = null;
let hitRects = [];          /* 渲染进程上报的"可点区域"列表（CSS px，相对窗口） */
let ignoring = true;
let pollTimer = null;

/* ---------------- 状态读写 ---------------- */
function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'));
  } catch (e) { return null; }
}

function writeState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE()), { recursive: true });
    fs.writeFileSync(STATE_FILE(), JSON.stringify(state), 'utf8');
    return true;
  } catch (e) { return false; }
}

/* ---------------- 桌面图标 ---------------- */
function desktopDirs() {
  /* 自检时用假桌面（PET_DESKTOP_DIR），真实运行时就是真桌面 + 公共桌面 */
  const list = [DESKTOP_DIR()];
  const pub = 'C:\\Users\\Public\\Desktop';
  if (!process.env.PET_DESKTOP_DIR && fs.existsSync(pub) &&
    path.resolve(pub) !== path.resolve(list[0])) list.push(pub);
  return list;
}

function guessGlyph(ext) {
  const map = {
    '.lnk': 'link', '.url': 'link', '.pdf': 'pdf', '.doc': 'doc', '.docx': 'doc',
    '.xls': 'sheet', '.xlsx': 'sheet', '.csv': 'sheet',
    '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image',
    '.zip': 'zip', '.rar': 'zip', '.7z': 'zip',
    '.txt': 'txt', '.md': 'txt', '.exe': 'game'
  };
  return map[ext] || 'txt';
}

async function listIcons() {
  const out = [];
  for (const dir of desktopDirs()) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) { continue; }

    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const name = ent.name;
      if (name === 'desktop.ini' || name.startsWith('.')) continue;
      /* 「吃掉的食物」这个文件夹本身不算图标（文件本来就不在桌面上了） */
      if (name === '吃掉的食物') continue;

      const ext = path.extname(name).toLowerCase();
      const full = path.join(dir, name);
      let icon = null;
      try {
        icon = await app.getFileIcon(full, { size: 'large' });
      } catch (e) { icon = null; }

      out.push({
        id: full,
        label: path.basename(name, ext) || name,
        glyph: guessGlyph(ext),
        ext,
        kind: ext === '.lnk' || ext === '.url' ? 'lnk' : 'file',
        shortcut: ext === '.lnk' || ext === '.url',
        eatable: true,
        dir,
        fileName: name,
        iconData: icon ? icon.toDataURL() : null
      });
      if (out.length >= 60) break;
    }
    if (out.length >= 60) break;
  }

  return out;
}

function readManifest() {
  try {
    const list = JSON.parse(fs.readFileSync(MANIFEST(), 'utf8'));
    if (!Array.isArray(list)) return [];
    /* 清掉指向已不存在文件的脏条目（文件被手动删过、出过意外）。
       不清的话仓库里会攒下一堆"吐不回来"的僵尸条目。 */
    return list.filter(m => m && m.stored && fs.existsSync(m.stored));
  } catch (e) { return []; }
}

function writeManifest(list) {
  try {
    fs.mkdirSync(FOOD_DIR(), { recursive: true });
    fs.writeFileSync(MANIFEST(), JSON.stringify(list, null, 2), 'utf8');
    return true;
  } catch (e) { return false; }
}

/* 吃掉：她只吃桌面上的文件，吃掉的移进桌面上的「吃掉的食物」。
   原位置（原目录 + 原名）记在账本里，「吐回来」按它放回去。 */
function eatIcon(record) {
  const src = record && record.id;
  const name = src ? path.basename(src) : '';
  if (!src || !fs.existsSync(src)) {
    appendLog({ action: '吃不下', name, note: '文件已经不在原来的位置了' });
    return { ok: false, code: 'GONE', msg: '这个已经不见了' };
  }

  /* 「吃掉的食物」里的东西她不吃 —— 那个文件夹是她的存放处，不是食物来源。
     用户手动把里面的文件拖给她时会被这里挡下。 */
  if (isInsideFoodDir(src)) {
    appendLog({ action: '吃不下', name, note: '已经在「吃掉的食物」里了' });
    return { ok: false, code: 'IN_FOOD', msg: '这个已经在「吃掉的食物」里了' };
  }

  /* 她只吃文件，不吃文件夹（用户可能把「吃掉的食物」整个拖给她） */
  try {
    if (!fs.statSync(src).isFile()) {
      appendLog({ action: '吃不下', name, note: '这是个文件夹' });
      return { ok: false, code: 'NOT_FILE', msg: '这个吃不下' };
    }
  } catch (e) { /* 读不到就当文件处理，后面 moveFile 会失败 */ }

  try {
    fs.mkdirSync(FOOD_DIR(), { recursive: true });
  } catch (e) {
    appendLog({ action: '吃不下', name, note: '建不了吃掉的食物文件夹' });
    return { ok: false, code: 'NO_DIR', msg: '建不了吃掉的食物文件夹' };
  }

  return eatDesktopFile(src, record, name);
}

/* 桌面文件 → 食物仓库 */
function eatDesktopFile(src, record, name) {
  const stamp = Date.now();
  const plain = path.basename(src).replace(/^\d+_/, '');
  const dest = path.join(FOOD_DIR(), `${stamp}_${plain}`);

  if (!moveFile(src, dest)) {
    appendLog({ action: '吃不下', name, note: '移不进食物仓库' });
    return { ok: false, code: 'MOVE_FAILED', msg: '这个吃不下' };
  }

  const manifest = readManifest();
  /* 这份文件之前被吃过一次的话，账上那条记录里的 id / dir / fileName
     才是它**原本**在哪儿、叫什么 —— 吐回时得按那个来，
     所以这里只更新它在仓库里的路径，别把原位置弄丢了。
     （原来只比 m.stored，那是死代码：stored 恒为仓库路径，
       永远匹配不上桌面上的路径） */
  const prior = manifest.find(m => m.id === src || m.stored === src);
  if (prior) {
    prior.stored = dest;
    prior.eatenAt = stamp;
  } else {
    manifest.push({
      id: src,
      fileName: path.basename(src),
      dir: record.dir || path.dirname(src),
      label: record.label,
      glyph: record.glyph,
      shortcut: !!record.shortcut,
      pos: record.pos || null,
      eatenAt: stamp,
      stored: dest
    });
  }
  writeManifest(manifest);
  appendLog({
    action: '吃掉', name,
    app: appNameOf(src, record.shortcut),
    from: record.dir || path.dirname(src),
    into: dest
  });
  return { ok: true, stored: dest, id: src };
}

/* 吐回 = 放回它原来的位置、原来的名字
 *
 * 目标位置：entry.dir —— 她吃掉前那个文件的所在目录（桌面，或用户从别处
 * 拖给她的那个目录）。写不进去就退到 FALLBACK_DESKTOP()（Public 桌面那种
 * 普通用户写不了的地方）。
 */

/* 吐回 = 放回它原来的位置、原来的名字
 *
 * 目标位置就是 entry.dir —— 她吃掉前那个文件的所在目录（桌面，
 * 或者用户从别处拖给她的那个目录）。
 *
 * 另外：原位置写不进去就退到用户自己的桌面。因为 C:\Users\Public\Desktop
 * 这种"所有用户桌面"允许把文件移走（吃掉就是这么干的），
 * 但普通用户往里写会被系统拒了（EPERM），原样放回去根本做不到。
 * 退到自己的桌面效果一样：Windows 桌面本来就是两个目录合并显示的。
 */
function returnIcon(record) {
  const manifest = readManifest();
  const key = record && (record.id || record.origId);
  const label = (record && record.label) || (key ? path.basename(key) : '');

  /* 按 id 找（原始路径）或按 stored 找（它现在实际所在的位置） */
  let entry = manifest.find(m => m.id === key || m.stored === key);
  if (!entry && key) {
    /* 兼容：从渲染层直接传过来的记录 */
    entry = manifest.find(m => String(m.id || '').indexOf(path.basename(key)) >= 0);
  }

  /* 账本里没有也别急着放弃 —— 也许用户手动改过文件夹里文件的名字。
     按名字找找，找到就当它。 */
  if (!entry) {
    const base = key ? path.basename(key).replace(/^\d+_/, '') : '';
    if (base) {
      try {
        const hit = fs.readdirSync(FOOD_DIR()).find(f => f.replace(/^\d+_/, '') === base);
        if (hit) {
          entry = {
            id: path.join(FOOD_DIR(), hit),
            fileName: base,
            /* 原处查不到了 → 目标退到用户桌面。
               绝不能填 FOOD_DIR()：那就是文件**现在**的位置，
               目标==当前位置 → uniquePath 把它变成 "xxx (2)" 的副本，
               用户原地多出一份文件（雪球 bug 的同款坑）。 */
            dir: (record && record.dir) || FALLBACK_DESKTOP(),
            stored: path.join(FOOD_DIR(), hit)
          };
          appendLog({ action: '还不了', name: base, note: '账本里没有这条记录，按文件名找到了，原始位置不明' });
        }
      } catch (e) { /* 目录读不了就算了 */ }
    }
  }

  if (!entry) {
    appendLog({ action: '还不了', name: label, note: '找不到它的记录' });
    return { ok: false, code: 'NOT_FOUND', msg: '找不到它的记录' };
  }
  if (!fs.existsSync(entry.stored)) {
    appendLog({ action: '还不了', name: entry.fileName || label, note: '文件已经不在「吃掉的食物」里了' });
    return { ok: false, code: 'GONE', msg: '文件已经不在了' };
  }

  /* 目标目录 = 原始位置。dir 的语义就是"她吃掉前文件在哪"，
     不按 stored 判断（stored 是"现在在哪"）。 */
  const targetDir = entry.dir || FALLBACK_DESKTOP();
  const targetName = entry.fileName || path.basename(entry.stored);

  const dirs = [];
  if (targetDir) dirs.push(targetDir);
  const own = FALLBACK_DESKTOP();
  if (own && dirs.indexOf(own) < 0) dirs.push(own);

  let lastErr = null;
  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;

    /* 那儿已经有同名文件了 —— 绝不覆盖用户的，换个名字放 */
    const target = uniquePath(dir, targetName);
    const renamed = path.basename(target) !== targetName;

    if (!moveFile(entry.stored, target)) {
      lastErr = { code: 'MOVE_FAILED', message: '移动失败' };
      continue;
    }

    /* 成功：她不再"持有"这个文件了 → 账上销掉 */
    writeManifest(manifest.filter(m => m !== entry));
    appendLog({
      action: '吐回',
      name: targetName, to: target,
      note: renamed ? '原位置有同名，改了名字'
        : (dir !== targetDir ? '原位置写不进去，放到你的桌面上了' : '')
    });
    return {
      ok: true, target, renamed,
      fallback: dir !== targetDir
    };
  }

  appendLog({
    action: '还不了', name: targetName,
    note: '放不回去：' + ((lastErr && (lastErr.code || lastErr.message)) || '未知错误')
  });
  return {
    ok: false,
    code: (lastErr && lastErr.code) || 'UNKNOWN',
    msg: '还不了：' + ((lastErr && (lastErr.code || lastErr.message)) || '未知错误')
  };
}

/* ---------------- 吃货日志 ----------------
   记下她什么时候吃了什么、那是哪个应用、原本放在哪。
   放在 userData 下，用记事本就能打开看。
   --------------------------------------------------- */
function fmtTime(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* 这个图标到底是哪个应用？
   .lnk 交给 Electron 自带的 shell.readShortcutLink 读目标，
   不用自己解析 .lnk 二进制。非快捷方式就用文件名去掉扩展名。 */
function appNameOf(fullPath, isShortcut) {
  const fallback = path.basename(fullPath || '').replace(/\.[^.]+$/, '');
  if (!fullPath) return '';
  if (isShortcut) {
    try {
      const lnk = shell.readShortcutLink(fullPath);
      if (lnk && lnk.target) {
        const t = path.basename(lnk.target).replace(/\.(exe|cmd|bat|com|scr)$/i, '');
        if (t) return t;
      }
    } catch (e) { /* 不是有效的快捷方式就算了 */ }
  }
  return fallback;
}

function appendLog(entry) {
  const parts = [
    fmtTime(entry.at || Date.now()),
    entry.action || '吃掉',
    entry.name || ''
  ];
  if (entry.app) parts.push('应用：' + entry.app);
  if (entry.from) parts.push('来自 ' + entry.from);
  if (entry.into) parts.push('进了 ' + entry.into);
  if (entry.to) parts.push('放回 ' + entry.to);
  if (entry.note) parts.push(entry.note);
  const line = parts.filter(Boolean).join(' | ');
  try {
    fs.mkdirSync(path.dirname(LOG_FILE()), { recursive: true });
    fs.appendFileSync(LOG_FILE(), line + '\n', 'utf8');
    trimLog();
    return true;
  } catch (e) { return false; }
}

/* 日志别无限涨 */
function trimLog() {
  try {
    const txt = fs.readFileSync(LOG_FILE(), 'utf8');
    const lines = txt.split('\n');
    if (lines.length <= LOG_MAX) return;
    fs.writeFileSync(LOG_FILE(), lines.slice(lines.length - LOG_MAX).join('\n'), 'utf8');
  } catch (e) { /* 读不了就下次再说 */ }
}

function readLog(limit) {
  try {
    const txt = fs.readFileSync(LOG_FILE(), 'utf8');
    const lines = txt.split('\n').filter(Boolean);
    return lines.slice(-(limit || 100)).reverse();   /* 最近的排在前面 */
  } catch (e) { return []; }
}

/* ---------------- 窗口 ---------------- */
function createWindow() {
  const primary = screen.getPrimaryDisplay();
  const area = primary.workArea;

  win = new BrowserWindow({
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  /* 调试面板是靠 URL 上的 ?debug=1 打开的（渲染层 debug.js 看 location.search）。
     loadFile 的 search 会被拼成 file:///…/index.html?debug=1 */
  win.loadFile(path.join(ROOT, 'index.html'), DEBUG ? { search: '?debug=1' } : undefined);

  /* 渲染进程的报错要能看到，否则出问题只能靠猜 */
  win.webContents.on('console-message', (e, level, message) => {
    const msg = (e && e.message) || message;
    const lvl = (e && typeof e.level === 'number') ? e.level : level;
    if (lvl >= 2 || process.env.PET_LOG === '1') console.log('[render]', msg);
  });
  win.webContents.on('render-process-gone', (e, d) => {
    console.error('[render gone]', d && d.reason);
  });

  win.once('ready-to-show', () => {
    /* 不抢焦点：开机自启时也不能把用户的输入法踢掉 */
    win.showInactive();
    win.setIgnoreMouseEvents(true, { forward: true });
    ignoring = true;
    startHitPolling();

    /* 开发自检：electron . --shot 5 秒后截一张图然后退出 */
    if (process.argv.includes('--shot')) {
      setTimeout(async () => {
        /* 顺便把"哪些区域会接管鼠标"打出来：调试面板、角色、气泡、菜单各占各的，
           看这一行就知道面板的按钮到底能不能点到 */
        console.log('[pet] hitRects', JSON.stringify(hitRects));
        try {
          const img = await win.webContents.capturePage();
          /* 打包后 app 在 asar 里，不能往里面写，落到当前目录 */
          const out = app.isPackaged
            ? path.join(process.cwd(), '_shots', 'electron.png')
            : path.join(ROOT, '_shots', 'electron.png');
          fs.mkdirSync(path.dirname(out), { recursive: true });
          fs.writeFileSync(out, img.toPNG());
          console.log('shot ->', out);
        } catch (e) { console.error('shot failed', e); }
        app.exit(0);
      }, 5000);
    }

    /* 开发自检：验证调试面板的按钮真的能点、「重置全部」真的清档 */
    if (process.argv.includes('--selftest')) {
      setTimeout(async () => {
        try {
          /* tools/ 在打包时被排除，打包版带这个参数也只会走到 catch */
          await require(path.join(ROOT, 'tools', 'selftest.js'))(win, {
            STATE_FILE, ROOT,
            userDesktop: app.getPath('desktop'),
            getHitRects: () => hitRects
          });
        } catch (e) {
          console.error('[selftest] failed', e);
        }
        app.exit(0);
      }, 3000);
    }
  });

  win.on('closed', () => { win = null; });
}

/* 主进程轮询光标位置，比 forward 转发更可靠 */
function startHitPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const pt = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const x = pt.x - b.x;
    const y = pt.y - b.y;

    /* 任一矩形命中就算命中。角色、气泡、右键菜单、调试面板各占各的 ——
       合并成一个矩形的话，角色和左下角的面板之间那整片桌面都会被吃掉，
       桌面图标就全点不到了。 */
    let inside = false;
    for (const r of hitRects) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) { inside = true; break; }
    }

    if (inside && ignoring) {
      win.setIgnoreMouseEvents(false);
      ignoring = false;
    } else if (!inside && !ignoring) {
      win.setIgnoreMouseEvents(true, { forward: true });
      ignoring = true;
    }
  }, 33);
}

/* ---------------- 开机自启（写用户启动文件夹，免管理员） ---------------- */
function startupLnk() {
  return path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', '小家伙.lnk');
}

function getAutostart() {
  try { return fs.existsSync(startupLnk()); } catch (e) { return false; }
}

function setAutostart(on) {
  if (!app.isPackaged) return false;  /* 开发期的 execPath 是 electron.exe，写了也是坏的 */
  try {
    if (on) {
      shell.writeShortcutLink(startupLnk(), 'create', {
        target: process.execPath,
        cwd: path.dirname(process.execPath),
        description: '桌面宠物 小家伙'
      });
    } else if (fs.existsSync(startupLnk())) {
      fs.unlinkSync(startupLnk());
    }
    return getAutostart();
  } catch (e) { return getAutostart(); }
}

/* ---------------- 托盘 ---------------- */
function buildTray() {
  const iconPath = path.join(ROOT, 'assets', 'icon.png');
  let img = nativeImage.createFromPath(iconPath);
  if (img.isEmpty()) img = nativeImage.createEmpty();

  tray = new Tray(img);
  tray.setToolTip('小家伙 · ' + app.getPath('userData'));

  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏', click: () => { if (win) win.isVisible() ? win.hide() : win.showInactive(); } },
    { label: '打开吃掉的食物', click: () => { fs.mkdirSync(FOOD_DIR(), { recursive: true }); shell.openPath(FOOD_DIR()); } },
    { type: 'separator' },
    {
      label: '开机自动出现',
      type: 'checkbox',
      checked: getAutostart(),
      click: (item) => {
        const ok = setAutostart(item.checked);
        item.checked = ok;
        if (!ok && app.isPackaged) dialog.showMessageBox({ message: '设置失败，可以手动把快捷方式放进启动文件夹。' });
      }
    },
    { label: '打开数据文件夹：' + app.getPath('userData'), click: () => shell.openPath(app.getPath('userData')) },
    { label: '打开吃货日志', click: () => {
      /* 日志还没有就先建一个空的，免得点了没反应 */
      try { if (!fs.existsSync(LOG_FILE())) fs.writeFileSync(LOG_FILE(), '', 'utf8'); } catch (e) {}
      shell.openPath(LOG_FILE());
    } },
    { type: 'separator' },
    /* —— 改参数后不用重启整个应用，托盘点一下就重载 —— */
    { label: '重新加载', click: () => { if (win) win.webContents.reload(); } },
    { label: '开发者工具', click: () => { if (win) win.webContents.openDevTools({ mode: 'detach' }); } },
    { label: '调试面板 显示/隐藏', click: () => { if (win) win.webContents.send('debug:toggle-panel'); } },
    { type: 'separator' },
    { label: '退出', click: () => { app.exit(0); } }
  ]);

  tray.setContextMenu(menu);
  tray.on('click', () => { if (win) win.isVisible() ? win.hide() : win.showInactive(); });
}

/* ---------------- IPC ---------------- */
ipcMain.on('state:load', (e) => { e.returnValue = readState(); });
ipcMain.on('state:save', (e, s) => { writeState(s); });
ipcMain.on('screen:get', (e) => {
  const a = screen.getPrimaryDisplay().workArea;
  e.returnValue = { w: a.width, h: a.height, taskbar: 0 };
});
ipcMain.on('click:report', (e, rects) => {
  hitRects = Array.isArray(rects) ? rects : (rects ? [rects] : []);
});

ipcMain.handle('icons:list', async () => listIcons());
ipcMain.handle('food:list', async () => readManifest());
ipcMain.handle('log:read', async (e, limit) => readLog(limit));
ipcMain.handle('food:open', async () => {
  try {
    fs.mkdirSync(FOOD_DIR(), { recursive: true });
    shell.openPath(FOOD_DIR());
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: String((e && e.message) || e) };
  }
});
/* 渲染层只知道"吃了哪个文件"，"那是哪个应用"得主进程读 .lnk 才知道 */
ipcMain.on('log:append', (e, entry) => {
  const en = entry || {};
  const full = en.from && en.name ? path.join(en.from, en.name) : null;
  const isLnk = /\.lnk$/i.test(en.name || '');
  appendLog(Object.assign({}, en, {
    app: full ? appNameOf(full, isLnk) : (en.app || '')
  }));
});
ipcMain.handle('icon:eat', async (e, rec) => eatIcon(rec));
ipcMain.handle('icon:return', async (e, rec) => returnIcon(rec));
ipcMain.handle('will:write', async (e, text) => {
  try {
    const p = path.join(app.getPath('desktop'), '遗书.txt');
    fs.writeFileSync(p, text, 'utf8');
    return true;
  } catch (err) { return false; }
});
ipcMain.handle('state:reset', async () => {
  try {
    /* 重置 = 她什么都不记得了。
       但「吐回来」是唯一的还原动作 —— 直接清账本的话，那些被吃掉的文件
       就再也回不到你桌面上了。所以先把它们按账本放回原处，再清账。 */
    const manifest = readManifest();
    for (const m of manifest.slice()) {
      try { returnIcon(m); } catch (e) { /* 单个失败不影响其它 */ }
    }
    fs.rmSync(STATE_FILE(), { force: true });
    /* 账本也要清，不然重启后 syncLocker 会把旧条目全拉回来 */
    try { fs.writeFileSync(MANIFEST(), '[]', 'utf8'); } catch (e) { /* 忽略 */ }
    return { ok: true };
  } catch (err) {
    return { ok: false, msg: String((err && err.message) || err) };
  }
});

/* ---------------- 启动 ---------------- */
const gotLock = app.requestSingleInstanceLock();
bootLog('单实例锁 ' + (gotLock ? '拿到了' : '没拿到（已有实例在跑）'));
if (!gotLock) {
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (win) win.showInactive();
  });

  app.whenReady().then(() => {
    /* 这行是排查问题的第一手信息：版本 / 是不是打包版 / 存档在哪 / 调试面板开没开 */
    console.log('[pet] electron', process.versions.electron,
      '| packaged', app.isPackaged,
      '| userData', app.getPath('userData'),
      '| debug', DEBUG);
    bootLog('窗口准备就绪 | userData=' + app.getPath('userData'));

    /* 旧版「桌宠的食物仓库」→「吃掉的食物」的一次性迁移。
       必须在 createWindow() 之前：渲染进程一开就会 listIcons + syncLocker，
       那两步会读 FOOD_DIR()/manifest.json —— 迁移没做完就等于读了空账本，
       而 syncLocker 是整体替换 + save()，会把旧账覆盖成空。 */
    try { migrateFoodDir(); } catch (e) { console.error('[migrate] 失败', e); }

    /* 自检：先往（测试用）「吃掉的食物」里放一个文件 ——
       它正是"她不该吃的东西"的测试素材。必须在建窗口之前 ——
       窗口一开就会扫一遍桌面图标。
       PET_FOOD_DIR 只在自检模式下才有，双重保险，绝不会清到用户真实的东西。 */
    if (process.argv.includes('--selftest') && process.env.PET_FOOD_DIR) {
      try {
        fs.rmSync(FOOD_DIR(), { recursive: true, force: true });
        fs.mkdirSync(FOOD_DIR(), { recursive: true });
        fs.writeFileSync(path.join(FOOD_DIR(), '1234_测试图标.txt'), 'test', 'utf8');
        /* 日志也要清：上一轮的记录会留着，断言"日志里不该有『消化』"就假失败 */
        try { fs.rmSync(LOG_FILE(), { force: true }); } catch (e2) { /* 忽略 */ }
      } catch (e) { /* 放不了就算了，测试会跳过这项 */ }
    }

    createWindow();
    buildTray();

    /* 合盖休眠比关机常见得多，醒来必须重算离线 */
    require('electron').powerMonitor.on('resume', () => {
      if (win && !win.isDestroyed()) win.webContents.send('power:resume');
    });
    require('electron').powerMonitor.on('unlock-screen', () => {
      if (win && !win.isDestroyed()) win.webContents.send('power:resume');
    });
  }).catch((err) => {
    /* 打包版没有终端，崩了用户只看到"双击没反应"。
       把错误写进日志，用户把文件发过来就能定位。 */
    bootLog('启动失败：' + (err && err.stack ? err.stack : String(err)));
    console.error('[pet] 启动失败', err);
  });

  app.on('window-all-closed', () => { /* 常驻，不退出 */ });
  app.on('before-quit', () => { clearInterval(pollTimer); });
}
