// Still Lifes — signed-distance "clay" for sculpting whole creatures as one continuous body.
// Primitives are combined in order with smooth unions / smooth carves; detail ops (folds, scar
// grooves, bulges) displace the field locally. Every primitive also carries the attributes the
// mesher needs per vertex: material channel, colour, dirt/thinning/wetness and the bone it belongs
// to, so skin weights and material boundaries follow the sculpt's own blends.
import * as THREE from 'three';
import { noise3, clamp, lin } from './core.js';

export const MAT = { SKIN: 0, SUIT: 1, RUBBER: 2, FLUFF: 3, INNER: 4 };
export const NMAT = 5;

const T_SPHERE = 1, T_ELL = 2, T_CONE = 3, T_BOX = 4, T_TORUS = 5, T_FOLD = 10, T_GROOVE = 11, T_BULGE = 12, T_FOLDR = 13;
const OP_UNION = 0, OP_SUB = 1, OP_DETAIL = 2;
export const STRIDE = 48;

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4();
function rotRows(rot) {
  // returns row-major world->local 3x3 (transpose of the local->world rotation)
  if (!rot) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let q = rot;
  if (Array.isArray(rot)) q = _q.setFromEuler(_e.set(rot[0], rot[1], rot[2], rot[3] || 'XYZ'));
  else if (rot.isEuler) q = _q.setFromEuler(rot);
  _m.makeRotationFromQuaternion(q);
  const e = _m.elements; // column-major: e[0..2] = column 0 (local X axis in world)
  return [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]];
}
const V = (a) => (a.isVector3 ? [a.x, a.y, a.z] : a);
const colOf = (c) => (c == null ? null : typeof c === 'number' ? lin(c) : c);

export class Sculpt {
  constructor(boneNames) {
    this.boneNames = boneNames;
    this.boneIndex = new Map(boneNames.map((n, i) => [n, i]));
    this.prims = []; // {g: Float64Array(STRIDE), bs: [x,y,z,r]}
    this.paints = [];
    this.bonePaints = [];
    this.styleStack = [{ k: 0.03, mat: MAT.SKIN, col: 0xb4976a, dirt: 0, thin: 0, wet: 0, bone: boneNames[0] }];
  }
  get st() { return this.styleStack[this.styleStack.length - 1]; }
  push(o = {}) { this.styleStack.push({ ...this.st, ...o }); return this; }
  pop() { if (this.styleStack.length > 1) this.styleStack.pop(); return this; }
  with(o, fn) { this.push(o); try { fn(); } finally { this.pop(); } return this; }
  bi(name) {
    if (name == null) return -1;
    if (typeof name === 'number') return name;
    const i = this.boneIndex.get(name);
    if (i === undefined) throw new Error('Sculpt: unknown bone ' + name);
    return i;
  }

  _prim(type, op, o, bs) {
    const s = { ...this.st, ...o };
    const g = new Float64Array(STRIDE);
    g[0] = type; g[1] = op; g[2] = s.k ?? 0;
    g[3] = this.bi(s.bone); g[4] = s.bone2 != null ? this.bi(s.bone2) : -1; g[5] = s.t0 ?? 0.35; g[6] = s.t1 ?? 0.75;
    g[7] = s.mat == null ? -1 : s.mat;
    const c = colOf(s.col) || [0.5, 0.5, 0.5];
    g[8] = c[0]; g[9] = c[1]; g[10] = c[2];
    g[11] = s.dirt ?? 0; g[12] = s.thin ?? 0; g[13] = s.wet ?? 0;
    const nz = s.noise; g[14] = nz ? nz[0] : 0; g[15] = nz ? nz[1] : 0; g[16] = nz ? (nz[2] ?? this.prims.length * 7.31) : 0;
    g[17] = s.ms ?? 1; g[18] = s.ws ?? 1; g[19] = (s.noW || op !== OP_UNION ? 1 : 0) | (s.keepMat ? 2 : 0) | (s.colOnly ? 4 : 0);
    const amp = g[14];
    const p = { g, bs: [bs[0], bs[1], bs[2], bs[3] + amp * 1.5], op, carveCol: op === OP_SUB && s.col != null && s.mat != null };
    this.prims.push(p);
    return p;
  }
  // ---------------------------------------------------------------- shapes
  sphere(c, r, o = {}) {
    c = V(c);
    const p = this._prim(T_SPHERE, o.sub ? OP_SUB : OP_UNION, o, [c[0], c[1], c[2], r]);
    p.g.set([c[0], c[1], c[2], r], 20);
    return p;
  }
  ell(c, radii, rot = null, o = {}) {
    c = V(c); radii = V(radii);
    const p = this._prim(T_ELL, o.sub ? OP_SUB : OP_UNION, o, [c[0], c[1], c[2], Math.max(radii[0], radii[1], radii[2])]);
    p.g.set([c[0], c[1], c[2], radii[0], radii[1], radii[2], ...rotRows(rot)], 20);
    return p;
  }
  // round cone (tapered capsule) from a (radius ra) to b (radius rb)
  cone(a, b, ra, rb = ra, o = {}) {
    a = V(a); b = V(b);
    const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
    const l2 = Math.max(1e-8, bax * bax + bay * bay + baz * baz), rr = ra - rb;
    const L = Math.sqrt(l2);
    const p = this._prim(T_CONE, o.sub ? OP_SUB : OP_UNION, o, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, L / 2 + Math.max(ra, rb)]);
    p.g.set([a[0], a[1], a[2], b[0], b[1], b[2], ra, rb, bax, bay, baz, l2, rr, l2 - rr * rr, 1 / l2], 20);
    return p;
  }
  // polyline of round cones; o.bones: array of bone names per segment (else o.bone)
  chain(pts, radii, o = {}) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const oo = { ...o };
      if (o.bones) oo.bone = o.bones[Math.min(i, o.bones.length - 1)];
      if (o.ks) oo.k = o.ks[Math.min(i, o.ks.length - 1)];
      out.push(this.cone(pts[i], pts[i + 1], radii[i], radii[i + 1], oo));
    }
    return out;
  }
  box(c, half, rot = null, round = 0.01, o = {}) {
    c = V(c); half = V(half);
    const p = this._prim(T_BOX, o.sub ? OP_SUB : OP_UNION, o, [c[0], c[1], c[2], Math.hypot(half[0], half[1], half[2])]);
    p.g.set([c[0], c[1], c[2], half[0], half[1], half[2], ...rotRows(rot), round], 20);
    return p;
  }
  // torus around local Y
  torus(c, R, r, rot = null, o = {}) {
    c = V(c);
    const p = this._prim(T_TORUS, o.sub ? OP_SUB : OP_UNION, o, [c[0], c[1], c[2], R + r]);
    p.g.set([c[0], c[1], c[2], R, r, 0, ...rotRows(rot)], 20);
    return p;
  }
  // ---------------------------------------------------------------- detail ops
  // wrinkles: sinusoidal ridges across `axis` inside radius R (smooth falloff)
  fold(c, R, axis, freq, amp, o = {}) {
    c = V(c); axis = V(axis);
    const l = Math.hypot(axis[0], axis[1], axis[2]) || 1;
    const p = this._prim(T_FOLD, OP_DETAIL, { ...o, noW: true }, [c[0], c[1], c[2], R]);
    p.g.set([c[0], c[1], c[2], R, axis[0] / l, axis[1] / l, axis[2] / l, freq, amp, o.phase ?? 0, o.warp ?? 0.8, o.sharp ?? 1, o.warpFreq ?? 9, o.bias ?? 0], 20);
    return p;
  }
  // radial gathers: `count` wrinkles around axis n through c, between radii r0..r1, within +-depth along n
  foldRadial(c, n, r0, r1, count, amp, o = {}) {
    c = V(c); n = V(n);
    const nl = Math.hypot(n[0], n[1], n[2]) || 1; const N = [n[0] / nl, n[1] / nl, n[2] / nl];
    let u = Math.abs(N[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const d0 = u[0] * N[0] + u[1] * N[1] + u[2] * N[2];
    u = [u[0] - N[0] * d0, u[1] - N[1] * d0, u[2] - N[2] * d0]; const ul = Math.hypot(...u); u = u.map((x) => x / ul);
    const v = [N[1] * u[2] - N[2] * u[1], N[2] * u[0] - N[0] * u[2], N[0] * u[1] - N[1] * u[0]];
    const p = this._prim(T_FOLDR, OP_DETAIL, { ...o, noW: true }, [c[0], c[1], c[2], r1 + 0.02]);
    p.g.set([c[0], c[1], c[2], r0, r1, N[0], N[1], N[2], u[0], u[1], u[2], v[0], v[1], v[2], count, amp, o.depth ?? 0.08, o.warp ?? 0.5, o.phase ?? 0], 20);
    return p;
  }
  // scar / seam groove along a polyline: depth > 0 sinks, rim raises the lips
  groove(pts, width, depth, o = {}) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = V(pts[i]), b = V(pts[i + 1]);
      const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
      const l2 = Math.max(1e-8, bax * bax + bay * bay + baz * baz);
      const p = this._prim(T_GROOVE, OP_DETAIL, { ...o, noW: true }, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, Math.sqrt(l2) / 2 + width * 2.6]);
      p.g.set([a[0], a[1], a[2], b[0], b[1], b[2], width, depth, o.rim ?? depth * 0.35, bax, bay, baz, 1 / l2, o.wobble ?? 0], 20);
      out.push(p);
    }
    return out;
  }
  // soft ellipsoidal swelling (amp > 0 pushes outward)
  bulge(c, radii, amp, rot = null, o = {}) {
    c = V(c); if (typeof radii === 'number') radii = [radii, radii, radii]; radii = V(radii);
    const p = this._prim(T_BULGE, OP_DETAIL, { ...o, noW: true }, [c[0], c[1], c[2], Math.max(radii[0], radii[1], radii[2])]);
    p.g.set([c[0], c[1], c[2], radii[0], radii[1], radii[2], ...rotRows(rot), amp, o.sharp ?? 2], 20);
    return p;
  }
  // ---------------------------------------------------------------- vertex-only
  // paint attributes inside a shape: {mat, col, dirt, thin, wet, w (strength), soft}
  paint(shape, o = {}) {
    const g = this._shapeG(shape);
    this.paints.push({ g, bs: g.bs, mat: o.mat ?? -1, col: colOf(o.col), dirt: o.dirt, thin: o.thin, wet: o.wet, w: o.w ?? 1, soft: o.soft ?? 0.02, mul: o.mul ? colOf(o.mul) : null });
  }
  bonePaint(shape, bone, o = {}) {
    const g = this._shapeG(shape);
    this.bonePaints.push({ g, bs: g.bs, bone: this.bi(bone), w: o.w ?? 1, soft: o.soft ?? 0.02 });
  }
  _shapeG(s) {
    // shape spec: {sphere:[c,r]} | {ell:[c,radii,rot]} | {cone:[a,b,ra,rb]} | {box:[c,half,rot,round]}
    const tmp = new Sculpt(this.boneNames);
    let p;
    if (s.sphere) p = tmp.sphere(...s.sphere);
    else if (s.ell) p = tmp.ell(...s.ell);
    else if (s.cone) p = tmp.cone(...s.cone);
    else if (s.box) p = tmp.box(...s.box);
    else throw new Error('bad paint shape');
    return { G: p.g, bs: p.bs };
  }

  // ---------------------------------------------------------------- compile / spatial lists
  compile() {
    const n = this.prims.length;
    this.P = new Float64Array(n * STRIDE);
    this.BS = new Float64Array(n * 4);
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    this.prims.forEach((p, i) => {
      this.P.set(p.g, i * STRIDE);
      this.BS.set(p.bs, i * 4);
      if (p.op === OP_UNION) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p.bs[a] - p.bs[3]); mx[a] = Math.max(mx[a], p.bs[a] + p.bs[3]); }
    });
    this.bmin = mn; this.bmax = mx;
    return this;
  }
  // uniform grid of candidate lists; cell size cs, margin m
  buildLists(min, max, cs, margin) {
    const nx = Math.max(1, Math.ceil((max[0] - min[0]) / cs)), ny = Math.max(1, Math.ceil((max[1] - min[1]) / cs)), nz = Math.max(1, Math.ceil((max[2] - min[2]) / cs));
    const n = this.prims.length, BS = this.BS, P = this.P;
    const off = new Int32Array(nx * ny * nz + 1);
    const tmp = [];
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x0 = min[0] + i * cs, y0 = min[1] + j * cs, z0 = min[2] + k * cs;
      const c = (k * ny + j) * nx + i;
      off[c] = tmp.length;
      for (let p = 0; p < n; p++) {
        const bx = BS[p * 4], by = BS[p * 4 + 1], bz = BS[p * 4 + 2], br = BS[p * 4 + 3] + P[p * STRIDE + 2] + margin;
        const dx = bx < x0 ? x0 - bx : bx > x0 + cs ? bx - x0 - cs : 0;
        const dy = by < y0 ? y0 - by : by > y0 + cs ? by - y0 - cs : 0;
        const dz = bz < z0 ? z0 - bz : bz > z0 + cs ? bz - z0 - cs : 0;
        if (dx * dx + dy * dy + dz * dz < br * br) tmp.push(p * STRIDE);
      }
    }
    off[nx * ny * nz] = tmp.length;
    this.L = { min, cs, nx, ny, nz, off, list: Int32Array.from(tmp) };
    // paint lists are tiny: test all per vertex (bounded by sphere)
    return this.L;
  }
  // compile + coarse lists so the field can be queried (tracing features onto the surface)
  prepare(cs = 0.1, margin = 0.12) {
    this.compile();
    const pad = 0.15;
    this.buildLists([this.bmin[0] - pad, this.bmin[1] - pad, this.bmin[2] - pad], [this.bmax[0] + pad, this.bmax[1] + pad, this.bmax[2] + pad], cs, margin);
    return this;
  }
  cellOf(x, y, z) {
    const L = this.L;
    const i = clamp(Math.floor((x - L.min[0]) / L.cs), 0, L.nx - 1), j = clamp(Math.floor((y - L.min[1]) / L.cs), 0, L.ny - 1), k = clamp(Math.floor((z - L.min[2]) / L.cs), 0, L.nz - 1);
    return (k * L.ny + j) * L.nx + i;
  }
  // field value using the candidate list of the cell containing the point
  d(x, y, z) {
    const c = this.cellOf(x, y, z), L = this.L;
    return evalD(this.P, L.list, L.off[c], L.off[c + 1], x, y, z);
  }
}

// ---------------------------------------------------------------------------
// primitive distance (geometry only, before op)
export function primD(P, o, x, y, z) {
  const type = P[o];
  let d;
  switch (type) {
    case T_CONE: {
      const ax = x - P[o + 20], ay = y - P[o + 21], az = z - P[o + 22];
      const bax = P[o + 28], bay = P[o + 29], baz = P[o + 30], l2 = P[o + 31], rr = P[o + 32], a2 = P[o + 33], il2 = P[o + 34];
      const yy = ax * bax + ay * bay + az * baz, zz = yy - l2;
      const qx = ax * l2 - bax * yy, qy = ay * l2 - bay * yy, qz = az * l2 - baz * yy;
      const x2 = qx * qx + qy * qy + qz * qz, y2 = yy * yy * l2, z2 = zz * zz * l2;
      const k = (rr > 0 ? 1 : rr < 0 ? -1 : 0) * rr * rr * x2;
      if ((zz > 0 ? 1 : zz < 0 ? -1 : 0) * a2 * z2 > k) d = Math.sqrt(x2 + z2) * il2 - P[o + 27];
      else if ((yy > 0 ? 1 : yy < 0 ? -1 : 0) * a2 * y2 < k) d = Math.sqrt(x2 + y2) * il2 - P[o + 26];
      else d = (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - P[o + 26];
      break;
    }
    case T_SPHERE: {
      const dx = x - P[o + 20], dy = y - P[o + 21], dz = z - P[o + 22];
      d = Math.sqrt(dx * dx + dy * dy + dz * dz) - P[o + 23];
      break;
    }
    case T_ELL: {
      const dx = x - P[o + 20], dy = y - P[o + 21], dz = z - P[o + 22];
      const lx = (P[o + 26] * dx + P[o + 27] * dy + P[o + 28] * dz), ly = (P[o + 29] * dx + P[o + 30] * dy + P[o + 31] * dz), lz = (P[o + 32] * dx + P[o + 33] * dy + P[o + 34] * dz);
      const rx = P[o + 23], ry = P[o + 24], rz = P[o + 25];
      const k0 = Math.sqrt((lx / rx) * (lx / rx) + (ly / ry) * (ly / ry) + (lz / rz) * (lz / rz));
      const k1 = Math.sqrt((lx / (rx * rx)) * (lx / (rx * rx)) + (ly / (ry * ry)) * (ly / (ry * ry)) + (lz / (rz * rz)) * (lz / (rz * rz)));
      d = k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
      break;
    }
    case T_BOX: {
      const dx = x - P[o + 20], dy = y - P[o + 21], dz = z - P[o + 22], rnd = P[o + 35];
      const qx = Math.abs(P[o + 26] * dx + P[o + 27] * dy + P[o + 28] * dz) - P[o + 23] + rnd;
      const qy = Math.abs(P[o + 29] * dx + P[o + 30] * dy + P[o + 31] * dz) - P[o + 24] + rnd;
      const qz = Math.abs(P[o + 32] * dx + P[o + 33] * dy + P[o + 34] * dz) - P[o + 25] + rnd;
      const mx = qx > 0 ? qx : 0, my = qy > 0 ? qy : 0, mz = qz > 0 ? qz : 0;
      d = Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, qy, qz), 0) - rnd;
      break;
    }
    case T_TORUS: {
      const dx = x - P[o + 20], dy = y - P[o + 21], dz = z - P[o + 22];
      const lx = (P[o + 26] * dx + P[o + 27] * dy + P[o + 28] * dz), ly = (P[o + 29] * dx + P[o + 30] * dy + P[o + 31] * dz), lz = (P[o + 32] * dx + P[o + 33] * dy + P[o + 34] * dz);
      const q = Math.sqrt(lx * lx + lz * lz) - P[o + 23];
      d = Math.sqrt(q * q + ly * ly) - P[o + 24];
      break;
    }
    default: d = 1e9;
  }
  const amp = P[o + 14];
  if (amp !== 0) { const f = P[o + 15], s = P[o + 16]; d += amp * (noise3(x * f + s, y * f - s * 0.7, z * f + s * 1.3) * 2 - 1); }
  return d;
}

// detail displacement (added to the field)
export function detailD(P, o, x, y, z) {
  const type = P[o];
  if (type === T_FOLD) {
    const dx = x - P[o + 20], dy = y - P[o + 21], dz = z - P[o + 22], R = P[o + 23];
    const r2 = (dx * dx + dy * dy + dz * dz) / (R * R);
    if (r2 >= 1) return 0;
    const fall = (1 - r2) * (1 - r2);
    const wf = P[o + 32];
    let t = (dx * P[o + 24] + dy * P[o + 25] + dz * P[o + 26]) * P[o + 27] + P[o + 29];
    const warp = P[o + 30];
    if (warp !== 0) t += warp * (noise3(x * wf + 3.1, y * wf - 1.7, z * wf + 5.3) * 2 - 1) * 3.14159;
    let s = Math.sin(t);
    const sharp = P[o + 31];
    if (sharp !== 1) s = (s < 0 ? -1 : 1) * Math.pow(Math.abs(s), sharp);
    const bias = P[o + 33];
    if (bias !== 0) s = s * (1 - bias) + Math.max(0, s) * bias * 2 - bias * 0.5;
    return -P[o + 28] * s * fall;
  }
  if (type === T_FOLDR) {
    const dx = x - P[o + 20], dy = y - P[o + 21], dz = z - P[o + 22];
    const a = dx * P[o + 25] + dy * P[o + 26] + dz * P[o + 27];
    const dep = P[o + 36];
    if (a > dep || a < -dep) return 0;
    const lu = dx * P[o + 28] + dy * P[o + 29] + dz * P[o + 30], lv = dx * P[o + 31] + dy * P[o + 32] + dz * P[o + 33];
    const r = Math.sqrt(lu * lu + lv * lv), r0 = P[o + 23], r1 = P[o + 24];
    if (r < r0 || r > r1) return 0;
    let f = (r - r0) / (r1 - r0); f = Math.sin(f * 3.14159);
    const fa = 1 - Math.abs(a) / dep;
    const ang = Math.atan2(lv, lu) * P[o + 34] + P[o + 38] + P[o + 37] * (noise3(x * 11, y * 11, z * 11) * 2 - 1) * 3.0;
    return -P[o + 35] * Math.sin(ang) * f * fa;
  }
  if (type === T_GROOVE) {
    const ax = x - P[o + 20], ay = y - P[o + 21], az = z - P[o + 22];
    const bax = P[o + 29], bay = P[o + 30], baz = P[o + 31];
    let h = (ax * bax + ay * bay + az * baz) * P[o + 32];
    h = h < 0 ? 0 : h > 1 ? 1 : h;
    const qx = ax - bax * h, qy = ay - bay * h, qz = az - baz * h;
    let w = P[o + 26];
    const wob = P[o + 33];
    if (wob !== 0) w *= 1 + wob * (noise3(x * 40, y * 40, z * 40) * 2 - 1);
    const u = Math.sqrt(qx * qx + qy * qy + qz * qz) / w;
    if (u > 2.6) return 0;
    return P[o + 27] * Math.exp(-u * u * 2.2) - P[o + 28] * Math.exp(-(u - 1.25) * (u - 1.25) * 5);
  }
  if (type === T_BULGE) {
    const dx = x - P[o + 20], dy = y - P[o + 21], dz = z - P[o + 22];
    const lx = (P[o + 26] * dx + P[o + 27] * dy + P[o + 28] * dz) / P[o + 23], ly = (P[o + 29] * dx + P[o + 30] * dy + P[o + 31] * dz) / P[o + 24], lz = (P[o + 32] * dx + P[o + 33] * dy + P[o + 34] * dz) / P[o + 25];
    const r2 = lx * lx + ly * ly + lz * lz;
    if (r2 >= 1) return 0;
    const f = 1 - r2;
    return -P[o + 35] * (P[o + 36] === 2 ? f * f : Math.pow(f, P[o + 36]));
  }
  return 0;
}

// fast field evaluation over a candidate list (entries are prim offsets)
export function evalD(P, list, s, e, x, y, z) {
  let d = 1e9;
  for (let li = s; li < e; li++) {
    const o = list[li];
    const op = P[o + 1];
    if (op === OP_DETAIL) { if (d < 0.25) d += detailD(P, o, x, y, z); continue; }
    const di = primD(P, o, x, y, z);
    const k = P[o + 2];
    if (op === OP_UNION) {
      if (k > 0) { const h = k - Math.abs(d - di); d = (d < di ? d : di) - (h > 0 ? (h * h * 0.25) / k : 0); }
      else if (di < d) d = di;
    } else {
      const c = -di;
      if (k > 0) { const h = k - Math.abs(d - c); d = (d > c ? d : c) + (h > 0 ? (h * h * 0.25) / k : 0); }
      else if (c > d) d = c;
    }
  }
  return d;
}

// Full attribute evaluation. out: {d, mat: Float64Array(NMAT), col[3], dirt, thin, wet, bones: [[idx,w],...]}
const _di = new Float64Array(4096), _do = new Int32Array(4096);
export function evalAttr(S, x, y, z, out) {
  const P = S.P, L = S.L;
  const c = S.cellOf(x, y, z);
  const list = L.list, s = L.off[c], e = L.off[c + 1];
  const mat = out.mat, col = out.col;
  mat.fill(0); mat[0] = 1; col[0] = col[1] = col[2] = 0.5;
  let dirt = 0, thin = 0, wet = 0;
  let d = 1e9, nU = 0;
  for (let li = s; li < e; li++) {
    const o = list[li];
    const op = P[o + 1];
    if (op === OP_DETAIL) {
      if (d < 0.25) {
        const dd = detailD(P, o, x, y, z);
        d += dd;
        // grooves/folds may tint (colOnly flag): strength from displacement
        if ((P[o + 19] & 4) && dd !== 0) {
          const amp = Math.abs(P[o + 27]) || Math.abs(P[o + 28]) || 0.01;
          const w = clamp(Math.abs(dd) / amp, 0, 1) * 0.85;
          col[0] += (P[o + 8] - col[0]) * w; col[1] += (P[o + 9] - col[1]) * w; col[2] += (P[o + 10] - col[2]) * w;
          dirt += (P[o + 11] - dirt) * w; wet += (P[o + 13] - wet) * w;
        }
      }
      continue;
    }
    const di = primD(P, o, x, y, z);
    const k = P[o + 2];
    let sw; // weight of the new primitive's attributes
    if (op === OP_UNION) {
      if (k > 0) { const h = k - Math.abs(d - di); sw = clamp(0.5 + (0.5 * (d - di)) / k, 0, 1); d = (d < di ? d : di) - (h > 0 ? (h * h * 0.25) / k : 0); }
      else { sw = di < d ? 1 : 0; if (di < d) d = di; }
      if (!(P[o + 19] & 1) && nU < 4096) { _di[nU] = di; _do[nU] = o; nU++; }
    } else {
      const cc = -di;
      if (k > 0) { const h = k - Math.abs(d - cc); sw = clamp(0.5 + (0.5 * (cc - d)) / k, 0, 1); d = (d > cc ? d : cc) + (h > 0 ? (h * h * 0.25) / k : 0); }
      else { sw = cc > d ? 1 : 0; if (cc > d) d = cc; }
      if (P[o + 7] < 0) sw = 0; // carve keeps existing material
    }
    const ms = P[o + 17];
    if (ms !== 1) sw = clamp((sw - 0.5) * ms + 0.5, 0, 1);
    if (sw > 0) {
      if (!(P[o + 19] & 2)) {
        const m = P[o + 7];
        if (m >= 0) { for (let q = 0; q < NMAT; q++) mat[q] *= 1 - sw; mat[m] += sw; }
      }
      col[0] += (P[o + 8] - col[0]) * sw; col[1] += (P[o + 9] - col[1]) * sw; col[2] += (P[o + 10] - col[2]) * sw;
      dirt += (P[o + 11] - dirt) * sw; thin += (P[o + 12] - thin) * sw; wet += (P[o + 13] - wet) * sw;
    }
  }
  // skin weights from union primitives near the surface
  const bw = out.bw; bw.fill(0);
  let dmin = 1e9;
  for (let i = 0; i < nU; i++) if (_di[i] < dmin) dmin = _di[i];
  for (let i = 0; i < nU; i++) {
    const o = _do[i];
    const sig = Math.max(0.3 * P[o + 2], 0.007) * P[o + 18];
    const ex = Math.max(0, _di[i] - dmin) / sig;
    if (ex > 7) continue;
    const w = Math.exp(-ex);
    const b1 = P[o + 3], b2 = P[o + 4];
    if (b2 >= 0 && P[o] === T_CONE) {
      const ax = x - P[o + 20], ay = y - P[o + 21], az = z - P[o + 22];
      const t = clamp((ax * P[o + 28] + ay * P[o + 29] + az * P[o + 30]) * P[o + 34], 0, 1);
      const t0 = P[o + 5], t1 = P[o + 6];
      let f = clamp((t - t0) / Math.max(1e-4, t1 - t0), 0, 1); f = f * f * (3 - 2 * f);
      if (w * (1 - f) > bw[b1]) bw[b1] = w * (1 - f);
      if (w * f > bw[b2]) bw[b2] = w * f;
    } else if (w > bw[b1]) bw[b1] = w;
  }
  // vertex-only paints
  for (const pt of S.paints) {
    const b = pt.bs;
    const dx = x - b[0], dy = y - b[1], dz = z - b[2], r = b[3] + pt.soft;
    if (dx * dx + dy * dy + dz * dz > r * r) continue;
    const pd = primD(pt.G, 0, x, y, z);
    const w = pt.w * (1 - smooth(-pt.soft, pt.soft, pd));
    if (w <= 0) continue;
    if (pt.mat >= 0) { for (let q = 0; q < NMAT; q++) mat[q] *= 1 - w; mat[pt.mat] += w; }
    if (pt.col) { col[0] += (pt.col[0] - col[0]) * w; col[1] += (pt.col[1] - col[1]) * w; col[2] += (pt.col[2] - col[2]) * w; }
    if (pt.mul) { col[0] *= 1 + (pt.mul[0] - 1) * w; col[1] *= 1 + (pt.mul[1] - 1) * w; col[2] *= 1 + (pt.mul[2] - 1) * w; }
    if (pt.dirt != null) dirt += (pt.dirt - dirt) * w;
    if (pt.thin != null) thin += (pt.thin - thin) * w;
    if (pt.wet != null) wet += (pt.wet - wet) * w;
  }
  for (const bp of S.bonePaints) {
    const b = bp.bs;
    const dx = x - b[0], dy = y - b[1], dz = z - b[2], r = b[3] + bp.soft;
    if (dx * dx + dy * dy + dz * dz > r * r) continue;
    const pd = primD(bp.G, 0, x, y, z);
    const w = bp.w * (1 - smooth(-bp.soft, bp.soft, pd));
    if (w <= 0) continue;
    let tot = 0; for (let q = 0; q < bw.length; q++) tot += bw[q];
    for (let q = 0; q < bw.length; q++) bw[q] *= 1 - w;
    bw[bp.bone] += w * Math.max(tot, 1e-3);
  }
  out.d = d; out.dirt = dirt; out.thin = thin; out.wet = wet;
  return out;
}
function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

export function makeAttrOut(nBones) {
  return { d: 0, mat: new Float64Array(NMAT), col: [0, 0, 0], dirt: 0, thin: 0, wet: 0, bw: new Float64Array(nBones) };
}
