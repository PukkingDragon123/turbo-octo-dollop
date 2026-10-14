// Critters — brown rat (~25 cm incl. tail). Two draw calls, ~2.7k triangles, shared per variant:
//   0  skin: furred body (fur-strand normal/luminance texture), cupped ears, beady glossy eyes,
//      wet pink nose, orange incisors, whiskers, pink paws with toes, ringed scaly tail
//   1  fur shells: three alpha-tested shells of the body slanting back toward the tail, so the
//      silhouette and grazing light read as real fur
// update(dt, { speed, turning }): scurry (half-bound gait), sniffing bursts with twitching
// whiskers, ear flicks, look-arounds, occasional rearing up, breathing, tail swish.
import * as THREE from 'three';
import {
  TAU, V3, clamp, lerp, sstep, dk, noise1, noise3, curve, cached, latheGeo, tubeGeo, ellipsoidGeo,
  CritterGeo, makeBones, makeSkinned, surfaceMaterial, synthOrFlat, rng,
} from './kit.js';

const RAT_BONES = [
  { name: 'body', parent: null, pos: [0, 0.045, 0.0] },
  { name: 'hips', parent: 'body', pos: [0, 0.045, 0.04] },
  { name: 'chest', parent: 'body', pos: [0, 0.045, -0.03] },
  { name: 'head', parent: 'chest', pos: [0, 0.046, -0.066] },
  { name: 'snout', parent: 'head', pos: [0, 0.036, -0.105] },
  { name: 'earL', parent: 'head', pos: [-0.015, 0.06, -0.072] },
  { name: 'earR', parent: 'head', pos: [0.015, 0.06, -0.072] },
  { name: 'legFL', parent: 'chest', pos: [-0.019, 0.03, -0.044] },
  { name: 'legFR', parent: 'chest', pos: [0.019, 0.03, -0.044] },
  { name: 'legHL', parent: 'hips', pos: [-0.025, 0.034, 0.046] },
  { name: 'legHR', parent: 'hips', pos: [0.025, 0.034, 0.046] },
  { name: 'tail0', parent: 'hips', pos: [0, 0.04, 0.086] },
];
const RAT_TAIL_N = 7;
const TAIL_L = 0.215;
function ratTailY(u) { return 0.04 - 0.032 * Math.sin(Math.min(1, u * 1.6) * Math.PI / 2) + 0.004 * u; }
for (let i = 1; i <= RAT_TAIL_N; i++) {
  const u = i / RAT_TAIL_N;
  RAT_BONES.push({ name: 'tail' + i, parent: 'tail' + (i - 1), pos: [0, ratTailY(u), 0.086 + u * TAIL_L] });
}

// body profile along z (u = 0 at the rump, 1 at the nose tip)
const Z0 = 0.09, Z1 = -0.129;
const PRY = curve([[0, 0.0], [0.03, 0.017], [0.12, 0.033], [0.27, 0.039], [0.45, 0.036], [0.6, 0.031], [0.68, 0.024], [0.75, 0.026], [0.84, 0.019], [0.93, 0.011], [0.985, 0.005], [1, 0.0]]);
const PRX = curve([[0, 0.0], [0.03, 0.018], [0.12, 0.036], [0.27, 0.043], [0.45, 0.039], [0.6, 0.032], [0.68, 0.024], [0.75, 0.027], [0.84, 0.019], [0.93, 0.0105], [0.985, 0.0048], [1, 0.0]]);
const PCY = curve([[0, 0.044], [0.25, 0.048], [0.55, 0.046], [0.75, 0.044], [0.9, 0.039], [1, 0.034]]);
const prof = (u, grow = 0) => ({ z: lerp(Z0, Z1, u), y: PCY(u), rx: PRX(u) + (PRX(u) > 0.002 ? grow : 0), ry: PRY(u) + (PRY(u) > 0.002 ? grow : 0), flat: 0.32 });

// sRGB palette
const FUR = [0.3, 0.255, 0.215], FUR_D = [0.17, 0.145, 0.12], BELLY = [0.58, 0.53, 0.47];
const PINK = [0.86, 0.6, 0.58], PINK_D = [0.66, 0.47, 0.45], TAIL = [0.62, 0.5, 0.47];
const SURF = {
  fur: [0.88, 0.0, 0.85, 1], skin: [0.55, 0.15, 0.4, 0], tail: [0.42, 0.25, 0.2, 0], eye: [0.05, 1.0, 0.0, 0],
  nose: [0.3, 0.8, 0.1, 0], tooth: [0.3, 0.6, 0.0, 0], whisker: [0.45, 0.2, 0.0, 0],
};

function furColor(p, n) {
  const top = clamp(n.y * 0.5 + 0.5, 0, 1);
  const k = sstep(0.28, 0.62, top);
  const nz = noise3(p.x * 160, p.y * 160, p.z * 160) * 0.05 + noise3(p.x * 40 + 3, p.y * 40, p.z * 40) * 0.05;
  // darker dorsal stripe, lighter belly and cheeks
  const dors = sstep(0.75, 0.95, top) * 0.35;
  return [lerp(BELLY[0], lerp(FUR[0], FUR_D[0], dors), k) + nz, lerp(BELLY[1], lerp(FUR[1], FUR_D[1], dors), k) + nz, lerp(BELLY[2], lerp(FUR[2], FUR_D[2], dors), k) + nz];
}

function ratGeometry() {
  return cached('ratGeo', () => {
    const { index: bi } = makeBones(RAT_BONES);
    const G = new CritterGeo(2);
    const wBody = (p) => {
      const wHead = sstep(-0.05, -0.075, p.z), wSnout = sstep(-0.095, -0.11, p.z);
      const wHips = sstep(-0.005, 0.04, p.z), wTail = sstep(0.075, 0.095, p.z);
      const out = [[bi('head'), wHead * (1 - wSnout)], [bi('snout'), wSnout], [bi('hips'), wHips * (1 - wTail)], [bi('tail0'), wTail]];
      out.push([bi('chest'), Math.max(0, 1 - wHead - wHips)]);
      return out;
    };
    // ---- furred body (skin slot)
    const body = latheGeo((u) => prof(u), 14, 22, [3, 5]);
    G.add(body, 0, (p, n, u, v) => {
      const c = furColor(p, n);
      // nose tip skin + mouth line
      const nose = sstep(-0.121, -0.127, p.z);
      const mouth = sstep(-0.104, -0.112, p.z) * sstep(0.004, 0.0, Math.abs(p.y - 0.029)) * (1 - nose);
      return [lerp(c[0], PINK[0], nose) * (1 - mouth * 0.7), lerp(c[1], PINK[1], nose) * (1 - mouth * 0.7), lerp(c[2], PINK[2], nose) * (1 - mouth * 0.7), 1];
    }, wBody, (p) => (p.z < -0.12 ? SURF.nose : SURF.fur));
    // ---- fur shells (slot 1): offset along the normal, slanted back toward the tail
    const SH = 3;
    for (let s = 1; s <= SH; s++) {
      const g = latheGeo((u) => prof(0.02 + u * 0.9), 10, 14, [5, 9]);
      const P = g.attributes.position, N = g.attributes.normal;
      for (let i = 0; i < P.count; i++) {
        const z = P.getZ(i), ny = N.getY(i);
        const u = (Z0 - z) / (Z0 - Z1);
        const len = 0.0055 * (0.45 + 0.55 * sstep(0.85, 0.55, u)) * (0.6 + 0.4 * sstep(-0.6, 0.3, ny));
        const h = (len * s) / SH;
        P.setXYZ(i, P.getX(i) + N.getX(i) * h, P.getY(i) + N.getY(i) * h, z + N.getZ(i) * h + h * 0.55);
      }
      const alpha = [1.0, 0.74, 0.56][s - 1];
      G.add(g, 1, (p, n) => { const c = furColor(p, n); const k = 0.7 + 0.12 * s; return [c[0] * k, c[1] * k, c[2] * k, alpha]; }, wBody, SURF.fur);
    }
    // ---- ears (cupped, thin, pink inside)
    for (const s of [-1, 1]) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, s * 0.55, s * 0.3));
      const ear = ellipsoidGeo(new V3(0, 0, 0), 0.0138, 0.0145, 0.0026, 8, 6, q);
      ear.translate(s * 0.0172, 0.0672, -0.0705);
      G.add(ear, 0, (p, n) => {
        const inner = n.z < -0.1 ? 1 : 0;
        const rim = sstep(0.0105, 0.014, Math.hypot(p.x - s * 0.0172, p.y - 0.0672));
        const c = inner ? PINK : PINK_D;
        return [c[0] * (1 - rim * 0.25), c[1] * (1 - rim * 0.3), c[2] * (1 - rim * 0.3), 1];
      }, bi(s < 0 ? 'earL' : 'earR'), SURF.skin);
    }
    // ---- eyes (glossy beads) + nose + incisors
    for (const s of [-1, 1]) G.add(ellipsoidGeo(new V3(s * 0.0158, 0.0525, -0.0965), 0.0044, 0.0042, 0.0046, 8, 6), 0, [0.012, 0.01, 0.012, 1], bi('head'), SURF.eye);
    G.add(ellipsoidGeo(new V3(0, 0.0335, -0.1265), 0.0052, 0.0042, 0.0046, 8, 6), 0, (p) => {
      const nos = sstep(0.0018, 0.0008, Math.hypot(Math.abs(p.x) - 0.0022, p.y - 0.0322)) * (p.z < -0.129 ? 1 : 0);
      return [lerp(PINK[0], 0.2, nos), lerp(PINK[1] * 0.92, 0.1, nos), lerp(PINK[2] * 0.92, 0.1, nos), 1];
    }, bi('snout'), SURF.nose);
    for (const s of [-1, 1]) {
      const t = new THREE.BoxGeometry(0.0013, 0.0045, 0.0012, 1, 1, 1);
      t.translate(s * 0.0008, 0.0255, -0.1205);
      G.add(t, 0, [0.85, 0.55, 0.18, 1], bi('snout'), SURF.tooth);
    }
    // ---- whiskers
    const R = rng(77);
    for (const s of [-1, 1]) {
      for (let k = 0; k < 5; k++) {
        const o = new V3(s * 0.0055, 0.0315 + k * 0.0014, -0.118 + k * 0.0022);
        const d = new V3(s * R.range(0.75, 1.0), R.range(-0.2, 0.25), R.range(0.0, 0.45)).normalize();
        const len = R.range(0.03, 0.05);
        G.add(tubeGeo((t, out) => out.copy(o).addScaledVector(d, t * len).add(new V3(0, -0.007 * t * t, 0.008 * t * t)), (t) => 0.00042 * (1 - t * 0.75), 3, 4), 0, [0.86, 0.84, 0.8, 1], bi('snout'), SURF.whisker);
      }
    }
    // ---- legs + paws with toes
    const leg = (name, x, y, z, hind) => {
      const b = bi(name);
      const knee = new V3(x * 1.05, y * 0.45, z + (hind ? 0.012 : -0.004));
      const top = new V3(x, y, z);
      G.add(tubeGeo((t, out) => out.lerpVectors(top, knee, t), (t) => lerp(hind ? 0.0105 : 0.0078, 0.0048, t), 6, 2), 0, (p, n) => furColor(p, n), b, SURF.fur);
      const ankle = new V3(x * 1.08, 0.006, z + (hind ? 0.004 : -0.006));
      G.add(tubeGeo((t, out) => out.lerpVectors(knee, ankle, t), (t) => lerp(0.0044, 0.0031, t), 5, 2), 0, (p, n) => (p.y > 0.012 ? furColor(p, n) : PINK_D), b, SURF.skin);
      const pl = hind ? 0.013 : 0.0075;
      const pc = new V3(ankle.x, 0.0032, ankle.z - pl * 0.55);
      G.add(ellipsoidGeo(pc, 0.0042, 0.0024, pl * 0.65, 7, 5), 0, PINK, b, SURF.skin);
      const nToe = hind ? 5 : 4;
      for (let k = 0; k < nToe; k++) {
        const a = ((k / (nToe - 1)) - 0.5) * (hind ? 1.3 : 1.5);
        const d = new V3(Math.sin(a) * 0.7, -0.15, -Math.cos(a)).normalize();
        const o = new V3(pc.x + Math.sin(a) * 0.003, 0.0026, pc.z - pl * 0.55);
        G.add(tubeGeo((t, out) => out.copy(o).addScaledVector(d, t * (hind ? 0.0065 : 0.0052)), (t) => lerp(0.0011, 0.0006, t), 3, 1), 0, PINK, b, SURF.skin);
      }
    };
    leg('legFL', -0.019, 0.03, -0.044, false); leg('legFR', 0.019, 0.03, -0.044, false);
    leg('legHL', -0.025, 0.034, 0.046, true); leg('legHR', 0.025, 0.034, 0.046, true);
    // ---- tail (scaly rings)
    const tail = tubeGeo((t, out) => out.set(0, ratTailY(t), 0.082 + t * (TAIL_L + 0.004)), (t) => lerp(0.0058, 0.0011, Math.pow(t, 0.85)) * (1 + 0.07 * Math.max(0, Math.sin(t * 190))), 6, 26);
    G.add(tail, 0, (p, n, u, v) => {
      const ring = 0.86 + 0.14 * sstep(-0.3, 0.6, Math.sin(v * 190));
      const base = sstep(0.0, 0.06, v);
      const c = [lerp(FUR[0], TAIL[0], base), lerp(FUR[1], TAIL[1], base), lerp(FUR[2], TAIL[2], base)];
      const top = n.y > 0 ? 0.85 : 1; // darker on top
      return [c[0] * ring * top, c[1] * ring * top * 0.97, c[2] * ring * top * 0.96, 1];
    }, (p) => {
      const u = clamp((p.z - 0.086) / TAIL_L, 0, 1) * RAT_TAIL_N;
      const i = Math.min(RAT_TAIL_N - 1, Math.floor(u)), f = u - i;
      if (p.z < 0.086) return [[bi('hips'), 1 - sstep(0.075, 0.086, p.z)], [bi('tail0'), sstep(0.075, 0.086, p.z)]];
      return [[bi('tail' + i), 1 - f], [bi('tail' + (i + 1)), f]];
    }, SURF.tail);
    return G.build();
  });
}

// fur shell strands: alpha = strand height (cut by each shell's vertex alpha), rgb = lightness
function furShellTexture() {
  return cached('ratShellTex', () => {
    const S = 128, data = new Uint8Array(S * S * 4);
    const R = rng(4242);
    for (let n = 0; n < 1500; n++) {
      const cx = R.next() * S, cy = R.next() * S, r = R.range(0.7, 1.5), h = R.range(0.5, 1.0), l = R.range(150, 255);
      for (let y = Math.floor(cy - 2); y <= cy + 2; y++) for (let x = Math.floor(cx - 2); x <= cx + 2; x++) {
        const d = Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 0.6);
        if (d > r) continue;
        const i = (((y + S) % S) * S + ((x + S) % S)) * 4;
        const a = Math.round(h * 255 * (1 - 0.3 * d / r));
        if (a > data[i + 3]) { data[i] = data[i + 1] = data[i + 2] = l; data[i + 3] = a; }
      }
    }
    const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  });
}

function ratMaterials(variant) {
  return cached('ratMat' + variant, () => {
    const tint = [new THREE.Color(1, 1, 1), new THREE.Color(0.62, 0.6, 0.6), new THREE.Color(1.12, 1.02, 0.9)][variant];
    const T = synthOrFlat('critter_fur', {});
    const skin = surfaceMaterial('rat_skin' + variant, {
      color: tint, map: T.map, normalMap: T.normalMap, normalScale: new THREE.Vector2(0.8, 0.8),
      sheenColor: new THREE.Color(0.55, 0.5, 0.45), sheenRoughness: 0.5, clearcoatRoughness: 0.05,
    });
    const shell = new THREE.MeshStandardMaterial({ vertexColors: true, color: tint, map: furShellTexture(), alphaTest: 0.5, roughness: 0.92, metalness: 0 });
    shell.name = 'rat_fur_shell';
    return [skin, shell];
  });
}

export function buildRat(seed = 1) {
  const R = rng((seed * 9781 + 7) >>> 0 || 1);
  const root = new THREE.Group();
  root.name = 'Rat';
  const variant = ((seed % 3) + 3) % 3;
  const { mesh, B } = makeSkinned(ratGeometry(), ratMaterials(variant), RAT_BONES, 0.05);
  root.add(mesh);
  const sc = R.range(0.88, 1.12);
  mesh.scale.setScalar(sc);
  const st = { t: R.range(0, 100), phase: 0, run: 0, turn: 0, look: 0, lookT: 0, lookTarget: 0, sniff: 0, sniffT: 0, rear: 0, rearT: R.range(2, 6), rearS: 0, ear: [0, 0], earT: 0.5 };
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
    // idle behaviours: look around, sniff bursts, ear flicks, occasional rearing
    st.lookT -= dt;
    if (st.lookT <= 0) { st.lookTarget = R.range(-0.7, 0.7) * (1 - run); st.lookT = R.range(0.4, 2.0); }
    st.look += (st.lookTarget - st.look) * dk(12, dt);
    st.sniffT -= dt;
    if (st.sniffT <= 0) { st.sniff = st.sniff > 0.5 ? 0 : 1; st.sniffT = st.sniff ? R.range(0.4, 1.4) : R.range(0.3, 1.8); }
    st.rearT -= dt;
    if (st.rearT <= 0) { st.rear = st.rear > 0.5 || run > 0.3 ? 0 : 1; st.rearT = st.rear ? R.range(0.8, 1.6) : R.range(3, 8); }
    st.earT -= dt;
    if (st.earT <= 0) { st.earT = R.range(0.3, 2.5); st.ear[R.int(0, 1)] = R.range(-0.6, 0.6); }
    st.ear[0] *= Math.exp(-5 * dt); st.ear[1] *= Math.exp(-5 * dt);
    const rearAmt = run > 0.3 ? 0 : st.rear;
    const rearS = (st.rearS = lerp(st.rearS, rearAmt, dk(6, dt)));
    const breath = Math.sin(t * lerp(9, 16, run)) * 0.5 + 0.5;
    // body bound + flex
    const s1 = Math.sin(ph), c2 = Math.cos(ph * 2);
    B.body.position.copy(B.body.userData.rest);
    B.body.position.y += run * 0.006 * (1 - c2) * 0.5 + rearS * 0.012;
    B.body.rotation.set(-run * 0.05 * s1 - rearS * 0.35, 0, -st.turn * 0.12 * run);
    B.body.scale.set(1 + breath * 0.025 * (1 - run), 1 + breath * 0.02 * (1 - run), 1);
    B.chest.rotation.set(run * 0.22 * s1 - rearS * 0.25, st.turn * 0.3, 0);
    B.hips.rotation.set(-run * 0.2 * s1 + rearS * 0.35, -st.turn * 0.18, 0);
    const sniffOsc = st.sniff * (1 - run) * Math.sin(t * 48) * 0.05;
    B.head.rotation.set(-0.05 + sniffOsc + run * 0.08 * Math.sin(ph + 1) - rearS * 0.25, st.look + st.turn * 0.3, st.look * 0.2);
    B.snout.rotation.set(st.sniff * Math.sin(t * 52) * 0.08, Math.sin(t * 37) * 0.03 * st.sniff, 0);
    B.earL.rotation.set(-0.15 * run + st.ear[0], 0.2 * run, 0.1 * Math.sin(t * 3.1) * (1 - run));
    B.earR.rotation.set(-0.15 * run + st.ear[1], -0.2 * run, -0.1 * Math.sin(t * 2.7) * (1 - run));
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
