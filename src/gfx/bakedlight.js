// "Dynamic baked" lighting for liminal spaces.
//
// Every static world vertex stores the 4 most relevant ceiling lights (as texel addresses into
// a global light-state texture) plus their pre-computed weights (distance falloff, Lambert term,
// 2D occlusion and corner AO). The shader looks the live light colours up per vertex, so
// individual fluorescent tubes can flicker, die, or turn red during reality collapse while the
// whole level still renders with one material per surface type and no per-pixel light loops.
//
// Dynamic objects (props, players, monsters) use a per-object irradiance "probe" uniform that
// is computed from the same light field on the CPU.
import * as THREE from 'three';
import * as Tex from './textures.js';

export const FIELD_SIZE = 128;

export class LightField {
  constructor() {
    this.size = FIELD_SIZE;
    this.data = new Uint8Array(this.size * this.size * 4);
    this.tex = new THREE.DataTexture(this.data, this.size, this.size, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;
    this.lights = new Map(); // texel index -> light record
    this.dirty = true;
    this.uniforms = {
      uLightTex: { value: this.tex },
      uLightScale: { value: 1.0 },
      uAmbient: { value: new THREE.Color(0.02, 0.018, 0.012) },
      uTime: { value: 0 },
      uCollapse: { value: 0 },
      uNoiseTex: { value: Tex.get('noise').map },
      uGrime: { value: 1 },
    };
    this.globalMul = 1;
    this.tint = new THREE.Color(1, 1, 1);
  }

  static texel(cx, cz) {
    const s = FIELD_SIZE;
    return (((cz % s) + s) % s) * s + (((cx % s) + s) % s);
  }

  // register a light; key = texel index
  add(key, x, y, z, color, intensity, opts = {}) {
    const l = {
      key, x, y, z,
      color: new THREE.Color(color),
      base: intensity,
      intensity,
      mode: opts.mode || 'on', // on | flicker | dead | buzz
      phase: Math.random() * 100,
      radius: opts.radius ?? 9,
      seed: opts.seed ?? Math.random(),
      power: 1,
      override: null,
    };
    this.lights.set(key, l);
    this.dirty = true;
    return l;
  }

  clear() {
    this.lights.clear();
    this.data.fill(0);
    this.globalMul = 1;
    this.tint.setRGB(1, 1, 1);
    this.uniforms.uCollapse.value = 0;
    this.uniforms.uLightScale.value = 1;
    this.dirty = true;
    this.tex.needsUpdate = true;
  }

  remove(key) {
    if (this.lights.delete(key)) {
      const i = key * 4;
      this.data[i] = this.data[i + 1] = this.data[i + 2] = 0;
      this.dirty = true;
    }
  }

  get(key) { return this.lights.get(key); }

  // live intensity (0..2) of a light, including flicker
  liveIntensity(l, t) {
    if (l.mode === 'dead') return 0;
    let v = l.base * l.power;
    if (l.mode === 'flicker') {
      const s = Math.sin(t * 13.0 + l.phase) + Math.sin(t * 31.7 + l.phase * 2.3) + Math.sin(t * 2.3 + l.phase);
      const off = s > 1.2 + l.seed * 0.6 ? 0 : 1;
      const stutter = Math.sin(t * 60 + l.phase) > 0.8 ? 0.55 : 1;
      v *= off * stutter;
    } else if (l.mode === 'buzz') {
      v *= 0.85 + 0.15 * Math.sin(t * 120 + l.phase);
    }
    return v;
  }

  update(t) {
    this.uniforms.uTime.value = t;
    const d = this.data;
    let changed = this.dirty;
    for (const l of this.lights.values()) {
      if (l.mode === 'on' && !this.dirty && !l._force) continue;
      l._force = false;
      const v = this.liveIntensity(l, t) * this.globalMul;
      l.intensity = v;
      const i = l.key * 4;
      const c = l.override || l.color;
      const r = Math.min(255, (c.r * this.tint.r * v * 0.5) * 255);
      const g = Math.min(255, (c.g * this.tint.g * v * 0.5) * 255);
      const b = Math.min(255, (c.b * this.tint.b * v * 0.5) * 255);
      if (d[i] !== (r | 0) || d[i + 1] !== (g | 0) || d[i + 2] !== (b | 0)) {
        d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
        changed = true;
      }
    }
    this.dirty = false;
    if (changed) this.tex.needsUpdate = true;
  }

  forceRefresh() { this.dirty = true; }

  // CPU irradiance at a point (for probes). occl(x0,z0,x1,z1) -> 0..1 transmission
  sample(pos, out, occl = null, maxLights = 6) {
    out.setRGB(0, 0, 0);
    let n = 0;
    for (const l of this.lights.values()) {
      const dx = l.x - pos.x, dy = l.y - pos.y, dz = l.z - pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > l.radius * l.radius) continue;
      if (l.intensity <= 0.001) continue;
      let w = lightWeight(Math.sqrt(d2), l.radius) * 0.75;
      if (occl) w *= occl(pos.x, pos.z, l.x, l.z);
      if (w <= 0) continue;
      const c = l.override || l.color;
      out.r += c.r * this.tint.r * l.intensity * w;
      out.g += c.g * this.tint.g * l.intensity * w;
      out.b += c.b * this.tint.b * l.intensity * w;
      if (++n >= maxLights) break;
    }
    return out;
  }
}

// One light field shared by every world (materials compiled against its uniforms stay valid)
let _shared = null;
export function sharedField() {
  if (!_shared) _shared = new LightField();
  return _shared;
}

// falloff for broad fluorescent panels: soft near, smooth to zero at radius
export function lightWeight(d, radius) {
  const k = 1 / (1 + 0.16 * d * d);
  const edge = Math.max(0, 1 - Math.pow(d / radius, 4));
  return k * edge;
}

// ---------------------------------------------------------------------------
// Baking: fills aLightCells (vec4 texel indices), aLightW (vec4 weights), aBounce (float AO*bounce)
// lightsNear(x, z) -> iterable of lights {key,x,y,z,radius,base}
// occl(x0,z0,x1,z1) -> transmission 0..1 ; ao(x,y,z,nx,ny,nz) -> 0..1
// ---------------------------------------------------------------------------
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();

export function bakeGeometry(geo, matrixWorld, lightsNear, occl, ao, opts = {}) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const count = pos.count;
  const cells = new Float32Array(count * 4);
  const weights = new Float32Array(count * 4);
  const bounce = new Float32Array(count);
  const nm = new THREE.Matrix3().getNormalMatrix(matrixWorld);
  const cand = [];
  const bounceMul = opts.bounce ?? 0.22;
  const directMul = opts.direct ?? 1.0;
  for (let i = 0; i < count; i++) {
    _p.fromBufferAttribute(pos, i).applyMatrix4(matrixWorld);
    _n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
    // nudge sample point off the surface to avoid self-occlusion on edges
    const sx = _p.x + _n.x * 0.05, sy = _p.y + _n.y * 0.05, sz = _p.z + _n.z * 0.05;
    cand.length = 0;
    let bsum = 0;
    for (const l of lightsNear(sx, sz)) {
      const dx = l.x - sx, dy = l.y - sy, dz = l.z - sz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > l.radius) continue;
      const fall = lightWeight(d, l.radius);
      const ndl = (dx * _n.x + dy * _n.y + dz * _n.z) / Math.max(d, 1e-3);
      // panels emit downward: cosine on the emitter side too
      const emit = Math.max(0.12, Math.min(1, (l.y - sy) / Math.max(d, 1e-3) * 1.2 + 0.15));
      let w = fall * Math.max(0, ndl * 0.85 + 0.15) * emit;
      const t = occl ? occl(sx, sz, l.x, l.z, sy) : 1;
      w *= t;
      // bounce light: light hitting nearby floor lights everything softly (even ceilings)
      const b = fall * 0.5 * (0.35 + 0.65 * t);
      if (w > 0.002 || b > 0.002) cand.push({ key: l.key, w: w * directMul + b * bounceMul });
      bsum += b;
    }
    cand.sort((a, b) => b.w - a.w);
    for (let k = 0; k < 4; k++) {
      const c = cand[k];
      cells[i * 4 + k] = c ? c.key : 0;
      weights[i * 4 + k] = c ? c.w : 0;
    }
    // remaining candidates folded in as a tiny constant
    let rest = 0;
    for (let k = 4; k < cand.length; k++) rest += cand[k].w;
    const a = ao ? ao(_p.x, _p.y, _p.z, _n.x, _n.y, _n.z) : 1;
    bounce[i] = a + Math.min(0.0, rest * 0); // AO stored; rest ignored (kept for future)
    if (cand.length > 4 && rest > 0) {
      // distribute the rest proportionally onto the top-4 to keep total energy similar
      const top = weights[i * 4] + weights[i * 4 + 1] + weights[i * 4 + 2] + weights[i * 4 + 3];
      if (top > 0) {
        const s = (top + rest * 0.6) / top;
        for (let k = 0; k < 4; k++) weights[i * 4 + k] *= s;
      }
    }
    void bsum;
  }
  geo.setAttribute('aLightCells', new THREE.BufferAttribute(cells, 4));
  geo.setAttribute('aLightW', new THREE.BufferAttribute(weights, 4));
  geo.setAttribute('aAO', new THREE.BufferAttribute(bounce, 1));
  return geo;
}

// ---------------------------------------------------------------------------
// Material patching
// ---------------------------------------------------------------------------
const bakedCache = new Map();

// grime kinds: 0 none, 1 carpet stains, 2 wallpaper (dirt at bottom, water streaks), 3 ceiling water damage, 4 concrete
export function bakedMaterial(base, field, grimeKind = 0, opts = {}) {
  const key = `${base.uuid}|${grimeKind}|${opts.emissiveLights ? 1 : 0}|${opts.wet ? 1 : 0}`;
  if (bakedCache.has(key)) return bakedCache.get(key);
  const m = base.clone();
  m.name = `${base.name}_baked`;
  m.userData.baked = true;
  m.customProgramCacheKey = () => `baked_${grimeKind}_${opts.emissiveLights ? 1 : 0}_${opts.wet ? 1 : 0}`;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, field.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aLightCells;
        attribute vec4 aLightW;
        attribute float aAO;
        ${opts.wet ? 'attribute float aWet; varying float vWet;' : ''}
        uniform sampler2D uLightTex;
        uniform float uLightScale;
        uniform float uCollapse;
        uniform float uTime;
        varying vec3 vBaked;
        varying vec3 vWPos;
        varying float vAO;
        vec3 fetchLight(float cell){
          float s = ${FIELD_SIZE.toFixed(1)};
          vec2 uv = (vec2(mod(cell, s), floor(cell / s)) + 0.5) / s;
          return texture2D(uLightTex, uv).rgb * 2.0;
        }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 bk = fetchLight(aLightCells.x) * aLightW.x + fetchLight(aLightCells.y) * aLightW.y
                + fetchLight(aLightCells.z) * aLightW.z + fetchLight(aLightCells.w) * aLightW.w;
        vBaked = bk * uLightScale;
        vAO = aAO;
        ${opts.wet ? 'vWet = aWet;' : ''}
        if (uCollapse > 0.0) {
          vec4 wp0 = modelMatrix * vec4(transformed, 1.0);
          float wob = sin(wp0.x * 1.7 + uTime * 1.3) * sin(wp0.z * 1.3 - uTime * 0.9) * sin(wp0.y * 2.0 + uTime * 0.7);
          transformed += normal * wob * 0.09 * uCollapse;
        }`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    // worldpos_vertex only computes when needed; ensure vWPos always set
    if (!shader.vertexShader.includes('vWPos = (modelMatrix')) {
      shader.vertexShader = shader.vertexShader.replace('#include <fog_vertex>', `vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <fog_vertex>`);
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vBaked;
        varying vec3 vWPos;
        varying float vAO;
        ${opts.wet ? 'varying float vWet;' : ''}
        uniform vec3 uAmbient;
        uniform sampler2D uNoiseTex;
        uniform float uGrime;
        uniform float uTime;
        uniform float uCollapse;
        float nz(vec2 p){ return texture2D(uNoiseTex, p).r; }
        float nz2(vec2 p){ return texture2D(uNoiseTex, p).g; }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float g = 1.0;
          ${grimeKind === 1 ? `
            // carpet: big blotchy stains + darker paths + damp rings
            float s1 = nz(vWPos.xz * 0.045);
            float s2 = nz2(vWPos.xz * 0.21 + 3.1);
            float stain = smoothstep(0.58, 0.72, s1) * 0.35 + smoothstep(0.62, 0.7, s2) * 0.22;
            float ring = smoothstep(0.02, 0.0, abs(s1 - 0.66)) * 0.18;
            g = 1.0 - (stain + ring) * uGrime;
            diffuseColor.rgb *= mix(vec3(1.0), vec3(0.72, 0.62, 0.42), (stain + ring) * uGrime * 0.6);
            diffuseColor.rgb *= g;
          ` : ''}
          ${grimeKind === 2 ? `
            // wallpaper: grime at the base, water streaks from above, sun-faded blotches
            float h = vWPos.y;
            float base = smoothstep(0.55, 0.0, h) * 0.22;
            float streakN = nz(vec2(vWPos.x * 0.9 + vWPos.z * 0.9, 0.13));
            float streak = smoothstep(0.62, 0.8, streakN) * smoothstep(1.2, 2.9, h) * 0.3 * nz2(vec2((vWPos.x+vWPos.z)*0.5, h*0.15));
            float blot = smoothstep(0.55, 0.75, nz((vWPos.xz + vWPos.y) * 0.08)) * 0.12;
            g = 1.0 - (base + streak + blot) * uGrime;
            diffuseColor.rgb *= mix(vec3(1.0), vec3(0.82, 0.74, 0.5), (streak + base) * uGrime);
            diffuseColor.rgb *= g;
          ` : ''}
          ${grimeKind === 3 ? `
            float wd = nz(vWPos.xz * 0.11 + 7.0);
            float ringc = smoothstep(0.03, 0.0, abs(wd - 0.68)) * 0.35 + smoothstep(0.66, 0.8, wd) * 0.25;
            diffuseColor.rgb *= mix(vec3(1.0), vec3(0.74, 0.62, 0.4), ringc * uGrime);
          ` : ''}
          ${grimeKind === 4 ? `
            float c1 = nz(vWPos.xz * 0.07 + vWPos.y * 0.05);
            diffuseColor.rgb *= 1.0 - smoothstep(0.55, 0.8, c1) * 0.3 * uGrime;
            diffuseColor.rgb *= 1.0 - smoothstep(0.6, 0.0, vWPos.y) * 0.25;
          ` : ''}
          ${opts.wet ? `diffuseColor.rgb *= mix(1.0, 0.55, vWet);` : ''}
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        ${opts.wet ? 'roughnessFactor = mix(roughnessFactor, 0.12, vWet);' : ''}`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        irradiance += (vBaked * vAO + uAmbient) * PI;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        ${opts.emissiveLights ? 'totalEmissiveRadiance *= clamp(vBaked * 1.1, 0.0, 2.0);' : ''}
        if (uCollapse > 0.0) {
          float rr = step(0.995 - uCollapse * 0.02, fract(sin(dot(floor(vWPos.xz*2.0 + floor(uTime*8.0)), vec2(12.9898,78.233)))*43758.5453));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.0), rr * uCollapse);
        }`);
  };
  bakedCache.set(key, m);
  return m;
}

// Probe-lit materials for dynamic objects: irradiance from a per-object uniform.
// Known probe materials are tracked in a WeakSet (material.clone() copies userData as JSON,
// so flags in userData can't be trusted after someone clones a patched material).
const probeCache = new Map();
const probeSet = new WeakSet();
const _probeShared = { value: new THREE.Color(0.25, 0.23, 0.2) };

export function probeMaterial(base) {
  if (probeSet.has(base) || base.userData?.baked) return base;
  if (probeCache.has(base.uuid)) return probeCache.get(base.uuid);
  const m = base.clone();
  m.userData = { ...base.userData, probe: true, probeUniform: { value: new THREE.Color(0.25, 0.23, 0.2) } };
  const prevKey = base.customProgramCacheKey?.() || '';
  m.customProgramCacheKey = () => `probe_${prevKey}`;
  const prevCompile = base.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    if (prevCompile && prevCompile !== THREE.Material.prototype.onBeforeCompile) prevCompile.call(m, shader, r);
    shader.uniforms.uProbe = m.userData.probeUniform;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uProbe;`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        irradiance += uProbe * PI;`);
  };
  probeSet.add(m);
  probeCache.set(base.uuid, m);
  return m;
}

function probeable(mat) {
  return mat && (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) && !(mat.transparent && mat.opacity < 0.5) && !mat.userData?.baked && !mat.userData?.noProbe;
}

// Patch an object tree so its meshes use probe materials driven by root.userData.probe (THREE.Color)
export function applyProbe(root) {
  if (!root.userData.probe) root.userData.probe = new THREE.Color(0.25, 0.23, 0.2);
  const probe = root.userData.probe;
  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    if (o.userData.noProbe || o.userData.probeHooked) return;
    o.userData.probeHooked = true;
    const swap = (mat) => (probeable(mat) ? probeMaterial(mat) : mat);
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    const prev = o.onBeforeRender;
    o.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
      if (probeSet.has(material)) {
        material.userData.probeUniform.value.copy(probe);
        material.uniformsNeedUpdate = true;
      } else if (!Array.isArray(this.material) && this.material === material && probeable(material)) {
        // material was replaced/cloned after patching: re-patch for the next frame
        this.material = probeMaterial(material);
      }
      if (prev && prev !== THREE.Object3D.prototype.onBeforeRender) prev.call(this, renderer, scene, camera, geometry, material, group);
    };
  });
  return probe;
}

export function sharedProbe() { return _probeShared; }
