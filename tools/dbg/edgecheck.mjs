// checks the shader's per-pixel inner-ring formula (decoded aEdgeT) against the baked per-vertex transmissions
import * as THREE from 'three';
const { GridBaker } = await import('../../src/world/env/gridbake.js');
const { WALL_T } = await import('../../src/gfx/bakedlight.js');
let n = 0, bad = 0, inside = 0;
const oBake = GridBaker.prototype.bake;
GridBaker.prototype.bake = function (geo, o) {
  const r = oBake.call(this, geo, o);
  if ((o?.quant ?? 0.02) >= 0.1) return r; // coarse meshes share results across buckets
  const P = geo.attributes.position.array, Nn = geo.attributes.normal.array, Cc = geo.attributes.aCell.array;
  const Ta = geo.attributes.aTa.array, Tb = geo.attributes.aTb.array, E = geo.attributes.aEdgeT.array;
  const C = 3;
  for (let v = 0; v < P.length / 3; v++) {
    n++;
    const fx = P[v * 3] + Nn[v * 3] * 0.05 - Cc[v * 2] * C, fz = P[v * 3 + 2] + Nn[v * 3 + 2] * 0.05 - Cc[v * 2 + 1] * C;
    if (!(fx >= 0 && fz >= 0 && fx < C && fz < C)) continue;
    inside++;
    let pa = E[v * 2], pb = E[v * 2 + 1]; const ed = [];
    for (let q = 0; q < 6; q++) { ed.push(WALL_T[pa % 8]); pa = Math.floor(pa / 8); }
    for (let q = 0; q < 6; q++) { ed.push(WALL_T[pb % 8]); pb = Math.floor(pb / 8); }
    const tr = new Array(9);
    tr[1] = ed[0]; tr[7] = ed[1]; tr[3] = ed[2]; tr[5] = ed[3];
    const txN = fx / (fx + 0.5 * C), txP = (C - fx) / (1.5 * C - fx), tzN = fz / (fz + 0.5 * C), tzP = (C - fz) / (1.5 * C - fz);
    tr[0] = txN < tzN ? ed[2] * ed[4] : ed[0] * ed[5];
    tr[2] = txP < tzN ? ed[3] * ed[6] : ed[0] * ed[7];
    tr[6] = txN < tzP ? ed[2] * ed[8] : ed[1] * ed[9];
    tr[8] = txP < tzP ? ed[3] * ed[10] : ed[1] * ed[11];
    // lit bits
    tr[0] *= pa % 2; tr[1] *= Math.floor(pa / 2) % 2; tr[2] *= Math.floor(pa / 4) % 2; tr[3] *= Math.floor(pa / 8);
    tr[5] *= pb % 2; tr[6] *= Math.floor(pb / 2) % 2; tr[7] *= Math.floor(pb / 4) % 2; tr[8] *= Math.floor(pb / 8);
    const baked = [Ta[v * 4], Ta[v * 4 + 1], Ta[v * 4 + 2], Ta[v * 4 + 3], null, Tb[v * 4], Tb[v * 4 + 1], Tb[v * 4 + 2], Tb[v * 4 + 3]];
    for (const k of [0, 1, 2, 3, 5, 6, 7, 8]) {
      if (Math.abs(baked[k] / 255 - tr[k]) > 0.6 / 255) { if (bad++ < 6) console.log('mismatch v', v, 'k', k, baked[k] / 255, tr[k], fx, fz); }
    }
  }
  return r;
};
const { buildChunk, makeOccluder, makeAO } = await import('../../src/world/levels/yellow/chunkbuilder.js');
for (const seed of [4242, 77]) {
  const variantFn = () => 0;
  const level = { seed, variantFn, field: { uniforms: {} }, world: { physics: { addStaticBox: () => ({}) } }, lightsNear: () => [], occluder: makeOccluder(seed, variantFn), ao: makeAO(seed, variantFn), waterMaterial: new THREE.MeshBasicMaterial(), reflection: { meshes: new Set() }, prepStatic() {}, hazeOn: true };
  for (let k = 0; k < 8; k++) buildChunk(level, (k % 4) - 2, Math.floor(k / 4) - 1);
}
console.log({ verts: n, inside, bad });
