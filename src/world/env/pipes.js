// Exposed service pipes for Level 0 maintenance sectors: a rack of painted / insulated pipes under the
// ceiling along a cell, hung from threaded rods on strut channel, with flanged joints, a gate valve with a
// hand wheel, escutcheons where a pipe enters a wall and elbows up into the plenum where it does not.
import { CELL, HEIGHT } from '../levels/yellow/layout.js';

const H = HEIGHT;

// G: { pipe, insul, metal } builders; solidW / solidE: is there a wall on the cell's west / east edge
// along: 'x' (pipes run along x near the north side) or 'z' (along z near the west side)
export function pipeRun(G, i, j, h, solidA, solidB, along = 'x') {
  const x0 = i * CELL, z0 = j * CELL;
  const S = along === 'x' ? x0 : z0;          // run start coordinate
  const C = along === 'x' ? z0 : x0;          // cross coordinate base
  const P = (s, y, c) => (along === 'x' ? [s, y, c] : [c, y, s]);
  const pipes = [
    { r: 0.045, y: H - 0.17, c: 0.2, g: 'pipe' },
    { r: 0.098, y: H - 0.27, c: 0.42, g: 'insul' },
    { r: 0.06, y: H - 0.2, c: 0.68, g: 'pipe' },
  ];
  if (h > 0.6) pipes.pop();
  const a0 = solidA ? S + 0.08 : S + 0.32, a1 = solidB ? S + CELL - 0.08 : S + CELL - 0.32;
  for (let k = 0; k < pipes.length; k++) {
    const p = pipes[k];
    const g = G[p.g];
    const c = C + p.c;
    g.ao = 1;
    // straight run (cylinders along the run axis)
    const sA = solidA ? a0 : a0 + 0.0, sB = solidB ? a1 : a1;
    tube(g, along, sA, sB, p.y, c, p.r, 14);
    // ends: into the wall (escutcheon) or up into the plenum (elbow + riser)
    for (const [end, solid, dir] of [[sA, solidA, -1], [sB, solidB, 1]]) {
      if (solid) {
        const m = G.metal;
        ring(m, along, end + (dir < 0 ? 0.004 : -0.004), p.y, c, p.r * 1.0, p.r + 0.035, dir);
      } else {
        const R = Math.max(p.r * 1.6, 0.08);
        const cc = P(end, p.y + R, c);
        const d0 = along === 'x' ? [dir, 0, 0] : [0, 0, dir];
        g.elbow(cc, d0, [0, 1, 0], R, p.r, 14, 6);
        // riser up to the ceiling
        const rx = along === 'x' ? end + dir * R : c, rz = along === 'x' ? c : end + dir * R;
        g.tube('y', p.y + R, H + 0.05, rx, rz, p.r, 14);
      }
    }
    // flanged joints
    const jn = 1 + Math.floor((h * 7 + k) % 2);
    for (let q = 1; q <= jn; q++) {
      const s = sA + ((sB - sA) * q) / (jn + 1);
      const fg = p.g === 'insul' ? G.metal : G.pipe;
      flange(fg, along, s, p.y, c, (p.g === 'insul' ? p.r + 0.006 : p.r * 1.45), 0.035);
    }
  }
  // gate valve with hand wheel on the first painted pipe
  if (h < 0.7) {
    const p = pipes[pipes.length > 2 ? 2 : 0];
    const s = S + CELL * (0.3 + h * 0.4), c = C + p.c;
    const g = G.pipe;
    flange(g, along, s - 0.09, p.y, c, p.r * 1.5, 0.03);
    flange(g, along, s + 0.09, p.y, c, p.r * 1.5, 0.03);
    tube(g, along, s - 0.075, s + 0.075, p.y, c, p.r * 1.35, 14);
    const yb = p.y - p.r * 1.2;               // bonnet down (valve hangs under the pipe)
    const [bx, , bz] = P(s, 0, c);
    g.tube('y', yb - 0.12, yb + 0.02, bx, bz, p.r * 0.75, 12, [true, false]);
    G.metal.tube('y', yb - 0.2, yb - 0.11, bx, bz, 0.009, 8);
    wheel(G.metal, bx, yb - 0.2, bz, 0.085);
  }
  // hangers: strut channel across the rack on threaded rods
  const yMin = Math.min(...pipes.map((p) => p.y - p.r)) - 0.025;
  const c0 = C + 0.08, c1 = C + pipes[pipes.length - 1].c + 0.16;
  for (let q = 0; q < 3; q++) {
    const s = S + 0.55 + q * 0.95;
    if (s < a0 + 0.05 || s > a1 - 0.05) continue;
    const m = G.metal;
    m.ao = 1;
    const [ax0, , az0] = P(s - 0.021, 0, c0), [ax1, , az1] = P(s + 0.021, 0, c1);
    m.bevelBox(Math.min(ax0, ax1), yMin - 0.042, Math.min(az0, az1), Math.max(ax0, ax1), yMin, Math.max(az0, az1), 0.004, {}, (x, y, z) => [x + z, y]);
    for (const cc of [c0 + 0.03, c1 - 0.03]) {
      const [rx, , rz] = P(s, 0, cc);
      m.tube('y', yMin - 0.06, H + 0.02, rx, rz, 0.0065, 6, [true, false]);
    }
    // U-bolt straps over each pipe
    for (const p of pipes) {
      const [ux, , uz] = P(s, 0, C + p.c);
      const d0 = along === 'x' ? [0, 0, 1] : [1, 0, 0];
      const R = p.r + 0.006;
      m.elbow([ux, p.y, uz], [0, 1, 0], d0, R, 0.004, 6, 4);
      m.elbow([ux, p.y, uz], d0, [0, -1, 0], R, 0.004, 6, 4);
    }
  }
}

function tube(g, along, s0, s1, y, c, r, seg) {
  if (along === 'x') g.tube('x', s0, s1, y, c, r, seg);
  else g.tube('z', s0, s1, c, y, r, seg);
}

function flange(g, along, s, y, c, r, w) {
  if (along === 'x') g.tube('x', s - w / 2, s + w / 2, y, c, r, 16, [true, true]);
  else g.tube('z', s - w / 2, s + w / 2, c, y, r, 16, [true, true]);
}

// flat ring (escutcheon) facing along the run axis
function ring(g, along, s, y, c, r0, r1, dir) {
  const seg = 16;
  g.autoCell(along === 'x' ? s : c, along === 'x' ? c : s, 0, 0);
  const base = g.vc, t0 = g.I.n;
  for (let k = 0; k <= seg; k++) {
    const a = (k / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    for (const r of [r0, r1]) {
      const p = along === 'x' ? [s, y + ca * r, c + sa * r] : [c + sa * r, y + ca * r, s];
      const n = along === 'x' ? [dir, 0, 0] : [0, 0, dir];
      g.v(p[0], p[1], p[2], n[0], n[1], n[2], ca * r, sa * r);
    }
  }
  for (let k = 0; k < seg; k++) { const a = base + k * 2; g.tri(a, a + 2, a + 3); g.tri(a, a + 3, a + 1); }
  g._fixWinding(t0);
}

// valve hand wheel: torus rim (4 quarter elbows) + 3 spokes, horizontal under the bonnet
function wheel(g, x, y, z, R) {
  const r = 0.008;
  const dirs = [[1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1]];
  for (let k = 0; k < 4; k++) g.elbow([x, y, z], dirs[(k + 1) % 4], dirs[k], R, r, 6, 5);
  // two crossed spokes
  g.bevelBox(x - R, y - 0.005, z - 0.005, x + R, y + 0.005, z + 0.005, 0.002, {}, (px, py, pz) => [px, pz]);
  g.bevelBox(x - 0.005, y - 0.005, z - R, x + 0.005, y + 0.005, z + R, 0.002, {}, (px, py, pz) => [px, pz]);
  g.tube('y', y - 0.012, y + 0.012, x, z, 0.018, 10, [true, true]);
}
