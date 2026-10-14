// Still Lifes — procedural tileable detail textures (generated once, shared by every creature).
// Each RGBA8 data texture packs: R = albedo factor, G = height/mask, BA = tangent normal xy.
import * as THREE from 'three';
import { RNG, hash01, clamp, PI, TAU } from './core.js';

const cache = new Map();
const installed = new Map(); // name -> {data, w, h} precomputed off-thread
const once = (k, fn) => {
  if (!cache.has(k)) {
    const pre = installed.get(k);
    cache.set(k, pre ? dataTex(pre.data, pre.w, pre.h) : fn());
  }
  return cache.get(k);
};
export const TEX_NAMES = ['burlap', 'hazmat', 'fluff', 'grime'];
// raw RGBA data of a texture (for building in a worker and installing on the main thread)
export function textureData(name) {
  const t = { burlap: burlapTex, hazmat: hazmatTex, fluff: fluffTex, grime: grimeTex }[name]();
  return { name, data: t.image.data, w: t.image.width, h: t.image.height };
}
export function installTextureData(d) { if (!cache.has(d.name)) installed.set(d.name, d); }
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// tileable fbm over a W x H texture: `period` lattice cells per tile at the first octave
export function fbmField(W, H, period, oct, seed, out = new Float32Array(W * H)) {
  out.fill(0);
  let amp = 0.5, norm = 0;
  for (let o = 0; o < oct; o++) {
    const P = period << o;
    const lat = new Float32Array(P * P);
    for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) lat[j * P + i] = hash01(i, j, o, seed);
    const fx = new Float32Array(W), ix = new Int32Array(W);
    for (let x = 0; x < W; x++) { const u = (x / W) * P; const i0 = Math.floor(u); ix[x] = i0 % P; fx[x] = fade(u - i0); }
    for (let y = 0; y < H; y++) {
      const v = (y / H) * P, j0 = Math.floor(v), fy = fade(v - j0);
      const r0 = (j0 % P) * P, r1 = ((j0 + 1) % P) * P;
      for (let x = 0; x < W; x++) {
        const i0 = ix[x], i1 = (i0 + 1) % P, f = fx[x];
        const a = lat[r0 + i0] + (lat[r0 + i1] - lat[r0 + i0]) * f;
        const b = lat[r1 + i0] + (lat[r1 + i1] - lat[r1 + i0]) * f;
        out[y * W + x] += (a + (b - a) * fy) * amp;
      }
    }
    norm += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function finish(W, H, alb, hgt, nStrength, extraG = null) {
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const yu = ((y - 1 + H) % H) * W, yd = ((y + 1) % H) * W, yr = y * W;
    for (let x = 0; x < W; x++) {
      const i = yr + x;
      const xl = (x - 1 + W) % W, xr = (x + 1) % W;
      const dx = (hgt[yr + xr] - hgt[yr + xl]) * nStrength, dy = (hgt[yd + x] - hgt[yu + x]) * nStrength;
      const l = Math.sqrt(dx * dx + dy * dy + 1);
      data[i * 4] = clamp(alb[i] * 255, 0, 255);
      data[i * 4 + 1] = clamp((extraG ? extraG[i] : hgt[i]) * 255, 0, 255);
      data[i * 4 + 2] = (-dx / l * 0.5 + 0.5) * 255;
      data[i * 4 + 3] = (-dy / l * 0.5 + 0.5) * 255;
    }
  }
  return dataTex(data, W, H);
}
function dataTex(data, W, H) {
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// soft line into a wrapping height field (max blend) and albedo (lerp)
function stroke(hgt, alb, W, H, x0, y0, x1, y1, w, hv, av) {
  const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(2, Math.ceil(len));
  const r = Math.ceil(w + 1);
  for (let s = 0; s <= n; s++) {
    const t = s / n, cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t;
    const fx = Math.floor(cx), fy = Math.floor(cy), ox = cx - fx, oy = cy - fy;
    for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) {
      const dx = xx - ox, dy = yy - oy, d2 = (dx * dx + dy * dy) / (w * w);
      if (d2 > 1) continue;
      const px = (fx + xx + W) % W, py = (fy + yy + H) % H;
      const i = py * W + px, f = 1 - d2;
      const hh = hv * f;
      if (hgt[i] < hh) hgt[i] = hh;
      if (alb) alb[i] += (av - alb[i]) * f * 0.6;
    }
  }
}

// --- burlap / hessian plain weave: 14 coarse jute threads per tile, irregular, slubs, hairy fibres
export const burlapTex = () => once('burlap', () => {
  const W = 256, H = 256, N = 14, P = W / N;
  const alb = new Float32Array(W * H), hgt = new Float32Array(W * H);
  const r = new RNG(77);
  const thr = () => Array.from({ length: N }, () => ({ a: r.range(0.8, 2.4), p: r.next() * TAU, f: r.int(1, 3), t: r.range(0.58, 0.86), c: r.range(-0.12, 0.12) }));
  const warp = thr(), weft = thr();
  const slubV = fbmField(256, N, 10, 3, 5), slubH = fbmField(256, N, 10, 3, 6);
  const fib = fbmField(W, H, 40, 2, 9), blot = fbmField(W, H, 3, 3, 12);
  const wobV = new Float32Array(N * H), wobH = new Float32Array(N * W);
  for (let i = 0; i < N; i++) for (let y = 0; y < H; y++) wobV[i * H + y] = Math.sin(y / H * TAU * warp[i].f + warp[i].p) * warp[i].a + (slubV[i * 256 + y] - 0.5) * 2.2;
  for (let j = 0; j < N; j++) for (let x = 0; x < W; x++) wobH[j * W + x] = Math.sin(x / W * TAU * weft[j].f + weft[j].p) * weft[j].a + (slubH[j * 256 + x] - 0.5) * 2.2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i0 = Math.floor(x / P), j0 = Math.floor(y / P);
    let best = 0, bestA = 0.45;
    for (let di = -1; di <= 1; di++) {
      const i = (i0 + di + N) % N, cxw = (i0 + di + 0.5) * P + wobV[i * H + y];
      const hw = P * 0.5 * warp[i].t * (0.75 + 0.5 * slubV[i * 256 + ((y * 3) & 255)]);
      const u = Math.abs(x - cxw) / hw;
      if (u < 1) {
        const over = ((i + j0) & 1) === 0, v = (y % P) / P;
        const bend = over ? 0.6 + 0.4 * Math.sin(v * PI) : 0.42 + 0.25 * Math.sin(v * PI);
        const hh = Math.sqrt(1 - u * u) * bend;
        if (hh > best) { best = hh; bestA = 0.8 + warp[i].c + (fib[y * W + x] - 0.5) * 0.35 + (1 - u) * 0.06; }
      }
    }
    for (let dj = -1; dj <= 1; dj++) {
      const j = (j0 + dj + N) % N, cyw = (j0 + dj + 0.5) * P + wobH[j * W + x];
      const hw = P * 0.5 * weft[j].t * (0.75 + 0.5 * slubH[j * 256 + ((x * 3) & 255)]);
      const u = Math.abs(y - cyw) / hw;
      if (u < 1) {
        const over = ((i0 + j) & 1) === 1, v = (x % P) / P;
        const bend = over ? 0.6 + 0.4 * Math.sin(v * PI) : 0.42 + 0.25 * Math.sin(v * PI);
        const hh = Math.sqrt(1 - u * u) * bend;
        if (hh > best) { best = hh; bestA = 0.78 + weft[j].c + (fib[x * W + y] - 0.5) * 0.35 + (1 - u) * 0.06; }
      }
    }
    const i = y * W + x;
    hgt[i] = best;
    alb[i] = (best > 0.02 ? bestA * (0.86 + best * 0.18) : 0.42) * (0.9 + blot[i] * 0.2) + (hash01(x, y, 0, 21) - 0.5) * 0.08;
  }
  // hairy fibres over everything
  for (let k = 0; k < 900; k++) {
    let x = r.next() * W, y = r.next() * H, a = r.next() * TAU;
    const l = 5 + r.next() * 18;
    for (let s2 = 0; s2 < 2; s2++) {
      const nx = x + Math.cos(a) * l / 2, ny = y + Math.sin(a) * l / 2;
      stroke(hgt, alb, W, H, x, y, nx, ny, 0.45 + r.next() * 0.4, 0.55 + r.next() * 0.45, 0.8 + r.next() * 0.25);
      x = nx; y = ny; a += r.range(-0.7, 0.7);
    }
  }
  return finish(W, H, alb, hgt, 2.2);
});

// --- hazmat coated fabric: soft wrinkles + sharp crinkle creases (no networks); G = crease mask
export const hazmatTex = () => once('hazmat', () => {
  const W = 256, H = 256;
  const soft = fbmField(W, H, 3, 4, 41), mid = fbmField(W, H, 7, 3, 42), fine = fbmField(W, H, 48, 2, 44);
  const crease = new Float32Array(W * H);
  const r = new RNG(43);
  for (let k = 0; k < 34; k++) {
    let x = r.next() * W, y = r.next() * H, a = r.next() * TAU;
    const segs = 1 + r.int(0, 2), d = r.range(0.15, 0.5);
    for (let s2 = 0; s2 < segs; s2++) {
      const l = r.range(6, 22);
      const nx = x + Math.cos(a) * l, ny = y + Math.sin(a) * l;
      stroke(crease, null, W, H, x, y, nx, ny, r.range(1.0, 2.2), d * (1 - s2 / (segs + 1) * 0.5), 0);
      x = nx; y = ny; a += r.range(-0.9, 0.9);
    }
  }
  const alb = new Float32Array(W * H), hgt = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const c = crease[i];
    hgt[i] = soft[i] * 0.8 + mid[i] * 0.35 + fine[i] * 0.03 - c * 0.12;
    alb[i] = 0.95 + (mid[i] - 0.5) * 0.1 - c * 0.04;
  }
  return finish(W, H, alb, hgt, 2.4, crease);
});

// --- felt / stuffing fibres
export const fluffTex = () => once('fluff', () => {
  const W = 256, H = 256;
  const base = fbmField(W, H, 8, 3, 51);
  const alb = new Float32Array(W * H), hgt = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) { hgt[i] = base[i] * 0.4; alb[i] = 0.7 + hgt[i] * 0.4; }
  const r = new RNG(5);
  for (let k = 0; k < 1500; k++) {
    let x = r.next() * W, y = r.next() * H, a = r.next() * TAU;
    const l = 6 + r.next() * 18;
    for (let s = 0; s < 3; s++) {
      const nx = x + Math.cos(a) * l / 3, ny = y + Math.sin(a) * l / 3;
      stroke(hgt, alb, W, H, x, y, nx, ny, 0.55 + r.next() * 0.5, 0.45 + r.next() * 0.55, 0.8 + r.next() * 0.2);
      x = nx; y = ny; a += r.range(-0.6, 0.6);
    }
  }
  return finish(W, H, alb, hgt, 2.0);
});

// --- large-scale grime/stain noise: R low fbm, G mid fbm, B fine grain, A blotchy stains
export const grimeTex = () => once('grime', () => {
  const W = 256, H = 256;
  const a = fbmField(W, H, 4, 5, 61), b = fbmField(W, H, 12, 3, 62), c = fbmField(W, H, 64, 1, 64), s = fbmField(W, H, 6, 4, 65);
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    data[i * 4] = a[i] * 255; data[i * 4 + 1] = b[i] * 255; data[i * 4 + 2] = (hash01(x, y, 0, 63) * 0.6 + c[i] * 0.4) * 255; data[i * 4 + 3] = clamp((s[i] - 0.52) * 5, 0, 1) * 255;
  }
  return dataTex(data, W, H);
});
