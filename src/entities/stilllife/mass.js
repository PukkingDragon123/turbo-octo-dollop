// MASS — five or six employees melted into one heap. Suit and sack skin run into each other;
// seams have split and stuffing bulges out of them. Faces surface everywhere at different sizes:
// one hooded head on top still almost whole, one upside-down, one half-sunk with its mouth open,
// little ones with just beads and a red nose. Bead eyes are scattered where no face is. Arms and
// booted legs sprout at random angles; two arms drag the heap along, one reaches up, a leg kicks
// slowly in the air. Badges and an air tank are swallowed into the mass. Lumps breathe out of step.
import * as THREE from 'three';
import { Sculpt, MAT } from './sdf.js';
import { PartSet, ClothSet } from './parts.js';
import { BoneSpec, assembleBody } from './rig.js';
import { Frame, sackHead, headSeams, hood, face, glove, boot, tape, tapeStrip, badge, airTank, hose, tear, scar, surfPath, onSurf, hit, rag, bead, crossStitch, ringAround, add3, sub3, norm3, cross3, gloveJoints, cuffCenter, limbFolds, torsoFolds, drip, handprint, servoJoints } from './details.js';
import * as G from './geo.js';
import { PAL, RNG, PI, TAU, clamp, lerp } from './core.js';
import { Spring, Hold, Saccade, tremor, rot, addRot, rotAxis, ik2, Planter, setWorldQuat, parentLocal } from './anim.js';

// lumps: [centre, radii, euler, material, bone]
const LUMPS = [
  { c: [0, 0.3, 0.02], r: [0.56, 0.26, 0.48], e: [0, 0.3, 0], mat: 'suit', bone: 'core' },
  { c: [-0.08, 0.62, 0.06], r: [0.4, 0.3, 0.36], e: [0.2, 0.4, 0.3], mat: 'suit', bone: 'lumpA' },
  { c: [0.27, 0.66, -0.12], r: [0.24, 0.3, 0.22], e: [0.3, -0.5, -0.4], mat: 'suitB', bone: 'lumpB' },
  { c: [-0.3, 0.8, 0.1], r: [0.25, 0.24, 0.23], e: [-0.6, 0.2, 0.9], mat: 'skin', bone: 'lumpC' },
  { c: [0.05, 0.86, 0.26], r: [0.28, 0.23, 0.22], e: [0.9, 0, 0.2], mat: 'suit', bone: 'lumpD' },
  { c: [0.32, 0.36, 0.28], r: [0.22, 0.2, 0.22], e: [0.2, 0.7, 0.5], mat: 'skin', bone: 'lumpE' },
];
const HEAD1 = Frame.e([0.02, 0.98, -0.12], [-0.12, 0.15, 0.18], 'ZXY'); // hooded head on top
const HEAD2 = Frame.e([-0.36, 0.64, -0.2], [0.3, 0.6, PI * 0.92], 'ZXY'); // upside-down face, left
const HEAD3 = Frame.e([0.26, 0.24, -0.4], [-1.0, -0.3, -0.2], 'ZXY'); // half-sunk, low front right
// limbs: [kind, a, b, c, parent]
const LIMBS = {
  aFL: ['arm', [-0.32, 0.42, -0.3], [-0.5, 0.42, -0.62], [-0.48, 0.07, -0.86], 'core'],
  aFR: ['arm', [0.3, 0.4, -0.34], [0.52, 0.48, -0.6], [0.5, 0.07, -0.84], 'core'],
  aUp: ['arm', [0.15, 1.02, 0.12], [0.24, 1.3, 0.04], [0.2, 1.55, -0.04], 'lumpD'],
  aSide: ['bare', [0.5, 0.62, 0.1], [0.76, 0.5, 0.18], [0.86, 0.25, 0.1], 'lumpB'],
  aBack: ['arm', [-0.36, 0.55, 0.36], [-0.58, 0.68, 0.56], [-0.7, 0.42, 0.75], 'lumpA'],
  lAir: ['leg', [0.12, 0.66, 0.42], [0.22, 0.98, 0.62], [0.24, 1.24, 0.8], 'lumpD'],
  lBack: ['leg', [-0.18, 0.2, 0.42], [-0.3, 0.35, 0.66], [-0.36, 0.1, 0.86], 'core'],
};

const MF = (k) => [0.05, 0.056, 0.052, 0.044].map((len) => ({ len, curl: k === 'aUp' ? 0.9 : 0.6, segs: 3 }));
const MGF = (k) => {
  const [, , m, e] = LIMBS[k];
  const side = e[0] < 0 ? -1 : 1;
  if (k === 'aFL' || k === 'aFR') return Frame.e([e[0], e[1] + 0.03, e[2]], [-PI / 2 + 0.15, side * 0.4, 0], 'YXZ');
  return new Frame(e, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...norm3(sub3(m, e)))));
};

function bones() {
  const B = new BoneSpec();
  B.add('core', null, [0, 0.3, 0.02]);
  for (const L of LUMPS.slice(1)) B.add(L.bone, 'core', L.c);
  B.add('head1', 'lumpA', HEAD1.p(0, 0.03, 0));
  B.add('jaw1', 'head1', HEAD1.p(0, 0.13, -0.13));
  B.add('head2', 'lumpC', HEAD2.p(0, 0.2, 0));
  B.add('head3', 'core', HEAD3.p(0, 0.15, 0));
  B.add('jaw3', 'head3', HEAD3.p(0, 0.1, -0.12));
  B.add('face4', 'lumpB', [0.4, 0.78, -0.24]);
  B.add('face5', 'lumpD', [-0.05, 1.02, 0.42]);
  B.add('tank', 'lumpD', [0.28, 1.0, 0.28]);
  for (const k of Object.keys(LIMBS)) {
    const [kind, a, m, e, par] = LIMBS[k];
    B.add('u' + k, par, a); B.add('l' + k, 'u' + k, m); B.add('e' + k, 'l' + k, e);
    if (kind === 'arm') { const gj = gloveJoints(MGF(k), e[0] < 0 ? -1 : 1, MF(k)); gj.bases.forEach((p, i) => B.add(`f${k}${i}`, 'e' + k, p)); }
  }
  return B;
}

export function template() {
  const B = bones();
  const names = B.names;
  const body = new Sculpt(names), head = new Sculpt(names), hands = new Sculpt(names), feet = new Sculpt(names);
  body.maxFoldFreq = 75; feet.maxFoldFreq = 120;
  const rng = new RNG(5151);
  const suitB = 0xb8961e;
  const matOf = (m) => (m === 'skin' ? { mat: MAT.SKIN, col: PAL.burlapDark, thin: 0.35, dirt: 0.6 } : { mat: MAT.SUIT, col: m === 'suitB' ? suitB : PAL.suit, dirt: 0.5 });
  // ------------------------------------------------------------------ melted lumps
  LUMPS.forEach((L, i) => body.ell(L.c, L.r, L.e, { bone: L.bone, k: i ? 0.12 : 0.1, noise: [0.022, 4.2, i * 3.1], ...matOf(L.mat), ms: 2.5 }));
  // secondary sagging lobes: flesh/fabric pooling and drooping over each other
  for (let i = 0; i < 7; i++) { const a = i * 0.9 + 0.4; body.ell([Math.cos(a) * 0.42, 0.18 + (i % 3) * 0.12, Math.sin(a) * 0.38], [0.16, 0.11, 0.14], [rng.range(-0.5, 0.5), a, rng.range(-0.4, 0.4)], { bone: 'core', k: 0.09, noise: [0.015, 6, i], ...matOf(i % 3 ? 'suit' : 'skin'), ms: 2.5 }); }
  // sagging folds of flesh/fabric where the bodies run together
  for (let i = 0; i < 9; i++) {
    const a = rng.next() * TAU, y = rng.range(0.2, 0.9), rr = 0.45 - Math.abs(y - 0.5) * 0.3;
    body.fold([Math.cos(a) * rr, y, Math.sin(a) * rr], rng.range(0.12, 0.2), [rng.range(-0.3, 0.3), 1, rng.range(-0.3, 0.3)], rng.range(70, 120), rng.range(0.005, 0.009), { warp: 0.9 });
  }
  for (const k of Object.keys(LIMBS)) { const [kind, a, m] = LIMBS[k]; if (kind !== 'bare') limbFolds(body, a, m, 0.07, { seed: k.length * 13 + k.charCodeAt(1), amp: 1.1 }); }
  torsoFolds(body, [0, 0.55, 0], [0.5, 0.35, 0.45], 14, { seed: 31, amp: 1.2 });
  // limbs
  for (const k of Object.keys(LIMBS)) {
    const [kind, a, m, e] = LIMBS[k];
    if (kind === 'arm') {
      const end = [lerp(m[0], e[0], 0.6), lerp(m[1], e[1], 0.6), lerp(m[2], e[2], 0.6)];
      body.chain([a, m, end], [0.072, 0.058, 0.052], { bones: ['u' + k, 'l' + k], mat: MAT.SUIT, col: k === 'aUp' ? suitB : PAL.suit, dirt: 0.5, k: 0.06, noise: [0.003, 12] });
      body.fold(m, 0.08, sub3(m, a), 140, 0.0045, { warp: 0.8 });
    } else if (kind === 'bare') {
      body.chain([a, m, [e[0], e[1] + 0.05, e[2]]], [0.05, 0.036, 0.03], { bones: ['u' + k, 'l' + k], mat: MAT.SKIN, col: PAL.burlapDark, thin: 0.6, dirt: 0.6, k: 0.05 });
      servoJoints(body, a, m, 0.045, 2, { bone: 'u' + k });
      servoJoints(body, m, e, 0.034, 2, { bone: 'l' + k, jitter: 0.3 });
    } else {
      const end = [lerp(m[0], e[0], 0.8), lerp(m[1], e[1], 0.8), lerp(m[2], e[2], 0.8)];
      body.chain([a, m, end], [0.085, 0.068, 0.062], { bones: ['u' + k, 'l' + k], mat: MAT.SUIT, col: PAL.suit, dirt: 0.5, k: 0.07 });
      body.fold(m, 0.09, sub3(m, a), 130, 0.005, { warp: 0.8 });
    }
  }
  // hood around the top head + collar flowing into the heap
  const H1 = { w: 0.2, h: 0.46, d: 0.18 };
  hood(body, { ...H1, F: HEAD1 }, { bone: 'head1', drapeBone: 'lumpA', thick: 0.022, openY: 0.46, openW: 0.88, openH: 0.42, gathers: 15 });
  // ------------------------------------------------------------------ heads
  const Hd1 = sackHead(head, HEAD1, { ...H1, bone: 'head1', neckLen: 0.06, dirt: 0.4 });
  head.ell(HEAD1.p(0, 0.11, -0.1), [0.08, 0.08, 0.07], HEAD1.q, { bone: 'jaw1', mat: MAT.SKIN, col: PAL.burlap, k: 0.05 });
  // face 2 (upside down, sideways out of the left lump): part of the body piece, smaller
  const Hd2 = sackHead(body, HEAD2, { w: 0.15, h: 0.34, d: 0.13, bone: 'head2', neck: false, col: PAL.burlapDark, dirt: 0.55, thin: 0.25 });
  // face 3 (half sunk into the floor-level mass, mouth open)
  const Hd3 = sackHead(body, HEAD3, { w: 0.17, h: 0.4, d: 0.15, bone: 'head3', neck: false, col: PAL.burlap, dirt: 0.7, thin: 0.3 });
  body.prepare();
  const m3 = hit(body, HEAD3.p(0, 0.13, -0.3), HEAD3.d(0, 0, 1), 0.4);
  if (m3) body.ell(m3.p, [0.035, 0.03, 0.03], HEAD3.q, { sub: true, k: 0.01, mat: MAT.INNER, col: PAL.inner, wet: 0.95, bone: 'jaw3', noise: [0.004, 40] });
  // ------------------------------------------------------------------ hands / feet
  for (const k of Object.keys(LIMBS)) {
    const [kind, a, m, e] = LIMBS[k];
    const side = e[0] < 0 ? -1 : 1;
    const dir = sub3(m, e);
    if (kind === 'arm') {
      glove(hands, MGF(k), side, {
        bone: 'e' + k, cuffBone: 'l' + k, cuffDir: dir,
        fingers: MF(k).map((f, i) => ({ ...f, r: 0.0118, bones: [`f${k}${i}`] })),
        thumb: { len: 0.045, bones: ['e' + k] },
      });
    } else if (kind === 'bare') {
      const F = new Frame(e, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...norm3(dir))));
      hands.push({ mat: MAT.SKIN, col: PAL.burlapDark, bone: 'e' + k, k: 0.02, thin: 0.35, dirt: 0.65, noise: [0.0025, 30] });
      hands.cone(add3(F.p(0, -0.01, 0), norm3(dir), 0.08), F.p(0, -0.01, 0), 0.028, 0.032, { bone: 'l' + k, bone2: 'e' + k });
      hands.ell(F.p(0, -0.05, 0), [0.022, 0.048, 0.04], F.q, { k: 0.02 });
      for (let i = 0; i < 3; i++) hands.chain([F.p(0, -0.085, -0.025 + i * 0.025), F.p(side * 0.01, -0.14, -0.03 + i * 0.03), F.p(side * 0.025, -0.18, -0.03 + i * 0.03)], [0.012, 0.011, 0.009], { k: 0.008 });
      hands.pop();
    } else {
      const F = k === 'lAir' ? new Frame(e, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...norm3(dir)))) : Frame.e(e, [0, PI + 0.4, 0]);
      boot(feet, F, { bone: 'e' + k, shinBone: 'l' + k, shaftDir: k === 'lAir' ? null : dir, shaft: 0.12 });
    }
  }
  body.prepare(); head.prepare(); hands.prepare(); feet.prepare();
  const parts = new PartSet(names, body), cloth = new ClothSet(names, body);
  // ------------------------------------------------------------------ faces
  face(head, parts, Hd1, {
    bone: 'head1',
    eyes: [{ x: -0.085, y: 0.3, r: 0.021 }, { x: 0.09, y: 0.3, r: 0.019 }, { x: -0.02, y: 0.37, r: 0.013, browY: 0.04 }],
    noses: [{ x: -0.03, y: 0.215, r: 0.04 }, { x: 0.05, y: 0.2, r: 0.03, col: PAL.noseDirty }],
    mouth: { x: 0.0, y: 0.13, w: 0.06, kind: 'stitch' },
  });
  headSeams(head, parts, Hd1, { bone: 'head1', sides: [-1] });
  face(body, parts, Hd2, { bone: 'head2', eyes: [{ x: -0.06, y: 0.22, r: 0.017 }, { x: 0.06, y: 0.22, r: 0.017 }], noses: [{ x: 0, y: 0.16, r: 0.032 }], mouth: { x: 0, y: 0.095, w: 0.045, kind: 'stitch' } });
  face(body, parts, Hd3, { bone: 'head3', eyes: [{ x: -0.07, y: 0.25, r: 0.019 }, { x: 0.065, y: 0.255, r: 0.017 }], noses: [{ x: 0, y: 0.19, r: 0.036 }] });
  // little faces surfacing in the lumps: just beads, a nose, a stitched mouth
  const mini = (p, n, up, sc, bone, nNose = 1) => {
    const t = norm3(cross3(up, n)), u2 = cross3(n, t);
    const at = (x, y) => onSurf(body, add3(add3(add3(p, t, x * sc), u2, y * sc), n, 0.02));
    for (const x of [-0.05, 0.05]) { const q = at(x, 0.035); bead(body, parts, q.p, q.n, 0.015 * sc, { bone, ws: body }); }
    for (let i = 0; i < nNose; i++) { const q = at(0.012 * i, -0.005 - i * 0.04); body.sphere(add3(q.p, q.n, 0.02 * sc * 0.55), 0.028 * sc, { mat: MAT.FLUFF, col: i ? PAL.noseDirty : PAL.nose, bone, k: 0.01, ms: 3 }); }
    const mp = [at(-0.03, -0.055), at(0, -0.06), at(0.03, -0.055)];
    crossStitch(parts, mp, { ws: body, bone, size: 0.012 * sc, step: 1 });
    body.bulge(at(0, 0).p, [0.09 * sc, 0.1 * sc, 0.06 * sc], 0.012, null, {});
  };
  { const q = onSurf(body, [0.42, 0.8, -0.3]); mini(q.p, q.n, [0, 1, 0], 1.0, 'face4', 2); }
  { const q = onSurf(body, [-0.06, 1.08, 0.45]); mini(q.p, q.n, [0, 0.3, 1], 0.8, 'face5'); }
  { const q = onSurf(body, [-0.48, 0.3, 0.2]); mini(q.p, q.n, [0, 1, 0], 0.7, 'core'); }
  // stray bead eyes where no face is
  for (const p of [[0.1, 0.58, -0.4], [0.14, 0.62, -0.38], [-0.2, 0.95, -0.15], [0.45, 0.45, 0.1], [-0.42, 0.62, 0.32], [0.0, 0.42, -0.5]]) {
    const q = onSurf(body, p); bead(body, parts, q.p, q.n, rng.range(0.012, 0.02), { ws: body });
  }
  // ------------------------------------------------------------------ split seams with stuffing, scars, scraps
  const T = (p, o) => { const q = onSurf(body, p); return tear(body, parts, cloth, q.p, q.n, o.size, o); };
  T([0.05, 0.72, -0.34], { size: 0.08, seed: 101, angle: 0.4, stuff: 4, aspect: 0.4 });
  T([-0.38, 0.45, -0.15], { size: 0.07, seed: 102, angle: 1.2, stuff: 3 });
  T([0.4, 0.55, 0.0], { size: 0.06, seed: 103, angle: 0.8, stuff: 3, flap: false });
  T([-0.15, 0.95, 0.3], { size: 0.065, seed: 104, angle: 2.0, stuff: 3 });
  T([0.2, 0.25, -0.42], { size: 0.06, seed: 105, angle: 0.1, stuff: 2 });
  T([-0.45, 0.25, -0.25], { size: 0.07, seed: 106, angle: 0.9, stuff: 4, flap: false });
  T([0.5, 0.3, -0.2], { size: 0.065, seed: 107, angle: 1.6, stuff: 3 });
  T([0.0, 1.0, 0.1], { size: 0.06, seed: 108, angle: 0.3, stuff: 3, flap: false });
  for (const [a, b2] of [[[-0.2, 0.75, -0.25], [0.15, 0.55, -0.42]], [[-0.45, 0.35, 0.0], [-0.3, 0.6, 0.3]], [[0.25, 0.9, 0.05], [0.45, 0.6, -0.05]]]) {
    scar(body, parts, surfPath(body, a, b2, 12, [0, 0.03, 0]), { size: 0.022, width: 0.008, depth: 0.006, step: 1 });
  }
  // everything weeps: drool from the open mouths, rust from the seams
  if (m3) drip(body, m3.p, { n: 4, len: 0.14, w: 0.01, col: 0x22120a, wet: 0.9, seed: 41 });
  for (const p of [[0.05, 0.7, -0.36], [-0.38, 0.42, -0.17], [-0.15, 0.92, 0.32], [0.4, 0.52, 0.02], [0.15, 0.95, -0.2]]) drip(body, onSurf(body, p).p, { n: 3, len: 0.2, w: 0.013, col: 0x3a1c0f, wet: 0.6, seed: Math.round(p[0] * 100 + 50) });
  for (const [p, up, sd] of [[[0.2, 0.75, -0.3], [0.2, 1, 0], 1], [[-0.35, 0.6, -0.2], [-0.3, 1, 0], 2], [[0.1, 0.4, -0.45], [0, 1, 0], 3], [[-0.3, 0.9, 0.25], [0, 1, 0], 4]]) { const q = onSurf(body, p); handprint(body, q.p, q.n, up, { seed: sd }); }
  // embedded badges, tank, hose loops
  { const q = onSurf(body, [-0.2, 0.62, -0.32]); badge(parts, q.p, q.n, [0.3, 1, 0], 0, { bone: 'lumpA', spin: 0.5 }); }
  { const q = onSurf(body, [0.3, 0.45, -0.38]); badge(parts, q.p, q.n, [0, 1, 0], 1, { bone: 'core', spin: 2.6 }); }
  { const q = onSurf(body, [-0.42, 0.85, 0.05]); badge(parts, q.p, q.n, [0, 0, 1], 2, { bone: 'lumpC', spin: -1.2 }); }
  const tk = airTank(parts, Frame.e([0.3, 1.0, 0.3], [0.7, 0.3, -0.5]), { bone: 'tank', len: 0.38, r: 0.072, dents: 6, seed: 44 });
  hose(parts, [tk.top, add3(tk.top, [0.05, 0.05, 0]), [0.4, 1.1, 0.0], [0.3, 0.98, -0.25], HEAD1.p(0.15, 0.1, 0.05)], { bone: 'tank', ws: body });
  // tape bands and loose suit rags
  for (const k of ['aFL', 'aFR', 'aBack', 'aUp']) { const d = sub3(LIMBS[k][2], LIMBS[k][3]); tape(parts, hands, cuffCenter(MGF(k), d), d, { wraps: 2, width: 0.03, seed: k.length * 3, reach: 0.09 }); }
  for (let i = 0; i < 6; i++) { const a = i * 1.1; const q = onSurf(body, [Math.cos(a) * 0.5, 0.35, Math.sin(a) * 0.45]); rag(cloth, body, q.p, q.n, 0.045, 0.08 + (i % 3) * 0.05, { seed: 120 + i, out: 0.4, bone: 'core', taper: 0.6, dirt: 0.7 }); }

  const { geo, stats } = assembleBody([
    { S: body, h: 0.017, tris: 14000 }, { S: head, h: 0.009, tris: 5500 }, { S: hands, h: 0.0072, tris: 5000 }, { S: feet, h: 0.012, tris: 2000 },
  ], { floor: 1.0, stains: 1.0, fade: 0.7, seed: 23, wetStains: 0.8 });
  return {
    spec: B, body: geo, parts: parts.build(), cloth: cloth.build(),
    bounds: new THREE.Sphere(new THREE.Vector3(0, 0.65, 0), 1.35),
    height: 1.45, radius: 0.55, stats, meta: {},
  };
}

// ============================================================================
export function animator(inst, tpl, seed) {
  const b = inst.byName, rest = inst.rest, bones = inst.bones;
  const rng = new RNG(seed * 3571 + 41);
  const lumps = LUMPS.slice(1).map((L, i) => ({ bone: b[L.bone], f: rng.range(0.4, 1.1), ph: rng.next() * TAU, amp: rng.range(0.03, 0.07), sp: new Spring(30, 3) }));
  const legs = new Planter(rng, [
    { rest: new THREE.Vector3(...LIMBS.aFL[3]).setY(0), group: 0, lift: 0.14, dur: 0.45, k: 'aFL' },
    { rest: new THREE.Vector3(...LIMBS.aFR[3]).setY(0), group: 1, lift: 0.14, dur: 0.45, k: 'aFR' },
    { rest: new THREE.Vector3(...LIMBS.lBack[3]).setY(0), group: 2, lift: 0.08, dur: 0.4, k: 'lBack' },
  ], { lead: 0.25, stride: 0.3, overshoot: 0.7, jitter: 0.5 });
  const gaze = new Saccade(rng, { lo: 0.4, hi: 2.4, k: 700, d: 24, err: 0.2, over: 0.35, maxYaw: 1.4 });
  const st = {
    t: rng.next() * 30, prevAtk: 0, atkT: 9, frozenT: 0, heave: new Spring(40, 4), slump: new Spring(25, 3),
    upArm: new Spring(10, 1.2), sideArm: new Spring(18, 2), kick: new Spring(12, 1.5), twitchHold: new Hold(rng, 0.8, 3), tw: 0, twB: null,
    jawHold: new Hold(rng, 1, 4), jaw1: 0, jaw3: 0, j1: new Spring(50, 5), j3: new Spring(30, 3), roll: new Spring(30, 4),
    faces: [new Saccade(rng, { lo: 0.3, hi: 2, err: 0.8, maxYaw: 0.5 }), new Saccade(rng, { lo: 0.3, hi: 2, err: 0.8, maxYaw: 0.5 })],
  };
  const v = new THREE.Vector3(), tgt = new THREE.Vector3(), q = new THREE.Quaternion(), toT = new THREE.Vector3(), UPV = new THREE.Vector3(0, 1, 0);
  const reset = () => { for (let i = 0; i < bones.length; i++) { bones[i].position.copy(rest[i]); bones[i].quaternion.identity(); bones[i].scale.set(1, 1, 1); } };
  function update(dt, s) {
    dt = clamp(dt || 0, 0, 0.1);
    const frozen = !!s.frozen, alert = clamp(s.alert ?? 0.3, 0, 1), atkIn = clamp(s.attacking || 0, 0, 1);
    if (atkIn > st.prevAtk + 0.25) st.atkT = 0;
    st.prevAtk = atkIn;
    const tdt = frozen ? 0 : dt;
    st.t += tdt; st.atkT += tdt; st.frozenT = frozen ? st.frozenT + dt : 0;
    inst.root.updateWorldMatrix(true, false);
    reset();
    const strike = st.atkT < 1.5 ? Math.exp(-st.atkT * 2.4) * (1 - Math.exp(-st.atkT * 16)) : 0;
    // locomotion: the front arms reach, plant and drag the heap; the back leg shoves
    const L = frozen ? legs.legs : legs.update(tdt, inst.root, 0.8 + (s.speed || 0) * 0.4);
    let pull = 0;
    for (const l of L) if (l.t < 1) pull += Math.sin(l.t * PI);
    const heave = st.heave.step(tdt, pull * 0.06 + Math.sin(st.t * 1.4) * 0.015 + strike * 0.1);
    const rl = st.roll.step(tdt, (L[0].t < 1 ? 1 : 0) * 0.05 - (L[1].t < 1 ? 1 : 0) * 0.05);
    b.core.position.y += heave * 0.4;
    rot(b.core, -heave * 0.5, 0, rl);
    for (const l of L) {
      const k = l.k;
      tgt.copy(l.cur); tgt.y += k === 'lBack' ? 0.1 : 0.05;
      if (k !== 'lBack' && strike > 0.02 && s.lookTarget) tgt.lerp(v.copy(s.lookTarget).setY(0.6 + (k === 'aFL' ? 0.1 : 0)), strike * 0.9);
      parentLocal(b['u' + k], tgt, v);
      ik2(b['u' + k], b['l' + k], b['e' + k], v, UPV, UPV);
      inst.root.getWorldQuaternion(q); setWorldQuat(b['e' + k], q);
    }
    // lumps breathe out of step, one swelling while another sinks
    for (const lp of lumps) {
      const x = lp.sp.step(tdt, Math.sin(st.t * lp.f + lp.ph) * lp.amp + (alert > 0.5 ? Math.max(0, Math.sin(st.t * lp.f * 3.1 + lp.ph)) * 0.03 : 0));
      lp.bone.scale.set(1 + x, 1 - x * 0.5, 1 + x);
    }
    // the reaching arm, the side arm, the kicking leg
    const up = st.upArm.step(tdt, Math.sin(st.t * 0.5) * 0.4 + strike * 1.2);
    rot(b.uaUp, up * 0.6, Math.sin(st.t * 0.3) * 0.3, Math.sin(st.t * 0.41) * 0.3);
    rot(b.laUp, -0.2 + Math.sin(st.t * 0.7 + 1) * 0.4, 0, 0);
    rot(b.eaUp, Math.sin(st.t * 1.3) * 0.3, 0, 0);
    const sa = st.sideArm.step(tdt, Math.sin(st.t * 0.8 + 2) * 0.25 + strike * 0.8);
    rot(b.uaSide, sa, 0, -sa * 0.5); rot(b.laSide, sa * 0.6, 0, 0);
    rot(b.uaBack, Math.sin(st.t * 0.6) * 0.2, 0, Math.sin(st.t * 0.45) * 0.2);
    const kk = st.kick.step(tdt, Math.sin(st.t * 0.9) * 0.5);
    rot(b.ulAir, kk * 0.4, 0, 0); rot(b.llAir, -0.3 + kk * 0.6, 0, 0); rot(b.elAir, kk * 0.5, 0, 0);
    for (const k of ['aFL', 'aFR', 'aUp', 'aBack']) for (let i = 0; i < 4; i++) {
      const c = 0.35 + Math.sin(st.t * (k === 'aUp' ? 2.3 : 1.1) + i * 0.9) * (k === 'aUp' ? 0.4 : 0.15) - strike * 0.5 + tremor(st.t + st.frozenT, i * 3 + k.length, 9) * (frozen ? 0.01 : 0.03);
      rotAxis(b[`f${k}${i}`], MGF(k).d(0, 0, 1), -(LIMBS[k][3][0] < 0 ? -1 : 1) * c);
    }
    // faces: the top head watches; the others twitch and roll their own way
    let wy = 0, wp = 0;
    if (s.lookTarget) {
      b.head1.updateWorldMatrix(true, false);
      toT.copy(s.lookTarget); b.head1.parent.worldToLocal(toT); toT.sub(b.head1.position);
      wy = Math.atan2(-toT.x, -toT.z); wp = Math.atan2(toT.y - 0.3, Math.hypot(toT.x, toT.z));
    }
    const g = frozen ? { yaw: gaze.y.x, pitch: gaze.p.x, roll: gaze.r.x } : gaze.update(tdt, wy, wp, 0.5 + alert * 2, 0.3);
    rot(b.head1, g.pitch * 0.6 - strike * 0.3, g.yaw * 0.7, g.roll, 'YXZ');
    const f2 = frozen ? { yaw: 0, pitch: 0, roll: 0 } : st.faces[0].update(tdt, 0, 0, 1 + alert, 0.4);
    const f3 = frozen ? { yaw: 0, pitch: 0, roll: 0 } : st.faces[1].update(tdt, 0, 0, 1 + alert, 0.3);
    rot(b.head2, f2.pitch * 0.5, f2.yaw * 0.6, f2.roll);
    rot(b.head3, f3.pitch * 0.4, f3.yaw * 0.5, f3.roll * 0.6);
    if (!frozen && st.jawHold.step(tdt, 1 + alert)) { st.jaw1 = rng.next() < 0.4 ? rng.range(0.2, 0.7) : 0; st.jaw3 = rng.range(0.1, 1); }
    const j1 = st.j1.step(tdt, st.jaw1 + strike), j3 = st.j3.step(tdt, st.jaw3 + strike * 0.8);
    b.jaw1.scale.set(1, 1 + j1 * 0.3, 1); b.jaw3.scale.set(1 + j3 * 0.15, 1 + j3 * 0.5, 1);
    b.face4.scale.setScalar(1 + Math.max(0, Math.sin(st.t * 1.7)) * 0.08); b.face5.scale.setScalar(1 + Math.max(0, Math.sin(st.t * 1.3 + 2)) * 0.1);
    if (!frozen && st.twitchHold.step(tdt, 0.8 + alert * 2)) { st.tw = 1; st.twB = rng.pick(['head2', 'head3', 'uaSide', 'uaUp', 'lumpC', 'face4']); }
    st.tw = Math.max(0, st.tw - tdt * 7);
    if (st.twB && st.tw > 0) addRot(b[st.twB], st.tw * 0.2, -st.tw * 0.15, st.tw * 0.1);
    rot(b.tank, heave * 0.5, 0, Math.sin(st.t * 0.9) * 0.05);
  }
  return { update };
}
