// Seeded randomness + noise helpers shared by world generation, textures and effects.

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Integer hash of up to 3 ints + seed -> uint32
export function hash3(x, y, z, seed = 0) {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h ^ (y | 0), 0xc2b2ae35);
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h ^ (z | 0), 0x27d4eb2f);
  h = (h ^ (h >>> 15)) >>> 0;
  return h >>> 0;
}

export function hash01(x, y = 0, z = 0, seed = 0) {
  return hash3(x, y, z, seed) / 4294967296;
}

// Mulberry32 PRNG
export class RNG {
  constructor(seed = 1) {
    this.s = (seed >>> 0) || 1;
  }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  weighted(entries) {
    // entries: [[value, weight], ...]
    let total = 0;
    for (const e of entries) total += e[1];
    let r = this.next() * total;
    for (const e of entries) {
      r -= e[1];
      if (r <= 0) return e[0];
    }
    return entries[entries.length - 1][0];
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

// --- Value noise / fbm (2D & 3D) ---
function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a, b, t) { return a + (b - a) * t; }

export function valueNoise2(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = fade(xf), v = fade(yf);
  const a = hash01(xi, yi, 0, seed), b = hash01(xi + 1, yi, 0, seed);
  const c = hash01(xi, yi + 1, 0, seed), d = hash01(xi + 1, yi + 1, 0, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

// Tileable value noise (period px, py in lattice units)
export function tileNoise2(x, y, px, py, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = fade(xf), v = fade(yf);
  const m = (n, p) => ((n % p) + p) % p;
  const x0 = m(xi, px), x1 = m(xi + 1, px), y0 = m(yi, py), y1 = m(yi + 1, py);
  const a = hash01(x0, y0, 0, seed), b = hash01(x1, y0, 0, seed);
  const c = hash01(x0, y1, 0, seed), d = hash01(x1, y1, 0, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

export function tileFbm(x, y, px, py, octaves = 4, seed = 0) {
  let amp = 0.5, sum = 0, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * tileNoise2(x * f, y * f, px * f, py * f, seed + i * 31);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

export function fbm2(x, y, octaves = 4, seed = 0) {
  let amp = 0.5, sum = 0, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(x * f, y * f, seed + i * 31);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}
export { lerp };
