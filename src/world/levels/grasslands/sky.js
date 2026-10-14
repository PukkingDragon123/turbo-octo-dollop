// Grasslands sky & atmosphere: a time-of-day model that drifts from a warm afternoon (day 1) through golden
// hour and a long eerie dusk to a sick red twilight (day 7); an analytic sky dome with sun disk, halo and
// drifting clouds; the sun DirectionalLight (stabilised camera-following shadow box); sky image-based
// lighting (PMREM of the dome); and a post pass that adds exponential height fog with sun in-scattering
// (aerial perspective) and screen-space god rays from the depth buffer.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { engine } from '../../../core/engine.js';
import { noiseTexture } from './textures.js';
import { Noise2 } from './noise.js';

const C = (hex) => new THREE.Color(hex);
const lerp = (a, b, t) => a + (b - a) * t;
const sst = (t) => t * t * (3 - 2 * t);

// keyframes along the dimension's lifetime (t = day-1 + progress, 0..7)
const KEYS = [
  { t: 0.0, elev: 31, sun: C(0xfff0d8), sunI: 6.2, zen: C(0x3f6fae), hor: C(0xbcd0dc), halo: C(0xffe6c0), fog: C(0xb7c4c6), fogD: 0.0035, cloud: 0.42, sat: 1.04, expo: 0.8, sick: 0 },
  { t: 1.6, elev: 23, sun: C(0xffe2b8), sunI: 5.8, zen: C(0x3d68a4), hor: C(0xcdd2cc), halo: C(0xffd8a0), fog: C(0xc2c4bc), fogD: 0.0042, cloud: 0.48, sat: 1.02, expo: 0.8, sick: 0 },
  { t: 3.0, elev: 12, sun: C(0xffc98a), sunI: 5.1, zen: C(0x46649a), hor: C(0xe7c8a0), halo: C(0xffb870), fog: C(0xcdb79a), fogD: 0.0055, cloud: 0.52, sat: 1.0, expo: 0.84, sick: 0 },
  { t: 4.2, elev: 4.5, sun: C(0xff9a50), sunI: 3.9, zen: C(0x404f80), hor: C(0xe39a68), halo: C(0xff8a40), fog: C(0xb58c74), fogD: 0.0075, cloud: 0.55, sat: 0.94, expo: 0.94, sick: 0.05 },
  { t: 5.0, elev: 0.5, sun: C(0xff6a30), sunI: 1.9, zen: C(0x2d3762), hor: C(0xa56a5e), halo: C(0xe85a30), fog: C(0x6e5a62), fogD: 0.01, cloud: 0.6, sat: 0.85, expo: 1.1, sick: 0.12 },
  { t: 5.7, elev: -3.5, sun: C(0xd04a30), sunI: 0.25, zen: C(0x1a2040), hor: C(0x5a4458), halo: C(0x9a3a3a), fog: C(0x3a3546), fogD: 0.013, cloud: 0.62, sat: 0.72, expo: 1.3, sick: 0.25 },
  { t: 6.0, elev: -2.5, sun: C(0xc02818), sunI: 0.5, zen: C(0x2a0c10), hor: C(0x8a2418), halo: C(0xd02a10), fog: C(0x5a1e18), fogD: 0.017, cloud: 0.7, sat: 0.8, expo: 1.25, sick: 1 },
  { t: 7.0, elev: -4.0, sun: C(0xa01808), sunI: 0.3, zen: C(0x1a0406), hor: C(0x6a1208), halo: C(0xb01808), fog: C(0x3e0e0a), fogD: 0.024, cloud: 0.78, sat: 0.7, expo: 1.3, sick: 1 },
];

export function todState(t, out = {}) {
  let a = KEYS[0], b = KEYS[KEYS.length - 1];
  for (let i = 0; i < KEYS.length - 1; i++) if (t >= KEYS[i].t && t <= KEYS[i + 1].t) { a = KEYS[i]; b = KEYS[i + 1]; break; }
  const k = b.t > a.t ? sst(Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)))) : 0;
  for (const key of Object.keys(a)) {
    if (key === 't') continue;
    const va = a[key], vb = b[key];
    if (va.isColor) (out[key] = out[key] || new THREE.Color()).copy(va).lerp(vb, k);
    else out[key] = lerp(va, vb, k);
  }
  out.t = t;
  return out;
}

// ---------------------------------------------------------------------------
export const SKY_GLSL = /* glsl */`
  uniform vec3 uSunDir, uZenith, uHorizon, uHalo, uSunCol, uGround;
  uniform float uSunDisk, uCloud, uTime, uSick, uNoSun;
  uniform sampler2D tNoise;
  vec3 skyColor(vec3 d) {
    float h = d.y;
    float hh = max(h, 0.0);
    vec3 col = mix(uHorizon, uZenith, pow(hh, 0.5));
    // bright band just above the horizon
    col += uHorizon * 0.25 * exp(-hh * 18.0);
    col = mix(col, uGround, smoothstep(0.0, -0.22, h));
    float sd = max(dot(d, uSunDir), 0.0);
    float glow = pow(sd, 5.0) * 0.55 + pow(sd, 32.0) * 0.9 + pow(sd, 400.0) * 3.0;
    col += uHalo * glow * (1.0 - 0.45 * smoothstep(0.0, 0.7, h)) * (1.0 - uNoSun);
    // clouds on a curved layer
    if (h > -0.02) {
      vec2 cuv = d.xz / (hh + 0.09) * 0.21;
      vec2 drift = vec2(uTime * 0.0035, uTime * 0.0012);
      float c = texture2D(tNoise, cuv * 0.6 + drift).r * 0.55 + texture2D(tNoise, cuv * 1.7 + drift * 1.6).g * 0.3 + texture2D(tNoise, cuv * 4.3 + drift * 2.3).b * 0.15;
      float cov = smoothstep(1.0 - uCloud, 1.0 - uCloud + 0.3, c);
      cov *= smoothstep(-0.02, 0.1, h);
      float thick = smoothstep(0.45, 0.85, c);
      vec3 lit = mix(uHorizon * 1.05, vec3(1.0, 0.98, 0.94) * (0.6 + 0.4 * length(uSunCol) / 1.7), 0.45);
      vec3 dark = mix(uZenith * 0.75, uHorizon * 0.55, 0.5);
      vec3 cc = mix(lit, dark, thick * 0.75);
      cc += uSunCol * (pow(sd, 6.0) * 1.6 + pow(sd, 40.0) * 2.0) * (1.0 - thick * 0.7) * (1.0 - uNoSun);
      cc = mix(cc, vec3(0.35, 0.05, 0.04) * (0.6 + c), uSick * 0.6);
      col = mix(col, cc, cov * 0.92);
    }
    float disk = smoothstep(uSunDisk, uSunDisk + 0.00002, dot(d, uSunDir));
    col += uSunCol * disk * 40.0 * (1.0 - uNoSun);
    return col;
  }`;

function skyMaterial(uniforms, noSun = 0) {
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uNoSun: { value: noSun } },
    vertexShader: /* glsl */`varying vec3 vDir; void main(){ vDir = (modelMatrix * vec4(position, 0.0)).xyz; vec4 p = projectionMatrix * viewMatrix * vec4((modelMatrix * vec4(position, 1.0)).xyz, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: SKY_GLSL + /* glsl */`varying vec3 vDir; void main(){ gl_FragColor = vec4(skyColor(normalize(vDir)), 1.0); }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
}

// ---------------------------------------------------------------------------
// Post pass: height fog + sun in-scatter + god rays (needs the scene depth texture)
const AtmoShader = {
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null },
    uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunUV: { value: new THREE.Vector2(0.5, 0.5) },
    uFogCol: { value: new THREE.Color() }, uSunFog: { value: new THREE.Color() },
    uFogD: { value: 0.006 }, uFogH: { value: 0.022 }, uFogBase: { value: 0.0 },
    uRays: { value: 0.5 }, uRayCol: { value: new THREE.Color() }, uSunVis: { value: 1 },
    uSamples: { value: 28 }, uTime: { value: 0 },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, tDepth;
    uniform mat4 uInvProj, uCamWorld;
    uniform vec3 uCamPos, uSunDir, uFogCol, uSunFog, uRayCol;
    uniform vec2 uSunUV;
    uniform float uFogD, uFogH, uFogBase, uRays, uSunVis, uTime;
    uniform int uSamples;
    varying vec2 vUv;
    vec3 viewRay(vec2 uv, float z) {
      vec4 ndc = vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
      vec4 vp = uInvProj * ndc; return vp.xyz / vp.w;
    }
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      float z = texture2D(tDepth, vUv).r;
      bool sky = z >= 0.99999;
      vec3 vp = viewRay(vUv, sky ? 0.9999 : z);
      vec3 wdir = normalize((uCamWorld * vec4(vp, 0.0)).xyz);
      float dist = sky ? 2600.0 : length(vp);
      // exponential height fog, integrated analytically along the ray
      float y0 = uCamPos.y - uFogBase;
      float dy = wdir.y * dist;
      float b = uFogH;
      float fy = abs(b * dy) > 1e-4 ? (1.0 - exp(-b * dy)) / (b * dy) : 1.0;
      float optical = uFogD * dist * exp(-b * max(y0, -10.0)) * fy;
      float T = exp(-optical);
      float sd = max(dot(wdir, uSunDir), 0.0);
      vec3 fogc = mix(uFogCol, uSunFog, pow(sd, 10.0) * 0.42 + pow(sd, 64.0) * 0.35);
      float skyK = sky ? smoothstep(0.32, 0.0, wdir.y) * 0.85 : 1.0;
      col = mix(col, fogc, (1.0 - T) * skyK);
      // god rays: march toward the sun, accumulating unoccluded sky near the sun
      if (uRays > 0.001 && uSunVis > 0.001) {
        vec2 delta = (uSunUV - vUv);
        float len = length(delta);
        delta /= float(uSamples);
        float jit = hash(vUv * 917.0 + fract(uTime));
        vec2 p = vUv + delta * jit;
        float acc = 0.0, w = 1.0;
        for (int i = 0; i < 48; i++) {
          if (i >= uSamples) break;
          float zz = texture2D(tDepth, p).r;
          acc += step(0.99999, zz) * w;
          w *= 0.965;
          p += delta;
        }
        acc /= float(uSamples) * 0.6;
        float fall = pow(sd, 5.0) * 0.55 + pow(sd, 28.0) * 0.6;
        float edge = smoothstep(1.6, 0.4, len);
        col += uRayCol * acc * fall * edge * uRays * uSunVis;
      }
      gl_FragColor = vec4(col, 1.0);
    }`,
};

class AtmospherePass extends Pass {
  constructor() {
    super();
    this.material = new THREE.ShaderMaterial({ ...AtmoShader, uniforms: THREE.UniformsUtils.clone(AtmoShader.uniforms), depthTest: false, depthWrite: false });
    this.uniforms = this.material.uniforms;
    this.fsQuad = new FullScreenQuad(this.material);
    this.needsSwap = true;
  }
  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }
  dispose() { this.material.dispose(); this.fsQuad.dispose(); }
}

// ---------------------------------------------------------------------------
// Distant ranges: a ring around the camera (it travels with you — the mountains never get closer).
function mountainRing(seed) {
  const N = new Noise2(seed ^ 0x5eed);
  const SEG = 320, RINGS = 16, R0 = 640, R1 = 2100;
  const pos = [], col = [], idx = [];
  const forest = new THREE.Color(0x1d2a17), forest2 = new THREE.Color(0x26331c), rock = new THREE.Color(0x77736c), rock2 = new THREE.Color(0x9a958c), scree = new THREE.Color(0x5e5a52);
  const c = new THREE.Color();
  const ridged = (x, y) => { const v = 1 - Math.abs(N.n(x, y)); return v * v; };
  const peakR = (th) => 1050 + 260 * N.n(Math.cos(th) * 1.3 + 9, Math.sin(th) * 1.3);
  const Hmax = (th) => {
    const cx = Math.cos(th), sx = Math.sin(th);
    return 140 + 300 * (0.5 * ridged(cx * 1.7, sx * 1.7) + 0.32 * ridged(cx * 4.3 + 3, sx * 4.3) + 0.18 * ridged(cx * 11 + 7, sx * 11));
  };
  for (let r = 0; r <= RINGS; r++) {
    const u = r / RINGS;
    const R = R0 + (R1 - R0) * Math.pow(u, 1.25);
    for (let sgm = 0; sgm <= SEG; sgm++) {
      const th = (sgm / SEG) * Math.PI * 2;
      const pr = peakR(th);
      const rise = THREE.MathUtils.smoothstep(R, R0, pr) ;
      const fall = 1 - 0.35 * THREE.MathUtils.smoothstep(R, pr, R1);
      const spur = 0.75 + 0.25 * N.n(Math.cos(th) * 7 + R * 0.004, Math.sin(th) * 7 - R * 0.003);
      let h = Hmax(th) * rise * fall * spur - 12 + 18 * u;
      if (r === 0) h = -40;
      pos.push(Math.sin(th) * R, h, Math.cos(th) * R);
      // forest below the tree line, granite and scree above
      const tl = 150 + 40 * N.n(th * 3, R * 0.002);
      const n = N.n(Math.cos(th) * 23 + R * 0.01, Math.sin(th) * 23);
      if (h < tl) c.copy(forest).lerp(forest2, 0.5 + 0.5 * n);
      else c.copy(rock).lerp(rock2, 0.5 + 0.5 * n).lerp(scree, THREE.MathUtils.smoothstep(h, tl, tl + 40) < 1 ? 0.4 : 0);
      col.push(c.r, c.g, c.b);
    }
  }
  const W = SEG + 1;
  for (let r = 0; r < RINGS; r++) for (let sgm = 0; sgm < SEG; sgm++) {
    const a = r * W + sgm, b = a + 1, cc = a + W, d = cc + 1;
    idx.push(a, cc, b, b, cc, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  m.name = 'gl_mountains';
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.name = 'mountains';
  mesh.renderOrder = -500;
  return mesh;
}

// ---------------------------------------------------------------------------
export class GrassSky {
  constructor(level) {
    this.level = level;
    this.state = todState(0);
    this.time = 0;
    this.sunAz = 0;
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uHalo: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() }, uGround: { value: new THREE.Color(0x2a2e22) },
      uSunDisk: { value: Math.cos(0.0105) }, uCloud: { value: 0.45 }, uTime: { value: 0 }, uSick: { value: 0 },
      tNoise: { value: noiseTexture() },
    };
    this.skyGlsl = SKY_GLSL;
    this.group = new THREE.Group();
    this.group.name = 'sky';
    const dome = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), skyMaterial(this.uniforms, 0));
    dome.frustumCulled = false;
    dome.renderOrder = -1000;
    this.dome = dome;
    this.group.add(dome);
    this.mountains = mountainRing(level.seed || 1);
    this.group.add(this.mountains);
    // sun
    const q = engine.quality;
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = !!q.shadows;
    const sz = q.shadowSize >= 2048 ? 2048 : q.shadowSize || 1024;
    this.sun.shadow.mapSize.set(sz, sz);
    this.shadowHalf = engine.qualityName === 'high' ? 46 : 38;
    const cam = this.sun.shadow.camera;
    cam.left = -this.shadowHalf; cam.right = this.shadowHalf; cam.top = this.shadowHalf; cam.bottom = -this.shadowHalf;
    cam.near = 1; cam.far = 420;
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.045;
    this.sun.shadow.radius = 2.2;
    this.sun.target = new THREE.Object3D();
    this.group.add(this.sun, this.sun.target);
    // sky IBL scene (dome without the sun disk; below the horizon the light bounced off the sunlit valley
    // floor: warm golden-green meadow and dark conifers, not the blue haze)
    this.envScene = new THREE.Scene();
    this.envGround = { value: new THREE.Color(0x2a2e22) };
    const envDome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial({ ...this.uniforms, uGround: this.envGround }, 1));
    this.envScene.add(envDome);
    this.envRT = null;
    this.envT = 0;
    this.envKey = null;
    // post pass
    this.pass = new AtmospherePass();
    this._installed = null;
    this.fogBase = 0;
    this._v = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._c = new THREE.Color();
  }

  setSunAzimuth(a) { this.sunAz = a; }

  // ----- composer integration (depth textures on the composer targets) -----
  install() {
    const post = engine.post;
    if (this._installed === post) return;
    this.uninstall();
    const comp = post.composer;
    for (const rt of [comp.renderTarget1, comp.renderTarget2]) {
      if (!rt.depthTexture) {
        const dt = new THREE.DepthTexture(rt.width, rt.height);
        dt.type = THREE.UnsignedIntType;
        rt.depthTexture = dt;
        rt.dispose();
        rt._grassDepth = true;
      }
    }
    // right after the scene render, before the first-person viewmodel. Screen-space AO is switched off
    // outdoors (it would swap away the depth buffer and cannot see the GPU-placed grass and impostors).
    if (post.gtao) { this._gtaoWas = post.gtao.enabled; post.gtao.enabled = false; }
    const idx = comp.passes.indexOf(post.renderPass) + 1;
    comp.insertPass(this.pass, idx);
    this._installed = post;
  }

  uninstall() {
    const post = this._installed;
    if (!post) return;
    const comp = post.composer;
    const i = comp.passes.indexOf(this.pass);
    if (i >= 0) comp.passes.splice(i, 1);
    if (post.gtao && this._gtaoWas !== undefined) post.gtao.enabled = this._gtaoWas;
    for (const rt of [comp.renderTarget1, comp.renderTarget2]) {
      if (rt._grassDepth) {
        rt.depthTexture?.dispose();
        rt.depthTexture = null;
        rt.dispose();
        rt._grassDepth = false;
      }
    }
    this._installed = null;
  }

  // ----- per-frame -----
  // t: continuous day time (0..7); focus: camera position
  update(dt, t, focus) {
    this.time += dt;
    const S = todState(t, this.state);
    const U = this.uniforms;
    const elev = THREE.MathUtils.degToRad(S.elev);
    const az = this.sunAz + THREE.MathUtils.degToRad(t * 2.2);
    const dir = U.uSunDir.value.set(Math.cos(elev) * Math.sin(az), Math.sin(elev), Math.cos(elev) * Math.cos(az)).normalize();
    U.uZenith.value.copy(S.zen);
    U.uHorizon.value.copy(S.hor);
    U.uHalo.value.copy(S.halo).multiplyScalar(1.0);
    U.uSunCol.value.copy(S.sun).multiplyScalar(Math.max(0.15, S.sunI / 6));
    U.uGround.value.copy(S.fog).multiplyScalar(0.35);
    {
      // valley-floor bounce: albedo x (sun + sky irradiance) / pi
      const sunE = S.sunI * Math.max(0, Math.sin(elev)) * THREE.MathUtils.smoothstep(S.elev, -2.5, 3.5);
      const g = this.envGround.value;
      g.copy(S.sun).multiplyScalar(sunE).add(this._c.copy(S.zen).lerp(S.hor, 0.5).multiplyScalar(2.2));
      g.multiply(this._c.setRGB(0.15, 0.145, 0.07)).multiplyScalar(1 / Math.PI);
      g.lerp(this._c.copy(S.fog).multiplyScalar(0.3), 0.25 + 0.5 * S.sick);
    }
    U.uCloud.value = S.cloud;
    U.uTime.value = this.time;
    U.uSick.value = S.sick;
    this.dome.position.copy(engine.camera.position);
    this.dome.scale.setScalar(engine.camera.far * 0.9);
    this.mountains.position.set(engine.camera.position.x, this.fogBase - 2, engine.camera.position.z);
    // sun light: intensity fades as the sun sets; shadows follow the camera (stabilised to texels)
    const above = THREE.MathUtils.smoothstep(S.elev, -2.5, 3.5);
    this.sun.color.copy(S.sun);
    this.sun.intensity = S.sunI * above;
    this.sun.castShadow = !!engine.quality.shadows && this.sun.intensity > 0.05;
    const fwd = this._v.set(0, 0, -1).applyQuaternion(engine.camera.quaternion).setY(0);
    if (fwd.lengthSq() > 1e-4) fwd.normalize();
    const cx = focus.x + fwd.x * this.shadowHalf * 0.45, cz = focus.z + fwd.z * this.shadowHalf * 0.45;
    // snap the shadow box to whole texels in light space
    const texel = (this.shadowHalf * 2) / this.sun.shadow.mapSize.x;
    const lightRot = this._m.lookAt(new THREE.Vector3(0, 0, 0), dir.clone().negate(), new THREE.Vector3(0, 1, 0));
    const inv = lightRot.clone().invert();
    const p = new THREE.Vector3(cx, focus.y, cz).applyMatrix4(inv);
    p.x = Math.round(p.x / texel) * texel;
    p.y = Math.round(p.y / texel) * texel;
    p.applyMatrix4(lightRot);
    this.sun.target.position.copy(p);
    this.sun.position.copy(p).addScaledVector(dir, 200);
    this.sun.target.updateMatrixWorld();
    // environment (sky IBL) refresh when the sky has changed enough
    this.envT -= dt;
    const key = `${Math.round(S.elev * 2)}|${Math.round(t * 20)}`;
    if (!this.envRT || (this.envT <= 0 && key !== this.envKey)) {
      this.envT = 4;
      this.envKey = key;
      this._refreshEnv();
    }
    engine.scene.environmentIntensity = 0.9 + 0.25 * (1 - above);
    // atmosphere pass
    this.install();
    const A = this.pass.uniforms;
    const cam = engine.camera;
    cam.updateMatrixWorld();
    A.uInvProj.value.copy(cam.projectionMatrixInverse);
    A.uCamWorld.value.copy(cam.matrixWorld);
    A.uCamPos.value.copy(cam.position);
    A.uSunDir.value.copy(dir);
    A.uFogCol.value.copy(S.fog);
    A.uSunFog.value.copy(S.halo).lerp(S.sun, 0.35).multiplyScalar(0.55 + 0.45 * above);
    A.uFogD.value = S.fogD * (this.fogMul ?? 1);
    A.uFogH.value = 0.018;
    A.uFogBase.value = this.fogBase;
    A.uTime.value = this.time;
    // sun on screen for the rays
    const sp = this._v.copy(cam.position).addScaledVector(dir, 1000).project(cam);
    A.uSunUV.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
    const facing = dir.dot(new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion));
    A.uSunVis.value = THREE.MathUtils.smoothstep(facing, 0.0, 0.35) * THREE.MathUtils.smoothstep(S.elev, -4, 2);
    A.uRayCol.value.copy(S.halo).lerp(S.sun, 0.5).multiplyScalar(0.24);
    A.uRays.value = this.raysOn === false ? 0 : 1;
    A.uSamples.value = engine.qualityName === 'low' ? 16 : engine.qualityName === 'high' ? 40 : 28;
    // post grade
    const P = engine.post.params;
    P.uSat.value = S.sat;
    engine.renderer.toneMappingExposure = S.expo;
    return S;
  }

  _refreshEnv() {
    const pm = engine.pmrem;
    const old = this.envRT;
    this.envRT = pm.fromScene(this.envScene, 0.02, 0.1, 100);
    engine.scene.environment = this.envRT.texture;
    if (old) old.dispose();
  }

  dispose() {
    this.uninstall();
    this.pass.dispose();
    this.group.removeFromParent();
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.mountains.geometry.dispose();
    this.mountains.material.dispose();
    this.envRT?.dispose();
    engine.scene.environment = engine.defaultEnv;
    engine.renderer.toneMappingExposure = 1;
  }
}
