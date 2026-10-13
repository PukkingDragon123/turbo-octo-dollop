// Planar reflections shared by every water surface at the same height (flooded Backrooms,
// pool glimpses) + a rippled, fresnel-blended water material lit by the baked light field.
import * as THREE from 'three';
import * as Tex from './textures.js';

export class PlanarReflection {
  constructor(renderer, height = 0.09, scale = 0.5) {
    this.renderer = renderer;
    this.height = height;
    this.scale = scale;
    const size = renderer.getSize(new THREE.Vector2());
    this.rt = new THREE.WebGLRenderTarget(Math.max(2, size.x * scale), Math.max(2, size.y * scale), { type: THREE.HalfFloatType });
    this.rt.texture.generateMipmaps = false;
    this.camera = new THREE.PerspectiveCamera();
    this.textureMatrix = new THREE.Matrix4();
    this.enabled = true;
    this.needed = false;
    this.meshes = new Set();
    this._plane = new THREE.Plane();
    this._clip = new THREE.Vector4();
    this._q = new THREE.Vector4();
  }

  resize() {
    const size = this.renderer.getSize(new THREE.Vector2());
    this.rt.setSize(Math.max(2, size.x * this.scale), Math.max(2, size.y * this.scale));
  }

  // Render the mirrored view (call before the main render)
  update(scene, camera) {
    if (!this.enabled || !this.needed) return;
    const h = this.height;
    if (camera.position.y < h) return;
    const vc = this.camera;
    vc.copy(camera, false);
    // mirror camera position & orientation about plane y = h
    vc.position.y = 2 * h - camera.position.y;
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    look.y *= -1;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    up.y *= -1;
    vc.up.copy(up);
    vc.lookAt(vc.position.clone().add(look));
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);
    // texture matrix
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(vc.projectionMatrix);
    this.textureMatrix.multiply(vc.matrixWorldInverse);
    // oblique near-plane clipping (Lengyel)
    this._plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, h, 0));
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

    for (const m of this.meshes) m.visible = false;
    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    const prevXr = r.xr.enabled;
    const prevShadow = r.shadowMap.autoUpdate;
    r.xr.enabled = false;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.rt);
    r.state.buffers.depth.setMask(true);
    if (r.autoClear === false) r.clear();
    r.render(scene, vc);
    r.xr.enabled = prevXr;
    r.shadowMap.autoUpdate = prevShadow;
    r.setRenderTarget(prevRT);
    for (const m of this.meshes) m.visible = true;
    this.needed = false;
  }

  dispose() { this.rt.dispose(); }
}

export function makeWaterMaterial(reflection, field, opts = {}) {
  const noise = Tex.get('noise').map;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
      tReflect: { value: reflection.rt.texture },
      uTexMat: { value: reflection.textureMatrix },
      uNoise: { value: noise },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(opts.color ?? 0x2a2a12) },
      uDeep: { value: new THREE.Color(opts.deep ?? 0x14140a) },
      uOpacity: { value: opts.opacity ?? 0.82 },
      uReflectStrength: { value: opts.reflect ?? 0.85 },
      uLightTex: field.uniforms.uLightTex,
      uLightScale: field.uniforms.uLightScale,
    }),
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      attribute vec4 aLightCells;
      attribute vec4 aLightW;
      uniform mat4 uTexMat;
      uniform sampler2D uLightTex;
      uniform float uLightScale;
      varying vec4 vRefl;
      varying vec3 vWPos;
      varying vec3 vBaked;
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
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D tReflect;
      uniform sampler2D uNoise;
      uniform float uTime, uOpacity, uReflectStrength;
      uniform vec3 uColor, uDeep;
      varying vec4 vRefl;
      varying vec3 vWPos;
      varying vec3 vBaked;
      void main(){
        vec2 p = vWPos.xz;
        float n1 = texture2D(uNoise, p * 0.35 + vec2(uTime * 0.02, uTime * 0.013)).g;
        float n2 = texture2D(uNoise, p * 0.6 - vec2(uTime * 0.017, -uTime * 0.021)).g;
        vec2 ripple = vec2(n1 - 0.5, n2 - 0.5) * 0.06;
        vec4 rc = vRefl;
        rc.xy += ripple * rc.w;
        vec3 refl = texture2DProj(tReflect, rc).rgb;
        vec3 V = normalize(cameraPosition - vWPos);
        float fres = 0.25 + 0.75 * pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
        vec3 base = mix(uDeep, uColor, 0.5 + (n1 - 0.5)) * (vBaked + 0.05);
        vec3 col = mix(base, refl, fres * uReflectStrength);
        // specular glints of the fluorescent tubes
        col += vBaked * pow(max(0.0, n1 * n2 * 2.2 - 0.9), 3.0) * 0.6;
        gl_FragColor = vec4(col, mix(uOpacity, 1.0, fres * 0.5));
        #include <fog_fragment>
      }
    `,
  });
  mat.userData.tick = (t) => { mat.uniforms.uTime.value = t; };
  return mat;
}
