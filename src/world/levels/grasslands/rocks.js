// Granite for the Grasslands: sculpted boulders (ellipsoids cut by fracture planes, fbm surface, crevice AO)
// and tall jointed cliff slabs that dress the highland rims. Instanced LOD0/LOD1 meshes around the camera,
// triplanar granite (shared with the terrain texture array) with moss on the tops and a wet tide line at
// the river, and convex-hull colliders for every rock on walkable ground.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RAPIER, GROUPS } from '../../../physics/physics.js';
import { RNG } from '../../../core/rng.js';
import { engine } from '../../../core/engine.js';
import { Noise2 } from './noise.js';
import { CHUNK_M, WATER_Y } from './layout.js';
import { terrainArrays, noiseTexture } from './textures.js';

const N_BOULDER = 4, N_CLIFF = 3;
const LOD_D = 32, LOD_C = 50, FAR_D = 230;

// 3D value-ish noise from two 2D simplex fields
function n3(N, x, y, z) { return (N.n(x + z * 0.71, y - z * 0.43) + N.n(y + x * 0.37, z + 11.3)) * 0.5; }
function fbm3(N, x, y, z, o = 4) {
  let a = 1, s = 0, nn = 0;
  for (let k = 0; k < o; k++) { s += a * n3(N, x, y, z); nn += a; a *= 0.5; x *= 2.07; y *= 2.07; z *= 2.07; }
  return s / nn;
}

function boulderGeometry(v, detail) {
  const rng = new RNG(900 + v * 13);
  const N = new Noise2(1700 + v);
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const sx = rng.range(0.9, 1.2), sy = rng.range(0.55, 0.85), sz = rng.range(0.75, 1.05);
  const planes = [];
  for (let k = 0; k < 5 + rng.int(0, 3); k++) {
    const t = rng.next() * Math.PI * 2, u = rng.range(-0.3, 0.9);
    const n = new THREE.Vector3(Math.cos(t) * Math.sqrt(1 - u * u), u, Math.sin(t) * Math.sqrt(1 - u * u));
    planes.push({ n, d: rng.range(0.62, 0.86) });
  }
  const pos = g.attributes.position;
  const ao = new Float32Array(pos.count);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).normalize();
    let r = 1 + fbm3(N, p.x * 1.3, p.y * 1.3, p.z * 1.3, 3) * 0.2;
    // fracture planes: cut the blob flat (rounded edges)
    for (const pl of planes) {
      const dn = p.dot(pl.n) * r;
      if (dn > pl.d) r -= (dn - pl.d) * 0.88 / Math.max(0.2, p.dot(pl.n));
    }
    const fine = fbm3(N, p.x * 5.1, p.y * 5.1, p.z * 5.1, 3) * 0.035;
    const crack = Math.max(0, 0.06 - Math.abs(N.n(p.x * 3.3 + p.z * 1.1, p.y * 4.1))) * 0.6;
    r += fine - crack;
    let y = p.y * r * sy;
    if (y < -0.35) y = -0.35 + (y + 0.35) * 0.25; // flat seat
    pos.setXYZ(i, p.x * r * sx, y, p.z * r * sz);
    ao[i] = Math.min(1, Math.max(0.35, 0.78 + (r - 1) * 1.6 - crack * 4)) * (0.65 + 0.35 * Math.min(1, (y + 0.35) * 2.5));
  }
  g.setAttribute('aRockAO', new THREE.BufferAttribute(ao, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// tall jointed granite slab: unit footprint x [-0.5, 0.5] (along the cliff), y [0, 1], z [-1, 0.15] (out of face +z)
function cliffGeometry(v, lod) {
  const rng = new RNG(300 + v * 7);
  const N = new Noise2(2300 + v);
  const nx = lod === 0 ? 18 : 7, ny = lod === 0 ? 24 : 9, nz = lod === 0 ? 6 : 2;
  let g = new THREE.BoxGeometry(1, 1, 1.15, nx, ny, nz);
  g.translate(0, 0.5, -0.425);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const ao = new Float32Array(pos.count);
  const cols = [];
  for (let k = 0; k < 5; k++) cols.push(rng.range(-0.5, 0.5));
  const benches = [rng.range(0.25, 0.4), rng.range(0.55, 0.72)];
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const front = z > 0.1 ? 1 : 0;
    // columnar joints: the face is a set of vertical prisms at slightly different depths
    let col = 0;
    for (const c of cols) col = Math.max(col, Math.max(0, 0.05 - Math.abs(x - c)) * 2.2);
    const prism = N.n(Math.floor((x + 0.5) * 5) * 3.1, 1.7) * 0.07;
    // sheeting benches
    let bench = 0;
    for (const b of benches) bench += Math.max(0, 0.04 - Math.abs(y - b)) * 2.5;
    const big = N.n(x * 1.6, y * 1.2) * 0.12 + N.n(x * 4.1 + 3, y * 3.3) * 0.045 + N.n(x * 11, y * 9) * 0.015;
    if (front) z += prism + big - col - bench * 0.6;
    else z += big * 0.5;
    // taper the top and round the vertical edges back into the slope
    const ex = Math.abs(x) * 2;
    z -= Math.pow(ex, 4) * 0.35 + Math.pow(Math.max(0, y - 0.85) * 6.6, 2) * 0.12;
    x *= 1 - Math.max(0, y - 0.9) * 1.5;
    pos.setXYZ(i, x, y, z);
    ao[i] = Math.max(0.35, 1 - col * 5 - bench * 6) * (0.7 + 0.3 * Math.min(1, y * 4));
  }
  g.setAttribute('aRockAO', new THREE.BufferAttribute(ao, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
let _mat = null;
const rockUniforms = { uTime: { value: 0 }, uMoss: { value: 1 }, uGrade: { value: new THREE.Color(1, 1, 1) } };

function rockMaterial() {
  if (_mat) return _mat;
  const arr = terrainArrays();
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  m.name = 'gl_rock';
  m.customProgramCacheKey = () => 'gl_rock_v1';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.tAlb = { value: arr.albedo };
    shader.uniforms.tNrm = { value: arr.normal };
    shader.uniforms.tOrm = { value: arr.orm };
    shader.uniforms.tNoise = { value: noiseTexture() };
    shader.uniforms.uRockScale = { value: 1 / arr.meters[4] };
    Object.assign(shader.uniforms, rockUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aRockAO;
        varying vec3 vWPos; varying vec3 vWNrm; varying float vAO;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 rwp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          rwp = instanceMatrix * rwp;
        #endif
        vWPos = (modelMatrix * rwp).xyz;
        #ifdef USE_INSTANCING
          vWNrm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        #else
          vWNrm = normalize(mat3(modelMatrix) * objectNormal);
        #endif
        vAO = aRockAO;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        precision highp sampler2DArray;
        uniform sampler2DArray tAlb, tNrm, tOrm;
        uniform sampler2D tNoise;
        uniform float uRockScale, uMoss;
        uniform vec3 uGrade;
        varying vec3 vWPos; varying vec3 vWNrm; varying float vAO;
        vec3 gN; float gRough; float gAO;`)
      .replace('#include <map_fragment>', `{
          vec3 N = normalize(vWNrm);
          vec3 bw = pow(abs(N), vec3(5.0)); bw /= (bw.x + bw.y + bw.z);
          vec3 p = vWPos * uRockScale * 1.35;
          vec3 ra = vec3(0.0), ro = vec3(0.0);
          vec3 tx = vec3(0.0, 0.0, 1.0), ty = tx, tz = tx;
          if (bw.x > 0.01) { ra += texture(tAlb, vec3(p.zy, 4.0)).rgb * bw.x; ro += texture(tOrm, vec3(p.zy, 4.0)).rgb * bw.x; tx = texture(tNrm, vec3(p.zy, 4.0)).xyz * 2.0 - 1.0; }
          if (bw.y > 0.01) { ra += texture(tAlb, vec3(p.xz, 4.0)).rgb * bw.y; ro += texture(tOrm, vec3(p.xz, 4.0)).rgb * bw.y; ty = texture(tNrm, vec3(p.xz, 4.0)).xyz * 2.0 - 1.0; }
          if (bw.z > 0.01) { ra += texture(tAlb, vec3(p.xy, 4.0)).rgb * bw.z; ro += texture(tOrm, vec3(p.xy, 4.0)).rgb * bw.z; tz = texture(tNrm, vec3(p.xy, 4.0)).xyz * 2.0 - 1.0; }
          vec3 nx = vec3(tx.xy + N.zy, abs(tx.z) * N.x);
          vec3 ny = vec3(ty.xy + N.xz, abs(ty.z) * N.y);
          vec3 nzz = vec3(tz.xy + N.xy, abs(tz.z) * N.z);
          vec3 rn = normalize(nx.zyx * bw.x + ny.xzy * bw.y + nzz.xyz * bw.z);
          vec4 nz = texture2D(tNoise, vWPos.xz * 0.05 + vWPos.y * 0.02);
          // warm/cool granite variation
          ra *= mix(vec3(1.04, 1.0, 0.95), vec3(0.94, 0.97, 1.02), nz.g);
          // moss & lichen on the tops
          float up = N.y;
          float moss = smoothstep(0.42, 0.85, up + (nz.r - 0.5) * 0.7) * uMoss;
          vec3 mossC = mix(vec3(0.12, 0.17, 0.05), vec3(0.3, 0.33, 0.1), nz.b);
          ra = mix(ra, mossC * (0.75 + 0.5 * texture2D(tNoise, vWPos.xz * 1.7).a), moss * 0.85);
          float lich = smoothstep(0.62, 0.7, texture2D(tNoise, vWPos.xz * 0.6 + vWPos.y * 0.31).b) * (1.0 - moss);
          ra = mix(ra, vec3(0.6, 0.6, 0.42), lich * 0.35);
          // wet tide line at the river
          float wet = 1.0 - smoothstep(${(WATER_Y + 0.02).toFixed(3)}, ${(WATER_Y + 0.35).toFixed(3)}, vWPos.y);
          ra *= 1.0 - wet * 0.45;
          gRough = mix(ro.g, 0.25, wet) + moss * 0.1;
          gAO = ro.r * vAO;
          gN = rn;
          diffuseColor.rgb = ra * uGrade;
        }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(gRough, 0.05, 1.0);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(gN, 0.0)).xyz);')
      .replace('#include <aomap_fragment>', `{
          float ambientOcclusion = clamp(gAO * 1.1, 0.0, 1.0);
          reflectedLight.indirectDiffuse *= ambientOcclusion;
          reflectedLight.indirectSpecular *= ambientOcclusion;
          reflectedLight.directDiffuse *= mix(1.0, ambientOcclusion, 0.5);
        }`);
  };
  _mat = m;
  return m;
}

// ---------------------------------------------------------------------------
export class RockSystem {
  constructor(level) {
    this.level = level;
    this.gw = level.gw;
    this.group = new THREE.Group();
    this.group.name = 'rocks';
    const mat = rockMaterial();
    this.mat = mat;
    const low = engine.qualityName === 'low';
    this.boulders = [];
    for (let v = 0; v < N_BOULDER; v++) this.boulders.push([boulderGeometry(v, low ? 5 : 8), boulderGeometry(v, 2)]);
    this.cliffGeos = [];
    for (let v = 0; v < N_CLIFF; v++) this.cliffGeos.push([cliffGeometry(v, 0), cliffGeometry(v, 1)]);
    // hull points (LOD1) for colliders
    this.hulls = this.boulders.map((b) => b[1].attributes.position.array);
    this.cliffHulls = this.cliffGeos.map((c) => c[1].attributes.position.array);
    const mk = (geo, cap, name) => {
      const m = new THREE.InstancedMesh(geo, mat, cap);
      m.count = 0;
      m.frustumCulled = false;
      // only the near LOD casts: the sun's shadow box ends where LOD1 begins
      m.castShadow = name.endsWith('_0');
      m.receiveShadow = true;
      m.name = name;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
      return m;
    };
    this.bMesh = this.boulders.map((b, v) => [mk(b[0], 260, `rock_b${v}_0`), mk(b[1], 900, `rock_b${v}_1`)]);
    this.cMesh = this.cliffGeos.map((c, v) => [mk(c[0], 160, `rock_c${v}_0`), mk(c[1], 700, `rock_c${v}_1`)]);
    this.lastCam = new THREE.Vector3(1e9, 0, 1e9);
    this.refreshT = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this.cliffQueue = [];
  }

  // all rock placements of a chunk with transforms resolved
  _chunkRocks(cx, cz, wantCliffs, exact = false) {
    const v = this.level.variantFn(cx, cz);
    const sc = this.gw.scatter(cx, cz, v);
    if (!sc._rockT || (exact && !sc._rockExact)) {
      sc._rockT = [];
      sc._rockExact = exact;
      sc._cliffT = null;
      for (const r of sc.rocks) {
        const g = this.gw.placeY(r.x, r.z, exact, this.level.variantFn);
        const sink = r.type === 'river' ? 0.25 : r.type === 'outcrop' ? 0.35 : 0.18;
        const s = r.r;
        const sy = r.type === 'outcrop' ? s * 0.8 : r.type === 'river' ? s * 0.75 : s * 0.85;
        sc._rockT.push({ kind: 'b', v: r.v % N_BOULDER, x: r.x, y: g - sink * s, z: r.z, rx: r.tilt, ry: r.rot, rz: r.tilt * 0.6, sx: s, sy, sz: s, col: r.type !== 'outcrop', type: r.type });
      }
    }
    if (wantCliffs && !sc._cliffT) {
      sc._cliffT = [];
      for (const c of this.gw.cliffs(cx, cz, v)) {
        // foot of the face on the valley floor, top a little above the rim
        const fx = c.x + c.nx * 1.4, fz = c.z + c.nz * 1.4;
        const foot = this.gw.placeY(fx, fz, exact, this.level.variantFn);
        const top = this.gw.height(c.x - c.nx * 3.5, c.z - c.nz * 3.5);
        const hgt = Math.max(2.5, top - foot + 0.6);
        const w = c.r * 1.7;
        sc._cliffT.push({ kind: 'c', v: c.v % N_CLIFF, x: c.x + c.nx * 0.55, y: foot - 0.6, z: c.z + c.nz * 0.55, rx: 0, ry: Math.atan2(c.nx, c.nz), rz: c.tilt * 0.15, sx: w, sy: hgt + 0.6, sz: Math.min(4.5, 1.6 + hgt * 0.2), col: true });
      }
    }
    return sc;
  }

  update(dt, cam) {
    this.refreshT -= dt;
    if (cam.distanceTo(this.lastCam) < 5 && this.refreshT > 0) return;
    this.refreshT = 1.0;
    this.lastCam.copy(cam);
    const counts = { b: this.bMesh.map(() => [0, 0]), c: this.cMesh.map(() => [0, 0]) };
    const R = FAR_D;
    const c0x = Math.floor((cam.x - R) / CHUNK_M), c1x = Math.floor((cam.x + R) / CHUNK_M);
    const c0z = Math.floor((cam.z - R) / CHUNK_M), c1z = Math.floor((cam.z + R) / CHUNK_M);
    const m = this._m, q = this._q, e = this._e, s = this._s, p = this._p;
    const t0 = performance.now();
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      const dx = Math.max(cx * CHUNK_M - cam.x, 0, cam.x - (cx + 1) * CHUNK_M), dz = Math.max(cz * CHUNK_M - cam.z, 0, cam.z - (cz + 1) * CHUNK_M);
      if (dx * dx + dz * dz > R * R) continue;
      // cliff placement needs the classification grid: limit how many new chunks per refresh
      const sc0 = this.gw.scatter(cx, cz, this.level.variantFn(cx, cz));
      const allowCliff = !!sc0._cliffT || this.force || performance.now() - t0 < 6;
      const sc = this._chunkRocks(cx, cz, allowCliff, dx * dx + dz * dz < 70 * 70);
      if (!allowCliff) this.refreshT = Math.min(this.refreshT, 0.15);
      const lists = [sc._rockT, sc._cliffT || []];
      for (const list of lists) for (const r of list) {
        const d = Math.hypot(r.x - cam.x, r.z - cam.z);
        if (d > R) continue;
        const lod = d < (r.kind === 'b' ? LOD_D : LOD_C) ? 0 : 1;
        if (r.kind === 'b' && lod === 1 && r.sx < 0.5 && d > 90) continue;
        const meshes = r.kind === 'b' ? this.bMesh[r.v] : this.cMesh[r.v];
        const cnt = r.kind === 'b' ? counts.b[r.v] : counts.c[r.v];
        if (cnt[lod] >= meshes[lod].instanceMatrix.count) continue;
        e.set(r.rx, r.ry, r.rz);
        q.setFromEuler(e);
        s.set(r.sx, r.sy, r.sz);
        p.set(r.x, r.y, r.z);
        m.compose(p, q, s);
        meshes[lod].setMatrixAt(cnt[lod]++, m);
      }
    }
    const fin = (arr, cnt) => arr.forEach((lods, v) => lods.forEach((mesh, lod) => { mesh.count = cnt[v][lod]; mesh.instanceMatrix.needsUpdate = true; }));
    fin(this.bMesh, counts.b);
    fin(this.cMesh, counts.c);
  }

  invalidate() { this.lastCam.set(1e9, 0, 1e9); }

  // convex-hull colliders for a gameplay chunk's rocks on (or next to) walkable ground
  colliders(physics, cx, cz) {
    const out = [];
    const sc = this._chunkRocks(cx, cz, true, true);
    const m = this._m, q = this._q, e = this._e, s = this._s, p = this._p;
    const v3 = new THREE.Vector3();
    for (const list of [sc._rockT, sc._cliffT]) for (const r of list) {
      if (!r.col) continue;
      const src = r.kind === 'b' ? this.hulls[r.v] : this.cliffHulls[r.v];
      e.set(r.rx, r.ry, r.rz); q.setFromEuler(e); s.set(r.sx, r.sy, r.sz); p.set(r.x, r.y, r.z);
      m.compose(p, q, s);
      const pts = new Float32Array(src.length);
      for (let i = 0; i < src.length; i += 3) {
        v3.set(src[i], src[i + 1], src[i + 2]).applyMatrix4(m);
        pts[i] = v3.x - r.x; pts[i + 1] = v3.y - r.y; pts[i + 2] = v3.z - r.z;
      }
      const desc = RAPIER.ColliderDesc.convexHull(pts);
      if (!desc) continue;
      desc.setTranslation(r.x, r.y, r.z).setCollisionGroups(GROUPS.static).setFriction(0.85);
      const c = physics.world.createCollider(desc);
      physics.setUserData(c, { kind: 'static', surface: 'rock' });
      out.push(c);
    }
    return out;
  }

  dispose() {
    this.group.removeFromParent();
    for (const b of this.boulders) for (const g of b) g.dispose();
    for (const c of this.cliffGeos) for (const g of c) g.dispose();
  }
}
