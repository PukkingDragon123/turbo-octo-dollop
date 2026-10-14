// Interior light occlusion. Outdoors the scene is lit by the sun and by the sky's image-based light; a roofed
// shed can't see that sky, so materials patched here fade their IBL (diffuse + specular) inside registered
// boxes — softly towards the open doorway — and pick up the fill of the shed's own fluorescent tube when its
// generator runs. The boxes live in shared uniforms (one update reaches every patched material).
// Shared catalog materials are patched in place (device code keeps mutating the very same objects) and every
// patch is undone when the level is torn down, so no other level ever sees it.
import * as THREE from 'three';

export const MAX_INTERIORS = 8;

export const interiorUniforms = {
  uIntN: { value: 0 },
  uIntA: { value: Array.from({ length: MAX_INTERIORS }, () => new THREE.Vector4()) },  // centre x, z, half x, half z
  uIntB: { value: Array.from({ length: MAX_INTERIORS }, () => new THREE.Vector4()) },  // floor y, roof y, cos(yaw), sin(yaw)
  uIntC: { value: Array.from({ length: MAX_INTERIORS }, () => new THREE.Vector4()) },  // open side (local -z..+z: -1/0/+1), soft, strength, -
  uIntF: { value: Array.from({ length: MAX_INTERIORS }, () => new THREE.Vector3()) },  // fill irradiance
  uIntBounce: { value: new THREE.Color(0.15, 0.14, 0.1) },  // daylight bounced in from the sunlit ground outside
};

const DECL = /* glsl */`
uniform int uIntN;
uniform vec4 uIntA[${MAX_INTERIORS}];
uniform vec4 uIntB[${MAX_INTERIORS}];
uniform vec4 uIntC[${MAX_INTERIORS}];
uniform vec3 uIntF[${MAX_INTERIORS}];
uniform vec3 uIntBounce;
`;

const APPLY = /* glsl */`
{
  vec3 intP = (vec4(-vViewPosition, 0.0) * viewMatrix).xyz + cameraPosition;
  vec3 intN = inverseTransformDirection(normal, viewMatrix);
  float intOcc = 0.0;
  vec3 intFill = vec3(0.0);
  for (int i = 0; i < ${MAX_INTERIORS}; i++) {
    if (i >= uIntN) break;
    vec4 a = uIntA[i]; vec4 b = uIntB[i]; vec4 c = uIntC[i];
    vec2 d = intP.xz - a.xy;
    vec2 l = vec2(d.x * b.z - d.y * b.w, d.x * b.w + d.y * b.z);
    vec2 q = abs(l) - a.zw;
    if (max(q.x, q.y) > 0.03 || intP.y < b.x || intP.y > b.y + 0.6) continue;
    // faces that look out through the nearest wall / up through the roof still see the sky
    vec2 nl = vec2(intN.x * b.z - intN.z * b.w, intN.x * b.w + intN.z * b.z);
    float outX = step(-0.32, q.x) * step(0.35, nl.x * sign(l.x));
    float outZ = step(-0.32, q.y) * step(0.35, nl.y * sign(l.y));
    float outY = step(b.y - 0.45, intP.y) * step(0.35, intN.y);
    float m = 1.0 - max(max(outX, outZ), outY);
    // the open side: daylight spills in through the doorway
    float open = c.x * l.y > 0.0 ? abs(l.y) / max(a.w, 0.01) : 0.0;
    m *= 1.0 - smoothstep(0.3, 1.0, open) * c.y;
    m *= c.z;
    intOcc = max(intOcc, m);
    intFill += uIntF[i] * m;
  }
  iblIrradiance = mix(iblIrradiance, uIntBounce, intOcc * 0.86) + intFill;
  irradiance *= 1.0 - intOcc * 0.6;
  #if defined( RE_IndirectSpecular )
    radiance *= 1.0 - intOcc * 0.9;
  #endif
}
`;

const patched = new Map();   // material -> { obc, key }

function interiorCompile(prev, mat) {
  return function (shader, renderer) {
    if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(mat, shader, renderer);
    shader.uniforms.uIntN = interiorUniforms.uIntN;
    shader.uniforms.uIntA = interiorUniforms.uIntA;
    shader.uniforms.uIntB = interiorUniforms.uIntB;
    shader.uniforms.uIntC = interiorUniforms.uIntC;
    shader.uniforms.uIntF = interiorUniforms.uIntF;
    shader.uniforms.uIntBounce = interiorUniforms.uIntBounce;
    if (!shader.fragmentShader.includes('#include <lights_fragment_maps>')) return;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + DECL)
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' + APPLY);
  };
}

export function patchInterior(mat) {
  if (!mat || patched.has(mat) || !mat.isMeshStandardMaterial || mat.userData?.noInterior) return mat;
  const obc = mat.onBeforeCompile;
  const keyFn = mat.customProgramCacheKey;
  const ownKey = Object.prototype.hasOwnProperty.call(mat, 'customProgramCacheKey');
  const prevKey = keyFn.call(mat);
  patched.set(mat, { obc, keyFn, ownKey, ownObc: Object.prototype.hasOwnProperty.call(mat, 'onBeforeCompile') });
  mat.onBeforeCompile = interiorCompile(obc, mat);
  mat.customProgramCacheKey = () => prevKey + '|gl-int';
  mat.needsUpdate = true;
  return mat;
}

export function patchInteriorObject(obj) {
  obj.traverse((o) => {
    if (!o.isMesh || o.userData?.noInterior) return;
    if (Array.isArray(o.material)) o.material.forEach(patchInterior);
    else patchInterior(o.material);
  });
}

export function unpatchAllInterior() {
  for (const [mat, rec] of patched) {
    if (rec.ownObc) mat.onBeforeCompile = rec.obc; else delete mat.onBeforeCompile;
    if (rec.ownKey) mat.customProgramCacheKey = rec.keyFn; else delete mat.customProgramCacheKey;
    mat.needsUpdate = true;
  }
  patched.clear();
  interiorUniforms.uIntN.value = 0;
}

// boxes (outer wall envelope): [{ cx, cz, hx, hz, y0 (floor), y1 (roof), yaw, open (-1 = local -z side open,
// +1 = +z, 0 = closed), soft, strength, fill: Color }]
export function setInteriors(boxes) {
  const U = interiorUniforms;
  const n = Math.min(MAX_INTERIORS, boxes.length);
  for (let i = 0; i < n; i++) {
    const b = boxes[i];
    U.uIntA.value[i].set(b.cx, b.cz, b.hx, b.hz);
    // the shader rotates world offsets into the box frame (inverse of the Object3D yaw)
    U.uIntB.value[i].set(b.y0 ?? -0.5, b.y1 ?? 3, Math.cos(b.yaw || 0), Math.sin(b.yaw || 0));
    U.uIntC.value[i].set(b.open || 0, b.soft ?? 0.85, b.strength ?? 1, 0);
    if (b.fill) U.uIntF.value[i].set(b.fill.r, b.fill.g, b.fill.b); else U.uIntF.value[i].set(0, 0, 0);
  }
  U.uIntN.value = n;
}
