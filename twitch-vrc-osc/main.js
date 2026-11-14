const { app, BrowserWindow, ipcMain, shell } = require('electron');
const dgram = require('dgram');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const vrchat = require('./vrchat');

const sock = dgram.createSocket('udp4');

// --- Codificación OSC mínima (string / int / float / bool) ---
const pad = (buf) => Buffer.concat([buf, Buffer.alloc(4 - (buf.length % 4))]);

function encode(address, type, value) {
  let tag;
  let data = Buffer.alloc(0);
  if (type === 'bool') tag = value ? 'T' : 'F';
  else if (type === 'int') { tag = 'i'; data = Buffer.alloc(4); data.writeInt32BE(Math.trunc(Number(value))); }
  else if (type === 'float') { tag = 'f'; data = Buffer.alloc(4); data.writeFloatBE(Number(value)); }
  else { tag = 's'; data = pad(Buffer.from(String(value))); }
  return Buffer.concat([pad(Buffer.from(address)), pad(Buffer.from(',' + tag)), data]);
}

ipcMain.handle('osc', (_, { host, port, address, type, value }) =>
  new Promise((resolve) => {
    sock.send(encode(address, type, value), port, host, (err) => resolve(err ? String(err) : null));
  })
);

// Las peticiones HTTP a Twitch se hacen desde aquí para evitar problemas de CORS
ipcMain.handle('http', async (_, url, opts = {}) => {
  try {
    const r = await fetch(url, opts);
    let data = {};
    try { data = await r.json(); } catch {}
    return { status: r.status, data };
  } catch (e) {
    return { status: 0, data: { message: String(e) } };
  }
});

ipcMain.handle('open', (_, url) => {
  if (/^https:\/\/(www\.)?twitch\.tv\//.test(url)) shell.openExternal(url);
});

vrchat.register(ipcMain);
ipcMain.handle('version', () => app.getVersion());
ipcMain.handle('update:install', () => autoUpdater.quitAndInstall());

function setupUpdater(win) {
  const send = (s) => win.webContents.send('update', s);
  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', (i) => send({ state: 'available', version: i.version }));
  autoUpdater.on('update-not-available', () => send({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => send({ state: 'ready', version: i.version }));
  autoUpdater.on('error', () => send({ state: 'error' }));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 4 * 60 * 60 * 1000);
}

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 820,
    height: 780,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  win.loadFile('index.html');
  if (app.isPackaged) win.webContents.once('did-finish-load', () => setupUpdater(win));
});

app.on('window-all-closed', () => { sock.close(); app.quit(); });
