// R.O.O.M. — body-plan morph for the clone android: frame (masc / fem / neutral), skull shape, build
// and eye hardware, applied to the cached rest-space geometry instead of at runtime.
//
// Every bone gets a geometric scale S (model axes, around its rest joint) and a child-offset stretch
// T (how far its children's joints move; defaults to S). New joint positions are propagated down the
// hierarchy, and each vertex is moved by the skin-weighted blend of its bones' affine maps:
//   v' = sum_k w_k (P'_k + S_k * (v - P_k))       n' = normalize(sum_k w_k n / S_k)
// so the skin stays consistent with the moved joints (the new rests go into `over`). Leg stretch lifts
// the pelvis so the feet stay on the floor. Eyes: eyeball / lid scale, iris recolour (dark 'bead'
// vertices on the eye bones) and the red LED atlas region for 'red' optics.
import * as THREE from 'three';
import { BONE_NAMES, BI, BONE_PARENT, RD, restMatrices } from './robotrig.js';
import { atlasUV } from './dolltex.js';

const N = BONE_NAMES.length;
const DEF_IRIS = [0.12, 0.16, 0.2];
const mul = (a, b) => { a[0] *= b[0]; a[1] *= b[1]; a[2] *= b[2]; return a; };

const TORSO = ['pelvis', 'spine', 'chest'];
const ARMS = ['shL', 'elL', 'shR', 'elR'];
const HANDS = ['wrL', 'wrR', 'fiL', 'fjL', 'ixL', 'thL', 'fiR', 'fjR', 'ixR', 'thR'];
const THIGHS = ['hipL', 'hipR'], SHINS = ['knL', 'knR'], FEET = ['anL', 'anR'];
const FACE_RIDE = ['jaw', 'eyeL', 'eyeR', 'ledL', 'ledR', 'lidUL', 'lidUR', 'lidDL', 'lidDR', 'browL', 'browR', 'hat', 'hatA', 'hatB'];

// per-variant bone factors: { bone: [S] } or { bone: { s: [S], t: [T] } }
const FRAME = {
  masc: {
    chest: { s: [1.08, 1, 1.05], t: [1.11, 1, 1.03] }, spine: [1.04, 1, 1.03], pelvis: { s: [0.97, 1, 0.98], t: [0.94, 1, 1] },
    neck: [1.12, 1, 1.1], shL: [1.08, 1, 1.08], shR: [1.08, 1, 1.08], elL: [1.07, 1, 1.07], elR: [1.07, 1, 1.07],
    wrL: [1.06, 1.04, 1.06], wrR: [1.06, 1.04, 1.06], hipL: [1.04, 1, 1.04], hipR: [1.04, 1, 1.04],
    head: [1.02, 1, 1], jaw: [1.1, 1.05, 1.06], browL: [1.1, 1.3, 1], browR: [1.1, 1.3, 1],
  },
  fem: {
    chest: { s: [0.93, 1, 0.99], t: [0.9, 1, 1] }, spine: [0.88, 1, 0.92], pelvis: { s: [1.1, 1, 1.05], t: [1.15, 1, 1] },
    neck: [0.86, 1.04, 0.88], shL: [0.9, 1, 0.9], shR: [0.9, 1, 0.9], elL: [0.9, 1, 0.9], elR: [0.9, 1, 0.9],
    wrL: [0.92, 0.95, 0.92], wrR: [0.92, 0.95, 0.92], hipL: [1.07, 1, 1.07], hipR: [1.07, 1, 1.07], knL: [0.96, 1, 0.96], knR: [0.96, 1, 0.96],
    head: [0.97, 0.99, 0.98], jaw: [0.88, 0.95, 0.95], browL: [0.94, 0.8, 1], browR: [0.94, 0.8, 1],
  },
};
const each = (list, v) => Object.fromEntries(list.map((b) => [b, v]));
const BUILD = {
  slim: { ...each(TORSO, [0.88, 1, 0.88]), neck: [0.9, 1, 0.9], ...each(ARMS, [0.86, 1, 0.86]), ...each(THIGHS, [0.87, 1, 0.87]), ...each(SHINS, [0.88, 1, 0.88]) },
  stocky: {
    ...each(TORSO, { s: [1.14, 0.97, 1.12], t: [1.1, 0.97, 1.05] }), neck: [1.15, 0.92, 1.15],
    ...each(ARMS, [1.15, 0.96, 1.15]), ...each(HANDS, [1.1, 1, 1.1]), ...each(THIGHS, [1.14, 0.95, 1.14]), ...each(SHINS, [1.12, 0.95, 1.12]),
  },
  tall: {
    ...each(TORSO, [0.96, 1.06, 0.96]), neck: [0.95, 1.1, 0.95],
    ...each(ARMS, [0.95, 1.07, 0.95]), ...each(THIGHS, [0.95, 1.08, 0.95]), ...each(SHINS, [0.95, 1.08, 0.95]),
  },
  heavy: {
    pelvis: { s: [1.22, 1, 1.25], t: [1.12, 1, 1.05] }, spine: { s: [1.34, 1, 1.45], t: [1.1, 1, 1.1] }, chest: { s: [1.24, 1, 1.3], t: [1.15, 1, 1.12] },
    neck: [1.25, 0.9, 1.25], ...each(ARMS, [1.2, 1, 1.2]), ...each(HANDS, [1.12, 1, 1.12]), ...each(THIGHS, [1.22, 0.97, 1.22]), ...each(SHINS, [1.16, 0.97, 1.16]),
  },
};

export function shapeIsDefault(cos) {
  return (cos.frame || 'neutral') === 'neutral' && (cos.skull || 'std') === 'std' && (cos.build || 'std') === 'std' && (cos.eyes || 'glass') === 'glass';
}
export const shapeKey = (cos) => (shapeIsDefault(cos) ? '' : [cos.frame, cos.skull, cos.build, cos.eyes].join('.'));

function boneFactors(cos) {
  const S = [], T = [];
  for (let i = 0; i < N; i++) { S.push([1, 1, 1]); T.push(null); }
  const apply = (tbl) => {
    if (!tbl) return;
    for (const [name, v] of Object.entries(tbl)) {
      const i = BI[name]; if (i === undefined) continue;
      const s = Array.isArray(v) ? v : v.s, t = Array.isArray(v) ? null : v.t;
      mul(S[i], s);
      if (t) T[i] = mul(T[i] || [1, 1, 1], t); else if (T[i]) mul(T[i], s);
    }
  };
  apply(FRAME[cos.frame]);
  apply(BUILD[cos.build]);
  // skull: the head bone (neck pivot) and everything riding on the face scale with it
  const sk = cos.skullEntry || {};
  const hs = sk.s || [1, 1, 1];
  mul(S[BI.head], hs);
  for (const b of FACE_RIDE) { if (b.startsWith('eye') || b.startsWith('led') || b.startsWith('lid')) continue; mul(S[BI[b]], hs); }
  if (sk.jaw) mul(S[BI.jaw], sk.jaw);
  // eyes: uniform eyeball + lids; the LED pupil disc optionally smaller
  const ey = cos.eyesEntry || {};
  const es = ey.s || 1, pu = ey.pupil || 1;
  for (const b of ['eyeL', 'eyeR', 'lidUL', 'lidUR', 'lidDL', 'lidDR']) mul(S[BI[b]], [es, es, es]);
  for (const b of ['ledL', 'ledR']) mul(S[BI[b]], [es * pu, es * pu, es]);
  // child offsets: the eye bones' children (LEDs) stay put inside the eyeball
  for (let i = 0; i < N; i++) if (!T[i]) T[i] = S[i].slice();
  for (const b of ['eyeL', 'eyeR', 'ledL', 'ledR']) T[BI[b]] = [1, 1, 1];
  return { S, T };
}

// returns null for the stock body, else { over, geo(g, matKey) }
export function makeMorph(cos, over) {
  if (shapeIsDefault(cos)) return null;
  const { S, T } = boneFactors(cos);
  const Mw = restMatrices(over);
  const P = Mw.map((m) => new THREE.Vector3().setFromMatrixPosition(m));
  const P2 = new Array(N);
  // leg stretch lifts the pelvis so the soles stay on the ground
  const legY = (L, H, A) => RD.thigh * (T[BI[H]][1] - 1) + RD.shin * (T[BI[L]][1] - 1) + RD.ankleH * (S[BI[A]][1] - 1);
  const lift = (legY('knL', 'hipL', 'anL') + legY('knR', 'hipR', 'anR')) / 2;
  for (let i = 0; i < N; i++) {
    const par = BONE_PARENT[i];
    if (par < 0) { P2[i] = P[i].clone(); P2[i].y += lift; continue; }
    const d = P[i].clone().sub(P[par]);
    d.x *= T[par][0]; d.y *= T[par][1]; d.z *= T[par][2];
    P2[i] = P2[par].clone().add(d);
  }
  const over2 = { ...over };
  const q = new THREE.Quaternion(), tmp = new THREE.Vector3(), sc = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const par = BONE_PARENT[i], name = BONE_NAMES[i];
    let loc;
    if (par < 0) loc = P2[i].clone();
    else { Mw[par].decompose(tmp, q, sc); loc = P2[i].clone().sub(P2[par]).applyQuaternion(q.invert()); }
    over2[name] = { ...(over[name] || {}), p: loc.toArray() };
  }
  const ey = cos.eyesEntry || {};
  const iris = ey.iris || DEF_IRIS, irisL = 0.299 * DEF_IRIS[0] + 0.587 * DEF_IRIS[1] + 0.114 * DEF_IRIS[2];
  const recolor = ey.id && ey.id !== 'glass';
  let led = null;
  if (ey.led === 'red') {
    const a0 = atlasUV('led', 0, 0), a1 = atlasUV('led', 1, 1), b0 = atlasUV('ledr', 0, 0);
    led = { u0: Math.min(a0[0], a1[0]) - 1e-4, u1: Math.max(a0[0], a1[0]) + 1e-4, v0: Math.min(a0[1], a1[1]) - 1e-4, v1: Math.max(a0[1], a1[1]) + 1e-4, du: b0[0] - a0[0], dv: b0[1] - a0[1] };
  }
  const EYES = new Set([BI.eyeL, BI.eyeR]), LEDS = new Set([BI.ledL, BI.ledR]);
  const flat = (arr) => { const f = new Float32Array(N * 3); arr.forEach((v, i) => { f[i * 3] = v.x ?? v[0]; f[i * 3 + 1] = v.y ?? v[1]; f[i * 3 + 2] = v.z ?? v[2]; }); return f; };
  const fP = flat(P), fP2 = flat(P2), fS = flat(S);
  return {
    over: over2,
    geo(g0, key) {
      const g = g0.clone();
      const pos = g.attributes.position, nrm = g.attributes.normal, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
      if (!pos || !si || !sw) return g;
      const col = g.attributes.color, uv = g.attributes.uv;
      for (let v = 0; v < pos.count; v++) {
        const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
        const nx = nrm ? nrm.getX(v) : 0, ny = nrm ? nrm.getY(v) : 0, nz = nrm ? nrm.getZ(v) : 0;
        let ox = 0, oy = 0, oz = 0, mx = 0, my = 0, mz = 0, wt = 0, dom = -1, dw = 0;
        for (let k = 0; k < 4; k++) {
          const w = sw.getComponent(v, k);
          if (w <= 0) continue;
          const b = si.getComponent(v, k), b3 = b * 3;
          const sx = fS[b3], sy = fS[b3 + 1], sz = fS[b3 + 2];
          ox += w * (fP2[b3] + sx * (x - fP[b3])); oy += w * (fP2[b3 + 1] + sy * (y - fP[b3 + 1])); oz += w * (fP2[b3 + 2] + sz * (z - fP[b3 + 2]));
          mx += w * nx / sx; my += w * ny / sy; mz += w * nz / sz;
          wt += w;
          if (w > dw) { dw = w; dom = b; }
        }
        if (wt <= 0) continue;
        pos.setXYZ(v, ox / wt, oy / wt, oz / wt);
        if (nrm) { const l = Math.hypot(mx, my, mz) || 1; nrm.setXYZ(v, mx / l, my / l, mz / l); }
        if (recolor && key === 'bead' && col && EYES.has(dom)) {
          const r = col.getX(v), gg = col.getY(v), bb = col.getZ(v), L = 0.299 * r + 0.587 * gg + 0.114 * bb;
          if (L < 0.4) { const k = L / irisL; col.setXYZ(v, iris[0] * k, iris[1] * k, iris[2] * k); }
        }
        if (led && key === 'decal' && uv && LEDS.has(dom)) {
          const u = uv.getX(v), w = uv.getY(v);
          if (u >= led.u0 && u <= led.u1 && w >= led.v0 && w <= led.v1) uv.setXY(v, u + led.du, w + led.dv);
        }
      }
      pos.needsUpdate = true;
      g.computeBoundingBox(); g.computeBoundingSphere();
      return g;
    },
  };
}
