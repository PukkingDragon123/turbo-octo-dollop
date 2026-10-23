// Level 0 macro structure, laid over the per-cell maze (pure data, deterministic from (seed, global cell)):
//  SPINES   endless corridors along x (rows) or z (columns): 1 cell wide, solid side walls with doorways at a
//           rhythm, lights in a regular beat (streaks of dead tubes), dead ends, crossroads where two meet.
//           Styles: plain | rhythm (every other light) | low (2.45 m soffit) | vault (6.2 m slot) |
//           narrow (a 1.1 m squeeze between thick walls) | doors (a door across the corridor every 4 cells)
//  HALLS    sudden huge empty halls (6..11 x 5..9 cells) in a 20-cell macro grid: open floor, a few openings
//           in the perimeter. Styles: empty (a lone door wall standing in the middle) | pillared | tall | dark
//  FAILING  noise sectors where the fixtures are dying: dead tubes, flicker, a sick green cast
// Every chunk evaluates the same functions on global cells, so features cross chunk borders seamlessly.
// Nothing here touches the calm ring around the arrival complex (see layout.js zoneAt).
import { hash01, valueNoise2 } from '../../../core/rng.js';

// wall codes (same values as layout.js W)
const NONE = 0, FULL = 1, DOOR = 2, ARCH = 3;
export const LOW_CEIL = 2.45;

const PX = 11, PZ = 13;      // spine spacing (rows / columns)
const SEG = 22;              // spine segment length (cells)
const MH = 20;               // hall macro grid (cells)
const mod = (a, n) => ((a % n) + n) % n;

// the arrival complex + its calm ring (layout.js keeps i -3..17, j -4..12 as plain halls) and a margin
export function inRing(i, j) { return i >= -6 && i <= 20 && j >= -7 && j <= 15; }

const SPINE_STYLES = [['plain', 0.36], ['rhythm', 0.22], ['low', 0.13], ['vault', 0.1], ['narrow', 0.13], ['doors', 0.1]];
function pickStyle(h) {
  let t = 0;
  for (const [s, w] of SPINE_STYLES) { t += w; if (h < t) return s; }
  return 'plain';
}

// --- halls -----------------------------------------------------------------------------------------------------
const _hallCache = new Map();
let _hallSeed = null;
function hallRect(seed, I, J) {
  if (seed !== _hallSeed) { _hallCache.clear(); _hallSeed = seed; }
  const key = (I + 32768) * 65536 + (J + 32768);
  let r = _hallCache.get(key);
  if (r !== undefined) return r;
  r = null;
  const h = hash01(I, J, 9101, seed);
  if (h < 0.34) {
    const w = 6 + Math.floor(hash01(I, J, 9102, seed) * 6), d = 5 + Math.floor(hash01(I, J, 9103, seed) * 5);
    const i0 = I * MH + 1 + Math.floor(hash01(I, J, 9104, seed) * (MH - 2 - w));
    const j0 = J * MH + 1 + Math.floor(hash01(I, J, 9105, seed) * (MH - 2 - d));
    const hs = hash01(I, J, 9106, seed);
    const style = hs < 0.34 ? 'empty' : hs < 0.6 ? 'pillared' : hs < 0.82 ? 'tall' : 'dark';
    r = { id: I * 7919 + J, i0, j0, i1: i0 + w - 1, j1: j0 + d - 1, style };
    // never over the arrival complex
    { let ok = true; for (let j = r.j0; j <= r.j1 && ok; j++) for (let i = r.i0; i <= r.i1; i++) if (inRing(i, j)) { ok = false; break; } if (!ok) r = null; }
  }
  if (_hallCache.size > 4000) _hallCache.clear();
  _hallCache.set(key, r);
  return r;
}
export function hallAt(seed, i, j) {
  const r = hallRect(seed, Math.floor(i / MH), Math.floor(j / MH));
  return r && i >= r.i0 && i <= r.i1 && j >= r.j0 && j <= r.j1 ? r : null;
}

// --- spines ----------------------------------------------------------------------------------------------------
function offs(seed) { return [Math.floor(hash01(3, 1, 9001, seed) * PX), Math.floor(hash01(5, 2, 9001, seed) * PZ)]; }
// segment of the spine on `line` (row for ax 0 = along x, column for ax 1) at coordinate u along it
function spineSeg(seed, ax, line, u) {
  const sh = Math.floor(hash01(line, ax, 9002, seed) * SEG);
  const s = Math.floor((u + sh) / SEG);
  const h = hash01(s, line, 9003 + ax, seed);
  if (h > 0.7) return null;
  const s0 = s * SEG - sh;
  const style = pickStyle(hash01(s, line, 9006 + ax, seed));
  const a = s0 + Math.floor(hash01(s, line, 9004 + ax, seed) * 4);
  let b = s0 + SEG - 1 - Math.floor(hash01(s, line, 9005 + ax, seed) * 4);
  if (style === 'narrow') b = Math.min(b, a + 2 + Math.floor(h * 4)); // squeezes are short
  if (u < a || u > b) return null;
  // service corridors: a rack of pipes under the ceiling all the way down
  const pipes = (style === 'plain' || style === 'rhythm' || style === 'doors') && hash01(s, line, 9007 + ax, seed) < 0.24;
  return { ax, line, seg: s * 2 + ax, a, b, k: u - a, style, pipes };
}
// corridor along x through cell (i, j), or null
export function spineX(seed, i, j) {
  const [ox] = offs(seed);
  if (mod(j - ox, PX) !== 0 || inRing(i, j) || hallAt(seed, i, j)) return null;
  return spineSeg(seed, 0, j, i);
}
// corridor along z through cell (i, j), or null
export function spineZ(seed, i, j) {
  const [, oz] = offs(seed);
  if (mod(i - oz, PZ) !== 0 || inRing(i, j) || hallAt(seed, i, j)) return null;
  return spineSeg(seed, 1, i, j);
}

// wall type of a spine's side wall at coordinate u (side -1: the N / W wall, +1: the S / E wall)
function sideType(seed, sp, u, side) {
  if (sp.style === 'narrow') return FULL;
  const h = hash01(u, sp.line * 2 + (side > 0 ? 1 : 0), 9010 + sp.ax, seed);
  const beat = (sp.k + Math.floor(hash01(sp.seg, side, 9011, seed) * 6)) % 6 === 0;
  if (h < 0.12 || (beat && h < 0.7)) {
    const h2 = hash01(u, sp.line, 9012 + sp.ax + (side > 0 ? 7 : 0), seed);
    return h2 < 0.5 ? DOOR : h2 < 0.78 ? ARCH : NONE;
  }
  return FULL;
}
// wall type closing a spine at its start (end 0) or end (end 1)
export function endType(seed, sp, end) {
  if (sp.style === 'narrow') return NONE;
  const h = hash01(sp.seg, sp.line, 9020 + end, seed);
  return h < 0.4 ? FULL : h < 0.56 ? DOOR : h < 0.72 ? ARCH : NONE;
}
// edge inside one corridor (between two of its cells); u = the coordinate of the later cell
function interiorType(sp, u) {
  if (sp.style === 'doors' && (u - sp.a) % 4 === 2) return DOOR;
  return NONE;
}

// --- hall edges ------------------------------------------------------------------------------------------------
function hallEdge(seed, hA, hB, sA, sB, i, j, axis) {
  if (hA && hB) {
    // a lone wall with a door in it, standing in the middle of an empty hall
    if (hA === hB && hA.style === 'empty' && hash01(i, j, 9030 + (axis === 'n' ? 0 : 1), seed) < 0.02) return DOOR;
    return NONE;
  }
  const h = hA || hB, out = hA ? sB : sA;
  // a corridor running into the hall opens into it
  if (out && out.ax === (axis === 'n' ? 1 : 0)) return hash01(i, j, 9031, seed) < 0.6 ? NONE : ARCH;
  // perimeter: mostly solid, a cased opening at the middle of every side and a few more
  const along = axis === 'n' ? i : j;
  const mid = axis === 'n' ? Math.floor((h.i0 + h.i1) / 2) : Math.floor((h.j0 + h.j1) / 2);
  const r = hash01(i, j, 9032 + (axis === 'n' ? 0 : 1), seed);
  if (along === mid || r < 0.2) {
    const r2 = hash01(i, j, 9033, seed);
    return r2 < 0.45 ? ARCH : r2 < 0.75 ? NONE : DOOR;
  }
  return FULL;
}

// Wall type the macro structure forces on the N edge ('n': between (i, j-1) and (i, j)) or the W edge ('w':
// between (i-1, j) and (i, j)) of global cell (i, j); -1 = leave it to the maze.
export function macroEdge(seed, i, j, axis) {
  const ai = axis === 'n' ? i : i - 1, aj = axis === 'n' ? j - 1 : j;
  if (inRing(ai, aj) && inRing(i, j)) return -1;
  const hA = hallAt(seed, ai, aj), hB = hallAt(seed, i, j);
  // the spine running across this edge (along its normal) and the one running beside it
  const across = axis === 'n' ? spineZ : spineX, beside = axis === 'n' ? spineX : spineZ;
  const cA = across(seed, ai, aj), cB = across(seed, i, j);
  if (hA || hB) return hallEdge(seed, hA, hB, cA, cB, i, j, axis);
  const u = axis === 'n' ? j : i;
  if (cA && cB && cA.seg === cB.seg) return interiorType(cB, u);
  const bA = beside(seed, ai, aj), bB = beside(seed, i, j);
  if (cA || cB) {
    // a corridor ends here: T-junction into a crossing corridor, else its end wall
    if ((cA && bB) || (cB && bA)) return NONE;
    return cA ? endType(seed, cA, 1) : endType(seed, cB, 0);
  }
  if (bA || bB) {
    const sp = bB || bA;
    return sideType(seed, sp, axis === 'n' ? i : j, bB ? -1 : 1);
  }
  return -1;
}

// failing-light sectors: 0 (healthy) .. 1 (nearly all tubes dead)
export function failAt(seed, i, j) {
  if (inRing(i, j)) return 0;
  const n = valueNoise2(i * 0.06 + 300, j * 0.06 - 200, 1414 + (seed % 911));
  return Math.max(0, Math.min(1, (n - 0.64) / 0.14));
}
