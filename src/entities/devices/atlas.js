// Per-device print atlas: one canvas for every label, sticker, dial, stencil, keycap legend, product
// graphic and grime decal of a model, plus a half-resolution "surface" companion (R = emission,
// G = roughness, B = metalness) so matte paper, glossy vinyl, brushed nameplates, glowing panels and
// small solid-coloured parts (palette swatches) all render through ONE material / draw call.
// Regions are packed with a skyline packer; at finalize() the canvas is cropped to the used height
// (all atlas UVs are remapped by the kit), so small devices don't pay for a big texture.
import * as THREE from 'three';
import { RNG } from '../../core/rng.js';

const PI = Math.PI, TAU = PI * 2, HP = PI / 2;
const NO = Object.freeze({});

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0);
  c.height = Math.max(1, h | 0);
  return c;
}
export function canvasTex(w, h, draw, srgb = true) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  draw(ctx, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.userData.ctx = ctx;
  return t;
}

// surface kinds: [emission, roughness, metalness]
export const KIND = {
  '': [0, 0.62, 0], p: [0, 0.68, 0], g: [0, 0.24, 0], s: [0, 0.42, 0], m: [0, 0.34, 0.9], b: [0, 0.48, 0.85],
  r: [0, 0.9, 0], e: [1, 0.3, 0], E: [0.45, 0.4, 0], c: [0, 0.12, 1],
};
const SD = 2; // surface map downscale

let bytes = 0;
export const atlasBytes = () => bytes;

export class Atlas {
  constructor(w = 1024, h = 1024) {
    this.W = w; this.H = h;
    this.cv = canvas(w, h);
    this.ctx = this.cv.getContext('2d');
    this.ctx.clearRect(0, 0, w, h);
    this.scv = canvas(w / SD, h / SD);
    this.sctx = this.scv.getContext('2d');
    this._fillKind(0, 0, w, h, '');
    this.sky = [{ x: 0, w, y: 0 }];
    this.pad = 4;
    this.used = 0;
    this.sw = new Map();
    this.swCell = null;
    // textures exist from the start (materials reference them); finalize() swaps in the cropped canvases
    const t = new THREE.CanvasTexture(this.cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    this.tex = t;
    const st = new THREE.CanvasTexture(this.scv);
    st.colorSpace = THREE.NoColorSpace;
    st.magFilter = st.minFilter = THREE.NearestFilter;
    st.generateMipmaps = false;
    this.stex = st;
    this.done = false;
  }
  _alloc(pw, ph) {
    const sk = this.sky;
    let bestY = Infinity, bestX = 0;
    for (let i = 0; i < sk.length; i++) {
      const x = sk[i].x;
      if (x + pw > this.W) break;
      let y = 0, j = i, rem = pw;
      while (rem > 0 && j < sk.length) { y = Math.max(y, sk[j].y); rem -= sk[j].w; j++; }
      if (rem > 0) continue;
      if (y < bestY) { bestY = y; bestX = x; }
    }
    if (bestY === Infinity) bestY = this.used;
    const X0 = bestX, X1 = Math.min(this.W, bestX + pw + this.pad), Y = bestY + ph + this.pad;
    const out = [];
    for (const s of sk) {
      const s0 = s.x, s1 = s.x + s.w;
      if (s1 <= X0 || s0 >= X1) { out.push(s); continue; }
      if (s0 < X0) out.push({ x: s0, w: X0 - s0, y: s.y });
      if (s1 > X1) out.push({ x: X1, w: s1 - X1, y: s.y });
    }
    out.push({ x: X0, w: X1 - X0, y: Y });
    out.sort((p, q) => p.x - q.x);
    this.sky = out;
    this.used = Math.max(this.used, Y);
    return [bestX, bestY];
  }
  _fillKind(x, y, w, h, kind) {
    const k = typeof kind === 'object' ? [kind.e ?? 0, kind.r ?? 0.6, kind.m ?? 0] : (KIND[kind] || KIND['']);
    this.sctx.fillStyle = `rgb(${Math.round(k[0] * 255)},${Math.round(k[1] * 255)},${Math.round(k[2] * 255)})`;
    const x0 = Math.floor(x / SD), y0 = Math.floor(y / SD);
    this.sctx.fillRect(x0, y0, Math.ceil((x + w) / SD) - x0, Math.ceil((y + h) / SD) - y0);
  }
  // draw(ctx, w, h, rng) in region-local pixels. kind: surface kind (see KIND) or {e, r, m}
  // o.surf(sctx, w, h): optional detailed surface drawing (in surface-map pixels)
  add(pw, ph, draw, kind = '', o = NO) {
    pw = Math.max(2, Math.ceil(pw)); ph = Math.max(2, Math.ceil(ph));
    const [px, py] = this._alloc(pw, ph);
    if (py + ph > this.H) console.warn(`[devices] atlas overflow (${this.W}x${this.H})`);
    const c = this.ctx;
    c.save(); c.translate(px, py); c.beginPath(); c.rect(0, 0, pw, ph); c.clip();
    draw(c, pw, ph, new RNG((px * 7919 + py * 104729) >>> 0));
    c.restore();
    this._fillKind(px, py, pw, ph, kind);
    if (o.surf) { const s = this.sctx; s.save(); s.translate(px / SD, py / SD); s.beginPath(); s.rect(0, 0, pw / SD, ph / SD); s.clip(); o.surf(s, pw / SD, ph / SD); s.restore(); }
    const e = 0.5;
    return { x: px, y: py, w: pw, h: ph, u0: (px + e) / this.W, u1: (px + pw - e) / this.W, v0: 1 - (py + ph - e) / this.H, v1: 1 - (py + e) / this.H };
  }
  // solid swatch for small coloured parts: spec '#rrggbb' or '#rrggbb:k' (k: surface kind letter)
  swatch(spec) {
    let r = this.sw.get(spec);
    if (r) return r;
    if (!this.swCell || this.swCell.n >= 16) {
      // swatches live in 128x128 blocks of 16x16 cells (inner 8x8 sampled)
      const reg = this.add(128, 32, () => {}, '');
      this.swCell = { reg, n: 0 };
    }
    const [hex, kind = ''] = spec.split(':');
    const i = this.swCell.n++;
    const R = this.swCell.reg;
    const cx = R.x + (i % 8) * 16, cy = R.y + Math.floor(i / 8) * 16;
    this.ctx.fillStyle = hex;
    this.ctx.fillRect(cx, cy, 16, 16);
    this._fillKind(cx + 2, cy + 2, 12, 12, kind);
    r = { u: (cx + 8) / this.W, v: 1 - (cy + 8) / this.H };
    this.sw.set(spec, r);
    return r;
  }
  // crop to the used height; returns the v-scale the kit applies to every atlas UV (v' = 1 - (1 - v) * s)
  finalize() {
    if (this.done) return this.vScale;
    this.done = true;
    const H2 = Math.max(16, Math.min(this.H, Math.ceil(this.used / 16) * 16));
    let cv = this.cv, scv = this.scv;
    if (H2 < this.H) {
      cv = canvas(this.W, H2);
      cv.getContext('2d').drawImage(this.cv, 0, 0);
      scv = canvas(this.W / SD, H2 / SD);
      scv.getContext('2d').drawImage(this.scv, 0, 0);
    }
    this.vScale = this.H / H2;
    this.H2 = H2;
    this.tex.image = cv;
    this.tex.needsUpdate = true;
    this.stex.image = scv;
    this.stex.needsUpdate = true;
    bytes += this.W * H2 * 4 * 1.33 + (this.W / SD) * (H2 / SD) * 4;
    this.cv = this.scv = null;
    this.ctx = this.sctx = null;
    return this.vScale;
  }
}

// ===========================================================================
// Canvas drawing helpers
// ===========================================================================
export const FONT = {
  sans: '"Arial Black", "Inter Black", "Inter", "Helvetica Neue", Arial, sans-serif',
  bold: '"Arial", "Inter", "Helvetica Neue", "Liberation Sans", sans-serif',
  cond: '"Arial Narrow", "Roboto Condensed", "Liberation Sans Narrow", Arial, sans-serif',
  mono: '"IBM Plex Mono", "DejaVu Sans Mono", "Courier New", monospace',
  vt: '"VT323", "IBM Plex Mono", monospace',
  serif: 'Georgia, "Times New Roman", "DejaVu Serif", serif',
  stencil: '"Stencil", "Arial Black", "Inter Black", "Impact", sans-serif',
};
export function txt(c, s, x, y, px, o = NO) {
  const fam = FONT[o.f || 'sans'] || o.f;
  const wt = o.w || (o.f === 'mono' || o.f === 'vt' ? 'bold' : o.f === 'bold' || o.f === 'cond' ? 'bold' : '900');
  c.font = `${o.i ? 'italic ' : ''}${wt} ${px}px ${fam}`;
  if (o.maxW) {
    const mw = c.measureText(s).width;
    if (mw > o.maxW) { px *= o.maxW / mw; c.font = `${o.i ? 'italic ' : ''}${wt} ${px}px ${fam}`; }
  }
  c.textAlign = o.al || 'center';
  c.textBaseline = o.bl || 'middle';
  if (o.ls !== undefined && 'letterSpacing' in c) c.letterSpacing = o.ls + 'px';
  if (o.stroke) { c.lineWidth = o.lw || px * 0.12; c.strokeStyle = o.stroke; c.lineJoin = 'round'; c.strokeText(s, x, y); }
  c.fillStyle = o.col || '#111';
  c.fillText(s, x, y);
  if (o.ls !== undefined && 'letterSpacing' in c) c.letterSpacing = '0px';
  return px;
}
export function rrect(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}
// Dirt, scuffs, fingerprints and speckles over what is already painted (keeps alpha)
export function grime(c, w, h, amt = 1, seed = 1, o = NO) {
  const r = new RNG(seed);
  c.save();
  c.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 40 * amt; i++) {
    const x = r.next() * w, y = r.next() * h, rad = r.range(2, Math.max(4, w * 0.08));
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(40,30,20,${0.13 * r.next()})`);
    g.addColorStop(1, 'rgba(40,30,20,0)');
    c.fillStyle = g;
    c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  c.strokeStyle = 'rgba(255,255,255,0.10)';
  for (let i = 0; i < 25 * amt; i++) {
    c.lineWidth = r.range(0.5, 1.5);
    const x = r.next() * w, y = r.next() * h, a = r.next() * PI, l = r.range(3, w * 0.12);
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
  }
  // edge darkening (handled paper / sticker edges)
  if (o.edges !== false) {
    c.fillStyle = `rgba(60,45,25,${0.12 * amt})`;
    c.fillRect(0, 0, w, Math.max(1, h * 0.012)); c.fillRect(0, h - Math.max(1, h * 0.012), w, Math.max(1, h * 0.012));
  }
  // peeled / torn corner
  if (o.corner) {
    c.globalCompositeOperation = 'destination-out';
    const s = Math.min(w, h) * o.corner;
    c.beginPath(); c.moveTo(w, h); c.lineTo(w - s, h); c.lineTo(w, h - s * 0.8); c.closePath(); c.fill();
  }
  c.restore();
}
// wear spots where the print is rubbed off (destination-out, keeps the sticker shape)
export function rubOff(c, w, h, amt = 1, seed = 2) {
  const r = new RNG(seed);
  c.save();
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 18 * amt; i++) {
    const x = r.next() * w, y = r.next() * h, rad = r.range(1, Math.max(2, Math.min(w, h) * 0.05));
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(0,0,0,${r.range(0.3, 0.9)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  c.restore();
}
// The R.O.O.M. corporate mark: isometric cube outline + wordmark
export function drawLogo(c, x, y, s, col = '#111', o = NO) {
  c.save();
  c.translate(x, y);
  c.strokeStyle = col; c.fillStyle = col;
  c.lineWidth = s * 0.07; c.lineJoin = 'round';
  const k = s * 0.42;
  const cx = o.text === false ? 0 : -s * 0.95;
  c.beginPath();
  c.moveTo(cx, -k); c.lineTo(cx + k * 0.87, -k / 2); c.lineTo(cx + k * 0.87, k / 2); c.lineTo(cx, k);
  c.lineTo(cx - k * 0.87, k / 2); c.lineTo(cx - k * 0.87, -k / 2); c.closePath(); c.stroke();
  c.beginPath(); c.moveTo(cx - k * 0.87, -k / 2); c.lineTo(cx, 0); c.lineTo(cx + k * 0.87, -k / 2); c.moveTo(cx, 0); c.lineTo(cx, k); c.stroke();
  c.beginPath(); c.arc(cx, -k * 0.05, k * 0.16, 0, TAU); c.fill();
  if (o.text !== false) txt(c, 'R.O.O.M.', -s * 0.35, 0, s * 0.62, { col, al: 'left', f: o.f || 'sans' });
  c.restore();
}
// Cute chubby clone mascot (yellow hazmat suit, black visor)
export function drawClone(c, x, y, s, o = NO) {
  c.save();
  c.translate(x, y);
  const yel = o.col || '#f2c418', ink = o.ink || '#1a1a1a';
  c.lineWidth = s * 0.045; c.strokeStyle = ink;
  c.fillStyle = yel;
  c.beginPath(); c.ellipse(0, s * 0.18, s * 0.3, s * 0.3, 0, 0, TAU); c.fill(); c.stroke();
  c.beginPath(); c.ellipse(-s * 0.3, s * 0.2, s * 0.08, s * 0.14, 0.5, 0, TAU); c.fill(); c.stroke();
  c.beginPath(); c.ellipse(s * 0.3, s * 0.12, s * 0.08, s * 0.14, o.wave ? -2.2 : -0.5, 0, TAU); c.fill(); c.stroke();
  c.beginPath(); c.ellipse(0, -s * 0.2, s * 0.27, s * 0.25, 0, 0, TAU); c.fill(); c.stroke();
  c.fillStyle = '#1b2228';
  rrect(c, -s * 0.18, -s * 0.3, s * 0.36, s * 0.2, s * 0.09); c.fill();
  c.fillStyle = '#ffffff';
  c.beginPath(); c.arc(-s * 0.07, -s * 0.2, s * 0.03, 0, TAU); c.arc(s * 0.07, -s * 0.2, s * 0.03, 0, TAU); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.35)';
  c.beginPath(); c.ellipse(-s * 0.1, -s * 0.27, s * 0.06, s * 0.02, -0.2, 0, TAU); c.fill();
  c.fillStyle = ink; c.fillRect(-s * 0.28, s * 0.22, s * 0.56, s * 0.05);
  c.restore();
}
export function hazardTri(c, x, y, s, sym = '!') {
  c.save();
  c.translate(x, y);
  c.fillStyle = '#f2c418'; c.strokeStyle = '#111'; c.lineWidth = s * 0.08; c.lineJoin = 'round';
  c.beginPath(); c.moveTo(0, -s * 0.5); c.lineTo(s * 0.55, s * 0.45); c.lineTo(-s * 0.55, s * 0.45); c.closePath(); c.fill(); c.stroke();
  if (sym === 'bolt') {
    c.fillStyle = '#111';
    c.beginPath(); c.moveTo(s * 0.06, -s * 0.28); c.lineTo(-s * 0.14, s * 0.08); c.lineTo(s * 0.0, s * 0.06); c.lineTo(-s * 0.08, s * 0.36);
    c.lineTo(s * 0.16, -s * 0.02); c.lineTo(s * 0.02, 0); c.closePath(); c.fill();
  } else if (sym === 'rad') {
    c.fillStyle = '#111';
    for (let i = 0; i < 3; i++) {
      const a = -HP + i * TAU / 3;
      c.beginPath(); c.moveTo(0, s * 0.1); c.arc(0, s * 0.1, s * 0.26, a - 0.5, a + 0.5); c.closePath(); c.fill();
    }
    c.fillStyle = '#f2c418'; c.beginPath(); c.arc(0, s * 0.1, s * 0.08, 0, TAU); c.fill();
    c.fillStyle = '#111'; c.beginPath(); c.arc(0, s * 0.1, s * 0.05, 0, TAU); c.fill();
  } else if (sym === 'bio') {
    c.strokeStyle = '#111'; c.lineWidth = s * 0.06;
    for (let i = 0; i < 3; i++) { const a = -HP + i * TAU / 3; c.beginPath(); c.arc(Math.cos(a) * s * 0.11, s * 0.1 + Math.sin(a) * s * 0.11, s * 0.12, 0, TAU); c.stroke(); }
    c.beginPath(); c.arc(0, s * 0.1, s * 0.05, 0, TAU); c.stroke();
  } else if (sym === 'hand') {
    c.fillStyle = '#111';
    c.beginPath(); c.ellipse(0, s * 0.18, s * 0.11, s * 0.13, 0, 0, TAU); c.fill();
    for (let i = 0; i < 4; i++) c.fillRect(-s * 0.1 + i * s * 0.055, -s * 0.12 + Math.abs(i - 1.5) * s * 0.03, s * 0.04, s * 0.26);
  } else {
    txt(c, sym, 0, s * 0.12, s * 0.55, { col: '#111' });
  }
  c.restore();
}
export function drawPerforation(c, w, h, step, rad, bg = '#222', hole = '#050505', o = NO) {
  if (bg) { c.fillStyle = bg; c.fillRect(0, 0, w, h); }
  for (let y = step / 2; y < h; y += step) for (let x = step / 2 + ((y / step) % 2 >= 1 && o.stagger !== false ? step / 2 : 0); x < w; x += step) {
    // hole with a lit lower lip (depth)
    c.fillStyle = hole; c.beginPath(); c.arc(x, y, rad, 0, TAU); c.fill();
    if (o.lip !== false) { c.fillStyle = 'rgba(255,255,255,0.08)'; c.beginPath(); c.arc(x, y + rad * 0.2, rad, 0.15 * PI, 0.85 * PI); c.fill(); }
  }
}
// Gauge dial face (270 deg sweep, value 0 at lower-left, 1 at lower-right)
export function drawDial(c, w, h, o = NO) {
  const cx = w / 2, cy = h / 2, R = w / 2;
  c.fillStyle = o.bg || '#efe8d4';
  c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fill();
  const g = c.createRadialGradient(cx, cy - R * 0.3, R * 0.1, cx, cy, R);
  g.addColorStop(0, 'rgba(255,255,255,0.0)'); g.addColorStop(1, 'rgba(60,40,10,0.3)');
  c.fillStyle = g; c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fill();
  const ang = (v) => (v - 0.5) * 1.5 * PI;
  const P = (v, r) => [cx + Math.sin(ang(v)) * r, cy - Math.cos(ang(v)) * r];
  if (o.red !== undefined) {
    c.strokeStyle = '#c0281c'; c.lineWidth = R * 0.12;
    c.beginPath(); c.arc(cx, cy, R * 0.78, ang(o.red) - HP, ang(1) - HP); c.stroke();
  }
  if (o.green) {
    c.strokeStyle = '#2f8a3a'; c.lineWidth = R * 0.12;
    c.beginPath(); c.arc(cx, cy, R * 0.78, ang(o.green[0]) - HP, ang(o.green[1]) - HP); c.stroke();
  }
  c.strokeStyle = o.ink || '#151515';
  const n = o.ticks || 10;
  for (let i = 0; i <= n * 5; i++) {
    const v = i / (n * 5), major = i % 5 === 0;
    const [x0, y0] = P(v, R * (major ? 0.66 : 0.74)), [x1, y1] = P(v, R * 0.86);
    c.lineWidth = major ? R * 0.045 : R * 0.02;
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  }
  c.lineWidth = R * 0.02;
  c.beginPath(); c.arc(cx, cy, R * 0.86, ang(0) - HP, ang(1) - HP); c.stroke();
  if (o.nums !== false) {
    const lab = o.labels || Array.from({ length: n / 2 + 1 }, (_, i) => String(Math.round((o.max ?? 10) * i / (n / 2))));
    lab.forEach((s, i) => { const [x, y] = P(i / (lab.length - 1), R * 0.5); txt(c, s, x, y, R * 0.15, { col: o.ink || '#151515', f: 'bold', w: 'bold' }); });
  }
  if (o.label) txt(c, o.label, cx, cy + R * 0.42, R * 0.16, { col: o.ink || '#151515', f: 'bold', w: 'bold', maxW: R });
  if (o.brand !== false) txt(c, o.brand || 'R.O.O.M.', cx, cy - R * 0.25, R * 0.1, { col: '#555', f: 'bold', w: 'bold' });
  // aged face: foxing + a faint water mark
  const r = new RNG(o.seed ?? 5);
  for (let i = 0; i < 14; i++) {
    const x = cx + (r.next() - 0.5) * R * 1.6, y = cy + (r.next() - 0.5) * R * 1.6, rad = r.range(R * 0.02, R * 0.1);
    const gg = c.createRadialGradient(x, y, 0, x, y, rad);
    gg.addColorStop(0, 'rgba(120,80,30,0.12)'); gg.addColorStop(1, 'rgba(120,80,30,0)');
    c.fillStyle = gg; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}
// Phillips / slotted / hex-socket screw head (top view) for screw-head decals
export function drawScrewHead(c, w, h, kind = 'phillips') {
  c.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, r = w * 0.48;
  c.fillStyle = 'rgba(0,0,0,0)';
  c.strokeStyle = 'rgba(14,12,10,0.95)';
  c.lineCap = 'round';
  if (kind === 'slot') {
    c.lineWidth = r * 0.24; c.beginPath(); c.moveTo(cx - r * 0.7, cy); c.lineTo(cx + r * 0.7, cy); c.stroke();
  } else if (kind === 'hex') {
    c.fillStyle = 'rgba(14,12,10,0.95)';
    c.beginPath();
    for (let i = 0; i < 6; i++) { const a = i * PI / 3; c.lineTo(cx + Math.cos(a) * r * 0.42, cy + Math.sin(a) * r * 0.42); }
    c.closePath(); c.fill();
  } else if (kind === 'torx') {
    c.fillStyle = 'rgba(14,12,10,0.95)';
    c.beginPath();
    for (let i = 0; i < 12; i++) { const a = i * PI / 6; const rr = i % 2 ? r * 0.22 : r * 0.42; c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    c.closePath(); c.fill();
  } else {
    c.lineWidth = r * 0.2;
    c.beginPath(); c.moveTo(cx - r * 0.62, cy); c.lineTo(cx + r * 0.62, cy); c.moveTo(cx, cy - r * 0.62); c.lineTo(cx, cy + r * 0.62); c.stroke();
    c.fillStyle = 'rgba(14,12,10,0.95)';
    c.beginPath(); c.arc(cx, cy, r * 0.17, 0, TAU); c.fill();
  }
}
// Run-off streak (rust / grime) decal: tall soft vertical drips from the top edge. col: 'r,g,b'
export function drawStreak(c, w, h, seed = 1, col = '110,48,16', o = NO) {
  c.clearRect(0, 0, w, h);
  const r = new RNG(seed);
  const n = o.n ?? 5;
  for (let i = 0; i < n; i++) {
    const x = w * (0.25 + r.next() * 0.5), len = h * r.range(0.35, 1), wid = w * r.range(0.06, 0.2);
    const g = c.createLinearGradient(0, 0, 0, len);
    const a0 = (o.alpha ?? 0.6) * r.range(0.6, 1);
    g.addColorStop(0, `rgba(${col},${a0})`); g.addColorStop(0.25, `rgba(${col},${a0 * 0.6})`); g.addColorStop(1, `rgba(${col},0)`);
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(x - wid, 0);
    c.bezierCurveTo(x - wid * 0.6, len * 0.3, x - wid * 0.2, len * 0.7, x + (r.next() - 0.5) * wid * 0.4, len);
    c.bezierCurveTo(x + wid * 0.2, len * 0.7, x + wid * 0.6, len * 0.3, x + wid, 0);
    c.closePath(); c.fill();
  }
  // head stain where it starts
  const g = c.createRadialGradient(w / 2, 0, 0, w / 2, 0, w * 0.5);
  g.addColorStop(0, `rgba(${col},${(o.alpha ?? 0.6) * 0.9})`); g.addColorStop(1, `rgba(${col},0)`);
  c.fillStyle = g; c.fillRect(0, 0, w, w * 0.5);
}
// soft irregular stain / oil splat / water mark decal
export function drawStain(c, w, h, seed = 1, col = '40,30,18', alpha = 0.5, o = NO) {
  c.clearRect(0, 0, w, h);
  const r = new RNG(seed);
  for (let i = 0; i < (o.blobs ?? 14); i++) {
    const x = w * (0.2 + r.next() * 0.6), y = h * (0.2 + r.next() * 0.6), rad = Math.min(w, h) * r.range(0.08, 0.32);
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${col},${alpha * r.range(0.3, 0.8)})`); g.addColorStop(1, `rgba(${col},0)`);
    c.fillStyle = g; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  if (o.ring) {
    c.strokeStyle = `rgba(${col},${alpha * 0.7})`; c.lineWidth = Math.max(1, w * 0.012);
    c.beginPath(); c.ellipse(w / 2, h / 2, w * 0.38, h * 0.34, r.next(), 0, TAU); c.stroke();
  }
}
// scuffs / rub marks (light or dark scratch clusters) decal
export function drawScuffs(c, w, h, seed = 1, col = '255,255,255', alpha = 0.35) {
  c.clearRect(0, 0, w, h);
  const r = new RNG(seed);
  for (let i = 0; i < 70; i++) {
    const x = w * (0.1 + r.next() * 0.8), y = h * (0.1 + r.next() * 0.8), a = r.range(-0.4, 0.4) + (r.next() < 0.5 ? 0 : PI / 2), l = r.range(w * 0.03, w * 0.25);
    c.strokeStyle = `rgba(${col},${alpha * r.range(0.3, 1)})`; c.lineWidth = r.range(0.5, 2);
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
  }
}
// hand prints / greasy finger smears decal
export function drawHandprint(c, w, h, seed = 1, col = '30,24,16', alpha = 0.32) {
  c.clearRect(0, 0, w, h);
  const r = new RNG(seed);
  const s = Math.min(w, h);
  c.fillStyle = `rgba(${col},${alpha})`;
  c.save(); c.translate(w / 2, h * 0.6); c.rotate(r.range(-0.4, 0.4));
  c.beginPath(); c.ellipse(0, 0, s * 0.2, s * 0.24, 0, 0, TAU); c.fill();
  for (let i = 0; i < 4; i++) { c.beginPath(); c.ellipse(-s * 0.16 + i * s * 0.11, -s * 0.33 + Math.abs(i - 1.5) * s * 0.05, s * 0.045, s * 0.12, (i - 1.5) * 0.12, 0, TAU); c.fill(); }
  c.beginPath(); c.ellipse(s * 0.26, -s * 0.02, s * 0.05, s * 0.11, -0.9, 0, TAU); c.fill();
  c.restore();
}

// ===========================================================================
// Screens (CanvasTexture placeholders the game replaces)
// ===========================================================================
const _ph = new Map();
export function placeholderTex(style, aspect, text = '') {
  const key = `${style}|${aspect.toFixed(3)}|${text}`;
  if (_ph.has(key)) return _ph.get(key);
  const W = aspect >= 1 ? 512 : Math.round(512 * aspect);
  const H = aspect >= 1 ? Math.max(32, Math.round(512 / aspect)) : 512;
  const t = canvasTex(W, H, (c, w, h) => {
    const lines = String(text).split('\n');
    const S = Math.min(w, h);
    if (style === 'paper' || style === 'card') {
      c.fillStyle = '#efe9d8'; c.fillRect(0, 0, w, h);
      lines.forEach((l, i) => txt(c, l, w / 2, h * (0.5 + (i - (lines.length - 1) / 2) * 0.32), S * 0.26, { col: '#1a1a1a', f: 'mono', maxW: w * 0.9 }));
      grime(c, w, h, 0.3, 3);
    } else if (style === 'photo') {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#6c7f93'); g.addColorStop(1, '#2d3540');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      drawClone(c, w / 2, h * 0.6, w * 0.8);
      txt(c, text || 'PHOTO', w / 2, h * 0.08, w * 0.08, { col: '#fff', f: 'mono' });
    } else if (style === 'poster') {
      c.fillStyle = '#0d0d0f'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#d9d2c0'; c.lineWidth = S * 0.012; c.strokeRect(w * 0.08, h * 0.06, w * 0.84, h * 0.6);
      const g = c.createLinearGradient(0, h * 0.06, 0, h * 0.66);
      g.addColorStop(0, '#3d5a7a'); g.addColorStop(1, '#d9a24a');
      c.fillStyle = g; c.fillRect(w * 0.085, h * 0.065, w * 0.83, h * 0.59);
      for (let i = 0; i < 4; i++) { c.save(); c.translate(w * (0.3 + i * 0.14), h * 0.55); drawClone(c, 0, 0, w * 0.16, { ink: '#000', col: '#111' }); c.restore(); }
      txt(c, lines[0] || 'TEAMWORK', w / 2, h * 0.75, S * 0.1, { col: '#efe6cf', f: 'serif', w: 'normal', maxW: w * 0.84 });
      txt(c, lines[1] || 'Alone you are disposable. Together, slightly less so.', w / 2, h * 0.84, S * 0.035, { col: '#cfc6b0', f: 'serif', w: 'normal', i: true, maxW: w * 0.84 });
      drawLogo(c, w / 2, h * 0.93, S * 0.04, '#9a917c');
    } else if (style === 'brass') {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#f6dc94'); g.addColorStop(0.45, '#c9a24e'); g.addColorStop(1, '#8a6a28');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(60,40,8,0.6)'; c.lineWidth = Math.max(2, h * 0.04); c.strokeRect(h * 0.08, h * 0.08, w - h * 0.16, h - h * 0.16);
      txt(c, lines[0] || 'NAME', w / 2, h / 2 + 1, h * 0.5, { col: '#2e1e04', f: 'serif', maxW: w * 0.88 });
    } else if (style === 'led') {
      c.fillStyle = '#120202'; c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(255,40,20,0.06)';
      for (let x = 0; x < w; x += 6) for (let y = 0; y < h; y += 6) c.fillRect(x, y, 4, 4);
      txt(c, lines[0] || '88:88', w / 2, h / 2, h * 0.7, { col: '#ff3a1e', f: 'vt', maxW: w * 0.9 });
    } else if (style === 'lcd') {
      c.fillStyle = '#8f9a6a'; c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(0,0,0,0.08)'; c.fillRect(w * 0.03, h * 0.08, w * 0.94, h * 0.84);
      lines.forEach((l, i) => txt(c, l, w / 2, h * (0.5 + (i - (lines.length - 1) / 2) * 0.4), h * 0.34 / Math.max(1, lines.length * 0.7), { col: '#1d2410', f: 'vt', maxW: w * 0.9 }));
    } else if (style === 'scope') {
      c.fillStyle = '#031208'; c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(80,255,140,0.18)'; c.lineWidth = 1;
      for (let i = 1; i < 10; i++) { c.beginPath(); c.moveTo((w * i) / 10, 0); c.lineTo((w * i) / 10, h); c.stroke(); }
      for (let i = 1; i < 8; i++) { c.beginPath(); c.moveTo(0, (h * i) / 8); c.lineTo(w, (h * i) / 8); c.stroke(); }
      c.strokeStyle = '#6dffa0'; c.lineWidth = S * 0.012; c.shadowColor = '#6dffa0'; c.shadowBlur = 8;
      c.beginPath();
      for (let x = 0; x <= w; x += 2) { const t = x / w; const y = h / 2 + Math.sin(t * 22) * h * 0.18 * Math.sin(t * 3.1) + (t > 0.45 && t < 0.5 ? -h * 0.3 : 0); x ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke(); c.shadowBlur = 0;
    } else if (style === 'sign') {
      c.fillStyle = '#1a0000'; c.fillRect(0, 0, w, h);
      txt(c, lines[0] || 'EXIT', w / 2, h * 0.52, h * 0.72, { col: '#ff3322', f: 'sans', maxW: w * 0.92 });
    } else {
      const pal = style === 'amber' ? ['#100800', '#ffb02a'] : style === 'blue' ? ['#0b1a5c', '#d8e4ff'] : ['#020c05', '#5dff8a'];
      c.fillStyle = pal[0]; c.fillRect(0, 0, w, h);
      const g = c.createRadialGradient(w / 2, h / 2, S * 0.1, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, 'rgba(255,255,255,0.06)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      const L = lines.length ? lines : ['R.O.O.M.'];
      const px = Math.min(h / (L.length + 2.5), w / 14);
      c.shadowColor = pal[1]; c.shadowBlur = px * 0.4;
      L.forEach((l, i) => txt(c, l, w * 0.07, px * (1.4 + i * 1.15), px, { col: pal[1], f: 'vt', al: 'left', maxW: w * 0.86 }));
      c.shadowBlur = 0;
      c.fillStyle = 'rgba(0,0,0,0.25)';
      for (let y = 0; y < h; y += 3) c.fillRect(0, y, w, 1);
    }
  });
  _ph.set(key, t);
  return t;
}
export const PRINTED = new Set(['paper', 'card', 'photo', 'poster', 'brass']);
export const SCREEN_GLOW = { brass: 0.06, crt: 1.2, amber: 1.2, blue: 1.1, scope: 1.3, led: 1.4, lcd: 0.55, sign: 1.8, paper: 0.12, card: 0.1, photo: 0.15, poster: 0.12 };
