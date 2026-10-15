// R.O.O.M. — clone android body: the R.O.O.M. work coverall (the old hazmat colourways) worn over a
// cheap injection-moulded ABS frame. Short rolled sleeves and an open collar show the robot: the
// chest plate with its unit serial, bare plastic forearms with clamshell seams and screws, elbow
// hinges with a cable loop, rubber wrist / ankle bellows, articulated hands with rubber palm pads,
// mannequin feet on black rubber soles. The trouser legs stop above the ankle.
//
// Rig rest space (feet at the origin, facing -Z, design scale 1.70 m) unless a function says it
// works in a bone's local space.
import * as THREE from 'three';
import { clamp, lerp } from './kit.js';
import { valueNoise2 } from '../../core/rng.js';
import { RD, RY, BI, RPartBuilder, torsoW, armW, legW, ss } from './robotrig.js';
import { grid, displace, tint, ensureOutward, gridArcUV, tubeR, curvePts, pillow, gauss } from './geom.js';
import { atlasUV, ATLAS } from './dolltex.js';
import { buildHead, buildNeck, vcol, region, frameAt, screwGeo, lin, sgrid, outward } from './robothead.js';
import { mergeSimple } from './suit.js';

const PI = Math.PI, TAU = PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const nz = (x, y, s) => valueNoise2(x, y, s) - 0.5;
const constW = (bone) => (x, y, z, o) => o.reset().add(bone, 1);
export const RUBBER_DK = 0x1c1b1a, MECH = 0x3a3836, CHROME = 0xd0d0cc, OLIVE = 0x596043, OLIVE_D = 0x3c4130, TRIM = 0x26272a;

// ============================================================================
// Coverall torso surface: superellipse sections, phi = 0 at the front (-Z), +PI/2 at +X
// ============================================================================
const COVER = [
  { y: 0.842, hw: 0.1, hd: 0.03, zc: 0.004, p: 2.2 },
  { y: 0.872, hw: 0.152, hd: 0.082, zc: 0.006, p: 2.4 },
  { y: 0.92, hw: 0.166, hd: 0.106, zc: 0.01, p: 2.6 },
  { y: 0.98, hw: 0.162, hd: 0.102, zc: 0.004, p: 2.6 },
  { y: 1.05, hw: 0.146, hd: 0.094, zc: -0.002, p: 2.5 },
  { y: 1.13, hw: 0.15, hd: 0.098, zc: -0.006, p: 2.5 },
  { y: 1.22, hw: 0.158, hd: 0.106, zc: -0.008, p: 2.6 },
  { y: 1.3, hw: 0.164, hd: 0.102, zc: -0.004, p: 2.8 },
  { y: 1.365, hw: 0.162, hd: 0.093, zc: 0.002, p: 3.0 },
  { y: 1.405, hw: 0.136, hd: 0.078, zc: 0.006, p: 2.8 },
  { y: 1.432, hw: 0.086, hd: 0.064, zc: 0.01, p: 2.4 },
  { y: 1.452, hw: 0.058, hd: 0.053, zc: 0.012, p: 2.2 },
];
export const COVER_Y0 = COVER[0].y, COVER_Y1 = COVER[COVER.length - 1].y;
const _sec = { hw: 0, hd: 0, zc: 0, p: 2 };
function sectionAt(y, S = COVER, out = _sec) {
  let i = 0;
  while (i < S.length - 2 && y > S[i + 1].y) i++;
  const a = S[i], b = S[i + 1];
  const u = clamp((y - a.y) / (b.y - a.y), 0, 1), t = u * u * (3 - 2 * u), k = lerp(u, t, 0.6);
  out.hw = lerp(a.hw, b.hw, k); out.hd = lerp(a.hd, b.hd, k); out.zc = lerp(a.zc, b.zc, k); out.p = lerp(a.p, b.p, k);
  return out;
}
// chest / shoulder-blade shaping
function bulge(phi, y) {
  const c = Math.cos(phi);
  return 0.008 * gauss(y, 1.27, 0.06) * Math.pow(Math.max(0, c), 2) * (1 - 0.6 * gauss(Math.sin(phi), 0, 0.15))
    + 0.006 * gauss(y, 1.3, 0.07) * Math.pow(Math.max(0, -c), 2) * Math.abs(Math.sin(phi * 1.0)) * 0.8;
}
export function coverPt(phi, y, off = 0, out = V(), shrink = 0) {
  const s = sectionAt(y), sn = Math.sin(phi), c = Math.cos(phi), e = 2 / s.p;
  const hw = s.hw - shrink, hd = s.hd - shrink;
  out.set(hw * Math.sign(sn) * Math.pow(Math.abs(sn), e), y, s.zc - hd * Math.sign(c) * Math.pow(Math.abs(c), e));
  const b = bulge(phi, y);
  if (b || off) { coverNrm(phi, y, _cn); out.addScaledVector(_cn, b + off); }
  return out;
}
const _cn = V(), _t1 = V(), _n1 = V(), _n2 = V(), _n3 = V(), _n4 = V(), _ns = { hw: 0, hd: 0, zc: 0, p: 2 };
export function coverNrm(phi, y, out = V()) {
  const e = 0.004;
  const raw = (ph, yy, o) => { const s = sectionAt(yy, COVER, _ns), sn = Math.sin(ph), c = Math.cos(ph), ee = 2 / s.p; return o.set(s.hw * Math.sign(sn) * Math.pow(Math.abs(sn), ee), yy, s.zc - s.hd * Math.sign(c) * Math.pow(Math.abs(c), ee)); };
  raw(phi + e, y, _n1); raw(phi - e, y, _n2); raw(phi, y + e, _n3); raw(phi, y - e, _n4);
  out.crossVectors(_n3.sub(_n4), _n1.sub(_n2)).normalize();
  raw(phi, y, _n1);
  if (out.x * _n1.x + out.z * _n1.z < 0) out.negate();
  return out;
}
// phi on the front (or back) whose surface x equals x at height y
export function coverPhiX(x, y, front = true) {
  let lo = front ? -PI / 2 : PI / 2, hi = front ? PI / 2 : 3 * PI / 2;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2, px = coverPt(m, y, 0, _t1).x;
    if (front ? px < x : px > x) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}
// V-neck: half opening angle (from the front) at height y
const V0 = 1.3;
export const VOPEN = (y) => (y < V0 ? 0 : 0.6 * Math.pow(clamp((y - V0) / 0.152, 0, 1), 0.75));
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function coverFold(x, y, z, phi) {
  const front = Math.max(0, Math.cos(phi)), back = Math.max(0, -Math.cos(phi)), ax = Math.abs(x);
  let d = 0;
  d += Math.sin(((y - 1.08 + 0.008 * Math.sin(phi * 5 + 1.3)) / 0.03) * TAU) * 0.0035 * gauss(y, 1.09, 0.03);   // bunching above the belt
  d += Math.sin(((y - 0.99) / 0.035) * TAU) * 0.003 * gauss(y, 1.0, 0.025);                                       // and below it
  const dx = ax - 0.16, dy = y - 1.33, r = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
  d += Math.sin(ang * 6 + 0.4) * 0.004 * ss(0.02, 0.05, r) * (1 - ss(0.1, 0.16, r)) * ss(-0.02, 0.05, -dy + 0.05);  // armpit folds
  d += Math.sin(((y - 0.9 - 1.2 * x * x) / 0.04) * TAU) * 0.004 * Math.pow(front, 1.3) * gauss(y, 0.89, 0.05) * ss(0.02, 0.07, ax); // crotch drag
  d += Math.sin(((y - 0.95) / 0.04) * TAU) * 0.0035 * Math.pow(back, 1.5) * gauss(y, 0.95, 0.05);                 // seat
  d += nz(phi * 2.2 + 3, y * 9, 5) * 0.007 + nz(phi * 5.5 + 1, y * 21, 7) * 0.003;
  d *= 1 - 0.8 * gauss(x, 0, 0.03) * front;                                                                         // zip line stays flat
  return d * ss(COVER_Y0, COVER_Y0 + 0.04, y) * (1 - ss(1.43, 1.452, y));
}
export function grime(x, y, z) {
  const low = ss(0.5, 0.12, y) * 0.12;
  const sm = Math.max(0, nz(x * 6 + 11, y * 6 + z * 4, 21) * 2 - 0.35) * 0.12;
  const sc = Math.max(0, nz(x * 25 + z * 19, y * 25, 23) * 2 - 0.7) * 0.14;
  return 1 - low - sm - sc;
}

function buildCoverTorso(B) {
  const nu = 84, nv = 50;
  const ys = lin(COVER_Y0, COVER_Y1, nv);
  // columns run round from the right edge of the V-neck to its left edge (the seam below the V is the zip)
  const g = grid(nu, nv, (i, j, p) => { const y = ys[j], vo = VOPEN(y); coverPt(vo + (i / nu) * (TAU - 2 * vo), y, 0, p); }, { closedU: true });
  ensureOutward(g, V(0, 1.1, 0));
  displace(g, (x, y, z) => coverFold(x, y, z, Math.atan2(x, -z)), { aoK: 0.22, aoAmp: 0.006 });
  tint(g, (x, y, z) => (1 - 0.1 * gauss(y, 0.86, 0.03) - 0.08 * gauss(Math.abs(x), 0.15, 0.03) * gauss(y, 1.33, 0.04)) * grime(x, y, z));
  gridArcUV(g, 1, 1);
  B.skinned('suit', g, torsoW);
  // the V edges fold back into lapels (inner face shows the same fabric)
  for (const side of [-1, 1]) {
    const N = 16;
    const lap = sgrid(lin(0, 1, 3), lin(V0 + 0.004, COVER_Y1 - 0.004, N), (w, y, p) => {
      const a = side * VOPEN(y), r = 0.022 + 0.022 * Math.sin(clamp((y - V0) / 0.15, 0, 1) * PI * 0.9);
      const phi = a + side * w * r / 0.12;
      coverPt(phi, y, 0.0045 + 0.0025 * (1 - w), p);
    });
    outward(lap, V(0, 1.38, 0.02));
    vcol(lap, (x, y, z) => 0.92 * grime(x, y, z));
    gridArcUV(Object.assign(lap, { userData: { grid: { nu: 3, nv: N } } }), 1, 1);
    B.skinned('suit', lap, torsoW);
  }
  // collar band round the back of the neck
  {
    const col = sgrid(lin(-PI + VOPEN(1.44) + 0.2, PI - VOPEN(1.44) - 0.2, 26).map((a) => a), lin(0, 1, 3), (a, v, p) => {
      const phi = a + PI;
      coverPt(phi, 1.442 + v * 0.03, 0.002 + v * 0.008, p);
    });
    outward(col, V(0, 1.45, 0.0));
    vcol(col, 0.9);
    B.skinned('suit', col, torsoW);
  }
}

// rolled short sleeve (stops above the elbow)
const SLEEVE_PROF = [[-0.032, 0.0], [-0.027, 0.022], [-0.014, 0.039], [0.008, 0.049], [0.05, 0.0505], [0.1, 0.0495], [0.14, 0.049], [0.17, 0.0485]];
export const SLEEVE_END = 0.17;
function buildSleeve(B, side) {
  const s = side === 'L' ? -1 : 1, ax = s * RD.shX, top = RY.sh;
  const curve = new THREE.SplineCurve(SLEEVE_PROF.map(([dy, r]) => new THREE.Vector2(r, dy))).getSpacedPoints(30);
  const g = grid(32, 30, (i, j, p) => {
    const q = curve[j], a = (i / 32) * TAU;
    p.set(ax + Math.cos(a) * q.x, top - q.y, Math.sin(a) * q.x * 0.96);
  }, { closedU: true, poleBottom: true });
  ensureOutward(g, V(ax, top - 0.08, 0));
  displace(g, (x, y, z) => {
    const dy = top - y, a = Math.atan2(z, x - ax);
    let d = Math.sin(((dy + 0.006 * Math.sin(2 * a + s)) / 0.03) * TAU) * 0.0025 * gauss(dy, 0.05, 0.03);
    d += nz(a * 1.6 + s * 5 + 9, dy * 14, 3) * 0.004;
    return d * ss(-0.03, 0.0, dy);
  }, { aoK: 0.18, aoAmp: 0.005 });
  tint(g, (x, y, z) => (1 - 0.1 * ss(0.0, -0.04, RY.sh - y) * ss(0.12, 0.2, Math.abs(x))) * grime(x, y, z));
  gridArcUV(g, 1, 1);
  B.skinned('suit', g, armW(side));
  // rolled cuff + inner annulus closing the opening down to the arm
  const cy = top - SLEEVE_END;
  const cuff = new THREE.TorusGeometry(0.0488, 0.0078, 10, 32).rotateX(PI / 2).scale(1, 1, 0.96).translate(ax, cy + 0.004, 0);
  vcol(cuff, (x, y, z) => 0.85 + 0.1 * Math.sin(Math.atan2(z, x - ax) * 9));
  B.skinned('suit', cuff, armW(side));
  const ring = new THREE.RingGeometry(0.035, 0.051, 32, 1).rotateX(PI / 2).translate(ax, cy - 0.002, 0);
  vcol(ring, 0.35);
  B.skinned('suit', ring, armW(side));
}

// trouser leg (to just above the ankle)
const LEG_PROF = [[-0.06, 0.03], [-0.035, 0.07], [-0.005, 0.087], [0.08, 0.083], [0.2, 0.074], [0.33, 0.066], [0.42, 0.062], [0.52, 0.058], [0.64, 0.056], [0.74, 0.058], [0.775, 0.06]];
export const HEM_Y = RY.pelvis - 0.775;
function buildTrouser(B, side) {
  const s = side === 'L' ? -1 : 1, ax = s * RD.hipX, top = RY.pelvis;
  const curve = new THREE.SplineCurve(LEG_PROF.map(([dy, r]) => new THREE.Vector2(r, dy))).getSpacedPoints(44);
  const g = grid(32, 44, (i, j, p) => {
    const q = curve[j], a = (i / 32) * TAU;
    p.set(ax + Math.cos(a) * q.x, top - q.y, 0.004 + Math.sin(a) * q.x);
  }, { closedU: true });
  ensureOutward(g, V(ax, top - 0.3, 0));
  displace(g, (x, y, z) => {
    const dy = top - y, a = Math.atan2(z - 0.004, x - ax);
    let d = Math.sin(((dy - RD.thigh + 0.01 * Math.sin(2 * a)) / 0.035) * TAU) * 0.004 * gauss(dy, RD.thigh, 0.04);  // knee
    d += Math.sin(((dy - 0.7 + 0.008 * Math.sin(3 * a + s)) / 0.03) * TAU) * 0.004 * gauss(dy, 0.71, 0.04);          // pooled at the hem
    d += Math.sin(((dy - 0.06) / 0.04) * TAU) * 0.003 * gauss(dy, 0.06, 0.03) * Math.max(0, Math.cos(a + PI / 2 * s)); // crotch
    d += nz(a * 1.5 + s * 7, dy * 10, 4) * 0.006;
    return d * ss(-0.02, 0.02, dy);
  }, { aoK: 0.2, aoAmp: 0.005 });
  tint(g, (x, y, z) => grime(x, y, z) * (1 - 0.12 * ss(0.4, 0.15, y)));
  gridArcUV(g, 1, 1);
  B.skinned('suit', g, legW(side));
  const cuff = new THREE.TorusGeometry(0.059, 0.007, 8, 32).rotateX(PI / 2).translate(ax, HEM_Y + 0.004, 0.004);
  vcol(cuff, 0.8);
  B.skinned('suit', cuff, legW(side));
  const ring = new THREE.RingGeometry(0.03, 0.06, 32, 1).rotateX(PI / 2).translate(ax, HEM_Y + 0.0, 0.004);
  vcol(ring, 0.3);
  B.skinned('suit', ring, legW(side));
}

// belt, zip, chest pocket, back stencil, sleeve patch
function buildCoverDetails(B) {
  // webbing belt + steel buckle
  {
    const g = grid(96, 3, (i, j, p) => { const phi = (i / 96) * TAU - PI, y = 1.045 + (j / 3 - 0.5) * 0.034; coverPt(phi, y, 0.0045 + 0.0012 * Math.sin(PI * j / 3), p); }, { closedU: true });
    ensureOutward(g, V(0, 1.045, 0));
    vcol(g, (x, y, z) => 0.16 + 0.03 * nz(x * 80, z * 80, 3));
    B.skinned('rubber', g, torsoW, 0xffffff, { uvScale: 2 });
    const p = coverPt(0, 1.045, 0.008, V()), n = coverNrm(0, 1.045, V());
    const buckle = pillow(0.05, 0.04, 0.008);
    buckle.applyMatrix4(frameAt(p, n));
    B.skinned('metal', vcol(buckle, 0.72), torsoW);
    const bar = new THREE.BoxGeometry(0.036, 0.004, 0.004).applyMatrix4(frameAt(p.clone().addScaledVector(n, 0.004), n));
    B.skinned('metal', vcol(bar, 0.4), torsoW);
  }
  // zip: steel teeth down the front from the belt to the V
  {
    const pts = [], nrm = [];
    for (const y of lin(1.075, V0 + 0.01, 24)) { pts.push(coverPt(0, y, 0.0028, V())); nrm.push(coverNrm(0, y, V())); }
    const teeth = [];
    pts.forEach((p, i) => {
      const t = new THREE.BoxGeometry(0.008, 0.0035, 0.0028);
      t.applyMatrix4(frameAt(p.clone().add(V((i % 2 ? 1 : -1) * 0.0018, 0, 0)), nrm[i]));
      teeth.push(t);
    });
    const g = mergeSimple(teeth);
    B.skinned('metal', vcol(g, 0.7), torsoW);
    // pull tab at the V
    const pp = coverPt(0, V0 + 0.012, 0.005, V()), pn = coverNrm(0, V0 + 0.012, V());
    const tab = new THREE.BoxGeometry(0.009, 0.022, 0.003).translate(0, -0.012, 0.0015).applyMatrix4(frameAt(pp, pn));
    B.skinned('metal', vcol(tab, 0.75), torsoW);
  }
  // chest pocket with flap on the left chest (+ the ID badge clipped to it)
  {
    const cx = -0.085, cy = 1.24, w = 0.09, h = 0.1;
    const phiC = coverPhiX(cx, cy, true);
    const pocket = sgrid(lin(-1, 1, 8), lin(-1, 1, 8), (u, v, p) => {
      const y = cy + v * h / 2, phi = coverPhiX(cx + u * w / 2, y, true);
      coverPt(phi, y, 0.0035 + 0.0025 * (1 - u * u) * (1 - v * v), p);
    });
    outward(pocket, V(cx, cy, 0));
    vcol(pocket, (x, y) => 0.9 - 0.15 * ss(cy - h / 2 + 0.006, cy - h / 2, y));
    B.skinned('suit', pocket, torsoW);
    const flap = sgrid(lin(-1.05, 1.05, 8), lin(0, 1, 3), (u, v, p) => {
      const y = cy + h / 2 - 0.004 - v * 0.03, phi = coverPhiX(cx + u * w / 2, y, true);
      coverPt(phi, y, 0.0075 + 0.002 * v, p);
    });
    outward(flap, V(cx, cy, 0));
    vcol(flap, (x, y, z, i) => 0.95 - 0.2 * (i >= 27 ? 1 : 0));
    B.skinned('suit', flap, torsoW);
    // ID badge on a clip, hanging over the pocket
    const frame = badgeFrame();
    void phiC;
    const card = pillow(BADGE.w + 0.004, BADGE.h + 0.004, 0.003).applyMatrix4(frame);
    B.skinned('plastic', vcol(card, 0.92), torsoW);
    const face = region(new THREE.PlaneGeometry(BADGE.w, BADGE.h), 'badge').translate(0, 0, 0.0018).applyMatrix4(frame);
    B.skinned('decal', vcol(face, 1), torsoW, 0xffffff, { uv: false });
    const clip = new THREE.BoxGeometry(0.016, 0.022, 0.004).translate(0, BADGE.h / 2 + 0.006, -0.002).applyMatrix4(frame);
    B.skinned('metal', vcol(clip, 0.75), torsoW);
  }
  // sprayed R.O.O.M. stencil across the upper back
  {
    const g = sgrid(lin(PI + 0.62, PI - 0.62, 14), lin(1.2, 1.29, 3), (phi, y, p) => coverPt(phi, y, 0.0035, p));
    outward(g, V(0, 1.25, 0));
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) { const [u, v] = atlasUV('stencil', uv.getX(i), uv.getY(i)); uv.setXY(i, u, v); }
    B.skinned('decal', vcol(g, 1), torsoW, 0xffffff, { uv: false });
  }
  // embroidered patch on the left sleeve (outer side)
  {
    const ax = -RD.shX, R = 0.058, cy = RY.sh - 0.075, rad = 0.026;
    const g = sgrid(lin(0, 1, 10), lin(0, 1, 10), (u, v, p) => {
      const a = PI + (u - 0.5) * (2 * rad / R), y = cy + (v - 0.5) * 2 * rad;
      p.set(ax + Math.cos(a) * R, y, Math.sin(a) * R * 0.96);
    });
    outward(g, V(ax, cy, 0));
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) { const [a, b] = atlasUV('patch', 1 - uv.getX(i), uv.getY(i)); uv.setXY(i, a, b); }
    B.skinned('decal', vcol(g, 1), armW('L'), 0xffffff, { uv: false });
  }
}
export const BADGE = { w: 0.046, h: 0.066, x: -0.085, y: 1.235 };
let _badgeFrame = null;
export function badgeFrame() {
  if (!_badgeFrame) {
    const phi = coverPhiX(BADGE.x, BADGE.y, true);
    _badgeFrame = frameAt(coverPt(phi, BADGE.y, 0.012, V()), coverNrm(phi, BADGE.y, V()));
  }
  return _badgeFrame;
}
// per-avatar badge digits (employee number), rigidly on the chest bone
export function badgeDigitsGeo(num) {
  const frame = badgeFrame();
  const parts = [];
  const str = String(num).padStart(4, '0').slice(-4);
  const dw = BADGE.w * 0.17, dh = dw * 1.8, y = BADGE.h / 2 - BADGE.h * (293 / 360);
  for (let i = 0; i < 4; i++) {
    const g = new THREE.PlaneGeometry(dw, dh), d = +str[i], uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) { const [a, b] = atlasUV([ATLAS.digits[0] + d * 40, ATLAS.digits[1], 40, ATLAS.digits[3]], uv.getX(k), uv.getY(k)); uv.setXY(k, a, b); }
    g.translate((i - 1.5) * dw * 1.05, y, 0.0024).applyMatrix4(frame);
    parts.push(g);
  }
  const g = mergeSimple(parts), n = g.attributes.position.count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { si[i * 4] = BI.chest; sw[i * 4] = 1; }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return g;
}

// ============================================================================
// Robot frame (visible parts)
// ============================================================================
// chest plate under the open collar + the neck socket
function buildChestPlate(B) {
  const ys = lin(1.25, 1.448, 14);
  const g = grid(48, 14, (i, j, p) => coverPt((i / 48) * TAU - PI, ys[j], 0, p, 0.007), { closedU: true });
  ensureOutward(g, V(0, 1.35, 0));
  vcol(g, (x, y, z) => {
    let k = 0.94 - 0.12 * ss(1.4, 1.448, y);
    k *= 1 - 0.55 * gauss(x, 0, 0.0016) * ss(1.3, 1.32, y);          // centre seam of the two shell halves
    k *= 1 - 0.4 * gauss(y, 1.395, 0.0018) * (1 - gauss(x, 0, 0.02)); // clavicle panel line
    return k * (0.96 + nz(x * 50, y * 50 + z * 30, 9) * 0.06);
  });
  B.skinned('shell', g, torsoW);
  // unit serial print on the sternum + two screws
  const p = coverPt(0, 1.355, -0.006, V()), n = coverNrm(0, 1.355, V());
  const ser = region(new THREE.PlaneGeometry(0.062, 0.0072 * 1.6), 'serial').applyMatrix4(frameAt(p, n));
  B.skinned('decal', vcol(ser, 1), torsoW, 0xffffff, { uv: false });
  for (const sx of [-1, 1]) {
    const phi = coverPhiX(sx * 0.032, 1.415, true), pp = coverPt(phi, 1.415, -0.0065, V()), nn = coverNrm(phi, 1.415, V());
    for (const s of screwGeo(pp, nn, 0.0028)) B.skinned('metal', s, torsoW, 0xb4b0a6);
  }
  const sock = new THREE.TorusGeometry(0.049, 0.006, 8, 28).rotateX(PI / 2).translate(0, RY.neck + 0.002, 0.012);
  B.skinned('metal', vcol(sock, 0.3), torsoW);
}

// visible arm below the sleeve: upper-arm shell end, elbow hinge, forearm, wrist bellows
function buildArm(B, side) {
  const s = side === 'L' ? -1 : 1, sh = 'sh' + side, el = 'el' + side, wr = 'wr' + side;
  // upper arm (sh-local: hangs along -Y)
  const ua = tubeLoft(lin(-0.12, -0.282, 14), (y) => lerp(0.041, 0.035, ss(-0.15, -0.27, y)) * (y < -0.27 ? Math.sqrt(Math.max(0, 1 - ((y + 0.27) / 0.0125) ** 2)) * 0.6 + 0.4 : 1), 24, { sz: 0.95, capEnd: true });
  vcol(ua, (x, y, z) => (1 - 0.4 * gauss(z, 0, 0.0018) * ss(-0.12, -0.14, y)) * (0.95 + nz(x * 60, y * 60, 2) * 0.06));
  B.rigid(sh, 'shell', ua);
  // elbow: dark joint ball + steel hinge pin across the joint + a cable loop inside the elbow
  B.rigid(el, 'metal', vcol(new THREE.SphereGeometry(0.026, 16, 12), 0.22));
  B.rigid(el, 'metal', vcol(new THREE.CylinderGeometry(0.011, 0.011, 0.07, 12).rotateZ(PI / 2), 0.75));
  for (const e of [-1, 1]) B.rigid(el, 'metal', vcol(new THREE.CylinderGeometry(0.015, 0.015, 0.006, 14).rotateZ(PI / 2).translate(e * 0.034, 0, 0), 0.4));
  {
    const a = V(s * RD.shX - s * 0.012, RY.elbow + 0.04, -0.026), b = V(s * RD.shX - s * 0.01, RY.elbow - 0.045, -0.024);
    const pts = curvePts([a, a.clone().add(V(0, -0.02, -0.018)), b.clone().add(V(0, 0.02, -0.02)), b], 12);
    const g = tubeR(pts, 0.0034, 6);
    vcol(g, [0.6, 0.12, 0.08]);
    B.skinned('rubber', g, armW(side), 0xffffff, { uv: false });
  }
  // forearm: clamshell with seams front / back, two screws, a part number
  const fa = tubeLoft(lin(-0.012, -0.238, 20), (y) => {
    const r = y > -0.04 ? lerp(0.031, 0.036, ss(-0.012, -0.04, y)) : lerp(0.036, 0.028, ss(-0.04, -0.22, y));
    return r * (y > -0.02 ? 0.85 + 0.15 * ss(-0.012, -0.02, y) : 1);
  }, 28, { sz: 0.86, capStart: true, capEnd: true });
  vcol(fa, (x, y, z) => {
    const seam = gauss(z, 0, 0.0016) * ss(0.02, 0.026, Math.abs(x));
    return (1 - 0.5 * seam - 0.25 * ss(-0.225, -0.238, y)) * (0.95 + nz(x * 60, y * 60 + 5, 2) * 0.06);
  });
  B.rigid(el, 'shell', fa);
  for (const [y, sx] of [[-0.05, 1], [-0.19, 1]]) {
    const p = V(sx * s * 0.0352 * (y > -0.1 ? 1 : 0.88), y, 0.0), n = V(s * sx, 0, 0);
    for (const sc of screwGeo(p, n, 0.0026)) B.rigid(el, 'metal', sc, 0xb4b0a6);
  }
  {
    const lab = region(new THREE.PlaneGeometry(0.05, 0.0064), 'serial').rotateZ(PI / 2).rotateY(-s * PI / 2).translate(-s * 0.031, -0.13, 0);
    B.rigid(el, 'decal', vcol(lab, 1), 0xffffff, { uv: false });
  }
  // wrist: steel collar + rubber bellows (bends with the hand)
  B.rigid(el, 'metal', vcol(new THREE.CylinderGeometry(0.024, 0.026, 0.01, 18).translate(0, -0.242, 0), 0.35));
  {
    const N = 6, prof = [];
    for (let i = 0; i <= N; i++) prof.push(new THREE.Vector2(i % 2 ? 0.0235 : 0.0205, -0.008 - (i / N) * 0.022));
    const g = new THREE.LatheGeometry(prof, 20);
    g.applyMatrix4(B.M[BI[wr]]);
    const wy = RY.wrist;
    B.skinned('rubber', vcol(g, 0.14), (x, y, z, o) => { const k = ss(wy + 0.008, wy - 0.02, y); return o.reset().add(el, 1 - k).add(wr, k); });
  }
  buildHand(B, side);
}

// round loft along -Y in a bone's local space: radius r(y), optional x / z scale, caps
export function tubeLoft(ys, rFn, segs = 24, { sx = 1, sz = 1, capStart = false, capEnd = false } = {}) {
  // rows: optional pole + the radius profile + optional pole (domed a little past the ends)
  const rows = ys.map((y) => [y, rFn(y)]);
  if (capStart) { const [y, r] = rows[0], d = Math.sign(ys[0] - ys[1]) || 1; rows.unshift([y + d * r * 0.55, 0], [y + d * r * 0.35, r * 0.7]); }
  if (capEnd) { const [y, r] = rows[rows.length - 1], d = Math.sign(ys[ys.length - 1] - ys[ys.length - 2]) || -1; rows.push([y + d * r * 0.35, r * 0.7], [y + d * r * 0.55, 0]); }
  const g = grid(segs, rows.length - 1, (i, j, p) => {
    const a = (i / segs) * TAU, [y, r] = rows[j];
    p.set(Math.cos(a) * r * sx, y, Math.sin(a) * r * sz);
  }, { closedU: true, poleBottom: capStart, poleTop: capEnd });
  ensureOutward(g, V(0, (ys[0] + ys[ys.length - 1]) / 2, 0));
  return g;
}

// hand (wrist-bone space: fingers along -Y, palm facing -s X, thumb forward -Z); returns
// [{ bone: 'wr'|'fi'|'fj'|'th', mat, geo }] so the first-person arms can reuse it in their own frame
export const HAND = {
  fingersZ: [-0.0272, -0.009, 0.0092, 0.0272], prox: [0.042, 0.046, 0.043, 0.035], dist: [0.033, 0.036, 0.034, 0.028], rad: [0.0082, 0.0086, 0.0081, 0.0072],
  fi: [0, -RD.palm, 0], fj: [0, -0.046, 0], ix: [0, -RD.palm, -0.0272], th: (s) => [-s * 0.012, -0.03, -0.03],
};
export function handParts(side) {
  const s = side === 'L' ? -1 : 1, out = [];
  const add = (bone, mat, geo, col) => { vcol(geo, col); out.push({ bone, mat, geo }); };
  // back-of-hand shell + rubber palm pad + knuckle plate seam
  const palm = pillow(0.027, 0.088, 0.078).translate(0, -0.05, 0.001);
  { const P = palm.attributes.position; for (let i = 0; i < P.count; i++) { const y = P.getY(i); P.setZ(i, P.getZ(i) * lerp(0.84, 1.0, ss(-0.006, -0.04, y))); } palm.computeVertexNormals(); }
  add('wr', 'shell', palm, (x, y) => [1, 1, 1].map((c) => c * (0.95 - 0.35 * gauss(y, -0.06, 0.0015))));
  add('wr', 'rubber', pillow(0.008, 0.07, 0.066).translate(-s * 0.0115, -0.054, 0.002), [0.32, 0.31, 0.3]);
  // thenar block toward the thumb
  add('wr', 'shell', new THREE.SphereGeometry(1, 14, 10).scale(0.012, 0.026, 0.016).translate(-s * 0.006, -0.03, -0.03), 0.92);
  // knuckles + fingers (two segments each, dark joints)
  HAND.fingersZ.forEach((z0, k) => {
    // the index finger is one stiff piece on its own bone (so the clone can point)
    const r = HAND.rad[k], pl = HAND.prox[k], dl = HAND.dist[k], ix = k === 0;
    const fi = ix ? 'ix' : 'fi', fj = ix ? 'ix' : 'fj', z = ix ? 0 : z0, jy = ix ? 0 : 0.046;
    add(fi, 'metal', new THREE.CylinderGeometry(r * 0.8, r * 0.8, r * 1.9, 10).rotateX(PI / 2).translate(0, 0.0, z), 0.25);
    add(fi, 'shell', new THREE.CapsuleGeometry(r, pl - r * 2 - 0.004, 3, 10).translate(0, -pl / 2 - 0.002, z), 0.97);
    add(fj, 'metal', new THREE.SphereGeometry(r * 0.72, 8, 6).translate(0, -(pl - jy), z), 0.25);
    add(fj, 'shell', new THREE.CapsuleGeometry(r * 0.94, dl - r * 2, 3, 10).translate(0, -(pl - jy) - 0.004 - dl / 2, z), 0.97);
    add(fj, 'rubber', new THREE.SphereGeometry(r * 0.8, 8, 6).scale(0.7, 1, 1).translate(-s * r * 0.45, -(pl - jy) - 0.004 - dl + r * 0.6, z), [0.3, 0.29, 0.28]);
  });
  // thumb (one stiff two-segment piece on its own bone)
  const d = V(-s * 0.32, -0.7, -0.62).normalize();
  const seg = (a, b, r) => { const g = new THREE.CapsuleGeometry(r, Math.max(1e-4, b - a - r * 2), 3, 10); g.translate(0, (a + b) / 2, 0); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d)); return g; };
  add('th', 'shell', seg(0.0, 0.036, 0.0098), 0.97);
  add('th', 'metal', new THREE.SphereGeometry(0.0068, 8, 6).translate(d.x * 0.039, d.y * 0.039, d.z * 0.039), 0.25);
  add('th', 'shell', seg(0.04, 0.068, 0.0088), 0.97);
  return out;
}
function buildHand(B, side) {
  for (const p of handParts(side)) B.rigid(p.bone + side, p.mat, p.geo);
}

// visible leg below the trousers: shin end, ankle bellows, mannequin foot on a rubber sole
function buildLegEnd(B, side) {
  const s = side === 'L' ? -1 : 1, kn = 'kn' + side, an = 'an' + side;
  const sh = tubeLoft(lin(-0.27, -0.392, 12), (y) => lerp(0.037, 0.031, ss(-0.27, -0.38, y)) * (y < -0.38 ? 0.55 + 0.45 * Math.sqrt(Math.max(0, 1 - ((y + 0.38) / 0.012) ** 2)) : 1), 24, { sz: 0.92, capEnd: true });
  vcol(sh, (x, y, z) => (1 - 0.45 * gauss(x, 0, 0.0017) * ss(0.02, 0.028, Math.abs(z))) * (0.92 + nz(x * 60, y * 60 + 3, 2) * 0.06) * grime(x, y + RY.knee, z));
  B.rigid(kn, 'shell', sh);
  {
    const N = 6, prof = [];
    for (let i = 0; i <= N; i++) prof.push(new THREE.Vector2(i % 2 ? 0.031 : 0.0275, 0.04 - (i / N) * 0.05));
    const g = new THREE.LatheGeometry(prof, 20);
    g.applyMatrix4(B.M[BI[an]]);
    const ay = RY.ankle;
    B.skinned('rubber', vcol(g, 0.13), (x, y, z, o) => { const k = ss(ay + 0.03, ay - 0.005, y); return o.reset().add(kn, 1 - k).add(an, k); });
  }
  B.rigid(an, 'metal', vcol(new THREE.SphereGeometry(0.022, 12, 10), 0.3));
  // foot shell (ankle-bone space: sole bottom at y = -RD.ankleH, toe toward -Z)
  const soleTop = -RD.ankleH + 0.017;
  const zs = lin(0.062, -0.188, 22);
  const hw = (z) => z > 0.03 ? lerp(0.03, 0.034, (0.062 - z) / 0.032) : z > -0.12 ? lerp(0.034, 0.046, (0.03 - z) / 0.15) : lerp(0.046, 0.03, (-0.12 - z) / 0.068);
  const top = (z) => z > -0.02 ? 0.012 : lerp(0.012, soleTop + 0.03, ss(-0.02, -0.16, z));
  const foot = grid(28, zs.length - 1, (i, j, p) => {
    const z = zs[j], a = (i / 28) * TAU, w = hw(z), t = top(z), yb = soleTop, yc = (t + yb) / 2, hh = (t - yb) / 2;
    const end = j === 0 || j === zs.length - 1 ? 0.0 : 1;
    const c = Math.cos(a), sn = Math.sin(a), e = 2 / 3.2;
    p.set(Math.sign(c) * Math.pow(Math.abs(c), e) * w * end, yc + Math.sign(sn) * Math.pow(Math.abs(sn), e) * hh * end, z);
  }, { closedU: true });
  ensureOutward(foot, V(0, soleTop + 0.02, -0.06));
  vcol(foot, (x, y, z) => (0.94 - 0.15 * ss(soleTop + 0.008, soleTop, y)) * grime(x, y + RY.ankle, z));
  B.rigid(an, 'shell', foot);
  // rubber sole
  const sh2 = new THREE.Shape();
  const outline = [];
  for (const z of lin(0.066, -0.194, 18)) outline.push([hw(z) + 0.004, z]);
  sh2.moveTo(-outline[0][0], outline[0][1]);
  for (const [w, z] of outline) sh2.lineTo(-w, z);
  for (const [w, z] of outline.slice().reverse()) sh2.lineTo(w, z);
  const sole = new THREE.ExtrudeGeometry(sh2, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.0025, bevelSize: 0.003, bevelSegments: 2, curveSegments: 4 });
  sole.rotateX(PI / 2).translate(0, soleTop + 0.0025, 0);
  vcol(sole, (x, y) => 0.12 + 0.05 * ss(soleTop - 0.012, soleTop, y));
  B.rigid(an, 'rubber', sole);
  void s;
}

// chunky olive wrist terminal on the left forearm (outer side), matches the first-person unit
function buildWatch(B) {
  const el = 'elL', y = -0.17, r = 0.0325;
  const cuff = grid(32, 4, (i, j, p) => { const a = (i / 32) * TAU, v = j / 4; p.set(Math.cos(a) * (r + 0.004 + 0.0015 * Math.sin(PI * v)), y + (v - 0.5) * 0.05, Math.sin(a) * (r * 0.9 + 0.004 + 0.0015 * Math.sin(PI * v))); }, { closedU: true });
  ensureOutward(cuff, V(0, y, 0));
  B.rigid(el, 'plastic', vcol(cuff, 1), OLIVE_D);
  const cx = -(r + 0.01);
  B.rigid(el, 'plastic', vcol(pillow(0.022, 0.06, 0.056).translate(cx, y, 0), 1), OLIVE);
  B.rigid(el, 'plastic', vcol(pillow(0.006, 0.046, 0.036).translate(cx - 0.0105, y + 0.004, 0), 1), TRIM);
  const lcd = region(new THREE.PlaneGeometry(0.034, 0.026), 'lcd').rotateZ(PI / 2).rotateY(-PI / 2).translate(cx - 0.0138, y + 0.004, 0);
  B.rigid(el, 'decal', vcol(lcd, 1), 0xffffff, { uv: false });
  B.rigid(el, 'plastic', vcol(new THREE.CylinderGeometry(0.0072, 0.0076, 0.007, 14).rotateZ(PI / 2).translate(cx - 0.0135, y - 0.023, 0.009), 1), 0x2c2d2a);
  for (const [k, col] of [[-1, 0xb8322a], [0, 0xd8a432], [1, 0x8a8c84]]) B.rigid(el, 'rubber', vcol(pillow(0.004, 0.005, 0.007).translate(cx - 0.0115, y + 0.028, k * 0.009), 1), col);
  B.info.watch = { bone: el, pos: V(cx - 0.013, y, 0), rot: new THREE.Euler(0, -PI / 2, 0) };
}

// ============================================================================
let _base = null;
export function buildRobotBase() {
  const B = new RPartBuilder();
  buildCoverTorso(B);
  for (const S of ['L', 'R']) { buildSleeve(B, S); buildTrouser(B, S); buildArm(B, S); buildLegEnd(B, S); }
  buildCoverDetails(B);
  buildChestPlate(B);
  buildNeck(B);
  buildWatch(B);
  return B;
}
export function buildRobotHead(face) {
  const B = new RPartBuilder();
  buildHead(B, face);
  return B;
}
void _base;
