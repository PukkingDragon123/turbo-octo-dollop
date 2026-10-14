// counts DDA work per chunk (node --import ./tools/dbg/register.mjs tools/dbg/bakecount.mjs)
import * as THREE from 'three';
const { GridBaker } = await import('../../src/world/env/gridbake.js');
let nInto = 0, nTrans = 0, nVerts = 0, nBake = 0;
const oInto = GridBaker.prototype._transInto, oTrans = GridBaker.prototype.trans, oBake = GridBaker.prototype.bake;
GridBaker.prototype._transInto = function (...a) { nInto++; return oInto.apply(this, a); };
GridBaker.prototype.trans = function (...a) { nTrans++; return oTrans.apply(this, a); };
GridBaker.prototype.bake = function (geo, o) { nBake++; nVerts += geo.attributes.position.count; return oBake.call(this, geo, o); };
const { buildChunk, makeOccluder, makeAO } = await import('../../src/world/levels/yellow/chunkbuilder.js');
const { getLayout, CELL } = await import('../../src/world/levels/yellow/layout.js');
const { LightField } = await import('../../src/gfx/bakedlight.js');
const seed = 4242, variantFn = () => 0;
const lightsNear = () => [];
const level = { seed, variantFn, field: { uniforms: {} }, world: { physics: { addStaticBox: () => ({}) } }, lightsNear, occluder: makeOccluder(seed, variantFn), ao: makeAO(seed, variantFn), waterMaterial: new THREE.MeshBasicMaterial(), reflection: { meshes: new Set() }, prepStatic() {}, hazeOn: true };
const N = 12;
for (let k = 0; k < N; k++) buildChunk(level, (k % 6) - 3, Math.floor(k / 6) - 2);
console.log({ vertsBaked: Math.round(nVerts / N), transInto: Math.round(nInto / N), trans: Math.round(nTrans / N), bakes: nBake / N });
