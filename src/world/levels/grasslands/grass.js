// GPU meadow grass. Two camera-snapped instanced grids of 1 m patches (dense near ring, sparse wide
// far ring). Every blade derives its world position, height, bend and colour from a hash of its
// world patch + blade index, so the field is stable while the grids slide with the camera. Ground height,
// grass density and dryness come from a toroidal data texture around the camera that is filled from the
// exact terrain surface (terrain grid + scatter: no grass on trails, rock, water, under boulders/trunks).
import * as THREE from 'three';
import { engine } from '../../../core/engine.js';
import { CELL, CHUNK, CHUNK_M, WATER_Y } from './layout.js';
import { noiseTexture } from './textures.js';
import { sstep } from './noise.js';

const TEX_N = 192;       // data texels per side
const TEX_STEP = 0.5;    // metres per texel -> 96 m window

const COMMON = /* glsl */`
  uniform sampler2D tGData, tGust;
  uniform vec2 uOrigin;
  uniform float uDataSize, uTime, uRadius, uInner, uDense;
  uniform vec2 uWind;
  uniform vec4 uPush[4];
  attribute vec2 iPatch;
  attribute vec4 aBlade;   // blade index, t along blade, side (-1/1), width scale
  varying float vT; varying float vDry; varying float vHash; varying float vFadeG;
  uint hu(uvec3 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    return v.x ^ v.y ^ v.z;
  }
  float hf(uint h, uint sh) { return float((h >> sh) & 0xffffu) / 65535.0; }
`;

function grassMaterial(far) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
  mat.name = far ? 'grass_far' : 'grass_near';
  mat.customProgramCacheKey = () => (far ? 'gl_grass_far' : 'gl_grass_near');
  mat.userData.uniforms = {
    uOrigin: { value: new THREE.Vector2() }, uRadius: { value: 40 }, uInner: { value: 0 }, uDense: { value: 1 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, GrassSystem.shared, mat.userData.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + COMMON)
      .replace('#include <beginnormal_vertex>', `
        // ---- blade placement (world space) ----
        vec2 wp = uOrigin + iPatch;                // world patch corner (1 m patches)
        float bi = aBlade.x;
        uvec3 hk = uvec3(uint(int(wp.x) + 65536), uint(int(wp.y) + 65536), uint(bi) + 977u);
        uint H0 = hu(hk), H1 = hu(hk + uvec3(7919u, 104729u, 31u));
        vec2 bxz = wp + vec2(hf(H0, 0u), hf(H0, 16u));   // blade root in world xz
        vec4 gd = texture2D(tGData, bxz / uDataSize);
        float groundY = gd.r;
        float dens = gd.g;
        vDry = gd.b;
        float rnd = hf(H1, 0u);
        vHash = rnd;
        float camD = length(bxz - cameraPosition.xz);
        // density: data, distance thinning (outer edge) and the inner hole of the far ring
        float keep = dens * (1.0 - smoothstep(uRadius * 0.72, uRadius, camD));
        keep *= smoothstep(uInner - 1.0, uInner + 1.0, camD);
        // far ring blades are fewer but wider: thin them smoothly toward the edge
        float alive = step(rnd, keep);
        vFadeG = keep;
        // blade shape
        float tall = mix(0.42, 1.05, hf(H1, 16u)) * mix(0.75, 1.15, gd.a) * (0.55 + 0.45 * dens);
        float grow = smoothstep(0.0, 0.25, keep);
        float H = tall * grow * alive;
        float t = aBlade.y;
        vT = t;
        uint H2 = hu(hk + uvec3(17u, 3u, 1301u));
        float ang = hf(H2, 0u) * 6.2832;
        vec2 face = vec2(cos(ang), sin(ang));
        vec2 side = vec2(-face.y, face.x);
        // static lean + wind (gusts travel across the meadow)
        float gust = texture2D(tGust, bxz * 0.018 - uWind * uTime * 0.03).r;
        float wstr = length(uWind);
        vec2 wdir = uWind / max(wstr, 1e-4);
        float sway = (0.35 + 1.25 * gust * gust) * wstr * (0.75 + 0.25 * sin(uTime * 2.3 + rnd * 6.28 + dot(bxz, vec2(0.7, 0.5))));
        vec2 lean = face * (0.18 + 0.25 * hf(H2, 16u)) + wdir * sway * 0.55;
        // push away from people / monsters
        for (int k = 0; k < 4; k++) {
          vec2 dd = bxz - uPush[k].xy;
          float dl = length(dd);
          float pr = uPush[k].z;
          if (pr > 0.0 && dl < pr) lean += normalize(dd + 1e-4) * (1.0 - dl / pr) * 1.4;
        }
        float bend = t * t;
        vec3 pos = vec3(bxz.x, groundY - 0.02, bxz.y);
        pos.xz += lean * bend * H;
        pos.y += H * t * (1.0 - 0.32 * bend * min(1.0, length(lean)));
        float wdt = aBlade.w * (1.0 - t * t * 0.92) * (0.75 + 0.5 * fract(rnd * 7.31)) * grow;
        pos.xz += side * aBlade.z * wdt * 0.5;
        // cheap per-patch frustum rejection
        vec4 cpos = projectionMatrix * viewMatrix * vec4(bxz.x, groundY + 0.4, bxz.y, 1.0);
        if (alive < 0.5 || cpos.w > 0.0 && (abs(cpos.x) > cpos.w * 1.25 + 1.0 || cpos.y > cpos.w * 1.3 + 1.0)) pos = vec3(0.0, -1e4, 0.0);
        // rounded blade cross-section: the normal rolls across the width; tips lean back with the bend
        vec3 toC = cameraPosition - pos;
        vec2 fn = face * (dot(face, toC.xz) < 0.0 ? -1.0 : 1.0);
        vec3 nrm = normalize(vec3(fn.x, 0.0, fn.y) + vec3(side.x, 0.0, side.y) * aBlade.z * 0.55 + vec3(0.0, 0.55 + 0.45 * t, 0.0) - vec3(lean.x, 0.0, lean.y) * bend * 0.4);
        vec3 objectNormal = nrm;
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(1.0, 0.0, 0.0);
        #endif`)
      .replace('#include <begin_vertex>', 'vec3 transformed = pos;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vT; varying float vDry; varying float vHash; varying float vFadeG;
        uniform vec3 uGreen, uGold, uTip, uTransG;`)
      .replace('#include <map_fragment>', `
        vec3 base = mix(uGreen, uGold, clamp(vDry + (vHash - 0.5) * 0.35, 0.0, 1.0));
        vec3 col = mix(base * 0.42, base, smoothstep(0.0, 0.55, vT));
        col = mix(col, uTip * (0.85 + vHash * 0.3), smoothstep(0.62, 1.0, vT) * (0.35 + vDry * 0.5));
        diffuseColor.rgb *= col;`)
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
        void RE_Direct_Grass(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
          RE_Direct_Physical(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
          float back = pow(saturate(dot(geometryViewDir, -directLight.direction)), 3.0);
          reflectedLight.directDiffuse += directLight.color * material.diffuseColor * uTransG * (back * 1.7 + 0.15) * vT;
        }
        #undef RE_Direct
        #define RE_Direct RE_Direct_Grass`)
      .replace('#include <aomap_fragment>', `{
          float ao = mix(0.35, 1.0, smoothstep(0.0, 0.7, vT));
          reflectedLight.indirectDiffuse *= ao; reflectedLight.indirectSpecular *= ao * 0.6;
        }`);
  };
  return mat;
}

function patchGeometry(blades, segs, width) {
  const vpb = segs * 2 + 1;
  const pos = new Float32Array(blades * vpb * 3);
  const bl = new Float32Array(blades * vpb * 4);
  const idx = [];
  let v = 0;
  for (let b = 0; b < blades; b++) {
    const base = v;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      for (const side of s === segs ? [0] : [-1, 1]) {
        bl[v * 4] = b; bl[v * 4 + 1] = t; bl[v * 4 + 2] = side; bl[v * 4 + 3] = width;
        v++;
      }
    }
    for (let s = 0; s < segs - 1; s++) {
      const a = base + s * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const a = base + (segs - 1) * 2;
    idx.push(a, a + 1, a + 2);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aBlade', new THREE.BufferAttribute(bl, 4));
  g.setIndex(idx);
  return g;
}

export class GrassSystem {
  static shared = {
    tGData: { value: null }, tGust: { value: null }, uDataSize: { value: TEX_N * TEX_STEP }, uTime: { value: 0 },
    uWind: { value: new THREE.Vector2(0.6, 0.3) }, uPush: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    uGreen: { value: new THREE.Color(0x4f6a22) }, uGold: { value: new THREE.Color(0xa88f45) }, uTip: { value: new THREE.Color(0xd9c98a) },
    uTransG: { value: new THREE.Color(0.5, 0.48, 0.2) },
  };

  constructor(level) {
    this.level = level;
    this.gw = level.gw;
    const q = engine.qualityName;
    this.nearR = q === 'low' ? 13 : q === 'high' ? 22 : 18;
    this.farR = q === 'low' ? 26 : q === 'high' ? 46 : 40;
    const nearBlades = q === 'low' ? 36 : q === 'high' ? 96 : 72;
    const farBlades = q === 'low' ? 10 : q === 'high' ? 22 : 18;
    this.group = new THREE.Group();
    this.group.name = 'grass';
    // data texture
    this.data = new Uint16Array(TEX_N * TEX_N * 4);
    this.tex = new THREE.DataTexture(this.data, TEX_N, TEX_N, THREE.RGBAFormat, THREE.HalfFloatType);
    this.tex.wrapS = this.tex.wrapT = THREE.RepeatWrapping;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;
    GrassSystem.shared.tGData.value = this.tex;
    GrassSystem.shared.tGust.value = noiseTexture();
    this.filled = null; // [i0, j0] texel window origin currently valid
    this._f2h = THREE.DataUtils.toHalfFloat;
    // grids
    this.near = this._grid(this.nearR, 0, nearBlades, 3, 0.03, false);
    this.far = this._grid(this.farR, this.nearR - 1, farBlades, 2, 0.06, true);
  }

  _grid(R, inner, blades, segs, width, far) {
    const g = patchGeometry(blades, segs, width);
    const n = Math.ceil(R) * 2;
    const patches = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = i - n / 2 + 0.5, z = j - n / 2 + 0.5;
      const d = Math.hypot(x, z);
      if (d > R + 1 || (inner > 0 && d < inner - 1.5)) continue;
      patches.push(i - n / 2, j - n / 2);
    }
    g.setAttribute('iPatch', new THREE.InstancedBufferAttribute(new Float32Array(patches), 2));
    g.instanceCount = patches.length / 2;
    const mat = grassMaterial(far);
    mat.userData.uniforms.uRadius.value = R;
    mat.userData.uniforms.uInner.value = inner;
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = far ? 'grass_far' : 'grass_near';
    this.group.add(mesh);
    return mesh;
  }

  // ---------------------------------------------------------------------
  // data texture: R ground height, G density, B dryness, A height factor
  _sample(x, z) {
    const gw = this.gw, lvl = this.level;
    const cx = Math.floor(x / CHUNK_M), cz = Math.floor(z / CHUNK_M);
    const v = lvl.variantFn(cx, cz);
    const g = gw.chunkGrid(cx, cz, v);
    const lx = (x - g.x0) / 0.75, lz = (z - g.z0) / 0.75;
    const i = Math.min(31, Math.max(0, Math.floor(lx))), j = Math.min(31, Math.max(0, Math.floor(lz)));
    const k = (j + 1) * g.B + (i + 1);
    const h = gw.groundAt(x, z, lvl.variantFn);
    const wet = g.wet[k], rock = g.rock[k], trail = g.trail[k], pad = g.pad[k];
    // slope from the grid
    const sx = (g.h[k + 1] - g.h[k - 1]) / 1.5, sz = (g.h[k + g.B] - g.h[k - g.B]) / 1.5;
    const slope = Math.hypot(sx, sz);
    let dens = 1 - sstep(0.25, 0.7, slope);
    dens *= 1 - sstep(0.05, 0.4, rock);
    dens *= 1 - pad;
    dens *= 1 - sstep(0.15, 0.75, trail) * 0.95;
    if (h < WATER_Y + 0.02) dens = 0;
    else dens *= 0.35 + 0.65 * (1 - sstep(0.25, 0.85, wet));
    const cell = gw.cellAt(Math.floor(x / CELL), Math.floor(z / CELL), lvl.variantFn);
    if (cell) {
      if (cell.zone === 'structure') dens *= 0.15;
      if (cell.forest) dens *= 1 - cell.forest * 0.72;
    }
    // no grass inside boulders / trunks (corner items)
    const ci = Math.round(x / CELL), cj = Math.round(z / CELL);
    const it = gw.cornerItem(ci, cj, v);
    if (it) {
      const dd = Math.hypot(x - it.x, z - it.z);
      const r = it.type === 'tree' ? 0.45 : it.r * 1.05;
      if (dd < r) dens = 0;
    }
    // spawn meadow: the landing circle is flattened & scorched
    const sp = gw.spawn;
    const ds = Math.hypot(x - sp.x, z - sp.z);
    if (ds < 4.2) dens *= 0.25 + 0.75 * sstep(2.6, 4.2, ds);
    const nz = gw.nF.n(x / 23 + 50, z / 23);
    const dry = Math.min(1, Math.max(0, 0.62 + 0.38 * nz - wet * 0.6 - (cell?.forest || 0) * 0.4));
    const tall = 0.5 + 0.5 * gw.nF.n(x / 9 - 20, z / 9);
    dens *= 0.82 + 0.18 * gw.nF.n(x / 3.1, z / 3.1 + 7);
    return [h, Math.max(0, Math.min(1, dens)), dry, tall * (1 - trail * 0.6)];
  }

  _fillTexel(i, j) {
    const x = i * TEX_STEP, z = j * TEX_STEP;
    const s = this._sample(x, z);
    const ti = ((i % TEX_N) + TEX_N) % TEX_N, tj = ((j % TEX_N) + TEX_N) % TEX_N;
    const o = (tj * TEX_N + ti) * 4, f = this._f2h;
    this.data[o] = f(s[0]); this.data[o + 1] = f(s[1]); this.data[o + 2] = f(s[2]); this.data[o + 3] = f(s[3]);
  }

  // refill texels that entered the window (toroidal); `budget` texel rows per call
  _updateData(cam, force) {
    const i0 = Math.floor(cam.x / TEX_STEP) - TEX_N / 2, j0 = Math.floor(cam.z / TEX_STEP) - TEX_N / 2;
    if (!this.filled || force || Math.abs(i0 - this.filled[0]) >= TEX_N || Math.abs(j0 - this.filled[1]) >= TEX_N) {
      for (let j = j0; j < j0 + TEX_N; j++) for (let i = i0; i < i0 + TEX_N; i++) this._fillTexel(i, j);
      this.filled = [i0, j0];
      this.tex.needsUpdate = true;
      return;
    }
    const [fi, fj] = this.filled;
    if (fi === i0 && fj === j0) return;
    // columns
    if (i0 !== fi) {
      const a = i0 > fi ? Math.max(fi + TEX_N, i0) : i0, b = i0 > fi ? i0 + TEX_N : Math.min(fi, i0 + TEX_N);
      for (let i = a; i < b; i++) for (let j = j0; j < j0 + TEX_N; j++) this._fillTexel(i, j);
    }
    if (j0 !== fj) {
      const a = j0 > fj ? Math.max(fj + TEX_N, j0) : j0, b = j0 > fj ? j0 + TEX_N : Math.min(fj, j0 + TEX_N);
      for (let j = a; j < b; j++) for (let i = i0; i < i0 + TEX_N; i++) this._fillTexel(i, j);
    }
    this.filled = [i0, j0];
    this.tex.needsUpdate = true;
  }

  invalidate() { this.filled = null; }

  update(dt, cam, sky, pushers) {
    const S = GrassSystem.shared;
    S.uTime.value += dt;
    this._updateData(cam, false);
    const ox = Math.floor(cam.x), oz = Math.floor(cam.z);
    this.near.material.userData.uniforms.uOrigin.value.set(ox, oz);
    this.far.material.userData.uniforms.uOrigin.value.set(ox, oz);
    const st = sky.state;
    const inst = this.level.game.day.instability?.() || 0;
    const ws = 0.6 + inst * 1.2 + (st.sick > 0.5 ? 0.7 : 0);
    S.uWind.value.set(0.82 * ws, 0.45 * ws);
    // colours drift from summer gold to a dead, bruised palette on the last days
    const sick = st.sick;
    S.uGreen.value.setRGB(0.27, 0.36, 0.11).lerp(new THREE.Color(0.22, 0.16, 0.08), sick * 0.8);
    S.uGold.value.setRGB(0.66, 0.53, 0.24).lerp(new THREE.Color(0.42, 0.18, 0.1), sick * 0.7);
    S.uTip.value.setRGB(0.86, 0.78, 0.5).lerp(new THREE.Color(0.55, 0.3, 0.2), sick * 0.7);
    S.uTransG.value.copy(st.sun).multiplyScalar(0.3).multiply(new THREE.Color(0.85, 0.9, 0.45));
    for (let k = 0; k < 4; k++) {
      const p = pushers[k];
      if (p) S.uPush.value[k].set(p.x, p.z, p.r, 0); else S.uPush.value[k].set(0, 0, 0, 0);
    }
  }

  dispose() {
    this.group.removeFromParent();
    for (const m of [this.near, this.far]) { m.geometry.dispose(); m.material.dispose(); }
    this.tex.dispose();
  }
}
