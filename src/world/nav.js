// Grid navigation over the 3 m cell lattice (A* with a node budget) + waypoint helpers.
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N E S W

export class GridNav {
  constructor(level, cell = 3) {
    this.level = level;
    this.cell = cell;
  }

  cellOf(x, z) { return [Math.floor(x / this.cell), Math.floor(z / this.cell)]; }
  center(i, j) { return [(i + 0.5) * this.cell, (j + 0.5) * this.cell]; }

  // returns array of [x, z] waypoints (cell centers) from start to goal, or null
  findPath(sx, sz, gx, gz, maxNodes = 1800) {
    const [si, sj] = this.cellOf(sx, sz);
    const [gi, gj] = this.cellOf(gx, gz);
    if (si === gi && sj === gj) return [[gx, gz]];
    const key = (i, j) => i * 100003 + j;
    const open = new MinHeap();
    const g = new Map();
    const came = new Map();
    const h = (i, j) => Math.abs(i - gi) + Math.abs(j - gj);
    g.set(key(si, sj), 0);
    open.push([si, sj], h(si, sj));
    let expanded = 0;
    let best = null, bestH = 1e9;
    while (open.size && expanded < maxNodes) {
      const [ci, cj] = open.pop();
      expanded++;
      const ck = key(ci, cj);
      const hh = h(ci, cj);
      if (hh < bestH) { bestH = hh; best = [ci, cj]; }
      if (ci === gi && cj === gj) { best = [ci, cj]; bestH = 0; break; }
      const cg = g.get(ck);
      for (let d = 0; d < 4; d++) {
        if (!this.level.passable(ci, cj, d)) continue;
        const ni = ci + DIRS[d][0], nj = cj + DIRS[d][1];
        const nk = key(ni, nj);
        const ng = cg + 1 + (this.level.cellCost?.(ni, nj) || 0);
        if (ng < (g.get(nk) ?? 1e9)) {
          g.set(nk, ng);
          came.set(nk, [ci, cj]);
          open.push([ni, nj], ng + h(ni, nj));
        }
      }
    }
    if (!best) return null;
    // reconstruct to best reached cell
    const cells = [];
    let cur = best;
    while (cur) {
      cells.push(cur);
      const k = key(cur[0], cur[1]);
      if (cur[0] === si && cur[1] === sj) break;
      cur = came.get(k);
    }
    cells.reverse();
    const pts = cells.slice(1).map(([i, j]) => this.center(i, j));
    if (bestH === 0) pts.push([gx, gz]);
    return pts.length ? pts : [[gx, gz]];
  }

  // random reachable point a few cells away
  randomNear(x, z, steps, rng = Math.random) {
    let [i, j] = this.cellOf(x, z);
    for (let s = 0; s < steps; s++) {
      const opts = [];
      for (let d = 0; d < 4; d++) if (this.level.passable(i, j, d)) opts.push(d);
      if (!opts.length) break;
      const d = opts[Math.floor(rng() * opts.length)];
      i += DIRS[d][0];
      j += DIRS[d][1];
    }
    return this.center(i, j);
  }
}

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(v, p) {
    const a = this.a;
    a.push({ v, p });
    let i = a.length - 1;
    while (i > 0) {
      const pi = (i - 1) >> 1;
      if (a[pi].p <= a[i].p) break;
      [a[pi], a[i]] = [a[i], a[pi]];
      i = pi;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].p < a[m].p) m = l;
        if (r < a.length && a[r].p < a[m].p) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top.v;
  }
}
