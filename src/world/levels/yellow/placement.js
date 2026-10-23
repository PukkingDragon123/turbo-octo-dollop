// Host-side prop placement checks for Level 0: keeps spawned furniture / loot out of walls, pillars,
// doorways and each other. Footprints come from the models' visual bounds (cached per type), the solid
// wall pieces and door openings from the same layout queries the chunk builder uses.
import * as THREE from 'three';
import { CELL, CHUNK, W, wallN, wallW, getLayout } from './layout.js';
import { wallPieces, T, DOOR_W, ARCH_W } from '../../env/walls.js';
import { buildModel } from '../../../entities/catalog.js';

const RACK_HALF = 0.55; // warehouse rack bays stand on cell edge lines (env/racks.js, 1.0 m deep)
const fpCache = new Map();
const _box = new THREE.Box3();
// local footprint of a model: centre offset (x, z) and half extents. Visual bounds: collider bounds are
// conservative cubes for rotated shapes (a lying pipe would claim a 1.6 m square)
export function footprint(type) {
  let f = fpCache.get(type);
  if (!f) {
    const m = buildModel(type, { seed: 1 });
    m.object.updateMatrixWorld(true);
    _box.setFromObject(m.object);
    if (_box.isEmpty()) f = { ox: 0, oz: 0, hx: 0.15, hz: 0.15, h: 0.3 };
    else f = { ox: (_box.min.x + _box.max.x) / 2, oz: (_box.min.z + _box.max.z) / 2, hx: (_box.max.x - _box.min.x) / 2, hz: (_box.max.z - _box.min.z) / 2, h: _box.max.y - _box.min.y };
    fpCache.set(type, f);
  }
  return f;
}

// oriented rectangle {x, z, hx, hz, c, s} (c/s: cos/sin of the yaw) of a model placed at (x, z, rotY)
export function rectOf(type, x, z, rotY, grow = 0) {
  const f = footprint(type);
  const c = Math.cos(rotY), s = Math.sin(rotY);
  // local x axis -> (c, -s), local z axis -> (s, c) for a rotation about +Y
  return { x: x + f.ox * c + f.oz * s, z: z - f.ox * s + f.oz * c, hx: f.hx + grow, hz: f.hz + grow, c, s };
}

function aabbRect(x0, z0, x1, z1) {
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, c: 1, s: 0 };
}

// separating-axis test between two oriented rectangles
function proj(r, ax, az) {
  return r.hx * Math.abs(r.c * ax - r.s * az) + r.hz * Math.abs(r.s * ax + r.c * az);
}
export function rectsOverlap(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const axes = [a.c, -a.s, a.s, a.c, b.c, -b.s, b.s, b.c];
  for (let k = 0; k < 8; k += 2) {
    const ax = axes[k], az = axes[k + 1];
    if (Math.abs(dx * ax + dz * az) > proj(a, ax, az) + proj(b, ax, az)) return false;
  }
  return true;
}

// solid wall slabs, pillars and doorway keep-out zones around a world rect (axis-aligned list)
export function obstacles(level, x0, z0, x1, z1, out = []) {
  const seed = level.seed, vf = level.variantFn;
  const i0 = Math.floor(x0 / CELL) - 1, i1 = Math.floor(x1 / CELL) + 1;
  const j0 = Math.floor(z0 / CELL) - 1, j1 = Math.floor(z1 / CELL) + 1;
  const pad = 0.02; // skirting
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      for (const ax of ['x', 'z']) {
        const t = ax === 'x' ? wallN(seed, i, j, vf) : wallW(seed, i, j, vf);
        if (!t) continue;
        const start = ax === 'x' ? i * CELL : j * CELL;
        const plane = ax === 'x' ? j * CELL : i * CELL;
        for (const [s0, s1, y0] of wallPieces(t, CELL)) {
          if (y0 > 1.6) continue; // door / arch headers
          const a = start + s0 - (s0 === 0 ? T / 2 : 0), b = start + s1 + (s1 === CELL ? T / 2 : 0);
          if (ax === 'x') out.push(aabbRect(a, plane - T / 2 - pad, b, plane + T / 2 + pad));
          else out.push(aabbRect(plane - T / 2 - pad, a, plane + T / 2 + pad, b));
        }
        if (t === W.DOOR || t === W.ARCH) {
          const w = t === W.DOOR ? DOOR_W : ARCH_W;
          const a = start + (CELL - w) / 2 - 0.08, b = a + w + 0.16, d = 0.6;
          if (ax === 'x') out.push(aabbRect(a, plane - d, b, plane + d));
          else out.push(aabbRect(plane - d, a, plane + d, b));
        }
      }
    }
  }
  // pillars (stored in the chunk that owns their corner cell)
  const ch = new Set();
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) ch.add(Math.floor(i / CHUNK) * 65536 + Math.floor(j / CHUNK));
  for (const k of ch) {
    const cx = Math.round(k / 65536), cz = k - cx * 65536;
    const L = getLayout(seed, cx, cz, vf(cx, cz));
    for (const p of L.pillars) {
      const px = (cx * CHUNK + p.li) * CELL, pz = (cz * CHUNK + p.lj) * CELL, hs = p.size / 2 + pad;
      if (px + hs < x0 - 1 || px - hs > x1 + 1 || pz + hs < z0 - 1 || pz - hs > z1 + 1) continue;
      out.push(aabbRect(px - hs, pz - hs, px + hs, pz + hs));
    }
    // floor pits of special rooms and warehouse rack bays
    const ox = cx * CHUNK * CELL, oz = cz * CHUNK * CELL;
    for (const h of L.holes) {
      if (ox + h.x1 < x0 - 1 || ox + h.x0 > x1 + 1 || oz + h.z1 < z0 - 1 || oz + h.z0 > z1 + 1) continue;
      out.push(aabbRect(ox + h.x0 - 0.15, oz + h.z0 - 0.15, ox + h.x1 + 0.15, oz + h.z1 + 0.15));
    }
    // squeezes: the thick walls either side of the passage (passage 1.1 m wide down the cell's middle)
    for (const n of L.narrows || []) {
      const nx = ox + n.li * CELL, nz = oz + n.lj * CELL;
      if (nx + CELL < x0 - 1 || nx > x1 + 1 || nz + CELL < z0 - 1 || nz > z1 + 1) continue;
      if (n.ax === 'x') { out.push(aabbRect(nx, nz, nx + CELL, nz + CELL / 2 - 0.55 + pad)); out.push(aabbRect(nx, nz + CELL / 2 + 0.55 - pad, nx + CELL, nz + CELL)); }
      else { out.push(aabbRect(nx, nz, nx + CELL / 2 - 0.55 + pad, nz + CELL)); out.push(aabbRect(nx + CELL / 2 + 0.55 - pad, nz, nx + CELL, nz + CELL)); }
    }
    for (const d of L.decor) {
      if (d.kind === 'walldoor' && d.y) continue; // a door high up in the wall leaves the floor free
      if (d.kind === 'walldoor') {
        // keep the floor in front of a wall door (and its swung leaf) clear
        const wx = ox + d.li * CELL, wz = oz + d.lj * CELL;
        if (d.side === 'N') out.push(aabbRect(wx + 0.0, wz, wx + 2.1, wz + 1.15));
        else out.push(aabbRect(wx, wz + 0.9, wx + 1.15, wz + CELL));
        continue;
      }
      if (d.kind !== 'rack') continue;
      const rx = ox + d.li * CELL, rz = oz + d.lj * CELL;
      if (rx + CELL < x0 - 1 || rx > x1 + 1 || rz + 0.6 < z0 - 1 || rz - 0.6 > z1 + 1) continue;
      out.push(aabbRect(rx - 0.05, rz - RACK_HALF, rx + CELL + 0.05, rz + RACK_HALF));
    }
  }
  return out;
}

const _obs = [];
// Tracks what a chunk population has put down; place() tries the asked spot, then spots pulled towards
// the cell centre and a quarter turn, and returns the first one that is clear (or null).
export class Placer {
  constructor(level) {
    this.level = level;
    this.rects = [];
  }

  reserve(r) { this.rects.push(r); }
  reserveBox(x0, z0, x1, z1) { this.rects.push(aabbRect(x0, z0, x1, z1)); }

  clear(r, gap = 0.05) {
    const ext = Math.max(r.hx, r.hz) * 1.42;
    _obs.length = 0;
    obstacles(this.level, r.x - ext, r.z - ext, r.x + ext, r.z + ext, _obs);
    for (const o of _obs) if (rectsOverlap(r, o)) return false;
    const g = { ...r, hx: r.hx + gap, hz: r.hz + gap };
    for (const o of this.rects) if (rectsOverlap(g, o)) return false;
    return true;
  }

  // (x, z, rotY): wanted spot; (ax, az): anchor to pull towards (usually the cell centre)
  place(type, x, z, rotY, ax = x, az = z, gap = 0.05) {
    for (const turn of [0, Math.PI / 2]) {
      for (const k of [1, 0.6, 0.3, 0]) {
        const px = ax + (x - ax) * k, pz = az + (z - az) * k, ry = rotY + turn;
        const r = rectOf(type, px, pz, ry);
        if (this.clear(r, gap)) { this.rects.push(r); return { x: px, z: pz, rotY: ry }; }
        if (x === ax && z === az) break;
      }
    }
    return null;
  }
}
