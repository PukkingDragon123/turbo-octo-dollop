// Shared material library. Materials are PBR (MeshStandard/Physical) built on the
// procedural textures in textures.js. Use Mat.get(name) for shared instances (cheap,
// batched by three.js) and Mat.make(name, overrides) when an object needs its own copy.
import * as THREE from 'three';
import * as Tex from './textures.js';

const defs = {
  // --- World surfaces (UVs in meters; repeat applied from texture size) ---
  wallpaper: { tex: 'wallpaper', world: true, color: 0xffffff, roughness: 1, normalScale: 0.7 },
  carpet: { tex: 'carpet', world: true, color: 0xffffff, roughness: 1, normalScale: 1.0 },
  ceiling: { tex: 'ceiling', world: true, color: 0xffffff, roughness: 1, normalScale: 0.8 },
  concrete: { tex: 'concrete', world: true, color: 0xb8b4ac, roughness: 1, normalScale: 1.0 },
  concrete_dark: { tex: 'concrete', world: true, color: 0x6c6a66, roughness: 1, normalScale: 1.0 },
  office_carpet: { tex: 'officeCarpet', world: true, color: 0xffffff, roughness: 1 },
  linoleum: { tex: 'linoleum', world: true, color: 0xffffff, roughness: 1, envMapIntensity: 0.9 },
  paint: { tex: 'paint', world: true, color: 0xd8cdb4, roughness: 1, normalScale: 0.5 },
  paint_green: { tex: 'paint', world: true, color: 0x8fa58c, roughness: 1, normalScale: 0.5 },
  paint_blue: { tex: 'paint', world: true, color: 0x8b9db0, roughness: 1, normalScale: 0.5 },
  paint_white: { tex: 'paint', world: true, color: 0xe8e6e0, roughness: 1, normalScale: 0.5 },
  panel: { tex: 'panel', world: true, color: 0xffffff, roughness: 1 },
  tile: { tex: 'tile', world: true, color: 0xffffff, roughness: 1, envMapIntensity: 1.0 },
  tile_green: { tex: 'tile', world: true, color: 0x9fc2a8, roughness: 1, envMapIntensity: 1.0 },

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
  lightpanel: { tex: 'lightpanel', color: 0xffffff, emissiveFromMap: true, emissive: 0xfff2d6, emissiveIntensity: 2.6, roughness: 0.4 },
};

const shared = new Map();

function build(name, overrides = {}) {
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
  return !!defs[name];
}

export function list() {
  return Object.keys(defs);
}

// Plain color helper (rarely needed)
export function color(hex, roughness = 0.6, metalness = 0) {
  const key = `c_${hex}_${roughness}_${metalness}`;
  if (!shared.has(key)) shared.set(key, new THREE.MeshStandardMaterial({ color: hex, roughness, metalness }));
  return shared.get(key);
}
