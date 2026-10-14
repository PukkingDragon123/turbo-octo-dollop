// R.O.O.M. — device / set-piece model library.
//
// Usage:
//   import { DEVICES, buildDevice, scoreDart } from './models_devices.js';
//   const d = buildDevice('vending_snack');   // or DEVICES.vending_snack(opts)
//   scene.add(d.object);  d.parts.coils[3].rotation.z += 0.1; ...
//
// Every builder returns { object, colliders, mass, material, anchors, parts, screens?, params?, halfHeight? }.
// Conventions: meters, Y up, FRONT FACES +Z. Floor devices have their origin at the floor under their
// centre; wall devices at the centre of their back plane (wall surface, z = 0); physics props (radio,
// crates, boxes) at their geometric centre (see halfHeight).
//
// The models are built with the device kit in ./devices/ (DKit: bevelled primitives merged per material
// class, baked AO / grime / dust, per-device print atlas, shared PBR class materials with paint chipping,
// rust and edge wear in the shader). Each (key + opts) is built once into a template; later calls clone
// it (shared geometry + shared materials). Materials that must change per instance (screens, lamps,
// glows) are flagged userData.unique and cloned per instance. Parts that the game animates one by one
// but that share a draw call (instanced coils, masked products, skinned door banks, LED groups) are
// re-bound to the clone by bindLinks (devices/sync.js).
import * as THREE from 'three';
import { NEW_BUILDERS } from './devices/index.js';
import { cloneDevMat } from './devices/mats.js';
import { bindLinks } from './devices/sync.js';
import { gaugeAngle as _gaugeAngle } from './devices/parts.js';

// Gauge needle angle (rotation.z) for v in 0..1 over the 270° scale (0 = straight up)
export function gaugeAngle(v) { return _gaugeAngle(v); }

// registry (historical key order)
const ORDER = ['vending_snack', 'vending_drink', 'water_cooler', 'aquarium', 'service_bell', 'crt_terminal', 'dart_board', 'locker', 'locker_bank',
  'employee_of_month', 'wall_clock', 'poster', 'mirror', 'ceiling_vent', 'wall_vent', 'fuse_box', 'fire_alarm', 'exit_sign', 'hazard_sign',
  'reception_desk', 'clone_tube', 'clone_console', 'clone_pad', 'dispatch_door', 'dispatch_lever', 'generator_diesel', 'generator_electric',
  'generator_mech', 'radio', 'supply_crate', 'starter_box', 'exit_door', 'exit_room_shell', 'workbench', 'coffee_machine', 'fridge',
  'server_rack', 'photocopier', 'pipe_cluster'];
const BUILDERS = {};
for (const k of ORDER) if (NEW_BUILDERS[k]) BUILDERS[k] = NEW_BUILDERS[k];
for (const k of Object.keys(NEW_BUILDERS)) if (!BUILDERS[k]) BUILDERS[k] = NEW_BUILDERS[k];

// ===========================================================================
// Template cache & cloning
// ===========================================================================
function stable(o) {
  if (o === undefined || o === null) return '';
  if (typeof o !== 'object') return JSON.stringify(o);
  if (Array.isArray(o)) return '[' + o.map(stable).join(',') + ']';
  return '{' + Object.keys(o).sort().map((k) => k + ':' + stable(o[k])).join(',') + '}';
}
function computeBounds(obj) {
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj, true);
  return { min: b.min.toArray(), max: b.max.toArray() };
}
function remapper(map) {
  const f = (v) => {
    if (v === null || v === undefined) return v;
    if (v.isObject3D) return map.get(v) || v;
    if (v.isVector3) return v.clone();
    if (Array.isArray(v)) return v.map(f);
    if (typeof v === 'object' && (v.constructor === Object || v.constructor === undefined)) {
      const o = {};
      for (const k in v) o[k] = f(v[k]);
      return o;
    }
    return v;
  };
  return f;
}
function instantiate(tpl) {
  const obj = tpl.object.clone(true);
  const a = [], b = [];
  tpl.object.traverse((o) => a.push(o));
  obj.traverse((o) => b.push(o));
  const map = new Map();
  a.forEach((o, i) => map.set(o, b[i]));
  const mats = new Map();
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    if (m && m.userData.unique) {
      if (!mats.has(m)) mats.set(m, m.userData.dvMode ? cloneDevMat(m) : m.clone());
      o.material = mats.get(m);
    }
  });
  bindLinks(tpl.object, map);
  const f = remapper(map);
  const out = {};
  for (const k in tpl) out[k] = k === 'object' ? obj : k === 'colliders' ? JSON.parse(JSON.stringify(tpl.colliders)) : f(tpl[k]);
  return out;
}

const TEMPLATES = new Map();
export function buildDevice(name, opts = {}) {
  const b = BUILDERS[name];
  if (!b) throw new Error(`[models_devices] unknown device '${name}'`);
  const key = name + '|' + stable(opts || {});
  let tpl = TEMPLATES.get(key);
  if (!tpl) {
    tpl = b(opts || {});
    tpl.object.name = name;
    tpl.object.userData.device = name;
    if (!tpl.bounds) tpl.bounds = computeBounds(tpl.object);
    TEMPLATES.set(key, tpl);
  }
  return instantiate(tpl);
}
export const DEVICES = Object.fromEntries(Object.keys(BUILDERS).map((n) => [n, (opts) => buildDevice(n, opts)]));
export const DEVICE_NAMES = Object.keys(BUILDERS);
export function clearDeviceCache() { TEMPLATES.clear(); }

// ---------------------------------------------------------------------------
// Dart scoring (board-local meters, board center = origin, +Y = up / the "20")
// ---------------------------------------------------------------------------
export const DART_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
export const DART_RADII = { bull: 0.00635, outerBull: 0.0159, tripleIn: 0.099, tripleOut: 0.107, doubleIn: 0.162, doubleOut: 0.17, board: 0.225 };
export function scoreDart(localX, localY) {
  const r = Math.hypot(localX, localY);
  if (r <= DART_RADII.bull) return { score: 50, label: 'BULL', ring: 'bull', number: 50, mult: 1 };
  if (r <= DART_RADII.outerBull) return { score: 25, label: '25', ring: 'outerBull', number: 25, mult: 1 };
  if (r > DART_RADII.doubleOut) return { score: 0, label: 'MISS', ring: r <= DART_RADII.board ? 'outer' : 'off', number: 0, mult: 0 };
  const ang = Math.atan2(localY, localX) * 180 / Math.PI; // CCW from +X
  const idx = (((Math.round((90 - ang) / 18) % 20) + 20) % 20);
  const n = DART_ORDER[idx];
  if (r >= DART_RADII.tripleIn && r <= DART_RADII.tripleOut) return { score: n * 3, label: 'T' + n, ring: 'triple', number: n, mult: 3 };
  if (r >= DART_RADII.doubleIn) return { score: n * 2, label: 'D' + n, ring: 'double', number: n, mult: 2 };
  return { score: n, label: String(n), ring: 'single', number: n, mult: 1 };
}
