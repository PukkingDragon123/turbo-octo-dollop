// Items for the survival loop: salvaged materials (stick, foam, glass shard, concrete chunk, bottles of water),
// hand-made tools (rag bandage, torch, sharpened stick, rock hammer), scrap tools and gear made at a workbench
// (saw, shiv knife, spear, hatchet, crossbow + bolts, lantern, backpack, water filter), shelter pieces (bedroll,
// workbench with its vise / soldering-kit upgrades, plank door, storage crate, camp cot, insulation pad), the
// radio parts (battery, antenna, tuning coil, amplifier) and the field notebook.
// Everything is chunky and a little crooked: made by hand from what was lying around.
//   torch        parts.flame, setLit(on)          lantern   parts.glow, setLit(on)
//   scrap_bench  parts.vise / parts.solder (shown by setTier(n)), anchors.top (bench-top centre)
//   plank_door   hinge on its local -X edge (anchors.hinge), handle on +X
//   stash_crate  parts.lid (hinged at the back edge), setOpen(f)
//   locked_cache parts.lid (axis x, maxOpen: animated by lootables.js), parts.lock, setLocked(on)
//   boarded_door 1.3 x 2.12 m of planks across a doorway (spawned frozen)
//   water_*      parts.liquid
import * as THREE from 'three';
import { Kit, def, PI, TAU, V3, clamp, extrudeGeo } from './core.js';
import { mat, clear, glow, S } from './mats.js';
import { flameGeos, flameMaterial, flicker } from './tools.js';
import { RNG } from '../../core/rng.js';

// ---------------------------------------------------------------------------- shared surfaces
const M = {
  wood: () => mat({ name: 'sv_wood', rough: 0.88, det: 'roughwood', detAlbedo: true, ns: 0.9 }),
  bark: () => mat({ name: 'sv_stick', color: 0xb08a5c, rough: 0.92, det: 'roughwood', detAlbedo: true, ns: 1.1 }),
  cloth: () => mat({ name: 'sv_cloth', color: 0xffffff, rough: 1, det: 'twill', ns: 1, sheen: 0.5, sheenColor: 0xffe0c8, sheenRough: 0.6 }),
  canvas: () => mat({ name: 'sv_canvas', color: 0xffffff, rough: 1, det: 'weave', ns: 1.2 }),
  foam: () => mat({ name: 'sv_foam', color: 0xe8c464, rough: 0.98, det: 'stipple', ns: 1.6 }),
  stone: () => mat({ name: 'sv_stone', color: 0x9c968a, rough: 0.95, det: 'cast', ns: 1.4 }),
  tape: () => mat({ name: 'sv_tape', color: 0xb9bdbb, rough: 0.5, metal: 0.2, det: 'film', ns: 0.6 }),
  paint: () => mat({ name: 'sv_paint', color: 0xffffff, rough: 0.7, metal: 0.1, det: 'powder', ns: 0.7 }),
  rust: () => mat({ name: 'sv_rust', color: 0x9a7a62, rough: 0.8, metal: 0.6, det: 'cast', ns: 0.9 }),
  paper: () => mat({ name: 'sv_paper', color: 0xf0e6cc, rough: 0.9, det: 'paper', ns: 0.6 }),
};
const GLASS = () => clear({ tint: 0x0c1614, rough: 0.08 });

// a slightly crooked stick along local Y (centred), radius r, length len
function stickGeo(k, len, r, mt, o = {}) {
  const rng = new RNG(o.seed ?? 3);
  const pts = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    pts.push([(rng.next() - 0.5) * (o.bend ?? 0.02), -len / 2 + t * len, (rng.next() - 0.5) * (o.bend ?? 0.02)]);
  }
  k.push({ p: o.p || [0, 0, 0], r: o.r || [0, 0, 0] });
  k.tube(pts, (t) => r * (1 - (o.taper ?? 0.15) * t) * (1 + Math.sin(t * 23) * 0.04), mt, { tseg: 14, rseg: 8, cap0: true, cap1: true, col: o.col ?? 0xffffff });
  k.pop();
}
// wraps of cloth / tape round a stick (local Y), centred at y
function wraps(k, y, r, n, mt, col, o = {}) {
  for (let i = 0; i < n; i++) k.torus(r, r * 0.22, mt, { p: [o.x ?? 0, y + (i - (n - 1) / 2) * r * 0.42, o.z ?? 0], r: [PI / 2 + (i % 2 ? 0.12 : -0.1), 0, 0], col, rseg: 6, tseg: 14 });
}
function rockGeo(r, seed) {
  const g = new THREE.IcosahedronGeometry(r, 1);
  const rng = new RNG(seed), p = g.attributes.position, v = V3();
  const sq = [1 + rng.next() * 0.3, 0.7 + rng.next() * 0.2, 0.9 + rng.next() * 0.3];
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, 0.82 + rng.next() * 0.3);
    v.multiplyScalar(seen.get(key)).multiply(V3(...sq));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// ============================================================================ materials
def('stick', () => {
  const k = new Kit();
  stickGeo(k, 0.46, 0.014, M.bark(), { seed: 7, bend: 0.03 });
  // a broken-off splinter at one end
  k.add(new THREE.ConeGeometry(0.009, 0.05, 5), M.wood(), { p: [0.004, 0.25, 0], r: [0, 0, 0.2], col: 0xe0c090 });
  k.colCap(0.016, 0.22, [0, 0, 0]);
  return { kit: k, meta: { mass: 0.3, material: 'wood', hold: { grip: [0, -0.08, 0], rot: [1.25, 0.2, 0] } } };
});

def('foam', () => {
  const k = new Kit();
  const rng = new RNG(11);
  k.rbox(0.2, 0.07, 0.15, 0.025, M.foam(), {
    rs: 2, col: 0xfff2c8,
    deform: (v) => { v.y += Math.sin(v.x * 40 + 1) * 0.004 + (rng.next() - 0.5) * 0.002; v.x *= 1 + Math.sin(v.z * 30) * 0.03; },
  });
  k.colBox([0.2, 0.07, 0.15]);
  return { kit: k, meta: { mass: 0.05, material: 'soft', hold: { grip: [0, 0, 0], rot: [0.6, 0.3, 0] }, restitution: 0.05, angularDamping: 0.9 } };
});

def('glass_shard', () => {
  const k = new Kit();
  const sh = new THREE.Shape([V3(0, 0), V3(0.06, 0.012), V3(0.035, 0.12), V3(0.012, 0.09)].map((p) => new THREE.Vector2(p.x, p.y)));
  k.add(extrudeGeo(sh, 0.005, 0.0012), GLASS(), { p: [-0.03, -0.06, 0] });
  k.add(extrudeGeo(sh, 0.0055, 0.0008), mat({ name: 'sv_glass_edge', color: 0x6a8a80, rough: 0.2, transparent: true, opacity: 0.35 }), { p: [-0.03, -0.06, -0.0002], s: [1.01, 1.01, 1] });
  k.colBox([0.06, 0.12, 0.008]);
  return { kit: k, meta: { mass: 0.06, material: 'glass', hold: { grip: [0, -0.03, 0], rot: [0.4, 0, 0.3] } } };
});

def('rock', () => {
  const k = new Kit();
  k.add(rockGeo(0.07, 5), M.stone(), { col: 0xd8d2c4, flat: true });
  // a stub of rebar poking out of the concrete
  k.cyl(0.005, 0.06, M.rust(), { p: [0.05, 0.02, 0], r: [0, 0, 1.2], seg: 6 });
  k.colBall(0.065);
  return { kit: k, meta: { mass: 1.4, material: 'stone', hold: { grip: [0, 0, 0], rot: [0.3, 0.4, 0] } } };
});

// ---------------------------------------------------------------------------- bottles (empty / dirty / clean)
function bottle(fill, col) {
  return () => {
    const k = new Kit();
    const prof = [[0, -0.1], [0.032, -0.1, 0.006], [0.034, 0.03, 0.01], [0.014, 0.075, 0.01], [0.012, 0.095], [0.013, 0.1], [0, 0.1]];
    k.lathe(prof, GLASS(), { seg: 20 });
    k.cyl(0.0135, 0.016, mat({ name: 'sv_cap', color: 0x3a6a8a, rough: 0.5, det: 'stipple' }), { p: [0, 0.106, 0], seg: 14 });
    // a scuffed paper label, half peeled
    k.cyl(0.0345, 0.05, M.paper(), { p: [0, -0.03, 0], seg: 20, open: true, phiLen: PI * 1.3, col: 0xe8dcc0 });
    if (fill > 0) {
      const top = -0.098 + 0.12 * fill;
      k.lathe([[0, -0.097], [0.03, -0.097, 0.004], [0.031, top], [0, top]], mat({ name: 'sv_water_' + col.toString(16), color: col, rough: 0.15, transparent: true, opacity: 0.72 }), { seg: 18, part: 'liquid' });
    }
    k.colCyl(0.034, 0.21);
    return { kit: k, meta: { mass: fill > 0 ? 0.55 : 0.05, material: 'plastic', hold: { grip: [0, -0.02, 0], rot: [0.15, 0.3, 0] } } };
  };
}
def('bottle', bottle(0, 0));
def('water_dirty', bottle(0.8, 0x6a6a3a));
def('water_clean', bottle(0.85, 0x9ad0e0));

// ============================================================================ hand-made
def('rag_bandage', () => {
  const k = new Kit();
  const C = M.cloth();
  k.cyl(0.03, 0.06, C, { seg: 14, col: 0xd8c8a8, deform: (v) => { v.x *= 1 + Math.sin(v.y * 90) * 0.04; v.z *= 1 + Math.cos(v.y * 70) * 0.04; } });
  k.add(new THREE.PlaneGeometry(0.05, 0.09, 2, 6), C, { p: [0.03, -0.04, 0.012], r: [0.2, 1.2, 0.3], col: 0xd0bc98, deform: (v) => { v.z += Math.sin(v.y * 40) * 0.006; } });
  k.colCyl(0.032, 0.06);
  return { kit: k, meta: { mass: 0.05, material: 'soft', hold: { grip: [0, 0, 0], rot: [0.4, 0.2, 0.1] } } };
});

def('torch', () => {
  const k = new Kit();
  const L = 0.5;
  // built along Z like the flare: head (burning end) at -Z
  k.push({ r: [PI / 2, 0, 0] });
  stickGeo(k, L, 0.016, M.bark(), { seed: 21, bend: 0.012 });
  k.pop();
  const C = M.cloth();
  for (let i = 0; i < 5; i++) k.torus(0.026, 0.012, C, { p: [0, 0, -L / 2 + 0.02 + i * 0.02], r: [0, i * 0.4, 0.15 * (i % 2 ? 1 : -1)], col: [0x6a4a30, 0x50382a, 0x7a5a3a][i % 3], rseg: 6, tseg: 14 });
  k.sphere(0.024, C, { p: [0, 0, -L / 2 + 0.005], col: 0x2a1c14 });
  flameGeos(k, flameMaterial(), [0, 0, -L / 2 - 0.01], 0.17, 0.045, 'flame', 0xd85a14, 0xffd090);
  k.colCap(0.03, 0.22, [0, 0, 0], [PI / 2, 0, 0]);
  k.anchor('tip', [0, 0, -L / 2 - 0.02]);
  return {
    kit: k,
    meta: {
      mass: 0.45, material: 'wood', hold: { grip: [0, 0, 0.12], rot: [1.15, 0.05, 0.05] },
      init(inst, opts) {
        const f = inst.parts.flame;
        inst.object.userData.setLit = (on) => { f.visible = !!on; };
        inst.object.userData.setLit(!!opts.lit);
        flicker(f, 1);
      },
    },
  };
});

def('sharp_stick', () => {
  const k = new Kit();
  stickGeo(k, 0.62, 0.015, M.bark(), { seed: 9, bend: 0.02, taper: 0.05 });
  // whittled point (pale fresh wood) + a few shavings of bark
  k.lathe([[0.0148, 0.31], [0.012, 0.36], [0.0015, 0.42], [0, 0.421]], M.wood(), { seg: 8, col: 0xf0d8a8 });
  wraps(k, -0.18, 0.017, 3, M.cloth(), 0x8a3a2a);
  k.colCap(0.018, 0.33, [0, 0.05, 0]);
  return { kit: k, meta: { mass: 0.4, material: 'wood', hold: { grip: [0, -0.18, 0], rot: [-1.45, 0, 0] } } };
});

def('rock_hammer', () => {
  const k = new Kit();
  stickGeo(k, 0.42, 0.016, M.bark(), { seed: 13, bend: 0.015 });
  k.add(rockGeo(0.055, 17), M.stone(), { p: [0, 0.2, 0], r: [0, 0, PI / 2], s: [1.3, 0.9, 0.9], col: 0xd0cabc, flat: true });
  // lashings of torn cloth round the head
  const C = M.cloth();
  for (let i = 0; i < 4; i++) k.torus(0.03, 0.007, C, { p: [0, 0.2 + (i - 1.5) * 0.012, 0], r: [PI / 2 + (i % 2 ? 0.6 : -0.6), 0, 0], col: 0x9a7a52, rseg: 5, tseg: 12 });
  k.colCap(0.018, 0.2, [0, -0.02, 0]);
  k.colBox([0.15, 0.09, 0.09], [0, 0.2, 0]);
  return { kit: k, meta: { mass: 1.3, material: 'stone', hold: { grip: [0, -0.15, 0], rot: [-1.35, 0, 0] } } };
});

def('bedroll', () => {
  const k = new Kit();
  const C = M.cloth(), F = M.foam();
  const W = 0.72, Lg = 1.8;
  k.rbox(W, 0.05, Lg, 0.022, F, { p: [0, 0.025, 0], col: 0xd8b860, rs: 2 });
  k.rbox(W + 0.02, 0.035, Lg - 0.1, 0.016, C, { p: [0, 0.06, 0.04], col: 0x8a4a3a, rs: 2, deform: (v) => { v.y += Math.sin(v.z * 7) * 0.006 + Math.sin(v.x * 11) * 0.004; } });
  // folded blanket at the foot, a stuffed pillow at the head
  k.rbox(W - 0.06, 0.09, 0.32, 0.04, C, { p: [0, 0.1, Lg / 2 - 0.24], col: 0x4a6a7a });
  k.rbox(0.5, 0.11, 0.26, 0.05, C, { p: [0, 0.11, -Lg / 2 + 0.2], col: 0xe0d6c0, deform: (v) => { v.y *= 1 - Math.abs(v.x) * 1.2; } });
  k.colBox([W, 0.1, Lg], [0, 0.05, 0]);
  return { kit: k, meta: { mass: 6, material: 'fabric', friction: 0.9 } };
});

// ============================================================================ workbench (scrap) + upgrades
const BENCH = { L: 1.25, D: 0.6, TY: 0.84 };
def('scrap_bench', () => {
  const k = new Kit();
  const W = M.wood(), B = M.bark(), T = M.tape(), rng = new RNG(4);
  const { L, D, TY } = BENCH;
  // top: three mismatched planks, screwed down
  for (let i = 0; i < 3; i++) {
    const z = (i - 1) * (D / 3), h = 0.035 + i * 0.004;
    k.rbox(L - i * 0.04, h, D / 3 - 0.012, 0.006, W, { p: [rng.range(-0.02, 0.02), TY - h / 2, z], r: [0, rng.range(-0.02, 0.02), 0], dU: 'x', col: [0xf2dcb8, 0xd8b88a, 0xe8cca0][i] });
    for (const sx of [-1, 1]) k.cyl(0.005, 0.004, S.steelDark(), { p: [sx * (L / 2 - 0.08), TY + 0.001, z], seg: 6 });
  }
  // four stick legs, splayed a little, with braces and tape at the joints
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (L / 2 - 0.1), z = sz * (D / 2 - 0.07);
    stickGeo(k, TY - 0.03, 0.022, B, { seed: 30 + sx * 3 + sz, bend: 0.01, p: [x + sx * 0.02, (TY - 0.03) / 2, z + sz * 0.015], r: [sz * 0.04, 0, -sx * 0.04] });
    wraps(k, TY - 0.1, 0.026, 2, T, 0xc8ccc8, { x: x + sx * 0.01, z });
  }
  for (const sz of [-1, 1]) stickGeo(k, L - 0.16, 0.014, B, { seed: 50 + sz, p: [0, 0.22, sz * (D / 2 - 0.06)], r: [0, 0, PI / 2] });
  // lower shelf: an offcut of board
  k.rbox(L - 0.3, 0.02, D - 0.2, 0.004, W, { p: [0, 0.23, 0], col: 0xc8a878 });
  // tier 2: a blue cast vise bolted to the front-left corner
  const VM = mat({ name: 'sv_vise', color: 0x4a6a8a, rough: 0.55, det: 'cast', ns: 0.7 });
  const vx = -L / 2 + 0.17, vz = D / 2 - 0.08;
  k.rbox(0.14, 0.05, 0.18, 0.012, VM, { p: [vx, TY + 0.025, vz - 0.05], part: 'vise' });
  k.rbox(0.13, 0.1, 0.05, 0.012, VM, { p: [vx, TY + 0.08, vz - 0.09], part: 'vise' });
  k.rbox(0.13, 0.09, 0.05, 0.012, VM, { p: [vx, TY + 0.075, vz + 0.01], part: 'vise' });
  k.cyl(0.009, 0.16, S.chrome(), { p: [vx, TY + 0.06, vz + 0.07], r: [PI / 2, 0, 0], seg: 10, part: 'vise' });
  k.cyl(0.006, 0.16, S.chrome(), { p: [vx, TY + 0.06, vz + 0.15], r: [0, 0, PI / 2], seg: 8, part: 'vise' });
  // tier 3: a soldering station at the back right (iron in its coil stand, a reel of solder, a car battery)
  const BAT = mat({ name: 'sv_battery', color: 0x26282a, rough: 0.5, det: 'stipple' });
  const sx0 = L / 2 - 0.26, sz0 = -D / 2 + 0.14;
  k.rbox(0.22, 0.13, 0.15, 0.01, BAT, { p: [sx0, TY + 0.065, sz0], part: 'solder' });
  k.lathe([[0, 0], [0.011, 0], [0.01, 0.018], [0, 0.018]], S.copper(), { p: [sx0 - 0.06, TY + 0.13, sz0], seg: 10, part: 'solder' });
  k.lathe([[0, 0], [0.011, 0], [0.01, 0.018], [0, 0.018]], S.chrome(), { p: [sx0 + 0.06, TY + 0.13, sz0], seg: 10, part: 'solder' });
  k.tube([[sx0 + 0.18, TY + 0.005, sz0 + 0.02], [sx0 + 0.2, TY + 0.06, sz0 + 0.04], [sx0 + 0.21, TY + 0.12, sz0 + 0.05]], 0.022, S.copper(), { tseg: 10, rseg: 8, part: 'solder', shape: (a) => [Math.cos(a), Math.sin(a)] });
  k.cyl(0.006, 0.18, mat({ name: 'sv_iron', color: 0x2a2a2a, rough: 0.5 }), { p: [sx0 + 0.21, TY + 0.13, sz0 + 0.05], r: [0.5, 0, 0.3], seg: 8, part: 'solder' });
  k.cyl(0.03, 0.025, S.zinc(), { p: [sx0 - 0.02, TY + 0.0125, sz0 + 0.14], seg: 14, part: 'solder' });
  // colliders: top + legs + shelf
  k.colBox([L, 0.04, D], [0, TY - 0.02, 0]);
  for (const sx of [-1, 1]) k.colBox([0.06, TY - 0.04, D - 0.1], [sx * (L / 2 - 0.1), (TY - 0.04) / 2, 0]);
  k.colBox([L - 0.3, 0.03, D - 0.2], [0, 0.23, 0]);
  k.anchor('top', [0.05, TY, 0.02]);
  return {
    kit: k,
    meta: {
      mass: 24, material: 'wood', friction: 0.9, restitution: 0.04, center: [0, 0.45, 0],
      init(inst, opts) {
        const { vise, solder } = inst.parts;
        inst.object.userData.setTier = (n) => { if (vise) vise.visible = n >= 2; if (solder) solder.visible = n >= 3; };
        inst.object.userData.setTier(opts.tier || 1);
      },
    },
  };
});

def('bench_vise', () => {
  const k = new Kit();
  const VM = mat({ name: 'sv_vise', color: 0x4a6a8a, rough: 0.55, det: 'cast', ns: 0.7 });
  k.rbox(0.14, 0.05, 0.18, 0.012, VM, { p: [0, -0.04, 0] });
  k.rbox(0.13, 0.1, 0.05, 0.012, VM, { p: [0, 0.03, -0.04] });
  k.rbox(0.13, 0.09, 0.05, 0.012, VM, { p: [0, 0.025, 0.06] });
  k.cyl(0.009, 0.16, S.chrome(), { p: [0, 0.01, 0.12], r: [PI / 2, 0, 0], seg: 10 });
  k.colBox([0.15, 0.14, 0.24]);
  return { kit: k, meta: { mass: 4, material: 'metal' } };
});

def('solder_kit', () => {
  const k = new Kit();
  k.rbox(0.26, 0.07, 0.16, 0.012, mat({ name: 'sv_kitbox', color: 0x8a3a2a, rough: 0.55, det: 'powder' }), { p: [0, -0.01, 0] });
  k.cyl(0.006, 0.17, mat({ name: 'sv_iron', color: 0x2a2a2a, rough: 0.5 }), { p: [0, 0.035, 0.02], r: [0, 0, PI / 2], seg: 8 });
  k.cyl(0.002, 0.04, S.copper(), { p: [0.1, 0.035, 0.02], r: [0, 0, PI / 2], seg: 6 });
  k.cyl(0.026, 0.022, S.zinc(), { p: [-0.07, 0.04, -0.04], seg: 14 });
  k.colBox([0.26, 0.1, 0.16]);
  return { kit: k, meta: { mass: 1.6, material: 'metal' } };
});

// ============================================================================ scrap tools
def('saw', () => {
  const k = new Kit();
  // blade: a flattened strip of scrap with teeth filed into one edge
  const sh = new THREE.Shape();
  const BL = 0.34;
  sh.moveTo(0, 0); sh.lineTo(BL, 0.012);
  for (let i = 0; i <= 26; i++) { const x = BL - (i / 26) * BL; sh.lineTo(x, 0.07 - (i % 2) * 0.008 - x * 0.06); }
  sh.closePath();
  k.add(extrudeGeo(sh, 0.0018, 0.0004), mat({ name: 'sv_saw', color: 0xb0b2b0, metal: 1, rough: 0.42, det: 'brushed' }), { p: [0, -0.03, -0.0009], col: 0xd8d8d0 });
  // wooden grip: a chunk of plank, taped on
  k.rbox(0.1, 0.08, 0.03, 0.012, M.wood(), { p: [-0.05, 0.0, 0], col: 0xd0a878 });
  wraps(k, 0, 0.03, 3, M.tape(), 0xc8ccc8, { x: -0.005 });
  k.colBox([0.44, 0.09, 0.03], [0.12, 0, 0]);
  return { kit: k, meta: { mass: 0.6, material: 'metal', hold: { grip: [-0.05, 0, 0], rot: [0, -PI / 2, 0.2] } } };
});

def('knife', () => {
  const k = new Kit();
  const sh = new THREE.Shape([[0, -0.012], [0.11, -0.004], [0.13, 0.006], [0.0, 0.016]].map(([x, y]) => new THREE.Vector2(x, y)));
  k.add(extrudeGeo(sh, 0.003, 0.0008), mat({ name: 'sv_shiv', color: 0xa8aca8, metal: 1, rough: 0.38, det: 'brushed' }), { p: [0, 0, -0.0015] });
  k.push({ r: [0, 0, PI / 2] });
  stickGeo(k, 0.1, 0.012, M.bark(), { seed: 41, p: [0, 0.05, 0], bend: 0.004 });
  k.pop();
  wraps(k, 0, 0.015, 4, M.tape(), 0x2a2a2a, { x: -0.05 });
  k.colBox([0.24, 0.035, 0.03], [0.02, 0, 0]);
  return { kit: k, meta: { mass: 0.2, material: 'metal', hold: { grip: [-0.05, 0, 0], rot: [0, -PI / 2, 0.3] } } };
});

def('spear', () => {
  const k = new Kit();
  stickGeo(k, 1.35, 0.016, M.bark(), { seed: 61, bend: 0.03, taper: 0.06 });
  const sh = new THREE.Shape([[0, 0], [0.024, 0.04], [0, 0.14], [-0.024, 0.04]].map(([x, y]) => new THREE.Vector2(x, y)));
  k.add(extrudeGeo(sh, 0.003, 0.0008), mat({ name: 'sv_shiv', color: 0xa8aca8, metal: 1, rough: 0.38, det: 'brushed' }), { p: [0, 0.66, -0.0015] });
  wraps(k, 0.68, 0.019, 4, M.tape(), 0xc8ccc8);
  wraps(k, -0.2, 0.019, 3, M.cloth(), 0x7a3a2a);
  k.colCap(0.02, 0.72, [0, 0.03, 0]);
  return { kit: k, meta: { mass: 1.1, material: 'wood', hold: { grip: [0, -0.2, 0], rot: [-1.5, 0, 0] } } };
});

def('hatchet', () => {
  const k = new Kit();
  stickGeo(k, 0.4, 0.016, M.wood(), { seed: 71, bend: 0.01, taper: -0.15, col: 0xd8b080 });
  const sh = new THREE.Shape([[-0.02, -0.03], [0.07, -0.05], [0.09, 0.0], [0.07, 0.05], [-0.02, 0.03]].map(([x, y]) => new THREE.Vector2(x, y)));
  k.add(extrudeGeo(sh, 0.018, 0.003), mat({ name: 'sv_axe', color: 0x8a8e90, metal: 1, rough: 0.45, det: 'cast' }), { p: [0.0, 0.17, -0.009], col: 0xd0d0cc });
  k.add(extrudeGeo(new THREE.Shape([[0.074, -0.046], [0.09, 0.0], [0.074, 0.046], [0.08, 0]].map(([x, y]) => new THREE.Vector2(x, y))), 0.019, 0), S.chrome(), { p: [0.0, 0.17, -0.0095] });
  wraps(k, -0.12, 0.019, 4, M.tape(), 0x2a2a2a);
  k.colCap(0.018, 0.19, [0, 0, 0]);
  k.colBox([0.12, 0.1, 0.02], [0.03, 0.17, 0]);
  return { kit: k, meta: { mass: 1.0, material: 'metal', hold: { grip: [0, -0.13, 0], rot: [-1.4, 0, 0] } } };
});

def('crossbow', () => {
  const k = new Kit();
  // stock from a plank, prod from two bent strips of scrap, a wire string, a pipe barrel groove
  k.rbox(0.05, 0.05, 0.55, 0.01, M.wood(), { p: [0, 0, 0.05], dU: 'z', col: 0xd8b088 });
  k.rbox(0.045, 0.1, 0.12, 0.012, M.wood(), { p: [0, -0.05, 0.25], col: 0xc89a70 });
  const steel = mat({ name: 'sv_prod', color: 0x8a8c88, metal: 0.9, rough: 0.5, det: 'cast' });
  for (const sx of [-1, 1]) k.tube([[0, 0.012, -0.2], [sx * 0.14, 0.012, -0.17], [sx * 0.26, 0.012, -0.1]], (t) => [0.008 * (1 - t * 0.4), 0.004], steel, { tseg: 12, rseg: 6 });
  k.tube([[-0.26, 0.012, -0.1], [0, 0.014, 0.02], [0.26, 0.012, -0.1]], 0.0018, S.steelDark(), { tseg: 10, rseg: 4, tension: 0 });
  k.cyl(0.012, 0.36, S.steelDark(), { p: [0, 0.03, -0.06], r: [PI / 2, 0, 0], seg: 10, open: true, phiLen: PI });
  k.rbox(0.012, 0.03, 0.03, 0.004, S.steelDark(), { p: [0, -0.03, 0.12] });
  wraps(k, 0, 0.032, 3, M.tape(), 0xc8ccc8, { z: -0.18 });
  k.colBox([0.12, 0.12, 0.6], [0, -0.02, 0.05]);
  return { kit: k, meta: { mass: 1.8, material: 'wood', hold: { grip: [0, -0.05, 0.24], rot: [0, 0, 0] } } };
});

def('bolt_bundle', () => {
  const k = new Kit();
  const rng = new RNG(81);
  for (let i = 0; i < 5; i++) {
    const x = (i % 3 - 1) * 0.012 + rng.range(-0.002, 0.002), y = Math.floor(i / 3) * 0.012;
    k.push({ p: [x, y, 0], r: [PI / 2, 0, 0] });
    stickGeo(k, 0.3, 0.005, M.wood(), { seed: 90 + i, bend: 0.002, col: 0xe0c090 });
    k.add(new THREE.ConeGeometry(0.006, 0.03, 5), S.steelDark(), { p: [0, 0.165, 0] });
    k.pop();
  }
  wraps(k, 0, 0.024, 2, M.cloth(), 0x7a3a2a, { z: 0 });
  k.colBox([0.05, 0.035, 0.32]);
  return { kit: k, meta: { mass: 0.2, material: 'wood', hold: { grip: [0, 0, 0], rot: [0.4, 0.2, 0] } } };
});

// ============================================================================ gear
def('lantern', () => {
  const k = new Kit();
  const P = M.paint();
  k.lathe([[0, 0], [0.07, 0], [0.072, 0.03, 0.006], [0.05, 0.04], [0, 0.04]], P, { seg: 20, col: 0x9a3a28 });
  k.lathe([[0, 0.2], [0.05, 0.2], [0.07, 0.215, 0.008], [0.03, 0.25], [0, 0.25]], P, { seg: 20, col: 0x9a3a28 });
  k.lathe([[0.048, 0.04], [0.056, 0.12, 0.02], [0.046, 0.2]], GLASS(), { seg: 20, raw: false });
  for (let i = 0; i < 4; i++) { const a = i * PI / 2 + 0.4; k.tube([[Math.cos(a) * 0.058, 0.04, Math.sin(a) * 0.058], [Math.cos(a) * 0.064, 0.12, Math.sin(a) * 0.064], [Math.cos(a) * 0.054, 0.2, Math.sin(a) * 0.054]], 0.003, S.steelDark(), { tseg: 8, rseg: 5 }); }
  k.sphere(0.022, glow({ name: 'sv_lantern_glow', color: 0x3a2a14, emissive: 0xffc070, ei: 2.2 }), { p: [0, 0.11, 0], part: 'glow', ws: 12, hs: 8 });
  k.tube([[-0.05, 0.25, 0], [-0.05, 0.31, 0], [0.05, 0.31, 0], [0.05, 0.25, 0]], 0.004, S.steelDark(), { tseg: 14, rseg: 5, tension: 0.2 });
  k.colCyl(0.07, 0.26, [0, 0.13, 0]);
  return {
    kit: k,
    meta: {
      mass: 0.9, material: 'metal', hold: { grip: [0, 0.3, 0], rot: [0, 0, 0], off: [0, -0.05, 0] }, center: [0, 0.13, 0],
      init(inst, opts) {
        const g = inst.parts.glow;
        inst.object.userData.setLit = (on) => { g.material.emissiveIntensity = on ? 2.2 : 0; g.material.color.setHex(on ? 0x3a2a14 : 0x2a2620); };
        inst.object.userData.setLit(!!opts.lit);
      },
    },
  };
});

def('backpack', () => {
  const k = new Kit();
  const C = M.canvas();
  k.rbox(0.32, 0.42, 0.18, 0.07, C, { col: 0x6a7a4a, deform: (v) => { v.z *= 1 + Math.sin(v.y * 8) * 0.06; } });
  k.rbox(0.33, 0.14, 0.2, 0.05, C, { p: [0, 0.16, 0.01], col: 0x5a6a3e });
  k.rbox(0.22, 0.14, 0.06, 0.03, C, { p: [0, -0.08, 0.11], col: 0x5a6a3e });
  for (const sx of [-1, 1]) k.tube([[sx * 0.09, 0.2, -0.09], [sx * 0.11, 0.05, -0.13], [sx * 0.1, -0.18, -0.1]], (t) => [0.02, 0.005], C, { tseg: 10, rseg: 6, col: 0x3a3a2a });
  wraps(k, 0.0, 0.02, 2, M.tape(), 0xc8ccc8, { x: 0.12, z: 0.1 });
  k.colBox([0.33, 0.44, 0.22]);
  return { kit: k, meta: { mass: 1.4, material: 'fabric' } };
});

def('water_filter', () => {
  const k = new Kit();
  // a cut-down bottle stuffed with cloth, foam and grit, sitting in a tin can
  k.lathe([[0, -0.07], [0.042, -0.07, 0.004], [0.044, 0.0], [0, 0.0]], S.zinc(), { seg: 18 });
  k.lathe([[0.034, -0.0], [0.036, 0.09], [0.03, 0.12]], GLASS(), { seg: 18 });
  k.cyl(0.033, 0.03, M.foam(), { p: [0, 0.016, 0], seg: 14, col: 0xe0c060 });
  k.cyl(0.033, 0.025, M.cloth(), { p: [0, 0.045, 0], seg: 14, col: 0xd8ccb0 });
  k.cyl(0.032, 0.025, M.stone(), { p: [0, 0.07, 0], seg: 14, col: 0x8a8070 });
  wraps(k, 0.1, 0.034, 2, M.tape(), 0xc8ccc8);
  k.colCyl(0.044, 0.2, [0, 0.03, 0]);
  return { kit: k, meta: { mass: 0.6, material: 'plastic', hold: { grip: [0, 0, 0], rot: [0.2, 0.3, 0] } } };
});

def('cot', () => {
  const k = new Kit();
  const W = M.wood(), C = M.canvas();
  const L = 1.85, Wd = 0.72, H = 0.38;
  for (const sx of [-1, 1]) k.rbox(0.05, 0.05, L, 0.01, W, { p: [sx * Wd / 2, H, 0], dU: 'z', col: 0xd8b088 });
  for (const sz of [-1, 0, 1]) for (const sx of [-1, 1]) k.tube([[sx * Wd / 2, H, sz * (L / 2 - 0.1)], [sx * (Wd / 2 - 0.04), 0.02, sz * (L / 2 - 0.1) + 0.02]], 0.015, S.steelDark(), { tseg: 2, rseg: 6 });
  k.add(new THREE.PlaneGeometry(Wd, L - 0.04, 6, 12), C, { p: [0, H + 0.01, 0], r: [-PI / 2, 0, 0], col: 0x6a7a5a, deform: (v) => { v.z -= (1 - (2 * v.x / Wd) ** 2) * 0.04; } });
  k.rbox(0.5, 0.09, 0.26, 0.04, M.cloth(), { p: [0, H + 0.03, -L / 2 + 0.2], col: 0xe0d6c0 });
  k.rbox(Wd - 0.1, 0.06, 0.4, 0.03, M.cloth(), { p: [0, H + 0.02, L / 2 - 0.3], col: 0x7a3a3a });
  k.colBox([Wd + 0.05, 0.08, L], [0, H, 0]);
  for (const sx of [-1, 1]) k.colBox([0.04, H, L - 0.1], [sx * (Wd / 2 - 0.03), H / 2, 0]);
  return { kit: k, meta: { mass: 14, material: 'fabric', friction: 0.9, center: [0, 0.22, 0] } };
});

def('insulation', () => {
  const k = new Kit();
  const W = 0.95, H = 1.15, T = 0.06;
  k.rbox(W, H, T, 0.025, M.cloth(), { col: 0xb8a070, deform: (v) => { v.z *= 1 + Math.abs(Math.sin(v.y * 9)) * 0.5; } });
  // quilting lines + taped seams
  for (let i = -2; i <= 2; i++) k.rbox(W - 0.02, 0.012, T + 0.012, 0.004, M.tape(), { p: [0, i * 0.22, 0], col: 0xc8ccc8 });
  k.colBox([W, H, T + 0.02]);
  return { kit: k, meta: { mass: 3, material: 'fabric', friction: 0.8 } };
});

// ============================================================================ shelter pieces
def('plank_door', () => {
  const k = new Kit();
  const W = M.wood(), rng = new RNG(31);
  const DW = 0.9, DH = 2.0, T = 0.045;
  for (let i = 0; i < 4; i++) {
    const w = DW / 4 - 0.006;
    k.rbox(w, DH - rng.range(0, 0.04), T, 0.006, W, { p: [-DW / 2 + (i + 0.5) * DW / 4, rng.range(-0.01, 0.01), 0], dU: 'y', col: [0xe8cca0, 0xd8b88a, 0xf0d8b0, 0xc8a878][i] });
  }
  // Z brace on the inside face + hinge straps and a handle loop on the outside
  for (const y of [-DH / 2 + 0.25, DH / 2 - 0.25]) k.rbox(DW - 0.04, 0.12, 0.03, 0.008, W, { p: [0, y, -T / 2 - 0.015], dU: 'x', col: 0xc8a070 });
  k.rbox(0.1, DH - 0.6, 0.03, 0.008, W, { p: [0, 0, -T / 2 - 0.015], r: [0, 0, -0.42], dU: 'y', col: 0xb89060 });
  const rust = M.rust();
  for (const y of [-DH / 2 + 0.25, DH / 2 - 0.25]) {
    k.rbox(0.32, 0.04, 0.006, 0.003, rust, { p: [-DW / 2 + 0.16, y, T / 2 + 0.004] });
    k.cyl(0.012, 0.1, rust, { p: [-DW / 2 - 0.006, y, 0], seg: 8 });
  }
  k.tube([[DW / 2 - 0.12, 0.08, T / 2], [DW / 2 - 0.12, 0.06, T / 2 + 0.05], [DW / 2 - 0.12, -0.06, T / 2 + 0.05], [DW / 2 - 0.12, -0.08, T / 2]], 0.008, rust, { tseg: 14, rseg: 6 });
  k.colBox([DW, DH, T + 0.04], [0, 0, -0.01]);
  k.anchor('hinge', [-DW / 2, 0, 0]);
  return { kit: k, meta: { mass: 18, material: 'wood', friction: 0.7, angularDamping: 2.5, linearDamping: 0.6 } };
});

def('stash_crate', () => {
  const k = new Kit();
  const W = M.wood(), rng = new RNG(51);
  const L = 0.72, D = 0.46, H = 0.42;
  // slatted sides
  for (let i = 0; i < 3; i++) {
    const y = -H / 2 + 0.07 + i * 0.135;
    for (const sz of [-1, 1]) k.rbox(L, 0.12, 0.02, 0.005, W, { p: [0, y, sz * (D / 2 - 0.01)], dU: 'x', col: [0xe8cca0, 0xd8b88a, 0xf0d8b0][(i + (sz > 0 ? 1 : 0)) % 3] });
    for (const sx of [-1, 1]) k.rbox(0.02, 0.12, D - 0.04, 0.005, W, { p: [sx * (L / 2 - 0.01), y, 0], dU: 'z', col: 0xd0b080 });
  }
  k.rbox(L - 0.04, 0.02, D - 0.04, 0.004, W, { p: [0, -H / 2 + 0.01, 0], col: 0xc8a070 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.rbox(0.04, H, 0.04, 0.006, W, { p: [sx * (L / 2 - 0.02), 0, sz * (D / 2 - 0.02)], col: 0xb89060 });
  // the lid, hinged along the back edge (part pivot at the back top)
  for (let i = 0; i < 3; i++) k.rbox(L, 0.022, D / 3 - 0.006, 0.005, W, { p: [0, H / 2 + 0.011, -D / 2 + (i + 0.5) * D / 3], dU: 'x', col: [0xf0d8b0, 0xe0c498, 0xe8cca0][i], part: 'lid' });
  k.rbox(L - 0.1, 0.02, 0.05, 0.005, W, { p: [0, H / 2 + 0.03, 0], col: 0xc8a070, part: 'lid' });
  k.pivot('lid', [0, H / 2 + 0.011, -D / 2]);
  void rng;
  k.colBox([L, H, D]);
  return {
    kit: k,
    meta: {
      mass: 12, material: 'wood', friction: 0.8,
      init(inst) {
        const lid = inst.parts.lid;
        inst.object.userData.setOpen = (f) => { if (lid) lid.rotation.x = -clamp(f, 0, 1) * 1.9; };
      },
    },
  };
});

// ============================================================================ radio parts
def('radio_battery', () => {
  const k = new Kit();
  k.rbox(0.11, 0.12, 0.11, 0.014, mat({ name: 'sv_rbat', color: 0xd8b040, rough: 0.6, det: 'stipple' }), { col: 0xffffff });
  k.rbox(0.112, 0.03, 0.112, 0.008, mat({ name: 'sv_rbat_band', color: 0x2a2a2a, rough: 0.5 }), { p: [0, 0.035, 0] });
  for (const sx of [-1, 1]) k.tube([[sx * 0.03, 0.06, 0], [sx * 0.03, 0.08, 0.005], [sx * 0.032, 0.095, 0]], 0.004, S.brass(), { tseg: 10, rseg: 5, shape: (a) => [Math.cos(a), Math.sin(a)] });
  wraps(k, 0, 0.058, 1, M.tape(), 0xc8ccc8);
  k.colBox([0.11, 0.13, 0.11]);
  return { kit: k, meta: { mass: 0.9, material: 'plastic', hold: { grip: [0, 0, 0], rot: [0.2, 0.4, 0] } } };
});

def('radio_antenna', () => {
  const k = new Kit();
  k.cyl(0.018, 0.04, S.steelDark(), { p: [0, -0.2, 0], seg: 12 });
  for (let i = 0; i < 4; i++) k.cyl(0.006 - i * 0.0012, 0.12, S.chrome(), { p: [0, -0.13 + i * 0.1, 0], seg: 8 });
  k.sphere(0.006, S.chrome(), { p: [0, 0.2, 0] });
  k.tube([[0.015, -0.2, 0], [0.05, -0.22, 0.02], [0.07, -0.2, 0.05]], 0.003, mat({ name: 'sv_wire_r', color: 0xa82a1a, rough: 0.5 }), { tseg: 8, rseg: 5 });
  k.colCyl(0.02, 0.42);
  return { kit: k, meta: { mass: 0.3, material: 'metal', hold: { grip: [0, -0.18, 0], rot: [-1.2, 0, 0] } } };
});

def('radio_coil', () => {
  const k = new Kit();
  k.cyl(0.022, 0.08, mat({ name: 'sv_former', color: 0x2a2420, rough: 0.6, det: 'stipple' }), { seg: 14 });
  for (let i = 0; i < 12; i++) k.torus(0.024, 0.0022, S.copper(), { p: [0, -0.033 + i * 0.006, 0], r: [PI / 2, 0, 0], rseg: 5, tseg: 18 });
  for (const sy of [-1, 1]) k.cyl(0.004, 0.02, S.brass(), { p: [0.026, sy * 0.036, 0], r: [0, 0, PI / 2], seg: 6 });
  k.colCyl(0.027, 0.08);
  return { kit: k, meta: { mass: 0.15, material: 'metal', hold: { grip: [0, 0, 0], rot: [0.5, 0, 0.3] } } };
});

def('radio_amp', () => {
  const k = new Kit();
  k.rbox(0.18, 0.04, 0.12, 0.008, mat({ name: 'sv_chassis', color: 0x6a7058, rough: 0.6, det: 'powder' }), { p: [0, -0.03, 0] });
  // a valve in its socket (it glows once the radio drinks power: parts.glow)
  k.cyl(0.018, 0.015, mat({ name: 'sv_socket', color: 0x1a1a1a, rough: 0.6 }), { p: [-0.04, 0.0, 0], seg: 12 });
  k.lathe([[0, 0], [0.016, 0], [0.018, 0.05, 0.01], [0.012, 0.075, 0.01], [0, 0.08]], GLASS(), { p: [-0.04, 0.007, 0], seg: 16 });
  k.cyl(0.006, 0.04, glow({ name: 'sv_valve', color: 0x302010, emissive: 0xff8a40, ei: 0.8 }), { p: [-0.04, 0.035, 0], seg: 8, part: 'glow' });
  k.cyl(0.02, 0.05, S.alu(), { p: [0.04, 0.0, -0.02], seg: 14 });
  k.rbox(0.03, 0.03, 0.02, 0.004, S.steelDark(), { p: [0.05, 0.0, 0.04] });
  k.tube([[0.04, 0.025, -0.02], [0.0, 0.03, 0.02], [-0.04, 0.09, 0]], 0.002, S.copper(), { tseg: 10, rseg: 4 });
  k.colBox([0.18, 0.13, 0.12], [0, 0.02, 0]);
  return { kit: k, meta: { mass: 0.9, material: 'metal', hold: { grip: [0, -0.03, 0], rot: [0.2, 0.3, 0] } } };
});

// ============================================================================ things worth finding
// a canvas duffel someone stashed in a dead end (unzip it: lootables.js 'cache')
def('stash_bag', () => {
  const k = new Kit();
  const C = M.canvas(), rng = new RNG(71);
  const L = 0.62, R = 0.14;
  k.rbox(L, R * 2, R * 2.1, R * 0.9, C, { col: 0x4e5a3a, deform: (v) => { v.y *= 1 - Math.max(0, v.y) * 0.9; v.z *= 1 + Math.sin(v.x * 9) * 0.05; } });
  for (const sx of [-1, 1]) k.cyl(R * 0.88, 0.03, C, { p: [sx * (L / 2 - 0.01), -0.01, 0], r: [0, 0, PI / 2], col: 0x3e4a2e, seg: 18 });
  // zip along the top, two webbing handles, a shoulder strap flopped over the side
  k.rbox(L - 0.08, 0.012, 0.02, 0.004, S.steelDark(), { p: [0, R - 0.035, 0] });
  for (const sx of [-1, 1]) k.tube([[sx * 0.1, R - 0.05, -0.05], [sx * 0.1, R + 0.05, 0], [sx * 0.1, R - 0.05, 0.05]], (t) => [0.018, 0.005], C, { tseg: 10, rseg: 6, col: 0x2a2a22 });
  k.tube([[-0.22, R - 0.06, 0.08], [-0.05, R - 0.08, R + 0.06], [0.12, -R + 0.03, R + 0.05], [0.26, -R + 0.01, R + 0.08]], (t) => [0.02, 0.004], C, { tseg: 16, rseg: 6, col: 0x2a2a22 });
  wraps(k, 0, 0.02, 2, M.tape(), 0xc8ccc8, { x: rng.range(-0.2, 0.2), z: R });
  k.colBox([L, R * 1.8, R * 2.1], [0, -0.02, 0]);
  return { kit: k, meta: { mass: 4, material: 'fabric', friction: 0.9 } };
});

// a padlocked footlocker (lootables.js 'vault'): parts.lid hinged at the back edge, parts.lock (hidden once open)
def('locked_cache', () => {
  const k = new Kit();
  const W = M.wood(), P = M.paint(), rust = M.rust();
  const L = 0.8, D = 0.44, H = 0.4, LH = 0.1;
  k.rbox(L, H - LH, D, 0.012, P, { p: [0, -LH / 2, 0], col: 0x56603e });
  // the lid, hinged along the back edge
  k.rbox(L, LH, D, 0.014, P, { p: [0, H / 2 - LH / 2, 0], col: 0x5e6a44, part: 'lid' });
  for (const sx of [-1, 1]) k.rbox(0.012, LH + 0.006, D + 0.012, 0.004, rust, { p: [sx * (L / 2 - 0.08), H / 2 - LH / 2, 0], part: 'lid' });
  k.rbox(0.07, 0.07, 0.014, 0.004, rust, { p: [0, H / 2 - LH - 0.02, D / 2 + 0.006], part: 'lid' }); // hasp
  k.pivot('lid', [0, H / 2, -D / 2]);
  // metal bands, corners, handles at the ends
  for (const sx of [-1, 1]) {
    k.rbox(0.012, H - LH + 0.006, D + 0.012, 0.004, rust, { p: [sx * (L / 2 - 0.08), -LH / 2, 0] });
    for (const sz of [-1, 1]) k.rbox(0.05, H - 0.01, 0.05, 0.008, rust, { p: [sx * (L / 2 - 0.02), 0, sz * (D / 2 - 0.02)] });
    k.tube([[sx * (L / 2 + 0.004), 0.02, -0.07], [sx * (L / 2 + 0.03), 0.0, 0], [sx * (L / 2 + 0.004), 0.02, 0.07]], 0.008, rust, { tseg: 12, rseg: 6 });
  }
  k.rbox(0.05, 0.03, 0.02, 0.004, rust, { p: [0, H / 2 - LH - 0.06, D / 2 + 0.008] }); // staple
  // the padlock hanging off the hasp
  const brass = mat({ name: 'sv_brass', color: 0xc8a050, rough: 0.35, metal: 0.9, det: 'cast', ns: 0.8 });
  k.rbox(0.06, 0.055, 0.024, 0.008, brass, { p: [0, H / 2 - LH - 0.11, D / 2 + 0.03], part: 'lock' });
  k.torus(0.018, 0.005, S.steel(), { p: [0, H / 2 - LH - 0.075, D / 2 + 0.03], arc: PI, tseg: 12, part: 'lock' });
  void W;
  k.colBox([L + 0.04, H, D + 0.03]);
  return {
    kit: k,
    meta: {
      mass: 22, material: 'wood', friction: 0.8,
      init(inst) {
        const lid = inst.parts.lid, lock = inst.parts.lock;
        if (lid) { lid.userData.axis = 'x'; lid.userData.maxOpen = -1.75; }
        inst.object.userData.setLocked = (on) => { if (lock) lock.visible = !!on; };
      },
    },
  };
});

// planks nailed across a doorway (1.1 m x 2.15 m gap): a fixed prop placed by biome.js on the corridor side
def('boarded_door', () => {
  const k = new Kit();
  const W = M.wood(), rng = new RNG(83), nail = S.steelDark();
  const H = 2.12;
  const boards = [[-0.78, 0.06], [-0.32, -0.1], [0.12, 0.07], [0.55, -0.05], [0.88, 0.12]];
  boards.forEach(([y, a], i) => {
    const len = rng.range(1.3, 1.42);
    k.push({ p: [rng.range(-0.03, 0.03), y, (i % 2) * 0.012], r: [0, 0, a] });
    k.rbox(len, rng.range(0.15, 0.2), 0.03, 0.006, W, { dU: 'x', col: [0xe8cca0, 0xd8b88a, 0xf0d8b0, 0xc8a878, 0xdcc094][i], deform: (v) => { v.z += Math.sin(v.x * 3 + i) * 0.004; } });
    for (const sx of [-1, 1]) for (const dy of [-0.04, 0.04]) k.cyl(0.008, 0.006, nail, { p: [sx * (len / 2 - 0.08), dy, 0.017], r: [PI / 2, 0, 0], seg: 6 });
    k.pop();
  });
  // a cross brace, nailed over the rest
  k.push({ p: [0, 0.05, 0.032], r: [0, 0, 1.05] });
  k.rbox(2.0, 0.14, 0.028, 0.006, W, { dU: 'x', col: 0xc8a070 });
  k.pop();
  k.colBox([1.3, H, 0.08], [0, 0, 0.01]);
  return { kit: k, meta: { mass: 30, material: 'wood', friction: 0.8 } };
});

// ============================================================================ paper
def('notebook', () => {
  const k = new Kit();
  const cover = mat({ name: 'sv_notebook', color: 0x6a3a2a, rough: 0.8, det: 'card', ns: 0.8 });
  k.rbox(0.11, 0.016, 0.15, 0.004, cover, { col: 0xffffff });
  k.rbox(0.104, 0.012, 0.146, 0.002, M.paper(), { p: [0.004, 0, 0] });
  k.rbox(0.004, 0.0175, 0.15, 0.001, mat({ name: 'sv_elastic', color: 0x1a1a1a, rough: 0.6 }), { p: [0.035, 0, 0] });
  k.colBox([0.11, 0.018, 0.15]);
  return { kit: k, meta: { mass: 0.15, material: 'paper', hold: { grip: [0, 0, 0], rot: [0.8, 0.2, 0] } } };
});

export const SURVIVAL_ITEMS = ['stick', 'foam', 'glass_shard', 'rock', 'bottle', 'water_dirty', 'water_clean', 'rag_bandage', 'torch', 'sharp_stick', 'rock_hammer', 'bedroll', 'scrap_bench', 'bench_vise', 'solder_kit', 'saw', 'knife', 'spear', 'hatchet', 'crossbow', 'bolt_bundle', 'lantern', 'backpack', 'water_filter', 'cot', 'insulation', 'plank_door', 'stash_crate', 'radio_battery', 'radio_antenna', 'radio_coil', 'radio_amp', 'notebook', 'stash_bag', 'locked_cache', 'boarded_door'];
export { BENCH };
