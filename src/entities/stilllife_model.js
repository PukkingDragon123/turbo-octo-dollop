// R.O.O.M. — "Still Lifes": grotesque mutated copies of the sack-doll employees.
// Each variant is sculpted as one continuous signed-distance body (burlap skin, hazmat suit,
// rubber gloves/boots, felt noses, stuffing), meshed + decimated once, auto-skinned to its own
// procedural rig and animated procedurally (holds, snaps, saccades, planted feet, lunges).
// Implementation lives in ./stilllife/ (self-contained; no avatar.js internals).
//
// buildStillLife(variant, seed) -> { root, update(dt, state), height, radius }
//   state: { speed, moving, attacking 0..1, alert 0..1, lookTarget?: Vector3 (world), frozen }
export { STILL_LIFE_VARIANTS, buildStillLife, buildStats, prewarmStillLifes } from './stilllife/index.js';
