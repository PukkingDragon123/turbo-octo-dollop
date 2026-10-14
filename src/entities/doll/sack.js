// R.O.O.M. — the PEAK-style sack head: a tall rounded "bread-loaf" superquadric, about as wide
// as it is tall, with a broad flat-ish face, full cheeks and a squarish jaw.
//
// Head-bone space (origin = neck base, +Y up, face toward -Z). The head is described by an
// implicit function F (F < 1 inside, F = 1 on the surface) relative to its centre C = (0, cy, 0).
// Everything that sits on the head (face features, hood, hats) is placed through headRay() /
// facePt(), so all of it follows the same surface.
import * as THREE from 'three';
import { clamp, lerp, surfaceGrid } from './kit.js';
import { valueNoise2 } from '../../core/rng.js';

const PI = Math.PI, TAU = PI * 2;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// a: half width, cf/cb: half depth front/back, bt/bb: centre->crown / centre->chin,
// nh: horizontal superellipse exponent, qt/qb: vertical exponents (dome / jaw)
export const SACK = { cy: 0.245, a: 0.218, cf: 0.172, cb: 0.19, bt: 0.268, bb: 0.212, nh: 2.75, qt: 2.25, qb: 3.1 };
export const HEAD_TOP = SACK.cy + SACK.bt;      // 0.513
export const HEAD_CHIN = SACK.cy - SACK.bb;     // 0.033

// --- face layout (head-bone space), proportions measured from the PEAK reference
export const FACE = {
  eyeX: 0.121, eyeY: 0.221, eyeR: 0.0205,
  browX: 0.114, browY: 0.281, browW: 0.054,
  noseY: 0.186, noseR: 0.056,
  mouthY: 0.093, mouthW: 0.052,
  blushX: 0.142, blushY: 0.152,
};

export function headF3(X, Y, Z, S = SACK) {
  const ax = S.a * (1 + 0.045 * Math.exp(-(((Y + 0.07) / 0.09) ** 2))) * (1 - 0.06 * sstep(0.02, 0.26, Y));
  const cz = (Z < 0 ? S.cf : S.cb) * (1 + 0.035 * Math.exp(-(((Y + 0.05) / 0.1) ** 2)));
  const h = Math.pow(Math.pow(Math.abs(X) / ax, S.nh) + Math.pow(Math.abs(Z) / cz, S.nh), 1 / S.nh);
  const q = Y > 0 ? S.qt : S.qb, v = Y > 0 ? Y / S.bt : -Y / S.bb;
  return Math.pow(h, q) + Math.pow(v, q);
}

// distance from the centre to the surface along a unit direction (bisection; F is monotonic)
export function headRay(dx, dy, dz, S = SACK) {
  let lo = 0, hi = 0.42;
  for (let i = 0; i < 20; i++) {
    const m = (lo + hi) * 0.5;
    if (headF3(dx * m, dy * m, dz * m, S) < 1) lo = m; else hi = m;
  }
  return (lo + hi) * 0.5;
}

// outward unit normal at a point given relative to the centre
export function headGrad(X, Y, Z, out, S = SACK) {
  const e = 0.0015;
  out.set(
    headF3(X + e, Y, Z, S) - headF3(X - e, Y, Z, S),
    headF3(X, Y + e, Z, S) - headF3(X, Y - e, Z, S),
    headF3(X, Y, Z + e, S) - headF3(X, Y, Z - e, S),
  );
  if (out.lengthSq() < 1e-12) out.set(0, 0, -1);
  return out.normalize();
}

// surface point (head-bone space) along direction d from the centre, pushed out by off along the normal
export function headPoint(d, off = 0, out = new THREE.Vector3(), nOut = null, S = SACK) {
  const t = headRay(d.x, d.y, d.z, S);
  const n = headGrad(d.x * t, d.y * t, d.z * t, nOut || _n, S);
  return out.set(d.x * t + n.x * off, S.cy + d.y * t + n.y * off, d.z * t + n.z * off);
}
const _n = new THREE.Vector3();

// front surface depth at head-bone (x, y): returns z (< 0) or 0 if outside the silhouette
function solveFrontZ(x, y, S = SACK) {
  const Y = y - S.cy;
  if (headF3(x, Y, 0, S) >= 1) return 0;
  let lo = 0, hi = 0.36;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) * 0.5; if (headF3(x, Y, -m, S) < 1) lo = m; else hi = m; }
  return -(lo + hi) * 0.5;
}

// precomputed front-face lookup (z + normal) for fast feature placement / dynamic face threads
const FG = { x0: -0.215, x1: 0.215, y0: 0.02, y1: 0.47, n: 72, z: null, nx: null, ny: null, nz: null };
function buildFaceGrid() {
  const N = FG.n, z = new Float32Array(N * N), nx = new Float32Array(N * N), ny = new Float32Array(N * N), nz = new Float32Array(N * N);
  const g = new THREE.Vector3();
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = lerp(FG.x0, FG.x1, i / (N - 1)), y = lerp(FG.y0, FG.y1, j / (N - 1));
    const zz = solveFrontZ(x, y);
    const k = j * N + i;
    z[k] = zz;
    headGrad(x, y - SACK.cy, zz, g);
    nx[k] = g.x; ny[k] = g.y; nz[k] = g.z;
  }
  FG.z = z; FG.nx = nx; FG.ny = ny; FG.nz = nz;
}

// point on the face at head-bone (x, y), offset along the surface normal; optional normal out
export function facePt(x, y, off = 0, out = new THREE.Vector3(), nOut = null) {
  if (!FG.z) buildFaceGrid();
  const N = FG.n;
  const fx = clamp((x - FG.x0) / (FG.x1 - FG.x0), 0, 1) * (N - 1), fy = clamp((y - FG.y0) / (FG.y1 - FG.y0), 0, 1) * (N - 1);
  const i = Math.min(N - 2, Math.floor(fx)), j = Math.min(N - 2, Math.floor(fy)), u = fx - i, v = fy - j;
  const k = j * N + i;
  const bl = (A) => (A[k] * (1 - u) + A[k + 1] * u) * (1 - v) + (A[k + N] * (1 - u) + A[k + N + 1] * u) * v;
  const z = bl(FG.z);
  let nx = bl(FG.nx), ny = bl(FG.ny), nz = bl(FG.nz);
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  if (nOut) nOut.set(nx, ny, nz);
  return out.set(x + nx * off, y + ny * off, z + nz * off);
}

// orientation whose local +Z is the outward normal (local +Y roughly up)
const _m = new THREE.Matrix4(), _o = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _t = new THREE.Vector3();
export function frameQ(n, out = new THREE.Quaternion(), up = _up) {
  _m.lookAt(_o, _t.copy(n).negate(), up);
  return out.setFromRotationMatrix(_m);
}
export function faceFrame(x, y, off = 0) {
  const n = new THREE.Vector3();
  const p = facePt(x, y, off, new THREE.Vector3(), n);
  return { p, n, q: frameQ(n) };
}

// ---------------------------------------------------------------------------
// Meshes
// ---------------------------------------------------------------------------
// tone: low-frequency mottling / grime as a vertex colour multiplier (warm, slightly dirty)
export function sackTone(x, y, z, seed = 3) {
  const n1 = valueNoise2(x * 9 + seed, y * 9 + z * 6, seed), n2 = valueNoise2(x * 23 - z * 17, y * 23 + seed, seed + 5);
  let k = 0.9 + (n1 - 0.5) * 0.16 + (n2 - 0.5) * 0.07;
  k -= sstep(0.11, 0.0, y) * 0.12;                         // under-chin occlusion
  return k;
}

// The face cap: a polar patch around the (slightly downward tilted) face axis, out to psiMax.
// Clean topology (the pole sits under the nose) and planar front UVs (meters) for the face.
export function faceCapGeo({ psiMax = 1.45, rings = 30, segs = 64, tileU = 1, seed = 3 } = {}) {
  const ax = new THREE.Vector3(0, -Math.sin(0.27), -Math.cos(0.27));
  const bx = new THREE.Vector3(1, 0, 0), by = new THREE.Vector3().crossVectors(ax, bx).negate().normalize(); // up-ish
  const d = new THREE.Vector3();
  const g = surfaceGrid(segs, rings, (u, v, p) => {
    const psi = psiMax * Math.pow(v, 1.15), th = u * TAU;
    const s = Math.sin(psi), c = Math.cos(psi);
    d.copy(ax).multiplyScalar(c).addScaledVector(bx, s * Math.cos(th)).addScaledVector(by, s * Math.sin(th)).normalize();
    headPoint(d, 0, p);
  }, { closedU: true });
  fixPoleNormals(g, segs, 0);
  planarUV(g, tileU);
  return g;
}

// Whole sack (naked clones / test): lat-long grid, UV seam down the back (hidden by the back seam)
export function fullHeadGeo({ nu = 72, nv = 48, tileU = 1, bottom = -PI / 2 + 0.02 } = {}) {
  const d = new THREE.Vector3();
  const g = surfaceGrid(nu, nv, (u, v, p) => {
    const phi = u * TAU, el = lerp(bottom, PI / 2, v);
    d.set(Math.sin(phi) * Math.cos(el), Math.sin(el), Math.cos(phi) * Math.cos(el));
    headPoint(d, 0, p);
  }, { closedU: true, poleTop: true });
  // UV: arc length around (~perimeter at the cheeks) / arc length up
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    uv.setXY(i, u * 1.24 / tileU, (lerp(bottom, PI / 2, v) + PI / 2) * 0.235 / tileU);
  }
  return g;
}

function fixPoleNormals(g, segs, row) {
  const n = g.attributes.normal, a = new THREE.Vector3(), s = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) s.add(a.fromBufferAttribute(n, row * (segs + 1) + i));
  s.normalize();
  for (let i = 0; i <= segs; i++) n.setXYZ(row * (segs + 1) + i, s.x, s.y, s.z);
}
export function planarUV(g, tile = 1) {
  const P = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < P.count; i++) uv.setXY(i, P.getX(i) / tile, P.getY(i) / tile);
  return g;
}

// surface point on a scaled copy of the head (hats / hood shells): direction d from the centre
export function shellPoint(d, off, scale = 1, out = new THREE.Vector3()) {
  const t = headRay(d.x, d.y, d.z) * scale;
  const n = headGrad(d.x * t / scale, d.y * t / scale, d.z * t / scale, _n);
  return out.set(d.x * t + n.x * off, SACK.cy + d.y * t + n.y * off, d.z * t + n.z * off);
}
