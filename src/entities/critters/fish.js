// Critters — aquarium fish (goldfish, neon tetra, angelfish, clownfish, guppy). Two draw calls,
// ~1.1k triangles each, geometry/materials shared per kind:
//   0  body: lathe with per-kind colour pattern, synthesised overlapping scales (normal + albedo
//      running head -> tail), painted gill cover, mouth and lateral line, glossy eyes with a
//      metallic iris (per-vertex gloss via the shared surface material), faint iridescence
//   1  fins: translucent membranes with bony rays (fan rays: tail + pectorals, comb rays: dorsal
//      + anal), frayed fading edges, subdivided so they bend with the spine
// Origin at the body centre, facing -Z. update(dt, { speed, turning }) swims (body wave grows
// toward the tail), sculls the pectorals while hovering, flutters the fins.
import * as THREE from 'three';
import { TAU, V3, clamp, lerp, sstep, dk, noise3, curve, cached, latheGeo, ellipsoidGeo, finGeo, CritterGeo, makeBones, makeSkinned, surfaceMaterial, synthOrFlat, rng } from './kit.js';

// Each kind: body length L (head tip to tail base), profile keys (height ry / width rx as a
// fraction of L), colours and fin outlines (in units of L).
const FISH = {
  goldfish: {
    L: 0.07, ry: [[0, 0], [0.05, 0.12], [0.25, 0.26], [0.45, 0.28], [0.75, 0.16], [0.92, 0.07], [1, 0.06]],
    rx: [[0, 0], [0.05, 0.08], [0.3, 0.16], [0.5, 0.17], [0.8, 0.09], [1, 0.04]],
    irid: 0.35, iris: [0.95, 0.62, 0.18],
    color(u, v) { const belly = sstep(0.1, -0.6, v), back = sstep(0.3, 0.9, v); return [1.0, lerp(lerp(0.42, 0.78, belly), 0.3, back), lerp(lerp(0.05, 0.42, belly), 0.02, back)]; },
    fin: [1.0, 0.5, 0.12], finAlpha: 0.78,
    tail: [[0, 0.03], [0.25, 0.3], [0.55, 0.42], [0.45, 0.12], [0.6, 0.0], [0.45, -0.12], [0.55, -0.42], [0.25, -0.3], [0, -0.03]],
    dorsal: [[0.25, 0.0], [0.33, 0.24], [0.5, 0.2], [0.7, 0.08], [0.75, 0.0]],
    anal: [[0.62, 0.0], [0.7, -0.14], [0.82, -0.12], [0.85, 0.0]],
    pect: 0.13, doubleTail: true,
  },
  neon: {
    L: 0.05, ry: [[0, 0], [0.06, 0.1], [0.3, 0.17], [0.55, 0.16], [0.85, 0.08], [1, 0.06]],
    rx: [[0, 0], [0.06, 0.07], [0.3, 0.1], [0.6, 0.08], [1, 0.035]],
    irid: 1.0, iris: [0.8, 0.85, 0.9],
    color(u, v) {
      const blue = sstep(0.3, 0.12, Math.abs(v - 0.28)) * sstep(0.12, 0.2, u) * sstep(0.95, 0.85, u);
      const red = sstep(-0.05, -0.2, v) * sstep(0.45, 0.55, u);
      const base = v > 0.45 ? [0.35, 0.36, 0.3] : [0.8, 0.82, 0.84];
      let c = [lerp(base[0], 0.05, blue), lerp(base[1], 0.75, blue), lerp(base[2], 1.0, blue)];
      c = [lerp(c[0], 0.95, red), lerp(c[1], 0.08, red), lerp(c[2], 0.1, red)];
      return c;
    },
    fin: [0.85, 0.88, 0.9], finAlpha: 0.38,
    tail: [[0, 0.03], [0.22, 0.17], [0.28, 0.16], [0.18, 0.0], [0.28, -0.16], [0.22, -0.17], [0, -0.03]],
    dorsal: [[0.42, 0.0], [0.48, 0.14], [0.56, 0.1], [0.58, 0.0]],
    anal: [[0.55, 0.0], [0.6, -0.1], [0.8, -0.06], [0.82, 0.0]],
    pect: 0.1,
  },
  angel: {
    L: 0.07, ry: [[0, 0], [0.05, 0.16], [0.25, 0.42], [0.45, 0.46], [0.7, 0.3], [0.9, 0.1], [1, 0.07]],
    rx: [[0, 0], [0.06, 0.06], [0.3, 0.09], [0.6, 0.08], [1, 0.03]],
    irid: 0.6, iris: [0.9, 0.3, 0.15], dy: -0.02,
    color(u, v) {
      const stripe = Math.max(sstep(0.04, 0.0, Math.abs(u - 0.2)), sstep(0.05, 0.0, Math.abs(u - 0.45)), sstep(0.04, 0.0, Math.abs(u - 0.72)));
      const silver = [0.84, 0.84, 0.8 + 0.05 * v];
      return [lerp(silver[0], 0.05, stripe), lerp(silver[1], 0.05, stripe), lerp(silver[2], 0.04, stripe)];
    },
    fin: [0.78, 0.78, 0.72], finAlpha: 0.6, finStripes: true,
    tail: [[0, 0.04], [0.12, 0.3], [0.45, 0.5], [0.3, 0.12], [0.32, 0.0], [0.3, -0.12], [0.45, -0.5], [0.12, -0.3], [0, -0.04]],
    dorsal: [[0.22, 0.0], [0.6, 0.85], [0.75, 0.62], [0.8, 0.2], [0.9, 0.0]],
    anal: [[0.3, 0.0], [0.62, -0.85], [0.76, -0.62], [0.82, -0.2], [0.9, 0.0]],
    pelvicLong: true, pect: 0.12,
  },
  clown: {
    L: 0.065, ry: [[0, 0], [0.06, 0.15], [0.3, 0.27], [0.55, 0.26], [0.85, 0.14], [1, 0.1]],
    rx: [[0, 0], [0.06, 0.1], [0.3, 0.15], [0.6, 0.13], [1, 0.05]],
    irid: 0.15, iris: [0.95, 0.55, 0.1],
    color(u, v) {
      const band = (c, w) => sstep(w, w * 0.6, Math.abs(u - c));
      const edge = (c, w) => sstep(w * 1.35, w * 1.1, Math.abs(u - c)) * (1 - band(c, w));
      const white = Math.max(band(0.24, 0.06), band(0.52, 0.07), band(0.92, 0.035));
      const black = Math.max(edge(0.24, 0.06), edge(0.52, 0.07), edge(0.92, 0.035));
      let c = [1.0, 0.42, 0.04];
      c = [lerp(c[0], 0.98, white), lerp(c[1], 0.97, white), lerp(c[2], 0.95, white)];
      return [lerp(c[0], 0.03, black), lerp(c[1], 0.02, black), lerp(c[2], 0.02, black)];
    },
    fin: [1.0, 0.45, 0.06], finAlpha: 0.88, finEdge: true,
    tail: [[0, 0.06], [0.2, 0.24], [0.32, 0.18], [0.34, 0.0], [0.32, -0.18], [0.2, -0.24], [0, -0.06]],
    dorsal: [[0.25, 0.0], [0.32, 0.17], [0.45, 0.14], [0.55, 0.1], [0.7, 0.2], [0.85, 0.1], [0.92, 0.0]],
    anal: [[0.62, 0.0], [0.7, -0.17], [0.85, -0.12], [0.9, 0.0]],
    pect: 0.16,
  },
  guppy: {
    L: 0.042, ry: [[0, 0], [0.06, 0.1], [0.3, 0.17], [0.6, 0.15], [0.9, 0.09], [1, 0.08]],
    rx: [[0, 0], [0.06, 0.08], [0.3, 0.11], [0.6, 0.09], [1, 0.04]],
    irid: 0.9, iris: [0.8, 0.8, 0.6],
    color(u, v, side) {
      const spot = sstep(0.55, 0.75, noise3(u * 14, v * 14, side * 3)) * sstep(0.4, 0.6, u);
      const base = [lerp(0.72, 0.55, sstep(-0.3, 0.5, v)), lerp(0.74, 0.58, sstep(-0.3, 0.5, v)), lerp(0.7, 0.45, sstep(-0.3, 0.5, v))];
      return [lerp(base[0], 0.15, spot), lerp(base[1], 0.55, spot), lerp(base[2], 0.95, spot)];
    },
    fin: [1, 1, 1], finAlpha: 0.88, finGradient: [[0.1, 0.35, 1.0], [1.0, 0.35, 0.08]],
    tail: [[0, 0.06], [0.45, 0.55], [0.85, 0.62], [1.0, 0.3], [1.02, 0.0], [1.0, -0.3], [0.85, -0.62], [0.45, -0.55], [0, -0.06]],
    dorsal: [[0.45, 0.0], [0.6, 0.32], [0.85, 0.3], [0.8, 0.0]],
    anal: [[0.62, 0.0], [0.7, -0.1], [0.8, -0.06], [0.82, 0.0]],
    pect: 0.1,
  },
};
export const FISH_KINDS = Object.keys(FISH);
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

const S_SCALE = [0.32, 0.35, 0.25, 1]; // body: wet scales
const S_HEAD = [0.25, 0.6, 0.15, 0.25];
const S_EYE = [0.04, 1.0, 0.0, 0];
const S_FIN = [0.4, 0.0, 0.0, 0];

function fishGeometry(kind) {
  return cached('fishGeo_' + kind, () => {
    const K = FISH[kind], L = K.L;
    const spec = fishBones(L);
    const { index: bi } = makeBones(spec);
    const G = new CritterGeo(2);
    const ry = curve(K.ry), rx = curve(K.rx);
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
    const dy = (K.dy || 0) * L;
    // ---- body: colour pattern + gill cover + mouth + lateral line; scales along the body
    const body = latheGeo((u) => ({ z: zOf(u), y: 0.02 * L * Math.sin(u * Math.PI) + dy, rx: rx(u) * L, ry: ry(u) * L, flat: 0.1 }), 16, 20);
    const gillU = 0.235;
    G.add(body, 0, (p, n) => {
      const u = (p.z + L / 2) / L;
      const v = (p.y - dy) / Math.max(1e-6, ry(u) * L);
      const c = K.color(u, v, Math.sign(p.x));
      const back = 1 - 0.2 * sstep(0.3, 0.9, v);
      const gill = sstep(0.012, 0.0, Math.abs(u - gillU - 0.04 * v * v)) * sstep(0.95, 0.5, Math.abs(v)) * 0.45;
      const mouth = sstep(0.05, 0.0, u) * sstep(0.35, 0.0, Math.abs(v + 0.05)) * 0.8;
      const lateral = sstep(0.06, 0.0, Math.abs(v - 0.05)) * sstep(0.25, 0.35, u) * sstep(0.95, 0.85, u) * (Math.sin(u * 120) > 0.3 ? 0.18 : 0);
      const nz = 0.05 * noise3(p.x * 300, p.y * 300, p.z * 300);
      const k = back * (1 - gill - mouth) * (1 - lateral) + nz;
      return [c[0] * k, c[1] * k, c[2] * k];
    }, wSpine, (p) => ((p.z + L / 2) / L < gillU ? S_HEAD : S_SCALE), (u, v) => (v < gillU ? [0.5, 0.5] : [v * 1.0, u * 1.5]));
    // ---- eyes: black pupil, metallic iris ring, glossy cornea
    const eu = 0.12, eyeZ = zOf(eu), eyeY = 0.04 * L + dy, eyeR = Math.max(0.0028, ry(eu + 0.05) * L * 0.42);
    for (const s of [-1, 1]) {
      const ex = s * rx(eu) * L * 0.86;
      const c = new V3(ex, eyeY, eyeZ);
      G.add(ellipsoidGeo(c, eyeR * 0.6, eyeR, eyeR, 10, 8), 0, (p) => {
        const d = Math.hypot(p.y - eyeY, p.z - eyeZ) / eyeR;
        if (d < 0.5) return [0.008, 0.008, 0.01];
        const ring = sstep(0.95, 0.75, d);
        return [K.iris[0] * ring + 0.04, K.iris[1] * ring + 0.04, K.iris[2] * ring + 0.04];
      }, bi('root'), S_EYE, () => [0.5, 0.5]);
    }
    // ---- fins (slot 1). UV: x = 0..0.5 comb rays (dorsal/anal), 0.5..1 fan rays (tail/pectoral)
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
      return [c[0], c[1], c[2], K.finAlpha];
    };
    const fanUV = (u, v) => [0.5 + u * 0.5, v];
    const combUV = (u, v) => [u * 0.5, v];
    const tailZ = L / 2 - 0.02 * L;
    const tailSides = K.doubleTail ? [-1, 1] : [0];
    for (const s of tailSides) {
      const g = finGeo(K.tail, (a, b, out) => out.set(s * a * 0.25 * L, b * L, tailZ + a * L), 1, 1);
      const maxA = Math.max(...K.tail.map((e) => e[0]));
      G.add(g, 1, (p) => finCol(p, (p.z - tailZ) / (maxA * L), Math.abs(p.y) / (0.6 * L)), bi('s3'), S_FIN, fanUV);
    }
    const dorsal = finGeo(K.dorsal, (a, b, out) => { const z = zOf(a); out.set(0, ry((z + L / 2) / L) * L * 0.92 + b * L + dy, z); }, 1, 1);
    G.add(dorsal, 1, (p) => finCol(p, (p.z + L / 2) / L, clamp((p.y - dy) / (0.5 * L), 0, 1)), wSpine, S_FIN, combUV);
    const anal = finGeo(K.anal, (a, b, out) => { const z = zOf(a); out.set(0, -ry((z + L / 2) / L) * L * 0.9 + b * L + dy, z); }, 1, 1);
    G.add(anal, 1, (p) => finCol(p, (p.z + L / 2) / L, clamp(-(p.y - dy) / (0.5 * L), 0, 1)), wSpine, S_FIN, (u, v) => [u * 0.5, 1 - v]);
    for (const s of [-1, 1]) {
      const S = s < 0 ? 'pectL' : 'pectR';
      const o = new V3(s * 0.1 * L, -0.06 * L + dy, -0.22 * L);
      const pl = K.pect * L;
      const outline = [[0, 0.015], [0.45, 0.4], [0.9, 0.42], [1.0, 0.1], [0.8, -0.2], [0, -0.015]];
      const g = finGeo(outline, (a, b, out) => out.set(o.x + s * a * pl * 0.55, o.y + b * pl * 0.5 - a * pl * 0.3, o.z + a * pl * 0.75));
      G.add(g, 1, (p) => finCol(p, 0.5, 0.3), bi(S), S_FIN, fanUV);
    }
    for (const s of [-1, 1]) {
      const o = new V3(s * 0.03 * L, -ry(0.3) * L * 0.85 + dy, zOf(0.3));
      const len = K.pelvicLong ? 0.7 * L : 0.12 * L;
      const outline = [[0, 0.02], [0.4, 0.06], [1.0, 0.0], [0.4, -0.02], [0, -0.02]];
      const g = finGeo(outline, (a, b, out) => out.set(o.x + s * b * L * 0.3, o.y - a * len * 0.75, o.z + a * len * 0.6 + b * L * 0.3));
      G.add(g, 1, (p) => finCol(p, 0.6, 0.5), wSpine, S_FIN, fanUV);
    }
    return { geo: G.build(), spec };
  });
}

// fin membrane: rays (opaque, lighter), thin membrane between, frayed fading rim.
// left half: comb rays running up from the base (u along the fin base, v base -> edge)
// right half: fan rays radiating from the base centre (u base -> tip, v across)
function finTexture() {
  return cached('finTex', () => {
    const W = 256, H = 128, data = new Uint8Array(W * H * 4);
    const R = rng(911);
    const fray = new Float32Array(64).map(() => R.range(0.86, 1.0));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let ray, edge, along;
      if (x < W / 2) {
        const u = x / (W / 2), v = y / (H - 1);
        const k = u * 18 + v * 1.2;
        ray = Math.pow(Math.abs(Math.cos(k * Math.PI)), 18);
        along = v;
        edge = sstep(fray[Math.floor(u * 63)] * 0.97, 1.0, v);
      } else {
        const u = (x - W / 2) / (W / 2), v = y / (H - 1);
        const ang = (v - 0.5) / Math.max(0.05, u + 0.08);
        ray = Math.pow(Math.abs(Math.cos(ang * 9 * Math.PI)), 14) * sstep(0.02, 0.12, u);
        along = u;
        edge = sstep(fray[Math.floor(v * 63)] * 0.94, 1.0, u);
      }
      const seg = Math.abs(Math.sin(along * 40)) > 0.97 ? 0.85 : 1; // ray joints
      const lum = (0.78 + 0.22 * ray) * seg;
      const a = clamp((0.42 + 0.58 * ray) * (1 - edge) * (1 - 0.35 * along), 0, 1);
      data[i] = data[i + 1] = data[i + 2] = Math.round(lum * 255);
      data[i + 3] = Math.round(a * 255);
    }
    const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  });
}

function fishMaterials(kind) {
  return cached('fishMat_' + kind, () => {
    const K = FISH[kind];
    const T = synthOrFlat('fish_scales', {});
    const body = surfaceMaterial('fish_' + kind, {
      map: T.map, normalMap: T.normalMap, normalScale: new THREE.Vector2(0.65, 0.65),
      iridescence: K.irid, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 520],
      sheenColor: new THREE.Color(0.8, 0.85, 1.0), sheenRoughness: 0.35, clearcoatRoughness: 0.08,
    });
    const fin = new THREE.MeshPhysicalMaterial({
      vertexColors: true, map: finTexture(), roughness: 0.42, metalness: 0, transparent: true, side: THREE.DoubleSide, depthWrite: false,
      iridescence: K.irid * 0.4, iridescenceIOR: 1.3, iridescenceThicknessRange: [150, 400],
    });
    fin.name = 'fish_fin_' + kind;
    return [body, fin];
  });
}

export function buildFish(kind = 'goldfish', seed = 1) {
  if (!FISH[kind]) kind = 'goldfish';
  const K = FISH[kind];
  const R = rng((seed * 3301 + 11) >>> 0 || 1);
  const root = new THREE.Group();
  root.name = 'Fish_' + kind;
  const { geo, spec } = fishGeometry(kind);
  const { mesh, B } = makeSkinned(geo, fishMaterials(kind), spec, K.L * 0.5);
  mesh.castShadow = false;
  root.add(mesh);
  const sc = R.range(0.9, 1.15);
  mesh.scale.setScalar(sc);
  const segs = [B.s0, B.s1, B.s2, B.s3];
  const st = { t: R.range(0, 100), phase: R.range(0, TAU), swim: 0, pect: R.range(0, TAU), turn: 0 };
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
      segs[i].rotation.set(0.015 * Math.sin(st.t * 2.3 + i), Math.sin(st.phase - i * 0.9) * amps[i] * amp + st.turn * 0.12 * (i + 1) * 0.5, 0);
    }
    B.root.rotation.set(0.04 * Math.sin(st.t * 0.9), Math.sin(st.phase + 1.2) * 0.03 * amp, 0.03 * Math.sin(st.t * 0.7));
    // pectoral fins scull faster when hovering
    st.pect += lerp(9, 4, st.swim) * dt;
    const pa = lerp(0.55, 0.25, st.swim);
    B.pectL.rotation.set(0.1 * Math.sin(st.pect * 0.5), 0.3 + Math.sin(st.pect) * pa, 0);
    B.pectR.rotation.set(0.1 * Math.sin(st.pect * 0.5 + 1), -0.3 - Math.sin(st.pect + 0.4) * pa, 0);
  }
  update(0, {});
  return {
    root, mesh, update,
    dispose() { root.removeFromParent(); mesh.skeleton.dispose(); },
  };
}
