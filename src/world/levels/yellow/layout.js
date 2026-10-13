// Deterministic layout generation for Level 0 — "The Yellow Rooms".
// Pure data (no three.js): walls on a 3 m cell grid, zones, lights, special rooms, prop spawns.
// Every peer generates identical layouts from (seed, chunk, variant).
import { hash01, hash3, RNG, valueNoise2 } from '../../../core/rng.js';

export const CELL = 3.0;
export const CHUNK = 8; // cells per chunk side
export const CHUNK_M = CELL * CHUNK;
export const HEIGHT = 2.9;

// wall types on edges
export const W = { NONE: 0, FULL: 1, DOOR: 2, ARCH: 3, HALF_A: 4, HALF_B: 5, LOW: 6, WINDOW: 7 };

export const ZONES = ['halls', 'office', 'maintenance', 'flooded', 'pillars', 'dark', 'manila'];

const WALL_P = { halls: 0.36, office: 0.42, maintenance: 0.5, flooded: 0.3, pillars: 0.05, dark: 0.36, manila: 0.4 };

export function zoneAt(seed, i, j) {
  // continuous noise fields -> zone; spawn area forced to halls
  if (Math.abs(i - 4) <= 5 && Math.abs(j - 4) <= 5) return 'halls';
  const s = seed % 10000;
  const nOffice = valueNoise2(i * 0.11 + s, j * 0.11, 101);
  const nMaint = valueNoise2(i * 0.09, j * 0.09 + s, 202);
  const nFlood = valueNoise2(i * 0.1 + 33 + s, j * 0.1 - 17, 303);
  const nPill = valueNoise2(i * 0.12 - s, j * 0.12 + 9, 404);
  const nDark = valueNoise2(i * 0.08 + 5, j * 0.08 - s, 505);
  const nManila = valueNoise2(i * 0.14 + 77, j * 0.14 + s, 606);
  if (nMaint > 0.74) return 'maintenance';
  if (nFlood > 0.75) return 'flooded';
  if (nDark > 0.76) return 'dark';
  if (nOffice > 0.7) return 'office';
  if (nPill > 0.74) return 'pillars';
  if (nManila > 0.84) return 'manila';
  return 'halls';
}

// Mission: three generator rooms, deterministic from seed. Returns [{kind, cx, cz}]
export function missionChunks(seed) {
  const rng = new RNG(hash3(seed, 7, 7, 99));
  const a0 = rng.next() * Math.PI * 2;
  const kinds = rng.shuffle(['diesel', 'electric', 'mech']);
  const out = [];
  for (let k = 0; k < 3; k++) {
    const a = a0 + (k * Math.PI * 2) / 3 + rng.range(-0.3, 0.3);
    const R = rng.range(2.2, 3.1);
    out.push({ kind: kinds[k], cx: Math.round(Math.cos(a) * R), cz: Math.round(Math.sin(a) * R) });
  }
  return out;
}

const SPECIALS = [
  ['chairpile', 10], ['office_room', 10], ['bedroom', 6], ['tv_room', 6], ['storage', 9], ['clipping', 7],
  ['sinking', 6], ['manila_room', 4], ['endless_hall', 5], ['poolrooms_glimpse', 3], ['red_chair', 4],
  ['stairs_nowhere', 4], ['many_doors', 3], ['vent_room', 6], ['vending_lonely', 4], ['workshop', 6],
  ['cubicle_farm', 6], ['dead_clone', 6],
];

function specialSize(kind) {
  switch (kind) {
    case 'endless_hall': return [6, 1];
    case 'chairpile': return [2, 2];
    case 'cubicle_farm': return [3, 2];
    case 'poolrooms_glimpse': return [2, 2];
    case 'storage': return [2, 2];
    case 'workshop': return [2, 2];
    case 'vent_room': return [2, 1];
    default: return [1 + (kind.length % 2), 1 + ((kind.length >> 1) % 2)];
  }
}

// numeric-key cache (no string allocation: this is hit millions of times while baking light)
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

function generateLayout(seed, cx, cz, variant) {
  const N = CHUNK;
  const rng = new RNG(hash3(cx, cz, variant, seed));
  const i0 = cx * N, j0 = cz * N;
  const cells = [];
  for (let lj = 0; lj < N; lj++) {
    for (let li = 0; li < N; li++) {
      const i = i0 + li, j = j0 + lj;
      const zone = zoneAt(seed, i, j);
      cells.push({
        li, lj, i, j, zone,
        light: 1, // 0 none, 1 panel
        lightMode: 'on',
        lightTone: 0,
        floor: zone === 'maintenance' ? 'concrete' : 'carpet',
        water: zone === 'flooded' && hash01(i, j, 11, seed) < 0.85,
        wet: zone === 'flooded' ? 1 : (hash01(i, j, 12, seed) < 0.06 ? 0.6 : 0),
        hole: hash01(i, j, 13, seed) < 0.03,
        special: null,
        reserved: false,
      });
    }
  }
  const cell = (li, lj) => cells[lj * N + li];
  const edgesN = new Uint8Array(N * N);
  const edgesW = new Uint8Array(N * N);

  // --- base walls ---
  for (let lj = 0; lj < N; lj++) {
    for (let li = 0; li < N; li++) {
      const c = cell(li, lj);
      const i = c.i, j = c.j;
      // north edge: between (i, j-1) and (i, j)
      const zN = zoneAt(seed, i, j - 1);
      const pN = Math.max(WALL_P[c.zone], WALL_P[zN]) + (c.zone !== zN && (c.zone === 'maintenance' || zN === 'maintenance') ? 0.35 : 0);
      edgesN[lj * N + li] = pickWall(hash01(i, j, 21 + variant * 7, seed), hash01(i, j, 22 + variant * 7, seed), pN);
      const zW = zoneAt(seed, i - 1, j);
      const pW = Math.max(WALL_P[c.zone], WALL_P[zW]) + (c.zone !== zW && (c.zone === 'maintenance' || zW === 'maintenance') ? 0.35 : 0);
      edgesW[lj * N + li] = pickWall(hash01(i, j, 23 + variant * 7, seed), hash01(i, j, 24 + variant * 7, seed), pW);
    }
  }

  // --- lights ---
  for (const c of cells) {
    const h = hash01(c.i, c.j, 31, seed);
    if (c.zone === 'pillars') c.light = 1;
    else if (c.zone === 'maintenance') c.light = h < 0.55 ? 1 : 0;
    else c.light = h < 0.86 ? 1 : 0;
    const h2 = hash01(c.i, c.j, 32, seed);
    c.lightSeed = h2;
    if (c.zone === 'dark') c.lightMode = h2 < 0.82 ? 'dead' : 'flicker';
    else if (h2 < 0.045) c.lightMode = 'dead';
    else if (h2 < 0.1) c.lightMode = 'flicker';
    else if (h2 < 0.14) c.lightMode = 'buzz';
    c.lightTone = c.zone === 'maintenance' ? 2 : c.zone === 'office' ? 1 : c.zone === 'manila' ? 3 : 0;
    c.lightRot = (c.i + c.j) % 2;
  }

  const layout = { seed, cx, cz, variant, cells, edgesN, edgesW, pillars: [], specials: [], spawns: [], decor: [], vents: [] };

  // --- mission / fixed rooms ---
  const mission = missionChunks(seed);
  const isSpawn = cx === 0 && cz === 0;
  const gen = mission.find((m) => m.cx === cx && m.cz === cz);
  if (isSpawn) placeRoom(layout, rng, 'spawn', 3, 3, 2, 2, { doors: 4 });
  else if (gen) placeRoom(layout, rng, 'gen_' + gen.kind, 3, 3, 2, 2, { doors: 2 });
  // generator support items: fuel can / fuse are placed in a neighbouring chunk of their generator
  for (const m of mission) {
    if (m.kind === 'diesel' && cx === m.cx + 1 && cz === m.cz) placeRoom(layout, rng, 'fuel_store', 2, 5, 1, 1, { doors: 1 });
    if (m.kind === 'electric' && cx === m.cx && cz === m.cz + 1) placeRoom(layout, rng, 'fuse_office', 5, 2, 1, 1, { doors: 1 });
  }
  if (cx === 0 && cz === 1) placeRoom(layout, rng, 'workshop', 2, 2, 2, 2, { doors: 2 });

  // --- random special room ---
  if (!isSpawn && !gen && rng.chance(0.62)) {
    const kind = rng.weighted(SPECIALS);
    const [w, h] = specialSize(kind);
    const rx = rng.int(1, N - 1 - w), rz = rng.int(1, N - 1 - h);
    if (canPlace(layout, rx, rz, w, h)) placeRoom(layout, rng, kind, rx, rz, w, h, { doors: kind === 'endless_hall' ? 0 : rng.int(1, 2) });
  }

  // --- pillars ---
  for (let lj = 0; lj < N; lj++) {
    for (let li = 0; li < N; li++) {
      const c = cell(li, lj);
      if (c.reserved) continue;
      if (c.zone === 'pillars' && (c.i + c.j) % 2 === 0 && hash01(c.i, c.j, 41, seed) < 0.8) layout.pillars.push({ li, lj, size: 0.7 });
      else if (c.zone === 'halls' && hash01(c.i, c.j, 42, seed) < 0.035) layout.pillars.push({ li, lj, size: 0.5 });
    }
  }

  // ensure no cell is fully closed (open one random edge)
  for (let lj = 0; lj < N - 1; lj++) {
    for (let li = 0; li < N - 1; li++) {
      const c = cell(li, lj);
      if (c.reserved) continue;
      const n = edgesN[lj * N + li], w = edgesW[lj * N + li];
      const s = edgesN[(lj + 1) * N + li], e = edgesW[lj * N + li + 1];
      const closed = [n, w, s, e].filter((x) => x === W.FULL).length;
      if (closed === 4) {
        const k = Math.floor(hash01(c.i, c.j, 51, seed) * 4);
        if (k === 0) edgesN[lj * N + li] = W.DOOR;
        else if (k === 1) edgesW[lj * N + li] = W.DOOR;
        else if (k === 2 && !cell(li, lj + 1).reserved) edgesN[(lj + 1) * N + li] = W.DOOR;
        else if (!cell(li + 1, lj).reserved) edgesW[lj * N + li + 1] = W.ARCH;
      }
    }
  }

  // --- generic prop spawns per cell ---
  for (const c of cells) {
    if (c.reserved) continue;
    spawnZoneProps(layout, c, rng, seed);
  }

  // --- wall vents (critter escape points) ---
  for (let k = 0; k < 3; k++) {
    const li = rng.int(0, N - 1), lj = rng.int(0, N - 1);
    const idx = lj * N + li;
    if (edgesN[idx] === W.FULL) layout.vents.push({ li, lj, side: 'N' });
    else if (edgesW[idx] === W.FULL) layout.vents.push({ li, lj, side: 'W' });
  }
  return layout;
}

function pickWall(h, h2, p) {
  if (h >= p) return W.NONE;
  if (h2 < 0.52) return W.FULL;
  if (h2 < 0.68) return W.DOOR;
  if (h2 < 0.78) return W.ARCH;
  if (h2 < 0.87) return W.HALF_A;
  if (h2 < 0.96) return W.HALF_B;
  return W.LOW;
}

function canPlace(layout, rx, rz, w, h) {
  for (let j = rz; j < rz + h; j++) for (let i = rx; i < rx + w; i++) {
    if (layout.cells[j * CHUNK + i].reserved) return false;
  }
  return true;
}

// Make an enclosed room over cells [rx..rx+w-1]x[rz..rz+h-1] (chunk-local; must stay within 0..7 with east/south edge <= 7)
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
      c.hole = false;
      c.wet = 0;
      c.light = 1;
      c.lightMode = 'on';
      if (i > rx) edgesW[j * N + i] = W.NONE;
      if (j > rz) edgesN[j * N + i] = W.NONE;
    }
  }
  // boundary walls
  const boundary = [];
  for (let i = rx; i < rx + w; i++) {
    boundary.push({ arr: 'N', idx: rz * N + i, side: 'N', i });
    if (rz + h < N) boundary.push({ arr: 'N', idx: (rz + h) * N + i, side: 'S', i });
  }
  for (let j = rz; j < rz + h; j++) {
    boundary.push({ arr: 'W', idx: j * N + rx, side: 'W', j });
    if (rx + w < N) boundary.push({ arr: 'W', idx: j * N + rx + w, side: 'E', j });
  }
  const open = kind === 'spawn' ? W.ARCH : W.FULL;
  for (const b of boundary) (b.arr === 'N' ? edgesN : edgesW)[b.idx] = open;
  if (kind !== 'spawn') {
    const nd = opts.doors ?? 1;
    const choices = rng.shuffle(boundary.slice());
    for (let d = 0; d < Math.min(nd, choices.length); d++) {
      const b = choices[d];
      (b.arr === 'N' ? edgesN : edgesW)[b.idx] = kind.startsWith('gen_') || kind === 'workshop' ? W.ARCH : W.DOOR;
      room.doors.push(b);
    }
    if (kind === 'endless_hall') {
      // open both short ends
      edgesW[rz * N + rx] = W.ARCH;
      if (rx + w < N) edgesW[rz * N + rx + w] = W.ARCH;
    }
  } else {
    // spawn room: wide open arches all around
    for (const b of boundary) (b.arr === 'N' ? edgesN : edgesW)[b.idx] = rng.chance(0.5) ? W.NONE : W.ARCH;
  }
  // zone styling inside
  for (let j = rz; j < rz + h; j++) for (let i = rx; i < rx + w; i++) {
    const c = cells[j * N + i];
    if (kind.startsWith('gen_') || kind === 'workshop' || kind === 'fuel_store' || kind === 'vent_room') { c.floor = 'concrete'; c.lightTone = 2; c.roomStyle = 'concrete'; }
    if (kind === 'manila_room') { c.lightTone = 3; c.roomStyle = 'manila'; }
    if (kind === 'red_chair') { c.lightTone = 4; }
    if (kind === 'poolrooms_glimpse') { c.roomStyle = 'pool'; c.floor = 'tile'; c.lightTone = 5; }
    if (kind === 'office_room' || kind === 'fuse_office' || kind === 'cubicle_farm') c.lightTone = 1;
    if (kind === 'dead_clone') { c.lightMode = 'flicker'; }
    if (kind === 'endless_hall') { c.lightMode = 'on'; c.light = 1; c.lightSeed = 0.5; c.lightRot = 0; }
  }
  layout.specials.push(room);
  return room;
}

// ---------------------------------------------------------------------------
// Prop spawns. Positions in chunk-local meters (x,z from chunk origin), y from floor.
function sp(layout, type, x, z, rotY = 0, extra = {}) {
  layout.spawns.push({ type, x, z, rotY, ...extra });
}

const LOOT_RARE = [['almond_water', 6], ['protein_bar', 3], ['chips', 3], ['soda_can', 3], ['energy_drink', 2], ['bandage', 3], ['battery', 3], ['glowstick', 2], ['sample_jar', 3], ['canned_food', 2], ['painkillers', 1], ['candy_bar', 2], ['flare', 1], ['medkit', 0.6], ['antibiotics', 0.6], ['flashlight', 0.6], ['multitool', 0.6], ['screws', 2], ['plank', 2], ['fabric_scrap', 2], ['metal_scrap', 2], ['wire_spool', 1]];

function spawnZoneProps(layout, c, rng, seed) {
  const x0 = c.li * CELL, z0 = c.lj * CELL;
  const cx = x0 + CELL / 2, cz = z0 + CELL / 2;
  const r = () => rng.range(-0.75, 0.75);
  const h = hash01(c.i, c.j, 61, seed);
  switch (c.zone) {
    case 'halls':
    case 'dark':
    case 'manila': {
      if (h < 0.05) sp(layout, rng.pick(['chair_wood', 'chair_wood', 'chair_folding', 'box_small', 'box_medium', 'trash_can', 'wet_floor_sign', 'traffic_cone', 'paper_stack', 'bucket']), cx + r(), cz + r(), rng.next() * 6.28);
      else if (h < 0.07) sp(layout, rng.pick(['table_folding', 'chair_office', 'box_large', 'water_jug', 'step_ladder']), cx + r() * 0.5, cz + r() * 0.5, rng.next() * 6.28);
      if (hash01(c.i, c.j, 62, seed) < (c.zone === 'dark' ? 0.06 : 0.03)) sp(layout, rng.weighted(LOOT_RARE), cx + r(), cz + r(), rng.next() * 6.28);
      break;
    }
    case 'office': {
      if (h < 0.3) {
        sp(layout, 'desk', cx, cz - 0.3, rng.pick([0, Math.PI]));
        if (rng.chance(0.8)) sp(layout, 'chair_office', cx + r() * 0.3, cz + 0.6, rng.next() * 6.28);
        if (rng.chance(0.6)) sp(layout, 'crt_monitor', cx + r() * 0.2, cz - 0.3, Math.PI + r() * 0.3, { y: 0.78 });
        if (rng.chance(0.4)) sp(layout, rng.pick(['desk_phone', 'mug', 'paper_stack', 'binder', 'keyboard', 'lamp_desk']), cx + 0.4, cz - 0.3, rng.next() * 6.28, { y: 0.78 });
      } else if (h < 0.42) sp(layout, 'desk_cubicle_panel', cx, z0 + 0.15, 0);
      else if (h < 0.5) sp(layout, 'filing_cabinet', cx + r(), cz + r(), rng.pick([0, Math.PI / 2, Math.PI]));
      else if (h < 0.56) sp(layout, rng.pick(['printer', 'plant_pot', 'whiteboard', 'trash_can', 'computer_tower', 'box_medium']), cx + r(), cz + r(), rng.next() * 6.28);
      if (hash01(c.i, c.j, 62, seed) < 0.04) sp(layout, rng.weighted(LOOT_RARE), cx + r(), cz + r(), rng.next() * 6.28);
      break;
    }
    case 'maintenance': {
      if (h < 0.18) sp(layout, rng.pick(['barrel', 'barrel', 'crate_wood', 'pallet', 'bucket', 'pipe', 'cinder_block', 'toolbox', 'tire', 'sandbag', 'hand_truck']), cx + r(), cz + r(), rng.next() * 6.28);
      if (hash01(c.i, c.j, 62, seed) < 0.07) sp(layout, rng.pick(['plank', 'metal_scrap', 'screws', 'wire_spool', 'pipe_short', 'gear', 'fabric_scrap', 'battery', 'tape_roll']), cx + r(), cz + r(), rng.next() * 6.28);
      if (hash01(c.i, c.j, 63, seed) < 0.04) layout.decor.push({ kind: 'pipes', li: c.li, lj: c.lj });
      break;
    }
    case 'flooded': {
      if (h < 0.05) sp(layout, rng.pick(['bucket', 'mop', 'chair_wood', 'wet_floor_sign', 'barrel']), cx + r(), cz + r(), rng.next() * 6.28);
      if (hash01(c.i, c.j, 62, seed) < 0.02) sp(layout, 'almond_water', cx + r(), cz + r(), 0);
      break;
    }
    case 'pillars': {
      if (h < 0.08) sp(layout, rng.pick(['chair_wood', 'chair_folding', 'table_round', 'box_small', 'traffic_cone']), cx + r(), cz + r(), rng.next() * 6.28);
      break;
    }
  }
  // sinking / clipping decor scattered rarely everywhere
  const hd = hash01(c.i, c.j, 64, seed);
  if (hd < 0.012) layout.decor.push({ kind: 'sunk', li: c.li, lj: c.lj, type: rng.pick(['chair_wood', 'table_folding', 'chair_office', 'filing_cabinet']), depth: rng.range(0.25, 0.6), rot: rng.next() * 6.28, tilt: rng.range(-0.3, 0.3) });
  else if (hd < 0.02) layout.decor.push({ kind: 'clip', li: c.li, lj: c.lj, type: rng.pick(['desk', 'chair_wood', 'filing_cabinet', 'bookshelf', 'couch']), side: rng.pick(['N', 'W']) });
}

// Accessors in GLOBAL cell coords --------------------------------------------
export function floorDiv(a, b) { return Math.floor(a / b); }

export function cellInfo(seed, i, j, variantFn) {
  const cx = floorDiv(i, CHUNK), cz = floorDiv(j, CHUNK);
  const l = getLayout(seed, cx, cz, variantFn ? variantFn(cx, cz) : 0);
  return l.cells[(j - cz * CHUNK) * CHUNK + (i - cx * CHUNK)];
}

// wall on the north edge of global cell (i,j) (z = j*CELL)
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

// light transmission through an edge type (for baking / probes)
export function wallTransmission(t) {
  switch (t) {
    case W.NONE: return 1;
    case W.FULL: return 0.0;
    case W.DOOR: return 0.42;
    case W.ARCH: return 0.7;
    case W.HALF_A: case W.HALF_B: return 0.55;
    case W.LOW: return 0.85;
    case W.WINDOW: return 0.6;
    default: return 1;
  }
}

// can a walker pass this edge?
export function wallPassable(t) {
  return t !== W.FULL && t !== W.WINDOW;
}
