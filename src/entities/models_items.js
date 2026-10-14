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
import * as Legacy from './items/legacy.js';
import * as Core from './items/core.js';
import './items/tools.js';

export const ITEMS = {};
const order = Object.keys(Legacy.ITEMS);
for (const k of Object.keys(Core.ITEMS)) if (!order.includes(k)) order.push(k);
for (const k of order) ITEMS[k] = Core.ITEMS[k] || Legacy.ITEMS[k];

export function buildItem(name, opts) {
  const f = ITEMS[name];
  if (!f) throw new Error(`Unknown item '${name}'`);
  return f(opts || {});
}

// Build (and cache) templates ahead of time, e.g. on a loading screen after web fonts have loaded
// (labels use "IBM Plex Mono" / "VT323"; building earlier bakes fallback fonts into the cache).
export async function preloadItems(names = Object.keys(ITEMS), opts = {}) {
  let t = performance.now();
  for (const n of names) {
    if (Core.ITEMS[n]) Core.getTemplate(n, opts);
    else if (Legacy.ITEMS[n]) Legacy.preloadItems([n], opts);
    if (performance.now() - t > 50) { await new Promise((r) => setTimeout(r, 0)); t = performance.now(); }
  }
}

// Triangle count / mesh stats for a template (debug)
export function itemStats(name, opts = {}) {
  return Core.ITEMS[name] ? Core.templateStats(name, opts) : Legacy.itemStats(name, opts);
}

export const ITEM_NAMES = () => Object.keys(ITEMS);
