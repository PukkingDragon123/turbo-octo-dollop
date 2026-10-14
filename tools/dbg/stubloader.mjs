// ESM loader hooks for the chunk-build CPU benchmark: swaps browser-only modules for stubs.
const STUBS = {
  'gfx/materials.js': 'tools/dbg/stub_materials.mjs',
  'entities/catalog.js': 'tools/dbg/stub_catalog.mjs',
  'game/devicekinds.js': 'tools/dbg/stub_empty.mjs',
  'game/itemdefs.js': 'tools/dbg/stub_empty.mjs',
};
const ROOT = new URL('../../', import.meta.url);
export async function resolve(specifier, context, next) {
  if (specifier === 'three') return { url: new URL('node_modules/three/build/three.module.js', ROOT).href, shortCircuit: true };
  for (const [k, v] of Object.entries(STUBS)) if (specifier.endsWith(k)) return { url: new URL(v, ROOT).href, shortCircuit: true };
  return next(specifier, context);
}
