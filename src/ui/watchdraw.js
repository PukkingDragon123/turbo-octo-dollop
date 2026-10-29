// Drawing kit for the wrist watch face (ui/watch.js): plain, flat, high-resolution canvas drawing.
// Everything is laid out in watch units (the face is 160 x 120 of them) and drawn S device pixels per unit, so
// shapes take the canvas transform scale(S) while text is set at whole device pixel sizes in the 'watch' font
// slot (ui/fonts.js; the family is picked there, never here). One ink colour, one dimmer tone of the same hue,
// one muted red for danger; thin rules and simple vector shapes; no glow, outline or shadow.
//   begin(ctx)                          once per redraw (resets font state, re-measures the cap height if needed)
//   txt(ctx, s, x, y, size, col, align, maxW)   y = top of the text band (same rows the old bitmap font used)
//   tw(ctx, s, size) -> width in units     wrap(ctx, s, maxW, size) -> lines
//   rule, frame, bar, dot, icon(ctx, name, cx, cy, r, col, fill), bullet(ctx, cx, cy, state)
import { font, FONT } from './fonts.js';

export const S = 4; // device pixels per watch unit (640 x 480 canvas for the 160 x 120 face)

// palette: one hue (a quiet grey-green), two tones of it, a muted red, a dark ground
export const BG = '#0a100c';
export const INK = '#d3e2d7';
export const DIM = '#7f978a';
export const LINE = 'rgba(127,151,138,0.42)'; // DIM, thinner: dividers, frames, grid
export const TRACK = 'rgba(127,151,138,0.22)'; // DIM, faint: empty bar tracks, visited map cells
export const RED = '#c46a60';

// text sizes in units: M body (the old 5x7 font), SM small (the old 3x5 font), L big (the old font at x2)
export const SM = 6.5, M = 9.5, L = 18;

const LW = 0.5; // stroke width in units (2 device px)
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

// flat bar: a faint track and a solid fill
export function bar(c, x, y, w, h, f, col) {
  f = Math.max(0, Math.min(1, Number.isFinite(f) ? f : 0));
  c.fillStyle = TRACK;
  c.fillRect(x, y, w, h);
  if (f > 0) { c.fillStyle = col; c.fillRect(x, y, w * f, h); }
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
