// THE FUNGAL — black fungus that grew into the shape of a man: a tall, stooped body of lumpy mycelial masses
// over a stringy frame, arms hanging past the knees ending in root-like fingers, the head a stack of glossy
// bracket fungi with no face at all, pale pustules and slime down the chest, hanging threads of mycelium.
// Sculpted (SDF) body on a humanoid rig + mycelium cloth strands. Animator: slow lurching walk, sway,
// overhead two-armed slam (attackT), clutching grab, recoil; dead: folds forward.
import * as THREE from 'three';
import { Sculpt, MAT } from './sdf.js';
import { PartSet, ClothSet } from './parts.js';
import { BoneSpec, assembleBody } from './rig.js';
import { onSurf, rag, drip, add3 } from './details.js';
import * as G from './geo.js';
import { RNG, PI, clamp, lerp } from './core.js';
import { Spring, rot } from './anim.js';

const BLK = 0x16170f, BLK2 = 0x232417, GLOSS = 0x0c0d08, PUS = 0xc8c4a0;

function bones() {
  const B = new BoneSpec();
  B.add('hips', null, [0, 1.0, 0.02]);
  B.add('spine', 'hips', [0, 1.28, 0.03]);
  B.add('chest', 'spine', [0, 1.55, -0.02]);
  B.add('neck', 'chest', [0, 1.78, -0.06]);
  B.add('head', 'neck', [0, 1.9, -0.08]);
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    B.add('sh' + k, 'chest', [s * 0.24, 1.7, -0.02]);
    B.add('el' + k, 'sh' + k, [s * 0.3, 1.22, 0.0]);
    B.add('wr' + k, 'el' + k, [s * 0.33, 0.78, -0.04]);
    B.add('th' + k, 'hips', [s * 0.12, 0.97, 0.02]);
    B.add('kn' + k, 'th' + k, [s * 0.13, 0.52, -0.02]);
    B.add('an' + k, 'kn' + k, [s * 0.14, 0.08, 0.03]);
  }
  return B;
}

export function template() {
  const B = bones(), names = B.names;
  const S = new Sculpt(names), Hd = new Sculpt(names);
  const r = new RNG(17);
  // lumpy chain of fungal nodules along a segment
  const lumps = (bone, a, b2, r0, r1, n, o = {}) => {
    S.cone(a, b2, r0 * 0.65, r1 * 0.65, { bone, k: 0.03, ...o });
    for (let i = 0; i <= n; i++) {
      const t = i / n, rr = lerp(r0, r1, t) * (0.75 + r.next() * 0.5);
      const c = [lerp(a[0], b2[0], t) + (r.next() - 0.5) * rr * 0.6, lerp(a[1], b2[1], t), lerp(a[2], b2[2], t) + (r.next() - 0.5) * rr * 0.6];
      S.ell(c, [rr, rr * (1 + r.next() * 0.4), rr], [r.next(), r.next(), r.next()], { bone, k: 0.035, noise: [rr * 0.25, 14 + r.next() * 8], ...o });
    }
  };
  S.push({ mat: MAT.FLUFF, col: BLK, k: 0.04, wet: 0.25, dirt: 0.2 });
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    lumps('th' + k, [s * 0.12, 0.97, 0.02], [s * 0.13, 0.52, -0.02], 0.1, 0.075, 4);
    lumps('kn' + k, [s * 0.13, 0.52, -0.02], [s * 0.14, 0.1, 0.03], 0.072, 0.06, 4);
    S.ell([s * 0.14, 0.04, -0.03], [0.07, 0.04, 0.11], null, { bone: 'an' + k, k: 0.03, noise: [0.012, 16] });
    lumps('sh' + k, [s * 0.24, 1.7, -0.02], [s * 0.3, 1.22, 0.0], 0.075, 0.06, 4);
    lumps('el' + k, [s * 0.3, 1.22, 0.0], [s * 0.33, 0.8, -0.04], 0.058, 0.045, 4);
    // root-like fingers trailing from the wrists
    for (let f = 0; f < 5; f++) {
      const a = [s * 0.33, 0.8, -0.04], d = [(f - 2) * 0.02 + s * 0.02, -0.18 - r.next() * 0.08, (f - 2) * 0.012 - 0.02];
      S.chain([a, [a[0] + d[0] * 0.5, a[1] + d[1] * 0.5, a[2] + d[2] * 0.5], [a[0] + d[0], a[1] + d[1], a[2] + d[2] + 0.02]], [0.017, 0.011, 0.005], { bone: 'wr' + k, k: 0.012 });
    }
  }
  lumps('hips', [0, 0.98, 0.02], [0, 1.22, 0.03], 0.17, 0.15, 3);
  lumps('spine', [0, 1.26, 0.03], [0, 1.5, 0.0], 0.15, 0.17, 3);
  lumps('chest', [0, 1.52, -0.01], [0, 1.74, -0.05], 0.2, 0.15, 3);
  for (const s of [-1, 1]) S.ell([s * 0.19, 1.68, -0.01], [0.1, 0.08, 0.09], null, { bone: 'chest', k: 0.05, noise: [0.02, 12] });
  S.cone([0, 1.74, -0.05], [0, 1.88, -0.08], 0.08, 0.07, { bone: 'neck', bone2: 'head', k: 0.04 });
  S.pop();
  S.prepare();
  // glossy wet slime down the front, pale pustules
  S.paint({ ell: [[0, 1.45, -0.15], [0.16, 0.3, 0.1]] }, { col: GLOSS, wet: 1, w: 0.9, soft: 0.05 });
  const pus = [];
  for (let i = 0; i < 22; i++) {
    const q = onSurf(S, [(r.next() - 0.5) * 0.4, 0.9 + r.next() * 0.9, (r.next() - 0.5) * 0.35]);
    const rr = 0.008 + r.next() * 0.014;
    S.sphere(add3(q.p, q.n, rr * 0.3), rr, { bone: q.p[1] > 1.55 ? 'chest' : q.p[1] > 1.25 ? 'spine' : 'hips', mat: MAT.SKIN, col: PUS, k: 0.006, wet: 0.8 });
    pus.push(q);
  }
  for (let i = 0; i < 6; i++) drip(S, onSurf(S, [(r.next() - 0.5) * 0.3, 1.5, -0.18]).p, { n: 2, len: 0.2, w: 0.014, col: GLOSS, wet: 1, seed: 60 + i });
  // head: stacked glossy bracket shelves, gills underneath, no face
  Hd.push({ mat: MAT.FLUFF, col: BLK2, bone: 'head', k: 0.025, wet: 0.5, noise: [0.006, 24] });
  Hd.ell([0, 1.94, -0.06], [0.1, 0.13, 0.1], null, { k: 0.04 });
  for (let i = 0; i < 6; i++) {
    const y = 1.86 + i * 0.055, a = i * 1.7, rr = 0.14 - i * 0.012;
    const c = [Math.cos(a) * 0.05, y, -0.06 + Math.sin(a) * 0.05];
    Hd.ell([c[0] + Math.cos(a) * rr * 0.4, y, c[2] + Math.sin(a) * rr * 0.4], [rr, 0.022, rr * 0.8], [0.15 * Math.cos(a), a, 0.15 * Math.sin(a)], { col: i % 2 ? BLK2 : 0x2e2a1a, wet: 0.7 });
    Hd.ell([c[0] + Math.cos(a) * rr * 0.4, y - 0.02, c[2] + Math.sin(a) * rr * 0.4], [rr * 0.85, 0.012, rr * 0.7], [0.15 * Math.cos(a), a, 0.15 * Math.sin(a)], { sub: true, k: 0.008, mat: MAT.SKIN, col: 0x2a2618 });
  }
  Hd.pop();
  S.prepare(); Hd.prepare();
  // hanging mycelium threads
  const cloth = new ClothSet(names, S);
  for (let i = 0; i < 16; i++) {
    const arm = i % 3 !== 0, s = i % 2 ? 1 : -1;
    const q = onSurf(arm ? S : S, arm ? [s * 0.3, 1.0 + r.next() * 0.5, (r.next() - 0.5) * 0.1] : [(r.next() - 0.5) * 0.3, 1.3 + r.next() * 0.3, 0.12]);
    rag(cloth, S, q.p, q.n, 0.006 + r.next() * 0.008, 0.12 + r.next() * 0.25, { color: 0x3a3828, mat: MAT.FLUFF, dirt: 0.3, out: 0.2, seed: 500 + i, taper: 0.9, twist: 2 });
  }
  const parts = new PartSet(names, S);
  for (const q of pus.slice(0, 8)) parts.add(G.sphere(0.006, 6, 4).translate(q.p[0] + q.n[0] * 0.012, q.p[1] + q.n[1] * 0.012, q.p[2] + q.n[2] * 0.012), { color: 0xe8f0c8, pbr: [0.05, 0, 1, 0.2], bone: q.p[1] > 1.55 ? 'chest' : 'spine' });
  const { geo, stats } = assembleBody([{ S, h: 0.016, tris: 10000 }, { S: Hd, h: 0.009, tris: 3500 }], { floor: 0.5, stains: 0.2, fade: 0, seed: 29, wetStains: 1 });
  return { spec: B, body: geo, parts: parts.build(), cloth: cloth.build(), bounds: new THREE.Sphere(new THREE.Vector3(0, 1.1, 0), 1.3), height: 2.15, radius: 0.4, stats, meta: { mat: 'fauna', smooth: true } };
}

// ============================================================================
export function animator(inst, tpl, seed) {
  const b = inst.byName, rest = inst.rest, bones = inst.bones;
  const rng = new RNG(seed * 6007 + 1);
  const st = { t: rng.next() * 30, ph: 0, slam: new Spring(60, 9), grab: new Spring(50, 9), stoop: new Spring(20, 6) };
  const reset = () => { for (let i = 0; i < bones.length; i++) { bones[i].position.copy(rest[i]); bones[i].quaternion.identity(); bones[i].scale.set(1, 1, 1); } };
  function update(dt, s) {
    dt = clamp(dt || 0, 0, 0.1);
    st.t += dt;
    reset();
    const mode = s.mode || 'drift', sp = s.speed || 0;
    if (s.dead) {
      rot(b.spine, 0.7, 0, 0.2); rot(b.chest, 0.5, 0, 0); rot(b.head, 0.6, 0.4, 0);
      for (const k of ['L', 'R']) { rot(b['kn' + k], 1.2, 0, 0); rot(b['sh' + k], -0.3, 0, 0); }
      return;
    }
    const amp = clamp(sp / 1.3, 0, 1);
    st.ph += dt * (1.1 + sp * 2.4);
    const lurch = Math.sin(st.ph);
    // legs: heavy, dragging stride
    rot(b.thL, lurch * 0.42 * amp, 0, 0); rot(b.thR, -lurch * 0.42 * amp, 0, 0);
    rot(b.knL, Math.max(0, -lurch) * 0.7 * amp + 0.08, 0, 0); rot(b.knR, Math.max(0, lurch) * 0.7 * amp + 0.08, 0, 0);
    b.hips.position.y -= Math.abs(lurch) * 0.05 * amp;
    rot(b.hips, 0, lurch * 0.12 * amp, lurch * 0.07 * amp);
    const stoop = st.stoop.step(dt, mode === 'hunt' ? 0.35 : 0.2);
    rot(b.spine, stoop + Math.sin(st.t * 0.6) * 0.05, 0, Math.sin(st.t * 0.45) * 0.07);
    rot(b.chest, 0.08 + Math.sin(st.t * 0.8) * 0.04, -lurch * 0.08 * amp, -lurch * 0.06 * amp);
    rot(b.neck, -0.1, Math.sin(st.t * 0.33) * 0.3, 0);
    rot(b.head, 0.1 + Math.sin(st.t * 0.5) * 0.1, 0, Math.sin(st.t * 0.37) * 0.4);
    // slam: arms rise overhead (0 .. 0.55), then crash down; grab: both arms forward, clutching
    const atk = s.attacking || 0;
    const up = st.slam.step(dt, atk < 0.55 ? atk / 0.55 : Math.max(0, 1 - (atk - 0.55) / 0.12));
    const grab = st.grab.step(dt, mode === 'grab' ? 1 : 0);
    for (const k of ['L', 'R']) {
      const sd = k === 'L' ? -1 : 1, swing = -lurch * sd * 0.22 * amp;
      rot(b['sh' + k], lerp(lerp(swing, -2.7, up), -1.35 + Math.sin(st.t * 9 + sd) * 0.08, grab), 0, sd * (0.06 + Math.sin(st.t * 0.9 + sd) * 0.04));
      rot(b['el' + k], -0.12 - up * 0.3 - grab * 0.35, 0, 0);
      rot(b['wr' + k], Math.sin(st.t * 1.4 + sd) * 0.15 - grab * 0.4, 0, 0);
    }
  }
  return { update };
}
