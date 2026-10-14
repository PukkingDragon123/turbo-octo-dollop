// Still Lifes — sparse surface nets: meshes a Sculpt's zero level set on a narrow band of bricks,
// projects vertices onto the surface, takes normals from the field gradient, bakes SDF ambient
// occlusion and evaluates the sculpt's attributes (materials, colour, skin weights) per vertex.
import { evalD, evalAttr, makeAttrOut, NMAT } from './sdf.js';
import { decimate } from './decimate.js';

const EA = Int8Array.from([0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3]), EB = Int8Array.from([1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7]);
const CX = Float64Array.from([0, 1, 0, 1, 0, 1, 0, 1]), CY = Float64Array.from([0, 0, 1, 1, 0, 0, 1, 1]), CZ = Float64Array.from([0, 0, 0, 0, 1, 1, 1, 1]);

let _F = null, _CV = null;

export function meshRaw(S, opts = {}) {
  const h = opts.h ?? 0.012, B = 4, pad = opts.pad ?? 0.04;
  const t0 = performance.now();
  S.compile();
  const min = [S.bmin[0] - pad, S.bmin[1] - pad, S.bmin[2] - pad];
  const max = [S.bmax[0] + pad, S.bmax[1] + pad, S.bmax[2] + pad];
  if (opts.clip) for (let a = 0; a < 3; a++) { min[a] = Math.max(min[a], opts.clip[0][a]); max[a] = Math.min(max[a], opts.clip[1][a]); }
  const nbx = Math.ceil((max[0] - min[0]) / (h * B)), nby = Math.ceil((max[1] - min[1]) / (h * B)), nbz = Math.ceil((max[2] - min[2]) / (h * B));
  const nx = nbx * B, ny = nby * B, nz = nbz * B;
  const cx = nx + 1, cy = ny + 1, cz = nz + 1;
  const SB = 2; // bricks per list cell
  const cs = h * B * SB;
  const margin = Math.max(0.09, h * B * 2.2);
  S.buildLists(min, [min[0] + nx * h, min[1] + ny * h, min[2] + nz * h], cs, margin);
  const L = S.L, P = S.P;
  const nC = cx * cy * cz;
  if (!_F || _F.length < nC) _F = new Float32Array(Math.ceil(nC * 1.2));
  const F = _F; F.fill(NaN, 0, nC);
  const nCell = nx * ny * nz;
  if (!_CV || _CV.length < nCell) _CV = new Int32Array(Math.ceil(nCell * 1.2));
  const CV = _CV; CV.fill(-1, 0, nCell);
  const brickR = h * B * 0.866;
  const thr = brickR * 1.25 + (opts.noiseMargin ?? 0.012);
  const active = [];
  let nEval = 0;
  const t1 = performance.now();
  for (let bk = 0; bk < nbz; bk++) for (let bj = 0; bj < nby; bj++) for (let bi = 0; bi < nbx; bi++) {
    const x = min[0] + (bi * B + B / 2) * h, y = min[1] + (bj * B + B / 2) * h, z = min[2] + (bk * B + B / 2) * h;
    const lc = (Math.floor(bk / SB) * L.ny + Math.floor(bj / SB)) * L.nx + Math.floor(bi / SB);
    const d = evalD(P, L.list, L.off[lc], L.off[lc + 1], x, y, z);
    nEval++;
    if (Math.abs(d) > thr) continue;
    active.push(bi, bj, bk, lc);
    const s = L.off[lc], e = L.off[lc + 1];
    for (let k = bk * B; k <= bk * B + B; k++) for (let j = bj * B; j <= bj * B + B; j++) {
      let ci = (k * cy + j) * cx + bi * B;
      const yy = min[1] + j * h, zz = min[2] + k * h;
      for (let i = bi * B; i <= bi * B + B; i++, ci++) {
        if (F[ci] === F[ci]) continue; // already evaluated (not NaN)
        F[ci] = evalD(P, L.list, s, e, min[0] + i * h, yy, zz);
        nEval++;
      }
    }
  }
  const t2 = performance.now();
  // ---- vertices
  let pos = new Float32Array(65536 * 3), cellOf = new Int32Array(65536), nV = 0;
  const cv = new Float64Array(8);
  const cx1 = cx, cxy = cx * cy;
  const COFF = [0, 1, cx1, cx1 + 1, cxy, cxy + 1, cxy + cx1, cxy + cx1 + 1];
  for (let a = 0; a < active.length; a += 4) {
    const bi = active[a], bj = active[a + 1], bk = active[a + 2];
    for (let k = bk * B; k < bk * B + B; k++) for (let j = bj * B; j < bj * B + B; j++) for (let i = bi * B; i < bi * B + B; i++) {
      const base = (k * cy + j) * cx + i;
      let mask = 0, bad = false;
      for (let c = 0; c < 8; c++) {
        const v = F[base + COFF[c]];
        cv[c] = v;
        if (v !== v) bad = true;
        else if (v < 0) mask |= 1 << c;
      }
      if (mask === 0 || mask === 255 || bad) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (let q = 0; q < 12; q++) {
        const c0 = EA[q], c1 = EB[q];
        if (((mask >> c0) & 1) === ((mask >> c1) & 1)) continue;
        const t = cv[c0] / (cv[c0] - cv[c1]);
        sx += CX[c0] + (CX[c1] - CX[c0]) * t;
        sy += CY[c0] + (CY[c1] - CY[c0]) * t;
        sz += CZ[c0] + (CZ[c1] - CZ[c0]) * t;
        n++;
      }
      if (nV * 3 + 3 > pos.length) { const p2 = new Float32Array(pos.length * 2); p2.set(pos); pos = p2; const c2 = new Int32Array(cellOf.length * 2); c2.set(cellOf); cellOf = c2; }
      pos[nV * 3] = min[0] + (i + sx / n) * h; pos[nV * 3 + 1] = min[1] + (j + sy / n) * h; pos[nV * 3 + 2] = min[2] + (k + sz / n) * h;
      const cell = (k * ny + j) * nx + i;
      cellOf[nV] = cell;
      CV[cell] = nV++;
    }
  }
  // ---- faces
  let idxA = new Uint32Array(nV * 12 + 64), nI = 0;
  const push6 = (a, b, c, d, e, f) => { if (nI + 6 > idxA.length) { const t = new Uint32Array(idxA.length * 2); t.set(idxA); idxA = t; } idxA[nI++] = a; idxA[nI++] = b; idxA[nI++] = c; idxA[nI++] = d; idxA[nI++] = e; idxA[nI++] = f; };
  for (let v = 0; v < nV; v++) {
    const cell = cellOf[v];
    const i = cell % nx, j = Math.floor(cell / nx) % ny, k = Math.floor(cell / (nx * ny));
    const f0 = F[(k * cy + j) * cx + i];
    const in0 = f0 < 0;
    // edges from corner (i,j,k) along +x, +y, +z
    for (let ax = 0; ax < 3; ax++) {
      const f1 = ax === 0 ? F[(k * cy + j) * cx + i + 1] : ax === 1 ? F[(k * cy + j + 1) * cx + i] : F[((k + 1) * cy + j) * cx + i];
      if ((f1 < 0) === in0) continue;
      // the two other axes
      const u = (ax + 1) % 3, w = (ax + 2) % 3;
      const du = u === 0 ? 1 : u === 1 ? nx : nx * ny, dw = w === 0 ? 1 : w === 1 ? nx : nx * ny;
      const cu = u === 0 ? i : u === 1 ? j : k, cw = w === 0 ? i : w === 1 ? j : k;
      if (cu === 0 || cw === 0) continue;
      const a0 = CV[cell], a1 = CV[cell - du], a2 = CV[cell - du - dw], a3 = CV[cell - dw];
      if (a0 < 0 || a1 < 0 || a2 < 0 || a3 < 0) continue;
      // split along the shorter diagonal
      const d02 = dist2(pos, a0, a2), d13 = dist2(pos, a1, a3);
      if (in0) {
        if (d02 < d13) push6(a0, a1, a2, a0, a2, a3); else push6(a0, a1, a3, a1, a2, a3);
      } else {
        if (d02 < d13) push6(a0, a2, a1, a0, a3, a2); else push6(a0, a3, a1, a1, a3, a2);
      }
    }
  }
  const idx = idxA.subarray(0, nI);
  const t3 = performance.now();
  // ---- refine: one projection onto the surface along the gradient; normals from the gradient
  let nor = new Float32Array(nV * 3);
  const eps = h * 0.3;
  for (let v = 0; v < nV; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const c = S.cellOf(x, y, z), s = L.off[c], e = L.off[c + 1];
    const f1 = evalD(P, L.list, s, e, x + eps, y - eps, z - eps);
    const f2 = evalD(P, L.list, s, e, x - eps, y - eps, z + eps);
    const f3 = evalD(P, L.list, s, e, x - eps, y + eps, z - eps);
    const f4 = evalD(P, L.list, s, e, x + eps, y + eps, z + eps);
    let gx = f1 - f2 - f3 + f4, gy = -f1 - f2 + f3 + f4, gz = -f1 + f2 - f3 + f4;
    const gl = Math.hypot(gx, gy, gz) || 1;
    gx /= gl; gy /= gl; gz /= gl;
    nor[v * 3] = gx; nor[v * 3 + 1] = gy; nor[v * 3 + 2] = gz;
    let dd = (f1 + f2 + f3 + f4) * 0.25;
    if (dd > h * 0.5) dd = h * 0.5; else if (dd < -h * 0.5) dd = -h * 0.5;
    pos[v * 3] = x - gx * dd; pos[v * 3 + 1] = y - gy * dd; pos[v * 3 + 2] = z - gz * dd;
  }
  const t4 = performance.now();
  // ---- attributes (materials, colour, dirt/thin/wet, skin weights)
  const nb = S.boneNames.length;
  const out = makeAttrOut(nb);
  let mats = new Float32Array(nV * NMAT), cols = new Float32Array(nV * 3), misc = new Float32Array(nV * 3);
  let skinI = new Uint16Array(nV * 4), skinW = new Float32Array(nV * 4);
  const top = [0, 0, 0, 0], topW = [0, 0, 0, 0];
  for (let v = 0; v < nV; v++) {
    evalAttr(S, pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], out);
    for (let q = 0; q < NMAT; q++) mats[v * NMAT + q] = out.mat[q];
    cols[v * 3] = out.col[0]; cols[v * 3 + 1] = out.col[1]; cols[v * 3 + 2] = out.col[2];
    misc[v * 3] = out.dirt; misc[v * 3 + 1] = out.thin; misc[v * 3 + 2] = out.wet;
    topW.fill(0); top.fill(0);
    const bw = out.bw;
    for (let b = 0; b < nb; b++) {
      const w = bw[b];
      if (w <= topW[3]) continue;
      let q = 3;
      while (q > 0 && topW[q - 1] < w) { topW[q] = topW[q - 1]; top[q] = top[q - 1]; q--; }
      topW[q] = w; top[q] = b;
    }
    let sum = topW[0] + topW[1] + topW[2] + topW[3];
    if (sum <= 0) { topW[0] = 1; sum = 1; }
    for (let q = 0; q < 4; q++) { skinI[v * 4 + q] = top[q]; skinW[v * 4 + q] = topW[q] / sum; }
  }
  const t5 = performance.now();
  pos = pos.slice(0, nV * 3);
  const stats = { nT0: idx.length / 3, grid: [nx, ny, nz], bricks: active.length / 4, evals: nEval, ms: { lists: t1 - t0, field: t2 - t1, mesh: t3 - t2, refine: t4 - t3, attr: t5 - t4 } };
  return { nV, pos, nor, idx: Uint32Array.from(idx), mats, cols, misc, skinI, skinW, stats, L: S.L, h };
}

// decimate (quadric error, material-aware) to `tris`, then bake field AO on the survivors
export function finishMesh(S, raw, opts = {}) {
  const t5 = performance.now();
  const h = raw.h;
  let { nV, pos, nor, mats, cols, misc, skinI, skinW } = raw;
  let index = raw.idx, nOut = nV;
  if (opts.tris && index.length / 3 > opts.tris) {
    const SN = 7, sig = new Float32Array(nV * SN);
    for (let v = 0; v < nV; v++) {
      for (let q = 0; q < NMAT; q++) sig[v * SN + q] = mats[v * NMAT + q];
      sig[v * SN + 5] = misc[v * 3 + 1]; sig[v * SN + 6] = misc[v * 3 + 2];
    }
    const D = decimate(pos, index, nV, { target: opts.tris, maxErr: Math.pow(h * (opts.errScale ?? 0.42), 2), sig, sigN: SN, sigW: h * h * 0.6 });
    const keep = D.keep;
    nOut = D.nV;
    const pick = (arr, w) => { const o = new arr.constructor(nOut * w); for (let v = 0; v < nV; v++) { const k = keep[v]; if (k < 0) continue; for (let q = 0; q < w; q++) o[k * w + q] = arr[v * w + q]; } return o; };
    pos = pick(pos, 3); nor = pick(nor, 3); mats = pick(mats, NMAT); cols = pick(cols, 3); misc = pick(misc, 3); skinI = pick(skinI, 4); skinW = pick(skinW, 4);
    index = D.idx;
  }
  const t6 = performance.now();
  // ---- ambient occlusion from the field (cavities, creases, armpits)
  S.L = raw.L;
  const L = raw.L, P = S.P;
  const ao = new Float32Array(nOut);
  const AOD = opts.aoDist || [0.01, 0.025, 0.05, 0.09];
  const AOW = [0.55, 0.32, 0.2, 0.12];
  for (let v = 0; v < nOut; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2], gx = nor[v * 3], gy = nor[v * 3 + 1], gz = nor[v * 3 + 2];
    let occ = 0;
    for (let q = 0; q < AOD.length; q++) {
      const dd = AOD[q];
      const sx = x + gx * dd, sy = y + gy * dd, sz = z + gz * dd;
      const c = S.cellOf(sx, sy, sz);
      const f = evalD(P, L.list, L.off[c], L.off[c + 1], sx, sy, sz);
      occ += AOW[q] * Math.max(0, dd - f) / dd;
    }
    ao[v] = Math.max(0, 1 - occ * 1.15);
  }
  const t7 = performance.now();
  const stats = { ...raw.stats, nV: nOut, nT: index.length / 3 };
  stats.ms = { ...raw.stats.ms, decim: t6 - t5, ao: t7 - t6 };
  return { nV: nOut, pos, nor, idx: index, ao, mats, cols, misc, skinI, skinW, stats };
}

export function meshSculpt(S, opts = {}) { return finishMesh(S, meshRaw(S, opts), opts); }

// Split a sculpt's union primitives into spatially separate clusters (non-overlapping boxes),
// so far-apart parts (two hands, scattered limbs) mesh on small grids of their own.
export function clusterBoxes(S, pad) {
  S.compile();
  const P = S.P, n = S.prims.length;
  const boxes = [];
  for (let i = 0; i < n; i++) {
    if (P[i * 48 + 1] !== 0) continue;
    const c = [P[i * 48 + 44], P[i * 48 + 45], P[i * 48 + 46]], r = P[i * 48 + 47] + P[i * 48 + 2] + pad;
    boxes.push([[c[0] - r, c[1] - r, c[2] - r], [c[0] + r, c[1] + r, c[2] + r]]);
  }
  const ov = (a, b) => a[0][0] <= b[1][0] && b[0][0] <= a[1][0] && a[0][1] <= b[1][1] && b[0][1] <= a[1][1] && a[0][2] <= b[1][2] && b[0][2] <= a[1][2];
  let cl = boxes.map((b) => [b[0].slice(), b[1].slice()]);
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) {
      if (!ov(cl[i], cl[j])) continue;
      for (let a = 0; a < 3; a++) { cl[i][0][a] = Math.min(cl[i][0][a], cl[j][0][a]); cl[i][1][a] = Math.max(cl[i][1][a], cl[j][1][a]); }
      cl.splice(j, 1); changed = true; break outer;
    }
  }
  return cl;
}

function dist2(p, a, b) {
  const dx = p[a * 3] - p[b * 3], dy = p[a * 3 + 1] - p[b * 3 + 1], dz = p[a * 3 + 2] - p[b * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}

// march from p along dir to the surface (sphere tracing); returns {p, n} or null
export function traceSurface(S, p, dir, maxD = 1.0) {
  const l = Math.hypot(dir[0], dir[1], dir[2]);
  const dx = dir[0] / l, dy = dir[1] / l, dz = dir[2] / l;
  let t = 0, prev = S.d(p[0], p[1], p[2]);
  const sgn = prev < 0 ? -1 : 1;
  for (let i = 0; i < 160 && t < maxD; i++) {
    const x = p[0] + dx * t, y = p[1] + dy * t, z = p[2] + dz * t;
    const d = S.d(x, y, z);
    if (Math.abs(d) < 0.0004 || d * sgn < 0) {
      // refine by bisection between t-step and t
      let a = Math.max(0, t - Math.abs(prev) - 0.002), b = t;
      for (let k = 0; k < 18; k++) { const m = (a + b) / 2; const dm = S.d(p[0] + dx * m, p[1] + dy * m, p[2] + dz * m); if (dm * sgn > 0) a = m; else b = m; }
      const q = [p[0] + dx * b, p[1] + dy * b, p[2] + dz * b];
      return { p: q, n: gradient(S, q) };
    }
    t += Math.max(Math.abs(d) * 0.8, 0.0015);
    prev = d;
  }
  return null;
}
export function gradient(S, q, eps = 0.002) {
  const x = q[0], y = q[1], z = q[2];
  const gx = S.d(x + eps, y, z) - S.d(x - eps, y, z);
  const gy = S.d(x, y + eps, z) - S.d(x, y - eps, z);
  const gz = S.d(x, y, z + eps) - S.d(x, y, z - eps);
  const l = Math.hypot(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l];
}
// project a point onto the surface (Newton steps along the gradient)
export function projectSurface(S, q, iters = 6) {
  let x = q[0], y = q[1], z = q[2];
  for (let i = 0; i < iters; i++) {
    const d = S.d(x, y, z);
    const g = gradient(S, [x, y, z]);
    x -= g[0] * d; y -= g[1] * d; z -= g[2] * d;
    if (Math.abs(d) < 1e-4) break;
  }
  return { p: [x, y, z], n: gradient(S, [x, y, z]) };
}
