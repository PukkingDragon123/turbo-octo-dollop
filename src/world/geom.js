// Geometry accumulation helpers for building merged static world meshes (UVs in meters).
import * as THREE from 'three';

export class GeoBuilder {
  constructor(withWet = false) {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.idx = [];
    this.wet = withWet ? [] : null;
    this.vcount = 0;
  }

  // Quad grid: origin o, axes a (u direction, full length) and b (v direction), normal n.
  // uvFn(p) -> [u,v] (defaults to planar using provided uvA/uvB scales)
  grid(o, a, b, n, nu, nv, uvFn, wetFn) {
    const base = this.vcount;
    const p = new THREE.Vector3();
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        p.copy(o).addScaledVector(a, i / nu).addScaledVector(b, j / nv);
        this.pos.push(p.x, p.y, p.z);
        this.nor.push(n.x, n.y, n.z);
        const uv = uvFn(p, i / nu, j / nv);
        this.uv.push(uv[0], uv[1]);
        if (this.wet) this.wet.push(wetFn ? wetFn(p) : 0);
        this.vcount++;
      }
    }
    // winding: (a x b) should match n
    const cross = new THREE.Vector3().crossVectors(a, b);
    const flip = cross.dot(n) < 0;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const k0 = base + j * (nu + 1) + i;
        const k1 = k0 + 1;
        const k2 = k0 + (nu + 1);
        const k3 = k2 + 1;
        if (!flip) this.idx.push(k0, k1, k3, k0, k3, k2);
        else this.idx.push(k0, k3, k1, k0, k2, k3);
      }
    }
  }

  // Axis-aligned box; faces subdivided by approx `seg` meters. skip: {top,bottom,px,nx,pz,nz}
  box(min, max, seg = 1.0, skip = {}, uvMode = 'wall') {
    const sx = max.x - min.x, sy = max.y - min.y, sz = max.z - min.z;
    const nx = (l) => Math.max(1, Math.round(l / seg));
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const wallUV = (axis) => (p) => (axis === 'x' ? [p.x, p.y] : [p.z, p.y]);
    const flatUV = (p) => [p.x, p.z];
    // +Z face
    if (!skip.pz) this.grid(V(min.x, min.y, max.z), V(sx, 0, 0), V(0, sy, 0), V(0, 0, 1), nx(sx), nx(sy), wallUV('x'));
    if (!skip.nz) this.grid(V(max.x, min.y, min.z), V(-sx, 0, 0), V(0, sy, 0), V(0, 0, -1), nx(sx), nx(sy), wallUV('x'));
    if (!skip.px) this.grid(V(max.x, min.y, max.z), V(0, 0, -sz), V(0, sy, 0), V(1, 0, 0), nx(sz), nx(sy), wallUV('z'));
    if (!skip.nx) this.grid(V(min.x, min.y, min.z), V(0, 0, sz), V(0, sy, 0), V(-1, 0, 0), nx(sz), nx(sy), wallUV('z'));
    if (!skip.top) this.grid(V(min.x, max.y, max.z), V(sx, 0, 0), V(0, 0, -sz), V(0, 1, 0), nx(sx), nx(sz), uvMode === 'flat' ? flatUV : (p) => [p.x + p.z, p.y + p.z * 0.37]);
    if (!skip.bottom) this.grid(V(min.x, min.y, min.z), V(sx, 0, 0), V(0, 0, sz), V(0, -1, 0), nx(sx), nx(sz), flatUV);
  }

  isEmpty() { return this.vcount === 0; }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.wet) g.setAttribute('aWet', new THREE.Float32BufferAttribute(this.wet, 1));
    g.setIndex(this.vcount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
