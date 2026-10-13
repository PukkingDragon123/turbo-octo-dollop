// Procedural furniture / prop model library for R.O.O.M.
//
// Every model is built from three.js primitives (+ RoundedBox / Lathe / Extrude / swept
// tubes) and canvas textures — no asset files. Static sub-meshes are merged per material
// (typically 2–5 draw calls per prop) and the merged geometry is cached per
// (name, variant), so spawning 200 chairs only creates new Object3D trees.
//
//   import { FURNITURE, buildFurniture } from './models_furniture.js';
//   const f = buildFurniture('chair_office', { seed: 42, color: 0x3a4a6a });
//   f.object, f.colliders, f.mass, f.material, f.halfHeight, f.anchors, f.parts, f.breakInto
//
// Conventions: meters, Y up, front of a model faces +Z. ORIGIN = bounding-box center.
// Colliders: {type:'box', size:[w,h,d], pos, rot?} | {type:'cylinder', radius, height, pos, rot?}
// (cylinder axis = Y) | {type:'ball', radius, pos}; `rot` is an XYZ Euler in radians.
// opts: { seed, variant, color } — variant picks a cached geometry flavour (labels, wear,
// layout), seed picks a variant deterministically, color tints the main fabric/paint.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as Mat from '../gfx/materials.js';
import * as Tex from '../gfx/textures.js';
import { RNG, hashString } from '../core/rng.js';

const PI = Math.PI, TAU = PI * 2, HP = PI / 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const toV = (p) => (p.isVector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2]));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Geometry utilities
// ---------------------------------------------------------------------------
function prep(g) {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') out.deleteAttribute(k);
  if (!out.attributes.normal) out.computeVertexNormals();
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  out.morphAttributes = {};
  out.clearGroups();
  return out;
}

function xform(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  if (!x && !y && !z && !rx && !ry && !rz && sx === 1 && sy === 1 && sz === 1) return g;
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  g.applyMatrix4(_m);
  return g;
}

// Box-style projection per triangle (face normal decides the plane); the longest extent
// of the primitive maps to U (wood grain) or V (plank grain).
function planarUV(g, d, grainV, rng) {
  const p = g.attributes.position, uv = g.attributes.uv;
  g.computeBoundingBox();
  const sz = g.boundingBox.getSize(_s);
  const grain = sz.x >= sz.y && sz.x >= sz.z ? 0 : sz.y >= sz.z ? 1 : 2;
  const ou = rng ? rng.next() * 7 : 0, ov = rng ? rng.next() * 7 : 0;
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  for (let i = 0; i < p.count; i += 3) {
    a[0] = p.getX(i); a[1] = p.getY(i); a[2] = p.getZ(i);
    b[0] = p.getX(i + 1) - a[0]; b[1] = p.getY(i + 1) - a[1]; b[2] = p.getZ(i + 1) - a[2];
    c[0] = p.getX(i + 2) - a[0]; c[1] = p.getY(i + 2) - a[1]; c[2] = p.getZ(i + 2) - a[2];
    const nx = Math.abs(b[1] * c[2] - b[2] * c[1]), ny = Math.abs(b[2] * c[0] - b[0] * c[2]), nz = Math.abs(b[0] * c[1] - b[1] * c[0]);
    const N = nx >= ny && nx >= nz ? 0 : ny >= nz ? 1 : 2;
    let A, B;
    if (N !== grain) { A = grain; B = 3 - N - grain; } else { A = (N + 1) % 3; B = (N + 2) % 3; }
    for (let k = 0; k < 3; k++) {
      const q = [p.getX(i + k), p.getY(i + k), p.getZ(i + k)];
      let u = q[A] * d + ou, v = q[B] * d + ov;
      if (grainV) { const t = u; u = v; v = t; }
      uv.setXY(i + k, u, v);
    }
  }
}

function nativeUV(g, su, sv, swap) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i) * su, v = uv.getY(i) * sv;
    if (swap) uv.setXY(i, v, u); else uv.setXY(i, u, v);
  }
}

function mapUV(g, r) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, lerp(r.u0, r.u1, uv.getX(i)), lerp(r.v0, r.v1, uv.getY(i)));
}

function collapseUV(g, c) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, c[0], c[1]);
}

// Smooth normals by welding on position (works on non-indexed geometry, ignores UV seams)
function smoothNormals(g) {
  const p = g.attributes.position, n = g.attributes.normal;
  const acc = new Map();
  const key = (i) => `${Math.round(p.getX(i) * 2e4)},${Math.round(p.getY(i) * 2e4)},${Math.round(p.getZ(i) * 2e4)}`;
  const A = V(), B = V(), Cc = V(), fn = V();
  for (let i = 0; i < p.count; i += 3) {
    A.fromBufferAttribute(p, i); B.fromBufferAttribute(p, i + 1); Cc.fromBufferAttribute(p, i + 2);
    fn.crossVectors(B.sub(A), Cc.sub(A));
    for (let k = 0; k < 3; k++) {
      const kk = key(i + k);
      let v = acc.get(kk);
      if (!v) acc.set(kk, (v = V()));
      v.add(fn);
    }
  }
  for (let i = 0; i < p.count; i++) {
    const v = acc.get(key(i)).clone().normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  n.needsUpdate = true;
  return g;
}

// Lathe with optional hard creases: pts = [[r, y, hard?], ...] listed bottom -> top for outward faces.
function latheGeo(pts, segs = 16, phi0 = 0, phiLen = TAU) {
  const prof = [];
  let s = 0;
  const segN = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dy / l, -dx / l, l]; };
  for (let j = 0; j < pts.length; j++) {
    const p = pts[j];
    const nin = j > 0 ? segN(pts[j - 1], p) : null, nout = j < pts.length - 1 ? segN(p, pts[j + 1]) : null;
    if (nin) s += nin[2];
    if (p[2] && nin && nout) {
      prof.push({ r: p[0], y: p[1], nr: nin[0], ny: nin[1], s, dup: false });
      prof.push({ r: p[0], y: p[1], nr: nout[0], ny: nout[1], s, dup: true });
    } else {
      const a = nin || nout, b = nout || nin;
      const nr = a[0] + b[0], ny = a[1] + b[1], l = Math.hypot(nr, ny) || 1;
      prof.push({ r: p[0], y: p[1], nr: nr / l, ny: ny / l, s, dup: false });
    }
  }
  const total = s || 1;
  const pos = [], nor = [], uv = [], idx = [];
  const cols = prof.length;
  for (let i = 0; i <= segs; i++) {
    const phi = phi0 + (i / segs) * phiLen, sn = Math.sin(phi), cs = Math.cos(phi);
    for (const q of prof) {
      pos.push(q.r * sn, q.y, q.r * cs);
      nor.push(q.nr * sn, q.ny, q.nr * cs);
      uv.push(i / segs, q.s / total);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < cols - 1; j++) {
      if (prof[j + 1].dup) continue;
      const a = i * cols + j, b = (i + 1) * cols + j, c = b + 1, d = a + 1;
      idx.push(a, b, d, c, d, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.userData.len = total;
  return g;
}

// Corner-rounded polyline (quadratic fillets)
function roundPath(pts, r, segs = 4, closed = false) {
  const P = pts.map(toV);
  const n = P.length;
  const out = [];
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

// Swept tube along explicit points with rotation-minimising frames.
// radius: number | [rN, rB] (elliptic) | (t)=>number
function sweepGeo(pts, radius, radial = 8, closed = false, caps = true) {
  const P = pts.map(toV);
  const n = P.length;
  const T = [];
  for (let i = 0; i < n; i++) {
    let t;
    if (closed) t = P[(i + 1) % n].clone().sub(P[(i - 1 + n) % n]);
    else if (i === 0) t = P[1].clone().sub(P[0]);
    else if (i === n - 1) t = P[n - 1].clone().sub(P[n - 2]);
    else t = P[i + 1].clone().sub(P[i]).normalize().add(P[i].clone().sub(P[i - 1]).normalize());
    if (t.lengthSq() < 1e-12) t = i > 0 ? T[i - 1].clone() : V(0, 1, 0);
    T.push(t.normalize());
  }
  const N = [], B = [];
  const ref = Math.abs(T[0].y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0);
  N[0] = ref.clone().sub(T[0].clone().multiplyScalar(ref.dot(T[0]))).normalize();
  B[0] = V().crossVectors(T[0], N[0]);
  const q = new THREE.Quaternion();
  for (let i = 1; i < n; i++) {
    q.setFromUnitVectors(T[i - 1], T[i]);
    N[i] = N[i - 1].clone().applyQuaternion(q);
    N[i].sub(T[i].clone().multiplyScalar(N[i].dot(T[i]))).normalize();
    B[i] = V().crossVectors(T[i], N[i]);
  }
  const rf = typeof radius === 'function' ? radius : Array.isArray(radius) ? () => radius : () => radius;
  const pos = [], nor = [], uv = [], idx = [];
  let s = 0;
  const ring = radial + 1;
  for (let i = 0; i < n; i++) {
    if (i > 0) s += P[i].distanceTo(P[i - 1]);
    const r = rf(i / (n - 1), i);
    const rn = Array.isArray(r) ? r[0] : r, rb = Array.isArray(r) ? r[1] : r;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      pos.push(P[i].x + (N[i].x * ca * rn + B[i].x * sa * rb), P[i].y + (N[i].y * ca * rn + B[i].y * sa * rb), P[i].z + (N[i].z * ca * rn + B[i].z * sa * rb));
      const nx = N[i].x * ca * rb + B[i].x * sa * rn, ny = N[i].y * ca * rb + B[i].y * sa * rn, nz = N[i].z * ca * rb + B[i].z * sa * rn;
      const l = Math.hypot(nx, ny, nz) || 1;
      nor.push(nx / l, ny / l, nz / l);
      uv.push(s, j / radial);
    }
  }
  const segsN = closed ? n : n - 1;
  for (let i = 0; i < segsN; i++) {
    const i2 = (i + 1) % n;
    for (let j = 0; j < radial; j++) {
      const a = i * ring + j, b = i2 * ring + j, c = i2 * ring + j + 1, d = i * ring + j + 1;
      idx.push(a, b, d, b, c, d);
    }
  }
  if (!closed && caps) {
    for (const [i, sgn] of [[0, -1], [n - 1, 1]]) {
      const ci = pos.length / 3;
      pos.push(P[i].x, P[i].y, P[i].z);
      nor.push(T[i].x * sgn, T[i].y * sgn, T[i].z * sgn);
      uv.push(s, 0.5);
      const start = pos.length / 3;
      for (let j = 0; j <= radial; j++) {
        const k = (i * ring + j) * 3;
        pos.push(pos[k], pos[k + 1], pos[k + 2]);
        nor.push(T[i].x * sgn, T[i].y * sgn, T[i].z * sgn);
        uv.push(s, j / radial);
      }
      for (let j = 0; j < radial; j++) {
        if (sgn > 0) idx.push(ci, start + j, start + j + 1);
        else idx.push(ci, start + j + 1, start + j);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.userData.len = s;
  return g;
}

// Superellipsoid "cushion" blob: p<1 squares the XZ silhouette, q<1 flattens the Y profile.
function cushionGeo(rx, ry, rz, p = 0.35, q = 0.6, ws = 16, hs = 10, bulge = 0) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const sx = Math.sign(x) * Math.pow(Math.abs(x), p), sy = Math.sign(y) * Math.pow(Math.abs(y), q), sz = Math.sign(z) * Math.pow(Math.abs(z), p);
    const edge = Math.max(Math.abs(sx), Math.abs(sz));
    const puff = 1 + bulge * (1 - edge * edge);
    pos.setXYZ(i, sx * rx, sy * ry * puff, sz * rz);
  }
  const out = prep(g);
  smoothNormals(out);
  return out;
}

// ---------------------------------------------------------------------------
// Texture atlas (labels, stickers, printed text, palette colours) — one shared texture
// ---------------------------------------------------------------------------
const REG = {};
function region(name, w, h, draw) { REG[name] = { w, h, draw }; }
const AT = { S: 2048, canvas: null, ctx: null, tex: null, rects: new Map(), pal: new Map(), palN: 0 };

function atlasTex() {
  if (AT.tex) return AT.tex;
  const c = document.createElement('canvas');
  c.width = c.height = AT.S;
  const ctx = c.getContext('2d');
  AT.canvas = c;
  AT.ctx = ctx;
  const names = Object.keys(REG).sort((a, b) => REG[b].h - REG[a].h || REG[b].w - REG[a].w);
  let x = 0, y = 0, rowH = 0;
  const pad = 6;
  for (const n of names) {
    const r = REG[n];
    if (x + r.w > AT.S) { x = 0; y += rowH + pad; rowH = 0; }
    AT.rects.set(n, { x, y, w: r.w, h: r.h });
    x += r.w + pad;
    rowH = Math.max(rowH, r.h);
  }
  AT.used = y + rowH;
  if (AT.used > AT.S) console.warn('[furniture] atlas overflow', AT.used);
  for (const n of names) {
    const r = AT.rects.get(n);
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.beginPath();
    ctx.rect(0, 0, r.w, r.h);
    ctx.clip();
    REG[n].draw(ctx, r.w, r.h, new RNG(hashString(n)));
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  AT.tex = t;
  return t;
}

// UV rect of a region (optionally one cell of a cols x rows grid, cell index row-major from top-left)
function rUV(name, cell = -1, cols = 1, rows = 1) {
  atlasTex();
  const r = AT.rects.get(name);
  if (!r) throw new Error(`[furniture] unknown atlas region ${name}`);
  let x = r.x, y = r.y, w = r.w, h = r.h;
  if (cell >= 0) {
    w = r.w / cols; h = r.h / rows;
    x += (cell % cols) * w; y += Math.floor(cell / cols) * h;
  }
  const S = AT.S;
  return { u0: (x + 0.5) / S, u1: (x + w - 0.5) / S, v0: 1 - (y + h - 0.5) / S, v1: 1 - (y + 0.5) / S };
}

region('pal', 256, 256, () => {});
function palUV(hex) {
  let c = AT.pal.get(hex);
  if (c) return c;
  atlasTex();
  const r = AT.rects.get('pal');
  const i = AT.palN++;
  if (i >= 256) { console.warn('[furniture] palette full'); return palUV('#ff00ff'); }
  const cx = r.x + (i % 16) * 16, cy = r.y + Math.floor(i / 16) * 16;
  AT.ctx.fillStyle = hex;
  AT.ctx.fillRect(cx, cy, 16, 16);
  AT.tex.needsUpdate = true;
  c = [(cx + 8) / AT.S, 1 - (cy + 8) / AT.S];
  AT.pal.set(hex, c);
  return c;
}

// --- canvas drawing helpers ---
const FONTS = {
  sans: 'Arial, Helvetica, "Liberation Sans", sans-serif',
  mono: '"IBM Plex Mono", "Courier New", monospace',
  lcd: 'VT323, "IBM Plex Mono", monospace',
  serif: 'Georgia, "Times New Roman", "Liberation Serif", serif',
};
function font(px, fam = 'sans', weight = 'bold') { return `${weight} ${px}px ${FONTS[fam] || fam}`; }
function txt(ctx, s, x, y, px, color = '#000', o = {}) {
  ctx.font = font(px, o.fam || 'sans', o.weight || 'bold');
  ctx.fillStyle = color;
  ctx.textAlign = o.align || 'center';
  ctx.textBaseline = o.base || 'middle';
  if (o.maxW) ctx.fillText(s, x, y, o.maxW); else ctx.fillText(s, x, y);
}
function marker(ctx, s, x, y, px, color, rng, o = {}) {
  ctx.font = font(px, o.fam || 'sans', o.weight || 'bold');
  const ws = [...s].map((ch) => ctx.measureText(ch).width * (o.tight ?? 0.9));
  let cx = x - (o.align === 'left' ? 0 : ws.reduce((a, b) => a + b, 0) / 2);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  let drift = 0;
  [...s].forEach((ch, i) => {
    drift += (rng.next() - 0.5) * px * 0.05;
    ctx.save();
    ctx.translate(cx, y + drift + (rng.next() - 0.5) * px * 0.1);
    ctx.rotate((rng.next() - 0.5) * 0.18 + (o.slant || 0));
    ctx.scale(0.88 + rng.next() * 0.18, 0.92 + rng.next() * 0.16);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    cx += ws[i];
  });
}
function grunge(ctx, w, h, rng, n = 300, a = 1, rmax = 2.2) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = rng.next() * a;
    ctx.beginPath();
    ctx.arc(rng.next() * w, rng.next() * h, rng.next() * rmax + 0.3, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function noiseFill(ctx, w, h, rng, base, n = 600, a = 0.06, dark = true) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = dark ? `rgba(0,0,0,${rng.next() * a})` : `rgba(255,255,255,${rng.next() * a})`;
    ctx.fillRect(rng.next() * w, rng.next() * h, 1 + rng.next() * 3, 1 + rng.next() * 3);
  }
}
function barcode(ctx, x, y, w, h, rng) {
  ctx.fillStyle = '#111';
  let cx = x;
  while (cx < x + w) {
    const bw = 1 + Math.floor(rng.next() * 3);
    if (rng.next() > 0.45) ctx.fillRect(cx, y, bw, h);
    cx += bw + 1;
  }
}
function logo(ctx, x, y, s, color) {
  // ROOM CORP mark: nested squares with a door slot
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = s * 0.09;
  ctx.strokeRect(x - s / 2, y - s / 2, s, s);
  ctx.strokeRect(x - s * 0.28, y - s * 0.28, s * 0.56, s * 0.56);
  ctx.fillRect(x - s * 0.07, y - s * 0.05, s * 0.14, s * 0.33);
  ctx.restore();
}
function lines(ctx, x, y, w, rows, gap, rng, color = 'rgba(30,30,40,0.75)', th = 3) {
  ctx.fillStyle = color;
  for (let i = 0; i < rows; i++) {
    let cx = x;
    const end = x + w * (i === rows - 1 ? 0.3 + rng.next() * 0.4 : 0.8 + rng.next() * 0.2);
    while (cx < end) {
      const ww = 4 + rng.next() * 18;
      ctx.fillRect(cx, y + i * gap, Math.min(ww, end - cx), th);
      cx += ww + 3 + rng.next() * 3;
    }
  }
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------
function canvasMap(w, h, draw, repeat = 1, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (repeat !== 1) t.repeat.set(repeat, repeat);
  return t;
}

const CUSTOM = {
  atlas: () => new THREE.MeshStandardMaterial({ name: 'furn_atlas', map: atlasTex(), roughness: 0.6 }),
  decal: () => new THREE.MeshStandardMaterial({ name: 'furn_decal', map: atlasTex(), roughness: 0.7, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  glow: () => new THREE.MeshStandardMaterial({ name: 'furn_glow', map: atlasTex(), emissiveMap: atlasTex(), emissive: 0xffffff, emissiveIntensity: 1.5, roughness: 0.3 }),
  kraft: () => {
    const map = canvasMap(256, 256, (ctx, w, h) => {
      const rng = new RNG(901);
      noiseFill(ctx, w, h, rng, '#a8804f', 2400, 0.08);
      for (let i = 0; i < 1400; i++) {
        ctx.fillStyle = `rgba(${rng.next() > 0.5 ? '255,235,200' : '60,40,20'},${rng.next() * 0.12})`;
        ctx.fillRect(rng.next() * w, rng.next() * h, 1, 2 + rng.next() * 5);
      }
      for (let x = 0; x < w; x += 4) { ctx.fillStyle = 'rgba(0,0,0,0.035)'; ctx.fillRect(x, 0, 2, h); }
      for (let i = 0; i < 18; i++) {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        g.addColorStop(0, 'rgba(70,45,20,0.10)'); g.addColorStop(1, 'rgba(70,45,20,0)');
        ctx.save(); ctx.translate(rng.next() * w, rng.next() * h); ctx.scale(20 + rng.next() * 40, 20 + rng.next() * 40);
        ctx.fillStyle = g; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
      }
    });
    return new THREE.MeshStandardMaterial({ name: 'furn_kraft', map, roughness: 0.93 });
  },
  leaf: () => new THREE.MeshStandardMaterial({ name: 'furn_leaf', color: 0x3c6a2e, roughness: 0.5, side: THREE.DoubleSide, envMapIntensity: 0.8 }),
  leaf_dark: () => new THREE.MeshStandardMaterial({ name: 'furn_leaf_dark', color: 0x1f3b1b, roughness: 0.32, side: THREE.DoubleSide }),
  bark: () => Mat.make('wood_dark', { color: 0x6a5240 }),
  oak: () => { const m = Mat.make('wood'); m.color.setRGB(3.2, 4.4, 6.0); m.name = 'furn_oak'; return m; },
  terracotta: () => Mat.make('concrete', { color: 0xb5643f }),
  soil: () => Mat.make('concrete', { color: 0x3a2b1e }),
  paper2: () => { const m = Mat.make('paper'); m.side = THREE.DoubleSide; return m; },
  ceramic: () => new THREE.MeshPhysicalMaterial({ name: 'furn_ceramic', color: 0xf2efe6, roughness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.15 }),
  vinyl: () => Mat.make('plastic_black', { color: 0x2a2624, roughness: 0.9 }),
  wiremesh: () => {
    const map = canvasMap(64, 64, (ctx, w, h) => {
      ctx.fillStyle = '#2a2a2c';
      ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) ctx.clearRect(x * 8 + 1.5 + (y & 1) * 4, y * 8 + 1.5, 5, 5);
      for (let y = 0; y < 8; y++) ctx.clearRect((y & 1) * 4 - 6.5 + 64, y * 8 + 1.5, 5, 5);
    });
    return new THREE.MeshStandardMaterial({ name: 'furn_wiremesh', map, transparent: true, alphaTest: 0.04, depthWrite: false, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.45, color: 0xb0b0b0 });
  },
  jug: () => new THREE.MeshPhysicalMaterial({ name: 'furn_jug', color: 0x7fb6ee, roughness: 0.12, transparent: true, opacity: 0.38, depthWrite: false, clearcoat: 1, envMapIntensity: 1.4 }),
  water: () => new THREE.MeshPhysicalMaterial({ name: 'furn_water', color: 0x3d84d8, roughness: 0.05, transparent: true, opacity: 0.32, depthWrite: false }),
  burlap: () => Mat.make('fabric_brown', { color: 0xa88d5e, texRepeat: 6 }),
  lampshade: () => { const m = Mat.make('fabric_white', { color: 0xe9dcbc, emissive: 0x000000 }); m.side = THREE.DoubleSide; return m; },
  mattress: () => {
    const map = canvasMap(256, 512, (ctx, w, h) => {
      const rng = new RNG(4411);
      noiseFill(ctx, w, h, rng, '#d9cfb8', 3000, 0.05);
      // ticking damask: faint diamonds
      ctx.strokeStyle = 'rgba(120,130,150,0.22)';
      ctx.lineWidth = 2;
      for (let y = -32; y < h + 32; y += 32) for (let x = -32; x < w + 32; x += 32) {
        ctx.beginPath(); ctx.moveTo(x, y + 16); ctx.lineTo(x + 16, y); ctx.lineTo(x + 32, y + 16); ctx.lineTo(x + 16, y + 32); ctx.closePath(); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(110,120,140,0.18)';
      for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) { ctx.beginPath(); ctx.arc(x + 16, y + 16, 3, 0, TAU); ctx.fill(); }
      // stains: irregular blobs with darker tide lines
      blobStains(ctx, w, h, rng, 11);
    });
    return new THREE.MeshStandardMaterial({ name: 'furn_mattress', map, roughness: 0.95, normalMap: Tex.get('fabric', 6).normalMap, normalScale: new THREE.Vector2(0.6, 0.6) });
  },
  whiteboard: () => {
    const map = canvasMap(1024, 768, drawWhiteboard);
    map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
    return new THREE.MeshStandardMaterial({ name: 'furn_whiteboard', map, roughness: 0.22, envMapIntensity: 1.2 });
  },
  bball: () => {
    const map = canvasMap(512, 256, (ctx, w, h) => {
      const rng = new RNG(77);
      noiseFill(ctx, w, h, rng, '#c8561e', 0);
      for (let i = 0; i < 9000; i++) {
        ctx.fillStyle = rng.next() > 0.5 ? 'rgba(0,0,0,0.13)' : 'rgba(255,190,140,0.10)';
        ctx.beginPath(); ctx.arc(rng.next() * w, rng.next() * h, 1.1, 0, TAU); ctx.fill();
      }
      ctx.strokeStyle = '#15100c';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
      for (const x of [w * 0.25, w * 0.75]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (const cx of [0, w / 2, w]) {
        ctx.beginPath();
        for (let y = 0; y <= h; y += 4) { const t = (y / h) * PI; const x = cx + Math.sin(t) * w * 0.16 * (cx === w / 2 ? -1 : 1); if (y === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(20,10,5,0.75)';
      ctx.font = font(11, 'sans'); ctx.textAlign = 'center';
      ctx.fillText('OFFICIAL SIZE 7', w * 0.375, h * 0.43);
    });
    return new THREE.MeshStandardMaterial({ name: 'furn_bball', map, roughness: 0.78 });
  },
  fabric90s_teal: () => fabric90s(['#1d4a50', '#2f7a78', '#9b5b80', '#e3d6b0', '#d58a52'], 11),
  fabric90s_mauve: () => fabric90s(['#4e2f40', '#8a5072', '#3f8a86', '#e9dbb8', '#c9a14a'], 23),
  tape: () => new THREE.MeshStandardMaterial({ name: 'furn_tape', color: 0xc9a46a, roughness: 0.3, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
  rubber_tire: () => Mat.make('plastic_black', { color: 0x1c1c1c, roughness: 0.92 }),
  mop_cotton: () => Mat.make('fabric_white', { color: 0xd6ccb2, texRepeat: 2 }),
  cork: () => Mat.make('fabric_brown', { color: 0xb08a5a, texRepeat: 3 }),
};

// painted sheet steel: subtle scuffs (plastic texture) + a little metalness
const PAINTS = { beige: 0xc8bd9f, grey: 0x8d9093, dark: 0x3a3c3f, black: 0x1e1f21, red: 0xa3261e, green: 0x4d6a4a, white: 0xe4e2da, blue: 0x34507a, brown: 0x5b4636, yellow: 0xd8a823 };
for (const [k, hex] of Object.entries(PAINTS)) {
  CUSTOM['paint_' + k] = () => {
    const m = Mat.make('plastic_white', { color: hex, roughness: 0.55 });
    m.metalness = 0.35;
    m.name = 'furn_paint_' + k;
    return m;
  };
}

function blobStains(ctx, w, h, rng, n, cols = ['150,105,35', '120,80,45', '160,125,60', '95,70,50'], o = {}) {
  for (let i = 0; i < n; i++) {
    const cx = o.center ? w / 2 + (rng.next() - 0.5) * o.center : rng.next() * w, cy = o.center ? h / 2 + (rng.next() - 0.5) * o.center : rng.next() * h;
    const R = o.rMin !== undefined ? o.rMin + rng.next() * (o.rMax - o.rMin) : 10 + rng.next() * rng.next() * 70;
    const col = cols[Math.floor(rng.next() * cols.length)];
    const k = 18, ph = [rng.next() * 6, rng.next() * 6, rng.next() * 6];
    ctx.beginPath();
    for (let j = 0; j <= k; j++) {
      const a = (j / k) * TAU;
      const r = R * (1 + 0.25 * Math.sin(a * 2 + ph[0]) + 0.15 * Math.sin(a * 3 + ph[1]) + 0.1 * Math.sin(a * 5 + ph[2]));
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * (0.7 + 0.3 * Math.sin(ph[0]));
      if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = `rgba(${col},${0.08 + rng.next() * 0.16})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${col},${0.25 + rng.next() * 0.25})`;
    ctx.lineWidth = 1 + rng.next() * 2.5;
    ctx.stroke();
    if (rng.next() > 0.5) { ctx.save(); ctx.translate(cx, cy); ctx.scale(0.55, 0.5); ctx.translate(-cx, -cy); ctx.fillStyle = `rgba(${col},0.14)`; ctx.fill(); ctx.restore(); }
  }
}

function fabric90s(cols, seed) {
  const map = canvasMap(256, 256, (ctx, w, h) => {
    const rng = new RNG(seed);
    ctx.fillStyle = cols[0];
    ctx.fillRect(0, 0, w, h);
    const draw = (fn) => { for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { ctx.save(); ctx.translate(ox, oy); fn(); ctx.restore(); } };
    for (let i = 0; i < 70; i++) {
      const x = rng.next() * w, y = rng.next() * h, c = cols[1 + Math.floor(rng.next() * (cols.length - 1))], k = rng.next();
      const a = rng.next() * TAU, s = 4 + rng.next() * 8;
      draw(() => {
        ctx.fillStyle = c; ctx.strokeStyle = c; ctx.lineWidth = 2.2;
        ctx.translate(x, y); ctx.rotate(a);
        if (k < 0.35) { ctx.beginPath(); ctx.moveTo(-s, 0); ctx.bezierCurveTo(-s / 2, -s, s / 2, s, s, 0); ctx.stroke(); }
        else if (k < 0.6) { ctx.fillRect(-s / 2, -1.5, s, 3); }
        else if (k < 0.8) { ctx.beginPath(); ctx.moveTo(0, -s / 2); ctx.lineTo(s / 2, s / 2); ctx.lineTo(-s / 2, s / 2); ctx.closePath(); ctx.fill(); }
        else { ctx.beginPath(); ctx.arc(0, 0, s / 3, 0, TAU); ctx.fill(); }
      });
    }
  });
  const fab = Tex.get('fabric', 8);
  return new THREE.MeshStandardMaterial({ name: 'furn_fabric90s', map, normalMap: fab.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.95 });
}

const matCache = new Map();
function matFor(slot, ov) {
  if (ov && ov[slot]) return ov[slot];
  let m = matCache.get(slot);
  if (m) return m;
  if (CUSTOM[slot]) m = CUSTOM[slot]();
  else if (Mat.has(slot)) m = Mat.get(slot);
  else throw new Error(`[furniture] unknown material slot '${slot}'`);
  matCache.set(slot, m);
  return m;
}
// Tinted copy of a library material, cached by colour
function tint(base, hex, extra) {
  const key = `${base}|${hex}|${extra ? JSON.stringify(extra) : ''}`;
  let m = matCache.get(key);
  if (!m) {
    m = CUSTOM[base] ? CUSTOM[base]().clone() : Mat.make(base, extra || {});
    m.color.setHex(hex);
    matCache.set(key, m);
  }
  return m;
}

// UV texel density (texture tiles per meter) and grain direction by slot prefix
function uvDensity(slot) {
  if (slot.startsWith('wood') || slot === 'oak') return 1.2;
  if (slot.startsWith('plank')) return 1.1;
  if (slot.startsWith('fab') || slot === 'seat' || slot === 'cushion' || slot === 'shell') return 1.6;
  if (slot === 'kraft') return 2.2;
  if (slot === 'steel' || slot === 'chrome') return 1.6;
  if (slot.startsWith('plastic')) return 1.5;
  if (slot.startsWith('metal') || slot === 'rust') return 4;
  if (slot.startsWith('paint') || slot === 'frame' || slot === 'body') return 2.5;
  return 1;
}
const isWood = (slot) => slot.startsWith('wood') || slot === 'bark' || slot === 'oak';
const grainV = (slot) => slot.startsWith('plank');

// ---------------------------------------------------------------------------
// Builder: collects transformed primitives per material slot
// ---------------------------------------------------------------------------
class Builder {
  constructor(rng, pivot = null) {
    this.rng = rng;
    this.lists = new Map();
    this.nlist = [];
    this.parts = [];
    this.pivot = pivot;
  }
  _push(slot, g) {
    let l = this.lists.get(slot);
    if (!l) this.lists.set(slot, (l = []));
    l.push(g);
    return g;
  }
  _uv(slot, g, uv) {
    if (slot[0] === '#') { collapseUV(g, palUV(slot)); return 'atlas'; }
    if (uv === 'planar') planarUV(g, uvDensity(slot), grainV(slot), this.rng);
    else if (uv && uv.su !== undefined) {
      const d = uvDensity(slot);
      nativeUV(g, uv.su * d, uv.sv * d, uv.swap ?? isWood(slot));
    } else if (uv && uv.region) mapUV(g, uv.region);
    return slot;
  }
  // generic add: raw geometry + transform (+ optional scale)
  add(slot, g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, uv = 'planar', sx = 1, sy = 1, sz = 1) {
    g = prep(g);
    slot = this._uv(slot, g, uv);
    xform(g, x, y, z, rx, ry, rz, sx, sy, sz);
    return this._push(slot, g);
  }
  box(slot, w, h, d, x, y, z, rx, ry, rz) { return this.add(slot, new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz); }
  rbox(slot, w, h, d, r, x, y, z, rx, ry, rz, seg = 1) {
    return this.add(slot, new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)), x, y, z, rx, ry, rz);
  }
  cyl(slot, rt, rb, h, x, y, z, rx, ry, rz, seg = 12, open = false) {
    return this.add(slot, new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), x, y, z, rx, ry, rz, { su: TAU * Math.max(rt, rb), sv: h });
  }
  sph(slot, r, x, y, z, ws = 12, hs = 8, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
    return this.add(slot, new THREE.SphereGeometry(r, ws, hs), x, y, z, rx, ry, rz, { su: TAU * r, sv: PI * r, swap: false }, sx, sy, sz);
  }
  tor(slot, R, r, x, y, z, rx, ry, rz, rs = 6, ts = 20, arc = TAU) {
    return this.add(slot, new THREE.TorusGeometry(R, r, rs, ts, arc), x, y, z, rx, ry, rz, { su: TAU * R, sv: TAU * r, swap: false });
  }
  lathe(slot, pts, x, y, z, rx, ry, rz, segs = 16, phi0 = 0, phiLen = TAU, uv) {
    const g = latheGeo(pts, segs, phi0, phiLen);
    const rmax = Math.max(...pts.map((p) => p[0]));
    return this.add(slot, g, x, y, z, rx, ry, rz, uv || { su: TAU * rmax, sv: g.userData.len, swap: false });
  }
  // swept tube through absolute points; o: {radial, closed, caps, round, rseg}
  tube(slot, pts, r, o = {}) {
    const path = o.round ? roundPath(pts, o.round, o.rseg ?? 4, o.closed) : pts;
    const g = sweepGeo(path, r, o.radial ?? 8, o.closed ?? false, o.caps ?? true);
    const rr = typeof r === 'number' ? r : 0.01;
    return this.add(slot, g, 0, 0, 0, 0, 0, 0, o.uv || { su: 1, sv: TAU * rr, swap: false });
  }
  ext(slot, shape, depth, x, y, z, rx, ry, rz, bevel = 0, bevelSeg = 1, curveSeg = 8) {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: bevelSeg, curveSegments: curveSeg });
    g.translate(0, 0, -depth / 2);
    return this.add(slot, g, x, y, z, rx, ry, rz);
  }
  // flat decal quad facing +Z (before rotation) textured with an atlas region / cell
  decal(name, w, h, x, y, z, rx = 0, ry = 0, rz = 0, o = {}) {
    const g = prep(new THREE.PlaneGeometry(w, h));
    mapUV(g, o.cell !== undefined ? rUV(name, o.cell, o.cols, o.rows) : rUV(name));
    xform(g, x, y, z, rx, ry, rz);
    return this._push(o.slot || 'decal', g);
  }
  // decal wrapped on a cylinder (axis Y), centred at angle `theta` (0 = +Z)
  cylDecal(name, r, h, theta, arc, x, y, z, rx = 0, ry = 0, rz = 0, o = {}) {
    const g = prep(new THREE.CylinderGeometry(r, o.rb ?? r, h, Math.max(4, Math.ceil(arc / 0.15)), 1, true, theta - arc / 2, arc));
    mapUV(g, o.cell !== undefined ? rUV(name, o.cell, o.cols, o.rows) : rUV(name));
    xform(g, x, y, z, rx, ry, rz);
    return this._push(o.slot || 'decal', g);
  }
  // separate (unmerged) named mesh, e.g. 'screen', 'bulb'; own => per-instance material copy
  named(name, slot, g, x, y, z, rx, ry, rz, o = {}) {
    g = prep(g);
    if (o.uv !== 'keep') slot = this._uv(slot, g, o.uv || 'planar');
    xform(g, x, y, z, rx, ry, rz);
    this.nlist.push({ name, slot, geo: g, own: o.own ?? true });
    return g;
  }
  // animated sub-part: geometry is authored in model coords, pivot is the part origin
  part(name, px, py, pz, userData = {}) {
    const b = new Builder(this.rng, V(px, py, pz));
    this.parts.push({ name, b, userData });
    return b;
  }
}

// collider helpers (authoring coords)
const rotOf = (rx, ry, rz) => (rx || ry || rz ? { rot: [rx || 0, ry || 0, rz || 0] } : {});
const CB = (w, h, d, x, y, z, rx, ry, rz) => ({ type: 'box', size: [w, h, d], pos: [x, y, z], ...rotOf(rx, ry, rz) });
const CC = (r, h, x, y, z, rx, ry, rz) => ({ type: 'cylinder', radius: r, height: h, pos: [x, y, z], ...rotOf(rx, ry, rz) });
const CS = (r, x, y, z) => ({ type: 'ball', radius: r, pos: [x, y, z] });
function dirEuler(a, b) {
  const d = toV(b).sub(toV(a)).normalize();
  _q.setFromUnitVectors(UP, d);
  _e.setFromQuaternion(_q, 'XYZ');
  return [_e.x, _e.y, _e.z];
}
function CCbetween(a, b, r) {
  const A = toV(a), B = toV(b);
  const m = A.clone().add(B).multiplyScalar(0.5);
  const [rx, ry, rz] = dirEuler(A, B);
  return CC(r, A.distanceTo(B), m.x, m.y, m.z, rx, ry, rz);
}
// oriented box between two points (Y axis along a->b)
function CBbetween(a, b, w, d, extraY = 0) {
  const A = toV(a), B = toV(b);
  const m = A.clone().add(B).multiplyScalar(0.5);
  const [rx, ry, rz] = dirEuler(A, B);
  return CB(w, A.distanceTo(B) + extraY, d, m.x, m.y, m.z, rx, ry, rz);
}
// add a box between two points to a builder (Y axis along a->b), with optional roll about the axis
function boxBetween(b, slot, a, c, w, d, r = 0, roll = 0) {
  const A = toV(a), C = toV(c);
  const L = A.distanceTo(C);
  const g = r > 0 ? new RoundedBoxGeometry(w, L, d, 1, Math.min(r, w / 2 - 1e-4, d / 2 - 1e-4)) : new THREE.BoxGeometry(w, L, d);
  if (roll) g.rotateY(roll);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, C.clone().sub(A).normalize());
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  const m = A.add(C).multiplyScalar(0.5);
  return b.add(slot, g, m.x, m.y, m.z, e.x, e.y, e.z);
}
function cylBetween(b, slot, a, c, r1, r2 = r1, seg = 10) {
  const A = toV(a), C = toV(c);
  const L = A.distanceTo(C);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, C.clone().sub(A).normalize());
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  const m = A.add(C).multiplyScalar(0.5);
  return b.cyl(slot, r2, r1, L, m.x, m.y, m.z, e.x, e.y, e.z, seg);
}

// ---------------------------------------------------------------------------
// Registry, template cache, instancing
// ---------------------------------------------------------------------------
export const FURNITURE = {};
const DEFS = {};
const TPL = new Map();

function def(name, spec) {
  DEFS[name] = spec;
  FURNITURE[name] = (o = {}) => instantiate(name, o || {});
}

function pickVariant(name, o) {
  const nv = DEFS[name].variants || 1;
  let v = o.variant;
  if (typeof v !== 'number') v = o.seed !== undefined && o.seed !== null ? hashString(`${name}:${o.seed}`) % nv : 0;
  return ((Math.floor(v) % nv) + nv) % nv;
}

function getTemplate(name, v) {
  const key = `${name}|${v}`;
  let t = TPL.get(key);
  if (t) return t;
  const spec = DEFS[name];
  const rng = new RNG((hashString(name) ^ Math.imul(v + 1, 0x9e3779b1)) >>> 0);
  const b = new Builder(rng);
  const meta = spec.build(b, v, rng) || {};
  // bounds over everything (parts at rest)
  const bb = new THREE.Box3();
  const visit = (bl) => {
    for (const l of bl.lists.values()) for (const g of l) { g.computeBoundingBox(); bb.union(g.boundingBox); }
    for (const n of bl.nlist) { n.geo.computeBoundingBox(); bb.union(n.geo.boundingBox); }
    for (const p of bl.parts) visit(p.b);
  };
  visit(b);
  const c = bb.getCenter(V());
  let tris = 0;
  const pack = (bl, off) => {
    const meshes = [];
    for (const [slot, list] of bl.lists) {
      const geo = list.length === 1 ? list[0] : mergeGeometries(list, false);
      geo.translate(-off.x, -off.y, -off.z);
      geo.computeBoundingSphere();
      tris += geo.attributes.position.count / 3;
      meshes.push({ slot, geo, cast: slot !== 'decal' && slot !== 'tape' && slot !== 'glow' && geo.boundingSphere.radius > 0.075 });
    }
    const named = bl.nlist.map((n) => {
      n.geo.translate(-off.x, -off.y, -off.z);
      n.geo.computeBoundingSphere();
      tris += n.geo.attributes.position.count / 3;
      return { name: n.name, slot: n.slot, geo: n.geo, own: n.own, cast: n.geo.boundingSphere.radius > 0.075 };
    });
    return { meshes, named };
  };
  const main = pack(b, c);
  const parts = b.parts.map((p) => ({ name: p.name, pos: p.b.pivot.clone().sub(c), userData: p.userData, ...pack(p.b, p.b.pivot) }));
  const colliders = (meta.colliders || []).map((cl) => ({ ...cl, pos: [cl.pos[0] - c.x, cl.pos[1] - c.y, cl.pos[2] - c.z] }));
  const anchors = {};
  for (const [k, p] of Object.entries(meta.anchors || {})) anchors[k] = toV(p).sub(c);
  if (meta.stackOffset) anchors.stack = toV(meta.stackOffset);
  const size = bb.getSize(V());
  t = {
    main, parts, colliders, anchors, tris,
    mass: meta.mass ?? 5,
    material: meta.material || 'wood',
    breakInto: meta.breakInto || null,
    halfHeight: c.y - bb.min.y,
    size: [size.x, size.y, size.z],
    renderOrder: meta.renderOrder || null,
  };
  TPL.set(key, t);
  return t;
}

function makeMeshes(parent, pk, ov, order, partsOut) {
  for (const m of pk.meshes) {
    const mesh = new THREE.Mesh(m.geo, matFor(m.slot, ov));
    mesh.name = m.slot;
    mesh.castShadow = m.cast;
    mesh.receiveShadow = true;
    if (order && order[m.slot] !== undefined) mesh.renderOrder = order[m.slot];
    parent.add(mesh);
  }
  for (const n of pk.named) {
    let mat = matFor(n.slot, ov);
    if (n.own) mat = mat.clone();
    const mesh = new THREE.Mesh(n.geo, mat);
    mesh.name = n.name;
    mesh.castShadow = n.cast;
    mesh.receiveShadow = true;
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
  return {
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
}

export function buildFurniture(name, opts) {
  const f = FURNITURE[name];
  if (!f) throw new Error(`[furniture] unknown model '${name}'`);
  const r = f(opts || {});
  r.object.traverse((m) => {
    if (!m.isMesh) return;
    m.receiveShadow = true;
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    if (m.name !== 'decal' && m.name !== 'tape' && m.name !== 'glow') m.castShadow = m.geometry.boundingSphere.radius > 0.075;
  });
  return r;
}

// Pre-build every template (all variants) + the label atlas, e.g. during a loading screen,
// so nothing is generated (and no atlas re-upload happens) mid-game. Yields between models.
export async function warmFurniture(onProgress) {
  const names = Object.keys(FURNITURE);
  for (let i = 0; i < names.length; i++) {
    const nv = DEFS[names[i]].variants || 1;
    for (let v = 0; v < nv; v++) getTemplate(names[i], v);
    for (const slot of ['atlas', 'decal', 'glow']) matFor(slot);
    onProgress?.((i + 1) / names.length, names[i]);
    await new Promise((r) => setTimeout(r, 0));
  }
  if (AT.tex) AT.tex.needsUpdate = true;
}

// Debug/info: triangle count + variant count per model (builds templates on demand)
export const furnitureAtlas = () => ({ canvas: AT.canvas, used: AT.used, size: AT.S, palette: AT.palN });
export function furnitureInfo(name, variant = 0) {
  const t = getTemplate(name, variant);
  return { tris: t.tris, variants: DEFS[name].variants || 1, meshes: t.main.meshes.length + t.main.named.length + t.parts.reduce((a, p) => a + p.meshes.length + p.named.length, 0), size: t.size };
}

// ===========================================================================
// Atlas regions (drawn once, on first use)
// ===========================================================================
region('stain', 128, 128, (ctx, w, h, rng) => {
  blobStains(ctx, w, h, rng, 2, ['95,62,28', '110,75,35'], { center: 24, rMin: 22, rMax: 38 });
});
region('waterstain', 256, 256, (ctx, w, h, rng) => {
  blobStains(ctx, w, h, rng, 3, ['150,105,45', '125,85,40'], { center: 60, rMin: 45, rMax: 78 });
});
region('asset_tag', 128, 48, (ctx, w, h, rng) => {
  ctx.fillStyle = '#c9cccf'; rrect(ctx, 1, 1, w - 2, h - 2, 6); ctx.fill();
  ctx.strokeStyle = '#8a8d90'; ctx.lineWidth = 2; ctx.stroke();
  txt(ctx, 'ROOM CORP PROPERTY', w / 2, 10, 10, '#222');
  barcode(ctx, 14, 17, w - 28, 18, rng);
  txt(ctx, `No. ${1000 + Math.floor(rng.next() * 8999)}`, w / 2, 41, 9, '#222', { fam: 'mono' });
});
// --- cardboard box prints ---
region('box_files', 256, 128, (ctx, w, h, rng) => {
  marker(ctx, 'FILES', w / 2, 44, 58, 'rgba(20,20,25,0.9)', rng);
  marker(ctx, '1993', w / 2, 98, 52, 'rgba(20,20,25,0.9)', rng);
  ctx.strokeStyle = 'rgba(20,20,25,0.85)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(40, 124); ctx.quadraticCurveTo(128, 116, 216, 122); ctx.stroke();
});
region('box_donotopen', 256, 128, (ctx, w, h, rng) => {
  ctx.strokeStyle = 'rgba(170,25,20,0.9)'; ctx.lineWidth = 7; rrect(ctx, 10, 10, w - 20, h - 20, 8); ctx.stroke();
  txt(ctx, 'DO NOT', w / 2, 44, 44, 'rgba(170,25,20,0.92)', { fam: 'mono' });
  txt(ctx, 'OPEN', w / 2, 88, 50, 'rgba(170,25,20,0.92)', { fam: 'mono' });
  grunge(ctx, w, h, rng, 700, 1, 3);
});
region('box_roomcorp', 256, 160, (ctx, w, h, rng) => {
  logo(ctx, 52, 64, 64, 'rgba(25,30,45,0.85)');
  txt(ctx, 'ROOM', 168, 44, 44, 'rgba(25,30,45,0.85)');
  txt(ctx, 'CORP.', 168, 86, 40, 'rgba(25,30,45,0.85)');
  txt(ctx, 'SUPPLY DIVISION  ·  LEVEL 0', w / 2, 132, 15, 'rgba(25,30,45,0.8)', { fam: 'mono' });
  grunge(ctx, w, h, rng, 400, 0.8, 2);
});
region('box_arrows', 128, 128, (ctx, w, h, rng) => {
  ctx.fillStyle = 'rgba(25,30,45,0.85)';
  for (const x of [38, 90]) { ctx.beginPath(); ctx.moveTo(x, 14); ctx.lineTo(x + 20, 44); ctx.lineTo(x + 8, 44); ctx.lineTo(x + 8, 84); ctx.lineTo(x - 8, 84); ctx.lineTo(x - 8, 44); ctx.lineTo(x - 20, 44); ctx.closePath(); ctx.fill(); }
  ctx.fillRect(14, 92, 100, 5);
  txt(ctx, 'THIS SIDE UP', w / 2, 112, 15, 'rgba(25,30,45,0.85)');
  grunge(ctx, w, h, rng, 200, 0.8, 2);
});
region('box_fragile', 256, 112, (ctx, w, h, rng) => {
  ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(-0.06);
  ctx.strokeStyle = 'rgba(185,30,25,0.9)'; ctx.lineWidth = 6; ctx.strokeRect(-112, -38, 224, 76);
  txt(ctx, 'FRAGILE', 30, 0, 38, 'rgba(185,30,25,0.9)');
  // broken glass icon
  ctx.strokeStyle = 'rgba(185,30,25,0.9)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(-100, -26); ctx.lineTo(-72, -26); ctx.lineTo(-77, 4); ctx.lineTo(-95, 4); ctx.closePath(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-86, 4); ctx.lineTo(-86, 24); ctx.moveTo(-96, 26); ctx.lineTo(-76, 26); ctx.moveTo(-90, -26); ctx.lineTo(-84, -14); ctx.lineTo(-90, -6); ctx.stroke();
  ctx.restore();
  grunge(ctx, w, h, rng, 500, 1, 2.5);
});
region('box_label', 192, 128, (ctx, w, h, rng) => {
  ctx.fillStyle = '#f3f0e6'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.strokeRect(4, 4, w - 8, h - 8);
  txt(ctx, 'FROM: ROOM CORP. — RECEIVING', 10, 18, 11, '#222', { align: 'left', fam: 'mono' });
  txt(ctx, 'TO:   DEPT. ____  LEVEL 0', 10, 36, 11, '#222', { align: 'left', fam: 'mono' });
  ctx.fillRect(8, 46, w - 16, 2);
  barcode(ctx, 14, 56, w - 28, 40, rng);
  txt(ctx, `PKG ${Math.floor(rng.next() * 900000 + 100000)}  WT 4.2LB`, w / 2, 110, 12, '#222', { fam: 'mono' });
  ctx.fillStyle = 'rgba(120,90,40,0.15)'; ctx.fillRect(0, 0, w, h);
});
region('box_misc', 256, 128, (ctx, w, h, rng) => {
  marker(ctx, 'KITCHEN', w / 2, 30, 34, 'rgba(20,20,25,0.85)', rng);
  ctx.strokeStyle = 'rgba(20,20,25,0.9)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(52, 34); ctx.lineTo(208, 24); ctx.moveTo(56, 22); ctx.lineTo(204, 36); ctx.stroke();
  marker(ctx, 'MISC. ACCT.', w / 2, 82, 42, 'rgba(15,30,110,0.9)', rng);
  marker(ctx, '— Dale', 178, 116, 22, 'rgba(15,30,110,0.9)', rng);
});
region('box_records', 256, 128, (ctx, w, h, rng) => {
  ctx.fillStyle = 'rgba(245,242,232,0.95)'; ctx.fillRect(6, 6, w - 12, h - 12);
  ctx.strokeStyle = '#2a3550'; ctx.lineWidth = 3; ctx.strokeRect(6, 6, w - 12, h - 12);
  txt(ctx, 'RECORDS STORAGE', w / 2, 26, 20, '#2a3550');
  ctx.fillStyle = '#2a3550';
  for (const [i, l] of ['DEPT.', 'CONTENTS', 'YEARS'].entries()) { txt(ctx, l, 16, 54 + i * 26, 12, '#2a3550', { align: 'left', fam: 'mono' }); ctx.fillRect(86, 60 + i * 26, 156, 1.5); }
  marker(ctx, 'ACCOUNTS', 160, 50, 20, 'rgba(20,20,25,0.85)', rng);
  marker(ctx, 'LEDGERS / MEMOS', 166, 76, 17, 'rgba(20,20,25,0.85)', rng);
  marker(ctx, '1991 – 1994', 160, 102, 19, 'rgba(20,20,25,0.85)', rng);
});
region('box_handhole', 64, 32, (ctx, w, h) => {
  ctx.fillStyle = 'rgba(25,15,8,0.95)'; rrect(ctx, 4, 6, w - 8, h - 12, 9); ctx.fill();
  ctx.strokeStyle = 'rgba(120,90,55,0.8)'; ctx.lineWidth = 2; ctx.stroke();
});
region('crt_badge', 160, 40, (ctx, w, h) => {
  txt(ctx, 'ROOMVISION', w / 2, 16, 18, '#5a5446', { fam: 'sans' });
  txt(ctx, 'SVGA 14"  MODEL 1493', w / 2, 32, 9, '#6a6455', { fam: 'mono' });
});
region('vents', 128, 64, (ctx, w, h) => {
  ctx.fillStyle = 'rgba(25,22,18,0.85)';
  for (let y = 4; y < h - 4; y += 9) for (let x = 6; x < w - 6; x += 20) rrect(ctx, x, y, 15, 4, 2), ctx.fill();
});

// ===========================================================================
// Seating
// ===========================================================================
def('chair_wood', {
  variants: 3,
  mats: (o, v) => ({ seat: tint('fabric_green', o.color ?? (v === 1 ? 0x22544f : 0x285f59)) }),
  build(b, v) {
    const wood = v === 2 ? 'wood_dark' : 'wood';
    const R = 0.0135;
    const fx = 0.215, fz = 0.18, rx0 = 0.205, rz0 = -0.17, yS = 0.4;
    const FL = [], RL = [];
    for (const s of [-1, 1]) {
      const top = [s * fx, yS, fz], foot = [s * (fx + 0.05), 0, fz + 0.035];
      cylBetween(b, wood, foot, top, 0.0115, R, 8);
      b.cyl('#2a2420', 0.012, 0.012, 0.006, foot[0], 0.003, foot[2], 0, 0, 0, 8);
      FL.push([foot, top]);
      // rear leg + back post, one bent piece
      const pts = [[s * 0.255, 0, -0.245], [s * rx0, yS, rz0], [s * 0.19, 0.47, -0.185], [s * 0.19, 0.865, -0.266]];
      b.tube(wood, pts, R, { radial: 8, round: 0.06 });
      b.cyl('#2a2420', 0.012, 0.012, 0.006, s * 0.255, 0.003, -0.245, 0, 0, 0, 8);
      RL.push([pts[0], pts[1]]);
      // side rail
      b.rbox(wood, 0.02, 0.035, 0.34, 0.004, s * 0.2, yS - 0.017, 0.005);
    }
    b.rbox(wood, 0.40, 0.035, 0.02, 0.004, 0, yS - 0.017, fz);
    b.rbox(wood, 0.39, 0.035, 0.02, 0.004, 0, yS - 0.017, rz0);
    // plywood deck + cushion with piping
    b.box(wood, 0.38, 0.01, 0.36, 0, yS + 0.005, 0.005);
    b.rbox('seat', 0.38, 0.05, 0.37, 0.02, 0, yS + 0.032, 0.005, 0, 0, 0, 2);
    const pr = [];
    for (const [x, z] of [[-0.186, -0.176], [0.186, -0.176], [0.186, 0.186], [-0.186, 0.186]]) pr.push([x, yS + 0.04, z]);
    b.tube('seat', pr, 0.0045, { radial: 6, round: 0.02, closed: true, rseg: 3 });
    // back: top rail, lower rail, padded panel
    const tilt = -0.202;
    const pz = (y) => -0.185 - 0.205 * (y - 0.47);
    b.rbox(wood, 0.38, 0.055, 0.024, 0.008, 0, 0.83, pz(0.83), tilt);
    b.rbox(wood, 0.36, 0.03, 0.02, 0.006, 0, 0.555, pz(0.555), tilt);
    b.box(wood, 0.345, 0.22, 0.01, 0, 0.685, pz(0.685) - 0.004, tilt);
    b.rbox('seat', 0.335, 0.2, 0.03, 0.012, 0, 0.685, pz(0.685) + 0.014, tilt, 0, 0, 2);
    if (v === 1) b.decal('stain', 0.16, 0.14, 0.05, yS + 0.0575, 0.03, -HP, 0, 0.6);
    // tiny brass number plate on the back rail
    b.box('brass', 0.03, 0.012, 0.002, 0, 0.83, pz(0.83) - 0.013, tilt);
    return {
      colliders: [
        CB(0.44, 0.09, 0.40, 0, 0.41, 0.005),
        CB(0.36, 0.34, 0.04, 0, 0.7, -0.232, tilt),
        CCbetween(FL[0][0], FL[0][1], 0.012), CCbetween(FL[1][0], FL[1][1], 0.012),
        CCbetween(RL[0][0], RL[0][1], 0.012), CCbetween(RL[1][0], RL[1][1], 0.012),
      ],
      mass: 6.5, material: 'wood', breakInto: ['plank', 'plank', 'fabric', 'screws'],
      anchors: { seat: [0, yS + 0.06, 0.02], back: [0, 0.69, -0.2] },
      stackOffset: [0, 0.09, -0.035],
    };
  },
});

function taperGeo(g, axis, from, to, fn) {
  // fn(t, pos) mutates a vertex given t along axis in [0,1]
  const p = g.attributes.position;
  const a = ['x', 'y', 'z'][axis];
  for (let i = 0; i < p.count; i++) {
    const v = { x: p.getX(i), y: p.getY(i), z: p.getZ(i) };
    const t = clamp((v[a] - from) / (to - from), 0, 1);
    fn(t, v);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

function casterAt(b, x, z, legY, yaw) {
  b.cyl('chrome', 0.005, 0.005, legY - 0.06, x, (legY + 0.06) / 2, z, 0, 0, 0, 6);
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  b.rbox('plastic_black', 0.034, 0.03, 0.05, 0.008, x, 0.052, z, 0, yaw, 0);
  for (const s of [-1, 1]) {
    b.cyl('#1c1c1e', 0.024, 0.024, 0.013, x + ca * s * 0.011, 0.025, z - sa * s * 0.011, 0, yaw, HP, 12);
  }
  b.cyl('chrome', 0.006, 0.006, 0.04, x, 0.025, z, 0, yaw, HP, 6);
}

def('chair_office', {
  variants: 2,
  mats: (o, v) => ({ seat: tint('fabric_blue', o.color ?? (v ? 0x5b5249 : 0x3b4658)) }),
  build(b, v) {
    // 5-star base
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.3;
      const ca = Math.cos(a), sa = Math.sin(a);
      const g = taperGeo(new RoundedBoxGeometry(0.28, 0.045, 0.05, 1, 0.012), 0, -0.14, 0.14, (t, p) => { p.y *= 1 - 0.35 * t; p.z *= 1 - 0.3 * t; p.y -= t * 0.018; });
      b.add('plastic_black', g, ca * 0.175, 0.11, sa * 0.175, 0, -a, 0);
      casterAt(b, ca * 0.31, sa * 0.31, 0.095, a + i);
    }
    b.cyl('plastic_black', 0.05, 0.055, 0.07, 0, 0.11, 0, 0, 0, 0, 14);
    b.lathe('plastic_black', [[0.031, 0.14], [0.031, 0.19], [0.034, 0.195], [0.031, 0.2], [0.031, 0.25], [0.034, 0.255], [0.031, 0.26], [0.03, 0.33, 1], [0.02, 0.333], [0, 0.333]], 0, 0, 0, 0, 0, 0, 14);
    // rotating seat assembly
    const p = b.part('seat', 0, 0.33, 0, { axis: 'y', spin: true });
    p.cyl('chrome', 0.0145, 0.0145, 0.08, 0, 0.37, 0, 0, 0, 0, 10);
    p.rbox('paint_black', 0.2, 0.035, 0.24, 0.008, 0, 0.415, 0.0);
    p.cyl('plastic_black', 0.018, 0.018, 0.03, 0, 0.415, 0.13, HP, 0, 0, 10);
    p.tube('chrome', [[0.08, 0.41, 0.05], [0.2, 0.41, 0.07], [0.235, 0.405, 0.1]], 0.004, { radial: 5, round: 0.03 });
    p.sph('plastic_black', 0.011, 0.24, 0.405, 0.105, 8, 6);
    p.rbox('plastic_black', 0.47, 0.025, 0.45, 0.01, 0, 0.445, 0.0);
    p.rbox('seat', 0.49, 0.075, 0.47, 0.034, 0, 0.49, 0.0, 0, 0, 0, 2);
    // back bar + back
    p.rbox('paint_black', 0.06, 0.022, 0.2, 0.006, 0, 0.42, -0.19);
    boxBetween(p, 'paint_black', [0, 0.41, -0.285], [0, 0.66, -0.3], 0.06, 0.022, 0.006);
    p.rbox('plastic_black', 0.42, 0.46, 0.03, 0.03, 0, 0.81, -0.315, -0.12);
    p.rbox('seat', 0.44, 0.48, 0.075, 0.035, 0, 0.81, -0.287, -0.12, 0, 0, 2);
    p.decal('asset_tag', 0.07, 0.026, 0, 0.66, -0.333, -0.12, PI, 0);
    // armrests
    for (const s of [-1, 1]) {
      p.rbox('paint_black', 0.16, 0.02, 0.05, 0.005, s * 0.19, 0.425, 0.0);
      p.rbox('plastic_black', 0.03, 0.25, 0.055, 0.008, s * 0.265, 0.55, 0.0);
      p.rbox('plastic_black', 0.075, 0.032, 0.26, 0.014, s * 0.265, 0.685, 0.015, 0, 0, 0, 2);
    }
    return {
      colliders: [
        CC(0.3, 0.1, 0, 0.05, 0), CC(0.032, 0.25, 0, 0.23, 0),
        CB(0.49, 0.1, 0.47, 0, 0.47, 0), CB(0.44, 0.48, 0.08, 0, 0.81, -0.29, -0.12),
        CB(0.075, 0.27, 0.26, -0.265, 0.565, 0.015), CB(0.075, 0.27, 0.26, 0.265, 0.565, 0.015),
      ],
      mass: 15, material: 'plastic', breakInto: ['metal_scrap', 'fabric', 'foam', 'screws', 'wheel'],
      anchors: { seat: [0, 0.53, 0.03] },
    };
  },
});

function bentPanel(w, h, d, bend, segs = 8) {
  const g = new THREE.BoxGeometry(w, h, d, segs, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, p.getZ(i) + bend * (x / (w / 2)) ** 2); }
  g.computeVertexNormals();
  return g;
}

def('chair_folding', {
  variants: 3,
  mats: (o, v) => ({ frame: tint('paint_beige', o.color ?? [0xc4b896, 0x7c8084, 0x5b4636][v]) }),
  build(b) {
    const r = 0.011, F = [], Rl = [];
    for (const s of [-1, 1]) {
      const foot = [s * 0.205, 0.012, 0.215], seatB = [s * 0.2, 0.46, -0.11], top = [s * 0.19, 0.825, -0.2];
      b.tube('frame', [foot, seatB, top], r, { radial: 8, round: 0.08, rseg: 5 });
      const rf = [s * 0.183, 0.012, -0.25], rt = [s * 0.183, 0.452, 0.17];
      b.tube('frame', [rf, rt], r, { radial: 8 });
      cylBetween(b, 'rubber', [foot[0], 0, foot[2] + 0.008], foot, 0.0135, 0.0135, 8);
      cylBetween(b, 'rubber', [rf[0], 0, rf[2] - 0.011], rf, 0.0135, 0.0135, 8);
      // rivets at the X crossing and seat pivot
      b.cyl('chrome', 0.007, 0.007, 0.05, s * 0.194, 0.284, 0.015, 0, 0, HP, 8);
      b.cyl('chrome', 0.006, 0.006, 0.03, s * 0.19, 0.452, 0.17, 0, 0, HP, 8);
      F.push([foot, seatB]); Rl.push([rf, rt]);
      // seat side channel
      b.rbox('frame', 0.012, 0.022, 0.37, 0.004, s * 0.188, 0.447, 0.03);
    }
    b.cyl('frame', 0.009, 0.009, 0.41, 0, 0.1, 0.215 - 0.7065 * 0.088, 0, 0, HP, 8);
    b.cyl('frame', 0.009, 0.009, 0.366, 0, 0.08, -0.25 + 0.9333 * 0.068, 0, 0, HP, 8);
    b.cyl('frame', 0.009, 0.009, 0.366, 0, 0.452, 0.17, 0, 0, HP, 8);
    b.rbox('frame', 0.405, 0.022, 0.39, 0.009, 0, 0.465, 0.03, 0, 0, 0, 2);
    b.rbox('frame', 0.35, 0.004, 0.33, 0.002, 0, 0.4775, 0.03);
    b.add('frame', bentPanel(0.37, 0.13, 0.012, 0.025), 0, 0.735, -0.195, -0.245);
    b.decal('asset_tag', 0.06, 0.022, 0, 0.44, 0.0, HP, 0, 0);
    return {
      colliders: [
        CB(0.4, 0.03, 0.39, 0, 0.465, 0.03), CB(0.36, 0.14, 0.02, 0, 0.735, -0.19, -0.245),
        CCbetween(F[0][0], F[0][1], r), CCbetween(F[1][0], F[1][1], r), CCbetween(Rl[0][0], Rl[0][1], r), CCbetween(Rl[1][0], Rl[1][1], r),
      ],
      mass: 3.6, material: 'metal', breakInto: ['metal_tube', 'metal_tube', 'screws'],
      anchors: { seat: [0, 0.49, 0.03] },
    };
  },
});

def('stool', {
  variants: 2,
  mats: (o, v) => ({ cushion: tint('plastic_red', o.color ?? (v ? 0x2a2a2c : 0x8e2622), { roughness: 0.75 }) }),
  build(b) {
    b.lathe('cushion', [[0, 0.6], [0.165, 0.6], [0.18, 0.607], [0.187, 0.632], [0.181, 0.656], [0.163, 0.667], [0.09, 0.67], [0, 0.671]], 0, 0, 0, 0, 0, 0, 24);
    b.tor('#1d1b1a', 0.187, 0.0035, 0, 0.632, 0, HP, 0, 0, 5, 32);
    b.cyl('paint_dark', 0.15, 0.15, 0.02, 0, 0.59, 0, 0, 0, 0, 16);
    const L = [];
    for (let i = 0; i < 4; i++) {
      const a = PI / 4 + (i * PI) / 2, ca = Math.cos(a), sa = Math.sin(a);
      const top = [ca * 0.12, 0.59, sa * 0.12], foot = [ca * 0.215, 0.012, sa * 0.215];
      b.tube('chrome', [top, foot], 0.012, { radial: 8 });
      cylBetween(b, 'rubber', [foot[0], 0, foot[2]], [foot[0] * 0.995, 0.03, foot[2] * 0.995], 0.0145, 0.0135, 8);
      L.push([top, foot]);
    }
    b.tor('chrome', 0.19, 0.008, 0, 0.22, 0, HP, 0, 0, 6, 32);
    return {
      colliders: [CC(0.185, 0.07, 0, 0.635, 0), ...L.map(([a, c]) => CCbetween(a, c, 0.012))],
      mass: 4.2, material: 'metal', breakInto: ['metal_tube', 'foam', 'screws'],
      anchors: { seat: [0, 0.67, 0], top: [0, 0.67, 0] },
    };
  },
});

// ===========================================================================
// Cardboard boxes
// ===========================================================================
const BOX_LOOKS = [
  [['box_files', 'F', 0.75], ['box_files', 'R', 0.55]],
  [['box_donotopen', 'F', 0.7], ['box_donotopen', 'T', 0.5]],
  [['box_roomcorp', 'F', 0.7], ['box_arrows', 'R', 0.38], ['box_label', 'TL', 0.42]],
  [['box_fragile', 'F', 0.72], ['box_roomcorp', 'R', 0.6], ['box_arrows', 'L', 0.38]],
  [['box_misc', 'F', 0.72], ['box_label', 'R', 0.45]],
  [['box_records', 'F', 0.66], ['box_roomcorp', 'B', 0.6]],
];
function cardboardBox(b, v, w, h, d, big) {
  const e = 0.004;
  b.rbox('kraft', w, h - e, d, 0.004, 0, (h - e) / 2, 0);
  // two outer flaps meeting at a seam along X, slightly domed
  for (const s of [-1, 1]) b.box('kraft', w - 0.003, 0.004, d / 2 - 0.002, 0, h - 0.004, s * (d / 4 + 0.001), s * 0.012);
  // packing tape over the seam and down both ends
  const tw = Math.min(0.05, d * 0.2), drop = Math.min(0.08, h * 0.35);
  b.box('tape', w + 0.004, 0.0006, tw, 0, h + 0.0002, 0);
  for (const s of [-1, 1]) b.box('tape', 0.0006, drop, tw, s * (w / 2 + 0.0012), h - drop / 2, 0);
  const looks = BOX_LOOKS[v % BOX_LOOKS.length];
  for (const [reg, face, frac] of looks) {
    const R = REG[reg];
    const asp = R.h / R.w;
    if (face === 'F' || face === 'B') {
      let dw = w * frac, dh = dw * asp;
      if (dh > (h - 0.02) * 0.8) { dh = (h - 0.02) * 0.8; dw = dh / asp; }
      b.decal(reg, dw, dh, 0, h * 0.48, (face === 'F' ? 1 : -1) * (d / 2 + 0.0008), 0, face === 'F' ? 0 : PI, 0);
    } else if (face === 'R' || face === 'L') {
      let dw = d * frac, dh = dw * asp;
      if (dh > (h - drop - 0.02) * 0.9) { dh = (h - drop - 0.02) * 0.9; dw = dh / asp; }
      b.decal(reg, dw, dh, (face === 'R' ? 1 : -1) * (w / 2 + 0.0008), (h - drop) * 0.48, 0, 0, face === 'R' ? HP : -HP, 0);
    } else if (face === 'T' || face === 'TL') {
      const dw = Math.min(w * frac, w / 2 - tw), dh = Math.min(dw * asp, d / 2 - tw / 2 - 0.01);
      b.decal(reg, dh / asp, dh, face === 'T' ? -w / 4 : w / 4, h + 0.0008, face === 'T' ? d / 4 : -d / 4, -HP, 0, face === 'T' ? 0.05 : -0.08);
    }
  }
  if (big) for (const s of [-1, 1]) b.decal('box_handhole', 0.11, 0.04, s * (w / 2 + 0.0009), h - 0.1, 0, 0, s * HP, 0);
}
for (const [key, w, h, d, mass, big] of [['box_small', 0.3, 0.22, 0.24, 1.6, false], ['box_medium', 0.46, 0.32, 0.34, 3.5, false], ['box_large', 0.6, 0.44, 0.45, 6, true]]) {
  def(key, {
    variants: 6,
    build(b, v) {
      cardboardBox(b, v, w, h, d, big);
      return { colliders: [CB(w, h, d, 0, h / 2, 0)], mass, material: 'cardboard', breakInto: v === 0 || v === 5 ? ['cardboard', 'paper', 'paper'] : ['cardboard', 'tape'], anchors: { top: [0, h, 0] } };
    },
  });
}

// ===========================================================================
// Electronics
// ===========================================================================
function crtScreenGeo(w, h, R, segX = 10, segY = 8) {
  const g = new THREE.PlaneGeometry(w, h, segX, segY);
  const p = g.attributes.position;
  const z0 = Math.sqrt(R * R - (w / 2) ** 2 - (h / 2) ** 2);
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, Math.sqrt(R * R - x * x - y * y) - z0); }
  g.computeVertexNormals();
  return g;
}
function taperBox(w, h, d, sx, sy, r = 0.01, keepBottom = true) {
  const g = new RoundedBoxGeometry(w, h, d, 1, r);
  return taperGeo(g, 2, d / 2, -d / 2, (t, p) => {
    p.x *= lerp(1, sx, t);
    p.y = keepBottom ? -h / 2 + (p.y + h / 2) * lerp(1, sy, t) : p.y * lerp(1, sy, t);
  });
}

def('crt_monitor', {
  variants: 2,
  build(b, v) {
    const beige = 'plastic_beige';
    const yb = 0.035, H = 0.345, W = 0.36, yc = yb + H / 2;
    // base + neck
    b.lathe(beige, [[0, 0], [0.12, 0], [0.13, 0.006], [0.125, 0.018], [0.09, 0.024], [0, 0.026]], 0, 0, 0.01, 0, 0, 0, 20);
    b.rbox(beige, 0.12, 0.03, 0.15, 0.01, 0, 0.032, 0.01);
    // bezel + tapered tube housing
    b.rbox(beige, W, H, 0.065, 0.016, 0, yc, 0.148, 0, 0, 0, 2);
    b.add(beige, taperBox(0.33, 0.3, 0.31, 0.62, 0.68, 0.02), 0, yb + 0.155, -0.03);
    b.rbox('#d6ccb0', 0.30, 0.235, 0.004, 0.01, 0, 0.235 + 0.01, 0.181);
    b.rbox('#2a2723', 0.29, 0.222, 0.004, 0.008, 0, 0.245, 0.1825);
    b.named('screen', 'crt_glass', crtScreenGeo(0.278, 0.208, 1.0), 0, 0.245, 0.1795, 0, 0, 0, { uv: 'keep' });
    // controls
    b.rbox('#b9ae92', 0.026, 0.014, 0.008, 0.003, 0.135, 0.065, 0.182);
    b.box('emissive_green', 0.005, 0.005, 0.003, 0.108, 0.065, 0.181);
    for (let i = 0; i < 4; i++) b.rbox('#b9ae92', 0.012, 0.008, 0.006, 0.002, -0.15 + i * 0.018, 0.064, 0.181);
    b.decal('crt_badge', 0.1, 0.025, 0, 0.068, 0.1813);
    b.decal('vents', 0.2, 0.09, 0, yb + 0.29, -0.07, -(HP + 0.27), 0, 0);
    for (const s of [-1, 1]) b.decal('vents', 0.16, 0.06, s * 0.137, 0.2, -0.05, 0, s * (HP + 0.17), 0);
    b.tube('plastic_black', [[0.03, 0.12, -0.17], [0.035, 0.09, -0.2], [0.045, 0.05, -0.215]], 0.006, { radial: 6, round: 0.02 });
    if (v === 1) b.decal('asset_tag', 0.06, 0.022, -0.12, 0.36, 0.1813);
    return {
      colliders: [CB(W, H, 0.065, 0, yc, 0.148), CB(0.21, 0.2, 0.3, 0, yb + 0.105, -0.03), CC(0.12, 0.035, 0, 0.0175, 0.01)],
      mass: 12, material: 'plastic', breakInto: ['glass_shard', 'electronics', 'plastic_scrap', 'wire'],
      anchors: { screen: [0, 0.245, 0.195], top: [0, yb + H, 0.05] },
    };
  },
});

// ===========================================================================
// Tables, desks, office furniture
// ===========================================================================
region('memo', 192, 256, (ctx, w, h, rng) => {
  noiseFill(ctx, w, h, rng, '#f2efe4', 300, 0.04);
  txt(ctx, 'MEMORANDUM', w / 2, 22, 18, '#1a1a1a', { fam: 'serif' });
  ctx.fillStyle = '#222'; ctx.fillRect(14, 34, w - 28, 2);
  ['TO:   ALL STAFF', 'FROM: FACILITIES', 'RE:   EXITS'].forEach((s, i) => txt(ctx, s, 14, 50 + i * 15, 10, '#222', { align: 'left', fam: 'mono', weight: 'normal' }));
  lines(ctx, 14, 100, w - 28, 9, 13, rng, 'rgba(30,30,40,0.7)', 2);
  ctx.fillStyle = 'rgba(160,120,50,0.12)'; ctx.beginPath(); ctx.arc(w * 0.7, h * 0.8, 26, 0, TAU); ctx.fill();
});
region('sticky', 96, 96, (ctx, w, h, rng) => {
  ctx.fillStyle = '#f3e26a'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.fillRect(0, 0, w, 10);
  marker(ctx, 'ext. 4471', w / 2, 34, 17, 'rgba(20,30,120,0.9)', rng, { weight: 'normal' });
  marker(ctx, "don't use", w / 2, 58, 15, 'rgba(20,30,120,0.9)', rng, { weight: 'normal' });
  marker(ctx, 'stairwell B', w / 2, 76, 15, 'rgba(20,30,120,0.9)', rng, { weight: 'normal' });
});
region('calendar', 160, 224, (ctx, w, h, rng) => {
  ctx.fillStyle = '#f4f1e8'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#3d5a80'; ctx.fillRect(0, 0, w, 70);
  logo(ctx, 26, 35, 30, '#e8e2d0');
  txt(ctx, 'ROOM CORP', 96, 28, 16, '#e8e2d0');
  txt(ctx, '1993', 96, 50, 14, '#e8e2d0');
  txt(ctx, 'OCTOBER', w / 2, 86, 15, '#222');
  for (let r = 0; r < 5; r++) for (let c = 0; c < 7; c++) {
    const d = r * 7 + c - 4;
    ctx.strokeStyle = '#bbb'; ctx.lineWidth = 1; ctx.strokeRect(6 + c * 21, 98 + r * 24, 21, 24);
    if (d > 0 && d <= 31) txt(ctx, String(d), 9 + c * 21, 105 + r * 24, 8, c === 0 ? '#a33' : '#333', { align: 'left', weight: 'normal' });
  }
  for (let d = 5; d < 31; d++) if (rng.next() < 0.7) { const r = Math.floor((d + 4) / 7), c = (d + 4) % 7; ctx.strokeStyle = 'rgba(180,20,20,0.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(8 + c * 21, 100 + r * 24); ctx.lineTo(25 + c * 21, 120 + r * 24); ctx.stroke(); }
});
region('fc_label', 384, 96, (ctx, w, h, rng) => {
  const L = ['A – F', 'PERSONNEL', '1991–1993', 'MISC.', 'CLAIMS', 'DO NOT FILE'];
  for (let i = 0; i < 6; i++) {
    const x = (i % 3) * 128, y = Math.floor(i / 3) * 48;
    ctx.fillStyle = i === 5 ? '#e9d9b0' : '#efe9d8'; ctx.fillRect(x, y, 128, 48);
    ctx.fillStyle = 'rgba(80,60,30,0.10)'; ctx.fillRect(x, y + 36, 128, 12);
    txt(ctx, L[i], x + 64, y + 24, L[i].length > 9 ? 15 : 19, '#1e1e24', { fam: 'mono' });
  }
});
region('spines', 512, 256, (ctx, w, h, rng) => {
  for (let i = 0; i < 32; i++) {
    const x = (i % 16) * 32, y = Math.floor(i / 16) * 128, col = SPINE_COLS[i];
    ctx.fillStyle = col; ctx.fillRect(x, y, 32, 128);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x, y, 3, 128); ctx.fillRect(x + 29, y, 3, 128);
    const gold = rng.next() > 0.5 ? '#d8bf6a' : '#ece6d4';
    ctx.fillStyle = gold;
    const k = i % 4;
    if (k !== 3) { ctx.fillRect(x + 4, y + 10, 24, 2); ctx.fillRect(x + 4, y + 116, 24, 2); }
    if (k === 1) { ctx.fillRect(x + 4, y + 14, 24, 2); ctx.fillRect(x + 4, y + 112, 24, 2); }
    if (k === 2) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x + 4, y + 22, 24, 30); ctx.fillStyle = gold; }
    for (let j = 0; j < 3 + Math.floor(rng.next() * 4); j++) ctx.fillRect(x + 13 + (rng.next() - 0.5) * 3, y + 26 + j * 9, 6, 6);
    ctx.fillRect(x + 9, y + 96, 14, 5);
  }
});
region('binder_spines', 256, 192, (ctx, w, h, rng) => {
  const L = ['Q3 REPORTS', 'PERSONNEL', 'BUDGET 1993', 'MEMOS'];
  for (let i = 0; i < 4; i++) {
    const x = i * 64;
    ctx.fillStyle = BINDER_COLS[i]; ctx.fillRect(x, 0, 64, 192);
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x + 4, 0, 8, 192);
    ctx.fillStyle = '#ecebe4'; ctx.fillRect(x + 10, 20, 44, 112);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; ctx.strokeRect(x + 10, 20, 44, 112);
    ctx.save(); ctx.translate(x + 32, 76); ctx.rotate(-HP); txt(ctx, L[i], 0, 0, 14, '#1a1a2a', { fam: 'mono', maxW: 104 }); ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.beginPath(); ctx.arc(x + 32, 160, 12, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(200,200,200,0.5)'; ctx.lineWidth = 2; ctx.stroke();
  }
});
const SPINE_COLS = ['#6e1f1f', '#1f3a5f', '#2d4a2b', '#5a3d1e', '#1d1d22', '#7a6a3a', '#4b2d4d', '#8a4a23', '#2f5d62', '#b8ad8e', '#33333a', '#6b2a3c', '#405d7a', '#a2462b', '#24433f', '#7d7660',
  '#3a2618', '#9b8a5a', '#503030', '#21304a', '#5e6b3a', '#8c2f2f', '#2b2b2b', '#c4b48a', '#4a5a6a', '#6a4a7a', '#7a3a1a', '#1f5040', '#5a5a5a', '#943c2a', '#384838', '#8a7a6a'];
const BINDER_COLS = ['#1d2c4d', '#1c1c1e', '#5e1d22', '#1f4030'];

def('table_folding', {
  variants: 2,
  build(b, v) {
    const W = 1.52, D = 0.76, H = 0.74, T = 0.032;
    const top = v ? 'plastic_beige' : 'oak';
    b.box(top, W - 0.012, T, D - 0.012, 0, H - T / 2, 0);
    for (const s of [-1, 1]) {
      b.rbox('plastic_black', W, T + 0.004, 0.008, 0.003, 0, H - T / 2, s * (D / 2 - 0.004));
      b.rbox('plastic_black', 0.008, T + 0.004, D - 0.012, 0.003, s * (W / 2 - 0.004), H - T / 2, 0);
      b.box('paint_dark', W - 0.14, 0.035, 0.02, 0, H - T - 0.0175, s * (D / 2 - 0.07));
    }
    const yb = H - T - 0.03;
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2 - 0.15);
      b.tube('paint_dark', [[x, 0.012, -0.3], [x, yb, -0.3], [x, yb, 0.3], [x, 0.012, 0.3]], 0.0125, { radial: 8, round: 0.05 });
      b.cyl('paint_dark', 0.009, 0.009, 0.6, x, 0.13, 0, HP, 0, 0, 8);
      for (const z of [-0.3, 0.3]) b.cyl('rubber', 0.015, 0.015, 0.025, x, 0.0125, z, 0, 0, 0, 8);
      boxBetween(b, 'paint_dark', [x, 0.135, 0], [x - sx * 0.42, yb, 0], 0.022, 0.006, 0.002);
      b.box('paint_dark', 0.06, 0.02, 0.05, x - sx * 0.42, yb + 0.01, 0);
      for (const z of [-0.3, 0.3]) b.box('paint_dark', 0.04, 0.02, 0.03, x, yb + 0.01, z);
    }
    b.decal('asset_tag', 0.07, 0.026, 0.3, H - T - 0.0002, 0, HP, 0, 0);
    return {
      colliders: [CB(W, T + 0.004, D, 0, H - T / 2, 0), ...[-1, 1].flatMap((sx) => [-0.3, 0.3].map((z) => CC(0.0125, yb, sx * (W / 2 - 0.15), yb / 2, z)))],
      mass: 16, material: 'wood', breakInto: ['plank', 'metal_tube', 'metal_tube', 'screws'],
      anchors: { top: [0, H, 0] },
    };
  },
});

def('table_round', {
  variants: 2,
  build(b, v) {
    const H = 0.74;
    if (v === 0) {
      b.lathe('oak', [[0, H - 0.03], [0.288, H - 0.03, 1], [0.3, H - 0.022], [0.302, H - 0.012], [0.298, H - 0.004], [0.288, H, 1], [0, H]], 0, 0, 0, 0, 0, 0, 32);
    } else {
      b.cyl('plastic_white', 0.296, 0.296, 0.026, 0, H - 0.013, 0, 0, 0, 0, 32);
      b.cyl('chrome', 0.3, 0.3, 0.03, 0, H - 0.015, 0, 0, 0, 0, 32, true);
    }
    for (let i = 0; i < 4; i++) { const a = (i * PI) / 2 + PI / 4; b.box('paint_black', 0.36, 0.02, 0.03, 0, H - 0.04, 0, 0, a, 0); }
    b.cyl('paint_black', 0.05, 0.05, 0.02, 0, H - 0.04, 0, 0, 0, 0, 16);
    b.cyl('chrome', 0.03, 0.03, H - 0.07, 0, (H - 0.07) / 2 + 0.03, 0, 0, 0, 0, 16);
    b.lathe('paint_black', [[0, 0.004], [0.215, 0.004, 1], [0.222, 0.01], [0.2, 0.024], [0.06, 0.038], [0.035, 0.05], [0.0, 0.05]], 0, 0, 0, 0, 0, 0, 28);
    for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU; b.cyl('rubber', 0.015, 0.015, 0.005, Math.cos(a) * 0.19, 0.0025, Math.sin(a) * 0.19, 0, 0, 0, 8); }
    return {
      colliders: [CC(0.3, 0.03, 0, H - 0.015, 0), CC(0.03, H - 0.08, 0, (H - 0.08) / 2 + 0.05, 0), CC(0.21, 0.05, 0, 0.025, 0)],
      mass: 11, material: 'wood', breakInto: ['plank', 'metal_tube', 'screws'], anchors: { top: [0, H, 0] },
    };
  },
});

def('desk', {
  variants: 2,
  mats: (o, v) => (o.color !== undefined ? { body: tint(v ? 'paint_grey' : 'oak', o.color) } : { body: matFor(v ? 'paint_grey' : 'oak') }),
  build(b, v) {
    const W = 1.5, D = 0.75, H = 0.75, T = 0.03;
    b.rbox('oak', W, T, D, 0.004, 0, H - T / 2, 0);
    if (v === 0) for (const s of [-1, 1]) { b.box('#3a2a1c', W + 0.002, T - 0.004, 0.003, 0, H - T / 2, s * (D / 2 + 0.001)); b.box('#3a2a1c', 0.003, T - 0.004, D, s * (W / 2 + 0.001), H - T / 2, 0); }
    else for (const s of [-1, 1]) { b.box('steel', W + 0.004, T + 0.004, 0.004, 0, H - T / 2, s * (D / 2 + 0.002)); b.box('steel', 0.004, T + 0.004, D, s * (W / 2 + 0.002), H - T / 2, 0); }
    b.cyl('#1a1a1a', 0.03, 0.03, 0.004, -W / 2 + 0.12, H + 0.0005, -D / 2 + 0.1, 0, 0, 0, 16);
    b.cyl('#050505', 0.022, 0.022, 0.005, -W / 2 + 0.12, H + 0.001, -D / 2 + 0.1, 0, 0, 0, 16);
    const yT = H - T;
    b.rbox('body', 0.025, yT, D - 0.04, 0.004, -W / 2 + 0.035, yT / 2, 0);
    b.box('#2a2622', 0.02, 0.012, D - 0.08, -W / 2 + 0.035, 0.006, 0);
    const px = W / 2 - 0.235, pw = 0.43;
    for (const s of [-1, 1]) b.rbox('body', 0.02, yT, D - 0.04, 0.004, px + s * (pw / 2 - 0.01), yT / 2, 0);
    b.box('body', pw - 0.04, yT - 0.02, 0.012, px, yT / 2, -D / 2 + 0.03);
    b.box('#2a2622', pw - 0.04, 0.06, 0.02, px, 0.03, D / 2 - 0.07);
    b.box('#1b1a18', pw - 0.04, yT - 0.08, 0.005, px, yT / 2 + 0.03, D / 2 - 0.08);
    b.box('body', W - pw - 0.08, 0.42, 0.018, (-W / 2 + 0.05 + px - pw / 2) / 2, yT - 0.21, -D / 2 + 0.06);
    // drawers
    const fz = D / 2 - 0.03;
    const hs = [0.12, 0.2, 0.3];
    let yTop = yT - 0.012;
    hs.forEach((h, i) => {
      const cy = yTop - h / 2;
      const p = b.part(`drawer${i}`, px, cy, fz, { axis: 'z', maxOpen: i === 0 ? 0.35 : 0.45 });
      p.rbox('body', pw - 0.045, h - 0.008, 0.022, 0.004, px, cy, fz + 0.011);
      const hy = i === 0 ? cy : cy + h / 2 - 0.05;
      p.cyl('steel', 0.006, 0.006, 0.13, px, hy, fz + 0.04, 0, 0, HP, 8);
      for (const s of [-1, 1]) p.cyl('steel', 0.005, 0.005, 0.02, px + s * 0.055, hy, fz + 0.03, HP, 0, 0, 6);
      if (i === 0) p.cyl('chrome', 0.009, 0.009, 0.01, px + 0.15, cy, fz + 0.025, HP, 0, 0, 12);
      const bd = 0.58, bz = fz - bd / 2;
      for (const s of [-1, 1]) p.box('paint_dark', 0.01, h - 0.04, bd, px + s * (pw / 2 - 0.035), cy - 0.01, bz);
      p.box('paint_dark', pw - 0.07, 0.008, bd, px, cy - h / 2 + 0.014, bz);
      p.box('paint_dark', pw - 0.07, h - 0.04, 0.01, px, cy - 0.01, fz - bd);
      if (i === 0) for (let k = 0; k < 4; k++) p.cyl(['#d9b23a', '#c2412f', '#2f4f8a', '#d9b23a'][k], 0.004, 0.004, 0.17, px - 0.1 + k * 0.02, cy - h / 2 + 0.024, fz - 0.15 - k * 0.03, HP, 0.2 * k, 0, 6);
      if (i === 1) p.box('paper', 0.22, 0.04, 0.28, px, cy - h / 2 + 0.04, fz - 0.25);
      if (i === 2) for (let k = 0; k < 8; k++) { p.box('#d8c48e', pw - 0.1, h - 0.07, 0.003, px, cy - 0.02, fz - 0.06 - k * 0.06); p.box(['#d8c48e', '#9cc0d8', '#d8c48e', '#e0a8a0'][k % 4], 0.05, 0.02, 0.003, px - 0.12 + (k % 3) * 0.1, cy + h / 2 - 0.045, fz - 0.06 - k * 0.06); }
      yTop -= h + 0.008;
    });
    return {
      colliders: [CB(W, T, D, 0, H - T / 2, 0), CB(0.025, yT, D - 0.04, -W / 2 + 0.035, yT / 2, 0), CB(pw, yT, D - 0.04, px, yT / 2, 0), CB(W - pw - 0.08, 0.42, 0.018, (-W / 2 + 0.05 + px - pw / 2) / 2, yT - 0.21, -D / 2 + 0.06)],
      mass: 48, material: v ? 'metal' : 'wood', breakInto: v ? ['metal_scrap', 'metal_scrap', 'plank', 'screws'] : ['plank', 'plank', 'plank', 'screws'],
      anchors: { top: [-0.2, H, -0.05], chair: [-0.25, 0, D / 2 + 0.35] },
    };
  },
});

def('desk_cubicle_panel', {
  variants: 2,
  mats: (o, v) => ({ fab: tint('fabric_grey', o.color ?? (v ? 0x5f6a63 : 0x6c7280), { texRepeat: 6 }) }),
  build(b, v) {
    const W = 1.5, H = 1.5, T = 0.065;
    b.box('fab', W - 0.06, H - 0.1, T - 0.006, 0, 0.07 + (H - 0.1) / 2, 0);
    b.rbox('paint_grey', W, 0.03, T + 0.006, 0.012, 0, H - 0.015, 0, 0, 0, 0, 2);
    for (const s of [-1, 1]) b.rbox('paint_grey', 0.032, H - 0.03, T + 0.006, 0.012, s * (W / 2 - 0.016), (H - 0.03) / 2, 0, 0, 0, 0, 2);
    b.box('paint_dark', W - 0.06, 0.07, T - 0.012, 0, 0.035, 0);
    for (const s of [-1, 1]) {
      b.rbox('paint_dark', 0.05, 0.03, 0.46, 0.008, s * 0.6, 0.015, 0);
      for (const z of [-0.2, 0.2]) b.cyl('rubber', 0.016, 0.016, 0.006, s * 0.6, 0.003, z, 0, 0, 0, 8);
    }
    const fz = T / 2 - 0.002;
    b.decal('memo', 0.21, 0.28, -0.35, 1.08, fz + 0.001, 0, 0, 0.03, { slot: 'atlas' });
    b.decal('calendar', 0.2, 0.28, 0.32, 1.12, fz + 0.001, 0, 0, -0.02, { slot: 'atlas' });
    b.decal('sticky', 0.076, 0.076, -0.15, 0.98, fz + 0.0015, 0, 0, -0.12, { slot: 'atlas' });
    for (const [x, y, c] of [[-0.35, 1.21, '#c0302a'], [0.32, 1.25, '#2f5d9e'], [-0.15, 1.015, '#3f8a4a'], [0.4, 0.99, '#c0302a']]) b.sph(c, 0.007, x, y, fz + 0.006, 8, 6);
    if (v === 1) b.decal('stain', 0.3, 0.25, 0.2, 0.35, fz + 0.001);
    return {
      colliders: [CB(W, H, T + 0.006, 0, H / 2, 0), CB(0.05, 0.03, 0.46, -0.6, 0.015, 0), CB(0.05, 0.03, 0.46, 0.6, 0.015, 0)],
      mass: 34, material: 'fabric', breakInto: ['fabric', 'metal_tube', 'plank', 'screws'],
    };
  },
});

def('filing_cabinet', {
  variants: 3,
  mats: (o, v) => ({ body: tint('paint_beige', o.color ?? [0xc7bc9c, 0x8f9295, 0x6f7462][v]) }),
  build(b, v) {
    const W = 0.38, H = 1.32, D = 0.66;
    for (const s of [-1, 1]) b.rbox('body', 0.012, H - 0.012, D, 0.004, s * (W / 2 - 0.006), (H - 0.012) / 2, 0);
    b.rbox('body', W + 0.004, 0.014, D + 0.004, 0.005, 0, H - 0.007, 0);
    b.box('body', W - 0.024, H - 0.02, 0.008, 0, H / 2, -D / 2 + 0.004);
    b.box('#141414', W - 0.024, H - 0.06, 0.004, 0, H / 2 + 0.02, D / 2 - 0.04);
    b.box('body', W - 0.024, 0.026, 0.02, 0, H - 0.027, D / 2 - 0.01);
    b.box('paint_dark', W - 0.03, 0.055, 0.02, 0, 0.0275, D / 2 - 0.04);
    b.cyl('chrome', 0.011, 0.011, 0.008, W / 2 - 0.05, H - 0.027, D / 2 + 0.003, HP, 0, 0, 12);
    b.box('#222', 0.002, 0.012, 0.002, W / 2 - 0.05, H - 0.027, D / 2 + 0.0075);
    const dh = 0.3, gap = 0.008;
    for (let i = 0; i < 4; i++) {
      const cy = 0.065 + (3 - i) * (dh + gap) + dh / 2;
      const fz = D / 2;
      const p = b.part(`drawer${i}`, 0, cy, fz, { axis: 'z', maxOpen: 0.5 });
      p.rbox('body', W - 0.018, dh - 0.004, 0.022, 0.006, 0, cy, fz - 0.007, 0, 0, 0, 1);
      p.rbox('chrome', 0.14, 0.028, 0.014, 0.006, 0, cy - 0.015, fz + 0.008);
      p.box('#151515', 0.12, 0.01, 0.006, 0, cy - 0.022, fz + 0.012);
      p.rbox('chrome', 0.09, 0.042, 0.004, 0.003, 0, cy + 0.055, fz + 0.005);
      p.decal('fc_label', 0.078, 0.03, 0, cy + 0.055, fz + 0.0075, 0, 0, 0, { slot: 'atlas', cell: (v * 2 + i) % 6, cols: 3, rows: 2 });
      const bd = 0.6, bz = fz - 0.018 - bd / 2;
      for (const s of [-1, 1]) p.box('paint_dark', 0.008, dh - 0.06, bd, s * (W / 2 - 0.03), cy - 0.02, bz);
      p.box('paint_dark', W - 0.06, 0.008, bd, 0, cy - dh / 2 + 0.02, bz);
      p.box('paint_dark', W - 0.06, dh - 0.06, 0.008, 0, cy - 0.02, fz - 0.018 - bd);
      const n = 7 + ((i * 3 + v) % 5);
      for (let k = 0; k < n; k++) {
        const z = fz - 0.06 - k * (0.5 / n);
        p.box('#d6c18c', W - 0.09, dh - 0.09, 0.002, 0, cy - 0.03, z);
        p.box(['#d6c18c', '#8fb4cf', '#d6c18c', '#d89a90', '#a8c890'][k % 5], 0.06, 0.02, 0.002, -0.1 + ((k * 7) % 3) * 0.1, cy + dh / 2 - 0.065, z);
      }
    }
    return {
      colliders: [CB(W, H, D, 0, H / 2, 0)],
      mass: 42, material: 'metal', breakInto: ['metal_scrap', 'metal_scrap', 'paper', 'paper', 'screws'],
      anchors: { top: [0, H, 0] },
    };
  },
});

// book with spine (+Z face) and page edges mapped into the atlas
function bookGeo(t, h, d, spine, cover, pages = '#e6dcc4') {
  const g = prep(new THREE.BoxGeometry(t, h, d));
  const uv = g.attributes.uv;
  const pc = palUV(cover), pp = palUV(pages);
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 6; k++) {
      const i = f * 6 + k;
      if (f === 4 && spine) uv.setXY(i, lerp(spine.u0, spine.u1, uv.getX(i)), lerp(spine.v0, spine.v1, uv.getY(i)));
      else if (f === 2 || f === 5) uv.setXY(i, pp[0], pp[1]);
      else uv.setXY(i, pc[0], pc[1]);
    }
  }
  return g;
}

def('bookshelf', {
  variants: 3,
  build(b, v, rng) {
    const W = 0.9, H = 1.83, D = 0.31, t = 0.018;
    const wd = ['wood', 'wood_dark', 'oak'][v];
    for (const s of [-1, 1]) b.rbox(wd, t, H, D, 0.003, s * (W / 2 - t / 2), H / 2, 0);
    b.rbox(wd, W, t, D + 0.01, 0.003, 0, H - t / 2, 0.005);
    b.box(wd, W - 2 * t, 0.07, t, 0, 0.035, D / 2 - 0.02);
    b.box('wood_dark', W - 2 * t + 0.004, H - 0.02, 0.005, 0, H / 2, -D / 2 + 0.006);
    const shelves = [0.07, 0.42, 0.77, 1.12, 1.47];
    for (const y of shelves) b.box(wd, W - 2 * t, t, D - 0.01, 0, y + t / 2, 0.0);
    const inner = W - 2 * t;
    shelves.forEach((y0, si) => {
      const y = y0 + t;
      const cap = (si < 4 ? shelves[si + 1] : H - t) - y - 0.012;
      let x = -inner / 2 + 0.005;
      const end = inner / 2 - 0.005;
      const mode = (si + v) % 4;
      while (x < end - 0.03) {
        const r = rng.next();
        if (r < 0.08 && x > -inner / 2 + 0.1) { x += 0.05 + rng.next() * 0.12; continue; }
        if (mode === 0 && r < 0.6) {
          // run of binders
          const ci = Math.floor(rng.next() * 4);
          const n = 2 + Math.floor(rng.next() * 4);
          for (let k = 0; k < n && x < end - 0.065; k++) {
            const bt = 0.062, bh = Math.min(0.3, cap - 0.005);
            const g = bookGeo(bt, bh, 0.27, rUV('binder_spines', ci, 4, 1), BINDER_COLS[ci], '#f2f0e8');
            b.add('atlas', g, x + bt / 2, y + bh / 2, D / 2 - 0.02 - 0.135, 0, 0, 0, 'keep');
            x += bt + 0.002;
          }
          continue;
        }
        if (r > 0.93 && end - x > 0.24) {
          // horizontal stack
          let yy = y;
          for (let k = 0; k < 2 + Math.floor(rng.next() * 3); k++) {
            const bt = 0.025 + rng.next() * 0.02, bw = 0.15 + rng.next() * 0.06, bd = 0.2 + rng.next() * 0.04;
            const ci = Math.floor(rng.next() * 32);
            const g = bookGeo(bt, bw, bd, rUV('spines', ci, 16, 2), SPINE_COLS[ci]);
            b.add('atlas', g, x + bw / 2 + (rng.next() - 0.5) * 0.01, yy + bt / 2, D / 2 - 0.03 - bd / 2, 0, (rng.next() - 0.5) * 0.08, HP, 'keep');
            yy += bt;
          }
          x += 0.25;
          continue;
        }
        const bt = 0.02 + rng.next() * 0.035, bh = Math.min(cap - 0.005, 0.18 + rng.next() * 0.12), bd = 0.15 + rng.next() * 0.08;
        const ci = Math.floor(rng.next() * 32);
        const lean = x > end - 0.12 && rng.next() > 0.4 ? 0.22 : 0;
        const g = bookGeo(bt, bh, bd, rUV('spines', ci, 16, 2), SPINE_COLS[ci]);
        const back = 0.015 + rng.next() * 0.03;
        if (lean) b.add('atlas', g, x + bt / 2 + Math.sin(lean) * bh / 2, y + Math.cos(lean) * bh / 2, D / 2 - back - bd / 2, 0, 0, -lean, 'keep');
        else b.add('atlas', g, x + bt / 2, y + bh / 2, D / 2 - back - bd / 2, 0, 0, 0, 'keep');
        x += bt + (lean ? Math.sin(lean) * bh : 0.001);
        if (lean) break;
      }
    });
    return {
      colliders: [CB(W, H, D, 0, H / 2, 0)],
      mass: 38, material: 'wood', breakInto: ['plank', 'plank', 'plank', 'screws', 'paper'],
      anchors: { top: [0, H, 0] },
    };
  },
});

// ===========================================================================
// Soft furniture
// ===========================================================================
function sofa(b, seats) {
  const sw = 0.6, aw = 0.17, W = seats * sw + 2 * aw, D = 0.82, legH = 0.09;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    cylBetween(b, 'wood_dark', [sx * (W / 2 - 0.07), 0, sz * (D / 2 - 0.07)], [sx * (W / 2 - 0.07), legH, sz * (D / 2 - 0.07)], 0.018, 0.024, 8);
  }
  b.rbox('fab', W - 2 * aw + 0.02, 0.22, D - 0.05, 0.03, 0, legH + 0.11, 0.015, 0, 0, 0, 1);
  for (const s of [-1, 1]) {
    b.rbox('fab', aw, 0.55, D, 0.05, s * (W / 2 - aw / 2), legH + 0.275, 0, 0, 0, 0, 2);
    b.rbox('wood_dark', aw + 0.012, 0.024, D + 0.01, 0.008, s * (W / 2 - aw / 2), legH + 0.56, 0.0);
  }
  b.rbox('fab', W, 0.71, 0.18, 0.05, 0, legH + 0.355, -D / 2 + 0.09, 0, 0, 0, 2);
  const cz = -D / 2 + 0.18 + 0.31;
  for (let i = 0; i < seats; i++) {
    const x = (i - (seats - 1) / 2) * sw;
    b.add('fab', cushionGeo(sw / 2 - 0.006, 0.075, 0.31, 0.28, 0.5, 18, 10, 0.18), x, legH + 0.22 + 0.075, cz, 0, 0, 0, 'planar');
    b.add('fab', cushionGeo(sw / 2 - 0.012, 0.2, 0.08, 0.3, 0.5, 18, 10, 0.25), x, legH + 0.37 + 0.2, -D / 2 + 0.18 + 0.075, -0.16, 0, 0, 'planar');
  }
  return { W, D, aw, legH };
}
const sofaMats = (o, v) => ({ fab: o.color !== undefined ? tint('fabric_grey', o.color) : matFor(['fabric90s_teal', 'fabric90s_mauve', 'fabric_brown'][v]) });

def('couch', {
  variants: 3,
  mats: sofaMats,
  build(b) {
    const { W, D, aw, legH } = sofa(b, 2);
    return {
      colliders: [CB(aw, legH + 0.55, D, -(W / 2 - aw / 2), (legH + 0.55) / 2, 0), CB(aw, legH + 0.55, D, W / 2 - aw / 2, (legH + 0.55) / 2, 0), CB(W - 2 * aw, 0.36, D - 0.05, 0, legH + 0.18, 0.015), CB(W - 2 * aw, 0.71, 0.18, 0, legH + 0.355, -D / 2 + 0.09)],
      mass: 48, material: 'fabric', breakInto: ['fabric', 'fabric', 'foam', 'foam', 'plank', 'spring'],
      anchors: { seat0: [-0.3, 0.47, 0.08], seat1: [0.3, 0.47, 0.08], seat: [-0.3, 0.47, 0.08] },
    };
  },
});

def('armchair', {
  variants: 3,
  mats: sofaMats,
  build(b) {
    const { W, D, aw, legH } = sofa(b, 1);
    return {
      colliders: [CB(aw, legH + 0.55, D, -(W / 2 - aw / 2), (legH + 0.55) / 2, 0), CB(aw, legH + 0.55, D, W / 2 - aw / 2, (legH + 0.55) / 2, 0), CB(W - 2 * aw, 0.36, D - 0.05, 0, legH + 0.18, 0.015), CB(W - 2 * aw, 0.71, 0.18, 0, legH + 0.355, -D / 2 + 0.09)],
      mass: 28, material: 'fabric', breakInto: ['fabric', 'foam', 'plank', 'spring'],
      anchors: { seat: [0, 0.47, 0.08] },
    };
  },
});

function mattressInto(b, w, h, l, y0, v) {
  const g = new RoundedBoxGeometry(w, h, l, 2, 0.045);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (v & 1) ? 1 - uv.getX(i) : uv.getX(i), (v & 2) ? 1 - uv.getY(i) : uv.getY(i));
  b.add('mattress', g, 0, y0 + h / 2, 0, 0, 0, 0, 'keep');
  const loop = [[-w / 2 + 0.012, 0, -l / 2 + 0.012], [w / 2 - 0.012, 0, -l / 2 + 0.012], [w / 2 - 0.012, 0, l / 2 - 0.012], [-w / 2 + 0.012, 0, l / 2 - 0.012]];
  for (const yy of [y0 + h - 0.028, y0 + 0.028]) b.tube('#cfc5ad', loop.map((p) => [p[0], yy, p[2]]), 0.0055, { radial: 5, closed: true, round: 0.04, rseg: 3 });
  for (let i = 0; i < 3; i++) for (let j = 0; j < 7; j++) b.sph('#c9bfa6', 0.011, (i - 1) * w * 0.3, y0 + h - 0.002, (j - 3) * l * 0.135, 6, 4, 1, 0.45, 1);
  for (const s of [-1, 1]) for (const z of [-0.35, 0.35]) b.box('#bdb39a', 0.004, 0.025, 0.13, s * (w / 2 + 0.002), y0 + h / 2, z * l / 1.9);
}

def('mattress', {
  variants: 4,
  build(b, v) {
    mattressInto(b, 0.9, 0.19, 1.9, 0, v);
    return { colliders: [CB(0.9, 0.19, 1.9, 0, 0.095, 0)], mass: 14, material: 'soft', breakInto: ['fabric', 'foam', 'foam', 'spring'], anchors: { sleep: [0, 0.2, 0], top: [0, 0.19, 0] } };
  },
});

function drapeGeo(w, l, top, edge, rb, maxDrop, segX, segZ, rng, wrinkle = 0.008) {
  const g = new THREE.PlaneGeometry(w, l, segX, segZ);
  g.rotateX(-HP);
  const p = g.attributes.position;
  const ph = rng.next() * 10;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const d = Math.abs(x) - edge;
    let nx = x, ny = top;
    if (d > 0) {
      const arc = rb * HP;
      if (d < arc) { const a = d / rb; nx = Math.sign(x) * (edge + rb * Math.sin(a)); ny = top - rb * (1 - Math.cos(a)); }
      else { nx = Math.sign(x) * (edge + rb); ny = top - rb - Math.min(d - arc, maxDrop); }
    }
    const wr = wrinkle * (Math.sin(z * 9 + x * 4 + ph) * 0.6 + Math.sin(z * 23 - x * 11 + ph * 2) * 0.4);
    if (d > 0) nx += Math.sign(x) * Math.abs(wr) * 0.8; else ny += wr * 0.5 + 0.004;
    p.setXYZ(i, nx, ny, z);
  }
  g.computeVertexNormals();
  return g;
}

def('bed', {
  variants: 3,
  mats: (o, v) => ({ frame: tint('paint_green', [0x3e4a44, 0xd8d5cc, 0x26272a][v]), blanket: tint('blanket', o.color ?? [0x5b6878, 0x7a3434, 0x6b6248][v]) }),
  build(b, v, rng) {
    const L = 1.98, W = 0.94, yM = 0.33, mh = 0.19, top = yM + mh;
    for (const [z, hgt, sp] of [[-L / 2, 0.95, 7], [L / 2, 0.62, 5]]) {
      b.tube('frame', [[-W / 2, 0.012, z], [-W / 2, hgt, z], [W / 2, hgt, z], [W / 2, 0.012, z]], 0.016, { radial: 10, round: 0.09, rseg: 6 });
      b.cyl('frame', 0.008, 0.008, W, 0, 0.4, z, 0, 0, HP, 8);
      for (let i = 0; i < sp; i++) { const x = ((i + 1) / (sp + 1) - 0.5) * W; b.cyl('frame', 0.007, 0.007, hgt - 0.42, x, (hgt + 0.4) / 2, z, 0, 0, 0, 6); }
      for (const s of [-1, 1]) b.cyl('#222', 0.019, 0.019, 0.02, s * W / 2, 0.01, z, 0, 0, 0, 10);
    }
    for (const s of [-1, 1]) {
      b.box('frame', 0.004, 0.04, L, s * (W / 2 - 0.012), yM - 0.02, 0);
      b.box('frame', 0.035, 0.004, L, s * (W / 2 - 0.03), yM - 0.038, 0);
    }
    for (let i = 0; i < 5; i++) b.box('paint_dark', W - 0.05, 0.004, 0.04, 0, yM - 0.037, (i / 4 - 0.5) * (L - 0.3));
    mattressInto(b, W - 0.04, mh, L - 0.06, yM, v);
    // pillow + turned-down sheet + blanket
    b.add('pillow', cushionGeo(0.31, 0.06, 0.2, 0.42, 0.7, 16, 10, 0.35), 0, top + 0.055, -L / 2 + 0.26, -0.14, 0.03 * (v - 1), 0, 'planar');
    const bz0 = -L / 2 + 0.55, bl = L - 0.6;
    const bl1 = drapeGeo(W + 0.18, bl, top + 0.004, (W - 0.04) / 2, 0.035, 0.2, 18, 18, rng);
    b.add('blanket', bl1, 0, 0, bz0 + bl / 2 - 0.02, 0, 0, 0, 'planar');
    const sh = drapeGeo(W + 0.1, 0.16, top + 0.016, (W - 0.04) / 2 + 0.01, 0.03, 0.08, 14, 3, rng, 0.004);
    b.add('fabric_white', sh, 0, 0, bz0 + 0.06, 0, 0, 0, 'planar');
    return {
      colliders: [CB(W, 0.23, L - 0.06, 0, yM + mh / 2 - 0.02, 0), CB(W + 0.03, 0.95, 0.035, 0, 0.475, -L / 2), CB(W + 0.03, 0.62, 0.035, 0, 0.31, L / 2)],
      mass: 46, material: 'metal', breakInto: ['metal_tube', 'metal_tube', 'fabric', 'foam', 'spring'],
      anchors: { sleep: [0, top + 0.02, -0.15], pillow: [0, top + 0.08, -L / 2 + 0.26], under: [0, 0.15, 0], top: [0, top, 0.3] },
    };
  },
});

// ===========================================================================
// Lamps
// ===========================================================================
CUSTOM.bulb = () => new THREE.MeshStandardMaterial({ name: 'furn_bulb', color: 0xfff6e2, emissive: 0xffe0a8, emissiveIntensity: 1.6, roughness: 0.25 });
CUSTOM.blanket = () => { const m = Mat.make('fabric_grey', { color: 0x5b6878, texRepeat: 6 }); m.side = THREE.DoubleSide; return m; };
CUSTOM.pillow = () => Mat.make('fabric_white', { color: 0xd9d1bd, texRepeat: 3 });

def('lamp_floor', {
  variants: 2,
  build(b, v) {
    const met = v ? 'paint_black' : 'brass';
    b.lathe(met, [[0, 0.002], [0.148, 0.002, 1], [0.152, 0.01], [0.14, 0.022], [0.06, 0.032], [0.022, 0.04], [0, 0.041]], 0, 0, 0, 0, 0, 0, 28);
    b.cyl(met, 0.011, 0.011, 1.4, 0, 0.74, 0, 0, 0, 0, 10);
    for (const y of [0.05, 0.75, 1.41]) b.cyl(met, 0.016, 0.016, 0.025, 0, y, 0, 0, 0, 0, 12);
    b.lathe('brass', [[0, 1.42], [0.016, 1.42], [0.019, 1.44], [0.019, 1.47], [0.014, 1.48], [0, 1.48]], 0, 0, 0, 0, 0, 0, 12);
    b.tube('brass', [[-0.075, 1.41, 0], [-0.075, 1.5, 0], [0, 1.65, 0], [0.075, 1.5, 0], [0.075, 1.41, 0]], 0.003, { radial: 5, round: 0.06 });
    b.tube('brass', [[-0.075, 1.41, 0], [0.075, 1.41, 0]], 0.003, { radial: 5 });
    b.sph('brass', 0.012, 0, 1.665, 0, 10, 8);
    for (let i = 0; i < 9; i++) b.sph('brass', 0.0028, 0.02, 1.46 - i * 0.011, 0.0, 5, 4);
    b.cyl('brass', 0.005, 0.004, 0.02, 0.02, 1.355, 0, 0, 0, 0, 6);
    b.named('bulb', 'bulb', latheGeo([[0, 0], [0.012, 0.004], [0.014, 0.02], [0.03, 0.05], [0.032, 0.07], [0.024, 0.094], [0, 0.103]], 14), 0, 1.475, 0, 0, 0, 0, { uv: 'keep' });
    const sg = latheGeo([[0.215, 0], [0.14, 0.26]], 48);
    const p = sg.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), a = Math.atan2(x, z), k = 1 + 0.022 * Math.cos(a * 40); p.setX(i, x * k); p.setZ(i, z * k); }
    sg.computeVertexNormals();
    b.named('shade', 'lampshade', sg, 0, 1.4, 0, 0, 0, 0, { uv: 'keep' });
    b.tor('brass', 0.215, 0.003, 0, 1.4, 0, HP, 0, 0, 4, 40);
    b.tor('brass', 0.14, 0.003, 0, 1.66, 0, HP, 0, 0, 4, 32);
    b.tube('plastic_black', [[0, 0.03, -0.02], [0.02, 0.012, -0.1], [0.04, 0.004, -0.16]], 0.0035, { radial: 5, round: 0.04 });
    return {
      colliders: [CC(0.15, 0.04, 0, 0.02, 0), CC(0.012, 1.36, 0, 0.72, 0), CC(0.14, 0.26, 0, 1.53, 0)],
      mass: 6, material: 'metal', breakInto: ['metal_tube', 'wire', 'glass_shard', 'fabric'],
      anchors: { light: [0, 1.52, 0] },
    };
  },
});

function helixPts(a, c, r, turns, perTurn = 6) {
  const A = toV(a), C = toV(c);
  const dir = C.clone().sub(A);
  const L = dir.length();
  dir.normalize();
  const n = Math.abs(dir.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0);
  const N = n.sub(dir.clone().multiplyScalar(n.dot(dir))).normalize();
  const B = V().crossVectors(dir, N);
  const pts = [];
  const steps = Math.ceil(turns * perTurn);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, a2 = t * turns * TAU;
    pts.push(A.clone().addScaledVector(dir, t * L).addScaledVector(N, Math.cos(a2) * r).addScaledVector(B, Math.sin(a2) * r));
  }
  return pts;
}

def('lamp_desk', {
  variants: 2,
  build(b, v) {
    const pc = v ? 'paint_beige' : 'paint_black';
    b.lathe(pc, [[0, 0.002], [0.08, 0.002, 1], [0.083, 0.01], [0.076, 0.03], [0.03, 0.036], [0, 0.037]], 0, 0, 0, 0, 0, 0, 24);
    b.rbox(pc, 0.03, 0.025, 0.03, 0.006, 0, 0.05, -0.02);
    b.rbox('#c23a2a', 0.012, 0.006, 0.018, 0.002, 0.045, 0.035, 0.03);
    const P0 = [0, 0.055, -0.02], E = [0, 0.33, -0.1], Hd = [0, 0.39, 0.17];
    for (const s of [-1, 1]) {
      cylBetween(b, 'chrome', [s * 0.011, P0[1], P0[2]], [s * 0.011, E[1], E[2]], 0.0042, 0.0042, 6);
      cylBetween(b, 'chrome', [s * 0.011, E[1], E[2]], [s * 0.011, Hd[1], Hd[2]], 0.0042, 0.0042, 6);
    }
    b.tube('steel', helixPts([0.0, 0.09, -0.05], [0.0, 0.28, -0.1], 0.006, 18, 5), 0.0012, { radial: 4, caps: false });
    for (const p of [P0, E, Hd]) b.cyl(pc, 0.012, 0.012, 0.034, p[0], p[1], p[2], 0, 0, HP, 12);
    const tilt = -0.55;
    // shade: outer + white reflector inside, mouth facing down/forward
    const og = latheGeo([[0.078, 0, 1], [0.074, 0.02], [0.05, 0.1], [0.026, 0.13], [0.022, 0.15, 1], [0, 0.152]], 24);
    const ig = latheGeo([[0.02, 0.145], [0.048, 0.1], [0.072, 0.02], [0.075, 0.002]], 24);
    const hx = Hd[0], hy = Hd[1] - 0.14 * Math.cos(-tilt), hz = Hd[2] + 0.14 * Math.sin(-tilt);
    b.add(pc, og, hx, hy, hz, tilt, 0, 0, { su: 0.5, sv: 0.2 });
    b.add('paint_white', ig, hx, hy, hz, tilt, 0, 0, { su: 0.5, sv: 0.2 });
    b.named('bulb', 'bulb', new THREE.SphereGeometry(0.024, 12, 8), hx, hy + 0.06 * Math.cos(-tilt), hz - 0.06 * Math.sin(-tilt), 0, 0, 0, { uv: 'keep' });
    b.tube('plastic_black', [[0, 0.02, -0.07], [0, 0.006, -0.1], [0.02, 0.004, -0.13]], 0.0028, { radial: 5, round: 0.02 });
    return {
      colliders: [CC(0.08, 0.037, 0, 0.0185, 0), CBbetween(P0, E, 0.035, 0.03), CC(0.06, 0.12, hx, hy + 0.06, hz - 0.02, tilt, 0, 0)],
      mass: 2.2, material: 'metal', breakInto: ['metal_tube', 'spring', 'wire', 'glass_shard'],
      anchors: { light: [hx, hy + 0.03, hz] },
    };
  },
});

// ===========================================================================
// Plants
// ===========================================================================
// leaf in local space: base at origin, pointing +Z, face up +Y, folded along the midrib
function leafGeo(L, Wd, fold = 0.25, curl = 0.15, rows = 1) {
  const pos = [], idx = [];
  if (rows <= 1) {
    pos.push(0, 0, 0, -Wd / 2, Wd * fold * -0.5, L * 0.45, 0, 0, L * 0.45, Wd / 2, Wd * fold * -0.5, L * 0.45, 0, -L * curl, L);
    idx.push(0, 2, 1, 0, 3, 2, 1, 2, 4, 2, 3, 4);
  } else {
    for (let r = 0; r <= rows; r++) {
      const t = r / rows, w = Wd / 2 * Math.pow(Math.sin(PI * clamp(t * 0.92 + 0.04, 0, 1)), 0.7), y = -curl * L * t * t, z = L * t;
      pos.push(-w, y - w * fold, z, 0, y, z, w, y - w * fold, z);
    }
    for (let r = 0; r < rows; r++) { const a = r * 3; idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3, a + 1, a + 2, a + 4, a + 2, a + 5, a + 4); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const _lm = new THREE.Matrix4(), _lq = new THREE.Quaternion(), _lz = new THREE.Vector3(0, 0, 1);
function addLeaf(b, slot, g, at, dir, roll = 0, scale = 1) {
  const d = toV(dir).normalize();
  _lq.setFromUnitVectors(_lz, d);
  const rq = new THREE.Quaternion().setFromAxisAngle(_lz, roll);
  _lq.multiply(rq);
  _lm.compose(toV(at), _lq, _s.set(scale, scale, scale));
  const gg = g.clone();
  gg.applyMatrix4(_lm);
  return b.add(slot, gg, 0, 0, 0, 0, 0, 0, 'keep');
}
function potInto(b, slot, rTop, rBot, h, rim = 0.012) {
  b.lathe(slot, [[0, 0.002], [rBot - 0.005, 0.002, 1], [rBot, 0.012], [rTop - 0.004, h - 0.03, 1], [rTop + rim, h - 0.026], [rTop + rim + 0.003, h - 0.008], [rTop + rim - 0.002, h, 1], [rTop - 0.006, h - 0.004], [rTop - 0.012, h - 0.04]], 0, 0, 0, 0, 0, 0, 24);
  b.cyl('soil', rTop - 0.012, rTop - 0.012, 0.01, 0, h - 0.035, 0, 0, 0, 0, 20);
}

def('plant_pot', {
  variants: 3,
  build(b, v, rng) {
    const h = 0.34;
    potInto(b, ['terracotta', 'plastic_white', 'plastic_grey'][v], 0.17, 0.13, h);
    for (let i = 0; i < 6; i++) b.sph('#7a7468', 0.008 + rng.next() * 0.006, (rng.next() - 0.5) * 0.2, h - 0.03, (rng.next() - 0.5) * 0.2, 5, 4, 1, 0.6, 1);
    const ys = h - 0.035;
    if (v !== 1) {
      // ficus benjamina: braided trunks, drooping branches, many small leaves
      const top = 1.0;
      for (let k = 0; k < 3; k++) {
        const pts = [];
        for (let i = 0; i <= 14; i++) { const t = i / 14, a = (k * TAU) / 3 + t * 5 * PI, r = 0.011 * (1 - t * 0.3); pts.push([Math.cos(a) * r, ys + t * (top - ys), Math.sin(a) * r]); }
        b.tube('bark', pts, (t) => 0.009 - t * 0.003, { radial: 6 });
      }
      const lg = leafGeo(0.085, 0.038, 0.3, 0.2);
      const nb = 12;
      for (let i = 0; i < nb; i++) {
        const a = (i / nb) * TAU + rng.next() * 0.5, y0 = top - 0.32 + rng.next() * 0.34;
        const len = 0.28 + rng.next() * 0.22, rise = 0.12 + rng.next() * 0.25;
        const dx = Math.cos(a), dz = Math.sin(a);
        const pts = [[0, y0, 0], [dx * len * 0.35, y0 + rise * 0.8, dz * len * 0.35], [dx * len * 0.75, y0 + rise, dz * len * 0.75], [dx * len, y0 + rise * 0.55, dz * len]];
        b.tube('bark', pts, (t) => 0.005 - t * 0.003, { radial: 5, round: 0.08, rseg: 3 });
        const P = roundPath(pts, 0.08, 3);
        for (let k = 0; k < 30; k++) {
          const t = 0.15 + (k / 30) * 0.85;
          const fi = t * (P.length - 1), i0 = Math.floor(fi), i1 = Math.min(P.length - 1, i0 + 1);
          const at = P[i0].clone().lerp(P[i1], fi - i0);
          at.x += (rng.next() - 0.5) * 0.14; at.y += (rng.next() - 0.5) * 0.1; at.z += (rng.next() - 0.5) * 0.14;
          const dir = V(dx + (rng.next() - 0.5) * 1.6, -0.5 - rng.next() * 0.8, dz + (rng.next() - 0.5) * 1.6);
          addLeaf(b, rng.next() > 0.3 ? 'leaf' : 'leaf_dark', lg, at, dir, (rng.next() - 0.5) * 1.5, 0.8 + rng.next() * 0.45);
        }
      }
      // crown fill
      for (let k = 0; k < 70; k++) {
        const a = rng.next() * TAU, r = 0.05 + rng.next() * 0.22;
        addLeaf(b, rng.next() > 0.4 ? 'leaf' : 'leaf_dark', lg, [Math.cos(a) * r, top - 0.1 + rng.next() * 0.4, Math.sin(a) * r], [Math.cos(a), -0.4 + rng.next() * 0.6, Math.sin(a)], rng.next() * 3, 0.85 + rng.next() * 0.3);
      }
      return {
        colliders: [CC(0.15, h, 0, h / 2, 0), CC(0.03, top - h, 0, (top + h) / 2, 0)],
        mass: 16, material: 'plastic', breakInto: ['plant_fiber', 'plant_fiber', 'dirt'],
      };
    }
    // rubber plant: two stems, big glossy leaves
    const lg = leafGeo(0.26, 0.12, 0.12, 0.18, 5);
    for (const [sx, sz, top, n] of [[0.02, 0.01, 1.05, 14], [-0.04, -0.03, 0.8, 10], [0.03, -0.04, 0.62, 6]]) {
      const pts = [[sx, ys, sz], [sx * 1.5, ys + (top - ys) * 0.5, sz * 1.5], [sx * 2.2, top, sz * 2.2]];
      b.tube('#5c5a3a', pts, (t) => 0.012 - t * 0.005, { radial: 6, round: 0.2, rseg: 4 });
      for (let i = 0; i < n; i++) {
        const t = 0.25 + (i / n) * 0.75, y = ys + (top - ys) * t;
        const a = i * 2.4 + sx * 20;
        const at = [sx * (1 + t * 1.2) + Math.cos(a) * 0.04, y, sz * (1 + t * 1.2) + Math.sin(a) * 0.04];
        b.tube('#4f6a32', [[at[0] - Math.cos(a) * 0.04, y - 0.02, at[2] - Math.sin(a) * 0.04], at], 0.004, { radial: 4 });
        addLeaf(b, 'leaf_dark', lg, at, [Math.cos(a), 0.55 - t * 0.6, Math.sin(a)], (rng.next() - 0.5) * 0.6, 0.85 + t * 0.3);
      }
      addLeaf(b, 'leaf', leafGeo(0.12, 0.035, 0.6, -0.1, 3), [sx * 2.2, top, sz * 2.2], [0, 1, 0.1], 0, 1);
    }
    return {
      colliders: [CC(0.15, h, 0, h / 2, 0), CC(0.03, 0.6, 0, h + 0.3, 0)],
      mass: 15, material: 'plastic', breakInto: ['plant_fiber', 'plant_fiber', 'dirt'],
    };
  },
});

region('snakeleaf', 64, 256, (ctx, w, h, rng) => {
  ctx.fillStyle = '#2f5a2a'; ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 6 + rng.next() * 8) {
    ctx.fillStyle = `rgba(${rng.next() > 0.5 ? '170,200,140' : '20,40,20'},${0.25 + rng.next() * 0.3})`;
    ctx.beginPath(); ctx.moveTo(8, y); ctx.quadraticCurveTo(w / 2, y + 4 + rng.next() * 6, w - 8, y); ctx.lineTo(w - 8, y + 2.5); ctx.quadraticCurveTo(w / 2, y + 7, 8, y + 2.5); ctx.fill();
  }
  ctx.fillStyle = '#c9c25a'; ctx.fillRect(0, 0, 6, h); ctx.fillRect(w - 6, 0, 6, h);
});
// two-sided copy (for thin geometry with a front-side material)
function twoSided(g) {
  const a = prep(g);
  const b2 = a.clone();
  const p = b2.attributes.position, n = b2.attributes.normal, uv = b2.attributes.uv;
  for (let i = 0; i < p.count; i += 3) {
    for (const attr of [p, n, uv]) {
      const s = attr.itemSize;
      for (let k = 0; k < s; k++) { const t = attr.array[(i + 1) * s + k]; attr.array[(i + 1) * s + k] = attr.array[(i + 2) * s + k]; attr.array[(i + 2) * s + k] = t; }
    }
  }
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return mergeGeometries([a, b2], false);
}
function swordLeaf(L, Wd, bend, twist, rows = 6) {
  const pos = [], uv = [], idx = [];
  for (let r = 0; r <= rows; r++) {
    const t = r / rows, w = (Wd / 2) * (t < 0.75 ? 1 - t * 0.2 : (1 - t) * 3.2), y = L * t, z = bend * t * t, tw = twist * t;
    for (const s of [-1, 0, 1]) { const x = s * w; pos.push(x * Math.cos(tw), y, z + x * Math.sin(tw) + (s === 0 ? -0.004 : 0)); uv.push((s + 1) / 2, t); }
  }
  for (let r = 0; r < rows; r++) { const a = r * 3; idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3, a + 1, a + 2, a + 4, a + 2, a + 5, a + 4); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function snakeClump(b, rng, n, x0, z0, y0, hMin, hMax, spread) {
  const r = rUV('snakeleaf');
  for (let i = 0; i < n; i++) {
    const hh = hMin + rng.next() * (hMax - hMin);
    const g = swordLeaf(hh, hh * (0.15 + rng.next() * 0.05), (0.04 + rng.next() * 0.08) * hh / 0.3, (rng.next() - 0.5) * 1.4);
    const tg = twoSided(g);
    mapUV(tg, r);
    const a = rng.next() * TAU;
    xform(tg, x0 + Math.cos(a) * spread * rng.next(), y0, z0 + Math.sin(a) * spread * rng.next(), 0, a, 0);
    b._push('atlas', tg);
  }
}

def('plant_small', {
  variants: 2,
  build(b, v, rng) {
    const s = 0.13, h = 0.12, t = 0.008, mat = v ? 'terracotta' : 'ceramic';
    b.rbox(mat, s, 0.012, s, 0.004, 0, 0.006, 0);
    for (const k of [-1, 1]) {
      b.rbox(mat, s, h, t, 0.003, 0, h / 2, k * (s / 2 - t / 2));
      b.rbox(mat, t, h, s - 2 * t + 0.002, 0.003, k * (s / 2 - t / 2), h / 2, 0);
    }
    b.box('soil', s - 2 * t, 0.01, s - 2 * t, 0, h - 0.015, 0);
    snakeClump(b, rng, 9, 0, 0, h - 0.012, 0.18, 0.36, 0.03);
    return {
      colliders: [CB(s, h, s, 0, h / 2, 0)],
      mass: 1.6, material: 'plastic', breakInto: ['plant_fiber', 'dirt'],
    };
  },
});

def('office_divider_plant', {
  variants: 2,
  build(b, v, rng) {
    const W = 1.0, H = 0.4, D = 0.32, t = 0.018, mat = v ? 'paint_beige' : 'wood';
    b.rbox(mat, W, 0.02, D, 0.004, 0, 0.03, 0);
    for (const k of [-1, 1]) {
      b.rbox(mat, W, H - 0.02, t, 0.004, 0, 0.02 + (H - 0.02) / 2, k * (D / 2 - t / 2));
      b.rbox(mat, t, H - 0.02, D - 2 * t, 0.004, k * (W / 2 - t / 2), 0.02 + (H - 0.02) / 2, 0);
      b.rbox(v ? 'plastic_black' : 'wood_dark', W + 0.01, 0.022, 0.04, 0.006, 0, H + 0.002, k * (D / 2 - 0.016));
      b.rbox(v ? 'plastic_black' : 'wood_dark', 0.04, 0.022, D + 0.01, 0.006, k * (W / 2 - 0.016), H + 0.002, 0);
      b.box('#1d1b19', W - 0.04, 0.02, 0.04, 0, 0.01, k * (D / 2 - 0.05));
    }
    b.box('soil', W - 2 * t, 0.02, D - 2 * t, 0, H - 0.03, 0);
    for (let i = 0; i < 5; i++) snakeClump(b, rng, 10, (i - 2) * 0.18, (rng.next() - 0.5) * 0.06, H - 0.025, 0.35, 0.72, 0.06);
    return {
      colliders: [CB(W, H + 0.01, D, 0, (H + 0.01) / 2, 0), CB(0.8, 0.5, 0.08, 0, H + 0.25, 0)],
      mass: 32, material: 'wood', breakInto: ['plank', 'plank', 'plant_fiber', 'dirt'],
    };
  },
});

// ===========================================================================
// Utility / industrial props
// ===========================================================================
function crumpleGeo(r, rng, amt = 0.38, detail = 1, squash = 0.85) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position;
  const k = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    if (!k.has(key)) k.set(key, 1 + (rng.next() - 0.5) * amt);
    const s = k.get(key);
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * squash, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  return g;
}

def('trash_can', {
  variants: 2,
  build(b, v, rng) {
    const h = 0.3, rt = 0.14, rb = 0.115;
    b.lathe('wiremesh', [[rb, 0.008], [rt, h - 0.004]], 0, 0, 0, 0, 0, 0, 28, 0, TAU, { su: 17, sv: 6.5, swap: false });
    b.cyl('paint_black', rb, rb, 0.006, 0, 0.005, 0, 0, 0, 0, 24);
    b.tor('paint_black', rt, 0.0045, 0, h - 0.002, 0, HP, 0, 0, 6, 32);
    b.tor('paint_black', rb + 0.001, 0.004, 0, 0.008, 0, HP, 0, 0, 6, 28);
    b.tor('paint_black', lerp(rb, rt, 0.2) + 0.001, 0.0025, 0, 0.065, 0, HP, 0, 0, 4, 28);
    const balls = v ? [[0.03, 0.05, 0.02, 0.05], [-0.04, 0.045, -0.03, 0.045], [0.02, 0.13, -0.02, 0.05], [-0.03, 0.2, 0.03, 0.045], [0.04, 0.27, 0.0, 0.05]] : [[0.02, 0.05, 0.03, 0.05], [-0.04, 0.05, -0.02, 0.045], [0.01, 0.26, 0.0, 0.055]];
    for (const [x, y, z, r] of balls) b.add('paper', crumpleGeo(r, rng), x, y, z, rng.next() * 3, rng.next() * 3, 0, 'keep');
    if (v) {
      b.cyl('#b8291f', 0.033, 0.033, 0.06, 0.03, 0.18, 0.05, 0.6, 0, 0.3, 12);
      b.add('paper2', latheGeo([[0.001, 0], [0.025, 0.08], [0.027, 0.083]], 12), -0.05, 0.08, 0.05, 1.2, 0, 0.4, 'keep');
    }
    return {
      colliders: [CC(0.125, h, 0, h / 2, 0)],
      mass: v ? 1.8 : 1.3, material: 'metal', breakInto: ['wire', 'wire', 'paper'],
      anchors: { inside: [0, 0.1, 0] },
    };
  },
});

region('crate_stencil', 256, 128, (ctx, w, h, rng) => {
  const c = 'rgba(25,22,18,0.88)';
  txt(ctx, 'ROOM CORP.', w / 2, 34, 40, c, { fam: 'mono' });
  txt(ctx, 'SECTOR 0 — HANDLE WITH CARE', w / 2, 70, 15, c, { fam: 'mono' });
  txt(ctx, `LOT ${Math.floor(rng.next() * 9000 + 1000)}-B   GROSS 41 KG`, w / 2, 98, 14, c, { fam: 'mono' });
  ctx.save(); ctx.globalCompositeOperation = 'destination-out';
  for (let x = 8; x < w; x += 23) ctx.fillRect(x, 14, 2, 44);
  ctx.restore();
  grunge(ctx, w, h, rng, 600, 1, 2.5);
});
region('pallet_stamp', 128, 64, (ctx, w, h, rng) => {
  const c = 'rgba(30,25,20,0.8)';
  ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.strokeRect(4, 4, w - 8, h - 8);
  ctx.beginPath(); ctx.arc(26, 32, 14, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.moveTo(12, 32); ctx.lineTo(40, 32); ctx.moveTo(26, 18); ctx.lineTo(26, 46); ctx.stroke();
  txt(ctx, 'HT  DB', 84, 22, 16, c, { fam: 'mono' });
  txt(ctx, 'XX-0447', 84, 44, 13, c, { fam: 'mono' });
  grunge(ctx, w, h, rng, 200, 1, 1.5);
});

def('crate_wood', {
  variants: 2,
  build(b, v, rng) {
    const W = 0.6, H = 0.5, D = 0.45, t = 0.02, pH = (H - 0.04) / 3;
    b.box('#17110b', W - 0.05, H - 0.05, D - 0.05, 0, H / 2, 0);
    for (let i = 0; i < 3; i++) {
      const y = 0.02 + pH * (i + 0.5);
      for (const s of [-1, 1]) {
        b.box('plank', W, pH - 0.014, t, 0, y, s * (D / 2 - t / 2));
        b.box('plank', t, pH - 0.014, D - 2 * t, s * (W / 2 - t / 2), y, 0);
      }
    }
    for (let i = 0; i < 4; i++) b.box('plank', W, t, (D - 0.03) / 4 - 0.008, 0, H - t / 2, -D / 2 + 0.015 + ((i + 0.5) * (D - 0.03)) / 4);
    b.box('plank', W, t, D, 0, t / 2, 0);
    for (const s of [-1, 1]) {
      for (const k of [-1, 1]) b.box('plank', 0.07, H, 0.022, k * (W / 2 - 0.035), H / 2, s * (D / 2 + 0.011));
      for (const k of [-1, 1]) b.box('plank', 0.022, H, 0.07, s * (W / 2 + 0.011), H / 2, k * (D / 2 - 0.035));
      // diagonal brace on front/back
      const L = Math.hypot(W - 0.14, H - 0.06), a = Math.atan2(H - 0.06, W - 0.14);
      b.box('plank', L, 0.06, 0.02, 0, H / 2, s * (D / 2 + 0.031), 0, 0, s * a);
    }
    for (const s of [-1, 1]) for (const k of [-1, 1]) for (const yy of [0.04, H / 2, H - 0.04]) b.cyl('#2b2722', 0.004, 0.004, 0.003, k * (W / 2 - 0.035), yy, s * (D / 2 + 0.0225), HP, 0, 0, 6);
    b.decal('crate_stencil', 0.42, 0.21, 0, H * 0.55, D / 2 + 0.0225);
    b.decal('crate_stencil', 0.3, 0.15, W / 2 + 0.0225, H * 0.62, 0, 0, HP, 0);
    if (v === 1) b.decal('waterstain', 0.3, 0.3, 0.1, H + 0.001, 0, -HP, 0, 0);
    return {
      colliders: [CB(W + 0.04, H, D + 0.04, 0, H / 2, 0)],
      mass: 14, material: 'wood', breakInto: ['plank', 'plank', 'plank', 'nails'],
      anchors: { top: [0, H, 0] },
    };
  },
});

def('pallet', {
  variants: 2,
  build(b, v, rng) {
    const W = 1.2, D = 0.8, t = 0.022;
    const tops = [[-0.3275, 0.145], [-0.16375, 0.1], [0, 0.145], [0.16375, 0.1], [0.3275, 0.145]];
    tops.forEach(([z, w], i) => { if (!(v === 1 && i === 1)) b.box('plank', W - (rng.next() * 0.006), t, w - 0.004, (rng.next() - 0.5) * 0.006, 0.144 - t / 2, z, 0, (rng.next() - 0.5) * 0.008, 0); });
    if (v === 1) b.box('plank', W * 0.55, t, 0.096, -W * 0.22, 0.144 - t / 2 + 0.006, -0.16, 0.04, 0.05, 0.03);
    for (const x of [-0.5275, 0, 0.5275]) b.box('plank', 0.145, t, D, x, 0.1 + t / 2, 0);
    for (const x of [-0.5275, 0, 0.5275]) for (const [z, d] of [[-0.35, 0.1], [0, 0.145], [0.35, 0.1]]) b.box('plank', 0.145, 0.078, d, x, 0.022 + 0.039, z);
    for (const [z, d] of [[-0.35, 0.1], [0, 0.145], [0.35, 0.1]]) b.box('plank', W, t, d, 0, t / 2, z);
    for (const x of [-0.5275, 0.5275]) b.decal('pallet_stamp', 0.12, 0.06, x, 0.061, D / 2 + 0.0008, 0, 0, 0);
    b.decal('pallet_stamp', 0.12, 0.06, 0, 0.061, 0.0725 + 0.0008);
    for (const x of [-0.5275, 0, 0.5275]) for (const z of [-0.3275, 0, 0.3275]) for (const dx of [-0.04, 0.04]) b.cyl('#3a352e', 0.0045, 0.0045, 0.002, x + dx, 0.1445, z, 0, 0, 0, 6);
    return {
      colliders: [CB(W, 0.044, D, 0, 0.122, 0), ...[[-0.35, 0.1], [0, 0.145], [0.35, 0.1]].map(([z, d]) => CB(W, 0.1, d, 0, 0.05, z))],
      mass: 22, material: 'wood', breakInto: ['plank', 'plank', 'plank', 'plank', 'nails'],
      anchors: { top: [0, 0.144, 0] },
    };
  },
});

def('traffic_cone', {
  build(b) {
    const rr = (y) => 0.135 - (y - 0.03) * (0.1 / 0.66);
    b.rbox('rubber_tire', 0.36, 0.03, 0.36, 0.012, 0, 0.015, 0);
    b.lathe('rubber_tire', [[0.17, 0.03], [0.15, 0.045], [0.14, 0.05]], 0, 0, 0, 0, 0, 0, 24);
    b.lathe('plastic_orange', [[rr(0.03), 0.03], [rr(0.69), 0.69, 1], [0.031, 0.7], [0.026, 0.705, 1], [0.022, 0.69]], 0, 0, 0, 0, 0, 0, 24);
    for (const [y0, y1] of [[0.33, 0.43], [0.5, 0.575]]) b.lathe('reflect', [[rr(y0) + 0.0018, y0], [rr(y1) + 0.0018, y1]], 0, 0, 0, 0, 0, 0, 24);
    return {
      colliders: [CB(0.36, 0.03, 0.36, 0, 0.015, 0), CC(rr(0.33), 0.3, 0, 0.18, 0), CC(rr(0.63), 0.3, 0, 0.48, 0)],
      mass: 2.5, material: 'plastic', breakInto: ['plastic_scrap', 'rubber'],
    };
  },
});
CUSTOM.reflect = () => new THREE.MeshStandardMaterial({ name: 'furn_reflect', color: 0xe8ecee, roughness: 0.3, metalness: 0.2, envMapIntensity: 1.6 });

region('wetfloor', 256, 512, (ctx, w, h, rng) => {
  const k = '#141414';
  ctx.strokeStyle = k; ctx.lineWidth = 6; rrect(ctx, 12, 30, w - 24, h - 44, 18); ctx.stroke();
  txt(ctx, 'CAUTION', w / 2, 72, 44, k);
  ctx.fillStyle = k; ctx.fillRect(28, 98, w - 56, 4);
  // warning triangle with slipping figure
  ctx.save(); ctx.translate(w / 2, 215);
  ctx.lineWidth = 9; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(0, -88); ctx.lineTo(92, 72); ctx.lineTo(-92, 72); ctx.closePath(); ctx.stroke();
  ctx.lineWidth = 9; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(6, -26, 11, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(-14, 22); ctx.lineTo(10, 42); ctx.moveTo(-14, 22); ctx.lineTo(-38, 34); ctx.moveTo(-4, -2); ctx.lineTo(26, -14); ctx.moveTo(-4, -2); ctx.lineTo(-30, 4); ctx.stroke();
  ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-60, 56); ctx.quadraticCurveTo(0, 46, 60, 56); ctx.stroke();
  ctx.restore();
  txt(ctx, 'WET', w / 2, 340, 52, k);
  txt(ctx, 'FLOOR', w / 2, 392, 52, k);
  ctx.fillRect(28, 422, w - 56, 3);
  txt(ctx, 'CUIDADO', w / 2, 446, 22, k);
  txt(ctx, 'PISO MOJADO', w / 2, 472, 22, k);
});

def('wet_floor_sign', {
  build(b) {
    const sh = new THREE.Shape();
    const w = 0.15, L = 0.62, r = 0.05;
    sh.moveTo(-w, -L); sh.lineTo(w, -L); sh.lineTo(w * 0.86, -r); sh.quadraticCurveTo(w * 0.84, 0, w * 0.84 - r, 0); sh.lineTo(-w * 0.84 + r, 0); sh.quadraticCurveTo(-w * 0.84, 0, -w * 0.86, -r); sh.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-0.05, -0.035); hole.lineTo(0.05, -0.035); hole.quadraticCurveTo(0.06, -0.035, 0.06, -0.05); hole.quadraticCurveTo(0.06, -0.065, 0.05, -0.065); hole.lineTo(-0.05, -0.065); hole.quadraticCurveTo(-0.06, -0.065, -0.06, -0.05); hole.quadraticCurveTo(-0.06, -0.035, -0.05, -0.035);
    sh.holes.push(hole);
    const th = 0.2, top = L * Math.cos(th) + 0.004;
    const cols = [];
    for (const s of [1, -1]) {
      const rx = -s * th, zo = s * 0.006;
      b.ext('plastic_yellow', sh, 0.008, 0, top, zo, rx, 0, 0, 0.0015, 1, 6);
      const e = new THREE.Euler(rx, 0, 0);
      const c = V(0, -0.33, s * 0.0062).applyEuler(e).add(V(0, top, zo));
      b.decal('wetfloor', 0.25, 0.5, c.x, c.y, c.z, rx, s > 0 ? 0 : PI, 0);
      for (const fx of [-0.12, 0.12]) { const f = V(fx, -L + 0.01, s * 0.0) .applyEuler(e).add(V(0, top, zo)); b.box('rubber_tire', 0.05, 0.02, 0.025, f.x, f.y, f.z, rx, 0, 0); }
      const m = V(0, -L / 2, 0).applyEuler(e).add(V(0, top, zo));
      cols.push(CB(0.3, L, 0.012, m.x, m.y, m.z, rx, 0, 0));
    }
    b.cyl('#3b3b3b', 0.006, 0.006, 0.24, 0, top - 0.008, 0, 0, 0, HP, 8);
    return { colliders: cols, mass: 1.3, material: 'plastic', breakInto: ['plastic_scrap', 'plastic_scrap'] };
  },
});

region('barrel_label', 256, 192, (ctx, w, h, rng) => {
  ctx.fillStyle = '#efece2'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#222'; ctx.lineWidth = 3; ctx.strokeRect(5, 5, w - 10, h - 10);
  // NFPA style diamond
  ctx.save(); ctx.translate(58, 96); ctx.rotate(PI / 4);
  const q = 30;
  [['#2e5aa8', -q, 0], ['#c8302a', -q, -q], ['#e6c62a', 0, -q], ['#f4f4f4', 0, 0]].forEach(([c, x, y]) => { ctx.fillStyle = c; ctx.fillRect(x, y, q, q); ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.strokeRect(x, y, q, q); });
  ctx.restore();
  txt(ctx, '1', 36, 96, 18, '#fff'); txt(ctx, '0', 58, 74, 18, '#fff'); txt(ctx, '0', 80, 96, 18, '#111');
  txt(ctx, 'NON-POTABLE', 172, 50, 22, '#111');
  txt(ctx, 'WATER', 172, 76, 22, '#111');
  txt(ctx, 'DO NOT DRINK', 172, 106, 15, '#b02020');
  txt(ctx, 'ROOM CORP. FACILITIES', 172, 140, 11, '#333', { fam: 'mono' });
  txt(ctx, 'DRUM 55 GAL  #0447', 172, 160, 11, '#333', { fam: 'mono' });
  grunge(ctx, w, h, rng, 250, 0.7, 3);
});

def('barrel', {
  variants: 2,
  mats: (o, v) => ({ drum: tint('plastic_blue', o.color ?? (v ? 0x2f6b4a : 0x24539a), { roughness: 0.8 }) }),
  build(b, v) {
    b.lathe('drum', [[0, 0.012], [0.255, 0.012, 1], [0.27, 0.0, 1], [0.287, 0.004], [0.29, 0.03, 1], [0.29, 0.27], [0.302, 0.285], [0.302, 0.305], [0.29, 0.32], [0.29, 0.56], [0.302, 0.575], [0.302, 0.595], [0.29, 0.61], [0.29, 0.86, 1], [0.287, 0.885], [0.27, 0.892, 1], [0.255, 0.878, 1], [0, 0.875]], 0, 0, 0, 0, 0, 0, 28);
    for (const [x, r] of [[0.17, 0.034], [-0.17, 0.022]]) {
      b.cyl('drum', r + 0.006, r + 0.006, 0.006, x, 0.878, 0.0, 0, 0, 0, 14);
      b.cyl('#e6e3d8', r, r, 0.014, x, 0.884, 0.0, 0, 0, 0, 14);
      for (let k = 0; k < 6; k++) b.box('#e6e3d8', 0.006, 0.012, 0.004, x + Math.cos(k) * r, 0.884, Math.sin(k) * r, 0, -k, 0);
    }
    b.cylDecal('barrel_label', 0.2915, 0.2, 0, 0.95, 0, 0.44, 0);
    if (v === 1) b.decal('stain', 0.25, 0.25, 0.05, 0.8785, -0.05, -HP, 0, 0);
    return {
      colliders: [CC(0.29, 0.89, 0, 0.445, 0)],
      mass: 15, material: 'plastic', breakInto: ['plastic_scrap', 'plastic_scrap', 'plastic_scrap'],
      anchors: { top: [0, 0.89, 0] },
    };
  },
});

region('janitor', 128, 64, (ctx, w, h, rng) => {
  txt(ctx, 'ROOM CORP', w / 2, 18, 15, 'rgba(20,20,20,0.9)');
  txt(ctx, 'JANITORIAL', w / 2, 38, 13, 'rgba(20,20,20,0.9)', { fam: 'mono' });
  txt(ctx, '35 QT', w / 2, 56, 11, 'rgba(20,20,20,0.9)', { fam: 'mono' });
});

def('bucket', {
  variants: 2,
  build(b, v) {
    const g = taperGeo(new RoundedBoxGeometry(0.36, 0.27, 0.44, 2, 0.05), 1, -0.135, 0.135, (t, p) => { p.x *= 0.88 + 0.12 * t; p.z *= 0.9 + 0.1 * t; });
    b.add('plastic_yellow', g, 0, 0.075 + 0.135, 0);
    for (const s of [-1, 1]) {
      b.rbox('plastic_yellow', 0.39, 0.035, 0.03, 0.01, 0, 0.36, s * 0.225);
      b.rbox('plastic_yellow', 0.03, 0.035, 0.45, 0.01, s * 0.18, 0.36, 0);
    }
    b.box(v ? '#57594a' : '#6e6a52', 0.335, 0.004, 0.415, 0, 0.352, 0);
    b.rbox('plastic_yellow', 0.1, 0.03, 0.06, 0.012, 0, 0.365, 0.245);
    b.rbox('plastic_yellow', 0.38, 0.035, 0.46, 0.012, 0, 0.065, 0);
    for (const [x, z] of [[-0.15, -0.18], [0.15, -0.18], [-0.15, 0.18], [0.15, 0.18]]) casterAt(b, x, z, 0.06, x * 10 + z * 3);
    // side-press wringer
    b.rbox('plastic_grey', 0.3, 0.14, 0.17, 0.02, 0, 0.44, -0.11, 0, 0, 0, 1);
    b.box('#1d1d1d', 0.22, 0.006, 0.05, 0, 0.511, -0.08);
    b.rbox('plastic_grey', 0.32, 0.05, 0.05, 0.01, 0, 0.385, -0.11);
    b.tube('chrome', [[0.17, 0.45, -0.06], [0.17, 0.92, -0.17], [-0.17, 0.92, -0.17], [-0.17, 0.45, -0.06]], 0.011, { radial: 8, round: 0.06 });
    b.cyl('plastic_black', 0.017, 0.017, 0.24, 0, 0.92, -0.17, 0, 0, HP, 12);
    for (const s of [-1, 1]) b.cyl('chrome', 0.018, 0.018, 0.02, s * 0.165, 0.45, -0.06, 0, 0, HP, 10);
    b.decal('janitor', 0.16, 0.08, 0, 0.21, 0.222, -0.1, 0, 0);
    return {
      colliders: [CB(0.38, 0.33, 0.46, 0, 0.205, 0), CB(0.3, 0.14, 0.17, 0, 0.44, -0.11), CBbetween([0, 0.5, -0.08], [0, 0.93, -0.17], 0.36, 0.03)],
      mass: v ? 16 : 6.5, material: 'plastic', breakInto: ['plastic_scrap', 'plastic_scrap', 'wheel', 'metal_tube'],
    };
  },
});

region('jug_label', 512, 96, (ctx, w, h, rng) => {
  ctx.fillStyle = 'rgba(240,246,250,0.92)'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1e4f9a'; ctx.fillRect(0, 0, w, 14); ctx.fillRect(0, h - 14, w, 14);
  for (const x of [128, 384]) {
    txt(ctx, 'ROOM SPRINGS', x, 40, 26, '#1e4f9a', { fam: 'serif' });
    txt(ctx, 'PURE DRINKING WATER · 5 GAL (18.9 L)', x, 66, 11, '#244', { fam: 'mono' });
  }
  ctx.fillStyle = '#1e4f9a'; ctx.beginPath(); ctx.moveTo(256, 30); ctx.quadraticCurveTo(268, 52, 256, 62); ctx.quadraticCurveTo(244, 52, 256, 30); ctx.fill();
});

def('water_jug', {
  variants: 2,
  build(b, v) {
    const prof = [[0, 0.004], [0.1, 0.004], [0.128, 0.018], [0.135, 0.04], [0.135, 0.095], [0.129, 0.105], [0.135, 0.115], [0.135, 0.2], [0.129, 0.21], [0.135, 0.22], [0.135, 0.31], [0.128, 0.35], [0.1, 0.395], [0.055, 0.432], [0.034, 0.445], [0.031, 0.475]];
    b.lathe('jug', prof, 0, 0, 0, 0, 0, 0, 24);
    b.lathe('plastic_blue', [[0.0315, 0.462], [0.035, 0.466], [0.035, 0.495], [0.03, 0.5], [0, 0.5]], 0, 0, 0, 0, 0, 0, 16);
    b.tor('plastic_blue', 0.033, 0.003, 0, 0.47, 0, HP, 0, 0, 4, 16);
    if (v === 0) b.lathe('water', [[0, 0.008], [0.098, 0.008], [0.124, 0.02], [0.13, 0.04], [0.13, 0.31], [0.122, 0.345], [0.1, 0.37], [0, 0.371]], 0, 0, 0, 0, 0, 0, 20);
    b.cylDecal('jug_label', 0.1365, 0.075, 0, 3.4, 0, 0.158, 0);
    return {
      colliders: [CC(0.135, 0.36, 0, 0.18, 0), CC(0.034, 0.13, 0, 0.435, 0)],
      mass: v ? 0.8 : 19, material: 'plastic', breakInto: ['plastic_scrap', 'plastic_scrap'],
      renderOrder: { water: 1, jug: 2 },
    };
  },
});

// ===========================================================================
// Electronics & desk items
// ===========================================================================
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', ' ': '', '-': 'g' };
function seg7(ctx, str, x, y, hg, on, off) {
  const w = hg * 0.5, t = hg * 0.11;
  let cx = x;
  ctx.save();
  ctx.transform(1, 0, -0.08, 1, y * 0.08, 0);
  for (const ch of str) {
    if (ch === ':') { ctx.fillStyle = on; ctx.fillRect(cx + t * 0.4, y + hg * 0.27, t, t); ctx.fillRect(cx + t * 0.4, y + hg * 0.64, t, t); cx += t * 2.4; continue; }
    if (ch === '.') { ctx.fillStyle = on; ctx.fillRect(cx, y + hg - t, t, t); cx += t * 2; continue; }
    const s = SEG[ch] ?? '';
    const R = { a: [cx + t, y, w - 2 * t, t], b: [cx + w - t, y + t, t, hg / 2 - 1.5 * t], c: [cx + w - t, y + hg / 2 + 0.5 * t, t, hg / 2 - 1.5 * t], d: [cx + t, y + hg - t, w - 2 * t, t], e: [cx, y + hg / 2 + 0.5 * t, t, hg / 2 - 1.5 * t], f: [cx, y + t, t, hg / 2 - 1.5 * t], g: [cx + t, y + hg / 2 - t / 2, w - 2 * t, t] };
    for (const k of 'abcdefg') { if (!s.includes(k) && !off) continue; ctx.fillStyle = s.includes(k) ? on : off; const r = R[k]; ctx.fillRect(r[0], r[1], r[2], r[3]); }
    cx += w + t * 1.6;
  }
  ctx.restore();
}
const KEY_GLYPHS = ['Esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', '`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Bksp', 'Tab',
  'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\', 'Caps', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'Enter', 'Shift', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/',
  'Ctrl', 'Alt', 'Ins', 'Home', 'PgUp', 'Del', 'End', 'PgDn', '↑', '←', '↓', '→', 'Num', '*', '+', 'PrtSc', 'ScrLk', 'Pause', '#', 'MUTE', 'HOLD', 'REDIAL', 'XFER', 'CONF', 'SPKR'];
const KEY_IDX = new Map(KEY_GLYPHS.map((k, i) => [k, i]));
region('keyglyphs', 512, 256, (ctx) => {
  KEY_GLYPHS.forEach((k, i) => {
    const x = (i % 16) * 32, y = Math.floor(i / 16) * 32;
    const n = [...k].length;
    txt(ctx, k, x + 16, y + 16, n === 1 ? 20 : n === 2 ? 14 : n === 3 ? 11 : 8.5, '#2b2822', { weight: n === 1 ? 'bold' : 'bold' });
  });
});
function glyphUV(k) { return rUV('keyglyphs', KEY_IDX.get(k) ?? KEY_IDX.get('*'), 16, 8); }

region('tower_badge', 128, 48, (ctx) => {
  logo(ctx, 18, 24, 22, '#4a4436');
  txt(ctx, 'ROOM CORP', 76, 16, 14, '#4a4436');
  txt(ctx, '486DX2 / 66', 76, 34, 12, '#7a2a20', { fam: 'mono' });
});
region('mhz', 64, 40, (ctx) => {
  ctx.fillStyle = '#120202'; ctx.fillRect(0, 0, 64, 40);
  seg7(ctx, '66', 12, 6, 28, '#ff3a20', '#2a0805');
});
region('cdrom', 96, 24, (ctx) => {
  txt(ctx, 'CD-ROM', 34, 12, 12, '#3c372d');
  ctx.strokeStyle = '#3c372d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(80, 12, 8, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(80, 12, 2, 0, TAU); ctx.stroke();
});
region('floppy_lbl', 64, 16, (ctx) => txt(ctx, '1.44 MB', 32, 8, 9, '#3c372d', { fam: 'mono' }));
region('fan_grille', 128, 128, (ctx) => {
  ctx.strokeStyle = 'rgba(20,20,20,0.95)'; ctx.lineWidth = 5;
  for (let r = 12; r < 62; r += 10) { ctx.beginPath(); ctx.arc(64, 64, r, 0, TAU); ctx.stroke(); }
  ctx.fillStyle = 'rgba(20,20,20,0.95)'; ctx.fillRect(61, 4, 6, 120); ctx.fillRect(4, 61, 120, 6);
});
region('ports', 128, 192, (ctx, w, h, rng) => {
  ctx.fillStyle = 'rgba(160,160,160,0.95)'; ctx.fillRect(0, 0, w, h);
  const P = [['#5a2a6a', 10, 10, 18, 18], ['#2a6a3a', 34, 10, 18, 18], ['#c26a9a', 10, 40, 100, 14], ['#2a3a8a', 10, 62, 46, 14], ['#555', 62, 62, 46, 14], ['#555', 10, 84, 46, 14], ['#222', 70, 88, 10, 10], ['#c8a03a', 86, 88, 10, 10]];
  for (const [c, x, y, ww, hh] of P) { ctx.fillStyle = c; rrect(ctx, x, y, ww, hh, 3); ctx.fill(); ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5; ctx.stroke(); }
  for (let i = 0; i < 3; i++) { ctx.fillStyle = '#8a8a8a'; ctx.fillRect(8 + i * 38, 110, 32, 76); ctx.strokeStyle = '#555'; ctx.strokeRect(8 + i * 38, 110, 32, 76); }
});

def('computer_tower', {
  variants: 2,
  build(b, v) {
    const W = 0.19, H = 0.42, D = 0.43, y0 = 0.008;
    for (const [x, z] of [[-0.07, -0.18], [0.07, -0.18], [-0.07, 0.17], [0.07, 0.17]]) b.cyl('#1e1e1e', 0.012, 0.012, y0, x, y0 / 2, z, 0, 0, 0, 8);
    b.rbox('paint_beige', W, H - 0.005, D - 0.02, 0.006, 0, y0 + (H - 0.005) / 2, -0.01);
    b.rbox('plastic_beige', W + 0.004, H, 0.032, 0.012, 0, y0 + H / 2, D / 2 - 0.016, 0, 0, 0, 2);
    const fz = D / 2 + 0.0005;
    // 5.25" bays: CD-ROM + blank
    b.rbox('#cbbf9f', 0.148, 0.042, 0.01, 0.003, 0, y0 + 0.37, fz);
    b.box('#5a5446', 0.13, 0.002, 0.002, 0, y0 + 0.366, fz + 0.0055);
    b.rbox('#b7ab8c', 0.016, 0.007, 0.006, 0.002, 0.052, y0 + 0.358, fz + 0.005);
    b.box('emissive_amber', 0.004, 0.003, 0.002, 0.03, y0 + 0.358, fz + 0.0055);
    b.cyl('#222', 0.003, 0.003, 0.004, -0.058, y0 + 0.358, fz + 0.005, HP, 0, 0, 8);
    b.decal('cdrom', 0.045, 0.011, -0.03, y0 + 0.378, fz + 0.0055);
    b.rbox('#d3c8aa', 0.148, 0.042, 0.008, 0.003, 0, y0 + 0.322, fz);
    // 3.5" floppy
    b.rbox('#cbbf9f', 0.102, 0.027, 0.01, 0.003, 0.0, y0 + 0.276, fz);
    b.box('#2a2620', 0.09, 0.0035, 0.002, 0, y0 + 0.28, fz + 0.0055);
    b.rbox('#b7ab8c', 0.014, 0.006, 0.006, 0.002, 0.034, y0 + 0.268, fz + 0.005);
    b.box('emissive_green', 0.004, 0.003, 0.002, -0.04, y0 + 0.268, fz + 0.0055);
    b.decal('floppy_lbl', 0.03, 0.0075, -0.005, y0 + 0.268, fz + 0.0055);
    // front panel controls
    b.rbox('#bfb394', 0.03, 0.03, 0.012, 0.005, -0.045, y0 + 0.2, fz + 0.002);
    b.rbox('#bfb394', 0.012, 0.012, 0.008, 0.003, 0.0, y0 + 0.2, fz + 0.001);
    b.rbox('#bfb394', 0.024, 0.012, 0.008, 0.003, 0.04, y0 + 0.2, fz + 0.001);
    b.box('emissive_green', 0.005, 0.003, 0.003, -0.02, y0 + 0.235, fz + 0.001);
    b.box('emissive_amber', 0.005, 0.003, 0.003, 0.0, y0 + 0.235, fz + 0.001);
    b.decal('mhz', 0.03, 0.019, 0.045, y0 + 0.237, fz + 0.0012, 0, 0, 0, { slot: 'glow' });
    b.decal('vents', 0.15, 0.07, 0, y0 + 0.07, fz + 0.0012);
    b.decal('tower_badge', 0.1, 0.0375, 0, y0 + 0.14, fz + 0.0012, 0, 0, 0, { slot: 'atlas' });
    // back
    b.decal('fan_grille', 0.08, 0.08, -0.04, y0 + 0.36, -D / 2 - 0.0105, 0, PI, 0);
    b.decal('ports', 0.1, 0.15, 0.03, y0 + 0.17, -D / 2 - 0.0105, 0, PI, 0, { slot: 'atlas' });
    for (const [x, y] of [[-0.085, 0.4], [0.085, 0.4], [-0.085, 0.02], [0.085, 0.02]]) b.cyl('steel', 0.004, 0.004, 0.004, x, y0 + y, -D / 2 - 0.011, HP, 0, 0, 6);
    if (v === 1) b.decal('asset_tag', 0.07, 0.026, W / 2 + 0.0005, y0 + 0.3, 0.1, 0, HP, 0);
    b.decal('vents', 0.12, 0.06, W / 2 + 0.0005, y0 + 0.08, -0.12, 0, HP, 0);
    return { colliders: [CB(W + 0.004, H + y0, D, 0, (H + y0) / 2, 0)], mass: 10, material: 'metal', breakInto: ['electronics', 'electronics', 'metal_scrap', 'wire', 'screws'], anchors: { top: [0, H + y0, 0] } };
  },
});

function keyLayout() {
  const R = [];
  const row = (y, x0, keys) => { let x = x0; for (const k of keys) { if (typeof k === 'number') { x += k; continue; } const [l, w = 1, h = 1] = Array.isArray(k) ? k : [k]; R.push({ l, x, y, w, h }); x += w; } };
  row(5.25, 0, ['Esc', 1, 'F1', 'F2', 'F3', 'F4', 0.5, 'F5', 'F6', 'F7', 'F8', 0.5, 'F9', 'F10', 'F11', 'F12', 0.25, 'PrtSc', 'ScrLk', 'Pause']);
  row(4, 0, ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', ['Bksp', 2], 0.25, 'Ins', 'Home', 'PgUp', 0.25, 'Num', '/', '*', '-']);
  row(3, 0, [['Tab', 1.5], 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', ['\\', 1.5], 0.25, 'Del', 'End', 'PgDn', 0.25, '7', '8', '9', ['+', 1, 2]]);
  row(2, 0, [['Caps', 1.75], 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", ['Enter', 2.25], 3.5, '4', '5', '6']);
  row(1, 0, [['Shift', 2.25], 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', ['Shift', 2.75], 1.25, '↑', 1.25, '1', '2', '3', ['Enter', 1, 2]]);
  row(0, 0, [['Ctrl', 1.5], 1, ['Alt', 1.5], ['', 7], ['Alt', 1.5], 1, ['Ctrl', 1.5], 0.25, '←', '↓', '→', 0.25, ['0', 2], '.']);
  return R;
}
const MOD_KEYS = new Set(['Esc', 'Bksp', 'Tab', 'Caps', 'Enter', 'Shift', 'Ctrl', 'Alt', 'Num', '+', 'Ins', 'Home', 'PgUp', 'Del', 'End', 'PgDn', 'PrtSc', 'ScrLk', 'Pause', '↑', '←', '↓', '→']);
const keyGeoCache = new Map();
function keyCapGeo(w, d, h) {
  const k = `${w}|${d}|${h}`;
  if (!keyGeoCache.has(k)) keyGeoCache.set(k, taperGeo(new THREE.BoxGeometry(w, h, d), 1, -h / 2, h / 2, (t, p) => { p.x *= 1 - 0.14 * t * (0.012 / Math.max(w, 0.012)); p.z *= 1 - 0.16 * t; }));
  return keyGeoCache.get(k).clone();
}
region('kb_badge', 96, 24, (ctx) => { logo(ctx, 12, 12, 14, '#5a5446'); txt(ctx, 'ROOM CORP', 56, 12, 11, '#5a5446'); });

def('keyboard', {
  build(b) {
    const u = 0.019, W = 0.46, D = 0.18, tilt = 0.06;
    const caseG = taperGeo(new RoundedBoxGeometry(W, 0.03, D, 1, 0.008), 2, D / 2, -D / 2, (t, p) => { if (p.y > 0) p.y += t * 0.012; });
    b.add('plastic_beige', caseG, 0, 0.015, 0);
    b.box('#a39a82', W - 0.02, 0.002, D - 0.035, 0, 0.0302 + 0.006, 0.006, -tilt * 0.6);
    const keys = keyLayout();
    const x0 = -W / 2 + 0.012, z0 = D / 2 - 0.022;
    const plane = (x, rowY) => { const z = z0 - rowY * u; return [x, 0.036 + (z0 - z) * 0.066 + 0.0045, z]; };
    for (const k of keys) {
      const cx = x0 + (k.x + k.w / 2) * u, rowY = k.y + (k.h - 1) / 2;
      const [x, y, z] = plane(cx, rowY);
      const g = keyCapGeo(k.w * u - 0.0032, k.h * u - 0.0032, 0.009);
      b.add(MOD_KEYS.has(k.l) ? '#b8ae94' : '#d7ceb3', g, x, y, z, -tilt * 0.6, 0, 0);
      if (k.l) {
        const gl = prep(new THREE.PlaneGeometry(0.0095, 0.0095));
        mapUV(gl, glyphUV(k.l));
        const lx = k.w > 1.2 ? x - (k.w * u) / 2 + 0.0075 : x;
        xform(gl, lx, y + 0.0047, z + (k.h > 1 ? 0 : 0.0005), -HP - tilt * 0.6, 0, 0);
        b._push('decal', gl);
      }
    }
    const [lx, ly, lz] = plane(x0 + 19.5 * u, 5.25);
    for (let i = 0; i < 3; i++) b.box('emissive_green', 0.004, 0.0015, 0.0025, lx + i * 0.016, ly - 0.004, lz, -tilt * 0.6, 0, 0);
    b.decal('kb_badge', 0.05, 0.0125, x0 + 0.03, ly - 0.0035, lz - 0.0005 + 0.0, -HP - tilt * 0.6, 0, 0);
    b.tube('#d0c7ab', [[0.0, 0.02, -D / 2 + 0.005], [0.0, 0.016, -D / 2 - 0.03], [0.02, 0.006, -D / 2 - 0.07]], 0.0028, { radial: 5, round: 0.02 });
    return { colliders: [CB(W, 0.04, D, 0, 0.02, 0)], mass: 1.1, material: 'plastic', breakInto: ['plastic_scrap', 'electronics', 'wire'] };
  },
});

region('phone_lcd', 128, 32, (ctx) => {
  ctx.fillStyle = '#9fa98a'; ctx.fillRect(0, 0, 128, 32);
  txt(ctx, 'EXT 4471  12:00', 64, 11, 12, '#2a2f24', { fam: 'lcd', weight: 'normal' });
  txt(ctx, '1 NEW MESSAGE', 64, 24, 11, '#2a2f24', { fam: 'lcd', weight: 'normal' });
});
function coilAlong(pts, r, turns, per = 6) {
  const curve = new THREE.CatmullRomCurve3(pts.map(toV));
  const n = Math.ceil(turns * per);
  const fr = curve.computeFrenetFrames(n, false);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = t * turns * TAU;
    out.push(curve.getPointAt(t).addScaledVector(fr.normals[i], Math.cos(a) * r).addScaledVector(fr.binormals[i], Math.sin(a) * r));
  }
  return out;
}

def('desk_phone', {
  variants: 2,
  build(b, v) {
    const beige = v ? 'plastic_grey' : 'plastic_beige';
    const g = taperGeo(new RoundedBoxGeometry(0.2, 0.065, 0.22, 2, 0.014), 2, -0.11, 0.11, (t, p) => { if (p.y > -0.01) p.y -= t * 0.03; });
    b.add(beige, g, 0, 0.0325, 0);
    const slope = Math.atan2(0.03, 0.22);
    const yAt = (z) => 0.065 - ((z + 0.11) / 0.22) * 0.03;
    // handset cradle + handset
    b.rbox('#2d2a26', 0.065, 0.006, 0.2, 0.003, -0.058, yAt(0) + 0.001, 0, slope);
    b.rbox(beige, 0.045, 0.026, 0.13, 0.012, -0.058, yAt(0) + 0.03, 0, slope, 0, 0, 2);
    for (const s of [-1, 1]) b.rbox(beige, 0.056, 0.036, 0.062, 0.016, -0.058, yAt(s * 0.085) + 0.025, s * 0.085, slope, 0, 0, 2);
    // keypad
    const kx0 = 0.0, kz0 = -0.045;
    const labels = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
    labels.forEach((l, i) => {
      const x = kx0 + (i % 3) * 0.024, z = kz0 + Math.floor(i / 3) * 0.024, y = yAt(z) + 0.002;
      b.box('#e2dac6', 0.018, 0.006, 0.016, x, y, z, slope);
      const gl = prep(new THREE.PlaneGeometry(0.011, 0.011));
      mapUV(gl, glyphUV(l));
      xform(gl, x, y + 0.0032, z, -HP + slope, 0, 0);
      b._push('decal', gl);
    });
    ['MUTE', 'HOLD', 'REDIAL', 'XFER', 'CONF', 'SPKR'].forEach((l, i) => {
      const x = 0.075, z = -0.075 + i * 0.024, y = yAt(z) + 0.002;
      b.box('#b8b0a0', 0.016, 0.005, 0.014, x, y, z, slope);
      const gl = prep(new THREE.PlaneGeometry(0.013, 0.013));
      mapUV(gl, glyphUV(l));
      xform(gl, x, y + 0.003, z, -HP + slope, 0, 0);
      b._push('decal', gl);
    });
    b.decal('phone_lcd', 0.07, 0.018, 0.024, yAt(-0.08) + 0.0005, -0.08, -HP + slope, 0, 0, { slot: 'atlas' });
    b.box('emissive_red', 0.006, 0.003, 0.004, 0.075, yAt(-0.095) + 0.002, -0.097, slope);
    b.tube('#d6ccb0', coilAlong([[-0.058, 0.035, 0.12], [-0.06, 0.01, 0.16], [-0.11, 0.008, 0.14], [-0.115, 0.012, 0.06], [-0.101, 0.02, 0.03]], 0.0055, 24, 6), 0.0017, { radial: 4, caps: false });
    b.tube('#2a2a2a', [[0.0, 0.01, -0.105], [0.0, 0.004, -0.13], [0.02, 0.003, -0.16]], 0.002, { radial: 4, round: 0.015 });
    return {
      colliders: [CB(0.2, 0.065, 0.22, 0, 0.0325, 0), CB(0.056, 0.04, 0.23, -0.058, yAt(0) + 0.03, 0, slope, 0, 0)],
      mass: 1.2, material: 'plastic', breakInto: ['plastic_scrap', 'electronics', 'wire'],
    };
  },
});

region('mug_logo', 256, 288, (ctx, w, h, rng) => {
  // cell 0: logo
  logo(ctx, 60, 48, 52, '#2d4a7a');
  txt(ctx, 'ROOM', 160, 34, 34, '#2d4a7a');
  txt(ctx, 'CORP.', 160, 68, 26, '#2d4a7a');
  // cell 1
  txt(ctx, "WORLD'S", w / 2, 96 + 22, 24, '#8a2020', { fam: 'serif' });
  txt(ctx, 'OKAYEST', w / 2, 96 + 50, 28, '#8a2020', { fam: 'serif' });
  txt(ctx, 'EMPLOYEE', w / 2, 96 + 78, 20, '#8a2020', { fam: 'serif' });
  // cell 2
  txt(ctx, 'I SURVIVED', w / 2, 192 + 26, 24, '#1f5a4a');
  txt(ctx, 'Q3 1993', w / 2, 192 + 62, 34, '#1f5a4a');
});

def('mug', {
  variants: 3,
  mats: (o, v) => ({ cer: tint('ceramic', o.color ?? [0xf1eee6, 0xe9e2cf, 0x3d6f6a][v]) }),
  build(b, v) {
    b.lathe('cer', [[0, 0.003], [0.034, 0.003, 1], [0.039, 0.007], [0.041, 0.02], [0.041, 0.091], [0.0405, 0.0945], [0.038, 0.095, 1], [0.0365, 0.091], [0.0365, 0.014], [0.03, 0.01], [0, 0.0095]], 0, 0, 0, 0, 0, 0, 22);
    b.add('cer', new THREE.TorusGeometry(0.025, 0.0062, 6, 12, PI), 0.04, 0.052, 0, 0, 0, -HP, 'keep');
    if (v !== 1) b.cyl('#2a170c', 0.0362, 0.0362, 0.002, 0, 0.072, 0, 0, 0, 0, 18);
    else b.decal('stain', 0.06, 0.06, 0, 0.0108, 0, -HP, 0, 0);
    b.cylDecal('mug_logo', 0.0413, 0.05, 0, 1.7, 0, 0.052, 0, 0, 0, 0, { cell: v, cols: 1, rows: 3 });
    return { colliders: [CC(0.041, 0.095, 0, 0.0475, 0)], mass: 0.35, material: 'glass', breakInto: ['ceramic_shard', 'ceramic_shard'] };
  },
});

region('memo2', 192, 256, (ctx, w, h, rng) => {
  noiseFill(ctx, w, h, rng, '#f3f1ea', 200, 0.03);
  logo(ctx, 22, 22, 18, '#333');
  txt(ctx, 'ROOM CORP. — INTERNAL', 40, 22, 10, '#333', { align: 'left', fam: 'mono' });
  txt(ctx, 'QUARTERLY OCCUPANCY REPORT', w / 2, 46, 11, '#111');
  lines(ctx, 14, 62, w - 28, 6, 11, rng, 'rgba(30,30,40,0.7)', 2);
  ctx.strokeStyle = '#444'; ctx.strokeRect(14, 136, w - 28, 60);
  for (let i = 0; i < 5; i++) { ctx.fillStyle = '#556'; const hh = 10 + rng.next() * 40; ctx.fillRect(24 + i * 30, 192 - hh, 16, hh); }
  lines(ctx, 14, 208, w - 28, 3, 11, rng, 'rgba(30,30,40,0.7)', 2);
  txt(ctx, 'PAGE 1 OF ∞', w / 2, 248, 9, '#555', { fam: 'mono' });
});

def('paper_stack', {
  variants: 2,
  build(b, v, rng) {
    const W = 0.216, D = 0.279;
    let y = 0;
    const n = 6;
    for (let i = 0; i < n; i++) {
      const t = 0.007 + rng.next() * 0.003;
      b.box('paper', W, t, D, (rng.next() - 0.5) * 0.008, y + t / 2, (rng.next() - 0.5) * 0.008, 0, (rng.next() - 0.5) * 0.06, 0);
      y += t;
    }
    const ry = (rng.next() - 0.5) * 0.08;
    b.decal(v ? 'memo' : 'memo2', W - 0.004, D - 0.004, 0, y + 0.0004, 0, -HP, 0, ry, { slot: 'atlas' });
    if (v) b.decal('stain', 0.09, 0.09, 0.05, y + 0.0008, 0.07, -HP, 0, 0);
    // binder clip on the corner
    b.box('plastic_black', 0.032, 0.006, 0.02, -W / 2 + 0.03, y + 0.003, -D / 2 + 0.008, 0, ry, 0);
    b.box('plastic_black', 0.032, 0.006, 0.02, -W / 2 + 0.03, 0.003 - 0.002, -D / 2 + 0.008, 0, ry, 0);
    for (const s of [-1, 1]) b.tube('chrome', [[-W / 2 + 0.03 + s * 0.012, y + 0.005, -D / 2 + 0.004], [-W / 2 + 0.03 + s * 0.012, y + 0.016, -D / 2 - 0.012], [-W / 2 + 0.03 + s * 0.008, y + 0.012, -D / 2 - 0.03]], 0.0011, { radial: 4, round: 0.008 });
    return { colliders: [CB(W + 0.006, y, D + 0.006, 0, y / 2, 0)], mass: 1.4, material: 'paper', breakInto: ['paper', 'paper', 'paper'] };
  },
});

def('binder', {
  variants: 4,
  build(b, v) {
    const T = 0.065, H = 0.3, D = 0.28, col = BINDER_COLS[v];
    for (const s of [-1, 1]) b.rbox(col, 0.004, H, D, 0.0015, s * (T / 2 - 0.002), H / 2, 0);
    b.add('atlas', bookGeo(T, H, 0.004, rUV('binder_spines', v, 4, 1), col, col), 0, H / 2, D / 2 - 0.002, 0, 0, 0, 'keep');
    b.box('paper', T - 0.014, H - 0.016, D - 0.02, 0, H / 2, -0.004);
    for (const y of [0.07, 0.15, 0.23]) b.box('#e9e2ce', T - 0.02, 0.012, 0.006, 0, y, -D / 2 + 0.006);
    return { colliders: [CB(T, H, D, 0, H / 2, 0)], mass: 0.9, material: 'paper', breakInto: ['paper', 'paper', 'plastic_scrap'] };
  },
});

region('printer_lcd', 96, 24, (ctx) => {
  ctx.fillStyle = '#1d2a12'; ctx.fillRect(0, 0, 96, 24);
  txt(ctx, '00 READY', 48, 12, 16, '#b8f070', { fam: 'lcd', weight: 'normal' });
});
region('printer_badge', 128, 32, (ctx) => {
  txt(ctx, 'ROOMJET 4L', 4, 12, 15, '#4a4436', { align: 'left' });
  txt(ctx, 'LASER PRINTER · 300 DPI', 4, 26, 9, '#6a6455', { align: 'left', fam: 'mono' });
});
region('tray_lbl', 64, 16, (ctx) => { txt(ctx, 'LETTER  ▲', 32, 8, 10, '#3c372d', { fam: 'mono' }); });

def('printer', {
  variants: 2,
  build(b, v, rng) {
    const W = 0.42;
    for (const [x, z] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) b.cyl('#1e1e1e', 0.012, 0.012, 0.01, x, 0.005, z, 0, 0, 0, 8);
    b.rbox('plastic_beige', W, 0.22, 0.42, 0.02, 0, 0.12, 0, 0, 0, 0, 2);
    const top = taperGeo(new RoundedBoxGeometry(W - 0.01, 0.09, 0.34, 2, 0.03), 2, -0.17, 0.17, (t, p) => { if (p.y > 0) p.y -= t * 0.035; });
    b.add('plastic_beige', top, 0, 0.26, -0.035);
    b.box('#5e5a52', 0.27, 0.008, 0.15, -0.04, 0.287, 0.0, 0.12, 0, 0);
    // printed sheet in the output bin, curling up
    const sg = new THREE.PlaneGeometry(0.216, 0.16, 1, 6);
    const sp = sg.attributes.position;
    for (let i = 0; i < sp.count; i++) { const y = sp.getY(i); sp.setZ(i, Math.pow((y + 0.08) / 0.16, 2) * 0.02); }
    sg.computeVertexNormals();
    b.add('paper2', sg, -0.04, 0.293, 0.0, -HP + 0.12, 0, 0, 'keep');
    b.decal(v ? 'memo' : 'memo2', 0.2, 0.14, -0.04, 0.2935, 0.0, -HP + 0.12, 0, 0, { slot: 'decal' });
    // paper cassette
    b.rbox('#cfc4a6', 0.38, 0.06, 0.03, 0.008, 0, 0.055, 0.205);
    b.box('#2a2620', 0.1, 0.012, 0.004, 0, 0.068, 0.221);
    b.decal('tray_lbl', 0.06, 0.015, 0.12, 0.045, 0.2205);
    // control panel
    b.box('#4a4842', 0.12, 0.004, 0.07, 0.13, 0.247, 0.17, 0.25, 0, 0);
    b.decal('printer_lcd', 0.06, 0.015, 0.11, 0.25, 0.165, -HP + 0.25, 0, 0, { slot: 'glow' });
    for (let i = 0; i < 4; i++) b.rbox('#d8cfb4', 0.014, 0.006, 0.01, 0.002, 0.095 + i * 0.022, 0.244, 0.19, 0.25);
    b.box('emissive_green', 0.004, 0.003, 0.004, 0.175, 0.252, 0.155, 0.25);
    b.box('emissive_amber', 0.004, 0.003, 0.004, 0.175, 0.249, 0.168, 0.25);
    b.decal('printer_badge', 0.11, 0.0275, -0.12, 0.2, 0.2105);
    for (const s of [-1, 1]) b.decal('vents', 0.2, 0.08, s * (W / 2 + 0.0005), 0.15, -0.05, 0, s * HP, 0);
    return { colliders: [CB(W, 0.31, 0.44, 0, 0.155, 0)], mass: 18, material: 'plastic', breakInto: ['electronics', 'plastic_scrap', 'plastic_scrap', 'paper', 'screws'], anchors: { top: [0, 0.31, -0.1] } };
  },
});

region('mw_display', 96, 32, (ctx) => {
  ctx.fillStyle = '#04100c'; ctx.fillRect(0, 0, 96, 32);
  seg7(ctx, '12:00', 12, 5, 22, '#3dffb0', '#0c2a20');
});
region('mw_keys', 64, 128, (ctx) => {
  const L = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLR', '0', 'TIME'];
  L.forEach((l, i) => txt(ctx, l, 11 + (i % 3) * 21, 9 + Math.floor(i / 3) * 18, l.length > 1 ? 7 : 11, '#222'));
  txt(ctx, 'POWER', 32, 84, 9, '#222'); txt(ctx, 'START', 32, 112, 11, '#eee');
});
region('mwmesh', 128, 96, (ctx) => {
  ctx.fillStyle = 'rgba(10,10,10,0.55)'; ctx.fillRect(0, 0, 128, 96);
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  for (let y = 2; y < 96; y += 4) for (let x = 2 + ((y / 4) & 1) * 2; x < 128; x += 4) ctx.fillRect(x, y, 2, 2);
});

def('microwave', {
  variants: 2,
  build(b, v) {
    const W = 0.48, H = 0.28, D = 0.36, y0 = 0.012, body = v ? 'paint_dark' : 'paint_white';
    for (const [x, z] of [[-0.2, -0.14], [0.2, -0.14], [-0.2, 0.14], [0.2, 0.14]]) b.cyl('#1e1e1e', 0.012, 0.012, y0, x, y0 / 2, z, 0, 0, 0, 8);
    b.rbox(body, W, H, D, 0.012, 0, y0 + H / 2, 0, 0, 0, 0, 1);
    b.box('#3d3a34', 0.33, 0.23, 0.003, -0.065, y0 + H / 2, D / 2 + 0.001);
    // control panel
    const px = W / 2 - 0.065;
    b.box('#2a2a2c', 0.11, H - 0.03, 0.004, px, y0 + H / 2, D / 2 + 0.002);
    b.decal('mw_display', 0.08, 0.027, px, y0 + H - 0.04, D / 2 + 0.0045, 0, 0, 0, { slot: 'glow' });
    for (let i = 0; i < 12; i++) b.rbox('#d0d0cc', 0.02, 0.013, 0.005, 0.002, px - 0.022 + (i % 3) * 0.022, y0 + H - 0.08 - Math.floor(i / 3) * 0.018, D / 2 + 0.005);
    b.rbox('#d0d0cc', 0.064, 0.016, 0.005, 0.003, px, y0 + 0.08, D / 2 + 0.005);
    b.rbox('#a8302a', 0.064, 0.022, 0.005, 0.003, px, y0 + 0.05, D / 2 + 0.005);
    b.decal('mw_keys', 0.064, 0.128, px, y0 + H - 0.1 - 0.035, D / 2 + 0.0078, 0, 0, 0);
    for (const s of [-1, 1]) b.decal('vents', 0.16, 0.06, s * (W / 2 + 0.0005), y0 + H - 0.06, -0.06, 0, s * HP, 0);
    // door (opens around its left hinge)
    const hx = -W / 2 + 0.005, dz = D / 2 + 0.012;
    const p = b.part('door', hx, y0 + H / 2, dz, { axis: 'y', maxOpen: -1.9 });
    p.rbox(v ? 'paint_dark' : 'paint_white', 0.35, H - 0.025, 0.022, 0.008, hx + 0.175, y0 + H / 2, dz);
    p.box('#15130f', 0.25, 0.17, 0.004, hx + 0.155, y0 + H / 2 + 0.005, dz + 0.0105);
    p.decal('mwmesh', 0.25, 0.17, hx + 0.155, y0 + H / 2 + 0.005, dz + 0.0128);
    p.rbox('#bdbdb8', 0.02, 0.2, 0.024, 0.008, hx + 0.32, y0 + H / 2, dz + 0.02);
    return {
      colliders: [CB(W, H + y0, D + 0.03, 0, (H + y0) / 2, 0.012)],
      mass: 14, material: 'metal', breakInto: ['electronics', 'metal_scrap', 'glass_shard', 'wire'], anchors: { top: [0, H + y0, 0] },
    };
  },
});

region('tv_badge', 128, 24, (ctx) => { txt(ctx, 'ROOMVISION', 64, 12, 15, '#c9c4b4', { fam: 'serif' }); });
region('tv_grille', 64, 128, (ctx) => {
  ctx.fillStyle = 'rgba(8,8,8,0.9)';
  for (let y = 4; y < 124; y += 7) rrect(ctx, 6, y, 52, 3.5, 1.5), ctx.fill();
});

def('tv_crt', {
  variants: 2,
  build(b, v) {
    const W = 0.62, H = 0.5, D = 0.34, y0 = 0.012, wd = v ? 'wood' : 'wood_dark';
    for (const [x, z] of [[-0.27, -0.13], [0.27, -0.13], [-0.27, 0.13], [0.27, 0.13]]) b.cyl('#1a1a1a', 0.015, 0.015, y0, x, y0 / 2, z, 0, 0, 0, 8);
    b.rbox(wd, W, H, D, 0.012, 0, y0 + H / 2, 0, 0, 0, 0, 1);
    b.rbox('plastic_black', W - 0.03, H - 0.03, 0.02, 0.01, 0, y0 + H / 2, D / 2 + 0.001, 0, 0, 0, 1);
    b.add('plastic_black', taperBox(0.5, 0.4, 0.2, 0.55, 0.6, 0.03), 0, y0 + 0.24, -D / 2 - 0.1);
    b.decal('vents', 0.25, 0.1, 0, y0 + 0.4, -D / 2 - 0.15, -(HP + 0.6), 0, 0);
    const sx = -0.065, sy = y0 + 0.27, fz = D / 2 + 0.011;
    b.rbox('#1d1c1b', 0.455, 0.35, 0.004, 0.02, sx, sy, fz);
    b.named('screen', 'crt_glass', crtScreenGeo(0.42, 0.315, 1.1), sx, sy, fz - 0.003, 0, 0, 0, { uv: 'keep' });
    const cx = W / 2 - 0.075;
    b.decal('tv_grille', 0.08, 0.16, cx, y0 + 0.16, fz + 0.0005);
    b.lathe('#8a8a86', [[0.024, 0], [0.024, 0.016], [0.02, 0.022], [0, 0.023]], cx, y0 + 0.41, fz, HP, 0, 0, 16);
    b.box('#ddd', 0.003, 0.02, 0.003, cx, y0 + 0.42, fz + 0.024);
    b.lathe('#8a8a86', [[0.017, 0], [0.017, 0.014], [0.014, 0.019], [0, 0.02]], cx, y0 + 0.335, fz, HP, 0, 0, 14);
    b.rbox('#3a3a38', 0.04, 0.016, 0.01, 0.004, cx, y0 + 0.27, fz + 0.004);
    b.box('emissive_red', 0.004, 0.004, 0.003, cx + 0.03, y0 + 0.27, fz + 0.002);
    b.decal('tv_badge', 0.12, 0.0225, sx, y0 + 0.065, fz + 0.0005);
    // rabbit ears
    b.sph('plastic_black', 0.045, 0, y0 + H, -0.06, 14, 6, 1, 0.6, 1);
    for (const s of [-1, 1]) {
      const a = [s * 0.012, y0 + H + 0.022, -0.06], c = [s * 0.2, y0 + H + 0.46, -0.13];
      cylBetween(b, 'chrome', a, c, 0.0032, 0.0022, 6);
      b.sph('chrome', 0.005, c[0], c[1], c[2], 6, 4);
    }
    return {
      colliders: [CB(W, H + y0, D + 0.02, 0, (H + y0) / 2, 0.01), CB(0.28, 0.24, 0.2, 0, y0 + 0.2, -D / 2 - 0.1)],
      mass: 24, material: 'plastic', breakInto: ['glass_shard', 'electronics', 'plank', 'wire', 'screws'],
      anchors: { screen: [sx, sy, fz + 0.02], top: [0, y0 + H, 0.05] },
    };
  },
});

region('clock_display', 128, 48, (ctx) => {
  ctx.fillStyle = '#0d0202'; ctx.fillRect(0, 0, 128, 48);
  seg7(ctx, '12:00', 12, 8, 32, '#ff2a1a', '#260604');
  ctx.fillStyle = '#ff2a1a'; ctx.fillRect(116, 10, 5, 5);
  ctx.fillStyle = '#4a0c06'; ctx.fillRect(116, 32, 5, 5);
});
region('clock_lbl', 96, 16, (ctx) => { txt(ctx, 'SNOOZE', 48, 8, 10, '#bbb'); });

def('clock_desk', {
  build(b) {
    const g = taperGeo(new RoundedBoxGeometry(0.16, 0.075, 0.09, 2, 0.014), 1, -0.0375, 0.0375, (t, p) => { if (p.z > 0) p.z -= t * 0.018; });
    b.add('plastic_black', g, 0, 0.0375 + 0.004, 0);
    for (const s of [-1, 1]) b.box('#151515', 0.03, 0.004, 0.07, s * 0.055, 0.002, 0);
    const tilt = Math.atan2(0.018, 0.075);
    b.box('#1a0606', 0.13, 0.05, 0.002, 0, 0.042, 0.0455 - 0.009, -tilt, 0, 0);
    b.decal('clock_display', 0.105, 0.039, 0, 0.042, 0.0468 - 0.009, -tilt, 0, 0, { slot: 'glow' });
    b.rbox('#38383a', 0.11, 0.01, 0.024, 0.004, 0, 0.081, 0.008);
    b.decal('clock_lbl', 0.05, 0.008, 0, 0.0862, 0.008, -HP, 0, 0);
    for (let i = 0; i < 4; i++) b.rbox('#2c2c2e', 0.014, 0.006, 0.01, 0.002, -0.045 + i * 0.03, 0.079, -0.024);
    b.tube('#151515', [[0.04, 0.02, -0.044], [0.045, 0.008, -0.07], [0.06, 0.003, -0.1]], 0.0022, { radial: 4, round: 0.015 });
    return { colliders: [CB(0.16, 0.08, 0.09, 0, 0.04, 0)], mass: 0.45, material: 'plastic', breakInto: ['electronics', 'plastic_scrap', 'wire', 'battery'] };
  },
});

region('grille', 128, 128, (ctx) => {
  ctx.fillStyle = 'rgba(70,72,76,0.9)';
  ctx.beginPath(); ctx.arc(64, 64, 63, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(5,5,6,0.95)';
  for (let y = 4; y < 128; y += 5) for (let x = 4 + ((y / 5) & 1) * 2.5; x < 128; x += 5) { if ((x - 64) ** 2 + (y - 64) ** 2 < 58 * 58) { ctx.beginPath(); ctx.arc(x, y, 1.7, 0, TAU); ctx.fill(); } }
});
region('tuner', 192, 40, (ctx) => {
  ctx.fillStyle = '#e9e4d2'; ctx.fillRect(0, 0, 192, 40);
  ctx.fillStyle = '#222';
  for (let i = 0; i <= 40; i++) ctx.fillRect(10 + i * 4.3, i % 5 ? 14 : 10, 1, i % 5 ? 4 : 8);
  ['88', '92', '96', '100', '104', '108'].forEach((s, i) => txt(ctx, s, 10 + i * 34.4, 26, 9, '#222', { fam: 'mono' }));
  txt(ctx, 'FM', 6, 6, 7, '#a22', { align: 'left' });
  ctx.fillStyle = '#e8501a'; ctx.fillRect(118, 2, 2.5, 36);
});
region('cassette', 128, 80, (ctx) => {
  ctx.fillStyle = 'rgba(30,30,32,0.6)'; ctx.fillRect(0, 0, 128, 80);
  ctx.fillStyle = '#d8d2c0'; rrect(ctx, 12, 10, 104, 58, 4); ctx.fill();
  ctx.fillStyle = '#e8b04a'; ctx.fillRect(16, 14, 96, 14);
  marker(ctx, "MIXTAPE '93", 64, 21, 11, '#222', new RNG(5));
  ctx.fillStyle = '#2a2a2a'; rrect(ctx, 30, 34, 68, 22, 10); ctx.fill();
  ctx.fillStyle = '#d8d2c0'; for (const x of [44, 84]) { ctx.beginPath(); ctx.arc(x, 45, 7, 0, TAU); ctx.fill(); }
  ctx.fillStyle = '#5a3a20'; ctx.beginPath(); ctx.arc(44, 45, 11, 0, TAU); ctx.globalAlpha = 0.5; ctx.fill(); ctx.globalAlpha = 1;
});
region('boombox_badge', 256, 24, (ctx) => {
  txt(ctx, 'ROOM SOUND', 4, 12, 15, '#e8e8e8', { align: 'left' });
  txt(ctx, 'STEREO RADIO CASSETTE', 252, 12, 9, '#cfcfcf', { align: 'right', fam: 'mono' });
});
region('deck_keys', 128, 16, (ctx) => { ['REC', 'PLAY', 'REW', 'FF', 'STOP', 'PAUSE'].forEach((s, i) => txt(ctx, s, 10 + i * 21.5, 8, 7, '#ddd')); });
CUSTOM.silver = () => { const m = Mat.make('plastic_grey', { color: 0xb3b6bb, roughness: 0.32 }); m.metalness = 0.55; return m; };

def('radio_cassette', {
  variants: 2,
  build(b, v) {
    const W = 0.5, H = 0.24, D = 0.12, y0 = 0.006;
    b.rbox('plastic_black', W, H, D, 0.02, 0, y0 + H / 2, 0, 0, 0, 0, 2);
    b.rbox(v ? 'plastic_black' : 'silver', W - 0.02, H - 0.05, 0.006, 0.006, 0, y0 + H / 2 - 0.012, D / 2);
    const fz = D / 2 + 0.003;
    for (const s of [-1, 1]) {
      b.cyl('#141414', 0.072, 0.072, 0.004, s * 0.155, y0 + 0.105, fz, HP, 0, 0, 24);
      b.decal('grille', 0.142, 0.142, s * 0.155, y0 + 0.105, fz + 0.0025);
      b.tor('chrome', 0.073, 0.0035, s * 0.155, y0 + 0.105, fz + 0.002, 0, 0, 0, 5, 28);
      b.cyl('silver', 0.012, 0.012, 0.012, s * 0.215, y0 + 0.2, fz, HP, 0, 0, 12);
    }
    b.rbox('#262626', 0.13, 0.085, 0.006, 0.004, 0, y0 + 0.095, fz);
    b.decal('cassette', 0.1, 0.0625, 0, y0 + 0.097, fz + 0.0035);
    b.decal('tuner', 0.17, 0.035, 0, y0 + 0.19, fz + 0.0005, 0, 0, 0, { slot: 'atlas' });
    b.decal('boombox_badge', 0.19, 0.0178, 0, y0 + 0.155, fz + 0.0005);
    for (let i = 0; i < 6; i++) b.rbox(i === 0 ? '#9a2a22' : '#2b2b2b', 0.019, 0.012, 0.03, 0.003, -0.054 + i * 0.0215, y0 + H + 0.003, 0.03);
    b.decal('deck_keys', 0.13, 0.016, 0.0, y0 + H - 0.005, D / 2 + 0.0005, 0, 0, 0);
    b.tube('chrome', [[-0.2, y0 + H - 0.005, 0], [-0.17, y0 + H + 0.07, 0], [0.17, y0 + H + 0.07, 0], [0.2, y0 + H - 0.005, 0]], 0.0075, { radial: 8, round: 0.04 });
    for (const s of [-1, 1]) b.rbox('plastic_black', 0.035, 0.02, 0.03, 0.006, s * 0.2, y0 + H + 0.005, 0);
    b.cyl('chrome', 0.003, 0.003, 0.4, -0.02, y0 + H + 0.004, -0.045, 0, 0, HP, 6);
    b.sph('chrome', 0.005, 0.18, y0 + H + 0.004, -0.045, 6, 4);
    b.cyl('plastic_black', 0.008, 0.008, 0.012, -0.225, y0 + H + 0.004, -0.045, 0, 0, HP, 8);
    for (const s of [-1, 1]) b.box('#151515', 0.06, y0, 0.08, s * 0.18, y0 / 2, 0);
    return { colliders: [CB(W, H + y0, D, 0, (H + y0) / 2, 0), CB(0.38, 0.07, 0.03, 0, y0 + H + 0.035, 0)], mass: 3.2, material: 'plastic', breakInto: ['electronics', 'plastic_scrap', 'wire', 'battery', 'battery'] };
  },
});

// ===========================================================================
// Misc props
// ===========================================================================
region('ext_label', 256, 192, (ctx, w, h, rng) => {
  ctx.fillStyle = '#f1efe6'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#b3201a'; ctx.fillRect(0, 0, w, 40);
  txt(ctx, 'FIRE EXTINGUISHER', w / 2, 21, 20, '#fff');
  txt(ctx, 'ABC DRY CHEMICAL · 5 LB', w / 2, 56, 14, '#111');
  ctx.fillStyle = '#2f8a3a'; ctx.beginPath(); ctx.moveTo(40, 72); ctx.lineTo(62, 108); ctx.lineTo(18, 108); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#c22a20'; ctx.fillRect(106, 74, 34, 34);
  ctx.fillStyle = '#2a58a8'; ctx.beginPath(); ctx.arc(208, 91, 18, 0, TAU); ctx.fill();
  txt(ctx, 'A', 40, 96, 16, '#fff'); txt(ctx, 'B', 123, 92, 18, '#fff'); txt(ctx, 'C', 208, 92, 18, '#fff');
  ['1. PULL PIN', '2. AIM AT BASE OF FIRE', '3. SQUEEZE HANDLE', '4. SWEEP SIDE TO SIDE'].forEach((s, i) => txt(ctx, s, 16, 126 + i * 15, 11, '#222', { align: 'left', fam: 'mono' }));
  grunge(ctx, w, h, rng, 120, 0.5, 2);
});
region('gauge', 64, 64, (ctx) => {
  ctx.fillStyle = '#f4f4ee'; ctx.beginPath(); ctx.arc(32, 32, 31, 0, TAU); ctx.fill();
  ctx.lineWidth = 7;
  [['#c22a20', 2.4, 3.6], ['#2f9a3a', 3.6, 5.8], ['#c22a20', 5.8, 7.0]].forEach(([c, a0, a1]) => { ctx.strokeStyle = c; ctx.beginPath(); ctx.arc(32, 32, 22, a0, a1); ctx.stroke(); });
  ctx.strokeStyle = '#111'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(32, 32); ctx.lineTo(32 + Math.cos(4.9) * 22, 32 + Math.sin(4.9) * 22); ctx.stroke();
  txt(ctx, 'PSI', 32, 46, 8, '#333');
});
region('inspect_tag', 64, 112, (ctx) => {
  ctx.fillStyle = '#f2d23c'; rrect(ctx, 2, 2, 60, 108, 6); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(32, 12, 5, 0, TAU); ctx.fill();
  txt(ctx, 'INSPECTED', 32, 28, 9, '#111');
  for (let i = 0; i < 12; i++) { ctx.strokeStyle = '#333'; ctx.strokeRect(8 + (i % 4) * 12, 40 + Math.floor(i / 4) * 14, 10, 12); txt(ctx, String(i + 1), 13 + (i % 4) * 12, 46 + Math.floor(i / 4) * 14, 6, '#333', { weight: 'normal' }); }
  ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(37, 74, 3, 0, TAU); ctx.fill();
  txt(ctx, '1993', 32, 96, 12, '#111', { fam: 'mono' });
});

def('fire_extinguisher', {
  build(b) {
    b.lathe('paint_red', [[0, 0.012], [0.058, 0.012, 1], [0.064, 0.022], [0.065, 0.045], [0.065, 0.36], [0.06, 0.392], [0.046, 0.412], [0.024, 0.423], [0.018, 0.428]], 0, 0, 0, 0, 0, 0, 22);
    b.lathe('plastic_black', [[0, 0], [0.067, 0, 1], [0.0675, 0.03, 1], [0.064, 0.034]], 0, 0, 0, 0, 0, 0, 22);
    b.cyl('chrome', 0.017, 0.019, 0.03, 0, 0.44, 0, 0, 0, 0, 12);
    b.rbox('chrome', 0.034, 0.042, 0.05, 0.006, 0, 0.475, 0);
    b.rbox('paint_black', 0.028, 0.009, 0.12, 0.003, 0, 0.462, -0.065, -0.05);
    b.rbox('paint_black', 0.026, 0.009, 0.115, 0.003, 0, 0.506, -0.058, 0.22);
    b.cyl('chrome', 0.018, 0.018, 0.012, 0, 0.48, 0.03, HP, 0, 0, 16);
    b.decal('gauge', 0.03, 0.03, 0, 0.48, 0.0365, 0, 0, 0, { slot: 'atlas' });
    b.tor('chrome', 0.011, 0.0018, 0.03, 0.488, 0.0, 0, HP, 0, 4, 12);
    b.cyl('chrome', 0.002, 0.002, 0.05, 0.012, 0.488, 0.0, 0, 0, HP, 4);
    b.decal('inspect_tag', 0.032, 0.056, 0.042, 0.45, 0.008, 0, 0.3, 0.1, { slot: 'atlas' });
    b.tube('rubber_tire', [[-0.02, 0.47, 0], [-0.055, 0.47, 0.0], [-0.078, 0.42, 0.01], [-0.076, 0.26, 0.03], [-0.07, 0.15, 0.04]], 0.0075, { radial: 7, round: 0.03 });
    cylBetween(b, 'plastic_black', [-0.07, 0.15, 0.04], [-0.068, 0.09, 0.045], 0.009, 0.013, 10);
    b.tor('plastic_black', 0.0655, 0.0035, 0, 0.2, 0, HP, 0, 0, 4, 28);
    b.cylDecal('ext_label', 0.0657, 0.19, 0.25, 2.2, 0, 0.225, 0);
    return {
      colliders: [CC(0.065, 0.43, 0, 0.215, 0), CB(0.035, 0.07, 0.12, 0, 0.48, -0.035)],
      mass: 6.5, material: 'metal', breakInto: ['metal_scrap', 'metal_scrap', 'pipe'],
    };
  },
});

region('toolbox_sticker', 160, 64, (ctx, w, h, rng) => {
  ctx.fillStyle = '#e9e5d6'; rrect(ctx, 2, 2, w - 4, h - 4, 8); ctx.fill();
  ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.stroke();
  txt(ctx, 'PROPERTY OF', w / 2, 18, 11, '#111', { fam: 'mono' });
  txt(ctx, 'FACILITIES', w / 2, 38, 20, '#111');
  marker(ctx, 'do not borrow!!', w / 2, 54, 11, '#1a2a8a', rng, { weight: 'normal' });
  grunge(ctx, w, h, rng, 150, 0.8, 2);
});

def('toolbox', {
  variants: 2,
  mats: (o, v) => ({ body: tint('paint_red', o.color ?? (v ? 0x2f4f7a : 0xa3261e)) }),
  build(b) {
    const W = 0.5, D = 0.22;
    b.rbox('body', W, 0.15, D, 0.008, 0, 0.075, 0);
    b.rbox('body', W + 0.006, 0.012, D + 0.006, 0.004, 0, 0.152, 0);
    const sh = new THREE.Shape([new THREE.Vector2(-0.112, 0), new THREE.Vector2(0.112, 0), new THREE.Vector2(0.065, 0.068), new THREE.Vector2(-0.065, 0.068)]);
    b.ext('body', sh, W, 0, 0.158, 0, 0, HP, 0, 0.003, 1);
    for (const s of [-1, 1]) b.rbox('chrome', 0.03, 0.022, 0.02, 0.004, s * 0.12, 0.226, 0);
    b.tube('chrome', [[-0.12, 0.228, 0], [-0.105, 0.268, 0], [0.105, 0.268, 0], [0.12, 0.228, 0]], 0.0055, { radial: 6, round: 0.03 });
    b.cyl('plastic_black', 0.012, 0.012, 0.15, 0, 0.268, 0, 0, 0, HP, 12);
    for (const s of [-1, 1]) {
      b.rbox('chrome', 0.04, 0.03, 0.01, 0.003, s * 0.17, 0.155, D / 2 + 0.006);
      b.cyl('chrome', 0.004, 0.004, 0.044, s * 0.17, 0.165, D / 2 + 0.012, 0, 0, HP, 6);
    }
    b.rbox('chrome', 0.03, 0.03, 0.006, 0.003, 0, 0.155, D / 2 + 0.005);
    b.cyl('chrome', 0.005, 0.005, W - 0.04, 0, 0.158, -D / 2 - 0.003, 0, 0, HP, 8);
    b.decal('toolbox_sticker', 0.14, 0.056, 0.06, 0.075, D / 2 + 0.0008, 0, 0, 0.04);
    return { colliders: [CB(W, 0.23, D, 0, 0.115, 0)], mass: 5.5, material: 'metal', breakInto: ['metal_scrap', 'metal_scrap', 'screws', 'nails'], anchors: { handle: [0, 0.27, 0] } };
  },
});

region('ladder_warn', 64, 160, (ctx) => {
  ctx.fillStyle = '#f2c418'; ctx.fillRect(0, 0, 64, 160);
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 64, 24);
  txt(ctx, 'DANGER', 32, 12, 13, '#f2c418');
  ['DO NOT', 'STAND ON', 'OR ABOVE', 'THIS STEP', '', 'MAX', '225 LB'].forEach((s, i) => txt(ctx, s, 32, 38 + i * 16, 10, '#111'));
});

def('step_ladder', {
  build(b) {
    const FB = (s) => [s * 0.215, 0, 0.3], FT = (s) => [s * 0.17, 0.95, 0.02];
    const RB = (s) => [s * 0.2, 0, -0.33], RT = (s) => [s * 0.165, 0.93, -0.04];
    for (const s of [-1, 1]) {
      boxBetween(b, 'steel', FB(s), FT(s), 0.022, 0.065, 0.003);
      boxBetween(b, 'steel', RB(s), RT(s), 0.02, 0.04, 0.003);
      b.box('rubber_tire', 0.03, 0.025, 0.075, s * 0.215, 0.0125, 0.3);
      b.box('rubber_tire', 0.028, 0.025, 0.05, s * 0.2, 0.0125, -0.33);
      const a = [s * 0.205, 0.5, 0.3 - 0.5 * 0.295], c = [s * 0.19, 0.5, -0.33 + 0.5 * 0.31];
      const m = [(a[0] + c[0]) / 2, 0.47, (a[2] + c[2]) / 2];
      boxBetween(b, 'paint_dark', a, m, 0.006, 0.02);
      boxBetween(b, 'paint_dark', m, c, 0.006, 0.02);
      b.cyl('chrome', 0.006, 0.006, 0.012, m[0], m[1], m[2], 0, 0, HP, 6);
    }
    for (const y of [0.24, 0.48, 0.72]) {
      const t = y / 0.95, z = 0.3 - t * 0.28 - 0.01, w = 2 * (0.215 - t * 0.045) - 0.022;
      b.box('steel', w, 0.022, 0.085, 0, y, z);
      for (const dz of [-0.025, 0, 0.025]) b.box('steel', w - 0.01, 0.004, 0.006, 0, y + 0.013, z + dz);
    }
    for (const y of [0.22, 0.6]) { const t = y / 0.93; b.box('steel', 2 * (0.2 - t * 0.035) - 0.02, 0.025, 0.012, 0, y, -0.33 + t * 0.29); }
    b.rbox('plastic_orange', 0.4, 0.035, 0.2, 0.01, 0, 0.965, -0.005, 0, 0, 0, 1);
    b.box('#5a2a0a', 0.3, 0.004, 0.1, 0, 0.983, -0.01);
    for (const x of [-0.1, 0.0, 0.1]) b.cyl('#3a1a06', 0.012, 0.012, 0.004, x, 0.9835, 0.06, 0, 0, 0, 10);
    b.decal('ladder_warn', 0.035, 0.0875, 0.215 - 0.72 * 0.047 + 0.012, 0.8, 0.3 - 0.8 * 0.295, 0.29, HP, 0, { slot: 'atlas' });
    return {
      colliders: [CBbetween([0, 0, 0.3], [0, 0.95, 0.02], 0.45, 0.06), CBbetween([0, 0, -0.33], [0, 0.93, -0.04], 0.42, 0.04), CB(0.4, 0.035, 0.2, 0, 0.965, -0.005)],
      mass: 6, material: 'metal', breakInto: ['metal_tube', 'metal_tube', 'metal_scrap', 'screws'],
      anchors: { step0: [0, 0.25, 0.22], step1: [0, 0.49, 0.15], step2: [0, 0.73, 0.08], top: [0, 0.98, 0] },
    };
  },
});

def('pipe', {
  variants: 3,
  build(b, v) {
    const mat = ['metal_dark', 'rust', 'steel'][v], ro = 0.03, ri = 0.025, L = 1.2;
    const prof = [[ri, -L / 2, 1], [ro - 0.002, -L / 2, 1]];
    for (let i = 0; i <= 8; i++) prof.push([i % 2 ? ro : ro - 0.002, -L / 2 + 0.004 + i * 0.005]);
    prof.push([ro, L / 2 - 0.045]);
    for (let i = 0; i <= 8; i++) prof.push([i % 2 ? ro - 0.002 : ro, L / 2 - 0.044 + i * 0.005]);
    prof.push([ro - 0.002, L / 2, 1], [ri, L / 2, 1], [ri, -L / 2, 1]);
    const yc = 0.038;
    b.lathe(mat, prof, 0, yc, 0, 0, 0, HP, 16);
    if (v !== 1) b.lathe(mat === 'steel' ? 'steel' : 'metal_dark', [[0.032, -0.035, 1], [0.037, -0.032], [0.038, -0.025, 1], [0.038, 0.025, 1], [0.037, 0.032], [0.032, 0.035, 1], [0.031, 0.035]], -(L / 2 - 0.025), yc, 0, 0, 0, HP, 16);
    if (v === 0) b.cylDecal('stain', ro + 0.0005, 0.1, 0, 2, 0.2, yc, 0, 0, 0, HP);
    return {
      colliders: [CC(ro, L, 0, yc, 0, 0, 0, HP), ...(v !== 1 ? [CC(0.038, 0.07, -(L / 2 - 0.025), yc, 0, 0, 0, HP)] : [])],
      mass: 6.5, material: 'metal', breakInto: ['pipe'],
      anchors: { grip: [0.2, yc, 0] },
    };
  },
});

function drawWhiteboard(ctx, w, h) {
  const rng = new RNG(1993);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#f2f3ef'); g.addColorStop(0.5, '#e9ebe6'); g.addColorStop(1, '#eef0ec');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // ghosting from old erasures
  for (let i = 0; i < 26; i++) {
    const x = rng.next() * w, y = rng.next() * h, r = 40 + rng.next() * 140;
    const gg = ctx.createRadialGradient(x, y, 0, x, y, r);
    gg.addColorStop(0, `rgba(${rng.next() > 0.7 ? '80,90,140' : '90,90,90'},0.07)`); gg.addColorStop(1, 'rgba(90,90,90,0)');
    ctx.fillStyle = gg; ctx.save(); ctx.translate(x, y); ctx.scale(1.8, 0.6); ctx.translate(-x, -y); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.restore();
  }
  ctx.save(); ctx.filter = 'blur(1.5px)'; ctx.globalAlpha = 0.18;
  marker(ctx, 'MEETING 2PM — RM 0', 700, 90, 34, '#223', rng, { weight: 'normal' });
  ctx.restore();
  const blue = 'rgba(30,50,150,0.92)', blk = 'rgba(25,25,30,0.9)', red = 'rgba(190,25,25,0.85)', grn = 'rgba(20,110,50,0.85)';
  marker(ctx, 'Q3 TARGETS', 70, 80, 56, blue, rng, { align: 'left' });
  ctx.strokeStyle = blue; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(66, 118); ctx.quadraticCurveTo(250, 108, 400, 116); ctx.stroke();
  ['- SYNERGY  ↑ 12%', '- REDUCE TURNOVER', '- AUDIT LEVEL 0 EXITS', '- FIND STAIRWELL B ??'].forEach((s, i) => marker(ctx, s, 80, 170 + i * 52, 32, i === 3 ? red : blk, rng, { align: 'left', weight: 'normal' }));
  // bar chart
  ctx.strokeStyle = blk; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(620, 160); ctx.lineTo(620, 400); ctx.lineTo(940, 400); ctx.stroke();
  [120, 170, 150, 230, 60].forEach((hh, i) => { ctx.strokeStyle = i === 4 ? red : grn; ctx.lineWidth = 4; ctx.strokeRect(645 + i * 58, 400 - hh, 36, hh); });
  marker(ctx, 'Q1 Q2 Q3 Q4 ??', 785, 430, 24, blk, rng, { weight: 'normal' });
  ctx.strokeStyle = red; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(890, 300, 44, 70, 0.1, 0, TAU); ctx.stroke();
  marker(ctx, 'x4471', 880, 520, 30, blk, rng, { weight: 'normal' });
  ctx.strokeStyle = blk; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(470, 300); ctx.lineTo(590, 260); ctx.moveTo(575, 252); ctx.lineTo(592, 260); ctx.lineTo(580, 274); ctx.stroke();
  // half-erased, smudged warning
  ctx.save();
  ctx.filter = 'blur(2.2px)';
  marker(ctx, "DON'T LOOK BEHIND YOU", 360, 640, 50, red, rng, { weight: 'bold' });
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.filter = 'blur(10px)';
  for (let i = 0; i < 7; i++) { ctx.fillStyle = `rgba(0,0,0,${0.35 + rng.next() * 0.45})`; ctx.fillRect(80 + i * 85 + rng.next() * 30, 600 + rng.next() * 30, 60 + rng.next() * 50, 30 + rng.next() * 40); }
  ctx.restore();
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#eceee9'; ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  ctx.save(); ctx.filter = 'blur(6px)'; ctx.fillStyle = 'rgba(160,120,120,0.12)'; ctx.fillRect(100, 610, 560, 60); ctx.restore();
}

def('whiteboard', {
  build(b) {
    const W = 1.2, H = 0.9, yc = 1.2;
    b.box('paint_grey', W, H, 0.012, 0, yc, 0);
    b.add('whiteboard', new THREE.PlaneGeometry(W - 0.01, H - 0.01), 0, yc, 0.0062, 0, 0, 0, 'keep');
    for (const s of [-1, 1]) {
      b.rbox('steel', W + 0.04, 0.022, 0.024, 0.006, 0, yc + s * (H / 2 + 0.006), 0.002);
      b.rbox('steel', 0.022, H + 0.034, 0.024, 0.006, s * (W / 2 + 0.006), yc, 0.002);
    }
    b.box('steel', 0.9, 0.008, 0.065, 0, yc - H / 2 - 0.02, 0.03);
    b.box('steel', 0.9, 0.02, 0.006, 0, yc - H / 2 - 0.012, 0.062);
    [['#b8291f', -0.25], ['#1f3f9a', -0.17], ['#1d1d1d', 0.05]].forEach(([c, x], i) => {
      b.cyl(c, 0.0075, 0.0075, 0.1, x, yc - H / 2 - 0.0085 + 0.0075, 0.03, 0, 0.1 * i, HP, 8);
      b.cyl('#e8e6de', 0.0085, 0.0085, 0.035, x + 0.065, yc - H / 2 - 0.0085 + 0.0075, 0.03 + 0.007 * i, 0, 0.1 * i, HP, 8);
    });
    b.rbox('#c49a62', 0.13, 0.025, 0.05, 0.006, 0.25, yc - H / 2 + 0.0035 - 0.01, 0.032);
    b.box('#2a2a2a', 0.128, 0.008, 0.048, 0.25, yc - H / 2 - 0.0125, 0.032);
    for (const s of [-1, 1]) {
      const x = s * (W / 2 + 0.06);
      b.rbox('steel', 0.035, 1.72, 0.035, 0.006, x, 0.08 + 0.86, 0);
      b.cyl('chrome', 0.014, 0.014, 0.05, x - s * 0.035, yc, 0, 0, 0, HP, 12);
      b.cyl('plastic_black', 0.022, 0.022, 0.02, x + s * 0.025, yc, 0, 0, 0, HP, 12);
      b.rbox('steel', 0.045, 0.04, 0.6, 0.008, x, 0.07, 0);
      b.cyl('plastic_black', 0.02, 0.02, 0.01, x, 1.805, 0, 0, 0, 0, 10);
      for (const z of [-0.26, 0.26]) casterAt(b, x, z, 0.06, z * 4);
    }
    b.cyl('steel', 0.012, 0.012, W + 0.1, 0, 0.32, 0, 0, 0, HP, 10);
    return {
      colliders: [CB(W + 0.04, H + 0.04, 0.03, 0, yc, 0), CB(0.035, 1.72, 0.035, -(W / 2 + 0.06), 0.94, 0), CB(0.035, 1.72, 0.035, W / 2 + 0.06, 0.94, 0), CB(0.045, 0.1, 0.6, -(W / 2 + 0.06), 0.05, 0), CB(0.045, 0.1, 0.6, W / 2 + 0.06, 0.05, 0)],
      mass: 22, material: 'metal', breakInto: ['metal_tube', 'metal_tube', 'wheel', 'screws'],
      anchors: { board: [0, yc, 0.01] },
    };
  },
});

def('rubber_duck', {
  build(b) {
    b.sph('plastic_yellow', 0.05, 0, 0.042, 0, 16, 10, 1.0, 0.8, 1.22);
    b.sph('plastic_yellow', 0.024, 0, 0.068, -0.058, 10, 8, 0.9, 1.0, 0.75, 0.7, 0, 0);
    b.sph('plastic_yellow', 0.035, 0, 0.104, 0.03, 14, 10);
    b.sph('plastic_orange', 0.018, 0, 0.1, 0.064, 12, 8, 1.25, 0.42, 1.15);
    b.sph('plastic_orange', 0.015, 0, 0.093, 0.06, 10, 6, 1.05, 0.32, 0.95);
    for (const s of [-1, 1]) {
      b.sph('#111111', 0.0058, s * 0.019, 0.116, 0.057, 8, 6);
      b.sph('#ffffff', 0.0018, s * 0.0185, 0.118, 0.0625, 5, 4);
      b.sph('plastic_yellow', 0.03, s * 0.043, 0.05, -0.006, 10, 8, 0.35, 0.62, 1.0, 0, 0, s * 0.3);
    }
    return { colliders: [CS(0.042, 0, 0.042, 0), CS(0.032, 0, 0.104, 0.03)], mass: 0.05, material: 'plastic', breakInto: ['plastic_scrap'] };
  },
});

def('basketball', {
  build(b) {
    b.add('bball', new THREE.SphereGeometry(0.12, 28, 18), 0, 0.12, 0, 0, 0, 0.2, 'keep');
    return { colliders: [CS(0.12, 0, 0.12, 0)], mass: 0.62, material: 'plastic', breakInto: ['rubber'] };
  },
});

def('coat_rack', {
  variants: 2,
  build(b, v, rng) {
    const wd = 'wood_dark';
    b.lathe(wd, [[0.03, 0.12], [0.032, 0.14], [0.022, 0.18], [0.019, 0.5], [0.021, 0.95], [0.019, 1.45], [0.026, 1.5], [0.02, 1.55], [0.021, 1.66], [0.03, 1.69], [0.022, 1.72], [0, 1.725]], 0, 0, 0, 0, 0, 0, 12);
    b.sph(wd, 0.032, 0, 1.75, 0, 12, 8);
    const L = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + PI / 4, c = Math.cos(a), s = Math.sin(a);
      const pts = [[c * 0.02, 0.24, s * 0.02], [c * 0.1, 0.16, s * 0.1], [c * 0.3, 0.025, s * 0.3]];
      b.tube(wd, pts, 0.017, { radial: 8, round: 0.12, rseg: 4 });
      b.cyl('rubber', 0.02, 0.02, 0.012, c * 0.3, 0.006, s * 0.3, 0, 0, 0, 8);
      L.push(CBbetween([c * 0.04, 0.22, s * 0.04], [c * 0.29, 0.02, s * 0.29], 0.03, 0.03));
    }
    for (let i = 0; i < 8; i++) {
      const up = i < 4, a = (i / 4) * TAU + (up ? 0 : PI / 4), c = Math.cos(a), s = Math.sin(a), y = up ? 1.62 : 1.42, l = up ? 0.15 : 0.11;
      b.tube('brass', [[c * 0.018, y, s * 0.018], [c * l * 0.75, y + 0.01, s * l * 0.75], [c * l, y + 0.07, s * l]], 0.006, { radial: 6, round: 0.04 });
      b.sph('brass', 0.009, c * l, y + 0.075, s * l, 8, 6);
    }
    if (v === 1) {
      // fedora on a hook
      const hx = 0.15, hy = 1.72, hz = 0;
      b.lathe('fedora', [[0, -0.004], [0.15, -0.004], [0.16, 0.002], [0.15, 0.01], [0.09, 0.012], [0.088, 0.03], [0.083, 0.1], [0.06, 0.112], [0.03, 0.105], [0, 0.11]], hx, hy, hz, 0.2, 0, -0.35, 18);
      b.lathe('#1a1a1a', [[0.0905, 0.012], [0.0895, 0.035]], hx, hy, hz, 0.2, 0, -0.35, 18);
    }
    return {
      colliders: [CC(0.022, 1.6, 0, 0.92, 0), ...L],
      mass: 7, material: 'wood', breakInto: ['plank', 'plank', 'screws'],
      anchors: { hook: [0.15, 1.69, 0] },
    };
  },
});
CUSTOM.fedora = () => Mat.make('fabric_brown', { color: 0x4a3e33, texRepeat: 3 });

def('cinder_block', {
  variants: 2,
  build(b, v) {
    const sh = new THREE.Shape();
    sh.moveTo(-0.195, -0.095); sh.lineTo(0.195, -0.095); sh.lineTo(0.195, 0.095); sh.lineTo(-0.195, 0.095); sh.closePath();
    for (const x of [-0.095, 0.095]) {
      const hp = new THREE.Path();
      const w = 0.065, d = 0.055, r = 0.015;
      hp.moveTo(x - w + r, -d); hp.lineTo(x + w - r, -d); hp.quadraticCurveTo(x + w, -d, x + w, -d + r); hp.lineTo(x + w, d - r); hp.quadraticCurveTo(x + w, d, x + w - r, d); hp.lineTo(x - w + r, d); hp.quadraticCurveTo(x - w, d, x - w, d - r); hp.lineTo(x - w, -d + r); hp.quadraticCurveTo(x - w, -d, x - w + r, -d);
      sh.holes.push(hp);
    }
    b.ext(v ? 'concrete_dark' : 'concrete', sh, 0.182, 0, 0.095, 0, -HP, 0, 0, 0.004, 1, 4);
    return { colliders: [CB(0.39, 0.19, 0.19, 0, 0.095, 0)], mass: 14, material: 'wood', breakInto: ['rubble', 'rubble'] };
  },
});

def('ceiling_tile', {
  variants: 2,
  build(b, v, rng) {
    const sh = new THREE.Shape();
    const jag = [[0.3, 0.05], [0.24, 0.085], [0.2, 0.15], [0.13, 0.16], [0.09, 0.23], [0.03, 0.245], [-0.01, 0.3]];
    sh.moveTo(-0.3, -0.3); sh.lineTo(0.3, -0.3);
    for (const [x, y] of jag) sh.lineTo(x + (rng.next() - 0.5) * 0.015, y + (rng.next() - 0.5) * 0.015);
    sh.lineTo(-0.3, 0.3); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.016, bevelEnabled: false, curveSegments: 2 });
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      uv.setXY(i, x + 0.3 + 0.0001, y + 0.3 + 0.0001);
      p.setZ(i, p.getZ(i) - 0.012 * ((x * x + y * y) / 0.18) * (v ? -1 : 1));
    }
    g.computeVertexNormals();
    g.translate(0, 0, -0.008);
    b.add('ceiling', g, 0, 0.012, 0, -HP, 0, 0, 'keep');
    b.decal('waterstain', 0.34, 0.34, -0.06, 0.0205 + (v ? 0.008 : -0.004), 0.06, -HP, 0, rng.next() * 3);
    return { colliders: [CB(0.6, 0.016, 0.35, 0, 0.012, 0.125), CB(0.26, 0.016, 0.25, -0.17, 0.012, -0.175)], mass: 0.35, material: 'cardboard', breakInto: ['fiber_board'] };
  },
});

def('water_cooler_cup', {
  build(b) {
    b.lathe('paper2', [[0.0008, 0], [0.034, 0.088], [0.0352, 0.09]], 0, 0, 0, 0, 0, 0, 16, 0, TAU, 'keep');
    b.tor('paper', 0.0352, 0.0014, 0, 0.09, 0, HP, 0, 0, 4, 20);
    return { colliders: [CC(0.011, 0.03, 0, 0.045, 0), CC(0.023, 0.03, 0, 0.075, 0)], mass: 0.004, material: 'paper', breakInto: ['paper'] };
  },
});

CUSTOM.straw = () => {
  const map = canvasMap(128, 128, (ctx, w, h) => {
    const rng = new RNG(31);
    ctx.fillStyle = '#c8a95c'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { const x = rng.next() * w; ctx.fillStyle = `rgba(${rng.next() > 0.5 ? '90,70,30' : '240,220,150'},${0.2 + rng.next() * 0.4})`; ctx.fillRect(x, 0, 1 + rng.next() * 1.5, h); }
  }, 1);
  return new THREE.MeshStandardMaterial({ name: 'furn_straw', map, roughness: 0.9 });
};

def('broom', {
  build(b) {
    b.cyl('oak', 0.012, 0.012, 1.06, 0, 0.36 + 0.53, 0, 0, 0, 0, 10);
    b.cyl('plastic_red', 0.0135, 0.0135, 0.05, 0, 1.43, 0, 0, 0, 0, 10);
    b.tor('chrome', 0.012, 0.0015, 0, 1.47, 0, 0, 0, 0, 4, 12);
    b.lathe('straw', [[0.035, 0.32], [0.03, 0.37], [0.016, 0.42], [0.012, 0.43]], 0, 0, 0, 0, 0, 0, 12, 0, TAU, { su: 1, sv: 1 });
    for (const y of [0.345, 0.37, 0.4]) b.tor('steel', y < 0.36 ? 0.034 : y < 0.38 ? 0.029 : 0.02, 0.0025, 0, y, 0, HP, 0, 0, 4, 16);
    const sh = new THREE.Shape();
    sh.moveTo(-0.055, 0.33);
    sh.quadraticCurveTo(-0.14, 0.18, -0.16, 0.02);
    for (let i = 0; i <= 16; i++) sh.lineTo(-0.16 + (i / 16) * 0.32, (i % 2 ? 0.0 : 0.012) + Math.sin((i / 16) * PI) * 0.008);
    sh.quadraticCurveTo(0.14, 0.18, 0.055, 0.33);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: false, curveSegments: 6 });
    g.translate(0, 0, -0.025);
    taperGeo(g, 1, 0.33, 0, (t, p) => { p.z *= 1 - t * 0.55; });
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 2);
    b.add('straw', g, 0, 0, 0, 0, 0, 0, 'keep');
    for (const [y, c] of [[0.27, '#a8302a'], [0.22, '#2a6a3a'], [0.17, '#a8302a']]) {
      const hw = 0.055 + ((0.33 - y) / 0.33) * 0.1, tz = 0.025 * (1 - ((0.33 - y) / 0.33) * 0.55);
      for (const s of [-1, 1]) b.box(c, hw * 2 - 0.01, 0.006, 0.003, 0, y, s * (tz + 0.001));
    }
    return { colliders: [CC(0.012, 1.08, 0, 0.92, 0), CB(0.26, 0.33, 0.03, 0, 0.165, 0)], mass: 0.7, material: 'wood', breakInto: ['plank', 'plant_fiber'] };
  },
});

def('mop', {
  build(b, v, rng) {
    b.cyl('oak', 0.0125, 0.0125, 1.3, 0, 0.15 + 0.65, 0, 0, 0, 0, 10);
    b.cyl('plastic_blue', 0.014, 0.014, 0.06, 0, 1.47, 0, 0, 0, 0, 10);
    b.rbox('steel', 0.13, 0.035, 0.05, 0.006, 0, 0.135, 0);
    b.rbox('paint_dark', 0.04, 0.05, 0.04, 0.006, 0, 0.17, 0);
    b.cyl('steel', 0.006, 0.006, 0.07, 0.04, 0.17, 0, HP, 0, 0, 8);
    b.add('mop_cotton', cushionGeo(0.085, 0.05, 0.065, 0.7, 0.8, 12, 8, 0.15), 0, 0.068, 0, 0, 0, 0, 'planar');
    const n = 40;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rng.next() * 0.25, dx = Math.cos(a), dz = Math.sin(a);
      const x0 = dx * 0.05, z0 = dz * 0.04, y0 = 0.07 + rng.next() * 0.04;
      const len = 0.12 + rng.next() * 0.1;
      const pts = [[x0 * 0.6, y0 + 0.02, z0 * 0.6], [x0 + dx * 0.03, y0 - 0.03, z0 + dz * 0.03], [x0 + dx * len * 0.6, 0.016 + rng.next() * 0.012, z0 + dz * len * 0.55], [x0 + dx * len, 0.01, z0 + dz * len * 0.9]];
      b.tube('mop_cotton', pts, 0.011, { radial: 4, round: 0.04, rseg: 2 });
    }
    return { colliders: [CC(0.0125, 1.33, 0, 0.83, 0), CC(0.14, 0.13, 0, 0.065, 0)], mass: 1.5, material: 'fabric', breakInto: ['plank', 'fabric'] };
  },
});

def('vent_grate', {
  variants: 2,
  build(b, v) {
    const W = 0.4, H = 0.25, m = v ? 'rust' : 'paint_white', y = H / 2;
    for (const s of [-1, 1]) {
      b.rbox(m, W, 0.026, 0.012, 0.003, 0, y + s * (H / 2 - 0.013), 0.009);
      b.rbox(m, 0.026, H - 0.04, 0.012, 0.003, s * (W / 2 - 0.013), y, 0.009);
    }
    b.box('#0b0b0b', W - 0.05, H - 0.05, 0.002, 0, y, -0.012);
    for (const s of [-1, 1]) { b.box(v ? 'rust' : 'steel', W - 0.05, 0.002, 0.026, 0, y + s * (H / 2 - 0.026), -0.002); b.box(v ? 'rust' : 'steel', 0.002, H - 0.05, 0.026, s * (W / 2 - 0.026), y, -0.002); }
    const n = 8;
    for (let i = 0; i < n; i++) b.box(m, W - 0.052, 0.024, 0.002, 0, y - (H - 0.06) / 2 + (i + 0.5) * ((H - 0.06) / n), 0.004, -0.75, 0, 0);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) { b.cyl('chrome', 0.005, 0.005, 0.003, sx * (W / 2 - 0.013), y + sy * (H / 2 - 0.013), 0.0155, HP, 0, 0, 8); b.box('#333', 0.008, 0.0012, 0.001, sx * (W / 2 - 0.013), y + sy * (H / 2 - 0.013), 0.0172, 0, 0, 0.6); }
    return { colliders: [CB(W, H, 0.03, 0, y, 0)], mass: 0.7, material: 'metal', breakInto: ['metal_scrap', 'screws'] };
  },
});

region('lug_tag', 64, 112, (ctx, w, h, rng) => {
  ctx.fillStyle = '#c4a26a'; rrect(ctx, 2, 2, 60, 108, 8); ctx.fill();
  ctx.fillStyle = '#efe9d8'; ctx.fillRect(8, 26, 48, 74);
  ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(32, 13, 5, 0, TAU); ctx.fill();
  txt(ctx, 'NAME', 12, 34, 7, '#444', { align: 'left' });
  marker(ctx, 'M. Halloran', 32, 46, 9, '#1a2a8a', rng, { weight: 'normal' });
  txt(ctx, 'DEST.', 12, 62, 7, '#444', { align: 'left' });
  marker(ctx, 'HOME', 32, 76, 12, '#1a2a8a', rng);
  marker(ctx, '(please)', 32, 90, 8, '#1a2a8a', rng, { weight: 'normal' });
});

def('suitcase', {
  variants: 4,
  mats: (o, v) => ({ shell: tint('plastic_blue', o.color ?? [0x27324d, 0x5a2228, 0x6b6a66, 0x4f5338][v], { roughness: 0.8 }) }),
  build(b, v) {
    const W = 0.46, H = 0.66, D = 0.22;
    for (const s of [-1, 1]) {
      b.rbox('shell', W, H, 0.098, 0.045, 0, H / 2, s * 0.058, 0, 0, 0, 2);
      for (const x of [-0.13, 0, 0.13]) b.rbox('shell', 0.045, H - 0.12, 0.012, 0.005, x, H / 2, s * 0.105);
    }
    b.rbox('#2a2a2c', W + 0.006, H + 0.006, 0.022, 0.045, 0, H / 2, 0, 0, 0, 0, 1);
    b.rbox('plastic_black', 0.15, 0.022, 0.034, 0.009, 0, H + 0.035, 0, 0, 0, 0, 2);
    for (const s of [-1, 1]) {
      b.rbox('plastic_black', 0.03, 0.04, 0.036, 0.006, s * 0.075, H + 0.012, 0);
      b.rbox('chrome', 0.045, 0.012, 0.03, 0.004, s * 0.16, H + 0.004, 0);
      for (const z of [-0.07, 0.07]) b.rbox('plastic_black', 0.05, 0.012, 0.03, 0.004, s * 0.17, 0.004, z);
    }
    b.tube('#222', [[0.06, H + 0.03, 0.012], [0.07, H - 0.01, 0.025], [0.075, H - 0.04, 0.03]], 0.0015, { radial: 4 });
    b.decal('lug_tag', 0.045, 0.08, 0.08, H - 0.075, D / 2 + 0.01, 0, 0, 0.1, { slot: 'atlas' });
    if (v === 2) b.decal('box_roomcorp', 0.16, 0.1, -0.08, 0.2, D / 2 + 0.013, 0, 0, 0.2);
    return { colliders: [CB(W, H, D, 0, H / 2, 0)], mass: 4.5, material: 'plastic', breakInto: ['plastic_scrap', 'fabric', 'metal_scrap'], anchors: { handle: [0, H + 0.035, 0] } };
  },
});

const CONTINENTS = [
  [[-168, 66], [-162, 70], [-140, 70], [-120, 72], [-95, 74], [-80, 72], [-62, 66], [-56, 52], [-66, 44], [-75, 35], [-81, 25], [-81, 31], [-90, 30], [-97, 26], [-97, 20], [-88, 15], [-83, 9], [-78, 8], [-85, 13], [-92, 15], [-105, 20], [-112, 30], [-118, 34], [-124, 40], [-124, 48], [-135, 58], [-150, 60], [-160, 58], [-165, 62]],
  [[-55, 60], [-44, 60], [-20, 70], [-20, 80], [-40, 83], [-65, 80], [-72, 77], [-60, 70]],
  [[-80, 8], [-72, 12], [-62, 10], [-50, 0], [-35, -6], [-40, -22], [-48, -28], [-58, -38], [-65, -42], [-68, -55], [-74, -50], [-72, -35], [-71, -18], [-76, -14], [-81, -5]],
  [[-10, 36], [-9, 43], [-2, 44], [-4, 48], [5, 52], [8, 57], [5, 62], [15, 69], [28, 71], [40, 67], [60, 70], [80, 73], [100, 77], [120, 73], [140, 72], [160, 70], [180, 68], [180, 62], [163, 60], [155, 58], [140, 52], [142, 46], [135, 43], [130, 35], [122, 40], [120, 30], [110, 20], [106, 10], [100, 13], [98, 8], [104, 1], [96, 17], [92, 22], [88, 21], [80, 15], [77, 8], [72, 20], [67, 25], [57, 25], [56, 27], [50, 30], [48, 29], [52, 24], [59, 22], [55, 17], [44, 12], [42, 16], [35, 28], [33, 31], [36, 36], [28, 36], [26, 40], [23, 38], [20, 40], [16, 38], [12, 44], [8, 44], [3, 42], [-1, 37], [-6, 36]],
  [[-17, 15], [-17, 21], [-13, 27], [-6, 35], [10, 37], [20, 31], [32, 31], [34, 28], [43, 12], [51, 12], [44, 0], [40, -15], [35, -24], [32, -29], [20, -35], [17, -29], [12, -17], [13, -5], [9, 4], [0, 5], [-8, 4], [-13, 8]],
  [[114, -22], [122, -18], [130, -12], [137, -12], [142, -11], [146, -19], [153, -26], [150, -37], [143, -39], [135, -35], [129, -32], [115, -34]],
  [[-5, 50], [1, 51], [0, 54], [-3, 58], [-6, 56]], [[130, 31], [135, 34], [141, 38], [142, 45], [140, 41], [133, 35]],
  [[44, -16], [50, -15], [49, -25], [44, -24]], [[95, 5], [105, -6], [115, -8], [120, -2], [110, 2]], [[166, -46], [174, -36], [178, -38], [170, -46]],
];
region('globe', 512, 256, (ctx, w, h, rng) => {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#5b8c94'); g.addColorStop(0.5, '#4a7f8d'); g.addColorStop(1, '#5b8c94');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const P = (lon, lat) => [((lon + 180) / 360) * w, ((90 - lat) / 180) * h];
  const cols = ['#d8c48a', '#c9b47a', '#b9c486', '#d6b98a', '#c8a978', '#d9c08c'];
  CONTINENTS.forEach((poly, i) => {
    ctx.beginPath(); poly.forEach(([lo, la], j) => { const [x, y] = P(lo, la); if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath();
    ctx.fillStyle = cols[i % cols.length]; ctx.fill(); ctx.strokeStyle = 'rgba(70,50,30,0.7)'; ctx.lineWidth = 1.2; ctx.stroke();
  });
  ctx.fillStyle = '#eef0ea'; ctx.beginPath(); ctx.moveTo(0, h); for (let x = 0; x <= w; x += 16) ctx.lineTo(x, h - 18 - rng.next() * 10); ctx.lineTo(w, h); ctx.fill();
  ctx.strokeStyle = 'rgba(30,40,50,0.25)'; ctx.lineWidth = 1;
  for (let lo = 0; lo < 360; lo += 30) { const x = (lo / 360) * w; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let la = -60; la <= 60; la += 30) { const y = ((90 - la) / 180) * h; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  ctx.fillStyle = 'rgba(240,232,205,0.9)'; rrect(ctx, 150, 150, 70, 26, 4); ctx.fill();
  txt(ctx, 'WORLD', 185, 158, 9, '#4a3a2a', { fam: 'serif' }); txt(ctx, 'ROOM CORP 1993', 185, 169, 6, '#4a3a2a', { fam: 'serif' });
});

def('globe', {
  build(b) {
    const yc = 0.25, R = 0.15, tilt = 0.41;
    b.lathe('wood_dark', [[0, 0.002], [0.1, 0.002, 1], [0.102, 0.016], [0.085, 0.03], [0.035, 0.042], [0.022, 0.06], [0, 0.062]], 0, 0, 0, 0, 0, 0, 24);
    const sg = new THREE.SphereGeometry(R, 28, 18);
    b.add('atlas', sg, 0, yc, 0, 0, 0.8, -tilt, { region: rUV('globe') });
    const mr = R + 0.012;
    b.add('brass', new THREE.TorusGeometry(mr, 0.0045, 5, 28, PI), 0, yc, 0, 0, 0, -HP - tilt, { su: 1, sv: 1 });
    const south = V(0, -mr, 0).applyEuler(new THREE.Euler(0, 0, -tilt)).add(V(0, yc, 0));
    const north = V(0, mr, 0).applyEuler(new THREE.Euler(0, 0, -tilt)).add(V(0, yc, 0));
    b.tube('brass', [[0, 0.06, 0], [0, 0.085, 0], [south.x * 0.5, south.y - 0.01, 0], [south.x, south.y, 0]], 0.006, { radial: 6, round: 0.03 });
    for (const p of [south, north]) b.sph('brass', 0.008, p.x, p.y, p.z, 8, 6);
    return { colliders: [CS(R, 0, yc, 0), CC(0.1, 0.06, 0, 0.031, 0)], mass: 1.4, material: 'plastic', breakInto: ['plastic_scrap', 'plank', 'metal_scrap'] };
  },
});

function wheelInto(b, x, y, z, rOut, width, hub) {
  const hw = width / 2, ri = rOut * 0.48;
  b.lathe('rubber_tire', [[ri, -hw * 0.85], [rOut * 0.78, -hw], [rOut * 0.95, -hw * 0.85], [rOut, -hw * 0.45], [rOut, hw * 0.45], [rOut * 0.95, hw * 0.85], [rOut * 0.78, hw], [ri, hw * 0.85]], x, y, z, 0, 0, HP, 20);
  b.cyl(hub, ri, ri, width * 0.86, x, y, z, 0, 0, HP, 16);
  b.cyl('chrome', ri * 0.4, ri * 0.4, width * 0.95, x, y, z, 0, 0, HP, 10);
}

def('hand_truck', {
  variants: 2,
  mats: (o, v) => ({ frame: tint('paint_red', o.color ?? (v ? 0x2a2c30 : 0xa8291f)) }),
  build(b) {
    for (const s of [-1, 1]) b.tube('frame', [[s * 0.17, 0.02, 0.0], [s * 0.17, 0.25, -0.03], [s * 0.17, 1.15, -0.06]], 0.014, { radial: 8, round: 0.1 });
    b.tube('frame', [[-0.17, 1.15, -0.06], [-0.14, 1.27, -0.07], [0.14, 1.27, -0.07], [0.17, 1.15, -0.06]], 0.014, { radial: 8, round: 0.06 });
    b.cyl('plastic_black', 0.019, 0.019, 0.2, 0, 1.27, -0.07, 0, 0, HP, 12);
    for (const y of [0.4, 0.7, 1.0]) b.cyl('frame', 0.01, 0.01, 0.34, 0, y, -0.03 - ((y - 0.25) / 0.9) * 0.03, 0, 0, HP, 8);
    b.box('steel', 0.38, 0.008, 0.2, 0, 0.004, 0.1);
    b.box('steel', 0.38, 0.06, 0.008, 0, 0.03, 0.004);
    for (const s of [-1, 1]) b.box('steel', 0.006, 0.05, 0.12, s * 0.13, 0.03, 0.06, 0.4, 0, 0);
    for (const s of [-1, 1]) boxBetween(b, 'frame', [s * 0.17, 0.2, -0.03], [s * 0.2, 0.13, -0.13], 0.02, 0.03);
    b.cyl('steel', 0.009, 0.009, 0.52, 0, 0.13, -0.13, 0, 0, HP, 8);
    for (const s of [-1, 1]) wheelInto(b, s * 0.24, 0.13, -0.13, 0.13, 0.07, 'paint_grey');
    return {
      colliders: [CB(0.38, 1.22, 0.05, 0, 0.66, -0.04), CB(0.38, 0.01, 0.2, 0, 0.005, 0.1), CC(0.13, 0.07, -0.24, 0.13, -0.13, 0, 0, HP), CC(0.13, 0.07, 0.24, 0.13, -0.13, 0, 0, HP)],
      mass: 13, material: 'metal', breakInto: ['metal_tube', 'metal_tube', 'wheel', 'wheel'],
      anchors: { handle: [0, 1.27, -0.07], nose: [0, 0.01, 0.1] },
    };
  },
});

region('sandbag_print', 128, 64, (ctx, w, h, rng) => {
  txt(ctx, 'ROOM CORP', w / 2, 20, 16, 'rgba(30,25,20,0.7)', { fam: 'mono' });
  txt(ctx, 'SAND · 25 KG', w / 2, 44, 14, 'rgba(30,25,20,0.7)', { fam: 'mono' });
  grunge(ctx, w, h, rng, 300, 1, 2);
});

def('sandbag', {
  variants: 2,
  build(b, v, rng) {
    const g = cushionGeo(0.25, 0.07, 0.16, 0.5, 0.65, 22, 12, 0.3);
    const p = g.attributes.position;
    const k = new Map();
    for (let i = 0; i < p.count; i++) {
      const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      if (!k.has(key)) { const x = p.getX(i), z = p.getZ(i); k.set(key, 1 + 0.08 * Math.sin(x * 37 + z * 11 + v) * Math.cos(z * 29 - x * 13)); }
      const s = k.get(key);
      p.setXYZ(i, p.getX(i) * (0.97 + (s - 1) * 0.3), Math.max(-0.07, p.getY(i) * s), p.getZ(i) * s);
    }
    smoothNormals(g);
    b.add('burlap', g, 0, 0.07, 0, 0, 0, 0, 'planar');
    b.cyl('burlap', 0.028, 0.04, 0.05, 0.27, 0.06, 0, 0, 0, HP, 10);
    b.cyl('burlap', 0.05, 0.02, 0.04, 0.31, 0.06, 0, 0, 0, HP, 10);
    b.tor('#c9b48a', 0.03, 0.004, 0.282, 0.06, 0, 0, HP, 0, 4, 12);
    b.decal('sandbag_print', 0.2, 0.1, -0.03, 0.1405, 0.0, -HP + 0.05, 0, 0.05);
    return { colliders: [CB(0.44, 0.125, 0.26, 0, 0.0625, 0)], mass: 18, material: 'soft', breakInto: ['fabric', 'sand', 'sand'] };
  },
});

region('tire_text', 1024, 32, (ctx, w, h) => {
  for (const x of [w * 0.25, w * 0.75]) {
    txt(ctx, 'ROADMASTER  ALL-SEASON', x - 40, 16, 22, 'rgba(230,230,225,0.95)');
    txt(ctx, '205/65 R15', x + 190, 16, 16, 'rgba(200,200,195,0.85)', { fam: 'mono' });
  }
});
function ringStrip(r0, r1, segs, region0, up) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * TAU, c = Math.cos(a), s = Math.sin(a);
    pos.push(c * r0, 0, s * r0, c * r1, 0, s * r1);
    const u = lerp(region0.u0, region0.u1, up ? i / segs : 1 - i / segs);
    uv.push(u, region0.v0, u, region0.v1);
  }
  for (let i = 0; i < segs; i++) { const a = i * 2; if (!up) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

def('tire', {
  variants: 2,
  build(b, v) {
    const R = 0.318, yc = R;
    const prof = [[0.2, -0.075], [0.205, -0.09], [0.24, -0.1], [0.285, -0.1], [0.302, -0.093], [0.312, -0.078], [0.315, -0.05], [0.315, 0.05], [0.312, 0.078], [0.302, 0.093], [0.285, 0.1], [0.24, 0.1], [0.205, 0.09], [0.2, 0.075], [0.195, 0.0], [0.2, -0.075]];
    const g = latheGeo(prof, 36);
    g.rotateZ(HP); g.translate(0, yc, 0);
    b.add('rubber_tire', g, 0, 0, 0, 0, 0, 0, 'keep');
    const n = 40;
    for (let i = 0; i < n; i++) for (const side of [-1, 1]) {
      const a = ((i + (side > 0 ? 0.5 : 0)) / n) * TAU;
      const t = new THREE.BoxGeometry(0.055, 0.01, 0.034);
      t.translate(side * 0.034, R + 0.002, 0);
      t.rotateX(a);
      t.translate(0, yc, 0);
      b.add('rubber_tire', t, 0, 0, 0, 0, 0, 0, 'keep');
    }
    if (v === 0) {
      for (const up of [true, false]) {
        const rs = ringStrip(0.245, 0.272, 64, rUV('tire_text'), up);
        rs.rotateZ(-HP);
        rs.translate(up ? 0.1006 : -0.1006, yc, 0);
        b.add('decal', rs, 0, 0, 0, 0, 0, 0, 'keep');
      }
    }
    return { colliders: [CC(R, 0.2, 0, yc, 0, 0, 0, HP)], mass: 9, material: 'soft', breakInto: ['rubber', 'rubber', 'wire'] };
  },
});
