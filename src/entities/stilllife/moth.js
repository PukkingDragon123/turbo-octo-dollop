// PALE MOTH — a cat-sized moth: a fuzzy cream thorax with a thick collar of scales, a ringed abdomen, big
// glossy black eyes, feathered antennae, a coiled proboscis and six thin legs. Four broad wings (double-sided,
// mottled dust-brown with dark eye spots and a pale fringe) on their own bones. Sculpted body + wing cloth.
// Animator modes: drift / orbit / graze (landed) / flee / warn / follow / idle; dead (wings flat, legs curled).
import * as THREE from 'three';
import { Sculpt, MAT } from './sdf.js';
import { PartSet, ClothSet } from './parts.js';
import { BoneSpec, assembleBody } from './rig.js';
import * as G from './geo.js';
import { RNG, TAU, clamp, lerp, lin, fbm3, smoothstep } from './core.js';
import { rot } from './anim.js';

const CREAM = 0xd2c5a0, DUST = 0xa8977a, DARK = 0x2e261c;

function bones() {
  const B = new BoneSpec();
  B.add('thorax', null, [0, 0, 0]);
  B.add('head', 'thorax', [0, 0.004, -0.055]);
  B.add('abd1', 'thorax', [0, -0.004, 0.045]);
  B.add('abd2', 'abd1', [0, -0.012, 0.1]);
  B.add('wL', 'thorax', [-0.03, 0.022, -0.02]);
  B.add('wR', 'thorax', [0.03, 0.022, -0.02]);
  B.add('hL', 'thorax', [-0.026, 0.016, 0.022]);
  B.add('hR', 'thorax', [0.026, 0.016, 0.022]);
  return B;
}

// a wing: a subdivided strip between its leading- and trailing-edge polylines (XZ, x outward from the root),
// cambered, mirrored by side (enough vertices for the painted scale pattern)
function wingGeo(lead, trail, side, root, camber, nu = 14, nv = 7) {
  const at = (pts, t) => { const f = t * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), u = f - i; return [lerp(pts[i][0], pts[i + 1][0], u), lerp(pts[i][1], pts[i + 1][1], u)]; };
  const pos = [], idx = [];
  for (let i = 0; i <= nu; i++) {
    const a = at(lead, i / nu), c = at(trail, i / nu);
    for (let j = 0; j <= nv; j++) {
      const v = j / nv, x = lerp(a[0], c[0], v), z = lerp(a[1], c[1], v);
      pos.push(root[0] + side * x, root[1] + Math.sin(Math.min(1, x / 0.3) * Math.PI) * camber * (1 - Math.abs(v - 0.4)) - x * 0.04, root[2] + z);
    }
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const k = i * (nv + 1) + j;
    if (side > 0) idx.push(k, k + 1, k + nv + 1, k + 1, k + nv + 2, k + nv + 1); else idx.push(k, k + nv + 1, k + 1, k + 1, k + nv + 1, k + nv + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function template() {
  const B = bones(), names = B.names;
  const S = new Sculpt(names);
  const r = new RNG(5);
  S.push({ mat: MAT.SUIT, col: CREAM, k: 0.02, dirt: 0.05, noise: [0.0025, 70] });
  S.ell([0, 0.002, -0.004], [0.04, 0.038, 0.052], null, { bone: 'thorax' });
  S.torus([0, 0.006, -0.042], 0.03, 0.014, [Math.PI / 2, 0, 0], { bone: 'thorax', k: 0.012, noise: [0.004, 60] }); // scale collar
  S.sphere([0, 0.006, -0.068], 0.026, { bone: 'head', k: 0.012 });
  // ringed abdomen
  for (let i = 0; i < 5; i++) {
    const z = 0.05 + i * 0.026, rr = 0.032 - i * 0.004;
    S.ell([0, -0.006 - i * 0.003, z], [rr, rr * 0.92, 0.018], null, { bone: i < 2 ? 'abd1' : 'abd2', col: i % 2 ? CREAM : DUST, k: 0.009 });
  }
  S.pop();
  // eyes: big glossy black domes
  for (const s of [-1, 1]) S.ell([s * 0.021, 0.008, -0.078], [0.016, 0.019, 0.017], null, { bone: 'head', mat: MAT.RUBBER, col: 0x0e0c0a, k: 0.006, wet: 0.6 });
  // proboscis coil + six thin legs
  const coil = [];
  for (let i = 0; i <= 8; i++) { const a = i * 0.7; coil.push([0, -0.018 - Math.sin(a) * 0.008 * (1 - i / 10), -0.088 + Math.cos(a) * 0.008 * (1 - i / 10) + i * 0.001]); }
  S.chain(coil, coil.map((_, i) => 0.0028 - i * 0.0002), { bone: 'head', mat: MAT.RUBBER, col: 0x4a3a2a, k: 0.002 });
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
    const z = -0.025 + k * 0.022;
    S.chain([[s * 0.02, -0.02, z], [s * 0.05, -0.03, z - 0.005 + k * 0.006], [s * 0.065, -0.075, z - 0.02 + k * 0.02]], [0.0032, 0.0026, 0.0015], { bone: 'thorax', mat: MAT.RUBBER, col: DARK, k: 0.002 });
  }
  S.prepare();
  const parts = new PartSet(names, S);
  // feathered antennae: shaft + barbs
  for (const s of [-1, 1]) {
    const a = new THREE.Vector3(s * 0.012, 0.026, -0.08), b2 = new THREE.Vector3(s * 0.07, 0.085, -0.18);
    const shaft = G.tube([a, a.clone().lerp(b2, 0.5).add(new THREE.Vector3(0, 0.01, 0)), b2], 0.0016, 4);
    parts.add(shaft, { color: 0x5a4a36, pbr: [0.6, 0, 0, 0.3], bone: 'head' });
    for (let k = 1; k < 9; k++) {
      const p = a.clone().lerp(b2, k / 9);
      for (const side of [-1, 1]) {
        const tip = p.clone().add(new THREE.Vector3(side * 0.012, 0.004, 0.006 * (1 - k / 9)));
        parts.add(G.tube([p, tip], 0.0007, 3, { capStart: false }), { color: 0x6a5a44, pbr: [0.7, 0, 0, 0.4], bone: 'head' });
      }
    }
  }
  // wings: dust-brown scales, darker veins, an eye spot on each, pale fringe
  const cloth = new ClothSet(names, S);
  const spotFn = (cx, cz, side) => (x, y, z, c) => {
    const lx = x * side;
    const d = Math.hypot(lx - cx, z - cz);
    const n = fbm3(x * 30, y * 30, z * 30, 3);
    if (d < 0.018) return lin(0x14100c);
    if (d < 0.03) return lin(0xe8d8b0);
    if (d < 0.038) return lin(0x5a4430);
    const fringe = smoothstep(0.26, 0.33, lx);
    const band = smoothstep(0.42, 0.5, Math.abs(Math.sin(lx * 38 + n * 3)));
    const base = lin(DUST);
    const k = 0.75 + n * 0.45 - band * 0.18;
    return [lerp(base[0] * k, 0.75, fringe * 0.5), lerp(base[1] * k, 0.7, fringe * 0.5), lerp(base[2] * k, 0.6, fringe * 0.5)].map((v) => v * (c[0] > 0 ? 1 : 1));
  };
  for (const s of [-1, 1]) {
    const fw = wingGeo([[0, -0.012], [0.1, -0.05], [0.2, -0.072], [0.3, -0.06], [0.36, -0.035]], [[0, 0.03], [0.08, 0.075], [0.18, 0.085], [0.28, 0.07], [0.345, 0.04]], s, [s * 0.03, 0.022, -0.02], 0.012);
    cloth.add(fw, { color: DUST, mat: MAT.SUIT, bone: s < 0 ? 'wL' : 'wR', ao: 0.95, dirt: 0.05, colorFn: spotFn(0.24, -0.02, s) });
    const hw = wingGeo([[0, 0], [0.08, -0.004], [0.16, 0.02], [0.22, 0.07]], [[0, 0.06], [0.04, 0.13], [0.11, 0.16], [0.2, 0.13]], s, [s * 0.026, 0.016, 0.022], 0.008);
    cloth.add(hw, { color: DUST, mat: MAT.SUIT, bone: s < 0 ? 'hL' : 'hR', ao: 0.9, dirt: 0.05, colorFn: spotFn(0.14, 0.12, s) });
  }
  void r; void TAU;
  const { geo, stats } = assembleBody([{ S, h: 0.0032, tris: 3600 }], { floor: 0, stains: 0, fade: 0, seed: 3 });
  return { spec: B, body: geo, parts: parts.build(), cloth: cloth.build(), bounds: new THREE.Sphere(new THREE.Vector3(0, 0, 0), 0.45), height: 0.16, radius: 0.3, stats, meta: { mat: 'fauna', smooth: true } };
}

// ============================================================================
export function animator(inst, tpl, seed) {
  const b = inst.byName, rest = inst.rest, bones = inst.bones;
  const rng = new RNG(seed * 4111 + 9);
  const st = { t: rng.next() * 20, ph: rng.next() * 6 };
  const reset = () => { for (let i = 0; i < bones.length; i++) { bones[i].position.copy(rest[i]); bones[i].quaternion.identity(); bones[i].scale.set(1, 1, 1); } };
  function update(dt, s) {
    dt = clamp(dt || 0, 0, 0.1);
    st.t += dt;
    reset();
    const mode = s.mode || 'drift';
    if (s.dead) {
      rot(b.wL, 0, 0, -0.12); rot(b.wR, 0, 0, 0.12); rot(b.hL, 0, 0.2, -0.1); rot(b.hR, 0, -0.2, 0.1);
      rot(b.abd1, 0.35, 0, 0); rot(b.abd2, 0.4, 0, 0);
      return;
    }
    const landed = mode === 'graze';
    const fast = mode === 'warn' || mode === 'flee' ? 1.7 : 1;
    st.ph += dt * (landed ? 2.2 : 15 * fast + Math.sin(st.t * 0.7) * 3);
    const flap = landed ? 0.1 + Math.sin(st.ph) * 0.12 : 0.2 + Math.sin(st.ph) * 0.95;
    const lag = landed ? 0 : Math.sin(st.ph - 0.6) * 0.85;
    rot(b.wL, 0, landed ? 0.35 : 0, flap); rot(b.wR, 0, landed ? -0.35 : 0, -flap);
    rot(b.hL, 0, landed ? 0.5 : 0, 0.15 + lag * 0.8); rot(b.hR, 0, landed ? -0.5 : 0, -0.15 - lag * 0.8);
    rot(b.thorax, landed ? 0 : -0.18 + Math.sin(st.ph) * 0.05, 0, Math.sin(st.t * 1.1) * 0.06);
    b.thorax.position.y += landed ? 0 : -Math.sin(st.ph) * 0.012;
    rot(b.abd1, Math.sin(st.t * 2.1) * 0.12, Math.sin(st.t * 1.3) * 0.1, 0);
    rot(b.abd2, Math.sin(st.t * 2.1 - 0.7) * 0.15, 0, 0);
    rot(b.head, Math.sin(st.t * 1.7) * 0.1, Math.sin(st.t * 1.2) * 0.25, 0);
  }
  return { update };
}
