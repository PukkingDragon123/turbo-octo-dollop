// Particle & debris FX: pooled GPU points (additive + alpha-blended) and instanced debris chunks.
import * as THREE from 'three';

const VERT = /* glsl */`
  attribute float aSize;
  attribute vec4 aColor;
  attribute float aSpin;
  varying vec4 vColor;
  varying float vSpin;
  uniform float uScale;
  void main(){
    vColor = aColor;
    vSpin = aSpin;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / max(0.05, -mv.z);
    // ambient dust (flagged with aSpin >= 2) fades out near the lens instead of swelling into blurry discs
    if (aSpin > 1.5) vColor.a *= smoothstep(0.35, 1.1, -mv.z);
  }
`;
const FRAG = /* glsl */`
  varying vec4 vColor;
  varying float vSpin;
  uniform float uSoft;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = uSoft > 0.5 ? smoothstep(0.5, 0.0, d) : smoothstep(0.5, 0.35, d);
    // streak for fast sparks
    gl_FragColor = vec4(vColor.rgb, vColor.a * a);
  }
`;

class PointPool {
  constructor(max, additive, soft) {
    this.max = max;
    this.count = 0;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.spin = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSpin', new THREE.BufferAttribute(this.spin, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 400 }, uSoft: { value: soft ? 1 : 0 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    // simulation arrays
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.floorY = new Float32Array(max);
    this.bounce = new Float32Array(max);
  }

  add(p, v, life, size0, size1, r, g, b, a, grav = 0, drag = 0, floorY = -1e9, bounce = 0) {
    let i;
    if (this.count < this.max) i = this.count++;
    else i = Math.floor(Math.random() * this.max);
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.life[i] = life; this.maxLife[i] = life;
    this.size0[i] = size0; this.size1[i] = size1;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.alpha0[i] = a;
    this.grav[i] = grav; this.drag[i] = drag;
    this.floorY[i] = floorY; this.bounce[i] = bounce;
    this.spin[i] = Math.random();
    return i;
  }

  update(dt) {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        n--;
        this._copy(n, i);
        i--;
        continue;
      }
      const k = 1 - this.life[i] / this.maxLife[i];
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < this.floorY[i]) {
        this.pos[i * 3 + 1] = this.floorY[i];
        this.vel[i * 3 + 1] = -this.vel[i * 3 + 1] * this.bounce[i];
        this.vel[i * 3] *= 0.6; this.vel[i * 3 + 2] *= 0.6;
      }
      this.size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * k;
      const fadeIn = Math.min(1, k * 8);
      this.col[i * 4 + 3] = this.alpha0[i] * (1 - k * k) * fadeIn;
    }
    this.count = n;
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aSpin.needsUpdate = true;
  }

  _copy(from, to) {
    for (let c = 0; c < 3; c++) {
      this.pos[to * 3 + c] = this.pos[from * 3 + c];
      this.vel[to * 3 + c] = this.vel[from * 3 + c];
    }
    for (let c = 0; c < 4; c++) this.col[to * 4 + c] = this.col[from * 4 + c];
    this.life[to] = this.life[from]; this.maxLife[to] = this.maxLife[from];
    this.size[to] = this.size[from]; this.size0[to] = this.size0[from]; this.size1[to] = this.size1[from];
    this.alpha0[to] = this.alpha0[from]; this.grav[to] = this.grav[from]; this.drag[to] = this.drag[from];
    this.floorY[to] = this.floorY[from]; this.bounce[to] = this.bounce[from]; this.spin[to] = this.spin[from];
  }
}

// Irregular faceted chunk (unit-ish size): a jittered dodecahedron so shards read as broken
// material rather than little cubes. Shared corners move together (jitter keyed on position).
function shardGeometry() {
  const g = new THREE.DodecahedronGeometry(0.62, 0);
  const pos = g.attributes.position;
  const key = (x, y, z) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
  const jit = new Map();
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < pos.count; i++) {
    const k = key(pos.getX(i), pos.getY(i), pos.getZ(i));
    if (!jit.has(k)) jit.set(k, [0.72 + rnd() * 0.5, 0.72 + rnd() * 0.5, 0.72 + rnd() * 0.5]);
    const j = jit.get(k);
    pos.setXYZ(i, pos.getX(i) * j[0], pos.getY(i) * j[1] * 0.8, pos.getZ(i) * j[2]);
  }
  g.computeVertexNormals();
  return g;
}

// Instanced debris chunks (tile shards, splinters, glass) with simple floor bounce.
// Lighting: most levels light statics with baked vertex light and dynamics with probes, so the chunks
// carry a per-instance irradiance (sampled from the level's light field) instead of going black.
class DebrisPool {
  constructor(max) {
    this.max = max;
    const geo = shardGeometry();
    this.lightAttr = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.lightAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aLight', this.lightAttr);
    this.mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
    this.mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aLight;\nvarying vec3 vDebrisLight;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDebrisLight = aLight;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vDebrisLight;')
        .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\nirradiance += vDebrisLight * PI;');
    };
    this.mat.customProgramCacheKey = () => 'debris_probe';
    this.mesh = new THREE.InstancedMesh(geo, this.mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.userData.noProbe = true;
    this.mesh.count = 0;
    this.items = [];
    this.lightSampler = null; // (pos, outColor) => void, set by the world
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this.colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.instanceColor = this.colorAttr;
  }
  _sample(it) {
    if (this.lightSampler) this.lightSampler(it.p, it.l);
    else it.l.setRGB(0.3, 0.28, 0.25);
  }
  add(p, v, size, color, life = 6, floorY = 0) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({
      p: p.clone(), v: v.clone(), s: size.clone ? size.clone() : new THREE.Vector3(size, size * 0.3, size),
      r: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      w: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14),
      c: new THREE.Color(color), l: new THREE.Color(), life, max: life, floorY, rest: false,
    });
    this._sample(this.items[this.items.length - 1]);
  }
  update(dt) {
    const items = this.items;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      it.life -= dt;
      if (it.life <= 0) { items.splice(i, 1); continue; }
      if (!it.rest) {
        it.v.y -= 12 * dt;
        it.p.addScaledVector(it.v, dt);
        it.r.addScaledVector(it.w, dt);
        const half = it.s.y * 0.5;
        if (it.p.y < it.floorY + half) {
          it.p.y = it.floorY + half;
          it.v.y *= -0.3;
          it.v.x *= 0.5; it.v.z *= 0.5;
          it.w.multiplyScalar(0.5);
          if (Math.abs(it.v.y) < 0.4) {
            it.rest = true;
            this._sample(it);
            it.r.x = Math.round(it.r.x / Math.PI) * Math.PI;
            it.r.z = Math.round(it.r.z / Math.PI) * Math.PI;
          }
        }
      }
    }
    this.mesh.count = items.length;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const shrink = Math.min(1, it.life / 1.0);
      this._q.setFromEuler(this._e.set(it.r.x, it.r.y, it.r.z));
      this._s.copy(it.s).multiplyScalar(shrink);
      this._m.compose(it.p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
      this.colorAttr.setXYZ(i, it.c.r, it.c.g, it.c.b);
      this.lightAttr.setXYZ(i, it.l.r, it.l.g, it.l.b);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.lightAttr.needsUpdate = true;
  }
}

const _v = new THREE.Vector3();
const _p = new THREE.Vector3();

export class FX {
  constructor(scene) {
    this.add = new PointPool(2500, true, false);   // sparks, glows
    this.alpha = new PointPool(3000, false, true); // dust, smoke, water, blood
    this.debris = new DebrisPool(300);
    this.group = new THREE.Group();
    this.group.add(this.add.points, this.alpha.points, this.debris.mesh);
    scene.add(this.group);
    this.dustTimer = 0;
    this.ambientDust = true;
    this.lights = []; // short-lived point lights {light, life, max, intensity}
    this.lightPool = [];
    // pooled lights never toggle visibility: a changing light count makes three.js swap every lit material
    // to another shader variant (a compile stall the first time each count is seen)
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 6, 2);
      l.userData = { life: 0, max: 1, intensity: 0 };
      this.group.add(l);
      this.lightPool.push(l);
    }
  }

  setPixelScale(h) {
    this.add.mat.uniforms.uScale.value = h * 0.6;
    this.alpha.mat.uniforms.uScale.value = h * 0.6;
  }

  flashLight(pos, color, intensity, life, dist = 6) {
    const l = this.lightPool.find((x) => x.userData.life <= 0) || this.lightPool[0];
    l.position.copy(pos);
    l.color.set(color);
    l.distance = dist;
    l.intensity = intensity;
    l.userData = { life, max: life, intensity };
  }

  sparks(pos, n = 20, dir = null, color = [1, 0.7, 0.3], speed = 4, floorY = -1e9) {
    for (let i = 0; i < n; i++) {
      _v.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.3 + Math.random()));
      if (dir) _v.addScaledVector(dir, speed * 0.6);
      this.add.add(pos, _v, 0.3 + Math.random() * 0.6, 0.06, 0.01, color[0] * 3, color[1] * 3, color[2] * 3, 1, 9.8, 1.2, floorY, 0.35);
    }
  }

  weldSparks(pos, normal) {
    this.sparks(pos, 6, normal, [1, 0.8, 0.45], 3.2);
    this.add.add(pos, _v.set(0, 0, 0), 0.06, 0.5, 0.2, 2.5, 2.8, 4, 1); // arc glow
    this.flashLight(pos, 0x9fc8ff, 6 + Math.random() * 6, 0.08, 5);
  }

  dustBurst(pos, n = 30, color = [0.75, 0.7, 0.55], spread = 1, floorY = -1e9) {
    for (let i = 0; i < n; i++) {
      _v.set((Math.random() - 0.5) * spread, Math.random() * 0.6 * spread, (Math.random() - 0.5) * spread);
      _p.copy(pos).addScaledVector(_v, 0.3);
      this.alpha.add(_p, _v, 1.2 + Math.random() * 1.8, 0.15, 0.6 + Math.random() * 0.4, color[0], color[1], color[2], 0.35, -0.05, 1.5, floorY);
    }
  }

  smoke(pos, n = 1, color = [0.25, 0.25, 0.25], rise = 0.6) {
    for (let i = 0; i < n; i++) {
      _v.set((Math.random() - 0.5) * 0.2, rise * (0.6 + Math.random() * 0.6), (Math.random() - 0.5) * 0.2);
      this.alpha.add(pos, _v, 2 + Math.random() * 1.5, 0.12, 0.9, color[0], color[1], color[2], 0.28, -0.1, 0.4);
    }
  }

  splash(pos, n = 18, floorY = 0) {
    for (let i = 0; i < n; i++) {
      _v.set((Math.random() - 0.5) * 1.6, 1.2 + Math.random() * 1.8, (Math.random() - 0.5) * 1.6);
      this.alpha.add(pos, _v, 0.5 + Math.random() * 0.4, 0.04, 0.02, 0.75, 0.8, 0.75, 0.55, 9.8, 0.3, floorY, 0);
    }
  }

  blood(pos, n = 10, dir = null) {
    for (let i = 0; i < n; i++) {
      _v.set((Math.random() - 0.5), Math.random() * 0.5, (Math.random() - 0.5)).multiplyScalar(2);
      if (dir) _v.addScaledVector(dir, 2);
      this.alpha.add(pos, _v, 0.6 + Math.random() * 0.4, 0.05, 0.03, 0.45, 0.02, 0.02, 0.9, 9.8, 0.2, pos.y - 1.2, 0);
    }
  }

  goo(pos, n = 6) {
    for (let i = 0; i < n; i++) {
      _v.set((Math.random() - 0.5) * 0.4, -Math.random() * 0.4, (Math.random() - 0.5) * 0.4);
      this.alpha.add(pos, _v, 0.9 + Math.random() * 0.6, 0.05, 0.03, 0.02, 0.03, 0.02, 0.95, 9.8, 0.1);
    }
  }

  bubbles(pos, n = 1, spread = 0.05) {
    for (let i = 0; i < n; i++) {
      _p.set(pos.x + (Math.random() - 0.5) * spread, pos.y, pos.z + (Math.random() - 0.5) * spread);
      _v.set((Math.random() - 0.5) * 0.05, 0.35 + Math.random() * 0.25, (Math.random() - 0.5) * 0.05);
      this.alpha.add(_p, _v, 1.4 + Math.random(), 0.02, 0.035, 0.85, 0.95, 1.0, 0.5, 0, 0);
    }
  }

  glow(pos, color = [1, 0.4, 0.2], size = 0.4, life = 0.1) {
    this.add.add(pos, _v.set(0, 0, 0), life, size, size * 0.8, color[0], color[1], color[2], 1);
  }

  chunks(pos, n, color, size = 0.08, speed = 3, floorY = 0, life = 7) {
    for (let i = 0; i < n; i++) {
      _v.set((Math.random() - 0.5) * speed, Math.random() * speed * 0.8, (Math.random() - 0.5) * speed);
      const s = size * (0.5 + Math.random());
      _p.copy(pos).add(_v.clone().multiplyScalar(0.05));
      this.debris.add(_p, _v, new THREE.Vector3(s, s * (0.2 + Math.random() * 0.6), s * (0.6 + Math.random() * 0.8)), color, life + Math.random() * 3, floorY);
    }
  }

  // ambient floating dust motes around a point (camera). light: optional THREE.Color of the local light
  // (motes are only visible where light catches them); they drift on slow air currents.
  ambient(dt, center, density = 1, light = null) {
    if (!this.ambientDust || density <= 0) return;
    this.dustTimer += dt * 34 * density;
    const lr = light ? Math.min(1.6, light.r) : 1, lg = light ? Math.min(1.6, light.g) : 0.95, lb = light ? Math.min(1.6, light.b) : 0.8;
    const lum = (lr * 0.3 + lg * 0.59 + lb * 0.11);
    const vis = Math.min(1, Math.max(0.12, lum * 0.9));
    while (this.dustTimer > 1) {
      this.dustTimer -= 1;
      // spawn in a shell 1.2..4.5 m around the viewer (motes right at the lens read as blurry blobs)
      const ang = Math.random() * Math.PI * 2, rad = 1.2 + Math.random() * 3.3;
      _p.set(center.x + Math.cos(ang) * rad, center.y + (Math.random() - 0.35) * 2.4, center.z + Math.sin(ang) * rad);
      _v.set((Math.random() - 0.5) * 0.05, (Math.random() - 0.45) * 0.02, (Math.random() - 0.5) * 0.05);
      const s = 0.004 + Math.random() * 0.006;
      const a = 0.38 * vis;
      const i = this.alpha.add(_p, _v, 6 + Math.random() * 6, s, s * (0.8 + Math.random() * 0.4), 0.95 * lr, 0.9 * lg, 0.78 * lb, a, -0.0015, 0.02);
      this.alpha.spin[i] += 2; // near-lens fade flag (see VERT)
    }
  }

  update(dt) {
    this.add.update(dt);
    this.alpha.update(dt);
    this.debris.update(dt);
    for (const l of this.lightPool) {
      if (l.userData.life <= 0) continue;
      l.userData.life -= dt;
      if (l.userData.life <= 0) { l.intensity = 0; continue; }
      l.intensity = l.userData.intensity * (l.userData.life / l.userData.max);
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.add.geo.dispose();
    this.alpha.geo.dispose();
  }
}
