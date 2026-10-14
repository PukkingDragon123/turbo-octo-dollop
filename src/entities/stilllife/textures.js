// Still Lifes — procedural tileable detail textures (generated once, shared by every creature).
// Each RGBA8 data texture packs: R = albedo factor, G = height/mask, BA = tangent normal xy.
import * as THREE from 'three';
import { RNG, tfbm2, tnoise2, hash01, clamp, PI, TAU } from './core.js';

const cache = new Map();
const once = (k, fn) => { if (!cache.has(k)) cache.set(k, fn()); return cache.get(k); };

function finish(W, H, alb, hgt, nStrength, extraG = null) {
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const xl = (x - 1 + W) % W, xr = (x + 1) % W, yu = (y - 1 + H) % H, yd = (y + 1) % H;
    const dx = (hgt[y * W + xr] - hgt[y * W + xl]) * nStrength, dy = (hgt[yd * W + x] - hgt[yu * W + x]) * nStrength;
    const l = Math.hypot(dx, dy, 1);
    data[i * 4] = clamp(alb[i] * 255, 0, 255);
    data[i * 4 + 1] = clamp((extraG ? extraG[i] : hgt[i]) * 255, 0, 255);
    data[i * 4 + 2] = clamp((-dx / l * 0.5 + 0.5) * 255, 0, 255);
    data[i * 4 + 3] = clamp((-dy / l * 0.5 + 0.5) * 255, 0, 255);
  }
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

// stroke rasteriser into a float height field (wrapping): adds a soft line
function stroke(hgt, alb, W, H, x0, y0, x1, y1, w, hv, av) {
  const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(2, Math.ceil(len));
  for (let s = 0; s <= n; s++) {
    const t = s / n, cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t;
    const r = Math.ceil(w + 1);
    for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) {
      const d = Math.hypot(xx + (cx % 1), yy + (cy % 1)) / w;
      if (d > 1) continue;
      const px = ((Math.floor(cx) + xx) % W + W) % W, py = ((Math.floor(cy) + yy) % H + H) % H;
      const i = py * W + px, f = 1 - d * d;
      if (hgt[i] < hv * f + 0.0) hgt[i] = Math.max(hgt[i], hv * f);
      if (alb) alb[i] = alb[i] + (av - alb[i]) * f * 0.6;
    }
  }
}

// --- burlap / hessian plain weave: 16 threads per tile, slubs, gaps, stray fibres
export const burlapTex = () => once('burlap', () => {
  const W = 256, H = 256, N = 16, P = W / N;
  const alb = new Float32Array(W * H), hgt = new Float32Array(W * H);
  const r = new RNG(77);
  const wob = Array.from({ length: N }, (_, i) => ({ a: r.range(0.5, 1.6), p: r.next() * TAU, t: r.range(0.62, 0.84) }));
  const wef = Array.from({ length: N }, (_, i) => ({ a: r.range(0.5, 1.6), p: r.next() * TAU, t: r.range(0.62, 0.84) }));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    // warp (vertical threads) wander a little in x; weft (horizontal) in y
    const i0 = Math.floor(x / P), j0 = Math.floor(y / P);
    let best = 0, bestA = 0.2;
    for (let di = -1; di <= 1; di++) {
      const i = (i0 + di + N) % N, cxw = (i0 + di + 0.5) * P + Math.sin(y / H * TAU * 2 + wob[i].p) * wob[i].a;
      const slub = 0.85 + 0.3 * tnoise2(i * 3.7, y / H * 12, 64, 12, 5);
      const hw = P * 0.5 * wob[i].t * slub;
      const u = Math.abs(x - cxw) / hw;
      if (u < 1) {
        const over = ((i + j0) & 1) === 0;
        const v = (y % P) / P;
        const bend = over ? 0.55 + 0.45 * Math.sin(v * PI) : 0.35 + 0.25 * Math.sin(v * PI);
        const hh = Math.sqrt(1 - u * u) * bend;
        if (hh > best) { best = hh; bestA = 0.72 + hash01(i, 0, 0, 3) * 0.2 + (tnoise2(x / 3, y / 12, 256 / 3, 256 / 12, 9) - 0.5) * 0.25; }
      }
    }
    for (let dj = -1; dj <= 1; dj++) {
      const j = (j0 + dj + N) % N, cyw = (j0 + dj + 0.5) * P + Math.sin(x / W * TAU * 2 + wef[j].p) * wef[j].a;
      const slub = 0.85 + 0.3 * tnoise2(x / W * 12, j * 3.7, 12, 64, 6);
      const hw = P * 0.5 * wef[j].t * slub;
      const u = Math.abs(y - cyw) / hw;
      if (u < 1) {
        const over = ((i0 + j) & 1) === 1;
        const v = (x % P) / P;
        const bend = over ? 0.55 + 0.45 * Math.sin(v * PI) : 0.35 + 0.25 * Math.sin(v * PI);
        const hh = Math.sqrt(1 - u * u) * bend;
        if (hh > best) { best = hh; bestA = 0.7 + hash01(j, 1, 0, 4) * 0.22 + (tnoise2(x / 12, y / 3, 256 / 12, 256 / 3, 10) - 0.5) * 0.25; }
      }
    }
    // twisted-fibre striation along the threads
    const str = (hash01(x, y, 0, 21) - 0.5) * 0.12;
    const i = y * W + x;
    hgt[i] = best;
    alb[i] = best > 0 ? bestA * (0.82 + best * 0.25) + str : 0.12;
  }
  // stray fibres on top
  for (let k = 0; k < 520; k++) {
    const x = r.next() * W, y = r.next() * H, a = r.next() * TAU, l = 4 + r.next() * 14;
    stroke(hgt, alb, W, H, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.6 + r.next() * 0.5, 0.75 + r.next() * 0.3, 0.85 + r.next() * 0.15);
  }
  return finish(W, H, alb, hgt, 2.4);
});

// --- hazmat coated fabric: soft crinkles + fine ripstop grid; G = crease mask (for grime)
export const hazmatTex = () => once('hazmat', () => {
  const W = 256, H = 256;
  const alb = new Float32Array(W * H), hgt = new Float32Array(W * H), crease = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;
    const f1 = tfbm2(u * 4, v * 4, 4, 4, 4, 41);
    const f2 = tfbm2(u * 9 + 3, v * 9, 9, 9, 3, 42);
    // crinkle creases: thin valleys of a warped field
    const c1 = 1 - Math.abs(Math.sin((u * 3 + f1 * 2.2) * PI * 2) * 1.0);
    const c2 = 1 - Math.abs(Math.sin((v * 4 + f2 * 1.8 + u) * PI * 2));
    const cr = Math.pow(c1, 10) + Math.pow(c2, 14) * 0.7;
    const grid = ((x % 16 === 0) || (y % 16 === 0)) ? 0.25 : 0;
    const fine = hash01(x, y, 0, 43) * 0.05;
    const i = y * W + x;
    hgt[i] = f1 * 0.7 + f2 * 0.25 - cr * 0.22 + grid * 0.05 + fine;
    crease[i] = clamp(cr * 1.2, 0, 1);
    alb[i] = 0.92 + (f2 - 0.5) * 0.12 - cr * 0.08 - grid * 0.08 + fine;
  }
  return finish(W, H, alb, hgt, 3.2, crease);
});

// --- felt / stuffing fibres
export const fluffTex = () => once('fluff', () => {
  const W = 256, H = 256;
  const alb = new Float32Array(W * H).fill(0.78), hgt = new Float32Array(W * H);
  const r = new RNG(5);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; hgt[i] = tfbm2(x / W * 8, y / H * 8, 8, 8, 3, 51) * 0.4; alb[i] = 0.7 + hgt[i] * 0.4; }
  for (let k = 0; k < 2600; k++) {
    let x = r.next() * W, y = r.next() * H, a = r.next() * TAU;
    const l = 6 + r.next() * 18, seg = 3;
    for (let s = 0; s < seg; s++) {
      const nx = x + Math.cos(a) * l / seg, ny = y + Math.sin(a) * l / seg;
      stroke(hgt, alb, W, H, x, y, nx, ny, 0.55 + r.next() * 0.5, 0.45 + r.next() * 0.55, 0.8 + r.next() * 0.2);
      x = nx; y = ny; a += r.range(-0.6, 0.6);
    }
  }
  return finish(W, H, alb, hgt, 2.0);
});

// --- large-scale grime/stain noise: R low fbm, G mid fbm, B fine grain, A blotchy stains
export const grimeTex = () => once('grime', () => {
  const W = 256, H = 256;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H, i = (y * W + x) * 4;
    const a = tfbm2(u * 4, v * 4, 4, 4, 5, 61);
    const b = tfbm2(u * 12, v * 12, 12, 12, 4, 62);
    const c = hash01(x, y, 0, 63) * 0.6 + tnoise2(u * 64, v * 64, 64, 64, 64) * 0.4;
    const s = tfbm2(u * 6 + 2, v * 6, 6, 6, 5, 64);
    const blot = clamp((s - 0.52) * 5, 0, 1);
    data[i] = a * 255; data[i + 1] = b * 255; data[i + 2] = c * 255; data[i + 3] = blot * 255;
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
});
