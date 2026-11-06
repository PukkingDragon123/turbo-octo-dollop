// Post-processing: the "hand-painted miniature" look (docs/ART_DIRECTION.md).
//
//   scene pass  -> own render target (HDR colour + depth texture, outside the composer's ping-pong buffers, so any
//                  later pass can read the scene depth without a framebuffer feedback loop: post.sceneDepth)
//   paint pass  -> painterly edge-preserving smoothing (generalised 4-sector Kuwahara over a 5x5 / 3x3 tap grid),
//                  depth haze (warm where lit, cooler and bluer with distance) and a subtle far depth-of-field
//   [GTAO]      -> HIGH only
//   viewmodel   -> hands / held items / watch on top (not painted, no haze)
//   bloom       -> gentle glow on light sources (MEDIUM / HIGH)
//   final pass  -> ACES tone map, display grade (lift / gamma / gain, roll-off, saturation, contrast), warm split
//                  tone, soft shadow floor (never pure black), soft vignette, faint canvas / paper grain and the game
//                  feel hooks (damage, low sanity, fatigue blur, reality shudder, flash, fades)
//   [FXAA]      -> MEDIUM / HIGH
// Every game-feel / grade parameter lives in `post.params` (uniform objects shared by the passes).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

const VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// shared GLSL helpers
const COMMON = /* glsl */`
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
  float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
`;

// ---------------------------------------------------------------------------------------------------------------
// Paint pass. Taps sit on a grid with a spacing of ~1.5-2 px (bilinear taps between texels add their own small
// average); four overlapping 3x3 (LITE: 2x2) sectors give means and luminance variances; sectors are weighted by
// 1 / (1 + k var)^4, so flat sectors win at edges (edges stay crisp) and fine texture noise melts into soft painted
// patches. Far away the grid widens and blends toward the plain mean: a soft miniature-style depth of field.
// ---------------------------------------------------------------------------------------------------------------
function paintShader(lite, dof) {
  const N = lite ? 1 : 2; // grid half size: taps -N..N
  return /* glsl */`
  #define GN ${N}
  ${dof ? '#define USE_DOF' : ''}
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform vec2 uRes;
  uniform float uNear, uFar, uOrtho, uHasDepth;
  uniform float uTime;
  uniform float uPaint, uPaintScale;
  uniform float uHaze, uHazeStart, uHazeFarDist, uHazeLum, uHazeGlow, uHazeSky;
  uniform vec3 uHazeNear, uHazeFar;
  uniform float uDof, uDofStart, uDofEnd;
  uniform float uBlur, uSanity, uGlitch;
  varying vec2 vUv;
  ${COMMON}
  float viewDist(float d){
    if (uOrtho > 0.5) return uNear + d * (uFar - uNear);
    // perspective depth -> view-space distance along the axis
    float z = d * 2.0 - 1.0;
    return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
  }
  void main(){
    vec2 uv = vUv;
    float t = uTime;
    float insanity = 1.0 - uSanity;
    // low sanity: a slow, gentle breathing of the picture (no tearing, no glitch)
    float wob = insanity * insanity * 0.0045 + uGlitch * 0.006;
    if (wob > 0.0) uv += wob * vec2(sin(uv.y * 6.0 + t * 0.9), cos(uv.x * 5.0 + t * 0.7));
    float depth = uHasDepth > 0.5 ? texture2D(tDepth, uv).x : 0.5;
    float dist = uHasDepth > 0.5 ? viewDist(depth) : 8.0;
    bool sky = depth >= 0.99999;
    float coc = 0.0;
    #ifdef USE_DOF
      coc = uDof * smoothstep(uDofStart, uDofEnd, dist);
    #endif
    vec2 px = 1.0 / uRes;
    // brush size follows the resolution (same painted scale at 720p and 4K), widens with fatigue / far focus
    float sp = uPaintScale * max(1.0, uRes.y / 1080.0) * (1.0 + coc * 1.6 + uBlur * 2.5 + uGlitch * 1.5);
    vec3 m0 = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0), m3 = vec3(0.0);
    vec2 v0 = vec2(0.0), v1 = vec2(0.0), v2 = vec2(0.0), v3 = vec2(0.0);
    vec3 avg = vec3(0.0);
    vec3 centre = texture2D(tDiffuse, uv).rgb;
    for (int j = -GN; j <= GN; j++) {
      for (int i = -GN; i <= GN; i++) {
        vec3 c = (i == 0 && j == 0) ? centre : texture2D(tDiffuse, uv + vec2(float(i), float(j)) * px * sp).rgb;
        float l = dot(c / (1.0 + c), LUMA);
        vec2 lv = vec2(l, l * l);
        avg += c;
        if (i <= 0 && j <= 0) { m0 += c; v0 += lv; }
        if (i >= 0 && j <= 0) { m1 += c; v1 += lv; }
        if (i <= 0 && j >= 0) { m2 += c; v2 += lv; }
        if (i >= 0 && j >= 0) { m3 += c; v3 += lv; }
      }
    }
    const float NS = float((GN + 1) * (GN + 1));
    const float NA = float((2 * GN + 1) * (2 * GN + 1));
    m0 /= NS; m1 /= NS; m2 /= NS; m3 /= NS; v0 /= NS; v1 /= NS; v2 /= NS; v3 /= NS; avg /= NA;
    float s0 = max(v0.y - v0.x * v0.x, 0.0), s1 = max(v1.y - v1.x * v1.x, 0.0), s2 = max(v2.y - v2.x * v2.x, 0.0), s3 = max(v3.y - v3.x * v3.x, 0.0);
    float w0 = 1.0 / pow(1.0 + 900.0 * s0, 4.0), w1 = 1.0 / pow(1.0 + 900.0 * s1, 4.0);
    float w2 = 1.0 / pow(1.0 + 900.0 * s2, 4.0), w3 = 1.0 / pow(1.0 + 900.0 * s3, 4.0);
    vec3 kuw = (m0 * w0 + m1 * w1 + m2 * w2 + m3 * w3) / max(w0 + w1 + w2 + w3, 1e-6);
    vec3 col = mix(centre, kuw, uPaint);
    // far focus / fatigue: soften towards the plain local mean
    col = mix(col, avg, clamp(coc * 0.55 + uBlur * 0.6, 0.0, 0.9));
    // atmospheric haze: in-scatter is warm honey near the lights and turns cooler and bluer with distance; its
    // brightness follows the local light (lit halls glow, torch-lit dark zones stay dark)
    if (uHaze > 0.0 && uHasDepth > 0.5) {
      float d = sky ? uFar : dist;
      float h = 1.0 - exp(-max(d - uHazeStart, 0.0) * uHaze);
      if (sky) h *= uHazeSky;
      float far = smoothstep(0.0, uHazeFarDist, d);
      float lum = dot(avg / (1.0 + avg), LUMA);
      vec3 hc = mix(uHazeNear, uHazeFar, far);
      vec3 inscatter = hc * (uHazeLum + uHazeGlow * lum * 2.2) + avg * uHazeGlow * 0.35 * (1.0 - far);
      col = mix(col, inscatter, h);
    }
    gl_FragColor = vec4(col, 1.0);
  }`;
}

class ScenePass extends Pass {
  // renders the scene into its own target (colour + depth texture); the paint pass carries it into the chain
  constructor(scene, camera, post) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.post = post;
    this.needsSwap = false;
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
    this.rt.depthTexture = new THREE.DepthTexture(1, 1);
    this.rt.depthTexture.type = THREE.UnsignedIntType;
  }
  setSize(w, h) { this.rt.setSize(w, h); }
  render(renderer) {
    const oldAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = oldAuto;
  }
  dispose() { this.rt.depthTexture?.dispose(); this.rt.dispose(); }
}

class PaintPass extends Pass {
  constructor(material, scenePass) {
    super();
    this.material = material;
    this.uniforms = material.uniforms;
    this.scenePass = scenePass;
    this.fsQuad = new FullScreenQuad(material);
    this.needsSwap = true;
  }
  render(renderer, writeBuffer) {
    const sp = this.scenePass, cam = sp.camera, U = this.uniforms;
    U.tDiffuse.value = sp.rt.texture;
    U.tDepth.value = sp.rt.depthTexture;
    U.uNear.value = cam.near; U.uFar.value = cam.far; U.uOrtho.value = cam.isOrthographicCamera ? 1 : 0;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }
  setSize(w, h) { this.uniforms.uRes.value.set(w, h); }
  dispose() { this.material.dispose(); this.fsQuad.dispose(); }
}

// ---------------------------------------------------------------------------------------------------------------
// Final pass (input: linear HDR; output: display sRGB)
// ---------------------------------------------------------------------------------------------------------------
const FINAL_FS = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform sampler2D tPaper;
  uniform vec2 uRes;
  uniform float uTime, uToneExposure;
  uniform float uGrain, uVignette, uDamage, uSanity, uBlur, uGlitch, uFade, uScan, uSat, uContrast, uDesat, uFlash;
  uniform float uExposure, uRolloff, uSplit;
  uniform vec3 uLift, uGamma, uGain, uFadeColor, uTint, uShadowFloor, uSplitShadow, uSplitHigh;
  varying vec2 vUv;
  ${COMMON}
  // ACES filmic (same fit as three.js ACESFilmicToneMapping)
  vec3 pmRRTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
  vec3 pmAces(vec3 color){
    const mat3 pmAcesIn = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
    const mat3 pmAcesOut = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
    color *= uToneExposure / 0.6;
    color = pmAcesIn * color; color = pmRRTFit(color); color = pmAcesOut * color;
    return clamp(color, 0.0, 1.0);
  }
  vec3 toSRGB(vec3 c){ c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
  vec3 softLight(vec3 a, vec3 b){ return mix(2.0 * a * b + a * a * (1.0 - 2.0 * b), sqrt(a) * (2.0 * b - 1.0) + 2.0 * a * (1.0 - b), step(0.5, b)); }
  void main(){
    vec2 uv = vUv;
    float t = uTime;
    float insanity = 1.0 - uSanity;
    vec2 px = 1.0 / uRes;
    // reality shudder (old 'glitch' hook): the picture sways and doubles softly, like a dizzy spell
    if (uGlitch > 0.0) uv += uGlitch * 0.004 * vec2(sin(t * 7.0 + uv.y * 4.0), cos(t * 5.0 + uv.x * 3.0));
    vec3 hdr = texture2D(tDiffuse, uv).rgb;
    float soft = clamp(uBlur * 0.8 + uGlitch * 0.5 + insanity * insanity * 0.35, 0.0, 1.0);
    if (soft > 0.001) {
      vec2 bp = px * (1.5 + soft * 4.0);
      vec3 acc = texture2D(tDiffuse, uv + vec2(bp.x, bp.y)).rgb + texture2D(tDiffuse, uv - vec2(bp.x, bp.y)).rgb
               + texture2D(tDiffuse, uv + vec2(bp.x, -bp.y)).rgb + texture2D(tDiffuse, uv - vec2(bp.x, -bp.y)).rgb;
      hdr = mix(hdr, acc * 0.25, soft * 0.85);
      if (uGlitch > 0.0) hdr = mix(hdr, texture2D(tDiffuse, uv + vec2(0.012, 0.004) * uGlitch).rgb, uGlitch * 0.3);
    }
    vec3 col = toSRGB(pmAces(hdr));
    // display grade (per level): tint / exposure, highlight shoulder, lift / gamma / gain
    col *= uTint * uExposure;
    col = mix(col, col / (1.0 + col * 0.35) * 1.35, uRolloff);
    col = col * uGain + uLift * (1.0 - col);
    col = pow(max(col, 0.0), 1.0 / max(uGamma, vec3(0.01)));
    // warm split tone: cool olive-teal shadows, warm honey highlights
    float L = dot(col, LUMA);
    vec3 st = mix(uSplitShadow, uSplitHigh, smoothstep(0.08, 0.7, L));
    col = clamp(softLight(clamp(col, 0.0, 1.0), mix(vec3(0.5), st, uSplit)), 0.0, 1.0);
    // saturation (low sanity drains colour gently), contrast around mid grey
    L = dot(col, LUMA);
    col = mix(vec3(L), col, uSat * (1.0 - uDesat * 0.85) * (1.0 - insanity * 0.45) * (1.0 - uScan * 0.5));
    col = (col - 0.5) * uContrast + 0.5;
    // shadows never go pure black: they settle on a deep cool olive
    col = uShadowFloor + max(col, 0.0) * (1.0 - uShadowFloor);
    // soft vignette (darker and a touch warmer at the rim); low sanity / spectating close it in
    vec2 d = vUv - 0.5;
    float r2 = dot(d * vec2(uRes.x / uRes.y, 1.0) * 0.82, d * vec2(uRes.x / uRes.y, 1.0) * 0.82);
    float vig = 1.0 - smoothstep(0.08, 0.95, r2) * clamp(uVignette * 1.15 + insanity * 0.35 + uScan * 0.4, 0.0, 1.0);
    col *= mix(vec3(1.0), vec3(1.0, 0.96, 0.9), 1.0 - vig) * vig;
    // damage: a soft, warm red glow creeping in from the edges (breathing, not flashing)
    float edgeD = smoothstep(0.12, 0.7, length(d) * 1.35);
    col = mix(col, vec3(0.62, 0.17, 0.1), edgeD * uDamage * (0.55 + 0.25 * sin(t * 3.0)));
    // canvas / paper: a faint static tooth in screen space plus a breath of soft noise in the shadows
    vec3 paper = texture2D(tPaper, vUv * uRes / 256.0).rgb;
    float tooth = (paper.r - 0.5) * 0.9 + (paper.g - 0.5) * 0.5;
    L = dot(col, LUMA);
    col *= 1.0 + tooth * uGrain * 0.9 * (0.55 + 0.45 * (1.0 - L));
    col += (hash(vUv * uRes + fract(t * 7.0) * 61.0) - 0.5) * uGrain * 0.12 * (1.0 - L);
    col = mix(col, vec3(1.0, 0.97, 0.9), uFlash);
    col = mix(col, uFadeColor, clamp(uFade, 0.0, 1.0));
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }`;

// 256x256 tiling paper / canvas tooth: R = soft fibrous tooth (two directions of woven canvas), G = blotchy pulp
function paperTexture() {
  const S = 256, data = new Uint8Array(S * S * 4);
  const h = (x, y, s) => { let n = (x * 374761393 + y * 668265263 + s * 982451653) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967295; };
  const vn = (x, y, f, s) => {
    const X = x * f / S, Y = y * f / S, xi = Math.floor(X), yi = Math.floor(Y), xf = X - xi, yf = Y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = h(xi % f, yi % f, s), b = h((xi + 1) % f, yi % f, s), c = h(xi % f, (yi + 1) % f, s), e = h((xi + 1) % f, (yi + 1) % f, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // canvas weave: soft threads along x and y with irregular thickness
      const wx = Math.sin((x + vn(x, y, 16, 3) * 6) * Math.PI * 2 / 4) * 0.5 + 0.5;
      const wy = Math.sin((y + vn(x, y, 16, 5) * 6) * Math.PI * 2 / 4) * 0.5 + 0.5;
      const weave = ((x >> 2) + (y >> 2)) & 1 ? wx : wy;
      const fib = vn(x, y, 64, 7) * 0.5 + vn(x, y, 32, 9) * 0.5;
      const tooth = 0.5 + (weave - 0.5) * 0.35 + (fib - 0.5) * 0.6;
      const pulp = vn(x, y, 8, 11) * 0.6 + vn(x, y, 16, 13) * 0.4;
      const i = (y * S + x) * 4;
      data[i] = Math.max(0, Math.min(255, tooth * 255));
      data[i + 1] = Math.max(0, Math.min(255, pulp * 255));
      data[i + 2] = 128; data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
let _paper = null;

// hook uniforms (shared objects; engine.setQuality copies their values into a rebuilt stack)
function makeParams() {
  const v3 = (x, y, z) => ({ value: new THREE.Vector3(x, y, z) });
  const col = (r, g, b) => ({ value: new THREE.Color(r, g, b) });
  return {
    uTime: { value: 0 },
    // game feel
    uDamage: { value: 0 },      // soft warm red edges
    uSanity: { value: 1 },      // 1 = fine, 0 = insane (gentle wobble, drained colour, closing vignette)
    uBlur: { value: 0 },        // fatigue / low blood pressure softness
    uGlitch: { value: 0 },      // reality shudder (dispatch, collapse, death): sway + soft double image
    uFade: { value: 0 },        // 0 visible, 1 = uFadeColor
    uFadeColor: col(0, 0, 0),
    uScan: { value: 0 },        // dead / spectating: faded photograph (no scanlines)
    uDesat: { value: 0 },
    uFlash: { value: 0 },       // camera / lightning flash
    // grade (display referred)
    uTint: col(1, 1, 1),
    uSat: { value: 1.0 },
    uContrast: { value: 1.04 },
    uExposure: { value: 1.0 },
    uLift: v3(0, 0, 0),
    uGamma: v3(1, 1, 1),
    uGain: v3(1, 1, 1),
    uRolloff: { value: 0.0 },
    uGrain: { value: 0.05 },     // canvas / paper tooth strength
    uVignette: { value: 0.4 },
    uSplit: { value: 0.55 },     // warm split-tone strength
    uSplitShadow: col(0.42, 0.52, 0.5),   // soft-light tints (0.5 = neutral): cool olive / teal shadows
    uSplitHigh: col(0.6, 0.53, 0.42),     // warm honey highlights
    uShadowFloor: col(0.03, 0.038, 0.034),// never pure black: deep cool olive
    // painterly + atmosphere (scene only)
    uPaint: { value: 1.0 },
    uPaintScale: { value: 1.7 },        // tap spacing in px at 1080p
    uHaze: { value: 0.045 },            // density per metre beyond uHazeStart
    uHazeStart: { value: 1.5 },
    uHazeFarDist: { value: 28 },        // metres over which the haze turns from warm to cool
    uHazeNear: col(1.0, 0.82, 0.55),    // warm honey near the light
    uHazeFar: col(0.42, 0.52, 0.56),    // cool, bluer with distance
    uHazeLum: { value: 0.035 },         // base in-scatter (multiplied by the haze colour)
    uHazeGlow: { value: 0.35 },         // extra in-scatter from the local light level
    uHazeSky: { value: 0.0 },           // share of haze laid over the sky / background
    uDof: { value: 0.0 },               // far depth of field strength (0..1)
    uDofStart: { value: 14 },
    uDofEnd: { value: 45 },
  };
}
const HOOK_KEYS = ['uTime', 'uDamage', 'uSanity', 'uBlur', 'uGlitch', 'uFade', 'uFadeColor', 'uScan', 'uDesat', 'uFlash'];
const PAINT_KEYS = ['uTime', 'uBlur', 'uSanity', 'uGlitch', 'uPaint', 'uPaintScale', 'uHaze', 'uHazeStart', 'uHazeFarDist', 'uHazeNear', 'uHazeFar', 'uHazeLum', 'uHazeGlow', 'uHazeSky', 'uDof', 'uDofStart', 'uDofEnd'];
const FINAL_KEYS = ['uTime', 'uGrain', 'uVignette', 'uDamage', 'uSanity', 'uBlur', 'uGlitch', 'uFade', 'uScan', 'uSat', 'uContrast', 'uDesat', 'uFlash', 'uExposure', 'uRolloff', 'uSplit',
  'uLift', 'uGamma', 'uGain', 'uFadeColor', 'uTint', 'uShadowFloor', 'uSplitShadow', 'uSplitHigh'];

export class PostFX {
  constructor(renderer, scene, camera, vmScene, vmCamera, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;
    const size = renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(renderer, rt);
    this.params = makeParams();
    const P = this.params;

    // scene -> own target (colour + depth). Kept under the old name: engine / levels swap .scene / .camera.
    this.renderPass = new ScenePass(scene, camera, this);
    this.composer.addPass(this.renderPass);
    this.sceneDepth = this.renderPass.rt.depthTexture;

    const lite = quality.paint === 'lite';
    const dof = !!quality.dof;
    const pu = {
      tDiffuse: { value: null }, tDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.05 }, uFar: { value: 220 }, uOrtho: { value: 0 }, uHasDepth: { value: 1 },
    };
    for (const k of PAINT_KEYS) pu[k] = P[k];
    this.paintPass = new PaintPass(new THREE.ShaderMaterial({ uniforms: pu, vertexShader: VERT, fragmentShader: paintShader(lite, dof), depthTest: false, depthWrite: false }), this.renderPass);
    this.composer.addPass(this.paintPass);

    if (quality.ao) {
      this.gtao = new GTAOPass(scene, camera, size.x, size.y);
      this.gtao.output = GTAOPass.OUTPUT.Default;
      this.gtao.blendIntensity = 0.7;
      this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.0, samples: 12 });
      this.composer.addPass(this.gtao);
    }

    if (vmScene) {
      this.vmPass = new RenderPass(vmScene, vmCamera);
      this.vmPass.clear = false;
      this.vmPass.clearDepth = true;
      this.composer.addPass(this.vmPass);
    }

    // gentle bloom on light sources (resolution halved inside the pass)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.7, 0.95);
    this.bloom.enabled = !!quality.bloom;
    this.composer.addPass(this.bloom);

    if (!_paper) _paper = paperTexture();
    const fu = { tDiffuse: { value: null }, tPaper: { value: _paper }, uRes: { value: new THREE.Vector2(1, 1) }, uToneExposure: { value: 1 } };
    for (const k of FINAL_KEYS) fu[k] = P[k];
    this.final = new ShaderPass(new THREE.ShaderMaterial({ uniforms: fu, vertexShader: VERT, fragmentShader: FINAL_FS, depthTest: false, depthWrite: false }));
    this.composer.addPass(this.final);

    this.fxaa = new ShaderPass(FXAAShader);
    this.fxaa.enabled = quality.fxaa !== false;
    this.composer.addPass(this.fxaa);
    this.setSize(size.x, size.y, renderer.getPixelRatio());
  }

  setSize(w, h, pr) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    this.final.uniforms.uRes.value.set(w * pr, h * pr);
  }

  render(dt, time) {
    this.params.uTime.value = time;
    this.final.uniforms.uToneExposure.value = this.renderer.toneMappingExposure;
    // (three.js only tone maps when drawing to the screen; the final pass tone maps and encodes itself)
    this.composer.render(dt);
  }

  // restore the default look (grade, split tone, haze, painterly, depth of field); game-feel hooks stay as they are.
  // Levels call it when they hand the screen back (dispose) before the next one sets its own look.
  resetLook() {
    const d = makeParams();
    for (const k in d) {
      if (HOOK_KEYS.includes(k)) continue;
      const v = this.params[k].value;
      if (v && v.copy) v.copy(d[k].value); else this.params[k].value = d[k].value;
    }
  }

  dispose() {
    this.renderPass.dispose();
    this.paintPass.dispose();
    this.gtao?.dispose?.();
    this.bloom.dispose?.();
    this.final.dispose?.();
    this.fxaa.dispose?.();
    this.composer.dispose();
  }
}
