// R.O.O.M. items — physically based materials.
//
// Layering: a print atlas (uv, sRGB albedo with wear) x vertex colour (tint + baked occlusion) on top of a
// shared tiling *surface detail* set (uv1: normal + ORM from GPU-synthesised recipes in texsynth.js) that
// supplies micro relief, roughness breakup and cavity AO at real-world scale (dm = meters per detail tile).
// Detail sets are tiny (128–256 px), generated once and shared by every item.
import * as THREE from 'three';
import * as Synth from '../../gfx/texsynth.js';

// ---------------------------------------------------------------------------
// Detail recipes (albedo unused: grey). ORM: R = cavity AO, G = roughness around 0.5, B = metal mask.
// ---------------------------------------------------------------------------
Synth.registerRecipe('item_stipple', {
  // moulded / painted plastic micro texture. p0: x grain freq (int), y fine mix, z roughness variation, w smudges
  defaults: { p0: [64, 0.5, 0.3, 0.5], wear: 0.4, bump: 1.0, size: 256 },
  glsl: `S surface(vec2 uv){
    float f = floor(uP0.x + 0.5);
    float g1 = gn(uv * f, vec2(f));
    float g2 = gn(uv * f * 2.0 + 3.1, vec2(f * 2.0));
    float h = mix(g1, g2, uP0.y);
    float sm = smoothstep(0.5, 0.85, fbm(uv + 3.7, vec2(2.0), 4)) * uP0.w;
    float scr = scratches(uv, 5.0, 0.42, 0.006) * uWear;
    S s; s.albedo = vec3(0.5);
    s.height = h - scr * 0.6;
    s.rough = 0.5 + (h - 0.5) * uP0.z + sm * 0.12 - scr * 0.14;
    s.ao = 1.0 - (1.0 - h) * 0.08;
    s.metal = 0.0; return s; }`,
});

Synth.registerRecipe('item_brushed', {
  // brushed / ground metal, grain along U. p0: x cross frequency (int), y streak strength, z scratches, w pits
  defaults: { p0: [192, 1, 0.6, 0.3], wear: 0.5, bump: 0.6, size: 256 },
  glsl: `S surface(vec2 uv){
    float f = floor(uP0.x + 0.5);
    float f2 = floor(uP0.x * 0.5 + 0.5);
    float st = gn(uv * vec2(2.0, f), vec2(2.0, f)) * 0.55 + gn(uv * vec2(5.0, f2) + 1.3, vec2(5.0, f2)) * 0.45;
    float m = fbm(uv, vec2(3.0), 4);
    float scr = scratches(uv, 6.0, 0.45, 0.004) * uP0.z;
    float pit = smoothstep(0.86, 0.97, gn(uv * 64.0, vec2(64.0))) * uP0.w;
    S s; s.albedo = vec3(0.5);
    s.height = 0.5 + (st - 0.5) * uP0.y * 0.6 - scr * 0.4 - pit * 0.6;
    s.rough = 0.5 + (st - 0.5) * 0.3 * uP0.y + (m - 0.5) * 0.25 * uWear - scr * 0.12 + pit * 0.25;
    s.ao = 1.0 - pit * 0.35; s.metal = 1.0; return s; }`,
});

Synth.registerRecipe('item_knurl', {
  // diamond knurl. p0: x pitches per tile (int), y flat-top amount, z top wear
  defaults: { p0: [8, 0.22, 0.6, 0], bump: 2.0, size: 256 },
  glsl: `S surface(vec2 uv){
    float N = floor(uP0.x + 0.5);
    float a = fract((uv.x + uv.y) * N), b = fract((uv.x - uv.y) * N);
    float h = min(1.0 - abs(a * 2.0 - 1.0), 1.0 - abs(b * 2.0 - 1.0));
    float top = smoothstep(1.0 - uP0.y - 0.06, 1.0 - uP0.y, h);
    h = min(h, 1.0 - uP0.y);
    float wn = fbm(uv + 1.7, vec2(3.0), 4);
    float worn = top * smoothstep(0.35, 0.75, wn) * uP0.z;
    S s; s.albedo = vec3(0.5); s.height = h + gn(uv * 96.0, vec2(96.0)) * 0.03;
    s.rough = 0.56 - worn * 0.22 + (1.0 - h) * 0.12;
    s.ao = 0.55 + h * 0.45; s.metal = 1.0; return s; }`,
});

Synth.registerRecipe('item_ribs', {
  // parallel ribs: ridges run along V. p0: x ribs per tile (int), y profile sharpness, z groove darkening
  defaults: { p0: [16, 0.7, 0.4, 0], bump: 1.4, size: 128 },
  glsl: `S surface(vec2 uv){
    float N = floor(uP0.x + 0.5);
    float a = fract(uv.x * N);
    float h = pow(max(0.0, sin(a * PI)), uP0.y);
    float fine = gn(uv * 48.0, vec2(48.0));
    S s; s.albedo = vec3(0.5); s.height = h + fine * 0.03;
    s.rough = 0.5 + (1.0 - h) * 0.12 + (fine - 0.5) * 0.06; s.ao = 1.0 - (1.0 - h) * uP0.z; s.metal = 0.0; return s; }`,
});

Synth.registerRecipe('item_paper', {
  // paper / paperboard / label stock. p0: x fibre scale (int), y cockle, z roughness variation
  defaults: { p0: [48, 0.3, 0.2, 0], wear: 0.3, bump: 0.8, size: 256 },
  glsl: `S surface(vec2 uv){
    float f = floor(uP0.x + 0.5);
    float f1 = gn(uv * vec2(f * 3.0, f), vec2(f * 3.0, f));
    float f2 = gn(uv * vec2(f, f * 3.0) + 2.0, vec2(f, f * 3.0));
    float fl = fbm(uv + 1.1, vec2(floor(f * 0.5)), 3);
    float ck = fbm(uv + 2.3, vec2(2.0), 4);
    float cr = smoothstep(0.9, 0.99, ridged(uv + 5.0, vec2(2.0, 3.0), 3)) * uWear;
    S s; s.albedo = vec3(0.5);
    s.height = (f1 + f2) * 0.18 + fl * 0.25 + ck * uP0.y - cr * 0.3;
    s.rough = 0.5 + (fl - 0.5) * uP0.z + cr * 0.08;
    s.ao = 0.95 + fl * 0.05 - cr * 0.1; s.metal = 0.0; return s; }`,
});

Synth.registerRecipe('item_foil', {
  // crinkled film / foil wrap. p0: x crease freq (int), y crease strength, z fine crinkle
  defaults: { p0: [4, 1, 0.3, 0], bump: 2.5, size: 256 },
  glsl: `S surface(vec2 uv){
    float f = floor(uP0.x + 0.5);
    float c1 = ridged(uv, vec2(f), 4);
    float c2 = ridged(uv + 0.37, vec2(f * 2.0 + 1.0), 3);
    float fine = gn(uv * 48.0, vec2(48.0));
    float h = c1 * uP0.y * 0.7 + c2 * uP0.y * 0.4 + fine * uP0.z;
    S s; s.albedo = vec3(0.5); s.height = h;
    s.rough = 0.5 + (c2 - 0.5) * 0.25 + (fine - 0.5) * 0.1;
    s.ao = 0.85 + c1 * 0.15; s.metal = 0.0; return s; }`,
});

Synth.registerRecipe('item_cast', {
  // forged / cast / powder-coated surface. p0: x lump freq (int), y lump strength, z pits, w orange peel
  defaults: { p0: [6, 0.6, 0.5, 0.4], wear: 0.4, bump: 1.4, size: 256 },
  glsl: `S surface(vec2 uv){
    float f = floor(uP0.x + 0.5);
    float m = fbm(uv, vec2(f), 5);
    float peel = gn(uv * 80.0, vec2(80.0));
    float pit = smoothstep(0.85, 0.96, gn(uv * 56.0 + 3.0, vec2(56.0))) * uP0.z;
    float scr = scratches(uv, 6.0, 0.45, 0.005) * uWear;
    S s; s.albedo = vec3(0.5);
    s.height = m * uP0.y + peel * uP0.w * 0.3 - pit * 0.6 - scr * 0.3;
    s.rough = 0.5 + (m - 0.5) * 0.25 + pit * 0.2 - scr * 0.1 + (peel - 0.5) * 0.08;
    s.ao = 1.0 - pit * 0.35; s.metal = 1.0; return s; }`,
});

Synth.registerRecipe('item_turned', {
  // lathe-turned / faced metal: fine concentric-ish tool marks along U + pits. p0: x marks per tile (int), y strength
  defaults: { p0: [96, 1, 0, 0], wear: 0.3, bump: 0.7, size: 128 },
  glsl: `S surface(vec2 uv){
    float N = floor(uP0.x + 0.5);
    float t = sin(uv.y * N * 2.0 * PI) * 0.5 + 0.5;
    float t2 = gn(uv * vec2(3.0, N * 2.0), vec2(3.0, N * 2.0));
    float m = fbm(uv, vec2(2.0), 3);
    S s; s.albedo = vec3(0.5); s.height = (t * 0.6 + t2 * 0.4) * uP0.y;
    s.rough = 0.5 + (t2 - 0.5) * 0.15 + (m - 0.5) * 0.2 * uWear; s.ao = 1.0; s.metal = 1.0; return s; }`,
});

// ---------------------------------------------------------------------------
// Detail sets: recipe + options, dm = meters per tile, gm = mean roughness in the ORM G channel
// ---------------------------------------------------------------------------
const DET = {
  stipple: { r: 'item_stipple', o: { p0: [64, 0.5, 0.3, 0.5], wear: 0.4 }, dm: 0.02, gm: 0.5 },
  gloss: { r: 'item_stipple', o: { p0: [96, 0.7, 0.16, 0.35], wear: 0.25, bump: 0.6 }, dm: 0.04, gm: 0.5 },
  rubber: { r: 'item_stipple', o: { p0: [40, 0.3, 0.35, 0.8], wear: 0.3, bump: 1.4 }, dm: 0.012, gm: 0.5 },
  brushed: { r: 'item_brushed', o: {}, dm: 0.04, gm: 0.5 },
  polished: { r: 'item_brushed', o: { p0: [192, 0.35, 0.35, 0.08], wear: 0.25, bump: 0.4 }, dm: 0.05, gm: 0.5 },
  cast: { r: 'item_cast', o: {}, dm: 0.04, gm: 0.5 },
  powder: { r: 'item_cast', o: { p0: [5, 0.3, 0.25, 1.0], wear: 0.3, bump: 1.0 }, dm: 0.03, gm: 0.5 },
  knurl: { r: 'item_knurl', o: {}, dm: 0.008, gm: 0.5 },
  ribs: { r: 'item_ribs', o: {}, dm: 0.012, gm: 0.5 },
  turned: { r: 'item_turned', o: {}, dm: 0.02, gm: 0.5 },
  paper: { r: 'item_paper', o: {}, dm: 0.05, gm: 0.5 },
  card: { r: 'item_paper', o: { p0: [32, 0.6, 0.25, 0], wear: 0.5, bump: 1.0 }, dm: 0.06, gm: 0.5 },
  foil: { r: 'item_foil', o: {}, dm: 0.07, gm: 0.5 },
  film: { r: 'item_foil', o: { p0: [3, 0.6, 0.15, 0], bump: 1.6 }, dm: 0.09, gm: 0.5 },
  weave: { r: 'fabric', o: { p0: [32, 32, 0, 0.6], p1: [0.2, 0, 0, 0], wear: 0.2, size: 256, bump: 2.5 }, dm: 0.012, gm: 0.86 },
  twill: { r: 'fabric', o: { p0: [48, 48, 1, 0.9], p1: [0.6, 0, 0, 0], wear: 0.3, size: 256, bump: 2.0 }, dm: 0.012, gm: 0.86 },
  gauze: { r: 'fabric', o: { p0: [20, 20, 0, 0.4], p1: [0.0, 0, 0, 0], wear: 0.1, size: 256, bump: 3.5 }, dm: 0.014, gm: 0.86 },
  wood: { r: 'wood', o: { c0: 0xa8784a, c1: 0xd9b07a, c2: 0x5a3a1e, p0: [14, 1.2, 0.8, 0.78], wear: 0.3, size: 512, bump: 2.4 }, dm: 0.5, gm: 0.75, albedo: true },
  rust: { r: 'rust', o: { wear: 0.6, size: 256 }, dm: 0.12, gm: 0.8, albedo: true },
};
export const DETAIL_NAMES = Object.keys(DET);

const _det = new Map();
export function detail(name) {
  if (_det.has(name)) return _det.get(name);
  const d = DET[name];
  if (!d) throw new Error(`items: unknown detail '${name}'`);
  const t = Synth.pbr(d.r, d.o);
  const ch = (tex) => { const c = tex.clone(); c.channel = 1; c.wrapS = c.wrapT = THREE.RepeatWrapping; c.needsUpdate = true; return c; };
  const res = { name, normalMap: ch(t.normalMap), orm: ch(t.orm), map: d.albedo ? ch(t.map) : null, dm: d.dm, gm: d.gm, size: t.size };
  _det.set(name, res);
  return res;
}
export function detailStats() {
  let bytes = 0;
  for (const d of _det.values()) bytes += d.size * d.size * 4 * 1.333 * (d.map ? 3 : 2);
  return { count: _det.size, mb: bytes / 1048576 };
}

// ---------------------------------------------------------------------------
// Material factory
// o: { key, map (atlas | texture), color, rough, metal, det, ns, aoI, dm, vc, cc, ccr, sheen, sheenColor, sheenRough,
//      emissive, ei, emissiveMap, transparent, opacity, depthWrite, side, env, name, physical, alphaTest, specular,
//      polygonOffset, detAlbedo (use the detail set's albedo instead of a print map) }
// Shared (cached) by key; pass `key: null` for a unique material.
// ---------------------------------------------------------------------------
const _mats = new Map();
function keyFor(o) {
  const k = {};
  for (const [a, b] of Object.entries(o)) k[a] = b && b.key && b.tex ? `atlas:${b.key}` : b && b.isTexture ? `tex:${b.uuid}` : b;
  return JSON.stringify(k);
}
export function mat(o = {}) {
  const key = o.key === null ? null : (o.key ?? keyFor(o));
  if (key && _mats.has(key)) return _mats.get(key);
  const d = o.det ? detail(o.det) : null;
  const P = {
    color: o.color ?? 0xffffff,
    metalness: o.metal ?? 0,
    vertexColors: o.vc !== false,
  };
  const rough = o.rough ?? 0.5;
  P.roughness = rough;
  if (o.map) P.map = o.map.tex || o.map;
  if (d) {
    P.normalMap = d.normalMap;
    const ns = o.ns ?? 1;
    P.normalScale = new THREE.Vector2(ns, ns);
    P.roughnessMap = d.orm;
    P.aoMap = d.orm;
    P.aoMapIntensity = o.aoI ?? 1;
    P.roughness = Math.min(2.5, rough / d.gm);
    if (o.detAlbedo && d.map) P.map = d.map;
  }
  if (o.emissive !== undefined) { P.emissive = new THREE.Color(o.emissive); P.emissiveIntensity = o.ei ?? 1; if (o.emissiveMap) P.emissiveMap = o.emissiveMap.tex || o.emissiveMap; }
  if (o.transparent) { P.transparent = true; P.opacity = o.opacity ?? 1; P.depthWrite = o.depthWrite ?? false; }
  if (o.alphaTest) P.alphaTest = o.alphaTest;
  if (o.side !== undefined) P.side = o.side;
  if (o.env !== undefined) P.envMapIntensity = o.env;
  if (o.polygonOffset) { P.polygonOffset = true; P.polygonOffsetFactor = -2; P.polygonOffsetUnits = -2; }
  const physical = o.physical || o.cc || o.sheen || o.specular !== undefined;
  let m;
  if (physical) {
    m = new THREE.MeshPhysicalMaterial(P);
    if (o.cc) { m.clearcoat = o.cc; m.clearcoatRoughness = o.ccr ?? 0.12; }
    if (o.sheen) { m.sheen = o.sheen; m.sheenRoughness = o.sheenRough ?? 0.6; m.sheenColor = new THREE.Color(o.sheenColor ?? 0xffffff); }
    if (o.specular !== undefined) m.specularIntensity = o.specular;
  } else m = new THREE.MeshStandardMaterial(P);
  m.name = o.name || `item_${o.det || 'plain'}`;
  m.userData.dm = o.dm ?? d?.dm ?? 0.02;
  if (o.map?.plain) m.userData.plain = o.map.plain;
  if (o.noShadow) m.userData.noShadow = true;
  if (key) _mats.set(key, m);
  return m;
}

// Clear glass / clear plastic: black base + additive blending, so only reflections and highlights add on
// top of what is behind (alpha blending turns bottles milky). tint -> faint emissive body colour.
export function clear(o = {}) {
  const key = 'clear' + JSON.stringify(o);
  if (o.unique !== true && _mats.has(key)) return _mats.get(key);
  const m = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: new THREE.Color(o.tint ?? 0x000000), emissiveIntensity: 1, roughness: o.rough ?? 0.05, metalness: 0,
    envMapIntensity: o.env ?? 1.6, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: o.side ?? THREE.FrontSide,
    vertexColors: false,
  });
  if (o.det) {
    const d = detail(o.det);
    m.normalMap = d.normalMap; m.normalScale = new THREE.Vector2(o.ns ?? 0.5, o.ns ?? 0.5);
    m.userData.dm = d.dm;
  }
  m.name = o.name || 'item_clear';
  m.userData.noShadow = true;
  if (o.unique !== true) _mats.set(key, m);
  return m;
}

// Tinted see-through plastic / glass (amber vials, coloured lenses): alpha blended, low roughness
export function tinted(o = {}) {
  const key = 'tinted' + JSON.stringify(o);
  if (_mats.has(key)) return _mats.get(key);
  const m = new THREE.MeshPhysicalMaterial({
    color: o.color ?? 0xd07018, roughness: o.rough ?? 0.12, metalness: 0, transparent: true, opacity: o.opacity ?? 0.55,
    clearcoat: o.cc ?? 0.8, clearcoatRoughness: o.ccr ?? 0.06, envMapIntensity: o.env ?? 1.3, depthWrite: false, side: o.side ?? THREE.FrontSide,
  });
  if (o.det) {
    const d = detail(o.det);
    m.normalMap = d.normalMap; m.normalScale = new THREE.Vector2(o.ns ?? 0.4, o.ns ?? 0.4);
    m.userData.dm = d.dm;
  }
  m.name = o.name || 'item_tinted';
  m.userData.noShadow = true;
  _mats.set(key, m);
  return m;
}

// ---------------------------------------------------------------------------
// Shared bare surfaces (vertex-colour tintable). Values follow measured F0 / albedo tables.
// ---------------------------------------------------------------------------
export const S = {
  steel: () => mat({ name: 'item_steel', color: 0xc6c9cb, metal: 1, rough: 0.34, det: 'brushed', ns: 0.5 }),
  steelDark: () => mat({ name: 'item_steel_dark', color: 0x8a8e92, metal: 1, rough: 0.42, det: 'cast', ns: 0.6 }),
  chrome: () => mat({ name: 'item_chrome', color: 0xe4e6e8, metal: 1, rough: 0.07, det: 'polished', ns: 0.15, env: 1.25 }),
  alu: () => mat({ name: 'item_alu', color: 0xe6e8ea, metal: 1, rough: 0.26, det: 'brushed', ns: 0.35 }),
  brass: () => mat({ name: 'item_brass', color: 0xe2c27a, metal: 1, rough: 0.28, det: 'polished', ns: 0.35 }),
  copper: () => mat({ name: 'item_copper', color: 0xeeb08a, metal: 1, rough: 0.3, det: 'polished', ns: 0.35 }),
  blackOxide: () => mat({ name: 'item_blackoxide', color: 0x3a3c40, metal: 1, rough: 0.45, det: 'cast', ns: 0.5 }),
  zinc: () => mat({ name: 'item_zinc', color: 0xc8ccce, metal: 1, rough: 0.4, det: 'cast', ns: 0.45 }),
  rubber: () => mat({ name: 'item_rubber', color: 0x262628, rough: 0.82, det: 'rubber', ns: 0.8 }),
  plasticBlack: () => mat({ name: 'item_plastic_black', color: 0x1e1f21, rough: 0.48, det: 'stipple', ns: 0.6 }),
  plasticWhite: () => mat({ name: 'item_plastic_white', color: 0xe8e6de, rough: 0.42, det: 'stipple', ns: 0.5 }),
  plastic: () => mat({ name: 'item_plastic', color: 0xffffff, rough: 0.45, det: 'stipple', ns: 0.55 }),
};

// Additive flame (gradient alpha along the cone), HDR so bloom picks it up
export function flameMat(tex) {
  const key = 'flame';
  if (_mats.has(key)) return _mats.get(key);
  const m = new THREE.MeshBasicMaterial({ name: 'item_flame', map: tex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  m.color.setScalar(2.4);
  m.userData.noShadow = true;
  _mats.set(key, m);
  return m;
}

// Emissive (glowing) material for parts (lenses, glow liquids): own instance
export function glow(o = {}) {
  const m = new THREE.MeshStandardMaterial({
    name: o.name || 'item_glow', color: o.color ?? 0x101010, emissive: new THREE.Color(o.emissive ?? 0xffffff), emissiveIntensity: o.ei ?? 1,
    roughness: o.rough ?? 0.3, metalness: 0, transparent: !!o.transparent, opacity: o.opacity ?? 1, depthWrite: o.transparent ? false : true,
    blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending, vertexColors: false,
  });
  m.userData.noShadow = !!(o.transparent || o.additive);
  return m;
}
