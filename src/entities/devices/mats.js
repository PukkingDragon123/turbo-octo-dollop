// Device materials: a handful of shared physically based surface classes built on GPU-synthesised
// texture sets (src/gfx/texsynth.js), plus a shader patch driven by per-vertex attributes that the
// device kit bakes for every vertex:
//   dTint (RGBA8)  rgb = sRGB paint / plastic / metal colour, a = roughness bias (0.5 neutral)
//   dFx   (RGBA8)  r = baked ambient occlusion, g = edge (bevel) factor, b = grime, a = dust (up-facing)
//   dWr   (RG8)    r = wear (paint chips / scuffs), g = rust
// so one material per class serves every device: painted sheet steel gets chipped paint with a primer
// halo and bare steel / rust in the chips (amount per part), worn bevels, grime in crevices and low
// areas, vertical run-off streaks, dust on top surfaces and contact AO. Shared materials keep the GPU
// program count and texture memory low; colour variation costs nothing (vertex data).
import * as THREE from 'three';
import * as Synth from '../../gfx/texsynth.js';

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const SIZE_CAP = +(Q.get('dsynth') || 4096); // dev: ?dsynth=256 for quick headless previews

// ---------------------------------------------------------------------------
// Recipes (neutral base colours: the vertex tint provides the hue)
// ---------------------------------------------------------------------------
Synth.registerRecipe('dv_paint', {
  // Enamel on sheet steel. albedo: near-white paint with mottling / orange peel.
  // ORM is repurposed: R = chip field (thresholded in the shader by the per-vertex wear amount),
  // G = paint roughness, B = fine scratch mask. p0.x base roughness.
  defaults: { c0: 0xe6e6e6, p0: [0.4, 0, 0, 0], meters: 0.75, bump: 1.1, size: 1024 },
  glsl: `S surface(vec2 uv){
    float peel = gn(uv * 240.0, vec2(240.0)) * 0.6 + gn(uv * 96.0 + 3.0, vec2(96.0)) * 0.4;
    float mott = fbm(uv, vec2(4.0), 5);
    float chipN = fbm(uv + 3.1, vec2(7.0), 6) * 0.68 + gn(uv * 37.0 + 1.7, vec2(37.0)) * 0.2 + gn(uv * 113.0, vec2(113.0)) * 0.12;
    float scr = max(scratches(uv, 9.0, 0.42, 0.0045), scratches(uv + 0.37, 21.0, 0.3, 0.0035) * 0.7);
    float wipe = smoothstep(0.55, 0.85, fbm(uv + 6.3, vec2(3.0, 9.0), 4));
    S s;
    s.albedo = uC0 * (0.955 + (mott - 0.5) * 0.09 + (peel - 0.5) * 0.035);
    s.height = 0.55 + (peel - 0.5) * 0.07 - scr * 0.22;
    s.rough = uP0.x + (mott - 0.5) * 0.1 + (peel - 0.5) * 0.05 + wipe * 0.08;
    s.ao = chipN; s.metal = scr; return s; }`,
});

Synth.registerRecipe('dv_metal', {
  // brushed / worn bare metal, neutral grey (vertex tint gives steel, brass, copper, zinc, iron)
  defaults: { c0: 0xcfcfcf, p0: [1, 0.3, 0.35, 0], meters: 0.5, bump: 0.7, size: 1024, metal: true },
  glsl: `S surface(vec2 uv){
    float br = gn(uv * vec2(3.0, 820.0), vec2(3.0, 820.0)) * 0.55 + gn(uv * vec2(2.0, 260.0) + 3.0, vec2(2.0, 260.0)) * 0.45;
    float m = fbm(uv, vec2(4.0), 5);
    float pit = smoothstep(0.84, 0.95, gn(uv * 150.0, vec2(150.0))) * uP0.z;
    float smudge = smoothstep(0.5, 0.82, fbm(uv + 2.2, vec2(3.0), 5));
    float scr = max(scratches(uv, 8.0, 0.45, 0.004), scratches(uv + 0.61, 19.0, 0.35, 0.003) * 0.8);
    vec3 col = uC0 * (0.9 + (br - 0.5) * 0.16 * uP0.x + (m - 0.5) * 0.16) * (1.0 - pit * 0.4) * (1.0 - smudge * 0.1) + scr * 0.07;
    S s; s.albedo = col;
    s.height = 0.5 + (br - 0.5) * 0.1 * uP0.x - pit * 0.45 - scr * 0.12;
    s.rough = uP0.y + (br - 0.5) * 0.08 * uP0.x + smudge * 0.2 + pit * 0.35 - scr * 0.08 + (m - 0.5) * 0.08;
    s.ao = 1.0 - pit * 0.35; s.metal = 1.0 - pit * 0.5; return s; }`,
});

Synth.registerRecipe('dv_plastic', {
  // moulded 80s/90s ABS with a fine VDI spark-erosion texture, neutral off-white
  defaults: { c0: 0xe4e4e4, p0: [0.5, 1, 0, 0], meters: 0.3, bump: 0.8, size: 512 },
  glsl: `S surface(vec2 uv){
    float st = gn(uv * 330.0, vec2(330.0)) * 0.6 + gn(uv * 150.0 + 1.0, vec2(150.0)) * 0.4;
    float m = fbm(uv, vec2(3.0), 5);
    float scr = scratches(uv, 11.0, 0.4, 0.004);
    float smear = smoothstep(0.55, 0.85, fbm(uv + 5.0, vec2(4.0), 5));
    S s; s.albedo = uC0 * (0.965 + (m - 0.5) * 0.07 + (st - 0.5) * 0.03) + scr * 0.03;
    s.height = 0.5 + (st - 0.5) * 0.32 * uP0.y - scr * 0.2;
    s.rough = uP0.x + (st - 0.5) * 0.14 * uP0.y + smear * 0.1 - scr * 0.1;
    s.ao = 1.0; s.metal = 0.0; return s; }`,
});

Synth.registerRecipe('dv_rubber', {
  // rubber / black thermoset: fine grain, mould-release sheen patches, neutral mid grey
  defaults: { c0: 0xbcbcbc, p0: [0.8, 0, 0, 0], meters: 0.25, bump: 1.0, size: 512 },
  glsl: `S surface(vec2 uv){
    float st = gn(uv * 420.0, vec2(420.0)); float m = fbm(uv, vec2(4.0), 5);
    float sheen = smoothstep(0.6, 0.9, fbm(uv + 1.0, vec2(5.0), 4));
    float scr = scratches(uv, 9.0, 0.4, 0.005);
    S s; s.albedo = uC0 * (0.92 + (m - 0.5) * 0.16 + st * 0.04) + scr * 0.05;
    s.height = st * 0.3 + m * 0.1 - scr * 0.2; s.rough = uP0.x + (st - 0.5) * 0.1 - sheen * 0.18 + scr * 0.05; s.ao = 1.0; s.metal = 0.0; return s; }`,
});

// texture sets per class: [recipe, options]. 'wood' reuses the furniture oak set (same cache key ->
// the GPU upload is shared when both libraries are loaded).
const SETS = {
  paint: ['dv_paint', { meters: 0.75, size: 1024, seed: 31, bump: 1.1 }],
  metal: ['dv_metal', { meters: 0.5, size: 1024, seed: 32, bump: 0.7 }],
  plastic: ['dv_plastic', { meters: 0.3, size: 512, seed: 33, bump: 0.8 }],
  dark: ['dv_rubber', { meters: 0.25, size: 512, seed: 34, bump: 1.0 }],
  wood: ['wood', { c0: 0x86603e, c1: 0xc9a47a, c2: 0x4a3018, p0: [26, 1, 0.8, 0.4], wear: 0.25, meters: 1.0, size: 1024, seed: 11 }],
  rust: ['rust', { c0: 0x7a3b16, c1: 0x4a2410, c2: 0xa86a2c, c3: 0x5a5e60, p0: [0.55, 0, 0, 0], wear: 0.5, meters: 0.45, size: 512, seed: 21 }],
  tile: ['tiles', { c0: 0xe9ebe6, c1: 0xa9aba2, c2: 0x5a5444, c3: 0xe4e7e2, p0: [4, 4, 0.05, 0.07], p1: [0.05, 0.2, 0.14, 0.55], wear: 0.45, meters: 0.6, size: 512, seed: 37 }],
  concrete: ['concrete', { c0: 0x9a968e, c1: 0x7e7a72, c2: 0x4a4640, c3: 0xb8b2a6, p0: [90, 0.2, 0.9, 0.45], wear: 0.4, meters: 1.2, size: 512, seed: 38 }],
};
// mean linear albedo of each neutral base (the tint becomes the final colour)
const TINT_REF = { paint: 0.765, metal: 0.6, plastic: 0.76, dark: 0.5, wood: 1, rust: 1, tile: 1, concrete: 1, atlas: 1 };
// shader mode per class
const MODE = { paint: 0, metal: 1, plastic: 2, dark: 3, wood: 4, rust: 5, tile: 5, concrete: 5, atlas: 9 };
// per class: [edge noise scale, edge wear strength, streak strength, AO strength], edge colour, dust colour
const FXP = {
  paint: { a: [40, 1, 0.5, 0.86], edge: 0x8f9193, dust: 0x9a948a },
  metal: { a: [46, 1, 0.45, 0.85], edge: 0xffffff, dust: 0x938d82 },
  plastic: { a: [44, 1, 0.25, 0.82], edge: 0xffffff, dust: 0xa39d90 },
  dark: { a: [44, 1, 0.2, 0.8], edge: 0xffffff, dust: 0x8f897e },
  wood: { a: [42, 1, 0.2, 0.84], edge: 0xffffff, dust: 0x9d978a },
  rust: { a: [40, 1, 0.35, 0.85], edge: 0xffffff, dust: 0x8a7a68 },
  tile: { a: [40, 0.6, 0.4, 0.85], edge: 0xffffff, dust: 0x9d978a },
  concrete: { a: [40, 0.6, 0.5, 0.85], edge: 0xffffff, dust: 0x9d978a },
  atlas: { a: [44, 0.7, 0.2, 0.8], edge: 0xffffff, dust: 0x9d978a },
};
export const CLASSES = Object.keys(SETS);
export const hasClass = (c) => !!SETS[c];

// ---------------------------------------------------------------------------
// Shader patch
// ---------------------------------------------------------------------------
const PARS_V = 'attribute vec4 dTint;\nattribute vec4 dFx;\nattribute vec2 dWr;\nvarying vec4 vDT;\nvarying vec4 vDF;\nvarying vec2 vDW;\nvarying vec3 vDP;\n';
const PARS_F = `varying vec4 vDT; varying vec4 vDF; varying vec2 vDW; varying vec3 vDP;
uniform float uDVRef; uniform vec4 uDVA; uniform vec3 uDVDust; uniform vec3 uDVEdge; uniform float uDVEmit;
float dvChip = 0.0; float dvDust = 0.0; float dvRust = 0.0; float dvH = 0.0; float dvEdgeM = 0.0; float dvGrime = 0.0;
float dvHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float dvN(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dvHash(i), dvHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(dvHash(i + vec3(0.0, 1.0, 0.0)), dvHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(dvHash(i + vec3(0.0, 0.0, 1.0)), dvHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(dvHash(i + vec3(0.0, 1.0, 1.0)), dvHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z); }
`;
function colorChunk(mode) {
  return `
{
  vec3 P = vDP;
  vec3 tint = pow(max(vDT.rgb, vec3(0.0)), vec3(2.2));
  vec3 base = diffuseColor.rgb;
  float en = dvN(P * uDVA.x) * 0.5 + dvN(P * uDVA.x * 3.3 + 11.0) * 0.32 + dvN(P * uDVA.x * 9.1 + 4.0) * 0.18;
  dvEdgeM = smoothstep(0.42, 0.6, vDF.g * (en * 1.6 - 0.15)) * uDVA.y;
  vec3 col;
${mode === 0 ? `
  vec4 orm = texture2D(roughnessMap, vRoughnessMapUv);
  float wa = vDW.x;
  float th = 0.86 - wa * 0.36;
  float on = step(0.01, wa);
  float chip = smoothstep(th - 0.012, th + 0.012, orm.r) * on;
  float primer = smoothstep(th - 0.085, th - 0.018, orm.r) * (1.0 - chip) * on;
  float scr = orm.b * smoothstep(0.05, 0.4, wa);
  chip = max(max(chip, dvEdgeM), scr * 0.85);
  float rn = dvN(P * 9.0 + 13.0) * 0.6 + dvN(P * 31.0) * 0.4;
  float rust = smoothstep(0.74 - vDW.y * 0.55, 0.84 - vDW.y * 0.55, rn) * step(0.01, vDW.y);
  vec3 paintC = tint * base / uDVRef;
  paintC = mix(paintC, paintC * vec3(0.8, 0.62, 0.46), primer * rust * 0.7);
  vec3 steel = uDVEdge * (0.8 + rn * 0.4);
  vec3 rustC = mix(vec3(0.15, 0.05, 0.017), vec3(0.34, 0.13, 0.04), dvN(P * 57.0));
  vec3 primerC = mix(vec3(0.3, 0.12, 0.07), paintC * 0.55, 0.35);
  col = mix(paintC, primerC, primer * 0.7);
  col = mix(col, mix(steel, rustC, rust), chip);
  dvChip = chip; dvRust = rust;
  dvH = -chip * 0.0004 - primer * 0.00012;` : mode === 1 ? `
  float rn = dvN(P * 7.0 + 13.0) * 0.6 + dvN(P * 26.0) * 0.4;
  float rust = smoothstep(0.8 - vDW.y * 0.5, 0.88 - vDW.y * 0.5, rn) * step(0.01, vDW.y);
  vec3 rustC = mix(vec3(0.15, 0.05, 0.017), vec3(0.33, 0.12, 0.035), dvN(P * 49.0));
  col = tint * base / uDVRef;
  col = mix(col, col * 1.15 + 0.02, dvEdgeM * 0.6);
  col = mix(col, rustC, rust);
  dvRust = rust; dvChip = dvEdgeM;` : mode === 2 ? `
  col = tint * base / uDVRef;
  float sc = smoothstep(0.64, 0.82, dvN(P * 38.0) * 0.55 + dvN(P * 140.0) * 0.45) * vDW.x;
  vec3 white = mix(col, vec3(dot(col, vec3(0.333))), 0.45) * 1.22 + 0.03;
  col = mix(col, white, max(dvEdgeM * 0.65, sc * 0.55));
  dvChip = max(dvEdgeM, sc);` : mode === 3 ? `
  col = tint * base / uDVRef;
  col = mix(col, col * 1.7 + 0.035, dvEdgeM * 0.55);
  dvChip = dvEdgeM;` : mode === 4 ? `
  col = tint * base;
  col = mix(col, col * 1.32 + 0.03, dvEdgeM * 0.8);
  dvChip = dvEdgeM;` : `
  col = tint * base;
  col = mix(col, col * 1.18 + 0.02, dvEdgeM * 0.5);
  dvChip = dvEdgeM * 0.5;`}
  float gnz = dvN(P * 6.0 + 3.0) * 0.65 + dvN(P * 23.0) * 0.35;
  float grime = clamp(vDF.b * (0.4 + 0.95 * gnz), 0.0, 1.0);
  float stk = dvN(vec3(P.x * 48.0, P.y * 1.6, P.z * 48.0)) * 0.7 + dvN(vec3(P.x * 131.0, P.y * 3.7, P.z * 131.0)) * 0.3;
  stk = smoothstep(0.52, 0.86, stk) * uDVA.z * (1.0 - vDF.a) * clamp(vDF.b * 1.6 + 0.12, 0.0, 1.0) * smoothstep(0.25, 0.65, dvN(P * 2.3 + 5.0));
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  vec3 dirty = mix(vec3(lum), col, 0.6) * vec3(0.6, 0.53, 0.44);
  dvGrime = clamp(grime * 0.72 + stk * 0.6, 0.0, 0.92);
  col = mix(col, dirty, dvGrime);
  col *= mix(1.0, vDF.r, uDVA.w);
  float dn = dvN(P * 17.0) * 0.6 + dvN(P * 63.0 + 5.0) * 0.4;
  dvDust = vDF.a * (0.3 + 0.5 * smoothstep(0.28, 0.8, dn)) * (0.35 + 0.65 * vDF.r);
  col = mix(col, uDVDust, dvDust);
  diffuseColor.rgb = col;
}
`;
}
function roughChunk(mode) {
  return `
roughnessFactor *= (0.25 + 1.5 * vDT.a);
${mode === 0 ? 'roughnessFactor = mix(roughnessFactor, mix(0.34, 0.9, dvRust), dvChip);'
    : mode === 1 ? 'roughnessFactor = mix(roughnessFactor, 0.86, dvRust); roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.72, dvChip * 0.5);'
      : mode === 2 ? 'roughnessFactor = mix(roughnessFactor, 0.72, dvChip * 0.7);'
        : 'roughnessFactor = mix(roughnessFactor, min(1.0, roughnessFactor + 0.15), dvChip);'}
roughnessFactor = mix(roughnessFactor, 0.97, dvDust);
roughnessFactor = clamp(roughnessFactor, 0.04, 1.0);
`;
}
function metalChunk(mode) {
  // rough / dirty metal reads partly diffuse (oxide, grime): keeps it visible under the game's dim
  // environment lighting, where pure metals would only show the (faint) environment map
  return `
${mode === 0 ? 'metalnessFactor = mix(metalnessFactor, 0.78 * (1.0 - dvRust), dvChip);' : mode === 1 ? 'metalnessFactor *= (1.0 - dvRust) * mix(1.0, 0.55, smoothstep(0.42, 0.85, vDT.a)) * (1.0 - dvGrime * 0.6);' : ''}
metalnessFactor *= 1.0 - dvDust;
`;
}
const BUMP_CHUNK = `
{
  vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
  float hx = dFdx(dvH), hy = dFdy(dvH);
  vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (hx * r1 + hy * r2);
  if (abs(det) > 1e-12) normal = normalize(abs(det) * normal - grad);
}
`;

const FXDATA = new WeakMap();
// Patch a MeshStandard/Physical material with the device fx. cls: material class name (or 'atlas').
export function applyDevFx(mat, cls, ov = {}) {
  const mode = MODE[cls] ?? 5;
  const P = FXP[cls] || FXP.atlas;
  const a = ov.a || P.a;
  const U = {
    uDVRef: { value: ov.ref ?? TINT_REF[cls] ?? 1 },
    uDVA: { value: new THREE.Vector4(a[0], a[1], a[2], a[3]) },
    uDVDust: { value: new THREE.Color(ov.dust ?? P.dust) },
    uDVEdge: { value: new THREE.Color(ov.edge ?? P.edge) },
    uDVEmit: { value: ov.emit ?? 0 },
  };
  FXDATA.set(mat, { cls, ov });
  mat.userData.dvMode = cls;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + PARS_V)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDT = dTint; vDF = dFx; vDW = dWr; vDP = position;');
    let fs = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + PARS_F);
    fs = fs.replace('#include <color_fragment>', '#include <color_fragment>\n' + colorChunk(mode));
    fs = fs.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + roughChunk(mode));
    fs = fs.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + metalChunk(mode));
    if (mode === 0) fs = fs.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + BUMP_CHUNK);
    if (mode === 9) fs = fs.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_MAP\ntotalEmissiveRadiance += sampledDiffuseColor.rgb * texelRoughness.r * uDVEmit;\n#endif');
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => 'dvfx' + mode;
  mat.needsUpdate = true;
  return mat;
}
// clone a material, keeping the device patch
export function cloneDevMat(m) {
  const c = m.clone();
  const d = FXDATA.get(m);
  if (d) applyDevFx(c, d.cls, d.ov);
  return c;
}

// ---------------------------------------------------------------------------
// Class materials (shared by every device)
// ---------------------------------------------------------------------------
const cache = new Map();
const texBytes = new Map();
function view(tex, rep) {
  const c = tex.clone();
  c.repeat.set(rep, rep);
  c.anisotropy = 8;
  c.needsUpdate = true;
  return c;
}
export function classMat(cls) {
  let m = cache.get(cls);
  if (m) return m;
  const [recipe, o0] = SETS[cls];
  const o = { ...o0, size: Math.min(o0.size || 512, SIZE_CAP) };
  const t = Synth.pbr(recipe, o);
  texBytes.set(recipe + o.size + (o.seed || 0), o.size * o.size * 4 * 3 * 1.33);
  const rep = 1 / (o.meters ?? t.meters ?? 1);
  const orm = view(t.orm, rep);
  const P = {
    name: 'dev_' + cls,
    map: view(t.map, rep), normalMap: view(t.normalMap, rep), roughnessMap: orm,
    roughness: 1, metalness: 0,
    normalScale: new THREE.Vector2(cls === 'paint' ? 0.55 : cls === 'plastic' ? 0.45 : 0.8, cls === 'paint' ? 0.55 : cls === 'plastic' ? 0.45 : 0.8),
  };
  if (cls !== 'paint') { P.aoMap = orm; P.aoMapIntensity = 0.8; }
  if (t.metal && cls !== 'paint') { P.metalnessMap = orm; P.metalness = 1; }
  if (cls === 'metal') P.envMapIntensity = 1.15;
  m = new THREE.MeshStandardMaterial(P);
  applyDevFx(m, cls);
  cache.set(cls, m);
  return m;
}

// per-device atlas materials: opaque labels / swatches (alpha-tested) and alpha-blended decals
export function atlasMats(tex, stex, name) {
  // slight polygon offset: printed labels sit 0.1-0.5 mm over other surfaces and must win the depth test far away
  const P = { name: name + '_atlas', map: tex, roughnessMap: stex, metalnessMap: stex, roughness: 1, metalness: 1, alphaTest: 0.4, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 };
  const atlas = applyDevFx(new THREE.MeshStandardMaterial(P), 'atlas', { emit: 1.6 });
  const decal = new THREE.MeshStandardMaterial({
    name: name + '_decal', map: tex, roughnessMap: stex, metalnessMap: stex, roughness: 1, metalness: 1,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  decal.userData.noShadow = true;
  applyDevFx(decal, 'atlas', { emit: 1.2, a: [44, 0, 0, 0.85] });
  return { atlas, decal };
}
// per-instance glowing atlas print (e.g. vending selection buttons that flash): plain material
export function atlasGlowMat(tex, intensity = 0.4) {
  const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: intensity, roughness: 0.35, metalness: 0, alphaTest: 0.4 });
  m.userData.unique = true;
  m.userData.noShadow = true;
  m.name = 'atlas_glow';
  return m;
}

// Clear glass: black base + additive blending, so only reflections/highlights are added on top of
// what is behind it (alpha-blended glass turns tanks and windows milky under bright lights).
const _clear = new Map();
export function CLEAR(o = {}) {
  const key = `${o.env ?? 1.4}|${o.rough ?? 0.06}|${o.side ?? 0}|${o.tint ?? 0}`;
  if (_clear.has(key)) return _clear.get(key);
  const m = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: o.tint ?? 0x000000, emissiveIntensity: 1, roughness: o.rough ?? 0.06, metalness: 0,
    envMapIntensity: o.env ?? 1.4, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: o.side ?? THREE.FrontSide,
  });
  m.name = 'clear_glass';
  m.userData.noShadow = true;
  m.userData.noProbe = true;
  _clear.set(key, m);
  return m;
}
// Tinted see-through plastic / glass (alpha blended), for bottles, covers, lenses
const _tinted = new Map();
export function TINTED(color, opacity = 0.3, o = {}) {
  const key = `${color}|${opacity}|${o.rough ?? 0.1}|${o.side ?? 0}|${o.env ?? 1.2}`;
  if (_tinted.has(key)) return _tinted.get(key);
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: o.rough ?? 0.1, metalness: 0, transparent: true, opacity, depthWrite: false, envMapIntensity: o.env ?? 1.2, side: o.side ?? THREE.FrontSide, clearcoat: 0.6, clearcoatRoughness: 0.08 });
  m.name = 'tinted_' + color.toString(16);
  m.userData.noShadow = true;
  _tinted.set(key, m);
  return m;
}

// Indicator lamps / LEDs: plain emissive materials (game code clones and drives emissiveIntensity)
const LAMP = {
  red: [0x330000, 0xff2010, 3],
  green: [0x003300, 0x30ff60, 2.5],
  amber: [0x332200, 0xffa020, 2.5],
  white: [0xffffff, 0xfff4dc, 2.5],
  blue: [0x001433, 0x3a8cff, 2.6],
  orange: [0x331100, 0xff6a10, 3],
  yellow: [0x332a00, 0xffd21a, 2.6],
  cyan: [0x002a2a, 0x30fff0, 2.4],
  uv: [0x10051f, 0x9b4dff, 2.6],
};
export function lampMat(color = 'red', ov = {}) {
  const [c, e, i] = LAMP[color] || LAMP.red;
  const m = new THREE.MeshStandardMaterial({ color: ov.color ?? c, emissive: ov.emissive ?? e, emissiveIntensity: ov.emissiveIntensity ?? i, roughness: ov.roughness ?? 0.25, metalness: 0 });
  if (ov.transparent) { m.transparent = true; m.opacity = ov.opacity ?? 0.8; m.depthWrite = false; }
  m.name = 'lamp_' + color;
  m.userData.unique = true;
  m.userData.noShadow = true;
  return m;
}
export function emissiveMat(color, emissive, intensity, o = {}) {
  const m = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: intensity, roughness: o.rough ?? 0.4, metalness: 0, ...(o.map ? { map: o.map, emissiveMap: o.map } : {}) });
  m.name = o.name || 'emissive';
  if (o.unique !== false) m.userData.unique = true;
  m.userData.noShadow = true;
  return m;
}

// Synthesize every class set up front (loading screen)
export function warmDeviceMaterials() { for (const c of Object.keys(SETS)) classMat(c); }
export function deviceTextureBytes() { let s = 0; for (const v of texBytes.values()) s += v; return s; }
