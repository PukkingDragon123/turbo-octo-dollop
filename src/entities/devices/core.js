// Device model kit: indexed mesh data with meter-scale UVs and per-vertex edge factors, bevelled
// primitives (rounded boxes with optional subdivision for dents, lathes, bevelled cylinders, swept
// tubes with rotation-minimising frames, creased extrusions), a builder that merges geometry per
// (target object, material class), a voxel ambient-occlusion + grime + dust bake, and packing into
// BufferGeometries carrying the attributes the device material patch reads (see mats.js).
//
//   const k = new DKit('fuse_box', { ground: 'wall', wear: { chip: 0.3, rust: 0.2 } });
//   k.atlas(512, 512);                                   // per-device print atlas
//   k.box('paint', 0.36, 0.48, 0.012, 0, 0, 0.006, { r: 0.003, tint: 0x8a8f8c });
//   const door = k.grp(-0.18, 0, 0.12, { name: 'door' }); k.inside(door, () => { ... });
//   return k.done({ mass: 12, material: 'metal' });
//
// Slots: material classes 'paint' | 'metal' | 'plastic' | 'dark' | 'wood' | 'rust' | 'tile' | 'concrete',
// 'atlas' (labels), 'decal' (alpha-blended atlas prints / grime), 'glass' (clear additive), a palette
// swatch '#rrggbb[:kind]' (solid colour through the atlas material, kind = surface letter, see atlas.js),
// or any THREE.Material. Per-call options: tint (sRGB hex), rough (roughness multiplier 0.25..1.75),
// chip (paint wear 0..1), rust (0..1), grime / dust (multipliers), edge (edge-wear multiplier),
// rot [x,y,z,order], s (scale), q (quaternion), uvs (uv scale), uvOff:false.
import * as THREE from 'three';
import { RNG, hashString } from '../../core/rng.js';
import { classMat, atlasMats, atlasGlowMat, CLEAR, hasClass } from './mats.js';
import { Atlas, placeholderTex, PRINTED, SCREEN_GLOW } from './atlas.js';
import { linkInstanced, linkMasked, linkGlow, linkSkin } from './sync.js';

export const PI = Math.PI, TAU = PI * 2, HP = PI / 2, DEG = PI / 180;
export const NO = Object.freeze({});
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const toV = (p) => (p.isVector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2]));
const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

// ---------------------------------------------------------------------------
// noise (JS side: dents, cable sag jitter, procedural wear)
// ---------------------------------------------------------------------------
function h3(x, y, z, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) + Math.imul(s, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise3(x, y, z, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let xf = x - xi, yf = y - yi, zf = z - zi;
  xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf); zf = zf * zf * (3 - 2 * zf);
  const a = lerp(lerp(h3(xi, yi, zi, s), h3(xi + 1, yi, zi, s), xf), lerp(h3(xi, yi + 1, zi, s), h3(xi + 1, yi + 1, zi, s), xf), yf);
  const b = lerp(lerp(h3(xi, yi, zi + 1, s), h3(xi + 1, yi, zi + 1, s), xf), lerp(h3(xi, yi + 1, zi + 1, s), h3(xi + 1, yi + 1, zi + 1, s), xf), yf);
  return lerp(a, b, zf);
}
export function fbm3(x, y, z, s = 0, oct = 3) {
  let a = 0.5, f = 1, t = 0, n = 0;
  for (let i = 0; i < oct; i++) { t += a * noise3(x * f, y * f, z * f, s + i * 17); n += a; a *= 0.5; f *= 2.03; }
  return t / n;
}
export const posKey = (x, y, z) => ((Math.round(x * 4000) + 65536) * 131072 + (Math.round(y * 4000) + 65536)) * 131072 + (Math.round(z * 4000) + 65536);

export function mat4(x = 0, y = 0, z = 0, rot = null, s = null, q = null) {
  if (q) _q.copy(q);
  else { if (rot) _e.set(rot[0] || 0, rot[1] || 0, rot[2] || 0, rot[3] || 'XYZ'); else _e.set(0, 0, 0); _q.setFromEuler(_e); }
  if (s === null || s === undefined) _s.set(1, 1, 1); else if (typeof s === 'number') _s.setScalar(s); else _s.set(s[0], s[1], s[2]);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s);
}
// quaternion rotating +Y onto direction d
export function qUp(d, roll = 0) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, toV(d).normalize());
  if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, roll));
  return q;
}

// ---------------------------------------------------------------------------
// Geo: growable indexed mesh data. p (xyz), n (xyz), uv (meters), e (edge factor 0..1),
// a (per-vertex material attributes, stride 8: tint rgb, rough, chip, rust, grime mul, dust mul)
// ---------------------------------------------------------------------------
export class Geo {
  constructor() { this.p = []; this.n = []; this.uv = []; this.e = []; this.a = []; this.idx = []; }
  get count() { return this.p.length / 3; }
  v(x, y, z, nx, ny, nz, u, w, e = 0) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, w); this.e.push(e);
    return this.p.length / 3 - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  // append another geo transformed by matrix m; uvOff shifts UVs; attrs (array of 8) fills a
  append(g, m = null, uvOff = null, eMul = 1, attrs = null) {
    const base = this.count;
    const P = g.p, N = g.n;
    if (m) {
      const e = m.elements;
      const nm = new THREE.Matrix3().getNormalMatrix(m).elements;
      for (let i = 0; i < P.length; i += 3) {
        const x = P[i], y = P[i + 1], z = P[i + 2];
        this.p.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
        const a = N[i], b = N[i + 1], c = N[i + 2];
        const nx = nm[0] * a + nm[3] * b + nm[6] * c, ny = nm[1] * a + nm[4] * b + nm[7] * c, nz = nm[2] * a + nm[5] * b + nm[8] * c;
        const l = Math.hypot(nx, ny, nz) || 1;
        this.n.push(nx / l, ny / l, nz / l);
      }
    } else {
      for (let i = 0; i < P.length; i++) { this.p.push(P[i]); this.n.push(N[i]); }
    }
    if (uvOff) for (let i = 0; i < g.uv.length; i += 2) this.uv.push(g.uv[i] + uvOff[0], g.uv[i + 1] + uvOff[1]);
    else for (let i = 0; i < g.uv.length; i++) this.uv.push(g.uv[i]);
    for (let i = 0; i < g.e.length; i++) this.e.push(Math.min(1, g.e[i] * eMul));
    if (attrs) { const n = g.count; for (let i = 0; i < n; i++) for (let k = 0; k < 8; k++) this.a.push(attrs[k]); }
    else if (g.a.length) for (let i = 0; i < g.a.length; i++) this.a.push(g.a[i]);
    const flip = m && m.determinant() < 0;
    if (flip) for (let i = 0; i < g.idx.length; i += 3) this.idx.push(g.idx[i] + base, g.idx[i + 2] + base, g.idx[i + 1] + base);
    else for (let i = 0; i < g.idx.length; i++) this.idx.push(g.idx[i] + base);
    return this;
  }
  applyMatrix(m) {
    const t = new Geo().append(this, m);
    this.p = t.p; this.n = t.n; this.idx = t.idx;
    return this;
  }
  flip() { for (let i = 0; i < this.idx.length; i += 3) { const t = this.idx[i + 1]; this.idx[i + 1] = this.idx[i + 2]; this.idx[i + 2] = t; } for (let i = 0; i < this.n.length; i++) this.n[i] = -this.n[i]; return this; }
  uvMap(su, sv, swap = false, ou = 0, ov = 0) {
    for (let i = 0; i < this.uv.length; i += 2) {
      let u = this.uv[i] * su, w = this.uv[i + 1] * sv;
      if (swap) { const t = u; u = w; w = t; }
      this.uv[i] = u + ou; this.uv[i + 1] = w + ov;
    }
    return this;
  }
  setEdge(v) { for (let i = 0; i < this.e.length; i++) this.e[i] = v; return this; }
  translate(x, y, z) { for (let i = 0; i < this.p.length; i += 3) { this.p[i] += x; this.p[i + 1] += y; this.p[i + 2] += z; } return this; }
  scale(x, y, z) { return this.applyMatrix(new THREE.Matrix4().makeScale(x, y, z)); }
  rotX(a) { return this.applyMatrix(new THREE.Matrix4().makeRotationX(a)); }
  rotY(a) { return this.applyMatrix(new THREE.Matrix4().makeRotationY(a)); }
  rotZ(a) { return this.applyMatrix(new THREE.Matrix4().makeRotationZ(a)); }
  // per-vertex position deform fn(p:Vector3, n:Vector3, i) -> mutates p
  deform(fn, renormal = true) {
    const p = V3(), n = V3();
    for (let i = 0; i < this.count; i++) {
      p.set(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]);
      n.set(this.n[i * 3], this.n[i * 3 + 1], this.n[i * 3 + 2]);
      fn(p, n, i);
      this.p[i * 3] = p.x; this.p[i * 3 + 1] = p.y; this.p[i * 3 + 2] = p.z;
    }
    if (renormal) this.computeNormals(true);
    return this;
  }
  computeNormals(weld = true) {
    const n = this.count, acc = new Float32Array(n * 3), P = this.p, I = this.idx;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      acc[a] += nx; acc[a + 1] += ny; acc[a + 2] += nz;
      acc[b] += nx; acc[b + 1] += ny; acc[b + 2] += nz;
      acc[c] += nx; acc[c + 1] += ny; acc[c + 2] += nz;
    }
    if (weld) {
      const first = new Map(), next = new Int32Array(n).fill(-1);
      for (let i = 0; i < n; i++) {
        const k = posKey(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
        const f = first.get(k);
        if (f === undefined) first.set(k, i);
        else { next[i] = next[f]; next[f] = i; }
      }
      for (const f of first.values()) {
        if (next[f] < 0) continue;
        let x = 0, y = 0, z = 0;
        for (let i = f; i >= 0; i = next[i]) { x += acc[i * 3]; y += acc[i * 3 + 1]; z += acc[i * 3 + 2]; }
        for (let i = f; i >= 0; i = next[i]) { acc[i * 3] = x; acc[i * 3 + 1] = y; acc[i * 3 + 2] = z; }
      }
    }
    for (let i = 0; i < n; i++) {
      const x = acc[i * 3], y = acc[i * 3 + 1], z = acc[i * 3 + 2], l = Math.hypot(x, y, z);
      if (l > 1e-12) { this.n[i * 3] = x / l; this.n[i * 3 + 1] = y / l; this.n[i * 3 + 2] = z / l; }
    }
    return this;
  }
  bounds() {
    const b = new THREE.Box3();
    for (let i = 0; i < this.p.length; i += 3) b.expandByPoint(_p.set(this.p[i], this.p[i + 1], this.p[i + 2]));
    return b;
  }
}

export function fromBuffer(bg, uvScale = 1, edge = 0) {
  const g = new Geo();
  if (!bg.attributes.normal) bg.computeVertexNormals();
  const P = bg.attributes.position, N = bg.attributes.normal, U = bg.attributes.uv;
  for (let i = 0; i < P.count; i++) g.v(P.getX(i), P.getY(i), P.getZ(i), N.getX(i), N.getY(i), N.getZ(i), U ? U.getX(i) * uvScale : 0, U ? U.getY(i) * uvScale : 0, edge);
  if (bg.index) for (let i = 0; i < bg.index.count; i++) g.idx.push(bg.index.getX(i));
  else for (let i = 0; i < P.count; i++) g.idx.push(i);
  return g;
}

// ---------------------------------------------------------------------------
// Primitives (local space, UVs in meters)
// ---------------------------------------------------------------------------
const FACES = [
  { n: 0, s: 1, u: 2, us: -1, v: 1, vs: 1 },
  { n: 0, s: -1, u: 2, us: 1, v: 1, vs: 1 },
  { n: 1, s: 1, u: 0, us: 1, v: 2, vs: -1 },
  { n: 1, s: -1, u: 0, us: 1, v: 2, vs: 1 },
  { n: 2, s: 1, u: 0, us: 1, v: 1, vs: 1 },
  { n: 2, s: -1, u: 0, us: -1, v: 1, vs: 1 },
];
const AX = ['x', 'y', 'z'];
function axisEntries(H, r, s, wear, div) {
  const out = [];
  const inner = Math.max(0, H - r);
  if (r > 1e-5) for (let k = s; k >= 1; k--) out.push({ c: -inner, t: -Math.tan((PI / 4) * (k / s)), e: k / s });
  const ws = wear > 0 && H > 0.035 && r < 0.01 && inner - wear > inner * 0.25 ? wear : 0;
  const eIn = r > 1e-5 ? (ws ? 0.45 : 0) : (ws ? 0.8 : 0);
  out.push({ c: -inner, t: 0, e: eIn });
  const a = -inner + ws, b = inner - ws;
  if (ws) out.push({ c: a, t: 0, e: 0 });
  if (div && b - a > div * 1.4) { const n = Math.ceil((b - a) / div); for (let i = 1; i < n; i++) out.push({ c: a + ((b - a) * i) / n, t: 0, e: 0 }); }
  if (ws) out.push({ c: b, t: 0, e: 0 });
  out.push({ c: inner, t: 0, e: eIn });
  if (r > 1e-5) for (let k = 1; k <= s; k++) out.push({ c: inner, t: Math.tan((PI / 4) * (k / s)), e: k / s });
  return out;
}
// Rounded / bevelled box. o: { r (bevel radius), seg (1..3), wear (edge-wear falloff width), div (subdivide
//   flat faces to cells of this size, for dents), grain ('x'|'y'|'z': texture U follows that axis),
//   skip: { px, nx, py, ny, pz, nz } faces to omit }
export function boxGeo(w, h, d, o = NO) {
  const half = [w / 2, h / 2, d / 2];
  let r = Math.max(0, Math.min(o.r ?? 0.002, half[0] - 1e-4, half[1] - 1e-4, half[2] - 1e-4));
  if (r < 0.0012 && !o.keepBevel) r = 0;
  const s = o.seg ?? (r < 0.006 || Math.min(w, h, d) < 0.02 ? 1 : r < 0.04 ? 2 : 3);
  const wear = o.wear ?? Math.min(0.012, Math.min(w, h, d) * 0.3);
  const grain = o.grain !== undefined ? AX.indexOf(o.grain) : -1;
  const skip = o.skip || null;
  const g = new Geo();
  const P = [0, 0, 0], N = [0, 0, 0];
  for (const F of FACES) {
    if (skip && skip[(F.s > 0 ? 'p' : 'n') + AX[F.n]]) continue;
    const eu = axisEntries(half[F.u], r, s, wear, o.div), ev = axisEntries(half[F.v], r, s, wear, o.div);
    const base = g.count;
    const nInner = half[F.n] - r;
    for (let j = 0; j < ev.length; j++) {
      for (let i = 0; i < eu.length; i++) {
        const A = eu[i], B = ev[j];
        const tu = A.t, tv = B.t, len = Math.hypot(tu, tv, 1);
        N[F.u] = (F.us * tu) / len; N[F.v] = (F.vs * tv) / len; N[F.n] = F.s / len;
        P[F.u] = F.us * A.c + r * N[F.u];
        P[F.v] = F.vs * B.c + r * N[F.v];
        P[F.n] = F.s * nInner + r * N[F.n];
        let uu = P[F.u] * F.us, vv = P[F.v] * F.vs;
        if (grain >= 0 && grain === F.v) { const t = uu; uu = vv; vv = t; }
        g.v(P[0], P[1], P[2], N[0], N[1], N[2], uu, vv, Math.max(A.e, B.e));
      }
    }
    const nu = eu.length;
    for (let j = 0; j < ev.length - 1; j++) for (let i = 0; i < nu - 1; i++) {
      const a = base + j * nu + i;
      g.quad(a, a + 1, a + 1 + nu, a + nu);
    }
  }
  return g;
}
// gentle oil-canning / dents on flat interior vertices (edge factor 0), keeps bevel normals
export function dentGeo(g, amp, seed = 1, freq = 7) {
  const orig = g.n.slice();
  for (let i = 0; i < g.count; i++) {
    if (g.e[i] > 0.01) continue;
    const x = g.p[i * 3], y = g.p[i * 3 + 1], z = g.p[i * 3 + 2];
    const d = (fbm3(x * freq + 3.1, y * freq, z * freq, seed, 3) - 0.5) * 2 * amp;
    g.p[i * 3] += g.n[i * 3] * d; g.p[i * 3 + 1] += g.n[i * 3 + 1] * d; g.p[i * 3 + 2] += g.n[i * 3 + 2] * d;
  }
  g.computeNormals(false);
  for (let i = 0; i < g.count; i++) if (g.e[i] > 0.01) { g.n[i * 3] = orig[i * 3]; g.n[i * 3 + 1] = orig[i * 3 + 1]; g.n[i * 3 + 2] = orig[i * 3 + 2]; }
  return g;
}

// Lathe around Y. pts: [[r, y, flags?, edge?], ...] bottom -> top for an outward-facing surface.
// flags: 1 = hard crease, 2 = edge (wear). o: { seg, phi0, phiLen, uv:'cyl', swap }
export function latheGeo(pts0, segs = 24, o = NO) {
  const phi0 = o.phi0 ?? 0, phiLen = o.phiLen ?? TAU;
  // wear rings: long segments leaving / entering an edge row get an extra row ~1 cm in with edge 0,
  // so the edge factor does not smear over the whole surface
  const eOf = (p) => ((p[2] || 0) & 2 ? 1 : (p[3] ?? 0));
  const pts = [];
  for (let i = 0; i < pts0.length; i++) {
    const a = pts0[i];
    pts.push(a);
    if (i === pts0.length - 1) break;
    const b = pts0[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (o.rings === false || len < 0.024) continue;
    const ea = eOf(a) > 0, eb = eOf(b) > 0;
    const w = Math.min(0.01, len * 0.3) / len;
    if (ea) pts.push([a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, 0, 0]);
    if (eb) pts.push([b[0] - (b[0] - a[0]) * w, b[1] - (b[1] - a[1]) * w, 0, 0]);
  }
  const n = pts.length;
  const segMode = [];
  for (let j = 0; j < n - 1; j++) {
    const dr = pts[j + 1][0] - pts[j][0], dy = pts[j + 1][1] - pts[j][1];
    segMode.push(o.uv === 'cyl' ? false : Math.abs(dy) < Math.abs(dr) * 0.35);
  }
  const prof = [];
  let s = 0;
  const segN = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dy / l, -dx / l, l]; };
  const rmax = Math.max(...pts.map((p) => p[0]), 1e-4);
  for (let j = 0; j < n; j++) {
    const p = pts[j], f = p[2] || 0;
    const nin = j > 0 ? segN(pts[j - 1], p) : null, nout = j < n - 1 ? segN(p, pts[j + 1]) : null;
    if (nin) s += nin[2];
    const e = f & 2 ? 1 : (p[3] ?? 0);
    const mIn = j > 0 ? segMode[j - 1] : segMode[0], mOut = j < n - 1 ? segMode[j] : segMode[n - 2];
    const rl = Math.max(p[0], rmax * 0.25);
    if (f & 1 && nin && nout) {
      prof.push({ r: p[0], y: p[1], nr: nin[0], ny: nin[1], s, dup: false, e, pl: mIn, rl });
      prof.push({ r: p[0], y: p[1], nr: nout[0], ny: nout[1], s, dup: true, e, pl: mOut, rl });
    } else {
      const a = nin || nout, b = nout || nin;
      const nr = a[0] + b[0], ny = a[1] + b[1], l = Math.hypot(nr, ny) || 1;
      prof.push({ r: p[0], y: p[1], nr: nr / l, ny: ny / l, s, dup: false, e, pl: mIn, rl });
      if (mIn !== mOut) prof.push({ r: p[0], y: p[1], nr: nr / l, ny: ny / l, s, dup: true, e, pl: mOut, rl });
    }
  }
  const g = new Geo();
  const cols = prof.length;
  for (let i = 0; i <= segs; i++) {
    const phi = phi0 + (i / segs) * phiLen, sn = Math.sin(phi), cs = Math.cos(phi);
    for (const q of prof) {
      const x = q.r * sn, z = q.r * cs;
      if (q.pl) g.v(x, q.y, z, q.nr * sn, q.ny, q.nr * cs, x, z, q.e);
      else g.v(x, q.y, z, q.nr * sn, q.ny, q.nr * cs, phi * q.rl, q.s, q.e);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < cols - 1; j++) {
      if (prof[j + 1].dup) continue;
      if (prof[j].r < 1e-6 && prof[j + 1].r < 1e-6) continue;
      const a = i * cols + j, b = (i + 1) * cols + j;
      g.quad(a, b, b + 1, a + 1);
    }
  }
  if (o.swap) g.uvMap(1, 1, true);
  g.len = s;
  return g;
}

// cylinder (axis Y, centred) with optional bevelled cap edges; o: { r2 (top radius), bev, seg, caps, open, phi0, phiLen }
export function cylGeo(r, h, o = NO) {
  const rt = o.r2 ?? r, rb = r, bv = Math.min(o.bev ?? 0, rt * 0.45, rb * 0.45, h * 0.45);
  const y0 = -h / 2, y1 = h / 2;
  const pts = [];
  const caps = (o.caps ?? true) && !o.open;
  if (caps) pts.push([0, y0, 0]);
  if (bv > 0) {
    const bs = o.bevSeg ?? (bv < 0.003 ? 2 : 3);
    if (caps) pts.push([rb - bv, y0, 2]);
    for (let k = 1; k < bs; k++) { const a = (k / bs) * HP; pts.push([rb - bv + Math.sin(a) * bv, y0 + bv - Math.cos(a) * bv, 2]); }
    pts.push([rb, y0 + bv, 0, 0.35]);
    pts.push([rt, y1 - bv, 0, 0.35]);
    for (let k = 1; k < bs; k++) { const a = (k / bs) * HP; pts.push([rt - bv + Math.cos(a) * bv, y1 - bv + Math.sin(a) * bv, 2]); }
    if (caps) pts.push([rt - bv, y1, 2]);
  } else {
    pts.push([rb, y0, caps ? 1 | 2 : 2]);
    pts.push([rt, y1, caps ? 1 | 2 : 2]);
  }
  if (caps) pts.push([0, y1, 0]);
  return latheGeo(pts, o.seg ?? 16, o);
}

export function sphereGeo(r, o = NO) {
  const ws = o.ws ?? 16, hs = o.hs ?? 10;
  const g = new Geo();
  const t0 = o.t0 ?? 0, tl = o.tl ?? PI, p0 = o.p0 ?? 0, pl = o.pl ?? TAU;
  for (let j = 0; j <= hs; j++) {
    const th = t0 + (j / hs) * tl, st = Math.sin(th), ct = Math.cos(th);
    for (let i = 0; i <= ws; i++) {
      const ph = p0 + (i / ws) * pl, sp = Math.sin(ph), cp = Math.cos(ph);
      const nx = st * sp, ny = ct, nz = st * cp;
      g.v(nx * r, ny * r, nz * r, nx, ny, nz, ph * r, th * r, 0);
    }
  }
  for (let j = 0; j < hs; j++) for (let i = 0; i < ws; i++) {
    const a = j * (ws + 1) + i, b = a + ws + 1;
    g.quad(a, b, b + 1, a + 1);
  }
  return g;
}

// torus in the XY plane (axis Z). o: { rs (tube segs), ts (ring segs), arc, e (edge factor) }
export function torusGeo(R, t, o = NO) {
  const rs = o.rs ?? 8, ts = o.ts ?? 24, arc = o.arc ?? TAU, a0 = o.a0 ?? 0;
  const g = new Geo();
  for (let j = 0; j <= rs; j++) {
    const v = (j / rs) * TAU, cv = Math.cos(v), sv = Math.sin(v);
    for (let i = 0; i <= ts; i++) {
      const u = a0 + (i / ts) * arc, cu = Math.cos(u), su = Math.sin(u);
      const x = (R + t * cv) * cu, y = (R + t * cv) * su, z = t * sv;
      g.v(x, y, z, cv * cu, cv * su, sv, u * R, v * t, o.e ?? (cv > 0.5 ? 0.6 : 0));
    }
  }
  for (let j = 0; j < rs; j++) for (let i = 0; i < ts; i++) {
    const a = j * (ts + 1) + i, b = a + ts + 1;
    g.quad(a, a + 1, b + 1, b);
  }
  return g;
}

// Corner-rounded polyline (quadratic fillets)
export function roundPath(pts, r, segs = 4, closed = false) {
  const P = pts.map(toV), n = P.length, out = [];
  if (!closed) out.push(P[0]);
  const lo = closed ? 0 : 1, hi = closed ? n : n - 1;
  for (let i = lo; i < hi; i++) {
    const a = P[(i - 1 + n) % n], p = P[i], c = P[(i + 1) % n];
    const d1 = a.clone().sub(p), d2 = c.clone().sub(p);
    const l1 = d1.length(), l2 = d2.length();
    d1.normalize(); d2.normalize();
    const ang = d1.angleTo(d2);
    if (ang > PI - 0.02 || r <= 0) { out.push(p.clone()); continue; }
    const t = Math.min(r / Math.tan(ang / 2), l1 * 0.5, l2 * 0.5);
    const s0 = p.clone().addScaledVector(d1, t), e0 = p.clone().addScaledVector(d2, t);
    for (let k = 0; k <= segs; k++) {
      const u = k / segs;
      out.push(V3().addScaledVector(s0, (1 - u) * (1 - u)).addScaledVector(p, 2 * u * (1 - u)).addScaledVector(e0, u * u));
    }
  }
  if (!closed) out.push(P[n - 1]);
  return out;
}
// resample a polyline (or curve points) so no segment is longer than maxLen
export function densify(pts, maxLen) {
  const P = pts.map(toV), out = [P[0]];
  for (let i = 1; i < P.length; i++) {
    const n = Math.max(1, Math.ceil(P[i].distanceTo(P[i - 1]) / maxLen));
    for (let k = 1; k <= n; k++) out.push(P[i - 1].clone().lerp(P[i], k / n));
  }
  return out;
}
// smooth Catmull-Rom curve through points -> n samples
export function curvePts(pts, n, o = NO) {
  const c = new THREE.CatmullRomCurve3(pts.map(toV), !!o.closed, o.type || 'centripetal', o.tension ?? 0.5);
  return c.getPoints(n);
}

// Swept tube with rotation-minimising frames. radius: number | [rn, rb] | fn(t, i)
// o: { radial, closed, caps: true|'round'|false|[a,b], twist, up }
export function tubeGeo(pts, radius, o = NO) {
  const P = pts.map(toV), n = P.length, closed = !!o.closed;
  const radial = o.radial ?? 8;
  const T = [];
  for (let i = 0; i < n; i++) {
    let t;
    if (closed) t = P[(i + 1) % n].clone().sub(P[(i - 1 + n) % n]);
    else if (i === 0) t = P[1].clone().sub(P[0]);
    else if (i === n - 1) t = P[n - 1].clone().sub(P[n - 2]);
    else t = P[i + 1].clone().sub(P[i]).normalize().add(P[i].clone().sub(P[i - 1]).normalize());
    if (t.lengthSq() < 1e-14) t = i > 0 ? T[i - 1].clone() : V3(0, 1, 0);
    T.push(t.normalize());
  }
  const Nn = [], B = [];
  const ref = o.up ? toV(o.up) : Math.abs(T[0].y) < 0.9 ? V3(0, 1, 0) : V3(1, 0, 0);
  Nn[0] = ref.clone().sub(T[0].clone().multiplyScalar(ref.dot(T[0]))).normalize();
  B[0] = V3().crossVectors(T[0], Nn[0]);
  const q = new THREE.Quaternion();
  for (let i = 1; i < n; i++) {
    q.setFromUnitVectors(T[i - 1], T[i]);
    Nn[i] = Nn[i - 1].clone().applyQuaternion(q);
    Nn[i].sub(T[i].clone().multiplyScalar(Nn[i].dot(T[i]))).normalize();
    B[i] = V3().crossVectors(T[i], Nn[i]);
  }
  const rf = typeof radius === 'function' ? radius : () => radius;
  const g = new Geo();
  let s = 0;
  const ring = radial + 1;
  let rRef = 0;
  for (let i = 0; i < n; i++) { const r = rf(i / Math.max(1, n - 1), i); rRef = Math.max(rRef, Array.isArray(r) ? Math.max(r[0], r[1]) : r); }
  for (let i = 0; i < n; i++) {
    if (i > 0) s += P[i].distanceTo(P[i - 1]);
    const r = rf(i / Math.max(1, n - 1), i);
    const rn = Array.isArray(r) ? r[0] : r, rb = Array.isArray(r) ? r[1] : r;
    const tw = (o.twist ?? 0) * (i / Math.max(1, n - 1));
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU + tw, ca = Math.cos(a), sa = Math.sin(a);
      const x = P[i].x + Nn[i].x * ca * rn + B[i].x * sa * rb, y = P[i].y + Nn[i].y * ca * rn + B[i].y * sa * rb, z = P[i].z + Nn[i].z * ca * rn + B[i].z * sa * rb;
      let nx = Nn[i].x * ca * rb + B[i].x * sa * rn, ny = Nn[i].y * ca * rb + B[i].y * sa * rn, nz = Nn[i].z * ca * rb + B[i].z * sa * rn;
      const l = Math.hypot(nx, ny, nz) || 1;
      g.v(x, y, z, nx / l, ny / l, nz / l, s, (j / radial) * TAU * rRef, o.e ?? 0);
    }
  }
  const segsN = closed ? n : n - 1;
  for (let i = 0; i < segsN; i++) {
    const i2 = (i + 1) % n;
    for (let j = 0; j < radial; j++) {
      const a = i * ring + j, b = i2 * ring + j;
      g.quad(a, a + 1, b + 1, b);
    }
  }
  const capsO = o.caps ?? true;
  if (!closed && capsO) {
    for (const [i, sgn] of [[0, -1], [n - 1, 1]]) {
      const caps = Array.isArray(capsO) ? capsO[sgn < 0 ? 0 : 1] : capsO;
      if (!caps) continue;
      const r = rf(i / Math.max(1, n - 1), i);
      const rn = Array.isArray(r) ? r[0] : r, rb = Array.isArray(r) ? r[1] : r;
      if (caps === 'round') {
        const rows = 3, start = g.count;
        for (let k = 1; k <= rows; k++) {
          const th = (k / rows) * HP, ct = Math.cos(th), st = Math.sin(th);
          for (let j = 0; j <= radial; j++) {
            const a = (j / radial) * TAU, ca = Math.cos(a), sa = Math.sin(a);
            const nx = (Nn[i].x * ca + B[i].x * sa) * ct + T[i].x * sgn * st, ny = (Nn[i].y * ca + B[i].y * sa) * ct + T[i].y * sgn * st, nz = (Nn[i].z * ca + B[i].z * sa) * ct + T[i].z * sgn * st;
            const mr = Math.min(rn, rb);
            g.v(P[i].x + (Nn[i].x * ca * rn + B[i].x * sa * rb) * ct + T[i].x * sgn * st * mr, P[i].y + (Nn[i].y * ca * rn + B[i].y * sa * rb) * ct + T[i].y * sgn * st * mr, P[i].z + (Nn[i].z * ca * rn + B[i].z * sa * rb) * ct + T[i].z * sgn * st * mr, nx, ny, nz, s + sgn * (k / rows) * rn, (j / radial) * TAU * rRef, 0.3);
          }
        }
        const prevRow = (k) => (k === 0 ? i * ring : start + (k - 1) * ring);
        for (let k = 0; k < rows; k++) {
          const r0 = prevRow(k), r1 = start + k * ring;
          for (let j = 0; j < radial; j++) {
            if (sgn > 0) g.quad(r0 + j, r0 + j + 1, r1 + j + 1, r1 + j);
            else g.quad(r0 + j, r1 + j, r1 + j + 1, r0 + j + 1);
          }
        }
      } else {
        const ci = g.v(P[i].x, P[i].y, P[i].z, T[i].x * sgn, T[i].y * sgn, T[i].z * sgn, 0, 0, 0.3);
        const start = g.count;
        for (let j = 0; j <= radial; j++) {
          const a = (j / radial) * TAU, ca = Math.cos(a), sa = Math.sin(a);
          g.v(P[i].x + Nn[i].x * ca * rn + B[i].x * sa * rb, P[i].y + Nn[i].y * ca * rn + B[i].y * sa * rb, P[i].z + Nn[i].z * ca * rn + B[i].z * sa * rb, T[i].x * sgn, T[i].y * sgn, T[i].z * sgn, ca * rn, sa * rb, 0.8);
        }
        for (let j = 0; j < radial; j++) {
          if (sgn > 0) g.tri(ci, start + j, start + j + 1);
          else g.tri(ci, start + j + 1, start + j);
        }
      }
    }
  }
  g.len = s;
  return g;
}

// average normals of coincident vertices whose normals are within `angle`
export function creaseNormals(g, angle = 0.7) {
  const n = g.count, P = g.p, I = g.idx;
  const fn = new Float32Array(n * 3);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { fn[k] += nx; fn[k + 1] += ny; fn[k + 2] += nz; }
  }
  for (let i = 0; i < n; i++) { const l = Math.hypot(fn[i * 3], fn[i * 3 + 1], fn[i * 3 + 2]) || 1; fn[i * 3] /= l; fn[i * 3 + 1] /= l; fn[i * 3 + 2] /= l; }
  const map = new Map();
  for (let i = 0; i < n; i++) {
    const k = posKey(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    let l = map.get(k);
    if (!l) map.set(k, (l = []));
    l.push(i);
  }
  const cosA = Math.cos(angle);
  for (const l of map.values()) {
    for (const i of l) {
      let x = 0, y = 0, z = 0;
      for (const j of l) {
        const d = fn[i * 3] * fn[j * 3] + fn[i * 3 + 1] * fn[j * 3 + 1] + fn[i * 3 + 2] * fn[j * 3 + 2];
        if (d >= cosA) { x += fn[j * 3]; y += fn[j * 3 + 1]; z += fn[j * 3 + 2]; }
      }
      const len = Math.hypot(x, y, z) || 1;
      g.n[i * 3] = x / len; g.n[i * 3 + 1] = y / len; g.n[i * 3 + 2] = z / len;
    }
  }
  return g;
}
// Extrusion of a THREE.Shape along +Z from z = 0 to z = depth (bevel stays inside the outline).
// o: { bev, bevSeg, curveSeg, crease, center, tess (grid cell to slice the caps by: interior vertices for the AO bake) }
// cap triangulation sanity check: a bevel that collapses a rounded corner (bevel >= corner radius) can make
// earcut bridge across holes; the front+back caps then cover more than the shape's own area
function capBroken(bg, shape, curveSeg) {
  const gr = bg.groups[0];
  if (!gr) return false;
  const p = bg.attributes.position.array;
  let a = 0;
  for (let i = gr.start; i < gr.start + gr.count; i += 3) {
    const ax = p[i * 3], ay = p[i * 3 + 1], bx = p[i * 3 + 3], by = p[i * 3 + 4], cx = p[i * 3 + 6], cy = p[i * 3 + 7];
    a += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
  }
  const ex = shape.extractPoints(curveSeg);
  let want = Math.abs(THREE.ShapeUtils.area(ex.shape));
  for (const h of ex.holes) want -= Math.abs(THREE.ShapeUtils.area(h));
  return a / 2 > want * 1.002 + 1e-7;
}
export function extrudeGeo(shape, depth, o = NO) {
  let bv = Math.min(o.bev ?? 0, depth * 0.45);
  const mk = () => new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-5, depth - bv * 2), bevelEnabled: bv > 0, bevelThickness: bv, bevelSize: bv, bevelOffset: -bv,
    bevelSegments: o.bevSeg ?? 2, curveSegments: o.curveSeg ?? 8, steps: 1,
  });
  let bg = mk();
  for (let t = 0; t < 3 && bv > 0 && capBroken(bg, shape, o.curveSeg ?? 8); t++) { bg.dispose(); bv = t < 2 ? bv * 0.6 : 0; bg = mk(); }
  bg.translate(0, 0, bv - (o.center ? depth / 2 : 0));
  const g = fromBuffer(bg, 1);
  bg.dispose();
  creaseNormals(g, o.crease ?? 0.7);
  for (let i = 0; i < g.count; i++) {
    const nz = Math.abs(g.n[i * 3 + 2]);
    g.e[i] = bv > 0 ? clamp((1 - nz) * nz * 4.2, 0, 1) : (nz > 0.05 && nz < 0.95 ? 0.5 : 0);
  }
  if (o.tess) tessCaps(g, o.tess);
  return g;
}
// Slice the flat cap triangles (normal +-Z) of an extrusion along an axis-aligned grid of `cell` metres. AO,
// grime and dust are baked per vertex: a large cap whose only vertices sit on its outline takes on the
// outline's occlusion everywhere (a door leaf darkened by its frame next to a lighter panel mounted on it),
// and plain midpoint subdivision of earcut's long diagonal triangles shows the diagonals in the shading.
function tessCaps(g, cell) {
  const EPS = 1e-7, P = g.p;
  const cap = (i) => Math.abs(g.n[i * 3 + 2]) > 0.98;
  const cut = (a, b, ax, L, cache) => {
    const key = a < b ? a * 8388608 + b : b * 8388608 + a;
    let m = cache.get(key);
    if (m !== undefined) return m;
    const t = (L - P[a * 3 + ax]) / (P[b * 3 + ax] - P[a * 3 + ax]);
    const N = g.n, U = g.uv, E = g.e;
    const x = P[a * 3] + (P[b * 3] - P[a * 3]) * t, y = P[a * 3 + 1] + (P[b * 3 + 1] - P[a * 3 + 1]) * t, z = P[a * 3 + 2] + (P[b * 3 + 2] - P[a * 3 + 2]) * t;
    m = g.v(x, y, z, N[a * 3], N[a * 3 + 1], N[a * 3 + 2], U[a * 2] + (U[b * 2] - U[a * 2]) * t, U[a * 2 + 1] + (U[b * 2 + 1] - U[a * 2 + 1]) * t, E[a] + (E[b] - E[a]) * t);
    cache.set(key, m);
    return m;
  };
  // Sutherland-Hodgman: the part of convex polygon `poly` on side s (+1: coord <= L, -1: coord >= L)
  const clip = (poly, ax, L, s, cache) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const da = s * (P[a * 3 + ax] - L), db = s * (P[b * 3 + ax] - L);
      if (da <= EPS) out.push(a);
      if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) out.push(cut(a, b, ax, L, cache));
    }
    return out;
  };
  const I = g.idx, out = [];
  for (let t = 0; t < I.length; t += 3) {
    const tri = [I[t], I[t + 1], I[t + 2]];
    if (!(cap(tri[0]) && cap(tri[1]) && cap(tri[2]))) { out.push(tri[0], tri[1], tri[2]); continue; }
    let pieces = [tri];
    for (const ax of [0, 1]) {
      const next = [];
      for (const pc of pieces) {
        let lo = Infinity, hi = -Infinity;
        for (const v of pc) { lo = Math.min(lo, P[v * 3 + ax]); hi = Math.max(hi, P[v * 3 + ax]); }
        let cur = pc;
        for (let k = Math.floor(lo / cell) + 1; k * cell < hi - EPS && cur.length >= 3; k++) {
          const L = k * cell;
          if (L <= lo + EPS) continue;
          const cache = new Map();
          const below = clip(cur, ax, L, 1, cache);
          cur = clip(cur, ax, L, -1, cache);
          if (below.length >= 3) next.push(below);
        }
        if (cur.length >= 3) next.push(cur);
      }
      pieces = next;
    }
    for (const pc of pieces) for (let i = 1; i + 1 < pc.length; i++) out.push(pc[0], pc[i], pc[i + 1]);
  }
  g.idx = out;
  return g;
}
// flat quad facing +Z (uv: atlas region rect or meters)
export function quadGeo(w, h, reg = null, flipU = false) {
  const g = new Geo();
  const x = w / 2, y = h / 2;
  const U = (u, v) => (reg ? [lerp(reg.u0, reg.u1, flipU ? 1 - u : u), lerp(reg.v0, reg.v1, v)] : [(u - 0.5) * w, (v - 0.5) * h]);
  const a = g.v(-x, -y, 0, 0, 0, 1, ...U(0, 0)), b = g.v(x, -y, 0, 0, 0, 1, ...U(1, 0)), c = g.v(x, y, 0, 0, 0, 1, ...U(1, 1)), d = g.v(-x, y, 0, 0, 0, 1, ...U(0, 1));
  g.quad(a, b, c, d);
  return g;
}
// disc facing +Z (uv: region mapped to the disc's bounding square, or meters)
export function discGeo(r, seg = 24, reg = null) {
  const g = new Geo();
  const U = (x, y) => (reg ? [lerp(reg.u0, reg.u1, x / (2 * r) + 0.5), lerp(reg.v0, reg.v1, y / (2 * r) + 0.5)] : [x, y]);
  const c = g.v(0, 0, 0, 0, 0, 1, ...U(0, 0));
  for (let i = 0; i <= seg; i++) { const a = (i / seg) * TAU, x = Math.cos(a) * r, y = Math.sin(a) * r; g.v(x, y, 0, 0, 0, 1, ...U(x, y)); }
  for (let i = 0; i < seg; i++) g.tri(c, c + 1 + i, c + 2 + i);
  return g;
}
// flat annulus facing +Z
export function ringGeo(r0, r1, seg = 24, reg = null) {
  const g = new Geo();
  const U = (x, y) => (reg ? [lerp(reg.u0, reg.u1, x / (2 * r1) + 0.5), lerp(reg.v0, reg.v1, y / (2 * r1) + 0.5)] : [x, y]);
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * TAU, c = Math.cos(a), s = Math.sin(a);
    g.v(c * r0, s * r0, 0, 0, 0, 1, ...U(c * r0, s * r0));
    g.v(c * r1, s * r1, 0, 0, 0, 1, ...U(c * r1, s * r1));
  }
  for (let i = 0; i < seg; i++) { const a = i * 2; g.quad(a, a + 1, a + 3, a + 2); }
  return g;
}
// curved quad on a cylinder (axis Y) of radius r centred at angle a (0 = +Z), height h, arc length arc (rad)
export function arcQuadGeo(r, h, arc, a = 0, reg = null, seg = 12) {
  const g = new Geo();
  for (let j = 0; j <= 1; j++) for (let i = 0; i <= seg; i++) {
    const t = a - arc / 2 + (i / seg) * arc;
    g.v(Math.sin(t) * r, (j - 0.5) * h, Math.cos(t) * r, Math.sin(t), 0, Math.cos(t), reg ? lerp(reg.u0, reg.u1, i / seg) : t * r, reg ? lerp(reg.v0, reg.v1, j) : (j - 0.5) * h, 0);
  }
  for (let i = 0; i < seg; i++) g.quad(i, i + 1, i + seg + 2, i + seg + 1);
  return g;
}
// subdivided grid in XZ facing +Y (heightfields, sheets)
export function gridGeo(w, d, nx, nz, hf = null) {
  const g = new Geo();
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = (i / nx - 0.5) * w, z = (j / nz - 0.5) * d;
    g.v(x, hf ? hf(x, z) : 0, z, 0, 1, 0, x, -z, 0);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + nx + 1;
    g.quad(a, b, b + 1, a + 1);
  }
  if (hf) g.computeNormals(false);
  return g;
}
// box with per-face atlas regions { px, nx, py, ny, pz, nz, side, all } (sharp, for printed packages)
export function labelBoxGeo(faces, w, h, d) {
  const bg = new THREE.BoxGeometry(w, h, d);
  const uv = bg.attributes.uv;
  const order = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
  for (let f = 0; f < 6; f++) {
    const r = faces[order[f]] || faces.side || faces.all;
    for (let i = f * 4; i < f * 4 + 4; i++) uv.setXY(i, r.u0 + uv.getX(i) * (r.u1 - r.u0), r.v0 + uv.getY(i) * (r.v1 - r.v0));
  }
  const g = fromBuffer(bg);
  bg.dispose();
  return g;
}
// pillow-bulged CRT plane (BufferGeometry, UVs 0..1, faces +Z)
export function crtGeo(w, h, bulge = 0.01) {
  const g = new THREE.PlaneGeometry(w, h, 12, 9);
  if (bulge) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = (2 * p.getX(i)) / w, y = (2 * p.getY(i)) / h;
      p.setZ(i, bulge * (1 - 0.55 * x * x - 0.45 * y * y - 0.2 * x * x * y * y));
    }
    g.computeVertexNormals();
  }
  return g;
}

// axis helpers: primitives are authored along +Y
export function axisGeo(g, axis) {
  if (!axis || axis === 'y') return g;
  const m = new THREE.Matrix4();
  if (axis === 'x') m.makeRotationZ(-HP);
  else if (axis === '-x') m.makeRotationZ(HP);
  else if (axis === 'z') m.makeRotationX(HP);
  else if (axis === '-z') m.makeRotationX(-HP);
  else if (axis === '-y') m.makeRotationX(PI);
  return g.applyMatrix(m);
}

// 2D shapes
export function rrShape(w, h, r, cx = 0, cy = 0, path = null) {
  const s = path || new THREE.Shape();
  const x = cx - w / 2, y = cy - h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
export function rrHole(w, h, r, cx = 0, cy = 0) { return rrShape(w, h, r, cx, cy, new THREE.Path()); }
export function frameShape(w, h, r, iw, ih, ir, icx = 0, icy = 0) {
  const s = rrShape(w, h, r);
  s.holes.push(rrHole(iw, ih, ir, icx, icy));
  return s;
}
export function circleShape(r, holeR = 0, cx = 0, cy = 0) {
  const s = new THREE.Shape();
  s.absarc(cx, cy, r, 0, TAU, false);
  if (holeR) { const p = new THREE.Path(); p.absarc(cx, cy, holeR, 0, TAU, true); s.holes.push(p); }
  return s;
}
export function circleHole(r, cx = 0, cy = 0) { const p = new THREE.Path(); p.absarc(cx, cy, r, 0, TAU, true); return p; }
export function polyShape(pts) {
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
}

// colliders
const rotOf = (rot) => (rot ? { rot } : {});
export const cbox = (w, h, d, x, y, z, rot) => ({ type: 'box', size: [w, h, d], pos: [x, y, z], ...rotOf(rot) });
export const ccyl = (r, h, x, y, z, rot) => ({ type: 'cylinder', radius: r, height: h, pos: [x, y, z], ...rotOf(rot) });
export const cball = (r, x, y, z) => ({ type: 'ball', radius: r, pos: [x, y, z] });
// a collider given in a local frame (x, y, z, rot): e.g. for a part built inside k.push(x, y, z, rot)
export function cframe(c, x, y, z, rot) {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot?.[0] || 0, rot?.[1] || 0, rot?.[2] || 0, rot?.[3] || 'XYZ')).setPosition(x, y, z);
  const p = V3(...(c.pos || [0, 0, 0])).applyMatrix4(m);
  const q = new THREE.Quaternion().setFromRotationMatrix(m).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(c.rot?.[0] || 0, c.rot?.[1] || 0, c.rot?.[2] || 0)));
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return { ...c, pos: [p.x, p.y, p.z], rot: [e.x, e.y, e.z] };
}

// ---------------------------------------------------------------------------
// Voxel ambient occlusion (per template at rest pose): voxelise occluder triangles into an
// occupancy grid (+ a ground plane: floor / wall / ceiling), build a mip pyramid and cone-trace
// a few wide cones per vertex through it.
// ---------------------------------------------------------------------------
const AO_CONES = (() => {
  const out = [[0, 0, 1, 1.0]];
  const t = 0.96;
  for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU + 0.4; out.push([Math.cos(a) * Math.sin(t), Math.sin(a) * Math.sin(t), Math.cos(t), 0.6]); }
  return out;
})();
function bakeAO(items, bb, opts = {}) {
  const size = bb.getSize(V3());
  const L = Math.max(size.x, size.y, size.z);
  const cell = Math.max(L / (opts.res ?? 40), opts.minCell ?? 0.008);
  const pad = 3;
  const ox = bb.min.x - pad * cell, oy = bb.min.y - pad * cell, oz = bb.min.z - pad * cell;
  const nx = Math.ceil(size.x / cell) + pad * 2 + 1, ny = Math.ceil(size.y / cell) + pad * 2 + 1, nz = Math.ceil(size.z / cell) + pad * 2 + 1;
  const g0 = new Float32Array(nx * ny * nz);
  const inv = 1 / cell, NXY = nx * ny;
  for (const it of items) {
    if (!it.occ) continue;
    const P = it.P, I = it.idx;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ax = (P[a] - ox) * inv, ay = (P[a + 1] - oy) * inv, az = (P[a + 2] - oz) * inv;
      const bx = (P[b] - ox) * inv, by = (P[b + 1] - oy) * inv, bz = (P[b + 2] - oz) * inv;
      const cx = (P[c] - ox) * inv, cy = (P[c + 1] - oy) * inv, cz = (P[c + 2] - oz) * inv;
      const l2 = Math.max((bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2, (cx - ax) ** 2 + (cy - ay) ** 2 + (cz - az) ** 2, (cx - bx) ** 2 + (cy - by) ** 2 + (cz - bz) ** 2);
      const n = l2 < 1 ? 1 : Math.min(160, Math.ceil(Math.sqrt(l2) * 1.05));
      const dn = 1 / n;
      for (let i = 0; i <= n; i++) {
        const u = i * dn;
        for (let j = 0; j <= n - i; j++) {
          const v = j * dn, w = 1 - u - v;
          const x = (ax * w + bx * u + cx * v) | 0, y = (ay * w + by * u + cy * v) | 0, z = (az * w + bz * u + cz * v) | 0;
          if (x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz) g0[z * NXY + y * nx + x] = 1;
        }
      }
    }
  }
  // ground: floor (below the model), wall (behind z = 0), ceiling (above y = 0)
  const ground = opts.ground ?? 'floor';
  const solidOut = (fx, fy, fz) => (ground === 'floor' ? fy < 0 : ground === 'wall' ? fz < (0 - oz) / cell - 0.5 : ground === 'ceiling' ? fy > (0 - oy) / cell - 0.5 : false);
  if (ground === 'floor') {
    const jf = Math.floor((bb.min.y - oy) / cell);
    for (let k = 0; k < nz; k++) for (let j = 0; j < Math.min(ny, jf); j++) for (let i = 0; i < nx; i++) g0[(k * ny + j) * nx + i] = 1;
  } else if (ground === 'wall') {
    const kf = Math.floor((0 - oz) / cell);
    for (let k = 0; k < Math.min(nz, kf); k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) g0[(k * ny + j) * nx + i] = 1;
  } else if (ground === 'ceiling') {
    const jc = Math.ceil((0 - oy) / cell);
    for (let k = 0; k < nz; k++) for (let j = Math.max(0, jc); j < ny; j++) for (let i = 0; i < nx; i++) g0[(k * ny + j) * nx + i] = 1;
  }
  const levels = [{ d: g0, nx, ny, nz, cs: cell }];
  for (let l = 1; l < 5; l++) {
    const p = levels[l - 1];
    const mx = Math.max(1, Math.ceil(p.nx / 2)), my = Math.max(1, Math.ceil(p.ny / 2)), mz = Math.max(1, Math.ceil(p.nz / 2));
    const d = new Float32Array(mx * my * mz);
    for (let k = 0; k < mz; k++) for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++) {
      let sum = 0;
      for (let dk = 0; dk < 2; dk++) for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) {
        const x = Math.min(p.nx - 1, i * 2 + di), y = Math.min(p.ny - 1, j * 2 + dj), z = Math.min(p.nz - 1, k * 2 + dk);
        sum += p.d[(z * p.ny + y) * p.nx + x];
      }
      d[(k * my + j) * mx + i] = sum * 0.125;
    }
    levels.push({ d, nx: mx, ny: my, nz: mz, cs: p.cs * 2 });
  }
  const maxLv = Math.min(3, Math.max(2, Math.round(Math.log2((opts.maxDist ?? 0.3) / cell))));
  const strength = opts.strength ?? 1;
  const t1 = V3(), t2 = V3(), nn = V3();
  const LV = [];
  for (let lv = 0; lv <= maxLv; lv++) LV.push({ L: levels[lv], dist: cell * (lv === 0 ? 1.1 : 1.6 * 2 ** lv), gain: lv === 0 ? 0.9 : 1.3, fall: 1 - lv / (maxLv + 2.5) });
  for (const it of items) {
    if (!it.ao) continue;
    const P = it.P, N = it.N, cnt = P.length / 3, ao = it.ao;
    for (let v = 0; v < cnt; v++) {
      const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2];
      nn.set(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
      if (Math.abs(nn.y) < 0.9) t1.set(0, 1, 0); else t1.set(1, 0, 0);
      t2.crossVectors(nn, t1).normalize();
      t1.crossVectors(t2, nn);
      let occT = 0, wT = 0;
      const bx = px + nn.x * cell * 0.6, by = py + nn.y * cell * 0.6, bz = pz + nn.z * cell * 0.6;
      for (let ci = 0; ci < AO_CONES.length; ci++) {
        const c = AO_CONES[ci];
        const dx = t1.x * c[0] + t2.x * c[1] + nn.x * c[2], dy = t1.y * c[0] + t2.y * c[1] + nn.y * c[2], dz = t1.z * c[0] + t2.z * c[1] + nn.z * c[2];
        let occ = 0;
        for (let lv = 0; lv < LV.length; lv++) {
          const S = LV[lv], L2 = S.L, cs = L2.cs;
          const fx = (bx + dx * S.dist - ox) / cs - 0.5, fy = (by + dy * S.dist - oy) / cs - 0.5, fz = (bz + dz * S.dist - oz) / cs - 0.5;
          const i0 = Math.floor(fx), j0 = Math.floor(fy), k0 = Math.floor(fz);
          const X = L2.nx, Y = L2.ny, Z = L2.nz, D = L2.d;
          let a = 0;
          if (i0 >= 0 && j0 >= 0 && k0 >= 0 && i0 + 1 < X && j0 + 1 < Y && k0 + 1 < Z) {
            const tx = fx - i0, ty = fy - j0, tz = fz - k0;
            const b0 = (k0 * Y + j0) * X + i0, b1 = b0 + X * Y;
            a = ((D[b0] * (1 - tx) + D[b0 + 1] * tx) * (1 - ty) + (D[b0 + X] * (1 - tx) + D[b0 + X + 1] * tx) * ty) * (1 - tz)
              + ((D[b1] * (1 - tx) + D[b1 + 1] * tx) * (1 - ty) + (D[b1 + X] * (1 - tx) + D[b1 + X + 1] * tx) * ty) * tz;
          } else if (solidOut(fx * cs / cell, fy * cs / cell, fz * cs / cell)) a = 1;
          occ += (1 - occ) * Math.min(1, a * S.gain) * S.fall;
        }
        occT += occ * c[3]; wT += c[3];
      }
      ao[v] = clamp(1 - (occT / wT) * 1.15 * strength, 0.08, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------
const DEF_TINT = { paint: 0x8a8d90, metal: 0xc6c8ca, plastic: 0xd2c8aa, dark: 0x232325, wood: 0xffffff, rust: 0xffffff, tile: 0xffffff, concrete: 0xffffff };
// tint / finish presets for the 'metal' class (spread into options)
export const FIN = {
  steel: { tint: 0xb4b8bc, rough: 0.95 },
  satin: { tint: 0xc8ccd0, rough: 0.7 },
  chrome: { tint: 0xe4e6e8, rough: 0.28 },
  zinc: { tint: 0xa9b0b2, rough: 1.15 },
  alu: { tint: 0xc9ccce, rough: 1.05 },
  iron: { tint: 0x55585a, rough: 1.5 },
  black: { tint: 0x2c2d2f, rough: 1.2 },
  brass: { tint: 0xd8b26a, rough: 0.75 },
  oldbrass: { tint: 0xa88a4e, rough: 1.15 },
  copper: { tint: 0xd08a62, rough: 0.9 },
  bronze: { tint: 0x9a7448, rough: 1.1 },
};
const SHADOWLESS = new Set(['decal', 'glass']);
const PROF = typeof location !== 'undefined' && new URLSearchParams(location.search).get('dvprof') === '1';

// shared vertex-coloured emissive material for glow() LED groups (vColor = colour * intensity / ref)
const _glow = new Map();
function glowMat(ref) {
  let m = _glow.get(ref);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, emissive: 0xffffff, emissiveIntensity: ref, vertexColors: true, roughness: 0.3, metalness: 0 });
  m.name = 'dev_glow';
  m.userData.noShadow = true;
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor.rgb;\n#endif'); };
  m.customProgramCacheKey = () => 'dvglow';
  _glow.set(ref, m);
  return m;
}

export class DKit {
  constructor(name, o = {}) {
    this.name = name;
    this.root = new THREE.Group();
    this.root.name = name;
    this.tgt = this.root;
    this.cur = new THREE.Matrix4();
    this.stack = [];
    this.buckets = new Map();
    this.singles = [];
    this._masked = [];
    this._skins = [];
    this.parts = {}; this.anchors = {}; this.screens = {}; this.colliders = []; this.params = {};
    this.wear = { chip: 0.12, rust: 0, grime: 0.45, dust: 0.3, edge: 1, ...(o.wear || {}) };
    this.ground = o.ground ?? 'floor';
    this.aoOpts = o.ao || {};
    this.rng = new RNG((hashString(name) ^ Math.imul((o.seed ?? 0) + 1, 2654435761)) >>> 0);
    this.A = null;
    this.mats = null;
    this.t0 = performance.now();
  }
  // per-device print atlas (max size; cropped to the used height at done())
  atlas(w = 1024, h = 1024) {
    this.A = new Atlas(w, h);
    this.mats = atlasMats(this.A.tex, this.A.stex, this.name);
    this._regs = new Map();
    return this.A;
  }
  // memoised atlas region (drawn once per device)
  reg(key, w, h, draw, kind = '', o) {
    let r = this._regs.get(key);
    if (!r) { r = this.A.add(w, h, draw, kind, o); this._regs.set(key, r); }
    return r;
  }
  // ---- frames ----
  push(x = 0, y = 0, z = 0, rot, s) { this.stack.push(this.cur); this.cur = this.cur.clone().multiply(mat4(x, y, z, rot, s)); return this; }
  pop() { this.cur = this.stack.pop(); return this; }
  inside(obj, fn) {
    const save = [this.tgt, this.cur, this.stack];
    this.tgt = obj; this.cur = new THREE.Matrix4(); this.stack = [];
    try { fn(obj); } finally { [this.tgt, this.cur, this.stack] = save; }
    return obj;
  }
  // build fn's geometry in obj's local frame but merge it into the current target (static). Used for
  // contract parts the game never animates: the pivot group stays (empty) for API compatibility.
  insideStatic(obj, fn) {
    obj.updateMatrix();
    const save = [this.cur, this.stack];
    this.cur = obj.matrix.clone(); this.stack = [new THREE.Matrix4()];
    try { fn(obj); } finally { [this.cur, this.stack] = save; }
    return obj;
  }
  // inside() or insideStatic() depending on `stat`
  within(obj, fn, stat = false) { return stat ? this.insideStatic(obj, fn) : this.inside(obj, fn); }
  // local point of the current frame -> target space
  pt(x, y, z) { return V3(x, y, z).applyMatrix4(this.cur); }
  _place(obj, x, y, z, o) {
    obj.position.set(x, y, z);
    if (o.rot) obj.rotation.set(o.rot[0] || 0, o.rot[1] || 0, o.rot[2] || 0, o.rot[3] || 'XYZ');
    if (o.s !== undefined) typeof o.s === 'number' ? obj.scale.setScalar(o.s) : obj.scale.fromArray(o.s);
    if (o.name) obj.name = o.name;
    const parent = o.to || this.tgt;
    if (this.stack.length && parent === this.tgt) obj.applyMatrix4(this.cur);
    parent.add(obj);
    return obj;
  }
  grp(x = 0, y = 0, z = 0, o = NO) { return this._place(new THREE.Group(), x, y, z, o); }
  // ---- core ----
  _attrs(cls, o) {
    const t = cls === 'atlas' || cls === 'decal' ? (o.atlasTint ?? 0xffffff) : (o.tint ?? DEF_TINT[cls] ?? 0xffffff);
    return [((t >> 16) & 255) / 255, ((t >> 8) & 255) / 255, (t & 255) / 255, clamp(((o.rough ?? 1) - 0.25) / 1.5, 0, 1),
      o.chip ?? this.wear.chip, o.rust ?? this.wear.rust, (o.grime ?? 1) * this.wear.grime, (o.dust ?? 1) * this.wear.dust];
  }
  _bucket(target, key, cls) {
    let tb = this.buckets.get(target);
    if (!tb) this.buckets.set(target, (tb = new Map()));
    let b = tb.get(key);
    if (!b) tb.set(key, (b = { key, cls, geo: new Geo(), target }));
    return b;
  }
  put(slot, geo, x = 0, y = 0, z = 0, o = NO) {
    const target = o.to || this.tgt;
    const m = mat4(x, y, z, o.rot, o.s, o.q);
    if (target === this.tgt && this.stack.length) m.premultiply(this.cur);
    let key = slot, cls = slot;
    if (typeof slot === 'string' && slot[0] === '#') {
      const sw = this.A.swatch(slot);
      for (let i = 0; i < geo.uv.length; i += 2) { geo.uv[i] = sw.u; geo.uv[i + 1] = sw.v; }
      key = cls = 'atlas';
    } else if (slot && slot.isMaterial) cls = 'mat';
    if (o.uvs) geo.uvMap(o.uvs, o.uvs);
    if (PROF) {
      const st = new Error().stack.split('\n').slice(2, 7).map((l) => (l.match(/(\w+\.js):(\d+)/) || [])[0]).filter((x) => x && !x.startsWith('core.js'));
      const key = st.slice(0, 2).join(' < ');
      (this._prof = this._prof || {})[key] = (this._prof[key] || 0) + geo.idx.length / 3;
    }
    const uvOff = hasClass(cls) && o.uvOff !== false ? [this.rng.next() * 3.7, this.rng.next() * 3.7] : null;
    this._bucket(target, key, cls).geo.append(geo, m, uvOff, (o.edge ?? 1) * this.wear.edge, this._attrs(cls, o));
    return geo;
  }
  box(slot, w, h, d, x, y, z, o = NO) { const g = boxGeo(w, h, d, o); if (o.dent) dentGeo(g, o.dent, (this.rng.next() * 1000) | 0, o.dentFreq ?? 7); return this.put(slot, g, x, y, z, o); }
  cyl(slot, r, h, x, y, z, o = NO) { return this.put(slot, axisGeo(cylGeo(r, h, o), o.axis), x, y, z, o); }
  lathe(slot, pts, x, y, z, o = NO) { return this.put(slot, axisGeo(latheGeo(pts, o.seg ?? 24, o), o.axis), x, y, z, o); }
  sph(slot, r, x, y, z, o = NO) { return this.put(slot, axisGeo(sphereGeo(r, o), o.axis), x, y, z, o); }
  tor(slot, R, t, x, y, z, o = NO) {
    const g = torusGeo(R, t, o);
    if (o.axis === 'y') g.rotX(HP); else if (o.axis === 'x') g.rotY(HP);
    return this.put(slot, g, x, y, z, o);
  }
  tube(slot, pts, r, o = NO) {
    const path = o.round ? roundPath(pts, o.round, o.rseg ?? 4, o.closed) : pts;
    return this.put(slot, tubeGeo(path, r, o), 0, 0, 0, o);
  }
  ext(slot, shape, depth, x, y, z, o = NO) { return this.put(slot, extrudeGeo(shape, depth, o), x, y, z, o); }
  quad(slot, w, h, x, y, z, o = NO) { return this.put(slot, quadGeo(w, h, o.reg || null), x, y, z, o); }
  disc(slot, r, x, y, z, o = NO) { return this.put(slot, discGeo(r, o.seg ?? 24, o.reg || null), x, y, z, o); }
  geo(slot, g, x = 0, y = 0, z = 0, o = NO) { return this.put(slot, g, x, y, z, o); }
  // ---- prints ----
  // flat atlas quad facing +Z. o.decal: alpha-blended; o.own: separate mesh with a per-instance glow material
  label(reg, w, h, x, y, z, o = NO) {
    const g = quadGeo(w, h, reg, o.flipU);
    if (o.own) return this.mesh(atlasGlowMat(this.A.tex, o.glow ?? 0.4), g, x, y, z, { ...o, atlasUV: true, ao: false });
    return this.put(o.decal ? 'decal' : 'atlas', g, x, y, z, o);
  }
  decal(reg, w, h, x, y, z, o = NO) { return this.label(reg, w, h, x, y, z, { ...o, decal: true }); }
  dlabel(reg, r, x, y, z, o = NO) { return this.put(o.decal ? 'decal' : 'atlas', discGeo(r, o.seg ?? 28, reg), x, y, z, o); }
  // label wrapped on a cylinder (axis Y) of radius r centred at angle o.a (0 = +Z)
  clabel(reg, r, h, arc, x, y, z, o = NO) { return this.put(o.decal ? 'decal' : 'atlas', arcQuadGeo(r, h, arc, o.a ?? 0, reg, o.seg ?? 12), x, y, z, o); }
  labelBox(faces, w, h, d, x, y, z, o = NO) { return this.put(o.decal ? 'decal' : 'atlas', labelBoxGeo(faces, w, h, d), x, y, z, o); }
  // ---- separate meshes ----
  mesh(mat, geo, x = 0, y = 0, z = 0, o = NO) {
    const mesh = new THREE.Mesh(geo.isBufferGeometry ? geo : new THREE.BufferGeometry(), mat);
    this._place(mesh, x, y, z, o);
    if (!geo.isBufferGeometry) {
      const cls = mat.userData?.dvMode || 'mat';
      const G = new Geo();
      const uvOff = hasClass(cls) && o.uvOff !== false ? [this.rng.next() * 3.7, this.rng.next() * 3.7] : null;
      G.append(geo, null, uvOff, (o.edge ?? 1) * this.wear.edge, this._attrs(cls, o));
      this.singles.push({ mesh, geo: G, cls, ao: o.ao ?? cls !== 'mat', occ: o.occ ?? false, atlasUV: !!o.atlasUV });
    }
    const tr = mat.transparent || mat.userData?.noShadow;
    mesh.castShadow = o.shadow !== false && !tr;
    mesh.receiveShadow = !mat.transparent;
    if (tr || o.shadow === false) mesh.userData.noShadow = true;
    return mesh;
  }
  // N individually animated copies of one geometry drawn as ONE InstancedMesh. places: [[x,y,z,rot?]].
  // Returns the proxies (empty Object3Ds at each pivot) that stand in for the parts; sync.js mirrors
  // their rotation/visibility into the instance matrices every frame.
  instanced(name, mat, geo, places, o = NO) {
    const im = new THREE.InstancedMesh(new THREE.BufferGeometry(), mat, places.length);
    this._place(im, 0, 0, 0, { to: o.to });
    im.name = name;
    if (o.colors) places.forEach((_, i) => im.setColorAt(i, new THREE.Color(o.colors[i % o.colors.length])));
    im.updateMatrix();
    const inv = im.matrix.clone().invert();
    const proxies = places.map((pl, i) => {
      const p = this._place(new THREE.Object3D(), pl[0], pl[1], pl[2], { rot: pl[3], name: `${name}_${i}`, to: o.to });
      p.updateMatrix();
      im.setMatrixAt(i, _m.copy(inv).multiply(p.matrix));
      return p;
    });
    const cls = mat.userData?.dvMode || 'mat';
    const G = new Geo();
    const uvOff = hasClass(cls) && o.uvOff !== false ? [this.rng.next() * 3.7, this.rng.next() * 3.7] : null;
    G.append(geo, null, uvOff, (o.edge ?? 1) * this.wear.edge, this._attrs(cls, o));
    const xf = new THREE.Matrix4().copy(inv).multiply(proxies[0].matrix);
    this.singles.push({ mesh: im, geo: G, cls, ao: o.ao ?? false, occ: false, atlasUV: !!o.atlasUV, xf });
    im.castShadow = o.shadow === true;
    im.receiveShadow = true;
    if (!im.castShadow) im.userData.noShadow = true;
    linkInstanced(im, proxies);
    return proxies;
  }
  // LED groups the game drives one by one through parts[i].material.emissiveIntensity, drawn as ONE
  // vertex-coloured emissive mesh. groups: [{ geo: Geo, color: hex, intensity }]; returns the proxies
  // (Object3Ds carrying a plain material each, mirrored into the vertex colours every frame).
  glow(name, groups, o = NO) {
    const G = new Geo(), ranges = [];
    for (const gr of groups) { const s = G.count; G.append(gr.geo); ranges.push([s, G.count]); }
    const ref = o.ref ?? 2.2;
    const mesh = this.mesh(glowMat(ref), G, 0, 0, 0, { name, shadow: false, ao: false, to: o.to });
    const proxies = groups.map((gr, i) => {
      const p = this._place(new THREE.Object3D(), 0, 0, 0, { name: `${name}_${i}`, to: o.to });
      p.material = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: gr.color, emissiveIntensity: gr.intensity ?? ref });
      p.material.name = `${name}_${i}`;
      return p;
    });
    linkGlow(mesh, proxies, ranges, groups.map((gr) => new THREE.Color(gr.color).toArray()), ref);
    return proxies;
  }
  // N rigid sub-assemblies that the game animates one by one (e.g. a bank of locker doors), merged into
  // ONE skinned mesh per material: each part is weighted 100% to its own THREE.Bone, so rotating
  // parts[i] (the bone) moves it. places: [[x,y,z,rot?,name?]]; fn(i, bone) builds in the bone frame.
  bones(name, places, fn) {
    const holder = this.grp(0, 0, 0, { name: name + '_skin' });
    this.root.updateMatrixWorld(true);
    const inv = holder.matrixWorld.clone().invert();
    const counts = () => { const tb = this.buckets.get(holder); return new Map(tb ? [...tb].map(([key, b]) => [key, b.geo.count]) : []); };
    const bones = [], marks = [];
    places.forEach((pl, i) => {
      // pl[5]: optional parent (e.g. a static mount that orients the bone's hinge axis)
      const b = this._place(new THREE.Bone(), pl[0], pl[1], pl[2], { rot: pl[3], name: pl[4] || `${name}_${i}`, to: pl[5] });
      this.root.updateMatrixWorld(true);
      const before = counts();
      const save = [this.tgt, this.cur, this.stack];
      this.tgt = holder; this.cur = inv.clone().multiply(b.matrixWorld); this.stack = [new THREE.Matrix4()];
      try { fn(i, b); } finally { [this.tgt, this.cur, this.stack] = save; }
      marks.push([before, counts()]);
      bones.push(b);
    });
    this._skins.push({ holder, bones, marks });
    return bones;
  }
  // N toggleable groups merged into one mesh per material: fn(i, proxy) builds slot i in the proxy's
  // local frame. Hiding proxies[i] drops that slot's triangles from the merged index (sync.js).
  masked(name, places, fn) {
    const holder = this.grp(0, 0, 0, { name: name + '_merged' });
    holder.updateMatrix();
    const inv = holder.matrix.clone().invert();
    const lens = () => { const tb = this.buckets.get(holder); return new Map(tb ? [...tb].map(([key, b]) => [key, b.geo.idx.length]) : []); };
    const proxies = [], marks = [];
    places.forEach((pl, i) => {
      const p = this.grp(pl[0], pl[1], pl[2], { name: `${name}_${i}`, rot: pl[3] });
      p.updateMatrix();
      const before = lens();
      const save = [this.tgt, this.cur, this.stack];
      this.tgt = holder; this.cur = inv.clone().multiply(p.matrix); this.stack = [new THREE.Matrix4()];
      try { fn(i, p); } finally { [this.tgt, this.cur, this.stack] = save; }
      marks.push([before, lens()]);
      proxies.push(p);
    });
    this._masked.push({ holder, proxies, marks });
    return proxies;
  }
  // CRT / LCD / paper screen surface (CanvasTexture placeholder the game replaces); faces +Z, UVs 0..1
  screen(name, w, h, x, y, z, o = NO) {
    const style = o.style || 'crt';
    const aspect = o.aspect ?? w / h;
    const tex = placeholderTex(style, aspect, o.text ?? '');
    const m = new THREE.MeshStandardMaterial({
      color: o.color ?? (PRINTED.has(style) ? 0xffffff : 0x3a3a3a), map: tex, emissiveMap: tex, emissive: 0xffffff,
      emissiveIntensity: o.glow ?? SCREEN_GLOW[style] ?? 1.2, roughness: o.rough ?? 0.2, metalness: o.metal ?? 0,
    });
    m.name = 'screen_' + name;
    m.userData.unique = true;
    m.userData.noShadow = true;
    const g = o.disc ? new THREE.CircleGeometry(w / 2, 32) : crtGeo(w, h, o.bulge ?? 0);
    const mesh = new THREE.Mesh(g, m);
    this._place(mesh, x, y, z, { ...o, name: 'screen_' + name });
    mesh.castShadow = false;
    mesh.userData.noShadow = true;
    this.screens[name] = { mesh, aspect };
    return mesh;
  }
  collide(c) { this.colliders.push(c); return c; }
  // ---- finish ----
  _matFor(it) {
    if (it.key && it.key.isMaterial) return it.key;
    if (it.cls === 'atlas') return this.mats.atlas;
    if (it.cls === 'decal') return this.mats.decal;
    if (it.cls === 'glass') return CLEAR();
    return classMat(it.cls);
  }
  done(extra = {}) {
    const tb0 = performance.now();
    const vs = this.A ? this.A.finalize() : 1;
    const remapV = (geo) => { for (let i = 1; i < geo.uv.length; i += 2) geo.uv[i] = 1 - (1 - geo.uv[i]) * vs; };
    const all = [];
    for (const [target, tb] of this.buckets) {
      for (const b of tb.values()) {
        if (!b.geo.count) continue;
        if (vs !== 1 && (b.cls === 'atlas' || b.cls === 'decal')) remapV(b.geo);
        all.push({ geo: b.geo, cls: b.cls, key: b.key, target, single: null });
      }
    }
    for (const s of this.singles) {
      if (vs !== 1 && s.atlasUV) remapV(s.geo);
      all.push({ geo: s.geo, cls: s.cls, key: null, target: s.mesh, single: s });
    }
    // device-space copies (root at identity)
    this.root.updateMatrixWorld(true);
    const bb = new THREE.Box3();
    const nm = new THREE.Matrix3();
    const Mx = new THREE.Matrix4();
    for (const it of all) {
      Mx.copy(it.target.matrixWorld);
      if (it.single?.xf) Mx.multiply(it.single.xf);
      const M = Mx.elements;
      nm.getNormalMatrix(Mx);
      const N3 = nm.elements;
      const g = it.geo, n = g.count;
      const P = new Float32Array(n * 3), Nn = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const x = g.p[i * 3], y = g.p[i * 3 + 1], z = g.p[i * 3 + 2];
        P[i * 3] = M[0] * x + M[4] * y + M[8] * z + M[12]; P[i * 3 + 1] = M[1] * x + M[5] * y + M[9] * z + M[13]; P[i * 3 + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
        const a = g.n[i * 3], b = g.n[i * 3 + 1], c = g.n[i * 3 + 2];
        const nx = N3[0] * a + N3[3] * b + N3[6] * c, ny = N3[1] * a + N3[4] * b + N3[7] * c, nz = N3[2] * a + N3[5] * b + N3[8] * c;
        const l = Math.hypot(nx, ny, nz) || 1;
        Nn[i * 3] = nx / l; Nn[i * 3 + 1] = ny / l; Nn[i * 3 + 2] = nz / l;
        bb.expandByPoint(_p.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
      }
      it.P = P; it.N = Nn; it.idx = g.idx;
      const opaque = it.cls !== 'glass' && it.cls !== 'decal' && !(it.key && it.key.isMaterial && it.key.transparent);
      it.occ = it.single ? it.single.occ && opaque : opaque && it.cls !== 'mat';
      it.ao = (it.single ? it.single.ao : it.cls !== 'glass' && it.cls !== 'mat') && this.aoOpts.off !== true ? new Float32Array(n).fill(1) : null;
    }
    if (bb.isEmpty()) bb.set(V3(-0.1, 0, -0.1), V3(0.1, 0.2, 0.1));
    const ta = performance.now();
    if (this.aoOpts.off !== true && all.some((it) => it.ao)) bakeAO(all, bb, { ground: this.ground, ...this.aoOpts });
    const tb = performance.now();
    // grime + dust masks (device space)
    const floorY = bb.min.y, H = Math.max(0.1, bb.max.y - bb.min.y);
    let tris = 0, verts = 0, draws = 0;
    for (const it of all) {
      const g = it.geo, n = g.count;
      const grime = new Float32Array(n), up = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const ao = it.ao ? it.ao[i] : 1, ny = it.N[i * 3 + 1];
        const crev = smooth(0.94, 0.42, ao);
        const low = this.ground === 'floor' ? 1 - smooth(0, Math.min(0.2, H * 0.25), it.P[i * 3 + 1] - floorY) : 0;
        const under = ny < -0.6 ? 0.25 : 0;
        const ga = g.a.length ? g.a[i * 8 + 6] : this.wear.grime, da = g.a.length ? g.a[i * 8 + 7] : this.wear.dust;
        grime[i] = clamp((crev * 0.85 + low * 0.6 * (ny < 0.5 ? 1 : 0.45) + under) * ga * 2, 0, 1);
        up[i] = smooth(0.45, 0.93, ny) * clamp(da * 2, 0, 1);
      }
      const bg = toBuffer(g, it.ao, grime, up);
      tris += g.idx.length / 3; verts += n;
      (this._dbg = this._dbg || []).push(`${it.single ? 'S:' + (it.single.mesh.name || '?') : (it.target === this.root ? 'root' : it.target.name)}/${it.cls}:${g.idx.length / 3}`);
      if (it.single) {
        const sm = it.single.mesh;
        sm.geometry = bg;
        if (sm.isInstancedMesh) { sm.computeBoundingBox(); sm.computeBoundingSphere(); }
        draws++;
        continue;
      }
      const mat = this._matFor(it);
      const sk = this._skins.find((x) => x.holder === it.target);
      let mesh;
      if (sk) {
        const nv = bg.attributes.position.count;
        const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4);
        sk.marks.forEach(([a, b], bi) => { for (let v = a.get(it.key) ?? 0, e = b.get(it.key) ?? 0; v < e; v++) { si[v * 4] = bi; sw[v * 4] = 1; } });
        bg.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
        bg.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
        mesh = new THREE.SkinnedMesh(bg, mat);
      } else mesh = new THREE.Mesh(bg, mat);
      mesh.name = `${it.target === this.root ? this.name : it.target.name || 'part'}:${mat.name || it.cls}`;
      const tr = mat.transparent || SHADOWLESS.has(it.cls);
      mesh.castShadow = !tr && bg.boundingSphere.radius > 0.025;
      mesh.receiveShadow = !mat.transparent;
      if (!mesh.castShadow) mesh.userData.noShadow = true;
      if (it.cls === 'glass') mesh.renderOrder = 3;
      it.target.add(mesh);
      if (sk) {
        this.root.updateMatrixWorld(true);
        mesh.bind(new THREE.Skeleton(sk.bones));
        // doors swing out of the rest-pose bounds: pad the culling sphere
        mesh.boundingSphere = bg.boundingSphere.clone();
        mesh.boundingSphere.radius += 0.6;
        linkSkin(mesh, sk.bones);
      }
      const mk = this._masked.find((x) => x.holder === it.target);
      if (mk) linkMasked(mesh, mk.proxies, mk.marks.map(([a, b]) => [a.get(it.key) ?? 0, b.get(it.key) ?? 0]));
      draws++;
    }
    draws += Object.keys(this.screens).length;
    this.buckets.clear();
    this.singles = [];
    const prof = this._prof ? Object.entries(this._prof).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k2, v]) => `${v} ${k2}`) : undefined;
    const stats = { tris, verts, draws, buckets: this._dbg, prof, buildMs: +(performance.now() - this.t0).toFixed(1), aoMs: +(tb - ta).toFixed(1), packMs: +(performance.now() - tb0).toFixed(1), atlas: this.A ? `${this.A.W}x${this.A.H2}` : null };
    this.root.userData.stats = stats;
    return {
      object: this.root,
      colliders: this.colliders,
      anchors: this.anchors,
      parts: this.parts,
      screens: this.screens,
      params: this.params,
      ...extra,
    };
  }
}

function toBuffer(g, ao, grime, up) {
  const n = g.count;
  const bg = new THREE.BufferGeometry();
  const pos = new Float32Array(g.p), nor = new Float32Array(g.n), uv = new Float32Array(g.uv);
  const tint = new Uint8Array(n * 4), fx = new Uint8Array(n * 4), wr = new Uint8Array(n * 2);
  const A = g.a, hasA = A.length >= n * 8;
  for (let i = 0; i < n; i++) {
    if (hasA) {
      tint[i * 4] = Math.round(A[i * 8] * 255); tint[i * 4 + 1] = Math.round(A[i * 8 + 1] * 255); tint[i * 4 + 2] = Math.round(A[i * 8 + 2] * 255); tint[i * 4 + 3] = Math.round(A[i * 8 + 3] * 255);
      wr[i * 2] = Math.round(clamp(A[i * 8 + 4], 0, 1) * 255); wr[i * 2 + 1] = Math.round(clamp(A[i * 8 + 5], 0, 1) * 255);
    } else { tint[i * 4] = tint[i * 4 + 1] = tint[i * 4 + 2] = 255; tint[i * 4 + 3] = 128; }
    fx[i * 4] = Math.max(2, Math.round((ao ? ao[i] : 1) * 255)); // > 0: 0 marks 'attributes missing' in the shader
    fx[i * 4 + 1] = Math.round(clamp(g.e[i] || 0, 0, 1) * 255);
    fx[i * 4 + 2] = Math.round((grime ? grime[i] : 0) * 255);
    fx[i * 4 + 3] = Math.round((up ? up[i] : 0) * 255);
  }
  bg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  bg.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  bg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  bg.setAttribute('dTint', new THREE.BufferAttribute(tint, 4, true));
  bg.setAttribute('dFx', new THREE.BufferAttribute(fx, 4, true));
  bg.setAttribute('dWr', new THREE.BufferAttribute(wr, 2, true));
  bg.setIndex(n > 65535 ? new THREE.BufferAttribute(new Uint32Array(g.idx), 1) : new THREE.BufferAttribute(new Uint16Array(g.idx), 1));
  bg.computeBoundingSphere();
  bg.computeBoundingBox();
  bg.userData.shared = true;
  return bg;
}
