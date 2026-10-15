// Variable ceiling heights for Level 0 cells (tall halls, low rooms, crawlspaces):
//  - tallCeiling: the exposed concrete deck of a tall cell with steel beams, and a pendant troffer hung on rods
//    at the standard fixture height (the light field lights every fixture from HEIGHT - 0.04, so tall halls read
//    as a ceiling of hanging lights with a dim void above)
//  - ceilingStep: the bulkhead / upper wall where two neighbouring cells have different ceilings (lit from the
//    taller cell), with colliders; openings in walls below the step are respected
//  - lowCeiling: the regular suspended ceiling built at a lower height (vertex shift of the standard build)
import { CELL, HEIGHT } from '../levels/yellow/layout.js';
import { wallPieces, T } from './walls.js';
import { troffer, ceilingCell, TILE } from './ceiling.js';
import { hash01 } from '../../core/rng.js';

const H = HEIGHT;

// G: { deck, metal, enamel, lens, lensLouvre } builders; c: cell; seed; nb(di, dj) -> neighbour cell
export function tallCeiling(G, c, seed, nb) {
  const x0 = c.i * CELL, z0 = c.j * CELL, x1 = x0 + CELL, z1 = z0 + CELL, y = c.ceil;
  const d = G.deck;
  d.ao = 1;
  d.wet = 0;
  d.rect([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, -1, 0], (x, yy, z) => [x * 0.5, z * 0.5]);
  // steel beams under the deck: a girder along x on the cell's N line (shared with the tall neighbour) and
  // lighter joists across every 1.5 m
  const m = G.metal;
  const n = nb(0, -1);
  const bh = 0.42, bw = 0.2;
  m.ao = 0.85;
  if (n && n.ceil > H + 0.5) ibeam(m, 'x', x0, x1, z0, y, bh, bw);
  for (const zz of [z0 + 0.75, z0 + 2.25]) m.box(x0, y - 0.16, zz - 0.04, x1, y, zz + 0.04, { py: true, px: true, nx: true });
  m.ao = 1;
}

// I-beam (flanges + web) hanging under y along axis 'x' (z = c) or 'z' (x = c), from a0 to a1
function ibeam(m, axis, a0, a1, c, y, h, w) {
  const tf = 0.03, tw = 0.016;
  const B = (u0, y0, w0, u1, y1, w1, skip) => (axis === 'x' ? m.box(u0, y0, w0, u1, y1, w1, skip) : m.box(w0, y0, u0, w1, y1, u1, swap(skip)));
  B(a0, y - tf, c - w / 2, a1, y, c + w / 2, { py: true, px: true, nx: true });
  B(a0, y - h, c - w / 2, a1, y - h + tf, c + w / 2, { px: true, nx: true });
  B(a0, y - h + tf, c - tw / 2, a1, y - tf, c + tw / 2, { px: true, nx: true, py: true, ny: true });
}
function swap(s) {
  const o = {};
  if (s.px) o.pz = true; if (s.nx) o.nz = true; if (s.pz) o.px = true; if (s.nz) o.nx = true; if (s.py) o.py = true; if (s.ny) o.ny = true;
  return o;
}

// pendant 2x4 troffer at the standard fixture height, hung from the deck on two threaded rods
export function pendantTroffer(G, c, seed, ceilY) {
  if (!c.light) return;
  const x0 = c.i * CELL, z0 = c.j * CELL;
  const alongX = !!c.lightRot;
  const a0 = alongX ? 1 : 2, a1 = alongX ? 3 : 3, b0 = alongX ? 2 : 1, b1 = alongX ? 3 : 3;
  const X0 = x0 + a0 * TILE, X1 = x0 + a1 * TILE, Z0 = z0 + b0 * TILE, Z1 = z0 + b1 * TILE;
  const office = c.zone === 'office' || c.lightTone === 1;
  const tg = office && G.lensLouvre ? { enamel: G.enamel, lens: G.lensLouvre } : G;
  troffer(tg, X0, Z0, X1, Z1, alongX, hash01(c.i, c.j, 73, seed));
  const en = G.enamel;
  const o = 0.012, top = H + 0.11;
  en.ao = 0.9;
  // housing: sides + lid (the troffer's frame ring closes the bottom)
  en.box(X0 - o, H - 0.006, Z0 - o, X1 + o, top, Z1 + o, { ny: true }, 0.6);
  en.ao = 1;
  // rods (+ a junction box on the deck)
  const m = G.metal;
  m.ao = 0.9;
  const cxm = (X0 + X1) / 2, czm = (Z0 + Z1) / 2;
  const rods = alongX ? [[X0 + 0.15, czm], [X1 - 0.15, czm]] : [[cxm, Z0 + 0.15], [cxm, Z1 - 0.15]];
  for (const [rx, rz] of rods) m.tube('y', top, ceilY, rx, rz, 0.006, 6);
  m.box(cxm - 0.06, ceilY - 0.06, czm - 0.06, cxm + 0.06, ceilY, czm + 0.06, { py: true });
  // the feed cable, slack, from the junction box to the housing
  const pts = [];
  for (let k = 0; k <= 6; k++) {
    const t = k / 6;
    pts.push([cxm + 0.05 + Math.sin(t * 3.1) * 0.05, ceilY - 0.06 - t * (ceilY - 0.06 - top), czm + 0.04]);
  }
  m.tubePath(pts, 0.005, 5);
  m.ao = 1;
}

// suspended acoustic ceiling at a lower height: built at the standard height, then shifted down
const CEIL_KEYS = ['ceil', 'enamel', 'lens', 'lensLouvre', 'plenum'];
export function lowCeiling(G, baker, c, seed) {
  const v0 = {};
  for (const k of CEIL_KEYS) if (G[k]) v0[k] = G[k].vc;
  // no tiles on the floor from a crawlspace's ceiling (debris builder is untouched by the shift)
  ceilingCell(G, baker, c, seed);
  const dy = c.ceil - H;
  for (const k of CEIL_KEYS) if (G[k]) G[k].shiftY(v0[k], dy);
}

// --- ceiling steps ---------------------------------------------------------------------------------------------
// parts of [lo, hi] (height) x [0, CELL] (along the edge) not covered by the edge's wall pieces:
// returns [[s0, s1, y0, y1, onSolid]] (onSolid: the bottom rests on a wall piece top)
export function uncovered(type, lo, hi) {
  const pieces = type ? wallPieces(type, CELL) : [];
  const xs = new Set([0, CELL]);
  for (const p of pieces) { xs.add(p[0]); xs.add(p[1]); }
  const S = [...xs].sort((a, b) => a - b);
  const out = [];
  for (let k = 0; k < S.length - 1; k++) {
    const a = S[k], b = S[k + 1];
    if (b - a < 1e-4) continue;
    const m = (a + b) / 2;
    const cov = pieces.filter((p) => p[0] <= m && p[1] >= m).map((p) => [p[2], p[3]]).sort((p, q) => p[0] - q[0]);
    let y = lo;
    const add = (y0, y1, onSolid) => {
      if (y1 - y0 < 1e-3) return;
      const last = out[out.length - 1];
      // merge with the previous span when it continues it exactly
      if (last && Math.abs(last[1] - a) < 1e-6 && Math.abs(last[2] - y0) < 1e-6 && Math.abs(last[3] - y1) < 1e-6 && last[4] === onSolid) last[1] = b;
      else out.push([a, b, y0, y1, onSolid]);
    };
    let onSolid = cov.some((iv) => Math.abs(iv[1] - lo) < 1e-6);
    for (const [c0, c1] of cov) {
      if (c1 <= y) continue;
      if (c0 > y) add(y, Math.min(c0, hi), onSolid);
      y = Math.max(y, c1);
      onSolid = true;
      if (y >= hi) break;
    }
    if (y < hi) add(y, hi, onSolid);
  }
  return out;
}

// edge between cell A (west / north) and cell B; axis 'x' = N edge of B (plane z), 'z' = W edge of B (plane x)
// gWall(style) -> builder; colliders: [{min, max}]
export function ceilingStep(gWall, colliders, i, j, axis, type, A, B, styleOf) {
  const ca = A.ceil, cb = B.ceil;
  if (Math.abs(ca - cb) < 1e-3) return;
  const lo = Math.min(ca, cb), hi = Math.max(ca, cb);
  // the taller cell sees the step; side +1 faces B
  const side = cb > ca ? 1 : -1;
  const tallCell = side > 0 ? B : A;
  const g = gWall(styleOf(tallCell));
  const start = axis === 'x' ? i * CELL : j * CELL;
  const plane = axis === 'x' ? j * CELL : i * CELL;
  const f = plane + side * T / 2;
  g.ao = 1;
  g.wet = 0;
  for (const [s0, s1, y0, y1, onSolid] of uncovered(type, lo, hi)) {
    // reach into the wall corners like the wall faces do (no gaps at the cell corners)
    const A0 = start + (s0 === 0 ? -T / 2 : s0), A1 = start + (s1 === CELL ? CELL + T / 2 : s1);
    const n = axis === 'x' ? [0, 0, side] : [side, 0, 0];
    if (axis === 'x') g.rectOriented([[A0, y0, f], [A1, y0, f], [A1, y1, f], [A0, y1, f]], n, (x, y) => [x, y]);
    else g.rectOriented([[f, y0, A0], [f, y0, A1], [f, y1, A1], [f, y1, A0]], n, (x, y, z) => [z, y]);
    if (!onSolid && y0 > 0.01) {
      // soffit under the step, from the plane to the face (the lower cell's ceiling covers the other half)
      g.ao = 0.85;
      const w0 = Math.min(plane, f), w1 = Math.max(plane, f);
      if (axis === 'x') g.rectOriented([[A0, y0, w0], [A1, y0, w0], [A1, y0, w1], [A0, y0, w1]], [0, -1, 0], (x, y, z) => [x, z]);
      else g.rectOriented([[w0, y0, A0], [w1, y0, A0], [w1, y0, A1], [w0, y0, A1]], [0, -1, 0], (x, y, z) => [z, x]);
      g.ao = 1;
    }
    if (axis === 'x') colliders.push({ min: { x: A0, y: y0, z: plane - T / 2 }, max: { x: A1, y: y1, z: plane + T / 2 } });
    else colliders.push({ min: { x: plane - T / 2, y: y0, z: A0 }, max: { x: plane + T / 2, y: y1, z: A1 } });
  }
}
