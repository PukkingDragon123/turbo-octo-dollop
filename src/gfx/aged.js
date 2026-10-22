// "Aged print" kit for 2D canvas art: paper documents, files, posters, signs, labels, receipts, notes.
// (CRT screens / the watch / terminals stay clean; don't use it there.) Everything is drawn with ordinary canvas
// calls under the current transform, so it works on a standalone canvas and inside an atlas region
// (translated + clipped ctx) alike. Fonts come from the type palette in src/ui/fonts.js (FONT.type, .print...).
//
//   import { agedPaper, paperBase, typeText, printText, handText, stamp, ageCanvas, halftone,
//            drawStockImage, proceduralPhoto, PAPER, INK, AGE } from '../gfx/aged.js';
//
//   const c = agedPaper(512, 724, { paper: 'manila', ruled: false, seed: 3 });   // new canvas with a paper base
//   const ctx = c.getContext('2d');
//   typeText(ctx, 'FROM: FACILITIES\nRE: EXITS', 40, 80, { size: 22, maxWidth: 430, seed: 3 }); // typewriter
//   printText(ctx, 'NOTICE', 256, 60, { size: 48, align: 'center', font: 'print' });          // worn letterpress
//   handText(ctx, 'call Dave', 300, 600, { size: 30, color: INK.blue, font: 'hand' });          // handwriting
//   stamp(ctx, 'APPROVED', 380, 650, { color: INK.red, angle: -0.2, shape: 'box' });           // rubber stamp
//   drawStockImage(ctx, 'office', 40, 120, 220, 160, { sepia: 0.6, halftone: false });          // aged photo
//   ageCanvas(ctx, 512, 724, { ...AGE.file, seed: 3 });  // yellowing, foxing, coffee ring, folds, dog-ear, tape...
//   agedDocument(512, 724, { title, to, from, re, body, stamp: { text, sub } })  // ready-made typed file (canvas)
//   agedPoster(512, 724, { title, subtitle, body, photo: 'group', halftone: true }) // ready-made vintage poster
//
// ageCanvas(ctx, w, h, opts): ages whatever is already drawn in (0,0,w,h) and keeps its alpha (transparent
//   label cut-outs stay transparent). opts (0..1 unless noted): yellow, edges (edge browning), foxing, coffee
//   (ring count), folds ('h' | 'v' | 'cross' | 'none'), creases (count of crumple creases), dogEar (0..1 size,
//   folds the corner given by dogEarCorner 0..3), tape (count), fade (ink wash-out), toner (photocopy noise and
//   streaks), grime (smudges / fingerprints), scratches, tears (edge nicks, punches alpha), seed.
// Presets: AGE.label, AGE.file, AGE.poster, AGE.note, AGE.receipt, AGE.sign, AGE.photocopy.
// Stock photos: bundled CC0 images dropped into src/assets/stock/ (listed in src/assets/stock/CREDITS.md) are
//   picked up automatically and addressable by file name without extension; until then every id falls back to a
//   procedural photo (proceduralPhoto kinds: office, hallway, portrait, group, building, landscape, silhouette).
import { FONT } from '../ui/fonts.js';

export { FONT };

// ---------------------------------------------------------------------------------------------------------------
// palettes and presets
export const PAPER = {
  white: { base: '#efe9da', fibre: '120,100,70', tone: '150,120,70' },
  bond: { base: '#f3eee2', fibre: '110,95,70', tone: '160,130,80' },
  manila: { base: '#dcc58f', fibre: '120,90,40', tone: '150,110,50' },
  kraft: { base: '#b98d5c', fibre: '80,55,30', tone: '100,70,35' },
  newsprint: { base: '#e2dccb', fibre: '90,85,75', tone: '140,125,95' },
  card: { base: '#e9e2cf', fibre: '110,100,80', tone: '140,120,85' },
  receipt: { base: '#f1eee6', fibre: '120,115,100', tone: '170,160,130' },
  blueprint: { base: '#2f4f78', fibre: '200,215,235', tone: '20,35,60' },
};
export const INK = {
  black: '#1d1b1a', type: '#262422', blue: '#1f2d6e', red: '#a3231c', purple: '#4c2a6e', green: '#1f5130', brown: '#5a3a1e', pencil: '#4a4a4c',
};
export const AGE = {
  label: { yellow: 0.35, edges: 0.4, foxing: 0.25, grime: 0.35, scratches: 0.25, fade: 0.1 },
  file: { yellow: 0.5, edges: 0.55, foxing: 0.45, coffee: 1, folds: 'h', creases: 1, dogEar: 0.6, grime: 0.3, fade: 0.15 },
  poster: { yellow: 0.45, edges: 0.6, foxing: 0.35, folds: 'cross', creases: 2, tape: 2, grime: 0.35, fade: 0.25, scratches: 0.2 },
  note: { yellow: 0.3, edges: 0.3, foxing: 0.2, creases: 1, grime: 0.25 },
  receipt: { yellow: 0.3, edges: 0.25, foxing: 0.15, creases: 3, fade: 0.35, grime: 0.2 },
  sign: { yellow: 0.3, edges: 0.45, grime: 0.55, scratches: 0.5, fade: 0.3 },
  photocopy: { yellow: 0.15, edges: 0.2, toner: 0.8, fade: 0.05, grime: 0.15 },
};

// ---------------------------------------------------------------------------------------------------------------
// helpers
function rng(seed = 1) {
  let s = (Math.floor(seed * 9973) ^ 0x5bd1e995) >>> 0 || 1;
  const f = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  f.range = (a, b) => a + (b - a) * f();
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  return f;
}
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}
const fam = (f) => FONT[f] || f || FONT.type;
const rgba = (rgb, a) => `rgba(${rgb},${a})`;
function hexRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

// shared tileable grain (multiply pattern): soft paper noise
let _grain = null;
function grainCanvas() {
  if (_grain) return _grain;
  const c = canvas(128, 128), x = c.getContext('2d'), img = x.createImageData(128, 128), r = rng(7);
  for (let i = 0; i < 128 * 128; i++) {
    const v = 236 + Math.floor((r() + r() + r() - 1.5) * 26);
    img.data[i * 4] = v; img.data[i * 4 + 1] = v - 2; img.data[i * 4 + 2] = v - 6; img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return (_grain = c);
}
function blob(ctx, x, y, r, rgb, a, rr) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(rgb, a)); g.addColorStop(0.6, rgba(rgb, a * 0.5)); g.addColorStop(1, rgba(rgb, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  // irregular outline
  const n = 9;
  for (let k = 0; k <= n; k++) {
    const t = (k / n) * Math.PI * 2, q = r * (0.75 + rr() * 0.35);
    if (k === 0) ctx.moveTo(x + Math.cos(t) * q, y + Math.sin(t) * q); else ctx.lineTo(x + Math.cos(t) * q, y + Math.sin(t) * q);
  }
  ctx.fill();
}

// ---------------------------------------------------------------------------------------------------------------
// paper
// paperBase(ctx, w, h, { paper: 'white' | PAPER key | {base,fibre,tone}, ruled, margin, holes, grid, seed })
export function paperBase(ctx, w, h, o = {}) {
  const P = typeof o.paper === 'object' ? o.paper : PAPER[o.paper || 'white'];
  const r = rng(o.seed ?? 1);
  ctx.save();
  ctx.fillStyle = P.base; ctx.fillRect(0, 0, w, h);
  // uneven tone: big soft blotches
  for (let k = 0; k < 7; k++) blob(ctx, r() * w, r() * h, (0.25 + r() * 0.4) * Math.max(w, h), P.tone, 0.05, r);
  // grain
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = ctx.createPattern(grainCanvas(), 'repeat');
  ctx.globalAlpha = 0.55; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  // fibres
  const nf = Math.floor((w * h) / 900);
  ctx.lineWidth = 0.6;
  for (let k = 0; k < nf; k++) {
    const x = r() * w, y = r() * h, a = r() * Math.PI, l = 2 + r() * 7;
    ctx.strokeStyle = rgba(P.fibre, 0.05 + r() * 0.08);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + r() * 2, y + Math.sin(a) * l * 0.5 + r() * 2, x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
  const s = Math.min(w, h) / 512;
  if (o.ruled) {
    const step = (o.ruled === true ? 28 : o.ruled) * s;
    ctx.strokeStyle = 'rgba(70,110,170,0.35)'; ctx.lineWidth = Math.max(1, s);
    for (let y = step * 2.5; y < h - step * 0.5; y += step) { ctx.beginPath(); ctx.moveTo(0, y + (r() - 0.5) * 0.6); ctx.lineTo(w, y + (r() - 0.5) * 0.6); ctx.stroke(); }
  }
  if (o.grid) {
    const step = (o.grid === true ? 20 : o.grid) * s;
    ctx.strokeStyle = 'rgba(80,130,120,0.22)'; ctx.lineWidth = Math.max(0.6, s * 0.8);
    for (let x = step; x < w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = step; y < h; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  }
  if (o.margin) { ctx.strokeStyle = 'rgba(190,60,60,0.45)'; ctx.lineWidth = Math.max(1, 1.5 * s); ctx.beginPath(); ctx.moveTo(70 * s, 0); ctx.lineTo(70 * s, h); ctx.stroke(); }
  if (o.holes) {
    for (const fy of [0.18, 0.5, 0.82]) {
      const g = ctx.createRadialGradient(24 * s, h * fy, 0, 24 * s, h * fy, 11 * s);
      g.addColorStop(0, 'rgba(25,22,20,0.95)'); g.addColorStop(0.75, 'rgba(25,22,20,0.9)'); g.addColorStop(1, 'rgba(25,22,20,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(24 * s, h * fy, 11 * s, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

export function agedPaper(w, h, o = {}) {
  const c = canvas(w, h);
  paperBase(c.getContext('2d'), w, h, o);
  return c;
}

// ---------------------------------------------------------------------------------------------------------------
// text
function wrap(ctx, text, maxWidth) {
  const out = [];
  for (const para of String(text).split('\n')) {
    if (!maxWidth) { out.push(para); continue; }
    let line = '';
    for (const word of para.split(' ')) {
      const t = line ? line + ' ' + word : word;
      if (line && ctx.measureText(t).width > maxWidth) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}

// typewriter: per-glyph baseline / rotation jitter, uneven key pressure, ribbon fading along the line,
// filled-in counters, occasional double strike and a soft ink bleed. Returns the y after the last line.
// o: size, color, font (FONT role, default 'type'), lineHeight, maxWidth, align ('left'|'center'|'right'),
//    pressure (0..1 variation), jitter (px), bleed (px), seed
export function typeText(ctx, text, x, y, o = {}) {
  const size = o.size || 20, r = rng(o.seed ?? 3), lh = o.lineHeight || size * 1.25;
  const col = o.color || INK.type, rgb = hexRgb(col);
  ctx.save();
  ctx.font = `${o.weight || 'normal'} ${size}px ${fam(o.font || 'type')}`;
  ctx.textBaseline = 'alphabetic';
  const lines = wrap(ctx, text, o.maxWidth);
  const jit = o.jitter ?? size * 0.05, pr = o.pressure ?? 0.45;
  ctx.shadowColor = rgba(rgb, 0.5); ctx.shadowBlur = o.bleed ?? Math.max(0.5, size * 0.03);
  let cy = y;
  for (const line of lines) {
    const lw = ctx.measureText(line).width;
    let cx = o.align === 'center' ? x - lw / 2 : o.align === 'right' ? x - lw : x;
    const lineFade = 0.85 + r() * 0.15;
    for (const ch of line) {
      const adv = ctx.measureText(ch).width;
      if (ch !== ' ') {
        const a = Math.max(0.25, (1 - pr * r()) * lineFade);
        ctx.save();
        ctx.translate(cx + (r() - 0.5) * jit, cy + (r() - 0.5) * jit * 1.4);
        ctx.rotate((r() - 0.5) * 0.04);
        ctx.fillStyle = rgba(rgb, a);
        ctx.fillText(ch, 0, 0);
        if (r() < 0.12) { ctx.globalAlpha = 0.45; ctx.fillText(ch, 0.6 + r() * 0.6, 0.3); }
        if (/[eoa]/.test(ch) && r() < 0.18) { ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(adv * 0.5, -size * 0.22, size * 0.09, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }
      cx += adv;
    }
    cy += lh;
  }
  ctx.restore();
  return cy;
}

// worn letterpress / offset print: slight ink spread, broken type (speckle knocked out of the glyphs),
// misregistered second impression. o: size, color, font ('print'), weight, align, maxWidth, lineHeight, wear, seed
export function printText(ctx, text, x, y, o = {}) {
  const size = o.size || 32, r = rng(o.seed ?? 5), lh = o.lineHeight || size * 1.15;
  const col = o.color || INK.black;
  ctx.save();
  ctx.font = `${o.weight || 'normal'} ${size}px ${fam(o.font || 'print')}`;
  const lines = wrap(ctx, text, o.maxWidth);
  let maxW = 0;
  for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l).width);
  const pad = Math.ceil(size * 0.6), W = Math.ceil(maxW + pad * 2), H = Math.ceil(lh * lines.length + pad * 2);
  const off = canvas(W, H), ox = off.getContext('2d');
  ox.font = ctx.font; ox.textBaseline = 'alphabetic'; ox.fillStyle = col;
  ox.shadowColor = col; ox.shadowBlur = Math.max(0.4, size * 0.02);
  lines.forEach((l, i) => {
    const lw = ox.measureText(l).width;
    const lx = o.align === 'center' ? (W - lw) / 2 : o.align === 'right' ? W - pad - lw : pad;
    ox.fillText(l, lx, pad + size * 0.85 + i * lh);
  });
  // broken type: knock speckles and a few scuffs out of the ink
  const wear = o.wear ?? 0.5;
  ox.globalCompositeOperation = 'destination-out';
  ox.shadowBlur = 0;
  for (let k = 0, n = Math.floor(W * H * 0.004 * wear); k < n; k++) { ox.globalAlpha = 0.3 + r() * 0.7; ox.fillRect(r() * W, r() * H, 0.6 + r() * 1.6, 0.6 + r() * 1.6); }
  ox.globalAlpha = 0.5 * wear; ox.lineWidth = 0.8;
  for (let k = 0; k < 3; k++) { ox.beginPath(); ox.moveTo(r() * W, r() * H); ox.lineTo(r() * W, r() * H); ox.stroke(); }
  ctx.globalAlpha = o.alpha ?? 0.94;
  const bx = o.align === 'center' ? x - W / 2 : o.align === 'right' ? x - W + pad : x - pad;
  const by = y - pad - size * 0.85;
  if (o.misregister !== false) { ctx.globalAlpha *= 0.22; ctx.drawImage(off, bx + size * 0.03, by + size * 0.02); ctx.globalAlpha = o.alpha ?? 0.94; }
  ctx.drawImage(off, bx, by);
  ctx.restore();
  return y + lh * lines.length;
}

// handwriting with a real pen: per-word baseline drift and slant, pressure variation.
// o: size, color, font ('hand' | 'messy' | 'marker' | 'scrawl'), maxWidth, lineHeight, align, seed
export function handText(ctx, text, x, y, o = {}) {
  const size = o.size || 26, r = rng(o.seed ?? 9), lh = o.lineHeight || size * 1.2;
  const rgb = hexRgb(o.color || INK.blue);
  ctx.save();
  ctx.font = `${o.weight || 'normal'} ${size}px ${fam(o.font || 'hand')}`;
  const lines = wrap(ctx, text, o.maxWidth);
  let cy = y;
  for (const line of lines) {
    const lw = ctx.measureText(line).width;
    let cx = o.align === 'center' ? x - lw / 2 : o.align === 'right' ? x - lw : x;
    let drift = 0;
    const tilt = (r() - 0.5) * 0.05;
    for (const word of line.split(' ')) {
      drift += (r() - 0.5) * size * 0.08;
      ctx.save();
      ctx.translate(cx, cy + drift);
      ctx.rotate(tilt + (r() - 0.5) * 0.04);
      ctx.fillStyle = rgba(rgb, 0.78 + r() * 0.2);
      ctx.fillText(word, 0, 0);
      ctx.restore();
      cx += ctx.measureText(word + ' ').width;
    }
    cy += lh;
  }
  ctx.restore();
  return cy;
}

// rubber stamp: uneven inking (patchy fill, heavier rim), slightly rotated, multiplied into the paper.
// o: color, angle, size (font px), shape ('box' | 'circle' | 'none'), font ('print' | 'title' | ...), sub (small
//    second line, e.g. a date), alpha, seed
export function stamp(ctx, text, x, y, o = {}) {
  const size = o.size || 28, r = rng(o.seed ?? 11), col = o.color || INK.red;
  const f = `${o.weight || 'bold'} ${size}px ${fam(o.font || 'print')}`;
  const m = canvas(4, 4).getContext('2d'); m.font = f;
  const tw = m.measureText(text).width;
  const sub = o.sub ? String(o.sub) : '';
  const subPx = size * 0.42;
  const W = Math.ceil(tw + size * 1.4), H = Math.ceil(size * (sub ? 2.0 : 1.6));
  const D = o.shape === 'circle' ? Math.ceil(Math.max(W, H) * 1.05) : 0;
  const cw = D || W, ch = D || H;
  const off = canvas(cw + 8, ch + 8), ox = off.getContext('2d');
  ox.translate(4, 4);
  ox.strokeStyle = ox.fillStyle = col; ox.textAlign = 'center'; ox.textBaseline = 'middle';
  ox.font = f;
  if (o.shape === 'circle') {
    ox.lineWidth = size * 0.12; ox.beginPath(); ox.arc(cw / 2, ch / 2, cw / 2 - size * 0.1, 0, Math.PI * 2); ox.stroke();
    ox.lineWidth = size * 0.05; ox.beginPath(); ox.arc(cw / 2, ch / 2, cw / 2 - size * 0.32, 0, Math.PI * 2); ox.stroke();
  } else if (o.shape !== 'none') {
    ox.lineWidth = size * 0.12; ox.strokeRect(size * 0.08, size * 0.08, cw - size * 0.16, ch - size * 0.16);
    ox.lineWidth = size * 0.04; ox.strokeRect(size * 0.26, size * 0.26, cw - size * 0.52, ch - size * 0.52);
  }
  ox.fillText(text, cw / 2, sub ? ch * 0.42 : ch / 2);
  if (sub) { ox.font = `bold ${subPx}px ${fam(o.subFont || 'type')}`; ox.fillText(sub, cw / 2, ch * 0.74); }
  // patchy ink: knock out speckle and a few large pale areas
  ox.globalCompositeOperation = 'destination-out';
  for (let k = 0, n = Math.floor(cw * ch * 0.012); k < n; k++) { ox.globalAlpha = 0.2 + r() * 0.8; ox.fillRect(r() * cw, r() * ch, 0.7 + r() * 2.2, 0.7 + r() * 2.2); }
  for (let k = 0; k < 4; k++) blob(ox, r() * cw, r() * ch, (0.15 + r() * 0.25) * Math.max(cw, ch), '0,0,0', 0.55, r);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(o.angle ?? (r() - 0.5) * 0.3);
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = o.alpha ?? 0.88;
  ctx.drawImage(off, -cw / 2 - 4, -ch / 2 - 4);
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------------------
// ageing
// ageCanvas(ctx, w, h, opts): see the header. Works on (0,0,w,h) in the current transform (translation / scale).
export function ageCanvas(target, w, h, o = {}) {
  const ctx = target.getContext ? target.getContext('2d') : target;
  if (!w || !h) { w = ctx.canvas.width; h = ctx.canvas.height; }
  const r = rng(o.seed ?? 13);
  const m = ctx.getTransform ? ctx.getTransform() : { a: 1, d: 1, e: 0, f: 0 };
  const sx = m.e, sy = m.f, sw = w * m.a, sh = h * m.d;
  // work on a copy of the region; its alpha is restored at the end
  const W = Math.max(1, Math.round(sw)), H = Math.max(1, Math.round(sh));
  const src = canvas(W, H), sx2 = src.getContext('2d');
  sx2.drawImage(ctx.canvas, sx, sy, sw, sh, 0, 0, W, H);
  const out = canvas(W, H), x = out.getContext('2d');
  x.drawImage(src, 0, 0);
  const S = Math.min(W, H) / 512;
  const tone = o.toneRgb || '150,112,52';
  // ink fade: wash the darks toward the paper
  if (o.fade) { x.globalCompositeOperation = 'screen'; x.fillStyle = `rgba(120,108,88,${o.fade * 0.45})`; x.fillRect(0, 0, W, H); }
  x.globalCompositeOperation = 'multiply';
  // overall yellowing + browned edges
  if (o.yellow) { x.fillStyle = `rgba(232,208,150,${o.yellow * 0.55})`; x.fillRect(0, 0, W, H); }
  if (o.edges) {
    const g = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.56);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.75, `rgba(${tone},${o.edges * 0.25})`); g.addColorStop(1, `rgba(110,75,35,${o.edges * 0.7})`);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // thin dark rim
    x.strokeStyle = `rgba(90,60,30,${o.edges * 0.35})`; x.lineWidth = Math.max(1, 3 * S); x.strokeRect(0, 0, W, H);
  }
  // large damp tide stains
  if (o.yellow) for (let k = 0; k < 2; k++) blob(x, r() * W, r() * H, (0.15 + r() * 0.3) * Math.max(W, H), tone, o.yellow * 0.14, r);
  // foxing: clusters of rust-brown spots
  if (o.foxing) {
    const n = Math.floor(o.foxing * 40 * Math.max(1, (W * H) / 262144));
    for (let k = 0; k < n; k++) {
      const cx = r() * W, cy = r() * H;
      for (let j = 0, m2 = 1 + Math.floor(r() * 4); j < m2; j++) blob(x, cx + (r() - 0.5) * 20 * S, cy + (r() - 0.5) * 20 * S, (1.5 + r() * 6) * Math.max(0.5, S), '140,90,40', 0.2 + r() * 0.35, r);
    }
  }
  // coffee rings
  for (let k = 0; k < (o.coffee | 0); k++) {
    const cx = W * (0.2 + r() * 0.6), cy = H * (0.25 + r() * 0.6), rad = (38 + r() * 30) * Math.max(0.4, S);
    x.fillStyle = 'rgba(150,100,45,0.08)'; x.beginPath(); x.arc(cx, cy, rad, 0, Math.PI * 2); x.fill();
    const a0 = r() * Math.PI * 2, span = Math.PI * (1.3 + r() * 0.7);
    for (let j = 0; j < 3; j++) {
      x.strokeStyle = `rgba(110,65,25,${0.25 + r() * 0.25})`; x.lineWidth = (1 + r() * 3) * Math.max(0.5, S);
      x.beginPath(); x.arc(cx + (r() - 0.5) * 2, cy + (r() - 0.5) * 2, rad * (0.97 + r() * 0.05), a0, a0 + span); x.stroke();
    }
  }
  // grime: smudges and thumb prints
  if (o.grime) {
    for (let k = 0, n = Math.ceil(o.grime * 6); k < n; k++) blob(x, r() * W, r() * H, (10 + r() * 40) * Math.max(0.5, S), '70,60,50', o.grime * 0.12, r);
    for (let k = 0, n = Math.ceil(o.grime * 3); k < n; k++) {
      const cx = r() < 0.5 ? r() * W * 0.2 : W - r() * W * 0.2, cy = r() * H, rad = (9 + r() * 5) * Math.max(0.5, S);
      x.save(); x.translate(cx, cy); x.rotate(r() * Math.PI); x.scale(1, 1.35);
      for (let q = rad; q > 1; q -= 1.6 * Math.max(0.5, S)) { x.strokeStyle = `rgba(60,50,40,${o.grime * 0.12})`; x.lineWidth = 0.8 * Math.max(0.5, S); x.beginPath(); x.arc(0, 0, q, 0, Math.PI * 2); x.stroke(); }
      x.restore();
    }
  }
  // folds and crumple creases: a dark valley line with a lit ridge beside it
  const fold = (x0, y0, x1, y1, k) => {
    const nx = -(y1 - y0), ny = x1 - x0, l = Math.hypot(nx, ny) || 1, ux = nx / l, uy = ny / l, wdt = 5 * Math.max(0.5, S);
    const g = x.createLinearGradient(x0 - ux * wdt, y0 - uy * wdt, x0 + ux * wdt, y0 + uy * wdt);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.45, `rgba(60,45,30,${0.28 * k})`); g.addColorStop(0.55, `rgba(60,45,30,${0.1 * k})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.strokeStyle = g; x.lineWidth = wdt * 2; x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
    x.save(); x.globalCompositeOperation = 'screen'; x.strokeStyle = `rgba(255,250,235,${0.22 * k})`; x.lineWidth = 1.5 * Math.max(0.5, S);
    x.beginPath(); x.moveTo(x0 + ux * 2.5 * S, y0 + uy * 2.5 * S); x.lineTo(x1 + ux * 2.5 * S, y1 + uy * 2.5 * S); x.stroke(); x.restore();
  };
  const f = o.folds || 'none';
  if (f === 'h' || f === 'cross') fold(0, H * (0.48 + (r() - 0.5) * 0.04), W, H * (0.5 + (r() - 0.5) * 0.04), 1);
  if (f === 'v' || f === 'cross') fold(W * (0.49 + (r() - 0.5) * 0.04), 0, W * (0.5 + (r() - 0.5) * 0.04), H, 1);
  for (let k = 0; k < (o.creases | 0); k++) {
    let px = r() * W, py = r() * H; const a = r() * Math.PI; const seg = 4 + Math.floor(r() * 4), len = (0.15 + r() * 0.3) * Math.max(W, H) / seg;
    for (let j = 0; j < seg; j++) { const b = a + (r() - 0.5) * 0.7; const nx = px + Math.cos(b) * len, ny = py + Math.sin(b) * len; fold(px, py, nx, ny, 0.55); px = nx; py = ny; }
  }
  // scratches / scuffs (signs, labels)
  if (o.scratches) {
    x.globalCompositeOperation = 'screen';
    for (let k = 0, n = Math.ceil(o.scratches * 25); k < n; k++) {
      x.strokeStyle = `rgba(255,248,230,${0.12 + r() * 0.2})`; x.lineWidth = (0.5 + r()) * Math.max(0.5, S);
      const x0 = r() * W, y0 = r() * H, a = r() * Math.PI, l = (8 + r() * 60) * Math.max(0.5, S);
      x.beginPath(); x.moveTo(x0, y0); x.lineTo(x0 + Math.cos(a) * l, y0 + Math.sin(a) * l); x.stroke();
    }
    x.globalCompositeOperation = 'multiply';
  }
  // photocopy toner: speckle, edge streaks, a grey band
  if (o.toner) {
    for (let k = 0, n = Math.floor(W * H * 0.0012 * o.toner); k < n; k++) { x.fillStyle = `rgba(30,30,30,${0.2 + r() * 0.5})`; x.fillRect(r() * W, r() * H, 0.8 + r() * 1.5, 0.8 + r() * 1.5); }
    for (let k = 0; k < 3; k++) { const sx3 = r() * W; x.fillStyle = `rgba(40,40,40,${0.05 + r() * 0.08 * o.toner})`; x.fillRect(sx3, 0, (1 + r() * 3) * S, H); }
    const gy = r() * H; const g = x.createLinearGradient(0, gy - 30 * S, 0, gy + 30 * S);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, `rgba(60,60,60,${0.12 * o.toner})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, gy - 30 * S, W, 60 * S);
  }
  // paper grain on top (ink sits in the fibres too)
  x.globalAlpha = 0.35; x.fillStyle = x.createPattern(grainCanvas(), 'repeat'); x.fillRect(0, 0, W, H); x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  // tape: translucent yellowed strips with jagged torn ends
  for (let k = 0; k < (o.tape | 0); k++) {
    const corner = k % 4, tx = corner % 2 ? W - 20 * S : 20 * S, ty = corner < 2 ? 18 * S : H - 18 * S;
    x.save(); x.translate(tx, ty); x.rotate((corner % 3 ? -1 : 1) * (0.6 + r() * 0.3));
    const tw = 90 * Math.max(0.5, S), th = 26 * Math.max(0.5, S);
    x.beginPath(); x.moveTo(-tw / 2, -th / 2);
    for (let j = 0; j <= 6; j++) x.lineTo(-tw / 2 + (r() - 0.5) * 3 * S, -th / 2 + (j / 6) * th);
    for (let j = 0; j <= 6; j++) x.lineTo(tw / 2 + (r() - 0.5) * 3 * S, th / 2 - (j / 6) * th);
    x.closePath();
    x.fillStyle = 'rgba(232,214,160,0.42)'; x.fill();
    x.strokeStyle = 'rgba(150,120,60,0.25)'; x.lineWidth = 1; x.stroke();
    x.restore();
  }
  // dog-eared corner: the flap folds over (paper back + shadow), the corner itself is gone
  let cutCorner = null;
  if (o.dogEar) {
    const c = o.dogEarCorner ?? Math.floor(r() * 4), d = (30 + r() * 30) * o.dogEar * Math.max(0.5, S);
    const cx = c % 2 ? W : 0, cy = c < 2 ? 0 : H, dx = c % 2 ? -1 : 1, dy = c < 2 ? 1 : -1;
    cutCorner = [cx, cy, dx, dy, d];
    x.save();
    x.fillStyle = 'rgba(40,30,20,0.25)';
    x.beginPath(); x.moveTo(cx + dx * d, cy); x.lineTo(cx + dx * d * 1.08, cy + dy * d * 1.08); x.lineTo(cx, cy + dy * d); x.closePath(); x.fill();
    const g = x.createLinearGradient(cx + dx * d, cy + dy * d, cx + dx * d * 0.5, cy + dy * d * 0.5);
    g.addColorStop(0, '#cbb68c'); g.addColorStop(1, '#e6d8b4');
    x.fillStyle = g;
    x.beginPath(); x.moveTo(cx + dx * d, cy); x.lineTo(cx + dx * d, cy + dy * d); x.lineTo(cx, cy + dy * d); x.closePath(); x.fill();
    x.strokeStyle = 'rgba(90,70,40,0.4)'; x.lineWidth = 1; x.stroke();
    x.restore();
  }
  // restore the original alpha (and punch the dog-ear corner / edge tears)
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'destination-out';
  if (cutCorner) { const [cx, cy, dx, dy, d] = cutCorner; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + dx * d, cy); x.lineTo(cx, cy + dy * d); x.closePath(); x.fill(); }
  if (o.tears) {
    for (let k = 0, n = Math.ceil(o.tears * 8); k < n; k++) {
      const side = Math.floor(r() * 4), t = r(), d = (3 + r() * 9) * Math.max(0.5, S), wd = (4 + r() * 10) * Math.max(0.5, S);
      const px = side === 0 ? t * W : side === 1 ? W : side === 2 ? t * W : 0, py = side === 0 ? 0 : side === 1 ? t * H : side === 2 ? H : t * H;
      const ix = side === 1 ? -d : side === 3 ? d : 0, iy = side === 0 ? d : side === 2 ? -d : 0;
      x.beginPath(); x.moveTo(px - (iy ? wd : 0), py - (ix ? wd : 0)); x.lineTo(px + ix + (r() - 0.5) * 3, py + iy + (r() - 0.5) * 3); x.lineTo(px + (iy ? wd : 0), py + (ix ? wd : 0)); x.closePath(); x.fill();
    }
  }
  x.globalCompositeOperation = 'source-over';
  // write back (respects the caller's clip)
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(out, 0, 0, w, h);
  ctx.restore();
  return ctx;
}

// ---------------------------------------------------------------------------------------------------------------
// images
// halftone(ctx, src, x, y, w, h, { cell (px), angle, color ('mono' | 'cmyk'), ink, paper, misregister })
export function halftone(ctx, src, x, y, w, h, o = {}) {
  const cell = o.cell || Math.max(3, Math.round(Math.min(w, h) / 70));
  const ang = o.angle ?? 0.785;
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
  const sm = canvas(gw, gh), sx = sm.getContext('2d');
  sx.drawImage(src, 0, 0, gw, gh);
  const d = sx.getImageData(0, 0, gw, gh).data;
  const at = (u, v) => { const i = (Math.min(gh - 1, Math.max(0, v | 0)) * gw + Math.min(gw - 1, Math.max(0, u | 0))) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  if (o.paper !== false) { ctx.fillStyle = o.paper || '#ece5d2'; ctx.fillRect(x, y, w, h); }
  const plates = o.color === 'cmyk'
    ? [['0,160,200', (c) => 1 - c[0] / 255, 0.26, [0.6, 0.2]], ['200,0,120', (c) => 1 - c[1] / 255, 1.31, [-0.3, 0.5]], ['230,200,0', (c) => 1 - c[2] / 255, 0, [0, 0]], ['25,22,20', (c) => 1 - Math.max(c[0], c[1], c[2]) / 255, ang, [0, 0]]]
    : [[hexRgb(o.ink || INK.black), (c) => 1 - (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255, ang, [0, 0]]];
  ctx.globalCompositeOperation = 'multiply';
  for (const [rgb, val, a, mis] of plates) {
    const ca = Math.cos(a), sa = Math.sin(a), R = Math.hypot(w, h);
    ctx.fillStyle = `rgba(${rgb},0.92)`;
    for (let v = -R; v < R; v += cell) {
      for (let u = -R; u < R; u += cell) {
        const px = x + w / 2 + u * ca - v * sa + (o.misregister ?? 1) * mis[0] * cell * 0.3, py = y + h / 2 + u * sa + v * ca + (o.misregister ?? 1) * mis[1] * cell * 0.3;
        if (px < x - cell || py < y - cell || px > x + w + cell || py > y + h + cell) continue;
        const k = val(at((px - x) / cell + 1, (py - y) / cell + 1));
        if (k < 0.03) continue;
        ctx.beginPath(); ctx.arc(px, py, cell * 0.72 * Math.sqrt(k), 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  ctx.restore();
}

// Stock photo registry: CC0 images dropped into src/assets/stock/ (see CREDITS.md there) are bundled by Vite
// and addressable by file name (without extension). Nothing is downloaded at runtime.
const STOCK_URLS = (() => {
  try {
    const files = import.meta.glob('../assets/stock/*.{jpg,jpeg,png,webp}', { eager: true, query: '?url', import: 'default' });
    const out = {};
    for (const [p, url] of Object.entries(files)) out[p.split('/').pop().replace(/\.[^.]+$/, '')] = url;
    return out;
  } catch (e) { return {}; }
})();
const stockImgs = new Map();
export function stockIds() { return Object.keys(STOCK_URLS); }
// Preload a bundled stock image (resolves to null when the id has no file: callers fall back to procedural)
export function loadStock(id) {
  if (!STOCK_URLS[id]) return Promise.resolve(null);
  if (stockImgs.has(id)) return stockImgs.get(id);
  const p = new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = STOCK_URLS[id]; });
  stockImgs.set(id, p);
  p.then((im) => { if (im) stockImgs.set(id, Promise.resolve(im)); stockImgs.get(id).img = im; });
  return p;
}

// Procedural "photo": soft, grainy, low-contrast scenes rendered small and upscaled (photographic blur).
// kinds: office, hallway, portrait, group, building, landscape, silhouette
export function proceduralPhoto(kind = 'office', w = 256, h = 192, seed = 1) {
  const r = rng(seed), lw = Math.max(16, Math.round(w / 3)), lh = Math.max(12, Math.round(h / 3));
  const lo = canvas(lw, lh), c = lo.getContext('2d');
  const sky = (a, b) => { const g = c.createLinearGradient(0, 0, 0, lh); g.addColorStop(0, a); g.addColorStop(1, b); c.fillStyle = g; c.fillRect(0, 0, lw, lh); };
  const person = (px, py, s, col) => {
    c.fillStyle = col;
    c.beginPath(); c.ellipse(px, py - s * 1.55, s * 0.32, s * 0.4, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(px - s * 0.75, py + s * 0.4); c.quadraticCurveTo(px - s * 0.7, py - s * 1.05, px, py - s * 1.1); c.quadraticCurveTo(px + s * 0.7, py - s * 1.05, px + s * 0.75, py + s * 0.4); c.closePath(); c.fill();
  };
  if (kind === 'hallway' || kind === 'office') {
    sky('#d8cfa6', '#8a7a50');
    const vx = lw * (0.45 + r() * 0.1), vy = lh * 0.45;
    c.fillStyle = 'rgba(70,60,40,0.55)'; c.beginPath(); c.moveTo(0, lh); c.lineTo(vx - lw * 0.05, vy + lh * 0.05); c.lineTo(vx + lw * 0.05, vy + lh * 0.05); c.lineTo(lw, lh); c.fill();
    c.fillStyle = 'rgba(250,245,220,0.5)'; c.beginPath(); c.moveTo(0, 0); c.lineTo(vx - lw * 0.05, vy - lh * 0.05); c.lineTo(vx + lw * 0.05, vy - lh * 0.05); c.lineTo(lw, 0); c.fill();
    for (let k = 1; k < 6; k++) { const t = 1 - k / 6; c.fillStyle = 'rgba(255,255,235,0.8)'; c.fillRect(vx - lw * 0.12 * t, vy - lh * 0.5 * t, lw * 0.24 * t, lh * 0.04 * t + 0.5); }
    if (kind === 'office') {
      for (let k = 0; k < 4; k++) { const t = 0.4 + r() * 0.6, sx = r() < 0.5 ? vx - lw * 0.45 * t : vx + lw * 0.2 * t; c.fillStyle = 'rgba(50,42,30,0.7)'; c.fillRect(sx, vy + lh * 0.18 * t, lw * 0.25 * t, lh * 0.12 * t); }
      person(lw * (0.3 + r() * 0.4), lh * 0.92, lh * 0.32, 'rgba(35,30,25,0.85)');
    }
  } else if (kind === 'portrait') {
    sky('#bdb6a4', '#6e6658');
    const g = c.createRadialGradient(lw * 0.4, lh * 0.3, 1, lw * 0.5, lh * 0.5, lw * 0.7); g.addColorStop(0, 'rgba(255,250,235,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, lw, lh);
    person(lw * 0.5, lh * 1.05, lh * 0.5, '#2e2a26');
    c.fillStyle = '#c9b49a'; c.beginPath(); c.ellipse(lw * 0.5, lh * 1.05 - lh * 0.5 * 1.55, lh * 0.5 * 0.3, lh * 0.5 * 0.38, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(40,30,22,0.9)'; c.beginPath(); c.ellipse(lw * 0.5, lh * 1.05 - lh * 0.5 * 1.8, lh * 0.5 * 0.32, lh * 0.5 * 0.18, 0, Math.PI, Math.PI * 2); c.fill();
    c.fillStyle = '#e8e2d2'; c.beginPath(); c.moveTo(lw * 0.45, lh * 0.72); c.lineTo(lw * 0.5, lh * 0.95); c.lineTo(lw * 0.55, lh * 0.72); c.fill();
    c.fillStyle = '#5a1e1e'; c.fillRect(lw * 0.49, lh * 0.74, lw * 0.02, lh * 0.2);
  } else if (kind === 'group') {
    sky('#cfc7b0', '#7d7562');
    const n = 4 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) person(lw * (k + 0.5) / n + (r() - 0.5) * 4, lh * (0.95 + (k % 2) * 0.05), lh * (0.26 + r() * 0.05), `rgba(${30 + r() * 30},${28 + r() * 20},${25 + r() * 15},0.92)`);
  } else if (kind === 'building') {
    sky('#d9d4c4', '#a8a08a');
    const bx = lw * 0.2, bw = lw * 0.6, by = lh * 0.12;
    c.fillStyle = '#5c5850'; c.fillRect(bx, by, bw, lh - by);
    c.fillStyle = 'rgba(220,215,190,0.75)';
    for (let yy = by + 3; yy < lh - 4; yy += 4) for (let xx = bx + 2; xx < bx + bw - 3; xx += 4) if (r() < 0.8) c.fillRect(xx, yy, 2, 2);
    c.fillStyle = '#3a3630'; c.fillRect(0, lh * 0.88, lw, lh * 0.12);
  } else if (kind === 'landscape') {
    sky('#e3dcc6', '#b6ad92');
    for (let k = 0; k < 3; k++) { c.fillStyle = `rgba(${90 - k * 25},${85 - k * 20},${60 - k * 15},0.85)`; c.beginPath(); c.moveTo(0, lh); for (let xx = 0; xx <= lw; xx += 2) c.lineTo(xx, lh * (0.55 + k * 0.12) + Math.sin(xx * 0.15 + k * 2 + r()) * lh * 0.05); c.lineTo(lw, lh); c.fill(); }
  } else {
    sky('#e6dfcc', '#9a917c');
    person(lw * 0.5, lh * 1.0, lh * 0.45, '#191715');
  }
  // upscale (soft focus) + film grain
  const out = canvas(w, h), o = out.getContext('2d');
  o.imageSmoothingEnabled = true; o.imageSmoothingQuality = 'high';
  o.drawImage(lo, 0, 0, w, h);
  o.globalCompositeOperation = 'overlay';
  o.globalAlpha = 0.5; o.fillStyle = o.createPattern(grainCanvas(), 'repeat'); o.fillRect(0, 0, w, h);
  return out;
}

// drawStockImage(ctx, img, x, y, w, h, opts): an aged photograph / printed picture. img: a stock id (bundled file
// or procedural kind), an Image / canvas, or null (procedural 'office'). opts: sepia (0..1), fade, contrast,
// vignette, scratches, dust, halftone (true | 'cmyk'), border (white photo border px), angle, seed, kind (fallback)
export function drawStockImage(ctx, img, x, y, w, h, o = {}) {
  const r = rng(o.seed ?? 17);
  let src = img;
  if (typeof img === 'string' || !img) {
    const id = img || o.kind || 'office';
    const p = stockImgs.get(id);
    src = (p && p.img) || proceduralPhoto(STOCK_URLS[id] ? (o.kind || 'office') : id, Math.round(w), Math.round(h), o.seed ?? 17);
    if (STOCK_URLS[id] && !(p && p.img)) loadStock(id);
  }
  const W = Math.max(8, Math.round(w)), H = Math.max(8, Math.round(h));
  const c = canvas(W, H), x2 = c.getContext('2d');
  // cover-fit
  const iw = src.naturalWidth || src.width, ih = src.naturalHeight || src.height, sc = Math.max(W / iw, H / ih);
  x2.drawImage(src, (W - iw * sc) / 2, (H - ih * sc) / 2, iw * sc, ih * sc);
  // tone: sepia / fade / contrast (per pixel, small canvas)
  const id = x2.getImageData(0, 0, W, H), d = id.data;
  const sep = o.sepia ?? 0.6, fade = o.fade ?? 0.3, con = o.contrast ?? 0.9;
  for (let i = 0; i < d.length; i += 4) {
    let R = d[i], G = d[i + 1], B = d[i + 2];
    const l = R * 0.3 + G * 0.59 + B * 0.11;
    R += (Math.min(255, l * 1.07 + 18) - R) * sep; G += (Math.min(255, l * 0.95 + 8) - G) * sep; B += (l * 0.74 - B) * sep;
    R = (R - 128) * con + 128; G = (G - 128) * con + 128; B = (B - 128) * con + 128;
    d[i] = R + (226 - R) * fade * 0.55; d[i + 1] = G + (214 - G) * fade * 0.55; d[i + 2] = B + (186 - B) * fade * 0.55;
  }
  x2.putImageData(id, 0, 0);
  // vignette, scratches, dust
  const vg = x2.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.6);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(40,25,10,${o.vignette ?? 0.45})`);
  x2.fillStyle = vg; x2.fillRect(0, 0, W, H);
  x2.globalCompositeOperation = 'screen';
  for (let k = 0, n = Math.ceil((o.scratches ?? 0.5) * 12); k < n; k++) {
    x2.strokeStyle = `rgba(255,250,235,${0.15 + r() * 0.3})`; x2.lineWidth = 0.5 + r() * 0.8;
    const sx = r() * W; x2.beginPath(); x2.moveTo(sx, r() * H * 0.3); x2.lineTo(sx + (r() - 0.5) * 6, H * (0.6 + r() * 0.4)); x2.stroke();
  }
  x2.globalCompositeOperation = 'multiply';
  for (let k = 0, n = Math.ceil((o.dust ?? 0.5) * W * H / 1500); k < n; k++) { x2.fillStyle = `rgba(30,25,20,${0.2 + r() * 0.5})`; x2.fillRect(r() * W, r() * H, 0.7 + r() * 1.3, 0.7 + r() * 1.3); }
  x2.globalCompositeOperation = 'source-over';
  ctx.save();
  if (o.angle) { ctx.translate(x + w / 2, y + h / 2); ctx.rotate(o.angle); ctx.translate(-(x + w / 2), -(y + h / 2)); }
  if (o.border) { ctx.fillStyle = '#ece6d6'; ctx.fillRect(x - o.border, y - o.border, w + o.border * 2, h + o.border * 2.6); }
  if (o.halftone) halftone(ctx, c, x, y, w, h, { color: o.halftone === 'cmyk' ? 'cmyk' : 'mono', cell: o.cell });
  else ctx.drawImage(c, x, y, w, h);
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------------------
// ready-made sheets (canvas out): handy defaults for the common cases
// agedDocument(w, h, { title, from, to, re, body, stamp: { text, sub, color }, paper, age (AGE preset or opts), seed })
export function agedDocument(w = 512, h = 724, o = {}) {
  const seed = o.seed ?? 1, S = w / 512;
  const c = agedPaper(w, h, { paper: o.paper || 'white', holes: o.holes, seed });
  const ctx = c.getContext('2d');
  let y = 70 * S;
  if (o.title) y = printText(ctx, o.title, w / 2, y, { size: 30 * S, align: 'center', font: 'print', seed: seed + 1 }) + 8 * S;
  ctx.fillStyle = 'rgba(30,28,26,0.8)'; ctx.fillRect(40 * S, y, w - 80 * S, 2 * S);
  y += 30 * S;
  const head = [o.to && `TO:   ${o.to}`, o.from && `FROM: ${o.from}`, o.re && `RE:   ${o.re}`].filter(Boolean).join('\n');
  if (head) y = typeText(ctx, head, 44 * S, y, { size: 17 * S, seed: seed + 2 }) + 12 * S;
  if (o.body) typeText(ctx, o.body, 44 * S, y, { size: 16 * S, maxWidth: w - 88 * S, lineHeight: 22 * S, seed: seed + 3 });
  if (o.stamp) stamp(ctx, o.stamp.text || 'CONFIDENTIAL', w * 0.68, h * 0.82, { size: 26 * S, color: o.stamp.color || INK.red, sub: o.stamp.sub, shape: o.stamp.shape, seed: seed + 4 });
  ageCanvas(ctx, w, h, { ...(typeof o.age === 'object' ? o.age : AGE.file), seed: seed + 5 });
  return c;
}

// agedPoster(w, h, { title, subtitle, body, photo (stock id / procedural kind / image), halftone, colors: [bg, ink, accent],
//   font ('title' | 'deco' | 'print'), age, seed })
export function agedPoster(w = 512, h = 724, o = {}) {
  const seed = o.seed ?? 2, S = w / 512;
  const [bg, ink, accent] = o.colors || ['#e7dcc0', '#1f1c1a', '#a3231c'];
  const c = agedPaper(w, h, { paper: { base: bg, fibre: '110,95,70', tone: '150,120,70' }, seed });
  const ctx = c.getContext('2d');
  ctx.fillStyle = accent; ctx.globalAlpha = 0.9; ctx.fillRect(0, 0, w, 18 * S); ctx.fillRect(0, h - 18 * S, w, 18 * S); ctx.globalAlpha = 1;
  let y = 96 * S;
  if (o.title) y = printText(ctx, o.title, w / 2, y, { size: 54 * S, align: 'center', font: o.font || 'title', color: ink, maxWidth: w - 60 * S, seed: seed + 1 });
  if (o.subtitle) y = printText(ctx, o.subtitle, w / 2, y + 6 * S, { size: 24 * S, align: 'center', font: 'print', color: accent, maxWidth: w - 80 * S, seed: seed + 2 });
  const ph = h * 0.42, pw = w - 90 * S;
  drawStockImage(ctx, o.photo ?? 'office', 45 * S, y + 18 * S, pw, ph, { halftone: o.halftone ?? true, sepia: 0.4, seed: seed + 3 });
  y += ph + 54 * S;
  if (o.body) printText(ctx, o.body, w / 2, y, { size: 19 * S, align: 'center', font: 'print', color: ink, maxWidth: w - 90 * S, lineHeight: 24 * S, seed: seed + 4 });
  ageCanvas(ctx, w, h, { ...(typeof o.age === 'object' ? o.age : AGE.poster), seed: seed + 5 });
  return c;
}
