// Renderizador compartido: el técnico y el cliente dibujan exactamente lo mismo.
// Las coordenadas de las anotaciones están normalizadas (0..1) respecto al cuadro compartido.

export const COLORS = {
  red: '#FF3D57',
  amber: '#FFB020',
  green: '#1FD18B',
  blue: '#3D8BFF',
};

export const PEN_TTL = 12000;
const TRAIL_MS = 650;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Transformación del espacio de la fuente (px) al canvas (px).
// vp = área de la fuente que se quiere mostrar {x,y,w,h} en px de la fuente.
export function fitTransform(cw, ch, sw, sh, vp) {
  const s = Math.min(cw / vp.w, ch / vp.h);
  const ox = (cw - vp.w * s) / 2 - vp.x * s;
  const oy = (ch - vp.h * s) / 2 - vp.y * s;
  return {
    s,
    ox,
    oy,
    toC: (nx, ny) => [ox + nx * sw * s, oy + ny * sh * s],
    fromC: (cx, cy) => [(cx - ox) / (s * sw), (cy - oy) / (s * sh)],
  };
}

// Rectángulo con el aspecto del canvas que contiene el foco F, sin salirse de la fuente.
// minW evita ampliar más allá del tamaño real (1 px de la fuente = 1 px del canvas).
export function viewportFor(F, aspect, sw, sh, minW = 0) {
  let w = Math.max(F.w, F.h * aspect, minW);
  let h = w / aspect;
  if (w > sw) {
    w = sw;
    h = w / aspect;
  }
  if (h > sh) {
    h = sh;
    w = h * aspect;
  }
  const cx = F.x + F.w / 2;
  const cy = F.y + F.h / 2;
  return {
    x: w >= sw ? (sw - w) / 2 : clamp(cx - w / 2, 0, sw - w),
    y: h >= sh ? (sh - h) / 2 : clamp(cy - h / 2, 0, sh - h),
    w,
    h,
  };
}

// Caja (normalizada) que ocupa una anotación
export function annBBox(a) {
  switch (a.type) {
    case 'rect':
    case 'spot':
      return { x: a.x, y: a.y, w: a.w, h: a.h };
    case 'arrow':
      return {
        x: Math.min(a.x1, a.x2),
        y: Math.min(a.y1, a.y2),
        w: Math.abs(a.x2 - a.x1),
        h: Math.abs(a.y2 - a.y1),
      };
    case 'pen': {
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      for (const [x, y] of a.pts) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y);
        x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    case 'click':
      return { x: a.x, y: a.y, w: 0, h: 0 };
    default:
      return null;
  }
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.roundRect(x, y, w, h, rr);
}

// Traza con halo oscuro + color, para que se vea sobre fondos claros y oscuros.
function haloStroke(ctx, color, lw, alpha = 1) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.globalAlpha = alpha * 0.55;
  ctx.strokeStyle = '#0A0F16';
  ctx.lineWidth = lw + Math.max(2, lw * 0.9);
  ctx.stroke();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawRect(ctx, T, a, u, now) {
  const [x, y] = T.toC(a.x, a.y);
  const [x2, y2] = T.toC(a.x + a.w, a.y + a.h);
  const col = COLORS[a.color] || COLORS.red;
  ctx.beginPath();
  roundRectPath(ctx, x, y, x2 - x, y2 - y, u * 2.2);
  ctx.fillStyle = rgba(col, 0.13);
  ctx.fill();
  haloStroke(ctx, col, u);
  attention(ctx, a, now, x, y, x2 - x, y2 - y, col, u);
}

// Al aparecer, un contorno que se expande una vez para llamar la atención.
function attention(ctx, a, now, x, y, w, h, col, u) {
  const age = now - (a._t || 0);
  if (age > 700 || age < 0) return;
  const p = age / 700;
  const grow = u * 2 + p * u * 9;
  ctx.beginPath();
  roundRectPath(ctx, x - grow, y - grow, w + grow * 2, h + grow * 2, u * 3 + grow);
  ctx.globalAlpha = (1 - p) * 0.9;
  ctx.strokeStyle = col;
  ctx.lineWidth = u * 0.8;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawSpots(ctx, T, spots, cw, ch, u, now) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, cw, ch);
  for (const a of spots) {
    const [x, y] = T.toC(a.x, a.y);
    const [x2, y2] = T.toC(a.x + a.w, a.y + a.h);
    roundRectPath(ctx, x, y, x2 - x, y2 - y, u * 2.2);
  }
  ctx.fillStyle = 'rgba(6,10,16,0.62)';
  ctx.fill('evenodd');
  ctx.restore();
  for (const a of spots) {
    const [x, y] = T.toC(a.x, a.y);
    const [x2, y2] = T.toC(a.x + a.w, a.y + a.h);
    const col = COLORS[a.color] || COLORS.red;
    ctx.beginPath();
    roundRectPath(ctx, x, y, x2 - x, y2 - y, u * 2.2);
    ctx.strokeStyle = rgba(col, 0.9);
    ctx.lineWidth = Math.max(1, u * 0.5);
    ctx.stroke();
    attention(ctx, a, now, x, y, x2 - x, y2 - y, col, u);
  }
}

function drawArrow(ctx, T, a, u) {
  const [x1, y1] = T.toC(a.x1, a.y1);
  const [x2, y2] = T.toC(a.x2, a.y2);
  const col = COLORS[a.color] || COLORS.red;
  const lw = u * 1.3;
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 2) return;
  const head = Math.min(len * 0.6, Math.max(u * 6, 14));
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const bx = x2 - Math.cos(ang) * head * 0.8;
  const by = y2 - Math.sin(ang) * head * 0.8;
  const headPath = () => {
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(ang - 0.45), y2 - head * Math.sin(ang - 0.45));
    ctx.lineTo(x2 - head * Math.cos(ang + 0.45), y2 - head * Math.sin(ang + 0.45));
    ctx.closePath();
  };
  // halo
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(bx, by);
  haloStroke(ctx, col, lw);
  headPath();
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = '#0A0F16';
  ctx.lineWidth = Math.max(2, lw * 0.9);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = col;
  ctx.fill();
}

function drawPen(ctx, T, a, u, now) {
  if (!a.pts || a.pts.length < 2) return;
  let alpha = 1;
  if (a.ttl) {
    const left = a.ttl - (now - (a._t || now));
    alpha = clamp(left / 1200, 0, 1);
    if (alpha <= 0) return;
  }
  const pts = a.pts.map(([x, y]) => T.toC(x, y));
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);
  haloStroke(ctx, COLORS[a.color] || COLORS.red, u * 1.1, alpha);
}

function drawClick(ctx, T, a, u, now, font) {
  const [x, y] = T.toC(a.x, a.y);
  const col = COLORS[a.color] || COLORS.red;
  const r0 = Math.max(9, u * 3.6);
  const period = 1500;
  const age = Math.max(0, now - (a._t || 0));
  for (let k = 0; k < 2; k++) {
    const p = ((age + (k * period) / 2) % period) / period;
    ctx.beginPath();
    ctx.arc(x, y, r0 * (0.9 + p * 1.9), 0, Math.PI * 2);
    ctx.globalAlpha = (1 - p) * 0.85;
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1.5, u * 0.7);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // diana
  ctx.beginPath();
  ctx.arc(x, y, r0 * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = col;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, u * 0.5);
  ctx.strokeStyle = '#FFFFFF';
  ctx.stroke();
  // número de paso
  if (a.n) {
    const br = r0 * 0.78;
    const bx = x + r0 * 1.05;
    const by = y - r0 * 1.05;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, u * 0.45);
    ctx.strokeStyle = col;
    ctx.stroke();
    ctx.fillStyle = '#16212E';
    ctx.font = `700 ${Math.round(br * 1.25)}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(a.n), bx, by + br * 0.06);
  }
}

function drawPointer(ctx, T, ptr, u, now) {
  if (!ptr) return;
  const trail = (ptr.trail || []).filter((p) => now - p.t < TRAIL_MS);
  ptr.trail = trail;
  const col = COLORS.red;
  if (trail.length > 1) {
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1];
      const b = trail[i];
      const life = 1 - (now - b.t) / TRAIL_MS;
      const [ax, ay] = T.toC(a.x, a.y);
      const [bx, by] = T.toC(b.x, b.y);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.strokeStyle = rgba(col, life * 0.6);
      ctx.lineWidth = Math.max(1.5, u * 1.6 * life);
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }
  if (!ptr.visible) return;
  const [x, y] = T.toC(ptr.x, ptr.y);
  const r = Math.max(6, u * 2.3);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.6);
  g.addColorStop(0, rgba(col, 0.55));
  g.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = col;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, r * 0.28);
  ctx.strokeStyle = '#FFFFFF';
  ctx.stroke();
}

function wrapLines(ctx, text, maxW, maxLines) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    } else cur = test;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  return lines;
}

function drawCaption(ctx, text, cw, ch, dpr, font) {
  const size = clamp(Math.round(Math.min(cw, ch * 1.6) * 0.034), 13 * dpr, 24 * dpr);
  ctx.font = `600 ${size}px ${font}`;
  const padX = size * 0.9;
  const padY = size * 0.55;
  const lines = wrapLines(ctx, text, cw * 0.86 - padX * 2, 3);
  const lh = size * 1.3;
  const w = Math.min(cw * 0.9, Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2);
  const h = lines.length * lh + padY * 2;
  const x = (cw - w) / 2;
  const y = ch - h - Math.max(10 * dpr, ch * 0.04);
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, size * 0.6);
  ctx.fillStyle = 'rgba(22,33,46,0.94)';
  ctx.fill();
  ctx.lineWidth = Math.max(1, dpr);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.stroke();
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, cw / 2, y + padY + lh * i + lh / 2));
}

/**
 * Dibuja un cuadro completo.
 * o = { ctx, cw, ch, source, sw, sh, vp, anns, draft, pointer, caption, now, dpr, bg, font }
 * Devuelve la transformación usada (o null si aún no hay imagen).
 */
export function drawScene(o) {
  const { ctx, cw, ch, source, sw, sh, anns = [], draft, pointer, caption, now = performance.now(), dpr = 1 } = o;
  const font = o.font || '"Atkinson Hyperlegible Next", system-ui, sans-serif';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = o.bg || '#202A36';
  ctx.fillRect(0, 0, cw, ch);
  if (!sw || !sh) return null;
  const vp = o.vp || { x: 0, y: 0, w: sw, h: sh };
  const T = fitTransform(cw, ch, sw, sh, vp);
  if (source && (source.readyState === undefined || source.readyState >= 2)) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, T.ox, T.oy, sw * T.s, sh * T.s);
  }
  // Unidad de trazo: proporcional al tamaño mostrado, con límites legibles.
  const u = clamp(sw * T.s * 0.0028, 2 * dpr, 7 * dpr);
  const list = draft ? anns.concat([draft]) : anns;
  const spots = list.filter((a) => a.type === 'spot');
  if (spots.length) drawSpots(ctx, T, spots, cw, ch, u, now);
  for (const a of list) {
    if (a.type === 'rect') drawRect(ctx, T, a, u, now);
    else if (a.type === 'arrow') drawArrow(ctx, T, a, u);
    else if (a.type === 'pen') drawPen(ctx, T, a, u, now);
    else if (a.type === 'click') drawClick(ctx, T, a, u, now, font);
  }
  drawPointer(ctx, T, pointer, u, now);
  if (caption) drawCaption(ctx, caption, cw, ch, dpr, font);
  return T;
}

// Quita trazos libres caducados. Devuelve true si cambió algo.
export function pruneExpired(anns, now) {
  let changed = false;
  for (let i = anns.length - 1; i >= 0; i--) {
    const a = anns[i];
    if (a.ttl && now - (a._t || now) > a.ttl) {
      anns.splice(i, 1);
      changed = true;
    }
  }
  return changed;
}

// Valida una anotación recibida por la red (defensa básica).
export function sanitizeAnn(a) {
  if (!a || typeof a !== 'object' || typeof a.id !== 'string' || a.id.length > 40) return null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, -0.5, 1.5) : null);
  const color = Object.hasOwn(COLORS, a.color) ? a.color : 'red';
  const out = { id: a.id, type: a.type, color };
  switch (a.type) {
    case 'rect':
    case 'spot':
      for (const k of ['x', 'y', 'w', 'h']) if ((out[k] = num(a[k])) === null) return null;
      return out;
    case 'arrow':
      for (const k of ['x1', 'y1', 'x2', 'y2']) if ((out[k] = num(a[k])) === null) return null;
      return out;
    case 'click':
      if ((out.x = num(a.x)) === null || (out.y = num(a.y)) === null) return null;
      out.n = Number.isInteger(a.n) && a.n > 0 && a.n < 100 ? a.n : 0;
      return out;
    case 'pen':
      if (!Array.isArray(a.pts) || a.pts.length > 2000) return null;
      out.pts = [];
      for (const p of a.pts) {
        if (!Array.isArray(p)) return null;
        const x = num(p[0]);
        const y = num(p[1]);
        if (x === null || y === null) return null;
        out.pts.push([x, y]);
      }
      out.ttl = typeof a.ttl === 'number' ? clamp(a.ttl, 0, 60000) : PEN_TTL;
      return out;
    default:
      return null;
  }
}
