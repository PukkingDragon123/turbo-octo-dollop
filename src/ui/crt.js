// Retro phosphor CRT screens drawn on canvases (used in-world on devices, the wristwatch,
// the radio...). Fallout-style amber/green terminal look with scanlines and glow.
import * as THREE from 'three';
import { FONT as SLOTS } from './fonts.js';

export const PALETTES = {
  amber: { fg: '#ffb43a', dim: '#a8701c', bg: '#140b02', hi: '#fff0c0', bad: '#ff5a3a', good: '#ffd060' },
  green: { fg: '#4dff7a', dim: '#1f9a40', bg: '#020f05', hi: '#d8ffe0', bad: '#ff5a4a', good: '#9dff5a' },
  cyan: { fg: '#5ae8ff', dim: '#1f7a8a', bg: '#020a10', hi: '#e0fbff', bad: '#ff6a5a', good: '#7dffb0' },
  red: { fg: '#ff4a3a', dim: '#8a1f18', bg: '#120202', hi: '#ffd0c8', bad: '#ffffff', good: '#ffb040' },
};

export const FONT = SLOTS.terminal; // the 'terminal' font slot (fonts.js)

export class CrtScreen {
  constructor(w = 512, h = 384, palette = 'amber') {
    this.w = w;
    this.h = h;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.pal = PALETTES[palette] || PALETTES.amber;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.time = 0;
    this.lastDraw = -1;
    this.fps = 12;
    this.flicker = 0;
    this.on = true;
  }

  setPalette(name) { this.pal = PALETTES[name] || this.pal; }

  // attach to a mesh material (map + emissive)
  attach(mesh, intensity = 1.4) {
    if (!mesh) return;
    const m = new THREE.MeshStandardMaterial({ map: this.texture, emissiveMap: this.texture, emissive: 0xffffff, emissiveIntensity: intensity, roughness: 0.25, metalness: 0 });
    mesh.material = m;
    mesh.userData.noProbe = true;
    this.material = m;
  }

  // throttled redraw: fn(ctx, w, h, pal, t)
  draw(dt, fn, force = false) {
    this.time += dt;
    if (!force && this.time - this.lastDraw < 1 / this.fps) return false;
    this.lastDraw = this.time;
    const { ctx, w, h, pal } = this;
    ctx.save();
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, w, h);
    if (this.on) {
      ctx.shadowColor = pal.fg;
      ctx.shadowBlur = 3;
      fn(ctx, w, h, pal, this.time);
    }
    ctx.restore();
    this.overlay();
    this.texture.needsUpdate = true;
    return true;
  }

  overlay() {
    const { ctx, w, h } = this;
    // scanlines
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    // rolling bar
    const by = ((this.time * 40) % (h + 80)) - 40;
    const g = ctx.createLinearGradient(0, by - 40, 0, by + 40);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.035)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, by - 40, w, 80);
    // vignette
    const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.72);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
  }
}

// ---- drawing helpers ----
export function text(ctx, str, x, y, size, color, align = 'left', glow = true) {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillStyle = color;
  if (!glow) ctx.shadowBlur = 0;
  ctx.fillText(str, x, y);
  if (!glow) ctx.shadowBlur = 3;
}

export function bar(ctx, x, y, w, h, frac, color, dim) {
  ctx.strokeStyle = dim;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  const segs = Math.max(4, Math.floor(w / 10));
  const n = Math.round(Math.max(0, Math.min(1, frac)) * segs);
  ctx.fillStyle = color;
  const sw = (w - 4) / segs;
  for (let i = 0; i < n; i++) ctx.fillRect(x + 2 + i * sw + 1, y + 3, sw - 2, h - 6);
}

export function box(ctx, x, y, w, h, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
}

export function wrap(ctx, str, maxW, size) {
  ctx.font = `${size}px ${FONT}`;
  const words = String(str).split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; }
    else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

// Generic menu drawing used by terminals. view = {title, subtitle, lines:[str|{t,c}], items:[{label, hint, disabled}], sel, footer}
export function drawMenu(ctx, w, h, pal, t, view) {
  const pad = 22;
  text(ctx, view.title || 'R.O.O.M. TERMINAL', pad, 14, 34, pal.hi);
  if (view.subtitle) text(ctx, view.subtitle, w - pad, 20, 22, pal.dim, 'right');
  ctx.fillStyle = pal.dim;
  ctx.fillRect(pad, 52, w - pad * 2, 2);
  let y = 62;
  for (const l of view.lines || []) {
    const o = typeof l === 'string' ? { t: l } : l;
    const lines = wrap(ctx, o.t, w - pad * 2, o.s || 24);
    for (const ln of lines) {
      text(ctx, ln, pad, y, o.s || 24, o.c ? pal[o.c] || o.c : pal.fg);
      y += (o.s || 24) - 2;
    }
  }
  if (view.items?.length) {
    y += 6;
    view.items.forEach((it, i) => {
      const sel = i === view.sel;
      const col = it.disabled ? pal.dim : sel ? pal.bg : pal.fg;
      if (sel) {
        ctx.fillStyle = it.disabled ? pal.dim : pal.fg;
        ctx.fillRect(pad - 6, y - 1, w - pad * 2 + 12, 27);
      }
      text(ctx, `${sel ? '>' : ' '} ${it.label}`, pad, y, 26, sel && it.disabled ? pal.bg : col);
      if (it.hint) text(ctx, it.hint, w - pad, y, 24, sel ? pal.bg : pal.dim, 'right');
      it._y = y;
      y += 29;
    });
  }
  if (view.footer) {
    ctx.fillStyle = pal.dim;
    ctx.fillRect(pad, h - 40, w - pad * 2, 2);
    text(ctx, view.footer, pad, h - 34, 22, pal.dim);
  }
  if (Math.floor(t * 2) % 2 === 0) {
    ctx.fillStyle = pal.fg;
    ctx.fillRect(w - pad - 12, h - 32, 10, 18);
  }
}
