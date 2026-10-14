// The Bacteria — materials. One MeshPhysicalMaterial (so the level's probe-lighting patch still
// applies) extended in onBeforeCompile:
//   * GPU-synthesised wrinkled / porous skin (texsynth recipe 'bacteria_skin'), sampled triplanar in
//     bind-pose space and rotated by the per-vertex skinning matrix, so the detail sticks to the skin
//     while limbs bend and stretch
//   * per-vertex tissue attribute from the sculpt: baked cavity AO, hard tissue (nails / teeth),
//     raw inner tissue (mouth, eaten-through holes), wetness
//   * wet clear-coat film whose gloss slides down the body over time, faint oil-slick iridescence
//   * dissolve (noise burn-away with a sickly rim) + melt (body slumps into a puddle) for setDissolve
import * as THREE from 'three';
import * as Synth from '../../gfx/texsynth.js';

export const SKIN_TILE = 0.14; // metres per texture tile

Synth.registerRecipe('bacteria_skin', {
  // wet, wrinkled, porous black hide. c0 base, c1 raised, c2 crease, p0.x base roughness
  defaults: { c0: 0x0d100c, c1: 0x1b2018, c2: 0x030403, p0: [0.36, 0, 0, 0], wear: 0, meters: SKIN_TILE, bump: 2.6, size: 512, seed: 7 },
  glsl: `S surface(vec2 uv){
    vec2 w = vec2(fbm(uv + 1.7, vec2(4.0), 3), fbm(uv + 5.1, vec2(4.0), 3)) - 0.5;
    vec2 q = uv + w * 0.04;
    vec4 c1v = vor(q, vec2(44.0), 0.95);
    vec3 e1 = vec3((c1v.y - c1v.x) * 0.5, c1v.z, c1v.w);
    float crease = 1.0 - smoothstep(0.0, 0.07, e1.x);
    vec4 c2v = vor(q + 0.37, vec2(96.0), 1.0);
    float crease2 = 1.0 - smoothstep(0.0, 0.09, (c2v.y - c2v.x) * 0.5);
    float fold = ridged(uv + w * 0.12, vec2(4.0, 7.0), 3);
    float pore = smoothstep(0.8, 0.94, gn(uv * 240.0, vec2(240.0)));
    vec4 pv = vor(uv + 0.11, vec2(40.0), 0.9);
    float pap = smoothstep(0.34, 0.0, pv.x) * step(0.74, pv.z);
    float m = fbm(uv, vec2(3.0), 4);
    float fine = gn(uv * 512.0, vec2(512.0));
    float cellDome = smoothstep(0.0, 0.3, e1.x) * (0.6 + 0.4 * e1.y);
    S s;
    s.height = 0.5 + 0.16 * fold + 0.1 * m + 0.1 * cellDome - 0.28 * crease - 0.1 * crease2 - 0.2 * pore + 0.2 * pap + 0.03 * (fine - 0.5);
    vec3 col = mix(uC0, uC1, smoothstep(0.35, 0.8, m) * 0.55 + pap * 0.35 + cellDome * 0.15);
    s.albedo = mix(col, uC2, sat(crease * 0.65 + crease2 * 0.25 + pore * 0.5));
    s.rough = uP0.x + crease * 0.24 + crease2 * 0.08 + pore * 0.2 - pap * 0.08 + (m - 0.5) * 0.18 - cellDome * 0.06;
    s.ao = 1.0 - crease * 0.45 - crease2 * 0.15 - pore * 0.35;
    s.metal = 0.0;
    return s; }`,
});

let _tex = null;
export function skinTextures() {
  if (_tex) return _tex;
  try {
    _tex = Synth.pbr('bacteria_skin', {});
  } catch (e) {
    console.warn('[bacteria] skin synthesis failed, using flat maps', e);
    const flat = (r, g, b, srgb) => {
      const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.needsUpdate = true;
      return t;
    };
    _tex = { map: flat(14, 16, 13, true), normalMap: flat(128, 128, 255, false), orm: flat(255, 100, 0, false), meters: SKIN_TILE };
  }
  return _tex;
}

// ---------------------------------------------------------------------------
const GLSL_NOISE = /* glsl */`
float bH(vec3 p){ p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float bN(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(bH(i), bH(i + vec3(1,0,0)), f.x), mix(bH(i + vec3(0,1,0)), bH(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(bH(i + vec3(0,0,1)), bH(i + vec3(1,0,1)), f.x), mix(bH(i + vec3(0,1,1)), bH(i + vec3(1,1,1)), f.x), f.y), f.z);
}
`;
const GLSL_MELT_PARS = /* glsl */`
varying vec3 vBP;
uniform float uDissolve;
uniform vec2 uMeltC;
`;
// melt: the body slumps into a spreading puddle as it dissolves (mesh-local space, floor at y=0)
const GLSL_MELT = /* glsl */`
  if (uDissolve > 0.0) {
    float mk = smoothstep(0.0, 1.0, uDissolve);
    float hy = max(transformed.y, 0.0);
    float sag = mk * (0.82 + 0.18 * sin(vBP.x * 13.0 + vBP.z * 11.0 + vBP.y * 3.0));
    transformed.y = hy * (1.0 - sag) + 0.004;
    vec2 dxz = transformed.xz - uMeltC;
    transformed.xz += dxz * mk * 0.7 * (1.0 - clamp(hy / 2.6, 0.0, 1.0));
  }
`;
const GLSL_DISSOLVE = /* glsl */`
  float dEdge = 0.0;
  if (uDissolve > 0.0) {
    float dd = bN(vBP * 7.0) * 0.5 + bN(vBP * 23.0 + 4.1) * 0.2 + clamp(vBP.y / 2.8, 0.0, 1.0) * 0.3;
    float thr = 1.0 - uDissolve * 1.15;
    if (dd > thr) discard;
    dEdge = smoothstep(thr - 0.06, thr, dd);
  }
`;

function patchVertexMelt(sh) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\n' + GLSL_MELT_PARS)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n vBP = position;')
    .replace('#include <project_vertex>', GLSL_MELT + '\n#include <project_vertex>');
}

const VERT_PARS = /* glsl */`
attribute vec4 aTis;
varying vec4 vTis;
varying vec3 vBN;
varying vec3 vAX;
varying vec3 vAY;
varying vec3 vAZ;
`;
const VERT_AXES = /* glsl */`
#ifdef USE_SKINNING
  mat3 bSk = mat3( skinMatrix );
#else
  mat3 bSk = mat3( 1.0 );
#endif
  vAX = normalMatrix * ( bSk * vec3( 1.0, 0.0, 0.0 ) );
  vAY = normalMatrix * ( bSk * vec3( 0.0, 1.0, 0.0 ) );
  vAZ = normalMatrix * ( bSk * vec3( 0.0, 0.0, 1.0 ) );
  vBN = normal;
  vTis = aTis;
`;

const FRAG_PARS = /* glsl */`
uniform sampler2D tSkinA;
uniform sampler2D tSkinN;
uniform sampler2D tSkinO;
uniform float uTri;
uniform float uTime;
uniform float uWet;
uniform float uNS;
varying vec4 vTis;
varying vec3 vBN;
varying vec3 vAX;
varying vec3 vAY;
varying vec3 vAZ;
vec3 bTriW;
float bAO, bHard, bInner, bWetV, bWetFlow, bOrmR, bOrmG;
`;

// tissue colours (linear)
const FRAG_COLOR = /* glsl */`
  vec3 bnB = normalize( vBN );
  bTriW = pow( abs( bnB ), vec3( 4.0 ) ); bTriW /= ( bTriW.x + bTriW.y + bTriW.z );
  vec3 bp = vBP * uTri;
  vec3 aX = texture2D( tSkinA, bp.zy ).rgb, aY = texture2D( tSkinA, bp.xz ).rgb, aZ = texture2D( tSkinA, bp.xy ).rgb;
  vec3 oX = texture2D( tSkinO, bp.zy ).rgb, oY = texture2D( tSkinO, bp.xz ).rgb, oZ = texture2D( tSkinO, bp.xy ).rgb;
  vec3 bAlb = aX * bTriW.x + aY * bTriW.y + aZ * bTriW.z;
  vec3 bOrm = oX * bTriW.x + oY * bTriW.y + oZ * bTriW.z;
  bOrmR = bOrm.r; bOrmG = bOrm.g;
  bAO = vTis.x; bHard = vTis.y; bInner = vTis.z; bWetV = vTis.w;
  // broad mottling so it never reads as flat paint
  float bMot = bN( vBP * 6.0 + 3.1 ) * 0.6 + bN( vBP * 17.0 ) * 0.4;
  vec3 bCol = bAlb * ( 0.75 + 0.5 * bMot );
  bCol = mix( bCol, vec3( 0.045, 0.012, 0.01 ) * ( 0.6 + 0.6 * bMot ), bInner );
  bCol = mix( bCol, vec3( 0.022, 0.02, 0.016 ), bHard * 0.8 );
  bCol *= mix( 0.35, 1.0, bAO );
  diffuseColor.rgb *= bCol;
  // wetness: films that slowly slide down the body
  bWetFlow = bN( vBP * vec3( 7.0, 1.6, 7.0 ) + vec3( 0.0, uTime * 0.22, 0.0 ) ) * 0.7 + bN( vBP * 31.0 + vec3( 0.0, uTime * 0.5, 0.0 ) ) * 0.3;
`;
const FRAG_ROUGH = /* glsl */`
  roughnessFactor = bOrmG * ( 0.62 + 0.26 * bN( vBP * 9.0 ) );
  roughnessFactor = mix( roughnessFactor, 0.2, bHard * 0.8 );
  roughnessFactor = mix( roughnessFactor, 0.28, bInner );
  roughnessFactor -= smoothstep( 0.55, 0.85, bWetFlow ) * 0.12 * uWet;
  roughnessFactor = clamp( roughnessFactor + ( 1.0 - bAO ) * 0.2, 0.06, 1.0 );
`;
const FRAG_NORMAL = /* glsl */`
  {
    vec3 bn0 = normalize( vBN );
    vec3 bp = vBP * uTri;
    vec3 bp2 = vBP * ( uTri * 0.31 ) + 0.37;
    vec3 tx = texture2D( tSkinN, bp.zy ).xyz * 2.0 - 1.0;
    vec3 ty = texture2D( tSkinN, bp.xz ).xyz * 2.0 - 1.0;
    vec3 tz = texture2D( tSkinN, bp.xy ).xyz * 2.0 - 1.0;
    tx.xy += ( texture2D( tSkinN, bp2.zy ).xy * 2.0 - 1.0 ) * 0.7;
    ty.xy += ( texture2D( tSkinN, bp2.xz ).xy * 2.0 - 1.0 ) * 0.7;
    tz.xy += ( texture2D( tSkinN, bp2.xy ).xy * 2.0 - 1.0 ) * 0.7;
    float ns = uNS * mix( 1.0, 0.35, bHard );
    tx.xy *= ns; ty.xy *= ns; tz.xy *= ns;
    tx = vec3( tx.xy + bn0.zy, abs( tx.z ) * bn0.x );
    ty = vec3( ty.xy + bn0.xz, abs( ty.z ) * bn0.y );
    tz = vec3( tz.xy + bn0.xy, abs( tz.z ) * bn0.z );
    vec3 nb = normalize( tx.zyx * bTriW.x + ty.xzy * bTriW.y + tz.xyz * bTriW.z );
    mat3 bAx = mat3( normalize( vAX ), normalize( vAY ), normalize( vAZ ) );
    vec3 nv = normalize( bAx * nb );
    // keep the geometric shading normal's orientation (guards against skinning shear)
    vec3 n0 = normalize( bAx * bn0 );
    normal = normalize( normal + ( nv - n0 ) );
  }
`;
const FRAG_COAT_NORMAL = /* glsl */`
#ifdef USE_CLEARCOAT
  clearcoatNormal = normalize( mix( nonPerturbedNormal, normal, 0.38 ) );
#endif
`;
const FRAG_LIGHTS = /* glsl */`
#ifdef USE_CLEARCOAT
  float bWetM = clamp( bWetV * ( 0.55 + 0.6 * smoothstep( 0.3, 0.75, bWetFlow ) ) * uWet, 0.0, 1.0 );
  material.clearcoat = clearcoat * mix( 0.25, 1.0, bWetM ) * mix( 0.45, 1.0, bAO );
  material.clearcoatRoughness = clamp( mix( 0.32, 0.035, bWetM ) + geometryRoughness, 0.03, 1.0 );
#endif
#ifdef USE_IRIDESCENCE
  float bOil = smoothstep( 0.42, 0.78, bN( vBP * 4.0 + 11.0 ) );
  material.iridescence *= ( 0.15 + 0.85 * bOil ) * ( 1.0 - bInner );
  material.iridescenceThickness = mix( iridescenceThicknessMinimum, iridescenceThicknessMaximum, bN( vBP * 2.6 + vec3( 0.0, uTime * 0.03, 0.0 ) ) );
#endif
`;
const FRAG_AO = /* glsl */`
  {
    float bOcc = clamp( bAO * mix( 1.0, bOrmR, 0.7 ), 0.0, 1.0 );
    reflectedLight.indirectDiffuse *= bOcc;
    reflectedLight.indirectSpecular *= mix( 0.25, 1.0, bOcc );
    reflectedLight.directSpecular *= mix( 0.55, 1.0, bOcc );
#if defined( USE_CLEARCOAT )
    clearcoatSpecularIndirect *= mix( 0.2, 1.0, bOcc );
#endif
  }
`;

/**
 * Body material. U: shared uniform objects owned by the body instance
 * ({ uDissolve, uMeltC, uTime, uWet }).
 */
export function makeBodyMaterial(U) {
  const T = skinTextures();
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    ior: 1.6,
    specularIntensity: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    iridescence: 0.42,
    iridescenceIOR: 1.33,
    iridescenceThicknessRange: [240, 720],
    // the levels' reflection environments are deliberately dim; a wet black hide lives on its
    // reflections, so it takes a stronger share of them than ordinary props
    envMapIntensity: 3.2,
  });
  m.name = 'bacteria_tissue';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDissolve = U.uDissolve;
    sh.uniforms.uMeltC = U.uMeltC;
    sh.uniforms.uTime = U.uTime;
    sh.uniforms.uWet = U.uWet;
    sh.uniforms.tSkinA = { value: T.map };
    sh.uniforms.tSkinN = { value: T.normalMap };
    sh.uniforms.tSkinO = { value: T.orm };
    sh.uniforms.uTri = { value: 1 / (T.meters || SKIN_TILE) };
    sh.uniforms.uNS = { value: 1.0 };
    patchVertexMelt(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <skinnormal_vertex>', '#include <skinnormal_vertex>\n' + VERT_AXES);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_NOISE + 'varying vec3 vBP;\nuniform float uDissolve;\n' + FRAG_PARS)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + GLSL_DISSOLVE)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + FRAG_ROUGH)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_NORMAL)
      .replace('#include <clearcoat_normal_fragment_maps>', '#include <clearcoat_normal_fragment_maps>\n' + FRAG_COAT_NORMAL)
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n' + FRAG_LIGHTS)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' + FRAG_AO)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += vec3( 0.05, 0.09, 0.025 ) * dEdge;`);
  };
  m.customProgramCacheKey = () => 'bacteria_tissue_v3';
  return m;
}

export function makeShadowMaterial(U, Base, opts) {
  const m = new Base(opts);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDissolve = U.uDissolve;
    sh.uniforms.uMeltC = U.uMeltC;
    patchVertexMelt(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_NOISE + 'varying vec3 vBP;\nuniform float uDissolve;\n')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + GLSL_DISSOLVE);
  };
  m.customProgramCacheKey = () => 'bacteria_shadow_v3_' + Base.name;
  return m;
}

// glossy goo drops (instanced, world space)
let _dripMat = null;
export function dripMaterial() {
  if (_dripMat) return _dripMat;
  _dripMat = new THREE.MeshPhysicalMaterial({
    color: 0x050806, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03,
    iridescence: 0.5, iridescenceIOR: 1.33, iridescenceThicknessRange: [260, 620], envMapIntensity: 1.5,
  });
  _dripMat.name = 'bacteria_goo';
  return _dripMat;
}
