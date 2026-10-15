// Level 0 wetness field: where the floor is damp / soaked / under standing water, as a smooth potential that the
// baked floor shader breaks up into organic puddles (noise threshold, damp halo, tide ring, drip ripples).
// Sources (deterministic per cell, identical on every peer and across chunk borders):
//   - puddles right under water-logged (sagging) or missing ceiling tiles: the leak drips into them
//   - low spots: a puddle or two in the randomly "wet" cells
//   - seepage along the foot of solid walls in damp sectors (dark, flooded, maintenance, low rooms)
//   - flooded sectors: soaked everywhere, with soft noisy shores around the standing water
// Water surfaces in flooded sectors sink below the carpet along a noisy contour next to dry cells (waterY), so the
// shoreline is a curve instead of a cell edge.
import { CELL, W } from '../levels/yellow/layout.js';
import { hash01, valueNoise2 } from '../../core/rng.js';
import { leakSpots } from './ceiling.js';

const DAMP_ZONES = new Set(['dark', 'flooded', 'maintenance', 'lowrooms']);

// blobs {x, z, r, a} and wall seeps {x0, z0, x1, z1, r, a} of one cell
function cellSources(c, seed, info, wallN, wallW) {
  const out = [];
  if (c.landmark && c.landmark !== 'apron') return out; // the camp and the pad hall are kept dry
  if (c.special?.pit || c.roomStyle === 'pool' || c.water) return out;
  const x0 = c.i * CELL, z0 = c.j * CELL;
  const h = (k) => hash01(c.i, c.j, 150 + k, seed);
  if (c.wet > 0) {
    const n = h(0) < 0.45 ? 2 : 1;
    for (let k = 0; k < n; k++) out.push({ x: x0 + 0.55 + h(1 + k) * 1.9, z: z0 + 0.55 + h(3 + k) * 1.9, r: 0.8 + h(5 + k) * 0.75, a: 0.7 + c.wet * 0.45 });
  }
  if (c.ceil < 3) {
    for (const s of leakSpots(c, seed)) {
      const hh = hash01(Math.floor(s.x * 10), Math.floor(s.z * 10), 157, seed);
      if (!s.sag && hh > 0.5) continue;
      out.push({ x: s.x + (hh - 0.5) * 0.25, z: s.z + (h(7) - 0.5) * 0.25, r: 0.5 + hh * 0.55, a: s.sag ? 1.0 : 0.75, leak: true });
    }
  }
  if (DAMP_ZONES.has(c.zone) && h(8) < 0.24) {
    const tN = wallN(c.i, c.j), tW = wallW(c.i, c.j);
    const t = 0.12, a = 0.3 + h(9) * 0.6, b = a + 1.0 + h(10) * 1.2;
    if (tN === W.FULL && h(11) < 0.6) out.push({ x0: x0 + a, z0: z0 + t, x1: x0 + Math.min(2.9, b), z1: z0 + t, r: 0.45 + h(12) * 0.3, a: 0.85 });
    else if (tW === W.FULL) out.push({ x0: x0 + t, z0: z0 + a, x1: x0 + t, z1: z0 + Math.min(2.9, b), r: 0.45 + h(12) * 0.3, a: 0.85 });
  }
  return out;
}

function segDist(x, z, s) {
  const dx = s.x1 - s.x0, dz = s.z1 - s.z0, l2 = dx * dx + dz * dz || 1e-6;
  const t = Math.max(0, Math.min(1, ((x - s.x0) * dx + (z - s.z0) * dz) / l2));
  return Math.hypot(x - (s.x0 + dx * t), z - (s.z0 + dz * t));
}

// soaked-ness of a flooded-sector cell (standing water 1, dry ground of the sector 0.65)
const floodOf = (c) => (c.zone === 'flooded' && c.roomStyle !== 'pool' && !c.special?.pit ? (c.water ? 1 : 0.65) : 0);

export class WetField {
  // info(i, j) -> cell; wallN / wallW (i, j) -> wall type
  constructor(seed, info, wallN, wallW) {
    this.seed = seed; this.info = info; this.wallN = wallN; this.wallW = wallW;
    this.cache = new Map();
    this.near = new Map();
  }
  // per cell: { src: sources, flood, water }
  entry(i, j) {
    const k = (i + 32768) * 65536 + (j + 32768);
    let e = this.cache.get(k);
    if (!e) {
      const c = this.info(i, j);
      e = { src: cellSources(c, this.seed, this.info, this.wallN, this.wallW), flood: floodOf(c), water: !!c.water };
      this.cache.set(k, e);
    }
    return e;
  }
  sources(i, j) { return this.entry(i, j).src; }
  // does anything wet reach into cell (i, j)?
  touches(i, j) {
    const k = (i + 32768) * 65536 + (j + 32768);
    let t = this.near.get(k);
    if (t === undefined) {
      t = false;
      for (let dj = -1; dj <= 1 && !t; dj++) for (let di = -1; di <= 1; di++) {
        const e = this.entry(i + di, j + dj);
        if (e.src.length || e.flood > 0) { t = true; break; }
      }
      this.near.set(k, t);
    }
    return t;
  }
  // does the floor of cell (i, j) need fine detail? (not under open water: only shores and damp ground)
  detail(i, j) {
    if (!this.touches(i, j)) return false;
    if (!this.entry(i, j).water) return true;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (!this.entry(i + di, j + dj).water) return true;
    return false;
  }
  // wetness potential at a floor point (0 dry .. ~1 standing water)
  at(x, z) {
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
    if (!this.touches(i, j)) return 0;
    let p = 0;
    const own = this.entry(i, j);
    let f = own.flood, nf = null;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const e = this.entry(i + di, j + dj);
      for (const s of e.src) {
        const d = s.x0 !== undefined ? segDist(x, z, s) : Math.hypot(x - s.x, z - s.z);
        if (d >= s.r) continue;
        const q = 1 - (d / s.r) ** 2;
        p = 1 - (1 - p) * (1 - s.a * q * q);
      }
      // flooded sectors: the sector's wetness, feathered over ~1.2 m into neighbouring cells with a noisy edge
      if ((di || dj) && e.flood > f) {
        if (nf === null) nf = (valueNoise2(x * 0.9 + 13.1, z * 0.9 - 7.7, 909) - 0.5) * 0.7;
        const ax = (i + di) * CELL, az = (j + dj) * CELL;
        const ddx = Math.max(ax - x, 0, x - (ax + CELL)), ddz = Math.max(az - z, 0, z - (az + CELL));
        const d = Math.hypot(ddx, ddz) + nf;
        if (d < 1.2) f = Math.max(f, e.flood * (1 - Math.max(0, d) / 1.2));
      }
    }
    return Math.max(p, f);
  }
  // water surface height near a standing-water cell's dry neighbours: dips under the floor along a noisy contour
  waterY(x, z, c) {
    const i = c.i, j = c.j;
    let d = 9;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      if (this.entry(i + di, j + dj).water) continue;
      const ax = (i + di) * CELL, az = (j + dj) * CELL;
      const ddx = Math.max(ax - x, 0, x - (ax + CELL)), ddz = Math.max(az - z, 0, z - (az + CELL));
      d = Math.min(d, Math.hypot(ddx, ddz));
    }
    if (d > 1.4) return 0.09;
    const n = (valueNoise2(x * 1.1 - 3.3, z * 1.1 + 5.9, 919) - 0.5) * 0.9 + (valueNoise2(x * 3.1, z * 3.1, 929) - 0.5) * 0.25;
    const s = Math.max(0, Math.min(1, (d + n - 0.15) / 0.8));
    return 0.09 - 0.16 * (1 - s * s * (3 - 2 * s));
  }
}
