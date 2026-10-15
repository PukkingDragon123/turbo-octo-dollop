// R.O.O.M. — clone android materials (shared process-wide; all Physical/Standard so baked light
// probes apply).
//   shell : injection-moulded ABS (tinted by the 'skin' cosmetic: yellowed ivory, factory white,
//           bakelite, primer grey, dusty rose) with mottling, yellowing, scuffs and grime
//   face  : glazed porcelain face plate (painted face texture per face cosmetic, same tint)
//   suit  : the R.O.O.M. coverall (the hazmat colourways of the old doll suit, crease shader)
//   rubber / metal / bead / decal / plastic / tape / canvas / knit / felt / glass : see dollmat.js
import * as THREE from 'three';
import { cached } from './kit.js';
import { DM } from './dollmat.js';
import { synth } from './dolltex.js';
import { faceTexture } from './robotface.js';
import { RY } from './robotrig.js';

export const SKIN_TONE = { tan: 0xe0d2b0, light: 0xf0ebdf, dark: 0x7c5a40, grey: 0xa3a19b, rose: 0xe6bcae };
const toneOf = (cos) => SKIN_TONE[cos.skin] ?? SKIN_TONE.tan;

// coverall: map the android's rest heights onto the doll crease bands (waist / crotch / armpits)
const A = 0.069 / (RY.spine - 0.88);
export const COVERALL_TORSO_K = [+A.toFixed(4), 1.4, +(0.482 - A * RY.spine).toFixed(4)];

export const RM = {
  shell(hex) {
    return cached('rm_shell_' + hex, () => {
      const t = synth('plastic', { c0: 0xffffff, c1: 0xefe0b8, c2: 0x6a5a40, wear: 0.42, p0: [0.46, 0.55, 0, 0], seed: 7 });
      return new THREE.MeshPhysicalMaterial({
        name: 'robot_abs', color: hex, vertexColors: true, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.35, 0.35),
        roughnessMap: t.orm, roughness: 1.0, metalness: 0, clearcoat: 0.22, clearcoatRoughness: 0.42, specularIntensity: 0.62, envMapIntensity: 0.95,
      });
    });
  },
  face(entry, hex) {
    return cached('rm_face_' + (entry?.id || 'dots') + '_' + hex, () => new THREE.MeshPhysicalMaterial({
      name: 'robot_face', color: hex, vertexColors: true, map: faceTexture(entry || {}),
      roughness: 0.3, metalness: 0, clearcoat: 0.65, clearcoatRoughness: 0.16, specularIntensity: 0.75, envMapIntensity: 1.15,
    }));
  },
};

export function robotMaterial(key, cos) {
  switch (key) {
    case 'shell': return RM.shell(toneOf(cos));
    case 'face': return RM.face(cos.faceEntry, toneOf(cos));
    case 'suit': return DM.suit(cos.suit, cos.suitEntry, { torsoK: COVERALL_TORSO_K });
    default: {
      const f = DM[key];
      if (!f) throw new Error('robot: unknown material ' + key);
      return f();
    }
  }
}
export const ROBOT_MAT_FLAGS = {
  decal: { shadow: false, order: 1 },
  glass: { shadow: false, order: 2 },
  bead: { shadow: false },
};
