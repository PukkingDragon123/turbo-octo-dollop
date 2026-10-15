// Warehouse pallet racking for Level 0's tall warehouse sectors: double-sided bays standing on cell edge lines
// (perforated blue uprights, orange step beams, wire-mesh decks), static and merged into the chunk meshes.
// The boxes and crates on the decks are ordinary physics props (spawned by the layout at RACK_LEVELS).
import { CELL } from '../levels/yellow/layout.js';

export const RACK_DEPTH = 1.0;                 // back-to-back, 0.5 m into each aisle
export const RACK_LEVELS = [0.16, 1.32, 2.46]; // deck tops
const UP_H = 3.3;

// G: { rackUp, rackBeam, metal } builders. x0..x1 along x at z = zc (the cell edge line).
// startPost / endPost: draw the uprights at that end (shared posts are drawn once). colliders: [{min, max}]
export function rackBay(G, x0, x1, zc, startPost, endPost, colliders, h = 0) {
  const up = G.rackUp, bm = G.rackBeam, dk = G.metal;
  const zf = zc + RACK_DEPTH / 2, zb = zc - RACK_DEPTH / 2;
  const pw = 0.075; // upright section
  const posts = [];
  if (startPost) posts.push(x0 + 0.04);
  if (endPost) posts.push(x1 - 0.04);
  up.ao = 1;
  for (const px of posts) {
    for (const pz of [zf - pw / 2, zb + pw / 2, zc - 0.03, zc + 0.03]) {
      // two upright frames (front / back pair per side) + a spine pair in the middle
      const s = pz === zc - 0.03 || pz === zc + 0.03 ? 0.045 : pw;
      up.box(px - s / 2, 0, pz - s / 2, px + s / 2, UP_H, pz + s / 2, { ny: true }, 1.7);
    }
    // frame bracing (diagonals between the front and back uprights of each side)
    for (const [za, zb2] of [[zf - pw, zc + 0.03], [zb + pw, zc - 0.03]]) {
      for (let k = 0; k < 2; k++) {
        const ya = 0.3 + k * 1.4, yb = ya + 1.4;
        const a = [px, ya, k % 2 ? za : zb2], b = [px, yb, k % 2 ? zb2 : za];
        up.tubePath([a, b], 0.012, 3);
      }
    }
    // base plates
    for (const pz of [zf - pw / 2, zb + pw / 2]) up.box(px - 0.07, 0, pz - 0.07, px + 0.07, 0.008, pz + 0.07, { ny: true });
    colliders.push({ min: { x: px - pw / 2, y: 0, z: zb }, max: { x: px + pw / 2, y: UP_H, z: zf } });
  }
  // step beams + decks per level, both sides
  const bx0 = x0 + (startPost ? 0.08 : 0), bx1 = x1 - (endPost ? 0.08 : 0);
  bm.ao = 1;
  dk.ao = 1;
  RACK_LEVELS.forEach((ly, k) => {
    for (const [zo, zi] of [[zf, zc + 0.03], [zb, zc - 0.03]]) {
      const outer = zo, inner = zi;
      const zA = Math.min(outer, inner), zB = Math.max(outer, inner);
      // beams: front and back of the deck, 10 cm tall step beams under the deck top
      const fz = outer > zc ? outer - 0.05 : outer + 0.05;
      bm.box(bx0, ly - 0.11, Math.min(outer, fz), bx1, ly - 0.01, Math.max(outer, fz), {}, 3);
      const iz = inner > zc ? inner + 0.04 : inner - 0.04;
      bm.box(bx0, ly - 0.11, Math.min(inner, iz), bx1, ly - 0.01, Math.max(inner, iz), { [inner > zc ? 'nz' : 'pz']: true }, 3);
      // wire deck (slightly dimpled look comes from the galvanized texture)
      dk.box(bx0, ly - 0.012, zA + 0.02, bx1, ly, zB - 0.02, { px: true, nx: true }, 3);
      colliders.push({ min: { x: bx0, y: ly - 0.11, z: zA }, max: { x: bx1, y: ly, z: zB } });
      // rare: a load sign on the front beam
      if (k === 0 && h > 0.7) bm.box((bx0 + bx1) / 2 - 0.08, ly - 0.1, outer > zc ? outer : outer - 0.003, (bx0 + bx1) / 2 + 0.08, ly - 0.02, outer > zc ? outer + 0.003 : outer, {});
    }
  });
}

// rack footprint rect (for prop placement keep-outs): [x0, z0, x1, z1]
export function rackRect(x0, zc) { return [x0, zc - RACK_DEPTH / 2 - 0.03, x0 + CELL, zc + RACK_DEPTH / 2 + 0.03]; }
