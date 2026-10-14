// Runtime links that let many small contract parts share one draw call.
//
// The game drives some device parts individually: vending coils spin (parts.coils[i].rotation.z),
// products hide (parts.products[i].visible), selection buttons flash
// (parts.buttonLights[i].material.emissiveIntensity). Instead of one mesh per part, those parts are
// light proxies (empty Object3Ds at the same pivots) whose state is mirrored every frame into
//   - 'inst'  : an InstancedMesh (one instance per proxy, matrix = proxy local matrix)
//   - 'mask'  : one merged mesh whose index buffer only keeps the triangles of visible proxies
//   - 'flash' : an overlay mesh that is only drawn while its material is pushed above its rest glow
// The mirror runs in updateMatrixWorld (before culling, shadows and the main pass, so no frame lag).
// Links are registered on the template at build time and re-bound per instance by bindLinks().
import * as THREE from 'three';

const LINKS = new WeakMap();
const _m = new THREE.Matrix4();
const _z = new THREE.Vector3(0, 0, 0);

export function linkInstanced(im, proxies) { LINKS.set(im, { kind: 'inst', proxies }); }
export function linkMasked(mesh, proxies, ranges) { LINKS.set(mesh, { kind: 'mask', proxies, ranges }); }
export function linkFlash(mesh, rest) { LINKS.set(mesh, { kind: 'flash', rest }); }
// run fn every frame for this object (e.g. advance a shader clock)
export function linkTick(obj, fn) { LINKS.set(obj, { kind: 'fn', fn }); }

function hook(obj, fn) {
  const base = Object.getPrototypeOf(obj).updateMatrixWorld;
  obj.updateMatrixWorld = function (force) { fn(); return base.call(this, force); };
}

function bindInst(im, proxies) {
  if (!im.parent) return;
  im.updateMatrix();
  const inv = im.matrix.clone().invert();
  const last = new Float64Array(proxies.length * 5).fill(NaN);
  hook(im, () => {
    let dirty = false;
    for (let i = 0; i < proxies.length; i++) {
      const p = proxies[i], q = p.quaternion, o = i * 5, v = p.visible ? 1 : 0;
      if (q.x === last[o] && q.y === last[o + 1] && q.z === last[o + 2] && q.w === last[o + 3] && v === last[o + 4]) continue;
      last[o] = q.x; last[o + 1] = q.y; last[o + 2] = q.z; last[o + 3] = q.w; last[o + 4] = v;
      _m.compose(p.position, q, v ? p.scale : _z).premultiply(inv);
      im.setMatrixAt(i, _m);
      dirty = true;
    }
    if (dirty) im.instanceMatrix.needsUpdate = true;
  });
}

function bindMasked(mesh, proxies, ranges) {
  // own copy of the geometry (the template's buffers stay shared and untouched)
  const g = mesh.geometry.clone();
  g.userData.shared = false;
  mesh.geometry = g;
  const full = g.index.array.slice();
  const idx = g.index;
  const vis = new Uint8Array(proxies.length).fill(1);
  hook(mesh, () => {
    let changed = false;
    for (let i = 0; i < proxies.length; i++) {
      const v = proxies[i].visible ? 1 : 0;
      if (v !== vis[i]) { vis[i] = v; changed = true; }
    }
    if (!changed) return;
    let w = 0;
    for (let i = 0; i < proxies.length; i++) {
      const r = ranges[i];
      if (!r || !vis[i] || r[1] <= r[0]) continue;
      idx.array.set(full.subarray(r[0], r[1]), w);
      w += r[1] - r[0];
    }
    idx.needsUpdate = true;
    g.setDrawRange(0, w);
  });
}

function bindFlash(mesh, rest) {
  const thr = rest * 1.05 + 0.01;
  mesh.visible = false;
  hook(mesh, () => { mesh.visible = (mesh.material?.emissiveIntensity ?? 0) > thr; });
}

// tplRoot: template object; map: template Object3D -> instance Object3D (null: bind the template itself)
export function bindLinks(tplRoot, map = null) {
  tplRoot.traverse((o) => {
    const l = LINKS.get(o);
    if (!l) return;
    const c = map ? map.get(o) : o;
    if (!c) return;
    const P = (l.proxies || []).map((p) => (map ? map.get(p) : p)).filter(Boolean);
    if (l.kind === 'inst') bindInst(c, P);
    else if (l.kind === 'mask') bindMasked(c, P, l.ranges);
    else if (l.kind === 'flash') bindFlash(c, l.rest);
    else if (l.kind === 'fn') hook(c, l.fn);
  });
}
export const hasLinks = (o) => LINKS.has(o);
