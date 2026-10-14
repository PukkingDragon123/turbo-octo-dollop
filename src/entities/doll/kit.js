// R.O.O.M. — doll kit: small geometry / rig / spring helpers shared by every procedural
// character module (player dolls, clones, still lifes, healthity). Re-exported by avatar.js.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { labelTexture } from '../../gfx/textures.js';
import { valueNoise2 } from '../../core/rng.js';

const PI = Math.PI, TAU = PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
export const approach = (a, b, step) => (a < b ? Math.min(b, a + step) : Math.max(b, a - step));

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _e1 = new THREE.Euler();
const _c1 = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

// ============================================================================
// Geometry helpers (exported for the other model files)
// ============================================================================
export const G = {
  // scale -> rotate (Euler, XYZ default) -> translate, in place
  xf(g, p = null, r = null, s = null) {
    if (s != null) { if (typeof s === 'number') g.scale(s, s, s); else g.scale(s[0], s[1], s[2]); }
    if (r) { _m1.makeRotationFromEuler(_e1.set(r[0], r[1], r[2], r[3] || 'XYZ')); g.applyMatrix4(_m1); }
    if (p) g.translate(p[0], p[1], p[2]);
    return g;
  },
  // rotate geometry so its +Y axis points along dir
  alignY(g, dir) {
    _q1.setFromUnitVectors(UP, _v1.copy(dir).normalize());
    g.applyQuaternion(_q1);
    return g;
  },
  sphere: (r, w = 24, h = 16) => new THREE.SphereGeometry(r, w, h),
  ell: (rx, ry, rz, w = 24, h = 16) => new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz),
  cap: (r, len, cs = 6, rs = 16) => new THREE.CapsuleGeometry(r, Math.max(1e-4, len), cs, rs),
  // capsule whose cap centres are at y0 and y1 (along Y)
  capY(r, y0, y1, cs = 6, rs = 16) {
    return new THREE.CapsuleGeometry(r, Math.max(1e-4, Math.abs(y1 - y0)), cs, rs).translate(0, (y0 + y1) / 2, 0);
  },
  // capsule between two points
  between(a, b, r, cs = 5, rs = 12) {
    const A = Array.isArray(a) ? new THREE.Vector3(...a) : a, B = Array.isArray(b) ? new THREE.Vector3(...b) : b;
    const d = _v2.subVectors(B, A); const len = d.length();
    const g = new THREE.CapsuleGeometry(r, Math.max(1e-4, len), cs, rs);
    G.alignY(g, d);
    g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
    return g;
  },
  cyl: (rt, rb, h, rs = 20, open = false, hs = 1) => new THREE.CylinderGeometry(rt, rb, h, rs, hs, open),
  torus: (R, r, rs = 10, ts = 32, arc = TAU) => new THREE.TorusGeometry(R, r, rs, ts, arc),
  // profile: array of [r, y]
  lathe: (pts, segs = 24, ps = 0, pl = TAU) => new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(Math.max(0, p[0]), p[1])), segs, ps, pl),
  rbox: (w, h, d, r = 0.01, segs = 1) => new RoundedBoxGeometry(w, h, d, segs, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)),
  box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
  // rescale UVs so a repeat-2 suit texture tiles evenly (su/sv ~ surface size in m / 0.8)
  uv(g, su, sv) { const a = g.attributes.uv; for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * su, a.getY(i) * sv); return g; },
  tube(pts, r, segs = 24, rad = 8, closed = false) {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => (Array.isArray(p) ? new THREE.Vector3(...p) : p)), closed, 'centripetal');
    return new THREE.TubeGeometry(curve, segs, r, rad, closed);
  },
  // smooth UV sphere with gentle noisy displacement (pom-poms, felt noses)
  fuzzball(r, amount = 0.06, seed = 1, freq = 5, w = 22, h = 16) {
    const g = new THREE.SphereGeometry(r, w, h);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      _v1.fromBufferAttribute(p, i);
      const n = valueNoise2(_v1.x * freq / r + _v1.z * 1.3 / r + seed, _v1.y * freq / r + _v1.z * 0.7 / r + seed * 1.7, seed) - 0.5;
      _v1.multiplyScalar(1 + n * amount * 2);
      p.setXYZ(i, _v1.x, _v1.y, _v1.z);
    }
    g.computeVertexNormals();
    return g;
  },
  // icosphere with noisy displacement (fluffy pom-poms, organs, lumps)
  lumpy(r, amount = 0.15, detail = 2, seed = 1, freq = 3) {
    const g = new THREE.IcosahedronGeometry(r, detail);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      _v1.fromBufferAttribute(p, i);
      const n = valueNoise2(_v1.x * freq / r + _v1.z * 0.7 / r + seed, _v1.y * freq / r + seed * 1.7, seed) - 0.5;
      _v1.multiplyScalar(1 + n * amount * 2);
      p.setXYZ(i, _v1.x, _v1.y, _v1.z);
    }
    g.computeVertexNormals();
    return g;
  },
};

// Generic parametric surface grid. fn(u, v, outVec3), u,v in [0,1]. Winding: CCW when
// u increases to the right and v increases upward as seen from outside.
export function surfaceGrid(nu, nv, fn, { closedU = false, poleBottom = false, poleTop = false, flip = false } = {}) {
  const pos = new Float32Array((nu + 1) * (nv + 1) * 3), uv = new Float32Array((nu + 1) * (nv + 1) * 2), idx = [];
  const p = new THREE.Vector3();
  let k = 0;
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++, k++) {
    fn(i / nu, j / nv, p);
    pos[k * 3] = p.x; pos[k * 3 + 1] = p.y; pos[k * 3 + 2] = p.z;
    uv[k * 2] = i / nu; uv[k * 2 + 1] = j / nv;
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    if (flip) idx.push(a, d, b, a, c, d); else idx.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const n = g.attributes.normal;
  if (closedU) {
    for (let j = 0; j <= nv; j++) {
      const a = j * (nu + 1), b = a + nu;
      _v1.fromBufferAttribute(n, a).add(_v2.fromBufferAttribute(n, b)).normalize();
      n.setXYZ(a, _v1.x, _v1.y, _v1.z); n.setXYZ(b, _v1.x, _v1.y, _v1.z);
    }
  }
  const s = flip ? -1 : 1;
  if (poleBottom) for (let i = 0; i <= nu; i++) n.setXYZ(i, 0, -s, 0);
  if (poleTop) for (let i = 0; i <= nu; i++) n.setXYZ(nv * (nu + 1) + i, 0, s, 0);
  return g;
}

// Ribbon with a thin rectangular section that follows a path (straps, belts, cables)
export function ribbon(points, normals, width, thick) {
  const n = points.length, ring = 4;
  const pos = new Float32Array(n * ring * 3), uv = new Float32Array(n * ring * 2), idx = [];
  const T = new THREE.Vector3(), S = new THREE.Vector3();
  let len = 0;
  for (let i = 0; i < n; i++) {
    const P = points[i], N = normals[i];
    if (i < n - 1) T.subVectors(points[i + 1], P); else T.subVectors(P, points[i - 1]);
    T.normalize();
    S.crossVectors(T, N).normalize();
    if (i > 0) len += P.distanceTo(points[i - 1]);
    const corners = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]];
    for (let c = 0; c < ring; c++) {
      const [sw, nt] = corners[c];
      const k = i * ring + c;
      pos[k * 3] = P.x + S.x * sw * width + N.x * nt * thick;
      pos[k * 3 + 1] = P.y + S.y * sw * width + N.y * nt * thick;
      pos[k * 3 + 2] = P.z + S.z * sw * width + N.z * nt * thick;
      uv[k * 2] = c / 3; uv[k * 2 + 1] = len * 10;
    }
  }
  for (let i = 0; i < n - 1; i++) for (let c = 0; c < ring; c++) {
    const a = i * ring + c, b = i * ring + ((c + 1) % ring), d = a + ring, e = b + ring;
    idx.push(a, d, b, b, d, e);
  }
  // end caps
  for (const i of [0, n - 1]) {
    const o = i * ring;
    if (i === 0) idx.push(o, o + 1, o + 2, o, o + 2, o + 3); else idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Bake per-vertex colours. fn(x,y,z,nx,ny,nz,u,v) -> hex number | THREE.Color
export function paint(g, fn) {
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  const arr = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const c = fn(p.getX(i), p.getY(i), p.getZ(i), n ? n.getX(i) : 0, n ? n.getY(i) : 0, n ? n.getZ(i) : 0, uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    if (typeof c === 'number') _c1.setHex(c); else _c1.copy(c);
    arr[i * 3] = _c1.r; arr[i * 3 + 1] = _c1.g; arr[i * 3 + 2] = _c1.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

export function normGeo(g) {
  if (g.index === null) {
    const n = g.attributes.position.count;
    const a = new Uint32Array(n); for (let i = 0; i < n; i++) a[i] = i;
    g.setIndex(new THREE.BufferAttribute(a, 1));
  }
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.morphAttributes = {};
  g.clearGroups();
  return g;
}

// Merge chunk list [{geo, color, matrix?}] into one plain geometry (with vertex colours)
export function mergeChunks(list) {
  const geos = list.map((c) => {
    const g = normGeo(c.geo.clone());
    if (c.matrix) g.applyMatrix4(c.matrix);
    if (!g.attributes.color) {
      _c1.set(c.color ?? 0xffffff);
      const a = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < a.length; i += 3) { a[i] = _c1.r; a[i + 1] = _c1.g; a[i + 2] = _c1.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    } else if (c.color != null && c.color !== 0xffffff) {
      _c1.set(c.color);
      const a = g.attributes.color.array;
      for (let i = 0; i < a.length; i += 3) { a[i] *= _c1.r; a[i + 1] *= _c1.g; a[i + 2] *= _c1.b; }
    }
    return g;
  });
  const m = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return m;
}

// ============================================================================
// Rig: bones + rigid chunks -> SkinnedMeshes (one per material)
// ============================================================================
export class Rig {
  constructor() {
    this.bones = []; this.b = {};
    this.restP = []; this.restQ = []; this.restS = [];
    this.chunks = []; this.extras = [];
  }
  bone(name, parent = null, p = [0, 0, 0], r = null, order = 'XYZ') {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.rotation.order = order;
    bone.userData.i = this.bones.length;
    this.bones.push(bone);
    this.b[name] = bone;
    this.restP.push(new THREE.Vector3(p[0], p[1], p[2]));
    this.restQ.push(r ? (r.isQuaternion ? r.clone() : new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], order))) : new THREE.Quaternion());
    this.restS.push(new THREE.Vector3(1, 1, 1));
    if (parent) this.b[parent].add(bone);
    bone.position.copy(this.restP[bone.userData.i]);
    bone.quaternion.copy(this.restQ[bone.userData.i]);
    return bone;
  }
  setRest(name, p = null, q = null) {
    const i = this.b[name].userData.i;
    if (p) this.restP[i].set(p[0], p[1], p[2]);
    if (q) this.restQ[i].copy(q.isQuaternion ? q : _q1.setFromEuler(_e1.set(q[0], q[1], q[2], this.b[name].rotation.order)));
    else if (p) this.restQ[i].identity();
  }
  idx(bone) { return (typeof bone === 'string' ? this.b[bone] : bone).userData.i; }
  add(bone, mat, geo, color = 0xffffff) { this.chunks.push({ bone, mat, geo, color }); return geo; }
  attach(bone, obj) { this.extras.push({ bone, obj }); return obj; }
  computeRest() {
    this.restM = this.bones.map(() => new THREE.Matrix4());
    for (let i = 0; i < this.bones.length; i++) {
      const bone = this.bones[i];
      this.restM[i].compose(this.restP[i], this.restQ[i], this.restS[i]);
      if (bone.parent && bone.parent.isBone) this.restM[i].premultiply(this.restM[bone.parent.userData.i]);
    }
    return this.restM;
  }
  reset() {
    for (let i = 0; i < this.bones.length; i++) {
      const b = this.bones[i];
      b.position.copy(this.restP[i]); b.quaternion.copy(this.restQ[i]); b.scale.copy(this.restS[i]);
    }
  }
  // Build skinned meshes. mats: {key: Material} or function(key)->Material
  build(mats, { shadow = true, bounds = null, colorMod = null } = {}) {
    this.computeRest();
    const groups = new Map();
    for (const ch of this.chunks) {
      const bi = this.idx(ch.bone);
      const g = mergeChunks([{ geo: ch.geo, color: ch.color, matrix: this.restM[bi] }]);
      const n = g.attributes.position.count;
      if (colorMod) colorMod(g, ch);
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { si[i * 4] = bi; sw[i * 4] = 1; }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      if (!groups.has(ch.mat)) groups.set(ch.mat, []);
      groups.get(ch.mat).push(g);
    }
    const skeleton = new THREE.Skeleton(this.bones, this.restM.map((m) => m.clone().invert()));
    const meshes = [];
    const bnd = bounds || new THREE.Sphere(new THREE.Vector3(0, 0.7, 0), 1.7);
    for (const [key, list] of groups) {
      const geo = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      const mat = typeof mats === 'function' ? mats(key) : mats[key];
      if (!mat) throw new Error(`Rig: no material '${key}'`);
      const mesh = new THREE.SkinnedMesh(geo, mat);
      mesh.bind(skeleton, new THREE.Matrix4());
      mesh.boundingSphere = bnd.clone();
      mesh.castShadow = shadow && !mat.transparent;
      mesh.receiveShadow = true;
      mesh.name = 'skin_' + key;
      meshes.push(mesh);
    }
    return { meshes, skeleton };
  }
  // Static (non-skinned) meshes grouped by part: partOf(boneName)->partKey|null, centers: {key: Vector3}
  buildStatic(mats, partOf, centers) {
    this.computeRest();
    const parts = {};
    for (const ch of this.chunks) {
      const bn = typeof ch.bone === 'string' ? ch.bone : ch.bone.name;
      const pk = partOf(bn); if (!pk) continue;
      parts[pk] ??= new Map();
      const m = new THREE.Matrix4().makeTranslation(-centers[pk].x, -centers[pk].y, -centers[pk].z).multiply(this.restM[this.idx(bn)]);
      if (!parts[pk].has(ch.mat)) parts[pk].set(ch.mat, []);
      parts[pk].get(ch.mat).push({ geo: ch.geo, color: ch.color, matrix: m });
    }
    const out = {};
    for (const pk in centers) {
      const grp = new THREE.Group(); grp.name = pk;
      out[pk] = grp;
      if (!parts[pk]) continue;
      for (const [key, list] of parts[pk]) {
        const mat = typeof mats === 'function' ? mats(key) : mats[key];
        const mesh = new THREE.Mesh(mergeChunks(list), mat);
        mesh.castShadow = !mat.transparent; mesh.receiveShadow = true;
        grp.add(mesh);
      }
    }
    for (const ex of this.extras) {
      const bn = typeof ex.bone === 'string' ? ex.bone : ex.bone.name;
      const pk = partOf(bn); if (!pk) continue;
      const o = ex.obj;
      o.updateMatrix();
      const m = new THREE.Matrix4().makeTranslation(-centers[pk].x, -centers[pk].y, -centers[pk].z).multiply(this.restM[this.idx(bn)]).multiply(o.matrix);
      m.decompose(o.position, o.quaternion, o.scale);
      out[pk].add(o);
    }
    return out;
  }
}

// Damped spring (scalar)
export class Spring {
  constructor(k = 120, d = 10, x = 0) { this.k = k; this.d = d; this.x = x; this.v = 0; }
  step(dt, target = 0, force = 0) {
    const n = Math.max(1, Math.ceil(dt / 0.016)), h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (this.k * (target - this.x) - this.d * this.v + force) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

// Secondary-motion pivot: reacts to the world-space acceleration of its parent.
// mode 'stand' (mass above pivot, e.g. hats), 'hang' (mass below, ties/tails), 'pack'.
export class Wobble {
  constructor(bone, { k = 90, d = 7, gain = 0.02, mode = 'stand', grav = 0, limit = 0.9 } = {}) {
    this.bone = bone; this.mode = mode; this.gain = gain; this.grav = grav; this.limit = limit;
    this.sx = new Spring(k, d); this.sz = new Spring(k, d);
    this.prev = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.has = false;
    this.acc = new THREE.Vector3();
  }
  update(dt) {
    const parent = this.bone.parent;
    const wp = parent.getWorldPosition(_v3);
    if (!this.has || dt <= 0) { this.prev.copy(wp); this.vel.set(0, 0, 0); this.has = true; return; }
    _v4.subVectors(wp, this.prev).divideScalar(dt);
    if (_v4.lengthSq() > 400) _v4.set(0, 0, 0); // teleport
    this.acc.subVectors(_v4, this.vel).divideScalar(dt);
    this.vel.copy(_v4); this.prev.copy(wp);
    this.acc.clampLength(0, 60);
    parent.getWorldQuaternion(_q2).invert();
    const a = _v4.copy(this.acc).applyQuaternion(_q2);
    const g = this.mode === 'hang' ? -1 : 1;
    let tx = 0, tz = 0;
    if (this.grav) {
      // keep hanging things vertical in world space
      const up = _v3.set(0, 1, 0).applyQuaternion(_q2);
      tx = Math.atan2(-up.z, up.y) * this.grav * -1;
      tz = Math.atan2(up.x, up.y) * this.grav * -1;
    }
    this.sx.step(dt, tx, -a.z * this.gain * this.sx.k * g);
    this.sz.step(dt, tz, a.x * this.gain * this.sz.k * g);
    this.sx.x = clamp(this.sx.x, -this.limit, this.limit);
    this.sz.x = clamp(this.sz.x, -this.limit, this.limit);
    this.bone.rotation.x += this.sx.x;
    this.bone.rotation.z += this.sz.x;
  }
}

// ---------------------------------------------------------------------------
// Process-wide cache (materials, textures, shared geometry)
const MC = new Map();
export function cached(key, fn) { if (!MC.has(key)) MC.set(key, fn()); return MC.get(key); }
export function canvasTex(w, h, draw, { srgb = true } = {}) {
  const t = labelTexture(w, h, draw, srgb);
  t.needsUpdate = true;
  return t;
}
export const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
