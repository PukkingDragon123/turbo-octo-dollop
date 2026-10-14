// Deterministic world generation for Level 1.1 — "The Grasslands" (pure data, no three.js).
//
// The dimension is an endless mountain river valley laid over the same 3 m gameplay cell grid as the
// Yellow Rooms (so the mission, nav and monster systems keep working):
//   * the valley floor (meadows, open forest, trails, a wadeable river) stays within a narrow height band
//     around y≈0.24 — walkable cells
//   * granite highlands (forested plateaus behind 5–28 m cliffs) and rock outcrops rise out of it — blocked
//     cells (cell() returns null, passable() is false)
//   * the mission POIs (pump house, relay station, tin shed, fuel depot, office cubicle, workshop, spawn
//     meadow) are protected from cliffs and linked by worn dirt trails.
// Everything is a pure function of (seed, x, z) (+ a per-chunk variant for the day-7 shifts), so every peer
// generates the identical world.
import { hash3, hash01, RNG } from '../../../core/rng.js';
import { CELL, CHUNK, CHUNK_M } from '../yellow/layout.js';
import { Noise2, sstep, clamp01, mix } from './noise.js';

export { CELL, CHUNK, CHUNK_M };
export const WATER_Y = 0.06;   // river surface
export const FLOOR_Y = 0.24;   // nominal meadow height
export const PAD_Y = 0.0;      // concrete slabs of the R.O.O.M. structures (generators stand at y = 0)
export const SKY_DROP = 44;    // arrival height above the ground

export const Z = {
  MEADOW: 'meadow', FOREST: 'forest', RIVER: 'river', BANK: 'bank', PATH: 'path', STRUCT: 'structure',
  HIGH: 'highland', ROCK: 'outcrop', SPAWN: 'spawn',
};

const TAU = Math.PI * 2;

// Mission: three generator structures, deterministic from seed. [{kind, cx, cz}] in chunk coords.
export function missionChunks(seed) {
  const rng = new RNG(hash3(seed, 7, 7, 99));
  const a0 = rng.next() * TAU;
  const kinds = rng.shuffle(['diesel', 'electric', 'mech']);
  const out = [];
  for (let k = 0; k < 3; k++) {
    const a = a0 + (k * TAU) / 3 + rng.range(-0.3, 0.3);
    const R = rng.range(2.3, 3.1);
    out.push({ kind: kinds[k], cx: Math.round(Math.cos(a) * R), cz: Math.round(Math.sin(a) * R) });
  }
  return out;
}

function segDist2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz || 1e-6;
  let t = ((px - ax) * dx + (pz - az) * dz) / L2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px, qz = az + dz * t - pz;
  return { d2: qx * qx + qz * qz, t };
}

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N E S W

// ===========================================================================
export class GrassWorld {
  constructor(seed) {
    this.seed = seed >>> 0;
    const s = this.seed;
    this.nH = new Noise2(hash3(s, 11, 3, 0x51));  // highland mass
    this.nW = new Noise2(hash3(s, 12, 5, 0x52));  // domain warp
    this.nR = new Noise2(hash3(s, 13, 7, 0x53));  // outcrops
    this.nF = new Noise2(hash3(s, 14, 9, 0x54));  // floor relief / forest
    this.nM = new Noise2(hash3(s, 15, 1, 0x55));  // river meander
    this.nT = new Noise2(hash3(s, 16, 2, 0x56));  // highland tops
    this.mission = missionChunks(s);
    this._cellCache = new Map();
    this._initPOIs();
    this._initRiver();
    this._initHero();
    this.edgeBlocks = new Set();
    this._initEdges();
  }

  // -------------------------------------------------------------------------
  // POIs: structures, trails, protected zones
  _initPOIs() {
    const S = [];
    const cellRect = (i0, j0, w, h) => ({ i0, j0, w, h, x0: i0 * CELL, z0: j0 * CELL, x1: (i0 + w) * CELL, z1: (j0 + h) * CELL, cx: (i0 + w / 2) * CELL, cz: (j0 + h / 2) * CELL });
    // spawn meadow (chunk 0,0 — clones fall out of the sky onto (12, 12))
    this.spawn = { x: 12, z: 12 };
    S.push({ kind: 'spawn', ...cellRect(3, 3, 2, 2), protect: 15, flat: false });
    for (const m of this.mission) {
      S.push({ kind: 'gen_' + m.kind, gen: m.kind, chunk: [m.cx, m.cz], ...cellRect(m.cx * CHUNK + 3, m.cz * CHUNK + 3, 2, 2), protect: 13, flat: true });
    }
    S.push({ kind: 'workshop', ...cellRect(2, CHUNK + 2, 2, 2), protect: 10, flat: true });
    const overlaps = (r, pad = 2) => S.some((o) => r.i0 < o.i0 + o.w + pad && r.i0 + r.w + pad > o.i0 && r.j0 < o.j0 + o.h + pad && r.j0 + r.h + pad > o.j0);
    const place = (kind, cx, cz, prefer, extra) => {
      const cands = [prefer, [5, 5], [2, 5], [5, 2], [2, 2], [1, 1], [6, 6], [1, 6], [6, 1]];
      for (const [li, lj] of cands) {
        const r = cellRect(cx * CHUNK + li, cz * CHUNK + lj, 1, 1);
        if (!overlaps(r)) { S.push({ kind, ...r, protect: 8, flat: true, ...extra }); return; }
      }
      const r = cellRect(cx * CHUNK + prefer[0], cz * CHUNK + prefer[1], 1, 1);
      S.push({ kind, ...r, protect: 8, flat: true, ...extra });
    };
    for (const m of this.mission) {
      if (m.kind === 'diesel') place('fuel_store', m.cx + 1, m.cz, [2, 5]);
      if (m.kind === 'electric') place('fuse_office', m.cx, m.cz + 1, [5, 2]);
    }
    this.structures = S;
    // trails: from the spawn meadow to every structure's front (south) side; support huts link to their generator
    const T = [];
    const front = (s) => [s.cx, s.z1 + 2.2];
    const sp = [this.spawn.x, this.spawn.z + 2];
    for (const s of S) {
      if (s.kind === 'spawn') continue;
      let from = sp;
      if (s.kind === 'fuel_store') from = front(S.find((o) => o.gen === 'diesel'));
      if (s.kind === 'fuse_office') from = front(S.find((o) => o.gen === 'electric'));
      const to = front(s);
      // dog-leg: run out of the door first, then cut across
      const mid = [to[0], to[1] + 3.5];
      T.push([from[0], from[1], mid[0], mid[1]], [mid[0], mid[1], s.cx, s.z1 - 0.5]);
    }
    // a loop trail between the generator sites
    const gens = S.filter((s) => s.gen);
    for (let k = 0; k < gens.length; k++) {
      const a = gens[k], b = gens[(k + 1) % gens.length];
      T.push([a.cx, a.z1 + 5.5, b.cx, b.z1 + 5.5]);
    }
    this.trails = T;
    // bounding box of everything protected (fast reject)
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (const s of S) { x0 = Math.min(x0, s.x0 - 30); z0 = Math.min(z0, s.z0 - 30); x1 = Math.max(x1, s.x1 + 30); z1 = Math.max(z1, s.z1 + 30); }
    this.pbox = [x0, z0, x1, z1];
  }

  structureAt(x, z) {
    for (const s of this.structures) if (x >= s.x0 && x < s.x1 && z >= s.z0 && z < s.z1) return s;
    return null;
  }

  // 0..1: how strongly (x, z) is protected from cliffs/outcrops (structures + trails)
  protect(x, z) {
    const b = this.pbox;
    if (x < b[0] || z < b[1] || x > b[2] || z > b[3]) return 0;
    let p = 0;
    for (const s of this.structures) {
      const dx = x - s.cx, dz = z - s.cz;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < s.protect + 8) p = Math.max(p, sstep(s.protect + 8, s.protect, d));
    }
    for (const t of this.trails) {
      const { d2 } = segDist2(x, z, t[0], t[1], t[2], t[3]);
      if (d2 < 144) p = Math.max(p, sstep(12, 5, Math.sqrt(d2)));
    }
    return p;
  }

  // distance to the nearest trail centreline (with a little wobble), Infinity when far
  trailDist(x, z) {
    const b = this.pbox;
    if (x < b[0] || z < b[1] || x > b[2] || z > b[3]) return Infinity;
    let best = 1e9;
    for (const t of this.trails) {
      const { d2, t: u } = segDist2(x, z, t[0], t[1], t[2], t[3]);
      if (d2 > 64) continue;
      const len = Math.hypot(t[2] - t[0], t[3] - t[1]);
      const wob = this.nF.n(u * len * 0.07 + t[0] * 0.13, t[1] * 0.11) * 0.7;
      const d = Math.abs(Math.sqrt(d2) - wob * 0.5);
      if (d < best) best = d;
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // the river: parallel meandering valleys ~290 m apart; one passes ~26 m from the spawn
  _initRiver() {
    const rng = new RNG(hash3(this.seed, 33, 1, 0x71));
    this.rSpacing = 290;
    let best = null;
    for (let tries = 0; tries < 40; tries++) {
      const th = rng.next() * Math.PI;
      const side = rng.chance(0.5) ? 1 : -1;
      const cfg = { rc: Math.cos(th), rs: Math.sin(th), side, flow: rng.chance(0.5) ? 1 : -1, off: 0 };
      Object.assign(this, { rc: cfg.rc, rs: cfg.rs, rOff: 0 });
      const du = this._riverDu(this.spawn.x, this.spawn.z, false);
      cfg.off = du - side * 26;
      this.rOff = cfg.off;
      // score: every structure should be far from the water
      let worst = 1e9;
      for (const s of this.structures) {
        if (s.kind === 'spawn') continue;
        const r = this.river(s.cx, s.cz);
        worst = Math.min(worst, r.dist - r.w - (s.w * CELL) * 0.75);
      }
      if (!best || worst > best.worst) best = { ...cfg, worst };
      if (worst > 14) break;
    }
    this.rc = best.rc; this.rs = best.rs; this.rOff = best.off; this.rSide = best.side; this.rFlow = best.flow;
  }

  _meander(v) {
    return 44 * this.nM.fbm(v / 270, 3.17, 3) + 8 * this.nM.n(v / 52, 9.4);
  }

  _riverDu(x, z, wrap = true) {
    const u = x * this.rc + z * this.rs, v = -x * this.rs + z * this.rc;
    let du = u - this._meander(v) - this.rOff;
    if (wrap) du -= this.rSpacing * Math.round(du / this.rSpacing);
    return du;
  }

  // river sample: {dist, w (half width), du (signed), v, fx, fz (flow direction)}
  river(x, z, out = {}) {
    const u = x * this.rc + z * this.rs, v = -x * this.rs + z * this.rc;
    const m = this._meander(v);
    let du = u - m - this.rOff;
    du -= this.rSpacing * Math.round(du / this.rSpacing);
    const slope = (this._meander(v + 1) - this._meander(v - 1)) * 0.5;
    const k = 1 / Math.sqrt(1 + slope * slope);
    out.du = du;
    out.v = v;
    out.dist = Math.abs(du) * k;
    out.w = 4.4 + 1.3 * this.nM.n(v / 95, 41.3);
    out.depth = 0.5 + 0.12 * this.nM.n(v / 37, 17.9);
    // flow along the centreline (tangent of u = m(v)), in world space
    const tu = slope * k, tv = k;
    const f = this.rFlow;
    out.fx = (tu * this.rc - tv * this.rs) * f;
    out.fz = (tu * this.rs + tv * this.rc) * f;
    // gradient of the distance field (for cheap finite differences elsewhere)
    const sg = du < 0 ? -k : k;
    out.ddx = sg * (this.rc + slope * this.rs);
    out.ddz = sg * (this.rs - slope * this.rc);
    return out;
  }

  // the hero waterfall: a tall granite headland right across the river from the spawn meadow.
  // Several sites along the far bank are tried; the one with the tallest clean cliff close to the water wins.
  _initHero() {
    const rng = new RNG(hash3(this.seed, 44, 2, 0x72));
    const sx = this.spawn.x, sz = this.spawn.z;
    const v0 = -sx * this.rs + sz * this.rc;
    const u0 = sx * this.rc + sz * this.rs;
    const k0 = Math.round((u0 - this._meander(v0) - this.rOff) / this.rSpacing);
    const side = -this.rSide; // opposite bank from the spawn
    const toXZ = (u, v) => [u * this.rc - v * this.rs, u * this.rs + v * this.rc];
    const base = rng.range(-12, 12);
    let best = null;
    const S = {};
    for (const off of [0, 14, -14, 28, -28, 42, -42, 56, -56]) {
      const hv = v0 + base + off;
      const w = 4.4 + 1.3 * this.nM.n(hv / 95, 41.3);
      const uc = this._meander(hv) + this.rOff + k0 * this.rSpacing;
      const [hx, hz] = toXZ(uc + side * (w + 30), hv);
      const [lx, lz] = toXZ(uc + side * (w + 9.5), hv);
      if (this.protect(hx, hz) > 0.05 || this.protect(lx, lz) > 0.3) continue;
      this.hero = { x: hx, z: hz, lipX: lx, lipZ: lz, side, v: hv, uc, poolToRiver: 0, nx: 0, nz: 0 };
      if (this.sdf(hx, hz, S).h < 2) continue;
      let dx = lx - hx, dz = lz - hz;
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl; dz /= dl;
      let fx = null, fz = null;
      for (let t = 0; t < 60; t += 0.25) {
        const x = hx + dx * t, z = hz + dz * t;
        if (this.sdf(x, z, S).h < 0) { fx = x; fz = z; break; }
      }
      if (fx === null) continue;
      const h = this.hero;
      h.footX = fx; h.footZ = fz; h.nx = dx; h.nz = dz;
      h.lipX = fx + dx * 3.2; h.lipZ = fz + dz * 3.2;
      h.topX = fx - dx * 1.6; h.topZ = fz - dz * 1.6;
      const rr = this.river(h.lipX, h.lipZ);
      h.poolToRiver = rr.dist - rr.w;
      const top = this.height(h.topX, h.topZ) - this.height(fx + dx * 1.5, fz + dz * 1.5);
      const dsp = Math.hypot(fx - sx, fz - sz);
      const score = Math.min(top, 26) - Math.max(0, h.poolToRiver - 3) * 0.8 - Math.max(0, dsp - 70) * 0.4 - Math.abs(off) * 0.03;
      h.drop = top;
      if (!best || score > best.score) best = { score, hero: { ...h } };
    }
    if (!best) {
      // no clean site: fall back to the plain geometric headland (no waterfall)
      const hv = v0 + base;
      const w = 4.4 + 1.3 * this.nM.n(hv / 95, 41.3);
      const uc = this._meander(hv) + this.rOff + k0 * this.rSpacing;
      const [hx, hz] = toXZ(uc + side * (w + 30), hv);
      const [lx, lz] = toXZ(uc + side * (w + 9.5), hv);
      this.hero = { x: hx, z: hz, lipX: lx, lipZ: lz, footX: lx, footZ: lz, topX: lx, topZ: lz, nx: 0, nz: 0, side, v: hv, uc, poolToRiver: 0, drop: 0, none: true };
      return;
    }
    this.hero = best.hero;
  }

  // -------------------------------------------------------------------------
  // highland & outcrop fields
  _warp(x, z, o) {
    o.x = x + 38 * this.nW.n(x / 170, z / 170 + 31.4);
    o.z = z + 38 * this.nW.n(x / 170 + 17.1, z / 170);
    return o;
  }

  // raw highland mass (−1..1 → cliffs where > threshold), including exclusions & the hero bump.
  // rd/rw: river distance & half width at (x, z)
  _hRaw(x, z, rd, rw) {
    const W = this._wtmp || (this._wtmp = { x: 0, z: 0 });
    this._warp(x, z, W);
    let h = 0.5 + 0.5 * this.nH.fbm(W.x / 118, W.z / 118, 4);
    const hx = x - this.hero.x, hz = z - this.hero.z;
    const hd = Math.sqrt(hx * hx + hz * hz);
    // river corridors keep a valley floor (narrower at the hero headland so the cliff meets the water)
    const margin = hd < 60 ? mix(4.5, 13, sstep(28, 60, hd)) : 13;
    h -= 0.55 * sstep(rw + margin + 8, rw + margin, rd);
    h -= 0.6 * this.protect(x, z);
    if (hd < 48) h += 0.62 * Math.exp(-(hd * hd) / (2 * 21 * 21));
    return h;
  }

  _oRaw(x, z, rd, rw) {
    let o = 0.5 + 0.5 * this.nR.fbm(x / 46 + 3.3, z / 46 - 7.7, 3);
    o -= 0.4 * sstep(rw + 7, rw + 2, rd);
    o -= 0.6 * this.protect(x, z);
    return o;
  }

  // signed distance estimates (metres, > 0 inside) for highland and outcrop
  sdf(x, z, out = {}) {
    const r = this.river(x, z, out.r || (out.r = {}));
    const e = 0.9;
    const T = 0.585, TO = 0.8;
    const rd = r.dist, rw = r.w, rdx = rd + r.ddx * e, rdz = rd + r.ddz * e;
    const h0 = this._hRaw(x, z, rd, rw), hx = this._hRaw(x + e, z, rdx, rw), hz = this._hRaw(x, z + e, rdz, rw);
    const gh = Math.max(0.004, Math.hypot(hx - h0, hz - h0) / e);
    out.h = (h0 - T) / gh;
    out.hv = h0;
    out.hgx = (hx - h0) / e; out.hgz = (hz - h0) / e;
    const o0 = this._oRaw(x, z, rd, rw), ox = this._oRaw(x + e, z, rdx, rw), oz = this._oRaw(x, z + e, rdz, rw);
    const go = Math.max(0.006, Math.hypot(ox - o0, oz - o0) / e);
    out.o = (o0 - TO) / go;
    return out;
  }

  // -------------------------------------------------------------------------
  // height of the ground at (x, z) (analytic; + optional splat/info out)
  height(x, z, info = null) {
    const S = this.sdf(x, z, this._sd || (this._sd = {}));
    const r = S.r;
    const bankW = 1.8 + 0.9 * this.nM.n(r.v / 23, 3.3);
    return this._heightFrom(x, z, S.h, S.o, r.dist, r.w, r.depth, bankW, info);
  }

  // the height formula given the (expensive) fields: highland/outcrop sdf and river profile values
  _heightFrom(x, z, sh, so, rdist, rw, rdepth, bankW, info) {
    const nF = this.nF;
    let floor = FLOOR_Y + 0.065 * nF.fbm(x / 17, z / 17, 3) + 0.03 * nF.n(x / 4.3, z / 4.3);
    const td = this.trailDist(x, z);
    const trail = td < 3 ? sstep(1.6, 0.4, td) : 0;
    floor -= 0.045 * trail;
    let H = floor;
    let wet = 0;
    if (rdist < rw + bankW) {
      if (rdist < rw) {
        const t = rdist / rw;
        H = Math.min(H, WATER_Y - 0.03 - rdepth * Math.pow(Math.max(0, 1 - t * t), 0.75));
        wet = 1;
      } else {
        const t = sstep(rw, rw + bankW, rdist);
        H = Math.min(H, mix(WATER_Y - 0.035, floor, t));
        wet = 1 - t;
      }
    }
    // hero plunge pool (+ a short run-out channel to the river when the pool sits back from it)
    const hero = this.hero;
    const pdx = x - hero.lipX, pdz = z - hero.lipZ;
    const pd2 = pdx * pdx + pdz * pdz;
    if (pd2 < 81) {
      const pd = Math.sqrt(pd2);
      const pool = sstep(8.5, 4.5, pd);
      H = mix(H, Math.min(H, WATER_Y - 0.62 * sstep(9, 1.5, pd)), pool);
      wet = Math.max(wet, pool);
    }
    if (hero.poolToRiver > 2) {
      const ax = hero.lipX, az = hero.lipZ, bx = hero.lipX + hero.nx * (hero.poolToRiver + 5), bz = hero.lipZ + hero.nz * (hero.poolToRiver + 5);
      const { d2 } = segDist2(x, z, ax, az, bx, bz);
      if (d2 < 16) {
        const cd = Math.sqrt(d2);
        const ch = sstep(3.6, 1.6, cd);
        H = mix(H, Math.min(H, WATER_Y - 0.28 * sstep(3.2, 0.5, cd)), ch);
        wet = Math.max(wet, ch);
      }
    }
    let rock = 0;
    if (sh > -0.5) {
      const nT = this.nT;
      const heroK = Math.exp(-((x - hero.x) ** 2 + (z - hero.z) ** 2) / (2 * 26 * 26));
      const edgeH = 5.5 + 7.5 * (0.5 + 0.5 * nT.n(x / 61, z / 61)) + heroK * 17;
      const shp = sh > 0 ? sh : 0;
      const rise = (24 + 14 * nT.n(x / 140 + 4, z / 140)) * (1 - Math.exp(-shp / 34));
      const ridge = 9 * nT.ridged(x / 85, z / 85, 3) * (1 - Math.exp(-shp / 20));
      let top = floor + edgeH + rise + ridge + 1.1 * nT.n(x / 7.5, z / 7.5) + 0.5 * nT.n(x / 2.6, z / 2.6);
      const bench = 0.55 * sstep(0.4, 0.9, 0.5 + 0.5 * nT.n(x / 33 - 9, z / 33));
      const step = 3.2;
      const tq = top / step, tf = tq - Math.floor(tq);
      top = mix(top, (Math.floor(tq) + sstep(0.65, 1.0, tf)) * step, bench * (1 - sstep(4, 12, sh)));
      const cw = 1.6 + 1.3 * (0.5 + 0.5 * nT.n(x / 13, z / 13 + 5));
      const k = sstep(0, cw, sh);
      H = mix(H, top, k);
      rock = Math.max(rock, sstep(-0.3, 0.8, sh) * (1 - sstep(cw + 2.5, cw + 10, sh) * 0.75));
    }
    if (so > -0.5) {
      const nR = this.nR;
      const dome = 1.4 + 3.6 * sstep(0, 7, so) + 1.5 * (0.5 + 0.5 * nR.n(x / 9, z / 9));
      const k = sstep(0, 0.9 + 0.5 * (0.5 + 0.5 * nR.n(x / 5, z / 5)), so);
      H = Math.max(H, mix(H, floor + dome + 0.35 * nR.n(x / 2.2, z / 2.2), k));
      rock = Math.max(rock, sstep(-0.2, 0.5, so));
    }
    const st = this._padAt(x, z);
    if (st) H = mix(H, st.y, st.k);
    if (info) {
      info.wet = wet;
      info.trail = trail;
      info.rock = rock;
      info.sh = sh;
      info.so = so;
      info.pad = st ? st.k : 0;
      info.riverDist = rdist;
      info.riverW = rw;
      info.floor = floor;
    }
    return H;
  }

  // -------------------------------------------------------------------------
  // Per-chunk terrain grid at 0.75 m (33x33 vertices + a 1-sample border for normals = 35x35).
  // The expensive fields come from the chunk's 1.5 m sdf grid (bilinear), so every consumer (render
  // mesh, physics heightfield, object placement) sees exactly the same surface.
  chunkGrid(cx, cz, variant = 0) {
    const key = ((cx + 4096) * 8192 + (cz + 4096)) * 64 + (variant & 63);
    const cache = this._gridCache || (this._gridCache = new Map());
    let g = cache.get(key);
    if (g) { cache.delete(key); cache.set(key, g); return g; }
    g = this._buildGrid(cx, cz, variant);
    cache.set(key, g);
    if (cache.size > 160) cache.delete(cache.keys().next().value);
    return g;
  }

  _buildGrid(cx, cz, variant) {
    const C = this.chunkCells(cx, cz, variant);
    const F = C.fields;
    const GN = 33, B = 35, FG = C.FG; // FG = 19 (1.5 m field grid incl. 1 border sample)
    const x0 = cx * CHUNK_M, z0 = cz * CHUNK_M;
    const h = new Float32Array(B * B);
    const wet = new Float32Array(B * B), rock = new Float32Array(B * B), trail = new Float32Array(B * B), pad = new Float32Array(B * B);
    const info = {};
    const vf = variant ? this._variantBump(cx, cz, variant) : null;
    for (let vj = -1; vj <= GN; vj++) {
      const fz = (vj + 2) * 0.5; // field-grid coordinate
      const jz = Math.min(FG - 2, Math.floor(fz)), tz = fz - jz;
      for (let vi = -1; vi <= GN; vi++) {
        const fx = (vi + 2) * 0.5;
        const ix = Math.min(FG - 2, Math.floor(fx)), tx = fx - ix;
        const k00 = jz * FG + ix, k10 = k00 + 1, k01 = k00 + FG, k11 = k01 + 1;
        const w00 = (1 - tx) * (1 - tz), w10 = tx * (1 - tz), w01 = (1 - tx) * tz, w11 = tx * tz;
        const L = (a) => a[k00] * w00 + a[k10] * w10 + a[k01] * w01 + a[k11] * w11;
        const x = x0 + vi * 0.75, z = z0 + vj * 0.75;
        let H = this._heightFrom(x, z, L(F.sh), L(F.so), L(F.rd), L(F.rw), L(F.rdep), L(F.rbank), info);
        if (vf) H += vf(x, z, info);
        const k = (vj + 1) * B + (vi + 1);
        h[k] = H; wet[k] = info.wet; rock[k] = info.rock; trail[k] = info.trail; pad[k] = info.pad;
      }
    }
    return { cx, cz, variant, x0, z0, h, wet, rock, trail, pad, B, step: 0.75, n: GN - 1 };
  }

  // day-7 reality shifts: a chunk's interior gently heaves (edges stay put so seams never open)
  _variantBump(cx, cz, variant) {
    const x0 = cx * CHUNK_M, z0 = cz * CHUNK_M;
    const ph = hash01(cx, cz, variant, this.seed) * 100;
    return (x, z, info) => {
      if (info.pad > 0 || info.sh > -1 || info.so > -1) return 0;
      const u = (x - x0) / CHUNK_M, v = (z - z0) / CHUNK_M;
      const win = Math.sin(Math.PI * Math.min(1, Math.max(0, u))) * Math.sin(Math.PI * Math.min(1, Math.max(0, v)));
      return win * win * 0.09 * this.nF.n(x / 6 + ph, z / 6 - ph);
    };
  }

  // ground height for placing objects: exact grid surface where that grid is (or will be) needed anyway,
  // the analytic height for distant scenery (no grid build)
  placeY(x, z, near, variantFn = null) {
    if (near) return this.groundAt(x, z, variantFn);
    const cx = Math.floor(x / CHUNK_M), cz = Math.floor(z / CHUNK_M);
    const key = ((cx + 4096) * 8192 + (cz + 4096)) * 64 + ((variantFn ? variantFn(cx, cz) : 0) & 63);
    if (this._gridCache?.has(key)) return this.groundAt(x, z, variantFn);
    return this.height(x, z);
  }

  // exact surface height (same triangles as the render mesh and the physics heightfield)
  groundAt(x, z, variantFn = null) {
    const cx = Math.floor(x / CHUNK_M), cz = Math.floor(z / CHUNK_M);
    const g = this.chunkGrid(cx, cz, variantFn ? variantFn(cx, cz) : 0);
    const lx = (x - g.x0) / 0.75, lz = (z - g.z0) / 0.75;
    let i = Math.floor(lx), j = Math.floor(lz);
    if (i > 31) i = 31; if (j > 31) j = 31; if (i < 0) i = 0; if (j < 0) j = 0;
    const fx = lx - i, fz = lz - j;
    const B = g.B, k = (j + 1) * B + (i + 1);
    const h00 = g.h[k], h10 = g.h[k + 1], h01 = g.h[k + B], h11 = g.h[k + B + 1];
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  _padAt(x, z) {
    const b = this.pbox;
    if (x < b[0] || z < b[1] || x > b[2] || z > b[3]) return null;
    for (const s of this.structures) {
      if (!s.flat) continue;
      const dx = Math.max(s.x0 - x, 0, x - s.x1), dz = Math.max(s.z0 - z, 0, z - s.z1);
      const d = Math.hypot(dx, dz);
      if (d < 4.2) {
        const p = this._padTmp || (this._padTmp = { y: 0, k: 0 });
        p.y = PAD_Y - 0.03;
        p.k = sstep(4.2, 1.0, d);
        return p;
      }
    }
    return null;
  }

  // water surface depth above the ground (0 on dry land)
  waterDepth(x, z) {
    const r = this.river(x, z, this._wd || (this._wd = {}));
    const hp = Math.hypot(x - this.hero.lipX, z - this.hero.lipZ);
    if (r.dist > r.w + 3 && hp > 9.5) return 0;
    const H = this.height(x, z);
    return Math.max(0, WATER_Y - H);
  }

  // forest density 0..1 (walkable areas): mostly golden meadows, stands of conifers and forest skirts at cliffs
  forest(x, z, sh) {
    const f = 0.5 + 0.5 * this.nF.fbm(x / 82 + 11, z / 82 - 4, 3);
    let d = sstep(0.6, 0.72, f);
    if (sh !== undefined && sh > -9) d = Math.max(d, 0.75 * sstep(-9, -2.5, sh));
    return d;
  }

  // -------------------------------------------------------------------------
  // structure walls on cell edges (nav): generator houses are open to the south, the cubicle too
  _initEdges() {
    const E = this.edgeBlocks;
    const block = (i, j, d) => {
      E.add(`${i},${j},${d}`);
      const ni = i + DIRS[d][0], nj = j + DIRS[d][1];
      E.add(`${ni},${nj},${(d + 2) % 4}`);
    };
    for (const s of this.structures) {
      if (!s.kind.startsWith('gen_') && s.kind !== 'fuse_office' && s.kind !== 'workshop') continue;
      for (let i = s.i0; i < s.i0 + s.w; i++) {
        block(i, s.j0, 0); // north wall
        if (s.kind === 'gen_electric') block(i, s.j0 + s.h - 1, 2); // fenced compound: gate is a gap in the fence...
      }
      for (let j = s.j0; j < s.j0 + s.h; j++) {
        block(s.i0, j, 3);
        block(s.i0 + s.w - 1, j, 1);
      }
      if (s.kind === 'gen_electric') {
        // reopen the gate (south edge of the west cell)
        const gi = s.i0, gj = s.j0 + s.h - 1;
        E.delete(`${gi},${gj},2`); E.delete(`${gi},${gj + 1},0`);
      }
    }
  }

  edgeOpen(i, j, d) {
    if (this.edgeBlocks.has(`${i},${j},${d}`)) return false;
    // fallen logs (scatter) lie along cell edges
    if (d === 0 || d === 3) return !this._logEdge(i, j, d);
    if (d === 2) return !this._logEdge(i, j + 1, 0);
    return !this._logEdge(i + 1, j, 3);
  }

  _logEdge(i, j, d) {
    const cx = Math.floor(i / CHUNK), cz = Math.floor(j / CHUNK);
    const v = this._vfn ? this._vfn(cx, cz) : 0;
    const sc = this.logs(cx, cz, v);
    for (const e of sc.edges) if (e[0] === i && e[1] === j && e[2] === d) return true;
    const an = this.chunkCells(cx, cz, v).anomaly;
    if (an) for (const e of an.edges) if (e[0] === i && e[1] === j && e[2] === d) return true;
    return false;
  }

  // -------------------------------------------------------------------------
  // cell classification (cached per chunk)
  chunkCells(cx, cz, variant = 0) {
    const key = ((cx + 4096) * 8192 + (cz + 4096)) * 64 + (variant & 63);
    let rec = this._cellCache.get(key);
    if (rec) return rec;
    rec = this._classify(cx, cz, variant);
    this._cellCache.set(key, rec);
    if (this._cellCache.size > 900) this._cellCache.delete(this._cellCache.keys().next().value);
    return rec;
  }

  _classify(cx, cz, variant) {
    const N = CHUNK, FG = N * 2 + 3; // 19 samples at 1.5 m, one border sample each side
    const x0 = cx * CHUNK_M - 1.5, z0 = cz * CHUNK_M - 1.5;
    const n = FG * FG;
    const F = { sh: new Float32Array(n), so: new Float32Array(n), rd: new Float32Array(n), rw: new Float32Array(n), rdep: new Float32Array(n), rbank: new Float32Array(n), fx: new Float32Array(n), fz: new Float32Array(n) };
    const S = {};
    for (let gj = 0; gj < FG; gj++) for (let gi = 0; gi < FG; gi++) {
      this.sdf(x0 + gi * 1.5, z0 + gj * 1.5, S);
      const k = gj * FG + gi, r = S.r;
      F.sh[k] = S.h; F.so[k] = S.o;
      F.rd[k] = r.dist; F.rw[k] = r.w; F.rdep[k] = r.depth; F.rbank[k] = 1.8 + 0.9 * this.nM.n(r.v / 23, 3.3);
      F.fx[k] = r.fx; F.fz[k] = r.fz;
    }
    const cells = new Array(N * N);
    const rr = {};
    for (let lj = 0; lj < N; lj++) for (let li = 0; li < N; li++) {
      const i = cx * N + li, j = cz * N + lj;
      const x = (i + 0.5) * CELL, z = (j + 0.5) * CELL;
      let mh = -1e9, mo = -1e9;
      for (let a = 0; a <= 2; a++) for (let b = 0; b <= 2; b++) {
        const k = (lj * 2 + b + 1) * FG + (li * 2 + a + 1);
        if (F.sh[k] > mh) mh = F.sh[k];
        if (F.so[k] > mo) mo = F.so[k];
      }
      const st = this.structureAt(x, z);
      this.river(x, z, rr);
      const c = { i, j, li, lj, x, z, zone: Z.MEADOW, special: null, water: false, blocked: false, sh: mh, so: mo, forest: 0, occupied: false, variant };
      if (st) {
        c.zone = st.kind === 'spawn' ? Z.SPAWN : Z.STRUCT;
        c.special = st.kind === 'spawn' ? SPAWN_ROOM : st;
      } else if (mh > -0.35) { c.zone = Z.HIGH; c.blocked = true; }
      else if (mo > -0.35) { c.zone = Z.ROCK; c.blocked = true; }
      else if (rr.dist < rr.w - 0.4 || Math.hypot(x - this.hero.lipX, z - this.hero.lipZ) < 5) { c.zone = Z.RIVER; c.water = true; }
      else if (this.trailDist(x, z) < 1.2) c.zone = Z.PATH;
      else if (rr.dist < rr.w + 2.2) c.zone = Z.BANK;
      else {
        c.forest = this.forest(x, z, mh);
        c.zone = c.forest > 0.5 ? Z.FOREST : Z.MEADOW;
      }
      cells[lj * N + li] = c;
    }
    // the valley is subtly wrong: at most one out-of-place object per chunk
    const anomaly = this._anomaly(cx, cz, variant, cells);
    // corners holding a trunk or boulder: fine for walking, but no exit booth / crate may land there
    for (let lj = 0; lj <= N; lj++) for (let li = 0; li <= N; li++) {
      const it = this.cornerItem(cx * N + li, cz * N + lj, variant);
      if (!it) continue;
      for (const [a, b] of [[li - 1, lj - 1], [li, lj - 1], [li - 1, lj], [li, lj]]) {
        if (a < 0 || b < 0 || a >= N || b >= N) continue;
        const c = cells[b * N + a];
        if (!c.special) c.special = OBSTACLE;
      }
    }
    return { cx, cz, variant, cells, fields: F, FG, anomaly };
  }

  // deterministic anomaly for a chunk: {kind, i, j, x, z, rot, ...} or null
  _anomaly(cx, cz, variant, cells) {
    const N = CHUNK;
    const h = hash01(cx, cz, 9001, this.seed);
    const isSpawnRing = Math.max(Math.abs(cx), Math.abs(cz)) <= 2;
    if (cells.some((c) => c.zone === Z.STRUCT || c.zone === Z.SPAWN)) return null;
    if (h > (isSpawnRing ? 0.6 : 0.3)) return null;
    const kinds = [['door', 3], ['poles', 3], ['powerline', 2], ['phone', 2], ['chair', 2], ['rocks', 2], ['wall', 2], ['vending', 1.2], ['tv', 1.2], ['clone', 1.5], ['carpet', 1.5]];
    let tw = 0;
    for (const k of kinds) tw += k[1];
    let r = hash01(cx, cz, 9002, this.seed) * tw, kind = kinds[0][0];
    for (const k of kinds) { r -= k[1]; if (r <= 0) { kind = k[0]; break; } }
    const open = (c) => c && !c.blocked && !c.special && !c.water && c.zone !== Z.PATH;
    // candidate cells: open with open neighbours (bank cells for the sunk chair)
    const cands = [];
    for (let lj = 1; lj < N - 1; lj++) for (let li = 1; li < N - 1; li++) {
      const c = cells[lj * N + li];
      if (kind === 'chair') { if (c.zone === Z.BANK) cands.push(c); continue; }
      if (!open(c) || c.zone === Z.BANK) continue;
      if (![[-1, 0], [1, 0], [0, -1], [0, 1]].every(([a, b]) => open(cells[(lj + b) * N + li + a]))) continue;
      if ((kind === 'vending' || kind === 'phone') !== (c.zone === Z.FOREST) && kind !== 'tv' && hash01(c.i, c.j, 9003, this.seed) < 0.7) continue;
      cands.push(c);
    }
    if (!cands.length) return null;
    const c = cands[Math.floor(hash01(cx, cz, 9004, this.seed) * cands.length)];
    const rot = Math.floor(hash01(cx, cz, 9005, this.seed) * 4) * (Math.PI / 2);
    const a = { kind, i: c.i, j: c.j, x: c.x, z: c.z, rot, cx, cz, edges: [] };
    if (kind === 'door' || kind === 'phone' || kind === 'vending' || kind === 'tv') c.occupied = true;
    if (kind === 'wall') {
      const alongX = hash01(cx, cz, 9006, this.seed) < 0.5;
      a.alongX = alongX;
      a.edges.push(alongX ? [c.i, c.j, 0] : [c.i, c.j, 3]);
    }
    c.special = c.special || { kind: 'anomaly_' + kind };
    return a;
  }

  cellAt(i, j, variantFn) {
    const cx = Math.floor(i / CHUNK), cz = Math.floor(j / CHUNK);
    const rec = this.chunkCells(cx, cz, variantFn ? variantFn(cx, cz) : 0);
    return rec.cells[(j - cz * CHUNK) * CHUNK + (i - cx * CHUNK)];
  }
}

// ---------------------------------------------------------------------------
// Scatter. Everything is decided per point with hashes (independent of chunk order), so the near
// full-detail trees and the far impostors always agree. Trees/boulders on the valley floor stand on
// cell CORNERS (>= 1.1 m off every cell-centre line), so the grid nav lines between cell centres stay clear.
const SPECIES_H = [[19, 30], [15, 24], [17, 27], [4, 9]];

GrassWorld.prototype._species = function (x, z, h) {
  const n = this.nF.n(x / 57 + 31, z / 57 - 12);
  if (n > 0.3) return h < 0.18 ? 3 : 2;   // pine stands
  if (h < 0.22) return 3;                  // young trees
  return h < 0.62 ? 0 : 1;                 // spruce / fir
};

// what stands on valley-floor corner (i, j): null | {type:'tree'|'boulder'|'river', ...}
GrassWorld.prototype.cornerItem = function (i, j, variant = 0) {
  const cache = this._ciCache || (this._ciCache = new Map());
  const key = ((i + 32768) * 65536 + (j + 32768)) * 64 + (variant & 63);
  let it = cache.get(key);
  if (it !== undefined) return it;
  it = this._cornerItem(i, j, variant);
  cache.set(key, it);
  if (cache.size > 60000) cache.delete(cache.keys().next().value);
  return it;
};

GrassWorld.prototype._cornerItem = function (i, j, variant = 0) {
  const s = this.seed + variant * 7919;
  const h1 = hash01(i, j, 501, s), h2 = hash01(i, j, 502, s), h3 = hash01(i, j, 503, s), h4 = hash01(i, j, 504, s);
  const x = i * CELL + (h1 - 0.5) * 0.7, z = j * CELL + (h2 - 0.5) * 0.7;
  // keep structures, the spawn meadow and trails clear
  for (const st of this.structures) if (x > st.x0 - 2.2 && x < st.x1 + 2.2 && z > st.z0 - 2.2 && z < st.z1 + 2.2) return null;
  const sp = this.spawn;
  if ((x - sp.x) ** 2 + (z - sp.z) ** 2 < 100) return null;
  if (this.trailDist(x, z) < 2.4) return null;
  const S = this.sdf(x, z, this._ci || (this._ci = {}));
  if (S.h > -1.4 || S.o > -1.0) return null;
  const r = S.r;
  const hero = this.hero;
  if ((x - hero.lipX) ** 2 + (z - hero.lipZ) ** 2 < 49) return null;
  if (r.dist < r.w - 0.6) return h3 < 0.3 ? { type: 'river', x, z, r: 0.35 + h4 * 0.45, rot: h1 * 6.28, tilt: (h2 - 0.5) * 0.5, v: (h4 * 6) | 0 } : null;
  if (r.dist < r.w + 1.0) return null;
  const bank = r.dist < r.w + 2.4;
  const f = this.forest(x, z, S.h);
  const pTree = f > 0.45 ? 0.5 + 0.38 * f : bank ? 0.02 : 0.035;
  if (h3 < pTree) {
    const big = f > 0.45 && h4 > 0.2;
    const sp2 = this._species(x, z, big ? 0.3 + h4 * 0.7 : h4 * 0.5);
    const hr = SPECIES_H[sp2];
    const hgt = hr[0] + (hr[1] - hr[0]) * hash01(i, j, 505, s) * (big || sp2 === 3 ? 1 : 0.6);
    return { type: 'tree', x, z, sp: sp2, h: hgt, rot: h1 * 31.4 % 6.283, lean: (h2 - 0.5) * 0.06, seed: (h4 * 4) | 0, col: true };
  }
  const nearCliff = S.h > -5 || S.o > -4;
  if (h3 < pTree + (bank ? 0.1 : nearCliff ? 0.28 : 0.03)) {
    return { type: 'boulder', x, z, r: 0.35 + h4 * (nearCliff ? 0.55 : 0.32), rot: h1 * 6.28, tilt: (h2 - 0.5) * 0.6, v: (h4 * 6) | 0 };
  }
  return null;
};

// highland / outcrop interior point (lattice a, b): forest above the cliff rim, granite on outcrops
GrassWorld.prototype.highItem = function (a, b, variant = 0) {
  const s = this.seed + variant * 7919;
  const h1 = hash01(a, b, 601, s), h2 = hash01(a, b, 602, s), h3 = hash01(a, b, 603, s), h4 = hash01(a, b, 604, s);
  const x = a * CELL + 0.3 + h1 * 2.4, z = b * CELL + 0.3 + h2 * 2.4;
  const S = this.sdf(x, z, this._hi || (this._hi = {}));
  if (S.h > 2.5) {
    const dens = 0.62 + 0.28 * this.nT.n(x / 40, z / 40 + 9);
    if (h3 < dens) {
      const sp = this._species(x, z, 0.25 + h4 * 0.75);
      const hr = SPECIES_H[sp];
      return { type: 'tree', x, z, sp, h: hr[0] + (hr[1] - hr[0]) * hash01(a, b, 605, s), rot: h1 * 6.28, lean: (h2 - 0.5) * 0.1, seed: (h4 * 4) | 0, col: false, high: true };
    }
  } else if (S.o > 1.0 && h3 < 0.32) {
    return { type: 'outcrop', x, z, r: 1.0 + h4 * 1.5, rot: h1 * 6.28, tilt: (h2 - 0.5) * 0.8, v: (h4 * 6) | 0 };
  } else if (S.o > 3.5 && h3 < 0.42) {
    return { type: 'tree', x, z, sp: 2, h: 9 + h4 * 7, rot: h1 * 6.28, lean: (h2 - 0.5) * 0.16, seed: (h4 * 4) | 0, col: false, high: true };
  }
  return null;
};

GrassWorld.prototype.scatter = function scatter(cx, cz, variant = 0) {
  const cache = this._scatCache || (this._scatCache = new Map());
  const key = ((cx + 4096) * 8192 + (cz + 4096)) * 64 + (variant & 63);
  let S = cache.get(key);
  if (S) return S;
  S = this._scatter(cx, cz, variant);
  cache.set(key, S);
  if (cache.size > 2500) cache.delete(cache.keys().next().value);
  return S;
};

GrassWorld.prototype._scatter = function _scatter(cx, cz, variant) {
  const trees = [], rocks = [];
  const N = CHUNK;
  for (let lj = 0; lj < N; lj++) for (let li = 0; li < N; li++) {
    const i = cx * N + li, j = cz * N + lj;
    const c = this.cornerItem(i, j, variant);
    if (c) (c.type === 'tree' ? trees : rocks).push(c);
    const h = this.highItem(i, j, variant);
    if (h) (h.type === 'tree' ? trees : rocks).push(h);
  }
  return { trees, rocks, logs: [], edges: [] };
};

// fallen logs need the cell classification (forest cells only); they block the edge they lie on
GrassWorld.prototype.logs = function (cx, cz, variant = 0) {
  const sc = this.scatter(cx, cz, variant);
  if (sc._logsDone) return sc;
  sc._logsDone = true;
  const C = this.chunkCells(cx, cz, variant);
  const N = CHUNK;
  for (let lj = 1; lj < N - 1; lj++) for (let li = 1; li < N - 1; li++) {
    const i = cx * N + li, j = cz * N + lj;
    const c = C.cells[lj * N + li];
    if (c.zone !== Z.FOREST || c.occupied || hash01(i, j, 701, this.seed + variant) > 0.06) continue;
    const alongX = hash01(i, j, 702, this.seed) < 0.5;
    const o = alongX ? C.cells[(lj - 1) * N + li] : C.cells[lj * N + li - 1];
    if (!o || o.blocked || o.zone !== Z.FOREST) continue;
    sc.logs.push({ x: alongX ? (i + 0.5) * CELL : i * CELL, z: alongX ? j * CELL : (j + 0.5) * CELL, alongX, len: 2.2 + hash01(i, j, 703, this.seed) * 0.35, r: 0.17 + hash01(i, j, 704, this.seed) * 0.12, rot: hash01(i, j, 705, this.seed) * 6.28 });
    sc.edges.push(alongX ? [i, j, 0] : [i, j, 3]);
  }
  return sc;
};

// granite cliff faces along the highland rim (one per cell the contour crosses) — near field only
GrassWorld.prototype.cliffs = function (cx, cz, variant = 0) {
  const sc = this.scatter(cx, cz, variant);
  if (sc.cliffs) return sc.cliffs;
  const C = this.chunkCells(cx, cz, variant);
  const F = C.fields, FG = C.FG, N = CHUNK;
  const out = [];
  for (let lj = 0; lj < N; lj++) for (let li = 0; li < N; li++) {
    let best = -1, bd = 1e9;
    for (let a = 0; a <= 2; a++) for (let b = 0; b <= 2; b++) {
      const k = (lj * 2 + b + 1) * FG + (li * 2 + a + 1);
      const d = Math.abs(F.sh[k] - 1.3);
      if (F.sh[k] > -0.2 && F.sh[k] < 3.5 && d < bd) { bd = d; best = k; }
    }
    if (best < 0) continue;
    const gi = best % FG, gj = Math.floor(best / FG);
    const i = cx * N + li, j = cz * N + lj;
    const x = cx * CHUNK_M + (gi - 1) * 1.5 + (hash01(i, j, 801, this.seed) - 0.5), z = cz * CHUNK_M + (gj - 1) * 1.5 + (hash01(i, j, 802, this.seed) - 0.5);
    const S = this.sdf(x, z, this._scs || (this._scs = {}));
    const gl = Math.hypot(S.hgx, S.hgz) || 1;
    out.push({ type: 'cliff', x, z, nx: -S.hgx / gl, nz: -S.hgz / gl, r: 2.6 + hash01(i, j, 803, this.seed) * 1.6, v: (hash01(i, j, 804, this.seed) * 4) | 0, tilt: (hash01(i, j, 805, this.seed) - 0.5) * 0.24 });
  }
  sc.cliffs = out;
  return out;
};

// shared marker for the spawn meadow (monsters never spawn on it)
export const SPAWN_ROOM = { kind: 'spawn' };
export const OBSTACLE = { kind: 'obstacle' };
export { DIRS, segDist2, hash01 };
