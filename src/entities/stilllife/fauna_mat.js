// Organic material for the sculpted Level 0 fauna (mole, moth, damp crawler, fungal, smiler): same vertex
// attributes as the Still Life body (vertex colour + aMat weights + aMisc ao/thin/wet/dirt), but the five
// channels mean living tissue instead of a plastic clone in a hazmat suit:
//   SKIN = wet flesh (pores, veins, wrinkles)   SUIT = fur / wing scales (strands)   RUBBER = chitin, claws, teeth
//   FLUFF = fungus (porous cellular lumps)      INNER = raw wet interior (gums, sores, gore)
// Textures are canvases (albedo pack + normal map, 2x2 atlas of 256 px tiles: flesh, fur, chitin, fungus),
// sampled triplanar in bind-pose space so detail sticks to the skin while it bends.
//   faunaMaterial(doubleSided) -> MeshPhysicalMaterial (probe-light compatible)
import * as THREE from 'three';
import { fbmField } from './textures.js';
import { RNG, clamp } from './core.js';

const T = 256;
let _tex = null;
const cache = new Map();

// tileable height / albedo / roughness for one tile -> written into the two atlas canvases
function tile(kind, seed) {
  const N = T * T, hgt = new Float32Array(N), alb = new Float32Array(N), rgh = new Float32Array(N);
  const r = new RNG(seed);
  const base = fbmField(T, T, 6, 5, seed), fine = fbmField(T, T, 24, 3, seed + 7);
  const wrap = (x) => ((x % T) + T) % T;
  const blob = (cx, cy, rad, fn) => {
    const R = Math.ceil(rad);
    for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
      const d = Math.hypot(x, y) / rad;
      if (d < 1) fn(wrap(Math.round(cx) + x) + wrap(Math.round(cy) + y) * T, d);
    }
  };
  const line = (x0, y0, x1, y1, w, fn) => {
    const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let s = 0; s <= n; s++) blob(x0 + (x1 - x0) * s / n, y0 + (y1 - y0) * s / n, w, fn);
  };
  for (let i = 0; i < N; i++) { hgt[i] = base[i] * 0.35 + fine[i] * 0.15; alb[i] = 0.78 + (base[i] - 0.5) * 0.5; rgh[i] = 0.5; }
  if (kind === 'flesh') {
    // wrinkles, pores and a web of raised veins
    for (let i = 0; i < N; i++) { const w = Math.sin((base[i] * 9 + (i % T) / T * 3) * Math.PI); hgt[i] += w * 0.06; }
    for (let k = 0; k < 900; k++) blob(r.next() * T, r.next() * T, 1 + r.next() * 1.4, (i, d) => { hgt[i] -= (1 - d) * 0.25; alb[i] -= (1 - d) * 0.15; rgh[i] += (1 - d) * 0.3; });
    for (let v = 0; v < 14; v++) {
      let x = r.next() * T, y = r.next() * T, a = r.next() * 6.28;
      for (let s = 0; s < 26; s++) {
        const nx = x + Math.cos(a) * 6, ny = y + Math.sin(a) * 6;
        line(x, y, nx, ny, 1.6, (i, d) => { hgt[i] = Math.max(hgt[i], 0.55 + (1 - d) * 0.3); alb[i] -= (1 - d) * 0.06; });
        x = nx; y = ny; a += (r.next() - 0.5) * 0.9;
      }
    }
  } else if (kind === 'fur') {
    // clumped strands running along +v, pale tips
    for (let i = 0; i < N; i++) { hgt[i] = base[i] * 0.2; alb[i] = 0.62 + base[i] * 0.3; rgh[i] = 0.9; }
    for (let k = 0; k < 2600; k++) {
      const x = r.next() * T, y = r.next() * T, len = 7 + r.next() * 12, lean = (r.next() - 0.5) * 3 + (base[(y | 0) * T + (x | 0)] - 0.5) * 8;
      const n = Math.ceil(len);
      for (let s = 0; s <= n; s++) {
        const t = s / n;
        blob(x + lean * t, y + len * t, 0.9, (i, d) => { const h = 0.35 + t * 0.6; if (hgt[i] < h * (1 - d * 0.5)) { hgt[i] = h * (1 - d * 0.5); alb[i] = 0.5 + t * 0.55; } });
      }
    }
  } else if (kind === 'chitin') {
    // smooth keratin with growth ridges and fine speckle
    for (let i = 0; i < N; i++) { const y = Math.floor(i / T); hgt[i] = base[i] * 0.15 + Math.sin(y / T * Math.PI * 2 * 18 + base[i] * 6) * 0.05; alb[i] = 0.85 + (fine[i] - 0.5) * 0.25; rgh[i] = 0.2 + fine[i] * 0.2; }
    for (let k = 0; k < 400; k++) blob(r.next() * T, r.next() * T, 0.8 + r.next(), (i, d) => { alb[i] -= (1 - d) * 0.25; });
  } else {
    // fungus: cellular lumps with dark pits, spongy
    const P = 26, pts = [];
    for (let k = 0; k < P; k++) pts.push([r.next() * T, r.next() * T, 14 + r.next() * 20]);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      let d1 = 1e9;
      for (const [px, py, rad] of pts) {
        let dx = Math.abs(x - px), dy = Math.abs(y - py);
        dx = Math.min(dx, T - dx); dy = Math.min(dy, T - dy);
        d1 = Math.min(d1, Math.hypot(dx, dy) / rad);
      }
      const i = y * T + x, cell = clamp(1 - d1, 0, 1);
      hgt[i] = cell * 0.6 + fine[i] * 0.25;
      alb[i] = 0.55 + cell * 0.45 + (fine[i] - 0.5) * 0.2;
      rgh[i] = 0.65 + (1 - cell) * 0.3;
    }
    for (let k = 0; k < 1400; k++) blob(r.next() * T, r.next() * T, 0.7 + r.next() * 1.5, (i, d) => { hgt[i] -= (1 - d) * 0.3; alb[i] -= (1 - d) * 0.3; rgh[i] = 1; });
  }
  return { hgt, alb, rgh };
}

function atlas() {
  if (_tex) return _tex;
  const ca = document.createElement('canvas'), cn = document.createElement('canvas');
  ca.width = cn.width = T * 2; ca.height = cn.height = T * 2;
  const A = ca.getContext('2d').createImageData(T * 2, T * 2), Nm = cn.getContext('2d').createImageData(T * 2, T * 2);
  [['flesh', 0, 0, 11], ['fur', 1, 0, 23], ['chitin', 0, 1, 37], ['fungus', 1, 1, 53]].forEach(([kind, tx, ty, seed]) => {
    const { hgt, alb, rgh } = tile(kind, seed);
    const str = kind === 'fur' ? 5 : kind === 'fungus' ? 4.5 : kind === 'flesh' ? 3.5 : 2.5;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const i = y * T + x, xl = y * T + ((x + T - 1) % T), xr = y * T + ((x + 1) % T), yu = ((y + T - 1) % T) * T + x, yd = ((y + 1) % T) * T + x;
      const dx = (hgt[xr] - hgt[xl]) * str, dy = (hgt[yd] - hgt[yu]) * str, l = Math.sqrt(dx * dx + dy * dy + 1);
      const o = ((ty * T + y) * T * 2 + tx * T + x) * 4;
      A.data[o] = clamp(alb[i], 0, 1) * 255; A.data[o + 1] = clamp(rgh[i], 0, 1) * 255; A.data[o + 2] = clamp(hgt[i], 0, 1) * 255; A.data[o + 3] = 255;
      Nm.data[o] = (-dx / l * 0.5 + 0.5) * 255; Nm.data[o + 1] = (-dy / l * 0.5 + 0.5) * 255; Nm.data[o + 2] = (1 / l) * 255; Nm.data[o + 3] = 255;
    }
  });
  ca.getContext('2d').putImageData(A, 0, 0);
  cn.getContext('2d').putImageData(Nm, 0, 0);
  const mk = (c, name) => {
    const t = new THREE.CanvasTexture(c);
    t.name = name;
    t.colorSpace = THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 4;
    return t;
  };
  _tex = { albedo: mk(ca, 'fauna_albedo_pack'), normal: mk(cn, 'fauna_normal') };
  return _tex;
}

const FRAG_DECL = /* glsl */`
uniform sampler2D tFA;
uniform sampler2D tFN;
varying vec4 vMat;
varying vec4 vMisc;
varying vec3 vTP;
varying vec3 vTN;
varying vec3 vAX;
varying vec3 vAY;
varying vec3 vAZ;
float fRough; float fCoat; float fSheen;
vec3 fW; vec3 fS; vec3 fN0;
vec2 fUX; vec2 fUY; vec2 fUZ;
vec2 fXx; vec2 fXy; vec2 fYx; vec2 fYy; vec2 fZx; vec2 fZy; // screen derivatives (taken outside any branch)
vec4 fSmp(sampler2D t, vec2 tl, vec2 u, vec2 dx, vec2 dy) { return textureGrad(t, (fract(u) * 0.98 + 0.01 + tl) * 0.5, dx * 0.49, dy * 0.49); }
// triplanar sample of atlas tile tl at sc tiles per metre, gradient-correct across the wrap
vec4 fTri(sampler2D t, vec2 tl, float sc) {
  vec4 r = vec4(0.0);
  if (fW.x > 0.01) r += fSmp(t, tl, fUX * sc, fXx * sc, fXy * sc) * fW.x;
  if (fW.y > 0.01) r += fSmp(t, tl, fUY * sc, fYx * sc, fYy * sc) * fW.y;
  if (fW.z > 0.01) r += fSmp(t, tl, fUZ * sc, fZx * sc, fZy * sc) * fW.z;
  return r;
}
`;
const FRAG_MAP = /* glsl */`
  fN0 = normalize( vTN );
  fW = pow( abs( fN0 ), vec3( 4.0 ) ); fW /= ( fW.x + fW.y + fW.z );
  fS = vec3( fN0.x < 0.0 ? -1.0 : 1.0, fN0.y < 0.0 ? -1.0 : 1.0, fN0.z < 0.0 ? -1.0 : 1.0 );
  fUX = vec2( vTP.z * fS.x, vTP.y ); fUY = vec2( vTP.x * fS.y, vTP.z ); fUZ = vec2( -vTP.x * fS.z, vTP.y );
  fXx = dFdx( fUX ); fXy = dFdy( fUX ); fYx = dFdx( fUY ); fYy = dFdy( fUY ); fZx = dFdx( fUZ ); fZy = dFdy( fUZ );
  float wFur = vMat.x, wChi = vMat.y, wFun = vMat.z, wIn = vMat.w;
  float wFl = max( 0.0, 1.0 - wFur - wChi - wFun - wIn );
  float fWet = vMisc.z, fDirt = vMisc.w;
  // flesh (+ inner) / fur / chitin / fungus tiles; scales in tiles per metre (small creatures: fine detail)
  vec4 aFl = ( wFl + wIn ) > 0.01 ? fTri( tFA, vec2( 0.0, 0.0 ), 9.0 ) : vec4( 0.8, 0.5, 0.5, 1.0 );
  vec4 aFu = wFur > 0.01 ? fTri( tFA, vec2( 1.0, 0.0 ), 22.0 ) : vec4( 0.8, 0.9, 0.5, 1.0 );
  vec4 aCh = wChi > 0.01 ? fTri( tFA, vec2( 0.0, 1.0 ), 14.0 ) : vec4( 0.85, 0.3, 0.5, 1.0 );
  vec4 aFn = wFun > 0.01 ? fTri( tFA, vec2( 1.0, 1.0 ), 7.0 ) : vec4( 0.7, 0.8, 0.5, 1.0 );
  vec3 fBase = vColor.rgb;
  vec3 fC = fBase * ( ( 0.7 + aFl.r * 0.42 ) * wFl + ( 0.55 + aFl.r * 0.35 ) * wIn + ( 0.28 + aFu.r * 0.9 ) * wFur + ( 0.75 + aCh.r * 0.3 ) * wChi + ( 0.35 + aFn.r * 0.8 ) * wFun );
  fC *= mix( vec3( 1.0 ), vec3( 0.55, 0.47, 0.38 ), clamp( fDirt * 0.6, 0.0, 1.0 ) * ( 1.0 - wIn ) );
  diffuseColor.rgb *= fC;
  fRough = ( 0.3 + aFl.g * 0.45 ) * wFl + 0.18 * wIn + ( 0.75 + aFu.g * 0.25 ) * wFur + ( 0.15 + aCh.g * 0.4 ) * wChi + ( 0.45 + aFn.g * 0.5 ) * wFun;
  fRough = mix( fRough, 0.1, clamp( fWet, 0.0, 1.0 ) * ( 1.0 - wFur * 0.6 ) );
  fCoat = clamp( 0.35 * wFl + 0.9 * wIn + 0.75 * wChi + 0.12 * wFun + fWet * ( 1.0 - wFur * 0.7 ), 0.0, 1.0 );
  fSheen = wFur * 0.8 * ( 1.0 - fWet ) + wFun * 0.15;
`;
const FRAG_NORMAL = /* glsl */`
  {
    float sFl = 0.85 * ( wFl + wIn * 0.5 ), sFu = 1.2 * wFur, sCh = 0.5 * wChi, sFn = 1.2 * wFun;
    // per-plane tangent normals (xy), weighted by channel strength
    vec2 nX = vec2( 0.0 ), nY = vec2( 0.0 ), nZ = vec2( 0.0 );
    vec2 TL[4]; TL[0] = vec2( 0.0, 0.0 ); TL[1] = vec2( 1.0, 0.0 ); TL[2] = vec2( 0.0, 1.0 ); TL[3] = vec2( 1.0, 1.0 );
    float SC[4]; SC[0] = 9.0; SC[1] = 22.0; SC[2] = 14.0; SC[3] = 7.0;
    float ST[4]; ST[0] = sFl; ST[1] = sFu; ST[2] = sCh; ST[3] = sFn;
    for ( int k = 0; k < 4; k++ ) {
      if ( ST[k] > 0.01 ) {
        float sc = SC[k];
        nX += ( fSmp( tFN, TL[k], fUX * sc, fXx * sc, fXy * sc ).xy * 2.0 - 1.0 ) * ST[k];
        nY += ( fSmp( tFN, TL[k], fUY * sc, fYx * sc, fYy * sc ).xy * 2.0 - 1.0 ) * ST[k];
        nZ += ( fSmp( tFN, TL[k], fUZ * sc, fZx * sc, fZy * sc ).xy * 2.0 - 1.0 ) * ST[k];
      }
    }
    nX.x *= fS.x; nY.x *= fS.y; nZ.x *= -fS.z;
    vec3 aN = abs( fN0 );
    vec3 pX = vec3( nX + fN0.zy, aN.x * sqrt( max( 0.0, 1.0 - dot( nX, nX ) ) ) );
    vec3 pY = vec3( nY + fN0.xz, aN.y * sqrt( max( 0.0, 1.0 - dot( nY, nY ) ) ) );
    vec3 pZ = vec3( nZ + fN0.xy, aN.z * sqrt( max( 0.0, 1.0 - dot( nZ, nZ ) ) ) );
    vec3 nRest = normalize( pX.zyx * fW.x + pY.xzy * fW.y + pZ.xyz * fW.z );
    vec3 fV = normalize( vAX * nRest.x + vAY * nRest.y + vAZ * nRest.z );
    #ifdef DOUBLE_SIDED
      fV *= faceDirection;
    #endif
    normal = fV;
  }
`;
const FRAG_AO = /* glsl */`
  {
    float fAO = vMisc.x;
    reflectedLight.indirectDiffuse *= fAO;
    reflectedLight.indirectSpecular *= fAO * fAO;
    reflectedLight.directDiffuse *= mix( 1.0, fAO, 0.45 );
    reflectedLight.directSpecular *= mix( 1.0, fAO, 0.6 );
  }
`;
const VERT_DECL = /* glsl */`
attribute vec4 aMat;
attribute vec4 aMisc;
varying vec4 vMat;
varying vec4 vMisc;
varying vec3 vTP;
varying vec3 vTN;
varying vec3 vAX;
varying vec3 vAY;
varying vec3 vAZ;
`;
const VERT_MAIN = /* glsl */`
#ifdef USE_SKINNING
  mat3 fSkin = mat3( skinMatrix );
#else
  mat3 fSkin = mat3( 1.0 );
#endif
  vAX = normalMatrix * ( fSkin * vec3( 1.0, 0.0, 0.0 ) );
  vAY = normalMatrix * ( fSkin * vec3( 0.0, 1.0, 0.0 ) );
  vAZ = normalMatrix * ( fSkin * vec3( 0.0, 0.0, 1.0 ) );
  vTP = position;
  vTN = normal;
  vMat = aMat;
  vMisc = aMisc;
`;

function make(doubleSided) {
  const tex = atlas();
  const mat = new THREE.MeshPhysicalMaterial({
    name: doubleSided ? 'fauna_cloth' : 'fauna_body',
    color: 0xffffff, vertexColors: true, roughness: 1, metalness: 0,
    sheen: 1, sheenRoughness: 0.5, sheenColor: new THREE.Color(0.9, 0.85, 0.78),
    clearcoat: 1, clearcoatRoughness: 0.12,
    side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  // the textures are real maps on the material too (for texture passes that walk material.map / normalMap)
  mat.userData.faunaMaps = tex;
  const U = { tFA: { value: tex.albedo }, tFN: { value: tex.normal } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_DECL)
      .replace('#include <skinnormal_vertex>', '#include <skinnormal_vertex>\n' + VERT_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_DECL)
      .replace('#include <map_fragment>', FRAG_MAP)
      .replace('#include <color_fragment>', '')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = fRough;')
      .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat = fCoat;
        #endif
        #ifdef USE_SHEEN
          material.sheenColor = sheenColor * fSheen * clamp( diffuseColor.rgb * 2.5, 0.0, 1.0 );
        #endif
        {
          float fSpec = mix( 1.0, 0.35, clamp( wFur + wFun * 0.5, 0.0, 1.0 ) * ( 1.0 - fWet ) );
          material.specularColor *= fSpec;
          material.specularColorBlended *= fSpec;
          material.specularF90 *= fSpec;
        }`)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' + FRAG_AO);
  };
  mat.customProgramCacheKey = () => 'fauna_body_v1' + (doubleSided ? '_ds' : '');
  return mat;
}

export function faunaMaterial(doubleSided = false) {
  const k = doubleSided ? 'ds' : 'fs';
  if (!cache.has(k)) cache.set(k, make(doubleSided));
  return cache.get(k);
}
export function faunaTextures() { return atlas(); }
