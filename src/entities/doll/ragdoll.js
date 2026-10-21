// R.O.O.M. — ragdoll pieces for dead clone androids. The skinned avatar geometry (same cosmetics)
// is posed on the CPU with a "powered-down" face (LED pupils dark, jaw hanging open, lids half shut)
// and split by dominant bone into six rigid parts (torso, head, arms, legs); triangles near a joint go
// to both neighbours so a flopping limb never opens a hole. Everything is scaled to the in-game size
// (ROBOT_SCALE). Geometry is cached per cosmetics combination; meshes are fresh each call.
//
// buildRagdoll(cosmetics) -> { parts: { torso: {mesh, half}, head: {mesh, radius},
//   armL/armR/legL/legR: {mesh, radius, halfHeight} }, joints: [{a, b, anchorA, anchorB}], pose }
import * as THREE from 'three';
import { BONE_NAMES, BI, RD, RY, ROBOT_SCALE, makeBones, restMatrices, HEAD_BONES } from './robotrig.js';
import { HC } from './robotshape.js';
import { badgeDigitsGeo } from './robotbody.js';
import { robotMaterial, ROBOT_MAT_FLAGS } from './robotmat.js';
import { resolveCos } from './dollcos.js';
import { partsFor, cosKey } from './doll_avatar.js';
import { makeMorph } from './robotmorph.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const SC = ROBOT_SCALE;
function partOfBone(n) {
  if (HEAD_BONES.has(n) || n === 'neck') return 'head';
  let m = /^(sh|el|wr|fi|fj|ix|th)([LR])$/.exec(n); if (m) return 'arm' + m[2];
  m = /^(hip|kn|an)([LR])$/.exec(n); if (m) return 'leg' + m[2];
  return 'torso';
}
const PART_NAMES = ['torso', 'head', 'armL', 'armR', 'legL', 'legR'];
const PI_OF = BONE_NAMES.map((n) => PART_NAMES.indexOf(partOfBone(n)));

const ARM_LEN = RD.upper + RD.fore + RD.hand;
const ARM_OUT = 0.016, ARM_R = 0.046, LEG_R = 0.062, HEAD_R = 0.112;
// physics body origins (design rest space) and visual shifts per part
function frames() {
  const armCy = RY.sh - ARM_LEN / 2 + 0.03;
  return {
    torso: { o: V(0, (RY.pelvis + RY.sh) / 2 - 0.02, 0.0), shift: V() },
    head: { o: V(0, RY.head + HC.y, HC.z), shift: V() },
    armL: { o: V(-(RD.shX + ARM_OUT), armCy, 0), shift: V(-ARM_OUT, 0, 0) },
    armR: { o: V(RD.shX + ARM_OUT, armCy, 0), shift: V(ARM_OUT, 0, 0) },
    legL: { o: V(-RD.hipX, RY.pelvis / 2, 0), shift: V() },
    legR: { o: V(RD.hipX, RY.pelvis / 2, 0), shift: V() },
  };
}

// CPU-skin a part geometry into the powered-down pose
function poseSkin(g, S) {
  const P = g.attributes.position, N = g.attributes.normal, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
  const n = P.count, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  const v = V(), nn = V(), acc = V(), accN = V(), tmp = V();
  const nm = new THREE.Matrix3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(P, i); nn.fromBufferAttribute(N, i);
    acc.set(0, 0, 0); accN.set(0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const w = SW.getComponent(i, k); if (w <= 0) continue;
      const m = S[SI.getComponent(i, k)];
      acc.addScaledVector(tmp.copy(v).applyMatrix4(m), w);
      accN.addScaledVector(tmp.copy(nn).applyMatrix3(nm.getNormalMatrix(m)), w);
    }
    accN.normalize();
    pos[i * 3] = acc.x; pos[i * 3 + 1] = acc.y; pos[i * 3 + 2] = acc.z;
    nor[i * 3] = accN.x; nor[i * 3 + 1] = accN.y; nor[i * 3 + 2] = accN.z;
  }
  const out = g.clone();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
function deadSkinMatrices(over) {
  const rig = makeBones(over), b = rig.b;
  const root = new THREE.Object3D(); root.add(b.pelvis);
  b.jaw.rotation.x = -0.24;
  for (const S of ['L', 'R']) {
    b['led' + S].scale.setScalar(0.0001);
    b['lidU' + S].rotation.x = -(1 - (S === 'L' ? 0.4 : 0.6)) * 0.88;
    b['lidD' + S].rotation.x = 0.1 * 0.52;
    b['eye' + S].rotation.set(0.12, S === 'L' ? 0.1 : -0.05, 0);
    b['fi' + S].rotation.z = (S === 'L' ? 1 : -1) * 0.5;
    b['fj' + S].rotation.z = (S === 'L' ? 1 : -1) * 0.4;
  }
  root.updateMatrixWorld(true);
  const rest = restMatrices(over);
  return rig.bones.map((bone, i) => bone.matrixWorld.clone().multiply(rest[i].clone().invert()));
}

// split one skinned geometry into per-part static geometries (part-local coordinates, in-game scale)
function splitGeo(g, F, out, mat) {
  const P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv, C = g.attributes.color;
  const SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
  const n = P.count, np = PART_NAMES.length;
  const pw = new Float32Array(n * np);
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) { const w = SW.getComponent(i, k); if (w > 0) pw[i * np + PI_OF[SI.getComponent(i, k)]] += w; }
  const I = g.index.array;
  const tris = PART_NAMES.map(() => []);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    let best = 0, bw = -1, any = false;
    for (let p = 0; p < np; p++) {
      const w = (pw[a * np + p] + pw[b * np + p] + pw[c * np + p]) / 3;
      if (w > bw) { bw = w; best = p; }
      if (w >= 0.3) { tris[p].push(a, b, c); any = true; }
    }
    if (!any) tris[best].push(a, b, c);
  }
  for (let p = 0; p < np; p++) {
    const list = tris[p]; if (!list.length) continue;
    const name = PART_NAMES[p], fr = F[name];
    const map = new Map(), pos = [], nor = [], uv = [], col = [], idx = [];
    for (const v of list) {
      let j = map.get(v);
      if (j === undefined) {
        j = map.size; map.set(v, j);
        pos.push((P.getX(v) + fr.shift.x - fr.o.x) * SC, (P.getY(v) + fr.shift.y - fr.o.y) * SC, (P.getZ(v) + fr.shift.z - fr.o.z) * SC);
        nor.push(N.getX(v), N.getY(v), N.getZ(v)); uv.push(UV.getX(v), UV.getY(v));
        if (C) col.push(C.getX(v), C.getY(v), C.getZ(v)); else col.push(1, 1, 1);
      }
      idx.push(j);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    if (!out[name].has(mat)) out[name].set(mat, []);
    out[name].get(mat).push(geo);
  }
}

const CACHE = new Map();
function ragGeometry(cos) {
  const key = cosKey(cos);
  if (CACHE.has(key)) return CACHE.get(key);
  const F = frames();
  const out = Object.fromEntries(PART_NAMES.map((n) => [n, new Map()]));
  const parts = partsFor(cos);
  let over = {}; for (const p of parts) Object.assign(over, p.over);
  const mo = makeMorph(cos, over);
  if (mo) over = mo.over;
  const S = deadSkinMatrices(over);
  for (const p of parts) for (const [mat, g0] of p.geos) { const g = mo ? mo.geo(g0, mat) : g0; const posed = poseSkin(g, S); splitGeo(posed, F, out, mat); posed.dispose(); if (g !== g0) g.dispose(); }
  const digits = badgeDigitsGeo(String(1000 + Math.floor(Math.random() * 8999)));
  splitGeo(digits, F, out, 'decal');
  digits.dispose();
  const res = {};
  for (const name of PART_NAMES) {
    res[name] = new Map();
    for (const [mat, list] of out[name]) res[name].set(mat, list.length === 1 ? list[0] : mergeList(list));
  }
  CACHE.set(key, res);
  return res;
}
function mergeList(list) {
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3), idx = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, ov * 3); nor.set(g.attributes.normal.array, ov * 3); uv.set(g.attributes.uv.array, ov * 2); col.set(g.attributes.color.array, ov * 3);
    const I = g.index.array; for (let k = 0; k < I.length; k++) idx[oi + k] = I[k] + ov;
    ov += g.attributes.position.count; oi += I.length;
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

export function buildRagdoll(cosmetics = {}) {
  const cos = resolveCos(cosmetics);
  const geos = ragGeometry(cos);
  const F = frames();
  const groups = {};
  for (const name of PART_NAMES) {
    const grp = new THREE.Group(); grp.name = 'ragdoll_' + name;
    for (const [key, g] of geos[name]) {
      const mat = robotMaterial(key, cos);
      const m = new THREE.Mesh(g, mat);
      const fl = ROBOT_MAT_FLAGS[key] || {};
      m.castShadow = fl.shadow !== false && !mat.transparent; m.receiveShadow = true;
      if (fl.order) m.renderOrder = fl.order;
      grp.add(m);
    }
    groups[name] = grp;
  }
  const pose = Object.fromEntries(PART_NAMES.map((n) => [n, F[n].o.clone().multiplyScalar(SC).toArray()]));
  const rel = (name, w) => [w[0] * SC - pose[name][0], w[1] * SC - pose[name][1], w[2] * SC - pose[name][2]];
  const neck = [0, RY.neck + 0.02, 0.01];
  const shL = [-(RD.shX + 0.01), RY.sh, 0], shR = [RD.shX + 0.01, RY.sh, 0];
  const hipL = [-RD.hipX, RD.hipY - 0.02, 0], hipR = [RD.hipX, RD.hipY - 0.02, 0];
  const joints = [
    { a: 'torso', b: 'head', anchorA: rel('torso', neck), anchorB: rel('head', neck) },
    { a: 'torso', b: 'armL', anchorA: rel('torso', shL), anchorB: rel('armL', shL) },
    { a: 'torso', b: 'armR', anchorA: rel('torso', shR), anchorB: rel('armR', shR) },
    { a: 'torso', b: 'legL', anchorA: rel('torso', hipL), anchorB: rel('legL', hipL) },
    { a: 'torso', b: 'legR', anchorA: rel('torso', hipR), anchorB: rel('legR', hipR) },
  ];
  const armHH = Math.max(0.02, (ARM_LEN / 2 - ARM_R) * SC), legHH = Math.max(0.02, (RY.pelvis / 2 - LEG_R) * SC);
  const parts = {
    torso: { mesh: groups.torso, half: [0.165 * SC, 0.27 * SC, 0.11 * SC] },
    head: { mesh: groups.head, radius: HEAD_R * SC },
    armL: { mesh: groups.armL, radius: ARM_R * SC, halfHeight: armHH },
    armR: { mesh: groups.armR, radius: ARM_R * SC, halfHeight: armHH },
    legL: { mesh: groups.legL, radius: LEG_R * SC, halfHeight: legHH },
    legR: { mesh: groups.legR, radius: LEG_R * SC, halfHeight: legHH },
  };
  return { parts, joints, pose };
}
void BI;
