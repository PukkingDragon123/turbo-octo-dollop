// R.O.O.M. pixel-art kit: everything 2D (HUD, icons, frames, buttons, the wrist terminal) is drawn here
// at low resolution into plain RGBA buffers with a curated palette, 1 px ink outlines, rim light, ramp
// shading and ordered dithering, then shown scaled up with `image-rendering: pixelated`.
// No image files: sprites are procedural or tiny string bitmaps.

// ------------------------------------------------------------------ palette
export const C = {
  ink: '#0d0906', ink2: '#1b130c', ink3: '#2b2016', ink4: '#3d2f22',
  paper: '#efe6cf', paper2: '#cfc3a4', paper3: '#9c8f72', white: '#fffaf0',
  amber0: '#4a2a06', amber1: '#8a5410', amber2: '#d68a1e', amber: '#ffb43a', amber4: '#ffd681', amber5: '#fff0c0',
  green0: '#04180b', green1: '#0c3a1a', green2: '#1f9a40', green: '#4dff7a', green4: '#a8ffbe', green5: '#e4ffe9',
  red0: '#3a0806', red1: '#7a1810', red2: '#c8301e', red: '#ff5a3a', red4: '#ff9c80', red5: '#ffd4c4',
  blue0: '#08203c', blue1: '#14467e', blue2: '#2276c8', blue: '#46aaff', blue4: '#9ad8ff', blue5: '#e2f6ff',
  hz0: '#3e300a', hz1: '#715a14', hz2: '#a8871f', hz: '#d9b437', hz4: '#f2d469', hz5: '#fff1a8',
  st0: '#1c1d1a', st1: '#33352f', st2: '#55584f', st3: '#80847a', st4: '#b3b7aa', st5: '#e3e6da',
  br0: '#2a160a', br1: '#4f2c13', br2: '#7f4a22', br3: '#b07038', br4: '#d9a160', br5: '#f2cc8f',
  pk0: '#3f1420', pk1: '#7a2c3c', pk2: '#b8505e', pk3: '#e8808a', pk4: '#ffb2b4', pk5: '#ffe0dc',
  pu1: '#3a1e5a', pu2: '#6a3aa0', pu3: '#a070e0', lime: '#c8ff3a', lime2: '#7ab81a', cyan: '#5ae8ff',
};
export const RAMP = {
  steel: [C.st0, C.st1, C.st2, C.st3, C.st4, C.st5],
  amber: [C.amber0, C.amber1, C.amber2, C.amber, C.amber4, C.amber5],
  green: [C.green0, C.green1, C.green2, C.green, C.green4, C.green5],
  red: [C.red0, C.red1, C.red2, C.red, C.red4, C.red5],
  blue: [C.blue0, C.blue1, C.blue2, C.blue, C.blue4, C.blue5],
  hazmat: [C.hz0, C.hz1, C.hz2, C.hz, C.hz4, C.hz5],
  brown: [C.br0, C.br1, C.br2, C.br3, C.br4, C.br5],
  pink: [C.pk0, C.pk1, C.pk2, C.pk3, C.pk4, C.pk5],
  paper: [C.ink4, C.paper3, C.paper2, C.paper, C.white, C.white],
  purple: [C.ink3, C.pu1, C.pu2, C.pu3, '#d4b8ff', '#f0e6ff'],
  lime: [C.green0, '#2c4a08', C.lime2, C.lime, '#e8ffa0', '#fbffe0'],
  dark: [C.ink, C.ink2, C.ink3, C.ink4, '#56463a', '#7a6a5a'],
};
// flat list used to quantize 3D renders into the house palette
export const PALETTE = [...new Set(Object.values(C))];

const _cc = new Map();
export function rgba(c) {
  if (Array.isArray(c)) return c;
  let v = _cc.get(c);
  if (v) return v;
  const h = String(c).replace('#', '');
  v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255];
  _cc.set(c, v);
  return v;
}
export function mix(a, b, t) {
  const x = rgba(a), y = rgba(b);
  return [Math.round(x[0] + (y[0] - x[0]) * t), Math.round(x[1] + (y[1] - x[1]) * t), Math.round(x[2] + (y[2] - x[2]) * t), Math.round(x[3] + (y[3] - x[3]) * t)];
}
export function alpha(c, a) { const x = rgba(c); return [x[0], x[1], x[2], Math.round(a * 255)]; }
export function hex(c) { const x = rgba(c); return '#' + x.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join(''); }
export function css(c) { const x = rgba(c); return `rgba(${x[0]},${x[1]},${x[2]},${(x[3] / 255).toFixed(3)})`; }

// 4x4 Bayer matrix for ordered dithering (0..15)
export const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const bayer = (x, y) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

// ------------------------------------------------------------------ RGBA pixel buffer
export class Pix {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.d = new Uint8ClampedArray(w * h * 4);
  }

  clear() { this.d.fill(0); return this; }
  fill(c) { const [r, g, b, a] = rgba(c); for (let i = 0; i < this.d.length; i += 4) { this.d[i] = r; this.d[i + 1] = g; this.d[i + 2] = b; this.d[i + 3] = a; } return this; }
  a(x, y) { return x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : this.d[(y * this.w + x) * 4 + 3]; }
  get(x, y) { const i = (y * this.w + x) * 4; return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]]; }

  set(x, y, c) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || c == null) return;
    const s = rgba(c), d = this.d, i = (y * this.w + x) * 4;
    if (s[3] >= 255) { d[i] = s[0]; d[i + 1] = s[1]; d[i + 2] = s[2]; d[i + 3] = 255; return; }
    if (s[3] <= 0) return;
    const sa = s[3] / 255, da = d[i + 3] / 255, oa = sa + da * (1 - sa);
    d[i] = (s[0] * sa + d[i] * da * (1 - sa)) / oa;
    d[i + 1] = (s[1] * sa + d[i + 1] * da * (1 - sa)) / oa;
    d[i + 2] = (s[2] * sa + d[i + 2] * da * (1 - sa)) / oa;
    d[i + 3] = oa * 255;
  }
  erase(x, y) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.d[(y * this.w + x) * 4 + 3] = 0; }

  rect(x, y, w, h, c) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c); return this; }
  frame(x, y, w, h, c) { this.hline(x, x + w - 1, y, c); this.hline(x, x + w - 1, y + h - 1, c); this.vline(x, y, y + h - 1, c); this.vline(x + w - 1, y, y + h - 1, c); return this; }
  hline(x0, x1, y, c) { for (let x = x0; x <= x1; x++) this.set(x, y, c); return this; }
  vline(x, y0, y1, c) { for (let y = y0; y <= y1; y++) this.set(x, y, c); return this; }
  // rounded box: r = corner cut in px
  rbox(x, y, w, h, r, c) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const dx = Math.max(r - i, i - (w - 1 - r), 0), dy = Math.max(r - j, j - (h - 1 - r), 0);
        if (dx * dx + dy * dy <= r * r + 0.5) this.set(x + i, y + j, c);
      }
    }
    return this;
  }
  line(x0, y0, x1, y1, c) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
    return this;
  }
  // filled ellipse centred on (cx, cy) (half-pixel centres allowed)
  ellipse(cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const u = (x + 0.5 - cx) / rx, v = (y + 0.5 - cy) / ry;
        if (u * u + v * v <= 1.0) this.set(x, y, typeof c === 'function' ? c(u, v, x, y) : c);
      }
    }
    return this;
  }
  disc(cx, cy, r, c) { return this.ellipse(cx, cy, r, r, c); }
  ring(cx, cy, r, c, t = 1) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= r && d > r - t) this.set(x, y, c);
      }
    }
    return this;
  }
  // polygon fill (even-odd, pixel centres)
  poly(pts, c) {
    let y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      const yc = y + 0.5, xs = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + (yc - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) this.set(x, y, typeof c === 'function' ? c(x, y) : c);
    }
    return this;
  }
  // pick a ramp colour for v in 0..1 with optional ordered dithering between neighbouring steps
  static rampAt(ramp, v, x = 0, y = 0, dither = true) {
    const n = ramp.length - 1, f = Math.max(0, Math.min(1, v)) * n;
    let i = Math.floor(f);
    if (dither && f - i > bayer(x, y)) i++;
    return ramp[Math.max(0, Math.min(n, i))];
  }
  // a shaded rod / capsule from (x0,y0) to (x1,y1) with radius r: cylinder shading across its width,
  // light from the upper left. lo/hi clamp the ramp range used.
  rod(x0, y0, x1, y1, r, ramp, { round = false, lo = 0.12, hi = 0.92, dither = true, spec = true } = {}) {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    let nx = -uy, ny = ux;
    if (nx + ny > 0) { nx = -nx; ny = -ny; } // n points to the upper left (light side)
    const minx = Math.floor(Math.min(x0, x1) - r - 1), maxx = Math.ceil(Math.max(x0, x1) + r + 1);
    const miny = Math.floor(Math.min(y0, y1) - r - 1), maxy = Math.ceil(Math.max(y0, y1) + r + 1);
    for (let y = miny; y <= maxy; y++) {
      for (let x = minx; x <= maxx; x++) {
        const px = x + 0.5 - x0, py = y + 0.5 - y0;
        const t = px * ux + py * uy, s = px * nx + py * ny;
        if (round) { const tc = Math.max(0, Math.min(L, t)); if (Math.hypot(px - ux * tc, py - uy * tc) > r) continue; }
        else if (t < 0 || t > L || Math.abs(s) > r) continue;
        const k = s / r; // +1 = lit edge, -1 = shadow edge
        let v = 0.5 + 0.42 * k - 0.18 * k * k;
        if (spec && k > 0.25 && k < 0.6) v = Math.max(v, 0.97);
        this.set(x, y, Pix.rampAt(ramp, lo + (hi - lo) * v, x, y, dither));
      }
    }
    return this;
  }
  // upright cylinder (cans, bottles, jars): per-column shading
  cyl(x, y, w, h, ramp, { lo = 0.1, hi = 0.95, dither = true, spec = true } = {}) {
    for (let i = 0; i < w; i++) {
      const k = 1 - (i + 0.5) / w * 2; // +1 left .. -1 right
      let v = 0.55 + 0.4 * k - 0.25 * k * k;
      if (spec && k > 0.3 && k < 0.62) v = 0.99;
      for (let j = 0; j < h; j++) this.set(x + i, y + j, Pix.rampAt(ramp, lo + (hi - lo) * v, x + i, y + j, dither));
    }
    return this;
  }
  // vertical gradient box with a lit top edge and dark bottom edge
  vgrad(x, y, w, h, ramp, { lo = 0.15, hi = 0.85, dither = true } = {}) {
    for (let j = 0; j < h; j++) {
      const v = hi - (hi - lo) * (j / Math.max(1, h - 1));
      for (let i = 0; i < w; i++) this.set(x + i, y + j, Pix.rampAt(ramp, v, x + i, y + j, dither));
    }
    return this;
  }
  // bevelled block: light top/left edge, dark bottom/right edge
  bevel(x, y, w, h, ramp, { face = 3, light = 4, dark = 1 } = {}) {
    this.rect(x, y, w, h, ramp[face]);
    this.hline(x, x + w - 1, y, ramp[light]);
    this.vline(x, y, y + h - 1, ramp[light]);
    this.hline(x, x + w - 1, y + h - 1, ramp[dark]);
    this.vline(x + w - 1, y + 1, y + h - 1, ramp[dark]);
    return this;
  }
  dither(x, y, w, h, c, level = 0.5) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (bayer(i, j) < level) this.set(i, j, c);
    return this;
  }
  // recolour every opaque pixel inside a rect (masks)
  tint(x, y, w, h, fn) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (this.a(i, j)) this.set(i, j, fn(this.get(i, j), i, j));
    return this;
  }

  // ---- post passes (sprites) ----
  // 1 px outline around the silhouette (4-neighbour, optional corners)
  outline(c = C.ink, corners = false) {
    const m = new Uint8Array(this.w * this.h);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.a(x, y) > 40) continue;
        if (this.a(x - 1, y) > 40 || this.a(x + 1, y) > 40 || this.a(x, y - 1) > 40 || this.a(x, y + 1) > 40 ||
          (corners && (this.a(x - 1, y - 1) > 40 || this.a(x + 1, y - 1) > 40 || this.a(x - 1, y + 1) > 40 || this.a(x + 1, y + 1) > 40))) m[y * this.w + x] = 1;
      }
    }
    const col = rgba(c);
    for (let i = 0; i < m.length; i++) if (m[i]) { const k = i * 4; this.d[k] = col[0]; this.d[k + 1] = col[1]; this.d[k + 2] = col[2]; this.d[k + 3] = col[3]; }
    return this;
  }
  // rim light on the upper-left inner edge and a darker lower-right inner edge (before outlining)
  rim(light = 0.38, dark = 0.3) {
    const src = this.d.slice();
    const A = (x, y) => (x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : src[(y * this.w + x) * 4 + 3]);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = (y * this.w + x) * 4;
        if (src[i + 3] < 128) continue;
        const tl = A(x - 1, y) < 128 || A(x, y - 1) < 128;
        const br = A(x + 1, y) < 128 || A(x, y + 1) < 128;
        const f = tl && !br ? light : br && !tl ? -dark : 0;
        if (!f) continue;
        for (let k = 0; k < 3; k++) this.d[i + k] = f > 0 ? src[i + k] + (255 - src[i + k]) * f : src[i + k] * (1 + f);
      }
    }
    return this;
  }
  // soft 1 px drop shadow down-right on empty pixels
  shadow(a = 0.5, dx = 1, dy = 1) {
    const src = this.d.slice();
    for (let y = this.h - 1; y >= 0; y--) {
      for (let x = this.w - 1; x >= 0; x--) {
        const i = (y * this.w + x) * 4;
        if (src[i + 3] > 0) continue;
        const sx = x - dx, sy = y - dy;
        if (sx < 0 || sy < 0 || src[(sy * this.w + sx) * 4 + 3] < 128) continue;
        this.d[i] = 0; this.d[i + 1] = 0; this.d[i + 2] = 0; this.d[i + 3] = a * 255;
      }
    }
    return this;
  }
  // standard sprite finish: rim light, ink outline, drop shadow
  finish({ rim = true, outline = C.ink, shadow = 0.45 } = {}) {
    if (rim) this.rim();
    if (outline) this.outline(outline);
    if (shadow) this.shadow(shadow);
    return this;
  }
  blit(src, dx, dy, { flipX = false, tint = null, alpha: al = 1 } = {}) {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const i = (y * src.w + (flipX ? src.w - 1 - x : x)) * 4;
        const a = src.d[i + 3];
        if (!a) continue;
        const c = tint ? rgba(tint) : [src.d[i], src.d[i + 1], src.d[i + 2]];
        this.set(dx + x, dy + y, [c[0], c[1], c[2], a * al]);
      }
    }
    return this;
  }
  clone() { const p = new Pix(this.w, this.h); p.d.set(this.d); return p; }

  // ---- output ----
  toCanvas(cv) {
    cv = cv || document.createElement('canvas');
    if (cv.width !== this.w) cv.width = this.w;
    if (cv.height !== this.h) cv.height = this.h;
    if (!this._img || this._img.data !== this.d) this._img = new ImageData(this.d, this.w, this.h);
    cv.getContext('2d').putImageData(this._img, 0, 0);
    return cv;
  }
  url() { return this.toCanvas().toDataURL('image/png'); }
  // nearest-neighbour upscale into a canvas (for contexts that cannot use image-rendering)
  scaled(k, cv) {
    cv = cv || document.createElement('canvas');
    cv.width = this.w * k; cv.height = this.h * k;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.toCanvas(), 0, 0, cv.width, cv.height);
    return cv;
  }
}

// ------------------------------------------------------------------ string bitmaps
// rows of characters; map: char -> colour ('.' and ' ' are transparent)
export function bitmap(rows, map, pix = null, ox = 0, oy = 0) {
  const w = Math.max(...rows.map((r) => r.length)), h = rows.length;
  pix = pix || new Pix(w, h);
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) { const c = map[r[x]]; if (c) pix.set(ox + x, oy + y, c); } });
  return pix;
}

// ------------------------------------------------------------------ bitmap fonts
const F57 = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  J: ['..###', '...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['.#.', '##.', '.#.', '.#.', '.#.', '.#.', '###'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '.': ['.', '.', '.', '.', '.', '.', '#'],
  ',': ['..', '..', '..', '..', '..', '.#', '#.'],
  ':': ['.', '.', '#', '.', '.', '#', '.'],
  ';': ['..', '..', '.#', '..', '..', '.#', '#.'],
  '!': ['#', '#', '#', '#', '#', '.', '#'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '-': ['....', '....', '....', '####', '....', '....', '....'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '=': ['....', '....', '####', '....', '####', '....', '....'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  '%': ['##..#', '##..#', '...#.', '..#..', '.#...', '#..##', '#..##'],
  $: ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
  "'": ['#', '#', '.', '.', '.', '.', '.'],
  '"': ['#.#', '#.#', '...', '...', '...', '...', '...'],
  '(': ['.#', '#.', '#.', '#.', '#.', '#.', '.#'],
  ')': ['#.', '.#', '.#', '.#', '.#', '.#', '#.'],
  '[': ['##', '#.', '#.', '#.', '#.', '#.', '##'],
  ']': ['##', '.#', '.#', '.#', '.#', '.#', '##'],
  '<': ['...#', '..#.', '.#..', '#...', '.#..', '..#.', '...#'],
  '>': ['#...', '.#..', '..#.', '...#', '..#.', '.#..', '#...'],
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  '*': ['.....', '#.#.#', '.###.', '#####', '.###.', '#.#.#', '.....'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  _: ['....', '....', '....', '....', '....', '....', '####'],
  '@': ['.###.', '#...#', '#.###', '#.#.#', '#.###', '#....', '.###.'],
  '~': ['.....', '.....', '.#...', '#.#.#', '...#.', '.....', '.....'],
  '♥': ['.....', '.#.#.', '#####', '#####', '.###.', '..#..', '.....'],
  '·': ['.', '.', '.', '#', '.', '.', '.'],
  '—': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '◀': ['...#', '..##', '.###', '####', '.###', '..##', '...#'],
  '▶': ['#...', '##..', '###.', '####', '###.', '##..', '#...'],
  '▲': ['.......', '...#...', '..###..', '.#####.', '#######', '.......', '.......'],
  '▼': ['.......', '.......', '#######', '.#####.', '..###..', '...#...', '.......'],
  '•': ['...', '...', '###', '###', '###', '...', '...'],
};
const F35 = {
  0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['###', '..#', '###', '#..', '###'],
  3: ['###', '..#', '.##', '..#', '###'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '###', '..#', '###'],
  6: ['###', '#..', '###', '#.#', '###'], 7: ['###', '..#', '..#', '.#.', '.#.'], 8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '###'],
  A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'], E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'], K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'], N: ['#..#', '##.#', '#.##', '#..#', '#..#'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'], Q: ['.#.', '#.#', '#.#', '##.', '.##'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'], U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'], W: ['#...#', '#...#', '#.#.#', '#.#.#', '.#.#.'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], Z: ['###', '..#', '.#.', '#..', '###'],
  '%': ['#.#', '..#', '.#.', '#..', '#.#'], '/': ['..#', '..#', '.#.', '#..', '#..'], '.': ['.', '.', '.', '.', '#'],
  ':': ['.', '#', '.', '#', '.'], '-': ['...', '...', '###', '...', '...'], '+': ['...', '.#.', '###', '.#.', '...'],
  x: ['...', '#.#', '.#.', '#.#', '...'], '!': ['#', '#', '#', '.', '#'], '?': ['##.', '..#', '.#.', '...', '.#.'],
  '$': ['.##', '##.', '.#.', '.##', '##.'], '[': ['##', '#.', '#.', '#.', '##'], ']': ['##', '.#', '.#', '.#', '##'],
  '<': ['..#', '.#.', '#..', '.#.', '..#'], '>': ['#..', '.#.', '..#', '.#.', '#..'], "'": ['#', '#', '.', '.', '.'],
  '♥': ['.#.#.', '#####', '#####', '.###.', '..#..'], '·': ['.', '.', '#', '.', '.'], '(': ['.#', '#.', '#.', '#.', '.#'], ')': ['#.', '.#', '.#', '.#', '#.'],
  '=': ['...', '###', '...', '###', '...'], '#': ['#.#', '###', '#.#', '###', '#.#'], ',': ['.', '.', '.', '#', '#'],
};
function compile(src, h, space) {
  const out = { h, glyphs: {}, space };
  for (const [ch, rows] of Object.entries(src)) {
    const w = rows[0].length;
    const bits = [];
    rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === '#') bits.push(x, y); });
    out.glyphs[ch] = { w, bits };
  }
  return out;
}
export const FONT5 = compile(F57, 7, 3);
export const FONT3 = compile(F35, 5, 2);

export function textWidth(str, font = FONT5, spacing = 1) {
  let w = 0;
  for (const ch of String(str).toUpperCase()) {
    const g = font.glyphs[ch];
    w += (g ? g.w : font.space) + spacing;
  }
  return Math.max(0, w - spacing);
}
// draws text with its top-left at (x, y); align 'left' | 'center' | 'right'; returns the drawn width
export function text(pix, str, x, y, c, { font = FONT5, align = 'left', shadow = null, spacing = 1, scale = 1, outline = null } = {}) {
  str = String(str).toUpperCase();
  const w = textWidth(str, font, spacing) * scale;
  let cx = Math.round(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x);
  const draw = (ox, oy, col) => {
    let px = cx;
    for (const ch of str) {
      const g = font.glyphs[ch];
      if (!g) { px += (font.space + spacing) * scale; continue; }
      for (let i = 0; i < g.bits.length; i += 2) {
        for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) pix.set(px + g.bits[i] * scale + sx + ox, y + g.bits[i + 1] * scale + sy + oy, col);
      }
      px += (g.w + spacing) * scale;
    }
  };
  if (outline) { for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) draw(ox, oy, outline); }
  if (shadow) draw(scale, scale, shadow);
  draw(0, 0, c);
  return w;
}
// word wrap for the bitmap font
export function wrapText(str, maxW, font = FONT5, spacing = 1) {
  const words = String(str).toUpperCase().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (textWidth(t, font, spacing) > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

// ------------------------------------------------------------------ 11x11 UI glyphs ('#' main, '+' light, '-' shade)
export const GLYPH = {
  jump: ['.....#.....', '....###....', '...##.##...', '..##...##..', '.....#.....', '....###....', '...##.##...', '..##...##..', '...........', '.#########.', '.#########.'],
  hand: ['....#.#....', '..#.#.#....', '..#.#.#.#..', '..#.#.#.#..', '..#####.#..', '..#######.#', '..#######.#', '..########.', '..#######..', '...#####...', '...#####...'],
  fist: ['...........', '...##.##...', '..##+##+##.', '.#########.', '.#+##+##+#.', '.#########.', '.#########.', '.####------', '..#######..', '...#####...', '...#####...'],
  item: ['....###....', '....#.#....', '...#####...', '..#.....#..', '..#.###.#..', '..#.###.#..', '..#.....#..', '..#.###.#..', '..#.....#..', '..#######..', '...........'],
  crouch: ['.##.....##.', '..##...##..', '...##.##...', '....###....', '...........', '....###....', '....###....', '..#######..', '.#.#####.#.', '...##.##...', '.####.####.'],
  watch: ['...#####...', '...#####...', '..#######..', '.#.......#.', '.#...#...#.', '.#...#...##', '.#...###.#.', '.#.......#.', '..#######..', '...#####...', '...#####...'],
  light: ['.........#.', '.......#...', '.....#....#', '###.##.....', '#+######.##', '#+######...', '#-######.##', '###.##.....', '.....#....#', '.......#...', '.........#.'],
  drop: ['.....#.....', '.....#.....', '.....#.....', '...#.#.#...', '....###....', '.....#.....', '...........', '#.........#', '#.........#', '#.........#', '###########'],
  next: ['...####....', '..#....#.#.', '.#......##.', '.#.....###.', '.#.........', '...........', '.........#.', '.###.....#.', '.##......#.', '.#.#....#..', '....####...'],
  menu: ['...........', '.#########.', '.#########.', '...........', '...........', '.#########.', '.#########.', '...........', '...........', '.#########.', '.#########.'],
  bot: ['.....#.....', '..#######..', '.#.......#.', '.#.##.##.#.', '.#.##.##.#.', '.#.......#.', '.#.#...#.#.', '.#..###..#.', '.#.......#.', '..#######..', '...........'],
  throw: ['....####...', '...#....#..', '..#......#.', '..#.....###', '.#.......#.', '.#.........', '#..........', '#..........', '###........', '###........', '...........'],
  rotate: ['...#####...', '..#.....#..', '.#.......#.', '.#......###', '.#.......#.', '.#.........', '.#.........', '..#.....#..', '...#####...', '...........', '...........'],
  view: ['...........', '...........', '...#####...', '..#.....#..', '.#..###..#.', '#..##.##..#', '.#..###..#.', '..#.....#..', '...#####...', '...........', '...........'],
  solo: ['....###....', '...#####...', '...#####...', '....###....', '...........', '..#######..', '.#########.', '.#########.', '.#########.', '.#########.', '...........'],
  host: ['.#.......#.', '#..#...#..#', '#.#..#..#.#', '#.#.###.#.#', '#..#.#.#..#', '.#...#...#.', '.....#.....', '....#.#....', '....#.#....', '...#...#...', '...#####...'],
  join: ['....#######', '....#.....#', '..#.#.....#', '...##.....#', '#######...#', '...##.....#', '..#.#.....#', '....#.....#', '....#######', '...........', '...........'],
  gear: ['....###....', '.#..###..#.', '..#######..', '..##...##..', '###.....###', '###.....###', '###.....###', '..##...##..', '..#######..', '.#..###..#.', '....###....'],
  pad: ['...........', '...........', '.#########.', '#.........#', '#.#....#..#', '###..#.#.##', '#.#....#..#', '#.........#', '.###...###.', '...........', '...........'],
  back: ['...........', '...#.......', '..##.......', '.#########.', '##########.', '.#########.', '..##.......', '...#.......', '...........', '...........', '...........'],
  play: ['..#........', '..##.......', '..###......', '..####.....', '..#####....', '..######...', '..#####....', '..####.....', '..###......', '..##.......', '..#........'],
  door: ['......#####', '......#...#', '..#...#...#', '...#..#...#', '#######.#.#', '...#..#...#', '..#...#...#', '......#...#', '......#####', '...........', '...........'],
  ok: ['..........#', '.........##', '........##.', '#......##..', '##....##...', '.##..##....', '..####.....', '...##......', '...........', '...........', '...........'],
  skull: ['..#######..', '.#########.', '###########', '##...#...##', '##...#...##', '###########', '.####.####.', '..#######..', '..#.#.#.#..', '..#######..', '...........'],
  pulse: ['...........', '...........', '....#......', '....#......', '...#.#.....', '...#.#...#.', '##.#..#.#.#', '..#...#.#..', '.......#...', '...........', '...........'],
  map: ['...........', '##...##....', '#.###..###.', '#..#...#.#.', '#..#...#.#.', '#..#...#.#.', '#..#...#.#.', '#..#...#..#', '.###..###.#', '....##...##', '...........'],
  task: ['...###.....', '.##...##...', '.#######...', '.#.....#...', '.#.##..#...', '.#.....#...', '.#.##..#...', '.#.....#...', '.#.##..#...', '.#######...', '...........'],
  lock: ['...###.....', '..#...#....', '..#...#....', '.#######...', '.###.###...', '.###.###...', '.#######...', '...........', '...........', '...........', '...........'],
  person: ['....###....', '...#####...', '...#####...', '....###....', '..#######..', '.#.#####.#.', '.#.#####.#.', '...##.##...', '...##.##...', '...##.##...', '..###.###..'],
  ticket: ['...........', '#########..', '#.......#..', '#.#####.#..', '#.......#..', '#.###...#..', '#.......#..', '#########..', '...........', '...........', '...........'],
  dpad: ['....###....', '....#+#....', '....#+#....', '###.#+#.###', '#++++#++++#', '###.#-#.###', '....#-#....', '....#-#....', '....###....', '...........', '...........'],
  arrowL: ['....#......', '...##......', '..###......', '.####......', '..###......', '...##......', '....#......', '...........', '...........', '...........', '...........'],
  arrowR: ['......#....', '......##...', '......###..', '......####.', '......###..', '......##...', '......#....', '...........', '...........', '...........', '...........'],
};
export function glyph(name, c = C.green, { light = null, shade = null, pix = null, x = 0, y = 0 } = {}) {
  const g = GLYPH[name] || GLYPH.item;
  return bitmap(g, { '#': c, '+': light || mix(c, '#ffffff', 0.55), '-': shade || mix(c, '#000000', 0.45) }, pix, x, y);
}
// a glyph as a finished little sprite (outline + shadow) for DOM use, as a data URL
const _gl = new Map();
export function glyphURL(name, c = C.amber, opts = {}) {
  const k = `${name}|${hex(c)}|${opts.outline ?? 1}`;
  if (_gl.has(k)) return _gl.get(k);
  const p = new Pix(13, 13);
  glyph(name, c, { pix: p, x: 1, y: 1 });
  if (opts.outline !== 0) p.outline(C.ink);
  const u = p.url();
  _gl.set(k, u);
  return u;
}

// ------------------------------------------------------------------ small multi-colour HUD sprites
// heart (7x6), coin (7x7), drop / stomach / bolt are drawn procedurally where they are used.
export function heart(pix, x, y, full = true, beat = 0) {
  const rows = beat ? ['.##.##.', '#######', '#######', '#######', '.#####.', '..###..', '...#...'] : ['.##.##.', '#+#####', '#######', '.#####.', '..###..', '...#...'];
  const m = full ? { '#': C.red2, '+': C.red5 } : { '#': C.ink3, '+': C.ink4 };
  bitmap(rows, m, pix, x, y - (beat ? 1 : 0));
  if (full) { pix.set(x + 1, y + 1 - (beat ? 1 : 0), C.red5); pix.set(x + 4, y + 1 - (beat ? 1 : 0), C.red4); }
}
export function coin(pix, x, y, t = 0) {
  const w = [7, 5, 3, 1, 3, 5][Math.floor(t * 8) % 6] ?? 7; // spin
  const cx = x + 3.5;
  pix.ellipse(cx, y + 3.5, w / 2 + 0.01, 3.5, (u) => (u < -0.3 ? C.amber5 : u > 0.4 ? C.amber1 : C.amber));
  if (w >= 5) { pix.vline(Math.round(cx) - 0, y + 2, y + 4, C.amber1); pix.set(Math.round(cx) - 1, y + 1, C.amber5); }
}

// ------------------------------------------------------------------ frames (9-slice) for CSS border-image
// Each returns { url, slice } drawn at size s x s; the centre is a flat colour so `fill` stretches cleanly.
function framePanel(glass = C.amber1, fill = [16, 9, 3, 242]) {
  const s = 24, p = new Pix(s, s);
  p.rect(0, 0, s, s, C.ink);
  // steel bezel: lit top/left, dark bottom/right
  for (let i = 1; i < s - 1; i++) {
    p.set(i, 1, C.st4); p.set(1, i, C.st4);
    p.set(i, 2, C.st3); p.set(2, i, C.st3);
    p.set(i, s - 2, C.st1); p.set(s - 2, i, C.st1);
    p.set(i, s - 3, C.st2); p.set(s - 3, i, C.st2);
  }
  p.set(1, s - 2, C.st2); p.set(s - 2, 1, C.st2);
  p.rect(3, 3, s - 6, s - 6, C.ink);
  // amber phosphor rule inside the glass
  p.frame(5, 5, s - 10, s - 10, glass);
  p.rect(6, 6, s - 12, s - 12, fill);
  p.rect(4, 4, s - 8, 1, fill); p.rect(4, 4, 1, s - 8, fill);
  p.rect(4, s - 5, s - 8, 1, fill); p.rect(s - 5, 4, 1, s - 8, fill);
  // corner screws
  for (const [x, y] of [[2, 2], [s - 4, 2], [2, s - 4], [s - 4, s - 4]]) { p.rect(x, y, 2, 2, C.st5); p.set(x + 1, y + 1, C.st1); }
  // glass corner glints
  p.set(6, 6, mix(glass, C.white, 0.3)); p.set(7, 6, glass); p.set(6, 7, glass);
  return { url: p.url(), slice: 8 };
}
function frameButton(state) {
  const s = 12, p = new Pix(s, s);
  const face = state === 'hot' ? C.amber : state === 'down' ? C.amber2 : state === 'off' ? C.ink2 : C.ink3;
  const hi = state === 'hot' ? C.amber5 : state === 'down' ? C.amber1 : state === 'off' ? C.ink3 : C.ink4;
  const lo = state === 'hot' ? C.amber1 : state === 'down' ? C.amber4 : C.ink;
  p.rbox(0, 0, s, s, 1, C.ink);
  p.rect(1, 1, s - 2, s - 2, face);
  p.hline(2, s - 3, 1, hi); p.vline(1, 2, s - 3, hi);
  p.hline(2, s - 2, s - 2, lo); p.vline(s - 2, 2, s - 2, lo);
  if (state !== 'down') p.hline(1, s - 2, s - 2, state === 'hot' ? C.amber1 : C.ink);
  return { url: p.url(), slice: 3 };
}
function frameInset(col = C.amber1) {
  const s = 10, p = new Pix(s, s);
  p.rect(0, 0, s, s, C.ink);
  p.rect(1, 1, s - 2, s - 2, [8, 5, 2, 235]);
  p.hline(1, s - 2, 1, C.ink); p.vline(1, 1, s - 2, C.ink);
  p.hline(1, s - 2, s - 1, col); p.vline(s - 1, 1, s - 1, col);
  p.hline(0, s - 1, 0, mix(col, C.ink, 0.6)); p.vline(0, 0, s - 1, mix(col, C.ink, 0.6));
  return { url: p.url(), slice: 3 };
}
function frameBubble(main, fill) {
  const s = 14, p = new Pix(s, s);
  p.rbox(0, 0, s, s, 2, C.ink);
  p.rbox(1, 1, s - 2, s - 2, 2, main);
  p.rbox(2, 2, s - 4, s - 4, 1, fill);
  p.hline(3, s - 4, 2, mix(fill, main, 0.35));
  p.set(3, 3, mix(fill, main, 0.6));
  return { url: p.url(), slice: 4 };
}
function framePlate(edge = C.amber2) {
  const s = 10, p = new Pix(s, s);
  p.rbox(0, 0, s, s, 1, C.ink);
  p.rect(1, 1, s - 2, s - 2, [14, 9, 4, 225]);
  p.hline(2, s - 3, 1, edge); p.hline(2, s - 3, s - 2, mix(edge, C.ink, 0.55));
  p.vline(1, 2, s - 3, mix(edge, C.ink, 0.2)); p.vline(s - 2, 2, s - 3, mix(edge, C.ink, 0.55));
  return { url: p.url(), slice: 3 };
}
function frameTrack() {
  const s = 8, p = new Pix(s, s);
  p.rect(0, 0, s, s, C.ink);
  p.rect(1, 1, s - 2, s - 2, C.ink2);
  p.hline(1, s - 2, s - 2, C.ink4);
  return { url: p.url(), slice: 2 };
}
function knob() {
  const p = new Pix(10, 14);
  p.rbox(0, 0, 10, 14, 1, C.ink);
  p.vgrad(1, 1, 8, 12, RAMP.amber, { lo: 0.35, hi: 0.95, dither: false });
  p.hline(2, 7, 1, C.amber5);
  for (const y of [4, 6, 8]) { p.hline(3, 6, y, C.amber1); p.hline(3, 6, y + 1, C.amber4); }
  return p.url();
}
function selectArrow() {
  const p = new Pix(7, 5);
  bitmap(['#######', '.#####.', '..###..', '...#...'], { '#': C.amber }, p, 0, 0);
  return p.url();
}
// speech-bubble tail pointing left
function bubbleTail(main, fill) {
  const p = new Pix(7, 9);
  p.poly([[7, 0], [0, 4.5], [7, 9]], C.ink);
  p.poly([[7, 1.5], [2, 4.5], [7, 7.5]], main);
  p.poly([[7, 3], [4, 4.5], [7, 6]], fill);
  return p.url();
}
function scanTile() {
  const p = new Pix(2, 2);
  p.set(0, 1, [0, 0, 0, 60]); p.set(1, 1, [0, 0, 0, 60]);
  return p.url();
}

let _cssDone = false;
// register every frame as CSS custom properties on :root (call once at startup)
export function installPixelCSS() {
  if (_cssDone || typeof document === 'undefined') return;
  _cssDone = true;
  const F = {
    panel: framePanel(), wpanel: framePanel(C.green2, [2, 15, 5, 250]), btn: frameButton('idle'), 'btn-hot': frameButton('hot'), 'btn-down': frameButton('down'), 'btn-off': frameButton('off'),
    inset: frameInset(), 'inset-hot': frameInset(C.amber), bubble: frameBubble(C.green2, [3, 20, 10, 236]), 'bubble-alarm': frameBubble(C.red2, [26, 6, 4, 238]),
    plate: framePlate(), 'plate-green': framePlate(C.green2), 'plate-red': framePlate(C.red2), track: frameTrack(),
  };
  let s = ':root{';
  for (const [k, f] of Object.entries(F)) s += `--pa-${k}:url("${f.url}");--pa-${k}-s:${f.slice};`;
  s += `--pa-knob:url("${knob()}");--pa-arrow:url("${selectArrow()}");--pa-scan:url("${scanTile()}");--pa-tail:url("${bubbleTail(C.green2, [3, 20, 10, 236])}");--pa-tail-alarm:url("${bubbleTail(C.red2, [26, 6, 4, 238])}");`;
  for (const n of ['solo', 'host', 'join', 'gear', 'pad', 'back', 'play', 'door', 'ok', 'person', 'lock', 'arrowL', 'arrowR']) {
    s += `--pa-g-${n}:url("${glyphURL(n, C.amber)}");--pa-g-${n}-k:url("${glyphURL(n, C.ink2, { outline: 0 })}");`;
  }
  s += `--pa-g-bot-g:url("${glyphURL('bot', C.green)}");--pa-g-bot-r:url("${glyphURL('bot', C.red4)}");`;
  s += '}';
  const st = document.createElement('style');
  st.id = 'pixelart-css';
  st.textContent = s;
  document.head.appendChild(st);
}

// ------------------------------------------------------------------ the R.O.O.M. logo (bitmap font, extruded)
export function logoPix(str = 'R.O.O.M.', scale = 2) {
  const w = textWidth(str, FONT5, 1) * scale + 8, h = 7 * scale + 8;
  const p = new Pix(w, h);
  // extrusion
  for (let k = 3; k >= 1; k--) text(p, str, 2 + k, 2 + k, k === 1 ? C.amber1 : C.amber0, { scale });
  // face with a vertical ramp
  const face = new Pix(w, h);
  text(face, str, 2, 2, C.amber, { scale });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!face.a(x, y)) continue;
      const v = 1 - (y - 2) / (7 * scale);
      p.set(x, y, Pix.rampAt(RAMP.amber, 0.45 + v * 0.55, x, y, true));
    }
  }
  // top highlight row of each stroke
  for (let y = 1; y < h; y++) for (let x = 0; x < w; x++) if (face.a(x, y) && !face.a(x, y - 1)) p.set(x, y, C.amber5);
  p.outline(C.ink);
  return p;
}

// ------------------------------------------------------------------ touch-control caps
// Round keycaps and switch plates: ink outline, steel (or hazmat) bezel lit from the upper left,
// recessed phosphor-glass face, glowing glyph + tiny label, amber status LED, 1 px press travel.
export function capPix({ shape = 'round', d = 28, w = 30, h = 24, icon = null, iconPix = null, label = '', down = false, lit = null, glow = false, bezel = 'steel', danger = false } = {}) {
  const round = shape === 'round';
  const CW = round ? d : w, CH = round ? d : h;
  const p = new Pix(CW, CH + 2);
  const off = down ? 1 : 0;
  const ramp = bezel === 'hazmat' ? RAMP.hazmat : RAMP.steel;
  const faceA = danger ? C.red0 : C.green0, faceB = danger ? C.red1 : C.green1;
  const ink = danger ? C.red : C.green;
  // drop shadow (shrinks when pressed)
  if (round) p.ellipse(d / 2, d / 2 + 2, d / 2, d / 2 - (down ? 1 : 0), [0, 0, 0, 120]);
  else p.rbox(0, 2, w, h, 3, [0, 0, 0, 120]);
  const body = (fn) => {
    if (round) p.ellipse(d / 2, d / 2 + off, d / 2, d / 2, fn);
    else p.rbox(0, off, w, h, 3, fn(0, 0));
  };
  body(() => C.ink);
  // bezel
  if (round) {
    p.ellipse(d / 2, d / 2 + off, d / 2 - 1, d / 2 - 1, (u, v) => Pix.rampAt(ramp, 0.62 - (u + v) * 0.36, 0, 0, false));
    p.ring(d / 2, d / 2 + off, d / 2 - 2.6, C.ink, 1);
  } else {
    p.rbox(1, 1 + off, w - 2, h - 2, 2, ramp[3]);
    p.hline(3, w - 4, 1 + off, ramp[5]); p.vline(1, 3 + off, h - 4 + off, ramp[4]);
    p.hline(3, w - 4, h - 2 + off, ramp[1]); p.vline(w - 2, 3 + off, h - 4 + off, ramp[2]);
    p.rbox(2, 2 + off, w - 4, h - 4, 1, C.ink);
    // rivets
    for (const [x, y] of [[2, h / 2 - 1], [w - 3, h / 2 - 1]]) { p.set(x, y + off, ramp[5]); }
  }
  // face
  const fr = d / 2 - 3;
  const faceFn = (u, v, x, y) => {
    const r = Math.sqrt(u * u + v * v);
    if (down) return r < 0.55 ? (danger ? C.red4 : C.green4) : r < 0.85 ? ink : (danger ? C.red2 : C.green2);
    let c = r < 0.5 ? faceB : faceA;
    if ((y & 1) && r > 0.2) c = mix(c, C.ink, 0.35);
    return c;
  };
  if (round) p.ellipse(d / 2, d / 2 + off, fr, fr, faceFn);
  else {
    for (let y = 3; y < h - 3; y++) for (let x = 3; x < w - 3; x++) {
      const u = (x + 0.5 - w / 2) / (w / 2 - 3), v = (y + 0.5 - h / 2) / (h / 2 - 3);
      if ((x === 3 || x === w - 4) && (y === 3 || y === h - 4)) continue;
      p.set(x, y + off, faceFn(u * 0.8, v * 0.8, x, y));
    }
  }
  if (glow && !down) {
    if (round) p.ring(d / 2, d / 2 + off, fr, alpha(ink, 0.9), 1);
    else { p.hline(4, w - 5, 3 + off, alpha(ink, 0.8)); p.hline(4, w - 5, h - 4 + off, alpha(ink, 0.8)); }
  }
  // glass reflection
  if (round) { p.set(d / 2 - fr + 3, d / 2 - fr + 4 + off, alpha(C.white, 0.35)); p.set(d / 2 - fr + 4, d / 2 - fr + 3 + off, alpha(C.white, 0.35)); p.set(d / 2 - fr + 5, d / 2 - fr + 3 + off, alpha(C.white, 0.2)); }
  else { p.hline(4, 6, 4 + off, alpha(C.white, 0.28)); }
  // content
  const fg = down ? (danger ? C.red0 : C.green0) : ink;
  const sh = down ? alpha(C.white, 0.35) : (danger ? C.red0 : C.green0);
  if (iconPix) {
    const ix = Math.round((CW - iconPix.w) / 2), iy = Math.round((CH - iconPix.h) / 2) + off - (label ? 2 : 0);
    p.blit(iconPix, ix, iy);
    if (label) text(p, label, CW / 2, CH - 9 + off, down ? C.white : C.green4, { font: FONT3, align: 'center', outline: C.ink });
  } else {
    const ch = 11 + (label ? 6 : 0);
    const iy = Math.round((CH - ch) / 2) + off;
    if (icon) {
      const ix = Math.round((CW - 11) / 2);
      glyph(icon, sh, { pix: p, x: ix + 1, y: iy + 1, light: sh, shade: sh });
      glyph(icon, fg, { pix: p, x: ix, y: iy, light: down ? C.green1 : mix(ink, C.white, 0.5), shade: down ? C.green0 : mix(ink, C.ink, 0.4) });
    }
    if (label) text(p, label, CW / 2, iy + (icon ? 12 : 3), down ? (danger ? C.red0 : C.green0) : (danger ? C.red4 : C.green2), { font: FONT3, align: 'center' });
  }
  // status LED
  if (lit !== null) {
    const lx = round ? Math.round(d / 2 + (d / 2 - 2) * 0.68) - 1 : w - 6, ly = (round ? Math.round(d / 2 - (d / 2 - 2) * 0.68) - 1 : 3) + off;
    if (lit) {
      for (const [x, y] of [[-1, 0], [2, 0], [0, -1], [1, -1], [0, 2], [1, 2], [-1, 1], [2, 1]]) p.set(lx + x, ly + y, alpha(C.amber, 0.45));
      p.rect(lx, ly, 2, 2, C.amber); p.set(lx, ly, C.amber5);
    } else { p.rect(lx, ly, 2, 2, C.ink3); p.set(lx, ly, C.ink4); }
  }
  return p;
}

// floating analog stick: dial ring with ticks around dark glass, and a phosphor (or amber, sprinting) knob
export function stickBasePix(d = 56) {
  const p = new Pix(d, d);
  const c = d / 2;
  p.disc(c, c, c, C.ink);
  p.ellipse(c, c, c - 1, c - 1, (u, v) => Pix.rampAt(RAMP.steel, 0.6 - (u + v) * 0.32, 0, 0, false));
  p.ring(c, c, c - 3.5, C.ink, 1.2);
  p.ellipse(c, c, c - 4.5, c - 4.5, (u, v, x, y) => { const r = Math.hypot(u, v); let col = r < 0.45 ? C.green1 : C.green0; if (y & 1) col = mix(col, C.ink, 0.3); return col; });
  // ticks
  for (let k = 0; k < 16; k++) {
    const a = k / 16 * Math.PI * 2, r0 = c - 6, r1 = k % 4 === 0 ? c - 10 : c - 8;
    p.line(Math.round(c + Math.cos(a) * r0), Math.round(c + Math.sin(a) * r0), Math.round(c + Math.cos(a) * r1), Math.round(c + Math.sin(a) * r1), k % 4 === 0 ? C.green2 : C.green1);
  }
  p.ring(c, c, c * 0.42, C.green1, 1);
  p.hline(Math.round(c - 3), Math.round(c + 2), Math.round(c), C.green1); p.vline(Math.round(c), Math.round(c - 3), Math.round(c + 2), C.green1);
  // sprint arc at the top rim
  for (let k = -3; k <= 3; k++) { const a = -Math.PI / 2 + k * 0.12; p.set(Math.round(c + Math.cos(a) * (c - 2)), Math.round(c + Math.sin(a) * (c - 2)), C.amber2); }
  return p;
}
export function stickKnobPix(d = 24, sprint = false) {
  const p = new Pix(d + 2, d + 2);
  const c = d / 2;
  const R = sprint ? RAMP.amber : RAMP.green;
  p.ellipse(c + 1, c + 2, c, c, [0, 0, 0, 110]);
  p.disc(c, c, c, C.ink);
  p.ellipse(c, c, c - 1, c - 1, (u, v) => Pix.rampAt(R, 0.68 - (u + v) * 0.3 - (u * u + v * v) * 0.2, 0, 0, false));
  p.ring(c, c, c * 0.55, alpha(R[1], 0.8), 1);
  p.set(Math.round(c - c * 0.45), Math.round(c - c * 0.5), C.white); p.set(Math.round(c - c * 0.45) + 1, Math.round(c - c * 0.5), R[5]); p.set(Math.round(c - c * 0.45), Math.round(c - c * 0.5) + 1, R[5]);
  return p;
}
