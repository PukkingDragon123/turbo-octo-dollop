// BACKROOMS MOLE — a mole that tunnelled into Level 0 and mutated down here: a heavy barrel of dark fur
// with mange-bald patches of pink skin, a fleshy pink star of feelers for a nose (too many, some split),
// three milky pin eyes, huge pale spade claws. Sculpted (SDF), one skinned mesh + glossy parts.
// A second root bone carries the carpet hump it raises while tunnelling (scaled in when it burrows).
// Animator modes (MonsterView passes the AI state): graze / sniff / seek / eat / flee / hide / dig / burrow /
// surface / warn / follow / idle; dead. Fur on MAT.SUIT, skin on MAT.SKIN, claws on MAT.RUBBER (fauna material).
import * as THREE from 'three';
import { Sculpt, MAT } from './sdf.js';
import { PartSet } from './parts.js';
import { BoneSpec, assembleBody } from './rig.js';
import { onSurf } from './details.js';
import * as G from './geo.js';
import { RNG, PI, TAU, clamp, lerp } from './core.js';
import { Spring, rot, addRot } from './anim.js';

const FUR = 0x2f2620, FUR_LO = 0x4a3c31, PINK = 0xc98a84, CLAW = 0xe2d6bc;
const LIMB = {
  FL: [[-0.072, 0.09, -0.1], [-0.105, 0.035, -0.135]],
  FR: [[0.072, 0.09, -0.1], [0.105, 0.035, -0.135]],
  RL: [[-0.06, 0.085, 0.1], [-0.075, 0.022, 0.13]],
  RR: [[0.06, 0.085, 0.1], [0.075, 0.022, 0.13]],
};

function bones() {
  const B = new BoneSpec();
  B.add('pelvis', null, [0, 0.1, 0.08]);
  B.add('spine', 'pelvis', [0, 0.11, -0.01]);
  B.add('chest', 'spine', [0, 0.115, -0.085]);
  B.add('head', 'chest', [0, 0.1, -0.15]);
  B.add('snout', 'head', [0, 0.094, -0.225]);
  B.add('tail', 'pelvis', [0, 0.085, 0.17]);
  for (const k of Object.keys(LIMB)) { const [a, e] = LIMB[k]; B.add('u' + k, k[0] === 'F' ? 'chest' : 'pelvis', a); B.add('e' + k, 'u' + k, e); }
  B.add('hump', null, [0, 0, 0]);
  return B;
}

export function template() {
  const B = bones(), names = B.names;
  const S = new Sculpt(names), H = new Sculpt(names);
  const r = new RNG(71);
  S.push({ mat: MAT.SUIT, col: FUR, k: 0.035, dirt: 0.15, noise: [0.0025, 46] });
  S.ell([0, 0.098, 0.075], [0.094, 0.08, 0.09], null, { bone: 'pelvis' });
  S.ell([0, 0.108, -0.01], [0.102, 0.088, 0.1], null, { bone: 'spine', k: 0.05 });
  S.ell([0, 0.112, -0.085], [0.086, 0.078, 0.072], null, { bone: 'chest', k: 0.05 });
  S.ell([0, 0.098, -0.165], [0.054, 0.05, 0.075], [0.12, 0, 0], { bone: 'head', k: 0.045 });
  // limbs: stubby fur upper arm into a broad bare spade of a hand / a small hind foot
  for (const k of Object.keys(LIMB)) {
    const [a, e] = LIMB[k], f = k[0] === 'F';
    S.cone(a, [lerp(a[0], e[0], 0.7), lerp(a[1], e[1], 0.7), lerp(a[2], e[2], 0.7)], f ? 0.034 : 0.03, f ? 0.026 : 0.02, { bone: 'u' + k, k: 0.025 });
    S.ell(e, f ? [0.034, 0.012, 0.038] : [0.022, 0.01, 0.03], [f ? 0.25 : 0.1, 0, (k[1] === 'L' ? -1 : 1) * (f ? 0.55 : 0.2)], { bone: 'e' + k, mat: MAT.SKIN, col: PINK, k: 0.012, noise: [0.0015, 70], wet: 0.2 });
  }
  S.cone([0, 0.086, 0.15], [0, 0.07, 0.25], 0.013, 0.004, { bone: 'tail', mat: MAT.SKIN, col: PINK, k: 0.01, noise: [0.001, 80] });
  // snout + the star of feelers
  S.cone([0, 0.096, -0.21], [0, 0.092, -0.252], 0.024, 0.019, { bone: 'snout', mat: MAT.SKIN, col: PINK, k: 0.016, wet: 0.5, noise: [0.001, 90] });
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * TAU + 0.12, len = 0.022 + r.next() * 0.016;
    const p0 = [Math.cos(a) * 0.011, 0.092 + Math.sin(a) * 0.011, -0.256];
    const p1 = [Math.cos(a) * (0.022 + len * 0.6), 0.092 + Math.sin(a) * (0.022 + len * 0.6), -0.262 - len * 0.5];
    S.cone(p0, p1, 0.0055, 0.0028, { bone: 'snout', mat: MAT.SKIN, col: 0xe09a9c, k: 0.004, wet: 0.7 });
  }
  S.pop();
  // belly paler, mange: bald raw patches on the back and flanks
  S.paint({ ell: [[0, 0.035, 0], [0.12, 0.05, 0.2]] }, { col: FUR_LO, w: 0.8, soft: 0.03 });
  for (let i = 0; i < 6; i++) {
    const p = [(r.next() - 0.5) * 0.14, 0.14 + r.next() * 0.05, -0.08 + r.next() * 0.2];
    S.paint({ sphere: [p, 0.014 + r.next() * 0.018, { noise: [0.008, 50] }] }, { mat: MAT.SKIN, col: 0xb07a74, w: 1, soft: 0.006, wet: 0.3 });
  }
  S.prepare();
  // nostrils / eye pits
  for (const s of [-1, 1]) S.sphere([s * 0.006, 0.094, -0.263], 0.0035, { sub: true, k: 0.002, mat: MAT.INNER, col: 0x3a1010, bone: 'snout' });
  const eyes = [];
  for (const [x, y, z] of [[-0.038, 0.117, -0.192], [0.038, 0.117, -0.192], [0.022, 0.131, -0.175]]) {
    const q = onSurf(S, [x, y, z]);
    S.sphere(q.p, 0.0075, { sub: true, k: 0.004, mat: MAT.INNER, col: 0x2a1a18, bone: 'head' });
    eyes.push(q);
  }
  // the carpet hump (own root bone; scaled to zero unless it is tunnelling)
  H.push({ mat: MAT.SUIT, col: 0x8f7d45, bone: 'hump', k: 0.05, dirt: 0.5, noise: [0.01, 12] });
  H.ell([0, 0.0, 0], [0.17, 0.075, 0.27], null);
  H.ell([0.03, 0.03, -0.12], [0.08, 0.04, 0.09], null);
  H.pop();
  S.prepare(); H.prepare();
  const parts = new PartSet(names, S);
  for (const q of eyes) parts.add(G.sphere(0.0062, 8, 6).translate(q.p[0], q.p[1], q.p[2]), { color: 0xc8ccc0, pbr: [0.05, 0, 1, 0], bone: 'head' });
  // claws: long pale spades on the front hands, small hooks behind
  for (const k of Object.keys(LIMB)) {
    const e = LIMB[k][1], f = k[0] === 'F', s = k[1] === 'L' ? -1 : 1;
    for (let i = 0; i < 5; i++) {
      const len = f ? 0.03 + (i === 2 ? 0.006 : 0) : 0.012;
      const g = G.cyl(f ? 0.0075 : 0.0032, 0.0012, len, 6).scale(1.3, 1, 0.7).translate(0, len / 2, 0);
      const base = new THREE.Vector3(e[0] + s * (f ? 0.012 : 0.004) + (i - 2) * (f ? 0.012 : 0.007), e[1] - 0.004, e[2] - (f ? 0.03 : 0.022));
      const dir = new THREE.Vector3(s * 0.15 + (i - 2) * 0.08, -0.35, -1).normalize();
      g.applyMatrix4(new THREE.Matrix4().compose(base, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir), new THREE.Vector3(1, 1, 1)));
      parts.add(g, { color: CLAW, pbr: [0.3, 0, 0.7, 0], bone: 'e' + k });
    }
  }
  // whiskers
  for (let i = 0; i < 8; i++) {
    const s = i % 2 ? 1 : -1, len = 0.04 + r.next() * 0.03;
    const g = G.cyl(0.0009, 0.0003, len, 3).translate(0, len / 2, 0);
    const dir = new THREE.Vector3(s, (r.next() - 0.5) * 0.4, -0.3 - r.next() * 0.3).normalize();
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(s * 0.016, 0.096, -0.235), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir), new THREE.Vector3(1, 1, 1)));
    parts.add(g, { color: 0xb8b0a4, pbr: [0.5, 0, 0, 0], bone: 'snout' });
  }
  const { geo, stats } = assembleBody([{ S, h: 0.0052, tris: 5200 }, { S: H, h: 0.016, tris: 500 }], { floor: 0.25, stains: 0.05, fade: 0, seed: 7 });
  return { spec: B, body: geo, parts: parts.build(), cloth: null, bounds: new THREE.Sphere(new THREE.Vector3(0, 0.08, 0), 0.4), height: 0.22, radius: 0.18, stats, meta: { mat: 'fauna', smooth: true } };
}

// ============================================================================
export function animator(inst, tpl, seed) {
  const b = inst.byName, rest = inst.rest, bones = inst.bones;
  const rng = new RNG(seed * 9137 + 5);
  const st = { t: rng.next() * 30, ph: 0, bur: 0, rear: new Spring(90, 11), dig: 0, hy: 0, hx: 0, sniffAt: 0, eat: new Spring(60, 9) };
  const reset = () => { for (let i = 0; i < bones.length; i++) { bones[i].position.copy(rest[i]); bones[i].quaternion.identity(); bones[i].scale.set(1, 1, 1); } };
  function update(dt, s) {
    dt = clamp(dt || 0, 0, 0.1);
    const mode = s.mode || 'graze', sp = s.speed || 0;
    st.t += dt;
    reset();
    if (s.dead) {
      // on its back, paws curled up (the view topples the root)
      rot(b.uFL, -1.1, 0, -0.3); rot(b.uFR, -1.1, 0, 0.3); rot(b.uRL, 1, 0, -0.2); rot(b.uRR, 1, 0, 0.2);
      rot(b.head, 0.5, 0.3, 0); rot(b.snout, 0.3, 0, 0);
      b.hump.scale.setScalar(0.001);
      return;
    }
    const burrow = mode === 'burrow';
    st.bur += ((burrow ? 1 : 0) - st.bur) * Math.min(1, dt * 7);
    b.pelvis.scale.setScalar(Math.max(0.001, 1 - st.bur));
    const hb = Math.max(0.001, st.bur);
    b.hump.scale.set(hb, hb * (1 + Math.sin(st.t * 17) * 0.12), hb);
    b.hump.position.y = -0.035 + st.bur * 0.035;
    const amp = clamp(sp / 1.4, 0, 1);
    st.ph += dt * (3 + sp * 10);
    const rear = st.rear.step(dt, mode === 'warn' ? 1 : 0);
    const dig = mode === 'dig' || mode === 'surface' ? 1 : 0;
    const dg = dig * Math.sin(st.t * 32);
    // waddle: body rolls with the stride, bobs, rears up to squeal
    rot(b.pelvis, -rear * 0.5 + dig * 0.3, 0, Math.sin(st.ph) * 0.12 * amp);
    b.pelvis.position.y += Math.abs(Math.sin(st.ph)) * 0.012 * amp + rear * 0.03;
    rot(b.spine, -rear * 0.3, Math.sin(st.ph) * 0.08 * amp, 0);
    const breathe = 1 + Math.sin(st.t * (mode === 'flee' || mode === 'warn' ? 14 : 4)) * 0.03;
    b.spine.scale.set(breathe, breathe, 1);
    rot(b.uFL, Math.sin(st.ph) * 0.8 * amp + dg * 0.9 - rear * 1.1, 0, -0.15);
    rot(b.uFR, Math.sin(st.ph + PI) * 0.8 * amp - dg * 0.9 - rear * 1.1, 0, 0.15);
    rot(b.uRL, Math.sin(st.ph + PI) * 0.7 * amp, 0, 0);
    rot(b.uRR, Math.sin(st.ph) * 0.7 * amp, 0, 0);
    rot(b.eFL, -0.2 * amp + dg * 0.4, 0, 0); rot(b.eFR, -0.2 * amp - dg * 0.4, 0, 0);
    rot(b.tail, 0.2, Math.sin(st.t * 3.1) * 0.35, 0);
    // twitchy sniffing head; nose feelers flex; eating: head bobs down
    if (st.t > st.sniffAt) { st.sniffAt = st.t + 0.12 + rng.next() * 0.45; st.hy = (rng.next() - 0.5) * 0.7; st.hx = (rng.next() - 0.5) * 0.35; }
    const eat = st.eat.step(dt, mode === 'eat' ? 0.5 + Math.sin(st.t * 15) * 0.15 : 0);
    rot(b.head, st.hx * (sp > 2 ? 0.2 : 1) + eat - rear * 0.5, st.hy * (sp > 2 ? 0.2 : 1), 0);
    const flex = 1 + Math.sin(st.t * 21) * 0.08;
    b.snout.scale.set(flex, flex, 1);
    addRot(b.snout, Math.sin(st.t * 9) * 0.06, 0, 0);
  }
  return { update };
}
