// R.O.O.M. — doll materials (all MeshPhysical/MeshStandard so the baked light probes apply).
// Shared process-wide: every avatar with the same suit / skin uses the same instances.
//   suit   : crinkled PVC hazmat fabric (per colourway / print)
//   burlap : the sack face (per skin tone), fuzzy sheen
//   felt   : nose, stitches, pom-poms (sheen tinted by the fibre colour)
//   bead   : glossy black glass eyes
//   rubber : gloves, boots, mask, hose ends      tape : duct tape, webbing, canvas
//   plastic: tank paint, watch case, buckles      metal: zip, valves, rings
//   decal  : shared canvas atlas (labels, badge, patch, LCD; emissive twin)
//   knit / glass : cosmetics only
import * as THREE from 'three';
import { cached } from './kit.js';
import { synth, atlasTextures } from './dolltex.js';

// colourways of the one classic hazmat suit (keyed by cosmetic id)
export const SUIT_STYLE = {
  yellow: { color: 0xf3c010 },
  orange: { color: 0xf0761a },
  white: { color: 0xecebe4, rough: 1.5, cc: 0.0, tyvek: true },
  blue: { color: 0x3a80d6 },
  pink: { color: 0xf19ac0 },
  mint: { color: 0x84dcb8 },
  lavender: { color: 0xb09ae4 },
  hawaiian: { color: 0xffffff, print: 'doll_hawaii', rough: 1.15 },
  fleece: { color: 0xc8962c, rough: 1.45, cc: 0.05, fleeceRim: true },
  orange_hivis: { color: 0xf26812, hivis: true },
  navy_jacket: { color: 0x2a3654, normal: 'doll_quilt', rough: 1.1, piping: true },
  red: { color: 0xd3382c, cross: true },
  black: { color: 0x2b2b31, rough: 0.9, cc: 0.5 },
  camo: { color: 0xffffff, print: 'doll_camo', rough: 1.3, cc: 0.08 },
  gold: { color: 0xe8b43e, metal: 0.7, rough: 0.55, cc: 1.0 },
};
export const suitStyle = (id, entry) => SUIT_STYLE[id] || { color: entry?.color ?? 0xf3c010 };

// tint the sheen lobe by the albedo so felt / burlap fuzz glows in its own colour
function sheenTint(m, k = 1.0) {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
      #ifdef USE_SHEEN
        material.sheenColor *= clamp(diffuseColor.rgb * ${k.toFixed(2)} + 0.015, 0.0, 1.0);
      #endif`);
  };
  m.customProgramCacheKey = () => 'doll_sheen_' + k.toFixed(2);
  return m;
}

export const DM = {
  suit(id, entry) {
    return cached('dm_suit_' + id, () => {
      const st = suitStyle(id, entry);
      const pvc = synth('doll_pvc');
      const nrm = st.normal ? synth(st.normal) : pvc;
      const m = new THREE.MeshPhysicalMaterial({
        name: 'doll_suit_' + id, color: st.color, vertexColors: true,
        map: st.print ? synth(st.print).map : pvc.map,
        normalMap: nrm.normalMap, normalScale: new THREE.Vector2(1.45, 1.45),
        roughnessMap: pvc.orm, roughness: (st.rough ?? 1.0),
        metalness: st.metal ?? 0, metalnessMap: null,
        clearcoat: st.cc ?? 0.22, clearcoatRoughness: 0.32,
        sheen: st.tyvek || st.fleeceRim ? 0.6 : 0.0, sheenRoughness: 0.7, sheenColor: new THREE.Color(0xffffff).multiplyScalar(0.35),
        envMapIntensity: 1.0,
      });
      return m;
    });
  },
  burlap(hex) {
    return cached('dm_burlap_' + hex, () => {
      const t = synth('doll_burlap');
      return sheenTint(new THREE.MeshPhysicalMaterial({
        name: 'doll_burlap', color: hex, vertexColors: true, map: t.map,
        normalMap: t.normalMap, normalScale: new THREE.Vector2(1.0, 1.0), roughnessMap: t.orm, roughness: 1,
        sheen: 0.85, sheenRoughness: 0.5, sheenColor: new THREE.Color(1, 1, 1),
      }), 1.1);
    });
  },
  felt: () => cached('dm_felt', () => {
    const t = synth('doll_felt');
    return sheenTint(new THREE.MeshPhysicalMaterial({
      name: 'doll_felt', color: 0xffffff, vertexColors: true, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(2.2, 2.2),
      roughness: 1, sheen: 1, sheenRoughness: 0.42, sheenColor: new THREE.Color(1, 1, 1),
    }), 1.4);
  }),
  bead: () => cached('dm_bead', () => new THREE.MeshPhysicalMaterial({
    name: 'doll_bead', color: 0xffffff, vertexColors: true, roughness: 0.07, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, ior: 1.6, envMapIntensity: 1.8,
  })),
  rubber: () => cached('dm_rubber', () => {
    const t = synth('doll_rubber');
    return new THREE.MeshPhysicalMaterial({
      name: 'doll_rubber', color: 0xffffff, vertexColors: true, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.7, 0.7),
      roughnessMap: t.orm, roughness: 1, clearcoat: 0.18, clearcoatRoughness: 0.45, envMapIntensity: 1.1,
    });
  }),
  hose: () => cached('dm_hose', () => {
    const t = synth('doll_rubber');
    return new THREE.MeshStandardMaterial({
      name: 'doll_hose', color: 0xffffff, vertexColors: true, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: 0.62, metalness: 0, envMapIntensity: 0.6,
    });
  }),
  tape: () => cached('dm_tape', () => {
    const t = synth('doll_tape');
    return new THREE.MeshPhysicalMaterial({
      name: 'doll_tape', color: 0xffffff, vertexColors: true, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.9, 0.9),
      roughnessMap: t.orm, roughness: 1.0, metalness: 0.15, sheen: 0.25, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffffff).multiplyScalar(0.4),
    });
  }),
  canvas: () => cached('dm_canvas', () => {
    const t = synth('doll_tape', {}, 1 / 0.035);
    return sheenTint(new THREE.MeshPhysicalMaterial({
      name: 'doll_canvas', color: 0xffffff, vertexColors: true, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(1.3, 1.3),
      roughness: 0.9, sheen: 0.6, sheenRoughness: 0.55, sheenColor: new THREE.Color(1, 1, 1),
    }), 1.1);
  }),
  plastic: () => cached('dm_plastic', () => {
    const t = synth('doll_rubber');
    return new THREE.MeshPhysicalMaterial({
      name: 'doll_plastic', color: 0xffffff, vertexColors: true, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.2, 0.2),
      roughness: 0.36, clearcoat: 0.55, clearcoatRoughness: 0.16,
    });
  }),
  metal: () => cached('dm_metal', () => new THREE.MeshStandardMaterial({
    name: 'doll_metal', color: 0xffffff, vertexColors: true, metalness: 1, roughness: 0.3, envMapIntensity: 1.35,
  })),
  decal: () => cached('dm_decal', () => {
    const A = atlasTextures();
    return new THREE.MeshStandardMaterial({
      name: 'doll_decal', color: 0xffffff, vertexColors: true, map: A.map, emissiveMap: A.emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.7,
      roughness: 0.5, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
  }),
  knit: () => cached('dm_knit', () => {
    const t = synth('doll_knit');
    return sheenTint(new THREE.MeshPhysicalMaterial({
      name: 'doll_knit', color: 0xffffff, vertexColors: true, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(1.2, 1.2),
      roughness: 1, sheen: 0.9, sheenRoughness: 0.5, sheenColor: new THREE.Color(1, 1, 1),
    }), 1.3);
  }),
  glass: () => cached('dm_glass', () => new THREE.MeshPhysicalMaterial({
    name: 'doll_glass', color: 0xe8f4ff, transparent: true, opacity: 0.2, roughness: 0.03, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.8, depthWrite: false, side: THREE.DoubleSide,
  })),
};

// resolve a material key for an avatar's cosmetics
export function dollMaterial(key, cos) {
  if (key === 'suit') return DM.suit(cos.suit, cos.suitEntry);
  if (key === 'burlap') return DM.burlap(cos.skinEntry?.color ?? 0xc9a977);
  const f = DM[key];
  if (!f) throw new Error('doll: unknown material ' + key);
  return f();
}
// render order / shadow flags per key
export const MAT_FLAGS = {
  decal: { shadow: false, order: 1 },
  glass: { shadow: false, order: 2 },
};
