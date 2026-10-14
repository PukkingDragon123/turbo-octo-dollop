// Seeded 2D simplex noise + fbm helpers for the Grasslands world generator (pure JS, no allocations
// in the hot path). Every peer builds identical fields from the level seed.
import { RNG } from '../../../core/rng.js';

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GX = new Float32Array([1, -1, 1, -1, 1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071]);
const GY = new Float32Array([1, 1, -1, -1, 0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071]);

export class Noise2 {
  constructor(seed) {
    const rng = new RNG(seed >>> 0 || 1);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    this.perm = new Uint8Array(512);
    this.pmod = new Uint8Array(512);
    for (let i = 0; i < 512; i++) { this.perm[i] = p[i & 255]; this.pmod[i] = this.perm[i] % 12; }
  }

  // simplex noise in [-1, 1]
  n(xin, yin) {
    const perm = this.perm, pm = this.pmod;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n0 = 0, n1 = 0, n2 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = pm[ii + perm[jj]]; t0 *= t0; n0 = t0 * t0 * (GX[g] * x0 + GY[g] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = pm[ii + i1 + perm[jj + j1]]; t1 *= t1; n1 = t1 * t1 * (GX[g] * x1 + GY[g] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = pm[ii + 1 + perm[jj + 1]]; t2 *= t2; n2 = t2 * t2 * (GX[g] * x2 + GY[g] * y2); }
    return 70 * (n0 + n1 + n2);
  }

  // fractal sum in roughly [-1, 1]
  fbm(x, y, oct = 4, lac = 2.03, gain = 0.5) {
    let a = 1, s = 0, norm = 0;
    for (let k = 0; k < oct; k++) {
      s += a * this.n(x, y);
      norm += a;
      a *= gain;
      x = x * lac + 13.7;
      y = y * lac - 7.3;
    }
    return s / norm;
  }

  // ridged multifractal in [0, 1]
  ridged(x, y, oct = 4, lac = 2.1, gain = 0.5) {
    let a = 1, s = 0, norm = 0;
    for (let k = 0; k < oct; k++) {
      const v = 1 - Math.abs(this.n(x, y));
      s += a * v * v;
      norm += a;
      a *= gain;
      x = x * lac + 5.1;
      y = y * lac + 9.7;
    }
    return s / norm;
  }
}

export function sstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
export function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
export function mix(a, b, t) { return a + (b - a) * t; }
