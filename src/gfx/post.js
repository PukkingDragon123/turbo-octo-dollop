// Post-processing: scene -> viewmodel overlay -> bloom -> tone map -> FXAA -> "camcorder" final pass
// The final pass adds film grain, vignette, chromatic aberration, damage/sanity warping,
// reality-collapse glitching and fades. All game-feel parameters live in `post.params`.
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
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uVignette, uAberration, uDamage, uSanity, uBlur, uGlitch, uFade, uScan, uSat, uContrast, uDesat, uFlash;
    uniform float uExposure, uRolloff;
    uniform vec3 uLift, uGamma, uGain;
    uniform vec2 uRes;
    uniform vec3 uFadeColor, uTint;
    varying vec2 vUv;

    float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
    float noise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }

    vec3 sampleAb(vec2 uv, float ab){
      vec2 d = (uv - 0.5);
      float r = texture2D(tDiffuse, uv + d*ab).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - d*ab).b;
      return vec3(r,g,b);
    }

    void main(){
      vec2 uv = vUv;
      float insanity = 1.0 - uSanity;
      // sanity: slow breathing warp
      float t = uTime;
      uv += insanity * 0.006 * vec2(sin(uv.y*9.0 + t*1.3), cos(uv.x*7.0 + t*1.1));
      // glitch: horizontal tearing bands
      if (uGlitch > 0.0) {
        float band = floor(uv.y * 40.0 + floor(t*12.0)*3.0);
        float g = step(1.0 - uGlitch*0.35, hash(vec2(band, floor(t*15.0))));
        uv.x += g * (hash(vec2(band, t)) - 0.5) * 0.12 * uGlitch;
        uv.y += uGlitch * 0.004 * sin(t*50.0 + uv.x*30.0);
      }
      float ab = uAberration + insanity * 0.006 + uDamage * 0.01 + uGlitch * 0.02;
      vec3 col = sampleAb(uv, ab * 8.0);
      // cheap blur (fatigue / low blood pressure)
      if (uBlur > 0.001) {
        vec2 px = 1.0 / uRes * (2.0 + uBlur * 6.0);
        vec3 acc = col;
        acc += texture2D(tDiffuse, uv + vec2(px.x, 0.0)).rgb;
        acc += texture2D(tDiffuse, uv - vec2(px.x, 0.0)).rgb;
        acc += texture2D(tDiffuse, uv + vec2(0.0, px.y)).rgb;
        acc += texture2D(tDiffuse, uv - vec2(0.0, px.y)).rgb;
        col = mix(col, acc / 5.0, clamp(uBlur, 0.0, 1.0));
      }
      // grade
      col *= uTint * uExposure;
      // soft highlight shoulder (keeps fluorescent panels from clipping into flat white blobs)
      col = mix(col, col / (1.0 + col * 0.35) * 1.35, uRolloff);
      col = col * uGain + uLift * (1.0 - col);
      col = pow(max(col, 0.0), 1.0 / max(uGamma, vec3(0.01)));
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSat * (1.0 - uDesat * 0.85));
      col = (col - 0.5) * uContrast + 0.5;
      // vignette
      vec2 d = vUv - 0.5;
      float vig = 1.0 - dot(d, d) * (uVignette * 2.2 + insanity * 1.2);
      col *= clamp(vig, 0.0, 1.0);
      // damage: pulsing red edges
      float edge = smoothstep(0.15, 0.75, length(d) * 1.4);
      col = mix(col, vec3(0.55, 0.02, 0.0), edge * uDamage * (0.7 + 0.3*sin(t*8.0)));
      // scanlines (camera / spectate)
      col *= 1.0 - uScan * 0.18 * (0.5 + 0.5 * sin(vUv.y * uRes.y * 1.6));
      // grain
      float gr = hash(vUv * uRes + fract(t * 37.0) * 100.0) - 0.5;
      col += gr * (uGrain + insanity * 0.08 + uGlitch * 0.1);
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
