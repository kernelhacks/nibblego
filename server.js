'use strict';
/*
 * Nibbletec Assist — soporte remoto solo visual por navegador.
 * Servidor: sesiones con código, registro de aceptación de términos,
 * señalización WebRTC, relay de anotaciones por WebSocket y navegador
 * compartido (cobrowse.js).
 */
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { createCobrowse } = require('./cobrowse');

// ---------------------------------------------------------------------------
// CLI: node server.js hash-password "contraseña"
// ---------------------------------------------------------------------------
if (process.argv[2] === 'hash-password') {
  const pw = process.argv[3];
  if (!pw) {
    console.error('Uso: node server.js hash-password "contraseña"');
    process.exit(1);
  }
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 32);
  console.log(`scrypt.${salt.toString('base64url')}.${hash.toString('base64url')}`);
  process.exit(0);
}

// Se cargan después del comando anterior para que funcione sin `npm install`.
const express = require('express');
const { WebSocketServer } = require('ws');

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------
const env = process.env;
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
const clampInt = (v, min, max, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

const PORT = clampInt(env.PORT, 1, 65535, 8080);
const PUBLIC_URL = (env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const PUBLIC_HOST = new URL(PUBLIC_URL).host;
const BRAND_NAME = env.BRAND_NAME || 'Nibbletec';
const DATA_DIR = path.resolve(env.DATA_DIR || path.join(__dirname, 'data'));
const TERMS_DIR = path.resolve(env.TERMS_DIR || path.join(__dirname, 'terms'));
const LINK_TTL_MIN = clampInt(env.LINK_TTL_MIN, 5, 1440, 60);
const SESSION_MAX_HOURS = clampInt(env.SESSION_MAX_HOURS, 1, 24, 8);
const TURN_URLS = list(env.TURN_URLS);
const TURN_SECRET = env.TURN_SECRET || '';
const STUN_URLS = env.STUN_URLS !== undefined ? list(env.STUN_URLS) : ['stun:stun.l.google.com:19302'];
const WEBHOOK_URL = env.WEBHOOK_URL || '';
const WEBHOOK_SECRET = env.WEBHOOK_SECRET || '';
const COOKIE_SECURE = PUBLIC_URL.startsWith('https://');
const PROXY_HOPS = clampInt(env.TRUST_PROXY, 0, 5, 1);
const LANGS = ['es', 'en'];
// Navegador compartido (vacío u "off" = desactivado)
const COBROWSE_URL = /^(off|none|false|0)?$/i.test((env.COBROWSE_URL || '').trim()) ? '' : env.COBROWSE_URL.trim();
const COBROWSE_MAX = clampInt(env.COBROWSE_MAX, 1, 50, 3);
const COBROWSE_IDLE_MIN = clampInt(env.COBROWSE_IDLE_MIN, 1, 240, 15);
const COBROWSE_PROXY_PORT = clampInt(env.COBROWSE_PROXY_PORT, 1, 65535, 3128);
const COBROWSE_PORTS = list(env.COBROWSE_PORTS || '80,443,8080,8443').map(Number).filter((n) => n > 0 && n < 65536);
// App Android: paquete, huella del certificado (para abrir enlaces directo en la app) y APK
const ANDROID_PACKAGE = env.ANDROID_PACKAGE || 'com.nibbletec.assist';
const ANDROID_CERT_SHA256 = list(env.ANDROID_CERT_SHA256).map((s) => s.toUpperCase());
const ANDROID_APK_URL = env.ANDROID_APK_URL || '';
const APK_FILE = path.join(DATA_DIR, 'nibbletec-assist.apk');

let SESSION_SECRET = env.SESSION_SECRET;
if (!SESSION_SECRET) {
  SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[aviso] SESSION_SECRET no está definido: los técnicos tendrán que volver a entrar tras cada reinicio.');
}

// Técnicos: TECH_USERS="usuario:Nombre visible:contraseña,otro:Otro nombre:scrypt.sal.hash"
function loadUsers() {
  const users = new Map();
  for (const entry of list(env.TECH_USERS)) {
    const i1 = entry.indexOf(':');
    const i2 = entry.indexOf(':', i1 + 1);
    if (i1 < 1 || i2 < 0 || i2 === entry.length - 1) {
      console.warn(`[aviso] TECH_USERS: entrada ignorada (formato usuario:Nombre:contraseña): "${entry.slice(0, Math.max(i1, 0)) || '?'}"`);
      continue;
    }
    const user = entry.slice(0, i1).toLowerCase();
    users.set(user, { user, name: entry.slice(i1 + 1, i2) || user, secret: entry.slice(i2 + 1) });
  }
  if (!users.size) {
    const pw = crypto.randomBytes(9).toString('base64url');
    users.set('admin', { user: 'admin', name: 'Técnico', secret: pw });
    console.warn(`[aviso] TECH_USERS vacío. Usuario temporal → admin / ${pw}`);
  }
  return users;
}
const USERS = loadUsers();

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest();
const hmac = (s) => crypto.createHmac('sha256', SESSION_SECRET).update(s).digest('base64url');
const safeEqual = (a, b) => {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};
const cleanText = (v, max) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '';

function verifyPassword(stored, given) {
  if (typeof given !== 'string' || !given || given.length > 256) return false;
  if (stored.startsWith('scrypt.')) {
    const [, salt, hash] = stored.split('.');
    const expected = Buffer.from(hash || '', 'base64url');
    if (!expected.length) return false;
    const got = crypto.scryptSync(given, Buffer.from(salt || '', 'base64url'), expected.length);
    return crypto.timingSafeEqual(expected, got);
  }
  return crypto.timingSafeEqual(sha256(stored), sha256(given));
}

const COOKIE = 'na_tech';
const COOKIE_MAX_AGE = 12 * 3600;
function signCookie(obj) {
  const p = Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${p}.${hmac(p)}`;
}
function readCookieToken(tok) {
  if (!tok) return null;
  const [p, s] = tok.split('.');
  if (!p || !s || !safeEqual(s, hmac(p))) return null;
  try {
    const o = JSON.parse(Buffer.from(p, 'base64url').toString());
    return o && o.exp > Date.now() ? o : null;
  } catch {
    return null;
  }
}
function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function techFromReq(req) {
  const o = readCookieToken(parseCookies(req.headers.cookie)[COOKIE]);
  return o ? USERS.get(o.u) || null : null;
}
function originOk(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try {
    const h = new URL(o).host;
    return h === req.headers.host || h === PUBLIC_HOST;
  } catch {
    return false;
  }
}
function ipFromRaw(req) {
  const xff = (req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (PROXY_HOPS > 0 && xff.length) return xff[Math.max(0, xff.length - PROXY_HOPS)];
  return req.socket.remoteAddress || '';
}

// ---------------------------------------------------------------------------
// Términos (se recargan al editar el archivo, sin reiniciar)
// ---------------------------------------------------------------------------
const termsCache = new Map();
function getTerms(lang) {
  const file = path.join(TERMS_DIR, `terms.${lang}.html`);
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  const cached = termsCache.get(file);
  if (cached && cached.mtimeMs === st.mtimeMs) return cached.data;
  // Los comentarios HTML son notas internas: no se envían al cliente ni cuentan para la versión.
  const html = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim();
  const data = { html, version: sha256(html).toString('hex').slice(0, 16) };
  termsCache.set(file, { mtimeMs: st.mtimeMs, data });
  return data;
}

// ---------------------------------------------------------------------------
// Registro de auditoría (JSONL, solo se añade) + webhook opcional
// ---------------------------------------------------------------------------
fs.mkdirSync(DATA_DIR, { recursive: true });
const AUDIT_FILE = path.join(DATA_DIR, 'audit.jsonl');

function audit(event, fields = {}) {
  const rec = { at: new Date().toISOString(), event, ...fields };
  const line = JSON.stringify(rec);
  fs.appendFile(AUDIT_FILE, line + '\n', (err) => err && console.error('[audit] no se pudo escribir:', err.message));
  console.log(`[audit] ${event}${fields.code ? ' ' + fields.code : ''}`);
  if (WEBHOOK_URL) {
    const headers = { 'content-type': 'application/json' };
    if (WEBHOOK_SECRET) headers['x-assist-signature'] = crypto.createHmac('sha256', WEBHOOK_SECRET).update(line).digest('hex');
    fetch(WEBHOOK_URL, { method: 'POST', headers, body: line, signal: AbortSignal.timeout(5000) }).catch((e) =>
      console.warn('[webhook] falló:', e.message)
    );
  }
}

async function readAudit(limit) {
  let fh;
  try {
    fh = await fsp.open(AUDIT_FILE);
    const { size } = await fh.stat();
    const len = Math.min(size, 512 * 1024);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    if (len < size) lines.shift();
    return lines
      .slice(-limit)
      .reverse()
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  } finally {
    await fh?.close();
  }
}

// ---------------------------------------------------------------------------
// Sesiones (en memoria)
// ---------------------------------------------------------------------------
const sessions = new Map();
const CODE_RE = /^\d{9}$/;

function newCode() {
  let c;
  do c = String(crypto.randomInt(0, 1e9)).padStart(9, '0');
  while (sessions.has(c));
  return c;
}
function getSession(code) {
  return CODE_RE.test(String(code)) ? sessions.get(String(code)) || null : null;
}
function sessionError(s) {
  if (!s) return 'not_found';
  if (s.status === 'ended') return 'ended';
  if (!s.accepted && Date.now() > s.linkExpiresAt) return 'expired';
  return null;
}
function tokenOk(s, token) {
  return !!(s.clientTokenHash && typeof token === 'string' && token && safeEqual(sha256(token), s.clientTokenHash));
}
function clientInfo(s) {
  return s.accepted
    ? { name: s.accepted.name, lang: s.accepted.lang, acceptedAt: s.accepted.at, ip: s.accepted.ip, termsVersion: s.accepted.termsVersion }
    : null;
}
function techView(s) {
  return {
    code: s.code,
    url: `${PUBLIC_URL}/s/${s.code}`,
    createdAt: s.createdAt,
    linkExpiresAt: s.linkExpiresAt,
    techName: s.techName,
    techUser: s.techUser,
    clientLabel: s.clientLabel,
    ticket: s.ticket,
    lang: s.lang,
    status: s.status,
    client: clientInfo(s),
    sharing: s.sharing,
    pipOpen: s.pipOpen,
    pipMode: s.pipMode || '',
    techConnected: !!s.ws.tech,
    clientConnected: !!s.ws.client,
    cobrowse: cobrowse.summary(s),
  };
}
function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

const cobrowse = createCobrowse({
  url: COBROWSE_URL,
  max: COBROWSE_MAX,
  idleMin: COBROWSE_IDLE_MIN,
  proxyPort: COBROWSE_PROXY_PORT,
  ports: COBROWSE_PORTS,
  audit,
  send,
  cleanText,
});
function endSession(s, by) {
  if (s.status === 'ended') return;
  s.status = 'ended';
  s.endedAt = Date.now();
  if (s.sharing) audit('sharing_stopped', { code: s.code, reason: 'session_ended' });
  s.sharing = null;
  cobrowse.close(s, 'session_ended');
  for (const ws of [s.ws.tech, s.ws.client]) send(ws, { t: 'ended', by });
  setTimeout(() => {
    for (const ws of [s.ws.tech, s.ws.client]) if (ws) ws.close(4010, 'ended');
  }, 300);
  audit('session_ended', {
    code: s.code,
    ticket: s.ticket,
    by,
    clientName: s.accepted?.name,
    durationSec: Math.round((s.endedAt - s.createdAt) / 1000),
  });
}

setInterval(() => {
  const now = Date.now();
  for (const s of sessions.values()) {
    if (s.status !== 'ended' && !s.accepted && now > s.linkExpiresAt) {
      endSession(s, 'link_expired');
    } else if (s.status !== 'ended' && now > s.maxEndsAt) {
      endSession(s, 'max_duration');
    } else if (s.status === 'ended' && now - s.endedAt > 30 * 60 * 1000) {
      sessions.delete(s.code);
    }
  }
  cobrowse.sweep(now);
}, 30 * 1000).unref();

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', PROXY_HOPS);

app.use((req, res, next) => {
  const hostHeader = req.headers.host || '';
  const host = /^[a-z0-9.\-:[\]]+$/i.test(hostHeader) ? hostHeader : PUBLIC_HOST;
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "font-src 'self'",
      `connect-src 'self' wss://${host} ws://${host}`,
      "worker-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; ')
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'display-capture=(self), camera=(), microphone=(), geolocation=(), payment=()');
  next();
});

function limiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    let h = hits.get(req.ip);
    if (!h || h.reset < now) hits.set(req.ip, (h = { n: 0, reset: now + windowMs }));
    if (++h.n > max) {
      res.setHeader('Retry-After', Math.ceil((h.reset - now) / 1000));
      return res.status(429).json({ error: 'rate_limited' });
    }
    next();
  };
}
const loginLimiter = limiter(10, 15 * 60 * 1000);
const lookupLimiter = limiter(60, 5 * 60 * 1000);

app.use('/api', express.json({ limit: '32kb' }), (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && !originOk(req)) return res.status(403).json({ error: 'bad_origin' });
  next();
});

function requireTech(req, res, next) {
  const u = techFromReq(req);
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  req.tech = u;
  next();
}

// Páginas y archivos estáticos
const PUB = path.join(__dirname, 'public');
const page = (file) => (req, res) => res.sendFile(path.join(PUB, file));
app.get('/', page('client.html'));
app.get('/s/:code', page('client.html'));
app.get('/tech', page('tech.html'));
app.get('/healthz', (req, res) => res.json({ ok: true, sessions: sessions.size }));

// ---- App Android ----
function androidInfo() {
  const base = { package: ANDROID_PACKAGE };
  if (ANDROID_APK_URL) return { ...base, available: true, url: ANDROID_APK_URL };
  try {
    const st = fs.statSync(APK_FILE);
    return { ...base, available: true, url: '/app/android', size: st.size, updatedAt: st.mtime.toISOString() };
  } catch {
    return { ...base, available: false };
  }
}

// Permite que Android abra los enlaces /s/... directamente en la app (App Links).
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.json(
    ANDROID_CERT_SHA256.length
      ? [
          {
            relation: ['delegate_permission/common.handle_all_urls'],
            target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: ANDROID_CERT_SHA256 },
          },
        ]
      : []
  );
});

app.get('/app/android', (req, res) => {
  if (ANDROID_APK_URL) return res.redirect(302, ANDROID_APK_URL);
  if (!fs.existsSync(APK_FILE)) return res.status(404).type('text/plain').send('La app aún no está disponible.');
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="nibbletec-assist.apk"');
  res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(APK_FILE).pipe(res);
});
app.use('/fonts', express.static(path.join(PUB, 'fonts'), { maxAge: '30d', immutable: true }));
app.use(express.static(PUB, { index: false, maxAge: 0 }));

// ---- API pública (cliente) ----
app.get('/api/config', (req, res) => res.json({ brand: BRAND_NAME, android: androidInfo() }));

app.get('/api/s/:code', lookupLimiter, (req, res) => {
  const s = getSession(req.params.code);
  const err = sessionError(s);
  if (err) return res.status(err === 'not_found' ? 404 : 410).json({ error: err });
  const terms = {};
  for (const l of LANGS) terms[l] = getTerms(l);
  res.json({
    code: s.code,
    brand: BRAND_NAME,
    techName: s.techName,
    lang: s.lang,
    linkExpiresAt: s.linkExpiresAt,
    terms,
    cobrowse: cobrowse.enabled,
    android: androidInfo(),
  });
});

app.post('/api/s/:code/accept', lookupLimiter, (req, res) => {
  const s = getSession(req.params.code);
  const err = sessionError(s);
  if (err) return res.status(err === 'not_found' ? 404 : 410).json({ error: err });
  const { name, lang, version, agree } = req.body || {};
  const cleanName = cleanText(name, 80);
  if (cleanName.length < 2) return res.status(400).json({ error: 'name_required' });
  if (agree !== true) return res.status(400).json({ error: 'must_agree' });
  const L = LANGS.includes(lang) ? lang : 'es';
  const terms = getTerms(L);
  if (!terms) return res.status(500).json({ error: 'terms_missing' });
  if (version !== terms.version) return res.status(409).json({ error: 'terms_changed' });

  const token = crypto.randomBytes(24).toString('base64url');
  s.clientTokenHash = sha256(token);
  s.accepted = {
    name: cleanName,
    lang: L,
    at: new Date().toISOString(),
    ip: req.ip,
    userAgent: cleanText(req.get('user-agent'), 300),
    termsVersion: terms.version,
  };
  if (s.status === 'waiting') s.status = 'accepted';
  if (s.ws.client) s.ws.client.close(4001, 'replaced');
  audit('terms_accepted', {
    code: s.code,
    ticket: s.ticket,
    clientLabel: s.clientLabel,
    clientName: cleanName,
    lang: L,
    termsVersion: terms.version,
    ip: s.accepted.ip,
    userAgent: s.accepted.userAgent,
    techUser: s.techUser,
  });
  send(s.ws.tech, { t: 'client-info', client: clientInfo(s) });
  res.json({ token });
});

app.get('/api/ice', (req, res) => {
  const tech = techFromReq(req);
  let ident;
  if (tech) {
    ident = `tech-${tech.user}`;
  } else {
    const s = getSession(req.get('x-session-code'));
    const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!s || sessionError(s) || !tokenOk(s, token)) return res.status(403).json({ error: 'forbidden' });
    ident = `client-${s.code}`;
  }
  const iceServers = [];
  if (STUN_URLS.length) iceServers.push({ urls: STUN_URLS });
  if (TURN_URLS.length && TURN_SECRET) {
    // Credenciales temporales (TURN REST API, compatible con coturn use-auth-secret)
    const username = `${Math.floor(Date.now() / 1000) + 8 * 3600}:${ident}`;
    const credential = crypto.createHmac('sha1', TURN_SECRET).update(username).digest('base64');
    iceServers.push({ urls: TURN_URLS, username, credential });
  }
  res.json({ iceServers });
});

// ---- API del técnico ----
app.post('/api/login', loginLimiter, (req, res) => {
  const user = cleanText(req.body?.user, 64).toLowerCase();
  const u = USERS.get(user);
  const ok = verifyPassword(u ? u.secret : 'x'.repeat(24), req.body?.password) && !!u;
  if (!ok) {
    audit('tech_login_failed', { user, ip: req.ip });
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  const tok = signCookie({ u: u.user, exp: Date.now() + COOKIE_MAX_AGE * 1000 });
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${tok}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}${COOKIE_SECURE ? '; Secure' : ''}`
  );
  audit('tech_login', { user: u.user, ip: req.ip });
  res.json({ user: u.user, name: u.name });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${COOKIE_SECURE ? '; Secure' : ''}`);
  res.json({ ok: true });
});

app.get('/api/me', requireTech, (req, res) => res.json({ user: req.tech.user, name: req.tech.name, brand: BRAND_NAME, cobrowse: cobrowse.enabled }));

app.post('/api/sessions', requireTech, (req, res) => {
  const b = req.body || {};
  const ttl = clampInt(b.ttlMin, 5, 1440, LINK_TTL_MIN);
  const now = Date.now();
  const s = {
    code: newCode(),
    createdAt: now,
    linkExpiresAt: now + ttl * 60 * 1000,
    maxEndsAt: now + SESSION_MAX_HOURS * 3600 * 1000,
    techUser: req.tech.user,
    techName: req.tech.name,
    clientLabel: cleanText(b.clientLabel, 80),
    ticket: cleanText(b.ticket, 60),
    lang: LANGS.includes(b.lang) ? b.lang : 'es',
    status: 'waiting',
    accepted: null,
    clientTokenHash: null,
    sharing: null,
    pipOpen: false,
    cb: null,
    ws: { tech: null, client: null },
  };
  sessions.set(s.code, s);
  audit('session_created', { code: s.code, ticket: s.ticket, clientLabel: s.clientLabel, techUser: s.techUser, ttlMin: ttl });
  res.status(201).json(techView(s));
});

app.get('/api/sessions', requireTech, (req, res) => {
  res.json([...sessions.values()].sort((a, b) => b.createdAt - a.createdAt).map(techView));
});

app.get('/api/sessions/:code', requireTech, (req, res) => {
  const s = getSession(req.params.code);
  if (!s) return res.status(404).json({ error: 'not_found' });
  res.json(techView(s));
});

app.post('/api/sessions/:code/end', requireTech, (req, res) => {
  const s = getSession(req.params.code);
  if (!s) return res.status(404).json({ error: 'not_found' });
  endSession(s, `tech:${req.tech.user}`);
  res.json(techView(s));
});

app.get('/api/audit', requireTech, async (req, res, next) => {
  try {
    res.json(await readAudit(clampInt(req.query.limit, 1, 500, 50)));
  } catch (e) {
    next(e);
  }
});

// El técnico sube el APK desde la consola; queda en el volumen de datos.
app.post('/api/app/android', requireTech, express.raw({ type: () => true, limit: '200mb' }), async (req, res, next) => {
  try {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 1024 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
      return res.status(400).json({ error: 'not_apk' });
    }
    const tmp = `${APK_FILE}.tmp`;
    await fsp.writeFile(tmp, buf);
    await fsp.rename(tmp, APK_FILE);
    audit('app_uploaded', { platform: 'android', size: buf.length, sha256: sha256(buf).toString('hex'), techUser: req.tech.user });
    res.json(androidInfo());
  } catch (e) {
    next(e);
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'server_error' });
});

// ---------------------------------------------------------------------------
// WebSocket: señalización + anotaciones
// ---------------------------------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

// Qué tipos de mensaje puede reenviar cada lado
const RELAY = {
  client: new Set(['offer', 'ice']),
  tech: new Set(['answer', 'ice', 'ann']),
};

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname !== '/ws' || !req.headers.origin || !originOk(req)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.techUser = techFromReq(req);
    ws.ip = ipFromRaw(req);
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  const joinTimer = setTimeout(() => ws.close(4000, 'join_timeout'), 10000);
  ws.on('message', (buf, isBinary) => {
    if (isBinary) return;
    let m;
    try {
      m = JSON.parse(buf.toString());
    } catch {
      return;
    }
    if (!m || typeof m.t !== 'string') return;
    if (!ws.session) {
      if (m.t === 'join') {
        clearTimeout(joinTimer);
        handleJoin(ws, m);
      }
      return;
    }
    handleMessage(ws, m);
  });
  ws.on('close', () => {
    clearTimeout(joinTimer);
    handleClose(ws);
  });
  ws.on('error', () => {});
});

function handleJoin(ws, m) {
  const s = getSession(m.code);
  if (m.role === 'tech') {
    if (!ws.techUser) return ws.close(4003, 'unauthorized');
    if (!s || s.status === 'ended') return ws.close(4004, 'not_found');
    const prev = s.ws.tech;
    s.ws.tech = ws;
    ws.session = s;
    ws.role = 'tech';
    if (prev && prev !== ws) prev.close(4001, 'replaced');
    send(ws, { t: 'joined', role: 'tech', session: techView(s) });
    cobrowse.onJoin(ws, s);
    send(s.ws.client, { t: 'peer', role: 'tech', present: true, techName: ws.techUser.name });
  } else if (m.role === 'client') {
    if (!s || sessionError(s)) return ws.close(4004, sessionError(s) || 'not_found');
    if (!tokenOk(s, m.token)) return ws.close(4003, 'unauthorized');
    const prev = s.ws.client;
    s.ws.client = ws;
    ws.session = s;
    ws.role = 'client';
    if (prev && prev !== ws) prev.close(4001, 'replaced');
    send(ws, { t: 'joined', role: 'client', techPresent: !!s.ws.tech, techName: s.techName });
    cobrowse.onJoin(ws, s);
    send(s.ws.tech, { t: 'peer', role: 'client', present: true, client: clientInfo(s) });
    audit('client_connected', { code: s.code, clientName: s.accepted?.name, ip: ws.ip });
  } else {
    ws.close(4000, 'bad_role');
  }
}

function handleMessage(ws, m) {
  const s = ws.session;
  if (s.status === 'ended') return;
  const isTech = ws.role === 'tech';
  const other = isTech ? s.ws.client : s.ws.tech;
  if (m.t.startsWith('cb-')) return cobrowse.handle(ws, s, m, isTech);

  switch (m.t) {
    case 'share': {
      if (isTech) return;
      const sharing = !!m.sharing;
      const info = sharing
        ? {
            w: clampInt(m.w, 0, 16384, 0),
            h: clampInt(m.h, 0, 16384, 0),
            surface: cleanText(m.surface, 20) || 'unknown',
            device: cleanText(m.device, 60) || undefined,
          }
        : null;
      if (sharing !== !!s.sharing) {
        audit(sharing ? 'sharing_started' : 'sharing_stopped', {
          code: s.code,
          surface: info?.surface,
          device: info?.device,
          reason: sharing ? undefined : 'client',
        });
      }
      s.sharing = info;
      if (!sharing) s.pipOpen = false;
      return send(other, { t: 'share', sharing, ...(info || {}) });
    }
    case 'pip': {
      if (isTech) return;
      s.pipOpen = !!m.open;
      s.pipMode = cleanText(m.mode, 20);
      return send(other, { t: 'pip', open: s.pipOpen, mode: s.pipMode });
    }
    case 'caption': {
      if (!isTech) return;
      return send(other, { t: 'caption', text: cleanText(m.text, 200) });
    }
    case 'snapshot': {
      if (!isTech) return;
      audit('snapshot_taken', { code: s.code, ticket: s.ticket, techUser: ws.techUser?.user });
      return send(other, { t: 'snapshot' });
    }
    case 'end': {
      if (!isTech) return;
      return endSession(s, `tech:${ws.techUser?.user}`);
    }
    case 'ping':
      return send(ws, { t: 'pong' });
    default:
      if (RELAY[ws.role].has(m.t)) send(other, m);
  }
}

function handleClose(ws) {
  const s = ws.session;
  if (!s) return;
  if (ws.role === 'client' && s.ws.client === ws) {
    s.ws.client = null;
    if (s.sharing && s.status !== 'ended') audit('sharing_stopped', { code: s.code, reason: 'disconnected' });
    s.sharing = null;
    s.pipOpen = false;
    cobrowse.onClientLeft(s);
    send(s.ws.tech, { t: 'peer', role: 'client', present: false });
  } else if (ws.role === 'tech' && s.ws.tech === ws) {
    s.ws.tech = null;
    send(s.ws.client, { t: 'peer', role: 'tech', present: false });
  }
}

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 25000).unref();

server.listen(PORT, () => {
  console.log(`${BRAND_NAME} Assist escuchando en :${PORT} — URL pública ${PUBLIC_URL}`);
  if (!TURN_URLS.length || !TURN_SECRET) console.warn('[aviso] Sin TURN configurado: clientes detrás de redes estrictas podrían no conectar.');
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    for (const s of sessions.values()) endSession(s, 'server_shutdown');
    setTimeout(() => process.exit(0), 500);
  });
}
