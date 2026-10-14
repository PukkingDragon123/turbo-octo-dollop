// Still Lifes — shared math, seeded randomness and fast 3D noise (self-contained: no game imports).
export const PI = Math.PI, TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const smooth01 = (t) => { t = sat(t); return t * t * (3 - 2 * t); };
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

// Mulberry32
export class RNG {
  constructor(seed = 1) { this.s = (seed >>> 0) || 1; }
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
  sign() { return this.next() < 0.5 ? -1 : 1; }
}

export function hash3(x, y, z, seed = 0) {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b); h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h ^ (y | 0), 0xc2b2ae35); h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h ^ (z | 0), 0x27d4eb2f); h = (h ^ (h >>> 15)) >>> 0;
  return h >>> 0;
}
export const hash01 = (x, y = 0, z = 0, s = 0) => hash3(x, y, z, s) / 4294967296;

// ---------------------------------------------------------------------------
// 3D value noise on a 256-periodic lattice (permutation table): ~0..1, smooth (quintic)
const PERM = new Uint8Array(512);
const VAL = new Float32Array(256);
{
  const r = new RNG(1337);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  for (let i = 0; i < 256; i++) VAL[i] = r.next();
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export function noise3(x, y, z) {
  const xf = Math.floor(x), yf = Math.floor(y), zf = Math.floor(z);
  const X = xf & 255, Y = yf & 255, Z = zf & 255;
  const u = fade(x - xf), v = fade(y - yf), w = fade(z - zf);
  const A = PERM[X] + Y, AA = PERM[A] + Z, AB = PERM[A + 1] + Z;
  const B = PERM[X + 1] + Y, BA = PERM[B] + Z, BB = PERM[B + 1] + Z;
  const x00 = VAL[PERM[AA]] + (VAL[PERM[BA]] - VAL[PERM[AA]]) * u;
  const x10 = VAL[PERM[AB]] + (VAL[PERM[BB]] - VAL[PERM[AB]]) * u;
  const x01 = VAL[PERM[AA + 1]] + (VAL[PERM[BA + 1]] - VAL[PERM[AA + 1]]) * u;
  const x11 = VAL[PERM[AB + 1]] + (VAL[PERM[BB + 1]] - VAL[PERM[AB + 1]]) * u;
  const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}
export function fbm3(x, y, z, oct = 3) {
  let a = 0.5, s = 0, n = 0, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise3(x * f + i * 17.3, y * f - i * 9.1, z * f + i * 5.7); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
// ridged: 0 at creases, 1 on top
export const ridge3 = (x, y, z) => 1 - Math.abs(noise3(x, y, z) * 2 - 1);

// 2D tileable value noise for texture generation (period in lattice units)
export function tnoise2(x, y, px, py, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = fade(x - xi), v = fade(y - yi);
  const m = (n, p) => ((n % p) + p) % p;
  const x0 = m(xi, px), x1 = m(xi + 1, px), y0 = m(yi, py), y1 = m(yi + 1, py);
  const a = hash01(x0, y0, 0, seed), b = hash01(x1, y0, 0, seed), c = hash01(x0, y1, 0, seed), d = hash01(x1, y1, 0, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function tfbm2(x, y, px, py, oct = 4, seed = 0) {
  let a = 0.5, s = 0, n = 0, f = 1;
  for (let i = 0; i < oct; i++) { s += a * tnoise2(x * f, y * f, px * f, py * f, seed + i * 31); n += a; a *= 0.5; f *= 2; }
  return s / n;
}

// sRGB hex -> linear [r,g,b]
export function lin(hex) {
  const c = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return [c((hex >> 16) & 255), c((hex >> 8) & 255), c(hex & 255)];
}
export const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Palette (sRGB hex), consistent with the player dolls but filthier
export const PAL = {
  burlap: 0x977a52, burlapDark: 0x6e573c, burlapPale: 0xaa8f64, burlapRot: 0x55432c,
  suit: 0xcf9f14, suitFaded: 0xbda55c, suitDirty: 0x8f7a2c, suitStain: 0x6a4a1c,
  rubber: 0x1b1a19, rubberWorn: 0x3a3733,
  tape: 0x8d8d88, tapeDirty: 0x6c6a62,
  nose: 0xd2302b, noseDirty: 0xa3271f,
  stuffing: 0xe4dccb, stuffingOld: 0xc9b98f, stuffingStain: 0x8a6440,
  inner: 0x150d09, rust: 0x6b3518, grime: 0x3a2d20, thread: 0x2e1c12, eye: 0x09090b,
};
