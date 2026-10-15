// Post-processing: scene -> viewmodel overlay -> bloom -> tone map -> FXAA -> "camcorder" final pass
// The final pass makes the picture look like worn camcorder / film footage (lens barrel, gate weave, VHS chroma
// bleed and tracking, halation, dust and scratches, faded grade) and adds damage/sanity warping, the
// "liquefaction" warp, reality-collapse glitching and fades. All game-feel parameters live in `post.params`.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uGrain: { value: 0.06 },
    uVignette: { value: 0.45 },
    uAberration: { value: 0.0005 },
    uDamage: { value: 0 },      // red edge pulse
    uSanity: { value: 1 },      // 1 = fine, 0 = insane
    uBlur: { value: 0 },        // fatigue / low BP blur
    uGlitch: { value: 0 },      // reality collapse / dispatch
    uFade: { value: 0 },        // 0 visible, 1 black
    uFadeColor: { value: new THREE.Color(0, 0, 0) },
    uScan: { value: 0.0 },      // scanlines amount (camera mode)
    uTint: { value: new THREE.Color(1, 1, 1) },
    uSat: { value: 1.0 },
    uContrast: { value: 1.04 },
    uDesat: { value: 0.0 },     // spectator / dead
    uFlash: { value: 0.0 },     // camera flash
    // film grade (display-referred, neutral defaults): exposure trim, lift / gamma / gain per channel,
    // highlight roll-off strength and a gentle toe that keeps blacks soft instead of crushed
    uExposure: { value: 1.0 },
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uGamma: { value: new THREE.Vector3(1, 1, 1) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uRolloff: { value: 0.0 },
    // old-footage look
    uBarrel: { value: 0.12 },   // camcorder lens barrel distortion
    uWeave: { value: 1.0 },     // film-gate weave
    uVHS: { value: 0.55 },      // line jitter, chroma bleed, rolling tracking band
    uHalation: { value: 0.35 }, // red-orange glow bleeding around bright lights
    uDust: { value: 1.0 },      // dust specks and scratches
    uFilm: { value: 1.0 },      // faded warm grade, lifted blacks, projector flicker
    uLiquid: { value: 0.0 },    // reality liquefaction: the picture flows, ripples and melts
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uVignette, uAberration, uDamage, uSanity, uBlur, uGlitch, uFade, uScan, uSat, uContrast, uDesat, uFlash;
    uniform float uExposure, uRolloff;
    uniform float uBarrel, uWeave, uVHS, uHalation, uDust, uFilm, uLiquid;
    uniform vec3 uLift, uGamma, uGain;
    uniform vec2 uRes;
    uniform vec3 uFadeColor, uTint;
    varying vec2 vUv;

    const vec3 LUMA = vec3(0.299, 0.587, 0.114);
    float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
    float noise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
    float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s / 0.875; }

    vec3 sampleAb(vec2 uv, float ab){
      vec2 d = (uv - 0.5);
      float r = texture2D(tDiffuse, uv + d*ab).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - d*ab).b;
      return vec3(r,g,b);
    }

    void main(){
      vec2 uv = vUv;
      float t = uTime;
      float aspect = uRes.x / uRes.y;
      // film-gate weave: the whole frame drifts a hair, like footage in a worn projector
      uv += uWeave * (vec2(noise(vec2(t * 2.1, 1.3)), noise(vec2(3.7, t * 1.7))) - 0.5) * 0.0026;
      // lens barrel: corners stay in frame, the centre bulges slightly
      vec2 ld = uv - 0.5;
      uv = 0.5 + ld * (1.0 + uBarrel * dot(ld, ld)) / (1.0 + uBarrel * 0.5);
      float insanity = 1.0 - uSanity;
      // sanity: slow breathing warp
      uv += insanity * 0.006 * vec2(sin(uv.y*9.0 + t*1.3), cos(uv.x*7.0 + t*1.1));
      // liquefaction: domain-warped flow (stronger towards the edges), ripple rings and columns melting down
      float L = uLiquid + insanity * 0.35;
      if (L > 0.001) {
        vec2 p = vec2(uv.x * aspect, uv.y) * 2.4;
        vec2 q = vec2(fbm(p + vec2(0.0, t * 0.13)), fbm(p + vec2(5.2, 1.3) - t * 0.11));
        vec2 r = vec2(fbm(p + 2.6 * q + vec2(1.7, 9.2) + t * 0.16), fbm(p + 2.6 * q + vec2(8.3, 2.8) - t * 0.14));
        float edge = 0.35 + 0.65 * smoothstep(0.0, 0.7, length(vUv - 0.5) * 1.4);
        uv += (r - 0.5) * 0.05 * L * edge;
        vec2 dc = (vUv - 0.5) * vec2(aspect, 1.0);
        float rr = length(dc);
        uv += dc / max(rr, 1e-3) * sin(rr * 36.0 - t * 3.0) * 0.003 * L * smoothstep(0.04, 0.3, rr) / vec2(aspect, 1.0);
        float colm = noise(vec2(uv.x * 24.0, t * 0.22)) * noise(vec2(uv.x * 7.0 + 3.0, t * 0.1));
        uv.y += pow(colm, 3.0) * 0.08 * L * L;
      }
      // VHS: per-line horizontal jitter and a rolling tracking band
      float line = floor(uv.y * uRes.y * 0.5);
      uv.x += (hash(vec2(line, floor(t * 30.0))) - 0.5) * 0.0015 * uVHS;
      float bandY = 1.0 - fract(t * 0.06);
      float inBand = smoothstep(0.03, 0.0, abs(uv.y - bandY)) * uVHS;
      uv.x += inBand * (hash(vec2(line * 0.37, floor(t * 20.0))) - 0.5) * 0.018;
      // glitch: horizontal tearing bands
      if (uGlitch > 0.0) {
        float band = floor(uv.y * 40.0 + floor(t*12.0)*3.0);
        float g = step(1.0 - uGlitch*0.35, hash(vec2(band, floor(t*15.0))));
        uv.x += g * (hash(vec2(band, t)) - 0.5) * 0.12 * uGlitch;
        uv.y += uGlitch * 0.004 * sin(t*50.0 + uv.x*30.0);
      }
      uv = clamp(uv, vec2(0.001), vec2(0.999));
      float ab = uAberration + insanity * 0.006 + uDamage * 0.01 + uGlitch * 0.02 + uLiquid * 0.004;
      vec3 col = sampleAb(uv, ab * 8.0);
      vec2 px = 1.0 / uRes;
      // VHS chroma bleed: luma stays sharp, colour smears to the right
      if (uVHS > 0.0) {
        vec3 c1 = texture2D(tDiffuse, uv - vec2(px.x * 3.0, 0.0)).rgb;
        vec3 c2 = texture2D(tDiffuse, uv - vec2(px.x * 7.0, 0.0)).rgb;
        vec3 cm = (col + c1 + c2) / 3.0;
        float y = dot(col, LUMA);
        col = mix(col, max(vec3(0.0), y + (cm - dot(cm, LUMA))), 0.65 * uVHS);
      }
      // halation: light bleeding through the film base around hot spots, tinted red-orange
      if (uHalation > 0.0) {
        vec3 h = vec3(0.0);
        float rad = uRes.y * 0.006;
        for (int i = 0; i < 6; i++) {
          float a = float(i) * 1.0472 + 0.4;
          vec2 o = vec2(cos(a), sin(a)) * px * rad * (1.0 + float(i - (i / 2) * 2) * 1.2);
          h += max(texture2D(tDiffuse, uv + o).rgb - 0.72, 0.0);
        }
        col += (h / 6.0) * vec3(1.0, 0.38, 0.14) * uHalation * 2.4;
      }
      // cheap blur (fatigue / low blood pressure)
      if (uBlur > 0.001) {
        vec2 bp = px * (2.0 + uBlur * 6.0);
        vec3 acc = col;
        acc += texture2D(tDiffuse, uv + vec2(bp.x, 0.0)).rgb;
        acc += texture2D(tDiffuse, uv - vec2(bp.x, 0.0)).rgb;
        acc += texture2D(tDiffuse, uv + vec2(0.0, bp.y)).rgb;
        acc += texture2D(tDiffuse, uv - vec2(0.0, bp.y)).rgb;
        col = mix(col, acc / 5.0, clamp(uBlur, 0.0, 1.0));
      }
      // grade
      col *= uTint * uExposure;
      // soft highlight shoulder (keeps fluorescent panels from clipping into flat white blobs)
      col = mix(col, col / (1.0 + col * 0.35) * 1.35, uRolloff);
      col = col * uGain + uLift * (1.0 - col);
      col = pow(max(col, 0.0), 1.0 / max(uGamma, vec3(0.01)));
      float l = dot(col, LUMA);
      col = mix(vec3(l), col, uSat * (1.0 - uDesat * 0.85));
      col = (col - 0.5) * uContrast + 0.5;
      // old footage: faded warm print, lifted blacks, softened whites
      float lf = dot(col, LUMA);
      col = mix(col, vec3(lf) * vec3(1.08, 0.98, 0.8), 0.2 * uFilm);
      col = col * (1.0 - 0.07 * uFilm) + vec3(0.04, 0.034, 0.026) * uFilm;
      // vignette
      vec2 d = vUv - 0.5;
      float vig = 1.0 - dot(d, d) * (uVignette * 2.2 + insanity * 1.2 + uLiquid * 0.5);
      col *= clamp(vig, 0.0, 1.0);
      // rounded lens corners
      vec2 cd = abs(d) * 2.0;
      col *= smoothstep(1.95, 1.25, pow(cd.x, 8.0) + pow(cd.y, 8.0));
      // damage: pulsing red edges
      float edgeD = smoothstep(0.15, 0.75, length(d) * 1.4);
      col = mix(col, vec3(0.55, 0.02, 0.0), edgeD * uDamage * (0.7 + 0.3*sin(t*8.0)));
      // scanlines (always faint, strong in camera / spectate)
      col *= 1.0 - (uScan * 0.18 + uVHS * 0.06) * (0.5 + 0.5 * sin(vUv.y * uRes.y * 1.6));
      // tracking band noise
      col = mix(col, vec3(hash(vUv * uRes + t) * 0.9), inBand * 0.22);
      // grain, heavier in the shadows like real film stock
      float gr = hash(vUv * uRes + fract(t * 37.0) * 100.0) - 0.5;
      col += gr * (uGrain * (1.4 - dot(col, LUMA)) + insanity * 0.08 + uGlitch * 0.1);
      // dust specks and scratches
      if (uDust > 0.0) {
        float fr = floor(t * 18.0);
        float sx = hash(vec2(fr, 7.1));
        float sOn = step(0.7, hash(vec2(fr, 3.3)));
        float sc = sOn * smoothstep(1.6 * px.x, 0.0, abs(vUv.x - sx)) * (0.4 + 0.6 * noise(vec2(vUv.y * 30.0, fr)));
        col = mix(col, vec3(0.92, 0.88, 0.74), sc * 0.3 * uDust);
        vec2 gq = vec2(vUv.x * aspect, vUv.y) * 26.0;
        vec2 gi = floor(gq);
        float hh = hash(gi + fr * 1.37);
        vec2 off = vec2(hash(gi + 3.1), hash(gi + 7.7)) - 0.5;
        float speck = step(0.9955, hh) * smoothstep(0.06 + 0.16 * fract(hh * 97.0), 0.0, length(fract(gq) - 0.5 + off * 0.5));
        col *= 1.0 - speck * 0.8 * uDust;
      }
      // projector flicker
      col *= 1.0 + (hash(vec2(floor(t * 24.0), 1.7)) - 0.5) * 0.04 * uFilm;
      // collapse noise snow
      if (uGlitch > 0.5) col = mix(col, vec3(hash(vUv*uRes + t)), (uGlitch - 0.5) * 0.6);
      col = mix(col, vec3(1.0), uFlash);
      col = mix(col, uFadeColor, clamp(uFade, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera, vmScene, vmCamera, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    const size = renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: quality.msaa ? 4 : 0 });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    if (quality.ao) {
      this.gtao = new GTAOPass(scene, camera, size.x, size.y);
      this.gtao.output = GTAOPass.OUTPUT.Default;
      this.gtao.blendIntensity = 0.85;
      this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.0, samples: 12 });
      this.composer.addPass(this.gtao);
    }

    if (vmScene) {
      this.vmPass = new RenderPass(vmScene, vmCamera);
      this.vmPass.clear = false;
      this.vmPass.clearDepth = true;
      this.composer.addPass(this.vmPass);
    }

    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.38, 0.55, 0.92);
    this.bloom.enabled = quality.bloom;
    this.composer.addPass(this.bloom);

    this.output = new OutputPass();
    this.composer.addPass(this.output);

    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);

    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.params = this.final.uniforms;
    this.setSize(size.x, size.y, renderer.getPixelRatio());
  }

  setSize(w, h, pr) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    this.final.uniforms.uRes.value.set(w * pr, h * pr);
  }

  render(dt, time) {
    this.final.uniforms.uTime.value = time;
    this.composer.render(dt);
  }
}
