// "The Bacteria" — procedural body + procedural animation for R.O.O.M.'s main monster.
//
// A tall (~2.75 m upright), emaciated, pitch-black humanoid made of knotted, porous
// "bacterial colony" strands. Everything is generated at construction time: a single
// SkinnedMesh (one draw call) built from twisted strand tubes, lumpy knobs and nodules,
// driven by ~60 world-space bones that are solved procedurally every frame:
//   * body follows the AI root with lag; feet/hands plant in world space and step with
//     snappy arcs (biped shamble <-> quadrupedal spider/ape gallop using the long arms)
//   * two-bone IK with over-extension (limbs stretch past their rest length)
//   * twitchy head (snap-holds, tremor, impossible roll/yaw), undulating spine
//   * stop-motion "freeze frames" that hold the whole world pose and then snap to catch up
//   * wet glossy shader with procedural pores, flowing wet streaks, dissolve/melt effect
//   * dripping goo (instanced drops that hang, fall and splat on the floor)
//
// Usage:
//   const b = new BacteriaBody(seed); scene.add(b.root);
//   every frame: b.root.position.set(x, floorY, z); b.root.rotation.y = yaw; b.update(dt, s);
// Conventions: meters, Y up, faces -Z, root origin on the floor under the body.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RNG } from '../../core/rng.js';

const TAU = Math.PI * 2;
const V3 = THREE.Vector3;
const Q = THREE.Quaternion;
const UP = new V3(0, 1, 0);
const AX = new V3(1, 0, 0);
const AY = new V3(0, 1, 0);
const AZ = new V3(0, 0, 1);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const dk = (rate, dt) => 1 - Math.exp(-rate * dt);
function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
  return d;
}
function hashN(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return s - Math.floor(s); }
// smooth 1D value noise in -1..1
function noise1(x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return (hashN(i) * (1 - u) + hashN(i + 1) * u) * 2 - 1;
}
function h3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// 3D value noise in -1..1 (geometry displacement)
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const a = h3(xi, yi, zi), b = h3(xi + 1, yi, zi), c = h3(xi, yi + 1, zi), d = h3(xi + 1, yi + 1, zi);
  const e = h3(xi, yi, zi + 1), f = h3(xi + 1, yi, zi + 1), g = h3(xi, yi + 1, zi + 1), hh = h3(xi + 1, yi + 1, zi + 1);
  const x1 = a + (b - a) * u, x2 = c + (d - c) * u, x3 = e + (f - e) * u, x4 = g + (hh - g) * u;
  const y1 = x1 + (x2 - x1) * v, y2 = x3 + (x4 - x3) * v;
  return (y1 + (y2 - y1) * w) * 2 - 1;
}

// ---------------------------------------------------------------------------
// Dimensions (meters)
// ---------------------------------------------------------------------------
const D = {
  pelvis: 0.10, spine: 0.18, neck: 0.11, head: 0.27,
  clav: 0.19, uarm: 0.84, farm: 0.84, hand: 0.10, f1: 0.14, f2: 0.13,
  thigh: 0.66, shin: 0.64, foot: 0.17, toe: 0.09,
  hipX: 0.13, hipY: -0.02,
  tenA: 0.13, tenB: 0.12,
};
const FINGER_X = [-0.033, -0.011, 0.011, 0.033];
const FOOT_PITCH = 0.45; // planted heel lift (digitigrade-ish stance)
const TENDRILS = [
  // head-local attach point, bind tilt (x = back, z = out)
  { at: [-0.028, 0.25, 0.03], rx: 1.05, rz: 0.4 },
  { at: [0.03, 0.245, 0.035], rx: 1.15, rz: -0.45 },
  { at: [-0.05, 0.19, 0.07], rx: 1.55, rz: 0.85 },
  { at: [0.05, 0.2, 0.068], rx: 1.45, rz: -0.9 },
];

// ---------------------------------------------------------------------------
// Geometry authoring helpers
// ---------------------------------------------------------------------------
const _icoCache = new Map();
function icoData(detail) {
  if (!_icoCache.has(detail)) {
    let g = new THREE.IcosahedronGeometry(1, detail);
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    g = mergeVertices(g);
    _icoCache.set(detail, { pos: Array.from(g.attributes.position.array), idx: Array.from(g.index.array) });
    g.dispose();
  }
  return _icoCache.get(detail);
}

// A bundle of triangles authored in one bone's local frame (Y along the bone).
class Part {
  constructor() { this.pos = []; this.idx = []; }
  get count() { return this.pos.length / 3; }

  // Tube along curve(t,out) with radius(t, angle); wrapped (seamless) rings, ends closed to a point.
  tube(curve, radius, radial, segs, closeEnds = true) {
    const base = this.count;
    const P = [];
    for (let k = 0; k <= segs; k++) P.push(curve(k / segs, new V3()));
    const N = new V3(), B = new V3(), T = new V3();
    for (let k = 0; k <= segs; k++) {
      T.subVectors(P[Math.min(segs, k + 1)], P[Math.max(0, k - 1)]);
      if (T.lengthSq() < 1e-12) T.set(0, 1, 0);
      T.normalize();
      if (k === 0) { if (Math.abs(T.x) > 0.85) N.set(0, 0, 1); else N.set(1, 0, 0); }
      N.addScaledVector(T, -N.dot(T));
      if (N.lengthSq() < 1e-10) { N.set(T.y, -T.x, 0); if (N.lengthSq() < 1e-10) N.set(0, T.z, -T.y); }
      N.normalize();
      B.crossVectors(T, N);
      const u = k / segs;
      const endK = closeEnds && (k === 0 || k === segs) ? 0 : 1;
      for (let j = 0; j < radial; j++) {
        const a = (j / radial) * TAU;
        const r = radius(u, a) * endK;
        const c = Math.cos(a), s = Math.sin(a);
        this.pos.push(
          P[k].x + (N.x * c + B.x * s) * r,
          P[k].y + (N.y * c + B.y * s) * r,
          P[k].z + (N.z * c + B.z * s) * r,
        );
      }
    }
    for (let k = 0; k < segs; k++) {
      for (let j = 0; j < radial; j++) {
        const a = base + k * radial + j;
        const b = base + k * radial + ((j + 1) % radial);
        const c = a + radial, d = b + radial;
        this.idx.push(a, b, c, b, d, c);
      }
    }
  }

  // Lumpy ellipsoid
  blob(c, rx, ry, rz, detail, amp, freq, seed, rot = null) {
    const { pos, idx } = icoData(detail);
    const base = this.count;
    const v = new V3();
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      const d = 1 + amp * noise3(x * freq + seed, y * freq + seed * 0.7, z * freq - seed * 1.3);
      v.set(x * rx * d, y * ry * d, z * rz * d);
      if (rot) v.applyQuaternion(rot);
      this.pos.push(c.x + v.x, c.y + v.y, c.z + v.z);
    }
    for (const i of idx) this.idx.push(base + i);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

// Accumulates parts into one skinned geometry in bind space.
class SkinGeo {
  constructor(bind) {
    this.bind = bind;
    this.pos = []; this.nrm = []; this.si = []; this.sw = []; this.idx = [];
  }
  add(part, bone, wfn = null) {
    if (!part.count) return;
    const g = part.build();
    const P = g.attributes.position.array, Nn = g.attributes.normal.array;
    const M = this.bind[bone];
    const nm = new THREE.Matrix3().getNormalMatrix(M);
    const base = this.pos.length / 3;
    const v = new V3(), n = new V3();
    for (let i = 0; i < P.length; i += 3) {
      v.set(P[i], P[i + 1], P[i + 2]);
      const ws = wfn ? wfn(v.x, v.y, v.z) : null;
      v.applyMatrix4(M);
      n.set(Nn[i], Nn[i + 1], Nn[i + 2]).applyMatrix3(nm).normalize();
      this.pos.push(v.x, v.y, v.z);
      this.nrm.push(n.x, n.y, n.z);
      if (!ws) { this.si.push(bone, 0, 0, 0); this.sw.push(1, 0, 0, 0); continue; }
      const list = ws.filter((e) => e[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
      let tot = 0;
      for (const e of list) tot += e[1];
      if (tot <= 0) { this.si.push(bone, 0, 0, 0); this.sw.push(1, 0, 0, 0); continue; }
      for (let k = 0; k < 4; k++) {
        this.si.push(list[k] ? list[k][0] : 0);
        this.sw.push(list[k] ? list[k][1] / tot : 0);
      }
    }
    const I = g.index.array;
    for (let i = 0; i < I.length; i++) this.idx.push(base + I[i]);
    g.dispose();
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    return g;
  }
}

// Weight function for a segment of length L: blends into parent near y=0 and child near y=L.
function segW(bone, L, parent = -1, child = -1, blend = 0.05) {
  const b = Math.min(blend, L * 0.3);
  return (x, y) => {
    const wp = parent >= 0 ? 1 - sstep(-b, b, y) : 0;
    const wc = child >= 0 ? sstep(L - b, L + b, y) : 0;
    const out = [[bone, Math.max(0, 1 - wp - wc)]];
    if (wp > 0) out.push([parent, wp]);
    if (wc > 0) out.push([child, wc]);
    return out;
  };
}

// Several twisted, lumpy strands converging at both ends of a segment (gaps in between).
function strandBundle(part, rng, L, o) {
  const n = o.n ?? 4, R = o.R, th = o.th;
  const twist = o.twist ?? 1.2, radial = o.radial ?? 5;
  const segs = Math.max(4, Math.round(L / (o.segLen ?? 0.036)));
  const sgn = rng.next() < 0.5 ? -1 : 1;
  const xOff = o.xOff ?? 0, zOff = o.zOff ?? 0, pinch = o.pinch ?? 0.15;
  const curves = [];
  for (let j = 0; j < n; j++) {
    const a0 = (j / n) * TAU + rng.range(-0.5, 0.5);
    const tw = sgn * (twist + rng.range(-0.5, 0.5));
    const rMul = rng.range(0.7, 1.25), thMul = rng.range(0.75, 1.3);
    const ph = rng.range(0, 1000);
    const lumpF = rng.range(9, 17);
    const curve = (t, out) => {
      const env = Math.pow(Math.sin(Math.PI * t), 0.6);
      const r = R * rMul * (pinch + (1 - pinch) * env) * (1 + 0.25 * noise1(ph + t * 4));
      const a = a0 + tw * t + 0.3 * noise1(ph * 1.7 + t * 3);
      return out.set(xOff + Math.cos(a) * r, t * L, zOff + Math.sin(a) * r);
    };
    const radius = (t, ang) => {
      const env = 0.5 + 0.5 * Math.pow(Math.sin(Math.PI * t), 0.4);
      const lump = 1 + 0.6 * noise1(ph * 3.1 + t * L * lumpF) + 0.25 * noise1(ph * 7.7 + t * L * 45) + 0.12 * Math.sin(ang * 2 + ph);
      return th * thMul * env * Math.max(0.35, lump);
    };
    part.tube(curve, radius, radial, segs);
    curves.push(curve);
  }
  // lumpy core with a few gaps (see-through pores between the wrapping strands)
  if (o.core) {
    const cr = o.core;
    const nGaps = o.gaps ?? 1;
    const cuts = [0];
    for (let g = 0; g < nGaps; g++) {
      const c = rng.range(0.25, 0.75);
      cuts.push(c - rng.range(0.06, 0.12), c + rng.range(0.06, 0.12));
    }
    cuts.push(1);
    cuts.sort((x, y) => x - y);
    for (let k = 0; k + 1 < cuts.length; k += 2) {
      const t0 = Math.max(0, cuts[k] - 0.02), t1 = Math.min(1, cuts[k + 1] + 0.02);
      if (t1 - t0 < 0.08) continue;
      const ph = rng.range(0, 999);
      const seg = Math.max(3, Math.round(((t1 - t0) * L) / 0.04));
      part.tube((t, out) => {
        const u = t0 + (t1 - t0) * t;
        return out.set(xOff + cr * 0.4 * noise1(ph + u * 5), u * L, zOff + cr * 0.4 * noise1(ph * 1.3 + u * 5));
      }, (t, ang) => {
        const u = t0 + (t1 - t0) * t;
        const endTaper = Math.min(1, Math.min(u - t0, t1 - u) / 0.05 + 0.25) ** 0.5;
        return cr * endTaper * Math.max(0.45, 1 + 0.45 * noise1(ph + u * L * 22 + Math.sin(ang * 3) * 0.6));
      }, o.radial ?? 5, seg);
    }
  }
  const nn = o.nod ?? 0;
  const p = new V3();
  for (let k = 0; k < nn; k++) {
    const c = curves[rng.int(0, curves.length - 1)];
    c(rng.range(0.15, 0.85), p);
    const dx = p.x - xOff, dz = p.z - zOff, dl = Math.hypot(dx, dz) || 1;
    p.x += (dx / dl) * th * 0.6; p.z += (dz / dl) * th * 0.6;
    const r = th * rng.range(1.0, 2.1);
    part.blob(p.clone(), r, r * rng.range(1, 1.9), r, rng.next() < 0.5 ? 0 : 1, 0.35, 4, rng.range(0, 99));
  }
  return curves;
}

// Single tapered lumpy tendril / claw / spike along an arbitrary curve.
function tendril(part, rng, from, dir, len, th0, th1, bend, radial = 5, segs = 8) {
  const d = dir.clone().normalize();
  const side = new V3().crossVectors(d, Math.abs(d.y) > 0.9 ? AX : AY).normalize();
  const bendV = bend instanceof V3 ? bend : side.clone().multiplyScalar(bend);
  const ph = rng.range(0, 999);
  part.tube(
    (t, out) => out.copy(from).addScaledVector(d, t * len).addScaledVector(bendV, t * t * len),
    (t) => lerp(th0, th1, t) * (1 + 0.3 * noise1(ph + t * 7)),
    radial, segs,
  );
}

// ---------------------------------------------------------------------------
// Material (wet black bacterial tissue) with dissolve / melt
// ---------------------------------------------------------------------------
const GLSL_NOISE = /* glsl */`
varying vec3 vBP;
uniform float uDissolve;
float bH(vec3 p){ p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float bN(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(bH(i), bH(i + vec3(1,0,0)), f.x), mix(bH(i + vec3(0,1,0)), bH(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(bH(i + vec3(0,0,1)), bH(i + vec3(1,0,1)), f.x), mix(bH(i + vec3(0,1,1)), bH(i + vec3(1,1,1)), f.x), f.y), f.z);
}
`;
const GLSL_MELT_PARS = /* glsl */`
varying vec3 vBP;
uniform float uDissolve;
uniform vec2 uMeltC;
`;
const GLSL_MELT = /* glsl */`
  if (uDissolve > 0.0) {
    float mk = smoothstep(0.0, 1.0, uDissolve);
    float hy = max(transformed.y, 0.0);
    float sag = mk * (0.82 + 0.18 * sin(vBP.x * 13.0 + vBP.z * 11.0 + vBP.y * 3.0));
    transformed.y = hy * (1.0 - sag) + 0.004;
    vec2 dxz = transformed.xz - uMeltC;
    transformed.xz += dxz * mk * 0.7 * (1.0 - clamp(hy / 2.6, 0.0, 1.0));
  }
`;
const GLSL_DISSOLVE = /* glsl */`
  float dEdge = 0.0;
  if (uDissolve > 0.0) {
    float dd = bN(vBP * 7.0) * 0.5 + bN(vBP * 23.0 + 4.1) * 0.2 + clamp(vBP.y / 2.8, 0.0, 1.0) * 0.3;
    float thr = 1.0 - uDissolve * 1.15;
    if (dd > thr) discard;
    dEdge = smoothstep(thr - 0.06, thr, dd);
  }
`;

function patchVertexMelt(sh) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\n' + GLSL_MELT_PARS)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n vBP = position;')
    .replace('#include <project_vertex>', GLSL_MELT + '\n#include <project_vertex>');
}

function makeBodyMaterial(U) {
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0x030503),
    roughness: 0.45,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.07,
    sheen: 0.2,
    sheenColor: new THREE.Color(0x060c06),
    sheenRoughness: 0.5,
    specularIntensity: 0.3,
    envMapIntensity: 0.16,
  });
  m.name = 'bacteria_tissue';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDissolve = U.uDissolve;
    sh.uniforms.uMeltC = U.uMeltC;
    sh.uniforms.uTime = U.uTime;
    sh.uniforms.uBump = U.uBump;
    patchVertexMelt(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_NOISE + `
uniform float uTime;
uniform float uBump;
vec3 bactPerturb(vec3 sp, vec3 sn, float h, float fd){
  vec3 dpx = dFdx(sp), dpy = dFdy(sp);
  vec3 r1 = cross(dpy, sn), r2 = cross(sn, dpx);
  float det = dot(dpx, r1) * fd;
  vec2 dh = vec2(dFdx(h), dFdy(h));
  vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
  return normalize(abs(det) * sn - grad);
}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
${GLSL_DISSOLVE}
  float bnA = bN(vBP * 8.0);
  float bnB = bN(vBP * 33.0 + 3.7);
  float bnC = bN(vBP * 95.0 + 1.3);
  float pore = smoothstep(0.6, 0.8, bnB) * 0.7 + smoothstep(0.66, 0.86, bnC) * 0.5;
  float wetS = bN(vBP * vec3(9.0, 2.2, 9.0) + vec3(0.0, uTime * 0.35, 0.0));`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  diffuseColor.rgb *= (0.5 + 1.0 * bnA) * (1.0 - 0.8 * clamp(pore, 0.0, 1.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.006, 0.011, 0.004), smoothstep(0.6, 0.9, bnA) * 0.6);`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  float wetM = smoothstep(0.38, 0.78, bnA * 0.55 + wetS * 0.65 - pore * 0.45);
  material.clearcoat *= mix(0.12, 1.0, wetM);
  material.clearcoatRoughness = min(max(mix(0.5, 0.06, wetM), 0.0525) + geometryRoughness, 1.0);
#endif`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = clamp(roughnessFactor * (0.45 + 1.1 * bnA) + pore * 0.45 - smoothstep(0.5, 0.8, wetS) * 0.28, 0.03, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  float bumpH = (bnB * 0.55 + bnA * 0.6 + bnC * 0.25 - pore * 0.9) * uBump;
  normal = bactPerturb(-vViewPosition, normal, bumpH, faceDirection);`)
      .replace('#include <clearcoat_normal_fragment_maps>', `#include <clearcoat_normal_fragment_maps>
#ifdef USE_CLEARCOAT
  clearcoatNormal = bactPerturb(-vViewPosition, clearcoatNormal, bumpH * 0.4, faceDirection);
#endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += vec3(0.04, 0.075, 0.02) * dEdge;`);
  };
  m.customProgramCacheKey = () => 'bacteria_tissue_v1';
  return m;
}

function makeShadowMaterial(U, Base, opts) {
  const m = new Base(opts);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDissolve = U.uDissolve;
    sh.uniforms.uMeltC = U.uMeltC;
    patchVertexMelt(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_NOISE)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + GLSL_DISSOLVE);
  };
  m.customProgramCacheKey = () => 'bacteria_shadow_' + Base.name;
  return m;
}

// ---------------------------------------------------------------------------
// Drips: instanced goo drops that hang from the body, fall and splat.
// ---------------------------------------------------------------------------
class Drips {
  constructor(count, rng) {
    this.rng = rng;
    this.n = count;
    const g = new THREE.SphereGeometry(1, 7, 5);
    this.material = new THREE.MeshPhysicalMaterial({
      color: 0x060a07, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.4,
    });
    this.mesh = new THREE.InstancedMesh(g, this.material, count);
    this.mesh.name = 'BacteriaDrips';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrixWorldAutoUpdate = false; // instance matrices are in world space
    this.mesh.matrixWorld.identity();
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.d = [];
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < count; i++) {
      this.d.push({ st: 0, bone: 0, lp: new V3(), p: new V3(), v: new V3(), r: 0, t: 0, dur: 0, gy: 0 });
      this.mesh.setMatrixAt(i, zero);
    }
    this._m = new THREE.Matrix4();
    this._q = new Q();
    this._s = new V3();
    this.acc = 0;
  }

  spawn(bone, local, r) {
    for (const d of this.d) {
      if (d.st !== 0) continue;
      d.st = 1; d.bone = bone; d.lp.copy(local); d.r = r; d.t = 0;
      d.dur = this.rng.range(0.35, 1.1);
      d.v.set(0, 0, 0);
      return d;
    }
    return null;
  }

  update(dt, body, spawnRate, visible) {
    const rng = this.rng;
    this.mesh.visible = visible;
    if (!visible) return;
    this.acc += dt * spawnRate;
    while (this.acc > 1) {
      this.acc -= 1;
      const sp = body._dripPts[rng.int(0, body._dripPts.length - 1)];
      this.spawn(sp.bone, sp.p, rng.range(0.005, 0.011) * sp.size);
    }
    const bones = body.bones;
    const m = this._m, q = this._q.identity(), s = this._s;
    for (let i = 0; i < this.n; i++) {
      const d = this.d[i];
      if (d.st === 0) continue;
      d.t += dt;
      if (d.st === 1) {
        // hanging & growing on the body
        d.p.copy(d.lp).applyMatrix4(bones[d.bone].matrixWorld);
        const g = clamp(d.t / d.dur, 0, 1);
        s.set(d.r * (0.4 + 0.6 * g), d.r * (0.5 + 1.6 * g), d.r * (0.4 + 0.6 * g));
        d.p.y -= s.y * 0.8;
        if (d.t >= d.dur) {
          d.st = 2; d.t = 0;
          d.v.set(rng.range(-0.05, 0.05), -0.2, rng.range(-0.05, 0.05));
          d.gy = body._groundY(d.p.x, d.p.z);
        }
      } else if (d.st === 2) {
        d.v.y -= 9.8 * dt;
        d.p.addScaledVector(d.v, dt);
        const st = 1 + Math.min(2.5, -d.v.y * 0.35);
        s.set(d.r / Math.sqrt(st), d.r * st, d.r / Math.sqrt(st));
        if (d.p.y <= d.gy + 0.002) {
          d.st = 3; d.t = 0; d.p.y = d.gy + 0.0015;
          d.dur = rng.range(1.8, 4.0);
          d.r *= rng.range(2.4, 3.6);
        } else if (d.t > 3) d.st = 0;
      } else if (d.st === 3) {
        const k = 1 - clamp(d.t / d.dur, 0, 1);
        const sp = Math.min(1, d.t * 12);
        s.set(d.r * (0.4 + 0.6 * sp) * (0.3 + 0.7 * k), 0.0012 + 0.003 * k, d.r * (0.4 + 0.6 * sp) * (0.3 + 0.7 * k));
        if (d.t >= d.dur) d.st = 0;
      }
      if (d.st === 0) s.set(0, 0, 0);
      m.compose(d.p, q, s);
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose?.();
  }
}

// ---------------------------------------------------------------------------
// State presets (smoothed into this.p)
// ---------------------------------------------------------------------------
const PKEYS = ['quad', 'crouch', 'hunch', 'lean', 'armFwd', 'headFwd', 'listen', 'und', 'stun', 'despawn', 'stalk', 'scan', 'attack'];
const STATES = {
  idle: { quad: 0, crouch: 0.08, hunch: 1.15, lean: 0.12, armFwd: 0.0, headFwd: 0.45, listen: 0.2, und: 0.6 },
  wander: { quad: 0, crouch: 0.1, hunch: 1.25, lean: 0.2, armFwd: 0.05, headFwd: 0.55, und: 0.4, scan: 0.4 },
  investigate: { quad: 0, crouch: 0.2, hunch: 1.3, lean: 0.3, armFwd: 0.25, headFwd: 0.75, listen: 0.45, und: 0.6, scan: 1 },
  listen: { quad: 0, crouch: 0.15, hunch: 1.0, lean: 0.12, armFwd: 0.1, headFwd: 0.6, listen: 1, und: 0.25 },
  stalk: { quad: 0, crouch: 0.4, hunch: 1.55, lean: 0.45, armFwd: 0.55, headFwd: 1.0, listen: 0.25, und: 1.0, stalk: 1 },
  chase: { quad: 1, crouch: 0.12, hunch: 0.35, lean: 0.3, armFwd: 0.0, headFwd: 0.7, und: 0.5 },
  attack: { quad: 0, crouch: 0.18, hunch: 0.9, lean: 0.3, armFwd: 0.2, headFwd: 0.8, und: 0.2, attack: 1 },
  stunned: { quad: 0, crouch: 0.55, hunch: 1.5, lean: 0.35, armFwd: 0, headFwd: 0.2, und: 0.3, stun: 1 },
  hurt: { quad: -1, crouch: 0.3, hunch: 1.3, lean: 0.25, armFwd: 0.1, headFwd: 0.4, und: 0.3 },
  despawn: { quad: 0, crouch: 0.6, hunch: 1.6, lean: 0.4, armFwd: 0, headFwd: 0.2, und: 0.1, despawn: 1 },
};
const RATES = { quad: 4.5, attack: 9, stun: 3, despawn: 1.4, listen: 5, stalk: 3 };
const TWITCH_BONUS = { stalk: 0.9, listen: 0.5, investigate: 0.4, stunned: 3, hurt: 4, chase: 0.6, idle: 0.3 };
const FREEZE_RATE = { idle: 0.12, wander: 0.15, investigate: 0.3, listen: 0.35, stalk: 0.9, chase: 0.35, attack: 0, stunned: 0.6, hurt: 0, despawn: 0.25 };

// temporaries
const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _e = new V3(), _f = new V3(), _g = new V3();
const _qa = new Q(), _qb = new Q(), _qc = new Q(), _qd = new Q();
const _rpI = new V3(), _rest = new V3();
const _m4 = new THREE.Matrix4(), _bx = new V3(), _by = new V3(), _bz = new V3(), _bm = new THREE.Matrix4();
const _scl = new V3();

// Quaternion whose local +Y = y and local -Z faces `front` (projected perpendicular to y).
function quatYFront(y, front, out) {
  _by.copy(y);
  if (_by.lengthSq() < 1e-12) _by.set(0, 1, 0);
  _by.normalize();
  _bz.copy(front).addScaledVector(_by, -front.dot(_by));
  if (_bz.lengthSq() < 1e-8) {
    _bz.set(0, 0, -1).addScaledVector(_by, _by.z);
    if (_bz.lengthSq() < 1e-8) _bz.set(1, 0, 0).addScaledVector(_by, -_by.x);
  }
  _bz.normalize().negate();
  _bx.crossVectors(_by, _bz);
  _bm.makeBasis(_bx, _by, _bz);
  return out.setFromRotationMatrix(_bm);
}
const rotX = (q, a) => q.multiply(_qc.setFromAxisAngle(AX, a));
const rotY = (q, a) => q.multiply(_qc.setFromAxisAngle(AY, a));
const rotZ = (q, a) => q.multiply(_qc.setFromAxisAngle(AZ, a));

// Two-bone IK. Writes mid joint and end point; returns the stretch factor used (>= 1).
const _ikDir = new V3(), _ikBend = new V3();
function ik2(a, target, l1, l2, pole, maxStretch, outMid, outEnd, outBend) {
  _ikDir.subVectors(target, a);
  let d = _ikDir.length();
  if (d < 1e-5) { _ikDir.set(0, -1, 0); d = 1e-5; } else _ikDir.multiplyScalar(1 / d);
  const L = l1 + l2;
  const s = d > L * 0.995 ? Math.min(d / (L * 0.995), maxStretch) : 1;
  const L1 = l1 * s, L2 = l2 * s;
  d = clamp(d, Math.max(Math.abs(L1 - L2) + 0.02, 0.12 * L), (L1 + L2) * 0.9995);
  const cosA = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
  const A = Math.acos(clamp(cosA, -1, 1));
  _ikBend.copy(pole).addScaledVector(_ikDir, -pole.dot(_ikDir));
  if (_ikBend.lengthSq() < 1e-8) _ikBend.set(0, 0, -1).addScaledVector(_ikDir, _ikDir.z);
  if (_ikBend.lengthSq() < 1e-8) _ikBend.set(1, 0, 0).addScaledVector(_ikDir, -_ikDir.x);
  _ikBend.normalize();
  outMid.copy(a).addScaledVector(_ikDir, Math.cos(A) * L1).addScaledVector(_ikBend, Math.sin(A) * L1);
  outEnd.copy(a).addScaledVector(_ikDir, d);
  if (outBend) outBend.copy(_ikBend);
  return s;
}

// ---------------------------------------------------------------------------
// BacteriaBody
// ---------------------------------------------------------------------------
export class BacteriaBody {
  constructor(seed = 1) {
    this.seed = seed;
    this.rng = new RNG((seed * 2654435761) >>> 0 || 1);
    this.root = new THREE.Group();
    this.root.name = 'BacteriaBody';
    this.onStep = null;
    /** Stop-motion choppiness multiplier (0 disables choppy pose stepping). */
    this.choppiness = 1;

    this._defineBones();
    this.uniforms = {
      uDissolve: { value: 0 },
      uMeltC: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uBump: { value: 0.0022 },
    };
    this.material = makeBodyMaterial(this.uniforms);
    const geo = this._buildGeometry(new RNG((seed * 7919 + 17) >>> 0 || 1));
    this.geometry = geo;

    this.bones = [];
    const inv = [];
    for (let i = 0; i < this.def.length; i++) {
      const b = new THREE.Bone();
      b.name = this.def[i].name;
      b.matrixAutoUpdate = false;
      b.matrixWorldAutoUpdate = false;
      b.matrixWorld.copy(this.bind[i]);
      this.bones.push(b);
      inv.push(this.bind[i].clone().invert());
    }
    this.skeleton = new THREE.Skeleton(this.bones, inv);
    const mesh = (this.mesh = new THREE.SkinnedMesh(geo, this.material));
    mesh.name = 'BacteriaMesh';
    mesh.bind(this.skeleton, new THREE.Matrix4());
    mesh.boundingSphere = new THREE.Sphere(new V3(0, 1.2, 0), 3.2);
    mesh.boundingBox = new THREE.Box3(new V3(-3, -0.5, -3), new V3(3, 3.2, 3));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = makeShadowMaterial(this.uniforms, THREE.MeshDepthMaterial, { depthPacking: THREE.RGBADepthPacking });
    mesh.customDistanceMaterial = makeShadowMaterial(this.uniforms, THREE.MeshDistanceMaterial, {});
    this.root.add(mesh);

    this.drips = new Drips(40, new RNG((seed * 31337 + 5) >>> 0 || 1));
    this.root.add(this.drips.mesh);

    this._initState();
    this._dissolve = 0;
  }

  // ---------------------------------------------------------------- skeleton
  _defineBones() {
    const def = (this.def = []);
    const id = (this.id = {});
    const E = (x, y, z) => new Q().setFromEuler(new THREE.Euler(x, y, z));
    const add = (name, parent, at, rel, len) => {
      id[name] = def.length;
      def.push({ name, parent: parent == null ? -1 : id[parent], at: new V3(...at), rel, len });
      return id[name];
    };
    add('pelvis', null, [0, 1.36, 0], E(0, 0, 0), D.pelvis);
    for (let i = 0; i < 5; i++) add('sp' + i, i ? 'sp' + (i - 1) : 'pelvis', [0, i ? D.spine : D.pelvis, 0], E(0, 0, 0), D.spine);
    add('neck0', 'sp4', [0, D.spine, 0], E(0, 0, 0), D.neck);
    add('neck1', 'neck0', [0, D.neck, 0], E(0, 0, 0), D.neck);
    add('head', 'neck1', [0, D.neck, 0], E(0, 0, 0), D.head);
    this.tenIds = [];
    TENDRILS.forEach((t, n) => {
      const a = add('tenA' + n, 'head', t.at, E(t.rx, 0, t.rz), D.tenA);
      const b = add('tenB' + n, 'tenA' + n, [0, D.tenA, 0], E(0.25, 0, 0), D.tenB);
      this.tenIds.push([a, b]);
    });
    this.sides = [];
    for (const s of [-1, 1]) {
      const S = s < 0 ? 'L' : 'R';
      const o = { s };
      o.clav = add('clav' + S, 'sp4', [s * 0.03, 0.15, 0], E(0, 0, -s * Math.PI / 2), D.clav);
      o.uarm = add('uarm' + S, 'clav' + S, [0, D.clav, 0], E(0, 0, 0), D.uarm);
      o.farm = add('farm' + S, 'uarm' + S, [0, D.uarm, 0], E(0, 0, 0), D.farm);
      o.hand = add('hand' + S, 'farm' + S, [0, D.farm, 0], E(0, 0, 0), D.hand);
      o.fing = [];
      for (let k = 0; k < 4; k++) {
        const fa = add(`f${k}a${S}`, 'hand' + S, [FINGER_X[k], D.hand, 0], E(0, 0, 0), D.f1);
        const fb = add(`f${k}b${S}`, `f${k}a${S}`, [0, D.f1, 0], E(0, 0, 0), D.f2);
        o.fing.push([fa, fb]);
      }
      o.thigh = add('thigh' + S, 'pelvis', [s * D.hipX, D.hipY, 0], E(0, 0, Math.PI), D.thigh);
      o.shin = add('shin' + S, 'thigh' + S, [0, D.thigh, 0], E(0, 0, 0), D.shin);
      o.foot = add('foot' + S, 'shin' + S, [0, D.shin, 0], E(-Math.PI / 2, 0, 0), D.foot);
      o.toe = add('toe' + S, 'foot' + S, [0, D.foot, 0], E(0, 0, 0), D.toe);
      this.sides.push(o);
    }
    // bind matrices (T-pose-ish layout; only consistency of joints matters)
    this.bind = [];
    for (let i = 0; i < def.length; i++) {
      const dd = def[i];
      const local = new THREE.Matrix4().compose(dd.at, dd.rel, new V3(1, 1, 1));
      this.bind.push(dd.parent < 0 ? local : this.bind[dd.parent].clone().multiply(local));
    }
    const n = def.length;
    this.bPos = Array.from({ length: n }, () => new V3());
    this.bQ = Array.from({ length: n }, () => new Q());
    this.bS = new Float32Array(n).fill(1);
  }

  // ---------------------------------------------------------------- geometry
  _buildGeometry(rng) {
    const id = this.id, sg = new SkinGeo(this.bind);
    const len = (b) => this.def[b].len;
    const seed = () => rng.range(0, 99);
    const knob = (part, c, r, det = 1, amp = 0.35) => part.blob(c, r, r * rng.range(0.9, 1.25), r, det, amp, 5, seed());
    this._dripPts = [];
    // grape-like bacterial colony growth
    const cluster = (part, cx, cy, cz, spread, n, r0, r1) => {
      for (let k = 0; k < n; k++) {
        const r = rng.range(r0, r1);
        part.blob(new V3(cx + rng.range(-spread, spread), cy + rng.range(-spread, spread) * 1.3, cz + rng.range(-spread, spread)),
          r, r * rng.range(0.8, 1.3), r, rng.next() < 0.4 ? 1 : 0, 0.35, 5, seed());
      }
    };
    const drip = (bone, x, y, z, size = 1, w = 1) => { for (let i = 0; i < w; i++) this._dripPts.push({ bone, p: new V3(x, y, z), size }); };

    // ---- pelvis ----
    {
      const part = new Part();
      for (const s of [-1, 1]) {
        for (let k = 0; k < 2; k++) {
          const y0 = rng.range(0.0, 0.07), W = rng.range(0.11, 0.15), ph = seed(), a0 = rng.range(-0.1, 0.4), span = rng.range(0.6, 0.95) * Math.PI;
          part.tube((t, out) => {
            const a = a0 + t * span;
            return out.set(s * W * Math.sin(a), y0 - 0.07 * t * t + 0.015 * noise1(ph + t * 5), -0.02 + 0.075 * Math.cos(a));
          }, (t) => 0.015 * Math.max(0.4, 1 + 0.55 * noise1(ph + t * 9)), 5, 12);
        }
        part.blob(new V3(s * 0.09, 0.03, 0.0), 0.05, 0.055, 0.045, 1, 0.5, 6, seed());
        // pubic / groin strands down to the hips
        tendril(part, rng, new V3(s * 0.03, 0.0, -0.08), new V3(s * 0.9, -0.5, 0.3), 0.12, 0.012, 0.008, 0.02, 5, 6);
      }
      knob(part, new V3(0, 0.03, 0.055), 0.05);
      part.blob(new V3(0, -0.025, -0.06), 0.035, 0.03, 0.028, 1, 0.4, 5, seed());
      sg.add(part, id.pelvis, segW(id.pelvis, D.pelvis, -1, id.sp0, 0.04));
      drip(id.pelvis, 0, -0.04, -0.07, 1.2, 2);
    }

    // ---- spine / torso ----
    const ribW = [0, 0.1, 0.125, 0.14, 0.13];
    for (let i = 0; i < 5; i++) {
      const b = id['sp' + i];
      const parent = i ? id['sp' + (i - 1)] : id.pelvis;
      const child = i < 4 ? id['sp' + (i + 1)] : id.neck0;
      const part = new Part();
      strandBundle(part, rng, D.spine, { n: 3, R: 0.024, th: 0.016, twist: 0.8, zOff: 0.05, pinch: 0.55, nod: 1 });
      knob(part, new V3(0, 0, 0.056), 0.028, 1, 0.4);
      // erector strands along the back
      for (const s of [-1, 1]) {
        const ph = seed();
        part.tube((t, out) => out.set(s * (0.05 + 0.012 * noise1(ph + t * 3)), t * D.spine, 0.045 + 0.01 * Math.sin(Math.PI * t)),
          (t) => 0.011 * (0.6 + 0.4 * Math.sin(Math.PI * t)) * (1 + 0.4 * noise1(ph + t * 6)), 5, 6);
      }
      if (i >= 1) {
        // root-like strands wrapping the torso irregularly (gaps between them)
        for (const s of [-1, 1]) {
          for (let k = 0; k < 3; k++) {
            const y0 = rng.range(0.0, 0.17), W = ribW[i] * rng.range(0.85, 1.12), ph = seed();
            const dy = rng.range(-0.11, 0.06), a0 = rng.range(-0.15, 0.35), span = rng.range(0.55, 1.0) * Math.PI;
            const th = rng.range(0.011, 0.019);
            part.tube((t, out) => {
              const a = a0 + t * span;
              const w = W * (1 + 0.14 * noise1(ph + t * 5));
              return out.set(s * w * Math.sin(a), y0 + dy * t + 0.015 * noise1(ph * 2 + t * 6), -0.03 + 0.09 * Math.cos(a) * (1 + 0.1 * noise1(ph * 3 + t * 4)));
            }, (t) => th * (1 - 0.35 * t) * Math.max(0.35, 1 + 0.6 * noise1(ph + t * 13)), 5, 14);
          }
        }
      }
      if (i >= 2) {
        // sternum strands
        for (const s of [-1, 1]) {
          const ph = seed();
          part.tube((t, out) => out.set(s * (0.022 + 0.01 * noise1(ph + t * 4)), t * D.spine, -0.11 + 0.012 * noise1(ph * 2 + t * 3)),
            (t) => 0.009 * (0.5 + 0.5 * Math.sin(Math.PI * t)) * (1 + 0.5 * noise1(ph + t * 8)), 5, 6);
        }
      } else {
        // emaciated abdomen: a few thin wandering strands
        for (let k = 0; k < 4; k++) {
          const x0 = [-0.07, -0.025, 0.025, 0.07][k], z0 = k === 0 || k === 3 ? -0.02 : -0.065, ph = seed();
          part.tube((t, out) => out.set(x0 + 0.015 * noise1(ph + t * 3), t * D.spine, z0 + 0.015 * noise1(ph * 1.3 + t * 3) - 0.01 * Math.sin(Math.PI * t)),
            (t) => 0.011 * (0.6 + 0.4 * Math.sin(Math.PI * t)) * (1 + 0.5 * noise1(ph + t * 9)), 5, 6);
        }
      }
      // inner colony mass (lumpy, partly visible through the gaps)
      for (let k = 0; k < (i >= 2 ? 4 : 3); k++) {
        const r = (i >= 2 ? rng.range(0.045, 0.07) : rng.range(0.03, 0.05));
        part.blob(new V3(rng.range(-0.05, 0.05), rng.range(0.02, 0.16), rng.range(-0.06, 0.01)), r * rng.range(0.9, 1.3), r * rng.range(1.0, 1.5), r * 0.9, 1, 0.5, 7, seed());
      }
      if (i >= 3) {
        // ragged spikes on the upper back
        for (let k = 0; k < 2; k++) {
          const s = k ? 1 : -1;
          tendril(part, rng, new V3(s * rng.range(0.03, 0.09), rng.range(0.04, 0.14), 0.06), new V3(s * 0.4, 0.6, 1), rng.range(0.04, 0.1), 0.011, 0.0, 0.015, 4, 5);
        }
      }
      if (i === 4) {
        // scapulae + trapezius
        for (const s of [-1, 1]) {
          part.blob(new V3(s * 0.095, 0.08, 0.07), 0.05, 0.075, 0.022, 1, 0.45, 6, seed(), new Q().setFromEuler(new THREE.Euler(0, s * 0.4, s * 0.2)));
          const ph = seed();
          part.tube((t, out) => out.set(s * (0.02 + 0.17 * t), 0.2 - 0.06 * t * t + 0.01 * noise1(ph + t * 4), 0.025 - 0.01 * t),
            (t) => 0.012 * (0.6 + 0.4 * Math.sin(Math.PI * t)) * (1 + 0.4 * noise1(ph + t * 7)), 5, 8);
        }
      }
      sg.add(part, b, segW(b, D.spine, parent, child, 0.05));
      if (i >= 1) drip(b, rng.range(-0.08, 0.08), 0.03, -0.1, 1, 1);
    }

    // ---- neck ----
    for (let i = 0; i < 2; i++) {
      const b = id['neck' + i];
      const part = new Part();
      strandBundle(part, rng, D.neck, { n: 5, R: 0.028, th: 0.014, twist: 2.2, pinch: 0.45, segLen: 0.025, core: 0.02, gaps: 0 });
      if (i === 0) { knob(part, new V3(0, 0, 0.01), 0.032); cluster(part, 0, 0.02, 0.01, 0.035, 5, 0.009, 0.018); }
      sg.add(part, b, segW(b, D.neck, i ? id.neck0 : id.sp4, i ? id.head : id.neck1, 0.03));
    }

    // ---- head ----
    {
      const part = new Part();
      const tilt = new Q().setFromEuler(new THREE.Euler(0.38, 0, 0));
      // narrow cranium swept back + a long jutting face/jaw mass
      part.blob(new V3(0, 0.165, 0.015), 0.06, 0.105, 0.078, 3, 0.26, 3.8, seed(), tilt);
      part.blob(new V3(0, 0.075, -0.04), 0.044, 0.08, 0.05, 2, 0.32, 4.5, seed(), new Q().setFromEuler(new THREE.Euler(-0.35, 0, 0)));
      part.blob(new V3(0.004, 0.005, -0.07), 0.026, 0.03, 0.026, 1, 0.35, 5, seed());
      // brow ridge lumps over hollow sockets
      for (const sx of [-1, 1]) part.blob(new V3(sx * 0.03, 0.125, -0.06), 0.022, 0.016, 0.02, 1, 0.4, 6, seed());
      // bacterial colony lumps on the skull
      for (let k = 0; k < 18; k++) {
        const th = rng.range(0, TAU), el = rng.range(-0.5, 1.3);
        const dir = new V3(Math.cos(th) * Math.cos(el), Math.sin(el), Math.sin(th) * Math.cos(el));
        const c = new V3(dir.x * 0.056, 0.165 + dir.y * 0.095, 0.015 + dir.z * 0.07).applyQuaternion(tilt);
        const r = rng.range(0.012, 0.03);
        part.blob(c, r, r * rng.range(0.8, 1.4), r, 1, 0.45, 5, seed());
      }
      // spiky tendril protrusions radiating from crown / back / sides
      for (let k = 0; k < 15; k++) {
        const th = rng.range(-0.6, Math.PI + 0.6), el = rng.range(-0.6, 1.25);
        const dir = new V3(Math.cos(th) * Math.cos(el), Math.sin(el), Math.sin(th) * Math.cos(el) * 0.9 + 0.25);
        dir.normalize();
        const c = new V3(dir.x * 0.055, 0.165 + dir.y * 0.1, 0.015 + dir.z * 0.07).applyQuaternion(tilt);
        const d = dir.clone().applyQuaternion(tilt).add(new V3(0, rng.range(-0.1, 0.3), rng.range(0.15, 0.6))).normalize();
        tendril(part, rng, c, d, rng.range(0.035, 0.19), rng.range(0.007, 0.013), 0,
          new V3(rng.range(-0.15, 0.15), rng.range(-0.3, 0.1), rng.range(0.05, 0.35)), 5, 7);
      }
      sg.add(part, id.head, segW(id.head, D.head, id.neck1, -1, 0.04));
      drip(id.head, 0, 0.0, -0.06, 1.2, 4);
      drip(id.head, 0.03, 0.06, -0.08, 1, 1);
      drip(id.head, -0.03, 0.06, -0.08, 1, 1);
      // animated tendrils
      this.tenIds.forEach(([a, b2]) => {
        const pa = new Part();
        tendril(pa, rng, new V3(0, -0.01, 0), AY, D.tenA + 0.012, 0.014, 0.009, new V3(0, 0, 0.02), 5, 7);
        knob(pa, new V3(0, 0, 0), 0.016, 0, 0.3);
        sg.add(pa, a, segW(a, D.tenA, id.head, b2, 0.03));
        const pb = new Part();
        tendril(pb, rng, new V3(0, -0.005, 0), AY, D.tenB, 0.0095, 0.0, new V3(0, 0, 0.03), 5, 8);
        sg.add(pb, b2, segW(b2, D.tenB, a, -1, 0.03));
      });
    }

    // ---- arms ----
    for (const o of this.sides) {
      // clavicle
      {
        const part = new Part();
        strandBundle(part, rng, D.clav, { n: 4, R: 0.02, th: 0.016, twist: 0.9, pinch: 0.4 });
        sg.add(part, o.clav, segW(o.clav, D.clav, id.sp4, o.uarm, 0.04));
      }
      {
        const part = new Part();
        strandBundle(part, rng, D.uarm, { n: 5, R: 0.036, th: 0.016, twist: 1.5, nod: 5, core: 0.024, gaps: 2 });
        knob(part, new V3(0, 0, 0), 0.045);
        cluster(part, 0, 0.01, 0, 0.045, 6, 0.01, 0.022);
        cluster(part, 0, rng.range(0.2, 0.6), 0, 0.03, 4, 0.008, 0.018);
        sg.add(part, o.uarm, segW(o.uarm, D.uarm, o.clav, o.farm, 0.06));
        drip(o.uarm, 0, D.uarm * 0.6, 0.02, 0.9);
      }
      {
        const part = new Part();
        strandBundle(part, rng, D.farm, { n: 5, R: 0.03, th: 0.0145, twist: 1.3, nod: 5, core: 0.02, gaps: 2 });
        knob(part, new V3(0, 0, 0), 0.034);
        cluster(part, 0, 0.0, 0, 0.035, 5, 0.008, 0.018);
        cluster(part, 0, rng.range(0.25, 0.65), 0, 0.025, 3, 0.007, 0.015);
        sg.add(part, o.farm, segW(o.farm, D.farm, o.uarm, o.hand, 0.06));
        drip(o.farm, 0, D.farm * 0.5, 0.02, 0.9);
        drip(o.farm, 0, D.farm * 0.85, 0.0, 0.9);
      }
      {
        // palm: metacarpal strands fanning to the knuckles + web
        const part = new Part();
        for (let k = 0; k < 4; k++) {
          const fx = FINGER_X[k], ph = seed();
          part.tube((t, out) => out.set(fx * (0.25 + 0.75 * t), t * D.hand, -0.004 * Math.sin(Math.PI * t) + 0.004 * noise1(ph + t * 3)),
            (t) => 0.0085 * (0.75 + 0.25 * Math.sin(Math.PI * t)) * (1 + 0.35 * noise1(ph + t * 9)), 5, 5);
        }
        part.blob(new V3(0, D.hand * 0.45, 0.002), 0.03, 0.045, 0.011, 1, 0.3, 6, seed());
        knob(part, new V3(0, 0, 0), 0.026);
        sg.add(part, o.hand, segW(o.hand, D.hand, o.farm, -1, 0.04));
      }
      o.fing.forEach(([fa, fb], k) => {
        const pa = new Part();
        const ph = seed();
        pa.tube((t, out) => out.set(0.002 * noise1(ph + t * 4), t * D.f1, -0.006 * Math.sin(Math.PI * t)),
          (t) => 0.0082 * (0.8 + 0.2 * Math.sin(Math.PI * t)) * (1 + 0.35 * noise1(ph + t * 14)), 5, 6);
        // thin tendon wrapping the phalanx
        pa.tube((t, out) => out.set(Math.cos(t * 5 + ph) * 0.007, t * D.f1, Math.sin(t * 5 + ph) * 0.007),
          (t) => 0.0035 * Math.sin(Math.PI * t), 4, 8);
        knob(pa, new V3(0, 0, 0), 0.0115, 1, 0.35);
        sg.add(pa, fa, segW(fa, D.f1, o.hand, fb, 0.02));
        const pb = new Part();
        pb.tube((t, out) => out.set(0.002 * noise1(ph * 2 + t * 4), t * D.f2, -0.012 * t * t),
          (t) => 0.0072 * Math.pow(1 - t, 0.75) * (1 + 0.3 * noise1(ph + t * 12)), 5, 8);
        knob(pb, new V3(0, 0, 0), 0.0095, 0, 0.3);
        sg.add(pb, fb, segW(fb, D.f2, fa, -1, 0.02));
        drip(fb, 0, D.f2 * 0.95, -0.01, 0.8, 2);
      });
    }

    // ---- legs ----
    for (const o of this.sides) {
      {
        const part = new Part();
        strandBundle(part, rng, D.thigh, { n: 5, R: 0.052, th: 0.021, twist: 1.2, nod: 5, core: 0.034, gaps: 1 });
        knob(part, new V3(0, 0.0, 0), 0.05);
        cluster(part, 0, 0.03, 0, 0.05, 5, 0.012, 0.026);
        cluster(part, 0, rng.range(0.2, 0.5), 0, 0.04, 4, 0.01, 0.02);
        sg.add(part, o.thigh, segW(o.thigh, D.thigh, id.pelvis, o.shin, 0.06));
      }
      {
        const part = new Part();
        strandBundle(part, rng, D.shin, { n: 5, R: 0.04, th: 0.017, twist: 1.4, nod: 4, core: 0.026, gaps: 2 });
        knob(part, new V3(0, 0, -0.008), 0.042);
        cluster(part, 0, 0.0, -0.01, 0.042, 6, 0.01, 0.022);
        sg.add(part, o.shin, segW(o.shin, D.shin, o.thigh, o.foot, 0.06));
        drip(o.shin, 0, D.shin * 0.3, 0, 0.8);
      }
      {
        // foot: local -Z faces up, +Z is the sole
        const part = new Part();
        for (let k = 0; k < 3; k++) {
          const x1 = (k - 1) * 0.024, ph = seed();
          part.tube((t, out) => out.set(x1 * t + 0.003 * noise1(ph + t * 3), t * D.foot, 0.004 * Math.sin(Math.PI * t)),
            (t) => 0.0105 * (0.7 + 0.3 * Math.sin(Math.PI * t)) * (1 + 0.35 * noise1(ph + t * 9)), 5, 6);
        }
        knob(part, new V3(0, 0, 0), 0.03);
        part.blob(new V3(0, -0.012, 0.014), 0.02, 0.034, 0.02, 1, 0.35, 5, seed());
        sg.add(part, o.foot, segW(o.foot, D.foot, o.shin, o.toe, 0.03));
      }
      {
        const part = new Part();
        for (let k = 0; k < 3; k++) {
          const x0 = (k - 1) * 0.024;
          tendril(part, rng, new V3(x0, 0, 0), new V3(x0 * 0.9, 1, 0.08), D.toe * rng.range(0.9, 1.25), 0.0095, 0.0, new V3(0, 0, 0.05), 5, 6);
        }
        knob(part, new V3(0, 0, 0), 0.02, 1, 0.3);
        sg.add(part, o.toe, segW(o.toe, D.toe, o.foot, -1, 0.025));
      }
    }
    return sg.build();
  }

  // ---------------------------------------------------------------- state
  _initState() {
    this.time = 0;
    this.p = {};
    for (const k of PKEYS) this.p[k] = STATES.idle[k] ?? 0;
    this.state = 'idle';
    this.intensity = 0.5;
    this.bodyPos = new V3();
    this.bodyYaw = 0;
    this.vel = new V3();
    this.speed = 0;
    this.walkAmt = 0;
    this.galAmt = 0;
    this.phase = 0;
    this.floorY = 0;
    this.ceilY = Infinity;
    this.hunchExtra = 0;
    this.crouchExtra = 0;
    this.freezeT = 0;
    this.frozenAcc = 0;
    this.poseAcc = 0;
    this.poseIv = 0;
    this.attackT = 0;
    this._prevAttackT = 0;
    this._atk = { w: 0, wind: 0, strike: 0 };
    this._prevRoot = new V3();
    this._prevYaw = 0;
    this._rootPos = new V3();
    this._rootYaw = 0;
    this._init = false;
    this._groundFn = null;
    this.headPos = new V3(0, 2.4, 0);
    this.headTop = new V3();
    this.shoulder = [new V3(), new V3()];
    this.lookTarget = null;
    this._look = new V3();
    this.head = { yaw: 0, pitch: 0, roll: 0, ty: 0, tp: 0, tr: 0, snapT: 0, snapRate: 30, rollT: 0, tremT: 0, trem: new V3() };
    this.tw = {
      head: new V3(), spine: new V3(), pelvis: new V3(),
      sh: [new V3(), new V3()], hand: [new V3(), new V3()], reach: [0, 0],
      fing: [[0, 0, 0, 0], [0, 0, 0, 0]],
    };
    // limbs: 0 legL, 1 legR, 2 armL, 3 armR
    this.limbs = [];
    for (let i = 0; i < 4; i++) {
      this.limbs.push({
        arm: i >= 2, side: i % 2 === 0 ? -1 : 1, k: i % 2,
        plant: new V3(), cur: new V3(), from: new V3(), to: new V3(),
        yaw: 0, fromYaw: 0, swinging: false, t: 0, dur: 0.2, lift: 0.1, lastF: 0, pitch: FOOT_PITCH,
      });
    }
    this.arms = [0, 1].map(() => ({ pos: new V3(), vel: new V3() }));
    this._F = new V3(); this._R = new V3(); this._qYaw = new Q();
    this._pelvisPos = new V3(); this._qPelvis = new Q(); this._qChest = new Q(); this._qHead = new Q();
    this._tmpV = new V3();
    this._snapTo(new V3(), 0);
    this._solveAll();
    this._writeBones();
  }

  _groundY(x, z) {
    if (this._groundFn) {
      const y = this._groundFn(x, z);
      if (Number.isFinite(y)) return y;
    }
    return this.floorY;
  }

  _snapTo(pos, yaw) {
    this.bodyPos.copy(pos);
    this.floorY = pos.y;
    this.bodyYaw = yaw;
    this._prevRoot.copy(pos);
    this._prevYaw = yaw;
    this.vel.set(0, 0, 0);
    this.speed = 0;
    this.hunchExtra = 0;
    this.crouchExtra = 0;
    this.freezeT = 0;
    this.frozenAcc = 0;
    for (const l of this.limbs) {
      this._restPoint(l, l.plant, 0);
      l.cur.copy(l.plant);
      l.yaw = yaw;
      l.swinging = false;
      l.pitch = FOOT_PITCH;
    }
    this._F.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    for (let k = 0; k < 2; k++) {
      this.arms[k].pos.copy(pos).addScaledVector(this._F, 0.1);
      this.arms[k].pos.x += Math.cos(yaw) * (k ? 0.3 : -0.3);
      this.arms[k].pos.z -= Math.sin(yaw) * (k ? 0.3 : -0.3);
      this.arms[k].pos.y += 0.6;
      this.arms[k].vel.set(0, 0, 0);
      this.shoulder[k].copy(this.arms[k].pos).y += 1.5;
    }
    this.head.yaw = this.head.ty = 0;
    this.head.pitch = this.head.tp = 0;
    this.headPos.copy(pos).y += 2.4;
    this._init = true;
  }

  // Rest (neutral) ground point for a limb in world space, plus velocity lead.
  _restPoint(l, out, lead) {
    const yaw = this.bodyYaw, q = this.p.quad;
    const F = _g.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    let x, z;
    if (!l.arm) {
      x = l.side * (0.14 + 0.06 * q + this.p.crouch * 0.07 + this.p.stun * 0.06);
      z = lerp(0.02, 0.42, q) + l.side * 0.07 * (1 - q) * (1 - this.walkAmt); // staggered idle stance
    } else {
      x = l.side * 0.42;
      z = -0.98;
    }
    out.set(this.bodyPos.x + Math.cos(yaw) * x - F.x * z, 0, this.bodyPos.z - Math.sin(yaw) * x - F.z * z);
    if (lead) { out.x += this.vel.x * lead; out.z += this.vel.z * lead; }
    out.y = this._groundY(out.x, out.z);
    return out;
  }

  // ---------------------------------------------------------------- public API
  /**
   * Advance animation. s = { velocity, state, lookTarget, attackT, ceilingY, groundAt, intensity }.
   */
  update(dt, s = {}) {
    if (!(dt >= 0)) dt = 0;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    const root = this.root;
    root.updateWorldMatrix(true, false);
    const e = root.matrixWorld.elements;
    const rp = this._rootPos.set(e[12], e[13], e[14]);
    const ry = Math.atan2(e[8], e[10]);
    this._rootYaw = ry;
    this._groundFn = typeof s.groundAt === 'function' ? s.groundAt : null;
    this.ceilY = Number.isFinite(s.ceilingY) ? s.ceilingY : Infinity;
    this.intensity = clamp(Number.isFinite(s.intensity) ? s.intensity : 0.5, 0, 1);
    this.attackT = clamp(Number.isFinite(s.attackT) ? s.attackT : 0, 0, 1);
    if (s.lookTarget && Number.isFinite(s.lookTarget.x)) { this._look.copy(s.lookTarget); this.lookTarget = this._look; } else this.lookTarget = null;
    this._vin = s.velocity && Number.isFinite(s.velocity.x) && Number.isFinite(s.velocity.z) ? s.velocity : null;
    const state = STATES[s.state] ? s.state : 'idle';

    if (!this._init || !Number.isFinite(rp.x + rp.y + rp.z) || rp.distanceToSquared(this.bodyPos) > 9) {
      if (Number.isFinite(rp.x + rp.y + rp.z)) this._snapTo(rp, ry);
    }
    if (state !== this.state) this._onStateChange(this.state, state);
    this.state = state;

    let simDt;
    if (this.freezeT > 0) {
      this.freezeT -= dt;
      this.frozenAcc += dt;
      if (this.freezeT > 0) {
        this._updateDrips(dt);
        return;
      }
      simDt = this.frozenAcc;
      this.frozenAcc = 0;
    } else simDt = dt;
    simDt = Math.min(simDt, 0.5);
    this._maybeFreeze(dt);

    const n = Math.max(1, Math.ceil(simDt / (1 / 45)));
    const h = simDt / n;
    const pr = this._prevRoot, py = this._prevYaw;
    const dyaw = angDiff(py, ry);
    for (let i = 1; i <= n; i++) {
      const a = i / n;
      _rpI.lerpVectors(pr, rp, a);
      this._step(h, _rpI, py + dyaw * a);
    }
    this._prevRoot.copy(rp);
    this._prevYaw = ry;
    this._prevAttackT = this.attackT;

    this._solveAll();
    if (!this._finitePose()) {
      // never let a bad frame explode the rig: reset around the root
      this._snapTo(rp, ry);
      this._solveAll();
    }
    this._writeBones();
    this._updateDrips(dt);
  }

  getHeadWorldPosition(target = new V3()) {
    return target.copy(this.headPos);
  }

  setDissolve(t) {
    t = clamp(Number.isFinite(t) ? t : 0, 0, 1);
    this._dissolve = t;
    this.uniforms.uDissolve.value = t;
    this.mesh.visible = t < 0.999;
  }

  dispose() {
    this.root.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.customDepthMaterial?.dispose();
    this.mesh.customDistanceMaterial?.dispose();
    this.skeleton.dispose();
    this.drips.dispose();
    this.onStep = null;
  }

  // ---------------------------------------------------------------- internals
  _onStateChange(prev, next) {
    this.freezeT = 0;
    if (this.frozenAcc > 0) this.frozenAcc = Math.min(this.frozenAcc, 0.05);
    const tw = this.tw, r = this.rng;
    if (next === 'hurt') {
      tw.head.x += r.range(0.6, 1.0); tw.head.z += r.range(-1, 1) * 0.8; tw.head.y += r.range(-0.5, 0.5);
      tw.spine.x -= r.range(0.4, 0.7); tw.spine.z += r.range(-0.4, 0.4);
      for (let k = 0; k < 2; k++) {
        tw.hand[k].set(r.range(-0.3, 0.3), r.range(0.1, 0.4), r.range(-0.3, 0.3));
        tw.sh[k].y += 0.08;
        for (let f = 0; f < 4; f++) tw.fing[k][f] -= r.range(0.4, 0.9);
      }
    } else if (next === 'attack') {
      this.head.snapT = 0;
    } else if (next === 'chase' && prev !== 'chase') {
      // violent jolt as it drops to all fours
      tw.head.x += 0.5; tw.spine.x += 0.3;
    }
  }

  _maybeFreeze(dt) {
    const st = this.state, I = this.intensity;
    if (st === 'attack') {
      if (this._prevAttackT < 0.36 && this.attackT >= 0.36) this.freezeT = this.rng.range(0.08, 0.16);
      return;
    }
    const rate = (FREEZE_RATE[st] ?? 0.2) * (0.4 + 1.2 * I);
    if (this.rng.next() < rate * dt) {
      let d = this.rng.range(0.06, 0.28);
      if (st === 'chase') d = Math.min(this.rng.range(0.04, 0.1), 0.35 / Math.max(this.speed, 1));
      this.freezeT = d;
    }
  }

  _step(h, rp, ry) {
    if (h <= 0) return;
    const p = this.p, st = STATES[this.state], I = this.intensity;
    // ---- state params
    const clear = this.ceilY - rp.y;
    const lowCeil = Number.isFinite(clear) ? sstep(2.2, 1.7, clear) : 0;
    for (const k of PKEYS) {
      let tgt = st[k] ?? 0;
      if (k === 'quad') {
        if (tgt < 0) tgt = p.quad;
        if (this.state === 'attack') tgt = 0;
        tgt = Math.max(tgt, this.state === 'attack' || this.state === 'despawn' ? 0 : lowCeil);
      }
      const rate = k === 'quad' && this.state === 'attack' ? 10 : (RATES[k] ?? 4);
      p[k] += (tgt - p[k]) * dk(rate, h);
    }
    // ---- body frame follows the AI root with a bit of lag
    const vin = this._vin;
    const vx = vin ? vin.x : 0, vz = vin ? vin.z : 0;
    const kv = dk(10, h);
    this.vel.x += (vx - this.vel.x) * kv;
    this.vel.z += (vz - this.vel.z) * kv;
    this.vel.y = 0;
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    const kb = dk(18, h);
    this.bodyPos.x += (rp.x - this.bodyPos.x) * kb;
    this.bodyPos.z += (rp.z - this.bodyPos.z) * kb;
    this.bodyPos.y += (rp.y - this.bodyPos.y) * dk(12, h);
    const lx = this.bodyPos.x - rp.x, lz = this.bodyPos.z - rp.z, ll = Math.hypot(lx, lz);
    if (ll > 0.3) { this.bodyPos.x = rp.x + (lx / ll) * 0.3; this.bodyPos.z = rp.z + (lz / ll) * 0.3; }
    this.floorY = this.bodyPos.y;
    this.bodyYaw += angDiff(this.bodyYaw, ry) * dk(this.state === 'chase' ? 12 : 9, h);
    this.walkAmt = sstep(0.06, 0.8, this.speed) * (1 - p.quad);
    this.galAmt = sstep(0.3, 3.0, this.speed) * p.quad;
    // attack shape
    const a = this.attackT, A = this._atk;
    A.w = p.attack;
    A.wind = sstep(0.0, 0.3, a) * (1 - sstep(0.36, 0.44, a));
    A.strike = sstep(0.36, 0.44, a) * (1 - sstep(0.72, 1.0, a));
    // ceiling relax
    if (this.headTop.y < this.ceilY - 0.16) {
      this.hunchExtra = Math.max(0, this.hunchExtra - 0.35 * h);
      this.crouchExtra = Math.max(0, this.crouchExtra - 0.1 * h);
    }
    // ---- pose sims (optionally choppy / stop-motion stepped)
    this.poseAcc += h;
    if (this.poseAcc >= this.poseIv) {
      const H = Math.min(this.poseAcc, 0.12);
      this.poseAcc = 0;
      const chopState = this.state === 'stalk' || this.state === 'attack' || this.state === 'stunned' ? 1 : this.state === 'chase' ? 0.5 : 0.25;
      const chop = this.choppiness * chopState * clamp((I - 0.4) / 0.6, 0, 1);
      this.poseIv = chop > 0.02 ? this.rng.range(0.025, 0.085) * chop : 0;
      this._stepLimbs(H);
      this._stepArms(H);
      this._stepHead(H);
      this._stepTwitch(H);
    }
  }

  _stepLimbs(H) {
    const p = this.p, sp = this.speed, q = p.quad;
    const stride = lerp(1.0 + 0.45 * sp, 1.6 + 0.17 * sp, q);
    const swingFrac = lerp(0.4, 0.42, q);
    const freq = sp > 0.08 ? sp / stride : 0;
    const armsActive = q > 0.35;
    let need = false;
    for (const l of this.limbs) {
      if (l.arm && !armsActive) continue;
      if (l.swinging) { need = true; break; }
      this._restPoint(l, _a, 0);
      const dx = l.plant.x - _a.x, dz = l.plant.z - _a.z;
      if (dx * dx + dz * dz > 0.13 * 0.13 || Math.abs(angDiff(l.yaw, this.bodyYaw)) > 0.7) { need = true; break; }
    }
    let adv = freq;
    if (need && adv < 1.5) adv = 1.5;
    this.phase = (this.phase + adv * H) % 4096;
    const offs = q > 0.5 ? [0, 0.1, 0.5, 0.62] : [0, 0.5, 0.25, 0.75];
    const stanceT = freq > 0.05 ? Math.min((1 - swingFrac) / freq, 0.9) : 0;
    const maxLead = stride * 0.5;
    for (let i = 0; i < 4; i++) {
      const l = this.limbs[i];
      if (l.arm && !armsActive) {
        l.swinging = false;
        this._restPoint(l, l.plant, 0);
        l.cur.copy(l.plant);
        l.yaw = this.bodyYaw;
        l.lastF = (this.phase + offs[i]) % 1;
        continue;
      }
      const f = (((this.phase + offs[i]) % 1) + 1) % 1;
      const wrapped = f < l.lastF;
      l.lastF = f;
      if (l.swinging) {
        l.t += H / l.dur;
        const rem = Math.max(0, 1 - l.t) * l.dur;
        let lead = rem + stanceT * 0.5;
        if (lead * sp > maxLead) lead = maxLead / Math.max(sp, 1e-3);
        this._restPoint(l, _a, lead);
        l.to.lerp(_a, dk(30, H));
        l.to.y = _a.y;
        const t = Math.min(1, l.t);
        const e = 1 - Math.pow(1 - t, 2.6);
        l.cur.lerpVectors(l.from, l.to, e);
        l.cur.y += l.lift * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.1)), 0.8);
        l.yaw = l.fromYaw + angDiff(l.fromYaw, this.bodyYaw) * e;
        l.pitch = FOOT_PITCH + 0.75 * Math.sin(Math.PI * t);
        if (l.t >= 1) {
          l.swinging = false;
          l.plant.copy(l.to);
          l.cur.copy(l.plant);
          l.pitch = FOOT_PITCH;
          this._emitStep(l);
        }
      } else {
        l.cur.copy(l.plant);
        let lead = (freq > 0.05 ? Math.min(swingFrac / freq, 0.34) : 0.24) + stanceT * 0.5;
        if (lead * sp > maxLead) lead = maxLead / Math.max(sp, 1e-3);
        this._restPoint(l, _a, lead);
        const dd = Math.hypot(l.plant.x - _a.x, l.plant.z - _a.z);
        this._restPoint(l, _rest, 0);
        const dr = Math.hypot(l.plant.x - _rest.x, l.plant.z - _rest.z);
        const maxD = l.arm ? 1.15 : 1.0;
        const turn = Math.abs(angDiff(l.yaw, this.bodyYaw));
        if ((wrapped && (dd > 0.06 || turn > 0.25)) || dr > maxD) {
          l.swinging = true;
          l.t = 0;
          l.from.copy(l.plant);
          l.to.copy(_a);
          l.fromYaw = l.yaw;
          l.dur = dr > maxD ? 0.12 : freq > 0.05 ? clamp(swingFrac / freq, 0.08, 0.34) : 0.24;
          if (p.stalk > 0.5 && !l.arm) l.dur = Math.max(l.dur, 0.3);
          l.lift = l.arm ? 0.2 + 0.03 * sp : lerp(0.08 + 0.035 * sp, 0.14, q) + p.stalk * 0.16;
        }
      }
    }
  }

  _emitStep(l) {
    if (!this.onStep) return;
    const sp = this.speed;
    let loud = l.arm ? 0.35 + 0.07 * sp : 0.22 + 0.08 * sp;
    loud *= 1 - 0.45 * this.p.stalk;
    try { this.onStep(l.plant.clone(), clamp(loud, 0.05, 1)); } catch (err) { console.error(err); }
  }

  _stepArms(H) {
    const p = this.p, yaw = this.bodyYaw;
    const F = _b.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const R = _c.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const armLen = D.uarm + D.farm;
    const ph = this.phase * TAU;
    const k = lerp(70, 30, p.stun), c = lerp(7, 2.5, p.stun);
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      const ar = this.arms[i];
      const sh = this.shoulder[i];
      const swing = this.walkAmt * 0.26 * Math.sin(ph + (s > 0 ? 0 : Math.PI));
      const reach = lerp(0.95, 0.6, p.armFwd);
      _d.copy(sh)
        .addScaledVector(UP, -armLen * reach)
        .addScaledVector(F, 0.1 + p.armFwd * 0.7 + swing)
        .addScaledVector(R, s * (0.12 + 0.06 * p.stun + 0.05 * p.stalk));
      // creepy slow clawing sway while stalking/idle
      _d.addScaledVector(F, (0.06 + 0.1 * p.stalk) * noise1(this.time * 0.6 + i * 17));
      _d.y += 0.05 * noise1(this.time * 0.5 + i * 5);
      const fy = this.floorY + 0.12;
      if (_d.y < fy) _d.y = fy;
      // semi-implicit spring
      ar.vel.addScaledVector(_e.subVectors(_d, ar.pos), k * H).multiplyScalar(Math.max(0, 1 - c * H));
      ar.pos.addScaledVector(ar.vel, H);
      if (ar.pos.distanceTo(_d) > 0.6) ar.pos.sub(_d).setLength(0.6).add(_d);
      if (!Number.isFinite(ar.pos.x + ar.pos.y + ar.pos.z)) { ar.pos.copy(_d); ar.vel.set(0, 0, 0); }
    }
  }

  _stepHead(H) {
    const hd = this.head, p = this.p, r = this.rng, I = this.intensity, t = this.time;
    let yawD, pitchD;
    if (this.lookTarget) {
      _a.subVectors(this.lookTarget, this.headPos);
      const yw = Math.atan2(-_a.x, -_a.z);
      yawD = angDiff(this.bodyYaw, yw);
      pitchD = Math.atan2(_a.y, Math.hypot(_a.x, _a.z));
    } else {
      yawD = 0.5 * noise1(t * 0.17 + 5) * (0.4 + p.scan);
      pitchD = -0.12 + 0.14 * noise1(t * 0.21 + 2);
    }
    yawD += p.scan * 0.9 * noise1(t * 0.35 + 11);
    pitchD = lerp(pitchD, -0.85, p.stun * 0.7);
    pitchD = lerp(pitchD, -1.0, p.despawn);
    yawD = clamp(yawD, -2.5, 2.5);
    pitchD = clamp(pitchD, -1.2, 0.95);
    const fast = this.state === 'chase' || this.state === 'attack';
    hd.snapT -= H;
    if (hd.snapT <= 0) {
      const j = 0.04 + 0.22 * I + 0.25 * p.stun;
      hd.ty = yawD + r.range(-j, j);
      hd.tp = pitchD + r.range(-j, j) * 0.7;
      hd.snapT = fast ? r.range(0.04, 0.16) : r.range(0.1, 0.85) * (1 - 0.5 * I) * (1 + p.listen);
      hd.snapRate = fast ? r.range(25, 45) : r.range(16, 48);
    }
    hd.rollT -= H;
    if (hd.rollT <= 0) {
      const pe = 0.1 + 0.5 * p.listen + 0.3 * I * (1 - 0.5 * p.quad);
      hd.tr = r.next() < pe ? (r.next() < 0.5 ? -1 : 1) * r.range(0.75, 1.75) : r.range(-0.3, 0.3);
      hd.rollT = r.range(0.3, 1.6);
      if (I > 0.6 && r.next() < 0.14 * I) {
        hd.tr = (r.next() < 0.5 ? -1 : 1) * r.range(2.5, 3.0); // glitchy upside-down flick
        hd.rollT = r.range(0.07, 0.16);
      }
    }
    let tr = hd.tr;
    tr = lerp(tr, 0.9 * noise1(t * 0.45 + 3), p.stun);
    const k = dk(hd.snapRate, H);
    hd.yaw += angDiff(hd.yaw, hd.ty) * k;
    hd.pitch += (hd.tp - hd.pitch) * k;
    hd.roll += (tr - hd.roll) * dk(hd.snapRate * 0.6, H);
    hd.tremT -= H;
    if (hd.tremT <= 0) {
      const a = 0.01 + 0.05 * I * I + 0.06 * p.stun;
      hd.trem.set(r.range(-a, a), r.range(-a, a), r.range(-a, a) * 1.5);
      hd.tremT = r.range(0.03, 0.08);
    }
  }

  _stepTwitch(H) {
    const tw = this.tw, r = this.rng, I = this.intensity, p = this.p;
    const dec = Math.exp(-11 * H);
    tw.head.multiplyScalar(dec); tw.spine.multiplyScalar(dec); tw.pelvis.multiplyScalar(dec);
    for (let k = 0; k < 2; k++) {
      tw.sh[k].multiplyScalar(dec);
      tw.hand[k].multiplyScalar(dec);
      tw.reach[k] *= Math.exp(-4 * H);
      for (let f = 0; f < 4; f++) tw.fing[k][f] *= dec;
    }
    const bonus = TWITCH_BONUS[this.state] ?? 0;
    const rate = 0.2 + 2.4 * I * I + bonus;
    if (r.next() < rate * H) {
      const m = 0.5 + I;
      const roll = r.next();
      if (roll < 0.36) {
        tw.head.x += r.range(-0.45, 0.45) * m; tw.head.y += r.range(-0.5, 0.5) * m; tw.head.z += r.range(-0.7, 0.7) * m;
      } else if (roll < 0.52) {
        const k = r.int(0, 1);
        tw.sh[k].y += r.range(0.03, 0.08) * m; tw.sh[k].z += r.range(-0.06, 0.06) * m;
      } else if (roll < 0.66) {
        tw.spine.x += r.range(-0.3, 0.3) * m; tw.spine.y += r.range(-0.3, 0.3) * m; tw.spine.z += r.range(-0.25, 0.25) * m;
      } else if (roll < 0.8) {
        const k = r.int(0, 1);
        tw.hand[k].set(r.range(-0.2, 0.2), r.range(-0.1, 0.25), r.range(-0.2, 0.2)).multiplyScalar(m);
      } else if (roll < 0.94) {
        const k = r.int(0, 1);
        for (let f = 0; f < 4; f++) tw.fing[k][f] += r.range(-0.7, 0.7) * m;
      } else if (this.lookTarget && (p.stalk > 0.5 || this.state === 'investigate') && I > 0.4) {
        tw.reach[r.int(0, 1)] = 1; // sudden over-extended reach toward the target
      } else {
        tw.pelvis.x += r.range(-0.12, 0.12) * m; tw.pelvis.z += r.range(-0.1, 0.1) * m;
      }
    }
  }

  _solveAll() {
    for (let pass = 0; pass < 3; pass++) {
      this._solve();
      if (!Number.isFinite(this.ceilY)) break;
      const over = this.headTop.y - (this.ceilY - 0.06);
      if (over <= 0.002) break;
      this.hunchExtra = Math.min(this.hunchExtra + over * 1.4, 1.6);
      this.crouchExtra = Math.min(this.crouchExtra + over * 0.3, 0.45);
    }
  }

  _setBone(i, pos, q, s = 1) {
    this.bPos[i].copy(pos);
    this.bQ[i].copy(q);
    this.bS[i] = s;
  }

  // Solve the full world-space pose from the current simulation state.
  _solve() {
    const p = this.p, t = this.time, id = this.id, tw = this.tw;
    const yaw = this.bodyYaw;
    const F = this._F.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const R = this._R.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const qYaw = this._qYaw.setFromAxisAngle(AY, yaw);
    const BP = this.bodyPos;
    const quad = p.quad, walk = this.walkAmt, gal = this.galAmt;
    const ph = this.phase * TAU;
    const A = this._atk, aw = A.w;
    const I = this.intensity;

    // ---------------- pelvis
    let ext = lerp(0.94 - p.crouch * 0.33, 0.68 - p.crouch * 0.1, quad);
    ext -= p.stun * 0.1 + p.despawn * 0.45 + this.crouchExtra;
    ext += aw * (-0.1 * A.wind + 0.02 * A.strike);
    ext = clamp(ext, 0.22, 0.985);
    let hipH = 0.075 + (D.thigh + D.shin) * ext;
    hipH += walk * 0.025 * Math.cos(2 * ph) + gal * 0.07 * Math.sin(ph + 0.6) + 0.008 * Math.sin(t * 1.4);
    const sway = walk * 0.04 * Math.sin(ph) + 0.03 * noise1(t * 0.35 + 3) * (1 - quad) + p.stun * 0.09 * noise1(t * 0.6);
    const back = lerp(0.03, 0.4, quad) - aw * A.strike * 0.45 + aw * A.wind * 0.12 - p.lean * 0.05;
    const pelvisPos = this._pelvisPos.copy(BP).addScaledVector(R, sway).addScaledVector(F, -back);
    pelvisPos.y = BP.y + hipH - D.hipY;
    const pitch = lerp(0.1 + p.lean * 0.55, 1.36, quad) + gal * 0.14 * Math.sin(ph) + aw * (-0.32 * A.wind + 0.45 * A.strike)
      + p.stun * 0.25 + p.despawn * 0.7 + tw.pelvis.x;
    const roll = walk * 0.06 * Math.sin(ph) + p.stun * 0.14 * noise1(t * 0.5 + 9) + tw.pelvis.z;
    const twist = walk * 0.13 * Math.sin(ph) + gal * 0.08 * Math.sin(ph);
    const qP = this._qPelvis.copy(qYaw);
    rotY(qP, twist); rotX(qP, -pitch); rotZ(qP, roll);
    this._setBone(id.pelvis, pelvisPos, qP);

    // ---------------- spine
    const W5 = [0.06, 0.12, 0.2, 0.28, 0.34];
    const bendTot = lerp(p.hunch, -0.32, quad) + this.hunchExtra * (1 - 0.5 * quad)
      + aw * (-0.5 * A.wind + 0.7 * A.strike) + p.stun * 0.3 + p.despawn * 0.6;
    const pos = _a.copy(pelvisPos).addScaledVector(_b.set(0, D.pelvis, 0).applyQuaternion(qP), 1);
    const q = _qa.copy(qP);
    for (let i = 0; i < 5; i++) {
      const bend = bendTot * W5[i] + gal * 0.11 * Math.sin(ph - i * 0.8) + p.und * 0.05 * Math.sin(t * 1.7 - i * 1.1)
        + tw.spine.x * 0.22 + 0.012 * Math.sin(t * 1.3 + i);
      const lat = walk * 0.05 * Math.sin(ph + i * 0.5) + p.und * 0.07 * Math.sin(t * 1.25 - i * 1.15 + 1) + gal * 0.03 * Math.sin(ph - i)
        + tw.spine.z * 0.2;
      const twi = -twist * 0.35 + tw.spine.y * 0.2;
      rotX(q, -bend); rotZ(q, lat); rotY(q, twi);
      this._setBone(id['sp' + i], pos, q);
      pos.addScaledVector(_b.set(0, D.spine, 0).applyQuaternion(q), 1);
    }
    const qChest = this._qChest.copy(q);
    const sp4 = id.sp4;
    const chestTop = _f.copy(pos);

    // ---------------- head aim + neck
    const hd = this.head;
    const hy = hd.yaw + hd.trem.y + tw.head.y;
    const hpch = hd.pitch + hd.trem.x + tw.head.x + aw * (0.5 * A.wind - 0.25 * A.strike) - 0.75 * quad;
    const hr = hd.roll + hd.trem.z + tw.head.z;
    const qH = this._qHead.copy(qYaw);
    rotY(qH, hy); rotX(qH, hpch); rotZ(qH, hr);
    const fwdNeck = p.headFwd * (1 - 0.4 * quad) + 0.5 * quad;
    _qb.copy(qChest).slerp(qH, 0.33);
    rotX(_qb, -fwdNeck * 0.55);
    this._setBone(id.neck0, chestTop, _qb);
    const n1 = _c.copy(chestTop).addScaledVector(_d.set(0, D.neck, 0).applyQuaternion(_qb), 1);
    _qb.copy(qChest).slerp(qH, 0.7);
    rotX(_qb, -fwdNeck * 0.25);
    this._setBone(id.neck1, n1, _qb);
    const headBase = n1.addScaledVector(_d.set(0, D.neck, 0).applyQuaternion(_qb), 1);
    this._setBone(id.head, headBase, qH);
    this.headPos.copy(_d.set(0, 0.13, -0.02).applyQuaternion(qH)).add(headBase);
    this.headTop.copy(_d.set(0, 0.29, 0.03).applyQuaternion(qH)).add(headBase);
    // tendrils
    const spread = aw * (A.wind * 0.9 + A.strike * 0.5) + 0.25 * I * Math.max(0, noise1(t * 0.8));
    for (let n = 0; n < this.tenIds.length; n++) {
      const [ia, ib] = this.tenIds[n];
      const d = this.def[ia];
      _qb.copy(qH).multiply(d.rel);
      rotX(_qb, 0.35 * noise1(t * 1.3 + n * 7) + 0.12 * I * noise1(t * 9 + n) - spread * 0.3);
      rotZ(_qb, 0.3 * noise1(t * 1.1 + n * 13) + spread * (TENDRILS[n].rz > 0 ? 0.7 : -0.7));
      const ta = _d.copy(d.at).applyQuaternion(qH).add(headBase);
      this._setBone(ia, ta, _qb);
      const tb = ta.addScaledVector(_e.set(0, D.tenA, 0).applyQuaternion(_qb), 1);
      rotX(_qb, 0.5 * noise1(t * 1.7 + n * 3) + 0.2);
      rotZ(_qb, 0.4 * noise1(t * 1.5 + n * 5));
      this._setBone(ib, tb, _qb);
    }

    // ---------------- arms
    const plantBlend = sstep(0.35, 0.85, quad);
    const ceilHand = this.ceilY - 0.12;
    for (let k = 0; k < 2; k++) {
      const o = this.sides[k], s = o.s, L = this.limbs[2 + k];
      // clavicle from the upper spine to the shoulder joint
      const clavStart = _a.set(s * 0.03, 0.15, 0).applyQuaternion(qChest).add(this.bPos[sp4]);
      const shrug = 0.04 * quad + aw * 0.07 * A.wind + tw.sh[k].y + p.stalk * 0.03;
      const shoulder = _b.set(s * 0.2, 0.13 + shrug, 0.02 - 0.05 * quad - 0.04 * p.stalk + tw.sh[k].z)
        .applyQuaternion(qChest).add(this.bPos[sp4]);
      this.shoulder[k].copy(shoulder);
      _c.subVectors(shoulder, clavStart);
      const clen = _c.length();
      quatYFront(_c, _d.set(0, 0, -1).applyQuaternion(qChest), _qb);
      this._setBone(o.clav, clavStart, _qb, clen / D.clav);
      // hand target
      const ht = _c.lerpVectors(this.arms[k].pos, _d.copy(L.cur).addScaledVector(UP, 0.07), plantBlend);
      ht.add(tw.hand[k]);
      if (aw > 0.001) {
        _e.copy(shoulder).addScaledVector(UP, 0.55).addScaledVector(R, s * 0.55).addScaledVector(F, -0.22);
        ht.lerp(_e, aw * A.wind);
        if (this.lookTarget) {
          _e.subVectors(this.lookTarget, shoulder);
          const dl = _e.length();
          if (dl > 2.1) _e.multiplyScalar(2.1 / dl);
          _e.add(shoulder).addScaledVector(R, s * 0.16);
        } else {
          _e.copy(shoulder).addScaledVector(F, 1.7).addScaledVector(UP, -0.35).addScaledVector(R, s * 0.1);
        }
        ht.lerp(_e, aw * A.strike);
      }
      if (tw.reach[k] > 0.01 && this.lookTarget) {
        _e.subVectors(this.lookTarget, shoulder).clampLength(0, 2.0).add(shoulder);
        ht.lerp(_e, sstep(0, 0.5, tw.reach[k]));
      }
      if (ht.y > ceilHand) ht.y = ceilHand;
      const minY = this.floorY + 0.05;
      if (ht.y < minY) ht.y = minY;
      // elbow pole: backward (biped), up+out spider elbows (quad), out (attack)
      const pole = _e.copy(F).multiplyScalar(-1 + 0.7 * quad).addScaledVector(R, s * (0.55 + 0.6 * quad)).addScaledVector(UP, 0.85 * quad);
      pole.addScaledVector(R, s * aw).addScaledVector(UP, -0.4 * aw);
      const maxSt = 1.1 + 0.25 * aw * A.strike + 0.22 * tw.reach[k];
      const elbow = _d, wrist = _g;
      const st = ik2(shoulder, ht, D.uarm, D.farm, pole, maxSt, elbow, wrist, _f);
      const bend = _f;
      quatYFront(_c.subVectors(elbow, shoulder), bend, _qb);
      this._setBone(o.uarm, shoulder, _qb, st);
      quatYFront(_c.subVectors(wrist, elbow), bend, _qb);
      this._setBone(o.farm, elbow, _qb, st);
      // hand orientation (splays flat on the floor when planted or hanging low)
      const fb = Math.max(plantBlend, sstep(this.floorY + 0.42, this.floorY + 0.1, wrist.y) * (1 - aw));
      const fdir = _c.subVectors(wrist, elbow).normalize();
      const hY = _a.copy(fdir).addScaledVector(F, 0.15 * (1 - fb)).normalize();
      _e.copy(F).multiplyScalar(0.85).addScaledVector(R, s * 0.35).addScaledVector(UP, -0.3).normalize();
      hY.lerp(_e, fb).normalize();
      const palm = _b.copy(R).multiplyScalar(-s).addScaledVector(F, 0.3).lerp(_e.set(0, -1, 0), fb);
      palm.addScaledVector(F, aw * A.strike * 1.5);
      quatYFront(hY, palm, _qb);
      this._setBone(o.hand, wrist, _qb);
      // fingers
      const qHand = _qd.copy(_qb);
      let c0 = 0.38, c1 = 0.5, spr = 1;
      c0 = lerp(c0, 0.6, p.stalk); c1 = lerp(c1, 0.75, p.stalk); spr = lerp(spr, 1.3, p.stalk);
      c0 = lerp(c0, 0.7, p.stun); c1 = lerp(c1, 0.85, p.stun);
      c0 = lerp(c0, 0.12, fb); c1 = lerp(c1, 0.3, fb); spr = lerp(spr, 1.4, fb);
      c0 = lerp(c0, -0.3, aw * A.wind); c1 = lerp(c1, -0.12, aw * A.wind); spr = lerp(spr, 2.0, aw * A.wind);
      c0 = lerp(c0, 0.55, aw * A.strike); c1 = lerp(c1, 0.95, aw * A.strike);
      for (let f = 0; f < 4; f++) {
        const [fa, fb] = o.fing[f];
        const nz = (0.12 + 0.15 * I) * noise1(t * (1.5 + I * 2) + f * 7 + k * 13);
        const cc0 = c0 + nz + tw.fing[k][f], cc1 = c1 + nz * 1.3 + tw.fing[k][f] * 0.6;
        const base = _d.set(FINGER_X[f], D.hand, 0).applyQuaternion(qHand).add(wrist);
        const qf = _qa.copy(qHand);
        rotZ(qf, -FINGER_X[f] * 9 * spr);
        rotX(qf, -cc0);
        this._setBone(fa, base, qf);
        base.addScaledVector(_e.set(0, D.f1, 0).applyQuaternion(qf), 1);
        rotX(qf, -cc1);
        this._setBone(fb, base, qf);
      }
    }

    // ---------------- legs
    for (let k = 0; k < 2; k++) {
      const o = this.sides[k], s = o.s, L = this.limbs[k];
      const hip = _a.set(s * D.hipX, D.hipY, 0).applyQuaternion(qP).add(pelvisPos);
      const fy = L.yaw;
      const fdir = _b.set(-Math.sin(fy), 0, -Math.cos(fy));
      const pc = L.pitch;
      const ankleT = _c.copy(L.cur).addScaledVector(fdir, -D.foot * Math.cos(pc)).addScaledVector(UP, D.foot * Math.sin(pc));
      const pole = _d.copy(F).addScaledVector(R, s * (0.25 + 0.75 * quad)).addScaledVector(UP, 0.15 * quad + 0.1 * p.despawn);
      const knee = _e, ankle = _g;
      const st = ik2(hip, ankleT, D.thigh, D.shin, pole, 1.07, knee, ankle, _f);
      quatYFront(_d.subVectors(knee, hip), _f, _qb);
      this._setBone(o.thigh, hip, _qb, st);
      quatYFront(_d.subVectors(ankle, knee), _f, _qb);
      this._setBone(o.shin, knee, _qb, st);
      // foot from ankle to ball (shifted if the IK could not reach)
      const ball = _d.copy(L.cur).add(_c.subVectors(ankle, ankleT));
      quatYFront(_c.subVectors(ball, ankle), UP, _qb);
      this._setBone(o.foot, ankle, _qb);
      const tp = L.swinging ? 0.5 + 0.4 * Math.sin(Math.PI * Math.min(1, L.t)) : 0.12;
      _c.copy(fdir).multiplyScalar(Math.cos(tp)).addScaledVector(UP, -Math.sin(tp));
      quatYFront(_c, UP, _qb);
      this._setBone(o.toe, ball, _qb);
    }
    {
      const dx = BP.x - this._rootPos.x, dz = BP.z - this._rootPos.z, ry = this._rootYaw, c = Math.cos(ry), sn = Math.sin(ry);
      this.uniforms.uMeltC.value.set(dx * c - dz * sn, dx * sn + dz * c);
    }
  }

  _finitePose() {
    for (let i = 0; i < this.bPos.length; i++) {
      const v = this.bPos[i], q = this.bQ[i];
      if (!Number.isFinite(v.x + v.y + v.z + q.x + q.y + q.z + q.w + this.bS[i])) return false;
    }
    return true;
  }

  _writeBones() {
    for (let i = 0; i < this.bones.length; i++) {
      _scl.set(1, this.bS[i], 1);
      this.bones[i].matrixWorld.compose(this.bPos[i], this.bQ[i], _scl);
    }
  }

  _updateDrips(dt) {
    const rate = (2.2 + this.speed * 0.4 + this.p.attack * 5 + this.p.stun * 2) * (1 - this._dissolve);
    this.drips.update(dt, this, rate, this._dissolve < 0.4);
  }
}

export default BacteriaBody;
