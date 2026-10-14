// R.O.O.M. — doll geometry helpers: parametric grids with proper seam / pole normals,
// displacement sculpting, tubes / sweeps with radius profiles, ribbons on surfaces.
import * as THREE from 'three';
import { clamp, lerp } from './kit.js';

const PI = Math.PI, TAU = PI * 2;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

export const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const gauss = (x, m, s) => Math.exp(-(((x - m) / s) ** 2));

// grid of (nu+1) x (nv+1) vertices from fn(i, j, out) (integer indices); ring j, column i.
// opts: closedU (column nu duplicates column 0), poleBottom / poleTop (ring 0 / nv collapse)
export function grid(nu, nv, fn, opts = {}) {
  const n = (nu + 1) * (nv + 1);
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = [];
  const p = new THREE.Vector3();
  let k = 0;
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++, k++) {
    fn(i, j, p);
    pos[k * 3] = p.x; pos[k * 3 + 1] = p.y; pos[k * 3 + 2] = p.z;
    uv[k * 2] = i / nu; uv[k * 2 + 1] = j / nv;
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    if (opts.flip) idx.push(a, d, b, a, c, d); else idx.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.userData.grid = { nu, nv, closedU: !!opts.closedU, poleBottom: !!opts.poleBottom, poleTop: !!opts.poleTop };
  gridNormals(g);
  return g;
}

// vertex normals with averaged seam columns and pole rows
export function gridNormals(g) {
  g.computeVertexNormals();
  const G = g.userData.grid;
  if (!G) return g;
  const { nu, nv } = G, n = g.attributes.normal;
  if (G.closedU) for (let j = 0; j <= nv; j++) {
    const a = j * (nu + 1), b = a + nu;
    _a.fromBufferAttribute(n, a).add(_b.fromBufferAttribute(n, b)).normalize();
    n.setXYZ(a, _a.x, _a.y, _a.z); n.setXYZ(b, _a.x, _a.y, _a.z);
  }
  const pole = (row) => {
    _a.set(0, 0, 0);
    for (let i = 0; i < nu; i++) _a.add(_b.fromBufferAttribute(n, row * (nu + 1) + i));
    _a.normalize();
    for (let i = 0; i <= nu; i++) n.setXYZ(row * (nu + 1) + i, _a.x, _a.y, _a.z);
  };
  if (G.poleBottom) pole(0);
  if (G.poleTop) pole(nv);
  return g;
}

// push every vertex along its normal by fn(x, y, z, i) (meters); optional ambient-occlusion tint:
// valleys (negative displacement) darken the vertex colour by up to aoK
export function displace(g, fn, { aoK = 0, aoAmp = 0.006, color = null } = {}) {
  const P = g.attributes.position, N = g.attributes.normal, n = P.count;
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = fn(P.getX(i), P.getY(i), P.getZ(i), i);
  // keep duplicated seam vertices identical
  for (let i = 0; i < n; i++) {
    P.setXYZ(i, P.getX(i) + N.getX(i) * d[i], P.getY(i) + N.getY(i) * d[i], P.getZ(i) + N.getZ(i) * d[i]);
  }
  gridNormals(g);
  if (aoK > 0) {
    const col = g.attributes.color || new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3);
    const base = new THREE.Color(color ?? 0xffffff);
    for (let i = 0; i < n; i++) {
      const k = 1 - aoK * clamp(-d[i] / aoAmp, 0, 1) + aoK * 0.25 * clamp(d[i] / aoAmp, 0, 1);
      col.setXYZ(i, (col.getX(i) ?? 1) * k * base.r, (col.getY(i) ?? 1) * k * base.g, (col.getZ(i) ?? 1) * k * base.b);
    }
    g.setAttribute('color', col);
  }
  return g;
}

// multiply vertex colours by fn(x, y, z, i) -> scalar or [r, g, b]
export function tint(g, fn) {
  const P = g.attributes.position, n = P.count;
  const col = g.attributes.color || new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3);
  for (let i = 0; i < n; i++) {
    const k = fn(P.getX(i), P.getY(i), P.getZ(i), i);
    if (typeof k === 'number') col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
    else col.setXYZ(i, col.getX(i) * k[0], col.getY(i) * k[1], col.getZ(i) * k[2]);
  }
  g.setAttribute('color', col);
  return g;
}
export function solid(g, hex) {
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

// flip triangle winding if the mesh faces inward relative to a centre point
export function ensureOutward(g, center) {
  const P = g.attributes.position, I = g.index.array;
  let s = 0;
  for (let t = 0; t < I.length; t += 3) {
    _a.fromBufferAttribute(P, I[t]); _b.fromBufferAttribute(P, I[t + 1]); _c.fromBufferAttribute(P, I[t + 2]);
    _d.subVectors(_b, _a).cross(_c.sub(_a));
    _a.add(_b).sub(center);
    s += _d.dot(_a);
  }
  if (s < 0) {
    for (let t = 0; t < I.length; t += 3) { const x = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = x; }
    g.index.needsUpdate = true;
    gridNormals(g);
  }
  return g;
}

// UVs in meters along a grid: u = arc length around each ring, v = arc length along the columns
// (closed rings: u spans the ring perimeter; seam at column 0)
export function gridArcUV(g, scaleU = 1, scaleV = 1, uOffsetFn = null) {
  const { nu, nv } = g.userData.grid, P = g.attributes.position, uv = g.attributes.uv;
  const vAcc = new Float32Array(nu + 1);
  for (let j = 0; j <= nv; j++) {
    let u = 0;
    for (let i = 0; i <= nu; i++) {
      const k = j * (nu + 1) + i;
      if (i > 0) u += _a.fromBufferAttribute(P, k).distanceTo(_b.fromBufferAttribute(P, k - 1));
      if (j > 0) vAcc[i] += _a.fromBufferAttribute(P, k).distanceTo(_b.fromBufferAttribute(P, k - (nu + 1)));
      uv.setXY(k, (u + (uOffsetFn ? uOffsetFn(j) : 0)) * scaleU, vAcc[i] * scaleV);
    }
  }
  // centre the u coordinate of each ring so stretching spreads symmetrically
  return g;
}

// sweep a closed cross-section along a polyline path (Vector3[]), with per-point radius/shape.
// section(t, a, out2) -> Vector2 offset in the (side, normal) frame; rings x segs
export function sweep(path, segs, section, { closeStart = false, closeEnd = false, up = null } = {}) {
  const n = path.length;
  const T = [], Nn = [], B = [];
  for (let i = 0; i < n; i++) {
    const t = new THREE.Vector3().subVectors(path[Math.min(n - 1, i + 1)], path[Math.max(0, i - 1)]).normalize();
    T.push(t);
  }
  // parallel transport frames
  let nrm = up ? up.clone() : new THREE.Vector3(0, 0, 1);
  if (Math.abs(nrm.dot(T[0])) > 0.95) nrm = new THREE.Vector3(1, 0, 0);
  nrm.addScaledVector(T[0], -nrm.dot(T[0])).normalize();
  for (let i = 0; i < n; i++) {
    if (i > 0) { nrm.addScaledVector(T[i], -nrm.dot(T[i])); if (nrm.lengthSq() < 1e-8) nrm.set(1, 0, 0).addScaledVector(T[i], -T[i].x); nrm.normalize(); }
    Nn.push(nrm.clone()); B.push(new THREE.Vector3().crossVectors(T[i], nrm));
  }
  const o = new THREE.Vector2();
  const g = grid(segs, n - 1, (i, j, p) => {
    const a = (i / segs) * TAU;
    section(j / (n - 1), a, o, j);
    p.copy(path[j]).addScaledVector(B[j], o.x).addScaledVector(Nn[j], o.y);
  }, { closedU: true, poleBottom: closeStart, poleTop: closeEnd });
  return g;
}

// round tube along points with radius r(t)
export function tubeR(points, rFn, segs = 10, opts = {}) {
  const pts = points.map((p) => (Array.isArray(p) ? new THREE.Vector3(...p) : p));
  return sweep(pts, segs, (t, a, o) => { const r = typeof rFn === 'function' ? rFn(t) : rFn; o.set(Math.cos(a) * r, Math.sin(a) * r); }, opts);
}

// resample a smooth curve through control points into n points (centripetal Catmull-Rom)
export function curvePts(ctrl, n, closed = false) {
  const c = new THREE.CatmullRomCurve3(ctrl.map((p) => (Array.isArray(p) ? new THREE.Vector3(...p) : p.clone())), closed, 'centripetal');
  return c.getSpacedPoints(n);
}

// flat ribbon (rectangular section with rounded edge normals) lying on a surface:
// points[], normals[] (surface normals), width, thickness
export function ribbonOn(points, normals, width, thick, { bevel = 0.35 } = {}) {
  const n = points.length;
  const prof = [[-0.5, 0], [-0.5, 0.6], [-0.5 + bevel * 0.25, 1], [0.5 - bevel * 0.25, 1], [0.5, 0.6], [0.5, 0]];
  const m = prof.length;
  const pos = new Float32Array(n * m * 3), uv = new Float32Array(n * m * 2), idx = [];
  const T = new THREE.Vector3(), Sd = new THREE.Vector3();
  let len = 0;
  for (let i = 0; i < n; i++) {
    const P = points[i], N = normals[i];
    if (i < n - 1) T.subVectors(points[i + 1], P); else T.subVectors(P, points[i - 1]);
    T.normalize();
    Sd.crossVectors(T, N).normalize();
    if (i > 0) len += P.distanceTo(points[i - 1]);
    for (let c = 0; c < m; c++) {
      const [sw, nt] = prof[c], k = i * m + c;
      pos[k * 3] = P.x + Sd.x * sw * width + N.x * nt * thick;
      pos[k * 3 + 1] = P.y + Sd.y * sw * width + N.y * nt * thick;
      pos[k * 3 + 2] = P.z + Sd.z * sw * width + N.z * nt * thick;
      uv[k * 2] = (sw + 0.5) * width; uv[k * 2 + 1] = len;
    }
  }
  for (let i = 0; i < n - 1; i++) for (let c = 0; c < m - 1; c++) {
    const a = i * m + c, b = a + 1, d = a + m, e = b + m;
    idx.push(a, b, d, b, e, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// superellipse point (unit) for angle a and exponent e
export function sePt(a, e, out) {
  const c = Math.cos(a), s = Math.sin(a);
  return out.set(Math.sign(c) * Math.pow(Math.abs(c), 2 / e), Math.sign(s) * Math.pow(Math.abs(s), 2 / e));
}

// rounded "pillow" box (smooth rounded rectangle slab): w x h x d with corner radius r
export function pillow(w, h, d, r = 0.01, segs = 5) {
  const g = new THREE.SphereGeometry(1, segs * 3, Math.max(8, segs * 2));
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    _a.fromBufferAttribute(P, i);
    const sx = Math.sign(_a.x) * Math.pow(Math.abs(_a.x), 0.28), sy = Math.sign(_a.y) * Math.pow(Math.abs(_a.y), 0.28), sz = Math.sign(_a.z) * Math.pow(Math.abs(_a.z), 0.45);
    P.setXYZ(i, sx * w / 2, sy * h / 2, sz * d / 2);
  }
  void r;
  g.computeVertexNormals();
  return g;
}

export { lerp };
