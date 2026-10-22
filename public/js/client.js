import { drawScene, annBBox, viewportFor, pruneExpired, sanitizeAnn } from './annotate.js';
import { CobrowseView } from './cobrowse-view.js';

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------
const STR = {
  es: {
    pageTitle: 'Soporte remoto · {brand}',
    langLabel: 'Idioma',
    loading: 'Cargando…',
    codeTitle: 'Ingresa tu código de sesión',
    codeLede: 'Tu técnico te dio un código de 9 dígitos.',
    codeLabel: 'Código de sesión',
    codeSubmit: 'Continuar',
    codeInvalid: 'El código tiene 9 dígitos.',
    errNotFoundTitle: 'Este enlace no es válido',
    errNotFound: 'Revisa que el enlace esté completo o pide uno nuevo a tu técnico.',
    errExpiredTitle: 'Este enlace caducó',
    errExpired: 'Por seguridad, los enlaces duran poco tiempo. Pide uno nuevo a tu técnico.',
    errEndedTitle: 'Esta sesión ya terminó',
    errEnded: 'Si necesitas más ayuda, pide un enlace nuevo a tu técnico.',
    errReplacedTitle: 'La sesión se abrió en otra ventana',
    errReplaced: 'Continúa en la otra ventana, o recarga esta página para seguir aquí.',
    errNetworkTitle: 'Sin conexión',
    errNetwork: 'No se pudo conectar. Revisa tu conexión a internet e inténtalo de nuevo.',
    retry: 'Reintentar',
    termsTitle: 'Sesión de soporte con {tech}',
    termsLede: '{tech} podrá ver solo lo que tú elijas compartir y señalarte dónde hacer clic. No puede mover tu mouse ni escribir en tu equipo. Si usas el navegador compartido, tú decides si le das permiso para usarlo.',
    demoAlt: 'Ejemplo: tu técnico resalta un botón en tu pantalla para indicarte dónde hacer clic.',
    demoCaption: 'Haz clic aquí',
    factChoose: 'Tú eliges qué compartir: toda la pantalla, una ventana o una pestaña.',
    factStop: 'Puedes dejar de compartir en cualquier momento.',
    factNothing: 'No se instala nada en tu equipo.',
    termsHeading: 'Términos del servicio',
    nameLabel: 'Tu nombre completo',
    agreeLabel: 'Leí y acepto los términos del servicio.',
    acceptBtn: 'Aceptar y continuar',
    sessionCode: 'Código de sesión',
    errName: 'Escribe tu nombre completo.',
    errAgree: 'Para continuar, marca la casilla de aceptación.',
    errTermsChanged: 'Los términos se actualizaron. Revísalos y acéptalos de nuevo.',
    readyTitle: 'Todo listo, {name}',
    techConnected: '{tech} está conectado.',
    techWaiting: 'Esperando a que {tech} se conecte…',
    shareBtn: 'Compartir mi pantalla',
    shareHint: 'Tu navegador te preguntará qué quieres compartir. Elige la ventana o la pantalla donde necesitas ayuda.',
    unsupportedTitle: 'Este dispositivo no puede compartir la pantalla',
    unsupported: 'Los navegadores de celulares y tabletas no permiten compartir la pantalla. Abre este enlace en una computadora con Chrome, Edge, Firefox o Safari.',
    shareCancelled: 'No se compartió nada. Puedes intentarlo de nuevo cuando quieras.',
    shareFailed: 'No se pudo compartir la pantalla. Revisa los permisos del navegador e inténtalo de nuevo.',
    sharingWith: 'Compartiendo tu pantalla con {tech}',
    sharingWaiting: 'Compartiendo. {tech} verá tu pantalla en cuanto se conecte.',
    viewLabel: 'Vista',
    viewAuto: 'Acercar',
    viewFull: 'Ver todo',
    pipOpen: 'Abrir ventana flotante',
    pipShow: 'Traer ventana flotante',
    stopBtn: 'Dejar de compartir',
    pipHint: 'Abre la ventana flotante para ver las indicaciones de {tech} mientras trabajas en otras ventanas.',
    pipHintOpen: 'La ventana flotante está abierta. Muévela a una esquina donde no te estorbe.',
    pipHintFirefox: 'Para ver las indicaciones sobre otras ventanas, pasa el mouse sobre la imagen y pulsa el botón de imagen en imagen.',
    pipStatus: '{tech} te está guiando',
    pipWaiting: 'Esperando a {tech}…',
    pipStop: 'Detener',
    snapshotToast: '{tech} tomó una captura de tu pantalla compartida para documentar el caso.',
    techLeftToast: '{tech} se desconectó. Puede volver en cualquier momento.',
    stoppedToast: 'Dejaste de compartir tu pantalla.',
    endedTitle: 'Sesión finalizada',
    ended: 'Ya no se está compartiendo tu pantalla. Puedes cerrar esta pestaña.',
    cbOpen: 'Usar el navegador compartido',
    cbOpenShort: 'Navegador compartido',
    cbReturn: 'Volver al navegador compartido',
    cbOpenHint: 'Abre páginas web en un navegador seguro que {tech} ve contigo. Si quieres, puedes darle el control para que haga los pasos por ti.',
    cbTitle: 'Navegador compartido',
    cbSub: '{tech} ve este navegador contigo, pero no el resto de tu equipo.',
    cbSubControl: '{tech} puede usar este navegador. Tú también puedes seguir usándolo.',
    cbGrant: 'Dar el control a {tech}',
    cbRevoke: 'Quitar el control',
    cbBack: 'Volver',
    cbClose: 'Cerrar navegador',
    cbControlOn: '{tech} tiene el control de este navegador. Puedes quitárselo cuando quieras.',
    cbRequest: '{tech} te pide el control del navegador compartido para hacer los pasos por ti.',
    cbRequestToast: '{tech} te pide el control del navegador compartido. Ábrelo para responder.',
    cbAllow: 'Permitir',
    cbDeny: 'Ahora no',
    cbNavBack: 'Atrás',
    cbNavForward: 'Adelante',
    cbNavReload: 'Recargar',
    cbUrlLabel: 'Dirección web',
    cbUrlPlaceholder: 'Escribe una dirección, por ejemplo google.com',
    cbGo: 'Ir',
    cbStarting: 'Abriendo el navegador…',
    cbLoading: 'Cargando la página…',
    cbHint: 'Úsalo como cualquier navegador: haz clic, escribe y desplázate. Las descargas y la subida de archivos no están disponibles. {tech} ve todo lo que escribas aquí, incluidas las contraseñas.',
    cbBusy: 'El navegador compartido está ocupado ahora mismo. Inténtalo de nuevo en unos minutos.',
    cbUnavailable: 'No se pudo abrir el navegador compartido. Inténtalo de nuevo.',
    cbUpload: 'Subir archivos no está disponible en el navegador compartido.',
    cbDialog: 'La página mostró un aviso: {text}',
    cbBadUrl: 'Esa dirección no es válida. Escribe una dirección web, por ejemplo google.com.',
    cbNavFailed: 'No se pudo abrir esa página. Revisa la dirección o inténtalo más tarde.',
    cbBlocked: 'Esa dirección está bloqueada por seguridad: el navegador compartido no puede abrir redes privadas ni direcciones internas.',
    cbUnreachable: 'No se pudo abrir esa página. Puede que no esté disponible o que sea una dirección interna, que está bloqueada por seguridad.',
    cbClosedToast: 'Se cerró el navegador compartido.',
  },
  en: {
    pageTitle: 'Remote support · {brand}',
    langLabel: 'Language',
    loading: 'Loading…',
    codeTitle: 'Enter your session code',
    codeLede: 'Your technician gave you a 9-digit code.',
    codeLabel: 'Session code',
    codeSubmit: 'Continue',
    codeInvalid: 'The code has 9 digits.',
    errNotFoundTitle: 'This link isn’t valid',
    errNotFound: 'Check that the link is complete, or ask your technician for a new one.',
    errExpiredTitle: 'This link has expired',
    errExpired: 'For your security, links only last a short time. Ask your technician for a new one.',
    errEndedTitle: 'This session has ended',
    errEnded: 'If you need more help, ask your technician for a new link.',
    errReplacedTitle: 'The session was opened in another window',
    errReplaced: 'Continue in the other window, or reload this page to continue here.',
    errNetworkTitle: 'No connection',
    errNetwork: 'Couldn’t connect. Check your internet connection and try again.',
    retry: 'Try again',
    termsTitle: 'Support session with {tech}',
    termsLede: '{tech} will only see what you choose to share and can point to where you should click. They can’t move your mouse or type on your computer. If you use the shared browser, you decide whether to let them use it.',
    demoAlt: 'Example: your technician highlights a button on your screen to show you where to click.',
    demoCaption: 'Click here',
    factChoose: 'You choose what to share: your whole screen, one window, or one tab.',
    factStop: 'You can stop sharing at any time.',
    factNothing: 'Nothing gets installed on your computer.',
    termsHeading: 'Terms of service',
    nameLabel: 'Your full name',
    agreeLabel: 'I have read and accept the terms of service.',
    acceptBtn: 'Accept and continue',
    sessionCode: 'Session code',
    errName: 'Enter your full name.',
    errAgree: 'To continue, check the box to accept.',
    errTermsChanged: 'The terms were updated. Please review and accept them again.',
    readyTitle: 'You’re all set, {name}',
    techConnected: '{tech} is connected.',
    techWaiting: 'Waiting for {tech} to connect…',
    shareBtn: 'Share my screen',
    shareHint: 'Your browser will ask what you want to share. Pick the window or screen you need help with.',
    unsupportedTitle: 'This device can’t share its screen',
    unsupported: 'Phone and tablet browsers don’t allow screen sharing. Open this link on a computer with Chrome, Edge, Firefox, or Safari.',
    shareCancelled: 'Nothing was shared. You can try again whenever you’re ready.',
    shareFailed: 'Your screen couldn’t be shared. Check your browser permissions and try again.',
    sharingWith: 'Sharing your screen with {tech}',
    sharingWaiting: 'Sharing. {tech} will see your screen as soon as they connect.',
    viewLabel: 'View',
    viewAuto: 'Zoom in',
    viewFull: 'Show all',
    pipOpen: 'Open floating window',
    pipShow: 'Bring floating window forward',
    stopBtn: 'Stop sharing',
    pipHint: 'Open the floating window to see {tech}’s directions while you work in other windows.',
    pipHintOpen: 'The floating window is open. Move it to a corner where it won’t get in your way.',
    pipHintFirefox: 'To see directions over other windows, hover over the image and click the picture-in-picture button.',
    pipStatus: '{tech} is guiding you',
    pipWaiting: 'Waiting for {tech}…',
    pipStop: 'Stop',
    snapshotToast: '{tech} took a screenshot of your shared screen to document the case.',
    techLeftToast: '{tech} disconnected. They can rejoin at any time.',
    stoppedToast: 'You stopped sharing your screen.',
    endedTitle: 'Session ended',
    ended: 'Your screen is no longer being shared. You can close this tab.',
    cbOpen: 'Use the shared browser',
    cbOpenShort: 'Shared browser',
    cbReturn: 'Back to the shared browser',
    cbOpenHint: 'Open web pages in a secure browser that {tech} sees with you. If you like, you can give them control so they can do the steps for you.',
    cbTitle: 'Shared browser',
    cbSub: '{tech} sees this browser with you, but not the rest of your computer.',
    cbSubControl: '{tech} can use this browser. You can keep using it too.',
    cbGrant: 'Give {tech} control',
    cbRevoke: 'Take back control',
    cbBack: 'Back',
    cbClose: 'Close browser',
    cbControlOn: '{tech} has control of this browser. You can take it back at any time.',
    cbRequest: '{tech} is asking for control of the shared browser to do the steps for you.',
    cbRequestToast: '{tech} is asking for control of the shared browser. Open it to respond.',
    cbAllow: 'Allow',
    cbDeny: 'Not now',
    cbNavBack: 'Back',
    cbNavForward: 'Forward',
    cbNavReload: 'Reload',
    cbUrlLabel: 'Web address',
    cbUrlPlaceholder: 'Type an address, for example google.com',
    cbGo: 'Go',
    cbStarting: 'Opening the browser…',
    cbLoading: 'Loading the page…',
    cbHint: 'Use it like any browser: click, type, and scroll. Downloads and file uploads aren’t available. {tech} sees everything you type here, including passwords.',
    cbBusy: 'The shared browser is busy right now. Please try again in a few minutes.',
    cbUnavailable: 'The shared browser couldn’t be opened. Please try again.',
    cbUpload: 'File uploads aren’t available in the shared browser.',
    cbDialog: 'The page showed a message: {text}',
    cbBadUrl: 'That address isn’t valid. Type a web address, for example google.com.',
    cbNavFailed: 'That page couldn’t be opened. Check the address or try again later.',
    cbBlocked: 'That address is blocked for security reasons: the shared browser can’t open private networks or internal addresses.',
    cbUnreachable: 'That page couldn’t be opened. It may be unavailable, or it may be an internal address, which is blocked for security reasons.',
    cbClosedToast: 'The shared browser was closed.',
  },
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
// Almacenamiento tolerante a navegadores que lo bloquean. session=true → sessionStorage.
const store = {
  get(k, session) {
    try {
      return (session ? sessionStorage : localStorage).getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v, session) {
    try {
      const s = session ? sessionStorage : localStorage;
      if (v == null) s.removeItem(k);
      else s.setItem(k, v);
    } catch {
      /* sin almacenamiento: la sesión sigue funcionando en esta pestaña */
    }
  },
};

const DOC_PIP = 'documentPictureInPicture' in window;
const VIDEO_PIP = !DOC_PIP && !!document.pictureInPictureEnabled;
const IS_MOBILE = navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const CAN_SHARE = !!navigator.mediaDevices?.getDisplayMedia && !IS_MOBILE;

const st = {
  lang: 'es',
  brand: 'Nibbletec',
  code: null,
  info: null,
  token: null,
  name: '',
  screen: 'loading',
  errorKind: null,
  techName: '',
  techPresent: false,
  ended: false,
  ws: null,
  wsRetry: 0,
  stream: null,
  pc: null,
  peerGen: 0,
  pendingIce: [],
  ice: null,
  sharing: false,
  anns: [],
  draft: null,
  pointer: null,
  caption: '',
  viewMode: 'auto',
  focus: null,
  focusTarget: null,
  lastStep: 0,
  ptrAnchor: null,
  ptrHiddenAt: 0,
  pip: null,
  cbEnabled: false,
  cb: { open: false },
  cbRequest: false,
};

const srcVideo = $('#src-video');
const viewCanvas = $('#view-canvas');
const viewVideo = $('#view-video');
const viewCtx = viewCanvas.getContext('2d');
const cbView = new CobrowseView($('#cb-canvas'), { send: (m) => sendMsg(m), canControl: () => !!st.cb.ready });

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------
function t(key) {
  const s = (STR[st.lang] && STR[st.lang][key]) ?? STR.es[key] ?? key;
  return s
    .replaceAll('{tech}', st.techName || (st.lang === 'en' ? 'your technician' : 'tu técnico'))
    .replaceAll('{name}', st.name.split(' ')[0] || '')
    .replaceAll('{brand}', st.brand);
}

function translate(root) {
  for (const el of $$('[data-i18n]', root)) el.textContent = t(el.dataset.i18n);
  for (const el of $$('[data-i18n-aria]', root)) el.setAttribute('aria-label', t(el.dataset.i18nAria));
}

function applyI18n() {
  document.documentElement.lang = st.lang;
  document.title = t('pageTitle');
  translate(document);
  for (const b of $$('.lang [data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === st.lang));
  if (st.screen === 'error') renderError(st.errorKind);
  renderTerms();
  if (st.pip?.doc) {
    st.pip.doc.documentElement.lang = st.lang;
    translate(st.pip.doc);
  }
  renderStatus();
  renderPipHint();
  renderCb();
}

function setLang(l) {
  if (!STR[l]) return;
  st.lang = l;
  store.set('na_lang', l);
  applyI18n();
}

// ---------------------------------------------------------------------------
// Pantallas
// ---------------------------------------------------------------------------
function show(name) {
  st.screen = name;
  for (const s of $$('[data-screen]')) s.hidden = s.dataset.screen !== name;
  applyI18n();
  const h = $(`[data-screen="${name}"] h1`);
  if (h && name !== 'loading') {
    h.tabIndex = -1;
    h.focus({ preventScroll: true });
  }
}

const ERRORS = {
  not_found: ['errNotFoundTitle', 'errNotFound'],
  expired: ['errExpiredTitle', 'errExpired'],
  ended: ['errEndedTitle', 'errEnded'],
  replaced: ['errReplacedTitle', 'errReplaced'],
  network: ['errNetworkTitle', 'errNetwork'],
};
function renderError(kind) {
  const [tk, bk] = ERRORS[kind] || ERRORS.not_found;
  $('#error-title').textContent = t(tk);
  $('#error-text').textContent = t(bk);
  $('#retry-btn').hidden = !(kind === 'network' || kind === 'replaced');
}
function showError(kind) {
  st.errorKind = kind;
  show('error');
}

function toast(text) {
  for (const host of [$('#toasts'), st.pip?.doc?.querySelector('.toasts')]) {
    if (!host) continue;
    const el = host.ownerDocument.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    host.append(el);
    setTimeout(() => el.remove(), 6000);
  }
}

function renderTerms() {
  const terms = st.info?.terms?.[st.lang];
  const box = $('#terms-box');
  if (terms && box.dataset.version !== terms.version) {
    box.innerHTML = terms.html; // contenido propio del servidor (carpeta terms/)
    box.dataset.version = terms.version;
    box.scrollTop = 0;
  }
  for (const el of $$('[data-code]')) el.textContent = st.code ? formatCode(st.code) : '';
}

function renderStatus() {
  for (const el of $$('[data-tech-status]')) {
    el.classList.toggle('on', st.techPresent);
    $('.status-text', el).textContent = t(st.techPresent ? 'techConnected' : 'techWaiting');
  }
  $('#live-text').textContent = t(st.techPresent ? 'sharingWith' : 'sharingWaiting');
  const pipStatus = st.pip?.doc?.querySelector('.pip-status-text');
  if (pipStatus) pipStatus.textContent = t(st.techPresent ? 'pipStatus' : 'pipWaiting');
}

function renderPipHint() {
  const hint = $('#pip-hint');
  const btn = $('#pip-btn');
  if (!DOC_PIP && !VIDEO_PIP) {
    hint.textContent = t('pipHintFirefox');
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  btn.textContent = t(st.pip ? 'pipShow' : 'pipOpen');
  btn.classList.toggle('primary', !st.pip);
  hint.textContent = t(st.pip ? 'pipHintOpen' : 'pipHint');
}

const formatCode = (c) => c.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');

// ---------------------------------------------------------------------------
// Sesión y aceptación de términos
// ---------------------------------------------------------------------------
async function loadSession(code) {
  st.code = code;
  show('loading');
  let res;
  try {
    res = await fetch(`/api/s/${code}`);
  } catch {
    return showError('network');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return showError(body.error === 'expired' || body.error === 'ended' ? body.error : 'not_found');
  }
  st.info = await res.json();
  st.brand = st.info.brand || st.brand;
  st.techName = st.info.techName || '';
  st.cbEnabled = !!st.info.cobrowse;
  for (const el of $$('[data-brand]')) el.textContent = st.brand;
  if (!store.get('na_lang') && STR[st.info.lang]) st.lang = st.info.lang;

  st.token = store.get(`na_token_${code}`, true);
  st.name = store.get(`na_name_${code}`, true) || '';
  if (st.token) {
    show('ready');
    connectWS();
  } else {
    show('terms');
  }
}

$('#accept-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#accept-error');
  const name = $('#name-input').value.trim().replace(/\s+/g, ' ');
  const agree = $('#agree-input').checked;
  err.hidden = true;
  if (name.length < 2) {
    err.textContent = t('errName');
    err.hidden = false;
    $('#name-input').focus();
    return;
  }
  if (!agree) {
    err.textContent = t('errAgree');
    err.hidden = false;
    $('#agree-input').focus();
    return;
  }
  const btn = $('#accept-btn');
  btn.disabled = true;
  try {
    const res = await fetch(`/api/s/${st.code}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, lang: st.lang, version: st.info.terms[st.lang]?.version, agree: true }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 409) {
      const fresh = await fetch(`/api/s/${st.code}`).then((r) => r.json());
      st.info = fresh;
      $('#agree-input').checked = false;
      renderTerms();
      err.textContent = t('errTermsChanged');
      err.hidden = false;
      return;
    }
    if (!res.ok) {
      if (body.error === 'expired' || body.error === 'ended' || body.error === 'not_found') return showError(body.error);
      err.textContent = t(body.error === 'name_required' ? 'errName' : 'errNetwork');
      err.hidden = false;
      return;
    }
    st.token = body.token;
    st.name = name;
    store.set(`na_token_${st.code}`, st.token, true);
    store.set(`na_name_${st.code}`, name, true);
    show('ready');
    connectWS();
  } catch {
    err.textContent = t('errNetwork');
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

$('#code-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const digits = $('#code-input').value.replace(/\D/g, '');
  const err = $('#code-error');
  if (digits.length !== 9) {
    err.textContent = t('codeInvalid');
    err.hidden = false;
    return;
  }
  history.replaceState(null, '', `/s/${digits}`);
  loadSession(digits);
});
$('#code-input').addEventListener('input', (e) => {
  const d = e.target.value.replace(/\D/g, '').slice(0, 9);
  e.target.value = d.replace(/(\d{3})(?=\d)/g, '$1 ');
});

$('#retry-btn').addEventListener('click', () => location.reload());
for (const b of $$('.lang [data-lang]')) b.addEventListener('click', () => setLang(b.dataset.lang));

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
function connectWS() {
  if (st.ended || !st.token) return;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  st.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', role: 'client', code: st.code, token: st.token }));
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
    // Se queda en la pantalla del navegador: al reconectar, el servidor manda el estado real.
    if (st.cb.open) {
      st.cb = { ...st.cb, ready: false };
      renderCb();
    }
    if (st.techPresent) {
      st.techPresent = false;
      renderStatus();
    }
    if (e.code === 4003) {
      // El token ya no sirve (p. ej. el servidor se reinició): volver a aceptar.
      store.set(`na_token_${st.code}`, null, true);
      st.token = null;
      stopShare();
      return loadSession(st.code);
    }
    if (e.code === 4004 || e.code === 4010) {
      st.ended = true;
      stopShare();
      return show('ended');
    }
    if (e.code === 4001) {
      stopShare();
      return showError('replaced');
    }
    if (!st.ended) setTimeout(connectWS, Math.min(10000, 800 * 2 ** st.wsRetry++));
  };
}

function sendMsg(m) {
  if (st.ws?.readyState === 1) st.ws.send(JSON.stringify(m));
}

function onMessage(m) {
  switch (m.t) {
    case 'joined':
      st.wsRetry = 0;
      if (m.techName) st.techName = m.techName;
      setTechPresent(m.techPresent);
      if (st.sharing) {
        sendShareState();
        if (st.pip) sendMsg({ t: 'pip', open: true, mode: st.pip.mode });
        if (st.techPresent) startPeer();
      }
      break;
    case 'peer':
      if (m.role !== 'tech') break;
      if (m.techName) st.techName = m.techName;
      if (!m.present && st.techPresent) toast(t('techLeftToast'));
      setTechPresent(m.present);
      if (m.present && st.sharing) {
        sendShareState();
        if (st.pip) sendMsg({ t: 'pip', open: true, mode: st.pip.mode });
        startPeer();
      }
      if (!m.present) {
        st.pointer = null;
        st.draft = null;
      }
      break;
    case 'answer':
      onAnswer(m);
      break;
    case 'ice':
      onRemoteIce(m);
      break;
    case 'ann':
      onAnn(m);
      break;
    case 'caption':
      st.caption = m.text || '';
      break;
    case 'snapshot':
      toast(t('snapshotToast'));
      break;
    case 'cb-state':
      onCbState(m);
      break;
    case 'cb-error':
      toast(t(m.error === 'busy' ? 'cbBusy' : 'cbUnavailable'));
      if (st.screen === 'cobrowse' && !st.cb.open) leaveCb();
      break;
    case 'cb-notice': {
      const key = { upload: 'cbUpload', dialog: 'cbDialog', bad_url: 'cbBadUrl', nav_failed: 'cbNavFailed', blocked: 'cbBlocked', unreachable: 'cbUnreachable' }[m.kind];
      if (key) toast(t(key).replace('{text}', m.text || ''));
      break;
    }
    case 'cb-control-request':
      if (!st.cb.open || st.cb.control) break;
      st.cbRequest = true;
      if (st.screen !== 'cobrowse') toast(t('cbRequestToast'));
      renderCb();
      break;
    case 'ended':
      st.ended = true;
      stopShare();
      onCbState({ open: false }, true);
      show('ended');
      break;
  }
}

function setTechPresent(v) {
  st.techPresent = !!v;
  applyI18n();
}

// ---------------------------------------------------------------------------
// Compartir pantalla + WebRTC
// ---------------------------------------------------------------------------
$('#share-btn').addEventListener('click', startShare);
$('#stop-btn').addEventListener('click', () => {
  stopShare();
  toast(t('stoppedToast'));
});
$('#pip-btn').addEventListener('click', () => openPip().catch((e) => console.warn('PiP', e)));
for (const b of $$('.seg [data-mode]')) b.addEventListener('click', () => setViewMode(b.dataset.mode));

async function startShare() {
  if (!CAN_SHARE || st.sharing) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 15, max: 24 } },
      audio: false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      monitorTypeSurfaces: 'include',
    });
  } catch (e) {
    toast(t(e.name === 'NotAllowedError' || e.name === 'AbortError' ? 'shareCancelled' : 'shareFailed'));
    return;
  }
  const track = stream.getVideoTracks()[0];
  try {
    track.contentHint = 'detail'; // prioriza nitidez del texto sobre fluidez
  } catch { /* opcional */ }
  track.addEventListener('ended', () => {
    if (st.stream === stream) {
      stopShare();
      toast(t('stoppedToast'));
    }
  });
  st.stream = stream;
  st.sharing = true;
  st.focus = null;
  st.focusTarget = null;
  srcVideo.srcObject = stream;
  srcVideo.play().catch(() => {});
  show('sharing');
  setupView();
  await new Promise((r) => (srcVideo.videoWidth ? r() : srcVideo.addEventListener('loadedmetadata', r, { once: true })));
  sendShareState();
  if (st.techPresent) startPeer();
  // Si el navegador aún considera activo el clic, abrimos la ventana flotante directamente.
  if (DOC_PIP && navigator.userActivation?.isActive) openPip().catch(() => {});
}

srcVideo.addEventListener('resize', () => {
  if (!st.sharing) return;
  st.focus = null;
  st.focusTarget = null;
  sendShareState();
});

function sendShareState() {
  if (!st.stream) return;
  const s = st.stream.getVideoTracks()[0]?.getSettings?.() || {};
  sendMsg({
    t: 'share',
    sharing: true,
    w: srcVideo.videoWidth || s.width || 0,
    h: srcVideo.videoHeight || s.height || 0,
    surface: s.displaySurface || 'unknown',
  });
}

function stopShare() {
  const wasSharing = st.sharing;
  st.sharing = false;
  st.peerGen++;
  if (st.stream) for (const tr of st.stream.getTracks()) tr.stop();
  st.stream = null;
  st.pc?.close();
  st.pc = null;
  srcVideo.srcObject = null;
  closePip();
  stopLoops();
  if (wasSharing) sendMsg({ t: 'share', sharing: false });
  if (!st.ended && st.screen === 'sharing') show('ready');
}

async function getIce() {
  if (st.ice && Date.now() - st.ice.at < 10 * 60 * 1000) return st.ice.servers;
  try {
    const res = await fetch('/api/ice', { headers: { authorization: `Bearer ${st.token}`, 'x-session-code': st.code } });
    const body = await res.json();
    st.ice = { at: Date.now(), servers: body.iceServers || [] };
  } catch {
    st.ice = { at: 0, servers: [] };
  }
  return st.ice.servers;
}

async function startPeer() {
  if (!st.stream) return;
  const gen = ++st.peerGen;
  st.pc?.close();
  st.pc = null;
  const iceServers = await getIce();
  if (gen !== st.peerGen || !st.stream) return;
  const pc = new RTCPeerConnection({ iceServers });
  st.pc = pc;
  st.pendingIce = [];
  for (const tr of st.stream.getTracks()) pc.addTrack(tr, st.stream);
  pc.onicecandidate = (e) => e.candidate && sendMsg({ t: 'ice', gen, candidate: e.candidate });
  pc.onconnectionstatechange = () => {
    if (pc !== st.pc) return;
    if (pc.connectionState === 'failed' && st.sharing && st.techPresent) {
      setTimeout(() => pc === st.pc && startPeer(), 1500);
    }
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  try {
    const sender = pc.getSenders()[0];
    const p = sender.getParameters();
    p.degradationPreference = 'maintain-resolution';
    if (p.encodings?.[0]) p.encodings[0].maxBitrate = 3_500_000;
    await sender.setParameters(p);
  } catch { /* no todos los navegadores lo permiten */ }
  if (gen === st.peerGen) sendMsg({ t: 'offer', gen, sdp: pc.localDescription });
}

async function onAnswer(m) {
  const pc = st.pc;
  if (!pc || m.gen !== st.peerGen || pc.signalingState !== 'have-local-offer') return;
  try {
    await pc.setRemoteDescription(m.sdp);
    for (const c of st.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
  } catch (e) {
    console.warn('answer', e);
  }
}

async function onRemoteIce(m) {
  const pc = st.pc;
  if (!pc || m.gen !== st.peerGen || !m.candidate) return;
  if (!pc.remoteDescription) st.pendingIce.push(m.candidate);
  else await pc.addIceCandidate(m.candidate).catch(() => {});
}

// ---------------------------------------------------------------------------
// Anotaciones recibidas + encuadre automático
// ---------------------------------------------------------------------------
function onAnn(m) {
  const now = performance.now();
  switch (m.op) {
    case 'add': {
      const a = sanitizeAnn(m.ann);
      if (!a) return;
      a._t = now;
      st.anns = st.anns.filter((x) => x.id !== a.id);
      st.anns.push(a);
      if (st.draft?.id === a.id) st.draft = null;
      focusOn(annBBox(a));
      break;
    }
    case 'remove':
      st.anns = st.anns.filter((x) => x.id !== m.id);
      if (!st.anns.length) st.focusTarget = null;
      break;
    case 'clear':
      st.anns = [];
      st.draft = null;
      st.focusTarget = null;
      break;
    case 'draft':
      st.draft = m.ann ? sanitizeAnn(m.ann) : null;
      if (st.draft) st.draft._t = -1e9;
      break;
    case 'pointer':
      onPointer(m, now);
      break;
    case 'sync':
      st.anns = (Array.isArray(m.anns) ? m.anns : []).map(sanitizeAnn).filter(Boolean);
      for (const a of st.anns) a._t = now - 1000;
      st.caption = typeof m.caption === 'string' ? m.caption.slice(0, 200) : '';
      st.draft = null;
      if (st.anns.length) focusOn(annBBox(st.anns[st.anns.length - 1]));
      break;
  }
}

function onPointer(m, now) {
  if (m.hide) {
    if (st.pointer) st.pointer.visible = false;
    st.ptrHiddenAt = now;
    return;
  }
  const x = +m.x;
  const y = +m.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (!st.pointer) st.pointer = { trail: [] };
  const p = st.pointer;
  p.visible = true;
  p.x = x;
  p.y = y;
  p.trail.push({ x, y, t: now });
  if (p.trail.length > 60) p.trail.shift();
  const a = st.ptrAnchor;
  if (!a || Math.hypot(a.x - x, a.y - y) > 0.025) st.ptrAnchor = { x, y, t: now };
}

function srcDims() {
  return srcVideo.videoWidth ? [srcVideo.videoWidth, srcVideo.videoHeight] : [0, 0];
}

// Caja de foco (px de la fuente) alrededor de una caja normalizada.
function boxAround(nb) {
  const [sw, sh] = srcDims();
  if (!sw || !nb) return null;
  const bx = nb.x * sw;
  const by = nb.y * sh;
  const bw = nb.w * sw;
  const bh = nb.h * sh;
  const pad = Math.max(bw, bh) * 0.25 + sw * 0.02;
  const w = Math.max(bw + pad * 2, sw * 0.32);
  const h = Math.max(bh + pad * 2, sh * 0.32);
  return { x: bx + bw / 2 - w / 2, y: by + bh / 2 - h / 2, w, h };
}

function focusOn(nb) {
  st.focusTarget = boxAround(nb);
  st.focusFromPointer = false;
}

function setViewMode(mode) {
  st.viewMode = mode === 'full' ? 'full' : 'auto';
  for (const doc of [document, st.pip?.doc].filter(Boolean)) {
    for (const b of $$('.seg [data-mode]', doc)) b.setAttribute('aria-pressed', String(b.dataset.mode === st.viewMode));
  }
  if (st.viewMode === 'auto' && st.anns.length) focusOn(annBBox(st.anns[st.anns.length - 1]));
  if (st.pip) sendMsg({ t: 'pip', open: true, mode: st.pip.mode });
}

// Avanza la animación del encuadre (llamado desde cualquier bucle de dibujo).
function stepFocus(now) {
  const [sw, sh] = srcDims();
  if (!sw) return;
  const full = { x: 0, y: 0, w: sw, h: sh };
  if (!st.focus) st.focus = { ...full };
  let target = full;
  if (st.viewMode === 'auto') {
    const p = st.pointer;
    const ft = st.focusTarget;
    if (p?.visible) {
      if (ft) {
        // Si el puntero sale de la zona central del encuadre, lo seguimos.
        const px = p.x * sw;
        const py = p.y * sh;
        const mx = ft.w * 0.15;
        const my = ft.h * 0.15;
        if (px < ft.x + mx || px > ft.x + ft.w - mx || py < ft.y + my || py > ft.y + ft.h - my) {
          st.focusTarget = boxAround({ x: p.x, y: p.y, w: 0, h: 0 });
          st.focusFromPointer = true;
        }
      } else if (st.ptrAnchor && now - st.ptrAnchor.t > 700) {
        // Puntero quieto un momento: acercamos ahí.
        st.focusTarget = boxAround({ x: p.x, y: p.y, w: 0, h: 0 });
        st.focusFromPointer = true;
      }
    } else if (st.focusFromPointer && st.ptrHiddenAt) {
      // El técnico dejó de señalar: volvemos a la última marca, o a la vista completa.
      const idle = now - st.ptrHiddenAt;
      if (st.anns.length && idle > 1500) {
        focusOn(annBBox(st.anns[st.anns.length - 1]));
      } else if (!st.anns.length && idle > 5000) {
        st.focusTarget = null;
        st.focusFromPointer = false;
      }
    }
    target = st.focusTarget || full;
  }
  const dt = Math.min(200, Math.max(0, now - (st.lastStep || now)));
  st.lastStep = now;
  const k = 1 - Math.exp(-dt / 170);
  for (const key of ['x', 'y', 'w', 'h']) st.focus[key] += (target[key] - st.focus[key]) * k;
}

function renderTo(ctx, cw, ch, dpr, source, now) {
  const [sw, sh] = srcDims();
  pruneExpired(st.anns, now);
  stepFocus(now);
  drawScene({
    ctx,
    cw,
    ch,
    source,
    sw,
    sh,
    vp: sw ? viewportFor(st.focus, cw / ch, sw, sh, cw) : undefined,
    anns: st.anns,
    draft: st.draft,
    pointer: st.pointer,
    caption: st.caption,
    now,
    dpr,
    bg: '#202A36',
  });
}

// ---------------------------------------------------------------------------
// Vista en la página + bucles de dibujo
//  - Chrome/Edge: canvas en la página y ventana flotante propia (Document PiP).
//  - Safari: la vista es un <video> generado del canvas → imagen en imagen nativa.
//  - Firefox: igual que Safari, con el botón PiP propio de Firefox.
// ---------------------------------------------------------------------------
let rafId = 0;
let ticker = null;
let viewStream = null;

function setupView() {
  if (DOC_PIP) {
    viewCanvas.hidden = false;
    viewVideo.hidden = true;
  } else {
    viewCanvas.width = 1280;
    viewCanvas.height = 800;
    viewCanvas.hidden = true;
    viewVideo.hidden = false;
    if (!viewStream) viewStream = viewCanvas.captureStream(24);
    viewVideo.srcObject = viewStream;
    viewVideo.play().catch(() => {});
  }
  startLoops();
}

function sizeCanvasToBox(canvas, dpr) {
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function drawPage(now) {
  if (!st.sharing) return;
  if (DOC_PIP) {
    if (document.hidden) return;
    const dpr = window.devicePixelRatio || 1;
    sizeCanvasToBox(viewCanvas, dpr);
    renderTo(viewCtx, viewCanvas.width, viewCanvas.height, dpr, srcVideo, now);
  } else {
    renderTo(viewCtx, viewCanvas.width, viewCanvas.height, 1.6, srcVideo, now);
  }
}

function startLoops() {
  cancelAnimationFrame(rafId);
  // Siempre performance.now() de esta ventana: todas las marcas de tiempo usan el mismo reloj.
  const loop = () => {
    rafId = requestAnimationFrame(loop);
    if (!document.hidden) drawPage(performance.now());
  };
  rafId = requestAnimationFrame(loop);
  // En pestañas ocultas requestAnimationFrame se detiene; un worker mantiene vivo
  // el video de la imagen en imagen (Safari/Firefox).
  if (!DOC_PIP) {
    ticker ??= new Worker('/js/ticker.js');
    ticker.onmessage = () => document.hidden && drawPage(performance.now());
    ticker.postMessage(1000 / 20);
  }
}

function stopLoops() {
  cancelAnimationFrame(rafId);
  ticker?.postMessage(0);
}

// ---------------------------------------------------------------------------
// Ventana flotante
// ---------------------------------------------------------------------------
async function openPip() {
  if (!st.sharing) return;
  if (st.pip?.win) {
    st.pip.win.focus();
    return;
  }
  if (DOC_PIP) {
    const win = await window.documentPictureInPicture.requestWindow({ width: 480, height: 340 });
    const doc = win.document;
    for (const href of ['/css/base.css', '/css/pip.css']) {
      const l = doc.createElement('link');
      l.rel = 'stylesheet';
      l.href = href;
      doc.head.append(l);
    }
    doc.title = t('pipStatus');
    doc.body.className = 'pip';
    doc.body.innerHTML = `
      <div class="pip-bar">
        <p class="pip-status"><span class="dot live"></span><span class="pip-status-text"></span></p>
        <div class="seg" role="group" data-i18n-aria="viewLabel">
          <button type="button" data-mode="auto" data-i18n="viewAuto"></button>
          <button type="button" data-mode="full" data-i18n="viewFull"></button>
        </div>
        <button type="button" class="pip-stop" data-i18n="pipStop"></button>
      </div>
      <canvas class="pip-canvas"></canvas>
      <div class="toasts"></div>`;
    const canvas = doc.querySelector('canvas');
    const video = doc.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.className = 'offscreen-video';
    video.srcObject = st.stream;
    doc.body.append(video);
    video.play().catch(() => {});
    st.pip = { win, doc, canvas, ctx: canvas.getContext('2d'), video, mode: 'document' };
    for (const b of doc.querySelectorAll('.seg [data-mode]')) b.addEventListener('click', () => setViewMode(b.dataset.mode));
    doc.querySelector('.pip-stop').addEventListener('click', () => {
      stopShare();
      toast(t('stoppedToast'));
    });
    win.addEventListener('pagehide', () => {
      if (st.pip?.win === win) {
        st.pip = null;
        sendMsg({ t: 'pip', open: false });
        renderPipHint();
      }
    });
    // La ventana flotante tiene su propio reloj; usamos el de la página para que
    // coincida con las marcas de tiempo de las anotaciones.
    const tick = () => {
      if (st.pip?.win !== win) return;
      win.requestAnimationFrame(tick);
      const dpr = win.devicePixelRatio || 1;
      sizeCanvasToBox(canvas, dpr);
      renderTo(st.pip.ctx, canvas.width, canvas.height, dpr, video, performance.now());
    };
    win.requestAnimationFrame(tick);
    setViewMode(st.viewMode);
    applyI18n();
  } else if (VIDEO_PIP) {
    await viewVideo.requestPictureInPicture();
    st.pip = { mode: 'video' };
    viewVideo.addEventListener(
      'leavepictureinpicture',
      () => {
        st.pip = null;
        sendMsg({ t: 'pip', open: false });
        renderPipHint();
      },
      { once: true }
    );
  }
  sendMsg({ t: 'pip', open: true, mode: st.pip?.mode });
  renderPipHint();
}

function closePip() {
  const p = st.pip;
  if (!p) return;
  st.pip = null;
  if (p.win) {
    p.video.srcObject = null;
    p.win.close();
  } else if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(() => {});
  }
  renderPipHint();
}

// ---------------------------------------------------------------------------
// Navegador compartido
// ---------------------------------------------------------------------------
function onCbFrame(blob) {
  if (!st.cb.open) return;
  cbView.frame(blob);
  $('#cb-empty').hidden = true;
}

function onCbState(m, silent) {
  const wasOpen = st.cb.open;
  st.cb = m;
  if (!m.open) {
    st.cbRequest = false;
    cbView.clear();
    if (wasOpen && !silent) toast(t('cbClosedToast'));
    if (st.screen === 'cobrowse') leaveCb();
  }
  if (m.control) st.cbRequest = false;
  renderCb();
}

function leaveCb() {
  if (!st.ended) show(st.sharing ? 'sharing' : 'ready');
}

function openCb() {
  if (!st.cbEnabled) return;
  if (!st.cb.open) {
    sendMsg({ t: 'cb-open' });
    $('#cb-empty').hidden = false;
  }
  show('cobrowse');
  $('#cb-canvas').focus({ preventScroll: true });
}

function renderCb() {
  for (const el of $$('[data-cb-entry]')) el.hidden = !st.cbEnabled;
  for (const el of $$('[data-cb-open-label]')) el.textContent = t(st.cb.open ? 'cbReturn' : el.hasAttribute('data-short') ? 'cbOpenShort' : 'cbOpen');
  const cb = st.cb;
  const url = $('#cb-url');
  url.placeholder = t('cbUrlPlaceholder');
  if (document.activeElement !== url) url.value = cb.url && cb.url !== 'about:blank' ? cb.url : '';
  $('[data-cb-nav="back"]').disabled = !cb.canBack;
  $('[data-cb-nav="forward"]').disabled = !cb.canForward;
  const ctl = $('#cb-control-btn');
  ctl.textContent = t(cb.control ? 'cbRevoke' : 'cbGrant');
  ctl.classList.toggle('danger', !!cb.control);
  ctl.disabled = !cb.ready;
  $('#cb-sub').textContent = t(cb.loading ? 'cbLoading' : cb.control ? 'cbSubControl' : 'cbSub');
  $('#cb-banner').hidden = !cb.control;
  $('#cb-banner-text').textContent = t('cbControlOn');
  $('#cb-request').hidden = !st.cbRequest;
  $('#cb-request-text').textContent = t('cbRequest');
  $('#cb-empty-text').textContent = t('cbStarting');
  if (!cbView.hasImage) $('#cb-empty').hidden = false;
}

for (const b of $$('[data-cb-open]')) b.addEventListener('click', openCb);
$('#cb-back-btn').addEventListener('click', leaveCb);
$('#cb-close-btn').addEventListener('click', () => sendMsg({ t: 'cb-close' }));
$('#cb-control-btn').addEventListener('click', () => sendMsg({ t: 'cb-control', grant: !st.cb.control }));
$('#cb-request-yes').addEventListener('click', () => {
  st.cbRequest = false;
  sendMsg({ t: 'cb-control', grant: true });
  renderCb();
});
$('#cb-request-no').addEventListener('click', () => {
  st.cbRequest = false;
  renderCb();
});
for (const b of $$('[data-cb-nav]')) b.addEventListener('click', () => sendMsg({ t: 'cb-nav', action: b.dataset.cbNav }));
$('#cb-url-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = $('#cb-url').value.trim();
  if (!url) return;
  sendMsg({ t: 'cb-nav', action: 'go', url });
  $('#cb-canvas').focus({ preventScroll: true });
});

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
st.lang = store.get('na_lang') || (navigator.language || 'es').slice(0, 2);
if (!STR[st.lang]) st.lang = 'es';
if (!CAN_SHARE) {
  // En celulares avisamos antes de aceptar, no después.
  $('#share-block').hidden = true;
  $('#unsupported').hidden = false;
  for (const el of $$('[data-unsupported]')) el.hidden = false;
}

const m = location.pathname.match(/^\/s\/(\d{9})\/?$/);
if (m) {
  loadSession(m[1]);
} else {
  fetch('/api/config')
    .then((r) => r.json())
    .then((c) => {
      st.brand = c.brand || st.brand;
      for (const el of $$('[data-brand]')) el.textContent = st.brand;
      applyI18n();
    })
    .catch(() => {});
  show('code');
}

// Para pruebas automatizadas
window.__assist = st;
