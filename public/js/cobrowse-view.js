// Navegador compartido: dibuja los fotogramas que manda el servidor y convierte
// el mouse y el teclado en eventos para la pestaña remota. Lo usan cliente y técnico.

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// Modificadores en el formato de Chrome: Alt=1, Ctrl=2, Meta=4, Shift=8.
// En Mac, Cmd equivale a Ctrl porque el navegador remoto corre en Linux.
function mods(e) {
  return (e.altKey ? 1 : 0) | (e.ctrlKey || (IS_MAC && e.metaKey) ? 2 : 0) | (!IS_MAC && e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
}
const BUTTON = ['left', 'middle', 'right'];

export class CobrowseView {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ send: (m: object) => void, canControl: () => boolean, bg?: string }} opts
   */
  constructor(canvas, { send, canControl, bg = '#202A36' }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.send = send;
    this.canControl = canControl;
    this.bg = bg;
    this.img = null;
    this.rect = null;
    this.lastMove = 0;
    this.lastDown = { t: 0, x: 0, y: 0, n: 0 };
    this.pending = null;
    this.decoding = false;
    new ResizeObserver(() => this.draw()).observe(canvas);
    this.bind();
  }

  // Fotograma JPEG (Blob). Si llega otro mientras se decodifica, solo se dibuja el último.
  frame(blob) {
    this.pending = blob;
    if (this.decoding) return;
    this.decoding = true;
    const next = () => {
      const b = this.pending;
      this.pending = null;
      if (!b) {
        this.decoding = false;
        return;
      }
      createImageBitmap(b)
        .then((bmp) => {
          this.img?.close();
          this.img = bmp;
          this.draw();
        })
        .catch(() => {})
        .finally(next);
    };
    next();
  }

  clear() {
    this.img?.close();
    this.img = null;
    this.pending = null;
    this.draw();
  }

  get hasImage() {
    return !!this.img;
  }

  draw() {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = this.ctx;
    ctx.fillStyle = this.bg;
    ctx.fillRect(0, 0, w, h);
    if (!this.img) {
      this.rect = null;
      return;
    }
    const s = Math.min(w / this.img.width, h / this.img.height);
    const dw = this.img.width * s;
    const dh = this.img.height * s;
    const dx = (w - dw) / 2;
    const dy = (h - dh) / 2;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.img, dx, dy, dw, dh);
    this.rect = { x: dx / dpr, y: dy / dpr, w: dw / dpr, h: dh / dpr };
  }

  // Coordenadas normalizadas (0–1) dentro de la imagen, o null si está fuera.
  norm(e) {
    if (!this.rect) return null;
    const r = this.canvas.getBoundingClientRect();
    const x = (e.clientX - r.left - this.rect.x) / this.rect.w;
    const y = (e.clientY - r.top - this.rect.y) / this.rect.h;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000];
  }

  bind() {
    const c = this.canvas;
    const input = (m) => this.send({ t: 'cb-input', ...m });

    c.addEventListener('contextmenu', (e) => e.preventDefault());

    c.addEventListener('pointerdown', (e) => {
      c.focus({ preventScroll: true });
      if (!this.canControl()) return;
      const p = this.norm(e);
      if (!p) return;
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      // Doble y triple clic: mismos criterios que un sistema operativo.
      const d = this.lastDown;
      const now = performance.now();
      const n = now - d.t < 450 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6 ? Math.min(3, d.n + 1) : 1;
      this.lastDown = { t: now, x: e.clientX, y: e.clientY, n };
      input({ kind: 'mouse', type: 'down', x: p[0], y: p[1], button: BUTTON[e.button] || 'left', buttons: e.buttons, count: n, mods: mods(e) });
    });

    c.addEventListener('pointerup', (e) => {
      if (!this.canControl()) return;
      const p = this.norm(e) || this.lastPos;
      if (!p) return;
      input({ kind: 'mouse', type: 'up', x: p[0], y: p[1], button: BUTTON[e.button] || 'left', buttons: e.buttons, count: this.lastDown.n, mods: mods(e) });
    });

    c.addEventListener('pointermove', (e) => {
      if (!this.canControl()) return;
      const p = this.norm(e);
      if (!p) return;
      this.lastPos = p;
      const now = performance.now();
      if (now - this.lastMove < 30) return;
      this.lastMove = now;
      input({ kind: 'mouse', type: 'move', x: p[0], y: p[1], button: e.buttons & 1 ? 'left' : 'none', buttons: e.buttons, mods: mods(e) });
    });

    c.addEventListener(
      'wheel',
      (e) => {
        if (!this.canControl()) return;
        const p = this.norm(e);
        if (!p) return;
        e.preventDefault();
        const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
        input({ kind: 'wheel', x: p[0], y: p[1], dx: e.deltaX * k, dy: e.deltaY * k, mods: mods(e) });
      },
      { passive: false }
    );

    const key = (type) => (e) => {
      if (!this.canControl() || e.isComposing) return;
      // Ctrl/Cmd+V: dejamos que el navegador dispare "paste" y mandamos el texto.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') return;
      e.preventDefault();
      input({ kind: 'key', type, key: e.key, code: e.code, keyCode: e.keyCode, repeat: e.repeat, mods: mods(e) });
    };
    c.addEventListener('keydown', key('down'));
    c.addEventListener('keyup', key('up'));

    c.addEventListener('paste', (e) => {
      if (!this.canControl()) return;
      const text = e.clipboardData?.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      input({ kind: 'text', text: text.slice(0, 5000) });
    });
  }
}
