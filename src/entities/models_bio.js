// R.O.O.M. — Level 0 biodiversity & scavenging props (picked up by catalog.js through the models_*.js glob).
// Low-poly realistic: faceted (flat-shaded) primitives with vertex colour, merged per material by the item Kit.
//
//   mole_meat(_cooked/_burnt), crawler_meat(...)   parts.food (own material: cooking tints its colour)
//   fungus_black / fungus_glow / fungus_shelf / fungus_puff (+ _cooked/_burnt)   parts.food; glowcaps: parts.glow
//   canned_food_hot             the canned food model (heated in the pan)
//   camp_stove                  (DKit template cg_stove, devices/camp.js) camp stove with a cast-iron pan fixed on top. anchors.pan (pan floor centre),
//                               parts.flame (burner glow, own material)
//   supply_box                  (DKit cg_supply) stencilled R.O.O.M. supply crate (lootable)
//   sleeping_bag (DKit cg_bag), tent_ruin   abandoned-camp gear (searchable)
//   trolley_broken              the wheel trolley with two casters torn off (sits tilted on its frame)
//   board                       (DKit cg_board) plywood deck board (weld the player engineer's 'wheel' casters under it: a DIY cart)
//   note_scribble               scribbled sheet left by an earlier clone (read it [E], game/bio.js)
import * as THREE from 'three';
import { Kit, def, ITEMS as CORE, PI } from './items/core.js';
import { mat, glow, S } from './items/mats.js';
import { atlas, txt, rect, noise, MONO } from './items/paint.js';
import { buildItem } from './models_items.js';
import { buildDevice } from './models_devices.js';

const hash = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
const jitter = (amt, seed = 1) => (v) => {
  const kx = Math.round(v.x * 500), ky = Math.round(v.y * 500), kz = Math.round(v.z * 500);
  v.x += (hash(kx, ky, kz + seed) - 0.5) * amt; v.y += (hash(ky, kz, kx + seed) - 0.5) * amt; v.z += (hash(kz, kx, ky + seed) - 0.5) * amt;
};
const C = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
// glowing fungus caps share one material (game/bio.js pulses it)
export const GLOW = { mat: null };
const glowMat = () => GLOW.mat || (GLOW.mat = glow({ name: 'glowcap', color: 0x0a2a24, emissive: 0x6fffd8, ei: 1.6, rough: 0.4 }));

function bioAtlas() {
  return atlas('bio_items', 512, 256, (c) => {
    // (0,0,256,96) supply crate stencil
    rect(c, 0, 0, 256, 96, '#4a5a3a');
    noise(c, 0, 0, 256, 96, 14, 3);
    txt(c, 'R.O.O.M.', 128, 34, { size: 30, color: '#e8e0c0', fam: MONO, weight: '900' });
    txt(c, 'FIELD SUPPLY', 128, 62, { size: 18, color: '#e8e0c0', fam: MONO, weight: 'bold' });
    txt(c, 'DO NOT DROP', 128, 84, { size: 11, color: '#d8c890', fam: MONO });
    // (0,128,256,128) scribbled note
    rect(c, 0, 128, 256, 128, '#ece6d2');
    noise(c, 0, 128, 256, 128, 8, 7);
    c.strokeStyle = '#2a2a3a'; c.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      c.beginPath();
      let x = 14, y = 146 + i * 12;
      c.moveTo(x, y);
      while (x < 236 - (i % 3) * 30) { x += 6 + hash(i, x, 1) * 8; c.lineTo(x, y + (hash(x, i, 2) - 0.5) * 5); }
      c.stroke();
    }
    txt(c, 'DONT FOLLOW THE HUM', 128, 244, { size: 14, color: '#8a1a10', fam: MONO, weight: 'bold', rot: 0.05 });
  }, { plain: '#e8e0c8' });
}

// ============================================================================ meat
function meatDef(name, crawler) {
  def(name, () => {
    const k = new Kit();
    const meat = mat({ key: null, name: 'bio_meat', rough: 0.45, vc: true });
    const bone = mat({ name: 'bio_bone', color: 0xe8dcc0, rough: 0.6 });
    if (!crawler) {
      // a haunch of mole: dark-red muscle, white fat marbling, a knob of bone, tufts of fur on the skin side
      k.sphere(0.06, meat, {
        ws: 9, hs: 6, s: [1.2, 0.5, 0.85], flat: true, deform: jitter(0.012, 3), part: 'food', clone: true,
        col: (p) => { const h = hash(Math.floor(p.x * 90), Math.floor(p.y * 90), Math.floor(p.z * 90)); return p.y > 0.022 && h < 0.4 ? C(0.25, 0.2, 0.17) : h < 0.2 ? C(0.92, 0.84, 0.74) : C(0.62, 0.12, 0.1); },
      });
      k.cyl(0.011, 0.07, bone, { p: [0.075, 0, 0], r: [0, 0, PI / 2], seg: 6, flat: true });
      k.sphere(0.016, bone, { p: [0.11, 0, 0], ws: 6, hs: 4, flat: true });
      k.colBox([0.15, 0.06, 0.1], [0, 0, 0]);
    } else {
      // a severed crawler limb: knuckled grey-yellow skin, a raw red end, three curled fingers
      const sk = (p) => (p.x < -0.06 ? C(0.65, 0.12, 0.1) : hash(Math.floor(p.x * 60), 1, Math.floor(p.z * 60)) < 0.25 ? C(0.3, 0.32, 0.2) : C(0.66, 0.63, 0.5));
      k.cyl(0.028, 0.16, meat, { r: [0, 0, PI / 2], seg: 6, rt: 0.022, flat: true, deform: jitter(0.01, 5), part: 'food', clone: true, col: sk });
      k.sphere(0.03, meat, { p: [0.01, 0, 0], ws: 6, hs: 4, flat: true, part: 'food', clone: true, col: sk });
      for (let f = 0; f < 3; f++) k.cyl(0.008, 0.05, meat, { p: [0.1, (f - 1) * 0.014, 0.012], r: [0.4, 0, PI / 2 - 0.5], seg: 4, flat: true, part: 'food', clone: true, col: sk });
      k.colCap(0.03, 0.07, [0, 0, 0], [0, 0, PI / 2]);
    }
    return { kit: k, meta: { mass: 0.35, material: 'flesh', hold: { rot: [0, PI / 2, 0] }, friction: 0.9, restitution: 0.05 } };
  });
}
for (const s of ['', '_cooked', '_burnt']) { meatDef('mole_meat' + s, false); meatDef('crawler_meat' + s, true); }

// ============================================================================ fungi
function fungusDef(name, kind) {
  def(name, () => {
    const k = new Kit();
    const flesh = mat({ key: null, name: 'bio_fungus', rough: 0.55, vc: true });
    const sub = mat({ name: 'bio_substrate', rough: 0.95 });
    const F = { part: 'food', clone: true, flat: true };
    if (kind === 'black') {
      // glossy black mould caps on a clump of rotten carpet
      k.cyl(0.07, 0.025, sub, { p: [0, -0.02, 0], seg: 7, col: C(0.32, 0.27, 0.15), flat: true, deform: jitter(0.012, 2) });
      for (let i = 0; i < 6; i++) {
        const a = i * 2.4, r = 0.012 + (i % 3) * 0.018, h = 0.02 + hash(i, 1, 2) * 0.035, cr = 0.016 + hash(i, 2, 3) * 0.014;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        k.cyl(0.004, h, flesh, { ...F, p: [x, h / 2 - 0.008, z], seg: 4, col: C(0.18, 0.17, 0.13) });
        k.sphere(cr, flesh, { ...F, p: [x, h - 0.006, z], s: [1, 0.55, 1], ws: 7, hs: 4, tl: PI * 0.55, col: C(0.04, 0.045, 0.035) });
      }
      k.colCyl(0.07, 0.07, [0, 0.01, 0]);
    } else if (kind === 'glow') {
      k.cyl(0.05, 0.02, sub, { p: [0, -0.03, 0], seg: 6, col: C(0.25, 0.22, 0.14), flat: true, deform: jitter(0.01, 4) });
      for (let i = 0; i < 5; i++) {
        const a = i * 1.3, r = 0.012 + (i % 2) * 0.02, h = 0.05 + hash(i, 5, 2) * 0.05;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        k.cyl(0.0045, h, flesh, { ...F, p: [x, h / 2 - 0.02, z], r: [(hash(i, 1, 1) - 0.5) * 0.4, 0, (hash(i, 2, 1) - 0.5) * 0.4], seg: 4, col: C(0.82, 0.86, 0.78) });
        k.sphere(0.011 + hash(i, 3, 3) * 0.006, glowMat(), { p: [x, h - 0.018, z], s: [1, 0.6, 1], ws: 6, hs: 3, tl: PI * 0.6, part: 'glow', flat: true });
      }
      k.colCyl(0.05, 0.1, [0, 0.015, 0]);
    } else if (kind === 'shelf') {
      // tan/orange bracket fungus torn off a wall: stacked half-discs, banded
      for (let i = 0; i < 3; i++) {
        const R = 0.075 - i * 0.017;
        k.add(new THREE.CylinderGeometry(R, R * 1.05, 0.02, 9, 1, false, 0, PI), flesh, {
          ...F, p: [0, i * 0.022 - 0.02, 0], deform: jitter(0.008, i + 1),
          col: (p) => { const d = Math.hypot(p.x, p.z); return d > R * 0.8 ? C(0.86, 0.72, 0.42) : d > R * 0.5 ? C(0.62, 0.38, 0.16) : C(0.4, 0.24, 0.12); },
        });
      }
      k.colBox([0.15, 0.065, 0.08], [0, 0.0, 0.035]);
    } else {
      // puffball: warty white sphere, a brown crack showing spore mass
      k.sphere(0.05, flesh, { ...F, ws: 9, hs: 6, s: [1, 0.85, 1], deform: jitter(0.008, 9), col: (p) => (p.y > 0.03 && Math.abs(p.x) < 0.012 ? C(0.4, 0.3, 0.18) : hash(Math.floor(p.x * 80), Math.floor(p.y * 80), 3) < 0.2 ? C(0.84, 0.8, 0.7) : C(0.95, 0.93, 0.88)) });
      k.colBall(0.048, [0, 0, 0]);
    }
    return { kit: k, meta: { mass: 0.12, material: 'fabric', friction: 0.95, restitution: 0.05 } };
  });
}
for (const s of ['', '_cooked', '_burnt']) {
  fungusDef('fungus_black' + s, 'black'); fungusDef('fungus_glow' + s, 'glow'); fungusDef('fungus_shelf' + s, 'shelf'); fungusDef('fungus_puff' + s, 'puff');
}

// ============================================================================ camp stove / abandoned-camp gear
// camp_stove, supply_box, board and sleeping_bag are modelled DKit templates (src/entities/devices/camp.js,
// mapped in the registry below); tent_ruin stays a draped Kit sheet.
def('tent_ruin', () => {
  const k = new Kit();
  const canvas = mat({ name: 'ruin_canvas', color: 0xffffff, rough: 0.9, det: 'twill', ns: 0.8 });
  const alu = S.alu();
  const col = (p) => (hash(Math.floor(p.x * 6), Math.floor(p.z * 6), 3) < 0.1 ? C(0.22, 0.2, 0.16) : C(0.48, 0.52, 0.36));
  // collapsed canvas draped over one surviving pole: a crumpled sheet, slashed open on one side
  const g = new THREE.PlaneGeometry(2.0, 1.7, 10, 8);
  g.rotateX(-PI / 2);
  k.add(g, canvas, {
    col, flat: true,
    deform: (v) => {
      const ridge = Math.max(0, 1 - Math.abs(v.z) / 0.85) * Math.max(0, 1 - Math.abs(v.x + 0.3) / 1.3);
      v.y = 0.02 + ridge * 0.55 * (v.x < 0.4 ? 1 : 0.3) + (hash(Math.round(v.x * 9), 2, Math.round(v.z * 9)) - 0.5) * 0.12;
    },
  });
  k.add(new THREE.PlaneGeometry(2.0, 1.7, 10, 8).rotateX(PI / 2), canvas, { col: C(0.3, 0.32, 0.22), flat: true, deform: (v) => { const ridge = Math.max(0, 1 - Math.abs(v.z) / 0.85) * Math.max(0, 1 - Math.abs(v.x + 0.3) / 1.3); v.y = 0.015 + ridge * 0.55 * (v.x < 0.4 ? 1 : 0.3) + (hash(Math.round(v.x * 9), 2, Math.round(v.z * 9)) - 0.5) * 0.12 - 0.01; } });
  k.cyl(0.012, 1.2, alu, { p: [-0.3, 0.3, 0.75], r: [0, 0, 1.1], seg: 6 });
  k.cyl(0.012, 0.9, alu, { p: [0.6, 0.06, -0.5], r: [PI / 2, 0, 0.3], seg: 6 });
  k.colBox([1.9, 0.12, 1.6], [0, 0.06, 0]);
  k.colBox([0.8, 0.45, 0.9], [-0.3, 0.3, 0]);
  return { kit: k, meta: { mass: 22, material: 'fabric', friction: 1.2, center: [0, 0.1, 0] } };
});

def('note_scribble', () => {
  const A = bioAtlas();
  const k = new Kit();
  const print = mat({ name: 'bio_print', map: A, rough: 0.7, vc: true });
  const g = new THREE.PlaneGeometry(0.21, 0.15, 4, 3);
  g.rotateX(-PI / 2);
  k.add(g, print, { uv: A.R(0, 128, 256, 128), deform: (v) => { v.y = (hash(Math.round(v.x * 40), 3, Math.round(v.z * 40)) - 0.5) * 0.012 + 0.003; } });
  k.add(new THREE.PlaneGeometry(0.21, 0.15, 4, 3).rotateX(PI / 2), print, { uv: A.plain });
  k.colBox([0.21, 0.01, 0.15], [0, 0, 0]);
  return { kit: k, meta: { mass: 0.02, material: 'paper' } };
});

// ============================================================================ registry
const KIT_NAMES = [
  ...['', '_cooked', '_burnt'].flatMap((s) => ['mole_meat', 'crawler_meat', 'fungus_black', 'fungus_glow', 'fungus_shelf', 'fungus_puff'].map((n) => n + s)),
  'tent_ruin', 'note_scribble',
];
export const ITEMS = {};
for (const n of KIT_NAMES) ITEMS[n] = (o) => CORE[n](o);
ITEMS.canned_food_hot = (o) => buildItem('canned_food', o);
for (const [n, dev] of [['camp_stove', 'cg_stove'], ['supply_box', 'cg_supply'], ['board', 'cg_board'], ['sleeping_bag', 'cg_bag']]) ITEMS[n] = () => buildDevice(dev);
// the trolley with two casters torn off (no wheel colliders on that side: it sits on its frame)
ITEMS.trolley_broken = (o) => {
  const m = buildItem('trolley', o);
  for (const w of ['w1', 'w3']) if (m.parts[w]) m.parts[w].visible = false;
  let balls = 0;
  m.colliders = m.colliders.filter((c) => !(c.type === 'ball' && balls++ % 2 === 1));
  return m;
};
