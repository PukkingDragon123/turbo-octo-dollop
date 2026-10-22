// Green phosphor terminal kit (Pip-Boy-like) for the camp kiosks: monochrome green on deep green-black,
// glowing type in the CRT / mono font roles, and no boxes: underline rules, bracket corners, segmented tick
// bars and small procedural line pictograms.
//   PH                         palette (intensity levels of one phosphor)
//   ptext(ctx, s, x, y, size, o)   glowing text  o: { c, align, role: 'crt'|'mono', blur, base, weight }
//   rule(ctx, x0, x1, y, c)    underline rule with end ticks      brackets(ctx, x, y, w, h, len, c)
//   ticks(ctx, x, y, w, h, f, c, n)  segmented tick bar           icon(ctx, name, cx, cy, s, c)  pictogram
//   phosphorFx(ctx, w, h, t)   extra CRT life on top of CrtScreen's scanlines: phosphor noise, flicker, edge burn
import { FONT } from './fonts.js';

export const PH = { bg: '#010a04', fg: '#4dff7a', hi: '#c8ffd4', mid: '#33d460', dim: '#1d8a3c', faint: '#0e4220', ghost: '#072812' };
export const PH_PAL = { fg: PH.fg, dim: PH.dim, bg: PH.bg, hi: PH.hi, bad: PH.hi, good: PH.fg };

export function pfont(size, role = 'crt', weight = '') { return `${weight ? weight + ' ' : ''}${size}px ${FONT[role] || FONT.crt}`; }

export function ptext(ctx, s, x, y, size, o = {}) {
  ctx.font = pfont(size, o.role, o.weight);
  ctx.textAlign = o.align || 'left';
  ctx.textBaseline = o.base || 'top';
  const c = o.c || PH.fg;
  ctx.fillStyle = c;
  const blur = o.blur ?? Math.round(size * 0.3);
  if (blur) { ctx.shadowColor = c; ctx.shadowBlur = blur; }
  ctx.fillText(String(s), x, y);
  ctx.shadowBlur = 0;
  return ctx.measureText(String(s)).width;
}

export function rule(ctx, x0, x1, y, c = PH.dim, lw = 2) {
  ctx.fillStyle = c;
  ctx.fillRect(x0, y, x1 - x0, lw);
  ctx.fillRect(x0, y - 4, lw, 4 + lw);
  ctx.fillRect(x1 - lw, y - 4, lw, 4 + lw);
}

export function brackets(ctx, x, y, w, h, len = 10, c = PH.fg, lw = 2) {
  ctx.fillStyle = c;
  for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
    ctx.fillRect(sx > 0 ? cx : cx - len, sy > 0 ? cy : cy - lw, len, lw);
    ctx.fillRect(sx > 0 ? cx : cx - lw, sy > 0 ? cy : cy - len, lw, len);
  }
}

// segmented tick bar: filled ticks full height, the rest short and dim
export function ticks(ctx, x, y, w, h, f, c = PH.fg, n = 20) {
  f = Math.max(0, Math.min(1, Number.isFinite(f) ? f : 0));
  const step = w / n, tw = Math.max(2, Math.floor(step * 0.55));
  const on = Math.round(f * n);
  for (let i = 0; i < n; i++) {
    const tx = Math.round(x + i * step);
    if (i < on) { ctx.fillStyle = c; ctx.fillRect(tx, y, tw, h); }
    else { ctx.fillStyle = PH.faint; ctx.fillRect(tx, y + h * 0.55, tw, h * 0.45); }
  }
}

// ---------------------------------------------------------------- pictograms (line art, unit box -1..1)
const P = Math.PI;
function stroke(ctx, c, lw) { ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; }
const ICONS = {
  // the company mascot giving a thumbs up
  vault(ctx) {
    ctx.beginPath(); ctx.arc(-0.15, -0.45, 0.32, 0, P * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(-0.15, -0.42, 0.17, 0.2, P - 0.2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-0.15, -0.13); ctx.lineTo(-0.15, 0.55); ctx.moveTo(-0.15, 0.55); ctx.lineTo(-0.45, 0.95); ctx.moveTo(-0.15, 0.55); ctx.lineTo(0.15, 0.95);
    ctx.moveTo(-0.15, 0.1); ctx.lineTo(-0.55, 0.35); ctx.moveTo(-0.15, 0.1); ctx.lineTo(0.35, 0.05); ctx.lineTo(0.42, -0.25); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0.42, -0.25); ctx.lineTo(0.42, -0.45); ctx.stroke();
  },
  heart(ctx) { ctx.beginPath(); ctx.moveTo(0, 0.75); ctx.bezierCurveTo(-1.1, -0.1, -0.6, -0.95, 0, -0.35); ctx.bezierCurveTo(0.6, -0.95, 1.1, -0.1, 0, 0.75); ctx.stroke(); },
  coin(ctx) { ctx.beginPath(); ctx.arc(0, 0, 0.8, 0, P * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0.3, -0.35); ctx.quadraticCurveTo(-0.35, -0.55, -0.3, -0.15); ctx.quadraticCurveTo(0.35, 0.05, 0.3, 0.3); ctx.quadraticCurveTo(-0.1, 0.55, -0.35, 0.35); ctx.moveTo(0, -0.6); ctx.lineTo(0, 0.6); ctx.stroke(); },
  blade(ctx) { ctx.beginPath(); ctx.moveTo(-0.8, 0.8); ctx.lineTo(-0.45, 0.45); ctx.moveTo(-0.65, 0.3); ctx.lineTo(-0.3, 0.65); ctx.moveTo(-0.45, 0.45); ctx.lineTo(0.7, -0.7); ctx.lineTo(0.8, -0.8); ctx.lineTo(0.55, -0.3); ctx.lineTo(-0.3, 0.55); ctx.stroke(); },
  fist(ctx) { ctx.beginPath(); ctx.moveTo(-0.6, -0.3); for (let i = 0; i < 4; i++) { ctx.arc(-0.45 + i * 0.3, -0.35, 0.15, P, 0); } ctx.lineTo(0.55, 0.3); ctx.quadraticCurveTo(0.5, 0.75, 0, 0.75); ctx.lineTo(-0.6, 0.6); ctx.closePath(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-0.6, 0.05); ctx.lineTo(0.05, 0.05); ctx.stroke(); },
  scan(ctx) { ctx.beginPath(); ctx.ellipse(0, 0, 0.85, 0.5, 0, 0, P * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 0.25, 0, P * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-1, -0.85); ctx.lineTo(-0.7, -0.85); ctx.moveTo(-1, -0.85); ctx.lineTo(-1, -0.55); ctx.moveTo(1, 0.85); ctx.lineTo(0.7, 0.85); ctx.moveTo(1, 0.85); ctx.lineTo(1, 0.55); ctx.stroke(); },
  gear(ctx) { ctx.beginPath(); for (let i = 0; i < 16; i++) { const a = (i / 16) * P * 2, r = i % 2 ? 0.62 : 0.85; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 0.25, 0, P * 2); ctx.stroke(); },
  file(ctx) { ctx.beginPath(); ctx.moveTo(-0.6, -0.8); ctx.lineTo(0.3, -0.8); ctx.lineTo(0.6, -0.5); ctx.lineTo(0.6, 0.8); ctx.lineTo(-0.6, 0.8); ctx.closePath(); ctx.moveTo(-0.35, -0.3); ctx.lineTo(0.35, -0.3); ctx.moveTo(-0.35, 0); ctx.lineTo(0.35, 0); ctx.moveTo(-0.35, 0.3); ctx.lineTo(0.15, 0.3); ctx.stroke(); },
  bolt(ctx) { ctx.beginPath(); ctx.moveTo(0.2, -0.9); ctx.lineTo(-0.45, 0.1); ctx.lineTo(0.05, 0.1); ctx.lineTo(-0.2, 0.9); ctx.lineTo(0.5, -0.15); ctx.lineTo(0, -0.15); ctx.closePath(); ctx.stroke(); },
  lock(ctx) { ctx.beginPath(); ctx.rect(-0.55, -0.1, 1.1, 0.85); ctx.moveTo(-0.35, -0.1); ctx.lineTo(-0.35, -0.4); ctx.arc(0, -0.4, 0.35, P, 0); ctx.lineTo(0.35, -0.1); ctx.moveTo(0, 0.2); ctx.lineTo(0, 0.45); ctx.stroke(); },
  check(ctx) { ctx.beginPath(); ctx.moveTo(-0.7, 0); ctx.lineTo(-0.2, 0.55); ctx.lineTo(0.75, -0.6); ctx.stroke(); },
  star(ctx) { ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = -P / 2 + i * P / 5, r = i % 2 ? 0.38 : 0.9; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); ctx.stroke(); },
  skull(ctx) { ctx.beginPath(); ctx.arc(0, -0.15, 0.62, P * 0.85, P * 0.15); ctx.lineTo(0.35, 0.75); ctx.lineTo(-0.35, 0.75); ctx.closePath(); ctx.stroke(); ctx.beginPath(); ctx.arc(-0.25, -0.1, 0.13, 0, P * 2); ctx.arc(0.25, -0.1, 0.13, 0, P * 2); ctx.stroke(); },
  crate(ctx) { ctx.beginPath(); ctx.rect(-0.75, -0.6, 1.5, 1.3); ctx.moveTo(-0.75, -0.6); ctx.lineTo(0.75, 0.7); ctx.moveTo(0.75, -0.6); ctx.lineTo(-0.75, 0.7); ctx.stroke(); },
  food(ctx) { ctx.beginPath(); ctx.ellipse(0, -0.55, 0.55, 0.15, 0, 0, P * 2); ctx.moveTo(-0.55, -0.55); ctx.lineTo(-0.55, 0.6); ctx.ellipse(0, 0.6, 0.55, 0.15, 0, P, 0, true); ctx.lineTo(0.55, -0.55); ctx.moveTo(-0.55, 0.05); ctx.lineTo(0.55, 0.05); ctx.stroke(); },
  shield(ctx) { ctx.beginPath(); ctx.moveTo(0, -0.85); ctx.lineTo(0.7, -0.55); ctx.quadraticCurveTo(0.7, 0.45, 0, 0.9); ctx.quadraticCurveTo(-0.7, 0.45, -0.7, -0.55); ctx.closePath(); ctx.moveTo(0, -0.55); ctx.lineTo(0, 0.55); ctx.stroke(); },
  helmet(ctx) { ctx.beginPath(); ctx.arc(0, 0.2, 0.65, P, 0); ctx.moveTo(-0.9, 0.2); ctx.lineTo(0.9, 0.2); ctx.moveTo(0, -0.45); ctx.lineTo(0, 0.2); ctx.stroke(); },
  battery(ctx) { ctx.beginPath(); ctx.rect(-0.75, -0.4, 1.35, 0.8); ctx.rect(0.6, -0.15, 0.15, 0.3); ctx.moveTo(-0.45, 0); ctx.lineTo(-0.15, 0); ctx.moveTo(0.05, 0); ctx.lineTo(0.35, 0); ctx.moveTo(0.2, -0.15); ctx.lineTo(0.2, 0.15); ctx.stroke(); },
  arm(ctx) { ctx.beginPath(); ctx.moveTo(-0.8, 0.6); ctx.lineTo(-0.1, 0.6); ctx.quadraticCurveTo(0.5, 0.6, 0.5, 0.0); ctx.lineTo(0.5, -0.45); ctx.arc(0.3, -0.5, 0.25, 0, P, true); ctx.moveTo(-0.8, 0.2); ctx.lineTo(-0.1, 0.2); ctx.quadraticCurveTo(0.15, 0.2, 0.15, -0.1); ctx.stroke(); },
  brain(ctx) { ctx.beginPath(); ctx.ellipse(0, 0, 0.8, 0.6, 0, 0, P * 2); ctx.moveTo(0, -0.6); ctx.quadraticCurveTo(-0.2, 0, 0, 0.6); ctx.moveTo(-0.5, -0.3); ctx.quadraticCurveTo(-0.25, 0, -0.55, 0.25); ctx.moveTo(0.5, -0.3); ctx.quadraticCurveTo(0.25, 0, 0.55, 0.25); ctx.stroke(); },
  drop(ctx) { ctx.beginPath(); ctx.moveTo(0, -0.85); ctx.quadraticCurveTo(0.7, 0.05, 0.55, 0.4); ctx.arc(0, 0.35, 0.55, 0, P); ctx.quadraticCurveTo(-0.7, 0.05, 0, -0.85); ctx.stroke(); },
  cart(ctx) { ctx.beginPath(); ctx.moveTo(-0.9, -0.5); ctx.lineTo(-0.6, -0.5); ctx.lineTo(-0.35, 0.35); ctx.lineTo(0.75, 0.35); ctx.lineTo(0.85, -0.25); ctx.lineTo(-0.5, -0.25); ctx.stroke(); ctx.beginPath(); ctx.arc(-0.2, 0.62, 0.12, 0, P * 2); ctx.arc(0.6, 0.62, 0.12, 0, P * 2); ctx.stroke(); },
  radio(ctx) { ctx.beginPath(); ctx.rect(-0.8, -0.25, 1.6, 0.95); ctx.moveTo(-0.5, -0.25); ctx.lineTo(0.4, -0.9); ctx.stroke(); ctx.beginPath(); ctx.arc(-0.35, 0.22, 0.22, 0, P * 2); ctx.moveTo(0.15, 0.05); ctx.lineTo(0.6, 0.05); ctx.moveTo(0.15, 0.35); ctx.lineTo(0.6, 0.35); ctx.stroke(); },
  map(ctx) { ctx.beginPath(); ctx.moveTo(-0.85, -0.6); ctx.lineTo(-0.3, -0.8); ctx.lineTo(0.3, -0.6); ctx.lineTo(0.85, -0.8); ctx.lineTo(0.85, 0.6); ctx.lineTo(0.3, 0.8); ctx.lineTo(-0.3, 0.6); ctx.lineTo(-0.85, 0.8); ctx.closePath(); ctx.moveTo(-0.3, -0.8); ctx.lineTo(-0.3, 0.6); ctx.moveTo(0.3, -0.6); ctx.lineTo(0.3, 0.8); ctx.stroke(); },
  pulse(ctx) { ctx.beginPath(); ctx.moveTo(-0.95, 0.1); ctx.lineTo(-0.45, 0.1); ctx.lineTo(-0.25, -0.6); ctx.lineTo(0.05, 0.7); ctx.lineTo(0.3, -0.2); ctx.lineTo(0.45, 0.1); ctx.lineTo(0.95, 0.1); ctx.stroke(); },
  home(ctx) { ctx.beginPath(); ctx.moveTo(-0.85, 0); ctx.lineTo(0, -0.8); ctx.lineTo(0.85, 0); ctx.moveTo(-0.6, -0.2); ctx.lineTo(-0.6, 0.8); ctx.lineTo(0.6, 0.8); ctx.lineTo(0.6, -0.2); ctx.moveTo(-0.15, 0.8); ctx.lineTo(-0.15, 0.3); ctx.lineTo(0.15, 0.3); ctx.lineTo(0.15, 0.8); ctx.stroke(); },
  task(ctx) { ctx.beginPath(); ctx.rect(-0.6, -0.75, 1.2, 1.55); ctx.moveTo(-0.3, -0.35); ctx.lineTo(0.35, -0.35); ctx.moveTo(-0.3, 0); ctx.lineTo(0.35, 0); ctx.moveTo(-0.3, 0.35); ctx.lineTo(0.15, 0.35); ctx.stroke(); },
  tent(ctx) { ctx.beginPath(); ctx.moveTo(-0.9, 0.7); ctx.lineTo(0, -0.75); ctx.lineTo(0.9, 0.7); ctx.closePath(); ctx.moveTo(0, -0.75); ctx.lineTo(-0.2, 0.7); ctx.moveTo(0, -0.75); ctx.lineTo(0.2, 0.7); ctx.stroke(); },
  exit(ctx) { ctx.beginPath(); ctx.rect(-0.7, -0.85, 1.0, 1.7); ctx.moveTo(0, 0); ctx.lineTo(0.9, 0); ctx.moveTo(0.6, -0.3); ctx.lineTo(0.9, 0); ctx.lineTo(0.6, 0.3); ctx.stroke(); },
};
export const ICON_NAMES = Object.keys(ICONS);

export function icon(ctx, name, cx, cy, s, c = PH.fg, lw = null, glow = true) {
  const f = ICONS[name] || ICONS.star;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  stroke(ctx, c, (lw ?? 2.2) / s);
  if (glow) { ctx.shadowColor = c; ctx.shadowBlur = 6; }
  f(ctx);
  ctx.restore();
}

// phosphor life on top of the CRT overlay: grain, a soft flicker and burnt-in dark edges
export function phosphorFx(ctx, w, h, t) {
  const fl = 0.03 + 0.03 * Math.sin(t * 47) * Math.sin(t * 13);
  ctx.fillStyle = `rgba(0,0,0,${fl.toFixed(3)})`;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(120,255,160,0.05)';
  for (let i = 0; i < 70; i++) ctx.fillRect((Math.random() * w) | 0, (Math.random() * h) | 0, 2, 1);
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.38, w / 2, h / 2, Math.max(w, h) * 0.7);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,10,3,0.6)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
