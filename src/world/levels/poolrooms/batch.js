// Static batching for chunk furniture. Room set pieces (shared catalogue models: pipe clusters,
// locker banks, sunken desks ...) arrive as many small meshes; once placed they never move, so
// their meshes are merged per material into one mesh per material and room, keeping a furnished
// chunk inside the draw-call budget. Each batch keeps its own probe (sampled at its centroid).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _t = new THREE.Matrix4();
const _p = new THREE.Vector3();

function signature(g) {
  let s = '';
  for (const k of Object.keys(g.attributes).sort()) {
    const a = g.attributes[k];
    if (a.isInterleavedBufferAttribute || !a.array) return null;
    s += `${k}:${a.itemSize}${a.normalized ? 'n' : ''}${a.array.constructor.name},`;
  }
  return s + (g.index ? 'i' : 'n');
}

// Materials flagged unique (per-instance screens / name cards) are interchangeable when they show
// the same cached texture with the same parameters, so they may share one batch.
function matKey(m) {
  const u = m.userData;
  if (u?.unique && m.map) {
    const hx = (c) => (c?.getHexString ? c.getHexString() : '');
    return `u:${m.type}:${m.map.uuid}:${m.emissiveMap?.uuid || ''}:${hx(m.color)}:${hx(m.emissive)}:${(m.emissiveIntensity ?? 0).toFixed(3)}:${(m.roughness ?? 0).toFixed(3)}:${(m.metalness ?? 0).toFixed(3)}:${m.transparent ? 1 : 0}:${u.probe ? 1 : 0}`;
  }
  return m.uuid;
}

function visibleChain(o, stop) {
  for (let p = o; p && p !== stop; p = p.parent) if (!p.visible) return false;
  return true;
}

export function batchStatics(level, rec) {
  const roots = (rec.statics || []).filter((o) => o.parent === rec.group && !o.isInstancedMesh && o !== rec.floatMesh && !o.userData.noBatch);
  if (!roots.length) return 0;
  const groups = new Map();
  for (const root of roots) {
    let skinned = false;
    root.traverse((m) => { if (m.isSkinnedMesh) skinned = true; });
    if (skinned) continue; // posed characters keep their rig
    root.updateMatrixWorld(true);
    root.traverse((m) => {
      if (!m.isMesh || m.isInstancedMesh || Array.isArray(m.material) || m.morphTargetInfluences) return;
      const g = m.geometry;
      if (!g?.attributes?.position || (g.groups && g.groups.length > 1) || m.userData.noBatch) return;
      if (!visibleChain(m, rec.group) || m.matrixWorld.determinant() <= 0) return;
      const sig = signature(g);
      if (!sig) return;
      const key = `${matKey(m.material)}|${sig}|${m.castShadow ? 1 : 0}|${root.userData.noRefl ? 1 : 0}`;
      let e = groups.get(key);
      if (!e) groups.set(key, (e = { mat: m.material, cast: m.castShadow, noRefl: !!root.userData.noRefl, list: [] }));
      e.list.push(m);
    });
  }
  let saved = 0;
  for (const e of groups.values()) {
    if (e.list.length < 2) continue;
    const c = new THREE.Vector3();
    for (const m of e.list) c.add(_p.setFromMatrixPosition(m.matrixWorld));
    c.divideScalar(e.list.length);
    _t.makeTranslation(-c.x, -c.y, -c.z);
    const geos = e.list.map((m) => m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(_t, m.matrixWorld)));
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    const batch = new THREE.Mesh(merged, e.mat);
    batch.name = 'room_batch';
    batch.position.copy(c);
    batch.castShadow = e.cast;
    batch.receiveShadow = true;
    batch.userData.noRefl = e.noRefl;
    batch.userData.batch = true;
    rec.group.add(batch);
    batch.updateMatrixWorld(true);
    level.prepStatic(batch, rec);
    for (const m of e.list) m.removeFromParent();
    saved += e.list.length - 1;
  }
  return saved;
}
