// Things floating in Level 0's flood water: soggy paper sheets, foam cups, swollen chunks of ceiling
// tile, an empty can. Static, deterministic per cell, written into the chunk's merged builders so they
// cost no extra draw calls (paper -> 'paper' builder, chunks -> ceiling debris, cups/cans -> metal).
import { CELL } from '../levels/yellow/layout.js';
import { hash01 } from '../../core/rng.js';

const WY = 0.09; // water surface

export function floatingDebris(G, waterCells, seed) {
  for (const c of waterCells) {
    const h = hash01(c.i, c.j, 141, seed);
    if (h > 0.55) continue;
    const n = 1 + Math.floor(hash01(c.i, c.j, 142, seed) * 3);
    for (let k = 0; k < n; k++) {
      const r = (q) => hash01(c.i * 7 + k, c.j * 13 + q, 143, seed);
      const x = c.i * CELL + 0.35 + r(1) * 2.3, z = c.j * CELL + 0.35 + r(2) * 2.3;
      const yaw = r(3) * Math.PI * 2;
      const kind = r(4);
      const u = [Math.cos(yaw), 0, Math.sin(yaw)], w = [-Math.sin(yaw), 0, Math.cos(yaw)];
      if (kind < 0.45 && G.paper) {
        // a sheet of paper, bowed along a soft crease: two panels tilted about the crease line
        const g = G.paper;
        const tilt = 0.04 + r(5) * 0.08;
        g.ao = 0.95;
        for (const sgn of [-1, 1]) {
          const U = rot(u, w, sgn * tilt), V = rot([0, 1, 0], w, sgn * tilt);
          const cxp = x + u[0] * 0.0525 * sgn, czp = z + u[2] * 0.0525 * sgn;
          g.orientedBox([cxp, WY + 0.002 + 0.0525 * Math.sin(tilt), czp], U, V, w, 0.0525, 0.0008, 0.148, (px, py, pz) => [px * 3, pz * 3]);
        }
      } else if (kind < 0.75 && G.debris) {
        // swollen chunk of mineral-fibre tile, half submerged
        const g = G.debris;
        const sx = 0.12 + r(6) * 0.18, sz = 0.1 + r(7) * 0.16;
        g.ao = 0.85;
        g.orientedBox([x, WY - 0.002, z], u, [0, 1, 0], w, sx / 2, 0.009, sz / 2, (px, py, pz) => [px * 0.5 + py, pz * 0.5]);
      } else if (G.metal) {
        // a crushed can / cup lying on its side, axis-aligned for the tube builder
        const g = G.metal;
        const len = 0.11, rad = 0.03;
        g.ao = 0.9;
        if (r(8) < 0.5) g.tube('x', x - len / 2, x + len / 2, WY + rad * 0.35, z, rad, 10, [true, true]);
        else g.tube('z', z - len / 2, z + len / 2, x, WY + rad * 0.35, rad, 10, [true, true]);
      }
    }
  }
}

// rotate vector v around axis a by angle t (Rodrigues)
function rot(v, a, t) {
  const c = Math.cos(t), s = Math.sin(t);
  const d = v[0] * a[0] + v[1] * a[1] + v[2] * a[2];
  const cr = [a[1] * v[2] - a[2] * v[1], a[2] * v[0] - a[0] * v[2], a[0] * v[1] - a[1] * v[0]];
  const o = [v[0] * c + cr[0] * s + a[0] * d * (1 - c), v[1] * c + cr[1] * s + a[1] * d * (1 - c), v[2] * c + cr[2] * s + a[2] * d * (1 - c)];
  const l = Math.hypot(o[0], o[1], o[2]) || 1;
  return [o[0] / l, o[1] / l, o[2] / l];
}
