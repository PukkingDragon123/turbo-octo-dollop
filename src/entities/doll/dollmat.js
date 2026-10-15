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
import { synth, atlasTextures, creaseTexture, CREASE_METERS } from './dolltex.js';

// colourways of the one classic hazmat suit (keyed by cosmetic id)
export const SUIT_STYLE = {
  yellow: { color: 0xf3c010 },
  orange: { color: 0xf0761a },
  white: { color: 0xecebe4, rough: 1.0, cc: 0.0, tyvek: true },
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

// Suit shader extras (onBeforeCompile):
//  * joint compression folds: a second normal map (creaseTexture) blended in proportionally to how
//    "mixed" the vertex's skin weights are, i.e. exactly at the elbows, knees, waist, armpits, neck
//    and ankles, with cavity darkening in the fold valleys. Static meshes (ragdoll) get none.
//  * a soft rim (Fresnel) lift of the clearcoat so the PVC reads as a glossy rubberised film.
const CREASE_TEX = { value: null };
// torsoK: [a, kx, b] maps a body's rest heights / widths onto the doll's torso bands
// (ay = y * a + b, ax = |x| * kx); the android coverall uses its own mapping
function suitShader(m, amt = 1, rep = 1, torsoK = [1, 1, 0]) {
  CREASE_TEX.value = creaseTexture();
  const u = { uCrease: CREASE_TEX, uCreaseRep: { value: rep }, uCreaseAmt: { value: amt }, uTorsoK: { value: new THREE.Vector3(...torsoK) } };
  m.userData.crease = u.uCreaseAmt;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vJoint;\nuniform vec3 uTorsoK;')
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>
        #ifdef USE_SKINNING
          float jmx = max(max(skinWeight.x, skinWeight.y), max(skinWeight.z, skinWeight.w));
          float jdom = skinWeight.x >= jmx ? skinIndex.x : skinWeight.y >= jmx ? skinIndex.y : skinWeight.z >= jmx ? skinIndex.z : skinIndex.w;
          vJoint = smoothstep(0.95, 0.6, jmx);
          // torso (pelvis / body / chest dominant): its weights blend over the whole belly, so use a
          // waist band, the armpits and the crotch instead (rest-space position)
          if (jdom < 2.5) {
            float ay = position.y * uTorsoK.x + uTorsoK.z, ax = abs(position.x) * uTorsoK.y;
            vJoint = 0.55 * exp(-pow((ay - 0.482) / 0.016, 2.0)) + 0.35 * exp(-pow((ay - 0.413) / 0.013, 2.0))
              + 0.6 * smoothstep(0.17, 0.23, ax) * smoothstep(0.58, 0.64, ay) * (1.0 - smoothstep(0.69, 0.75, ay)) * (1.0 - smoothstep(0.08, 0.16, abs(position.z)));
          } else if (jdom < 4.5) {
            // head / hood: the hood's back flops on its own bone; only crease the neck
            vJoint *= 1.0 - smoothstep(0.86, 0.93, position.y);
          }
        #else
          vJoint = 0.0;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vJoint;\nuniform sampler2D uCrease;\nuniform float uCreaseRep, uCreaseAmt;')
      .replace('#include <normal_fragment_maps>', `
        #ifdef USE_NORMALMAP_TANGENTSPACE
          vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
          mapN.xy *= normalScale;
          float jk = vJoint * uCreaseAmt;
          if (jk > 0.002) {
            vec4 cr = texture2D( uCrease, vNormalMapUv * uCreaseRep );
            mapN.xy += (cr.xy * 2.0 - 1.0) * jk * 0.65;
            diffuseColor.rgb *= 1.0 - (1.0 - cr.a) * 0.3 * jk;
            roughnessFactor = clamp(roughnessFactor + (1.0 - cr.a) * 0.1 * jk, 0.0, 1.0);
          }
          normal = normalize( tbn * mapN );
        #else
          #include <normal_fragment_maps>
        #endif`);
  };
  m.customProgramCacheKey = () => 'doll_suit_crease';
  return m;
}
// glass / clear visors: alpha rises toward grazing angles (Fresnel), so a faceplate stays clear
// face-on but shows a bright reflective rim and environment streaks at its edges
function fresnelGlass(m, base = 0.06, rim = 0.75) {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
      float fres = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 2.6);
      diffuseColor.a = clamp(${base.toFixed(3)} + fres * ${rim.toFixed(3)} + dot(outgoingLight, vec3(0.3)) * 0.6, 0.0, 0.92);
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'doll_glass_fresnel';
  return m;
}

export const DM = {
  // opts.torsoK: torso band mapping for other bodies (android coverall)
  suit(id, entry, opts = {}) {
    return cached('dm_suit_' + id + (opts.torsoK ? '_' + opts.torsoK.join(',') : ''), () => {
      const st = suitStyle(id, entry);
      const pvc = synth(st.tyvek ? 'doll_tyvek' : 'doll_pvc');
      const nrm = st.normal ? synth(st.normal) : pvc;
      const m = new THREE.MeshPhysicalMaterial({
        name: 'doll_suit_' + id, color: st.color, vertexColors: true,
        map: st.print ? synth(st.print).map : pvc.map,
        normalMap: nrm.normalMap, normalScale: new THREE.Vector2(0.9, 0.9),
        roughnessMap: pvc.orm, roughness: (st.rough ?? 1.0),
        metalness: st.metal ?? 0, metalnessMap: null,
        clearcoat: st.cc ?? 0.55, clearcoatRoughness: st.ccRough ?? 0.2,
        specularIntensity: 0.85,
        sheen: st.tyvek || st.fleeceRim ? 0.6 : 0.0, sheenRoughness: 0.7, sheenColor: new THREE.Color(0xffffff).multiplyScalar(0.35),
        envMapIntensity: 1.15,
      });
      return suitShader(m, st.tyvek ? 0.7 : 1.0, pvc.meters / CREASE_METERS, opts.torsoK);
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
    // thick moulded rubber (gloves, boots, gaskets): satin with a wet clearcoat sheen
    const t = synth('doll_rubber');
    return new THREE.MeshPhysicalMaterial({
      name: 'doll_rubber', color: 0xffffff, vertexColors: true, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: t.orm, roughness: 0.95, clearcoat: 0.45, clearcoatRoughness: 0.32, specularIntensity: 0.7, envMapIntensity: 1.2,
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
  glass: () => cached('dm_glass', () => fresnelGlass(new THREE.MeshPhysicalMaterial({
    name: 'doll_glass', color: 0x0c1014, transparent: true, opacity: 0.12, roughness: 0.04, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.03, specularIntensity: 1, ior: 1.5, envMapIntensity: 2.2, depthWrite: false, side: THREE.DoubleSide,
  }))),
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
