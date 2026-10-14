// Still Lifes — small procedural geometry kit for the attached hard parts.
// All generators return non-indexed-or-indexed BufferGeometry with position/normal/uv.
import * as THREE from 'three';
import { noise3, TAU, PI, clamp } from './core.js';

const v3 = (a) => (a.isVector3 ? a.clone() : new THREE.Vector3(a[0], a[1], a[2]));

export function sphere(r, ws = 12, hs = 9) { return new THREE.SphereGeometry(r, ws, hs); }

// lumpy felt / stuffing ball
export function fuzzball(r, rough = 0.12, seed = 1, ws = 14, hs = 10) {
  const g = new THREE.SphereGeometry(r, ws, hs);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = noise3(x / r * 1.7 + seed, y / r * 1.7 - seed, z / r * 1.7 + seed * 0.3) * 0.7 + noise3(x / r * 4.1, y / r * 4.1 + seed, z / r * 4.1) * 0.3;
    const k = 1 + (n - 0.5) * 2 * rough;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}

// tube along a polyline; radius number or array; parallel-transport frames; uv: u around, v along (length-based)
export function tube(points, radius, radial = 6, { capStart = true, capEnd = true, vScale = 1 } = {}) {
  const P = points.map(v3);
  const n = P.length;
  const R = typeof radius === 'number' ? P.map(() => radius) : radius;
  const T = [], N = [], B = [];
  for (let i = 0; i < n; i++) {
    const t = new THREE.Vector3();
    if (i === 0) t.subVectors(P[1], P[0]); else if (i === n - 1) t.subVectors(P[n - 1], P[n - 2]); else t.subVectors(P[i + 1], P[i - 1]);
    T.push(t.normalize());
  }
  let nn = new THREE.Vector3(0, 1, 0);
  if (Math.abs(T[0].dot(nn)) > 0.9) nn.set(1, 0, 0);
  nn = new THREE.Vector3().crossVectors(T[0], nn).normalize();
  N.push(nn.clone()); B.push(new THREE.Vector3().crossVectors(T[0], nn));
  for (let i = 1; i < n; i++) {
    const axis = new THREE.Vector3().crossVectors(T[i - 1], T[i]);
    const nv = N[i - 1].clone();
    if (axis.lengthSq() > 1e-10) { const a = Math.acos(clamp(T[i - 1].dot(T[i]), -1, 1)); nv.applyAxisAngle(axis.normalize(), a); }
    N.push(nv); B.push(new THREE.Vector3().crossVectors(T[i], nv));
  }
  const pos = [], nor = [], uv = [], idx = [];
  let len = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) len += P[i].distanceTo(P[i - 1]);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU, c = Math.cos(a), s = Math.sin(a);
      const dx = N[i].x * c + B[i].x * s, dy = N[i].y * c + B[i].y * s, dz = N[i].z * c + B[i].z * s;
      pos.push(P[i].x + dx * R[i], P[i].y + dy * R[i], P[i].z + dz * R[i]);
      nor.push(dx, dy, dz);
      uv.push(j / radial, len * vScale);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const addCap = (i, dir) => {
    const c = pos.length / 3;
    pos.push(P[i].x + T[i].x * R[i] * 0.4 * dir, P[i].y + T[i].y * R[i] * 0.4 * dir, P[i].z + T[i].z * R[i] * 0.4 * dir);
    nor.push(T[i].x * dir, T[i].y * dir, T[i].z * dir); uv.push(0.5, len * vScale * (dir > 0 ? 1 : 0));
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      if (dir > 0) idx.push(a, c, a + 1); else idx.push(a + 1, c, a);
    }
  };
  if (capStart && R[0] > 0) addCap(0, -1);
  if (capEnd && R[n - 1] > 0) addCap(n - 1, 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// lathe around Y from [r, y] profile
export function lathe(profile, segs = 16) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), segs);
  return g;
}

// flat ribbon through points with per-point surface normals (width across); thickness optional
export function ribbon(points, normals, width, { thick = 0, uScale = 1, widths = null } = {}) {
  const P = points.map(v3), Nn = normals.map(v3);
  const n = P.length;
  const pos = [], nor = [], uv = [], idx = [];
  let len = 0;
  const side = [];
  for (let i = 0; i < n; i++) {
    const t = new THREE.Vector3();
    if (i === 0) t.subVectors(P[1], P[0]); else if (i === n - 1) t.subVectors(P[n - 1], P[n - 2]); else t.subVectors(P[i + 1], P[i - 1]);
    t.normalize();
    side.push(new THREE.Vector3().crossVectors(Nn[i], t).normalize());
  }
  for (let i = 0; i < n; i++) {
    if (i > 0) len += P[i].distanceTo(P[i - 1]);
    const w = (widths ? widths[i] : width) / 2;
    for (const s of [-1, 1]) {
      pos.push(P[i].x + side[i].x * w * s, P[i].y + side[i].y * w * s, P[i].z + side[i].z * w * s);
      nor.push(Nn[i].x, Nn[i].y, Nn[i].z);
      uv.push(len * uScale, s < 0 ? 0 : 1);
    }
  }
  for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  if (thick > 0) {
    const base = pos.length / 3;
    for (let i = 0; i < n * 2; i++) {
      pos.push(pos[i * 3] - nor[i * 3] * thick, pos[i * 3 + 1] - nor[i * 3 + 1] * thick, pos[i * 3 + 2] - nor[i * 3 + 2] * thick);
      nor.push(-nor[i * 3], -nor[i * 3 + 1], -nor[i * 3 + 2]); uv.push(uv[i * 2], uv[i * 2 + 1]);
    }
    for (let i = 0; i < n - 1; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// rounded slab (badge, plates): w x h x d with corner radius rr, front face uv 0..1
export function slab(w, h, d, rr = 0.004, seg = 3) {
  const shape = new THREE.Shape();
  const x0 = -w / 2, y0 = -h / 2;
  shape.moveTo(x0 + rr, y0); shape.lineTo(x0 + w - rr, y0); shape.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + rr);
  shape.lineTo(x0 + w, y0 + h - rr); shape.quadraticCurveTo(x0 + w, y0 + h, x0 + w - rr, y0 + h);
  shape.lineTo(x0 + rr, y0 + h); shape.quadraticCurveTo(x0, y0 + h, x0, y0 + h - rr);
  shape.lineTo(x0, y0 + rr); shape.quadraticCurveTo(x0, y0, x0 + rr, y0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: true, bevelThickness: d * 0.3, bevelSize: Math.min(rr * 0.5, d * 0.4), bevelSegments: 1, curveSegments: seg });
  g.translate(0, 0, -d / 2);
  // planar uv on the front (+z) from x/y
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - x0) / w, (p.getY(i) - y0) / h);
  g.computeVertexNormals();
  return g;
}

export function disc(r, segs = 16) { return new THREE.CircleGeometry(r, segs); }
export function cyl(r0, r1, h, segs = 12, open = false) { return new THREE.CylinderGeometry(r1, r0, h, segs, 1, open); }
export function torus(R, r, rs = 6, ts = 16) { return new THREE.TorusGeometry(R, r, rs, ts); }

// orient a geometry so local +Z aligns with dir and local +Y with up (projected); then translate to p
export function placeAt(g, p, dir, up = [0, 1, 0], spin = 0) {
  const z = v3(dir).normalize(), u = v3(up);
  if (Math.abs(z.dot(u.clone().normalize())) > 0.98) u.set(1, 0, 0);
  const x = new THREE.Vector3().crossVectors(u, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  if (spin) m.multiply(new THREE.Matrix4().makeRotationZ(spin));
  m.setPosition(p[0] ?? p.x, p[1] ?? p.y, p[2] ?? p.z);
  g.applyMatrix4(m);
  return g;
}
export const matFrom = (p, dir, up = [0, 1, 0], spin = 0) => {
  const z = v3(dir).normalize(), u = v3(up);
  if (Math.abs(z.dot(u.clone().normalize())) > 0.98) u.set(1, 0, 0);
  const x = new THREE.Vector3().crossVectors(u, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  if (spin) m.multiply(new THREE.Matrix4().makeRotationZ(spin));
  m.setPosition(p[0] ?? p.x, p[1] ?? p.y, p[2] ?? p.z);
  return m;
};
export { PI };
