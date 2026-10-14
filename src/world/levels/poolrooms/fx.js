// Local (per-client) Poolrooms atmosphere: ceiling drips falling into the water (with ring ripples
// and echoing plinks), low steam haze drifting over the pools, and unseen things disturbing the
// water as the days go on.
import * as THREE from 'three';
import { engine } from '../../../core/engine.js';
import { audio } from '../../../audio/audio.js';
import { CELL } from './layout.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class PoolFX {
  constructor(level) {
    this.level = level;
    this.world = level.world;
    this.game = level.game;
    this.dripT = 1.5;
    this.eventT = 25;
    this.drops = [];
    this.recent = []; // uncanny disturbances worth a photo {pos, t}
    this._initHaze();
  }

  _initHaze() {
    const N = 90;
    const geo = new THREE.BufferGeometry();
    this.hp = new Float32Array(N * 3);
    this.hv = new Float32Array(N * 3);
    this.ha = new Float32Array(N);
    this.hs = new Float32Array(N);
    this.hl = new Float32Array(N); // life
    geo.setAttribute('position', new THREE.BufferAttribute(this.hp, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.ha, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.hs, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
      uniforms: { uScale: { value: window.innerHeight * 0.6 }, uColor: { value: new THREE.Color(0.86, 0.94, 0.95) }, uLight: { value: 1 } },
      vertexShader: /* glsl */`
        attribute float aAlpha; attribute float aSize; varying float vA;
        uniform float uScale;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float d = -mv.z;
          vA = aAlpha * smoothstep(2.0, 5.0, d) * (1.0 - smoothstep(16.0, 26.0, d));
          gl_PointSize = aSize * uScale / max(0.5, d);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying float vA; uniform vec3 uColor; uniform float uLight;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float r = dot(c, c) * 4.0;
          float a = exp(-r * 2.6) * vA;
          if (a < 0.002) discard;
          gl_FragColor = vec4(uColor * uLight, a);
        }`,
    });
    this.haze = new THREE.Points(geo, mat);
    this.haze.frustumCulled = false;
    this.haze.renderOrder = 4;
    this.world.group.add(this.haze);
    this.level.reflection?.hide.add(this.haze);
    this.N = N;
  }

  update(dt) {
    const lvl = this.level;
    const cam = engine.camera.position;
    const t = lvl.time;
    // ---- drips: drops fall from the ceiling into nearby water ----
    this.dripT -= dt;
    if (this.dripT <= 0) {
      this.dripT = 0.6 + Math.random() * 2.2;
      for (let k = 0; k < 6; k++) {
        const x = cam.x + (Math.random() - 0.5) * 16, z = cam.z + (Math.random() - 0.5) * 16;
        if (lvl.waterDepth(x, z) <= 0.02) continue;
        const top = lvl.ceilingY(x, z) - 0.05;
        this.drops.push({ x, z, y: top, vy: 0 });
        break;
      }
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.vy -= 9.8 * dt;
      d.y += d.vy * dt;
      if (d.y <= lvl.waterLevel) {
        this.drops.splice(i, 1);
        lvl.ripple(d.x, d.z, 0.55);
        this.world.fx.splash(_v.set(d.x, lvl.waterLevel + 0.01, d.z), 3, lvl.waterLevel);
        if (Math.hypot(d.x - cam.x, d.z - cam.z) < 12) audio.play('drip', { pos: _v.set(d.x, lvl.waterLevel, d.z), volume: 0.55 });
      } else if (Math.random() < 0.5) {
        this.world.fx.alpha.add(_v.set(d.x, d.y, d.z), _v2.set(0, d.vy, 0), 0.05, 0.012, 0.01, 0.8, 0.9, 0.95, 0.6, 0, 0);
      }
    }
    // ---- uncanny: something moves under the surface ----
    const inst = this.game.day.instability();
    this.eventT -= dt * (0.3 + inst * 1.6);
    if (this.eventT <= 0) {
      this.eventT = 18 + Math.random() * 30;
      if (this.game.day.day >= 2) {
        for (let k = 0; k < 8; k++) {
          const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 9;
          const x = cam.x + Math.cos(a) * r, z = cam.z + Math.sin(a) * r;
          if (lvl.waterDepth(x, z) < 0.4) continue;
          // a slow line of rings, as if something swam past
          const dir = Math.random() * Math.PI * 2;
          for (let s = 0; s < 5; s++) {
            setTimeout(() => lvl.ripple(x + Math.cos(dir) * s * 0.7, z + Math.sin(dir) * s * 0.7, 1.4), s * 380);
          }
          audio.play(Math.random() < 0.5 ? 'bubble' : 'water_glug', { pos: _v.set(x, lvl.waterLevel, z), volume: 0.6 });
          this.recent.push({ pos: new THREE.Vector3(x, lvl.waterLevel, z), t });
          break;
        }
      }
    }
    this.recent = this.recent.filter((e) => t - e.t < 6);
    this._updateHaze(dt, cam);
  }

  _updateHaze(dt, cam) {
    const lvl = this.level;
    const hp = this.hp, ha = this.ha, hs = this.hs, hv = this.hv, hl = this.hl;
    const dense = 0.65 + lvl.game.day.instability() * 0.6;
    for (let i = 0; i < this.N; i++) {
      hl[i] -= dt;
      const dx = hp[i * 3] - cam.x, dz = hp[i * 3 + 2] - cam.z;
      if (hl[i] <= 0 || dx * dx + dz * dz > 24 * 24) {
        // respawn over water near the camera
        let ok = false;
        for (let k = 0; k < 4 && !ok; k++) {
          const x = cam.x + (Math.random() - 0.5) * 36, z = cam.z + (Math.random() - 0.5) * 36;
          if (lvl.waterDepth(x, z) <= 0.02) continue;
          hp[i * 3] = x; hp[i * 3 + 1] = lvl.waterLevel + 0.15 + Math.random() * 0.9; hp[i * 3 + 2] = z;
          hv[i * 3] = (Math.random() - 0.5) * 0.08; hv[i * 3 + 1] = 0.01 + Math.random() * 0.025; hv[i * 3 + 2] = (Math.random() - 0.5) * 0.08;
          hs[i] = 1.4 + Math.random() * 2.2;
          hl[i] = 10 + Math.random() * 14;
          ok = true;
        }
        if (!ok) { ha[i] = 0; hl[i] = 1 + Math.random(); continue; }
      }
      hp[i * 3] += hv[i * 3] * dt; hp[i * 3 + 1] += hv[i * 3 + 1] * dt; hp[i * 3 + 2] += hv[i * 3 + 2] * dt;
      const life = hl[i];
      ha[i] = Math.min(1, life / 3) * Math.min(1, (24 - life) / 4) * 0.016 * dense;
    }
    const g = this.haze.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    this.haze.material.uniforms.uLight.value = Math.min(1.2, 0.15 + lvl.envLum * 0.9);
    this.haze.material.uniforms.uScale.value = window.innerHeight * 0.6;
  }

  photoSubjects(consider) {
    for (const e of this.recent) consider(e.pos, 'SOMETHING IN THE WATER', `wat:${Math.round(e.t)}`, 75);
  }

  dispose() {
    this.haze.removeFromParent();
    this.haze.geometry.dispose();
    this.haze.material.dispose();
    this.level.reflection?.hide.delete(this.haze);
  }
}

export { CELL };
