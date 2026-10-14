// Suspended acoustic ceiling for one 3 m cell of Level 0: 5x5 lay-in tiles on the 0.6 m T-bar grid (the
// grid flanges live in the tile texture), recessed 2x4 prismatic troffers aligned to the grid, and
// damage: missing tiles (exposed T-bar webs + dark plenum), tiles knocked out of the grid and resting
// tilted, water-logged sagging tiles (always stained) and fallen tile fragments on the floor.
import { CELL, HEIGHT } from '../levels/yellow/layout.js';
import { hash01 } from '../../core/rng.js';
import { fr } from './builder.js';

const H = HEIGHT;
const TILE = CELL / 5;          // 0.6 m
const FACE_Y = H - 0.002;       // tile face
const F5 = fr(5);

// per-zone damage probabilities per tile: [missing, displaced, sagging]
const DAMAGE = {
  halls: [0.004, 0.006, 0.009], office: [0.003, 0.004, 0.006], pillars: [0.004, 0.006, 0.008], manila: [0.005, 0.006, 0.01],
  dark: [0.03, 0.03, 0.025], flooded: [0.02, 0.02, 0.06], maintenance: [0.016, 0.02, 0.012],
};

// tile kinds
const T_NORMAL = 0, T_TROFFER = 1, T_MISSING = 2, T_DISPLACED = 3, T_SAG = 4;

// G: { ceil, enamel, lens, plenum, debris } EnvGeo builders; baker: GridBaker; seed
export function ceilingCell(G, baker, c, seed) {
  const x0 = c.i * CELL, z0 = c.j * CELL;
  const kind = new Uint8Array(25);
  // troffer: 2x4 along x (lightRot) or z, centred on the middle row/column, aligned to the tile grid
  let trof = null;
  if (c.light) {
    if (c.lightRot) { kind[2 * 5 + 1] = kind[2 * 5 + 2] = T_TROFFER; trof = { a0: 1, a1: 3, b0: 2, b1: 3, alongX: true }; }
    else { kind[1 * 5 + 2] = kind[2 * 5 + 2] = T_TROFFER; trof = { a0: 2, a1: 3, b0: 1, b1: 3, alongX: false }; }
  }
  const dmg = DAMAGE[c.zone] || DAMAGE.halls;
  const k = c.special ? 0.4 : 1;
  for (let b = 0; b < 5; b++) for (let a = 0; a < 5; a++) {
    if (kind[b * 5 + a]) continue;
    const h = hash01(c.i * 5 + a, c.j * 5 + b, 71, seed);
    if (h < dmg[0] * k) kind[b * 5 + a] = T_MISSING;
    else if (h < (dmg[0] + dmg[1]) * k) kind[b * 5 + a] = T_DISPLACED;
    else if (h < (dmg[0] + dmg[1] + dmg[2]) * k) kind[b * 5 + a] = T_SAG;
  }
  if (c.hole) kind[0 * 5 + 1 + ((((c.i * 7) % 3) + 3) % 3)] = T_MISSING;

  // --- regular tiles: one 6x6 vertex grid, specials left out
  const ce = G.ceil;
  const [e0, e1] = baker.edgeInfo(c.i, c.j, true);
  ce.edge0 = e0; ce.edge1 = e1;
  ce.wet = c.zone === 'flooded' ? 1 : c.zone === 'dark' ? 0.5 : c.wet * 0.5;
  ce.ao = 1;
  // grid lines: tile boundaries around special tiles plus a few fixed ones for lighting interpolation
  const lu = new Set([0, 2, 3, 5]), lv = new Set([0, 2, 3, 5]);
  for (let b = 0; b < 5; b++) for (let a = 0; a < 5; a++) if (kind[b * 5 + a]) { lu.add(a); lu.add(a + 1); lv.add(b); lv.add(b + 1); }
  const us = [...lu].sort((p, q) => p - q), vs = [...lv].sort((p, q) => p - q);
  const tileOf = (ia, ib) => kind[ib * 5 + ia];
  ce.grid([x0, FACE_Y, z0], [CELL, 0, 0], [0, 0, CELL], [0, -1, 0], us.map((u) => u / 5), vs.map((v) => v / 5), (x, y, z) => [x, z],
    (iu, iv) => tileOf(us[iu], vs[iv]) !== T_NORMAL);

  // --- troffer
  if (trof) troffer(G, x0 + trof.a0 * TILE, z0 + trof.b0 * TILE, x0 + trof.a1 * TILE, z0 + trof.b1 * TILE, trof.alongX, hash01(c.i, c.j, 73, seed));

  // --- damaged tiles
  for (let b = 0; b < 5; b++) for (let a = 0; a < 5; a++) {
    const t = kind[b * 5 + a];
    if (t < T_MISSING) continue;
    const X0 = x0 + a * TILE, Z0 = z0 + b * TILE;
    const h2 = hash01(c.i * 5 + a, c.j * 5 + b, 72, seed);
    if (t === T_SAG) { sagTile(ce, X0, Z0, 0.03 + h2 * 0.05); continue; }
    hole(G, X0, Z0, h2);
    if (t === T_DISPLACED) tiltedTile(G.ceil, X0, Z0, h2);
    else if (G.debris && h2 < 0.75) fallenPieces(G.debris, X0, Z0, h2);
  }
}

// recessed 2x4 troffer: enamel door frame + inner return, prismatic lens set back into the housing
export function troffer(G, X0, Z0, X1, Z1, alongX, h, H = HEIGHT) {
  const en = G.enamel, ln = G.lens;
  const f = 0.032, y0 = H - 0.006, yl = H + 0.04;
  en.ao = 1;
  const D = [0, -1, 0];
  // flat frame ring
  en.rect([X0, y0, Z0], [X1, y0, Z0], [X1, y0, Z0 + f], [X0, y0, Z0 + f], D);
  en.rect([X0, y0, Z1 - f], [X1, y0, Z1 - f], [X1, y0, Z1], [X0, y0, Z1], D);
  en.rect([X0, y0, Z0 + f], [X0 + f, y0, Z0 + f], [X0 + f, y0, Z1 - f], [X0, y0, Z1 - f], D);
  en.rect([X1 - f, y0, Z0 + f], [X1, y0, Z0 + f], [X1, y0, Z1 - f], [X1 - f, y0, Z1 - f], D);
  // outer lip (frame thickness) and the inner return up to the lens
  const ix0 = X0 + f, ix1 = X1 - f, iz0 = Z0 + f, iz1 = Z1 - f;
  en.ao = 0.75;
  en.rectOriented([[ix0, y0, iz0], [ix1, y0, iz0], [ix1, yl, iz0], [ix0, yl, iz0]], [0, 0, 1]);
  en.rectOriented([[ix0, y0, iz1], [ix1, y0, iz1], [ix1, yl, iz1], [ix0, yl, iz1]], [0, 0, -1]);
  en.rectOriented([[ix0, y0, iz0], [ix0, y0, iz1], [ix0, yl, iz1], [ix0, yl, iz0]], [1, 0, 0]);
  en.rectOriented([[ix1, y0, iz0], [ix1, y0, iz1], [ix1, yl, iz1], [ix1, yl, iz0]], [-1, 0, 0]);
  en.ao = 1;
  // lens: u along the long axis, v across (0..1); the material repeats the prism texture
  const uvf = alongX ? (x, y, z) => [(x - ix0) / (ix1 - ix0), (z - iz0) / (iz1 - iz0)] : (x, y, z) => [(z - iz0) / (iz1 - iz0), (x - ix0) / (ix1 - ix0)];
  ln.rectOriented([[ix0, yl, iz0], [ix1, yl, iz0], [ix1, yl, iz1], [ix0, yl, iz1]], D, uvf);
  void h;
}

// missing / displaced tile: the exposed T-bar flanges + webs around the opening and the dark plenum
function hole(G, X0, Z0, h) {
  const en = G.enamel, pl = G.plenum;
  const X1 = X0 + TILE, Z1 = Z0 + TILE, f = 0.012, yb = H - 0.004, yt = H + 0.038;
  const D = [0, -1, 0];
  en.ao = 1;
  en.rect([X0, yb, Z0], [X1, yb, Z0], [X1, yb, Z0 + f], [X0, yb, Z0 + f], D);
  en.rect([X0, yb, Z1 - f], [X1, yb, Z1 - f], [X1, yb, Z1], [X0, yb, Z1], D);
  en.rect([X0, yb, Z0 + f], [X0 + f, yb, Z0 + f], [X0 + f, yb, Z1 - f], [X0, yb, Z1 - f], D);
  en.rect([X1 - f, yb, Z0 + f], [X1, yb, Z0 + f], [X1, yb, Z1 - f], [X1 - f, yb, Z1 - f], D);
  en.ao = 0.6;
  en.rectOriented([[X0, yb, Z0 + 0.001], [X1, yb, Z0 + 0.001], [X1, yt, Z0 + 0.001], [X0, yt, Z0 + 0.001]], [0, 0, 1]);
  en.rectOriented([[X0, yb, Z1 - 0.001], [X1, yb, Z1 - 0.001], [X1, yt, Z1 - 0.001], [X0, yt, Z1 - 0.001]], [0, 0, -1]);
  en.rectOriented([[X0 + 0.001, yb, Z0], [X0 + 0.001, yb, Z1], [X0 + 0.001, yt, Z1], [X0 + 0.001, yt, Z0]], [1, 0, 0]);
  en.rectOriented([[X1 - 0.001, yb, Z0], [X1 - 0.001, yb, Z1], [X1 - 0.001, yt, Z1], [X1 - 0.001, yt, Z0]], [-1, 0, 0]);
  en.ao = 1;
  // plenum cavity: tile backs around the opening, the slab above, ducts sometimes
  const yp = H + 0.55;
  pl.ao = 0.55;
  const m = 0.002;
  pl.rectOriented([[X0 + m, yt, Z0 + m], [X1 - m, yt, Z0 + m], [X1 - m, yp, Z0 + m], [X0 + m, yp, Z0 + m]], [0, 0, 1]);
  pl.rectOriented([[X0 + m, yt, Z1 - m], [X1 - m, yt, Z1 - m], [X1 - m, yp, Z1 - m], [X0 + m, yp, Z1 - m]], [0, 0, -1]);
  pl.rectOriented([[X0 + m, yt, Z0 + m], [X0 + m, yt, Z1 - m], [X0 + m, yp, Z1 - m], [X0 + m, yp, Z0 + m]], [1, 0, 0]);
  pl.rectOriented([[X1 - m, yt, Z0 + m], [X1 - m, yt, Z1 - m], [X1 - m, yp, Z1 - m], [X1 - m, yp, Z0 + m]], [-1, 0, 0]);
  pl.ao = 0.4;
  pl.rect([X0, yp, Z0], [X1, yp, Z0], [X1, yp, Z1], [X0, yp, Z1], D);
  if (h > 0.55) {
    // a duct or pipe crossing the opening, seen from below
    pl.ao = 0.5;
    if (h > 0.8) pl.box(X0 - 0.01, H + 0.22, Z0 + 0.12, X1 + 0.01, H + 0.45, Z0 + 0.42, { px: true, nx: true });
    else pl.tube('z', Z0 + 0.002, Z1 - 0.002, X0 + 0.18 + (h - 0.55) * 0.8, H + 0.28, 0.06, 10);
  }
  pl.ao = 1;
}

// tile knocked up out of the grid, resting tilted on one T-bar (hinged at one edge, lifted at the other)
function tiltedTile(ce, X0, Z0, h) {
  const lift = 0.07 + h * 0.12, th = 0.016, inset = 0.012;
  const side = Math.floor(h * 997) % 4;
  // local square [0, s] x [0, s] hinged along u = 0, lifted towards u = s
  const s = TILE - inset * 2;
  const ang = Math.asin(Math.min(0.6, lift / s));
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const P = (u, w, y) => {
    // rotate (u, y) about the hinge, then orient by side
    const uu = u * ca - y * sa, yy = u * sa + y * ca;
    const base = H - 0.004;
    let x, z;
    switch (side) {
      case 0: x = X0 + inset + uu; z = Z0 + inset + w; break;
      case 1: x = X0 + TILE - inset - uu; z = Z0 + inset + w; break;
      case 2: x = X0 + inset + w; z = Z0 + inset + uu; break;
      default: x = X0 + inset + w; z = Z0 + TILE - inset - uu; break;
    }
    return [x, base + yy, z];
  };
  const nrm = (a, b, c) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    return [n[0] / l, n[1] / l, n[2] / l];
  };
  const quad = (a, b, c, d, wantDown) => {
    let n = nrm(a, b, c);
    if ((wantDown && n[1] > 0) || (!wantDown && n[1] < 0)) n = [-n[0], -n[1], -n[2]];
    ce.rectOriented([a, b, c, d], n, (x, y, z) => [x, z]);
  };
  const b0 = P(0, 0, 0), b1 = P(s, 0, 0), b2 = P(s, s, 0), b3 = P(0, s, 0);
  const t0 = P(0, 0, th), t1 = P(s, 0, th), t2 = P(s, s, th), t3 = P(0, s, th);
  ce.ao = 1;
  quad(b0, b1, b2, b3, true);
  ce.ao = 0.7;
  quad(t0, t1, t2, t3, false);
  // edges
  for (const [a, b, c, d] of [[b0, b1, t1, t0], [b1, b2, t2, t1], [b2, b3, t3, t2], [b3, b0, t0, t3]]) {
    const n = nrm(a, b, c);
    const cx = (a[0] + c[0]) / 2, cz = (a[2] + c[2]) / 2, mx = X0 + TILE / 2, mz = Z0 + TILE / 2;
    const out = (cx - mx) * n[0] + (cz - mz) * n[2] >= 0 ? n : [-n[0], -n[1], -n[2]];
    ce.rectOriented([a, b, c, d], out, (x, y, z) => [x + z, y]);
  }
  ce.ao = 1;
}

// water-logged tile bowing down between its T-bars
function sagTile(ce, X0, Z0, sag) {
  const n = 4;
  const prevWet = ce.wet;
  ce.wet = 3; // forces a stain in the ceiling shader
  ce.autoCell(X0 + TILE / 2, Z0 + TILE / 2, 0, 0);
  const base = ce.vc;
  const f = (u, w) => sag * (1 - (2 * u - 1) ** 2) * (1 - (2 * w - 1) ** 2);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const u = i / n, w = j / n;
    const x = X0 + u * TILE, z = Z0 + w * TILE, y = FACE_Y - f(u, w);
    const e = 0.01;
    const dx = (f(Math.min(1, u + e), w) - f(Math.max(0, u - e), w)) / (2 * e * TILE);
    const dz = (f(u, Math.min(1, w + e)) - f(u, Math.max(0, w - e))) / (2 * e * TILE);
    const l = Math.hypot(dx, 1, dz);
    ce.v(x, y, z, -dx / l, -1 / l, -dz / l, x, z);
  }
  const t0 = ce.I.n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k0 = base + j * (n + 1) + i, k1 = k0 + 1, k2 = k0 + n + 1, k3 = k2 + 1;
    ce.tri(k0, k1, k3); ce.tri(k0, k3, k2);
  }
  ce._fixWinding(t0);
  ce.wet = prevWet;
}

// broken bits of a fallen tile on the floor below the hole
function fallenPieces(db, X0, Z0, h) {
  const n = 2 + Math.floor(h * 3);
  db.ao = 0.8;
  for (let k = 0; k < n; k++) {
    const r1 = hash01(Math.floor(X0 * 10) + k, Math.floor(Z0 * 10), 91, 7), r2 = hash01(Math.floor(X0 * 10), Math.floor(Z0 * 10) + k, 92, 7);
    const sx = 0.08 + r1 * 0.22, sz = 0.06 + r2 * 0.2;
    const cx = X0 + 0.1 + r1 * 0.4, cz = Z0 + 0.1 + r2 * 0.4;
    db.box(cx - sx / 2, 0.0, cz - sz / 2, cx + sx / 2, 0.012 + r2 * 0.006, cz + sz / 2, { ny: true }, 0, (x, y, z) => [x * 0.5 + y, z * 0.5]);
  }
  db.ao = 1;
}

export { TILE, FACE_Y };
