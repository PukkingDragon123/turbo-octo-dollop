// Distance proxies for the detailed catalog machines standing in the valley (generators, the workbench, the
// vending machine and television anomalies...). Up close each is the real interactive device (often 20-60
// meshes); past a few metres it is swapped for a static copy merged into one mesh per material, sharing the
// very same material objects (lamps, CRT screens and the interior-light patch keep working). Rebuilt when the
// device's state changes (fuel caps, fuses, opened panels).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _inv = new THREE.Matrix4();
const _m = new THREE.Matrix4();

function usesUv(mat) {
  return !!(mat.map || mat.normalMap || mat.roughnessMap || mat.metalnessMap || mat.aoMap || mat.emissiveMap || mat.alphaMap || mat.bumpMap || mat.displacementMap);
}

// plain (non-interleaved, non-normalized) Float32 copy of an attribute
function plain(a) {
  if (!a.isInterleavedBufferAttribute && a.array instanceof Float32Array && !a.normalized) return a;
  const f = new Float32Array(a.count * a.itemSize);
  for (let i = 0; i < a.count; i++) for (let j = 0; j < a.itemSize; j++) f[i * a.itemSize + j] = a.getComponent(i, j);
  return new THREE.BufferAttribute(f, a.itemSize);
}

function visibleChain(o, root) {
  for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return false;
  return true;
}

// one non-indexed geometry slice per (mesh, material); null if this object can't be proxied
function slices(root) {
  root.updateMatrixWorld(true);
  _inv.copy(root.matrixWorld).invert();
  const out = new Map(); // material -> [geometry]
  let ok = true;
  root.traverse((o) => {
    if (!ok) return;
    if (o.isSkinnedMesh || o.isInstancedMesh || (o.isMesh && o.geometry.morphAttributes?.position)) { ok = false; return; }
    if (!o.isMesh || !visibleChain(o, root)) return;
    const src = o.geometry;
    if (!src.attributes.position) return;
    const ng = src.index ? src.toNonIndexed() : src;
    let g = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv', 'color']) if (ng.attributes[k]) g.setAttribute(k, plain(ng.attributes[k]).clone());
    if (ng !== src) ng.dispose();
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(_m.multiplyMatrices(_inv, o.matrixWorld));
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const groups = Array.isArray(o.material) && src.groups.length ? src.groups : [{ start: 0, count: g.attributes.position.count, materialIndex: 0 }];
    for (const gr of groups) {
      const mat = mats[gr.materialIndex ?? 0];
      if (!mat || !mat.visible) continue;
      let part = g;
      if (groups.length > 1 || gr.start !== 0 || gr.count !== g.attributes.position.count) {
        part = new THREE.BufferGeometry();
        for (const k of Object.keys(g.attributes)) {
          const a = g.attributes[k];
          const n = Math.min(gr.count, a.count - gr.start);
          if (n <= 0) continue;
          part.setAttribute(k, new THREE.BufferAttribute(a.array.slice(gr.start * a.itemSize, (gr.start + n) * a.itemSize), a.itemSize, a.normalized));
        }
      }
      if (!out.has(mat)) out.set(mat, []);
      out.get(mat).push(part);
    }
  });
  return ok ? out : null;
}

// conform a list of geometries to one attribute set the material needs, then merge
function mergeFor(mat, list) {
  const wantUv = usesUv(mat), wantColor = !!mat.vertexColors;
  const fixed = list.map((g) => {
    const n = g.attributes.position.count;
    const h = new THREE.BufferGeometry();
    h.setAttribute('position', g.attributes.position);
    h.setAttribute('normal', g.attributes.normal || new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    if (wantUv) h.setAttribute('uv', g.attributes.uv && g.attributes.uv.itemSize === 2 ? g.attributes.uv : new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (wantColor) {
      const c = g.attributes.color;
      h.setAttribute('color', c && c.itemSize === 3 ? c : new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    }
    for (const k of Object.keys(h.attributes)) h.setAttribute(k, plain(h.attributes[k]));
    return h;
  });
  return mergeGeometries(fixed, false);
}

export function buildProxy(root, { shadows = true } = {}) {
  const parts = slices(root);
  if (!parts || !parts.size) return null;
  const g = new THREE.Group();
  g.name = 'proxy';
  for (const [mat, list] of parts) {
    const geo = mergeFor(mat, list);
    for (const x of list) x.dispose();
    if (!geo) continue;
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = shadows && !mat.transparent;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.name = 'proxy';
    g.add(mesh);
  }
  g.matrixAutoUpdate = false;
  g.matrix.copy(root.matrixWorld);
  g.matrixWorld.copy(root.matrixWorld);
  for (const c of g.children) c.matrixWorld.copy(root.matrixWorld);
  g.userData.proxy = true;
  return g;
}

export function disposeProxy(g) {
  if (!g) return;
  g.removeFromParent();
  for (const c of g.children) c.geometry.dispose();
}

// a device's visual state signature: rebuild the proxy when it changes
export function stateSig(dev) {
  try { return JSON.stringify(dev.state || null); } catch { return ''; }
}
