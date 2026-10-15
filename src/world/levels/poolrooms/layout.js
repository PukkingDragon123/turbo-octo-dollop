// Deterministic layout generation for Level 37 — "The Poolrooms".
// Pure data (no three.js). Same 3 m cell lattice and 8x8-cell chunks as the Yellow Rooms (so the
// shared mission / monster / anomaly / critter systems keep working), with per-cell floor and
// ceiling heights, sunken flooded floors and rectangular pool basins.
//
// The level is one endless flooded waterway running east (+x) from the arrival dock: a chain of
// giant tiled halls (two chunks = 48 m long, 21 m wide, 7.6 m high) along chunk row cz = 0, each
// split by a 12 m wide, 3.6 m deep canal. On foot a hall is a dead end: every hall is sealed from
// the next by a sluice wall that only leaves the canal open, so the team has to take the raft (or
// swim through the dark water) to go forward. The generators wait in plant rooms further ahead.
// Everything outside the band is solid ("void"). Every peer generates identical layouts.
import { hash01, hash3, RNG, valueNoise2 } from '../../../core/rng.js';
import { CELL, CHUNK, CHUNK_M, HEIGHT, W, wallPassable, wallTransmission } from '../yellow/layout.js';

export { CELL, CHUNK, CHUNK_M, HEIGHT, W, wallPassable, wallTransmission };

export const TALL = 4.6;        // natatorium / colonnade ceiling (vault apex)
export const VAULT_SPRING = 3.1; // groin vault springing height (apex = TALL)
export const GIANT = 7.6;       // the giant halls along the waterway
export const PEND_Y = 4.7;      // hanging pendant lamps
export const GATE_Y = 3.7;      // underside of the sluice walls between halls
export const WATER_Y = -0.1;    // base water level (10 cm below the deck)
export const SUNK_Y = -0.2;     // sunken, flooded floors
export const CANAL_Y = -3.6;    // canal floor: too deep to see the bottom
export const T = 0.24;          // wall thickness
export const RISE = 0.1833;     // pool stair riser
export const TREAD = 0.3;       // pool stair tread
// canal rows (chunk-local) of every band chunk: [CANAL_J0, CANAL_J1); row 0 is the north walkway,
// rows 5-7 the south deck (rooms and kiddie pools on rows 6-7)
export const CANAL_J0 = 1, CANAL_J1 = 5;
export const BACK = 6;          // first row of the back of the south deck

export const isBand = (cx, cz) => cz === 0 && cx >= 0;
export const hallOf = (cx) => Math.floor(cx / 2);
export const isGateChunk = (cx) => cx > 0 && cx % 2 === 0;
// canal water bounds (world z), the raft and the goldfish stay inside
export const CANAL_Z0 = CANAL_J0 * CELL, CANAL_Z1 = CANAL_J1 * CELL;
export const CANAL_X0 = 1 * CELL; // the canal head (stairs) in chunk 0

// Generators sit in plant rooms further down the waterway (halls 1-3)
export function missionChunks(seed) {
  const rng = new RNG(hash3(seed, 7, 7, 99));
  const kinds = rng.shuffle(['diesel', 'electric', 'mech']);
  return kinds.map((kind, k) => ({ kind, cx: 3 + k * 2, cz: 0 }));
}

// hall flavour: 'lido' (bright, kept), 'jungle' (overgrown, contaminated), 'dark' (failing lights,
// flooded decks), 'bath' (shower halls, kiddie pools)
export function hallStyle(seed, h) {
  if (h <= 0) return 'lido';
  const r = hash01(h, 3, 17, seed);
  if (h === 1) return r < 0.5 ? 'bath' : 'jungle';
  return r < 0.3 ? 'jungle' : r < 0.55 ? 'dark' : r < 0.8 ? 'bath' : 'lido';
}

// Contaminated water: long stretches of the canal (never the boarding hall), half the kiddie pools
export function canalInfected(seed, i) {
  if (i < 2 * CHUNK) return false;
  const n = valueNoise2(i * 0.07 + (seed % 997), 3.3, 919);
  return n > 0.5;
}

export function zoneAt(seed, i, j) {
  const cx = Math.floor(i / CHUNK), cz = Math.floor(j / CHUNK);
  return isBand(cx, cz) ? 'natatorium' : 'void';
}

const SPECIALS = [
  ['locker_room', 8], ['storage', 9], ['lifeguard_office', 7], ['pump_room', 6], ['yellow_bleed', 3],
  ['dead_clone', 6], ['vending_lonely', 5], ['sinking', 4], ['clipping', 3], ['shower_room', 7],
];

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

function voidCell(li, lj, i, j) {
  return {
    li, lj, i, j, zone: 'void', void: true, floor: 'deck', fy: 0, ceil: GIANT, vault: false, water: false, wet: 0, spill: false,
    light: 0, lightKind: 'panel', lightMode: 'on', lightTone: 0, lightSeed: 0, lightRot: 0, special: null, reserved: true, pool: null, tint: 0,
  };
}

// ---------------------------------------------------------------------------
function generateLayout(seed, cx, cz, variant) {
  const N = CHUNK;
  const i0 = cx * N, j0 = cz * N;
  const cells = [];
  const band = isBand(cx, cz);
  const layout = {
    seed, cx, cz, variant, cells, edgesN: new Uint8Array(N * N), edgesW: new Uint8Array(N * N),
    pillars: [], specials: [], spawns: [], decor: [], vents: [], pools: [],
    drains: [], grilles: [], windows: [], void: !band, gate: band && isGateChunk(cx), hall: hallOf(cx),
    style: band ? hallStyle(seed, hallOf(cx)) : 'void',
  };
  if (!band) {
    for (let lj = 0; lj < N; lj++) for (let li = 0; li < N; li++) cells.push(voidCell(li, lj, i0 + li, j0 + lj));
    // the band's south wall lies on this chunk's first row
    if (cz === 1 && cx >= 0) for (let li = 0; li < N; li++) layout.edgesN[li] = W.FULL;
    return layout;
  }
  const rngFixed = new RNG(hash3(cx, cz, 515, seed));
  const rng = new RNG(hash3(cx, cz, 77, seed));
  const style = layout.style;
  for (let lj = 0; lj < N; lj++) {
    for (let li = 0; li < N; li++) {
      const i = i0 + li, j = j0 + lj;
      cells.push({
        li, lj, i, j, zone: 'natatorium',
        floor: 'deck', fy: 0, ceil: GIANT, vault: false, water: false, wet: 0, spill: false,
        light: 1, lightKind: 'pendant', lightMode: 'on', lightTone: 0, lightSeed: 0, lightRot: 0,
        special: null, reserved: false, pool: null, tint: 0, infected: false,
      });
    }
  }
  const cell = (li, lj) => cells[lj * N + li];
  const { edgesN, edgesW } = layout;

  // --- the hall shell: north + south walls, the sealed west end, sluice walls between halls ---
  for (let li = 0; li < N; li++) edgesN[li] = W.FULL; // north wall (the south wall belongs to chunk cz = 1)
  if (cx === 0) for (let lj = 0; lj < N; lj++) edgesW[lj * N] = W.FULL;
  if (layout.gate) {
    for (let lj = 0; lj < N; lj++) edgesW[lj * N] = lj >= CANAL_J0 && lj < CANAL_J1 ? W.NONE : W.FULL;
  }

  // --- rooms at the back of the south deck (rows 6-7), doors onto the deck walk (row 5) ---
  const mission = missionChunks(seed);
  const gen = mission.find((m) => m.cx === cx && m.cz === cz);
  if (cx === 0) {
    placeRoom(layout, rngFixed, 'spawn', 1, BACK, 2, 2, { doors: 4 });
  } else if (cx === 1) {
    placeRoom(layout, rngFixed, 'workshop', 3, BACK, 2, 2, { doorsAt: [['N', 3], ['N', 4]] });
  } else if (gen) {
    placeRoom(layout, rngFixed, 'gen_' + gen.kind, 3, BACK, 2, 2, { doorsAt: [['N', 3], ['N', 4], ['W', BACK]], arch: true });
  }
  for (const m of mission) {
    // support rooms in the first chunk of the generator's hall
    if (cx !== m.cx - 1) continue;
    if (m.kind === 'diesel') placeRoom(layout, rngFixed, 'fuel_store', 5, BACK + 1, 1, 1, { doorsAt: [['N', 5]] });
    if (m.kind === 'electric') placeRoom(layout, rngFixed, 'fuse_office', 5, BACK + 1, 1, 1, { doorsAt: [['N', 5]] });
  }
  // random special rooms: one in most chunks without a mission room
  if (cx > 1 && !gen && !layout.specials.length && rngFixed.chance(0.75)) {
    const kind = rngFixed.weighted(SPECIALS);
    const big = ['locker_room', 'storage', 'yellow_bleed', 'sinking', 'clipping'].includes(kind);
    const wide = kind === 'pump_room' || kind === 'shower_room';
    if (big) {
      const rx = rngFixed.chance(0.5) ? 1 : 5;
      placeRoom(layout, rngFixed, kind, rx, BACK, 2, 2, { doorsAt: [['N', rx + rngFixed.int(0, 1)]] });
    } else if (wide) {
      const rx = rngFixed.chance(0.5) ? 1 : 5;
      placeRoom(layout, rngFixed, kind, rx, BACK + 1, 2, 1, { doorsAt: [['N', rx + rngFixed.int(0, 1)]] });
    } else {
      const rx = rngFixed.int(1, 6);
      placeRoom(layout, rngFixed, kind, rx, BACK + 1, 1, 1, { doorsAt: [['N', rx]] });
    }
  }

  // --- the canal ---
  const canal = cx === 0
    ? addPool(layout, rngFixed, 'canal', 1, CANAL_J0, N - 1, CANAL_J1 - CANAL_J0, { axis: 'x', dir: 1, openE: true, steps: 7, shallowY: -1.25, flat: 0.9 })
    : addPool(layout, rngFixed, 'canal', 0, CANAL_J0, N, CANAL_J1 - CANAL_J0, { axis: 'x', dir: 1, openW: true, openE: true });
  for (let lj = CANAL_J0; lj < CANAL_J1; lj++) for (let li = canal.rx; li < N; li++) cell(li, lj).infected = canalInfected(seed, i0 + li);
  canal.infected = cells.some((c) => c.pool === canal && c.infected);

  // --- kiddie pools with mushroom fountains and hot tubs on the back deck (a dry ring around) ---
  const free = (li, lj, w, h) => {
    for (let j = lj - 1; j <= lj + h; j++) for (let i = li - 1; i <= li + w; i++) {
      if (i < 0 || i >= N || j >= N) continue;
      const c = cells[j * N + i];
      if (!c || c.reserved || c.pool || c.void) return false;
    }
    return true;
  };
  if (cx > 0 && style !== 'dark') {
    const wantKiddie = style === 'bath' ? 0.9 : style === 'lido' ? 0.55 : 0.6;
    if (rngFixed.chance(wantKiddie)) {
      for (let tries = 0; tries < 8; tries++) {
        const w = rngFixed.int(2, 3), rx = rngFixed.int(1, N - 1 - w);
        if (!free(rx, BACK, w, 1)) continue;
        const p = addPool(layout, rngFixed, 'wading', rx, BACK, w, 1, { axis: 'x', dir: rngFixed.chance(0.5) ? 1 : -1 });
        p.infected = hash01(cx, rx, 313, seed) < (style === 'jungle' ? 0.8 : 0.45);
        for (const c of cells) if (c.pool === p) c.infected = p.infected;
        layout.decor.push({ kind: 'mushroom', pool: p.id, x: (rx + w / 2) * CELL, z: (BACK + 0.5) * CELL, big: w >= 3 });
        break;
      }
    }
    if ((style === 'bath' || style === 'lido') && rngFixed.chance(0.5)) {
      for (let tries = 0; tries < 4; tries++) {
        const rx = rngFixed.int(1, N - 2);
        if (!free(rx, BACK, 1, 1)) continue;
        const p = addPool(layout, rngFixed, 'spa', rx, BACK, 1, 1, {});
        p.infected = hash01(cx, rx, 317, seed) < 0.5;
        for (const c of cells) if (c.pool === p) c.infected = p.infected;
        break;
      }
    }
  }
  // the dark halls have flooded decks (ankle-deep water over the tiles)
  if (style === 'dark') {
    for (const c of cells) {
      if (c.void || c.pool || c.reserved) continue;
      if (c.lj >= CANAL_J1 && hash01(c.i, c.j, 404, seed) < 0.75) { c.floor = 'sunk'; c.fy = SUNK_Y; c.water = true; c.wet = 1; c.infected = canalInfected(seed, c.i); }
    }
  }

  // --- lights ---
  for (const c of cells) assignLight(c, seed, style);

  // --- pillars: a colonnade along the south deck ---
  for (let li = 1; li < N; li++) {
    const lj = BACK;
    const around = [cell(li - 1, lj - 1), cell(li, lj - 1), cell(li - 1, lj), cell(li, lj)];
    if (around.some((c) => c.reserved || c.pool)) continue;
    if ((cx * N + li) % 2 === 0) layout.pillars.push({ li, lj, size: 0.7, kind: 'square' });
  }

  // --- wetness ---
  for (const c of cells) {
    if (c.void || c.water) continue;
    let near = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const o = cells[(c.lj + dj) * N + c.li + di];
      if (o && Math.abs(di) + Math.abs(dj) && o.water && c.li + di >= 0 && c.li + di < N) near = 1;
    }
    c.wet = near ? 0.6 : hash01(c.i, c.j, 12, seed) < 0.25 ? 0.4 : 0.15;
    if (style === 'jungle') c.wet = Math.max(c.wet, 0.5);
  }

  // --- decor & detail positions ---
  placeDetails(layout, rng, seed);

  // --- prop spawns ---
  for (const c of cells) if (!c.void && (!c.reserved || c.special?.kind === 'spawn')) spawnZoneProps(layout, c, rng, seed);
  for (const p of layout.pools) spawnPoolProps(layout, p, rngFixed, seed);
  void variant;
  return layout;
}

// Enclosed room over cells [rx..rx+w-1]x[rz..rz+h-1] (chunk-local)
// opts.doorsAt: [[side, index]] (side N/S use the column index, W/E the row index)
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
  const open = kind === 'spawn' ? W.ARCH : opts.arch || kind === 'workshop' ? W.ARCH : W.DOOR;
  if (kind === 'spawn') {
    for (const b of boundary) if (b.side !== 'S') { (b.arr === 'N' ? edgesN : edgesW)[b.idx] = W.ARCH; room.doors.push(b); }
  } else if (opts.doorsAt) {
    for (const [side, k] of opts.doorsAt) {
      const b = boundary.find((q) => q.side === side && (side === 'N' || side === 'S' ? q.i === k : q.j === k));
      if (!b) continue;
      (b.arr === 'N' ? edgesN : edgesW)[b.idx] = open;
      room.doors.push(b);
    }
  }
  for (let j = rz; j < rz + h; j++) for (let i = rx; i < rx + w; i++) {
    const c = cells[j * N + i];
    if (kind.startsWith('gen_') || kind === 'workshop' || kind === 'fuel_store' || kind === 'pump_room') { c.lightTone = 2; c.roomStyle = 'plant'; }
    if (kind === 'yellow_bleed') { c.lightTone = 3; c.roomStyle = 'yellow'; }
    if (kind === 'fuse_office' || kind === 'lifeguard_office') c.lightTone = 1;
    if (kind === 'dead_clone') c.lightMode = 'flicker';
    if (kind === 'locker_room' || kind === 'shower_room') c.roomStyle = 'locker';
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
  canal: { shallowY: CANAL_Y, deepY: CANAL_Y, steps: 0 },
};

function addPool(layout, rng, kind, rx, rz, w, h, o = {}) {
  const N = CHUNK;
  const K = { ...POOL_KINDS[kind] };
  if (o.steps !== undefined) K.steps = o.steps;
  if (o.shallowY !== undefined) K.shallowY = o.shallowY;
  const axis = o.axis || (w >= h ? 'x' : 'z');
  const dir = o.dir || (rng.chance(0.5) ? 1 : -1);
  const L = (axis === 'x' ? w : h) * CELL; // length along the axis
  const run = Math.max(0, K.steps - 1) * TREAD;
  const canal = kind === 'canal';
  const pool = {
    id: layout.pools.length, kind, rx, rz, w, h, axis, dir, L, room: !!o.room,
    shallowY: K.shallowY, deepY: K.deepY, steps: K.steps, run,
    flat: o.flat ?? (kind === 'deep' ? Math.min(2.2, L * 0.25) : L), // shallow flat after the stairs
    deepFlat: kind === 'deep' ? Math.min(2.4, L * 0.25) : 0,
    ladders: [], lights: [], rope: null, lanes: [], drains: [], bench: kind === 'spa',
    lightsOn: hash01(layout.cx * 7 + rx, layout.cz * 5 + rz, 91, layout.seed) < (canal ? 0.7 : 0.85),
    tile: kind === 'spa' ? 1 : kind === 'wading' ? 2 : 0,
    openW: !!o.openW, openE: !!o.openE, infected: false,
  };
  if (canal && o.flat !== undefined) pool.deepFlat = Math.max(0, L - run - pool.flat - 6.5);
  pool.slopeLen = Math.max(0.01, L - pool.run - pool.flat - pool.deepFlat);
  if (canal && o.flat === undefined) { pool.flat = L; pool.slopeLen = 0.01; }
  for (let j = rz; j < rz + h; j++) for (let i = rx; i < rx + w; i++) {
    const c = layout.cells[j * N + i];
    c.pool = pool;
    c.floor = 'pool';
    c.water = true;
    c.wet = 1;
    c.vault = false;
  }
  const across = (axis === 'x' ? h : w) * CELL;
  if (canal) {
    // underwater lamps along both walls (many dead), ladders out of the water every ~12 m
    for (let s = (pool.steps ? pool.run + 1.6 : 1.3); s < L - 0.4; s += 3.0) {
      pool.lights.push({ s, side: -1, on: hash01(layout.cx * 31 + Math.round(s * 10), 1, 93, layout.seed) < 0.55 });
      pool.lights.push({ s: s + 1.5 < L ? s + 1.5 : s, side: 1, on: hash01(layout.cx * 31 + Math.round(s * 10), 2, 93, layout.seed) < 0.55 });
    }
    pool.ladders.push({ s: L * 0.3 + (layout.cx % 2) * 2.1, side: -1 });
    pool.ladders.push({ s: L * 0.75 - (layout.cx % 2) * 1.8, side: 1 });
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
  } else if (kind === 'spa') {
    pool.lights.push({ s: L * 0.5, side: 1 });
    pool.drains.push({ s: L * 0.5, t: 0.5 });
  }
  layout.pools.push(pool);
  return pool;
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
function assignLight(c, seed, style) {
  if (c.void) { c.light = 0; return; }
  const h = hash01(c.i, c.j, 31, seed);
  const h2 = hash01(c.i, c.j, 32, seed);
  c.lightSeed = h2;
  c.lightRot = (c.i + c.j) % 2;
  if (c.reserved && c.special) {
    c.light = 1;
    c.lightKind = 'panel';
  } else if (c.pool && c.pool.kind === 'canal') {
    // skylights high over the water alternate with pendant lamps hanging on long rods
    const sky = c.i % 2 === 0 && (c.lj === 2 || c.lj === 3) && c.lj % 2 === (c.i / 2) % 2;
    if (sky) { c.light = style === 'dark' ? (h < 0.5 ? 1 : 0) : 1; c.lightKind = 'sky'; } else { c.light = h < (style === 'dark' ? 0.2 : 0.32) ? 1 : 0; c.lightKind = 'pendant'; }
  } else {
    c.light = (c.i % 2 === 1 && (c.lj === 0 || c.lj === 5 || c.lj === 7)) || h < 0.12 ? 1 : 0;
    c.lightKind = 'pendant';
  }
  if (style === 'dark') {
    c.lightTone = 6;
    if (h2 < 0.3) c.lightMode = 'dead';
    else if (h2 < 0.45) c.lightMode = 'flicker';
    else if (h2 < 0.5) c.lightMode = 'buzz';
  } else if (!c.reserved) {
    if (h2 < 0.06) c.lightMode = 'dead';
    else if (h2 < 0.11) c.lightMode = 'flicker';
    else if (h2 < 0.14) c.lightMode = 'buzz';
    if (style === 'jungle') c.lightTone = 6;
  }
  if (c.lightKind === 'sky') { c.lightTone = 5; if (c.lightMode !== 'dead') c.lightMode = 'on'; }
  else if (c.lightKind === 'pendant' && c.lightTone === 0) c.lightTone = 7;
}

// ---------------------------------------------------------------------------
// Static details: drains, wall grilles (critter exits), porthole windows, slides, lifeguard chairs,
// shower banks, plants, vines and algae mats
function placeDetails(layout, rng, seed) {
  const N = CHUNK;
  const { cells, edgesN, edgesW } = layout;
  const style = layout.style;
  for (const c of cells) {
    if (c.void || c.pool || c.water) continue;
    if (c.reserved && c.special?.kind !== 'spawn') continue;
    const h = hash01(c.i, c.j, 71, seed);
    if (h < (c.wet > 0.4 ? 0.2 : 0.08) && c.special?.kind !== 'spawn') {
      layout.drains.push({ li: c.li, lj: c.lj, x: c.li * CELL + 0.6 + hash01(c.i, c.j, 72, seed) * 1.8, z: c.lj * CELL + 0.6 + hash01(c.i, c.j, 73, seed) * 1.8 });
    }
  }
  for (const room of layout.specials) {
    if (room.kind !== 'pump_room' && room.kind !== 'workshop') continue;
    const li = room.rx + room.w - 1, lj = room.rz + room.h - 1;
    layout.drains.push({ li, lj, x: li * CELL + 1.0, z: lj * CELL + 1.0 });
  }
  // high porthole windows on the giant walls, glowing; low grilles
  for (let lj = 0; lj < N; lj++) for (let li = 0; li < N; li++) {
    const c = cells[lj * N + li];
    for (const side of ['N', 'W']) {
      const t = (side === 'N' ? edgesN : edgesW)[lj * N + li];
      if (t !== W.FULL) continue;
      const o = side === 'N' ? cells[(lj - 1) * N + li] : cells[lj * N + li - 1];
      if (c.void && (!o || o.void)) continue;
      const h = hash01(c.i * 2 + (side === 'N' ? 1 : 0), c.j, 74, seed);
      const tall = Math.max(c.ceil, o ? o.ceil : 0) > HEIGHT + 0.1;
      if (h < (tall ? 0.5 : 0.14)) layout.windows.push({ li, lj, side, n: tall ? 3 : (h < 0.05 ? 2 : 1), high: tall });
      else if (h > 0.9 && !c.special && !c.void) layout.grilles.push({ li, lj, side });
    }
  }
  const canal = layout.pools.find((p) => p.kind === 'canal');
  const hall = layout.hall;
  // north walkway: a bank of showers against the wall, or a tube slide plunging into the canal
  const ox = layout.cx * N;
  const showerP = style === 'bath' ? 0.75 : style === 'lido' ? 0.35 : 0.2;
  if (layout.cx > 0 && canal) {
    const slideHere = hash01(hall, layout.cx, 83, seed) < (layout.cx % 2 ? 0.55 : 0.25);
    if (slideHere) layout.decor.push({ kind: 'slide', pool: canal.id, s: Math.min(canal.L - 3.2, 5 + hash01(hall, 1, 84, seed) * 12), side: -1 });
    const slide = layout.decor.find((d) => d.kind === 'slide');
    for (let li = 0; li < N; li++) {
      const c = cells[li];
      if (c.reserved || c.pool) continue;
      const x = (ox + li) * CELL;
      if (slide && Math.abs(x + CELL / 2 - (ox * CELL + canal.rx * CELL + slide.s)) < 4.5) continue;
      if (hash01(c.i, 0, 85, seed) < showerP) layout.decor.push({ kind: 'showers', li, x: x + CELL / 2 });
    }
  }
  // lifeguard chair on the south deck (where no room stands)
  if (canal && layout.cx > 0) {
    const s = 3 + hash01(hall, layout.cx, 86, seed) * (canal.L - 6);
    const li = Math.floor((canal.rx * CELL + s) / CELL);
    const c = cells[CANAL_J1 * N + li];
    if (c && !c.reserved && !c.pool && hash01(hall, layout.cx, 87, seed) < 0.6) layout.decor.push({ kind: 'lifeguard', pool: canal.id, s, side: 1 });
  }
  // plants: potted palms gone wild, ferns along the coping, vines hanging down the giant walls
  const plantP = style === 'jungle' ? 0.9 : style === 'bath' ? 0.35 : style === 'dark' ? 0.25 : 0.45;
  for (const c of cells) {
    if (c.void || c.pool || c.reserved) continue;
    const h = hash01(c.i, c.j, 88, seed);
    if (h > plantP) continue;
    const jx = hash01(c.i, c.j, 89, seed), jz = hash01(c.i, c.j, 90, seed);
    if (c.lj === 0) {
      // against the north wall
      if (layout.decor.some((d) => d.kind === 'showers' && d.li === c.li)) continue;
      layout.decor.push({ kind: jx < 0.5 ? 'palm' : 'fern', x: (c.i + 0.3 + jx * 0.4) * CELL, z: c.j * CELL + 0.55, s: 0.8 + jz * 0.6 });
    } else if (c.lj === N - 1) {
      layout.decor.push({ kind: jx < 0.6 ? 'palm' : 'monstera', x: (c.i + 0.25 + jx * 0.5) * CELL, z: (c.j + 1) * CELL - 0.6, s: 0.8 + jz * 0.7 });
    } else if (c.lj === CANAL_J1) {
      // ferns spilling over the coping
      layout.decor.push({ kind: 'fern', x: (c.i + 0.2 + jx * 0.6) * CELL, z: c.j * CELL + 0.75, s: 0.6 + jz * 0.5 });
    }
  }
  const vineP = style === 'jungle' ? 0.85 : style === 'dark' ? 0.5 : 0.3;
  for (let li = 0; li < N; li++) {
    for (const lj of [0, N - 1]) {
      const c = cells[lj * N + li];
      if (c.void || c.reserved) continue;
      if (hash01(c.i, c.j, 91, seed) < vineP) layout.decor.push({ kind: 'vines', x: (c.i + 0.5) * CELL, z: lj === 0 ? c.j * CELL + T / 2 + 0.02 : (c.j + 1) * CELL - T / 2 - 0.02, n: lj === 0 ? 1 : -1, len: 2.5 + hash01(c.i, c.j, 92, seed) * 4.5 });
    }
  }
  // algae mats drifting on the water (denser on contaminated stretches and in the jungle halls)
  for (const p of layout.pools) {
    if (p.kind === 'spa') continue;
    const dens = (p.infected ? 1.6 : 1) * (style === 'jungle' ? 1.6 : style === 'lido' ? 0.6 : 1);
    const n = Math.round((p.kind === 'canal' ? 26 : 8) * dens);
    for (let k = 0; k < n; k++) {
      const s = rng.range(0.3, p.L - 0.3);
      // most of it clings to the walls
      const edge = rng.chance(0.7);
      const t = edge ? (rng.chance(0.5) ? rng.range(0.0, 0.1) : rng.range(0.9, 1.0)) : rng.range(0.1, 0.9);
      layout.decor.push({ kind: 'algae', pool: p.id, s, t, r: rng.range(0.25, edge ? 0.9 : 0.6), rot: rng.next() * 6.28 });
    }
  }
  void rng;
}

// ---------------------------------------------------------------------------
// Prop spawns. Positions in chunk-local meters (x,z from chunk origin), y = floor height.
function sp(layout, type, x, z, rotY = 0, extra = {}) {
  layout.spawns.push({ type, x, z, rotY, ...extra });
}

const LOOT_RARE = [['almond_water', 7], ['protein_bar', 3], ['chips', 2], ['soda_can', 3], ['energy_drink', 2], ['bandage', 3], ['battery', 3], ['glowstick', 2], ['sample_jar', 3], ['canned_food', 2], ['painkillers', 1], ['candy_bar', 2], ['flare', 1], ['medkit', 0.6], ['antibiotics', 0.9], ['flashlight', 0.6], ['multitool', 0.6], ['screws', 1], ['fabric_scrap', 2], ['wire_spool', 1], ['tape_roll', 1], ['water_tester', 0.7]];

function spawnZoneProps(layout, c, rng, seed) {
  if (c.pool || c.void) return;
  const x0 = c.li * CELL, z0 = c.lj * CELL;
  const cx = x0 + CELL / 2, cz = z0 + CELL / 2;
  const r = () => rng.range(-0.75, 0.75);
  const h = hash01(c.i, c.j, 61, seed);
  const y = c.fy;
  if (c.special?.kind === 'spawn') return;
  if (c.floor === 'sunk') {
    if (h < 0.12) sp(layout, rng.pick(['pool_ring', 'kickboard', 'pool_noodle', 'rubber_duck', 'beach_ball', 'float_mat']), cx + r(), cz + r(), rng.next() * 6.28, { y: WATER_Y - 0.02, float: true });
    else if (h < 0.16) sp(layout, rng.pick(['pool_chair', 'bucket', 'wet_floor_sign']), cx + r(), cz + r(), rng.next() * 6.28, { y });
  } else if (c.lj === 0) {
    if (h < 0.1) sp(layout, rng.pick(['towel', 'kickboard', 'bucket', 'wet_floor_sign', 'mop']), cx + r(), cz + r() * 0.4, rng.next() * 6.28, { y });
  } else {
    if (h < 0.08) sp(layout, 'pool_chair', cx + r(), cz + r(), rng.next() * 6.28, { y });
    else if (h < 0.11) sp(layout, rng.pick(['kickboard', 'wet_floor_sign', 'pool_noodle', 'towel', 'bucket']), cx + r(), cz + r(), rng.next() * 6.28, { y });
    else if (h < 0.13) sp(layout, rng.pick(['table_folding', 'step_ladder', 'water_jug']), cx + r() * 0.5, cz + r() * 0.5, rng.next() * 6.28, { y });
  }
  if (hash01(c.i, c.j, 62, seed) < 0.06) sp(layout, rng.weighted(LOOT_RARE), cx + r(), cz + r(), rng.next() * 6.28, { y });
}

function spawnPoolProps(layout, p, rng, seed) {
  const ox = 0, oz = 0;
  if (p.kind === 'canal') {
    // a row of loungers on the south deck, facing the water
    const n = Math.floor(p.L / 2.2);
    const guard = layout.decor.find((d) => d.kind === 'lifeguard' && d.pool === p.id);
    for (let k = 0; k < n; k++) {
      if (!rng.chance(layout.style === 'lido' ? 0.65 : 0.35)) continue;
      const s = 1.1 + k * 2.2;
      if (guard && Math.abs(guard.s - s) < 1.4) continue;
      if (p.ladders.some((ld) => ld.side === 1 && Math.abs(ld.s - s) < 1.0)) continue;
      const [x, z] = poolPoint(p, ox, oz, s, 1 + 1.25 / ((p.h) * CELL));
      const cl = cellAtLocal(layout, x, z);
      if (!cl || cl.pool || cl.reserved || cl.water || cl.void) continue;
      sp(layout, 'pool_lounger', x, z, Math.PI / 2 + rng.range(-0.1, 0.1), { y: 0 });
      if (rng.chance(0.25)) sp(layout, 'towel', x + rng.range(-0.2, 0.2), z + rng.range(-0.2, 0.2), rng.next() * 6, { y: 0.42 });
    }
  } else if (p.kind === 'wading') {
    for (let k = 0; k < 2; k++) {
      if (!rng.chance(0.5)) continue;
      const [x, z] = poolPoint(p, ox, oz, rng.range(0.5, p.L - 0.5), rng.chance(0.5) ? -0.12 : 1.12);
      const cl = cellAtLocal(layout, x, z);
      if (cl && !cl.pool && !cl.reserved && !cl.void) sp(layout, 'pool_chair', x, z, rng.next() * 6, { y: 0 });
    }
  }
  // things floating in the water
  const nf = p.kind === 'spa' ? rng.int(0, 1) : p.kind === 'canal' ? rng.int(1, 3) : rng.int(1, 2);
  for (let k = 0; k < nf; k++) {
    const s = rng.range(0.8, p.L - 0.8), t = rng.range(0.25, 0.75);
    const [x, z] = poolPoint(p, ox, oz, s, t);
    sp(layout, rng.weighted([['pool_ring', 4], ['beach_ball', 2], ['float_mat', 2], ['kickboard', 2], ['pool_noodle', 2], ['rubber_duck', 1]]), x, z, rng.next() * 6.28, { y: WATER_Y - 0.02, float: true });
  }
  // something lost at the bottom of the shallow pools
  if (p.kind !== 'canal' && rng.chance(0.4)) {
    const s = rng.range(p.run + 0.5, p.L - 0.6), t = rng.range(0.2, 0.8);
    const [x, z] = poolPoint(p, ox, oz, s, t);
    sp(layout, rng.pick(['almond_water', 'sample_jar', 'battery', 'antibiotics', 'medkit']), x, z, rng.next() * 6, { y: poolFloorAt(p, s, t), sunk: true });
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
  // returns 'N','S','E','W' — the boundary side at the stair end; '' = no walkable edge
  if (p.kind === 'spa' || p.kind === 'wading') return '*';
  if (p.kind === 'canal') return '';
  if (p.axis === 'x') return p.dir > 0 ? 'W' : 'E';
  return p.dir > 0 ? 'N' : 'S';
}

export { floorDiv };
