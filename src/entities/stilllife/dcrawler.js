// DAMP CRAWLER — something that lay in the wet rooms too long: a bloated, grey-yellow, wet torso with the ribs
// pushing through, grown around eight human arms (four a side, shoulders splitting the flesh), elbows high like
// a spider's, walking on its palms. Its head is a long, eyeless skull split vertically into two mandibles lined
// with teeth, a cluster of small black eyes above the split. Sores, black mould, a dripping underside.
// Sculpted (SDF) body + hands, glossy parts (teeth, eyes, nails). Planted-hand IK gait (alternating tetrapods),
// rearing two front pairs to seize prey ('grab' / attack), twitching while it lurks; dead: limbs curl in.
import * as THREE from 'three';
import { Sculpt, MAT } from './sdf.js';
import { PartSet } from './parts.js';
import { BoneSpec, assembleBody } from './rig.js';
import { surfPath, onSurf, drip, add3 } from './details.js';
import * as G from './geo.js';
import { RNG, PI, clamp, lerp } from './core.js';
import { Spring, Hold, rot, addRot, ik2, Planter, parentLocal } from './anim.js';

const FLESH = 0x6a6246, PALE = 0x857b5c, SORE = 0x6a1a12, MOULD = 0x1a1c12;
const ZS = [-0.3, -0.1, 0.1, 0.3];
const LIMB = {};
ZS.forEach((z, i) => {
  for (const s of [-1, 1]) LIMB[(s < 0 ? 'L' : 'R') + i] = [[s * 0.23, 0.47, z], [s * 0.55, 0.64, z * 1.15], [s * 0.74, 0.06, z * 1.35]];
});
const KEYS = Object.keys(LIMB);

function bones() {
  const B = new BoneSpec();
  B.add('pelvis', null, [0, 0.43, 0.22]);
  B.add('torso', 'pelvis', [0, 0.46, -0.06]);
  B.add('neck', 'torso', [0, 0.47, -0.32]);
  B.add('head', 'neck', [0, 0.46, -0.42]);
  B.add('mL', 'head', [-0.035, 0.44, -0.5]);
  B.add('mR', 'head', [0.035, 0.44, -0.5]);
  for (const k of KEYS) {
    const [a, m, e] = LIMB[k];
    const par = +k[1] >= 2 ? 'pelvis' : 'torso';
    B.add('u' + k, par, a); B.add('l' + k, 'u' + k, m); B.add('e' + k, 'l' + k, e);
  }
  return B;
}

export function template() {
  const B = bones(), names = B.names;
  const S = new Sculpt(names), Hn = new Sculpt(names), Hd = new Sculpt(names);
  const r = new RNG(31);
  S.maxFoldFreq = 90;
  // ------------------------------------------------------------- torso: bloated, lumpy, wet
  S.push({ mat: MAT.SKIN, col: FLESH, k: 0.07, wet: 0.45, dirt: 0.25, noise: [0.012, 9] });
  S.ell([0, 0.44, 0.2], [0.27, 0.2, 0.25], null, { bone: 'pelvis' });
  S.ell([0, 0.47, -0.08], [0.28, 0.21, 0.3], null, { bone: 'torso' });
  S.ell([0.09, 0.58, 0.12], [0.17, 0.13, 0.18], [0, 0.4, 0.2], { bone: 'pelvis', k: 0.06 });
  S.ell([-0.11, 0.56, -0.12], [0.13, 0.11, 0.15], null, { bone: 'torso', k: 0.06 });
  S.ell([0, 0.33, 0.02], [0.2, 0.08, 0.3], null, { bone: 'torso', col: PALE, k: 0.08 }); // sagging underbelly
  S.cone([0, 0.47, -0.28], [0, 0.46, -0.4], 0.11, 0.08, { bone: 'neck', bone2: 'head', k: 0.05 });
  // shoulders splitting the flesh, arms: wasted human upper arms, knobbly elbows
  for (const k of KEYS) {
    const [a, m, e] = LIMB[k];
    const w = [lerp(m[0], e[0], 0.86), lerp(m[1], e[1], 0.86), lerp(m[2], e[2], 0.86)];
    S.sphere(a, 0.075, { bone: 'u' + k, k: 0.05, col: PALE });
    S.chain([a, m, w], [0.052, 0.04, 0.03], { bones: ['u' + k, 'l' + k], k: 0.03, noise: [0.004, 22] });
    S.sphere(m, 0.047, { bone: 'l' + k, k: 0.02, noise: [0.006, 30] });
    S.fold(m, 0.06, [e[0] - a[0], 0, 0], 70, 0.004, { warp: 0.6 });
  }
  S.pop();
  S.prepare();
  // ribs: grooves over the back; vertebrae knuckles along the spine; sores and black mould
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) {
    const z = -0.3 + i * 0.09;
    const P = surfPath(S, [s * 0.03, 0.72, z], [s * 0.26, 0.42, z + 0.04], 7);
    S.groove(P.map((q) => q.p), 0.016, 0.009, { rim: 0.008, wobble: 0.3 });
  }
  for (let i = 0; i < 9; i++) { const q = onSurf(S, [0, 0.75, 0.3 - i * 0.075]); S.sphere(add3(q.p, q.n, -0.008), 0.026, { bone: i < 3 ? 'pelvis' : 'torso', mat: MAT.RUBBER, col: 0xc8bc98, k: 0.02 }); }
  for (let i = 0; i < 9; i++) {
    const q = onSurf(S, [(r.next() - 0.5) * 0.5, 0.5 + r.next() * 0.2, (r.next() - 0.5) * 0.6]);
    S.paint({ sphere: [q.p, 0.035 + r.next() * 0.04, { noise: [0.02, 30] }] }, { mat: MAT.INNER, col: SORE, w: 1, soft: 0.008, wet: 1 });
    S.sphere(add3(q.p, q.n, 0.004), 0.018 + r.next() * 0.012, { sub: true, k: 0.01, mat: MAT.INNER, col: 0x3a0a08, wet: 1 });
  }
  for (let i = 0; i < 7; i++) {
    const q = onSurf(S, [(r.next() - 0.5) * 0.6, 0.45 + r.next() * 0.3, (r.next() - 0.5) * 0.7]);
    S.paint({ sphere: [q.p, 0.06 + r.next() * 0.06, { noise: [0.03, 18] }] }, { mat: MAT.FLUFF, col: MOULD, w: 0.9, soft: 0.02, dirt: 0.6 });
  }
  for (let i = 0; i < 5; i++) drip(S, onSurf(S, [(r.next() - 0.5) * 0.3, 0.3, (r.next() - 0.5) * 0.4]).p, { n: 2, len: 0.12, w: 0.012, col: 0x5a5030, wet: 1, seed: 40 + i });
  // ------------------------------------------------------------- head: split skull, two mandibles, eye cluster
  Hd.push({ mat: MAT.SKIN, col: PALE, k: 0.03, wet: 0.35, noise: [0.004, 26] });
  Hd.ell([0, 0.5, -0.45], [0.1, 0.1, 0.12], null, { bone: 'head' });
  for (const s of [-1, 1]) {
    const bone = s < 0 ? 'mL' : 'mR';
    Hd.ell([s * 0.05, 0.45, -0.55], [0.055, 0.07, 0.11], [0, s * 0.12, 0], { bone, k: 0.025 });
    Hd.cone([s * 0.04, 0.42, -0.6], [s * 0.025, 0.4, -0.7], 0.035, 0.012, { bone, k: 0.02 });
  }
  Hd.box([0, 0.44, -0.57], [0.012, 0.1, 0.15], null, 0.005, { sub: true, k: 0.012, mat: MAT.INNER, col: 0x4a0c08, wet: 1, bone: 'head' });
  Hd.pop();
  Hd.prepare();
  // ------------------------------------------------------------- hands: palms flat on the floor, long fingers
  Hn.push({ mat: MAT.SKIN, col: PALE, k: 0.012, wet: 0.3, dirt: 0.5, noise: [0.0015, 60] });
  for (const k of KEYS) {
    const [, m, e] = LIMB[k], s = k[0] === 'L' ? -1 : 1, bone = 'e' + k;
    const dir = new THREE.Vector3(e[0] - m[0], 0, e[2] - m[2]).normalize();
    const out = [s * 0.4 + dir.x * 0.6, 0, -0.5 + dir.z * 0.4];
    const ol = Math.hypot(out[0], out[2]); out[0] /= ol; out[2] /= ol;
    const side = [-out[2], 0, out[0]];
    Hn.cone([lerp(m[0], e[0], 0.8), lerp(m[1], e[1], 0.8), lerp(m[2], e[2], 0.8)], [e[0], 0.04, e[2]], 0.029, 0.026, { bone: 'l' + k, bone2: bone, t0: 0.4, t1: 0.95 });
    Hn.ell([e[0] + out[0] * 0.03, 0.022, e[2] + out[2] * 0.03], [0.04, 0.014, 0.045], [0, Math.atan2(out[0], out[2]), 0], { bone, k: 0.012 });
    for (let f = 0; f < 4; f++) {
      const o = (f - 1.5) * 0.019;
      const b0 = [e[0] + out[0] * 0.065 + side[0] * o, 0.018, e[2] + out[2] * 0.065 + side[2] * o];
      const len = 0.075 + (f === 1 || f === 2 ? 0.015 : 0);
      Hn.chain([b0, [b0[0] + out[0] * len * 0.55, 0.026, b0[2] + out[2] * len * 0.55], [b0[0] + out[0] * len, 0.008, b0[2] + out[2] * len]], [0.0085, 0.0075, 0.006], { bone, k: 0.006 });
    }
    const t0 = [e[0] + side[0] * 0.04 * (k[0] === 'L' ? -1 : 1), 0.02, e[2] + side[2] * 0.04];
    Hn.chain([t0, [t0[0] + out[0] * 0.04 + side[0] * 0.02, 0.012, t0[2] + out[2] * 0.04 + side[2] * 0.02]], [0.009, 0.007], { bone, k: 0.006 });
  }
  Hn.pop();
  Hn.prepare();
  const parts = new PartSet(names, S);
  // teeth along both mandible edges, small wet black eyes above the split
  const tooth = (p, d, len, rr, bone) => {
    const g = G.cyl(rr, 0.0005, len, 5).translate(0, len / 2, 0);
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...d).normalize()), new THREE.Vector3(1, 1, 1)));
    parts.add(g, { color: 0xd8cca8, pbr: [0.3, 0, 0.8, 0], bone });
  };
  for (const s of [-1, 1]) for (let i = 0; i < 8; i++) {
    const y = 0.37 + i * 0.022, z = -0.52 - Math.sin((i / 7) * PI) * 0.12;
    tooth([s * 0.016, y, z], [-s, 0.1 * (i - 3.5), -0.2], 0.025 + r.next() * 0.012, 0.005, s < 0 ? 'mL' : 'mR');
  }
  for (let i = 0; i < 9; i++) {
    const p = [(r.next() - 0.5) * 0.12, 0.55 + r.next() * 0.05, -0.5 - r.next() * 0.04];
    parts.add(G.sphere(0.009 + r.next() * 0.008, 8, 6).translate(p[0], p[1], p[2]), { color: 0x050505, pbr: [0.04, 0, 1, 0], bone: 'head' });
  }
  // cracked yellow nails
  for (const k of KEYS) {
    const e = LIMB[k][2];
    parts.add(G.sphere(0.012, 6, 4).scale(1, 0.4, 1.4).translate(e[0], 0.012, e[2]), { color: 0xb8a878, pbr: [0.4, 0, 0.5, 0], bone: 'e' + k });
  }
  const { geo, stats } = assembleBody([{ S, h: 0.011, tris: 9000 }, { S: Hd, h: 0.006, tris: 3500 }, { S: Hn, h: 0.006, tris: 5000 }], { floor: 0.6, stains: 0.35, fade: 0, seed: 13, wetStains: 1 });
  return { spec: B, body: geo, parts: parts.build(), cloth: null, bounds: new THREE.Sphere(new THREE.Vector3(0, 0.35, 0), 1.0), height: 0.78, radius: 0.5, stats, meta: { mat: 'fauna', smooth: true } };
}

// ============================================================================
export function animator(inst, tpl, seed) {
  const b = inst.byName, rest = inst.rest, bones = inst.bones;
  const rng = new RNG(seed * 7121 + 3);
  const legs = new Planter(rng, KEYS.map((k) => ({ rest: new THREE.Vector3(LIMB[k][2][0], 0, LIMB[k][2][2]), group: (+k[1] + (k[0] === 'L' ? 0 : 1)) % 2, lift: 0.16, dur: 0.17, k })), { lead: 0.12, stride: 0.3, overshoot: 0.5, jitter: 0.4, maxStepping: 4 });
  const st = { t: rng.next() * 40, twK: null, tw: 0, hold: new Hold(rng, 0.3, 1.8), rear: new Spring(80, 10), jaw: new Spring(120, 8), bob: new Spring(160, 13), atk: 0 };
  const v = new THREE.Vector3(), tgt = new THREE.Vector3();
  const POLE = new THREE.Vector3(0, 1, 0);
  const reset = () => { for (let i = 0; i < bones.length; i++) { bones[i].position.copy(rest[i]); bones[i].quaternion.identity(); bones[i].scale.set(1, 1, 1); } };
  function update(dt, s) {
    dt = clamp(dt || 0, 0, 0.1);
    st.t += dt;
    reset();
    const mode = s.mode || 'lurk', speed = s.speed || 0;
    if (s.dead) {
      rot(b.pelvis, 0, 0, 0); b.pelvis.position.y -= 0.18;
      for (const k of KEYS) { const sd = k[0] === 'L' ? -1 : 1; rot(b['u' + k], 0, 0, -sd * 0.9); rot(b['l' + k], 0, 0, sd * 1.5); }
      rot(b.mL, 0, 0.35, 0); rot(b.mR, 0, -0.35, 0);
      return;
    }
    const grab = mode === 'grab' || (s.attacking || 0) > 0.2;
    const lurk = mode === 'lurk';
    const rear = st.rear.step(dt, grab ? 1 : 0);
    // breathing, wet heaving torso; sinks low while lurking
    const br = Math.sin(st.t * (lurk ? 1.6 : 4)) * 0.5 + 0.5;
    b.torso.scale.set(1 + br * 0.05, 1 + br * 0.04, 1);
    legs.stride = 0.24 + clamp(speed / 5, 0, 1) * 0.3;
    const L = legs.update(dt, inst.root, 1.3 + speed * 0.5);
    let lift = 0;
    for (const l of L) if (l.t < 1) lift += Math.sin(l.t * PI);
    const bob = st.bob.step(dt, lift * 0.012 - (lurk ? 0.12 : 0));
    b.pelvis.position.y += bob;
    rot(b.pelvis, -rear * 0.25, 0, Math.sin(st.t * 2.3) * 0.03);
    rot(b.torso, -rear * 0.35, Math.sin(st.t * 0.9) * 0.05, 0);
    for (const l of L) {
      const k = l.k, front = +k[1] < 2;
      tgt.copy(l.cur); tgt.y += 0.06;
      if (front && rear > 0.05) {
        // the front arms rise and reach forward to seize
        v.set(LIMB[k][2][0] * 0.55, 0.55 + Math.sin(st.t * 9 + +k[1]) * 0.05, -0.85);
        inst.root.localToWorld(v);
        tgt.lerp(v, rear * (+k[1] === 0 ? 1 : 0.7));
      }
      if (st.twK === k && st.tw > 0) tgt.y += st.tw * 0.12;
      parentLocal(b['u' + k], tgt, v);
      ik2(b['u' + k], b['l' + k], b['e' + k], v, POLE, POLE);
    }
    if (st.hold.step(dt, lurk ? 1.4 : 0.6)) { st.tw = 1; st.twK = rng.pick(KEYS); }
    st.tw = Math.max(0, st.tw - dt * 5);
    // head sways and snaps; mandibles part, quiver and gape on the strike
    const look = s.lookTarget && !lurk;
    rot(b.neck, -0.1 + rear * 0.25 + Math.sin(st.t * 1.3) * 0.08, Math.sin(st.t * 0.7) * (look ? 0.1 : 0.3), Math.sin(st.t * 2.9) * 0.05);
    rot(b.head, Math.sin(st.t * 3.7) * 0.03, 0, Math.sin(st.t * 1.9) * 0.08);
    const open = st.jaw.step(dt, grab ? 0.9 + Math.sin(st.t * 22) * 0.15 : mode === 'rush' ? 0.45 : 0.1 + Math.max(0, Math.sin(st.t * 0.8)) * 0.2);
    rot(b.mL, 0, open * 0.5, -open * 0.1); rot(b.mR, 0, -open * 0.5, open * 0.1);
    addRot(b.head, tremorish(st.t) * 0.02, 0, 0);
  }
  return { update };
}
const tremorish = (t) => Math.sin(t * 31) * Math.sin(t * 7.3);
