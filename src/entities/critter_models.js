// Procedural ambient critters for R.O.O.M.: rats, cockroaches and aquarium fish.
// Each builder returns { root, mesh, update(dt, params), dispose() }.
//   root: THREE.Group. Rats/roaches: origin on the floor under the body. Fish: origin at the
//         body center. All face -Z, Y up, meters.
// Every critter is one SkinnedMesh with a small hierarchical skeleton; geometry, textures and
// materials are cached per kind and shared between instances (geometry.userData.shared).
//   rat       2 draw calls (furred skin + alpha-tested fur shells), ~2.7k tris   critters/rat.js
//   cockroach 1 draw call, ~530 tris                                               critters/roach.js
//   fish      2 draw calls (scaled body + translucent rayed fins), ~1.1k tris      critters/fish.js
export { buildRat } from './critters/rat.js';
export { buildCockroach } from './critters/roach.js';
export { buildFish, FISH_KINDS } from './critters/fish.js';
export { disposeCritterCache } from './critters/kit.js';
