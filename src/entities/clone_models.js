// R.O.O.M. — cloning-lab lobby props (sack-doll edition).
//   buildUnfinishedClone(stage 0..3, seed) -> { root, update(dt, t) }   floats inside a tube
//     0 = wire armature + floating "organs" (stuffing clumps, red felt heart, loose bead eyes, nose)
//     1 = half-stuffed sack, deflated blank head, missing legs (stitched stumps), one empty arm
//     2 = fully stuffed but unpainted face: chalk guide marks + sewing pins where features go
//     3 = complete naked sack clone, eyes stitched shut, red nose, toe tag
//   buildReceptionist() -> { root, update(dt, { lookTarget, snap }) }  seated sack doll in a
//     90s office shirt + tie, yarn bob, big glasses, headset, frozen stitched smile.
// Origins are at the feet / floor, facing -Z.
import * as THREE from 'three';
import { G, Rig, Spring, paint, surfaceGrid, headGrid, headPt, headNormal, headF, headRphi, HEAD, featurePt, surfQ, clothMat, AM, cached, feltTex, clamp, lerp, smooth, damp, THREAD, NOSE, EYE, BLUSH, D } from './avatar.js';
import { RNG, valueNoise2 } from '../core/rng.js';
import { labelTexture } from '../gfx/textures.js';

const PI = Math.PI, TAU = PI * 2;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _v1 = V3(), _q1 = new THREE.Quaternion();
const FRESH = 0xd9c49b;   // new, unwashed canvas
const CHALK = 0xf4f1e8;

const stuffMat = () => cached('cl_stuff', () => new THREE.MeshPhysicalMaterial({ name: 'cl_stuff', color: 0xffffff, vertexColors: true, roughness: 1, sheen: 1, sheenRoughness: 0.4, sheenColor: new THREE.Color(0xffffff), bumpMap: feltTex(), bumpScale: 1.5 }));
function mats(tone) {
  return (key) => {
    if (key === 'sack') return clothMat('burlap', tone);
    if (key.startsWith('c:')) { const [, fab, hex] = key.split(':'); return clothMat(fab, parseInt(hex, 16)); }
    if (key === 'stuff') return stuffMat();
    return AM[key]();
  };
}
const place = (g, F) => g.applyQuaternion(F.q).translate(F.p.x, F.p.y, F.p.z);
const _hc = (x, z, col) => new THREE.Color(col).multiplyScalar(0.85 + 0.15 * Math.sin(Math.atan2(x, z) * 40));
const TORSO = { a: 0.275, c: 0.25, y0: -0.105, y1: 0.52, n: 2.2, m: 2.2, cy: 0.2 };

// deflate a sack geometry: top collapses, wrinkles, flattened front-to-back
function deflate(g, H, amount, seed) {
  if (amount <= 0) return g;
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const yn = clamp((y - H.y0) / (H.y1 - H.y0), 0, 1);
    const sq = lerp(1, lerp(1.1, 0.35, smooth(yn)), amount);
    const wr = (valueNoise2(x * 30 + seed, y * 26 + z * 20, seed) - 0.5) * 0.09 * amount;
    p.setXYZ(i, x * (sq * 1.08 + wr), y - amount * 0.05 * yn, z * (sq * lerp(1, 0.35, amount) + wr));
  }
  g.computeVertexNormals();
  return g;
}

// generic floating sack doll
function sackDoll(R, add, o) {
  const rng = o.rng;
  R.bone('float', null, [0, 0, 0]);
  R.bone('pelvis', 'float', [0, D.pelvisY, 0], null, 'ZXY');
  R.bone('chest', 'pelvis', [0, D.chestY, 0], null, 'ZXY');
  R.bone('head', 'chest', [0, D.headY, 0], [0.22, 0, 0.05], 'YXZ');
  if (o.torso !== false) {
    const tg = headGrid(TORSO, 30, 20, 1, null, o.seed);
    deflate(tg, TORSO, o.deflate || 0, o.seed);
    add('pelvis', 'sack', G.uv(tg, 1.7, 0.7), 0xffffff);
    // side seams with stitches
    for (const s of [-1, 1]) {
      const pts = []; for (let i = 0; i <= 10; i++) { const y = lerp(-0.06, 0.48, i / 10); pts.push(headPt(PI / 2 * s, y, 0.002, V3(), TORSO)); }
      if (!o.deflate) add('pelvis', 'sack', G.tube(pts, 0.005, 16, 4), 0x9a9a9a);
    }
  }
  if (o.head !== false) {
    const hg = headGrid(HEAD, 30, 22, 1, null, o.seed + 2);
    deflate(hg, HEAD, o.headDeflate || 0, o.seed + 2);
    add('head', 'sack', G.uv(hg, 1.3, 0.75), 0xffffff);
    const pts = []; for (let i = 0; i <= 12; i++) pts.push(headPt(PI / 2, lerp(0.02, HEAD.y1 - 0.01, Math.sin(i / 12 * PI / 2)), 0.002));
    for (let i = 11; i >= 0; i--) pts.push(headPt(-PI / 2, lerp(0.02, HEAD.y1 - 0.01, Math.sin(i / 12 * PI / 2)), 0.002));
    if (!o.headDeflate) add('head', 'sack', G.tube(pts, 0.0055, 30, 4), 0x9a9a9a);
  }
  // collar seam where head meets body
  if (o.head !== false && o.torso !== false) add('chest', 'felt', G.xf(G.torus(0.13, 0.004, 4, 30), [0, 0.09, 0], [PI / 2, 0, 0]), THREAD);
  for (const [S, s] of [['L', -1], ['R', 1]]) {
    const arm = o.arms?.[S] ?? 'full', leg = o.legs?.[S] ?? 'full';
    R.bone('sh' + S, 'chest', [s * D.shX, 0, 0], [0.2, 0, s * 0.75], 'ZXY');
    R.bone('el' + S, 'sh' + S, [0, -D.upper, 0], [0.35, 0, 0], 'XYZ');
    R.bone('wr' + S, 'el' + S, [0, -D.fore, 0], null, 'XYZ');
    if (arm === 'full') {
      add('sh' + S, 'sack', G.uv(G.capY(0.058, 0, -D.upper, 4, 12), 0.36, 0.2), 0xffffff);
      add('el' + S, 'sack', G.uv(G.capY(0.052, 0, -D.fore + 0.01, 4, 12), 0.33, 0.18), 0xffffff);
      add('wr' + S, 'sack', G.uv(G.xf(G.ell(0.05, 0.062, 0.042, 14, 10), [0, -0.05, 0]), 0.3, 0.12), 0xffffff);
      add('wr' + S, 'sack', G.between([s * -0.03, -0.03, -0.02], [s * -0.042, -0.06, -0.042], 0.018, 3, 8), 0xffffff);
      add('sh' + S, 'felt', G.xf(G.torus(0.058, 0.0035, 4, 18), [0, 0.0, 0], [PI / 2, 0, 0]), THREAD);
    } else if (arm === 'empty') {
      add('sh' + S, 'sack', G.uv(G.xf(G.capY(0.05, 0, -0.2, 4, 10), null, null, [1, 1, 0.22]), 0.3, 0.25), 0xe0e0e0);
    } else if (arm === 'stump') {
      add('sh' + S, 'sack', G.uv(G.capY(0.056, 0, -0.05, 4, 12), 0.36, 0.08), 0xffffff);
      add('sh' + S, 'felt', G.xf(G.torus(0.045, 0.004, 4, 16), [0, -0.085, 0], [PI / 2, 0, 0]), THREAD);
    }
    R.bone('hip' + S, 'pelvis', [s * D.hipX, 0, 0], [0.15, 0, s * 0.1], 'ZXY');
    R.bone('kn' + S, 'hip' + S, [0, -D.thigh, 0], [-0.2, 0, 0], 'XYZ');
    if (leg === 'full') {
      add('hip' + S, 'sack', G.uv(G.capY(0.068, 0, -D.thigh, 4, 12), 0.43, 0.2), 0xffffff);
      add('kn' + S, 'sack', G.uv(G.capY(0.063, 0, -D.shin, 4, 12), 0.4, 0.2), 0xffffff);
      add('kn' + S, 'sack', G.uv(G.xf(G.ell(0.068, 0.05, 0.1, 14, 10), [0, -D.shin - 0.01, -0.03]), 0.4, 0.2), 0xffffff);
      add('kn' + S, 'felt', G.xf(G.torus(0.064, 0.0035, 4, 18), [0, -D.shin + 0.03, 0], [PI / 2, 0, 0]), THREAD);
    } else if (leg === 'stump') {
      add('hip' + S, 'sack', G.uv(G.capY(0.068, 0, -0.05, 4, 12), 0.43, 0.08), 0xffffff);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; add('hip' + S, 'felt', G.between(V3(Math.cos(a) * 0.05, -0.105, Math.sin(a) * 0.05), V3(Math.cos(a + 0.5) * 0.02, -0.118, Math.sin(a + 0.5) * 0.02), 0.003, 2, 4), THREAD); }
    }
  }
}

// face elements on the sack head (head bone space, HEAD shape)
const fpt = (x, y, off = 0) => featurePt(x, y, off);
function closedEyes(add, bone) {
  for (const s of [-1, 1]) {
    const pts = []; for (let i = 0; i <= 8; i++) { const a = lerp(-0.9, 0.9, i / 8); pts.push(fpt(s * 0.098 + Math.sin(a) * 0.022, 0.302 - Math.cos(a) * 0.011, 0.003).p); }
    add(bone, 'felt', G.tube(pts, 0.004, 12, 4), THREAD);
    for (const k of [-1, 0, 1]) { const b = fpt(s * 0.098 + k * 0.014, 0.29 - Math.abs(k) * 0.002, 0.003).p; add(bone, 'felt', G.between(b, b.clone().add(V3(k * 0.004, -0.009, -0.002)), 0.0022, 2, 4), THREAD); }
  }
}
function beadEye(add, bone, x, y, r) {
  const F = fpt(x, y, 0);
  add(bone, 'eyes', place(G.xf(G.sphere(r, 14, 10), [0, 0, r * 0.45]), F), EYE);
  add(bone, 'eyes', place(G.xf(G.sphere(r * 0.32, 6, 4), V3(0.42, 0.5, 0.76).normalize().multiplyScalar(r * 0.8).add(V3(0, 0, r * 0.45)).toArray()), F), 0xffffff);
}
function threadArc(add, bone, cx, cy, w, curve, r = 0.004, col = THREAD, stitches = 0) {
  const pts = []; for (let i = 0; i <= 12; i++) { const u = i / 12 * 2 - 1; pts.push(fpt(cx + u * w / 2, cy - curve * (1 - u * u), 0.003).p); }
  add(bone, 'felt', G.tube(pts, r, 20, 4), col);
  for (let i = 1; i < stitches; i++) { const p = pts[Math.round(i / stitches * 12)]; add(bone, 'felt', G.between(p.clone().add(V3(0, 0.008, 0.001)), p.clone().add(V3(0, -0.008, 0.001)), r * 0.6, 2, 4), col); }
  return pts;
}
function redNose(add, bone, r = 0.047, y = 0.222) { const F = fpt(0, y, r * 0.55); add(bone, 'felt', place(G.fuzzball(r, 0.05, 11, 3, 18, 12), F), NOSE); }
function pin(add, bone, x, y, col) {
  const F = fpt(x, y, 0);
  add(bone, 'metal', place(G.xf(G.cyl(0.0014, 0.0014, 0.05, 5), [0, 0, 0.012], [PI / 2 + 0.25, 0, 0]), F), 0xd8d8d8);
  add(bone, 'gloss', place(G.xf(G.sphere(0.006, 8, 6), [0, 0.009, 0.036]), F), col);
}
function chalkDash(add, bone, pts) { for (let i = 0; i < pts.length - 1; i += 2) add(bone, 'felt', G.between(pts[i], pts[i + 1], 0.0034, 2, 4), CHALK); }

export function buildUnfinishedClone(stage = 3, seed = 1) {
  stage = clamp(stage | 0, 0, 3);
  const rng = new RNG(seed * 97 + stage * 13 + 1);
  const R = new Rig();
  const add = (b, m, g, c) => R.add(b, m, g, c);
  let tone = FRESH;
  if (stage === 0) {
    // --- wire armature + floating innards
    R.bone('float', null, [0, 0, 0]);
    R.bone('pelvis', 'float', [0, D.pelvisY, 0]);
    R.bone('chest', 'pelvis', [0, D.chestY, 0]);
    R.bone('head', 'chest', [0, D.headY, 0]);
    R.bone('heart', 'chest', [-0.04, -0.06, -0.06]);
    const W = (bone, pts, r = 0.0045) => add(bone, 'metal', G.tube(pts.map((p) => V3(...p)), r, Math.max(6, pts.length * 4), 5), 0x9aa0a6);
    W('pelvis', [[0, -0.08, 0], [0, 0.2, 0.02], [0, 0.39, 0]], 0.007);
    for (const y of [0.05, 0.2, 0.33]) add('pelvis', 'metal', G.xf(G.torus(0.22 * (1 - Math.abs(y - 0.18) * 1.1), 0.004, 4, 30), [0, y, 0], [PI / 2, 0, 0], [1, 1, 0.85]), 0x9aa0a6);
    W('chest', [[-0.2, 0, 0], [0, 0.03, 0], [0.2, 0, 0]], 0.006);
    W('chest', [[0, 0, 0], [0, 0.1, 0]], 0.006);
    for (const s of [-1, 1]) {
      W('chest', [[s * 0.2, 0, 0], [s * 0.27, -0.12, -0.02], [s * 0.32, -0.25, -0.05], [s * 0.33, -0.3, -0.06]]);
      add('chest', 'metal', G.xf(G.sphere(0.012, 8, 6), [s * 0.27, -0.12, -0.02]), 0xb8bcc0);
      W('pelvis', [[s * 0.1, -0.02, 0], [s * 0.12, -0.13, -0.02], [s * 0.12, -0.23, 0.0], [s * 0.12, -0.3, -0.04]]);
      add('pelvis', 'metal', G.xf(G.sphere(0.012, 8, 6), [s * 0.12, -0.13, -0.02]), 0xb8bcc0);
    }
    for (const r of [[PI / 2, 0, 0], [0, 0, 0], [0, PI / 2, 0]]) add('head', 'metal', G.xf(G.torus(0.2, 0.0035, 4, 40), [0, 0.24, 0], r, [1, 1.3, 0.95]), 0x9aa0a6);
    // innards: stuffing clumps, a red felt heart, loose eyes and nose
    for (let i = 0; i < 9; i++) add('pelvis', 'stuff', G.xf(G.fuzzball(rng.range(0.04, 0.08), 0.22, i + 1, 6, 12, 9), [rng.range(-0.12, 0.12), rng.range(0.0, 0.35), rng.range(-0.1, 0.1)]), 0xede7d8);
    add('heart', 'felt', G.xf(G.fuzzball(0.035, 0.05, 2, 3, 12, 10), [-0.022, 0.01, 0]), 0xc8222a);
    add('heart', 'felt', G.xf(G.fuzzball(0.035, 0.05, 3, 3, 12, 10), [0.022, 0.01, 0]), 0xc8222a);
    add('heart', 'felt', G.xf(G.cyl(0.05, 0.002, 0.06, 12), [0, -0.03, 0], [PI, 0, 0], [1, 1, 0.65]), 0xc8222a);
    R.bone('loose', 'head', [0, 0.24, -0.05]);
    for (const s of [-1, 1]) add('loose', 'eyes', G.xf(G.sphere(0.021, 12, 9), [s * 0.08, 0.06 + s * 0.02, rng.range(-0.04, 0.02)]), EYE);
    add('loose', 'felt', G.xf(G.fuzzball(0.045, 0.05, 5, 3, 16, 12), [0.01, -0.02, -0.02]), NOSE);
  } else if (stage === 1) {
    sackDoll(R, add, { rng, seed, deflate: 0.55, headDeflate: 0.75, arms: { L: 'empty', R: 'full' }, legs: { L: 'stump', R: 'stump' } });
    tone = 0xcfb98f;
    // open seam at the back with stuffing spilling out
    for (let i = 0; i < 4; i++) add('pelvis', 'stuff', G.xf(G.fuzzball(0.05, 0.22, i + 3, 6, 12, 9), [rng.range(-0.08, 0.08), 0.15 + i * 0.07, 0.17]), 0xede7d8);
  } else {
    sackDoll(R, add, { rng, seed });
    if (stage === 2) {
      // unpainted face: chalk guide marks + sewing pins
      for (const s of [-1, 1]) {
        const ring = []; for (let i = 0; i <= 16; i++) { const a = (i / 16) * TAU; ring.push(fpt(s * 0.098 + Math.cos(a) * 0.026, 0.302 + Math.sin(a) * 0.026, 0.002).p); }
        chalkDash(add, 'head', ring);
        pin(add, 'head', s * 0.098, 0.302, s < 0 ? 0xe23b3b : 0x2f7fe0);
      }
      chalkDash(add, 'head', [fpt(-0.03, 0.222, 0.002).p, fpt(-0.012, 0.222, 0.002).p, fpt(0.012, 0.222, 0.002).p, fpt(0.03, 0.222, 0.002).p]);
      chalkDash(add, 'head', [fpt(0, 0.25, 0.002).p, fpt(0, 0.235, 0.002).p, fpt(0, 0.21, 0.002).p, fpt(0, 0.195, 0.002).p]);
      const m = []; for (let i = 0; i <= 10; i++) { const u = i / 10 * 2 - 1; m.push(fpt(u * 0.045, 0.145 - 0.012 * (1 - u * u), 0.002).p); }
      chalkDash(add, 'head', m);
      pin(add, 'head', 0.0, 0.222, 0xf6c41e);
      // barcode tag hanging off the wrist
      add('wrL', 'gloss', G.xf(G.rbox(0.035, 0.05, 0.004, 0.003), [0, -0.09, -0.04], [0.2, 0, 0]), 0xf4f2ea);
    } else {
      closedEyes(add, 'head');
      redNose(add, 'head');
      threadArc(add, 'head', 0, 0.148, 0.05, 0.01, 0.0035);
      for (const s of [-1, 1]) { const F = fpt(s * 0.135, 0.19, 0); add('head', 'felt', place(G.ell(0.025, 0.016, 0.003, 12, 6), F), BLUSH); }
      // toe tag on the right foot
      R.bone('tag', 'knR', [0.03, -D.shin - 0.02, -0.08]);
      add('tag', 'felt', G.tube([V3(0, 0, 0), V3(0.01, -0.02, -0.01), V3(0.012, -0.04, -0.005)], 0.0015, 6, 3), 0xd8d0c0);
      add('tag', 'gloss', G.xf(G.rbox(0.05, 0.03, 0.003, 0.003), [0.015, -0.06, -0.005], [0, 0.3, 0.2]), 0xf2e6c8);
      // umbilical feed line from the back of the neck
      const cable = [V3(0, 0.82, 0.18), V3(0.05, 1.0, 0.3), V3(-0.04, 1.25, 0.26), V3(0.02, 1.5, 0.2), V3(0, 1.62, 0.12)];
      add('float', 'rubber', G.tube(cable, 0.012, 30, 6), 0x2c2e33);
      add('float', 'metal', G.xf(G.cyl(0.02, 0.02, 0.04, 10), [0, 1.64, 0.12]), 0xa0a4a8);
    }
  }
  const root = new THREE.Group(); root.name = 'UnfinishedClone' + stage;
  root.add(R.b.float);
  const { meshes, skeleton } = R.build(mats(tone), { shadow: true, bounds: new THREE.Sphere(V3(0, 0.8, 0), 1.2) });
  for (const m of meshes) root.add(m);
  for (const ex of R.extras) R.b[ex.bone].add(ex.obj);
  const b = R.b;
  const restQ = new Map(R.bones.map((bn) => [bn, bn.quaternion.clone()]));
  const st = { t: rng.next() * 10, tw: 0, twBone: null, twAx: V3(), next: rng.range(2, 6), sp: new Spring(90, 5, 0) };
  const twitchable = ['shL', 'shR', 'elL', 'elR', 'head', 'hipL', 'hipR', 'knL', 'knR', 'wrR'].filter((n) => b[n]);
  function update(dt, t) {
    dt = clamp(dt || 0, 0, 0.1);
    st.t = t ?? st.t + dt;
    const T = st.t;
    R.reset();
    // gentle float in the fluid
    b.float.position.set(Math.sin(T * 0.31 + seed) * 0.015, Math.sin(T * 0.6 + seed) * 0.03, Math.cos(T * 0.27) * 0.012);
    b.float.rotation.set(Math.sin(T * 0.23) * 0.04, Math.sin(T * 0.17 + seed) * 0.12, Math.sin(T * 0.29 + 1) * 0.03);
    // limbs drift
    for (const [n, f] of [['shL', 0.5], ['shR', 0.45], ['hipL', 0.4], ['hipR', 0.37], ['head', 0.33]]) if (b[n]) b[n].rotation.x += Math.sin(T * f + n.length) * 0.06, b[n].rotation.z += Math.sin(T * f * 0.8 + 2) * 0.04;
    // occasional twitch
    st.next -= dt;
    if (st.next <= 0 && twitchable.length) { st.next = rng.range(2.5, 7); st.twBone = rng.pick(twitchable); st.twAx.set(rng.range(-1, 1), rng.range(-0.4, 0.4), rng.range(-1, 1)); st.sp.v = 9; }
    const k = st.sp.step(dt, 0);
    if (st.twBone) { b[st.twBone].rotation.x += k * st.twAx.x * 0.4; b[st.twBone].rotation.z += k * st.twAx.z * 0.4; }
    if (b.heart) { const beat = Math.max(0, Math.sin(T * 7.5)) ** 8 + Math.max(0, Math.sin(T * 7.5 - 0.6)) ** 8 * 0.6; b.heart.scale.setScalar(1 + beat * 0.18); }
    if (b.loose) { b.loose.position.y += Math.sin(T * 0.9) * 0.02; b.loose.rotation.y = T * 0.3; }
  }
  update(0, 0);
  return { root, update };
}

// ============================================================================
// Receptionist
// ============================================================================
export const RECEPTIONIST = { seatHeight: 0.45, deskHeight: 0.77, deskFrontZ: -0.13 };
export function buildReceptionist() {
  const rng = new RNG(4242);
  const R = new Rig();
  const add = (b, m, g, c) => R.add(b, m, g, c);
  const SHIRT = 'c:twill:bcd2ea', PANTS = 'c:twill:34363d', W = 0xffffff;
  const PY = RECEPTIONIST.seatHeight + 0.105;
  R.bone('pelvis', null, [0, PY, 0], null, 'ZXY');
  R.bone('chest', 'pelvis', [0, D.chestY, 0], null, 'ZXY');
  R.bone('head', 'chest', [0, D.headY, 0], null, 'YXZ');
  R.bone('hair', 'head', [0, 0, 0]);
  // torso: shirt above, slacks below, belt
  const top = headGrid(TORSO, 30, 20, 1, null, 3);
  paint(top, (x, y, z) => (y < 0.06 ? 0x34363d : (Math.floor((x + 1) / 0.022) % 3 === 0 ? 0xdde8f6 : 0xffffff)));
  add('pelvis', SHIRT, G.uv(top, 1.7, 0.7), W);
  add('pelvis', 'trim', G.xf(G.cyl(0.282, 0.28, 0.03, 30, true), [0, 0.06, 0], null, [1, 1, 0.92]), 0x1a1a1c);
  // collar + tie + buttons + shoulder pads + name tag
  for (const s of [-1, 1]) add('chest', SHIRT, G.xf(G.rbox(0.08, 0.05, 0.01, 0.008), [s * 0.05, 0.085, -0.155], [-0.7, s * 0.4, s * 0.5]), 0xf4f4f4);
  add('chest', 'matte', G.xf(G.rbox(0.032, 0.03, 0.02, 0.008), [0, 0.07, -0.175]), 0xa8202a);
  const tie = new THREE.Shape(); tie.moveTo(-0.013, 0); tie.lineTo(0.013, 0); tie.lineTo(0.03, -0.2); tie.lineTo(0, -0.232); tie.lineTo(-0.03, -0.2); tie.closePath();
  const tg = new THREE.ExtrudeGeometry(tie, { depth: 0.006, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 1 });
  paint(tg, (x, y) => (Math.floor((x * 0.8 - y) / 0.025) % 2 ? 0xa8202a : 0x1f2f5a));
  add('chest', 'matte', G.xf(tg, [0, 0.058, -0.183], [-0.42, 0, 0]), W);
  for (const s of [-1, 1]) add('chest', SHIRT, G.xf(G.ell(0.075, 0.035, 0.08, 14, 8), [s * 0.17, 0.0, 0]), 0xf0f0f0);
  const tagTex = labelTexture(256, 96, (ctx, w, h) => { ctx.fillStyle = '#f4f2ea'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#c0202a'; ctx.fillRect(0, 0, w, 26); ctx.fillStyle = '#fff'; ctx.font = "bold 20px 'IBM Plex Mono', monospace"; ctx.textAlign = 'center'; ctx.fillText('HELLO I AM', w / 2, 20); ctx.fillStyle = '#151515'; ctx.font = "bold 40px 'IBM Plex Mono', monospace"; ctx.fillText('RECEPTION', w / 2, 72); });
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.034), new THREE.MeshStandardMaterial({ map: tagTex, roughness: 0.6 }));
  tag.position.set(0.12, 0.32, -0.215); tag.rotation.set(-0.25, -0.45, 0); tag.rotation.order = 'YXZ'; tag.rotation.set(-0.3, 0.42, 0);
  R.attach('pelvis', tag);
  // head + fixed face
  const hg = headGrid(HEAD, 30, 22, 1, null, 7);
  add('head', 'sack', G.uv(hg, 1.3, 0.75), W);
  for (const s of [-1, 1]) {
    beadEye(add, 'head', s * 0.096, 0.3, 0.024);
    for (let k = 0; k < 3; k++) { const b = fpt(s * (0.085 + k * 0.012), 0.322 - k * 0.002, 0.004).p; add('head', 'felt', G.between(b, b.clone().add(V3(s * 0.006, 0.012, -0.002)), 0.0018, 2, 4), THREAD); }
    const F = fpt(s * 0.13, 0.19, 0); add('head', 'felt', place(G.ell(0.03, 0.02, 0.003, 12, 6), F), 0xe07a72);
    const bF = fpt(s * 0.1, 0.375, 0.002);
    add('head', 'felt', place(G.tube([V3(-0.022, -0.004, 0), V3(0, 0.005, 0), V3(0.022, -0.004, 0)], 0.004, 8, 4), bF), THREAD);
  }
  redNose(add, 'head', 0.044);
  threadArc(add, 'head', 0, 0.168, 0.16, 0.045, 0.0055, 0x2a120c, 11);
  threadArc(add, 'head', 0, 0.158, 0.13, 0.026, 0.0035, 0xc85a66);
  // 90s yarn bob: crown cap + side/back curtain framing the face + curled-under ends
  const hairCol = 0x5a3522;
  const capH = headGrid(HEAD, 30, 8, 1.09, 0.375, 0);
  paint(capH, (x, y, z) => _hc(x, z, hairCol));
  add('hair', 'knit', G.uv(capH, 1.3, 0.3), W);
  const hc = V3(0, HEAD.cy, 0);
  const side = surfaceGrid(26, 8, (u, v, p) => {
    const phi = lerp(PI + 0.62, 3 * PI - 0.62, u), y = lerp(0.105, 0.4, v);
    headPt(phi, y, 0, p); p.sub(hc).multiplyScalar(1.09 + 0.05 * Math.pow(1 - v, 2)).add(hc);
  });
  paint(side, (x, y, z) => _hc(x, z, hairCol));
  add('hair', 'knit', G.uv(side, 1.1, 0.3), W);
  const curl = []; for (let i = 0; i <= 26; i++) { const phi = lerp(PI + 0.62, 3 * PI - 0.62, i / 26); const p = headPt(phi, 0.11, 0); p.sub(hc).multiplyScalar(1.12).add(hc); curl.push(p); }
  add('hair', 'knit', G.uv(G.tube(curl, 0.024, 40, 8), 1.1, 0.1), hairCol);
  for (let i = 0; i < 5; i++) { const x = -0.1 + i * 0.05; const F = fpt(x, 0.405 - Math.abs(x) * 0.15, 0.022); add('hair', 'knit', place(G.fuzzball(0.03, 0.12, i + 2, 4, 12, 8), F), hairCol); }
  // big 90s glasses
  for (const s of [-1, 1]) {
    const F = fpt(s * 0.097, 0.3, 0.02);
    add('head', 'gloss', place(G.xf(G.torus(0.045, 0.004, 6, 24), null, null, [1, 0.85, 1]), F), 0x8a2a3a);
    const side = fpt(s * 0.145, 0.31, 0.01).p;
    add('head', 'gloss', G.tube([side, headPt(PI / 2 * (2 - s) + s * 0.3, 0.315, 0.012), headPt(PI / 2 * (2 - s) - s * 0.2, 0.29, 0.012)], 0.003, 8, 4), 0x8a2a3a);
  }
  add('head', 'gloss', G.tube([fpt(-0.054, 0.31, 0.024).p, fpt(0, 0.318, 0.03).p, fpt(0.054, 0.31, 0.024).p], 0.0032, 8, 4), 0x8a2a3a);
  // headset: band over the hair, ear cup, boom mic
  const band = []; for (let i = 0; i <= 16; i++) { const a = lerp(-PI / 2, PI / 2, i / 16); band.push(V3(Math.sin(a) * 0.235, HEAD.cy + 0.04 + Math.cos(a) * 0.3, 0.02)); }
  add('head', 'gloss', G.tube(band, 0.006, 24, 5), 0x222226);
  add('head', 'gloss', G.xf(G.cyl(0.04, 0.04, 0.025, 18), [0.225, 0.24, 0.02], [0, 0, PI / 2]), 0x222226);
  add('head', 'gloss', G.tube([V3(0.235, 0.22, 0.0), V3(0.21, 0.16, -0.12), V3(0.12, 0.13, -0.2), V3(0.06, 0.13, -0.215)], 0.004, 16, 4), 0x222226);
  add('head', 'gloss', G.xf(G.sphere(0.013, 10, 8), [0.055, 0.13, -0.217]), 0x111111);
  // seated limbs
  for (const [S, s] of [['L', -1], ['R', 1]]) {
    R.bone('sh' + S, 'chest', [s * D.shX, 0, 0], [0.42, 0, s * 0.18], 'ZXY');
    add('sh' + S, SHIRT, G.uv(G.capY(0.06, 0, -D.upper, 4, 12), 0.38, 0.2), W);
    R.bone('el' + S, 'sh' + S, [0, -D.upper, 0], [1.25, 0, -s * 0.2], 'XYZ');
    add('el' + S, SHIRT, G.uv(G.capY(0.055, 0, -D.fore + 0.01, 4, 12), 0.35, 0.2), W);
    add('el' + S, SHIRT, G.xf(G.torus(0.053, 0.008, 6, 18), [0, -D.fore + 0.015, 0], [PI / 2, 0, 0]), 0xe8e8e8);
    R.bone('wr' + S, 'el' + S, [0, -D.fore, 0], [-0.15, 0, 0], 'XYZ');
    add('wr' + S, 'sack', G.uv(G.xf(G.ell(0.05, 0.062, 0.042, 14, 10), [0, -0.05, 0]), 0.3, 0.12), W);
    add('wr' + S, 'sack', G.between([s * -0.03, -0.03, -0.02], [s * -0.042, -0.06, -0.042], 0.018, 3, 8), W);
    R.bone('hip' + S, 'pelvis', [s * D.hipX, 0, 0], [PI / 2 - 0.08, 0, s * 0.05], 'ZXY');
    add('hip' + S, PANTS, G.uv(G.capY(0.072, 0, -D.thigh - 0.03, 4, 12), 0.45, 0.2), W);
    R.bone('kn' + S, 'hip' + S, [0, -D.thigh - 0.03, 0], [-PI / 2 + 0.1 + s * 0.05, 0, 0], 'XYZ');
    add('kn' + S, PANTS, G.uv(G.capY(0.066, 0, -D.shin, 4, 12), 0.42, 0.2), W);
    R.bone('an' + S, 'kn' + S, [0, -D.shin, 0], [0.1, 0, 0], 'ZXY');
    add('an' + S, 'felt', G.xf(G.ell(0.065, 0.045, 0.1, 14, 9), [0, -0.035, -0.035]), 0x141416);
    add('an' + S, 'gloss', G.xf(G.cyl(0.07, 0.072, 0.015, 16), [0, -0.075, -0.035], null, [1, 1, 1.45]), 0x0c0c0e);
    add('an' + S, 'matte', G.xf(G.capY(0.058, 0.03, -0.03, 3, 10)), 0x2a2a30);
  }
  const root = new THREE.Group(); root.name = 'Receptionist';
  root.add(R.b.pelvis);
  const { meshes } = R.build(mats(0xd2b88c), { shadow: true, bounds: new THREE.Sphere(V3(0, 0.9, 0), 1.2) });
  for (const m of meshes) root.add(m);
  for (const ex of R.extras) R.b[ex.bone].add(ex.obj);
  const b = R.b;
  const st = { yaw: 0, pitch: 0, roll: 0, t: 0 };
  const tmp = V3();
  function update(dt, s = {}) {
    dt = clamp(dt || 0, 0, 0.1); st.t += dt;
    R.reset();
    if (s.lookTarget) {
      root.updateWorldMatrix(true, true);
      tmp.copy(s.lookTarget); b.chest.worldToLocal(tmp); tmp.sub(b.head.position); tmp.y -= HEAD.cy;
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
  return { root, update };
}
