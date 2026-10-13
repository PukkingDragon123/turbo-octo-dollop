// R.O.O.M. — "Still Lifes": discarded sack-doll clones with horribly wrong anatomy.
// Same burlap/felt construction as the player dolls (see avatar.js) but faded, filthy,
// torn open with stuffing showing, with extra bead eyes, duplicated red noses, stitched-shut
// mouths, too many floppy limbs and twisted proportions. Animation is deliberately wrong:
// perfectly still, then jerky snaps, limbs out of sync, heads rotating too far.
//
// buildStillLife(variant, seed) -> { root, update(dt, state), height, radius }
//   state: { speed, moving, attacking 0..1, alert 0..1, lookTarget?: Vector3 (world), frozen }
import * as THREE from 'three';
import { G, Rig, Spring, paint, headGrid, headPt, headNormal, headRphi, headF, surfQ, clothMat, AM, cached, feltTex, clamp, lerp, smooth, damp, THREAD, NOSE, EYE } from './avatar.js';
import { RNG, valueNoise2 } from '../core/rng.js';

const PI = Math.PI, TAU = PI * 2;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _v1 = V3(), _v2 = V3(), _v3 = V3(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m1 = new THREE.Matrix4();
const DOWN = V3(0, -1, 0);

export const STILL_LIFE_VARIANTS = ['watcher', 'crawler', 'twin', 'mass', 'tall'];

const SACK = 0x9a8462;
const FADED = [0xb5a259, 0xbb8758, 0xbf96a0, 0x8296a8, 0x97ab8c, 0x9b9b94];
const C = (hex) => 'c:nylon:' + hex.toString(16).padStart(6, '0');
const stuffMat = () => cached('sl_stuff', () => new THREE.MeshPhysicalMaterial({ name: 'sl_stuff', color: 0xffffff, vertexColors: true, roughness: 1, sheen: 1, sheenRoughness: 0.4, sheenColor: new THREE.Color(0xffffff), bumpMap: feltTex(), bumpScale: 1.5 }));
const holeMat = () => cached('sl_hole', () => new THREE.MeshStandardMaterial({ name: 'sl_hole', color: 0x0d0907, roughness: 1 }));
function mats(key) {
  if (key === 'sack') return clothMat('burlap', SACK);
  if (key === 'sackD') return clothMat('burlap', 0x75624a);
  if (key.startsWith('c:')) { const [, fab, hex] = key.split(':'); return clothMat(fab, parseInt(hex, 16)); }
  if (key === 'stuff') return stuffMat();
  if (key === 'hole') return holeMat();
  return AM[key]();
}
// filth: blotchy darkening, worse near the floor
function grime(seed) {
  return (g, ch) => {
    if (ch.mat === 'eyes' || ch.mat === 'hole' || ch.mat === 'stuff') return;
    const p = g.attributes.position, c = g.attributes.color;
    const k0 = ch.mat === 'felt' ? 0.3 : 0.8;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = valueNoise2(x * 6 + seed, y * 6 + z * 4, seed) * 0.6 + valueNoise2(x * 23, y * 23 + z * 17, seed + 3) * 0.4;
      const st = valueNoise2(x * 4.5 + z * 3 + seed * 3, y * 4.5 - z * 2, seed + 11);
      const stain = ch.mat === 'felt' ? 0 : clamp((st - 0.62) * 5, 0, 1);
      const low = clamp(y / 0.6, 0, 1);
      const k = 1 - k0 * ((1 - n) * 0.45 + (1 - low) * 0.25);
      c.setXYZ(i, c.getX(i) * k * (1 - stain * 0.45), c.getY(i) * k * 0.97 * (1 - stain * 0.55), c.getZ(i) * k * 0.92 * (1 - stain * 0.65));
    }
  };
}

// ---------------------------------------------------------------------------
// building blocks
// ---------------------------------------------------------------------------
const shape = (a, c, y0, y1, n = 2.6, m = 2.3) => ({ a, c, y0, y1, n, m, cy: (y0 + y1) / 2 });
function frame(H, phi, y, off = 0) {
  const p = headPt(phi, y, 0, V3(), H), n = headNormal(phi, y, V3(), H);
  p.addScaledVector(n, off);
  return { p, n, q: surfQ(n) };
}
const xPhi = (H, x, y, back = false) => { const a = Math.asin(clamp(x / (headRphi(PI, H) * Math.max(0.2, headF(y, H))), -0.95, 0.95)); return back ? a : PI - a; };
const place = (g, F) => g.applyQuaternion(F.q).translate(F.p.x, F.p.y, F.p.z);

function sackBlob(add, bone, H, mat = 'sack', seed = 1, nu = 30, nv = 20) {
  const g = headGrid(H, nu, nv, 1, null, seed);
  add(bone, mat, G.uv(g, (H.a + H.c) * PI, H.y1 - H.y0), 0xffffff);
  return g;
}
function seam(add, bone, H, phi = PI / 2) {
  const pts = []; for (let i = 0; i <= 12; i++) pts.push(headPt(phi, lerp(H.y0 + (H.y1 - H.y0) * 0.12, H.y1 - 0.01, i / 12), 0.002, V3(), H));
  add(bone, 'sack', G.uv(G.tube(pts, 0.006, 20, 4), 0.05, 0.5), 0x8a8a8a);
  for (let i = 1; i < 12; i++) {
    const p = pts[i], n = V3(p.x, 0, p.z).normalize();
    add(bone, 'felt', G.between(p.clone().addScaledVector(n, 0.004).add(V3(0, 0.004, 0.01)), p.clone().addScaledVector(n, 0.004).add(V3(0, -0.004, -0.01)), 0.0024, 2, 4), THREAD);
  }
}
function bead(add, bone, F, r) {
  add(bone, 'eyes', place(G.xf(G.sphere(r, 12, 9), [0, 0, r * 0.4]), F), EYE);
  add(bone, 'eyes', place(G.xf(G.sphere(r * 0.3, 6, 4), V3(0.42, 0.5, 0.76).normalize().multiplyScalar(r * 0.8).add(V3(0, 0, r * 0.4)).toArray()), F), 0xffffff);
  add(bone, 'felt', place(G.torus(r * 0.95, 0.0022, 4, 14), F), THREAD);
}
function nose(add, bone, F, r, col = NOSE, seed = 3) { add(bone, 'felt', place(G.xf(G.fuzzball(r, 0.06, seed, 3, 16, 12), [0, 0, r * 0.5]), F), col); }
// stitched-shut mouth across the surface: a seam line crossed by X stitches
function stitchMouth(add, bone, H, phiC, y, w, back = false) {
  const R0 = headRphi(phiC, H) * headF(y, H), dphi = Math.asin(clamp(w / 2 / R0, 0, 0.9));
  const pts = []; for (let i = 0; i <= 10; i++) { const u = i / 10; pts.push(headPt(phiC - dphi + 2 * dphi * u, y + Math.sin(u * PI) * (back ? 0.012 : -0.012) * 0, 0.003, V3(), H)); }
  add(bone, 'felt', G.tube(pts, 0.006, 16, 4), 0x120a06);
  for (let i = 1; i < 10; i++) {
    const p = pts[i], d = i % 2 ? 0.006 : -0.006;
    add(bone, 'felt', G.between(p.clone().add(V3(d, 0.019, 0.002)), p.clone().add(V3(-d, -0.019, 0.002)), 0.0036, 2, 4), 0x1a0f08);
  }
  return pts;
}
// tear: dark hole with stuffing bulging out and loose threads
function tear(add, bone, F, size, rng) {
  const hole = G.ell(size, size * 0.6, size * 0.15, 12, 8);
  add(bone, 'hole', place(G.xf(hole, [0, 0, -size * 0.05], [0, 0, rng.range(-0.6, 0.6)]), F), 0xffffff);
  const n = 2 + Math.floor(rng.next() * 3);
  for (let i = 0; i < n; i++) {
    const r = size * rng.range(0.35, 0.6);
    add(bone, 'stuff', place(G.xf(G.fuzzball(r, 0.2, rng.int(1, 99), 6, 12, 9), [rng.range(-0.5, 0.5) * size, rng.range(-0.3, 0.3) * size, r * 0.35]), F), 0xece5d4);
  }
  for (let i = 0; i < 4; i++) {
    const a = rng.next() * TAU, x = Math.cos(a) * size, y = Math.sin(a) * size * 0.6;
    const pts = [V3(x, y, 0.002), V3(x * 1.2 + rng.range(-0.01, 0.01), y * 1.2 - 0.01, 0.012), V3(x * 1.35, y * 1.3 - 0.03, 0.01 + rng.range(0, 0.015))];
    add(bone, 'felt', place(G.tube(pts, 0.0018, 6, 3), F), 0x9c8664);
  }
}
// sack limb chain: bones prefix+i along -Y, capsules with given materials
function chain(R, add, prefix, parent, pos, segs, rot = null) {
  const names = [];
  let par = parent, p = pos;
  segs.forEach((s, i) => {
    const n = prefix + i;
    R.bone(n, par, p, i === 0 ? rot : null, 'ZXY');
    add(n, s.mat, G.uv(G.capY(s.r, 0, -s.len, 4, 12), s.r * 6, s.len * 1.2), s.col ?? 0xffffff);
    if (s.band) add(n, 'reflect', G.xf(G.lathe([[s.r - 0.002, -0.011], [s.r + 0.003, -0.008], [s.r + 0.003, 0.008], [s.r - 0.002, 0.011]], 14), [0, -s.len * 0.5, 0]), 0x8a8a84);
    names.push(n); par = n; p = [0, -s.len, 0];
  });
  return names;
}
function mitten(add, bone, s = 1, fingers = 0, rng = null) {
  add(bone, 'sack', G.uv(G.xf(G.ell(0.05, 0.062, 0.042, 14, 10), [0, -0.05, 0]), 0.3, 0.12), 0xffffff);
  if (!fingers) { add(bone, 'sack', G.between([s * -0.03, -0.03, -0.02], [s * -0.042, -0.06, -0.042], 0.018, 3, 8), 0xffffff); return; }
  for (let i = 0; i < fingers; i++) {
    const a = lerp(-0.8, 0.8, i / Math.max(1, fingers - 1));
    const len = 0.07 + (rng ? rng.range(0, 0.05) : 0.03);
    const base = V3(Math.sin(a) * 0.03, -0.09, Math.cos(a) * 0.012 - 0.01);
    const tip = base.clone().add(V3(Math.sin(a) * 0.02, -len, -0.02 - (rng ? rng.range(0, 0.03) : 0)));
    const mid = base.clone().lerp(tip, 0.5).add(V3(0, 0, -0.012));
    add(bone, 'sack', G.tube([base, mid, tip], 0.0085, 6, 5), 0xffffff);
  }
}
function boot(add, bone, A = 0.1, col = 0x2c2722) {
  add(bone, 'felt', G.lathe([[0.064, 0.06], [0.072, 0.052], [0.076, 0.0], [0.078, -0.05], [0.066, -0.06]], 14), col);
  add(bone, 'felt', G.xf(G.ell(0.074, 0.056, 0.1, 14, 9), [0, -A + 0.056, -0.034]), col);
  add(bone, 'rubber', G.xf(G.cyl(0.08, 0.082, 0.024, 16), [0, -A + 0.012, -0.03], null, [1, 1, 1.45]), 0x3a3631);
}
// look helper: yaw/pitch for a bone so that its -Z faces a world point
function lookAngles(bone, target, out) {
  bone.parent.updateWorldMatrix(true, false);
  _v1.copy(target); bone.parent.worldToLocal(_v1); _v1.sub(bone.position);
  out.yaw = Math.atan2(-_v1.x, -_v1.z);
  out.pitch = Math.atan2(_v1.y, Math.hypot(_v1.x, _v1.z));
  return out;
}
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// random "snap" generator: holds a value, then jumps abruptly
class Snapper {
  constructor(rng, lo, hi) { this.rng = rng; this.lo = lo; this.hi = hi; this.t = rng.range(lo, hi); this.fired = false; }
  step(dt, rate = 1) { this.t -= dt * rate; this.fired = this.t <= 0; if (this.fired) this.t = this.rng.range(this.lo, this.hi); return this.fired; }
}
// two-bone IK with a pole: returns knee point
function solveKnee(H, F, a, b, pole, out) {
  const d0 = _v2.subVectors(F, H).length();
  const d = clamp(d0, Math.abs(a - b) + 1e-3, a + b - 1e-3);
  const dir = _v2.divideScalar(Math.max(1e-6, d0));
  const along = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a * a - along * along));
  const pd = _v3.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  return out.copy(H).addScaledVector(dir, along).addScaledVector(pd, h);
}
// orient bone (whose parent frame is P-space) so its -Y points along dir (in parent space)
function aimDown(bone, dir) { bone.quaternion.setFromUnitVectors(DOWN, _v1.copy(dir).normalize()); }

function finish(R, seed, height, radius) {
  const root = new THREE.Group(); root.name = 'StillLife';
  const top = R.bones.filter((b) => !b.parent);
  for (const b of top) root.add(b);
  const { meshes, skeleton } = R.build(mats, { shadow: true, colorMod: grime(seed), bounds: new THREE.Sphere(V3(0, height / 2, 0), Math.max(height, radius * 2)) });
  for (const m of meshes) root.add(m);
  for (const ex of R.extras) R.b[ex.bone].add(ex.obj);
  root.userData.dispose = () => { for (const m of meshes) m.geometry.dispose(); skeleton.dispose(); };
  return root;
}

// ===========================================================================
// WATCHER — stands perfectly still. Head turns too far (a second face on the back).
// ===========================================================================
function buildWatcher(seed) {
  const rng = new RNG(seed * 7 + 1);
  const R = new Rig();
  const add = (b, m, g, c) => R.add(b, m, g, c);
  const cloth = C(FADED[seed % 3]);
  R.bone('pelvis', null, [0, 0.4, 0], null, 'ZXY');
  const body = shape(0.25, 0.23, -0.12, 0.52, 2.3, 2.2);
  sackBlob(add, 'pelvis', body, cloth, seed);
  add('pelvis', 'reflect', G.uv(G.xf(G.cyl(0.255, 0.255, 0.035, 28, true), [0, 0.26, 0], null, [1, 1, 0.92]), 1, 0.1), 0x8d8d86);
  tear(add, 'pelvis', frame(body, PI - 0.4, 0.12, 0), 0.06, rng);
  tear(add, 'pelvis', frame(body, 0.6, 0.3, 0), 0.05, rng);
  tear(add, 'pelvis', frame(body, PI + 0.9, 0.36, 0), 0.04, rng);
  R.bone('neck', 'pelvis', [0, 0.47, 0], null, 'ZXY');
  add('neck', 'sack', G.uv(G.capY(0.068, 0, 0.24, 4, 12), 0.43, 0.25), 0xffffff);
  for (let i = 0; i < 3; i++) add('neck', 'felt', G.xf(G.torus(0.07, 0.004, 4, 18), [0, 0.05 + i * 0.07, 0], [PI / 2, 0, 0]), THREAD);
  R.bone('head', 'neck', [0, 0.24, 0], null, 'YXZ');
  const H = shape(0.2, 0.19, -0.05, 0.48);
  sackBlob(add, 'head', H, 'sack', seed + 1);
  seam(add, 'head', H, PI / 2); seam(add, 'head', H, -PI / 2);
  // front face: eyes too wide, a third eye, stitched-shut mouth
  for (const s of [-1, 1]) bead(add, 'head', frame(H, xPhi(H, s * 0.125, 0.29), 0.29), 0.023);
  bead(add, 'head', frame(H, xPhi(H, 0.035, 0.39), 0.39), 0.015);
  nose(add, 'head', frame(H, PI, 0.21, 0.02), 0.042);
  stitchMouth(add, 'head', H, PI, 0.12, 0.12);
  // back face, upside down, with a stretched stitched grin
  for (const s of [-1, 1]) bead(add, 'head', frame(H, xPhi(H, s * 0.08, 0.16, true), 0.16), 0.02);
  nose(add, 'head', frame(H, 0, 0.23, 0.018), 0.036, 0xb02a26, 9);
  stitchMouth(add, 'head', H, 0, 0.33, 0.17, true);
  // gaping mouth hidden behind the front stitches (opens when attacking)
  R.bone('jaw', 'head', frame(H, PI, 0.12, -0.004).p.toArray(), null);
  add('jaw', 'hole', G.ell(0.05, 0.03, 0.02, 12, 8), 0xffffff);
  // arms: three segments, far too long, fingers
  for (const [S, s] of [['L', -1], ['R', 1]]) {
    const segs = [{ len: 0.22, r: 0.056, mat: cloth }, { len: 0.22, r: 0.05, mat: cloth, band: true }, { len: 0.2, r: 0.043, mat: 'sack' }];
    const names = chain(R, add, 'arm' + S, 'pelvis', [s * 0.22, 0.4, 0], segs, [0, 0, s * 0.12]);
    add(names[1], 'stuff', G.xf(G.fuzzball(0.05, 0.2, 5, 6, 10, 8), [0, -0.22, 0]), 0xe8e0cc);
    R.bone('hand' + S, names[2], [0, -0.2, 0], null, 'XYZ');
    mitten(add, 'hand' + S, s, 5, rng);
    R.bone('hip' + S, 'pelvis', [s * 0.11, 0, 0], null, 'ZXY');
    add('hip' + S, cloth, G.uv(G.capY(0.07, 0, -0.15, 4, 12), 0.44, 0.2), 0xffffff);
    R.bone('kn' + S, 'hip' + S, [0, -0.15, 0], null, 'XYZ');
    add('kn' + S, cloth, G.uv(G.capY(0.065, 0, -0.13, 4, 12), 0.4, 0.2), 0xffffff);
    R.bone('an' + S, 'kn' + S, [0, -0.15, 0], null, 'ZXY');
    boot(add, 'an' + S);
  }
  const root = finish(R, seed, 1.62, 0.32);
  const b = R.b;
  const st = { t: 0, phase: 0, yaw: 0, pitch: 0, roll: 0.42, look: { yaw: 0, pitch: 0 }, snap: new Snapper(rng, 0.12, 0.6), twitch: new Snapper(rng, 1.5, 5), tw: 0, twBone: null, atk: new Spring(160, 9, 0), sway: new Spring(30, 3, 0), arm: [new Spring(40, 2.6, 0), new Spring(36, 2.4, 0)] };
  function update(dt, s = {}) {
    if (s.frozen) return;
    dt = clamp(dt || 0, 0, 0.1); st.t += dt;
    root.updateWorldMatrix(true, false);
    R.reset();
    const alert = clamp(s.alert || 0, 0, 1), atk = st.atk.step(dt, clamp(s.attacking || 0, 0, 1));
    const mv = s.moving ? clamp((s.speed || 1) / 1.5, 0.3, 1.5) : 0;
    st.phase += dt * mv * 3.0;
    const ph = st.phase * TAU;
    // stiff shuffle: legs barely lift, body glides with a tiny lurch
    for (const [S, o] of [['L', 0], ['R', PI]]) {
      const sw = Math.sin(ph + o) * 0.22 * mv;
      b['hip' + S].rotation.x = sw; b['kn' + S].rotation.x = -Math.max(0, Math.cos(ph + o)) * 0.3 * mv; b['an' + S].rotation.x = -sw * 0.6;
    }
    b.pelvis.rotation.z = Math.sin(ph) * 0.03 * mv;
    b.pelvis.rotation.x = 0.04 * mv + atk * 0.15;
    // head: snaps toward the target in discrete jerks, rolls like a curious bird
    if (s.lookTarget && alert > 0.01) {
      if (st.snap.step(dt, 0.5 + alert * 2.5)) {
        lookAngles(b.head, s.lookTarget, st.look);
        const k = rng.range(0.55, 1);
        st.yaw += wrap(st.look.yaw - st.yaw) * k;
        st.pitch = lerp(st.pitch, clamp(st.look.pitch, -0.8, 0.8), k);
        st.roll = rng.range(-0.7, 0.7) * alert;
      }
    }
    b.head.rotation.set(st.pitch, st.yaw, st.roll);
    // occasional twitch of a hand or the head
    if (st.twitch.step(dt, 1 + alert * 4)) { st.tw = 1; st.twBone = rng.pick(['handL', 'handR', 'head', 'armL2', 'armR2']); st.twAx = rng.range(-1, 1); }
    st.tw = Math.max(0, st.tw - dt * 6);
    if (st.twBone) b[st.twBone].rotation.x += st.tw * st.twAx * 0.6, b[st.twBone].rotation.z += st.tw * 0.3 * st.twAx;
    // dangling arms; attack = arms snap forward toward the victim
    for (const [i, S, s] of [[0, 'L', -1], [1, 'R', 1]]) {
      const swing = st.arm[i].step(dt, Math.sin(ph + i * 1.7) * 0.25 * mv);
      b['arm' + S + '0'].rotation.x = swing + atk * 1.45;
      b['arm' + S + '0'].rotation.z = s * (0.12 + atk * 0.15);
      b['arm' + S + '1'].rotation.x = swing * 0.5 + atk * 0.1;
      b['arm' + S + '2'].rotation.x = swing * 0.4 - atk * 0.2;
      b['hand' + S].rotation.x = -atk * 0.6;
    }
    b.jaw.scale.setScalar(Math.max(0.001, atk));
    b.head.rotation.x -= atk * 0.25;
  }
  return { root, update, height: 1.62, radius: 0.32 };
}

// ===========================================================================
// CRAWLER — horizontal sack torso on six limbs (arms and legs mixed), head hanging
// upside down at the front with a cluster of eyes. Procedural world-space stepping.
// ===========================================================================
function buildCrawler(seed) {
  const rng = new RNG(seed * 13 + 5);
  const R = new Rig();
  const add = (b, m, g, c) => R.add(b, m, g, c);
  const cloth = C(FADED[1 + (seed % 2)]);
  const BODY_Y = 0.42;
  R.bone('body', null, [0, BODY_Y, 0], null, 'YXZ');
  const T = shape(0.22, 0.44, -0.15, 0.17, 2.4, 2.2);
  sackBlob(add, 'body', T, cloth, seed, 30, 16);
  add('body', 'reflect', G.xf(G.cyl(0.224, 0.224, 0.03, 24, true), [0, 0.0, 0.05], [PI / 2, 0, 0], [1, 0.75, 1]), 0x8d8d86);
  tear(add, 'body', frame(T, PI / 2 + 0.3, 0.06, 0), 0.07, rng);
  tear(add, 'body', frame(T, 0.2, 0.1, 0), 0.06, rng);
  tear(add, 'body', frame(T, -PI / 2 - 0.4, -0.02, 0), 0.05, rng);
  // head: dangles under the front on a forward neck, upside down (chin up, crown dragging)
  R.bone('neck', 'body', [0, -0.02, -0.4], [1.0, 0, 0], 'XYZ');
  add('neck', 'sack', G.uv(G.capY(0.055, 0, -0.15, 4, 10), 0.4, 0.2), 0xffffff);
  R.bone('head', 'neck', [0, -0.15, 0], [-1.0, 0, PI], 'YXZ');
  const H = shape(0.16, 0.15, -0.04, 0.3);
  const addH = (bn, m, g, c) => add(bn, m, g.translate(0, -H.y0, 0), c);
  sackBlob(addH, 'head', H, 'sack', seed + 3, 26, 18);
  const eyes = [[-0.065, 0.2, 0.019], [0.065, 0.205, 0.017], [-0.015, 0.25, 0.012], [0.03, 0.14, 0.013], [-0.095, 0.13, 0.011], [0.09, 0.255, 0.01], [0.0, 0.085, 0.014]];
  for (const [x, y, r] of eyes) bead(addH, 'head', frame(H, xPhi(H, x, y), y), r);
  nose(addH, 'head', frame(H, xPhi(H, -0.035, 0.16), 0.16, 0.016), 0.03);
  nose(addH, 'head', frame(H, xPhi(H, 0.045, 0.1), 0.1, 0.014), 0.024, 0xb52b27, 7);
  stitchMouth(addH, 'head', H, PI, 0.03, 0.09);
  // six limbs: front arms, middle legs, rear arms
  const limbs = [];
  const L = [
    { z: -0.28, kind: 'arm' }, { z: 0.02, kind: 'leg' }, { z: 0.3, kind: 'arm' },
  ];
  L.forEach((l, i) => for2(l, i));
  function for2(l, i) {
    for (const s of [-1, 1]) {
      const id = (s < 0 ? 'L' : 'R') + i;
      const hx = s * 0.19, hz = l.z;
      const a = l.kind === 'leg' ? 0.3 : 0.27, bb = l.kind === 'leg' ? 0.36 : 0.34;
      R.bone('u' + id, 'body', [hx, 0.0, hz], null);
      add('u' + id, l.kind === 'leg' ? cloth : cloth, G.uv(G.capY(0.055, 0, -a, 4, 10), 0.35, a), 0xffffff);
      R.bone('l' + id, 'u' + id, [0, -a, 0], null);
      add('l' + id, l.kind === 'leg' ? cloth : 'sack', G.uv(G.capY(0.048, 0, -bb + 0.03, 4, 10), 0.3, bb), 0xffffff);
      R.bone('f' + id, 'l' + id, [0, -bb, 0], null);
      if (l.kind === 'leg') boot(R.add ? add : add, 'f' + id, 0.0, 0x2a2420); else mitten(add, 'f' + id, s, rng.next() < 0.5 ? 0 : 4, rng);
      limbs.push({ id, s, hip: V3(hx, 0, hz), a, b: bb, kind: l.kind, group: (i + (s > 0 ? 1 : 0)) % 2, planted: V3(), from: V3(), to: V3(), t: 1, has: false, phase: rng.next() });
    }
  }
  const root = finish(R, seed, 0.62, 0.75);
  const b = R.b;
  const st = { t: 0, look: { yaw: 0, pitch: 0 }, hy: 0, hp: 0, snap: new Snapper(rng, 0.1, 0.5), twitch: new Snapper(rng, 0.6, 2.5), tw: 0, twL: null, atk: new Spring(120, 8, 0), bob: 0, roll: new Spring(60, 6, 0), prev: V3(), has: false, vel: V3() };
  const tmpW = V3(), tmpL = V3(), knee = V3(), pole = V3();
  function restFoot(l, out) { return out.set(l.hip.x + l.s * 0.34, -BODY_Y, l.hip.z * 1.25 + (l.kind === 'arm' && l.hip.z < 0 ? -0.08 : 0)); }
  function update(dt, s = {}) {
    if (s.frozen) return;
    dt = clamp(dt || 0, 0, 0.1); st.t += dt;
    root.updateWorldMatrix(true, false);
    const wp = root.getWorldPosition(_v3);
    if (st.has && dt > 0) { st.vel.lerp(_v2.subVectors(wp, st.prev).divideScalar(dt), 1 - Math.exp(-8 * dt)); if (st.vel.length() > 20) st.vel.set(0, 0, 0); }
    st.prev.copy(wp); st.has = true;
    const alert = clamp(s.alert || 0, 0, 1), atk = st.atk.step(dt, clamp(s.attacking || 0, 0, 1));
    R.reset();
    // body
    const speed = st.vel.length();
    st.bob = Math.sin(st.t * 9) * 0.015 * clamp(speed, 0, 1);
    b.body.position.y = BODY_Y + st.bob + atk * 0.12;
    b.body.rotation.x = atk * 0.35;
    b.body.rotation.z = st.roll.step(dt, Math.sin(st.t * 4.3) * 0.05 * clamp(speed, 0, 1));
    b.body.updateWorldMatrix(true, false);
    // feet: plant in world, step when too far (alternating groups, out of sync)
    const stepping = [0, 0];
    for (const l of limbs) if (l.t < 1) stepping[l.group]++;
    for (const l of limbs) {
      restFoot(l, tmpL);
      tmpW.copy(tmpL); b.body.localToWorld(tmpW); tmpW.y = wp.y;
      tmpW.addScaledVector(st.vel, 0.18);
      if (!l.has) { l.planted.copy(tmpW); l.has = true; }
      if (l.t >= 1) {
        const far = l.planted.distanceTo(tmpW);
        if ((far > 0.22 || (far > 0.05 && rng.next() < dt * 0.4)) && stepping[1 - l.group] === 0) {
          l.from.copy(l.planted); l.to.copy(tmpW); l.t = 0; l.dur = rng.range(0.12, 0.26); stepping[l.group]++;
        }
      }
      let foot = _v2;
      if (l.t < 1) {
        l.t = Math.min(1, l.t + dt / l.dur);
        const u = smooth(l.t);
        foot.lerpVectors(l.from, l.to, u); foot.y += Math.sin(l.t * PI) * 0.14;
        if (l.t >= 1) l.planted.copy(l.to);
      } else foot.copy(l.planted);
      // attack: front arms rear up and claw
      if (atk > 0.01 && l.kind === 'arm' && l.hip.z < 0) {
        tmpL.set(l.hip.x + l.s * 0.18, 0.25 + Math.sin(st.t * 14 + l.s) * 0.06, -0.62);
        b.body.localToWorld(tmpL);
        foot = _v3.copy(foot).lerp(tmpL, atk);
      }
      // twitch
      if (st.twL === l && st.tw > 0) foot = _v3.copy(foot).add(V3(0, st.tw * 0.08, 0));
      tmpL.copy(foot); b.body.worldToLocal(tmpL);
      pole.set(l.s * 0.6, 1, 0).normalize();
      solveKnee(l.hip, tmpL, l.a, l.b, pole, knee);
      const ub = b['u' + l.id], lb = b['l' + l.id], fb = b['f' + l.id];
      aimDown(ub, _v2.subVectors(knee, l.hip));
      _q1.copy(ub.quaternion).invert();
      _v2.subVectors(tmpL, knee).applyQuaternion(_q1);
      aimDown(lb, _v2);
      _q2.copy(ub.quaternion).multiply(lb.quaternion).invert();
      fb.quaternion.copy(_q2);
      if (l.kind === 'leg') fb.quaternion.multiply(_q1.setFromAxisAngle(V3(0, 1, 0), 0));
    }
    if (st.twitch.step(dt, 1 + alert * 3)) { st.tw = 1; st.twL = rng.pick(limbs); }
    st.tw = Math.max(0, st.tw - dt * 5);
    // head twists to watch the target (upside down), jerky
    if (s.lookTarget && alert > 0.01 && st.snap.step(dt, 0.6 + alert * 3)) {
      lookAngles(b.neck, s.lookTarget, st.look);
      st.hy = clamp(wrap(st.look.yaw), -1.6, 1.6) * rng.range(0.6, 1); st.hp = rng.range(-0.3, 0.3);
    }
    b.neck.rotation.y = st.hy * 0.5; b.head.rotation.y += st.hy * 0.6 + Math.sin(st.t * 23) * 0.02 * alert; b.head.rotation.x += st.hp - atk * 0.4;
  }
  return { root, update, height: 0.62, radius: 0.75 };
}

// ===========================================================================
// TWIN — two dolls fused side by side: two heads, three arms, three legs.
// ===========================================================================
function buildTwin(seed) {
  const rng = new RNG(seed * 31 + 7);
  const R = new Rig();
  const add = (b, m, g, c) => R.add(b, m, g, c);
  const clothL = C(FADED[0]), clothR = C(FADED[2]);
  R.bone('pelvis', null, [0, 0.34, 0], null, 'ZXY');
  const TL = shape(0.22, 0.22, -0.12, 0.5, 2.3, 2.2);
  const gl = headGrid(TL, 26, 18, 1, null, seed); gl.translate(-0.15, 0, 0);
  const gr = headGrid(TL, 26, 18, 1, null, seed + 9); gr.translate(0.15, 0, 0);
  add('pelvis', clothL, G.uv(gl, 1.4, 0.6), 0xffffff);
  add('pelvis', clothR, G.uv(gr, 1.4, 0.6), 0xffffff);
  // crude stitches where the bodies were sewn together
  for (let i = 0; i < 9; i++) {
    const y = lerp(-0.05, 0.42, i / 8), zf = -0.175 * headF(y, TL) - 0.004;
    add('pelvis', 'felt', G.between(V3(-0.02, y + 0.012, zf), V3(0.02, y - 0.012, zf), 0.004, 2, 4), 0x1a100a);
  }
  add('pelvis', 'reflect', G.xf(G.cyl(0.225, 0.225, 0.03, 20, true), [-0.15, 0.25, 0]), 0x8d8d86);
  tear(add, 'pelvis', (() => { const F = frame(TL, PI + 0.5, 0.1); F.p.x += 0.15; return F; })(), 0.06, rng);
  tear(add, 'pelvis', (() => { const F = frame(TL, PI - 0.9, 0.3); F.p.x -= 0.15; return F; })(), 0.05, rng);
  const heads = [];
  for (const [S, s] of [['L', -1], ['R', 1]]) {
    R.bone('neck' + S, 'pelvis', [s * 0.15, 0.46, 0], [0, 0, -s * 0.35], 'ZXY');
    add('neck' + S, 'sack', G.uv(G.capY(0.06, 0, 0.12, 3, 10), 0.4, 0.15), 0xffffff);
    R.bone('head' + S, 'neck' + S, [0, 0.12, 0], null, 'YXZ');
    const H = shape(0.17, 0.165, -0.04, 0.42);
    sackBlob(add, 'head' + S, H, 'sack', seed + s * 5);
    seam(add, 'head' + S, H, PI / 2 * s);
    if (s < 0) {
      // mouths where the eyes should be, eyes where the mouth should be
      for (const x of [-0.07, 0.07]) {
        const F = frame(H, xPhi(H, x, 0.26), 0.26, 0.001);
        add('head' + S, 'hole', place(G.ell(0.03, 0.014, 0.006, 10, 6), F), 0xffffff);
        for (let k = -2; k <= 2; k++) add('head' + S, 'eyes', place(G.xf(G.box(0.008, 0.009, 0.006), [k * 0.011, 0.005 * (k % 2 ? -1 : 1), 0.004]), F), 0xe8e0c8);
        stitchMouth(add, 'head' + S, H, xPhi(H, x, 0.26), 0.26, 0.06);
        bead(add, 'head' + S, frame(H, xPhi(H, x * 0.7, 0.1), 0.1), 0.017);
      }
      nose(add, 'head' + S, frame(H, PI, 0.18, 0.016), 0.034);
    } else {
      // blank face: one huge eye, two noses stacked
      bead(add, 'head' + S, frame(H, PI, 0.27), 0.04);
      nose(add, 'head' + S, frame(H, PI, 0.17, 0.014), 0.028, NOSE, 4);
      nose(add, 'head' + S, frame(H, PI, 0.1, 0.012), 0.024, 0xa62824, 8);
    }
    heads.push('head' + S);
    // outer arms
    const names = chain(R, add, 'arm' + S, 'pelvis', [s * 0.33, 0.33, 0], [{ len: 0.14, r: 0.058, mat: s < 0 ? clothL : clothR }, { len: 0.12, r: 0.052, mat: s < 0 ? clothL : clothR, band: true }], [0, 0, s * 0.35]);
    R.bone('hand' + S, names[1], [0, -0.12, 0]); mitten(add, 'hand' + S, s);
    // outer legs
    R.bone('hip' + S, 'pelvis', [s * 0.24, 0, 0], null, 'ZXY');
    add('hip' + S, s < 0 ? clothL : clothR, G.capY(0.07, 0, -0.12, 4, 12), 0xffffff);
    R.bone('kn' + S, 'hip' + S, [0, -0.12, 0], null, 'XYZ');
    add('kn' + S, s < 0 ? clothL : clothR, G.capY(0.065, 0, -0.1, 4, 12), 0xffffff);
    R.bone('an' + S, 'kn' + S, [0, -0.12, 0], null, 'ZXY');
    boot(add, 'an' + S);
  }
  // withered middle arm + dragging middle leg
  const mid = chain(R, add, 'armM', 'pelvis', [0, 0.28, -0.2], [{ len: 0.11, r: 0.04, mat: 'sack' }, { len: 0.12, r: 0.036, mat: 'sackD' }], [0.3, 0, 0]);
  R.bone('handM', mid[1], [0, -0.12, 0]); mitten(add, 'handM', 1, 3, rng);
  R.bone('hipM', 'pelvis', [0, -0.04, 0.02], [0.4, 0, 0], 'ZXY');
  add('hipM', 'sackD', G.capY(0.055, 0, -0.18, 4, 10), 0xffffff);
  R.bone('anM', 'hipM', [0, -0.2, 0], [0.6, 0, 0]);
  add('anM', 'sack', G.xf(G.ell(0.05, 0.04, 0.08, 10, 8), [0, 0, -0.03]), 0xffffff);
  const root = finish(R, seed, 1.25, 0.55);
  const b = R.b;
  const st = { t: 0, phase: 0, look: [{ yaw: 0, pitch: 0 }, { yaw: 0, pitch: 0 }], hy: [0, 0], hp: [0, 0], hr: [0.2, -0.3], snap: [new Snapper(rng, 0.15, 0.7), new Snapper(rng, 0.25, 0.9)], atk: new Spring(110, 8, 0), arm: [new Spring(45, 2.5), new Spring(40, 2.2), new Spring(30, 1.6)], twitch: new Snapper(rng, 1, 3.5), tw: 0 };
  function update(dt, s = {}) {
    if (s.frozen) return;
    dt = clamp(dt || 0, 0, 0.1); st.t += dt;
    root.updateWorldMatrix(true, false);
    R.reset();
    const alert = clamp(s.alert || 0, 0, 1), atk = st.atk.step(dt, clamp(s.attacking || 0, 0, 1));
    const mv = s.moving ? clamp((s.speed || 1) / 1.2, 0.4, 1.6) : 0;
    st.phase += dt * mv * 1.9;
    const ph = st.phase * TAU;
    // lurching waddle: big rolls, uneven
    b.pelvis.rotation.z = Math.sin(ph) * 0.2 * mv + Math.sin(st.t * 0.7) * 0.03;
    b.pelvis.rotation.x = 0.08 * mv + atk * 0.25;
    b.pelvis.position.y = 0.34 + Math.abs(Math.sin(ph)) * 0.05 * mv;
    for (const [S, o] of [['L', 0], ['R', PI]]) {
      const sw = Math.sin(ph + o);
      b['hip' + S].rotation.x = sw * 0.35 * mv; b['hip' + S].rotation.z = -b.pelvis.rotation.z;
      b['kn' + S].rotation.x = -Math.max(0, -Math.cos(ph + o)) * 0.6 * mv;
      b['an' + S].rotation.x = -sw * 0.3 * mv;
    }
    b.hipM.rotation.x += Math.sin(ph * 0.5) * 0.15 * mv;
    // heads: alternate looking at the target, out of sync
    for (let i = 0; i < 2; i++) {
      const hb = b[heads[i]];
      if (s.lookTarget && alert > 0.01 && st.snap[i].step(dt, 0.6 + alert * 2)) {
        lookAngles(hb, s.lookTarget, st.look[i]);
        st.hy[i] = clamp(wrap(st.look[i].yaw), -2.2, 2.2); st.hp[i] = clamp(st.look[i].pitch, -0.6, 0.6); st.hr[i] = rng.range(-0.6, 0.6);
      }
      hb.rotation.set(st.hp[i] + Math.sin(ph + i * 2) * 0.08 * mv, st.hy[i], st.hr[i] + Math.sin(st.t * (1.3 + i * 0.7)) * 0.05);
    }
    for (const [i, S, s2] of [[0, 'L', -1], [1, 'R', 1]]) {
      const sw = st.arm[i].step(dt, -Math.sin(ph + i * 2.4) * 0.5 * mv);
      b['arm' + S + '0'].rotation.x = sw + atk * 1.3; b['arm' + S + '0'].rotation.z = s2 * (0.35 + atk * 0.3);
      b['arm' + S + '1'].rotation.x = sw * 0.6 + atk * 0.3;
    }
    const m = st.arm[2].step(dt, Math.sin(st.t * 1.1) * 0.2 + atk * 1.2);
    b.armM0.rotation.x = 0.3 + m; b.armM1.rotation.x = m * 0.7;
    if (st.twitch.step(dt, 1 + alert * 3)) st.tw = 1;
    st.tw = Math.max(0, st.tw - dt * 7);
    b.handM.rotation.z = st.tw * 0.9; b.headR.rotation.z += st.tw * 0.3;
  }
  return { root, update, height: 1.25, radius: 0.55 };
}

// ===========================================================================
// MASS — a heaving lump of many dolls: bodies, faces, arms, noses.
// ===========================================================================
function buildMass(seed) {
  const rng = new RNG(seed * 17 + 3);
  const R = new Rig();
  const add = (b, m, g, c) => R.add(b, m, g, c);
  R.bone('core', null, [0, 0, 0], null, 'ZXY');
  const lumps = [];
  const N = 11;
  for (let i = 0; i < N; i++) {
    const a = rng.next() * TAU, h = rng.range(0.25, 1.15);
    const rad = (1 - Math.abs(h - 0.6) / 0.9) * 0.36;
    const p = V3(Math.cos(a) * rad, h, Math.sin(a) * rad);
    const r = rng.range(0.24, 0.4) * (1.1 - h * 0.25);
    const id = 'lump' + i;
    R.bone(id, 'core', p.toArray(), [rng.range(-0.5, 0.5), rng.next() * TAU, rng.range(-0.5, 0.5)], 'XYZ');
    const isSack = rng.next() < 0.35;
    const H = shape(r, r * rng.range(0.85, 1.05), -r * 1.05, r * 1.05, 2.3, 2.2);
    sackBlob(add, id, H, isSack ? 'sack' : C(rng.pick(FADED)), seed + i, 20, 14);
    if (!isSack && rng.next() < 0.6) add(id, 'reflect', G.xf(G.cyl(r * 0.98, r * 0.98, 0.03, 18, true), [0, rng.range(-0.3, 0.3) * r, 0]), 0x8a8a84);
    lumps.push({ id, p, r, H, ph: rng.next() * TAU, f: rng.range(0.6, 1.4) });
  }
  // tears with stuffing
  for (let i = 0; i < 8; i++) { const l = rng.pick(lumps); tear(add, l.id, frame(l.H, rng.next() * TAU, rng.range(-0.3, 0.4) * l.r), rng.range(0.05, 0.09), rng); }
  // faces embedded at odd angles (some upside down)
  const faces = [];
  for (let i = 0; i < 5; i++) {
    const l = lumps[(i * 3 + 1) % N];
    const dir = V3(rng.range(-1, 1), rng.range(-0.3, 0.8), rng.range(-1, 1)).normalize();
    if (i === 0) dir.set(0, 0.25, -1).normalize();
    const id = 'face' + i;
    const pos = l.p.clone().addScaledVector(dir, l.r * 0.82);
    const q = new THREE.Quaternion().setFromRotationMatrix(_m1.lookAt(V3(), dir, V3(0, 1, 0)));
    q.multiply(_q1.setFromAxisAngle(V3(0, 0, 1), rng.next() < 0.4 ? PI : rng.range(-0.6, 0.6)));
    R.bone(id, 'core', pos.toArray(), q, 'YXZ');
    const H = shape(0.17, 0.16, -0.21, 0.21);
    sackBlob(add, id, H, 'sack', seed + 40 + i, 22, 14);
    const ne = 2 + (rng.next() < 0.35 ? rng.int(1, 3) : 0);
    for (let k = 0; k < ne; k++) { const x = k < 2 ? (k ? 0.06 : -0.06) : rng.range(-0.08, 0.08), y = k < 2 ? 0.05 : rng.range(-0.02, 0.12); bead(add, id, frame(H, xPhi(H, x, y), y), rng.range(0.013, 0.02)); }
    nose(add, id, frame(H, PI, -0.02, 0.012), 0.03, NOSE, i);
    if (rng.next() < 0.6) stitchMouth(add, id, H, PI, -0.09, 0.08); else add(id, 'hole', place(G.ell(0.03, 0.02, 0.008, 10, 6), frame(H, PI, -0.09, 0)), 0xffffff);
    faces.push({ id, base: q.clone(), jit: 0 });
  }
  // arms sprouting everywhere
  const arms = [];
  for (let i = 0; i < 8; i++) {
    const l = lumps[(i * 5 + 2) % N];
    const dir = V3(rng.range(-1, 1), rng.range(-0.6, 0.5), rng.range(-1, 1)).normalize();
    const pos = l.p.clone().addScaledVector(dir, l.r * 0.85);
    const q = new THREE.Quaternion().setFromUnitVectors(DOWN, dir);
    const cl = rng.next() < 0.5 ? C(rng.pick(FADED)) : 'sack';
    const names = chain(R, add, 'arm' + i + '_', 'core', pos.toArray(), [{ len: rng.range(0.2, 0.3), r: 0.05, mat: cl }, { len: rng.range(0.2, 0.28), r: 0.045, mat: 'sack' }], q);
    R.setRest(names[0], pos.toArray(), q);
    R.bone('hand' + i, names[1], [0, -0.22, 0]); mitten(add, 'hand' + i, 1, rng.next() < 0.5 ? 5 : 0, rng);
    arms.push({ n: names, base: q.clone(), dir, ph: rng.next() * TAU, f: rng.range(0.4, 1.3), sp: [new Spring(30, 2), new Spring(28, 2)], tw: 0 });
  }
  // stubby feet underneath
  for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU + 0.4; R.bone('foot' + i, 'core', [Math.cos(a) * 0.25, 0.1, Math.sin(a) * 0.25]); boot(add, 'foot' + i, 0.1); }
  const root = finish(R, seed, 1.5, 0.75);
  const b = R.b;
  const st = { t: 0, atk: new Spring(80, 7, 0), heave: new Spring(40, 4, 0), look: { yaw: 0, pitch: 0 }, snap: new Snapper(rng, 0.2, 0.8), twitch: new Snapper(rng, 0.3, 1.5) };
  const tq = new THREE.Quaternion(), te = new THREE.Euler();
  function update(dt, s = {}) {
    if (s.frozen) return;
    dt = clamp(dt || 0, 0, 0.1); st.t += dt;
    root.updateWorldMatrix(true, false);
    R.reset();
    const alert = clamp(s.alert || 0, 0, 1), atk = st.atk.step(dt, clamp(s.attacking || 0, 0, 1));
    const mv = s.moving ? clamp((s.speed || 1) / 1.2, 0.3, 1.5) : 0;
    const heave = st.heave.step(dt, Math.sin(st.t * 3.2) * 0.12 * mv);
    b.core.rotation.x = heave + atk * 0.2; b.core.rotation.z = Math.sin(st.t * 2.1) * 0.06 * mv;
    b.core.position.y = Math.abs(Math.sin(st.t * 3.2)) * 0.03 * mv;
    // lumps breathe out of phase, like something inside
    for (const l of lumps) { const k = 1 + Math.sin(st.t * l.f * 2 + l.ph) * 0.05 + Math.max(0, Math.sin(st.t * l.f * 5.3 + l.ph)) * 0.03 * alert; b[l.id].scale.set(k, 1 / Math.sqrt(k), k); }
    // arms grope; attack -> all reach for the target
    let tgtLocal = null;
    if (s.lookTarget) { tgtLocal = _v2.copy(s.lookTarget); root.worldToLocal(tgtLocal); }
    if (st.twitch.step(dt, 1 + alert * 3)) rng.pick(arms).tw = 1;
    for (const a of arms) {
      a.tw = Math.max(0, a.tw - dt * 4);
      const sx = a.sp[0].step(dt, Math.sin(st.t * a.f + a.ph) * 0.5 + a.tw * 1.2);
      const sz = a.sp[1].step(dt, Math.cos(st.t * a.f * 0.7 + a.ph) * 0.4);
      const sh = b[a.n[0]], el = b[a.n[1]];
      if (atk > 0.01 && tgtLocal) {
        tq.setFromUnitVectors(DOWN, _v3.subVectors(tgtLocal, sh.position).normalize());
        sh.quaternion.slerp(tq, atk * 0.85);
      }
      sh.quaternion.multiply(_q1.setFromEuler(te.set(sx, 0, sz)));
      el.rotation.x = 0.6 + Math.sin(st.t * a.f * 1.7 + a.ph) * 0.5 - atk * 0.5;
    }
    // faces jitter and turn toward the target in snaps
    if (s.lookTarget && alert > 0.01 && st.snap.step(dt, 0.5 + alert * 3)) for (const f of faces) f.jit = rng.range(-0.5, 0.5) * alert;
    for (const f of faces) { b[f.id].quaternion.multiply(_q1.setFromEuler(te.set(Math.sin(st.t * 1.7 + f.jit) * 0.05, f.jit, Math.sin(st.t * 23) * 0.015 * alert))); }
  }
  return { root, update, height: 1.5, radius: 0.75 };
}

// ===========================================================================
// TALL — stretched 2.4 m doll: backward knees, endless arms, a neck like a rope.
// ===========================================================================
function buildTall(seed) {
  const rng = new RNG(seed * 41 + 11);
  const R = new Rig();
  const add = (b, m, g, c) => R.add(b, m, g, c);
  const cloth = C(FADED[(seed + 3) % FADED.length]);
  const HIP = 1.04;
  R.bone('pelvis', null, [0, HIP, 0], null, 'ZXY');
  const T = shape(0.17, 0.15, -0.08, 0.42, 2.2, 2.2);
  sackBlob(add, 'pelvis', T, cloth, seed, 24, 16);
  add('pelvis', 'reflect', G.xf(G.cyl(0.172, 0.172, 0.03, 20, true), [0, 0.22, 0], null, [1, 1, 0.9]), 0x8d8d86);
  tear(add, 'pelvis', frame(T, PI + 0.3, 0.1), 0.05, rng);
  // rope-like neck in three springy segments
  const neck = ['n0', 'n1', 'n2'];
  R.bone('n0', 'pelvis', [0, 0.4, 0], null, 'XYZ'); R.bone('n1', 'n0', [0, 0.17, 0], null, 'XYZ'); R.bone('n2', 'n1', [0, 0.17, 0], null, 'XYZ');
  for (const n of neck) {
    add(n, 'sack', G.uv(G.capY(0.045, 0, 0.18, 3, 10), 0.3, 0.2), 0xffffff);
    for (let i = 0; i < 3; i++) add(n, 'felt', G.xf(G.torus(0.047, 0.0035, 4, 14), [0, 0.03 + i * 0.06, 0], [PI / 2, 0, 0]), THREAD);
  }
  R.bone('head', 'n2', [0, 0.17, 0], null, 'YXZ');
  const H = shape(0.16, 0.15, -0.04, 0.52, 2.5, 2.2);
  sackBlob(add, 'head', H, 'sack', seed + 2, 24, 20);
  seam(add, 'head', H, PI / 2);
  bead(add, 'head', frame(H, xPhi(H, -0.06, 0.38), 0.38), 0.02);
  bead(add, 'head', frame(H, xPhi(H, 0.07, 0.27), 0.27), 0.018);
  for (let i = 0; i < 3; i++) nose(add, 'head', frame(H, PI, 0.2 - i * 0.055, 0.012), 0.026 - i * 0.003, i === 1 ? 0xa82a25 : NOSE, i + 2);
  stitchMouth(add, 'head', H, PI, 0.04, 0.09);
  // endless arms
  for (const [S, s] of [['L', -1], ['R', 1]]) {
    const names = chain(R, add, 'arm' + S, 'pelvis', [s * 0.17, 0.34, 0], [{ len: 0.42, r: 0.042, mat: cloth }, { len: 0.42, r: 0.036, mat: 'sack' }], [0, 0, s * 0.08]);
    R.bone('hand' + S, names[1], [0, -0.42, 0]); mitten(add, 'hand' + S, s, 5, rng);
    // digitigrade legs
    R.bone('hip' + S, 'pelvis', [s * 0.09, 0, 0], null, 'ZXY');
    add('hip' + S, cloth, G.uv(G.capY(0.05, 0, -0.56, 4, 10), 0.32, 0.6), 0xffffff);
    R.bone('kn' + S, 'hip' + S, [0, -0.56, 0], null, 'XYZ');
    add('kn' + S, 'sack', G.uv(G.capY(0.042, 0, -0.56, 4, 10), 0.27, 0.6), 0xffffff);
    add('kn' + S, 'stuff', G.xf(G.fuzzball(0.045, 0.2, 3 + s, 6, 10, 8), [0, -0.02, 0]), 0xe8e0cc);
    R.bone('an' + S, 'kn' + S, [0, -0.56, 0], null, 'ZXY');
    boot(add, 'an' + S, 0.06);
  }
  const root = finish(R, seed, 2.32, 0.35);
  const b = R.b;
  const LEG = 0.56;
  const st = { t: 0, phase: 0, look: { yaw: 0, pitch: 0 }, hy: 0, hp: 0, hr: 0, snap: new Snapper(rng, 0.2, 0.9), atk: new Spring(70, 6, 0), neck: [new Spring(35, 2.2), new Spring(30, 2), new Spring(25, 1.8)], arm: [new Spring(20, 1.4), new Spring(18, 1.3)], twitch: new Snapper(rng, 1.2, 4), tw: 0 };
  const knee = V3(), foot = V3(), hipP = V3(), pole = V3(0, 0, 1);
  function update(dt, s = {}) {
    if (s.frozen) return;
    dt = clamp(dt || 0, 0, 0.1); st.t += dt;
    root.updateWorldMatrix(true, false);
    R.reset();
    const alert = clamp(s.alert || 0, 0, 1), atk = st.atk.step(dt, clamp(s.attacking || 0, 0, 1));
    const mv = s.moving ? clamp((s.speed || 1) / 1.5, 0.3, 1.5) : 0;
    st.phase += dt * mv * 0.9;
    const ph = st.phase * TAU;
    // body: lurching, slow
    b.pelvis.position.y = HIP - 0.06 + Math.abs(Math.cos(ph)) * 0.05 * mv;
    b.pelvis.rotation.z = Math.sin(ph) * 0.06 * mv;
    b.pelvis.rotation.x = 0.1 + atk * 0.35;
    b.pelvis.updateMatrix();
    // legs: IK with knees bending backward (pole behind)
    for (const [S, s2, o] of [['L', -1, 0], ['R', 1, PI]]) {
      const u = Math.sin(ph + o), lift = Math.max(0, Math.cos(ph + o));
      foot.set(s2 * 0.12, 0.06 + lift * 0.18 * mv, -u * 0.42 * mv);
      // to pelvis space
      _v2.copy(foot).sub(b.pelvis.position).applyQuaternion(_q1.copy(b.pelvis.quaternion).invert());
      hipP.copy(b['hip' + S].position);
      pole.set(0, 0.3, 1).normalize();
      solveKnee(hipP, _v2, LEG, LEG, pole, knee);
      aimDown(b['hip' + S], _v3.subVectors(knee, hipP));
      _q2.copy(b['hip' + S].quaternion).invert();
      aimDown(b['kn' + S], _v3.subVectors(_v2, knee).applyQuaternion(_q2));
      b['an' + S].quaternion.copy(_q2.copy(b['hip' + S].quaternion).multiply(b['kn' + S].quaternion).invert()).multiply(_q1.copy(b.pelvis.quaternion).invert());
    }
    // neck: lags behind like a rope, head snaps
    if (s.lookTarget && alert > 0.01 && st.snap.step(dt, 0.4 + alert * 2)) {
      lookAngles(b.head, s.lookTarget, st.look);
      st.hy = clamp(wrap(st.look.yaw), -2.6, 2.6); st.hp = clamp(st.look.pitch, -1, 0.6); st.hr = rng.range(-0.8, 0.8) * alert;
    }
    for (let i = 0; i < 3; i++) {
      const sw = st.neck[i].step(dt, -Math.sin(ph - i * 0.7) * 0.12 * mv + atk * 0.35);
      b['n' + i].rotation.x = sw + 0.1; b['n' + i].rotation.z = Math.sin(st.t * 0.6 + i) * 0.05;
    }
    b.head.rotation.set(st.hp - 0.2 - atk * 0.3, st.hy, st.hr);
    // arms: dangle to the knees, swing late; attack swings them up
    for (const [i, S, s2] of [[0, 'L', -1], [1, 'R', 1]]) {
      const sw = st.arm[i].step(dt, Math.sin(ph + PI * i + 0.8) * 0.3 * mv + atk * 1.6);
      b['arm' + S + '0'].rotation.x = sw; b['arm' + S + '0'].rotation.z = s2 * 0.08;
      b['arm' + S + '1'].rotation.x = Math.max(0, sw) * 0.3 + 0.08;
    }
    if (st.twitch.step(dt, 1 + alert * 2)) st.tw = 1;
    st.tw = Math.max(0, st.tw - dt * 6);
    b.handL.rotation.x += st.tw * 0.8; b.head.rotation.z += st.tw * 0.25;
  }
  return { root, update, height: 2.32, radius: 0.35 };
}

const BUILDERS = { watcher: buildWatcher, crawler: buildCrawler, twin: buildTwin, mass: buildMass, tall: buildTall };
export function buildStillLife(variant = 'watcher', seed = 1) {
  const fn = BUILDERS[variant] || buildWatcher;
  const out = fn(seed | 0 || 1);
  out.root.name = 'StillLife_' + variant;
  out.update(0, {});
  return out;
}
