// The thing in the canal: a giant mutated goldfish (~4.6 m). Swollen orange-gold scaly body with
// pale blotches and ulcers, a cluster of mismatched eyes (two huge milky ones, a crowd of small
// wet ones that all track you), a gaping mouth ringed with human teeth, and — where the pectoral
// and pelvic fins should be — long, too-human arms with elbows and grasping fingers. A ragged
// double tail and torn fin membranes. One skinned mesh (2 draw calls), built from the critter kit.
// update(dt, { speed, turn, mouth, reach, lookAt (world Vector3|null), surge }) animates it.
import * as THREE from 'three';
import { TAU, V3, clamp, lerp, sstep, dk, noise3, curve, cached, latheGeo, ellipsoidGeo, tubeGeo, finGeo, CritterGeo, makeSkinned, surfaceMaterial, synthOrFlat } from '../../../entities/critters/kit.js';

const L = 4.6;               // head tip -> tail base
const SEG = 5;               // spine bones
const SPINE_Z = [-0.28, -0.05, 0.12, 0.26, 0.38, 0.5].map((f) => f * L);
const RY = curve([[0, 0], [0.04, 0.12], [0.18, 0.25], [0.4, 0.3], [0.62, 0.25], [0.84, 0.12], [1, 0.06]]);
const RX = curve([[0, 0], [0.04, 0.1], [0.2, 0.19], [0.42, 0.21], [0.7, 0.13], [1, 0.04]]);
// arms: [side, z along body (fraction), y (fraction of RY), length scale]
const ARMS = [[-1, 0.27, -0.35, 1.0], [1, 0.27, -0.35, 1.05], [-1, 0.52, -0.7, 0.8], [1, 0.55, -0.68, 0.75]];
// eyes on the head: [side, u (along), v (up, fraction of ry), radius (m), milky]
const EYES = [
  [-1, 0.1, 0.25, 0.17, 1], [1, 0.1, 0.25, 0.17, 1],
  [-1, 0.06, 0.55, 0.07, 0], [1, 0.07, 0.6, 0.06, 0], [-1, 0.15, 0.7, 0.08, 0], [1, 0.14, 0.72, 0.09, 0],
  [-1, 0.19, 0.42, 0.05, 0], [1, 0.2, 0.36, 0.055, 0], [0.15, 0.12, 0.9, 0.065, 0], [-0.3, 0.17, 0.95, 0.045, 0],
  [-1, 0.045, -0.05, 0.04, 0], [1, 0.05, 0.0, 0.045, 0],
];

function spec() {
  const out = [{ name: 'root', parent: null, pos: [0, 0, SPINE_Z[0]] }];
  for (let i = 0; i < SEG; i++) out.push({ name: 's' + i, parent: i ? 's' + (i - 1) : 'root', pos: [0, 0, SPINE_Z[i + 1]] });
  out.push({ name: 'jaw', parent: 'root', pos: [0, -0.05 * L, -0.44 * L] });
  ARMS.forEach(([side, u, v], k) => {
    const z = lerp(-L / 2, L / 2, u), y = RY(u) * L * v, x = side * RX(u) * L * 0.85;
    const par = u < 0.4 ? 'root' : 's1';
    out.push({ name: `a${k}`, parent: par, pos: [x, y, z] });
    const ls = ARMS[k][3];
    out.push({ name: `e${k}`, parent: `a${k}`, pos: [x + side * 0.75 * ls, y - 0.25 * ls, z - 0.2 * ls] });
    out.push({ name: `h${k}`, parent: `e${k}`, pos: [x + side * 1.25 * ls, y - 0.55 * ls, z - 0.7 * ls] });
  });
  EYES.forEach((e, k) => {
    const [side, u, v] = e;
    const z = lerp(-L / 2, L / 2, u), ry = RY(u) * L;
    const sx = Math.abs(side) === 1 ? side * RX(u) * L * Math.sqrt(Math.max(0, 1 - v * v)) * 0.95 : side * 0.3;
    out.push({ name: `eye${k}`, parent: 'root', pos: [sx, ry * v, z] });
  });
  return out;
}

const S_SCALE = [0.28, 1.0, 0.2, 1];
const S_SKIN = [0.45, 0.6, 0.1, 0.25];
const S_EYE = [0.03, 1.0, 0.0, 0];
const S_TOOTH = [0.35, 0.4, 0, 0];
const S_FIN = [0.5, 0.2, 0.0, 0];

function geometry() {
  return cached('poolGoldfishGeo', () => {
    const sp = spec();
    const names = sp.map((s) => s.name);
    const bi = (n) => names.indexOf(n);
    const G = new CritterGeo(2);
    const zOf = (u) => lerp(-L / 2, L / 2, u);
    const spineB = ['root', 's0', 's1', 's2', 's3', 's4'].map(bi);
    const wSpine = (p) => {
      const z = p.z;
      if (z <= SPINE_Z[0]) return [[spineB[0], 1]];
      for (let i = 1; i < SPINE_Z.length; i++) if (z <= SPINE_Z[i]) { const f = sstep(SPINE_Z[i - 1], SPINE_Z[i], z); return [[spineB[i - 1], 1 - f], [spineB[i], f]]; }
      return [[spineB[spineB.length - 1], 1]];
    };
    // ---- body: swollen, lumpy, scaly gold; pale belly, black-red ulcers, scale loss patches
    const lump = (x, y, z) => 1 + 0.07 * noise3(x * 1.3, y * 1.3, z * 1.3) + 0.04 * noise3(x * 4, y * 4, z * 4);
    const body = latheGeo((u) => ({ z: zOf(u), y: 0.03 * L * Math.sin(u * Math.PI), rx: RX(u) * L, ry: RY(u) * L, flat: 0.12 }), 34, 44);
    {
      const P = body.attributes.position;
      for (let i = 0; i < P.count; i++) {
        const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
        const k = lump(x, y, z);
        P.setXYZ(i, x * k, y * k, z);
      }
      body.computeVertexNormals();
    }
    G.add(body, 0, (p) => {
      const u = (p.z + L / 2) / L;
      const v = p.y / Math.max(1e-3, RY(u) * L);
      const belly = sstep(0.1, -0.7, v), back = sstep(0.2, 0.95, v);
      let c = [1.0, lerp(lerp(0.46, 0.8, belly), 0.32, back), lerp(lerp(0.06, 0.5, belly), 0.03, back)];
      // gilded shimmer bands + darker scale rows
      const band = 0.85 + 0.15 * Math.sin(u * 60 + v * 4);
      c = c.map((x) => x * band);
      // pale bleached patches (scale loss)
      const bleach = sstep(0.55, 0.75, noise3(p.x * 1.6, p.y * 1.6, p.z * 1.6));
      c = [lerp(c[0], 0.9, bleach), lerp(c[1], 0.82, bleach), lerp(c[2], 0.7, bleach)];
      // ulcers: dark red-black sores
      const ulc = sstep(0.7, 0.82, noise3(p.x * 3.1 + 7, p.y * 3.1, p.z * 3.1));
      c = [lerp(c[0], 0.28, ulc), lerp(c[1], 0.04, ulc), lerp(c[2], 0.03, ulc)];
      // gill slits (several, wrong)
      const gill = Math.max(...[0.2, 0.235, 0.27].map((g) => sstep(0.008, 0.0, Math.abs(u - g - 0.03 * v * v)))) * sstep(0.9, 0.4, Math.abs(v));
      c = c.map((x) => x * (1 - gill * 0.75));
      // the open mouth cavity
      const mouth = sstep(0.045, 0.0, u) * sstep(0.5, 0.0, Math.abs(v + 0.1));
      c = [lerp(c[0], 0.25, mouth), lerp(c[1], 0.03, mouth), lerp(c[2], 0.04, mouth)];
      return c;
    }, (p) => {
      const u = (p.z + L / 2) / L;
      if (u < 0.06 && p.y < 0.05 * L) return [[bi('jaw'), 1]];
      return wSpine(p);
    }, (p) => {
      const u = (p.z + L / 2) / L;
      return u < 0.2 ? S_SKIN : S_SCALE;
    }, (u, v) => [v * 3.0, u * 4.0]);
    // ---- lips + human teeth ringing the mouth
    const mz = -L / 2 + 0.05;
    const lip = tubeGeo((t, out) => { const a = t * TAU; return out.set(Math.cos(a) * 0.32, -0.02 + Math.sin(a) * 0.24, mz + 0.03 + 0.02 * Math.sin(a * 3)); }, () => 0.06, 8, 40);
    G.add(lip, 0, [0.85, 0.42, 0.36], (p) => (p.y < -0.02 ? [[bi('jaw'), 1]] : [[bi('root'), 1]]), S_SKIN);
    for (let k = 0; k < 22; k++) {
      const a = (k / 22) * TAU;
      const r0 = 0.27, x = Math.cos(a) * r0, y = -0.02 + Math.sin(a) * r0 * 0.75;
      const len = 0.06 + ((k * 37) % 7) * 0.008;
      const g = ellipsoidGeo(new V3(x, y, mz + 0.08), 0.03, 0.04, len, 6, 5, new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25 * Math.sin(a), 0, 0)));
      G.add(g, 0, k % 5 === 0 ? [0.62, 0.55, 0.38] : [0.92, 0.88, 0.76], y < -0.02 ? bi('jaw') : bi('root'), S_TOOTH);
    }
    // ---- eyes: milky giants + a crowd of glossy small ones on stalk-like bulges
    EYES.forEach(([side, u, v, r, milky], k) => {
      const z = zOf(u), ry = RY(u) * L;
      const sx = Math.abs(side) === 1 ? side * RX(u) * L * Math.sqrt(Math.max(0, 1 - v * v)) * 0.95 : side * 0.3;
      const c = new V3(sx, ry * v, z);
      const eb = bi(`eye${k}`);
      // fleshy socket ring
      G.add(ellipsoidGeo(c, r * 1.3, r * 1.3, r * 1.3, 12, 9), 0, [0.8, 0.36, 0.22], eb, S_SKIN);
      G.add(ellipsoidGeo(c.clone().add(new V3(Math.sign(sx || 1) * r * 0.45, r * 0.1, 0)), r, r, r, 14, 10), 0, (p) => {
        // pupil faces the bone's local -z (the eye bone is rotated to look at the target)
        const dz = (p.z - z) / r, dx = (p.x - c.x) / r, dy = (p.y - c.y) / r;
        const front = -dz;
        if (milky) {
          const cat = sstep(0.4, 0.2, Math.hypot(dx, dy)) * sstep(0.2, 0.6, front);
          return [lerp(0.86, 0.6, cat), lerp(0.88, 0.62, cat), lerp(0.8, 0.5, cat)];
        }
        const pupil = sstep(0.62, 0.78, front) * sstep(0.45, 0.25, Math.abs(dx) * 2.2);
        const iris = sstep(0.4, 0.55, front);
        const vein = sstep(0.75, 0.9, noise3(p.x * 40, p.y * 40, p.z * 40)) * (1 - iris);
        let col = [0.92, 0.88, 0.78];
        col = [lerp(col[0], 0.75, vein), lerp(col[1], 0.12, vein), lerp(col[2], 0.1, vein)];
        col = [lerp(col[0], 0.75, iris), lerp(col[1], 0.55, iris), lerp(col[2], 0.08, iris)];
        return [lerp(col[0], 0.01, pupil), lerp(col[1], 0.01, pupil), lerp(col[2], 0.01, pupil)];
      }, eb, S_EYE);
    });
    // ---- arms: upper arm, forearm, hand with five long fingers; pale, mottled, wet
    const skin = (p) => {
      const m = sstep(0.3, 0.8, noise3(p.x * 6, p.y * 6, p.z * 6));
      const vein = sstep(0.82, 0.92, noise3(p.x * 18 + 3, p.y * 18, p.z * 18));
      return [lerp(0.86, 0.72, m) - vein * 0.3, lerp(0.72, 0.6, m) - vein * 0.25, lerp(0.62, 0.55, m) - vein * 0.1];
    };
    ARMS.forEach(([side, u, v, ls], k) => {
      const A = sp.find((s) => s.name === `a${k}`).pos, E = sp.find((s) => s.name === `e${k}`).pos, H = sp.find((s) => s.name === `h${k}`).pos;
      const a = new V3(...A), e = new V3(...E), h = new V3(...H);
      const ab = bi(`a${k}`), eb = bi(`e${k}`), hb = bi(`h${k}`);
      const seg = (p0, p1, r0, r1, bone, nextBone) => {
        const g = tubeGeo((t, out) => out.lerpVectors(p0, p1, t), (t) => lerp(r0, r1, t) * (1 + 0.15 * Math.sin(t * Math.PI)), 10, 10);
        G.add(g, 0, skin, (p) => {
          const t = clamp(p.clone().sub(p0).dot(p1.clone().sub(p0)) / p1.clone().sub(p0).lengthSq(), 0, 1);
          return t > 0.8 && nextBone !== undefined ? [[bone, 1 - sstep(0.8, 1, t) * 0.5], [nextBone, sstep(0.8, 1, t) * 0.5]] : [[bone, 1]];
        }, S_SKIN);
      };
      seg(a.clone().add(new V3(-side * 0.1, 0, 0)), e, 0.13 * ls, 0.09 * ls, ab, eb);
      G.add(ellipsoidGeo(e, 0.1 * ls, 0.1 * ls, 0.11 * ls, 8, 6), 0, skin, eb, S_SKIN); // elbow
      seg(e, h, 0.09 * ls, 0.065 * ls, eb, hb);
      // palm + fingers splayed forward
      const dir = h.clone().sub(e).normalize();
      const across = new V3(0, 1, 0).cross(dir).normalize();
      G.add(ellipsoidGeo(h.clone().addScaledVector(dir, 0.08 * ls), 0.1 * ls, 0.04 * ls, 0.12 * ls, 8, 6, new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), dir)), 0, skin, hb, S_SKIN);
      for (let f = 0; f < 5; f++) {
        const off = (f - 2) * 0.045 * ls;
        const base = h.clone().addScaledVector(dir, 0.16 * ls).addScaledVector(across, off);
        const flen = (f === 0 ? 0.18 : 0.3 - Math.abs(f - 2.5) * 0.03) * ls;
        const fdir = dir.clone().addScaledVector(across, (f - 2) * 0.18).normalize();
        const mid = base.clone().addScaledVector(fdir, flen * 0.55).add(new V3(0, -flen * 0.15, 0));
        const tip = base.clone().addScaledVector(fdir, flen).add(new V3(0, -flen * 0.45, 0));
        const g = tubeGeo((t, out) => (t < 0.5 ? out.lerpVectors(base, mid, t * 2) : out.lerpVectors(mid, tip, (t - 0.5) * 2)), (t) => lerp(0.022, 0.012, t) * ls, 6, 6);
        G.add(g, 0, (p) => { const c = skin(p); const nail = sstep(0.85, 0.98, p.distanceTo(base) / flen); return [lerp(c[0], 0.6, nail), lerp(c[1], 0.55, nail), lerp(c[2], 0.4, nail)]; }, hb, S_SKIN);
      }
    });
    // ---- fins (slot 1): torn double tail, ragged dorsal
    const finCol = (p, along) => [lerp(1.0, 0.85, along), lerp(0.55, 0.3, along), lerp(0.15, 0.1, along), 0.82];
    const tailZ = L / 2 - 0.05;
    const tail = [[0, 0.1], [0.3, 0.75], [0.7, 1.05], [0.62, 0.5], [0.85, 0.22], [0.6, 0.0], [0.85, -0.24], [0.6, -0.55], [0.75, -1.0], [0.3, -0.7], [0, -0.1]];
    for (const s of [-1, 1]) {
      const g = finGeo(tail, (a, b, out) => out.set(s * a * 0.32, b * 0.75, tailZ + a * 1.35), 1, 1);
      G.add(g, 1, (p) => finCol(p, (p.z - tailZ) / 1.3), bi('s4'), S_FIN, (uu, vv) => [0.5 + uu * 0.5, vv]);
    }
    const dorsal = [[0.18, 0.0], [0.26, 0.38], [0.4, 0.55], [0.47, 0.3], [0.55, 0.45], [0.68, 0.18], [0.74, 0.0]];
    const dg = finGeo(dorsal, (a, b, out) => { const z = zOf(a); out.set(0, RY(a) * L * 0.95 + b * 1.2, z); }, 1, 1);
    G.add(dg, 1, (p) => finCol(p, clamp((p.y - 0.8) / 1.0, 0, 1)), wSpine, S_FIN, (uu, vv) => [uu * 0.5, vv]);
    const anal = [[0.62, 0.0], [0.7, -0.3], [0.82, -0.25], [0.86, 0.0]];
    const ag = finGeo(anal, (a, b, out) => { const z = zOf(a); out.set(0, -RY(a) * L * 0.9 + b * 1.0, z); }, 1, 1);
    G.add(ag, 1, (p) => finCol(p, 0.5), wSpine, S_FIN, (uu, vv) => [uu * 0.5, 1 - vv]);
    return { geo: G.build(), sp };
  });
}

function finTex() {
  return cached('poolFishFinTex', () => {
    const W = 256, H = 128, data = new Uint8Array(W * H * 4);
    let s = 9;
    const R = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const holes = Array.from({ length: 14 }, () => [R() * W, R() * H, 4 + R() * 12]);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const u = (x % (W / 2)) / (W / 2), v = y / H;
      const ray = Math.pow(Math.abs(Math.cos((x < W / 2 ? u * 16 : (v - 0.5) / Math.max(0.05, u + 0.08) * 8) * Math.PI)), 12);
      let a = 0.5 + 0.5 * ray;
      const edge = x < W / 2 ? v : u;
      a *= 1 - sstep(0.82 + 0.12 * Math.sin(x * 0.7 + y * 0.3), 1.0, edge);
      for (const [hx, hy, hr] of holes) if (Math.hypot(x - hx, y - hy) < hr) a = 0;
      const lum = 0.75 + 0.25 * ray;
      data[i] = data[i + 1] = data[i + 2] = Math.round(lum * 255);
      data[i + 3] = Math.round(clamp(a, 0, 1) * 255);
    }
    const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  });
}

function materials() {
  return cached('poolGoldfishMats', () => {
    const T = synthOrFlat('fish_scales', {});
    const body = surfaceMaterial('pool_goldfish', {
      map: T.map, normalMap: T.normalMap, normalScale: new THREE.Vector2(1.2, 1.2),
      iridescence: 0.55, iridescenceIOR: 1.4, iridescenceThicknessRange: [200, 600],
      sheenColor: new THREE.Color(1.0, 0.75, 0.4), sheenRoughness: 0.4, clearcoatRoughness: 0.06,
    });
    const fin = new THREE.MeshPhysicalMaterial({ vertexColors: true, map: finTex(), roughness: 0.45, transparent: true, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.05 });
    fin.name = 'pool_goldfish_fin';
    return [body, fin];
  });
}

const _t = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _qq = new THREE.Quaternion();

export function buildGoldfish(seed = 1) {
  const root = new THREE.Group();
  root.name = 'Goldfish';
  const { geo, sp } = geometry();
  const { mesh, B } = makeSkinned(geo, materials(), sp, L * 0.6);
  mesh.frustumCulled = false;
  root.add(mesh);
  const segs = [B.s0, B.s1, B.s2, B.s3, B.s4];
  const eyes = EYES.map((_, k) => B[`eye${k}`]);
  const st = { t: seed * 3.7, phase: 0, swim: 0, turn: 0, mouth: 0, reach: 0, armPh: 0 };
  const amps = [0.03, 0.06, 0.12, 0.2, 0.3];
  function update(dt, p = {}) {
    dt = clamp(dt || 0, 0, 0.1);
    st.t += dt;
    const speed = clamp(p.speed || 0, 0, 12);
    st.swim += (sstep(0, 3, speed) - st.swim) * dk(3, dt);
    st.turn += (clamp(p.turn || 0, -2, 2) - st.turn) * dk(5, dt);
    st.phase += lerp(0.6, 3.2, st.swim) * dt * TAU * (1 + (p.surge || 0));
    const amp = lerp(0.6, 1.0, st.swim) * (1 + (p.surge || 0) * 0.6);
    for (let i = 0; i < SEG; i++) {
      // a jerky, unhealthy undulation: the wave stutters now and then
      const stut = 1 + 0.4 * Math.max(0, Math.sin(st.t * 1.7 + i)) * Math.sin(st.t * 23 + i * 2);
      segs[i].rotation.set(0.02 * Math.sin(st.t * 1.1 + i), Math.sin(st.phase - i * 0.85) * amps[i] * amp * stut + st.turn * 0.1 * (i + 1) * 0.4, 0.03 * Math.sin(st.t * 0.7 + i));
    }
    B.root.rotation.set(0.03 * Math.sin(st.t * 0.6), Math.sin(st.phase + 1.3) * 0.03, 0.05 * Math.sin(st.t * 0.45));
    // mouth gapes and chews
    st.mouth += ((p.mouth ?? 0.15 + 0.1 * Math.max(0, Math.sin(st.t * 0.9))) - st.mouth) * dk(8, dt);
    B.jaw.rotation.x = st.mouth * 0.75;
    // arms: slow breast-stroke paddling, or reaching forward with clawing fingers
    st.reach += ((p.reach || 0) - st.reach) * dk(5, dt);
    st.armPh += dt * lerp(1.1, 2.6, st.swim);
    for (let k = 0; k < ARMS.length; k++) {
      const side = ARMS[k][0];
      const ph = st.armPh + k * 1.7;
      const a = B[`a${k}`], e = B[`e${k}`], h = B[`h${k}`];
      const stroke = Math.sin(ph);
      a.rotation.set(lerp(0.3 * stroke, -0.9, st.reach), side * lerp(0.5 * Math.cos(ph), -0.4, st.reach), side * lerp(0.35 * stroke, 0.2, st.reach));
      e.rotation.set(lerp(0.5 + 0.4 * Math.sin(ph + 1.2), 0.1, st.reach), side * 0.2 * Math.sin(ph * 0.5), 0);
      h.rotation.set(0.4 * Math.sin(ph * 2.1) + st.reach * Math.sin(st.t * 9 + k) * 0.4, 0, side * 0.3 * Math.sin(ph * 1.3));
    }
    // every eye rolls to look at the target (the local camera); the milky ones drift
    if (p.lookAt) {
      root.updateMatrixWorld(true);
      for (let k = 0; k < eyes.length; k++) {
        const eb = eyes[k];
        if (!eb) continue;
        if (EYES[k][4]) { eb.rotation.set(Math.sin(st.t * 0.4 + k) * 0.3, Math.sin(st.t * 0.3 + k * 2) * 0.4, 0); continue; }
        eb.parent.updateWorldMatrix(true, false);
        _m.copy(eb.parent.matrixWorld).invert();
        _t.copy(p.lookAt).applyMatrix4(_m).sub(eb.position).normalize();
        // the pupil faces local -z
        _qq.setFromUnitVectors(new V3(0, 0, -1), _t);
        eb.quaternion.slerp(_qq, dk(10 + k, dt));
      }
    }
  }
  update(0, {});
  return { root, mesh, update, length: L, dispose() { root.removeFromParent(); mesh.skeleton.dispose(); } };
}
