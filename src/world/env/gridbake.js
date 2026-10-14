// Per-chunk light baking for the Level 0 cell grid (see the GRID path in src/gfx/bakedlight.js).
// For every vertex: 2D wall transmission towards the 8 fixtures around its origin cell (Uint8), and the
// pre-weighted contribution of the 12 fixtures in the next ring (Uint16, w / OUT_SCALE). Walls around the
// chunk are copied once into a small typed-array grid so the DDA never touches the layout maps.
// Also provides the packed edge / corner-post info used for analytic floor & ceiling AO, and corner AO
// for wall faces.
import * as THREE from 'three';
import { CELL, CHUNK, HEIGHT, W, wallN, wallW, wallTransmission, cellInfo, getLayout, floorDiv } from '../levels/yellow/layout.js';
import { OUT_SCALE, WALL_T, emitLobe } from '../../gfx/bakedlight.js';

const LY = HEIGHT - 0.04;   // fixture height
const RADIUS = 9;
export const IN_OFF = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
export const OUT_OFF = [[-2, -1], [-2, 0], [-2, 1], [2, -1], [2, 0], [2, 1], [-1, -2], [0, -2], [1, -2], [-1, 2], [0, 2], [1, 2]];
const MARGIN = 4;
const DIAG = [0, 2, 5, 7];
// the shader's per-pixel inner ring decodes wall types with WALL_T: keep it in sync with the layout
for (let t = 0; t < 8; t++) if (Math.abs(wallTransmission(t) - WALL_T[t]) > 1e-6) console.warn('[gridbake] WALL_T out of sync with wallTransmission for type', t);

// solid at the start (u = 0) / end (u = CELL) of an edge, for floors (f) and ceilings (c)
const SOLID_START_F = [0, 1, 1, 1, 1, 0, 1, 1];
const SOLID_END_F = [0, 1, 1, 1, 0, 1, 1, 1];
const SOLID_START_C = [0, 1, 1, 1, 1, 0, 0, 1];
const SOLID_END_C = [0, 1, 1, 1, 0, 1, 0, 1];

export class GridBaker {
  constructor(seed, variantFn, cx, cz) {
    this.seed = seed;
    this.variantFn = variantFn;
    this.I0 = cx * CHUNK - MARGIN;
    this.J0 = cz * CHUNK - MARGIN;
    this.Wd = CHUNK + MARGIN * 2;
    const n = this.Wd * this.Wd;
    this.tN = new Float32Array(n);
    this.tW = new Float32Array(n);
    this.rN = new Uint8Array(n);
    this.rW = new Uint8Array(n);
    this.lit = new Uint8Array(n);
    for (let lj = 0; lj < this.Wd; lj++) {
      for (let li = 0; li < this.Wd; li++) {
        const i = this.I0 + li, j = this.J0 + lj, k = lj * this.Wd + li;
        const a = wallN(seed, i, j, variantFn), b = wallW(seed, i, j, variantFn);
        this.rN[k] = a; this.rW[k] = b;
        this.tN[k] = wallTransmission(a); this.tW[k] = wallTransmission(b);
        this.lit[k] = cellInfo(seed, i, j, variantFn).light ? 1 : 0;
      }
    }
    // pillars at cell corners (owned by the cell whose NW corner they sit on)
    this.posts = new Map();
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const l = getLayout(seed, cx + dx, cz + dz, variantFn(cx + dx, cz + dz));
      for (const p of l.pillars) this.posts.set(this._ck((cx + dx) * CHUNK + p.li, (cz + dz) * CHUNK + p.lj), p.size / 2);
    }
  }

  _ck(i, j) { return (i + 32768) * 65536 + (j + 32768); }
  _in(i, j) { const li = i - this.I0, lj = j - this.J0; return li >= 0 && lj >= 0 && li < this.Wd && lj < this.Wd ? lj * this.Wd + li : -1; }
  edgeN(i, j) { const k = this._in(i, j); return k >= 0 ? this.rN[k] : wallN(this.seed, i, j, this.variantFn); }
  edgeW(i, j) { const k = this._in(i, j); return k >= 0 ? this.rW[k] : wallW(this.seed, i, j, this.variantFn); }
  isLit(i, j) { const k = this._in(i, j); return k >= 0 ? this.lit[k] === 1 : !!cellInfo(this.seed, i, j, this.variantFn).light; }

  // 2D transmission from (x0, z0) to (x1, z1) across cell edges (DDA)
  trans(x0, z0, x1, z1) {
    let i = Math.floor(x0 / CELL), j = Math.floor(z0 / CELL);
    const ie = Math.floor(x1 / CELL), je = Math.floor(z1 / CELL);
    if (i === ie && j === je) return 1;
    const dx = x1 - x0, dz = z1 - z0;
    const sI = dx > 0 ? 1 : -1, sJ = dz > 0 ? 1 : -1;
    const adx = Math.abs(dx), adz = Math.abs(dz);
    const tDx = adx > 1e-9 ? CELL / adx : 1e9, tDz = adz > 1e-9 ? CELL / adz : 1e9;
    let tMx = adx > 1e-9 ? (dx > 0 ? (i + 1) * CELL - x0 : x0 - i * CELL) / adx : 1e9;
    let tMz = adz > 1e-9 ? (dz > 0 ? (j + 1) * CELL - z0 : z0 - j * CELL) / adz : 1e9;
    let tr = 1;
    const Wd = this.Wd, I0 = this.I0, J0 = this.J0;
    for (let n = 0; n < 10 && (i !== ie || j !== je); n++) {
      if (tMx < tMz) {
        const wi = sI > 0 ? i + 1 : i;
        const li = wi - I0, lj = j - J0;
        tr *= li >= 0 && lj >= 0 && li < Wd && lj < Wd ? this.tW[lj * Wd + li] : wallTransmission(wallW(this.seed, wi, j, this.variantFn));
        i += sI; tMx += tDx;
      } else {
        const wj = sJ > 0 ? j + 1 : j;
        const li = i - I0, lj = wj - J0;
        tr *= li >= 0 && lj >= 0 && li < Wd && lj < Wd ? this.tN[lj * Wd + li] : wallTransmission(wallN(this.seed, i, wj, this.variantFn));
        j += sJ; tMz += tDz;
      }
      if (tr < 0.01) return 0;
    }
    return tr;
  }

  // transmissions (8 inner + 12 outer) from sample point (sx, sz) for origin cell (ci, cj) into out[o..o+20)
  _transInto(sx, sz, ci, cj, out, o, litIn, litOut) {
    const li = ci - this.I0, lj = cj - this.J0, Wd = this.Wd;
    if (Math.floor(sx / CELL) === ci && Math.floor(sz / CELL) === cj && li >= 1 && lj >= 1 && li < Wd - 1 && lj < Wd - 1) {
      // sample inside its origin cell: a ray to an axis neighbour's centre stays in the shared strip and
      // crosses exactly one edge; to a diagonal neighbour it crosses two, in the order the DDA would visit
      // them (same arithmetic as trans(), so the result is identical)
      const tN = this.tN, tW = this.tW, k0 = lj * Wd + li;
      out[o + 1] = litIn[1] ? tN[k0] : 0;
      out[o + 3] = litIn[3] ? tW[k0] : 0;
      out[o + 4] = litIn[4] ? tW[k0 + 1] : 0;
      out[o + 6] = litIn[6] ? tN[k0 + Wd] : 0;
      for (let q = 0; q < 4; q++) {
        const k = DIAG[q];
        if (!litIn[k]) { out[o + k] = 0; continue; }
        const di = IN_OFF[k][0], dj = IN_OFF[k][1];
        const x1 = (ci + di + 0.5) * CELL, z1 = (cj + dj + 0.5) * CELL;
        const dx = x1 - sx, dz = z1 - sz, adx = Math.abs(dx), adz = Math.abs(dz);
        const tMx = (dx > 0 ? (ci + 1) * CELL - sx : sx - ci * CELL) / adx;
        const tMz = (dz > 0 ? (cj + 1) * CELL - sz : sz - cj * CELL) / adz;
        const kw = di > 0 ? 1 : 0, kn = dj > 0 ? Wd : 0;   // W edge on the x side, N edge on the z side
        const tr = tMx < tMz
          ? tW[k0 + kw] * tN[k0 + di + kn]                 // x first: W edge of (ci|ci+1, cj), then N edge in column ci+di
          : tN[k0 + kn] * tW[k0 + dj * Wd + kw];           // z first: N edge of (ci, cj|cj+1), then W edge in row cj+dj
        out[o + k] = tr < 0.01 ? 0 : tr;
      }
      if (li >= 2 && lj >= 2 && li < Wd - 2 && lj < Wd - 2) {
        for (let k = 0; k < 12; k++) out[o + 8 + k] = litOut[k] ? this._transLocal(sx, sz, ci, cj, OUT_OFF[k][0], OUT_OFF[k][1], k0) : 0;
        return;
      }
    } else {
      for (let k = 0; k < 8; k++) {
        out[o + k] = litIn[k] ? this.trans(sx, sz, (ci + IN_OFF[k][0] + 0.5) * CELL, (cj + IN_OFF[k][1] + 0.5) * CELL) : 0;
      }
    }
    for (let k = 0; k < 12; k++) {
      out[o + 8 + k] = litOut[k] ? this.trans(sx, sz, (ci + OUT_OFF[k][0] + 0.5) * CELL, (cj + OUT_OFF[k][1] + 0.5) * CELL) : 0;
    }
  }

  // trans() for a sample inside its origin cell (ci, cj) towards the centre of (ci + di, cj + dj), every
  // crossed edge inside the local arrays (k0 = local index of the origin cell): the same DDA arithmetic
  // without the floors and per-step bounds checks
  _transLocal(sx, sz, ci, cj, di, dj, k0) {
    const dx = (ci + di + 0.5) * CELL - sx, dz = (cj + dj + 0.5) * CELL - sz;
    const adx = Math.abs(dx), adz = Math.abs(dz);
    const tDx = adx > 1e-9 ? CELL / adx : 1e9, tDz = adz > 1e-9 ? CELL / adz : 1e9;
    let tMx = adx > 1e-9 ? (dx > 0 ? (ci + 1) * CELL - sx : sx - ci * CELL) / adx : 1e9;
    let tMz = adz > 1e-9 ? (dz > 0 ? (cj + 1) * CELL - sz : sz - cj * CELL) / adz : 1e9;
    const Wd = this.Wd, tN = this.tN, tW = this.tW;
    const sI = dx > 0 ? 1 : -1, sJ = dz > 0 ? 1 : -1;
    let tr = 1, i = 0, j = 0, k = k0;
    for (let n = 0; n < 10 && (i !== di || j !== dj); n++) {
      if (tMx < tMz) { tr *= tW[sI > 0 ? k + 1 : k]; i += sI; k += sI; tMx += tDx; }
      else { tr *= tN[sJ > 0 ? k + Wd : k]; j += sJ; k += sJ * Wd; tMz += tDz; }
      if (tr < 0.01) return 0;
    }
    return tr;
  }

  // Bake a geometry built by EnvGeo (needs position, normal, aCell, aAO).
  // opts: direct / bounce multipliers (match the material's mix), quant (>= 0.1: detail mesh, vertices in the
  //       same bucket share the whole result), wallAO (corner occlusion for vertical faces)
  bake(geo, opts = {}) {
    const direct = opts.direct ?? 1, bounce = opts.bounce ?? 1;
    const q = opts.quant ?? 0.02;
    const pos = geo.attributes.position.array, nor = geo.attributes.normal.array, cell = geo.attributes.aCell.array;
    const aoA = geo.attributes.aAO.array;
    const n = pos.length / 3;
    const Ta = new Uint8Array(n * 4), Tb = new Uint8Array(n * 4);
    const Oa = new Uint16Array(n * 4), Ob = new Uint16Array(n * 4), Oc = new Uint16Array(n * 4);
    const Os = [Oa, Ob, Oc];
    const k16 = 65535 / OUT_SCALE;
    const coarse = q >= 0.1;
    const fullMaps = coarse ? new Array(256) : null;
    const bx = this.I0 * CELL, bz = this.J0 * CELL;
    // per origin-cell cache: which of the 20 surrounding cells have a fixture
    const litIn = new Uint8Array(8), litOut = new Uint8Array(12), outX = new Float64Array(12), outZ = new Float64Array(12);
    const ET = new Float32Array(n * 2);
    let et0 = 0, et1 = 0;
    let lci = NaN, lcj = NaN;
    // direct-mapped cache of sample points (wall columns, coincident vertices share one DDA pass)
    const RC = 512;
    const rcX = new Float64Array(RC).fill(NaN), rcZ = new Float64Array(RC), rcI = new Int32Array(RC), rcJ = new Int32Array(RC), rcT = new Float32Array(RC * 20);
    for (let v = 0; v < n; v++) {
      const px = pos[v * 3], py = pos[v * 3 + 1], pz = pos[v * 3 + 2];
      const nx = nor[v * 3], ny = nor[v * 3 + 1], nz = nor[v * 3 + 2];
      const sx = px + nx * 0.05, sy = py + ny * 0.05, sz = pz + nz * 0.05;
      const ci = cell[v * 2], cj = cell[v * 2 + 1];
      if (ci !== lci || cj !== lcj) {
        lci = ci; lcj = cj;
        for (let k = 0; k < 8; k++) litIn[k] = this.isLit(ci + IN_OFF[k][0], cj + IN_OFF[k][1]) ? 1 : 0;
        for (let k = 0; k < 12; k++) {
          litOut[k] = this.isLit(ci + OUT_OFF[k][0], cj + OUT_OFF[k][1]) ? 1 : 0;
          outX[k] = (ci + OUT_OFF[k][0] + 0.5) * CELL; outZ[k] = (cj + OUT_OFF[k][1] + 0.5) * CELL;
        }
        [et0, et1] = this.edgeCodes(ci, cj);
      }
      ET[v * 2] = et0; ET[v * 2 + 1] = et1;
      if (coarse) {
        const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
        const nk = ay >= ax && ay >= az ? (ny > 0 ? 0 : 1) : ax >= az ? (nx > 0 ? 2 : 3) : (nz > 0 ? 4 : 5);
        const cl = ((ci - this.I0) * 16 + (cj - this.J0)) & 255;
        const lx = Math.min(511, Math.max(0, Math.round((sx - bx) / q))), lz = Math.min(511, Math.max(0, Math.round((sz - bz) / q)));
        const ly = Math.min(63, Math.max(0, Math.round((sy + 0.5) / q)));
        const key = ((lx * 512 + lz) * 64 + ly) * 8 + nk;
        let fm = fullMaps[cl];
        if (!fm) fm = fullMaps[cl] = new Map();
        const src = fm.get(key);
        if (src !== undefined) {
          const a = v * 4, b = src * 4;
          Ta[a] = Ta[b]; Ta[a + 1] = Ta[b + 1]; Ta[a + 2] = Ta[b + 2]; Ta[a + 3] = Ta[b + 3];
          Tb[a] = Tb[b]; Tb[a + 1] = Tb[b + 1]; Tb[a + 2] = Tb[b + 2]; Tb[a + 3] = Tb[b + 3];
          Oa[a] = Oa[b]; Oa[a + 1] = Oa[b + 1]; Oa[a + 2] = Oa[b + 2]; Oa[a + 3] = Oa[b + 3];
          Ob[a] = Ob[b]; Ob[a + 1] = Ob[b + 1]; Ob[a + 2] = Ob[b + 2]; Ob[a + 3] = Ob[b + 3];
          Oc[a] = Oc[b]; Oc[a + 1] = Oc[b + 1]; Oc[a + 2] = Oc[b + 2]; Oc[a + 3] = Oc[b + 3];
          continue;
        }
        fm.set(key, v);
      }
      // transmissions: cached by exact sample point
      const slot = (Math.imul((sx * 1024) | 0, 73856093) ^ Math.imul((sz * 1024) | 0, 19349663) ^ Math.imul(ci, 83492791) ^ Math.imul(cj, 1640531527)) & (RC - 1);
      if (rcX[slot] !== sx || rcZ[slot] !== sz || rcI[slot] !== ci || rcJ[slot] !== cj) {
        rcX[slot] = sx; rcZ[slot] = sz; rcI[slot] = ci; rcJ[slot] = cj;
        this._transInto(sx, sz, ci, cj, rcT, slot * 20, litIn, litOut);
      }
      const o = slot * 20;
      const a = v * 4;
      Ta[a] = rcT[o] * 255 + 0.5; Ta[a + 1] = rcT[o + 1] * 255 + 0.5; Ta[a + 2] = rcT[o + 2] * 255 + 0.5; Ta[a + 3] = rcT[o + 3] * 255 + 0.5;
      Tb[a] = rcT[o + 4] * 255 + 0.5; Tb[a + 1] = rcT[o + 5] * 255 + 0.5; Tb[a + 2] = rcT[o + 6] * 255 + 0.5; Tb[a + 3] = rcT[o + 7] * 255 + 0.5;
      for (let k = 0; k < 12; k++) {
        let w = 0;
        if (litOut[k]) {
          const t = rcT[o + 8 + k];
          const dx = outX[k] - sx, dy = LY - sy, dz = outZ[k] - sz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < RADIUS * RADIUS) {
            const d = Math.sqrt(d2);
            const e2 = d2 / (RADIUS * RADIUS);
            const fall = (1 - e2 * e2) / (1 + 0.16 * d2);
            const id = 1 / Math.max(d, 1e-3);
            const ndl = Math.max(0, (dx * nx + dy * ny + dz * nz) * id);
            const emit = emitLobe(dy * id);
            w = fall * (ndl * emit * t * direct + 0.5 * (0.35 + 0.65 * t) * bounce);
          }
        }
        const val = w * k16 + 0.5;
        Os[k >> 2][a + (k & 3)] = val > 65535 ? 65535 : val;
      }
      if (opts.wallAO && Math.abs(ny) < 0.5) aoA[v] *= this.wallCornerAO(px, py, pz, nx, nz, ci, cj);
    }
    geo.setAttribute('aTa', new THREE.BufferAttribute(Ta, 4, true));
    geo.setAttribute('aTb', new THREE.BufferAttribute(Tb, 4, true));
    geo.setAttribute('aOa', new THREE.BufferAttribute(Oa, 4, true));
    geo.setAttribute('aOb', new THREE.BufferAttribute(Ob, 4, true));
    geo.setAttribute('aOc', new THREE.BufferAttribute(Oc, 4, true));
    geo.setAttribute('aEdgeT', new THREE.BufferAttribute(ET, 2));
    geo.attributes.aAO.needsUpdate = true;
    return geo;
  }

  // wall types of the 12 edges the 8 inner-ring rays of cell (ci, cj) can cross, packed 3 bits each into two
  // floats for the shader: N, S, W, E edges of the cell, then the second edge of each diagonal path
  // (x-first / z-first per diagonal (-1,-1), (1,-1), (-1,1), (1,1))
  edgeCodes(ci, cj) {
    const N = (i, j) => this.edgeN(i, j), Wt = (i, j) => this.edgeW(i, j);
    const a = [N(ci, cj), N(ci, cj + 1), Wt(ci, cj), Wt(ci + 1, cj), N(ci - 1, cj), Wt(ci, cj - 1)];
    const b = [N(ci + 1, cj), Wt(ci + 1, cj - 1), N(ci - 1, cj + 1), Wt(ci, cj + 1), N(ci + 1, cj + 1), Wt(ci + 1, cj + 1)];
    // bits 18..21: which inner-ring neighbours have a fixture (IN_OFF order), like the baked transmissions
    let x = 0, y = 0;
    for (let q = 3; q >= 0; q--) {
      x = x * 2 + (this.isLit(ci + IN_OFF[q][0], cj + IN_OFF[q][1]) ? 1 : 0);
      y = y * 2 + (this.isLit(ci + IN_OFF[q + 4][0], cj + IN_OFF[q + 4][1]) ? 1 : 0);
    }
    for (let q = 5; q >= 0; q--) { x = x * 8 + (a[q] & 7); y = y * 8 + (b[q] & 7); }
    return [x, y];
  }

  // inside-corner occlusion on a vertical face: perpendicular walls meeting this face within the origin cell
  wallCornerAO(px, py, pz, nx, nz, ci, cj) {
    const x0 = ci * CELL, z0 = cj * CELL;
    let d = 9;
    if (Math.abs(nz) >= Math.abs(nx)) {
      // face runs along x; perpendicular walls are the W edges of (ci, cj) and (ci + 1, cj)
      const S = nz > 0 ? SOLID_START_F : SOLID_END_F; // face sits on the north / south side of its cell
      for (let e = 0; e < 2; e++) {
        const t = this.edgeW(ci + e, cj);
        if (!t || !S[t] || (t === W.LOW && py > 1.05)) continue;
        d = Math.min(d, Math.abs(px - (e ? x0 + CELL - 0.08 : x0 + 0.08)));
      }
    } else {
      const S = nx > 0 ? SOLID_START_F : SOLID_END_F;
      for (let e = 0; e < 2; e++) {
        const t = this.edgeN(ci, cj + e);
        if (!t || !S[t] || (t === W.LOW && py > 1.05)) continue;
        d = Math.min(d, Math.abs(pz - (e ? z0 + CELL - 0.08 : z0 + 0.08)));
      }
    }
    if (d >= 0.9) return 1;
    const a = 1 - smooth(0, 0.55, d);
    return 1 - a * a * 0.38;
  }

  // packed edge types (N, E, S, W) and corner-post half sizes (NW, NE, SE, SW) for analytic plane AO
  edgeInfo(i, j, ceiling = false) {
    const eN = this.edgeN(i, j), eS = this.edgeN(i, j + 1), eW = this.edgeW(i, j), eE = this.edgeW(i + 1, j);
    const packed = eN + 8 * eE + 64 * eS + 512 * eW;
    const S0 = ceiling ? SOLID_START_C : SOLID_START_F, S1 = ceiling ? SOLID_END_C : SOLID_END_F;
    const post = (ci, cj, outsideA, aEnd, outsideB, bEnd) => {
      // pillar at this corner, or a wall arriving from a neighbouring cell
      let s = this.posts.get(this._ck(ci, cj)) || 0;
      const ta = outsideA, tb = outsideB;
      if (ta && (aEnd ? S1[ta] : S0[ta])) s = Math.max(s, 0.1);
      if (tb && (bEnd ? S1[tb] : S0[tb])) s = Math.max(s, 0.1);
      return Math.min(15, Math.round(s / 0.05));
    };
    // NW corner (i, j): N edge of (i-1, j) [ends here], W edge of (i, j-1) [ends here]
    const pNW = post(i, j, this.edgeN(i - 1, j), true, this.edgeW(i, j - 1), true);
    // NE corner (i+1, j): N edge of (i+1, j) [starts here], W edge of (i+1, j-1) [ends here]
    const pNE = post(i + 1, j, this.edgeN(i + 1, j), false, this.edgeW(i + 1, j - 1), true);
    // SE corner (i+1, j+1): N edge of (i+1, j+1) [starts], W edge of (i+1, j+1) [starts]
    const pSE = post(i + 1, j + 1, this.edgeN(i + 1, j + 1), false, this.edgeW(i + 1, j + 1), false);
    // SW corner (i, j+1): N edge of (i-1, j+1) [ends], W edge of (i, j+1) [starts]
    const pSW = post(i, j + 1, this.edgeN(i - 1, j + 1), true, this.edgeW(i, j + 1), false);
    return [packed, pNW + 16 * pNE + 256 * pSE + 4096 * pSW];
  }
}

function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

export { floorDiv };
