// Grasslands water: the fast, clear turquoise river (flow-mapped ripple normals, depth-based body colour over
// a tinted riverbed, Fresnel sky reflections with clouds, sun glints, white water around rocks and at the
// banks), the hero waterfall (falling ribbon with racing streaks + a soft veil) and its drifting mist.
import * as THREE from 'three';
import * as Synth from '../../../gfx/texsynth.js';
import { engine } from '../../../core/engine.js';
import { WATER_Y, CHUNK_M } from './layout.js';
import { noiseTexture, texSize } from './textures.js';

Synth.registerRecipe('gl_ripple', {
  // tileable ripple / flow-streak height field (normal map is what we use)
  defaults: { c0: 0x808080, p0: [0, 0, 0, 0], meters: 4, bump: 2.2, size: 512 },
  glsl: `S surface(vec2 uv){
    float h = fbm(uv * vec2(1.0, 2.5), vec2(5.0, 12.0), 5) * 0.65 + fbm(uv + 3.1, vec2(14.0, 9.0), 3) * 0.35;
    h += 0.12 * sin((uv.y + fbm(uv, vec2(3.0), 3) * 0.2) * 2.0 * PI * 9.0);
    S s; s.albedo = vec3(h); s.height = h; s.rough = 0.1; s.ao = 1.0; s.metal = 0.0; return s; }`,
});

const WATER_VS = /* glsl */`
  attribute vec4 aFlow;   // flow dir xz, speed, foam
  attribute float aDepth;
  varying vec3 vWPos; varying vec4 vFlow; varying float vDepth;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWPos = wp.xyz; vFlow = aFlow; vDepth = aDepth;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

function waterFS(skyGlsl) {
  return skyGlsl + /* glsl */`
  uniform sampler2D tRipple, tFoam;
  uniform float uTimeW, uFlowSign;
  uniform vec3 uDeep, uShallow, uAmb, uSunC;
  varying vec3 vWPos; varying vec4 vFlow; varying float vDepth;
  void main(){
    vec2 flow = vFlow.xy * vFlow.z * uFlowSign;
    float t = uTimeW;
    float ph0 = fract(t * 0.22), ph1 = fract(t * 0.22 + 0.5);
    float wgt = abs(ph0 - 0.5) * 2.0;
    vec2 uv = vWPos.xz;
    vec3 n0 = texture2D(tRipple, uv * 0.3 - flow * ph0 * 1.9).xyz * 2.0 - 1.0;
    vec3 n1 = texture2D(tRipple, uv * 0.3 - flow * ph1 * 1.9 + 0.37).xyz * 2.0 - 1.0;
    vec3 nA = mix(n0, n1, wgt);
    vec3 n2 = texture2D(tRipple, uv * 1.1 + vec2(t * 0.045, -t * 0.037)).xyz * 2.0 - 1.0;
    float rough = 0.35 + vFlow.z * 0.55 + vFlow.w * 0.6;
    vec2 tn = nA.xy * rough + n2.xy * 0.22;
    vec3 N = normalize(vec3(tn.x, 1.0, tn.y));
    vec3 V = normalize(cameraPosition - vWPos);
    float ndv = max(dot(N, V), 0.0);
    float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-V, N); R.y = abs(R.y) + 0.02;
    vec3 refl = skyColor(normalize(R));
    // the valley walls and the forest on the far bank occlude the low sky in the reflection: what the
    // river mirrors at low angles is dark conifers and wet granite, only the high sky stays bright
    float occl = smoothstep(0.1, 0.55, R.y);
    vec3 bank = uAmb * vec3(0.085, 0.11, 0.075) + uSunC * vec3(0.02, 0.022, 0.012);
    refl = mix(bank, refl, occl);
    F *= 0.8;
    float sd = max(dot(normalize(R), uSunDir), 0.0);
    vec3 spec = uSunC * (pow(sd, 700.0) * 26.0 + pow(sd, 80.0) * 0.5);
    float d = max(vDepth, 0.0);
    float a = 1.0 - exp(-d * 2.4);
    vec3 body = mix(uShallow, uDeep, smoothstep(0.05, 0.75, d)) * uAmb;
    // white water: foam streaks dragged by the current
    float f1 = texture2D(tFoam, uv * vec2(0.45, 0.45) - flow * ph0 * 1.9).r;
    float f2 = texture2D(tFoam, uv * vec2(0.45, 0.45) - flow * ph1 * 1.9 + 0.5).r;
    float fm = mix(f1, f2, wgt);
    float foamMask = clamp(vFlow.w, 0.0, 1.0);
    float foam = smoothstep(0.62 - foamMask * 0.4, 0.9, fm) * foamMask;
    foam += (1.0 - smoothstep(0.0, 0.06, d)) * 0.4 * smoothstep(0.4, 0.75, fm);
    foam = clamp(foam, 0.0, 1.0);
    vec3 foamC = vec3(0.9, 0.95, 0.94) * uAmb * 1.25 + uSunC * 0.12;
    float edge = smoothstep(0.0, 0.035, d);
    float cover = 1.0 - (1.0 - a) * (1.0 - F) * (1.0 - foam);
    vec3 col = body * a * (1.0 - F) * (1.0 - foam) + refl * F * (1.0 - foam) + foamC * foam + spec * (1.0 - foam);
    gl_FragColor = vec4(col * edge, cover * edge);
  }`;
}

// ---------------------------------------------------------------------------
export class WaterSystem {
  constructor(level) {
    this.level = level;
    this.gw = level.gw;
    this.group = new THREE.Group();
    this.group.name = 'water';
    const sky = level.sky;
    const size = texSize(512);
    const rip = Synth.pbr('gl_ripple', { size });
    const foam = Synth.pbr('gl_foam', { size });
    this.uniforms = {
      ...sky.uniforms, uNoSun: { value: 0 },
      tRipple: { value: rip.normalMap }, tFoam: { value: foam.orm },
      uTimeW: { value: 0 }, uDeep: { value: new THREE.Color(0x0c4a52) }, uShallow: { value: new THREE.Color(0x3a9a92) },
      uAmb: { value: new THREE.Color(1, 1, 1) }, uSunC: { value: new THREE.Color(1, 1, 1) }, uFlowSign: { value: 1 },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: WATER_VS, fragmentShader: waterFS(sky.skyGlsl),
      transparent: true, premultipliedAlpha: true, depthWrite: true,
    });
    this.mat.blending = THREE.CustomBlending;
    this.mat.blendSrc = THREE.OneFactor;
    this.mat.blendDst = THREE.OneMinusSrcAlphaFactor;
    this.blocks = new Map();
    this.lastCam = new THREE.Vector3(1e9, 0, 1e9);
    this.R = 300;
    this._buildFall();
  }

  // 48 m water blocks (1.5 m grid, wet quads only)
  _block(bx, bz) {
    const S = 48, n = 32, st = S / n;
    const x0 = bx * S, z0 = bz * S;
    // quick reject: is any river (or the hero pool) near this block?
    const gw = this.gw;
    let near = false;
    const r = {};
    for (let j = 0; j <= 4 && !near; j++) for (let i = 0; i <= 4 && !near; i++) {
      gw.river(x0 + i * 12, z0 + j * 12, r);
      if (r.dist < r.w + 12) near = true;
    }
    const h = gw.hero;
    if (Math.hypot(x0 + 24 - h.lipX, z0 + 24 - h.lipZ) < 48) near = true;
    if (!near) return null;
    const N1 = n + 1;
    const depth = new Float32Array(N1 * N1);
    const flow = new Float32Array(N1 * N1 * 4);
    const rocks = [];
    for (let cz = Math.floor(z0 / CHUNK_M) - 1; cz <= Math.floor((z0 + S) / CHUNK_M); cz++) for (let cx = Math.floor(x0 / CHUNK_M) - 1; cx <= Math.floor((x0 + S) / CHUNK_M); cx++) {
      for (const rk of gw.scatter(cx, cz, this.level.variantFn(cx, cz)).rocks) if (rk.type === 'river') rocks.push(rk);
    }
    let wet = 0;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const x = x0 + i * st, z = z0 + j * st;
      const k = j * N1 + i;
      const g = Math.abs(x - this.level.game.local.pos.x) < 70 && Math.abs(z - this.level.game.local.pos.z) < 70 ? gw.groundAt(x, z, this.level.variantFn) : gw.height(x, z);
      const d = WATER_Y - g;
      depth[k] = d;
      if (d > -0.05) wet++;
      gw.river(x, z, r);
      const cen = Math.max(0, 1 - (r.dist / Math.max(0.5, r.w)) ** 2);
      let speed = 0.25 + 1.1 * cen;
      let fx = r.fx, fz = r.fz;
      // the plunge pool churns outward from the fall
      const pd = Math.hypot(x - h.lipX, z - h.lipZ);
      let foam = 0;
      if (!h.none && pd < 9) {
        const ox = (x - h.footX), oz = (z - h.footZ), ol = Math.hypot(ox, oz) || 1;
        const k2 = 1 - Math.min(1, pd / 9);
        fx = fx * (1 - k2) + (ox / ol) * k2; fz = fz * (1 - k2) + (oz / ol) * k2;
        speed = Math.max(speed, 0.6 + k2 * 0.9);
        const fk = Math.max(0, 1 - Math.hypot(x - h.footX, z - h.footZ) / 6.5);
        foam = Math.max(foam, Math.min(1, fk * fk * 1.6));
      }
      for (const rk of rocks) {
        const dd = Math.hypot(x - rk.x, z - rk.z);
        if (dd < rk.r + 2.2) foam = Math.max(foam, (1 - Math.max(0, dd - rk.r * 0.6) / 2.0) * (0.55 + cen * 0.5));
      }
      foam = Math.max(foam, (1 - Math.min(1, d / 0.12)) * 0.35);
      const fl = Math.hypot(fx, fz) || 1;
      flow[k * 4] = fx / fl; flow[k * 4 + 1] = fz / fl; flow[k * 4 + 2] = speed; flow[k * 4 + 3] = Math.max(0, Math.min(1, foam));
    }
    if (!wet) return null;
    const idx = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = j * N1 + i, b = a + 1, c = a + N1, d = c + 1;
      if (depth[a] < -0.02 && depth[b] < -0.02 && depth[c] < -0.02 && depth[d] < -0.02) continue;
      idx.push(a, c, b, b, c, d);
    }
    if (!idx.length) return null;
    const pos = new Float32Array(N1 * N1 * 3);
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const k = j * N1 + i;
      pos[k * 3] = x0 + i * st; pos[k * 3 + 1] = WATER_Y; pos[k * 3 + 2] = z0 + j * st;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
    geo.setAttribute('aFlow', new THREE.BufferAttribute(flow, 4));
    geo.setIndex(idx);
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(x0, WATER_Y - 1, z0), new THREE.Vector3(x0 + S, WATER_Y + 1, z0 + S));
    geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
    return geo;
  }

  // all water blocks around the camera merged into one draw call
  _remerge() {
    const geos = [...this.blocks.values()].filter(Boolean);
    if (this.mesh) { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh = null; }
    if (!geos.length) return;
    let nv = 0, ni = 0;
    for (const g of geos) { nv += g.attributes.position.count; ni += g.index.count; }
    const pos = new Float32Array(nv * 3), dep = new Float32Array(nv), flo = new Float32Array(nv * 4);
    const idx = new Uint32Array(ni);
    let vo = 0, io = 0;
    const box = new THREE.Box3();
    for (const g of geos) {
      pos.set(g.attributes.position.array, vo * 3);
      dep.set(g.attributes.aDepth.array, vo);
      flo.set(g.attributes.aFlow.array, vo * 4);
      const gi = g.index.array;
      for (let k = 0; k < gi.length; k++) idx[io + k] = gi[k] + vo;
      vo += g.attributes.position.count; io += gi.length;
      box.union(g.boundingBox);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aDepth', new THREE.BufferAttribute(dep, 1));
    geo.setAttribute('aFlow', new THREE.BufferAttribute(flo, 4));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingBox = box;
    geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.renderOrder = 3;
    this.mesh.name = 'water';
    this.mesh.matrixAutoUpdate = false;
    this.group.add(this.mesh);
  }

  update(dt, cam, sky) {
    const U = this.uniforms;
    U.uTimeW.value += dt;
    const S = sky.state;
    const above = THREE.MathUtils.smoothstep(S.elev, -2.5, 3.5);
    U.uAmb.value.copy(S.zen).lerp(S.hor, 0.6).multiplyScalar(0.8).add(new THREE.Color().copy(S.sun).multiplyScalar(0.18 * (S.sunI / 6) * above));
    U.uSunC.value.copy(S.sun).multiplyScalar(Math.max(0.05, S.sunI / 6) * above);
    U.uDeep.value.setRGB(0.03, 0.2, 0.22).lerp(new THREE.Color(0.18, 0.03, 0.02), S.sick * 0.8);
    U.uShallow.value.setRGB(0.16, 0.42, 0.38).lerp(new THREE.Color(0.35, 0.1, 0.06), S.sick * 0.8);
    // on the last day the river quietly runs uphill
    U.uFlowSign.value += ((S.sick > 0.5 ? -1 : 1) - U.uFlowSign.value) * Math.min(1, dt * 0.2);
    this._updateFall(dt, cam, S);
    if (cam.distanceTo(this.lastCam) < 12 && !this.force) return;
    this.lastCam.copy(cam);
    const B = 48, R = this.R;
    const want = new Set();
    for (let bz = Math.floor((cam.z - R) / B); bz <= Math.floor((cam.z + R) / B); bz++) for (let bx = Math.floor((cam.x - R) / B); bx <= Math.floor((cam.x + R) / B); bx++) {
      const dx = Math.max(bx * B - cam.x, 0, cam.x - (bx + 1) * B), dz = Math.max(bz * B - cam.z, 0, cam.z - (bz + 1) * B);
      if (dx * dx + dz * dz < R * R) want.add(`${bx},${bz}`);
    }
    const t0 = performance.now();
    let changed = false;
    for (const k of want) {
      if (this.blocks.has(k)) continue;
      if (!this.force && performance.now() - t0 > 4) { this.lastCam.set(1e9, 0, 1e9); break; }
      const [bx, bz] = k.split(',').map(Number);
      const g = this._block(bx, bz);
      this.blocks.set(k, g);
      if (g) changed = true;
    }
    for (const [k, g] of this.blocks) {
      if (want.has(k)) continue;
      if (g) { g.dispose(); changed = true; }
      this.blocks.delete(k);
    }
    if (changed) this._remerge();
  }

  invalidate(cx, cz) {
    const k = `${Math.floor((cx * CHUNK_M) / 48)},${Math.floor((cz * CHUNK_M) / 48)}`;
    const g = this.blocks.get(k);
    if (g) g.dispose();
    this.blocks.delete(k);
    this.lastCam.set(1e9, 0, 1e9);
  }

  // -----------------------------------------------------------------------
  // the hero waterfall
  _buildFall() {
    const h = this.gw.hero;
    this.fall = null;
    if (h.none || (h.drop || 0) < 6) return;
    const gw = this.gw;
    const top = gw.height(h.topX, h.topZ) + 0.25;
    const bottom = WATER_Y;
    const D = top - bottom;
    const nx = h.nx, nz = h.nz;
    const sx = -nz, sz = nx; // across the fall
    const segs = 28, cols = 8;
    const tEnd = Math.sqrt((2 * D) / 9.8);
    const v0 = 1.7;
    const mk = (widthTop, widthBot, push, alphaK) => {
      const pos = [], uv = [], idx = [], aux = [];
      for (let s = 0; s <= segs; s++) {
        const u = s / segs;
        const t = u * tEnd;
        const out = v0 * t + push;
        const y = top - 4.9 * t * t;
        const w = widthTop + (widthBot - widthTop) * Math.pow(u, 0.8);
        for (let c = 0; c <= cols; c++) {
          const a = c / cols - 0.5;
          const bulge = Math.cos(a * Math.PI) * 0.35;
          const x = h.topX + nx * (out + bulge) + sx * a * w;
          const z = h.topZ + nz * (out + bulge) + sz * a * w;
          pos.push(x, Math.max(bottom - 0.2, y), z);
          uv.push(c / cols, (top - y) / 3.0);
          aux.push(u, alphaK);
        }
      }
      for (let s = 0; s < segs; s++) for (let c = 0; c < cols; c++) {
        const a = s * (cols + 1) + c, b = a + 1, cc = a + cols + 1, d = cc + 1;
        idx.push(a, cc, b, b, cc, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('aFall', new THREE.Float32BufferAttribute(aux, 2));
      g.setIndex(idx);
      g.computeBoundingSphere();
      return g;
    };
    const U = this.fallU = { uTime: { value: 0 }, tNoise: { value: noiseTexture() }, uCol: { value: new THREE.Color(1, 1, 1) }, uSunC: { value: new THREE.Color(1, 1, 1) } };
    const mat = new THREE.ShaderMaterial({
      uniforms: U,
      vertexShader: `attribute vec2 aFall; varying vec2 vUv; varying vec2 vF; void main(){ vUv = uv; vF = aFall; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uTime; uniform sampler2D tNoise; uniform vec3 uCol, uSunC; varying vec2 vUv; varying vec2 vF;
        void main(){
          float sp = 1.6 + vF.x * 2.4;
          // slow lanes across the width (where the lip feeds more water), stable over time
          float lane = smoothstep(0.3, 0.72, texture2D(tNoise, vec2(vUv.x * 0.9 + 0.13, 0.37)).r);
          // racing streaks at three scales
          float s1 = texture2D(tNoise, vec2(vUv.x * 2.7, vUv.y * 0.2 - uTime * sp * 0.31)).r;
          float s2 = texture2D(tNoise, vec2(vUv.x * 6.3 + 0.3, vUv.y * 0.42 - uTime * sp * 0.5)).g;
          float s3 = texture2D(tNoise, vec2(vUv.x * 14.0 + 0.6, vUv.y * 0.85 - uTime * sp * 0.78)).b;
          float st = s1 * 0.5 + s2 * 0.32 + s3 * 0.22;
          float dens = smoothstep(0.32, 0.78, st * (0.62 + 0.62 * lane));
          // the curtain tears into fingers and spray toward the bottom
          float low = smoothstep(0.5, 1.0, vF.x);
          dens *= mix(1.0, smoothstep(0.3, 0.72, s2 * 0.7 + s3 * 0.6), low * 0.7);
          float edge = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
          float a = (0.08 + dens * 0.92) * edge * vF.y * smoothstep(0.0, 0.05, vF.x + 0.02) * (1.0 - smoothstep(0.9, 1.0, vF.x) * 0.5);
          // aerated white water: brighter where dense, a greenish clear tint in the thin sheets, sun glints
          vec3 c = mix(uCol * vec3(0.55, 0.72, 0.7), uCol * 1.15, dens) + uSunC * pow(dens, 3.0) * 0.35;
          gl_FragColor = vec4(c * a, a);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneMinusSrcAlphaFactor;
    const core = new THREE.Mesh(mk(3.0, 4.6, 0.15, 1.0), mat);
    const veil = new THREE.Mesh(mk(4.4, 7.5, 0.5, 0.35), mat);
    core.renderOrder = 4; veil.renderOrder = 5;
    core.name = 'waterfall'; veil.name = 'waterfall_veil';
    this.group.add(core, veil);
    // mist billboards
    const MN = 46;
    const mg = new THREE.InstancedBufferGeometry();
    mg.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
    mg.setIndex([0, 1, 2, 1, 3, 2]);
    this.mist = new Float32Array(MN * 4); // x y z size
    this.mistA = new Float32Array(MN);    // alpha
    this.mistLife = new Float32Array(MN).map(() => Math.random() * 7);
    this.mistVel = new Float32Array(MN * 3);
    mg.setAttribute('iP', new THREE.InstancedBufferAttribute(this.mist, 4).setUsage(THREE.DynamicDrawUsage));
    mg.setAttribute('iA', new THREE.InstancedBufferAttribute(this.mistA, 1).setUsage(THREE.DynamicDrawUsage));
    mg.instanceCount = MN;
    this.mistU = { uCol: { value: new THREE.Color(1, 1, 1) }, tNoise: { value: noiseTexture() } };
    const mm = new THREE.ShaderMaterial({
      uniforms: this.mistU,
      vertexShader: `attribute vec4 iP; attribute float iA; varying vec2 vUv; varying float vA;
        void main(){ vUv = position.xy * 0.5 + 0.5; vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]); vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 p = iP.xyz + (r * position.x + u * position.y) * iP.w;
          float d = distance(p, cameraPosition); vA = iA * smoothstep(1.5, 6.0, d);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
      fragmentShader: `uniform vec3 uCol; uniform sampler2D tNoise; varying vec2 vUv; varying float vA;
        void main(){ float r = length(vUv - 0.5) * 2.0; float n = texture2D(tNoise, vUv * 0.7 + vA).r; float a = smoothstep(1.0, 0.1, r) * (0.55 + 0.45 * n) * vA; gl_FragColor = vec4(uCol * a, a); }`,
      transparent: true, depthWrite: false,
    });
    mm.blending = THREE.CustomBlending;
    mm.blendSrc = THREE.OneFactor;
    mm.blendDst = THREE.OneMinusSrcAlphaFactor;
    const mist = new THREE.Mesh(mg, mm);
    mist.frustumCulled = false;
    mist.renderOrder = 6;
    mist.name = 'waterfall_mist';
    this.group.add(mist);
    this.fall = { core, veil, mist, top, base: new THREE.Vector3(h.footX + nx * 1.6, WATER_Y, h.footZ + nz * 1.6), D };
  }

  _updateFall(dt, cam, S) {
    if (!this.fall) return;
    this.fallU.uTime.value += dt;
    const lum = new THREE.Color().copy(S.hor).lerp(S.zen, 0.3).multiplyScalar(0.9).add(new THREE.Color().copy(S.sun).multiplyScalar(0.25 * (S.sunI / 6)));
    this.fallU.uCol.value.copy(lum);
    this.fallU.uSunC.value.copy(S.sun).multiplyScalar(Math.max(0, S.sunI / 6) * THREE.MathUtils.smoothstep(S.elev, -2.5, 3.5));
    this.mistU.uCol.value.copy(lum).multiplyScalar(1.05);
    const f = this.fall;
    const h = this.gw.hero;
    const near = cam.distanceTo(f.base) < 260;
    f.mist.visible = near;
    if (!near) return;
    const MN = this.mistA.length;
    for (let i = 0; i < MN; i++) {
      this.mistLife[i] -= dt;
      let L = this.mistLife[i];
      if (L <= 0) {
        L = this.mistLife[i] = 5 + Math.random() * 4;
        const a = (Math.random() - 0.5) * 3.6;
        this.mist[i * 4] = f.base.x + (-h.nz) * a + h.nx * Math.random() * 1.5;
        this.mist[i * 4 + 1] = WATER_Y + 0.3 + Math.random() * 1.2;
        this.mist[i * 4 + 2] = f.base.z + h.nx * a + h.nz * Math.random() * 1.5;
        this.mist[i * 4 + 3] = 1.2 + Math.random();
        this.mistVel[i * 3] = h.nx * (0.6 + Math.random() * 0.8) + (Math.random() - 0.5) * 0.4;
        this.mistVel[i * 3 + 1] = 0.35 + Math.random() * 0.5;
        this.mistVel[i * 3 + 2] = h.nz * (0.6 + Math.random() * 0.8) + (Math.random() - 0.5) * 0.4;
      }
      this.mist[i * 4] += this.mistVel[i * 3] * dt;
      this.mist[i * 4 + 1] += this.mistVel[i * 3 + 1] * dt;
      this.mist[i * 4 + 2] += this.mistVel[i * 3 + 2] * dt;
      this.mist[i * 4 + 3] += dt * 0.55;
      const age = 1 - L / 9;
      this.mistA[i] = Math.sin(Math.min(1, Math.max(0, age)) * Math.PI) * 0.22;
    }
    f.mist.geometry.attributes.iP.needsUpdate = true;
    f.mist.geometry.attributes.iA.needsUpdate = true;
  }

  dispose() {
    this.group.removeFromParent();
    for (const g of this.blocks.values()) g?.dispose();
    this.mesh?.geometry.dispose();
    this.mat.dispose();
  }
}
