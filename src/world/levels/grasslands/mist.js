// Drifting mist: big soft cloud billboards that cling to the forested slopes above the cliff rims and
// slide slowly with the wind; from day 4 the fog starts rolling down into the meadows. Placed around the
// camera from the deterministic world (highland interior near the rims), re-seeded as you travel.
import * as THREE from 'three';
import { engine } from '../../../core/engine.js';
import { hash01 } from '../../../core/rng.js';
import { noiseTexture } from './textures.js';

const MAX = 56;

export class MistSystem {
  constructor(level) {
    this.level = level;
    this.gw = level.gw;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
    g.setIndex([0, 1, 2, 1, 3, 2]);
    this.iP = new Float32Array(MAX * 4);  // x, y, z, size
    this.iA = new Float32Array(MAX * 2);  // alpha, seed
    g.setAttribute('iP', new THREE.InstancedBufferAttribute(this.iP, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iA', new THREE.InstancedBufferAttribute(this.iA, 2).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    this.U = { tNoise: { value: noiseTexture() }, uCol: { value: new THREE.Color(1, 1, 1) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uTime: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.U,
      vertexShader: /* glsl */`
        attribute vec4 iP; attribute vec2 iA;
        varying vec2 vUv; varying float vA; varying float vSeed; varying vec3 vDir;
        void main(){
          vUv = position.xy * 0.5 + 0.5;
          vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 u = vec3(0.0, 1.0, 0.0);
          vec3 p = iP.xyz + r * position.x * iP.w + u * position.y * iP.w * 0.45;
          float d = distance(p, cameraPosition);
          vA = iA.x * smoothstep(8.0, 30.0, d);
          vSeed = iA.y;
          vDir = normalize(p - cameraPosition);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tNoise; uniform vec3 uCol, uSunCol, uSunDir; uniform float uTime;
        varying vec2 vUv; varying float vA; varying float vSeed; varying vec3 vDir;
        void main(){
          vec2 c = vUv - 0.5;
          float r = length(c * vec2(1.0, 1.6)) * 2.0;
          vec2 q = vUv * vec2(1.3, 0.7) + vec2(vSeed * 7.0 + uTime * 0.006, vSeed * 3.0);
          float n = texture2D(tNoise, q).r * 0.6 + texture2D(tNoise, q * 2.3 + 0.4).g * 0.4;
          float a = smoothstep(1.0, 0.25, r) * smoothstep(0.32, 0.75, n) * vA;
          float fw = pow(max(dot(vDir, uSunDir), 0.0), 6.0);
          vec3 col = uCol + uSunCol * fw * 1.2;
          gl_FragColor = vec4(col * a, a);
        }`,
      transparent: true, depthWrite: false,
    });
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneMinusSrcAlphaFactor;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.mesh.name = 'mist';
    this.items = [];
    this.anchor = new THREE.Vector3(1e9, 0, 1e9);
  }

  _seed(cam, day) {
    this.anchor.copy(cam);
    this.items = [];
    const G = 16;
    const S = {};
    const valley = day >= 4 ? Math.min(1, (day - 3) * 0.3) : 0;
    for (let gz = -14; gz <= 14; gz++) for (let gx = -14; gx <= 14; gx++) {
      if (this.items.length >= MAX) break;
      const ix = Math.floor(cam.x / G) + gx, iz = Math.floor(cam.z / G) + gz;
      const h = hash01(ix, iz, 333, this.level.seed);
      const x = (ix + h) * G, z = (iz + hash01(ix, iz, 334, this.level.seed)) * G;
      const d = Math.hypot(x - cam.x, z - cam.z);
      if (d < 35 || d > 230) continue;
      const sd = this.gw.sdf(x, z, S);
      let y = null, size = 0;
      if (sd.h > 4 && sd.h < 40 && h < 0.42) { y = this.gw.height(x, z) - 2 + h * 10; size = 18 + h * 30; }
      else if (sd.h < -2 && h < valley * 0.35) { y = this.gw.height(x, z) + 1.2 + h * 3; size = 14 + h * 16; }
      if (y === null) continue;
      this.items.push({ x, y, z, size, seed: h, ph: h * 50, life: h * 100 });
    }
  }

  update(dt, cam, sky, day) {
    this.U.uTime.value += dt;
    if (cam.distanceTo(this.anchor) > 60 || day !== this.day) { this.day = day; this._seed(cam, day); }
    const S = sky.state;
    this.U.uCol.value.copy(S.fog).lerp(S.hor, 0.4).multiplyScalar(0.95);
    this.U.uSunCol.value.copy(S.sun).multiplyScalar(0.35 * Math.max(0, S.sunI / 6));
    this.U.uSunDir.value.copy(sky.uniforms.uSunDir.value);
    const wind = sky.windDir || { x: 0.8, z: 0.45 };
    const n = this.items.length;
    const base = 0.16 + Math.min(0.12, (day - 1) * 0.02);
    for (let i = 0; i < n; i++) {
      const it = this.items[i];
      it.life += dt;
      // forming / dissolving
      const a = 0.5 + 0.5 * Math.sin(it.life * 0.05 + it.ph);
      const drift = Math.sin(it.life * 0.013 + it.ph) * 6;
      this.iP[i * 4] = it.x + wind.x * drift;
      this.iP[i * 4 + 1] = it.y + Math.sin(it.life * 0.02 + it.ph) * 1.5;
      this.iP[i * 4 + 2] = it.z + wind.z * drift;
      this.iP[i * 4 + 3] = it.size;
      this.iA[i * 2] = base * a;
      this.iA[i * 2 + 1] = it.seed;
    }
    this.mesh.geometry.instanceCount = n;
    this.mesh.geometry.attributes.iP.needsUpdate = true;
    this.mesh.geometry.attributes.iA.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
