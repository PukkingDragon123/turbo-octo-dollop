// One shared canvas atlas for every printed thing on the furniture: labels, stickers, book spines,
// key glyphs, screens, stencils, stitching, leaves — plus a 256-entry palette for small solid
// coloured details (slot '#rrggbb[:g|:m|:e]' in the builder collapses UVs onto a palette texel).
// A quarter-resolution companion "surface" map (R = emission, G = roughness, B = metalness, read
// with nearest filtering) lets matte, glossy, metallic and glowing palette cells / label regions
// all render through ONE material, i.e. one draw call per model for every small detail.
import * as THREE from 'three';
import { RNG, hashString } from '../../core/rng.js';

const TAU = Math.PI * 2;
const REG = {};
export function region(name, w, h, draw) { REG[name] = { w, h, draw }; }
export function regionSize(name) { const r = REG[name]; return r ? [r.w, r.h] : null; }
const AT = { S: 2048, canvas: null, ctx: null, tex: null, rects: new Map(), pal: new Map(), palN: 0, used: 0, octx: null, otex: null, kinds: new Map() };
const OD = 4; // surface map downscale
// surface kinds: [emission, roughness, metalness]
const KIND = { '': [0, 0.62, 0], g: [0, 0.22, 0], m: [0, 0.34, 0.65], e: [1, 0.3, 0] };
function fillKind(x, y, w, h, kind) {
  const k = KIND[kind] || KIND[''];
  AT.octx.fillStyle = `rgb(${Math.round(k[0] * 255)},${Math.round(k[1] * 255)},${Math.round(k[2] * 255)})`;
  const x0 = Math.floor(x / OD), y0 = Math.floor(y / OD);
  AT.octx.fillRect(x0, y0, Math.ceil((x + w) / OD) - x0, Math.ceil((y + h) / OD) - y0);
  if (AT.otex) AT.otex.needsUpdate = true;
}

export function atlasTex() {
  if (AT.tex) return AT.tex;
  const c = document.createElement('canvas');
  c.width = c.height = AT.S;
  const ctx = c.getContext('2d');
  AT.canvas = c;
  AT.ctx = ctx;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, AT.S, AT.S);
  const oc = document.createElement('canvas');
  oc.width = oc.height = AT.S / OD;
  AT.octx = oc.getContext('2d');
  fillKind(0, 0, AT.S, AT.S, '');
  const names = Object.keys(REG).sort((a, b) => REG[b].h - REG[a].h || REG[b].w - REG[a].w);
  let x = 0, y = 0, rowH = 0;
  const pad = 4;
  for (const n of names) {
    const r = REG[n];
    if (x + r.w > AT.S) { x = 0; y += rowH + pad; rowH = 0; }
    AT.rects.set(n, { x, y, w: r.w, h: r.h });
    x += r.w + pad;
    rowH = Math.max(rowH, r.h);
  }
  AT.used = y + rowH;
  if (AT.used > AT.S) console.warn('[furniture] atlas overflow', AT.used);
  for (const n of names) {
    const r = AT.rects.get(n);
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.beginPath();
    ctx.rect(0, 0, r.w, r.h);
    ctx.clip();
    ctx.clearRect(0, 0, r.w, r.h);
    try { REG[n].draw(ctx, r.w, r.h, new RNG(hashString(n))); } catch (e) { console.warn('[furniture] atlas region failed', n, e); }
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  AT.tex = t;
  const ot = new THREE.CanvasTexture(oc);
  ot.colorSpace = THREE.NoColorSpace;
  ot.magFilter = ot.minFilter = THREE.NearestFilter;
  ot.generateMipmaps = false;
  AT.otex = ot;
  return t;
}
// surface map (emission / roughness / metalness) matching the atlas UVs
export function atlasSurfaceTex() { atlasTex(); return AT.otex; }
// mark a whole label region as glossy ('g'), metallic ('m') or glowing ('e')
export function regionKind(name, kind) {
  atlasTex();
  if ((AT.kinds.get(name) ?? '') === kind) return;
  if (AT.kinds.has(name)) console.warn(`[furniture] atlas region ${name} used as both ${AT.kinds.get(name)} and ${kind}`);
  const r = AT.rects.get(name);
  if (!r) throw new Error(`[furniture] unknown atlas region ${name}`);
  AT.kinds.set(name, kind);
  fillKind(r.x, r.y, r.w, r.h, kind);
}
export const atlasReady = () => !!AT.tex;
export const atlasInfo = () => ({ canvas: AT.canvas, used: AT.used, size: AT.S, palette: AT.palN });

// UV rect of a region (optionally one cell of a cols x rows grid, cell index row-major from top-left)
export function rUV(name, cell = -1, cols = 1, rows = 1) {
  atlasTex();
  const r = AT.rects.get(name);
  if (!r) throw new Error(`[furniture] unknown atlas region ${name}`);
  let x = r.x, y = r.y, w = r.w, h = r.h;
  if (cell >= 0) {
    w = r.w / cols; h = r.h / rows;
    x += (cell % cols) * w; y += Math.floor(cell / cols) * h;
  }
  const S = AT.S;
  return { u0: (x + 0.5) / S, u1: (x + w - 0.5) / S, v0: 1 - (y + h - 0.5) / S, v1: 1 - (y + 0.5) / S };
}

region('pal', 256, 256, () => {});
// palette texel for a colour; kind '' (matte), 'g' (gloss), 'm' (metal), 'e' (glowing)
export function palUV(hex, kind = '') {
  const key = kind ? hex + ':' + kind : hex;
  let c = AT.pal.get(key);
  if (c) return c;
  atlasTex();
  const r = AT.rects.get('pal');
  const i = AT.palN++;
  if (i >= 256) { console.warn('[furniture] palette full'); return palUV('#ff00ff'); }
  const cx = r.x + (i % 16) * 16, cy = r.y + Math.floor(i / 16) * 16;
  AT.ctx.fillStyle = hex;
  AT.ctx.fillRect(cx, cy, 16, 16);
  AT.tex.needsUpdate = true;
  fillKind(cx + 4, cy + 4, 8, 8, kind);
  c = [(cx + 8) / AT.S, 1 - (cy + 8) / AT.S];
  AT.pal.set(key, c);
  return c;
}

// ---------------------------------------------------------------------------
// canvas drawing helpers (shared by label definitions)
// ---------------------------------------------------------------------------
export const FONTS = {
  sans: 'Arial, Helvetica, "Liberation Sans", sans-serif',
  mono: '"IBM Plex Mono", "Courier New", monospace',
  lcd: 'VT323, "IBM Plex Mono", monospace',
  serif: 'Georgia, "Times New Roman", "Liberation Serif", serif',
  cond: '"Arial Narrow", "Liberation Sans Narrow", Arial, sans-serif',
};
export function font(px, fam = 'sans', weight = 'bold') { return `${weight} ${px}px ${FONTS[fam] || fam}`; }
export function txt(ctx, s, x, y, px, color = '#000', o = {}) {
  ctx.font = font(px, o.fam || 'sans', o.weight || 'bold');
  ctx.fillStyle = color;
  ctx.textAlign = o.align || 'center';
  ctx.textBaseline = o.base || 'middle';
  if (o.maxW) ctx.fillText(s, x, y, o.maxW); else ctx.fillText(s, x, y);
}
export function marker(ctx, s, x, y, px, color, rng, o = {}) {
  ctx.font = font(px, o.fam || 'sans', o.weight || 'bold');
  const ws = [...s].map((ch) => ctx.measureText(ch).width * (o.tight ?? 0.9));
  let cx = x - (o.align === 'left' ? 0 : ws.reduce((a, b) => a + b, 0) / 2);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  let drift = 0;
  [...s].forEach((ch, i) => {
    drift += (rng.next() - 0.5) * px * 0.05;
    ctx.save();
    ctx.translate(cx, y + drift + (rng.next() - 0.5) * px * 0.1);
    ctx.rotate((rng.next() - 0.5) * 0.18 + (o.slant || 0));
    ctx.scale(0.88 + rng.next() * 0.18, 0.92 + rng.next() * 0.16);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    cx += ws[i];
  });
}
export function grunge(ctx, w, h, rng, n = 300, a = 1, rmax = 2.2) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = rng.next() * a;
    ctx.beginPath();
    ctx.arc(rng.next() * w, rng.next() * h, rng.next() * rmax + 0.3, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}
export function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
export function noiseFill(ctx, w, h, rng, base, n = 600, a = 0.06, dark = true) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = dark ? `rgba(0,0,0,${rng.next() * a})` : `rgba(255,255,255,${rng.next() * a})`;
    ctx.fillRect(rng.next() * w, rng.next() * h, 1 + rng.next() * 3, 1 + rng.next() * 3);
  }
}
export function barcode(ctx, x, y, w, h, rng) {
  ctx.fillStyle = '#111';
  let cx = x;
  while (cx < x + w) {
    const bw = 1 + Math.floor(rng.next() * 3);
    if (rng.next() > 0.45) ctx.fillRect(cx, y, bw, h);
    cx += bw + 1;
  }
}
export function logo(ctx, x, y, s, color) {
  // ROOM CORP mark: nested squares with a door slot
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = s * 0.09;
  ctx.strokeRect(x - s / 2, y - s / 2, s, s);
  ctx.strokeRect(x - s * 0.28, y - s * 0.28, s * 0.56, s * 0.56);
  ctx.fillRect(x - s * 0.07, y - s * 0.05, s * 0.14, s * 0.33);
  ctx.restore();
}
export function lines(ctx, x, y, w, rows, gap, rng, color = 'rgba(30,30,40,0.75)', th = 3) {
  ctx.fillStyle = color;
  for (let i = 0; i < rows; i++) {
    let cx = x;
    const end = x + w * (i === rows - 1 ? 0.3 + rng.next() * 0.4 : 0.8 + rng.next() * 0.2);
    while (cx < end) {
      const ww = 4 + rng.next() * 18;
      ctx.fillRect(cx, y + i * gap, Math.min(ww, end - cx), th);
      cx += ww + 3 + rng.next() * 3;
    }
  }
}
export function blobStains(ctx, w, h, rng, n, cols = ['150,105,35', '120,80,45', '160,125,60', '95,70,50'], o = {}) {
  for (let i = 0; i < n; i++) {
    const cx = o.center ? w / 2 + (rng.next() - 0.5) * o.center : rng.next() * w, cy = o.center ? h / 2 + (rng.next() - 0.5) * o.center : rng.next() * h;
    const R = o.rMin !== undefined ? o.rMin + rng.next() * (o.rMax - o.rMin) : 10 + rng.next() * rng.next() * 70;
    const col = cols[Math.floor(rng.next() * cols.length)];
    const k = 22, ph = [rng.next() * 6, rng.next() * 6, rng.next() * 6];
    ctx.beginPath();
    for (let j = 0; j <= k; j++) {
      const a = (j / k) * TAU;
      const r = R * (1 + 0.25 * Math.sin(a * 2 + ph[0]) + 0.15 * Math.sin(a * 3 + ph[1]) + 0.1 * Math.sin(a * 5 + ph[2]));
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * (0.7 + 0.3 * Math.sin(ph[0]));
      if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = `rgba(${col},${0.08 + rng.next() * 0.14})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${col},${0.22 + rng.next() * 0.22})`;
    ctx.lineWidth = 1 + rng.next() * 2.5;
    ctx.stroke();
    if (rng.next() > 0.5) { ctx.save(); ctx.translate(cx, cy); ctx.scale(0.55, 0.5); ctx.translate(-cx, -cy); ctx.fillStyle = `rgba(${col},0.12)`; ctx.fill(); ctx.restore(); }
  }
}
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', ' ': '', '-': 'g' };
export function seg7(ctx, str, x, y, hg, on, off) {
  const w = hg * 0.5, t = hg * 0.11;
  let cx = x;
  ctx.save();
  ctx.transform(1, 0, -0.08, 1, y * 0.08, 0);
  for (const ch of str) {
    if (ch === ':') { ctx.fillStyle = on; ctx.fillRect(cx + t * 0.4, y + hg * 0.27, t, t); ctx.fillRect(cx + t * 0.4, y + hg * 0.64, t, t); cx += t * 2.4; continue; }
    if (ch === '.') { ctx.fillStyle = on; ctx.fillRect(cx, y + hg - t, t, t); cx += t * 2; continue; }
    const s = SEG[ch] ?? '';
    const R = { a: [cx + t, y, w - 2 * t, t], b: [cx + w - t, y + t, t, hg / 2 - 1.5 * t], c: [cx + w - t, y + hg / 2 + 0.5 * t, t, hg / 2 - 1.5 * t], d: [cx + t, y + hg - t, w - 2 * t, t], e: [cx, y + hg / 2 + 0.5 * t, t, hg / 2 - 1.5 * t], f: [cx, y + t, t, hg / 2 - 1.5 * t], g: [cx + t, y + hg / 2 - t / 2, w - 2 * t, t] };
    for (const k of 'abcdefg') { if (!s.includes(k) && !off) continue; ctx.fillStyle = s.includes(k) ? on : off; const r = R[k]; ctx.fillRect(r[0], r[1], r[2], r[3]); }
    cx += w + t * 1.6;
  }
  ctx.restore();
}
