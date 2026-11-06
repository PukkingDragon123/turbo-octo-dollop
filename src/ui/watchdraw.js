// Drawing kit for the wrist watch face (ui/watch.js): an old wristwatch LCD with a warm backlight, painted.
// Apps draw their content in dark LCD ink onto a clear layer (watch units, 160 x 120 of them, S device px each);
// face() then composes the layer over a hand-painted backlit ground: the liquid-crystal ink casts its little
// offset shadow onto the reflector, the glass has a soft sheen and the corners fall into shade.
//   begin(ctx)                          once per redraw (resets font state, re-measures the cap height if needed)
//   txt(ctx, s, x, y, size, col, align, maxW)   y = top of the text band
//   tw(ctx, s, size) -> width in units     wrap(ctx, s, maxW, size) -> lines
//   rule, vrule, frame, bar, dot, ring, icon(ctx, name, cx, cy, r, col, fill), bullet(ctx, cx, cy, state)
//   erase(ctx, x, y, w, h)              clear a patch of the layer (labels over map lines, banners)
//   face(dst, layer, t, glow)            compose the finished face (ground + ink shadow + ink + glass)
// Text is set in the 'watch' font slot (ui/fonts.js; the family is picked there, never here).
import { font, FONT } from './fonts.js';

export const S = 4; // device pixels per watch unit (640 x 480 canvas for the 160 x 120 face)

// palette: dark warm LCD ink on a honey backlight, a lighter tone of the ink, a rust red for danger
export const BG = '#d9b66c';                  // the lit ground (average; the painted ground varies around it)
export const INK = '#2a2216';
export const DIM = '#6f5a36';
export const LINE = 'rgba(64,48,24,0.42)';    // dividers, frames, grid
export const TRACK = 'rgba(64,48,24,0.17)';   // empty bar tracks, visited map cells
export const RED = '#8c2e1a';

// text sizes in units: M body (the old 5x7 font), SM small (the old 3x5 font), L big (the old font at x2)
export const SM = 6.5, M = 9.5, L = 18;

const LW = 0.55; // stroke width in units (2.2 device px)
const TAU = Math.PI * 2;

let famKey = '';
let cap = 0.6; // cap height / font size, measured from the live face
let capDirty = true;
const fonts = new Map();
if (typeof document !== 'undefined' && document.fonts?.addEventListener) document.fonts.addEventListener('loadingdone', () => { capDirty = true; });

function fontFor(size) {
  if (FONT.watch !== famKey) { famKey = FONT.watch; fonts.clear(); capDirty = true; }
  const px = Math.max(6, Math.round(size * S));
  let f = fonts.get(px);
  if (!f) { f = font('watch', px); fonts.set(px, f); }
  return f;
}

function setFont(c, size) {
  const f = fontFor(size);
  if (c.__wf !== f) { c.font = f; c.__wf = f; }
}

export function begin(c) {
  c.__wf = null;
  if (FONT.watch !== famKey) fontFor(M);
  if (capDirty) {
    capDirty = false;
    c.font = fontFor(25); c.__wf = null;
    const a = c.measureText('H').actualBoundingBoxAscent;
    cap = a > 0 ? Math.min(0.8, Math.max(0.45, a / (25 * S))) : 0.6;
  }
  c.textBaseline = 'alphabetic';
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.shadowBlur = 0;
  c.shadowColor = 'rgba(0,0,0,0)';
  c.globalAlpha = 1;
}

// text: y is the top of the band the old bitmap font occupied (7 units for M); the caps are centred in it.
// maxW (units) condenses the line to fit instead of letting it run off the face.
export function txt(c, s, x, y, size, col, align = 'left', maxW = 0) {
  setFont(c, size);
  c.fillStyle = col;
  if (c.textAlign !== align) c.textAlign = align;
  const band = size * 0.74;
  const base = y + (band + size * cap) / 2;
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (maxW > 0) c.fillText(s, x * S, base * S, maxW * S); else c.fillText(s, x * S, base * S);
  c.setTransform(S, 0, 0, S, 0, 0);
}

export function tw(c, s, size) {
  setFont(c, size);
  return c.measureText(s).width / S;
}

export function wrap(c, s, maxW, size) {
  const words = String(s).toUpperCase().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (cur && tw(c, t, size) > maxW) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

// horizontal rule from x0 to x1 at row y (th units thick)
export function rule(c, x0, x1, y, col, th = LW) {
  c.fillStyle = col;
  c.fillRect(x0, y, x1 - x0, th);
}

export function vrule(c, x, y0, y1, col, th = LW / 2) {
  c.fillStyle = col;
  c.fillRect(x, y0, th, y1 - y0);
}

// thin rectangle outline, drawn inside x, y, w, h
export function frame(c, x, y, w, h, col, th = LW / 2) {
  c.strokeStyle = col;
  c.lineWidth = th;
  c.strokeRect(x + th / 2, y + th / 2, w - th, h - th);
}

// bar: a faint track and a solid fill with softly rounded ends
export function bar(c, x, y, w, h, f, col) {
  f = Math.max(0, Math.min(1, Number.isFinite(f) ? f : 0));
  const r = Math.min(h / 2, 1.2);
  c.fillStyle = TRACK;
  rrect(c, x, y, w, h, r); c.fill();
  if (f > 0) { c.fillStyle = col; rrect(c, x, y, Math.max(h, w * f), h, r); c.fill(); }
}

function rrect(c, x, y, w, h, r) {
  c.beginPath();
  if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
}

// clear a patch of the ink layer back to the lit ground
export function erase(c, x, y, w, h) {
  const op = c.globalCompositeOperation;
  c.globalCompositeOperation = 'destination-out';
  c.fillStyle = '#000';
  c.fillRect(x, y, w, h);
  c.globalCompositeOperation = op;
}

// ---------------------------------------------------------------- the face
let ground = null; // the painted, backlit ground (drawn once per size)
function paintGround(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  // backlight: a warm bulb off the lower left edge, falling off toward the far corner
  const lg = g.createRadialGradient(w * 0.3, h * 0.7, h * 0.05, w * 0.42, h * 0.55, w * 0.85);
  lg.addColorStop(0, '#f2dc9c');
  lg.addColorStop(0.45, '#e2c27c');
  lg.addColorStop(1, '#b48c4c');
  g.fillStyle = lg;
  g.fillRect(0, 0, w, h);
  // broad, soft brush strokes: slow value shifts, nothing noisy
  let s = 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 26; i++) {
    const x = rnd() * w, y = rnd() * h, rw = w * (0.15 + rnd() * 0.35), rh = h * (0.03 + rnd() * 0.08);
    g.save();
    g.translate(x, y);
    g.rotate((rnd() - 0.5) * 0.35);
    const bg = g.createRadialGradient(0, 0, 0, 0, 0, rw);
    const warm = rnd() < 0.6;
    bg.addColorStop(0, warm ? 'rgba(255,236,180,0.10)' : 'rgba(120,90,40,0.08)');
    bg.addColorStop(1, 'rgba(0,0,0,0)');
    g.scale(1, rh / rw);
    g.fillStyle = bg;
    g.beginPath(); g.arc(0, 0, rw, 0, TAU); g.fill();
    g.restore();
  }
  // the reflector's faint fibre: a few long, very light streaks
  g.globalAlpha = 0.05;
  g.strokeStyle = '#5a4220';
  for (let i = 0; i < 18; i++) {
    const y = rnd() * h;
    g.lineWidth = 1 + rnd() * 2;
    g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + (rnd() - 0.5) * 8, w * 0.7, y + (rnd() - 0.5) * 8, w, y + (rnd() - 0.5) * 6); g.stroke();
  }
  g.globalAlpha = 1;
  // corners in shade under the bezel
  const vg = g.createRadialGradient(w / 2, h / 2, h * 0.42, w / 2, h / 2, w * 0.66);
  vg.addColorStop(0, 'rgba(60,40,15,0)');
  vg.addColorStop(1, 'rgba(60,40,15,0.42)');
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);
  return cv;
}

// compose: ground, the ink's shadow on the reflector, the ink, a soft glass sheen. glow 0..1 dims the backlight.
export function face(c, layer, t, glow = 1) {
  const w = c.canvas.width, h = c.canvas.height;
  if (!ground || ground.width !== w || ground.height !== h) ground = paintGround(w, h);
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.shadowColor = 'rgba(0,0,0,0)';
  c.drawImage(ground, 0, 0);
  if (glow < 1) { c.fillStyle = `rgba(40,28,12,${(1 - glow) * 0.55})`; c.fillRect(0, 0, w, h); }
  // the liquid crystal sits above the reflector: each mark throws a faint offset shadow
  c.globalAlpha = 0.2;
  c.drawImage(layer, S * 0.8, S * 1.1);
  c.globalAlpha = 0.95;
  c.drawImage(layer, 0, 0);
  c.globalAlpha = 1;
  // glass: a soft diagonal sheen across the top left
  const sh = c.createLinearGradient(0, 0, w * 0.55, h * 0.75);
  sh.addColorStop(0, 'rgba(255,250,235,0.16)');
  sh.addColorStop(0.45, 'rgba(255,250,235,0.04)');
  sh.addColorStop(0.46, 'rgba(255,250,235,0)');
  c.fillStyle = sh;
  c.fillRect(0, 0, w, h);
}

export function dot(c, x, y, r, col) {
  c.fillStyle = col;
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
}

export function ring(c, x, y, r, col, th = LW) {
  c.strokeStyle = col;
  c.lineWidth = th;
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.stroke();
}

// line icons in a [-1, 1] box (canvas y points down)
const ICONS = {
  home(c) {
    c.moveTo(-0.95, -0.05); c.lineTo(0, -0.9); c.lineTo(0.95, -0.05);
    c.moveTo(-0.65, -0.3); c.lineTo(-0.65, 0.9); c.lineTo(0.65, 0.9); c.lineTo(0.65, -0.3);
    c.moveTo(-0.2, 0.9); c.lineTo(-0.2, 0.35); c.lineTo(0.2, 0.35); c.lineTo(0.2, 0.9);
  },
  pulse(c) {
    c.moveTo(-1, 0.1); c.lineTo(-0.45, 0.1); c.lineTo(-0.22, -0.75); c.lineTo(0.08, 0.8); c.lineTo(0.32, -0.2); c.lineTo(0.48, 0.1); c.lineTo(1, 0.1);
  },
  task(c) {
    c.rect(-0.7, -0.9, 1.4, 1.8);
    c.moveTo(-0.35, -0.4); c.lineTo(0.38, -0.4); c.moveTo(-0.35, 0.05); c.lineTo(0.38, 0.05); c.moveTo(-0.35, 0.5); c.lineTo(0.38, 0.5);
  },
  coin(c) {
    c.moveTo(0.9, 0); c.arc(0, 0, 0.9, 0, TAU);
    c.moveTo(0.42, 0); c.arc(0, 0, 0.42, 0, TAU);
  },
  map(c) {
    c.moveTo(-0.95, -0.7); c.lineTo(-0.32, -0.9); c.lineTo(0.32, -0.7); c.lineTo(0.95, -0.9);
    c.lineTo(0.95, 0.7); c.lineTo(0.32, 0.9); c.lineTo(-0.32, 0.7); c.lineTo(-0.95, 0.9); c.closePath();
    c.moveTo(-0.32, -0.9); c.lineTo(-0.32, 0.7); c.moveTo(0.32, -0.7); c.lineTo(0.32, 0.9);
  },
  scan(c) {
    for (let k = 0; k < 4; k++) { const sx = k & 1 ? 1 : -1, sy = k & 2 ? 1 : -1; c.moveTo(sx * 0.95, sy * 0.45); c.lineTo(sx * 0.95, sy * 0.95); c.lineTo(sx * 0.45, sy * 0.95); }
    c.moveTo(0.4, 0); c.arc(0, 0, 0.4, 0, TAU);
  },
  radio(c) {
    c.rect(-0.9, -0.35, 1.8, 1.25);
    c.moveTo(-0.5, -0.35); c.lineTo(0.55, -1);
    c.moveTo(-0.05, 0.28); c.arc(-0.35, 0.28, 0.3, 0, TAU);
    for (let y = 0.02; y < 0.6; y += 0.26) { c.moveTo(0.22, y); c.lineTo(0.62, y); }
  },
  bolt(c) {
    c.moveTo(0.28, -1); c.lineTo(-0.55, 0.12); c.lineTo(-0.02, 0.12); c.lineTo(-0.28, 1); c.lineTo(0.6, -0.22); c.lineTo(0.06, -0.22); c.closePath();
  },
  heart(c) {
    c.moveTo(0, 0.9); c.bezierCurveTo(-1.35, -0.05, -0.75, -1.15, 0, -0.42); c.bezierCurveTo(0.75, -1.15, 1.35, -0.05, 0, 0.9); c.closePath();
  },
  food(c) {
    c.moveTo(0.78, 0.2); c.arc(0, 0.2, 0.78, 0, TAU);
    c.moveTo(0.02, -0.5); c.quadraticCurveTo(0.12, -1.05, 0.68, -0.98); c.quadraticCurveTo(0.5, -0.5, 0.02, -0.5);
  },
  drop(c) {
    c.moveTo(0, -1); c.lineTo(0.64, 0.02); c.arc(0, 0.3, 0.7, -0.41, Math.PI + 0.41); c.closePath();
  },
  flame(c) {
    c.moveTo(0, 0.95); c.bezierCurveTo(-0.75, 0.95, -0.85, 0.15, -0.35, -0.35); c.quadraticCurveTo(-0.2, 0.1, 0.02, 0.15);
    c.quadraticCurveTo(-0.15, -0.55, 0.2, -1); c.bezierCurveTo(0.45, -0.45, 0.85, -0.1, 0.75, 0.35); c.bezierCurveTo(0.68, 0.75, 0.35, 0.95, 0, 0.95); c.closePath();
  },
  moon(c) {
    c.moveTo(0.35, -0.9); c.bezierCurveTo(-0.6, -0.95, -1.05, 0.25, -0.45, 0.75); c.bezierCurveTo(0.05, 1.15, 0.75, 0.85, 0.9, 0.35);
    c.bezierCurveTo(0.2, 0.6, -0.35, 0.05, 0.35, -0.9); c.closePath();
  },
  lock(c) {
    c.rect(-0.75, -0.1, 1.5, 1.05);
    c.moveTo(-0.45, -0.1); c.lineTo(-0.45, -0.45); c.arc(0, -0.45, 0.45, Math.PI, 0); c.lineTo(0.45, -0.1);
  },
  flag(c) {
    c.moveTo(-0.6, 1); c.lineTo(-0.6, -0.95); c.lineTo(0.75, -0.52); c.lineTo(-0.6, -0.1);
  },
  check(c) {
    c.moveTo(-0.85, 0.02); c.lineTo(-0.28, 0.62); c.lineTo(0.85, -0.62);
  },
};

// icon centred at cx, cy with half-size r (units). fill: a solid shape (the coin stays a ring)
export function icon(c, name, cx, cy, r, col, fill = false) {
  const draw = ICONS[name] || ICONS.home;
  c.save();
  c.translate(cx, cy);
  c.scale(r, r);
  c.beginPath();
  draw(c);
  if (fill) { c.fillStyle = col; c.fill(name === 'coin' ? 'evenodd' : 'nonzero'); } else { c.strokeStyle = col; c.lineWidth = LW / r; c.stroke(); }
  c.restore();
}

// list bullet: 'done' a check, 'cur' a filled dot, anything else an open ring
export function bullet(c, cx, cy, state) {
  if (state === 'done') icon(c, 'check', cx, cy, 2.2, DIM);
  else if (state === 'cur') dot(c, cx, cy, 1.9, INK);
  else ring(c, cx, cy, 1.7, DIM, LW * 0.8);
}
