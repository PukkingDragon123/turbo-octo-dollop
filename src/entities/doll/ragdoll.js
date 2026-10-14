// R.O.O.M. — ragdoll pieces for dead dolls. The skinned avatar geometry (same cosmetics, dead
// face) is split by dominant bone into six rigid parts (torso, head, arms, legs); triangles near
// a joint go to both neighbours so a flopping limb never opens a hole. Geometry is cached per
// cosmetics combination (buildRagdoll runs once per body part prop), meshes are fresh each call.
//
// buildRagdoll(cosmetics) -> { parts: { torso: {mesh, half}, head: {mesh, radius},
//   armL/armR/legL/legR: {mesh, radius, halfHeight} }, joints: [{a, b, anchorA, anchorB}], pose }
import * as THREE from 'three';
import { BONE_NAMES, BI, DIM, Y, restMatrices } from './dollrig.js';
import { SACK } from './sack.js';
import { FaceRig, mouthParams } from './face.js';
import { badgeDigitsGeo } from './gear.js';
import { dollMaterial, MAT_FLAGS } from './dollmat.js';
import { resolveCos } from './dollcos.js';
import { partsFor, cosKey } from './doll_avatar.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const HEAD_B = new Set(['head', 'hood', 'nose', 'eyeL', 'eyeR', 'cordL', 'cordR', 'hat', 'hatA', 'hatB']);
function partOfBone(n) {
  if (HEAD_B.has(n)) return 'head';
  let m = /^(sh|el|wr|fi|th)([LR])$/.exec(n); if (m) return 'arm' + m[2];
  m = /^(hip|kn|an)([LR])$/.exec(n); if (m) return 'leg' + m[2];
  return 'torso';
}
const PART_NAMES = ['torso', 'head', 'armL', 'armR', 'legL', 'legR'];
const PI_OF = BONE_NAMES.map((n) => PART_NAMES.indexOf(partOfBone(n)));

const ARM_LEN = DIM.upper + DIM.fore + DIM.hand;
const ARM_OUT = 0.065, ARM_R = 0.066, LEG_R = 0.086;
// physics body origins (rest space) and visual shifts per part
function frames() {
  const armCy = Y.chest - ARM_LEN / 2 + 0.03;
  return {
    torso: { o: V(0, 0.58, 0.04), shift: V() },
    head: { o: V(0, Y.head + SACK.cy, 0), shift: V() },
    armL: { o: V(-(DIM.shX + ARM_OUT), armCy, 0), shift: V(-ARM_OUT, 0, 0) },
    armR: { o: V(DIM.shX + ARM_OUT, armCy, 0), shift: V(ARM_OUT, 0, 0) },
    legL: { o: V(-DIM.hipX, DIM.pelvisY / 2, 0), shift: V() },
    legR: { o: V(DIM.hipX, DIM.pelvisY / 2, 0), shift: V() },
  };
}

// split one skinned geometry into per-part static geometries (part-local coordinates)
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
        pos.push(P.getX(v) + fr.shift.x - fr.o.x, P.getY(v) + fr.shift.y - fr.o.y, P.getZ(v) + fr.shift.z - fr.o.z);
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
  const key = cosKey(cos) + '|' + cos.skin;
  if (CACHE.has(key)) return CACHE.get(key);
  const F = frames();
  const out = Object.fromEntries(PART_NAMES.map((n) => [n, new Map()]));
  const parts = partsFor(cos);
  const over = {}; for (const p of parts) Object.assign(over, p.over);
  for (const p of parts) for (const [mat, g] of p.geos) splitGeo(g, F, out, mat);
  // badge digits (a random clone number) + the dead face
  const digits = badgeDigitsGeo(String(1000 + Math.floor(Math.random() * 8999)));
  const n = digits.attributes.position.count;
  digits.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  digits.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4).map((v, i) => (i % 4 === 0 ? BI.chest : 0)), 4));
  digits.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((v, i) => (i % 4 === 0 ? 1 : 0)), 4));
  splitGeo(digits, F, out, 'decal');
  const M = restMatrices(over);
  const face = new FaceRig(cos.faceEntry, { headRest: V().setFromMatrixPosition(M[BI.head]), noseMatrix: M[BI.nose], dead: true });
  face.update({ browY: [0.004, -0.002], browRot: [0.25, 0.25], browArch: 0, mouth: mouthParams('tongue'), eyeOpen: [1, 1], eyeMode: 0, x: 1, blush: 0, t: 0 });
  splitGeo(face.geometry, F, out, 'felt');
  // merge per part / material
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
      const mat = dollMaterial(key, cos);
      const m = new THREE.Mesh(g, mat);
      const fl = MAT_FLAGS[key] || {};
      m.castShadow = fl.shadow !== false && !mat.transparent; m.receiveShadow = true;
      if (fl.order) m.renderOrder = fl.order;
      grp.add(m);
    }
    groups[name] = grp;
  }
  const pose = Object.fromEntries(PART_NAMES.map((n) => [n, F[n].o.toArray()]));
  const rel = (name, w) => [w[0] - pose[name][0], w[1] - pose[name][1], w[2] - pose[name][2]];
  const neck = [0, Y.head + 0.01, 0];
  const shL = [-(DIM.shX + 0.02), Y.chest, 0], shR = [DIM.shX + 0.02, Y.chest, 0];
  const hipL = [-DIM.hipX, DIM.pelvisY - 0.03, 0], hipR = [DIM.hipX, DIM.pelvisY - 0.03, 0];
  const joints = [
    { a: 'torso', b: 'head', anchorA: rel('torso', neck), anchorB: rel('head', neck) },
    { a: 'torso', b: 'armL', anchorA: rel('torso', shL), anchorB: rel('armL', shL) },
    { a: 'torso', b: 'armR', anchorA: rel('torso', shR), anchorB: rel('armR', shR) },
    { a: 'torso', b: 'legL', anchorA: rel('torso', hipL), anchorB: rel('legL', hipL) },
    { a: 'torso', b: 'legR', anchorA: rel('torso', hipR), anchorB: rel('legR', hipR) },
  ];
  const armHH = Math.max(0.02, ARM_LEN / 2 - ARM_R), legHH = Math.max(0.02, DIM.pelvisY / 2 - LEG_R);
  const parts = {
    torso: { mesh: groups.torso, half: [0.25, 0.3, 0.32] },
    head: { mesh: groups.head, radius: 0.245 },
    armL: { mesh: groups.armL, radius: ARM_R, halfHeight: armHH },
    armR: { mesh: groups.armR, radius: ARM_R, halfHeight: armHH },
    legL: { mesh: groups.legL, radius: LEG_R, halfHeight: legHH },
    legR: { mesh: groups.legR, radius: LEG_R, halfHeight: legHH },
  };
  return { parts, joints, pose };
}
