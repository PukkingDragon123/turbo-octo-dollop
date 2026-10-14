// per-material vertex / triangle counts per chunk (node --import ./tools/dbg/register.mjs tools/dbg/vertsper.mjs)
import * as THREE from 'three';
const { buildChunk, makeOccluder, makeAO } = await import('../../src/world/levels/yellow/chunkbuilder.js');
const seed = 4242, variantFn = () => 0;
const level = { seed, variantFn, field: { uniforms: {} }, world: { physics: { addStaticBox: () => ({}) } }, lightsNear: () => [], occluder: makeOccluder(seed, variantFn), ao: makeAO(seed, variantFn), waterMaterial: new THREE.MeshBasicMaterial(), reflection: { meshes: new Set() }, prepStatic() {}, hazeOn: true };
const per = {}; const N = 24;
for (let k = 0; k < N; k++) {
  const rec = buildChunk(level, (k % 6) - 3, Math.floor(k / 6) - 2);
  for (const o of rec.group.children) {
    if (!o.isMesh) continue;
    const key = (o.material.name || o.material.type) + (o.material.userData?.tag ? ':' + o.material.userData.tag : '');
    const p = per[key] || (per[key] = { v: 0, t: 0, n: 0 });
    p.v += o.geometry.attributes.position.count; p.t += o.geometry.index ? o.geometry.index.count / 3 : 0; p.n++;
  }
}
for (const [k, p] of Object.entries(per).sort((a, b) => b[1].v - a[1].v)) console.log(k.padEnd(30), 'verts', Math.round(p.v / N), 'tris', Math.round(p.t / N), 'in', p.n, 'chunks');
