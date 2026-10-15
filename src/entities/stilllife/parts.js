// Still Lifes — collectors that turn many small part geometries into one skinned BufferGeometry.
//  PartSet  -> parts material (atlas colour/normal + per-vertex roughness/metal/coat/sheen)
//  ClothSet -> body material, double sided (torn hazmat flaps, rags, hood scraps)
import * as THREE from 'three';
import { lin } from './core.js';
import { uvRect } from './atlas.js';
import { evalAttr, makeAttrOut, NMAT } from './sdf.js';

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m3 = new THREE.Matrix3();
const colOf = (c) => (Array.isArray(c) ? c : lin(c ?? 0xffffff));

function skinFor(chunk, x, y, z, nb, out, attrOut) {
  if (chunk.bone != null && !chunk.blend) { out[0] = chunk.bone; out[4] = 1; out[1] = out[2] = out[3] = 0; out[5] = out[6] = out[7] = 0; return; }
  const S = chunk.ws;
  evalAttr(S, x, y, z, attrOut);
  const bw = attrOut.bw;
  if (chunk.bone != null) { bw[chunk.bone] += chunk.blend; }
  const top = [0, 0, 0, 0], tw = [0, 0, 0, 0];
  for (let b = 0; b < nb; b++) {
    const w = bw[b]; if (w <= tw[3]) continue;
    let q = 3; while (q > 0 && tw[q - 1] < w) { tw[q] = tw[q - 1]; top[q] = top[q - 1]; q--; }
    tw[q] = w; top[q] = b;
  }
  const s = tw[0] + tw[1] + tw[2] + tw[3];
  if (!(s > 1e-6)) {
    // no sculpt weight reaches this point (a part hanging off in space): ride rigidly on the chunk's bone
    // or the root. Zero weights would collapse the vertex and NaN its normal (black frame via bloom).
    out[0] = chunk.bone ?? 0; out[4] = 1; out[1] = out[2] = out[3] = 0; out[5] = out[6] = out[7] = 0;
    return;
  }
  for (let q = 0; q < 4; q++) { out[q] = top[q]; out[4 + q] = tw[q] / s; }
}

class Collector {
  constructor(boneNames, defaultSculpt) { this.boneNames = boneNames; this.bi = new Map(boneNames.map((n, i) => [n, i])); this.ws = defaultSculpt; this.chunks = []; }
  boneIdx(b) { if (b == null) return null; if (typeof b === 'number') return b; const i = this.bi.get(b); if (i === undefined) throw new Error('parts: unknown bone ' + b); return i; }
  get count() { let n = 0; for (const c of this.chunks) n += c.geo.attributes.position.count; return n; }
}

export class PartSet extends Collector {
  // opts: color, pbr [rough, metal, coat, sheen], uv: 'white'|region|'raw', bone (rigid) | ws (sculpt for surface weights), blend
  add(geo, opts = {}) {
    if (opts.matrix) geo.applyMatrix4(opts.matrix);
    this.chunks.push({ geo, col: colOf(opts.color), pbr: opts.pbr || [0.8, 0, 0, 0], uv: opts.uv || 'white', bone: this.boneIdx(opts.bone), blend: opts.blend || 0, ws: opts.ws || this.ws });
    return geo;
  }
  build() {
    const nb = this.boneNames.length;
    let nV = 0, nI = 0;
    for (const c of this.chunks) { nV += c.geo.attributes.position.count; nI += c.geo.index ? c.geo.index.count : c.geo.attributes.position.count; }
    const pos = new Float32Array(nV * 3), nor = new Float32Array(nV * 3), uv = new Float32Array(nV * 2), col = new Float32Array(nV * 3), pbr = new Uint8Array(nV * 4);
    const si = new Uint16Array(nV * 4), sw = new Float32Array(nV * 4);
    const idx = nV > 65535 ? new Uint32Array(nI) : new Uint16Array(nI);
    const sk = new Float64Array(8), ao = makeAttrOut(nb);
    let vo = 0, io = 0;
    for (const c of this.chunks) {
      const g = c.geo, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
      const rect = c.uv === 'raw' ? null : uvRect(c.uv === 'white' ? 'white' : c.uv);
      for (let i = 0; i < P.count; i++) {
        const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
        pos[(vo + i) * 3] = x; pos[(vo + i) * 3 + 1] = y; pos[(vo + i) * 3 + 2] = z;
        if (N) { nor[(vo + i) * 3] = N.getX(i); nor[(vo + i) * 3 + 1] = N.getY(i); nor[(vo + i) * 3 + 2] = N.getZ(i); }
        let u = U ? U.getX(i) : 0.5, v = U ? U.getY(i) : 0.5;
        if (rect) {
          if (c.uv === 'white') { u = (rect[0] + rect[2]) / 2; v = (rect[1] + rect[3]) / 2; }
          else { u = rect[0] + (rect[2] - rect[0]) * Math.min(1, Math.max(0, u)); v = rect[1] + (rect[3] - rect[1]) * Math.min(1, Math.max(0, v)); }
        }
        uv[(vo + i) * 2] = u; uv[(vo + i) * 2 + 1] = v;
        col[(vo + i) * 3] = c.col[0]; col[(vo + i) * 3 + 1] = c.col[1]; col[(vo + i) * 3 + 2] = c.col[2];
        for (let q = 0; q < 4; q++) pbr[(vo + i) * 4 + q] = Math.round(Math.min(1, Math.max(0, c.pbr[q])) * 255);
        skinFor(c, x, y, z, nb, sk, ao);
        for (let q = 0; q < 4; q++) { si[(vo + i) * 4 + q] = sk[q]; sw[(vo + i) * 4 + q] = sk[4 + q]; }
      }
      if (g.index) for (let k = 0; k < g.index.count; k++) idx[io++] = g.index.getX(k) + vo;
      else for (let k = 0; k < P.count; k++) idx[io++] = k + vo;
      vo += P.count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aPBR', new THREE.BufferAttribute(pbr, 4, true));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    return geo;
  }
}

// cloth: body-material attributes. opts: color, mat (MAT index, default suit), thin, wet, dirt, ao, bone/ws
export class ClothSet extends Collector {
  add(geo, opts = {}) {
    if (opts.matrix) geo.applyMatrix4(opts.matrix);
    this.chunks.push({ geo, col: colOf(opts.color ?? 0xe0b41c), mat: opts.mat ?? 1, thin: opts.thin ?? 0, wet: opts.wet ?? 0, dirt: opts.dirt ?? 0.3, ao: opts.ao ?? 0.85, bone: this.boneIdx(opts.bone), blend: opts.blend || 0, ws: opts.ws || this.ws, colorFn: opts.colorFn || null });
    return geo;
  }
  build() {
    const nb = this.boneNames.length;
    let nV = 0, nI = 0;
    for (const c of this.chunks) { nV += c.geo.attributes.position.count; nI += c.geo.index ? c.geo.index.count : c.geo.attributes.position.count; }
    const pos = new Float32Array(nV * 3), nor = new Float32Array(nV * 3), col = new Float32Array(nV * 3), am = new Uint8Array(nV * 4), mi = new Uint8Array(nV * 4);
    const si = new Uint16Array(nV * 4), sw = new Float32Array(nV * 4);
    const idx = nV > 65535 ? new Uint32Array(nI) : new Uint16Array(nI);
    const sk = new Float64Array(8), ao = makeAttrOut(nb);
    let vo = 0, io = 0;
    for (const c of this.chunks) {
      const g = c.geo, P = g.attributes.position, N = g.attributes.normal;
      for (let i = 0; i < P.count; i++) {
        const x = P.getX(i), y = P.getY(i), z = P.getZ(i), k = vo + i;
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        nor[k * 3] = N.getX(i); nor[k * 3 + 1] = N.getY(i); nor[k * 3 + 2] = N.getZ(i);
        const cc = c.colorFn ? c.colorFn(x, y, z, c.col) : c.col;
        col[k * 3] = cc[0]; col[k * 3 + 1] = cc[1]; col[k * 3 + 2] = cc[2];
        // aMat: suit, rubber, fluff, inner
        am[k * 4] = c.mat === 1 ? 255 : 0; am[k * 4 + 1] = c.mat === 2 ? 255 : 0; am[k * 4 + 2] = c.mat === 3 ? 255 : 0; am[k * 4 + 3] = c.mat === 4 ? 255 : 0;
        mi[k * 4] = c.ao * 255; mi[k * 4 + 1] = c.thin * 255; mi[k * 4 + 2] = c.wet * 255; mi[k * 4 + 3] = c.dirt * 255;
        skinFor(c, x, y, z, nb, sk, ao);
        for (let q = 0; q < 4; q++) { si[k * 4 + q] = sk[q]; sw[k * 4 + q] = sk[4 + q]; }
      }
      if (g.index) for (let q = 0; q < g.index.count; q++) idx[io++] = g.index.getX(q) + vo;
      else for (let q = 0; q < P.count; q++) idx[io++] = q + vo;
      vo += P.count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aMat', new THREE.BufferAttribute(am, 4, true));
    geo.setAttribute('aMisc', new THREE.BufferAttribute(mi, 4, true));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    return geo;
  }
}
export { NMAT };
