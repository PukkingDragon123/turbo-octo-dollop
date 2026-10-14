// R.O.O.M. — doll skeleton + smooth-skin part builder.
//
// Every avatar shares one fixed bone list (indices are stable, so geometry built once can be
// reused by any avatar). Parts are authored either in a bone's local space (rigid binding) or
// directly in rest/model space with a per-vertex weight function (smooth binding: sleeves,
// torso, hood...). A part's output is a Map(materialKey -> BufferGeometry) in rest space with
// position / normal / uv / color / skinIndex / skinWeight, plus rest overrides for the
// cosmetic aux bones it uses (hat, pack, accessory pivots) and secondary-motion springs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, smooth } from './kit.js';
import { SACK, FACE } from './sack.js';

export const DIM = {
  pelvisY: 0.35, hipX: 0.108, thigh: 0.125, shin: 0.125, ankleH: 0.1,
  chestY: 0.385, headY: 0.095, shX: 0.205, upper: 0.13, fore: 0.115, hand: 0.088,
};
// world (rig root) heights at rest
export const Y = {
  pelvis: DIM.pelvisY, chest: DIM.pelvisY + DIM.chestY, head: DIM.pelvisY + DIM.chestY + DIM.headY,
  knee: DIM.pelvisY - DIM.thigh, ankle: DIM.ankleH,
};

const S = (s) => (s === 'L' ? -1 : 1);
const BONE_DEFS = [
  ['pelvis', null, [0, DIM.pelvisY, 0], 'ZXY'],
  ['body', 'pelvis', [0, 0, 0], 'XYZ'],
  ['chest', 'pelvis', [0, DIM.chestY, 0], 'ZXY'],
  ['head', 'chest', [0, DIM.headY, 0], 'YXZ'],
  ['hood', 'head', [0, SACK.cy + 0.06, 0.1], 'XYZ'],
  ['nose', 'head', [0, FACE.noseY, -0.15], 'XYZ'],
  ['eyeL', 'head', [-FACE.eyeX, FACE.eyeY, -0.15], 'XYZ'],
  ['eyeR', 'head', [FACE.eyeX, FACE.eyeY, -0.15], 'XYZ'],
  ['cordL', 'head', [-0.03, 0.02, -0.16], 'XYZ'],
  ['cordR', 'head', [0.03, 0.02, -0.16], 'XYZ'],
  ['hat', 'head', [0, SACK.cy, 0], 'XYZ'],
  ['hatA', 'hat', [0, 0, 0], 'XYZ'],
  ['hatB', 'hat', [0, 0, 0], 'XYZ'],
  ...['L', 'R'].flatMap((s) => [
    ['sh' + s, 'chest', [S(s) * DIM.shX, 0, 0], 'ZXY'],
    ['el' + s, 'sh' + s, [0, -DIM.upper, 0], 'XYZ'],
    ['wr' + s, 'el' + s, [0, -DIM.fore, 0], 'XYZ'],
    ['fi' + s, 'wr' + s, [0, -0.046, 0], 'XYZ'],
    ['th' + s, 'wr' + s, [-S(s) * 0.012, -0.026, -0.024], 'XYZ'],
    ['hip' + s, 'pelvis', [S(s) * DIM.hipX, 0, 0], 'ZXY'],
    ['kn' + s, 'hip' + s, [0, -DIM.thigh, 0], 'XYZ'],
    ['an' + s, 'kn' + s, [0, -DIM.shin, 0], 'ZXY'],
  ]),
  ['pack', 'chest', [0, -0.07, 0.235], 'XYZ'],
  ['packA', 'pack', [0, 0, 0], 'XYZ'],
  ['packB', 'pack', [0, 0, 0], 'XYZ'],
  ['accA', 'chest', [0, 0, 0], 'XYZ'],
  ['accB', 'chest', [0, 0, 0], 'XYZ'],
  ['acc', 'body', [0, 0, 0], 'XYZ'],
];
export const BONE_NAMES = BONE_DEFS.map((d) => d[0]);
export const BI = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]));
export const AUX_BONES = ['hatA', 'hatB', 'packA', 'packB', 'accA', 'accB', 'acc', 'hat', 'pack', 'hood', 'cordL', 'cordR'];

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s1 = new THREE.Vector3(1, 1, 1);
function restOf(i, over) {
  const [name, , p, order] = BONE_DEFS[i];
  const o = over[name];
  const P = new THREE.Vector3().fromArray(o?.p || p);
  const Q = new THREE.Quaternion();
  if (o?.q) { if (o.q.isQuaternion) Q.copy(o.q); else Q.setFromEuler(_e.set(o.q[0], o.q[1], o.q[2], order)); }
  return { P, Q };
}
// rest world matrices (rig-root space) for a set of overrides
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
// live bones for an avatar
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
// Weight functions (rest-space positions). Each writes up to 4 [boneIndex, weight] pairs.
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
const ss = (a, b, x) => smooth(clamp((x - a) / (b - a), 0, 1));

// torso: pelvis (crotch) -> body (belly, squash) -> chest; shoulders lean on the arm bones,
// the lower sides follow the thighs a little so the baggy suit swings with the walk
export function torsoW(x, y, z, o) {
  o.reset();
  const c = ss(Y.pelvis + 0.09, Y.chest - 0.07, y);
  const pv = 1 - ss(Y.pelvis - 0.08, Y.pelvis + 0.01, y);
  let rest = 1;
  const ax = Math.abs(x), side = x < 0 ? 'L' : 'R';
  const sh = ss(0.15, 0.21, ax) * ss(Y.chest - 0.09, Y.chest - 0.02, y) * 0.55;
  if (sh > 0) { o.add('sh' + side, sh); rest -= sh; }
  const hp = ss(0.04, 0.12, ax) * (1 - ss(Y.pelvis - 0.06, Y.pelvis + 0.03, y)) * 0.45;
  if (hp > 0) { o.add('hip' + side, hp * rest); rest -= hp * rest; }
  o.add('chest', c * rest);
  o.add('pelvis', (1 - c) * pv * rest);
  o.add('body', (1 - c) * (1 - pv) * rest);
  return o;
}
// sleeve: along the hanging arm (dy = distance below the shoulder joint)
export function armW(side, keepWrist = false) {
  const sh = 'sh' + side, el = 'el' + side, wr = 'wr' + side;
  return (x, y, z, o) => {
    o.reset();
    const dy = Y.chest - y;
    const cap = 1 - ss(-0.04, 0.035, dy);
    const e = ss(DIM.upper - 0.035, DIM.upper + 0.035, dy);
    const wv = keepWrist ? ss(DIM.upper + DIM.fore - 0.02, DIM.upper + DIM.fore + 0.01, dy) : 0;
    o.add('chest', cap * 0.45);
    const r = 1 - cap * 0.45;
    o.add(sh, (1 - e) * r);
    o.add(el, e * (1 - wv) * r);
    o.add(wr, e * wv * r);
    return o;
  };
}
// suit leg: hip -> knee -> (cuff over the boot follows the ankle)
export function legW(side) {
  const hip = 'hip' + side, kn = 'kn' + side, an = 'an' + side;
  return (x, y, z, o) => {
    o.reset();
    const dy = Y.pelvis - y;
    const top = 1 - ss(-0.03, 0.05, dy);
    const k = ss(DIM.thigh - 0.04, DIM.thigh + 0.035, dy);
    const a = ss(Y.ankle + 0.105, Y.ankle + 0.07, y);
    o.add('pelvis', top * 0.5);
    const r = 1 - top * 0.5;
    o.add(hip, (1 - k) * r);
    o.add(kn, k * (1 - a) * r);
    o.add(an, k * a * r);
    return o;
  };
}
// hood: the head, its back flops on 'hood', the bottom near the collar leans on the chest
export function hoodW(x, y, z, o) {
  o.reset();
  const ly = y - Y.head;                                 // head-bone height
  const low = 1 - ss(-0.03, 0.07, ly);
  const back = ss(0.02, 0.2, z) * ss(0.05, 0.3, ly) * 0.55;
  o.add('chest', low * 0.65);
  const r = 1 - low * 0.65;
  o.add('hood', back * r);
  o.add('head', (1 - back) * r);
  return o;
}

// ---------------------------------------------------------------------------
// Part builder
// ---------------------------------------------------------------------------
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

export class PartBuilder {
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
  // geometry authored in the bone's local space, bound rigidly
  rigid(bone, mat, geo, color = 0xffffff) {
    const g = prep(geo);
    colorize(g, color);
    g.applyMatrix4(this.M[BI[bone]]);
    const n = g.attributes.position.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), bi = BI[bone];
    for (let i = 0; i < n; i++) { si[i * 4] = bi; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    this._push(mat, g);
    return g;
  }
  // geometry already in rest space; fn(x, y, z, W) assigns weights
  skinned(mat, geo, fn, color = 0xffffff) {
    const g = prep(geo);
    colorize(g, color);
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
  // geometry in bone-local space but smoothly weighted (fn gets rest-space positions)
  boneSkinned(bone, mat, geo, fn, color = 0xffffff) {
    const g = prep(geo);
    g.applyMatrix4(this.M[BI[bone]]);
    return this.skinned(mat, g, fn, color);
  }
  // transform a bone-local point to rest space
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

// merge several finished parts into one Map(material -> geometry)
export function mergeParts(parts) {
  const by = new Map();
  for (const p of parts) for (const [mat, g] of p.geos) { if (!by.has(mat)) by.set(mat, []); by.get(mat).push(g); }
  const out = new Map();
  for (const [mat, list] of by) out.set(mat, list.length === 1 ? list[0] : mergeGeometries(list, false));
  return out;
}
