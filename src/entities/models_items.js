// R.O.O.M. — procedural physics-item model library (facade).
//
// The models live in ./items/ (core.js: geometry kit + registry, mats.js: PBR materials and surface detail,
// paint.js: print atlases, and one module per item family). Everything is built in code — no asset files.
//
// Exports: ITEMS, buildItem(name, opts), preloadItems(names?), itemStats(name), ITEM_NAMES()
// Result of ITEMS[name](opts): { object, colliders, mass, material, halfHeight, anchors, parts, hold, size,
//   friction?, restitution?, linearDamping?, angularDamping? }
// Item options / runtime hooks (object.userData.*):
//   flashlight   {on}                 parts.lens, anchors.lens, setOn(bool)
//   glowstick    {color, lit=true}    parts.glow (emissive), setLit(bool)
//   flare        {lit}                parts.flame (hidden unless lit), parts.cap, anchors.tip, setLit(bool)
//   lighter      {lit}                parts.flame, anchors.tip, setLit(bool)
//   welder                            anchors.tip (electrode tip)
//   sample_jar   {fill=0.65, color, glow}  parts.contents (scale.y = fill, pivot at jar floor),
//                                     anchors.contents, setFill(f), setColor(hex, emissive)
//   paper_cup    {fill=0.8}           parts.water (surface), setFill(f)
//   keycard      {level=1..5}         variant (band colour / LEVEL n)
//   photo        {variant=0..3}       variant (hallway / figure / team photo / exit)
import * as Core from './items/core.js';
import './items/tools.js';
import './items/food.js';
import './items/medical.js';
import './items/gear.js';
import './items/craft.js';
import './items/basecraft.js';
import './items/pool.js';

// Catalogue order (kept from the original library: UI lists and debug galleries iterate it)
const ORDER = [
  'flashlight', 'protein_bar', 'candy_bar', 'almond_milk', 'bandage', 'multitool', 'almond_water', 'soda_can',
  'energy_drink', 'canned_food', 'chips', 'medkit', 'antibiotics', 'painkillers', 'splint', 'paper_cup', 'welder',
  'camera_disposable', 'battery', 'glowstick', 'flare', 'lighter', 'crowbar', 'wrench', 'tape_roll', 'fuse',
  'fuel_can', 'sample_jar', 'sample_kit', 'keycard', 'noise_maker', 'spike_trap', 'barricade_panel', 'dart', 'photo',
  'clipboard', 'plank', 'metal_scrap', 'screws', 'fabric_scrap', 'wire_spool', 'pipe_short', 'gear',
];
export const ITEMS = {};
for (const k of ORDER) if (Core.ITEMS[k]) ITEMS[k] = Core.ITEMS[k];
for (const k of Object.keys(Core.ITEMS)) if (!ITEMS[k]) ITEMS[k] = Core.ITEMS[k];

export function buildItem(name, opts) {
  const f = ITEMS[name];
  if (!f) throw new Error(`Unknown item '${name}'`);
  return f(opts || {});
}

// Build (and cache) templates ahead of time, e.g. on a loading screen after web fonts have loaded
// (labels use "IBM Plex Mono" / "VT323"; building earlier bakes fallback fonts into the cache).
// Yields to the event loop every ~50 ms so a loading screen keeps animating.
export async function preloadItems(names = Object.keys(ITEMS), opts = {}) {
  let t = performance.now();
  for (const n of names) {
    if (Core.ITEMS[n]) Core.getTemplate(n, opts);
    if (performance.now() - t > 50) { await new Promise((r) => setTimeout(r, 0)); t = performance.now(); }
  }
}

// Triangle count / mesh stats for a template (debug)
export function itemStats(name, opts = {}) {
  return Core.templateStats(name, opts);
}

export const ITEM_NAMES = () => Object.keys(ITEMS);
