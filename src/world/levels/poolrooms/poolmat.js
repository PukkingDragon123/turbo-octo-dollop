// Poolrooms materials: GPU-synthesised texture recipes (glazed wall tiles, glass mosaic, non-slip deck
// tiles, caustics, water ripples, crack network, light diffusers) and the baked "pool surface" shader
// patch used by every static Poolrooms mesh:
//   - live baked lighting from the shared light field (4 lights per vertex + AO), like the Yellow Rooms
//   - underwater pool-lamp glow (per-vertex, dims with the day cycle)
//   - animated caustics: reflected off the water onto walls/ceilings, projected onto submerged tiles
//   - submerged surfaces: refraction wobble of the tile grid, depth / path-length absorption & in-scatter
//   - wet decks with mirror-like puddles, algae + limescale at the waterline, grout mould and cracks
//     that spread as reality decays, reality-collapse wobble.
import * as THREE from 'three';
import * as Synth from '../../../gfx/texsynth.js';
import { WATER_Y } from './layout.js';

// ---------------------------------------------------------------------------
// Recipes
Synth.registerRecipe('pool_tile', {
  // glazed ceramic wall/ceiling tile. p0: x/y tiles per texture, z grout (fraction of a tile), w glaze roughness
  // p1: x tone variation, y chipped tiles, z cracked tiles, w crazing. c0 glaze, c1 grout, c2 grime, c3 alt glaze tint
  defaults: { c0: 0xf3f6f5, c1: 0xe2e5e1, c2: 0x8f9183, c3: 0xe4f1f2, p0: [8, 8, 0.03, 0.07], p1: [0.035, 0.05, 0.05, 0.5], wear: 0.4, meters: 1.2, bump: 4.0, size: 1024 },
  glsl: `S surface(vec2 uv){
    vec2 t = uv * uP0.xy; vec2 c = floor(t), f = fract(t);
    vec2 cm = mod(c, uP0.xy);
    vec3 h1 = h32(cm + 0.5), h2 = h32(cm + 31.7), h3 = h32(cm + 77.1);
    vec2 e2 = min(f, 1.0 - f); float edge = min(e2.x, e2.y);
    float g = uP0.z * 0.5;
    float grout = 1.0 - smoothstep(g, g + 0.008, edge);
    float bv = smoothstep(g, g + 0.085, edge);
    float cushion = sqrt(sat(bv));
    // glaze: every tile sits at a slightly different angle, with a soft orange-peel ripple
    vec2 tilt = (h2.xy - 0.5) * 0.07;
    float wav = gn(f * 2.5 + h1.xy * 17.0, vec2(997.0)) - 0.5;
    float peel = gn(uv * 380.0, vec2(380.0)) - 0.5;
    float glazeH = dot(f - 0.5, tilt) + wav * 0.03 + peel * 0.006;
    // crazing: a fine crack network in the glaze of some tiles
    vec3 cz = vorEdge(uv, vec2(uP0.x * 2.0, uP0.y * 2.0), 1.0);
    float craze = (1.0 - smoothstep(0.0, 0.01, cz.x)) * uP1.w * step(0.55, h3.x);
    // chipped corner
    vec2 corner = vec2(step(0.5, h1.y), step(0.5, h1.z));
    float chipN = gn(f * 9.0 + h2.yz * 7.0, vec2(997.0));
    float dc = length(f - corner);
    float chip = (1.0 - smoothstep(0.07 + chipN * 0.07, 0.09 + chipN * 0.07, dc)) * step(1.0 - uP1.y, h1.x);
    // chipped edge spot
    float side = step(0.5, h3.y);
    float ex = side > 0.5 ? f.x : f.y, ey = side > 0.5 ? min(f.y, 1.0 - f.y) : min(f.x, 1.0 - f.x);
    float edgeChip = (1.0 - smoothstep(0.035, 0.05, length(vec2((ex - h3.z) * 0.6, ey)) + (chipN - 0.5) * 0.02)) * step(1.0 - uP1.y * 0.8, h2.z);
    chip = max(chip, edgeChip);
    // hairline crack through some tiles
    float ca = h2.x * PI; vec2 cdir = vec2(cos(ca), sin(ca)); vec2 cp = vec2(0.5) + (h1.yx - 0.5) * 0.5;
    float wob = (gn(f * 5.0 + h1.zx * 5.0, vec2(997.0)) - 0.5) * 0.08;
    float cdist = abs(dot(f - cp, vec2(-cdir.y, cdir.x)) + wob);
    float crack = (1.0 - smoothstep(0.0, 0.0045, cdist)) * step(1.0 - uP1.z, h2.y);
    // colours
    vec3 tcol = mix(uC0, uC3, h1.z * 0.7) * (1.0 + (h1.x - 0.5) * uP1.x * 2.0);
    tcol *= 0.99 + wav * 0.04;
    vec3 body = vec3(0.66, 0.62, 0.55);
    float gd = fbm(uv + 4.0, vec2(6.0), 4);
    vec3 gcol = mix(uC1, uC2, sat(gd * gd * 1.3 * uWear + 0.05)) * (0.94 + gn(uv * 200.0, vec2(200.0)) * 0.1);
    vec3 col = mix(tcol, gcol, grout);
    col = mix(col, body * (0.9 + chipN * 0.15), chip * (1.0 - grout));
    col = mix(col, uC2 * 0.7, crack * 0.7 + craze * 0.18);
    S s;
    s.albedo = col;
    s.height = grout > 0.5 ? 0.12 : 0.3 + cushion * 0.5 + glazeH - chip * 0.28 - crack * 0.12 - craze * 0.03;
    s.rough = mix(uP0.w + wav * 0.03 + craze * 0.08 + abs(peel) * 0.02, 0.88, grout);
    s.rough = mix(s.rough, 0.82, chip);
    s.ao = 1.0 - grout * 0.24 - (1.0 - bv) * 0.07 - chip * 0.12;
    s.metal = 0.0;
    return s; }`,
});

Synth.registerRecipe('pool_mosaic', {
  // glass mosaic for pool basins. p0: x tiles per texture, y grout, z tilt, w missing tiles. c0..c3 palette
  defaults: { c0: 0x5fc2cf, c1: 0x7fd3db, c2: 0x3ea7bd, c3: 0xd9f1ef, p0: [32, 0.12, 0.12, 0.004], wear: 0.3, meters: 0.8, bump: 2.6, size: 1024 },
  glsl: `S surface(vec2 uv){
    float n = uP0.x;
    vec2 t = uv * n; vec2 c = floor(t), f = fract(t);
    vec2 cm = mod(c, vec2(n));
    vec3 h1 = h32(cm + 0.37), h2 = h32(cm + 9.1);
    vec2 e2 = min(f, 1.0 - f); float edge = min(e2.x, e2.y);
    float g = uP0.y * 0.5;
    float grout = 1.0 - smoothstep(g, g + 0.04, edge);
    float bv = smoothstep(g, g + 0.22, edge);
    // clustered colour variation: low-frequency drift + per tile pick
    float drift = fbm(uv, vec2(3.0), 3);
    float pick = fract(h1.x + drift * 0.35);
    vec3 col = pick < 0.42 ? uC0 : pick < 0.74 ? uC1 : pick < 0.93 ? uC2 : uC3;
    col *= 0.88 + h1.y * 0.22;
    float center = 1.0 - length(f - 0.5) * 1.3;
    col *= 0.9 + center * 0.14;
    float bub = smoothstep(0.86, 0.95, gn(f * 7.0 + h2.xy * 11.0, vec2(997.0)));
    col *= 1.0 + bub * 0.08;
    float missing = step(1.0 - uP0.w, h2.z);
    vec3 gcol = mix(vec3(0.84, 0.86, 0.84), vec3(0.46, 0.5, 0.44), sat(fbm(uv + 2.0, vec2(8.0), 3) * uWear * 1.4));
    col = mix(col, gcol, grout);
    col = mix(col, vec3(0.42, 0.43, 0.4), missing * (1.0 - grout));
    vec2 tilt = (h2.xy - 0.5) * uP0.z;
    S s; s.albedo = col;
    s.height = grout > 0.5 ? 0.1 : (missing > 0.5 ? 0.04 : 0.25 + sqrt(bv) * 0.55 + dot(f - 0.5, tilt));
    s.rough = mix(0.05 + h1.z * 0.05, 0.9, grout); s.rough = mix(s.rough, 0.95, missing);
    s.ao = 1.0 - grout * 0.38 - missing * 0.35;
    s.metal = 0.0; return s; }`,
});

Synth.registerRecipe('pool_deck', {
  // non-slip ceramic floor tiles: fine grip bumps, speckle, worn paths. p0: tiles x/y, grout, base roughness
  // p1: x tone variation, y stains, w grout dirt
  defaults: { c0: 0xe9ece8, c1: 0xcfd2cc, c2: 0x74766a, c3: 0x9aa09c, p0: [10, 10, 0.035, 0.42], p1: [0.035, 0.4, 0, 0.8], wear: 0.5, meters: 1.5, bump: 2.4, size: 1024 },
  glsl: `S surface(vec2 uv){
    vec2 t = uv * uP0.xy; vec2 c = floor(t), f = fract(t); vec2 cm = mod(c, uP0.xy);
    vec3 h1 = h32(cm + 0.5), h2 = h32(cm + 13.3);
    vec2 e2 = min(f, 1.0 - f); float edge = min(e2.x, e2.y);
    float g = uP0.z * 0.5;
    float grout = 1.0 - smoothstep(g, g + 0.012, edge);
    float bv = smoothstep(g, g + 0.07, edge);
    float bump = gn(uv * 520.0, vec2(520.0));
    float bump2 = gn(uv * 190.0 + 3.0, vec2(190.0));
    float speck = smoothstep(0.8, 0.88, gn(uv * 300.0 + 9.0, vec2(300.0)));
    vec3 tcol = uC0 * (1.0 + (h1.x - 0.5) * uP1.x * 2.0);
    tcol = mix(tcol, uC3, speck * 0.55);
    float worn = smoothstep(0.55, 0.85, fbm(uv + 2.0, vec2(3.0), 5)) * uWear;
    float stain = smoothstep(0.62, 0.82, fbm(uv + 7.0, vec2(2.0), 5)) * uP1.y;
    vec3 gcol = mix(uC1, uC2, sat(fbm(uv + 5.0, vec2(6.0), 4) * 0.9 * uP1.w + 0.1));
    vec3 col = mix(tcol * (1.0 - stain * 0.1) * (0.985 + bump2 * 0.03), gcol, grout);
    col = mix(col, col * vec3(0.93, 0.9, 0.84), stain * 0.6);
    vec2 tilt = (h2.xy - 0.5) * 0.04;
    S s; s.albedo = col;
    s.height = grout > 0.5 ? 0.15 : 0.3 + sqrt(bv) * 0.45 + (bump * 0.07 + bump2 * 0.04) * (1.0 - worn * 0.7) + dot(f - 0.5, tilt);
    s.rough = mix(uP0.w + bump * 0.12 - worn * 0.18, 0.86, grout);
    s.ao = 1.0 - grout * 0.22 - (1.0 - bv) * 0.06;
    s.metal = 0.0; return s; }`,
});

Synth.registerRecipe('pool_caustics', {
  defaults: { c0: 0xffffff, p0: [0, 0, 0, 0], wear: 0, meters: 1, bump: 1, size: 512 },
  glsl: `S surface(vec2 uv){
    vec2 w = vec2(fbm(uv, vec2(3.0), 3), fbm(uv + 5.2, vec2(3.0), 3)) - 0.5;
    vec3 e1 = vorEdge(uv + w * 0.07, vec2(5.0), 1.0);
    vec3 e2 = vorEdge(uv + w * 0.11 + vec2(0.37, 0.61), vec2(7.0), 1.0);
    float c1 = exp(-e1.x * 24.0);
    float c2 = exp(-e2.x * 20.0);
    float c = sat(c1 * 0.8 + c2 * 0.55 + c1 * c2 * 0.6);
    S s; s.albedo = vec3(c); s.height = c; s.rough = 0.5; s.ao = 1.0; s.metal = 0.0; return s; }`,
});

Synth.registerRecipe('pool_ripple', {
  defaults: { c0: 0xffffff, p0: [0, 0, 0, 0], wear: 0, meters: 2, bump: 1.6, size: 512 },
  glsl: `S surface(vec2 uv){
    float h = gn(uv * vec2(3.0, 2.0), vec2(3.0, 2.0)) * 0.5;
    h += gn(uv * vec2(7.0, 6.0) + 1.3, vec2(7.0, 6.0)) * 0.28;
    h += gn(uv * vec2(15.0, 17.0) + 2.1, vec2(15.0, 17.0)) * 0.14;
    h += gn(uv * vec2(33.0, 29.0) + 5.7, vec2(33.0, 29.0)) * 0.06;
    S s; s.albedo = vec3(h); s.height = h; s.rough = 0.1; s.ao = 1.0; s.metal = 0.0; return s; }`,
});

Synth.registerRecipe('pool_cracks', {
  // branching crack network (albedo = crack mask) for decay overlays
  defaults: { c0: 0xffffff, p0: [0, 0, 0, 0], wear: 0, meters: 3, bump: 1, size: 512 },
  glsl: `S surface(vec2 uv){
    vec2 w = vec2(fbm(uv, vec2(5.0), 4), fbm(uv + 3.3, vec2(5.0), 4)) - 0.5;
    vec3 e = vorEdge(uv + w * 0.05, vec2(4.0), 1.0);
    vec3 e2 = vorEdge(uv + w * 0.08 + 0.5, vec2(9.0), 1.0);
    float keep = step(0.45, e.y);
    float c = (1.0 - smoothstep(0.0, 0.006, e.x)) * keep + (1.0 - smoothstep(0.0, 0.004, e2.x)) * step(0.7, e2.y) * 0.8;
    S s; s.albedo = vec3(sat(c)); s.height = 1.0 - c; s.rough = 0.9; s.ao = 1.0; s.metal = 0.0; return s; }`,
});

Synth.registerRecipe('prism_diffuser', {
  // prismatic acrylic light diffuser
  defaults: { c0: 0xffffff, c1: 0xe8eef2, p0: [48, 0, 0, 0], wear: 0, meters: 0.6, bump: 2.0, size: 512 },
  glsl: `S surface(vec2 uv){
    vec2 f = fract(uv * uP0.x) - 0.5;
    float pyr = 1.0 - max(abs(f.x), abs(f.y)) * 2.0;
    vec3 col = mix(uC1, uC0, 0.6 + pyr * 0.4);
    S s; s.albedo = col; s.height = pyr; s.rough = 0.25; s.ao = 1.0; s.metal = 0.0; return s; }`,
});

Synth.registerRecipe('pool_rope', {
  // twisted 3-strand rope (u along the rope)
  defaults: { c0: 0xe9e4d6, c1: 0xb9b3a2, p0: [40, 0, 0, 0], wear: 0.2, meters: 0.5, bump: 3.0, size: 256 },
  glsl: `S surface(vec2 uv){
    float ph = fract(uv.x * uP0.x + uv.y * 3.0);
    float prof = sin(ph * PI);
    float fib = gn(uv * vec2(uP0.x * 6.0, 48.0), vec2(uP0.x * 6.0, 48.0));
    vec3 col = mix(uC1, uC0, prof * 0.7 + fib * 0.3);
    S s; s.albedo = col; s.height = prof * 0.8 + fib * 0.2; s.rough = 0.85; s.ao = 0.6 + prof * 0.4; s.metal = 0.0; return s; }`,
});

// ---------------------------------------------------------------------------
// Shared uniforms of every Poolrooms surface (updated once per frame by the level)
export const PU = {
  uWaterY: { value: WATER_Y },
  uCaustTex: { value: null },
  uRippleTex: { value: null },
  uCrackTex: { value: null },
  uAbsorb: { value: new THREE.Vector3(0.38, 0.07, 0.045) },
  uScatter: { value: new THREE.Color(0.0, 0.085, 0.11) },
  uDecay: { value: 0 },
  uPoolGlow: { value: 1 },
  uCaustStr: { value: 1 },
  uSpecK: { value: 0.55 },
};

let texReady = false;
export function initPoolTextures() {
  if (texReady) return;
  texReady = true;
  const c = Synth.pbr('pool_caustics', { size: 512 });
  PU.uCaustTex.value = c.map;
  const r = Synth.pbr('pool_ripple', { size: 512 });
  PU.uRippleTex.value = r.normalMap;
  const k = Synth.pbr('pool_cracks', { size: 512 });
  PU.uCrackTex.value = k.map;
}

// ---------------------------------------------------------------------------
// Material library (texsynth sets; shared instances)
const lib = new Map();
function once(key, fn) { if (!lib.has(key)) lib.set(key, fn()); return lib.get(key); }

export const BASE = {
  wallTile: () => once('wallTile', () => Synth.pbrMaterial('pool_tile', { world: true, size: 1024, envMapIntensity: 1.0, normalScale: 0.9, name: 'pool_wall_tile' })),
  deckTile: () => once('deckTile', () => Synth.pbrMaterial('pool_deck', { world: true, size: 1024, envMapIntensity: 0.9, normalScale: 1.0, name: 'pool_deck_tile' })),
  mosaic: () => once('mosaic', () => Synth.pbrMaterial('pool_mosaic', { world: true, size: 1024, envMapIntensity: 1.0, normalScale: 0.8, name: 'pool_mosaic' })),
  coping: () => once('coping', () => Synth.pbrMaterial('terrazzo', { c0: 0xe9e6dc, c1: 0xb8b2a4, c2: 0x8f9aa0, c3: 0xc9b6a0, p0: [90, 0.3, 0.32, 0], world: true, meters: 0.7, size: 512, envMapIntensity: 0.7, name: 'pool_coping' })),
  chrome: () => once('chrome', () => {
    const m = Synth.pbrMaterial('metal', { c0: 0xdfe3e6, c1: 0xb8bcc0, c2: 0x6a6c6e, p0: [0.6, 0.12, 0.05, 0], wear: 0.15, size: 512, repeat: [2, 2], envMapIntensity: 1.25, name: 'pool_chrome' });
    return m;
  }),
  steel: () => once('steel', () => Synth.pbrMaterial('paint_metal', { c0: 0xe8e8e2, c1: 0x9a9da0, c2: 0x7a4a2a, c3: 0xb8b0a0, p0: [0.4, 0.4, 0, 0], wear: 0.25, size: 512, repeat: [2, 2], envMapIntensity: 0.8, name: 'pool_white_steel' })),
  rubberDark: () => once('rubberDark', () => Synth.pbrMaterial('rubber', { c0: 0x1b1d1e, c1: 0x26292a, c2: 0x4a4c4a, size: 256, repeat: [3, 3], name: 'pool_rubber' })),
  grate: () => once('grate', () => Synth.pbrMaterial('plastic', { c0: 0xd9dcd8, c1: 0xbfc2bc, c2: 0x6a6c64, p0: [0.5, 0.6, 0, 0], wear: 0.5, size: 256, repeat: [3, 3], name: 'pool_grate' })),
  wood: () => once('wood', () => Synth.pbrMaterial('planks', { c0: 0x8a5f3a, c1: 0xb98a5a, c2: 0x3a2412, p0: [4, 0.01, 1, 0.55], wear: 0.45, world: true, meters: 0.6, size: 512, name: 'pool_teak' })),
  rope: () => once('rope', () => Synth.pbrMaterial('pool_rope', { size: 256, repeat: [1, 1], name: 'pool_rope' })),
  diffuser: () => once('diffuser', () => {
    const m = Synth.pbrMaterial('prism_diffuser', { world: true, size: 512, name: 'pool_diffuser' });
    m.emissive = new THREE.Color(0xf4fbff);
    m.emissiveMap = m.map;
    m.emissiveIntensity = 2.2;
    return m;
  }),
  sky: () => once('sky', () => new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeef7ff, emissiveIntensity: 13, roughness: 0.2, name: 'pool_skyglass' })),
  porthole: () => once('porthole', () => new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf2f9ff, emissiveIntensity: 5.0, roughness: 0.15, name: 'pool_porthole' })),
  lamp: () => once('lamp', () => new THREE.MeshStandardMaterial({ color: 0xdff6ff, emissive: 0x9fe4ff, emissiveIntensity: 4.0, roughness: 0.1, name: 'pool_lamp' })),
  void: () => once('void', () => new THREE.MeshBasicMaterial({ color: 0x010202, name: 'pool_void' })),
  rescue: () => once('rescue', () => Synth.pbrMaterial('vinyl', { c0: 0xd8301f, c1: 0xc42a1b, p0: [200, 0.35, 0, 0], wear: 0.25, size: 256, repeat: [2, 2], name: 'pool_rescue' })),
  pvc: () => once('pvc', () => Synth.pbrMaterial('plastic', { c0: 0x8e979c, c1: 0x7c858a, c2: 0x3c4040, p0: [0.42, 0.3, 0, 0], wear: 0.35, size: 256, repeat: [2, 2], name: 'pool_pvc' })),
  tank: () => once('tank', () => Synth.pbrMaterial('plastic', { c0: 0x2f68a8, c1: 0x285c94, c2: 0x1a2c3c, p0: [0.28, 0.2, 0, 0], wear: 0.3, size: 256, repeat: [2, 2], name: 'pool_tank' })),
  red: () => once('red', () => Synth.pbrMaterial('paint_metal', { c0: 0xb3221a, c1: 0x8a8d90, c2: 0x6a3a1c, c3: 0x8a6a52, wear: 0.3, size: 256, repeat: [2, 2], name: 'pool_red_paint' })),
  plantFloor: () => once('plantFloor', () => Synth.pbrMaterial('concrete', { c0: 0x8f9a96, c1: 0x7a8682, c2: 0x4a5250, c3: 0xa8b2ae, p0: [70, 0.35, 0.5, 0.45], world: true, meters: 2, size: 512, name: 'pool_plant_floor' })),
};

// ---------------------------------------------------------------------------
// The baked pool-surface patch
const surfCache = new Map();
let pfx = 0;

// opts: { sub (submerged shading), wet (puddles; needs aWet), emit (field-driven emission factor), lamp (pool-glow emission) }
export function surface(base, field, opts = {}) {
  const flags = `${opts.sub ? 'S' : ''}${opts.wet ? 'W' : ''}${opts.emit ? 'E' + opts.emit : ''}${opts.lamp ? 'L' : ''}${opts.noCaust ? 'n' : ''}`;
  const key = `${base.uuid}|${flags}`;
  if (surfCache.has(key)) return surfCache.get(key);
  const m = base.clone();
  m.name = `${base.name || 'pool'}_${flags || 'baked'}`;
  m.userData.baked = true;
  m.defines = { ...(m.defines || {}) };
  if (opts.sub) m.defines.P_SUB = '';
  if (opts.wet) m.defines.P_WET = '';
  if (opts.emit) m.defines.P_EMIT = Number(opts.emit).toFixed(2);
  if (opts.lamp) m.defines.P_LAMP = '';
  if (!opts.noCaust) m.defines.P_CAUST = '';
  const id = ++pfx;
  m.customProgramCacheKey = () => `poolsurf4_${flags}`;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, field.uniforms, PU);
    void id;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aLightCells;
        attribute vec4 aLightW;
        attribute float aAO;
        attribute float aCaust;
        attribute vec3 aGlow;
        attribute vec3 aTint;
        attribute vec3 aLDir;
        varying vec3 vPLDir;
        varying vec3 vPSpec;
        #ifdef P_WET
        attribute float aWet;
        varying float vPWet;
        #endif
        uniform sampler2D uLightTex;
        uniform float uLightScale;
        uniform float uCollapse;
        uniform float uTime;
        varying vec3 vPBaked;
        varying vec3 vPWPos;
        varying vec3 vPNrm;
        varying float vPAO;
        varying float vPCaust;
        varying vec3 vPGlow;
        varying vec3 vPTint;
        vec3 pFetchLight(float cell){
          float s = 128.0;
          vec2 uv = (vec2(mod(cell, s), floor(cell / s)) + 0.5) / s;
          return texture2D(uLightTex, uv).rgb * 2.0;
        }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vPBaked = (pFetchLight(aLightCells.x) * aLightW.x + pFetchLight(aLightCells.y) * aLightW.y
                + pFetchLight(aLightCells.z) * aLightW.z + pFetchLight(aLightCells.w) * aLightW.w) * uLightScale;
        vPAO = aAO; vPCaust = aCaust; vPGlow = aGlow; vPTint = aTint;
        vPLDir = aLDir;
        vPSpec = pFetchLight(aLightCells.x) * aLightW.x * uLightScale;
        #ifdef P_WET
        vPWet = aWet;
        #endif
        if (uCollapse > 0.0) {
          vec4 wp0 = modelMatrix * vec4(transformed, 1.0);
          float wob = sin(wp0.x * 1.7 + uTime * 1.3) * sin(wp0.z * 1.3 - uTime * 0.9) * sin(wp0.y * 2.0 + uTime * 0.7);
          transformed += normal * wob * 0.09 * uCollapse;
        }`)
      .replace('#include <fog_vertex>', `vPWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vPNrm = normalize(mat3(modelMatrix) * objectNormal);
        #include <fog_vertex>`);

    const map = THREE.ShaderChunk.map_fragment.replace('vMapUv', '(vMapUv + gRefr)');
    const rough = THREE.ShaderChunk.roughnessmap_fragment.replace('vRoughnessMapUv', '(vRoughnessMapUv + gRefr)');
    const nrm = THREE.ShaderChunk.normal_fragment_maps
      .replace(/vNormalMapUv/g, '(vNormalMapUv + gRefr)')
      .replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * (1.0 - pPuddle * 0.92);');
    const ao = THREE.ShaderChunk.aomap_fragment.replace('vAoMapUv', '(vAoMapUv + gRefr)');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uAmbient;
        uniform sampler2D uNoiseTex;
        uniform float uTime;
        uniform float uCollapse;
        uniform float uWaterY;
        uniform sampler2D uCaustTex;
        uniform sampler2D uRippleTex;
        uniform sampler2D uCrackTex;
        uniform vec3 uAbsorb;
        uniform vec3 uScatter;
        uniform float uDecay;
        uniform float uPoolGlow;
        uniform float uCaustStr;
        varying vec3 vPBaked;
        varying vec3 vPWPos;
        varying vec3 vPNrm;
        varying float vPAO;
        varying float vPCaust;
        varying vec3 vPGlow;
        varying vec3 vPTint;
        varying vec3 vPLDir;
        varying vec3 vPSpec;
        uniform float uSpecK;
        #ifdef P_WET
        varying float vPWet;
        #endif
        float pNz(vec2 p){ return texture2D(uNoiseTex, p).r; }
        float pCaust(vec2 p, float t){
          float a = texture2D(uCaustTex, p * 0.41 + vec2(t * 0.023, t * 0.014)).r;
          float b = texture2D(uCaustTex, p * 0.33 + vec2(-t * 0.018, t * 0.021) + a * 0.035).r;
          return a * b * 2.4 + min(a, b) * 0.5;
        }`)
      .replace('void main() {', `void main() {
        vec2 gRefr = vec2(0.0);
        float pSubDepth = uWaterY - vPWPos.y;
        float pCamAbove = cameraPosition.y - uWaterY;
        float pPath = 0.0;
        float pPuddle = 0.0;
        float pWetAmt = 0.0;
        float pCrack = 0.0;
        float pL = dot(vPBaked, vec3(0.3, 0.59, 0.11));
        #ifdef P_SUB
        if (pSubDepth > 0.0 && pCamAbove > 0.0) {
          vec3 toCam = cameraPosition - vPWPos;
          float k = pSubDepth / max(1e-3, toCam.y);
          vec3 ps = vPWPos + toCam * k;
          pPath = length(toCam) * k;
          vec2 rn = texture2D(uRippleTex, ps.xz * 0.31 + vec2(uTime * 0.017, uTime * 0.011)).xy * 2.0 - 1.0;
          rn += (texture2D(uRippleTex, ps.xz * 0.53 - vec2(uTime * 0.013, -uTime * 0.019)).xy * 2.0 - 1.0) * 0.6;
          gRefr = rn * min(pSubDepth, 1.4) * 0.03;
        }
        #endif
        #ifdef P_WET
        pWetAmt = vPWet;
        pPuddle = smoothstep(0.5, 0.56, pNz(vPWPos.xz * 0.075 + 0.31) * 0.75 + pNz(vPWPos.xz * 0.21 + 0.7) * 0.25 + vPWet * 0.22) * step(0.05, vPWet);
        #endif`)
      .replace('#include <map_fragment>', `${map}
        diffuseColor.rgb *= vPTint;
        {
          #ifdef USE_AOMAP
          float pGrout = 1.0 - smoothstep(0.8, 0.9, texture2D(aoMap, vAoMapUv + gRefr).r);
          #else
          float pGrout = 0.0;
          #endif
          float n1 = pNz(vPWPos.xz * 0.13 + vPWPos.y * 0.071);
          float n2 = pNz(vec2(vPWPos.x + vPWPos.z, vPWPos.y) * 0.41 + 3.1);
          float mould = pGrout * smoothstep(0.42, 0.8, n1 + uDecay * 0.4) * (0.05 + uDecay * 0.9);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.11, 0.085), mould * 0.85);
          float vert = 1.0 - abs(vPNrm.y);
          float dw = vPWPos.y - uWaterY;
          float algae = vert * smoothstep(-0.4, -0.06, dw) * (1.0 - smoothstep(-0.01, 0.05, dw)) * (0.18 + uDecay * 0.9) * smoothstep(0.3, 0.75, n2);
          float lime = vert * smoothstep(-0.005, 0.01, dw) * (1.0 - smoothstep(0.025, 0.09 + n2 * 0.06, dw)) * 0.7;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.35, 0.19), clamp(algae, 0.0, 1.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.87, 0.86, 0.8), lime * 0.5);
          vec3 an = abs(vPNrm);
          vec2 cuv = an.y > 0.6 ? vPWPos.xz : (an.x > an.z ? vPWPos.zy : vPWPos.xy);
          float crk = texture2D(uCrackTex, cuv * 0.21 + 0.13).r;
          pCrack = crk * smoothstep(0.35, 0.95, pNz(cuv * 0.035 + 0.5) + uDecay * 0.55) * smoothstep(0.12, 0.55, uDecay);
          diffuseColor.rgb *= 1.0 - pCrack * 0.72;
          #ifdef P_WET
          diffuseColor.rgb *= 1.0 - max(pWetAmt * 0.12, pPuddle * 0.22);
          #endif
          #ifdef P_SUB
          if (pSubDepth > 0.0) diffuseColor.rgb *= vec3(0.8, 0.9, 0.93);
          #endif
        }`)
      .replace('#include <roughnessmap_fragment>', `${rough}
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.55, pWetAmt);
        roughnessFactor = mix(roughnessFactor, 0.025, pPuddle);
        roughnessFactor = mix(roughnessFactor, 0.95, pCrack * 0.6);
        #ifdef P_SUB
        if (pSubDepth > 0.0) roughnessFactor = max(roughnessFactor, 0.35);
        #endif`)
      .replace('#include <normal_fragment_maps>', nrm)
      .replace('#include <aomap_fragment>', ao)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        {
          float envK = clamp(pL * 2.2 + dot(vPGlow, vec3(0.3)) * uPoolGlow + 0.04, 0.0, 1.25);
          #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
          radiance *= envK;
          #endif
          iblIrradiance *= envK;
        }
        irradiance += (vPBaked * vPAO + uAmbient + vPGlow * uPoolGlow) * PI;
        // specular highlight of the dominant baked light (moves with the view, breaks up on bevels)
        {
          float ll = length(vPLDir);
          if (ll > 0.01) {
            vec3 Lv = normalize((viewMatrix * vec4(vPLDir / ll, 0.0)).xyz);
            float dotNL = saturate(dot(normal, Lv));
            reflectedLight.directSpecular += vPSpec * PI * dotNL * BRDF_GGX(Lv, geometryViewDir, normal, material) * uSpecK * vPAO;
          }
        }
        #ifdef P_CAUST
        {
          vec3 cn = normalize(vPNrm);
          vec2 cp = abs(cn.y) > 0.6 ? vPWPos.xz : vec2(vPWPos.x + vPWPos.z, vPWPos.y * 1.3);
          float cUnder = 0.0;
          #ifdef P_SUB
          if (pSubDepth > 0.0) {
            vec2 cpu = vPWPos.xz + cn.xz * 0.3;
            cUnder = pCaust(cpu * 1.15, uTime * 1.1) * exp(-pSubDepth * 0.3) * (max(0.0, cn.y) * 0.75 + 0.25) * 1.6;
          }
          #endif
          float cAbove = pSubDepth > 0.0 ? 0.0 : vPCaust * pCaust(cp, uTime) * 0.55;
          float src = pL + dot(vPGlow, vec3(0.33)) * uPoolGlow * 0.6;
          irradiance += vec3(0.78, 0.96, 1.0) * (cAbove + cUnder) * src * uCaustStr * PI;
        }
        #endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        #ifdef P_EMIT
        totalEmissiveRadiance *= clamp(vPBaked * float(P_EMIT), 0.0, 6.0);
        #endif
        #ifdef P_LAMP
        totalEmissiveRadiance *= uPoolGlow;
        #endif
        if (uCollapse > 0.0) {
          float rr = step(0.995 - uCollapse * 0.02, fract(sin(dot(floor(vPWPos.xz * 2.0 + floor(uTime * 8.0)), vec2(12.9898, 78.233))) * 43758.5453));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.0), rr * uCollapse);
        }`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        #ifdef P_SUB
        if (pSubDepth > 0.0 && pCamAbove > 0.0) {
          vec3 tr = exp(-uAbsorb * (pPath + pSubDepth * 0.45));
          float glowL = dot(vPGlow, vec3(0.33)) * uPoolGlow;
          vec3 ins = uScatter * (1.0 - exp(-pPath * 0.85)) * (pL * 0.9 + 0.05 + glowL * 1.4);
          gl_FragColor.rgb = gl_FragColor.rgb * tr + ins;
        }
        #endif`);
  };
  surfCache.set(key, m);
  return m;
}
