// Still Lifes — materials. The body is one skinned mesh whose per-vertex material weights blend
// burlap skin, hazmat fabric, black rubber, felt/stuffing and wet interior in a single draw call,
// textured triplanar in bind-pose space (so detail sticks to the skin while it bends and stretches).
// Parts (beads, thread, badges, tanks, tape…) share one atlas material with per-vertex PBR values.
// Both stay MeshPhysicalMaterial so the level's probe lighting patch (bakedlight.applyProbe) works.
import * as THREE from 'three';
import { burlapTex, hazmatTex, fluffTex, grimeTex } from './textures.js';
import { atlasTextures } from './atlas.js';

const cache = new Map();
const once = (k, fn) => { if (!cache.has(k)) cache.set(k, fn()); return cache.get(k); };

const BODY_VERT_DECL = /* glsl */`
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
const BODY_VERT_MAIN = /* glsl */`
#ifdef USE_SKINNING
  mat3 slSkin = mat3( skinMatrix );
#else
  mat3 slSkin = mat3( 1.0 );
#endif
  vAX = normalMatrix * ( slSkin * vec3( 1.0, 0.0, 0.0 ) );
  vAY = normalMatrix * ( slSkin * vec3( 0.0, 1.0, 0.0 ) );
  vAZ = normalMatrix * ( slSkin * vec3( 0.0, 0.0, 1.0 ) );
  vTP = position;
  vTN = normal;
  vMat = aMat;
  vMisc = aMisc;
`;
const BODY_FRAG_DECL = /* glsl */`
uniform sampler2D tBurlap;
uniform sampler2D tHazmat;
uniform sampler2D tFluff;
uniform sampler2D tGrime;
varying vec4 vMat;
varying vec4 vMisc;
varying vec3 vTP;
varying vec3 vTN;
varying vec3 vAX;
varying vec3 vAY;
varying vec3 vAZ;
float slRough;
float slCoat;
float slSheen;
`;
// scales: tiles per metre
const SC = { B: 1 / 0.09, H: 1 / 0.34, F: 1 / 0.07, G: 1 / 0.9, R: 1 / 0.6 };
const BODY_FRAG_MAP = /* glsl */`
  vec3 slN0 = normalize( vTN );
  vec3 slW = pow( abs( slN0 ), vec3( 4.0 ) ); slW /= ( slW.x + slW.y + slW.z );
  vec3 slS = vec3( slN0.x < 0.0 ? -1.0 : 1.0, slN0.y < 0.0 ? -1.0 : 1.0, slN0.z < 0.0 ? -1.0 : 1.0 );
  vec2 uX = vec2( vTP.z * slS.x, vTP.y ), uY = vec2( vTP.x * slS.y, vTP.z ), uZ = vec2( -vTP.x * slS.z, vTP.y );
  vec4 bX = texture2D( tBurlap, uX * ${SC.B.toFixed(3)} ), bY = texture2D( tBurlap, uY * ${SC.B.toFixed(3)} ), bZ = texture2D( tBurlap, uZ * ${SC.B.toFixed(3)} );
  vec4 hX = texture2D( tHazmat, uX * ${SC.H.toFixed(3)} ), hY = texture2D( tHazmat, uY * ${SC.H.toFixed(3)} ), hZ = texture2D( tHazmat, uZ * ${SC.H.toFixed(3)} );
  vec4 fX = texture2D( tFluff, uX * ${SC.F.toFixed(3)} ), fY = texture2D( tFluff, uY * ${SC.F.toFixed(3)} ), fZ = texture2D( tFluff, uZ * ${SC.F.toFixed(3)} );
  vec4 rX = texture2D( tHazmat, uX * ${SC.R.toFixed(3)} + 0.37 ), rY = texture2D( tHazmat, uY * ${SC.R.toFixed(3)} + 0.37 ), rZ = texture2D( tHazmat, uZ * ${SC.R.toFixed(3)} + 0.37 );
  vec4 gX = texture2D( tGrime, uX * ${SC.G.toFixed(3)} ), gY = texture2D( tGrime, uY * ${SC.G.toFixed(3)} ), gZ = texture2D( tGrime, uZ * ${SC.G.toFixed(3)} );
  vec4 sB = bX * slW.x + bY * slW.y + bZ * slW.z;
  vec4 sH = hX * slW.x + hY * slW.y + hZ * slW.z;
  vec4 sF = fX * slW.x + fY * slW.y + fZ * slW.z;
  vec4 sR = rX * slW.x + rY * slW.y + rZ * slW.z;
  vec4 sG = gX * slW.x + gY * slW.y + gZ * slW.z;
  float wSuit = vMat.x, wRub = vMat.y, wFl = vMat.z, wIn = vMat.w;
  float wSk = max( 0.0, 1.0 - wSuit - wRub - wFl - wIn );
  float slThin = vMisc.y, slWet = vMisc.z, slDirt = vMisc.w;
  vec3 slBase = vColor.rgb;
  // burlap: threads + gaps that open up where the sack is stretched thin
  float slGap = 1.0 - smoothstep( 0.04 + slThin * 0.5, 0.2 + slThin * 0.55, sB.g );
  vec3 cSk = slBase * ( 0.5 + sB.r * 0.72 );
  vec3 slGapC = mix( vec3( 0.025, 0.018, 0.012 ), vec3( 0.32, 0.27, 0.2 ), slThin );
  cSk = mix( cSk, slGapC, slGap * ( 0.7 + 0.3 * slThin ) );
  // hazmat: mottled coating, grime packed into creases
  vec3 cSu = slBase * ( 0.9 + ( sH.r - 0.9 ) * 1.4 ) * ( 1.0 - sH.g * ( 0.25 + slDirt * 0.45 ) );
  vec3 cRu = slBase * ( 0.85 + ( sR.r - 0.9 ) * 0.8 + sG.b * 0.25 );
  vec3 cFl = slBase * ( 0.55 + sF.r * 0.55 );
  vec3 cIn = slBase * ( 0.8 + sG.b * 0.4 );
  vec3 slC = cSk * wSk + cSu * wSuit + cRu * wRub + cFl * wFl + cIn * wIn;
  // texture-scale grime blotches on top of the baked stains
  float slGm = smoothstep( 0.45, 0.85, sG.a * 0.7 + sG.r * 0.55 - 0.1 + slDirt * 0.35 ) * ( 0.25 + slDirt * 0.55 ) * ( 1.0 - wIn );
  slC *= mix( vec3( 1.0 ), vec3( 0.5, 0.41, 0.3 ), slGm );
  diffuseColor.rgb *= slC;
  slRough = ( 0.93 - sB.g * 0.08 ) * wSk + ( 0.46 + sH.g * 0.3 + slGm * 0.25 ) * wSuit + ( 0.36 + sG.b * 0.3 ) * wRub + 1.0 * wFl + 0.3 * wIn;
  slRough = mix( slRough, 0.14, clamp( slWet, 0.0, 1.0 ) );
  slCoat = clamp( slWet * 0.95 + wRub * 0.25 + wIn * 0.7, 0.0, 1.0 );
  slSheen = ( wSk * 0.6 + wFl * 1.0 + wSuit * 0.05 ) * ( 1.0 - slWet );
`;
const BODY_FRAG_NORMAL = /* glsl */`
  {
    float nB = 0.95 * wSk * ( 1.0 - slWet * 0.5 ), nH = 0.55 * wSuit, nR = 0.18 * wRub, nF = 0.8 * wFl;
    vec2 tX = ( bX.ba * 2.0 - 1.0 ) * nB + ( hX.ba * 2.0 - 1.0 ) * nH + ( rX.ba * 2.0 - 1.0 ) * nR + ( fX.ba * 2.0 - 1.0 ) * nF;
    vec2 tY = ( bY.ba * 2.0 - 1.0 ) * nB + ( hY.ba * 2.0 - 1.0 ) * nH + ( rY.ba * 2.0 - 1.0 ) * nR + ( fY.ba * 2.0 - 1.0 ) * nF;
    vec2 tZ = ( bZ.ba * 2.0 - 1.0 ) * nB + ( hZ.ba * 2.0 - 1.0 ) * nH + ( rZ.ba * 2.0 - 1.0 ) * nR + ( fZ.ba * 2.0 - 1.0 ) * nF;
    tX.x *= slS.x; tY.x *= slS.y; tZ.x *= -slS.z;
    vec3 aN = abs( slN0 );
    vec3 nX = vec3( tX + slN0.zy, aN.x * sqrt( max( 0.0, 1.0 - dot( tX, tX ) ) ) );
    vec3 nY = vec3( tY + slN0.xz, aN.y * sqrt( max( 0.0, 1.0 - dot( tY, tY ) ) ) );
    vec3 nZ = vec3( tZ + slN0.xy, aN.z * sqrt( max( 0.0, 1.0 - dot( tZ, tZ ) ) ) );
    vec3 nRest = normalize( nX.zyx * slW.x + nY.xzy * slW.y + nZ.xyz * slW.z );
    vec3 slV = normalize( vAX * nRest.x + vAY * nRest.y + vAZ * nRest.z );
    #ifdef DOUBLE_SIDED
      slV *= faceDirection;
    #endif
    normal = slV;
  }
`;
const BODY_FRAG_AO = /* glsl */`
  {
    float slAO = vMisc.x;
    reflectedLight.indirectDiffuse *= slAO;
    reflectedLight.indirectSpecular *= slAO * slAO;
    reflectedLight.directDiffuse *= mix( 1.0, slAO, 0.45 );
    reflectedLight.directSpecular *= mix( 1.0, slAO, 0.6 );
    #ifdef USE_SHEEN
      sheenSpecularIndirect *= slAO;
    #endif
    #ifdef USE_CLEARCOAT
      clearcoatSpecularIndirect *= slAO;
    #endif
  }
`;

export function bodyUniforms() {
  return once('uni', () => ({
    tBurlap: { value: burlapTex() }, tHazmat: { value: hazmatTex() }, tFluff: { value: fluffTex() }, tGrime: { value: grimeTex() },
  }));
}

function makeBody(doubleSided) {
  const mat = new THREE.MeshPhysicalMaterial({
    name: doubleSided ? 'stilllife_cloth' : 'stilllife_body',
    color: 0xffffff, vertexColors: true, roughness: 1, metalness: 0,
    sheen: 1, sheenRoughness: 0.55, sheenColor: new THREE.Color(0.85, 0.8, 0.7),
    clearcoat: 1, clearcoatRoughness: 0.18,
    side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  const U = bodyUniforms();
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + BODY_VERT_DECL)
      .replace('#include <skinnormal_vertex>', '#include <skinnormal_vertex>\n' + BODY_VERT_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + BODY_FRAG_DECL)
      .replace('#include <map_fragment>', BODY_FRAG_MAP)
      .replace('#include <color_fragment>', '')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = slRough;')
      .replace('#include <normal_fragment_maps>', BODY_FRAG_NORMAL)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat = slCoat;
        #endif
        #ifdef USE_SHEEN
          material.sheenColor = sheenColor * slSheen * mix( vec3( 1.0 ), clamp( diffuseColor.rgb * 2.2, 0.0, 1.0 ), 0.6 );
        #endif`)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' + BODY_FRAG_AO);
  };
  mat.customProgramCacheKey = () => 'stilllife_body_v1' + (doubleSided ? '_ds' : '');
  return mat;
}
export const bodyMaterial = () => once('body', () => makeBody(false));
export const clothMaterial = () => once('cloth', () => makeBody(true));

// ---------------------------------------------------------------------------
// Parts: atlas colour/normal + per-vertex roughness / metalness / clearcoat / sheen
export const partsMaterial = () => once('parts', () => {
  const { map, normalMap } = atlasTextures();
  const mat = new THREE.MeshPhysicalMaterial({
    name: 'stilllife_parts', color: 0xffffff, vertexColors: true, map, normalMap, normalScale: new THREE.Vector2(1, 1),
    roughness: 1, metalness: 1, clearcoat: 1, clearcoatRoughness: 0.06, sheen: 1, sheenRoughness: 0.5, sheenColor: new THREE.Color(0.8, 0.78, 0.74),
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aPBR;\nvarying vec4 vPBR;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPBR = aPBR;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vPBR;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPBR.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPBR.y;')
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat = vPBR.z;
        #endif
        #ifdef USE_SHEEN
          material.sheenColor = sheenColor * vPBR.w;
        #endif`);
  };
  mat.customProgramCacheKey = () => 'stilllife_parts_v1';
  return mat;
});
