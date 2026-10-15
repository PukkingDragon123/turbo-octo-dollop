// Model catalog: one lookup over the furniture / item / device model libraries.
// Uses import.meta.glob so missing libraries degrade to placeholder boxes instead of crashing.
//
// Furniture value API (Level 0 economy):
//   furnitureValue(type, mass?, state?) -> $ the teleport pads pay for one prop of that type. Delegates to
//     itemdefs.sellValue() (SELL_VALUE table / ITEM[type].sell / mass estimate) when the game provides it.
//   FURNITURE_INFO[type] -> { name, sell, dismantle? } for the furniture types added for Level 0 (new models and
//     device models that spawn as haulable props). On load these are merged into itemdefs ITEM for every type
//     that has no entry yet, so prop.def.name / prop.def.sell / sellValue() see them like any other furniture.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import * as Mat from '../gfx/materials.js';
import * as Items from '../game/itemdefs.js';

const mods = import.meta.glob('./models_*.js', { eager: true });
const registries = [];
for (const m of Object.values(mods)) {
  for (const k of ['FURNITURE', 'ITEMS', 'DEVICES']) if (m[k]) registries.push({ kind: k, reg: m[k] });
}

// Level 0 furniture added with the haul-and-sell loop ($ values sit with the SELL_VALUE scale in itemdefs.js:
// couch 210, desk 160, filing cabinet 125 ...)
export const FURNITURE_INFO = {
  dresser: { name: 'Dresser', sell: 150, dismantle: ['plank', 'plank', 'plank', 'screws'] },
  nightstand: { name: 'Nightstand', sell: 55, dismantle: ['plank', 'screws'] },
  cabinet_low: { name: 'Storage Cabinet', sell: 95, dismantle: ['metal_scrap', 'plank', 'screws'] },
  arcade_cabinet: { name: 'Arcade Machine', sell: 340, dismantle: ['plank', 'plank', 'wire_spool', 'metal_scrap', 'screws'] },
  piano: { name: 'Upright Piano', sell: 480, dismantle: ['plank', 'plank', 'plank', 'wire_spool', 'metal_scrap'] },
  vending_snack: { name: 'Snack Machine', sell: 290, dismantle: ['metal_scrap', 'metal_scrap', 'wire_spool', 'gear'] },
  vending_drink: { name: 'Drinks Machine', sell: 290, dismantle: ['metal_scrap', 'metal_scrap', 'wire_spool', 'gear'] },
  locker: { name: 'Locker', sell: 105, dismantle: ['metal_scrap', 'metal_scrap', 'screws'] },
  fridge: { name: 'Fridge', sell: 185, dismantle: ['metal_scrap', 'metal_scrap', 'wire_spool'] },
  water_cooler: { name: 'Water Cooler', sell: 65, dismantle: ['metal_scrap', 'wire_spool'] },
  photocopier: { name: 'Photocopier', sell: 230, dismantle: ['metal_scrap', 'gear', 'wire_spool', 'screws'] },
  server_rack: { name: 'Server Rack', sell: 270, dismantle: ['metal_scrap', 'metal_scrap', 'wire_spool', 'wire_spool'] },
  coffee_machine: { name: 'Coffee Machine', sell: 60, dismantle: ['metal_scrap', 'wire_spool'] },
  cake: { name: 'Office Cake', sell: 12 },
  balloon: { name: 'Balloon', sell: 3 },
  party_hat: { name: 'Party Hat', sell: 2 },
};
for (const [k, v] of Object.entries(FURNITURE_INFO)) {
  if (!Items.ITEM) break;
  if (!Items.ITEM[k]) Items.ITEM[k] = { ...v };
  else if (Items.ITEM[k].sell === undefined && Items.SELL_VALUE?.[k] === undefined) Items.ITEM[k].sell = v.sell;
}

export function furnitureValue(type, mass = 5, state = null) {
  if (Items.sellValue) return Items.sellValue(type, mass, state);
  const d = Items.ITEM?.[type];
  return d?.sell ?? FURNITURE_INFO[type]?.sell ?? Math.round(Math.min(120, Math.max(4, mass * 3)));
}

export function hasModel(key) {
  return registries.some((r) => r.reg[key]);
}

function placeholder(key) {
  const g = new RoundedBoxGeometry(0.4, 0.4, 0.4, 2, 0.04);
  const mesh = new THREE.Mesh(g, Mat.get('plastic_orange'));
  mesh.castShadow = true;
  const obj = new THREE.Group();
  obj.add(mesh);
  obj.name = `placeholder:${key}`;
  return { object: obj, colliders: [{ type: 'box', size: [0.4, 0.4, 0.4], pos: [0, 0, 0] }], mass: 3, material: 'plastic', halfHeight: 0.2, anchors: {}, parts: {} };
}

const hhCache = new Map();
// origin-to-floor distance of a model (cached; builds the model once)
export function modelHalfHeight(key) {
  if (!hhCache.has(key)) {
    const m = buildModel(key, { seed: 1 });
    hhCache.set(key, m.halfHeight ?? 0.2);
  }
  return hhCache.get(key);
}

export function buildModel(key, opts = {}) {
  for (const r of registries) {
    const f = r.reg[key];
    if (f) {
      let res;
      let o = opts || {};
      // device models are cached per (name + opts): fold per-prop seeds (prop ids, positions) onto a few looks,
      // or every spawned vending machine / wall vent would build (and AO-bake) its own template
      if (r.kind === 'DEVICES' && o.seed !== undefined) o = { ...o, seed: ((o.seed | 0) % 3 + 3) % 3 };
      try {
        res = f(o);
      } catch (e) {
        console.error('[catalog] build failed', key, e);
        return placeholder(key);
      }
      res.anchors = res.anchors || {};
      res.parts = res.parts || {};
      res.kind = r.kind;
      res.object.traverse((o2) => {
        if (o2.isMesh) {
          // shadows on by default; a model can opt a mesh out (decals, tiny parts) with userData.noShadow
          o2.castShadow = !o2.userData.noShadow;
          o2.receiveShadow = true;
        }
      });
      if (res.halfHeight === undefined) {
        const b = new THREE.Box3().setFromObject(res.object);
        res.halfHeight = r.kind === 'DEVICES' ? 0 : -b.min.y;
      }
      return res;
    }
  }
  return placeholder(key);
}
