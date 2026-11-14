const $ = (id) => document.getElementById(id);
const SCOPE = 'channel:read:redemptions';
const EVENT_TYPE = 'channel.channel_points_custom_reward_redemption.add';

const DEFAULT_REWARDS = [
  { title: 'Cambiar a avatar Gato', type: 'avatar', avatarId: 'avtr_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
  { title: 'Ponerme el sombrero', type: 'param', param: 'Hat', valueType: 'bool', value: true, resetValue: false, seconds: 60 }
];

let cfg = JSON.parse(localStorage.getItem('cfg') || 'null') ||
  { clientId: '', host: '127.0.0.1', port: 9000, rewards: DEFAULT_REWARDS };
let tok = JSON.parse(localStorage.getItem('tok') || 'null');
let ws = null, want = false, userId = null, lastMsg = 0, keepSec = 10;
const timers = {};

function log(t) {
  const l = $('log');
  l.textContent += `[${new Date().toLocaleTimeString()}] ${t}\n`;
  l.scrollTop = l.scrollHeight;
}

// ---------- Config ----------
function load() {
  $('clientId').value = cfg.clientId;
  $('host').value = cfg.host;
  $('port').value = cfg.port;
  $('rewards').value = JSON.stringify(cfg.rewards, null, 2);
  tests();
}

function save() {
  try {
    cfg = {
      clientId: $('clientId').value.trim(),
      host: $('host').value.trim() || '127.0.0.1',
      port: Number($('port').value) || 9000,
      rewards: JSON.parse($('rewards').value)
    };
  } catch (e) {
    log('JSON de recompensas inválido: ' + e.message);
    return false;
  }
  localStorage.setItem('cfg', JSON.stringify(cfg));
  tests();
  return true;
}

function tests() {
  const box = $('tests');
  box.innerHTML = '';
  cfg.rewards.forEach((r) => {
    const b = document.createElement('button');
    b.textContent = 'Probar: ' + r.title;
    b.onclick = () => run(r);
    box.appendChild(b);
  });
}

// ---------- OSC ----------
async function send(address, type, value) {
  if (type === 'bool') value = value === true || value === 'true' || value === 1;
  const err = await api.osc({ host: cfg.host, port: cfg.port, address, type, value });
  log(err ? 'Error OSC: ' + err : `OSC → ${address} ${value}`);
}

async function run(r) {
  if (r.type === 'avatar') return send('/avatar/change', 'string', r.avatarId);
  const addr = '/avatar/parameters/' + r.param;
  await send(addr, r.valueType, r.value);
  if (r.seconds > 0) {
    clearTimeout(timers[addr]);
    timers[addr] = setTimeout(() => send(addr, r.valueType, r.resetValue), r.seconds * 1000);
  }
}

function onRedeem(e) {
  const t = e.reward.title;
  log(`${e.user_name} canjeó "${t}"`);
  const r = cfg.rewards.find((x) => x.title.toLowerCase() === t.toLowerCase());
  if (r) run(r);
  else log('Sin acción configurada para esa recompensa');
}

// ---------- Auth de Twitch (Device Code Flow, solo Client ID) ----------
const form = (url, obj) => api.http(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(obj).toString()
});

function setTok(d) {
  tok = { access: d.access_token, refresh: d.refresh_token };
  localStorage.setItem('tok', JSON.stringify(tok));
}

async function validate(retry = true) {
  if (!tok) return null;
  const r = await api.http('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: 'OAuth ' + tok.access } });
  if (r.status === 200) return r.data;
  if (retry && tok.refresh) {
    const f = await form('https://id.twitch.tv/oauth2/token', {
      client_id: cfg.clientId, grant_type: 'refresh_token', refresh_token: tok.refresh
    });
    if (f.status === 200) { setTok(f.data); return validate(false); }
  }
  return null;
}

async function deviceLogin() {
  const d = await form('https://id.twitch.tv/oauth2/device', { client_id: cfg.clientId, scopes: SCOPE });
  if (d.status !== 200) throw new Error('No se pudo iniciar la autorización: ' + JSON.stringify(d.data));
  const { device_code, user_code, verification_uri, expires_in, interval = 5 } = d.data;
  log(`Autoriza en ${verification_uri} (código: ${user_code})`);
  api.open(verification_uri);
  const end = Date.now() + expires_in * 1000;
  while (want && Date.now() < end) {
    await new Promise((r) => setTimeout(r, interval * 1000));
    const t = await form('https://id.twitch.tv/oauth2/token', {
      client_id: cfg.clientId, scopes: SCOPE, device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    });
    if (t.status === 200) { setTok(t.data); return; }
    if (!/authorization_pending/.test(t.data.message || '')) throw new Error(JSON.stringify(t.data));
  }
  throw new Error('Autorización expirada o cancelada');
}

// ---------- EventSub (WebSocket) ----------
async function subscribe(session_id) {
  const r = await api.http('https://api.twitch.tv/helix/eventsub/subscriptions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + tok.access, 'Client-Id': cfg.clientId, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: EVENT_TYPE, version: '1',
      condition: { broadcaster_user_id: userId },
      transport: { method: 'websocket', session_id }
    })
  });
  log(r.status === 202 ? 'Escuchando recompensas de puntos del canal ✔' : 'Error al suscribirse: ' + JSON.stringify(r.data));
}

function openWs(url = 'wss://eventsub.wss.twitch.tv/ws', sub = true) {
  const w = new WebSocket(url);
  ws = w;
  w.onmessage = async (ev) => {
    lastMsg = Date.now();
    const m = JSON.parse(ev.data);
    const t = m.metadata.message_type;
    if (t === 'session_welcome') {
      keepSec = m.payload.session.keepalive_timeout_seconds || 10;
      if (sub) await subscribe(m.payload.session.id);
    } else if (t === 'session_reconnect') {
      openWs(m.payload.session.reconnect_url, false);
    } else if (t === 'notification' && m.metadata.subscription_type === EVENT_TYPE) {
      onRedeem(m.payload.event);
    }
  };
  w.onclose = () => {
    if (w === ws && want) {
      log('Desconectado, reintentando en 5 s…');
      setTimeout(() => want && connect(), 5000);
    }
  };
}

async function connect() {
  if (!save()) return;
  if (!cfg.clientId) return log('Falta el Client ID de Twitch');
  want = true;
  try {
    let me = await validate();
    if (!me) { await deviceLogin(); me = await validate(false); }
    if (!me) throw new Error('Token no válido');
    userId = me.user_id;
    log('Sesión iniciada como ' + me.login);
    openWs();
  } catch (e) {
    log('Error: ' + e.message);
    want = false;
  }
}

function disconnect() {
  want = false;
  if (ws) ws.close();
  log('Desconectado');
}

// Vigilante: si Twitch deja de enviar mensajes, reconectar; y validar el token cada 30 min
setInterval(() => {
  if (want && ws && lastMsg && Date.now() - lastMsg > (keepSec + 10) * 1000) ws.close();
}, 5000);
setInterval(() => { if (want) validate(); }, 30 * 60 * 1000);

$('save').onclick = () => { if (save()) log('Configuración guardada'); };
$('connect').onclick = connect;
$('disconnect').onclick = disconnect;
load();

// ---------- Actualizaciones ----------
let ver = '';
api.version().then((v) => { ver = 'v' + v; $('upd').textContent = ver; });
api.onUpdate((s) => {
  const u = $('upd');
  if (s.state === 'ready') {
    u.textContent = `${ver} · actualización ${s.version} lista`;
    const b = document.createElement('button');
    b.textContent = 'Reiniciar para actualizar';
    b.onclick = () => api.installUpdate();
    u.appendChild(b);
    return;
  }
  const t = { checking: 'buscando actualizaciones…', none: 'al día', available: 'nueva versión ' + s.version,
    downloading: 'descargando ' + s.percent + '%', error: 'no se pudo comprobar actualizaciones' }[s.state];
  u.textContent = ver + ' · ' + (t || '');
});

// ---------- Cuenta de VRChat y selector de avatares ----------
let pending2fa = null;
const vstate = (t) => { $('vstate').textContent = t; };

function setLogged(on, name) {
  $('vform').style.display = on ? 'none' : '';
  $('vload').style.display = on ? '' : 'none';
  $('vout').style.display = on ? '' : 'none';
  if (on) vstate('Sesión: ' + name);
  else { $('grid').innerHTML = ''; vstate(''); }
}

async function handleVrc(r) {
  if (r.ok) { pending2fa = null; setLogged(true, r.name); loadAvatars(); return; }
  if (r.twofa) {
    pending2fa = r.twofa.includes('emailOtp') ? 'emailOtp' : 'totp';
    $('v2').style.display = '';
    vstate(pending2fa === 'emailOtp' ? 'Escribe el código que llegó a tu correo' : 'Escribe el código de tu app de autenticación');
    return;
  }
  vstate('Error: ' + r.error);
}

$('vlogin').onclick = async () => {
  vstate('Conectando…');
  if (pending2fa) return handleVrc(await api.vrc.twofa(pending2fa, $('vc').value.trim()));
  const r = await api.vrc.login($('vu').value.trim(), $('vp').value);
  $('vp').value = '';
  handleVrc(r);
};
$('vout').onclick = async () => { await api.vrc.logout(); pending2fa = null; $('v2').style.display = 'none'; setLogged(false); };
$('vload').onclick = loadAvatars;

function addAvatarReward(title, a) {
  if (!save()) return;
  if (!title) return log('Escribe el nombre de la recompensa');
  cfg.rewards = cfg.rewards.filter((r) => r.title.toLowerCase() !== title.toLowerCase());
  cfg.rewards.push({ title, type: 'avatar', avatarId: a.id, avatarName: a.name });
  localStorage.setItem('cfg', JSON.stringify(cfg));
  $('rewards').value = JSON.stringify(cfg.rewards, null, 2);
  tests();
  log(`Añadida "${title}" → ${a.name}. Crea en Twitch una recompensa con ese mismo nombre.`);
}

async function loadAvatars() {
  vstate('Cargando avatares…');
  const r = await api.vrc.avatars();
  if (!r.ok) return vstate('Error: ' + r.error);
  vstate(`${r.list.length} avatares subidos`);
  const g = $('grid');
  g.innerHTML = '';
  let q = Promise.resolve(); // miniaturas una a una para no saturar la API
  for (const a of r.list) {
    const c = document.createElement('div');
    c.className = 'card';
    const img = document.createElement('img');
    const n = document.createElement('div');
    n.className = 'nm';
    n.textContent = a.name;
    const inp = document.createElement('input');
    inp.value = 'Avatar: ' + a.name;
    const add = document.createElement('button');
    add.textContent = '+ Recompensa';
    add.onclick = () => addAvatarReward(inp.value.trim(), a);
    const t = document.createElement('button');
    t.className = 'alt';
    t.textContent = 'Probar';
    t.onclick = () => run({ type: 'avatar', avatarId: a.id });
    c.append(img, n, inp, add, t);
    g.appendChild(c);
    q = q.then(() => api.vrc.image(a.thumb)).then((d) => { if (d) img.src = d; });
  }
}

api.vrc.session().then((r) => { if (r.ok) { setLogged(true, r.name); loadAvatars(); } });
