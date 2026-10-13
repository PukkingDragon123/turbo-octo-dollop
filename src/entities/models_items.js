// R.O.O.M. — procedural physics-item model library.
//
// Every item is built from three.js primitives + canvas-drawn label atlases (no asset files).
// Geometry, materials and textures are built once per item type (and variant) and cached;
// each ITEMS[name](opts) call only creates a Group + 1–4 Meshes that share the cached data.
//
// Conventions:
//   * meters, Y up; origin = centre of the visual bounds (= physics body origin)
//   * "business end" / forward = -Z; printed labels generally face +Z (toward the player when held)
//   * colliders: convex primitives relative to the origin (cylinder axis = Y before `rot`)
//   * halfHeight: origin -> lowest collider point in the built (resting) orientation
//   * hold = transform for `object` under a first-person right-hand anchor (palm centre, -Z fwd)
//   * parts = named meshes for runtime state. Their materials are per-instance clones, so
//     recolouring / toggling one item never affects another.
//
// Exports: ITEMS, buildItem(name, opts), preloadItems(names?), itemStats(name), ITEM_NAMES()
// Item options / runtime helpers (object.userData.*):
//   flashlight   {on}                 parts.lens (emissive glass + bulb), anchors.lens, setOn(bool)
//   glowstick    {color, lit=true}    parts.glow (emissive), setLit(bool)
//   flare        {lit}                parts.flame (hidden unless lit), parts.cap, anchors.tip, setLit(bool)
//   lighter      {lit}                parts.flame, anchors.tip, setLit(bool)
//   welder                            anchors.tip (nozzle)
//   sample_jar   {fill=0.65, color, glow}  parts.contents (scale.y = fill, pivot at jar floor),
//                                     anchors.contents, setFill(f), setColor(hex, emissive)
//   paper_cup    {fill=0.8}           parts.water (surface disc), setFill(f)
//   keycard      {level=1..5}         variant (band colour / LEVEL n)
//   photo        {variant=0..3}       variant (hallway / figure / team photo / exit)
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as Mat from '../gfx/materials.js';
import { labelTexture } from '../gfx/textures.js';
import { RNG } from '../core/rng.js';

const PI = Math.PI, TAU = Math.PI * 2;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------
// Canvas drawing helpers
// ---------------------------------------------------------------------------
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const MONO = '"IBM Plex Mono", monospace';
const VT = '"VT323", monospace';
const HAND = '"Comic Sans MS", "Segoe Print", "Bradley Hand", cursive, sans-serif';

function fontStr(size, o) {
  return `${o.italic ? 'italic ' : ''}${o.weight ?? 'bold'} ${size}px ${o.fam || SANS}`;
}

// Text with auto-shrink (maxW), rotation, stroke, letter spacing.
function txt(c, s, x, y, o = {}) {
  let size = o.size || 20;
  c.save();
  c.letterSpacing = `${o.ls || 0}px`;
  c.font = fontStr(size, o);
  if (o.maxW) {
    const w = c.measureText(s).width;
    if (w > o.maxW) { size *= o.maxW / w; c.font = fontStr(size, o); }
  }
  c.textAlign = o.align || 'center';
  c.textBaseline = o.base || 'middle';
  c.translate(x, y);
  if (o.rot) c.rotate(o.rot);
  if (o.sx || o.sy) c.scale(o.sx || 1, o.sy || 1);
  if (o.alpha !== undefined) c.globalAlpha = o.alpha;
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

function rrect(c, x, y, w, h, r, fill, stroke, lw) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.lineWidth = lw || 2; c.strokeStyle = stroke; c.stroke(); }
}

function rect(c, x, y, w, h, fill) {
  c.fillStyle = fill;
  c.fillRect(x, y, w, h);
}

// Luminance noise over a region: a cached noise tile blended with 'overlay' (no canvas readbacks).
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
function noise(c, x, y, w, h, amt = 10, seed = 1) {
  const pat = c.createPattern(noiseTile(), 'repeat');
  const ox = (seed * 97) % 256, oy = (seed * 61) % 256;
  c.save();
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.globalCompositeOperation = 'overlay';
  c.globalAlpha = Math.min(1, amt / 40);
  c.translate(-ox, -oy);
  c.fillStyle = pat;
  c.fillRect(x + ox, y + oy, w, h);
  c.restore();
}

// Scratches, smudges and edge grime over a region
function wear(c, x, y, w, h, seed = 1, k = 1, o = {}) {
  const r = new RNG(seed);
  c.save();
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  const n = Math.round((w * h) / 2500 * k);
  for (let i = 0; i < n; i++) {
    const light = r.next() < (o.lightRatio ?? 0.5);
    c.strokeStyle = light ? `rgba(255,255,255,${r.range(0.08, 0.3)})` : `rgba(30,20,10,${r.range(0.06, 0.22)})`;
    c.lineWidth = r.range(0.5, 1.6);
    const sx = x + r.next() * w, sy = y + r.next() * h, a = r.next() * PI, l = r.range(3, 22);
    c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l); c.stroke();
  }
  for (let i = 0; i < Math.round(n / 6) + 1; i++) {
    const sx = x + r.next() * w, sy = y + r.next() * h, rad = r.range(6, 30) * (o.smudge ?? 1);
    const g = c.createRadialGradient(sx, sy, 0, sx, sy, rad);
    g.addColorStop(0, `rgba(40,30,15,${r.range(0.04, 0.12) * (o.dirt ?? 1)})`);
    g.addColorStop(1, 'rgba(40,30,15,0)');
    c.fillStyle = g;
    c.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
  }
  if (o.edge !== false) {
    const e = Math.min(w, h) * 0.08;
    const gs = [
      [x, y, x + e, y, x, y, e, h], [x + w, y, x + w - e, y, x + w - e, y, e, h],
      [x, y, x, y + e, x, y, w, e], [x, y + h, x, y + h - e, x, y + h - e, w, e],
    ];
    for (const [x0, y0, x1, y1, rx, ry, rw, rh] of gs) {
      const g = c.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, `rgba(30,22,10,${0.18 * (o.edgeK ?? 1)})`);
      g.addColorStop(1, 'rgba(30,22,10,0)');
      c.fillStyle = g;
      c.fillRect(rx, ry, rw, rh);
    }
  }
  c.restore();
}

function barcode(c, x, y, w, h, seed = 3, digits = true) {
  const r = new RNG(seed);
  rect(c, x, y, w, h, '#fff');
  const bh = digits ? h * 0.78 : h;
  let px = x + w * 0.06;
  c.fillStyle = '#111';
  while (px < x + w * 0.94) {
    const bw = r.int(1, 3) * w / 110;
    if (r.next() < 0.55) c.fillRect(px, y + h * 0.05, bw, bh - h * 0.05);
    px += bw + r.int(1, 2) * w / 140;
  }
  if (digits) {
    let s = '';
    for (let i = 0; i < 12; i++) s += r.int(0, 9);
    txt(c, s.replace(/(\d)(\d{5})(\d{5})(\d)/, '$1 $2 $3 $4'), x + w / 2, y + h * 0.9, { size: h * 0.17, fam: MONO, weight: 'normal', maxW: w * 0.92 });
  }
}

// R.O.O.M. corporate mark: one-point-perspective room (floor, walls, ceiling, back door)
function roomIcon(c, cx, cy, s, fg = '#111', bg = null, lw = 0.085) {
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
function brand(c, x, y, size, fg = '#111', o = {}) {
  const icon = size * 1.0;
  c.save();
  c.font = fontStr(size, { fam: o.fam || SANS, weight: o.weight ?? '900' });
  const label = o.text || 'R.O.O.M.';
  const tw = c.measureText(label).width;
  const total = icon + size * 0.35 + tw;
  let x0 = o.align === 'left' ? x : x - total / 2;
  roomIcon(c, x0 + icon / 2, y, icon * 0.86, fg, null, 0.1);
  txt(c, label, x0 + icon + size * 0.35, y + size * 0.04, { size, color: fg, align: 'left', fam: o.fam || SANS, weight: o.weight ?? '900' });
  if (o.sub) txt(c, o.sub, x0 + icon + size * 0.35, y + size * 0.78, { size: size * 0.38, color: fg, align: 'left', fam: MONO, weight: 'bold', ls: size * 0.04 });
  c.restore();
  return total;
}

function hazardStripes(c, x, y, w, h, s = 20, a = '#f2c418', b = '#151515') {
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
function biohazard(c, cx, cy, r, col = '#111') {
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

function flameIcon(c, cx, cy, s, col = '#111') {
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

function hazardDiamond(c, cx, cy, s, bg = '#d22', fg = '#fff', label = 'FLAMMABLE', icon = 'flame') {
  c.save();
  c.translate(cx, cy);
  c.rotate(PI / 4);
  rect(c, -s / 2, -s / 2, s, s, bg);
  c.lineWidth = s * 0.035; c.strokeStyle = fg;
  c.strokeRect(-s * 0.44, -s * 0.44, s * 0.88, s * 0.88);
  c.restore();
  if (icon === 'flame') flameIcon(c, cx, cy - s * 0.17, s * 0.36, fg);
  if (label) txt(c, label, cx, cy + s * 0.2, { size: s * 0.11, color: fg, maxW: s * 0.62 });
}

// Wood with grain running along canvas X
function woodGrain(c, x, y, w, h, o = {}) {
  const r = new RNG(o.seed || 7);
  c.save();
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  rect(c, x, y, w, h, o.base || '#d8b47e');
  // broad tone bands
  for (let i = 0; i < 5; i++) {
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
    c.strokeStyle = dark ? `rgba(${o.dark || '110,62,22'},${r.range(0.08, 0.32)})` : `rgba(255,240,205,${r.range(0.05, 0.15)})`;
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

function endGrain(c, x, y, w, h, o = {}) {
  const r = new RNG(o.seed || 9);
  c.save();
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  rect(c, x, y, w, h, o.base || '#c99e66');
  const cx = x + w * (o.cx ?? 0.5), cy = y + h * (o.cy ?? 1.6);
  for (let k = 0; k < 60; k++) {
    const rad = k * Math.max(w, h) * 0.06 + r.next() * 2;
    c.strokeStyle = `rgba(110,62,22,${r.range(0.12, 0.35)})`;
    c.lineWidth = r.range(1, 3);
    c.beginPath(); c.arc(cx, cy, rad, 0, TAU); c.stroke();
  }
  c.restore();
  noise(c, x, y, w, h, 18, o.seed || 9);
}

// Chubby R.O.O.M. clone in hazmat suit (for ID photos, posters, carton backs)
function drawClone(c, cx, cy, s, o = {}) {
  const suit = o.suit || '#f2c418', dark = o.dark || '#a07c08';
  c.save();
  c.translate(cx, cy);
  c.scale(s / 100, s / 100);
  c.lineWidth = 3; c.strokeStyle = dark;
  // body
  c.fillStyle = suit;
  c.beginPath(); c.ellipse(0, 52, 48, 40, 0, 0, TAU); c.fill(); c.stroke();
  // arms
  c.beginPath(); c.ellipse(-46, 52, 12, 22, 0.35, 0, TAU); c.fill(); c.stroke();
  c.beginPath(); c.ellipse(46, 52, 12, 22, -0.35, 0, TAU); c.fill(); c.stroke();
  // hood
  c.beginPath(); c.ellipse(0, -2, 44, 42, 0, 0, TAU); c.fill(); c.stroke();
  // visor
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
  // chest badge
  c.fillStyle = '#fff'; c.fillRect(-12, 46, 24, 14);
  roomIcon(c, 0, 53, 9, '#111', null, 0.12);
  c.restore();
}

// Almond illustration
function almond(c, cx, cy, s, rot = 0) {
  c.save();
  c.translate(cx, cy); c.rotate(rot);
  const g = c.createRadialGradient(-s * 0.15, -s * 0.2, s * 0.05, 0, 0, s * 0.7);
  g.addColorStop(0, '#d79a5e'); g.addColorStop(0.6, '#a8642f'); g.addColorStop(1, '#6e3a16');
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
  c.restore();
}

function leaf(c, cx, cy, s, rot, col = '#5c8a3a') {
  c.save(); c.translate(cx, cy); c.rotate(rot);
  c.fillStyle = col;
  c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(s * 0.5, -s * 0.35, s, 0); c.quadraticCurveTo(s * 0.5, s * 0.35, 0, 0); c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = s * 0.04;
  c.beginPath(); c.moveTo(0, 0); c.lineTo(s * 0.9, 0); c.stroke();
  c.restore();
}

function scribble(c, x, y, w, seed, col = 'rgba(30,40,110,0.85)', lw = 2) {
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

function checkmark(c, x, y, s, col = 'rgba(30,40,110,0.9)') {
  c.save(); c.strokeStyle = col; c.lineWidth = s * 0.18; c.lineCap = 'round';
  c.beginPath(); c.moveTo(x - s * 0.4, y); c.lineTo(x - s * 0.1, y + s * 0.35); c.lineTo(x + s * 0.5, y - s * 0.45); c.stroke(); c.restore();
}

// ---------------------------------------------------------------------------
// Atlases & materials
// ---------------------------------------------------------------------------
const atlasCache = new Map();

// Creates (once) a canvas atlas. `draw(ctx, W, H)`; the bottom-right 64px block is reserved as
// a near-white scuffed "plain" swatch that untextured parts map into (tinted by vertex colour).
function atlas(key, W, H, draw, opt = {}) {
  if (atlasCache.has(key)) return atlasCache.get(key);
  const R = (x, y, w, h, rot = 0, inset = 0.75) => [(x + inset) / W, 1 - (y + h - inset) / H, (x + w - inset) / W, 1 - (y + inset) / H, rot];
  const tex = labelTexture(W, H, (c) => {
    if (opt.clear) { draw(c, W, H); return; }
    rect(c, 0, 0, W, H, '#ffffff');
    draw(c, W, H);
    // plain swatch
    rect(c, W - 64, H - 64, 64, 64, '#f4f4f4');
    noise(c, W - 64, H - 64, 64, 64, 10, 99);
    wear(c, W - 64, H - 64, 64, 64, 5, 2.5, { edge: false, smudge: 0.4, dirt: 0.6 });
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  const a = { key, tex, W, H, R, plain: R(W - 60, H - 60, 56, 56) };
  atlasCache.set(key, a);
  return a;
}

// Vertex-coloured material that samples an atlas. Parts without explicit UVs land in the plain swatch.
function paint(A, o = {}) {
  const m = new THREE.MeshStandardMaterial({
    map: A.tex,
    vertexColors: true,
    roughness: o.rough ?? 0.55,
    metalness: o.metal ?? 0,
    side: o.side ?? THREE.FrontSide,
  });
  if (o.transparent) { m.transparent = true; m.opacity = o.opacity ?? 1; m.depthWrite = o.depthWrite ?? false; }
  if (o.alphaTest) m.alphaTest = o.alphaTest;
  if (o.emissive !== undefined) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.emissiveIntensity ?? 1; m.emissiveMap = o.emissiveMap ? A.tex : null; }
  if (o.envMapIntensity !== undefined) m.envMapIntensity = o.envMapIntensity;
  m.userData.plain = A.plain;
  m.name = `${A.key}_paint`;
  return m;
}

const sharedMats = new Map();
function smat(key, make) {
  if (!sharedMats.has(key)) sharedMats.set(key, make());
  return sharedMats.get(key);
}
// commonly used simple materials (shared by all items)
const M = {
  alu: () => smat('alu', () => new THREE.MeshStandardMaterial({ name: 'item_alu', color: 0xd4d7da, metalness: 1, roughness: 0.27 })),
  steel: () => Mat.get('steel'),
  chrome: () => Mat.get('chrome'),
  brass: () => Mat.get('brass'),
  rubber: () => Mat.get('rubber'),
  glass: () => Mat.get('glass'),
  darkSteel: () => smat('darkSteel', () => new THREE.MeshStandardMaterial({ name: 'item_darksteel', color: 0x55585c, metalness: 1, roughness: 0.42 })),
  clearPlastic: () => smat('clearPlastic', () => new THREE.MeshPhysicalMaterial({ name: 'item_clearplastic', color: 0xe8f2f2, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.28, envMapIntensity: 1.5, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.05 })),
};

// ---------------------------------------------------------------------------
// Geometry builder ("kit")
// ---------------------------------------------------------------------------
const _eu = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function mtx(o = {}, out = new THREE.Matrix4()) {
  _eu.set(o.r?.[0] || 0, o.r?.[1] || 0, o.r?.[2] || 0, o.order || 'XYZ');
  _q.setFromEuler(_eu);
  const s = o.s ?? 1;
  if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
  _p.set(o.p?.[0] || 0, o.p?.[1] || 0, o.p?.[2] || 0);
  return out.compose(_p, _q, _s);
}

const FACE = { px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5, side: 0, top: 1, bottom: 2 };

function mapRect(uv, i, rect) {
  let u = uv.getX(i), v = uv.getY(i);
  const rot = rect[4] || 0;
  if (rot === 1) [u, v] = [v, 1 - u];
  else if (rot === 2) [u, v] = [1 - u, 1 - v];
  else if (rot === 3) [u, v] = [1 - v, u];
  else if (rot === 4) u = 1 - u; // mirror
  uv.setXY(i, rect[0] + u * (rect[2] - rect[0]), rect[1] + v * (rect[3] - rect[1]));
}

// Smooth normals on a non-indexed geometry by welding positions
function smoothNormals(g, eps = 1e-4) {
  const pos = g.attributes.position;
  const nrm = g.attributes.normal || new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3);
  const acc = new Map();
  const a = V3(), b = V3(), cc = V3(), fn = V3();
  const key = (i) => `${Math.round(pos.getX(i) / eps)},${Math.round(pos.getY(i) / eps)},${Math.round(pos.getZ(i) / eps)}`;
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); cc.fromBufferAttribute(pos, i + 2);
    fn.subVectors(cc, b).cross(a.clone().sub(b));
    for (let k = 0; k < 3; k++) {
      const kk = key(i + k);
      if (!acc.has(kk)) acc.set(kk, V3());
      acc.get(kk).add(fn);
    }
  }
  for (let i = 0; i < pos.count; i++) {
    const n = acc.get(key(i)).clone().normalize();
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  g.setAttribute('normal', nrm);
  return g;
}

class Kit {
  constructor() {
    this.items = [];
    this.cols = [];
    this.anchors = {};
    this.pivots = {};
    this.frame = new THREE.Matrix4();
    this.stack = [];
  }
  push(o) { this.stack.push(this.frame.clone()); this.frame.multiply(mtx(o)); return this; }
  pop() { this.frame = this.stack.pop(); return this; }

  // o: p,r,s (transform) | uv rect | faces {px:rect,...} | uvFn(p,n)->[u,v] | vFromY [y0,y1] (+uRect)
  //    col (hex or fn(p)->hex) | deform(v) | smooth | flat | part | clone | shadow
  add(geo, mat, o = {}) {
    let g = geo;
    if (o.deform) {
      const pos = g.attributes.position, v = V3();
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); o.deform(v, i); pos.setXYZ(i, v.x, v.y, v.z); }
      if (g.index) g.computeVertexNormals();
    }
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (o.flat) { g.deleteAttribute('normal'); g.computeVertexNormals(); }
    if (o.smooth || (o.deform && !geo.index)) smoothNormals(g);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const uv = g.attributes.uv, pos = g.attributes.position, nrm = g.attributes.normal;
    const n = pos.count;
    if (o.uvFn) {
      const p = V3(), nn = V3();
      for (let i = 0; i < n; i++) {
        p.fromBufferAttribute(pos, i); nn.fromBufferAttribute(nrm, i);
        const r = o.uvFn(p, nn, uv.getX(i), uv.getY(i));
        uv.setXY(i, r[0], r[1]);
      }
    } else if (o.vFromY) {
      const [y0, y1] = o.vFromY;
      for (let i = 0; i < n; i++) uv.setY(i, (pos.getY(i) - y0) / (y1 - y0));
      if (o.uv) for (let i = 0; i < n; i++) mapRect(uv, i, o.uv);
    } else if (o.faces) {
      const groups = g.groups.length ? g.groups : [{ start: 0, count: n, materialIndex: 0 }];
      const byIdx = {};
      for (const k in o.faces) byIdx[FACE[k] ?? +k] = o.faces[k];
      for (const gr of groups) {
        const rct = byIdx[gr.materialIndex] ?? o.uv ?? mat.userData?.plain;
        if (!rct) continue;
        for (let i = gr.start; i < gr.start + gr.count; i++) mapRect(uv, i, rct);
      }
    } else if (o.uv) {
      for (let i = 0; i < n; i++) mapRect(uv, i, o.uv);
    } else if (mat.userData?.plain && !o.keepUV) {
      for (let i = 0; i < n; i++) mapRect(uv, i, mat.userData.plain);
    }
    g.clearGroups();
    g.applyMatrix4(this.frame.clone().multiply(mtx(o)));
    if (mat.vertexColors) {
      const col = new Float32Array(n * 3);
      const cc = new THREE.Color();
      const p = V3();
      for (let i = 0; i < n; i++) {
        let h = o.col ?? 0xffffff;
        if (typeof h === 'function') { p.fromBufferAttribute(pos, i); h = h(p); }
        cc.set(h);
        col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    this.items.push({ g, mat, part: o.part, clone: o.clone, shadow: o.shadow, bounds: o.bounds !== false });
    return g;
  }

  box(w, h, d, mat, o = {}) { return this.add(new THREE.BoxGeometry(w, h, d, o.sx || 1, o.sy || 1, o.sz || 1), mat, o); }
  rbox(w, h, d, r, mat, o = {}) { return this.add(new RoundedBoxGeometry(w, h, d, o.rs ?? 2, r), mat, o); }
  cyl(rt, rb, h, mat, o = {}) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, o.seg ?? 24, o.hseg ?? 1, o.open ?? false, o.ts ?? PI, o.tl ?? TAU), mat, o);
  }
  // pts: [[r, y, sharp?], ...] bottom -> top for outward normals; sharp duplicates the point (hard edge)
  lathe(pts, mat, o = {}) {
    const v = [];
    for (const p of pts) { v.push(new THREE.Vector2(Math.max(p[0], 1e-5), p[1])); if (p[2]) v.push(new THREE.Vector2(Math.max(p[0], 1e-5), p[1])); }
    return this.add(new THREE.LatheGeometry(v, o.seg ?? 24, o.ps ?? PI, o.pl ?? TAU), mat, o);
  }
  sphere(r, mat, o = {}) { return this.add(new THREE.SphereGeometry(r, o.ws ?? 16, o.hs ?? 12, o.ps ?? 0, o.pl ?? TAU, o.ts ?? 0, o.tl ?? PI), mat, o); }
  torus(R, r, mat, o = {}) { return this.add(new THREE.TorusGeometry(R, r, o.rseg ?? 8, o.tseg ?? 24, o.arc ?? TAU), mat, o); }
  tube(points, r, mat, o = {}) {
    const curve = points instanceof THREE.Curve ? points : new THREE.CatmullRomCurve3(points.map((p) => V3(...p)), false, 'catmullrom', o.tension ?? 0.5);
    return this.add(new THREE.TubeGeometry(curve, o.tseg ?? 32, r, o.rseg ?? 8, false), mat, o);
  }

  _xpos(p) { return V3(...p).applyMatrix4(this.frame); }
  _xrot(r) {
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(this.frame));
    q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...(r || [0, 0, 0]))));
    const e = new THREE.Euler().setFromQuaternion(q);
    return [e.x, e.y, e.z];
  }
  colBox(size, pos = [0, 0, 0], rot) { this.cols.push({ type: 'box', size: [...size], pos: this._xpos(pos), rot: this._xrot(rot) }); return this; }
  colCyl(radius, height, pos = [0, 0, 0], rot) { this.cols.push({ type: 'cylinder', radius, height, pos: this._xpos(pos), rot: this._xrot(rot) }); return this; }
  colBall(radius, pos = [0, 0, 0]) { this.cols.push({ type: 'ball', radius, pos: this._xpos(pos) }); return this; }
  anchor(name, p) { this.anchors[name] = this._xpos(p); return this; }
  pivot(part, p) { this.pivots[part] = this._xpos(p); return this; }
}

// Pillow / sheet surfaces (indexed so normals are smooth). f(u,v) -> [x,y,z]
function sheetGeo(nu, nv, f) {
  const pos = [], uvs = [], idx = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv;
      pos.push(...f(u, v));
      uvs.push(u, v);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Planar polygon (convex, CCW seen from the front) with explicit per-vertex UVs
function polyGeo(verts, uvs) {
  const pos = [], uv = [];
  for (let i = 1; i < verts.length - 1; i++) {
    for (const k of [0, i, i + 1]) { pos.push(...verts[k]); uv.push(...uvs[k]); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// Planar swept tube along a path in the XZ plane (binormal = +Y). prof(t) -> {rx, ry, dy?}
// o: { seg, sides, rot0, t0, t1, cap0, cap1 }. UV: u along the [t0,t1] range, v around (v=0.25 is +Y).
function sweepGeo(path, prof, o = {}) {
  const seg = o.seg ?? 40, sides = o.sides ?? 6, rot0 = o.rot0 ?? 0, t0 = o.t0 ?? 0, t1 = o.t1 ?? 1;
  const pos = [], uvs = [], idx = [];
  const T = V3(), N = V3(), Y = V3(0, 1, 0), P = V3();
  const ringT = [];
  for (let i = 0; i <= seg; i++) {
    const t = t0 + (t1 - t0) * (i / seg);
    ringT.push(t);
    path.getPointAt(t, P);
    path.getTangentAt(Math.min(0.9995, Math.max(0.0005, t)), T);
    N.crossVectors(T, Y).normalize();
    const { rx, ry, dy = 0 } = prof(t);
    for (let k = 0; k <= sides; k++) {
      const a = rot0 + (k / sides) * TAU;
      pos.push(P.x + N.x * Math.cos(a) * rx, P.y + Math.sin(a) * ry + dy, P.z + N.z * Math.cos(a) * rx);
      uvs.push(i / seg, k / sides);
    }
  }
  const row = sides + 1;
  for (let i = 0; i < seg; i++) {
    for (let k = 0; k < sides; k++) {
      const a = i * row + k, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const caps = [];
  if (o.cap0 !== false) caps.push([0, false]);
  if (o.cap1 !== false) caps.push([seg, true]);
  for (const [i, flip] of caps) {
    const base = pos.length / 3;
    path.getPointAt(ringT[i], P);
    const { dy = 0 } = prof(ringT[i]);
    pos.push(P.x, P.y + dy, P.z); uvs.push(i / seg, 0.5);
    for (let k = 0; k < sides; k++) {
      const a = i * row + k, b = i * row + k + 1;
      if (flip) idx.push(base, a, b); else idx.push(base, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Polyline curve (arc-length parameterised by THREE.Curve helpers)
class PolyCurve extends THREE.Curve {
  constructor(points) { super(); this.pts = points.map((p) => (p.isVector3 ? p : V3(...p))); this.arcLengthDivisions = 400; }
  getPoint(t, out = new THREE.Vector3()) {
    const n = this.pts.length - 1;
    const f = Math.min(n - 1e-6, Math.max(0, t * n));
    const i = Math.floor(f);
    return out.lerpVectors(this.pts[i], this.pts[i + 1], f - i);
  }
}

class HelixCurve extends THREE.Curve {
  constructor(r, h, turns) { super(); this.r = r; this.h = h; this.turns = turns; }
  getPoint(t, out = new THREE.Vector3()) {
    const a = t * this.turns * TAU;
    return out.set(Math.cos(a) * this.r, t * this.h, Math.sin(a) * this.r);
  }
}

// ExtrudeGeometry helper: shape in XY extruded along +Z by depth (with bevel), centred in Z.
function extrudeGeo(shape, depth, bevel = 0, o = {}) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: o.bevelSize ?? bevel, bevelSegments: o.bevelSegments ?? 2,
    curveSegments: o.curveSegments ?? 12, steps: 1,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

// ---------------------------------------------------------------------------
// Finishing, caching and instancing
// ---------------------------------------------------------------------------
function colliderMinY(c) {
  if (c.type === 'ball') return c.pos.y - c.radius;
  const e = new THREE.Euler(...(c.rot || [0, 0, 0]));
  const m = new THREE.Matrix4().makeRotationFromEuler(e);
  const pts = [];
  if (c.type === 'box') {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push(V3(sx * c.size[0] / 2, sy * c.size[1] / 2, sz * c.size[2] / 2));
  } else {
    for (let k = 0; k < 16; k++) for (const sy of [-1, 1]) pts.push(V3(Math.cos(k / 16 * TAU) * c.radius, sy * c.height / 2, Math.sin(k / 16 * TAU) * c.radius));
  }
  let mn = Infinity;
  for (const p of pts) mn = Math.min(mn, p.applyMatrix4(m).y);
  return c.pos.y + mn;
}

// meta: { mass, material, hold:{grip:[x,y,z] (kit coords), rot:[..], off?:[..]}, center?:[..], init?(inst, opts) }
function finish(name, kit, meta) {
  const bb = new THREE.Box3();
  for (const it of kit.items) { it.g.computeBoundingBox(); if (it.bounds) bb.union(it.g.boundingBox); }
  const c = meta.center ? V3(...meta.center) : bb.getCenter(V3());
  for (const it of kit.items) it.g.translate(-c.x, -c.y, -c.z);
  const map = new Map();
  for (const it of kit.items) {
    const k = `${it.mat.uuid}|${it.part || ''}`;
    if (!map.has(k)) map.set(k, { mat: it.mat, part: it.part, clone: !!it.clone || !!it.part, shadow: it.shadow, geos: [] });
    map.get(k).geos.push(it.g);
  }
  const groups = [];
  for (const gr of map.values()) {
    const geo = gr.geos.length === 1 ? gr.geos[0] : mergeGeometries(gr.geos, false);
    if (!geo) throw new Error(`models_items: merge failed for ${name} (${gr.mat.name})`);
    const pivot = V3();
    if (gr.part) {
      if (kit.pivots[gr.part]) pivot.copy(kit.pivots[gr.part]).sub(c);
      else { geo.computeBoundingBox(); geo.boundingBox.getCenter(pivot); }
      geo.translate(-pivot.x, -pivot.y, -pivot.z);
    }
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    groups.push({ geo, mat: gr.mat, part: gr.part, clone: gr.clone, shadow: gr.shadow, pivot, tris: geo.attributes.position.count / 3 });
  }
  const colliders = kit.cols.map((k) => ({ ...k, pos: k.pos.clone().sub(c) }));
  const size = bb.getSize(V3());
  let halfHeight = c.y - bb.min.y;
  if (colliders.length) halfHeight = -Math.min(...colliders.map(colliderMinY));
  const anchors = {};
  for (const k in kit.anchors) anchors[k] = kit.anchors[k].clone().sub(c);
  let hold = { pos: [0, 0, 0], rot: [0, 0, 0] };
  if (meta.hold) {
    const rot = meta.hold.rot || [0, 0, 0];
    const g = V3(...(meta.hold.grip || [c.x, c.y, c.z])).sub(c).applyEuler(new THREE.Euler(...rot));
    const off = meta.hold.off || [0, 0, 0];
    hold = { pos: [off[0] - g.x, off[1] - g.y, off[2] - g.z].map((v) => +v.toFixed(4)), rot: rot.map((v) => +v.toFixed(4)) };
  }
  return {
    name, groups, colliders, anchors, hold, halfHeight: +halfHeight.toFixed(4),
    size: [size.x, size.y, size.z].map((v) => +v.toFixed(4)),
    mass: meta.mass, material: meta.material, init: meta.init,
    tris: groups.reduce((a, g) => a + g.tris, 0),
  };
}

const templateCache = new Map();
const builders = {};
const variantKeys = {};

function instantiate(T, opts) {
  const object = new THREE.Group();
  object.name = `item_${T.name}`;
  const parts = {};
  for (const gr of T.groups) {
    const mat = gr.clone ? gr.mat.clone() : gr.mat;
    const mesh = new THREE.Mesh(gr.geo, mat);
    mesh.position.copy(gr.pivot);
    mesh.castShadow = gr.shadow ?? !(mat.transparent || mat.blending === THREE.AdditiveBlending);
    mesh.receiveShadow = !mat.transparent;
    if (gr.part) {
      mesh.name = gr.part;
      if (parts[gr.part]) {
        // several materials in one part -> wrap in a group
        const prev = parts[gr.part];
        if (!prev.isGroup) {
          const grp = new THREE.Group(); grp.name = gr.part;
          object.add(grp); grp.add(prev);
          parts[gr.part] = grp;
        }
        parts[gr.part].add(mesh);
        continue;
      }
      parts[gr.part] = mesh;
    }
    object.add(mesh);
  }
  const anchors = {};
  for (const k in T.anchors) anchors[k] = T.anchors[k].clone();
  const inst = {
    object,
    colliders: T.colliders.map((c) => {
      const o = { ...c, pos: [c.pos.x, c.pos.y, c.pos.z].map((v) => +v.toFixed(4)) };
      if (c.rot) o.rot = [...c.rot];
      if (c.size) o.size = [...c.size];
      return o;
    }),
    mass: T.mass,
    material: T.material,
    halfHeight: T.halfHeight,
    hold: { pos: [...T.hold.pos], rot: [...T.hold.rot] },
    anchors,
    parts,
    size: [...T.size],
  };
  object.userData.item = T.name;
  T.init?.(inst, opts);
  return inst;
}

function getTemplate(name, opts) {
  const vk = variantKeys[name] ? variantKeys[name](opts) : '';
  const key = `${name}#${vk}`;
  if (!templateCache.has(key)) {
    const { kit, meta } = builders[name](opts);
    templateCache.set(key, finish(name, kit, meta));
  }
  return templateCache.get(key);
}

export const ITEMS = {};

function def(name, build, variantKey) {
  builders[name] = build;
  if (variantKey) variantKeys[name] = variantKey;
  ITEMS[name] = (opts = {}) => instantiate(getTemplate(name, opts), opts);
}

export function buildItem(name, opts) {
  const f = ITEMS[name];
  if (!f) throw new Error(`Unknown item '${name}'`);
  const inst = f(opts || {});
  inst.object.traverse((o) => {
    if (o.isMesh && o.castShadow === undefined) o.castShadow = true;
  });
  return inst;
}

// Build (and cache) templates ahead of time, e.g. on a loading screen after web fonts have loaded
// (labels are drawn with "IBM Plex Mono"/"VT323"; building earlier bakes fallback fonts into the cache).
export function preloadItems(names = Object.keys(ITEMS), opts = {}) {
  for (const n of names) getTemplate(n, opts);
}

// Triangle count / mesh stats for a template (debug)
export function itemStats(name, opts = {}) {
  const T = getTemplate(name, opts);
  return { name, meshes: T.groups.length, tris: T.tris, perMesh: T.groups.map((g) => `${g.part || g.mat.name || g.mat.type}:${g.tris}`) };
}

export const ITEM_NAMES = () => Object.keys(ITEMS);

// ===========================================================================
// ITEM DEFINITIONS
// ===========================================================================

const ROOM_YELLOW = '#f2c418';
const INK = '#151515';
const NAVY = '#222a40';

// ---------------------------------------------------------------- flashlight
def('flashlight', () => {
  const A = atlas('flashlight', 512, 512, (c) => {
    // body wrap: x = around (u=0.5 top), y = along length (head at top); drawn in a 512x512
    // design space squeezed into the top 448px (the bottom-right block is the plain swatch)
    c.save();
    c.scale(1, 448 / 512);
    rect(c, 0, 0, 512, 512, '#efbf1c');
    noise(c, 0, 0, 512, 512, 8, 11);
    // head hazard ring + body band
    hazardStripes(c, 0, 0, 512, 22, 16, '#efbf1c', INK);
    rect(c, 0, 166, 512, 9, INK);
    rect(c, 0, 308, 512, 8, INK);
    // top: logo + model name (reads tail -> head)
    roomIcon(c, 256, 285, 30, INK, null, 0.11);
    txt(c, 'ROOM-LITE 3000', 256, 215, { size: 30, rot: -PI / 2, maxW: 105, color: INK, fam: SANS, weight: '900' });
    // sides
    txt(c, 'R.O.O.M. CORP', 128, 242, { size: 34, rot: PI / 2, maxW: 120, color: INK, weight: '900' });
    txt(c, 'R.O.O.M. CORP', 384, 242, { size: 34, rot: -PI / 2, maxW: 120, color: INK, weight: '900' });
    txt(c, 'PROPERTY OF R.O.O.M.', 70, 242, { size: 14, rot: PI / 2, maxW: 118, color: INK, fam: MONO });
    txt(c, 'PROPERTY OF R.O.O.M.', 442, 242, { size: 14, rot: -PI / 2, maxW: 118, color: INK, fam: MONO });
    // head: serial + warning
    txt(c, 'DO NOT LOOK INTO BEAM', 256, 60, { size: 17, color: INK, fam: MONO, maxW: 230 });
    txt(c, 'SN 0451-B  •  6V', 256, 120, { size: 15, color: INK, fam: MONO, maxW: 200 });
    wear(c, 0, 0, 512, 512, 21, 2.2, { edge: false });
    c.restore();
    rect(c, 0, 448, 448, 64, '#efbf1c');
  });
  const yellow = paint(A, { rough: 0.38 });
  const lensMat = new THREE.MeshStandardMaterial({ name: 'flashlight_lens', color: 0xdfe9f2, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.42, emissive: 0xfff0c8, emissiveIntensity: 0, depthWrite: false });
  const k = new Kit();
  k.push({ r: [-PI / 2, 0, 0] }); // build along +Y, tail at y=0 -> beam toward -Z
  // tail cap + button
  k.lathe([[0, -0.005], [0.008, -0.0045], [0.0105, -0.0015], [0.0115, 0, 1], [0.017, 0.001], [0.0205, 0.005], [0.0205, 0.026], [0.0196, 0.029]], M.rubber(), { seg: 24 });
  // body + neck + head shell
  k.lathe([[0.0196, 0.027, 1], [0.0196, 0.166], [0.0215, 0.175], [0.0285, 0.19], [0.0335, 0.2], [0.0348, 0.207], [0.0348, 0.236, 1], [0.0300, 0.236]], yellow, { seg: 28, vFromY: [0.028, 0.236], uv: A.R(0, 0, 512, 448) });
  // rubber grip sleeve with ridges
  const grip = [[0.0196, 0.033, 1], [0.0212, 0.035]];
  for (let i = 0; i < 8; i++) {
    const y = 0.0365 + i * 0.0086;
    grip.push([0.0208, y + 0.0007], [0.0216, y + 0.0022], [0.0216, y + 0.0055], [0.0208, y + 0.0070]);
  }
  grip.push([0.0212, 0.107], [0.0196, 0.109]);
  k.lathe(grip, M.rubber(), { seg: 20 });
  // bezel
  k.lathe([[0.0346, 0.232, 1], [0.0366, 0.233], [0.0370, 0.245], [0.0358, 0.2485, 1], [0.0298, 0.2485, 1], [0.0293, 0.2445]], M.rubber(), { seg: 28 });
  // reflector bowl (concave side faces the lens)
  k.lathe([[0.0296, 0.2445], [0.026, 0.236], [0.019, 0.226], [0.011, 0.218], [0.0062, 0.2145]], M.chrome(), { seg: 24 });
  // bulb + lens (part)
  k.sphere(0.0042, lensMat, { p: [0, 0.2185, 0], part: 'lens' });
  k.add(new THREE.CircleGeometry(0.0296, 28), lensMat, { p: [0, 0.2442, 0], r: [-PI / 2, 0, 0], part: 'lens' });
  k.pivot('lens', [0, 0.2442, 0]);
  // switch boot + guard on top (+Z here -> +Y final)
  k.rbox(0.019, 0.026, 0.006, 0.0025, yellow, { p: [0, 0.147, 0.0186], col: 0xd8a810 });
  k.rbox(0.012, 0.016, 0.007, 0.003, M.rubber(), { p: [0, 0.147, 0.0205], rs: 1 });
  // lanyard lug + ring under the tail
  k.rbox(0.007, 0.012, 0.007, 0.002, M.rubber(), { p: [0, 0.014, -0.0215], rs: 1 });
  k.torus(0.0065, 0.0011, M.chrome(), { p: [0, 0.012, -0.029], r: [0, PI / 2, 0], tseg: 16, rseg: 6 });
  // colliders
  k.colCyl(0.021, 0.2, [0, 0.1, 0]);
  k.colCyl(0.037, 0.05, [0, 0.223, 0]);
  k.anchor('lens', [0, 0.2448, 0]);
  k.pop();
  return {
    kit: k,
    meta: {
      mass: 0.45, material: 'plastic',
      hold: { grip: [0, 0, -0.072], rot: [0.04, 0.02, 0] },
      init(inst, opts) {
        const lens = inst.parts.lens;
        inst.object.userData.setOn = (on) => {
          lens.material.emissiveIntensity = on ? 4 : 0;
          lens.material.opacity = on ? 0.9 : 0.42;
        };
        if (opts.on) inst.object.userData.setOn(true);
      },
    },
  };
});

// ------------------------------------------------------- wrapped bars (shared)
function wrappedBar(name, dims, drawFront, drawBack, theme, meta) {
  def(name, () => {
    const [L, Hh, D] = dims;
    const A = atlas(name, 512, 512, (c) => {
      drawFront(c, 0, 0, 512, 190);
      drawBack(c, 0, 192, 512, 186);
      // side stripe
      rect(c, 0, 380, 440, 30, theme.side);
      for (let x = 10; x < 440; x += 150) txt(c, theme.sideText, x, 395, { size: 15, color: theme.sideInk, align: 'left', fam: MONO });
      // crimp serration
      rect(c, 0, 412, 440, 40, theme.crimp);
      for (let x = 0; x < 440; x += 5) rect(c, x, 412, 2, 40, 'rgba(255,255,255,0.18)');
      noise(c, 0, 412, 440, 40, 18, 4);
      // end caps
      rect(c, 0, 454, 440, 52, theme.side);
      wear(c, 0, 0, 512, 380, 31, 1.5, { edge: false, lightRatio: 0.7 });
    });
    const wrap = paint(A, { rough: theme.rough ?? 0.42, metal: theme.metal ?? 0.15 });
    const k = new Kit();
    k.rbox(L, Hh, D, Math.min(Hh * 0.42, 0.008), wrap, {
      rs: 3,
      faces: { py: A.R(0, 0, 512, 190), ny: A.R(0, 192, 512, 186, 2), pz: A.R(0, 380, 440, 30), nz: A.R(0, 380, 440, 30), px: A.R(0, 454, 440, 52), nx: A.R(0, 454, 440, 52) },
    });
    // crimped seal fins
    for (const sx of [-1, 1]) {
      k.box(0.012, 0.0025, D + 0.003, wrap, {
        p: [sx * (L / 2 + 0.0045), 0, 0], sx: 3, sz: 14, uv: A.R(0, 412, 440, 40, 1),
        deform: (v) => { v.y += Math.sin(v.z * 900) * 0.0007 + (Math.abs(v.x * sx) > 0.004 ? 0.0004 : 0); },
      });
    }
    k.colBox([L + 0.02, Hh, D + 0.002]);
    return { kit: k, meta: { mass: meta.mass, material: 'paper', hold: { grip: [0, 0, 0], rot: meta.rot || [1.15, 0.18, 0.12], off: [0, 0.02, 0] } } };
  });
}

wrappedBar('protein_bar', [0.118, 0.019, 0.044],
  (c, x, y, w, h) => {
    rect(c, x, y, w, h, '#252b3e');
    roomIcon(c, x + 44, y + 50, 46, ROOM_YELLOW, null, 0.1);
    txt(c, 'PROTEIN+', x + 290, y + 56, { size: 76, color: ROOM_YELLOW, italic: true, weight: '900', maxW: 380 });
    rect(c, x, y + 100, w, 66, '#d6c49c');
    rect(c, x + 22, y + 110, 46, 46, '#c8b07f');
    c.strokeStyle = '#252b3e'; c.lineWidth = 2; c.strokeRect(x + 22, y + 110, 46, 46);
    txt(c, 'CORPORATE RATION', x + 282, y + 121, { size: 26, color: '#252b3e', fam: MONO, maxW: 400 });
    txt(c, 'FLAVOR: BEIGE', x + 282, y + 148, { size: 22, color: '#7a5a2a', fam: MONO, maxW: 400 });
    c.fillStyle = '#c33a2a'; c.beginPath(); c.arc(x + 470, y + 38, 30, 0, TAU); c.fill();
    txt(c, '31g', x + 470, y + 33, { size: 24, color: '#fff', weight: '900' });
    txt(c, 'PROTEIN', x + 470, y + 52, { size: 9, color: '#fff', fam: MONO });
    txt(c, 'R.O.O.M. NUTRITION SERVICES  •  NET WT 60 g', x + w / 2, y + 178, { size: 14, color: '#d6c49c', fam: MONO, maxW: 470 });
  },
  (c, x, y, w, h) => {
    rect(c, x, y, w, h, '#d6c49c');
    rect(c, x, y, w, 34, '#252b3e');
    txt(c, 'PROPERTY OF R.O.O.M. — DO NOT CONSUME IN DIMENSION 0', x + w / 2, y + 17, { size: 15, color: ROOM_YELLOW, fam: MONO, maxW: 490 });
    rrect(c, x + 14, y + 44, 230, 130, 4, '#efe6cf', '#252b3e', 2);
    const rows = ['Nutrition Facts', 'Calories ........ 240', 'Protein ......... 31 g', 'Beige ......... 100% DV', 'Hope ............ 0 g', 'Morale ...... see HR'];
    rows.forEach((s, i) => txt(c, s, x + 24, y + 60 + i * 20, { size: i ? 14 : 17, color: '#252b3e', fam: MONO, align: 'left', weight: i ? 'normal' : 'bold' }));
    barcode(c, x + 280, y + 56, 200, 76, 12);
    txt(c, 'Mfd. for R.O.O.M. Corp., Sublevel 4', x + 380, y + 152, { size: 13, color: '#252b3e', fam: MONO, maxW: 220 });
  },
  { side: '#252b3e', sideInk: ROOM_YELLOW, sideText: 'PROTEIN+ •', crimp: '#2e3550' },
  { mass: 0.06 });

wrappedBar('candy_bar', [0.112, 0.017, 0.032],
  (c, x, y, w, h) => {
    const g = c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#5a2414'); g.addColorStop(1, '#3a140a');
    c.fillStyle = g; c.fillRect(x, y, w, h);
    c.fillStyle = '#e8b21c';
    c.beginPath(); c.moveTo(x, y + 140); c.bezierCurveTo(x + 150, y + 100, x + 350, y + 180, x + w, y + 120); c.lineTo(x + w, y + h); c.lineTo(x, y + h); c.fill();
    txt(c, 'NOUGAT', x + w / 2, y + 62, { size: 84, color: '#f6e6b0', weight: '900', italic: true, stroke: '#2a0c04', sw: 10, maxW: 440 });
    txt(c, 'NOIR', x + w / 2 + 120, y + 112, { size: 40, color: '#e8b21c', weight: '900', italic: true, maxW: 200 });
    txt(c, 'nougat of uncertain origin', x + 150, y + 116, { size: 18, color: '#f6e6b0', fam: MONO, weight: 'normal', maxW: 260 });
    brand(c, x + w / 2, y + 166, 20, '#3a140a', { fam: SANS });
  },
  (c, x, y, w, h) => {
    rect(c, x, y, w, h, '#f1e6c4');
    txt(c, 'PROPERTY OF R.O.O.M. — DO NOT CONSUME IN DIMENSION 0', x + w / 2, y + 20, { size: 15, color: '#5a2414', fam: MONO, maxW: 490 });
    txt(c, 'INGREDIENTS: SUGAR, CHOCOLATE-TYPE COATING,', x + 16, y + 52, { size: 13, color: '#3a140a', fam: MONO, align: 'left', maxW: 300 });
    txt(c, 'NOUGAT (ORIGIN CLASSIFIED), PEANUTS?', x + 16, y + 70, { size: 13, color: '#3a140a', fam: MONO, align: 'left', maxW: 300 });
    txt(c, '250 kcal  •  1 BAR = 1 SHIFT', x + 16, y + 100, { size: 15, color: '#3a140a', fam: MONO, align: 'left', maxW: 300 });
    barcode(c, x + 330, y + 46, 160, 70, 77);
    txt(c, 'R.O.O.M. CONFECTIONERY DIV.', x + w / 2, y + 150, { size: 18, color: '#5a2414', maxW: 470 });
  },
  { side: '#3a140a', sideInk: '#e8b21c', sideText: 'NOUGAT NOIR •', crimp: '#4a1a0c', rough: 0.35, metal: 0.25 },
  { mass: 0.055 });

// ---------------------------------------------------------------- almond_milk
def('almond_milk', () => {
  const A = atlas('almond_milk', 1024, 512, (c) => {
    const PW = 256, PH = 350;
    // FRONT
    let g = c.createLinearGradient(0, 0, 0, PH);
    g.addColorStop(0, '#6fb8e6'); g.addColorStop(0.55, '#cbe9f8'); g.addColorStop(1, '#ffffff');
    c.fillStyle = g; c.fillRect(0, 0, PW, PH);
    c.fillStyle = '#ffffff';
    c.beginPath(); c.moveTo(0, 210); c.bezierCurveTo(70, 180, 170, 240, PW, 196); c.lineTo(PW, PH); c.lineTo(0, PH); c.fill();
    brand(c, PW / 2, 26, 18, NAVY);
    txt(c, 'ALMOND', PW / 2, 74, { size: 50, color: NAVY, weight: '900', maxW: 230 });
    txt(c, 'MILK', PW / 2, 124, { size: 62, color: '#ffffff', weight: '900', stroke: NAVY, sw: 9, maxW: 210 });
    leaf(c, 90, 218, 50, -2.4); leaf(c, 168, 214, 46, -0.7);
    almond(c, 110, 238, 58, -0.5); almond(c, 150, 242, 60, 0.45);
    txt(c, 'DAIRY-ADJACENT BEVERAGE', PW / 2, 286, { size: 15, color: NAVY, fam: MONO, maxW: 236 });
    txt(c, 'UNSWEETENED • 1/2 PINT (236 mL)', PW / 2, 306, { size: 12, color: NAVY, fam: MONO, weight: 'normal', maxW: 236 });
    rect(c, 0, PH - 26, PW, 26, NAVY);
    txt(c, 'R.O.O.M. NUTRITION SERVICES', PW / 2, PH - 13, { size: 12, color: '#fff', fam: MONO, maxW: 236 });
    // RIGHT side: nutrition + property notice
    let x = 256;
    rect(c, x, 0, PW, PH, '#ffffff');
    rect(c, x, 0, PW, 44, '#6fb8e6');
    txt(c, 'PROPERTY OF R.O.O.M.', x + PW / 2, 22, { size: 20, color: '#fff', weight: '900', maxW: 236 });
    c.strokeStyle = '#111'; c.lineWidth = 3; c.strokeRect(x + 18, 58, PW - 36, 210);
    txt(c, 'Nutrition Facts', x + 28, 78, { size: 22, color: '#111', align: 'left', weight: '900', maxW: 200 });
    const rows = [['Serving size', '1 carton'], ['Calories', '35'], ['Total Fat', '2.5 g'], ['Almonds', 'trace'], ['Sodium', '170 mg'], ['Calcium', '45%'], ['Vitamin E', '50%'], ['Liminality', '12%']];
    rows.forEach(([a, b], i) => {
      c.fillStyle = '#111'; c.fillRect(x + 26, 96 + i * 21, PW - 52, 1.5);
      txt(c, a, x + 28, 108 + i * 21, { size: 14, color: '#111', align: 'left', fam: MONO, weight: i === 1 ? 'bold' : 'normal' });
      txt(c, b, x + PW - 28, 108 + i * 21, { size: 14, color: '#111', align: 'right', fam: MONO });
    });
    txt(c, 'DO NOT CONSUME IN', x + PW / 2, 292, { size: 17, color: '#c0302a', weight: '900', maxW: 230 });
    txt(c, 'DIMENSION 0', x + PW / 2, 314, { size: 22, color: '#c0302a', weight: '900', maxW: 230 });
    txt(c, 'Keep refrigerated, if refrigeration exists.', x + PW / 2, 336, { size: 10, color: '#333', fam: MONO, weight: 'normal', maxW: 236 });
    // BACK: missing employee
    x = 512;
    rect(c, x, 0, PW, PH, '#ffffff');
    rect(c, x, 0, PW, 56, '#c0302a');
    txt(c, 'HAVE YOU SEEN', x + PW / 2, 18, { size: 20, color: '#fff', weight: '900', maxW: 236 });
    txt(c, 'THIS EMPLOYEE?', x + PW / 2, 40, { size: 22, color: '#fff', weight: '900', maxW: 236 });
    rect(c, x + 58, 70, 140, 150, '#d9d4c4');
    c.strokeStyle = '#111'; c.lineWidth = 2; c.strokeRect(x + 58, 70, 140, 150);
    drawClone(c, x + 128, 132, 92, { face: true });
    txt(c, 'CLONE #4471', x + PW / 2, 238, { size: 20, color: '#111', weight: '900' });
    const lines = ['Last seen: Level 0, near the', 'humming lights. Answers to', '"Hey you". Do not approach.', 'Report sightings: ext. 0000'];
    lines.forEach((s, i) => txt(c, s, x + PW / 2, 262 + i * 18, { size: 13, color: '#222', fam: MONO, weight: 'normal', maxW: 236 }));
    rect(c, x, PH - 16, PW, 16, '#6fb8e6');
    // LEFT side: barcode, dates
    x = 768;
    rect(c, x, 0, PW, PH, '#e9f5fc');
    almond(c, x + 70, 70, 70, -0.4); almond(c, x + 120, 76, 74, 0.3); leaf(c, x + 150, 60, 54, -0.6);
    txt(c, 'ALMOND MILK', x + PW / 2, 140, { size: 30, color: NAVY, weight: '900', maxW: 230 });
    txt(c, 'BEST BEFORE: ∞', x + PW / 2, 176, { size: 18, color: '#111', fam: MONO });
    txt(c, 'LOT 0000-A  •  SUBLEVEL 2', x + PW / 2, 198, { size: 12, color: '#333', fam: MONO, weight: 'normal' });
    barcode(c, x + 48, 222, 160, 82, 44);
    txt(c, 'SHAKE WELL. THEN SHAKE AGAIN.', x + PW / 2, 330, { size: 12, color: NAVY, fam: MONO, maxW: 236 });
    // ROOF panels
    g = c.createLinearGradient(0, 350, 0, 500);
    g.addColorStop(0, '#cbe9f8'); g.addColorStop(1, '#6fb8e6');
    c.fillStyle = g; c.fillRect(0, 350, 256, 150);
    almond(c, 60, 420, 50, -0.4); almond(c, 196, 420, 50, 0.4);
    txt(c, 'ALMOND MILK', 128, 410, { size: 26, color: NAVY, weight: '900', maxW: 150 });
    txt(c, 'R.O.O.M.', 128, 442, { size: 16, color: NAVY, fam: MONO });
    rect(c, 256, 350, 256, 150, '#ffffff');
    txt(c, '◄ OPEN HERE ►', 384, 400, { size: 22, color: NAVY, weight: '900', maxW: 230 });
    txt(c, 'PUSH BACK • PULL OUT', 384, 432, { size: 13, color: '#555', fam: MONO, maxW: 230 });
    // gable triangle + fin
    rect(c, 512, 350, 256, 100, '#f4fbff');
    c.strokeStyle = 'rgba(80,110,140,0.35)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(512, 450); c.lineTo(640, 352); c.lineTo(768, 450); c.moveTo(640, 352); c.lineTo(640, 450); c.stroke();
    rect(c, 512, 452, 256, 40, '#6fb8e6');
    txt(c, 'EXP ∞  0451', 640, 472, { size: 18, color: '#fff', fam: MONO });
    wear(c, 0, 0, 1024, 500, 61, 1.2, { edge: true, edgeK: 0.6, lightRatio: 0.2 });
  });
  const card = paint(A, { rough: 0.6 });
  const k = new Kit();
  const w = 0.07, h = 0.095, rh = 0.03;
  k.box(w, h, w, card, {
    p: [0, h / 2, 0],
    faces: { pz: A.R(0, 0, 256, 350), px: A.R(256, 0, 256, 350), nz: A.R(512, 0, 256, 350), nx: A.R(768, 0, 256, 350), py: A.plain, ny: A.plain },
  });
  const r = A.R(0, 350, 256, 150), r2 = A.R(256, 350, 256, 150), rg = A.R(512, 350, 256, 100);
  const hw = w / 2, yt = h + rh;
  k.add(polyGeo([[-hw, h, hw], [hw, h, hw], [hw, yt, 0], [-hw, yt, 0]], [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]), card, { keepUV: true });
  k.add(polyGeo([[hw, h, -hw], [-hw, h, -hw], [-hw, yt, 0], [hw, yt, 0]], [[r2[0], r2[1]], [r2[2], r2[1]], [r2[2], r2[3]], [r2[0], r2[3]]]), card, { keepUV: true });
  const gx = hw - 0.0015;
  const tuv = [[rg[0], rg[1]], [rg[2], rg[1]], [(rg[0] + rg[2]) / 2, rg[3]]];
  k.add(polyGeo([[gx, h, hw], [gx, h, -hw], [gx, yt, 0]], tuv), card, { keepUV: true });
  k.add(polyGeo([[-gx, h, -hw], [-gx, h, hw], [-gx, yt, 0]], tuv), card, { keepUV: true });
  k.box(w + 0.001, 0.012, 0.0035, card, { p: [0, yt + 0.0055, 0], uv: A.R(512, 452, 256, 40) });
  k.colBox([w, h, w], [0, h / 2, 0]);
  k.colBox([w, 0.03, 0.04], [0, h + 0.017, 0]);
  return { kit: k, meta: { mass: 0.25, material: 'cardboard', hold: { grip: [0, 0.05, 0], rot: [0.12, -0.35, 0.04], off: [0, 0.02, 0] } } };
});

// ---------------------------------------------------------------- bandage
def('bandage', () => {
  const A = atlas('bandage', 512, 512, (c) => {
    // gauze weave (0,0,400,300)
    rect(c, 0, 0, 400, 300, '#f4f1ea');
    c.strokeStyle = 'rgba(140,130,110,0.32)'; c.lineWidth = 1.3;
    for (let i = 0; i < 400; i += 5) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + 2, 300); c.stroke(); }
    for (let j = 0; j < 300; j += 5) { c.beginPath(); c.moveTo(0, j); c.lineTo(400, j + 2); c.stroke(); }
    noise(c, 0, 0, 400, 300, 16, 3);
    // frayed loose end strip (0,300,400,100)
    rect(c, 0, 300, 400, 100, '#f4f1ea');
    c.strokeStyle = 'rgba(140,130,110,0.32)';
    for (let i = 0; i < 400; i += 5) { c.beginPath(); c.moveTo(i, 300); c.lineTo(i + 2, 400); c.stroke(); }
    for (let j = 300; j < 400; j += 5) { c.beginPath(); c.moveTo(0, j); c.lineTo(400, j + 1); c.stroke(); }
    // end spiral (0,404,200,100 is unused) -> spiral at (300,300..) see below
    rect(c, 404, 300, 104, 104, '#efebe0');
    for (let k = 0; k < 22; k++) {
      c.strokeStyle = `rgba(140,128,105,${0.22 + (k % 3) * 0.1})`; c.lineWidth = 1.2;
      c.beginPath(); c.arc(456, 352, 2 + k * 2.3, 0, TAU); c.stroke();
    }
    noise(c, 404, 300, 104, 104, 14, 4);
    // label band (404,0,104,296): horizontal = along the roll axis, vertical = around
    rect(c, 404, 0, 104, 296, '#ffffff');
    rect(c, 404, 0, 7, 296, '#c0302a'); rect(c, 501, 0, 7, 296, '#c0302a');
    for (let i = 0; i < 3; i++) {
      const y0 = i * 98.7;
      c.fillStyle = '#c0302a'; c.fillRect(420, y0 + 14, 16, 5); c.fillRect(425.5, y0 + 8.5, 5, 16);
      txt(c, 'GAUZE', 470, y0 + 17, { size: 19, color: '#111', weight: '900', maxW: 56 });
      txt(c, 'STERILE  5cm×4m', 456, y0 + 44, { size: 11, color: '#111', fam: MONO, maxW: 84 });
      txt(c, 'R.O.O.M. MEDICAL', 456, y0 + 66, { size: 11, color: '#c0302a', fam: MONO, maxW: 84 });
      c.fillStyle = '#ddd'; c.fillRect(416, y0 + 82, 80, 1);
    }
    // medical tape (0,410,256,40)
    rect(c, 0, 410, 256, 40, '#fbfaf5');
    for (let i = 0; i < 256; i += 3) rect(c, i, 410, 1, 40, 'rgba(160,150,130,0.18)');
    noise(c, 0, 410, 256, 40, 8, 5);
    wear(c, 0, 0, 400, 300, 7, 0.8, { edge: false, lightRatio: 0.1 });
  });
  const cloth = paint(A, { rough: 0.95 });
  const k = new Kit();
  const R = 0.031, Wd = 0.052;
  k.push({ r: [0, 0, PI / 2] }); // roll axis along X
  k.cyl(R, R, Wd, cloth, { seg: 32, faces: { side: A.R(0, 0, 400, 300), top: A.R(404, 300, 104, 104), bottom: A.R(404, 300, 104, 104) } });
  k.cyl(R + 0.0006, R + 0.0006, 0.034, cloth, { seg: 32, open: true, uv: A.R(404, 0, 104, 296, 3) });
  k.colCyl(R, Wd);
  k.pop();
  // loose end: unrolled from under the roll, lying on the floor toward +Z, frayed and slightly lifted
  k.add(sheetGeo(4, 10, (u, v) => {
    const z = v * 0.045, lift = Math.max(0, 0.004 - z * 0.12) + Math.sin(v * 9 + u * 2) * 0.0007 + v * v * 0.0015;
    return [(u - 0.5) * Wd * 0.98, -R + 0.0006 + lift, z];
  }), cloth, { uv: A.R(0, 300, 400, 100, 1), col: 0xe2ddd2 });
  // tape tab holding the strip
  k.box(0.014, 0.0008, 0.026, cloth, { p: [0.008, -R + 0.0013, 0.022], r: [0, 0.25, 0], uv: A.R(0, 410, 256, 40, 1) });
  return { kit: k, meta: { mass: 0.05, material: 'soft', hold: { grip: [0, 0, 0], rot: [0.35, 0.35, 0.1], off: [0, 0.03, 0] } } };
});

// ---------------------------------------------------------------- multitool
def('multitool', () => {
  const A = atlas('multitool', 512, 256, (c) => {
    // handle scale (0,0,512,96): length along x
    const g = c.createLinearGradient(0, 0, 0, 96);
    g.addColorStop(0, '#d23a2e'); g.addColorStop(0.5, '#b8261d'); g.addColorStop(1, '#8e1a14');
    c.fillStyle = g; c.fillRect(0, 0, 512, 96);
    noise(c, 0, 0, 512, 96, 10, 8);
    roomIcon(c, 90, 48, 44, '#f4f0e6', null, 0.12);
    txt(c, 'R.O.O.M.', 250, 42, { size: 46, color: '#f4f0e6', weight: '900', maxW: 220 });
    txt(c, 'MULTI-TOOL', 250, 74, { size: 18, color: '#f4f0e6', fam: MONO, maxW: 220 });
    for (let x = 390; x < 500; x += 12) rect(c, x, 20, 5, 56, 'rgba(0,0,0,0.25)');
    wear(c, 0, 0, 512, 96, 9, 3, { edge: false, lightRatio: 0.9 });
    // plain red (0,100,256,60)
    rect(c, 0, 100, 256, 60, '#b8261d');
    noise(c, 0, 100, 256, 60, 10, 9);
  });
  const red = paint(A, { rough: 0.32, metal: 0.55 });
  const k = new Kit();
  const piv = [0, 0, -0.028];
  const dH = 0.13, dJ = 0.2;
  for (const sx of [-1, 1]) {
    k.push({ p: piv, r: [0, sx * dH, 0] });
    k.rbox(0.02, 0.012, 0.104, 0.0045, red, {
      p: [sx * 0.0112, 0, 0.056], rs: 3,
      faces: { py: A.R(0, 0, 512, 96, sx > 0 ? 3 : 1), ny: A.R(0, 100, 256, 60), px: A.R(0, 100, 256, 60), nx: A.R(0, 100, 256, 60), pz: A.R(0, 100, 256, 60), nz: A.R(0, 100, 256, 60) },
    });
    // steel liner peeking between scales
    k.box(0.0016, 0.009, 0.1, M.steel(), { p: [sx * 0.0012, 0, 0.056] });
    // end rivet
    k.cyl(0.0028, 0.0028, 0.0128, M.chrome(), { p: [sx * 0.0112, 0, 0.1], seg: 10 });
    k.pop();
    // jaw (needle nose)
    k.push({ p: piv, r: [0, sx * dJ, 0] });
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(0, 0.043); s.lineTo(-0.0016 * sx, 0.044);
    s.quadraticCurveTo(-0.0045 * sx, 0.02, -0.0085 * sx, 0.004); s.lineTo(-0.0085 * sx, 0);
    const jg = extrudeGeo(s, 0.007, 0.0006, { curveSegments: 6 });
    k.add(jg, M.steel(), { r: [-PI / 2, 0, 0], p: [sx * 0.0004, 0, 0], uvFn: (p) => [p.x * 20 + 0.5, p.y * 20] });
    k.pop();
  }
  // pivot hub + rivets
  k.cyl(0.0095, 0.0095, 0.011, M.steel(), { p: piv, seg: 20 });
  k.cyl(0.0042, 0.0042, 0.0136, M.chrome(), { p: piv, seg: 14 });
  // folded-out blade on right handle
  k.push({ p: [0.02, 0.0, 0.07], r: [0, -0.55, 0] });
  const bs = new THREE.Shape();
  bs.moveTo(0, 0); bs.lineTo(0.0075, 0); bs.lineTo(0.0075, 0.03); bs.quadraticCurveTo(0.006, 0.04, 0, 0.046); bs.lineTo(0, 0);
  k.add(extrudeGeo(bs, 0.0015, 0.0002, { curveSegments: 6 }), M.steel(), { r: [-PI / 2, 0, PI], p: [0.004, 0, 0.0], uvFn: (p) => [p.x * 20 + 0.5, p.y * 20] });
  k.pop();
  k.colBox([0.05, 0.014, 0.178], [0, 0, 0.0125]);
  return { kit: k, meta: { mass: 0.24, material: 'metal', hold: { grip: [0, 0, 0.035], rot: [0.45, 0.1, -0.25] } } };
});

// ---------------------------------------------------------------- almond_water
def('almond_water', () => {
  const A = atlas('almond_water', 1024, 512, (c) => {
    // label wrap (0,0,1024,256): u around (front centre x=512), v up
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#2f6fc0'); g.addColorStop(1, '#1d4f96');
    c.fillStyle = g; c.fillRect(0, 0, 1024, 256);
    c.fillStyle = 'rgba(255,255,255,0.14)';
    for (let i = 0; i < 4; i++) {
      c.beginPath(); c.moveTo(0, 190 + i * 14);
      for (let x = 0; x <= 1024; x += 16) c.lineTo(x, 190 + i * 14 + Math.sin(x / 70 + i) * 8);
      c.lineTo(1024, 256); c.lineTo(0, 256); c.fill();
    }
    rect(c, 0, 0, 1024, 10, '#e8eef6'); rect(c, 0, 246, 1024, 10, '#e8eef6');
    almond(c, 396, 108, 70, -0.5);
    txt(c, 'Almond', 540, 92, { size: 82, color: '#ffffff', fam: 'Georgia, "Times New Roman", serif', weight: 'bold', italic: true, maxW: 250 });
    txt(c, 'Water', 560, 162, { size: 72, color: '#ffffff', fam: 'Georgia, "Times New Roman", serif', weight: 'bold', italic: true, maxW: 220 });
    txt(c, 'R.O.O.M. HYDRATION DIVISION', 512, 216, { size: 18, color: '#cfe0f6', fam: MONO, maxW: 330 });
    txt(c, 'RESTORES SANITY*', 812, 60, { size: 22, color: '#fff', weight: '900', maxW: 200 });
    txt(c, '*not a medical claim', 812, 84, { size: 13, color: '#cfe0f6', fam: MONO, weight: 'normal' });
    txt(c, '500 mL • 16.9 FL OZ', 812, 120, { size: 16, color: '#fff', fam: MONO });
    barcode(c, 120, 60, 150, 70, 5);
    txt(c, 'PROPERTY OF R.O.O.M.', 195, 160, { size: 16, color: '#fff', weight: '900', maxW: 230 });
    txt(c, 'Do not consume in Dimension 0', 195, 182, { size: 13, color: '#cfe0f6', fam: MONO, maxW: 230 });
    wear(c, 0, 0, 1024, 256, 3, 0.8, { edge: false, lightRatio: 0.8 });
    // cap (0,260,512,120): ribbed side + top
    rect(c, 0, 260, 512, 120, '#2a5aa8');
    for (let x = 0; x < 512; x += 6) rect(c, x, 260, 3, 120, 'rgba(255,255,255,0.12)');
    rect(c, 520, 260, 140, 140, '#2a5aa8');
    roomIcon(c, 590, 330, 60, '#cfe0f6', null, 0.1);
  });
  const p = paint(A, { rough: 0.3 });
  const water = new THREE.MeshStandardMaterial({ name: 'almondwater_liquid', color: 0xe4dbc4, roughness: 0.15 });
  const k = new Kit();
  const R = 0.032;
  const prof = [[0, 0.003], [0.02, 0.0005], [0.027, 0.0], [0.031, 0.004], [R, 0.012], [R, 0.05], [R - 0.0015, 0.056], [R, 0.062], [R, 0.142], [R - 0.0015, 0.147], [R, 0.152], [0.0305, 0.165], [0.024, 0.18], [0.0155, 0.19], [0.0135, 0.196], [0.0135, 0.2]];
  k.lathe(prof, M.clearPlastic(), { seg: 28 });
  // liquid
  k.lathe([[0, 0.004], [0.026, 0.0025], [R - 0.0016, 0.012], [R - 0.0016, 0.15], [0.0295, 0.162, 1], [0, 0.162]], water, { seg: 24 });
  // label
  k.cyl(R + 0.0006, R + 0.0006, 0.072, p, { seg: 36, open: true, p: [0, 0.098, 0], uv: A.R(0, 0, 1024, 256) });
  // neck ring + cap
  k.cyl(0.0175, 0.0175, 0.0018, p, { seg: 20, p: [0, 0.1915, 0], col: 0x2a5aa8 });
  k.cyl(0.0158, 0.0158, 0.019, p, { seg: 28, p: [0, 0.2025, 0], faces: { side: A.R(0, 260, 512, 120), top: A.R(520, 260, 140, 140), bottom: A.plain }, col: 0xffffff });
  k.colCyl(R, 0.192, [0, 0.096, 0]);
  k.colCyl(0.016, 0.02, [0, 0.202, 0]);
  return { kit: k, meta: { mass: 0.52, material: 'plastic', hold: { grip: [0, 0.09, 0], rot: [0.1, -0.15, 0.06], off: [0, 0.035, 0] } } };
});

// ---------------------------------------------------------------- beverage cans
function beverageCan(name, R, H, AW, AH, labelH, draw, meta) {
  def(name, () => {
    const A = atlas(name, AW, AH, (c) => {
      draw(c, AW, labelH);
      wear(c, 0, 0, AW, labelH, 13, 0.9, { edge: false, lightRatio: 0.85 });
    });
    const label = paint(A, { rough: 0.3, metal: 0.35 });
    const k = new Kit();
    const alu = M.alu();
    k.lathe([
      [0, 0.0105], [R * 0.45, 0.0085], [R * 0.7, 0.0035], [R * 0.79, 0.0], [R * 0.87, 0.0004], [R * 0.95, 0.0035], [R, 0.0095],
      [R, H - 0.0145], [R * 0.975, H - 0.0105], [R * 0.9, H - 0.0045], [R * 0.875, H - 0.0018], [R * 0.882, H - 0.0002], [R * 0.874, H + 0.0006], [R * 0.86, H, 1],
      [R * 0.845, H - 0.0032, 1], [R * 0.6, H - 0.0034], [0, H - 0.0036],
    ], alu, { seg: 32 });
    k.cyl(R + 0.0003, R + 0.0003, H - 0.0255, label, { seg: 36, open: true, p: [0, 0.0095 + (H - 0.0255) / 2 + 0.0005, 0], uv: A.R(0, 0, AW, labelH) });
    // opening score + pull tab + rivet
    k.rbox(0.017, 0.0007, 0.0125, 0.0025, alu, { p: [0, H - 0.0032, -0.011], rs: 1 });
    k.rbox(0.0125, 0.0011, 0.022, 0.0035, M.chrome(), { p: [0, H - 0.0024, 0.0045], r: [0.04, 0, 0], rs: 1 });
    k.cyl(0.0022, 0.0022, 0.0014, alu, { p: [0, H - 0.0026, 0], seg: 10 });
    k.colCyl(R, H, [0, H / 2, 0]);
    return { kit: k, meta: { mass: meta.mass, material: 'metal', hold: { grip: [0, H * 0.45, 0], rot: [0.1, -0.25, 0.05], off: [0, 0.012, 0] } } };
  });
}

beverageCan('soda_can', 0.033, 0.1225, 1024, 512, 448, (c, W, H) => {
  rect(c, 0, 0, W, H, '#c41f26');
  noise(c, 0, 0, W, H, 8, 2);
  // white swoosh
  c.fillStyle = '#fff';
  c.beginPath(); c.moveTo(0, 300);
  for (let x = 0; x <= W; x += 16) c.lineTo(x, 300 + Math.sin(x / W * TAU * 2) * 40);
  for (let x = W; x >= 0; x -= 16) c.lineTo(x, 330 + Math.sin(x / W * TAU * 2 + 0.4) * 40);
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.25)';
  for (let i = 0; i < 40; i++) { const x = (i * 97) % W, y = 40 + (i * 53) % 220; c.beginPath(); c.arc(x, y, 3 + (i % 4) * 2, 0, TAU); c.fill(); }
  roomIcon(c, 512, 70, 60, '#fff', null, 0.1);
  txt(c, 'R.O.O.M.', 512, 158, { size: 104, color: '#fff', weight: '900', italic: true, maxW: 270, stroke: '#7a0c10', sw: 6 });
  txt(c, 'COLA', 512, 240, { size: 64, color: '#ffe9c0', weight: '900', ls: 18, maxW: 230 });
  txt(c, 'CLASSIC TASTE OF NORMALCY', 512, 395, { size: 22, color: '#fff', fam: MONO, maxW: 300 });
  // back
  txt(c, 'PROPERTY OF R.O.O.M.', 100, 80, { size: 22, color: '#fff', weight: '900', maxW: 190 });
  txt(c, 'Do not consume in', 100, 106, { size: 15, color: '#ffd9d9', fam: MONO, maxW: 190 });
  txt(c, 'Dimension 0', 100, 124, { size: 15, color: '#ffd9d9', fam: MONO, maxW: 190 });
  barcode(c, 900, 60, 110, 80, 9);
  txt(c, '355 mL', 960, 180, { size: 26, color: '#fff', weight: '900' });
  txt(c, 'CAFFEINE 34mg', 100, 200, { size: 15, color: '#fff', fam: MONO });
  txt(c, 'CALORIES 140', 100, 222, { size: 15, color: '#fff', fam: MONO });
}, { mass: 0.37 });

beverageCan('energy_drink', 0.0332, 0.168, 1024, 1024, 700, (c, W, H) => {
  rect(c, 0, 0, W, H, '#0d0f10');
  noise(c, 0, 0, W, H, 10, 4);
  // claw slashes
  c.fillStyle = '#7dff3a';
  for (let i = 0; i < 3; i++) {
    const x0 = 380 + i * 90;
    c.beginPath(); c.moveTo(x0, 60); c.quadraticCurveTo(x0 + 70, 260, x0 + 10, 520); c.lineTo(x0 + 26, 520); c.quadraticCurveTo(x0 + 96, 250, x0 + 22, 60); c.fill();
  }
  c.globalAlpha = 0.18;
  c.fillRect(0, 600, W, 6);
  c.globalAlpha = 1;
  txt(c, 'KINETIC', 512, 300, { size: 170, color: '#7dff3a', weight: '900', italic: true, maxW: 350, stroke: '#0d0f10', sw: 14, rot: -0.08, sy: 1.5 });
  txt(c, 'ENERGY+', 540, 430, { size: 70, color: '#ffffff', weight: '900', italic: true, maxW: 250, stroke: '#0d0f10', sw: 10, sy: 1.3 });
  txt(c, 'MANDATORY ALERTNESS FORMULA', 512, 560, { size: 26, color: '#7dff3a', fam: MONO, maxW: 330, sy: 1.4 });
  brand(c, 512, 640, 30, '#ffffff');
  // back
  txt(c, 'CAFFEINE: YES', 110, 120, { size: 26, color: '#7dff3a', weight: '900', maxW: 200 });
  txt(c, 'SLEEP: NO', 110, 152, { size: 22, color: '#fff', weight: '900', maxW: 200 });
  const lines = ['Not recommended for', 'children, pregnant', 'women, or entities', 'sensitive to time.', '', 'PROPERTY OF R.O.O.M.', 'Do not consume in', 'Dimension 0.'];
  lines.forEach((s, i) => txt(c, s, 110, 210 + i * 26, { size: 18, color: '#cfd8cf', fam: MONO, maxW: 200 }));
  barcode(c, 860, 120, 130, 90, 21);
  txt(c, '473 mL', 925, 260, { size: 34, color: '#fff', weight: '900' });
}, { mass: 0.5 });

// ---------------------------------------------------------------- canned_food
def('canned_food', () => {
  const R = 0.0425, H = 0.11;
  const A = atlas('canned_food', 1024, 512, (c) => {
    const W = 1024, LH = 400;
    rect(c, 0, 0, W, LH, '#efe2bf');
    noise(c, 0, 0, W, LH, 12, 6);
    rect(c, 0, 0, W, 70, '#7c1d1a'); rect(c, 0, LH - 60, W, 60, '#7c1d1a');
    rect(c, 0, 70, W, 6, '#d6a734'); rect(c, 0, LH - 66, W, 6, '#d6a734');
    txt(c, 'R.O.O.M. PROVISIONS', 512, 36, { size: 30, color: '#efe2bf', fam: MONO, ls: 4, maxW: 600 });
    txt(c, 'MYSTERY', 512, 122, { size: 70, color: '#7c1d1a', weight: '900', maxW: 300 });
    txt(c, 'STEW', 512, 184, { size: 66, color: '#7c1d1a', weight: '900', ls: 12, maxW: 230 });
    // bowl illustration
    const bx = 512, by = 262;
    c.fillStyle = '#5b3418';
    c.beginPath(); c.ellipse(bx, by, 78, 20, 0, 0, TAU); c.fill();
    c.fillStyle = '#9c5a2a';
    c.beginPath(); c.ellipse(bx, by - 3, 70, 15, 0, 0, TAU); c.fill();
    for (let i = 0; i < 8; i++) { c.fillStyle = ['#c8752f', '#6b8e3a', '#e0b050'][i % 3]; c.beginPath(); c.arc(bx - 52 + i * 15, by - 6 + (i % 2) * 5, 6, 0, TAU); c.fill(); }
    c.fillStyle = '#e8e2d2';
    c.beginPath(); c.moveTo(bx - 80, by + 2); c.quadraticCurveTo(bx, by + 80, bx + 80, by + 2); c.fill();
    c.strokeStyle = 'rgba(120,110,100,0.6)'; c.lineWidth = 3; c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 4;
    for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(bx - 26 + i * 26, by - 22); c.bezierCurveTo(bx - 38 + i * 26, by - 36, bx - 14 + i * 26, by - 44, bx - 26 + i * 26, by - 58); c.stroke(); }
    txt(c, '?', bx + 92, by - 38, { size: 56, color: '#7c1d1a', weight: '900', rot: 0.25 });
    txt(c, '?', bx - 96, by - 30, { size: 40, color: '#7c1d1a', weight: '900', rot: -0.3, alpha: 0.7 });
    txt(c, 'SERVING SUGGESTION', bx, by + 52, { size: 11, color: '#3a2a1a', fam: MONO });
    txt(c, 'CONTENTS:', 760, 210, { size: 20, color: '#3a2a1a', fam: MONO });
    txt(c, 'YES', 760, 240, { size: 30, color: '#7c1d1a', weight: '900' });
    roomIcon(c, 264, 220, 56, '#7c1d1a', null, 0.1);
    txt(c, 'EST. 19██', 264, 268, { size: 14, color: '#3a2a1a', fam: MONO });
    txt(c, 'NET WT 15 OZ (425 g)', 512, LH - 30, { size: 22, color: '#efe2bf', fam: MONO, maxW: 400 });
    // back
    const lines = ['INGREDIENTS: WATER, MEAT-LIKE', 'PROTEIN, VEGETABLES (ASSORTED),', 'GRAVY, SALT, ????, ¿¿¿¿.', '', 'PROPERTY OF R.O.O.M.', 'DO NOT CONSUME IN DIMENSION 0', 'HEAT BEFORE EATING (OPTIONAL)'];
    lines.forEach((s, i) => txt(c, s, 30, 110 + i * 22, { size: 15, color: '#3a2a1a', fam: MONO, align: 'left', maxW: 250 }));
    barcode(c, 860, 110, 140, 80, 31);
    // torn edge exposing tin (near seam at u~0.03)
    c.fillStyle = '#b8bcc0';
    c.beginPath(); c.moveTo(0, 210); c.lineTo(46, 222); c.lineTo(30, 250); c.lineTo(58, 280); c.lineTo(36, 310); c.lineTo(54, 340); c.lineTo(0, 345); c.fill();
    c.strokeStyle = '#d9cfb0'; c.lineWidth = 3; c.stroke();
    wear(c, 0, 0, W, LH, 41, 1.6, { edge: true, edgeK: 0.8 });
    // lid (0,404,100,100)
    rect(c, 0, 404, 100, 100, '#c4c8cc');
    for (let k = 0; k < 6; k++) { c.strokeStyle = 'rgba(80,80,85,0.35)'; c.lineWidth = 2; c.beginPath(); c.arc(50, 454, 10 + k * 7, 0, TAU); c.stroke(); }
    txt(c, 'L0 0451', 50, 454, { size: 11, color: '#333', fam: MONO });
  });
  const label = paint(A, { rough: 0.7 });
  const steel = M.alu();
  const dent = (v) => {
    const a = Math.atan2(v.x, v.z), r = Math.hypot(v.x, v.z);
    if (r < R * 0.6) return;
    const da = a - 0.75, dy = v.y - 0.068;
    const d = Math.hypot(da * R, dy * 0.9);
    const k2 = Math.exp(-((d / 0.016) ** 2));
    const s = (r - 0.0055 * k2) / r;
    v.x *= s; v.z *= s;
  };
  const k = new Kit();
  const bot = [[0, 0.0028], [R - 0.004, 0.0028], [R - 0.0034, 0.0006], [R - 0.0005, 0], [R + 0.0012, 0.002], [R + 0.0012, 0.0055], [R, 0.0075], [R, 0.0085], [R - 0.0012, 0.0103], [R, 0.0121], [R - 0.0004, 0.0135]];
  k.lathe(bot, steel, { seg: 32 });
  const top = [[R - 0.0004, 0.0965], [R, 0.0975], [R - 0.0012, 0.0993], [R, 0.1011], [R, H - 0.0075], [R + 0.0012, H - 0.0055], [R + 0.0012, H - 0.0015], [R, H], [R - 0.0022, H - 0.0006, 1], [R - 0.0035, H - 0.0035, 1]];
  for (let i = 0; i < 4; i++) top.push([R - 0.009 - i * 0.008, H - 0.0035], [R - 0.0128 - i * 0.008, H - 0.0024]);
  top.push([0, H - 0.0028]);
  k.lathe(top, steel, { seg: 32 });
  k.cyl(R + 0.0002, R + 0.0002, 0.0855, label, { seg: 40, hseg: 14, open: true, p: [0, 0.055, 0], uv: A.R(0, 0, 1024, 400), deform: (v) => { v.y += 0.055; dent(v); v.y -= 0.055; } });
  k.colCyl(R + 0.001, H, [0, H / 2, 0]);
  return { kit: k, meta: { mass: 0.45, material: 'metal', hold: { grip: [0, 0.05, 0], rot: [0.12, -0.35, 0.05], off: [0, 0.015, 0] } } };
});

// ---------------------------------------------------------------- chips
def('chips', () => {
  const A = atlas('chips', 768, 576, (c) => {
    // FRONT (0,0,384,512): v=1 top (seal), v=0 bottom
    const g = c.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#ff9a1c'); g.addColorStop(1, '#e2520c');
    c.fillStyle = g; c.fillRect(0, 0, 384, 512);
    // sunburst
    c.save(); c.translate(192, 330);
    for (let i = 0; i < 18; i++) { c.rotate(TAU / 18); c.fillStyle = i % 2 ? 'rgba(255,230,120,0.25)' : 'rgba(255,255,255,0.0)'; c.beginPath(); c.moveTo(0, 0); c.lineTo(300, -50); c.lineTo(300, 50); c.fill(); }
    c.restore();
    // chips pile
    const r = new RNG(5);
    for (let i = 0; i < 16; i++) {
      const x = 192 + r.range(-110, 110), y = 380 + r.range(-40, 50), s = r.range(32, 50);
      c.save(); c.translate(x, y); c.rotate(r.range(-1, 1));
      const cg = c.createRadialGradient(-s * 0.2, -s * 0.2, 2, 0, 0, s);
      cg.addColorStop(0, '#ffe58a'); cg.addColorStop(1, '#d99a2a');
      c.fillStyle = cg; c.beginPath(); c.ellipse(0, 0, s, s * 0.7, 0, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(150,90,20,0.5)'; c.lineWidth = 2; c.stroke();
      c.restore();
    }
    rect(c, 0, 0, 384, 44, '#1d1d1f');
    brand(c, 192, 22, 22, ROOM_YELLOW, { text: 'R.O.O.M. SNACKS' });
    txt(c, 'LIMINAL', 192, 108, { size: 78, color: '#ffe23a', weight: '900', italic: true, stroke: '#a3170c', sw: 12, maxW: 340 });
    txt(c, 'CRISPS', 192, 176, { size: 70, color: '#ffffff', weight: '900', italic: true, stroke: '#a3170c', sw: 12, maxW: 320 });
    rrect(c, 40, 214, 304, 46, 23, '#2a6a3a');
    txt(c, 'SOUR CREAM & STATIC', 192, 237, { size: 22, color: '#fff', weight: '900', maxW: 280 });
    txt(c, 'POTATO-ADJACENT', 192, 280, { size: 18, color: '#4a1405', fam: MONO, maxW: 300 });
    rect(c, 0, 470, 384, 24, '#a3170c');
    txt(c, 'NET WT 1 OZ (28.3 g)', 192, 482, { size: 14, color: '#fff', fam: MONO });
    // seal crimp zones
    for (const y0 of [0, 494]) for (let x = 0; x < 384; x += 6) rect(c, x, y0, 3, 18, 'rgba(0,0,0,0.18)');
    // BACK (384,0,384,512)
    rect(c, 384, 0, 384, 512, '#f2a03a');
    rect(c, 384, 0, 384, 44, '#1d1d1f');
    txt(c, 'PROPERTY OF R.O.O.M.', 576, 22, { size: 22, color: ROOM_YELLOW, weight: '900' });
    rrect(c, 410, 70, 200, 230, 4, '#fff', '#111', 3);
    txt(c, 'Nutrition Facts', 420, 92, { size: 19, align: 'left', weight: '900', maxW: 180 });
    const rows = ['Calories 160', 'Fat 10 g', 'Sodium 170 mg', 'Carbs 15 g', 'Static 3 mV', 'Air 60%'];
    rows.forEach((s, i) => { rect(c, 418, 108 + i * 30, 184, 2, '#111'); txt(c, s, 420, 125 + i * 30, { size: 16, align: 'left', fam: MONO, weight: 'normal' }); });
    barcode(c, 628, 80, 120, 90, 19);
    const lines = ['DO NOT CONSUME IN', 'DIMENSION 0.', '', 'Bag is 60% air', 'for your protection.', '', 'Crunch responsibly:', 'noise attracts', 'attention.'];
    lines.forEach((s, i) => txt(c, s, 576, 330 + i * 18, { size: 14, color: '#3a1a05', fam: MONO, maxW: 340 }));
    for (const y0 of [0, 494]) for (let x = 384; x < 768; x += 6) rect(c, x, y0, 3, 18, 'rgba(0,0,0,0.18)');
    wear(c, 0, 0, 768, 512, 23, 1.1, { edge: false, lightRatio: 0.9 });
  });
  const foil = paint(A, { rough: 0.32, metal: 0.25 });
  const W = 0.15, H = 0.2, T = 0.026;
  const shape = (u, v, sgn) => {
    const seal = Math.min(1, Math.min(v, 1 - v) / 0.09);
    const s = seal <= 0 ? 0 : Math.pow(Math.sin(seal * PI / 2), 0.8);
    const bu = Math.sqrt(Math.max(0, 1 - Math.pow(2 * u - 1, 6)));
    const pinch = 1 - 0.06 * (1 - s);
    const crinkle = (Math.sin(u * 41 + v * 13) * Math.sin(v * 37 - u * 9) + Math.sin(u * 87 + v * 71) * 0.4) * 0.0011;
    const crimp = s < 0.05 ? Math.sin(u * 160) * 0.0004 : 0;
    const z = sgn * (T * bu * s + crinkle * s + crimp + 0.0004);
    return [(u - 0.5) * W * pinch, (v - 0.5) * H, z];
  };
  const k = new Kit();
  k.push({ r: [-PI / 2, 0, 0], p: [0, 0, 0] }); // lie flat, front up, top of bag toward -Z
  k.add(sheetGeo(18, 26, (u, v) => shape(u, v, 1)), foil, { uv: A.R(0, 0, 384, 512) });
  k.add(sheetGeo(18, 26, (u, v) => { const p = shape(1 - u, v, -1); return p; }), foil, { uv: A.R(384, 0, 384, 512) });
  k.colBox([W * 0.96, H * 0.92, T * 1.5]);
  k.pop();
  return { kit: k, meta: { mass: 0.08, material: 'paper', hold: { grip: [0, 0, 0.02], rot: [1.22, 0, 0.1], off: [0, 0.04, 0] } } };
});

// ---------------------------------------------------------------- medkit
def('medkit', () => {
  const A = atlas('medkit', 1024, 512, (c) => {
    // lid top (0,0,640,440)
    rect(c, 0, 0, 640, 440, '#dedbd2');
    noise(c, 0, 0, 640, 440, 6, 3);
    c.fillStyle = '#c8241c';
    c.fillRect(320 - 55, 220 - 150, 110, 300); c.fillRect(320 - 150, 220 - 55, 300, 110);
    c.strokeStyle = '#fff'; c.lineWidth = 8;
    c.strokeRect(320 - 55, 220 - 150, 110, 300);
    txt(c, 'FIRST AID', 320, 410, { size: 40, color: '#c8241c', weight: '900', ls: 6 });
    brand(c, 120, 40, 22, '#333');
    txt(c, 'PROPERTY OF R.O.O.M. MEDICAL', 470, 40, { size: 15, color: '#333', fam: MONO, maxW: 300 });
    txt(c, 'KIT No. 0451', 560, 400, { size: 13, color: '#666', fam: MONO });
    wear(c, 0, 0, 640, 440, 51, 2.2, { edgeK: 1.2 });
    // front strip (0,444,640,64)
    rect(c, 0, 444, 640, 64, '#dedbd2');
    rect(c, 0, 444, 640, 12, '#c8241c');
    txt(c, 'EMERGENCY USE ONLY  •  R.O.O.M. MEDICAL  •  REPLENISH AFTER USE', 320, 482, { size: 15, color: '#c8241c', fam: MONO, maxW: 600 });
    wear(c, 0, 444, 640, 64, 52, 2);
    // side (650,0,300,90)
    rect(c, 650, 0, 300, 90, '#dedbd2');
    c.fillStyle = '#c8241c'; c.fillRect(680, 30, 30, 10); c.fillRect(690, 20, 10, 30);
    txt(c, 'FIRST AID', 820, 36, { size: 28, color: '#c8241c', weight: '900' });
    txt(c, 'R.O.O.M. MEDICAL', 820, 66, { size: 14, color: '#333', fam: MONO });
    wear(c, 650, 0, 300, 90, 53, 2);
  });
  const shell = paint(A, { rough: 0.42 });
  const k = new Kit();
  const Wd = 0.27, D = 0.185;
  const side = A.R(650, 0, 300, 90), plain = A.plain;
  k.rbox(Wd, 0.05, D, 0.014, shell, { p: [0, 0.025, 0], faces: { px: side, nx: side, pz: A.R(0, 444, 640, 64), nz: plain, py: plain, ny: plain } });
  k.rbox(Wd - 0.004, 0.005, D - 0.004, 0.002, shell, { p: [0, 0.0505, 0], col: 0x3a3a3a, rs: 1 });
  k.rbox(Wd + 0.002, 0.034, D + 0.002, 0.014, shell, { p: [0, 0.069, 0], faces: { py: A.R(0, 0, 640, 440), px: plain, nx: plain, pz: plain, nz: plain, ny: plain } });
  // handle on +Z side
  k.tube([[-0.052, 0.046, D / 2 - 0.002], [-0.05, 0.046, D / 2 + 0.016], [-0.03, 0.046, D / 2 + 0.024], [0.03, 0.046, D / 2 + 0.024], [0.05, 0.046, D / 2 + 0.016], [0.052, 0.046, D / 2 - 0.002]], 0.0062, shell, { col: 0x3b3b3e, tseg: 28, rseg: 8 });
  for (const sx of [-1, 1]) {
    k.rbox(0.016, 0.022, 0.012, 0.004, shell, { p: [sx * 0.052, 0.046, D / 2 + 0.003], col: 0x3b3b3e, rs: 1 });
    // latches
    k.rbox(0.024, 0.034, 0.009, 0.0035, shell, { p: [sx * 0.098, 0.05, D / 2 + 0.003], col: 0xc8241c, rs: 1 });
    // hinges (back)
    k.cyl(0.0055, 0.0055, 0.045, shell, { p: [sx * 0.07, 0.051, -D / 2 - 0.002], r: [0, 0, PI / 2], col: 0xc9c6bc, seg: 12 });
    // feet
    for (const sz of [-1, 1]) k.cyl(0.008, 0.008, 0.003, shell, { p: [sx * 0.11, 0.0, sz * 0.07], col: 0x222222, seg: 10 });
  }
  k.colBox([Wd + 0.002, 0.086, D + 0.002], [0, 0.043, 0]);
  return { kit: k, meta: { mass: 1.2, material: 'plastic', hold: { grip: [0, 0.046, D / 2 + 0.02], rot: [1.2, 0, 0.0], off: [-0.03, -0.02, 0.02] } } };
});

// ---------------------------------------------------------------- antibiotics
def('antibiotics', () => {
  const A = atlas('antibiotics', 512, 512, (c) => {
    // label (0,0,512,180)
    rect(c, 0, 0, 512, 180, '#fbfaf6');
    rect(c, 0, 0, 512, 34, '#2c5d8a');
    txt(c, 'R.O.O.M. PHARMACY', 256, 17, { size: 16, color: '#fff', fam: MONO, maxW: 180 });
    txt(c, 'AMOXI-ROOM', 256, 54, { size: 30, color: '#111', weight: '900', maxW: 175 });
    txt(c, '500 mg CAPSULES', 256, 78, { size: 15, color: '#2c5d8a', weight: '900', maxW: 180 });
    txt(c, 'Rx #0451  QTY 30  REFILLS 0', 256, 98, { size: 13, color: '#333', fam: MONO, maxW: 180 });
    txt(c, 'Take 1 capsule 3x daily as', 256, 118, { size: 13, color: '#111', fam: MONO, weight: 'normal', maxW: 180 });
    txt(c, 'directed by your Supervisor.', 256, 134, { size: 13, color: '#111', fam: MONO, weight: 'normal', maxW: 180 });
    txt(c, 'DR. ████████', 256, 158, { size: 13, color: '#555', fam: MONO, maxW: 180 });
    barcode(c, 60, 60, 70, 60, 8, false);
    txt(c, 'KEEP OUT OF', 95, 136, { size: 10, color: '#333', fam: MONO });
    txt(c, 'REACH OF', 95, 150, { size: 10, color: '#333', fam: MONO });
    txt(c, 'ENTITIES', 95, 164, { size: 10, color: '#333', fam: MONO });
    rect(c, 370, 40, 64, 130, '#f6d21c');
    txt(c, 'MAY CAUSE', 402, 70, { size: 11, color: '#111', weight: '900', maxW: 60 });
    txt(c, 'DROWSI-', 402, 88, { size: 11, color: '#111', weight: '900', maxW: 60 });
    txt(c, 'NESS', 402, 104, { size: 11, color: '#111', weight: '900', maxW: 60 });
    txt(c, 'DO NOT', 402, 130, { size: 10, color: '#111', fam: MONO, maxW: 60 });
    txt(c, 'OPERATE', 402, 144, { size: 10, color: '#111', fam: MONO, maxW: 60 });
    txt(c, 'REALITY', 402, 158, { size: 10, color: '#111', fam: MONO, maxW: 60 });
    wear(c, 0, 0, 512, 180, 61, 1.2);
    // pills texture (0,190,512,120)
    rect(c, 0, 190, 512, 120, '#e8e0d0');
    const r = new RNG(3);
    for (let i = 0; i < 70; i++) {
      const x = r.range(0, 512), y = r.range(190, 310), a = r.range(0, PI);
      c.save(); c.translate(x, y); c.rotate(a);
      rrect(c, -14, -6, 14, 12, 6, '#d23a2a'); rrect(c, 0, -6, 14, 12, 6, '#f6f2ea');
      c.restore();
    }
    // cap side ribs (0,320,512,60) + cap top (0,384,120,120)
    rect(c, 0, 320, 512, 60, '#f4f2ec');
    for (let x = 0; x < 512; x += 5) rect(c, x, 320, 2, 60, 'rgba(0,0,0,0.12)');
    rect(c, 130, 384, 120, 120, '#f4f2ec');
    c.strokeStyle = '#999'; c.lineWidth = 2; c.beginPath(); c.arc(190, 444, 50, 0, TAU); c.stroke();
    txt(c, 'PUSH DOWN', 190, 430, { size: 13, color: '#333', fam: MONO });
    txt(c, '& TURN', 190, 448, { size: 13, color: '#333', fam: MONO });
    txt(c, '↻', 190, 472, { size: 20, color: '#333' });
  });
  const p = paint(A, { rough: 0.45 });
  const amber = new THREE.MeshPhysicalMaterial({ name: 'pill_amber', color: 0xf0821a, roughness: 0.14, metalness: 0, transparent: true, opacity: 0.62, clearcoat: 1, clearcoatRoughness: 0.08, depthWrite: false, envMapIntensity: 1.3 });
  const k = new Kit();
  const R = 0.0175;
  k.lathe([[0, 0.0008], [0.014, 0.0], [0.0168, 0.0018], [R, 0.005], [R, 0.055], [0.0166, 0.058], [0.0158, 0.06], [0.0158, 0.064]], amber, { seg: 28 });
  k.cyl(0.0162, 0.0162, 0.04, p, { seg: 20, p: [0, 0.0215, 0], faces: { side: A.R(0, 190, 512, 120), top: A.R(0, 190, 120, 120), bottom: A.plain } });
  k.cyl(R + 0.0004, R + 0.0004, 0.038, p, { seg: 32, open: true, ts: PI + 0.45, tl: TAU - 0.9, p: [0, 0.031, 0], uv: A.R(0, 0, 512, 180) });
  k.cyl(0.0193, 0.0193, 0.017, p, { seg: 32, p: [0, 0.0655, 0], faces: { side: A.R(0, 320, 512, 60), top: A.R(130, 384, 120, 120), bottom: A.plain } });
  k.colCyl(0.0192, 0.074, [0, 0.037, 0]);
  return { kit: k, meta: { mass: 0.06, material: 'plastic', hold: { grip: [0, 0.035, 0], rot: [0.12, -0.2, 0.05], off: [0, 0.02, 0] } } };
});

// ---------------------------------------------------------------- painkillers (blister pack)
def('painkillers', () => {
  const A = atlas('painkillers', 512, 512, (c) => {
    // top print (0,0,512,288): bubbles at cols x = 0.1..0.9, rows
    rect(c, 0, 0, 512, 288, '#d9dfe6');
    noise(c, 0, 0, 512, 288, 10, 5);
    rect(c, 0, 0, 512, 54, '#1f5fa8');
    txt(c, 'PAIN-B-GONE', 170, 28, { size: 34, color: '#fff', weight: '900', italic: true, maxW: 300 });
    txt(c, 'IBUPROFEN 200 mg', 410, 28, { size: 17, color: '#cfe2ff', fam: MONO, maxW: 180 });
    for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) {
      const x = 512 * (0.14 + i * 0.18), y = 288 * (0.42 + j * 0.36);
      c.strokeStyle = 'rgba(31,95,168,0.5)'; c.lineWidth = 2;
      c.beginPath(); c.arc(x, y, 40, 0, TAU); c.stroke();
      txt(c, ['MON', 'TUE', 'WED', 'THU', 'FRI'][i], x, y + 52 - (j ? 104 : 0) + (j ? 0 : 0), { size: 11, color: '#1f5fa8', fam: MONO });
    }
    // popped holes
    for (const [i, j] of [[4, 0], [3, 1]]) {
      const x = 512 * (0.14 + i * 0.18), y = 288 * (0.42 + j * 0.36);
      c.fillStyle = '#8a8f96'; c.beginPath();
      for (let a = 0; a < TAU; a += 0.4) c.lineTo(x + Math.cos(a) * (30 + (a * 7) % 9), y + Math.sin(a) * (30 + (a * 5) % 8));
      c.fill();
      c.fillStyle = '#3a3e44'; c.beginPath(); c.arc(x, y, 22, 0, TAU); c.fill();
    }
    txt(c, 'R.O.O.M. PHARMA — for pain, existential or otherwise', 256, 276, { size: 12, color: '#1f5fa8', fam: MONO, maxW: 490 });
    // foil back (0,292,512,150)
    rect(c, 0, 292, 512, 150, '#c9ced4');
    for (let y = 300; y < 440; y += 22) for (let x = (y / 22 % 2) * 60; x < 512; x += 120) txt(c, 'PAIN-B-GONE', x, y, { size: 12, color: 'rgba(31,95,168,0.6)', fam: MONO, align: 'left' });
    noise(c, 0, 292, 512, 150, 14, 2);
  });
  const card = paint(A, { rough: 0.35, metal: 0.2 });
  const k = new Kit();
  const W = 0.1, D = 0.056, t = 0.0012;
  k.box(W, t, D, card, { faces: { py: A.R(0, 0, 512, 288), ny: A.R(0, 292, 512, 150), px: A.plain, nx: A.plain, pz: A.plain, nz: A.plain } });
  const domeGeo = () => new THREE.SphereGeometry(0.0078, 12, 4, 0, TAU, 0, PI / 2);
  for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) {
    const x = (0.14 + i * 0.18 - 0.5) * W, z = -(0.42 + j * 0.36 - 0.5) * D;
    const popped = (i === 4 && j === 0) || (i === 3 && j === 1);
    k.add(domeGeo(), M.clearPlastic(), { p: [x, t / 2, z], s: [1, popped ? 0.18 : 0.62, 1] });
    if (!popped) k.lathe([[0, -0.0016], [0.0045, -0.0015], [0.0058, -0.0007], [0.006, 0.0], [0.0058, 0.0007], [0.0045, 0.0015], [0, 0.0016]], card, { seg: 14, p: [x, t / 2 + 0.0019, z], col: 0xb8551f });
  }
  k.colBox([W, 0.006, D], [0, 0.0018, 0]);
  return { kit: k, meta: { mass: 0.02, material: 'plastic', hold: { grip: [0, 0, 0], rot: [1.25, 0.1, 0.12], off: [0, 0.035, 0] } } };
});

// ---------------------------------------------------------------- splint
def('splint', () => {
  const A = atlas('splint', 1024, 256, (c) => {
    woodGrain(c, 0, 0, 1024, 80, { seed: 3, base: '#dcc196', knots: 1, knotSize: 10 });
    woodGrain(c, 0, 84, 1024, 80, { seed: 4, base: '#d6b98a', knots: 1, knotSize: 9 });
    // stencil on slat 1
    c.fillStyle = 'rgba(190,30,25,0.85)';
    c.fillRect(140, 28, 24, 8); c.fillRect(148, 20, 8, 24);
    txt(c, 'R.O.O.M. MED', 270, 33, { size: 26, color: 'rgba(190,30,25,0.85)', fam: MONO, maxW: 190 });
    txt(c, 'SPLINT • SINGLE USE', 700, 116, { size: 18, color: 'rgba(40,30,20,0.6)', fam: MONO });
    // edges (0,168,1024,30)
    woodGrain(c, 0, 168, 1024, 30, { seed: 5, base: '#cdb085', knots: 0, lines: 14 });
    endGrain(c, 0, 200, 60, 50, { seed: 2 });
    // tape (100,200,300,50)
    rect(c, 100, 200, 300, 50, '#f6f4ec');
    for (let x = 100; x < 400; x += 3) rect(c, x, 200, 1, 50, 'rgba(150,140,120,0.2)');
    noise(c, 100, 200, 300, 50, 8, 3);
    wear(c, 0, 0, 1024, 198, 9, 1.0, { lightRatio: 0.2 });
  });
  const p = paint(A, { rough: 0.85 });
  const k = new Kit();
  const L = 0.32, t = 0.007, w = 0.042, gap = 0.01;
  const tape = A.R(100, 200, 300, 50);
  for (const [i, sz] of [[0, -1], [1, 1]]) {
    const top = i === 0 ? A.R(0, 0, 1024, 80) : A.R(0, 84, 1024, 80);
    k.box(L, t, w, p, { p: [0, 0, sz * (w + gap) / 2], faces: { py: top, ny: top, pz: A.R(0, 168, 1024, 30), nz: A.R(0, 168, 1024, 30), px: A.R(0, 200, 60, 50), nx: A.R(0, 200, 60, 50) } });
  }
  for (const x of [-0.09, 0.09]) {
    k.rbox(0.028, t + 0.0022, 2 * w + gap + 0.0022, 0.0011, p, { p: [x, 0, 0], uv: tape, rs: 1 });
  }
  // loose tape tail
  k.add(sheetGeo(2, 6, (u, v) => [0.09 + (u - 0.5) * 0.026, t / 2 + 0.0012 + v * v * 0.006, (w + gap / 2 + 0.0012) + v * 0.022]), p, { uv: tape });
  k.colBox([L, t + 0.003, 2 * w + gap + 0.003]);
  return { kit: k, meta: { mass: 0.25, material: 'wood', hold: { grip: [-0.09, 0, 0], rot: [0.45, 1.35, 0.0], off: [0, 0.01, 0] } } };
});

// ---------------------------------------------------------------- paper_cup
def('paper_cup', () => {
  const A = atlas('paper_cup', 512, 256, (c) => {
    // outer print (0,0,512,160): u around, v up
    rect(c, 0, 0, 512, 160, '#fbfbf7');
    c.fillStyle = '#7fb2dc';
    c.beginPath(); c.moveTo(0, 122);
    for (let x = 0; x <= 512; x += 8) c.lineTo(x, 122 + Math.sin(x / 512 * TAU * 4) * 7);
    c.lineTo(512, 160); c.lineTo(0, 160); c.fill();
    c.fillStyle = '#3f7fbf';
    for (const x of [256, 0, 512]) {
      c.beginPath(); c.moveTo(x, 18); c.quadraticCurveTo(x + 16, 44, x, 52); c.quadraticCurveTo(x - 16, 44, x, 18); c.fill();
      txt(c, 'R.O.O.M.', x, 74, { size: 22, color: '#2c5d8a', weight: '900' });
      txt(c, 'HYDRATION BREAK', x, 96, { size: 11, color: '#2c5d8a', fam: MONO });
      txt(c, '30 SECONDS', x, 110, { size: 10, color: '#2c5d8a', fam: MONO });
    }
    wear(c, 0, 0, 512, 160, 2, 0.6, { edge: false, lightRatio: 0.1 });
  });
  const p = paint(A, { rough: 0.85 });
  const waterMat = new THREE.MeshStandardMaterial({ name: 'cup_water', color: 0x4f8fc0, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.86, depthWrite: false, envMapIntensity: 1.6 });
  const k = new Kit();
  const r0 = 0.024, r1 = 0.0355, H = 0.082;
  const rAt = (y) => r0 + (r1 - r0) * (y / H);
  k.lathe([[r0 - 0.0005, 0.0, 1], [r0, 0.0015], [rAt(H - 0.002), H - 0.002]], p, { seg: 32, vFromY: [0, H], uv: A.R(0, 0, 512, 160) });
  // rolled lip + inside wall + floor
  k.torus(r1 + 0.0003, 0.0016, p, { p: [0, H - 0.0012, 0], r: [PI / 2, 0, 0], rseg: 6, tseg: 32 });
  k.lathe([[r1 - 0.0008, H - 0.0005], [rAt(0.004) - 0.0008, 0.004], [0, 0.0042]], p, { seg: 32, col: 0xf2f0ea });
  k.lathe([[0, 0.0003], [r0 - 0.0005, 0.0003, 1], [r0 - 0.0005, 0.0]], p, { seg: 24, col: 0xe6e3da });
  // water surface (part)
  const fillY = 0.004 + (H - 0.012) * 0.8;
  k.add(new THREE.CircleGeometry(rAt(fillY) - 0.0009, 28), waterMat, { p: [0, fillY, 0], r: [-PI / 2, 0, 0], part: 'water' });
  k.colCyl(r1, H, [0, H / 2, 0]);
  return {
    kit: k,
    meta: {
      mass: 0.12, material: 'paper', hold: { grip: [0, 0.035, 0], rot: [0.12, 0, 0.04], off: [0, 0.015, 0] },
      init(inst, opts) {
        const w = inst.parts.water;
        const base = w.position.y - fillY;
        const set = (f) => {
          f = Math.max(0, Math.min(1, f));
          w.visible = f > 0.01;
          const y = 0.004 + (H - 0.012) * f;
          w.position.y = base + y;
          const s = (rAt(y) - 0.0009) / (rAt(fillY) - 0.0009);
          w.scale.set(s, s, s);
        };
        inst.object.userData.setFill = set;
        set(opts.fill ?? 0.8);
      },
    },
  };
});

// ---------------------------------------------------------------- shared flame / dark glass
function flameMaterial() {
  const A = atlas('flame_grad', 64, 256, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.3)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 256);
  }, { clear: true });
  const m = new THREE.MeshBasicMaterial({ name: 'item_flame', map: A.tex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  m.color.setScalar(2.4); // HDR so bloom picks it up
  return m;
}
// Flame cones along -Z from `tip` (outer colour + hot inner core) as one part mesh
function flameGeos(k, mat, tip, len, rad, part, outer, inner) {
  k.cyl(0.0004, rad, len, mat, { seg: 12, hseg: 3, open: true, r: [-PI / 2, 0, 0], p: [tip[0], tip[1], tip[2] - len / 2], part, keepUV: true, col: outer, bounds: false });
  k.cyl(0.0003, rad * 0.5, len * 0.55, mat, { seg: 10, hseg: 2, open: true, r: [-PI / 2, 0, 0], p: [tip[0], tip[1], tip[2] - len * 0.275], part, keepUV: true, col: inner, bounds: false });
  k.sphere(rad * 0.6, mat, { ws: 10, hs: 6, p: tip, part, uvFn: () => [0.5, 0.06], col: inner, bounds: false });
  k.pivot(part, tip);
}
const darkGlass = () => smat('darkGlass', () => new THREE.MeshPhysicalMaterial({ name: 'item_darkglass', color: 0x0b1018, roughness: 0.04, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6 }));

// ---------------------------------------------------------------- welder
def('welder', () => {
  const A = atlas('welder', 1024, 512, (c) => {
    // cylinder wrap (0,0,512,400): u around (top at x=256), v along (forward = up)
    rect(c, 0, 0, 512, 400, '#a8221c');
    noise(c, 0, 0, 512, 400, 10, 2);
    rect(c, 0, 110, 512, 190, '#efe9d8');
    rect(c, 0, 110, 512, 8, '#151515'); rect(c, 0, 292, 512, 8, '#151515');
    for (const [x, r] of [[128, PI / 2], [384, -PI / 2]]) {
      txt(c, 'ACETYLENE', x, 205, { size: 46, color: '#a8221c', weight: '900', rot: r, maxW: 170 });
      txt(c, 'R.O.O.M. FABRICATION', x + (r > 0 ? -42 : 42), 205, { size: 17, color: '#151515', fam: MONO, rot: r, maxW: 170 });
      txt(c, 'FLAMMABLE GAS 2.1', x + (r > 0 ? 40 : -40), 205, { size: 15, color: '#151515', fam: MONO, rot: r, maxW: 170 });
    }
    hazardDiamond(c, 256, 205, 70, '#c8241c', '#fff', 'FLAMMABLE');
    hazardDiamond(c, 0, 205, 70, '#c8241c', '#fff', '');
    hazardDiamond(c, 512, 205, 70, '#c8241c', '#fff', '');
    txt(c, 'PROPERTY OF R.O.O.M.', 256, 340, { size: 16, color: '#efe9d8', weight: '900', maxW: 220 });
    txt(c, 'DO NOT WELD IN DIMENSION 0', 256, 60, { size: 14, color: '#efe9d8', fam: MONO, maxW: 230 });
    wear(c, 0, 0, 512, 400, 4, 2.5, { edge: false, lightRatio: 0.6 });
    // gauge face (520,0,160,160)
    rect(c, 520, 0, 160, 160, '#222');
    c.fillStyle = '#f4f0e4'; c.beginPath(); c.arc(600, 80, 74, 0, TAU); c.fill();
    c.strokeStyle = '#c8241c'; c.lineWidth = 10; c.beginPath(); c.arc(600, 80, 60, -0.2, 0.6); c.stroke();
    c.strokeStyle = '#111'; c.lineWidth = 2;
    for (let i = 0; i <= 10; i++) { const a = PI * 0.8 + i * PI * 0.14; c.beginPath(); c.moveTo(600 + Math.cos(a) * 62, 80 + Math.sin(a) * 62); c.lineTo(600 + Math.cos(a) * 70, 80 + Math.sin(a) * 70); c.stroke(); }
    c.lineWidth = 4; c.beginPath(); c.moveTo(600, 80); c.lineTo(600 + Math.cos(PI * 1.7) * 55, 80 + Math.sin(PI * 1.7) * 55); c.stroke();
    txt(c, 'PSI', 600, 120, { size: 14, color: '#111', fam: MONO });
    txt(c, 'R.O.O.M.', 600, 40, { size: 11, color: '#111', fam: MONO });
    // knurl (700,0,200,60)
    rect(c, 700, 0, 200, 60, '#2a2a2a');
    for (let x = 700; x < 900; x += 6) rect(c, x, 0, 2, 60, 'rgba(255,255,255,0.15)');
  });
  const red = paint(A, { rough: 0.42, metal: 0.3 });
  const blk = red;
  const met = paint(A, { rough: 0.3, metal: 1 }); // vertex-tinted brass / steel / copper
  const BRASS = 0xc9a65a, STEEL = 0xb8bcc0, COPPER = 0xc2703d, CHROME = 0xe6e8ea;
  const k = new Kit();
  const Rc = 0.042;
  // gas cylinder (lathe along +Y -> -Z)
  k.push({ p: [0, 0, 0.11], r: [-PI / 2, 0, 0] });
  k.lathe([[0, 0.002], [0.026, 0.0], [0.036, 0.004], [0.041, 0.014], [Rc, 0.026], [Rc, 0.15], [0.039, 0.168], [0.03, 0.182], [0.017, 0.19], [0.0125, 0.193], [0.0125, 0.2]], red, { seg: 32, vFromY: [0, 0.2], uv: A.R(0, 0, 512, 400) });
  // foot ring
  k.lathe([[0.03, -0.004], [0.039, -0.004], [0.04, 0.012], [0.037, 0.014]], blk, { seg: 24, col: 0x222222 });
  // straps
  for (const y of [0.05, 0.13]) k.cyl(Rc + 0.0018, Rc + 0.0018, 0.008, met, { p: [0, y, 0], seg: 32, col: STEEL });
  k.pop();
  // valve + regulator + gauge
  k.rbox(0.026, 0.03, 0.026, 0.004, met, { p: [0, 0, -0.1], rs: 1, col: BRASS });
  k.cyl(0.013, 0.013, 0.006, blk, { p: [0, 0.021, -0.1], col: 0x1a1a1a, seg: 16 });
  k.cyl(0.0035, 0.0035, 0.008, met, { p: [0, 0.017, -0.1], seg: 8, col: BRASS });
  k.cyl(0.011, 0.011, 0.028, met, { p: [0.024, 0, -0.1], r: [0, 0, PI / 2], seg: 16, col: BRASS });
  k.cyl(0.016, 0.016, 0.012, met, { p: [0.03, 0.016, -0.1], seg: 24, col: CHROME });
  k.cyl(0.0145, 0.0145, 0.0125, blk, { p: [0.03, 0.0162, -0.1], seg: 24, faces: { top: A.R(520, 0, 160, 160) }, col: 0xffffff });
    // torch handle (on saddle clips above the cylinder)
  const ty = Rc + 0.016;
  for (const z of [-0.06, 0.02]) k.rbox(0.014, 0.014, 0.012, 0.003, met, { p: [0, Rc + 0.006, z], rs: 1, col: STEEL });
  k.cyl(0.0105, 0.0105, 0.13, blk, { p: [0, ty, -0.015], r: [PI / 2, 0, 0], seg: 16, uv: A.R(700, 0, 200, 60), col: 0xffffff });
  k.cyl(0.0115, 0.0115, 0.022, met, { p: [0, ty, 0.06], r: [PI / 2, 0, 0], seg: 16, col: BRASS });
  k.cyl(0.0095, 0.0115, 0.02, met, { p: [0, ty, -0.09], r: [PI / 2, 0, 0], seg: 16, col: BRASS });
  // valve knobs (red / blue)
  k.cyl(0.0075, 0.0075, 0.006, red, { p: [0.014, ty, 0.055], r: [0, 0, PI / 2], seg: 12, col: 0xc8241c });
  k.cyl(0.0075, 0.0075, 0.006, red, { p: [-0.014, ty, 0.055], r: [0, 0, PI / 2], seg: 12, col: 0x2f5d9e });
  // neck tube bending down to the nozzle
  const tip = [0, ty - 0.03, -0.205];
  k.tube([[0, ty, -0.098], [0, ty, -0.14], [0, ty - 0.008, -0.175], [0, ty - 0.022, -0.195], [tip[0], tip[1] + 0.004, tip[2] + 0.006]], 0.0042, met, { tseg: 20, rseg: 8, col: BRASS });
  k.cyl(0.0062, 0.0035, 0.016, met, { p: [0, ty - 0.026, -0.2], r: [-PI / 2 - 0.65, 0, 0], seg: 12, col: COPPER });
  // hose: regulator -> torch back
  k.tube([[0.038, 0, -0.1], [0.052, -0.004, -0.07], [0.054, 0.004, -0.01], [0.05, 0.025, 0.05], [0.03, ty + 0.002, 0.085], [0.006, ty, 0.078]], 0.0042, red, { tseg: 40, rseg: 7, col: 0x8f1f18 });
  k.colCyl(Rc, 0.21, [0, 0, 0.005], [PI / 2, 0, 0]);
  k.colBox([0.03, 0.03, 0.2], [0, ty, -0.06]);
  k.colBox([0.04, 0.04, 0.04], [0.02, 0.01, -0.1]);
  k.anchor('tip', [0, tip[1] - 0.004, tip[2] - 0.004]);
  return { kit: k, meta: { mass: 2.4, material: 'metal', hold: { grip: [0, ty, -0.015], rot: [0.12, 0.12, 0] , off: [0, 0.06, -0.02] } } };
});

// ---------------------------------------------------------------- camera_disposable
def('camera_disposable', () => {
  const A = atlas('camera_disposable', 1024, 512, (c) => {
    // front (0,0,512,280) -- lens at left-centre
    rect(c, 0, 0, 512, 280, ROOM_YELLOW);
    noise(c, 0, 0, 512, 280, 10, 3);
    rect(c, 0, 0, 512, 52, INK);
    brand(c, 256, 27, 26, ROOM_YELLOW);
    txt(c, 'SNAPSHOT', 340, 112, { size: 54, color: INK, weight: '900', italic: true, maxW: 290 });
    txt(c, '27 EXP • ISO 400', 340, 158, { size: 22, color: INK, fam: MONO, maxW: 290 });
    txt(c, 'WITH FLASH ⚡', 340, 190, { size: 20, color: '#c0302a', weight: '900', maxW: 290 });
    rect(c, 0, 228, 512, 52, INK);
    txt(c, 'DOCUMENT ANOMALIES FOR CORPORATE', 256, 254, { size: 17, color: ROOM_YELLOW, fam: MONO, maxW: 480 });
    wear(c, 0, 0, 512, 280, 5, 1.6);
    // back (512,0,512,280)
    rect(c, 512, 0, 512, 280, '#1a1a1a');
    rect(c, 512, 220, 512, 60, ROOM_YELLOW);
    txt(c, 'PROPERTY OF R.O.O.M.', 768, 250, { size: 24, color: INK, weight: '900', maxW: 460 });
    txt(c, 'DO NOT PHOTOGRAPH DIMENSION 0', 768, 150, { size: 18, color: ROOM_YELLOW, fam: MONO, maxW: 460 });
    txt(c, 'SUBMIT ALL FILM TO SUBLEVEL 2', 768, 178, { size: 14, color: '#bbb', fam: MONO, maxW: 460 });
    txt(c, 'WIND ⟶', 940, 40, { size: 22, color: ROOM_YELLOW, weight: '900' });
    wear(c, 512, 0, 512, 280, 6, 1.6);
    // top (0,290,512,90)
    rect(c, 0, 290, 512, 90, '#1a1a1a');
    rrect(c, 300, 312, 46, 30, 4, '#0c0c0c', '#555', 2);
    txt(c, '24', 323, 328, { size: 18, color: '#f4f0e4', fam: VT });
    txt(c, 'R.O.O.M. SNAPSHOT', 150, 336, { size: 20, color: ROOM_YELLOW, weight: '900', maxW: 230 });
    // sides (0,384,200,60)
    rect(c, 0, 384, 200, 60, ROOM_YELLOW);
    txt(c, 'R.O.O.M.', 100, 414, { size: 26, color: INK, weight: '900' });
    // flash diffuser (210,384,100,50)
    rect(c, 210, 384, 100, 50, '#f2f2ea');
    for (let x = 210; x < 310; x += 5) rect(c, x, 384, 2, 50, 'rgba(0,0,0,0.12)');
    // knurl (320,384,200,40)
    rect(c, 320, 384, 200, 40, '#222');
    for (let x = 320; x < 520; x += 6) rect(c, x, 384, 3, 40, 'rgba(255,255,255,0.18)');
  });
  const p = paint(A, { rough: 0.6 });
  const k = new Kit();
  const W = 0.112, H = 0.058, D = 0.034;
  const side = A.R(0, 384, 200, 60);
  k.rbox(W, H, D, 0.005, p, { faces: { nz: A.R(0, 0, 512, 280), pz: A.R(512, 0, 512, 280), py: A.R(0, 290, 512, 90), ny: A.plain, px: side, nx: side } });
  // lens barrel + glass
  const lx = 0.02, ly = -0.001;
  k.cyl(0.014, 0.015, 0.008, p, { p: [lx, ly, -D / 2 - 0.004], r: [PI / 2, 0, 0], col: 0x161616, seg: 24 });
  k.cyl(0.0105, 0.0105, 0.004, p, { p: [lx, ly, -D / 2 - 0.0085], r: [PI / 2, 0, 0], col: 0x242424, seg: 24 });
  k.cyl(0.0075, 0.0075, 0.001, darkGlass(), { p: [lx, ly, -D / 2 - 0.0105], r: [PI / 2, 0, 0], seg: 20 });
  // flash window (front, top-left as seen from the front)
  k.rbox(0.03, 0.015, 0.004, 0.0015, p, { p: [-0.03, 0.017, -D / 2 - 0.0005], uv: A.R(210, 384, 100, 50), rs: 1 });
  // viewfinder front & back
  k.rbox(0.012, 0.009, 0.004, 0.0015, darkGlass(), { p: [0.03, 0.02, -D / 2 - 0.0004], rs: 1 });
  k.rbox(0.011, 0.008, 0.004, 0.0015, darkGlass(), { p: [0.03, 0.02, D / 2 + 0.0004], rs: 1 });
  // shutter button + flash button
  k.cyl(0.0042, 0.0042, 0.004, p, { p: [-0.035, H / 2 + 0.0015, 0.004], col: 0xc0302a, seg: 14 });
  k.rbox(0.008, 0.012, 0.003, 0.0012, p, { p: [-0.05, 0.0, -D / 2 - 0.001], col: 0x161616, rs: 1 });
  // film wind wheel
  k.cyl(0.0095, 0.0095, 0.007, p, { p: [-0.042, H / 2 - 0.002, D / 2 - 0.004], seg: 20, faces: { side: A.R(320, 384, 200, 40), top: A.plain, bottom: A.plain }, col: 0xffffff });
  k.colBox([W, H, D + 0.012], [0, 0, -0.005]);
  return { kit: k, meta: { mass: 0.12, material: 'plastic', hold: { grip: [-0.03, 0, 0], rot: [0.05, 0.12, 0], off: [-0.02, 0.03, 0] } } };
});

// ---------------------------------------------------------------- battery (6V lantern)
def('battery', () => {
  const A = atlas('battery', 1024, 512, (c) => {
    // 4 side panels (each 256x400): x0 front, 256 right, 512 back, 768 left
    rect(c, 0, 0, 1024, 400, '#1b1b1d');
    noise(c, 0, 0, 1024, 400, 8, 7);
    rect(c, 0, 250, 1024, 110, ROOM_YELLOW);
    c.fillStyle = '#e8661c';
    for (let x = 0; x < 1024; x += 64) { c.beginPath(); c.moveTo(x, 250); c.lineTo(x + 32, 250); c.lineTo(x + 12, 360); c.lineTo(x - 20, 360); c.fill(); }
    rect(c, 0, 250, 1024, 6, '#111'); rect(c, 0, 354, 1024, 6, '#111');
    for (const x0 of [0, 512]) {
      brand(c, x0 + 128, 36, 22, ROOM_YELLOW);
      txt(c, '6V', x0 + 128, 120, { size: 110, color: '#fff', weight: '900', maxW: 220 });
      txt(c, 'POWER CELL', x0 + 128, 196, { size: 30, color: ROOM_YELLOW, weight: '900', maxW: 220 });
      txt(c, 'HEAVY DUTY LANTERN', x0 + 128, 228, { size: 16, color: '#ddd', fam: MONO, maxW: 220 });
      c.fillStyle = '#111';
      c.beginPath(); c.moveTo(x0 + 140, 262); c.lineTo(x0 + 104, 312); c.lineTo(x0 + 128, 312); c.lineTo(x0 + 116, 350); c.lineTo(x0 + 156, 296); c.lineTo(x0 + 132, 296); c.fill();
    }
    for (const x0 of [256, 768]) {
      txt(c, 'DO NOT LICK', x0 + 128, 60, { size: 26, color: ROOM_YELLOW, weight: '900', maxW: 220 });
      txt(c, 'TERMINALS', x0 + 128, 92, { size: 26, color: ROOM_YELLOW, weight: '900', maxW: 220 });
      txt(c, 'PROPERTY OF R.O.O.M.', x0 + 128, 150, { size: 17, color: '#fff', weight: '900', maxW: 220 });
      txt(c, 'Do not discharge into', x0 + 128, 176, { size: 14, color: '#bbb', fam: MONO, maxW: 220 });
      txt(c, 'Dimension 0.', x0 + 128, 194, { size: 14, color: '#bbb', fam: MONO, maxW: 220 });
    }
    barcode(c, 768 + 58, 205, 140, 40, 62, false);
    wear(c, 0, 0, 1024, 400, 8, 1.8);
    // top cap (0,404,104,104)
    rect(c, 0, 404, 104, 104, '#202022');
    txt(c, '+', 26, 456, { size: 34, color: '#e04030', weight: '900' });
    txt(c, '−', 78, 456, { size: 34, color: '#ddd', weight: '900' });
    noise(c, 0, 404, 104, 104, 10, 3);
  });
  const p = paint(A, { rough: 0.5 });
  const k = new Kit();
  const S = 0.067, H = 0.098;
  k.rbox(S, H, S, 0.006, p, { p: [0, H / 2, 0], rs: 2, faces: { pz: A.R(0, 0, 256, 400), px: A.R(256, 0, 256, 400), nz: A.R(512, 0, 256, 400), nx: A.R(768, 0, 256, 400), py: A.plain, ny: A.plain }, col: 0xffffff });
  k.rbox(S + 0.001, 0.012, S + 0.001, 0.004, p, { p: [0, H + 0.004, 0], faces: { py: A.R(0, 404, 104, 104, 1) }, col: 0xffffff });
  for (const sx of [-1, 1]) {
    k.cyl(0.0045, 0.0045, 0.004, M.brass(), { p: [sx * 0.017, H + 0.011, 0], seg: 12 });
    k.add(new THREE.TubeGeometry(new HelixCurve(0.0055, 0.022, 4.5), 54, 0.0009, 5, false), M.steel(), { p: [sx * 0.017, H + 0.012, 0] });
  }
  k.colBox([S, H + 0.012, S], [0, (H + 0.012) / 2, 0]);
  return { kit: k, meta: { mass: 0.8, material: 'metal', hold: { grip: [0, 0.05, 0], rot: [0.12, -0.3, 0.04], off: [0, 0.01, 0] } } };
});

// ---------------------------------------------------------------- glowstick
def('glowstick', (opts) => {
  const col = new THREE.Color(opts.color ?? 0x39ff6a);
  const glow = new THREE.MeshStandardMaterial({ name: 'glowstick_glow', color: col.clone().multiplyScalar(0.08), emissive: col, emissiveIntensity: 1.0, roughness: 0.3 });
  const A = atlas('glowstick', 128, 128, (c) => { rect(c, 0, 0, 128, 64, '#e8e6dc'); });
  const p = paint(A, { rough: 0.45 });
  const k = new Kit();
  k.push({ r: [PI / 2, 0, 0] });
  k.add(new THREE.CapsuleGeometry(0.0075, 0.134, 4, 14), M.clearPlastic(), {});
  k.add(new THREE.CapsuleGeometry(0.0061, 0.13, 3, 12), glow, { part: 'glow' });
  k.pop();
  // end cap + lanyard loop at +Z
  k.cyl(0.0079, 0.0079, 0.012, p, { p: [0, 0, 0.073], r: [PI / 2, 0, 0], seg: 14, col: 0x2a2a2a });
  k.torus(0.0055, 0.0011, p, { p: [0, 0, 0.0845], r: [0, PI / 2, 0], col: 0x2a2a2a, tseg: 14, rseg: 5 });
  k.colCyl(0.0078, 0.17, [0, 0, 0.004], [PI / 2, 0, 0]);
  return {
    kit: k,
    meta: {
      mass: 0.03, material: 'plastic', hold: { grip: [0, 0, 0.02], rot: [0.75, 0.15, -0.35] },
      init(inst, opts2) {
        const g = inst.parts.glow;
        inst.object.userData.setLit = (on) => { g.material.emissiveIntensity = on ? 1.0 : 0.04; };
        if (opts2.lit === false) inst.object.userData.setLit(false);
      },
    },
  };
}, (o) => `${o.color ?? 'g'}`);

// ---------------------------------------------------------------- flare
def('flare', () => {
  const A = atlas('flare', 512, 512, (c) => {
    // body wrap (0,0,512,400): u around (top x=256), v along (ignition end = top)
    rect(c, 0, 0, 512, 400, '#c4221c');
    noise(c, 0, 0, 512, 400, 12, 9);
    for (const [x, r] of [[256, -PI / 2], [128, PI / 2], [384, -PI / 2]]) {
      txt(c, 'R.O.O.M. EMERGENCY FLARE', x, 200, { size: 26, color: '#fff', weight: '900', rot: r, maxW: 330 });
    }
    txt(c, 'STRIKE AWAY FROM FACE', 300, 200, { size: 15, color: '#ffe23a', fam: MONO, rot: -PI / 2, maxW: 330 });
    txt(c, '15 MIN • FUSEE • DANGER: FLAMMABLE', 212, 200, { size: 14, color: '#ffe23a', fam: MONO, rot: -PI / 2, maxW: 330 });
    txt(c, 'PROPERTY OF R.O.O.M.', 84, 200, { size: 14, color: '#ffe23a', fam: MONO, rot: PI / 2, maxW: 330 });
    rect(c, 0, 18, 512, 10, '#fff'); rect(c, 0, 372, 512, 10, '#fff');
    wear(c, 0, 0, 512, 400, 10, 2, { edge: false });
    // striker cap texture (0,404,256,40)
    rect(c, 0, 404, 256, 40, '#1d1d1d');
    for (let x = 0; x < 256; x += 8) rect(c, x, 404, 3, 40, 'rgba(255,255,255,0.12)');
    // ignition compound (260,404,100,100)
    rect(c, 260, 404, 100, 100, '#3a3430');
    noise(c, 260, 404, 100, 100, 30, 3);
  });
  const p = paint(A, { rough: 0.7 });
  const flame = flameMaterial();
  const k = new Kit();
  const R = 0.0135, L = 0.2;
  k.push({ r: [-PI / 2, 0, 0] }); // +Y -> -Z (ignition end forward)
  k.cyl(R, R, L, p, { p: [0, 0, 0], seg: 24, faces: { side: A.R(0, 0, 512, 400), top: A.R(260, 404, 100, 100), bottom: A.plain }, col: 0xffffff });
  // striker cap (part 'cap') over the ignition end
  k.cyl(R + 0.0013, R + 0.0013, 0.03, p, { p: [0, L / 2 - 0.012, 0], seg: 24, faces: { side: A.R(0, 404, 256, 40), top: A.plain, bottom: A.plain }, col: 0xffffff, part: 'cap' });
  // rear plug
  k.cyl(R - 0.001, R - 0.001, 0.004, p, { p: [0, -L / 2 - 0.0015, 0], seg: 18, col: 0x2a2a2a });
  k.pop();
  // wire stand at the rear (folds along the body)
  k.tube([[0, -R + 0.002, L / 2 - 0.004], [0, -R - 0.0003, L / 2 + 0.01], [0.009, -R - 0.0003, L / 2 + 0.022], [0.017, -R - 0.0003, L / 2 + 0.012]], 0.0011, M.steel(), { tseg: 16, rseg: 5 });
  flameGeos(k, flame, [0, 0, -L / 2 - 0.001], 0.13, 0.024, 'flame', 0xb81204, 0xff9a70);
  k.colCyl(R + 0.001, L + 0.01, [0, 0, 0], [PI / 2, 0, 0]);
  k.anchor('tip', [0, 0, -L / 2 - 0.004]);
  return {
    kit: k,
    meta: {
      mass: 0.2, material: 'cardboard', hold: { grip: [0, 0, 0.03], rot: [0.55, 0.05, 0.05] },
      init(inst, opts) {
        const { flame: f, cap } = inst.parts;
        inst.object.userData.setLit = (on) => { f.visible = !!on; cap.visible = !on; };
        inst.object.userData.setLit(!!opts.lit);
      },
    },
  };
});

// ---------------------------------------------------------------- lighter
def('lighter', () => {
  const A = atlas('lighter', 512, 256, (c) => {
    // broad face (0,0,256,120): length along x (hood at right)
    for (const [y0, back] of [[0, false], [124, true]]) {
      rect(c, 0, y0, 256, 120, ROOM_YELLOW);
      noise(c, 0, y0, 256, 120, 8, 2 + y0);
      if (!back) {
        roomIcon(c, 46, y0 + 60, 44, INK, null, 0.11);
        txt(c, 'R.O.O.M.', 150, y0 + 52, { size: 38, color: INK, weight: '900', maxW: 150 });
        txt(c, 'CORPORATE FIRE', 150, y0 + 84, { size: 13, color: INK, fam: MONO, maxW: 150 });
      } else {
        txt(c, 'PROPERTY OF R.O.O.M.', 128, y0 + 44, { size: 18, color: INK, weight: '900', maxW: 230 });
        txt(c, 'Do not ignite Dimension 0', 128, y0 + 72, { size: 13, color: INK, fam: MONO, maxW: 230 });
        txt(c, 'CHILD-RESISTANT', 128, y0 + 94, { size: 11, color: INK, fam: MONO });
      }
      wear(c, 0, y0, 256, 120, 3 + y0, 2.5);
    }
    // body side swatch (390,0,110,110)
    rect(c, 390, 0, 110, 110, ROOM_YELLOW);
    noise(c, 390, 0, 110, 110, 8, 12);
    // hood slots (260,0,120,80)
    rect(c, 260, 0, 120, 80, '#c8ccd0');
    for (let i = 0; i < 4; i++) rrect(c, 272 + i * 26, 18, 14, 44, 4, '#2a2c30');
    // wheel knurl (260,90,120,40)
    rect(c, 260, 90, 120, 40, '#777');
    for (let x = 260; x < 380; x += 5) rect(c, x, 90, 2, 40, 'rgba(0,0,0,0.4)');
  });
  const p = paint(A, { rough: 0.35 });
  const flame = flameMaterial();
  const k = new Kit();
  const W = 0.0245, T = 0.0125, L = 0.062;
  const face = A.R(0, 0, 256, 120, 1), back = A.R(0, 124, 256, 120, 3);
  const side = A.R(390, 0, 110, 110);
  k.rbox(W, T, L, 0.0058, p, { p: [0, 0, 0.004], faces: { py: face, ny: back, px: side, nx: side, pz: side, nz: side }, rs: 3 });
  // hood
  k.rbox(W * 0.86, T * 0.92, 0.012, 0.0018, M.steel(), { p: [0, 0, -L / 2 - 0.0005], rs: 1 });
  k.rbox(W * 0.87, T * 0.6, 0.0122, 0.0012, p, { p: [0, 0.0016, -L / 2 - 0.0005], faces: { py: A.R(260, 0, 120, 80, 1), ny: A.R(260, 0, 120, 80, 1) }, rs: 1, col: 0xffffff });
  // striker wheel + fork button
  k.cyl(0.0042, 0.0042, 0.0075, p, { p: [0, -0.001, -L / 2 - 0.006], r: [0, 0, PI / 2], seg: 16, faces: { side: A.R(260, 90, 120, 40) }, col: 0xffffff });
  k.rbox(0.008, 0.007, 0.006, 0.0015, p, { p: [0, -0.0035, -L / 2 + 0.003], col: 0xc0302a, rs: 1 });
  flameGeos(k, flame, [0, 0.001, -L / 2 - 0.009], 0.034, 0.0062, 'flame', 0xc85a0a, 0xfff0b0);
  k.colBox([W, T, L + 0.012], [0, 0, -0.002]);
  k.anchor('tip', [0, 0.001, -L / 2 - 0.01]);
  return {
    kit: k,
    meta: {
      mass: 0.02, material: 'plastic', hold: { grip: [0, 0, 0.01], rot: [PI / 2 - 0.1, -0.25, 0.0], off: [0, 0.02, 0] },
      init(inst, opts) {
        inst.object.userData.setLit = (on) => { inst.parts.flame.visible = !!on; };
        inst.object.userData.setLit(!!opts.lit);
      },
    },
  };
});

// ---------------------------------------------------------------- crowbar
def('crowbar', () => {
  const A = atlas('crowbar', 1024, 512, (c) => {
    // shaft paint (0,0,1024,384): u along, v around (v=0.25 top face -> canvas y = 288)
    rect(c, 0, 0, 1024, 384, '#b3261e');
    noise(c, 0, 0, 1024, 384, 14, 5);
    txt(c, 'R.O.O.M.', 380, 288, { size: 46, color: '#f1ece0', weight: '900', ls: 4 });
    txt(c, 'PROPERTY OF TOOL CRIB 4', 700, 288, { size: 20, color: '#f1ece0', fam: MONO });
    txt(c, 'FORGED STEEL • 24"', 600, 96, { size: 20, color: '#f1ece0', fam: MONO });
    // chipped paint
    const r = new RNG(4);
    for (let i = 0; i < 70; i++) {
      const x = r.range(0, 1024), y = r.range(0, 384), w = r.range(3, 16);
      c.fillStyle = r.next() < 0.6 ? '#5c5e60' : '#3a2a20';
      c.beginPath(); c.ellipse(x, y, w, w * r.range(0.3, 0.7), r.next() * PI, 0, TAU); c.fill();
    }
    for (let x = 0; x < 40; x++) rect(c, x, 0, 1, 384, `rgba(80,82,84,${1 - x / 40})`);
    for (let x = 984; x < 1024; x++) rect(c, x, 0, 1, 384, `rgba(80,82,84,${(x - 984) / 40})`);
    wear(c, 0, 0, 1024, 384, 6, 2.5, { edge: false });
  });
  const paintMat = paint(A, { rough: 0.45, metal: 0.4 });
  const steel = M.darkSteel();
  // path in XZ: chisel end (+Z) -> straight -> hook bending toward +X, claw pointing back to +Z
  const pts = [[0.011, 0, 0.3], [0.004, 0, 0.285], [0, 0, 0.265], [0, 0, -0.19]];
  const hc = [0.046, -0.19], hr = 0.046;
  for (let i = 1; i <= 24; i++) { const a = PI - (i / 24) * PI; pts.push([hc[0] + Math.cos(a) * hr, 0, hc[1] - Math.sin(a) * hr]); }
  pts.push([0.094, 0, -0.165], [0.097, 0, -0.145]);
  const path = new PolyCurve(pts);
  const Ltot = path.getLength();
  const prof = (t) => {
    const s = t * Ltot;
    const r = 0.0105;
    let rx = r, ry = r;
    if (s < 0.05) { const f = 1 - s / 0.05; ry = r * (1 - 0.72 * f); rx = r * (1 + 0.3 * f); }
    const e = Ltot - s;
    if (e < 0.045) { const f = 1 - e / 0.045; ry = r * (1 - 0.68 * f); rx = r * (1 + 0.45 * f); }
    return { rx, ry };
  };
  const sChisel = 0.07 / Ltot, sHook = 1 - 0.11 / Ltot;
  const k = new Kit();
  k.add(sweepGeo(path, prof, { seg: 10, sides: 6, t0: 0, t1: sChisel, cap1: false }), steel, { flat: true });
  k.add(sweepGeo(path, prof, { seg: 24, sides: 6, t0: sChisel, t1: sHook, cap0: false, cap1: false }), paintMat, { flat: true, uv: A.R(0, 0, 1024, 384) });
  k.add(sweepGeo(path, prof, { seg: 22, sides: 6, t0: sHook, t1: 1, cap0: false }), steel, { flat: true });
  k.colBox([0.024, 0.022, 0.47], [0.002, 0, 0.06]);
  k.colBox([0.115, 0.022, 0.065], [0.046, 0, -0.205]);
  return { kit: k, meta: { mass: 1.8, material: 'metal', hold: { grip: [0, 0, 0.2], rot: [0.42, 0.25, -1.2], off: [0, -0.02, 0] } } };
});

// ---------------------------------------------------------------- wrench (combination, 13 mm)
def('wrench', () => {
  const D = atlas('wrench_decal', 256, 64, (c) => {
    txt(c, 'R.O.O.M.  13 mm  CR-V', 128, 32, { size: 28, color: '#000', weight: '900', maxW: 240 });
  }, { clear: true });
  const decal = new THREE.MeshStandardMaterial({ name: 'wrench_decal', map: D.tex, color: 0x3a3c40, metalness: 1, roughness: 0.55, transparent: true, alphaTest: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const k = new Kit();
  const chrome = M.chrome();
  // shapes in XY (length along +Y = forward); extruded along Z then laid flat (Z -> Y)
  k.push({ r: [-PI / 2, 0, 0] });
  const shaft = new THREE.Shape();
  shaft.moveTo(-0.0072, -0.092); shaft.lineTo(0.0072, -0.092); shaft.lineTo(0.0064, 0.09); shaft.lineTo(-0.0064, 0.09); shaft.lineTo(-0.0072, -0.092);
  k.add(extrudeGeo(shaft, 0.0034, 0.0009, { bevelSegments: 2 }), chrome, { uvFn: (p) => [p.x * 4 + 0.5, p.y * 4] });
  // open end
  const cx = 0, cy = 0.104, R = 0.0188, w = 0.0067;
  const th = PI / 2 - 0.26, d = [Math.cos(th), Math.sin(th)], n = [d[1], -d[0]];
  const al = Math.asin(w / R), s0 = Math.sqrt(R * R - w * w), sb = -0.0015;
  const P = (o, sd) => [cx + n[0] * o + d[0] * sd, cy + n[1] * o + d[1] * sd];
  const oe = new THREE.Shape();
  oe.moveTo(...P(-w, s0));
  oe.absarc(cx, cy, R, th + al, th - al + TAU, false);
  oe.lineTo(...P(w, sb)); oe.lineTo(...P(-w, sb)); oe.lineTo(...P(-w, s0));
  k.add(extrudeGeo(oe, 0.0046, 0.0009, { curveSegments: 20 }), chrome, { uvFn: (p) => [p.x * 4 + 0.5, p.y * 4] });
  // ring end
  const re = new THREE.Shape();
  re.absarc(0, -0.106, 0.0168, 0, TAU, false);
  const hole = new THREE.Path();
  for (let i = 0; i <= 12; i++) { const a = (i / 12) * TAU, rr = i % 2 ? 0.0088 : 0.0097; const x = Math.cos(a) * rr, y = -0.106 + Math.sin(a) * rr; if (i === 0) hole.moveTo(x, y); else hole.lineTo(x, y); }
  re.holes.push(hole);
  k.add(extrudeGeo(re, 0.0052, 0.0009, { curveSegments: 20 }), chrome, { uvFn: (p) => [p.x * 4 + 0.5, p.y * 4] });
  k.pop();
  k.add(new THREE.PlaneGeometry(0.075, 0.0115), decal, { r: [-PI / 2, 0, -PI / 2], p: [0, 0.00262, -0.01], keepUV: true });
  k.colBox([0.038, 0.0065, 0.25], [0, 0, -0.001]);
  return { kit: k, meta: { mass: 0.25, material: 'metal', hold: { grip: [0, 0, 0.07], rot: [0.5, 0, -0.35] } } };
});

// ---------------------------------------------------------------- tape_roll (duct tape)
def('tape_roll', () => {
  const A = atlas('tape_roll', 512, 512, (c) => {
    // cloth tape (0,0,512,160)
    rect(c, 0, 0, 512, 160, '#9da1a6');
    c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 1;
    for (let i = 0; i < 512; i += 4) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 160); c.stroke(); }
    c.strokeStyle = 'rgba(0,0,0,0.1)';
    for (let j = 0; j < 160; j += 3) { c.beginPath(); c.moveTo(0, j); c.lineTo(512, j); c.stroke(); }
    noise(c, 0, 0, 512, 160, 14, 2);
    wear(c, 0, 0, 512, 160, 3, 1.5, { edge: false, lightRatio: 0.3 });
    // side layers (0,164,256,256) planar ring
    rect(c, 0, 164, 256, 256, '#8c9095');
    for (let r = 0; r < 128; r += 1.6) {
      c.strokeStyle = `rgba(${r % 3.2 < 1.6 ? '60,62,66' : '200,204,208'},0.35)`; c.lineWidth = 0.9;
      c.beginPath(); c.arc(128, 292, r, 0, TAU); c.stroke();
    }
    // core cardboard print (260,164,252,120): seen from inside -> mirrored at mapping
    rect(c, 260, 164, 252, 120, '#b98f5c');
    noise(c, 260, 164, 252, 120, 18, 8);
    txt(c, 'R.O.O.M. DUCT TAPE', 386, 200, { size: 22, color: '#3a2412', weight: '900', maxW: 230 });
    txt(c, 'FIXES MOST THINGS', 386, 228, { size: 14, color: '#3a2412', fam: MONO });
    txt(c, '48mm × 55m', 386, 252, { size: 14, color: '#3a2412', fam: MONO });
    // adhesive side (260,290,252,60)
    rect(c, 260, 290, 252, 60, '#c9cbc6');
    noise(c, 260, 290, 252, 60, 10, 9);
  });
  const p = paint(A, { rough: 0.5, metal: 0.25 });
  const card = paint(A, { rough: 0.9 });
  const k = new Kit();
  const ri = 0.038, ro = 0.055, H = 0.048;
  k.cyl(ro, ro, H, p, { seg: 40, open: true, p: [0, H / 2, 0], uv: A.R(0, 0, 512, 160) });
  const ringUV = A.R(0, 164, 256, 256);
  k.add(new THREE.RingGeometry(ri, ro, 40, 1), p, { r: [-PI / 2, 0, 0], p: [0, H, 0], uv: ringUV });
  k.add(new THREE.RingGeometry(ri, ro, 40, 1), p, { r: [PI / 2, 0, 0], p: [0, 0, 0], uv: ringUV });
  // cardboard core (inside visible)
  k.lathe([[ri + 0.0004, H + 0.0006, 1], [ri - 0.0025, H + 0.0006, 1], [ri - 0.0025, -0.0004, 1], [ri + 0.0004, -0.0004]], card, { seg: 36, vFromY: [-0.001, H + 0.001], uv: A.R(260, 164, 252, 120, 4) });
  // peeled tail
  const a0 = 0.35;
  const tail = (u, v, off) => {
    const L = 0.03, s = v * L;
    const y = 0.0015 + u * (H - 0.003);
    const R0 = ro + off;
    if (s < 0.012) { const a = a0 + s / R0; return [Math.sin(a) * R0, y, Math.cos(a) * R0]; }
    const a = a0 + 0.012 / R0;
    const tx = Math.cos(a), tz = -Math.sin(a), d = s - 0.012;
    const curl = d * d * 9;
    return [Math.sin(a) * R0 + tx * d + Math.sin(a) * curl, y, Math.cos(a) * R0 + tz * d + Math.cos(a) * curl];
  };
  k.add(sheetGeo(3, 10, (u, v) => tail(1 - u, v, 0.0005)), p, { uv: A.R(0, 0, 512, 160, 1) });
  k.add(sheetGeo(3, 10, (u, v) => tail(u, v, 0.0001)), p, { uv: A.R(260, 290, 252, 60, 1) });
  k.colCyl(ro, H, [0, H / 2, 0]);
  return { kit: k, meta: { mass: 0.3, material: 'soft', hold: { grip: [0.035, H / 2, 0], rot: [1.3, 0.25, 0.1], off: [0, 0.02, 0] } } };
});

// ---------------------------------------------------------------- fuse (cartridge, knife-blade)
def('fuse', () => {
  const A = atlas('fuse', 512, 512, (c) => {
    // body wrap (0,0,512,300): u around (top x=256), v along (forward = up)
    rect(c, 0, 0, 512, 300, '#e9dfc6');
    noise(c, 0, 0, 512, 300, 10, 3);
    rect(c, 0, 0, 512, 22, '#b02a20'); rect(c, 0, 278, 512, 22, '#b02a20');
    // window recess at top (u=0.5)
    rrect(c, 216, 60, 80, 180, 10, '#2a2620');
    c.strokeStyle = '#d8dadc'; c.lineWidth = 6;
    c.beginPath(); c.moveTo(256, 62); c.lineTo(256, 120); c.lineTo(248, 128); c.lineTo(264, 136); c.lineTo(256, 144); c.lineTo(256, 238); c.stroke();
    c.fillStyle = '#d8dadc'; c.fillRect(250, 168, 12, 16);
    for (const [x, r] of [[140, -PI / 2], [372, -PI / 2]]) {
      txt(c, 'R.O.O.M. 60A 250V', x, 150, { size: 30, color: '#151515', weight: '900', rot: r, maxW: 240 });
      txt(c, 'TIME-DELAY • REALITY GRADE', x + 38, 150, { size: 15, color: '#b02a20', fam: MONO, rot: r, maxW: 240 });
    }
    wear(c, 0, 0, 512, 300, 5, 1.6, { edge: false });
  });
  const p = paint(A, { rough: 0.55 });
  const k = new Kit();
  const R = 0.0135, L = 0.07;
  k.push({ r: [-PI / 2, 0, 0] });
  k.cyl(R, R, L, p, { seg: 28, open: true, uv: A.R(0, 0, 512, 300) });
  for (const sy of [-1, 1]) {
    k.push({ p: [0, sy * (L / 2 + 0.007), 0], r: sy < 0 ? [PI, 0, 0] : [0, 0, 0] });
    k.lathe([[R - 0.0004, -0.0085, 1], [R + 0.0012, -0.008], [R + 0.0013, -0.004], [R + 0.0008, -0.0035], [R + 0.0008, -0.0015], [R + 0.0013, -0.001], [R + 0.0013, 0.004], [R + 0.0005, 0.0075], [0.0045, 0.008, 1], [0, 0.008]], M.brass(), { seg: 18 });
    // knife blade with mounting hole
    const bs = new THREE.Shape();
    bs.moveTo(-0.0065, 0); bs.lineTo(0.0065, 0); bs.lineTo(0.0065, 0.024); bs.quadraticCurveTo(0.0065, 0.027, 0.0035, 0.027); bs.lineTo(-0.0035, 0.027); bs.quadraticCurveTo(-0.0065, 0.027, -0.0065, 0.024); bs.lineTo(-0.0065, 0);
    const h = new THREE.Path(); h.absarc(0, 0.017, 0.0024, 0, TAU, true); bs.holes.push(h);
    k.add(extrudeGeo(bs, 0.0022, 0.0003, { curveSegments: 8 }), M.brass(), { p: [0, 0.006, 0], uvFn: (q) => [q.x * 10, q.y * 10] });
    k.pop();
  }
  // window glass
  k.rbox(0.009, 0.034, 0.003, 0.0012, M.glass(), { p: [0, 0, R + 0.0002], rs: 1 });
  k.pop();
  k.colCyl(R + 0.0013, L + 0.016, [0, 0, 0], [PI / 2, 0, 0]);
  k.colBox([0.013, 0.0024, L + 0.074], [0, 0, 0]);
  return { kit: k, meta: { mass: 0.12, material: 'metal', hold: { grip: [0, 0, 0], rot: [0.3, 0.9, 0.1], off: [0, 0.03, 0] } } };
});

// ---------------------------------------------------------------- fuel_can (20 L jerrycan)
def('fuel_can', () => {
  const A = atlas('fuel_can', 1024, 512, (c) => {
    // broad side (0,0,512,420): u along Z (front=-Z at right for +X face), v up
    for (const [x0, seed] of [[0, 3], [512, 4]]) {
      rect(c, x0, 0, 512, 420, '#b52a20');
      noise(c, x0, 0, 512, 420, 12, seed);
      // stencils in the triangles of the X
      txt(c, 'R.O.O.M.', x0 + 256, 70, { size: 54, color: '#f1e9d8', fam: MONO, weight: '900', ls: 4, alpha: 0.92 });
      txt(c, 'FUEL', x0 + 256, 340, { size: 60, color: '#f1e9d8', fam: MONO, weight: '900', ls: 8, alpha: 0.92 });
      txt(c, '20 L • GASOLINE', x0 + 256, 384, { size: 20, color: '#f1e9d8', fam: MONO, alpha: 0.9 });
      hazardDiamond(c, x0 + 80, 210, 74, '#c8241c', '#fff', 'FLAMMABLE');
      txt(c, 'NO', x0 + 432, 196, { size: 22, color: '#f1e9d8', fam: MONO, weight: '900' });
      txt(c, 'SMOKING', x0 + 432, 222, { size: 16, color: '#f1e9d8', fam: MONO, weight: '900' });
      // chips + rust
      const r = new RNG(seed);
      for (let i = 0; i < 60; i++) {
        const x = x0 + r.range(0, 512), y = r.range(0, 420), w = r.range(2, 10);
        c.fillStyle = r.next() < 0.5 ? '#5a5650' : '#6a3a1e';
        c.beginPath(); c.ellipse(x, y, w, w * r.range(0.4, 0.9), r.next() * PI, 0, TAU); c.fill();
      }
      for (let i = 0; i < 6; i++) {
        const x = x0 + r.range(20, 490), y = r.range(300, 380);
        const g = c.createLinearGradient(0, y, 0, y + 60);
        g.addColorStop(0, 'rgba(110,55,20,0.5)'); g.addColorStop(1, 'rgba(110,55,20,0)');
        c.fillStyle = g; c.fillRect(x, y, r.range(3, 8), 60);
      }
      wear(c, x0, 0, 512, 420, seed + 10, 3, { edgeK: 1.6 });
    }
    // plain red (0,424,512,80)
    rect(c, 0, 424, 512, 80, '#b52a20');
    noise(c, 0, 424, 512, 80, 12, 9);
    wear(c, 0, 424, 512, 80, 19, 3, { edge: false });
    // cap (520,424,80,80)
    rect(c, 520, 424, 80, 80, '#2e2e2e');
    txt(c, 'R', 560, 464, { size: 40, color: '#666', weight: '900' });
  });
  const red = paint(A, { rough: 0.48, metal: 0.45 });
  const k = new Kit();
  const W = 0.165, H = 0.42, L = 0.345;
  const pr = A.R(0, 424, 512, 80);
  k.rbox(W, H, L, 0.02, red, { p: [0, H / 2, 0], rs: 2, faces: { px: A.R(0, 0, 512, 420), nx: A.R(512, 0, 512, 420), py: pr, ny: pr, pz: pr, nz: pr } });
  // centre weld seam
  k.rbox(0.008, H + 0.007, L + 0.007, 0.004, red, { p: [0, H / 2, 0], uv: pr, rs: 1, col: 0xd8d0c8 });
  // embossed X + frame on both broad faces
  const ang = Math.atan2(H - 0.07, L - 0.07);
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 + 0.0015);
    for (const s of [-1, 1]) k.rbox(0.005, 0.028, Math.hypot(H - 0.08, L - 0.08), 0.0022, red, { p: [x, H / 2, 0], r: [s * ang, 0, 0], uv: pr, rs: 1, col: 0xe8e0d8 });
    k.rbox(0.005, 0.02, L - 0.05, 0.0022, red, { p: [x, H - 0.03, 0], uv: pr, rs: 1, col: 0xe8e0d8 });
    k.rbox(0.005, 0.02, L - 0.05, 0.0022, red, { p: [x, 0.03, 0], uv: pr, rs: 1, col: 0xe8e0d8 });
    k.rbox(0.005, H - 0.05, 0.02, 0.0022, red, { p: [x, H / 2, L / 2 - 0.03], uv: pr, rs: 1, col: 0xe8e0d8 });
    k.rbox(0.005, H - 0.05, 0.02, 0.0022, red, { p: [x, H / 2, -L / 2 + 0.03], uv: pr, rs: 1, col: 0xe8e0d8 });
  }
  // triple handle
  const hy = H + 0.04;
  k.cyl(0.0115, 0.0115, 0.27, red, { p: [0, hy, 0.01], r: [PI / 2, 0, 0], seg: 14, uv: pr });
  for (const z of [-0.12, -0.035, 0.055, 0.14]) k.rbox(0.02, 0.05, 0.014, 0.005, red, { p: [0, H + 0.018, z], uv: pr, rs: 1 });
  // spout neck + cap + clamp lever
  k.push({ p: [0, H - 0.008, -L / 2 + 0.045], r: [-0.55, 0, 0] });
  k.cyl(0.025, 0.027, 0.04, red, { p: [0, 0.02, 0], seg: 20, uv: pr });
  k.cyl(0.029, 0.029, 0.022, red, { p: [0, 0.048, 0], seg: 20, faces: { side: A.R(520, 424, 80, 80), top: A.R(520, 424, 80, 80), bottom: A.plain }, col: 0xffffff });
  k.tube([[0, 0.06, 0.0], [0, 0.07, 0.02], [0, 0.05, 0.05], [0, 0.02, 0.06]], 0.0035, red, { tseg: 12, rseg: 6, col: 0x9a9a9a });
  k.pop();
  k.colBox([W, H, L], [0, H / 2, 0]);
  k.colBox([0.03, 0.06, 0.29], [0, H + 0.03, 0.01]);
  k.colBox([0.06, 0.06, 0.06], [0, H + 0.02, -L / 2 + 0.035]);
  return { kit: k, meta: { mass: 15, material: 'metal', hold: { grip: [0, hy, 0.01], rot: [0, 0, 0.06], off: [0.05, -0.03, 0.05] } } };
});

// ---------------------------------------------------------------- sample_jar
def('sample_jar', () => {
  const A = atlas('sample_jar', 512, 512, (c) => {
    // biohazard label (0,0,512,200)
    rect(c, 0, 0, 512, 200, '#f4cf1d');
    noise(c, 0, 0, 512, 200, 10, 4);
    c.strokeStyle = INK; c.lineWidth = 8; c.strokeRect(8, 8, 496, 184);
    biohazard(c, 90, 100, 62, INK);
    txt(c, 'BIOHAZARD', 300, 46, { size: 44, color: INK, weight: '900', maxW: 330 });
    txt(c, 'R.O.O.M. BIO-CONTAINMENT', 300, 82, { size: 17, color: INK, fam: MONO, maxW: 330 });
    txt(c, 'SPECIMEN #', 220, 128, { size: 22, color: INK, fam: MONO });
    c.fillStyle = INK; c.fillRect(290, 140, 190, 2);
    txt(c, '0042', 380, 124, { size: 36, color: '#1d2b8a', fam: HAND, weight: 'bold', italic: true, rot: -0.06 });
    txt(c, 'LEVEL: ?  DATE: ██/██', 300, 168, { size: 15, color: INK, fam: MONO });
    wear(c, 0, 0, 512, 200, 7, 1.5);
    // lid knurl (0,210,512,50)
    rect(c, 0, 210, 512, 50, '#b8bcc0');
    for (let x = 0; x < 512; x += 6) rect(c, x, 210, 3, 50, 'rgba(0,0,0,0.12)');
    // lid top (0,270,160,160)
    rect(c, 0, 270, 160, 160, '#c4c8cc');
    c.fillStyle = '#f4cf1d'; c.beginPath(); c.arc(80, 350, 58, 0, TAU); c.fill();
    biohazard(c, 80, 350, 42, INK);
    // seal tape (170,270,300,40)
    rect(c, 170, 270, 300, 40, '#d6332a');
    txt(c, 'SEALED • DO NOT OPEN', 320, 290, { size: 18, color: '#fff', weight: '900', maxW: 290 });
  });
  const p = paint(A, { rough: 0.5 });
  const met = paint(A, { rough: 0.32, metal: 0.7 });
  const contents = new THREE.MeshStandardMaterial({ name: 'jar_contents', color: 0x6f9a34, roughness: 0.32, metalness: 0, emissive: 0x000000 });
  const k = new Kit();
  const R = 0.037, Hc = 0.082, y0 = 0.004;
  k.lathe([[0, 0.0012], [0.03, 0.0], [0.035, 0.003], [R, 0.011], [R, 0.084], [0.0345, 0.092], [0.0315, 0.095], [0.0315, 0.1]], M.glass(), { seg: 32 });
  k.lathe([[0, 0], [0.031, 0], [0.0345, 0.004], [0.0352, 0.009], [0.0352, Hc, 1], [0, Hc]], contents, { seg: 28, p: [0, y0, 0], part: 'contents' });
  k.pivot('contents', [0, y0, 0]);
  k.cyl(R + 0.0005, R + 0.0005, 0.045, p, { seg: 20, open: true, ts: -0.95 + PI * 0, tl: 1.9, p: [0, 0.048, 0], uv: A.R(0, 0, 512, 200) });
  k.cyl(0.0338, 0.0338, 0.017, met, { p: [0, 0.1035, 0], seg: 32, faces: { side: A.R(0, 210, 512, 50), top: A.R(0, 270, 160, 160), bottom: A.plain } });
  // seal tape over the lid
  k.add(sheetGeo(1, 8, (u, v) => {
    const t = v * 2 - 1, w = (u - 0.5) * 0.014;
    const top = 0.1122, x = t * 0.0345;
    const y = Math.abs(t) < 0.98 ? top : top - (Math.abs(t) - 0.98) * 1.2;
    return [x, y, w];
  }), p, { uv: A.R(170, 270, 300, 40, 1) });
  k.box(0.014, 0.012, 0.0006, p, { p: [0.0345, 0.106, 0], r: [0, PI / 2, 0], uv: A.R(170, 270, 300, 40, 1) });
  k.box(0.014, 0.012, 0.0006, p, { p: [-0.0345, 0.106, 0], r: [0, PI / 2, 0], uv: A.R(170, 270, 300, 40, 1) });
  k.colCyl(R, 0.112, [0, 0.056, 0]);
  k.anchor('contents', [0, y0 + Hc / 2, 0]);
  return {
    kit: k,
    meta: {
      mass: 0.4, material: 'glass', hold: { grip: [0, 0.05, 0], rot: [0.12, -0.15, 0.05], off: [0, 0.015, 0] },
      init(inst, opts) {
        const m = inst.parts.contents;
        inst.object.userData.setFill = (f) => { f = Math.max(0, Math.min(1, f)); m.visible = f > 0.01; m.scale.y = Math.max(0.01, f); };
        inst.object.userData.setColor = (hex, emissive = 0) => { m.material.color.set(hex); m.material.emissive.set(hex); m.material.emissiveIntensity = emissive; };
        inst.object.userData.setFill(opts.fill ?? 0.65);
        if (opts.color !== undefined) inst.object.userData.setColor(opts.color, opts.glow ?? 0);
      },
    },
  };
});

// ---------------------------------------------------------------- sample_kit (field sample case)
def('sample_kit', () => {
  const A = atlas('sample_kit', 512, 512, (c) => {
    // front label (0,0,512,120)
    rect(c, 0, 0, 512, 120, '#e8661c');
    noise(c, 0, 0, 512, 120, 8, 2);
    rrect(c, 70, 14, 372, 92, 6, '#f6f2e6');
    biohazard(c, 116, 60, 30, INK);
    txt(c, 'FIELD SAMPLE KIT', 290, 44, { size: 30, color: INK, weight: '900', maxW: 270 });
    txt(c, 'R.O.O.M. BIO-CONTAINMENT', 290, 76, { size: 15, color: INK, fam: MONO, maxW: 270 });
    wear(c, 0, 0, 512, 120, 3, 2);
    // case plain orange (0,124,256,80)
    rect(c, 0, 124, 256, 80, '#e8661c');
    noise(c, 0, 124, 256, 80, 8, 3);
    wear(c, 0, 124, 256, 80, 4, 2, { edge: false });
    // foam (260,124,240,120)
    rect(c, 260, 124, 240, 120, '#3a3c40');
    noise(c, 260, 124, 240, 120, 30, 5);
    // tube label (0,210,256,60)
    rect(c, 0, 210, 256, 60, '#f6f2e6');
    txt(c, 'SPECIMEN', 128, 228, { size: 18, color: INK, weight: '900' });
    txt(c, 'R.O.O.M. LAB  #____', 128, 252, { size: 13, color: '#444', fam: MONO });
    // lid sticker (0,280,300,120)
    rect(c, 0, 280, 300, 120, ROOM_YELLOW);
    txt(c, 'DO NOT OPEN', 150, 316, { size: 30, color: INK, weight: '900' });
    txt(c, 'OUTSIDE DESIGNATED ZONES', 150, 350, { size: 14, color: INK, fam: MONO });
    roomIcon(c, 150, 378, 22, INK, null, 0.12);
  });
  const p = paint(A, { rough: 0.42 });
  const k = new Kit();
  const W = 0.17, D = 0.11, Hb = 0.03, Hl = 0.016;
  const plain = A.R(0, 124, 256, 80);
  k.rbox(W, Hb, D, 0.008, p, { p: [0, Hb / 2, 0], faces: { pz: A.R(0, 0, 512, 120), px: plain, nx: plain, py: plain, ny: plain, nz: plain } });
  // foam insert with tubes
  k.box(W - 0.014, 0.002, D - 0.014, p, { p: [0, Hb - 0.0005, 0], uv: A.R(260, 124, 240, 120) });
  const caps = [0xc0302a, 0x2f5d9e, 0x3f8a4a];
  const fills = [0x8a1a3a, 0x6f9a34, 0xd8c040];
  caps.forEach((cc, i) => {
    const z = -0.03 + i * 0.03, y = Hb + 0.004;
    k.cyl(0.0068, 0.0068, 0.08, M.clearPlastic(), { p: [-0.008, y, z], r: [0, 0, PI / 2], seg: 14 });
    k.cyl(0.0058, 0.0058, 0.05, p, { p: [0.004, y - 0.0005, z], r: [0, 0, PI / 2], seg: 12, col: fills[i] });
    k.cyl(0.0072, 0.0072, 0.016, p, { p: [0.04, y, z], r: [0, 0, PI / 2], seg: 14, col: cc });
    k.cyl(0.0071, 0.0071, 0.03, p, { p: [-0.025, y, z], r: [0, 0, PI / 2], seg: 14, open: true, ts: PI * 0.6, tl: PI * 0.8, uv: A.R(0, 210, 256, 60, 1) });
  });
  // clear lid with orange frame + sticker
  const ly = Hb + 0.002 + Hl / 2;
  k.rbox(W, 0.003, D, 0.004, M.clearPlastic(), { p: [0, Hb + 0.002 + Hl - 0.0015, 0], rs: 1 });
  for (const sz of [-1, 1]) k.rbox(W + 0.002, Hl, 0.01, 0.003, p, { p: [0, ly, sz * (D / 2 - 0.004)], uv: plain, rs: 1 });
  for (const sx of [-1, 1]) k.rbox(0.01, Hl, D + 0.002, 0.003, p, { p: [sx * (W / 2 - 0.004), ly, 0], uv: plain, rs: 1 });
  k.box(0.055, 0.0006, 0.024, p, { p: [0.045, Hb + 0.002 + Hl + 0.0003, -0.03], uv: A.R(0, 280, 300, 120) });
  // latches + hinges
  for (const sx of [-1, 1]) {
    k.rbox(0.018, 0.022, 0.006, 0.002, p, { p: [sx * 0.055, Hb, D / 2 + 0.002], col: 0x3a3c40, rs: 1 });
    k.cyl(0.004, 0.004, 0.03, p, { p: [sx * 0.05, Hb + 0.002, -D / 2 - 0.002], r: [0, 0, PI / 2], seg: 10, col: 0xc85a14 });
  }
  k.colBox([W, Hb + Hl + 0.004, D], [0, (Hb + Hl + 0.004) / 2, 0]);
  return { kit: k, meta: { mass: 0.5, material: 'plastic', hold: { grip: [0, 0.01, D / 2], rot: [1.05, 0, 0.04], off: [-0.02, 0.0, 0.02] } } };
});

// ---------------------------------------------------------------- keycard
const KEY_LEVELS = { 1: ['#3f8a4a', 'GREEN'], 2: ['#2f5d9e', 'BLUE'], 3: ['#e0a810', 'YELLOW'], 4: ['#e8661c', 'ORANGE'], 5: ['#c0302a', 'RED'] };
def('keycard', (opts) => {
  const lvl = Math.min(5, Math.max(1, opts.level ?? 2));
  const [col] = KEY_LEVELS[lvl];
  const A = atlas(`keycard_${lvl}`, 512, 768, (c) => {
    // front (0,0,512,324)
    rect(c, 0, 0, 512, 324, '#f6f4ee');
    rect(c, 0, 0, 512, 78, col);
    roomIcon(c, 44, 39, 42, '#fff', null, 0.11);
    txt(c, 'R.O.O.M. CORP', 76, 30, { size: 30, color: '#fff', weight: '900', align: 'left', maxW: 260 });
    txt(c, 'PERSONNEL ACCESS', 78, 60, { size: 15, color: '#fff', fam: MONO, align: 'left' });
    txt(c, `LEVEL ${lvl}`, 452, 40, { size: 40, color: '#fff', weight: '900', maxW: 110 });
    rect(c, 22, 96, 132, 156, '#cfd6dc');
    c.save(); c.beginPath(); c.rect(22, 96, 132, 156); c.clip(); drawClone(c, 88, 172, 104); c.restore();
    c.strokeStyle = '#555'; c.lineWidth = 2; c.strokeRect(22, 96, 132, 156);
    txt(c, 'EMPLOYEE #0451', 172, 112, { size: 22, color: INK, weight: '900', align: 'left', maxW: 320 });
    txt(c, 'CLONE — FIELD OPERATIONS', 172, 140, { size: 15, color: '#333', fam: MONO, align: 'left', maxW: 320 });
    txt(c, 'VALID UNTIL: TERMINATION', 172, 164, { size: 14, color: '#333', fam: MONO, align: 'left', maxW: 320 });
    // chip
    rrect(c, 176, 188, 62, 48, 8, '#d9b45a', '#9a7a2a', 2);
    c.strokeStyle = '#9a7a2a'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(176, 212); c.lineTo(238, 212); c.moveTo(207, 188); c.lineTo(207, 236); c.moveTo(190, 188); c.lineTo(190, 236); c.moveTo(224, 188); c.lineTo(224, 236); c.stroke();
    // hologram
    const hg = c.createLinearGradient(256, 190, 300, 236);
    ['#ff8ad8', '#8ad8ff', '#b0ff8a', '#ffe28a'].forEach((h, i) => hg.addColorStop(i / 3, h));
    c.fillStyle = hg; c.beginPath(); c.arc(278, 212, 22, 0, TAU); c.fill();
    roomIcon(c, 278, 212, 22, 'rgba(255,255,255,0.7)', null, 0.12);
    barcode(c, 320, 186, 172, 56, 451, false);
    rect(c, 0, 262, 512, 62, col);
    txt(c, 'DO NOT BEND • DO NOT DUPLICATE', 256, 293, { size: 18, color: '#fff', fam: MONO, maxW: 470 });
    wear(c, 0, 0, 512, 324, 70 + lvl, 1.2, { lightRatio: 0.7 });
    // back (0,330,512,324)
    rect(c, 0, 330, 512, 324, '#ecebe6');
    rect(c, 0, 360, 512, 64, '#141414');
    rect(c, 30, 448, 300, 46, '#ffffff');
    for (let x = 30; x < 330; x += 10) rect(c, x, 448, 5, 46, 'rgba(200,190,170,0.3)');
    txt(c, 'AUTHORIZED SIGNATURE', 34, 506, { size: 12, color: '#555', fam: MONO, align: 'left' });
    txt(c, 'If found, return to R.O.O.M. Corporation.', 256, 560, { size: 16, color: '#222', fam: MONO, maxW: 480 });
    txt(c, 'Do not bend, fold, or bring to Dimension 0.', 256, 584, { size: 16, color: '#222', fam: MONO, maxW: 480 });
    txt(c, 'Misuse is grounds for reassignment.', 256, 608, { size: 13, color: '#666', fam: MONO, maxW: 480 });
    rect(c, 0, 630, 512, 24, col);
  });
  const p = paint(A, { rough: 0.32 });
  const W = 0.0856, H = 0.054, r = 0.0032;
  const sh = new THREE.Shape();
  sh.moveTo(-W / 2 + r, -H / 2); sh.lineTo(W / 2 - r, -H / 2); sh.quadraticCurveTo(W / 2, -H / 2, W / 2, -H / 2 + r);
  sh.lineTo(W / 2, H / 2 - r); sh.quadraticCurveTo(W / 2, H / 2, W / 2 - r, H / 2); sh.lineTo(-W / 2 + r, H / 2);
  sh.quadraticCurveTo(-W / 2, H / 2, -W / 2, H / 2 - r); sh.lineTo(-W / 2, -H / 2 + r); sh.quadraticCurveTo(-W / 2, -H / 2, -W / 2 + r, -H / 2);
  const fr = A.R(0, 0, 512, 324), br = A.R(0, 330, 512, 324), pl = A.plain;
  const k = new Kit();
  k.add(extrudeGeo(sh, 0.0008, 0, { curveSegments: 3 }), p, {
    r: [-PI / 2, 0, 0],
    uvFn: (q, n) => {
      const u = (q.x + W / 2) / W, v = (q.y + H / 2) / H;
      if (n.z > 0.5) return [fr[0] + u * (fr[2] - fr[0]), fr[1] + v * (fr[3] - fr[1])];
      if (n.z < -0.5) return [br[0] + (1 - u) * (br[2] - br[0]), br[1] + v * (br[3] - br[1])];
      return [(pl[0] + pl[2]) / 2, (pl[1] + pl[3]) / 2];
    },
  });
  k.colBox([W, 0.004, H]);
  return { kit: k, meta: { mass: 0.006, material: 'plastic', hold: { grip: [0.03, 0, 0.015], rot: [1.3, -0.1, 0.06], off: [0, 0.045, 0] } } };
}, (o) => `${Math.min(5, Math.max(1, o.level ?? 2))}`);

// ---------------------------------------------------------------- noise_maker (crafted alarm-clock trap)
def('noise_maker', () => {
  const A = atlas('noise_maker', 512, 512, (c) => {
    // dial (0,0,300,300)
    rect(c, 0, 0, 300, 300, '#f3eedf');
    const cx = 150, cy = 150;
    c.strokeStyle = '#222'; c.lineWidth = 3; c.beginPath(); c.arc(cx, cy, 140, 0, TAU); c.stroke();
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * TAU, l = i % 5 ? 6 : 14;
      c.lineWidth = i % 5 ? 2 : 4;
      c.beginPath(); c.moveTo(cx + Math.sin(a) * 132, cy - Math.cos(a) * 132); c.lineTo(cx + Math.sin(a) * (132 - l), cy - Math.cos(a) * (132 - l)); c.stroke();
    }
    for (let h = 1; h <= 12; h++) { const a = (h / 12) * TAU; txt(c, String(h), cx + Math.sin(a) * 102, cy - Math.cos(a) * 102 + 2, { size: 30, color: '#222', fam: 'Georgia, serif', weight: 'bold' }); }
    roomIcon(c, cx, cy - 52, 26, '#b52a20', null, 0.12);
    txt(c, 'R.O.O.M.', cx, cy + 46, { size: 20, color: '#222', weight: '900' });
    txt(c, 'WAKE UP, EMPLOYEE', cx, cy + 68, { size: 11, color: '#555', fam: MONO });
    wear(c, 0, 0, 300, 300, 3, 1.2, { edge: false, lightRatio: 0.2 });
    // duct tape (310,0,200,60)
    rect(c, 310, 0, 200, 60, '#9da1a6');
    for (let x = 310; x < 510; x += 4) rect(c, x, 0, 1, 60, 'rgba(255,255,255,0.1)');
    noise(c, 310, 0, 200, 60, 14, 2);
    // tag (310,70,200,120)
    rect(c, 310, 70, 200, 120, '#e8dcb8');
    txt(c, 'TRAP!', 410, 108, { size: 40, color: '#b52a20', fam: HAND, weight: 'bold', rot: -0.05 });
    txt(c, 'do not wind', 410, 150, { size: 22, color: '#1d2b8a', fam: HAND, rot: -0.03 });
    noise(c, 310, 70, 200, 120, 10, 5);
    // body red (310,200,200,100)
    rect(c, 310, 200, 200, 100, '#b52a20');
    noise(c, 310, 200, 200, 100, 10, 6);
    wear(c, 310, 200, 200, 100, 8, 3, { edge: false });
  });
  const p = paint(A, { rough: 0.38, metal: 0.4 });
  const met = paint(A, { rough: 0.18, metal: 1 });
  const k = new Kit();
  const R = 0.05, red = A.R(310, 200, 200, 100);
  k.push({ r: [PI / 2, 0, 0] }); // lathe +Y -> +Z (face forward to +Z)
  k.lathe([[0, -0.024], [0.03, -0.0235], [0.044, -0.021], [0.049, -0.016], [R, -0.01], [R, 0.012], [0.0495, 0.015]], p, { seg: 32, uv: red });
  k.add(new THREE.CircleGeometry(0.046, 32), p, { r: [-PI / 2, 0, 0], p: [0, 0.012, 0], uv: A.R(0, 0, 300, 300) });
  k.torus(0.0485, 0.0042, met, { p: [0, 0.016, 0], r: [PI / 2, 0, 0], rseg: 8, tseg: 32, col: 0xe6e8ea });
  // hands
  k.box(0.0035, 0.0008, 0.026, p, { p: [0.007, 0.0132, -0.009], r: [0, 0.8, 0], col: 0x161616 });
  k.box(0.0024, 0.0008, 0.038, p, { p: [-0.009, 0.0138, -0.014], r: [0, -0.55, 0], col: 0x161616 });
  k.box(0.0014, 0.0008, 0.03, p, { p: [0.011, 0.0144, 0.008], r: [0, 2.3, 0], col: 0xc0302a });
  k.cyl(0.0025, 0.0025, 0.003, met, { p: [0, 0.0145, 0], seg: 10, col: 0xc9a65a });
  // glass dome
  k.lathe([[0, 0.019], [0.03, 0.0175], [0.046, 0.0145]], M.glass(), { seg: 28 });
  // winding keys on the back
  for (const sx of [-1, 1]) {
    k.cyl(0.0025, 0.0025, 0.008, met, { p: [sx * 0.016, -0.028, 0.0], seg: 8, col: 0xc9a65a });
    k.rbox(0.016, 0.0025, 0.01, 0.002, met, { p: [sx * 0.016, -0.033, 0.0], col: 0xc9a65a, rs: 1 });
  }
  k.pop();
  // bells + frame + hammer
  for (const sx of [-1, 1]) {
    k.push({ p: [sx * 0.033, 0.056, -0.004], r: [0, 0, -sx * 0.62] });
    k.lathe([[0, 0.002], [0.022, 0.002, 1], [0.0245, 0.0], [0.0245, 0.004], [0.022, 0.014], [0.013, 0.021], [0, 0.023]], met, { seg: 24, col: 0xe6e8ea });
    k.cyl(0.0022, 0.0022, 0.012, met, { p: [0, -0.005, 0], seg: 8, col: 0xd0d2d4 });
    k.pop();
    // legs
    k.push({ p: [sx * 0.03, -0.047, -0.004], r: [0, 0, sx * 0.55] });
    k.cyl(0.0024, 0.0024, 0.018, met, { p: [0, -0.008, 0], seg: 8, col: 0xd0d2d4 });
    k.sphere(0.0055, met, { p: [0, -0.018, 0], ws: 10, hs: 6, col: 0xe6e8ea });
    k.pop();
  }
  k.tube([[-0.034, 0.05, -0.004], [0, 0.062, -0.004], [0.034, 0.05, -0.004]], 0.0022, met, { tseg: 12, rseg: 6, col: 0xd0d2d4 });
  k.cyl(0.0016, 0.0016, 0.022, met, { p: [0, 0.06, -0.004], seg: 6, col: 0xd0d2d4 });
  k.sphere(0.0038, met, { p: [0, 0.071, -0.004], ws: 10, hs: 6, col: 0xc9a65a });
  // crafted bits: duct tape band, trigger wire, tag
  k.cyl(R + 0.0012, R + 0.0012, 0.014, p, { seg: 32, open: true, ts: PI * 0.55, tl: PI * 0.9, r: [PI / 2, 0, 0], p: [0, 0, -0.004], uv: A.R(310, 0, 200, 60) });
  k.tube([[0.03, -0.01, -0.024], [0.05, -0.03, -0.035], [0.06, -0.055, -0.02], [0.07, -0.065, 0.01]], 0.0012, p, { tseg: 20, rseg: 4, col: 0xc0302a });
  k.tube([[0.026, -0.014, -0.024], [0.044, -0.034, -0.038], [0.056, -0.058, -0.024], [0.066, -0.066, 0.008]], 0.0012, p, { tseg: 20, rseg: 4, col: 0x1a1a1a });
  k.rbox(0.014, 0.008, 0.02, 0.002, p, { p: [0.07, -0.0655, 0.014], col: 0xc0302a, rs: 1 });
  k.box(0.034, 0.0006, 0.022, p, { p: [-0.05, -0.064, 0.022], r: [0, 0.4, 0], uv: A.R(310, 70, 200, 120) });
  k.tube([[-0.034, -0.055, -0.004], [-0.042, -0.062, 0.006], [-0.048, -0.064, 0.016]], 0.0005, p, { tseg: 8, rseg: 3, col: 0xd8d0b8 });
  k.colCyl(R, 0.05, [0, 0, -0.002], [PI / 2, 0, 0]);
  k.colBox([0.11, 0.03, 0.03], [0, 0.06, -0.004]);
  k.colBall(0.006, [-0.04, -0.061, -0.004]);
  k.colBall(0.006, [0.04, -0.061, -0.004]);
  return { kit: k, meta: { mass: 0.45, material: 'metal', hold: { grip: [0, -0.01, 0], rot: [0.12, -0.25, 0.04], off: [0, 0.02, 0] } } };
});

// ---------------------------------------------------------------- spike_trap (crafted)
def('spike_trap', () => {
  const A = atlas('spike_trap', 1024, 512, (c) => {
    woodGrain(c, 0, 0, 1024, 140, { seed: 11, base: '#c9a36f', knots: 2, knotSize: 14 });
    woodGrain(c, 0, 144, 1024, 140, { seed: 12, base: '#bf9a66', knots: 1, knotSize: 12 });
    // spray paint on the boards
    c.save(); c.globalAlpha = 0.85;
    txt(c, '!! DANGER !!', 560, 70, { size: 64, color: '#b5160f', fam: MONO, weight: '900', rot: -0.03 });
    txt(c, 'R.O.O.M. — NOT A STEP', 520, 214, { size: 34, color: '#b5160f', fam: MONO, weight: '900', rot: 0.02 });
    c.restore();
    woodGrain(c, 0, 288, 1024, 50, { seed: 13, base: '#b8915c', knots: 0, lines: 16 });
    endGrain(c, 0, 342, 80, 60, { seed: 3 });
    hazardStripes(c, 100, 342, 400, 60, 22);
    noise(c, 100, 342, 400, 60, 10, 4);
    wear(c, 0, 0, 1024, 340, 15, 1.2);
  });
  const p = paint(A, { rough: 0.85 });
  const met = paint(A, { rough: 0.55, metal: 0.9 });
  const k = new Kit();
  const L = 0.42, t = 0.022, w = 0.112, bt = 0.02;
  const edge = A.R(0, 288, 1024, 50), end = A.R(0, 342, 80, 60);
  for (const sx of [-1, 1]) k.box(0.04, bt, 0.232, p, { p: [sx * 0.16, bt / 2, 0], faces: { py: edge, ny: edge, px: A.R(0, 288, 512, 50, 1), nx: A.R(0, 288, 512, 50, 1), pz: end, nz: end } });
  for (const [i, sz] of [[0, -1], [1, 1]]) {
    const top = i ? A.R(0, 144, 1024, 140) : A.R(0, 0, 1024, 140);
    k.box(L, t, w, p, { p: [0, bt + t / 2, sz * (w / 2 + 0.002)], faces: { py: top, ny: top, pz: edge, nz: edge, px: end, nx: end } });
  }
  // hazard tape around one end
  k.box(0.05, t + 0.0016, 2 * w + 0.006, p, { p: [-L / 2 + 0.04, bt + t / 2, 0], uv: A.R(100, 342, 400, 60) });
  // nails (shank + point), a few bent
  const r = new RNG(77);
  const y0 = bt + t;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
    const x = -0.13 + i * 0.07 + r.range(-0.008, 0.008), z = -0.075 + j * 0.05 + r.range(-0.006, 0.006);
    const bent = (i === 1 && j === 2) || (i === 4 && j === 0);
    const rx = r.range(-0.12, 0.12) + (bent ? 0.6 : 0), rz = r.range(-0.12, 0.12);
    const len = r.range(0.042, 0.052);
    k.push({ p: [x, y0, z], r: [rx, 0, rz] });
    k.cyl(0.0018, 0.0018, len, met, { p: [0, len / 2, 0], seg: 6, col: 0x8c8882 });
    k.cyl(0.0001, 0.0018, 0.008, met, { p: [0, len + 0.004, 0], seg: 6, col: 0xa8a49e });
    k.pop();
  }
  k.colBox([L, bt + t, 0.232], [0, (bt + t) / 2, 0]);
  k.colBox([0.36, 0.048, 0.2], [0, y0 + 0.024, 0]);
  return { kit: k, meta: { mass: 2.2, material: 'wood', hold: { grip: [0.12, y0, 0.1], rot: [0.25, 0.2, 0.05], off: [0, -0.1, -0.05] } } };
});

// ---------------------------------------------------------------- barricade_panel (crafted)
def('barricade_panel', () => {
  const A = atlas('barricade_panel', 1024, 1024, (c) => {
    // three plank fronts, stencil spans all three as if continuous
    const ph = 200, gap = 6;
    for (let i = 0; i < 3; i++) woodGrain(c, 0, i * (ph + gap), 1024, ph, { seed: 21 + i, base: ['#c8a46c', '#bf9963', '#cdaa74'][i], knots: 2, knotSize: 16, lw: 1.4 });
    for (let i = 0; i < 3; i++) {
      c.save(); c.beginPath(); c.rect(0, i * (ph + gap), 1024, ph); c.clip();
      c.translate(0, i * gap);
      c.globalAlpha = 0.88;
      txt(c, 'KEEP OUT', 512, 230, { size: 210, color: '#b5160f', fam: MONO, weight: '900', rot: -0.04, sx: 0.9 });
      txt(c, 'PROPERTY OF R.O.O.M.', 512, 430, { size: 58, color: '#1a1a1a', fam: MONO, weight: '900', rot: 0.02 });
      c.restore();
    }
    // back / edges strips (0,620,1024,60) x3, battens (0,820,1024,90)
    for (let i = 0; i < 3; i++) woodGrain(c, 0, 620 + i * 64, 1024, 60, { seed: 31 + i, base: '#c29e68', knots: 1, knotSize: 8 });
    woodGrain(c, 0, 812, 1024, 90, { seed: 41, base: '#b28b58', knots: 2, knotSize: 10 });
    endGrain(c, 0, 906, 120, 50, { seed: 5 });
    wear(c, 0, 0, 1024, 900, 25, 1.4);
  });
  const p = paint(A, { rough: 0.88 });
  const met = paint(A, { rough: 0.5, metal: 0.9 });
  const k = new Kit();
  const L = 1.1, ph = 0.28, t = 0.022, gap = 0.012;
  const end = A.R(0, 906, 120, 50);
  for (let i = 0; i < 3; i++) {
    const y = (1 - i) * (ph + gap);
    const front = A.R(0, i * 206, 1024, 200);
    const back = A.R(0, 620 + i * 64, 1024, 60);
    k.box(L, ph, t, p, { p: [0, y, 0], faces: { pz: front, nz: back, py: back, ny: back, px: end, nx: end } });
  }
  const bat = A.R(0, 812, 1024, 90);
  const Hh = 3 * ph + 2 * gap;
  for (const sx of [-1, 1]) k.box(0.075, Hh - 0.02, t, p, { p: [sx * 0.4, 0, -t], faces: { nz: A.R(0, 812, 1024, 90, 1), pz: A.R(0, 812, 1024, 90, 1), px: bat, nx: bat, py: end, ny: end } });
  const dx = 0.8 - 0.07, dy = Hh - 0.12;
  k.box(Math.hypot(dx, dy), 0.075, t, p, { p: [0, 0, -t * 2 + 0.0005], r: [0, 0, Math.atan2(dy, dx)], faces: { nz: bat, pz: bat, py: bat, ny: bat, px: end, nx: end } });
  // nail heads (front) at batten crossings and brace
  const r = new RNG(9);
  for (let i = 0; i < 3; i++) {
    const y = (1 - i) * (ph + gap);
    for (const sx of [-1, 1]) for (const dy2 of [-0.07, 0.07]) {
      k.cyl(0.0055, 0.0055, 0.0018, met, { p: [sx * 0.4 + r.range(-0.012, 0.012), y + dy2 + r.range(-0.01, 0.01), t / 2 + 0.0006], r: [PI / 2, 0, 0], seg: 8, col: 0x6a6660 });
    }
    k.cyl(0.0055, 0.0055, 0.0018, met, { p: [-0.12 + i * 0.12 + r.range(-0.02, 0.02), y, t / 2 + 0.0006], r: [PI / 2, 0, 0], seg: 8, col: 0x6a6660 });
  }
  k.colBox([L, Hh, t * 2 + 0.002], [0, 0, -t / 2]);
  return { kit: k, meta: { mass: 18, material: 'wood', hold: { grip: [L / 2 - 0.04, 0, 0], rot: [0, -PI / 2 + 0.25, 0], off: [0.08, -0.34, 0.06] } } };
});

// ---------------------------------------------------------------- dart
def('dart', () => {
  const A = atlas('dart', 256, 256, (c) => {
    // flight print (0,0,200,200): u = outward, v = along (tail at v=0)
    rect(c, 0, 0, 200, 200, ROOM_YELLOW);
    hazardStripes(c, 0, 0, 200, 26, 12);
    roomIcon(c, 80, 120, 70, INK, null, 0.12);
    txt(c, 'R.O.O.M.', 100, 180, { size: 22, color: INK, weight: '900' });
  });
  const p = paint(A, { rough: 0.45 });
  const met = paint(A, { rough: 0.25, metal: 1 });
  const k = new Kit();
  k.push({ r: [-PI / 2, 0, 0] }); // +Y (tip) -> -Z
  k.lathe([[0, -0.064], [0.0019, -0.0632], [0.0021, -0.06], [0.0021, -0.013], [0.0027, -0.0108]], p, { seg: 12, col: 0x1b1b1b });
  const barrel = [[0.0027, -0.0108], [0.0033, -0.0092], [0.0035, -0.006]];
  for (let i = 0; i < 7; i++) { const y = -0.004 + i * 0.0058; barrel.push([0.0035, y], [0.003, y + 0.0013], [0.003, y + 0.0033], [0.0035, y + 0.0046]); }
  barrel.push([0.0034, 0.038], [0.0024, 0.044], [0.0012, 0.0455, 1]);
  k.lathe(barrel, met, { seg: 14, col: 0x8f949a });
  k.lathe([[0.0012, 0.0455, 1], [0.0011, 0.05], [0.0009, 0.072], [0, 0.081]], met, { seg: 10, col: 0xe6e8ea });
  // gold accent ring
  k.cyl(0.0036, 0.0036, 0.0016, met, { p: [0, -0.007, 0], seg: 14, col: 0xc9a65a });
  // flights (X configuration)
  const fs = new THREE.Shape();
  fs.moveTo(0.0016, -0.026); fs.lineTo(0.007, -0.034); fs.lineTo(0.0175, -0.051); fs.lineTo(0.0165, -0.0635); fs.lineTo(0.0016, -0.0635); fs.lineTo(0.0016, -0.026);
  const fr = A.R(0, 0, 200, 200);
  for (let q = 0; q < 4; q++) {
    k.add(extrudeGeo(fs, 0.0005, 0, { curveSegments: 1 }), p, {
      r: [0, PI / 4 + q * PI / 2, 0],
      uvFn: (v) => { const u = (v.x - 0.0016) / 0.016, w = (v.y + 0.0635) / 0.0375; return [fr[0] + u * (fr[2] - fr[0]), fr[1] + w * (fr[3] - fr[1])]; },
    });
  }
  k.pop();
  k.colBox([0.007, 0.007, 0.145], [0, 0, -0.0085]);
  k.colBox([0.026, 0.026, 0.036], [0, 0, 0.045]);
  return { kit: k, meta: { mass: 0.02, material: 'metal', hold: { grip: [0, 0, -0.016], rot: [0.12, 0.05, 0], off: [-0.01, 0.04, 0] } } };
});

// ---------------------------------------------------------------- photo (instant film)
const PHOTO_CAPTIONS = ['Level 0 — day 3?', 'who is that??', 'team building :)', 'EXIT?? (it moved)'];
function drawCorridor(c, x, y, w, h, o = {}) {
  const vx = x + w * (o.vx ?? 0.5), vy = y + h * 0.48;
  // walls / floor / ceiling
  const quad = (pts, col) => { c.fillStyle = col; c.beginPath(); pts.forEach(([a, b], i) => (i ? c.lineTo(a, b) : c.moveTo(a, b))); c.fill(); };
  const s = 0.16;
  const ix0 = vx - w * s, ix1 = vx + w * s, iy0 = vy - h * s * 0.8, iy1 = vy + h * s;
  quad([[x, y], [x + w, y], [ix1, iy0], [ix0, iy0]], o.ceil || '#d8d3bd');
  quad([[x, y + h], [x + w, y + h], [ix1, iy1], [ix0, iy1]], o.floor || '#8f7a45');
  quad([[x, y], [ix0, iy0], [ix0, iy1], [x, y + h]], o.wall || '#cbb45a');
  quad([[x + w, y], [ix1, iy0], [ix1, iy1], [x + w, y + h]], o.wall2 || '#bfa650');
  quad([[ix0, iy0], [ix1, iy0], [ix1, iy1], [ix0, iy1]], o.back || '#7a6a30');
  // ceiling lights
  for (let i = 0; i < 4; i++) {
    const t = 1 - Math.pow(0.55, i + 0.6);
    const cxp = x + w / 2 + (vx - x - w / 2) * t, cyp = y + (iy0 - y) * t;
    const lw = w * 0.22 * (1 - t), lh = h * 0.05 * (1 - t);
    c.fillStyle = '#fffbe8'; c.fillRect(cxp - lw / 2, cyp, lw, lh);
    const g = c.createRadialGradient(cxp, cyp, 0, cxp, cyp, lw * 1.6);
    g.addColorStop(0, 'rgba(255,250,220,0.35)'); g.addColorStop(1, 'rgba(255,250,220,0)');
    c.fillStyle = g; c.fillRect(cxp - lw * 2, cyp - lw, lw * 4, lw * 3);
  }
  // doorway on the left wall
  c.fillStyle = 'rgba(30,24,10,0.85)';
  c.beginPath(); c.moveTo(x + w * 0.12, y + h * 0.3); c.lineTo(x + w * 0.22, y + h * 0.35); c.lineTo(x + w * 0.22, y + h * 0.72); c.lineTo(x + w * 0.12, y + h * 0.8); c.fill();
}
def('photo', (opts) => {
  const vr = ((opts.variant ?? 0) % 4 + 4) % 4;
  const A = atlas(`photo_${vr}`, 512, 1024, (c) => {
    // front (0,0,512,622)
    rect(c, 0, 0, 512, 622, '#f2efe4');
    noise(c, 0, 0, 512, 622, 8, 3);
    const ix = 26, iy = 26, iw = 460, ih = 460;
    c.save(); c.beginPath(); c.rect(ix, iy, iw, ih); c.clip();
    if (vr === 0 || vr === 1) drawCorridor(c, ix, iy, iw, ih, { vx: vr ? 0.55 : 0.45 });
    if (vr === 1) {
      const fx = ix + iw * 0.55, fy = iy + ih * 0.48;
      c.fillStyle = '#0b0906'; c.beginPath(); c.ellipse(fx, fy - 18, 9, 12, 0, 0, TAU); c.fill();
      c.beginPath(); c.moveTo(fx - 10, fy - 6); c.lineTo(fx + 10, fy - 6); c.lineTo(fx + 7, fy + 60); c.lineTo(fx - 7, fy + 60); c.fill();
      c.fillStyle = '#fff'; c.fillRect(fx - 5, fy - 20, 2.5, 2.5); c.fillRect(fx + 3, fy - 20, 2.5, 2.5);
    }
    if (vr === 2) {
      rect(c, ix, iy, iw, ih, '#cbb45a');
      for (let i = 0; i < 12; i++) rect(c, ix + i * 40, iy, 3, ih * 0.62, 'rgba(120,100,40,0.25)');
      rect(c, ix, iy + ih * 0.62, iw, ih * 0.38, '#8f7a45');
      drawClone(c, ix + 120, iy + 250, 150, { face: true });
      drawClone(c, ix + 340, iy + 255, 150, { face: true });
      drawClone(c, ix + 230, iy + 290, 170, { face: true });
      const g = c.createRadialGradient(ix + 240, iy + 200, 10, ix + 240, iy + 200, 300);
      g.addColorStop(0, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(ix, iy, iw, ih);
    }
    if (vr === 3) {
      drawCorridor(c, ix, iy, iw, ih, { ceil: '#3a372c', floor: '#2a2414', wall: '#4a4020', wall2: '#40381c', back: '#1a160a' });
      const dx = ix + iw * 0.5, dy = iy + ih * 0.47;
      rect(c, dx - 26, dy - 30, 52, 92, '#2c2a26');
      rect(c, dx - 24, dy - 64, 48, 20, '#c82018');
      txt(c, 'EXIT', dx, dy - 54, { size: 18, color: '#ffd8c8', weight: '900' });
      const g = c.createRadialGradient(dx, dy - 54, 4, dx, dy - 54, 90);
      g.addColorStop(0, 'rgba(255,60,40,0.5)'); g.addColorStop(1, 'rgba(255,60,40,0)');
      c.fillStyle = g; c.fillRect(dx - 100, dy - 150, 200, 200);
    }
    // film look: warm cast, vignette, grain, light leak
    c.fillStyle = 'rgba(255,200,120,0.12)'; c.fillRect(ix, iy, iw, ih);
    const vg = c.createRadialGradient(ix + iw / 2, iy + ih / 2, iw * 0.25, ix + iw / 2, iy + ih / 2, iw * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = vg; c.fillRect(ix, iy, iw, ih);
    const lk = c.createLinearGradient(ix + iw, iy, ix + iw - 120, iy + 80);
    lk.addColorStop(0, 'rgba(255,120,60,0.45)'); lk.addColorStop(1, 'rgba(255,120,60,0)');
    c.fillStyle = lk; c.fillRect(ix, iy, iw, ih);
    c.restore();
    noise(c, ix, iy, iw, ih, 26, 7 + vr);
    txt(c, PHOTO_CAPTIONS[vr], 256, 556, { size: 40, color: '#23285a', fam: HAND, weight: 'bold', rot: -0.025, maxW: 440 });
    wear(c, 0, 0, 512, 622, 9 + vr, 0.8, { lightRatio: 0.1 });
    // back (0,630,512,330)
    rect(c, 0, 630, 512, 330, '#262626');
    noise(c, 0, 630, 512, 330, 12, 2);
    txt(c, 'R.O.O.M. INSTANT FILM', 256, 720, { size: 28, color: '#8a8a8a', fam: MONO, weight: '900' });
    txt(c, 'EVIDENCE — PROPERTY OF R.O.O.M. ARCHIVES', 256, 760, { size: 15, color: '#777', fam: MONO, maxW: 470 });
    txt(c, `#${4200 + vr * 17}`, 256, 860, { size: 34, color: '#ddd', fam: HAND, weight: 'bold' });
  });
  const p = paint(A, { rough: 0.35 });
  const k = new Kit();
  const W = 0.088, H = 0.107;
  k.box(W, 0.0012, H, p, { faces: { py: A.R(0, 0, 512, 622), ny: A.R(0, 630, 512, 330, 4), px: A.plain, nx: A.plain, pz: A.plain, nz: A.plain } });
  k.colBox([W, 0.003, H]);
  return { kit: k, meta: { mass: 0.005, material: 'paper', hold: { grip: [0.032, 0, 0.035], rot: [1.3, 0, 0.06], off: [0, 0.05, 0] } } };
}, (o) => `${((o.variant ?? 0) % 4 + 4) % 4}`);

// ---------------------------------------------------------------- clipboard
def('clipboard', () => {
  const A = atlas('clipboard', 512, 1024, (c) => {
    // form (0,0,512,662) letter paper
    rect(c, 0, 0, 512, 662, '#f6f3ea');
    noise(c, 0, 0, 512, 662, 6, 3);
    brand(c, 30, 52, 26, INK, { align: 'left' });
    txt(c, 'INCIDENT REPORT', 482, 44, { size: 24, color: INK, weight: '900', align: 'right' });
    txt(c, 'FORM 27-B/6', 482, 68, { size: 14, color: '#444', fam: MONO, align: 'right' });
    rect(c, 30, 86, 452, 3, INK);
    const fields = [['EMPLOYEE #', '0451'], ['LEVEL', '0'], ['DATE', '??/??/19??'], ['SUPERVISOR', 'Mr. ████']];
    fields.forEach(([a, b], i) => {
      const y = 120 + i * 40;
      txt(c, a + ':', 34, y, { size: 16, color: INK, fam: MONO, align: 'left' });
      rect(c, 170, y + 12, 300, 1.5, '#666');
      txt(c, b, 182, y, { size: 22, color: '#23285a', fam: HAND, align: 'left', weight: 'bold' });
    });
    txt(c, 'ENTITY SIGHTED?', 34, 296, { size: 16, color: INK, fam: MONO, align: 'left' });
    for (const [x, l] of [[220, 'YES'], [320, 'NO'], [400, 'UNSURE']]) { c.strokeStyle = INK; c.lineWidth = 2; c.strokeRect(x, 286, 18, 18); txt(c, l, x + 26, 296, { size: 14, color: INK, fam: MONO, align: 'left' }); }
    checkmark(c, 229, 294, 26);
    txt(c, 'DESCRIBE INCIDENT:', 34, 340, { size: 16, color: INK, fam: MONO, align: 'left' });
    for (let i = 0; i < 6; i++) {
      rect(c, 34, 374 + i * 32, 444, 1.2, '#99a');
      if (i < 4) scribble(c, 40, 366 + i * 32, i === 3 ? 180 : 400, 30 + i);
    }
    txt(c, 'it was smiling', 300, 494, { size: 22, color: '#23285a', fam: HAND, rot: -0.04 });
    txt(c, 'SIGNATURE:', 34, 590, { size: 16, color: INK, fam: MONO, align: 'left' });
    scribble(c, 150, 590, 160, 99, '#23285a', 2.5);
    // stamp + coffee ring
    c.save(); c.translate(360, 230); c.rotate(-0.25); c.globalAlpha = 0.75;
    c.strokeStyle = '#c0302a'; c.lineWidth = 5; c.strokeRect(-120, -28, 240, 56);
    txt(c, 'CONFIDENTIAL', 0, 2, { size: 34, color: '#c0302a', fam: MONO, weight: '900' });
    c.restore();
    c.strokeStyle = 'rgba(120,80,40,0.35)'; c.lineWidth = 7; c.beginPath(); c.arc(410, 560, 48, 0.3, 5.6); c.stroke();
    c.strokeStyle = 'rgba(120,80,40,0.15)'; c.lineWidth = 12; c.beginPath(); c.arc(408, 562, 44, 2, 5); c.stroke();
    wear(c, 0, 0, 512, 662, 4, 0.6, { lightRatio: 0.05, edgeK: 0.5 });
    // masonite (0,670,300,300)
    rect(c, 0, 670, 300, 300, '#8a5a34');
    noise(c, 0, 670, 300, 300, 22, 5);
    wear(c, 0, 670, 300, 300, 6, 3, { edge: false });
    // under sheets edge (310,670,190,60)
    rect(c, 310, 670, 190, 60, '#efebe0');
  });
  const p = paint(A, { rough: 0.75 });
  const met = paint(A, { rough: 0.22, metal: 1 });
  const k = new Kit();
  const W = 0.23, H = 0.32, r = 0.012;
  const sh = new THREE.Shape();
  sh.moveTo(-W / 2 + r, -H / 2); sh.lineTo(W / 2 - r, -H / 2); sh.quadraticCurveTo(W / 2, -H / 2, W / 2, -H / 2 + r);
  sh.lineTo(W / 2, H / 2 - r); sh.quadraticCurveTo(W / 2, H / 2, W / 2 - r, H / 2); sh.lineTo(-W / 2 + r, H / 2);
  sh.quadraticCurveTo(-W / 2, H / 2, -W / 2, H / 2 - r); sh.lineTo(-W / 2, -H / 2 + r); sh.quadraticCurveTo(-W / 2, -H / 2, -W / 2 + r, -H / 2);
  const hole = new THREE.Path(); hole.absarc(0, H / 2 - 0.011, 0.0055, 0, TAU, true); sh.holes.push(hole);
  const mr = A.R(0, 670, 300, 300);
  k.add(extrudeGeo(sh, 0.0035, 0.0006, { curveSegments: 4, bevelSegments: 1 }), p, {
    r: [-PI / 2, 0, 0],
    uvFn: (q) => [mr[0] + (q.x / W + 0.5) * (mr[2] - mr[0]), mr[1] + (q.y / H + 0.5) * (mr[3] - mr[1])],
  });
  // paper stack (under sheets + printed top sheet)
  const pw = 0.212, plen = 0.276, pz = 0.012;
  k.box(pw, 0.0012, plen, p, { p: [0.002, 0.0029, pz + 0.002], r: [0, 0.012, 0], uv: A.R(310, 670, 190, 60) });
  k.box(pw, 0.0006, plen, p, { p: [0, 0.0041, pz], faces: { py: A.R(0, 0, 512, 662) } });
  // clip: base plate, spring roll, lever arch, clamp lip
  const cz = -H / 2 + 0.03;
  k.rbox(0.115, 0.0025, 0.036, 0.001, met, { p: [0, 0.0034, cz], rs: 1, col: 0xd8dadc });
  k.cyl(0.0065, 0.0065, 0.1, met, { p: [0, 0.0095, cz - 0.004], r: [0, 0, PI / 2], seg: 14, col: 0xd8dadc });
  k.rbox(0.105, 0.0022, 0.03, 0.001, met, { p: [0, 0.0072, cz + 0.016], r: [-0.22, 0, 0], rs: 1, col: 0xe2e4e6 });
  k.tube([[-0.035, 0.012, cz - 0.004], [-0.03, 0.03, cz - 0.016], [0, 0.036, cz - 0.022], [0.03, 0.03, cz - 0.016], [0.035, 0.012, cz - 0.004]], 0.0018, met, { tseg: 20, rseg: 6, col: 0xd0d2d4 });
  for (const sx of [-1, 1]) k.cyl(0.0028, 0.0028, 0.0012, met, { p: [sx * 0.045, 0.0048, cz - 0.008], seg: 8, col: 0xb8bcc0 });
  k.colBox([W, 0.0055, H], [0, 0.0012, 0]);
  k.colBox([0.11, 0.035, 0.03], [0, 0.017, cz - 0.01]);
  return { kit: k, meta: { mass: 0.35, material: 'wood', hold: { grip: [W / 2 - 0.03, 0, 0.06], rot: [1.12, 0.08, 0.05], off: [-0.05, 0.03, 0] } } };
});

// ---------------------------------------------------------------- plank (2x4 pine, 0.9 m)
def('plank', () => {
  const A = atlas('plank', 1024, 512, (c) => {
    woodGrain(c, 0, 0, 1024, 110, { seed: 51, base: '#dcbb86', knots: 2, knotSize: 12 });
    woodGrain(c, 0, 112, 1024, 110, { seed: 52, base: '#d6b47e', knots: 1, knotSize: 10 });
    woodGrain(c, 0, 224, 1024, 50, { seed: 53, base: '#d2b07a', knots: 1, knotSize: 8, lines: 22 });
    woodGrain(c, 0, 276, 1024, 50, { seed: 54, base: '#d8b680', knots: 0, lines: 22 });
    endGrain(c, 0, 330, 100, 48, { seed: 1, cx: 0.3, cy: 1.9 });
    endGrain(c, 104, 330, 100, 48, { seed: 2, cx: 0.7, cy: 2.1 });
    // grade stamp
    c.save(); c.globalAlpha = 0.72; c.translate(330, 56); c.rotate(0.02);
    c.strokeStyle = '#2b3a7a'; c.lineWidth = 3; c.strokeRect(-110, -38, 220, 76);
    txt(c, 'R.O.O.M. LUMBER', 0, -18, { size: 22, color: '#2b3a7a', fam: MONO, weight: '900' });
    txt(c, 'KD-HT  SPF  No.2', 0, 6, { size: 18, color: '#2b3a7a', fam: MONO });
    txt(c, 'MILL 0451  S-DRY', 0, 26, { size: 13, color: '#2b3a7a', fam: MONO });
    c.restore();
    txt(c, 'PROPERTY OF R.O.O.M. — DO NOT BURN', 780, 250, { size: 20, color: 'rgba(20,20,20,0.55)', fam: MONO });
    txt(c, '0.9 m', 120, 300, { size: 26, color: 'rgba(181,22,15,0.7)', fam: MONO, weight: '900' });
    wear(c, 0, 0, 1024, 326, 55, 0.8, { edge: false, lightRatio: 0.3 });
  });
  const p = paint(A, { rough: 0.85 });
  const k = new Kit();
  const W = 0.089, T = 0.038, L = 0.9;
  k.rbox(W, T, L, 0.0028, p, {
    rs: 1,
    faces: { py: A.R(0, 0, 1024, 110, 1), ny: A.R(0, 112, 1024, 110, 1), px: A.R(0, 224, 1024, 50), nx: A.R(0, 276, 1024, 50), pz: A.R(0, 330, 100, 48), nz: A.R(104, 330, 100, 48) },
  });
  k.colBox([W, T, L]);
  return { kit: k, meta: { mass: 1.4, material: 'wood', hold: { grip: [0, 0, 0.27], rot: [0.32, 0.02, -0.25], off: [0, -0.02, 0] } } };
});

// ---------------------------------------------------------------- metal_scrap
def('metal_scrap', () => {
  const A = atlas('metal_scrap', 512, 512, (c) => {
    // painted side (0,0,512,360)
    rect(c, 0, 0, 512, 360, '#5d6b52');
    noise(c, 0, 0, 512, 360, 14, 2);
    txt(c, 'M. CORP', 210, 190, { size: 74, color: '#e6e0cc', fam: MONO, weight: '900', rot: -0.02 });
    txt(c, 'PANEL 4-B', 170, 250, { size: 30, color: '#e6e0cc', fam: MONO, weight: '900' });
    hazardStripes(c, 0, 300, 512, 40, 18);
    const r = new RNG(12);
    for (let i = 0; i < 90; i++) {
      const x = r.range(0, 512), y = r.range(0, 360), w = r.range(3, 22);
      c.fillStyle = r.next() < 0.45 ? '#8a8d8e' : '#7a4524';
      c.beginPath(); c.ellipse(x, y, w, w * r.range(0.3, 0.8), r.next() * PI, 0, TAU); c.fill();
    }
    for (let i = 0; i < 10; i++) {
      const x = r.range(10, 500), y = r.range(0, 200);
      const g = c.createLinearGradient(0, y, 0, y + 160);
      g.addColorStop(0, 'rgba(120,60,20,0.55)'); g.addColorStop(1, 'rgba(120,60,20,0)');
      c.fillStyle = g; c.fillRect(x, y, r.range(4, 10), 160);
    }
    for (let i = 0; i < 6; i++) { c.fillStyle = '#1a1612'; c.beginPath(); c.arc(30 + i * 0, 40 + i * 56, 6, 0, TAU); c.fill(); }
    wear(c, 0, 0, 512, 360, 13, 3);
    // rusty back (0,364,440,140)
    rect(c, 0, 364, 440, 140, '#7a4a2a');
    noise(c, 0, 364, 440, 140, 40, 4);
    for (let i = 0; i < 60; i++) { c.fillStyle = r.next() < 0.5 ? 'rgba(160,80,30,0.6)' : 'rgba(70,60,50,0.6)'; c.beginPath(); c.arc(r.range(0, 440), r.range(364, 504), r.range(3, 14), 0, TAU); c.fill(); }
  });
  const p = paint(A, { rough: 0.62, metal: 0.55 });
  const k = new Kit();
  const W = 0.24, D = 0.17, xb = 0.055, ang = 0.75;
  const bend = (v) => {
    // jagged far edge + torn corner
    if (v.x < -0.1) v.x += Math.sin(v.z * 90) * 0.006 + Math.sin(v.z * 230) * 0.002;
    if (v.z > 0.07) v.z -= Math.max(0, (-v.x - 0.02)) * 0.15 + Math.sin(v.x * 120) * 0.003;
    v.y += Math.sin(v.z * 25 + v.x * 9) * 0.0025 + Math.sin(v.x * 40) * 0.001;
    if (v.x > xb) {
      const d = v.x - xb;
      const a = ang * Math.min(1, d / 0.012) ;
      const rr = d;
      v.x = xb + Math.cos(a) * rr - Math.sin(a) * v.y * 0;
      v.y = v.y + Math.sin(a) * rr;
    }
  };
  k.box(W, 0.0016, D, p, { p: [0, 0, 0], sx: 26, sz: 16, faces: { py: A.R(0, 0, 512, 360), ny: A.R(0, 364, 440, 140), px: A.plain, nx: A.plain, pz: A.plain, nz: A.plain }, deform: bend });
  for (let i = 0; i < 5; i++) {
    const v = V3(-0.095, 0.0008, -0.06 + i * 0.03); bend(v);
    k.sphere(0.0045, p, { p: [v.x, v.y, v.z], s: [1, 0.45, 1], ws: 10, hs: 5, tl: PI / 2, col: 0x8a8d8e });
  }
  k.colBox([W - (W / 2 - xb) + 0.01, 0.01, D], [-(W / 2 - xb) / 2 + 0.005 - 0.01, 0, 0]);
  const fl = W / 2 - xb;
  k.colBox([fl, 0.006, D], [xb + Math.cos(ang) * fl / 2, Math.sin(ang) * fl / 2, 0], [0, 0, ang]);
  return { kit: k, meta: { mass: 0.5, material: 'metal', hold: { grip: [-0.08, 0, 0.02], rot: [1.0, 0.35, 0.25], off: [0.04, -0.06, -0.03] } } };
});

// ---------------------------------------------------------------- screws (box)
def('screws', () => {
  const drawScrew = (c, x, y, s, rot) => {
    c.save(); c.translate(x, y); c.rotate(rot); c.scale(s / 100, s / 100);
    c.fillStyle = '#9aa0a6'; c.strokeStyle = '#4a4e52'; c.lineWidth = 3;
    c.beginPath(); c.ellipse(0, -46, 18, 8, 0, 0, TAU); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(-8, -42); c.lineTo(8, -42); c.lineTo(4, 46); c.lineTo(0, 54); c.lineTo(-4, 46); c.closePath(); c.fill(); c.stroke();
    for (let i = -36; i < 44; i += 9) { c.beginPath(); c.moveTo(-9, i); c.lineTo(9, i + 5); c.stroke(); }
    c.strokeStyle = '#3a3e42'; c.beginPath(); c.moveTo(-9, -46); c.lineTo(9, -46); c.moveTo(0, -52); c.lineTo(0, -40); c.stroke();
    c.restore();
  };
  const A = atlas('screws', 512, 512, (c) => {
    // top (0,0,512,330)
    rect(c, 0, 0, 512, 330, '#f1ece0');
    rect(c, 0, 0, 512, 64, '#e8661c');
    brand(c, 256, 32, 24, '#fff', { text: 'R.O.O.M. HARDWARE' });
    txt(c, 'SCREWS', 300, 118, { size: 66, color: INK, weight: '900', maxW: 300 });
    txt(c, 'ASSORTED', 300, 172, { size: 40, color: '#e8661c', weight: '900', ls: 4, maxW: 300 });
    // window
    rrect(c, 22, 82, 118, 220, 8, '#2c2a26');
    const r = new RNG(4);
    c.save(); c.beginPath(); c.roundRect(22, 82, 118, 220, 8); c.clip();
    for (let i = 0; i < 16; i++) drawScrew(c, r.range(30, 130), r.range(90, 300), r.range(36, 52), r.range(0, TAU));
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(22, 82, 40, 220);
    c.restore();
    txt(c, 'QTY: ~100 (APPROX.)', 300, 214, { size: 18, color: INK, fam: MONO, maxW: 300 });
    txt(c, 'WOOD • SHEET METAL • ???', 300, 242, { size: 14, color: '#444', fam: MONO, maxW: 300 });
    rect(c, 0, 290, 512, 40, INK);
    txt(c, 'PROPERTY OF R.O.O.M. — COUNT BEFORE USE', 256, 310, { size: 15, color: '#f1ece0', fam: MONO, maxW: 490 });
    wear(c, 0, 0, 512, 330, 9, 1.3);
    // side (0,334,512,80)
    rect(c, 0, 334, 512, 80, '#f1ece0');
    rect(c, 0, 334, 512, 14, '#e8661c');
    txt(c, 'SCREWS ASSORTED', 160, 382, { size: 30, color: INK, weight: '900', maxW: 290 });
    drawScrew(c, 380, 380, 40, PI / 2); drawScrew(c, 450, 380, 40, PI / 2);
    wear(c, 0, 334, 512, 80, 10, 1.3);
    // end flap (0,418,200,80)
    rect(c, 0, 418, 200, 80, '#e9e2d2');
    rect(c, 0, 418, 200, 3, 'rgba(0,0,0,0.25)');
    c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = 2; c.beginPath(); c.moveTo(20, 440); c.quadraticCurveTo(100, 470, 180, 440); c.stroke();
    txt(c, '#8 × 1¼"', 100, 474, { size: 18, color: INK, fam: MONO });
  });
  const p = paint(A, { rough: 0.8 });
  const k = new Kit();
  const W = 0.095, H = 0.035, D = 0.062;
  k.rbox(W, H, D, 0.0015, p, { rs: 1, faces: { py: A.R(0, 0, 512, 330), pz: A.R(0, 334, 512, 80), nz: A.R(0, 334, 512, 80), px: A.R(0, 418, 200, 80), nx: A.R(0, 418, 200, 80), ny: A.plain } });
  // window film
  k.box(0.022, 0.0004, 0.041, M.clearPlastic(), { p: [-W / 2 + 0.0155, H / 2 + 0.0002, -0.0005] });
  k.colBox([W, H, D]);
  return { kit: k, meta: { mass: 0.35, material: 'cardboard', hold: { grip: [0, 0, 0], rot: [1.05, -0.15, 0.06], off: [0, 0.03, 0] } } };
});

// ---------------------------------------------------------------- fabric_scrap (folded flannel rag)
def('fabric_scrap', () => {
  const A = atlas('fabric_scrap', 512, 512, (c) => {
    rect(c, 0, 0, 512, 448, '#9b2a22');
    const band = (vert, pos, w, col) => { c.fillStyle = col; if (vert) c.fillRect(pos, 0, w, 448); else c.fillRect(0, pos, 512, w); };
    for (let i = 0; i < 6; i++) {
      band(true, i * 90 + 10, 44, 'rgba(30,14,12,0.55)'); band(false, i * 80 + 8, 40, 'rgba(30,14,12,0.55)');
      band(true, i * 90 + 70, 4, 'rgba(240,200,90,0.5)'); band(false, i * 80 + 62, 4, 'rgba(240,200,90,0.5)');
    }
    c.strokeStyle = 'rgba(255,255,255,0.06)'; c.lineWidth = 1;
    for (let i = 0; i < 512; i += 3) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + 448, 448); c.stroke(); }
    noise(c, 0, 0, 512, 448, 22, 8);
    wear(c, 0, 0, 512, 448, 12, 1.5, { lightRatio: 0.2 });
  });
  const p = paint(A, { rough: 1.0 });
  const k = new Kit();
  const slab = (W, D, T, seed) => {
    const r = new RNG(seed);
    const ph = [r.range(0, 6), r.range(0, 6), r.range(0, 6)];
    const top = (u, v) => {
      const e = Math.pow(Math.max(0, 1 - Math.pow(2 * u - 1, 8)) * Math.max(0, 1 - Math.pow(2 * v - 1, 8)), 0.35);
      const n = Math.sin(u * 9 + ph[0]) * Math.sin(v * 7 + ph[1]) * 0.25 + Math.sin(u * 23 + v * 17 + ph[2]) * 0.08;
      return [(u - 0.5) * W + Math.sin(v * 5 + ph[1]) * 0.003, T * e * (0.85 + n), (0.5 - v) * D + Math.sin(u * 6 + ph[0]) * 0.003];
    };
    k.add(sheetGeo(12, 10, top), p, { uv: A.R(0, 0, 512, 448) });
    k.add(sheetGeo(6, 5, (u, v) => { const q = top(1 - u, v); return [q[0], 0, q[2]]; }), p, { uv: A.R(0, 0, 256, 224) });
  };
  slab(0.16, 0.13, 0.014, 3);
  k.push({ p: [0.004, 0.011, -0.004], r: [0, 0.16, 0] });
  slab(0.145, 0.115, 0.012, 7);
  k.pop();
  // drooping corner flap over the front edge
  k.add(sheetGeo(5, 6, (u, v) => {
    const x = -0.02 + u * 0.06, a = v * 1.9;
    return [x + v * 0.006, 0.02 - (1 - Math.cos(a)) * 0.011 - v * 0.004, 0.05 + Math.sin(a) * 0.012 + v * 0.004];
  }), p, { uv: A.R(256, 224, 256, 224) });
  k.colBox([0.16, 0.026, 0.13], [0, 0.013, 0]);
  return { kit: k, meta: { mass: 0.08, material: 'soft', hold: { grip: [0.03, 0.01, 0.02], rot: [0.9, 0.3, 0.1], off: [0, 0.02, 0] } } };
});

// ---------------------------------------------------------------- wire_spool
def('wire_spool', () => {
  const A = atlas('wire_spool', 512, 512, (c) => {
    // copper windings (0,0,512,200): rows run around
    rect(c, 0, 0, 512, 200, '#b8683a');
    for (let y = 0; y < 200; y += 6.6) {
      const g = c.createLinearGradient(0, y, 0, y + 6.6);
      g.addColorStop(0, '#6e3416'); g.addColorStop(0.45, '#f0b07a'); g.addColorStop(1, '#7a3a1a');
      c.fillStyle = g; c.fillRect(0, y, 512, 6.6);
    }
    noise(c, 0, 0, 512, 200, 10, 3);
    // flange label ring (0,210,290,290) planar
    rect(c, 0, 210, 290, 290, '#e8661c');
    c.fillStyle = '#f6f2e6'; c.beginPath(); c.arc(145, 355, 138, 0, TAU); c.fill();
    c.fillStyle = '#e8661c'; c.beginPath(); c.arc(145, 355, 46, 0, TAU); c.fill();
    txt(c, 'R.O.O.M.', 145, 262, { size: 30, color: INK, weight: '900' });
    txt(c, 'ELECTRIC', 145, 290, { size: 18, color: INK, fam: MONO, weight: '900' });
    txt(c, '14 AWG', 145, 424, { size: 26, color: '#b5160f', weight: '900' });
    txt(c, 'COPPER • 50 m', 145, 452, { size: 15, color: INK, fam: MONO });
    roomIcon(c, 74, 355, 30, INK, null, 0.12); roomIcon(c, 216, 355, 30, INK, null, 0.12);
    wear(c, 0, 210, 290, 290, 4, 1.2, { edge: false });
    // orange plastic (300,210,200,100)
    rect(c, 300, 210, 200, 100, '#e8661c');
    noise(c, 300, 210, 200, 100, 8, 2);
  });
  const p = paint(A, { rough: 0.42 });
  const cu = paint(A, { rough: 0.3, metal: 1 });
  const k = new Kit();
  const Rf = 0.05, Ri = 0.012, Rw = 0.0415, H = 0.06, tf = 0.006;
  k.lathe([[Ri, 0, 1], [Rf - 0.002, 0], [Rf, 0.002], [Rf, tf - 0.001], [Rf - 0.002, tf, 1], [Rw, tf, 1], [Rw, H - tf, 1], [Rf - 0.002, H - tf, 1], [Rf, H - tf + 0.001], [Rf, H - 0.002], [Rf - 0.002, H, 1], [Ri, H, 1], [Ri, 0]], p, { seg: 32, uv: A.R(300, 210, 200, 100) });
  k.cyl(Rw + 0.0006, Rw + 0.0006, H - 2 * tf, cu, { seg: 36, open: true, p: [0, H / 2, 0], uv: A.R(0, 0, 512, 200) });
  k.add(new THREE.RingGeometry(Ri + 0.001, Rf - 0.003, 32, 1), p, { r: [-PI / 2, 0, 0], p: [0, H + 0.0003, 0], uv: A.R(0, 210, 290, 290) });
  // loose wire end
  k.tube([[0.03, H - tf - 0.004, 0.028], [0.045, H - 0.004, 0.03], [0.06, H + 0.006, 0.028], [0.07, H + 0.002, 0.012], [0.066, H - 0.012, 0.0]], 0.0009, cu, { tseg: 24, rseg: 5, col: 0xffc8a0, uv: A.R(0, 90, 512, 10) });
  k.colCyl(Rf, H, [0, H / 2, 0]);
  return { kit: k, meta: { mass: 0.6, material: 'plastic', hold: { grip: [Rf - 0.01, H / 2, 0], rot: [1.3, 0.1, 0.05], off: [0, 0.02, 0] } } };
});

// ---------------------------------------------------------------- pipe_short (galvanised 1", 0.4 m)
def('pipe_short', () => {
  const A = atlas('pipe_short', 512, 1024, (c) => {
    // galvanised wrap (0,0,512,900): u around (top x=256), v along
    rect(c, 0, 0, 512, 900, '#a9adb0');
    const r = new RNG(6);
    for (let i = 0; i < 260; i++) {
      const x = r.range(0, 512), y = r.range(0, 900), s = r.range(6, 26);
      c.fillStyle = `rgba(${r.next() < 0.5 ? '230,232,234' : '120,124,128'},${r.range(0.1, 0.3)})`;
      c.beginPath(); c.moveTo(x, y - s); c.lineTo(x + s * 0.8, y); c.lineTo(x, y + s * 0.7); c.lineTo(x - s * 0.9, y); c.fill();
    }
    noise(c, 0, 0, 512, 900, 16, 2);
    for (let i = 0; i < 12; i++) { const x = r.range(0, 512), y = r.range(0, 900); const g = c.createRadialGradient(x, y, 0, x, y, r.range(10, 40)); g.addColorStop(0, 'rgba(140,80,30,0.45)'); g.addColorStop(1, 'rgba(140,80,30,0)'); c.fillStyle = g; c.fillRect(x - 40, y - 40, 80, 80); }
    // sticker near one end on top
    rect(c, 186, 140, 140, 210, '#f6f3ea');
    txt(c, 'R.O.O.M.', 256, 170, { size: 24, color: INK, weight: '900' });
    txt(c, 'PLUMBING', 256, 194, { size: 16, color: INK, fam: MONO });
    txt(c, '1" × 16"', 256, 226, { size: 26, color: '#2c5d8a', weight: '900' });
    txt(c, 'SCH 40', 256, 252, { size: 15, color: INK, fam: MONO });
    barcode(c, 196, 270, 120, 70, 14, false);
    wear(c, 186, 140, 140, 210, 3, 2);
    txt(c, 'MADE IN SUBLEVEL 9', 256, 620, { size: 20, color: 'rgba(40,40,40,0.45)', fam: MONO, rot: -PI / 2 });
    wear(c, 0, 0, 512, 900, 8, 1.5, { edge: false });
  });
  const p = paint(A, { rough: 0.42, metal: 0.85 });
  const k = new Kit();
  const ro = 0.0167, ri = 0.0133, L = 0.4;
  const prof = [[ri, 0, 1], [ro - 0.0006, 0, 1], [ro - 0.0002, 0.0008]];
  for (let i = 0; i < 7; i++) { const y = 0.002 + i * 0.0026; prof.push([ro - 0.0007, y], [ro, y + 0.0013]); }
  prof.push([ro, 0.022]);
  for (let i = 0; i < 7; i++) { const y = L - 0.021 + i * 0.0026; prof.push([ro, y], [ro - 0.0007, y + 0.0013]); }
  prof.push([ro - 0.0002, L - 0.0008], [ro - 0.0006, L, 1], [ri, L, 1], [ri, 0]);
  k.push({ r: [PI / 2, 0, 0], p: [0, 0, -L / 2] });
  k.lathe(prof, p, { seg: 22, vFromY: [0, L], uv: A.R(0, 0, 512, 900), col: (q) => (Math.hypot(q.x, q.y) < ri + 0.0005 ? 0x3a3a3a : 0xffffff) });
  k.pop();
  k.colCyl(ro, L, [0, 0, 0], [PI / 2, 0, 0]);
  return { kit: k, meta: { mass: 1.0, material: 'metal', hold: { grip: [0, 0, 0.13], rot: [0.75, 0.05, -0.2], off: [0, -0.02, 0] } } };
});

// ---------------------------------------------------------------- gear
def('gear', () => {
  const A = atlas('gear', 512, 512, (c) => {
    // machined face (0,0,400,400): planar, centre (200,200)
    rect(c, 0, 0, 400, 400, '#9a9ea2');
    for (let rr = 4; rr < 200; rr += 2.2) {
      c.strokeStyle = `rgba(${rr % 4.4 < 2.2 ? '255,255,255' : '40,42,44'},${0.08 + (rr % 7) * 0.012})`; c.lineWidth = 1.3;
      c.beginPath(); c.arc(200, 200, rr, 0, TAU); c.stroke();
    }
    noise(c, 0, 0, 400, 400, 12, 4);
    // stamped text around (between bore and holes)
    c.save(); c.translate(200, 200);
    const s = 'R.O.O.M. • 16T M7 • ';
    for (let i = 0; i < s.length; i++) { c.save(); c.rotate((i / s.length) * TAU); txt(c, s[i], 0, -150, { size: 18, color: 'rgba(30,30,32,0.75)', fam: MONO, weight: '900' }); c.restore(); }
    c.restore();
    const g = c.createRadialGradient(200, 200, 60, 200, 200, 200);
    g.addColorStop(0, 'rgba(60,40,20,0)'); g.addColorStop(1, 'rgba(60,40,20,0.35)');
    c.fillStyle = g; c.fillRect(0, 0, 400, 400);
    // flank / bore steel (0,404,400,90)
    rect(c, 0, 404, 400, 90, '#7c8084');
    for (let x = 0; x < 400; x += 3) rect(c, x, 404, 1, 90, 'rgba(255,255,255,0.08)');
    noise(c, 0, 404, 400, 90, 14, 6);
  });
  const p = paint(A, { rough: 0.36, metal: 0.65 });
  const k = new Kit();
  const Rt = 0.056, Rr = 0.0465, N = 16, Th = 0.012;
  const sh = new THREE.Shape();
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * TAU;
    const pts = [[Rr, a0 - 0.115], [Rt, a0 - 0.06], [Rt, a0 + 0.06], [Rr, a0 + 0.115]];
    pts.forEach(([r, a], j) => { const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i === 0 && j === 0) sh.moveTo(x, y); else sh.lineTo(x, y); });
    const am = a0 + PI / N;
    sh.lineTo(Math.cos(am) * (Rr - 0.0012), Math.sin(am) * (Rr - 0.0012));
  }
  sh.closePath();
  const bore = new THREE.Path();
  const kw = 0.0028, rb = 0.0115;
  const ak = Math.asin(kw / rb);
  bore.moveTo(Math.cos(ak) * rb, Math.sin(ak) * rb);
  bore.absarc(0, 0, rb, ak, TAU - ak, false);
  bore.lineTo(0.0148, -kw); bore.lineTo(0.0148, kw); bore.closePath();
  sh.holes.push(bore);
  for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU + 0.3; const h = new THREE.Path(); h.absarc(Math.cos(a) * 0.031, Math.sin(a) * 0.031, 0.0085, 0, TAU, true); sh.holes.push(h); }
  // (curveSegments kept low: 5 lightening holes + bore dominate the triangle count)
  const face = A.R(0, 0, 400, 400), flank = A.R(0, 404, 400, 90);
  const uvf = (q, n) => {
    if (Math.abs(n.z) > 0.6) return [face[0] + (q.x / 0.112 + 0.5) * (face[2] - face[0]), face[1] + (q.y / 0.112 + 0.5) * (face[3] - face[1])];
    const a = Math.atan2(q.y, q.x) / TAU + 0.5;
    return [flank[0] + a * (flank[2] - flank[0]), flank[1] + (q.z / (Th * 2) + 0.5) * (flank[3] - flank[1])];
  };
  k.push({ r: [-PI / 2, 0, 0] });
  k.add(extrudeGeo(sh, Th, 0.001, { curveSegments: 7, bevelSegments: 1 }), p, { uvFn: uvf });
  // hub bosses
  for (const sz of [-1, 1]) {
    const hub = new THREE.Shape(); hub.absarc(0, 0, 0.021, 0, TAU, false);
    const hb = new THREE.Path(); hb.moveTo(Math.cos(ak) * rb, Math.sin(ak) * rb); hb.absarc(0, 0, rb, ak, TAU - ak, false); hb.lineTo(0.0148, -kw); hb.lineTo(0.0148, kw); hb.closePath();
    hub.holes.push(hb);
    k.add(extrudeGeo(hub, 0.004, 0.0006, { curveSegments: 10, bevelSegments: 1 }), p, { p: [0, 0, sz * (Th / 2 + 0.002)], uvFn: uvf });
  }
  k.pop();
  k.colCyl(Rt, Th + 0.002, [0, 0, 0]);
  k.colCyl(0.021, Th + 0.012, [0, 0, 0]);
  return { kit: k, meta: { mass: 0.7, material: 'metal', hold: { grip: [0.045, 0, 0.0], rot: [1.3, 0.1, 0.15], off: [0, 0.03, 0] } } };
});
