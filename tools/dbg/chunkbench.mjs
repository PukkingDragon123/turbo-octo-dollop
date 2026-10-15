// CPU-time benchmark of Level 0 chunk building (node --import ./tools/dbg/register.mjs tools/dbg/chunkbench.mjs)
import * as THREE from 'three';
const { buildChunk, buildStats, makeOccluder, makeAO } = await import('../../src/world/levels/yellow/chunkbuilder.js');
const { getLayout, CELL } = await import('../../src/world/levels/yellow/layout.js');
const { LightField } = await import('../../src/gfx/bakedlight.js');
const seed = +(process.argv[2] || 4242);
const variantFn = () => 0;
const lights = new Map();
const lightsNear = (x, z) => {
  const out = []; const i0 = Math.floor(x / CELL), j0 = Math.floor(z / CELL);
  for (let j = j0 - 3; j <= j0 + 3; j++) for (let i = i0 - 3; i <= i0 + 3; i++) {
    const c = getLayout(seed, Math.floor(i / 8), Math.floor(j / 8), 0).cells[(j - Math.floor(j / 8) * 8) * 8 + (i - Math.floor(i / 8) * 8)];
    if (c.light) out.push({ key: LightField.texel(i, j), x: (i + 0.5) * CELL, y: 2.86, z: (j + 0.5) * CELL, radius: 9 });
  }
  return out;
};
const level = { seed, variantFn, field: { uniforms: {} }, world: { physics: { addStaticBox: () => ({}), addStaticCollidersFromDesc: () => ({ colliders: [], body: {} }) } }, lightsNear, occluder: makeOccluder(seed, variantFn), ao: makeAO(seed, variantFn), waterMaterial: new THREE.MeshBasicMaterial(), reflection: { meshes: new Set() }, prepStatic() {}, hazeOn: true };
// warm-up (JIT)
for (let k = 0; k < 6; k++) buildChunk(level, 50 + k, 50);
for (const k in buildStats) buildStats[k] = 0;
const N = +(process.argv[3] || 24);
const cpu0 = process.cpuUsage();
const t0 = performance.now();
let verts = 0, tris = 0, meshes = 0;
for (let k = 0; k < N; k++) {
  const rec = buildChunk(level, (k % 6) - 3, Math.floor(k / 6) - 2);
  rec.group.traverse((o) => { if (o.isMesh) { meshes++; verts += o.geometry.attributes.position.count; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
}
const cpu = process.cpuUsage(cpu0);
const wall = performance.now() - t0;
const ms = (cpu.user + cpu.system) / 1000 / N;
console.log(JSON.stringify({ cpuMsPerChunk: +ms.toFixed(1), wallMsPerChunk: +(wall / N).toFixed(1), meshesPerChunk: +(meshes / N).toFixed(1), vertsPerChunk: Math.round(verts / N), trisPerChunk: Math.round(tris / N),
  phasesWallMs: Object.fromEntries(['geo', 'bake', 'mat', 'water', 'decor', 'phys'].map((p) => [p, +(buildStats[p] / N).toFixed(1)])) }));
