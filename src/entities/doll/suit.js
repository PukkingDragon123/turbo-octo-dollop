// R.O.O.M. — the classic Backrooms hazmat suit on a chubby PEAK sack doll.
// Baggy one-piece PVC coverall with an attached hood framing the sack face (elastic rim,
// drawstring + toggles), taped seams, front zip under a storm flap, black rubber mitten gloves
// and wellington boots taped on with grey duct tape. Everything is sculpted from parametric
// surfaces with folds displaced into the geometry; fine crinkle comes from the PVC normal map.
//
// All coordinates here are rig rest space (rig root at the feet, +Y up, facing -Z) unless a
// function says it works in a bone's local space.
import * as THREE from 'three';
import { clamp, lerp, smooth } from './kit.js';
import { valueNoise2 } from '../../core/rng.js';
import { DIM, Y, PartBuilder, torsoW, armW, legW, hoodW } from './dollrig.js';
import { SACK, FACE, headPoint, headRay, headGrad, facePt, faceCapGeo, sackTone } from './sack.js';
import { grid, gridNormals, displace, tint, solid, ensureOutward, gridArcUV, sweep, tubeR, curvePts, ribbonOn, sePt, ss, gauss } from './geom.js';
import { atlasUV } from './dolltex.js';

const PI = Math.PI, TAU = PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _v = V(), _w = V(), _n = V(), _p = V(), _q = new THREE.Quaternion();
const nz = (x, y, s) => valueNoise2(x, y, s) - 0.5;

export const TAPE = 0x7c8086, WEB = 0x1d1e21, GLOVE = 0x141416, BOOT = 0x131315, SOLE = 0x1c1b1a, SEAM = 0.86;

// ============================================================================
// Torso surface
// ============================================================================
// half-width profile (world y, A); depth = 0.9 A with a belly bulge in front
const PROF = [[0.236, 0.0], [0.243, 0.075], [0.262, 0.165], [0.298, 0.232], [0.345, 0.272], [0.41, 0.294], [0.48, 0.3], [0.55, 0.292],
  [0.62, 0.272], [0.68, 0.246], [0.73, 0.219], [0.775, 0.198], [0.815, 0.183], [0.85, 0.165], [0.878, 0.135], [0.9, 0.085], [0.91, 0.0]];
const profCurve = new THREE.SplineCurve(PROF.map(([y, a]) => new THREE.Vector2(a, y)));
const PROF_PTS = profCurve.getSpacedPoints(400);
export const TORSO_Y0 = PROF[0][0], TORSO_Y1 = PROF[PROF.length - 1][0];
export function torsoA(y) {
  const P = PROF_PTS;
  if (y <= P[0].y) return 0;
  for (let i = 1; i < P.length; i++) if (P[i].y >= y) { const a = P[i - 1], b = P[i]; return lerp(a.x, b.x, (y - a.y) / Math.max(1e-6, b.y - a.y)); }
  return 0;
}
const SE = 2.25;
// phi = 0 at the back (+Z), PI at the front (-Z), PI/2 at +X (right side)
export function torsoPt(phi, y, off = 0, out = V(), A = null) {
  const a = (A ?? torsoA(y)), s = Math.sin(phi), c = Math.cos(phi);
  const sx = Math.sign(s) * Math.pow(Math.abs(s), 2 / SE), sz = Math.sign(c) * Math.pow(Math.abs(c), 2 / SE);
  let depth = 0.9;
  if (c < 0) depth *= 1 + 0.17 * gauss(y, 0.44, 0.13) * Math.pow(-c, 1.5);                 // belly
  else depth *= 1 - (0.1 + 0.05 * gauss(y, 0.66, 0.1)) * c;                                   // flatter back
  out.set(sx * a, y, sz * a * depth);
  if (off) { torsoNrm(phi, y, _n); out.addScaledVector(_n, off); }
  return out;
}
const _t1 = V(), _t2 = V(), _t3 = V(), _t4 = V();
export function torsoNrm(phi, y, out = V()) {
  const e = 0.004;
  torsoPt(phi + e, y, 0, _t1); torsoPt(phi - e, y, 0, _t2); torsoPt(phi, y + e, 0, _t3); torsoPt(phi, y - e, 0, _t4);
  out.crossVectors(_t1.sub(_t2), _t3.sub(_t4)).normalize();
  torsoPt(phi, y, 0, _t1);
  if (out.x * _t1.x + out.z * _t1.z < 0) out.negate();
  return out;
}
// phi on the front (or back) whose surface x equals x at height y
export function torsoPhiX(x, y, front = true) {
  let lo = front ? PI / 2 : -PI / 2, hi = front ? 3 * PI / 2 : PI / 2;
  // x decreases from +A to -A as phi goes PI/2 -> 3PI/2 on the front
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2, px = torsoPt(m, y, 0, _t1).x;
    if (front ? px > x : px < x) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

function torsoFold(x, y, z, phi) {
  const front = Math.max(0, -Math.cos(phi)), back = Math.max(0, Math.cos(phi)), ax = Math.abs(x);
  let d = 0;
  // lower-belly "smile" drag folds pulled toward the crotch
  d += Math.sin(((y - 0.33 - 1.5 * x * x) / 0.052) * TAU) * 0.0075 * Math.pow(front, 1.3) * gauss(y, 0.34, 0.08) * ss(0.025, 0.08, ax);
  // waist bunching all round
  d += Math.sin(((y - 0.47 + 0.01 * Math.sin(phi * 5 + 1.3)) / 0.058) * TAU) * 0.0055 * gauss(y, 0.47, 0.055);
  // armpit folds radiating down from the shoulders (front + back)
  const dx = ax - 0.2, dy = y - 0.69, r = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
  d += Math.sin(ang * 6 + 0.4) * 0.007 * ss(0.025, 0.06, r) * (1 - ss(0.12, 0.2, r)) * (0.4 + 0.6 * (front + back)) * ss(-0.02, 0.05, -dy + 0.06);
  // gathered collar
  d += Math.sin(phi * 14) * 0.003 * ss(0.79, 0.86, y);
  // lower-back folds above the seat
  d += Math.sin(((y - 0.4) / 0.05) * TAU) * 0.0055 * Math.pow(back, 1.5) * gauss(y, 0.41, 0.065);
  // diagonal tension creases from the hips toward the belly (front and back)
  d += Math.sin(((y - 0.55 + 0.9 * ax) / 0.06) * TAU) * 0.004 * gauss(y, 0.56, 0.08) * ss(0.08, 0.2, ax) * (front + back * 0.6);
  // soft random lumps
  d += nz(phi * 2.2 + 3, y * 8, 5) * 0.011 + nz(phi * 5.5 + 1, y * 19, 7) * 0.005;
  // keep the flap line and strap paths calmer
  d *= 1 - 0.75 * gauss(x, 0.018, 0.045) * front;
  return d;
}

function buildTorso(B) {
  const nu = 88, nv = 52;
  const g = grid(nu, nv, (i, j, p) => {
    const P = PROF_PTS[Math.round((j / nv) * (PROF_PTS.length - 1))];
    torsoPt((i / nu) * TAU, P.y, 0, p, P.x);
  }, { closedU: true, poleBottom: true, poleTop: true });
  ensureOutward(g, V(0, 0.55, 0));
  displace(g, (x, y, z) => torsoFold(x, y, z, Math.atan2(x, z)), { aoK: 0.24, aoAmp: 0.008 });
  // cavity tint: armpits, under the belly, crotch
  tint(g, (x, y, z) => {
    const ax = Math.abs(x);
    let k = 1 - 0.14 * gauss(y, 0.27, 0.035) - 0.1 * gauss(ax, 0.2, 0.04) * gauss(y, 0.64, 0.05) - 0.06 * ss(0.84, 0.9, y);
    if (z < 0) k *= 1 - 0.22 * (gauss(x, 0.018 - 0.031, 0.006) + gauss(x, 0.018 + 0.031, 0.006)) * ss(0.27, 0.3, y) * (1 - ss(0.84, 0.86, y));
    k *= 0.97 + nz(x * 7 + z * 5, y * 7, 9) * 0.06;
    return k * grime(x, y, z);
  });
  gridArcUV(g, 1, 1);
  B.skinned('suit', g, torsoW);
}

// dust / smudges / wear: darker and slightly desaturated toward the floor, random scuffs
export function grime(x, y, z) {
  const low = ss(0.5, 0.18, y) * 0.1;
  const sm = Math.max(0, nz(x * 6 + 11, y * 6 + z * 4, 21) * 2 - 0.35) * 0.12;
  const sc = Math.max(0, nz(x * 25 + z * 19, y * 25, 23) * 2 - 0.7) * 0.15;
  return 1 - low - sm - sc;
}

// ============================================================================
// Limbs
// ============================================================================
function radialTube(axis, top, prof, segs, rings, { sx = 1, sz = 1, fold = null, wfn, ao = 0.15, pole = true, flare = null } = {}) {
  // axis: rest-space x/z of the vertical limb axis; prof: [[dy, r]...] (dy below 'top', increasing)
  const curve = new THREE.SplineCurve(prof.map(([dy, r]) => new THREE.Vector2(r, dy)));
  const pts = curve.getSpacedPoints(rings);
  const g = grid(segs, rings, (i, j, p) => {
    const q = pts[j], a = (i / segs) * TAU;
    const r = q.x;
    p.set(axis.x + Math.cos(a) * r * sx, top - q.y, axis.z + Math.sin(a) * r * sz);
    if (flare) flare(p, a, q.y, r);
  }, { closedU: true, poleBottom: pole, poleTop: false });
  // ring 0 is the top (pole): winding check
  ensureOutward(g, V(axis.x, top - prof[prof.length - 1][0] * 0.5, axis.z));
  if (fold) displace(g, (x, y, z) => fold(top - y, Math.atan2(z - axis.z, x - axis.x)), { aoK: ao, aoAmp: 0.006 });
  gridArcUV(g, 1, 1);
  return g;
}

function buildSleeve(B, side) {
  const s = side === 'L' ? -1 : 1, ax = V(s * DIM.shX, 0, 0), top = Y.chest;
  const U = DIM.upper, L = DIM.upper + DIM.fore;
  const prof = [[-0.046, 0.0], [-0.034, 0.043], [-0.016, 0.061], [0.01, 0.069], [U * 0.45, 0.071], [U, 0.074], [U + DIM.fore * 0.35, 0.07], [L - 0.07, 0.065], [L - 0.05, 0.058], [L - 0.03, 0.052], [L - 0.006, 0.05]];
  const g = radialTube(ax, top, prof, 32, 36, {
    sz: 0.96,
    fold: (dy, a) => {
      const front = Math.max(0, -Math.sin(a));
      let d = Math.sin(((dy - U + 0.008 * Math.sin(2 * a + s)) / 0.03) * TAU) * 0.0048 * gauss(dy, U + 0.005, 0.042) * (0.45 + 0.55 * front);
      d += Math.sin((dy * 9 + a / TAU) * TAU) * 0.003 * gauss(dy, 0.06, 0.035);
      d += Math.sin(a * 13 + s) * 0.0026 * ss(L - 0.075, L - 0.06, dy) * (1 - ss(L - 0.058, L - 0.05, dy));
      d += nz(a * 1.6 + s * 5 + 9, dy * 14, 3) * 0.006 * (1 - ss(L - 0.07, L - 0.05, dy));
      return d * ss(-0.03, 0.0, dy);
    },
  });
  tint(g, (x, y, z) => (1 - 0.1 * ss(0.0, -0.04, Y.chest - y) * ss(0.12, 0.2, Math.abs(x))) * grime(x, y, z));
  B.skinned('suit', g, armW(side));
}

function buildLeg(B, side) {
  const s = side === 'L' ? -1 : 1, ax = V(s * DIM.hipX, 0, 0.004), top = Y.pelvis;
  const prof = [[-0.045, 0.0], [-0.03, 0.05], [-0.008, 0.075], [0.03, 0.087], [0.08, 0.089], [0.125, 0.086], [0.155, 0.088], [0.178, 0.09], [0.192, 0.084], [0.204, 0.08], [0.212, 0.077]];
  const g = radialTube(ax, top, prof, 32, 28, {
    fold: (dy, a) => {
      let d = Math.sin(((dy - 0.125 + 0.01 * Math.sin(2 * a)) / 0.032) * TAU) * 0.0042 * gauss(dy, 0.125, 0.035);
      d += Math.sin(((dy - 0.168 + 0.007 * Math.sin(3 * a + 1 + s)) / 0.022) * TAU) * 0.0058 * gauss(dy, 0.168, 0.022);
      d += Math.sin(a * 12 + s * 2) * 0.0025 * ss(0.185, 0.205, dy);
      d += nz(a * 1.5 + s * 7, dy * 12, 4) * 0.007;
      return d * ss(-0.02, 0.01, dy);
    },
  });
  tint(g, (x, y, z) => grime(x, y, z) * (1 - 0.16 * ss(0.3, 0.15, y)));
  B.skinned('suit', g, legW(side));
}

// ============================================================================
// Hood: polar rings around the face opening, pole at the back of the head
// ============================================================================
export const HOOD = { oy: 0.194, ox: 0.176, oh: 0.156, e: 2.6, rimR: 0.011 };
const C = () => V(0, SACK.cy, 0);
// face-opening rim point (head space) for parameter t (0..1): returns the face-surface point
export function rimFacePt(t, out = V(), nOut = null, grow = 0) {
  const a = t * TAU, c = Math.cos(a), sn = Math.sin(a);
  const x = (HOOD.ox + grow) * Math.sign(c) * Math.pow(Math.abs(c), 2 / HOOD.e);
  const y = HOOD.oy + (HOOD.oh + grow) * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / HOOD.e);
  return facePt(x, y, 0, out, nOut);
}
let _hoodFrame = null;
function hoodFrame() {
  if (_hoodFrame) return _hoodFrame;
  const F0 = facePt(0, HOOD.oy, 0, V()).sub(C()).normalize();
  const e1 = V(1, 0, 0), e2 = V().crossVectors(e1, F0).normalize();
  if (e2.y < 0) e2.negate();
  _hoodFrame = { F0, e1, e2 };
  return _hoodFrame;
}
// hood offset over the head surface (thickness + looseness + folds); d: unit direction, s: 0 rim -> 1 pole
function hoodOff(d, s, a) {
  let off = lerp(0.012, 0.021, ss(0, 0.3, s)) + 0.006 * ss(0.35, 0.95, s) * ss(0.3, -0.2, d.y);
  off += 0.03 * ss(-0.25, -0.85, d.y) * ss(0.0, 0.3, s);                  // looser around the jaw / neck
  off += 0.006 * gauss(s, 0.0, 0.1) * (0.5 + 0.5 * Math.cos(a * 26));     // elastic gathers at the rim
  off += Math.sin(a * 6 + 1.3 + s * 4) * 0.0055 * ss(0.1, 0.32, s) * (1 - ss(0.7, 1, s)); // drape folds
  off += Math.sin(a * 11 + s * 9 + 0.7) * 0.0025 * ss(0.15, 0.4, s) * (1 - ss(0.6, 0.9, s));
  off += nz(a * 2.5 + 3, s * 6, 11) * 0.008 * ss(0.05, 0.3, s) + nz(a * 7 + 1, s * 15, 12) * 0.003 * ss(0.05, 0.2, s);
  return off;
}
export function hoodPoint(d, s = 0.6, a = 0, out = V()) {
  const n = V();
  headPoint(d, 0, out, n);
  const off = hoodOff(d, s, a);
  out.addScaledVector(n, off);
  out.y -= 0.03 * ss(-0.35, -0.9, d.y);
  return out;
}
// direction for hood grid param (column t around the opening, ring s)
function hoodDir(t, s, out) {
  const { F0, e1, e2 } = hoodFrame();
  const rp = rimFacePt(t, _p).sub(C()).normalize();
  const psi0 = Math.acos(clamp(rp.dot(F0), -1, 1));
  const th = Math.atan2(rp.dot(e2), rp.dot(e1));
  const psi = lerp(psi0, PI, Math.pow(s, 1.0));
  return out.copy(F0).multiplyScalar(Math.cos(psi)).addScaledVector(e1, Math.sin(psi) * Math.cos(th)).addScaledVector(e2, Math.sin(psi) * Math.sin(th)).normalize();
}

function buildHood(B) {
  const nu = 80, nv = 32, d = V(), hb = Y.head;
  // columns start at the top of the opening (t = 0.25) so the UV seam runs over the crown seam
  const g = grid(nu, nv, (i, j, p) => {
    const t = 0.25 + i / nu, s = j / nv;
    if (j === 0) { rimFacePt(t, p, _n); p.addScaledVector(_n, 0.017); }
    else { hoodDir(t, s, d); hoodPoint(d, s, t * TAU, p); }
    p.y += hb;
  }, { closedU: true, poleTop: true });
  ensureOutward(g, V(0, hb + SACK.cy, 0));
  // AO: darker in the deep part near the face rim and under the jaw
  tint(g, (x, y, z, i) => {
    const j = Math.floor(i / (nu + 1));
    return (1 - 0.18 * ss(3, 0, j)) * (1 - 0.12 * ss(hb + 0.07, hb + 0.0, y)) * (0.97 + nz(x * 9 + z * 4, y * 9, 13) * 0.06);
  });
  gridArcUV(g, 1, 1);
  B.skinned('suit', g, hoodW);

  // elastic rim: a puckered rolled tube hugging the face
  const rim = [], N = 72;
  for (let i = 0; i < N; i++) { rimFacePt(i / N, _p, _n); rim.push(_p.clone().addScaledVector(_n, 0.0085).add(V(0, hb, 0))); }
  const rg = sweep([...rim, rim[0], rim[1]].slice(0, N + 1), 8, (t, a, o) => {
    const r = HOOD.rimR * (1 + 0.07 * Math.cos(t * TAU * 26) + 0.04 * Math.sin(t * TAU * 7));
    o.set(Math.cos(a) * r, Math.sin(a) * r * 0.85);
  });
  tint(rg, () => 0.92);
  gridArcUV(rg, 1, 1);
  B.skinned('suit', rg, hoodW);

  // drawstring cords + toggles (hang from cordL / cordR)
  for (const [S, s] of [['L', -1], ['R', 1]]) {
    const ex = facePt(s * 0.03, HOOD.oy - HOOD.oh + 0.004, 0.012, V());
    B.setRest('cord' + S, [ex.x, ex.y, ex.z]);
    const cord = tubeR([V(0, 0.006, 0.004), V(s * 0.004, -0.02, -0.004), V(s * 0.002, -0.045, -0.006), V(0, -0.062, -0.004)], 0.0032, 6);
    B.rigid('cord' + S, 'tape', cord, 0xd8d4c8);
    const tg = new THREE.CylinderGeometry(0.0085, 0.0085, 0.022, 12, 1);
    B.rigid('cord' + S, 'plastic', tg.translate(0, -0.07, -0.004), 0x232326);
    const knot = new THREE.SphereGeometry(0.0055, 8, 6).translate(0, -0.086, -0.004);
    B.rigid('cord' + S, 'tape', knot, 0xd8d4c8);
    B.springs['cord' + S] = { k: 40, d: 3, gain: 0.03, mode: 'hang', grav: 0.6, limit: 0.9 };
  }
  B.springs.hood = { k: 80, d: 6, gain: 0.012, mode: 'stand', limit: 0.12 };
}

// ============================================================================
// Storm flap + zip, seam tapes, badge/patch anchors
// ============================================================================
function surfStrip(B, mat, fnPt, fnNrm, n, width, thick, color, wfn, { bevel = 0.35 } = {}) {
  const pts = [], nrm = [];
  for (let i = 0; i <= n; i++) { pts.push(fnPt(i / n, V())); nrm.push(fnNrm(i / n, V())); }
  const g = ribbonOn(pts, nrm, width, thick, { bevel });
  if (color != null) solid(g, color);
  B.skinned(mat, g, wfn);
  return g;
}

function buildFront(B, seamCol) {
  // storm flap: from the crotch up to the collar, slightly right of centre
  const fx = 0.018, y0 = 0.28, y1 = 0.845;
  const at = (t, out) => { const y = lerp(y0, y1, t); const phi = torsoPhiX(fx, y); return torsoPt(phi, y, 0.004, out); };
  const an = (t, out) => { const y = lerp(y0, y1, t); return torsoNrm(torsoPhiX(fx, y), y, out); };
  const flap = surfStrip(B, 'suit', at, an, 40, 0.056, 0.0075, null, torsoW, { bevel: 0.6 });
  displace(flap, (x, y) => Math.sin(y * 70) * 0.0012);
  tint(flap, (x, y) => (0.97 + nz(y * 30, x * 30, 4) * 0.04) * (1 - 0.12 * ss(0.3, 0.27, y)));
  // stitched edges of the flap (seam tape tone)
  for (const e of [-1, 1]) {
    const at2 = (t, out) => { const y = lerp(y0 + 0.01, y1 - 0.01, t); const phi = torsoPhiX(fx + e * 0.026, y); return torsoPt(phi, y, 0.0115, out); };
    const an2 = (t, out) => { const y = lerp(y0 + 0.01, y1 - 0.01, t); return torsoNrm(torsoPhiX(fx + e * 0.026, y), y, out); };
    surfStrip(B, 'suit', at2, an2, 30, 0.006, 0.0015, seamCol, torsoW);
  }
  // press-stud snaps holding the flap shut
  for (const y of [0.36, 0.47, 0.58, 0.69, 0.79]) {
    const phi = torsoPhiX(fx - 0.006, y), p = torsoPt(phi, y, 0.0125, V()), n = torsoNrm(phi, y, V());
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), n);
    const stud = new THREE.CylinderGeometry(0.0062, 0.0068, 0.0032, 14); stud.applyQuaternion(q).translate(p.x, p.y, p.z);
    B.skinned('metal', stud, torsoW, 0xb9bcc0);
  }
  // embroidered name tape on the right chest, between the flap edge and the harness pad; it rides
  // the folded torso surface so no fabric lump swallows it
  {
    const W = 0.028, H = 0.0086, cx = 0.0625, cy = 0.772, nn = V();
    const tape = grid(8, 2, (i, j, p) => {
      const x = cx - (i / 8 - 0.5) * W, y = cy + (j / 2 - 0.5) * H, phi = torsoPhiX(x, y);
      torsoPt(phi, y, 0, p); torsoNrm(phi, y, nn);
      p.addScaledVector(nn, torsoFold(p.x, p.y, p.z, Math.atan2(p.x, p.z)) + 0.0026);
    });
    ensureOutward(tape, V(cx, cy, 0));
    const uv = tape.attributes.uv; for (let k = 0; k < uv.count; k++) { const [a1, b1] = atlasUV('name', uv.getX(k), uv.getY(k)); uv.setXY(k, a1, b1); }
    B.skinned('decal', tape, torsoW);
  }
  // zip slider + pull peeking out at the collar
  const zp = torsoPt(torsoPhiX(0.0, 0.83), 0.83, 0.012, V()), zn = torsoNrm(torsoPhiX(0.0, 0.83), 0.83, V());
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), zn);
  const slider = new THREE.BoxGeometry(0.014, 0.022, 0.008); slider.applyQuaternion(q).translate(zp.x, zp.y, zp.z);
  B.skinned('metal', slider, torsoW, 0xc9ccd0);
  const pull = new THREE.BoxGeometry(0.009, 0.03, 0.0025); pull.translate(0, -0.022, 0.006).applyQuaternion(q).translate(zp.x, zp.y, zp.z);
  B.skinned('metal', pull, torsoW, 0xd8dade);
  const ring = new THREE.TorusGeometry(0.006, 0.0016, 6, 12); ring.translate(0, -0.04, 0.007).applyQuaternion(q).translate(zp.x, zp.y, zp.z);
  B.skinned('metal', ring, torsoW, 0xd8dade);
  // visible zip teeth just above the flap top
  for (let k = 0; k < 6; k++) {
    const y = 0.845 + k * 0.006; const phi = torsoPhiX(0.0, Math.min(0.88, y)); const p = torsoPt(phi, Math.min(0.88, y), 0.004, V());
    const tooth = new THREE.BoxGeometry(0.012, 0.0032, 0.004); tooth.applyQuaternion(q).translate(p.x + (k % 2 ? 0.002 : -0.002), p.y, p.z);
    B.skinned('metal', tooth, torsoW, 0xb8bcc0);
  }
}

function buildSeams(B, seamCol) {
  const w = 0.021, th = 0.0018;
  // side seams (armpit -> hip)
  for (const s of [-1, 1]) {
    const phi = s > 0 ? PI / 2 : 3 * PI / 2;
    surfStrip(B, 'suit', (t, o) => torsoPt(phi, lerp(0.67, 0.29, t), 0.0065, o), (t, o) => torsoNrm(phi, lerp(0.67, 0.29, t), o), 36, w, th, seamCol, torsoW);
    // shoulder seam: collar -> shoulder cap
    surfStrip(B, 'suit', (t, o) => { const x = lerp(0.1, 0.2, t) * s; return o.set(x, torsoTopAt(x) + 0.005, 0.0); },
      (t, o) => o.set(s * 0.35, 1, 0).normalize(), 16, w, th, seamCol, torsoW);
  }
  // hood centre seam: forehead rim -> over the crown -> pole (grid column t = 0.25), then down the
  // back of the neck (column t = 0.75 from the pole back toward the chin)
  const hb = Y.head, d = V(), pts = [], nrm = [];
  const push = (t, s) => { hoodDir(t, s, d); const p = hoodPoint(d, s, t * TAU, V()); const n = headGrad(p.x, p.y - SACK.cy, p.z, V()); p.addScaledVector(n, 0.0015); p.y += hb; pts.push(p); nrm.push(n); };
  for (let k = 1; k <= 30; k++) push(0.25, k / 30);
  for (let k = 29; k >= 16; k--) push(0.75, k / 30);
  const cg = ribbonOn(pts, nrm, 0.024, th);
  solid(cg, seamCol);
  B.skinned('suit', cg, hoodW);
}
// height of the top of the shoulder line at x (scan the torso surface from above)
function torsoTopAt(x, z) {
  for (let y = 0.9; y > 0.6; y -= 0.002) { const a = torsoA(y); if (a >= Math.abs(x) * 1.02) return y; }
  return 0.7 + 0 * z;
}

// ============================================================================
// Gloves: black rubber mittens with a thumb, flared gauntlet cuff
// ============================================================================
export const GLOVE_DIM = { cuffTop: 0.052, len: 0.098 };
// glove surface in the wrist bone's local space (hand along -Y, thumb toward -Z, palm medial)
export function gloveGeo(side, { rings = 26, segs = 24, cuff = true } = {}) {
  const s = side === 'L' ? -1 : 1;
  const yTop = cuff ? GLOVE_DIM.cuffTop : 0.03, yTip = -GLOVE_DIM.len;
  const g = grid(segs, rings, (i, j, p) => {
    const v = j / rings, y = lerp(yTop, yTip, v), a = (i / segs) * TAU;
    // cuff: round, flaring toward the top; hand: rounded slab
    const k = ss(0.012, -0.012, y);                      // 0 cuff -> 1 hand
    const t = clamp(-y / GLOVE_DIM.len, 0, 1);
    let hx = lerp(0.03, 0.0235, ss(0.0, 0.55, t)), hz = lerp(0.034, 0.041, ss(0.0, 0.35, t)) - 0.003 * ss(0.6, 0.9, t);
    if (t > 0.72) { const q = (t - 0.72) / 0.28; const f = Math.sqrt(Math.max(0, 1 - q * q)); hx *= f; hz *= lerp(1, 0.85, q) * f; }
    const rc = cuff ? lerp(0.062, 0.071, ss(-0.005, yTop, y)) + 0.003 * ss(yTop - 0.012, yTop, y) : 0.043;
    const rx = lerp(rc, hx, k), rz = lerp(rc, hz, k), e = lerp(2.0, 2.5, k);
    sePt(a, e, _p);
    p.set(_p.x * rx, y, _p.y * rz - 0.002 * k);
    // palm side (medial) slightly flatter, back of the hand rounder
    if (k > 0.5 && p.x * s < 0) p.x *= 0.88;
  }, { closedU: true, poleTop: true });
  ensureOutward(g, V(0, -0.02, 0));
  // creases: wrist, knuckles (back of the hand), a few random rubber wrinkles on the cuff
  displace(g, (x, y, z) => {
    const back = clamp(x * s / 0.02, 0, 1);
    let d = -0.0016 * gauss(y, -0.006, 0.004);
    d += -0.0016 * gauss(y, -0.05, 0.003) * back;
    d += -0.0011 * gauss(y, -0.057, 0.003) * back;
    d += Math.sin(Math.atan2(z, x) * 9 + y * 80) * 0.0012 * ss(0.0, 0.03, y);
    d += nz(Math.atan2(z, x) * 3 + s * 4, y * 60, 2) * 0.0014;
    return d;
  }, { aoK: 0.35, aoAmp: 0.0015 });
  gridArcUV(g, 1, 1);
  return g;
}
export function thumbGeo(side) {
  const s = side === 'L' ? -1 : 1;
  const dir = V(-s * 0.2, -0.62, -0.76).normalize();
  const pts = [V(0, 0.009, 0.009), V(0, 0, 0), dir.clone().multiplyScalar(0.023), dir.clone().multiplyScalar(0.042).add(V(0, -0.005, 0))];
  const g = tubeR(curvePts(pts, 14), (t) => 0.0182 * (1 - 0.15 * t) * Math.sqrt(Math.max(0.02, 1 - Math.pow(Math.max(0, (t - 0.82) / 0.18), 2))) * (t < 0.08 ? Math.sqrt(t / 0.08) * 0.9 + 0.1 : 1), 14, { closeStart: true, closeEnd: true });
  displace(g, (x, y, z) => nz(x * 200, y * 200 + z * 100, 7) * 0.0008);
  gridArcUV(g, 1, 1);
  return g;
}
function buildGloves(B) {
  for (const side of ['L', 'R']) {
    const wr = 'wr' + side, el = 'el' + side, fi = 'fi' + side;
    const g = gloveGeo(side);
    B.boneSkinned(wr, 'rubber', g, (x, y, z, o) => {
      // y is rest space; wrist rest height:
      const ly = y - B.restPos(wr, _w).y;
      o.reset();
      const cuff = ss(-0.004, 0.02, ly), fing = ss(-0.044, -0.058, ly);
      o.add(el, cuff); o.add(wr, (1 - cuff) * (1 - fing)); o.add(fi, (1 - cuff) * fing);
      return o;
    }, GLOVE);
    B.rigid('th' + side, 'rubber', thumbGeo(side), GLOVE);
  }
}

// ============================================================================
// Boots: chunky black rubber wellingtons with a tread sole (ankle bone space)
// ============================================================================
const BOOT_LV = [ // y, centre z, half x, half z, exponent
  [-0.08, -0.03, 0.064, 0.118, 2.7], [-0.064, -0.03, 0.066, 0.117, 2.6], [-0.044, -0.026, 0.066, 0.111, 2.5],
  [-0.024, -0.017, 0.065, 0.097, 2.35], [-0.006, -0.006, 0.063, 0.081, 2.2], [0.014, 0.0, 0.062, 0.07, 2.1],
  [0.04, 0.002, 0.063, 0.067, 2.0], [0.062, 0.002, 0.066, 0.069, 2.0], [0.07, 0.002, 0.066, 0.069, 2.0],
];
function bootLevel(y) {
  const L = BOOT_LV;
  if (y <= L[0][0]) return L[0].slice(1);
  for (let i = 1; i < L.length; i++) if (L[i][0] >= y) {
    const t = smooth((y - L[i - 1][0]) / (L[i][0] - L[i - 1][0]));
    return L[i].slice(1).map((v, k) => lerp(L[i - 1][k + 1], v, t));
  }
  return L[L.length - 1].slice(1);
}
export function bootGeo() {
  const rings = 22, segs = 32, y0 = -0.08, y1 = 0.07;
  const g = grid(segs, rings, (i, j, p) => {
    const y = lerp(y0, y1, j / rings), [cz, hx, hz, e] = bootLevel(y), a = (i / segs) * TAU;
    sePt(a, e, _p);
    p.set(_p.x * hx, y, cz + _p.y * hz);
  }, { closedU: true });
  ensureOutward(g, V(0, 0, -0.01));
  displace(g, (x, y, z) => {
    let d = 0.0015 * gauss(y, -0.002, 0.004);                                 // ankle reinforcement ridge
    d += -0.0012 * gauss(y, 0.03, 0.0035) * (z > 0 ? 1 : 0.5);
    d += nz(x * 40 + z * 20, y * 60, 5) * 0.001;
    d += -0.0015 * gauss(Math.hypot(x * 0.9, z + 0.11) , 0.045, 0.004) * ss(-0.02, -0.06, y); // toe-cap seam
    return d;
  }, { aoK: 0.3, aoAmp: 0.0015 });
  tint(g, (x, y) => 1 - 0.25 * ss(-0.06, -0.08, y));
  gridArcUV(g, 1, 1);
  return g;
}
export function soleGeo() {
  // outline of the boot's bottom section, grown a bit; lofted rim + treaded bottom
  const segs = 36;
  const ring = (k, dy, grow) => { const [cz, hx, hz, e] = bootLevel(-0.08); return (i, p) => { sePt((i / segs) * TAU, e, _p); return p.set(_p.x * (hx + grow), -0.08 + dy, cz + _p.y * (hz + grow)); }; };
  const levels = [ring(0, 0.004, -0.004), ring(1, 0.0, 0.004), ring(2, -0.006, 0.006), ring(3, -0.014, 0.006), ring(4, -0.019, 0.003), ring(5, -0.021, -0.002)];
  const side = grid(segs, levels.length - 1, (i, j, p) => levels[j](i, p), { closedU: true });
  ensureOutward(side, V(0, -0.09, -0.03));
  // bottom: polar grid with chevron lugs
  const [cz, hx, hz, e] = bootLevel(-0.08), nr = 6;
  const bottom = grid(segs, nr, (i, j, p) => {
    const r = (j / nr), a = (i / segs) * TAU; sePt(a, e, _p);
    const x = _p.x * (hx - 0.002) * r, z = cz + _p.y * (hz - 0.002) * r;
    const lug = (Math.abs(Math.sin((z * 45 + Math.abs(x) * 30))) > 0.45 ? 1 : 0) * (r < 0.93 ? 1 : 0);
    p.set(x, -0.101 - lug * 0.004, z);
  }, { closedU: true, poleBottom: true });
  ensureOutward(bottom, V(0, -0.05, -0.03));
  gridArcUV(side, 1, 1);
  return mergeSimple([side, bottom]);
}
function mergeSimple(list) {
  // small local merge (index offsets), keeps position/normal/uv
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, ov * 3); nor.set(g.attributes.normal.array, ov * 3); uv.set(g.attributes.uv.array, ov * 2);
    const I = g.index.array; for (let k = 0; k < I.length; k++) idx[oi + k] = I[k] + ov;
    ov += g.attributes.position.count; oi += I.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
export { mergeSimple };

function buildBoots(B) {
  for (const side of ['L', 'R']) {
    const an = 'an' + side;
    B.rigid(an, 'rubber', bootGeo(), BOOT);
    B.rigid(an, 'rubber', soleGeo(), SOLE);
    // pull tab at the back of the shaft
    const tab = tubeR(curvePts([V(-0.012, 0.055, 0.066), V(-0.006, 0.08, 0.074), V(0.006, 0.08, 0.074), V(0.012, 0.055, 0.066)], 10), 0.0032, 6);
    B.rigid(an, 'rubber', tab, BOOT);
  }
}

// ============================================================================
// Duct tape wraps (wrist cuffs + boot tops): overlapping spiral layers with a lifted tab
// ============================================================================
export function tapeWrap(radius, y0, height, { layers = 3, seed = 1, sx = 1, sz = 1, cz = 0, tilt = 0.08 } = {}) {
  const parts = [];
  for (let L = 0; L < layers; L++) {
    const segs = 32, rings = 3, r = radius + L * 0.0011, yo = y0 + L * height * 0.22, sweepA = TAU * (L === layers - 1 ? 0.92 : 1.02), a0 = seed * 1.7 + L * 2.1;
    const g = grid(segs, rings, (i, j, p) => {
      const a = a0 + (i / segs) * sweepA, v = j / rings;
      const y = yo + v * height * 0.62 + Math.sin(a - a0) * tilt * height * 0.25;
      const rr = r + (v === 0 || v === 1 ? -0.0006 : 0) + nz(a * 6 + L, v * 3 + seed, 3 + L) * 0.0007;
      p.set(Math.cos(a) * rr * sx, y, cz + Math.sin(a) * rr * sz);
    });
    ensureOutward(g, V(0, yo, cz));
    parts.push(g);
    if (L === layers - 1) {
      // lifted tab at the end of the last wrap
      const a = a0 + sweepA, tab = new THREE.PlaneGeometry(0.012, height * 0.55, 1, 1);
      tab.rotateY(-a + PI / 2).translate(Math.cos(a) * (r + 0.004) * sx, yo + height * 0.32, cz + Math.sin(a) * (r + 0.004) * sz);
      parts.push(tab);
    }
  }
  const g = mergeSimple(parts.map((p) => { if (!p.index) p.setIndex([...Array(p.attributes.position.count).keys()]); return p; }));
  g.computeVertexNormals();
  const uv = g.attributes.uv, P = g.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, Math.atan2(P.getZ(i) - cz, P.getX(i)) * radius, P.getY(i));
  return g;
}
function buildTape(B) {
  for (const side of ['L', 'R']) {
    // wrist: over the glove cuff top / sleeve end (forearm bone)
    const el = 'el' + side;
    const wristY = -DIM.fore;   // el-local y of the wrist joint
    B.rigid(el, 'tape', tapeWrap(0.0728, wristY + GLOVE_DIM.cuffTop - 0.031, 0.031, { seed: side === 'L' ? 1 : 4 }), TAPE);
    // ankle: over the suit leg end / boot top
    const an = 'an' + side;
    B.rigid(an, 'tape', tapeWrap(0.0815, 0.04, 0.034, { seed: side === 'L' ? 2 : 7, cz: 0.003 }), TAPE);
  }
}

// ============================================================================
// Head (burlap face cap) - the part visible inside the hood
// ============================================================================
function buildHeadCap(B) {
  const g = faceCapGeo({ psiMax: 1.42, rings: 28, segs: 56 });
  tint(g, (x, y, z) => sackTone(x, y, z, 3) * (1 - 0.12 * ss(0.16, 0.2, Math.abs(x)) ) );
  // soft occlusion where the hood rim covers the face edge
  tint(g, (x, y) => {
    const ex = Math.abs(x) / (HOOD.ox + 0.01), ey = Math.abs(y - HOOD.oy) / (HOOD.oh + 0.01);
    const r = Math.pow(Math.pow(ex, HOOD.e) + Math.pow(ey, HOOD.e), 1 / HOOD.e);
    return 1 - 0.38 * ss(0.8, 1.0, r);
  });
  B.rigid('head', 'burlap', g);
}

// ============================================================================
// Base part (everything every avatar wears)
// ============================================================================
export function buildSuitBase() {
  const B = new PartBuilder();
  const seamCol = new THREE.Color(SEAM, SEAM, SEAM).getHex();
  buildTorso(B);
  buildSleeve(B, 'L'); buildSleeve(B, 'R');
  buildLeg(B, 'L'); buildLeg(B, 'R');
  buildHood(B);
  buildFront(B, seamCol);
  buildSeams(B, seamCol);
  buildGloves(B);
  buildBoots(B);
  buildTape(B);
  buildHeadCap(B);
  return B;
}

// rest-space anchors on the suit used by gear (straps, badge, watch)
export const SUIT_ANCHOR = {
  torsoPt, torsoNrm, torsoPhiX, torsoA,
};
export { atlasUV, headRay };
