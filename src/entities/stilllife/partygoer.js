// PARTYGOER — a clone left over from an office party that never ended. Too tall, too still, hazmat suit
// spattered with confetti, paper streamers round its neck, a striped party hat strapped onto its sack
// head with elastic. Two round bead eyes set far too wide, rosy painted cheeks, and a grin carved from
// ear to ear and stitched shut. It holds a red balloon on a string.
// Animation: stands like a mannequin (holds every pose exactly while watched); glides with tiny steps
// when nobody looks, head cocked, hat wobbling; lunges both hands forward to snatch; runs off giggling.
import * as THREE from 'three';
import { Sculpt, MAT } from './sdf.js';
import { PartSet, ClothSet } from './parts.js';
import { BoneSpec, assembleBody } from './rig.js';
import { Frame, sackHead, headSeams, hood, face, glove, boot, tape, crossStitch, surfPath, onSurf, hit, rag, add3, gloveJoints, limbFolds, torsoFolds, zipper, badge } from './details.js';
import * as G from './geo.js';
import { PAL, RNG, PI, TAU, clamp, lerp } from './core.js';
import { Spring, SpringV, Hold, Saccade, tremor, rot, addRot, ik2, Planter, setWorldQuat, parentLocal } from './anim.js';

const HEAD_F = Frame.e([0.0, 1.29, 0.005], [0.04, 0, 0.16], 'ZXY');
const SH = { L: [-0.21, 1.11, 0.01], R: [0.21, 1.11, 0.01] };
const EL = { L: [-0.26, 0.82, 0.02], R: [0.26, 0.82, 0.02] };
const WR = { L: [-0.275, 0.54, 0.0], R: [0.275, 0.54, 0.0] };
const HIP = { L: [-0.105, 0.7, 0.0], R: [0.105, 0.7, 0.0] };
const KN = { L: [-0.11, 0.41, -0.012], R: [0.11, 0.41, -0.012] };
const AN = { L: [-0.115, 0.1, 0.0], R: [0.115, 0.1, 0.0] };
const FINGERS = [{ len: 0.06, curl: 0.5 }, { len: 0.068, curl: 0.6 }, { len: 0.064, curl: 0.55 }, { len: 0.054, curl: 0.45 }];
const HD = { w: 0.2, h: 0.5, d: 0.18 };
const CONFETTI = [0xe84a8a, 0x3aa0e8, 0xf2d23a, 0x6ad04a, 0xf0f0f0, 0xb050e0];

function bones() {
  const B = new BoneSpec();
  B.add('pelvis', null, [0, 0.72, 0]);
  B.add('spine', 'pelvis', [0, 0.9, 0.0]);
  B.add('belly', 'spine', [0, 0.92, -0.04]);
  B.add('chest', 'spine', [0, 1.05, 0.01]);
  B.add('neck1', 'chest', [0.0, 1.15, 0.025]);
  B.add('neck2', 'neck1', [0.01, 1.23, 0.015]);
  B.add('head', 'neck2', HEAD_F.p(0, 0.03, 0));
  B.add('jaw', 'head', HEAD_F.p(0, 0.13, -0.14));
  B.add('hat', 'head', HEAD_F.p(0.02, 0.5, 0.0));
  for (const S of ['L', 'R']) {
    B.add('shoulder' + S, 'chest', SH[S]);
    B.add('elbow' + S, 'shoulder' + S, EL[S]);
    B.add('wrist' + S, 'elbow' + S, WR[S]);
    const s = S === 'L' ? -1 : 1;
    const gj = gloveJoints(Frame.e(WR[S], [0, 0, 0]), s, FINGERS.map((f) => ({ ...f, segs: 3 })));
    FINGERS.forEach((f, i) => B.add(`f${S}${i}`, 'wrist' + S, gj.bases[i]));
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
  // ------------------------------------------------------------------ BODY (suit, a little baggy)
  body.push({ mat: MAT.SUIT, col: PAL.suit, k: 0.05, dirt: 0.2 });
  body.ell([0, 0.75, 0.0], [0.2, 0.15, 0.18], null, { bone: 'pelvis' });
  body.ell([0, 0.91, -0.005], [0.225, 0.21, 0.2], null, { bone: 'belly', k: 0.07 });
  body.ell([0, 1.05, 0.012], [0.22, 0.15, 0.185], null, { bone: 'chest', k: 0.07 });
  for (const s of [-1, 1]) body.sphere([s * 0.19, 1.1, 0.015], 0.08, { bone: 'chest', k: 0.07 });
  body.cone([0, 1.1, 0.03], [0.01, 1.19, 0.03], 0.12, 0.085, { bone: 'chest', bone2: 'neck1', k: 0.05 });
  for (const S of ['L', 'R']) {
    body.chain([HIP[S], KN[S], [AN[S][0], 0.17, AN[S][2]]], [0.084, 0.07, 0.068], { bones: ['hip' + S, 'knee' + S], k: 0.04 });
    body.sphere([AN[S][0], 0.2, AN[S][2] + 0.005], 0.074, { bone: 'knee' + S, k: 0.05 });
    body.chain([SH[S], EL[S], [WR[S][0], WR[S][1] + 0.06, WR[S][2]]], [0.07, 0.06, 0.056], { bones: ['shoulder' + S, 'elbow' + S], k: 0.045, noise: [0.003, 14] });
    body.fold(EL[S], 0.1, [0, 1, 0], 140, 0.005, { warp: 0.8 });
    body.fold(KN[S], 0.09, [0, 1, 0.3], 150, 0.004, { warp: 0.7 });
    limbFolds(body, HIP[S], KN[S], 0.085, { seed: S === 'L' ? 13 : 14 });
    limbFolds(body, SH[S], EL[S], 0.07, { seed: S === 'L' ? 17 : 18 });
  }
  torsoFolds(body, [0, 0.9, 0], [0.23, 0.22, 0.2], 8, { seed: 21, axis: [0, 1, 0], amp: 0.8 });
  body.pop();
  const HH = { w: 0.204, h: 0.5, d: 0.184, F: HEAD_F };
  hood(body, HH, { bone: 'head', drapeBone: 'neck1', thick: 0.02, openY: 0.45, openW: 0.88, openH: 0.42, gathers: 15 });
  // the hat pushed the hood's crown open
  body.sphere(HEAD_F.p(0.0, 0.52, 0.02), 0.1, { sub: true, k: 0.015, mat: null, bone: 'head', noise: [0.02, 16] });
  // ------------------------------------------------------------------ HEAD
  const H = sackHead(head, HEAD_F, { ...HD, bone: 'head', thin: 0.1, neckLen: 0.08, neckBone: 'neck2', col: PAL.burlapPale, dirt: 0.2 });
  head.ell(HEAD_F.p(0.0, 0.11, -0.1), [0.085, 0.09, 0.075], HEAD_F.q, { bone: 'jaw', mat: MAT.SKIN, col: PAL.burlapPale, k: 0.05, thin: 0.2 });
  head.prepare();
  // the grin: a crescent cut from cheek to cheek, curling up at the ends
  const grin = [];
  for (let i = 0; i <= 14; i++) {
    const u = i / 14, x = lerp(-0.17, 0.17, u);
    const y = 0.17 + Math.pow(Math.abs(x) / 0.17, 2.2) * 0.075;
    const r = hit(head, HEAD_F.p(x, y, -0.4), HEAD_F.d(0, 0, 1), 0.6);
    if (r) grin.push(r);
  }
  for (let i = 0; i < grin.length - 1; i++) head.cone(grin[i].p, grin[i + 1].p, 0.011 - Math.abs(i - 7) * 0.0006, 0.011 - Math.abs(i - 6) * 0.0006, { sub: true, k: 0.006, mat: MAT.INNER, col: PAL.inner, wet: 0.85, bone: i > 3 && i < 11 ? 'jaw' : 'head', noise: [0.0015, 50] });
  // rosy painted cheeks
  for (const s of [-1, 1]) {
    const c = hit(head, HEAD_F.p(s * 0.12, 0.26, -0.4), HEAD_F.d(0, 0, 1), 0.6);
    if (c) head.paint({ sphere: [c.p, 0.035, { noise: [0.006, 60] }] }, { col: 0xd8505a, w: 0.55, soft: 0.02, dirt: 0 });
  }
  head.prepare();
  body.prepare(); hands.prepare(); feet.prepare();
  const parts = new PartSet(names, body), cloth = new ClothSet(names, body);
  face(head, parts, H, {
    bone: 'head',
    eyes: [{ x: -0.105, y: 0.335, r: 0.026, browY: 0.07, browTilt: 0.03 }, { x: 0.105, y: 0.335, r: 0.026, browY: 0.07, browTilt: -0.03 }],
    noses: [{ x: 0.0, y: 0.25, r: 0.04, col: 0xe8303a }],
  });
  if (grin.length > 4) crossStitch(parts, grin, { ws: head, bone: 'head', size: 0.022, step: 1, r: 0.0028 });
  headSeams(head, parts, H, { bone: 'head', sides: [-1] });
  // ------------------------------------------------------------------ PARTY HAT (striped cone, pompom, elastic)
  {
    const base = HEAD_F.p(0.02, 0.47, 0.0), ax = HEAD_F.d(0.05, 1, 0.08);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...ax).normalize());
    const segs = 6, Hh = 0.27, R0 = 0.088;
    for (let i = 0; i < segs; i++) {
      const y0 = (i / segs) * Hh, y1 = ((i + 1) / segs) * Hh;
      const g = G.cyl(R0 * (1 - y0 / Hh) + 0.003, R0 * (1 - y1 / Hh) + 0.003, y1 - y0, 20, true).translate(0, (y0 + y1) / 2, 0);
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...base), q, new THREE.Vector3(1, 1, 1)));
      parts.add(g, { color: i % 2 ? 0xf2d23a : 0xe84a8a, pbr: [0.55, 0, 0.35, 0.2], bone: 'hat' });
    }
    const tip = new THREE.Vector3(0, Hh + 0.012, 0).applyQuaternion(q).add(new THREE.Vector3(...base));
    parts.add(G.fuzzball(0.028, 0.25, 4).translate(tip.x, tip.y, tip.z), { color: 0x3aa0e8, pbr: [1, 0, 0, 0.9], bone: 'hat' });
    const rim = G.torus(R0 + 0.002, 0.004, 4, 24).rotateX(PI / 2);
    rim.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...base), q, new THREE.Vector3(1, 1, 1)));
    parts.add(rim, { color: 0xf0f0f0, pbr: [0.5, 0, 0.3, 0.2], bone: 'hat' });
    // elastic under the chin
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const a = PI * (i / 10);
      const r = onSurf(head, HEAD_F.p(Math.cos(a) * 0.19, 0.42 - Math.sin(a) * 0.4, 0.02));
      pts.push(add3(r.p, r.n, 0.004));
    }
    parts.add(G.tube(pts, 0.0018, 4), { color: 0xf0f0f0, pbr: [0.6, 0, 0, 0.2], ws: head, bone: 'head' });
  }
  // ------------------------------------------------------------------ HANDS & FEET
  for (const S of ['L', 'R']) {
    const s = S === 'L' ? -1 : 1;
    glove(hands, Frame.e(WR[S], [0, 0, 0]), s, {
      bone: 'wrist' + S, cuffBone: 'elbow' + S,
      fingers: FINGERS.map((f, i) => ({ ...f, segs: 3, r: 0.0118, bones: [`f${S}${i}`] })),
      thumb: { len: 0.046, bones: ['wrist' + S] },
    });
    boot(feet, Frame.e(AN[S], [0, S === 'L' ? 0.08 : -0.06, 0]), { bone: 'ankle' + S, shinBone: 'knee' + S });
  }
  body.prepare(); head.prepare(); hands.prepare(); feet.prepare();
  // confetti stuck all over the suit
  const rc = new RNG(31);
  for (let i = 0; i < 46; i++) {
    const y = rc.range(0.3, 1.12), a = rc.next() * TAU;
    const q = onSurf(body, [Math.cos(a) * 0.3, y, Math.sin(a) * 0.3]);
    body.paint({ sphere: [q.p, rc.range(0.006, 0.011)] }, { col: CONFETTI[i % CONFETTI.length], w: 0.95, soft: 0.002, dirt: 0 });
  }
  body.prepare();
  // paper streamers round the neck, hanging down the chest and back
  const streamers = [[0.08, -0.17, 0], [-0.1, -0.16, 1], [0.15, 0.12, 2], [-0.04, 0.17, 3], [0.18, -0.06, 4]];
  for (const [x, z, i] of streamers) {
    const q = onSurf(body, [x, 1.14, z]);
    rag(cloth, body, q.p, q.n, 0.022, 0.32 + (i % 3) * 0.1, { color: CONFETTI[i % 4], mat: MAT.SUIT, dirt: 0.1, out: 0.3, seed: 60 + i, bone: 'chest', taper: 0.1, twist: 3 });
  }
  zipper(parts, body, surfPath(body, [0, 0.66, -0.25], [0, 1.1, -0.21], 14, [0, 0, -0.05]), { bone: null });
  { const q = onSurf(body, [-0.11, 1.02, -0.22]); badge(parts, q.p, q.n, [0.05, 1, 0], 2, { bone: 'chest', spin: -0.1 }); }
  for (const S of ['L', 'R']) {
    const s = S === 'L' ? -1 : 1;
    tape(parts, hands, [WR[S][0], WR[S][1] + 0.045, WR[S][2]], [0, 1, 0], { wraps: 1, width: 0.03, seed: 2 + s, reach: 0.09 });
  }
  const { geo, stats } = assembleBody([
    { S: body, h: 0.0145, tris: 10000 }, { S: head, h: 0.0085, tris: 8500 }, { S: hands, h: 0.0064, tris: 4400 }, { S: feet, h: 0.0115, tris: 2200 },
  ], { floor: 0.45, stains: 0.35, fade: 0.4, seed: 8 });
  return {
    spec: B, body: geo, parts: parts.build(), cloth: cloth.build(),
    bounds: new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.3),
    height: 1.72, radius: 0.3, stats, meta: {},
  };
}

// ============================================================================
// the balloon: two extra meshes (balloon + string), shared geometry/materials
let _bal = null;
function balloonParts() {
  if (_bal) return _bal;
  const g = new THREE.SphereGeometry(0.15, 20, 14);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setY(i, y * 1.18 - (y < 0 ? Math.pow(-y / 0.15, 3) * 0.035 : 0)); }
  g.computeVertexNormals();
  const knot = new THREE.ConeGeometry(0.016, 0.03, 8).translate(0, -0.19, 0);
  const merged = mergeGeos([g, knot]);
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xc0161a, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.3, sheenColor: new THREE.Color(1, 0.5, 0.5) });
  const sg = new THREE.CylinderGeometry(0.0015, 0.0015, 1, 4, 1, true).translate(0, 0.5, 0);
  const smat = new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.8 });
  _bal = { geo: merged, mat, sgeo: sg, smat };
  return _bal;
}
function mergeGeos(list) {
  let nV = 0, nI = 0;
  for (const g of list) { nV += g.attributes.position.count; nI += g.index.count; }
  const pos = new Float32Array(nV * 3), nor = new Float32Array(nV * 3), idx = new Uint16Array(nI);
  let vo = 0, io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, vo * 3); nor.set(g.attributes.normal.array, vo * 3);
    for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo;
    vo += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

export function animator(inst, tpl, seed) {
  const b = inst.byName, rest = inst.rest, bones = inst.bones;
  const rng = new RNG(seed * 4409 + 29);
  const legs = new Planter(rng, [
    { rest: new THREE.Vector3(-0.12, 0, 0.0), group: 0, lift: 0.03, dur: 0.16 },
    { rest: new THREE.Vector3(0.12, 0, 0.0), group: 1, lift: 0.03, dur: 0.16 },
  ], { lead: 0.1, stride: 0.17, overshoot: 0.3, jitter: 0.4 });
  const gaze = new Saccade(rng, { lo: 0.5, hi: 2.8, k: 700, d: 26, err: 0.1, over: 0.15, maxYaw: 2.2, maxPitch: 0.8 });
  const st = {
    t: rng.next() * 100, atkT: 9, prevAtk: 0, frozenT: 0,
    tilt: new Spring(30, 5), tiltT: 0.2, tiltHold: new Hold(rng, 2, 6),
    reach: new Spring(110, 11), swing: new Spring(60, 7), lean: new Spring(70, 9), hat: new SpringV(80, 4),
    prevP: new THREE.Vector3(), has: false,
  };
  const v = new THREE.Vector3(), q = new THREE.Quaternion(), tgt = new THREE.Vector3(), toHead = new THREE.Vector3(), wp = new THREE.Vector3();
  const pole = new THREE.Vector3(0, 0, -1), bend = new THREE.Vector3(0, 0, -1);
  // balloon on a string from the right hand
  const B = balloonParts();
  const balloon = new THREE.Mesh(B.geo, B.mat);
  const string = new THREE.Mesh(B.sgeo, B.smat);
  balloon.castShadow = true;
  string.castShadow = false;
  inst.root.add(balloon, string);
  const bal = { p: new THREE.Vector3(), v: new THREE.Vector3(), init: false };
  const hand = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3();
  const reset = () => { for (let i = 0; i < bones.length; i++) { bones[i].position.copy(rest[i]); bones[i].quaternion.identity(); bones[i].scale.set(1, 1, 1); } };
  function update(dt, s) {
    dt = clamp(dt || 0, 0, 0.1);
    const frozen = !!s.frozen, mode = s.mode || 'pose';
    const tdt = frozen ? 0 : dt;
    st.t += tdt; st.atkT += tdt; st.frozenT = frozen ? st.frozenT + dt : 0;
    const atkIn = clamp(s.attacking || 0, 0, 1);
    if (atkIn > 0.05 && st.prevAtk <= 0.05) st.atkT = 0;
    st.prevAtk = atkIn;
    inst.root.updateWorldMatrix(true, false);
    reset();
    const running = mode === 'run' || mode === 'retreat';
    const speed = s.speed || 0;
    const L = frozen ? legs.legs : legs.update(tdt, inst.root, 1 + speed * 0.7);
    let sway = 0;
    for (const l of L) if (l.t < 1) sway += (l === L[0] ? -1 : 1) * Math.sin(l.t * PI);
    const strike = st.atkT < 1 ? Math.exp(-st.atkT * 3.5) * (1 - Math.exp(-st.atkT * 30)) : 0;
    const lean = st.lean.step(tdt, strike * 0.35 + (running ? 0.18 : speed > 0.3 ? 0.04 : 0));
    b.pelvis.position.x += sway * 0.015;
    b.pelvis.position.y += -Math.abs(sway) * 0.008 + (running ? Math.abs(Math.sin(st.t * 9)) * 0.03 : 0);
    rot(b.pelvis, -lean * 0.5, 0, sway * 0.02);
    for (let i = 0; i < 2; i++) {
      const S = i ? 'R' : 'L', l = L[i];
      tgt.copy(l.cur); tgt.y += 0.1;
      parentLocal(b['hip' + S], tgt, v);
      ik2(b['hip' + S], b['knee' + S], b['ankle' + S], v, pole, bend);
      inst.root.getWorldQuaternion(q);
      setWorldQuat(b['ankle' + S], q);
      if (l.t < 1) addRot(b['ankle' + S], -Math.sin(l.t * PI) * 0.3, 0, 0);
    }
    rot(b.spine, -lean * 0.4, 0, -sway * 0.015);
    rot(b.chest, -lean * 0.3 + Math.sin(st.t * 1.2) * 0.01, 0, 0);
    // head: cocked to one side, saccades onto you, a slow tilt that changes between glances
    let wy = 0, wpch = 0;
    if (s.lookTarget) {
      b.neck1.updateWorldMatrix(true, false);
      toHead.copy(s.lookTarget); b.chest.worldToLocal(toHead); toHead.sub(b.neck1.position);
      wy = Math.atan2(-toHead.x, -toHead.z); wpch = Math.atan2(toHead.y - 0.25, Math.hypot(toHead.x, toHead.z));
    }
    const g = frozen ? { yaw: gaze.y.x, pitch: gaze.p.x, roll: gaze.r.x } : gaze.update(tdt, wy, wpch, 0.7, 0.1);
    if (!frozen && st.tiltHold.step(tdt, 1)) st.tiltT = rng.range(-0.45, 0.45);
    const tilt = st.tilt.step(tdt, st.tiltT + (mode === 'pose' ? 0.15 : 0));
    rot(b.neck1, g.pitch * 0.25, g.yaw * 0.3, tilt * 0.4, 'YXZ');
    rot(b.neck2, g.pitch * 0.3, g.yaw * 0.3, tilt * 0.3, 'YXZ');
    rot(b.head, g.pitch * 0.45 - strike * 0.3, g.yaw * 0.4, tilt * 0.3 + g.roll, 'YXZ');
    // jaw: the stitched grin strains open on a snatch and when it giggles while running
    const open = clamp(strike * 1.2 + (running ? Math.max(0, Math.sin(st.t * 14)) * 0.4 : 0), 0, 1);
    b.jaw.scale.set(1 + open * 0.12, 1 + open * 0.3, 1);
    // arms: the right one holds the balloon string up; both shoot forward on a snatch; swing when running
    const reach = st.reach.step(tdt, strike);
    const sw = st.swing.step(tdt, running ? Math.sin(st.t * 9) * 0.5 : 0);
    rot(b.shoulderL, 0.05 + reach * 1.5 + sw * 0.6, 0, -0.06 - reach * 0.1);
    rot(b.elbowL, 0.15 + reach * 0.2, 0, 0);
    rot(b.shoulderR, 0.35 + reach * 1.2 - sw * 0.5, 0, 0.05);
    rot(b.elbowR, 1.05 - reach * 0.8, 0, 0.1);
    rot(b.wristR, -0.3, 0, 0);
    for (let i = 0; i < 2; i++) {
      const S = i ? 'R' : 'L', sg = i ? 1 : -1;
      for (let f = 0; f < 4; f++) rot(b[`f${S}${f}`], 0, 0, -sg * ((i ? 0.9 : 0.25) - reach * 0.7 + tremor(st.t + st.frozenT, f + i * 5, 6) * 0.03));
    }
    // party hat wobbles on its elastic
    inst.root.getWorldPosition(wp);
    if (!st.has) { st.prevP.copy(wp); st.has = true; }
    const vel = v.subVectors(wp, st.prevP).divideScalar(Math.max(dt, 1e-3));
    if (vel.length() > 20) vel.set(0, 0, 0);
    st.prevP.copy(wp);
    const hw = st.hat.step(tdt, tgt.set(clamp(-vel.x * 0.04, -0.2, 0.2), 0, clamp(-vel.z * 0.04, -0.2, 0.2)));
    rot(b.hat, hw.z + Math.sin(st.t * 2.1) * 0.03, 0, -hw.x + tilt * 0.15);
    const tr = frozen ? 0.003 : 0.0015, tt = st.t + st.frozenT;
    addRot(b.head, tremor(tt, 61, 8) * tr, tremor(tt, 62, 8) * tr, 0);
    // ---- balloon: springs toward a point above the hand, string from the hand to the knot
    inst.root.updateMatrixWorld(true);
    b.wristR.getWorldPosition(hand);
    hand.y -= 0.06;
    inst.root.worldToLocal(hand);
    tgt.set(hand.x + 0.05 + Math.sin(st.t * 0.7) * 0.06, hand.y + 0.85, hand.z + 0.05 + Math.cos(st.t * 0.53) * 0.05);
    if (!bal.init) { bal.p.copy(tgt); bal.init = true; }
    if (!frozen) {
      bal.v.addScaledVector(d.subVectors(tgt, bal.p), dt * 18).multiplyScalar(Math.exp(-dt * 3));
      // keep the string taut-ish
      bal.p.addScaledVector(bal.v, dt);
      d.subVectors(bal.p, hand);
      if (d.length() > 0.95) bal.p.copy(hand).addScaledVector(d.normalize(), 0.95);
    }
    balloon.position.copy(bal.p);
    balloon.rotation.set(Math.sin(st.t * 0.9) * 0.1, st.t * 0.3, d.x * 0.2);
    d.subVectors(bal.p, hand);
    const len = Math.max(0.05, d.length() - 0.2);
    string.position.copy(hand);
    string.quaternion.setFromUnitVectors(up, d.normalize());
    string.scale.set(1, len, 1);
  }
  return { update };
}
