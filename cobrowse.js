'use strict';
/*
 * Navegador compartido: un Chromium sin interfaz (contenedor `browser`) abre una
 * pestaña aislada por sesión. Cliente y técnico ven la misma imagen; el técnico
 * solo puede usarla cuando el cliente le da el control.
 *
 * Seguridad:
 *  - Chromium vive en su propio contenedor, sin secretos y en una red interna sin
 *    salida a internet. Todo su tráfico pasa por el proxy de este archivo.
 *  - El proxy resuelve el DNS una sola vez y se conecta a esa IP: bloquea redes
 *    privadas y locales, también ante cambios de DNS a mitad de camino.
 *  - La política del navegador (browser/policy.json) bloquea file://, chrome://,
 *    descargas y el gestor de contraseñas.
 */
const http = require('node:http');
const net = require('node:net');
const dns = require('node:dns').promises;

const VW = 1280;
const VH = 800;
const MAX_BUFFERED = 2 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Direcciones prohibidas (redes privadas, locales, reservadas)
// ---------------------------------------------------------------------------
const BLOCKED = new net.BlockList();
for (const [a, p] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) BLOCKED.addSubnet(a, p, 'ipv4');
// Sin ::ffff:0:0/96: BlockList lo aplica a todo IPv4. Las IPv4 mapeadas se revisan aparte.
for (const [a, p] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64],
  ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]) BLOCKED.addSubnet(a, p, 'ipv6');

function ipBlocked(ip) {
  const fam = net.isIP(ip);
  if (!fam) return true;
  if (fam === 6) {
    const m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (m) return BLOCKED.check(m[1], 'ipv4');
    if (/^::ffff:/i.test(ip)) return true;
  }
  return BLOCKED.check(ip, fam === 4 ? 'ipv4' : 'ipv6');
}

// Devuelve una IP pública para el host o lanza un error.
async function resolvePublic(host) {
  const h = host.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(h) ? [{ address: h }] : await dns.lookup(h, { all: true, verbatim: true });
  if (!addrs.length || addrs.some((a) => ipBlocked(a.address))) throw Object.assign(new Error('blocked'), { code: 'BLOCKED' });
  return addrs[0].address;
}

// ---------------------------------------------------------------------------
// Proxy HTTP/HTTPS para el navegador
// ---------------------------------------------------------------------------
const BLOCK_HEADER = 'x-cobrowse-blocked';
const BLOCK_PAGE = `<!doctype html><meta charset="utf-8"><title>Dirección bloqueada · Address blocked</title>
<style>body{font:17px/1.5 system-ui,sans-serif;color:#16212E;background:#EDF1F4;display:grid;place-items:center;min-height:90vh;margin:0}
div{max-width:30em;padding:32px;background:#fff;border-radius:14px;border:1px solid #D3DCE4}h1{font-size:1.3rem;margin:0 0 8px}p{margin:0 0 6px;color:#475567}</style>
<div><h1>Esta dirección está bloqueada por seguridad</h1><p>El navegador compartido no puede abrir redes privadas ni direcciones internas.</p>
<h1 lang="en" style="margin-top:20px">This address is blocked for security reasons</h1><p lang="en">The shared browser can’t open private networks or internal addresses.</p></div>`;

function startProxy({ port, ports, allowedSource }) {
  const portOk = (p) => ports.includes(p);
  const blocked = (res) => res.writeHead(403, { 'content-type': 'text/html; charset=utf-8', [BLOCK_HEADER]: '1', 'cache-control': 'no-store' }).end(BLOCK_PAGE);

  const server = http.createServer(async (req, res) => {
    if (!(await allowedSource(req.socket.remoteAddress))) return res.writeHead(403).end();
    let u;
    try {
      u = new URL(req.url);
    } catch {
      return res.writeHead(400).end();
    }
    const p = +(u.port || 80);
    if (u.protocol !== 'http:' || !portOk(p)) return blocked(res);
    let ip;
    try {
      ip = await resolvePublic(u.hostname);
    } catch (e) {
      if (e.code === 'BLOCKED') return blocked(res);
      return res.writeHead(502).end();
    }
    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];
    const up = http.request({ host: ip, port: p, method: req.method, path: u.pathname + u.search, headers, setHost: false, timeout: 60000 }, (r) => {
      res.writeHead(r.statusCode, r.statusMessage, r.rawHeaders);
      r.pipe(res);
    });
    up.on('timeout', () => up.destroy());
    up.on('error', () => (res.headersSent ? res.destroy() : res.writeHead(502).end()));
    res.on('close', () => up.destroy());
    req.pipe(up);
  });

  server.on('connect', async (req, sock, head) => {
    sock.on('error', () => {});
    if (!(await allowedSource(sock.remoteAddress))) return sock.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    const m = String(req.url).match(/^\[?([^\]]+?)\]?:(\d+)$/);
    if (!m || !portOk(+m[2])) return sock.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    let ip;
    try {
      ip = await resolvePublic(m[1]);
    } catch (e) {
      return sock.end(e.code === 'BLOCKED' ? 'HTTP/1.1 403 Forbidden\r\n\r\n' : 'HTTP/1.1 502 Bad Gateway\r\n\r\n');
    }
    const up = net.connect({ host: ip, port: +m[2] }, () => {
      sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) up.write(head);
      up.pipe(sock);
      sock.pipe(up);
    });
    up.setTimeout(300000, () => up.destroy());
    up.on('error', () => sock.destroy());
    sock.on('close', () => up.destroy());
  });

  server.listen(port, () => console.log(`[cobrowse] proxy escuchando en :${port}`));
  return server;
}

// ---------------------------------------------------------------------------
// Módulo principal
// ---------------------------------------------------------------------------
function createCobrowse({ url, max, idleMin, proxyPort, ports, audit, send, cleanText }) {
  if (!url) return { enabled: false, summary: () => null, handle() {}, onJoin() {}, onClientLeft() {}, close() {}, sweep() {} };

  let puppeteer;
  try {
    puppeteer = require('puppeteer-core');
  } catch {
    console.warn('[cobrowse] falta puppeteer-core: navegador compartido desactivado.');
    return createCobrowse({ url: '' });
  }

  const target = new URL(url);
  let browser = null;
  let connecting = null;
  let sourceIps = new Set();
  let sourceAt = 0;

  async function refreshSource() {
    try {
      const addrs = await dns.lookup(target.hostname, { all: true });
      sourceIps = new Set(addrs.map((a) => a.address));
    } catch {
      sourceIps = new Set();
    }
    sourceAt = Date.now();
  }
  // Solo el contenedor del navegador puede usar el proxy.
  async function allowedSource(addr) {
    const ip = String(addr || '').replace(/^::ffff:/, '');
    if (sourceIps.has(ip)) return true;
    if (Date.now() - sourceAt > 5000) await refreshSource();
    return sourceIps.has(ip);
  }
  startProxy({ port: proxyPort, ports, allowedSource });

  // Chrome rechaza nombres de host en su puerto de depuración: nos conectamos por IP.
  async function getBrowser() {
    if (browser?.connected) return browser;
    connecting ??= (async () => {
      try {
        const [{ address }] = await dns.lookup(target.hostname, { all: true });
        const base = `${target.protocol}//${net.isIPv6(address) ? `[${address}]` : address}:${target.port || 80}`;
        const info = await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json());
        browser = await puppeteer.connect({ browserWSEndpoint: info.webSocketDebuggerUrl, defaultViewport: null, protocolTimeout: 20000 });
        // Perfiles que quedaron abiertos si la app se reinició con sesiones en curso.
        for (const c of browser.browserContexts()) if (c !== browser.defaultBrowserContext()) await c.close().catch(() => {});
        browser.on('disconnected', () => {
          browser = null;
          for (const s of open) close(s, 'browser_crashed');
        });
        return browser;
      } finally {
        connecting = null;
      }
    })();
    return connecting;
  }

  const open = new Set();

  function broadcast(s, msg) {
    send(s.ws.tech, msg);
    send(s.ws.client, msg);
  }
  function sendFrame(ws, buf) {
    if (ws && ws.readyState === 1 && ws.bufferedAmount < MAX_BUFFERED) ws.send(buf, { binary: true });
  }

  function summary(s) {
    const cb = s.cb;
    return cb ? { open: true, control: cb.control, url: cb.url, title: cb.title } : null;
  }
  function state(s) {
    const cb = s.cb;
    if (!cb) return { t: 'cb-state', open: false };
    return { t: 'cb-state', open: true, ready: !!cb.page, url: cb.url, title: cb.title, loading: cb.loading, control: cb.control, canBack: cb.canBack, canForward: cb.canForward, vw: VW, vh: VH };
  }
  const pushState = (s) => broadcast(s, state(s));

  // Encola llamadas al navegador para respetar el orden de los eventos.
  function enqueue(cb, fn, droppable) {
    if (droppable && cb.pending > 8) return;
    cb.pending++;
    cb.queue = cb.queue.then(fn).catch(() => {}).finally(() => cb.pending--);
  }

  async function refreshHistory(cb) {
    try {
      const h = await cb.cdp.send('Page.getNavigationHistory');
      cb.canBack = h.currentIndex > 0;
      cb.canForward = h.currentIndex < h.entries.length - 1;
    } catch { /* la página pudo cerrarse */ }
  }

  // Conecta una pestaña (la principal o una ventana emergente) a la sesión.
  async function attach(s, page) {
    const cb = s.cb;
    if (!cb || cb.page === page) return;
    if (cb.cdp) await cb.cdp.send('Page.stopScreencast').catch(() => {});
    cb.page = page;
    if (!cb.pages.includes(page)) cb.pages.push(page);
    await page.setViewport({ width: VW, height: VH }).catch(() => {});
    const cdp = await page.createCDPSession();
    cb.cdp = cdp;
    cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      if (s.cb !== cb || cb.cdp !== cdp) return;
      const buf = Buffer.from(data, 'base64');
      cb.lastFrame = buf;
      sendFrame(s.ws.tech, buf);
      sendFrame(s.ws.client, buf);
    });
    cdp.on('Page.fileChooserOpened', () => broadcast(s, { t: 'cb-notice', kind: 'upload' }));
    await cdp.send('Page.enable');
    await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true }).catch(() => {});
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 65, maxWidth: VW, maxHeight: VH, everyNthFrame: 1 });
    cb.url = page.url();
    cb.title = await page.title().catch(() => '');
    await refreshHistory(cb);
    pushState(s);
  }

  const hostOf = (url) => {
    try {
      const u = new URL(url);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.host : '';
    } catch {
      return '';
    }
  };

  function watchPage(s, page) {
    const cb = s.cb;
    const isMainNav = (req) => req.isNavigationRequest() && req.frame() === page.mainFrame();
    // Página de bloqueo del proxy (HTTP) o túnel rechazado (HTTPS).
    page.on('response', (r) => {
      if (s.cb !== cb || !isMainNav(r.request()) || !r.headers()[BLOCK_HEADER]) return;
      cb.blockedUrl = r.url();
      audit('cobrowse_blocked', { code: s.code, host: hostOf(r.url()) });
      broadcast(s, { t: 'cb-notice', kind: 'blocked' });
    });
    page.on('requestfailed', (req) => {
      if (s.cb !== cb || !isMainNav(req)) return;
      const err = req.failure()?.errorText || '';
      if (/ERR_ABORTED/.test(err)) return;
      broadcast(s, { t: 'cb-notice', kind: /TUNNEL_CONNECTION_FAILED/.test(err) ? 'unreachable' : 'nav_failed' });
    });
    page.on('framenavigated', async (f) => {
      if (s.cb !== cb || f !== page.mainFrame()) return;
      if (cb.page === page) {
        cb.url = page.url();
        await refreshHistory(cb);
        pushState(s);
      }
      const host = hostOf(page.url());
      if (page.url() === cb.blockedUrl) {
        cb.blockedUrl = '';
        cb.lastHost = '';
      } else if (host && host !== cb.lastHost) {
        cb.lastHost = host;
        audit('cobrowse_navigated', { code: s.code, host });
      }
    });
    page.on('load', async () => {
      if (s.cb !== cb || cb.page !== page) return;
      cb.loading = false;
      cb.title = cleanText(await page.title().catch(() => ''), 200);
      pushState(s);
    });
    page.on('dialog', (d) => {
      broadcast(s, { t: 'cb-notice', kind: 'dialog', text: cleanText(d.message(), 300) });
      (d.type() === 'prompt' ? d.dismiss() : d.accept()).catch(() => {});
    });
    page.on('close', () => {
      if (s.cb !== cb) return;
      cb.pages = cb.pages.filter((p) => p !== page);
      if (cb.page === page) {
        cb.page = null;
        cb.cdp = null;
        const prev = cb.pages[cb.pages.length - 1];
        if (prev) attach(s, prev).catch(() => {});
        else close(s, 'page_closed');
      }
    });
  }

  async function openFor(s) {
    if (s.cb) return pushState(s);
    if (open.size >= max) return send(s.ws.client, { t: 'cb-error', error: 'busy' });
    const cb = { control: false, pages: [], page: null, cdp: null, queue: Promise.resolve(), pending: 0, url: '', title: '', loading: false, canBack: false, canForward: false, lastFrame: null, lastHost: '', lastActivity: Date.now(), ctx: null };
    s.cb = cb;
    open.add(s);
    pushState(s);
    try {
      const b = await getBrowser();
      cb.ctx = await b.createBrowserContext();
      if (s.cb !== cb) return cb.ctx.close().catch(() => {});
      // Las ventanas emergentes se muestran en lugar de la pestaña actual.
      cb.ctx.on('targetcreated', async (t) => {
        if (t.type() !== 'page' || s.cb !== cb) return;
        const p = await t.page().catch(() => null);
        if (!p || cb.pages.includes(p)) return;
        watchPage(s, p);
        attach(s, p).catch(() => {});
      });
      const page = await cb.ctx.newPage();
      if (s.cb !== cb) return;
      if (!cb.pages.includes(page)) {
        watchPage(s, page);
        await attach(s, page);
      }
      audit('cobrowse_started', { code: s.code, ticket: s.ticket, clientName: s.accepted?.name });
    } catch (e) {
      console.error('[cobrowse] no se pudo abrir:', e.message);
      send(s.ws.client, { t: 'cb-error', error: 'unavailable' });
      close(s, 'error', true);
    }
  }

  function close(s, by, silent) {
    const cb = s.cb;
    if (!cb) return;
    s.cb = null;
    open.delete(s);
    cb.cdp?.send('Page.stopScreencast').catch(() => {});
    cb.ctx?.close().catch(() => {});
    pushState(s);
    if (!silent) audit('cobrowse_ended', { code: s.code, by });
  }

  function setControl(s, grant, reason) {
    const cb = s.cb;
    if (!cb || cb.control === grant) return;
    cb.control = grant;
    audit(grant ? 'cobrowse_control_granted' : 'cobrowse_control_revoked', { code: s.code, clientName: s.accepted?.name, techUser: s.techUser, reason });
    pushState(s);
  }

  function normalizeUrl(raw) {
    let v = cleanText(raw, 2000);
    if (!v) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = `https://${v}`;
    try {
      const u = new URL(v);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
    } catch {
      return null;
    }
  }

  const num = (v, min, max, def) => (Number.isFinite(+v) ? Math.min(max, Math.max(min, +v)) : def);
  const BUTTONS = new Set(['none', 'left', 'middle', 'right']);
  const MOUSE = { down: 'mousePressed', up: 'mouseReleased', move: 'mouseMoved' };

  function input(s, m) {
    const cb = s.cb;
    if (!cb?.cdp) return;
    const cdp = cb.cdp;
    cb.lastActivity = Date.now();
    const modifiers = num(m.mods, 0, 15, 0) | 0;
    switch (m.kind) {
      case 'mouse': {
        const type = MOUSE[m.type];
        if (!type) return;
        const button = BUTTONS.has(m.button) ? m.button : 'none';
        const ev = { type, x: num(m.x, 0, 1, 0) * VW, y: num(m.y, 0, 1, 0) * VH, button, buttons: num(m.buttons, 0, 7, 0) | 0, clickCount: num(m.count, 0, 3, 0) | 0, modifiers };
        return enqueue(cb, () => cdp.send('Input.dispatchMouseEvent', ev), type === 'mouseMoved');
      }
      case 'wheel': {
        const ev = { type: 'mouseWheel', x: num(m.x, 0, 1, 0) * VW, y: num(m.y, 0, 1, 0) * VH, deltaX: num(m.dx, -3000, 3000, 0), deltaY: num(m.dy, -3000, 3000, 0), modifiers };
        return enqueue(cb, () => cdp.send('Input.dispatchMouseEvent', ev), true);
      }
      case 'key': {
        if (m.type !== 'down' && m.type !== 'up') return;
        const key = typeof m.key === 'string' ? m.key.slice(0, 32) : '';
        if (!key || key === 'Dead' || key === 'Process') return;
        const code = typeof m.code === 'string' ? m.code.slice(0, 32) : '';
        const keyCode = num(m.keyCode, 0, 255, 0) | 0;
        const printable = [...key].length === 1 && !(modifiers & 6);
        const text = key === 'Enter' ? '\r' : printable ? key : undefined;
        const ev =
          m.type === 'down'
            ? { type: text ? 'keyDown' : 'rawKeyDown', key, code, text, unmodifiedText: text, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers, autoRepeat: !!m.repeat }
            : { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
        return enqueue(cb, () => cdp.send('Input.dispatchKeyEvent', ev));
      }
      case 'text': {
        const text = typeof m.text === 'string' ? m.text.slice(0, 5000) : '';
        if (text) enqueue(cb, () => cdp.send('Input.insertText', { text }));
      }
    }
  }

  function navigate(s, m) {
    const cb = s.cb;
    const page = cb?.page;
    if (!page) return;
    cb.lastActivity = Date.now();
    // Sin pasar por la cola: una página lenta no debe retrasar los clics.
    const opts = { waitUntil: 'domcontentloaded', timeout: 30000 };
    const done = () => {
      if (s.cb !== cb) return;
      cb.loading = false;
      pushState(s);
    };
    let nav;
    if (m.action === 'go') {
      const href = normalizeUrl(m.url);
      if (!href) return broadcast(s, { t: 'cb-notice', kind: 'bad_url' });
      nav = page.goto(href, opts);
    } else {
      nav = { back: () => page.goBack(opts), forward: () => page.goForward(opts), reload: () => page.reload(opts) }[m.action]?.();
    }
    if (!nav) return;
    cb.loading = true;
    pushState(s);
    nav.then(done, done); // los errores de carga los avisa el evento requestfailed
  }

  // Mensajes cb-* del WebSocket. isTech indica quién los envía.
  function handle(ws, s, m, isTech) {
    switch (m.t) {
      case 'cb-open':
        if (!isTech) openFor(s);
        return;
      case 'cb-close':
        return close(s, isTech ? `tech:${ws.techUser?.user}` : 'client');
      case 'cb-control':
        if (!isTech) setControl(s, !!m.grant, 'client');
        return;
      case 'cb-control-request':
        if (isTech && s.cb && !s.cb.control) send(s.ws.client, { t: 'cb-control-request', techName: ws.techUser?.name });
        return;
      case 'cb-nav':
        if (!isTech || s.cb?.control) navigate(s, m);
        return;
      case 'cb-input':
        if (!isTech || s.cb?.control) input(s, m);
        return;
    }
  }

  // Al conectarse alguien: estado actual y última imagen.
  function onJoin(ws, s) {
    send(ws, state(s));
    if (s.cb?.lastFrame) sendFrame(ws, s.cb.lastFrame);
  }

  function onClientLeft(s) {
    setControl(s, false, 'disconnected');
  }

  function sweep(now) {
    for (const s of open) if (now - s.cb.lastActivity > idleMin * 60 * 1000) close(s, 'idle');
  }

  console.log(`[cobrowse] activado (navegador en ${url}, máximo ${max} a la vez)`);
  return { enabled: true, summary, handle, onJoin, onClientLeft, close, sweep };
}

module.exports = { createCobrowse, ipBlocked };
