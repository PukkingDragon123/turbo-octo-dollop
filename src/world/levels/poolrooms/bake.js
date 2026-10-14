// Light baking for Poolrooms geometry. Fills the attributes read by poolmat.surface():
//   aLightCells / aLightW (4 strongest field lights per vertex), aAO, aCaust (exposure to water
//   caustics reflected from nearby pools), aGlow (underwater pool-lamp irradiance, rgb).
// 'full' evaluates occlusion per 0.5 m bucket (architecture); 'fast' evaluates occlusion once per
// cell / height band and varies only falloff and Lambert per vertex (small detail meshes).
// A Baker instance lives for one chunk build and caches light lists and occlusion.
import * as THREE from 'three';
import { lightWeight } from '../../../gfx/bakedlight.js';

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const CELL = 3;

export class Baker {
  // ctx: { lightsNear(x,z), occl(x0,z0,x1,z1,sy,ly), ao(...), caust(...), glow(..., out) }
  constructor(ctx) {
    this.ctx = ctx;
    this.near = new Map();
    this.occ = new Map();
    this.ids = new Map();
  }

  lights(x, z) {
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
    const k = (i + 32768) * 65536 + (j + 32768);
    let l = this.near.get(k);
    if (!l) {
      l = [...this.ctx.lightsNear((i + 0.5) * CELL, (j + 0.5) * CELL)];
      for (const li of l) if (!this.ids.has(li)) this.ids.set(li, this.ids.size);
      this.near.set(k, l);
    }
    return l;
  }

  occlusion(bucket, l, sx, sz, sy) {
    const k = bucket * 1024 + this.ids.get(l);
    let t = this.occ.get(k);
    if (t === undefined) { t = this.ctx.occl(sx, sz, l.x, l.z, sy, l.y); this.occ.set(k, t); }
    return t;
  }

  bake(geo, opts = {}) {
    const it = this.bakeIter(geo, opts);
    let r = it.next();
    while (!r.done) r = it.next();
    return geo;
  }

  // mode: 'full' | 'fast'; yields every ~1200 vertices so chunk builds can be time-sliced
  *bakeIter(geo, opts = {}) {
    const ctx = this.ctx;
    const fast = opts.mode === 'fast';
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    const count = pos.count;
    const cells = new Float32Array(count * 4), weights = new Float32Array(count * 4);
    const aoA = new Float32Array(count), caA = new Float32Array(count), glA = new Float32Array(count * 3);
    const ldA = new Float32Array(count * 3);
    const bounceMul = opts.bounce ?? 0.5, directMul = opts.direct ?? 1.0;
    const topD = [0, 0, 0, 0];
    const glow = [0, 0, 0];
    const topK = [0, 0, 0, 0], topW = [0, 0, 0, 0];
    const aoC = new Map();
    for (let i = 0; i < count; i++) {
      if ((i & 1023) === 1023) yield 'bake';
      _p.fromBufferAttribute(pos, i);
      _n.fromBufferAttribute(nor, i);
      const sx = _p.x + _n.x * 0.05, sy = _p.y + _n.y * 0.05, sz = _p.z + _n.z * 0.05;
      const by = sy < -0.05 ? 0 : sy < 1.6 ? 1 : sy < 3.2 ? 2 : 3;
      let bucket;
      let ox = sx, oz = sz;
      if (fast) {
        const ci = Math.floor(sx / CELL), cj = Math.floor(sz / CELL);
        bucket = (((ci + 4096) * 8192 + (cj + 4096)) * 4 + by);
        ox = (ci + 0.5) * CELL; oz = (cj + 0.5) * CELL;
      } else {
        bucket = (((Math.floor(sx * 2) + 65536) * 131072 + (Math.floor(sz * 2) + 65536)) * 4 + by);
      }
      topW[0] = topW[1] = topW[2] = topW[3] = 0;
      topK[0] = topK[1] = topK[2] = topK[3] = 0;
      let rest = 0;
      const list = this.lights(sx, sz);
      for (let li = 0; li < list.length; li++) {
        const l = list[li];
        const dx = l.x - sx, dy = l.y - sy, dz = l.z - sz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > l.radius * l.radius) continue;
        const d = Math.sqrt(d2);
        const fall = lightWeight(d, l.radius);
        const ndl = (dx * _n.x + dy * _n.y + dz * _n.z) / Math.max(d, 1e-3);
        const emit = Math.max(0.12, Math.min(1, (l.y - sy) / Math.max(d, 1e-3) * 1.2 + 0.15));
        let w = fall * Math.max(0, ndl * 0.85 + 0.15) * emit;
        const t = this.occlusion(bucket, l, ox, oz, sy);
        w *= t;
        const b = fall * 0.5 * (0.35 + 0.65 * t) * (sy < -0.05 ? t : 1);
        const tw = w * directMul + b * bounceMul;
        if (tw <= 0.002) continue;
        // insert into top-4
        let m = 0;
        for (let k = 1; k < 4; k++) if (topW[k] < topW[m]) m = k;
        if (tw > topW[m]) { rest += topW[m]; topW[m] = tw; topK[m] = l.key; topD[m] = li; } else rest += tw;
      }
      // strongest first (its direction drives the specular highlight)
      for (let a = 0; a < 3; a++) for (let b = a + 1; b < 4; b++) {
        if (topW[b] > topW[a]) {
          let t = topW[a]; topW[a] = topW[b]; topW[b] = t;
          t = topK[a]; topK[a] = topK[b]; topK[b] = t;
          t = topD[a]; topD[a] = topD[b]; topD[b] = t;
        }
      }
      if (topW[0] > 0) {
        const l = list[topD[0]];
        const dx = l.x - sx, dy = l.y - sy, dz = l.z - sz, dl = Math.hypot(dx, dy, dz) || 1;
        ldA[i * 3] = dx / dl; ldA[i * 3 + 1] = dy / dl; ldA[i * 3 + 2] = dz / dl;
      }
      let top = 0;
      for (let k = 0; k < 4; k++) { cells[i * 4 + k] = topK[k]; weights[i * 4 + k] = topW[k]; top += topW[k]; }
      if (rest > 0 && top > 0) {
        const s = (top + rest * 0.6) / top;
        for (let k = 0; k < 4; k++) weights[i * 4 + k] *= s;
      }
      if (fast) {
        const ak = bucket * 8 + (_n.y > 0.5 ? 0 : _n.y < -0.5 ? 1 : 2);
        let v = aoC.get(ak);
        if (!v) {
          v = [ctx.ao ? ctx.ao(_p.x, _p.y, _p.z, _n.x, _n.y, _n.z) : 1, ctx.caust ? ctx.caust(_p.x, _p.y, _p.z, _n.x, _n.y, _n.z) : 0];
          aoC.set(ak, v);
        }
        aoA[i] = v[0]; caA[i] = v[1];
      } else {
        aoA[i] = ctx.ao ? ctx.ao(_p.x, _p.y, _p.z, _n.x, _n.y, _n.z) : 1;
        caA[i] = ctx.caust ? ctx.caust(_p.x, _p.y, _p.z, _n.x, _n.y, _n.z) : 0;
      }
      glow[0] = glow[1] = glow[2] = 0;
      if (ctx.glow) ctx.glow(_p.x, _p.y, _p.z, _n.x, _n.y, _n.z, glow);
      glA[i * 3] = glow[0]; glA[i * 3 + 1] = glow[1]; glA[i * 3 + 2] = glow[2];
    }
    geo.setAttribute('aLightCells', new THREE.BufferAttribute(cells, 4));
    geo.setAttribute('aLightW', new THREE.BufferAttribute(weights, 4));
    geo.setAttribute('aAO', new THREE.BufferAttribute(aoA, 1));
    geo.setAttribute('aCaust', new THREE.BufferAttribute(caA, 1));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(glA, 3));
    geo.setAttribute('aLDir', new THREE.BufferAttribute(ldA, 3));
    return geo;
  }
}

// one-off bake (decor outside a chunk build)
export function bakeFull(geo, ctx, opts = {}) {
  return new Baker(ctx).bake(geo, opts);
}
