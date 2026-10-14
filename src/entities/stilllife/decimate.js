// Still Lifes — fast quadric-error half-edge-collapse decimation for the meshed sculpts.
// Collapsing a vertex onto a neighbour keeps every attribute exact (skin weights, materials,
// colours); costs add penalties for crossing material boundaries so seams stay crisp.
// Multi-pass: each pass collapses independent edges in cost order (bucket sorted), then compacts.

// pos: Float32Array(n*3); idx: Uint32Array|Uint16Array; sig: Float32Array(n*sigN) per-vertex signature
// returns { idx (into original vertex ids remapped by keep), keep: Int32Array old->new or -1, nV, nT }
export function decimate(pos, idx, nV, { target, maxErr = 1e-5, sig = null, sigN = 0, sigW = 2e-5, maxPasses = 14 } = {}) {
  let tri = Uint32Array.from(idx);
  let nT = tri.length / 3;
  const Q = new Float64Array(nV * 10);
  for (let t = 0; t < nT; t++) {
    const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az;
    const vx = pos[c * 3] - ax, vy = pos[c * 3 + 1] - ay, vz = pos[c * 3 + 2] - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l < 1e-14) continue;
    const area = l * 0.5;
    nx /= l; ny /= l; nz /= l;
    const d = -(nx * ax + ny * ay + nz * az);
    for (let k = 0; k < 3; k++) {
      const o = tri[t * 3 + k] * 10;
      Q[o] += nx * nx * area; Q[o + 1] += nx * ny * area; Q[o + 2] += nx * nz * area; Q[o + 3] += nx * d * area;
      Q[o + 4] += ny * ny * area; Q[o + 5] += ny * nz * area; Q[o + 6] += ny * d * area;
      Q[o + 7] += nz * nz * area; Q[o + 8] += nz * d * area; Q[o + 9] += d * d * area;
    }
  }
  const qerr2 = (a, b, x, y, z) => {
    const o = a * 10, p = b * 10;
    const q0 = Q[o] + Q[p], q1 = Q[o + 1] + Q[p + 1], q2 = Q[o + 2] + Q[p + 2], q3 = Q[o + 3] + Q[p + 3], q4 = Q[o + 4] + Q[p + 4];
    const q5 = Q[o + 5] + Q[p + 5], q6 = Q[o + 6] + Q[p + 6], q7 = Q[o + 7] + Q[p + 7], q8 = Q[o + 8] + Q[p + 8], q9 = Q[o + 9] + Q[p + 9];
    return q0 * x * x + 2 * q1 * x * y + 2 * q2 * x * z + 2 * q3 * x + q4 * y * y + 2 * q5 * y * z + 2 * q6 * y + q7 * z * z + 2 * q8 * z + q9;
  };
  const deg = new Int32Array(nV + 1);
  const lock = new Uint8Array(nV), border = new Uint8Array(nV);
  const mark = new Int32Array(nV), cnt = new Int32Array(nV);
  let Ebuf = new Int32Array(nT * 4);
  const NB = 512, lmin = Math.log(1e-12), lspan = Math.log(maxErr) - lmin;
  let passes = 0;
  for (let pass = 0; pass < maxPasses && nT > target; pass++) {
    passes++;
    // vertex -> triangle CSR
    deg.fill(0);
    for (let i = 0; i < nT * 3; i++) deg[tri[i] + 1]++;
    for (let i = 0; i < nV; i++) deg[i + 1] += deg[i];
    const vt = new Int32Array(nT * 3);
    const fill = deg.slice(0, nV);
    for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) { const v = tri[t * 3 + k]; vt[fill[v]++] = t; }
    // unique edges + borders
    mark.fill(-1); border.fill(0);
    let nE = 0;
    for (let v = 0; v < nV; v++) {
      const s = deg[v], e = deg[v + 1];
      if (s === e) continue;
      for (let k = s; k < e; k++) { const t = vt[k]; for (let j = 0; j < 3; j++) { const u = tri[t * 3 + j]; if (u === v) continue; if (mark[u] !== v) { mark[u] = v; cnt[u] = 0; } cnt[u]++; } }
      for (let k = s; k < e; k++) {
        const t = vt[k];
        for (let j = 0; j < 3; j++) {
          const u = tri[t * 3 + j];
          if (u === v || mark[u] !== v) continue;
          if (cnt[u] === 1) border[u] = border[v] = 1;
          mark[u] = -2 - v; // consumed
          if (u > v) { if (nE * 2 + 2 > Ebuf.length) { const nb = new Int32Array(Ebuf.length * 2); nb.set(Ebuf); Ebuf = nb; } Ebuf[nE * 2] = v; Ebuf[nE * 2 + 1] = u; nE++; }
        }
      }
    }
    const cost = new Float64Array(nE), dirAB = new Uint8Array(nE), eb = new Int32Array(nE);
    const bc = new Int32Array(NB + 2);
    for (let e = 0; e < nE; e++) {
      const a = Ebuf[e * 2], b = Ebuf[e * 2 + 1];
      let c, dir;
      if (border[a] && border[b]) { c = Infinity; dir = 1; }
      else {
        let sd = 0;
        if (sig) for (let k = 0; k < sigN; k++) { const d = sig[a * sigN + k] - sig[b * sigN + k]; sd += d * d; }
        sd *= sigW;
        const cab = border[a] ? Infinity : qerr2(a, b, pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]) + sd;
        const cba = border[b] ? Infinity : qerr2(a, b, pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]) + sd;
        if (cab <= cba) { c = cab; dir = 1; } else { c = cba; dir = 0; }
      }
      cost[e] = c; dirAB[e] = dir;
      const bk = !(c < maxErr) ? NB : c <= 1e-12 ? 0 : Math.min(NB - 1, Math.floor(((Math.log(c) - lmin) / lspan) * (NB - 1)) + 1);
      eb[e] = bk; bc[bk + 1]++;
    }
    for (let k = 0; k <= NB; k++) bc[k + 1] += bc[k];
    const order = new Int32Array(nE);
    const bf = bc.slice(0, NB + 1);
    for (let e = 0; e < nE; e++) order[bf[eb[e]]++] = e;
    lock.fill(0);
    let removedT = 0;
    const want = nT - target;
    const live = new Uint8Array(nT).fill(1);
    for (let oi = 0; oi < nE && removedT < want; oi++) {
      const e = order[oi];
      if (eb[e] >= NB) break;
      let a = Ebuf[e * 2], b = Ebuf[e * 2 + 1];
      if (!dirAB[e]) { const t = a; a = b; b = t; }
      if (lock[a] || lock[b]) continue;
      const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
      let ok = true, shared = 0;
      for (let k = deg[a]; k < deg[a + 1]; k++) {
        const t = vt[k];
        if (!live[t]) continue;
        const i0 = tri[t * 3], i1 = tri[t * 3 + 1], i2 = tri[t * 3 + 2];
        if (i0 === b || i1 === b || i2 === b) { shared++; continue; }
        const p0x = pos[i0 * 3], p0y = pos[i0 * 3 + 1], p0z = pos[i0 * 3 + 2];
        const p1x = pos[i1 * 3], p1y = pos[i1 * 3 + 1], p1z = pos[i1 * 3 + 2];
        const p2x = pos[i2 * 3], p2y = pos[i2 * 3 + 1], p2z = pos[i2 * 3 + 2];
        const n0 = (p1y - p0y) * (p2z - p0z) - (p1z - p0z) * (p2y - p0y), n1 = (p1z - p0z) * (p2x - p0x) - (p1x - p0x) * (p2z - p0z), n2 = (p1x - p0x) * (p2y - p0y) - (p1y - p0y) * (p2x - p0x);
        const q0x = i0 === a ? bx : p0x, q0y = i0 === a ? by : p0y, q0z = i0 === a ? bz : p0z;
        const q1x = i1 === a ? bx : p1x, q1y = i1 === a ? by : p1y, q1z = i1 === a ? bz : p1z;
        const q2x = i2 === a ? bx : p2x, q2y = i2 === a ? by : p2y, q2z = i2 === a ? bz : p2z;
        const ux = q1x - q0x, uy = q1y - q0y, uz = q1z - q0z, wx = q2x - q0x, wy = q2y - q0y, wz = q2z - q0z;
        const m0 = uy * wz - uz * wy, m1 = uz * wx - ux * wz, m2 = ux * wy - uy * wx;
        const ln = Math.sqrt(n0 * n0 + n1 * n1 + n2 * n2), lm = Math.sqrt(m0 * m0 + m1 * m1 + m2 * m2);
        if (lm < 1e-14 || n0 * m0 + n1 * m1 + n2 * m2 < 0.4 * ln * lm) { ok = false; break; }
        const e1 = ux * ux + uy * uy + uz * uz, e2 = wx * wx + wy * wy + wz * wz, e3 = (wx - ux) ** 2 + (wy - uy) ** 2 + (wz - uz) ** 2;
        if (lm * 0.5 < 0.07 * Math.max(e1, e2, e3)) { ok = false; break; }
      }
      if (!ok || shared === 0) continue;
      for (let k = deg[a]; k < deg[a + 1]; k++) {
        const t = vt[k];
        if (!live[t]) continue;
        const i0 = tri[t * 3], i1 = tri[t * 3 + 1], i2 = tri[t * 3 + 2];
        if (i0 === b || i1 === b || i2 === b) { live[t] = 0; removedT++; continue; }
        if (i0 === a) tri[t * 3] = b; else if (i1 === a) tri[t * 3 + 1] = b; else if (i2 === a) tri[t * 3 + 2] = b;
      }
      for (let k = 0; k < 10; k++) Q[b * 10 + k] += Q[a * 10 + k];
      // a is gone and b's triangle list is now stale: lock both for the rest of this pass
      lock[a] = lock[b] = 1;
    }
    if (removedT === 0) break;
    let w = 0;
    for (let t = 0; t < nT; t++) {
      if (!live[t]) continue;
      const i0 = tri[t * 3], i1 = tri[t * 3 + 1], i2 = tri[t * 3 + 2];
      if (i0 === i1 || i1 === i2 || i0 === i2) continue;
      tri[w * 3] = i0; tri[w * 3 + 1] = i1; tri[w * 3 + 2] = i2; w++;
    }
    nT = w;
  }
  tri = tri.subarray(0, nT * 3);
  const keep = new Int32Array(nV).fill(-1);
  let n = 0;
  for (let i = 0; i < tri.length; i++) { const v = tri[i]; if (keep[v] < 0) keep[v] = n++; }
  const out = new Uint32Array(tri.length);
  for (let i = 0; i < tri.length; i++) out[i] = keep[tri[i]];
  return { idx: out, keep, nV: n, nT, passes };
}
