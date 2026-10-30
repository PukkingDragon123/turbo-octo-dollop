// R.O.O.M. — cloning-lab lobby props, built from the same PEAK sack doll as the players.
//   buildUnfinishedClone(stage 0..3, seed) -> { root, update(dt, t) }   floats inside a tube
//     0 = wire armature in the loaf-head shape + floating innards (stuffing, felt heart, loose
//         bead eyes, the red nose)
//     1 = half-stuffed sack: crumpled blank head, stitched leg stumps, one empty arm
//     2 = fully stuffed but unpainted: chalk guide marks + sewing pins where the face goes
//     3 = complete naked sack clone, eyes stitched shut, red nose, toe tag, feed line
//   buildReceptionist() -> { root, update(dt, { lookTarget, snap }) }  seated sack doll in a 90s
//     office shirt + tie, yarn bob, big glasses, headset, frozen stitched smile. Faces +Z (toward the
//     reception counter front, see RECEPTIONIST.facing).
// Origins are at the feet / floor; the clones face -Z.
import * as THREE from 'three';
import { clamp, lerp, smooth, Spring, cached } from './doll/kit.js';
import { RNG, valueNoise2 } from '../core/rng.js';
import { labelTexture } from '../gfx/textures.js';
import { DIM, Y, BI, PartBuilder, makeBones, setBoneRest, restMatrices, torsoW, armW, legW } from './doll/dollrig.js';
import { SACK, FACE, facePt, frameQ, fullHeadGeo, headPoint, headGrad, sackTone, shellPoint } from './doll/sack.js';
import { gloveGeo, thumbGeo, bootGeo, soleGeo, mergeSimple } from './doll/suit.js';
import { beadGeo, noseGeo, stitchGeo, FaceRig, mouthParams, THREAD, NOSE_RED, BLUSH } from './doll/face.js';
import { grid, displace, tint, solid, ensureOutward, gridArcUV, tubeR, curvePts, ss, gauss, pillow, sePt } from './doll/geom.js';
import { DM } from './doll/dollmat.js';
import { decalQuad } from './doll/gear.js';

const PI = Math.PI, TAU = PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const nz = (x, y, s) => valueNoise2(x, y, s) - 0.5;
const FRESH = 0xe2cc9e;    // new, unwashed canvas
const CHALK = 0xf4f1e8;

// ---------------------------------------------------------------------------
// naked sack body pieces
// ---------------------------------------------------------------------------
const BODY_PROF = [[0.25, 0.0], [0.254, 0.07], [0.27, 0.155], [0.302, 0.214], [0.35, 0.248], [0.41, 0.266], [0.48, 0.27], [0.55, 0.263],
  [0.62, 0.247], [0.68, 0.224], [0.73, 0.198], [0.77, 0.168], [0.8, 0.128], [0.822, 0.092], [0.845, 0.078], [0.875, 0.076], [0.9, 0.07]];
function sackBody({ deflate = 0, seed = 1 } = {}) {
  const curve = new THREE.SplineCurve(BODY_PROF.map(([y, a]) => new THREE.Vector2(a, y)));
  const pts = curve.getSpacedPoints(48);
  const q = new THREE.Vector2();
  const g = grid(72, 48, (i, j, p) => {
    const P = pts[j], phi = (i / 72) * TAU;
    sePt(phi + PI / 2, 2.2, q);                     // phi = 0 at the back
    let depth = 0.9 * (1 + (Math.cos(phi) < 0 ? 0.12 * gauss(P.y, 0.45, 0.13) * Math.pow(-Math.cos(phi), 1.5) : -0.08 * Math.cos(phi)));
    const sx = Math.sin(phi), sz = Math.cos(phi);
    const ax = Math.sign(sx) * Math.pow(Math.abs(sx), 2 / 2.2), az = Math.sign(sz) * Math.pow(Math.abs(sz), 2 / 2.2);
    let k = 1;
    if (deflate) { const yn = clamp((P.y - 0.25) / 0.6, 0, 1); k = lerp(1, lerp(0.95, 0.55, smooth(yn)), deflate); depth *= lerp(1, 0.55, deflate * yn); }
    p.set(ax * P.x * k, P.y - deflate * 0.04 * clamp((P.y - 0.25) / 0.6, 0, 1), az * P.x * depth * k);
  }, { closedU: true, poleBottom: true });
  ensureOutward(g, V(0, 0.55, 0));
  displace(g, (x, y, z) => nz(x * 18 + z * 11 + seed, y * 18, seed) * (0.005 + deflate * 0.02) + nz(x * 50, y * 50 + z * 30, seed + 1) * 0.0018, { aoK: 0.2, aoAmp: 0.006 });
  tint(g, (x, y, z) => sackTone(x * 0.7, y - 0.4, z, 5) * (1 - 0.12 * gauss(y, 0.26, 0.04)));
  gridArcUV(g, 1, 1);
  return g;
}
// running cross-stitches along a seam path on a surface: pts / nrm arrays
function seamStitches(B, bone, pts, nrm, every = 0.026, len = 0.018, r = 0.0024, col = THREAD, wfn = null) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const L = curve.getLength(), n = Math.max(2, Math.floor(L / every));
  const parts = [];
  for (let i = 1; i < n; i++) {
    const t = i / n, p = curve.getPointAt(t), tg = curve.getTangentAt(t);
    const k = Math.min(nrm.length - 1, Math.round(t * (nrm.length - 1))), nn = nrm[k];
    const side = V().crossVectors(tg, nn).normalize();
    const a = p.clone().addScaledVector(side, -len / 2).addScaledVector(tg, len * 0.18), b = p.clone().addScaledVector(side, len / 2).addScaledVector(tg, -len * 0.18);
    const m = p.clone().addScaledVector(nn, r * 1.4);
    parts.push(tubeR(curvePts([a.addScaledVector(nn, -0.001), m, b.addScaledVector(nn, -0.001)], 5), r, 5));
  }
  const g = mergeSimple(parts);
  if (wfn) B.skinned('felt', g, wfn, col); else B.rigid(bone, 'felt', g, col);
}
function nakedTorso(B, opts) {
  const g = sackBody(opts);
  B.skinned('burlap', g, torsoW);
  if (!opts.deflate) for (const s of [-1, 1]) {
    const pts = [], nrm = [];
    for (let i = 0; i <= 18; i++) {
      const y = lerp(0.27, 0.8, i / 18), A = new THREE.SplineCurve(BODY_PROF.map(([yy, a]) => new THREE.Vector2(a, yy))).getPoints(60).reduce((best, q) => (Math.abs(q.y - y) < Math.abs(best.y - y) ? q : best)).x;
      pts.push(V(s * (A + 0.002), y, 0)); nrm.push(V(s, 0, 0));
    }
    B.skinned('burlap', tubeR(pts, 0.004, 5), torsoW, 0xb0a080);
    seamStitches(B, null, pts, nrm, 0.03, 0.016, 0.0022, THREAD, torsoW);
  }
}
// full sack head: back seam + top seam with stitches, gathered + tied neck
function nakedHead(B, { deflate = 0, seed = 2 } = {}) {
  const g = fullHeadGeo({ nu: 64, nv: 40, tileU: 1 });
  if (deflate) {
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), yn = clamp((y - 0.03) / 0.48, 0, 1);
      const sq = lerp(1, lerp(1.05, 0.4, smooth(yn)), deflate), wr = nz(x * 30 + seed, y * 26 + z * 20, seed) * 0.08 * deflate;
      P.setXYZ(i, x * (sq + wr), y - deflate * 0.07 * yn, z * (sq * lerp(1, 0.45, deflate) + wr));
    }
    g.computeVertexNormals();
  }
  tint(g, (x, y, z) => sackTone(x, y, z, seed));
  B.rigid('head', 'burlap', g);
  if (deflate) return;
  // back seam (vertical) + crown seam (left-right over the top)
  const back = [], bn = [], crown = [], cn = [];
  for (let i = 0; i <= 20; i++) { const el = lerp(-1.2, 1.5, i / 20); const d = V(0, Math.sin(el), Math.cos(el)).normalize(); const n = V(); back.push(headPoint(d, 0.002, V(), n)); bn.push(n.clone()); }
  for (let i = 0; i <= 16; i++) { const a = lerp(-1.3, 1.3, i / 16); const d = V(Math.sin(a), Math.cos(a), 0.12).normalize(); const n = V(); crown.push(headPoint(d, 0.002, V(), n)); cn.push(n.clone()); }
  B.rigid('head', 'burlap', tubeR(back, 0.0045, 5), 0xa89878);
  B.rigid('head', 'burlap', tubeR(crown, 0.0045, 5), 0xa89878);
  seamStitches(B, 'head', back, bn, 0.03, 0.016, 0.0022);
  seamStitches(B, 'head', crown, cn, 0.03, 0.016, 0.0022);
  // gathered neck: pleats where the sack is tied + two wraps of cord and a knot
  const neck = grid(40, 6, (i, j, p) => { const a = (i / 40) * TAU, v = j / 6; const r = lerp(0.082, 0.12, v * v) * (1 + 0.1 * Math.max(0, Math.sin(a * 9)) * v); p.set(Math.sin(a) * r, lerp(-0.035, 0.05, v), Math.cos(a) * r * 0.92); }, { closedU: true });
  ensureOutward(neck, V(0, 0, 0));
  tint(neck, (x, y) => 0.8 + 0.2 * ss(-0.03, 0.04, y));
  B.rigid('head', 'burlap', neck);
  for (const y of [-0.004, 0.006]) B.rigid('head', 'felt', new THREE.TorusGeometry(0.083, 0.0042, 6, 40).rotateX(PI / 2).scale(1, 1, 0.92).translate(0, y, 0), 0x6a5038);
  B.rigid('head', 'felt', new THREE.SphereGeometry(0.009, 8, 6).translate(0.05, 0.0, -0.064), 0x6a5038);
  for (const s of [-1, 1]) B.rigid('head', 'felt', tubeR([V(0.05, 0, -0.066), V(0.05 + s * 0.012, -0.02, -0.07), V(0.05 + s * 0.016, -0.04, -0.068)], 0.0035, 5), 0x6a5038);
}
function nakedArm(B, side, kind = 'full') {
  const s = side === 'L' ? -1 : 1, ax = s * DIM.shX, top = Y.chest, L = DIM.upper + DIM.fore;
  if (kind === 'none') return;
  if (kind === 'stump') {
    const g = grid(24, 10, (i, j, p) => { const a = (i / 24) * TAU, v = j / 10, dy = lerp(-0.04, 0.06, v); const r = 0.052 * Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, (dy - 0.03) / 0.03), 2))) * (v === 0 ? 0 : 1); p.set(ax + Math.cos(a) * r, top - dy, Math.sin(a) * r); }, { closedU: true, poleBottom: true, poleTop: true });
    ensureOutward(g, V(ax, top - 0.01, 0));
    B.skinned('burlap', g, armW(side));
    return;
  }
  const flat = kind === 'empty';
  const g = grid(24, 26, (i, j, p) => { const a = (i / 24) * TAU, v = j / 26, dy = lerp(-0.04, L, v); const r = (dy < 0 ? 0.052 * Math.sqrt(Math.max(0, 1 - (dy / 0.04) ** 2)) : lerp(0.052, 0.044, dy / L)); p.set(ax + Math.cos(a) * r * (flat ? 1.2 : 1), top - dy - (flat ? dy * 0.4 : 0), Math.sin(a) * r * (flat ? 0.2 : 1)); }, { closedU: true, poleBottom: true });
  ensureOutward(g, V(ax, top - L / 2, 0));
  displace(g, (x, y, z) => nz(x * 40 + z * 30, y * 40, 3) * 0.003);
  B.skinned('burlap', g, armW(side));
  if (!flat) {
    B.boneSkinned('wr' + side, 'burlap', gloveGeo(side, { cuff: false }), (x, y, z, o) => o.reset().add('wr' + side, 1));
    B.rigid('th' + side, 'burlap', thumbGeo(side));
    B.rigid('wr' + side, 'felt', new THREE.TorusGeometry(0.044, 0.0026, 5, 24).rotateX(PI / 2).translate(0, 0.012, 0), THREAD);
  }
}
function nakedLeg(B, side, kind = 'full') {
  const s = side === 'L' ? -1 : 1, ax = s * DIM.hipX, top = Y.pelvis;
  if (kind === 'stump') {
    const g = grid(24, 10, (i, j, p) => { const a = (i / 24) * TAU, v = j / 10, dy = lerp(-0.03, 0.07, v); const r = 0.066 * Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, (dy - 0.04) / 0.03), 2))); p.set(ax + Math.cos(a) * r, top - dy, Math.sin(a) * r); }, { closedU: true, poleTop: true });
    ensureOutward(g, V(ax, top - 0.02, 0));
    B.skinned('burlap', g, legW(side));
    for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; B.skinned('felt', tubeR([V(ax + Math.cos(a) * 0.05, top - 0.064, Math.sin(a) * 0.05), V(ax + Math.cos(a + 0.4) * 0.02, top - 0.074, Math.sin(a + 0.4) * 0.02)], 0.003, 4), legW(side), THREAD); }
    return;
  }
  const g = grid(24, 22, (i, j, p) => { const a = (i / 24) * TAU, v = j / 22, dy = lerp(-0.03, DIM.thigh + DIM.shin - 0.02, v); const r = dy < 0 ? 0.066 * Math.sqrt(Math.max(0, 1 - (dy / 0.03) ** 2)) : lerp(0.066, 0.058, dy / 0.25); p.set(ax + Math.cos(a) * r, top - dy, 0.004 + Math.sin(a) * r); }, { closedU: true, poleBottom: true });
  ensureOutward(g, V(ax, top - 0.12, 0));
  B.skinned('burlap', g, legW(side));
  const foot = bootGeo(); foot.scale(0.86, 0.8, 0.88);
  B.rigid('an' + side, 'burlap', foot);
  const sole = grid(32, 4, (i, j, p) => { const a = (i / 32) * TAU, r = j / 4; sePt(a, 2.6, p); p.set(p.x * 0.055 * r, -0.064, -0.026 + p.y * 0.1 * r); }, { closedU: true, poleBottom: true });
  ensureOutward(sole, V(0, 0, -0.03));
  B.rigid('an' + side, 'burlap', sole, 0xc8b898);
}
// face pieces (head space): beads / stitched-shut eyes / nose / mouth
function addStitch(B, ax, ay, bx, by, r, col, lift = 0.6) { B.rigid('head', 'felt', stitchGeo(ax, ay, bx, by, r, lift), col); }
function closedEyes(B) {
  for (const s of [-1, 1]) {
    const ex = s * FACE.eyeX, ey = FACE.eyeY, er = FACE.eyeR * 1.2;
    for (let k = 0; k < 3; k++) { const u0 = -1 + k * 0.68, u1 = u0 + 0.6; addStitch(B, ex + u0 * er, ey - (1 - u0 * u0) * er * 0.5, ex + u1 * er, ey - (1 - u1 * u1) * er * 0.5, 0.0032, THREAD, 0.4); }
    for (const k of [-1, 0, 1]) addStitch(B, ex + k * er * 0.6, ey - er * 0.45 - Math.abs(k) * 0.002, ex + k * er * 0.75, ey - er * 0.95, 0.0018, THREAD, 0.3);
  }
}
function beadEyes(B, r = FACE.eyeR) {
  for (const [S, s] of [['L', -1], ['R', 1]]) {
    const n = V(), p = facePt(s * FACE.eyeX, FACE.eyeY, 0, V(), n); p.addScaledVector(n, r * 0.38);
    B.setRest('eye' + S, p.toArray(), frameQ(n));
    B.rigid('eye' + S, 'bead', beadGeo(r, s));
  }
}
function feltNose(B) {
  const n = V(), p = facePt(0, FACE.noseY, 0, V(), n); p.addScaledVector(n, FACE.noseR * 0.42);
  B.setRest('nose', p.toArray(), frameQ(n));
  B.rigid('nose', 'felt', noseGeo(), NOSE_RED);
}
function pin(B, x, y, col) {
  const n = V(), p = facePt(x, y, 0, V(), n), q = frameQ(n).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0.2, 0)));
  B.rigid('head', 'metal', new THREE.CylinderGeometry(0.0013, 0.0013, 0.05, 5).rotateX(PI / 2).translate(0, 0, 0.012).applyQuaternion(q).translate(p.x, p.y, p.z), 0xd8d8d8);
  B.rigid('head', 'plastic', new THREE.SphereGeometry(0.0062, 10, 8).translate(0, 0, 0.037).applyQuaternion(q).translate(p.x, p.y, p.z), col);
}
function chalkRing(B, cx, cy, r, n = 12) { for (let i = 0; i < n; i += 2) { const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU; addStitch(B, cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, 0.0022, CHALK, 0.1); } }

// ---------------------------------------------------------------------------
// skinned assembly
// ---------------------------------------------------------------------------
function assemble(B, tone, name) {
  const part = B.finish();
  const rig = makeBones(part.over);
  const restM = restMatrices(part.over);
  const skeleton = new THREE.Skeleton(rig.bones, restM.map((m) => m.clone().invert()));
  const root = new THREE.Group(); root.name = name;
  const holder = new THREE.Group(); holder.name = 'float';
  root.add(holder); holder.add(rig.b.pelvis);
  const mat = (key) => {
    if (key === 'burlap') return DM.burlap(tone);
    if (key === 'stuff') return stuffMat();
    if (key === 'tag') return null;
    return DM[key]();
  };
  const meshes = [];
  for (const [key, g] of part.geos) {
    const m = new THREE.SkinnedMesh(g, mat(key));
    m.bind(skeleton, new THREE.Matrix4());
    m.boundingSphere = new THREE.Sphere(V(0, 0.75, 0), 1.2);
    m.castShadow = !m.material.transparent; m.receiveShadow = true;
    holder.add(m); meshes.push(m);
  }
  return { root, holder, rig, skeleton, meshes, part };
}
const stuffMat = () => cached('cl_stuff2', () => {
  const m = DM.felt().clone(); m.name = 'clone_stuffing'; return m;
});
function fluff(r, seed) { const g = new THREE.IcosahedronGeometry(r, 3); displace(g, (x, y, z) => nz(x * 40 / r * 0.05 + seed, y * 40 / r * 0.05 + z * 20, seed) * r * 0.45 + nz(x * 300, y * 300 + z * 200, seed + 2) * r * 0.08); return g; }

export function buildUnfinishedClone(stage = 3, seed = 1) {
  stage = clamp(stage | 0, 0, 3);
  const rng = new RNG(seed * 97 + stage * 13 + 1);
  const B = new PartBuilder();
  let tone = FRESH;
  if (stage === 0) {
    // wire armature (loaf head cage, spine, ribs, limbs) + floating innards
    const W = (bone, pts, r = 0.0045) => B.rigid(bone, 'metal', tubeR(curvePts(pts.map((p) => V(...p)), Math.max(8, pts.length * 5)), r, 6), 0x9aa0a6);
    W('pelvis', [[0, -0.09, 0], [0, 0.2, 0.02], [0, 0.39, 0]], 0.007);
    for (const y of [0.05, 0.2, 0.33]) B.rigid('pelvis', 'metal', new THREE.TorusGeometry(0.23 * (1 - Math.abs(y - 0.18) * 1.1), 0.004, 5, 36).rotateX(PI / 2).scale(1, 1, 0.85).translate(0, y, 0), 0x9aa0a6);
    W('chest', [[-0.2, 0, 0], [0, 0.03, 0], [0.2, 0, 0]], 0.006);
    W('chest', [[0, 0, 0], [0, 0.1, 0]], 0.006);
    for (const s of [-1, 1]) {
      W('chest', [[s * 0.2, 0, 0], [s * 0.26, -0.13, -0.02], [s * 0.31, -0.25, -0.05], [s * 0.33, -0.31, -0.06]]);
      B.rigid('chest', 'metal', new THREE.SphereGeometry(0.012, 10, 8).translate(s * 0.26, -0.13, -0.02), 0xb8bcc0);
      W('pelvis', [[s * 0.1, -0.02, 0], [s * 0.12, -0.13, -0.02], [s * 0.12, -0.24, 0.0], [s * 0.12, -0.33, -0.04]]);
      B.rigid('pelvis', 'metal', new THREE.SphereGeometry(0.012, 10, 8).translate(s * 0.12, -0.13, -0.02), 0xb8bcc0);
    }
    // head cage following the sack shape
    for (const plane of ['h1', 'h2', 'v1', 'v2']) {
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * TAU, d = V();
        if (plane === 'h1') d.set(Math.sin(a), -0.1, Math.cos(a)); else if (plane === 'h2') d.set(Math.sin(a), 0.45, Math.cos(a));
        else if (plane === 'v1') d.set(0, Math.cos(a), Math.sin(a)); else d.set(Math.sin(a), Math.cos(a), 0);
        pts.push(headPoint(d.normalize(), 0, V()));
      }
      B.rigid('head', 'metal', tubeR(pts, 0.0035, 5), 0x9aa0a6);
    }
    for (let i = 0; i < 9; i++) B.rigid('pelvis', 'stuff', fluff(rng.range(0.04, 0.075), i + 1).translate(rng.range(-0.12, 0.12), rng.range(0.0, 0.35), rng.range(-0.1, 0.1)), 0xefe8da);
    B.setRest('accA', [-0.04, -0.06, -0.06]);   // heart pivot
    for (const s of [-1, 1]) B.rigid('accA', 'felt', fluff(0.034, 2 + s).scale(1, 1, 0.8).translate(s * 0.022, 0.01, 0), 0xc8222a);
    B.rigid('accA', 'felt', new THREE.ConeGeometry(0.05, 0.06, 16).rotateX(PI).scale(1, 1, 0.65).translate(0, -0.03, 0), 0xc8222a);
    B.setRest('hatA', [0, 0.0, -0.06]);          // loose face parts (head-centre pivot)
    for (const s of [-1, 1]) B.rigid('hatA', 'bead', beadGeo(FACE.eyeR, s).translate(s * 0.08, 0.06 + s * 0.02, rng.range(-0.04, 0.02)));
    B.rigid('hatA', 'felt', noseGeo().translate(0.01, -0.02, -0.02), NOSE_RED);
  } else if (stage === 1) {
    tone = 0xd4bc90;
    nakedTorso(B, { deflate: 0.55, seed });
    nakedHead(B, { deflate: 0.75, seed: seed + 2 });
    nakedArm(B, 'L', 'empty'); nakedArm(B, 'R', 'full');
    nakedLeg(B, 'L', 'stump'); nakedLeg(B, 'R', 'stump');
    for (let i = 0; i < 4; i++) B.rigid('pelvis', 'stuff', fluff(0.05, i + 3).translate(rng.range(-0.08, 0.08), 0.15 + i * 0.07, 0.17), 0xefe8da);
  } else {
    nakedTorso(B, { seed });
    nakedHead(B, { seed: seed + 2 });
    for (const S of ['L', 'R']) { nakedArm(B, S, 'full'); nakedLeg(B, S, 'full'); }
    if (stage === 2) {
      for (const s of [-1, 1]) { chalkRing(B, s * FACE.eyeX, FACE.eyeY, 0.026, 12); pin(B, s * FACE.eyeX, FACE.eyeY, s < 0 ? 0xe23b3b : 0x2f7fe0); }
      chalkRing(B, 0, FACE.noseY, 0.05, 16); pin(B, 0, FACE.noseY, 0xf6c41e);
      for (let i = 0; i < 4; i++) { const u0 = -1 + i * 0.5, u1 = u0 + 0.32; addStitch(B, u0 * 0.03, FACE.mouthY - 0.004 * (1 - u0 * u0), u1 * 0.03, FACE.mouthY - 0.004 * (1 - u1 * u1), 0.002, CHALK, 0.1); }
      addStitch(B, -0.05, FACE.browY, -0.02, FACE.browY + 0.004, 0.002, CHALK, 0.1); addStitch(B, 0.02, FACE.browY + 0.004, 0.05, FACE.browY, 0.002, CHALK, 0.1);
      B.rigid('wrL', 'plastic', pillow(0.034, 0.05, 0.004).translate(0, -0.1, -0.045).rotateX(0.2), 0xf4f2ea);
    } else {
      closedEyes(B); feltNose(B);
      for (let k = 0; k < 3; k++) { const u0 = -1 + k * 0.7, u1 = u0 + 0.6; addStitch(B, u0 * 0.024, FACE.mouthY + 0.004 * u0 * u0, u1 * 0.024, FACE.mouthY + 0.004 * u1 * u1, 0.0028, THREAD, 0.5); }
      for (const s of [-1, 1]) { const n = V(), p = facePt(s * FACE.blushX, FACE.blushY, 0.0012, V(), n); B.rigid('head', 'felt', new THREE.CircleGeometry(0.022, 16).scale(1, 0.65, 1).applyQuaternion(frameQ(n)).translate(p.x, p.y, p.z), BLUSH); }
      // toe tag + feed line from the back of the neck
      B.rigid('anR', 'felt', tubeR([V(0.02, 0.0, -0.08), V(0.035, -0.02, -0.1), V(0.04, -0.035, -0.095)], 0.0014, 4), 0xd8d0c0);
      B.rigid('anR', 'plastic', pillow(0.052, 0.03, 0.003).rotateY(0.3).rotateZ(0.2).translate(0.045, -0.055, -0.1), 0xf2e6c8);
      const cable = curvePts([V(0, 0.84, 0.16), V(0.05, 1.02, 0.28), V(-0.04, 1.27, 0.25), V(0.02, 1.52, 0.2), V(0, 1.64, 0.12)], 34);
      B.skinned('rubber', tubeR(cable, 0.012, 8), (x, y, z, o) => o.reset().add(y < 0.95 ? 'chest' : 'pelvis', 1), 0x2c2e33);
      B.skinned('metal', new THREE.CylinderGeometry(0.02, 0.02, 0.04, 12).translate(0, 1.66, 0.12), (x, y, z, o) => o.reset().add('pelvis', 1), 0xa0a4a8);
    }
  }
  const A = assemble(B, tone, 'UnfinishedClone' + stage);
  const b = A.rig.b;
  const R = A.rig;
  const restQ = R.bones.map((bn) => bn.quaternion.clone());
  const st = { t: rng.next() * 10, next: rng.range(2, 6), sp: new Spring(90, 5, 0), twBone: null, twAx: V() };
  const twitchable = ['shL', 'shR', 'elL', 'elR', 'head', 'hipL', 'hipR', 'knL', 'knR', 'wrR'];
  // limp floating pose
  const pose = { shL: [0.2, 0, -0.55], shR: [0.25, 0, 0.6], elL: [0.35, 0, 0], elR: [0.4, 0, 0], hipL: [0.15, 0, -0.1], hipR: [0.2, 0, 0.12], knL: [-0.25, 0, 0], knR: [-0.2, 0, 0], head: [0.22, 0, 0.05] };
  function update(dt, t) {
    dt = clamp(dt || 0, 0, 0.1);
    st.t = t ?? st.t + dt;
    const T = st.t;
    for (let i = 0; i < R.bones.length; i++) { R.bones[i].position.copy(R.restP[i]); R.bones[i].quaternion.copy(restQ[i]); R.bones[i].scale.set(1, 1, 1); }
    for (const [n, e] of Object.entries(pose)) b[n].rotation.set(e[0], e[1], e[2]);
    A.holder.position.set(Math.sin(T * 0.31 + seed) * 0.015, Math.sin(T * 0.6 + seed) * 0.03, Math.cos(T * 0.27) * 0.012);
    A.holder.rotation.set(Math.sin(T * 0.23) * 0.04, Math.sin(T * 0.17 + seed) * 0.12, Math.sin(T * 0.29 + 1) * 0.03);
    for (const [n, f] of [['shL', 0.5], ['shR', 0.45], ['hipL', 0.4], ['hipR', 0.37], ['head', 0.33]]) { b[n].rotation.x += Math.sin(T * f + n.length) * 0.06; b[n].rotation.z += Math.sin(T * f * 0.8 + 2) * 0.04; }
    st.next -= dt;
    if (st.next <= 0) { st.next = rng.range(2.5, 7); st.twBone = rng.pick(twitchable); st.twAx.set(rng.range(-1, 1), rng.range(-0.4, 0.4), rng.range(-1, 1)); st.sp.v = 9; }
    const k = st.sp.step(dt, 0);
    if (st.twBone) { b[st.twBone].rotation.x += k * st.twAx.x * 0.4; b[st.twBone].rotation.z += k * st.twAx.z * 0.4; }
    if (stage === 0) {
      const beat = Math.max(0, Math.sin(T * 7.5)) ** 8 + Math.max(0, Math.sin(T * 7.5 - 0.6)) ** 8 * 0.6;
      b.accA.scale.setScalar(1 + beat * 0.18);
      b.hatA.position.y += Math.sin(T * 0.9) * 0.02; b.hatA.rotation.y = T * 0.3;
    }
  }
  update(0, 0);
  return { root: A.root, update };
}

// ============================================================================
// Receptionist
// ============================================================================
export const RECEPTIONIST = { seatHeight: 0.45, deskHeight: 0.77, deskFrontZ: -0.13, facing: '+Z' };
export function buildReceptionist() {
  const B = new PartBuilder();
  const SHIRT = 0xdfe8f6, PANTS = 0x34363d, W = 0xffffff;
  // body: shirt above the belt, slacks below; buttons, collar, tie, shoulder pads
  const body = sackBody({ seed: 4 });
  body.scale(1.04, 1, 1.04);
  tint(body, (x, y, z) => (y < 0.405 ? [0.21, 0.22, 0.25] : (Math.floor((x + 1) / 0.022) % 3 === 0 ? [0.82, 0.88, 0.97] : [0.88, 0.91, 0.97])));
  B.skinned('canvas', body, torsoW);
  B.skinned('canvas', grid(72, 2, (i, j, p) => { const a = (i / 72) * TAU, y = 0.405 + (j / 2 - 0.5) * 0.03; p.set(Math.sin(a) * 0.292, y, Math.cos(a) * 0.29 * (Math.cos(a) < 0 ? 1.06 : 0.86)); }, { closedU: true }), torsoW, 0x1a1a1c);
  for (const s of [-1, 1]) B.skinned('canvas', pillow(0.085, 0.05, 0.012).rotateX(-0.7).rotateY(s * 0.45).rotateZ(s * 0.5).translate(s * 0.05, 0.84, -0.13), torsoW, 0xf4f6fb);
  for (let i = 0; i < 5; i++) B.skinned('plastic', new THREE.CylinderGeometry(0.0075, 0.0075, 0.004, 12).rotateX(PI / 2).translate(0.0, 0.47 + i * 0.075, -0.268 + i * 0.012 - (i > 2 ? (i - 2) * 0.03 : 0)), torsoW, 0xf3eee2);
  const tie = new THREE.Shape(); tie.moveTo(-0.014, 0); tie.lineTo(0.014, 0); tie.lineTo(0.032, -0.22); tie.lineTo(0, -0.255); tie.lineTo(-0.032, -0.22); tie.closePath();
  const tg = new THREE.ExtrudeGeometry(tie, { depth: 0.006, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 2 });
  tint(tg, (x, y) => (Math.floor((x * 0.8 - y) / 0.025) % 2 ? [0.66, 0.13, 0.16] : [0.12, 0.18, 0.35]));
  B.skinned('canvas', tg.rotateX(-0.45).translate(0, 0.835, -0.185), torsoW);
  B.skinned('canvas', pillow(0.034, 0.03, 0.02).translate(0, 0.84, -0.18), torsoW, 0xa8202a);
  for (const s of [-1, 1]) B.skinned('canvas', new THREE.SphereGeometry(1, 16, 10).scale(0.08, 0.04, 0.085).translate(s * 0.17, 0.745, 0), torsoW, 0xf0f2f8);
  // name tag (own small texture)
  const tagTex = labelTexture(256, 96, (ctx, w, h) => { ctx.fillStyle = '#f4f2ea'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#c0202a'; ctx.fillRect(0, 0, w, 26); ctx.fillStyle = '#fff'; ctx.font = "bold 20px 'Jolly Lodger', Georgia, serif"; ctx.textAlign = 'center'; ctx.fillText('HELLO I AM', w / 2, 20); ctx.fillStyle = '#151515'; ctx.font = "bold 40px 'Jolly Lodger', Georgia, serif"; ctx.fillText('RECEPTION', w / 2, 72); });
  // head: sack + face (beads with lashes, nose, frozen stitched smile with lipstick, blush)
  nakedHead(B, { seed: 7 });
  beadEyes(B, 0.0225);
  feltNose(B);
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) { const x = s * (FACE.eyeX - 0.014 + k * 0.014); addStitch(B, x, FACE.eyeY + 0.024, x + s * 0.006, FACE.eyeY + 0.038, 0.0016, THREAD, 0.3); }
    addStitch(B, s * (FACE.browX + 0.022), FACE.browY + 0.006, s * (FACE.browX - 0.022), FACE.browY + 0.012, 0.0036, 0x3a2416, 0.4);
    const n = V(), p = facePt(s * FACE.blushX, FACE.blushY, 0.0012, V(), n);
    B.rigid('head', 'felt', new THREE.CircleGeometry(0.026, 18).scale(1, 0.62, 1).applyQuaternion(frameQ(n)).translate(p.x, p.y, p.z), 0xe07a72);
  }
  for (let k = 0; k < 8; k++) { const u0 = -1 + k * 0.25, u1 = u0 + 0.22, f = (u) => FACE.mouthY + 0.012 - 0.022 * (1 - u * u); addStitch(B, u0 * 0.075, f(u0), u1 * 0.075, f(u1), 0.0042, 0x2a120c, 0.4); }
  for (let k = 0; k < 4; k++) { const u0 = -0.9 + k * 0.45, u1 = u0 + 0.4, f = (u) => FACE.mouthY + 0.004 - 0.016 * (1 - u * u); addStitch(B, u0 * 0.06, f(u0), u1 * 0.06, f(u1), 0.0028, 0xc85a66, 0.3); }
  // 90s yarn bob: crown cap + curtain framing the face + curled ends + bangs
  const hairCol = 0x5a3522;
  const hc = V(0, SACK.cy, 0);
  const capH = grid(48, 14, (i, j, p) => { const az = (i / 48) * TAU, pol = 1.05 * (j / 14); const d = V(Math.sin(pol) * Math.sin(az), Math.cos(pol), -Math.sin(pol) * Math.cos(az)); shellPoint(d, 0.016, 1.0, p); p.y -= SACK.cy; }, { closedU: true, poleBottom: true });
  ensureOutward(capH, V());
  const side = grid(36, 10, (i, j, p) => { const az = lerp(0.72, TAU - 0.72, i / 36), y = lerp(-0.13, 0.17, j / 10); const d = V(Math.sin(az), y / 0.24, -Math.cos(az)).normalize(); shellPoint(d, 0.02 + 0.012 * Math.pow(1 - j / 10, 2), 1.0, p); p.y -= SACK.cy; });
  ensureOutward(side, V(0, 0, 0.05));
  for (const g of [capH, side]) { displace(g, (x, y, z) => Math.sin(Math.atan2(x, z) * 30) * 0.0018 + nz(x * 30, y * 30 + z * 20, 4) * 0.004); tint(g, (x, y, z) => 0.85 + 0.15 * Math.sin(Math.atan2(x, z) * 30)); B.rigid('hatA', 'knit', g, hairCol); }
  const curl = []; for (let i = 0; i <= 30; i++) { const az = lerp(0.72, TAU - 0.72, i / 30); const d = V(Math.sin(az), -0.55, -Math.cos(az)).normalize(); const p = shellPoint(d, 0.032, 1, V()); p.y -= SACK.cy; curl.push(p); }
  B.rigid('hatA', 'knit', tubeR(curl, 0.024, 10), hairCol);
  for (let i = 0; i < 6; i++) { const x = -0.11 + i * 0.044; const p = facePt(x, 0.39 - Math.abs(x) * 0.25, 0.024, V()).sub(hc); B.rigid('hatA', 'knit', fluff(0.028, i + 2).translate(p.x, p.y, p.z), hairCol); }
  // big 90s glasses + headset
  for (const s of [-1, 1]) {
    const n = V(), c = facePt(s * FACE.eyeX, FACE.eyeY, 0.022, V(), n), q = frameQ(n);
    B.rigid('head', 'plastic', new THREE.TorusGeometry(0.047, 0.0045, 8, 28).scale(1, 0.86, 1).applyQuaternion(q).translate(c.x, c.y, c.z), 0x8a2a3a);
    B.rigid('head', 'glass', new THREE.CircleGeometry(0.045, 24).scale(1, 0.86, 1).applyQuaternion(q).translate(c.x, c.y, c.z), W);
    const back = shellPoint(V(s * 0.95, (FACE.eyeY - SACK.cy) / 0.24, 0.3).normalize(), 0.03, 1, V());
    B.rigid('head', 'plastic', tubeR(curvePts([facePt(s * 0.168, FACE.eyeY + 0.01, 0.02, V()), back], 8), 0.003, 5), 0x8a2a3a);
  }
  B.rigid('head', 'plastic', tubeR(curvePts([facePt(-0.075, FACE.eyeY + 0.012, 0.024, V()), facePt(0, FACE.eyeY + 0.04, 0.03, V()), facePt(0.075, FACE.eyeY + 0.012, 0.024, V())], 10), 0.0034, 5), 0x8a2a3a);
  const band = []; for (let i = 0; i <= 18; i++) { const a = lerp(-PI / 2, PI / 2, i / 18); band.push(shellPoint(V(Math.sin(a), Math.cos(a), 0.15).normalize(), 0.044, 1, V())); }
  B.rigid('head', 'plastic', tubeR(band, 0.006, 6), 0x222226);
  B.rigid('head', 'plastic', new THREE.CylinderGeometry(0.042, 0.042, 0.026, 20).rotateZ(PI / 2).translate(0.245, SACK.cy - 0.01, 0.02), 0x222226);
  B.rigid('head', 'plastic', tubeR(curvePts([V(0.25, SACK.cy - 0.03, 0.0), V(0.22, 0.15, -0.13), V(0.12, 0.1, -0.21), V(0.05, 0.1, -0.225)], 18), 0.004, 5), 0x222226);
  B.rigid('head', 'plastic', new THREE.SphereGeometry(0.013, 10, 8).translate(0.046, 0.1, -0.226), 0x111111);
  // arms (shirt sleeves + burlap mittens) and legs (slacks + shoes)
  for (const S of ['L', 'R']) {
    const s = S === 'L' ? -1 : 1, ax = s * DIM.shX, L = DIM.upper + DIM.fore;
    const sl = grid(24, 22, (i, j, p) => { const a = (i / 24) * TAU, v = j / 22, dy = lerp(-0.045, L - 0.01, v); const r = dy < 0 ? 0.062 * Math.sqrt(Math.max(0, 1 - (dy / 0.045) ** 2)) : lerp(0.062, 0.054, dy / L); p.set(ax + Math.cos(a) * r, Y.chest - dy, Math.sin(a) * r); }, { closedU: true, poleBottom: true });
    ensureOutward(sl, V(ax, Y.chest - 0.12, 0));
    displace(sl, (x, y, z) => nz(x * 30 + z * 25, y * 30, 6) * 0.004);
    B.skinned('canvas', sl, armW(S), SHIRT);
    B.skinned('canvas', grid(24, 2, (i, j, p) => { const a = (i / 24) * TAU; p.set(ax + Math.cos(a) * 0.058, Y.chest - L + 0.012 + (j / 2) * 0.02, Math.sin(a) * 0.058); }, { closedU: true }), armW(S, true), 0xe8eef8);
    B.boneSkinned('wr' + S, 'burlap', gloveGeo(S, { cuff: false }), (x, y, z, o) => o.reset().add('wr' + S, 1));
    B.rigid('th' + S, 'burlap', thumbGeo(S));
    const ay = Y.pelvis;
    const lg = grid(24, 22, (i, j, p) => { const a = (i / 24) * TAU, v = j / 22, dy = lerp(-0.03, DIM.thigh + DIM.shin - 0.03, v); const r = dy < 0 ? 0.074 * Math.sqrt(Math.max(0, 1 - (dy / 0.03) ** 2)) : lerp(0.074, 0.064, dy / 0.25); p.set(s * DIM.hipX + Math.cos(a) * r, ay - dy, Math.sin(a) * r); }, { closedU: true, poleBottom: true });
    ensureOutward(lg, V(s * DIM.hipX, ay - 0.12, 0));
    B.skinned('canvas', lg, legW(S), PANTS);
    const shoe = bootGeo(); shoe.scale(0.9, 0.62, 0.95).translate(0, -0.028, 0);
    B.rigid('an' + S, 'rubber', shoe, 0x141416);
    B.rigid('an' + S, 'rubber', soleGeo().scale(0.92, 0.7, 0.96).translate(0, -0.03, 0), 0x0c0c0e);
  }
  const A = assemble(B, 0xd8bc8e, 'Receptionist');
  const b = A.rig.b;
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.034), new THREE.MeshStandardMaterial({ map: tagTex, roughness: 0.6 }));
  tag.position.set(0.12, 0.325, -0.245); tag.rotation.order = 'YXZ'; tag.rotation.set(-0.32, 0.42, 0);
  b.pelvis.add(tag);
  // seat the doll: pelvis lifted to the chair, thighs forward, shins down, forearms on the desk
  A.holder.position.y = RECEPTIONIST.seatHeight + 0.105 - DIM.pelvisY;
  // she works facing +Z (the reception_desk model puts her CRT / keyboard / visitors on +Z:
  // params.receptionistFacing = '+Z'); the root itself stays unrotated at the desk anchor
  if (RECEPTIONIST.facing === '+Z') A.holder.rotation.y = PI;
  const R = A.rig;
  const seat = { hipL: [PI / 2 - 0.08, 0, -0.05], hipR: [PI / 2 - 0.08, 0, 0.05], knL: [-PI / 2 + 0.05, 0, 0], knR: [-PI / 2 + 0.15, 0, 0], anL: [0.1, 0, 0], anR: [0.1, 0, 0], shL: [0.45, 0, -0.18], shR: [0.45, 0, 0.18], elL: [1.2, 0, 0.2], elR: [1.2, 0, -0.2], wrL: [-0.1, 0, 0], wrR: [-0.1, 0, 0], fiL: [0, 0, 0.3], fiR: [0, 0, -0.3] };
  const st = { yaw: 0, pitch: 0, roll: 0, t: 0 };
  const tmp = V();
  function update(dt, s = {}) {
    dt = clamp(dt || 0, 0, 0.1); st.t += dt;
    for (let i = 0; i < R.bones.length; i++) { R.bones[i].position.copy(R.restP[i]); R.bones[i].quaternion.copy(R.restQ[i]); }
    for (const [n, e] of Object.entries(seat)) b[n].rotation.set(e[0], e[1], e[2]);
    b.chest.rotation.x = 0.05 + Math.sin(st.t * 1.3) * 0.006;
    if (s.lookTarget) {
      A.root.updateWorldMatrix(true, true);
      tmp.copy(s.lookTarget); b.chest.worldToLocal(tmp); tmp.sub(b.head.position); tmp.y -= SACK.cy;
      const ty = clamp(Math.atan2(-tmp.x, -tmp.z), -2.6, 2.6), tp = clamp(Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z)), -0.6, 0.5);
      if (s.snap) { st.yaw = ty; st.pitch = tp; }
      else {
        // servo-like: constant angular speed, no easing, stops dead
        const sp = 1.1 * dt;
        st.yaw += clamp(ty - st.yaw, -sp, sp); st.pitch += clamp(tp - st.pitch, -sp * 0.6, sp * 0.6);
      }
      st.roll = clamp(-st.yaw * 0.12, -0.25, 0.25);
    }
    b.head.rotation.set(st.pitch, st.yaw, st.roll);
  }
  update(0, {});
  return { root: A.root, update };
}
