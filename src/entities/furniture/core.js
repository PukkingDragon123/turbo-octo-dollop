// Furniture model toolkit: indexed mesh data with meter-scale UVs, beveled primitives,
// upholstery cushions, swept tubes, a per-slot Builder, a voxel ambient-occlusion bake and
// the template registry / instancing used by models_furniture.js.
//
// Every vertex carries `furnFx` (RGBA8): R = baked AO, G = edge factor (1 on bevels, fading to 0
// a centimetre or two inwards — drives edge wear in the shader), B = grime (crevices / near the
// floor), A = spare. The material patch in mats.js turns those into worn edges, dirt and dust.
import * as THREE from 'three';
import { RNG, hashString } from '../../core/rng.js';
import { matFor, matsReady, cloneMat } from './mats.js';
import { palUV, rUV, atlasReady, regionKind } from './atlas.js';

export const PI = Math.PI, TAU = PI * 2, HP = PI / 2;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const toV = (p) => (p.isVector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2]));
const UP = new THREE.Vector3(0, 1, 0);
// quaternion rotating +Y onto direction d (optionally rolled about d)
export function qUp(d, roll = 0) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, toV(d).normalize());
  if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, roll));
  return q;
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Small deterministic 3D value noise (JS side, for cushion wrinkles / dents)
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

// numeric spatial key (0.25 mm grid), exact in a double for |coords| < 16 m
export const posKey = (x, y, z) => ((Math.round(x * 4000) + 65536) * 131072 + (Math.round(y * 4000) + 65536)) * 131072 + (Math.round(z * 4000) + 65536);

// ---------------------------------------------------------------------------
// Geo: growable indexed mesh data (position, normal, uv in meters, edge factor)
// ---------------------------------------------------------------------------
export class Geo {
  constructor() { this.p = []; this.n = []; this.uv = []; this.e = []; this.idx = []; }
  get count() { return this.p.length / 3; }
  v(x, y, z, nx, ny, nz, u, w, e = 0) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, w); this.e.push(e);
    return this.p.length / 3 - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  // append another geo (optionally transformed by matrix m; normal matrix nm)
  append(g, m = null, uvOff = null, eMul = 1) {
    const base = this.count;
    const P = g.p, N = g.n;
    if (m) {
      const e = m.elements;
      // normal matrix = inverse-transpose of the upper 3x3 (handles non-uniform scale)
      const nm = new THREE.Matrix3().getNormalMatrix(m).elements;
      for (let i = 0; i < P.length; i += 3) {
        const x = P[i], y = P[i + 1], z = P[i + 2];
        this.p.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
        const a = N[i], b = N[i + 1], c = N[i + 2];
        let nx = nm[0] * a + nm[3] * b + nm[6] * c, ny = nm[1] * a + nm[4] * b + nm[7] * c, nz = nm[2] * a + nm[5] * b + nm[8] * c;
        const l = Math.hypot(nx, ny, nz) || 1;
        this.n.push(nx / l, ny / l, nz / l);
      }
    } else {
      for (let i = 0; i < P.length; i++) { this.p.push(P[i]); this.n.push(N[i]); }
    }
    if (uvOff) for (let i = 0; i < g.uv.length; i += 2) this.uv.push(g.uv[i] + uvOff[0], g.uv[i + 1] + uvOff[1]);
    else for (let i = 0; i < g.uv.length; i++) this.uv.push(g.uv[i]);
    for (let i = 0; i < g.e.length; i++) this.e.push(g.e[i] * eMul);
    for (let i = 0; i < g.idx.length; i++) this.idx.push(g.idx[i] + base);
    return this;
  }
  flip() { for (let i = 0; i < this.idx.length; i += 3) { const t = this.idx[i + 1]; this.idx[i + 1] = this.idx[i + 2]; this.idx[i + 2] = t; } for (let i = 0; i < this.n.length; i++) this.n[i] = -this.n[i]; return this; }
  // uniform UV transform (scale, then swap, then offset)
  uvMap(su, sv, swap = false, ou = 0, ov = 0) {
    for (let i = 0; i < this.uv.length; i += 2) {
      let u = this.uv[i] * su, w = this.uv[i + 1] * sv;
      if (swap) { const t = u; u = w; w = t; }
      this.uv[i] = u + ou; this.uv[i + 1] = w + ov;
    }
    return this;
  }
  setEdge(v) { for (let i = 0; i < this.e.length; i++) this.e[i] = v; return this; }
  // scale the two axes orthogonal to `axis` by lerp(s0, s1, t), t along axis from a0 to a1
  taper(axis, a0, a1, s0, s1) {
    const o1 = (axis + 1) % 3, o2 = (axis + 2) % 3;
    for (let i = 0; i < this.count; i++) {
      const t = clamp((this.p[i * 3 + axis] - a0) / (a1 - a0), 0, 1), k = lerp(s0, s1, t);
      this.p[i * 3 + o1] *= k; this.p[i * 3 + o2] *= k;
    }
    return this;
  }
  // bend: offset coordinate `axis` by k * (coordinate along `along`)^2
  bend(axis, along, k) {
    for (let i = 0; i < this.count; i++) { const a = this.p[i * 3 + along]; this.p[i * 3 + axis] += k * a * a; }
    return this.computeNormals(false);
  }
  translate(x, y, z) { for (let i = 0; i < this.p.length; i += 3) { this.p[i] += x; this.p[i + 1] += y; this.p[i + 2] += z; } return this; }
  // per-vertex position deform fn(p:Vector3, n:Vector3, i) -> mutates p
  deform(fn, renormal = true) {
    const p = V(), n = V();
    for (let i = 0; i < this.count; i++) {
      p.set(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]);
      n.set(this.n[i * 3], this.n[i * 3 + 1], this.n[i * 3 + 2]);
      fn(p, n, i);
      this.p[i * 3] = p.x; this.p[i * 3 + 1] = p.y; this.p[i * 3 + 2] = p.z;
    }
    if (renormal) this.computeNormals(true);
    return this;
  }
  // smooth normals from faces; weld=true averages across coincident vertices (UV seams)
  computeNormals(weld = true) {
    const n = this.count, acc = new Float32Array(n * 3), P = this.p, I = this.idx;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const k of [a, b, c]) { acc[k] += nx; acc[k + 1] += ny; acc[k + 2] += nz; }
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
      const x = acc[i * 3], y = acc[i * 3 + 1], z = acc[i * 3 + 2], l = Math.hypot(x, y, z) || 1;
      this.n[i * 3] = x / l; this.n[i * 3 + 1] = y / l; this.n[i * 3 + 2] = z / l;
    }
    return this;
  }
  bounds() {
    const b = new THREE.Box3();
    for (let i = 0; i < this.p.length; i += 3) b.expandByPoint(_p.set(this.p[i], this.p[i + 1], this.p[i + 2]));
    return b;
  }
}

// THREE.BufferGeometry -> Geo (keeps uv if present, scaled by uvScale)
export function fromBuffer(bg, uvScale = 1, edge = 0) {
  const g = new Geo();
  const P = bg.attributes.position, N = bg.attributes.normal, U = bg.attributes.uv;
  if (!N) bg.computeVertexNormals();
  const NN = bg.attributes.normal;
  for (let i = 0; i < P.count; i++) g.v(P.getX(i), P.getY(i), P.getZ(i), NN.getX(i), NN.getY(i), NN.getZ(i), U ? U.getX(i) * uvScale : 0, U ? U.getY(i) * uvScale : 0, edge);
  if (bg.index) for (let i = 0; i < bg.index.count; i++) g.idx.push(bg.index.getX(i));
  else for (let i = 0; i < P.count; i++) g.idx.push(i);
  return g;
}

// ---------------------------------------------------------------------------
// Primitive generators (all return Geo in local space, UVs in meters)
// ---------------------------------------------------------------------------
const FACES = [
  // normal axis, sign, u axis/sign, v axis/sign  (u x v = n)
  { n: 0, s: 1, u: 2, us: -1, v: 1, vs: 1 },
  { n: 0, s: -1, u: 2, us: 1, v: 1, vs: 1 },
  { n: 1, s: 1, u: 0, us: 1, v: 2, vs: -1 },
  { n: 1, s: -1, u: 0, us: 1, v: 2, vs: 1 },
  { n: 2, s: 1, u: 0, us: 1, v: 1, vs: 1 },
  { n: 2, s: -1, u: 0, us: -1, v: 1, vs: 1 },
];
const AX = ['x', 'y', 'z'];

// one in-plane axis of a rounded-box face: list of {c (coordinate of the inner point), t (tan), e}
function axisEntries(H, r, s, wear) {
  const out = [];
  const inner = Math.max(0, H - r);
  if (r > 1e-5) for (let k = s; k >= 1; k--) out.push({ c: -inner, t: -Math.tan((PI / 4) * (k / s)), e: k / s });
  // wear-falloff ring only on faces long enough for it to read (keeps tiny parts light)
  const ws = wear > 0 && H > 0.025 && inner - wear > inner * 0.25 ? wear : 0;
  out.push({ c: -inner, t: 0, e: r > 1e-5 ? (ws ? 0.42 : 0) : (ws ? 0.75 : 0) });
  if (ws) { out.push({ c: -inner + ws, t: 0, e: 0 }); out.push({ c: inner - ws, t: 0, e: 0 }); }
  out.push({ c: inner, t: 0, e: r > 1e-5 ? (ws ? 0.42 : 0) : (ws ? 0.75 : 0) });
  if (r > 1e-5) for (let k = 1; k <= s; k++) out.push({ c: inner, t: Math.tan((PI / 4) * (k / s)), e: k / s });
  return out;
}

// Rounded / beveled box. o: { r (bevel radius), seg (1-3), wear (edge-wear falloff width, m),
//   grain ('x'|'y'|'z': texture U follows that axis), faces (bitmask to skip faces: {nx,px,ny,py,nz,pz}:false) }
export function boxGeo(w, h, d, o = {}) {
  const half = [w / 2, h / 2, d / 2];
  const r = Math.min(o.r ?? 0.002, half[0] - 1e-4, half[1] - 1e-4, half[2] - 1e-4);
  const s = r < 0.005 ? 1 : (o.seg ?? (r > 0.006 ? 2 : 1)); // a 1-step smooth-shaded bevel suffices below 5 mm
  const wear = o.wear ?? Math.min(0.012, Math.min(w, h, d) * 0.3);
  const grain = o.grain !== undefined ? AX.indexOf(o.grain) : -1;
  const skip = o.skip || null;
  const g = new Geo();
  const P = [0, 0, 0], N = [0, 0, 0];
  for (const F of FACES) {
    if (skip && skip[(F.s > 0 ? 'p' : 'n') + AX[F.n]]) continue;
    const eu = axisEntries(half[F.u], r, s, wear), ev = axisEntries(half[F.v], r, s, wear);
    const base = g.count;
    const nInner = half[F.n] - r;
    for (let j = 0; j < ev.length; j++) {
      for (let i = 0; i < eu.length; i++) {
        const A = eu[i], B = ev[j];
        // face frame: u axis coordinate = us*(A.c + r*t/len)
        const tu = A.t, tv = B.t, len = Math.hypot(tu, tv, 1);
        N[F.u] = (F.us * tu) / len; N[F.v] = (F.vs * tv) / len; N[F.n] = F.s / len;
        P[F.u] = F.us * A.c + r * N[F.u];
        P[F.v] = F.vs * B.c + r * N[F.v];
        P[F.n] = F.s * nInner + r * N[F.n];
        // UVs: projection on the face's in-plane axes (meters); grain axis -> texture U
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

// Lathe around Y. pts: [[r, y, flags?, edge?], ...] bottom -> top for an outward-facing surface.
// flags: 1 = hard crease, 2 = edge (wear). UVs: near-horizontal profile segments (discs, caps) get
// planar (x,z) UVs, the rest cylindrical (arc * local radius, profile length); o.uv = 'cyl' forces
// cylindrical everywhere. o.swap swaps U/V (wood grain along the profile).
export function latheGeo(pts, segs = 24, o = {}) {
  const phi0 = o.phi0 ?? 0, phiLen = o.phiLen ?? TAU;
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

// cylinder (axis Y, centred) with optional bevelled cap edges; o: {rt, rb, bevel, seg, caps, open}
export function cylGeo(r, h, o = {}) {
  const rt = o.rt ?? r, rb = o.rb ?? r, bv = Math.min(o.bevel ?? 0, rt * 0.45, rb * 0.45, h * 0.45);
  const y0 = -h / 2, y1 = h / 2;
  const pts = [];
  const caps = (o.caps ?? true) && !o.open;
  if (caps) pts.push([0, y0, 0]);
  if (bv > 0) {
    if (caps) pts.push([rb - bv, y0, 2]);
    for (let k = 1; k < 3; k++) { const a = (k / 3) * HP; pts.push([rb - bv + Math.sin(a) * bv, y0 + bv - Math.cos(a) * bv, 2]); }
    pts.push([rb, y0 + bv, 0, 0.5]);
    pts.push([rt, y1 - bv, 0, 0.5]);
    for (let k = 1; k < 3; k++) { const a = (k / 3) * HP; pts.push([rt - bv + Math.cos(a) * bv, y1 - bv + Math.sin(a) * bv, 2]); }
    if (caps) pts.push([rt - bv, y1, 2]);
  } else {
    pts.push([rb, y0, caps ? 1 | 2 : 2]);
    pts.push([rt, y1, caps ? 1 | 2 : 2]);
  }
  if (caps) pts.push([0, y1, 0]);
  return latheGeo(pts, o.seg ?? 16, o);
}

// UV sphere (meters UV), o: {ws, hs, phiLen, thetaLen}
export function sphereGeo(r, o = {}) {
  const ws = o.ws ?? 16, hs = o.hs ?? 10;
  const g = new Geo();
  for (let j = 0; j <= hs; j++) {
    const th = (j / hs) * (o.thetaLen ?? PI) + (o.theta0 ?? 0), st = Math.sin(th), ct = Math.cos(th);
    for (let i = 0; i <= ws; i++) {
      const ph = (i / ws) * (o.phiLen ?? TAU), sp = Math.sin(ph), cp = Math.cos(ph);
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
      out.push(V().addScaledVector(s0, (1 - u) * (1 - u)).addScaledVector(p, 2 * u * (1 - u)).addScaledVector(e0, u * u));
    }
  }
  if (!closed) out.push(P[n - 1]);
  return out;
}

// Swept tube with rotation-minimising frames. radius: number | [rn, rb] | fn(t, i) -> number|[rn,rb]
// o: { radial, closed, caps: true|'round'|false, twist }
export function tubeGeo(pts, radius, o = {}) {
  const P = pts.map(toV), n = P.length, closed = !!o.closed;
  const radial = o.radial ?? 8;
  const T = [];
  for (let i = 0; i < n; i++) {
    let t;
    if (closed) t = P[(i + 1) % n].clone().sub(P[(i - 1 + n) % n]);
    else if (i === 0) t = P[1].clone().sub(P[0]);
    else if (i === n - 1) t = P[n - 1].clone().sub(P[n - 2]);
    else t = P[i + 1].clone().sub(P[i]).normalize().add(P[i].clone().sub(P[i - 1]).normalize());
    if (t.lengthSq() < 1e-14) t = i > 0 ? T[i - 1].clone() : V(0, 1, 0);
    T.push(t.normalize());
  }
  const Nn = [], B = [];
  const ref = o.up ? toV(o.up) : Math.abs(T[0].y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0);
  Nn[0] = ref.clone().sub(T[0].clone().multiplyScalar(ref.dot(T[0]))).normalize();
  B[0] = V().crossVectors(T[0], Nn[0]);
  const q = new THREE.Quaternion();
  for (let i = 1; i < n; i++) {
    q.setFromUnitVectors(T[i - 1], T[i]);
    Nn[i] = Nn[i - 1].clone().applyQuaternion(q);
    Nn[i].sub(T[i].clone().multiplyScalar(Nn[i].dot(T[i]))).normalize();
    B[i] = V().crossVectors(T[i], Nn[i]);
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
      g.v(x, y, z, nx / l, ny / l, nz / l, s, (j / radial) * TAU * rRef, 0);
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
        // hemispherical end
        const rows = 3, start = g.count;
        for (let k = 1; k <= rows; k++) {
          const th = (k / rows) * HP, ct = Math.cos(th), st = Math.sin(th);
          for (let j = 0; j <= radial; j++) {
            const a = (j / radial) * TAU, ca = Math.cos(a), sa = Math.sin(a);
            const nx = (Nn[i].x * ca + B[i].x * sa) * ct + T[i].x * sgn * st, ny = (Nn[i].y * ca + B[i].y * sa) * ct + T[i].y * sgn * st, nz = (Nn[i].z * ca + B[i].z * sa) * ct + T[i].z * sgn * st;
            g.v(P[i].x + (Nn[i].x * ca * rn + B[i].x * sa * rb) * ct + T[i].x * sgn * st * Math.min(rn, rb), P[i].y + (Nn[i].y * ca * rn + B[i].y * sa * rb) * ct + T[i].y * sgn * st * Math.min(rn, rb), P[i].z + (Nn[i].z * ca * rn + B[i].z * sa * rb) * ct + T[i].z * sgn * st * Math.min(rn, rb), nx, ny, nz, s + sgn * (k / rows) * rn, (j / radial) * TAU * rRef, 0);
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
        const ci = g.v(P[i].x, P[i].y, P[i].z, T[i].x * sgn, T[i].y * sgn, T[i].z * sgn, 0, 0, 0.6);
        const start = g.count;
        for (let j = 0; j <= radial; j++) {
          const a = (j / radial) * TAU, ca = Math.cos(a), sa = Math.sin(a);
          g.v(P[i].x + Nn[i].x * ca * rn + B[i].x * sa * rb, P[i].y + Nn[i].y * ca * rn + B[i].y * sa * rb, P[i].z + Nn[i].z * ca * rn + B[i].z * sa * rb, T[i].x * sgn, T[i].y * sgn, T[i].z * sgn, ca * rn, sa * rb, 1);
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

// Extrusion of a THREE.Shape along Z (centred on z), smoothed normals with crease angle.
export function extrudeGeo(shape, depth, o = {}) {
  const bv = o.bevel ?? 0;
  const bg = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bv > 0, bevelThickness: bv, bevelSize: bv, bevelSegments: o.bevelSeg ?? 2, curveSegments: o.curveSeg ?? 10, steps: o.steps ?? 1 });
  bg.translate(0, 0, -depth / 2);
  const g = fromBuffer(bg, 1);
  bg.dispose();
  // creased smooth normals: weld by position, but only average normals within the crease angle
  creaseNormals(g, o.crease ?? 0.7);
  for (let i = 0; i < g.count; i++) {
    const nz = Math.abs(g.n[i * 3 + 2]);
    g.e[i] = bv > 0 ? clamp((1 - nz) * nz * 4.2, 0, 1) : 0;
  }
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

// Flat quad facing +Z (w x h), uv = region rect or meters
export function quadGeo(w, h, uvRect = null) {
  const g = new Geo();
  const x = w / 2, y = h / 2;
  const U = (u, v) => (uvRect ? [lerp(uvRect.u0, uvRect.u1, u), lerp(uvRect.v0, uvRect.v1, v)] : [(u - 0.5) * w, (v - 0.5) * h]);
  const a = g.v(-x, -y, 0, 0, 0, 1, ...U(0, 0)), b = g.v(x, -y, 0, 0, 0, 1, ...U(1, 0)), c = g.v(x, y, 0, 0, 0, 1, ...U(1, 1)), d = g.v(-x, y, 0, 0, 0, 1, ...U(0, 1));
  g.quad(a, b, c, d);
  return g;
}

// Subdivided plane in XZ facing +Y, for sheets / blankets (uv meters)
export function gridGeo(w, d, nx, nz) {
  const g = new Geo();
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = (i / nx - 0.5) * w, z = (j / nz - 0.5) * d;
    g.v(x, 0, z, 0, 1, 0, x, -z, 0);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + nx + 1;
    g.quad(a, b, b + 1, a + 1);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Upholstered cushion: a rounded box from 6 face grids (panel seams at the face borders),
// deformed by crown / sag / bulge / wrinkles / tufting. Returns { geo, seams:{top,bottom} }
// o: { r, cell, crown, bulge, sag:{x,z,rx,rz,d}, wrinkle, wrinkleFreq, seed, buttons:[[x,z],...]
//      buttonDepth, buttonR, sideWrinkle, frontRoll, topOnly }
// ---------------------------------------------------------------------------
export function cushionGeo(w, h, d, o = {}) {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const r = Math.min(o.r ?? h * 0.35, hx * 0.9, hy * 0.98, hz * 0.9);
  const cell = o.cell ?? 0.035;
  const seed = o.seed ?? 1;
  const g = new Geo();
  const half = [hx, hy, hz];
  const inner = [hx - r, hy - r, hz - r];
  const seamTop = [], seamBot = [];
  // per face grids
  const faceInfo = [];
  for (let fi = 0; fi < 6; fi++) {
    const F = FACES[fi];
    const nu = Math.max(3, Math.ceil((2 * half[F.u]) / cell)), nv = Math.max(3, Math.ceil((2 * half[F.v]) / cell));
    const base = g.count;
    const P = [0, 0, 0];
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        // point on the outer box face, denser near edges (cosine spacing) for the rounded part
        const su = Math.sin((i / nu - 0.5) * PI) * 0.5 + 0.5, sv = Math.sin((j / nv - 0.5) * PI) * 0.5 + 0.5;
        const fu = lerp(i / nu, su, 0.55), fv = lerp(j / nv, sv, 0.55);
        P[F.u] = F.us * (fu * 2 - 1) * half[F.u];
        P[F.v] = F.vs * (fv * 2 - 1) * half[F.v];
        P[F.n] = F.s * half[F.n];
        const cx = clamp(P[0], -inner[0], inner[0]), cy = clamp(P[1], -inner[1], inner[1]), cz = clamp(P[2], -inner[2], inner[2]);
        let nx = P[0] - cx, ny = P[1] - cy, nz = P[2] - cz;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        const x = cx + nx * r, y = cy + ny * r, z = cz + nz * r;
        let uu = P[F.u] * F.us, vv = P[F.v] * F.vs;
        g.v(x, y, z, nx, ny, nz, uu, vv, 0);
      }
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i;
      g.quad(a, a + 1, a + nu + 2, a + nu + 1);
    }
    faceInfo.push({ base, nu, nv, F });
  }
  // seam loops: border rows of the top / bottom face (they sit on the 45 degree line)
  const loopOf = (fi) => {
    const { base, nu, nv } = faceInfo[fi];
    const ids = [];
    for (let i = 0; i < nu; i++) ids.push(base + i);
    for (let j = 0; j < nv; j++) ids.push(base + j * (nu + 1) + nu);
    for (let i = nu; i > 0; i--) ids.push(base + nv * (nu + 1) + i);
    for (let j = nv; j > 0; j--) ids.push(base + j * (nu + 1));
    return ids;
  };
  const topIds = loopOf(2), botIds = loopOf(3);
  // --- deformation ---
  const crown = o.crown ?? 0.15 * h, bulge = o.bulge ?? 0.06 * h, wr = o.wrinkle ?? 0.004, wf = o.wrinkleFreq ?? 9;
  const sag = o.sag;
  const btn = o.buttons || [];
  const bD = o.buttonDepth ?? h * 0.25, bR = o.buttonR ?? 0.06;
  const p = V(), n = V();
  for (let i = 0; i < g.count; i++) {
    p.set(g.p[i * 3], g.p[i * 3 + 1], g.p[i * 3 + 2]);
    n.set(g.n[i * 3], g.n[i * 3 + 1], g.n[i * 3 + 2]);
    const ux = clamp(p.x / hx, -1, 1), uz = clamp(p.z / hz, -1, 1), uy = clamp(p.y / hy, -1, 1);
    const top = smooth(-0.2, 0.9, uy);
    // crown: domed top & bottom panels
    const dome = (1 - ux * ux) * (1 - uz * uz);
    p.y += crown * dome * Math.sign(uy) * Math.abs(uy) ** 0.5 * (o.topOnly && uy < 0 ? 0 : 1);
    // bulge: sides puff out at mid height
    const side = 1 - Math.abs(n.y);
    const bulgeAmt = bulge * side * (1 - uy * uy);
    p.x += n.x * bulgeAmt; p.z += n.z * bulgeAmt;
    // sag: seat depression
    if (sag) {
      const dx = (p.x - sag.x) / sag.rx, dz = (p.z - sag.z) / sag.rz;
      const k = Math.exp(-(dx * dx + dz * dz));
      p.y -= sag.d * k * top;
    }
    // tufting buttons on the top panel
    for (const [bx, bz] of btn) {
      const dd = Math.hypot(p.x - bx, p.z - bz);
      if (dd < bR) { const k = 1 - dd / bR; p.y -= bD * k * k * top; }
    }
    // wrinkles: low-frequency folds + crumple, stronger on the boxing strip and near the front
    if (wr > 0) {
      const f1 = fbm3(p.x * wf, p.y * wf * 1.6, p.z * wf, seed, 3) - 0.5;
      const f2 = noise3(p.x * wf * 3.1 + 7, p.y * wf * 2.3, p.z * wf * 3.1, seed + 3) - 0.5;
      const fold = Math.abs(Math.sin((p.x * 1.0 + f1 * 0.35) * wf * 2.2 + seed)) - 0.6;
      const amt = wr * (0.6 + side * 0.8 + (o.frontRoll && p.z > hz * 0.6 ? 0.8 : 0));
      const disp = amt * (f1 * 1.2 + f2 * 0.5 + (o.sideWrinkle ? fold * side * 0.8 : 0));
      p.addScaledVector(n, disp);
    }
    if (o.flatBottom && p.y < -hy) p.y = -hy;
    g.p[i * 3] = p.x; g.p[i * 3 + 1] = p.y; g.p[i * 3 + 2] = p.z;
  }
  g.computeNormals(true);
  // edge factor along seams (piping wears first)
  for (const id of topIds) g.e[id] = o.seamEdge ?? 0.5;
  for (const id of botIds) g.e[id] = o.seamEdge ?? 0.5;
  const pt = (id) => V(g.p[id * 3], g.p[id * 3 + 1], g.p[id * 3 + 2]);
  const nr = (id) => V(g.n[id * 3], g.n[id * 3 + 1], g.n[id * 3 + 2]);
  for (const id of topIds) seamTop.push({ p: pt(id), n: nr(id) });
  for (const id of botIds) seamBot.push({ p: pt(id), n: nr(id) });
  return { geo: g, seams: { top: seamTop, bottom: seamBot }, r };
}

// ---------------------------------------------------------------------------
// Builder: collects transformed primitives per material slot
// ---------------------------------------------------------------------------
const isAtlasSlot = (slot) => slot[0] === '#' || slot === 'atlas' || slot === 'decal' || slot === 'glow' || slot === 'atlas_gloss' || slot === 'atlas_metal';
// legacy atlas slots -> surface kinds of the single 'atlas' material
const KIND_SLOT = { atlas_gloss: 'g', atlas_metal: 'm', glow: 'e' };
// label region drawn through slot: gloss / metal / glow regions are marked in the surface map
function labelSlot(name, slot) {
  const k = KIND_SLOT[slot];
  if (k === undefined) return slot;
  regionKind(name, k);
  return 'atlas';
}

function matrixOf(x = 0, y = 0, z = 0, rot = null, scale = null, quat = null) {
  if (quat) _q.copy(quat);
  else { if (rot) _e.set(rot[0] || 0, rot[1] || 0, rot[2] || 0, rot[3] || 'XYZ'); else _e.set(0, 0, 0); _q.setFromEuler(_e); }
  _s.set(1, 1, 1);
  if (scale) { if (typeof scale === 'number') _s.setScalar(scale); else _s.set(scale[0], scale[1], scale[2]); }
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s);
}

export class Builder {
  constructor(rng, pivot = null) {
    this.rng = rng;
    this.slots = new Map(); // slot -> Geo
    this.namedList = [];
    this.parts = [];
    this.pivot = pivot;
    this.noAO = new Set();
  }
  _slot(slot) {
    let g = this.slots.get(slot);
    if (!g) this.slots.set(slot, (g = new Geo()));
    return g;
  }
  // append a local Geo with transform. o: {rot:[rx,ry,rz], scale, uv:'keep'|'pal', uvOff:false, edge:mul}
  put(slot, geo, x = 0, y = 0, z = 0, o = {}) {
    let target = slot;
    let uvOff = null;
    if (slot[0] === '#') {
      // palette colour: collapse UVs to one texel of the atlas (shares the atlas draw call; the
      // gloss / metal / glow kinds live in the atlas surface map, so they share it too)
      palCollapse(geo, slot);
      target = 'atlas';
    } else if (KIND_SLOT[slot] !== undefined) {
      throw new Error(`[furniture] slot ${slot}: use a '#hex:${KIND_SLOT[slot]}' palette colour or a decal with that slot`);
    } else if (!isAtlasSlot(slot) && o.uvOff !== false) {
      uvOff = [this.rng.next() * 3.7, this.rng.next() * 3.7];
    }
    const m = (x || y || z || o.rot || o.scale || o.quat) ? matrixOf(x, y, z, o.rot, o.scale, o.quat) : null;
    this._slot(target).append(geo, m, uvOff, o.edge ?? 1);
    return this;
  }
  box(slot, w, h, d, x, y, z, o = {}) { return this.put(slot, boxGeo(w, h, d, o), x, y, z, o); }
  // cylinder; o.axis 'x'|'y'|'z' (default y)
  cyl(slot, r, h, x, y, z, o = {}) {
    const g = cylGeo(r, h, o);
    const rot = o.rot || (o.axis === 'x' ? [0, 0, HP] : o.axis === 'z' ? [HP, 0, 0] : null);
    return this.put(slot, g, x, y, z, { ...o, rot });
  }
  lathe(slot, pts, x, y, z, o = {}) { return this.put(slot, latheGeo(pts, o.seg ?? 24, o), x, y, z, o); }
  sphere(slot, r, x, y, z, o = {}) { return this.put(slot, sphereGeo(r, o), x, y, z, o); }
  tube(slot, pts, r, o = {}) {
    const path = o.round ? roundPath(pts, o.round, o.rseg ?? 4, o.closed) : pts;
    return this.put(slot, tubeGeo(path, r, o), 0, 0, 0, o);
  }
  ext(slot, shape, depth, x, y, z, o = {}) { return this.put(slot, extrudeGeo(shape, depth, o), x, y, z, o); }
  geo(slot, g, x, y, z, o = {}) { return this.put(slot, g, x, y, z, o); }
  // box spanning two points (Y axis along a->b); o.roll rotates about the axis
  boxBetween(slot, a, c, w, d, o = {}) {
    const A = toV(a), C = toV(c);
    const L = A.distanceTo(C);
    const g = boxGeo(w, L, d, { ...o, grain: o.grain ?? 'y' });
    const q = new THREE.Quaternion().setFromUnitVectors(UP, C.clone().sub(A).normalize());
    if (o.roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, o.roll));
    const m = new THREE.Matrix4().compose(A.clone().add(C).multiplyScalar(0.5), q, _s.set(1, 1, 1));
    this._slot(slot[0] === '#' ? (palCollapse(g, slot), atlasTarget(slot)) : slot).append(g, m, slot[0] === '#' ? null : [this.rng.next() * 3, this.rng.next() * 3]);
    return this;
  }
  cylBetween(slot, a, c, r1, r2 = r1, o = {}) {
    const A = toV(a), C = toV(c);
    const L = A.distanceTo(C);
    const g = cylGeo(r1, L, { ...o, rb: r1, rt: r2 });
    const q = new THREE.Quaternion().setFromUnitVectors(UP, C.clone().sub(A).normalize());
    const m = new THREE.Matrix4().compose(A.clone().add(C).multiplyScalar(0.5), q, _s.set(1, 1, 1));
    this._slot(slot[0] === '#' ? (palCollapse(g, slot), atlasTarget(slot)) : slot).append(g, m, slot[0] === '#' ? null : [this.rng.next() * 3, this.rng.next() * 3]);
    return this;
  }
  // atlas decal quad facing +Z before rotation. o: {rot, slot:'decal'|'atlas'|'glow', cell, cols, rows, curve}
  decal(name, w, h, x, y, z, o = {}) {
    const g = quadGeo(w, h, o.cell !== undefined ? rUV(name, o.cell, o.cols, o.rows) : rUV(name));
    g.setEdge(0);
    const m = matrixOf(x, y, z, o.rot);
    this._slot(labelSlot(name, o.slot || 'decal')).append(g, m);
    return this;
  }
  // decal wrapped around a cylinder (axis Y) centred at angle theta (0 = +Z)
  cylDecal(name, r, h, theta, arc, x, y, z, o = {}) {
    const seg = Math.max(4, Math.ceil(arc / 0.12));
    const R = o.cell !== undefined ? rUV(name, o.cell, o.cols, o.rows) : rUV(name);
    const g = new Geo();
    const rb = o.rb ?? r;
    for (let j = 0; j <= 1; j++) for (let i = 0; i <= seg; i++) {
      const a = theta - arc / 2 + (i / seg) * arc, rr = j ? r : rb;
      g.v(Math.sin(a) * rr, (j - 0.5) * h, Math.cos(a) * rr, Math.sin(a), 0, Math.cos(a), lerp(R.u0, R.u1, i / seg), lerp(R.v0, R.v1, j), 0);
    }
    for (let i = 0; i < seg; i++) g.quad(i, i + 1, i + seg + 2, i + seg + 1);
    this._slot(labelSlot(name, o.slot || 'decal')).append(g, matrixOf(x, y, z, o.rot));
    return this;
  }
  // ribbon of atlas quads along a path (stitching, tape, piping prints). pts: [{p, n}] or Vector3[] + normal fn
  ribbon(name, pts, width, tileLen, o = {}) {
    const R = rUV(name);
    const g = new Geo();
    const P = pts.map((q) => (q.p ? q.p : toV(q)));
    const Nr = pts.map((q, i) => (q.n ? q.n : o.normal ? toV(o.normal) : V(0, 1, 0)));
    let s = 0;
    const n = P.length + (o.closed ? 1 : 0);
    let prevIdx = null;
    for (let k = 0; k < n; k++) {
      const i = k % P.length;
      if (k > 0) s += P[i].distanceTo(P[(k - 1) % P.length]);
      const t = (o.closed || i < P.length - 1) ? P[(i + 1) % P.length].clone().sub(P[i]) : P[i].clone().sub(P[i - 1]);
      t.normalize();
      const side = V().crossVectors(Nr[i], t).normalize().multiplyScalar(width / 2);
      const off = Nr[i].clone().multiplyScalar(o.lift ?? 0.0008);
      const u = s / tileLen;
      const a = g.v(P[i].x - side.x + off.x, P[i].y - side.y + off.y, P[i].z - side.z + off.z, Nr[i].x, Nr[i].y, Nr[i].z, 0, 0, 0);
      const b = g.v(P[i].x + side.x + off.x, P[i].y + side.y + off.y, P[i].z + side.z + off.z, Nr[i].x, Nr[i].y, Nr[i].z, 0, 0, 0);
      g.uv[a * 2] = u; g.uv[a * 2 + 1] = 0; g.uv[b * 2] = u; g.uv[b * 2 + 1] = 1;
      if (prevIdx) g.quad(prevIdx[0], a, b, prevIdx[1]);
      prevIdx = [a, b];
    }
    // remap u: each tile repeats the atlas region -> split quads at integer u by duplicating
    const out = new Geo();
    for (let t = 0; t < g.idx.length; t += 6) {
      const ia = g.idx[t], ib = g.idx[t + 1], ic = g.idx[t + 2], id = g.idx[t + 5];
      // quad corners: prev-left(ia), cur-left(ib), cur-right(ic), prev-right(id)
      const u0 = g.uv[ia * 2], u1 = g.uv[ib * 2];
      const steps = Math.max(1, Math.ceil(u1 - Math.floor(u0) - 1e-6));
      for (let k = 0; k < steps; k++) {
        const ua = Math.max(u0, Math.floor(u0) + k), ub = Math.min(u1, Math.floor(u0) + k + 1);
        if (ub - ua < 1e-6) continue;
        const ta = (ua - u0) / (u1 - u0 || 1), tb = (ub - u0) / (u1 - u0 || 1);
        const fr = (x) => x - Math.floor(ua);
        const L = (i0, i1, tt) => [0, 1, 2].map((c) => lerp(g.p[i0 * 3 + c], g.p[i1 * 3 + c], tt));
        const NN = (i0) => [g.n[i0 * 3], g.n[i0 * 3 + 1], g.n[i0 * 3 + 2]];
        const pa = L(ia, ib, ta), pb = L(ia, ib, tb), pc = L(id, ic, tb), pd = L(id, ic, ta);
        const nn = NN(ib);
        const uA = lerp(R.u0, R.u1, fr(ua)), uB = lerp(R.u0, R.u1, ub - Math.floor(ua));
        const a = out.v(...pa, ...nn, uA, R.v0, 0), b = out.v(...pb, ...nn, uB, R.v0, 0), c = out.v(...pc, ...nn, uB, R.v1, 0), d = out.v(...pd, ...nn, uA, R.v1, 0);
        out.quad(a, b, c, d);
      }
    }
    if (o.flip) out.flip();
    this._slot(labelSlot(name, o.slot || 'decal')).append(out);
    return this;
  }
  // separate (unmerged) named mesh, e.g. 'screen', 'bulb'; own => per-instance material copy
  named(name, slot, g, x, y, z, o = {}) {
    const m = (x || y || z || o.rot || o.quat) ? matrixOf(x, y, z, o.rot, o.scale, o.quat) : null;
    const geo = new Geo().append(g, m);
    this.namedList.push({ name, slot, geo, own: o.own ?? true });
    return geo;
  }
  // animated sub-part: geometry is authored in model coords, pivot is the part origin
  part(name, px, py, pz, userData = {}) {
    const b = new Builder(this.rng, V(px, py, pz));
    this.parts.push({ name, b, userData });
    return b;
  }
  // exclude a slot from AO (e.g. glowing or transparent bits)
  skipAO(slot) { this.noAO.add(slot); return this; }
}
function palCollapse(g, slot) {
  const [hex, kind = ''] = slot.split(':');
  const c = palUV(hex, kind);
  for (let i = 0; i < g.uv.length; i += 2) { g.uv[i] = c[0]; g.uv[i + 1] = c[1]; }
}
function atlasTarget() { return 'atlas'; }

// ---------------------------------------------------------------------------
// Collider helpers (authoring coords)
// ---------------------------------------------------------------------------
const rotOf = (rx, ry, rz) => (rx || ry || rz ? { rot: [rx || 0, ry || 0, rz || 0] } : {});
export const CB = (w, h, d, x, y, z, rx, ry, rz) => ({ type: 'box', size: [w, h, d], pos: [x, y, z], ...rotOf(rx, ry, rz) });
export const CC = (r, h, x, y, z, rx, ry, rz) => ({ type: 'cylinder', radius: r, height: h, pos: [x, y, z], ...rotOf(rx, ry, rz) });
export const CS = (r, x, y, z) => ({ type: 'ball', radius: r, pos: [x, y, z] });
export const CP = (r, halfH, x, y, z, rx, ry, rz) => ({ type: 'capsule', radius: r, halfHeight: halfH, pos: [x, y, z], ...rotOf(rx, ry, rz) });
export function dirEuler(a, b) {
  const d = toV(b).sub(toV(a)).normalize();
  _q.setFromUnitVectors(UP, d);
  _e.setFromQuaternion(_q, 'XYZ');
  return [_e.x, _e.y, _e.z];
}
export function CCbetween(a, b, r) {
  const A = toV(a), B = toV(b), m = A.clone().add(B).multiplyScalar(0.5);
  const [rx, ry, rz] = dirEuler(A, B);
  return CC(r, A.distanceTo(B), m.x, m.y, m.z, rx, ry, rz);
}
export function CBbetween(a, b, w, d, extra = 0) {
  const A = toV(a), B = toV(b), m = A.clone().add(B).multiplyScalar(0.5);
  const [rx, ry, rz] = dirEuler(A, B);
  return CB(w, A.distanceTo(B) + extra, d, m.x, m.y, m.z, rx, ry, rz);
}
export function CPbetween(a, b, r) {
  const A = toV(a), B = toV(b), m = A.clone().add(B).multiplyScalar(0.5);
  const [rx, ry, rz] = dirEuler(A, B);
  return CP(r, Math.max(0.001, A.distanceTo(B) / 2), m.x, m.y, m.z, rx, ry, rz);
}

// lowest point of a collider set (for the rest-on-floor check)
export function colliderMinY(cols) {
  let min = Infinity;
  const corners = [];
  for (const c of cols) {
    _q.setFromEuler(_e.set(...(c.rot || [0, 0, 0])));
    if (c.type === 'ball') { min = Math.min(min, c.pos[1] - c.radius); continue; }
    if (c.type === 'box') {
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push(V(sx * c.size[0] / 2, sy * c.size[1] / 2, sz * c.size[2] / 2));
    } else if (c.type === 'cylinder' || c.type === 'capsule') {
      const hh = c.type === 'cylinder' ? c.height / 2 : c.halfHeight;
      for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; for (const sy of [-1, 1]) corners.push(V(Math.cos(a) * c.radius, sy * hh, Math.sin(a) * c.radius)); }
      if (c.type === 'capsule') {
        const axis = V(0, 1, 0).applyQuaternion(_q);
        for (const sy of [-1, 1]) min = Math.min(min, c.pos[1] + axis.y * sy * hh - c.radius);
      }
    }
    for (const p of corners) min = Math.min(min, p.applyQuaternion(_q).y + c.pos[1]);
    corners.length = 0;
  }
  return min;
}

// ---------------------------------------------------------------------------
// Voxel ambient occlusion + grime bake (per template, at rest pose)
// ---------------------------------------------------------------------------
// Voxelise every triangle into an occupancy grid (plus the floor plane as solid), build a mip
// pyramid of occupancy, then cone-trace a few wide cones per vertex through the pyramid.
const AO_CONES = (() => {
  // normal cone + 3 cones tilted 55 degrees (cosine weighted)
  const out = [[0, 0, 1, 1.0]];
  const t = 0.96;
  for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU + 0.4; out.push([Math.cos(a) * Math.sin(t), Math.sin(a) * Math.sin(t), Math.cos(t), 0.6]); }
  return out;
})();

function bakeAO(geos, bb, opts = {}) {
  const t00 = performance.now();
  const size = bb.getSize(_s);
  const L = Math.max(size.x, size.y, size.z);
  const cell = Math.max(L / (opts.res ?? 30), 0.008);
  const pad = 3;
  const ox = bb.min.x - pad * cell, oy = bb.min.y - pad * cell, oz = bb.min.z - pad * cell;
  // power-of-two friendly dims
  const nx = Math.ceil(size.x / cell) + pad * 2 + 1, ny = Math.ceil(size.y / cell) + pad * 2 + 1, nz = Math.ceil(size.z / cell) + pad * 2 + 1;
  const g0 = new Float32Array(nx * ny * nz);
  const inv = 1 / cell, NXY = nx * ny;
  for (const { g } of geos) {
    const P = g.p, I = g.idx;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      // triangle in voxel units
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
  const tv = performance.now();
  // floor: everything below the model's lowest point is solid
  if (opts.floor !== false) {
    const jf = Math.floor((bb.min.y + (opts.floorOffset ?? 0) - oy) / cell);
    for (let k = 0; k < nz; k++) for (let j = 0; j < Math.min(ny, jf); j++) for (let i = 0; i < nx; i++) g0[(k * ny + j) * nx + i] = 1;
  }
  // mip pyramid (average of 2x2x2)
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
  const tm = performance.now();
  const maxLv = Math.min(3, Math.max(2, Math.round(Math.log2((opts.maxDist ?? 0.3) / cell))));
  const strength = opts.strength ?? 1;
  const t1 = V(), t2 = V(), nn = V();
  // per-cone sample offsets (in units of cell) and weights
  const LV = [];
  for (let lv = 0; lv <= maxLv; lv++) LV.push({ L: levels[lv], dist: cell * (lv === 0 ? 1.1 : 1.6 * 2 ** lv), gain: lv === 0 ? 0.9 : 1.3, fall: 1 - lv / (maxLv + 2.5) });
  for (const { g, ao } of geos) {
    const P = g.p, N = g.n, cnt = g.count;
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
          } else if (fy < 0 && opts.floor !== false) a = 1;
          occ += (1 - occ) * Math.min(1, a * S.gain) * S.fall;
        }
        occT += occ * c[3]; wT += c[3];
      }
      const val = clamp(1 - (occT / wT) * 1.15 * strength, 0.1, 1);
      ao[v] = val;
    }
  }
  if (globalThis.__aoProf) globalThis.__aoProf.push({ vox: tv - t00, mip: tm - tv, cones: performance.now() - tm, cells: nx * ny * nz });
}

// ---------------------------------------------------------------------------
// Registry, template cache, instancing
// ---------------------------------------------------------------------------
export const FURNITURE = {};
export const DEFS = {};
const TPL = new Map();
export const _clearTemplates = () => TPL.clear(); // dev/bench only
const INFO = new Map();

export function def(name, spec) {
  DEFS[name] = spec;
  FURNITURE[name] = (o = {}) => instantiate(name, o || {});
}

function pickVariant(name, o) {
  const nv = DEFS[name].variants || 1;
  let v = o.variant;
  if (typeof v !== 'number') v = o.seed !== undefined && o.seed !== null ? hashString(`${name}:${o.seed}`) % nv : 0;
  return ((Math.floor(v) % nv) + nv) % nv;
}

// geometry key for a variant (specs may share geometry between material-only variants)
function geoKey(name, v) {
  const spec = DEFS[name];
  const gv = spec.geoVariant ? spec.geoVariant(v) : 0; // default: variants differ only in materials
  return { key: `${name}|${gv}`, gv };
}

function toBuffer(g, ao, grime, off) {
  const n = g.count;
  const bg = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), fx = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = g.p[i * 3] - off.x; pos[i * 3 + 1] = g.p[i * 3 + 1] - off.y; pos[i * 3 + 2] = g.p[i * 3 + 2] - off.z;
    nor[i * 3] = g.n[i * 3]; nor[i * 3 + 1] = g.n[i * 3 + 1]; nor[i * 3 + 2] = g.n[i * 3 + 2];
    uv[i * 2] = g.uv[i * 2]; uv[i * 2 + 1] = g.uv[i * 2 + 1];
    fx[i * 4] = Math.round((ao ? ao[i] : 1) * 255);
    fx[i * 4 + 1] = Math.round(clamp(g.e[i], 0, 1) * 255);
    fx[i * 4 + 2] = Math.round((grime ? grime[i] : 0) * 255);
    fx[i * 4 + 3] = 255;
  }
  bg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  bg.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  bg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  bg.setAttribute('furnFx', new THREE.BufferAttribute(fx, 4, true));
  bg.setIndex(n > 65535 ? new THREE.BufferAttribute(new Uint32Array(g.idx), 1) : new THREE.BufferAttribute(new Uint16Array(g.idx), 1));
  bg.computeBoundingSphere();
  bg.computeBoundingBox();
  bg.userData.shared = true; // never disposed by world teardown (cached template geometry)
  return bg;
}

const NO_SHADOW = new Set(['decal', 'glow', 'tape', 'glass', 'jug', 'water']);

export function getTemplate(name, v) {
  const { key, gv } = geoKey(name, v);
  let t = TPL.get(key);
  if (t) return t;
  const t0 = performance.now();
  const spec = DEFS[name];
  const rng = new RNG((hashString(name) ^ Math.imul(gv + 1, 0x9e3779b1)) >>> 0);
  const b = new Builder(rng);
  const meta = spec.build(b, gv, rng) || {};
  const t1 = performance.now();
  // all geometry lists (main, named, parts) in model coordinates
  const all = [];
  const visit = (bl) => {
    for (const [slot, g] of bl.slots) all.push({ g, slot, bl, noAO: bl.noAO.has(slot) || slot === 'decal' || slot === 'glow' });
    for (const nm of bl.namedList) all.push({ g: nm.geo, slot: nm.slot, bl, named: nm, noAO: bl.noAO.has(nm.slot) });
    for (const p of bl.parts) visit(p.b);
  };
  visit(b);
  const bb = new THREE.Box3();
  for (const it of all) if (it.g.count) bb.union(it.g.bounds());
  if (bb.isEmpty()) bb.set(V(-0.1, 0, -0.1), V(0.1, 0.2, 0.1));
  const c = bb.getCenter(V());
  // AO + grime
  const aoList = [];
  for (const it of all) {
    it.ao = new Float32Array(it.g.count).fill(1);
    it.grime = new Float32Array(it.g.count);
    if (!it.noAO && meta.ao !== false && spec.ao !== false) aoList.push(it);
  }
  if (aoList.length) bakeAO(aoList, bb, meta.aoOpts || {});
  const t2 = performance.now();
  const floorY = bb.min.y;
  for (const it of all) {
    const g = it.g;
    for (let i = 0; i < g.count; i++) {
      const y = g.p[i * 3 + 1] - floorY;
      const low = 1 - smooth(0.0, 0.12, y);
      const crev = smooth(0.92, 0.45, it.ao[i]);
      it.grime[i] = clamp(crev * 0.85 + low * 0.55 * (g.n[i * 3 + 1] < 0.5 ? 1 : 0.4), 0, 1);
    }
  }
  let tris = 0, verts = 0;
  const pack = (bl, off) => {
    const meshes = [];
    for (const it of all) {
      if (it.bl !== bl || it.named || !it.g.count) continue;
      const geo = toBuffer(it.g, it.ao, it.grime, off);
      tris += it.g.idx.length / 3; verts += it.g.count;
      meshes.push({ slot: it.slot, geo, cast: !NO_SHADOW.has(it.slot) && geo.boundingSphere.radius > 0.03 });
    }
    const named = [];
    for (const it of all) {
      if (it.bl !== bl || !it.named) continue;
      const geo = toBuffer(it.g, it.ao, it.grime, off);
      tris += it.g.idx.length / 3; verts += it.g.count;
      named.push({ name: it.named.name, slot: it.named.slot, geo, own: it.named.own, cast: !NO_SHADOW.has(it.named.slot) && geo.boundingSphere.radius > 0.03 });
    }
    return { meshes, named };
  };
  const main = pack(b, c);
  const parts = b.parts.map((p) => ({ name: p.name, pos: p.b.pivot.clone().sub(c), userData: p.userData, ...pack(p.b, p.b.pivot) }));
  const colliders = (meta.colliders || []).map((cl) => ({ ...cl, pos: [cl.pos[0] - c.x, cl.pos[1] - c.y, cl.pos[2] - c.z] }));
  const anchors = {};
  for (const [k, p] of Object.entries(meta.anchors || {})) anchors[k] = toV(p).sub(c);
  if (meta.stackOffset) anchors.stack = toV(meta.stackOffset);
  const size = bb.getSize(V());
  const cmin = colliderMinY(meta.colliders || []);
  if (meta.colliders?.length && Math.abs(cmin - bb.min.y) > 0.004 && !meta.floatOK) console.warn(`[furniture] ${name}/${gv}: collider bottom ${cmin.toFixed(4)} vs visual ${bb.min.y.toFixed(4)}`);
  t = {
    main, parts, colliders, anchors, tris, verts,
    mass: meta.mass ?? 5,
    material: meta.material || 'wood',
    breakInto: meta.breakInto || null,
    halfHeight: c.y - bb.min.y,
    size: [size.x, size.y, size.z],
    renderOrder: meta.renderOrder || null,
    friction: meta.friction, restitution: meta.restitution, linearDamping: meta.linearDamping, angularDamping: meta.angularDamping,
    buildMs: performance.now() - t0,
    prof: { build: t1 - t0, ao: t2 - t1, pack: performance.now() - t2 },
  };
  TPL.set(key, t);
  return t;
}

function makeMeshes(parent, pk, ov, order, partsOut) {
  for (const m of pk.meshes) {
    const mesh = new THREE.Mesh(m.geo, matFor(m.slot, ov));
    mesh.name = m.slot;
    mesh.castShadow = m.cast;
    mesh.userData.noShadow = !m.cast; // catalog.buildModel keeps this off (decals, tiny parts)
    mesh.receiveShadow = true;
    if (order && order[m.slot] !== undefined) mesh.renderOrder = order[m.slot];
    parent.add(mesh);
  }
  for (const n of pk.named) {
    let mat = matFor(n.slot, ov);
    if (n.own) mat = cloneMat(mat);
    const mesh = new THREE.Mesh(n.geo, mat);
    mesh.name = n.name;
    mesh.castShadow = n.cast;
    mesh.userData.noShadow = !n.cast;
    mesh.receiveShadow = true;
    if (order && order[n.slot] !== undefined) mesh.renderOrder = order[n.slot];
    parent.add(mesh);
    if (partsOut && !partsOut[n.name]) partsOut[n.name] = mesh;
  }
}

function instantiate(name, o) {
  const v = pickVariant(name, o);
  const t = getTemplate(name, v);
  const spec = DEFS[name];
  const ov = spec.mats ? spec.mats(o, v) : null;
  const root = new THREE.Group();
  root.name = name;
  root.userData.furniture = name;
  root.userData.variant = v;
  const parts = {};
  makeMeshes(root, t.main, ov, t.renderOrder, parts);
  for (const p of t.parts) {
    const g = new THREE.Group();
    g.name = p.name;
    g.position.copy(p.pos);
    g.userData = { ...p.userData, rest: p.pos.clone() };
    makeMeshes(g, p, ov, t.renderOrder, parts);
    root.add(g);
    parts[p.name] = g;
  }
  const anchors = {};
  for (const [k, p] of Object.entries(t.anchors)) anchors[k] = p.clone();
  const res = {
    object: root,
    colliders: t.colliders.map((c) => ({ ...c, pos: [...c.pos], ...(c.size ? { size: [...c.size] } : {}), ...(c.rot ? { rot: [...c.rot] } : {}) })),
    mass: t.mass,
    material: t.material,
    halfHeight: t.halfHeight,
    anchors,
    parts,
    breakInto: t.breakInto ? [...t.breakInto] : undefined,
    size: [...t.size],
    variant: v,
  };
  if (t.friction !== undefined) res.friction = t.friction;
  if (t.restitution !== undefined) res.restitution = t.restitution;
  if (t.linearDamping !== undefined) res.linearDamping = t.linearDamping;
  if (t.angularDamping !== undefined) res.angularDamping = t.angularDamping;
  return res;
}

export function buildFurniture(name, opts) {
  const f = FURNITURE[name];
  if (!f) throw new Error(`[furniture] unknown model '${name}'`);
  return f(opts || {});
}

// all distinct geometry variants of a model
export function geoVariants(name) {
  const nv = DEFS[name].variants || 1;
  const seen = new Set(), out = [];
  for (let v = 0; v < nv; v++) { const { key } = geoKey(name, v); if (!seen.has(key)) { seen.add(key); out.push(v); } }
  return out;
}

export function templateInfo(name, variant = 0) {
  const t = getTemplate(name, variant);
  return {
    tris: t.tris, verts: t.verts, variants: DEFS[name].variants || 1,
    meshes: t.main.meshes.length + t.main.named.length + t.parts.reduce((a, p) => a + p.meshes.length + p.named.length, 0),
    slots: [...new Set([...t.main.meshes, ...t.main.named, ...t.parts.flatMap((p) => [...p.meshes, ...p.named])].map((m) => m.slot))],
    size: t.size, buildMs: t.buildMs, colliders: t.colliders.length, mass: t.mass,
  };
}

export { matsReady, atlasReady };
