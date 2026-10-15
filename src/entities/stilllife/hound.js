// HOUND — a clone stretched into a dog. The torso is pulled long and horizontal, the spine arches into
// a ridge of vertebrae under burlap worn so thin the ribs show; the hazmat suit survives only on the
// hips and hind legs. It runs on its gloved hands (elbows jutting backward like a dog's) and its
// booted feet (knees cocked forward). The sack head has been drawn out into a blind muzzle: both eyes
// sewn shut, a seam down the crown, a wet mouth slit lined with teeth, black hair hanging off the skull.
// Gait: trotting diagonal pairs that turn into a bounding gallop; the spine flexes with every stride;
// head low and sweeping while it sniffs, thrust forward and gaping when it pounces; cowers from light.
import * as THREE from 'three';
import { Sculpt, MAT } from './sdf.js';
import { PartSet, ClothSet } from './parts.js';
import { BoneSpec, assembleBody } from './rig.js';
import { Frame, glove, boot, tape, tear, scar, surfPath, onSurf, hit, rag, add3, sub3, norm3, gloveJoints, cuffCenter, limbFolds, drip, hose, servoJoints, wires } from './details.js';
import { PAL, RNG, PI, clamp, lerp } from './core.js';
import { Spring, SpringV, Hold, tremor, rot, addRot, rotAxis, ik2, Planter, setWorldQuat, parentLocal } from './anim.js';
import * as G from './geo.js';

// limbs: [upper joint, middle joint, end joint]
const LIMB = {
  FL: [[-0.15, 0.6, -0.3], [-0.2, 0.36, -0.18], [-0.18, 0.1, -0.33]],
  FR: [[0.15, 0.6, -0.3], [0.2, 0.36, -0.18], [0.18, 0.1, -0.33]],
  RL: [[-0.13, 0.56, 0.38], [-0.17, 0.42, 0.12], [-0.16, 0.1, 0.5]],
  RR: [[0.13, 0.56, 0.38], [0.17, 0.42, 0.12], [0.16, 0.1, 0.5]],
};
const FRONT = { FL: true, FR: true, RL: false, RR: false };
const CF = [0.056, 0.064, 0.06, 0.05].map((len) => ({ len, curl: 0.55, segs: 3 }));
const GF = (k) => { const e = LIMB[k][2], side = k[1] === 'L' ? -1 : 1; return Frame.e([e[0], e[1] + 0.02, e[2]], [-PI / 2 + 0.1, side * 0.25, 0], 'YXZ'); };
// head frame: local -Z is the muzzle, pitched down
const HEAD_F = Frame.e([0, 0.55, -0.66], [-0.32, 0, 0]);

function bones() {
  const B = new BoneSpec();
  B.add('pelvis', null, [0, 0.58, 0.34]);
  B.add('spine', 'pelvis', [0, 0.64, 0.08]);
  B.add('chest', 'spine', [0, 0.62, -0.2]);
  B.add('neck1', 'chest', [0, 0.65, -0.38]);
  B.add('neck2', 'neck1', [0, 0.6, -0.52]);
  B.add('head', 'neck2', HEAD_F.p(0, 0, 0.06));
  B.add('jaw', 'head', HEAD_F.p(0, -0.05, -0.02));
  B.add('tail', 'pelvis', [0, 0.6, 0.5]);
  for (const k of Object.keys(LIMB)) {
    const [a, m, e] = LIMB[k];
    const par = FRONT[k] ? 'chest' : 'pelvis';
    B.add('u' + k, par, a); B.add('l' + k, 'u' + k, m); B.add('e' + k, 'l' + k, e);
    if (FRONT[k]) { const gj = gloveJoints(GF(k), k[1] === 'L' ? -1 : 1, CF); gj.bases.forEach((p, i) => B.add(`f${k}${i}`, 'e' + k, p)); }
  }
  return B;
}

function tooth(parts, root, dir, len, r, bone) {
  const g = G.cyl(r, 0.0006, len, 6).translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...norm3(dir)));
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...root), q, new THREE.Vector3(1, 1, 1)));
  parts.add(g, { color: 0xe4d8b8, pbr: [0.32, 0, 0.75, 0], bone });
}

export function template() {
  const B = bones();
  const names = B.names;
  const body = new Sculpt(names), head = new Sculpt(names), hands = new Sculpt(names), feet = new Sculpt(names);
  body.maxFoldFreq = 110; feet.maxFoldFreq = 120;
  // ------------------------------------------------------------------ torso: hips still in the suit, the rest bare stretched burlap
  body.push({ mat: MAT.SKIN, col: PAL.burlapPale, k: 0.06, dirt: 0.45, thin: 0.35 });
  body.ell([0, 0.57, 0.34], [0.16, 0.12, 0.16], null, { bone: 'pelvis', mat: MAT.SUIT, col: PAL.suitDirty, thin: 0, dirt: 0.6 });
  body.ell([0, 0.64, 0.1], [0.12, 0.1, 0.18], null, { bone: 'spine', k: 0.08, thin: 0.55 });
  body.ell([0, 0.61, -0.2], [0.17, 0.155, 0.17], [0.15, 0, 0], { bone: 'chest', k: 0.08 });
  for (const s of [-1, 1]) body.sphere([s * 0.13, 0.63, -0.29], 0.075, { bone: 'chest', k: 0.06 });
  // the belly sucked in under the ribs
  body.ell([0, 0.49, 0.08], [0.13, 0.06, 0.16], null, { sub: true, k: 0.06, mat: null });
  body.cone([0, 0.64, -0.32], [0, 0.62, -0.5], 0.085, 0.06, { bone: 'neck1', bone2: 'neck2', k: 0.05, thin: 0.6 });
  // legs: hind legs in suit trousers, front: sleeves torn at the elbow -> bare burlap forearms
  for (const k of Object.keys(LIMB)) {
    const [a, m, e] = LIMB[k];
    if (FRONT[k]) {
      body.chain([a, m], [0.06, 0.05], { bones: ['u' + k], mat: MAT.SUIT, col: PAL.suitDirty, k: 0.04, thin: 0, dirt: 0.55, noise: [0.003, 14] });
      body.sphere(m, 0.054, { bone: 'l' + k, mat: MAT.SUIT, col: PAL.suitDirty, k: 0.03, thin: 0, dirt: 0.6 });
      body.cone(m, [e[0], e[1] + 0.05, e[2]], 0.04, 0.032, { bone: 'l' + k, k: 0.02, thin: 0.6, dirt: 0.55, noise: [0.001, 25] });
      servoJoints(body, m, [e[0], e[1] + 0.07, e[2]], 0.036, 3, { bone: 'l' + k, jitter: 0.25 });
      limbFolds(body, a, m, 0.06, { seed: k.charCodeAt(1) * 3 });
      body.torus(m, 0.05, 0.008, null, { bone: 'l' + k, mat: MAT.SUIT, col: PAL.suitDirty, k: 0.01, dirt: 0.8, noise: [0.006, 30] });
    } else {
      body.chain([a, m, [lerp(m[0], e[0], 0.78), lerp(m[1], e[1], 0.78), lerp(m[2], e[2], 0.78)]], [0.07, 0.056, 0.05], { bones: ['u' + k, 'l' + k], mat: MAT.SUIT, col: PAL.suitDirty, thin: 0, k: 0.045, dirt: 0.6, noise: [0.003, 12] });
      body.sphere(m, 0.062, { bone: 'l' + k, mat: MAT.SUIT, col: PAL.suitDirty, thin: 0, k: 0.03 });
      limbFolds(body, a, m, 0.075, { seed: k.charCodeAt(1) * 5 });
      limbFolds(body, m, e, 0.06, { seed: k.charCodeAt(1) * 7, amp: 1.2 });
    }
  }
  body.pop();
  body.prepare();
  // ribs: grooves across the flanks; vertebrae knuckling up along the arched back
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const z = -0.34 + i * 0.052;
      const P = surfPath(body, [s * 0.06, 0.78, z + 0.01], [s * 0.19, 0.5, z + 0.05], 7);
      body.groove(P.map((q) => q.p), 0.011, 0.006, { rim: 0.005, wobble: 0.25 });
    }
  }
  for (let i = 0; i < 11; i++) {
    const z = 0.42 - i * 0.075;
    const q = onSurf(body, [0, 0.85, z]);
    body.sphere(add3(q.p, q.n, -0.006), 0.02 - Math.abs(i - 5) * 0.0008, { bone: z > 0.2 ? 'pelvis' : z > -0.1 ? 'spine' : 'chest', mat: MAT.SKIN, col: PAL.burlapPale, k: 0.018, thin: 0.75, dirt: 0.4 });
  }
  // ------------------------------------------------------------------ head: blind muzzle on a long neck
  const F = HEAD_F;
  head.push({ mat: MAT.SKIN, col: PAL.burlap, bone: 'head', k: 0.06, dirt: 0.35, thin: 0.2, noise: [0.003, 22] });
  head.ell(F.p(0, 0.03, 0.05), [0.11, 0.1, 0.12], F.q);
  head.ell(F.p(0, 0.0, -0.13), [0.083, 0.075, 0.17], F.q, { k: 0.07 });
  head.ell(F.p(0, -0.065, -0.11), [0.074, 0.04, 0.16], F.q, { bone: 'jaw', k: 0.04 });
  head.chain([[0, 0.65, -0.34], [0, 0.62, -0.47], F.p(0, -0.01, 0.1)], [0.065, 0.058, 0.07], { bones: ['neck1', 'neck2', 'head'], k: 0.04, thin: 0.55, col: PAL.burlapPale });
  head.pop();
  head.prepare();
  // mouth: a wet slot most of the way along the muzzle, raw red gums round it
  head.paint({ ell: [F.p(0, -0.036, -0.17), [0.085, 0.04, 0.15], F.q, { noise: [0.006, 50] }] }, { col: 0x5a1712, w: 0.85, soft: 0.01, wet: 0.9, dirt: 0.2 });
  head.ell(F.p(0, -0.036, -0.165), [0.076, 0.027, 0.15], F.q, { sub: true, k: 0.008, mat: MAT.INNER, col: PAL.inner, wet: 0.95, bone: 'jaw', noise: [0.003, 40] });
  // eye sockets: hollow, sewn shut, stained dark
  const eyeP = [];
  for (const s of [-1, 1]) {
    const e = hit(head, F.p(s * 0.18, 0.06, -0.06), F.d(-s, -0.15, 0), 0.25);
    if (e) {
      head.ell(add3(e.p, e.n, -0.004), [0.028, 0.016, 0.026], F.q, { sub: true, k: 0.01, mat: MAT.SKIN, col: 0x2a1a10, bone: 'head', noise: [0.003, 60] });
      head.paint({ sphere: [e.p, 0.04, { noise: [0.008, 40] }] }, { col: 0x2e1c12, w: 0.7, soft: 0.015, wet: 0.4, dirt: 0.7 });
      eyeP.push([e, s]);
    }
  }
  head.prepare();
  const parts = new PartSet(names, body), cloth = new ClothSet(names, body);
  for (const [e, s] of eyeP) {
    const a = add3(e.p, F.d(0, 0, 1), 0.022), b = add3(e.p, F.d(0, 0, -1), 0.022);
    scar(head, parts, surfPath(head, a, b, 4), { bone: 'head', size: 0.016, width: 0.004, depth: 0.003, col: 0x3a2214, ws: head });
    void s;
  }
  // crown seam down the skull
  scar(head, parts, surfPath(head, F.p(0, 0.13, 0.14), F.p(0, 0.08, -0.2), 9), { bone: 'head', size: 0.015, width: 0.005, ws: head });
  // teeth along both lips (upper on the skull, lower on the jaw)
  for (let i = 0; i < 12; i++) {
    const u = i / 11, z = lerp(-0.045, -0.3, u), half = 0.068 * Math.sqrt(Math.max(0.06, 1 - Math.pow((z + 0.17) / 0.15, 2)));
    const len = lerp(0.042, 0.024, u) * (i % 3 === 1 ? 1.3 : 1);
    for (const s of [-1, 1]) {
      tooth(parts, F.p(s * half * 0.95, -0.012, z), F.d(s * 0.15, -1, -0.2), len, 0.0075, 'head');
      if (i < 11) tooth(parts, F.p(s * half * 0.88, -0.06, z - 0.01), F.d(s * 0.12, 1, -0.12), len * 0.85, 0.007, 'jaw');
    }
  }
  // drool from the corners
  for (const s of [-1, 1]) drip(head, F.p(s * 0.06, -0.05, -0.06), { n: 2, len: 0.07, w: 0.008, col: 0x24140c, wet: 0.95, seed: 7 + s });
  // black hair hanging from the skull and down the neck
  const rh = new RNG(77);
  for (let i = 0; i < 26; i++) {
    // sides and back of the skull (rag() needs a mostly horizontal surface normal)
    const back = i % 4 === 3;
    const a = (i % 2 ? 1 : -1) * rh.range(0.75, 1.55), along = back ? 0.17 : rh.range(-0.1, 0.12);
    const q = onSurf(head, back ? F.p(rh.range(-0.07, 0.07), rh.range(-0.02, 0.07), 0.2) : F.p(Math.sin(a) * 0.12, Math.cos(a) * 0.1 + 0.02, along));
    rag(cloth, head, q.p, q.n, rh.range(0.01, 0.02), rh.range(0.22, 0.42), { color: 0x0b0a09, mat: MAT.RUBBER, dirt: 0.05, out: 0.35, seed: 300 + i, bone: 'head', taper: 0.85, twist: rh.range(1, 3) });
  }
  // ------------------------------------------------------------------ hands & feet
  for (const k of Object.keys(LIMB)) {
    const [, m, e] = LIMB[k];
    const side = k[1] === 'L' ? -1 : 1;
    if (FRONT[k]) {
      glove(hands, GF(k), side, {
        bone: 'e' + k, cuffBone: 'l' + k, cuffDir: sub3(m, e),
        fingers: CF.map((f, i) => ({ ...f, r: 0.0115, bones: [`f${k}${i}`] })),
        thumb: { len: 0.042, bones: ['e' + k] },
      });
    } else {
      boot(feet, Frame.e([e[0], e[1], e[2]], [0, side * 0.12, 0]), { bone: 'e' + k, shinBone: 'l' + k, shaftDir: sub3(m, e), shaft: 0.12 });
    }
  }
  body.prepare(); head.prepare(); hands.prepare(); feet.prepare();
  // tears where the suit gave way over the hips; a broken hose hangs off the pelvis like a tail
  const T = (p, o) => { const q = onSurf(body, p); return tear(body, parts, cloth, q.p, q.n, o.size, o); };
  T([0.12, 0.6, 0.24], { size: 0.06, seed: 41, angle: 0.4, stuff: 2 });
  T([-0.14, 0.52, 0.4], { size: 0.05, seed: 42, angle: 1.1, stuff: 2, flap: false });
  hose(parts, [[0, 0.62, 0.48], [0, 0.6, 0.6], [0.03, 0.5, 0.72], [0.06, 0.32, 0.78], [0.04, 0.16, 0.86]], { bone: 'tail', ws: body, frayEnd: true, open: true, r: 0.014 });
  for (const k of ['FL', 'FR']) { const d = sub3(LIMB[k][1], LIMB[k][2]); tape(parts, hands, cuffCenter(GF(k), d), d, { wraps: 2, width: 0.028, seed: 3, reach: 0.09 }); }
  for (const k of ['RL', 'RR']) tape(parts, feet, [LIMB[k][2][0], 0.2, LIMB[k][2][2]], sub3(LIMB[k][1], LIMB[k][2]), { wraps: 2, width: 0.034, seed: 4, reach: 0.13 });
  // wet stains running down the ribs
  for (const s of [-1, 1]) drip(body, onSurf(body, [s * 0.14, 0.7, -0.2]).p, { n: 3, len: 0.14, w: 0.01, col: 0x3a1a0c, wet: 0.6, seed: 9 + s });
  // wiring spilling from under the jaw and between the ribs
  { const q = onSurf(body, [0, 0.56, -0.44]); wires(parts, q.p, q.n, { n: 5, len: 0.16, seed: 21, bone: 'neck1', ws: body }); }
  for (const s of [-1, 1]) { const q = onSurf(body, [s * 0.17, 0.6, -0.12]); wires(parts, q.p, q.n, { n: 3, len: 0.1, seed: 30 + s, bone: 'chest', ws: body }); }

  const { geo, stats } = assembleBody([
    { S: body, h: 0.0145, tris: 9500 }, { S: head, h: 0.009, tris: 7000 }, { S: hands, h: 0.007, tris: 4200 }, { S: feet, h: 0.012, tris: 2000 },
  ], { floor: 0.8, stains: 0.75, fade: 0.4, seed: 23 });
  return {
    spec: B, body: geo, parts: parts.build(), cloth: cloth.build(),
    bounds: new THREE.Sphere(new THREE.Vector3(0, 0.45, 0), 1.05),
    height: 0.78, radius: 0.34, stats, meta: {},
  };
}

// ============================================================================
export function animator(inst, tpl, seed) {
  const b = inst.byName, rest = inst.rest, bones = inst.bones;
  const rng = new RNG(seed * 6151 + 3);
  const keys = Object.keys(LIMB);
  // trot: diagonal pairs
  const group = { FL: 0, RR: 0, FR: 1, RL: 1 };
  const legs = new Planter(rng, keys.map((k) => ({ rest: new THREE.Vector3(LIMB[k][2][0], 0, LIMB[k][2][2]), group: group[k], lift: FRONT[k] ? 0.12 : 0.1, dur: 0.16, k })), { lead: 0.14, stride: 0.3, overshoot: 0.65, jitter: 0.5, maxStepping: 2 });
  const st = {
    t: rng.next() * 50, atkT: 9, prevAtk: 0, frozenT: 0,
    lunge: new Spring(140, 12), crouch: new Spring(70, 9), headLow: new Spring(40, 7), pitch: new Spring(90, 10), yawS: new Spring(60, 8),
    jaw: new Spring(160, 9), jawT: 0, jawHold: new Hold(rng, 0.4, 2),
    flex: new Spring(120, 10), bob: new Spring(180, 14), roll: new Spring(90, 9),
    sniffT: 0, sweep: 0, twitch: 0, twK: null, twitchHold: new Hold(rng, 0.8, 3),
    loll: new SpringV(35, 4), prevP: new THREE.Vector3(), has: false, breath: 0,
  };
  const v = new THREE.Vector3(), tgt = new THREE.Vector3(), q = new THREE.Quaternion(), wp = new THREE.Vector3(), toT = new THREE.Vector3();
  const POLE_F = new THREE.Vector3(0, 0.2, 1), POLE_R = new THREE.Vector3(0, 0.2, -1), BEND_F = new THREE.Vector3(0, 0, 1), BEND_R = new THREE.Vector3(0, 0, -1);
  const reset = () => { for (let i = 0; i < bones.length; i++) { bones[i].position.copy(rest[i]); bones[i].quaternion.identity(); bones[i].scale.set(1, 1, 1); } };
  function update(dt, s) {
    dt = clamp(dt || 0, 0, 0.1);
    const frozen = !!s.frozen, mode = s.mode || 'prowl';
    const tdt = frozen ? 0 : dt;
    const speed = s.speed || 0;
    st.t += tdt; st.atkT += tdt; st.frozenT = frozen ? st.frozenT + dt : 0;
    inst.root.updateWorldMatrix(true, false);
    reset();
    // pounce trigger from the AI's attack timer
    const atkIn = clamp(s.attacking || 0, 0, 1);
    if (atkIn > 0.05 && st.prevAtk <= 0.05) st.atkT = 0;
    st.prevAtk = atkIn;
    const strike = st.atkT < 0.9 ? Math.sin(clamp(st.atkT / 0.45, 0, 1) * PI) * (st.atkT < 0.45 ? 1 : Math.exp(-(st.atkT - 0.45) * 6)) : 0;
    const cowering = mode === 'flee' || mode === 'flinch';
    const sniffing = mode === 'sniff' || mode === 'prowl' || mode === 'investigate' || mode === 'roam';
    const run = clamp((speed - 1.5) / 4.5, 0, 1);
    // ---------------- legs (planted IK); the stride lengthens into a bound at speed
    legs.stride = 0.26 + run * 0.4;
    const L = frozen ? legs.legs : legs.update(tdt, inst.root, 1.2 + speed * 0.45);
    let lift = 0, rollIn = 0, frontLift = 0, backLift = 0;
    for (const l of L) if (l.t < 1) { const s2 = Math.sin(l.t * PI); lift += s2; rollIn += (l.k[1] === 'L' ? 1 : -1) * s2; if (FRONT[l.k]) frontLift += s2; else backLift += s2; }
    const crouch = st.crouch.step(tdt, cowering ? 0.12 : sniffing && speed < 0.6 ? 0.05 : mode === 'circle' ? 0.06 : 0);
    const bob = st.bob.step(tdt, lift * (0.012 + run * 0.03) - crouch);
    const flex = st.flex.step(tdt, (frontLift - backLift) * (0.06 + run * 0.18));
    const rl = st.roll.step(tdt, rollIn * 0.04);
    const lunge = st.lunge.step(tdt, strike);
    b.pelvis.position.y += bob - lunge * 0.04;
    b.pelvis.position.z -= lunge * 0.22;
    rot(b.pelvis, -flex * 0.6 - crouch * 0.3, 0, rl);
    rot(b.spine, flex * 0.9 - lunge * 0.15, 0, -rl * 0.5);
    rot(b.chest, flex * 0.5 + lunge * 0.35 - crouch * 0.8, 0, -rl * 0.4);
    // breathing: ribs heave (fast when it has been running)
    st.breath += tdt * (2.2 + run * 6 + (mode === 'chase' || mode === 'circle' ? 3 : 0));
    const br = Math.sin(st.breath) * 0.5 + 0.5;
    b.chest.scale.set(1 + br * 0.04, 1 + br * 0.025, 1);
    for (const l of L) {
      const k = l.k;
      tgt.copy(l.cur);
      tgt.y += 0.1;
      // front paws reach for the prey during the pounce
      if (FRONT[k] && strike > 0.02) {
        v.set(LIMB[k][2][0] * 0.8, 0.32 + strike * 0.15, -0.75);
        inst.root.localToWorld(v);
        tgt.lerp(v, clamp(strike * 1.3, 0, 1));
      }
      if (st.twK === k && st.twitch > 0) tgt.y += st.twitch * 0.06;
      parentLocal(b['u' + k], tgt, v);
      ik2(b['u' + k], b['l' + k], b['e' + k], v, FRONT[k] ? POLE_F : POLE_R, FRONT[k] ? BEND_F : BEND_R);
      inst.root.getWorldQuaternion(q);
      setWorldQuat(b['e' + k], q);
      if (l.t < 1) addRot(b['e' + k], (FRONT[k] ? 0.5 : -0.4) * Math.sin(l.t * PI), 0, 0);
      if (FRONT[k]) {
        const sd = k[1] === 'L' ? -1 : 1, ax = GF(k).d(0, 0, 1);
        const curl = (l.t < 1 ? -0.35 : 0.3) + Math.sin(st.t * 6 + sd) * 0.05 - strike * 0.8;
        for (let i = 0; i < 4; i++) rotAxis(b[`f${k}${i}`], ax, -sd * curl);
      }
    }
    if (!frozen && st.twitchHold.step(tdt, 1 + (s.alert ?? 0.3) * 2)) { st.twitch = 1; st.twK = rng.pick(keys); }
    st.twitch = Math.max(0, st.twitch - tdt * 7);
    // ---------------- head: sweeping low and sniffing, locked on when hunting, thrust out to bite
    inst.root.getWorldPosition(wp);
    if (!st.has) { st.prevP.copy(wp); st.has = true; }
    const vel = v.subVectors(wp, st.prevP).divideScalar(Math.max(dt, 1e-3));
    if (vel.length() > 30) vel.set(0, 0, 0);
    st.prevP.copy(wp);
    inst.root.getWorldQuaternion(q).invert();
    vel.applyQuaternion(q);
    const loll = st.loll.step(tdt, tgt.set(clamp(-vel.x * 0.02, -0.08, 0.08), 0, clamp(-vel.z * 0.02, -0.1, 0.1)));
    let wy = 0, wpch = 0;
    if (s.lookTarget && !sniffing) {
      b.neck1.updateWorldMatrix(true, false);
      toT.copy(s.lookTarget); b.chest.worldToLocal(toT); toT.sub(b.neck1.position);
      wy = clamp(Math.atan2(-toT.x, -toT.z), -1.2, 1.2); wpch = clamp(Math.atan2(toT.y, Math.hypot(toT.x, toT.z)), -0.7, 0.6);
    }
    st.sniffT += tdt * (sniffing ? 1 : 0.3);
    const sweep = sniffing ? Math.sin(st.sniffT * 1.7) * 0.5 + Math.sin(st.sniffT * 4.3) * 0.08 : 0;
    const low = st.headLow.step(tdt, cowering ? 0.55 : sniffing ? 0.35 : mode === 'hunt' ? 0.05 : 0.1);
    const yaw = st.yawS.step(tdt, sniffing ? sweep : wy);
    const pitch = st.pitch.step(tdt, sniffing ? -0.2 : wpch);
    rot(b.neck1, -low * 0.6 - loll.z * 1.5 + lunge * 0.15 + pitch * 0.3, yaw * 0.4, loll.x * 2, 'YXZ');
    rot(b.neck2, -low * 0.4 + pitch * 0.35 + lunge * 0.2, yaw * 0.35, loll.x * 1.2, 'YXZ');
    rot(b.head, pitch * 0.3 + lunge * 0.1 + Math.sin(st.sniffT * 9) * 0.03 * (sniffing ? 1 : 0), yaw * 0.25, Math.sin(st.t * 0.8) * 0.06 + (cowering ? 0.3 : 0), 'YXZ');
    // ---------------- jaw: panting flutter at a run, snapping gape on the bite, working while it snarls
    if (!frozen && st.jawHold.step(tdt, 1 + run)) st.jawT = rng.next() < 0.4 ? rng.range(0.1, 0.4) : 0;
    const pant = (run > 0.2 || mode === 'circle') ? (Math.sin(st.breath * 2) * 0.5 + 0.5) * 0.35 : 0;
    const snarl = mode === 'circle' || mode === 'stalk' || mode === 'smash' ? 0.25 + Math.sin(st.t * 23) * 0.05 : 0;
    const hungry = mode === 'chase' || mode === 'hunt' || mode === 'pounce' ? 0.5 : 0.16;
    const jw = st.jaw.step(tdt, Math.max(st.jawT, pant, snarl, hungry) + strike * 1.1 - (st.atkT > 0.42 && st.atkT < 0.55 ? 1 : 0));
    rot(b.jaw, -clamp(jw, -0.05, 1.1) * 0.6, 0, 0);
    // tail hose swings with the gait
    rot(b.tail, 0.2 + flex * 0.8 + (cowering ? 0.6 : 0), Math.sin(st.t * (4 + run * 8)) * (0.15 + run * 0.25), 0);
    // frozen / held tremor
    const tr = frozen ? 0.004 : 0.0015, tt = st.t + st.frozenT;
    addRot(b.head, tremor(tt, 41, 9) * tr, tremor(tt, 42, 9) * tr, 0);
  }
  return { update };
}
