// Procedural conifers for the Grasslands: spruce, fir, pine and young trees built from a tapered,
// root-flared bark trunk and whorls of drooping V-folded needle-spray cards (alpha), rendered as
// instanced LOD0 / LOD1 meshes near the camera (wind sway, back-lit translucency, dithered LOD
// cross-fades) and as baked, relit impostor billboards out to the fog line.
import * as THREE from 'three';
import * as Synth from '../../../gfx/texsynth.js';
import { engine } from '../../../core/engine.js';
import { RNG } from '../../../core/rng.js';
import { RAPIER, GROUPS } from '../../../physics/physics.js';
import { needleCard, noiseTexture, texSize } from './textures.js';
import { CHUNK_M } from './layout.js';

// model height H (instances scale to the scattered height)
export const SPECIES = [
  { name: 'spruce', H: 26, r0: 0.42, crown0: 0.1, whorl: 0.5, per: 7, L: 3.9, shape: 'cone', droop: -0.6, tip: 0.5, card: 0, W: 2.1, tint: [0.9, 1.0, 0.92], bark: 0 },
  { name: 'fir', H: 20, r0: 0.36, crown0: 0.06, whorl: 0.46, per: 7, L: 3.2, shape: 'fir', droop: -0.2, tip: 0.38, card: 1, W: 2.0, tint: [0.86, 0.97, 0.9], bark: 0 },
  { name: 'pine', H: 24, r0: 0.4, crown0: 0.56, whorl: 0.72, per: 6, L: 3.4, shape: 'round', droop: 0.1, tip: 0.3, card: 2, W: 2.2, tint: [0.98, 1.0, 0.86], bark: 1 },
  { name: 'young', H: 7, r0: 0.11, crown0: 0.03, whorl: 0.32, per: 6, L: 1.6, shape: 'cone', droop: -0.25, tip: 0.35, card: 0, W: 1.15, tint: [0.95, 1.06, 0.92], bark: 0 },
];

const NEAR0 = 28, BAND = 6, NEAR1 = 62, BAND1 = 10, FAR_IMP = 380;

// ---------------------------------------------------------------------------
// geometry accumulation
class Acc {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.w = []; this.i = []; this.v = 0; }
  vert(x, y, z, nx, ny, nz, u, v, ao, hf, flex) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v); this.c.push(ao, ao, ao); this.w.push(hf, flex);
    return this.v++;
  }
  tri(a, b, c) { this.i.push(a, b, c); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.w, 2));
    g.setIndex(this.v > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

function crownProfile(sp, t) {
  // t: 0 bottom of the crown .. 1 top ; returns relative branch length
  if (sp.shape === 'round') return Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.88 + 0.1)), 0.75) * 0.95 + 0.05;
  if (sp.shape === 'fir') return Math.pow(1 - t, 0.85) * 0.92 + 0.08;
  return Math.pow(1 - t, 1.0) * 0.9 + 0.1 + 0.08 * Math.sin(t * 9.0);
}

function trunkRadius(sp, y) {
  const H = sp.H;
  const base = sp.r0 * Math.pow(Math.max(0.02, 1 - y / (H * 1.02)), 0.95);
  return base + sp.r0 * 0.55 * Math.exp(-Math.max(0, y) / 0.5);
}

function buildTrunk(acc, sp, lod, rng) {
  const segs = lod === 0 ? 11 : 6, rings = lod === 0 ? 16 : 6;
  const H = sp.H, y0 = -0.8, y1 = H * 0.985;
  const barkM = 1.0;
  const bendA = rng.range(-1, 1) * 0.004 * H, bendB = rng.range(-1, 1) * 0.004 * H;
  const buttPh = rng.next() * 6.28;
  const circ = Math.max(1, Math.round((2 * Math.PI * sp.r0) / barkM * 1.5));
  const ring0 = acc.v;
  for (let r = 0; r <= rings; r++) {
    const t = Math.pow(r / rings, 1.35);
    const y = y0 + (y1 - y0) * t;
    const rad = trunkRadius(sp, y);
    const ox = Math.sin((y / H) * Math.PI) * bendA, oz = Math.sin((y / H) * Math.PI * 1.3) * bendB;
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const butt = 1 + 0.32 * Math.exp(-Math.max(0, y) / 0.55) * Math.pow(Math.max(0, Math.cos(a * 5 + buttPh)), 2);
      const rr = rad * butt;
      const nx = Math.sin(a), nz = Math.cos(a);
      const hf = Math.max(0, y) / H;
      acc.vert(ox + nx * rr, y, oz + nz * rr, nx, 0.15, nz, (s / segs) * circ, y / barkM, 0.55 + 0.45 * Math.min(1, Math.max(0, y) / 2.5), hf, 0);
    }
  }
  for (let r = 0; r < rings; r++) for (let s = 0; s < segs; s++) {
    const a = ring0 + r * (segs + 1) + s, b = a + 1, c = a + segs + 1, d = c + 1;
    acc.tri(a, c, b); acc.tri(b, c, d);
  }
  // dead branch stubs on the bare lower trunk (LOD0)
  if (lod === 0) {
    const yTop = sp.H * sp.crown0;
    const n = Math.floor(yTop / 0.7);
    for (let k = 0; k < n; k++) {
      if (rng.next() < 0.45) continue;
      const y = 1.6 + rng.next() * Math.max(0.1, yTop - 1.6);
      if (y > yTop) continue;
      const a = rng.next() * Math.PI * 2;
      const len = 0.25 + rng.next() * 0.6;
      const dx = Math.sin(a), dz = Math.cos(a);
      const r0 = trunkRadius(sp, y) * 0.95;
      const rr = 0.025 + rng.next() * 0.02;
      const b0 = acc.v;
      const tipY = y - len * 0.25;
      for (let q = 0; q < 4; q++) {
        const qa = (q / 4) * Math.PI * 2;
        const px = -dz * Math.cos(qa) * rr, pz = dx * Math.cos(qa) * rr, py = Math.sin(qa) * rr;
        acc.vert(dx * r0 + px, y + py, dz * r0 + pz, px / rr, py / rr, pz / rr, q * 0.25, y, 0.6, y / sp.H, 0);
      }
      const tip = acc.vert(dx * (r0 + len), tipY, dz * (r0 + len), dx, 0, dz, 0.5, y + len, 0.6, y / sp.H, 0.1);
      for (let q = 0; q < 4; q++) acc.tri(b0 + q, b0 + ((q + 1) % 4), tip);
    }
  }
}

function buildFoliage(acc, sp, lod, rng) {
  const H = sp.H;
  const yStart = H * sp.crown0 + (sp.name === 'young' ? 0.15 : 1.0);
  const whorl = sp.whorl * (lod === 0 ? 1 : 2.4);
  const per = lod === 0 ? sp.per : Math.max(4, sp.per - 2);
  const segs = lod === 0 ? 3 : 1;
  const Wmul = lod === 0 ? 1 : 1.6;
  const yEnd = H - 0.45;
  const fold = 0.42; // V-fold of each spray (radians above horizontal)
  let rot = rng.next() * 6.28;
  const up = new THREE.Vector3(0, 1, 0);
  const P = new THREE.Vector3(), D = new THREE.Vector3(), S = new THREE.Vector3(), Wg = new THREE.Vector3(), Nf = new THREE.Vector3(), R = new THREE.Vector3();
  for (let y = yStart; y < yEnd; y += whorl * (0.8 + rng.next() * 0.4)) {
    const t = (y - yStart) / (yEnd - yStart);
    const Lw = sp.L * crownProfile(sp, t) * (lod === 0 ? 1 : 1.08);
    const n = per + (rng.next() < 0.3 ? 1 : 0) - (t > 0.85 ? 1 : 0);
    rot += 2.39996;
    const inner = lod === 0 ? Math.ceil(n * 0.6) : 0;
    for (let b = 0; b < n + inner; b++) {
      const isIn = b >= n;
      const a = rot + ((isIn ? b - n + 0.5 : b) / (isIn ? inner : n)) * Math.PI * 2 + rng.range(-0.25, 0.25);
      const L = Lw * rng.range(0.8, 1.12) * (isIn ? 0.55 : 1);
      if (L < 0.12) continue;
      const hx = Math.sin(a), hz = Math.cos(a);
      const r0 = trunkRadius(sp, y) * 0.8;
      const p0 = sp.droop * (0.6 + 0.6 * (1 - t)) + rng.range(-0.12, 0.12) - (isIn ? 0.35 : 0);
      const p1 = p0 + sp.tip * (0.6 + rng.next() * 0.6);
      const W = sp.W * Wmul * (0.55 + 0.45 * Math.min(1, L / sp.L)) * rng.range(0.85, 1.12) * (isIn ? 0.8 : 1);
      // centreline
      const pts = [];
      P.set(hx * r0, y, hz * r0);
      pts.push(P.clone());
      for (let k = 1; k <= segs; k++) {
        const u = k / segs;
        const pa = p0 + (p1 - p0) * (u - 0.5 / segs);
        D.set(hx * Math.cos(pa), Math.sin(pa), hz * Math.cos(pa));
        P.addScaledVector(D, L / segs);
        pts.push(P.clone());
      }
      // two wings (V-fold opening upward)
      for (const side of [1, -1]) {
        const base = acc.v;
        for (let k = 0; k <= segs; k++) {
          const u = k / segs;
          const c = pts[k];
          const dir = (k < segs ? D.subVectors(pts[k + 1], c) : D.subVectors(c, pts[k - 1])).normalize();
          S.crossVectors(dir, up).normalize().multiplyScalar(side);
          Wg.copy(S).multiplyScalar(Math.cos(fold)).addScaledVector(up, Math.sin(fold));
          const wHalf = (W * 0.5) * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, 0.25 + u * 0.75)));
          // rounded-crown normal: blend the wing's face normal with the radial direction
          Nf.crossVectors(dir, Wg).normalize();
          if (Nf.y < 0) Nf.negate();
          R.set(c.x, (c.y - H * 0.55) * 0.35 + 0.6, c.z).normalize();
          const nn = Nf.clone().multiplyScalar(0.35).addScaledVector(R, 0.65).normalize();
          const ao = (0.42 + 0.58 * Math.min(1, u * 1.2)) * (0.72 + 0.28 * t);
          const hf = c.y / H;
          const flex = u * Math.min(1, L / sp.L);
          acc.vert(c.x, c.y, c.z, nn.x, nn.y, nn.z, 0.5, u, ao * 0.9, hf, flex * 0.8);
          acc.vert(c.x + Wg.x * wHalf, c.y + Wg.y * wHalf, c.z + Wg.z * wHalf, nn.x, nn.y, nn.z, side > 0 ? 1 : 0, u, ao, hf, flex);
        }
        for (let k = 0; k < segs; k++) {
          const a0 = base + k * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3;
          if (side > 0) { acc.tri(a0, a1, b0); acc.tri(a1, b1, b0); } else { acc.tri(a0, b0, a1); acc.tri(a1, b0, b1); }
        }
      }
    }
  }
  // leader: crossed vertical sprays at the top
  for (const a of [0, Math.PI / 2]) {
    const hx = Math.sin(a) * 0.32 * (sp.W / 1.3), hz = Math.cos(a) * 0.32 * (sp.W / 1.3);
    const yb = H - 1.6, yt = H + 0.25;
    const b = acc.v;
    acc.vert(-hx, yb, -hz, 0, 0.6, 0, 0, 0, 0.7, yb / H, 0.4);
    acc.vert(hx, yb, hz, 0, 0.6, 0, 1, 0, 0.7, yb / H, 0.4);
    acc.vert(-hx, yt, -hz, 0, 1, 0, 0, 1, 1, 1, 1);
    acc.vert(hx, yt, hz, 0, 1, 0, 1, 1, 1, 1, 1);
    acc.tri(b, b + 1, b + 2); acc.tri(b + 1, b + 3, b + 2);
  }
}

// ---------------------------------------------------------------------------
// materials
const shared = {
  uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.7, 0.35) }, tGust: { value: null },
  uTrans: { value: new THREE.Color(0.55, 0.62, 0.3) },
};

const WIND_GLSL = /* glsl */`
  uniform float uTime; uniform vec2 uWind; uniform sampler2D tGust;
  attribute vec2 aWind;
  varying float vFadeIn; varying float vFadeOut;
  uniform vec4 uFade;
  vec3 windOffset(vec3 origin, float hf, float flex, float y) {
    float gust = texture2D(tGust, origin.xz * 0.0035 + uWind * uTime * 0.012).r;
    float str = length(uWind) * (0.25 + 1.1 * gust * gust);
    vec2 dir = uWind / max(length(uWind), 1e-4);
    float ph = dot(origin.xz, vec2(0.131, 0.173));
    float sway = (sin(uTime * 0.83 + ph) * 0.6 + sin(uTime * 1.61 + ph * 1.7) * 0.3 + 0.35) * str;
    float trunk = hf * hf * sway * 0.55;
    float flut = flex * str * (sin(uTime * 3.7 + ph * 5.0 + y * 0.9) * 0.08 + sin(uTime * 7.1 + y * 2.3) * 0.03);
    return vec3(dir.x, 0.0, dir.y) * (trunk + flut) + vec3(0.0, flut * 0.7 - trunk * hf * 0.04, 0.0);
  }`;

function patchTree(mat, kind) {
  mat.customProgramCacheKey = () => `gl_tree_${kind}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uWind = shared.uWind;
    shader.uniforms.tGust = shared.tGust;
    shader.uniforms.uTrans = shared.uTrans;
    shader.uniforms.uFade = mat.userData.fade;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + WIND_GLSL)
      .replace('#include <project_vertex>', `
        vec4 wpos = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wpos = instanceMatrix * wpos;
          vec3 origin = instanceMatrix[3].xyz;
        #else
          vec3 origin = vec3(0.0);
        #endif
        wpos.xyz += windOffset(origin, aWind.x, aWind.y, wpos.y - origin.y);
        float camD = distance(origin.xz, cameraPosition.xz);
        vFadeIn = uFade.y > 0.0 ? smoothstep(uFade.x, uFade.y, camD) : 1.0;
        vFadeOut = uFade.w > 0.0 ? 1.0 - smoothstep(uFade.z, uFade.w, camD) : 1.0;
        vec4 mvPosition = modelViewMatrix * wpos;
        gl_Position = projectionMatrix * mvPosition;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vFadeIn; varying float vFadeOut;
        uniform vec3 uTrans;
        float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        { float dn = ign(gl_FragCoord.xy); if (dn > vFadeOut || (1.0 - dn) > vFadeIn) discard; }`);
    if (kind === 'foliage') {
      shader.fragmentShader = shader.fragmentShader
        // keep the rounded-crown normals on both faces of the cards
        .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
        .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
          void RE_Direct_Foliage(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
            RE_Direct_Physical(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
            float back = pow(saturate(dot(geometryViewDir, -directLight.direction)), 4.0);
            float wrap = saturate(dot(geometryNormal, directLight.direction) * 0.5 + 0.5);
            reflectedLight.directDiffuse += directLight.color * material.diffuseColor * uTrans * (back * 1.6 + 0.12 * wrap);
          }
          #undef RE_Direct
          #define RE_Direct RE_Direct_Foliage`);
    }
  };
  return mat;
}

let _mats = null;
function materials() {
  if (_mats) return _mats;
  shared.tGust.value = noiseTexture();
  const size = engine.qualityName === 'high' ? 1024 : 512;
  const barkA = Synth.pbr('bark', { c0: 0x5c493c, c1: 0x231a14, c2: 0x857a6e, p0: [9, 3, 0.6, 0], size, meters: 1 });
  const barkB = Synth.pbr('bark', { c0: 0x7a5a44, c1: 0x2e1d14, c2: 0x9a7052, p0: [6, 2, 0.9, 0], size, meters: 1, seed: 7 });
  const bark = (t, color) => {
    const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.orm, aoMap: t.orm, color, roughness: 1, metalness: 0, vertexColors: true });
    m.normalScale.set(1.4, 1.4);
    m.userData.fade = { value: new THREE.Vector4() };
    return m;
  };
  const leaf = (k, tint) => {
    const c = needleCard(k);
    const m = new THREE.MeshStandardMaterial({ map: c.map, alphaTest: 0.38, side: THREE.DoubleSide, roughness: 0.78, metalness: 0, vertexColors: true, color: new THREE.Color(tint[0], tint[1], tint[2]) });
    m.userData.fade = { value: new THREE.Vector4() };
    return m;
  };
  _mats = { barkA: barkA, barkB: barkB, bark, leaf };
  return _mats;
}

// ---------------------------------------------------------------------------
// Impostor atlas: 4 species rows x 4 frames (the LOD0 model turned 90° each frame)
const FRAMES = 4;

function bakeImpostors(models) {
  const r = engine.renderer;
  const fw = engine.qualityName === 'low' ? 128 : 192, fh = engine.qualityName === 'low' ? 320 : 512;
  const W = fw * FRAMES, Hh = fh * SPECIES.length;
  const mk = () => {
    const rt = new THREE.WebGLRenderTarget(W, Hh, { depthBuffer: true, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    rt.texture.generateMipmaps = true;
    return rt;
  };
  const albRT = mk(), nrmRT = mk();
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -50, 50);
  const bakeMat = (src, mode) => new THREE.ShaderMaterial({
    uniforms: { map: { value: src.map }, tint: { value: src.color.clone() }, mode: { value: mode }, alphaTest: { value: src.alphaTest || 0.0 } },
    vertexShader: `attribute vec3 color; varying vec2 vUv; varying vec3 vN; varying vec3 vC; void main(){ vUv = uv; vC = color; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 tint; uniform float mode; uniform float alphaTest; varying vec2 vUv; varying vec3 vN; varying vec3 vC;
      void main(){ vec4 t = texture2D(map, vUv); if (alphaTest > 0.0 && t.a < alphaTest) discard;
        if (mode < 0.5) gl_FragColor = vec4(t.rgb * tint * vC, 1.0);
        else { vec3 n = normalize(vN); gl_FragColor = vec4(n * 0.5 + 0.5, 1.0); } }`,
    side: THREE.DoubleSide,
  });
  const prevRT = r.getRenderTarget();
  const prevClear = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
  const dims = [];
  for (const [mode, rt] of [[0, albRT], [1, nrmRT]]) {
    r.setRenderTarget(rt);
    r.setClearColor(mode === 0 ? 0x26341c : 0x8080ff, 0);
    r.clear(true, true, true);
    SPECIES.forEach((sp, si) => {
      const m = models[si][0];
      const R = sp.L + sp.r0 + 0.6;
      dims[si] = [R, sp.H + 0.9];
      const tr = new THREE.Mesh(m.trunk, bakeMat(m.trunkMat, mode));
      const fo = new THREE.Mesh(m.foliage, bakeMat(m.leafMat, mode));
      const g = new THREE.Group();
      g.add(tr, fo);
      scene.add(g);
      for (let f = 0; f < FRAMES; f++) {
        g.rotation.y = (f / FRAMES) * Math.PI * 2;
        cam.left = -R; cam.right = R; cam.bottom = -0.6; cam.top = sp.H + 0.3;
        cam.position.set(0, 0, 20); cam.lookAt(0, 0, 0);
        cam.updateProjectionMatrix();
        rt.viewport.set(f * fw, si * fh, fw, fh);
        rt.scissor.set(f * fw, si * fh, fw, fh);
        rt.scissorTest = true;
        r.setRenderTarget(rt);
        r.render(scene, cam);
      }
      scene.remove(g);
      tr.material.dispose(); fo.material.dispose();
    });
    rt.scissorTest = false;
    rt.viewport.set(0, 0, W, Hh);
    rt.scissor.set(0, 0, W, Hh);
  }
  r.setRenderTarget(prevRT);
  r.setClearColor(prevClear, prevAlpha);
  return { alb: albRT, nrm: nrmRT, dims };
}

const IMP_VS = /* glsl */`
  attribute vec4 iPos;  // x, y, z, scale
  attribute vec4 iVar;  // species, frame, tint, flip
  uniform vec2 uDims[4];
  uniform vec4 uFade;
  varying vec2 vUv; varying vec3 vRight; varying vec3 vFwd; varying float vFade; varying float vTint; varying float vFlip; varying float vH;
  void main(){
    int sp = int(iVar.x + 0.5);
    vec2 dims = uDims[sp];
    vec3 base = iPos.xyz; float s = iPos.w;
    vec3 toCam = cameraPosition - base;
    float d = length(toCam.xz);
    vec3 fwd = normalize(vec3(toCam.x, 0.0, toCam.z) + vec3(1e-4, 0.0, 0.0));
    vec3 right = vec3(fwd.z, 0.0, -fwd.x);
    vFade = smoothstep(uFade.x, uFade.y, d) * (1.0 - smoothstep(uFade.z, uFade.w, d));
    float flip = iVar.w > 0.5 ? -1.0 : 1.0;
    vec3 p = base + right * position.x * dims.x * s + vec3(0.0, (position.y * dims.y - 0.6) * s, 0.0);
    if (vFade <= 0.0) p = vec3(0.0, -1e5, 0.0);
    vUv = vec2((iVar.y + (position.x * flip * 0.5 + 0.5)) / 4.0, (iVar.x + position.y) / 4.0);
    vRight = right * flip; vFwd = fwd; vTint = iVar.z; vFlip = flip; vH = position.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const IMP_FS = /* glsl */`
  uniform sampler2D tAlb, tNrm;
  uniform vec3 uSunDir, uSunCol, uSkyUp, uSkyDown, uTrans;
  varying vec2 vUv; varying vec3 vRight; varying vec3 vFwd; varying float vFade; varying float vTint; varying float vFlip; varying float vH;
  float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  void main(){
    vec4 a = texture2D(tAlb, vUv);
    if (a.a < 0.45) discard;
    if ((1.0 - ign(gl_FragCoord.xy)) > vFade) discard;
    vec3 nb = texture2D(tNrm, vUv).xyz * 2.0 - 1.0;
    vec3 n = normalize(vRight * nb.x + vec3(0.0, 1.0, 0.0) * nb.y + vFwd * nb.z);
    float ndl = max(dot(n, uSunDir), 0.0);
    vec3 amb = mix(uSkyDown, uSkyUp, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
    float back = pow(max(dot(-vFwd, uSunDir), 0.0), 4.0);
    vec3 alb = a.rgb * (0.92 + vTint * 0.16);
    vec3 col = alb * (amb + uSunCol * (ndl * 0.9)) + alb * uSunCol * uTrans * back * 1.4;
    gl_FragColor = vec4(col, 1.0);
  }`;

// ---------------------------------------------------------------------------
export class TreeSystem {
  constructor(level) {
    this.level = level;
    this.gw = level.gw;
    this.group = new THREE.Group();
    this.group.name = 'trees';
    const M = materials();
    this.models = SPECIES.map((sp, si) => [0, 1].map((lod) => {
      const rng = new RNG(4100 + si * 31 + lod);
      const ta = new Acc(), fa = new Acc();
      buildTrunk(ta, sp, lod, rng);
      buildFoliage(fa, sp, lod, new RNG(5100 + si * 17));
      const trunkMat = patchTree(M.bark(sp.bark ? M.barkB : M.barkA, 0xffffff), 'trunk');
      const leafMat = patchTree(M.leaf(SPECIES[si].card, sp.tint), 'foliage');
      return { trunk: ta.build(), foliage: fa.build(), trunkMat, leafMat };
    }));
    // near instanced meshes
    this.cap = [500, 1600];
    this.near = this.models.map((lods, si) => lods.map((m, lod) => {
      const fade = lod === 0 ? new THREE.Vector4(0, 0, NEAR0, NEAR0 + BAND) : new THREE.Vector4(NEAR0, NEAR0 + BAND, NEAR1, NEAR1 + BAND1);
      m.trunkMat.userData.fade.value.copy(fade);
      m.leafMat.userData.fade.value.copy(fade);
      const t = new THREE.InstancedMesh(m.trunk, m.trunkMat, this.cap[lod]);
      const f = new THREE.InstancedMesh(m.foliage, m.leafMat, this.cap[lod]);
      for (const x of [t, f]) {
        x.count = 0;
        x.frustumCulled = false;
        x.castShadow = true;
        x.receiveShadow = true;
        x.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        x.name = `tree_${SPECIES[si].name}_${lod}`;
        this.group.add(x);
      }
      return { trunk: t, foliage: f };
    }));
    // impostors
    this.imp = bakeImpostors(this.models);
    this.impUniforms = {
      tAlb: { value: this.imp.alb.texture }, tNrm: { value: this.imp.nrm.texture },
      uDims: { value: this.imp.dims.map(([r, h]) => new THREE.Vector2(r, h)) },
      uFade: { value: new THREE.Vector4(NEAR1, NEAR1 + BAND1, FAR_IMP - 40, FAR_IMP) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() },
      uSkyUp: { value: new THREE.Color() }, uSkyDown: { value: new THREE.Color() }, uTrans: shared.uTrans,
    };
    this.impMat = new THREE.ShaderMaterial({ uniforms: this.impUniforms, vertexShader: IMP_VS, fragmentShader: IMP_FS });
    this.quad = new THREE.BufferGeometry();
    this.quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
    this.quad.setIndex([0, 1, 2, 1, 3, 2]);
    this.blocks = new Map(); // 192 m blocks of impostors
    this.lastCam = new THREE.Vector3(1e9, 0, 1e9);
    this.refreshT = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this.blockSize = CHUNK_M * 8;
  }

  // trees of a chunk with ground heights resolved
  _chunkTrees(cx, cz, exact = false) {
    const v = this.level.variantFn(cx, cz);
    const sc = this.gw.scatter(cx, cz, v);
    // near chunks get the exact (physics) surface, far ones the analytic height; upgraded when they come close
    if (!sc._treeY || (exact && sc._treeY !== 2)) {
      for (const t of sc.trees) t.y = this.gw.placeY(t.x, t.z, exact, this.level.variantFn) - 0.05;
      sc._treeY = exact ? 2 : 1;
    }
    return sc.trees;
  }

  update(dt, cam, sky) {
    shared.uTime.value += dt;
    const S = sky.state;
    // wind: stronger and gustier as reality degrades
    const inst = this.level.game.day.instability?.() || 0;
    const ws = 0.55 + inst * 1.1 + (S.sick > 0.5 ? 0.6 : 0);
    shared.uWind.value.set(0.82 * ws, 0.45 * ws);
    shared.uTrans.value.copy(S.sun).multiplyScalar(0.32).multiply(new THREE.Color(0.75, 0.9, 0.42));
    // impostor lighting matches the IBL + sun
    const U = this.impUniforms;
    U.uSunDir.value.copy(sky.uniforms.uSunDir.value);
    U.uSunCol.value.copy(sky.sun.color).multiplyScalar(sky.sun.intensity);
    U.uSkyUp.value.copy(S.zen).lerp(S.hor, 0.55).multiplyScalar(0.95 * engine.scene.environmentIntensity);
    U.uSkyDown.value.copy(S.fog).multiplyScalar(0.28 * engine.scene.environmentIntensity);
    this.refreshT -= dt;
    const day = this.level.game.day.day;
    if (day !== this.day) { this.day = day; this.refreshT = 0; }
    if (cam.distanceTo(this.lastCam) > 3 || this.refreshT <= 0) {
      this.refreshT = 0.6;
      this.lastCam.copy(cam);
      this._rebuildNear(cam);
    }
    this._updateBlocks(cam);
  }

  _rebuildNear(cam) {
    const counts = this.near.map(() => [0, 0]);
    const R = NEAR1 + BAND1 + 4;
    const c0x = Math.floor((cam.x - R) / CHUNK_M), c1x = Math.floor((cam.x + R) / CHUNK_M);
    const c0z = Math.floor((cam.z - R) / CHUNK_M), c1z = Math.floor((cam.z + R) / CHUNK_M);
    const m = this._m, q = this._q, e = this._e, s = this._s, p = this._p;
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      const dx = Math.max(cx * CHUNK_M - cam.x, 0, cam.x - (cx + 1) * CHUNK_M), dz = Math.max(cz * CHUNK_M - cam.z, 0, cam.z - (cz + 1) * CHUNK_M);
      if (dx * dx + dz * dz > R * R) continue;
      for (const t of this._chunkTrees(cx, cz, true)) {
        const d = Math.hypot(t.x - cam.x, t.z - cam.z);
        if (d > R) continue;
        const sp = SPECIES[t.sp];
        const sc = t.h / sp.H;
        // from day 3 more and more trees become exact copies of each other
        const clone = this.day >= 3 && ((t.x * 7.31 + t.z * 3.17) % 1 + 1) % 1 < (this.day - 2) * 0.14;
        if (clone) e.set(0, 0.7, 0); else e.set(t.lean, t.rot, t.lean * 0.7);
        q.setFromEuler(e);
        s.set(sc, sc, sc);
        p.set(t.x, t.y, t.z);
        m.compose(p, q, s);
        for (let lod = 0; lod < 2; lod++) {
          const inBand = lod === 0 ? d < NEAR0 + BAND : d > NEAR0 && d < NEAR1 + BAND1;
          if (!inBand) continue;
          const k = counts[t.sp][lod];
          if (k >= this.cap[lod]) continue;
          const n = this.near[t.sp][lod];
          n.trunk.setMatrixAt(k, m);
          n.foliage.setMatrixAt(k, m);
          counts[t.sp][lod] = k + 1;
        }
      }
    }
    this.near.forEach((lods, si) => lods.forEach((n, lod) => {
      n.trunk.count = n.foliage.count = counts[si][lod];
      n.trunk.instanceMatrix.needsUpdate = true;
      n.foliage.instanceMatrix.needsUpdate = true;
    }));
  }

  // impostor blocks (8x8 chunks each), built a few chunks per frame
  _updateBlocks(cam) {
    const B = this.blockSize;
    const want = new Set();
    const R = FAR_IMP + 10;
    const b0x = Math.floor((cam.x - R) / B), b1x = Math.floor((cam.x + R) / B);
    const b0z = Math.floor((cam.z - R) / B), b1z = Math.floor((cam.z + R) / B);
    for (let bz = b0z; bz <= b1z; bz++) for (let bx = b0x; bx <= b1x; bx++) {
      const dx = Math.max(bx * B - cam.x, 0, cam.x - (bx + 1) * B), dz = Math.max(bz * B - cam.z, 0, cam.z - (bz + 1) * B);
      if (dx * dx + dz * dz > R * R) continue;
      want.add(`${bx},${bz}`);
    }
    const t0 = performance.now();
    for (const k of want) {
      let blk = this.blocks.get(k);
      if (!blk) {
        const [bx, bz] = k.split(',').map(Number);
        blk = { bx, bz, next: 0, list: [], data: null };
        this.blocks.set(k, blk);
      }
      if (blk.data) continue;
      while (blk.next < 64 && performance.now() - t0 < (this.forceBuild ? 1e9 : 2.5)) {
        const cx = blk.bx * 8 + (blk.next % 8), cz = blk.bz * 8 + Math.floor(blk.next / 8);
        for (const t of this._chunkTrees(cx, cz)) blk.list.push(t);
        blk.next++;
      }
      if (blk.next >= 64) this._finishBlock(blk);
    }
    for (const [k, blk] of this.blocks) {
      if (want.has(k)) continue;
      if (blk.data) this.impDirty = true;
      this.blocks.delete(k);
    }
    if (this.impDirty) this._remergeImpostors();
  }

  // every finished block's impostors in one instanced draw (no per-block draw calls)
  _remergeImpostors() {
    this.impDirty = false;
    let n = 0;
    for (const blk of this.blocks.values()) if (blk.data) n += blk.data.n;
    const old = this.impMesh;
    const g = new THREE.InstancedBufferGeometry();
    g.index = this.quad.index;
    g.setAttribute('position', this.quad.getAttribute('position'));
    const ip = new Float32Array(Math.max(1, n) * 4), iv = new Float32Array(Math.max(1, n) * 4);
    let o = 0;
    for (const blk of this.blocks.values()) {
      if (!blk.data || !blk.data.n) continue;
      ip.set(blk.data.ip, o * 4);
      iv.set(blk.data.iv, o * 4);
      o += blk.data.n;
    }
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(ip, 4));
    g.setAttribute('iVar', new THREE.InstancedBufferAttribute(iv, 4));
    g.instanceCount = n;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mesh = new THREE.Mesh(g, this.impMat);
    mesh.name = 'treeimp';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    this.impMesh = mesh;
    if (n) this.group.add(mesh);
    if (old) { old.removeFromParent(); old.geometry.dispose(); }
  }

  _finishBlock(blk) {
    const n = blk.list.length;
    const ip = new Float32Array(n * 4), iv = new Float32Array(n * 4);
    blk.list.forEach((t, i) => {
      const sc = t.h / SPECIES[t.sp].H;
      ip[i * 4] = t.x; ip[i * 4 + 1] = t.y; ip[i * 4 + 2] = t.z; ip[i * 4 + 3] = sc;
      iv[i * 4] = t.sp; iv[i * 4 + 1] = Math.floor((t.rot / 6.2832) * 4) & 3; iv[i * 4 + 2] = (t.seed || 0) / 3; iv[i * 4 + 3] = (t.seed || 0) & 1;
    });
    blk.data = { n, ip, iv };
    blk.list = null;
    this.impDirty = true;
  }

  // a day-7 shift regrows a chunk's trees: drop the affected impostor block
  invalidateChunk(cx, cz) {
    const k = `${Math.floor(cx / 8)},${Math.floor(cz / 8)}`;
    const blk = this.blocks.get(k);
    if (blk?.data) this.impDirty = true;
    this.blocks.delete(k);
    this.lastCam.set(1e9, 0, 1e9);
  }

  // trunk colliders for a gameplay chunk
  colliders(physics, cx, cz) {
    const out = [];
    for (const t of this._chunkTrees(cx, cz, true)) {
      if (!t.col) continue;
      const sp = SPECIES[t.sp];
      const r = Math.max(0.08, sp.r0 * (t.h / sp.H) * 1.05);
      const desc = RAPIER.ColliderDesc.cylinder(2.2, r).setTranslation(t.x, t.y + 2.0, t.z).setCollisionGroups(GROUPS.static).setFriction(0.7);
      const c = physics.world.createCollider(desc);
      physics.setUserData(c, { kind: 'static', surface: 'tree' });
      out.push(c);
    }
    return out;
  }

  dispose() {
    this.group.removeFromParent();
    for (const lods of this.models) for (const m of lods) { m.trunk.dispose(); m.foliage.dispose(); m.trunkMat.dispose(); m.leafMat.dispose(); }
    this.impMesh?.geometry.dispose();
    this.imp.alb.dispose(); this.imp.nrm.dispose();
    this.impMat.dispose();
    this.quad.dispose();
  }
}
