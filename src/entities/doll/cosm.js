// R.O.O.M. — cosmetic parts: suit colourway extras, backpacks, hats (worn over the hazmat hood),
// face gear and accessories. Each builder returns a PartBuilder (cached per id by the avatar).
//   hats:  'hat' bone = head centre; hatA / hatB are springy pivots (pom-poms, ears, props)
//   gear:  head bone space (face features: see sack.js FACE)
//   packs: 'pack' bone on the upper back; packA / packB springy pivots
//   acc:   rest space (skinned to the torso) or the accA / accB / acc pivots
import * as THREE from 'three';
import { clamp, lerp } from './kit.js';
import { valueNoise2, RNG } from '../../core/rng.js';
import { DIM, Y, PartBuilder, torsoW, armW, legW, hoodW } from './dollrig.js';
import { SACK, FACE, facePt, frameQ, shellPoint, headRay } from './sack.js';
import { torsoPt, torsoNrm, torsoPhiX, torsoA, rimFacePt, HOOD, WEB, TAPE, tapeWrap, mergeSimple } from './suit.js';
import { buildStraps, buildTank, buildRegulator, buildStrapGauge, decalGrid, decalQuad, toRegion, remapCircleUV, STRAP_X } from './gear.js';
import { grid, displace, tint, solid, ensureOutward, gridArcUV, tubeR, curvePts, ribbonOn, ss, gauss, pillow, sePt } from './geom.js';

const PI = Math.PI, TAU = PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const nz = (x, y, s) => valueNoise2(x, y, s) - 0.5;
const HC = SACK.cy;
const _d = V(), _p = V(), _n = V();

// ---------------------------------------------------------------------------
// helpers (hat-local space: origin at the head centre)
// ---------------------------------------------------------------------------
// direction from polar angle (from +Y) and azimuth (0 = front -Z, +PI/2 = +X)
export function dirP(pol, az, out = V()) { return out.set(Math.sin(pol) * Math.sin(az), Math.cos(pol), -Math.sin(pol) * Math.cos(az)); }
// point on the outside of the hood (clears its folds), hat-local
export function hoodEnv(d, off = 0, scale = 1, out = V()) { shellPoint(d, 0.036 + off, scale, out); out.y -= HC; return out; }
// crown cap following the hood (top pole at ring 0)
function capGeo(polMax, off, { nu = 48, nv = 16, scale = 1, shape = null, fold = null, polFn = null } = {}) {
  const d = V();
  const g = grid(nu, nv, (i, j, p) => {
    const az = (i / nu) * TAU, pol = (polFn ? polFn(az) : polMax) * (j / nv);
    dirP(pol, az, d); hoodEnv(d, off, scale, p);
    if (shape) shape(p, az, j / nv);
  }, { closedU: true, poleBottom: true });
  ensureOutward(g, V(0, 0, 0));
  if (fold) displace(g, fold);
  gridArcUV(g, 1, 1);
  return g;
}
// brim ring hanging off a cap edge; width(az), droop(az)
function brimGeo(edge, width, droop, thick = 0.006, nu = 64, { wave = 0 } = {}) {
  const W = (az) => width(az) * (1 + wave * Math.sin(az * 3 + 1));
  const top = grid(nu, 6, (i, j, p) => {
    const az = (i / nu) * TAU, v = j / 6;
    const e = edge(az, _p), r = V(e.x, 0, e.z).normalize();
    p.copy(e).addScaledVector(r, W(az) * v); p.y += -droop(az) * v * v;
  }, { closedU: true });
  ensureOutward(top, V(0, -1, 0));
  const bot = top.clone(); bot.translate(0, -thick, 0);
  { const I = bot.index.array; for (let k = 0; k < I.length; k += 3) { const x = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = x; } bot.computeVertexNormals(); }
  const rim = []; for (let i = 0; i <= nu; i++) { const az = (i / nu) * TAU; const e = edge(az, _p); const r = V(e.x, 0, e.z).normalize(); rim.push(e.clone().addScaledVector(r, W(az)).add(V(0, -droop(az) - thick / 2, 0))); }
  const tube = tubeR(rim, thick * 0.75, 8);
  return mergeSimple([top, bot, tube]);
}
// felt / canvas patch lying on a hat surface: polar grid with radius rFn(theta)
function patchOn(centerDir, rFn, off, { scale = 1, rings = 3, segs = 24, spin = 0 } = {}) {
  const c = hoodEnv(centerDir, off, scale, V()), n = c.clone().normalize();
  const t1 = V(0, 1, 0).cross(n).normalize(), t2 = V().crossVectors(n, t1);
  const g = grid(segs, rings, (i, j, p) => {
    const a = (i / segs) * TAU + spin, r = rFn(a) * (j / rings);
    const q = c.clone().addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r);
    const d = q.clone().add(V(0, HC, 0)).sub(V(0, HC, 0)).normalize();
    hoodEnv(d, off, scale, p);
  }, { closedU: true, poleBottom: true });
  ensureOutward(g, V(0, 0, 0));
  return g;
}
const toHatY = (g) => g; // hats are authored directly in hat-local space
const HTOP = () => hoodEnv(V(0, 1, 0), 0, 1, V()).y;   // top of the hood (hat-local)

// ---------------------------------------------------------------------------
// Suit colourway extras
// ---------------------------------------------------------------------------
export function buildSuitExtras(id) {
  const B = new PartBuilder();
  if (id === 'orange_hivis') {
    // reflective bands: chest + belly, upper arms, shins
    for (const y of [0.5, 0.565]) band(B, y, 0.03);
    for (const side of ['L', 'R']) {
      const s = side === 'L' ? -1 : 1;
      B.skinned('tape', ringBand(V(s * DIM.shX, Y.chest - DIM.upper * 0.55, 0), 0.075, 0.03, 40), armW(side), 0xd8dadc);
      B.skinned('tape', ringBand(V(s * DIM.hipX, 0.215, 0.004), 0.092, 0.026, 40), legW(side), 0xd8dadc);
    }
  } else if (id === 'navy_jacket') {
    for (const y of [0.53]) band(B, y, 0.008);
    for (const side of ['L', 'R']) { const s = side === 'L' ? -1 : 1; B.skinned('tape', ringBand(V(s * DIM.shX, Y.chest - DIM.upper - 0.03, 0), 0.077, 0.008, 40), armW(side), 0xd0d2d4); }
  } else if (id === 'red') {
    // medic crosses: right chest + both upper arms
    const phi = torsoPhiX(0.07, 0.73, true), p = torsoPt(phi, 0.73, 0.012, V()), n = torsoNrm(phi, 0.73, V());
    const q = frameQ(n);
    const g = decalQuad(0.06, 0.06, 'cross'); g.applyQuaternion(q).translate(p.x, p.y, p.z);
    B.skinned('decal', g, torsoW);
    const s = 1, ax = s * DIM.shX, R = 0.076, dy = 0.062;
    const ag = decalGrid(10, 10, (u, v, pp) => { const a = (u - 0.5) * (0.06 / R), yy = Y.chest - dy + (v - 0.5) * 0.06; pp.set(ax + Math.cos(a) * R, yy, -Math.sin(a) * R * 0.96); }, 'cross');
    ensureOutward(ag, V(ax, Y.chest - dy, 0));
    B.skinned('decal', ag, armW('R'));
  } else if (id === 'fleece') {
    // fleece-lined hood trim (a fluffy roll around the face opening)
    const pts = [], N = 80;
    for (let i = 0; i <= N; i++) { rimFacePt(i / N, _p, _n); pts.push(_p.clone().addScaledVector(_n, 0.017).add(V(0, Y.head, 0))); }
    const g = tubeR(pts, (t) => 0.016 * (1 + 0.12 * Math.sin(t * TAU * 37) + 0.08 * Math.sin(t * TAU * 11)), 10);
    displace(g, (x, y, z) => nz(x * 120 + z * 80, y * 120, 3) * 0.004);
    B.skinned('felt', g, hoodW, 0xe8dcc4);
  }
  return B;
}
function ringBand(center, r, h, segs) {
  const g = grid(segs, 3, (i, j, p) => { const a = (i / segs) * TAU, v = j / 3; p.set(center.x + Math.cos(a) * (r + 0.0015 * Math.sin(PI * v)), center.y + (v - 0.5) * h, center.z + Math.sin(a) * (r + 0.0015 * Math.sin(PI * v))); }, { closedU: true });
  ensureOutward(g, center);
  return g;
}
function band(B, y, h) {
  const g = grid(96, 3, (i, j, p) => { const phi = (i / 96) * TAU, yy = y + (j / 3 - 0.5) * h; torsoPt(phi, yy, 0.0095, p); }, { closedU: true });
  ensureOutward(g, V(0, y, 0));
  B.skinned('tape', g, torsoW, 0xd8dadc);
}

// ---------------------------------------------------------------------------
// Backpacks
// ---------------------------------------------------------------------------
export function buildPackPart(e) {
  const B = new PartBuilder();
  switch (e.id) {
    case 'tank': buildTank(B); buildRegulator(B); buildStrapGauge(B); break;
    case 'satchel': satchel(B); break;
    case 'jet': jet(B); break;
    case 'bear': bear(B); break;
    case 'turtle': turtle(B); break;
    default: break;
  }
  return B;
}
function satchel(B) {
  buildStraps(B, 0x5a3d26, { buckleCol: 0x3a2a1c });
  const C = 0x8a5a34, D = 0x6e4426;
  const body = pillow(0.29, 0.25, 0.13); displace(body, (x, y, z) => nz(x * 30, y * 30 + z * 20, 4) * 0.004);
  B.rigid('pack', 'canvas', body.translate(0, -0.05, 0.07), C);
  // front pocket
  B.rigid('pack', 'canvas', pillow(0.2, 0.1, 0.035).translate(0, -0.12, 0.14), D);
  // flap (springy) with buckle straps
  B.setRest('packA', [0, 0.072, 0.138], [0.0, 0, 0]);
  const flap = grid(16, 8, (i, j, p) => { const u = i / 16 - 0.5, v = j / 8; p.set(u * 0.3, -v * 0.17, 0.004 + 0.012 * Math.sin(PI * v) - 0.008 * Math.abs(u) * 2); });
  ensureOutward(flap, V(0, -0.1, -0.2));
  const back = flap.clone(); back.translate(0, 0, -0.005); { const I = back.index.array; for (let k = 0; k < I.length; k += 3) { const x = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = x; } back.computeVertexNormals(); }
  B.rigid('packA', 'canvas', flap, D); B.rigid('packA', 'canvas', back, D);
  for (const s of [-1, 1]) {
    B.rigid('packA', 'tape', new THREE.BoxGeometry(0.026, 0.1, 0.006).translate(s * 0.08, -0.14, 0.02), 0x3a2a1c);
    B.rigid('packA', 'metal', new THREE.TorusGeometry(0.014, 0.003, 6, 4).rotateZ(PI / 4).scale(1, 0.8, 1).translate(s * 0.08, -0.17, 0.026), 0xd8b45a);
  }
  B.rigid('pack', 'tape', tubeR(curvePts([V(-0.06, 0.07, 0.07), V(-0.03, 0.115, 0.075), V(0.03, 0.115, 0.075), V(0.06, 0.07, 0.07)], 16), 0.008, 8), 0x3a2a1c);
  B.springs.pack = { k: 50, d: 4.5, gain: 0.018, mode: 'stand', limit: 0.35 };
  B.springs.packA = { k: 60, d: 4, gain: 0.03, mode: 'hang', limit: 0.6 };
}
function jet(B) {
  buildStraps(B, 0x26272c);
  B.rigid('pack', 'plastic', pillow(0.24, 0.3, 0.035).translate(0, -0.03, 0.018), 0x5c6168);
  for (const s of [-1, 1]) {
    const prof = [[0, -0.16], [0.042, -0.156], [0.066, -0.138], [0.072, -0.11], [0.072, 0.1], [0.064, 0.132], [0.04, 0.152], [0, 0.158]];
    const cyl = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 32).translate(s * 0.077, -0.02, 0.1);
    B.rigid('pack', 'plastic', cyl, 0xd23a2c);
    B.rigid('pack', 'metal', new THREE.TorusGeometry(0.073, 0.005, 6, 32).rotateX(PI / 2).translate(s * 0.077, 0.06, 0.1), 0xcfd2d6);
    B.rigid('pack', 'metal', new THREE.TorusGeometry(0.073, 0.005, 6, 32).rotateX(PI / 2).translate(s * 0.077, -0.1, 0.1), 0xcfd2d6);
    const noz = new THREE.LatheGeometry([[0.03, 0], [0.034, -0.02], [0.048, -0.064], [0.042, -0.066], [0.026, -0.026], [0.0, -0.022]].map(([r, y]) => new THREE.Vector2(r, y)), 24);
    B.rigid('pack', 'metal', noz.translate(s * 0.077, -0.176, 0.1), 0x3a3c40);
  }
  B.rigid('pack', 'metal', new THREE.CylinderGeometry(0.018, 0.018, 0.16, 12).rotateZ(PI / 2).translate(0, 0.13, 0.1), 0xb8b8b8);
  B.rigid('pack', 'plastic', pillow(0.08, 0.06, 0.03).translate(0, 0.0, 0.17), 0x2a2b2f);
  B.rigid('pack', 'plastic', new THREE.CylinderGeometry(0.012, 0.012, 0.01, 12).rotateX(PI / 2).translate(0, 0.0, 0.188), 0xd02020);
  B.setRest('packA', [0, -0.245, 0.1]);
  for (const s of [-1, 1]) {
    const f1 = new THREE.ConeGeometry(0.036, 0.15, 14, 1, true).rotateX(PI).translate(s * 0.077, -0.07, 0);
    toRegion(f1, 'flame');
    B.rigid('packA', 'decal', f1, 0xffffff);
    const f2 = new THREE.ConeGeometry(0.02, 0.085, 10, 1, true).rotateX(PI).translate(s * 0.077, -0.04, 0);
    toRegion(f2, 'lens');
    B.rigid('packA', 'decal', f2, 0xffffff);
  }
  B.info.flames = 'packA';
  B.springs.pack = { k: 60, d: 5, gain: 0.014, mode: 'stand', limit: 0.3 };
}
function fur(g, amt = 0.006, seed = 3) {
  displace(g, (x, y, z) => nz(x * 90 + z * 40 + seed, y * 90, seed) * amt + nz(x * 300, y * 300 + z * 200, seed + 1) * amt * 0.4);
  return g;
}
function bear(B) {
  buildStraps(B, 0x7a5236, { chest: false, pads: false });
  const FUR = 0xa8723f, LIGHT = 0xe2c49a;
  B.rigid('pack', 'felt', fur(new THREE.SphereGeometry(1, 28, 20).scale(0.15, 0.17, 0.1)).translate(0, -0.08, 0.1), FUR);
  B.rigid('pack', 'felt', fur(new THREE.SphereGeometry(1, 20, 14).scale(0.09, 0.1, 0.03)).translate(0, -0.1, 0.18), LIGHT);
  for (const s of [-1, 1]) {
    B.rigid('pack', 'felt', fur(new THREE.SphereGeometry(1, 16, 12).scale(0.055, 0.07, 0.055)).translate(s * 0.11, -0.22, 0.13), FUR);
    // arms hugging over the shoulders
    const arm = tubeR(curvePts([V(s * 0.12, 0.0, 0.1), V(s * 0.16, 0.12, 0.02), V(s * 0.15, 0.17, -0.12)], 18), (t) => 0.042 * (1 - 0.15 * t), 12, { closeEnd: true });
    B.rigid('pack', 'felt', fur(arm), FUR);
  }
  B.setRest('packA', [0, 0.08, 0.11]);
  B.rigid('packA', 'felt', fur(new THREE.SphereGeometry(0.11, 26, 18)).translate(0, 0.08, 0), FUR);
  for (const s of [-1, 1]) {
    B.rigid('packA', 'felt', fur(new THREE.SphereGeometry(0.04, 14, 10)).translate(s * 0.08, 0.17, 0), FUR);
    B.rigid('packA', 'felt', new THREE.SphereGeometry(0.026, 12, 8).scale(1, 1, 0.45).translate(s * 0.08, 0.17, 0.026), LIGHT);
    B.rigid('packA', 'bead', new THREE.SphereGeometry(0.0135, 14, 10).translate(s * 0.04, 0.105, 0.1), 0x070708);
  }
  B.rigid('packA', 'felt', fur(new THREE.SphereGeometry(1, 16, 12).scale(0.046, 0.036, 0.03), 0.003).translate(0, 0.06, 0.098), LIGHT);
  B.rigid('packA', 'felt', new THREE.SphereGeometry(0.017, 12, 10).scale(1.2, 1, 1).translate(0, 0.072, 0.124), 0x2a1810);
  B.springs.pack = { k: 50, d: 4.5, gain: 0.016, mode: 'stand', limit: 0.3 };
  B.springs.packA = { k: 45, d: 3.5, gain: 0.028, mode: 'stand', limit: 0.5 };
}
function turtle(B) {
  buildStraps(B, 0x4a3a28);
  const shell = new THREE.SphereGeometry(1, 40, 24, 0, TAU, 0, PI / 2);
  shell.rotateX(PI / 2).scale(0.21, 0.25, 0.14);
  const P = shell.attributes.position, col = new Float32Array(P.count * 3), c1 = new THREE.Color(0x4c8a3a), c2 = new THREE.Color(0x2f5a24), c3 = new THREE.Color(0xd8c48a);
  const cells = []; const r = new RNG(5); for (let i = 0; i < 13; i++) cells.push([r.range(-0.17, 0.17), r.range(-0.2, 0.2)]);
  cells.push([0, 0], [0, 0.11], [0, -0.11]);
  const nrm = V();
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    let d1 = 9, d2 = 9; for (const [cx, cy] of cells) { const d = Math.hypot(x - cx, y - cy); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
    const edge = clamp(1 - (d2 - d1) / 0.022, 0, 1);
    const rim = Math.hypot(x / 0.21, y / 0.25) > 0.93;
    const c = rim ? c3 : c1.clone().lerp(c2, edge);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    nrm.set(x, y, z).normalize();
    const k = 1 - edge * 0.035;
    P.setXYZ(i, x * k, y * k, z * k);
  }
  shell.setAttribute('color', new THREE.BufferAttribute(col, 3));
  shell.computeVertexNormals();
  B.rigid('pack', 'plastic', shell.translate(0, -0.05, 0.02), 0xffffff);
  B.rigid('pack', 'plastic', new THREE.TorusGeometry(0.2, 0.016, 8, 40).scale(1, 1.2, 1).translate(0, -0.05, 0.02), 0xd8c48a);
  B.springs.pack = { k: 70, d: 6, gain: 0.01, mode: 'stand', limit: 0.2 };
}

// ---------------------------------------------------------------------------
// Hats
// ---------------------------------------------------------------------------
export function buildHatPart(e) {
  const B = new PartBuilder();
  const f = HATS[e.id];
  if (f) f(B, e);
  return B;
}
const HATS = {
  bucket(B, e) {
    const col = e.color, polMax = 0.98;
    const crown = capGeo(polMax, 0.004, {
      nu: 56, nv: 18, scale: 1.02,
      shape: (p, az, v) => { if (v < 0.55) p.y -= (0.55 - v) * 0.03; },
      fold: (x, y, z) => nz(Math.atan2(x, z) * 3, y * 18, 2) * 0.006 + Math.sin(Math.atan2(x, z) * 5 + 1) * 0.0025 * ss(0.05, 0.12, y),
    });
    tint(crown, (x, y, z) => 0.94 + nz(x * 14 + z * 9, y * 14, 6) * 0.1);
    B.rigid('hat', 'canvas', crown, col);
    const edge = (az, o) => hoodEnv(dirP(polMax, az, _d), 0.004, 1.02, o);
    const brim = brimGeo(edge, (az) => 0.072 + 0.008 * Math.cos(az * 2), (az) => 0.032 + 0.008 * Math.abs(Math.sin(az)), 0.006, 72, { wave: 0.05 });
    tint(brim, (x, y, z) => 0.92 + nz(x * 20, z * 20, 8) * 0.1);
    B.rigid('hat', 'canvas', brim, col);
    // topstitching rings on the brim + band
    for (const v of [0.3, 0.58, 0.85]) {
      const pts = []; for (let i = 0; i <= 72; i++) { const az = (i / 72) * TAU; const e0 = edge(az, V()); const r = V(e0.x, 0, e0.z).normalize(); const w = (0.072 + 0.008 * Math.cos(az * 2)) * (1 + 0.05 * Math.sin(az * 3 + 1)); pts.push(e0.addScaledVector(r, w * v).add(V(0, -(0.032 + 0.008 * Math.abs(Math.sin(az))) * v * v + 0.0012, 0))); }
      B.rigid('hat', 'canvas', tubeR(pts, 0.0011, 4), 0x8a7a58);
    }
    const bandG = capBand(polMax - 0.2, polMax, 0.009, 1.02);
    B.rigid('hat', 'canvas', bandG, 0x9c8a62);
    // sun patch (front-left) and blue patch (right side) - like the PEAK hat
    const sun = patchOn(dirP(0.62, -0.62), (a) => 0.022 * (1 + 0.55 * Math.pow(Math.max(0, Math.cos(a * 8)), 6)), 0.0075, { scale: 1.02, rings: 3, segs: 64 });
    tint(sun, (x, y, z, i) => (i < 65 ? [1, 0.85, 0.55] : 1));
    B.rigid('hat', 'felt', sun, 0xf08a1e);
    const blue = patchOn(dirP(0.7, 1.05), (a) => { const c = Math.cos(a), s = Math.sin(a); return 0.026 / Math.pow(Math.pow(Math.abs(c) / 1.0, 4) + Math.pow(Math.abs(s) / 0.62, 4), 0.25); }, 0.0075, { scale: 1.02, rings: 2, segs: 32, spin: 0.35 });
    B.rigid('hat', 'felt', blue, 0x3768c0);
    B.springs.hat = { k: 100, d: 7, gain: 0.006, limit: 0.15 };
  },
  beanie(B, e) {
    const cap = capGeo(1.18, 0.0, { nu: 56, nv: 18, fold: (x, y, z) => Math.sin(Math.atan2(x, z) * 32) * 0.0012 + nz(x * 20, y * 20 + z * 10, 5) * 0.003 });
    tint(cap, (x, y, z) => { const c = new THREE.Color(e.color); const k = 0.9 + 0.1 * Math.sin(Math.atan2(x, z) * 32); return [c.r * k, c.g * k, c.b * k]; });
    B.rigid('hat', 'knit', cap, 0xffffff);
    const cuff = capBand(0.98, 1.24, 0.018, 1.0, (x, y, z) => Math.sin(Math.atan2(x, z) * 44) * 0.0028);
    tint(cuff, (x, y, z) => { const c = new THREE.Color(e.color); const k = 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(Math.atan2(x, z) * 44)); return [c.r * k, c.g * k, c.b * k]; });
    B.rigid('hat', 'knit', cuff, 0xffffff);
    B.setRest('hatA', [0, HTOP() - 0.004, 0.0]);
    const pom = new THREE.IcosahedronGeometry(0.068, 4);
    displace(pom, (x, y, z) => nz(x * 60 + z * 30, y * 60, 3) * 0.022 + nz(x * 200, y * 200 + z * 150, 4) * 0.008);
    const c1 = new THREE.Color(e.color), c2 = new THREE.Color(e.color2);
    tint(pom, (x, y, z) => (valueNoise2(x * 90 + z * 30, y * 90, 3) > 0.62 ? [c2.r, c2.g, c2.b] : [c1.r, c1.g, c1.b]));
    B.rigid('hatA', 'knit', pom.translate(0, 0.058, 0), 0xffffff);
    B.springs.hat = { k: 120, d: 8, gain: 0.004, limit: 0.12 };
    B.springs.hatA = { k: 55, d: 3.6, gain: 0.035, limit: 0.75 };
  },
  hardhat(B, e) {
    const shell = capGeo(1.1, 0.014, { nu: 56, nv: 16, scale: 1.04, shape: (p, az, v) => { p.y += 0.008 * (1 - v); } });
    B.rigid('hat', 'plastic', shell, e.color);
    // centre ridge
    const ridge = []; for (let i = 0; i <= 24; i++) { const t = lerp(-0.95, 0.95, i / 24); ridge.push(hoodEnv(dirP(Math.abs(t), t < 0 ? 0 : PI, _d), 0.024, 1.04, V()).add(V(0, 0.0, 0))); }
    B.rigid('hat', 'plastic', tubeR(ridge, (t) => 0.013 * Math.sin(PI * (0.08 + t * 0.84)), 10), e.color);
    // rim + front peak
    const edge = (az, o) => hoodEnv(dirP(1.1, az, _d), 0.014, 1.04, o);
    B.rigid('hat', 'plastic', brimGeo(edge, (az) => 0.014 + 0.05 * Math.pow(Math.max(0, Math.cos(az)), 3), (az) => 0.01 + 0.012 * Math.pow(Math.max(0, Math.cos(az)), 2), 0.007, 64), e.color);
    // hazard stripe decal segments on the sides + sticker on the front
    for (let k = 0; k < 6; k++) {
      const a0 = (k / 6) * TAU + 0.6, a1 = a0 + TAU / 6 * 0.92;
      const g = decalGrid(8, 2, (u, v, p) => { hoodEnv(dirP(lerp(0.98, 0.86, v), lerp(a0, a1, u), _d), 0.0175, 1.04, p); }, 'stripes');
      ensureOutward(g, V());
      B.rigid('hat', 'decal', g);
    }
    B.springs.hat = { k: 140, d: 9, gain: 0.004, limit: 0.15 };
  },
  party(B, e) {
    const base = V(0.02, HTOP() - 0.02, 0.0), rot = new THREE.Euler(-0.12, 0, 0.3);
    const cone = new THREE.CylinderGeometry(0.006, 0.1, 0.26, 32, 10, true);
    const c1 = new THREE.Color(e.color), c2 = new THREE.Color(e.color2);
    tint(cone, (x, y, z) => { const a = Math.atan2(x, z) / TAU + y * 5; return ((Math.floor(a * 6) % 2) + 2) % 2 ? [c1.r, c1.g, c1.b] : [c2.r, c2.g, c2.b]; });
    cone.translate(0, 0.13, 0).applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rot)).translate(base.x, base.y, base.z);
    B.rigid('hat', 'plastic', cone, 0xffffff);
    const rim = new THREE.TorusGeometry(0.098, 0.012, 8, 32).rotateX(PI / 2).translate(0, 0.004, 0).applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rot)).translate(base.x, base.y, base.z);
    displace(rim, (x, y, z) => nz(x * 200, z * 200 + y * 100, 2) * 0.006);
    B.rigid('hat', 'felt', rim, 0xf25a8a);
    const tip = V(0, 0.26, 0).applyEuler(rot).add(base);
    B.setRest('hatA', tip.toArray(), [rot.x, rot.y, rot.z]);
    const pom = new THREE.IcosahedronGeometry(0.034, 3); displace(pom, (x, y, z) => nz(x * 200 + z * 90, y * 200, 7) * 0.012);
    B.rigid('hatA', 'felt', pom.translate(0, 0.024, 0), 0xf25a8a);
    B.springs.hat = { k: 120, d: 8, gain: 0.005, limit: 0.2 };
    B.springs.hatA = { k: 80, d: 4, gain: 0.02, limit: 0.6 };
  },
  cone(B, e) {
    const rot = new THREE.Euler(-0.08, 0, -0.12), M = new THREE.Matrix4().makeRotationFromEuler(rot), y0 = HTOP() - 0.03;
    const prof = [[0.104, 0], [0.1, 0.02], [0.072, 0.13], [0.04, 0.24], [0.026, 0.29], [0.02, 0.3], [0, 0.302]];
    const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 32);
    tint(g, (x, y) => (Math.abs(y - 0.15) < 0.026 || Math.abs(y - 0.075) < 0.018 ? [0.95, 0.95, 0.93] : [1, 1, 1]));
    B.rigid('hat', 'plastic', g.applyMatrix4(M).translate(0, y0, 0), e.color);
    B.rigid('hat', 'plastic', pillow(0.25, 0.03, 0.25).applyMatrix4(M).translate(0, y0, 0), 0xd9561a);
    B.springs.hat = { k: 80, d: 5, gain: 0.008, limit: 0.25 };
  },
  propeller(B) {
    const cols = [0xe23b3b, 0xf6c41e, 0x2f7fe0, 0x3cb44a].map((c) => new THREE.Color(c));
    const cap = capGeo(1.02, 0.004, { nu: 64, nv: 14 });
    tint(cap, (x, y, z) => { const c = cols[Math.floor(((Math.atan2(x, -z) + PI) / TAU) * 4) % 4]; return [c.r, c.g, c.b]; });
    B.rigid('hat', 'plastic', cap, 0xffffff);
    const edge = (az, o) => hoodEnv(dirP(1.02, az, _d), 0.004, 1, o);
    B.rigid('hat', 'plastic', brimGeo(edge, (az) => 0.075 * Math.pow(Math.max(0, Math.cos(az)), 3), (az) => 0.022 * Math.pow(Math.max(0, Math.cos(az)), 2), 0.006, 64), 0xe23b3b);
    const top = HTOP();
    B.rigid('hat', 'metal', new THREE.CylinderGeometry(0.007, 0.007, 0.05, 10).translate(0, top + 0.025, 0), 0xcccccc);
    B.setRest('hatA', [0, top + 0.054, 0]);
    B.rigid('hatA', 'plastic', new THREE.SphereGeometry(0.014, 12, 8), 0xf6c41e);
    for (const s of [-1, 1]) {
      const blade = new THREE.SphereGeometry(1, 16, 8).scale(0.085, 0.006, 0.022).rotateX(s * 0.25).translate(s * 0.08, 0, 0);
      B.rigid('hatA', 'plastic', blade, s > 0 ? 0xe23b3b : 0x2f7fe0);
    }
    B.springs.hat = { k: 120, d: 8, gain: 0.004, limit: 0.12 };
    B.info.spin = 'hatA';
  },
  chef(B, e) {
    // pleated band (a straight cylinder over the hood) + a big soft puff
    const top = HTOP(), r0 = 0.212, y0 = top - 0.13, h = 0.12;
    const bandG = grid(72, 6, (i, j, p) => { const a = (i / 72) * TAU, v = j / 6; const r = r0 + 0.004 * Math.sin(a * 22) + 0.003 * v; p.set(Math.sin(a) * r, y0 + v * h, -Math.cos(a) * r * 0.95); }, { closedU: true });
    ensureOutward(bandG, V(0, y0, 0));
    tint(bandG, (x, y, z) => 0.92 + 0.08 * Math.sin(Math.atan2(x, -z) * 22));
    B.rigid('hat', 'canvas', bandG, e.color);
    const puff = new THREE.SphereGeometry(1, 56, 28);
    const P = puff.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), a = Math.atan2(x, z);
      const k = 1 + 0.06 * Math.pow(Math.abs(Math.sin(a * 4)), 0.6) * Math.max(0, 1 - Math.abs(y) * 0.9) + nz(a * 3, y * 4, 9) * 0.05;
      P.setXYZ(i, x * 0.25 * k, (y < 0 ? y * 0.35 : y) * 0.15 * k, z * 0.24 * k);
    }
    puff.computeVertexNormals();
    B.rigid('hat', 'canvas', puff.translate(0, y0 + h + 0.02, 0.0), e.color);
    B.springs.hat = { k: 70, d: 5, gain: 0.009, limit: 0.25 };
  },
  sprout(B) {
    B.setRest('hatA', [0.02, HTOP() - 0.01, 0.0]);
    B.rigid('hatA', 'plastic', tubeR(curvePts([V(0, -0.01, 0), V(0.006, 0.05, 0), V(-0.005, 0.1, 0), V(0.005, 0.14, 0)], 14), (t) => 0.0085 * (1 - 0.3 * t), 8), 0x4fae3a);
    for (const s of [-1, 1]) {
      const leaf = new THREE.SphereGeometry(1, 20, 10);
      const P = leaf.attributes.position; for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i); P.setXYZ(i, x * 0.062, y * 0.007 + x * x * 0.016, z * 0.034 * (1 - Math.abs(x) * 0.25)); }
      leaf.computeVertexNormals();
      tint(leaf, (x, y, z) => (Math.abs(z) < 0.002 ? [0.6, 0.8, 0.5] : 1));
      B.rigid('hatA', 'plastic', leaf.rotateZ(s * -0.45).rotateY(s * 0.2).translate(s * 0.056, 0.152, 0), 0x6cc84a);
    }
    B.springs.hatA = { k: 40, d: 2.5, gain: 0.04, limit: 0.8 };
  },
  headlamp(B) {
    const polAt = (az) => 0.86 + 0.42 * (1 - Math.cos(az)) * 0.5;
    const strap = grid(80, 3, (i, j, p) => { const az = (i / 80) * TAU, pol = polAt(az) + (j / 3 - 0.5) * 0.11; hoodEnv(dirP(pol, az, _d), 0.002, 1, p); }, { closedU: true });
    ensureOutward(strap, V());
    tint(strap, (x, y, z, i) => { const j = Math.floor(i / 81); return j === 1 || j === 2 ? [1, 0.75, 0.05] : 1; });
    B.rigid('hat', 'tape', strap, 0x202024);
    const F = hoodEnv(dirP(polAt(0), 0, _d), 0.026, 1, V()), n = F.clone().normalize(), q = frameQ(n);
    const box = pillow(0.078, 0.052, 0.046); box.applyQuaternion(q).translate(F.x, F.y, F.z);
    B.rigid('hat', 'plastic', box, 0x2a2c30);
    const L = F.clone().addScaledVector(n, 0.024);
    const bez = new THREE.TorusGeometry(0.02, 0.0045, 8, 20); bez.applyQuaternion(q).translate(L.x, L.y, L.z);
    B.rigid('hat', 'metal', bez, 0xd0d0d0);
    const lens = new THREE.CircleGeometry(0.019, 20); toRegion(remapCircleUV(lens), 'lens'); lens.applyQuaternion(q).translate(L.x, L.y, L.z);
    B.rigid('hat', 'decal', lens, 0xffffff);
    const bk = hoodEnv(dirP(polAt(PI), PI, _d), 0.018, 1, V()), bq = frameQ(bk.clone().normalize());
    B.rigid('hat', 'plastic', pillow(0.07, 0.045, 0.03).applyQuaternion(bq).translate(bk.x, bk.y, bk.z), 0x2a2c30);
  },
  tophat(B, e) {
    const M = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-0.1, 0, -0.14)), y = HTOP() - 0.035;
    const crown = new THREE.LatheGeometry([[0.1, 0], [0.108, 0.0], [0.114, 0.12], [0.122, 0.2], [0.124, 0.212], [0.11, 0.218], [0, 0.22]].map(([r, h]) => new THREE.Vector2(r, h)), 40);
    B.rigid('hat', 'felt', crown.translate(0, y, 0).applyMatrix4(M), e.color);
    const brim = new THREE.LatheGeometry([[0.1, 0.014], [0.17, 0.012], [0.192, 0.024], [0.196, 0.014], [0.18, 0.002], [0.1, 0.0]].map(([r, h]) => new THREE.Vector2(r, h)), 48);
    const P = brim.attributes.position; for (let i = 0; i < P.count; i++) { const x = P.getX(i), z = P.getZ(i); const r = Math.hypot(x, z); P.setY(i, P.getY(i) + Math.pow(Math.abs(x) / 0.2, 2) * 0.03 * ss(0.12, 0.19, r)); }
    brim.computeVertexNormals();
    B.rigid('hat', 'felt', brim.translate(0, y, 0).applyMatrix4(M), e.color);
    B.rigid('hat', 'canvas', new THREE.LatheGeometry([[0.1095, 0.02], [0.113, 0.02], [0.115, 0.058], [0.1115, 0.058]].map(([r, h]) => new THREE.Vector2(r, h)), 40).translate(0, y, 0).applyMatrix4(M), 0xb5222c);
    B.springs.hat = { k: 90, d: 6, gain: 0.008, limit: 0.25 };
  },
  bunny(B, e) {
    for (const [S, s] of [['A', -1], ['B', 1]]) {
      const base = hoodEnv(dirP(0.32, s * PI / 2, _d), -0.01, 1, V());
      B.setRest('hat' + S, base.toArray(), [0, 0, -s * 0.22]);
      const ear = new THREE.SphereGeometry(1, 20, 14);
      const P = ear.attributes.position; for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i); P.setXYZ(i, x * 0.046 * (1 - 0.25 * y), (y + 1) * 0.12, z * 0.026 + y * y * 0.012); }
      ear.computeVertexNormals();
      B.rigid('hat' + S, 'felt', fur(ear, 0.002), e.color);
      const inner = new THREE.SphereGeometry(1, 14, 10); const Q = inner.attributes.position; for (let i = 0; i < Q.count; i++) { const x = Q.getX(i), y = Q.getY(i), z = Q.getZ(i); Q.setXYZ(i, x * 0.028 * (1 - 0.25 * y), (y + 1) * 0.095 + 0.02, -0.018 + z * 0.008 + y * y * 0.012); }
      inner.computeVertexNormals();
      B.rigid('hat' + S, 'felt', inner, 0xf2a0b2);
    }
    B.springs.hatA = { k: 35, d: 2.6, gain: 0.035, limit: 0.9 };
    B.springs.hatB = { k: 38, d: 2.6, gain: 0.035, limit: 0.9 };
  },
  halo(B) {
    B.setRest('hatA', [0, HTOP() + 0.09, 0.02]);
    const g = new THREE.TorusGeometry(0.13, 0.013, 10, 40).rotateX(PI / 2 + 0.15);
    toRegion(g, 'glow');
    B.rigid('hatA', 'decal', g);
    B.info.halo = 'hatA';
    B.springs.hatA = { k: 25, d: 3, gain: 0.02, limit: 0.4 };
  },
  crown(B) {
    const M = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-0.12, 0, 0.2)), yb = HTOP() - 0.045;
    B.rigid('hat', 'metal', new THREE.LatheGeometry([[0.11, 0], [0.116, 0], [0.118, 0.05], [0.11, 0.05]].map(([r, h]) => new THREE.Vector2(r, h)), 40).translate(0, yb, 0).applyMatrix4(M), 0xffc43a);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      B.rigid('hat', 'metal', new THREE.ConeGeometry(0.03, 0.055, 4).rotateY(a + PI / 4).translate(Math.sin(a) * 0.112, yb + 0.075, Math.cos(a) * 0.112).applyMatrix4(M), 0xffc43a);
      B.rigid('hat', 'plastic', new THREE.SphereGeometry(0.01, 10, 8).translate(Math.sin(a) * 0.115, yb + 0.105, Math.cos(a) * 0.115).applyMatrix4(M), [0xe0303a, 0x2f6fe0, 0x3ac060][i % 3]);
      B.rigid('hat', 'plastic', new THREE.SphereGeometry(0.008, 10, 8).scale(1, 1, 0.5).translate(Math.sin(a + PI / 6) * 0.119, yb + 0.025, Math.cos(a + PI / 6) * 0.119).applyMatrix4(M), [0x3ac060, 0xe0303a, 0x2f6fe0][i % 3]);
    }
    B.rigid('hat', 'felt', new THREE.SphereGeometry(0.106, 24, 10, 0, TAU, 0, PI / 2).scale(1, 0.55, 1).translate(0, yb + 0.012, 0).applyMatrix4(M), 0xb02040);
    B.springs.hat = { k: 90, d: 6, gain: 0.008, limit: 0.25 };
  },
};
// band ring around the hat zone between two polar angles
function capBand(pol0, pol1, off, scale = 1, fold = null, { tall = 0 } = {}) {
  const g = grid(64, 4, (i, j, p) => {
    const az = (i / 64) * TAU, v = j / 4;
    hoodEnv(dirP(lerp(pol1, pol0, v), az, _d), off + 0.004 * Math.sin(PI * v), scale, p);
    if (tall) p.y += tall * v;
  }, { closedU: true });
  ensureOutward(g, V(0, 0, 0));
  if (fold) displace(g, fold);
  gridArcUV(g, 1, 1);
  return g;
}

// ---------------------------------------------------------------------------
// Face gear (head space)
// ---------------------------------------------------------------------------
export function buildVisorPart(e) {
  const B = new PartBuilder();
  const f = GEAR[e.id];
  if (f) f(B, e);
  return B;
}
const headRing = (y, off, { tilt = 0 } = {}) => { const pts = []; for (let i = 0; i <= 64; i++) { const az = (i / 64) * TAU; const d = V(Math.sin(az), (y - SACK.cy) / 0.24 + tilt * Math.cos(az), -Math.cos(az)).normalize(); const p = shellPoint(d, off, 1, V()); pts.push(p); } return pts; };
const GEAR = {
  goggles(B) {
    for (const s of [-1, 1]) {
      const n = V(), c = facePt(s * FACE.eyeX, FACE.eyeY, 0, V(), n), q = frameQ(n);
      const cup = new THREE.LatheGeometry([[0.03, 0.0], [0.036, 0.004], [0.038, 0.02], [0.034, 0.026], [0.029, 0.024]].map(([r, h]) => new THREE.Vector2(r, h)), 28).rotateX(PI / 2);
      cup.applyQuaternion(q).translate(c.x, c.y, c.z);
      B.rigid('head', 'rubber', cup, 0x3a3532);
      const lens = new THREE.SphereGeometry(0.032, 24, 10, 0, TAU, 0, 0.6); lens.rotateX(PI / 2).translate(0, 0, -0.005).applyQuaternion(q).translate(c.x, c.y, c.z);
      B.rigid('head', 'plastic', lens, 0x2f6c98);
      const rim = new THREE.TorusGeometry(0.033, 0.0035, 6, 24); rim.translate(0, 0, 0.024).applyQuaternion(q).translate(c.x, c.y, c.z);
      B.rigid('head', 'metal', rim, 0xc0a060);
    }
    const br = [facePt(-0.088, FACE.eyeY + 0.03, 0.018, V()), facePt(0, FACE.eyeY + 0.052, 0.022, V()), facePt(0.088, FACE.eyeY + 0.03, 0.018, V())];
    B.rigid('head', 'rubber', tubeR(curvePts(br, 12), 0.006, 8), 0x3a3532);
    const strap = headRing(FACE.eyeY + 0.02, 0.05).filter((p) => p.z > -0.12);
    const st = strap.slice(); st.sort((a, b) => Math.atan2(a.x, a.z) - Math.atan2(b.x, b.z));
    B.rigid('head', 'tape', tubeR(st, 0.0075, 6), 0x2b2622);
  },
  face_shield(B) {
    const band = headRing(0.39, 0.05, { tilt: -0.25 });
    B.rigid('head', 'plastic', tubeR(band, 0.009, 8), 0x4a4f58);
    const g = grid(28, 12, (i, j, p) => {
      const a = lerp(-1.2, 1.2, i / 28), y = lerp(-0.04, 0.4, j / 12);
      const r = 0.285 - (y - 0.4) * 0.07 * 0;
      p.set(Math.sin(a) * r, y, -Math.cos(a) * r * 0.98 + 0.03);
    });
    ensureOutward(g, V(0, 0.2, 0.1));
    B.rigid('head', 'glass', g, 0xffffff);
    const edge = []; for (let i = 0; i <= 28; i++) { const a = lerp(-1.2, 1.2, i / 28); edge.push(V(Math.sin(a) * 0.288, -0.04, -Math.cos(a) * 0.288 * 0.98 + 0.03)); }
    B.rigid('head', 'plastic', tubeR(edge, 0.006, 6), 0x3a6fb8);
    for (const s of [-1, 1]) B.rigid('head', 'plastic', new THREE.CylinderGeometry(0.02, 0.02, 0.014, 14).rotateZ(PI / 2).translate(s * 0.255, 0.39, -0.1), 0x4a4f58);
  },
  gas_mask_up(B) {
    // full-face respirator: rubber seal, bulging clear visor over eyes + nose, chin cup + valve, twin filters
    const seal = []; const N = 72;
    for (let i = 0; i <= N; i++) { rimFacePt(i / N, _p, _n, -0.012); seal.push(_p.clone().addScaledVector(_n, 0.012)); }
    B.rigid('head', 'rubber', tubeR(seal, 0.014, 10), 0x232427);
    // visor: ellipsoidal dome
    const vc = V(0, 0.236, -0.118);
    const vpt = (r, th, out) => { const a = 1.25 * r * Math.cos(th), bb = 0.075 + 0.925 * r * Math.sin(th); return out.set(Math.sin(a) * Math.cos(bb) * 0.168, Math.sin(bb) * 0.1, -Math.cos(a) * Math.cos(bb) * 0.142).add(vc); };
    const vis = grid(40, 10, (i, j, p) => vpt(j / 10, (i / 40) * TAU, p), { closedU: true, poleBottom: true });
    ensureOutward(vis, vc.clone().add(V(0, 0, 0.05)));
    B.rigid('head', 'glass', vis, 0xffffff);
    const vr = []; for (let i = 0; i <= 64; i++) vr.push(vpt(1, (i / 64) * TAU, V()));
    B.rigid('head', 'rubber', tubeR(vr, 0.0085, 8), 0x1d1e21);
    // chin cup
    const chin = new THREE.SphereGeometry(1, 28, 16); chin.scale(0.095, 0.07, 0.07).translate(0, 0.1, -0.165);
    B.rigid('head', 'rubber', chin, 0x232427);
    B.rigid('head', 'plastic', new THREE.CylinderGeometry(0.026, 0.03, 0.03, 20).rotateX(PI / 2).translate(0, 0.095, -0.235), 0x2b2c30);
    B.rigid('head', 'plastic', new THREE.CylinderGeometry(0.022, 0.022, 0.006, 20).rotateX(PI / 2).translate(0, 0.095, -0.252), 0x3a3c40);
    for (let k = 0; k < 5; k++) B.rigid('head', 'plastic', new THREE.BoxGeometry(0.03, 0.003, 0.004).translate(0, 0.082 + k * 0.006, -0.256), 0x18191c);
    for (const s of [-1, 1]) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.55, s * 0.75, 0));
      const pos = V(s * 0.1, 0.085, -0.2);
      const can = new THREE.CylinderGeometry(0.036, 0.038, 0.04, 26).rotateX(PI / 2); can.translate(0, 0, -0.012).applyQuaternion(q).translate(pos.x, pos.y, pos.z);
      B.rigid('head', 'plastic', can, 0x2f3034);
      const label = new THREE.CylinderGeometry(0.0365, 0.0385, 0.022, 26, 1, true).rotateX(PI / 2); toRegion(label, 'filter'); label.translate(0, 0, -0.014).applyQuaternion(q).translate(pos.x, pos.y, pos.z);
      B.rigid('head', 'decal', label, 0xffffff);
      const capG = new THREE.CylinderGeometry(0.03, 0.036, 0.008, 26).rotateX(PI / 2); capG.translate(0, 0, -0.036).applyQuaternion(q).translate(pos.x, pos.y, pos.z);
      B.rigid('head', 'plastic', capG, 0x18191c);
    }
    // head straps disappearing over the hood
    for (const [y0, y1] of [[0.3, 0.42], [0.12, 0.1]]) for (const s of [-1, 1]) {
      const a = facePt(s * 0.16, y0, 0.018, V()), b = shellPoint(V(s * 0.9, (y1 - SACK.cy) / 0.24, 0.2).normalize(), 0.042, 1, V());
      B.rigid('head', 'rubber', tubeR(curvePts([a, a.clone().lerp(b, 0.5).add(V(s * 0.02, 0, 0.01)), b], 10), 0.006, 6), 0x1d1e21);
    }
    B.info.maskHose = { bone: 'head', pos: V(0.0, 0.07, -0.21), dir: V(0.1, -1, -0.3).normalize() };
  },
  glasses(B) {
    for (const s of [-1, 1]) {
      const n = V(), c = facePt(s * FACE.eyeX, FACE.eyeY, 0.02, V(), n), q = frameQ(n);
      B.rigid('head', 'plastic', new THREE.TorusGeometry(0.034, 0.004, 8, 28).applyQuaternion(q).translate(c.x, c.y, c.z), 0x5a3a24);
      B.rigid('head', 'glass', new THREE.CircleGeometry(0.032, 24).applyQuaternion(q).translate(c.x, c.y, c.z), 0xffffff);
      const side = facePt(s * 0.155, FACE.eyeY + 0.008, 0.012, V());
      const back = shellPoint(V(s * 0.95, (FACE.eyeY + 0.01 - SACK.cy) / 0.24, 0.3).normalize(), 0.038, 1, V());
      B.rigid('head', 'plastic', tubeR(curvePts([facePt(s * 0.152, FACE.eyeY + 0.006, 0.02, V()), side, back], 10), 0.0032, 6), 0x5a3a24);
    }
    B.rigid('head', 'plastic', tubeR(curvePts([facePt(-0.088, FACE.eyeY + 0.01, 0.022, V()), facePt(0, FACE.eyeY + 0.045, 0.03, V()), facePt(0.088, FACE.eyeY + 0.01, 0.022, V())], 10), 0.0034, 6), 0x5a3a24);
  },
  sunglasses(B) {
    for (const s of [-1, 1]) {
      const n = V(), c = facePt(s * (FACE.eyeX - 0.004), FACE.eyeY - 0.002, 0.024, V(), n), q = frameQ(n);
      const lens = new THREE.SphereGeometry(1, 20, 8).scale(0.046, 0.034, 0.008); lens.applyQuaternion(q).translate(c.x, c.y, c.z);
      B.rigid('head', 'plastic', lens, 0x0d0e12);
      const back = shellPoint(V(s * 0.95, (FACE.eyeY + 0.01 - SACK.cy) / 0.24, 0.3).normalize(), 0.038, 1, V());
      B.rigid('head', 'plastic', tubeR(curvePts([facePt(s * 0.162, FACE.eyeY + 0.012, 0.022, V()), facePt(s * 0.17, FACE.eyeY + 0.015, 0.016, V()), back], 10), 0.0036, 6), 0x16161a);
    }
    B.rigid('head', 'plastic', tubeR(curvePts([facePt(-0.08, FACE.eyeY + 0.026, 0.03, V()), facePt(0, FACE.eyeY + 0.05, 0.036, V()), facePt(0.08, FACE.eyeY + 0.026, 0.03, V())], 10), 0.004, 6), 0x16161a);
  },
};

// ---------------------------------------------------------------------------
// Accessories (around the hood base / on the chest)
// ---------------------------------------------------------------------------
export function buildAccPart(e) {
  const B = new PartBuilder();
  const f = ACCS[e.id];
  if (f) f(B, e);
  return B;
}
// collar ring around the hood base (rest space): angle 0 = front
const NECK = { y: 0.83, rx: 0.226, rz: 0.212, cz: 0.012, dip: 0.028 };
function neckPt(a, off = 0, dy = 0, out = V()) {
  return out.set(Math.sin(a) * (NECK.rx + off), NECK.y + dy - NECK.dip * (0.5 + 0.5 * Math.cos(a)), NECK.cz - Math.cos(a) * (NECK.rz + off));
}
const chestW = (x, y, z, o) => o.reset().add('chest', 1);
const ACCS = {
  scarf(B, e) {
    const c1 = new THREE.Color(e.color), c2 = new THREE.Color(e.color2);
    const g = grid(64, 10, (i, j, p) => { const a = (i / 64) * TAU, b = (j / 10) * TAU; const c = neckPt(a, 0.012); const r = V(Math.sin(a), 0, -Math.cos(a)); p.copy(c).addScaledVector(r, Math.cos(b) * 0.036).add(V(0, Math.sin(b) * 0.042, 0)); }, { closedU: true });
    ensureOutward(g, V(0, NECK.y, NECK.cz));
    displace(g, (x, y, z) => nz(x * 40 + z * 30, y * 40, 7) * 0.006);
    tint(g, (x, y, z, i) => { const u = (i % 65) / 64, v = Math.floor(i / 65) / 10; return (Math.floor(u * 30) + Math.floor(v * 4)) % 2 ? [c1.r, c1.g, c1.b] : [c2.r, c2.g, c2.b]; });
    B.skinned('knit', g, chestW);
    const tail = (S, x, rz) => {
      const p0 = neckPt(-0.35 + x, 0.03, -0.03);
      B.setRest('acc' + S, [p0.x, p0.y - Y.chest, p0.z - 0.02], [0.52, 0, rz]);
      const t = grid(6, 14, (i, j, p) => { const u = i / 6 - 0.5, v = j / 14; p.set(u * 0.07, -v * 0.24, 0.01 * Math.sin(PI * (i / 6)) + 0.012 * Math.sin(v * 5)); });
      const back = t.clone(); back.translate(0, 0, -0.012); { const I = back.index.array; for (let k = 0; k < I.length; k += 3) { const xx = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = xx; } }
      const tg = mergeSimple([t, back]); tg.computeVertexNormals();
      ensureOutward(t, V(0, -0.1, 0.3));
      tint(tg, (px, py) => ((Math.floor((px + 0.1) / 0.0175) + Math.floor(-py / 0.0175)) % 2 ? [c1.r, c1.g, c1.b] : [c2.r, c2.g, c2.b]));
      B.rigid('acc' + S, 'knit', tg);
      for (let k = 0; k < 6; k++) B.rigid('acc' + S, 'knit', tubeR([V(-0.03 + k * 0.012, -0.235, 0), V(-0.03 + k * 0.012, -0.27, 0.002)], 0.0035, 5), k % 2 ? e.color : e.color2);
    };
    tail('A', -0.05, 0.12); tail('B', 0.08, -0.06);
    B.springs.accA = { k: 30, d: 3, gain: 0.04, mode: 'hang', limit: 0.5 };
    B.springs.accB = { k: 34, d: 3, gain: 0.04, mode: 'hang', limit: 0.5 };
  },
  fannypack(B, e) {
    const y = 0.43, phi = torsoPhiX(-0.07, y, true), p = torsoPt(phi, y, 0.05, V()), n = torsoNrm(phi, y, V()).setY(0).normalize(), q = frameQ(n);
    const pouch = pillow(0.2, 0.1, 0.075); displace(pouch, (x, yy, z) => nz(x * 40, yy * 40 + z * 30, 3) * 0.003);
    B.skinned('canvas', pouch.applyQuaternion(q).translate(p.x, p.y, p.z), torsoW, e.color);
    const zip = new THREE.BoxGeometry(0.17, 0.005, 0.006).translate(0, 0.024, 0.036); zip.applyQuaternion(q).translate(p.x, p.y, p.z);
    B.skinned('metal', zip, torsoW, 0x9a9a9a);
    const pull = new THREE.BoxGeometry(0.01, 0.022, 0.003).translate(0.055, 0.011, 0.04); pull.applyQuaternion(q).translate(p.x, p.y, p.z);
    B.skinned('metal', pull, torsoW, 0xd0d0d0);
    const belt = grid(96, 2, (i, j, pp) => { const ph = (i / 96) * TAU; torsoPt(ph, y + (j / 2 - 0.5) * 0.03, 0.011, pp); }, { closedU: true });
    ensureOutward(belt, V(0, y, 0));
    B.skinned('tape', belt, torsoW, e.color2);
    const bp = torsoPt(torsoPhiX(0.16, y, true), y, 0.016, V()), bq = frameQ(torsoNrm(torsoPhiX(0.16, y, true), y, V()));
    B.skinned('plastic', pillow(0.045, 0.028, 0.012).applyQuaternion(bq).translate(bp.x, bp.y, bp.z), torsoW, 0x18191c);
  },
  tie(B, e) {
    const k = neckPt(0, 0.0, -0.035);
    B.skinned('canvas', pillow(0.036, 0.032, 0.02).translate(k.x, k.y, k.z - 0.006), chestW, e.color);
    B.setRest('accA', [k.x, k.y - Y.chest - 0.012, k.z - 0.012], [0.55, 0, 0]);
    const sh = new THREE.Shape();
    sh.moveTo(-0.014, 0); sh.lineTo(0.014, 0); sh.lineTo(0.032, -0.2); sh.lineTo(0, -0.235); sh.lineTo(-0.032, -0.2); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.006, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 2 });
    g.translate(0, 0, -0.003);
    const c1 = new THREE.Color(e.color), c2 = new THREE.Color(e.color2);
    tint(g, (x, y) => (Math.floor((x * 0.7 - y) / 0.03) % 3 === 0 ? [c2.r, c2.g, c2.b] : [c1.r, c1.g, c1.b]));
    B.rigid('accA', 'canvas', g);
    B.springs.accA = { k: 50, d: 4, gain: 0.02, mode: 'hang', limit: 0.35 };
  },
  bowtie(B, e) {
    const k = neckPt(0, 0.012, -0.03);
    for (const s of [-1, 1]) {
      const lobe = new THREE.SphereGeometry(1, 16, 10).scale(0.036, 0.024, 0.012);
      const P = lobe.attributes.position; for (let i = 0; i < P.count; i++) { const x = P.getX(i); P.setY(i, P.getY(i) * (0.55 + Math.abs(x) / 0.036 * 0.6)); }
      lobe.computeVertexNormals();
      B.skinned('canvas', lobe.translate(k.x + s * 0.034, k.y, k.z - 0.004), chestW, e.color);
    }
    B.skinned('canvas', new THREE.SphereGeometry(0.014, 12, 8).scale(1, 1.1, 0.8).translate(k.x, k.y, k.z - 0.012), chestW, 0xa32334);
  },
  lei(B) {
    B.setRest('accA', [0, 0, 0]);
    const cols = [0xf25a8a, 0xf6d24a, 0xf8f4f0, 0xb88af0, 0xf2843a];
    const petal = new THREE.SphereGeometry(1, 8, 5).scale(0.019, 0.006, 0.013);
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * TAU, p = neckPt(a, 0.02, 0.004);
      const n = V(Math.sin(a) * 0.6, 0.75, -Math.cos(a) * 0.6).normalize(), q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), n);
      for (let k = 0; k < 5; k++) {
        const pa = (k / 5) * TAU + i;
        const g = petal.clone().translate(0.016, 0, 0).rotateY(-pa).applyQuaternion(q).translate(p.x, p.y - Y.chest, p.z);
        B.rigid('accA', 'felt', g, cols[i % cols.length]);
      }
      B.rigid('accA', 'felt', new THREE.SphereGeometry(0.0075, 8, 6).applyQuaternion(q).translate(p.x + n.x * 0.004, p.y - Y.chest + n.y * 0.004, p.z + n.z * 0.004), 0xf6c41e);
    }
    B.springs.accA = { k: 60, d: 5, gain: 0.012, mode: 'hang', limit: 0.25 };
  },
  bandana(B, e) {
    const c = new THREE.Color(e.color);
    const ring = grid(64, 6, (i, j, p) => { const a = (i / 64) * TAU, b = (j / 6) * TAU; const cc = neckPt(a, 0.008, -0.005); const r = V(Math.sin(a), 0, -Math.cos(a)); p.copy(cc).addScaledVector(r, Math.cos(b) * 0.022).add(V(0, Math.sin(b) * 0.026, 0)); }, { closedU: true });
    ensureOutward(ring, V(0, NECK.y, NECK.cz));
    B.skinned('canvas', ring, chestW, e.color);
    const k = neckPt(0, 0.024, -0.02);
    const tri = grid(16, 12, (i, j, p) => { const u = i / 16 - 0.5, v = j / 12; const w = (1 - v) * 0.22; p.set(k.x + u * w, k.y - v * 0.16, k.z - 0.008 - 0.03 * v + 0.01 * Math.sin(u * PI * 2) * (1 - v)); });
    ensureOutward(tri, V(k.x, k.y - 0.08, k.z + 0.3));
    tint(tri, (x, y) => { const fx = ((x * 60) % 1 + 1) % 1, fy = ((y * 60) % 1 + 1) % 1; return Math.hypot(fx - 0.5, fy - 0.5) < 0.2 ? [1, 1, 1] : [c.r, c.g, c.b]; });
    B.skinned('canvas', tri, chestW);
  },
  headphones(B) {
    const band = []; for (let i = 0; i <= 24; i++) { const a = lerp(PI * 0.42, PI * 1.58, i / 24); band.push(neckPt(a, 0.025, 0.035)); }
    B.skinned('plastic', tubeR(band, 0.012, 10), chestW, 0x2a2a30);
    for (const s of [-1, 1]) {
      const p = neckPt(s * PI * 0.42, 0.02, 0.02), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s * 0.42 * PI, 0));
      B.skinned('plastic', new THREE.CylinderGeometry(0.052, 0.052, 0.036, 24).rotateZ(PI / 2).rotateY(-s * 0.3).translate(p.x, p.y, p.z), chestW, 0xf25a8a);
      B.skinned('felt', new THREE.CylinderGeometry(0.044, 0.044, 0.012, 24).rotateZ(PI / 2).rotateY(-s * 0.3).translate(p.x - s * 0.022, p.y, p.z), chestW, 0x222226);
      void q;
    }
  },
  bell(B) {
    const ring = grid(64, 6, (i, j, p) => { const a = (i / 64) * TAU, b = (j / 6) * TAU; const cc = neckPt(a, 0.006, -0.01); const r = V(Math.sin(a), 0, -Math.cos(a)); p.copy(cc).addScaledVector(r, Math.cos(b) * 0.012).add(V(0, Math.sin(b) * 0.016, 0)); }, { closedU: true });
    ensureOutward(ring, V(0, NECK.y, NECK.cz));
    B.skinned('canvas', ring, chestW, 0xd8303a);
    const k = neckPt(0, 0.02, -0.03);
    B.setRest('accA', [k.x, k.y - Y.chest, k.z]);
    B.rigid('accA', 'metal', new THREE.SphereGeometry(0.028, 18, 12).translate(0, -0.03, 0), 0xffc83a);
    B.rigid('accA', 'metal', new THREE.TorusGeometry(0.028, 0.004, 6, 18).rotateX(PI / 2).translate(0, -0.03, 0), 0xd8a02a);
    B.rigid('accA', 'plastic', new THREE.BoxGeometry(0.004, 0.016, 0.004).translate(0, -0.044, -0.026), 0x222222);
    B.springs.accA = { k: 40, d: 2.5, gain: 0.03, mode: 'hang', limit: 0.6 };
  },
  badge(B) {
    const y = 0.735, phi = torsoPhiX(0.068, y, true), p = torsoPt(phi, y, 0.014, V()), n = torsoNrm(phi, y, V());
    B.setRest('acc', [p.x, p.y - Y.pelvis, p.z], frameQ(n));
    B.rigid('acc', 'canvas', new THREE.BoxGeometry(0.03, 0.06, 0.004).translate(-0.012, -0.03, -0.002).rotateZ(0.2), 0x2f5fd0);
    B.rigid('acc', 'canvas', new THREE.BoxGeometry(0.03, 0.06, 0.004).translate(0.012, -0.03, -0.002).rotateZ(-0.2), 0xd03040);
    const ros = new THREE.CircleGeometry(0.026, 24); const P = ros.attributes.position; for (let i = 0; i < P.count; i++) { const x = P.getX(i), y2 = P.getY(i); const a = Math.atan2(y2, x), r = Math.hypot(x, y2); P.setZ(i, 0.003 + Math.sin(a * 18) * 0.0015 * r / 0.026); }
    ros.computeVertexNormals();
    B.rigid('acc', 'canvas', ros.translate(0, 0, 0.002), 0x2f5fd0);
    const sh = new THREE.Shape();
    for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU + PI / 2, r = i % 2 ? 0.0085 : 0.019; if (i) sh.lineTo(Math.cos(a) * r, Math.sin(a) * r); else sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    B.rigid('acc', 'metal', new THREE.ExtrudeGeometry(sh, { depth: 0.004, bevelEnabled: true, bevelSize: 0.0015, bevelThickness: 0.0015, bevelSegments: 1 }).translate(0, 0, 0.006), 0xffc43a);
    B.springs.acc = { k: 60, d: 4, gain: 0.012, mode: 'hang', limit: 0.3 };
  },
};
