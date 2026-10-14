// verifies the optimized GridBaker against the reference copy (node --import ./tools/dbg/register.mjs tools/dbg/bakeverify.mjs)
import * as THREE from 'three';
const { GridBaker } = await import('../../src/world/env/gridbake.js');
const Ref = (await import('./ref_gridbake.mjs')).GridBaker;
const { CHUNK } = await import('../../src/world/levels/yellow/layout.js');
let bad = 0, checked = 0;
const oBake = GridBaker.prototype.bake;
GridBaker.prototype.bake = function (geo, o) {
  const clone = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'aCell', 'aAO']) clone.setAttribute(k, geo.attributes[k].clone());
  const r = oBake.call(this, geo, o);
  if (!this._ref) this._ref = new Ref(this.seed, this.variantFn, (this.I0 + 4) / CHUNK, (this.J0 + 4) / CHUNK);
  this._ref.bake(clone, o);
  for (const k of ['aTa', 'aTb', 'aOa', 'aOb', 'aOc', 'aAO']) {
    const a = geo.attributes[k].array, b = clone.attributes[k].array;
    for (let i = 0; i < a.length; i++) { checked++; if (a[i] !== b[i]) { if (bad++ < 5) console.log('mismatch', k, i, a[i], b[i]); } }
  }
  return r;
};
const { buildChunk, makeOccluder, makeAO } = await import('../../src/world/levels/yellow/chunkbuilder.js');
for (const seed of [4242, 77, 913]) {
  const variantFn = () => 0;
  const level = { seed, variantFn, field: { uniforms: {} }, world: { physics: { addStaticBox: () => ({}) } }, lightsNear: () => [], occluder: makeOccluder(seed, variantFn), ao: makeAO(seed, variantFn), waterMaterial: new THREE.MeshBasicMaterial(), reflection: { meshes: new Set() }, prepStatic() {}, hazeOn: true };
  for (let k = 0; k < 8; k++) buildChunk(level, (k % 4) - 2, Math.floor(k / 4) - 1);
}
console.log({ checked, bad });
