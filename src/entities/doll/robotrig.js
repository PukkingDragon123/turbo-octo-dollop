// R.O.O.M. — clone android skeleton + smooth-skin part builder.
//
// The android is authored at true human scale (1.70 m, DESIGN units) and the whole rig is scaled
// by ROBOT_SCALE on the avatar's rig root so it fits the clone's collider / eye height
// (player.js: 1.36 m capsule, eye at 1.16 m). Change ROBOT_SCALE (and the gameplay constants listed
// in the avatar header) to make the clones taller.
//
// One fixed bone list shared by every android (indices are stable so cached geometry works for any
// avatar). Bone order matters for the coverall shader in dollmat.js: 0..2 are the torso bones
// (pelvis, spine, chest), 3..4 neck / head. A part's output is a Map(materialKey -> BufferGeometry)
// in rest space with position / normal / uv / color / skinIndex / skinWeight, plus rest overrides
// (face bones per eye layout, cosmetic pivots) and secondary-motion springs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, smooth } from './kit.js';
import { faceBoneRests, HC } from './robotshape.js';

export const ROBOT_SCALE = 0.86;   // 1.70 m design -> 1.46 m in game (eyes ~1.38 m)

export const RD = {
  hipY: 0.925, hipX: 0.088, thigh: 0.425, shin: 0.415, ankleH: 0.085,
  spineY: 0.115, chestY: 0.175, shX: 0.172, shY: 0.185, neckY: 0.225, headY: 0.07,
  upper: 0.29, fore: 0.255, palm: 0.092, hand: 0.18,
};
// rest heights (rig root at the feet)
export const RY = {
  pelvis: RD.hipY, spine: RD.hipY + RD.spineY, chest: RD.hipY + RD.spineY + RD.chestY,
  sh: RD.hipY + RD.spineY + RD.chestY + RD.shY,
  neck: RD.hipY + RD.spineY + RD.chestY + RD.neckY,
  head: RD.hipY + RD.spineY + RD.chestY + RD.neckY + RD.headY,
  knee: RD.hipY - RD.thigh, ankle: RD.ankleH,
};
RY.elbow = RY.sh - RD.upper; RY.wrist = RY.elbow - RD.fore;
export const NECK_Z = 0.012, HEAD_Z = -0.004;

const S = (s) => (s === 'L' ? -1 : 1);
const FR = faceBoneRests('normal');
const BONE_DEFS = [
  ['pelvis', null, [0, RD.hipY, 0], 'ZXY'],
  ['spine', 'pelvis', [0, RD.spineY, 0], 'ZXY'],
  ['chest', 'spine', [0, RD.chestY, 0], 'ZXY'],
  ['neck', 'chest', [0, RD.neckY, NECK_Z], 'XYZ'],
  ['head', 'neck', [0, RD.headY, HEAD_Z], 'YXZ'],
  ['jaw', 'head', FR.jaw, 'XYZ'],
  ['eyeL', 'head', FR.eyeL, 'YXZ'],
  ['eyeR', 'head', FR.eyeR, 'YXZ'],
  ['ledL', 'eyeL', [0, 0, 0], 'XYZ'],
  ['ledR', 'eyeR', [0, 0, 0], 'XYZ'],
  ['lidUL', 'head', FR.lidL, 'XYZ'],
  ['lidUR', 'head', FR.lidR, 'XYZ'],
  ['lidDL', 'head', FR.lidL, 'XYZ'],
  ['lidDR', 'head', FR.lidR, 'XYZ'],
  ['browL', 'head', FR.browL, 'XYZ'],
  ['browR', 'head', FR.browR, 'XYZ'],
  ['hat', 'head', HC.toArray(), 'XYZ'],
  ['hatA', 'hat', [0, 0, 0], 'XYZ'],
  ['hatB', 'hat', [0, 0, 0], 'XYZ'],
  ...['L', 'R'].flatMap((s) => [
    ['sh' + s, 'chest', [S(s) * RD.shX, RD.shY, 0], 'ZXY'],
    ['el' + s, 'sh' + s, [0, -RD.upper, 0], 'XYZ'],
    ['wr' + s, 'el' + s, [0, -RD.fore, 0], 'XYZ'],
    ['fi' + s, 'wr' + s, [0, -RD.palm, 0], 'XYZ'],
    ['fj' + s, 'fi' + s, [0, -0.046, 0], 'XYZ'],
    ['ix' + s, 'wr' + s, [0, -RD.palm, -0.0272], 'XYZ'],
    ['th' + s, 'wr' + s, [-S(s) * 0.012, -0.03, -0.03], 'XYZ'],
    ['hip' + s, 'pelvis', [S(s) * RD.hipX, 0, 0], 'ZXY'],
    ['kn' + s, 'hip' + s, [0, -RD.thigh, 0], 'XYZ'],
    ['an' + s, 'kn' + s, [0, -RD.shin, 0], 'ZXY'],
  ]),
  ['pack', 'chest', [0, 0.1, 0.12], 'XYZ'],
  ['packA', 'pack', [0, 0, 0], 'XYZ'],
  ['packB', 'pack', [0, 0, 0], 'XYZ'],
  ['accA', 'chest', [0, 0, 0], 'XYZ'],
  ['accB', 'chest', [0, 0, 0], 'XYZ'],
  ['acc', 'pelvis', [0, 0, 0], 'XYZ'],
];
export const BONE_NAMES = BONE_DEFS.map((d) => d[0]);
export const BI = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]));
export const HEAD_BONES = new Set(['head', 'jaw', 'eyeL', 'eyeR', 'ledL', 'ledR', 'lidUL', 'lidUR', 'lidDL', 'lidDR', 'browL', 'browR', 'hat', 'hatA', 'hatB']);

const _e = new THREE.Euler(), _s1 = new THREE.Vector3(1, 1, 1);
function restOf(i, over) {
  const [name, , p, order] = BONE_DEFS[i];
  const o = over[name];
  const P = new THREE.Vector3().fromArray(o?.p || p);
  const Q = new THREE.Quaternion();
  if (o?.q) { if (o.q.isQuaternion) Q.copy(o.q); else Q.setFromEuler(_e.set(o.q[0], o.q[1], o.q[2], order)); }
  return { P, Q };
}
export function restMatrices(over = {}) {
  const M = [];
  for (let i = 0; i < BONE_DEFS.length; i++) {
    const { P, Q } = restOf(i, over);
    const m = new THREE.Matrix4().compose(P, Q, _s1);
    const par = BONE_DEFS[i][1];
    if (par) m.premultiply(M[BI[par]]);
    M.push(m);
  }
  return M;
}
export function makeBones(over = {}) {
  const bones = [], b = {}, restP = [], restQ = [];
  for (let i = 0; i < BONE_DEFS.length; i++) {
    const [name, par, , order] = BONE_DEFS[i];
    const bone = new THREE.Bone(); bone.name = name; bone.rotation.order = order;
    const { P, Q } = restOf(i, over);
    restP.push(P); restQ.push(Q);
    bone.position.copy(P); bone.quaternion.copy(Q);
    if (par) b[par].add(bone);
    bones.push(bone); b[name] = bone;
  }
  return { bones, b, restP, restQ };
}
export function setBoneRest(rig, over) {
  for (let i = 0; i < BONE_DEFS.length; i++) {
    const { P, Q } = restOf(i, over);
    rig.restP[i].copy(P); rig.restQ[i].copy(Q);
  }
}

// ---------------------------------------------------------------------------
// Weight functions (rest-space positions)
// ---------------------------------------------------------------------------
export class W {
  constructor() { this.i = [0, 0, 0, 0]; this.w = [0, 0, 0, 0]; this.n = 0; }
  reset() { this.n = 0; return this; }
  add(bone, w) {
    if (w <= 1e-4) return this;
    const bi = typeof bone === 'number' ? bone : BI[bone];
    for (let k = 0; k < this.n; k++) if (this.i[k] === bi) { this.w[k] += w; return this; }
    if (this.n < 4) { this.i[this.n] = bi; this.w[this.n] = w; this.n++; }
    else { let m = 0; for (let k = 1; k < 4; k++) if (this.w[k] < this.w[m]) m = k; if (w > this.w[m]) { this.i[m] = bi; this.w[m] = w; } }
    return this;
  }
}
export const ss = (a, b, x) => smooth(clamp((x - a) / (b - a), 0, 1));

// coverall torso: pelvis -> spine -> chest, shoulders lean on the arm bones, the crotch / seat on the thighs
export function torsoW(x, y, z, o) {
  o.reset();
  const ax = Math.abs(x), side = x < 0 ? 'L' : 'R';
  let rest = 1;
  const sh = ss(0.1, 0.18, ax) * ss(RY.sh - 0.13, RY.sh - 0.03, y) * 0.7;
  if (sh > 0) { o.add('sh' + side, sh); rest -= sh; }
  const hp = ss(0.015, 0.085, ax) * (1 - ss(RY.pelvis - 0.07, RY.pelvis + 0.035, y)) * 0.7;
  if (hp > 0) { o.add('hip' + side, hp * rest); rest -= hp * rest; }
  const c = ss(RY.spine - 0.01, RY.chest + 0.03, y);
  const sp = ss(RY.pelvis + 0.02, RY.spine + 0.02, y);
  o.add('chest', c * rest);
  o.add('spine', (1 - c) * sp * rest);
  o.add('pelvis', (1 - c) * (1 - sp) * rest);
  return o;
}
// sleeve / upper arm (dy = distance below the shoulder joint)
export function armW(side) {
  const sh = 'sh' + side, el = 'el' + side;
  return (x, y, z, o) => {
    o.reset();
    const dy = RY.sh - y;
    const cap = 1 - ss(-0.03, 0.05, dy);
    const e = ss(RD.upper - 0.03, RD.upper + 0.025, dy);
    o.add('chest', cap * 0.5);
    const r = 1 - cap * 0.5;
    o.add(sh, (1 - e) * r);
    o.add(el, e * r);
    return o;
  };
}
// trouser leg: pelvis -> hip -> knee -> ankle
export function legW(side) {
  const hip = 'hip' + side, kn = 'kn' + side, an = 'an' + side;
  return (x, y, z, o) => {
    o.reset();
    const dy = RY.pelvis - y;
    const top = 1 - ss(-0.04, 0.06, dy);
    const k = ss(RD.thigh - 0.05, RD.thigh + 0.04, dy);
    const a = ss(RY.ankle + 0.07, RY.ankle + 0.02, y);
    o.add('pelvis', top * 0.45);
    const r = 1 - top * 0.45;
    o.add(hip, (1 - k) * r);
    o.add(kn, k * (1 - a) * r);
    o.add(an, k * a * r);
    return o;
  };
}
// neck: chest at the collar -> neck -> head under the skull
export function neckW(x, y, z, o) {
  o.reset();
  const t = (y - RY.neck) / (RY.head - RY.neck);
  const c = 1 - ss(-0.25, 0.25, t), h = ss(0.65, 1.15, t);
  o.add('chest', c);
  o.add('head', h * (1 - c));
  o.add('neck', (1 - c) * (1 - h));
  return o;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
// planar box-projection UVs in metres (for the tiling ABS / rubber textures)
export function boxUV(g, scale = 1) {
  const P = g.attributes.position, N = g.attributes.normal;
  let uv = g.attributes.uv;
  if (!uv) { uv = new THREE.BufferAttribute(new Float32Array(P.count * 2), 2); g.setAttribute('uv', uv); }
  for (let i = 0; i < P.count; i++) {
    const nx = Math.abs(N.getX(i)), ny = Math.abs(N.getY(i)), nz = Math.abs(N.getZ(i));
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    if (nx >= ny && nx >= nz) uv.setXY(i, z * scale, y * scale);
    else if (ny >= nz) uv.setXY(i, x * scale, z * scale);
    else uv.setXY(i, x * scale, y * scale);
  }
  return g;
}

const _c = new THREE.Color();
function prep(g) {
  if (g.index === null) {
    const n = g.attributes.position.count, a = new Uint32Array(n);
    for (let i = 0; i < n; i++) a[i] = i;
    g.setIndex(new THREE.BufferAttribute(a, 1));
  }
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.morphAttributes = {};
  g.clearGroups();
  return g;
}
function colorize(g, color) {
  const n = g.attributes.position.count;
  if (!g.attributes.color) {
    _c.set(color ?? 0xffffff);
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  } else if (color != null && color !== 0xffffff) {
    _c.set(color);
    const a = g.attributes.color.array;
    for (let i = 0; i < a.length; i += 3) { a[i] *= _c.r; a[i + 1] *= _c.g; a[i + 2] *= _c.b; }
  }
}
const _w = new W();

// materials whose geometry gets box-projected metre UVs automatically (tiling textures)
const AUTO_UV = new Set(['shell', 'rubber', 'plastic']);

export class RPartBuilder {
  constructor(over = {}) {
    this.over = { ...over };
    this.M = restMatrices(this.over);
    this.lists = new Map();
    this.springs = {};
    this.info = {};
  }
  setRest(name, p, q = null) {
    this.over[name] = { p, q };
    this.M = restMatrices(this.over);
  }
  restPos(name, out = new THREE.Vector3()) { return out.setFromMatrixPosition(this.M[BI[name]]); }
  _push(mat, g) { if (!this.lists.has(mat)) this.lists.set(mat, []); this.lists.get(mat).push(g); }
  // geometry authored in the bone's local space, bound rigidly. opts.uv: false keeps the given UVs
  rigid(bone, mat, geo, color = 0xffffff, opts = {}) {
    const g = prep(geo);
    colorize(g, color);
    g.applyMatrix4(this.M[BI[bone]]);
    if (AUTO_UV.has(mat) && opts.uv !== false) boxUV(g, opts.uvScale ?? 1);
    const n = g.attributes.position.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), bi = BI[bone];
    for (let i = 0; i < n; i++) { si[i * 4] = bi; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    this._push(mat, g);
    return g;
  }
  // geometry already in rest space; fn(x, y, z, W) assigns weights
  skinned(mat, geo, fn, color = 0xffffff, opts = {}) {
    const g = prep(geo);
    colorize(g, color);
    if (AUTO_UV.has(mat) && opts.uv !== false) boxUV(g, opts.uvScale ?? 1);
    const P = g.attributes.position, n = P.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      fn(P.getX(i), P.getY(i), P.getZ(i), _w);
      let tot = 0; for (let k = 0; k < _w.n; k++) tot += _w.w[k];
      if (tot <= 0) { _w.reset().add('pelvis', 1); tot = 1; }
      for (let k = 0; k < _w.n; k++) { si[i * 4 + k] = _w.i[k]; sw[i * 4 + k] = _w.w[k] / tot; }
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    this._push(mat, g);
    return g;
  }
  // bone-local geometry, smoothly weighted (fn gets rest-space positions)
  boneSkinned(bone, mat, geo, fn, color = 0xffffff, opts = {}) {
    const g = prep(geo);
    g.applyMatrix4(this.M[BI[bone]]);
    return this.skinned(mat, g, fn, color, opts);
  }
  toRest(bone, p, out = new THREE.Vector3()) { return out.copy(p).applyMatrix4(this.M[BI[bone]]); }
  finish() {
    const geos = new Map();
    for (const [mat, list] of this.lists) {
      const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (list.length > 1) for (const x of list) x.dispose();
      geos.set(mat, g);
    }
    this.lists.clear();
    return { geos, over: this.over, springs: this.springs, info: this.info };
  }
}
