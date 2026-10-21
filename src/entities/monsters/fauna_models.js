// Low-poly "realistic" procedural fauna: faceted (flat-shaded), jittered primitives with baked vertex colour,
// rigidly skinned to a small skeleton -> ONE SkinnedMesh (1-2 draw calls) per creature; the geometry and
// materials are built once per species and shared. Models face -Z, feet at y = 0.
//   buildFauna(type, seed) -> { root, update(dt, st), height, radius, dispose() }
//   type: 'mole' | 'moth' | 'dcrawler' | 'fungal'
//   st: { speed, state, attackT, look (Vector3|null), intensity, dead, hurt }
import * as THREE from 'three';
import { CritterGeo, makeSkinned, surfaceMaterial } from '../critters/kit.js';

const TAU = Math.PI * 2;
const hash = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);

// ----------------------------------------------------------------------------- geometry kit
// transform + organic jitter (by rounded position: shared seam vertices move together), then facet it
function prep(g, o = {}) {
  if (o.s) g.scale(...(Array.isArray(o.s) ? o.s : [o.s, o.s, o.s]));
  if (o.q) g.applyQuaternion(o.q);
  else if (o.r) g.applyQuaternion(_q.setFromEuler(new THREE.Euler(...o.r)));
  if (o.p) g.translate(...o.p);
  const j = o.j || 0;
  if (j) {
    const P = g.attributes.position, seed = o.seed || 1;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      const kx = Math.round(x * 400), ky = Math.round(y * 400), kz = Math.round(z * 400);
      P.setXYZ(i, x + (hash(kx, ky, kz + seed) - 0.5) * j, y + (hash(ky, kz, kx + seed) - 0.5) * j, z + (hash(kz, kx, ky + seed) - 0.5) * j);
    }
  }
  const n = g.index ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  n.computeVertexNormals();
  return n;
}
const ell = (rx, ry, rz, ws = 8, hs = 6) => new THREE.SphereGeometry(1, ws, hs).scale(rx, ry, rz);
// tapered rod from a to b
function rod(a, b, r0, r1, seg = 5) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(_q.setFromUnitVectors(UP, _v.subVectors(B, A).normalize()));
  g.translate(A.x, A.y, A.z);
  return g;
}
const cone = (a, b, r, seg = 4) => rod(a, b, r, 0.0005, seg);

class Rig {
  constructor(slots = 1) { this.G = new CritterGeo(slots); this.spec = []; this.idx = {}; }
  bone(name, parent, pos) { this.idx[name] = this.spec.length; this.spec.push({ name, parent, pos }); return this; }
  // col: [r,g,b] (sRGB 0..1) or fn(p) -> [r,g,b]; surf: [rough, clearcoat, sheen, nrm]
  add(geo, bone, col, o = {}) {
    const g = prep(geo, o);
    const b = this.idx[bone];
    this.G.add(g, o.slot || 0, typeof col === 'function' ? (p) => col(p) : col, b, o.surf || [0.85, 0, 0.3, 0]);
    return this;
  }
  build() { return { geo: this.G.build(), spec: this.spec }; }
}

// mottled colour helpers
const mott = (base, alt, k = 0.5, f = 20, seed = 1) => (p) => {
  const h = hash(Math.floor(p.x * f), Math.floor(p.y * f), Math.floor(p.z * f) + seed);
  const t = h < k ? h / k * 0.35 : 1;
  return [lerp(alt[0], base[0], t), lerp(alt[1], base[1], t), lerp(alt[2], base[2], t)];
};

// ============================================================================ MOLE
function moleTemplate() {
  const R = new Rig(1);
  R.bone('root', null, [0, 0, 0]).bone('body', 'root', [0, 0.1, 0.02]).bone('head', 'body', [0, 0.1, -0.13])
    .bone('fl', 'body', [-0.085, 0.07, -0.09]).bone('fr', 'body', [0.085, 0.07, -0.09])
    .bone('bl', 'body', [-0.07, 0.06, 0.11]).bone('br', 'body', [0.07, 0.06, 0.11])
    .bone('tail', 'body', [0, 0.08, 0.19]).bone('hump', 'root', [0, 0, 0]);
  const fur = [0.2, 0.17, 0.15], furHi = [0.36, 0.31, 0.27], skin = [0.78, 0.5, 0.48], claw = [0.86, 0.8, 0.66];
  // body: dark fur with pale mange patches of raw pink skin
  R.add(ell(0.105, 0.085, 0.17, 9, 7), 'body', (p) => {
    const h = hash(Math.floor(p.x * 18), Math.floor(p.y * 18), Math.floor(p.z * 18));
    if (h < 0.14 && p.y > 0.12) return skin;
    if (p.y < 0.06) return furHi;
    return h < 0.5 ? fur : [0.25, 0.21, 0.18];
  }, { p: [0, 0.1, 0.02], j: 0.018, surf: [0.95, 0, 0.6, 0] });
  // shoulders hump + neck
  R.add(ell(0.085, 0.07, 0.07, 7, 5), 'body', fur, { p: [0, 0.13, -0.08], j: 0.012, surf: [0.95, 0, 0.6, 0] });
  // head: blunt wedge
  R.add(ell(0.062, 0.055, 0.085, 8, 6), 'head', fur, { p: [0, 0.1, -0.18], j: 0.01, surf: [0.95, 0, 0.6, 0] });
  // star nose: ring of fleshy pink feelers (mutated: too many, some split)
  const nc = [0, 0.095, -0.262];
  R.add(ell(0.022, 0.022, 0.02, 6, 4), 'head', skin, { p: nc, surf: [0.4, 0.8, 0, 0] });
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * TAU, len = 0.028 + hash(i, 3, 7) * 0.02;
    const b = [nc[0] + Math.cos(a) * 0.03, nc[1] + Math.sin(a) * 0.03, nc[2] - len];
    R.add(cone([nc[0] + Math.cos(a) * 0.012, nc[1] + Math.sin(a) * 0.012, nc[2]], b, 0.007, 4), 'head', [0.86, 0.48, 0.5], { surf: [0.35, 0.9, 0, 0] });
  }
  // eyes: three milky pin eyes (one too many)
  for (const [x, y, z] of [[-0.04, 0.12, -0.21], [0.04, 0.12, -0.21], [0.025, 0.135, -0.19]]) R.add(ell(0.008, 0.008, 0.008, 5, 4), 'head', [0.8, 0.82, 0.74], { p: [x, y, z], surf: [0.1, 1, 0, 0] });
  // front spade paws with long pale claws
  for (const s of [-1, 1]) {
    const bone = s < 0 ? 'fl' : 'fr', bx = s * 0.1;
    R.add(new THREE.BoxGeometry(0.06, 0.022, 0.055), bone, skin, { p: [bx, 0.022, -0.11], r: [0.2, 0, s * 0.5], j: 0.008, surf: [0.6, 0.3, 0, 0] });
    R.add(rod([s * 0.075, 0.08, -0.09], [bx, 0.03, -0.11], 0.024, 0.018, 5), bone, fur, { surf: [0.95, 0, 0.6, 0] });
    for (let k = 0; k < 5; k++) {
      const ox = bx + s * 0.012 + (k - 2) * 0.011;
      R.add(cone([ox, 0.02, -0.13], [ox + s * 0.012, 0.004, -0.17 - hash(k, s, 2) * 0.012], 0.0055, 4), bone, claw, { surf: [0.3, 0.6, 0, 0] });
    }
  }
  for (const s of [-1, 1]) R.add(ell(0.028, 0.02, 0.035, 6, 4), s < 0 ? 'bl' : 'br', skin, { p: [s * 0.075, 0.02, 0.12], j: 0.006, surf: [0.6, 0.3, 0, 0] });
  R.add(cone([0, 0.08, 0.18], [0, 0.06, 0.27], 0.012, 5), 'tail', skin, { surf: [0.5, 0.5, 0, 0] });
  // carpet hump (shown while it tunnels): mustard carpet + dark crumbs
  R.add(ell(0.17, 0.075, 0.26, 9, 5), 'hump', mott([0.55, 0.47, 0.25], [0.35, 0.29, 0.15], 0.3, 14, 4), { p: [0, 0, 0], j: 0.03, surf: [1, 0, 0.5, 0] });
  const { geo, spec } = R.build();
  return { geo, spec, mats: [surfaceMaterial('fauna_mole', { sheenColor: new THREE.Color(0x9a8a7a) })], height: 0.24, radius: 0.18 };
}

function moleAnim(B, s, dt, st) {
  s.t += dt;
  const sp = st.speed || 0, mode = st.state;
  s.ph += dt * (4 + sp * 9);
  const burrow = mode === 'burrow' && !st.dead;
  const dig = mode === 'dig' || mode === 'surface';
  s.bur = lerp(s.bur, burrow ? 1 : 0, Math.min(1, dt * 6));
  const vis = 1 - s.bur;
  B.body.scale.setScalar(Math.max(0.001, vis));
  B.hump.scale.set(Math.max(0.001, s.bur), Math.max(0.001, s.bur * (1 + Math.sin(s.t * 18) * 0.12)), Math.max(0.001, s.bur));
  B.hump.position.y = -0.03 + s.bur * 0.03;
  const amp = Math.min(1, sp / 1.5);
  if (st.dead) {
    // paws up, curled
    for (const [n, a] of [['fl', 1.2], ['fr', 1.2], ['bl', -1.1], ['br', -1.1]]) B[n].rotation.x = lerp(B[n].rotation.x, a, Math.min(1, dt * 5));
    B.head.rotation.x = lerp(B.head.rotation.x, 0.4, Math.min(1, dt * 3));
    return;
  }
  const rear = mode === 'warn' ? 1 : 0;
  s.rear = lerp(s.rear, rear, Math.min(1, dt * 6));
  B.body.rotation.x = -s.rear * 0.7 + (dig ? 0.35 : 0) + Math.sin(s.ph * 2) * 0.04 * amp;
  B.body.position.y = 0.1 + Math.abs(Math.sin(s.ph)) * 0.012 * amp + s.rear * 0.05;
  const dg = dig ? Math.sin(s.t * 30) * 0.9 : 0;
  B.fl.rotation.x = Math.sin(s.ph) * 0.7 * amp + dg - s.rear * 0.8;
  B.fr.rotation.x = Math.sin(s.ph + Math.PI) * 0.7 * amp - dg - s.rear * 0.8;
  B.bl.rotation.x = Math.sin(s.ph + Math.PI) * 0.6 * amp;
  B.br.rotation.x = Math.sin(s.ph) * 0.6 * amp;
  B.tail.rotation.y = Math.sin(s.t * 3) * 0.3;
  // sniffing head: quick jittery twitches; eating: head bobs down
  if (s.t > s.sniffAt) { s.sniffAt = s.t + 0.15 + Math.random() * 0.5; s.hy = (Math.random() - 0.5) * 0.6; s.hx = (Math.random() - 0.5) * 0.3; }
  const eat = mode === 'eat' ? 0.45 + Math.sin(s.t * 14) * 0.15 : 0;
  B.head.rotation.y = lerp(B.head.rotation.y, s.hy, Math.min(1, dt * 14));
  B.head.rotation.x = lerp(B.head.rotation.x, s.hx + eat - s.rear * 0.4, Math.min(1, dt * 14));
}

// ============================================================================ MOTH
function mothTemplate() {
  const R = new Rig(1);
  R.bone('root', null, [0, 0, 0]).bone('body', 'root', [0, 0, 0]).bone('head', 'body', [0, 0.005, -0.075])
    .bone('wl', 'body', [-0.035, 0.02, -0.03]).bone('wr', 'body', [0.035, 0.02, -0.03])
    .bone('hl', 'body', [-0.03, 0.012, 0.02]).bone('hr', 'body', [0.03, 0.012, 0.02]).bone('abd', 'body', [0, 0, 0.04]);
  const fuzz = [0.84, 0.78, 0.64], dark = [0.32, 0.27, 0.2];
  R.add(ell(0.045, 0.042, 0.06, 7, 5), 'body', fuzz, { j: 0.012, surf: [1, 0, 1, 0] });
  for (let i = 0; i < 4; i++) R.add(ell(0.036 - i * 0.006, 0.032 - i * 0.005, 0.03, 7, 4), 'abd', i % 2 ? fuzz : [0.72, 0.66, 0.52], { p: [0, -0.004 * i, 0.07 + i * 0.035], j: 0.006, surf: [1, 0, 1, 0] });
  R.add(ell(0.03, 0.03, 0.028, 6, 5), 'head', fuzz, { p: [0, 0.005, -0.09], j: 0.006, surf: [1, 0, 1, 0] });
  for (const s of [-1, 1]) {
    R.add(ell(0.017, 0.02, 0.018, 6, 5), 'head', [0.04, 0.04, 0.05], { p: [s * 0.022, 0.01, -0.105], surf: [0.1, 1, 0, 0] });
    // feathered antennae: shaft + barbs
    const a = [s * 0.012, 0.03, -0.11], b = [s * 0.07, 0.09, -0.2];
    R.add(cone(a, b, 0.003, 3), 'head', dark, {});
    for (let k = 1; k < 6; k++) {
      const t = k / 6, p = [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
      R.add(cone(p, [p[0] + s * 0.022, p[1] + 0.006, p[2] + 0.006], 0.0018, 3), 'head', dark, {});
      R.add(cone(p, [p[0] - s * 0.004, p[1] + 0.02, p[2] + 0.006], 0.0018, 3), 'head', dark, {});
    }
  }
  // wings: flat polygons (double sided), mottled with eye spots
  const wingCol = (cx, cz) => (p) => {
    const d = Math.hypot(p.x - cx, p.z - cz);
    if (d < 0.022) return [0.08, 0.07, 0.06];
    if (d < 0.04) return [0.62, 0.5, 0.32];
    const h = hash(Math.floor(p.x * 40), 1, Math.floor(p.z * 40));
    const v = 0.62 + h * 0.2 - Math.abs(p.x) * 0.6;
    return [v, v * 0.93, v * 0.78];
  };
  for (const s of [-1, 1]) {
    const fw = new THREE.Shape();
    fw.moveTo(0, 0); fw.lineTo(0.17, -0.07); fw.lineTo(0.36, -0.03); fw.lineTo(0.33, 0.07); fw.lineTo(0.12, 0.09); fw.lineTo(0, 0.04);
    const g = new THREE.ShapeGeometry(fw, 2);
    g.rotateX(Math.PI / 2);
    if (s < 0) g.scale(-1, 1, 1);
    g.translate(s * 0.035, 0.02, -0.03);
    R.add(g, s < 0 ? 'wl' : 'wr', wingCol(s * 0.24, -0.03), { j: 0.004, surf: [0.9, 0, 0.8, 0] });
    const hw = new THREE.Shape();
    hw.moveTo(0, 0); hw.lineTo(0.12, 0.0); hw.lineTo(0.22, 0.06); hw.lineTo(0.18, 0.16); hw.lineTo(0.06, 0.15); hw.lineTo(0, 0.06);
    const g2 = new THREE.ShapeGeometry(hw, 2);
    g2.rotateX(Math.PI / 2);
    if (s < 0) g2.scale(-1, 1, 1);
    g2.translate(s * 0.03, 0.012, 0.02);
    R.add(g2, s < 0 ? 'hl' : 'hr', wingCol(s * 0.16, 0.1), { j: 0.004, surf: [0.9, 0, 0.8, 0] });
    for (let k = 0; k < 3; k++) R.add(cone([s * 0.02, -0.02, -0.03 + k * 0.03], [s * 0.06, -0.09, -0.05 + k * 0.04], 0.003, 3), 'body', dark, {});
  }
  const { geo, spec } = R.build();
  const m = surfaceMaterial('fauna_moth', { side: THREE.DoubleSide, sheenColor: new THREE.Color(0xfff0d0) });
  return { geo, spec, mats: [m], height: 0.2, radius: 0.3 };
}

function mothAnim(B, s, dt, st) {
  s.t += dt;
  const mode = st.state;
  const landed = mode === 'graze' || st.dead;
  const fast = mode === 'warn' || mode === 'flee' ? 1.6 : 1;
  s.ph += dt * (landed ? 2 : 15 * fast + Math.sin(s.t * 0.7) * 3);
  const flap = st.dead ? -0.1 : landed ? 0.15 + Math.sin(s.ph) * 0.15 : 0.15 + Math.sin(s.ph) * 0.95;
  B.wl.rotation.z = flap; B.wr.rotation.z = -flap;
  B.hl.rotation.z = flap * 0.85; B.hr.rotation.z = -flap * 0.85;
  B.body.rotation.x = st.dead ? 0 : -0.15 + Math.sin(s.ph) * 0.05;
  B.body.position.y = landed ? 0 : -Math.sin(s.ph) * 0.02;
  B.abd.rotation.x = Math.sin(s.t * 2) * 0.1;
  B.head.rotation.y = Math.sin(s.t * 1.3) * 0.2;
}

// ============================================================================ DAMP CRAWLER
const ARMS = [-0.32, -0.12, 0.08, 0.28];
function crawlerTemplate() {
  const R = new Rig(1);
  R.bone('root', null, [0, 0, 0]).bone('torso', 'root', [0, 0.42, 0]).bone('head', 'torso', [0, 0.46, -0.4]).bone('jaw', 'head', [0, 0.42, -0.5]);
  ARMS.forEach((z, i) => {
    for (const s of [-1, 1]) {
      const k = `${s < 0 ? 'l' : 'r'}${i}`;
      R.bone('u' + k, 'torso', [s * 0.26, 0.46, z]).bone('f' + k, 'u' + k, [s * 0.56, 0.6, z * 1.15]);
    }
  });
  const flesh = (p) => {
    const h = hash(Math.floor(p.x * 14), Math.floor(p.y * 14), Math.floor(p.z * 14));
    if (h < 0.14) return [0.42, 0.07, 0.05];                // raw open sores
    if (h < 0.26) return [0.1, 0.11, 0.07];                 // black mould
    if (h < 0.45) return [0.3, 0.28, 0.2];
    return [0.42, 0.39, 0.29];                              // grey-yellow wet skin
  };
  const wet = [0.35, 1, 0.1, 0];
  R.add(ell(0.3, 0.2, 0.42, 10, 7), 'torso', flesh, { p: [0, 0.44, 0], j: 0.07, seed: 3, surf: wet });
  R.add(ell(0.2, 0.16, 0.22, 8, 6), 'torso', flesh, { p: [0.08, 0.56, 0.18], j: 0.05, seed: 5, surf: wet });
  R.add(ell(0.14, 0.12, 0.16, 7, 5), 'torso', flesh, { p: [-0.12, 0.55, -0.16], j: 0.04, seed: 7, surf: wet });
  // ribs showing through on the back
  for (let k = 0; k < 5; k++) R.add(new THREE.TorusGeometry(0.18, 0.012, 3, 8, Math.PI), 'torso', [0.62, 0.56, 0.44], { p: [0, 0.5, -0.2 + k * 0.1], r: [0, Math.PI / 2, 0], s: [1, 0.9, 1], surf: [0.4, 0.5, 0, 0] });
  // head: elongated skull with a vertical split maw, teeth, and a cluster of black eyes
  R.add(ell(0.13, 0.13, 0.18, 8, 6), 'head', flesh, { p: [0, 0.46, -0.5], j: 0.03, seed: 9, surf: wet });
  R.add(ell(0.11, 0.09, 0.14, 7, 5), 'jaw', [0.4, 0.06, 0.05], { p: [0, 0.4, -0.56], j: 0.02, surf: [0.2, 1, 0, 0] });
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI - Math.PI / 2, x = Math.sin(a) * 0.07, y = 0.4 + Math.cos(a) * 0.06;
    R.add(cone([x, y, -0.62], [x * 0.6, y - 0.02, -0.67], 0.01, 3), 'jaw', [0.9, 0.86, 0.7], { surf: [0.3, 0.8, 0, 0] });
  }
  for (let k = 0; k < 7; k++) R.add(ell(0.018, 0.018, 0.018, 5, 4), 'head', [0.02, 0.02, 0.02], { p: [(hash(k, 1, 1) - 0.5) * 0.18, 0.53 + hash(k, 2, 2) * 0.07, -0.6 + hash(k, 3, 3) * 0.08], surf: [0.05, 1, 0, 0] });
  // eight human-ish arms: upper bone from shoulder to elbow, forearm + grasping hand to the floor
  ARMS.forEach((z, i) => {
    for (const s of [-1, 1]) {
      const k = `${s < 0 ? 'l' : 'r'}${i}`, z2 = z * 1.15, z3 = z * 1.3;
      R.add(rod([s * 0.24, 0.46, z], [s * 0.56, 0.6, z2], 0.055, 0.045, 5), 'u' + k, flesh, { j: 0.012, seed: i * 3 + s, surf: wet });
      R.add(ell(0.05, 0.05, 0.05, 5, 4), 'u' + k, flesh, { p: [s * 0.56, 0.6, z2], surf: wet });
      R.add(rod([s * 0.56, 0.6, z2], [s * 0.72, 0.04, z3], 0.042, 0.03, 5), 'f' + k, flesh, { j: 0.01, seed: i * 5 + s, surf: wet });
      R.add(new THREE.BoxGeometry(0.07, 0.025, 0.08), 'f' + k, [0.5, 0.42, 0.34], { p: [s * 0.74, 0.02, z3 - 0.02], j: 0.01, surf: wet });
      for (let f = 0; f < 4; f++) R.add(cone([s * 0.74 + (f - 1.5) * 0.016, 0.02, z3 - 0.06], [s * 0.76 + (f - 1.5) * 0.024, 0.005, z3 - 0.13], 0.008, 3), 'f' + k, [0.5, 0.4, 0.32], { surf: wet });
    }
  });
  const { geo, spec } = R.build();
  return { geo, spec, mats: [surfaceMaterial('fauna_crawler', { sheenColor: new THREE.Color(0x202018), clearcoatRoughness: 0.15 })], height: 0.75, radius: 0.55 };
}

function crawlerAnim(B, s, dt, st) {
  s.t += dt;
  const sp = st.speed || 0, mode = st.state;
  s.ph += dt * (2 + sp * 4.2);
  const amp = Math.min(1, sp / 2.5);
  const atk = st.attackT || 0;
  const grab = mode === 'grab';
  // breathing / twitching torso
  const tw = s.t > s.twAt ? ((s.twAt = s.t + 0.2 + Math.random() * 1.5), (s.tw = (Math.random() - 0.5) * 0.4)) : s.tw;
  s.twv = lerp(s.twv, tw, Math.min(1, dt * 12));
  const br = 1 + Math.sin(s.t * 1.7) * 0.04;
  B.torso.scale.set(br, 1 / br, br);
  B.torso.rotation.z = s.twv * 0.3 + Math.sin(s.ph * 2) * 0.05 * amp;
  B.torso.rotation.x = (grab ? -0.35 : 0) - atk * 0.3;
  B.torso.position.y = 0.42 + Math.abs(Math.sin(s.ph * 2)) * 0.03 * amp - (st.dead ? 0.3 : 0);
  B.head.rotation.y = s.twv * 0.6;
  B.head.rotation.x = -atk * 0.4 + (grab ? Math.sin(s.t * 12) * 0.15 : 0);
  B.jaw.scale.y = 1 + (grab || atk > 0.2 ? 0.5 + Math.sin(s.t * 20) * 0.2 : Math.max(0, Math.sin(s.t * 0.9)) * 0.2);
  ARMS.forEach((z, i) => {
    for (const sd of [-1, 1]) {
      const k = `${sd < 0 ? 'l' : 'r'}${i}`, U = B['u' + k], F = B['f' + k];
      if (st.dead) {
        U.rotation.z = lerp(U.rotation.z, -sd * 0.9, Math.min(1, dt * 4));
        F.rotation.z = lerp(F.rotation.z, sd * 1.4, Math.min(1, dt * 4));
        continue;
      }
      const ph = s.ph + i * 1.6 + (sd < 0 ? 0 : Math.PI);
      const lift = Math.max(0, Math.sin(ph)) * 0.45 * amp + (i < 2 && (grab || atk > 0.1) ? 0.9 : 0);
      U.rotation.z = sd * (lift + (i * 2 + (sd < 0 ? 0 : 1) === s.twLimb ? s.twv : 0));
      U.rotation.y = Math.cos(ph) * 0.35 * amp + (i < 2 && grab ? -sd * 0.5 : 0);
      F.rotation.z = -sd * lift * 0.6 + Math.sin(s.t * 6 + i) * 0.04;
    }
  });
  if (Math.random() < dt) s.twLimb = Math.floor(Math.random() * 8);
}

// ============================================================================ FUNGAL
function fungalTemplate() {
  const R = new Rig(2);
  R.bone('root', null, [0, 0, 0]).bone('hips', 'root', [0, 1.0, 0]).bone('spine', 'hips', [0, 1.3, 0]).bone('chest', 'spine', [0, 1.6, 0]).bone('head', 'chest', [0, 1.88, -0.04])
    .bone('al', 'chest', [-0.26, 1.72, 0]).bone('fal', 'al', [-0.32, 1.24, 0.02]).bone('ar', 'chest', [0.26, 1.72, 0]).bone('far', 'ar', [0.32, 1.24, 0.02])
    .bone('ll', 'hips', [-0.12, 1.0, 0]).bone('sl', 'll', [-0.13, 0.52, 0]).bone('lr', 'hips', [0.12, 1.0, 0]).bone('sr', 'lr', [0.13, 0.52, 0]);
  const blk = (p) => {
    const h = hash(Math.floor(p.x * 9), Math.floor(p.y * 9), Math.floor(p.z * 9));
    return h < 0.15 ? [0.16, 0.15, 0.1] : h < 0.4 ? [0.06, 0.07, 0.05] : [0.035, 0.04, 0.03];
  };
  const goo = [0.12, 1, 0.05, 0];
  let seed = 1;
  // lumpy chain of fungal nodules along a bone segment
  const chain = (bone, a, b, r0, r1, n) => {
    for (let k = 0; k <= n; k++) {
      const t = k / n, r = lerp(r0, r1, t) * (0.8 + hash(seed, k, 3) * 0.5);
      R.add(ell(r, r * (1.1 + hash(seed, k, 5) * 0.4), r, 6, 5), bone, blk, { p: [lerp(a[0], b[0], t) + (hash(seed, k, 9) - 0.5) * r, lerp(a[1], b[1], t), lerp(a[2], b[2], t) + (hash(seed, k, 11) - 0.5) * r], j: r * 0.4, seed: seed++, surf: goo });
    }
  };
  for (const s of [-1, 1]) {
    chain(s < 0 ? 'll' : 'lr', [s * 0.12, 1.0, 0], [s * 0.13, 0.52, 0], 0.09, 0.07, 3);
    chain(s < 0 ? 'sl' : 'sr', [s * 0.13, 0.52, 0], [s * 0.14, 0.05, 0.02], 0.07, 0.06, 3);
    R.add(ell(0.08, 0.04, 0.12, 6, 4), s < 0 ? 'sl' : 'sr', blk, { p: [s * 0.14, 0.03, -0.03], j: 0.03, surf: goo });
    chain(s < 0 ? 'al' : 'ar', [s * 0.26, 1.72, 0], [s * 0.32, 1.24, 0.02], 0.07, 0.055, 3);
    chain(s < 0 ? 'fal' : 'far', [s * 0.32, 1.24, 0.02], [s * 0.36, 0.78, -0.04], 0.055, 0.04, 3);
    // tendril fingers
    for (let f = 0; f < 4; f++) R.add(cone([s * 0.36, 0.8, -0.04], [s * (0.36 + (f - 1.5) * 0.04), 0.58 - hash(f, s, 1) * 0.1, -0.06 + (f - 1.5) * 0.02], 0.016, 4), s < 0 ? 'fal' : 'far', blk, { surf: goo });
  }
  chain('hips', [0, 1.0, 0], [0, 1.25, 0], 0.16, 0.14, 2);
  chain('spine', [0, 1.3, 0], [0, 1.55, 0], 0.15, 0.17, 2);
  chain('chest', [0, 1.6, 0], [0, 1.78, -0.02], 0.2, 0.16, 2);
  for (const s of [-1, 1]) R.add(ell(0.11, 0.09, 0.1, 6, 5), 'chest', blk, { p: [s * 0.2, 1.74, 0.02], j: 0.04, surf: goo });
  // head: stacked bracket shelves (no face at all) + glowing spore pores
  for (let k = 0; k < 5; k++) {
    const g = new THREE.CylinderGeometry(0.16 - k * 0.018, 0.17 - k * 0.018, 0.035, 9, 1, false, 0, Math.PI * 1.2);
    R.add(g, 'head', [0.1 - k * 0.012, 0.09 - k * 0.01, 0.06], { p: [(hash(k, 1, 4) - 0.5) * 0.08, 1.86 + k * 0.07, -0.03], r: [0.2 * (hash(k, 2, 4) - 0.5), k * 1.3, 0.3 * (hash(k, 3, 4) - 0.5)], j: 0.02, surf: goo });
  }
  R.add(ell(0.11, 0.14, 0.1, 7, 6), 'head', blk, { p: [0, 1.9, 0], j: 0.04, surf: goo });
  for (let k = 0; k < 18; k++) {
    const bone = ['chest', 'head', 'spine', 'hips', 'al', 'ar'][k % 6];
    const y = { chest: 1.68, head: 1.95, spine: 1.42, hips: 1.1, al: 1.55, ar: 1.55 }[bone];
    const x = { al: -0.3, ar: 0.3 }[bone] ?? (hash(k, 9, 1) - 0.5) * 0.25;
    R.add(ell(0.014, 0.014, 0.014, 4, 3), bone, [0.8, 1, 0.9], { p: [x, y + (hash(k, 7, 1) - 0.5) * 0.15, -0.12 - hash(k, 8, 1) * 0.05], slot: 1 });
  }
  const { geo, spec } = R.build();
  const glow = new THREE.MeshStandardMaterial({ color: 0x0a120e, emissive: 0x8fffc8, emissiveIntensity: 2.2, roughness: 0.5 });
  glow.userData.noProbe = true;
  return { geo, spec, mats: [surfaceMaterial('fauna_fungal', { sheenColor: new THREE.Color(0x203020) }), glow], height: 2.15, radius: 0.4 };
}

function fungalAnim(B, s, dt, st) {
  s.t += dt;
  const sp = st.speed || 0, mode = st.state;
  s.ph += dt * (1.2 + sp * 2.6);
  const amp = Math.min(1, sp / 1.2);
  const atk = st.attackT || 0;
  const grab = mode === 'grab';
  const lurch = Math.sin(s.ph);
  B.ll.rotation.x = lurch * 0.45 * amp; B.lr.rotation.x = -lurch * 0.45 * amp;
  B.sl.rotation.x = Math.max(0, -lurch) * 0.6 * amp; B.sr.rotation.x = Math.max(0, lurch) * 0.6 * amp;
  B.hips.position.y = 1.0 - Math.abs(lurch) * 0.04 * amp;
  B.hips.rotation.z = lurch * 0.06 * amp;
  B.spine.rotation.x = 0.18 + Math.sin(s.t * 0.8) * 0.04;
  B.chest.rotation.z = Math.sin(s.t * 0.6) * 0.08 - lurch * 0.05 * amp;
  B.head.rotation.z = Math.sin(s.t * 0.37) * 0.35;
  B.head.rotation.x = 0.2 + Math.sin(s.t * 0.5) * 0.1;
  // slam: arms up (0..0.55) then down hard; grab: arms forward, clutching
  const up = atk < 0.55 ? atk / 0.55 : Math.max(0, 1 - (atk - 0.55) / 0.15);
  for (const sd of [-1, 1]) {
    const A = sd < 0 ? B.al : B.ar, F = sd < 0 ? B.fal : B.far;
    const swing = -lurch * sd * 0.25 * amp;
    A.rotation.x = lerp(swing, grab ? -1.4 : -2.6, grab ? 1 : up) + (grab ? Math.sin(s.t * 10 + sd) * 0.1 : 0);
    A.rotation.z = sd * (0.08 + Math.sin(s.t * 0.9 + sd) * 0.05);
    F.rotation.x = grab ? -0.5 : -0.15 - up * 0.3;
  }
  if (st.dead) { B.spine.rotation.x = lerp(B.spine.rotation.x, 0.9, Math.min(1, dt * 3)); }
}

// ----------------------------------------------------------------------------- registry
const SPECIES = {
  mole: { tpl: moleTemplate, anim: moleAnim },
  moth: { tpl: mothTemplate, anim: mothAnim },
  dcrawler: { tpl: crawlerTemplate, anim: crawlerAnim },
  fungal: { tpl: fungalTemplate, anim: fungalAnim },
};
export const FAUNA_TYPES = Object.keys(SPECIES);
const templates = new Map();
function template(type) {
  let t = templates.get(type);
  if (!t) { t = SPECIES[type].tpl(); templates.set(type, t); }
  return t;
}

export function buildFauna(type, seed = 1) {
  const S = SPECIES[type];
  if (!S) return null;
  const T = template(type);
  const { mesh, B } = makeSkinned(T.geo, T.mats, T.spec, T.radius);
  const root = new THREE.Group();
  root.name = 'Fauna_' + type;
  root.add(mesh);
  const sc = 0.92 + (((seed * 9301 + 49297) % 233280) / 233280) * 0.18;
  mesh.scale.setScalar(sc);
  const state = { t: (seed % 97) * 0.1, ph: 0, bur: 0, rear: 0, sniffAt: 0, hx: 0, hy: 0, twAt: 0, tw: 0, twv: 0, twLimb: 0 };
  const update = (dt, st = {}) => S.anim(B, state, dt, st);
  update(0.016, {});
  return { root, mesh, bones: B, update, height: T.height * sc, radius: T.radius * sc, dispose() { mesh.skeleton?.dispose?.(); } };
}

void _m; void _s; void clamp;
