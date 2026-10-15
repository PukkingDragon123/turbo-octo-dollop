// Wall pieces for Level 0 edges: subdivided drywall faces (per-side surface style), profiled skirting
// boards that return around free ends, cased door openings (jamb liners, mitred casings, threshold
// strip), corner-beaded arches and half walls, capped low walls, window sills, and wall fixtures.
import { CELL, HEIGHT, W } from '../levels/yellow/layout.js';
import { hash01 } from '../../core/rng.js';
import * as Fx from './fixtures.js';

export const T = 0.16;
export const DOOR_W = 1.1, DOOR_H = 2.15;
export const ARCH_W = 2.0, ARCH_H = 2.45;
const H = HEIGHT;

// skirting profiles: [outward offset, height] bottom -> top
const SKIRT_WOOD = [[0.014, 0], [0.014, 0.074], [0.0075, 0.094], [0.0, 0.1]];
const SKIRT_RUBBER = [[0.0075, 0], [0.0035, 0.014], [0.0035, 0.097], [0.0, 0.1]];
const CASE_W = 0.068, CASE_D = 0.018;

// [s0, s1, y0, y1] solid pieces of an edge of type t and length len
export function wallPieces(t, len) {
  const out = [];
  switch (t) {
    case W.FULL: out.push([0, len, 0, H]); break;
    case W.DOOR: { const a = (len - DOOR_W) / 2; out.push([0, a, 0, H], [a + DOOR_W, len, 0, H], [a, a + DOOR_W, DOOR_H, H]); break; }
    case W.ARCH: { const a = (len - ARCH_W) / 2; out.push([0, a, 0, H], [a + ARCH_W, len, 0, H], [a, a + ARCH_W, ARCH_H, H]); break; }
    case W.HALF_A: out.push([0, len * 0.5, 0, H]); break;
    case W.HALF_B: out.push([len * 0.5, len, 0, H]); break;
    case W.LOW: out.push([0, len, 0, 1.05]); break;
    case W.WINDOW: out.push([0, len, 0, 0.9], [0, len, 2.1, H], [0, 0.4, 0.9, 2.1], [len - 0.4, len, 0.9, 2.1]); break;
    default: break;
  }
  return out;
}

// face subdivision: a column near each end (corner AO gradient) and roughly every 1.4 m between
function columns(a, b, near = 0.2, step = 1.4) {
  const L = b - a;
  if (L < near * 3) return [a, b];
  const out = [a, a + near];
  const inner0 = a + near, inner1 = b - near;
  const n = Math.max(0, Math.ceil((inner1 - inner0) / step) - 1);
  for (let k = 1; k <= n; k++) out.push(inner0 + ((inner1 - inner0) * k) / (n + 1));
  out.push(b - near, b);
  return out;
}
function rows(y0, y1) {
  const out = [y0];
  for (const y of [1.2, 2.3]) if (y > y0 + 0.1 && y < y1 - 0.1) out.push(y);
  out.push(y1);
  return out;
}

// ctx: { G: {wall, manila, cmu, pool, trim, rubber, metal, fixture}, styleOf(i,j) -> style,
//        wetOf(i,j) -> 0..1, colliders: [], seed, fixtures: bool }
// emits the wall on the N edge (axis 'x', z = z0) or W edge (axis 'z', x = x0) of global cell (i, j)
export function emitWallEdge(ctx, i, j, axis, type) {
  const len = CELL;
  const x0 = i * CELL, z0 = j * CELL;
  const start = axis === 'x' ? x0 : z0;
  const plane = axis === 'x' ? z0 : x0;
  // side +1 faces cell (i, j); side -1 faces the neighbour (i, j-1) or (i-1, j)
  const cellP = [i, j], cellN = axis === 'x' ? [i, j - 1] : [i - 1, j];
  const styleP = ctx.styleOf(cellP[0], cellP[1]), styleN = ctx.styleOf(cellN[0], cellN[1]);
  const wetP = ctx.wetOf(cellP[0], cellP[1]), wetN = ctx.wetOf(cellN[0], cellN[1]);
  const pieces = wallPieces(type, len);
  const h = (k) => hash01(i * 2 + (axis === 'x' ? 0 : 1), j, 300 + k, ctx.seed);
  for (const [s0, s1, y0, y1] of pieces) {
    if (s1 - s0 < 0.01) continue;
    const e0 = s0 === 0 ? -T / 2 : s0;
    const e1 = s1 === len ? len + T / 2 : s1;
    const A = start + e0, B = start + e1;
    // collider (unchanged from the original layout semantics)
    if (axis === 'x') ctx.colliders.push({ min: { x: A, y: y0, z: plane - T / 2 }, max: { x: B, y: y1, z: plane + T / 2 } });
    else ctx.colliders.push({ min: { x: plane - T / 2, y: y0, z: A }, max: { x: plane + T / 2, y: y1, z: B } });
    const cs = columns(A, B), rs = rows(y0, y1);
    for (const side of [1, -1]) {
      const style = side > 0 ? styleP : styleN;
      const g = ctx.G[style] || ctx.G.wall;
      g.wet = side > 0 ? wetP : wetN;
      g.ao = 1;
      face(g, axis, plane + side * T / 2, side, cs, rs);
      // skirting along this face (extended only where the wall continues into a corner)
      if (y0 === 0) skirt(ctx, style, axis, plane + side * T / 2, side, A, B, s0 === 0, s1 === len);
    }
    // end faces (jambs / free ends), top (low walls), bottom (soffits)
    const gEnd = ctx.G[styleP] || ctx.G.wall;
    gEnd.wet = Math.max(wetP, wetN);
    endFaces(gEnd, axis, plane, A, B, y0, y1);
    if (y1 < H - 0.001) {
      if (type === W.LOW) capRail(ctx, axis, plane, A, B, y1);
      else topFace(gEnd, axis, plane, A, B, y1);
    }
    if (y0 > 0.001) bottomFace(gEnd, axis, plane, A, B, y0);
    // skirting returns around free ends + corner beads on exposed vertical edges
    if (y0 === 0) {
      const freeStart = s0 > 0, freeEnd = s1 < len;
      if (freeStart || type === W.HALF_B) skirtReturn(ctx, styleP, styleN, axis, plane, A, -1);
      if (freeEnd || type === W.HALF_A) skirtReturn(ctx, styleP, styleN, axis, plane, B, 1);
      if (type !== W.DOOR) {
        if (freeStart || type === W.HALF_B) bead(ctx, styleP, styleN, axis, plane, A, 0, y1);
        if (freeEnd || type === W.HALF_A) bead(ctx, styleP, styleN, axis, plane, B, 0, y1);
      }
    }
    // fixtures on long, floor-standing faces
    if (ctx.fixtures && y0 === 0 && s1 - s0 > 1.0 && y1 > 2) {
      for (const side of [1, -1]) {
        const style = side > 0 ? styleP : styleN;
        const fr = { axis, plane: plane + side * T / 2 + (style === 'concrete' ? 0 : 0), side };
        const r = h(side > 0 ? 1 : 2);
        const span = B - A;
        if (style === 'concrete' && h(side > 0 ? 31 : 32) < 0.45) conduit(ctx, fr, A, B, h(side > 0 ? 33 : 34));
        if (style !== 'pool') {
          if (r < 0.3) Fx.outlet(ctx.G.fixture, fr, A + 0.35 + h(side > 0 ? 3 : 4) * (span - 0.7), 0.3);
          else if (r < 0.34 && style !== 'concrete') Fx.thermostat(ctx.G.fixture, fr, A + 0.4 + h(5) * (span - 0.8), 1.5);
          else if (r < 0.39) Fx.grille(ctx.G.fixture, fr, A + 0.5 + h(6) * (span - 1.0), 2.55);
          else if (r < 0.43 && style === 'concrete') Fx.junctionBox(ctx.G.fixture, fr, A + 0.3 + h(7) * (span - 0.6), 1.4 + h(8) * 0.8);
        }
      }
    }
  }
  if (type === W.DOOR) doorway(ctx, axis, plane, start + (len - DOOR_W) / 2, h, styleP, styleN);
  if (type === W.ARCH) archway(ctx, axis, plane, start + (len - ARCH_W) / 2, h, styleP, styleN);
  if (type === W.WINDOW) windowSill(ctx, axis, plane, start + 0.4, start + len - 0.4);
}

// EMT conduit along a block wall under the ceiling: tube on spacer straps, a drop to a junction box
function conduit(ctx, fr, A, B, h) {
  const m = ctx.G.metal;
  const r = 0.011, off = 0.022, y = 2.42 + h * 0.2;
  const w = fr.plane + fr.side * off;
  const u0 = A + 0.12, u1 = B - 0.12;
  m.ao = 0.95;
  if (fr.axis === 'x') m.tube('x', u0, u1, y, w, r, 8); else m.tube('z', u0, u1, w, y, r, 8);
  // one-hole straps
  for (let u = u0 + 0.3; u < u1 - 0.1; u += 0.9) {
    const a = fr.plane, b = fr.plane + fr.side * (off + r + 0.004);
    if (fr.axis === 'x') m.box(u - 0.012, y - r - 0.004, Math.min(a, b), u + 0.012, y + r + 0.004, Math.max(a, b), { [fr.side > 0 ? 'nz' : 'pz']: true });
    else m.box(Math.min(a, b), y - r - 0.004, u - 0.012, Math.max(a, b), y + r + 0.004, u + 0.012, { [fr.side > 0 ? 'nx' : 'px']: true });
  }
  // vertical drop to a box
  if (h < 0.6) {
    const ud = u0 + 0.3 + h * (u1 - u0 - 0.6) / 0.6;
    const yb = 1.32 + h * 0.3;
    if (fr.axis === 'x') m.tube('y', yb + 0.06, y, ud, w, r, 8); else m.tube('y', yb + 0.06, y, w, ud, r, 8);
    Fx.junctionBox(ctx.G.fixture, fr, ud, yb);
  }
  m.ao = 1;
}

// subdivided planar face of a wall at plane coordinate p, facing `side`
function face(g, axis, p, side, cs, rs) {
  const n = axis === 'x' ? [0, 0, side] : [side, 0, 0];
  const us = cs.map((c) => (c - cs[0]) / (cs[cs.length - 1] - cs[0]));
  const vs = rs.map((r) => (r - rs[0]) / (rs[rs.length - 1] - rs[0]));
  const L = cs[cs.length - 1] - cs[0], Hh = rs[rs.length - 1] - rs[0];
  if (axis === 'x') g.grid([cs[0], rs[0], p], [L, 0, 0], [0, Hh, 0], n, us, vs, (x, y) => [x, y]);
  else g.grid([p, rs[0], cs[0]], [0, 0, L], [0, Hh, 0], n, us, vs, (x, y, z) => [z, y]);
}

function endFaces(g, axis, plane, A, B, y0, y1) {
  const z0 = plane - T / 2, z1 = plane + T / 2;
  if (axis === 'x') {
    g.rectOriented([[A, y0, z0], [A, y0, z1], [A, y1, z1], [A, y1, z0]], [-1, 0, 0], (x, y, z) => [z, y]);
    g.rectOriented([[B, y0, z0], [B, y0, z1], [B, y1, z1], [B, y1, z0]], [1, 0, 0], (x, y, z) => [z, y]);
  } else {
    g.rectOriented([[z0, y0, A], [z1, y0, A], [z1, y1, A], [z0, y1, A]], [0, 0, -1], (x, y) => [x, y]);
    g.rectOriented([[z0, y0, B], [z1, y0, B], [z1, y1, B], [z0, y1, B]], [0, 0, 1], (x, y) => [x, y]);
  }
}
function topFace(g, axis, plane, A, B, y) {
  const a = plane - T / 2, b = plane + T / 2;
  if (axis === 'x') g.rectOriented([[A, y, a], [B, y, a], [B, y, b], [A, y, b]], [0, 1, 0], (x, yy, z) => [x, z]);
  else g.rectOriented([[a, y, A], [b, y, A], [b, y, B], [a, y, B]], [0, 1, 0], (x, yy, z) => [z, x]);
}
function bottomFace(g, axis, plane, A, B, y) {
  const a = plane - T / 2, b = plane + T / 2;
  g.ao = 0.85;
  if (axis === 'x') g.rectOriented([[A, y, a], [B, y, a], [B, y, b], [A, y, b]], [0, -1, 0], (x, yy, z) => [x, z]);
  else g.rectOriented([[a, y, A], [b, y, A], [b, y, B], [a, y, B]], [0, -1, 0], (x, yy, z) => [z, x]);
  g.ao = 1;
}

function skirtFor(ctx, style) {
  if (style === 'pool') return null;
  if (style === 'concrete') return { g: ctx.G.rubber, prof: SKIRT_RUBBER };
  return { g: ctx.G.trim, prof: SKIRT_WOOD };
}

function skirt(ctx, style, axis, p, side, A, B, extA = true, extB = true) {
  const s = skirtFor(ctx, style);
  if (!s) return;
  s.g.ao = 1;
  const ext = s.prof[0][0];
  s.g.extrude(s.prof, axis, p, side, A - (extA ? ext : 0), B + (extB ? ext : 0), [!extA, !extB]);
}

// skirting wrapping around a free wall end (dir -1: end at A facing -axis, +1: at B facing +axis)
function skirtReturn(ctx, styleP, styleN, axis, plane, at, dir) {
  const s = skirtFor(ctx, styleP) || skirtFor(ctx, styleN);
  if (!s) return;
  const ext = s.prof[0][0];
  const zA = plane - T / 2 - ext, zB = plane + T / 2 + ext;
  // the end face lies in the plane (axis coord = at); the skirting runs across the wall thickness
  s.g.extrude(s.prof, axis === 'x' ? 'z' : 'x', at, dir, zA, zB, [true, true]);
}

// rounded corner bead on an exposed vertical wall edge (both faces): three narrow strips (proud face,
// 45 degree roll, proud return) that catch the light like a real metal bead under paper
function bead(ctx, styleP, styleN, axis, plane, at, y0, y1) {
  const yb = y0 + 0.1, yt = y1 - 0.001;
  for (const side of [1, -1]) {
    const style = side > 0 ? styleP : styleN;
    const g = ctx.G[style] || ctx.G.wall;
    g.ao = 1;
    const f = plane + side * T / 2;          // face plane
    // the edge sits at axis coordinate `at`; which way is "outside the wall end" is unknown here,
    // so the bead is symmetric around the edge: proud strips on the face, roll across the edge
    const w = 0.011, pr = 0.0018, s2 = Math.SQRT1_2;
    if (axis === 'x') {
      const z1 = f + side * pr;
      g.rectOriented([[at - w, yb, z1], [at + w, yb, z1], [at + w, yt, z1], [at - w, yt, z1]], [0, 0, side], (x, y) => [x, y]);
      g.rectOriented([[at - w - 0.004, yb, f], [at - w, yb, z1], [at - w, yt, z1], [at - w - 0.004, yt, f]], [-s2, 0, side * s2], (x, y) => [x, y]);
      g.rectOriented([[at + w + 0.004, yb, f], [at + w, yb, z1], [at + w, yt, z1], [at + w + 0.004, yt, f]], [s2, 0, side * s2], (x, y) => [x, y]);
    } else {
      const x1 = f + side * pr;
      g.rectOriented([[x1, yb, at - w], [x1, yb, at + w], [x1, yt, at + w], [x1, yt, at - w]], [side, 0, 0], (x, y, z) => [z, y]);
      g.rectOriented([[f, yb, at - w - 0.004], [x1, yb, at - w], [x1, yt, at - w], [f, yt, at - w - 0.004]], [side * s2, 0, -s2], (x, y, z) => [z, y]);
      g.rectOriented([[f, yb, at + w + 0.004], [x1, yb, at + w], [x1, yt, at + w], [f, yt, at + w + 0.004]], [side * s2, 0, s2], (x, y, z) => [z, y]);
    }
  }
}

function capRail(ctx, axis, plane, A, B, y) {
  const g = ctx.G.trim;
  g.ao = 1;
  const o = 0.022;
  if (axis === 'x') g.chamferBox(A - 0.004, y, plane - T / 2 - o, B + 0.004, y + 0.038, plane + T / 2 + o, 0.01, 'py', { ny: true }, (x, yy, z) => [x, z]);
  else g.chamferBox(plane - T / 2 - o, y, A - 0.004, plane + T / 2 + o, y + 0.038, B + 0.004, 0.01, 'py', { ny: true }, (x, yy, z) => [z, x]);
}

// cased door opening: jamb liners, casings on both faces, threshold, switch / exit sign / pull station
function doorway(ctx, axis, plane, a, h, styleP, styleN) {
  const g = ctx.G.trim;
  const b = a + DOOR_W, top = DOOR_H;
  const lz0 = plane - T / 2 - 0.004, lz1 = plane + T / 2 + 0.004, lt = 0.016;
  // horizontal pieces get the grain along the wall, vertical pieces along y.
  // front: outward axis of the visible face ('x' walls: +/-z, 'z' walls: +/-x); null = plain box
  const box = (u0, y0, w0, u1, y1, w1, bev, frontSide, skip = {}) => {
    const horiz = (u1 - u0) > (y1 - y0);
    const uvx = horiz ? (x, y, z) => [x, y + z] : (x, y, z) => [y, x + z];
    const uvz = horiz ? (x, y, z) => [z, y + x] : (x, y, z) => [y, z + x];
    if (axis === 'x') {
      if (frontSide) g.chamferBox(u0, y0, w0, u1, y1, w1, bev, frontSide > 0 ? 'pz' : 'nz', skip, uvx);
      else g.box(u0, y0, w0, u1, y1, w1, skip, 0, uvx);
    } else {
      const sk = swapSkip(skip);
      if (frontSide) g.chamferBox(w0, y0, u0, w1, y1, u1, bev, frontSide > 0 ? 'px' : 'nx', sk, uvz);
      else g.box(w0, y0, u0, w1, y1, u1, sk, 0, uvz);
    }
  };
  g.ao = 0.9;
  box(a, 0, lz0, a + lt, top, lz1, 0, 0, { ny: true, nx: true, py: true });              // jamb liners
  box(b - lt, 0, lz0, b, top, lz1, 0, 0, { ny: true, px: true, py: true });
  box(a, top - lt, lz0, b, top, lz1, 0, 0, { py: true, nx: true, px: true });            // head liner
  g.ao = 1;
  for (const side of [1, -1]) {
    const f0 = plane + side * T / 2, f1 = f0 + side * CASE_D;
    const w0 = Math.min(f0, f1), w1 = Math.max(f0, f1);
    const back = side > 0 ? { nz: true } : { pz: true };
    box(a - CASE_W + 0.004, 0, w0, a + 0.004, top + CASE_W - 0.004, w1, 0.006, side, { ny: true, ...back });
    box(b - 0.004, 0, w0, b + CASE_W - 0.004, top + CASE_W - 0.004, w1, 0.006, side, { ny: true, ...back });
    box(a - CASE_W + 0.004, top - 0.004, w0, b + CASE_W - 0.004, top + CASE_W - 0.004, w1, 0.006, side, back);
    // plinth blocks at the casing feet
    const pw0 = Math.min(f0, f0 + side * (CASE_D + 0.006)), pw1 = Math.max(f0, f0 + side * (CASE_D + 0.006));
    box(a - CASE_W, 0, pw0, a + 0.008, 0.13, pw1, 0.005, side, { ny: true, ...back });
    box(b - 0.008, 0, pw0, b + CASE_W, 0.13, pw1, 0.005, side, { ny: true, ...back });
  }
  // threshold strip (aluminium)
  const m = ctx.G.metal;
  m.ao = 1;
  if (axis === 'x') m.chamferBox(a + lt, 0, plane - 0.055, b - lt, 0.005, plane + 0.055, 0.004, 'py', { ny: true }, (x, y, z) => [x * 4, z * 4]);
  else m.chamferBox(plane - 0.055, 0, a + lt, plane + 0.055, 0.005, b - lt, 0.004, 'py', { ny: true }, (x, y, z) => [z * 4, x * 4]);
  if (!ctx.fixtures) return;
  // light switch on the latch side, sometimes an exit sign over the door, rarely a pull station
  for (const side of [1, -1]) {
    const style = side > 0 ? styleP : styleN;
    if (style === 'pool') continue;
    const fr = { axis, plane: plane + side * T / 2, side };
    const r = h(side > 0 ? 11 : 12);
    if (r < 0.55) Fx.lightSwitch(ctx.G.fixture, fr, side > 0 ? b + CASE_W + 0.12 : a - CASE_W - 0.12, 1.2);
    else if (r < 0.62) Fx.pullStation(ctx.G.fixture, fr, side > 0 ? a - CASE_W - 0.16 : b + CASE_W + 0.16, 1.22);
    if (h(side > 0 ? 13 : 14) < 0.22) Fx.exitSign(ctx.G.fixture, fr, (a + b) / 2, top + CASE_W + 0.19);
  }
}

function archway(ctx, axis, plane, a, h, styleP, styleN) {
  if (!ctx.fixtures) return;
  for (const side of [1, -1]) {
    const style = side > 0 ? styleP : styleN;
    if (style === 'pool') continue;
    const fr = { axis, plane: plane + side * T / 2, side };
    if (h(side > 0 ? 21 : 22) < 0.16) Fx.exitSign(ctx.G.fixture, fr, a + ARCH_W / 2, ARCH_H + 0.16);
  }
}

function windowSill(ctx, axis, plane, A, B) {
  const g = ctx.G.trim;
  const o = 0.03;
  if (axis === 'x') g.chamferBox(A - 0.03, 0.9, plane - T / 2 - o, B + 0.03, 0.93, plane + T / 2 + o, 0.008, 'py', {}, (x, y, z) => [x, z]);
  else g.chamferBox(plane - T / 2 - o, 0.9, A - 0.03, plane + T / 2 + o, 0.93, B + 0.03, 0.008, 'py', {}, (x, y, z) => [z, x]);
}

function swapSkip(s) {
  const o = {};
  if (s.px) o.pz = true; if (s.nx) o.nz = true; if (s.pz) o.px = true; if (s.nz) o.nx = true; if (s.py) o.py = true; if (s.ny) o.ny = true;
  return o;
}

// square pillar at a cell corner: corner-beaded column with skirting all around (height: up to the highest
// ceiling around the corner in tall sectors)
export function pillar(ctx, px, pz, size, height = H) {
  const g = ctx.G.wall;
  const hs = size / 2;
  g.wet = 0; g.ao = 1;
  g.bevelBox(px - hs, 0, pz - hs, px + hs, height, pz + hs, 0.012, { py: true, ny: true }, (x, y, z) => [x + z, y]);
  ctx.colliders.push({ min: { x: px - hs, y: 0, z: pz - hs }, max: { x: px + hs, y: height, z: pz + hs } });
  const s = skirtFor(ctx, 'wall');
  const ext = s.prof[0][0];
  s.g.extrude(s.prof, 'x', pz + hs, 1, px - hs - ext, px + hs + ext, [true, true]);
  s.g.extrude(s.prof, 'x', pz - hs, -1, px - hs - ext, px + hs + ext, [true, true]);
  s.g.extrude(s.prof, 'z', px + hs, 1, pz - hs, pz + hs, [false, false]);
  s.g.extrude(s.prof, 'z', px - hs, -1, pz - hs, pz + hs, [false, false]);
}
