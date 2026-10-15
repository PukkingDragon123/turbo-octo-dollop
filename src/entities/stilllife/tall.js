// TALL — an employee pulled to 2.4 m. Legs and arms are twice too long and bend the wrong way,
// the suit has split into hanging strips at every stretch point (elbows, knees, waist, a long
// rip down the back over a knobbly ridge of stuffing), the burlap of the shins and forearms is
// pulled so thin the weave gapes. A vulture neck carries the bare sack head forward under the
// ceiling, face tipped down at you. Moves slowly on long backward-kneed strides, neck searching.
import * as THREE from 'three';
import { Sculpt, MAT } from './sdf.js';
import { PartSet, ClothSet } from './parts.js';
import { BoneSpec, assembleBody } from './rig.js';
import { Frame, sackHead, headSeams, face, glove, boot, tape, tapeStrip, badge, airTank, hose, tear, scar, surfPath, onSurf, hit, rag, crossStitch, runningStitch, ringAround, add3, sub3, norm3, gloveJoints, limbFolds, torsoFolds, drip, handprint, servoJoints } from './details.js';
import * as G from './geo.js';
import { PAL, RNG, PI, TAU, clamp, lerp } from './core.js';
import { Spring, SpringV, Hold, Saccade, tremor, rot, addRot, rotAxis, ik2, Planter, setWorldQuat, parentLocal } from './anim.js';

const HEAD_F = Frame.e([0.0, 2.06, -0.36], [-0.62, 0, 0.22], 'ZXY');
const HD = { w: 0.19, h: 0.47, d: 0.17 };
const SH = { L: [-0.205, 1.7, -0.06], R: [0.205, 1.7, -0.06] };
const EL = { L: [-0.3, 1.19, 0.1], R: [0.3, 1.19, 0.1] };
const WR = { L: [-0.315, 0.64, -0.04], R: [0.315, 0.64, -0.04] };
const HIP = { L: [-0.1, 1.18, 0.02], R: [0.1, 1.18, 0.02] };
const KN = { L: [-0.12, 0.66, 0.17], R: [0.12, 0.66, 0.17] };
const AN = { L: [-0.13, 0.1, 0.0], R: [0.13, 0.1, 0.0] };
const NECK = [[0, 1.76, -0.07], [0, 1.9, -0.1], [0, 2.0, -0.18], [0, 2.05, -0.29]];
const TF = [0.07, 0.078, 0.072, 0.06].map((len) => ({ len, curl: 0.55, segs: 3 }));
const GF = (S) => Frame.e(WR[S], [0.1, 0, (S === 'L' ? -1 : 1) * 0.05]);

function bones() {
  const B = new BoneSpec();
  B.add('pelvis', null, [0, 1.2, 0.02]);
  B.add('spine1', 'pelvis', [0, 1.36, 0.01]);
  B.add('belly', 'spine1', [0, 1.4, -0.05]);
  B.add('spine2', 'spine1', [0, 1.53, -0.02]);
  B.add('chest', 'spine2', [0, 1.66, -0.05]);
  NECK.forEach((p, i) => B.add('neck' + (i + 1), i ? 'neck' + i : 'chest', p));
  B.add('head', 'neck4', HEAD_F.p(0, 0.02, 0));
  B.add('jaw', 'head', HEAD_F.p(0, 0.12, -0.13));
  B.add('eyeDangle', 'head', HEAD_F.p(0.1, 0.285, -0.16));
  B.add('tank', 'pelvis', [0.17, 1.12, 0.2]);
  for (const S of ['L', 'R']) {
    B.add('shoulder' + S, 'chest', SH[S]);
    B.add('elbow' + S, 'shoulder' + S, EL[S]);
    B.add('wrist' + S, 'elbow' + S, WR[S]);
    const s = S === 'L' ? -1 : 1;
    const gj = gloveJoints(GF(S), s, TF);
    for (let i = 0; i < 4; i++) B.add(`f${S}${i}`, 'wrist' + S, gj.bases[i]);
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
  // ------------------------------------------------------------------ torso: stretched long, hunched
  body.push({ mat: MAT.SUIT, col: PAL.suit, k: 0.05, dirt: 0.4 });
  body.ell([0, 1.21, 0.02], [0.165, 0.12, 0.14], null, { bone: 'pelvis' });
  body.ell([0, 1.4, -0.015], [0.158, 0.2, 0.135], null, { bone: 'belly', k: 0.07 });
  body.ell([0, 1.6, -0.04], [0.19, 0.15, 0.15], null, { bone: 'spine2', k: 0.07 });
  body.ell([0, 1.66, 0.04], [0.15, 0.14, 0.12], null, { bone: 'chest', k: 0.08 }); // hump
  body.sphere([-0.18, 1.69, -0.05], 0.072, { bone: 'chest', k: 0.06 });
  body.sphere([0.18, 1.69, -0.05], 0.072, { bone: 'chest', k: 0.06 });
  body.cone([0, 1.68, -0.05], [0, 1.79, -0.07], 0.1, 0.07, { bone: 'chest', bone2: 'neck1', k: 0.05 });
  // stretch creases: long vertical pulls on the belly, wrinkles bunched at the waist
  body.fold([0, 1.42, -0.13], 0.2, [1, 0, 0], 90, 0.0035, { warp: 0.6 });
  body.fold([0, 1.3, -0.1], 0.14, [0, 1, 0.2], 130, 0.004, { warp: 0.8 });
  for (const S of ['L', 'R']) {
    const s = S === 'L' ? -1 : 1;
    // thigh in suit (torn off at the knee), shin bare stretched burlap
    const kneeIn = [lerp(HIP[S][0], KN[S][0], 0.86), lerp(HIP[S][1], KN[S][1], 0.86), lerp(HIP[S][2], KN[S][2], 0.86)];
    body.cone(HIP[S], kneeIn, 0.078, 0.06, { bone: 'hip' + S, k: 0.05, noise: [0.003, 12] });
    body.torus(kneeIn, 0.055, 0.008, [0.4, 0, 0], { bone: 'hip' + S, k: 0.008, dirt: 0.7, noise: [0.006, 25] });
    body.cone(KN[S], [AN[S][0], 0.19, AN[S][2]], 0.042, 0.034, { bone: 'knee' + S, mat: MAT.SKIN, col: PAL.burlapPale, k: 0.02, thin: 0.75, dirt: 0.5, noise: [0.001, 25] });
    servoJoints(body, KN[S], [AN[S][0], 0.22, AN[S][2]], 0.04, 4, { bone: 'knee' + S, jitter: 0.3 });
    body.sphere(KN[S], 0.05, { bone: 'knee' + S, mat: MAT.SKIN, col: PAL.burlap, k: 0.03, thin: 0.5, dirt: 0.5 });
    body.fold([HIP[S][0] * 1.1, 1.05, -0.02], 0.12, [0, 1, -0.2], 140, 0.004, { warp: 0.7 });
    // upper arm in suit (torn at the elbow), forearm bare
    const elIn = [lerp(SH[S][0], EL[S][0], 0.84), lerp(SH[S][1], EL[S][1], 0.84), lerp(SH[S][2], EL[S][2], 0.84)];
    body.cone(SH[S], elIn, 0.064, 0.05, { bone: 'shoulder' + S, k: 0.045, noise: [0.003, 12] });
    body.torus(elIn, 0.046, 0.007, [0.25, 0, s * 0.1], { bone: 'shoulder' + S, k: 0.008, dirt: 0.7, noise: [0.006, 25] });
    body.sphere(EL[S], 0.038, { bone: 'elbow' + S, mat: MAT.SKIN, col: PAL.burlap, k: 0.03, thin: 0.55, dirt: 0.5 });
    body.cone(EL[S], [WR[S][0], WR[S][1] + 0.04, WR[S][2]], 0.034, 0.028, { bone: 'elbow' + S, mat: MAT.SKIN, col: PAL.burlapPale, k: 0.02, thin: 0.8, dirt: 0.45, noise: [0.001, 25] });
    servoJoints(body, EL[S], [WR[S][0], WR[S][1] + 0.06, WR[S][2]], 0.032, 3, { bone: 'elbow' + S, jitter: 0.25 });
    body.fold([SH[S][0] * 1.1, 1.55, -0.02], 0.12, [0, 1, 0], 150, 0.0035, { warp: 0.6 });
  }
  for (const S of ['L', 'R']) {
    limbFolds(body, HIP[S], [lerp(HIP[S][0], KN[S][0], 0.85), lerp(HIP[S][1], KN[S][1], 0.85), lerp(HIP[S][2], KN[S][2], 0.85)], 0.075, { seed: S === 'L' ? 13 : 14, amp: 1.1 });
    limbFolds(body, SH[S], [lerp(SH[S][0], EL[S][0], 0.84), lerp(SH[S][1], EL[S][1], 0.84), lerp(SH[S][2], EL[S][2], 0.84)], 0.062, { seed: S === 'L' ? 15 : 16 });
  }
  torsoFolds(body, [0, 1.42, -0.02], [0.17, 0.25, 0.14], 9, { seed: 17, axis: [1, 0.2, 0], amp: 0.8 });
  body.pop();
  // the back has split open down the spine: burlap + a knobbly ridge of stuffing
  body.paint({ ell: [[0, 1.46, 0.12], [0.07, 0.3, 0.12], null, { noise: [0.025, 14] }] }, { mat: MAT.SKIN, col: PAL.burlapDark, soft: 0.006, thin: 0.55, dirt: 0.6 });
  for (let i = 0; i < 7; i++) {
    const y = 1.22 + i * 0.07;
    const z = 0.1 + Math.sin((y - 1.2) * 4.5) * 0.04 + 0.03;
    body.sphere([Math.sin(i * 1.7) * 0.008, y, z], 0.03 - Math.abs(i - 3) * 0.002, { bone: i < 3 ? 'spine1' : i < 5 ? 'spine2' : 'chest', mat: MAT.SKIN, col: PAL.burlap, k: 0.035, thin: 0.6, dirt: 0.5 });
  }
  // ------------------------------------------------------------------ neck (body part) + head
  body.chain(NECK.concat([HEAD_F.p(0, 0.02, 0.02)]), [0.056, 0.048, 0.044, 0.044, 0.05], { bones: ['neck1', 'neck2', 'neck3', 'neck4'], mat: MAT.SKIN, col: PAL.burlapPale, k: 0.04, thin: 0.7, dirt: 0.4, ks: [0.05, 0.03, 0.03, 0.03] });
  const H = sackHead(head, HEAD_F, { ...HD, bone: 'head', thin: 0.3, neckLen: 0.06, neckR: 0.05, neckBone: 'neck4', col: PAL.burlap, dirt: 0.45 });
  head.ell(HEAD_F.p(0.0, 0.12, -0.1), [0.08, 0.09, 0.07], HEAD_F.q, { bone: 'jaw', mat: MAT.SKIN, col: PAL.burlap, k: 0.05, thin: 0.45 });
  // long stretch grooves dragging the face down
  for (const x of [-0.11, -0.05, 0.05, 0.11]) head.groove([HEAD_F.p(x, 0.43, -0.12), HEAD_F.p(x * 1.1, 0.3, -0.18), HEAD_F.p(x * 1.15, 0.16, -0.17)], 0.005, 0.003, { rim: 0.0015, wobble: 0.4 });
  head.prepare();
  // ------------------------------------------------------------------ hands / feet
  for (const S of ['L', 'R']) {
    const s = S === 'L' ? -1 : 1;
    glove(hands, GF(S), s, {
      bone: 'wrist' + S, cuffBone: 'elbow' + S,
      fingers: TF.map((f, i) => ({ ...f, r: 0.0118, bones: [`f${S}${i}`] })),
      thumb: { len: 0.045, bones: ['thumb' + S] },
    });
    boot(feet, Frame.e(AN[S], [0, s * -0.08, 0]), { bone: 'ankle' + S, shinBone: 'knee' + S });
  }
  body.prepare(); head.prepare(); hands.prepare(); feet.prepare();
  const parts = new PartSet(names, body), cloth = new ClothSet(names, body);
  // ------------------------------------------------------------------ face: small sad eyes, mouth stitched wide
  face(head, parts, H, {
    bone: 'head',
    eyes: [{ x: -0.1, y: 0.305, r: 0.018, browY: 0.06, browTilt: -0.04 }],
    noses: [{ x: 0.005, y: 0.205, r: 0.03 }],
  });
  // right eye torn out: empty socket, the bead hangs on its thread
  {
    const sock = hit(head, HEAD_F.p(0.1, 0.285, -0.3), HEAD_F.d(0, 0, 1), 0.4);
    if (sock) {
      head.sphere(sock.p, 0.017, { sub: true, k: 0.006, mat: MAT.INNER, col: PAL.inner, wet: 0.15, bone: 'head', noise: [0.003, 70] });
      const hang = add3(add3(sock.p, sock.n, 0.012), [0, -1, 0], 0.075);
      const mid = add3(add3(sock.p, sock.n, 0.022), [0, -1, 0], 0.035);
      parts.add(G.tube([add3(sock.p, sock.n, -0.004), mid, add3(hang, [0, 1, 0], 0.016)], 0.0016, 3), { color: 0x6a5a40, pbr: [0.9, 0, 0, 0.1], uv: 'thread', bone: 'eyeDangle' });
      parts.add(G.sphere(0.018, 12, 8).translate(hang[0], hang[1], hang[2]), { color: PAL.eye, pbr: [0.08, 0, 1, 0], bone: 'eyeDangle' });
      drip(head, sock.p, { n: 3, len: 0.11, w: 0.008, col: 0x2a150c, wet: 0.8, seed: 12 });
      for (let i = 0; i < 4; i++) { const a = i * 1.6; const q = add3(sock.p, [Math.cos(a) * 0.016, Math.sin(a) * 0.016, 0]); parts.add(G.tube([q, add3(add3(q, sock.n, 0.01), [0, -1, 0], 0.015 + i * 0.006)], 0.0012, 3), { color: PAL.thread, pbr: [0.9, 0, 0, 0.1], bone: 'head' }); }
    }
  }
  // grin stitched far too wide over a dark gap
  head.prepare();
  const grin = surfPath(head, HEAD_F.p(-0.105, 0.135, -0.22), HEAD_F.p(0.105, 0.14, -0.22), 12, HEAD_F.d(0, -0.025, 0));
  head.groove(grin.map((q) => q.p), 0.008, 0.01, { rim: 0.003, col: 0x150c07, colOnly: true, wet: 0.7 });
  parts.add(G.tube(grin.map((q) => add3(q.p, q.n, 0.0015)), 0.0028, 4), { color: PAL.thread, pbr: [0.95, 0, 0, 0.1], uv: 'thread', ws: head, bone: 'jaw' });
  crossStitch(parts, grin, { ws: head, bone: 'jaw', size: 0.022, step: 1, r: 0.0022 });
  drip(head, grin[8].p, { n: 2, len: 0.07, w: 0.008, col: 0x22120a, wet: 0.85, seed: 13 });

  for (const p of [[0, 1.4, 0.15], [0.03, 1.3, 0.15], [-0.03, 1.55, 0.13]]) drip(body, onSurf(body, p).p, { n: 2, len: 0.2, w: 0.01, col: 0x3c2012, wet: 0.5, seed: Math.round(p[1] * 50) });
  headSeams(head, parts, H, { bone: 'head' });
  // neck: stitched rings where it was lengthened (sections sewn in)
  const NP = NECK.concat([HEAD_F.p(0, 0.02, 0.02)]);
  for (const i of [1, 2, 3]) {
    const c = [(NP[i][0] + NP[i + 1][0]) / 2, (NP[i][1] + NP[i + 1][1]) / 2, (NP[i][2] + NP[i + 1][2]) / 2];
    const ring = ringAround(body, c, sub3(NP[i + 1], NP[i]), 14, 0.1, 0.006);
    scar(body, parts, ring, { bone: 'neck' + (i + 1), size: 0.012, width: 0.0045, depth: 0.003, step: 1 });
  }
  // stitched seams along the split back
  runningStitch(parts, surfPath(body, [-0.06, 1.25, 0.13], [-0.05, 1.7, 0.08], 10), { ws: body, size: 0.012, gap: 0.03 });
  runningStitch(parts, surfPath(body, [0.06, 1.25, 0.13], [0.05, 1.7, 0.08], 10), { ws: body, size: 0.012, gap: 0.03 });
  // suit ripped into strips at every stretch point
  const R = (p, o) => { const q = onSurf(body, p); rag(cloth, body, q.p, q.n, o.w, o.l, o); };
  let sd = 40;
  for (const S of ['L', 'R']) {
    const s = S === 'L' ? -1 : 1;
    for (let i = 0; i < 4; i++) { const a = i * 1.6 + s; R([KN[S][0] + Math.cos(a) * 0.06, KN[S][1] + 0.1, KN[S][2] + Math.sin(a) * 0.06], { w: 0.035, l: 0.1 + (i % 3) * 0.06, seed: sd++, out: 0.25, bone: 'hip' + S, taper: 0.7, twist: 1.5 }); }
    for (let i = 0; i < 3; i++) { const a = i * 2.1 + s; R([EL[S][0] + Math.cos(a) * 0.05, EL[S][1] + 0.08, EL[S][2] + Math.sin(a) * 0.05], { w: 0.03, l: 0.09 + (i % 2) * 0.07, seed: sd++, out: 0.25, bone: 'shoulder' + S, taper: 0.7 }); }
    R([s * 0.15, 1.14, -0.05], { w: 0.045, l: 0.16, seed: sd++, out: 0.15, bone: 'pelvis', taper: 0.6 });
    // shin + forearm scars
    scar(body, parts, surfPath(body, [AN[S][0] - 0.03, 0.5, AN[S][2] + 0.06], [AN[S][0] - 0.03, 0.27, AN[S][2] + 0.03], 6), { bone: 'knee' + S, size: 0.011, width: 0.004, depth: 0.0025 });
    tape(parts, hands, GF(S).p(0, 0.045, 0), GF(S).d(0, 1, 0), { wraps: 2, width: 0.03, seed: 7 + s, reach: 0.09 });
    tape(parts, feet, [AN[S][0], 0.19, AN[S][2]], [0, 1, 0], { wraps: 2, width: 0.036, seed: 9 + s, reach: 0.13 });
  }
  // collar: ripped-off hood hanging down the back as rags
  for (let i = 0; i < 5; i++) { const a = PI * 0.15 + i * 0.35; R([Math.cos(a) * 0.09, 1.78, 0.02 + Math.sin(a) * 0.07], { w: 0.05, l: 0.12 + (i % 2) * 0.1, seed: sd++, out: 0.3, bone: 'chest', taper: 0.6, dirt: 0.6 }); }
  for (const [p, up, sd] of [[[0.08, 1.45, -0.15], [0.2, 1, 0], 1], [[-0.1, 1.3, -0.12], [-0.3, 1, 0], 2]]) { const q = onSurf(body, p); handprint(body, q.p, q.n, up, { seed: sd }); }
  // tears + badge + tank hanging off one strap
  const T = (p, o) => { const q = onSurf(body, p); return tear(body, parts, cloth, q.p, q.n, o.size, o); };
  T([-0.12, 1.5, -0.12], { size: 0.06, seed: 61, angle: 1.4, stuff: 2 });
  T([0.14, 1.35, -0.08], { size: 0.05, seed: 62, angle: 0.4, stuff: 2, flap: false });
  { const q = onSurf(body, [0.1, 1.6, -0.2]); badge(parts, q.p, q.n, [-0.1, 1, 0.15], 1, { bone: 'spine2', spin: -0.2 }); }
  const tk = airTank(parts, Frame.e([0.19, 1.08, 0.2], [0.15, 0.3, -0.45]), { bone: 'tank', len: 0.4, r: 0.074, dents: 5, seed: 12 });
  tapeStrip(parts, body, surfPath(body, [0.12, 1.62, -0.15], [0.17, 1.3, 0.13], 10, [0.05, 0, 0]), { width: 0.034, color: 0x1e1d1c, lift: 0.004 });
  hose(parts, [tk.top, add3(tk.top, [0.03, 0.05, -0.02]), [0.25, 1.3, 0.05], [0.24, 1.15, -0.08], [0.22, 0.98, -0.1]], { bone: 'tank', frayEnd: true, open: true, seed: 3 });

  const { geo, stats } = assembleBody([
    { S: body, h: 0.0155, tris: 12500 }, { S: head, h: 0.0088, tris: 7500 }, { S: hands, h: 0.0066, tris: 4200 }, { S: feet, h: 0.0115, tris: 2400 },
  ], { floor: 0.5, stains: 0.6, fade: 0.6, seed: 7 });
  return {
    spec: B, body: geo, parts: parts.build(), cloth: cloth.build(),
    bounds: new THREE.Sphere(new THREE.Vector3(0, 1.2, -0.05), 1.55),
    height: 2.38, radius: 0.35, stats, meta: {},
  };
}

// ============================================================================
export function animator(inst, tpl, seed) {
  const b = inst.byName, rest = inst.rest, bones = inst.bones;
  const rng = new RNG(seed * 4241 + 3);
  const legs = new Planter(rng, [
    { rest: new THREE.Vector3(-0.13, 0, 0.0), group: 0, lift: 0.17, dur: 0.55 },
    { rest: new THREE.Vector3(0.13, 0, 0.0), group: 1, lift: 0.17, dur: 0.55 },
  ], { lead: 0.35, stride: 0.42, overshoot: 0.45, jitter: 0.25 });
  const gaze = new Saccade(rng, { lo: 0.5, hi: 3.2, k: 500, d: 20, err: 0.25, over: 0.25, maxYaw: 1.9, maxPitch: 0.9 });
  const vary = { roll0: rng.range(-0.25, 0.25), hunch: rng.range(-0.06, 0.1), armL: rng.range(-0.04, 0.06), armR: rng.range(-0.04, 0.06) };
  const st = {
    t: rng.next() * 50, prevAtk: 0, atkT: 9, frozenT: 0,
    neck: [0, 1, 2, 3].map(() => ({ y: new Spring(60, 7), x: new Spring(60, 7) })),
    sway: new Spring(20, 3), bob: new Spring(40, 6), arm: [new Spring(14, 1.6), new Spring(12, 1.4)], armZ: [new Spring(14, 1.6), new Spring(12, 1.4)],
    breath: new Spring(30, 4), gaspHold: new Hold(rng, 3, 8), twitchHold: new Hold(rng, 1.5, 5), tw: 0, twF: 0,
    search: rng.next() * 10, rollT: 0, rollHold: new Hold(rng, 2, 6),
    eyeX: new Spring(25, 1.5), eyeZ: new Spring(25, 1.5),
  };
  const qr = new THREE.Quaternion(), dq = new THREE.Quaternion(), q2 = new THREE.Quaternion(), eul = new THREE.Euler();
  const v = new THREE.Vector3(), tgt = new THREE.Vector3(), pole = new THREE.Vector3(0, 0, 1), bend = new THREE.Vector3(0, 0, 1), q = new THREE.Quaternion(), toT = new THREE.Vector3();
  const reset = () => {
    for (let i = 0; i < bones.length; i++) { bones[i].position.copy(rest[i]); bones[i].quaternion.identity(); bones[i].scale.set(1, 1, 1); }
    b.wristL.position.y -= vary.armL; b.wristR.position.y -= vary.armR;
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
    const strike = st.atkT < 1.6 ? Math.exp(-st.atkT * 2.2) * (1 - Math.exp(-st.atkT * 18)) : 0;
    // legs: long slow strides, knees bending backwards
    const L = frozen ? legs.legs : legs.update(tdt, inst.root, 0.8 + (s.speed || 0) * 0.3);
    let stepping = 0, swing = 0;
    for (let i = 0; i < 2; i++) if (L[i].t < 1) { stepping = Math.max(stepping, Math.sin(L[i].t * PI)); swing += (i ? 1 : -1) * Math.sin(L[i].t * PI); }
    const bob = st.bob.step(tdt, -0.05 + stepping * 0.06);
    const sw = st.sway.step(tdt, swing * 0.035);
    b.pelvis.position.y += bob;
    b.pelvis.position.x += sw;
    rot(b.pelvis, 0.05, 0, sw * 1.2);
    for (let i = 0; i < 2; i++) {
      const S = i ? 'R' : 'L';
      tgt.copy(L[i].cur); tgt.y += 0.1;
      parentLocal(b['hip' + S], tgt, v);
      ik2(b['hip' + S], b['knee' + S], b['ankle' + S], v, pole.set(0, 0, 1), bend);
      inst.root.getWorldQuaternion(q);
      setWorldQuat(b['ankle' + S], q);
      if (L[i].t < 1) addRot(b['ankle' + S], Math.sin(L[i].t * PI) * 0.5, 0, 0);
    }
    // spine: hunched, breathing in long heaves; a shiver runs up it now and then
    if (st.gaspHold.step(tdt, 0.6 + alert)) st.breath.v += rng.range(1.5, 3);
    const br = st.breath.step(tdt, 0) + Math.sin(st.t * 0.8) * 0.15;
    b.belly.scale.set(1 + br * 0.05, 1 - br * 0.02, 1 + br * 0.08);
    rot(b.spine1, -0.04 - vary.hunch * 0.5 - strike * 0.2, 0, -sw * 0.8);
    rot(b.spine2, -0.05 - vary.hunch - strike * 0.25, Math.sin(st.t * 0.31) * 0.04, Math.sin(st.t * 0.47) * 0.02);
    rot(b.chest, -0.03 - br * 0.03 - strike * 0.2, 0, 0);
    // neck: searches like something blind, then locks onto the target with saccades
    let wy = 0, wp = 0;
    if (s.lookTarget) {
      b.neck1.updateWorldMatrix(true, false);
      toT.copy(s.lookTarget); b.chest.worldToLocal(toT); toT.sub(b.neck1.position);
      wy = Math.atan2(-toT.x, -toT.z); wp = Math.atan2(toT.y - 0.25, Math.hypot(toT.x, toT.z));
    }
    const lock = clamp(alert * 1.4, 0, 1);
    st.search += tdt * (0.25 + (1 - lock) * 0.35);
    const sy = Math.sin(st.search * 1.3) * 0.55 * (1 - lock), sp = Math.sin(st.search * 0.9 + 1) * 0.2 * (1 - lock);
    const g = frozen ? { yaw: gaze.y.x, pitch: gaze.p.x, roll: gaze.r.x } : gaze.update(tdt, wy * lock + sy, wp * lock + sp, 0.5 + alert, 0.25);
    if (!frozen && st.rollHold.step(tdt, 0.5 + alert)) st.rollT = rng.next() < 0.35 ? rng.range(0.4, 0.9) * rng.sign() : 0;
    for (let i = 0; i < 4; i++) {
      const n = st.neck[i];
      const k = (i + 1) / 10;
      const ny = n.y.step(tdt, g.yaw * k + Math.sin(st.t * 0.7 - i * 0.8) * 0.05);
      const nx = n.x.step(tdt, g.pitch * k * 0.8 + Math.sin(st.t * 0.5 - i * 0.6) * 0.04 - strike * 0.12);
      rot(b['neck' + (i + 1)], nx, ny, Math.sin(st.t * 0.37 + i) * 0.03, 'YXZ');
    }
    rot(b.head, g.pitch * 0.3 + strike * 0.3, g.yaw * 0.25, g.roll + vary.roll0 + st.rollT * 0.5, 'YXZ');
    b.jaw.scale.set(1, 1 + strike * 0.4, 1);
    // the dangling eye: keep hanging under gravity, swinging after the head's moves
    {
      b.head.updateWorldMatrix(true, false);
      b.head.getWorldQuaternion(q); inst.root.getWorldQuaternion(qr);
      dq.copy(qr).invert().multiply(q);
      const e = eul.setFromQuaternion(dq, 'YXZ');
      const sx = st.eyeX.step(tdt, -e.x * 0.6) , sz = st.eyeZ.step(tdt, -e.z * 0.6);
      inst.root.getWorldQuaternion(qr);
      qr.multiply(q2.setFromEuler(eul.set(sx + Math.sin(st.t * 2.1) * 0.05, 0, sz + Math.sin(st.t * 1.7) * 0.06)));
      setWorldQuat(b.eyeDangle, qr);
    }
    // arms: dangle almost to the floor, swing late and heavy; elbows lock backwards
    for (let i = 0; i < 2; i++) {
      const S = i ? 'R' : 'L', sg = i ? 1 : -1;
      const a = st.arm[i].step(tdt, (L[1 - i].t < 1 ? Math.sin(L[1 - i].t * PI) : 0) * 0.25 + strike * 1.9);
      const az = st.armZ[i].step(tdt, sw * 2);
      rot(b['shoulder' + S], a, 0, sg * 0.04 + az);
      rot(b['elbow' + S], -0.1 - a * 0.3, 0, 0);
      rot(b['wrist' + S], 0.15 + strike * 0.6, 0, 0);
      for (let f = 0; f < 4; f++) {
        let c = 0.35 + Math.sin(st.t * 0.9 + f + i * 3) * 0.08;
        if (st.twF === f + i * 4 && st.tw > 0) c += st.tw * 0.8;
        c += tremor(st.t + st.frozenT, f + i * 5, 9) * (frozen ? 0.01 : 0.03);
        rotAxis(b[`f${S}${f}`], GF(S).d(0, 0, 1), -sg * c);
      }
      rotAxis(b['thumb' + S], GF(S).d(0, 0, 1), -sg * 0.3);
    }
    if (!frozen && st.twitchHold.step(tdt, 0.6 + alert)) { st.tw = 1; st.twF = rng.int(0, 7); }
    st.tw = Math.max(0, st.tw - tdt * 5);
    rot(b.tank, Math.sin(st.t * 1.1) * 0.05 + sw * 3, 0, -sw * 4 + Math.sin(st.t * 0.8) * 0.04);
    const tr = frozen ? 0.003 : 0.0015, tt = st.t + st.frozenT;
    addRot(b.head, tremor(tt, 11, 8) * tr, tremor(tt, 12, 8) * tr, 0);
  }
  return { update };
}
