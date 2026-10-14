// Liquids for device models: analytic-thickness translucent volumes (aquarium water, cloning-tube
// fluid) and animated caustics on lit surfaces (aquarium gravel). Shared clock: FLUID_TIME, advanced
// by fluidTick() (bound per instance through sync.js so probe-material clones keep animating).
import * as THREE from 'three';

export const FLUID_TIME = { value: 0 };
export function fluidTick() { FLUID_TIME.value = performance.now() / 1000; }

export const CAUSTIC_GLSL = /* glsl */`
float roomCaustic(vec2 uv, float time){
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p; float c = 1.0; float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float t = time * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
  }
  c /= 4.0; c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 1.0);
}`;

// Translucent volume rendered on its front faces with analytic thickness (ray vs box / cylinder in
// object space, so scaling the mesh to drain it keeps working).
// o: { shape: 'box'|'cyl', min, max, radius, tint, deep, glow, density, a0, a1, swirl, rough, env }
export function volumeMat(o) {
  const m = new THREE.MeshStandardMaterial({ color: o.tint, roughness: o.rough ?? 0.08, metalness: 0, transparent: true, depthWrite: false, envMapIntensity: o.env ?? 1 });
  m.name = 'volume_' + o.shape;
  m.userData.noShadow = true;
  const u = {
    uTime: FLUID_TIME,
    uMin: { value: new THREE.Vector3(...o.min) }, uMax: { value: new THREE.Vector3(...o.max) }, uR: { value: o.radius || 0 },
    uTint: { value: new THREE.Color(o.tint) }, uDeep: { value: new THREE.Color(o.deep) }, uGlow: { value: new THREE.Color(o.glow || 0) },
    uDensity: { value: o.density ?? 3 }, uA: { value: new THREE.Vector2(o.a0 ?? 0.2, o.a1 ?? 0.8) },
  };
  const isect = o.shape === 'cyl' ? /* glsl */`
    vec2 o2 = ro.xz, d2 = rd.xz;
    float qa = max(dot(d2, d2), 1e-6), qb = dot(o2, d2), qc = dot(o2, o2) - uR * uR;
    float qh = qb * qb - qa * qc;
    float tn = 0.0, tf = 0.0;
    if (qh > 0.0) { qh = sqrt(qh); tn = (-qb - qh) / qa; tf = (-qb + qh) / qa; }
    float iy = 1.0 / (abs(rd.y) < 1e-5 ? 1e-5 : rd.y);
    float ya = (uMin.y - ro.y) * iy, yb = (uMax.y - ro.y) * iy;
    tn = max(tn, min(ya, yb)); tf = min(tf, max(ya, yb));` : /* glsl */`
    vec3 ird = 1.0 / (rd + vec3(1e-6));
    vec3 ta = (uMin - ro) * ird, tb = (uMax - ro) * ird;
    vec3 t1 = min(ta, tb), t2 = max(ta, tb);
    float tn = max(max(t1.x, t1.y), t1.z), tf = min(min(t2.x, t2.y), t2.z);`;
  const fx = o.swirl ? /* glsl */`
    float acc = 0.0;
    for (int s = 0; s < 4; s++) {
      vec3 p = ro + rd * mix(max(tn, 0.0), tf, (float(s) + 0.5) / 4.0);
      float rr = clamp(length(p.xz) / max(uR, 1e-3), 0.0, 1.0);
      float ang = atan(p.z, p.x);
      float sw = sin(ang * 3.0 + rr * 8.0 - uTime * 1.1 + p.y * 3.0) * 0.5 + 0.5;
      sw *= sin(p.y * 6.0 - uTime * 0.7 + ang * 2.0) * 0.3 + 0.7;
      acc += sw * (1.15 - rr * 0.8);
    }
    acc *= 0.25;
    totalEmissiveRadiance += uGlow * (0.3 + acc * 0.9) * att;` : /* glsl */`
    vec3 pm = ro + rd * (max(tn, 0.0) + thick * 0.35);
    float cs = roomCaustic(pm.xz * 1.6 + vec2(pm.y * 0.7), uTime * 0.45);
    totalEmissiveRadiance += uGlow * (0.3 + cs * 1.6) * (0.35 + att);`;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'varying vec3 vRoomOP;\nvarying vec3 vRoomOC;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvRoomOP = position;\nvRoomOC = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;');
    sh.fragmentShader = 'varying vec3 vRoomOP;\nvarying vec3 vRoomOC;\nuniform float uTime, uR, uDensity;\nuniform vec3 uMin, uMax, uTint, uDeep, uGlow;\nuniform vec2 uA;\n' + CAUSTIC_GLSL + '\n' +
      sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
    vec3 ro = vRoomOC; vec3 rd = normalize(vRoomOP - vRoomOC);
    ${isect}
    float thick = max(tf - max(tn, 0.0), 0.0);
    float att = 1.0 - exp(-uDensity * thick);
    diffuseColor.rgb = mix(uTint, uDeep, att);
    diffuseColor.a = mix(uA.x, uA.y, att);
    ${fx}`);
  };
  m.customProgramCacheKey = () => 'roomvol_' + o.shape + (o.swirl ? '_s' : '_c');
  m.onBeforeRender = fluidTick;
  m.userData.uniforms = u;
  return m;
}

// Add animated caustic light to a lit (plain standard) material
export function withCaustics(m, strength = 0.35, color = 0x9fe8ff) {
  const u = { uTime: FLUID_TIME, uCaustCol: { value: new THREE.Color(color).multiplyScalar(strength) } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'varying vec3 vRoomWP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoomWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'varying vec3 vRoomWP;\nuniform float uTime;\nuniform vec3 uCaustCol;\n' + CAUSTIC_GLSL + '\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uCaustCol * diffuseColor.rgb * roomCaustic(vRoomWP.xz * 2.2 + vRoomWP.y * 0.5, uTime * 0.5) * 3.0;');
  };
  m.customProgramCacheKey = () => 'roomcaustic';
  m.onBeforeRender = fluidTick;
  return m;
}
