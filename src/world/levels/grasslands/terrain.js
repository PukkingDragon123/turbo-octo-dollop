// Grasslands terrain: quadtree-LOD heightfield tiles (0.75 m near the camera … 12 m far away) with a
// splat-mapped PBR material (meadow thatch / trail dirt / river gravel / conifer litter + triplanar granite
// on cliffs), plus per-chunk Rapier heightfield colliders built from exactly the same height grid.
import * as THREE from 'three';
import { RAPIER, GROUPS } from '../../../physics/physics.js';
import { CHUNK_M, WATER_Y } from './layout.js';
import { terrainArrays, noiseTexture } from './textures.js';
import { sstep } from './noise.js';

// ---------------------------------------------------------------------------
// Material
let _mat = null;
export const terrainUniforms = {
  tAlb: { value: null }, tNrm: { value: null }, tOrm: { value: null }, tNoise: { value: null },
  uLayerScale: { value: new THREE.Vector4(1 / 1.7, 1 / 1.8, 1 / 1.2, 1 / 1.6) },
  uRockScale: { value: 1 / 4 },
  uGrade: { value: new THREE.Color(1, 1, 1) },
  uTime: { value: 0 },
};

export function terrainMaterial() {
  if (_mat) return _mat;
  const arr = terrainArrays();
  terrainUniforms.tAlb.value = arr.albedo;
  terrainUniforms.tNrm.value = arr.normal;
  terrainUniforms.tOrm.value = arr.orm;
  terrainUniforms.tNoise.value = noiseTexture();
  const m = arr.meters;
  terrainUniforms.uLayerScale.value.set(1 / m[0], 1 / m[1], 1 / m[2], 1 / m[3]);
  terrainUniforms.uRockScale.value = 1 / m[4];
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  mat.name = 'grass_terrain';
  mat.customProgramCacheKey = () => 'grass_terrain_v1';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, terrainUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aSplat;
        attribute vec2 aMisc;
        varying vec4 vSplat;
        varying vec2 vMisc;
        varying vec3 vWPos;
        varying vec3 vWNrm;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSplat = aSplat; vMisc = aMisc;
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNrm = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        precision highp sampler2DArray;
        uniform sampler2DArray tAlb, tNrm, tOrm;
        uniform sampler2D tNoise;
        uniform vec4 uLayerScale;
        uniform float uRockScale;
        uniform vec3 uGrade;
        uniform float uTime;
        varying vec4 vSplat;
        varying vec2 vMisc;
        varying vec3 vWPos;
        varying vec3 vWNrm;
        vec3 gN; float gRough; float gAO;
        // tangent-space normal (xy) on a horizontal projection -> world perturbation (whiteout blend)
        vec3 hNormal(vec3 tn, vec3 N){ return normalize(vec3(tn.x + N.x, abs(tn.z) * N.y, tn.y + N.z)); }`)
      .replace('#include <map_fragment>', `
        {
          vec3 N = normalize(vWNrm);
          vec2 wuv = vWPos.xz;
          float camD = length(vWPos - cameraPosition);
          vec4 nz = texture2D(tNoise, wuv / 173.0);
          vec4 nz2 = texture2D(tNoise, wuv / 37.0 + 0.31);
          float slope = 1.0 - N.y;
          float wTrail = vSplat.x, wPeb = vSplat.y, wFor = vSplat.z;
          float wRock = max(vSplat.w, smoothstep(0.30, 0.52, slope));
          float flatW = 1.0 - wRock;
          float wMead = max(0.0, 1.0 - wTrail - wPeb - wFor);
          vec4 W = vec4(wMead, wTrail, wPeb, wFor) * flatW;
          // ---- horizontal layers (two scales each to kill tiling)
          vec3 alb = vec3(0.0); vec3 tnS = vec3(0.0); vec3 orm = vec3(0.0); float hsum = 0.0;
          float mixS = smoothstep(0.35, 0.65, nz2.b);
          vec4 hw = vec4(0.0);
          vec3 a0 = vec3(0.0), a1 = vec3(0.0), a2 = vec3(0.0), a3 = vec3(0.0);
          vec3 o0 = vec3(0.0), o1 = vec3(0.0), o2 = vec3(0.0), o3 = vec3(0.0);
          vec2 uvA = wuv * uLayerScale.x, uvB = vec2(wuv.y, -wuv.x) * uLayerScale.x * 0.43 + 0.17;
          if (W.x > 0.003) {
            a0 = mix(texture(tAlb, vec3(uvA, 0.0)).rgb, texture(tAlb, vec3(uvB, 0.0)).rgb, mixS);
            o0 = mix(texture(tOrm, vec3(uvA, 0.0)).rgb, texture(tOrm, vec3(uvB, 0.0)).rgb, mixS);
            hw.x = W.x * (0.25 + o0.r);
          }
          if (W.y > 0.003) { vec2 u = wuv * uLayerScale.y; a1 = texture(tAlb, vec3(u, 1.0)).rgb; o1 = texture(tOrm, vec3(u, 1.0)).rgb; hw.y = W.y * (0.25 + o1.r); }
          if (W.z > 0.003) { vec2 u = wuv * uLayerScale.z; a2 = texture(tAlb, vec3(u, 2.0)).rgb; o2 = texture(tOrm, vec3(u, 2.0)).rgb; hw.z = W.z * (0.25 + o2.r) * 1.4; }
          if (W.w > 0.003) { vec2 u = wuv * uLayerScale.w; a3 = texture(tAlb, vec3(u, 3.0)).rgb; o3 = texture(tOrm, vec3(u, 3.0)).rgb; hw.w = W.w * (0.25 + o3.r); }
          // height-aware blend: sharpen the weights by the AO (height proxy) of each layer
          hw = pow(hw + 1e-4, vec4(3.0));
          float hs = hw.x + hw.y + hw.z + hw.w;
          hw /= max(hs, 1e-6);
          hw *= flatW;
          alb = a0 * hw.x + a1 * hw.y + a2 * hw.z + a3 * hw.w;
          orm = o0 * hw.x + o1 * hw.y + o2 * hw.z + o3 * hw.w;
          vec3 nW = N;
          if (camD < 140.0 && flatW > 0.01) {
            vec3 tn = vec3(0.0);
            if (hw.x > 0.01) tn += (mix(texture(tNrm, vec3(uvA, 0.0)).xyz, texture(tNrm, vec3(uvB, 0.0)).xyz, mixS) * 2.0 - 1.0) * hw.x;
            if (hw.y > 0.01) tn += (texture(tNrm, vec3(wuv * uLayerScale.y, 1.0)).xyz * 2.0 - 1.0) * hw.y;
            if (hw.z > 0.01) tn += (texture(tNrm, vec3(wuv * uLayerScale.z, 2.0)).xyz * 2.0 - 1.0) * hw.z;
            if (hw.w > 0.01) tn += (texture(tNrm, vec3(wuv * uLayerScale.w, 3.0)).xyz * 2.0 - 1.0) * hw.w;
            tn.xy *= 1.0 - smoothstep(60.0, 140.0, camD);
            tn.z = max(tn.z, 0.2);
            nW = hNormal(tn, N);
          }
          // ---- triplanar granite on cliffs / outcrops
          if (wRock > 0.003) {
            vec3 bw = pow(abs(N), vec3(5.0)); bw /= (bw.x + bw.y + bw.z);
            vec3 p = vWPos * uRockScale;
            vec3 p2 = vWPos * uRockScale * 0.31 + 0.5;
            float big = smoothstep(0.3, 0.7, nz.g);
            vec3 ra = vec3(0.0), ro = vec3(0.0); vec3 rn = vec3(0.0);
            vec3 tx = vec3(0.0), ty = vec3(0.0), tz = vec3(0.0);
            if (bw.x > 0.01) { ra += mix(texture(tAlb, vec3(p.zy, 4.0)).rgb, texture(tAlb, vec3(p2.zy, 4.0)).rgb, big) * bw.x; ro += texture(tOrm, vec3(p.zy, 4.0)).rgb * bw.x; tx = texture(tNrm, vec3(p.zy, 4.0)).xyz * 2.0 - 1.0; }
            if (bw.y > 0.01) { ra += mix(texture(tAlb, vec3(p.xz, 4.0)).rgb, texture(tAlb, vec3(p2.xz, 4.0)).rgb, big) * bw.y; ro += texture(tOrm, vec3(p.xz, 4.0)).rgb * bw.y; ty = texture(tNrm, vec3(p.xz, 4.0)).xyz * 2.0 - 1.0; }
            if (bw.z > 0.01) { ra += mix(texture(tAlb, vec3(p.xy, 4.0)).rgb, texture(tAlb, vec3(p2.xy, 4.0)).rgb, big) * bw.z; ro += texture(tOrm, vec3(p.xy, 4.0)).rgb * bw.z; tz = texture(tNrm, vec3(p.xy, 4.0)).xyz * 2.0 - 1.0; }
            vec3 nx = vec3(tx.xy + N.zy, abs(tx.z) * N.x);
            vec3 ny = vec3(ty.xy + N.xz, abs(ty.z) * N.y);
            vec3 nzz = vec3(tz.xy + N.xy, abs(tz.z) * N.z);
            rn = normalize(nx.zyx * bw.x + ny.xzy * bw.y + nzz.xyz * bw.z);
            // moss / lichen on the upward faces of the granite, dark water streaks on the walls
            float mossN = smoothstep(0.45, 0.75, nz2.r + (N.y - 0.5) * 0.9);
            ra = mix(ra, vec3(0.16, 0.2, 0.07) * (0.8 + nz.a * 0.5), mossN * 0.75 * smoothstep(0.2, 0.7, N.y));
            float streak = smoothstep(0.55, 0.85, texture2D(tNoise, vec2((vWPos.x + vWPos.z) * 0.09, vWPos.y * 0.012)).b) * (1.0 - N.y);
            ra *= 1.0 - streak * 0.35;
            alb = mix(alb, ra, wRock);
            orm = mix(orm, ro, wRock);
            nW = normalize(mix(nW, rn, wRock));
          }
          // ---- macro variation: sun-bleached patches, damp hollows
          float dry = smoothstep(0.35, 0.75, nz.r);
          alb *= mix(vec3(0.92, 0.97, 0.9), vec3(1.08, 1.02, 0.9), dry * (1.0 - wRock));
          alb *= 0.9 + 0.2 * nz2.g;
          // wet banks
          float wet = vMisc.x;
          alb *= 1.0 - wet * 0.38;
          // under water: turquoise absorption over the gravel + dancing caustics
          float wd = ${WATER_Y.toFixed(3)} - vWPos.y;
          if (wd > 0.0) {
            vec3 absorb = exp(-wd * vec3(3.4, 1.05, 0.8));
            float c1 = texture2D(tNoise, vWPos.xz * 0.31 + vec2(uTime * 0.045, uTime * 0.02)).b;
            float c2 = texture2D(tNoise, vWPos.xz * 0.37 - vec2(uTime * 0.03, uTime * 0.05)).b;
            float caus = pow(clamp(1.0 - abs(c1 - c2) * 3.0, 0.0, 1.0), 8.0) * smoothstep(0.0, 0.12, wd);
            alb = alb * absorb + vec3(0.55, 0.85, 0.78) * caus * 0.35 * absorb;
          }
          gRough = mix(orm.g, orm.g * 0.35, wet);
          gAO = orm.r * vMisc.y;
          gN = nW;
          diffuseColor.rgb = alb * uGrade;
        }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(gRough, 0.04, 1.0);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(gN, 0.0)).xyz);')
      .replace('#include <aomap_fragment>', `{
          float ambientOcclusion = clamp(mix(1.0, gAO * 1.2, 0.7), 0.0, 1.0);
          reflectedLight.indirectDiffuse *= ambientOcclusion;
          reflectedLight.indirectSpecular *= ambientOcclusion;
        }`);
  };
  _mat = mat;
  return mat;
}

// ---------------------------------------------------------------------------
// Tile geometry. n quads per side, `step` metres; heights from fn (exact LOD0 grid or analytic).
// Splat: x trail, y gravel/wet, z forest floor, w rock. aMisc: x wetness, y ambient occlusion.
const _info = {};

function splatFor(world, x, z, info, out, o) {
  const trail = Math.max(info.trail, info.pad * 0.9);
  const wet = info.wet;
  const rock = info.rock;
  const f = info.sh > -12 || info.forest === undefined ? world.forest(x, z, info.sh) : info.forest;
  out[o] = trail * (1 - wet);
  out[o + 1] = Math.min(1, wet * 1.15);
  out[o + 2] = (1 - trail) * (1 - wet) * sstep(0.25, 0.75, f) * 0.95;
  out[o + 3] = rock;
}

// Build the tile mesh (64x64 quads). lod 0 tiles (48 m = 2x2 chunks) use the chunk grids, i.e. the
// exact physics surface; coarser tiles sample the analytic height.
export const TILE_N = 64;

// Incremental tile build (so streaming never hitches): createTileJob -> stepTileJob (until it returns true,
// each call bounded by a deadline) -> finishTileJob (geometry).
export function createTileJob(world, tile, variantFn) {
  const n = TILE_N, B = n + 3;
  return {
    tile, n, B, step: tile.size / n, row: -1, grids: null, fields: null,
    H: new Float32Array(B * B), SP: new Float32Array((n + 1) * (n + 1) * 4), MI: new Float32Array((n + 1) * (n + 1) * 2),
    variantFn,
  };
}

export function stepTileJob(world, job, deadline) {
  const { tile, n, B, step, H, SP, MI } = job;
  const { x0, z0, lod } = tile;
  if (lod === 0) {
    const ccx = Math.round(x0 / CHUNK_M), ccz = Math.round(z0 / CHUNK_M);
    if (!job.grids) { job.grids = []; job.fields = []; }
    while (job.grids.length < 4) {
      const k = job.grids.length, a = k % 2, b = (k / 2) | 0;
      const v = job.variantFn ? job.variantFn(ccx + a, ccz + b) : 0;
      job.grids.push(world.chunkGrid(ccx + a, ccz + b, v));
      job.fields.push(world.chunkCells(ccx + a, ccz + b, v).fields);
      if (performance.now() > deadline) return false;
    }
    const FG = 19;
    for (; job.row <= n + 1; job.row++) {
      const vj = job.row;
      const cj = Math.min(1, Math.max(0, Math.floor(vj / 32))), lj = vj - cj * 32;
      for (let vi = -1; vi <= n + 1; vi++) {
        const ci = Math.min(1, Math.max(0, Math.floor(vi / 32))), li = vi - ci * 32;
        const g = job.grids[cj * 2 + ci];
        const k = (lj + 1) * g.B + (li + 1);
        H[(vj + 1) * B + (vi + 1)] = g.h[k];
        if (vi < 0 || vj < 0 || vi > n || vj > n) continue;
        _info.trail = g.trail[k]; _info.wet = g.wet[k]; _info.rock = g.rock[k]; _info.pad = g.pad[k]; _info.forest = undefined;
        const sv = job.fields[cj * 2 + ci];
        const fx = (li + 2) * 0.5, fz = (lj + 2) * 0.5, ix = Math.min(17, Math.floor(fx)), jz = Math.min(17, Math.floor(fz)), tx = fx - ix, tz = fz - jz;
        const kk = jz * FG + ix;
        _info.sh = sv.sh[kk] * (1 - tx) * (1 - tz) + sv.sh[kk + 1] * tx * (1 - tz) + sv.sh[kk + FG] * (1 - tx) * tz + sv.sh[kk + FG + 1] * tx * tz;
        const o = vj * (n + 1) + vi;
        splatFor(world, x0 + vi * step, z0 + vj * step, _info, SP, o * 4);
        MI[o * 2] = _info.wet;
        MI[o * 2 + 1] = aoFor(_info, g.h[k]);
      }
      if ((job.row & 7) === 7 && performance.now() > deadline) { job.row++; return job.row > n + 1; }
    }
    return true;
  }
  for (; job.row <= n + 1; job.row++) {
    const j = job.row;
    for (let i = -1; i <= n + 1; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      const inside = i >= 0 && j >= 0 && i <= n && j <= n;
      const h = world.height(x, z, inside ? _info : null);
      H[(j + 1) * B + (i + 1)] = h;
      if (inside) {
        _info.forest = undefined;
        const o = j * (n + 1) + i;
        splatFor(world, x, z, _info, SP, o * 4);
        MI[o * 2] = _info.wet;
        MI[o * 2 + 1] = aoFor(_info, h);
      }
    }
    if (performance.now() > deadline) { job.row++; return job.row > n + 1; }
  }
  return true;
}

export function finishTileJob(job) {
  const { tile, n, B, step, H, SP, MI } = job;
  const { x0, z0, size, lod } = tile;
  // vertices + skirt ring
  const nv = (n + 1) * (n + 1);
  const ring = 4 * n;
  const total = nv + ring;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
  const spl = new Float32Array(total * 4), msc = new Float32Array(total * 2);
  let minY = 1e9, maxY = -1e9;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const k = (j + 1) * B + (i + 1);
    const v = j * (n + 1) + i;
    const y = H[k];
    pos[v * 3] = x0 + i * step; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z0 + j * step;
    const dx = H[k + 1] - H[k - 1], dz = H[k + B] - H[k - B];
    const nx = -dx, ny = 2 * step, nz = -dz;
    const l = Math.hypot(nx, ny, nz);
    nor[v * 3] = nx / l; nor[v * 3 + 1] = ny / l; nor[v * 3 + 2] = nz / l;
    spl.set(SP.subarray(v * 4, v * 4 + 4), v * 4);
    msc[v * 2] = MI[v * 2]; msc[v * 2 + 1] = MI[v * 2 + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  // skirt: duplicate border vertices pushed down
  const drop = Math.max(0.6, step * 1.8) + (lod > 2 ? 4 : 0);
  const border = [];
  for (let i = 0; i < n; i++) border.push([i, 0]);
  for (let j = 0; j < n; j++) border.push([n, j]);
  for (let i = n; i > 0; i--) border.push([i, n]);
  for (let j = n; j > 0; j--) border.push([0, j]);
  border.forEach(([i, j], r) => {
    const s = j * (n + 1) + i, d = nv + r;
    pos[d * 3] = pos[s * 3]; pos[d * 3 + 1] = pos[s * 3 + 1] - drop; pos[d * 3 + 2] = pos[s * 3 + 2];
    nor[d * 3] = nor[s * 3]; nor[d * 3 + 1] = nor[s * 3 + 1]; nor[d * 3 + 2] = nor[s * 3 + 2];
    spl.set(spl.subarray(s * 4, s * 4 + 4), d * 4);
    msc[d * 2] = msc[s * 2]; msc[d * 2 + 1] = msc[s * 2 + 1] * 0.7;
  });
  const idx = new Uint32Array(n * n * 6 + ring * 6);
  let p = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, c = a + (n + 1), d = c + 1;
    // same diagonal as Rapier's heightfield (x+,z-)–(x-,z+)
    idx[p++] = a; idx[p++] = c; idx[p++] = b;
    idx[p++] = b; idx[p++] = c; idx[p++] = d;
  }
  for (let r = 0; r < ring; r++) {
    const [i0, j0] = border[r], [i1, j1] = border[(r + 1) % ring];
    const a = j0 * (n + 1) + i0, b = j1 * (n + 1) + i1, a2 = nv + r, b2 = nv + ((r + 1) % ring);
    // outward-facing wall (border is walked counter-clockwise seen from above)
    idx[p++] = a; idx[p++] = b; idx[p++] = a2;
    idx[p++] = b; idx[p++] = b2; idx[p++] = a2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('aSplat', new THREE.BufferAttribute(spl, 4));
  geo.setAttribute('aMisc', new THREE.BufferAttribute(msc, 2));
  geo.setIndex(new THREE.BufferAttribute(total > 65535 ? idx : new Uint16Array(idx), 1));
  geo.boundingBox = new THREE.Box3(new THREE.Vector3(x0, minY - drop, z0), new THREE.Vector3(x0 + size, maxY, z0 + size));
  geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
  return { geo, H, minY, maxY };
}

function aoFor(info, h) {
  // darker at the foot of cliffs and in river hollows
  let ao = 1;
  if (info.sh > -3 && info.sh < 1) ao *= 0.72 + 0.28 * sstep(-0.2, -3, info.sh);
  if (h < WATER_Y) ao *= 0.85;
  return ao;
}

// ---------------------------------------------------------------------------
// Quadtree LOD around the camera. Level L tiles are 48·2^L m wide with 64x64 quads
// (0.75 m near the camera … 6 m at the 384 m roots).
const MAX_L = 3;
const T0 = CHUNK_M * 2;
const ROOT = T0 * (1 << MAX_L); // 384 m

export class TerrainLOD {
  constructor(level, opts = {}) {
    this.level = level;
    this.world = level.gw;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.mat = terrainMaterial();
    this.tiles = new Map(); // key -> {mesh, lod, x0, z0, size, used}
    this.active = new Set();
    this.queue = [];
    this.split = opts.split ?? 0.62;
    this.rootsR = opts.rootsR ?? 1; // roots in a (2R+1)x(2R+1) block around the camera
    this.center = new THREE.Vector2(1e9, 1e9);
    this.pending = null;
    this.buildMs = 0;
  }

  key(lod, tx, tz) { return `${lod}:${tx}:${tz}`; }

  _select(cx, cz) {
    const out = [];
    const R = this.rootsR;
    const rx0 = Math.floor(cx / ROOT) - R, rz0 = Math.floor(cz / ROOT) - R;
    const visit = (lod, tx, tz) => {
      const size = T0 * (1 << lod);
      const x0 = tx * size, z0 = tz * size;
      const dx = Math.max(x0 - cx, 0, cx - (x0 + size)), dz = Math.max(z0 - cz, 0, cz - (z0 + size));
      const d = Math.hypot(dx, dz);
      if (lod > 0 && d < size * this.split) {
        for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) visit(lod - 1, tx * 2 + a, tz * 2 + b);
      } else out.push({ lod, tx, tz, x0, z0, size, key: this.key(lod, tx, tz) });
    };
    for (let b = 0; b <= 2 * R; b++) for (let a = 0; a <= 2 * R; a++) visit(MAX_L, rx0 + a, rz0 + b);
    return out;
  }

  _finish(t, job) {
    const t0 = performance.now();
    const { geo } = finishTileJob(job);
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    mesh.castShadow = t.lod === 0;
    mesh.name = `tile ${t.key}`;
    const rec = { ...t, mesh };
    this.tiles.set(t.key, rec);
    this.buildMs = this.buildMs * 0.9 + (performance.now() - t0 + (job.ms || 0)) * 0.1;
    return rec;
  }

  // force-rebuild the LOD0 tile containing a chunk (day-7 shift)
  invalidateChunk(cx, cz) {
    const k = this.key(0, Math.floor(cx / 2), Math.floor(cz / 2));
    this.jobs?.delete(k);
    const t = this.tiles.get(k);
    if (!t) return;
    const wasActive = this.active.has(k);
    t.mesh.removeFromParent();
    t.mesh.geometry.dispose();
    this.tiles.delete(k);
    if (wasActive) { this.active.delete(k); this.center.set(1e9, 1e9); }
  }

  // budgetMs: per-frame build time; force: build everything now (loading screen)
  update(camPos, budgetMs = 3, force = false) {
    const moved = Math.hypot(camPos.x - this.center.x, camPos.z - this.center.y);
    if (moved > 6 || force) {
      this.center.set(camPos.x, camPos.z);
      this.pending = this._select(camPos.x, camPos.z);
      // nearest tiles first
      this.pending.sort((a, b) => a.lod - b.lod || Math.hypot(a.x0 + a.size / 2 - camPos.x, a.z0 + a.size / 2 - camPos.z) - Math.hypot(b.x0 + b.size / 2 - camPos.x, b.z0 + b.size / 2 - camPos.z));
    }
    if (!this.pending) return true;
    const t0 = performance.now();
    const deadline = force ? Infinity : t0 + budgetMs;
    this.jobs = this.jobs || new Map();
    let done = true;
    for (const t of this.pending) {
      if (this.tiles.has(t.key)) continue;
      if (performance.now() > deadline) { done = false; break; }
      let job = this.jobs.get(t.key);
      if (!job) { job = createTileJob(this.world, t, this.level.variantFn); this.jobs.set(t.key, job); }
      const s0 = performance.now();
      const fin = stepTileJob(this.world, job, deadline);
      job.ms = (job.ms || 0) + performance.now() - s0;
      if (fin) { this.jobs.delete(t.key); this._finish(t, job); } else { done = false; break; }
    }
    if (!done) return false;
    // swap
    const want = new Set(this.pending.map((t) => t.key));
    for (const k of this.active) {
      if (want.has(k)) continue;
      this.tiles.get(k)?.mesh.removeFromParent();
    }
    for (const k of want) {
      const rec = this.tiles.get(k);
      if (!this.active.has(k) && rec) this.group.add(rec.mesh);
      if (rec) rec.used = performance.now();
    }
    this.active = want;
    this.pending = null;
    // evict old cached tiles
    if (this.tiles.size > this.active.size + 40) {
      const old = [...this.tiles.values()].filter((t) => !this.active.has(t.key)).sort((a, b) => (a.used || 0) - (b.used || 0));
      for (const t of old.slice(0, this.tiles.size - this.active.size - 40)) {
        t.mesh.geometry.dispose();
        this.tiles.delete(t.key);
      }
    }
    return true;
  }

  activeTiles() { return [...this.active].map((k) => this.tiles.get(k)).filter(Boolean); }

  dispose() {
    for (const t of this.tiles.values()) { t.mesh.removeFromParent(); t.mesh.geometry.dispose(); }
    this.tiles.clear();
    this.group.removeFromParent();
  }
}

// ---------------------------------------------------------------------------
// Physics: one heightfield per gameplay chunk (33x33 samples at 0.75 m), identical to the LOD0 mesh.
export function chunkCollider(world, physics, cx, cz, variant) {
  const g = world.chunkGrid(cx, cz, variant);
  const n = 32, B = g.B;
  const heights = new Float32Array((n + 1) * (n + 1));
  for (let c = 0; c <= n; c++) for (let r = 0; r <= n; r++) heights[c * (n + 1) + r] = g.h[(r + 1) * B + (c + 1)];
  const desc = RAPIER.ColliderDesc.heightfield(n, n, heights, { x: CHUNK_M, y: 1, z: CHUNK_M })
    .setTranslation(g.x0 + CHUNK_M / 2, 0, g.z0 + CHUNK_M / 2)
    .setCollisionGroups(GROUPS.static)
    .setFriction(0.9);
  const col = physics.world.createCollider(desc);
  physics.setUserData(col, { kind: 'static', surface: 'terrain' });
  return col;
}
