// Procedural furniture / prop model library for R.O.O.M.
//
// Every model is built in code (no asset files): beveled and bent wood, upholstered cushions with
// piping, tufting, sag and wrinkles, sheet metal with folded edges, hardware (screws, glides,
// casters, pulls, hinges), printed labels from a shared canvas atlas, and GPU-synthesised PBR
// texture sets (src/gfx/texsynth.js: wood, weave, painted steel, plastics, ...). A voxel AO bake
// plus per-vertex edge / grime masks drive worn edges, dirt and dust in a small shader patch.
// Static sub-meshes are merged per material (typically 2-6 draw calls per prop) and cached per
// (name, geometry variant), so spawning 200 chairs only creates new Object3D trees.
//
//   import { FURNITURE, buildFurniture } from './models_furniture.js';
//   const f = buildFurniture('chair_office', { seed: 42, color: 0x3a4a6a });
//   f.object, f.colliders, f.mass, f.material, f.halfHeight, f.anchors, f.parts, f.breakInto
//   (+ optional f.friction / f.restitution / f.linearDamping / f.angularDamping for props.js)
//
// Conventions: meters, Y up, front of a model faces +Z. ORIGIN = bounding-box center.
// Colliders: {type:'box', size:[w,h,d], pos, rot?} | {type:'cylinder', radius, height, pos, rot?}
// (cylinder axis = Y) | {type:'ball', radius, pos} | {type:'capsule', radius, halfHeight, pos, rot?};
// `rot` is an XYZ Euler in radians. Colliders hug the visuals (compound, <= 8 shapes) and their
// lowest point equals the lowest visual point, so props rest on the floor without floating/sinking.
// opts: { seed, variant, color } — variant picks a cached look (geometry, wear, labels, colours),
// seed picks a variant deterministically, color tints the main fabric / paint / plastic.
import { FURNITURE, DEFS, getTemplate, geoVariants, templateInfo, buildFurniture as build } from './furniture/core.js';
import { atlasTex, atlasInfo } from './furniture/atlas.js';
import { matFor, warmMaterials, textureBytes } from './furniture/mats.js';
import './furniture/labels.js';
import './furniture/seating.js';
import './furniture/tables.js';
import './furniture/storage.js';
import './furniture/beds.js';
import './furniture/electronics.js';
import './furniture/decor.js';
import './furniture/utility.js';
import './furniture/loot.js';

export { FURNITURE };

export function buildFurniture(name, opts) {
  const r = build(name, opts);
  r.object.traverse((m) => {
    if (!m.isMesh) return;
    m.receiveShadow = true;
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
  });
  return r;
}

// Pre-build every template (all geometry variants), the label atlas, every texture set and every
// material a model can use (incl. per-variant tints), e.g. during a loading screen, so nothing is
// generated mid-game. Yields between models.
export async function warmFurniture(onProgress) {
  atlasTex();
  warmMaterials();
  const names = Object.keys(FURNITURE);
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    for (const v of geoVariants(name)) {
      const t = getTemplate(name, v);
      for (const pk of [t.main, ...t.parts]) for (const m of [...pk.meshes, ...pk.named]) matFor(m.slot);
    }
    const nv = DEFS[name].variants || 1;
    if (DEFS[name].mats) for (let v = 0; v < nv; v++) DEFS[name].mats({}, v);
    onProgress?.((i + 1) / names.length, name);
    await new Promise((r) => setTimeout(r, 0));
  }
  const t = atlasTex();
  t.needsUpdate = true;
}

// Debug / info
export const furnitureAtlas = () => atlasInfo();
export function furnitureInfo(name, variant = 0) {
  return templateInfo(name, variant);
}
export const furnitureTextureBytes = () => textureBytes();
