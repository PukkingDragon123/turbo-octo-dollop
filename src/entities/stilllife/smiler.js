// SMILER (body) — the thing behind the grin: a gaunt, hunched, slick black figure, too-long arms and fingers,
// narrow ribcage, the head a wide smooth dome (the glowing grin and eyes are an additive overlay riding on the
// head bone: entities/monsters/smiler.js). Wet black skin over visible ribs and spine knuckles.
// Animator: lurk (swaying, head tilting), charge (hunched lunge, arms trailing), flee (cowering melt), dead.
import * as THREE from 'three';
import { Sculpt, MAT } from './sdf.js';
import { PartSet } from './parts.js';
import { BoneSpec, assembleBody } from './rig.js';
import { surfPath, onSurf, add3 } from './details.js';
import { RNG, clamp, lerp } from './core.js';
import { Spring, rot } from './anim.js';

const SK = 0x0b0b0d, SK2 = 0x141318;

function bones() {
  const B = new BoneSpec();
  B.add('hips', null, [0, 0.98, 0.04]);
  B.add('spine', 'hips', [0, 1.22, 0.06]);
  B.add('chest', 'spine', [0, 1.45, 0.02]);
  B.add('neck', 'chest', [0, 1.6, -0.04]);
  B.add('head', 'neck', [0, 1.68, -0.08]);
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    B.add('sh' + k, 'chest', [s * 0.18, 1.52, 0.0]);
    B.add('el' + k, 'sh' + k, [s * 0.24, 1.1, 0.04]);
    B.add('wr' + k, 'el' + k, [s * 0.27, 0.68, 0.0]);
    B.add('th' + k, 'hips', [s * 0.1, 0.95, 0.04]);
    B.add('kn' + k, 'th' + k, [s * 0.11, 0.5, 0.0]);
    B.add('an' + k, 'kn' + k, [s * 0.12, 0.07, 0.05]);
  }
  return B;
}

export function template() {
  const B = bones(), names = B.names;
  const S = new Sculpt(names), Hn = new Sculpt(names);
  S.push({ mat: MAT.SKIN, col: SK, k: 0.035, wet: 0.7, noise: [0.002, 30] });
  S.ell([0, 0.98, 0.04], [0.13, 0.1, 0.09], null, { bone: 'hips' });
  S.cone([0, 1.02, 0.05], [0, 1.3, 0.07], 0.085, 0.07, { bone: 'spine', k: 0.05 });
  S.ell([0, 1.42, 0.02], [0.15, 0.13, 0.1], [0.2, 0, 0], { bone: 'chest', k: 0.05 });
  S.cone([0, 1.52, -0.01], [0, 1.66, -0.08], 0.05, 0.045, { bone: 'neck', k: 0.03 });
  // the head: a wide, smooth, faceless dome (the grin lives on it)
  S.ell([0, 1.72, -0.1], [0.15, 0.13, 0.12], null, { bone: 'head', k: 0.04, col: SK2 });
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    S.chain([[s * 0.18, 1.52, 0], [s * 0.24, 1.1, 0.04], [s * 0.27, 0.72, 0]], [0.04, 0.032, 0.026], { bones: ['sh' + k, 'el' + k], k: 0.025 });
    S.sphere([s * 0.24, 1.1, 0.04], 0.034, { bone: 'el' + k, k: 0.015 });
    S.chain([[s * 0.1, 0.95, 0.04], [s * 0.11, 0.5, 0], [s * 0.12, 0.09, 0.05]], [0.055, 0.04, 0.03], { bones: ['th' + k, 'kn' + k], k: 0.03 });
    S.sphere([s * 0.11, 0.5, 0], 0.042, { bone: 'kn' + k, k: 0.015 });
    S.ell([s * 0.12, 0.035, -0.02], [0.035, 0.03, 0.09], null, { bone: 'an' + k, k: 0.02 });
  }
  S.pop();
  S.prepare();
  // ribs and a spine of knuckles showing through the skin
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) {
    const y = 1.48 - i * 0.05;
    const P = surfPath(S, [s * 0.02, y, -0.12], [s * 0.15, y - 0.06, 0.02], 6);
    S.groove(P.map((q) => q.p), 0.009, 0.005, { rim: 0.004 });
  }
  for (let i = 0; i < 10; i++) { const q = onSurf(S, [0, 1.05 + i * 0.05, 0.2]); S.sphere(add3(q.p, q.n, -0.004), 0.014, { bone: i < 4 ? 'spine' : 'chest', mat: MAT.RUBBER, col: 0x1a1a1e, k: 0.012 }); }
  // long hands, fingers to the knee
  Hn.push({ mat: MAT.SKIN, col: SK, k: 0.008, wet: 0.6 });
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R', w = [s * 0.27, 0.7, 0];
    Hn.ell([w[0], 0.66, 0.0], [0.016, 0.05, 0.035], null, { bone: 'wr' + k });
    for (let f = 0; f < 4; f++) {
      const z = (f - 1.5) * 0.016;
      Hn.chain([[w[0], 0.62, z], [w[0] + s * 0.005, 0.52, z - 0.004], [w[0] + s * 0.012, 0.43, z - 0.012]], [0.0075, 0.006, 0.004], { bone: 'wr' + k });
    }
  }
  Hn.pop();
  S.prepare(); Hn.prepare();
  const parts = new PartSet(names, S);
  const { geo, stats } = assembleBody([{ S, h: 0.012, tris: 6500 }, { S: Hn, h: 0.005, tris: 2000 }], { floor: 0.1, stains: 0, fade: 0, seed: 41 });
  void lerp; void RNG;
  return { spec: B, body: geo, parts: null, cloth: null, bounds: new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 1.2), height: 1.85, radius: 0.24, stats, meta: { mat: 'fauna', smooth: true, headBone: 'head' } };
}

export function animator(inst, tpl, seed) {
  const b = inst.byName, rest = inst.rest, bones = inst.bones;
  const st = { t: (seed % 97) * 0.3, hunch: new Spring(40, 8), cower: new Spring(30, 7), ph: 0 };
  const reset = () => { for (let i = 0; i < bones.length; i++) { bones[i].position.copy(rest[i]); bones[i].quaternion.identity(); bones[i].scale.set(1, 1, 1); } };
  function update(dt, s) {
    dt = clamp(dt || 0, 0, 0.1);
    st.t += dt;
    reset();
    const mode = s.mode || 'lurk', sp = s.speed || 0;
    if (s.dead) { rot(b.spine, 0.6, 0, 0); rot(b.head, 0.5, 0.5, 0); rot(b.knL, 1.3, 0, 0); rot(b.knR, 1.3, 0, 0); return; }
    const charge = mode === 'charge' ? 1 : 0;
    const cower = st.cower.step(dt, mode === 'flee' || mode === 'flinch' || mode === 'hurt' ? 1 : 0);
    const hunch = st.hunch.step(dt, 0.35 + charge * 0.5);
    st.ph += dt * (1 + sp * 2.2);
    const amp = clamp(sp / 3, 0, 1), sw = Math.sin(st.ph);
    rot(b.thL, sw * 0.6 * amp - hunch * 0.3, 0, 0); rot(b.thR, -sw * 0.6 * amp - hunch * 0.3, 0, 0);
    rot(b.knL, Math.max(0, -sw) * 0.9 * amp + hunch * 0.35 + cower * 0.8, 0, 0); rot(b.knR, Math.max(0, sw) * 0.9 * amp + hunch * 0.35 + cower * 0.8, 0, 0);
    b.hips.position.y -= hunch * 0.06 + cower * 0.25;
    rot(b.spine, hunch * 0.45 + cower * 0.4, Math.sin(st.t * 0.5) * 0.06, Math.sin(st.t * 0.7) * 0.05);
    rot(b.chest, hunch * 0.3, 0, 0);
    rot(b.neck, -hunch * 0.5, 0, 0);
    rot(b.head, -hunch * 0.3 + Math.sin(st.t * 0.6) * 0.05, Math.sin(st.t * 0.31) * 0.2, Math.sin(st.t * 0.43) * 0.35 * (1 - charge));
    for (const k of ['L', 'R']) {
      const sd = k === 'L' ? -1 : 1;
      rot(b['sh' + k], charge * 0.9 + sd * sw * 0.2 * amp - cower * 1.2, 0, sd * (0.12 + charge * 0.3));
      rot(b['el' + k], -0.2 - cower * 1.2 + Math.sin(st.t * 1.1 + sd) * 0.05, 0, 0);
    }
  }
  return { update };
}
