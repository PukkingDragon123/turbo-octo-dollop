// R.O.O.M. items — geometry kit, template finishing, caching and the item registry.
//
// Every item is assembled from procedural parts in a Kit, merged by material at template time and
// instanced cheaply (Group + 1–4 Meshes sharing cached geometry / materials).
//
// Vertex layout of every part: position, normal, uv (print atlas), uv1 (tiling surface detail, in detail
// tiles: see mats.js), color (tint x baked cavity occlusion).
//
// Conventions (unchanged from the original library):
//   * meters, Y up; origin = centre of the visual bounds (= physics body origin)
//   * "business end" / forward = -Z; printed labels generally face +Z / +Y (toward the player / camera)
//   * colliders: convex primitives relative to the origin (cylinder / capsule axis = Y before `rot`)
//   * halfHeight: origin -> lowest collider point in the built (resting) orientation
//   * hold = transform of `object` under a first-person right-hand anchor (palm centre, camera aligned, -Z fwd)
//   * parts = named meshes for runtime state (materials cloned per instance)
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const PI = Math.PI, TAU = Math.PI * 2;
export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const hash = (x) => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------
const _eu = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
export function mtx(o = {}, out = new THREE.Matrix4()) {
  _eu.set(o.r?.[0] || 0, o.r?.[1] || 0, o.r?.[2] || 0, o.order || 'XYZ');
  _q.setFromEuler(_eu);
  const s = o.s ?? 1;
  if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
  _p.set(o.p?.[0] || 0, o.p?.[1] || 0, o.p?.[2] || 0);
  return out.compose(_p, _q, _s);
}

// ---------------------------------------------------------------------------
// 2D profiles with fillets (for lathes, sweeps and extrusions)
// pts: [[x, y, f]] with f > 0 = fillet radius at that corner, f === 0 / 's' = hard edge, undefined = smooth vertex
// returns [[x, y, hard]]
// ---------------------------------------------------------------------------
export function fillet(pts, o = {}) {
  const out = [];
  const n = pts.length;
  const step = o.step ?? 0.24;
  for (let i = 0; i < n; i++) {
    const [x, y, f] = pts[i];
    const hard = f === 's' || f === 0 || f === true;
    if (i === 0 || i === n - 1 || !(typeof f === 'number' && f > 0)) { out.push([x, y, hard && i > 0 && i < n - 1]); continue; }
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i + 1];
    let ux = ax - x, uy = ay - y, vx = bx - x, vy = by - y;
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (lu < 1e-9 || lv < 1e-9) { out.push([x, y, false]); continue; }
    ux /= lu; uy /= lu; vx /= lv; vy /= lv;
    const ang = Math.acos(clamp(ux * vx + uy * vy, -1, 1));
    if (ang > PI - 0.02) { out.push([x, y, false]); continue; }
    const half = ang / 2;
    let r = f, t = r / Math.tan(half);
    const tmax = Math.min(lu, lv) * (o.share ?? 0.5);
    if (t > tmax) { t = tmax; r = t * Math.tan(half); }
    let bxs = ux + vx, bys = uy + vy;
    const lb = Math.hypot(bxs, bys); bxs /= lb; bys /= lb;
    const d = r / Math.sin(half);
    const cx = x + bxs * d, cy = y + bys * d;
    const a1 = Math.atan2(y + uy * t - cy, x + ux * t - cx), a2 = Math.atan2(y + vy * t - cy, x + vx * t - cx);
    let da = a2 - a1;
    while (da > PI) da -= TAU;
    while (da < -PI) da += TAU;
    const segs = Math.max(2, Math.ceil(Math.abs(da) / step));
    for (let k = 0; k <= segs; k++) { const a = a1 + (da * k) / segs; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, false]); }
  }
  return out;
}

// Closed rounded polygon -> THREE.Shape (fillet radius per corner or one radius for all)
export function roundedPts(pts, r = 0, o = {}) {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n], cur = pts[i], next = pts[(i + 1) % n];
    const f = cur[2] ?? r;
    const seg = fillet([[prev[0], prev[1]], [cur[0], cur[1], f], [next[0], next[1]]], o);
    out.push(...seg.slice(1, -1).map((p) => [p[0], p[1]]));
  }
  return out;
}
export function roundedShape(pts, r = 0, o = {}) {
  const sh = new THREE.Shape();
  roundedPts(pts, r, o).forEach(([x, y], k) => (k ? sh.lineTo(x, y) : sh.moveTo(x, y)));
  sh.closePath();
  return sh;
}
export function roundedPath(pts, r = 0, o = {}) {
  const sh = new THREE.Path();
  roundedPts(pts, r, o).forEach(([x, y], k) => (k ? sh.lineTo(x, y) : sh.moveTo(x, y)));
  sh.closePath();
  return sh;
}

export function rrectShape(w, h, r, cx = 0, cy = 0) {
  const s = new THREE.Shape();
  const x0 = cx - w / 2, y0 = cy - h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x0 + r, y0);
  s.lineTo(x0 + w - r, y0); s.absarc(x0 + w - r, y0 + r, r, -PI / 2, 0, false);
  s.lineTo(x0 + w, y0 + h - r); s.absarc(x0 + w - r, y0 + h - r, r, 0, PI / 2, false);
  s.lineTo(x0 + r, y0 + h); s.absarc(x0 + r, y0 + h - r, r, PI / 2, PI, false);
  s.lineTo(x0, y0 + r); s.absarc(x0 + r, y0 + r, r, PI, PI * 1.5, false);
  return s;
}
export function rrectPath(w, h, r, cx = 0, cy = 0, clockwise = true) {
  const s = new THREE.Path();
  const x0 = cx - w / 2, y0 = cy - h / 2;
  r = Math.min(r, w / 2, h / 2);
  if (clockwise) {
    s.moveTo(x0 + r, y0); s.absarc(x0 + r, y0 + r, r, PI * 1.5, PI, true);
    s.lineTo(x0, y0 + h - r); s.absarc(x0 + r, y0 + h - r, r, PI, PI / 2, true);
    s.lineTo(x0 + w - r, y0 + h); s.absarc(x0 + w - r, y0 + h - r, r, PI / 2, 0, true);
    s.lineTo(x0 + w, y0 + r); s.absarc(x0 + w - r, y0 + r, r, 0, -PI / 2, true);
  } else {
    s.moveTo(x0 + r, y0); s.lineTo(x0 + w - r, y0); s.absarc(x0 + w - r, y0 + r, r, -PI / 2, 0, false);
    s.lineTo(x0 + w, y0 + h - r); s.absarc(x0 + w - r, y0 + h - r, r, 0, PI / 2, false);
    s.lineTo(x0 + r, y0 + h); s.absarc(x0 + r, y0 + h - r, r, PI / 2, PI, false);
    s.lineTo(x0, y0 + r); s.absarc(x0 + r, y0 + r, r, PI, PI * 1.5, false);
  }
  return s;
}
export function circlePath(cx, cy, r, clockwise = true) {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, TAU, clockwise);
  return p;
}

// ---------------------------------------------------------------------------
// Lathe (indexed) with hard edges, arc-length V, metric cylindrical detail UVs and optional radial modulation.
// prof: [[r, y, hard]] bottom -> top for an outward surface (top -> bottom for an inner wall)
// o: { seg, phi0, phiLen, dm (detail tile meters), rmod(phi, y, r) -> r, ymod(phi, y, r) -> y }
// ---------------------------------------------------------------------------
export function latheGeo(prof, o = {}) {
  const seg = o.seg ?? 32, phi0 = o.phi0 ?? 0, phiLen = o.phiLen ?? TAU;
  const P = [];
  for (const p of prof) { const r = Math.max(p[0], 0); P.push([r, p[1]]); if (p[2]) P.push([r, p[1]]); }
  const n = P.length;
  const sn = [];
  for (let j = 0; j < n - 1; j++) sn.push([P[j + 1][1] - P[j][1], -(P[j + 1][0] - P[j][0])]);
  const N = [];
  for (let j = 0; j < n; j++) {
    const a = sn[j - 1], b = sn[j];
    let x = (a ? a[0] : 0) + (b ? b[0] : 0), y = (a ? a[1] : 0) + (b ? b[1] : 0);
    if (Math.hypot(x, y) < 1e-12) { const c = a && Math.hypot(a[0], a[1]) > 1e-12 ? a : b || a; x = c ? c[0] : 1; y = c ? c[1] : 0; }
    const l = Math.hypot(x, y) || 1;
    N.push([x / l, y / l]);
  }
  const S = [0];
  for (let j = 1; j < n; j++) S.push(S[j - 1] + Math.hypot(P[j][0] - P[j - 1][0], P[j][1] - P[j - 1][1]));
  const Stot = S[n - 1] || 1;
  let rmax = 0;
  for (const p of P) rmax = Math.max(rmax, p[0]);
  const dm = o.dm ?? 0.02;
  const full = Math.abs(phiLen - TAU) < 1e-6;
  const K = full ? Math.max(1, Math.round((TAU * rmax) / dm)) : (phiLen * rmax) / dm;
  const pos = new Float32Array((seg + 1) * n * 3), nrm = new Float32Array((seg + 1) * n * 3);
  const uv = new Float32Array((seg + 1) * n * 2), uv1 = new Float32Array((seg + 1) * n * 2);
  let k = 0, q = 0;
  for (let i = 0; i <= seg; i++) {
    const f = i / seg, phi = phi0 + f * phiLen;
    const sn2 = Math.sin(phi), cs = Math.cos(phi);
    for (let j = 0; j < n; j++) {
      let r = P[j][0], y = P[j][1];
      if (o.rmod) r = o.rmod(phi, y, r, j);
      if (o.ymod) y = o.ymod(phi, y, r, j);
      pos[k] = r * sn2; pos[k + 1] = y; pos[k + 2] = r * cs;
      nrm[k] = N[j][0] * sn2; nrm[k + 1] = N[j][1]; nrm[k + 2] = N[j][0] * cs;
      k += 3;
      uv[q] = f; uv[q + 1] = S[j] / Stot;
      uv1[q] = (full ? f * K : f * K); uv1[q + 1] = S[j] / dm;
      q += 2;
    }
  }
  const idx = [];
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < n - 1; j++) {
      const a = j + i * n, b = a + n, c = b + 1, d = a + 1;
      if (P[j][0] < 1e-7 && P[j + 1][0] < 1e-7) continue;
      if (Math.abs(P[j][0] - P[j + 1][0]) < 1e-9 && Math.abs(P[j][1] - P[j + 1][1]) < 1e-9) continue; // hard-edge seam
      idx.push(a, b, d, c, d, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
  g.setIndex(idx);
  if (o.rmod || o.ymod) {
    g.computeVertexNormals();
    if (full) { // weld the seam normals
      const na = g.attributes.normal;
      for (let j = 0; j < n; j++) {
        const a = j, b = seg * n + j;
        const x = na.getX(a) + na.getX(b), y = na.getY(a) + na.getY(b), z = na.getZ(a) + na.getZ(b);
        const l = Math.hypot(x, y, z) || 1;
        na.setXYZ(a, x / l, y / l, z / l); na.setXYZ(b, x / l, y / l, z / l);
      }
    }
  }
  g.userData.lathe = { n, seg };
  return g;
}

// Parametric sheet (indexed, smooth). f(u, v) -> [x, y, z]; optional metric detail coordinates.
export function sheetGeo(nu, nv, f, o = {}) {
  const pos = [], uvs = [], idx = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv;
      pos.push(...f(u, v));
      uvs.push(u, v);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      if (o.flip) idx.push(a, d, b, a, c, d); else idx.push(a, b, d, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (o.wrapU) { // weld normals across the u seam (closed sections)
    const na = g.attributes.normal;
    for (let j = 0; j <= nv; j++) {
      const a = j * (nu + 1), b = a + nu;
      const x = na.getX(a) + na.getX(b), y = na.getY(a) + na.getY(b), z = na.getZ(a) + na.getZ(b);
      const l = Math.hypot(x, y, z) || 1;
      na.setXYZ(a, x / l, y / l, z / l); na.setXYZ(b, x / l, y / l, z / l);
    }
  }
  if (o.poles) { // collapse-to-point ends: average the ring normals at v = 0 / 1
    const na = g.attributes.normal;
    for (const j of [0, nv]) {
      let x = 0, y = 0, z = 0;
      for (let i = 0; i <= nu; i++) { const k = j * (nu + 1) + i; x += na.getX(k); y += na.getY(k); z += na.getZ(k); }
      const l = Math.hypot(x, y, z) || 1;
      for (let i = 0; i <= nu; i++) na.setXYZ(j * (nu + 1) + i, x / l, y / l, z / l);
    }
  }
  if (o.metric) { // uv1 from accumulated edge lengths along u and v (meters / dm)
    const dm = o.dm ?? 0.02;
    const P = (i, j) => { const k = (j * (nu + 1) + i) * 3; return [pos[k], pos[k + 1], pos[k + 2]]; };
    const uv1 = new Float32Array((nu + 1) * (nv + 1) * 2);
    const su = new Float32Array((nu + 1) * (nv + 1)), sv = new Float32Array((nu + 1) * (nv + 1));
    for (let j = 0; j <= nv; j++) for (let i = 1; i <= nu; i++) { const a = P(i - 1, j), b = P(i, j); su[j * (nu + 1) + i] = su[j * (nu + 1) + i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); }
    for (let i = 0; i <= nu; i++) for (let j = 1; j <= nv; j++) { const a = P(i, j - 1), b = P(i, j); sv[j * (nu + 1) + i] = sv[(j - 1) * (nu + 1) + i] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); }
    for (let k = 0; k < su.length; k++) { uv1[k * 2] = su[k] / dm; uv1[k * 2 + 1] = sv[k] / dm; }
    g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
  }
  return g;
}

// Superellipse sweep ("loft") along Z: sec(v) -> { x, y, z, w, h, n?, n2? } (section centre, half extents,
// exponent; n2 = exponent for the lower half). u runs around starting at the bottom (-Y), through +X, top, -X.
// Ends close smoothly when w, h -> 0. Normals are welded across the seam.
export function loftGeo(nu, nv, sec, o = {}) {
  return sheetGeo(nu, nv, (u, v) => {
    const s = sec(v);
    const a = u * TAU - PI / 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const n = sa < 0 && s.n2 ? s.n2 : (s.n ?? 3);
    const e = 2 / n;
    const x = Math.sign(ca) * Math.pow(Math.abs(ca), e) * s.w;
    const y = Math.sign(sa) * Math.pow(Math.abs(sa), e) * s.h;
    return [s.x + x, s.y + y, s.z];
  }, { metric: true, dm: o.dm, wrapU: true, poles: o.poles, flip: o.flip });
}
// rounded end factor for lofts: 0 at the very end -> 1 after `len` (circular profile)
export function capRound(t, len) { const q = clamp(t / len, 0, 1); return Math.sqrt(Math.max(0, 1 - (1 - q) * (1 - q))); }

// Planar convex polygon with explicit UVs
export function polyGeo(verts, uvs) {
  const pos = [], uv = [];
  for (let i = 1; i < verts.length - 1; i++) for (const k of [0, i, i + 1]) { pos.push(...verts[k]); uv.push(...uvs[k]); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// Swept tube along any curve with a profile function prof(t, a) -> radius scale [rx, ry] in the local frame.
// Frame: parallel transport (stable for planar & 3D paths). o: { seg, sides, t0, t1, cap0, cap1, up, dm, shape(a)->[x,y] }
export function sweepGeo(curve, prof, o = {}) {
  const seg = o.seg ?? 40, sides = o.sides ?? 12, t0 = o.t0 ?? 0, t1 = o.t1 ?? 1;
  const dm = o.dm ?? 0.02;
  const pos = [], uvs = [], uv1 = [], idx = [];
  const T = V3(), Nn = V3(), B = V3(), P = V3(), prevT = V3();
  const up = o.up ? V3(...o.up) : null;
  const shape = o.shape || ((a) => [Math.cos(a), Math.sin(a)]);
  const ringT = [];
  let len = 0;
  const Pprev = V3();
  for (let i = 0; i <= seg; i++) {
    const t = t0 + (t1 - t0) * (i / seg);
    ringT.push(t);
    curve.getPointAt(t, P);
    curve.getTangentAt(clamp(t, 0.0005, 0.9995), T);
    if (i === 0) {
      if (up) { Nn.copy(up).cross(T).normalize(); if (Nn.lengthSq() < 1e-8) Nn.set(1, 0, 0); }
      else { const a = Math.abs(T.y) < 0.9 ? V3(0, 1, 0) : V3(1, 0, 0); Nn.crossVectors(a, T).normalize(); }
    } else {
      if (up) { Nn.copy(up).cross(T); if (Nn.lengthSq() < 1e-8) Nn.crossVectors(B, T); Nn.normalize(); }
      else { const q = new THREE.Quaternion().setFromUnitVectors(prevT, T); Nn.applyQuaternion(q).normalize(); }
      len += P.distanceTo(Pprev);
    }
    B.crossVectors(T, Nn).normalize();
    prevT.copy(T); Pprev.copy(P);
    const [rx, ry] = prof(t);
    let circ = 0;
    let last = null;
    for (let k = 0; k <= sides; k++) {
      const a = (o.rot0 ?? 0) + (k / sides) * TAU;
      const [sx, sy] = shape(a, t);
      let x, y, z;
      const tw = o.warp ? o.warp(t, sx * rx, sy * ry) : t;
      if (tw !== t && up) { // vertex pulled to another station (notches, chamfers): local frame there
        const Pw = curve.getPointAt(clamp(tw, 0, 1)), Tw = curve.getTangentAt(clamp(tw, 0.0005, 0.9995));
        const Nw = up.clone().cross(Tw).normalize(), Bw = V3().crossVectors(Tw, Nw).normalize();
        const [rxw, ryw] = prof(tw);
        x = Pw.x + Nw.x * sx * rxw + Bw.x * sy * ryw; y = Pw.y + Nw.y * sx * rxw + Bw.y * sy * ryw; z = Pw.z + Nw.z * sx * rxw + Bw.z * sy * ryw;
      } else {
        x = P.x + Nn.x * sx * rx + B.x * sy * ry; y = P.y + Nn.y * sx * rx + B.y * sy * ry; z = P.z + Nn.z * sx * rx + B.z * sy * ry;
      }
      if (o.off) { const [dn, db] = o.off(t); x += Nn.x * dn + B.x * db; y += Nn.y * dn + B.y * db; z += Nn.z * dn + B.z * db; }
      if (last) circ += Math.hypot(x - last[0], y - last[1], z - last[2]);
      last = [x, y, z];
      pos.push(x, y, z);
      uvs.push(i / seg, k / sides);
      uv1.push(len / dm, circ / dm);
    }
  }
  const row = sides + 1;
  for (let i = 0; i < seg; i++) for (let k = 0; k < sides; k++) { const a = i * row + k, b = a + 1, c = a + row, d = c + 1; idx.push(a, c, b, b, c, d); }
  const caps = [];
  if (o.cap0 !== false) caps.push([0, false]);
  if (o.cap1 !== false) caps.push([seg, true]);
  for (const [i, flip] of caps) {
    const base = pos.length / 3;
    const tc = o.warp ? clamp(o.warp(ringT[i], 0, 0), 0, 1) : ringT[i];
    curve.getPointAt(tc, P);
    if (o.off) { // centre of the offset section = mean of the ring
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < sides; k++) { const s3 = (i * row + k) * 3; cx += pos[s3]; cy += pos[s3 + 1]; cz += pos[s3 + 2]; }
      P.set(cx / sides, cy / sides, cz / sides);
    }
    pos.push(P.x, P.y, P.z); uvs.push(i / seg, 0.5); uv1.push(0, 0);
    // duplicate ring vertices for a flat-shaded cap
    for (let k = 0; k <= sides; k++) { const s = (i * row + k) * 3; pos.push(pos[s], pos[s + 1], pos[s + 2]); uvs.push(i / seg, k / sides); uv1.push((pos[s] - P.x) / dm, (pos[s + 1] - P.y + pos[s + 2] - P.z) / dm); }
    for (let k = 0; k < sides; k++) { const a = base + 1 + k, b = base + 2 + k; if (flip) idx.push(base, a, b); else idx.push(base, b, a); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Polyline / helix curves
export class PolyCurve extends THREE.Curve {
  constructor(points) { super(); this.pts = points.map((p) => (p.isVector3 ? p : V3(...p))); this.arcLengthDivisions = 400; }
  getPoint(t, out = new THREE.Vector3()) {
    const n = this.pts.length - 1;
    const f = Math.min(n - 1e-6, Math.max(0, t * n));
    const i = Math.floor(f);
    return out.lerpVectors(this.pts[i], this.pts[i + 1], f - i);
  }
}
export class HelixCurve extends THREE.Curve {
  constructor(r, h, turns, r1 = r) { super(); this.r = r; this.r1 = r1; this.h = h; this.turns = turns; }
  getPoint(t, out = new THREE.Vector3()) {
    const a = t * this.turns * TAU, r = lerp(this.r, this.r1, t);
    return out.set(Math.cos(a) * r, t * this.h, Math.sin(a) * r);
  }
}
export const curve = (pts, tension = 0.5, closed = false) => new THREE.CatmullRomCurve3(pts.map((p) => (p.isVector3 ? p : V3(...p))), closed, 'catmullrom', tension);

// ExtrudeGeometry helper: shape in XY extruded along +Z (centred in Z), with bevel
export function extrudeGeo(shape, depth, bevel = 0, o = {}) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: o.bevelThickness ?? bevel, bevelSize: o.bevelSize ?? bevel, bevelOffset: o.bevelOffset ?? 0,
    bevelSegments: o.bevelSegments ?? 2, curveSegments: o.curveSegments ?? 12, steps: o.steps ?? 1,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

// Smooth normals on a non-indexed geometry by welding positions
export function smoothNormals(g, eps = 1e-5) {
  const pos = g.attributes.position;
  const nrm = g.attributes.normal || new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3);
  const acc = new Map();
  const a = V3(), b = V3(), c = V3(), ab = V3(), cb = V3();
  const key = (i) => `${Math.round(pos.getX(i) / eps)},${Math.round(pos.getY(i) / eps)},${Math.round(pos.getZ(i) / eps)}`;
  const keys = new Array(pos.count);
  for (let i = 0; i < pos.count; i++) keys[i] = key(i);
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    cb.subVectors(c, b); ab.subVectors(a, b); cb.cross(ab);
    for (let k = 0; k < 3; k++) {
      const kk = keys[i + k];
      let v = acc.get(kk);
      if (!v) { v = V3(); acc.set(kk, v); }
      v.add(cb);
    }
  }
  for (let i = 0; i < pos.count; i++) {
    const n = acc.get(keys[i]);
    const l = n.length() || 1;
    nrm.setXYZ(i, n.x / l, n.y / l, n.z / l);
  }
  g.setAttribute('normal', nrm);
  return g;
}

// ---------------------------------------------------------------------------
// Kit: assembles parts in item space
// ---------------------------------------------------------------------------
const FACE = { px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5, side: 0, top: 1, bottom: 2 };
export function mapRect(uv, i, rect) {
  let u = uv.getX(i), v = uv.getY(i);
  const rot = rect[4] || 0;
  if (rot === 1) [u, v] = [v, 1 - u];
  else if (rot === 2) [u, v] = [1 - u, 1 - v];
  else if (rot === 3) [u, v] = [1 - v, u];
  else if (rot === 4) u = 1 - u;
  else if (rot === 5) v = 1 - v;
  uv.setXY(i, rect[0] + u * (rect[2] - rect[0]), rect[1] + v * (rect[3] - rect[1]));
}

const _m4 = new THREE.Matrix4(), _n3 = new THREE.Matrix3();
const KEEP = new Set(['position', 'normal', 'uv', 'uv1']);
export class Kit {
  constructor() {
    this.items = [];
    this.cols = [];
    this.anchors = {};
    this.pivots = {};
    this.frame = new THREE.Matrix4();
    this.stack = [];
  }
  push(o) { this.stack.push(this.frame.clone()); this.frame.multiply(mtx(o)); return this; }
  pop() { this.frame = this.stack.pop(); return this; }

  // o: p, r, s (transform) | uv rect | faces {px: rect, ...} | uvFn(p, n, u, v) -> [u, v] | vFromY [y0, y1] (+ uv rect)
  //    planar {rect, cx, cz, R} (top-down) | col (hex or fn(pItem, nItem) -> hex) | ao fn(pLocal, nLocal) -> 0..1
  //    deform(v, i) | smooth | flat | part | clone | shadow | dm (detail tile override) | d: 'box' (force box detail mapping)
  add(geo, mat, o = {}) {
    let g = geo;
    if (o.deform) {
      const pos = g.attributes.position, v = V3();
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); o.deform(v, i); pos.setXYZ(i, v.x, v.y, v.z); }
      if (g.index) g.computeVertexNormals();
    }
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (!KEEP.has(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (o.flat) { g.deleteAttribute('normal'); g.computeVertexNormals(); }
    if (o.smooth || (o.deform && !geo.index)) smoothNormals(g);
    const n = g.attributes.position.count;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    const uv = g.attributes.uv, pos = g.attributes.position, nrm = g.attributes.normal;
    // local-space AO / colour hooks need the untransformed vertex
    let aoF = null;
    if (o.ao) {
      aoF = new Float32Array(n);
      const p = V3(), nn = V3();
      for (let i = 0; i < n; i++) { p.fromBufferAttribute(pos, i); nn.fromBufferAttribute(nrm, i); aoF[i] = o.ao(p, nn, i); }
    }
    if (o.uvFn) {
      const p = V3(), nn = V3();
      for (let i = 0; i < n; i++) { p.fromBufferAttribute(pos, i); nn.fromBufferAttribute(nrm, i); const r = o.uvFn(p, nn, uv.getX(i), uv.getY(i)); uv.setXY(i, r[0], r[1]); }
    } else if (o.planar) {
      const { rect, R, cx = 0, cz = 0, flip = false } = o.planar;
      for (let i = 0; i < n; i++) {
        const u = 0.5 + (pos.getX(i) - cx) / (2 * R), v = 0.5 + (flip ? 1 : -1) * (pos.getZ(i) - cz) / (2 * R);
        uv.setXY(i, u, v);
        mapRect(uv, i, rect);
      }
    } else if (o.vFromY) {
      const [y0, y1] = o.vFromY;
      for (let i = 0; i < n; i++) uv.setY(i, (pos.getY(i) - y0) / (y1 - y0));
      if (o.uv) for (let i = 0; i < n; i++) mapRect(uv, i, o.uv);
    } else if (o.faces) {
      const groups = g.groups.length ? g.groups : [{ start: 0, count: n, materialIndex: 0 }];
      const byIdx = {};
      for (const k in o.faces) byIdx[FACE[k] ?? +k] = o.faces[k];
      for (const gr of groups) {
        const rct = byIdx[gr.materialIndex] ?? o.uv ?? mat.userData?.plain;
        if (!rct) continue;
        for (let i = gr.start; i < gr.start + gr.count; i++) mapRect(uv, i, rct);
      }
    } else if (o.uv) {
      for (let i = 0; i < n; i++) mapRect(uv, i, o.uv);
    } else if (mat.userData?.plain && !o.keepUV) {
      for (let i = 0; i < n; i++) mapRect(uv, i, mat.userData.plain);
    }
    if (o.capUV) { // planar top-down mapping for the cap vertices of a lathe / cylinder
      const { rect, R, t = 0.6, cx = 0, cz = 0, rect2 } = o.capUV;
      for (let i = 0; i < n; i++) {
        const ny = nrm.getY(i);
        if (Math.abs(ny) < t) continue;
        uv.setXY(i, 0.5 + (pos.getX(i) - cx) / (2 * R), 0.5 - (pos.getZ(i) - cz) / (2 * R));
        mapRect(uv, i, ny < 0 && rect2 ? rect2 : rect);
      }
    }
    g.clearGroups();
    const M = _m4.copy(this.frame).multiply(mtx(o));
    g.applyMatrix4(M);
    // detail uv1 (tiles): keep generator-provided coordinates, else box-project in item space
    const dm = o.dm ?? mat.userData?.dm ?? 0.02;
    if (!g.attributes.uv1 || o.d === 'box') {
      const uv1 = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        let a, b;
        if (nx >= ny && nx >= nz) { a = z; b = y; } else if (ny >= nz) { a = x; b = z; } else { a = x; b = y; }
        uv1[i * 2] = a / dm; uv1[i * 2 + 1] = b / dm;
      }
      g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    } else if (o.dm && geo.attributes.uv1 && o.dmScale) {
      const a = g.attributes.uv1;
      for (let i = 0; i < n; i++) a.setXY(i, a.getX(i) * o.dmScale, a.getY(i) * o.dmScale);
    }
    // colour = tint x occlusion
    const col = new Float32Array(n * 3);
    const cc = new THREE.Color();
    const p = V3(), nn = V3();
    const fixed = typeof o.col === 'function' ? null : cc.set(o.col ?? 0xffffff).clone();
    for (let i = 0; i < n; i++) {
      let c = fixed;
      if (!c) { p.fromBufferAttribute(pos, i); nn.fromBufferAttribute(nrm, i); cc.set(o.col(p, nn)); c = cc; }
      const a = aoF ? aoF[i] : 1;
      col[i * 3] = c.r * a; col[i * 3 + 1] = c.g * a; col[i * 3 + 2] = c.b * a;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.items.push({ g, mat, part: o.part, clone: o.clone, shadow: o.shadow, bounds: o.bounds !== false });
    return g;
  }

  box(w, h, d, mat, o = {}) { return this.add(new THREE.BoxGeometry(w, h, d, o.sx || 1, o.sy || 1, o.sz || 1), mat, o); }
  rbox(w, h, d, r, mat, o = {}) { return this.add(new RoundedBoxGeometry(w, h, d, o.rs ?? 3, Math.min(r, w / 2 - 1e-5, h / 2 - 1e-5, d / 2 - 1e-5)), mat, o); }
  // lathe from a fillet() profile or raw [[r, y, hard]] points
  lathe(pts, mat, o = {}) {
    const prof = o.raw ? pts : fillet(pts, o);
    return this.add(latheGeo(prof, { seg: o.seg ?? 32, phi0: o.phi0, phiLen: o.phiLen, dm: o.dm ?? mat.userData?.dm, rmod: o.rmod, ymod: o.ymod }), mat, o);
  }
  // simple cylinder with filleted rims (bevel) along Y, centred at p
  cyl(r, h, mat, o = {}) {
    const b = o.bevel ?? Math.min(r, h) * 0.12;
    const rt = o.rt ?? r;
    const pts = [];
    if (o.open) pts.push([r, -h / 2], [rt, h / 2]);
    else pts.push([0, -h / 2], [r, -h / 2, b], [rt, h / 2, b], [0, h / 2]);
    return this.lathe(pts, mat, o);
  }
  sphere(r, mat, o = {}) {
    const pts = [];
    const n = o.hs ?? 10, t0 = o.ts ?? 0, tl = o.tl ?? PI;
    for (let i = n; i >= 0; i--) { const t = t0 + (i / n) * tl; pts.push([Math.sin(t) * r, Math.cos(t) * r]); }
    return this.add(latheGeo(pts, { seg: o.ws ?? 16, dm: o.dm ?? mat.userData?.dm }), mat, o);
  }
  torus(R, r, mat, o = {}) {
    const g = new THREE.TorusGeometry(R, r, o.rseg ?? 8, o.tseg ?? 24, o.arc ?? TAU);
    return this.add(g, mat, o);
  }
  tube(points, r, mat, o = {}) {
    const c = points instanceof THREE.Curve ? points : curve(points, o.tension ?? 0.5);
    const rr = typeof r === 'function' ? r : () => [r, r];
    return this.add(sweepGeo(c, (t) => { const v = rr(t); return Array.isArray(v) ? v : [v, v]; }, { seg: o.tseg ?? 32, sides: o.rseg ?? 8, cap0: o.cap0, cap1: o.cap1, dm: o.dm ?? mat.userData?.dm, up: o.up, shape: o.shape, rot0: o.rot0 }), mat, o);
  }
  extrude(shape, depth, bevel, mat, o = {}) {
    return this.add(extrudeGeo(shape, depth, bevel, o), mat, o);
  }

  _xpos(p) { return V3(...p).applyMatrix4(this.frame); }
  _xrot(r) {
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(this.frame));
    q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...(r || [0, 0, 0]))));
    const e = new THREE.Euler().setFromQuaternion(q);
    return [e.x, e.y, e.z];
  }
  colBox(size, pos = [0, 0, 0], rot) { this.cols.push({ type: 'box', size: [...size], pos: this._xpos(pos), rot: this._xrot(rot) }); return this; }
  colCyl(radius, height, pos = [0, 0, 0], rot) { this.cols.push({ type: 'cylinder', radius, height, pos: this._xpos(pos), rot: this._xrot(rot) }); return this; }
  colCap(radius, halfHeight, pos = [0, 0, 0], rot) { this.cols.push({ type: 'capsule', radius, halfHeight, pos: this._xpos(pos), rot: this._xrot(rot) }); return this; }
  colBall(radius, pos = [0, 0, 0]) { this.cols.push({ type: 'ball', radius, pos: this._xpos(pos) }); return this; }
  anchor(name, p) { this.anchors[name] = this._xpos(p); return this; }
  pivot(part, p) { this.pivots[part] = this._xpos(p); return this; }
}

// ---------------------------------------------------------------------------
// Finishing, caching and instancing
// ---------------------------------------------------------------------------
function colliderMinY(c) {
  if (c.type === 'ball') return c.pos.y - c.radius;
  const e = new THREE.Euler(...(c.rot || [0, 0, 0]));
  const m = new THREE.Matrix4().makeRotationFromEuler(e);
  const pts = [];
  if (c.type === 'box') {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push(V3(sx * c.size[0] / 2, sy * c.size[1] / 2, sz * c.size[2] / 2));
    let mn = Infinity;
    for (const p of pts) mn = Math.min(mn, p.applyMatrix4(m).y);
    return c.pos.y + mn;
  }
  if (c.type === 'capsule') {
    const ax = V3(0, 1, 0).applyMatrix4(m);
    return c.pos.y - Math.abs(ax.y) * c.halfHeight - c.radius;
  }
  for (let k = 0; k < 32; k++) for (const sy of [-1, 1]) pts.push(V3(Math.cos(k / 32 * TAU) * c.radius, sy * c.height / 2, Math.sin(k / 32 * TAU) * c.radius));
  let mn = Infinity;
  for (const p of pts) mn = Math.min(mn, p.applyMatrix4(m).y);
  return c.pos.y + mn;
}

// meta: { mass, material, hold: { grip: [x, y, z] (kit coords), rot: [..], off?: [..] }, center?: [..], init?(inst, opts),
//         friction?, restitution?, linearDamping?, angularDamping? }
function finish(name, kit, meta) {
  const bb = new THREE.Box3();
  for (const it of kit.items) { it.g.computeBoundingBox(); if (it.bounds) bb.union(it.g.boundingBox); }
  const c = meta.center ? V3(...meta.center) : bb.getCenter(V3());
  for (const it of kit.items) it.g.translate(-c.x, -c.y, -c.z);
  const map = new Map();
  for (const it of kit.items) {
    const k = `${it.mat.uuid}|${it.part || ''}`;
    if (!map.has(k)) map.set(k, { mat: it.mat, part: it.part, clone: !!it.clone || !!it.part, shadow: it.shadow, geos: [] });
    map.get(k).geos.push(it.g);
  }
  const groups = [];
  for (const gr of map.values()) {
    const geo = gr.geos.length === 1 ? gr.geos[0] : mergeGeometries(gr.geos, false);
    if (!geo) throw new Error(`items: merge failed for ${name} (${gr.mat.name})`);
    const pivot = V3();
    if (gr.part) {
      if (kit.pivots[gr.part]) pivot.copy(kit.pivots[gr.part]).sub(c);
      else { geo.computeBoundingBox(); geo.boundingBox.getCenter(pivot); }
      geo.translate(-pivot.x, -pivot.y, -pivot.z);
    }
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    groups.push({ geo, mat: gr.mat, part: gr.part, clone: gr.clone, shadow: gr.shadow, pivot, tris: geo.attributes.position.count / 3 });
  }
  // opaque first, then transparent; parts keep their order
  groups.sort((a, b) => (a.mat.transparent ? 1 : 0) - (b.mat.transparent ? 1 : 0));
  const colliders = kit.cols.map((k) => ({ ...k, pos: k.pos.clone().sub(c) }));
  const size = bb.getSize(V3());
  let halfHeight = c.y - bb.min.y;
  if (colliders.length) halfHeight = -Math.min(...colliders.map(colliderMinY));
  const anchors = {};
  for (const k in kit.anchors) anchors[k] = kit.anchors[k].clone().sub(c);
  let hold = { pos: [0, 0, 0], rot: [0, 0, 0] };
  if (meta.hold) {
    const rot = meta.hold.rot || [0, 0, 0];
    const g = V3(...(meta.hold.grip || [c.x, c.y, c.z])).sub(c).applyEuler(new THREE.Euler(...rot));
    const off = meta.hold.off || [0, 0, 0];
    hold = { pos: [off[0] - g.x, off[1] - g.y, off[2] - g.z].map((v) => +v.toFixed(4)), rot: rot.map((v) => +v.toFixed(4)) };
  }
  return {
    name, groups, colliders, anchors, hold, halfHeight: +halfHeight.toFixed(4),
    size: [size.x, size.y, size.z].map((v) => +v.toFixed(4)),
    mass: meta.mass, material: meta.material, init: meta.init,
    phys: { friction: meta.friction, restitution: meta.restitution, linearDamping: meta.linearDamping, angularDamping: meta.angularDamping },
    tris: groups.reduce((a, g) => a + g.tris, 0),
  };
}

const templateCache = new Map();
const builders = {};
const variantKeys = {};

function noShadowMat(m) {
  return m.transparent || m.blending === THREE.AdditiveBlending || m.userData?.noShadow;
}

function instantiate(T, opts) {
  const object = new THREE.Group();
  object.name = `item_${T.name}`;
  const parts = {};
  for (const gr of T.groups) {
    const mat = gr.clone ? gr.mat.clone() : gr.mat;
    const mesh = new THREE.Mesh(gr.geo, mat);
    mesh.position.copy(gr.pivot);
    const ns = noShadowMat(mat);
    mesh.castShadow = gr.shadow ?? !ns;
    mesh.receiveShadow = !mat.transparent;
    if (ns && gr.shadow !== true) mesh.userData.noShadow = true;
    if (gr.part) {
      mesh.name = gr.part;
      if (parts[gr.part]) {
        const prev = parts[gr.part];
        if (!prev.isGroup) {
          const grp = new THREE.Group(); grp.name = gr.part;
          grp.position.copy(prev.position);
          prev.position.set(0, 0, 0);
          object.add(grp); grp.add(prev);
          parts[gr.part] = grp;
        }
        mesh.position.sub(parts[gr.part].position);
        parts[gr.part].add(mesh);
        continue;
      }
      parts[gr.part] = mesh;
    }
    object.add(mesh);
  }
  const anchors = {};
  for (const k in T.anchors) anchors[k] = T.anchors[k].clone();
  const inst = {
    object,
    colliders: T.colliders.map((c) => {
      const o = { ...c, pos: [c.pos.x, c.pos.y, c.pos.z].map((v) => +v.toFixed(4)) };
      if (c.rot) o.rot = [...c.rot];
      if (c.size) o.size = [...c.size];
      return o;
    }),
    mass: T.mass,
    material: T.material,
    halfHeight: T.halfHeight,
    hold: { pos: [...T.hold.pos], rot: [...T.hold.rot] },
    anchors,
    parts,
    size: [...T.size],
  };
  for (const k of ['friction', 'restitution', 'linearDamping', 'angularDamping']) if (T.phys[k] !== undefined) inst[k] = T.phys[k];
  object.userData.item = T.name;
  T.init?.(inst, opts);
  return inst;
}

export function getTemplate(name, opts = {}) {
  const vk = variantKeys[name] ? variantKeys[name](opts) : '';
  const key = `${name}#${vk}`;
  if (!templateCache.has(key)) {
    const { kit, meta } = builders[name](opts);
    templateCache.set(key, finish(name, kit, meta));
  }
  return templateCache.get(key);
}

export const ITEMS = {};

export function def(name, build, variantKey) {
  builders[name] = build;
  if (variantKey) variantKeys[name] = variantKey;
  ITEMS[name] = (opts = {}) => instantiate(getTemplate(name, opts || {}), opts || {});
}

export function hasTemplate(name, opts = {}) {
  const vk = variantKeys[name] ? variantKeys[name](opts) : '';
  return templateCache.has(`${name}#${vk}`);
}

export function templateStats(name, opts = {}) {
  const T = getTemplate(name, opts);
  return { name, meshes: T.groups.length, tris: T.tris, perMesh: T.groups.map((g) => `${g.part || g.mat.name || g.mat.type}:${g.tris}`) };
}
