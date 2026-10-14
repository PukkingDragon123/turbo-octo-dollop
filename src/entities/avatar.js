// R.O.O.M. — player avatar: a chubby PEAK-style burlap sack doll (bead eyes, red felt clown nose,
// stitched brows and mouth) wearing the classic Backrooms hazmat suit: baggy crinkled PVC
// coverall with the hood framing the sack face, taped seams, storm-flapped zip, black rubber
// mittens and wellingtons taped on with duct tape, SCBA air tank and a chunky wrist terminal.
//
// This module is the stable API facade; the implementation lives in ./doll/:
//   doll_avatar.js  Avatar (skinned, cached parts, procedural animation, expressions)
//   ragdoll.js      buildRagdoll (rigid physics parts)
//   fparms.js       buildFirstPersonArms (viewmodel + watch screen)
//   suit.js / sack.js / face.js / gear.js / cosm.js   sculpted geometry
//   dolltex.js / dollmat.js   GPU-synthesised fabrics + materials, decal atlas
//   dollcos.js      cosmetics catalogue
//   kit.js / legacy.js        shared helpers kept for the other doll-based modules
export { clamp, lerp, smooth, damp, G, surfaceGrid, ribbon, paint, mergeChunks, Rig, Spring, Wobble, cached } from './doll/kit.js';
export {
  HEAD, headF, headRphi, headPt, headNormal, frontPhi, featurePt, headGrid, D, SKIN, THREAD, NOSE, BLUSH, EYE,
  bodyR, bodyPoint, bodyNormal, surfQ, clothMat, AM, feltTex, MOUTHS, mouthAtlas, setMouthCell, buildFace,
} from './doll/legacy.js';
export { COSMETICS, DEFAULT_COSMETICS, cosmeticEntry, randomCosmetics, resolveCos } from './doll/dollcos.js';
export { Avatar } from './doll/doll_avatar.js';
export { buildRagdoll } from './doll/ragdoll.js';
export { buildFirstPersonArms } from './doll/fparms.js';
