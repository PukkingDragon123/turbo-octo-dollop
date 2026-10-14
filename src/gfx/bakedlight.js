// "Dynamic baked" lighting for liminal spaces.
//
// Lights live in a global light-state texture (one texel per ceiling fixture: colour * intensity), so
// fluorescent tubes can flicker, die, or turn red during reality collapse while the whole level renders
// with one material per surface type.
//
// Two shading paths share that texture:
//  * GRID (Level 0, grid: 1 / HQ rooms, grid: 2) — per-pixel lighting. Each static vertex stores the 2D
//    wall transmission towards the 8 fixtures around its cell (the cell's own fixture is always visible)
//    plus pre-weighted contributions of the next ring of 12 fixtures. The fragment shader evaluates the
//    nearest 3x3 fixtures per pixel (exact distance falloff, normal-mapped Lambert, GGX highlights widened
//    for the area of a troffer), adds their floor bounce and the vertex-interpolated outer ring as indirect
//    light, and applies analytic contact AO for floors / ceilings / walls. Lobby rooms use their regular
//    light grids (uniform arrays) the same way.
//  * LEGACY — every vertex stores its 4 strongest fixtures and pre-computed weights (irradiance only).
//    Kept for any geometry baked with bakeGeometry() (water, other levels).
//
// Dynamic objects (props, players, monsters) use a per-object irradiance "probe" uniform computed from
// the same light field on the CPU.
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
    const rooms = [], roomsB = [];
    for (let i = 0; i < 8; i++) { rooms.push(new THREE.Vector4()); roomsB.push(new THREE.Vector4()); }
    this.uniforms = {
      uLightTex: { value: this.tex },
      uLightScale: { value: 1.0 },
      uAmbient: { value: new THREE.Color(0.02, 0.018, 0.012) },
      uTime: { value: 0 },
      uCollapse: { value: 0 },
      uNoiseTex: { value: Tex.get('noise').map },
      uGrime: { value: 1 },
      // grid lighting: x cell size, y fixture height, z fixture radius, w ceiling height
      uGrid: { value: new THREE.Vector4(3, 2.86, 9, 2.9) },
      uOutScale: { value: OUT_SCALE },
      // lobby rooms: A = (x0, z0, dx, dz), B = (nx, nz, fixture y, key cell size)
      uRoomA: { value: rooms },
      uRoomB: { value: roomsB },
      uRoomKey: { value: new THREE.Vector2(1.5, 40) },
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

// outer-ring weights are stored as Uint16 normalized values of w / OUT_SCALE
export const OUT_SCALE = 2.0;

// One light field shared by every world (materials compiled against its uniforms stay valid)
let _shared = null;
export function sharedField() {
  if (!_shared) _shared = new LightField();
  return _shared;
}

// falloff for broad fluorescent panels: soft near, smooth to zero at radius
export function lightWeight(d, radius) {
  const k = 1 / (1 + 0.16 * d * d);
  const e = d / radius;
  const e2 = e * e;
  const edge = Math.max(0, 1 - e2 * e2);
  return k * edge;
}

// ---------------------------------------------------------------------------
// LEGACY baking: fills aLightCells (vec4 texel indices), aLightW (vec4 weights), aAO (float)
// lightsNear(x, z) -> iterable of lights {key,x,y,z,radius}
// occl(x0,z0,x1,z1,y) -> transmission 0..1 ; ao(x,y,z,nx,ny,nz) -> 0..1
// opts: direct, bounce (multipliers), exclude(light, x, y, z) -> true to skip a light for this vertex
// ---------------------------------------------------------------------------
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _ck = new Float64Array(64);
const _cw = new Float64Array(64);

export function bakeGeometry(geo, matrixWorld, lightsNear, occl, ao, opts = {}) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const count = pos.count;
  const cells = new Float32Array(count * 4);
  const weights = new Float32Array(count * 4);
  const aoArr = new Float32Array(count);
  const nm = new THREE.Matrix3().getNormalMatrix(matrixWorld);
  const bounceMul = opts.bounce ?? 0.22;
  const directMul = opts.direct ?? 1.0;
  const excl = opts.exclude || null;
  const identity = matrixWorld.equals(new THREE.Matrix4());
  // lightsNear results are cached per 1.5 m cell for the duration of this bake
  const lcache = new Map();
  const near = (x, z) => {
    const k = Math.floor(x / 1.5) * 100003 + Math.floor(z / 1.5);
    let r = lcache.get(k);
    if (!r) { r = [...lightsNear(x, z)]; lcache.set(k, r); }
    return r;
  };
  for (let i = 0; i < count; i++) {
    _p.fromBufferAttribute(pos, i);
    _n.fromBufferAttribute(nor, i);
    if (!identity) { _p.applyMatrix4(matrixWorld); _n.applyMatrix3(nm).normalize(); }
    // nudge sample point off the surface to avoid self-occlusion on edges
    const sx = _p.x + _n.x * 0.05, sy = _p.y + _n.y * 0.05, sz = _p.z + _n.z * 0.05;
    let nc = 0;
    for (const l of near(sx, sz)) {
      if (excl && excl(l, sx, sy, sz, i)) continue;
      const dx = l.x - sx, dy = l.y - sy, dz = l.z - sz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > l.radius) continue;
      const fall = lightWeight(d, l.radius);
      const id = 1 / Math.max(d, 1e-3);
      const ndl = (dx * _n.x + dy * _n.y + dz * _n.z) * id;
      // panels emit downward: cosine on the emitter side too
      const emit = Math.max(0.12, Math.min(1, (l.y - sy) * id * 1.2 + 0.15));
      const t = occl ? occl(sx, sz, l.x, l.z, sy) : 1;
      const w = fall * Math.max(0, ndl * 0.85 + 0.15) * emit * t;
      // bounce light: light hitting nearby floor lights everything softly (even ceilings)
      const b = fall * 0.5 * (0.35 + 0.65 * t);
      if ((w > 0.002 || b > 0.002) && nc < 64) { _ck[nc] = l.key; _cw[nc] = w * directMul + b * bounceMul; nc++; }
    }
    // top-4 selection (no allocation)
    let rest = 0;
    for (let k = 0; k < 4; k++) {
      let bi = -1, bw = -1;
      for (let c = 0; c < nc; c++) if (_cw[c] > bw) { bw = _cw[c]; bi = c; }
      if (bi < 0) { cells[i * 4 + k] = 0; weights[i * 4 + k] = 0; continue; }
      cells[i * 4 + k] = _ck[bi];
      weights[i * 4 + k] = bw;
      _cw[bi] = -2;
    }
    for (let c = 0; c < nc; c++) if (_cw[c] > 0) rest += _cw[c];
    aoArr[i] = ao ? ao(_p.x, _p.y, _p.z, _n.x, _n.y, _n.z) : 1;
    if (rest > 0) {
      // distribute the rest proportionally onto the top-4 to keep total energy similar
      const top = weights[i * 4] + weights[i * 4 + 1] + weights[i * 4 + 2] + weights[i * 4 + 3];
      if (top > 0) {
        const s = (top + rest * 0.6) / top;
        for (let k = 0; k < 4; k++) weights[i * 4 + k] *= s;
      }
    }
  }
  geo.setAttribute('aLightCells', new THREE.BufferAttribute(cells, 4));
  geo.setAttribute('aLightW', new THREE.BufferAttribute(weights, 4));
  geo.setAttribute('aAO', new THREE.BufferAttribute(aoArr, 1));
  return geo;
}

// ---------------------------------------------------------------------------
// Material patching
// ---------------------------------------------------------------------------
const bakedCache = new Map();

// GLSL shared by both paths ---------------------------------------------------
const FETCH = /* glsl */`
  vec3 bkLight(vec2 ij){ return texture2D(uLightTex, (mod(ij, ${FIELD_SIZE.toFixed(1)}) + 0.5) / ${FIELD_SIZE.toFixed(1)}).rgb * 2.0; }
  vec3 fetchLight(float cell){
    float s = ${FIELD_SIZE.toFixed(1)};
    vec2 uv = (vec2(mod(cell, s), floor(cell / s)) + 0.5) / s;
    return texture2D(uLightTex, uv).rgb * 2.0;
  }`;

const HASH = /* glsl */`
  float bkH(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float bkH1(float p){ return fract(sin(p * 91.3458) * 47453.5453); }
  float nzR(vec2 p){ return texture2D(uNoiseTex, p).r; }
  float nzG(vec2 p){ return texture2D(uNoiseTex, p).g; }
  float nzB(vec2 p){ return texture2D(uNoiseTex, p).b; }`;

// world-space grime / damage per surface kind -----------------------------------
// 1 carpet, 2 wallpaper, 3 drop-ceiling tiles, 4 concrete, 5 clean interior (lobby), 6 painted block
function grimeGLSL(kind, wet) {
  const W = wet ? 'vBkWet' : '0.0';
  switch (kind) {
    case 1: return /* glsl */`
      {
        vec2 wp = vWPos.xz;
        float big = nzR(wp * 0.031), mid = nzR(wp * 0.11 + 3.7), fine = nzG(wp * 0.23 + 1.3);
        float damp = smoothstep(0.56, 0.78, big * 0.6 + mid * 0.4) * uGrime;
        float st = nzR(wp * 0.13 + 7.1);
        float spillMask = smoothstep(0.62, 0.7, nzR(wp * 0.037 + 1.9));
        float spill = smoothstep(0.69, 0.73, st) * spillMask * uGrime;
        float ring = (1.0 - smoothstep(0.0, 0.006 + fwidth(st), abs(st - 0.69))) * spillMask * uGrime;
        float worn = smoothstep(0.6, 0.82, nzR(wp * 0.055 + 11.0)) * 0.7;
        float sd = fract(vWPos.x / 3.66 + 0.13); sd = min(sd, 1.0 - sd) * 3.66;
        float seam = 1.0 - smoothstep(0.003, 0.006 + fwidth(sd), sd);
        vec3 c = diffuseColor.rgb;
        float l = dot(c, vec3(0.3, 0.59, 0.11));
        c = mix(c, vec3(l) * vec3(1.04, 1.0, 0.92) * 1.08, worn * 0.16);
        c *= mix(1.0, 0.74, damp); c = mix(c, c * vec3(0.94, 0.88, 0.76), damp * 0.6);
        c = mix(c, c * vec3(0.7, 0.6, 0.45), spill * 0.45 + ring * 0.35);
        c *= 1.0 - seam * 0.22;
        bkDampness = damp * 0.6 + spill * 0.3;
        float wetv = ${W};
        float wetF = sat(wetv * (0.7 + mid * 0.6));
        bkPuddle = smoothstep(0.62, 0.72, wetv * (0.55 + fine * 0.9));
        c *= mix(1.0, 0.56, wetF);
        c = mix(c, c * vec3(0.82, 0.86, 0.84), bkPuddle * 0.5);
        bkWetness = max(wetF * 0.8, bkDampness * 0.25);
        diffuseColor.rgb = c;
      }`;
    case 2: return /* glsl */`
      {
        vec3 wn = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
        bool alongZ = abs(wn.x) > abs(wn.z);
        float u = alongZ ? vWPos.z : vWPos.x;
        float w = alongZ ? vWPos.x : vWPos.z;
        float y = vWPos.y;
        vec3 c = diffuseColor.rgb;
        float l = dot(c, vec3(0.3, 0.59, 0.11));
        // sun-faded / bleached patches
        float fade = smoothstep(0.62, 0.9, nzR(vec2(u * 0.05 + w * 0.31, y * 0.06 + w * 0.17))) * uGrime;
        c = mix(c, vec3(l) * vec3(1.06, 1.03, 0.92) * 1.05, fade * 0.1);
        // rising damp with a tide mark
        float dz = smoothstep(0.58, 0.78, nzR(vec2(u * 0.045 + w * 0.29, 5.3))) * uGrime;
        dz = max(dz, ${W} * 0.9);
        float hT = 0.1 + (0.12 + 0.3 * nzR(vec2(u * 0.11 + w * 0.73, 1.9 + w * 0.05))) * dz;
        float below = (1.0 - smoothstep(hT - 0.03, hT + 0.005, y)) * dz;
        float tide = (1.0 - smoothstep(0.0, 0.012 + fwidth(y), abs(y - hT))) * dz;
        c = mix(c, c * vec3(0.8, 0.72, 0.55), below * 0.55);
        c = mix(c, c * vec3(0.55, 0.45, 0.3), tide * 0.7);
        // grime band above the skirting + scuffs from chairs and carts
        c *= 1.0 - (1.0 - smoothstep(0.1, 0.45, y)) * 0.14 * uGrime;
        float scuff = smoothstep(0.72, 0.86, nzG(vec2(u * 1.7 + w, y * 3.0))) * (1.0 - smoothstep(0.85, 1.1, y)) * smoothstep(0.1, 0.25, y) * uGrime;
        c = mix(c, c * 0.72, scuff * 0.35);
        // leak streaks running down from the ceiling
        float su = u * 1.6 + w * 3.17; float sid = floor(su); float sf = fract(su);
        float hs = bkH(vec2(sid, floor(w * 0.33 + 0.5)));
        float leak = 0.0;
        if (hs > 0.8) {
          float cx = 0.25 + 0.5 * fract(hs * 7.3);
          float len = 0.5 + 2.1 * fract(hs * 3.1);
          float wid = 0.05 + 0.1 * fract(hs * 5.7);
          float wob = (nzG(vec2(su * 0.37, y * 0.5)) - 0.5) * 0.25;
          float dxl = abs(sf - cx + wob) / 1.6;
          float along = (uGrid.w - y) / len;
          leak = (1.0 - smoothstep(wid * 0.35, wid, dxl)) * (1.0 - smoothstep(0.55, 1.0, along)) * step(0.0, along);
          leak *= 0.55 + 0.45 * nzG(vec2(u * 5.0, y * 0.25));
          float edgeL = (1.0 - smoothstep(0.0, 0.02, abs(along - 0.95 + (nzG(vec2(u * 3.0, 0.5)) - 0.5) * 0.1))) * step(dxl, wid);
          c = mix(c, c * vec3(0.7, 0.6, 0.42), leak * 0.6 * uGrime);
          c = mix(c, c * vec3(0.52, 0.42, 0.28), edgeL * 0.5 * uGrime);
        }
        // peeling paper at some seams (strip width 0.53 m)
        float sIdx = floor(u / 0.53 + 0.5); float ds = u - sIdx * 0.53;
        float hp = bkH(vec2(sIdx, floor(w * 0.33 + 0.5) + 17.0));
        if (hp > 0.8) {
          bool topPeel = hp > 0.9;
          float yy = topPeel ? (uGrid.w - y) : (y - 0.1);
          float Lp = 0.12 + 0.3 * fract(hp * 13.7);
          float wpx = 0.04 * sat(1.0 - yy / Lp) + 0.002;
          float sgn = fract(hp * 3.3) > 0.5 ? 1.0 : -1.0;
          float sd = ds * sgn;
          float inside = step(0.0, yy) * step(yy, Lp);
          float flap = step(0.0, sd) * (1.0 - smoothstep(wpx * 0.75, wpx, sd)) * inside;
          float shadow = step(wpx, sd) * (1.0 - smoothstep(0.0, 0.014, sd - wpx)) * inside;
          c = mix(c, vec3(0.8, 0.76, 0.64) * (0.9 + l * 0.2), flap * 0.9);
          c *= 1.0 - shadow * 0.5;
          bkPeel = flap;
        }
        // mould specks low on damp walls
        float mould = smoothstep(0.82, 0.9, nzB(vec2(u * 9.0, y * 9.0))) * smoothstep(0.6, 0.0, y) * max(dz * 0.5, ${W});
        c = mix(c, vec3(0.08, 0.09, 0.05), mould * 0.6);
        bkWetness = max(below * 0.25, ${W} * (1.0 - smoothstep(0.0, 0.35, y)) * 0.7);
        diffuseColor.rgb = c;
      }`;
    case 3: return /* glsl */`
      {
        vec2 tId = floor(vWPos.xz / 0.6); vec2 tf = vWPos.xz / 0.6 - tId;
        float th = bkH(tId + 0.37);
        vec3 c = diffuseColor.rgb;
        c *= mix(vec3(1.0), vec3(1.0, 0.96, 0.86), nzR(vWPos.xz * 0.045) * 0.35);
        c *= 0.97 + 0.06 * fract(th * 13.1);
        float stainP = 0.06 + ${W} * 0.3;
        if (th < stainP) {
          vec2 cc = vec2(fract(th * 37.1), fract(th * 91.7)) * 0.6 + 0.2;
          float r = 0.12 + 0.32 * fract(th * 53.3);
          float dd = length(tf - cc) + (nzG(vWPos.xz * 0.9 + th) - 0.5) * 0.2;
          float fill = 1.0 - smoothstep(r - 0.06, r, dd);
          float edge = 1.0 - smoothstep(0.0, 0.02 + fwidth(dd), abs(dd - r));
          float edge2 = (1.0 - smoothstep(0.0, 0.015 + fwidth(dd), abs(dd - r * 0.62))) * step(0.5, fract(th * 7.7));
          c = mix(c, c * vec3(0.88, 0.78, 0.6), fill * 0.5 * uGrime);
          c = mix(c, c * vec3(0.62, 0.5, 0.32), max(edge, edge2 * 0.7) * 0.6 * uGrime);
        }
        diffuseColor.rgb = c;
      }`;
    case 4: return /* glsl */`
      {
        vec3 wn = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
        vec3 c = diffuseColor.rgb;
        if (wn.y > 0.5) {
          vec2 wp = vWPos.xz;
          float oil = smoothstep(0.66, 0.78, nzR(wp * 0.16 + 3.0)) * smoothstep(0.35, 0.65, nzG(wp * 0.5)) * uGrime;
          float damp = smoothstep(0.55, 0.8, nzR(wp * 0.05 + 9.0)) * uGrime;
          vec2 jd = abs(fract(wp / 3.0 + 0.5) - 0.5) * 3.0; float jn = min(jd.x, jd.y);
          float joint = 1.0 - smoothstep(0.004, 0.008 + fwidth(jn), jn);
          c = mix(c, c * 0.42, oil * 0.75);
          c *= mix(1.0, 0.8, damp);
          c *= 1.0 - joint * 0.55;
          bkWetness = max(oil * 0.55, damp * 0.35);
          float wetv = ${W};
          bkPuddle = smoothstep(0.6, 0.72, wetv * (0.55 + nzG(wp * 0.23) * 0.9));
          c *= mix(1.0, 0.62, sat(wetv));
          bkWetness = max(bkWetness, wetv * 0.8);
        } else {
          bool alongZ = abs(wn.x) > abs(wn.z);
          float u = alongZ ? vWPos.z : vWPos.x;
          float w = alongZ ? vWPos.x : vWPos.z;
          float y = vWPos.y;
          float dz = smoothstep(0.4, 0.7, nzR(vec2(u * 0.05 + w * 0.3, 2.2))) * uGrime;
          float rise = (1.0 - smoothstep(0.05, 0.45 + 0.5 * nzR(vec2(u * 0.13, w)), y)) * dz;
          float eff = smoothstep(0.62, 0.82, nzG(vec2(u * 1.9 + w, y * 2.4))) * (1.0 - smoothstep(0.1, 0.55, y)) * dz;
          float streak = smoothstep(0.7, 0.85, nzG(vec2(u * 2.3 + w * 1.7, y * 0.12))) * smoothstep(1.2, 2.9, y) * uGrime;
          c = mix(c, c * vec3(0.7, 0.68, 0.64), rise * 0.6);
          c = mix(c, vec3(0.82, 0.8, 0.76), eff * 0.4);
          c = mix(c, c * vec3(0.62, 0.5, 0.4), streak * 0.4);
          c *= 1.0 - (1.0 - smoothstep(0.0, 0.3, y)) * 0.15;
          bkWetness = rise * 0.4;
        }
        diffuseColor.rgb = c;
      }`;
    case 5: return /* glsl */`
      {
        vec3 wn = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
        vec3 c = diffuseColor.rgb;
        if (wn.y > 0.5) {
          float tr = smoothstep(0.55, 0.85, nzR(vWPos.xz * 0.08 + 2.0));
          c *= 1.0 - tr * 0.12 * uGrime;
        } else if (wn.y > -0.5) {
          float y = vWPos.y;
          c *= 1.0 - (1.0 - smoothstep(0.08, 0.4, y)) * 0.1 * uGrime;
          bool alongZ = abs(wn.x) > abs(wn.z);
          float u = alongZ ? vWPos.z : vWPos.x;
          float scuff = smoothstep(0.76, 0.88, nzG(vec2(u * 1.6, y * 3.0))) * (1.0 - smoothstep(0.8, 1.1, y)) * smoothstep(0.12, 0.25, y);
          c = mix(c, c * 0.8, scuff * 0.3 * uGrime);
        } else {
          c *= mix(vec3(1.0), vec3(1.0, 0.97, 0.9), nzR(vWPos.xz * 0.05) * 0.25);
        }
        diffuseColor.rgb = c;
      }`;
    default: return '';
  }
}

// analytic contact AO for floors (1) and ceilings (2): distance to the solid parts of the 4 cell edges
// (door / arch / half-wall openings respected) and to corner posts (pillars, walls arriving from outside)
function planeAOGLSL(mode) {
  return /* glsl */`
  float bkSeg(float u, float v, float a0, float a1){ return length(vec2(max(max(a0 - u, u - a1), 0.0), v)); }
  float bkEdgeD(float t, float u, float v){
    v = max(v - 0.08, 0.0);
    if (t < 0.5) return 9.0;
    ${mode === 2 ? `
    if (t > 5.5 && t < 6.5) return 9.0;
    if (t > 3.5 && t < 4.5) return bkSeg(u, v, -1.0, 1.5);
    if (t > 4.5 && t < 5.5) return bkSeg(u, v, 1.5, 4.0);
    return v;` : `
    if (t > 1.5 && t < 2.5) return min(bkSeg(u, v, -1.0, 0.95), bkSeg(u, v, 2.05, 4.0));
    if (t > 2.5 && t < 3.5) return min(bkSeg(u, v, -1.0, 0.5), bkSeg(u, v, 2.5, 4.0));
    if (t > 3.5 && t < 4.5) return bkSeg(u, v, -1.0, 1.5);
    if (t > 4.5 && t < 5.5) return bkSeg(u, v, 1.5, 4.0);
    return v;`}
  }
  float bkOcc(float d){ float a = 1.0 - smoothstep(0.0, ${mode === 2 ? '0.45' : '0.5'}, d); float b = 1.0 - smoothstep(0.0, 1.5, d); return 1.0 - (a * a * ${mode === 2 ? '0.34' : '0.42'} + b * 0.1); }
  float bkPost(vec2 lp, vec2 c, float s){ return s > 0.0 ? length(max(abs(lp - c) - s, 0.0)) : 9.0; }
  float bkPlaneAO(vec2 lp){
    float e = vEdge.x; float tN = mod(e, 8.0); float tE = mod(floor(e / 8.0), 8.0); float tS = mod(floor(e / 64.0), 8.0); float tW = floor(e / 512.0);
    float p = vEdge.y; float pNW = mod(p, 16.0) * 0.05; float pNE = mod(floor(p / 16.0), 16.0) * 0.05; float pSE = mod(floor(p / 256.0), 16.0) * 0.05; float pSW = floor(p / 4096.0) * 0.05;
    float ao = bkOcc(bkEdgeD(tN, lp.x, lp.y)) * bkOcc(bkEdgeD(tS, lp.x, 3.0 - lp.y)) * bkOcc(bkEdgeD(tW, lp.y, lp.x)) * bkOcc(bkEdgeD(tE, lp.y, 3.0 - lp.x));
    float dp = min(min(bkPost(lp, vec2(0.0, 0.0), pNW), bkPost(lp, vec2(3.0, 0.0), pNE)), min(bkPost(lp, vec2(3.0, 3.0), pSE), bkPost(lp, vec2(0.0, 3.0), pSW)));
    return ao * bkOcc(dp);
  }`;
}

// grimeKind: 0 none, 1 carpet, 2 wallpaper, 3 ceiling tiles, 4 concrete, 5 clean interior
// opts (all optional):
//   grid: 0 legacy | 1 Level-0 cell grid | 2 lobby room grid
//   wet: geometry carries aWet          emissiveLights: emissive follows the own fixture
//   ao: 'floor' | 'ceil' | 'wall'       (analytic contact AO; floors/ceilings need the aEdge attribute)
//   mix: [direct, bounce] multipliers   tiles: shuffle 0.6 m ceiling tiles (texture holds 4x4)
//   macro: wall waviness normal strength (world-space)   spec: specular multiplier
export function bakedMaterial(base, field, grimeKind = 0, opts = {}) {
  const grid = opts.grid || 0;
  const mix = opts.mix || [1, grid ? 1 : 0.22];
  const aoMode = opts.ao === 'floor' ? 1 : opts.ao === 'ceil' ? 2 : opts.ao === 'wall' ? 3 : 0;
  const flags = `${grimeKind}|${opts.emissiveLights ? 1 : 0}|${opts.wet ? 1 : 0}|g${grid}|a${aoMode}|t${opts.tiles ? 1 : 0}|m${opts.macro || 0}|s${opts.spec ?? 1}|l${opts.lens || 0}`;
  const key = `${base.uuid}|${flags}|${mix.join(',')}`;
  if (bakedCache.has(key)) return bakedCache.get(key);
  const m = base.clone();
  m.name = `${base.name}_baked`;
  m.userData.baked = true;
  const local = { uLightMix: { value: new THREE.Vector2(mix[0], mix[1]) }, uSpecMul: { value: opts.spec ?? 1 } };
  m.userData.bkUniforms = local;
  m.customProgramCacheKey = () => `baked_${flags}`;
  if (grid) m.onBeforeCompile = (shader) => patchGrid(shader, field, local, grimeKind, opts, grid, aoMode);
  else m.onBeforeCompile = (shader) => patchLegacy(shader, field, grimeKind, opts);
  bakedCache.set(key, m);
  return m;
}

// ---------------------------------------------------------------------------
function patchLegacy(shader, field, grimeKind, opts) {
  Object.assign(shader.uniforms, field.uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      attribute vec4 aLightCells;
      attribute vec4 aLightW;
      attribute float aAO;
      ${opts.wet ? 'attribute float aWet; varying float vBkWet;' : ''}
      uniform sampler2D uLightTex;
      uniform float uLightScale;
      uniform float uCollapse;
      uniform float uTime;
      varying vec3 vBaked;
      varying vec3 vWPos;
      varying float vAO;
      ${FETCH}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 bk = fetchLight(aLightCells.x) * aLightW.x + fetchLight(aLightCells.y) * aLightW.y
              + fetchLight(aLightCells.z) * aLightW.z + fetchLight(aLightCells.w) * aLightW.w;
      vBaked = bk * uLightScale;
      vAO = aAO;
      ${opts.wet ? 'vBkWet = aWet;' : ''}
      ${WOBBLE}`)
    .replace('#include <fog_vertex>', `vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <fog_vertex>`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec3 vBaked;
      varying vec3 vWPos;
      varying float vAO;
      ${opts.wet ? 'varying float vBkWet;' : ''}
      uniform vec3 uAmbient;
      uniform sampler2D uNoiseTex;
      uniform float uGrime;
      uniform float uTime;
      uniform float uCollapse;
      uniform vec4 uGrid;
      float sat(float x){ return clamp(x, 0.0, 1.0); }
      ${HASH}`)
    .replace('#include <map_fragment>', `#include <map_fragment>
      float bkWetness = 0.0, bkPuddle = 0.0, bkDampness = 0.0, bkPeel = 0.0;
      ${grimeGLSL(grimeKind, !!opts.wet)}`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.3, bkWetness);
      roughnessFactor = mix(roughnessFactor, 0.06, bkPuddle);`)
    .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
      irradiance += (vBaked * vAO + uAmbient) * PI;`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      ${opts.emissiveLights ? 'totalEmissiveRadiance *= clamp(vBaked * 1.1, 0.0, 2.0);' : ''}
      ${COLLAPSE_FS}`);
}

const WOBBLE = /* glsl */`
      if (uCollapse > 0.0) {
        vec4 wp0 = modelMatrix * vec4(transformed, 1.0);
        float wob = sin(wp0.x * 1.7 + uTime * 1.3) * sin(wp0.z * 1.3 - uTime * 0.9) * sin(wp0.y * 2.0 + uTime * 0.7);
        transformed += objectNormal * wob * 0.09 * uCollapse;
      }`;

const COLLAPSE_FS = /* glsl */`
      if (uCollapse > 0.0) {
        float rr = step(0.995 - uCollapse * 0.02, fract(sin(dot(floor(vWPos.xz*2.0 + floor(uTime*8.0)), vec2(12.9898,78.233)))*43758.5453));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.0), rr * uCollapse);
      }`;

// ---------------------------------------------------------------------------
// per-pixel grid lighting
function patchGrid(shader, field, local, grimeKind, opts, grid, aoMode) {
  Object.assign(shader.uniforms, field.uniforms, local);
  const wet = !!opts.wet;
  const planeAO = aoMode === 1 || aoMode === 2;
  const vsPars = `
      ${grid === 1 ? `
      attribute vec2 aCell;
      attribute vec4 aTa; attribute vec4 aTb;
      attribute vec4 aOa; attribute vec4 aOb; attribute vec4 aOc;
      flat varying vec2 vCell;
      varying vec4 vTa; varying vec4 vTb;
      uniform float uOutScale;` : `
      attribute float aRoom;
      attribute vec4 aLightCells; attribute vec4 aLightW;
      flat varying float vRoom;`}
      attribute float aAO;
      ${wet ? 'attribute float aWet; varying float vBkWet;' : ''}
      ${planeAO ? 'attribute vec2 aEdge; flat varying vec2 vEdge;' : ''}
      uniform sampler2D uLightTex;
      uniform float uLightScale;
      uniform float uCollapse;
      uniform float uTime;
      varying vec4 vOutAO;
      varying vec3 vWPos;
      ${FETCH}`;
  const vsMain = grid === 1 ? `
      vCell = aCell; vTa = aTa; vTb = aTb;
      vec3 bko = bkLight(aCell + vec2(-2.0, -1.0)) * aOa.x + bkLight(aCell + vec2(-2.0, 0.0)) * aOa.y + bkLight(aCell + vec2(-2.0, 1.0)) * aOa.z
               + bkLight(aCell + vec2(2.0, -1.0)) * aOa.w + bkLight(aCell + vec2(2.0, 0.0)) * aOb.x + bkLight(aCell + vec2(2.0, 1.0)) * aOb.y
               + bkLight(aCell + vec2(-1.0, -2.0)) * aOb.z + bkLight(aCell + vec2(0.0, -2.0)) * aOb.w + bkLight(aCell + vec2(1.0, -2.0)) * aOc.x
               + bkLight(aCell + vec2(-1.0, 2.0)) * aOc.y + bkLight(aCell + vec2(0.0, 2.0)) * aOc.z + bkLight(aCell + vec2(1.0, 2.0)) * aOc.w;
      vOutAO = vec4(bko * uLightScale * uOutScale, aAO);` : `
      vRoom = aRoom;
      vec3 bko = fetchLight(aLightCells.x) * aLightW.x + fetchLight(aLightCells.y) * aLightW.y
               + fetchLight(aLightCells.z) * aLightW.z + fetchLight(aLightCells.w) * aLightW.w;
      vOutAO = vec4(bko * uLightScale, aAO);`;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${vsPars}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      ${vsMain}
      ${wet ? 'vBkWet = aWet;' : ''}
      ${planeAO ? 'vEdge = aEdge;' : ''}
      ${WOBBLE}`)
    .replace('#include <fog_vertex>', `vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <fog_vertex>`);

  const fsPars = `
      ${grid === 1 ? 'flat varying vec2 vCell; varying vec4 vTa; varying vec4 vTb;' : `
      flat varying float vRoom;
      uniform vec4 uRoomA[8]; uniform vec4 uRoomB[8]; uniform vec2 uRoomKey;`}
      varying vec4 vOutAO;
      varying vec3 vWPos;
      ${wet ? 'varying float vBkWet;' : ''}
      ${planeAO ? 'flat varying vec2 vEdge;' : ''}
      uniform sampler2D uLightTex;
      uniform float uLightScale;
      uniform vec3 uAmbient;
      uniform sampler2D uNoiseTex;
      uniform float uGrime;
      uniform float uTime;
      uniform float uCollapse;
      uniform vec4 uGrid;
      uniform vec2 uLightMix;
      uniform float uSpecMul;
      float sat(float x){ return clamp(x, 0.0, 1.0); }
      ${FETCH}
      ${HASH}
      ${planeAO ? planeAOGLSL(aoMode) : ''}
      ${opts.tiles ? `
      vec2 bkTileUV; vec2 bkTileDx; vec2 bkTileDy; float bkTileRot = 0.0;
      void bkTileSetup(vec2 uvT){
        bkTileDx = dFdx(uvT); bkTileDy = dFdy(uvT);
        vec2 t = uvT * 4.0; vec2 id = floor(t); vec2 f = fract(t);
        float h = fract(sin(dot(id, vec2(127.1, 311.7))) * 43758.5453);
        float s = floor(h * 16.0);
        bkTileRot = step(0.5, fract(h * 7.13));
        if (bkTileRot > 0.5) f = 1.0 - f;
        bkTileUV = (vec2(mod(s, 4.0), floor(s / 4.0)) + f) * 0.25;
      }
      vec4 bkTex(sampler2D t){ return textureGrad(t, bkTileUV, bkTileDx, bkTileDy); }` : ''}`;

  // functions that need PhysicalMaterial / ReflectedLight go after the lighting pars
  const fsFuncs = `
      void bkDirect(const in vec3 lcol, const in vec3 L, const in vec3 N, const in vec3 V, const in PhysicalMaterial mat, float dist, inout ReflectedLight rl){
        float ndl = saturate(dot(N, L));
        if (ndl <= 0.0) return;
        vec3 irr = lcol * ndl;
        rl.directDiffuse += irr * BRDF_Lambert(mat.diffuseContribution);
        PhysicalMaterial m2 = mat;
        float a = pow2(mat.roughness);
        m2.roughness = sqrt(clamp(a + 0.16 / max(dist, 0.5), a, 1.0));
        rl.directSpecular += irr * BRDF_GGX(L, V, N, m2) * uSpecMul;
      }`;

  const lightLoop = grid === 1 ? `
      {
        float tr[9];
        tr[0] = vTa.x; tr[1] = vTa.y; tr[2] = vTa.z; tr[3] = vTa.w; tr[4] = 1.0; tr[5] = vTb.x; tr[6] = vTb.y; tr[7] = vTb.z; tr[8] = vTb.w;
        for (int k = 0; k < 9; k++) {
          vec2 ij = vCell + vec2(float(k - (k / 3) * 3) - 1.0, float(k / 3) - 1.0);
          vec3 c = bkLight(ij);
          if (c.r + c.g + c.b < 0.003) continue;
          float t = tr[k];
          vec3 lp = vec3((ij.x + 0.5) * uGrid.x, uGrid.y, (ij.y + 0.5) * uGrid.x);
          vec3 dl = lp - vWPos; float d = length(dl);
          float e = d / uGrid.z; e *= e;
          float fall = max(0.0, 1.0 - e * e) / (1.0 + 0.16 * d * d);
          float emit = clamp((lp.y - vWPos.y) / max(d, 1e-3) * 1.2 + 0.15, 0.12, 1.0);
          vec3 lc = c * (uLightScale * fall);
          bkBounce += lc * (0.5 * (0.35 + 0.65 * t));
          if (t > 0.003) bkDirect(lc * (t * emit * uLightMix.x * bkAOd * PI), normalize((viewMatrix * vec4(dl, 0.0)).xyz), normal, geometryViewDir, material, d, reflectedLight);
        }
      }` : `
      {
        int ri = int(vRoom + 0.5);
        vec4 RA = uRoomA[ri]; vec4 RB = uRoomB[ri];
        for (int a = 0; a < 8; a++) {
          if (float(a) >= RB.x) break;
          for (int b = 0; b < 8; b++) {
            if (float(b) >= RB.y) break;
            vec3 lp = vec3(RA.x + (float(a) + 0.5) * RA.z, RB.z, RA.y + (float(b) + 0.5) * RA.w);
            vec3 dl = lp - vWPos; float d = length(dl);
            if (d > uGrid.z) continue;
            vec3 c = bkLight(floor(lp.xz / uRoomKey.x) + uRoomKey.y);
            float e = d / uGrid.z; e *= e;
            float fall = max(0.0, 1.0 - e * e) / (1.0 + 0.16 * d * d);
            float emit = clamp((lp.y - vWPos.y) / max(d, 1e-3) * 1.2 + 0.15, 0.12, 1.0);
            vec3 lc = c * (uLightScale * fall);
            bkBounce += lc * 0.5;
            bkDirect(lc * (emit * uLightMix.x * bkAOd * PI), normalize((viewMatrix * vec4(dl, 0.0)).xyz), normal, geometryViewDir, material, d, reflectedLight);
          }
        }
      }`;

  let fs = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${fsPars}`)
    .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${fsFuncs}`)
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      ${opts.tiles ? `
      #ifdef USE_MAP
        bkTileSetup(vMapUv);
      #endif` : ''}
      float bkWetness = 0.0, bkPuddle = 0.0, bkDampness = 0.0, bkPeel = 0.0;`)
    .replace('#include <map_fragment>', `#include <map_fragment>
      ${grimeGLSL(grimeKind, wet)}`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.32, bkWetness);
      roughnessFactor = mix(roughnessFactor, 0.05, bkPuddle);
      roughnessFactor = mix(roughnessFactor, 0.9, bkPeel);`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      ${opts.macro ? `
      {
        // drywall / plaster waviness in grazing light: world-space low-frequency normal tilt
        vec3 wnM = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
        if (abs(wnM.y) < 0.5) {
          bool az = abs(wnM.x) > abs(wnM.z);
          vec2 q = vec2(az ? vWPos.z : vWPos.x, vWPos.y) * 0.21 + (az ? vWPos.x : vWPos.z) * 0.37;
          float h0 = nzR(q), hu = nzR(q + vec2(0.004, 0.0)), hv = nzR(q + vec2(0.0, 0.004));
          vec2 g = vec2(hu - h0, hv - h0) * ${(+opts.macro).toFixed(3)} * 40.0;
          vec3 tU = az ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
          vec3 dW = -(tU * g.x + vec3(0.0, 1.0, 0.0) * g.y);
          normal = normalize(normal + (viewMatrix * vec4(dW, 0.0)).xyz);
        }
      }` : ''}`)
    .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
      float bkAOg = vOutAO.a;
      ${planeAO ? `bkAOg *= bkPlaneAO(vWPos.xz - vec2(${grid === 1 ? 'vCell * uGrid.x' : 'floor(vWPos.xz / 3.0) * 3.0'}));` : ''}
      ${aoMode === 3 ? 'bkAOg *= (1.0 - 0.3 * pow2(1.0 - smoothstep(0.1, 0.55, vWPos.y))) * (1.0 - 0.28 * pow2(1.0 - smoothstep(0.0, 0.5, uGrid.w - vWPos.y)));' : ''}
      float bkAOt = 1.0;
      #ifdef USE_AOMAP
        bkAOt = (${opts.tiles ? 'bkTex( aoMap )' : 'texture2D( aoMap, vAoMapUv )'}.r - 1.0) * aoMapIntensity + 1.0;
      #endif
      float bkAOd = mix(1.0, bkAOg, ${aoMode === 1 ? '0.75' : aoMode === 2 ? '0.6' : '0.45'}) * mix(1.0, bkAOt, 0.6);
      vec3 bkBounce = vec3(0.0);
      ${lightLoop}
      irradiance += ((bkBounce * uLightMix.y + vOutAO.rgb) * bkAOg + uAmbient) * PI;`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      ${opts.emissiveLights ? (grid === 1 ? `
      {
        vec3 own = bkLight(vCell);
        totalEmissiveRadiance *= clamp(own * 0.8, 0.0, 2.2);
        ${opts.lens ? `
        #ifdef USE_MAP
          // two lamps behind the prismatic lens: brighter bands along the long axis, dimmer towards the frame
          vec2 lu = vMapUv * 0.25;
          float band = exp(-pow((lu.y - 0.3) * 7.0, 2.0)) + exp(-pow((lu.y - 0.7) * 7.0, 2.0));
          float edgeF = smoothstep(0.0, 0.1, min(lu.x, 1.0 - lu.x)) * smoothstep(0.0, 0.16, min(lu.y, 1.0 - lu.y));
          totalEmissiveRadiance *= (0.62 + band * 0.42) * (0.75 + 0.25 * edgeF);
          ${opts.lens === 'louvre' ? `
          // parabolic louvre: 8 x 3 cells with dark aluminium blades between bright wells
          vec2 gq = fract(vec2(lu.x * 8.0, lu.y * 3.0));
          float well = smoothstep(0.0, 0.09, min(gq.x, 1.0 - gq.x)) * smoothstep(0.0, 0.13, min(gq.y, 1.0 - gq.y));
          float cup = 1.0 - pow(length((gq - 0.5) * vec2(1.0, 1.4)), 2.0) * 1.2;
          totalEmissiveRadiance *= mix(0.12, 1.15, well) * mix(0.7, 1.0, clamp(cup, 0.0, 1.0));
          diffuseColor.rgb *= mix(0.45, 1.0, well);` : ''}
        #endif` : ''}
      }` : `
      {
        int ri = int(vRoom + 0.5);
        vec3 own = bkLight(floor(vWPos.xz / uRoomKey.x) + uRoomKey.y);
        totalEmissiveRadiance *= clamp(own * 0.8, 0.0, 2.2);
      }`) : ''}
      ${COLLAPSE_FS}`);
  if (opts.tiles) {
    fs = fs.replace(/texture2D\(\s*map\s*,\s*vMapUv\s*\)/g, 'bkTex( map )')
      .replace(/texture2D\(\s*roughnessMap\s*,\s*vRoughnessMapUv\s*\)/g, 'bkTex( roughnessMap )')
      .replace(/texture2D\(\s*metalnessMap\s*,\s*vMetalnessMapUv\s*\)/g, 'bkTex( metalnessMap )')
      .replace(/texture2D\(\s*aoMap\s*,\s*vAoMapUv\s*\)/g, 'bkTex( aoMap )')
      .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', 'vec3 mapN = bkTex( normalMap ).xyz * 2.0 - 1.0; if (bkTileRot > 0.5) mapN.xy = -mapN.xy;');
  }
  shader.fragmentShader = fs;
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
