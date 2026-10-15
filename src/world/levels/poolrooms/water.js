// Pool water: a planar reflection at the (moving) water level and the water surface shader.
// The surface is premultiplied-alpha blended over the submerged tiles, which already carry the
// refraction wobble, absorption and caustics (poolmat.js). Here: Fresnel reflection with ripple
// distortion, two scrolling ripple normal layers + up to 16 expanding ring ripples (footsteps,
// drips, splashes), depth haze, underwater lamp glow, specular sparkle, and the view from below
// (total internal reflection outside Snell's window).
import * as THREE from 'three';
import { PU } from './poolmat.js';

export const MAX_RIPPLES = 16;
const _look = new THREE.Vector3();
const _up = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _size2 = new THREE.Vector2();

export class PoolReflection {
  constructor(renderer, height, scale) {
    this.renderer = renderer;
    this.height = height;
    this.scale = scale;
    const size = renderer.getSize(new THREE.Vector2());
    this.rt = new THREE.WebGLRenderTarget(Math.max(2, Math.round(size.x * scale)), Math.max(2, Math.round(size.y * scale)), { type: THREE.HalfFloatType });
    this.rt.texture.generateMipmaps = false;
    this.camera = new THREE.PerspectiveCamera();
    this.textureMatrix = new THREE.Matrix4();
    this.enabled = true;
    this.needed = false;
    this.meshes = new Set();
    this.hide = new Set(); // extra objects hidden in the mirrored pass (haze, shafts)
    this._plane = new THREE.Plane();
    this._clip = new THREE.Vector4();
    this._q = new THREE.Vector4();
    this._size = size.clone();
  }

  _checkSize() {
    const size = this.renderer.getSize(_size2);
    if (size.x !== this._size.x || size.y !== this._size.y) {
      this._size.copy(size);
      this.rt.setSize(Math.max(2, Math.round(size.x * this.scale)), Math.max(2, Math.round(size.y * this.scale)));
    }
  }

  update(scene, camera) {
    if (!this.enabled || !this.needed) return;
    const h = this.height;
    if (camera.position.y < h + 0.02) return;
    this._checkSize();
    const vc = this.camera;
    vc.copy(camera, false);
    vc.position.y = 2 * h - camera.position.y;
    const look = _look.set(0, 0, -1).applyQuaternion(camera.quaternion);
    look.y *= -1;
    const up = _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    up.y *= -1;
    vc.up.copy(up);
    vc.lookAt(_tgt.copy(vc.position).add(look));
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(vc.projectionMatrix);
    this.textureMatrix.multiply(vc.matrixWorldInverse);
    // oblique near plane (Lengyel) so nothing below the water is mirrored
    this._plane.setFromNormalAndCoplanarPoint(_up.set(0, 1, 0), _tgt.set(0, h, 0));
    this._plane.applyMatrix4(vc.matrixWorldInverse);
    this._clip.set(this._plane.normal.x, this._plane.normal.y, this._plane.normal.z, this._plane.constant);
    const pm = vc.projectionMatrix;
    const q = this._q;
    q.x = (Math.sign(this._clip.x) + pm.elements[8]) / pm.elements[0];
    q.y = (Math.sign(this._clip.y) + pm.elements[9]) / pm.elements[5];
    q.z = -1.0;
    q.w = (1.0 + pm.elements[10]) / pm.elements[14];
    this._clip.multiplyScalar(2.0 / this._clip.dot(q));
    pm.elements[2] = this._clip.x;
    pm.elements[6] = this._clip.y;
    pm.elements[10] = this._clip.z + 1.0 - 0.003;
    pm.elements[14] = this._clip.w;

    const hidden = [];
    for (const m of this.meshes) { if (m.visible) { m.visible = false; hidden.push(m); } }
    for (const m of this.hide) { if (m.visible) { m.visible = false; hidden.push(m); } }
    // level-provided culling for the mirrored pass (far chunks / small props)
    if (this.cull) this.cull(camera.position, hidden);
    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    const prevShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.rt);
    r.state.buffers.depth.setMask(true);
    if (r.autoClear === false) r.clear();
    r.render(scene, vc);
    r.shadowMap.autoUpdate = prevShadow;
    r.setRenderTarget(prevRT);
    for (const m of hidden) m.visible = true;
    this.needed = false;
  }

  dispose() { this.rt.dispose(); }
}

// ---------------------------------------------------------------------------
export function makePoolWater(reflection, field) {
  const ripples = [];
  for (let i = 0; i < MAX_RIPPLES; i++) ripples.push(new THREE.Vector4(0, 0, -100, 0));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
      tReflect: { value: reflection.rt.texture },
      uTexMat: { value: reflection.textureMatrix },
      uReflOn: { value: 1 },
      uTime: { value: 0 },
      uLevel: { value: -0.1 },
      uRipples: { value: ripples },
      uRippleAmp: { value: 1 },
      uReflStr: { value: 0.92 },
      uMurk: { value: 0 },
      uLightTex: field.uniforms.uLightTex,
      uLightScale: field.uniforms.uLightScale,
      uAmbient: field.uniforms.uAmbient,
      uCollapse: field.uniforms.uCollapse,
      uRippleTex: PU.uRippleTex,
      uScatter: PU.uScatter,
      uAbsorb: PU.uAbsorb,
      uPoolGlow: PU.uPoolGlow,
    }),
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      attribute vec4 aLightCells;
      attribute vec4 aLightW;
      attribute vec3 aGlow;
      attribute float aFloorY;
      attribute float aInfect;
      varying float vInf;
      uniform mat4 uTexMat;
      uniform sampler2D uLightTex;
      uniform float uLightScale;
      varying vec4 vRefl;
      varying vec3 vWPos;
      varying vec3 vBaked;
      varying vec3 vGlow;
      varying float vFloorY;
      vec3 fetchLight(float cell){
        float s = 128.0;
        vec2 uv = (vec2(mod(cell, s), floor(cell / s)) + 0.5) / s;
        return texture2D(uLightTex, uv).rgb * 2.0;
      }
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        vRefl = uTexMat * wp;
        vBaked = (fetchLight(aLightCells.x) * aLightW.x + fetchLight(aLightCells.y) * aLightW.y + fetchLight(aLightCells.z) * aLightW.z + fetchLight(aLightCells.w) * aLightW.w) * uLightScale;
        vGlow = aGlow;
        vFloorY = aFloorY;
        vInf = aInfect;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D tReflect;
      uniform sampler2D uRippleTex;
      uniform float uTime, uRippleAmp, uReflStr, uReflOn, uMurk, uPoolGlow, uCollapse, uLevel;
      uniform vec3 uScatter, uAbsorb, uAmbient;
      uniform vec4 uRipples[${MAX_RIPPLES}];
      varying vec4 vRefl;
      varying vec3 vWPos;
      varying vec3 vBaked;
      varying vec3 vGlow;
      varying float vFloorY;
      varying float vInf;
      float wHash(vec2 q){ return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        vec2 p = vWPos.xz;
        vec2 n1 = texture2D(uRippleTex, p * 0.31 + vec2(uTime * 0.017, uTime * 0.011)).xy * 2.0 - 1.0;
        vec2 n2 = texture2D(uRippleTex, p * 0.53 - vec2(uTime * 0.013, -uTime * 0.019)).xy * 2.0 - 1.0;
        vec2 n3 = texture2D(uRippleTex, p * 1.7 + vec2(uTime * 0.05, -uTime * 0.04)).xy * 2.0 - 1.0;
        vec2 slope = (n1 * 0.55 + n2 * 0.4 + n3 * 0.12) * 0.22 * uRippleAmp;
        for (int i = 0; i < ${MAX_RIPPLES}; i++) {
          vec4 r = uRipples[i];
          float age = uTime - r.z;
          if (age < 0.0 || age > 5.0 || r.w <= 0.0) continue;
          vec2 d = p - r.xy;
          float dist = length(d);
          float x = dist - age * 0.42;
          float env = exp(-x * x * 26.0) * exp(-age * 0.9) * r.w / (1.0 + dist * 1.5);
          slope += (d / max(dist, 1e-3)) * sin(x * 34.0) * env * 0.9;
        }
        if (uCollapse > 0.0) slope += vec2(sin(p.x * 2.3 + uTime * 3.1), cos(p.y * 1.9 - uTime * 2.7)) * 0.08 * uCollapse;
        // contaminated water: rising bubbles popping on a slick, slow surface
        float bub = 0.0;
        if (vInf > 0.01) {
          vec2 g = p * 3.1;
          vec2 cid = floor(g);
          float h = wHash(cid);
          float ph = fract(uTime * (0.12 + h * 0.2) + h * 7.0);
          vec2 c = cid + 0.2 + 0.6 * vec2(wHash(cid + 3.7), wHash(cid + 9.1));
          float dd = length(g - c);
          float rad = 0.05 + ph * 0.16;
          float ring = exp(-pow((dd - rad) * 38.0, 2.0)) * step(0.72, h) * (1.0 - ph);
          bub = ring * vInf;
          slope *= 1.0 - vInf * 0.45;
          slope += normalize(g - c + 1e-4) * ring * 0.25 * vInf;
        }
        vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
        vec3 V = normalize(cameraPosition - vWPos);
        float depth = max(0.0, uLevel - vFloorY);
        float L = dot(vBaked, vec3(0.3, 0.59, 0.11));
        vec3 glow = vGlow * uPoolGlow;
        vec4 outc;
        if (gl_FrontFacing) {
          float cosT = clamp(dot(N, V), 0.0, 1.0);
          float F = 0.025 + 0.975 * pow(1.0 - cosT, 5.0);
          F = mix(F, 1.0, uMurk * 0.15);
          vec4 rc = vRefl;
          rc.xy += slope * 0.35 * rc.w;
          vec3 refl = texture2DProj(tReflect, rc).rgb;
          vec3 envc = (vBaked * 0.9 + uAmbient * 2.0) * vec3(0.9, 0.97, 1.0);
          refl = mix(envc, refl, uReflOn);
          // haze of the water body (thin over shallow floors, denser over the deep end)
          float vy = max(0.2, V.y);
          // dark, murky body: thin over the shallows, a near-opaque green-black over the deep water
          float haze = (1.0 - exp(-(depth + 0.1) * (1.05 + uMurk * 4.0) / vy)) * (0.4 + uMurk * 0.55);
          vec3 body = (uScatter * 2.2 + uScatter * uMurk * 2.0) * (L + 0.08) + glow * vec3(0.25, 0.6, 0.55) * 0.35;
          // contamination: sickly yellow-green film with an oily rainbow sheen
          body = mix(body, vec3(0.2, 0.24, 0.05) * (L + 0.1), vInf * 0.75);
          haze = mix(haze, min(1.0, haze + 0.25), vInf);
          float filmK = fract(cosT * 2.3 + (texture2D(uRippleTex, p * 0.07 + uTime * 0.004).x) * 1.7);
          vec3 film = 0.5 + 0.5 * cos(6.2831 * (filmK + vec3(0.0, 0.33, 0.67)));
          // sparkle: tiny bright glints where the ripples face the ceiling lights
          vec3 R = reflect(-V, N);
          float spark = pow(max(0.0, R.y), 900.0) * 6.0 * L;
          vec3 col = refl * F * uReflStr + body * haze + spark * vec3(1.0, 0.98, 0.95);
          col += film * vInf * (0.05 + F * 0.25) * (L + 0.15);
          col += vec3(0.75, 0.8, 0.55) * bub * (L + 0.2) * 1.3;
          float a = clamp(F * uReflStr + haze + bub * 0.3, 0.0, 1.0);
          // very shallow sheets of water fade out at their edge
          float thin = smoothstep(0.0, 0.035, depth);
          outc = vec4(col * thin, a * thin);
        } else {
          // from below: Snell's window to the lit hall above, total internal reflection elsewhere
          float cosT = abs(dot(N, V));
          float window = smoothstep(0.64, 0.74, cosT);
          vec3 above = (vBaked * 1.1 + uAmbient * 3.0 + 0.04) * vec3(0.85, 0.97, 1.0);
          vec3 tir = uScatter * 3.0 * (L + 0.15) + glow * 0.3;
          tir = mix(tir, vec3(0.12, 0.13, 0.03) * (L + 0.1), vInf * 0.6);
          outc = vec4(mix(tir, above, window), 1.0);
          outc.rgb *= mix(0.92, 0.35, window);
          outc.a = mix(0.92, 0.35, window);
        }
        gl_FragColor = outc;
        #ifdef USE_FOG
          #ifdef FOG_EXP2
            float fogFactor = 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
          #else
            float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
          #endif
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor * gl_FragColor.a, fogFactor);
        #endif
      }
    `,
  });
  mat.userData.ripples = ripples;
  mat.userData.next = 0;
  mat.userData.tick = (t) => { mat.uniforms.uTime.value = t; };
  // add a ring ripple at (x, z) with strength s
  mat.userData.addRipple = (x, z, s, t) => {
    const r = ripples[mat.userData.next];
    mat.userData.next = (mat.userData.next + 1) % MAX_RIPPLES;
    r.set(x, z, t, s);
  };
  return mat;
}
