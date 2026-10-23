// Evita el "espejo infinito" cuando el cliente comparte toda la pantalla.

/** true si lo compartido puede incluir esta misma página (pantalla completa o desconocido). */
export function mayMirror(surface) {
  return surface === 'monitor' || !surface || surface === 'unknown';
}

/**
 * Zona que ocupa la ventana flotante dentro de la imagen capturada, en px de la fuente,
 * para taparla y que no se vea a sí misma. Devuelve null si no se puede calcular con
 * seguridad (otro monitor, otra escala…): mejor no tapar nada que tapar algo equivocado.
 *
 * @param {{ sw: number, sh: number,
 *           screen: { width: number, height: number, left?: number, top?: number },
 *           win: { x: number, y: number, w: number, h: number } }} o
 *   sw/sh: tamaño de la captura; screen y win en px CSS (coordenadas globales del escritorio).
 */
export function pipMaskRect({ sw, sh, screen, win }) {
  if (!sw || !sh || !screen?.width || !screen?.height || !win?.w || !win?.h) return null;
  // La captura debe tener la forma de la pantalla donde está la ventana flotante.
  if (Math.abs(sw / sh - screen.width / screen.height) > 0.02) return null;
  const k = sw / screen.width;
  const pad = 4 * k;
  const r = {
    x: (win.x - (screen.left || 0)) * k - pad,
    y: (win.y - (screen.top || 0)) * k - pad,
    w: win.w * k + pad * 2,
    h: win.h * k + pad * 2,
  };
  // Recorte a la imagen; si la mayor parte queda fuera, está en otro monitor.
  const x1 = Math.max(0, r.x);
  const y1 = Math.max(0, r.y);
  const x2 = Math.min(sw, r.x + r.w);
  const y2 = Math.min(sh, r.y + r.h);
  if (x2 <= x1 || y2 <= y1 || (x2 - x1) * (y2 - y1) < 0.5 * r.w * r.h) return null;
  // Una ventana flotante nunca ocupa media pantalla: si sale así, el cálculo no es fiable.
  if ((x2 - x1) * (y2 - y1) > 0.5 * sw * sh) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
