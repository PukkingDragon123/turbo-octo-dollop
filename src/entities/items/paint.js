// R.O.O.M. items — canvas print atlases: label / packaging graphics, wear and helpers.
// Everything is drawn once per item type (cached); the bottom-right 64px block of each atlas is a
// near-white scuffed "plain" swatch that unprinted parts map into (tinted by vertex colour).
import * as THREE from 'three';
import { labelTexture } from '../../gfx/textures.js';
import { RNG } from '../../core/rng.js';

const PI = Math.PI, TAU = Math.PI * 2;
export const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
export const COND = '"Arial Narrow", "Helvetica Neue Condensed", "Roboto Condensed", Arial, sans-serif';
export const MONO = '"IBM Plex Mono", monospace';
export const VT = '"VT323", monospace';
export const SERIF = 'Georgia, "Times New Roman", serif';
export const HAND = '"Comic Sans MS", "Segoe Print", "Bradley Hand", cursive, sans-serif';
export const ROOM_YELLOW = '#f2c418';
export const INK = '#151515';
export const NAVY = '#222a40';

function fontStr(size, o) {
  return `${o.italic ? 'italic ' : ''}${o.weight ?? 'bold'} ${size}px ${o.fam || SANS}`;
}

// Text with auto-shrink (maxW), rotation, stroke, letter spacing, scale.
export function txt(c, s, x, y, o = {}) {
  let size = o.size || 20;
  c.save();
  c.letterSpacing = `${o.ls || 0}px`;
  c.font = fontStr(size, o);
  if (o.maxW) {
    const w = c.measureText(s).width * (o.sx || 1);
    if (w > o.maxW) { size *= o.maxW / w; c.font = fontStr(size, o); }
  }
  c.textAlign = o.align || 'center';
  c.textBaseline = o.base || 'middle';
  c.translate(x, y);
  if (o.rot) c.rotate(o.rot);
  if (o.sx || o.sy) c.scale(o.sx || 1, o.sy || 1);
  if (o.alpha !== undefined) c.globalAlpha = o.alpha;
  if (o.shadow) { c.fillStyle = o.shadow; c.fillText(s, o.sdx ?? size * 0.06, o.sdy ?? size * 0.06); }
  if (o.stroke) {
    c.lineWidth = o.sw || 4;
    c.strokeStyle = o.stroke;
    c.lineJoin = 'round';
    c.strokeText(s, 0, 0);
  }
  c.fillStyle = o.color || '#111';
  c.fillText(s, 0, 0);
  c.restore();
  c.letterSpacing = '0px';
}
export function textW(c, s, size, o = {}) {
  c.save(); c.letterSpacing = `${o.ls || 0}px`; c.font = fontStr(size, o); const w = c.measureText(s).width; c.restore(); c.letterSpacing = '0px';
  return w;
}

// Multi-line paragraph (word wrap), returns the y after the last line
export function para(c, s, x, y, w, o = {}) {
  const size = o.size || 12, lh = o.lh || size * 1.18;
  c.save();
  c.font = fontStr(size, o);
  c.fillStyle = o.color || '#111';
  c.textAlign = o.align || 'left';
  c.textBaseline = 'top';
  const words = s.split(' ');
  let line = '';
  let yy = y;
  const ax = o.align === 'center' ? x + w / 2 : o.align === 'right' ? x + w : x;
  for (const wd of words) {
    const t = line ? line + ' ' + wd : wd;
    if (c.measureText(t).width > w && line) { c.fillText(line, ax, yy); yy += lh; line = wd; } else line = t;
  }
  if (line) { c.fillText(line, ax, yy); yy += lh; }
  c.restore();
  return yy;
}

export function rrect(c, x, y, w, h, r, fill, stroke, lw) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.lineWidth = lw || 2; c.strokeStyle = stroke; c.stroke(); }
}
export function rect(c, x, y, w, h, fill) {
  c.fillStyle = fill;
  c.fillRect(x, y, w, h);
}
export function lgrad(c, x0, y0, x1, y1, stops) {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([t, col]) => g.addColorStop(t, col));
  return g;
}
export function rgrad(c, x, y, r0, r1, stops) {
  const g = c.createRadialGradient(x, y, r0, x, y, r1);
  stops.forEach(([t, col]) => g.addColorStop(t, col));
  return g;
}
export function circle(c, x, y, r, fill, stroke, lw) {
  c.beginPath(); c.arc(x, y, r, 0, TAU);
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.lineWidth = lw || 2; c.strokeStyle = stroke; c.stroke(); }
}
export function line(c, x0, y0, x1, y1, col, lw = 1) {
  c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.strokeStyle = col; c.lineWidth = lw; c.stroke();
}

// Luminance noise over a region (cached noise tile blended with 'overlay'; no canvas readbacks)
let _noiseTile = null;
function noiseTile() {
  if (_noiseTile) return _noiseTile;
  const t = document.createElement('canvas');
  t.width = t.height = 256;
  const g = t.getContext('2d');
  const img = g.createImageData(256, 256);
  const d = img.data;
  const r = new RNG(1234);
  for (let i = 0; i < d.length; i += 4) {
    const v = 128 + (r.next() + r.next() - 1) * 127;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  _noiseTile = t;
  return t;
}
// soft blotch tile (low-frequency mottling) built from blurred noise
let _blotchTile = null;
function blotchTile() {
  if (_blotchTile) return _blotchTile;
  const t = document.createElement('canvas');
  t.width = t.height = 256;
  const g = t.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
  const r = new RNG(77);
  for (let i = 0; i < 90; i++) {
    const x = r.next() * 256, y = r.next() * 256, rad = r.range(10, 46), a = r.range(0.05, 0.16);
    for (const [ox, oy] of [[0, 0], [256, 0], [-256, 0], [0, 256], [0, -256]]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      const v = r.next() < 0.5 ? 0 : 255;
      gr.addColorStop(0, `rgba(${v},${v},${v},${a})`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = gr; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
  }
  _blotchTile = t;
  return t;
}
export function noise(c, x, y, w, h, amt = 10, seed = 1, o = {}) {
  const pat = c.createPattern(o.blotch ? blotchTile() : noiseTile(), 'repeat');
  const ox = (seed * 97) % 256, oy = (seed * 61) % 256;
  c.save();
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.globalCompositeOperation = o.mode || 'overlay';
  c.globalAlpha = Math.min(1, amt / 40);
  if (o.scale) { c.translate(x, y); c.scale(o.scale, o.scale); c.translate(-x, -y); }
  c.translate(-ox, -oy);
  c.fillStyle = pat;
  c.fillRect(x + ox - 4, y + oy - 4, w / (o.scale || 1) + 8, h / (o.scale || 1) + 8);
  c.restore();
}
export function mottle(c, x, y, w, h, amt = 12, seed = 3, scale = 1) { noise(c, x, y, w, h, amt, seed, { blotch: true, scale }); }

// Scratches, smudges and edge grime over a region
export function wear(c, x, y, w, h, seed = 1, k = 1, o = {}) {
  const r = new RNG(seed);
  c.save();
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  const n = Math.round((w * h) / 2500 * k);
  for (let i = 0; i < n; i++) {
    const light = r.next() < (o.lightRatio ?? 0.5);
    c.strokeStyle = light ? `rgba(255,255,255,${r.range(0.06, 0.26)})` : `rgba(30,20,10,${r.range(0.05, 0.2)})`;
    c.lineWidth = r.range(0.4, 1.4);
    const sx = x + r.next() * w, sy = y + r.next() * h, a = r.next() * PI, l = r.range(3, 22) * (o.len ?? 1);
    c.beginPath(); c.moveTo(sx, sy);
    c.quadraticCurveTo(sx + Math.cos(a) * l * 0.5 + r.range(-2, 2), sy + Math.sin(a) * l * 0.5 + r.range(-2, 2), sx + Math.cos(a) * l, sy + Math.sin(a) * l);
    c.stroke();
  }
  for (let i = 0; i < Math.round(n / 6) + 1; i++) {
    const sx = x + r.next() * w, sy = y + r.next() * h, rad = r.range(6, 30) * (o.smudge ?? 1);
    const g = c.createRadialGradient(sx, sy, 0, sx, sy, rad);
    g.addColorStop(0, `rgba(40,30,15,${r.range(0.03, 0.1) * (o.dirt ?? 1)})`);
    g.addColorStop(1, 'rgba(40,30,15,0)');
    c.fillStyle = g;
    c.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
  }
  if (o.edge !== false) edgeGrime(c, x, y, w, h, o.edgeK ?? 1);
  c.restore();
}
export function edgeGrime(c, x, y, w, h, k = 1, col = '30,22,10') {
  const e = Math.min(w, h) * 0.08;
  const gs = [
    [x, y, x + e, y, x, y, e, h], [x + w, y, x + w - e, y, x + w - e, y, e, h],
    [x, y, x, y + e, x, y, w, e], [x, y + h, x, y + h - e, x, y + h - e, w, e],
  ];
  for (const [x0, y0, x1, y1, rx, ry, rw, rh] of gs) {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, `rgba(${col},${0.18 * k})`);
    g.addColorStop(1, `rgba(${col},0)`);
    c.fillStyle = g;
    c.fillRect(rx, ry, rw, rh);
  }
}
// worn-through edge (paint / print rubbed off along an edge line) in a substrate colour
export function rubEdge(c, x, y, w, h, col, seed = 1, side = 'all', k = 1) {
  const r = new RNG(seed);
  c.save();
  c.fillStyle = col;
  const edges = side === 'all' ? ['t', 'b', 'l', 'r'] : side.split('');
  for (const e of edges) {
    const horiz = e === 't' || e === 'b';
    const len = horiz ? w : h;
    for (let p = 0; p < len; p += r.range(2, 6)) {
      const d = Math.max(0, (r.next() ** 3) * 7 * k);
      if (d < 0.6) continue;
      const s = r.range(2, 9);
      if (horiz) c.fillRect(x + p, e === 't' ? y : y + h - d, s, d);
      else c.fillRect(e === 'l' ? x : x + w - d, y + p, d, s);
    }
  }
  c.restore();
}

export function barcode(c, x, y, w, h, seed = 3, digits = true, col = '#111') {
  const r = new RNG(seed);
  rect(c, x, y, w, h, '#fff');
  const bh = digits ? h * 0.76 : h * 0.9;
  let px = x + w * 0.07;
  c.fillStyle = col;
  // guard bars
  const unit = w / 120;
  const guard = (gx) => { c.fillRect(gx, y + h * 0.05, unit, bh + h * 0.06); c.fillRect(gx + unit * 2, y + h * 0.05, unit, bh + h * 0.06); };
  guard(px); px += unit * 4;
  while (px < x + w * 0.9) {
    const bw = r.int(1, 3) * unit;
    if (r.next() < 0.55) c.fillRect(px, y + h * 0.05, bw, bh);
    px += bw + r.int(1, 2) * unit;
    if (Math.abs(px - (x + w / 2)) < unit * 1.5) { guard(px); px += unit * 4; }
  }
  guard(x + w * 0.9);
  if (digits) {
    let s = '';
    for (let i = 0; i < 12; i++) s += r.int(0, 9);
    txt(c, s.replace(/(\d)(\d{5})(\d{5})(\d)/, '$1 $2 $3 $4'), x + w / 2, y + h * 0.9, { size: h * 0.16, fam: MONO, weight: 'normal', maxW: w * 0.92, color: col });
  }
}

// R.O.O.M. corporate mark: one-point-perspective room (floor, walls, ceiling, back door)
export function roomIcon(c, cx, cy, s, fg = '#111', bg = null, lw = 0.085) {
  const h = s / 2, i = s * 0.2;
  c.save();
  if (bg) rrect(c, cx - h * 1.12, cy - h * 1.12, s * 1.12, s * 1.12, s * 0.12, bg);
  c.strokeStyle = fg;
  c.lineWidth = s * lw;
  c.lineJoin = 'miter';
  c.strokeRect(cx - h, cy - h, s, s);
  c.strokeRect(cx - i, cy - i, i * 2, i * 2);
  c.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    c.moveTo(cx + sx * h, cy + sy * h);
    c.lineTo(cx + sx * i, cy + sy * i);
  }
  c.stroke();
  c.fillStyle = fg;
  c.fillRect(cx - i * 0.32, cy - i * 0.35, i * 0.64, i * 1.35);
  c.restore();
}

// Logo icon + "R.O.O.M." wordmark. Returns drawn width.
export function brand(c, x, y, size, fg = '#111', o = {}) {
  const icon = size * 1.0;
  c.save();
  c.font = fontStr(size, { fam: o.fam || SANS, weight: o.weight ?? '900' });
  const label = o.text || 'R.O.O.M.';
  const tw = c.measureText(label).width;
  const total = icon + size * 0.35 + tw;
  const x0 = o.align === 'left' ? x : x - total / 2;
  roomIcon(c, x0 + icon / 2, y, icon * 0.86, fg, null, 0.1);
  txt(c, label, x0 + icon + size * 0.35, y + size * 0.04, { size, color: fg, align: 'left', fam: o.fam || SANS, weight: o.weight ?? '900' });
  if (o.sub) txt(c, o.sub, x0 + icon + size * 0.35, y + size * 0.78, { size: size * 0.38, color: fg, align: 'left', fam: MONO, weight: 'bold', ls: size * 0.04 });
  c.restore();
  return total;
}

export function hazardStripes(c, x, y, w, h, s = 20, a = '#f2c418', b = '#151515') {
  c.save();
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  rect(c, x, y, w, h, a);
  c.fillStyle = b;
  for (let k = -h; k < w + h; k += s * 2) {
    c.beginPath();
    c.moveTo(x + k, y + h); c.lineTo(x + k + s, y + h); c.lineTo(x + k + s + h, y); c.lineTo(x + k + h, y);
    c.closePath(); c.fill();
  }
  c.restore();
}

// Biohazard trefoil drawn with shapes (no glyph dependency)
export function biohazard(c, cx, cy, r, col = '#111') {
  const t = document.createElement('canvas');
  const S = Math.ceil(r * 2.4);
  t.width = t.height = S;
  const g = t.getContext('2d');
  const o = S / 2;
  g.fillStyle = col;
  for (let k = 0; k < 3; k++) {
    const a = -PI / 2 + k * TAU / 3;
    g.beginPath(); g.arc(o + Math.cos(a) * r * 0.42, o + Math.sin(a) * r * 0.42, r * 0.56, 0, TAU); g.fill();
  }
  g.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 3; k++) {
    const a = -PI / 2 + k * TAU / 3;
    g.beginPath(); g.arc(o + Math.cos(a) * r * 0.56, o + Math.sin(a) * r * 0.56, r * 0.4, 0, TAU); g.fill();
  }
  g.beginPath(); g.arc(o, o, r * 0.17, 0, TAU); g.fill();
  for (let k = 0; k < 3; k++) {
    const a = PI / 2 + k * TAU / 3;
    g.save(); g.translate(o, o); g.rotate(a); g.fillRect(-r * 0.035, 0, r * 0.07, r * 0.4); g.restore();
  }
  g.globalCompositeOperation = 'source-over';
  g.lineWidth = r * 0.09; g.strokeStyle = col;
  g.beginPath(); g.arc(o, o, r * 0.36, 0, TAU); g.stroke();
  g.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 3; k++) {
    const a = PI / 2 + k * TAU / 3;
    g.save(); g.translate(o, o); g.rotate(a - PI / 2); g.fillRect(r * 0.2, -r * 0.035, r * 0.3, r * 0.07); g.restore();
  }
  c.drawImage(t, cx - o, cy - o);
}

export function flameIcon(c, cx, cy, s, col = '#111') {
  c.save();
  c.translate(cx, cy);
  c.scale(s / 100, s / 100);
  c.fillStyle = col;
  c.beginPath();
  c.moveTo(0, 48);
  c.bezierCurveTo(-34, 48, -42, 18, -30, -4);
  c.bezierCurveTo(-22, -18, -18, -28, -14, -46);
  c.bezierCurveTo(-4, -30, 0, -22, 2, -10);
  c.bezierCurveTo(8, -26, 18, -36, 16, -54);
  c.bezierCurveTo(34, -34, 42, -8, 36, 16);
  c.bezierCurveTo(32, 36, 20, 48, 0, 48);
  c.fill();
  c.restore();
}

export function hazardDiamond(c, cx, cy, s, bg = '#d22', fg = '#fff', label = 'FLAMMABLE', icon = 'flame', num = '') {
  c.save();
  c.translate(cx, cy);
  c.rotate(PI / 4);
  rect(c, -s / 2, -s / 2, s, s, bg);
  c.lineWidth = s * 0.035; c.strokeStyle = fg;
  c.strokeRect(-s * 0.44, -s * 0.44, s * 0.88, s * 0.88);
  c.restore();
  if (icon === 'flame') flameIcon(c, cx, cy - s * 0.17, s * 0.36, fg);
  if (label) txt(c, label, cx, cy + s * 0.2, { size: s * 0.11, color: fg, maxW: s * 0.62 });
  if (num) txt(c, num, cx, cy + s * 0.48, { size: s * 0.13, color: fg });
}

// Warning triangle with exclamation mark
export function warnTri(c, cx, cy, s, bg = ROOM_YELLOW, fg = INK) {
  c.save();
  c.beginPath(); c.moveTo(cx, cy - s * 0.5); c.lineTo(cx + s * 0.56, cy + s * 0.45); c.lineTo(cx - s * 0.56, cy + s * 0.45); c.closePath();
  c.fillStyle = bg; c.fill();
  c.lineJoin = 'round'; c.lineWidth = s * 0.08; c.strokeStyle = fg; c.stroke();
  c.fillStyle = fg;
  c.fillRect(cx - s * 0.045, cy - s * 0.18, s * 0.09, s * 0.36);
  c.fillRect(cx - s * 0.045, cy + s * 0.24, s * 0.09, s * 0.09);
  c.restore();
}

// Recycling / mobius loop (three chasing arrows), simplified
export function recycle(c, cx, cy, s, col = '#111') {
  c.save();
  c.translate(cx, cy);
  c.strokeStyle = col; c.fillStyle = col; c.lineWidth = s * 0.12; c.lineCap = 'butt';
  for (let k = 0; k < 3; k++) {
    c.save(); c.rotate(k * TAU / 3);
    c.beginPath(); c.moveTo(-s * 0.32, s * 0.18); c.lineTo(s * 0.02, -s * 0.38); c.stroke();
    c.beginPath(); c.moveTo(s * 0.12, -s * 0.48); c.lineTo(s * 0.12, -s * 0.22); c.lineTo(-s * 0.1, -s * 0.36); c.closePath(); c.fill();
    c.restore();
  }
  c.restore();
}

// 90s promo starburst
export function starburst(c, cx, cy, r, n, fill, stroke) {
  c.save();
  c.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * TAU - PI / 2, rr = i % 2 ? r * 0.8 : r;
    if (i) c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); else c.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  c.closePath();
  c.fillStyle = fill; c.fill();
  if (stroke) { c.lineWidth = r * 0.05; c.strokeStyle = stroke; c.stroke(); }
  c.restore();
}

// Halftone dot screen (printed-packaging look) in a rect, dot size by fn(u, v) -> 0..1
export function halftone(c, x, y, w, h, col, step = 6, fn = () => 0.5, angle = 0.26) {
  c.save();
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.fillStyle = col;
  c.translate(x + w / 2, y + h / 2); c.rotate(angle);
  const R = Math.hypot(w, h) / 2;
  for (let yy = -R; yy < R; yy += step) {
    for (let xx = -R; xx < R; xx += step) {
      const gx = xx * Math.cos(angle) - yy * Math.sin(angle), gy = xx * Math.sin(angle) + yy * Math.cos(angle);
      const u = (gx + w / 2) / w, v = (gy + h / 2) / h;
      if (u < -0.05 || u > 1.05 || v < -0.05 || v > 1.05) continue;
      const k = fn(u, v);
      if (k <= 0.02) continue;
      c.beginPath(); c.arc(xx, yy, step * 0.5 * Math.sqrt(Math.min(1, k)), 0, TAU); c.fill();
    }
  }
  c.restore();
}

// Printer's colour bar / registration marks (on flaps and seams)
export function colorBar(c, x, y, w, h, cols = ['#00a0e0', '#e0007a', '#f6e400', '#111']) {
  const n = cols.length * 2;
  for (let i = 0; i < n; i++) rect(c, x + (i * w) / n, y, w / n - 1, h, cols[i % cols.length]);
}
export function regMark(c, cx, cy, s, col = '#111') {
  c.save(); c.strokeStyle = col; c.lineWidth = Math.max(1, s * 0.08);
  c.beginPath(); c.arc(cx, cy, s * 0.32, 0, TAU); c.moveTo(cx - s / 2, cy); c.lineTo(cx + s / 2, cy); c.moveTo(cx, cy - s / 2); c.lineTo(cx, cy + s / 2); c.stroke();
  c.restore();
}

// FDA-style nutrition facts panel. rows: [label, value, bold?, indent?]
export function nutrition(c, x, y, w, rows, o = {}) {
  const ink = o.ink || '#111', s = o.size || 13;
  rect(c, x, y, w, o.h || (s * 2.2 + rows.length * s * 1.25 + s), o.bg || '#fff');
  c.strokeStyle = ink; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, w - 2, (o.h || (s * 2.2 + rows.length * s * 1.25 + s)) - 2);
  txt(c, o.title || 'Nutrition Facts', x + 6, y + s * 1.0, { size: s * 1.45, color: ink, align: 'left', weight: '900', fam: o.fam || SANS, maxW: w - 12 });
  let yy = y + s * 2.0;
  rect(c, x + 5, yy, w - 10, s * 0.45, ink); yy += s * 0.45;
  for (const [a, b, bold, ind] of rows) {
    yy += s * 1.25;
    txt(c, a, x + 6 + (ind ? s : 0), yy - s * 0.55, { size: s, color: ink, align: 'left', weight: bold ? '900' : 'normal', fam: o.fam || SANS, maxW: w * 0.68 });
    if (b) txt(c, b, x + w - 6, yy - s * 0.55, { size: s, color: ink, align: 'right', weight: bold ? '900' : 'normal', fam: o.fam || SANS });
    rect(c, x + 5, yy, w - 10, 1, ink);
  }
  return yy;
}

// Wood with grain running along canvas X
export function woodGrain(c, x, y, w, h, o = {}) {
  const r = new RNG(o.seed || 7);
  c.save();
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  rect(c, x, y, w, h, o.base || '#d8b47e');
  for (let i = 0; i < 6; i++) {
    const yy = y + r.next() * h, bh = h * r.range(0.15, 0.5);
    const g = c.createLinearGradient(0, yy - bh, 0, yy + bh);
    const a = r.range(0.04, 0.12);
    const tone = r.next() < 0.5 ? `rgba(120,70,25,${a})` : `rgba(255,235,190,${a})`;
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, tone); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(x, yy - bh, w, bh * 2);
  }
  const knots = [];
  for (let i = 0; i < (o.knots ?? 1); i++) knots.push([x + r.range(0.1, 0.9) * w, y + r.range(0.2, 0.8) * h, r.range(0.5, 1) * (o.knotSize ?? h * 0.18)]);
  const n = o.lines ?? Math.round(h / 2.2);
  const step = Math.max(4, w / 160);
  for (let i = 0; i < n; i++) {
    const y0 = y + (i + r.next()) * h / n;
    const amp = r.range(0.6, 2.2) * (o.wave ?? 1);
    const f1 = r.range(1.5, 4) / w * TAU, f2 = r.range(6, 14) / w * TAU, ph = r.next() * TAU;
    const dark = r.next() < 0.75;
    c.strokeStyle = dark ? `rgba(${o.dark || '110,62,22'},${r.range(0.08, 0.3)})` : `rgba(255,240,205,${r.range(0.05, 0.15)})`;
    c.lineWidth = r.range(0.6, dark ? 2.6 : 1.4) * (o.lw ?? 1);
    c.beginPath();
    for (let xx = 0; xx <= w + step; xx += step) {
      let yy = y0 + Math.sin(xx * f1 + ph) * amp * 3 + Math.sin(xx * f2 + ph * 1.7) * amp;
      for (const [kx, ky, kr] of knots) {
        const dx = (x + xx - kx) / (kr * 3.2), dy = yy - ky;
        const infl = Math.exp(-dx * dx) * kr * 1.4 / (1 + Math.abs(dy) / kr);
        yy += Math.sign(dy || 1) * infl;
      }
      if (xx === 0) c.moveTo(x + xx, yy); else c.lineTo(x + xx, yy);
    }
    c.stroke();
  }
  for (const [kx, ky, kr] of knots) {
    for (let k = 4; k >= 0; k--) {
      c.fillStyle = `rgba(${90 - k * 8},${50 - k * 5},${18},${0.12 + (4 - k) * 0.12})`;
      c.beginPath(); c.ellipse(kx, ky, kr * (0.35 + k * 0.28) * 1.6, kr * (0.35 + k * 0.28) * 0.7, 0, 0, TAU); c.fill();
    }
  }
  c.restore();
  noise(c, x, y, w, h, o.noise ?? 14, o.seed || 7);
}

export function endGrain(c, x, y, w, h, o = {}) {
  const r = new RNG(o.seed || 9);
  c.save();
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  rect(c, x, y, w, h, o.base || '#c99e66');
  const cx = x + w * (o.cx ?? 0.5), cy = y + h * (o.cy ?? 1.6);
  for (let k = 0; k < 70; k++) {
    const rad = k * Math.max(w, h) * 0.05 + r.next() * 2;
    c.strokeStyle = `rgba(110,62,22,${r.range(0.12, 0.35)})`;
    c.lineWidth = r.range(1, 3);
    c.beginPath(); c.arc(cx, cy, rad, 0, TAU); c.stroke();
  }
  // saw marks
  for (let k = 0; k < 14; k++) { c.strokeStyle = `rgba(255,240,210,${r.range(0.04, 0.1)})`; c.lineWidth = r.range(1, 3); const yy = y + r.next() * h; c.beginPath(); c.moveTo(x, yy); c.lineTo(x + w, yy + r.range(-4, 4)); c.stroke(); }
  c.restore();
  noise(c, x, y, w, h, 18, o.seed || 9);
}

// Chubby R.O.O.M. clone in hazmat suit (ID photos, posters, carton backs)
export function drawClone(c, cx, cy, s, o = {}) {
  const suit = o.suit || '#f2c418', dark = o.dark || '#a07c08';
  c.save();
  c.translate(cx, cy);
  c.scale(s / 100, s / 100);
  c.lineWidth = 3; c.strokeStyle = dark;
  c.fillStyle = suit;
  c.beginPath(); c.ellipse(0, 52, 48, 40, 0, 0, TAU); c.fill(); c.stroke();
  c.beginPath(); c.ellipse(-46, 52, 12, 22, 0.35, 0, TAU); c.fill(); c.stroke();
  c.beginPath(); c.ellipse(46, 52, 12, 22, -0.35, 0, TAU); c.fill(); c.stroke();
  c.beginPath(); c.ellipse(0, -2, 44, 42, 0, 0, TAU); c.fill(); c.stroke();
  const g = c.createLinearGradient(-30, -24, 30, 24);
  g.addColorStop(0, o.visorA || '#3b5d7a'); g.addColorStop(1, o.visorB || '#101a26');
  c.fillStyle = g;
  c.beginPath(); c.roundRect(-30, -22, 60, 40, 18); c.fill();
  c.lineWidth = 4; c.strokeStyle = '#2b2b2b'; c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.55)';
  c.beginPath(); c.ellipse(-14, -10, 10, 4, -0.4, 0, TAU); c.fill();
  if (o.face !== false) {
    c.fillStyle = 'rgba(255,240,220,0.85)';
    c.beginPath(); c.arc(-9, 0, 3.2, 0, TAU); c.arc(9, 0, 3.2, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(255,240,220,0.85)'; c.lineWidth = 2.4;
    c.beginPath(); c.arc(0, 4, 7, 0.25 * PI, 0.75 * PI); c.stroke();
  }
  c.fillStyle = '#fff'; c.fillRect(-12, 46, 24, 14);
  roomIcon(c, 0, 53, 9, '#111', null, 0.12);
  c.restore();
}

// Almond illustration
export function almond(c, cx, cy, s, rot = 0) {
  c.save();
  c.translate(cx, cy); c.rotate(rot);
  const g = c.createRadialGradient(-s * 0.15, -s * 0.2, s * 0.05, 0, 0, s * 0.7);
  g.addColorStop(0, '#dca066'); g.addColorStop(0.6, '#a8642f'); g.addColorStop(1, '#6e3a16');
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(0, -s * 0.62);
  c.bezierCurveTo(s * 0.42, -s * 0.3, s * 0.42, s * 0.42, 0, s * 0.46);
  c.bezierCurveTo(-s * 0.42, s * 0.42, -s * 0.42, -s * 0.3, 0, -s * 0.62);
  c.fill();
  c.strokeStyle = 'rgba(80,40,12,0.45)'; c.lineWidth = s * 0.025;
  for (let k = -2; k <= 2; k++) {
    c.beginPath(); c.moveTo(k * s * 0.07, -s * 0.5 + Math.abs(k) * s * 0.06);
    c.quadraticCurveTo(k * s * 0.13, 0, k * s * 0.08, s * 0.4 - Math.abs(k) * s * 0.05); c.stroke();
  }
  c.fillStyle = 'rgba(255,240,220,0.35)';
  c.beginPath(); c.ellipse(-s * 0.12, -s * 0.2, s * 0.06, s * 0.2, 0.2, 0, TAU); c.fill();
  c.restore();
}

export function leaf(c, cx, cy, s, rot, col = '#5c8a3a') {
  c.save(); c.translate(cx, cy); c.rotate(rot);
  c.fillStyle = col;
  c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(s * 0.5, -s * 0.35, s, 0); c.quadraticCurveTo(s * 0.5, s * 0.35, 0, 0); c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = s * 0.04;
  c.beginPath(); c.moveTo(0, 0); c.lineTo(s * 0.9, 0); c.stroke();
  c.restore();
}

export function scribble(c, x, y, w, seed, col = 'rgba(30,40,110,0.85)', lw = 2) {
  const r = new RNG(seed);
  c.save(); c.strokeStyle = col; c.lineWidth = lw; c.lineCap = 'round';
  c.beginPath(); c.moveTo(x, y);
  let px = x;
  while (px < x + w) {
    const nx = px + r.range(4, 9);
    c.quadraticCurveTo(px + r.range(0, 6), y + r.range(-7, 7), nx, y + r.range(-2, 2));
    if (r.next() < 0.1) { px = nx + r.range(4, 8); c.moveTo(px, y); } else px = nx;
  }
  c.stroke(); c.restore();
}

export function checkmark(c, x, y, s, col = 'rgba(30,40,110,0.9)') {
  c.save(); c.strokeStyle = col; c.lineWidth = s * 0.18; c.lineCap = 'round';
  c.beginPath(); c.moveTo(x - s * 0.4, y); c.lineTo(x - s * 0.1, y + s * 0.35); c.lineTo(x + s * 0.5, y - s * 0.45); c.stroke(); c.restore();
}

// Rubber-stamp text: rotated, rough-edged ink
export function inkStamp(c, s, x, y, o = {}) {
  c.save();
  c.translate(x, y); c.rotate(o.rot ?? -0.12);
  c.globalAlpha = o.alpha ?? 0.8;
  const col = o.color || '#b02a20';
  const w = o.w || 200, h = o.h || 50;
  c.strokeStyle = col; c.lineWidth = o.lw || 4;
  if (o.box !== false) c.strokeRect(-w / 2, -h / 2, w, h);
  txt(c, s, 0, 1, { size: o.size || h * 0.6, color: col, fam: o.fam || MONO, weight: '900', maxW: w - 12 });
  c.globalCompositeOperation = 'destination-out';
  const r = new RNG(o.seed || 5);
  for (let i = 0; i < (o.holes ?? 60); i++) { c.globalAlpha = r.range(0.2, 0.7); c.beginPath(); c.arc(r.range(-w / 2, w / 2), r.range(-h / 2, h / 2), r.range(0.5, 2.5), 0, TAU); c.fill(); }
  c.restore();
}

// ---------------------------------------------------------------------------
// Atlases
// ---------------------------------------------------------------------------
const atlasCache = new Map();

// Print resolution per atlas, as a fraction of the authored W x H. Layouts are authored in logical pixels and the
// canvas is rendered scaled, so this table is the single texture-memory knob. Tuned from measured texel density
// (area-weighted median px/mm on the model): hand-held prints land at ~2.5-4 px/mm, roughly screen-native when an
// item is held 30-40 cm from the camera at 1080p.
const ATLAS_SCALE = {
  soda_can: 0.75, energy_drink: 0.75, almond_milk: 0.75, almond_water: 0.75, canned_food: 0.75,
  protein_bar: 0.75, candy_bar: 0.75, camera_disposable: 0.75, painkillers: 0.75, photo: 0.75, keycard: 0.75,
  flare: 0.75, gear: 0.75, lighter: 0.75, fuse: 0.75, antibiotics: 0.5, multitool: 0.5, dart: 0.5,
  medkit: 0.75, chips: 0.75, lumber_decals: 0.75,
};
let atlasMs = 0;

// atlas(key, W, H, draw(ctx, W, H), {clear, plain: '#f4f4f4', scale}) -> { key, tex, W, H, R(x, y, w, h, rot, inset), plain }
export function atlas(key, W, H, draw, opt = {}) {
  if (atlasCache.has(key)) return atlasCache.get(key);
  const t0 = performance.now();
  const s = opt.scale ?? ATLAS_SCALE[key] ?? ATLAS_SCALE[key.replace(/_[^_]*$/, '')] ?? 1;
  const PW = Math.max(8, Math.round(W * s)), PH = Math.max(8, Math.round(H * s));
  const ins = 0.75 * W / PW; // keep a ~0.75 texel inset at the real resolution
  const R = (x, y, w, h, rot = 0, inset = ins) => [(x + inset) / W, 1 - (y + h - inset) / H, (x + w - inset) / W, 1 - (y + inset) / H, rot];
  const tex = labelTexture(PW, PH, (c) => {
    if (PW !== W || PH !== H) c.scale(PW / W, PH / H);
    if (opt.clear) { draw(c, W, H); return; }
    rect(c, 0, 0, W, H, opt.bg || '#ffffff');
    draw(c, W, H);
    if (opt.plain !== false) {
      rect(c, W - 64, H - 64, 64, 64, opt.plain || '#f4f4f4');
      noise(c, W - 64, H - 64, 64, 64, 8, 99);
    }
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  tex.userData.key = key;
  const a = { key, tex, W, H, PW, PH, R, plain: R(W - 56, H - 56, 48, 48) };
  atlasCache.set(key, a);
  atlasMs += performance.now() - t0;
  return a;
}
export function atlasList() {
  return [...atlasCache.values()].map((a) => ({ key: a.key, w: a.PW, h: a.PH, mb: (a.PW * a.PH * 4 * 1.333) / 1048576 }));
}
export function atlasStats() {
  let bytes = 0;
  for (const a of atlasCache.values()) bytes += a.PW * a.PH * 4 * 1.333;
  return { count: atlasCache.size, mb: bytes / 1048576, ms: atlasMs };
}
