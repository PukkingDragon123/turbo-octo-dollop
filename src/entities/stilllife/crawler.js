// CRAWLER — an employee folded into a backbend with its torso wrenched 180° at the waist: the
// hips still face the floor but the chest (zipper, badge) faces the ceiling and the air tank
// scrapes along underneath. The suit has twisted into a spiral of creases around the waist. Its
// head hangs upside-down at the front on a stretched neck, jaw unhinged, eyes on you. It runs on
// six limbs like a spider: its two arms, two bare burlap arms that grew out of its ribs, and its
// legs, elbows and knees jutting high. Skitters in tripod bursts with planted feet; rears to bite.
import * as THREE from 'three';
import { Sculpt, MAT } from './sdf.js';
import { PartSet, ClothSet } from './parts.js';
import { BoneSpec, assembleBody } from './rig.js';
import { Frame, sackHead, headSeams, hood, face, glove, boot, tape, tapeStrip, badge, airTank, hose, zipper, tear, scar, surfPath, onSurf, hit, rag, crossStitch, ringAround, add3, sub3, norm3, gloveJoints, cuffCenter, limbFolds, torsoFolds, drip, handprint } from './details.js';
import * as G from './geo.js';
import { PAL, RNG, PI, TAU, clamp, lerp } from './core.js';
import { Spring, SpringV, Hold, Saccade, tremor, rot, addRot, rotAxis, ik2, Planter, setWorldQuat, parentLocal } from './anim.js';

const HEAD_F = Frame.e([0, 0.5, -0.4], [-0.35, 0, PI], 'ZXY');
const HD = { w: 0.19, h: 0.44, d: 0.17 };
// limbs: [upper joint, middle joint, end joint]
const LIMB = {
  FL: [[-0.19, 0.37, -0.17], [-0.43, 0.62, -0.27], [-0.53, 0.09, -0.43]],
  FR: [[0.19, 0.37, -0.17], [0.43, 0.62, -0.27], [0.53, 0.09, -0.43]],
  ML: [[-0.16, 0.46, 0.06], [-0.5, 0.64, 0.07], [-0.6, 0.075, 0.05]],
  MR: [[0.16, 0.46, 0.06], [0.5, 0.64, 0.07], [0.6, 0.075, 0.05]],
  RL: [[-0.13, 0.4, 0.34], [-0.37, 0.6, 0.48], [-0.43, 0.1, 0.6]],
  RR: [[0.13, 0.4, 0.34], [0.37, 0.6, 0.48], [0.43, 0.1, 0.6]],
};
const KIND = { FL: 'arm', FR: 'arm', ML: 'bare', MR: 'bare', RL: 'leg', RR: 'leg' };
const CF = [0.06, 0.068, 0.064, 0.054].map((len) => ({ len, curl: 0.75, segs: 3 }));
const GF = (k) => { const e = LIMB[k][2], side = k[1] === 'L' ? -1 : 1; return Frame.e([e[0], e[1] + 0.03, e[2]], [-PI / 2 + 0.12, side * 0.55, 0], 'YXZ'); };

function bones() {
  const B = new BoneSpec();
  B.add('pelvis', null, [0, 0.42, 0.3]);
  B.add('waist', 'pelvis', [0, 0.47, 0.1]);
  B.add('chest', 'waist', [0, 0.38, -0.1]);
  B.add('belly', 'chest', [0, 0.47, -0.08]);
  B.add('neck1', 'chest', [0, 0.43, -0.25]);
  B.add('neck2', 'neck1', [0, 0.49, -0.33]);
  B.add('head', 'neck2', HEAD_F.p(0, 0.02, 0));
  B.add('jaw', 'head', HEAD_F.p(0, 0.11, -0.13));
  B.add('tank', 'chest', [0, 0.24, -0.08]);
  for (const k of Object.keys(LIMB)) {
    const [a, m, e] = LIMB[k];
    const par = k[0] === 'R' ? 'pelvis' : k[0] === 'M' ? 'waist' : 'chest';
    B.add('u' + k, par, a); B.add('l' + k, 'u' + k, m); B.add('e' + k, 'l' + k, e);
    if (KIND[k] === 'arm') { const gj = gloveJoints(GF(k), k[1] === 'L' ? -1 : 1, CF); gj.bases.forEach((p, i) => B.add(`f${k}${i}`, 'e' + k, p)); }
  }
  return B;
}

export function template() {
  const B = bones();
  const names = B.names;
  const body = new Sculpt(names), head = new Sculpt(names), hands = new Sculpt(names), feet = new Sculpt(names);
  body.maxFoldFreq = 110; feet.maxFoldFreq = 120;
  // ------------------------------------------------------------------ torso: hips face down, chest wrenched face-up
  body.push({ mat: MAT.SUIT, col: PAL.suit, k: 0.05, dirt: 0.45 });
  body.ell([0, 0.43, 0.3], [0.19, 0.13, 0.17], null, { bone: 'pelvis' });
  body.ell([0, 0.49, 0.11], [0.15, 0.115, 0.15], [0.35, 0, 0.6], { bone: 'waist', k: 0.09 });
  body.ell([0, 0.39, -0.1], [0.21, 0.14, 0.17], null, { bone: 'chest', k: 0.08 });
  body.ell([0, 0.46, -0.08], [0.17, 0.08, 0.13], null, { bone: 'belly', k: 0.07 }); // belly bulging up
  body.cone([0, 0.41, -0.2], [0, 0.44, -0.28], 0.1, 0.075, { bone: 'chest', bone2: 'neck1', k: 0.05 });
  // spiral creases where the suit was wrung around the waist
  for (let i = 0; i < 5; i++) {
    const z = 0.0 + i * 0.05, a = i * 0.7;
    body.fold([Math.cos(a) * 0.05, 0.42 + Math.sin(a) * 0.05, z + 0.05], 0.13, [Math.cos(a + 0.8), Math.sin(a + 0.8), 1.4], 120, 0.0055, { warp: 0.5, phase: i });
  }
  for (const k of Object.keys(LIMB)) {
    const [a, m, e] = LIMB[k];
    const kind = KIND[k];
    if (kind === 'arm') {
      body.chain([a, m, [lerp(m[0], e[0], 0.62), lerp(m[1], e[1], 0.62), lerp(m[2], e[2], 0.62)]], [0.052, 0.042, 0.04], { bones: ['u' + k, 'l' + k], k: 0.035, noise: [0.003, 14] });
      body.sphere(m, 0.05, { bone: 'l' + k, k: 0.03 });
      limbFolds(body, a, m, 0.06, { seed: k.charCodeAt(0) + k.charCodeAt(1) }); limbFolds(body, m, [lerp(m[0], e[0], 0.6), lerp(m[1], e[1], 0.6), lerp(m[2], e[2], 0.6)], 0.05, { seed: k.charCodeAt(1) * 3 });
      body.fold(m, 0.08, sub3(m, a), 140, 0.0045, { warp: 0.7 });
    } else if (kind === 'leg') {
      body.chain([a, m, [lerp(m[0], e[0], 0.75), lerp(m[1], e[1], 0.75), lerp(m[2], e[2], 0.75)]], [0.066, 0.052, 0.05], { bones: ['u' + k, 'l' + k], k: 0.04, noise: [0.003, 12] });
      body.sphere(m, 0.062, { bone: 'l' + k, k: 0.03 });
      limbFolds(body, a, m, 0.075, { seed: k.charCodeAt(1) * 5 }); limbFolds(body, m, [lerp(m[0], e[0], 0.72), lerp(m[1], e[1], 0.72), lerp(m[2], e[2], 0.72)], 0.062, { seed: k.charCodeAt(1) * 7, amp: 1.2 });
      body.fold(m, 0.09, sub3(m, a), 140, 0.0045, { warp: 0.7 });
    } else {
      // bare, too-thin burlap arms grown out of the ribs (split the suit on the way out)
      body.chain([a, m, [e[0], e[1] + 0.05, e[2]]], [0.04, 0.033, 0.028], { bones: ['u' + k, 'l' + k], mat: MAT.SKIN, col: PAL.burlapDark, k: 0.03, thin: 0.6, dirt: 0.6, noise: [0.002, 25] });
      body.sphere(m, 0.036, { bone: 'l' + k, mat: MAT.SKIN, col: PAL.burlapDark, k: 0.02, thin: 0.5, dirt: 0.6 });
      body.paint({ sphere: [a, 0.07, { noise: [0.02, 20] }] }, { mat: MAT.SKIN, col: PAL.burlapDark, soft: 0.006, thin: 0.4, dirt: 0.7, wet: 0.35 });
    }
  }
  body.pop();
  // ------------------------------------------------------------------ head hangs upside-down (hood torn at the crown)
  hood(body, { ...HD, F: HEAD_F }, { bone: 'head', drapeBone: 'neck1', thick: 0.02, openY: 0.46, openW: 0.88, openH: 0.43, gathers: 14 });
  body.sphere(HEAD_F.p(0.02, 0.5, 0.04), 0.16, { sub: true, k: 0.015, mat: null, bone: 'head', noise: [0.03, 14] });
  body.ell(HEAD_F.p(-0.17, 0.3, 0.02), [0.06, 0.12, 0.1], HEAD_F.q, { sub: true, k: 0.012, mat: null, bone: 'head', noise: [0.02, 18] });
  const H = sackHead(head, HEAD_F, { ...HD, bone: 'head', neckLen: 0.06, neckBone: 'neck2', dirt: 0.55, thin: 0.2 });
  head.chain([[0, 0.42, -0.24], [0, 0.48, -0.32], HEAD_F.p(0, 0.05, 0.02)], [0.052, 0.048, 0.055], { bones: ['neck1', 'neck2'], mat: MAT.SKIN, col: PAL.burlapPale, k: 0.035, thin: 0.6, dirt: 0.5 });
  // unhinged jaw: the mouth torn open into a dark hole, threads still hanging across it
  head.ell(HEAD_F.p(0, 0.1, -0.1), [0.085, 0.085, 0.075], HEAD_F.q, { bone: 'jaw', mat: MAT.SKIN, col: PAL.burlap, k: 0.05, thin: 0.4 });
  head.prepare();
  const mouthC = hit(head, HEAD_F.p(0, 0.125, -0.3), HEAD_F.d(0, 0, 1), 0.4);
  head.ell(HEAD_F.p(0, 0.125, -0.165), [0.045, 0.034, 0.05], HEAD_F.q, { sub: true, k: 0.012, mat: MAT.INNER, col: PAL.inner, wet: 0.95, bone: 'jaw', noise: [0.004, 40] });
  // ------------------------------------------------------------------ hands & feet
  for (const k of Object.keys(LIMB)) {
    const [a, m, e] = LIMB[k];
    const side = k[1] === 'L' ? -1 : 1;
    if (KIND[k] === 'arm') {
      // palm flat on the floor, fingers forward-out
      // palm flat on the floor, fingers splayed forward-out; the cuff rises along the forearm
      glove(hands, GF(k), side, {
        bone: 'e' + k, cuffBone: 'l' + k, cuffDir: sub3(m, e),
        fingers: CF.map((f, i) => ({ ...f, r: 0.0118, bones: [`f${k}${i}`] })),
        thumb: { len: 0.045, bones: ['e' + k] },
      });
    } else if (KIND[k] === 'bare') {
      // bare burlap hand: lumpy mitten with stitched fingers, stuffing out of the thumb
      const F = Frame.e([e[0], e[1] + 0.01, e[2]], [-PI / 2 + 0.25, side * 0.9, 0], 'YXZ');
      hands.push({ mat: MAT.SKIN, col: PAL.burlapDark, bone: 'e' + k, k: 0.02, thin: 0.35, dirt: 0.65, noise: [0.0025, 30] });
      hands.cone(add3(F.p(0, -0.02, 0), norm3(sub3(m, e)), 0.08), F.p(0, -0.02, 0), 0.027, 0.032, { bone: 'l' + k, bone2: 'e' + k, t0: 0.4, t1: 0.95 });
      hands.ell(F.p(0, -0.06, 0), [0.022, 0.05, 0.04], F.q, { k: 0.02 });
      for (let i = 0; i < 3; i++) hands.chain([F.p(0, -0.09, -0.025 + i * 0.025), F.p(-side * 0.01, -0.15, -0.03 + i * 0.03), F.p(-side * 0.03, -0.19, -0.032 + i * 0.032)], [0.012, 0.011, 0.009], { k: 0.008 });
      hands.sphere(F.p(-side * 0.02, -0.04, -0.04), 0.02, { mat: MAT.FLUFF, col: PAL.stuffingOld, k: 0.01, noise: [0.004, 60] });
      hands.pop();
    } else {
      boot(feet, Frame.e([e[0], e[1], e[2]], [0, side * 0.5 + PI, 0]), { bone: 'e' + k, shinBone: 'l' + k, shaftDir: sub3(m, e), shaft: 0.12 });
    }
  }
  body.prepare(); head.prepare(); hands.prepare(); feet.prepare();
  const parts = new PartSet(names, body), cloth = new ClothSet(names, body);
  // ------------------------------------------------------------------ face (upside down)
  face(head, parts, H, {
    bone: 'head',
    eyes: [{ x: -0.082, y: 0.29, r: 0.02 }, { x: 0.085, y: 0.285, r: 0.022 }, { x: 0.02, y: 0.36, r: 0.012, browY: 0.05 }],
    noses: [{ x: 0.0, y: 0.21, r: 0.043 }],
  });
  // drool runs "down" from the upside-down mouth: over the nose and eyes toward the crown
  if (mouthC) drip(head, mouthC.p, { n: 4, len: 0.16, w: 0.009, col: 0x22120a, wet: 0.9, seed: 21 });
  if (mouthC) {
    // torn stitches dangling across the open mouth
    for (let i = 0; i < 5; i++) {
      const x = -0.035 + i * 0.018;
      const a = HEAD_F.p(x, 0.16, -0.165), b2 = HEAD_F.p(x + 0.005, 0.09 + (i % 2) * 0.03, -0.17);
      const m = add3(add3(a, b2, 0), [0, 0, 0], 0);
      parts.add(G.tube([a, [(a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2 - 0.01, (a[2] + b2[2]) / 2 - 0.012], b2], 0.0024, 4), { color: PAL.thread, pbr: [0.8, 0, 0, 0.12], uv: 'thread', bone: 'jaw' });
    }
  }
  headSeams(head, parts, H, { bone: 'head' });
  for (let i = 0; i < 4; i++) { const a = -1.2 + i * 0.8; const q = onSurf(body, HEAD_F.p(Math.sin(a) * 0.16, 0.36, Math.cos(a) * 0.1)); rag(cloth, body, q.p, q.n, 0.035, 0.05 + (i % 2) * 0.04, { seed: 140 + i, out: 0.5, bone: 'head', taper: 0.8, dirt: 0.6 }); }
  scar(head, parts, ringAround(head, [0, 0.455, -0.3], [0, 0.6, -1], 14, 0.1, 0.005), { bone: 'neck2', size: 0.012, width: 0.0045, depth: 0.003 });
  // ------------------------------------------------------------------ suit details: zipper spirals with the twist
  const zp = [];
  for (let i = 0; i <= 16; i++) {
    const u = i / 16, z = lerp(0.42, -0.2, u);
    const a = PI * clamp((0.25 - z) / 0.3, 0, 1); // 0 on the hips (underside) -> PI on the chest (top)
    zp.push(onSurf(body, [Math.sin(a) * 0.2, 0.42 - Math.cos(a) * 0.2, z]));
  }
  zipper(parts, body, zp, {});
  { const q = onSurf(body, [-0.1, 0.56, -0.1]); badge(parts, q.p, q.n, [0, 0, -1], 1, { bone: 'chest', spin: 0.3 }); }
  // tank strapped to the back -> now underneath, dented from dragging
  const tk = airTank(parts, Frame.e([0, 0.235, -0.08], [PI / 2, 0, 0.1]), { bone: 'tank', len: 0.36, r: 0.07, dents: 6, seed: 33 });
  hose(parts, [tk.top, add3(tk.top, [0.03, 0.02, -0.04]), [0.12, 0.3, -0.32], HEAD_F.p(-0.12, 0.15, 0.02)], { bone: 'tank', ws: body });
  for (const [p, up, sd] of [[[0.08, 0.53, -0.12], [0, 0, -1], 1], [[-0.12, 0.5, 0.3], [0, 0, -1], 2]]) { const q = onSurf(body, p); handprint(body, q.p, q.n, up, { seed: sd, smear: false }); }
  // tears: the ribs split where the extra arms came out; stuffing everywhere
  const T = (p, o) => { const q = onSurf(body, p); return tear(body, parts, cloth, q.p, q.n, o.size, o); };
  T([0.0, 0.5, 0.12], { size: 0.06, seed: 81, angle: 0.3, stuff: 3 });
  T([-0.15, 0.45, 0.33], { size: 0.05, seed: 82, angle: 1.2, stuff: 2 });
  T([0.12, 0.3, 0.22], { size: 0.05, seed: 83, angle: 0.8, stuff: 2, flap: false });
  for (const k of ['ML', 'MR']) {
    const a = LIMB[k][0];
    const rim = ringAround(body, a, sub3(LIMB[k][1], a), 10, 0.1);
    for (let i = 0; i < 3; i++) { const q = rim[i * 3]; rag(cloth, body, q.p, q.n, 0.03, 0.06, { seed: 90 + i + (k === 'ML' ? 0 : 5), out: 0.6, bone: 'waist', taper: 0.7 }); }
  }
  for (const k of ['FL', 'FR']) { const d = sub3(LIMB[k][1], LIMB[k][2]); tape(parts, hands, cuffCenter(GF(k), d), d, { wraps: 2, width: 0.03, seed: k.length + 3, reach: 0.09 }); }
  for (const k of ['RL', 'RR']) tape(parts, feet, [LIMB[k][2][0], 0.19, LIMB[k][2][2]], [0, 1, 0], { wraps: 2, width: 0.035, seed: 4, reach: 0.13 });
  // loose strap under the belly
  { const q = onSurf(body, [0.15, 0.3, -0.05]); rag(cloth, body, q.p, q.n, 0.034, 0.16, { color: 0x1e1d1c, mat: MAT.RUBBER, out: 0.2, seed: 99, bone: 'chest' }); }

  const { geo, stats } = assembleBody([
    { S: body, h: 0.0135, tris: 11500 }, { S: head, h: 0.0085, tris: 8500 }, { S: hands, h: 0.0066, tris: 5800 }, { S: feet, h: 0.0115, tris: 2400 },
  ], { floor: 0.9, stains: 0.7, fade: 0.5, seed: 17 });
  return {
    spec: B, body: geo, parts: parts.build(), cloth: cloth.build(),
    bounds: new THREE.Sphere(new THREE.Vector3(0, 0.35, 0), 1.0),
    height: 0.62, radius: 0.34, stats, meta: {},
  };
}

// ============================================================================
export function animator(inst, tpl, seed) {
  const b = inst.byName, rest = inst.rest, bones = inst.bones;
  const rng = new RNG(seed * 9137 + 5);
  const keys = Object.keys(LIMB);
  const group = { FL: 0, MR: 0, RL: 0, FR: 1, ML: 1, RR: 1 };
  const legs = new Planter(rng, keys.map((k) => ({ rest: new THREE.Vector3(LIMB[k][2][0], 0, LIMB[k][2][2]), group: group[k], lift: k[0] === 'R' ? 0.1 : 0.13, dur: 0.13, k })), { lead: 0.14, stride: 0.17, overshoot: 0.5, jitter: 0.8, maxStepping: 3 });
  const gaze = new Saccade(rng, { lo: 0.15, hi: 1.1, k: 1200, d: 28, err: 0.2, over: 0.4, maxYaw: 1.4, maxPitch: 0.8 });
  const st = {
    t: rng.next() * 30, prevAtk: 0, atkT: 9, rear: new Spring(90, 9), frozenT: 0,
    loll: new SpringV(30, 3.5), lollV: new THREE.Vector3(), prevV: new THREE.Vector3(), prevP: new THREE.Vector3(), has: false,
    bob: new Spring(160, 12), roll: new Spring(80, 8), jaw: new Spring(60, 5), jawHold: new Hold(rng, 0.8, 3), jawT: 0.2,
    twitchHold: new Hold(rng, 0.6, 2.2), tw: 0, twK: null, pause: 0, pauseHold: new Hold(rng, 2, 6),
  };
  const v = new THREE.Vector3(), tgt = new THREE.Vector3(), q = new THREE.Quaternion(), wp = new THREE.Vector3(), toT = new THREE.Vector3();
  const UPV = new THREE.Vector3(0, 1, 0);
  const reset = () => { for (let i = 0; i < bones.length; i++) { bones[i].position.copy(rest[i]); bones[i].quaternion.identity(); bones[i].scale.set(1, 1, 1); } };
  function update(dt, s) {
    dt = clamp(dt || 0, 0, 0.1);
    const frozen = !!s.frozen, alert = clamp(s.alert ?? 0.3, 0, 1);
    const tdt = frozen ? 0 : dt;
    st.t += tdt; st.atkT += tdt; st.frozenT = frozen ? st.frozenT + dt : 0;
    inst.root.updateWorldMatrix(true, false);
    reset();
    // proximity bite (the AI never sets attackT for crawlers): rear up when close and chasing
    let near = 9;
    if (s.lookTarget) { inst.root.getWorldPosition(wp); near = Math.hypot(s.lookTarget.x - wp.x, s.lookTarget.z - wp.z); }
    const atkIn = clamp(s.attacking || 0, 0, 1);
    if ((atkIn > st.prevAtk + 0.25 || (near < 1.35 && alert > 0.6 && st.atkT > 1.6)) && !frozen) st.atkT = 0;
    st.prevAtk = atkIn;
    const strike = st.atkT < 1.0 ? Math.exp(-st.atkT * 3.2) * (1 - Math.exp(-st.atkT * 25)) : 0;
    const rear = st.rear.step(tdt, strike);
    // skitter: tripod groups, sometimes a dead stop mid-run
    if (!frozen && st.pauseHold.step(tdt, 1 + alert)) st.pause = rng.next() < 0.3 ? rng.range(0.15, 0.5) : 0;
    st.pause = Math.max(0, st.pause - tdt);
    const L = frozen ? legs.legs : legs.update(st.pause > 0 ? 0 : tdt, inst.root, 1.3 + (s.speed || 0) * 0.35 + alert * 0.4);
    let lift = 0, rollIn = 0;
    for (const l of L) if (l.t < 1) { lift += Math.sin(l.t * PI); rollIn += (l.k[1] === 'L' ? 1 : -1) * Math.sin(l.t * PI); }
    const bob = st.bob.step(tdt, lift * 0.012 - alert * 0.04);
    const rl = st.roll.step(tdt, rollIn * 0.03);
    b.pelvis.position.y += bob;
    rot(b.pelvis, 0.02, 0, rl);
    // rearing: the front half lifts and the chest tips back
    rot(b.waist, rear * 0.5, Math.sin(st.t * 1.3) * 0.04, -rl * 0.5);
    rot(b.chest, rear * 0.35, 0, Math.sin(st.t * 0.9) * 0.03);
    b.belly.scale.set(1, 1 + Math.sin(st.t * 2.3) * 0.08 + strike * 0.2, 1);
    // limbs: IK to planted feet; joints jut upwards; front arms claw when rearing
    for (const l of L) {
      const k = l.k;
      tgt.copy(l.cur);
      tgt.y += k[0] === 'R' ? 0.1 : 0.06;
      if (k[0] === 'F' && rear > 0.02) {
        v.set(LIMB[k][2][0] * 0.6, 0.45 + Math.sin(st.t * 18 + (k[1] === 'L' ? 0 : 2)) * 0.08, -0.62);
        inst.root.localToWorld(v);
        tgt.lerp(v, clamp(rear * 1.4, 0, 1));
      }
      if (st.twK === k && st.tw > 0) tgt.y += st.tw * 0.07;
      parentLocal(b['u' + k], tgt, v);
      ik2(b['u' + k], b['l' + k], b['e' + k], v, UPV, UPV);
      if (k[0] !== 'M') { inst.root.getWorldQuaternion(q); setWorldQuat(b['e' + k], q); }
      if (KIND[k] === 'arm') { const ax = GF(k).d(0, 0, 1), sd = k[1] === 'L' ? -1 : 1; for (let i = 0; i < 4; i++) rotAxis(b[`f${k}${i}`], ax, -sd * ((l.t < 1 ? -0.4 : 0.25) + Math.sin(st.t * 7 + i) * 0.06 - rear * 0.6)); }
    }
    if (!frozen && st.twitchHold.step(tdt, 1 + alert * 2)) { st.tw = 1; st.twK = rng.pick(keys); }
    st.tw = Math.max(0, st.tw - tdt * 6);
    // head: dangles from the neck like dead weight (lags the body), snaps to look at you
    inst.root.getWorldPosition(wp);
    if (!st.has) { st.prevP.copy(wp); st.has = true; }
    const vel = v.subVectors(wp, st.prevP).divideScalar(Math.max(dt, 1e-3));
    if (vel.length() > 20) vel.set(0, 0, 0);
    st.prevP.copy(wp);
    inst.root.getWorldQuaternion(q).invert();
    vel.applyQuaternion(q);
    const lo = st.loll.step(tdt, tgt.set(clamp(-vel.x * 0.03, -0.08, 0.08), 0, clamp(-vel.z * 0.03, -0.08, 0.08)));
    let wy = 0, wpch = 0;
    if (s.lookTarget) {
      b.neck1.updateWorldMatrix(true, false);
      toT.copy(s.lookTarget); b.chest.worldToLocal(toT); toT.sub(b.neck1.position);
      wy = Math.atan2(-toT.x, -toT.z); wpch = Math.atan2(toT.y + 0.2, Math.hypot(toT.x, toT.z));
    }
    const g = frozen ? { yaw: gaze.y.x, pitch: gaze.p.x, roll: gaze.r.x } : gaze.update(tdt, wy, wpch * 0.6, 0.8 + alert * 2, 0.5);
    rot(b.neck1, lo.z * 1.2 - rear * 0.4, g.yaw * 0.3, lo.x * 2);
    rot(b.neck2, lo.z * 1.2 + g.pitch * 0.25, g.yaw * 0.3, lo.x * 1.5);
    rot(b.head, g.pitch * 0.5 + rear * 0.5, g.yaw * 0.45, g.roll + Math.sin(st.t * 0.7) * 0.1, 'YXZ');
    // jaw works open and shut; gapes on the bite
    if (!frozen && st.jawHold.step(tdt, 1 + alert)) st.jawT = rng.next() < 0.5 ? rng.range(0, 0.5) : 0.15;
    const jw = st.jaw.step(tdt, st.jawT + strike * 1.2);
    b.jaw.scale.set(1 + jw * 0.1, 1 + jw * 0.4, 1 + jw * 0.1);
    b.jaw.position.y += jw * 0.012;
    rot(b.tank, 0, 0, -rl * 2);
    const tr = frozen ? 0.003 : 0.0, tt = st.t + st.frozenT;
    addRot(b.head, tremor(tt, 31, 8) * tr, tremor(tt, 32, 8) * tr, 0);
  }
  return { update };
}
