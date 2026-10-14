// Utility & small props: waste basket, traffic cone, wet-floor sign, drum, mop bucket, water jug,
// fire extinguisher, step ladder, pipe, broom, mop, vent grille, hand truck, tyre, cinder block,
// ceiling tile, paper cone cup, mug, rubber duck, basketball.
import * as THREE from 'three';
import { def, Geo, boxGeo, cylGeo, latheGeo, tubeGeo, sphereGeo, cushionGeo, extrudeGeo, roundPath, quadGeo, CB, CC, CS, CP, CCbetween, CBbetween, CPbetween, V, toV, PI, TAU, HP, clamp, lerp, noise3, fbm3 } from './core.js';
import { matFor, tint } from './mats.js';
import { rUV } from './atlas.js';
import { screw, glide, caster } from './parts.js';
import { rrShape, rrPath } from './electronics.js';

const ring = (r, y, n = 32) => Array.from({ length: n + 1 }, (_, i) => { const a = (i / n) * TAU; return [Math.cos(a) * r, y, Math.sin(a) * r]; });

// crumpled paper ball
function crumpleGeo(r, rng, amt = 0.38, squash = 0.85) {
  const g = sphereGeo(r, { ws: 9, hs: 7 });
  const k = new Map();
  for (let i = 0; i < g.count; i++) {
    const key = `${g.p[i * 3].toFixed(4)},${g.p[i * 3 + 1].toFixed(4)},${g.p[i * 3 + 2].toFixed(4)}`;
    if (!k.has(key)) k.set(key, 1 + (rng.next() - 0.5) * amt);
    const s = k.get(key);
    g.p[i * 3] *= s; g.p[i * 3 + 1] *= s * squash; g.p[i * 3 + 2] *= s;
  }
  return g.computeNormals(true);
}

// ===========================================================================
// Office waste basket: black wire-mesh (geometry 0) or moulded plastic (geometry 1), with litter
// ===========================================================================
def('trash_can', {
  variants: 4,
  geoVariant: (v) => v % 2,
  build(b, gv, rng) {
    const h = 0.3, rt = 0.14, rb = 0.115;
    if (gv === 0) {
      b.lathe('wiremesh', [[rb, 0.008], [rt, h - 0.004]], 0, 0, 0, { seg: 32, uv: 'cyl' });
      b.lathe('paint_black', [[0, 0], [rb + 0.002, 0, 1], [rb + 0.003, 0.006], [rb, 0.009], [0, 0.009]], 0, 0, 0, { seg: 28 });
      b.tube('paint_black', ring(rt + 0.001, h - 0.002), 0.0048, { radial: 6, closed: true });
      b.tube('paint_black', ring(rb + 0.002, 0.009), 0.004, { radial: 6, closed: true });
      b.tube('paint_black', ring(lerp(rb, rt, 0.2) + 0.001, 0.065), 0.0025, { radial: 4, closed: true });
    } else {
      b.lathe('plastic_grey', [[0, 0.004], [rb - 0.01, 0.004, 1], [rb - 0.004, 0.0], [rb, 0.01], [rt, h - 0.018, 1], [rt + 0.008, h - 0.012], [rt + 0.009, h - 0.004], [rt + 0.004, h, 1], [rt - 0.004, h - 0.004], [rt - 0.006, h - 0.02], [rb - 0.006, 0.014], [0, 0.012]], 0, 0, 0, { seg: 32 });
    }
    const balls = gv ? [[0.03, 0.06, 0.02, 0.05], [-0.04, 0.055, -0.03, 0.045], [0.02, 0.14, -0.02, 0.05], [-0.03, 0.21, 0.03, 0.045], [0.04, 0.26, 0.0, 0.05]] : [[0.02, 0.06, 0.03, 0.05], [-0.04, 0.06, -0.02, 0.045], [0.01, 0.25, 0.0, 0.055]];
    for (const [x, y, z, r] of balls) b.put('paper', crumpleGeo(r, rng), x, y, z, { rot: [rng.next() * 3, rng.next() * 3, 0] });
    b.cyl('#b8291f:g', 0.033, 0.12, 0.03, 0.18, 0.05, { rot: [0.6, 0, 0.3], seg: 14, bevel: 0.004 });
    b.lathe('paper2', [[0.001, 0], [0.025, 0.08], [0.027, 0.083]], -0.035, 0.1, 0.02, { rot: [0.55, 0, 0.35], seg: 12, uv: 'cyl' });
    return {
      colliders: [CC(rt + 0.004, h, 0, h / 2, 0)],
      mass: gv ? 1.8 : 1.3, material: gv ? 'plastic' : 'metal', breakInto: ['wire', 'wire', 'paper'],
      anchors: { inside: [0, 0.1, 0] },
    };
  },
});

// ===========================================================================
// Traffic cone: PVC cone with reflective collars on a square rubber base
// ===========================================================================
def('traffic_cone', {
  variants: 1,
  build(b, v) {
    const rr = (y) => 0.135 - (y - 0.035) * (0.103 / 0.665);
    const base = boxGeo(0.36, 0.034, 0.36, { r: 0.012, seg: 2, wear: 0.02 });
    base.deform((q) => { q.y += (q.y > 0 ? -1 : 0) * (Math.abs(q.x) + Math.abs(q.z)) * 0.008; }, false);
    b.put('rubber', base, 0, 0.017, 0);
    b.lathe('rubber', [[0.172, 0.032], [0.155, 0.044], [0.142, 0.05]], 0, 0, 0, { seg: 28 });
    b.lathe('plastic_orange', [[rr(0.035), 0.035], [rr(0.69), 0.69, 1], [0.034, 0.7], [0.03, 0.706, 1], [0.024, 0.69]], 0, 0, 0, { seg: 28 });
    for (const [y0, y1] of [[0.33, 0.43], [0.5, 0.575]]) b.lathe('reflect', [[rr(y0) + 0.0018, y0], [rr(y1) + 0.0018, y1]], 0, 0, 0, { seg: 28, uv: 'cyl' });
    b.decal('stain', 0.1, 0.12, 0.05, 0.2, rr(0.2) + 0.002, { rot: [0.15, 0, 0] });
    return {
      colliders: [CB(0.36, 0.034, 0.36, 0, 0.017, 0), CC(rr(0.33), 0.3, 0, 0.184, 0), CC(rr(0.63), 0.37, 0, 0.519, 0)],
      mass: 2.5, material: 'plastic', breakInto: ['plastic_scrap', 'rubber'],
    };
  },
});

// ===========================================================================
// A-frame wet floor sign: two moulded panels with handle cut-outs, hinge pin, rubber feet
// ===========================================================================
def('wet_floor_sign', {
  build(b) {
    const w = 0.15, L = 0.62, r = 0.05;
    const sh = new THREE.Shape();
    sh.moveTo(-w, -L); sh.lineTo(w, -L); sh.lineTo(w * 0.86, -r); sh.quadraticCurveTo(w * 0.84, 0, w * 0.84 - r, 0); sh.lineTo(-w * 0.84 + r, 0); sh.quadraticCurveTo(-w * 0.84, 0, -w * 0.86, -r); sh.closePath();
    sh.holes.push(rrPath(0.12, 0.032, 0.014, 0, -0.05));
    const th = 0.2, top = L * Math.cos(th) + 0.006;
    const cols = [];
    for (const s of [1, -1]) {
      const rx = -s * th, zo = s * 0.007;
      b.ext('plastic_yellow', sh, 0.008, 0, top, zo, { rot: [rx, 0, 0], bevel: 0.002, bevelSeg: 2, curveSeg: 6 });
      const e = new THREE.Euler(rx, 0, 0);
      const c = V(0, -0.33, s * 0.0068).applyEuler(e).add(V(0, top, zo));
      b.decal('wetfloor', 0.25, 0.5, c.x, c.y, c.z, { rot: [rx, s > 0 ? 0 : PI, 0] });
      for (const fx of [-0.12, 0.12]) { const f = V(fx, -L + 0.01, 0).applyEuler(e).add(V(0, top, zo)); b.box('rubber', 0.05, 0.02, 0.026, f.x, f.y, f.z, { r: 0.004, rot: [rx, 0, 0] }); }
      const m = V(0, -L / 2, 0).applyEuler(e).add(V(0, top, zo));
      cols.push(CB(0.3, L, 0.014, m.x, m.y, m.z, rx, 0, 0));
    }
    b.cyl('#3b3b3b:m', 0.006, 0.25, 0, top - 0.01, 0, { axis: 'x', seg: 8 });
    // feet sit exactly on the floor: lowest rubber foot corner
    return { colliders: cols, mass: 1.3, material: 'plastic', breakInto: ['plastic_scrap', 'plastic_scrap'] };
  },
});

// ===========================================================================
// 55-gal plastic drum: rolling hoops, chime, two bungs, NFPA label, scuffs
// ===========================================================================
def('barrel', {
  variants: 3,
  mats: (o, v) => ({ drum: tint('plastic_blue', o.color ?? [0x24539a, 0x2f6b4a, 0x2a4a80][v]) }),
  build(b, gv) {
    b.lathe('drum', [[0, 0.012], [0.255, 0.012, 1], [0.27, 0.0, 1], [0.287, 0.004], [0.29, 0.03, 1], [0.29, 0.27], [0.302, 0.285], [0.302, 0.305], [0.29, 0.32], [0.29, 0.56], [0.302, 0.575], [0.302, 0.595], [0.29, 0.61], [0.29, 0.86, 1], [0.287, 0.885], [0.27, 0.892, 1], [0.255, 0.878, 1], [0, 0.875]], 0, 0, 0, { seg: 36 });
    for (const [x, r] of [[0.17, 0.034], [-0.17, 0.022]]) {
      b.cyl('drum', r + 0.006, 0.006, x, 0.878, 0.0, { seg: 16, bevel: 0.002 });
      b.cyl('#e6e3d8', r, 0.014, x, 0.885, 0.0, { seg: 16, bevel: 0.002 });
      for (let k = 0; k < 6; k++) b.box('#e6e3d8', 0.006, 0.012, 0.004, x + Math.cos(k) * r, 0.885, Math.sin(k) * r, { r: 0.001, rot: [0, -k, 0] });
    }
    b.cylDecal('barrel_label', 0.2915, 0.2, 0, 0.95, 0, 0.44, 0, {});
    b.decal('stain', 0.25, 0.25, 0.05, 0.8795, -0.05, { rot: [-HP, 0, 0] }); b.cylDecal('waterstain', 0.2916, 0.3, 2.2, 1.1, 0, 0.2, 0, {});
    return {
      colliders: [CC(0.293, 0.892, 0, 0.446, 0)],
      mass: 15, material: 'plastic', breakInto: ['plastic_scrap', 'plastic_scrap', 'plastic_scrap'],
      anchors: { top: [0, 0.892, 0] },
    };
  },
});

// ===========================================================================
// Mop bucket with side-press wringer on casters
// ===========================================================================
def('bucket', {
  variants: 2,
  mats: (o, v) => ({ plastic_yellow: tint('plastic_yellow', o.color ?? (v ? 0xd8a820 : 0xf0c020)) }),
  build(b, v) {
    const g = boxGeo(0.36, 0.27, 0.44, { r: 0.05, seg: 2, wear: 0.01 });
    g.taper(1, -0.135, 0.135, 0.88, 1);
    b.put('plastic_yellow', g, 0, 0.075 + 0.135, 0);
    for (const s of [-1, 1]) {
      b.box('plastic_yellow', 0.39, 0.035, 0.03, 0, 0.36, s * 0.225, { r: 0.01, seg: 2 });
      b.box('plastic_yellow', 0.03, 0.035, 0.45, s * 0.18, 0.36, 0, { r: 0.01, seg: 2 });
    }
    b.box(v ? '#57594a:g' : '#6e6a52:g', 0.335, 0.004, 0.415, 0, 0.35, 0, { r: 0 });
    b.box('plastic_yellow', 0.1, 0.03, 0.06, 0, 0.365, 0.245, { r: 0.012 });
    b.box('plastic_yellow', 0.38, 0.035, 0.46, 0, 0.065, 0, { r: 0.012, seg: 2 });
    for (const [x, z] of [[-0.15, -0.18], [0.15, -0.18], [-0.15, 0.18], [0.15, 0.18]]) caster(b, x, z, x * 10 + z * 3, 0.05, { r: 0.024, stem: 'chrome', seg: 10 });
    b.box('#85888a:g', 0.3, 0.14, 0.17, 0, 0.44, -0.11, { r: 0.02, seg: 2, wear: 0 });
    b.box('#1d1d1d', 0.22, 0.006, 0.05, 0, 0.511, -0.08, { r: 0.002 });
    b.box('#85888a:g', 0.32, 0.05, 0.05, 0, 0.385, -0.11, { r: 0.01 });
    b.tube('chrome', roundPath([[0.17, 0.45, -0.06], [0.17, 0.92, -0.17], [-0.17, 0.92, -0.17], [-0.17, 0.45, -0.06]], 0.06, 5), 0.011, { radial: 8 });
    b.cyl('#1b1b1d:g', 0.017, 0.24, 0, 0.92, -0.17, { axis: 'x', seg: 14, bevel: 0.004 });
    for (const s of [-1, 1]) b.cyl('chrome', 0.018, 0.02, s * 0.165, 0.45, -0.06, { axis: 'x', seg: 12 });
    b.decal('janitor', 0.16, 0.08, 0, 0.21, 0.2235, { rot: [-0.1, 0, 0] });
    return {
      colliders: [CB(0.38, 0.33, 0.46, 0, 0.205, 0), CB(0.3, 0.14, 0.17, 0, 0.44, -0.11), CBbetween([0, 0.5, -0.08], [0, 0.93, -0.17], 0.36, 0.03), CB(0.36, 0.04, 0.4, 0, 0.02, 0)],
      mass: 6.5, material: 'plastic', friction: 0.15, breakInto: ['plastic_scrap', 'plastic_scrap', 'wheel', 'metal_tube'],
    };
  },
});

// ===========================================================================
// 5-gallon water bottle (full or empty)
// ===========================================================================
def('water_jug', {
  variants: 2,
  geoVariant: (v) => v,
  build(b, v) {
    const prof = [[0, 0.004], [0.1, 0.004], [0.128, 0.018], [0.135, 0.04], [0.135, 0.095], [0.129, 0.105], [0.135, 0.115], [0.135, 0.2], [0.129, 0.21], [0.135, 0.22], [0.135, 0.31], [0.128, 0.35], [0.1, 0.395], [0.055, 0.432], [0.034, 0.445], [0.031, 0.475]];
    b.lathe('jug', prof, 0, 0, 0, { seg: 28 });
    b.lathe('plastic_blue', [[0.0315, 0.462], [0.035, 0.466], [0.035, 0.495], [0.03, 0.5], [0, 0.5]], 0, 0, 0, { seg: 18 });
    b.tube('plastic_blue', ring(0.034, 0.47, 18), 0.003, { radial: 4, closed: true });
    if (v === 0) b.lathe('water', [[0, 0.008], [0.098, 0.008], [0.124, 0.02], [0.13, 0.04], [0.13, 0.31], [0.122, 0.345], [0.1, 0.37], [0, 0.371]], 0, 0, 0, { seg: 24 });
    b.cylDecal('jug_label', 0.1365, 0.075, 0, 3.4, 0, 0.158, 0, {});
    return {
      colliders: [CC(0.135, 0.352, 0, 0.18, 0), CC(0.034, 0.13, 0, 0.435, 0)],
      mass: v ? 0.8 : 19, material: 'plastic', breakInto: ['plastic_scrap', 'plastic_scrap'],
      renderOrder: { water: 1, jug: 2 },
    };
  },
});

// ===========================================================================
// ABC fire extinguisher: shell, valve, levers, pin & ring, gauge, hose & nozzle, label, tag
// ===========================================================================
def('fire_extinguisher', {
  build(b) {
    b.lathe('paint_red', [[0, 0.012], [0.058, 0.012, 1], [0.064, 0.022], [0.065, 0.045], [0.065, 0.36], [0.06, 0.392], [0.046, 0.412], [0.024, 0.423], [0.018, 0.428]], 0, 0, 0, { seg: 28 });
    b.lathe('#1b1b1d:g', [[0, 0], [0.067, 0, 1], [0.0675, 0.03, 1], [0.064, 0.034]], 0, 0, 0, { seg: 28 });
    b.cyl('chrome', 0.017, 0.03, 0, 0.44, 0, { rb: 0.019, seg: 14 });
    b.box('chrome', 0.034, 0.042, 0.05, 0, 0.475, 0, { r: 0.006, seg: 2 });
    b.box('#1f2022:g', 0.028, 0.009, 0.12, 0, 0.462, -0.065, { r: 0.003, rot: [-0.05, 0, 0] });
    b.box('#1f2022:g', 0.026, 0.009, 0.115, 0, 0.506, -0.058, { r: 0.003, rot: [0.22, 0, 0] });
    b.cyl('chrome', 0.018, 0.012, 0, 0.48, 0.03, { axis: 'z', seg: 18, bevel: 0.002 });
    b.decal('gauge', 0.03, 0.03, 0, 0.48, 0.0365, { slot: 'atlas' });
    b.tube('chrome', ring(0.011, 0, 12).map(([x, y, z]) => [0.03 + x * 0 , 0.488 + z, x]), 0.0018, { radial: 4, closed: true });
    b.cyl('chrome', 0.002, 0.05, 0.012, 0.488, 0.0, { axis: 'x', seg: 5 });
    b.decal('inspect_tag', 0.032, 0.056, 0.042, 0.45, 0.008, { rot: [0, 0.3, 0.1], slot: 'atlas' });
    b.tube('#19191a', roundPath([[-0.02, 0.47, 0], [-0.055, 0.47, 0.0], [-0.078, 0.42, 0.01], [-0.076, 0.26, 0.03], [-0.07, 0.15, 0.04]], 0.03, 5), 0.0075, { radial: 8 });
    b.cylBetween('#1b1b1d:g', [-0.07, 0.15, 0.04], [-0.068, 0.09, 0.045], 0.009, 0.013, { seg: 10 });
    b.tube('#1b1b1d:g', ring(0.0656, 0.2), 0.0035, { radial: 4, closed: true });
    b.cylDecal('ext_label', 0.0658, 0.19, 0.25, 2.2, 0, 0.225, 0, {});
    return {
      colliders: [CC(0.067, 0.43, 0, 0.215, 0), CB(0.035, 0.07, 0.12, 0, 0.48, -0.035)],
      mass: 6.5, material: 'metal', angularDamping: 0.9, breakInto: ['metal_scrap', 'metal_scrap', 'pipe'],
    };
  },
});

// ===========================================================================
// Aluminium step ladder: channel rails, ribbed steps, rear legs, spreader braces, top cap
// ===========================================================================
def('step_ladder', {
  build(b) {
    const FB = (s) => [s * 0.215, 0.025, 0.3], FT = (s) => [s * 0.17, 0.95, 0.02];
    const RB = (s) => [s * 0.2, 0.025, -0.33], RT = (s) => [s * 0.165, 0.93, -0.04];
    for (const s of [-1, 1]) {
      b.boxBetween('alu', FB(s), FT(s), 0.022, 0.065, { r: 0.003, wear: 0.01 });
      b.boxBetween('alu', RB(s), RT(s), 0.02, 0.04, { r: 0.003, wear: 0.01 });
      b.box('rubber', 0.032, 0.03, 0.078, s * 0.215, 0.015, 0.3, { r: 0.005 });
      b.box('rubber', 0.03, 0.03, 0.052, s * 0.2, 0.015, -0.33, { r: 0.005 });
      const a = [s * 0.205, 0.5, 0.3 - 0.5 * 0.295], c = [s * 0.19, 0.5, -0.33 + 0.5 * 0.31];
      const m = [(a[0] + c[0]) / 2, 0.47, (a[2] + c[2]) / 2];
      b.boxBetween('paint_dark', a, m, 0.006, 0.02, { r: 0.0015 });
      b.boxBetween('paint_dark', m, c, 0.006, 0.02, { r: 0.0015 });
      screw(b, '#a0a2a4', [m[0] + s * 0.004, m[1], m[2]], [s, 0, 0], 0.005, 'rivet');
    }
    for (const y of [0.24, 0.48, 0.72]) {
      const t = y / 0.95, z = 0.3 - t * 0.28 - 0.01, w = 2 * (0.215 - t * 0.045) - 0.022;
      b.box('alu', w, 0.022, 0.085, 0, y, z, { r: 0.003, grain: 'x', wear: 0.01 });
      for (const dz of [-0.025, 0, 0.025]) b.box('alu', w - 0.01, 0.004, 0.006, 0, y + 0.013, z + dz, { r: 0.0015 });
      for (const s of [-1, 1]) screw(b, '#a0a2a4', [s * (w / 2 + 0.012), y, z], [s, 0, 0], 0.0045, 'rivet');
    }
    for (const y of [0.22, 0.6]) { const t = y / 0.93; b.box('alu', 2 * (0.2 - t * 0.035) - 0.02, 0.025, 0.012, 0, y, -0.33 + t * 0.29, { r: 0.002, grain: 'x' }); }
    b.box('plastic_orange', 0.4, 0.035, 0.2, 0, 0.965, -0.005, { r: 0.01, seg: 2, wear: 0.012 });
    b.box('#5a2a0a', 0.3, 0.004, 0.1, 0, 0.983, -0.01, { r: 0.001 });
    for (const x of [-0.1, 0.0, 0.1]) b.cyl('#3a1a06', 0.012, 0.004, x, 0.9835, 0.06, { seg: 12 });
    b.decal('ladder_warn', 0.035, 0.0875, 0.215 - 0.72 * 0.047 + 0.0122, 0.8, 0.3 - 0.8 * 0.295, { rot: [0.29, HP, 0], slot: 'atlas' });
    return {
      colliders: [
        ...[-1, 1].flatMap((s) => [CPbetween([s * 0.215, 0.02, 0.3], [s * 0.17, 0.95, 0.02], 0.02), CPbetween([s * 0.2, 0.02, -0.33], [s * 0.165, 0.93, -0.04], 0.02)]),
        CB(0.4, 0.035, 0.2, 0, 0.965, -0.005), CBbetween([0, 0.2, 0.24], [0, 0.75, 0.08], 0.38, 0.03),
      ],
      mass: 6, material: 'metal', breakInto: ['metal_tube', 'metal_tube', 'metal_scrap', 'screws'],
      anchors: { step0: [0, 0.25, 0.22], step1: [0, 0.49, 0.15], step2: [0, 0.73, 0.08], top: [0, 0.98, 0] },
    };
  },
});

// ===========================================================================
// Steel pipe with threaded ends and a coupling (dark / rusted / galvanised)
// ===========================================================================
def('pipe', {
  variants: 3,
  geoVariant: (v) => (v === 1 ? 1 : 0),
  mats: (o, v) => ({ iron: matFor(['iron', 'rust', 'zinc'][v]) }),
  build(b, v) {
    const mat = v === 1 ? 'rust' : 'iron', ro = 0.03, ri = 0.025, L = 1.2;
    const yc = v === 1 ? ro : 0.038;
    const prof = [[ri, -L / 2, 1], [ro - 0.002, -L / 2, 1]];
    for (let i = 0; i <= 8; i++) prof.push([i % 2 ? ro : ro - 0.0018, -L / 2 + 0.004 + i * 0.005]);
    prof.push([ro, L / 2 - 0.045]);
    for (let i = 0; i <= 8; i++) prof.push([i % 2 ? ro - 0.0018 : ro, L / 2 - 0.044 + i * 0.005]);
    prof.push([ro - 0.002, L / 2, 1], [ri, L / 2, 1], [ri, -L / 2, 1]);
    b.lathe(mat, prof, 0, yc, 0, { rot: [0, 0, HP], seg: 18, uv: 'cyl' });
    if (v !== 1) b.lathe(mat, [[0.032, -0.035, 1], [0.037, -0.032], [0.038, -0.025, 1], [0.038, 0.025, 1], [0.037, 0.032], [0.032, 0.035, 1], [0.031, 0.035]], -(L / 2 - 0.025), yc, 0, { rot: [0, 0, HP], seg: 18 });
    if (v === 0) b.cylDecal('stain', ro + 0.0006, 0.1, 0, 2, 0.2, yc, 0, { rot: [0, 0, HP] });
    return {
      // capsule body rolls smoothly (no cylinder-edge rocking), so a dropped pipe settles and sleeps
      colliders: [CP(ro, L / 2 - ro, 0, yc, 0, 0, 0, HP), ...(v !== 1 ? [CC(0.038, 0.07, -(L / 2 - 0.025), yc, 0, 0, 0, HP)] : [])],
      mass: 6.5, material: 'metal', angularDamping: 2.0, linearDamping: 0.3, breakInto: ['pipe'],
      anchors: { grip: [0.2, yc, 0] },
    };
  },
});

// ===========================================================================
// Corn broom: lacquered handle, cap, stitched straw head
// ===========================================================================
def('broom', {
  build(b) {
    b.cyl('maple', 0.012, 1.06, 0, 0.36 + 0.53, 0, { seg: 12, swap: true });
    b.cyl('#b8291f:g', 0.0135, 0.05, 0, 1.43, 0, { seg: 12, bevel: 0.003 });
    b.tube('#c8ccce:m', ring(0.012, 1.47, 12).map(([x, y, z]) => [x, y + z * 0, z]), 0.0016, { radial: 4, closed: true });
    b.lathe('straw', [[0.035, 0.32], [0.03, 0.37], [0.016, 0.42], [0.012, 0.43]], 0, 0, 0, { seg: 14, uv: 'cyl' });
    for (const y of [0.345, 0.37, 0.4]) b.tube('#c8ccce:m', ring(y < 0.36 ? 0.034 : y < 0.38 ? 0.029 : 0.02, y, 16), 0.0025, { radial: 4, closed: true });
    const sh = new THREE.Shape();
    sh.moveTo(-0.055, 0.33);
    sh.quadraticCurveTo(-0.14, 0.18, -0.16, 0.02);
    for (let i = 0; i <= 16; i++) sh.lineTo(-0.16 + (i / 16) * 0.32, (i % 2 ? 0.0 : 0.012) + Math.sin((i / 16) * PI) * 0.008);
    sh.quadraticCurveTo(0.14, 0.18, 0.055, 0.33);
    sh.closePath();
    const g = extrudeGeo(sh, 0.05, { curveSeg: 6 });
    g.taper(1, 0.33, 0, 1, 0.45);
    for (let i = 0; i < g.count; i++) { g.p[i * 3] /= Math.max(0.45, 1 - (0.33 - g.p[i * 3 + 1]) / 0.33 * 0.55) || 1; }
    b.put('straw', g, 0, 0, 0, { uvOff: false });
    for (const [y, c] of [[0.27, '#a8302a'], [0.22, '#2a6a3a'], [0.17, '#a8302a']]) {
      const hw = 0.055 + ((0.33 - y) / 0.33) * 0.1, tz = 0.025 * (1 - ((0.33 - y) / 0.33) * 0.55);
      for (const s of [-1, 1]) b.box(c, hw * 2 - 0.01, 0.006, 0.003, 0, y, s * (tz + 0.001), { r: 0 });
    }
    return { colliders: [CC(0.013, 1.08, 0, 0.92, 0), CB(0.3, 0.3284, 0.05, 0, 0.1658, 0)], mass: 0.7, material: 'wood', breakInto: ['plank', 'plant_fiber'] };
  },
});

// ===========================================================================
// Wet mop: handle, clamp, cotton strands
// ===========================================================================
def('mop', {
  build(b, gv, rng) {
    b.cyl('maple', 0.0125, 1.3, 0, 0.15 + 0.65, 0, { seg: 12 });
    b.cyl('plastic_blue', 0.0145, 0.06, 0, 1.47, 0, { seg: 12, bevel: 0.003 });
    b.box('zinc', 0.13, 0.035, 0.05, 0, 0.135, 0, { r: 0.006, seg: 2 });
    b.box('paint_dark', 0.04, 0.05, 0.04, 0, 0.17, 0, { r: 0.006 });
    b.cyl('zinc', 0.006, 0.07, 0.04, 0.17, 0, { axis: 'z', seg: 8 });
    const head = cushionGeo(0.17, 0.1, 0.13, { r: 0.04, cell: 0.03, crown: 0, bulge: 0.01, wrinkle: 0.006, wrinkleFreq: 18, seed: 7 });
    b.put('mop_cotton', head.geo, 0, 0.068, 0);
    const n = 44;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rng.next() * 0.25, dx = Math.cos(a), dz = Math.sin(a);
      const x0 = dx * 0.05, z0 = dz * 0.04, y0 = 0.07 + rng.next() * 0.04;
      const len = 0.12 + rng.next() * 0.1;
      const pts = [[x0 * 0.6, y0 + 0.02, z0 * 0.6], [x0 + dx * 0.03, y0 - 0.03, z0 + dz * 0.03], [x0 + dx * len * 0.6, 0.016 + rng.next() * 0.012, z0 + dz * len * 0.55], [x0 + dx * len, 0.011, z0 + dz * len * 0.9]];
      b.tube('mop_cotton', roundPath(pts, 0.04, 2), 0.011, { radial: 5, caps: [false, 'round'] });
    }
    return { colliders: [CC(0.0125, 1.33, 0, 0.83, 0), CC(0.15, 0.128, 0, 0.066, 0)], mass: 1.5, material: 'fabric', breakInto: ['plank', 'fabric'] };
  },
});

// ===========================================================================
// Return-air vent grille: flanged frame, angled louvres, screws
// ===========================================================================
def('vent_grate', {
  variants: 2,
  mats: (o, v) => ({ paint_white: matFor(v ? 'rust' : 'paint_white') }),
  build(b, v) {
    const W = 0.4, H = 0.25, m = 'paint_white', y = H / 2;
    const fr = rrShape(W, H, 0.006, 0, 0);
    fr.holes.push(rrPath(W - 0.052, H - 0.052, 0.003, 0, 0));
    b.ext(m, fr, 0.01, 0, y, 0.01, { bevel: 0.002, bevelSeg: 1 });
    b.box('#0b0b0b', W - 0.05, H - 0.05, 0.002, 0, y, -0.014, { r: 0 });
    for (const s of [-1, 1]) { b.box(m, W - 0.05, 0.002, 0.028, 0, y + s * (H / 2 - 0.026), -0.002, { r: 0 }); b.box(m, 0.002, H - 0.05, 0.028, s * (W / 2 - 0.026), y, -0.002, { r: 0 }); }
    const n = 9;
    for (let i = 0; i < n; i++) b.box(m, W - 0.054, 0.026, 0.0016, 0, y - (H - 0.06) / 2 + (i + 0.5) * ((H - 0.06) / n), 0.003, { r: 0.0006, rot: [-0.75, 0, 0], grain: 'x' });
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) screw(b, v ? '#5a3a2a' : '#c8ccce', [sx * (W / 2 - 0.013), y + sy * (H / 2 - 0.013), 0.017], [0, 0, 1], 0.005, 'phillips');
    return { colliders: [CB(W + 0.004, H + 0.004, 0.034, 0, y, 0.0)], mass: 0.7, material: 'metal', breakInto: ['metal_scrap', 'screws'] };
  },
});

// ===========================================================================
// Two-wheel hand truck: tube frame, cross braces, toe plate, pneumatic wheels
// ===========================================================================
function wheelInto(b, x, y, z, rOut, width, hub) {
  const hw = width / 2, ri = rOut * 0.5;
  b.lathe('rubber', [[ri, -hw * 0.82], [rOut * 0.78, -hw], [rOut * 0.94, -hw * 0.9], [rOut, -hw * 0.5], [rOut, hw * 0.5], [rOut * 0.94, hw * 0.9], [rOut * 0.78, hw], [ri, hw * 0.82]], x, y, z, { rot: [0, 0, HP], seg: 28 });
  // tread grooves
  for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; b.box('#141414', width * 0.7, 0.003, 0.006, x, y + Math.cos(a) * rOut * 0.985, z + Math.sin(a) * rOut * 0.985, { r: 0, rot: [-a, 0, 0] }); }
  b.lathe(hub, [[0, -hw * 0.84], [ri * 1.02, -hw * 0.84, 1], [ri * 1.02, hw * 0.84, 1], [0, hw * 0.84]], x, y, z, { rot: [0, 0, HP], seg: 20 });
  b.cyl('#b8bcbe:m', ri * 0.35, width * 0.98, x, y, z, { axis: 'x', seg: 12 });
}
def('hand_truck', {
  variants: 2,
  mats: (o, v) => ({ frame: tint('paint_red', o.color ?? (v ? 0x2a2c30 : 0xa8291f)) }),
  build(b) {
    for (const s of [-1, 1]) b.tube('frame', roundPath([[s * 0.17, 0.02, 0.0], [s * 0.17, 0.25, -0.03], [s * 0.17, 1.15, -0.06]], 0.1, 5), 0.014, { radial: 10 });
    b.tube('frame', roundPath([[-0.17, 1.15, -0.06], [-0.14, 1.27, -0.07], [0.14, 1.27, -0.07], [0.17, 1.15, -0.06]], 0.06, 5), 0.014, { radial: 10 });
    b.cyl('#1b1b1d:g', 0.019, 0.2, 0, 1.27, -0.07, { axis: 'x', seg: 14, bevel: 0.004 });
    for (const y of [0.4, 0.7, 1.0]) b.cyl('frame', 0.01, 0.34, 0, y, -0.03 - ((y - 0.25) / 0.9) * 0.03, { axis: 'x', seg: 8 });
    b.box('steel', 0.38, 0.008, 0.2, 0, 0.004, 0.1, { r: 0.002, wear: 0.01 });
    b.box('steel', 0.38, 0.06, 0.008, 0, 0.03, 0.004, { r: 0.002 });
    for (const s of [-1, 1]) b.box('steel', 0.006, 0.04, 0.1, s * 0.13, 0.042, 0.06, { r: 0.001, rot: [0.35, 0, 0] });
    for (const s of [-1, 1]) b.boxBetween('frame', [s * 0.17, 0.2, -0.03], [s * 0.2, 0.13, -0.13], 0.02, 0.03, { r: 0.004 });
    b.cyl('#9a9da0:m', 0.009, 0.52, 0, 0.13, -0.13, { axis: 'x', seg: 10 });
    for (const s of [-1, 1]) wheelInto(b, s * 0.24, 0.13, -0.13, 0.13, 0.07, '#8e9194');
    return {
      colliders: [CB(0.38, 1.22, 0.05, 0, 0.66, -0.04), CB(0.38, 0.01, 0.2, 0, 0.005, 0.1), CC(0.13, 0.07, -0.24, 0.13, -0.13, 0, 0, HP), CC(0.13, 0.07, 0.24, 0.13, -0.13, 0, 0, HP)],
      mass: 13, material: 'metal', breakInto: ['metal_tube', 'metal_tube', 'wheel', 'wheel'],
      anchors: { handle: [0, 1.27, -0.07], nose: [0, 0.01, 0.1] },
    };
  },
});

// ===========================================================================
// Car tyre: profiled carcass, tread blocks, printed sidewall
// ===========================================================================
function ringStrip(r0, r1, segs, R, up) {
  const g = new Geo();
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * TAU, c = Math.cos(a), s = Math.sin(a);
    const u = lerp(R.u0, R.u1, up ? i / segs : 1 - i / segs);
    g.v(c * r0, 0, s * r0, 0, 1, 0, u, R.v0, 0);
    g.v(c * r1, 0, s * r1, 0, 1, 0, u, R.v1, 0);
  }
  for (let i = 0; i < segs; i++) { const a = i * 2; if (!up) g.quad(a, a + 1, a + 3, a + 2); else g.quad(a, a + 2, a + 3, a + 1); }
  return g.computeNormals(false);
}
def('tire', {
  variants: 1,
  build(b, v) {
    const R = 0.318, yc = R;
    const prof = [[0.2, -0.075], [0.205, -0.09], [0.24, -0.1], [0.285, -0.1], [0.302, -0.093], [0.31, -0.078], [0.312, -0.05], [0.312, 0.05], [0.31, 0.078], [0.302, 0.093], [0.285, 0.1], [0.24, 0.1], [0.205, 0.09], [0.2, 0.075], [0.195, 0.0], [0.2, -0.075]];
    b.lathe('rubber', prof, 0, yc, 0, { rot: [0, 0, HP], seg: 48 });
    const n = 44;
    for (let i = 0; i < n; i++) for (const side of [-1, 1]) {
      const a = ((i + (side > 0 ? 0.5 : 0)) / n) * TAU;
      const t = boxGeo(0.052, 0.008, 0.032, { r: 0, wear: 0 });
      t.translate(side * 0.032, R - 0.002, 0);
      b.put('rubber', t, 0, yc, 0, { rot: [a, 0, 0] });
    }
    if (v === 0) for (const up of [true, false]) {
      const rs = ringStrip(0.245, 0.272, 64, rUV('tire_text'), up);
      b.put('decal', rs, up ? 0.1012 : -0.1012, yc, 0, { rot: [0, 0, -HP] });
    }
    return { colliders: [CC(R + 0.0023, 0.2, 0, yc, 0, 0, 0, HP)], mass: 9, material: 'soft', angularDamping: 0.7, breakInto: ['rubber', 'rubber', 'wire'] };
  },
});

// ===========================================================================
// Concrete masonry unit with two cores
// ===========================================================================
def('cinder_block', {
  variants: 2,
  mats: (o, v) => ({ concrete: matFor(v ? 'concrete_dark' : 'concrete') }),
  build(b) {
    const sh = rrShape(0.39, 0.19, 0.004, 0, 0);
    for (const x of [-0.095, 0.095]) sh.holes.push(rrPath(0.13, 0.11, 0.015, x, 0));
    const g = extrudeGeo(sh, 0.182, { bevel: 0.003, bevelSeg: 1, curveSeg: 4 });
    g.deform((q) => { q.x += (noise3(q.x * 30, q.y * 30, q.z * 30, 4) - 0.5) * 0.002; q.y += (noise3(q.x * 30 + 7, q.y * 30, q.z * 30, 5) - 0.5) * 0.002; }, false);
    b.put('concrete', g, 0, 0.094, 0, { rot: [-HP, 0, 0] });
    return { colliders: [CB(0.396, 0.188, 0.196, 0, 0.094, 0)], mass: 14, material: 'stone', breakInto: ['rubble', 'rubble'] };
  },
});

// ===========================================================================
// Broken acoustic ceiling tile (sagging, water stained)
// ===========================================================================
def('ceiling_tile', {
  ao: false,
  variants: 2,
  build(b, v, rng) {
    const sh = new THREE.Shape();
    const jag = [[0.3, 0.05], [0.24, 0.085], [0.2, 0.15], [0.13, 0.16], [0.09, 0.23], [0.03, 0.245], [-0.01, 0.3]];
    sh.moveTo(-0.3, -0.3); sh.lineTo(0.3, -0.3);
    for (const [x, y] of jag) sh.lineTo(x + (rng.next() - 0.5) * 0.015, y + (rng.next() - 0.5) * 0.015);
    sh.lineTo(-0.3, 0.3); sh.closePath();
    const g = extrudeGeo(sh, 0.016, { curveSeg: 2, crease: 0.4 });
    b.put('acoustic', g, 0, 0.008, 0, { rot: [-HP, 0, 0] });
    b.decal('waterstain', 0.34, 0.34, -0.06, 0.0168, 0.06, { rot: [-HP, 0, rng.next() * 3] });
    return { colliders: [CB(0.6, 0.016, 0.35, 0, 0.008, 0.125), CB(0.26, 0.016, 0.25, -0.17, 0.008, -0.175)], mass: 0.35, material: 'cardboard', breakInto: ['fiber_board'] };
  },
});

// ===========================================================================
// Paper cone cup
// ===========================================================================
def('water_cooler_cup', {
  ao: false,
  build(b) {
    b.lathe('paper2', [[0.0008, 0], [0.034, 0.088], [0.0352, 0.09]], 0, 0, 0, { seg: 18, uv: 'cyl' });
    b.tube('paper', ring(0.0352, 0.09, 24), 0.0014, { radial: 4, closed: true });
    return { colliders: [CC(0.011, 0.03, 0, 0.015, 0), CC(0.023, 0.03, 0, 0.045, 0), CC(0.034, 0.03, 0, 0.075, 0)], mass: 0.004, material: 'paper', linearDamping: 0.6, angularDamping: 2.5, breakInto: ['paper'] };
  },
});

// ===========================================================================
// Ceramic coffee mug: thick rolled lip, D handle, glaze, printed logo, coffee / ring stain
// ===========================================================================
def('mug', {
  ao: false,
  variants: 3,
  geoVariant: (v) => (v === 1 ? 1 : 0),
  mats: (o, v) => ({ ceramic: tint('ceramic', o.color ?? [0xf1eee6, 0xe9e2cf, 0x3d6f6a][v]) }),
  build(b, v) {
    b.lathe('ceramic', [[0, 0.003], [0.034, 0.003, 1], [0.039, 0.007], [0.041, 0.02], [0.041, 0.09], [0.0408, 0.0938], [0.039, 0.0955], [0.037, 0.0948], [0.0362, 0.091], [0.0362, 0.014], [0.03, 0.01], [0, 0.0095]], 0, 0, 0, { seg: 28 });
    b.lathe('#c8c0b0', [[0, 0], [0.034, 0, 1], [0.034, 0.003, 1], [0, 0.003]], 0, 0, 0, { seg: 20 });
    const hp = roundPath([[0.039, 0.078, 0], [0.066, 0.08, 0], [0.068, 0.03, 0], [0.039, 0.028, 0]], 0.016, 6);
    b.tube('ceramic', hp, [0.0062, 0.0042], { radial: 8, up: [0, 0, 1] });
    if (v !== 1) b.cyl('#2a170c:g', 0.0362, 0.002, 0, 0.072, 0, { seg: 20 });
    else b.decal('stain', 0.06, 0.06, 0, 0.0108, 0, { rot: [-HP, 0, 0] });
    b.cylDecal('mug_logo', 0.0413, 0.05, 0, 1.7, 0, 0.052, 0, { cell: v ? 1 : 0, cols: 1, rows: 3 });
    if (!v) b.cylDecal('mug_logo', 0.0413, 0.05, PI, 1.7, 0, 0.052, 0, { cell: 2, cols: 1, rows: 3 });
    return { colliders: [CC(0.041, 0.096, 0, 0.048, 0), CB(0.03, 0.055, 0.012, 0.055, 0.054, 0)], mass: 0.35, material: 'glass', breakInto: ['ceramic_shard', 'ceramic_shard'] };
  },
});

// ===========================================================================
// Rubber duck
// ===========================================================================
def('rubber_duck', {
  ao: false,
  build(b) {
    const body = sphereGeo(0.05, { ws: 20, hs: 14 });
    body.deform((p) => { p.x *= 1.0; p.y *= 0.8; p.z *= 1.22; if (p.z < -0.03) p.y += (-0.03 - p.z) * 0.9; if (p.y < -0.02) p.y = -0.02 + (p.y + 0.02) * 0.4; }, true);
    b.put('plastic_yellow', body, 0, 0.028, 0);
    b.sphere('plastic_yellow', 0.035, 0, 0.098, 0.028, { ws: 16, hs: 12 });
    const beak = sphereGeo(0.018, { ws: 12, hs: 8 });
    beak.deform((p) => { p.x *= 1.25; p.y *= p.y > 0 ? 0.42 : 0.32; p.z *= 1.15; }, true);
    b.put('plastic_orange', beak, 0, 0.094, 0.062);
    for (const s of [-1, 1]) {
      b.sphere('#111111:g', 0.0058, s * 0.019, 0.11, 0.054, { ws: 8, hs: 6 });
      b.sphere('#ffffff:g', 0.0018, s * 0.0185, 0.112, 0.0595, { ws: 5, hs: 4 });
      const wing = sphereGeo(0.03, { ws: 10, hs: 8 });
      wing.deform((p) => { p.x *= 0.35; p.y *= 0.62; }, true);
      b.put('plastic_yellow', wing, s * 0.043, 0.044, -0.006, { rot: [0, 0, s * 0.3] });
    }
    return { colliders: [CC(0.046, 0.05, 0, 0.025, -0.004), CS(0.03, 0, 0.098, 0.028)], mass: 0.05, material: 'plastic', angularDamping: 0.6, breakInto: ['plastic_scrap'], floatOK: true };
  },
});

// ===========================================================================
// Basketball
// ===========================================================================
def('basketball', {
  ao: false,
  build(b) {
    const g = sphereGeo(0.12, { ws: 36, hs: 22 });
    for (let i = 0; i < g.count; i++) { g.uv[i * 2] /= TAU * 0.12; g.uv[i * 2 + 1] = 1 - g.uv[i * 2 + 1] / (PI * 0.12); }
    b.put('bball', g, 0, 0.12, 0, { rot: [0, 0, 0.2], uvOff: false });
    return { colliders: [CS(0.12, 0, 0.12, 0)], mass: 0.62, material: 'plastic', restitution: 0.75, breakInto: ['rubber'] };
  },
});
