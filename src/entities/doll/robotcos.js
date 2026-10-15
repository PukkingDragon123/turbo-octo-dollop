// R.O.O.M. — clone android cosmetics. Same ids as the doll catalogue (saved profiles reference them),
// rebuilt for the android's small skull and slim body. Each builder returns an RPartBuilder (cached
// per id by the avatar).
//   hats : 'hat' bone = skull centre (HC); hatA / hatB springy pivots (pom-poms, ears, propeller)
//   gear : head-bone space (face plate layout in robotshape.js)
//   packs: 'pack' bone on the upper back (behind the coverall); packA / packB springy pivots
//   acc  : rest space (skinned to the coverall) or the accA / accB / acc pivots
import * as THREE from 'three';
import { clamp, lerp } from './kit.js';
import { valueNoise2 } from '../../core/rng.js';
import { RD, RY, BI, RPartBuilder, torsoW, armW, legW, NECK_Z, HEAD_Z } from './robotrig.js';
import { HC, HR, FACE, headPoint, plateOff, inPlate, eyeLayout, eyeCentre } from './robotshape.js';
import { coverPt, coverNrm, coverPhiX, HEM_Y, SLEEVE_END } from './robotbody.js';
import { vcol, region, frameAt, lin, sgrid, outward, constW } from './robothead.js';
import { grid, displace, tint, ensureOutward, gridArcUV, tubeR, curvePts, ribbonOn, pillow, gauss, ss } from './geom.js';
import { mergeSimple } from './suit.js';
import { atlasUV } from './dolltex.js';

const PI = Math.PI, TAU = PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const nz = (x, y, s) => valueNoise2(x, y, s) - 0.5;
const C = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

// ---------------------------------------------------------------------------
// hat-local helpers (origin = skull centre, face toward -Z)
// ---------------------------------------------------------------------------
const plateClear = (th, ph) => (inPlate(th, ph, -0.03) ? Math.max(0, plateOff(th, ph)) : 0);
export function hp(th, ph, off = 0, out = V()) { return headPoint(th, ph, plateClear(th, ph) + off, out).sub(HC); }
const HTOP = HR.y;
// crown cap: rim at ph = rim(th) up to the pole; off(th, s) offset (s 0 rim -> 1 top)
function capGeo(rim, off, { nu = 48, nv = 14, fold = null, shape = null } = {}) {
  const g = grid(nu, nv, (i, j, p) => {
    const th = (i / nu) * TAU - PI, s = j / nv, ph = lerp(rim(th), PI / 2, s);
    hp(th, Math.min(ph, PI / 2 - 1e-3), typeof off === 'function' ? off(th, s) : off, p);
    if (shape) shape(p, th, s);
  }, { closedU: true, poleTop: true });
  ensureOutward(g, V(0, 0, 0));
  if (fold) displace(g, fold);
  gridArcUV(g, 1, 1);
  return g;
}
// band hugging the skull between two elevations
function bandGeo(ph0, ph1, off, { nu = 48, fold = null, rimFn = null } = {}) {
  const g = grid(nu, 3, (i, j, p) => {
    const th = (i / nu) * TAU - PI, base = rimFn ? rimFn(th) : 0;
    hp(th, base + lerp(ph0, ph1, j / 3), off + 0.0025 * Math.sin(PI * j / 3), p);
  }, { closedU: true });
  ensureOutward(g, V(0, 0, 0));
  if (fold) displace(g, fold);
  gridArcUV(g, 1, 1);
  return g;
}
// flat brim ring from an edge curve: width(th), droop(th)
function brimGeo(edge, width, droop, thick = 0.004, nu = 56) {
  const ring = [];
  for (let i = 0; i <= nu; i++) {
    const th = (i / nu) * TAU - PI, e = edge(th), r = V(e.x, 0, e.z).normalize();
    ring.push({ e, r, w: width(th), d: droop(th) });
  }
  const top = grid(nu, 4, (i, j, p) => { const R = ring[i], v = j / 4; p.copy(R.e).addScaledVector(R.r, R.w * v); p.y -= R.d * v * v; }, { closedU: true });
  ensureOutward(top, V(0, -0.5, 0));
  const bot = top.clone(); bot.translate(0, -thick, 0);
  { const I = bot.index.array; for (let k = 0; k < I.length; k += 3) { const x = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = x; } bot.computeVertexNormals(); }
  const rim = ring.map((R) => R.e.clone().addScaledVector(R.r, R.w).add(V(0, -R.d - thick / 2, 0)));
  return mergeSimple([top, bot, tubeR(rim, thick * 0.7, 6)]);
}
const fuzz = (r, amt, seed = 1, det = 3) => { const g = new THREE.IcosahedronGeometry(r, det); displace(g, (x, y, z) => nz(x * 9 / r + z * 4 / r, y * 9 / r + seed, seed) * amt * r); return g; };

// ---------------------------------------------------------------------------
// Coverall colourway extras
// ---------------------------------------------------------------------------
function torsoBand(B, y, h, col, off = 0.006, mat = 'tape') {
  const g = grid(96, 3, (i, j, p) => coverPt((i / 96) * TAU - PI, y + (j / 3 - 0.5) * h, off + 0.0008 * Math.sin(PI * j / 3), p), { closedU: true });
  ensureOutward(g, V(0, y, 0));
  B.skinned(mat, vcol(g, 1), torsoW, col);
}
function limbBand(B, side, leg, dy, r, h, col) {
  const s = side === 'L' ? -1 : 1, ax = s * (leg ? RD.hipX : RD.shX), top = leg ? RY.pelvis : RY.sh, cz = leg ? 0.004 : 0;
  const g = grid(40, 3, (i, j, p) => { const a = (i / 40) * TAU, v = j / 3; p.set(ax + Math.cos(a) * (r + 0.0012 * Math.sin(PI * v)), top - dy + (v - 0.5) * h, cz + Math.sin(a) * (r + 0.0012 * Math.sin(PI * v)) * (leg ? 1 : 0.96)); }, { closedU: true });
  ensureOutward(g, V(ax, top - dy, cz));
  B.skinned('tape', vcol(g, 1), leg ? legW(side) : armW(side), col);
}
export function buildSuitExtras(id) {
  const B = new RPartBuilder();
  if (id === 'orange_hivis') {
    for (const y of [1.15, 1.215]) torsoBand(B, y, 0.026, 0xd8dadc);
    for (const S of ['L', 'R']) { limbBand(B, S, false, 0.11, 0.0575, 0.024, 0xd8dadc); limbBand(B, S, true, 0.66, 0.0585, 0.024, 0xd8dadc); limbBand(B, S, true, 0.71, 0.0595, 0.018, 0xd8dadc); }
  } else if (id === 'navy_jacket') {
    torsoBand(B, 1.13, 0.008, 0xd0d2d4);
    for (const S of ['L', 'R']) limbBand(B, S, false, SLEEVE_END - 0.02, 0.0545, 0.007, 0xd0d2d4);
  } else if (id === 'red') {
    // medic crosses: right chest + right sleeve
    const phi = coverPhiX(0.085, 1.24, true), p = coverPt(phi, 1.24, 0.006, V()), n = coverNrm(phi, 1.24, V());
    B.skinned('decal', vcol(region(new THREE.PlaneGeometry(0.06, 0.06), 'cross').applyMatrix4(frameAt(p, n)), 1), torsoW, 0xffffff, { uv: false });
    const ax = RD.shX, R = 0.0585, cy = RY.sh - 0.08, rad = 0.026;
    const g = sgrid(lin(0, 1, 8), lin(0, 1, 8), (u, v, pp) => { const a = (u - 0.5) * (2 * rad / R), y = cy + (v - 0.5) * 2 * rad; pp.set(ax + Math.cos(a) * R, y, -Math.sin(a) * R * 0.96); });
    outward(g, V(ax, cy, 0));
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) { const [a, b] = atlasUV('cross', uv.getX(i), uv.getY(i)); uv.setXY(i, a, b); }
    B.skinned('decal', vcol(g, 1), armW('R'), 0xffffff, { uv: false });
  } else if (id === 'fleece') {
    // fleece collar roll round the neck opening
    const pts = [];
    for (let i = 0; i <= 60; i++) { const a = -PI + 0.62 + (i / 60) * (TAU - 1.24), phi = a + PI; pts.push(coverPt(phi, 1.45, 0.012, V())); }
    const g = tubeR(pts, (t) => 0.014 * (1 + 0.12 * Math.sin(t * TAU * 37)), 10);
    displace(g, (x, y, z) => nz(x * 140 + z * 90, y * 140, 3) * 0.003);
    B.skinned('felt', vcol(g, 1), torsoW, 0xe8dcc4);
  } else if (id === 'gold') {
    // golden employee: gilded name bar over the pocket
    const phi = coverPhiX(-0.085, 1.31, true), p = coverPt(phi, 1.31, 0.006, V()), n = coverNrm(phi, 1.31, V());
    B.skinned('metal', vcol(pillow(0.06, 0.012, 0.003).applyMatrix4(frameAt(p, n)), 1), torsoW, 0xe8c050);
  }
  return B;
}

// ---------------------------------------------------------------------------
// Backpacks (+ harness straps on the coverall)
// ---------------------------------------------------------------------------
function strap(B, path, width, thick, col, mat = 'rubber') {
  const pts = [], nrm = [];
  for (const [phi, y, off] of path) { pts.push(coverPt(phi, y, off, V())); nrm.push(coverNrm(phi, y, V())); }
  const sm = curvePts(pts, 40), sn = curvePts(nrm, 40).map((n) => n.normalize());
  const g = ribbonOn(sm, sn, width, thick);
  B.skinned(mat, vcol(g, 1), torsoW, col, { uvScale: 3 });
}
function harness(B, col = 0x1d1e21, { chest = true } = {}) {
  for (const s of [-1, 1]) {
    const path = [];
    for (const y of lin(1.02, 1.4, 8)) path.push([coverPhiX(s * lerp(0.075, 0.085, (y - 1.02) / 0.38), y, true), y, 0.006]);
    path.push([s * 1.1, 1.445, 0.008], [s * 1.45, 1.452, 0.008]);
    for (const y of lin(1.43, 1.2, 5)) path.push([coverPhiX(s * 0.085, y, false), y, 0.006]);
    strap(B, path, 0.036, 0.004, col);
    // side-release buckle near the bottom
    const phi = coverPhiX(s * 0.076, 1.08, true), p = coverPt(phi, 1.08, 0.011, V()), n = coverNrm(phi, 1.08, V());
    B.skinned('plastic', vcol(pillow(0.036, 0.028, 0.008).applyMatrix4(frameAt(p, n)), 1), torsoW, 0x232326);
  }
  if (chest) {
    const path = lin(-1, 1, 8).map((t) => { const y = 1.3, phi = coverPhiX(t * 0.09, y, true); return [phi, y, 0.009]; });
    strap(B, path, 0.024, 0.003, col);
    const p = coverPt(0, 1.3, 0.013, V()), n = coverNrm(0, 1.3, V());
    B.skinned('plastic', vcol(pillow(0.03, 0.022, 0.008).applyMatrix4(frameAt(p, n)), 1), torsoW, 0x232326);
  }
}
export function buildPackPart(e) {
  const B = new RPartBuilder();
  const f = PACKS[e.id];
  if (f) f(B, e);
  return B;
}
const PACKS = {
  tank(B) {
    harness(B);
    // coolant / "breathing air" cylinder in a black backplate
    B.rigid('pack', 'plastic', vcol(pillow(0.17, 0.4, 0.03).translate(0, -0.06, -0.002), 1), 0x1e1f23);
    const yc = -0.07;
    B.rigid('pack', 'plastic', vcol(new THREE.CylinderGeometry(0.0585, 0.0585, 0.36, 28, 1, true).translate(0, yc, 0.07), 1), 0xe9e5da);
    const label = new THREE.CylinderGeometry(0.0592, 0.0592, 0.055, 28, 1, true);
    { const uv = label.attributes.uv; for (let i = 0; i < uv.count; i++) { const [a, b] = atlasUV('tank', uv.getX(i), uv.getY(i)); uv.setXY(i, a, b); } }
    B.rigid('pack', 'decal', vcol(label.translate(0, yc + 0.03, 0.07), 1), 0xffffff, { uv: false });
    const dome = (dir) => new THREE.SphereGeometry(0.0585, 24, 10, 0, TAU, 0, PI / 2).scale(1, 0.45, 1).rotateX(dir < 0 ? PI : 0).translate(0, yc + dir * 0.18, 0.07);
    B.rigid('pack', 'plastic', vcol(dome(1), 1), 0xe9e5da); B.rigid('pack', 'plastic', vcol(dome(-1), 1), 0xe9e5da);
    // valve + hand wheel + gauge on top
    B.rigid('pack', 'metal', vcol(new THREE.CylinderGeometry(0.014, 0.017, 0.04, 14).translate(0, yc + 0.22, 0.07), 0.75));
    B.rigid('pack', 'rubber', vcol(new THREE.TorusGeometry(0.02, 0.005, 6, 16).rotateX(PI / 2).translate(0, yc + 0.245, 0.07), 1), 0x2a2a2c);
    B.rigid('pack', 'metal', vcol(new THREE.CylinderGeometry(0.009, 0.009, 0.03, 10).rotateZ(PI / 2).translate(0.022, yc + 0.215, 0.07), 0.7));
    B.rigid('pack', 'plastic', vcol(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 18).rotateX(PI / 2).translate(0.045, yc + 0.215, 0.064), 1), 0x2a2a2c);
    B.rigid('pack', 'decal', region(new THREE.CircleGeometry(0.015, 18).rotateY(PI), 'gauge').translate(0.045, yc + 0.215, 0.0575), 0xffffff, { uv: false });
    // cable from the valve into the port at the back of the neck
    B.info.hoseStart = { bone: 'pack', pos: V(-0.016, yc + 0.215, 0.07), dir: V(-0.5, 0.7, -0.1).normalize() };
    B.info.hoseEnd = { bone: 'neck', pos: V(0.0, 0.0, 0.058), dir: V(0, -0.6, 0.8).normalize() };
  },
  satchel(B) {
    // canvas satchel on a single strap across the chest
    const path = [];
    for (const t of lin(0, 1, 10)) { const y = lerp(1.43, 1.05, t), x = lerp(0.1, -0.12, t); path.push([coverPhiX(x, y, true), y, 0.007]); }
    path.push([-1.9, 1.0, 0.008]);
    strap(B, path, 0.04, 0.004, 0x5a3d26, 'canvas');
    const back = [];
    for (const t of lin(0, 1, 8)) { const y = lerp(1.44, 1.06, t), x = lerp(0.1, -0.1, t); back.push([coverPhiX(x, y, false), y, 0.007]); }
    strap(B, back, 0.04, 0.004, 0x5a3d26, 'canvas');
    B.setRest('packA', [-0.2, -0.3, -0.12]);
    const body = pillow(0.07, 0.2, 0.24); displace(body, (x, y, z) => nz(x * 30, y * 30 + z * 20, 4) * 0.003);
    B.rigid('packA', 'canvas', vcol(body.translate(0, -0.08, 0), 1), 0x8a5a34);
    B.rigid('packA', 'canvas', vcol(pillow(0.074, 0.09, 0.244).translate(-0.003, -0.008, 0), 1), 0x6e4426);
    B.rigid('packA', 'metal', vcol(new THREE.BoxGeometry(0.004, 0.026, 0.03).translate(-0.04, -0.045, 0), 0.7));
    B.springs.packA = { k: 70, d: 5, gain: 0.02, mode: 'hang', grav: 0.6, limit: 0.5 };
  },
  jet(B) {
    harness(B, 0x2a2b30);
    for (const s of [-1, 1]) {
      const x = s * 0.06;
      B.rigid('pack', 'plastic', vcol(new THREE.CylinderGeometry(0.046, 0.046, 0.3, 24).translate(x, -0.05, 0.07), 1), 0xb8bcc0);
      B.rigid('pack', 'plastic', vcol(new THREE.SphereGeometry(0.046, 20, 10, 0, TAU, 0, PI / 2).translate(x, 0.1, 0.07), 1), 0xc8302a);
      B.rigid('pack', 'metal', vcol(new THREE.CylinderGeometry(0.03, 0.042, 0.06, 20, 1, true).translate(x, -0.23, 0.07), 0.55));
      B.rigid('pack', 'metal', vcol(new THREE.TorusGeometry(0.046, 0.004, 6, 24).rotateX(PI / 2).translate(x, 0.02, 0.07), 0.7));
    }
    B.rigid('pack', 'plastic', vcol(pillow(0.06, 0.26, 0.05).translate(0, -0.04, 0.03), 1), 0x2a2b30);
    B.setRest('packB', [0, -0.26, 0.07]);
    for (const s of [-1, 1]) {
      const fl = new THREE.ConeGeometry(0.03, 0.14, 14, 1, true).rotateX(PI).translate(s * 0.06, -0.07, 0);
      region(fl, 'flame');
      B.rigid('packB', 'decal', vcol(fl, 1), 0xffffff, { uv: false });
    }
    B.info.flames = 'packB';
  },
  bear(B) {
    harness(B, 0x5a3a22, { chest: false });
    const brown = 0x8a5a36;
    B.rigid('pack', 'felt', vcol(fuzz(0.1, 0.06, 2).scale(1, 1.2, 0.85).translate(0, -0.08, 0.08), 1), brown);
    B.setRest('packA', [0, 0.1, 0.09]);
    B.rigid('packA', 'felt', vcol(fuzz(0.075, 0.06, 4).translate(0, 0.04, 0), 1), brown);
    for (const s of [-1, 1]) {
      B.rigid('packA', 'felt', vcol(fuzz(0.028, 0.08, 6).scale(1, 1, 0.6).translate(s * 0.055, 0.1, 0.0), 1), brown);
      B.rigid('packA', 'bead', vcol(new THREE.SphereGeometry(0.009, 12, 8).translate(s * 0.026, 0.055, 0.068), 0.05));
      B.rigid('pack', 'felt', vcol(fuzz(0.03, 0.08, 7).scale(1, 2.2, 1).rotateZ(s * -0.9).translate(s * 0.11, -0.02, 0.02), 1), brown);
    }
    B.rigid('packA', 'felt', vcol(fuzz(0.028, 0.06, 8).scale(1.2, 0.9, 1).translate(0, 0.025, 0.065), 1), 0xc89a70);
    B.rigid('packA', 'bead', vcol(new THREE.SphereGeometry(0.008, 10, 8).translate(0, 0.035, 0.09), 0.05));
    B.springs.packA = { k: 60, d: 4, gain: 0.02, limit: 0.4 };
  },
  turtle(B) {
    harness(B, 0x3a4a2a, { chest: false });
    const g = new THREE.SphereGeometry(0.2, 32, 16, 0, TAU, 0, PI / 2).scale(0.95, 0.45, 1.25).rotateX(PI / 2).translate(0, -0.07, 0.0);
    vcol(g, (x, y, z) => { const hx = Math.round(x / 0.07), hy = Math.round((y + 0.07) / 0.07 + (hx % 2) * 0.5); const k = 0.75 + 0.25 * ((hx * 7 + hy * 3) % 3) / 2; const e = Math.abs(x - hx * 0.07) > 0.03 || Math.abs((y + 0.07) / 0.07 + (hx % 2) * 0.5 - hy) > 0.42 ? 0.55 : 1; return [0.36 * k * e, 0.48 * k * e, 0.22 * k * e]; });
    B.rigid('pack', 'plastic', g);
    B.rigid('pack', 'plastic', vcol(new THREE.TorusGeometry(0.19, 0.012, 8, 40).scale(0.95, 1.25, 1).translate(0, -0.07, 0.0), 1), 0x6a5a2a);
  },
};

// ---------------------------------------------------------------------------
// Hats
// ---------------------------------------------------------------------------
export function buildHatPart(e) {
  const B = new RPartBuilder();
  const f = HATS[e.id];
  if (f) f(B, e);
  return B;
}
// a hat rim line: lower at the back, clear of the brows at the front
const rimLine = (front, back) => (th) => lerp(front, back, (1 - Math.cos(th)) / 2);
const HATS = {
  bucket(B, e) {
    const rim = rimLine(0.42, 0.18);
    const crown = capGeo(rim, (th, s) => 0.008 + 0.006 * s, { nu: 48, nv: 12, shape: (p, th, s) => { if (s > 0.6) p.y = Math.min(p.y, HTOP + 0.016); }, fold: (x, y, z) => nz(Math.atan2(x, z) * 3, y * 30, 2) * 0.004 });
    B.rigid('hat', 'canvas', vcol(crown, (x, y, z) => 0.94 + nz(x * 30 + z * 20, y * 30, 6) * 0.1), e.color);
    const edge = (th) => hp(th, rim(th), 0.008);
    B.rigid('hat', 'canvas', vcol(brimGeo(edge, (th) => 0.048 + 0.006 * Math.cos(th * 2), (th) => 0.022 + 0.006 * Math.abs(Math.sin(th)), 0.004), 0.9), e.color);
    B.rigid('hat', 'canvas', vcol(bandGeo(0, 0.12, 0.012, { rimFn: rim }), 0.62), e.color);
    B.springs.hat = { k: 110, d: 7, gain: 0.005, limit: 0.12 };
  },
  beanie(B, e) {
    const rim = rimLine(0.5, 0.05);
    const cap = capGeo(rim, 0.006, { nu: 48, nv: 12, fold: (x, y, z) => Math.sin(Math.atan2(x, z) * 30) * 0.0009 + nz(x * 40, y * 40 + z * 20, 5) * 0.002 });
    B.rigid('hat', 'knit', vcol(cap, (x, y, z) => mul(C(e.color), 0.9 + 0.1 * Math.sin(Math.atan2(x, z) * 30))));
    const cuff = bandGeo(-0.02, 0.2, 0.013, { rimFn: rim, fold: (x, y, z) => Math.sin(Math.atan2(x, z) * 40) * 0.002 });
    B.rigid('hat', 'knit', vcol(cuff, (x, y, z) => mul(C(e.color), 0.8 + 0.2 * (0.5 + 0.5 * Math.sin(Math.atan2(x, z) * 40)))));
    B.setRest('hatA', [0, HTOP + 0.006, 0.004]);
    const pom = fuzz(0.032, 0.35, 3, 3);
    const c1 = C(e.color), c2 = C(e.color2 ?? e.color);
    B.rigid('hatA', 'knit', vcol(pom.translate(0, 0.028, 0), (x, y, z) => (valueNoise2(x * 200 + z * 70, y * 200, 3) > 0.6 ? c2 : c1)));
    B.springs.hat = { k: 120, d: 8, gain: 0.004, limit: 0.1 };
    B.springs.hatA = { k: 55, d: 3.6, gain: 0.03, limit: 0.7 };
  },
  hardhat(B, e) {
    const rim = rimLine(0.42, 0.22);
    const shell = capGeo(rim, (th, s) => 0.017 + 0.004 * (1 - s), { nu: 48, nv: 12 });
    B.rigid('hat', 'plastic', vcol(shell, 1), e.color);
    const ridge = lin(-1.25, 1.25, 20).map((t) => hp(t < 0 ? 0 : PI, PI / 2 - Math.abs(t) * 0.9, 0.024));
    B.rigid('hat', 'plastic', vcol(tubeR(ridge, (t) => 0.007 * Math.sin(PI * (0.08 + t * 0.84)), 8), 1), e.color);
    const edge = (th) => hp(th, rim(th), 0.019);
    B.rigid('hat', 'plastic', vcol(brimGeo(edge, (th) => 0.01 + 0.034 * Math.pow(Math.max(0, Math.cos(th)), 3), (th) => 0.006 + 0.008 * Math.pow(Math.max(0, Math.cos(th)), 2), 0.005), 1), e.color);
    B.rigid('hat', 'rubber', vcol(bandGeo(-0.02, 0.06, 0.004, { rimFn: rim }), 0.15));
    B.springs.hat = { k: 140, d: 9, gain: 0.003, limit: 0.12 };
  },
  party(B, e) {
    const base = V(0.012, HTOP - 0.012, 0.0), rot = new THREE.Euler(-0.1, 0, 0.28), M = new THREE.Matrix4().makeRotationFromEuler(rot);
    const cone = new THREE.CylinderGeometry(0.004, 0.05, 0.15, 28, 8, true);
    const c1 = C(e.color), c2 = C(e.color2);
    vcol(cone, (x, y, z) => { const a = Math.atan2(x, z) / TAU + y * 8; return ((Math.floor(a * 6) % 2) + 2) % 2 ? c1 : c2; });
    B.rigid('hat', 'plastic', cone.translate(0, 0.075, 0).applyMatrix4(M).translate(base.x, base.y, base.z));
    const rimR = new THREE.TorusGeometry(0.049, 0.006, 8, 28).rotateX(PI / 2); displace(rimR, (x, y, z) => nz(x * 400, z * 400 + y * 200, 2) * 0.003);
    B.rigid('hat', 'felt', vcol(rimR.applyMatrix4(M).translate(base.x, base.y, base.z), 1), 0xf25a8a);
    // elastic under the chin
    const pts = curvePts([hp(-PI / 2 + 0.2, 0.3, 0.003), hp(-PI / 2 + 0.25, -0.5, 0.004), hp(0, -1.1, 0.012), hp(PI / 2 - 0.25, -0.5, 0.004), hp(PI / 2 - 0.2, 0.3, 0.003)], 30);
    B.rigid('hat', 'rubber', vcol(tubeR(pts, 0.0009, 4), 0.85), 0xffffff, { uv: false });
    const tip = V(0, 0.15, 0).applyEuler(rot).add(base);
    B.setRest('hatA', tip.toArray(), [rot.x, rot.y, rot.z]);
    B.rigid('hatA', 'felt', vcol(fuzz(0.016, 0.4, 7).translate(0, 0.012, 0), 1), 0xf25a8a);
    B.springs.hat = { k: 120, d: 8, gain: 0.004, limit: 0.15 };
    B.springs.hatA = { k: 80, d: 4, gain: 0.02, limit: 0.6 };
  },
  cone(B, e) {
    const M = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-0.06, 0, -0.1)), y0 = HTOP - 0.03;
    const prof = [[0.066, 0], [0.064, 0.012], [0.045, 0.08], [0.026, 0.15], [0.016, 0.185], [0.012, 0.19], [0, 0.192]];
    const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 28);
    vcol(g, (x, y) => (Math.abs(y - 0.095) < 0.016 || Math.abs(y - 0.048) < 0.011 ? [0.95, 0.95, 0.93] : C(e.color)));
    B.rigid('hat', 'rubber', g.applyMatrix4(M).translate(0, y0, 0));
    const base = new THREE.BoxGeometry(0.15, 0.012, 0.15).translate(0, 0.004, 0);
    B.rigid('hat', 'rubber', vcol(base.applyMatrix4(M).translate(0, y0 - 0.006, 0), 0.65), e.color);
    B.springs.hat = { k: 90, d: 6, gain: 0.006, limit: 0.15 };
  },
  propeller(B) {
    const rim = rimLine(0.5, 0.25);
    const cols = [0xd8342a, 0xf2c418, 0x2f6fd0, 0x3aa04a].map(C);
    const cap = capGeo(rim, 0.006, { nu: 48, nv: 10 });
    B.rigid('hat', 'canvas', vcol(cap, (x, y, z) => cols[Math.floor(((Math.atan2(x, z) + PI) / TAU) * 6) % 4]));
    const edge = (th) => hp(th, rim(th), 0.006);
    B.rigid('hat', 'canvas', vcol(brimGeo(edge, (th) => 0.045 * Math.pow(Math.max(0, Math.cos(th)), 4) + 0.001, (th) => 0.008 * Math.max(0, Math.cos(th)), 0.004), 1), 0xd8342a);
    B.rigid('hat', 'metal', vcol(new THREE.CylinderGeometry(0.0035, 0.0035, 0.03, 8).translate(0, HTOP + 0.022, 0), 0.75));
    B.setRest('hatA', [0, HTOP + 0.037, 0]);
    for (const s of [0, 1]) {
      const blade = pillow(0.07, 0.003, 0.018).rotateX(0.25 * (s ? 1 : -1)).translate(0.038, 0, 0).rotateY(s * PI);
      B.rigid('hatA', 'plastic', vcol(blade, 1), s ? 0xf2c418 : 0x2f6fd0);
    }
    B.rigid('hatA', 'plastic', vcol(new THREE.SphereGeometry(0.007, 10, 8), 1), 0xd8342a);
    B.info.spin = 'hatA';
  },
  chef(B, e) {
    const rim = rimLine(0.5, 0.3);
    B.rigid('hat', 'canvas', vcol(bandGeo(0, 0.42, 0.007, { rimFn: rim }), 0.95), e.color);
    const top = fuzz(0.085, 0.18, 5, 3).scale(1, 0.62, 1).translate(0, HTOP + 0.06, 0.004);
    B.rigid('hat', 'canvas', vcol(top, (x, y, z) => 0.92 + 0.08 * Math.sin(Math.atan2(x, z) * 9)), e.color);
    B.rigid('hat', 'canvas', vcol(new THREE.CylinderGeometry(0.074, 0.078, 0.06, 28, 1, true).translate(0, HTOP + 0.015, 0.004), 0.96), e.color);
    B.springs.hat = { k: 100, d: 6, gain: 0.006, limit: 0.15 };
  },
  sprout(B) {
    // a seedling growing out of a crack in the crown
    const crack = curvePts([hp(-0.3, 1.25, 0.0005), hp(0.2, 1.4, 0.0005), hp(0.9, 1.3, 0.0005)], 14);
    B.rigid('hat', 'rubber', vcol(tubeR(crack, 0.0011, 4), 0.06), 0xffffff, { uv: false });
    B.setRest('hatA', hp(0.2, 1.4, 0).toArray());
    const stem = curvePts([V(0, -0.004, 0), V(0.002, 0.02, 0), V(-0.004, 0.04, 0.002), V(0, 0.055, 0)], 10);
    B.rigid('hatA', 'felt', vcol(tubeR(stem, (t) => 0.0024 * (1 - t * 0.4), 6), 1), 0x5a9a3a);
    for (const s of [-1, 1]) {
      const leaf = new THREE.SphereGeometry(1, 12, 8).scale(0.016, 0.003, 0.009).translate(s * 0.016, 0, 0).rotateZ(s * 0.5).translate(0, 0.055, 0);
      B.rigid('hatA', 'felt', vcol(leaf, (x, y, z) => [0.35, 0.62 + 0.1 * Math.sign(y), 0.25]), 0xffffff);
    }
    B.springs.hatA = { k: 45, d: 3, gain: 0.03, limit: 0.6 };
  },
  headlamp(B) {
    const rim = rimLine(0.66, 0.15);
    B.rigid('hat', 'rubber', vcol(bandGeo(-0.06, 0.06, 0.004, { rimFn: rim, nu: 56 }), 0.12));
    const over = lin(-1, 1, 18).map((t) => hp(t < 0 ? -PI / 2 : PI / 2, PI / 2 - Math.abs(t) * 1.25, 0.004));
    B.rigid('hat', 'rubber', vcol(tubeR(over, 0.0032, 6), 0.12));
    const n = V(), p = headPoint(0, 0.7, plateClear(0, 0.7) + 0.012, V(), n).sub(HC);
    const f = frameAt(p, n);
    B.rigid('hat', 'plastic', vcol(pillow(0.05, 0.034, 0.03).applyMatrix4(f), 1), 0x2a2b30);
    B.rigid('hat', 'metal', vcol(new THREE.CylinderGeometry(0.014, 0.016, 0.008, 18).rotateX(PI / 2).translate(0, 0, 0.017).applyMatrix4(f), 0.8));
    B.rigid('hat', 'decal', region(new THREE.CircleGeometry(0.0125, 18), 'lens').translate(0, 0, 0.0215).applyMatrix4(f), 0xffffff, { uv: false });
    B.info.lamp = { bone: 'hat', pos: p.clone().addScaledVector(n, 0.025), dir: n.clone() };
  },
  tophat(B, e) {
    const rim = rimLine(0.62, 0.42);
    B.rigid('hat', 'felt', vcol(new THREE.CylinderGeometry(0.068, 0.062, 0.15, 30, 1, true).translate(0, HTOP + 0.05, 0.006), 1), e.color);
    B.rigid('hat', 'felt', vcol(new THREE.CircleGeometry(0.068, 30).rotateX(-PI / 2).translate(0, HTOP + 0.125, 0.006), 0.9), e.color);
    B.rigid('hat', 'felt', vcol(new THREE.CylinderGeometry(0.0635, 0.0625, 0.026, 30, 1, true).scale(1.02, 1, 1.02).translate(0, HTOP + 0.0, 0.006), 1), 0x6a1a22);
    const edge = (th) => V(Math.sin(th) * 0.064, HTOP - 0.023, -Math.cos(th) * 0.064 + 0.006);
    B.rigid('hat', 'felt', vcol(brimGeo(edge, (th) => 0.03, (th) => -0.008 * Math.abs(Math.sin(th)), 0.004), 0.9), e.color);
    B.rigid('hat', 'felt', vcol(bandGeo(0.0, 0.1, 0.002, { rimFn: rim }), 0.9), e.color);
    B.springs.hat = { k: 120, d: 7, gain: 0.006, limit: 0.15 };
  },
  bunny(B, e) {
    const pts = lin(-1, 1, 24).map((t) => hp(t * (PI / 2 + 0.05), PI / 2 - 0.12 - Math.abs(t) * 0.9, 0.005));
    B.rigid('hat', 'plastic', vcol(tubeR(pts, 0.0035, 6), 1), 0xe8e2d6);
    for (const [S, s] of [['hatA', -1], ['hatB', 1]]) {
      const base = hp(s * PI / 2 * 0.36, PI / 2 - 0.42, 0.008);
      B.setRest(S, base.toArray(), [0, 0, -s * 0.18]);
      const ear = new THREE.SphereGeometry(1, 16, 12).scale(0.018, 0.062, 0.008).translate(0, 0.058, 0);
      B.rigid(S, 'felt', vcol(ear, 1), e.color);
      B.rigid(S, 'felt', vcol(new THREE.SphereGeometry(1, 12, 10).scale(0.011, 0.046, 0.003).translate(0, 0.058, -0.007), 1), 0xe8a0a8);
      B.springs[S] = { k: 50, d: 3, gain: 0.025, limit: 0.6 };
    }
  },
  halo(B) {
    B.setRest('hatA', [0, HTOP + 0.06, 0.0]);
    const t = new THREE.TorusGeometry(0.06, 0.006, 8, 36).rotateX(PI / 2);
    B.rigid('hatA', 'decal', vcol(region(t, 'glow'), 1), 0xffffff, { uv: false });
    B.info.halo = 'hatA';
  },
  crown(B) {
    const prof = [];
    const g = grid(40, 4, (i, j, p) => {
      const a = (i / 40) * TAU, v = j / 4, peak = 0.022 * Math.pow(Math.abs(Math.cos(a * 3.5)), 3);
      p.set(Math.sin(a) * 0.058 * (1 + 0.06 * v), HTOP - 0.025 + v * (0.026 + peak), -Math.cos(a) * 0.058 * (1 + 0.06 * v) + 0.004);
    }, { closedU: true });
    void prof;
    ensureOutward(g, V(0, HTOP, 0));
    const g2 = g.clone(); { const I = g2.index.array; for (let k = 0; k < I.length; k += 3) { const x = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = x; } g2.computeVertexNormals(); }
    B.rigid('hat', 'metal', vcol(g, 1), 0xe8b84a);
    B.rigid('hat', 'metal', vcol(g2, 0.7), 0xe8b84a);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU;
      B.rigid('hat', 'bead', vcol(new THREE.SphereGeometry(0.0055, 10, 8).translate(Math.sin(a) * 0.062, HTOP - 0.012, -Math.cos(a) * 0.062 + 0.004), k % 2 ? [0.7, 0.06, 0.1] : [0.08, 0.2, 0.7]));
    }
    B.springs.hat = { k: 140, d: 8, gain: 0.004, limit: 0.12 };
  },
};

// ---------------------------------------------------------------------------
// Face gear (head-bone space)
// ---------------------------------------------------------------------------
export function buildVisorPart(e) {
  const B = new RPartBuilder();
  const f = VISORS[e.id];
  if (f) f(B, e);
  return B;
}
const eyeC = (s) => eyeCentre(eyeLayout('normal')[s < 0 ? 0 : 1], 'normal');
const hpH = (th, ph, off) => headPoint(th, ph, plateClear(th, ph) + off);   // head space
function strapRound(B, ph, off, w, col, thFront = 0.95) {
  // elastic strap from one temple round the back of the head to the other
  const pts = lin(thFront, TAU - thFront, 30).map((th) => hpH(th, ph + 0.08 * Math.cos(th), off));
  B.rigid('head', 'rubber', vcol(tubeR(pts, w, 6), 1), col);
}
const VISORS = {
  goggles(B) {
    for (const s of [-1, 1]) {
      const c = eyeC(s), n = V(Math.sin(s * 0.25), 0.05, -1).normalize();
      const f = frameAt(c.clone().addScaledVector(n, 0.016), n);
      B.rigid('head', 'rubber', vcol(new THREE.CylinderGeometry(0.022, 0.024, 0.016, 24, 1, true).rotateX(PI / 2).applyMatrix4(f), 1), 0x2a2b2e);
      B.rigid('head', 'plastic', vcol(new THREE.TorusGeometry(0.021, 0.0035, 8, 24).translate(0, 0, 0.008).applyMatrix4(f), 1), 0xd8a432);
      B.rigid('head', 'glass', new THREE.CircleGeometry(0.02, 24).translate(0, 0, 0.007).applyMatrix4(f), 0xffffff, { uv: false });
    }
    const bridge = curvePts([eyeC(-1).add(V(0.018, 0.004, -0.02)), hpH(0, 0.1, 0.006), eyeC(1).add(V(-0.018, 0.004, -0.02))], 8);
    B.rigid('head', 'rubber', vcol(tubeR(bridge, 0.003, 6), 1), 0x2a2b2e);
    strapRound(B, 0.15, 0.004, 0.003, 0x3a3c40, 0.62);
  },
  face_shield(B) {
    const g = sgrid(lin(-1.15, 1.15, 26), lin(-1.05, 0.62, 14), (th, ph, p) => {
      const base = headPoint(th, ph, 0, V());
      const c = V(0, HC.y - 0.01, HC.z + 0.02), d = base.sub(c), L = d.length();
      p.copy(c).addScaledVector(d.normalize(), L + 0.03 + 0.012 * Math.cos(th));
    });
    outward(g, HC);
    B.rigid('head', 'glass', g, 0xffffff, { uv: false });
    const band = lin(-PI + 0.01, PI - 0.01, 40).map((th) => hpH(th, 0.62, 0.006 + (Math.abs(th) < 1.15 ? 0.026 : 0)));
    B.rigid('head', 'plastic', vcol(tubeR(band, 0.006, 6).scale(1, 1, 1), 1), 0x2a2b30);
  },
  gas_mask_up(B) {
    // respirator over nose + mouth (strapped on, the jaw still moves behind it)
    const g = sgrid(lin(-0.75, 0.75, 18), lin(-0.85, 0.02, 12), (th, ph, p) => { const k = Math.cos(th * 1.1) * Math.cos((ph + 0.4) * 1.6); headPoint(th, ph, plateOff(th, ph) + 0.004 + 0.022 * k, p); });
    outward(g, HC);
    B.rigid('head', 'rubber', vcol(g, 1), 0x2a2b2e);
    const n = V(), c = headPoint(0, -0.42, plateOff(0, -0.42) + 0.03, V(), n);
    for (const s of [-1, 1]) {
      const fn = V(s * 0.75, -0.25, -0.62).normalize();
      const pp = c.clone().add(V(s * 0.03, -0.004, 0.004));
      const f = frameAt(pp, fn);
      const can = new THREE.CylinderGeometry(0.02, 0.02, 0.022, 20).rotateX(PI / 2).translate(0, 0, 0.012).applyMatrix4(f);
      B.rigid('head', 'plastic', vcol(can, 1), 0x2c2d30);
      B.rigid('head', 'decal', region(new THREE.CircleGeometry(0.019, 20), 'filter').translate(0, 0, 0.0235).applyMatrix4(f), 0xffffff, { uv: false });
    }
    B.rigid('head', 'plastic', vcol(new THREE.CylinderGeometry(0.012, 0.014, 0.012, 16).rotateX(PI / 2).applyMatrix4(frameAt(c.clone().add(V(0, -0.012, -0.004)), n)), 1), 0x3a3c40);
    strapRound(B, -0.2, 0.003, 0.003, 0x1d1e21, 0.7);
    strapRound(B, 0.35, 0.003, 0.003, 0x1d1e21, 0.75);
  },
  glasses(B) { specs(B, 'metal', 0x8a8478, 'glass', 0.0016); },
  sunglasses(B) { specs(B, 'plastic', 0x141416, 'bead', 0.0028, true); },
};
function specs(B, fMat, fCol, lMat, fr, dark = false) {
  for (const s of [-1, 1]) {
    const c = eyeC(s), f = frameAt(c.clone().add(V(0, 0, -0.021)), V(s * 0.12, 0, -1).normalize());
    const R = dark ? 0.019 : 0.0175;
    const ring = new THREE.TorusGeometry(R, fr, 6, 28); if (dark) ring.scale(1.12, 0.86, 1);
    B.rigid('head', fMat, vcol(ring.applyMatrix4(f), 1), fCol);
    const lens = new THREE.CircleGeometry(R, 28); if (dark) lens.scale(1.12, 0.86, 1);
    B.rigid('head', lMat, vcol(lens.applyMatrix4(f), dark ? 0.04 : 1), 0xffffff, { uv: false });
    // temple arm back to the ear
    const a = c.clone().add(V(s * (R + 0.002), 0.002, -0.021)), ear = headPoint(s * (PI / 2 - 0.15), 0.06, 0.006);
    B.rigid('head', fMat, vcol(tubeR(curvePts([a, a.clone().lerp(ear, 0.5).add(V(s * 0.004, 0, 0)), ear], 10), fr * 0.9, 5), 1), fCol);
  }
  const l = eyeC(-1).add(V(0.0175, 0.003, -0.021)), r = eyeC(1).add(V(-0.0175, 0.003, -0.021));
  B.rigid('head', fMat, vcol(tubeR(curvePts([l, l.clone().lerp(r, 0.5).add(V(0, 0.005, -0.004)), r], 8), fr, 5), 1), fCol);
}

// ---------------------------------------------------------------------------
// Accessories
// ---------------------------------------------------------------------------
export function buildAccPart(e) {
  const B = new RPartBuilder();
  const f = ACCS[e.id];
  if (f) f(B, e);
  return B;
}
const NECK_C = () => V(0, RY.neck + 0.012, NECK_Z + 0.002);
const ACCS = {
  scarf(B, e) {
    const c = NECK_C(), c1 = C(e.color), c2 = C(e.color2);
    const g = new THREE.TorusGeometry(0.054, 0.02, 12, 36).rotateX(PI / 2).scale(1, 1.4, 1.05).translate(c.x, c.y + 0.0, c.z);
    displace(g, (x, y, z) => nz(x * 120 + z * 80, y * 90, 2) * 0.004);
    vcol(g, (x, y, z) => ((Math.floor((x + 1) / 0.012) + Math.floor((y + 1) / 0.012)) % 2 ? c1 : c2));
    B.skinned('knit', g, torsoW);
    B.setRest('accA', [-0.035, RD.neckY - 0.03, -0.075]);
    const tail = new THREE.BoxGeometry(0.05, 0.2, 0.012, 2, 8, 1).translate(0, -0.1, 0);
    displace(tail, (x, y, z) => nz(x * 100, y * 60, 3) * 0.003);
    vcol(tail, (x, y, z) => ((Math.floor((x + 1) / 0.012) + Math.floor((y + 1) / 0.012)) % 2 ? c1 : c2));
    B.rigid('accA', 'knit', tail.rotateZ(0.12));
    B.springs.accA = { k: 60, d: 4, gain: 0.02, mode: 'hang', grav: 0.7, limit: 0.6 };
  },
  fannypack(B, e) {
    torsoBand(B, 1.0, 0.022, 0x15161a, 0.012, 'rubber');
    B.setRest('acc', [0.0, 0.075, -0.115]);
    B.rigid('acc', 'canvas', vcol(pillow(0.17, 0.075, 0.06).translate(0, 0, -0.01), 1), e.color);
    B.rigid('acc', 'canvas', vcol(pillow(0.12, 0.04, 0.02).translate(0, -0.006, -0.042), 1), e.color2);
    B.rigid('acc', 'metal', vcol(new THREE.BoxGeometry(0.03, 0.003, 0.004).translate(0, 0.024, -0.042), 0.7));
    B.springs.acc = { k: 90, d: 6, gain: 0.008, mode: 'hang', limit: 0.3 };
  },
  tie(B, e) {
    const p = coverPt(0, V0Y + 0.12, 0.0, V());
    B.setRest('accA', [0, V0Y + 0.125 - RY.chest, p.z - 0.004]);
    const knot = pillow(0.026, 0.024, 0.014);
    B.rigid('accA', 'canvas', vcol(knot, 1), e.color);
    const blade = new THREE.Shape(); blade.moveTo(-0.01, 0); blade.lineTo(0.01, 0); blade.lineTo(0.03, -0.26); blade.lineTo(0, -0.29); blade.lineTo(-0.03, -0.26); blade.closePath();
    const bg = new THREE.ExtrudeGeometry(blade, { depth: 0.004, bevelEnabled: false }).translate(0, -0.008, -0.004);
    vcol(bg, (x, y) => (Math.floor((y * 1.5 - x) / 0.018) % 2 ? C(e.color) : C(e.color2)));
    B.rigid('accA', 'canvas', bg);
    B.springs.accA = { k: 70, d: 4, gain: 0.015, mode: 'hang', grav: 0.5, limit: 0.5 };
  },
  bowtie(B, e) {
    B.setRest('accA', [0, RD.neckY - 0.016, -0.06]);
    for (const s of [-1, 1]) B.rigid('accA', 'canvas', vcol(new THREE.ConeGeometry(0.018, 0.04, 12).rotateZ(s * PI / 2).scale(1, 1, 0.45).translate(s * 0.02, 0, 0), 1), e.color);
    B.rigid('accA', 'canvas', vcol(pillow(0.012, 0.016, 0.012), 0.8), e.color);
    B.springs.accA = { k: 100, d: 6, gain: 0.006, limit: 0.2 };
  },
  lei(B) {
    const c = NECK_C(), cols = [0xf25a8a, 0xf2c418, 0xf08a1e, 0xe84a4a, 0xf4f0e8].map(C);
    const N = 22;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU, droop = Math.max(0, -Math.cos(a)) * 0.05;
      const p = V(c.x + Math.sin(a) * 0.105, c.y - 0.022 - droop, c.z - Math.cos(a) * 0.075);
      const fl = new THREE.IcosahedronGeometry(0.0125, 1).scale(1, 0.6, 1).translate(p.x, p.y, p.z);
      B.skinned('felt', vcol(fl, cols[i % cols.length]), torsoW);
    }
  },
  bandana(B, e) {
    const c = NECK_C();
    const g = new THREE.TorusGeometry(0.05, 0.011, 8, 30).rotateX(PI / 2).translate(c.x, c.y - 0.006, c.z);
    B.skinned('canvas', vcol(g, 1), torsoW, e.color);
    B.setRest('accA', [0, RD.neckY - 0.02, -0.058]);
    const tri = new THREE.Shape(); tri.moveTo(-0.05, 0); tri.lineTo(0.05, 0); tri.lineTo(0, -0.07); tri.closePath();
    B.rigid('accA', 'canvas', vcol(new THREE.ExtrudeGeometry(tri, { depth: 0.003, bevelEnabled: false }).rotateX(0.35), (x, y) => 0.9 + 0.1 * Math.sin((x + y) * 300)), e.color);
    B.springs.accA = { k: 70, d: 5, gain: 0.012, mode: 'hang', grav: 0.5, limit: 0.4 };
  },
  headphones(B) {
    const c = NECK_C();
    const arc = lin(-PI / 2 - 0.3, PI / 2 + 0.3, 20).map((a) => V(c.x + Math.sin(a) * 0.068, c.y - 0.01 + 0.012 * Math.cos(a), c.z + Math.cos(a) * 0.065));
    B.skinned('plastic', vcol(tubeR(arc, 0.006, 6), 1), torsoW, 0x2a2b30);
    for (const s of [-1, 1]) {
      const p = V(c.x + s * 0.072, c.y - 0.03, c.z - 0.03), f = frameAt(p, V(s, 0.4, -0.3).normalize());
      B.skinned('plastic', vcol(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 20).rotateX(PI / 2).applyMatrix4(f), 1), torsoW, 0x2a2b30);
      B.skinned('rubber', vcol(new THREE.TorusGeometry(0.024, 0.008, 8, 20).translate(0, 0, -0.01).applyMatrix4(f), 1), torsoW, 0x404246);
    }
  },
  bell(B) {
    const c = NECK_C();
    B.skinned('felt', vcol(new THREE.TorusGeometry(0.046, 0.006, 8, 30).rotateX(PI / 2).translate(c.x, c.y + 0.004, c.z), 1), torsoW, 0xd02a3a);
    B.setRest('accA', [0, RD.neckY - 0.008, -0.05]);
    const bell = new THREE.SphereGeometry(0.016, 16, 12);
    B.rigid('accA', 'metal', vcol(bell.translate(0, -0.016, 0), 1), 0xe8c050);
    B.rigid('accA', 'metal', vcol(new THREE.TorusGeometry(0.004, 0.0015, 6, 12).translate(0, 0.0, 0), 1), 0xe8c050);
    B.rigid('accA', 'rubber', vcol(new THREE.BoxGeometry(0.018, 0.002, 0.004).translate(0, -0.022, -0.014), 0.1));
    B.springs.accA = { k: 60, d: 3, gain: 0.03, mode: 'hang', grav: 0.6, limit: 0.7 };
  },
  badge(B) {
    // Employee of the Month rosette on the right chest
    const phi = coverPhiX(0.085, 1.27, true), p = coverPt(phi, 1.27, 0.008, V()), n = coverNrm(phi, 1.27, V());
    const f = frameAt(p, n);
    const ros = new THREE.CylinderGeometry(0.032, 0.032, 0.006, 24).rotateX(PI / 2);
    displace(ros, (x, y, z) => Math.sin(Math.atan2(y, x) * 18) * 0.002);
    B.skinned('felt', vcol(ros.applyMatrix4(f), 1), torsoW, 0x2f4fa8);
    B.skinned('metal', vcol(new THREE.CylinderGeometry(0.02, 0.02, 0.004, 24).rotateX(PI / 2).translate(0, 0, 0.004).applyMatrix4(f), 1), torsoW, 0xe8c050);
    for (const s of [-1, 1]) B.skinned('felt', vcol(new THREE.BoxGeometry(0.018, 0.05, 0.002).rotateZ(s * 0.25).translate(s * 0.012, -0.045, -0.001).applyMatrix4(f), 1), torsoW, s < 0 ? 0xc83a3a : 0x2f4fa8);
    B.skinned('decal', vcol(region(new THREE.CircleGeometry(0.017, 20), 'patch').translate(0, 0, 0.0065).applyMatrix4(f), 1), torsoW, 0xffffff, { uv: false });
  },
};
const V0Y = 1.3;
void clamp; void gauss; void ss; void BI; void HEAD_Z; void FACE; void HEM_Y; void legW;
