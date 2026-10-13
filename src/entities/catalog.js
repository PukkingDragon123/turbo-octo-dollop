// Model catalog: one lookup over the furniture / item / device model libraries.
// Uses import.meta.glob so missing libraries degrade to placeholder boxes instead of crashing.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import * as Mat from '../gfx/materials.js';

const mods = import.meta.glob('./models_*.js', { eager: true });
const registries = [];
for (const m of Object.values(mods)) {
  for (const k of ['FURNITURE', 'ITEMS', 'DEVICES']) if (m[k]) registries.push({ kind: k, reg: m[k] });
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
      try {
        res = f(opts || {});
      } catch (e) {
        console.error('[catalog] build failed', key, e);
        return placeholder(key);
      }
      res.anchors = res.anchors || {};
      res.parts = res.parts || {};
      res.kind = r.kind;
      res.object.traverse((o) => {
        if (o.isMesh) {
          if (o.castShadow === undefined || o.castShadow === false) o.castShadow = true;
          o.receiveShadow = true;
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
