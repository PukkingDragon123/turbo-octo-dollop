// Customizer shared helpers: math, easing, springs, small geometry builders and the hover/click registry.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const PI = Math.PI, TAU = PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
export const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeIO = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const backOut = (t, s = 1.70158) => { t = clamp(t, 0, 1) - 1; return t * t * ((s + 1) * t + s) + 1; };
export const rnd = (a, b) => a + (b - a) * Math.random();
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// critically-damped-ish spring on a scalar / vector (k stiffness, z damping ratio)
export class Spring1 {
  constructor(x = 0, k = 120, z = 0.6) { this.x = x; this.v = 0; this.k = k; this.z = z; }
  step(target, dt) {
    const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n, c = 2 * this.z * Math.sqrt(this.k);
    for (let i = 0; i < n; i++) { this.v += (this.k * (target - this.x) - c * this.v) * h; this.x += this.v * h; }
    return this.x;
  }
}
export class Spring3 {
  constructor(p = V(), k = 120, z = 0.6) { this.x = p.clone(); this.v = V(); this.k = k; this.z = z; }
  step(target, dt) {
    const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n, c = 2 * this.z * Math.sqrt(this.k);
    for (let i = 0; i < n; i++) {
      this.v.x += (this.k * (target.x - this.x.x) - c * this.v.x) * h;
      this.v.y += (this.k * (target.y - this.x.y) - c * this.v.y) * h;
      this.v.z += (this.k * (target.z - this.x.z) - c * this.v.z) * h;
      this.x.addScaledVector(this.v, h);
    }
    return this.x;
  }
  snap(p) { this.x.copy(p); this.v.set(0, 0, 0); }
}

export function mesh(geo, mat, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, cast = true, recv = true, name = '' } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  if (s !== 1) { if (Array.isArray(s)) m.scale.set(...s); else m.scale.setScalar(s); }
  m.castShadow = cast; m.receiveShadow = recv;
  if (name) m.name = name;
  return m;
}
export const rbox = (w, h, d, r = 0.01, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
export const cyl = (r, h, seg = 24, r2 = r) => new THREE.CylinderGeometry(r2, r, h, seg);
// lathe from [r, y] pairs (with soft bevels already in the profile)
// (v runs by arc length along the profile, so labels / bands paint where they should)
export function lathe(pts, seg = 32) {
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), seg);
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const tot = L[L.length - 1] || 1, uv = g.attributes.uv, np = pts.length;
  for (let k = 0; k < uv.count; k++) uv.setY(k, L[k % np] / tot);
  return g;
}
// metre UVs for tiling world materials (gfx/materials.js world surfaces)
export function metreUV(g, sx, sy) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy); return g; }
export function merge(list) { return mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false); }
// smooth tube along points
export function tube(points, r, seg = 24, rad = 8) {
  const c = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(c, seg, r, rad, false);
}

// ---------------------------------------------------------------------------
// clickable things: register(obj, { onClick, onHover, cursor, group }) ; pick via raycaster
export class Hits {
  constructor() { this.list = []; this.ray = new THREE.Raycaster(); }
  add(obj, act) { obj.userData.act = act; this.list.push(obj); return obj; }
  remove(obj) { const i = this.list.indexOf(obj); if (i >= 0) this.list.splice(i, 1); }
  pick(ndc, camera, filter = null) {
    this.ray.setFromCamera(ndc, camera);
    const vis = this.list.filter((o) => visible(o) && (!filter || filter(o.userData.act)));
    const h = this.ray.intersectObjects(vis, false)[0];
    return h ? { obj: h.object, act: h.object.userData.act, point: h.point, dist: h.distance } : null;
  }
}
export function visible(o) { for (let p = o; p; p = p.parent) if (!p.visible && !(p === o && o.userData.hitOnly)) return false; return true; }
// invisible hit proxy (bigger than the visible thing, easy to tap)
export function hitBox(w, h, d) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
  m.userData.hitOnly = true;
  return m;
}
