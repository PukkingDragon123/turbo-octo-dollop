// dev-only: compare every model's collider bounds against its visual bounds (served by the vite test server)
import * as THREE from 'three';
import { buildModel } from '../../src/entities/catalog.js';
import { FURNITURE } from '../../src/entities/models_furniture.js';
import { ITEMS } from '../../src/entities/models_items.js';
import { DEVICES } from '../../src/entities/models_devices.js';

// exact AABB of a collider set (rotated shapes included)
function exactBounds(cols) {
  const box = new THREE.Box3(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (const c of cols) {
    q.setFromEuler(e.set(c.rot?.[0] || 0, c.rot?.[1] || 0, c.rot?.[2] || 0));
    m.makeRotationFromQuaternion(q);
    const R = m.elements; // column-major: R[col*4+row]
    const r = (row, col) => R[col * 4 + row];
    const p = new THREE.Vector3(...(c.pos || [0, 0, 0]));
    const h = new THREE.Vector3();
    for (let i = 0; i < 3; i++) {
      let v;
      if (c.type === 'box') v = Math.abs(r(i, 0)) * c.size[0] / 2 + Math.abs(r(i, 1)) * c.size[1] / 2 + Math.abs(r(i, 2)) * c.size[2] / 2;
      else if (c.type === 'ball') v = c.radius;
      else if (c.type === 'cylinder') { const a = Math.abs(r(i, 1)); v = a * c.height / 2 + c.radius * Math.sqrt(Math.max(0, 1 - a * a)); }
      else { const a = Math.abs(r(i, 1)); v = a * c.halfHeight + c.radius; }
      h.setComponent(i, v);
    }
    box.expandByPoint(p.clone().sub(h)); box.expandByPoint(p.clone().add(h));
  }
  return box;
}

export function audit(filter = null) {
  const out = [];
  const kinds = [['F', FURNITURE], ['I', ITEMS], ['D', DEVICES]];
  for (const [kind, reg] of kinds) {
    for (const key of Object.keys(reg)) {
      if (filter && !filter.includes(key)) continue;
      let m;
      try { m = buildModel(key, { seed: 1 }); } catch (e) { out.push({ key, kind, err: String(e) }); continue; }
      const vis = new THREE.Box3();
      m.object.updateMatrixWorld(true);
      m.object.traverse((o) => {
        if (!o.isMesh || !o.visible || o.userData.decal || o.userData.noBounds) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        vis.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
      });
      const cols = m.colliders || [];
      if (!cols.length) { out.push({ key, kind, noCol: true }); continue; }
      const col = exactBounds(cols);
      const vs = vis.getSize(new THREE.Vector3()), cs = col.getSize(new THREE.Vector3());
      const r = (a, b) => (b > 0.02 ? +(a / b).toFixed(2) : 1);
      out.push({
        key, kind, n: cols.length, hh: +(m.halfHeight ?? 0).toFixed(3), mass: m.mass,
        vis: [vs.x, vs.y, vs.z].map((v) => +v.toFixed(3)), col: [cs.x, cs.y, cs.z].map((v) => +v.toFixed(3)),
        dyMin: +(col.min.y - vis.min.y).toFixed(3), dyMax: +(col.max.y - vis.max.y).toFixed(3),
        rx: r(cs.x, vs.x), ry: r(cs.y, vs.y), rz: r(cs.z, vs.z),
        cOff: [(col.min.x + col.max.x) / 2 - (vis.min.x + vis.max.x) / 2, (col.min.z + col.max.z) / 2 - (vis.min.z + vis.max.z) / 2].map((v) => +v.toFixed(3)),
      });
      m.object.traverse((o) => { if (o.isMesh) o.geometry?.dispose?.(); });
    }
  }
  return out;
}
