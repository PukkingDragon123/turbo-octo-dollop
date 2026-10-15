// R.O.O.M. — player avatar: a cheap, mass-produced 1990s corporate android clone (the same family
// as GLORIA, the HQ receptionist) in a R.O.O.M. work coverall: yellowed ABS shell with mould seams,
// scuffs and screws, a porcelain face plate with a painted smile and a ventriloquist jaw, glassy eyes
// with LED pupils, rubber bellows and cable looms at the joints, articulated hands.
//
// This module is the stable API facade; the implementation lives in ./doll/:
//   doll_avatar.js  Avatar (skinned, cached parts, procedural animation, face servos)
//   ragdoll.js      buildRagdoll (rigid physics parts)
//   fparms.js       buildFirstPersonArms (viewmodel + watch screen)
//   robotrig.js / robotshape.js            android skeleton, head / face layout
//   robotbody.js / robothead.js / robotcos.js   sculpted geometry (coverall, frame, head, cosmetics)
//   robotface.js / robotmat.js / dolltex.js / dollmat.js   painted face, materials, decal atlas
//   dollcos.js      cosmetics catalogue
//   kit.js / legacy.js / sack.js / suit.js / face.js / gear.js / cosm.js / dollrig.js
//                   the old sack-doll modules, still used by the clone models / still lifes
export { clamp, lerp, smooth, damp, G, surfaceGrid, ribbon, paint, mergeChunks, Rig, Spring, Wobble, cached } from './doll/kit.js';
export {
  HEAD, headF, headRphi, headPt, headNormal, frontPhi, featurePt, headGrid, D, SKIN, THREAD, NOSE, BLUSH, EYE,
  bodyR, bodyPoint, bodyNormal, surfQ, clothMat, AM, feltTex, MOUTHS, mouthAtlas, setMouthCell, buildFace,
} from './doll/legacy.js';
export { COSMETICS, DEFAULT_COSMETICS, cosmeticEntry, randomCosmetics, resolveCos } from './doll/dollcos.js';
export { Avatar } from './doll/doll_avatar.js';
export { buildRagdoll } from './doll/ragdoll.js';
export { buildFirstPersonArms } from './doll/fparms.js';
