// GPU texture synthesis: seamless PBR texture sets (albedo + tangent-space normal + ORM) rendered
// by fragment shaders in a private WebGL context, read back once and handed out as ordinary
// DataTextures (cloneable, so every material can have its own UV repeat while sharing one upload).
//
//   import * as Synth from './texsynth.js';
//   const t = Synth.pbr('wood', { c0: 0x4a2c18, c1: 0xa77a4f, size: 1024 });
//   t.map / t.normalMap / t.orm (R = ambient occlusion, G = roughness, B = metalness), t.meters
//   const m = Synth.pbrMaterial('fabric', { c0: 0x30405a, repeat: [4, 4] });   // MeshStandardMaterial
//   Synth.registerRecipe('my_surface', { glsl: 'S surface(vec2 uv){ ... }', defaults: {...} });
//   Synth.triplanar(material, { scale: 0.5, space: 'world' }); // for meshes without good UVs
//
// Recipe GLSL implements `S surface(vec2 uv)` over one seamless tile (uv in [0,1)), returning
// S{ vec3 albedo (linear); float height (0..1, relative); float rough; float ao; float metal; }.
// All noise helpers below are periodic over the tile, so every output tiles without seams.
// Uniforms available to recipes: uC0..uC3 (vec3 linear colours), uP0, uP1 (vec4 params),
// uWear (0..1), uSeed. Heights are turned into normals with central differences (uBump = slope).
import * as THREE from 'three';

let gl = null; // private synthesis renderer
const cache = new Map();
const matCache = new Map();
const recipes = {};
let maxAniso = 8;

export function setAnisotropy(n) { maxAniso = Math.max(1, n | 0); }

function synthRenderer() {
  if (gl) return gl;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4;
  gl = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  gl.setPixelRatio(1);
  gl.outputColorSpace = THREE.LinearSRGBColorSpace;
  gl.toneMapping = THREE.NoToneMapping;
  return gl;
}

// ---------------------------------------------------------------------------
// GLSL library (periodic noise, voronoi, helpers)
// ---------------------------------------------------------------------------
const LIB = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform int uPass;
uniform float uSeed, uTexel, uBump, uWear;
uniform vec3 uC0, uC1, uC2, uC3;
uniform vec4 uP0, uP1;
struct S { vec3 albedo; float height; float rough; float ao; float metal; };
#define PI 3.14159265
float sat(float x){ return clamp(x, 0.0, 1.0); }
float h12(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031 + uSeed * 0.01371); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec2 h22(vec2 p){ vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973) + uSeed * 0.01371); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
vec3 h32(vec2 p){ vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973) + uSeed * 0.01371); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yzz) * q.zyx); }
// periodic value noise / gradient noise: p in lattice units, per = integer period (lattice cells per tile)
float vn(vec2 p, vec2 per){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(mod(i, per)), h12(mod(i + vec2(1, 0), per)), u.x), mix(h12(mod(i + vec2(0, 1), per)), h12(mod(i + vec2(1, 1), per)), u.x), u.y); }
float gn(vec2 p, vec2 per){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 a = h22(mod(i, per)) * 2.0 - 1.0, b = h22(mod(i + vec2(1, 0), per)) * 2.0 - 1.0, c = h22(mod(i + vec2(0, 1), per)) * 2.0 - 1.0, d = h22(mod(i + vec2(1, 1), per)) * 2.0 - 1.0;
  float r = mix(mix(dot(a, f), dot(b, f - vec2(1, 0)), u.x), mix(dot(c, f - vec2(0, 1)), dot(d, f - vec2(1, 1)), u.x), u.y);
  return 0.5 + 0.75 * r; }
// fbm over the tile: base integer frequency f (per axis), octaves, lacunarity 2
float fbm(vec2 uv, vec2 f, int oct){ float s = 0.0, a = 0.5, n = 0.0; vec2 fr = f;
  for (int k = 0; k < 9; k++){ if (k >= oct) break; s += a * gn(uv * fr + vec2(float(k) * 7.31, float(k) * 3.17), fr); n += a; a *= 0.5; fr *= 2.0; }
  return s / n; }
float fbmv(vec2 uv, vec2 f, int oct){ float s = 0.0, a = 0.5, n = 0.0; vec2 fr = f;
  for (int k = 0; k < 9; k++){ if (k >= oct) break; s += a * vn(uv * fr + vec2(float(k) * 5.13, float(k) * 1.71), fr); n += a; a *= 0.5; fr *= 2.0; }
  return s / n; }
float ridged(vec2 uv, vec2 f, int oct){ float s = 0.0, a = 0.5, n = 0.0; vec2 fr = f;
  for (int k = 0; k < 9; k++){ if (k >= oct) break; float v = 1.0 - abs(gn(uv * fr + vec2(float(k) * 2.9, float(k) * 6.1), fr) * 2.0 - 1.0); s += a * v * v; n += a; a *= 0.5; fr *= 2.0; }
  return s / n; }
// periodic voronoi: x = F1, y = F2, z = cell hash, w = cell hash 2; per = cells per tile
vec4 vor(vec2 uv, vec2 per, float jit){ vec2 p = uv * per; vec2 i = floor(p), f = fract(p);
  float F1 = 9.0, F2 = 9.0; vec2 id = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)); vec2 c = mod(i + g, per);
    vec2 o = 0.5 + (h22(c) - 0.5) * jit; vec2 r = g + o - f; float d = dot(r, r);
    if (d < F1) { F2 = F1; F1 = d; id = c; } else if (d < F2) { F2 = d; } }
  return vec4(sqrt(F1), sqrt(F2), h12(id + 3.7), h12(id + 11.3)); }
// distance to the nearest cell border (proper edge distance) for crack / grout style patterns
vec3 vorEdge(vec2 uv, vec2 per, float jit){ vec2 p = uv * per; vec2 i = floor(p), f = fract(p);
  vec2 mg, mr; float md = 9.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(float(x), float(y)); vec2 o = 0.5 + (h22(mod(i + g, per)) - 0.5) * jit; vec2 r = g + o - f; float d = dot(r, r); if (d < md) { md = d; mr = r; mg = g; } }
  md = 9.0;
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) { vec2 g = mg + vec2(float(x), float(y)); vec2 o = 0.5 + (h22(mod(i + g, per)) - 0.5) * jit; vec2 r = g + o - f;
    if (dot(mr - r, mr - r) > 0.00001) md = min(md, dot(0.5 * (mr + r), normalize(r - mr))); }
  return vec3(md, h12(mod(i + mg, per) + 3.7), h12(mod(i + mg, per) + 9.1)); }
vec3 lum3(vec3 c, float k){ float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); return mix(vec3(l), c, k); }
vec3 srgbEnc(vec3 c){ c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
// thin random scratches: grid of hashed line segments
float scratches(vec2 uv, float n, float len, float width){
  float s = 0.0;
  for (int k = 0; k < 3; k++) {
    vec2 per = vec2(n + float(k) * 3.0); vec2 p = uv * per + float(k) * 0.37; vec2 c = floor(p), f = fract(p);
    vec3 h = h32(mod(c, per) + float(k) * 13.0);
    if (h.z > 0.55) continue;
    float a = h.x * PI; vec2 d = vec2(cos(a), sin(a)); vec2 o = vec2(0.5) + (h.yx - 0.5) * 0.4;
    vec2 q = f - o; float t = clamp(dot(q, d), -len, len); float dist = length(q - d * t);
    s = max(s, (1.0 - smoothstep(0.0, width, dist)) * (1.0 - abs(t) / len));
  }
  return s; }
`;

const MAIN = /* glsl */`
void main(){
  vec2 uv = vUv;
  if (uPass == 2) {
    float e = uTexel;
    float hl = surface(fract(uv - vec2(e, 0.0))).height, hr = surface(fract(uv + vec2(e, 0.0))).height;
    float hd = surface(fract(uv - vec2(0.0, e))).height, hu = surface(fract(uv + vec2(0.0, e))).height;
    vec3 n = normalize(vec3((hl - hr) * uBump, (hd - hu) * uBump, 2.0 * e * 512.0));
    gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
  } else {
    S s = surface(uv);
    if (uPass == 0) gl_FragColor = vec4(srgbEnc(s.albedo), 1.0);
    else gl_FragColor = vec4(sat(s.ao), clamp(s.rough, 0.02, 1.0), sat(s.metal), 1.0);
  }
}`;

const VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------
// defaults: c0..c3 colours (hex), p0/p1 params, wear, meters (physical size of one tile),
// bump (normal strength), size (texture resolution), metal (true if the B channel carries metal)
export function registerRecipe(name, def) { recipes[name] = def; }
export function hasRecipe(name) { return !!recipes[name]; }
export function recipeNames() { return Object.keys(recipes); }

registerRecipe('wood', {
  // solid wood / veneer, grain along U. p0: x ring count per tile (integer), y warp, z pore amount, w varnish roughness
  defaults: { c0: 0x5b3920, c1: 0xa5774a, c2: 0x2e1c10, p0: [24, 1, 1, 0.42], wear: 0.25, meters: 1, bump: 2.0, size: 1024 },
  glsl: `S surface(vec2 uv){
    float rings = floor(uP0.x + 0.5);
    float w = fbm(uv, vec2(2.0, 2.0), 5) - 0.5; float w2 = fbm(uv + 0.31, vec2(3.0, 8.0), 4) - 0.5;
    float y = uv.y + w * 0.035 * uP0.y + w2 * 0.012 + 0.022 * sin(uv.x * 2.0 * PI + w * 3.0);
    float r = y * rings; float ring = fract(r);
    float late = smoothstep(0.62, 0.92, ring) * (1.0 - smoothstep(0.93, 1.0, ring));
    float ringTone = h12(vec2(mod(floor(r), rings), 3.0));
    float streak = fbm(uv, vec2(2.0, 60.0), 4); float fine = gn(uv * vec2(4.0, 420.0), vec2(4.0, 420.0));
    vec3 col = mix(uC1, uC0, sat(late * 0.4 + (ringTone - 0.5) * 0.3 + (streak - 0.5) * 0.45));
    col *= 0.88 + fine * 0.2;
    col = mix(col, uC2, smoothstep(0.55, 0.85, fbm(uv + 2.7, vec2(1.0, 3.0), 3)) * 0.18);
    float pore = smoothstep(0.8, 0.95, gn(uv * vec2(10.0, 700.0), vec2(10.0, 700.0))) * sat(uP0.z) * (0.4 + late * 0.6);
    col = mix(col, uC2, pore * 0.5);
    float wearN = fbm(uv + 5.3, vec2(4.0, 4.0), 5); float worn = smoothstep(1.0 - uWear * 0.6, 1.05 - uWear * 0.6, wearN);
    float scr = scratches(uv, 9.0, 0.45, 0.01) * uWear;
    col = mix(col, col * 1.2 + 0.02, scr * 0.5);
    S s; s.albedo = col; s.height = 0.5 + (fine - 0.5) * 0.12 - pore * 0.3 - late * 0.04 - scr * 0.1;
    s.rough = mix(uP0.w, 0.8, worn * 0.8 + pore * 0.35) + scr * 0.15; s.ao = 1.0 - pore * 0.3; s.metal = 0.0; return s; }`,
});

registerRecipe('planks', {
  // boards along U: p0 x boards per tile, y seam width, z length breaks, w varnish roughness
  defaults: { c0: 0x6a4428, c1: 0xb48858, c2: 0x241509, p0: [5, 0.012, 2, 0.5], wear: 0.35, meters: 1, bump: 2.5, size: 1024 },
  glsl: `S surface(vec2 uv){
    float n = uP0.x; float row = floor(uv.y * n); float fy = fract(uv.y * n);
    float off = h12(vec2(row, 1.0)); float lu = fract(uv.x * uP0.z + off); float seg = mod(floor(uv.x * uP0.z + off), uP0.z);
    vec3 hb = h32(vec2(row, seg + 4.0));
    vec2 guv = vec2(uv.x * 1.0 + hb.x, fy / n + hb.y);
    float w = fbm(guv, vec2(2.0, 3.0), 4) - 0.5;
    float ring = fract((fy + w * 0.08 + 0.18 * sin(uv.x * 2.0 * PI + hb.x * 6.283 + w * 2.0)) * 5.0);
    float late = smoothstep(0.62, 0.92, ring) * (1.0 - smoothstep(0.93, 1.0, ring)) * 0.75;
    float fine = gn(uv * vec2(5.0, 420.0), vec2(5.0, 420.0));
    vec3 col = mix(uC1, uC0, late * 0.7 + (hb.z - 0.5) * 0.5) * (0.85 + fine * 0.28);
    float seamY = min(fy, 1.0 - fy) / n; float seamX = min(lu, 1.0 - lu) / uP0.z;
    float seam = 1.0 - smoothstep(0.0, uP0.y, min(seamY, seamX * 3.0));
    float bevel = 1.0 - smoothstep(0.0, uP0.y * 2.5, min(seamY, seamX * 3.0));
    float wearN = fbm(uv + 1.3, vec2(4.0, 4.0), 5); float worn = smoothstep(1.0 - uWear * 0.55, 1.05 - uWear * 0.55, wearN);
    col = mix(col, uC2, seam * 0.85); col = mix(col, col * 0.75 + vec3(0.04, 0.03, 0.02), worn * 0.5);
    S s; s.albedo = col; s.height = 0.6 - seam * 0.6 - bevel * 0.15 + (fine - 0.5) * 0.15; s.rough = mix(uP0.w, 0.9, worn) + seam * 0.3; s.ao = 1.0 - seam * 0.6; s.metal = 0.0; return s; }`,
});

registerRecipe('fabric', {
  // woven cloth. p0: x/y thread counts per tile, z twill (0 plain, 1 twill), w fuzz. c0 base, c1 thread tone, c2 fleck
  defaults: { c0: 0x3c4f6e, c1: 0x56698a, c2: 0x8a96a8, c3: 0x000000, p0: [64, 64, 0, 0.5], p1: [0.05, 0, 0, 0], wear: 0.2, meters: 0.25, bump: 3.0, size: 1024 },
  glsl: `S surface(vec2 uv){
    vec2 t = uv * uP0.xy; vec2 c = floor(t), f = fract(t);
    float over = uP0.z > 0.5 ? step(1.5, mod(c.x + c.y * 2.0, 3.0)) : mod(c.x + c.y, 2.0);
    float warp = pow(max(0.0, sin(PI * f.x)), 0.45), weft = pow(max(0.0, sin(PI * f.y)), 0.45);
    float bulgeW = 0.75 + 0.25 * sin(PI * f.y), bulgeF = 0.75 + 0.25 * sin(PI * f.x);
    float hw = warp * bulgeW * (over > 0.5 ? 1.0 : 0.7), hf = weft * bulgeF * (over > 0.5 ? 0.7 : 1.0);
    float h = max(hw, hf); bool onWarp = hw > hf;
    vec2 pa = floor(uP0.xy * vec2(6.0, 0.75)), pb = floor(uP0.xy * vec2(0.75, 6.0));
    float fib = onWarp ? gn(uv * pa, pa) : gn(uv * pb, pb);
    float tone = h12(onWarp ? vec2(mod(c.x, uP0.x), 7.0) : vec2(13.0, mod(c.y, uP0.y)));
    vec3 col = mix(uC0, uC1, tone * 0.8); col = mix(col, uC2, step(0.975, h12(mod(c, uP0.xy) + 0.5)) * 0.35);
    col *= 0.62 + h * 0.42 + (fib - 0.5) * 0.2;
    float gap = 1.0 - smoothstep(0.02, 0.22, h);
    col = mix(col, col * 0.25, gap * (1.0 - uP1.x));
    float fuzz = fbm(uv, vec2(24.0), 4); col *= 0.92 + fuzz * 0.16 * uP0.w;
    float dirt = smoothstep(0.55, 0.9, fbm(uv + 3.3, vec2(3.0), 5)) * uWear;
    col = mix(col, col * vec3(0.72, 0.66, 0.56), dirt * 0.6);
    S s; s.albedo = col; s.height = h * 0.85 + (fib - 0.5) * 0.12 + fuzz * 0.05 * uP0.w; s.rough = 0.86 + gap * 0.1 - h * 0.05; s.ao = 0.55 + h * 0.45; s.metal = 0.0; return s; }`,
});

registerRecipe('burlap', {
  // coarse open jute weave with see-through gaps and loose fibres
  defaults: { c0: 0xc9a977, c1: 0xb48f5a, c2: 0x6e5130, p0: [26, 26, 0.6, 0.8], wear: 0.15, meters: 0.3, bump: 3.5, size: 1024 },
  glsl: `S surface(vec2 uv){
    vec2 wob = vec2(fbm(uv, vec2(5.0), 3) - 0.5, fbm(uv + 7.1, vec2(5.0), 3) - 0.5) * 0.35 / uP0.xy;
    vec2 t = (uv + wob) * uP0.xy; vec2 c = floor(t), f = fract(t);
    float thW = 0.36 + 0.14 * h12(vec2(mod(c.x, uP0.x), 2.0)) + 0.1 * (vn(vec2(c.x, uv.y * 12.0), vec2(uP0.x, 12.0)) - 0.5);
    float thF = 0.36 + 0.14 * h12(vec2(5.0, mod(c.y, uP0.y))) + 0.1 * (vn(vec2(uv.x * 12.0, c.y), vec2(12.0, uP0.y)) - 0.5);
    float pw = sat(1.0 - abs(f.x - 0.5) / thW), pf = sat(1.0 - abs(f.y - 0.5) / thF);
    pw = sqrt(pw); pf = sqrt(pf);
    float over = mod(c.x + c.y, 2.0);
    float hw = pw * (0.7 + 0.3 * sin(PI * f.y)) * (over > 0.5 ? 1.0 : 0.75), hf = pf * (0.7 + 0.3 * sin(PI * f.x)) * (over > 0.5 ? 0.75 : 1.0);
    float h = max(hw, hf); bool onW = hw > hf;
    vec2 pa = floor(uP0.xy * vec2(9.0, 1.2)), pb = floor(uP0.xy * vec2(1.2, 9.0));
    float fib = onW ? gn(uv * pa, pa) : gn(uv * pb, pb);
    float tone = h12(onW ? vec2(mod(c.x, uP0.x), 1.0) : vec2(3.0, mod(c.y, uP0.y)));
    vec3 col = mix(uC0, uC1, tone * 0.9) * (0.72 + h * 0.38) * (0.85 + fib * 0.3);
    float gap = 1.0 - smoothstep(0.0, 0.18, h);
    col = mix(col, uC2 * 0.35, gap * uP0.z);
    float hair = smoothstep(0.86, 0.98, gn(uv * vec2(70.0, 9.0) + fib, vec2(70.0, 9.0))) * uP0.w;
    col = mix(col, uC0 * 1.12, hair * 0.4);
    float stain = smoothstep(0.6, 0.85, fbm(uv + 4.4, vec2(2.0), 5)) * uWear; col *= 1.0 - stain * 0.35;
    S s; s.albedo = col; s.height = h + fib * 0.08 + hair * 0.15; s.rough = 0.92; s.ao = 0.45 + 0.55 * h; s.metal = 0.0; return s; }`,
});

registerRecipe('felt', {
  defaults: { c0: 0xd2302b, c1: 0xb02420, c2: 0xe8604a, p0: [1, 0, 0, 0], wear: 0.0, meters: 0.2, bump: 1.2, size: 512 },
  glsl: `S surface(vec2 uv){
    float a = fbm(uv, vec2(16.0), 5); float b = fbm(uv + 2.0, vec2(64.0), 3); float pill = smoothstep(0.72, 0.85, fbm(uv + 9.0, vec2(30.0), 3));
    vec3 col = mix(uC1, uC0, a) * (0.9 + b * 0.18); col = mix(col, uC2, pill * 0.35);
    S s; s.albedo = col; s.height = a * 0.6 + b * 0.3 + pill * 0.3; s.rough = 1.0; s.ao = 0.8 + a * 0.2; s.metal = 0.0; return s; }`,
});

registerRecipe('leather', {
  // pebbled leather with creases; p0: x pebble density, y crease amount, z polish (lower = glossier)
  defaults: { c0: 0x5a3322, c1: 0x7a4a30, c2: 0x2a160c, p0: [190, 0.6, 0.48, 0], wear: 0.3, meters: 0.4, bump: 2.0, size: 1024 },
  glsl: `S surface(vec2 uv){
    vec4 v = vor(uv, vec2(uP0.x), 0.9); float peb = smoothstep(0.0, 0.3, v.y - v.x);
    float cr = ridged(uv, vec2(3.0, 5.0), 5); float crease = smoothstep(0.55, 0.95, cr) * uP0.y;
    float m = fbm(uv, vec2(4.0), 5);
    vec3 col = mix(uC0, uC1, m * 0.8 + v.z * 0.15) * (0.8 + peb * 0.25); col = mix(col, uC2, crease * 0.6);
    float wearN = smoothstep(1.0 - uWear * 0.5, 1.0, fbm(uv + 6.0, vec2(5.0), 5)); col = mix(col, col * 1.35 + 0.03, wearN * 0.5);
    S s; s.albedo = col; s.height = peb * 0.5 - crease * 0.5 + m * 0.1; s.rough = uP0.z + (1.0 - peb) * 0.15 + crease * 0.2 + wearN * 0.15; s.ao = 0.75 + peb * 0.25 - crease * 0.3; s.metal = 0.0; return s; }`,
});

registerRecipe('vinyl', {
  defaults: { c0: 0x2a2c30, c1: 0x34373c, p0: [180, 0.5, 0, 0], wear: 0.25, meters: 0.3, bump: 1.4, size: 512 },
  glsl: `S surface(vec2 uv){
    vec4 v = vor(uv, vec2(uP0.x), 1.0); float peb = smoothstep(0.0, 0.25, v.y - v.x);
    float m = fbm(uv, vec2(5.0), 4); float scuff = smoothstep(1.0 - uWear * 0.5, 1.0, fbm(uv + 3.0, vec2(6.0), 5));
    vec3 col = mix(uC0, uC1, m) * (0.9 + peb * 0.12); col = mix(col, col * 1.6 + 0.04, scuff * 0.4);
    S s; s.albedo = col; s.height = peb * 0.4 + m * 0.1; s.rough = uP0.y + (1.0 - peb) * 0.1 + scuff * 0.2; s.ao = 0.85 + peb * 0.15; s.metal = 0.0; return s; }`,
});

registerRecipe('carpet', {
  // cut / loop pile with flecks and stains. p0: x loop density, y fleck amount, z stain amount, w dampness
  defaults: { c0: 0x8a7a4a, c1: 0x6d5f36, c2: 0x3a3020, c3: 0xa79b6a, p0: [180, 0.5, 0.5, 0.3], wear: 0.4, meters: 1, bump: 2.5, size: 1024 },
  glsl: `S surface(vec2 uv){
    vec4 v = vor(uv, vec2(uP0.x), 1.0); float tuft = 1.0 - smoothstep(0.0, 0.62, v.x);
    float fine = gn(uv * 900.0, vec2(900.0)); float m = fbm(uv, vec2(6.0), 5);
    vec3 col = mix(uC1, uC0, m * 0.7 + v.z * 0.3); col = mix(col, uC3, step(1.0 - uP0.y * 0.12, v.w) * 0.8);
    col *= 0.72 + tuft * 0.35 + (fine - 0.5) * 0.15;
    float st = fbm(uv + 1.7, vec2(2.0), 6); float stain = smoothstep(0.58, 0.72, st) * uP0.z;
    float ring = (1.0 - smoothstep(0.0, 0.015, abs(st - 0.6))) * uP0.z * 0.6;
    float path = smoothstep(0.5, 0.85, fbm(uv + 8.2, vec2(1.0, 3.0), 4)) * uWear;
    col = mix(col, uC2, sat(stain * 0.65 + ring * 0.5 + path * 0.35));
    float damp = smoothstep(0.55, 0.8, fbm(uv + 12.0, vec2(3.0), 5)) * uP0.w;
    col *= 1.0 - damp * 0.25;
    S s; s.albedo = col; s.height = tuft * 0.7 + fine * 0.2 - path * 0.15; s.rough = 0.97 - damp * 0.25; s.ao = 0.6 + tuft * 0.4; s.metal = 0.0; return s; }`,
});

registerRecipe('paint_metal', {
  // painted steel with chips (bare metal / rust), scratches and orange peel. c0 paint, c1 bare steel, c2 rust, c3 primer
  defaults: { c0: 0x3f5a46, c1: 0x8a8d90, c2: 0x6a3a1c, c3: 0x8a6a52, p0: [0.38, 0.5, 0, 0], wear: 0.35, meters: 0.6, bump: 1.6, size: 1024, metal: true },
  glsl: `S surface(vec2 uv){
    float peel = fbm(uv, vec2(6.0), 6); float chipN = fbm(uv + 3.1, vec2(10.0), 5) * 0.7 + gn(uv * 60.0, vec2(60.0)) * 0.3;
    float chip = smoothstep(1.0 - uWear * 0.75, 1.02 - uWear * 0.75, chipN);
    float primer = smoothstep(1.0 - uWear * 0.85, 1.0 - uWear * 0.75, chipN) * (1.0 - chip);
    float rustN = fbm(uv + 7.7, vec2(5.0), 5); float rust = chip * smoothstep(0.45, 0.7, rustN) * uP0.y;
    float scr = scratches(uv, 7.0, 0.42, 0.006) * sat(uWear * 1.6);
    float orange = gn(uv * 260.0, vec2(260.0));
    vec3 paint = uC0 * (0.92 + peel * 0.12 + (orange - 0.5) * 0.04);
    float grime = smoothstep(0.55, 0.85, fbm(uv + 9.9, vec2(3.0), 5)) * uWear; paint *= 1.0 - grime * 0.3;
    vec3 col = mix(paint, uC3, primer * 0.7); col = mix(col, mix(uC1, uC2, rust), chip); col = mix(col, uC1 * 1.1, scr * 0.8);
    S s; s.albedo = col; s.height = 0.6 + orange * 0.03 - chip * 0.35 - primer * 0.1 - scr * 0.2 + rust * 0.1;
    s.metal = max(chip * (1.0 - rust), scr); s.rough = mix(mix(uP0.x, 0.6, primer), mix(0.38, 0.9, rust), chip); s.rough = mix(s.rough, 0.3, scr);
    s.ao = 1.0 - chip * 0.15; return s; }`,
});

registerRecipe('metal', {
  // brushed / worn bare metal. p0: x brush strength, y base roughness, z pitting
  defaults: { c0: 0xb9bcbf, c1: 0x7a7d80, c2: 0x4a3a2a, p0: [1, 0.32, 0.3, 0], wear: 0.3, meters: 0.5, bump: 0.8, size: 1024, metal: true },
  glsl: `S surface(vec2 uv){
    float br = gn(uv * vec2(4.0, 700.0), vec2(4.0, 700.0)) * 0.6 + gn(uv * vec2(2.0, 260.0) + 3.0, vec2(2.0, 260.0)) * 0.4;
    float m = fbm(uv, vec2(5.0), 5); float pit = smoothstep(0.82, 0.95, gn(uv * 120.0, vec2(120.0))) * uP0.z;
    float smudge = smoothstep(0.5, 0.8, fbm(uv + 2.2, vec2(3.0), 5)) * uWear; float scr = scratches(uv, 8.0, 0.45, 0.004) * uWear;
    vec3 col = mix(uC1, uC0, 0.55 + (br - 0.5) * 0.5 * uP0.x + (m - 0.5) * 0.4); col = mix(col, uC2, pit * 0.6 + smudge * 0.15);
    S s; s.albedo = col; s.height = 0.5 + (br - 0.5) * 0.2 * uP0.x - pit * 0.4 - scr * 0.2; s.rough = uP0.y + (br - 0.5) * 0.12 * uP0.x + smudge * 0.25 + pit * 0.3 - scr * 0.1; s.ao = 1.0 - pit * 0.3; s.metal = 1.0 - pit * 0.6; return s; }`,
});

registerRecipe('rust', {
  defaults: { c0: 0x7a3b16, c1: 0x4a2410, c2: 0xa86a2c, c3: 0x5a5e60, p0: [0.7, 0, 0, 0], wear: 0.5, meters: 0.6, bump: 3.0, size: 1024, metal: true },
  glsl: `S surface(vec2 uv){
    float a = fbm(uv, vec2(4.0), 7); float b = ridged(uv + 1.3, vec2(6.0), 5); float flake = smoothstep(0.55, 0.75, fbm(uv + 4.0, vec2(14.0), 4));
    float metalP = smoothstep(0.62, 0.8, fbm(uv + 8.0, vec2(5.0), 5)) * (1.0 - uP0.x);
    vec3 col = mix(uC1, uC0, a); col = mix(col, uC2, b * 0.45); col = mix(col, uC1 * 0.6, flake * 0.4); col = mix(col, uC3, metalP);
    S s; s.albedo = col; s.height = a * 0.6 + b * 0.3 + flake * 0.25 - metalP * 0.3; s.rough = mix(0.95, 0.45, metalP); s.ao = 0.6 + a * 0.4; s.metal = metalP; return s; }`,
});

registerRecipe('concrete', {
  // p0: x aggregate density, y crack amount, z pore amount, w stain amount
  defaults: { c0: 0x9a968e, c1: 0x7a766e, c2: 0x4a4640, c3: 0xb8b2a6, p0: [70, 0.4, 0.6, 0.5], wear: 0.4, meters: 2, bump: 2.0, size: 1024 },
  glsl: `S surface(vec2 uv){
    float m = fbm(uv, vec2(4.0), 7); float d = fbm(uv + 2.0, vec2(20.0), 4);
    vec4 ag = vor(uv, vec2(uP0.x), 1.0); float agg = smoothstep(0.24, 0.1, ag.x) * step(0.6, ag.z);
    float pore = smoothstep(0.9, 0.98, gn(uv * 220.0, vec2(220.0))) * uP0.z;
    vec3 ce = vorEdge(uv, vec2(3.0), 1.0); float crack = (1.0 - smoothstep(0.0, 0.006, ce.x)) * step(0.62, ce.y) * uP0.y * smoothstep(0.35, 0.6, fbm(uv + 5.0, vec2(3.0), 4));
    float stain = smoothstep(0.55, 0.8, fbm(uv + 9.0, vec2(2.0), 6)) * uP0.w; float drip = smoothstep(0.7, 0.95, gn(uv * vec2(30.0, 2.0), vec2(30.0, 2.0))) * smoothstep(0.4, 0.9, fbm(uv + 3.0, vec2(4.0), 3)) * uWear;
    vec3 col = mix(uC1, uC0, m) * (0.9 + d * 0.15); col = mix(col, mix(uC2, uC3, ag.w), agg * 0.3); col = mix(col, uC2 * 0.6, sat(stain * 0.45 + drip * 0.35 + crack * 0.9 + pore * 0.85));
    S s; s.albedo = col; s.height = m * 0.4 + d * 0.15 + agg * 0.12 - pore * 0.5 - crack * 0.6; s.rough = 0.88 + d * 0.08 - stain * 0.1; s.ao = 1.0 - pore * 0.5 - crack * 0.5; s.metal = 0.0; return s; }`,
});

registerRecipe('plaster', {
  // painted plaster / drywall with orange-peel bumps, scuffs and stains
  defaults: { c0: 0xd8cdb4, c1: 0xc4b89c, c2: 0x8a7a5a, p0: [0.85, 0.5, 0, 0], wear: 0.3, meters: 1.5, bump: 1.0, size: 1024 },
  glsl: `S surface(vec2 uv){
    float peel = gn(uv * 220.0, vec2(220.0)) * 0.6 + gn(uv * 90.0 + 2.0, vec2(90.0)) * 0.4; float m = fbm(uv, vec2(3.0), 6);
    float scuff = smoothstep(1.0 - uWear * 0.4, 1.0, fbm(uv + 4.0, vec2(8.0, 3.0), 5)); float stain = smoothstep(0.6, 0.85, fbm(uv + 7.0, vec2(2.0), 6)) * uP0.y;
    vec3 col = mix(uC1, uC0, 0.6 + (m - 0.5) * 0.6) * (0.97 + peel * 0.05); col = mix(col, uC2, stain * 0.35 + scuff * 0.25);
    S s; s.albedo = col; s.height = peel * 0.4 + m * 0.1; s.rough = uP0.x + (peel - 0.5) * 0.08; s.ao = 1.0; s.metal = 0.0; return s; }`,
});

registerRecipe('tiles', {
  // square / rect ceramic tiles: p0 x tiles across, y tiles down, z grout width (uv of a tile), w glaze roughness
  // p1: x per-tile tone variation, y crack amount, z bevel, w dirt in grout. c0 tile, c1 grout, c2 dirt, c3 alt tile (checker if p1.?)
  defaults: { c0: 0xeef0ec, c1: 0xb8b8b0, c2: 0x5a5444, c3: 0xeef0ec, p0: [4, 4, 0.045, 0.08], p1: [0.06, 0.25, 0.12, 0.5], wear: 0.3, meters: 0.6, bump: 2.5, size: 1024 },
  glsl: `S surface(vec2 uv){
    vec2 t = uv * uP0.xy; vec2 c = floor(t), f = fract(t);
    vec2 e = min(f, 1.0 - f); float edge = min(e.x, e.y);
    float g = uP0.z; float grout = 1.0 - smoothstep(g * 0.5, g * 0.5 + 0.004, edge);
    float bev = smoothstep(g * 0.5, g * 0.5 + uP1.z * 0.3, edge);
    vec3 th = h32(mod(c, uP0.xy) + 0.5);
    vec3 tcol = mix(uC0, uC3, step(0.5, mod(c.x + c.y, 2.0))) * (1.0 + (th.x - 0.5) * uP1.x * 2.0);
    float wav = fbm(uv * 1.0 + th.yz, vec2(uP0.x * 2.0, uP0.y * 2.0), 3);
    float crack = (1.0 - smoothstep(0.0, 0.004, abs(gn(f * 3.0 + th.xy * 7.0, vec2(3.0)) - 0.5) * 0.25)) * step(1.0 - uP1.y * 0.25, th.z) * (1.0 - grout);
    float dirt = smoothstep(0.45, 0.8, fbm(uv + 6.0, vec2(4.0), 5)) * uWear;
    vec3 gcol = mix(uC1, uC2, sat(uP1.w * 0.6 + dirt * 0.6));
    vec3 col = mix(tcol * (1.0 - dirt * 0.12), gcol, grout); col = mix(col, uC2, crack * 0.7);
    S s; s.albedo = col; s.height = grout > 0.5 ? 0.2 : 0.2 + bev * 0.75 + (wav - 0.5) * 0.04 - crack * 0.3;
    s.rough = mix(uP0.w + (wav - 0.5) * 0.04 + dirt * 0.1, 0.92, grout); s.ao = 1.0 - grout * 0.45 - (1.0 - bev) * 0.2; s.metal = 0.0; return s; }`,
});

registerRecipe('acoustic', {
  // drop-ceiling acoustic tile surface: fissures, pinholes, water stains
  defaults: { c0: 0xe6e0cc, c1: 0xcfc6ad, c2: 0x8a6a3a, p0: [0.5, 0.5, 0, 0], wear: 0.3, meters: 0.6, bump: 2.0, size: 1024 },
  glsl: `S surface(vec2 uv){
    float f1 = ridged(uv, vec2(18.0), 3); float fis = smoothstep(0.82, 0.95, f1);
    float pin = smoothstep(0.86, 0.96, gn(uv * 220.0, vec2(220.0)));
    float m = fbm(uv, vec2(5.0), 5); float st = fbm(uv + 3.3, vec2(1.0), 6);
    float stain = smoothstep(0.62, 0.72, st) * uP0.x; float ring = (1.0 - smoothstep(0.0, 0.012, abs(st - 0.66))) * uP0.x;
    vec3 col = mix(uC1, uC0, m) * (1.0 - fis * 0.3 - pin * 0.35); col = mix(col, uC2, sat(stain * 0.35 + ring * 0.6));
    S s; s.albedo = col; s.height = 0.6 - fis * 0.5 - pin * 0.4 + m * 0.1; s.rough = 1.0; s.ao = 1.0 - fis * 0.4 - pin * 0.3; s.metal = 0.0; return s; }`,
});

registerRecipe('wallpaper', {
  // Backrooms wallpaper: faint vertical stripes + repeating chevron motif, paper fibre, stains, seams.
  // p0: x strips per tile, y motif strength, z seam, w stain amount
  defaults: { c0: 0xc9b26a, c1: 0xb39a52, c2: 0x7a6430, c3: 0xd8c47c, p0: [2, 0.5, 1, 0.5], wear: 0.4, meters: 1.2, bump: 1.4, size: 1024 },
  glsl: `S surface(vec2 uv){
    float strips = uP0.x; float sx = fract(uv.x * strips);
    vec2 mu = vec2(fract(uv.x * strips * 4.0), fract(uv.y * strips * 6.0));
    float chev = abs(fract(mu.y + abs(mu.x - 0.5) * 0.8) - 0.5); float motif = 1.0 - smoothstep(0.08, 0.14, chev);
    float stripe = smoothstep(0.42, 0.5, abs(fract(uv.x * strips * 4.0) - 0.5));
    float paper = gn(uv * vec2(600.0, 600.0), vec2(600.0)) * 0.5 + fbm(uv, vec2(40.0), 3) * 0.5;
    float m = fbm(uv, vec2(3.0), 6);
    vec3 col = mix(uC1, uC0, 0.55 + (m - 0.5) * 0.5); col = mix(col, uC3, motif * uP0.y * 0.35); col = mix(col, uC1, stripe * uP0.y * 0.25);
    col *= 0.94 + paper * 0.1;
    float seam = (1.0 - smoothstep(0.0, 0.004, min(sx, 1.0 - sx))) * uP0.z;
    float stN = fbm(uv + 1.9, vec2(2.0, 1.0), 6); float stain = smoothstep(0.6, 0.75, stN) * uP0.w; float tide = (1.0 - smoothstep(0.0, 0.01, abs(stN - 0.62))) * uP0.w;
    float drip = smoothstep(0.75, 0.95, gn(uv * vec2(24.0, 1.0), vec2(24.0, 1.0))) * smoothstep(0.3, 1.0, uv.y) * uWear;
    col = mix(col, uC2, sat(stain * 0.4 + tide * 0.5 + drip * 0.3)); col = mix(col, uC2 * 0.8, seam * 0.5);
    S s; s.albedo = col; s.height = paper * 0.3 + motif * 0.05 * uP0.y + seam * 0.4; s.rough = 0.88 - stain * 0.1; s.ao = 1.0 - seam * 0.3; s.metal = 0.0; return s; }`,
});

registerRecipe('plastic', {
  // aged moulded plastic: subtle mottling, micro scratches, yellowing, grime. p0: x roughness, y texture (stipple)
  defaults: { c0: 0xcfc4a6, c1: 0xb8aa86, c2: 0x5a5040, p0: [0.45, 0.4, 0, 0], wear: 0.3, meters: 0.4, bump: 0.8, size: 512 },
  glsl: `S surface(vec2 uv){
    float st = gn(uv * 300.0, vec2(300.0)); float m = fbm(uv, vec2(3.0), 5); float yel = smoothstep(0.4, 0.8, fbm(uv + 2.0, vec2(2.0), 4)) * uWear;
    float scr = scratches(uv, 10.0, 0.4, 0.004) * uWear; float grime = smoothstep(0.6, 0.85, fbm(uv + 5.0, vec2(4.0), 5)) * uWear;
    vec3 col = uC0 * (0.95 + (m - 0.5) * 0.1); col = mix(col, uC1, yel * 0.5); col = mix(col, uC2, grime * 0.3); col = mix(col, col * 1.15 + 0.02, scr);
    S s; s.albedo = col; s.height = 0.5 + (st - 0.5) * 0.2 * uP0.y - scr * 0.2; s.rough = uP0.x + (st - 0.5) * 0.1 * uP0.y + grime * 0.2 - scr * 0.1; s.ao = 1.0 - grime * 0.2; s.metal = 0.0; return s; }`,
});

registerRecipe('rubber', {
  defaults: { c0: 0x1c1c1e, c1: 0x2a2a2c, c2: 0x5a5a58, p0: [0.85, 0, 0, 0], wear: 0.3, meters: 0.3, bump: 1.0, size: 512 },
  glsl: `S surface(vec2 uv){
    float st = gn(uv * 400.0, vec2(400.0)); float m = fbm(uv, vec2(4.0), 5); float dust = smoothstep(0.55, 0.85, fbm(uv + 1.0, vec2(5.0), 5)) * uWear;
    vec3 col = mix(uC0, uC1, m) ; col = mix(col, uC2, dust * 0.4);
    S s; s.albedo = col; s.height = st * 0.3 + m * 0.1; s.rough = uP0.x + dust * 0.1; s.ao = 1.0; s.metal = 0.0; return s; }`,
});

registerRecipe('hazmat', {
  // crinkled PVC / Tyvek: large soft creases + fine crinkle, satin sheen
  defaults: { c0: 0xf2c418, c1: 0xd8a810, c2: 0x5a4a20, p0: [0.42, 1, 0, 0], wear: 0.25, meters: 0.6, bump: 2.0, size: 1024 },
  glsl: `S surface(vec2 uv){
    float big = ridged(uv, vec2(3.0, 2.0), 4); float crink = ridged(uv + 0.7, vec2(14.0, 10.0), 4); float m = fbm(uv, vec2(4.0), 5);
    float dirt = smoothstep(0.55, 0.85, fbm(uv + 6.0, vec2(3.0), 6)) * uWear;
    vec3 col = mix(uC1, uC0, 0.7 + (m - 0.5) * 0.4 + big * 0.15) ; col = mix(col, uC2, dirt * 0.4);
    S s; s.albedo = col; s.height = big * 0.6 * uP0.y + crink * 0.25; s.rough = uP0.x + crink * 0.12 + dirt * 0.25; s.ao = 0.75 + big * 0.25; s.metal = 0.0; return s; }`,
});

registerRecipe('cardboard', {
  defaults: { c0: 0xb48a58, c1: 0x9a7448, c2: 0x5a4028, p0: [24, 0.4, 0, 0], wear: 0.3, meters: 0.6, bump: 1.2, size: 512 },
  glsl: `S surface(vec2 uv){
    float fib = gn(uv * vec2(80.0, 500.0), vec2(80.0, 500.0)); float m = fbm(uv, vec2(4.0), 5);
    float corr = 0.5 + 0.5 * sin(uv.y * uP0.x * 2.0 * PI); float stain = smoothstep(0.62, 0.8, fbm(uv + 3.0, vec2(2.0), 6)) * uWear;
    vec3 col = mix(uC1, uC0, m) * (0.92 + fib * 0.14) * (0.97 + corr * 0.05 * uP0.y); col = mix(col, uC2, stain * 0.45);
    S s; s.albedo = col; s.height = corr * 0.25 * uP0.y + fib * 0.15; s.rough = 0.93; s.ao = 0.9 + corr * 0.1; s.metal = 0.0; return s; }`,
});

registerRecipe('paper', {
  defaults: { c0: 0xf1eee4, c1: 0xe0dbc8, c2: 0x9a8a6a, p0: [0, 0, 0, 0], wear: 0.2, meters: 0.3, bump: 0.6, size: 512 },
  glsl: `S surface(vec2 uv){
    float fib = fbm(uv, vec2(60.0), 3); float m = fbm(uv, vec2(3.0), 5); float stain = smoothstep(0.62, 0.8, fbm(uv + 2.0, vec2(2.0), 5)) * uWear;
    vec3 col = mix(uC1, uC0, m) * (0.96 + fib * 0.06); col = mix(col, uC2, stain * 0.3);
    S s; s.albedo = col; s.height = fib * 0.4; s.rough = 0.9; s.ao = 1.0; s.metal = 0.0; return s; }`,
});

registerRecipe('linoleum', {
  // waxed vinyl tiles in a checker. p0: x tiles across, y gap
  defaults: { c0: 0xd8d8cc, c1: 0x6e7a76, c2: 0x3a3830, p0: [4, 0.006, 0.35, 0], wear: 0.4, meters: 1.2, bump: 1.2, size: 1024 },
  glsl: `S surface(vec2 uv){
    vec2 t = uv * uP0.x; vec2 c = floor(t), f = fract(t); float chk = mod(c.x + c.y, 2.0);
    float speck = smoothstep(0.75, 0.9, gn(uv * 260.0, vec2(260.0))); float m = fbm(uv, vec2(5.0), 5);
    vec2 e = min(f, 1.0 - f); float gap = 1.0 - smoothstep(0.0, uP0.y * uP0.x, min(e.x, e.y));
    float scuff = scratches(uv, 6.0, 0.45, 0.01) * uWear; float grime = smoothstep(0.5, 0.85, fbm(uv + 7.0, vec2(3.0), 5)) * uWear;
    vec3 col = mix(uC0, uC1, chk) * (0.94 + (m - 0.5) * 0.12) * (1.0 - speck * 0.08); col = mix(col, uC2, sat(gap * 0.7 + scuff * 0.4 + grime * 0.25));
    S s; s.albedo = col; s.height = 0.5 - gap * 0.4 - scuff * 0.1; s.rough = uP0.z + grime * 0.3 + scuff * 0.2 + gap * 0.3; s.ao = 1.0 - gap * 0.4; s.metal = 0.0; return s; }`,
});

registerRecipe('terrazzo', {
  defaults: { c0: 0xd6d2c8, c1: 0x8a8478, c2: 0x5a6a72, c3: 0xa8604a, p0: [60, 0.3, 0.22, 0], wear: 0.2, meters: 1, bump: 0.6, size: 1024 },
  glsl: `S surface(vec2 uv){
    vec4 v = vor(uv, vec2(uP0.x), 1.0); float chip = smoothstep(0.38, 0.3, v.x) * step(0.4, v.z);
    vec3 cc = v.w < 0.4 ? uC1 : v.w < 0.75 ? uC2 : uC3; float m = fbm(uv, vec2(4.0), 5);
    vec3 col = mix(uC0 * (0.95 + m * 0.08), cc, chip);
    S s; s.albedo = col; s.height = 0.5 + chip * 0.05; s.rough = uP0.z + m * 0.1; s.ao = 1.0; s.metal = 0.0; return s; }`,
});

registerRecipe('brick', {
  defaults: { c0: 0x8a4a32, c1: 0xb8b0a0, c2: 0x5a2e1e, p0: [4, 10, 0.008, 0], wear: 0.3, meters: 1, bump: 3.0, size: 1024 },
  glsl: `S surface(vec2 uv){
    vec2 t = vec2(uv.x * uP0.x, uv.y * uP0.y); float row = floor(t.y); t.x += mod(row, 2.0) * 0.5; vec2 c = floor(t), f = fract(t);
    vec2 e = min(f, 1.0 - f); float wx = uP0.z * uP0.x * 0.5, wy = uP0.z * uP0.y * 0.5;
    float mortar = 1.0 - smoothstep(0.0, 0.03, min(e.x - wx, e.y - wy));
    vec3 hb = h32(mod(c, vec2(uP0.x, uP0.y)) + 0.5); float m = fbm(uv, vec2(8.0), 5);
    vec3 bc = mix(uC0, uC2, hb.x * 0.6) * (0.85 + m * 0.3);
    vec3 col = mix(bc, uC1 * (0.8 + m * 0.2), mortar);
    S s; s.albedo = col; s.height = mortar > 0.5 ? 0.2 : 0.7 + (m - 0.5) * 0.3; s.rough = 0.9; s.ao = 1.0 - mortar * 0.4; s.metal = 0.0; return s; }`,
});

registerRecipe('ground', {
  // meadow ground seen from above: grass blades, soil, pebbles. c0 grass light, c1 grass dark, c2 soil, c3 dry grass
  defaults: { c0: 0x6f8a3a, c1: 0x3f5a22, c2: 0x5a4632, c3: 0xa89a5a, p0: [0.7, 0.3, 0.25, 0], wear: 0.0, meters: 2, bump: 2.5, size: 1024 },
  glsl: `S surface(vec2 uv){
    float cover = smoothstep(0.35, 0.6, fbm(uv, vec2(3.0), 6) * 0.6 + uP0.x * 0.5);
    float blades = 0.0; float bt = 0.0;
    for (int k = 0; k < 4; k++) {
      float fk = float(k); vec2 per = vec2(90.0 + fk * 23.0); vec2 p = uv * per + fk * 0.31; vec2 c = floor(p), f = fract(p);
      vec3 h = h32(mod(c, per) + fk * 17.0); float a = h.x * PI; vec2 d = vec2(cos(a), sin(a)); vec2 q = f - (0.5 + (h.yz - 0.5) * 0.5);
      float tt = clamp(dot(q, d), -0.45, 0.45); float dist = length(q - d * tt); float b = (1.0 - smoothstep(0.0, 0.06, dist)) * (0.55 + tt);
      if (b > blades) { blades = b; bt = h.z; } }
    vec3 grass = mix(uC1, uC0, bt) ; grass = mix(grass, uC3, step(1.0 - uP0.y, bt) * 0.7);
    float soilN = fbm(uv + 3.0, vec2(12.0), 5); vec4 peb = vor(uv, vec2(40.0), 0.9); float pebble = smoothstep(0.3, 0.15, peb.x) * step(1.0 - uP0.z, peb.z);
    vec3 soil = uC2 * (0.75 + soilN * 0.45); soil = mix(soil, vec3(0.42, 0.4, 0.37) * (0.7 + peb.w * 0.5), pebble);
    float g = sat(cover * (0.35 + blades * 1.2));
    vec3 col = mix(soil, grass * (0.6 + blades * 0.6), g);
    S s; s.albedo = col; s.height = g * (0.4 + blades * 0.5) + pebble * 0.3 + soilN * 0.1; s.rough = 0.95 - g * 0.1; s.ao = 0.55 + g * 0.3 + blades * 0.15; s.metal = 0.0; return s; }`,
});

registerRecipe('soil', {
  defaults: { c0: 0x5a4632, c1: 0x3a2c1e, c2: 0x7a6a56, p0: [0.4, 0.5, 0, 0], wear: 0.0, meters: 1.5, bump: 2.5, size: 1024 },
  glsl: `S surface(vec2 uv){
    float m = fbm(uv, vec2(6.0), 7); vec4 cl = vor(uv, vec2(24.0), 1.0); float clump = smoothstep(0.0, 0.3, cl.y - cl.x);
    vec4 peb = vor(uv + 0.37, vec2(55.0), 0.9); float pebble = smoothstep(0.32, 0.15, peb.x) * step(1.0 - uP0.x * 0.5, peb.z);
    float wet = smoothstep(0.5, 0.75, fbm(uv + 4.0, vec2(2.0), 5)) * uP0.y;
    vec3 col = mix(uC1, uC0, m) * (0.85 + clump * 0.2); col = mix(col, uC2 * (0.7 + peb.w * 0.5), pebble); col *= 1.0 - wet * 0.3;
    S s; s.albedo = col; s.height = m * 0.4 + clump * 0.3 + pebble * 0.4; s.rough = 0.95 - wet * 0.45; s.ao = 0.6 + clump * 0.4; s.metal = 0.0; return s; }`,
});

registerRecipe('rock', {
  // weathered granite / cliff rock: crystals, cracks, strata, lichen. c0 base, c1 dark, c2 light, c3 lichen
  defaults: { c0: 0x7a7670, c1: 0x46423e, c2: 0xb0aaa0, c3: 0x8a8a3a, p0: [0.5, 0.4, 0.3, 0.4], wear: 0.0, meters: 3, bump: 3.5, size: 1024 },
  glsl: `S surface(vec2 uv){
    float big = fbm(uv, vec2(3.0), 7); float rid = ridged(uv + 1.1, vec2(4.0, 6.0), 6); float strata = 0.5 + 0.5 * sin((uv.y + big * 0.15) * 2.0 * PI * 9.0);
    vec4 cr = vor(uv, vec2(160.0), 1.0); float crystal = smoothstep(0.0, 0.25, cr.y - cr.x);
    vec3 ce = vorEdge(uv, vec2(5.0), 1.0); float crack = (1.0 - smoothstep(0.0, 0.01, ce.x)) * step(0.4, ce.y) * uP0.y;
    float lich = smoothstep(0.62, 0.72, fbm(uv + 8.0, vec2(6.0), 5)) * uP0.w; float spots = smoothstep(0.7, 0.75, gn(uv * 80.0, vec2(80.0))) * uP0.w;
    vec3 col = mix(uC1, uC0, big) ; col = mix(col, uC2, cr.z * 0.25 * crystal + strata * 0.08 * uP0.z); col = mix(col, uC1 * 0.5, crack + rid * 0.2);
    col = mix(col, uC3, sat(lich * 0.8 + spots * 0.5));
    S s; s.albedo = col; s.height = big * 0.5 + rid * 0.35 + strata * 0.05 * uP0.z + crystal * 0.04 - crack * 0.5 + lich * 0.05; s.rough = 0.82 + crystal * 0.08 - lich * 0.05; s.ao = 0.5 + big * 0.3 + rid * 0.2 - crack * 0.3; s.metal = 0.0; return s; }`,
});

registerRecipe('moss', {
  defaults: { c0: 0x5a7a2a, c1: 0x2f4a16, c2: 0x8a9a4a, p0: [0, 0, 0, 0], wear: 0.0, meters: 0.8, bump: 2.0, size: 512 },
  glsl: `S surface(vec2 uv){
    float a = fbm(uv, vec2(8.0), 6); vec4 v = vor(uv, vec2(60.0), 1.0); float tuft = 1.0 - smoothstep(0.0, 0.55, v.x); float fine = gn(uv * 400.0, vec2(400.0));
    vec3 col = mix(uC1, uC0, a) * (0.7 + tuft * 0.4) ; col = mix(col, uC2, smoothstep(0.85, 0.95, fine) * 0.4);
    S s; s.albedo = col; s.height = a * 0.4 + tuft * 0.5 + fine * 0.1; s.rough = 0.95; s.ao = 0.5 + tuft * 0.5; s.metal = 0.0; return s; }`,
});

registerRecipe('bark', {
  // pine bark: plates separated by deep fissures, grain along V (tree up)
  defaults: { c0: 0x6a4630, c1: 0x3a261a, c2: 0x8a7a6a, p0: [8, 3, 0.5, 0], wear: 0.0, meters: 1, bump: 4.0, size: 1024 },
  glsl: `S surface(vec2 uv){
    vec2 q = uv + vec2(fbm(uv, vec2(2.0, 4.0), 4) * 0.06, 0.0);
    vec3 ve = vorEdge(vec2(q.x, q.y), vec2(uP0.x, uP0.y), 0.9); float fiss = 1.0 - smoothstep(0.0, 0.08, ve.x);
    float flake = fbm(uv * vec2(1.0, 1.0) + ve.y, vec2(12.0, 6.0), 4); float str = gn(uv * vec2(40.0, 6.0), vec2(40.0, 6.0));
    vec3 col = mix(uC0, uC2, ve.z * 0.4 * uP0.z) * (0.75 + flake * 0.4) ; col = mix(col, uC1 * 0.6, fiss);
    S s; s.albedo = col; s.height = (1.0 - fiss) * (0.6 + flake * 0.3 + str * 0.1); s.rough = 0.92; s.ao = 0.35 + (1.0 - fiss) * 0.65; s.metal = 0.0; return s; }`,
});

registerRecipe('sand', {
  defaults: { c0: 0xc8b48a, c1: 0xa8946a, c2: 0x8a7a5a, p0: [0.4, 0, 0, 0], wear: 0.0, meters: 1.5, bump: 1.5, size: 512 },
  glsl: `S surface(vec2 uv){
    float g = gn(uv * 500.0, vec2(500.0)); float m = fbm(uv, vec2(5.0), 5); float rip = 0.5 + 0.5 * sin((uv.y + m * 0.2) * 2.0 * PI * 14.0);
    vec3 col = mix(uC1, uC0, m) * (0.9 + g * 0.2); col = mix(col, uC2, smoothstep(0.85, 0.95, g) * 0.5);
    S s; s.albedo = col; s.height = rip * 0.3 * uP0.x + g * 0.2 + m * 0.2; s.rough = 0.95; s.ao = 0.9 + rip * 0.1; s.metal = 0.0; return s; }`,
});

registerRecipe('pebbles', {
  // river bed / gravel: rounded stones in silt. p0: x stone density, y wetness
  defaults: { c0: 0x8a847a, c1: 0x5a554e, c2: 0x6a5a48, c3: 0xa8a090, p0: [26, 0.3, 0, 0], wear: 0.0, meters: 1, bump: 4.0, size: 1024 },
  glsl: `S surface(vec2 uv){
    vec4 v = vor(uv, vec2(uP0.x), 0.85); float stone = smoothstep(0.62, 0.2, v.x); float dome = sqrt(sat(1.0 - v.x / 0.62));
    vec4 v2 = vor(uv + 0.5, vec2(floor(uP0.x * 2.3)), 0.9); float small = smoothstep(0.5, 0.15, v2.x);
    float m = fbm(uv, vec2(10.0), 5); vec3 sc = mix(uC1, uC0, v.z) ; sc = mix(sc, uC3, step(0.8, v.w) * 0.5); sc *= 0.85 + m * 0.3;
    vec3 col = mix(uC2 * (0.7 + m * 0.3), sc, sat(stone + small * 0.6));
    S s; s.albedo = col; s.height = max(dome * stone, small * 0.4) + m * 0.05; s.rough = mix(0.9, 0.5, uP0.y * stone); s.ao = 0.45 + max(stone, small) * 0.55; s.metal = 0.0; return s; }`,
});

registerRecipe('skin', {
  // generic organic skin / flesh: pores, veins, blotches. c0 base, c1 blotch, c2 vein, c3 sheen tint
  defaults: { c0: 0xc8a080, c1: 0xa86a5a, c2: 0x6a3a4a, p0: [0.55, 0.4, 0.3, 0], wear: 0.0, meters: 0.4, bump: 1.4, size: 1024 },
  glsl: `S surface(vec2 uv){
    float pore = smoothstep(0.7, 0.9, gn(uv * 320.0, vec2(320.0))); float m = fbm(uv, vec2(4.0), 6); float bl = smoothstep(0.55, 0.8, fbm(uv + 2.0, vec2(3.0), 5));
    float vein = smoothstep(0.92, 0.99, ridged(uv + 5.0, vec2(4.0), 4)) * uP0.y; float wr = ridged(uv + 1.0, vec2(9.0, 3.0), 4);
    vec3 col = mix(uC0, uC1, bl * 0.5 + (m - 0.5) * 0.3); col = mix(col, uC2, vein * 0.6); col *= 1.0 - pore * 0.12;
    S s; s.albedo = col; s.height = m * 0.3 - pore * 0.2 + wr * 0.25 * uP0.z + vein * 0.1; s.rough = uP0.x + pore * 0.1 - vein * 0.1; s.ao = 1.0 - pore * 0.2; s.metal = 0.0; return s; }`,
});

registerRecipe('stucco', {
  defaults: { c0: 0xe8e4da, c1: 0xd0cabc, c2: 0x8a8274, p0: [0.9, 0, 0, 0], wear: 0.2, meters: 1, bump: 2.0, size: 512 },
  glsl: `S surface(vec2 uv){
    float a = fbm(uv, vec2(30.0), 4); float b = smoothstep(0.6, 0.75, gn(uv * 140.0, vec2(140.0))); float m = fbm(uv, vec2(3.0), 5); float dirt = smoothstep(0.6, 0.85, fbm(uv + 2.0, vec2(2.0), 5)) * uWear;
    vec3 col = mix(uC1, uC0, m * 0.7 + a * 0.3); col = mix(col, uC2, dirt * 0.4);
    S s; s.albedo = col; s.height = a * 0.5 + b * 0.3; s.rough = uP0.x; s.ao = 0.85 + a * 0.15; s.metal = 0.0; return s; }`,
});

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------
const programs = new Map();
let quad = null, quadScene = null, quadCam = null;

function materialFor(name) {
  if (programs.has(name)) return programs.get(name);
  const r = recipes[name];
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: LIB + r.glsl + MAIN,
    uniforms: {
      uPass: { value: 0 }, uSeed: { value: 0 }, uTexel: { value: 1 / 512 }, uBump: { value: 1 }, uWear: { value: 0 },
      uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uC3: { value: new THREE.Color() },
      uP0: { value: new THREE.Vector4() }, uP1: { value: new THREE.Vector4() },
    },
    depthTest: false, depthWrite: false,
  });
  programs.set(name, mat);
  return mat;
}

function colorOf(v, fallback) {
  const c = new THREE.Color();
  if (v === undefined || v === null) v = fallback ?? 0x808080;
  if (Array.isArray(v)) c.setRGB(v[0], v[1], v[2], THREE.SRGBColorSpace);
  else c.set(v);
  return c; // THREE.Color stores linear values (colour management on)
}

function readTarget(r, rt, size) {
  const buf = new Uint8Array(size * size * 4);
  r.readRenderTargetPixels(rt, 0, 0, size, size, buf);
  return buf;
}

function dataTexture(buf, size, srgb) {
  const t = new THREE.DataTexture(buf, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = maxAniso;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

function keyOf(name, o) {
  const k = {};
  for (const f of ['c0', 'c1', 'c2', 'c3', 'p0', 'p1', 'wear', 'seed', 'size', 'bump']) if (o[f] !== undefined) k[f] = o[f];
  return name + JSON.stringify(k);
}

// Generate (or fetch) a texture set. Returns { map, normalMap, orm, meters, metal }
export function pbr(name, o = {}) {
  if (!recipes[name]) throw new Error(`texsynth: unknown recipe '${name}'`);
  const key = keyOf(name, o);
  if (cache.has(key)) return cache.get(key);
  const def = recipes[name], d = def.defaults || {};
  const size = o.size || d.size || 512;
  const r = synthRenderer();
  if (!quad) {
    quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    quad.frustumCulled = false;
    quadScene = new THREE.Scene();
    quadScene.add(quad);
    quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  const mat = materialFor(name);
  const U = mat.uniforms;
  U.uSeed.value = (o.seed ?? d.seed ?? 1) % 1000;
  U.uTexel.value = 1 / size;
  U.uBump.value = (o.bump ?? d.bump ?? 1);
  U.uWear.value = o.wear ?? d.wear ?? 0;
  U.uC0.value.copy(colorOf(o.c0, d.c0)); U.uC1.value.copy(colorOf(o.c1, d.c1 ?? d.c0));
  U.uC2.value.copy(colorOf(o.c2, d.c2 ?? d.c0)); U.uC3.value.copy(colorOf(o.c3, d.c3 ?? d.c0));
  const p0 = o.p0 || d.p0 || [0, 0, 0, 0], p1 = o.p1 || d.p1 || [0, 0, 0, 0];
  U.uP0.value.set(p0[0] ?? 0, p0[1] ?? 0, p0[2] ?? 0, p0[3] ?? 0);
  U.uP1.value.set(p1[0] ?? 0, p1[1] ?? 0, p1[2] ?? 0, p1[3] ?? 0);
  quad.material = mat;
  const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: false, stencilBuffer: false, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const out = [];
  for (let pass = 0; pass < 3; pass++) {
    U.uPass.value = pass;
    r.setRenderTarget(rt);
    r.render(quadScene, quadCam);
    out.push(readTarget(r, rt, size));
  }
  r.setRenderTarget(null);
  rt.dispose();
  const res = {
    name,
    size,
    map: dataTexture(out[0], size, true),
    orm: dataTexture(out[1], size, false),
    normalMap: dataTexture(out[2], size, false),
    meters: o.meters ?? d.meters ?? 1,
    metal: !!(o.metal ?? d.metal),
  };
  cache.set(key, res);
  return res;
}

// A texture set view with its own UV repeat (shares the GPU upload with the cached original)
export function pbrRepeat(name, o = {}, repeat = [1, 1]) {
  const t = pbr(name, o);
  const rx = Array.isArray(repeat) ? repeat[0] : repeat, ry = Array.isArray(repeat) ? repeat[1] : repeat;
  if (rx === 1 && ry === 1) return t;
  const clone = (tex) => { const c = tex.clone(); c.repeat.set(rx, ry); c.needsUpdate = true; return c; };
  return { ...t, map: clone(t.map), orm: clone(t.orm), normalMap: clone(t.normalMap) };
}

// MeshStandardMaterial (or Physical with o.physical) wired to a synthesized set.
// o: recipe overrides + { repeat:[u,v] | number, world:true (UVs in meters -> repeat = 1/meters), color (tint),
//   roughness (multiplier, default 1), metalness (default 1 for metal recipes else 0), normalScale, aoIntensity,
//   envMapIntensity, physical, clearcoat, clearcoatRoughness, sheen, sheenColor, sheenRoughness, side, transparent, opacity, name }
export function pbrMaterial(name, o = {}) {
  const key = 'm:' + keyOf(name, o) + JSON.stringify([o.repeat, o.world, o.color, o.roughness, o.metalness, o.normalScale, o.aoIntensity, o.envMapIntensity, o.physical, o.clearcoat, o.clearcoatRoughness, o.sheen, o.sheenColor, o.sheenRoughness, o.side, o.transparent, o.opacity]);
  if (matCache.has(key)) return matCache.get(key);
  const t0 = pbr(name, o);
  const rep = o.world ? 1 / t0.meters : (o.repeat ?? 1);
  const t = pbrRepeat(name, o, rep);
  const P = {
    map: t.map, normalMap: t.normalMap, roughnessMap: t.orm, aoMap: t.orm,
    roughness: o.roughness ?? 1, metalness: o.metalness ?? (t.metal ? 1 : 0),
    color: o.color ?? 0xffffff,
    aoMapIntensity: o.aoIntensity ?? 1,
  };
  if (t.metal || o.metalness) P.metalnessMap = t.orm;
  const ns = o.normalScale ?? 1;
  P.normalScale = new THREE.Vector2(ns, ns);
  if (o.envMapIntensity !== undefined) P.envMapIntensity = o.envMapIntensity;
  if (o.side !== undefined) P.side = o.side;
  if (o.transparent) { P.transparent = true; P.opacity = o.opacity ?? 1; }
  let m;
  if (o.physical || o.clearcoat || o.sheen) {
    m = new THREE.MeshPhysicalMaterial(P);
    if (o.clearcoat) { m.clearcoat = o.clearcoat; m.clearcoatRoughness = o.clearcoatRoughness ?? 0.1; }
    if (o.sheen) { m.sheen = o.sheen; m.sheenRoughness = o.sheenRoughness ?? 0.6; m.sheenColor = new THREE.Color(o.sheenColor ?? 0xffffff); }
  } else m = new THREE.MeshStandardMaterial(P);
  m.name = o.name || `synth_${name}`;
  matCache.set(key, m);
  return m;
}

// Triplanar projection for meshes without usable UVs (terrain, rocks, sculpted organic meshes).
// space: 'world' (static geometry) or 'object' (moving props: texture sticks to the object).
export function triplanar(material, { scale = 1, space = 'world', sharpness = 4 } = {}) {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey?.() || '';
  material.customProgramCacheKey = () => `tri_${space}_${prevKey}`;
  material.userData.triplanar = { scale, space, sharpness };
  material.onBeforeCompile = (shader, r) => {
    if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(material, shader, r);
    shader.uniforms.uTriScale = { value: scale };
    shader.uniforms.uTriSharp = { value: sharpness };
    const pos = space === 'world' ? '(modelMatrix * vec4(transformed, 1.0)).xyz' : 'transformed';
    const nrm = space === 'world' ? 'normalize(mat3(modelMatrix) * objectNormal)' : 'normalize(objectNormal)';
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTriPos; varying vec3 vTriNrm;')
      .replace('#include <project_vertex>', `#include <project_vertex>\nvTriPos = ${pos}; vTriNrm = ${nrm};`);
    const fn = `
varying vec3 vTriPos; varying vec3 vTriNrm; uniform float uTriScale; uniform float uTriSharp;
vec3 triW(){ vec3 w = pow(abs(normalize(vTriNrm)), vec3(uTriSharp)); return w / (w.x + w.y + w.z); }
vec4 triSample(sampler2D t){ vec3 w = triW(); vec3 p = vTriPos * uTriScale;
  return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z; }
vec3 triNormalWorld(sampler2D t, vec2 ns){ vec3 n = normalize(vTriNrm); vec3 w = triW(); vec3 p = vTriPos * uTriScale;
  vec3 tx = texture2D(t, p.zy).xyz * 2.0 - 1.0; vec3 ty = texture2D(t, p.xz).xyz * 2.0 - 1.0; vec3 tz = texture2D(t, p.xy).xyz * 2.0 - 1.0;
  tx.xy *= ns; ty.xy *= ns; tz.xy *= ns;
  tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x); ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y); tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
  return normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z); }
`;
    let fs = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + fn);
    fs = fs.replace(/texture2D\(\s*map\s*,\s*vMapUv\s*\)/g, 'triSample( map )')
      .replace(/texture2D\(\s*roughnessMap\s*,\s*vRoughnessMapUv\s*\)/g, 'triSample( roughnessMap )')
      .replace(/texture2D\(\s*metalnessMap\s*,\s*vMetalnessMapUv\s*\)/g, 'triSample( metalnessMap )')
      .replace(/texture2D\(\s*aoMap\s*,\s*vAoMapUv\s*\)/g, 'triSample( aoMap )');
    const mvm = space === 'world' ? 'viewMatrix' : 'viewMatrix * modelMatrix';
    fs = fs.replace('#include <normal_fragment_maps>', `#ifdef USE_NORMALMAP
      { vec3 tw = triNormalWorld(normalMap, normalScale);
        ${space === 'world' ? '' : 'tw = normalize(tw);'}
        normal = normalize((${mvm} * vec4(tw, 0.0)).xyz); }
    #endif`);
    shader.fragmentShader = fs;
  };
  material.needsUpdate = true;
  return material;
}

// Generate a list of recipes up front (e.g. during a loading screen); yields between items.
export async function warm(list, onProgress) {
  for (let i = 0; i < list.length; i++) {
    const [name, o] = Array.isArray(list[i]) ? list[i] : [list[i], {}];
    pbr(name, o || {});
    onProgress?.((i + 1) / list.length, name);
    await new Promise((r) => setTimeout(r, 0));
  }
}
