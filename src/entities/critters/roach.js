// Critters — American cockroach (~4 cm). ONE draw call, ~530 triangles, shared geometry:
// segmented abdomen, two overlapping veined wing covers (tegmina), pronotum shield with its pale
// rim, tucked head with kidney eyes, very long antennae, six legs (femur / spiny tibia / tarsus)
// and cerci. Glossy chitin via the shared surface material (clear-coat per vertex).
// update(dt, { speed }): tripod gait skitter, body bob, sweeping + nervous antennae, leg twitches.
import * as THREE from 'three';
import { TAU, V3, clamp, lerp, sstep, dk, noise1, cached, latheGeo, tubeGeo, CritterGeo, makeBones, makeSkinned, surfaceMaterial, canvasTexture, rng } from './kit.js';

const ROACH_LEGS = [
  // side, attach z, foot offset (x, z) relative to attach, length scale
  { s: -1, z: -0.011, fx: 0.016, fz: -0.013, L: 0.8 },
  { s: 1, z: -0.011, fx: 0.016, fz: -0.013, L: 0.8 },
  { s: -1, z: -0.004, fx: 0.023, fz: 0.002, L: 1.0 },
  { s: 1, z: -0.004, fx: 0.023, fz: 0.002, L: 1.0 },
  { s: -1, z: 0.003, fx: 0.023, fz: 0.025, L: 1.25 },
  { s: 1, z: 0.003, fx: 0.023, fz: 0.025, L: 1.25 },
];
const ROACH_BONES = [
  { name: 'body', parent: null, pos: [0, 0.007, 0] },
  { name: 'head', parent: 'body', pos: [0, 0.006, -0.021] },
  { name: 'antL0', parent: 'head', pos: [-0.0016, 0.0062, -0.0255] },
  { name: 'antL1', parent: 'antL0', pos: [-0.011, 0.009, -0.043] },
  { name: 'antR0', parent: 'head', pos: [0.0016, 0.0062, -0.0255] },
  { name: 'antR1', parent: 'antR0', pos: [0.011, 0.009, -0.043] },
  ...ROACH_LEGS.map((l, i) => ({ name: 'leg' + i, parent: 'body', pos: [l.s * 0.004, 0.005, l.z] })),
];

// sRGB palette
const CHITIN = [0.4, 0.17, 0.06], DARK = [0.13, 0.06, 0.025], RIM = [0.78, 0.56, 0.26], WING = [0.52, 0.24, 0.09], LEG = [0.36, 0.17, 0.07];
const GLOSS = [0.26, 1.0, 0.0, 0], GLOSS_W = [0.2, 1.0, 0.0, 0], MATTE = [0.5, 0.4, 0.0, 0];
const PLAIN_UV = () => [0.78, 0.5];

function roachAtlas() {
  // left half: wing venation (longitudinal veins + cross veins); right half: plain white
  return canvasTexture('roachAtlas', 128, 64, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e8d8c8'; ctx.fillRect(0, 0, w / 2, h);
    ctx.strokeStyle = 'rgba(60,25,8,0.55)'; ctx.lineWidth = 1;
    for (let i = 0; i < 9; i++) { const x = 3 + i * 7; ctx.beginPath(); ctx.moveTo(x, 0); ctx.bezierCurveTo(x + 2, h * 0.3, x - 2, h * 0.7, x + 1, h); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(60,25,8,0.3)';
    for (let i = 0; i < 26; i++) { const y = (i * 37) % h, x = (i * 13) % (w / 2 - 6); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 6, y + 2); ctx.stroke(); }
  });
}

function roachGeometry() {
  return cached('roachGeo', () => {
    const { index: bi } = makeBones(ROACH_BONES);
    const G = new CritterGeo(1);
    const body = bi('body');
    // abdomen (segmented, visible below and at the sides of the wings)
    const ab = latheGeo((u) => {
      const z = lerp(0.025, -0.008, u);
      const env = Math.sin(Math.PI * clamp(u * 1.05, 0, 1)) ** 0.6;
      const seg = 1 - 0.08 * Math.max(0, Math.sin(u * Math.PI * 7));
      return { z, y: 0.0062, rx: 0.0098 * env * seg, ry: 0.0042 * env * seg, flat: 0.5 };
    }, 7, 7);
    G.add(ab, 0, (p) => { const ring = 0.85 + 0.15 * Math.sin(p.z * 700); return [DARK[0] * ring * 1.4, DARK[1] * ring * 1.4, DARK[2] * ring * 1.4]; }, body, GLOSS, PLAIN_UV);
    // wing covers: two flattened half-domes, the left lapping over the right
    for (const s of [-1, 1]) {
      const g = new THREE.SphereGeometry(1, 8, 4, 0, TAU, 0, Math.PI / 2);
      const P = g.attributes.position, U = g.attributes.uv;
      for (let i = 0; i < P.count; i++) {
        const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
        P.setXYZ(i, s * 0.0011 + x * 0.0068, 0.0079 + y * (s < 0 ? 0.0033 : 0.0029), 0.0085 + z * 0.0196);
        U.setXY(i, clamp(0.25 + x * 0.24, 0.01, 0.49), clamp(0.5 + z * 0.5, 0, 1));
      }
      g.computeVertexNormals();
      G.add(g, 0, (p) => {
        const tip = sstep(0.0, 0.026, p.z);
        const edge = sstep(0.0045, 0.0068, Math.abs(p.x - s * 0.0011));
        return [lerp(WING[0], WING[0] * 0.7, tip) * (1 - edge * 0.25), lerp(WING[1], WING[1] * 0.7, tip) * (1 - edge * 0.3), lerp(WING[2], WING[2] * 0.7, tip) * (1 - edge * 0.3)];
      }, body, GLOSS_W);
    }
    // pronotum shield: dark centre blotch, pale rim
    {
      const g = new THREE.SphereGeometry(1, 9, 3, 0, TAU, 0, Math.PI / 2);
      g.scale(0.0099, 0.0029, 0.0074);
      g.translate(0, 0.0088, -0.0138);
      G.add(g, 0, (p) => {
        const r = Math.hypot(p.x / 0.0099, (p.z + 0.0138) / 0.0074);
        const rim = sstep(0.62, 0.86, r);
        const blot = sstep(0.55, 0.2, Math.hypot(p.x / 0.0099 * 1.6, (p.z + 0.0128) / 0.0074 * 1.2));
        const c = [lerp(CHITIN[0], DARK[0], blot), lerp(CHITIN[1], DARK[1], blot), lerp(CHITIN[2], DARK[2], blot)];
        return [lerp(c[0], RIM[0], rim), lerp(c[1], RIM[1], rim), lerp(c[2], RIM[2], rim)];
      }, body, GLOSS, PLAIN_UV);
    }
    // head (tucked under the shield) with dark kidney eyes painted in
    {
      const g = new THREE.SphereGeometry(1, 6, 4);
      g.scale(0.0037, 0.0035, 0.0031);
      g.translate(0, 0.0055, -0.0222);
      G.add(g, 0, (p) => {
        const eye = sstep(0.0022, 0.003, Math.abs(p.x)) * sstep(0.004, 0.0062, p.y);
        return [lerp(CHITIN[0] * 0.8, 0.02, eye), lerp(CHITIN[1] * 0.8, 0.015, eye), lerp(CHITIN[2] * 0.8, 0.01, eye)];
      }, bi('head'), GLOSS, PLAIN_UV);
    }
    // cerci
    for (const s of [-1, 1]) {
      const o = new V3(s * 0.0025, 0.0058, 0.0245);
      G.add(tubeGeo((t, out) => out.copy(o).add(new V3(s * 0.0028 * t, -0.0008 * t, 0.006 * t)), (t) => 0.00065 * (1 - 0.8 * t), 3, 1), 0, DARK, body, MATTE, PLAIN_UV);
    }
    // antennae (two bones each, gently arched)
    for (const s of [-1, 1]) {
      const S = s < 0 ? 'L' : 'R';
      const a0 = new V3(s * 0.0016, 0.0062, -0.0255), a1 = new V3(s * 0.011, 0.009, -0.043), a2 = new V3(s * 0.031, 0.0075, -0.064);
      G.add(tubeGeo((t, out) => out.lerpVectors(a0, a1, t).add(new V3(0, 0.0012 * Math.sin(t * Math.PI), 0)), (t) => lerp(0.00042, 0.00032, t), 3, 2), 0, DARK, bi('ant' + S + '0'), MATTE, PLAIN_UV);
      G.add(tubeGeo((t, out) => out.lerpVectors(a1, a2, t).add(new V3(0, 0.0032 * Math.sin(t * Math.PI), 0)), (t) => 0.00032 * (1 - 0.7 * t), 3, 4), 0, DARK, bi('ant' + S + '1'), MATTE, PLAIN_UV);
    }
    // legs: femur up-out to the knee, spiny tibia down to the ground, tarsus along the floor
    ROACH_LEGS.forEach((l, i) => {
      const b = bi('leg' + i);
      const a = new V3(l.s * 0.004, 0.0052, l.z);
      const knee = new V3(l.s * (0.004 + l.fx * 0.45), 0.01, l.z + l.fz * 0.42);
      const ankle = new V3(l.s * (0.004 + l.fx * 0.88), 0.0011, l.z + l.fz * 0.88);
      const toe = new V3(l.s * (0.004 + l.fx * 1.12), 0.0004, l.z + l.fz * 1.14 + (l.fz === 0.002 ? 0.003 : 0));
      G.add(tubeGeo((t, out) => out.lerpVectors(a, knee, t), (t) => lerp(0.0012, 0.0009, t) * l.L ** 0.3, 3, 2), 0, LEG, b, GLOSS, PLAIN_UV);
      G.add(tubeGeo((t, out) => out.lerpVectors(knee, ankle, t), (t) => lerp(0.0008, 0.0005, t), 3, 2), 0, (p) => [LEG[0] * 0.75, LEG[1] * 0.75, LEG[2] * 0.75], b, GLOSS, PLAIN_UV);
      G.add(tubeGeo((t, out) => out.lerpVectors(ankle, toe, t), (t) => 0.00038 * (1 - 0.5 * t), 3, 1), 0, DARK, b, MATTE, PLAIN_UV);
    });
    return G.build();
  });
}

function roachMaterial() {
  return surfaceMaterial('roach', { map: roachAtlas(), sheen: 0, clearcoatRoughness: 0.05 });
}

export function buildCockroach(seed = 1) {
  const R = rng((seed * 5113 + 3) >>> 0 || 1);
  const root = new THREE.Group();
  root.name = 'Cockroach';
  const { mesh, B } = makeSkinned(roachGeometry(), roachMaterial(), ROACH_BONES, 0.03);
  mesh.castShadow = false; // a 4 cm bug's shadow is a few pixels; skip the shadow pass
  root.add(mesh);
  const sc = R.range(0.85, 1.15);
  mesh.scale.setScalar(sc);
  const legs = ROACH_LEGS.map((_, i) => B['leg' + i]);
  const st = { t: R.range(0, 50), phase: 0, run: 0, tw: [0, 0, 0, 0], twT: 0, legTw: new Float32Array(6) };

  function update(dt, p = {}) {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    const speed = clamp(Number.isFinite(p.speed) ? p.speed : 0, 0, 3);
    st.t += dt;
    const t = st.t;
    st.run += (sstep(0.005, 0.06, speed) - st.run) * dk(14, dt);
    const freq = speed > 0.003 ? clamp(speed / (0.026 * sc), 2, 18) : 0;
    st.phase += freq * dt * TAU;
    const run = st.run, ph = st.phase;
    // tripod gait: {L1, R2, L3} vs {R1, L2, R3}
    for (let i = 0; i < 6; i++) {
      const l = ROACH_LEGS[i];
      const tri = (i === 0 || i === 3 || i === 4) ? 0 : Math.PI;
      const a = ph + tri;
      st.legTw[i] *= Math.exp(-10 * dt);
      const L = legs[i];
      // swing fore/aft around Y, lift the tip by rolling around Z
      L.rotation.set(0, l.s * Math.sin(a) * 0.42 * run + st.legTw[i], l.s * Math.max(0, Math.cos(a)) * 0.35 * run);
    }
    B.body.position.copy(B.body.userData.rest);
    B.body.position.y += run * 0.0006 * Math.abs(Math.sin(ph));
    B.body.rotation.set(0.02 * Math.sin(t * 0.7) * (1 - run), run * 0.04 * Math.sin(ph), run * 0.05 * Math.sin(ph));
    // antennae: slow sweeping + nervous twitches
    st.twT -= dt;
    if (st.twT <= 0) {
      st.twT = R.range(0.08, 0.6);
      const k = R.int(0, 3);
      st.tw[k] += R.range(-0.6, 0.6);
      if (run < 0.2 && R.next() < 0.3) st.legTw[R.int(0, 5)] += R.range(-0.4, 0.4);
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
