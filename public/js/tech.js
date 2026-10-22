import { drawScene, pruneExpired, COLORS, PEN_TTL } from './annotate.js';
import { CobrowseView } from './cobrowse-view.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtCode = (c) => String(c).replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
const fmtDateTime = (ts) =>
  new Date(ts).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const round4 = (v) => Math.round(v * 10000) / 10000;

const PHRASES = {
  es: ['Haz clic aquí', 'Haz doble clic aquí', 'Desplázate hacia abajo', 'Abre este menú', 'Escribe aquí', 'Espera un momento, por favor', '¡Perfecto, así es!'],
  en: ['Click here', 'Double-click here', 'Scroll down', 'Open this menu', 'Type here', 'Please wait a moment', 'Perfect, that’s it!'],
};
const EVENTS = {
  session_created: 'Sesión creada',
  terms_accepted: 'Términos aceptados',
  client_connected: 'Cliente conectado',
  sharing_started: 'Empezó a compartir',
  sharing_stopped: 'Dejó de compartir',
  snapshot_taken: 'Captura tomada',
  session_ended: 'Sesión finalizada',
  tech_login: 'Inicio de sesión',
  tech_login_failed: 'Acceso fallido',
  cobrowse_started: 'Abrió el navegador compartido',
  cobrowse_navigated: 'Navegó a',
  cobrowse_control_granted: 'Dio el control',
  cobrowse_control_revoked: 'Retiró el control',
  cobrowse_ended: 'Cerró el navegador compartido',
  cobrowse_blocked: 'Dirección bloqueada',
};
const SURFACES = { monitor: 'Pantalla completa', window: 'Ventana', browser: 'Pestaña' };
const REASONS = {
  client: 'lo detuvo el cliente',
  disconnected: 'se perdió la conexión',
  session_ended: 'fin de la sesión',
  link_expired: 'enlace caducado',
  max_duration: 'duración máxima',
  server_shutdown: 'reinicio del servidor',
  idle: 'sin uso',
  page_closed: 'la página se cerró',
  browser_crashed: 'el navegador se reinició',
};
const byText = (by) => (by?.startsWith('tech:') ? `finalizó ${by.slice(5)}` : REASONS[by] || by);

const st = {
  me: null,
  brand: 'Nibbletec',
  view: null,
  code: null,
  session: null,
  ws: null,
  wsRetry: 0,
  ended: false,
  pc: null,
  gen: -1,
  pendingIce: [],
  ice: null,
  share: null,
  clientPresent: false,
  pipOpen: false,
  hasVideo: false,
  anns: [],
  draft: null,
  drag: null,
  tool: 'pointer',
  color: 'red',
  caption: '',
  pointer: null,
  vp: null,
  T: null,
  spaceDown: false,
  panning: null,
  lastPtrSend: 0,
  lastDraftSend: 0,
  stats: null,
  dashTimer: 0,
  mode: 'screen',
  cb: { open: false },
};

const canvas = $('#tech-canvas');
const ctx = canvas.getContext('2d');
const video = $('#remote-video');
const cbView = new CobrowseView($('#cb-canvas'), { send: (m) => send(m), canControl: () => !!st.cb.control, bg: '#141B23' });

// ---------------------------------------------------------------------------
// Utilidades de interfaz
// ---------------------------------------------------------------------------
function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 4500);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') {
    showView('login');
    throw new Error('unauthorized');
  }
  if (!res.ok) throw Object.assign(new Error(body.error || res.statusText), { status: res.status, body });
  return body;
}

function showView(name) {
  st.view = name;
  for (const v of $$('[data-view]')) v.hidden = v.dataset.view !== name;
  clearInterval(st.dashTimer);
  if (name === 'dash') {
    refreshDash();
    st.dashTimer = setInterval(refreshDash, 5000);
  }
  if (name === 'login') setTimeout(() => $('#login-user').focus(), 0);
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const src = $(btn.dataset.copy);
  try {
    await navigator.clipboard.writeText(src.value);
  } catch {
    src.select();
    document.execCommand('copy');
  }
  const prev = btn.textContent;
  btn.textContent = 'Copiado';
  setTimeout(() => (btn.textContent = prev), 1400);
});

// ---------------------------------------------------------------------------
// Acceso
// ---------------------------------------------------------------------------
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#login-error');
  err.hidden = true;
  try {
    await api('/api/login', { method: 'POST', body: { user: $('#login-user').value, password: $('#login-pass').value } });
    $('#login-pass').value = '';
    await boot();
  } catch (ex) {
    err.textContent = ex.status === 429 ? 'Demasiados intentos. Espera unos minutos.' : 'Usuario o contraseña incorrectos.';
    err.hidden = false;
  }
});

$('#logout-btn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  location.hash = '';
  showView('login');
});

// ---------------------------------------------------------------------------
// Panel: crear sesiones, listar, registro
// ---------------------------------------------------------------------------
function clientMessage(s) {
  const name = s.clientLabel ? ` ${s.clientLabel.split(' ')[0]}` : '';
  if (s.lang === 'en') {
    return `Hi${name}, for your ${st.brand} support session, open this link on your computer:\n${s.url}\n\nSession code: ${fmtCode(s.code)}\nI’ll only see what you choose to share. I can’t control your computer.`;
  }
  return `Hola${name}, para la sesión de soporte de ${st.brand} abre este enlace en tu computadora:\n${s.url}\n\nCódigo de sesión: ${fmtCode(s.code)}\nSolo podré ver lo que tú decidas compartir. No puedo controlar tu equipo.`;
}

$('#new-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const s = await api('/api/sessions', {
      method: 'POST',
      body: {
        clientLabel: $('#new-client').value,
        ticket: $('#new-ticket').value,
        lang: $('#new-lang').value,
        ttlMin: +$('#new-ttl').value,
      },
    });
    $('#new-code').textContent = fmtCode(s.code);
    $('#new-url').value = s.url;
    $('#new-msg').value = clientMessage(s);
    $('#new-open').href = `#/s/${s.code}`;
    $('#new-result').hidden = false;
    $('#new-client').value = '';
    $('#new-ticket').value = '';
    refreshDash();
  } catch (ex) {
    if (ex.message !== 'unauthorized') toast('No se pudo crear la sesión.');
  }
});

function statusText(s) {
  if (s.status === 'ended') return ['Finalizada', 'off'];
  if (s.cobrowse) return [s.cobrowse.control ? 'Navegador, con control' : 'Navegador compartido', 'live'];
  if (s.sharing) return ['Compartiendo', 'live'];
  if (s.clientConnected) return ['Cliente conectado', 'ok'];
  if (s.client) return ['Términos aceptados', 'ok'];
  return ['Esperando al cliente', 'wait'];
}

async function refreshDash() {
  if (st.view !== 'dash') return;
  try {
    const [sessions, audit] = await Promise.all([api('/api/sessions'), api('/api/audit?limit=40')]);
    const tb = $('#sessions-table tbody');
    tb.innerHTML = sessions
      .map((s) => {
        const [txt, cls] = statusText(s);
        const who = s.client?.name || s.clientLabel || '—';
        const ticket = s.ticket ? `<span class="muted"> · #${esc(s.ticket)}</span>` : '';
        const actions =
          s.status === 'ended'
            ? ''
            : `<a class="btn small" href="#/s/${s.code}">Abrir</a> <button class="btn small ghost" type="button" data-end="${s.code}">Finalizar</button>`;
        return `<tr><td class="code-digits">${fmtCode(s.code)}</td><td>${esc(who)}${ticket}</td><td><span class="state ${cls}">${txt}</span></td><td>${fmtTime(s.createdAt)}</td><td class="actions">${actions}</td></tr>`;
      })
      .join('');
    $('#sessions-empty').hidden = sessions.length > 0;
    $('#sessions-table').hidden = sessions.length === 0;

    const ab = $('#audit-table tbody');
    ab.innerHTML = audit
      .map((r) => {
        const detail = [r.host, r.clientName, r.user || r.techUser, r.ip, r.surface && SURFACES[r.surface], byText(r.by), REASONS[r.reason] || r.reason]
          .filter(Boolean)
          .map(esc)
          .join(' · ');
        return `<tr><td>${fmtDateTime(r.at)}</td><td>${esc(EVENTS[r.event] || r.event)}</td><td class="code-digits">${r.code ? fmtCode(r.code) : ''}</td><td class="muted">${detail}</td></tr>`;
      })
      .join('');
    $('#audit-empty').hidden = audit.length > 0;
    $('#audit-table').hidden = audit.length === 0;
  } catch {
    /* se reintenta en el siguiente ciclo */
  }
}

$('#sessions-table').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-end]');
  if (!b) return;
  if (!confirm('¿Finalizar esta sesión? El cliente dejará de compartir.')) return;
  await api(`/api/sessions/${b.dataset.end}/end`, { method: 'POST' }).catch(() => {});
  refreshDash();
});

// ---------------------------------------------------------------------------
// Sesión en vivo: WebSocket + WebRTC
// ---------------------------------------------------------------------------
function openSession(code) {
  closeSession();
  st.code = code;
  st.ended = false;
  st.anns = [];
  st.caption = '';
  st.draft = null;
  st.vp = null;
  st.share = null;
  st.clientPresent = false;
  st.pipOpen = false;
  st.session = null;
  st.cb = { open: false };
  cbView.clear();
  setMode('screen');
  $('#caption-input').value = '';
  showView('session');
  setTool(st.tool);
  setColor(st.color);
  renderSession();
  connectWS();
  canvas.focus({ preventScroll: true });
}

function closeSession() {
  const ws = st.ws;
  st.ws = null;
  ws?.close();
  closePeer();
  st.code = null;
}

function connectWS() {
  if (!st.code || st.ended) return;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  st.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', role: 'tech', code: st.code }));
  ws.onmessage = (e) => {
    if (typeof e.data !== 'string') return onCbFrame(e.data);
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    onMessage(m);
  };
  ws.onclose = (e) => {
    if (st.ws !== ws) return;
    st.ws = null;
    if (e.code === 4003) return showView('login');
    if (e.code === 4004 || e.code === 4010) {
      st.ended = true;
      closePeer();
      return renderSession();
    }
    if (e.code === 4001) {
      st.ended = true;
      toast('Esta sesión se abrió en otra pestaña.');
      return renderSession();
    }
    setTimeout(connectWS, Math.min(8000, 600 * 2 ** st.wsRetry++));
  };
}

function send(m) {
  if (st.ws?.readyState === 1) st.ws.send(JSON.stringify(m));
}

function syncClient() {
  send({ t: 'ann', op: 'sync', anns: st.anns.map(wire), caption: st.caption });
}

function onMessage(m) {
  switch (m.t) {
    case 'joined':
      st.wsRetry = 0;
      st.session = m.session;
      st.clientPresent = m.session.clientConnected;
      st.share = m.session.sharing;
      st.pipOpen = m.session.pipOpen;
      if (st.clientPresent) syncClient();
      break;
    case 'peer':
      if (m.role !== 'client') break;
      st.clientPresent = m.present;
      if (m.client && st.session) st.session.client = m.client;
      if (m.present) syncClient();
      else {
        st.share = null;
        st.pipOpen = false;
        closePeer();
      }
      break;
    case 'client-info':
      if (st.session) st.session.client = m.client;
      break;
    case 'share':
      if (m.sharing) {
        const changed = !st.share || st.share.w !== m.w || st.share.h !== m.h;
        st.share = { w: m.w, h: m.h, surface: m.surface };
        if (changed) st.vp = null;
      } else {
        st.share = null;
        st.pipOpen = false;
        closePeer();
      }
      break;
    case 'pip':
      st.pipOpen = m.open;
      break;
    case 'offer':
      onOffer(m);
      break;
    case 'ice':
      onIce(m);
      break;
    case 'cb-state':
      onCbState(m);
      break;
    case 'cb-notice': {
      const msg = {
        upload: 'La página pidió subir un archivo: no está disponible en el navegador compartido.',
        bad_url: 'Esa dirección no es válida.',
        nav_failed: 'No se pudo abrir esa página.',
        blocked: 'Dirección bloqueada: el navegador compartido no abre redes privadas ni internas.',
        unreachable: 'No se pudo abrir esa página: no responde o es una dirección interna (bloqueada).',
        dialog: `La página mostró un aviso: ${m.text || ''}`,
      }[m.kind];
      if (msg) toast(msg);
      break;
    }
    case 'ended':
      st.ended = true;
      closePeer();
      break;
  }
  renderSession();
}

async function getIce() {
  if (st.ice && Date.now() - st.ice.at < 10 * 60 * 1000) return st.ice.servers;
  try {
    const body = await api('/api/ice');
    st.ice = { at: Date.now(), servers: body.iceServers || [] };
  } catch {
    st.ice = { at: 0, servers: [] };
  }
  return st.ice.servers;
}

async function onOffer(m) {
  closePeer();
  st.gen = m.gen;
  st.pendingIce = [];
  const iceServers = await getIce();
  if (st.gen !== m.gen) return;
  const pc = new RTCPeerConnection({ iceServers });
  st.pc = pc;
  pc.ontrack = (e) => {
    video.srcObject = e.streams[0] || new MediaStream([e.track]);
    video.play().catch(() => {});
  };
  pc.onicecandidate = (e) => e.candidate && send({ t: 'ice', gen: m.gen, candidate: e.candidate });
  pc.onconnectionstatechange = renderSession;
  try {
    await pc.setRemoteDescription(m.sdp);
    for (const c of st.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
    await pc.setLocalDescription(await pc.createAnswer());
    send({ t: 'answer', gen: m.gen, sdp: pc.localDescription });
  } catch (e) {
    console.warn('offer', e);
  }
}

async function onIce(m) {
  if (m.gen !== st.gen || !m.candidate) return;
  if (!st.pc || !st.pc.remoteDescription) st.pendingIce.push(m.candidate);
  else await st.pc.addIceCandidate(m.candidate).catch(() => {});
}

function closePeer() {
  st.pc?.close();
  st.pc = null;
  st.stats = null;
  st.hasVideo = false;
  video.srcObject = null;
}

video.addEventListener('loadeddata', () => {
  st.hasVideo = true;
  renderSession();
});
video.addEventListener('resize', () => (st.vp = null));

$('#end-btn').addEventListener('click', () => {
  if (st.ended) return (location.hash = '#/');
  if (!confirm('¿Finalizar la sesión? El cliente dejará de compartir su pantalla.')) return;
  send({ t: 'end' });
});

// ---------------------------------------------------------------------------
// Estado de la sesión en la interfaz
// ---------------------------------------------------------------------------
function setPill(id, text, cls) {
  const el = $(id);
  el.textContent = text;
  el.className = `pill ${cls}`;
}

function renderSession() {
  if (st.view !== 'session') return;
  const s = st.session;
  const c = s?.client;
  $('#s-client').textContent = c?.name || s?.clientLabel || 'Cliente';
  $('#s-code').textContent = st.code ? fmtCode(st.code) : '';
  $('#s-ticket').textContent = s?.ticket ? `Ticket #${s.ticket}` : '';
  $('#end-btn').textContent = st.ended ? 'Volver a sesiones' : 'Finalizar sesión';
  $('#end-btn').classList.toggle('danger', !st.ended);

  setPill('#pill-client', st.clientPresent ? 'Cliente conectado' : c ? 'Cliente desconectado' : 'Sin aceptar términos', st.clientPresent ? 'ok' : 'wait');
  setPill('#pill-share', st.share ? `Compartiendo: ${SURFACES[st.share.surface] || 'pantalla'}` : 'Sin compartir', st.share ? 'live' : 'off');
  setPill('#pill-pip', st.pipOpen ? 'Ventana flotante abierta' : 'Ventana flotante cerrada', st.pipOpen ? 'ok' : 'off');

  // Mensaje del escenario cuando no hay imagen
  let msg = '';
  if (st.ended) msg = 'La sesión terminó.';
  else if (!c) msg = 'Esperando a que el cliente abra el enlace y acepte los términos.';
  else if (!st.clientPresent) msg = 'El cliente aceptó los términos, pero no está conectado ahora mismo.';
  else if (!st.share) msg = `${c.name.split(' ')[0]} está conectado. Esperando a que comparta su pantalla.`;
  else if (!st.hasVideo) msg = 'Conectando video…';
  $('#stage-empty-text').textContent = msg;
  $('#stage-empty').hidden = !msg;

  $('#pip-note').textContent =
    st.share && !st.pipOpen
      ? 'El cliente no ha abierto la ventana flotante: solo verá tus marcas si mira la pestaña de soporte. Pídele que pulse "Abrir ventana flotante".'
      : '';

  const kv = (rows) => rows.filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  $('#client-kv').innerHTML = c
    ? kv([
        ['Nombre', c.name],
        ['Aceptó', fmtDateTime(c.acceptedAt)],
        ['IP', c.ip],
        ['Idioma', c.lang === 'en' ? 'English' : 'Español'],
        ['Términos', c.termsVersion],
      ])
    : '<dt>Estado</dt><dd>Aún no acepta los términos</dd>';

  const sx = st.stats;
  $('#conn-kv').innerHTML = kv([
    ['Estado', st.pc ? { new: 'Iniciando', connecting: 'Conectando', connected: 'Conectado', disconnected: 'Inestable', failed: 'Falló', closed: 'Cerrado' }[st.pc.connectionState] : 'Sin video'],
    ['Ruta', sx?.route],
    ['Resolución', sx?.res],
    ['Fluidez', sx?.fps],
    ['Velocidad', sx?.rate],
  ]);

  renderPhrases();
  $('#caption-clear').hidden = !st.caption;
  renderCb();
}

function renderPhrases() {
  const lang = st.session?.client?.lang || st.session?.lang || 'es';
  const box = $('#phrases');
  if (box.dataset.lang === lang) return;
  box.dataset.lang = lang;
  box.innerHTML = PHRASES[lang].map((p) => `<button type="button" class="chip">${esc(p)}</button>`).join('');
}

$('#phrases').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (chip) setCaption(chip.textContent);
});
$('#caption-form').addEventListener('submit', (e) => {
  e.preventDefault();
  setCaption($('#caption-input').value.trim());
});
$('#caption-clear').addEventListener('click', () => setCaption(''));

function setCaption(text) {
  st.caption = text.slice(0, 200);
  $('#caption-input').value = st.caption;
  send({ t: 'caption', text: st.caption });
  renderSession();
}

// Estadísticas de conexión
setInterval(async () => {
  const pc = st.pc;
  if (!pc || st.view !== 'session') return;
  try {
    const report = await pc.getStats();
    let inbound, pair;
    const byId = new Map();
    report.forEach((r) => {
      byId.set(r.id, r);
      if (r.type === 'inbound-rtp' && r.kind === 'video') inbound = r;
    });
    report.forEach((r) => {
      if (r.type === 'transport' && r.selectedCandidatePairId) pair = byId.get(r.selectedCandidatePairId);
    });
    if (!pair) report.forEach((r) => r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded' && (pair = r));
    const prev = st.stats;
    const out = {};
    if (inbound) {
      if (inbound.frameWidth) out.res = `${inbound.frameWidth} × ${inbound.frameHeight}`;
      if (inbound.framesPerSecond != null) out.fps = `${Math.round(inbound.framesPerSecond)} cuadros/s`;
      if (prev?.bytes != null) {
        const mbps = ((inbound.bytesReceived - prev.bytes) * 8) / ((inbound.timestamp - prev.ts) * 1000);
        if (mbps >= 0) out.rate = `${mbps.toFixed(1)} Mbps`;
      }
      out.bytes = inbound.bytesReceived;
      out.ts = inbound.timestamp;
    }
    if (pair) {
      const lc = byId.get(pair.localCandidateId);
      const rc = byId.get(pair.remoteCandidateId);
      const relay = lc?.candidateType === 'relay' || rc?.candidateType === 'relay';
      out.route = relay ? 'Retransmitida (TURN)' : 'Directa (P2P)';
    }
    st.stats = out;
    renderSession();
  } catch {
    /* ignorar */
  }
}, 2000);

// ---------------------------------------------------------------------------
// Herramientas y dibujo
// ---------------------------------------------------------------------------
function setTool(tool) {
  st.tool = tool;
  for (const b of $$('.tools [data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
  if (tool !== 'pointer') hidePointer();
  updateCursor();
}
function setColor(color) {
  st.color = color;
  for (const b of $$('.swatches [data-color]')) {
    b.setAttribute('aria-pressed', String(b.dataset.color === color));
    b.style.setProperty('--sw', COLORS[b.dataset.color]);
  }
}
function updateCursor() {
  canvas.dataset.cursor = st.panning ? 'grabbing' : st.spaceDown || st.tool === 'pan' ? 'grab' : st.tool === 'pointer' ? 'none' : 'crosshair';
}
for (const b of $$('.tools [data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));
for (const b of $$('.swatches [data-color]')) b.addEventListener('click', () => setColor(b.dataset.color));

const wire = (a) => {
  const { _t, ...rest } = a;
  return rest;
};

function addAnn(a) {
  a._t = performance.now();
  st.anns.push(a);
  send({ t: 'ann', op: 'add', ann: wire(a) });
}
function undo() {
  const a = st.anns.pop();
  if (a) send({ t: 'ann', op: 'remove', id: a.id });
}
function clearAll() {
  st.anns = [];
  st.draft = null;
  send({ t: 'ann', op: 'clear' });
}
function nextClickN() {
  return st.anns.filter((a) => a.type === 'click').length + 1;
}
function hidePointer() {
  if (st.pointer?.visible) {
    st.pointer.visible = false;
    send({ t: 'ann', op: 'pointer', hide: true });
  }
}

$('#undo-btn').addEventListener('click', undo);
$('#clear-btn').addEventListener('click', clearAll);
$('#snap-btn').addEventListener('click', snapshot);
$('#fit-btn').addEventListener('click', () => (st.vp = null));

function srcDims() {
  return video.videoWidth ? [video.videoWidth, video.videoHeight] : [0, 0];
}
function fullVp() {
  const [sw, sh] = srcDims();
  return { x: 0, y: 0, w: sw, h: sh };
}

function eventNorm(e) {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const [nx, ny] = st.T.fromC((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
  return [Math.min(1, Math.max(0, nx)), Math.min(1, Math.max(0, ny))];
}

function shapeFromDrag(d, nx, ny) {
  const base = { id: d.id, type: d.type, color: st.color };
  if (d.type === 'arrow') return { ...base, x1: round4(d.x0), y1: round4(d.y0), x2: round4(nx), y2: round4(ny) };
  return {
    ...base,
    x: round4(Math.min(d.x0, nx)),
    y: round4(Math.min(d.y0, ny)),
    w: round4(Math.abs(nx - d.x0)),
    h: round4(Math.abs(ny - d.y0)),
  };
}

function sendDraft(force) {
  const now = performance.now();
  if (!force && now - st.lastDraftSend < 50) return;
  st.lastDraftSend = now;
  send({ t: 'ann', op: 'draft', ann: st.draft ? wire(st.draft) : null });
}

canvas.addEventListener('pointerdown', (e) => {
  if (!st.T || !st.hasVideo) return;
  canvas.focus({ preventScroll: true });
  canvas.setPointerCapture(e.pointerId);
  if (e.button === 1 || st.spaceDown || st.tool === 'pan') {
    st.panning = { x: e.clientX, y: e.clientY, vp: { ...(st.vp || fullVp()) }, s: st.T.s };
    updateCursor();
    return;
  }
  if (e.button !== 0) return;
  const [nx, ny] = eventNorm(e);
  switch (st.tool) {
    case 'click':
      addAnn({ id: uid(), type: 'click', color: st.color, x: round4(nx), y: round4(ny), n: nextClickN() });
      break;
    case 'rect':
    case 'spot':
    case 'arrow':
      st.drag = { id: uid(), type: st.tool, x0: nx, y0: ny };
      st.draft = shapeFromDrag(st.drag, nx, ny);
      st.draft._t = -1e9;
      break;
    case 'pen':
      st.drag = { id: uid(), type: 'pen' };
      st.draft = { id: st.drag.id, type: 'pen', color: st.color, pts: [[round4(nx), round4(ny)]], ttl: PEN_TTL, _t: -1e9 };
      break;
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!st.T || !st.hasVideo) return;
  if (st.panning) {
    const dpr = window.devicePixelRatio || 1;
    const p = st.panning;
    const [sw, sh] = srcDims();
    const dx = ((e.clientX - p.x) * dpr) / p.s;
    const dy = ((e.clientY - p.y) * dpr) / p.s;
    st.vp = {
      ...p.vp,
      x: Math.min(Math.max(0, p.vp.x - dx), Math.max(0, sw - p.vp.w)),
      y: Math.min(Math.max(0, p.vp.y - dy), Math.max(0, sh - p.vp.h)),
    };
    return;
  }
  const [nx, ny] = eventNorm(e);
  if (st.drag) {
    if (st.drag.type === 'pen') {
      const pts = st.draft.pts;
      const [lx, ly] = pts[pts.length - 1];
      if (Math.hypot(nx - lx, ny - ly) > 0.0025 && pts.length < 1500) pts.push([round4(nx), round4(ny)]);
    } else {
      st.draft = { ...shapeFromDrag(st.drag, nx, ny), _t: -1e9 };
    }
    sendDraft();
    return;
  }
  if (st.tool === 'pointer') {
    const now = performance.now();
    if (!st.pointer) st.pointer = { trail: [] };
    Object.assign(st.pointer, { x: nx, y: ny, visible: true });
    st.pointer.trail.push({ x: nx, y: ny, t: now });
    if (st.pointer.trail.length > 60) st.pointer.trail.shift();
    if (now - st.lastPtrSend > 33) {
      st.lastPtrSend = now;
      send({ t: 'ann', op: 'pointer', x: round4(nx), y: round4(ny) });
    }
  }
});

function finishDrag() {
  const d = st.drag;
  const a = st.draft;
  st.drag = null;
  st.draft = null;
  if (!d || !a) return;
  let ok = true;
  if (a.type === 'rect' || a.type === 'spot') ok = a.w > 0.006 && a.h > 0.006;
  else if (a.type === 'arrow') ok = Math.hypot(a.x2 - a.x1, a.y2 - a.y1) > 0.012;
  else if (a.type === 'pen') ok = a.pts.length > 1;
  if (ok) addAnn(a);
  else sendDraft(true);
}

canvas.addEventListener('pointerup', () => {
  if (st.panning) {
    st.panning = null;
    updateCursor();
    return;
  }
  finishDrag();
});
canvas.addEventListener('pointercancel', () => {
  st.panning = null;
  st.drag = null;
  st.draft = null;
  sendDraft(true);
});
canvas.addEventListener('pointerleave', () => {
  if (st.tool === 'pointer') hidePointer();
});

canvas.addEventListener(
  'wheel',
  (e) => {
    if (!st.T || !st.hasVideo) return;
    e.preventDefault();
    const [sw, sh] = srcDims();
    const vp = st.vp || fullVp();
    const factor = Math.exp(-e.deltaY * 0.0015);
    const w = Math.min(sw, Math.max(sw / 8, vp.w / factor));
    const h = (w * sh) / sw;
    const [nx, ny] = eventNorm(e);
    const px = nx * sw;
    const py = ny * sh;
    const fx = (px - vp.x) / vp.w;
    const fy = (py - vp.y) / vp.h;
    st.vp = w >= sw ? null : { x: Math.min(Math.max(0, px - fx * w), sw - w), y: Math.min(Math.max(0, py - fy * h), sh - h), w, h };
  },
  { passive: false }
);

const KEYS = { p: 'pointer', c: 'click', r: 'rect', f: 'spot', a: 'arrow', d: 'pen', m: 'pan' };
window.addEventListener('keydown', (e) => {
  if (st.view !== 'session' || st.mode === 'browser') return;
  const typing = e.target.closest('input, textarea, select');
  if (typing) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') {
    e.preventDefault();
    return undo();
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (KEYS[k]) return setTool(KEYS[k]);
  if (k === 'delete' || k === 'backspace') return clearAll();
  if (k === 's') return snapshot();
  if (k === '0') return (st.vp = null);
  if (k === 'escape') {
    st.drag = null;
    st.draft = null;
    sendDraft(true);
  }
  if (e.code === 'Space' && !st.spaceDown) {
    e.preventDefault();
    st.spaceDown = true;
    updateCursor();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    st.spaceDown = false;
    updateCursor();
  }
});

// Captura en resolución original, con las marcas visibles.
function snapshot() {
  const [sw, sh] = srcDims();
  if (!sw || !st.hasVideo) return toast('No hay imagen para capturar.');
  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  drawScene({
    ctx: c.getContext('2d'),
    cw: sw,
    ch: sh,
    source: video,
    sw,
    sh,
    anns: st.anns,
    caption: st.caption,
    now: performance.now(),
    dpr: Math.max(1, sw / 1600),
  });
  c.toBlob((blob) => {
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    a.download = `soporte_${st.code}_${st.session?.ticket ? st.session.ticket + '_' : ''}${ts}.png`;
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
  send({ t: 'snapshot' });
  toast('Captura guardada. El cliente recibió un aviso.');
}

// Bucle de dibujo
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  if (st.view !== 'session' || st.mode !== 'screen' || document.hidden) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const [sw, sh] = srcDims();
  pruneExpired(st.anns, now);
  st.T = drawScene({
    ctx,
    cw: w,
    ch: h,
    source: st.hasVideo ? video : null,
    sw: st.hasVideo ? sw : 0,
    sh: st.hasVideo ? sh : 0,
    vp: st.vp || undefined,
    anns: st.anns,
    draft: st.draft,
    pointer: st.tool === 'pointer' ? st.pointer : null,
    caption: st.caption,
    now,
    dpr,
    bg: '#141B23',
  });
  const zoomed = !!st.vp && sw;
  $('#zoom-badge').hidden = !zoomed;
  if (zoomed) $('#zoom-text').textContent = `${Math.round((sw / st.vp.w) * 100)} %`;
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------------------
// Navegador compartido
// ---------------------------------------------------------------------------
function setMode(mode) {
  st.mode = mode === 'browser' ? 'browser' : 'screen';
  for (const b of $$('#mode-seg [data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === st.mode));
  $('#stage').hidden = st.mode !== 'screen';
  $('#cb-pane').hidden = st.mode !== 'browser';
  $('.s-body').classList.toggle('cb-mode', st.mode === 'browser');
  if (st.mode === 'screen') {
    canvas.focus({ preventScroll: true });
  } else {
    hidePointer();
    $('#cb-canvas').focus({ preventScroll: true });
  }
  renderCb();
}
for (const b of $$('#mode-seg [data-mode]')) b.addEventListener('click', () => setMode(b.dataset.mode));

function onCbFrame(blob) {
  if (!st.cb.open) return;
  cbView.frame(blob);
  $('#cb-empty').hidden = true;
}

function onCbState(m) {
  const prev = st.cb;
  st.cb = m;
  if (m.open && !prev.open) {
    toast('El cliente abrió el navegador compartido.');
    setMode('browser');
  } else if (!m.open && prev.open) {
    cbView.clear();
    toast('Se cerró el navegador compartido.');
    setMode('screen');
  } else if (m.open && m.control !== prev.control) {
    toast(m.control ? 'El cliente te dio el control del navegador.' : 'El cliente retiró tu control del navegador.');
  }
}

function renderCb() {
  const enabled = !!st.me?.cobrowse;
  $('#mode-seg').hidden = !enabled;
  const cb = st.cb;
  const ctl = !!cb.control;
  setPill('#pill-cb', cb.open ? (ctl ? 'Navegador: con control' : 'Navegador: solo ver') : 'Navegador cerrado', cb.open ? (ctl ? 'live' : 'ok') : 'off');
  $('#pill-cb').hidden = !enabled;
  if (st.mode !== 'browser') return;
  const url = $('#cb-url');
  if (document.activeElement !== url) url.value = cb.url && cb.url !== 'about:blank' ? cb.url : '';
  url.disabled = !ctl;
  $('#cb-go').disabled = !ctl;
  $('[data-cb-nav="back"]').disabled = !ctl || !cb.canBack;
  $('[data-cb-nav="forward"]').disabled = !ctl || !cb.canForward;
  $('[data-cb-nav="reload"]').disabled = !ctl;
  $('#cb-ctl').textContent = !cb.open ? '' : ctl ? 'Tienes el control' : 'Solo ver';
  $('#cb-ctl').className = `cb-ctl ${ctl ? 'on' : ''}`;
  $('#cb-request-btn').hidden = !cb.open || ctl || !st.clientPresent;
  $('#cb-close-btn').hidden = !cb.open;
  $('#cb-canvas').dataset.control = String(ctl);
  let msg = '';
  if (!cb.open) msg = 'El cliente no ha abierto el navegador compartido. Pídele que pulse "Usar el navegador compartido" en su página de soporte.';
  else if (!cbView.hasImage) msg = 'Abriendo el navegador…';
  $('#cb-empty-text').textContent = msg;
  $('#cb-empty').hidden = !msg;
}

$('#cb-request-btn').addEventListener('click', () => {
  send({ t: 'cb-control-request' });
  toast('Se le pidió el control al cliente.');
});
$('#cb-close-btn').addEventListener('click', () => {
  if (confirm('¿Cerrar el navegador compartido? El cliente también dejará de verlo.')) send({ t: 'cb-close' });
});
for (const b of $$('#cb-pane [data-cb-nav]')) b.addEventListener('click', () => send({ t: 'cb-nav', action: b.dataset.cbNav }));
$('#cb-url-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = $('#cb-url').value.trim();
  if (!url || !st.cb.control) return;
  send({ t: 'cb-nav', action: 'go', url });
  $('#cb-canvas').focus({ preventScroll: true });
});

// ---------------------------------------------------------------------------
// Arranque y rutas
// ---------------------------------------------------------------------------
function route() {
  if (!st.me) return;
  const m = location.hash.match(/^#\/s\/(\d{9})$/);
  if (m) {
    if (st.code !== m[1] || st.view !== 'session') openSession(m[1]);
  } else {
    closeSession();
    showView('dash');
  }
}
window.addEventListener('hashchange', route);

async function boot() {
  try {
    st.me = await api('/api/me');
  } catch {
    return showView('login');
  }
  st.brand = st.me.brand || st.brand;
  for (const el of $$('[data-brand]')) el.textContent = st.brand;
  document.title = `Consola de soporte · ${st.brand}`;
  $('#me-name').textContent = st.me.name;
  route();
}
boot();

window.__tech = st;
