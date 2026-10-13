// Procedural ambient critters for R.O.O.M.: rats, cockroaches and aquarium fish.
// Each builder returns { root, update(dt, params), dispose() }.
//   root: THREE.Group. Rats/roaches: origin on the floor under the body. Fish: origin at the
//         body center. All face -Z, Y up, meters.
// Every critter is one SkinnedMesh (1-2 draw calls) with a small hierarchical skeleton;
// geometry + materials are cached per kind and shared between instances.
import * as THREE from 'three';
import { labelTexture } from '../gfx/textures.js';
import { RNG } from '../core/rng.js';

const TAU = Math.PI * 2;
const V3 = THREE.Vector3;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const dk = (rate, dt) => 1 - Math.exp(-rate * dt);
function hashN(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return s - Math.floor(s); }
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
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(h3(xi, yi, zi), h3(xi + 1, yi, zi), u), L(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), u), v),
    L(L(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), u), L(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), u), v), w) * 2 - 1;
}
function toLinear(c) {
  c = clamp(c, 0, 1);
  return c < 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
// piecewise-smooth interpolation of [[u, value], ...]
function curve(keys) {
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
// Geometry helpers
// ---------------------------------------------------------------------------
// Lathe along Z with elliptical sections. prof(u) -> { z, y, x?, rx, ry, flat? } (u: 0..1)
function latheGeo(prof, radial, segs) {
  const pos = [], uv = [], idx = [];
  for (let k = 0; k <= segs; k++) {
    const u = k / segs, p = prof(u);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      let c = Math.cos(a), s = Math.sin(a);
      // flatter belly when requested
      const ry = s < 0 && p.flat ? p.ry * (1 - p.flat * (-s)) : p.ry;
      pos.push((p.x || 0) + c * p.rx, p.y + s * ry, p.z);
      uv.push(j / radial, u);
    }
  }
  const row = radial + 1;
  const flip = prof(1).z > prof(0).z; // keep outward winding whichever way the lathe runs
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
// average normals across the duplicated u-seam of a lathe / tube
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
// Tube along curve(t, out) with radius(t). Closed (pointy) tip when radius(1)=0.
function tubeGeo(curveFn, radius, radial, segs) {
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
      uv.push(j / radial, k / segs);
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
function ellipsoidGeo(c, rx, ry, rz, ws = 10, hs = 8, rot = null) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  g.scale(rx, ry, rz);
  if (rot) g.applyQuaternion(rot);
  g.translate(c.x, c.y, c.z);
  g.computeVertexNormals();
  return g;
}
// Flat fin from a 2D outline; map(a, b) -> V3 places outline coords in 3D.
function finGeo(outline, map, curveDiv = 1) {
  const shape = new THREE.Shape(outline.map(([a, b]) => new THREE.Vector2(a, b)));
  const g = new THREE.ShapeGeometry(shape, curveDiv);
  const p = g.attributes.position;
  const v = new V3();
  for (let i = 0; i < p.count; i++) {
    map(p.getX(i), p.getY(i), v);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// Collects parts per material slot with vertex colors and skin weights.
class CritterGeo {
  constructor(slots) { this.slots = Array.from({ length: slots }, () => ({ pos: [], nrm: [], col: [], uv: [], si: [], sw: [], idx: [] })); }
  add(geom, slot, colorFn, weightFn) {
    const S = this.slots[slot];
    const g = geom.index ? geom : geom;
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    const base = S.pos.length / 3;
    const p = new V3(), n = new V3();
    for (let i = 0; i < P.count; i++) {
      p.set(P.getX(i), P.getY(i), P.getZ(i));
      n.set(N.getX(i), N.getY(i), N.getZ(i));
      const u = U ? U.getX(i) : 0, v = U ? U.getY(i) : 0;
      S.pos.push(p.x, p.y, p.z);
      S.nrm.push(n.x, n.y, n.z);
      S.uv.push(u, v);
      const c = typeof colorFn === 'function' ? colorFn(p, n, u, v) : colorFn;
      S.col.push(toLinear(c[0]), toLinear(c[1]), toLinear(c[2])); // colors are authored in sRGB
      let w = typeof weightFn === 'function' ? weightFn(p, u, v) : weightFn;
      if (typeof w === 'number') w = [[w, 1]];
      w = w.filter((e) => e[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
      let tot = 0;
      for (const e of w) tot += e[1];
      for (let k = 0; k < 4; k++) { S.si.push(w[k] ? w[k][0] : 0); S.sw.push(w[k] ? w[k][1] / tot : 0); }
    }
    if (g.index) { const I = g.index.array; for (let i = 0; i < I.length; i++) S.idx.push(base + I[i]); }
    else for (let i = 0; i < P.count; i++) S.idx.push(base + i);
    geom.dispose();
  }
  build() {
    const all = { pos: [], nrm: [], col: [], uv: [], si: [], sw: [], idx: [] };
    const g = new THREE.BufferGeometry();
    let start = 0;
    this.slots.forEach((S, m) => {
      const base = all.pos.length / 3;
      for (const k of ['pos', 'nrm', 'col', 'uv', 'si', 'sw']) for (const x of S[k]) all[k].push(x);
      for (const i of S.idx) all.idx.push(base + i);
      g.addGroup(start, S.idx.length, m);
      start += S.idx.length;
    });
    g.setAttribute('position', new THREE.Float32BufferAttribute(all.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(all.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(all.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(all.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(all.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(all.sw, 4));
    g.setIndex(all.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// Bone layout spec: [{ name, parent, pos:[x,y,z] (bind, root space) }]
function makeBones(spec) {
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

function makeSkinned(geo, materials, spec, radius) {
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

const _cache = new Map();
function cached(key, fn) {
  if (!_cache.has(key)) _cache.set(key, fn());
  return _cache.get(key);
}

// ---------------------------------------------------------------------------
// Rat
// ---------------------------------------------------------------------------
const RAT_BONES = [
  { name: 'body', parent: null, pos: [0, 0.045, 0.0] },
  { name: 'hips', parent: 'body', pos: [0, 0.045, 0.04] },
  { name: 'chest', parent: 'body', pos: [0, 0.045, -0.03] },
  { name: 'head', parent: 'chest', pos: [0, 0.046, -0.066] },
  { name: 'snout', parent: 'head', pos: [0, 0.036, -0.105] },
  { name: 'legFL', parent: 'chest', pos: [-0.019, 0.03, -0.044] },
  { name: 'legFR', parent: 'chest', pos: [0.019, 0.03, -0.044] },
  { name: 'legHL', parent: 'hips', pos: [-0.025, 0.034, 0.046] },
  { name: 'legHR', parent: 'hips', pos: [0.025, 0.034, 0.046] },
  { name: 'tail0', parent: 'hips', pos: [0, 0.04, 0.086] },
];
const RAT_TAIL_N = 7;
for (let i = 1; i <= RAT_TAIL_N; i++) {
  const u = i / RAT_TAIL_N;
  RAT_BONES.push({ name: 'tail' + i, parent: 'tail' + (i - 1), pos: [0, ratTailY(u), 0.086 + u * 0.21] });
}
function ratTailY(u) { return 0.04 - 0.032 * Math.sin(Math.min(1, u * 1.6) * Math.PI / 2) + 0.004 * u; }

function furTexture() {
  return cached('furTex', () => {
    const t = labelTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, w, h);
      const rng = new RNG(4242);
      for (let i = 0; i < 9000; i++) {
        const x = rng.next() * w, y = rng.next() * h, l = 4 + rng.next() * 9;
        const v = Math.floor(70 + rng.next() * 140);
        ctx.strokeStyle = `rgb(${v},${v},${v})`;
        ctx.lineWidth = 0.6 + rng.next() * 0.8;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rng.next() - 0.5) * 2.5, y + l);
        ctx.stroke();
      }
    }, false);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 5);
    return t;
  });
}

function ratGeometry() {
  return cached('ratGeo', () => {
    const { index: bi } = makeBones(RAT_BONES);
    const G = new CritterGeo(2);
    const FUR = [0.34, 0.29, 0.25], BELLY = [0.6, 0.55, 0.49], PINK = [0.86, 0.56, 0.56], PINK_D = [0.7, 0.45, 0.45];
    const ry = curve([[0, 0.0], [0.04, 0.02], [0.2, 0.035], [0.36, 0.038], [0.55, 0.032], [0.68, 0.022], [0.77, 0.024], [0.9, 0.014], [0.98, 0.0055], [1, 0]]);
    const rx = curve([[0, 0.0], [0.04, 0.021], [0.2, 0.036], [0.36, 0.041], [0.55, 0.033], [0.68, 0.023], [0.77, 0.026], [0.9, 0.015], [0.98, 0.006], [1, 0]]);
    const cy = curve([[0, 0.046], [0.3, 0.047], [0.6, 0.045], [0.8, 0.043], [1, 0.032]]);
    const body = latheGeo((u) => ({ z: lerp(0.088, -0.128, u), y: cy(u), rx: rx(u), ry: ry(u), flat: 0.35 }), 18, 30);
    const wBody = (p) => {
      const wHead = sstep(-0.05, -0.075, p.z), wSnout = sstep(-0.095, -0.11, p.z);
      const wHips = sstep(-0.005, 0.04, p.z), wTail = sstep(0.075, 0.095, p.z);
      const out = [[bi('head'), wHead * (1 - wSnout)], [bi('snout'), wSnout], [bi('hips'), wHips * (1 - wTail)], [bi('tail0'), wTail]];
      out.push([bi('chest'), Math.max(0, 1 - wHead - wHips)]);
      return out;
    };
    G.add(body, 0, (p, n) => {
      const top = clamp(n.y * 0.5 + 0.5, 0, 1);
      const nz = noise3(p.x * 180, p.y * 180, p.z * 180) * 0.06;
      const c = [lerp(BELLY[0], FUR[0], sstep(0.25, 0.6, top)) + nz, lerp(BELLY[1], FUR[1], sstep(0.25, 0.6, top)) + nz, lerp(BELLY[2], FUR[2], sstep(0.25, 0.6, top)) + nz];
      const nose = sstep(-0.12, -0.126, p.z);
      return [lerp(c[0], PINK[0], nose), lerp(c[1], PINK[1], nose), lerp(c[2], PINK[2], nose)];
    }, wBody);
    // ears
    for (const s of [-1, 1]) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.25, s * 0.5, s * 0.35));
      G.add(ellipsoidGeo(new V3(s * 0.016, 0.066, -0.07), 0.0115, 0.012, 0.0028, 10, 8, q), 0, (p, n) => (n.z < -0.2 ? PINK : PINK_D), bi('head'));
    }
    // eyes (glossy slot)
    for (const s of [-1, 1]) G.add(ellipsoidGeo(new V3(s * 0.0152, 0.052, -0.097), 0.0043, 0.0043, 0.0043, 10, 8), 1, [0.01, 0.01, 0.012], bi('head'));
    // whiskers
    const rng = new RNG(77);
    for (const s of [-1, 1]) {
      for (let k = 0; k < 5; k++) {
        const o = new V3(s * 0.006, 0.033 + k * 0.0015, -0.121 + k * 0.002);
        const d = new V3(s * rng.range(0.7, 1.0), rng.range(-0.25, 0.25), rng.range(-0.2, 0.4)).normalize();
        const len = rng.range(0.028, 0.045);
        G.add(tubeGeo((t, out) => out.copy(o).addScaledVector(d, t * len).add(new V3(0, -0.006 * t * t, 0.006 * t * t)), (t) => 0.00045 * (1 - t * 0.8), 3, 4), 0, [0.82, 0.8, 0.76], bi('snout'));
      }
    }
    // legs
    const leg = (name, x, y, z, hind) => {
      const b = bi(name);
      const knee = new V3(x * 1.05, y * 0.45, z + (hind ? 0.012 : -0.004));
      const top = new V3(x, y, z);
      G.add(tubeGeo((t, out) => out.lerpVectors(top, knee, t), (t) => lerp(hind ? 0.011 : 0.008, 0.005, t), 8, 3), 0, FUR, b);
      const ankle = new V3(x * 1.08, 0.006, z + (hind ? 0.004 : -0.006));
      G.add(tubeGeo((t, out) => out.lerpVectors(knee, ankle, t), (t) => lerp(0.0045, 0.0032, t), 6, 3), 0, PINK_D, b);
      G.add(ellipsoidGeo(new V3(ankle.x, 0.0035, ankle.z - (hind ? 0.008 : 0.004)), 0.0045, 0.0028, hind ? 0.012 : 0.007, 8, 6), 0, PINK, b);
    };
    leg('legFL', -0.019, 0.03, -0.044, false); leg('legFR', 0.019, 0.03, -0.044, false);
    leg('legHL', -0.025, 0.034, 0.046, true); leg('legHR', 0.025, 0.034, 0.046, true);
    // tail (scaly rings)
    const tail = tubeGeo((t, out) => out.set(0, ratTailY(t), 0.08 + t * 0.215), (t) => lerp(0.0058, 0.0012, t), 8, 28);
    G.add(tail, 0, (p, n, u, v) => {
      const ring = 0.92 + 0.08 * Math.sin(v * 160);
      return [PINK_D[0] * ring * 0.95, PINK_D[1] * ring * 0.92, PINK_D[2] * ring * 0.92];
    }, (p) => {
      const u = clamp((p.z - 0.086) / 0.21, 0, 1) * RAT_TAIL_N;
      const i = Math.min(RAT_TAIL_N - 1, Math.floor(u)), f = u - i;
      if (p.z < 0.086) return [[bi('hips'), 1 - sstep(0.075, 0.086, p.z)], [bi('tail0'), sstep(0.075, 0.086, p.z)]];
      return [[bi('tail' + i), 1 - f], [bi('tail' + (i + 1)), f]];
    });
    return G.build();
  });
}

function ratMaterials(variant) {
  return cached('ratMat' + variant, () => {
    const tint = [new THREE.Color(1, 1, 1), new THREE.Color(0.82, 0.78, 0.74), new THREE.Color(1.1, 1.0, 0.92)][variant];
    const fur = new THREE.MeshPhysicalMaterial({
      vertexColors: true, color: tint, roughness: 0.85, metalness: 0,
      sheen: 1.0, sheenColor: new THREE.Color(0.16, 0.14, 0.12), sheenRoughness: 0.5,
      bumpMap: furTexture(), bumpScale: 2.0,
    });
    fur.name = 'rat_fur';
    const eye = new THREE.MeshPhysicalMaterial({ vertexColors: true, color: 0xffffff, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02 });
    eye.name = 'rat_eye';
    return [fur, eye];
  });
}

export function buildRat(seed = 1) {
  const rng = new RNG((seed * 9781 + 7) >>> 0 || 1);
  const root = new THREE.Group();
  root.name = 'Rat';
  const { mesh, B } = makeSkinned(ratGeometry(), ratMaterials(((seed % 3) + 3) % 3), RAT_BONES, 0.05);
  root.add(mesh);
  const sc = rng.range(0.88, 1.12);
  mesh.scale.setScalar(sc);
  const st = { t: rng.range(0, 100), phase: 0, run: 0, turn: 0, look: 0, lookT: 0, lookTarget: 0, sniff: 0, sniffT: 0, rear: 0, rearT: rng.range(2, 6) };
  const tails = [];
  for (let i = 0; i <= RAT_TAIL_N; i++) tails.push(B['tail' + i]);
  const legs = [B.legFL, B.legFR, B.legHL, B.legHR];

  function update(dt, p = {}) {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    const speed = clamp(Number.isFinite(p.speed) ? p.speed : 0, 0, 4);
    const turning = clamp(Number.isFinite(p.turning) ? p.turning : 0, -3, 3);
    st.t += dt;
    const t = st.t;
    st.run += (sstep(0.03, 0.25, speed) - st.run) * dk(10, dt);
    st.turn += (turning - st.turn) * dk(8, dt);
    const run = st.run;
    const freq = speed > 0.02 ? clamp(speed / (0.11 * sc), 1.5, 14) : 0;
    st.phase += freq * dt * TAU;
    const ph = st.phase;
    // idle behaviours: look around, sniff bursts, occasional rearing
    st.lookT -= dt;
    if (st.lookT <= 0) { st.lookTarget = rng.range(-0.7, 0.7) * (1 - run); st.lookT = rng.range(0.4, 2.0); }
    st.look += (st.lookTarget - st.look) * dk(12, dt);
    st.sniffT -= dt;
    if (st.sniffT <= 0) { st.sniff = st.sniff > 0.5 ? 0 : 1; st.sniffT = st.sniff ? rng.range(0.4, 1.4) : rng.range(0.3, 1.8); }
    st.rearT -= dt;
    if (st.rearT <= 0) { st.rear = st.rear > 0.5 || run > 0.3 ? 0 : 1; st.rearT = st.rear ? rng.range(0.8, 1.6) : rng.range(3, 8); }
    const rearAmt = run > 0.3 ? 0 : st.rear;
    const rearS = (B.body.userData.rearS = lerp(B.body.userData.rearS ?? 0, rearAmt, dk(6, dt)));
    // body bound + flex
    const s1 = Math.sin(ph), c2 = Math.cos(ph * 2);
    B.body.position.copy(B.body.userData.rest);
    B.body.position.y += run * 0.006 * (1 - c2) * 0.5 + rearS * 0.012;
    B.body.rotation.set(-run * 0.05 * s1 - rearS * 0.35, 0, -st.turn * 0.12 * run);
    B.chest.rotation.set(run * 0.22 * s1 - rearS * 0.25, st.turn * 0.3, 0);
    B.hips.rotation.set(-run * 0.2 * s1 + rearS * 0.35, -st.turn * 0.18, 0);
    const sniffOsc = st.sniff * (1 - run) * Math.sin(t * 48) * 0.05;
    B.head.rotation.set(-0.05 + sniffOsc + run * 0.08 * Math.sin(ph + 1) - rearS * 0.25, st.look + st.turn * 0.3, st.look * 0.2);
    B.snout.rotation.set(st.sniff * Math.sin(t * 52) * 0.08, Math.sin(t * 37) * 0.03 * st.sniff, 0);
    // legs: half-bound (front pair slightly offset, hind pair opposite)
    const amp = 0.85 * run;
    const offs = [0, 0.35, Math.PI, Math.PI + 0.3];
    for (let i = 0; i < 4; i++) {
      const a = ph + offs[i];
      const L = legs[i];
      L.position.copy(L.userData.rest);
      L.position.y += Math.max(0, Math.cos(a)) * 0.006 * run;
      L.rotation.set(Math.sin(a) * amp * (i < 2 ? 1 : 1.1) + (i >= 2 ? rearS * -0.35 : rearS * 0.6), 0, 0);
    }
    // tail wave
    const tAmp = 0.12 + 0.22 * run + 0.06 * (1 - run) * (noise1(t * 0.4) * 0.5 + 0.5);
    const tFreq = lerp(2.2, 9, run);
    for (let i = 1; i < tails.length; i++) {
      const k = i / tails.length;
      tails[i].rotation.set(0.04 * Math.sin(t * 1.3 + i) + (i === 1 ? 0.06 * run : 0), tAmp * Math.sin(t * tFreq - i * 0.75) * (0.35 + k) - st.turn * 0.12, 0);
    }
    tails[0].rotation.set(-0.03 * run, -st.turn * 0.2, 0);
  }
  update(0, {});
  return {
    root, mesh, update,
    dispose() { root.removeFromParent(); mesh.skeleton.dispose(); },
  };
}

// ---------------------------------------------------------------------------
// Cockroach (~5 cm)
// ---------------------------------------------------------------------------
const ROACH_LEGS = [
  // side, attach z, foot offset (x, z) relative to attach
  { s: -1, z: -0.011, fx: 0.016, fz: -0.012 },
  { s: 1, z: -0.011, fx: 0.016, fz: -0.012 },
  { s: -1, z: -0.003, fx: 0.022, fz: 0.0 },
  { s: 1, z: -0.003, fx: 0.022, fz: 0.0 },
  { s: -1, z: 0.005, fx: 0.022, fz: 0.022 },
  { s: 1, z: 0.005, fx: 0.022, fz: 0.022 },
];
const ROACH_BONES = [
  { name: 'body', parent: null, pos: [0, 0.007, 0] },
  { name: 'head', parent: 'body', pos: [0, 0.006, -0.022] },
  { name: 'antL0', parent: 'head', pos: [-0.0015, 0.0065, -0.027] },
  { name: 'antL1', parent: 'antL0', pos: [-0.012, 0.009, -0.045] },
  { name: 'antR0', parent: 'head', pos: [0.0015, 0.0065, -0.027] },
  { name: 'antR1', parent: 'antR0', pos: [0.012, 0.009, -0.045] },
  ...ROACH_LEGS.map((l, i) => ({ name: 'leg' + i, parent: 'body', pos: [l.s * 0.004, 0.005, l.z] })),
];

function roachGeometry() {
  return cached('roachGeo', () => {
    const { index: bi } = makeBones(ROACH_BONES);
    const G = new CritterGeo(1);
    const BROWN = [0.36, 0.16, 0.055], DARK = [0.16, 0.07, 0.03], TAN = [0.62, 0.42, 0.2];
    // abdomen + wings
    G.add(ellipsoidGeo(new V3(0, 0.0072, 0.006), 0.0108, 0.0052, 0.02, 16, 10), 0, (p, n) => {
      const seam = Math.abs(p.x) < 0.0006 && n.y > 0.3 ? 0.55 : 1;
      const edge = 1 - 0.35 * sstep(0.006, 0.0105, Math.abs(p.x));
      const rear = 1 - 0.3 * sstep(0.0, 0.025, p.z);
      const k = seam * edge * rear;
      return [BROWN[0] * k, BROWN[1] * k, BROWN[2] * k];
    }, bi('body'));
    // pronotum shield with pale rim
    G.add(ellipsoidGeo(new V3(0, 0.0085, -0.0155), 0.0102, 0.0036, 0.0078, 14, 8), 0, (p) => {
      const r = Math.hypot(p.x / 0.0102, (p.z + 0.0155) / 0.0078);
      const rim = sstep(0.65, 0.85, r);
      return [lerp(DARK[0] * 1.4, TAN[0], rim), lerp(DARK[1] * 1.4, TAN[1], rim), lerp(DARK[2] * 1.4, TAN[2], rim)];
    }, bi('body'));
    // head
    G.add(ellipsoidGeo(new V3(0, 0.0055, -0.0235), 0.0038, 0.0034, 0.0036, 10, 8), 0, DARK, bi('head'));
    for (const s of [-1, 1]) G.add(ellipsoidGeo(new V3(s * 0.0028, 0.0063, -0.0248), 0.0013, 0.0016, 0.0012, 6, 5), 0, [0.03, 0.02, 0.015], bi('head'));
    // cerci
    for (const s of [-1, 1]) {
      const o = new V3(s * 0.003, 0.006, 0.025);
      G.add(tubeGeo((t, out) => out.copy(o).add(new V3(s * 0.003 * t, -0.001 * t, 0.006 * t)), (t) => 0.0007 * (1 - t), 4, 3), 0, DARK, bi('body'));
    }
    // antennae (two bones each)
    for (const s of [-1, 1]) {
      const S = s < 0 ? 'L' : 'R';
      const a0 = new V3(s * 0.0015, 0.0065, -0.027), a1 = new V3(s * 0.012, 0.009, -0.045), a2 = new V3(s * 0.03, 0.007, -0.062);
      G.add(tubeGeo((t, out) => out.lerpVectors(a0, a1, t), (t) => lerp(0.0004, 0.0003, t), 4, 4), 0, DARK, (p) => [[bi('antL0'.replace('L', S)), 1]]);
      G.add(tubeGeo((t, out) => out.lerpVectors(a1, a2, t).add(new V3(0, 0.003 * Math.sin(t * Math.PI), 0)), (t) => 0.0003 * (1 - 0.7 * t), 4, 6), 0, DARK, bi('ant' + S + '1'));
    }
    // legs: coxa/femur up-out to a knee, tibia down to the ground, with tiny spines
    ROACH_LEGS.forEach((l, i) => {
      const b = bi('leg' + i);
      const a = new V3(l.s * 0.004, 0.005, l.z);
      const knee = new V3(l.s * (0.004 + l.fx * 0.5), 0.0095, l.z + l.fz * 0.45);
      const foot = new V3(l.s * (0.004 + l.fx), 0.0006, l.z + l.fz);
      G.add(tubeGeo((t, out) => out.lerpVectors(a, knee, t), (t) => lerp(0.0011, 0.0008, t), 5, 3), 0, BROWN, b);
      G.add(tubeGeo((t, out) => out.lerpVectors(knee, foot, t), (t) => lerp(0.0007, 0.0003, t), 5, 4), 0, DARK, b);
      for (let k = 1; k <= 2; k++) {
        const sp = new V3().lerpVectors(knee, foot, k / 3);
        const d = new V3(l.s * 0.7, 0.5, 0.3).normalize();
        G.add(tubeGeo((t, out) => out.copy(sp).addScaledVector(d, t * 0.0022), (t) => 0.00025 * (1 - t), 3, 2), 0, DARK, b);
      }
    });
    return G.build();
  });
}

function roachMaterial() {
  return cached('roachMat', () => {
    const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12 });
    m.name = 'roach';
    return m;
  });
}

export function buildCockroach(seed = 1) {
  const rng = new RNG((seed * 5113 + 3) >>> 0 || 1);
  const root = new THREE.Group();
  root.name = 'Cockroach';
  const { mesh, B } = makeSkinned(roachGeometry(), roachMaterial(), ROACH_BONES, 0.03);
  root.add(mesh);
  const sc = rng.range(0.85, 1.15);
  mesh.scale.setScalar(sc);
  const legs = ROACH_LEGS.map((_, i) => B['leg' + i]);
  const st = { t: rng.range(0, 50), phase: 0, run: 0, tw: [0, 0, 0, 0], twT: 0, legTw: new Float32Array(6) };

  function update(dt, p = {}) {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    const speed = clamp(Number.isFinite(p.speed) ? p.speed : 0, 0, 3);
    st.t += dt;
    const t = st.t;
    st.run += (sstep(0.005, 0.06, speed) - st.run) * dk(14, dt);
    const freq = speed > 0.003 ? clamp(speed / (0.028 * sc), 2, 16) : 0;
    st.phase += freq * dt * TAU;
    const run = st.run, ph = st.phase;
    // tripod gait: {L1, R2, L3} vs {R1, L2, R3}
    for (let i = 0; i < 6; i++) {
      const l = ROACH_LEGS[i];
      const tri = (i === 0 || i === 3 || i === 4) ? 0 : Math.PI;
      const a = ph + tri;
      st.legTw[i] *= Math.exp(-10 * dt);
      const L = legs[i];
      // swing fore/aft around Y, lift tip by rolling around Z
      L.rotation.set(0, l.s * Math.sin(a) * 0.42 * run + st.legTw[i], l.s * Math.max(0, Math.cos(a)) * 0.35 * run);
    }
    B.body.position.copy(B.body.userData.rest);
    B.body.position.y += run * 0.0006 * Math.abs(Math.sin(ph));
    B.body.rotation.set(0, run * 0.04 * Math.sin(ph), run * 0.05 * Math.sin(ph));
    // antennae: slow sweeping + nervous twitches
    st.twT -= dt;
    if (st.twT <= 0) {
      st.twT = rng.range(0.08, 0.6);
      const k = rng.int(0, 3);
      st.tw[k] += rng.range(-0.6, 0.6);
      if (run < 0.2 && rng.next() < 0.3) st.legTw[rng.int(0, 5)] += rng.range(-0.4, 0.4);
    }
    for (let k = 0; k < 4; k++) st.tw[k] *= Math.exp(-6 * dt);
    const sweep = (1 - run * 0.6);
    B.antL0.rotation.set(0.25 * noise1(t * 1.3) * sweep + st.tw[0] - run * 0.3, 0.3 * noise1(t * 0.9 + 4) * sweep + st.tw[1], 0);
    B.antR0.rotation.set(0.25 * noise1(t * 1.2 + 9) * sweep + st.tw[2] - run * 0.3, 0.3 * noise1(t * 1.0 + 7) * sweep + st.tw[3], 0);
    B.antL1.rotation.set(0.3 * noise1(t * 2.1 + 2), 0.25 * noise1(t * 1.7 + 3) - run * 0.3, 0);
    B.antR1.rotation.set(0.3 * noise1(t * 2.0 + 5), 0.25 * noise1(t * 1.6 + 8) + run * 0.3, 0);
    B.head.rotation.set(0.08 * noise1(t * 0.7), 0.1 * noise1(t * 0.5 + 1) * (1 - run), 0);
  }
  update(0, {});
  return {
    root, mesh, update,
    dispose() { root.removeFromParent(); mesh.skeleton.dispose(); },
  };
}

// ---------------------------------------------------------------------------
// Aquarium fish
// ---------------------------------------------------------------------------
// Each kind: body length L (head tip to tail base), profile keys (height ry / width rx as a
// fraction of L), colors and fin outlines (in units of L).
const FISH = {
  goldfish: {
    L: 0.07, ry: [[0, 0], [0.05, 0.12], [0.25, 0.26], [0.45, 0.28], [0.75, 0.16], [0.92, 0.07], [1, 0.06]],
    rx: [[0, 0], [0.05, 0.08], [0.3, 0.16], [0.5, 0.17], [0.8, 0.09], [1, 0.04]],
    irid: 0.35,
    color(u, v, side) { const belly = sstep(0.1, -0.6, v); return [lerp(1.0, 1.0, belly), lerp(0.42, 0.78, belly), lerp(0.05, 0.45, belly)]; },
    fin: [1.0, 0.5, 0.12], finAlpha: 0.75,
    tail: [[0, 0.03], [0.25, 0.3], [0.55, 0.42], [0.45, 0.12], [0.6, 0.0], [0.45, -0.12], [0.55, -0.42], [0.25, -0.3], [0, -0.03]],
    dorsal: [[0.25, 0.0], [0.33, 0.24], [0.5, 0.2], [0.7, 0.08], [0.75, 0.0]],
    anal: [[0.62, 0.0], [0.7, -0.14], [0.82, -0.12], [0.85, 0.0]],
    pect: 0.13, doubleTail: true,
  },
  neon: {
    L: 0.05, ry: [[0, 0], [0.06, 0.1], [0.3, 0.17], [0.55, 0.16], [0.85, 0.08], [1, 0.06]],
    rx: [[0, 0], [0.06, 0.07], [0.3, 0.1], [0.6, 0.08], [1, 0.035]],
    irid: 1.0,
    color(u, v, side) {
      const blue = sstep(0.3, 0.12, Math.abs(v - 0.28)) * sstep(0.12, 0.2, u) * sstep(0.95, 0.85, u);
      const red = sstep(-0.05, -0.2, v) * sstep(0.45, 0.55, u);
      const base = v > 0.45 ? [0.35, 0.36, 0.3] : [0.78, 0.8, 0.82];
      let c = [lerp(base[0], 0.05, blue), lerp(base[1], 0.75, blue), lerp(base[2], 1.0, blue)];
      c = [lerp(c[0], 0.95, red), lerp(c[1], 0.08, red), lerp(c[2], 0.1, red)];
      return c;
    },
    fin: [0.85, 0.88, 0.9], finAlpha: 0.35,
    tail: [[0, 0.03], [0.22, 0.17], [0.28, 0.16], [0.18, 0.0], [0.28, -0.16], [0.22, -0.17], [0, -0.03]],
    dorsal: [[0.42, 0.0], [0.48, 0.14], [0.56, 0.1], [0.58, 0.0]],
    anal: [[0.55, 0.0], [0.6, -0.1], [0.8, -0.06], [0.82, 0.0]],
    pect: 0.1,
  },
  angel: {
    L: 0.07, ry: [[0, 0], [0.05, 0.16], [0.25, 0.42], [0.45, 0.46], [0.7, 0.3], [0.9, 0.1], [1, 0.07]],
    rx: [[0, 0], [0.06, 0.06], [0.3, 0.09], [0.6, 0.08], [1, 0.03]],
    irid: 0.6,
    color(u, v, side) {
      const stripe = Math.max(sstep(0.04, 0.0, Math.abs(u - 0.2)), sstep(0.05, 0.0, Math.abs(u - 0.45)), sstep(0.04, 0.0, Math.abs(u - 0.72)));
      const silver = [0.82, 0.82, 0.78 + 0.05 * v];
      return [lerp(silver[0], 0.05, stripe), lerp(silver[1], 0.05, stripe), lerp(silver[2], 0.04, stripe)];
    },
    fin: [0.75, 0.75, 0.7], finAlpha: 0.55, finStripes: true,
    tail: [[0, 0.04], [0.12, 0.3], [0.45, 0.5], [0.3, 0.12], [0.32, 0.0], [0.3, -0.12], [0.45, -0.5], [0.12, -0.3], [0, -0.04]],
    dorsal: [[0.22, 0.0], [0.6, 0.85], [0.75, 0.62], [0.8, 0.2], [0.9, 0.0]],
    anal: [[0.3, 0.0], [0.62, -0.85], [0.76, -0.62], [0.82, -0.2], [0.9, 0.0]],
    pelvicLong: true, pect: 0.12,
  },
  clown: {
    L: 0.065, ry: [[0, 0], [0.06, 0.15], [0.3, 0.27], [0.55, 0.26], [0.85, 0.14], [1, 0.1]],
    rx: [[0, 0], [0.06, 0.1], [0.3, 0.15], [0.6, 0.13], [1, 0.05]],
    irid: 0.15,
    color(u, v, side) {
      const band = (c, w) => sstep(w, w * 0.6, Math.abs(u - c));
      const edge = (c, w) => sstep(w * 1.35, w * 1.1, Math.abs(u - c)) * (1 - band(c, w));
      const white = Math.max(band(0.24, 0.06), band(0.52, 0.07), band(0.92, 0.035));
      const black = Math.max(edge(0.24, 0.06), edge(0.52, 0.07), edge(0.92, 0.035));
      let c = [1.0, 0.4, 0.04];
      c = [lerp(c[0], 0.98, white), lerp(c[1], 0.97, white), lerp(c[2], 0.95, white)];
      return [lerp(c[0], 0.03, black), lerp(c[1], 0.02, black), lerp(c[2], 0.02, black)];
    },
    fin: [1.0, 0.45, 0.06], finAlpha: 0.85, finEdge: true,
    tail: [[0, 0.06], [0.2, 0.24], [0.32, 0.18], [0.34, 0.0], [0.32, -0.18], [0.2, -0.24], [0, -0.06]],
    dorsal: [[0.25, 0.0], [0.32, 0.17], [0.45, 0.14], [0.55, 0.1], [0.7, 0.2], [0.85, 0.1], [0.92, 0.0]],
    anal: [[0.62, 0.0], [0.7, -0.17], [0.85, -0.12], [0.9, 0.0]],
    pect: 0.16,
  },
  guppy: {
    L: 0.042, ry: [[0, 0], [0.06, 0.1], [0.3, 0.17], [0.6, 0.15], [0.9, 0.09], [1, 0.08]],
    rx: [[0, 0], [0.06, 0.08], [0.3, 0.11], [0.6, 0.09], [1, 0.04]],
    irid: 0.9,
    color(u, v, side) {
      const spot = sstep(0.55, 0.75, noise3(u * 14, v * 14, side * 3)) * sstep(0.4, 0.6, u);
      const base = [lerp(0.7, 0.55, sstep(-0.3, 0.5, v)), lerp(0.72, 0.58, sstep(-0.3, 0.5, v)), lerp(0.7, 0.45, sstep(-0.3, 0.5, v))];
      return [lerp(base[0], 0.15, spot), lerp(base[1], 0.55, spot), lerp(base[2], 0.95, spot)];
    },
    fin: [1, 1, 1], finAlpha: 0.85, finGradient: [[0.1, 0.35, 1.0], [1.0, 0.35, 0.08]],
    tail: [[0, 0.06], [0.45, 0.55], [0.85, 0.62], [1.0, 0.3], [1.02, 0.0], [1.0, -0.3], [0.85, -0.62], [0.45, -0.55], [0, -0.06]],
    dorsal: [[0.45, 0.0], [0.6, 0.32], [0.85, 0.3], [0.8, 0.0]],
    anal: [[0.62, 0.0], [0.7, -0.1], [0.8, -0.06], [0.82, 0.0]],
    pect: 0.1,
  },
};
const FISH_SEG = 4; // spine bones

function fishBones(L) {
  // body spans z in [-L/2 (head), +L/2 (tail base)]
  const out = [{ name: 'root', parent: null, pos: [0, 0, -0.2 * L] }];
  const zs = [0.02, 0.2, 0.36, 0.5];
  for (let i = 0; i < FISH_SEG; i++) out.push({ name: 's' + i, parent: i ? 's' + (i - 1) : 'root', pos: [0, 0, zs[i] * L] });
  out.push({ name: 'pectL', parent: 'root', pos: [-0.1 * L, -0.06 * L, -0.22 * L] });
  out.push({ name: 'pectR', parent: 'root', pos: [0.1 * L, -0.06 * L, -0.22 * L] });
  return out;
}

function fishGeometry(kind) {
  return cached('fishGeo_' + kind, () => {
    const K = FISH[kind], L = K.L;
    const spec = fishBones(L);
    const { index: bi } = makeBones(spec);
    const G = new CritterGeo(2);
    const ry = curve(K.ry), rx = curve(K.rx);
    const zOf = (u) => lerp(-L / 2, L / 2, u);
    // spine weights along z
    const spineZ = [-0.2 * L, 0.02 * L, 0.2 * L, 0.36 * L, 0.5 * L];
    const spineB = ['root', 's0', 's1', 's2', 's3'].map(bi);
    const wSpine = (p) => {
      const z = p.z;
      if (z <= spineZ[0]) return [[spineB[0], 1]];
      for (let i = 1; i < spineZ.length; i++) {
        if (z <= spineZ[i]) { const f = sstep(spineZ[i - 1], spineZ[i], z); return [[spineB[i - 1], 1 - f], [spineB[i], f]]; }
      }
      return [[spineB[spineB.length - 1], 1]];
    };
    const body = latheGeo((u) => ({ z: zOf(u), y: 0.02 * L * Math.sin(u * Math.PI) - (kind === 'angel' ? 0.02 * L : 0), rx: rx(u) * L, ry: ry(u) * L, flat: 0.1 }), 20, 26);
    G.add(body, 0, (p, n) => {
      const u = (p.z + L / 2) / L;
      const v = p.y / Math.max(1e-6, ry(u) * L);
      const c = K.color(u, v, Math.sign(p.x));
      // darker back, slight shading noise
      const k = 1 - 0.18 * sstep(0.3, 0.9, v) + 0.05 * noise3(p.x * 300, p.y * 300, p.z * 300);
      return [c[0] * k, c[1] * k, c[2] * k];
    }, wSpine);
    // eyes: dark pupil with metallic iris ring
    const eu = 0.12, eyeZ = zOf(eu), eyeY = 0.04 * L, eyeR = Math.max(0.0028, ry(eu + 0.05) * L * 0.42);
    for (const s of [-1, 1]) {
      const ex = s * rx(eu) * L * 0.85;
      const c = new V3(ex, eyeY, eyeZ);
      G.add(ellipsoidGeo(c, eyeR * 0.6, eyeR, eyeR, 12, 10), 1, (p) => {
        const d = Math.hypot(p.y - eyeY, p.z - eyeZ) / eyeR;
        return d < 0.55 ? [0.01, 0.01, 0.01] : kind === 'goldfish' || kind === 'clown' ? [0.9, 0.55, 0.15] : [0.78, 0.78, 0.8];
      }, bi('root'));
    }
    // fins (slot 1 is opaque glossy; fins are added to a separate geometry below)
    return { body: G, spec };
  });
}

function fishFinGeometry(kind) {
  return cached('fishFin_' + kind, () => {
    const K = FISH[kind], L = K.L;
    const spec = fishBones(L);
    const { index: bi } = makeBones(spec);
    const G = new CritterGeo(1);
    const ry = curve(K.ry);
    const zOf = (u) => lerp(-L / 2, L / 2, u);
    const spineZ = [-0.2 * L, 0.02 * L, 0.2 * L, 0.36 * L, 0.5 * L];
    const spineB = ['root', 's0', 's1', 's2', 's3'].map(bi);
    const wSpine = (p) => {
      const z = p.z;
      if (z <= spineZ[0]) return [[spineB[0], 1]];
      for (let i = 1; i < spineZ.length; i++) {
        if (z <= spineZ[i]) { const f = sstep(spineZ[i - 1], spineZ[i], z); return [[spineB[i - 1], 1 - f], [spineB[i], f]]; }
      }
      return [[spineB[spineB.length - 1], 1]];
    };
    const finCol = (p, along, across) => {
      let c = K.fin.slice();
      if (K.finGradient) {
        const g = clamp(along, 0, 1);
        c = [lerp(K.finGradient[0][0], K.finGradient[1][0], g), lerp(K.finGradient[0][1], K.finGradient[1][1], g), lerp(K.finGradient[0][2], K.finGradient[1][2], g)];
        const spot = sstep(0.6, 0.8, noise3(p.x * 900, p.y * 400, p.z * 400));
        c = [lerp(c[0], 0.05, spot * 0.7), lerp(c[1], 0.05, spot * 0.7), lerp(c[2], 0.1, spot * 0.7)];
      }
      if (K.finStripes) { const s = sstep(0.3, 0.6, Math.sin(along * 22)); c = [lerp(c[0], 0.1, s * 0.6), lerp(c[1], 0.1, s * 0.6), lerp(c[2], 0.1, s * 0.6)]; }
      if (K.finEdge) { const e = sstep(0.75, 0.95, across); c = [lerp(c[0], 0.03, e), lerp(c[1], 0.02, e), lerp(c[2], 0.02, e)]; }
      // fin rays
      const ray = 0.9 + 0.1 * Math.sin(across * 60 + along * 4);
      return [c[0] * ray, c[1] * ray, c[2] * ray];
    };
    const tailZ = L / 2 - 0.02 * L;
    // caudal fin (vertical plane), optionally double (goldfish)
    const tailSides = K.doubleTail ? [-1, 1] : [0];
    for (const s of tailSides) {
      const g = finGeo(K.tail, (a, b, out) => out.set(s * a * 0.25 * L, b * L, tailZ + a * L));
      const maxA = Math.max(...K.tail.map((e) => e[0]));
      G.add(g, 0, (p) => finCol(p, (p.z - tailZ) / (maxA * L), Math.abs(p.y) / (0.6 * L)), bi('s3'));
    }
    // dorsal & anal fins follow the body bend
    const dorsal = finGeo(K.dorsal, (a, b, out) => { const z = zOf(a); out.set(0, ry((z + L / 2) / L) * L * 0.92 + b * L, z); });
    G.add(dorsal, 0, (p) => finCol(p, (p.z + L / 2) / L, clamp(p.y / (0.5 * L), 0, 1)), wSpine);
    const anal = finGeo(K.anal, (a, b, out) => { const z = zOf(a); out.set(0, -ry((z + L / 2) / L) * L * 0.9 + b * L, z); });
    G.add(anal, 0, (p) => finCol(p, (p.z + L / 2) / L, clamp(-p.y / (0.5 * L), 0, 1)), wSpine);
    // pectoral fins (rounded paddles on the flanks)
    for (const s of [-1, 1]) {
      const S = s < 0 ? 'pectL' : 'pectR';
      const o = new V3(s * 0.1 * L, -0.06 * L, -0.22 * L);
      const pl = K.pect * L;
      const outline = [[0, 0.015], [0.45, 0.4], [0.9, 0.42], [1.0, 0.1], [0.8, -0.2], [0, -0.015]].map(([a, b]) => [a, b]);
      const g = finGeo(outline, (a, b, out) => out.set(o.x + s * a * pl * 0.55, o.y + b * pl * 0.5 - a * pl * 0.3, o.z + a * pl * 0.75));
      G.add(g, 0, (p) => finCol(p, 0.5, 0.3), bi(S));
    }
    // pelvic fins (long filaments on angelfish)
    for (const s of [-1, 1]) {
      const o = new V3(s * 0.03 * L, -ry(0.3) * L * 0.85, zOf(0.3));
      const len = K.pelvicLong ? 0.7 * L : 0.12 * L;
      const outline = [[0, 0.02], [0.4, 0.06], [1.0, 0.0], [0.4, -0.02], [0, -0.02]];
      const g = finGeo(outline, (a, b, out) => out.set(o.x + s * b * L * 0.3, o.y - a * len * 0.75, o.z + a * len * 0.6 + b * L * 0.3));
      G.add(g, 0, (p) => finCol(p, 0.6, 0.5), wSpine);
    }
    return G;
  });
}

function fishMaterials(kind) {
  return cached('fishMat_' + kind, () => {
    const K = FISH[kind];
    const body = new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.3, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.15,
      iridescence: K.irid, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 520], sheen: 0.3, sheenColor: new THREE.Color(0.8, 0.85, 1.0),
    });
    body.name = 'fish_' + kind;
    const eye = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.05, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03 });
    eye.name = 'fish_eye';
    const fin = new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.45, metalness: 0, transparent: true, opacity: K.finAlpha, side: THREE.DoubleSide, depthWrite: false,
      iridescence: K.irid * 0.5, iridescenceIOR: 1.3, iridescenceThicknessRange: [150, 400],
    });
    fin.name = 'fish_fin_' + kind;
    return { body: [body, eye], fin };
  });
}

function fishMeshes(kind) {
  return cached('fishMeshes_' + kind, () => {
    const { body, spec } = fishGeometry(kind);
    // build body + fins into one geometry with 3 groups: body, eye, fin
    const finG = fishFinGeometry(kind);
    const G = new CritterGeo(3);
    G.slots[0] = body.slots[0];
    G.slots[1] = body.slots[1];
    G.slots[2] = finG.slots[0];
    return { geo: G.build(), spec };
  });
}

export function buildFish(kind = 'goldfish', seed = 1) {
  if (!FISH[kind]) kind = 'goldfish';
  const K = FISH[kind];
  const rng = new RNG((seed * 3301 + 11) >>> 0 || 1);
  const root = new THREE.Group();
  root.name = 'Fish_' + kind;
  const { geo, spec } = fishMeshes(kind);
  const mats = fishMaterials(kind);
  const { mesh, B } = makeSkinned(geo, [mats.body[0], mats.body[1], mats.fin], spec, K.L * 0.5);
  mesh.castShadow = false;
  root.add(mesh);
  const sc = rng.range(0.9, 1.15);
  mesh.scale.setScalar(sc);
  const segs = [B.s0, B.s1, B.s2, B.s3];
  const st = { t: rng.range(0, 100), phase: rng.range(0, TAU), swim: 0, pect: rng.range(0, TAU), turn: 0 };
  const amps = [0.04, 0.1, 0.2, 0.32];

  function update(dt, p = {}) {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    const speed = clamp(Number.isFinite(p.speed) ? p.speed : 0, 0, 2);
    const turning = clamp(Number.isFinite(p.turning) ? p.turning : 0, -3, 3);
    st.t += dt;
    const rel = speed / (K.L * sc); // body lengths per second
    st.swim += (sstep(0.0, 6, rel) - st.swim) * dk(4, dt);
    st.turn += (turning - st.turn) * dk(6, dt);
    const freq = lerp(1.2, 7.5, st.swim);
    st.phase += freq * dt * TAU;
    const amp = lerp(0.35, 1.0, st.swim);
    for (let i = 0; i < FISH_SEG; i++) {
      segs[i].rotation.set(0, Math.sin(st.phase - i * 0.9) * amps[i] * amp + st.turn * 0.12 * (i + 1) * 0.5, 0);
    }
    B.root.rotation.set(0.04 * Math.sin(st.t * 0.9), Math.sin(st.phase + 1.2) * 0.03 * amp, 0.03 * Math.sin(st.t * 0.7));
    // pectoral fins scull faster when hovering
    st.pect += lerp(9, 4, st.swim) * dt;
    const pa = lerp(0.55, 0.25, st.swim);
    B.pectL.rotation.set(0, 0.3 + Math.sin(st.pect) * pa, 0);
    B.pectR.rotation.set(0, -0.3 - Math.sin(st.pect + 0.4) * pa, 0);
  }
  update(0, {});
  return {
    root, mesh, update,
    dispose() { root.removeFromParent(); mesh.skeleton.dispose(); },
  };
}

export const FISH_KINDS = Object.keys(FISH);

/** Dispose cached shared geometries/materials/textures (call on full teardown). */
export function disposeCritterCache() {
  for (const v of _cache.values()) {
    if (!v) continue;
    if (v.isBufferGeometry || v.isTexture || v.isMaterial) v.dispose();
    else if (Array.isArray(v)) v.forEach((m) => m?.dispose?.());
    else if (v.geo) v.geo.dispose();
    else if (v.body && Array.isArray(v.body)) { v.body.forEach((m) => m.dispose()); v.fin?.dispose(); }
  }
  _cache.clear();
}
