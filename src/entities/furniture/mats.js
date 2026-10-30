// Furniture materials: GPU-synthesised PBR texture sets (src/gfx/texsynth.js) shared by every
// model, tinted per slot, plus a small shader patch that reads the per-vertex `furnFx` attribute:
//   R baked AO  -> darkens crevices / contact areas
//   G edge mask -> worn edges (bare steel under paint, pale wood under varnish, scuffed plastic)
//   B grime     -> dirt in corners and near the floor
// and adds dust on upward-facing surfaces (object space, so it travels with the prop).
// UVs are in meters everywhere, so texture repeat = 1 / tile size.
import * as THREE from 'three';
import * as Synth from '../../gfx/texsynth.js';
import { atlasTex, atlasSurfaceTex } from './atlas.js';
import { drawWhiteboard } from './labels.js';

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const SIZE_CAP = +(Q.get('fsynth') || 4096); // dev: ?fsynth=256 for quick headless previews

// ---------------------------------------------------------------------------
// Custom recipes
// ---------------------------------------------------------------------------
Synth.registerRecipe('furn_upholstery', {
  // 1990s contract upholstery: heathered ground with scattered confetti (squiggles, dashes,
  // triangles, dots). c0 ground, c1..c3 accents. p0.x shapes per tile, p0.y density
  defaults: { c0: 0x1d4a50, c1: 0x9b5b80, c2: 0xe3d6b0, c3: 0xd58a52, p0: [9, 0.8, 0, 0], wear: 0.25, meters: 0.45, bump: 1.0, size: 512 },
  glsl: `
  float sdTri(vec2 p, float r){ const float k = 1.7320508; p.x = abs(p.x) - r; p.y = p.y + r / k; if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0; p.x -= clamp(p.x, -2.0 * r, 0.0); return -length(p) * sign(p.y); }
  S surface(vec2 uv){
    float heather = fbm(uv, vec2(48.0), 3); float slub = gn(uv * vec2(180.0, 30.0), vec2(180.0, 30.0));
    vec3 col = uC0 * (0.82 + heather * 0.3 + (slub - 0.5) * 0.12);
    float hgt = 0.4;
    for (int L = 0; L < 2; L++) {
      vec2 per = vec2(floor(uP0.x) + float(L) * 3.0);
      vec2 p = uv * per + float(L) * 0.37; vec2 ci = floor(p), f = fract(p);
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y)); vec2 c = mod(ci + g, per);
        vec3 h = h32(c + float(L) * 17.0);
        if (h12(c + 2.1 + float(L)) > uP0.y) continue;
        vec2 q = f - (g + 0.5 + (h.xy - 0.5) * 0.55);
        float a = h.z * 6.2831; vec2 r = mat2(cos(a), -sin(a), sin(a), cos(a)) * q;
        float kind = h12(c + 5.3 + float(L) * 3.0); float d;
        if (kind < 0.34) d = max(abs(r.y - 0.075 * sin(r.x * 15.0)) - 0.03, abs(r.x) - 0.3);
        else if (kind < 0.6) d = length(vec2(max(abs(r.x) - 0.2, 0.0), r.y)) - 0.04;
        else if (kind < 0.8) d = abs(sdTri(r, 0.11)) - 0.022;
        else d = length(r) - 0.055;
        float m = 1.0 - smoothstep(-0.01, 0.012, d);
        float ck = h12(c + 9.1 + float(L));
        vec3 sc = ck < 0.4 ? uC1 : ck < 0.75 ? uC2 : uC3;
        col = mix(col, sc * (0.88 + heather * 0.2), m); hgt = max(hgt, 0.4 + m * 0.2);
      }
    }
    float dirt = smoothstep(0.55, 0.9, fbm(uv + 3.3, vec2(3.0), 5)) * uWear; col = mix(col, col * vec3(0.7, 0.64, 0.55), dirt * 0.5);
    S s; s.albedo = col; s.height = hgt + slub * 0.1; s.rough = 0.92; s.ao = 1.0; s.metal = 0.0; return s; }`,
});

Synth.registerRecipe('furn_ticking', {
  // old mattress ticking: woven damask medallions + quilting stitch lines + age stains
  defaults: { c0: 0xe4ddc8, c1: 0xb8bcc4, c2: 0x9c7a3a, c3: 0x8a96aa, p0: [3, 4, 0.6, 0], wear: 0.5, meters: 0.6, bump: 1.8, size: 512 },
  glsl: `S surface(vec2 uv){
    vec2 t = uv * uP0.xy; vec2 c = floor(t), f = fract(t) - 0.5;
    float ang = atan(f.y, f.x); float rr = length(f);
    float petal = abs(cos(ang * 4.0)) * 0.22 + 0.08; float med = 1.0 - smoothstep(0.0, 0.02, rr - petal);
    float ring = 1.0 - smoothstep(0.0, 0.015, abs(rr - 0.36));
    vec2 g = abs(fract(t + 0.5) - 0.5); float diamond = 1.0 - smoothstep(0.0, 0.02, abs(g.x + g.y - 0.5));
    float weave = gn(uv * vec2(300.0, 300.0), vec2(300.0)); float tw = sin((uv.x + uv.y) * 2.0 * PI * 140.0) * 0.5 + 0.5;
    vec3 col = uC0 * (0.94 + weave * 0.06 + tw * 0.03);
    col = mix(col, uC1, sat(med * 0.45 + ring * 0.35));
    float quilt = 1.0 - smoothstep(0.0, 0.012, min(abs(fract(uv.x * uP0.x * 2.0 + 0.25) - 0.5), abs(fract(uv.y * uP0.y * 2.0 + 0.25) - 0.5)));
    col = mix(col, uC3, quilt * 0.25);
    float st = fbm(uv + 2.0, vec2(2.0), 6); float stain = smoothstep(0.6, 0.7, st) * uWear;
    float tide = (1.0 - smoothstep(0.0, 0.01, abs(st - 0.6))) * uWear;
    col = mix(col, uC2, sat(stain * 0.35 + tide * 0.55));
    S s; s.albedo = col; s.height = 0.5 + (med + ring) * 0.15 + tw * 0.1 + weave * 0.1 - quilt * 0.5; s.rough = 0.9; s.ao = 1.0 - quilt * 0.4; s.metal = 0.0; return s; }`,
});

Synth.registerRecipe('furn_clay', {
  // unglazed terracotta: fine sand grain, throwing rings along V, mineral bloom
  defaults: { c0: 0xb8653c, c1: 0x9a4e2c, c2: 0xe8e0cc, p0: [30, 0.5, 0, 0], wear: 0.4, meters: 0.3, bump: 1.6, size: 256 },
  glsl: `S surface(vec2 uv){
    float g = gn(uv * 220.0, vec2(220.0)); float m = fbm(uv, vec2(4.0), 5); float rings = sin(uv.y * 2.0 * PI * uP0.x + m * 2.0) * 0.5 + 0.5;
    float bloom = smoothstep(0.58, 0.8, fbm(uv + 4.0, vec2(3.0), 6)) * uWear;
    vec3 col = mix(uC1, uC0, m * 0.7 + rings * 0.2) * (0.9 + g * 0.18); col = mix(col, uC2, bloom * 0.55);
    S s; s.albedo = col; s.height = g * 0.3 + rings * 0.15 + bloom * 0.1; s.rough = 0.93; s.ao = 0.9 + g * 0.1; s.metal = 0.0; return s; }`,
});

Synth.registerRecipe('furn_laminate', {
  // printed woodgrain laminate (90s desk tops): flat, regular cathedral grain, satin
  defaults: { c0: 0x9a6a3e, c1: 0xc89c68, c2: 0x6a4424, p0: [9, 0.4, 0, 0.42], wear: 0.25, meters: 1.2, bump: 0.5, size: 512 },
  glsl: `S surface(vec2 uv){
    float w = fbm(uv, vec2(2.0, 3.0), 4) - 0.5;
    float y = uv.y + w * 0.05 + 0.03 * sin(uv.x * 2.0 * PI * 2.0 + w * 2.0);
    float cath = abs(fract(y * uP0.x + 0.15 * sin(uv.x * 2.0 * PI + w * 4.0)) - 0.5) * 2.0;
    float fine = gn(uv * vec2(6.0, 520.0), vec2(6.0, 520.0));
    vec3 col = mix(uC0, uC1, smoothstep(0.1, 0.9, cath) * 0.8 + (fine - 0.5) * 0.15);
    col = mix(col, uC2, smoothstep(0.92, 1.0, cath) * 0.3);
    float scr = scratches(uv, 8.0, 0.45, 0.004) * uWear; float scuff = smoothstep(0.6, 0.85, fbm(uv + 7.0, vec2(4.0), 5)) * uWear;
    col = mix(col, col * 1.12 + 0.02, scr * 0.6);
    S s; s.albedo = col; s.height = 0.5 + (fine - 0.5) * 0.06 - scr * 0.2; s.rough = uP0.w + scuff * 0.25 + scr * 0.15; s.ao = 1.0; s.metal = 0.0; return s; }`,
});

// ---------------------------------------------------------------------------
// Texture sets (one synthesis each, shared through texture clones)
// ---------------------------------------------------------------------------
const SETS = {
  oak: ['wood', { c0: 0x86603e, c1: 0xc9a47a, c2: 0x4a3018, p0: [26, 1, 0.8, 0.4], wear: 0.25, meters: 1.0, size: 1024, seed: 11 }],
  pine: ['wood', { c0: 0xa47a44, c1: 0xdcbc86, c2: 0x6a4a26, p0: [12, 1.6, 0.25, 0.78], wear: 0.55, meters: 0.8, size: 512, seed: 4 }],
  fabric: ['fabric', { c0: 0xb4b4b4, c1: 0xcccccc, c2: 0xeeeeee, p0: [36, 36, 0, 0.7], p1: [0.12, 0, 0, 0], wear: 0.3, meters: 0.07, size: 512, seed: 5, bump: 2.6 }],
  uph_teal: ['furn_upholstery', { c0: 0x1b4248, c1: 0x9b5b80, c2: 0xe0d2aa, c3: 0xd08a52, p0: [8, 0.75, 0, 0], size: 512, seed: 7 }],
  uph_mauve: ['furn_upholstery', { c0: 0x4a2c3c, c1: 0x3f8a86, c2: 0xe6d8b4, c3: 0xc9a14a, p0: [8, 0.7, 0, 0], size: 512, seed: 9 }],
  paint: ['paint_metal', { c0: 0xdadada, c1: 0x9a9da0, c2: 0x6a3a1c, c3: 0xa09078, p0: [0.4, 0.35, 0, 0], wear: 0.14, meters: 0.6, size: 512, seed: 2, bump: 1.3 }],
  metal: ['metal', { c0: 0xcacccf, c1: 0x8e9194, c2: 0x5a4a3a, p0: [1, 0.3, 0.2, 0], wear: 0.35, meters: 0.35, size: 512, seed: 6, bump: 0.6 }],
  plastic: ['plastic', { c0: 0xe6e6e6, c1: 0xd6ccb0, c2: 0x5a5244, p0: [0.5, 0.7, 0, 0], wear: 0.35, meters: 0.22, size: 512, seed: 8, bump: 0.7 }],
  rubber: ['rubber', { c0: 0x1c1c1e, c1: 0x262628, c2: 0x5a5a56, p0: [0.88, 0, 0, 0], wear: 0.4, meters: 0.15, size: 256, seed: 3 }],
  vinyl: ['vinyl', { c0: 0xd8d8d8, c1: 0xcdcdcd, p0: [160, 0.42, 0, 0], wear: 0.35, meters: 0.22, size: 512, seed: 12 }],
  cardboard: ['cardboard', { c0: 0xb88e5c, c1: 0x9c7648, c2: 0x5a4028, p0: [26, 0.35, 0, 0], wear: 0.35, meters: 0.5, size: 512, seed: 13 }],
  paper: ['paper', { c0: 0xf2efe6, c1: 0xe4dfcf, c2: 0xa8946a, wear: 0.25, meters: 0.25, size: 256, seed: 14 }],
  concrete: ['concrete', { c0: 0x9a968e, c1: 0x7e7a72, c2: 0x4a4640, c3: 0xb8b2a6, p0: [90, 0.15, 1.0, 0.35], wear: 0.3, meters: 0.6, size: 512, seed: 15 }],
  acoustic: ['acoustic', { c0: 0xe8e2ce, c1: 0xd2c9b0, c2: 0x8a6a3a, p0: [0.2, 0, 0, 0], meters: 0.6, size: 512, seed: 16 }],
  burlap: ['burlap', { c0: 0xbca070, c1: 0xa88a58, c2: 0x6a4e2c, p0: [26, 26, 0.5, 0.8], wear: 0.3, meters: 0.25, size: 512, seed: 17 }],
  clay: ['furn_clay', { size: 256, seed: 18 }],
  ticking: ['furn_ticking', { size: 512, seed: 19 }],
  soil: ['soil', { c0: 0x4a3828, c1: 0x2c2018, c2: 0x6a5a48, p0: [0.5, 0.3, 0, 0], meters: 0.35, size: 256, seed: 20 }],
  rust: ['rust', { c0: 0x7a3b16, c1: 0x4a2410, c2: 0xa86a2c, c3: 0x5a5e60, p0: [0.55, 0, 0, 0], wear: 0.5, meters: 0.45, size: 512, seed: 21 }],
};

function setFor(name) {
  const [recipe, o] = SETS[name];
  const size = Math.min(o.size || 512, SIZE_CAP);
  return { recipe, opts: { ...o, size } };
}

function texView(tex, rx, ry) {
  const c = tex.clone();
  c.repeat.set(rx, ry);
  c.needsUpdate = true;
  return c;
}

// ---------------------------------------------------------------------------
// Shader patch
// ---------------------------------------------------------------------------
const FX = new WeakMap();
const FX_PARS_V = 'attribute vec4 furnFx;\nvarying vec4 vFurnFx;\nvarying vec3 vFurnP;\nvarying vec3 vFurnN;\n';
const FX_PARS_F = `varying vec4 vFurnFx; varying vec3 vFurnP; varying vec3 vFurnN;
uniform vec3 uFxEdgeCol; uniform vec3 uFxDustCol; uniform vec4 uFxA; uniform vec4 uFxB; uniform vec4 uFxC;
float fxEdgeM = 0.0; float fxDustM = 0.0;
float fxH(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float fxN(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fxH(i), fxH(i + vec3(1.0, 0.0, 0.0)), f.x), mix(fxH(i + vec3(0.0, 1.0, 0.0)), fxH(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(fxH(i + vec3(0.0, 0.0, 1.0)), fxH(i + vec3(1.0, 0.0, 1.0)), f.x), mix(fxH(i + vec3(0.0, 1.0, 1.0)), fxH(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z); }
`;
const FX_COLOR = `
{
  vec3 fp = vFurnP;
  float en = fxN(fp * uFxB.w) * 0.5 + fxN(fp * uFxB.w * 3.3 + 11.0) * 0.32 + fxN(fp * uFxB.w * 9.1 + 4.0) * 0.18;
  fxEdgeM = smoothstep(0.42, 0.6, vFurnFx.g * (en * 1.6 - 0.15)) * uFxA.x;
  float gn = fxN(fp * 6.0 + 3.0) * 0.7 + fxN(fp * 23.0) * 0.3;
  float grime = clamp(vFurnFx.b * uFxA.w * (0.45 + 0.9 * gn), 0.0, 1.0);
  vec3 col = mix(diffuseColor.rgb, uFxC.x > 0.5 ? diffuseColor.rgb * uFxEdgeCol * 2.0 : uFxEdgeCol, fxEdgeM);
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, mix(vec3(lum), col, 0.65) * vec3(0.74, 0.68, 0.6), grime * 0.6);
  col *= mix(1.0, vFurnFx.r, uFxA.z);
  float up = smoothstep(0.6, 0.97, normalize(vFurnN).y);
  float dn = fxN(fp * uFxB.z) * 0.6 + fxN(fp * uFxB.z * 4.7 + 5.0) * 0.4;
  fxDustM = up * uFxA.y * smoothstep(0.38, 0.78, dn) * (0.35 + 0.65 * vFurnFx.r) * (0.75 + 0.25 * fxN(fp * 140.0));
  col = mix(col, uFxDustCol, fxDustM);
  diffuseColor.rgb = col;
}
`;

// fx: { edge, edgeCol, edgeRough, edgeMetal, dust, ao, grime, dustScale, edgeScale, dustCol }
export function applyFx(mat, fx = {}) {
  const P = {
    edge: fx.edge ?? 0.3, edgeCol: new THREE.Color(fx.edgeCol ?? 0xb0aca4), edgeRough: fx.edgeRough ?? 0.6, edgeMetal: fx.edgeMetal ?? 0,
    dust: fx.dust ?? 0.15, ao: fx.ao ?? 0.85, grime: fx.grime ?? 0.5, dustScale: fx.dustScale ?? 16, edgeScale: fx.edgeScale ?? 42,
    dustCol: new THREE.Color(fx.dustCol ?? 0x9d978a), edgeMul: !!fx.edgeMul, emit: fx.emit ?? 0,
  };
  FX.set(mat, P);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFxEdgeCol = { value: P.edgeCol };
    shader.uniforms.uFxDustCol = { value: P.dustCol };
    shader.uniforms.uFxA = { value: new THREE.Vector4(P.edge, P.dust, P.ao, P.grime) };
    shader.uniforms.uFxB = { value: new THREE.Vector4(P.edgeRough, P.edgeMetal, P.dustScale, P.edgeScale) };
    shader.uniforms.uFxC = { value: new THREE.Vector4(P.edgeMul ? 1 : 0, 0, 0, 0) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + FX_PARS_V)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFurnFx = furnFx; vFurnP = position; vFurnN = normal;');
    let fs = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + FX_PARS_F);
    fs = fs.replace('#include <color_fragment>', '#include <color_fragment>\n' + FX_COLOR);
    fs = fs.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, uFxB.x, fxEdgeM); roughnessFactor = mix(roughnessFactor, 0.97, fxDustM);');
    fs = fs.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, uFxB.y, fxEdgeM); metalnessFactor *= 1.0 - fxDustM;');
    // atlas surface map: R channel = self-illumination of the (un-grimed) atlas colour
    if (P.emit) fs = fs.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += sampledDiffuseColor.rgb * texelRoughness.r * ${P.emit.toFixed(3)};`);
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => (P.emit ? 'furnfx1e' + P.emit.toFixed(3) : 'furnfx1');
  mat.needsUpdate = true;
  return mat;
}
export function cloneMat(m) {
  const c = m.clone();
  const p = FX.get(m);
  if (p) {
    applyFx(c, { edge: p.edge, edgeCol: p.edgeCol.getHex(), edgeRough: p.edgeRough, edgeMetal: p.edgeMetal, dust: p.dust, ao: p.ao, grime: p.grime, dustScale: p.dustScale, edgeScale: p.edgeScale, dustCol: p.dustCol.getHex(), edgeMul: p.edgeMul, emit: p.emit });
  }
  return c;
}

// ---------------------------------------------------------------------------
// Material factories
// ---------------------------------------------------------------------------
// o: { set, color, rough (multiplier), metal, normal (scale), aoI, physical, sheen, sheenColor, clearcoat,
//      clearcoatRough, side, transparent, opacity, detail: {set, scale}, patternSet, fx: {...}, envI, emissive }
function synthMaterial(name, o) {
  const S = setFor(o.set);
  const t = Synth.pbr(S.recipe, S.opts);
  const rep = 1 / (S.opts.meters ?? t.meters ?? 1);
  let map = texView(t.map, rep, rep), normalMap = texView(t.normalMap, rep, rep), orm = texView(t.orm, rep, rep);
  if (o.detail) {
    // separate micro-detail set for normal / roughness / AO (e.g. weave under a printed pattern)
    const D = setFor(o.detail.set);
    const td = Synth.pbr(D.recipe, D.opts);
    const rd = 1 / (D.opts.meters ?? td.meters ?? 1);
    normalMap = texView(td.normalMap, rd, rd);
    orm = texView(td.orm, rd, rd);
  }
  const P = {
    name: 'furn_' + name,
    map, normalMap, roughnessMap: orm, aoMap: orm,
    color: new THREE.Color(o.color ?? 0xffffff),
    roughness: o.rough ?? 1,
    metalness: o.metal ?? (t.metal ? 1 : 0),
    aoMapIntensity: o.aoI ?? 1,
    normalScale: new THREE.Vector2(o.normal ?? 1, o.normal ?? 1),
  };
  if (t.metal && o.metalMap !== false) P.metalnessMap = orm;
  if (o.envI !== undefined) P.envMapIntensity = o.envI;
  if (o.side !== undefined) P.side = o.side;
  if (o.transparent) { P.transparent = true; P.opacity = o.opacity ?? 1; P.depthWrite = o.depthWrite ?? true; }
  if (o.alphaTest) P.alphaTest = o.alphaTest;
  let m;
  if (o.physical || o.sheen || o.clearcoat) {
    m = new THREE.MeshPhysicalMaterial(P);
    if (o.sheen) { m.sheen = o.sheen; m.sheenRoughness = o.sheenRough ?? 0.7; m.sheenColor = new THREE.Color(o.sheenColor ?? 0xffffff); }
    if (o.clearcoat) { m.clearcoat = o.clearcoat; m.clearcoatRoughness = o.clearcoatRough ?? 0.15; }
  } else m = new THREE.MeshStandardMaterial(P);
  return applyFx(m, o.fx);
}

function plainMaterial(name, o) {
  const P = { name: 'furn_' + name, color: new THREE.Color(o.color ?? 0xffffff), roughness: o.rough ?? 0.6, metalness: o.metal ?? 0 };
  if (o.envI !== undefined) P.envMapIntensity = o.envI;
  if (o.side !== undefined) P.side = o.side;
  if (o.transparent) { P.transparent = true; P.opacity = o.opacity ?? 1; P.depthWrite = o.depthWrite ?? false; }
  if (o.emissive !== undefined) { P.emissive = new THREE.Color(o.emissive); P.emissiveIntensity = o.emissiveI ?? 1; }
  let m;
  if (o.physical || o.clearcoat || o.transmission) {
    m = new THREE.MeshPhysicalMaterial(P);
    if (o.clearcoat) { m.clearcoat = o.clearcoat; m.clearcoatRoughness = o.clearcoatRough ?? 0.1; }
    if (o.ior) m.ior = o.ior;
  } else m = new THREE.MeshStandardMaterial(P);
  if (o.fx !== false) applyFx(m, o.fx || { edge: 0, dust: 0.12, grime: 0.4 });
  if (o.noProbe) m.userData.noProbe = true;
  return m;
}

function atlasMaterial(name, o) {
  const t = atlasTex();
  const P = { name: 'furn_' + name, map: t, roughness: o.rough ?? 0.65, metalness: o.metal ?? 0 };
  if (o.transparent) Object.assign(P, { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  if (o.alphaTest) P.alphaTest = o.alphaTest;
  if (o.side !== undefined) P.side = o.side;
  if (o.emissive) Object.assign(P, { emissiveMap: t, emissive: new THREE.Color(0xffffff), emissiveIntensity: o.emissive });
  if (o.surface) Object.assign(P, { roughnessMap: atlasSurfaceTex(), metalnessMap: atlasSurfaceTex(), roughness: 1, metalness: 1 });
  const m = new THREE.MeshStandardMaterial(P);
  return applyFx(m, o.fx || { edge: 0, dust: 0.15, grime: 0.35 });
}

// fx presets
const FXP = {
  wood: { edge: 0.4, edgeCol: 0xd9bb8e, edgeRough: 0.75, dust: 0.16, grime: 0.55 },
  darkwood: { edge: 0.45, edgeCol: 0xa8805a, edgeRough: 0.75, dust: 0.18, grime: 0.5 },
  rawwood: { edge: 0.35, edgeCol: 0xe6d2a6, edgeRough: 0.9, dust: 0.2, grime: 0.75 },
  laminate: { edge: 0.5, edgeCol: 0x6a5038, edgeRough: 0.85, dust: 0.14, grime: 0.45 },
  paint: { edge: 0.6, edgeCol: 0x9a9c9f, edgeRough: 0.34, edgeMetal: 0.55, dust: 0.16, grime: 0.6 },
  steel: { edge: 0.3, edgeCol: 0xd8dadc, edgeRough: 0.25, edgeMetal: 0.6, dust: 0.12, grime: 0.6 },
  chrome: { edge: 0.25, edgeCol: 0x9a9a98, edgeRough: 0.45, edgeMetal: 0.6, dust: 0.1, grime: 0.5 },
  plastic: { edge: 0.4, edgeCol: 0xc8c4b8, edgeMul: true, edgeRough: 0.75, dust: 0.14, grime: 0.5 },
  plasticDark: { edge: 0.5, edgeCol: 0xffffff, edgeMul: true, edgeRough: 0.8, dust: 0.18, grime: 0.35 },
  fabric: { edge: 0.3, edgeCol: 0xdadada, edgeMul: true, edgeRough: 1, dust: 0.05, grime: 0.55, ao: 0.9 },
  rubber: { edge: 0.25, edgeCol: 0x4a4a48, edgeRough: 0.95, dust: 0.08, grime: 0.25 },
  card: { edge: 0.5, edgeCol: 0xd8b888, edgeRough: 1, dust: 0.18, grime: 0.5 },
  stone: { edge: 0.4, edgeCol: 0xc8c2b4, edgeRough: 1, dust: 0.14, grime: 0.7 },
  none: { edge: 0, dust: 0.08, grime: 0.3 },
};

const PAINTS = { beige: 0xc9bea0, grey: 0x8e9194, dark: 0x3c3e41, black: 0x222325, red: 0xa8281f, green: 0x4f6b4b, white: 0xe4e2da, blue: 0x34507a, brown: 0x5b4636, yellow: 0xd8a823, olive: 0x6f7462, cream: 0xddd5bd, teal: 0x2f6a6a };
const PLASTICS = { beige: 0xd2c7a8, black: 0x262628, grey: 0x7c7e80, white: 0xe9e6dc, red: 0xc0302a, blue: 0x2f5d9e, green: 0x3f8a4a, orange: 0xe8661c, yellow: 0xf0c020, cream: 0xe2dac2, darkgrey: 0x4a4b4d };

const DEFS = {
  // woods
  oak: () => synthMaterial('oak', { set: 'oak', fx: FXP.wood }),
  maple: () => synthMaterial('maple', { set: 'oak', color: 0xfff2e2, fx: FXP.wood }),
  walnut: () => synthMaterial('walnut', { set: 'oak', color: 0x7a5a46, fx: FXP.darkwood }),
  cherry: () => synthMaterial('cherry', { set: 'oak', color: 0x9c6650, fx: FXP.darkwood }),
  teak: () => synthMaterial('teak', { set: 'oak', color: 0xa87a54, fx: FXP.darkwood }),
  wood_bent: () => synthMaterial('wood_bent', { set: 'oak', color: 0xd8a878, rough: 0.9, fx: FXP.wood }),
  pine: () => synthMaterial('pine', { set: 'pine', fx: FXP.rawwood }),
  pine_old: () => synthMaterial('pine_old', { set: 'pine', color: 0xb8a890, fx: { ...FXP.rawwood, grime: 0.9, dust: 0.35 } }),
  laminate: () => synthMaterial('laminate', { set: 'oak', color: 0xd8b898, rough: 0.82, normal: 0.35, fx: FXP.laminate }),
  laminate_grey: () => synthMaterial('laminate_grey', { set: 'plastic', color: 0xb8b4aa, rough: 0.9, fx: FXP.laminate }),
  laminate_beige: () => synthMaterial('laminate_beige', { set: 'plastic', color: 0xd6ccb2, rough: 0.85, fx: FXP.laminate }),
  // metals
  // bare metals are only partly metallic: the game's light probes feed the diffuse term only, so
  // fully metallic surfaces would read black under the dim environment map
  steel: () => synthMaterial('steel', { set: 'metal', metal: 0.6, fx: FXP.steel }),
  chrome: () => synthMaterial('chrome', { set: 'metal', color: 0xf4f4f4, rough: 0.36, metal: 0.72, normal: 0.25, envI: 1.6, fx: FXP.chrome }),
  alu: () => synthMaterial('alu', { set: 'metal', color: 0xd4d7d9, rough: 1.1, metal: 0.45, fx: FXP.steel }),
  brass: () => synthMaterial('brass', { set: 'metal', color: 0xd8b26a, rough: 0.8, metal: 0.7, envI: 1.4, fx: { ...FXP.chrome, edgeCol: 0xf0d8a0 } }),
  zinc: () => synthMaterial('zinc', { set: 'metal', color: 0xb4bcc0, rough: 1.15, metal: 0.5, fx: FXP.steel }),
  iron: () => synthMaterial('iron', { set: 'metal', color: 0x75777a, rough: 1.5, metal: 0.55, fx: FXP.steel }),
  rust: () => synthMaterial('rust', { set: 'rust', fx: { ...FXP.stone, edgeCol: 0x8a5a3a } }),
  // plastics / rubber / vinyl
  rubber: () => synthMaterial('rubber', { set: 'rubber', fx: FXP.rubber }),
  vinyl_black: () => synthMaterial('vinyl_black', { set: 'vinyl', color: 0x2a2a2c, rough: 1.1, fx: { ...FXP.plasticDark, edgeCol: 0x6a6866 } }),
  vinyl_red: () => synthMaterial('vinyl_red', { set: 'vinyl', color: 0x8c2420, rough: 1.0, fx: { ...FXP.plasticDark, edgeCol: 0xc07060 } }),
  // fabrics
  fabric: () => synthMaterial('fabric', { set: 'fabric', color: 0x6d6d6a, sheen: 0.35, sheenColor: 0x5a5a5a, sheenRough: 0.6, fx: FXP.fabric }),
  uph_teal: () => synthMaterial('uph_teal', { set: 'uph_teal', detail: { set: 'fabric' }, sheen: 0.35, sheenColor: 0x4a5a5a, sheenRough: 0.6, fx: FXP.fabric }),
  uph_mauve: () => synthMaterial('uph_mauve', { set: 'uph_mauve', detail: { set: 'fabric' }, sheen: 0.35, sheenColor: 0x5a4a52, sheenRough: 0.6, fx: FXP.fabric }),
  ticking: () => synthMaterial('ticking', { set: 'ticking', fx: { ...FXP.fabric, dust: 0.08 } }),
  tape_edge: () => synthMaterial('tape_edge', { set: 'fabric', color: 0xd2c8ae, fx: FXP.fabric }),
  linen: () => synthMaterial('linen', { set: 'fabric', color: 0xe2ddd0, normal: 0.6, fx: { ...FXP.fabric, dust: 0.04 } }),
  blanket: () => synthMaterial('blanket', { set: 'fabric', color: 0x5b6878, sheen: 0.3, sheenColor: 0x404040, fx: FXP.fabric }),
  burlap: () => synthMaterial('burlap', { set: 'burlap', fx: { ...FXP.fabric, edge: 0.2 } }),
  // paper goods
  cardboard: () => synthMaterial('cardboard', { set: 'cardboard', fx: FXP.card }),
  paper: () => synthMaterial('paper', { set: 'paper', fx: { edge: 0.2, edgeCol: 0xd8d0b8, dust: 0.25, grime: 0.4 } }),
  paper2: () => synthMaterial('paper2', { set: 'paper', side: THREE.DoubleSide, fx: { edge: 0, dust: 0.1, grime: 0.3 } }),
  // stone / ceramic
  concrete: () => synthMaterial('concrete', { set: 'concrete', fx: FXP.stone }),
  concrete_dark: () => synthMaterial('concrete_dark', { set: 'concrete', color: 0x8a8a86, fx: FXP.stone }),
  acoustic: () => synthMaterial('acoustic', { set: 'acoustic', fx: { ...FXP.stone, edgeCol: 0xf2eee2 } }),
  clay: () => synthMaterial('clay', { set: 'clay', fx: { ...FXP.stone, edgeCol: 0xd8885a } }),
  soil: () => synthMaterial('soil', { set: 'soil', fx: FXP.none }),
  ceramic: () => plainMaterial('ceramic', { color: 0xf2efe6, rough: 0.22, clearcoat: 0.7, clearcoatRough: 0.12, fx: { edge: 0.25, edgeCol: 0xd8d2c4, edgeRough: 0.6, dust: 0.1, grime: 0.6 } }),
  // glass & liquids & light
  glass: () => plainMaterial('glass', { physical: true, color: 0xcfe2e0, rough: 0.05, transparent: true, opacity: 0.22, envI: 1.6, fx: false }),
  crt_glass: () => plainMaterial('crt_glass', { physical: true, color: 0x101512, rough: 0.12, clearcoat: 1, clearcoatRough: 0.04, envI: 1.0, fx: false }),
  jug: () => plainMaterial('jug', { physical: true, color: 0x8ec0ee, rough: 0.14, transparent: true, opacity: 0.36, clearcoat: 1, envI: 1.4, fx: false }),
  water: () => plainMaterial('water', { physical: true, color: 0x4d8ed8, rough: 0.05, transparent: true, opacity: 0.3, fx: false }),
  bulb: () => plainMaterial('bulb', { color: 0xfff6e2, emissive: 0xffe0a8, emissiveI: 1.6, rough: 0.25, fx: false }),
  led_green: () => plainMaterial('led_green', { color: 0x0a2a10, emissive: 0x30ff60, emissiveI: 2.5, rough: 0.3, fx: false }),
  led_red: () => plainMaterial('led_red', { color: 0x2a0806, emissive: 0xff2010, emissiveI: 3, rough: 0.3, fx: false }),
  led_amber: () => plainMaterial('led_amber', { color: 0x2a1a04, emissive: 0xffa020, emissiveI: 2.5, rough: 0.3, fx: false }),
  lampshade: () => synthMaterial('lampshade', { set: 'fabric', color: 0xeadcb8, side: THREE.DoubleSide, normal: 0.5, fx: { ...FXP.fabric, dust: 0.35 } }),
  reflect: () => plainMaterial('reflect', { color: 0xe8ecee, rough: 0.28, metal: 0.25, envI: 1.6, fx: { edge: 0.3, edgeCol: 0x9a9a9a, dust: 0.2, grime: 0.5 } }),
  wax: () => plainMaterial('wax', { color: 0xf0ece0, rough: 0.5, fx: false }),
  felt_dark: () => synthMaterial('felt_dark', { set: 'fabric', color: 0x2c2c2c, normal: 0.6, fx: FXP.fabric }),
  whiteboard: () => {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 768;
    drawWhiteboard(c.getContext('2d'), 1024, 768);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    const m = new THREE.MeshPhysicalMaterial({ name: 'furn_whiteboard', map: t, roughness: 0.18, clearcoat: 0.6, clearcoatRoughness: 0.12, envMapIntensity: 1.1 });
    return applyFx(m, { edge: 0, dust: 0.04, grime: 0.3, ao: 0.6 });
  },
  bark: () => synthMaterial('bark', { set: 'oak', color: 0x6a5a4a, rough: 1.5, normal: 1.6, fx: { ...FXP.rawwood, edge: 0.1 } }),
  felt_hat: () => synthMaterial('felt_hat', { set: 'fabric', color: 0x4a3e33, normal: 0.5, sheen: 0.4, sheenColor: 0x504840, fx: FXP.fabric }),
  mop_cotton: () => synthMaterial('mop_cotton', { set: 'fabric', color: 0xcfc4a8, normal: 1.2, fx: { ...FXP.fabric, grime: 0.9 } }),
  wiremesh: () => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#2a2a2c'; ctx.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) ctx.clearRect(x * 8 + 1.5 + (y & 1) * 4 - 4, y * 8 + 1.5, 5, 5);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 0.05, 1 / 0.05); t.anisotropy = 8;
    const m = new THREE.MeshStandardMaterial({ name: 'furn_wiremesh', color: 0x9a9a9a, map: t, alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.7, roughness: 0.45 });
    return applyFx(m, { edge: 0, dust: 0.1, grime: 0.4 });
  },
  straw: () => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#c4a45a'; ctx.fillRect(0, 0, 128, 128);
    let sd = 31; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 320; i++) { ctx.fillStyle = `rgba(${rnd() > 0.5 ? '90,70,30' : '240,220,150'},${0.2 + rnd() * 0.4})`; ctx.fillRect(rnd() * 128, 0, 1 + rnd() * 1.5, 128); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 0.05, 1 / 0.2); t.anisotropy = 8;
    return applyFx(new THREE.MeshStandardMaterial({ name: 'furn_straw', map: t, roughness: 0.9 }), { edge: 0, dust: 0.2, grime: 0.7 });
  },
  bball: () => {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#c8561e'; ctx.fillRect(0, 0, 512, 256);
    let sd = 77; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 12000; i++) { ctx.fillStyle = rnd() > 0.5 ? 'rgba(0,0,0,0.13)' : 'rgba(255,190,140,0.10)'; ctx.beginPath(); ctx.arc(rnd() * 512, rnd() * 256, 1.1, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = '#15100c'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(0, 128); ctx.lineTo(512, 128); ctx.stroke();
    for (const x of [128, 384]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke(); }
    for (const cx of [0, 256, 512]) { ctx.beginPath(); for (let y = 0; y <= 256; y += 4) { const tt = (y / 256) * Math.PI; const x = cx + Math.sin(tt) * 82 * (cx === 256 ? -1 : 1); if (y === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke(); }
    ctx.fillStyle = 'rgba(20,10,5,0.75)'; ctx.font = 'bold 11px "Jolly Lodger", Georgia, serif'; ctx.textAlign = 'center'; ctx.fillText('OFFICIAL SIZE 7', 192, 110);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const D = setFor('rubber'); const td = Synth.pbr(D.recipe, D.opts);
    const n = texView(td.normalMap, 6, 3);
    return applyFx(new THREE.MeshStandardMaterial({ name: 'furn_bball', map: t, normalMap: n, normalScale: new THREE.Vector2(1.6, 1.6), roughness: 0.78 }), { edge: 0, dust: 0.12, grime: 0.4 });
  },
  // atlas families
  // matte / gloss / metal / glowing palette cells and label regions, via the atlas surface map
  atlas: () => atlasMaterial('atlas', { surface: true, fx: { edge: 0, dust: 0.15, grime: 0.35, emit: 1.5 } }),
  atlas_gloss: () => atlasMaterial('atlas_gloss', { rough: 0.22, fx: { edge: 0, dust: 0.12, grime: 0.3 } }),
  atlas_metal: () => atlasMaterial('atlas_metal', { rough: 0.34, metal: 0.65, fx: { edge: 0.2, edgeCol: 0xd0d0d0, edgeRough: 0.25, edgeMetal: 1, dust: 0.12, grime: 0.4 } }),
  decal: () => atlasMaterial('decal', { rough: 0.7, transparent: true, fx: { edge: 0, dust: 0.15, grime: 0.3 } }),
  glow: () => atlasMaterial('glow', { rough: 0.3, emissive: 1.5, fx: { edge: 0, dust: 0, grime: 0, ao: 0 } }),
  leaf: () => atlasMaterial('leaf', { rough: 0.55, alphaTest: 0.45, side: THREE.DoubleSide, fx: { edge: 0, dust: 0.25, grime: 0.2, ao: 0.6 } }),
};
// generic slot names used by builders and overridden per variant through spec.mats()
Object.assign(DEFS, {
  wood: () => DEFS.oak(), wood2: () => DEFS.walnut(), seat: () => DEFS.fabric(), fab: () => DEFS.fabric(), cushion: () => DEFS.fabric(),
  frame: () => DEFS.paint_grey(), body: () => DEFS.paint_beige(), shell: () => DEFS.plastic_grey(), trim: () => DEFS.plastic_black(), top: () => DEFS.laminate(),
  base: () => DEFS.paint_black(), drum: () => DEFS.plastic_blue(), lamp_metal: () => DEFS.brass(),
});
for (const [k, hex] of Object.entries(PAINTS)) DEFS['paint_' + k] = () => synthMaterial('paint_' + k, { set: 'paint', color: hex, fx: FXP.paint });
for (const [k, hex] of Object.entries(PLASTICS)) DEFS['plastic_' + k] = () => synthMaterial('plastic_' + k, { set: 'plastic', color: hex, rough: k === 'black' || k === 'darkgrey' ? 1.15 : 1, fx: k === 'black' || k === 'darkgrey' ? FXP.plasticDark : FXP.plastic });
export const PAINT_COLORS = PAINTS;

const cache = new Map();
export function matFor(slot, ov) {
  if (ov && ov[slot]) return ov[slot];
  let m = cache.get(slot);
  if (m) return m;
  const f = DEFS[slot];
  if (!f) throw new Error(`[furniture] unknown material slot '${slot}'`);
  m = f();
  cache.set(slot, m);
  return m;
}
export const hasMat = (slot) => !!DEFS[slot];

// Tinted copy of a slot material (cached by colour); keeps textures & fx
export function tint(slot, hex) {
  const key = `${slot}|${hex}`;
  let m = cache.get(key);
  if (!m) {
    m = cloneMat(matFor(slot));
    m.color.setHex(hex);
    cache.set(key, m);
  }
  return m;
}

export const matsReady = () => cache.size > 0;
export function warmMaterials() {
  for (const k of Object.keys(SETS)) { const S = setFor(k); Synth.pbr(S.recipe, S.opts); }
}
export function textureBytes() {
  let b = 0;
  for (const k of Object.keys(SETS)) { const s = Math.min(SETS[k][1].size || 512, SIZE_CAP); b += s * s * 4 * 3 * 1.333; }
  return b + 2048 * 2048 * 4 * 1.333 + 512 * 512 * 4; // label atlas (mipmapped) + its surface map
}
