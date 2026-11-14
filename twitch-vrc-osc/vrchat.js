// API no oficial de VRChat (documentada por la comunidad en vrchat.community).
// IMPORTANTE: cambia el correo del User-Agent por uno tuyo; VRChat pide identificar cada app.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const API = 'https://api.vrchat.cloud/api/1';
const UA = 'TwitchVRCOSC/1.0 (tu-correo@example.com)';

let jar = {}; // cookies: auth, twoFactorAuth
const sessionFile = () => path.join(app.getPath('userData'), 'vrc-session.bin');

// Solo se guardan las cookies (cifradas con el sistema), nunca la contraseña.
function saveJar() {
  try {
    if (safeStorage.isEncryptionAvailable()) fs.writeFileSync(sessionFile(), safeStorage.encryptString(JSON.stringify(jar)));
  } catch {}
}
function loadJar() {
  try { jar = JSON.parse(safeStorage.decryptString(fs.readFileSync(sessionFile()))); } catch { jar = {}; }
}
const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

function absorb(r) {
  for (const c of r.headers.getSetCookie?.() ?? []) {
    const kv = c.split(';')[0];
    const i = kv.indexOf('=');
    const k = kv.slice(0, i).trim();
    const v = kv.slice(i + 1);
    if (!v || /expires=Thu, 01 Jan 1970/i.test(c)) delete jar[k];
    else jar[k] = v;
  }
  saveJar();
}

async function req(p, opts = {}) {
  try {
    const r = await fetch(API + p, {
      ...opts,
      headers: { 'User-Agent': UA, Cookie: cookieHeader(), ...(opts.headers || {}) }
    });
    absorb(r);
    let data = {};
    try { data = await r.json(); } catch {}
    return { status: r.status, data };
  } catch (e) {
    return { status: 0, data: { error: { message: String(e) } } };
  }
}

function interpret(r) {
  if (r.status !== 200) return { ok: false, error: r.data?.error?.message || 'Error ' + r.status };
  if (r.data.requiresTwoFactorAuth) return { ok: false, twofa: r.data.requiresTwoFactorAuth };
  return { ok: true, name: r.data.displayName };
}

async function login(user, pass) {
  delete jar.auth; // se conserva twoFactorAuth para no pedir 2FA cada vez
  const basic = Buffer.from(`${encodeURIComponent(user)}:${encodeURIComponent(pass)}`).toString('base64');
  return interpret(await req('/auth/user', { headers: { Authorization: 'Basic ' + basic } }));
}

async function twofa(method, code) {
  const p = { totp: 'totp', otp: 'otp', emailOtp: 'emailotp' }[method] || 'totp';
  const r = await req(`/auth/twofactorauth/${p}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  });
  if (r.status !== 200 || r.data.verified === false) return { ok: false, error: 'Código incorrecto' };
  return interpret(await req('/auth/user'));
}

async function session() {
  if (!jar.auth) return { ok: false };
  return interpret(await req('/auth/user'));
}

async function logout() {
  await req('/logout', { method: 'PUT' });
  delete jar.auth;
  saveJar();
  return true;
}

async function avatars() {
  const list = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const r = await req(`/avatars?user=me&releaseStatus=all&n=100&offset=${offset}`);
    if (r.status !== 200) return { ok: false, error: r.data?.error?.message || 'Error ' + r.status };
    list.push(...r.data.map((a) => ({ id: a.id, name: a.name, thumb: a.thumbnailImageUrl, status: a.releaseStatus })));
    if (r.data.length < 100) break;
  }
  return { ok: true, list };
}

// Las miniaturas pueden requerir la cookie, así que se descargan aquí y se pasan como data URL
const imgCache = new Map();
async function image(url) {
  if (!/^https:\/\/api\.vrchat\.cloud\//.test(url || '')) return null;
  if (imgCache.has(url)) return imgCache.get(url);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Cookie: cookieHeader() } });
    if (!r.ok) return null;
    const type = r.headers.get('content-type') || 'image/png';
    const d = `data:${type};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
    imgCache.set(url, d);
    return d;
  } catch { return null; }
}

function register(ipcMain) {
  loadJar();
  ipcMain.handle('vrc:login', (_, u, p) => login(u, p));
  ipcMain.handle('vrc:2fa', (_, m, c) => twofa(m, c));
  ipcMain.handle('vrc:session', () => session());
  ipcMain.handle('vrc:logout', () => logout());
  ipcMain.handle('vrc:avatars', () => avatars());
  ipcMain.handle('vrc:image', (_, url) => image(url));
}

module.exports = { register };
