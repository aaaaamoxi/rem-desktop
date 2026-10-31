/* ============ tools/build.js — 打包成 NSIS 安装包 ============
   两步走：
     1) electron-packager 把源码解包成 dist4/雷姆桌宠-win32-x64
     2) electron-builder --prepackaged 拿这个目录做 NSIS 安装包

   为什么要分两步：electron-builder 自己解包时会在输出目录建
   win-unpacked.tmp 再改名，Windows 上偶尔会被占用/被清理规则拦下。
   先用 packager 解包、再喂给 builder，稳得多。

   用法：
     node tools/build.js            完整流程（解包 + NSIS）
     node tools/build.js --pack     只出绿色版文件夹
   ============================================================ */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PKG = path.join(ROOT, 'package.json');

/* 解包目录：electron-packager 输出的目录名固定是「应用名-platform-arch」。
   每次构建落到一个带时间戳的新目录 —— electron-packager 的 --overwrite
   会先删同名目录（有些环境不让删），而不用它的话目录已存在就静默沿用
   **旧内容**（这会让人以为改了代码没生效）。 */
const VERSION = require(PKG).version;
const STAMP = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const OUT = path.join(ROOT, 'dist');
const STAGE = path.join(ROOT, '_stage');        /* 待打包的干净源码 */
const BUILD_DIR = path.join(OUT, 'build-' + STAMP);
const UNPACKED = path.join(BUILD_DIR, '雷姆桌宠-win32-x64');
const NSIS_OUT = path.join(BUILD_DIR, 'nsis');

const onlyPack = process.argv.includes('--pack');

/* ---------- 环境变量：走国内镜像，github.com 在国内不通 ---------- */
const ENV = {
  ...process.env,
  ELECTRON_MIRROR: process.env.ELECTRON_MIRROR
    || 'https://registry.npmmirror.com/-/binary/electron/',
  ELECTRON_BUILDER_BINARIES_MIRROR: process.env.ELECTRON_BUILDER_BINARIES_MIRROR
    || 'https://registry.npmmirror.com/-/binary/electron-builder-binaries/',
  /* 没有代码签名证书就跳过签名，不然会卡住等证书 */
  CSC_IDENTITY_AUTO_DISCOVERY: 'false'
};

function run(cmd, args, opts = {}) {
  console.log('> ' + [cmd, ...args].join(' '));
  execFileSync(cmd, args, {
    cwd: ROOT,
    env: ENV,
    stdio: 'inherit',
    shell: true,
    ...opts
  });
}

/* ---------- 1. 准备干净的暂存目录 ----------
   只放运行必需的东西：index.html / src / assets / electron / package.json。
   打包产物、工具脚本、文档、美术源图一律不进。

   不删旧目录 —— 直接覆盖写入。有些环境（CI、沙箱）会拦下递归删除，
   覆盖同样能保证内容是最新的。 */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function stage() {
  console.log('\n[1/3] 准备暂存目录…');
  fs.mkdirSync(STAGE, { recursive: true });

  for (const d of ['src', 'assets', 'electron']) {
    copyDir(path.join(ROOT, d), path.join(STAGE, d));
  }
  for (const f of ['index.html', 'package.json']) {
    fs.copyFileSync(path.join(ROOT, f), path.join(STAGE, f));
  }

  /* 暂存目录里的 package.json 不该带 build 配置（那是给 builder 用的），
     也不该带 devDependencies —— 运行时不需要任何 npm 包 */
  const p = JSON.parse(fs.readFileSync(path.join(STAGE, 'package.json'), 'utf8'));
  delete p.devDependencies;
  delete p.build;
  p.scripts = {};
  fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify(p, null, 2));

  console.log('    暂存目录就绪：' + STAGE);
}

/* ---------- 2. 解包成绿色版文件夹 ---------- */
function unpack() {
  console.log('\n[2/3] 解包成免安装文件夹…');
  fs.mkdirSync(OUT, { recursive: true });

  run('npx', [
    '--no-install', 'electron-packager', STAGE, '雷姆桌宠',
    '--platform=win32', '--arch=x64',
    '--out=' + BUILD_DIR,
    /* 暂存目录里没有 node_modules，packager 猜不出 electron 版本，
       显式告诉它 —— 用的是本项目 devDependencies 里那个版本。 */
    '--electron-version=' + require(path.join(ROOT, 'node_modules', 'electron', 'package.json')).version,
    /* 不加 --overwrite：它会先删掉同名目录，有些环境不让删。
       输出路径带时间戳，本来也不会撞。 */
    '--asar',
    '--app-version=' + VERSION,
    '--icon=' + path.join(STAGE, 'assets', 'icon.ico'),
    '--prune=true'
  ]);
  console.log('    解包完成：' + UNPACKED);
}

/* ---------- 3. 做成 NSIS 安装包 ---------- */
function nsis() {
  console.log('\n[3/3] 生成 NSIS 安装包…');
  run('npx', [
    'electron-builder',
    /* --projectDir 指向本项目根，-c 显式给配置文件。
       不给的话会用 electron-builder 的默认配置：
       英文文件名、oneClick 安装、默认 Electron 图标。 */
    '--projectDir=' + ROOT,
    '-c', path.join(ROOT, 'electron-builder.yml'),
    '--prepackaged=' + UNPACKED,
    '--win', '--x64',
    '--publish', 'never',
    '--config.directories.output=' + NSIS_OUT
  ]);
}

/* ---------- 走起 ---------- */
try {
  stage();
  unpack();
  if (!onlyPack) {
    nsis();
    console.log('\n完成。安装包在：' + NSIS_OUT);
  } else {
    console.log('\n完成。绿色版在：' + UNPACKED);
  }
} catch (e) {
  console.error('\n打包失败：' + (e && e.message ? e.message : e));
  process.exit(1);
}
