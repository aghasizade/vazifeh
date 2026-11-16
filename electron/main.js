// Desktop app: a window onto the central server. The UI itself comes from the server, so every
// UI update reaches desktops by itself. The app stays in the tray so notifications keep coming.
import { app, BrowserWindow, Menu, nativeImage, shell, Tray } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const configPath = () => path.join(app.getPath('userData'), 'config.json');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return {}; }
}
function writeConfig(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

let win = null;
let tray = null;
let quitting = false;

app.setAppUserModelId('app.vazifeh');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    createWindow();
    createTray();
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { /* keep running in the tray */ });
}

function showWindow() {
  // The window can only be hidden by the user, but if it was ever destroyed the tray must still be able to bring it back.
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  reloadIfServerUpdated();
}

// The window lives in the tray for days, so the page it loaded can be older than the server. When the server reports
// a different version, reload: on opening the window, or every 20 minutes while it is hidden (never under the user's hands).
let loadedVersion = null;
async function reloadIfServerUpdated() {
  const { server } = readConfig();
  if (!server || !win || win.isDestroyed() || !win.webContents.getURL().startsWith(server)) return;
  const version = await serverVersion(server);
  if (!version || !loadedVersion || version === loadedVersion) return;
  loadedVersion = version;
  win.webContents.reloadIgnoringCache();
}
setInterval(() => { if (win && !win.isDestroyed() && !win.isVisible()) reloadIfServerUpdated(); }, 20 * 60 * 1000);

// Accepts "192.168.1.10:8090", "tasks.example.ir" or a full URL.
function normalize(text) {
  let value = String(text || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = `${/^[\d.]+(:\d+)?$/.test(value) || value.startsWith('localhost') ? 'http' : 'https'}://${value}`;
  return new URL(value).origin;
}

// The server's version, or null when it is not a Vazifeh server or does not answer.
async function serverVersion(origin) {
  try {
    const res = await fetch(`${origin}/api/public/info`, { signal: AbortSignal.timeout(6000) });
    const info = await res.json();
    return info?.app === 'vazifeh' ? String(info.version || '?') : null;
  } catch {
    return null;
  }
}

async function reachable(origin) {
  const version = await serverVersion(origin);
  if (version) loadedVersion = version;
  return Boolean(version);
}

async function openServer() {
  const { server } = readConfig();
  if (!server) {
    win.loadFile(path.join(here, 'setup.html'));
    return;
  }
  if (!await reachable(server)) {
    win.loadFile(path.join(here, 'setup.html'), { query: { server, offline: '1' } });
    return;
  }
  win.loadURL(server);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: '#f4f1ea',
    title: 'سامانه وظیفه',
    icon: path.join(here, 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(here, 'preload.cjs') }
  });
  win.setMenuBarVisibility(false);

  // The setup page asks for the server address through this tiny bridge.
  win.webContents.ipc.handle('setup:connect', async (event, text) => {
    let origin;
    try { origin = normalize(text); } catch { return { ok: false, error: 'آدرس معتبر نیست.' }; }
    if (!origin) return { ok: false, error: 'آدرس سرور را وارد کنید.' };
    if (!await reachable(origin)) return { ok: false, error: 'در این آدرس سرور سامانه وظایف پاسخ نداد. اتصال شبکه و آدرس را بررسی کنید.' };
    writeConfig({ ...readConfig(), server: origin });
    win.loadURL(origin);
    return { ok: true };
  });
  win.webContents.ipc.handle('setup:retry', () => openServer());
  win.webContents.ipc.on('window:show', showWindow);

  win.webContents.setWindowOpenHandler(({ url }) => {
    const { server } = readConfig();
    if (server && url.startsWith(server) && url.includes('/api/files/')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // The server went away (restart, network cut): show the reconnect page instead of a blank window.
  win.webContents.on('did-fail-load', (event, code, description, url, isMainFrame) => {
    if (isMainFrame && !url.startsWith('file:')) {
      win.loadFile(path.join(here, 'setup.html'), { query: { server: readConfig().server || '', offline: '1' } });
    }
  });

  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
    if (!readConfig().trayHintShown) {
      tray?.displayBalloon({ title: 'سامانه وظایف', content: 'برنامه در کنار ساعت ویندوز باز می‌ماند تا اعلان‌ها را دریافت کنید.', iconType: 'info' });
      writeConfig({ ...readConfig(), trayHintShown: true });
    }
  });

  openServer();
}

function createTray() {
  const image = nativeImage.createFromPath(path.join(here, 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(image);
  tray.setToolTip('سامانه وظیفه');
  const build = () => Menu.buildFromTemplate([
    { label: 'باز کردن سامانه', click: showWindow },
    { label: 'تغییر آدرس سرور', click: () => { showWindow(); win.loadFile(path.join(here, 'setup.html'), { query: { server: readConfig().server || '', change: '1' } }); } },
    {
      label: 'اجرا با روشن شدن ویندوز',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] })
    },
    { type: 'separator' },
    { label: 'خروج کامل', click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(build());
  tray.on('click', showWindow);
  if (process.argv.includes('--hidden')) win.hide();
}
