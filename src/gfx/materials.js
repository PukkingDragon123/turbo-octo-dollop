// Shared material library. Materials are PBR (MeshStandard/Physical).
//  - World surfaces (wallpaper, carpet, ceiling, concrete, office_carpet, linoleum, paint*, panel, tile*,
//    lightpanel and the environment set: trim, enamel, cmu, slab, pipes, insulation...) are built on GPU-
//    synthesized texture sets (src/gfx/texsynth.js + src/world/env/recipes.js): albedo + normal + ORM.
//    UVs are in meters: repeat = 1 / meters of the texture tile.
//  - Object materials (wood, metal, fabric, plastic...) still use the canvas textures in textures.js.
// Use Mat.get(name) for shared instances (cheap, batched by three.js) and Mat.make(name, overrides) when an
// object needs its own copy.
import * as THREE from 'three';
import * as Tex from './textures.js';
import * as Synth from './texsynth.js';
import '../world/env/recipes.js';

const defs = {
  // --- Object materials (UVs 0..1 per face; textures tile once unless overridden) ---
  wood: { tex: 'wood', color: 0xffffff, roughness: 1 },
  wood_light: { tex: 'wood', color: 0xe8c9a0, roughness: 1 },
  wood_dark: { tex: 'wood', color: 0x7a5a44, roughness: 1 },
  plank: { tex: 'plank', color: 0xffffff, roughness: 1 },
  metal: { tex: 'metal', color: 0xb9bcbf, roughness: 1, metalness: 1, metalMap: true },
  metal_dark: { tex: 'metal', color: 0x4a4e52, roughness: 1, metalness: 1, metalMap: true },
  metal_red: { tex: 'metal', color: 0xa8312a, roughness: 1, metalness: 1, metalMap: true },
  metal_yellow: { tex: 'metal', color: 0xd9a92a, roughness: 1, metalness: 1, metalMap: true },
  metal_green: { tex: 'metal', color: 0x4f6b4a, roughness: 1, metalness: 1, metalMap: true },
  metal_blue: { tex: 'metal', color: 0x3b5674, roughness: 1, metalness: 1, metalMap: true },
  metal_beige: { tex: 'metal', color: 0xc9bea2, roughness: 1, metalness: 1, metalMap: true },
  steel: { tex: 'steel', color: 0xffffff, roughness: 1, metalness: 1 },
  chrome: { color: 0xeeeeee, roughness: 0.08, metalness: 1, envMapIntensity: 1.4 },
  brass: { color: 0xc9a65a, roughness: 0.3, metalness: 1 },
  rust: { tex: 'rust', color: 0xffffff, roughness: 1, metalness: 1, metalMap: true },
  cardboard: { tex: 'cardboard', color: 0xffffff, roughness: 1 },
  fabric_blue: { tex: 'fabric', color: 0x3c4f6e, roughness: 1, texRepeat: 4 },
  fabric_grey: { tex: 'fabric', color: 0x6d6d6a, roughness: 1, texRepeat: 4 },
  fabric_red: { tex: 'fabric', color: 0x8a3030, roughness: 1, texRepeat: 4 },
  fabric_green: { tex: 'fabric', color: 0x4f6b46, roughness: 1, texRepeat: 4 },
  fabric_brown: { tex: 'fabric', color: 0x7a5b3e, roughness: 1, texRepeat: 4 },
  fabric_white: { tex: 'fabric', color: 0xd8d4c8, roughness: 1, texRepeat: 4 },
  hazmat_yellow: { tex: 'hazmat', color: 0xf2c418, roughness: 1, normalScale: 0.8, texRepeat: 2 },
  plastic_white: { tex: 'plastic', color: 0xe9e6dc, roughness: 1 },
  plastic_beige: { tex: 'plastic', color: 0xcfc4a6, roughness: 1 },
  plastic_black: { tex: 'plastic', color: 0x1d1d1f, roughness: 1 },
  plastic_grey: { tex: 'plastic', color: 0x7a7c7e, roughness: 1 },
  plastic_red: { tex: 'plastic', color: 0xc0302a, roughness: 1 },
  plastic_blue: { tex: 'plastic', color: 0x2f5d9e, roughness: 1 },
  plastic_green: { tex: 'plastic', color: 0x3f8a4a, roughness: 1 },
  plastic_orange: { tex: 'plastic', color: 0xe8661c, roughness: 1 },
  plastic_yellow: { tex: 'plastic', color: 0xf0c020, roughness: 1 },
  rubber: { color: 0x1a1a1a, roughness: 0.85 },
  paper: { color: 0xf1eee4, roughness: 0.9 },
  glass: { physical: true, color: 0xcfe6e6, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.18, envMapIntensity: 1.6, depthWrite: false },
  glass_tint: { physical: true, color: 0x5c7a72, roughness: 0.05, transparent: true, opacity: 0.35, envMapIntensity: 1.5, depthWrite: false },
  visor: { physical: true, color: 0xaad8ff, roughness: 0.02, transparent: true, opacity: 0.22, envMapIntensity: 2.0, clearcoat: 1, depthWrite: false },
  crt_glass: { physical: true, color: 0x111612, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.0 },
  goo: { physical: true, color: 0x050806, roughness: 0.18, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.2 },
  emissive_red: { color: 0x330000, emissive: 0xff2010, emissiveIntensity: 3 },
  emissive_green: { color: 0x003300, emissive: 0x30ff60, emissiveIntensity: 2.5 },
  emissive_amber: { color: 0x332200, emissive: 0xffa020, emissiveIntensity: 2.5 },
  emissive_white: { color: 0xffffff, emissive: 0xfff4dc, emissiveIntensity: 2.5 },
};

// --- World surfaces: GPU-synthesized PBR sets (recipe r with overrides o). UVs in meters unless world:false.
// ns = normal scale, rough = roughness multiplier, metal = metalness (uses the ORM blue channel when the
// recipe carries metal), aniso = anisotropic filtering (floors get the maximum).
const synth = {
  wallpaper: { r: 'env_wallpaper', o: {}, ns: 1.0 },
  wallpaper_manila: { r: 'env_wallpaper', o: { c0: 0xb48c58, c1: 0x94703f, c2: 0x553a1c, c3: 0xc6a06a, p0: [3, 6, 18, 0.95], p1: [1, 0.7, 1, 1], size: 512 }, ns: 1.0 },
  carpet: { r: 'env_carpet', o: {}, ns: 1.0, aniso: 16 },
  ceiling: { r: 'env_acoustic', o: {}, ns: 1.0 },
  concrete: { r: 'concrete', o: { c0: 0xa8a49a, c1: 0x86827a, c2: 0x4e4a44, c3: 0xbdb7aa, p0: [70, 0.35, 0.6, 0.45], wear: 0.35, meters: 2, size: 512 }, ns: 1.0 },
  concrete_dark: { r: 'env_slab', o: {}, color: 0x9a968e, ns: 1.0, aniso: 16 },
  slab: { r: 'env_slab', o: {}, ns: 1.0, aniso: 16 },
  cmu: { r: 'env_cmu', o: {}, ns: 1.0 },
  office_carpet: { r: 'env_carpet_tile', o: {}, ns: 1.0, aniso: 16 },
  linoleum: { r: 'env_vct', o: {}, ns: 0.8, aniso: 16, envMapIntensity: 1.0 },
  paint: { r: 'env_paint', o: { c0: 0xf2ede2, c1: 0xe2dccd, c2: 0x9a907a }, color: 0xddd2b9, ns: 0.8 },
  paint_green: { r: 'env_paint', o: { c0: 0xf2ede2, c1: 0xe2dccd, c2: 0x9a907a }, color: 0x93a890, ns: 0.8 },
  paint_blue: { r: 'env_paint', o: { c0: 0xf2ede2, c1: 0xe2dccd, c2: 0x9a907a }, color: 0x8fa0b3, ns: 0.8 },
  paint_white: { r: 'env_paint', o: { c0: 0xf2ede2, c1: 0xe2dccd, c2: 0x9a907a }, color: 0xeae7e0, ns: 0.8 },
  panel: { r: 'env_panel', o: {}, ns: 1.0 },
  tile: { r: 'env_ceramic', o: { size: 512 }, ns: 1.0, envMapIntensity: 1.0 },
  tile_green: { r: 'env_ceramic', o: { size: 512 }, color: 0xb4d8bd, ns: 1.0, envMapIntensity: 1.0 },
  tile_pool: { r: 'env_ceramic', o: { size: 512 }, color: 0xe2f4f6, ns: 1.0, envMapIntensity: 1.2 },
  lightpanel: { r: 'env_prism', o: {}, world: false, texRepeat: 4, emissive: 0xfff1d8, emissiveIntensity: 2.6, emissiveFromMap: true, rough: 1, ns: 0.6 },
  // environment detail set
  trim: { r: 'wood', o: { c0: 0x4e3d2a, c1: 0x6f5a3e, c2: 0x2a2014, p0: [20, 1, 0.8, 0.5], wear: 0.4, meters: 1, size: 512 }, ns: 0.8 },
  trim_paint: { r: 'env_enamel', o: {}, color: 0xcbbf9e, rough: 1.1, ns: 0.6 },
  enamel: { r: 'env_enamel', o: {}, color: 0xf2efe6, ns: 0.5 },
  fixture: { r: 'env_enamel', o: {}, color: 0xffffff, ns: 0.4, vertexColors: true },
  rubber_base: { r: 'vinyl', o: { c0: 0x2a2826, c1: 0x34312e, p0: [140, 0.55, 0, 0], wear: 0.3, meters: 0.3, size: 512 }, ns: 0.6 },
  pipe_paint: { r: 'paint_metal', o: { c0: 0x5e6a58, wear: 0.45, meters: 0.6, size: 512 }, ns: 1.0, metal: 1 },
  galvanized: { r: 'metal', o: { c0: 0xb4b8b8, c1: 0x868a8a, c2: 0x5a5448, p0: [0.4, 0.42, 0.25, 0], wear: 0.5, meters: 0.5, size: 512 }, ns: 0.8, metal: 1 },
  insulation: { r: 'env_insulation', o: {}, ns: 1.0, metal: 1 },
  // brushed stainless shares the galvanized synthesis (brighter tint, smoother)
  stainless: { r: 'metal', o: { c0: 0xb4b8b8, c1: 0x868a8a, c2: 0x5a5448, p0: [0.4, 0.42, 0.25, 0], wear: 0.5, meters: 0.5, size: 512 }, color: 0xf4f6f8, rough: 0.7, ns: 0.6, metal: 1, envMapIntensity: 1.3 },
  // dark plenum / soffit concrete shares the generic concrete synthesis
  plenum: { r: 'concrete', o: { c0: 0xa8a49a, c1: 0x86827a, c2: 0x4e4a44, c3: 0xbdb7aa, p0: [70, 0.35, 0.6, 0.45], wear: 0.35, meters: 2, size: 512 }, color: 0x4a4740, ns: 0.8 },
};

const shared = new Map();
const repeatSets = new Map();

// cloned texture views with their own repeat (the GPU upload is shared through texture.source)
function repeatSet(r, o, rep, aniso) {
  const key = `${r}|${JSON.stringify(o)}|${rep.toFixed(5)}|${aniso || 0}`;
  let s = repeatSets.get(key);
  if (!s) {
    const t = Synth.pbr(r, o);
    const cl = (tex) => {
      const c = tex.clone();
      c.repeat.set(rep, rep);
      if (aniso) c.anisotropy = aniso;
      c.needsUpdate = true;
      return c;
    };
    s = { map: cl(t.map), normalMap: cl(t.normalMap), orm: cl(t.orm), meters: t.meters, metal: t.metal };
    repeatSets.set(key, s);
  }
  return s;
}

function buildSynth(name, d, ov) {
  const o = d.o || {};
  const t0 = Synth.pbr(d.r, o);
  const rep = d.world === false ? (ov.texRepeat ?? d.texRepeat ?? 1) : (1 / t0.meters) * (ov.texScale ?? 1);
  const t = repeatSet(d.r, o, rep, d.aniso);
  const P = {
    map: t.map,
    normalMap: t.normalMap,
    roughnessMap: t.orm,
    aoMap: t.orm,
    aoMapIntensity: d.aoIntensity ?? 1,
    color: ov.color ?? d.color ?? 0xffffff,
    roughness: ov.roughness ?? d.rough ?? 1,
    metalness: ov.metalness ?? d.metal ?? 0,
  };
  if (d.metal && t.metal) P.metalnessMap = t.orm;
  const ns = ov.normalScale ?? d.ns ?? 1;
  P.normalScale = new THREE.Vector2(ns, ns);
  if ((ov.envMapIntensity ?? d.envMapIntensity) !== undefined) P.envMapIntensity = ov.envMapIntensity ?? d.envMapIntensity;
  const em = ov.emissive ?? d.emissive;
  if (em !== undefined) {
    P.emissive = em;
    P.emissiveIntensity = ov.emissiveIntensity ?? d.emissiveIntensity ?? 1;
    if (d.emissiveFromMap) P.emissiveMap = t.map;
  }
  if (d.vertexColors || ov.vertexColors) P.vertexColors = true;
  if (ov.transparent) { P.transparent = true; P.opacity = ov.opacity ?? 1; }
  const m = new THREE.MeshStandardMaterial(P);
  m.name = name;
  m.userData.synth = { recipe: d.r, meters: t0.meters, repeat: rep };
  if (ov.side ?? d.side) m.side = ov.side ?? d.side;
  return m;
}

function build(name, overrides = {}) {
  if (synth[name]) return buildSynth(name, synth[name], overrides);
  const d = { ...defs[name], ...overrides };
  if (!defs[name] && !overrides.color) throw new Error(`Unknown material '${name}'`);
  const params = {
    color: d.color ?? 0xffffff,
    roughness: d.roughness ?? 0.8,
    metalness: d.metalness ?? 0,
  };
  if (d.transparent) {
    params.transparent = true;
    params.opacity = d.opacity ?? 1;
  }
  if (d.depthWrite === false) params.depthWrite = false;
  if (d.emissive !== undefined) {
    params.emissive = d.emissive;
    params.emissiveIntensity = d.emissiveIntensity ?? 1;
  }
  if (d.envMapIntensity !== undefined) params.envMapIntensity = d.envMapIntensity;
  if (d.physical) {
    if (d.clearcoat) params.clearcoat = d.clearcoat;
    if (d.clearcoatRoughness !== undefined) params.clearcoatRoughness = d.clearcoatRoughness;
  }
  if (d.tex) {
    const rep = d.world ? 1 / Tex.get(d.tex).size : (d.texRepeat ?? 1);
    const t = Tex.get(d.tex, rep);
    params.map = t.map;
    if (t.normalMap) {
      params.normalMap = t.normalMap;
      const ns = d.normalScale ?? 1;
      params.normalScale = new THREE.Vector2(ns, ns);
    }
    if (t.roughnessMap) params.roughnessMap = t.roughnessMap;
    if (d.metalMap && t.roughnessMap) params.metalnessMap = t.roughnessMap;
    if (d.emissiveFromMap) params.emissiveMap = t.map;
  }
  const m = d.physical ? new THREE.MeshPhysicalMaterial(params) : new THREE.MeshStandardMaterial(params);
  m.name = name;
  if (d.side) m.side = d.side;
  return m;
}

export function get(name) {
  if (!shared.has(name)) shared.set(name, build(name));
  return shared.get(name);
}

export function make(name, overrides = {}) {
  return build(name, overrides);
}

export function has(name) {
  return !!defs[name] || !!synth[name];
}

export function list() {
  return [...Object.keys(defs), ...Object.keys(synth)];
}

export function isWorld(name) {
  return !!synth[name];
}

// Synthesize the world texture sets up front (loading screen); yields between sets.
const WARM = ['wallpaper', 'wallpaper_manila', 'carpet', 'ceiling', 'slab', 'cmu', 'office_carpet', 'linoleum', 'paint', 'panel', 'tile',
  'lightpanel', 'trim', 'enamel', 'rubber_base', 'pipe_paint', 'galvanized', 'insulation', 'plenum'];
export async function warmWorld(onProgress) {
  const seen = new Set();
  const jobs = [];
  for (const [name, d] of Object.entries(synth)) {
    if (!WARM.includes(name)) continue;
    const k = d.r + JSON.stringify(d.o || {});
    if (seen.has(k)) continue;
    seen.add(k);
    jobs.push([name, d]);
  }
  for (let i = 0; i < jobs.length; i++) {
    const [name, d] = jobs[i];
    try { Synth.pbr(d.r, d.o || {}); } catch (e) { console.warn('[materials] synth failed', name, e); }
    onProgress?.((i + 1) / jobs.length, name);
    await new Promise((r) => setTimeout(r, 0));
  }
}

// Plain color helper (rarely needed)
export function color(hex, roughness = 0.6, metalness = 0) {
  const key = `c_${hex}_${roughness}_${metalness}`;
  if (!shared.has(key)) shared.set(key, new THREE.MeshStandardMaterial({ color: hex, roughness, metalness }));
  return shared.get(key);
}
