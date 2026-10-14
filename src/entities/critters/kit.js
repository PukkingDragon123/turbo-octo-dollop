// Critters — shared kit: geometry builders (lathe / tube / fin with UVs), a skinned geometry
// collector carrying per-vertex colour + surface parameters, bone helpers, the shared "surface"
// material (MeshPhysicalMaterial patched so ONE draw call can mix fur, wet nose, glossy eyes,
// chitin...), small procedural textures, and the shared cache (disposeCritterCache).
import * as THREE from 'three';
import * as Synth from '../../gfx/texsynth.js';

export const TAU = Math.PI * 2;
export const V3 = THREE.Vector3;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const dk = (rate, dt) => 1 - Math.exp(-rate * dt);
function hashN(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return s - Math.floor(s); }
export function noise1(x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return (hashN(i) * (1 - u) + hashN(i + 1) * u) * 2 - 1;
}
function h3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(h3(xi, yi, zi), h3(xi + 1, yi, zi), u), L(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), u), v),
    L(L(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), u), L(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), u), v), w) * 2 - 1;
}
export function toLinear(c) {
  c = clamp(c, 0, 1);
  return c < 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
// piecewise-smooth interpolation of [[u, value], ...]
export function curve(keys) {
  return (u) => {
    if (u <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (u <= keys[i][0]) {
        const [u0, a] = keys[i - 1], [u1, b] = keys[i];
        const t = (u - u0) / (u1 - u0);
        return a + (b - a) * (t * t * (3 - 2 * t));
      }
    }
    return keys[keys.length - 1][1];
  };
}

// ---------------------------------------------------------------------------
// cache
// ---------------------------------------------------------------------------
const _cache = new Map();
export function cached(key, fn) {
  if (!_cache.has(key)) _cache.set(key, fn());
  return _cache.get(key);
}
/** Dispose cached shared geometries/materials/textures (call on full teardown). */
export function disposeCritterCache() {
  const seen = new Set();
  const kill = (v) => {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (v.isBufferGeometry || v.isTexture || v.isMaterial) { v.dispose(); return; }
    if (Array.isArray(v)) { v.forEach(kill); return; }
    for (const k of Object.keys(v)) kill(v[k]);
  };
  for (const v of _cache.values()) kill(v);
  _cache.clear();
}

// ---------------------------------------------------------------------------
// Geometry helpers ({pos, nor, uv} BufferGeometries, indexed)
// ---------------------------------------------------------------------------
// Lathe along Z with elliptical sections. prof(u) -> { z, y, x?, rx, ry, flat? } (u: 0..1)
export function latheGeo(prof, radial, segs, uvRepeat = [1, 1]) {
  const pos = [], uv = [], idx = [];
  for (let k = 0; k <= segs; k++) {
    const u = k / segs, p = prof(u);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      const c = Math.cos(a), s = Math.sin(a);
      const ry = s < 0 && p.flat ? p.ry * (1 - p.flat * (-s)) : p.ry;
      pos.push((p.x || 0) + c * p.rx, p.y + s * ry, p.z);
      uv.push((j / radial) * uvRepeat[0], u * uvRepeat[1]);
    }
  }
  const row = radial + 1;
  const flip = prof(1).z > prof(0).z;
  for (let k = 0; k < segs; k++) {
    for (let j = 0; j < radial; j++) {
      const a = k * row + j, b = a + 1, c = a + row, d = c + 1;
      if (flip) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  fixSeamNormals(g, radial, segs);
  return g;
}
function fixSeamNormals(g, radial, segs) {
  const n = g.attributes.normal;
  const row = radial + 1;
  for (let k = 0; k <= segs; k++) {
    const a = k * row, b = k * row + radial;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l);
    n.setXYZ(b, x / l, y / l, z / l);
  }
}
// Tube along curve(t, out) with radius(t). uv: (around, along)
export function tubeGeo(curveFn, radius, radial, segs, uvRepeat = [1, 1]) {
  const P = [];
  for (let k = 0; k <= segs; k++) P.push(curveFn(k / segs, new V3()));
  const pos = [], uv = [], idx = [];
  const T = new V3(), N = new V3(), B = new V3();
  for (let k = 0; k <= segs; k++) {
    T.subVectors(P[Math.min(segs, k + 1)], P[Math.max(0, k - 1)]);
    if (T.lengthSq() < 1e-14) T.set(0, 0, 1);
    T.normalize();
    if (k === 0) { if (Math.abs(T.y) > 0.9) N.set(1, 0, 0); else N.set(0, 1, 0); }
    N.addScaledVector(T, -N.dot(T));
    if (N.lengthSq() < 1e-12) N.set(T.z, 0, -T.x);
    N.normalize();
    B.crossVectors(T, N);
    const r = radius(k / segs);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU, c = Math.cos(a), s = Math.sin(a);
      pos.push(P[k].x + (N.x * c + B.x * s) * r, P[k].y + (N.y * c + B.y * s) * r, P[k].z + (N.z * c + B.z * s) * r);
      uv.push((j / radial) * uvRepeat[0], (k / segs) * uvRepeat[1]);
    }
  }
  const row = radial + 1;
  for (let k = 0; k < segs; k++) {
    for (let j = 0; j < radial; j++) {
      const a = k * row + j, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  fixSeamNormals(g, radial, segs);
  return g;
}
export function ellipsoidGeo(c, rx, ry, rz, ws = 10, hs = 8, rot = null) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  g.scale(rx, ry, rz);
  if (rot) g.applyQuaternion(rot);
  g.translate(c.x, c.y, c.z);
  g.computeVertexNormals();
  return g;
}
// Flat fin from a 2D outline (in units), map(a, b, out) places outline coords in 3D.
// uv: (a / aMax, (b - bMin) / bSpan) so textures can run along the fin rays.
export function finGeo(outline, map, curveDiv = 1, subdiv = 0) {
  const shape = new THREE.Shape(outline.map(([a, b]) => new THREE.Vector2(a, b)));
  let g = new THREE.ShapeGeometry(shape, curveDiv);
  if (subdiv > 0) g = subdivideFlat(g, subdiv);
  const p = g.attributes.position;
  let aMax = 1e-6, bMin = 1e9, bMax = -1e9;
  for (const [a, b] of outline) { aMax = Math.max(aMax, a); bMin = Math.min(bMin, b); bMax = Math.max(bMax, b); }
  const uv = new Float32Array(p.count * 2);
  const v = new V3();
  for (let i = 0; i < p.count; i++) {
    const a = p.getX(i), b = p.getY(i);
    uv[i * 2] = a / aMax; uv[i * 2 + 1] = (b - bMin) / Math.max(1e-6, bMax - bMin);
    map(a, b, v);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
// split every triangle into 4 (n times) so flat fins can bend smoothly with the spine
function subdivideFlat(g, n) {
  for (let it = 0; it < n; it++) {
    const P = g.attributes.position, I = g.index ? g.index.array : null;
    const pos = [], idx = [];
    const tri = I ? I.length / 3 : P.count / 3;
    const get = (i) => [P.getX(i), P.getY(i), P.getZ(i)];
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    for (let t = 0; t < tri; t++) {
      const ia = I ? I[t * 3] : t * 3, ib = I ? I[t * 3 + 1] : t * 3 + 1, ic = I ? I[t * 3 + 2] : t * 3 + 2;
      const a = get(ia), b = get(ib), c = get(ic), ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      const base = pos.length / 3;
      pos.push(...a, ...ab, ...ca, ...ab, ...b, ...bc, ...ca, ...bc, ...c, ...ab, ...bc, ...ca);
      for (let k = 0; k < 12; k++) idx.push(base + k);
    }
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    ng.setIndex(idx);
    g.dispose();
    g = ng;
  }
  return g;
}

// ---------------------------------------------------------------------------
// Skinned geometry collector: slots (material groups) with colour + surface params + weights.
//   colorFn(p, n, u, v) -> sRGB [r,g,b(,a)]; surf: [roughness, clearcoat, sheen, normalMapAmount]
//   weightFn(p, u, v) -> bone index | [[bone, w], ...]
// ---------------------------------------------------------------------------
export class CritterGeo {
  constructor(slots) { this.slots = Array.from({ length: slots }, () => ({ pos: [], nrm: [], col: [], uv: [], srf: [], si: [], sw: [], idx: [] })); }
  add(geom, slot, colorFn, weightFn, surf = [0.6, 0, 0, 1], uvXform = null) {
    const S = this.slots[slot];
    const P = geom.attributes.position, N = geom.attributes.normal, U = geom.attributes.uv;
    const base = S.pos.length / 3;
    const p = new V3(), n = new V3();
    for (let i = 0; i < P.count; i++) {
      p.set(P.getX(i), P.getY(i), P.getZ(i));
      n.set(N.getX(i), N.getY(i), N.getZ(i));
      let u = U ? U.getX(i) : 0, v = U ? U.getY(i) : 0;
      S.pos.push(p.x, p.y, p.z);
      S.nrm.push(n.x, n.y, n.z);
      const c = typeof colorFn === 'function' ? colorFn(p, n, u, v) : colorFn;
      S.col.push(toLinear(c[0]), toLinear(c[1]), toLinear(c[2]), c.length > 3 ? c[3] : 1);
      const sf = typeof surf === 'function' ? surf(p, n, u, v) : surf;
      S.srf.push(sf[0], sf[1], sf[2], sf[3]);
      if (uvXform) { const r = uvXform(u, v); u = r[0]; v = r[1]; }
      S.uv.push(u, v);
      let w = typeof weightFn === 'function' ? weightFn(p, u, v) : weightFn;
      if (typeof w === 'number') w = [[w, 1]];
      w = w.filter((e) => e[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
      let tot = 0;
      for (const e of w) tot += e[1];
      for (let k = 0; k < 4; k++) { S.si.push(w[k] ? w[k][0] : 0); S.sw.push(w[k] ? w[k][1] / tot : 0); }
    }
    if (geom.index) { const I = geom.index.array; for (let i = 0; i < I.length; i++) S.idx.push(base + I[i]); }
    else for (let i = 0; i < P.count; i++) S.idx.push(base + i);
    geom.dispose();
  }
  build() {
    const all = { pos: [], nrm: [], col: [], uv: [], srf: [], si: [], sw: [], idx: [] };
    const g = new THREE.BufferGeometry();
    let start = 0;
    this.slots.forEach((S, m) => {
      const base = all.pos.length / 3;
      for (const k of ['pos', 'nrm', 'col', 'uv', 'srf', 'si', 'sw']) for (const x of S[k]) all[k].push(x);
      for (const i of S.idx) all.idx.push(base + i);
      g.addGroup(start, S.idx.length, m);
      start += S.idx.length;
    });
    g.setAttribute('position', new THREE.Float32BufferAttribute(all.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(all.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(all.col, 4));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(all.uv, 2));
    g.setAttribute('aSurf', new THREE.Float32BufferAttribute(all.srf, 4));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(all.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(all.sw, 4));
    g.setIndex(all.idx);
    g.computeBoundingSphere();
    g.userData.shared = true;
    return g;
  }
}

// Bone layout spec: [{ name, parent, pos:[x,y,z] (bind, root space) }]
export function makeBones(spec) {
  const bones = [], byName = {};
  for (const s of spec) {
    const b = new THREE.Bone();
    b.name = s.name;
    const parent = s.parent ? byName[s.parent] : null;
    const wp = new V3(...s.pos);
    if (parent) {
      b.position.copy(wp).sub(parent.userData.bindPos);
      parent.add(b);
    } else b.position.copy(wp);
    b.userData.bindPos = wp;
    b.userData.rest = b.position.clone();
    bones.push(b);
    byName[s.name] = b;
  }
  return { bones, byName, index: (n) => bones.indexOf(byName[n]) };
}

export function makeSkinned(geo, materials, spec, radius) {
  const { bones, byName } = makeBones(spec);
  const mesh = new THREE.SkinnedMesh(geo, materials);
  mesh.add(bones[0]);
  mesh.updateMatrixWorld(true);
  const skel = new THREE.Skeleton(bones);
  mesh.bind(skel);
  mesh.boundingSphere = new THREE.Sphere(geo.boundingSphere.center.clone(), geo.boundingSphere.radius * 1.4 + (radius || 0));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, bones, B: byName, skel };
}

// ---------------------------------------------------------------------------
// Surface material: per-vertex roughness / clear-coat / sheen / normal-map amount (aSurf)
// ---------------------------------------------------------------------------
export function surfaceMaterial(key, params = {}) {
  return cached('mat_' + key, () => {
    const m = new THREE.MeshPhysicalMaterial({
      vertexColors: true, color: 0xffffff, roughness: 1, metalness: 0,
      clearcoat: 1, clearcoatRoughness: 0.04, sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xffffff),
      ...params,
    });
    m.name = 'critter_' + key;
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aSurf;\nvarying vec4 vSurf;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n vSurf = aSurf;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec4 vSurf;')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor *= vSurf.x;')
        .replace('#include <normal_fragment_maps>', 'vec3 cNb = normal;\n#include <normal_fragment_maps>\n normal = normalize( mix( cNb, normal, vSurf.w ) );')
        .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  material.clearcoat *= vSurf.y;
#endif
#ifdef USE_SHEEN
  material.sheenColor *= vSurf.z;
#endif`);
    };
    m.customProgramCacheKey = () => 'critter_surface_v1';
    return m;
  });
}

// ---------------------------------------------------------------------------
// Procedural textures
// ---------------------------------------------------------------------------
Synth.registerRecipe('critter_fur', {
  // neutral fur luminance (multiplies vertex colours): strands along v, clumps, pale guard-hair tips
  defaults: { c0: 0xffffff, c1: 0x6a6a6a, c2: 0xffffff, p0: [0, 0, 0, 0], meters: 0.05, bump: 2.2, size: 256, seed: 3 },
  glsl: `S surface(vec2 uv){
    float s1 = gn(uv * vec2(48.0, 6.0), vec2(48.0, 6.0));
    float s2 = gn(uv * vec2(110.0, 10.0) + 0.3, vec2(110.0, 10.0));
    float clump = fbm(uv, vec2(6.0, 3.0), 3);
    float strand = s1 * 0.55 + s2 * 0.45;
    vec3 col = mix(uC1, uC0, smoothstep(0.25, 0.8, strand)) * (0.8 + 0.35 * clump);
    float guard = smoothstep(0.8, 0.95, gn(uv * vec2(70.0, 5.0) + 2.1, vec2(70.0, 5.0)));
    col = mix(col, uC2 * 1.15, guard * 0.45);
    S s; s.albedo = col; s.height = strand * 0.75 + clump * 0.25; s.rough = 0.85; s.ao = 0.65 + 0.35 * strand; s.metal = 0.0; return s; }`,
});
Synth.registerRecipe('fish_scales', {
  // overlapping scale rows (x along the body, head -> tail; y around): each scale shows only its
  // posterior margin, brighter toward the rim, crescent edge line; subtle in albedo, strong in normal
  defaults: { c0: 0xffffff, c1: 0xd2d2d2, p0: [0, 0, 0, 0], meters: 0.05, bump: 1.4, size: 256, seed: 5 },
  glsl: `S surface(vec2 uv){
    vec2 g = uv * vec2(28.0, 18.0);
    float row = floor(g.y);
    g.x += mod(row, 2.0) * 0.5;
    vec2 f = fract(g);
    float d = length((f - 0.5) * vec2(1.0, 1.15));
    float post = smoothstep(0.3, 0.6, f.x);
    float rim = (1.0 - smoothstep(0.015, 0.06, abs(d - 0.47))) * post;
    float shade = smoothstep(0.05, 0.95, f.x) * (1.0 - smoothstep(0.47, 0.55, d) * post);
    vec3 col = mix(uC1, uC0, 0.55 + 0.45 * shade) * (1.0 - rim * 0.12);
    S s; s.albedo = col; s.height = shade * 0.32 - rim * 0.22; s.rough = 0.28 + rim * 0.12; s.ao = 1.0 - rim * 0.15; s.metal = 0.0; return s; }`,
});

export function synthOrFlat(name, o = {}) {
  return cached('tex_' + name, () => {
    try { return Synth.pbr(name, o); } catch (e) {
      console.warn('[critters] texture synthesis failed', name, e);
      const flat = (r, g, b, srgb) => {
        const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.needsUpdate = true;
        return t;
      };
      return { map: flat(220, 220, 220, true), normalMap: flat(128, 128, 255, false), orm: flat(255, 200, 0, false) };
    }
  });
}

export function canvasTexture(key, w, h, draw, srgb = true) {
  return cached('cv_' + key, () => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  });
}

// deterministic rng
export function rng(seed) {
  let s = seed >>> 0 || 1;
  const next = () => {
    let t = (s = (s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, range: (a, b) => a + (b - a) * next(), int: (a, b) => Math.floor(a + (b - a + 1) * next()) };
}
