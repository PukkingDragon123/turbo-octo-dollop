// TWIN — two employees sewn into one body. The bigger one (A) stands almost normally; the smaller
// one (B) grows out of its right side, a size too small and twisted, its head sagging onto its
// shoulder: one eye sewn shut, a second red nose where its mouth should be. Two suits are joined
// by a crude seam of thick stitches and tape; stuffing bulges where it pulls. Three arms (a
// withered one reaching out of the seam) and three legs (B's leg too long, a stunted middle leg
// dragging backwards). They lurch, giggle in shuddering bursts, and their heads never agree.
import * as THREE from 'three';
import { Sculpt, MAT } from './sdf.js';
import { PartSet, ClothSet } from './parts.js';
import { BoneSpec, assembleBody } from './rig.js';
import { Frame, sackHead, headSeams, hood, face, glove, boot, tape, tapeStrip, badge, airTank, hose, tear, scar, surfPath, onSurf, hit, rag, crossStitch, runningStitch, ringAround, add3, sub3, norm3, gloveJoints, limbFolds, torsoFolds, drip, handprint } from './details.js';
import * as G from './geo.js';
import { PAL, RNG, PI, TAU, clamp, lerp } from './core.js';
import { Spring, Hold, Saccade, tremor, rot, addRot, rotAxis, ik2, Planter, setWorldQuat, parentLocal } from './anim.js';

const HA = Frame.e([-0.135, 0.9, 0.0], [0.04, 0.12, -0.2], 'ZXY');
const HB = Frame.e([0.25, 0.775, -0.04], [-0.45, -0.4, -1.3], 'ZXY');
const DA = { w: 0.2, h: 0.48, d: 0.18 }, DB = { w: 0.158, h: 0.38, d: 0.145 };
const J = {
  shAL: [-0.35, 0.76, 0.0], elAL: [-0.41, 0.55, -0.02], wrAL: [-0.43, 0.35, -0.05],
  shBR: [0.39, 0.67, 0.03], elBR: [0.48, 0.44, 0.03], wrBR: [0.52, 0.2, -0.01],
  shM: [0.03, 0.7, -0.16], elM: [0.05, 0.6, -0.31], wrM: [0.07, 0.5, -0.38],
  hipAL: [-0.23, 0.36, 0.0], knAL: [-0.245, 0.22, -0.01], anAL: [-0.255, 0.1, 0.0],
  hipBR: [0.26, 0.35, 0.02], knBR: [0.285, 0.22, 0.0], anBR: [0.3, 0.1, 0.0],
  hipM: [0.03, 0.3, 0.07], knM: [0.035, 0.2, 0.15], anM: [0.04, 0.09, 0.2],
};

const GLV = {
  AL: { F: Frame.e(J.wrAL, [0.1, 0, -0.08]), sc: 1, lens: [0.05, 0.056, 0.052, 0.044] },
  BR: { F: Frame.e(J.wrBR, [0.05, 0, 0.1]), sc: 0.95, lens: [0.075, 0.085, 0.08, 0.065] },
  M: { F: Frame.e(J.wrM, [0.9, 0, 0.1]), sc: 0.75, lens: [0.07, 0.075, 0.06] },
};

function bones() {
  const B = new BoneSpec();
  B.add('pelvis', null, [0.02, 0.44, 0.01]);
  B.add('spineA', 'pelvis', [-0.15, 0.6, 0.0]);
  B.add('bellyA', 'spineA', [-0.14, 0.58, -0.06]);
  B.add('chestA', 'spineA', [-0.15, 0.76, 0.0]);
  B.add('neckA', 'chestA', [-0.14, 0.88, 0.01]);
  B.add('headA', 'neckA', HA.p(0, 0.03, 0));
  B.add('jawA', 'headA', HA.p(0, 0.13, -0.14));
  B.add('spineB', 'pelvis', [0.2, 0.55, 0.02]);
  B.add('chestB', 'spineB', [0.21, 0.68, 0.02]);
  B.add('neckB', 'chestB', [0.22, 0.77, 0.0]);
  B.add('headB', 'neckB', HB.p(0, 0.03, 0));
  B.add('seam', 'pelvis', [0.03, 0.62, -0.12]);
  B.add('tank', 'chestA', [-0.17, 0.66, 0.26]);
  const arm = (S, sh, el, wr, par, side) => {
    B.add('shoulder' + S, par, sh); B.add('elbow' + S, 'shoulder' + S, el); B.add('wrist' + S, 'elbow' + S, wr);
    const g = GLV[S];
    const gj = gloveJoints(g.F, side, g.lens.map((len) => ({ len, curl: 0.5, segs: 3 })), g.sc);
    gj.bases.forEach((p, i) => B.add(`f${S}${i}`, 'wrist' + S, p));
    B.add('thumb' + S, 'wrist' + S, gj.thumb);
  };
  arm('AL', J.shAL, J.elAL, J.wrAL, 'chestA', -1);
  arm('BR', J.shBR, J.elBR, J.wrBR, 'chestB', 1);
  arm('M', J.shM, J.elM, J.wrM, 'seam', 1);
  for (const S of ['AL', 'BR', 'M']) { B.add('hip' + S, 'pelvis', J['hip' + S]); B.add('knee' + S, 'hip' + S, J['kn' + S]); B.add('ankle' + S, 'knee' + S, J['an' + S]); }
  return B;
}

export function template() {
  const B = bones();
  const names = B.names;
  const body = new Sculpt(names), head = new Sculpt(names), hands = new Sculpt(names), feet = new Sculpt(names);
  body.maxFoldFreq = 110; feet.maxFoldFreq = 120;
  const suitB = 0xc49a1c; // B's suit: a different, older batch
  // ------------------------------------------------------------------ A torso
  body.push({ mat: MAT.SUIT, col: PAL.suit, k: 0.05, dirt: 0.35 });
  body.ell([-0.15, 0.6, 0.0], [0.235, 0.27, 0.205], null, { bone: 'bellyA' });
  body.ell([-0.15, 0.75, 0.01], [0.22, 0.13, 0.19], null, { bone: 'chestA', k: 0.07 });
  body.sphere([-0.33, 0.76, 0.0], 0.075, { bone: 'chestA', k: 0.06 });
  body.ell([-0.08, 0.42, 0.01], [0.2, 0.12, 0.17], null, { bone: 'pelvis', k: 0.06 });
  body.cone([-0.14, 0.8, 0.02], [-0.135, 0.9, 0.03], 0.12, 0.09, { bone: 'chestA', bone2: 'neckA', k: 0.05 });
  // ------------------------------------------------------------------ B torso: smaller, twisted, fused into A's side
  body.ell([0.21, 0.56, 0.02], [0.18, 0.22, 0.16], [0, -0.4, 0.15], { bone: 'spineB', col: suitB, k: 0.09 });
  body.ell([0.22, 0.67, 0.02], [0.16, 0.11, 0.15], [0, -0.4, 0.25], { bone: 'chestB', col: suitB, k: 0.07 });
  body.sphere([0.37, 0.67, 0.03], 0.062, { bone: 'chestB', col: suitB, k: 0.05 });
  body.cone([0.22, 0.7, 0.02], [0.235, 0.79, 0.0], 0.1, 0.075, { bone: 'chestB', bone2: 'neckB', col: suitB, k: 0.05 });
  // the fused flank bulges with stuffing between the two bodies
  body.ell([0.04, 0.6, -0.08], [0.09, 0.16, 0.1], null, { bone: 'seam', k: 0.06 });
  body.ell([0.04, 0.62, 0.1], [0.08, 0.15, 0.09], null, { bone: 'seam', k: 0.06 });
  // arms
  const sleeve = (S, sh, el, wr, r, col, end = 1) => {
    const e = [lerp(el[0], wr[0], end), lerp(el[1], wr[1], end), lerp(el[2], wr[2], end)];
    body.chain([sh, el, e], [r, r * 0.85, r * 0.8], { bones: ['shoulder' + S, 'elbow' + S], k: 0.04, col, noise: [0.0025, 14] });
    body.fold(el, 0.08, sub3(el, sh), 140, 0.0045, { warp: 0.8 });
    return e;
  };
  sleeve('AL', J.shAL, J.elAL, [J.wrAL[0], J.wrAL[1] + 0.07, J.wrAL[2]], 0.068, PAL.suit);
  sleeve('BR', J.shBR, J.elBR, [J.wrBR[0], J.wrBR[1] + 0.07, J.wrBR[2]], 0.056, suitB);
  // withered middle arm: torn sleeve stump, bare burlap arm
  body.cone(J.shM, [lerp(J.shM[0], J.elM[0], 0.4), lerp(J.shM[1], J.elM[1], 0.4), lerp(J.shM[2], J.elM[2], 0.4)], 0.05, 0.042, { bone: 'shoulderM', k: 0.04, noise: [0.004, 18] });
  body.chain([J.shM, J.elM, [J.wrM[0], J.wrM[1] + 0.05, J.wrM[2] - 0.02]], [0.034, 0.028, 0.026], { bones: ['shoulderM', 'elbowM'], mat: MAT.SKIN, col: PAL.burlapDark, k: 0.02, thin: 0.6, dirt: 0.55 });
  body.sphere(J.elM, 0.031, { bone: 'elbowM', mat: MAT.SKIN, col: PAL.burlapDark, k: 0.015, thin: 0.5 });
  // legs: A normal, B too long, middle stunted and turned backwards
  const leg = (S, r, col) => {
    body.chain([J['hip' + S], J['kn' + S], [J['an' + S][0], 0.16, J['an' + S][2]]], [r, r * 0.88, r * 0.85], { bones: ['hip' + S, 'knee' + S], k: 0.04, col });
    body.sphere([J['an' + S][0], 0.18, J['an' + S][2]], r * 0.92, { bone: 'knee' + S, k: 0.04, col });
    body.fold([J['an' + S][0], 0.2, J['an' + S][2]], 0.08, [0, 1, 0], 120, 0.004, { warp: 0.9 });
  };
  leg('AL', 0.08, PAL.suit); leg('BR', 0.066, suitB); leg('M', 0.058, PAL.suit);
  for (const S of ['AL', 'BR']) limbFolds(body, J['hip' + S], J['kn' + S], 0.075, { seed: S.length * 5 + 1, amp: 1.1 });
  limbFolds(body, J.shAL, J.elAL, 0.068, { seed: 21 }); limbFolds(body, J.elAL, J.wrAL, 0.058, { seed: 22 });
  limbFolds(body, J.shBR, J.elBR, 0.056, { seed: 23 }); limbFolds(body, J.elBR, J.wrBR, 0.048, { seed: 24 });
  torsoFolds(body, [-0.15, 0.6, 0], [0.23, 0.25, 0.2], 8, { seed: 25, amp: 0.9 });
  torsoFolds(body, [0.21, 0.56, 0.02], [0.17, 0.2, 0.15], 6, { seed: 26, amp: 0.9 });
  body.fold([-0.15, 0.48, -0.17], 0.15, [0.2, 1, 0], 120, 0.0035, { warp: 0.7 });
  body.fold([0.21, 0.5, -0.12], 0.13, [-0.3, 1, 0], 120, 0.0035, { warp: 0.7 });
  body.pop();
  // hoods (A framing its face; B's half torn off)
  hood(body, { ...DA, F: HA }, { bone: 'headA', drapeBone: 'neckA', thick: 0.022, openY: 0.45, openW: 0.86, openH: 0.42, gathers: 16 });
  hood(body, { ...DB, F: HB }, { bone: 'headB', drapeBone: 'neckB', thick: 0.018, openY: 0.47, openW: 0.92, openH: 0.44, gathers: 13, col: suitB });
  body.sphere(HB.p(0.06, 0.38, 0.06), 0.11, { sub: true, k: 0.015, mat: null, bone: 'headB', noise: [0.02, 18] });
  // ------------------------------------------------------------------ heads
  const HAd = sackHead(head, HA, { ...DA, bone: 'headA', neckLen: 0.06, neckBone: 'neckA', dirt: 0.3 });
  head.ell(HA.p(0, 0.11, -0.1), [0.08, 0.075, 0.07], HA.q, { bone: 'jawA', mat: MAT.SKIN, col: PAL.burlap, k: 0.05 });
  const HBd = sackHead(head, HB, { ...DB, bone: 'headB', neckLen: 0.05, neckBone: 'neckB', col: PAL.burlapDark, dirt: 0.5, thin: 0.15, cheekR: 1.25 });
  // ------------------------------------------------------------------ hands / feet
  const gl = (S, side) => glove(hands, GLV[S].F, side, {
    bone: 'wrist' + S, cuffBone: 'elbow' + S, scale: GLV[S].sc,
    fingers: GLV[S].lens.map((len, i) => ({ len, curl: 0.5, segs: 3, r: 0.0118, bones: [`f${S}${i}`] })),
    thumb: { len: 0.045, bones: ['thumb' + S] },
  });
  gl('AL', -1); gl('BR', 1); gl('M', 1);
  boot(feet, Frame.e(J.anAL, [0, 0.05, 0]), { bone: 'ankleAL', shinBone: 'kneeAL' });
  boot(feet, Frame.e(J.anBR, [0, -0.15, 0]), { bone: 'ankleBR', shinBone: 'kneeBR', scale: 0.92 });
  boot(feet, Frame.e(J.anM, [0.3, PI * 0.9, 0.2]), { bone: 'ankleM', shinBone: 'kneeM', scale: 0.8 });
  body.prepare(); head.prepare(); hands.prepare(); feet.prepare();
  const parts = new PartSet(names, body), cloth = new ClothSet(names, body);
  // ------------------------------------------------------------------ faces
  face(head, parts, HAd, {
    bone: 'headA',
    eyes: [{ x: -0.09, y: 0.3, r: 0.021 }, { x: 0.09, y: 0.305, r: 0.021, browTilt: 0.02 }],
    noses: [{ x: 0.0, y: 0.215, r: 0.045 }],
    mouth: { x: 0.005, y: 0.135, w: 0.05, kind: 'stitch', curve: -0.006 },
  });
  // B: one bead eye, the other sewn shut; a second nose where its mouth should be
  const fb = face(head, parts, HBd, {
    bone: 'headB',
    eyes: [{ x: 0.06, y: 0.245, r: 0.017, browY: 0.055, browTilt: -0.04 }],
    noses: [{ x: -0.005, y: 0.18, r: 0.033 }, { x: 0.01, y: 0.1, r: 0.028, col: PAL.noseDirty }],
    brows: false,
  });
  {
    const r = hit(head, HB.p(-0.065, 0.24, -0.3), HB.d(0, 0, 1), 0.5);
    if (r) {
      head.bulge(r.p, 0.022, -0.006);
      const pts = surfPath(head, add3(r.p, HB.d(-1, 0, 0), 0.022), add3(r.p, HB.d(1, 0, 0), 0.022), 5);
      crossStitch(parts, pts, { ws: head, bone: 'headB', size: 0.014, step: 1, r: 0.003 });
    }
  }
  headSeams(head, parts, HAd, { bone: 'headA', sides: [-1] });
  headSeams(head, parts, HBd, { bone: 'headB', sides: [1] });
  // ------------------------------------------------------------------ the seam joining the two bodies
  const seamF = surfPath(body, [0.035, 0.84, -0.13], [0.03, 0.36, -0.15], 18, [0, 0, -0.06]);
  const seamB = surfPath(body, [0.04, 0.82, 0.16], [0.04, 0.38, 0.16], 16, [0, 0, 0.05]);
  for (const sm of [seamF, seamB]) {
    body.groove(sm.map((q) => q.p), 0.009, 0.007, { rim: 0.004, wobble: 0.4, col: 0x6a4a1c, colOnly: true, dirt: 0.7 });
    crossStitch(parts, sm, { ws: body, size: 0.032, step: 1, r: 0.0042, color: 0x16100b });
  }
  // the seam weeps: dark wet streaks run down from the stitches
  for (let i = 1; i < seamF.length - 2; i += 3) drip(body, seamF[i].p, { n: 2, len: 0.12, w: 0.01, col: 0x2e1a10, wet: 0.7, seed: i });
  for (let i = 2; i < seamB.length - 2; i += 4) drip(body, seamB[i].p, { n: 2, len: 0.1, w: 0.01, col: 0x2e1a10, wet: 0.6, seed: i + 50 });
  if (fb.noses[1]) drip(head, fb.noses[1].p, { n: 2, len: 0.08, w: 0.007, col: 0x26140c, wet: 0.8, seed: 61 });
  for (const [p, up, sd] of [[[-0.25, 0.55, -0.2], [0.3, 1, 0], 1], [[0.25, 0.5, -0.14], [-0.3, 1, 0], 2], [[-0.1, 0.7, 0.2], [0, 1, 0], 3]]) { const q = onSurf(body, p); handprint(body, q.p, q.n, up, { seed: sd }); }
  // tape patches over the worst of it
  for (const [a, b2] of [[[-0.04, 0.78, -0.16], [0.11, 0.7, -0.15]], [[-0.03, 0.5, -0.19], [0.1, 0.56, -0.16]], [[-0.02, 0.62, 0.2], [0.1, 0.68, 0.16]]]) tapeStrip(parts, body, surfPath(body, a, b2, 6), { width: 0.04 });
  // stuffing bursting from the flank between them
  const T = (p, o) => { const q = onSurf(body, p); return tear(body, parts, cloth, q.p, q.n, o.size, o); };
  T([0.06, 0.66, -0.15], { size: 0.06, seed: 71, angle: 1.5, stuff: 4, flap: false });
  T([0.07, 0.48, 0.15], { size: 0.055, seed: 72, angle: 1.2, stuff: 3 });
  T([-0.33, 0.6, -0.08], { size: 0.045, seed: 73, angle: 0.6, stuff: 2 });
  T([0.33, 0.47, -0.06], { size: 0.05, seed: 74, angle: 0.2, stuff: 2 });
  // badges, tank (A), B's harness hanging loose
  { const q = onSurf(body, [-0.24, 0.72, -0.2]); badge(parts, q.p, q.n, [0.1, 1, 0], 0, { bone: 'chestA', spin: 0.1 }); }
  { const q = onSurf(body, [0.26, 0.64, -0.14]); badge(parts, q.p, q.n, [-0.3, 1, 0], 2, { bone: 'chestB', spin: -0.35 }); }
  const tk = airTank(parts, Frame.e([-0.17, 0.66, 0.255], [0.05, 0, 0.12]), { bone: 'tank', len: 0.38, r: 0.072, dents: 3, seed: 21 });
  tapeStrip(parts, body, surfPath(body, [-0.27, 0.56, -0.18], [-0.3, 0.82, 0.0], 8, [0, 0.03, 0]).concat(surfPath(body, [-0.3, 0.82, 0.02], [-0.26, 0.55, 0.2], 8).slice(1)), { width: 0.034, color: 0x1e1d1c, lift: 0.004 });
  { const q = onSurf(body, [0.3, 0.74, 0.04]); rag(cloth, body, q.p, q.n, 0.034, 0.22, { color: 0x1e1d1c, mat: MAT.RUBBER, out: 0.3, seed: 77, bone: 'chestB' }); }
  hose(parts, [tk.top, add3(tk.top, [0.05, 0.03, 0]), [-0.02, 0.8, 0.14], [0.1, 0.83, 0.05], HB.p(-0.05, 0.12, 0.1)], { bone: 'tank', ws: body });
  // tape at wrists and boot tops
  for (const S of ['AL', 'BR', 'M']) { const F = GLV[S].F; tape(parts, hands, F.p(0, 0.045 * GLV[S].sc, 0), F.d(0, 1, 0), { wraps: S === 'M' ? 1 : 2, width: 0.03 * GLV[S].sc, seed: S.length * 7, reach: 0.09 }); }
  for (const S of ['AL', 'BR']) tape(parts, feet, [J['an' + S][0], 0.19, J['an' + S][2]], [0, 1, 0], { wraps: 2, width: 0.036, seed: 3 + S.length, reach: 0.13 });

  const { geo, stats } = assembleBody([
    { S: body, h: 0.0145, tris: 12000 }, { S: head, h: 0.0088, tris: 9000 }, { S: hands, h: 0.0066, tris: 5200 }, { S: feet, h: 0.0115, tris: 3000 },
  ], { floor: 0.6, stains: 0.65, fade: 0.5, seed: 11 });
  return {
    spec: B, body: geo, parts: parts.build(), cloth: cloth.build(),
    bounds: new THREE.Sphere(new THREE.Vector3(0.03, 0.7, 0), 1.1),
    height: 1.36, radius: 0.36, stats, meta: {},
  };
}

// ============================================================================
export function animator(inst, tpl, seed) {
  const b = inst.byName, rest = inst.rest, bones = inst.bones;
  const rng = new RNG(seed * 6151 + 29);
  const legs = new Planter(rng, [
    { rest: new THREE.Vector3(-0.255, 0, 0.0), group: 0, lift: 0.07, dur: 0.3 },
    { rest: new THREE.Vector3(0.3, 0, 0.0), group: 1, lift: 0.09, dur: 0.36 },
  ], { lead: 0.15, stride: 0.2, overshoot: 0.3, jitter: 0.6 });
  const gA = new Saccade(rng, { lo: 0.3, hi: 1.8, k: 800, d: 26, err: 0.15, over: 0.3, maxYaw: 1.6 });
  const gB = new Saccade(rng, { lo: 0.2, hi: 2.6, k: 1100, d: 22, err: 0.6, over: 0.5, maxYaw: 2.4 });
  const vary = { lean: rng.range(-0.06, 0.06), bTilt: rng.range(-0.2, 0.2), armM: rng.range(-0.3, 0.3) };
  const st = {
    t: rng.next() * 40, prevAtk: 0, atkT: 9, frozenT: 0,
    roll: new Spring(35, 4), bob: new Spring(60, 7), giggle: 0, giggleHold: new Hold(rng, 2, 7), drag: new THREE.Vector3(), hasDrag: false,
    armA: new Spring(30, 3), armB: new Spring(16, 1.8), armM: new Spring(40, 4), reach: 0, reachHold: new Hold(rng, 1.5, 4),
    bLock: 0, bLockHold: new Hold(rng, 2, 6), twitchHold: new Hold(rng, 1, 3.5), tw: 0, twB: null,
  };
  const v = new THREE.Vector3(), tgt = new THREE.Vector3(), q = new THREE.Quaternion(), toT = new THREE.Vector3(), pole = new THREE.Vector3(), bend = new THREE.Vector3(0, 0, -1);
  const reset = () => { for (let i = 0; i < bones.length; i++) { bones[i].position.copy(rest[i]); bones[i].quaternion.identity(); bones[i].scale.set(1, 1, 1); } };
  const look = (bone, target, upOff) => {
    bone.updateWorldMatrix(true, false);
    toT.copy(target); bone.parent.worldToLocal(toT); toT.sub(bone.position);
    return [Math.atan2(-toT.x, -toT.z), Math.atan2(toT.y - upOff, Math.hypot(toT.x, toT.z))];
  };
  function update(dt, s) {
    dt = clamp(dt || 0, 0, 0.1);
    const frozen = !!s.frozen, alert = clamp(s.alert ?? 0.3, 0, 1), atkIn = clamp(s.attacking || 0, 0, 1);
    if (atkIn > st.prevAtk + 0.25) st.atkT = 0;
    st.prevAtk = atkIn;
    const tdt = frozen ? 0 : dt;
    st.t += tdt; st.atkT += tdt; st.frozenT = frozen ? st.frozenT + dt : 0;
    inst.root.updateWorldMatrix(true, false);
    reset();
    const strike = st.atkT < 1.4 ? Math.exp(-st.atkT * 2.6) * (1 - Math.exp(-st.atkT * 22)) : 0;
    // giggle: shuddering bursts
    if (!frozen && st.giggleHold.step(tdt, 0.5 + alert)) st.giggle = rng.range(0.6, 1.4);
    st.giggle = Math.max(0, st.giggle - tdt * 0.9);
    const gg = Math.min(1, st.giggle) * (Math.sin(st.t * 47) * 0.6 + Math.sin(st.t * 31) * 0.4);
    // legs: A and B alternate; the middle leg drags behind
    const L = frozen ? legs.legs : legs.update(tdt, inst.root, 1 + (s.speed || 0) * 0.4);
    let roll = 0, lift = 0;
    for (let i = 0; i < 2; i++) if (L[i].t < 1) { roll += (i ? -1 : 1) * Math.sin(L[i].t * PI); lift = Math.max(lift, Math.sin(L[i].t * PI)); }
    const rl = st.roll.step(tdt, roll * 0.16 + 0.04);
    const bob = st.bob.step(tdt, lift * 0.035 - 0.01);
    b.pelvis.position.y += bob;
    rot(b.pelvis, 0.03 + vary.lean * 0.3 - strike * 0.15, 0, rl);
    const legsDef = [['AL', 0], ['BR', 1]];
    for (const [S, i] of legsDef) {
      tgt.copy(L[i].cur); tgt.y += 0.1;
      parentLocal(b['hip' + S], tgt, v);
      ik2(b['hip' + S], b['knee' + S], b['ankle' + S], v, pole.set(0, 0, -1), bend);
      inst.root.getWorldQuaternion(q); setWorldQuat(b['ankle' + S], q);
    }
    // middle leg: foot drags in world space, then snaps after the body
    {
      const want = v.set(0.04, 0, 0.26); inst.root.localToWorld(want);
      inst.root.getWorldPosition(tgt); want.y = tgt.y;
      if (!st.hasDrag || st.drag.distanceTo(want) > 0.4) { st.drag.copy(want); st.hasDrag = true; }
      if (!frozen) st.drag.lerp(want, 1 - Math.exp(-tdt * 2.5));
      tgt.copy(st.drag); tgt.y += 0.09;
      parentLocal(b.hipM, tgt, v);
      ik2(b.hipM, b.kneeM, b.ankleM, v, pole.set(0, 0, 1), new THREE.Vector3(0, 0, 1));
    }
    // spines: A upright, B slumps and shudders
    rot(b.spineA, -0.02 + gg * 0.02, 0, -rl * 0.5 + gg * 0.015);
    rot(b.chestA, -strike * 0.2, gg * 0.03, 0);
    rot(b.spineB, 0.1 + gg * 0.04, 0, 0.12 - rl * 0.3 + vary.bTilt * 0.3);
    rot(b.chestB, -strike * 0.25 + gg * 0.05, 0, 0.05);
    b.bellyA.scale.set(1 + Math.sin(st.t * 1.2) * 0.012 + gg * 0.02, 1, 1 + Math.sin(st.t * 1.2) * 0.02);
    // heads: A watches you; B lolls, looks elsewhere, sometimes snaps onto you too
    let ya = 0, pa = 0, yb = 0, pb = 0;
    if (s.lookTarget) { [ya, pa] = look(b.neckA, s.lookTarget, 0.3); [yb, pb] = look(b.neckB, s.lookTarget, 0.25); }
    if (!frozen && st.bLockHold.step(tdt, 0.5 + alert)) st.bLock = rng.next() < 0.35 + alert * 0.3 ? 1 : 0;
    const A = frozen ? { yaw: gA.y.x, pitch: gA.p.x, roll: gA.r.x } : gA.update(tdt, ya, pa, 0.7 + alert * 1.5, 0.2);
    const Bh = frozen ? { yaw: gB.y.x, pitch: gB.p.x, roll: gB.r.x } : gB.update(tdt, st.bLock ? yb : -yb * 0.6 + Math.sin(st.t * 0.4) * 0.8, st.bLock ? pb : -0.3, 0.6 + alert, 0.6);
    rot(b.neckA, A.pitch * 0.3, A.yaw * 0.35, gg * 0.05, 'YXZ');
    rot(b.headA, A.pitch * 0.6 - strike * 0.4, A.yaw * 0.65, A.roll + gg * 0.12, 'YXZ');
    rot(b.neckB, Bh.pitch * 0.3 + 0.1, Bh.yaw * 0.4, Bh.roll * 0.5, 'YXZ');
    rot(b.headB, Bh.pitch * 0.6 - strike * 0.5, Bh.yaw * 0.6, Bh.roll + vary.bTilt - gg * 0.18, 'YXZ');
    b.jawA.scale.set(1, 1 + strike * 0.3 + Math.max(0, gg) * 0.15, 1);
    // arms: A's swings, B's drags long, the middle one reaches for you
    if (!frozen && st.reachHold.step(tdt, 0.6 + alert)) st.reach = rng.next() < 0.5 + alert * 0.3 ? rng.range(0.4, 1) : 0;
    const aA = st.armA.step(tdt, (L[1].t < 1 ? Math.sin(L[1].t * PI) * 0.3 : 0) + strike * 1.5);
    const aB = st.armB.step(tdt, (L[0].t < 1 ? Math.sin(L[0].t * PI) * 0.25 : 0) + strike * 1.3);
    const aM = st.armM.step(tdt, st.reach * 0.9 + strike * 1.0 + vary.armM * 0.3);
    rot(b.shoulderAL, aA, 0, -0.12 - strike * 0.2 + gg * 0.04);
    rot(b.elbowAL, aA * 0.4 + 0.15, 0, 0);
    rot(b.shoulderBR, aB, 0, 0.1 + strike * 0.15);
    rot(b.elbowBR, 0.05 + aB * 0.3, 0, 0);
    rot(b.shoulderM, aM * 0.6, 0, 0);
    rot(b.elbowM, -0.2 - aM * 0.5, 0, 0);
    rot(b.wristM, aM * 0.4 + Math.sin(st.t * 3.1) * 0.1, 0, 0);
    const fing = (S, side, n, base, wig) => {
      for (let i = 0; i < n; i++) {
        let c = base + Math.sin(st.t * wig + i * 1.1) * 0.12 - strike * 0.4;
        c += tremor(st.t + st.frozenT, i + S.length * 7, 9) * (frozen ? 0.01 : 0.025);
        rotAxis(b[`f${S}${i}`], GLV[S].F.d(0, 0, 1), -side * c);
      }
      rotAxis(b['thumb' + S], GLV[S].F.d(0, 0, 1), -side * (base * 0.6));
    };
    fing('AL', -1, 4, 0.3, 1.1); fing('BR', 1, 4, 0.35, 0.7); fing('M', 1, 3, 0.6 - st.reach * 0.5, 4.3);
    if (!frozen && st.twitchHold.step(tdt, 0.6 + alert * 2)) { st.tw = 1; st.twB = rng.pick(['headA', 'headB', 'neckB', 'shoulderM', 'wristBR', 'chestB']); }
    st.tw = Math.max(0, st.tw - tdt * 8);
    if (st.twB && st.tw > 0) addRot(b[st.twB], st.tw * 0.15, st.tw * 0.12, -st.tw * 0.1);
    rot(b.tank, rl * 0.6, 0, -rl * 0.8);
    const tr = frozen ? 0.003 : 0.0015, tt = st.t + st.frozenT;
    addRot(b.headA, tremor(tt, 21, 8) * tr, tremor(tt, 22, 8) * tr, 0);
    addRot(b.headB, tremor(tt, 23, 7) * tr * 1.5, 0, tremor(tt, 24, 7) * tr * 1.5);
  }
  return { update };
}
