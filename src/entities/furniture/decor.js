// Lamps, plants and decor: floor lamp, swing-arm desk lamp, potted ficus / rubber plant,
// snake plant, planter divider, bentwood coat tree, desk globe.
import * as THREE from 'three';
import { def, Geo, boxGeo, cylGeo, latheGeo, tubeGeo, sphereGeo, cushionGeo, roundPath, quadGeo, CB, CC, CS, CP, CCbetween, CBbetween, CPbetween, V, toV, PI, TAU, HP, clamp, lerp, noise3 } from './core.js';
import { matFor, tint } from './mats.js';
import { rUV, regionKind } from './atlas.js';
import { screw, glide } from './parts.js';

// ---------------------------------------------------------------------------
// leaf cards: alpha-cut atlas leaves folded along the midrib and curled
// ---------------------------------------------------------------------------
function leafCard(L, W, fold, curl, R, rows = 3) {
  const g = new Geo();
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    for (let i = 0; i <= 2; i++) {
      const s = i - 1, x = s * W / 2;
      const y = -Math.abs(s) * W * fold * 0.5 - curl * L * t * t, z = L * t;
      g.v(x, y, z, 0, 1, 0, lerp(R.u0, R.u1, i / 2), lerp(R.v0, R.v1, t), 0);
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < 2; i++) { const a = j * 3 + i; g.quad(a, a + 3, a + 4, a + 1); }
  return g.computeNormals(false);
}
const _lq = new THREE.Quaternion(), _lz = new THREE.Vector3(0, 0, 1);
function addLeaf(b, g, at, dir, roll = 0, scale = 1) {
  const d = toV(dir).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(_lz, d);
  q.multiply(_lq.setFromAxisAngle(_lz, roll));
  const P = toV(at);
  b.put('leaf', g, P.x, P.y, P.z, { quat: q, scale, uvOff: false });
}

// terracotta / ceramic / plastic pot with rolled rim, soil, pebbles and a few fallen leaves
function potInto(b, slot, rTop, rBot, h, rng, o = {}) {
  const rim = o.rim ?? 0.014;
  b.lathe(slot, [[0, 0.004], [rBot - 0.008, 0.004, 1], [rBot - 0.002, 0.0], [rBot, 0.012], [rTop - 0.004, h - 0.035, 1], [rTop + rim * 0.6, h - 0.032], [rTop + rim, h - 0.024], [rTop + rim, h - 0.006], [rTop + rim * 0.5, h, 1], [rTop - 0.004, h - 0.002], [rTop - 0.012, h - 0.03]], 0, 0, 0, { seg: 28 });
  b.lathe('soil', [[0, h - 0.028], [rTop - 0.011, h - 0.03], [rTop - 0.012, h - 0.034]], 0, 0, 0, { seg: 20 });
  for (let i = 0; i < 9; i++) { const a = rng.next() * TAU, r = rng.next() * (rTop - 0.03); b.sphere('#8a8478', 0.006 + rng.next() * 0.006, Math.cos(a) * r, h - 0.03, Math.sin(a) * r, { ws: 6, hs: 4, scale: [1, 0.55, 1] }); }
  if (o.saucer) b.lathe(o.saucerSlot ?? slot, [[0, 0.0], [rBot + 0.03, 0.0, 1], [rBot + 0.036, 0.022], [rBot + 0.03, 0.024, 1], [rBot + 0.022, 0.006], [0, 0.006]], 0, 0, 0, { seg: 28 });
}

// ===========================================================================
// Potted ficus (braided trunk) or rubber plant, in a terracotta / plastic pot
// ===========================================================================
def('plant_pot', {
  variants: 3,
  geoVariant: (v) => (v === 1 ? 1 : 0),
  mats: (o, v) => ({ clay: matFor(v === 2 ? 'plastic_darkgrey' : 'clay') }),
  build(b, v, rng) {
    const h = 0.34, saucer = v !== 1;
    const lift = saucer ? 0.006 : 0;
    potInto(b, v === 1 ? 'plastic_white' : 'clay', 0.17, 0.13, h, rng, { saucer, saucerSlot: 'clay' });
    const ys = h - 0.03;
    if (v !== 1) {
      // ficus benjamina: braided trunks, drooping branches, lots of small leaves (some yellowing)
      const top = 1.02;
      for (let k = 0; k < 3; k++) {
        const pts = [];
        for (let i = 0; i <= 16; i++) { const t = i / 16, a = (k * TAU) / 3 + t * 5 * PI, r = 0.011 * (1 - t * 0.3); pts.push([Math.cos(a) * r, ys + t * (top - ys), Math.sin(a) * r]); }
        b.tube('bark', pts, (t) => 0.0095 - t * 0.0035, { radial: 6, caps: [false, true] });
      }
      const cells = [0, 1, 2, 0, 1, 3, 0, 1, 2, 4];
      const LG = cells.map((c) => leafCard(0.085, 0.04, 0.35, 0.18, rUV('leaf_ficus', c, 5, 1), 2));
      const nb = 13;
      for (let i = 0; i < nb; i++) {
        const a = (i / nb) * TAU + rng.next() * 0.5, y0 = top - 0.34 + rng.next() * 0.34;
        const len = 0.26 + rng.next() * 0.22, rise = 0.1 + rng.next() * 0.24;
        const dx = Math.cos(a), dz = Math.sin(a);
        const pts = [[0, y0, 0], [dx * len * 0.35, y0 + rise * 0.8, dz * len * 0.35], [dx * len * 0.75, y0 + rise, dz * len * 0.75], [dx * len, y0 + rise * 0.55, dz * len]];
        const path = roundPath(pts, 0.08, 3);
        b.tube('#5a4a38', path, (t) => 0.0045 - t * 0.0028, { radial: 5 });
        for (let k = 0; k < 24; k++) {
          const t = 0.18 + (k / 24) * 0.82;
          const fi = t * (path.length - 1), i0 = Math.floor(fi), i1 = Math.min(path.length - 1, i0 + 1);
          const at = path[i0].clone().lerp(path[i1], fi - i0);
          at.x += (rng.next() - 0.5) * 0.1; at.y += (rng.next() - 0.5) * 0.08; at.z += (rng.next() - 0.5) * 0.1;
          const dir = V(dx + (rng.next() - 0.5) * 1.6, -0.45 - rng.next() * 0.8, dz + (rng.next() - 0.5) * 1.6);
          addLeaf(b, LG[Math.floor(rng.next() * LG.length)], at, dir, (rng.next() - 0.5) * 1.5, 0.8 + rng.next() * 0.45);
        }
      }
      for (let k = 0; k < 60; k++) {
        const a = rng.next() * TAU, r = 0.04 + rng.next() * 0.2;
        addLeaf(b, LG[Math.floor(rng.next() * LG.length)], [Math.cos(a) * r, top - 0.1 + rng.next() * 0.38, Math.sin(a) * r], [Math.cos(a), -0.4 + rng.next() * 0.6, Math.sin(a)], rng.next() * 3, 0.85 + rng.next() * 0.3);
      }
      // dropped leaves on the soil and the saucer
      for (let k = 0; k < 6; k++) { const a = rng.next() * TAU, r = rng.next() * 0.13; addLeaf(b, LG[9], [Math.cos(a) * r, ys + 0.004, Math.sin(a) * r], [Math.cos(a + 1), -0.05, Math.sin(a + 1)], rng.next() * 6, 0.9); }
      return {
        colliders: [CC(0.172, h - lift, 0, (h - lift) / 2 + lift, 0), CC(0.18, lift + 0.002, 0, (lift + 0.002) / 2, 0), CC(0.035, top - h, 0, (top + h) / 2, 0), CS(0.2, 0, top - 0.04, 0)],
        mass: 16, material: 'plastic', breakInto: ['plant_fiber', 'plant_fiber', 'dirt'],
      };
    }
    // rubber plant: 3 stems with big glossy leaves
    const RL = [leafCard(0.24, 0.12, 0.16, 0.16, rUV('leaf_rubber', 0, 2, 1), 4), leafCard(0.24, 0.12, 0.16, 0.16, rUV('leaf_rubber', 1, 2, 1), 4)];
    for (const [sx, sz, top, n] of [[0.02, 0.01, 1.05, 12], [-0.04, -0.03, 0.82, 9], [0.03, -0.04, 0.64, 6]]) {
      const pts = [[sx, ys, sz], [sx * 1.5, ys + (top - ys) * 0.5, sz * 1.5], [sx * 2.2, top, sz * 2.2]];
      b.tube('#5c5a3a', roundPath(pts, 0.2, 4), (t) => 0.012 - t * 0.005, { radial: 6 });
      for (let i = 0; i < n; i++) {
        const t = 0.25 + (i / n) * 0.75, y = ys + (top - ys) * t;
        const a = i * 2.4 + sx * 20;
        const at = [sx * (1 + t * 1.2) + Math.cos(a) * 0.04, y, sz * (1 + t * 1.2) + Math.sin(a) * 0.04];
        b.tube('#4f6a32', [[at[0] - Math.cos(a) * 0.04, y - 0.02, at[2] - Math.sin(a) * 0.04], at], 0.0035, { radial: 4 });
        addLeaf(b, RL[i % 2], at, [Math.cos(a), 0.55 - t * 0.6, Math.sin(a)], (rng.next() - 0.5) * 0.6, 0.85 + t * 0.3);
      }
      addLeaf(b, RL[0], [sx * 2.2, top, sz * 2.2], [0, 1, 0.1], 0, 0.5);
    }
    return {
      colliders: [CC(0.172, h, 0, h / 2, 0), CC(0.03, 0.6, 0, h + 0.3, 0), CS(0.18, 0, 0.82, 0)],
      mass: 15, material: 'plastic', breakInto: ['plant_fiber', 'plant_fiber', 'dirt'],
    };
  },
});

// sword leaf (sansevieria) with the 'snakeleaf' print
function swordLeaf(L, Wd, bend, twist, R, rows = 6) {
  const g = new Geo();
  for (let r = 0; r <= rows; r++) {
    const t = r / rows, w = (Wd / 2) * (t < 0.75 ? 1 - t * 0.2 : (1 - t) * 3.2), y = L * t, z = bend * t * t, tw = twist * t;
    for (const s of [-1, 0, 1]) { const x = s * w; g.v(x * Math.cos(tw), y, z + x * Math.sin(tw) + (s === 0 ? -0.004 : 0), 0, 0, 1, lerp(R.u0, R.u1, (s + 1) / 2), lerp(R.v0, R.v1, t), 0); }
  }
  for (let r = 0; r < rows; r++) { const a = r * 3; g.quad(a, a + 1, a + 4, a + 3); g.quad(a + 1, a + 2, a + 5, a + 4); }
  return g.computeNormals(false);
}
function snakeClump(b, rng, n, x0, z0, y0, hMin, hMax, spread) {
  const R = rUV('snakeleaf');
  for (let i = 0; i < n; i++) {
    const hh = hMin + rng.next() * (hMax - hMin);
    const g = swordLeaf(hh, hh * (0.15 + rng.next() * 0.05), ((0.04 + rng.next() * 0.08) * hh) / 0.3, (rng.next() - 0.5) * 1.4, R);
    const a = rng.next() * TAU;
    b.put('leaf', g, x0 + Math.cos(a) * spread * rng.next(), y0, z0 + Math.sin(a) * spread * rng.next(), { rot: [0, a, 0], uvOff: false });
  }
}

// ===========================================================================
// Snake plant in a glazed ceramic / terracotta pot
// ===========================================================================
def('plant_small', {
  variants: 2,
  mats: (o, v) => ({ ceramic: matFor(v ? 'clay' : 'ceramic') }),
  build(b, v, rng) {
    const h = 0.13, r = 0.075;
    b.lathe('ceramic', [[0, 0.003], [r - 0.012, 0.003, 1], [r - 0.006, 0.0], [r - 0.004, 0.01], [r, h - 0.012, 1], [r + 0.005, h - 0.01], [r + 0.005, h - 0.002], [r + 0.002, h, 1], [r - 0.005, h - 0.002], [r - 0.008, h - 0.02]], 0, 0, 0, { seg: 24 });
    b.lathe('soil', [[0, h - 0.016], [r - 0.008, h - 0.018], [r - 0.009, h - 0.022]], 0, 0, 0, { seg: 16 });
    snakeClump(b, rng, 9, 0, 0, h - 0.018, 0.18, 0.36, 0.03);
    return {
      colliders: [CC(r + 0.005, h, 0, h / 2, 0), CC(0.03, 0.2, 0, h + 0.1, 0)],
      mass: 1.6, material: 'plastic', breakInto: ['plant_fiber', 'dirt'],
    };
  },
});

// ===========================================================================
// Planter divider: wood / painted planter box with snake plants
// ===========================================================================
def('office_divider_plant', {
  variants: 2,
  mats: (o, v) => ({ teak: matFor(v ? 'paint_beige' : 'teak'), walnut: matFor(v ? 'plastic_black' : 'walnut') }),
  build(b, v, rng) {
    const W = 1.0, H = 0.4, D = 0.32, t = 0.018, mat = 'teak', cap = 'walnut';
    b.box(mat, W - 0.03, 0.05, D - 0.03, 0, 0.025, 0, { r: 0.004, grain: 'x' });
    for (const k of [-1, 1]) {
      b.box(mat, W, H - 0.04, t, 0, 0.04 + (H - 0.04) / 2, k * (D / 2 - t / 2), { r: 0.004, grain: 'x', wear: 0.012 });
      b.box(mat, t, H - 0.04, D - 2 * t, k * (W / 2 - t / 2), 0.04 + (H - 0.04) / 2, 0, { r: 0.004, grain: 'y', wear: 0.012 });
      b.box(cap, W + 0.012, 0.022, 0.042, 0, H + 0.002, k * (D / 2 - 0.015), { r: 0.006, seg: 2, grain: 'x', wear: 0.012 });
      b.box(cap, 0.042, 0.022, D + 0.012, k * (W / 2 - 0.015), H + 0.002, 0, { r: 0.006, seg: 2, grain: 'z', wear: 0.012 });
      b.box('#1d1b19', W - 0.06, 0.04, 0.03, 0, 0.02, k * (D / 2 - 0.04), { r: 0.002 });
    }
    b.box('soil', W - 2 * t, 0.02, D - 2 * t, 0, H - 0.03, 0, { r: 0.002 });
    for (let i = 0; i < 5; i++) snakeClump(b, rng, 9, (i - 2) * 0.18, (rng.next() - 0.5) * 0.06, H - 0.025, 0.35, 0.72, 0.06);
    return {
      colliders: [CB(W + 0.012, H + 0.013, D + 0.012, 0, (H + 0.013) / 2, 0), CB(0.8, 0.5, 0.1, 0, H + 0.25, 0)],
      mass: 32, material: 'wood', friction: 0.45, breakInto: ['plank', 'plank', 'plant_fiber', 'dirt'],
    };
  },
});

// ===========================================================================
// Floor lamp: weighted base, jointed pole, harp, finial, pleated shade, bulb, pull chain, cord.
// ===========================================================================
def('lamp_floor', {
  variants: 2,
  mats: (o, v) => ({ lamp_metal: matFor(v ? 'paint_black' : 'brass') }),
  build(b, v) {
    const met = 'lamp_metal';
    b.lathe(met, [[0, 0.003], [0.146, 0.003, 1], [0.152, 0.01], [0.148, 0.02], [0.13, 0.026], [0.07, 0.034], [0.03, 0.042], [0.022, 0.05], [0, 0.05]], 0, 0, 0, { seg: 32 });
    b.lathe('#1c1c1c', [[0, 0], [0.14, 0, 1], [0.14, 0.003, 1], [0, 0.003]], 0, 0, 0, { seg: 24 });
    b.cyl(met, 0.011, 1.36, 0, 0.73, 0, { seg: 12 });
    for (const y of [0.06, 0.52, 0.98, 1.41]) b.lathe(met, [[0.011, -0.012], [0.016, -0.01], [0.017, 0.0], [0.016, 0.01], [0.011, 0.012]], 0, y, 0, { seg: 14 });
    b.lathe('brass', [[0, 1.42], [0.016, 1.42], [0.02, 1.44], [0.02, 1.47], [0.014, 1.48], [0, 1.48]], 0, 0, 0, { seg: 14 });
    // harp + finial
    b.tube('brass', roundPath([[-0.075, 1.41, 0], [-0.075, 1.5, 0], [0, 1.655, 0], [0.075, 1.5, 0], [0.075, 1.41, 0]], 0.06, 6), 0.003, { radial: 6 });
    b.tube('brass', [[-0.075, 1.41, 0], [0.075, 1.41, 0]], 0.003, { radial: 6 });
    b.lathe('brass', [[0, 1.66], [0.012, 1.664], [0.014, 1.672], [0.008, 1.684], [0.004, 1.69], [0, 1.696]], 0, 0, 0, { seg: 12 });
    // pull chain
    for (let i = 0; i < 10; i++) b.sphere('brass', 0.0028, 0.022, 1.455 - i * 0.011, 0.0, { ws: 6, hs: 4 });
    b.cyl('brass', 0.005, 0.02, 0.022, 1.34, 0, { rt: 0.004, seg: 8 });
    b.named('bulb', 'bulb', latheGeo([[0, 0], [0.012, 0.004], [0.014, 0.02], [0.03, 0.05], [0.032, 0.07], [0.024, 0.094], [0, 0.103]], 16), 0, 1.475, 0, {});
    // pleated shade
    const sg = latheGeo([[0.22, 0], [0.142, 0.27]], 64, { uv: 'cyl' });
    for (let i = 0; i < sg.count; i++) { const x = sg.p[i * 3], z = sg.p[i * 3 + 2], a = Math.atan2(x, z), k = 1 + 0.024 * Math.cos(a * 36); sg.p[i * 3] = x * k; sg.p[i * 3 + 2] = z * k; }
    sg.computeNormals(false);
    b.named('shade', 'lampshade', sg, 0, 1.4, 0, {});
    b.tube('brass', Array.from({ length: 41 }, (_, i) => { const a = (i / 40) * TAU; return [Math.cos(a) * 0.22, 1.4, Math.sin(a) * 0.22]; }), 0.0032, { radial: 5, closed: true });
    b.tube('brass', Array.from({ length: 33 }, (_, i) => { const a = (i / 32) * TAU; return [Math.cos(a) * 0.142, 1.67, Math.sin(a) * 0.142]; }), 0.0032, { radial: 5, closed: true });
    b.tube('#1a1a1a', roundPath([[0, 0.03, -0.02], [0.02, 0.012, -0.1], [0.05, 0.004, -0.2], [0.04, 0.004, -0.32]], 0.05, 4), 0.0035, { radial: 6 });
    return {
      // octagon-ish shade (two crossed boxes) so a fallen lamp rests instead of rolling
      colliders: [CC(0.152, 0.05, 0, 0.025, 0), CC(0.014, 1.36, 0, 0.73, 0), CB(0.3, 0.27, 0.3, 0, 1.535, 0), CB(0.3, 0.27, 0.3, 0, 1.535, 0, 0, PI / 4, 0)],
      mass: 6, material: 'metal', angularDamping: 1.6, linearDamping: 0.3, breakInto: ['metal_tube', 'wire', 'glass_shard', 'fabric'],
      anchors: { light: [0, 1.52, 0] },
    };
  },
});

// ===========================================================================
// Swing-arm desk lamp: weighted base with switch, parallel rods with tension springs, knurled
// joint knobs, conical shade with a white reflector, bulb, cord.
// ===========================================================================
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
  for (let i = 0; i <= steps; i++) { const t = i / steps, a2 = t * turns * TAU; pts.push(A.clone().addScaledVector(dir, t * L).addScaledVector(N, Math.cos(a2) * r).addScaledVector(B, Math.sin(a2) * r)); }
  return pts;
}
def('lamp_desk', {
  variants: 3,
  mats: (o, v) => ({ frame: tint('paint_black', o.color ?? [0x222325, 0xc9bea0, 0x8a2a24][v]) }),
  build(b) {
    b.lathe('frame', [[0, 0.002], [0.08, 0.002, 1], [0.083, 0.01], [0.077, 0.03], [0.03, 0.036], [0.018, 0.04], [0, 0.04]], 0, 0, 0, { seg: 28 });
    b.lathe('#1c1c1c', [[0, 0], [0.078, 0, 1], [0.078, 0.002, 1], [0, 0.002]], 0, 0, 0, { seg: 20 });
    b.box('frame', 0.03, 0.026, 0.03, 0, 0.052, -0.02, { r: 0.006, seg: 2 });
    b.box('#c23a2a', 0.012, 0.006, 0.018, 0.045, 0.036, 0.03, { r: 0.002 });
    const P0 = [0, 0.058, -0.02], E = [0, 0.33, -0.1], Hd = [0, 0.39, 0.17];
    for (const s of [-1, 1]) {
      b.cylBetween('chrome', [s * 0.011, P0[1], P0[2]], [s * 0.011, E[1], E[2]], 0.0042, 0.0042, { seg: 8 });
      b.cylBetween('chrome', [s * 0.011, E[1], E[2]], [s * 0.011, Hd[1], Hd[2]], 0.0042, 0.0042, { seg: 8 });
    }
    b.tube('chrome', helixPts([0.0, 0.09, -0.05], [0.0, 0.28, -0.1], 0.006, 18, 5), 0.0012, { radial: 4, caps: false });
    b.tube('chrome', helixPts([0.0, 0.345, -0.07], [0.0, 0.38, 0.1], 0.005, 14, 5), 0.0011, { radial: 4, caps: false });
    for (const p of [P0, E, Hd]) {
      b.cyl('frame', 0.012, 0.034, p[0], p[1], p[2], { axis: 'x', seg: 14, bevel: 0.002 });
      for (const s of [-1, 1]) b.cyl('#1e1e1e', 0.009, 0.008, s * 0.021, p[1], p[2], { axis: 'x', seg: 12, bevel: 0.0015 });
    }
    const tilt = -0.55;
    const og = latheGeo([[0.078, 0, 2], [0.074, 0.02], [0.05, 0.1], [0.026, 0.13], [0.022, 0.15, 1], [0, 0.152]], 28, { uv: 'cyl' });
    const ig = latheGeo([[0.02, 0.145], [0.048, 0.1], [0.072, 0.02], [0.075, 0.002]], 28, { uv: 'cyl' });
    const hx = Hd[0], hy = Hd[1] - 0.14 * Math.cos(-tilt), hz = Hd[2] + 0.14 * Math.sin(-tilt);
    b.put('frame', og, hx, hy, hz, { rot: [tilt, 0, 0] });
    b.put('#efece2', ig, hx, hy, hz, { rot: [tilt, 0, 0] });
    b.named('bulb', 'bulb', sphereGeo(0.024, { ws: 12, hs: 8 }), hx, hy + 0.06 * Math.cos(-tilt), hz - 0.06 * Math.sin(-tilt), {});
    b.tube('#1a1a1a', roundPath([[0, 0.02, -0.07], [0, 0.006, -0.1], [0.02, 0.004, -0.13], [0.03, 0.004, -0.2]], 0.02, 4), 0.0028, { radial: 6 });
    return {
      // weighted base: the base collider is taller than the visual so the volume-weighted mass keeps the COM over the base
      colliders: [CC(0.083, 0.11, 0, 0.055, 0), CBbetween(P0, E, 0.024, 0.016), CBbetween(E, Hd, 0.024, 0.016), CC(0.042, 0.08, hx, hy + 0.06, hz - 0.02, tilt, 0, 0)],
      mass: 2.2, material: 'metal', angularDamping: 0.9, breakInto: ['metal_tube', 'spring', 'wire', 'glass_shard'],
      anchors: { light: [hx, hy + 0.03, hz] },
    };
  },
});

// ===========================================================================
// Bentwood coat tree: turned pole, four curved legs with rubber feet, brass hooks; geometry 1
// wears a fedora.
// ===========================================================================
def('coat_rack', {
  variants: 2,
  geoVariant: (v) => v,
  build(b, v) {
    b.lathe('walnut', [[0.03, 0.12], [0.033, 0.14], [0.023, 0.18], [0.02, 0.5], [0.022, 0.95], [0.02, 1.45], [0.027, 1.5], [0.021, 1.55], [0.022, 1.66], [0.031, 1.69], [0.023, 1.72], [0, 1.725]], 0, 0, 0, { seg: 14, swap: true, uv: 'cyl' });
    b.sphere('walnut', 0.033, 0, 1.75, 0, { ws: 14, hs: 10 });
    const L = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + PI / 4, c = Math.cos(a), s = Math.sin(a);
      const pts = roundPath([[c * 0.02, 0.24, s * 0.02], [c * 0.1, 0.16, s * 0.1], [c * 0.3, 0.026, s * 0.3]], 0.12, 5);
      b.tube('walnut', pts, (t) => 0.018 - t * 0.004, { radial: 9, caps: [false, true] });
      b.cyl('rubber', 0.019, 0.014, c * 0.3, 0.007, s * 0.3, { seg: 10, bevel: 0.003 });
      L.push(CPbetween([c * 0.06, 0.2, s * 0.06], [c * 0.3, 0.019, s * 0.3], 0.019));
    }
    for (let i = 0; i < 8; i++) {
      const up = i < 4, a = (i / 4) * TAU + (up ? 0 : PI / 4), c = Math.cos(a), s = Math.sin(a), y = up ? 1.62 : 1.42, l = up ? 0.15 : 0.11;
      b.tube('brass', roundPath([[c * 0.018, y, s * 0.018], [c * l * 0.75, y + 0.01, s * l * 0.75], [c * l, y + 0.07, s * l]], 0.04, 5), 0.0058, { radial: 7 });
      b.sphere('brass', 0.0095, c * l, y + 0.075, s * l, { ws: 8, hs: 6 });
      b.cyl('brass', 0.012, 0.006, c * 0.022, y, s * 0.022, { rot: [0, -a, HP], seg: 10 });
    }
    if (v === 1) {
      const hx = 0.15, hy = 1.72, hz = 0;
      b.lathe('felt_hat', [[0, -0.004], [0.15, -0.004], [0.16, 0.002], [0.15, 0.01], [0.09, 0.012], [0.088, 0.03], [0.083, 0.1], [0.06, 0.112], [0.03, 0.105], [0, 0.11]], hx, hy, hz, { rot: [0.2, 0, -0.35], seg: 24 });
      b.lathe('#1a1a1a', [[0.0905, 0.012], [0.0895, 0.035]], hx, hy, hz, { rot: [0.2, 0, -0.35], seg: 24 });
    }
    return {
      colliders: [CC(0.024, 1.62, 0, 0.92, 0), ...L, CS(0.05, 0, 1.72, 0)],
      mass: 7, material: 'wood', breakInto: ['plank', 'plank', 'screws'],
      anchors: { hook: [0.15, 1.69, 0] },
    };
  },
});

// ===========================================================================
// Desk globe: turned wooden base, brass meridian, tilted globe.
// ===========================================================================
def('globe', {
  build(b) {
    const yc = 0.25, R = 0.15, tilt = 0.41;
    b.lathe('walnut', [[0, 0.002], [0.1, 0.002, 1], [0.103, 0.016], [0.086, 0.03], [0.036, 0.042], [0.022, 0.06], [0, 0.062]], 0, 0, 0, { seg: 28 });
    const sg = sphereGeo(R, { ws: 32, hs: 20 });
    const Rg = rUV('globe');
    for (let i = 0; i < sg.count; i++) { sg.uv[i * 2] = lerp(Rg.u0, Rg.u1, sg.uv[i * 2] / (TAU * R)); sg.uv[i * 2 + 1] = lerp(Rg.v1, Rg.v0, sg.uv[i * 2 + 1] / (PI * R)); }
    regionKind('globe', 'g');
    b.put('atlas', sg, 0, yc, 0, { rot: [0, 0.8, -tilt], uvOff: false });
    const mr = R + 0.012;
    const mer = [];
    for (let i = 0; i <= 24; i++) { const a = -HP + (i / 24) * PI; mer.push(V(Math.cos(a) * mr, Math.sin(a) * mr, 0).applyEuler(new THREE.Euler(0, 0, -tilt)).add(V(0, yc, 0))); }
    b.tube('brass', mer, [0.0045, 0.0022], { radial: 6 });
    const south = mer[0], north = mer[24];
    b.tube('brass', roundPath([[0, 0.06, 0], [0, 0.085, 0], [south.x * 0.5, south.y - 0.01, 0], [south.x, south.y, 0]], 0.03, 4), 0.006, { radial: 7 });
    for (const p of [south, north]) b.sphere('brass', 0.008, p.x, p.y, p.z, { ws: 8, hs: 6 });
    return { colliders: [CS(R, 0, yc, 0), CC(0.1, 0.06, 0, 0.032, 0)], mass: 1.4, material: 'plastic', breakInto: ['plastic_scrap', 'plank', 'metal_scrap'] };
  },
});
