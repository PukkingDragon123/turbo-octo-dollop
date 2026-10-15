// WATCHER — an almost-normal employee standing far too straight. Its sack head is stretched tall
// and lolls onto the right shoulder; a second, smaller face pushes out under the skin of the left
// cheek (one bead eye has already torn through). Arms hang to the knees, the rubber mitten fingers
// are stretched long; the suit is tight and split where the body was pulled.
// Moves only unobserved: glides with tiny dragging steps, torso dead still, head locked on you.
import * as THREE from 'three';
import { Sculpt, MAT } from './sdf.js';
import { PartSet, ClothSet } from './parts.js';
import { BoneSpec, assembleBody } from './rig.js';
import { Frame, sackHead, headSeams, hood, face, glove, boot, tape, tapeStrip, badge, airTank, hose, zipper, tear, scar, surfPath, onSurf, hit, bead, rag, crossStitch, add3, sub3, norm3, cross3, gloveJoints, limbFolds, torsoFolds, drip, handprint, servoJoints, wires } from './details.js';
import * as G from './geo.js';
import { PAL, RNG, PI, TAU, clamp, lerp, smoothstep, wrapAngle } from './core.js';
import { Spring, Hold, Saccade, tremor, rot, addRot, preRot, ik2, Planter, setWorldQuat, parentLocal } from './anim.js';

const HEAD_F = Frame.e([0.085, 1.235, 0.005], [0.05, 0.1, -0.92], 'ZXY');
const SH = { L: [-0.205, 1.03, 0.015], R: [0.205, 1.03, 0.015] };
const EL = { L: [-0.252, 0.71, 0.03], R: [0.252, 0.71, 0.03] };
const WR = { L: [-0.268, 0.37, 0.0], R: [0.268, 0.37, 0.0] };
const HIP = { L: [-0.105, 0.64, 0.0], R: [0.105, 0.64, 0.0] };
const KN = { L: [-0.11, 0.38, -0.012], R: [0.11, 0.38, -0.012] };
const AN = { L: [-0.115, 0.1, 0.0], R: [0.115, 0.1, 0.0] };
const FINGERS = [{ len: 0.15, curl: 0.5 }, { len: 0.165, curl: 0.62 }, { len: 0.155, curl: 0.55 }, { len: 0.13, curl: 0.45 }];
const HD = { w: 0.19, h: 0.6, d: 0.17 };

function bones() {
  const B = new BoneSpec();
  B.add('pelvis', null, [0, 0.66, 0]);
  B.add('spine', 'pelvis', [0, 0.82, 0.0]);
  B.add('belly', 'spine', [0, 0.84, -0.04]);
  B.add('chest', 'spine', [0, 0.98, 0.01]);
  B.add('neck1', 'chest', [0.0, 1.08, 0.028]);
  B.add('neck2', 'neck1', [0.035, 1.17, 0.02]);
  B.add('head', 'neck2', HEAD_F.p(0, 0.03, 0));
  B.add('jaw', 'head', HEAD_F.p(0, 0.13, -0.14));
  B.add('face2', 'head', HEAD_F.p(-0.15, 0.36, -0.07));
  B.add('crown', 'head', HEAD_F.p(0, 0.5, 0.0));
  B.add('tank', 'chest', [0, 0.9, 0.3]);
  for (const S of ['L', 'R']) {
    B.add('shoulder' + S, 'chest', SH[S]);
    B.add('elbow' + S, 'shoulder' + S, EL[S]);
    B.add('wrist' + S, 'elbow' + S, WR[S]);
    const s = S === 'L' ? -1 : 1;
    const gj = gloveJoints(Frame.e(WR[S], [0, 0, 0]), s, FINGERS.map((f) => ({ ...f, segs: 3 })));
    FINGERS.forEach((f, i) => {
      B.add(`f${S}${i}a`, 'wrist' + S, gj.bases[i]);
      B.add(`f${S}${i}b`, `f${S}${i}a`, gj.mids[i]);
    });
    B.add('thumb' + S, 'wrist' + S, gj.thumb);
    B.add('hip' + S, 'pelvis', HIP[S]);
    B.add('knee' + S, 'hip' + S, KN[S]);
    B.add('ankle' + S, 'knee' + S, AN[S]);
  }
  return B;
}

export function template() {
  const B = bones();
  const names = B.names;
  const body = new Sculpt(names), head = new Sculpt(names), hands = new Sculpt(names), feet = new Sculpt(names);
  body.maxFoldFreq = 110; feet.maxFoldFreq = 120;
  // ------------------------------------------------------------------ BODY (suit pulled tight)
  body.push({ mat: MAT.SUIT, col: PAL.suit, k: 0.05, dirt: 0.3 });
  body.ell([0, 0.69, 0.0], [0.205, 0.15, 0.185], null, { bone: 'pelvis' });
  body.ell([0, 0.85, -0.005], [0.228, 0.22, 0.2], null, { bone: 'belly', k: 0.07 });
  body.ell([0, 0.99, 0.012], [0.22, 0.15, 0.185], null, { bone: 'chest', k: 0.07 });
  body.sphere([-0.185, 1.025, 0.015], 0.082, { bone: 'chest', k: 0.07 });
  body.sphere([0.185, 1.025, 0.015], 0.082, { bone: 'chest', k: 0.07 });
  // collar: the hood's base wraps the neck
  body.cone([0, 1.04, 0.03], [0.02, 1.12, 0.035], 0.12, 0.085, { bone: 'chest', bone2: 'neck1', k: 0.05 });
  for (const S of ['L', 'R']) {
    const s = S === 'L' ? -1 : 1;
    body.chain([HIP[S], KN[S], [AN[S][0], 0.17, AN[S][2]]], [0.084, 0.07, 0.068], { bones: ['hip' + S, 'knee' + S], k: 0.04 });
    body.sphere([AN[S][0], 0.2, AN[S][2] + 0.005], 0.074, { bone: 'knee' + S, k: 0.05 });
    body.fold(KN[S], 0.09, [0, 1, 0.3], 150, 0.004, { warp: 0.7 });
    body.fold([AN[S][0], 0.22, 0], 0.09, [0, 1, 0], 120, 0.0045, { warp: 0.9 });
    body.fold([s * 0.06, 0.58, -0.12], 0.12, [s * 0.8, 1, 0], 110, 0.0035, { warp: 0.6 });
    // sleeves ride up to mid forearm: the arm grew out of them
    const sleeveEnd = [lerp(EL[S][0], WR[S][0], 0.36), lerp(EL[S][1], WR[S][1], 0.36), lerp(EL[S][2], WR[S][2], 0.36)];
    body.chain([SH[S], EL[S], sleeveEnd], [0.07, 0.058, 0.055], { bones: ['shoulder' + S, 'elbow' + S], k: 0.045, noise: [0.003, 14] });
    body.torus(sleeveEnd, 0.05, 0.009, [0.05 * s, 0, 0.1], { bone: 'elbow' + S, k: 0.01, dirt: 0.6, noise: [0.005, 30] });
    body.fold(EL[S], 0.1, [0, 1, 0], 140, 0.005, { warp: 0.8 });
    body.fold([SH[S][0] * 0.8, 0.94, -0.12], 0.13, [s * 0.5, 1, 0], 150, 0.003, { warp: 0.5 });
    // exposed, over-stretched plastic forearm, split into too many servo segments
    body.cone(sleeveEnd, [WR[S][0], WR[S][1] + 0.03, WR[S][2]], 0.034, 0.029, { bone: 'elbow' + S, mat: MAT.SKIN, col: PAL.burlapPale, k: 0.008, thin: 0.68, dirt: 0.4, ms: 4, noise: [0.001, 25] });
    servoJoints(body, sleeveEnd, [WR[S][0], WR[S][1] + 0.05, WR[S][2]], 0.032, 3, { bone: 'elbow' + S, jitter: 0.2 });
  }
  for (const S of ['L', 'R']) {
    limbFolds(body, HIP[S], KN[S], 0.085, { seed: S === 'L' ? 3 : 4 });
    limbFolds(body, KN[S], [AN[S][0], 0.17, AN[S][2]], 0.072, { seed: S === 'L' ? 5 : 6, amp: 1.2 });
    limbFolds(body, SH[S], EL[S], 0.07, { seed: S === 'L' ? 7 : 8 });
  }
  torsoFolds(body, [0, 0.86, 0], [0.23, 0.22, 0.2], 9, { seed: 11, axis: [0, 1, 0], amp: 0.8 });
  body.fold([0, 0.97, -0.17], 0.16, [0, 1, 0.2], 160, 0.0028, { warp: 0.4 });
  body.fold([0, 0.74, -0.16], 0.17, [0.2, 1, 0], 130, 0.004, { warp: 0.8 });
  body.fold([0, 0.86, 0.18], 0.2, [0, 1, 0], 100, 0.0035, { warp: 0.9 });
  body.pop();
  // hood sized for a normal head: the stretched head has burst out of its crown and left cheek
  const HH = { w: 0.194, h: 0.52, d: 0.174, F: HEAD_F };
  hood(body, HH, { bone: 'head', drapeBone: 'neck1', thick: 0.02, openY: 0.47, openW: 0.86, openH: 0.4, gathers: 15 });
  body.sphere(HEAD_F.p(0.0, 0.56, 0.07), 0.115, { sub: true, k: 0.015, mat: null, bone: 'head', noise: [0.025, 16] });
  body.ell(HEAD_F.p(-0.19, 0.34, -0.06), [0.07, 0.085, 0.09], HEAD_F.q, { sub: true, k: 0.012, mat: null, bone: 'head', noise: [0.022, 18] });
  // ...and out of the back, where its second face is
  body.ell(HEAD_F.p(0.0, 0.32, 0.2), [0.12, 0.11, 0.1], HEAD_F.q, { sub: true, k: 0.012, mat: null, bone: 'head', noise: [0.02, 18] });
  // ------------------------------------------------------------------ HEAD (stretched sack on a long neck)
  const H = sackHead(head, HEAD_F, { ...HD, bone: 'head', thin: 0.22, neckLen: 0.08, neckBone: 'neck2', col: PAL.burlap, dirt: 0.3 });
  head.ell(HEAD_F.p(0, 0.5, 0.0), [HD.w * 0.8, 0.12, HD.d * 0.85], HEAD_F.q, { bone: 'crown', mat: MAT.SKIN, col: PAL.burlap, k: 0.07, thin: 0.5 });
  head.chain([[0.0, 1.05, 0.03], [0.035, 1.16, 0.022], [0.075, 1.23, 0.012], HEAD_F.p(0, 0.06, 0.02)], [0.05, 0.046, 0.046, 0.055], { bones: ['neck1', 'neck2', 'neck2'], mat: MAT.SKIN, col: PAL.burlapPale, k: 0.035, thin: 0.55, dirt: 0.4 });
  // sagging lower face pulled down into the jaw
  head.ell(HEAD_F.p(0.0, 0.11, -0.1), [0.08, 0.1, 0.075], HEAD_F.q, { bone: 'jaw', mat: MAT.SKIN, col: PAL.burlap, k: 0.05, thin: 0.45 });
  head.prepare();
  const slit = surfPath(head, HEAD_F.p(0.004, 0.205, -0.22), HEAD_F.p(-0.006, 0.05, -0.19), 9);
  head.cone(HEAD_F.p(0.004, 0.205, -0.17), HEAD_F.p(-0.006, 0.045, -0.15), 0.011, 0.02, { sub: true, k: 0.009, mat: MAT.INNER, col: PAL.inner, wet: 0.9, bone: 'jaw', noise: [0.003, 50] });
  // second face swelling out of the left temple (through the torn hood)
  const f2c = hit(head, HEAD_F.p(-0.4, 0.36, -0.14), HEAD_F.d(1, 0, 0.35), 0.5) || { p: HEAD_F.p(-0.19, 0.36, -0.06), n: HEAD_F.d(-1, 0, -0.3) };
  const N2 = f2c.n;
  const F2s = new Frame(f2c.p, new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), new THREE.Vector3(...N2), new THREE.Vector3(...HEAD_F.d(0, 1, 0)))));
  // frame: local -Z points out of the cheek, +Y along the head's up
  head.ell(F2s.p(0, 0.0, 0.012), [0.078, 0.095, 0.058], F2s.q, { bone: 'face2', mat: MAT.SKIN, col: PAL.burlap, k: 0.045, thin: 0.6, dirt: 0.25 });
  head.prepare();
  const fr = (x, y) => hit(head, F2s.p(x, y, -0.15), F2s.d(0, 0, 1), 0.3) || { p: F2s.p(x, y, -0.03), n: F2s.d(0, 0, -1) };
  const e2a = fr(0.03, 0.03), e2b = fr(-0.032, 0.024), n2 = fr(0.0, -0.006), m2 = fr(0.002, -0.05);
  head.bulge(e2b.p, 0.02, 0.008, null, { bone: 'face2' });
  head.sphere(add3(n2.p, n2.n, -0.002), 0.021, { bone: 'face2', mat: MAT.FLUFF, col: 0xa8302a, k: 0.012, thin: 0.9, ms: 2 });
  head.paint({ sphere: [n2.p, 0.03] }, { thin: 0.95, soft: 0.01, w: 1 });
  head.ell(m2.p, [0.022, 0.011, 0.025], F2s.q, { sub: true, k: 0.007, mat: MAT.INNER, col: PAL.inner, wet: 0.8, bone: 'face2' });
  head.groove([F2s.p(-0.05, 0.05, -0.04), F2s.p(-0.02, 0.07, -0.045), F2s.p(0.02, 0.072, -0.045)], 0.006, 0.004, { rim: 0.002 });
  head.paint({ ell: [F2s.p(0, 0, -0.01), [0.085, 0.1, 0.09], F2s.q] }, { thin: 0.6, soft: 0.03, w: 0.8 });
  // ------------------------------------------------------------------ HANDS (gloves with stretched fingers)
  for (const S of ['L', 'R']) {
    const s = S === 'L' ? -1 : 1;
    glove(hands, Frame.e(WR[S], [0, 0, 0]), s, {
      bone: 'wrist' + S, cuffBone: 'elbow' + S,
      fingers: FINGERS.map((f, i) => ({ ...f, segs: 3, r: 0.0118, bones: [`f${S}${i}a`, `f${S}${i}b`, `f${S}${i}b`] })),
      thumb: { len: 0.05, bones: ['thumb' + S] },
    });
  }
  // ------------------------------------------------------------------ FEET
  for (const S of ['L', 'R']) boot(feet, Frame.e(AN[S], [0, S === 'L' ? 0.06 : -0.04, 0]), { bone: 'ankle' + S, shinBone: 'knee' + S });

  body.prepare(); head.prepare(); hands.prepare(); feet.prepare();
  const parts = new PartSet(names, body), cloth = new ClothSet(names, body);
  // ------------------------------------------------------------------ face
  face(head, parts, H, {
    bone: 'head',
    eyes: [{ x: -0.08, y: 0.335, r: 0.02, browY: 0.08, browTilt: 0.03 }, { x: 0.072, y: 0.405, r: 0.024, browY: 0.07, browTilt: -0.025 }],
    noses: [{ x: 0.006, y: 0.26, r: 0.046 }],
  });
  crossStitch(parts, slit, { ws: head, bone: 'jaw', size: 0.02, step: 1, r: 0.0026 });
  // drool from the bottom of the slit, a dark tear-track from the low eye, rust from the neck scar
  drip(head, slit[slit.length - 1].p, { n: 3, len: 0.12, w: 0.01, col: 0x24140c, wet: 0.85, seed: 3 });
  drip(head, HEAD_F.p(-0.08, 0.31, -0.17), { n: 2, len: 0.1, w: 0.006, col: 0x2a1a10, wet: 0.5, seed: 4 });
  drip(head, [0.07, 1.16, -0.03], { n: 3, len: 0.06, w: 0.008, col: 0x4a2414, wet: 0.4, seed: 5 });
  headSeams(head, parts, H, { bone: 'head', sides: [1] });
  // a face on the wrong side: the back of the skull stares too (two lenses and a sensor)
  face(head, parts, { ...H, F: HEAD_F.child([0, 0, 0], [0, PI, 0]) }, {
    bone: 'head', brows: false, grime: false,
    eyes: [{ x: -0.06, y: 0.33, r: 0.016, socket: 0.5 }, { x: 0.065, y: 0.35, r: 0.014, socket: 0.5 }],
    noses: [{ x: 0.0, y: 0.27, r: 0.03 }],
  });
  // second face: one bead eye has torn through the burlap, the other is a lump under it
  head.sphere(e2a.p, 0.015, { sub: true, k: 0.004, mat: MAT.INNER, col: PAL.inner, bone: 'face2', noise: [0.003, 60] });
  bead(head, parts, add3(e2a.p, e2a.n, -0.006), e2a.n, 0.014, { bone: 'face2', ws: head, socket: 0 });
  parts.add(G.sphere(0.0055, 8, 6).translate(...add3(e2b.p, e2b.n, 0.004)), { color: 0x0e0b09, pbr: [0.2, 0, 0.9, 0], bone: 'face2' });
  // crown: stretched so thin the weave has opened; a seam split and roughly re-stitched
  {
    const a = HEAD_F.p(-0.07, 0.56, -0.08), b = HEAD_F.p(0.08, 0.53, 0.06);
    scar(head, parts, surfPath(head, a, b, 9), { bone: 'crown', size: 0.016, width: 0.006 });
    head.paint({ ell: [HEAD_F.p(0, 0.55, 0), [0.15, 0.08, 0.14], HEAD_F.q] }, { thin: 0.75, soft: 0.04, w: 0.9 });
  }
  // neck: stitched ring where the head was sewn back on + stretched seam up the side
  {
    const ring = [];
    for (let i = 0; i <= 16; i++) { const a = (i / 16) * TAU; ring.push(onSurf(head, [0.045 + Math.cos(a) * 0.06, 1.175 + Math.sin(a) * 0.015 + Math.cos(a) * 0.03, 0.02 + Math.sin(a) * 0.06])); }
    scar(head, parts, ring, { bone: 'neck2', size: 0.013, width: 0.005 });
    wires(parts, ring[3].p, ring[3].n, { n: 4, len: 0.12, seed: 5, bone: 'neck2', ws: head });
  }
  // tears where the suit split
  const T = (p, o) => { const q = onSurf(body, p); return tear(body, parts, cloth, q.p, q.n, o.size, o); };
  T([0.165, 1.085, 0.0], { size: 0.065, seed: 3, angle: 0.4, flapLen: 0.9, stuff: 3 });
  for (const p of [[0.17, 1.05, -0.03], [-0.235, 0.76, -0.05], [0.08, 0.89, 0.2]]) drip(body, onSurf(body, p).p, { n: 3, len: 0.18, w: 0.012, col: 0x4b2814, wet: 0.35, seed: Math.round(p[1] * 100) });
  T([-0.225, 0.8, -0.05], { size: 0.075, seed: 7, angle: 1.3, aspect: 0.5, stuff: 3 });
  T([-0.24, 0.66, 0.0], { size: 0.04, seed: 9, angle: 0.2, stuff: 1, flap: false });
  T([0.12, 0.4, -0.08], { size: 0.05, seed: 12, angle: 0.1, stuff: 2 });
  T([0.08, 0.93, 0.19], { size: 0.06, seed: 13, angle: 1.0, stuff: 2 });
  T([-0.12, 1.02, -0.17], { size: 0.045, seed: 15, angle: 2.2, stuff: 2, flap: false });
  // forearm scars + tape
  for (const S of ['L', 'R']) {
    const s = S === 'L' ? -1 : 1;
    const a = [WR[S][0] + s * 0.02, 0.56, WR[S][2] - 0.025], b = [WR[S][0] + s * 0.02, 0.44, WR[S][2] - 0.03];
    scar(body, parts, surfPath(body, a, b, 6), { bone: 'elbow' + S, size: 0.011, width: 0.004, depth: 0.003 });
    tape(parts, hands, [WR[S][0], WR[S][1] + 0.045, WR[S][2]], [0, 1, 0], { wraps: 2, width: 0.03, seed: 2 + s, reach: 0.09 });
    tape(parts, feet, [AN[S][0], 0.2, AN[S][2]], [0, 1, 0], { wraps: 2, width: 0.036, seed: 5 + s, reach: 0.13 });
  }
  for (const [p, up, sd] of [[[0.12, 0.8, -0.22], [0.3, 1, 0], 1], [[-0.17, 0.62, -0.17], [-0.2, 1, 0], 2], [[0.0, 0.95, 0.21], [0.4, 1, 0], 3]]) { const q = onSurf(body, p); handprint(body, q.p, q.n, up, { seed: sd, size: 1.1 }); }
  zipper(parts, body, surfPath(body, [0, 0.62, -0.25], [0, 1.06, -0.22], 16, [0, 0, -0.05]), { bone: null });
  tapeStrip(parts, body, surfPath(body, [-0.235, 1.07, 0.0], [-0.29, 0.8, -0.02], 6), { width: 0.03, color: 0xb59a2a });
  { const q = onSurf(body, [-0.11, 0.96, -0.22]); badge(parts, q.p, q.n, [0.08, 1, 0], 0, { bone: 'chest', spin: 0.12 }); }
  // tank + harness (left strap snapped) + torn breathing hose
  const tk = airTank(parts, Frame.e([0.0, 0.88, 0.282], [0.06, 0, 0.05]), { bone: 'tank', len: 0.42, r: 0.078, dents: 4, seed: 6 });
  for (const S of ['R', 'L']) {
    const s = S === 'L' ? -1 : 1;
    const front = surfPath(body, [s * 0.12, 0.8, -0.22], [s * 0.14, 1.1, -0.02], 8, [0, 0.03, 0]);
    const back = surfPath(body, [s * 0.14, 1.1, -0.0], [s * 0.1, 0.78, 0.21], 8, [0, 0.04, 0]);
    if (S === 'R') tapeStrip(parts, body, [...front, ...back.slice(1)], { width: 0.036, color: 0x1e1d1c, lift: 0.004 });
    else {
      tapeStrip(parts, body, front.slice(0, 6), { width: 0.036, color: 0x1e1d1c, lift: 0.004 });
      const end = front[5];
      rag(cloth, body, end.p, end.n, 0.034, 0.15, { color: 0x1e1d1c, mat: MAT.RUBBER, out: 0.4, seed: 4, bone: 'chest' });
    }
  }
  hose(parts, [tk.top, add3(tk.top, [0.06, 0.02, 0.0]), [0.2, 0.92, 0.2], [0.27, 0.78, 0.1], [0.29, 0.64, 0.06]], { bone: 'tank', frayEnd: true, open: true });
  // torn hood rags around the crown hole and the cheek tear
  for (let i = 0; i < 5; i++) {
    const a = -1.0 + i * 0.5;
    const q = onSurf(body, HEAD_F.p(Math.sin(a) * 0.15, 0.36, Math.cos(a) * 0.1 + 0.03));
    rag(cloth, body, q.p, q.n, 0.035, 0.04 + (i % 2) * 0.035, { seed: 20 + i, out: 0.7, bone: 'head', taper: 0.85, dirt: 0.6 });
  }
  { const q = onSurf(body, HEAD_F.p(-0.2, 0.25, -0.05)); rag(cloth, body, q.p, q.n, 0.04, 0.07, { seed: 31, out: 0.5, bone: 'head', taper: 0.8 }); }

  const { geo, stats } = assembleBody([
    { S: body, h: 0.0145, tris: 11000 }, { S: head, h: 0.0085, tris: 9500 }, { S: hands, h: 0.0062, tris: 5000 }, { S: feet, h: 0.0115, tris: 2400 },
  ], { floor: 0.55, stains: 0.55, fade: 0.55, seed: 3 });
  return {
    spec: B, body: geo, parts: parts.build(), cloth: cloth.build(),
    bounds: new THREE.Sphere(new THREE.Vector3(0, 0.85, 0), 1.25),
    height: 1.58, radius: 0.32, stats, meta: { face2N: N2 },
  };
}

// ============================================================================
// Animation
export function animator(inst, tpl, seed) {
  const b = inst.byName, rest = inst.rest;
  const rng = new RNG(seed * 7919 + 17);
  const bones = inst.bones;
  const legs = new Planter(rng, [
    { rest: new THREE.Vector3(-0.122, 0, 0.0), group: 0, lift: 0.025, dur: 0.15 },
    { rest: new THREE.Vector3(0.122, 0, 0.0), group: 1, lift: 0.025, dur: 0.15 },
  ], { lead: 0.1, stride: 0.16, overshoot: 0.25, jitter: 0.5 });
  const gaze = new Saccade(rng, { lo: 0.35, hi: 2.4, k: 1100, d: 30, err: 0.18, over: 0.3, maxYaw: 2.7, maxPitch: 0.9 });
  const st = {
    t: rng.next() * 100, atk: 0, atkT: 9, prevAtk: 0, frozenT: 0, wasFrozen: false,
    roll: new Spring(260, 9), rollT: 0, rollHold: new Hold(rng, 2, 7),
    arm: [new Spring(60, 5), new Spring(55, 4.5)], armRaise: [0, 0], armHold: new Hold(rng, 3, 9),
    fing: [0, 0, 0, 0, 0, 0, 0, 0], ripple: -1, rippleSide: 0, rippleHold: new Hold(rng, 1.5, 5),
    breath: 0, gasp: new Spring(120, 6), gaspHold: new Hold(rng, 2, 6), face2: new Spring(40, 3),
    twitch: 0, twitchBone: null, twitchHold: new Hold(rng, 1, 4), twAx: 1,
    sway: new Spring(30, 4), lean: new Spring(80, 9),
  };
  const v = new THREE.Vector3(), q = new THREE.Quaternion(), tgt = new THREE.Vector3(), pole = new THREE.Vector3(0, 0, -1), bend = new THREE.Vector3(0, 0, -1);
  const fwdQ = new THREE.Quaternion();
  const toHead = new THREE.Vector3();
  const f2n = new THREE.Vector3(...tpl.meta.face2N);
  // per-instance anatomy: asymmetric arm stretch, head size, resting tilt
  const vary = {
    wristL: rng.range(-0.02, 0.05), wristR: rng.range(-0.02, 0.05), headS: rng.range(0.94, 1.08), roll0: rng.range(-0.3, 0.15),
    yaw0: rng.range(-0.25, 0.25), crown: rng.range(0.95, 1.2), slouch: rng.range(-0.03, 0.05),
  };
  const reset = () => {
    for (let i = 0; i < bones.length; i++) { bones[i].position.copy(rest[i]); bones[i].quaternion.identity(); bones[i].scale.set(1, 1, 1); }
    b.wristL.position.y -= vary.wristL; b.wristR.position.y -= vary.wristR;
    b.head.scale.setScalar(vary.headS); b.crown.scale.set(1, vary.crown, 1);
  };
  function update(dt, s) {
    dt = clamp(dt || 0, 0, 0.1);
    const frozen = !!s.frozen;
    const alert = clamp(s.alert ?? 0.3, 0, 1);
    const atkIn = clamp(s.attacking || 0, 0, 1);
    if (atkIn > st.prevAtk + 0.25) st.atkT = 0;
    st.prevAtk = atkIn;
    // frozen: hold the pose, only a faint tremor (time barely advances)
    const tdt = frozen ? 0 : dt;
    st.t += tdt;
    st.atkT += tdt;
    if (frozen && !st.wasFrozen) st.frozenT = 0;
    if (!frozen && st.wasFrozen) {
      // every glance away: something has changed
      st.rollT = rng.range(-0.55, 0.35); st.armRaise = [rng.next() < 0.35 ? rng.range(0.2, 0.9) : 0, rng.next() < 0.35 ? rng.range(0.2, 0.9) : 0];
      st.ripple = 0; st.rippleSide = rng.int(0, 1);
    }
    st.wasFrozen = frozen; st.frozenT += dt;
    inst.root.updateWorldMatrix(true, false);
    reset();
    // ---------------- legs & pelvis
    const L = frozen ? legs.legs : legs.update(tdt, inst.root, 1 + (s.speed || 0) * 0.5);
    let sway = 0;
    for (const l of L) if (l.t < 1) sway += (l === L[0] ? -1 : 1) * Math.sin(l.t * PI);
    const sw = st.sway.step(tdt, sway * 0.02);
    b.pelvis.position.x += sw;
    b.pelvis.position.y += -Math.abs(sw) * 0.4;
    // strike: lurch forward
    const strike = st.atkT < 1.2 ? Math.exp(-st.atkT * 3) * (1 - Math.exp(-st.atkT * 40)) : 0;
    const lean = st.lean.step(tdt, strike * 0.32 + (s.moving ? 0.03 : 0));
    rot(b.pelvis, -lean * 0.5, 0, sw * 0.6);
    b.pelvis.position.z -= lean * 0.18;
    // IK legs: hips to planted feet (ankle sits 0.1 above the floor)
    for (let i = 0; i < 2; i++) {
      const S = i ? 'R' : 'L';
      const l = L[i];
      tgt.copy(l.cur); tgt.y += 0.1;
      parentLocal(b['hip' + S], tgt, v);
      // the right knee bends the wrong way
      ik2(b['hip' + S], b['knee' + S], b['ankle' + S], v, pole.set(0, 0, S === 'R' ? 1 : -1), bend);
      // keep the boot level with the floor, toe follows the root's facing
      inst.root.getWorldQuaternion(fwdQ);
      setWorldQuat(b['ankle' + S], fwdQ.multiply(q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, l.t < 1 ? Math.sin(l.t * PI) * -0.2 : 0)));
      if (l.t < 1) addRot(b['ankle' + S], -Math.sin(l.t * PI) * 0.35, 0, 0);
    }
    // ---------------- spine: dead straight; breathing in irregular gasps that swell the belly
    if (st.gaspHold.step(tdt, 1 + alert)) st.gasp.v += rng.range(2, 5);
    const gasp = st.gasp.step(tdt, 0);
    const br = Math.sin(st.t * 1.1) * 0.5 + 0.5;
    b.belly.scale.set(1 + br * 0.015 + gasp * 0.05, 1, 1 + br * 0.02 + gasp * 0.07);
    rot(b.spine, -lean * 0.4 - vary.slouch, 0, -sw * 0.5);
    rot(b.chest, -lean * 0.3 + gasp * 0.05, 0, 0);
    // ---------------- head: saccades onto the target, too far; rolls between shoulders
    let wantYaw = 0, wantPitch = 0;
    if (s.lookTarget) {
      b.neck1.updateWorldMatrix(true, false);
      toHead.copy(s.lookTarget); b.chest.worldToLocal(toHead); toHead.sub(b.neck1.position);
      wantYaw = Math.atan2(-toHead.x, -toHead.z); wantPitch = Math.atan2(toHead.y - 0.35, Math.hypot(toHead.x, toHead.z));
    }
    const g = frozen ? { yaw: gaze.y.x, pitch: gaze.p.x, roll: gaze.r.x } : gaze.update(tdt, wantYaw, wantPitch, 0.6 + alert * 1.4, 0.15);
    if (!frozen && st.rollHold.step(tdt, 0.7 + alert)) st.rollT = rng.next() < 0.3 ? rng.range(0.5, 1.1) : rng.range(-0.35, 0.25);
    const roll = st.roll.step(tdt, st.rollT + vary.roll0 + strike * 0.6);
    const yaw = g.yaw + vary.yaw0 * (1 - alert), pitch = g.pitch;
    rot(b.neck1, pitch * 0.25, yaw * 0.25, roll * 0.3, 'YXZ');
    rot(b.neck2, pitch * 0.3, yaw * 0.3, roll * 0.35, 'YXZ');
    rot(b.head, pitch * 0.45 - strike * 0.5, yaw * 0.45, roll * 0.35 + g.roll, 'YXZ');
    // ---------------- arms: hang dead straight; raise toward you between glances; strike
    if (!frozen && st.armHold.step(tdt, 0.5 + alert)) st.armRaise[rng.int(0, 1)] = rng.next() < 0.5 ? 0 : rng.range(0.15, 0.7);
    for (let i = 0; i < 2; i++) {
      const S = i ? 'R' : 'L', sg = i ? 1 : -1;
      const swing = st.arm[i].step(tdt, (s.moving ? Math.sin(st.t * 9 + i * PI) * 0.06 : 0) - lean * 0.6 + st.armRaise[i] * 0.9);
      const up = swing + strike * 1.75;
      rot(b['shoulder' + S], up, 0, sg * (0.03 + strike * 0.1));
      // the left elbow is hyper-extended backwards
      rot(b['elbow' + S], -strike * 0.1 - st.armRaise[i] * 0.15 - (i ? 0 : 0.55), 0, 0);
      rot(b['wrist' + S], strike * 0.5, 0, 0);
    }
    // ---------------- fingers: ripple one after another; splay on the strike
    if (!frozen && st.rippleHold.step(tdt, 0.6 + alert)) { st.ripple = 0; st.rippleSide = rng.int(0, 1); }
    if (st.ripple >= 0) { st.ripple += tdt * 2.2; if (st.ripple > 2.2) st.ripple = -1; }
    for (let i = 0; i < 2; i++) {
      const S = i ? 'R' : 'L', sg = i ? 1 : -1;
      for (let f = 0; f < 4; f++) {
        let c = 0.12 + Math.sin(st.t * 0.7 + f * 1.3 + i) * 0.05;
        if (st.ripple >= 0 && st.rippleSide === i) { const ph = st.ripple * 3 - f * 0.45; c += Math.max(0, Math.sin(clamp(ph, 0, PI))) * 0.9; }
        c -= strike * 0.6;
        c += tremor(st.t + (frozen ? st.frozenT : 0), f + i * 7, 9) * (frozen ? 0.012 : 0.03);
        rot(b[`f${S}${f}a`], 0, 0, -sg * c * 0.7);
        rot(b[`f${S}${f}b`], 0, 0, -sg * c);
        if (strike > 0.05) addRot(b[`f${S}${f}a`], (f - 1.5) * 0.25 * strike, 0, 0);
      }
      rot(b['thumb' + S], 0, 0, -sg * (0.2 - strike * 0.5));
    }
    // ---------------- second face: pushes out in slow surges
    const surge = st.face2.step(tdt, Math.max(0, Math.sin(st.t * 0.9 + Math.sin(st.t * 0.37) * 2)) * (0.6 + alert * 0.5) + gasp * 0.6);
    b.face2.scale.setScalar(1 + surge * 0.12);
    b.face2.position.addScaledVector(f2n, surge * 0.012);
    // ---------------- jaw: the stitched slit strains open on the strike
    const open = clamp(strike * 1.4 + gasp * 0.2, 0, 1);
    b.jaw.scale.set(1 + open * 0.15, 1 + open * 0.35, 1);
    b.jaw.position.y -= open * 0.02;
    // ---------------- twitches + frozen tremor
    if (!frozen && st.twitchHold.step(tdt, 0.5 + alert * 2)) { st.twitch = 1; st.twitchBone = rng.pick(['head', 'neck2', 'shoulderL', 'shoulderR', 'wristL', 'wristR', 'chest']); st.twAx = rng.range(-1, 1); }
    st.twitch = Math.max(0, st.twitch - tdt * 9);
    if (st.twitchBone && st.twitch > 0) addRot(b[st.twitchBone], st.twitch * st.twAx * 0.18, st.twitch * 0.1, st.twitch * st.twAx * 0.12);
    const tr = frozen ? 0.0035 : 0.002;
    const tt = st.t + st.frozenT;
    addRot(b.head, tremor(tt, 1, 8) * tr, tremor(tt, 2, 8) * tr, tremor(tt, 3, 7) * tr);
    addRot(b.wristL, tremor(tt, 4, 9) * tr * 2, 0, tremor(tt, 5, 9) * tr * 2);
    addRot(b.wristR, tremor(tt, 6, 9) * tr * 2, 0, tremor(tt, 7, 9) * tr * 2);
    // tank sways a little
    rot(b.tank, sw * 2 + strike * 0.2, 0, Math.sin(st.t * 1.3) * 0.01);
  }
  return { update };
}
