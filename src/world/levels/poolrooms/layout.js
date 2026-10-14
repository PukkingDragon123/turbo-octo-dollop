// Deterministic layout generation for Level 37 — "The Poolrooms".
// Pure data (no three.js). Same 3 m cell lattice and 8x8-cell chunks as the Yellow Rooms (so the
// shared mission / monster / anomaly / critter systems keep working), but with per-cell floor and
// ceiling heights, sunken flooded floors and rectangular pool basins (deep / lap / wading / spa).
// Every peer generates identical layouts from (seed, chunk, variant). Pools and rooms do not depend
// on the variant (day-7 corridor shifts only rearrange walls between ordinary deck cells).
import { hash01, hash3, RNG, valueNoise2 } from '../../../core/rng.js';
import { CELL, CHUNK, CHUNK_M, HEIGHT, W, missionChunks, wallPassable, wallTransmission } from '../yellow/layout.js';

export { CELL, CHUNK, CHUNK_M, HEIGHT, W, missionChunks, wallPassable, wallTransmission };

export const TALL = 4.6;        // natatorium / colonnade ceiling (vault apex)
export const VAULT_SPRING = 3.1; // groin vault springing height (apex = TALL)
export const WATER_Y = -0.1;    // base water level (10 cm below the deck)
export const SUNK_Y = -0.2;     // sunken, flooded floors
export const T = 0.24;          // wall thickness
export const RISE = 0.1833;     // pool stair riser
export const TREAD = 0.3;       // pool stair tread

const WALL_P = { halls: 0.37, natatorium: 0.06, colonnade: 0.0, flooded: 0.3 };
const TALLZ = { natatorium: 1, colonnade: 1 };

export function zoneAt(seed, i, j) {
  // spawn chunk: an arrival hall (see generateLayout); its surroundings stay ordinary halls
  if (i >= 0 && i < CHUNK && j >= 0 && j < CHUNK) return 'natatorium';
  if (Math.abs(i - 4) <= 9 && Math.abs(j - 4) <= 9) {
    // a little calmer around the spawn: no colonnades / floods directly next to it
    const n = valueNoise2(i * 0.085 + (seed % 10000), j * 0.085 - 31, 711);
    return n > 0.62 ? 'natatorium' : 'halls';
  }
  const s = seed % 10000;
  const nNat = valueNoise2(i * 0.085 + s, j * 0.085 - 31, 711);
  const nCol = valueNoise2(i * 0.11 - 17, j * 0.11 + s, 722);
  const nFlood = valueNoise2(i * 0.1 + 53 + s, j * 0.1 + 7, 733);
  if (nNat > 0.6) return 'natatorium';
  if (nCol > 0.74) return 'colonnade';
  if (nFlood > 0.72) return 'flooded';
  return 'halls';
}

const SPECIALS = [
  ['locker_room', 8], ['storage', 8], ['lifeguard_office', 7], ['pump_room', 6], ['endless_hall', 5],
  ['yellow_bleed', 4], ['stairs_water', 5], ['drowned_room', 4], ['dead_clone', 6], ['vending_lonely', 5],
  ['sinking', 5], ['clipping', 4], ['shower_room', 6],
];

function specialSize(kind) {
  switch (kind) {
    case 'endless_hall': return [6, 1];
    case 'locker_room': return [2, 2];
    case 'storage': return [2, 2];
    case 'drowned_room': return [2, 2];
    case 'sinking': return [2, 2];
    case 'pump_room': return [2, 1];
    case 'stairs_water': return [1, 2];
    case 'shower_room': return [2, 1];
    case 'yellow_bleed': return [2, 2];
    default: return [1, 1];
  }
}

// numeric-key cache (hit very often while baking light)
const layoutCache = new Map();
let cacheSeed = null;

export function getLayout(seed, cx, cz, variant = 0) {
  if (seed !== cacheSeed) { layoutCache.clear(); cacheSeed = seed; }
  const key = ((cx + 4096) * 8192 + (cz + 4096)) * 64 + (variant & 63);
  let l = layoutCache.get(key);
  if (!l) {
    l = generateLayout(seed, cx, cz, variant);
    layoutCache.set(key, l);
    if (layoutCache.size > 600) layoutCache.delete(layoutCache.keys().next().value);
  }
  return l;
}

export function clearLayoutCache() { layoutCache.clear(); cacheSeed = null; }

// ---------------------------------------------------------------------------
function generateLayout(seed, cx, cz, variant) {
  const N = CHUNK;
  const rngFixed = new RNG(hash3(cx, cz, 515, seed));      // rooms & pools (variant independent)
  const rng = new RNG(hash3(cx, cz, variant + 77, seed));  // walls, props
  const i0 = cx * N, j0 = cz * N;
  const cells = [];
  for (let lj = 0; lj < N; lj++) {
    for (let li = 0; li < N; li++) {
      const i = i0 + li, j = j0 + lj;
      const zone = zoneAt(seed, i, j);
      const sunk = zone === 'flooded' || zone === 'colonnade';
      cells.push({
        li, lj, i, j, zone,
        floor: sunk ? 'sunk' : 'deck',
        fy: sunk ? SUNK_Y : 0,
        ceil: TALLZ[zone] ? TALL : HEIGHT,
        vault: zone === 'colonnade',
        water: sunk,
        wet: sunk ? 1 : 0,
        spill: false,
        light: 1, lightKind: 'panel', lightMode: 'on', lightTone: 0, lightSeed: 0, lightRot: 0,
        special: null, reserved: false, pool: null, tint: 0,
      });
    }
  }
  const cell = (li, lj) => cells[lj * N + li];
  const inside = (li, lj) => li >= 0 && lj >= 0 && li < N && lj < N;
  const edgesN = new Uint8Array(N * N);
  const edgesW = new Uint8Array(N * N);

  // --- base walls ---
  for (let lj = 0; lj < N; lj++) {
    for (let li = 0; li < N; li++) {
      const c = cell(li, lj);
      const i = c.i, j = c.j;
      edgesN[lj * N + li] = edgeWall(seed, variant, c.zone, zoneAt(seed, i, j - 1), i, j, 21);
      edgesW[lj * N + li] = edgeWall(seed, variant, c.zone, zoneAt(seed, i - 1, j), i, j, 23);
    }
  }

  const layout = {
    seed, cx, cz, variant, cells, edgesN, edgesW,
    pillars: [], specials: [], spawns: [], decor: [], vents: [], pools: [],
    drains: [], grilles: [], windows: [],
  };

  // --- mission / fixed rooms (same places as in the Yellow Rooms) ---
  const mission = missionChunks(seed);
  const isSpawn = cx === 0 && cz === 0;
  const gen = mission.find((m) => m.cx === cx && m.cz === cz);
  if (isSpawn) placeRoom(layout, rngFixed, 'spawn', 3, 3, 2, 2, { doors: 4 });
  else if (gen) placeRoom(layout, rngFixed, 'gen_' + gen.kind, 3, 3, 2, 2, { doors: 2 });
  for (const m of mission) {
    if (m.kind === 'diesel' && cx === m.cx + 1 && cz === m.cz) placeRoom(layout, rngFixed, 'fuel_store', 2, 5, 1, 1, { doors: 1 });
    if (m.kind === 'electric' && cx === m.cx && cz === m.cz + 1) placeRoom(layout, rngFixed, 'fuse_office', 5, 2, 1, 1, { doors: 1 });
  }
  if (cx === 0 && cz === 1) placeRoom(layout, rngFixed, 'workshop', 2, 2, 2, 2, { doors: 2 });

  // --- random special room ---
  if (!isSpawn && !gen && rngFixed.chance(0.6)) {
    const kind = rngFixed.weighted(SPECIALS);
    const [w, h] = specialSize(kind);
    const rx = rngFixed.int(1, N - 1 - w), rz = rngFixed.int(1, N - 1 - h);
    if (canPlace(layout, rx, rz, w, h)) placeRoom(layout, rngFixed, kind, rx, rz, w, h, { doors: kind === 'endless_hall' ? 0 : rngFixed.int(1, 2) });
  }

  // --- pools ---
  for (const room of layout.specials) {
    if (room.kind === 'stairs_water') addPool(layout, rngFixed, 'stairs', room.rx, room.rz, room.w, room.h, { axis: room.poolAxis, dir: room.poolDir, room: true });
    if (room.kind === 'drowned_room') addPool(layout, rngFixed, 'drowned', room.rx, room.rz, room.w, room.h, { axis: room.poolAxis, dir: room.poolDir, room: true });
  }
  if (isSpawn) {
    // the arrival hall: two long lap pools flank the spawn room
    addPool(layout, rngFixed, 'lap', 1, 1, 1, 6, { axis: 'z', dir: 1 });
    addPool(layout, rngFixed, 'lap', 6, 1, 1, 6, { axis: 'z', dir: -1 });
  } else placePools(layout, rngFixed);

  // --- tall / low boundaries: tall zones meeting low ones get proper walls with openings ---
  for (let lj = 0; lj < N; lj++) {
    for (let li = 0; li < N; li++) {
      const c = cell(li, lj);
      for (const side of ['N', 'W']) {
        const oi = side === 'W' ? c.i - 1 : c.i, oj = side === 'N' ? c.j - 1 : c.j;
        const oz = inside(li - (side === 'W'), lj - (side === 'N')) ? cell(li - (side === 'W'), lj - (side === 'N')).zone : zoneAt(seed, oi, oj);
        const arr = side === 'N' ? edgesN : edgesW;
        const idx = lj * N + li;
        if (c.reserved && c.special) continue; // room walls already set
        const other = inside(li - (side === 'W'), lj - (side === 'N')) ? cell(li - (side === 'W'), lj - (side === 'N')) : null;
        if (other?.reserved && other.special) continue;
        const tallA = !!TALLZ[c.zone], tallB = !!TALLZ[oz];
        if (c.zone === 'colonnade' && oz === 'colonnade') { arr[idx] = W.NONE; continue; }
        if (tallA !== tallB || (c.zone === 'colonnade') !== (oz === 'colonnade')) {
          const h = hash01(c.i * 3 + (side === 'N' ? 1 : 2), c.j, 31 + variant * 5, seed);
          arr[idx] = h < 0.3 ? W.FULL : h < 0.72 ? W.ARCH : h < 0.9 ? W.DOOR : W.WINDOW;
        }
      }
    }
  }

  // --- pool edges never carry walls ---
  for (const p of layout.pools) {
    if (p.room) continue;
    for (let lj = p.rz; lj <= p.rz + p.h && lj < N; lj++) for (let li = p.rx; li < p.rx + p.w; li++) edgesN[lj * N + li] = W.NONE;
    for (let lj = p.rz; lj < p.rz + p.h; lj++) for (let li = p.rx; li <= p.rx + p.w && li < N; li++) edgesW[lj * N + li] = W.NONE;
  }

  // --- lights ---
  for (const c of cells) assignLight(c, seed);

  // --- pillars at cell corners ---
  const cornerFree = (li, lj) => {
    // corner point (li,lj) = top-left of cell (li,lj); touches cells (li-1..li, lj-1..lj)
    for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) {
      const a = li + di, b = lj + dj;
      if (!inside(a, b)) continue;
      const cc = cell(a, b);
      if (cc.pool || (cc.reserved && cc.special && cc.special.kind !== 'spawn')) return false;
      if (cc.special?.kind === 'spawn') return false;
    }
    return true;
  };
  for (let lj = 0; lj < N; lj++) {
    for (let li = 0; li < N; li++) {
      const c = cell(li, lj);
      if (!cornerFree(li, lj)) continue;
      if (c.zone === 'colonnade' && zoneAt(seed, c.i - 1, c.j) === 'colonnade' && zoneAt(seed, c.i, c.j - 1) === 'colonnade' && zoneAt(seed, c.i - 1, c.j - 1) === 'colonnade') {
        layout.pillars.push({ li, lj, size: 0.62, kind: 'column' });
      } else if (c.zone === 'natatorium' && !isSpawn && (c.i % 2 === 0) && (c.j % 2 === 0) && hash01(c.i, c.j, 41, seed) < 0.35) {
        layout.pillars.push({ li, lj, size: 0.7, kind: 'square' });
      } else if (c.zone === 'halls' && hash01(c.i, c.j, 42, seed) < 0.03) {
        layout.pillars.push({ li, lj, size: 0.5, kind: 'square' });
      }
    }
  }

  // ensure no cell is fully closed (open one edge)
  for (let lj = 0; lj < N - 1; lj++) {
    for (let li = 0; li < N - 1; li++) {
      const c = cell(li, lj);
      if (c.reserved) continue;
      const n = edgesN[lj * N + li], w = edgesW[lj * N + li];
      const s = edgesN[(lj + 1) * N + li], e = edgesW[lj * N + li + 1];
      const closed = [n, w, s, e].filter((x) => !wallPassable(x)).length;
      if (closed === 4) {
        const k = Math.floor(hash01(c.i, c.j, 51, seed) * 4);
        if (k === 0) edgesN[lj * N + li] = W.ARCH;
        else if (k === 1) edgesW[lj * N + li] = W.ARCH;
        else if (k === 2 && !cell(li, lj + 1).reserved) edgesN[(lj + 1) * N + li] = W.DOOR;
        else if (!cell(li + 1, lj).reserved) edgesW[lj * N + li + 1] = W.ARCH;
      }
    }
  }

  // --- wetness, spill (late-day flooding) ---
  for (const c of cells) {
    if (c.water) continue;
    let nearWater = false;
    for (let dj = -1; dj <= 1 && !nearWater; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      if (inside(c.li + di, c.lj + dj)) { if (cell(c.li + di, c.lj + dj).water) { nearWater = true; break; } }
      else { const z = zoneAt(seed, c.i + di, c.j + dj); if (z === 'flooded' || z === 'colonnade') { nearWater = true; break; } }
    }
    if (nearWater) c.wet = Math.max(c.wet, 0.55);
    else if (hash01(c.i, c.j, 12, seed) < 0.18) c.wet = 0.35;
    c.spill = nearWater && !c.reserved;
  }

  // --- decor & detail positions ---
  placeDetails(layout, rng, seed);

  // --- prop spawns ---
  for (const c of cells) if (!c.reserved || c.special?.kind === 'spawn') spawnZoneProps(layout, c, rng, seed);
  for (const p of layout.pools) spawnPoolProps(layout, p, rngFixed, seed);
  return layout;
}

function edgeWall(seed, variant, zA, zB, i, j, salt) {
  const p = Math.max(WALL_P[zA] ?? 0.35, WALL_P[zB] ?? 0.35);
  const h = hash01(i, j, salt + variant * 7, seed), h2 = hash01(i, j, salt + 1 + variant * 7, seed);
  if (h >= p) return W.NONE;
  if (h2 < 0.44) return W.FULL;
  if (h2 < 0.58) return W.DOOR;
  if (h2 < 0.74) return W.ARCH;
  if (h2 < 0.82) return W.HALF_A;
  if (h2 < 0.9) return W.HALF_B;
  if (h2 < 0.95) return W.LOW;
  return W.WINDOW;
}

function canPlace(layout, rx, rz, w, h) {
  for (let j = rz; j < rz + h; j++) for (let i = rx; i < rx + w; i++) {
    const c = layout.cells[j * CHUNK + i];
    if (c.reserved || c.pool) return false;
  }
  return true;
}

// Enclosed room over cells [rx..rx+w-1]x[rz..rz+h-1] (chunk-local)
function placeRoom(layout, rng, kind, rx, rz, w, h, opts = {}) {
  const N = CHUNK;
  const { cells, edgesN, edgesW } = layout;
  const room = { kind, rx, rz, w, h, doors: [] };
  for (let j = rz; j < rz + h; j++) {
    for (let i = rx; i < rx + w; i++) {
      const c = cells[j * N + i];
      c.reserved = true;
      c.special = room;
      c.water = false;
      c.floor = 'deck';
      c.fy = 0;
      c.wet = 0;
      c.ceil = HEIGHT;
      c.vault = false;
      c.light = 1;
      c.lightMode = 'on';
      c.lightKind = 'panel';
      if (i > rx) edgesW[j * N + i] = W.NONE;
      if (j > rz) edgesN[j * N + i] = W.NONE;
    }
  }
  const boundary = [];
  for (let i = rx; i < rx + w; i++) {
    boundary.push({ arr: 'N', idx: rz * N + i, side: 'N', i });
    if (rz + h < N) boundary.push({ arr: 'N', idx: (rz + h) * N + i, side: 'S', i });
  }
  for (let j = rz; j < rz + h; j++) {
    boundary.push({ arr: 'W', idx: j * N + rx, side: 'W', j });
    if (rx + w < N) boundary.push({ arr: 'W', idx: j * N + rx + w, side: 'E', j });
  }
  for (const b of boundary) (b.arr === 'N' ? edgesN : edgesW)[b.idx] = W.FULL;
  if (kind === 'spawn') {
    // arrival room: wide arched openings all around
    for (const b of boundary) (b.arr === 'N' ? edgesN : edgesW)[b.idx] = W.ARCH;
  } else {
    const nd = opts.doors ?? 1;
    const choices = rng.shuffle(boundary.slice());
    for (let d = 0; d < Math.min(nd, choices.length); d++) {
      const b = choices[d];
      (b.arr === 'N' ? edgesN : edgesW)[b.idx] = kind.startsWith('gen_') || kind === 'workshop' ? W.ARCH : W.DOOR;
      room.doors.push(b);
    }
    if (kind === 'endless_hall') {
      edgesW[rz * N + rx] = W.ARCH;
      if (rx + w < N) edgesW[rz * N + rx + w] = W.ARCH;
    }
    if (kind === 'stairs_water' || kind === 'drowned_room') {
      // a single door at the top of the stairs; the rest of the room is a flooded basin
      for (const b of boundary) (b.arr === 'N' ? edgesN : edgesW)[b.idx] = W.FULL;
      room.doors.length = 0;
      const axis = w >= h ? 'x' : 'z';
      const dir = rng.chance(0.5) ? 1 : -1;
      const side = axis === 'x' ? (dir > 0 ? 'W' : 'E') : (dir > 0 ? 'N' : 'S');
      const cands = boundary.filter((b) => b.side === side);
      const b = cands[Math.floor(rng.next() * cands.length)] || boundary[0];
      (b.arr === 'N' ? edgesN : edgesW)[b.idx] = W.DOOR;
      room.doors.push(b);
      room.poolAxis = axis; room.poolDir = dir;
    }
  }
  for (let j = rz; j < rz + h; j++) for (let i = rx; i < rx + w; i++) {
    const c = cells[j * N + i];
    if (kind.startsWith('gen_') || kind === 'workshop' || kind === 'fuel_store' || kind === 'pump_room') { c.lightTone = 2; c.roomStyle = 'plant'; }
    if (kind === 'yellow_bleed') { c.lightTone = 3; c.roomStyle = 'yellow'; }
    if (kind === 'fuse_office' || kind === 'lifeguard_office') c.lightTone = 1;
    if (kind === 'dead_clone') c.lightMode = 'flicker';
    if (kind === 'locker_room' || kind === 'shower_room') c.roomStyle = 'locker';
    if (kind === 'endless_hall') { c.lightMode = 'on'; c.light = 1; c.lightSeed = 0.5; c.lightRot = 0; c.roomStyle = 'tunnel'; }
    if (kind === 'stairs_water' || kind === 'drowned_room') { c.lightMode = c.i % 2 ? 'flicker' : 'on'; c.lightTone = 4; }
  }
  layout.specials.push(room);
  return room;
}

// ---------------------------------------------------------------------------
// Pools
const POOL_KINDS = {
  // shallowY: floor at the stair end; deepY: floor at the far end; steps: risers down to shallowY
  deep: { shallowY: -1.1, deepY: -1.9, steps: 6 },
  lap: { shallowY: -1.1, deepY: -1.45, steps: 6 },
  wading: { shallowY: -0.55, deepY: -0.55, steps: 3 },
  spa: { shallowY: -0.55, deepY: -0.55, steps: 0 },
  drowned: { shallowY: -1.6, deepY: -1.6, steps: 9 },
  stairs: { shallowY: -2.2, deepY: -2.2, steps: 12 },
};

function addPool(layout, rng, kind, rx, rz, w, h, o = {}) {
  const N = CHUNK;
  const K = POOL_KINDS[kind];
  const axis = o.axis || (w >= h ? 'x' : 'z');
  const dir = o.dir || (rng.chance(0.5) ? 1 : -1);
  const L = (axis === 'x' ? w : h) * CELL; // length along the axis
  const run = Math.max(0, K.steps - 1) * TREAD;
  const pool = {
    id: layout.pools.length, kind, rx, rz, w, h, axis, dir, L, room: !!o.room,
    shallowY: K.shallowY, deepY: K.deepY, steps: K.steps, run,
    flat: kind === 'deep' ? Math.min(2.2, L * 0.25) : L, // shallow flat after the stairs
    deepFlat: kind === 'deep' ? Math.min(2.4, L * 0.25) : 0,
    ladders: [], lights: [], rope: null, lanes: [], drains: [], bench: kind === 'spa',
    lightsOn: hash01(layout.cx * 7 + rx, layout.cz * 5 + rz, 91, layout.seed) < 0.85,
    tile: kind === 'spa' ? 1 : kind === 'wading' ? 2 : 0,
  };
  pool.slopeLen = Math.max(0.01, L - pool.run - pool.flat - pool.deepFlat);
  for (let j = rz; j < rz + h; j++) for (let i = rx; i < rx + w; i++) {
    const c = layout.cells[j * N + i];
    c.pool = pool;
    c.floor = 'pool';
    c.water = true;
    c.wet = 1;
    c.vault = false;
    if (c.zone === 'colonnade' && !o.room) c.zone = 'natatorium';
  }
  // details along the long sides: lights, ladders
  const across = (axis === 'x' ? h : w) * CELL;
  if (pool.room) {
    pool.drains.push({ s: L - 0.8, t: 0.5 });
  } else if (kind === 'deep' || kind === 'lap' || kind === 'drowned') {
    for (let s = pool.run + 1.4; s < L - 0.8; s += 2.6) {
      pool.lights.push({ s, side: -1 });
      pool.lights.push({ s: across > 4 && s + 1.3 < L - 0.8 ? s + 1.3 : s, side: 1 });
    }
    if (kind !== 'drowned') {
      pool.ladders.push({ s: L - 1.6, side: rng.chance(0.5) ? -1 : 1 });
      if (L > 10) pool.ladders.push({ s: L * 0.55, side: -pool.ladders[0].side });
    }
    if (kind === 'deep' && L >= 9) pool.rope = { s: pool.run + pool.flat + pool.slopeLen * 0.15 };
    if (kind === 'lap') pool.lanes.push(0.5);
    else if (across >= 6) for (let k = 1; k * 2.5 < across - 0.6; k++) pool.lanes.push((k * 2.5) / across);
    pool.drains.push({ s: L - 0.9, t: 0.5 });
  } else if (kind === 'wading') {
    pool.lights.push({ s: L * 0.6, side: -1 });
    pool.drains.push({ s: L * 0.6, t: 0.5 });
  } else if (kind === 'spa') {
    pool.lights.push({ s: L * 0.5, side: 1 });
    pool.drains.push({ s: L * 0.5, t: 0.5 });
  }
  layout.pools.push(pool);
  return pool;
}

function placePools(layout, rng) {
  const N = CHUNK;
  const { cells } = layout;
  let nat = 0, halls = 0;
  for (const c of cells) { if (c.zone === 'natatorium') nat++; else if (c.zone === 'halls') halls++; }
  let want = nat > 26 ? 2 : nat > 8 ? 1 : 0;
  if (halls > 30 && rng.chance(0.4)) want++;
  let placed = 0;
  for (let tries = 0; tries < 40 && placed < want; tries++) {
    const natRich = nat > 8;
    const kind = natRich ? rng.weighted([['deep', 5], ['lap', 3], ['wading', 2], ['spa', 1]]) : rng.weighted([['wading', 3], ['spa', 2], ['lap', 1]]);
    let w, h;
    if (kind === 'deep') { w = rng.int(2, 4); h = rng.int(3, 6); }
    else if (kind === 'lap') { w = 1; h = rng.int(4, 6); }
    else if (kind === 'wading') { w = rng.int(1, 2); h = rng.int(1, 3); }
    else { w = 1; h = 1; }
    if (rng.chance(0.5)) [w, h] = [h, w];
    if (w > N - 2 || h > N - 2) continue;
    const rx = rng.int(1, N - 1 - w), rz = rng.int(1, N - 1 - h);
    let ok = true;
    for (let j = rz - 1; j <= rz + h && ok; j++) for (let i = rx - 1; i <= rx + w; i++) {
      const c = cells[j * N + i];
      // pools keep a dry deck ring: no rooms, no other pools, no sunken floors around them
      if (!c || c.reserved || c.pool || c.floor === 'sunk') { ok = false; break; }
    }
    if (!ok) continue;
    addPool(layout, rng, kind, rx, rz, w, h);
    placed++;
  }
}

// Pool floor height at along-axis distance s (0 = stair end) — pure function of the pool record
export function poolFloorAt(p, s, t = 0.5) {
  if (p.kind === 'spa') {
    // bench ledge around a sunken centre
    const e = Math.min(s, p.L - s, t * (p.axis === 'x' ? p.h : p.w) * CELL, (1 - t) * (p.axis === 'x' ? p.h : p.w) * CELL);
    return e < 0.45 ? -0.25 : p.shallowY;
  }
  if (p.steps > 0 && s < p.run) {
    const k = Math.floor(s / TREAD);
    return -(k + 1) * RISE;
  }
  if (s < p.run + p.flat) return p.shallowY;
  const s2 = s - p.run - p.flat;
  if (s2 < p.slopeLen) {
    const k = s2 / p.slopeLen;
    const sm = k * k * (3 - 2 * k);
    return p.shallowY + (p.deepY - p.shallowY) * sm;
  }
  return p.deepY;
}

// along/across coordinates of a world point inside a pool (chunk origin ox, oz)
export function poolCoords(p, ox, oz, x, z) {
  const x0 = ox + p.rx * CELL, z0 = oz + p.rz * CELL;
  const wM = p.w * CELL, hM = p.h * CELL;
  let s, t;
  if (p.axis === 'x') { s = x - x0; t = (z - z0) / hM; if (p.dir < 0) s = wM - s; }
  else { s = z - z0; t = (x - x0) / wM; if (p.dir < 0) s = hM - s; }
  return [s, t];
}

// world point from pool coordinates
export function poolPoint(p, ox, oz, s, t) {
  const x0 = ox + p.rx * CELL, z0 = oz + p.rz * CELL;
  const wM = p.w * CELL, hM = p.h * CELL;
  if (p.axis === 'x') return [x0 + (p.dir < 0 ? wM - s : s), z0 + t * hM];
  return [x0 + t * wM, z0 + (p.dir < 0 ? hM - s : s)];
}

// ---------------------------------------------------------------------------
function assignLight(c, seed) {
  const h = hash01(c.i, c.j, 31, seed);
  const h2 = hash01(c.i, c.j, 32, seed);
  c.lightSeed = h2;
  c.lightRot = (c.i + c.j) % 2;
  if (c.reserved && c.special) {
    c.light = 1;
    c.lightKind = c.special.kind === 'endless_hall' ? 'dome' : 'panel';
  } else if (c.zone === 'natatorium') {
    if (c.i % 2 === 0 && c.j % 2 === 0) { c.light = 1; c.lightKind = 'sky'; } else { c.light = h < 0.5 ? 1 : 0; c.lightKind = 'dome'; }
  } else if (c.zone === 'colonnade') {
    c.light = h < 0.9 ? 1 : 0;
    c.lightKind = 'dome';
  } else {
    c.light = h < 0.86 ? 1 : 0;
    c.lightKind = 'panel';
  }
  if (c.zone === 'flooded') {
    c.lightTone = 6;
    if (h2 < 0.12) c.lightMode = 'dead';
    else if (h2 < 0.22) c.lightMode = 'flicker';
    else if (h2 < 0.27) c.lightMode = 'buzz';
  } else if (!c.reserved) {
    if (h2 < 0.03) c.lightMode = 'dead';
    else if (h2 < 0.07) c.lightMode = 'flicker';
    else if (h2 < 0.1) c.lightMode = 'buzz';
  }
  if (c.lightKind === 'sky') { c.lightTone = 5; if (c.lightMode !== 'dead') c.lightMode = 'on'; }
  else if (c.lightKind === 'dome' && c.lightTone === 0) c.lightTone = 7;
}

// ---------------------------------------------------------------------------
// Static details: drains, wall grilles (critter exits), porthole windows, benches, lifeguard chairs
function placeDetails(layout, rng, seed) {
  const N = CHUNK;
  const { cells, edgesN, edgesW } = layout;
  for (const c of cells) {
    if (c.pool || c.water) continue;
    if (c.reserved && c.special?.kind !== 'spawn') continue;
    const h = hash01(c.i, c.j, 71, seed);
    if (h < (c.wet > 0.4 ? 0.22 : 0.08) && c.special?.kind !== 'spawn') {
      // square floor drain, off-centre so props and the exit room rarely sit on it
      layout.drains.push({ li: c.li, lj: c.lj, x: c.li * CELL + 0.6 + hash01(c.i, c.j, 72, seed) * 1.8, z: c.lj * CELL + 0.6 + hash01(c.i, c.j, 73, seed) * 1.8 });
    }
  }
  // porthole windows (glowing, recessed) on full walls
  for (let lj = 0; lj < N; lj++) for (let li = 0; li < N; li++) {
    const c = cells[lj * N + li];
    for (const side of ['N', 'W']) {
      const t = (side === 'N' ? edgesN : edgesW)[lj * N + li];
      if (t !== W.FULL) continue;
      const h = hash01(c.i * 2 + (side === 'N' ? 1 : 0), c.j, 74, seed);
      const tall = c.ceil > HEIGHT + 0.1;
      if (h < (tall ? 0.55 : 0.16)) layout.windows.push({ li, lj, side, n: tall ? 3 : (h < 0.05 ? 2 : 1), high: tall });
      else if (h > 0.93 && !c.special) layout.grilles.push({ li, lj, side });
    }
  }
  // lifeguard chairs beside the big pools; a tube slide spirals into some deep ends
  for (const p of layout.pools) {
    if (p.kind === 'deep' || p.kind === 'lap') {
      const side = p.ladders[0]?.side ? -p.ladders[0].side : 1;
      layout.decor.push({ kind: 'lifeguard', pool: p.id, s: p.L * 0.5, side });
      const tall = layout.cells[p.rz * CHUNK + p.rx].ceil > HEIGHT + 0.5;
      if (p.kind === 'deep' && p.L >= 9 && tall && hash01(layout.cx * 13 + p.rx, layout.cz * 7 + p.rz, 83, seed) < 0.6) {
        layout.decor.push({ kind: 'slide', pool: p.id, s: p.L - 2.3, side });
      }
    }
  }
  void rng;
}

// ---------------------------------------------------------------------------
// Prop spawns. Positions in chunk-local meters (x,z from chunk origin), y = floor height.
function sp(layout, type, x, z, rotY = 0, extra = {}) {
  layout.spawns.push({ type, x, z, rotY, ...extra });
}

const LOOT_RARE = [['almond_water', 7], ['protein_bar', 3], ['chips', 2], ['soda_can', 3], ['energy_drink', 2], ['bandage', 3], ['battery', 3], ['glowstick', 2], ['sample_jar', 3], ['canned_food', 2], ['painkillers', 1], ['candy_bar', 2], ['flare', 1], ['medkit', 0.6], ['antibiotics', 0.6], ['flashlight', 0.6], ['multitool', 0.6], ['screws', 1], ['fabric_scrap', 2], ['wire_spool', 1], ['tape_roll', 1]];

function spawnZoneProps(layout, c, rng, seed) {
  if (c.pool) return;
  const x0 = c.li * CELL, z0 = c.lj * CELL;
  const cx = x0 + CELL / 2, cz = z0 + CELL / 2;
  const r = () => rng.range(-0.75, 0.75);
  const h = hash01(c.i, c.j, 61, seed);
  const y = c.fy;
  if (c.special?.kind === 'spawn') return;
  switch (c.zone) {
    case 'natatorium': {
      if (h < 0.1) sp(layout, 'pool_chair', cx + r(), cz + r(), rng.next() * 6.28, { y });
      else if (h < 0.13) sp(layout, 'kickboard', cx + r(), cz + r(), rng.next() * 6.28, { y });
      else if (h < 0.15) sp(layout, 'wet_floor_sign', cx + r(), cz + r(), rng.next() * 6.28, { y });
      else if (h < 0.17) sp(layout, 'pool_noodle', cx + r(), cz + r(), rng.next() * 6.28, { y });
      if (hash01(c.i, c.j, 62, seed) < 0.035) sp(layout, rng.weighted(LOOT_RARE), cx + r(), cz + r(), rng.next() * 6.28, { y });
      break;
    }
    case 'halls': {
      if (h < 0.04) sp(layout, rng.pick(['pool_chair', 'pool_chair', 'kickboard', 'bucket', 'wet_floor_sign', 'mop', 'pool_ring', 'towel']), cx + r(), cz + r(), rng.next() * 6.28, { y });
      else if (h < 0.055) sp(layout, rng.pick(['pool_lounger', 'table_folding', 'step_ladder', 'water_jug']), cx + r() * 0.5, cz + r() * 0.5, rng.next() * 6.28, { y });
      if (hash01(c.i, c.j, 62, seed) < 0.03) sp(layout, rng.weighted(LOOT_RARE), cx + r(), cz + r(), rng.next() * 6.28, { y });
      break;
    }
    case 'flooded':
    case 'colonnade': {
      if (h < 0.07) sp(layout, rng.pick(['pool_ring', 'kickboard', 'pool_noodle', 'rubber_duck', 'beach_ball', 'float_mat']), cx + r(), cz + r(), rng.next() * 6.28, { y: WATER_Y - 0.02, float: true });
      else if (h < 0.09) sp(layout, rng.pick(['pool_chair', 'bucket', 'wet_floor_sign']), cx + r(), cz + r(), rng.next() * 6.28, { y });
      if (hash01(c.i, c.j, 62, seed) < 0.025) sp(layout, rng.pick(['almond_water', 'almond_water', 'sample_jar', 'glowstick']), cx + r(), cz + r(), 0, { y });
      break;
    }
    default: break;
  }
}

function spawnPoolProps(layout, p, rng, seed) {
  const ox = 0, oz = 0;
  // loungers in a row along one long side, facing the water
  if (p.kind === 'deep' || p.kind === 'lap' || p.kind === 'wading') {
    const side = rng.chance(0.5) ? -1 : 1;
    const across = (p.axis === 'x' ? p.h : p.w) * CELL;
    const n = Math.floor(p.L / 2.2);
    const guard = layout.decor.find((d) => d.kind === 'lifeguard' && d.pool === p.id);
    for (let k = 0; k < n; k++) {
      if (!rng.chance(0.6)) continue;
      const s = 1.1 + k * 2.2;
      // keep clear of the lifeguard chair, the slide, the ladders and the stairs' handrail posts
      if (guard && guard.side === side && Math.abs(guard.s - s) < 1.3) continue;
      if (layout.decor.some((d) => d.kind === 'slide' && d.pool === p.id && d.side === side && s > d.s - 1.4)) continue;
      if (p.ladders.some((ld) => ld.side === side && Math.abs(ld.s - s) < 0.9)) continue;
      if (s < 0.9) continue;
      const t = side < 0 ? -1.15 / across : 1 + 1.15 / across;
      const [x, z] = poolPoint(p, ox, oz, s, t);
      const cl = cellAtLocal(layout, x, z);
      if (!cl || cl.pool || cl.reserved || cl.water) continue;
      // lounger long axis perpendicular to the pool edge, head away from the water
      const rot = p.axis === 'x' ? (side < 0 ? Math.PI : 0) : (side < 0 ? -Math.PI / 2 : Math.PI / 2);
      sp(layout, 'pool_lounger', x, z, rot + rng.range(-0.08, 0.08), { y: 0 });
      if (rng.chance(0.3)) sp(layout, 'towel', x + rng.range(-0.2, 0.2), z + rng.range(-0.2, 0.2), rng.next() * 6, { y: 0.42 });
    }
  }
  // things floating in the water
  const nf = p.kind === 'spa' ? rng.int(0, 1) : rng.int(1, 3);
  for (let k = 0; k < nf; k++) {
    const s = rng.range(0.8, p.L - 0.8), t = rng.range(0.25, 0.75);
    const [x, z] = poolPoint(p, ox, oz, s, t);
    sp(layout, rng.weighted([['pool_ring', 4], ['beach_ball', 2], ['float_mat', 2], ['kickboard', 2], ['pool_noodle', 2], ['rubber_duck', 1]]), x, z, rng.next() * 6.28, { y: WATER_Y - 0.02, float: true });
  }
  // something lost at the bottom
  if (rng.chance(0.35)) {
    const s = rng.range(p.run + 0.5, p.L - 0.6), t = rng.range(0.2, 0.8);
    const [x, z] = poolPoint(p, ox, oz, s, t);
    sp(layout, rng.pick(['almond_water', 'sample_jar', 'battery', 'flashlight', 'medkit']), x, z, rng.next() * 6, { y: poolFloorAt(p, s, t), sunk: true });
  }
  void seed;
}

function cellAtLocal(layout, x, z) {
  const li = Math.floor(x / CELL), lj = Math.floor(z / CELL);
  if (li < 0 || lj < 0 || li >= CHUNK || lj >= CHUNK) return null;
  return layout.cells[lj * CHUNK + li];
}

// ---------------------------------------------------------------------------
// Accessors in GLOBAL cell coords
const floorDiv = (a, b) => Math.floor(a / b);

export function cellInfo(seed, i, j, variantFn) {
  const cx = floorDiv(i, CHUNK), cz = floorDiv(j, CHUNK);
  const l = getLayout(seed, cx, cz, variantFn ? variantFn(cx, cz) : 0);
  return l.cells[(j - cz * CHUNK) * CHUNK + (i - cx * CHUNK)];
}

export function layoutOf(seed, i, j, variantFn) {
  const cx = floorDiv(i, CHUNK), cz = floorDiv(j, CHUNK);
  return getLayout(seed, cx, cz, variantFn ? variantFn(cx, cz) : 0);
}

export function wallN(seed, i, j, variantFn) {
  const cx = floorDiv(i, CHUNK), cz = floorDiv(j, CHUNK);
  const l = getLayout(seed, cx, cz, variantFn ? variantFn(cx, cz) : 0);
  return l.edgesN[(j - cz * CHUNK) * CHUNK + (i - cx * CHUNK)];
}
export function wallW(seed, i, j, variantFn) {
  const cx = floorDiv(i, CHUNK), cz = floorDiv(j, CHUNK);
  const l = getLayout(seed, cx, cz, variantFn ? variantFn(cx, cz) : 0);
  return l.edgesW[(j - cz * CHUNK) * CHUNK + (i - cx * CHUNK)];
}

// Pool stair edge? (the shallow-end boundary of a pool is walkable for the grid nav)
export function poolStairSide(p) {
  // returns 'N','S','E','W' — the boundary side at the stair end
  if (p.kind === 'spa') return '*';
  if (p.axis === 'x') return p.dir > 0 ? 'W' : 'E';
  return p.dir > 0 ? 'N' : 'S';
}

export { floorDiv };
