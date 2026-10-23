// Deterministic layout generation for Level 0 — "The Yellow Rooms".
// Pure data (no three.js): walls on a 3 m cell grid, zones, lights, ceiling heights, special rooms, prop spawns.
// Every peer generates identical layouts from (seed, chunk, variant).
//
// The arrival complex around the origin (elevator alcove, camp clearing, passage, teleport pad hall) is a fixed,
// seed-independent plan in global cell coordinates: every chunk that owns one of its cells or edges applies it,
// so it survives Day-7 corridor shifting and is identical for every seed (see LANDMARKS).
import { hash01, hash3, RNG, valueNoise2 } from '../../../core/rng.js';
import { spineX, spineZ, hallAt, macroEdge, endType, failAt, LOW_CEIL } from './macro.js';

export const CELL = 3.0;
export const CHUNK = 8; // cells per chunk side
export const CHUNK_M = CELL * CHUNK;
export const HEIGHT = 2.9;       // standard ceiling (light fixtures hang at HEIGHT - 0.04 everywhere)
export const TALL = 6.2;         // atrium / tall special rooms
export const TALL_PADS = 6.6;    // teleport pad hall
export const TALL_WARE = 7.0;    // warehouse sectors
export const LOW = 1.85;         // low-ceiling rooms (clones are 1.36 m tall)
export const CRAWL = 1.0;        // crawlspaces: crouch to get through
export const PIT = 2.6;          // depth of the slide pits

// wall types on edges
export const W = { NONE: 0, FULL: 1, DOOR: 2, ARCH: 3, HALF_A: 4, HALF_B: 5, LOW: 6, WINDOW: 7 };

export const ZONES = ['halls', 'office', 'maintenance', 'flooded', 'pillars', 'dark', 'manila', 'atrium', 'corridors', 'lowrooms', 'warehouse', 'lounge'];

const WALL_P = {
  halls: 0.36, office: 0.42, maintenance: 0.5, flooded: 0.3, pillars: 0.05, dark: 0.36, manila: 0.4,
  atrium: 0.035, corridors: 0.3, lowrooms: 0.52, warehouse: 0.06, lounge: 0.38,
};
// ceiling height per zone (cells may still override: crawlspaces, special rooms)
const ZONE_CEIL = { atrium: TALL, warehouse: TALL_WARE, lowrooms: LOW };

// ---------------------------------------------------------------------------
// Arrival complex (global cell coordinates; world metres = cell * CELL)
//
//   j\i  -1 0  1  2  3  4  5  6  7  8 ...... 13 14 15
//   -2                                   a  a                 a = exit aprons (kept clear, opened outwards)
//   -1                                   a  a
//    0                        E     a   [ PAD HALL 8..13 x 0..7, ]
//    1                        |         [ 18 x 24 m, 6.6 m tall  ]
//    2         [ CAMP 1..5 x 2..6 ]     [                        ]
//    3   a  a  [ 15 x 15 m        ]PP PP[                        ] a  a
//    4   a  a  [                  ]PP PP[                        ] a  a
//    5         [                  ]     [                        ]
//    6         [                  ]     [                        ]
//    7               a  a               [                        ]
//    8               a  a                     a  a
//    9                                        a  a
//   E = elevator alcove (3, 1), doors facing +z into the camp; PP = 2 x 2 cell passage (6 m wide)
// ---------------------------------------------------------------------------
const CAMP_R = { i0: 1, j0: 2, i1: 5, j1: 6 };
const ELEV_C = { i: 3, j: 1 };
const PASS_R = { i0: 6, j0: 3, i1: 7, j1: 4 };
const PADS_R = { i0: 8, j0: 0, i1: 13, j1: 7 };
// exits: boundary cells of the parent region + outward direction; aprons are `depth` cells beyond them
const EXITS = [
  { parent: 'camp', dir: [-1, 0], at: [[1, 3], [1, 4]], depth: 2 },
  { parent: 'camp', dir: [0, 1], at: [[2, 6], [3, 6]], depth: 2 },
  { parent: 'camp', dir: [0, -1], at: [[5, 2]], depth: 1 },
  { parent: 'pads', dir: [0, -1], at: [[10, 0], [11, 0]], depth: 2 },
  { parent: 'pads', dir: [0, 1], at: [[10, 7], [11, 7]], depth: 2 },
  { parent: 'pads', dir: [1, 0], at: [[13, 3], [13, 4]], depth: 2 },
];

const rectW = (r) => ({ x: ((r.i0 + r.i1 + 1) / 2) * CELL, z: ((r.j0 + r.j1 + 1) / 2) * CELL, w: (r.i1 - r.i0 + 1) * CELL, d: (r.j1 - r.j0 + 1) * CELL });
// Landmarks for gameplay systems (world metres; x, z = centre; w (x) / d (z) = size; yaw: the elevator doors face
// (sin yaw, 0, cos yaw), i.e. yaw 0 = +z, into the camp). Seed independent.
export const LANDMARKS = {
  camp: rectW(CAMP_R),
  padHall: { ...rectW(PADS_R), h: TALL_PADS },
  passage: rectW(PASS_R),
  // car stands in the 3 x 3 m alcove with its back 7 cm off the alcove's back wall (inner face z = 3.08)
  elevator: { x: (ELEV_C.i + 0.5) * CELL, z: ELEV_C.j * CELL + 0.08 + 0.07 + 1.1, yaw: 0, alcove: { x: (ELEV_C.i + 0.5) * CELL, z: (ELEV_C.j + 0.5) * CELL, w: CELL - 0.16, d: CELL - 0.08 } },
  exits: EXITS.map((e) => ({ parent: e.parent, dir: e.dir.slice(), cells: e.at.map(([i, j]) => [i + e.dir[0], j + e.dir[1]]) })),
};

const _plan = new Map();   // cell key -> { kind, exit }
const _planEdges = new Map(); // 'n|w' + key -> wall type
const ck = (i, j) => (i + 32768) * 65536 + (j + 32768);
(function buildPlan() {
  const put = (r, kind) => { for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) _plan.set(ck(i, j), { kind }); };
  put(CAMP_R, 'camp'); put(PASS_R, 'pass'); put(PADS_R, 'pads');
  _plan.set(ck(ELEV_C.i, ELEV_C.j), { kind: 'elev' });
  EXITS.forEach((e, ei) => {
    for (const [i, j] of e.at) for (let k = 1; k <= e.depth; k++) _plan.set(ck(i + e.dir[0] * k, j + e.dir[1] * k), { kind: 'apron', exit: ei, k, depth: e.depth });
  });
  const kindOf = (i, j) => _plan.get(ck(i, j)) || null;
  const open = (a, b) => {
    // both cells planned: is the edge between them open?
    if (a.kind === b.kind && a.kind !== 'apron') return true;
    if (a.kind === 'apron' && b.kind === 'apron') return a.exit === b.exit;
    const pair = [a.kind, b.kind].sort().join('|');
    if (pair === 'camp|pass' || pair === 'pads|pass' || pair === 'camp|elev') return true;
    const ap = a.kind === 'apron' ? a : b.kind === 'apron' ? b : null, other = ap === a ? b : a;
    if (ap && ap.k === 1 && EXITS[ap.exit].parent === other.kind) return true;
    return false;
  };
  // edge between cell A (west / north neighbour) and cell B
  const setEdge = (key, ai, aj, bi, bj, dirAB) => {
    const a = kindOf(ai, aj), b = kindOf(bi, bj);
    if (!a && !b) return;
    let t;
    if (a && b) {
      t = open(a, b) ? W.NONE : W.FULL;
      // single-cell exits get a cased arch instead of a gap
      if (t === W.NONE) {
        const ap = a.kind === 'apron' ? a : b.kind === 'apron' ? b : null;
        // the camp is a sealed room: every way out is a cased arch (wide enough to haul furniture through)
        if (ap && ap.k === 1 && (EXITS[ap.exit].at.length === 1 || EXITS[ap.exit].parent === 'camp')) t = W.ARCH;
      }
    } else {
      const p = a || b, outwardIsB = !!a; // p is planned, the other side is free maze
      if (p.kind === 'apron') {
        // apron: open towards the maze along the exit direction (outermost cell), sides left to the maze
        const e = EXITS[p.exit];
        const d = outwardIsB ? dirAB : [-dirAB[0], -dirAB[1]];
        if (p.k === p.depth && d[0] === e.dir[0] && d[1] === e.dir[1]) t = W.NONE;
        else return;
      } else t = W.FULL;
    }
    _planEdges.set(key, t);
  };
  const cells = [..._plan.keys()].map((k) => [Math.floor(k / 65536) - 32768, (k % 65536) - 32768]);
  for (const [i, j] of cells) {
    // the 4 edges of this cell: N (i, j) | W (i, j) | S = N (i, j+1) | E = W (i+1, j)
    setEdge('n' + ck(i, j), i, j - 1, i, j, [0, 1]);
    setEdge('n' + ck(i, j + 1), i, j, i, j + 1, [0, 1]);
    setEdge('w' + ck(i, j), i - 1, j, i, j, [1, 0]);
    setEdge('w' + ck(i + 1, j), i, j, i + 1, j, [1, 0]);
  }
})();

export function planCell(i, j) { return _plan.get(ck(i, j)) || null; }
function planEdge(axis, i, j) { const t = _planEdges.get(axis + ck(i, j)); return t === undefined ? -1 : t; }
// is (i, j) planned or next to a planned cell (random rooms keep a one-cell margin)
function nearPlan(i, j) {
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (_plan.has(ck(i + di, j + dj))) return true;
  return false;
}

export function zoneAt(seed, i, j) {
  const p = _plan.get(ck(i, j));
  if (p) return p.kind === 'pads' ? 'pads' : 'halls';
  // a calm ring of classic halls around the arrival complex
  if (i >= -3 && i <= 17 && j >= -4 && j <= 12) return 'halls';
  const s = seed % 10000;
  const nOffice = valueNoise2(i * 0.11 + s, j * 0.11, 101);
  const nMaint = valueNoise2(i * 0.09, j * 0.09 + s, 202);
  const nFlood = valueNoise2(i * 0.1 + 33 + s, j * 0.1 - 17, 303);
  const nPill = valueNoise2(i * 0.12 - s, j * 0.12 + 9, 404);
  const nDark = valueNoise2(i * 0.08 + 5, j * 0.08 - s, 505);
  const nManila = valueNoise2(i * 0.14 + 77, j * 0.14 + s, 606);
  const nAtr = valueNoise2(i * 0.075 + 211 + s, j * 0.075 - 50, 707);
  const nCorr = valueNoise2(i * 0.085 - 91, j * 0.085 + 13 + s, 808);
  const nLow = valueNoise2(i * 0.12 + 7 - s, j * 0.12 + 101, 909);
  const nWare = valueNoise2(i * 0.07 + 400, j * 0.07 + 300 - s, 1010);
  const nLounge = valueNoise2(i * 0.13 - 260 + s, j * 0.13 + 77, 1111);
  if (nMaint > 0.75) return 'maintenance';
  if (nFlood > 0.77) return 'flooded';
  if (nDark > 0.78) return 'dark';
  if (nWare > 0.79) return 'warehouse';
  if (nAtr > 0.78) return 'atrium';
  if (nOffice > 0.71) return 'office';
  if (nLow > 0.79) return 'lowrooms';
  if (nCorr > 0.76) return 'corridors';
  if (nPill > 0.77) return 'pillars';
  if (nLounge > 0.77) return 'lounge';
  if (nManila > 0.84) return 'manila';
  return 'halls';
}

// corridor sectors run along x or z in large patches
function corrAxis(seed, i, j) { return valueNoise2(i * 0.045 + 17, j * 0.045 - 3, 1212 + (seed % 977)) > 0.5 ? 'x' : 'z'; }

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
  ['chairpile', 8], ['office_room', 9], ['bedroom', 6], ['tv_room', 5], ['storage', 9], ['clipping', 2],
  ['sinking', 3], ['manila_room', 3], ['endless_hall', 4], ['poolrooms_glimpse', 2], ['red_chair', 3],
  ['stairs_nowhere', 4], ['many_doors', 2], ['vent_room', 4], ['vending_lonely', 3], ['workshop', 5],
  ['cubicle_farm', 6], ['dead_clone', 5],
  // furnished rooms (lots of loot to haul)
  ['break_room', 7], ['living_room', 7], ['library', 4], ['server_room', 3], ['locker_room', 4],
  // weird rooms (rare)
  ['slide_pit', 2.6], ['ball_pit', 2.6], ['chair_tower', 1.6], ['carpet_pit', 2.2], ['tilted_room', 1.6], ['ceiling_room', 1.8],
  ['giant_room', 1.6], ['door_corridor', 1.6], ['frozen_party', 1.8], ['mirror_room', 2.4],
  // rooms behind rooms: a row of rooms with the doors in line, a room built inside a room
  ['enfilade', 3], ['nested', 2.2],
];

// walls a room's furniture stands against: no door is cut there (it would open onto the back of a
// vending machine, a desk or a stack of boxes)
const DOOR_AVOID = {
  fuel_store: ['W'], fuse_office: ['N'], vending_lonely: ['N'], many_doors: ['N'], stairs_nowhere: ['N'],
  storage: ['N'], chairpile: ['N'], cubicle_farm: ['N'], vent_room: ['W', 'E'], clipping: ['W', 'E'],
  bedroom: ['E', 'S'], office_room: ['N'], tv_room: ['N', 'S'], workshop: ['N'],
  break_room: ['N'], living_room: ['N', 'S'], library: ['N', 'S'], server_room: ['N', 'S'], locker_room: ['N', 'S'],
  tilted_room: ['N', 'E', 'W'], giant_room: ['N'], ceiling_room: [], frozen_party: ['N'], mirror_room: ['N', 'S'],
};

function specialSize(kind) {
  switch (kind) {
    case 'endless_hall': return [6, 1];
    case 'door_corridor': return [6, 1];
    case 'chairpile': return [2, 2];
    case 'cubicle_farm': return [3, 2];
    case 'poolrooms_glimpse': return [2, 2];
    case 'storage': return [2, 2];
    case 'workshop': return [2, 2];
    case 'vent_room': return [2, 1];
    case 'break_room': case 'living_room': case 'server_room': case 'locker_room': return [2, 2];
    case 'library': return [3, 2];
    case 'slide_pit': case 'carpet_pit': case 'giant_room': return [3, 3];
    case 'ball_pit': case 'chair_tower': case 'ceiling_room': return [2, 2];
    case 'tilted_room': return [2, 3];
    case 'frozen_party': return [3, 2];
    case 'mirror_room': return [2, 2];
    case 'enfilade': return [5, 1];
    case 'nested': return [3, 3];
    default: return [1 + (kind.length % 2), 1 + ((kind.length >> 1) % 2)];
  }
}
// ceiling height of a special room
const ROOM_CEIL = { chair_tower: 8.5, giant_room: TALL, tilted_room: 4.8 };
// floor pits (chunk-local metre rect inside the room + depth); built by rooms.js
function roomPit(kind, room) {
  const x0 = room.rx * CELL, z0 = room.rz * CELL, x1 = x0 + room.w * CELL, z1 = z0 + room.h * CELL;
  if (kind === 'slide_pit') return { x0: x0 + 1.8, z0: z0 + 1.8, x1: x1 - 1.8, z1: z1 - 1.8, depth: PIT, kind };
  if (kind === 'ball_pit') return { x0: x0 + 1.2, z0: z0 + 1.5, x1: x1 - 1.2, z1: z1 - 1.2, depth: 1.25, kind };
  if (kind === 'carpet_pit') return { x0: x0 + 1.5, z0: z0 + 1.5, x1: x1 - 1.5, z1: z1 - 1.5, depth: 1.05, kind };
  return null;
}

// warehouse racking: deck tops (keep in sync with env/racks.js RACK_LEVELS) and what is stored on them
const RACK_LEVELS = [0.16, 1.32, 2.46];
const RACK_STOCK = [['box_large', 4], ['box_medium', 5], ['box_small', 3], ['crate_wood', 2], ['barrel', 0.6], ['tire', 0.5], ['suitcase', 0.5], ['toolbox', 0.5], ['water_jug', 0.6]];

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
      const z = zone === 'pads' ? 'halls' : zone;
      cells.push({
        li, lj, i, j, zone: z,
        light: 1, // 0 none, 1 panel
        lightMode: 'on',
        lightTone: 0,
        floor: z === 'maintenance' || z === 'warehouse' ? 'concrete' : 'carpet',
        water: z === 'flooded' && hash01(i, j, 11, seed) < 0.85,
        wet: z === 'flooded' ? 1 : (hash01(i, j, 12, seed) < 0.06 ? 0.6 : 0),
        hole: hash01(i, j, 13, seed) < 0.03,
        special: null,
        reserved: false,
        ceil: ZONE_CEIL[z] || HEIGHT,
        landmark: null,
      });
      const c = cells[cells.length - 1];
      if (z === 'warehouse') c.roomStyle = 'concrete';
      if (z === 'lowrooms' && hash01(i, j, 14, seed) < 0.13) { c.ceil = CRAWL; c.crawl = true; }
      if (zone === 'pads') c.zone = 'halls';
      macroCell(c, seed);
    }
  }
  const cell = (li, lj) => cells[lj * N + li];
  const edgesN = new Uint8Array(N * N);
  const edgesW = new Uint8Array(N * N);
  const block = new Uint8Array(N * N); // nav blockers on edges: 1 = N edge, 2 = W edge (warehouse racks)

  // --- base walls ---
  for (let lj = 0; lj < N; lj++) {
    for (let li = 0; li < N; li++) {
      const c = cell(li, lj);
      const i = c.i, j = c.j;
      // north edge: between (i, j-1) and (i, j)
      const zN = zoneAt(seed, i, j - 1), zW = zoneAt(seed, i - 1, j);
      // the macro structure (spines, halls) owns its edges; the seeded maze fills in the rest
      const mN = macroEdge(seed, i, j, 'n'), mW = macroEdge(seed, i, j, 'w');
      edgesN[lj * N + li] = mN >= 0 ? mN : baseWall(seed, variant, i, j, 'n', c.zone, zN === 'pads' ? 'halls' : zN);
      edgesW[lj * N + li] = mW >= 0 ? mW : baseWall(seed, variant, i, j, 'w', c.zone, zW === 'pads' ? 'halls' : zW);
    }
  }

  // --- lights ---
  for (const c of cells) {
    const h = hash01(c.i, c.j, 31, seed);
    if (c.zone === 'pillars' || c.zone === 'atrium') c.light = 1;
    else if (c.zone === 'maintenance') c.light = h < 0.55 ? 1 : 0;
    else if (c.zone === 'corridors') c.light = ((corrAxis(seed, c.i, c.j) === 'x' ? c.i : c.j) & 1) === 0 ? 1 : 0;
    else if (c.zone === 'warehouse') c.light = h < 0.92 ? 1 : 0;
    else if (c.crawl) c.light = 0;
    else c.light = h < 0.86 ? 1 : 0;
    const h2 = hash01(c.i, c.j, 32, seed);
    c.lightSeed = h2;
    if (c.zone === 'dark') c.lightMode = h2 < 0.82 ? 'dead' : 'flicker';
    else if (h2 < 0.045) c.lightMode = 'dead';
    else if (h2 < 0.1) c.lightMode = 'flicker';
    else if (h2 < 0.14) c.lightMode = 'buzz';
    c.lightTone = c.zone === 'maintenance' ? 2 : c.zone === 'office' ? 1 : c.zone === 'manila' ? 3 : c.zone === 'lounge' ? 3 : c.zone === 'warehouse' ? (h2 < 0.5 ? 2 : 1) : 0;
    c.lightRot = c.zone === 'warehouse' ? 1 : c.zone === 'corridors' ? (corrAxis(seed, c.i, c.j) === 'x' ? 1 : 0) : (c.i + c.j) % 2;
    macroLight(c, seed);
  }

  const layout = { seed, cx, cz, variant, cells, edgesN, edgesW, block, pillars: [], specials: [], spawns: [], decor: [], vents: [], holes: [], narrows: [] };

  // --- arrival complex (fixed plan) ---
  applyPlan(layout, seed);

  // --- mission / fixed rooms ---
  const mission = missionChunks(seed);
  const gen = mission.find((m) => m.cx === cx && m.cz === cz);
  if (gen) placeRoom(layout, rng, 'gen_' + gen.kind, 3, 3, 2, 2, { doors: 2 });
  // generator support items: fuel can / fuse are placed in a neighbouring chunk of their generator
  for (const m of mission) {
    if (m.kind === 'diesel' && cx === m.cx + 1 && cz === m.cz && canPlace(layout, 2, 5, 1, 1)) placeRoom(layout, rng, 'fuel_store', 2, 5, 1, 1, { doors: 1, avoid: DOOR_AVOID.fuel_store });
    if (m.kind === 'electric' && cx === m.cx && cz === m.cz + 1 && canPlace(layout, 5, 2, 1, 1)) placeRoom(layout, rng, 'fuse_office', 5, 2, 1, 1, { doors: 1, avoid: DOOR_AVOID.fuse_office });
  }
  if (cx === 0 && cz === 1 && canPlace(layout, 2, 2, 2, 2)) placeRoom(layout, rng, 'workshop', 2, 2, 2, 2, { doors: 2, avoid: DOOR_AVOID.workshop });

  // --- random special rooms (furnished / weird) ---
  const nTries = rng.chance(0.3) ? 2 : 1;
  for (let t = 0; t < nTries; t++) {
    if (gen || !rng.chance(t === 0 ? 0.72 : 0.5)) continue;
    const kind = rng.weighted(SPECIALS);
    if (t > 0 && layout.specials.some((r) => r.kind === kind)) continue;
    const [w, h] = specialSize(kind);
    const rx = rng.int(1, N - 1 - w), rz = rng.int(1, N - 1 - h);
    if (canPlace(layout, rx, rz, w, h)) {
      const doors = kind === 'endless_hall' || kind === 'door_corridor' || kind === 'enfilade' ? 0 : kind === 'tilted_room' ? 1 : rng.int(1, 2);
      const room = placeRoom(layout, rng, kind, rx, rz, w, h, { doors, avoid: DOOR_AVOID[kind] });
      if (kind === 'enfilade') enfilade(layout, room, seed);
      else if (kind === 'nested') nestedRoom(layout, room, rng, seed);
    }
  }

  // --- pillars ---
  for (let lj = 0; lj < N; lj++) {
    for (let li = 0; li < N; li++) {
      const c = cell(li, lj);
      if (c.reserved || c.landmark) continue;
      // pillars sit on the NW corner of their cell: keep them off the corners of reserved neighbours
      if ((li > 0 && cell(li - 1, lj).reserved) || (lj > 0 && cell(li, lj - 1).reserved) || (li > 0 && lj > 0 && cell(li - 1, lj - 1).reserved)) continue;
      if (planCell(c.i - 1, c.j) || planCell(c.i, c.j - 1) || planCell(c.i - 1, c.j - 1)) continue;
      // corridors stay clear; halls get their own colonnades (only on corners inside the hall)
      if (c.hall) {
        const hl = c.hall, di = c.i - hl.i0, dj = c.j - hl.j0;
        if (di < 1 || dj < 1) continue;
        if (hl.style === 'pillared' && di % 2 === 1 && dj % 2 === 1) layout.pillars.push({ li, lj, size: 0.62 });
        else if (hl.style === 'tall' && di % 2 === 0 && dj % 2 === 0) layout.pillars.push({ li, lj, size: 0.95, tall: true });
        continue;
      }
      if (c.spine || isMacro(seed, c.i - 1, c.j) || isMacro(seed, c.i, c.j - 1) || isMacro(seed, c.i - 1, c.j - 1)) continue;
      if (c.zone === 'pillars' && (c.i + c.j) % 2 === 0 && hash01(c.i, c.j, 41, seed) < 0.8) layout.pillars.push({ li, lj, size: 0.7 });
      else if (c.zone === 'atrium' && (c.i & 1) === 0 && (c.j & 1) === 0 && hash01(c.i, c.j, 41, seed) < 0.85) layout.pillars.push({ li, lj, size: 0.95, tall: true });
      else if ((c.zone === 'halls' || c.zone === 'lounge') && hash01(c.i, c.j, 42, seed) < 0.035) layout.pillars.push({ li, lj, size: 0.5 });
    }
  }

  // ensure no cell is fully closed (open one random edge)
  for (let lj = 0; lj < N - 1; lj++) {
    for (let li = 0; li < N - 1; li++) {
      const c = cell(li, lj);
      if (c.reserved || c.landmark) continue;
      const n = edgesN[lj * N + li], w = edgesW[lj * N + li];
      const s = edgesN[(lj + 1) * N + li], e = edgesW[lj * N + li + 1];
      const closed = [n, w, s, e].filter((x) => x === W.FULL).length;
      // (a sealed cell beside a squeeze stays sealed: a door there would open onto its thick wall)
      if (closed === 4 && !narrowAt(seed, c.i, c.j - 1) && !narrowAt(seed, c.i - 1, c.j) && !narrowAt(seed, c.i, c.j + 1) && !narrowAt(seed, c.i + 1, c.j)) {
        const k = Math.floor(hash01(c.i, c.j, 51, seed) * 4);
        const free = (a, b) => !cell(a, b).reserved && !cell(a, b).landmark;
        if (k === 0 && planEdge('n', c.i, c.j) < 0) edgesN[lj * N + li] = W.DOOR;
        else if (k === 1 && planEdge('w', c.i, c.j) < 0) edgesW[lj * N + li] = W.DOOR;
        else if (k === 2 && free(li, lj + 1)) edgesN[(lj + 1) * N + li] = W.DOOR;
        else if (free(li + 1, lj)) edgesW[lj * N + li + 1] = W.ARCH;
      }
    }
  }
  // re-assert the plan (nothing above may close an exit)
  applyPlanEdges(layout);
  // squeezes: thick walls fill the cell beside the passage, so its side edges stay solid
  for (const c of cells) {
    if (!c.narrow) continue;
    if (c.reserved || c.landmark) { c.narrow = null; continue; }
    if (c.narrow === 'x') { edgesN[c.lj * N + c.li] = W.FULL; if (c.lj < N - 1) edgesN[(c.lj + 1) * N + c.li] = W.FULL; }
    else { edgesW[c.lj * N + c.li] = W.FULL; if (c.li < N - 1) edgesW[c.lj * N + c.li + 1] = W.FULL; }
    layout.narrows.push({ li: c.li, lj: c.lj, ax: c.narrow });
  }

  // --- warehouse racks (static shelving on cell edges, blocks navigation) ---
  for (let lj = 0; lj < N; lj++) {
    for (let li = 0; li < N; li++) {
      const c = cell(li, lj);
      if (c.zone !== 'warehouse' || c.reserved || c.landmark) continue;
      const nZone = zoneAt(seed, c.i, c.j - 1);
      if (nZone !== 'warehouse' || edgesN[lj * N + li] !== W.NONE) continue;
      if ((c.i & 3) === 0 || (c.j & 3) === 3) continue; // cross aisles / main aisles
      const up = lj > 0 ? cell(li, lj - 1) : null;
      if (up && (up.reserved || up.landmark)) continue;
      if (planCell(c.i, c.j - 1) || isMacro(seed, c.i, c.j - 1)) continue;
      layout.decor.push({ kind: 'rack', li, lj, h: hash01(c.i, c.j, 44, seed) });
      block[lj * N + li] |= 1;
      // stock on both faces of the bay: boxes and crates on the decks (absolute heights, no floor checks)
      for (const side of [-1, 1]) for (let lv = 0; lv < RACK_LEVELS.length; lv++) {
        if (hash01(c.i * 3 + lv, c.j * 2 + (side > 0 ? 1 : 0), 45, seed) > 0.62) continue;
        const n = 1 + rng.int(0, 2);
        for (let k = 0; k < n; k++) {
          const type = rng.weighted(RACK_STOCK);
          const x = li * CELL + 0.45 + (k + 0.5) * (2.1 / n) + rng.range(-0.08, 0.08);
          sp(layout, type, x, lj * CELL + side * 0.26, (side > 0 ? 0 : Math.PI) + rng.range(-0.12, 0.12), { y: RACK_LEVELS[lv] + 0.004, abs: true });
        }
      }
    }
  }

  // --- doors that open onto the wall behind them (a cased door, ajar, on a solid wall face) ---
  for (const c of cells) {
    if (c.reserved || c.landmark || c.crawl || c.narrow || c.ceil < HEIGHT - 0.01) continue;
    const hdw = hash01(c.i, c.j, 46, seed);
    if (hdw > 0.022 || !['halls', 'office', 'manila', 'dark', 'lounge', 'corridors'].includes(c.zone)) continue;
    const idx = c.lj * N + c.li;
    const side = edgesN[idx] === W.FULL ? 'N' : edgesW[idx] === W.FULL ? 'W' : null;
    if (!side) continue;
    const pil = (a, b2) => layout.pillars.some((p) => p.li === a && p.lj === b2);
    if (pil(c.li, c.lj) || (side === 'N' ? pil(c.li + 1, c.lj) : pil(c.li, c.lj + 1))) continue;
    layout.decor.push({ kind: 'walldoor', li: c.li, lj: c.lj, side, hinge: hash01(c.i, c.j, 47, seed) < 0.5 ? -1 : 1 });
  }

  macroDecor(layout, seed);

  // --- generic prop spawns per cell ---
  for (const c of cells) {
    if (c.reserved || c.landmark) continue;
    spawnZoneProps(layout, c, rng, seed);
  }

  // --- wall vents (critter escape points) ---
  for (let k = 0; k < 3; k++) {
    const li = rng.int(0, N - 1), lj = rng.int(0, N - 1);
    const idx = lj * N + li;
    const c = cell(li, lj);
    if (c.landmark || c.crawl || c.narrow || c.special?.pit) continue;
    if (planCell(c.i, c.j - 1) || planCell(c.i - 1, c.j)) continue;
    const busy = (sd) => layout.decor.some((d) => (d.kind === 'clip' || d.kind === 'walldoor') && d.li === li && d.lj === lj && d.side === sd);
    if (edgesN[idx] === W.FULL && !busy('N')) layout.vents.push({ li, lj, side: 'N' });
    else if (edgesW[idx] === W.FULL && !busy('W')) layout.vents.push({ li, lj, side: 'W' });
  }
  return layout;
}

// ---------------------------------------------------------------------------
// Macro structure on a cell (see macro.js): corridor / hall membership, ceiling, zone clean-up
const MACRO_REZONE = new Set(['warehouse', 'lowrooms', 'atrium']);
const SPINE_CEIL = { low: LOW_CEIL, narrow: LOW_CEIL, vault: TALL };
function macroCell(c, seed) {
  const sx = spineX(seed, c.i, c.j), sz = spineZ(seed, c.i, c.j), hl = hallAt(seed, c.i, c.j);
  if (!sx && !sz && !hl) return;
  if (MACRO_REZONE.has(c.zone)) { c.zone = 'halls'; c.floor = 'carpet'; c.roomStyle = undefined; }
  c.crawl = false;
  if (hl) { c.hall = hl; c.ceil = hl.style === 'tall' ? TALL : HEIGHT; return; }
  c.spine = sx || sz;
  c.spineX = sx; c.spineZ = sz;
  c.ceil = Math.max(SPINE_CEIL[sx?.style] || HEIGHT, SPINE_CEIL[sz?.style] || HEIGHT);
  if (sx && sz) { if (c.ceil < HEIGHT) c.ceil = HEIGHT; return; } // crossroads: never squeezed or lowered
  if (c.spine.style === 'narrow') c.narrow = sx ? 'x' : 'z';
}
// lighting rhythm of corridors and halls, dying fixtures in failing sectors
function macroLight(c, seed) {
  const sp = c.spine, hl = c.hall;
  if (sp) {
    const k = sp.k, len = sp.b - sp.a;
    const beat = sp.style === 'rhythm' || sp.style === 'vault' || sp.style === 'narrow';
    c.light = !beat || k % 2 === 0 ? 1 : 0;
    c.lightRot = sp.ax === 0 ? 1 : 0;
    const h = hash01(c.i, c.j, 9041, seed);
    if (sp.style === 'doors') c.lightMode = 'on';
    // streaks of dead tubes down the corridor, one of them still stuttering
    else if (hash01(sp.seg, Math.floor(k / 5), 9040, seed) < 0.2) c.lightMode = k % 5 === 2 ? 'flicker' : 'dead';
    // the last fixtures before a dead end are going
    else if ((k >= len - 1 && endType(seed, sp, 1) === W.FULL) || (k <= 1 && endType(seed, sp, 0) === W.FULL)) c.lightMode = h < 0.5 ? 'flicker' : 'dead';
  } else if (hl) {
    const di = c.i - hl.i0, dj = c.j - hl.j0, h = hash01(c.i, c.j, 9042, seed);
    c.lightRot = 1;
    if (hl.style === 'empty') { c.light = di % 2 === 0 && dj % 2 === 0 ? 1 : 0; if (h < 0.3) c.lightMode = 'dead'; }
    else if (hl.style === 'pillared') { c.light = 1; if (h < 0.12) c.lightMode = 'dead'; }
    else if (hl.style === 'tall') { c.light = (di + dj) % 2 === 0 ? 1 : 0; c.lightTone = h < 0.5 ? 1 : 0; }
    else {
      // dark hall: a single stuttering fixture in the middle, the odd survivor elsewhere
      const mid = c.i === Math.floor((hl.i0 + hl.i1) / 2) && c.j === Math.floor((hl.j0 + hl.j1) / 2);
      c.light = mid || h < 0.08 ? 1 : 0;
      c.lightMode = mid ? 'flicker' : 'on';
    }
  }
  const f = failAt(seed, c.i, c.j);
  if (f > 0 && c.light) {
    const h = hash01(c.i, c.j, 9050, seed);
    if (h < f * 0.72) c.lightMode = 'dead';
    else if (h < f * 0.9) c.lightMode = 'flicker';
    else if (h < f) c.lightMode = 'buzz';
    if (hash01(c.i, c.j, 9051, seed) < f * 0.7 && c.lightTone === 0) c.lightTone = 7; // sick green-white tubes
  }
}
// axis of the squeeze through global cell (i, j), or null
function narrowAt(seed, i, j) {
  const sx = spineX(seed, i, j), sz = spineZ(seed, i, j);
  if (sx && !sz && sx.style === 'narrow') return 'x';
  if (sz && !sx && sz.style === 'narrow') return 'z';
  return null;
}
// is global cell (i, j) part of the macro structure (corridor / hall)
function isMacro(seed, i, j) { return !!(spineX(seed, i, j) || spineZ(seed, i, j) || hallAt(seed, i, j)); }

// base wall of the N ('n') or W ('w') edge of global cell (i, j); zA: this cell's zone, zB: the neighbour's
function baseWall(seed, variant, i, j, axis, zA, zB) {
  const hk = axis === 'n' ? 21 : 23;
  const h = hash01(i, j, hk + variant * 7, seed), h2 = hash01(i, j, hk + 1 + variant * 7, seed);
  // corridor sectors: long continuous walls along the corridor axis, few cross walls
  if (zA === 'corridors' && zB === 'corridors') {
    const ax = corrAxis(seed, i, j);
    const along = (axis === 'n') === (ax === 'x'); // this edge runs parallel to the corridors
    if (along) {
      const line = axis === 'n' ? j : i;
      const wallLine = (line & 1) === 0 || hash01(line, 0, 707 + variant, seed) < 0.3;
      if (!wallLine) return h < 0.04 ? W.ARCH : W.NONE;
      if (h2 < 0.13) return W.DOOR;
      if (h2 < 0.16) return W.ARCH;
      return W.FULL;
    }
    if (h < 0.035) return W.DOOR;
    if (h < 0.06) return W.FULL;
    return W.NONE;
  }
  let p = Math.max(WALL_P[zA] ?? 0.36, WALL_P[zB] ?? 0.36);
  if (zA !== zB && (zA === 'maintenance' || zB === 'maintenance')) p += 0.35;
  // the transition into a tall / low sector reads as a threshold: mostly cased openings, some walls
  if (zA !== zB && (ZONE_CEIL[zA] || ZONE_CEIL[zB])) {
    if (h < 0.42) return h2 < 0.55 ? W.ARCH : W.FULL;
    return W.NONE;
  }
  return pickWall(h, h2, p);
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

// arrival complex: cell styling + edges
function applyPlan(layout, seed) {
  for (const c of layout.cells) {
    const p = planCell(c.i, c.j);
    if (!p) continue;
    c.landmark = p.kind;
    c.reserved = p.kind !== 'apron';
    c.water = false; c.hole = false; c.wet = 0; c.crawl = false;
    c.ceil = HEIGHT;
    c.light = 1; c.lightMode = 'on';
    c.zone = 'halls';
    if (p.kind === 'camp') { c.lightTone = 3; c.carpet = 'camp'; c.floor = 'carpet'; }
    else if (p.kind === 'pass') { c.lightTone = 0; c.floor = 'carpet'; }
    else if (p.kind === 'pads') { c.lightTone = 1; c.floor = 'concrete'; c.roomStyle = 'concrete'; c.ceil = TALL_PADS; c.lightRot = 1; }
    else if (p.kind === 'elev') { c.light = 0; c.floor = 'vct'; c.roomStyle = 'concrete'; }
    else if (p.kind === 'apron') { c.lightMode = hash01(c.i, c.j, 32, seed) < 0.08 ? 'flicker' : 'on'; c.floor = 'carpet'; }
  }
  applyPlanEdges(layout);
}

function applyPlanEdges(layout) {
  const N = CHUNK;
  for (const c of layout.cells) {
    const tn = planEdge('n', c.i, c.j), tw = planEdge('w', c.i, c.j);
    if (tn >= 0) layout.edgesN[c.lj * N + c.li] = tn;
    if (tw >= 0) layout.edgesW[c.lj * N + c.li] = tw;
  }
}

function canPlace(layout, rx, rz, w, h) {
  for (let j = rz; j < rz + h; j++) for (let i = rx; i < rx + w; i++) {
    const c = layout.cells[j * CHUNK + i];
    if (c.reserved || c.landmark || c.spine || nearPlan(c.i, c.j)) return false;
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
      c.crawl = false;
      c.ceil = ROOM_CEIL[kind] || HEIGHT;
      if (c.zone === 'warehouse') { c.floor = 'carpet'; c.roomStyle = undefined; }
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
  for (const b of boundary) (b.arr === 'N' ? edgesN : edgesW)[b.idx] = W.FULL;
  const nd = opts.doors ?? 1;
  const avoid = opts.avoid || null;
  let pool = avoid ? boundary.filter((b) => !avoid.includes(b.side)) : boundary.slice();
  if (kind === 'tilted_room') pool = boundary.filter((b) => b.side === 'S' && b.i === rx + Math.floor(w / 2));
  if (!pool.length) pool = boundary.slice();
  const choices = rng.shuffle(pool);
  for (let d = 0; d < Math.min(nd, choices.length); d++) {
    const b = choices[d];
    (b.arr === 'N' ? edgesN : edgesW)[b.idx] = kind.startsWith('gen_') || kind === 'workshop' || kind === 'tilted_room' ? W.ARCH : W.DOOR;
    room.doors.push(b);
  }
  if (kind === 'endless_hall' || kind === 'door_corridor') {
    // open both short ends
    edgesW[rz * N + rx] = W.ARCH;
    if (rx + w < N) edgesW[rz * N + rx + w] = W.ARCH;
  }
  // zone styling inside
  for (let j = rz; j < rz + h; j++) for (let i = rx; i < rx + w; i++) {
    const c = cells[j * N + i];
    if (kind.startsWith('gen_') || kind === 'workshop' || kind === 'fuel_store' || kind === 'vent_room' || kind === 'server_room') { c.floor = 'concrete'; c.lightTone = 2; c.roomStyle = 'concrete'; }
    if (kind === 'server_room') { c.lightTone = 1; }
    if (kind === 'manila_room' || kind === 'library') { c.lightTone = 3; c.roomStyle = 'manila'; }
    if (kind === 'red_chair') { c.lightTone = 4; }
    if (kind === 'poolrooms_glimpse') { c.roomStyle = 'pool'; c.floor = 'tile'; c.lightTone = 5; }
    if (kind === 'office_room' || kind === 'fuse_office' || kind === 'cubicle_farm') c.lightTone = 1;
    if (kind === 'break_room' || kind === 'locker_room') { c.floor = 'vct'; c.lightTone = 1; }
    if (kind === 'living_room') { c.lightTone = 3; c.carpet = 'lounge'; }
    if (kind === 'frozen_party') { c.lightTone = 6; c.carpet = 'office'; }
    if (kind === 'slide_pit' || kind === 'ball_pit') { c.lightTone = 6; c.floor = 'vct'; }
    if (kind === 'carpet_pit') { c.lightTone = 3; c.carpet = 'lounge'; }
    if (kind === 'chair_tower') { c.lightTone = 0; c.lightMode = (i + j) % 3 === 0 ? 'flicker' : 'on'; }
    if (kind === 'ceiling_room') { c.lightTone = 0; c.lightRot = 1; }
    // the giant furniture fills the middle: only the corner cells carry (hanging) fixtures
    if (kind === 'giant_room') { c.lightTone = 3; c.light = (i - rx) % 2 === 0 && (j - rz) % 2 === 0 ? 1 : 0; }
    if (kind === 'tilted_room') { c.light = 1; c.lightTone = 0; c.noPendant = true; }
    if (kind === 'dead_clone') { c.lightMode = 'flicker'; }
    if (kind === 'endless_hall' || kind === 'door_corridor') { c.lightMode = 'on'; c.light = 1; c.lightSeed = 0.5; c.lightRot = 1; }
  }
  const pit = roomPit(kind, room);
  if (pit) {
    room.pit = pit;
    layout.holes.push(pit);
    for (let j = rz; j < rz + h; j++) for (let i = rx; i < rx + w; i++) cells[j * N + i].pit = true;
  }
  layout.specials.push(room);
  return room;
}

// a row of rooms with every door in line (partitions and both ends): door after door after door,
// the far rooms' tubes failing
function enfilade(layout, room, seed) {
  const N = CHUNK;
  for (let i = room.rx; i <= room.rx + room.w; i++) layout.edgesW[room.rz * N + i] = W.DOOR;
  for (let i = room.rx; i < room.rx + room.w; i++) {
    const c = layout.cells[room.rz * N + i], k = i - room.rx;
    c.lightRot = 1;
    c.lightTone = k === room.w - 1 ? 3 : 0;
    c.lightMode = k === 2 ? 'flicker' : k >= 3 && hash01(c.i, c.j, 9070, seed) < 0.6 ? 'dead' : 'on';
  }
}
// a sealed little room in the middle of a room, one door; inside, a chair facing the wall
function nestedRoom(layout, room, rng, seed) {
  const N = CHUNK, li = room.rx + 1, lj = room.rz + 1;
  layout.edgesN[lj * N + li] = W.FULL; layout.edgesN[(lj + 1) * N + li] = W.FULL;
  layout.edgesW[lj * N + li] = W.FULL; layout.edgesW[lj * N + li + 1] = W.FULL;
  const d = Math.floor(hash01(room.rx, room.rz, 9071, seed) * 4);
  if (d === 0) layout.edgesN[lj * N + li] = W.DOOR;
  else if (d === 1) layout.edgesN[(lj + 1) * N + li] = W.DOOR;
  else if (d === 2) layout.edgesW[lj * N + li] = W.DOOR;
  else layout.edgesW[lj * N + li + 1] = W.DOOR;
  const c = layout.cells[lj * N + li];
  c.lightMode = 'flicker'; c.lightTone = 3;
  const cx = li * CELL + CELL / 2, cz = lj * CELL + CELL / 2;
  // the chair faces the wall opposite the door
  const face = [0, Math.PI, Math.PI / 2, -Math.PI / 2][d], off = [[0, 0.75], [0, -0.75], [0.75, 0], [-0.75, 0]][d];
  sp(layout, 'chair_wood', cx + off[0], cz + off[1], face + rng.range(-0.05, 0.05));
  if (rng.chance(0.5)) sp(layout, rng.weighted(LOOT_RARE), cx - off[0] * 0.4 + 0.3, cz - off[1] * 0.4 + 0.3, rng.next() * 6.28);
}

// set-pieces of the macro structure: hanging EXIT signs down the corridors, doors onto the wall at dead
// ends, a door high up in the wall of a tall hall where nobody can reach it
function macroDecor(layout, seed) {
  const N = CHUNK, { cells, edgesN, edgesW, decor } = layout;
  const taken = (c) => decor.some((d) => d.li === c.li && d.lj === c.lj && (d.kind === 'walldoor' || d.kind === 'clip'));
  for (const c of cells) {
    if (c.reserved || c.landmark) continue;
    const sp0 = c.spine, idx = c.lj * N + c.li;
    if (sp0 && !c.narrow && !(c.spineX && c.spineZ)) {
      if (sp0.k % 8 === 4 && c.ceil <= HEIGHT + 0.01) decor.push({ kind: 'exitsign', li: c.li, lj: c.lj, ax: sp0.ax });
      if (sp0.k === 0 && c.ceil >= HEIGHT - 0.01 && !taken(c) && hash01(c.i, c.j, 9060, seed) < 0.5) {
        const side = sp0.ax === 0 ? 'W' : 'N';
        if ((side === 'W' ? edgesW[idx] : edgesN[idx]) === W.FULL) decor.push({ kind: 'walldoor', li: c.li, lj: c.lj, side, hinge: hash01(c.i, c.j, 47, seed) < 0.5 ? -1 : 1 });
      }
    }
    const hl = c.hall;
    if (hl && hl.style === 'tall' && c.j === hl.j0 && edgesN[idx] === W.FULL && !taken(c) && hash01(c.i, c.j, 9061, seed) < 0.2) {
      const zN = zoneAt(seed, c.i, c.j - 1);
      if (zN !== 'atrium' && zN !== 'warehouse' && !spineX(seed, c.i, c.j - 1) && !spineZ(seed, c.i, c.j - 1)) {
        decor.push({ kind: 'walldoor', li: c.li, lj: c.lj, side: 'N', hinge: hash01(c.i, c.j, 47, seed) < 0.5 ? -1 : 1, y: 3.1 + hash01(c.i, c.j, 9062, seed) * 0.7 });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Prop spawns. Positions in chunk-local meters (x,z from chunk origin), y from floor.
function sp(layout, type, x, z, rotY = 0, extra = {}) {
  layout.spawns.push({ type, x, z, rotY, ...extra });
}

const LOOT_RARE = [['almond_water', 6], ['protein_bar', 3], ['chips', 3], ['soda_can', 3], ['energy_drink', 2], ['bandage', 3], ['battery', 3], ['glowstick', 2], ['sample_jar', 3], ['canned_food', 2], ['painkillers', 1], ['candy_bar', 2], ['flare', 1], ['medkit', 0.6], ['antibiotics', 0.6], ['flashlight', 0.6], ['screws', 2], ['plank', 2], ['fabric_scrap', 2], ['metal_scrap', 2], ['wire_spool', 1]];

// which side of the cell (N / S / W / E) has a solid wall to stand furniture against
function wallSides(layout, c) {
  const N = CHUNK, out = [];
  const solid = (t) => t === W.FULL || t === W.LOW;
  if (solid(layout.edgesN[c.lj * N + c.li])) out.push('N');
  if (solid(layout.edgesW[c.lj * N + c.li])) out.push('W');
  if (c.lj < N - 1 && solid(layout.edgesN[(c.lj + 1) * N + c.li])) out.push('S');
  if (c.li < N - 1 && solid(layout.edgesW[c.lj * N + c.li + 1])) out.push('E');
  return out;
}
// top heights of the new storage pieces (furniture/storage2.js) for things set on them
export const DRESSER_H = 0.86, CABINET_H = 0.8;
// furniture vignettes: a group of pieces arranged in one cell. Each entry [type, x, z, rot] is relative to the
// cell centre facing +z (rotated with the vignette); 'y' entries rest on the previous base piece.
const VIGNETTES = {
  lounge_set: [['couch', 0, -0.85, 0, { base: true }], ['table_round', 0, 0.25, 0], ['armchair', 1.05, 0.35, -1.9], ['lamp_floor', -1.05, -0.95, 0]],
  armchair_pair: [['armchair', -0.55, -0.6, 0.35], ['armchair', 0.6, -0.55, -0.35], ['table_round', 0.02, 0.35, 0], ['plant_pot', 1.05, -1.0, 0]],
  tv_corner: [['tv_crt', 0, -1.0, 0], ['armchair', 0.1, 0.55, Math.PI], ['lamp_floor', 0.95, -0.95, 0]],
  desk_pod: [['desk', 0, -0.6, 0, { base: true }], ['crt_monitor', -0.15, -0.72, 0, { y: 0.76 }], ['keyboard', -0.15, -0.34, 0, { y: 0.76 }], ['chair_office', 0.05, 0.25, Math.PI], ['filing_cabinet', 1.1, -0.7, 0]],
  break_nook: [['table_folding', 0, 0, 0], ['chair_folding', -0.2, -0.72, 0], ['chair_folding', 0.25, 0.72, Math.PI], ['trash_can', 1.1, -1.05, 0]],
  storage_stack: [['box_large', -0.7, -0.9, 0.05], ['box_medium', -0.05, -0.95, -0.1], ['box_small', 0.55, -1.0, 0.2], ['crate_wood', 0.95, -0.25, 0.1]],
  bedroom_set: [['bed', 0, -0.35, 0], ['lamp_desk', 1.1, -1.05, 0], ['suitcase', -1.05, 0.9, 0.4]],
  office_machines: [['printer', -0.6, -0.95, 0], ['computer_tower', 0.2, -1.0, 0], ['plant_pot', 1.0, -0.95, 0], ['water_jug', -1.1, 0.4, 0]],
  shelf_wall: [['bookshelf', -0.5, -1.05, 0], ['bookshelf', 0.5, -1.05, 0], ['chair_wood', 0.2, 0.3, 2.6]],
  vending_pair: [['vending_snack', -0.55, -0.88, 0], ['vending_drink', 0.55, -0.88, 0]],
  lockers: [['locker', -0.5, -1.05, 0], ['locker', 0.0, -1.05, 0], ['locker', 0.5, -1.05, 0], ['chair_folding', 0.2, 0.4, 1.0]],
  dresser_set: [['dresser', 0, -1.0, 0, { base: true }], ['lamp_desk', 0.3, -1.0, 0, { y: DRESSER_H }], ['nightstand', 1.05, -1.05, 0], ['mattress', -0.1, 0.5, 0.15]],
  cabinet_row: [['cabinet_low', -0.55, -1.05, 0], ['cabinet_low', 0.55, -1.05, 0, { base: true }], ['plant_small', 0.55, -1.05, 0, { y: CABINET_H }]],
  arcade: [['arcade_cabinet', 0, -0.92, 0], ['stool', 0.1, 0.0, 0]],
  piano_corner: [['piano', 0, -1.05, 0], ['stool', 0, -0.25, 0]],
  fridge_corner: [['fridge', -0.7, -1.0, 0], ['water_cooler', 0.2, -1.1, 0], ['trash_can', 0.9, -1.05, 0]],
  copier: [['photocopier', 0, -0.95, 0], ['box_small', 0.8, -0.9, 0.3]],
  server: [['server_rack', -0.45, -0.9, 0], ['server_rack', 0.45, -0.9, 0]],
  // subtly wrong: rows of chairs set out facing whoever walks in; an armchair staring into the corner
  audience: [['chair_wood', -0.7, -0.6, 0], ['chair_wood', 0, -0.6, 0], ['chair_wood', 0.7, -0.6, 0], ['chair_wood', -0.7, 0.35, 0], ['chair_wood', 0, 0.35, 0], ['chair_wood', 0.7, 0.35, 0]],
  corner_stare: [['armchair', -0.85, -0.85, Math.PI * 0.75], ['lamp_floor', 0.9, -1.05, 0]],
};

// Which vignettes a zone uses: [vignette, weight]; null = loose clutter only
const ZONE_VIGNETTES = {
  halls: [['lounge_set', 1], ['armchair_pair', 1.2], ['break_nook', 1.2], ['storage_stack', 1.5], ['shelf_wall', 1], ['desk_pod', 0.8], ['vending_pair', 0.6], ['cabinet_row', 1], ['dresser_set', 0.5], ['tv_corner', 0.6], ['arcade', 0.25], ['piano_corner', 0.2], ['lockers', 0.4], ['fridge_corner', 0.3], ['audience', 0.25], ['corner_stare', 0.25]],
  manila: [['lounge_set', 1.4], ['armchair_pair', 1.4], ['shelf_wall', 1.2], ['dresser_set', 1], ['bedroom_set', 0.6], ['piano_corner', 0.4], ['cabinet_row', 1], ['corner_stare', 0.5], ['audience', 0.3]],
  dark: [['storage_stack', 1.5], ['break_nook', 1], ['bedroom_set', 0.6], ['lockers', 0.7], ['armchair_pair', 0.7], ['vending_pair', 0.4], ['audience', 0.6], ['corner_stare', 0.6]],
  office: [['desk_pod', 3], ['office_machines', 1.5], ['copier', 0.6], ['cabinet_row', 1], ['break_nook', 0.7], ['shelf_wall', 0.6], ['server', 0.25], ['vending_pair', 0.3], ['audience', 0.35]],
  lounge: [['lounge_set', 2.5], ['armchair_pair', 2], ['tv_corner', 1.5], ['dresser_set', 1], ['bedroom_set', 0.6], ['piano_corner', 0.5], ['arcade', 0.4], ['shelf_wall', 1], ['fridge_corner', 0.5]],
  pillars: [['break_nook', 1], ['armchair_pair', 1], ['storage_stack', 1]],
  atrium: [['lounge_set', 1.2], ['armchair_pair', 1.2], ['vending_pair', 0.8], ['arcade', 0.4], ['break_nook', 1], ['piano_corner', 0.4]],
  corridors: [['cabinet_row', 1], ['lockers', 1], ['vending_pair', 0.5], ['storage_stack', 1]],
  lowrooms: [['storage_stack', 1.5], ['break_nook', 1], ['armchair_pair', 1], ['cabinet_row', 1], ['dresser_set', 0.6]],
  maintenance: [['storage_stack', 2], ['lockers', 1]],
  warehouse: null,
  flooded: null,
};
// share of free cells that get a vignette
const ZONE_VIG_P = { halls: 0.16, manila: 0.22, dark: 0.14, office: 0.22, lounge: 0.34, pillars: 0.1, atrium: 0.12, corridors: 0.08, lowrooms: 0.2, maintenance: 0.1 };

function addVignette(layout, c, name, rng, seed) {
  const v = VIGNETTES[name];
  if (!v) return false;
  const sides = wallSides(layout, c);
  // stand against a solid wall when the cell has one (rotation: the vignette's -z goes to that wall)
  let rot;
  if (sides.length) {
    const s = sides[Math.floor(hash01(c.i, c.j, 65, seed) * sides.length)];
    rot = s === 'N' ? 0 : s === 'S' ? Math.PI : s === 'W' ? Math.PI / 2 : -Math.PI / 2;
  } else {
    if (name === 'vending_pair' || name === 'lockers' || name === 'shelf_wall' || name === 'piano_corner' || name === 'fridge_corner' || name === 'copier' || name === 'server' || name === 'cabinet_row' || name === 'dresser_set' || name === 'corner_stare') return false;
    rot = Math.floor(hash01(c.i, c.j, 66, seed) * 4) * Math.PI / 2;
  }
  const ccx = c.li * CELL + CELL / 2, ccz = c.lj * CELL + CELL / 2;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const tall = c.ceil < 2.2;
  for (const [type, lx, lz, lr, ex] of v) {
    if (tall && TALL_TYPES.has(type)) continue;
    const jx = rng.range(-0.04, 0.04), jz = rng.range(-0.04, 0.04);
    // rotate (lx, lz) by rot about +y: x' = x cos + z sin, z' = -x sin + z cos
    const x = ccx + (lx + jx) * cs + (lz + jz) * sn, z = ccz - (lx + jx) * sn + (lz + jz) * cs;
    sp(layout, type, x, z, rot + (lr || 0) + rng.range(-0.06, 0.06), { ...(ex || {}), vig: 1 });
  }
  return true;
}
// furniture too tall for low rooms
const TALL_TYPES = new Set(['bookshelf', 'vending_snack', 'vending_drink', 'locker', 'fridge', 'server_rack', 'lamp_floor', 'coat_rack', 'water_cooler', 'photocopier', 'arcade_cabinet', 'piano']);

function spawnZoneProps(layout, c, rng, seed) {
  const x0 = c.li * CELL, z0 = c.lj * CELL;
  const cx = x0 + CELL / 2, cz = z0 + CELL / 2;
  const r = () => rng.range(-0.75, 0.75);
  const h = hash01(c.i, c.j, 61, seed);
  if (c.crawl) {
    // crawlspaces: a little loot, nothing else
    if (hash01(c.i, c.j, 62, seed) < 0.22) sp(layout, rng.weighted(LOOT_RARE), cx + r() * 0.6, cz + r() * 0.6, rng.next() * 6.28);
    return;
  }
  // squeezes: room for nothing but the odd bottle; corridors are kept clear, small things stand by the walls
  if (c.narrow) {
    if (hash01(c.i, c.j, 62, seed) < 0.1) sp(layout, rng.weighted(LOOT_RARE), cx, cz, rng.next() * 6.28);
    return;
  }
  if (c.spine) {
    const side = hash01(c.i, c.j, 63, seed) < 0.5 ? -1 : 1, ax = c.spine.ax;
    const wx = ax === 0 ? cx + r() : cx + side * 1.0, wz = ax === 0 ? cz + side * 1.0 : cz + r();
    if (h < 0.07 && c.ceil >= 2.2) sp(layout, rng.pick(['chair_wood', 'chair_folding', 'box_small', 'trash_can', 'wet_floor_sign', 'traffic_cone', 'paper_stack', 'bucket', 'stool']), wx, wz, rng.next() * 6.28);
    if (hash01(c.i, c.j, 62, seed) < 0.04) sp(layout, rng.weighted(LOOT_RARE), wx, wz, rng.next() * 6.28);
    return;
  }
  // rare, deliberate liminal set-pieces: one piece of furniture sunk into the carpet, or shoved into a solid
  // wall. They own their cell (nothing else spawns there) so they never tangle with other furniture.
  const hd = hash01(c.i, c.j, 64, seed);
  if (hd < 0.005 && !c.water && c.ceil >= HEIGHT) {
    layout.decor.push({ kind: 'sunk', li: c.li, lj: c.lj, type: rng.pick(['chair_wood', 'table_folding', 'chair_office', 'filing_cabinet']), depth: rng.range(0.25, 0.5), rot: rng.next() * 6.28, tilt: rng.range(-0.22, 0.22) });
    return;
  }
  if (hd < 0.01 && c.ceil >= HEIGHT && !layout.decor.some((d) => d.kind === 'walldoor' && d.li === c.li && d.lj === c.lj)) {
    const N = CHUNK, idx = c.lj * N + c.li;
    const side = layout.edgesN[idx] === W.FULL ? 'N' : layout.edgesW[idx] === W.FULL ? 'W' : null;
    // keep clear of pillars at the two corners of that wall
    const pil = (a, b) => layout.pillars.some((p) => p.li === a && p.lj === b);
    if (side && (pil(c.li, c.lj) || (side === 'N' ? pil(c.li + 1, c.lj) : pil(c.li, c.lj + 1)))) return;
    if (side) {
      layout.decor.push({ kind: 'clip', li: c.li, lj: c.lj, type: rng.pick(['desk', 'chair_wood', 'filing_cabinet', 'bookshelf', 'couch']), side, slide: rng.range(-0.5, 0.5), yaw: rng.range(-0.18, 0.18) });
      return;
    }
  }
  // great halls: the emptiness is the point, one lonely object at most
  if (c.hall) {
    if (h < 0.025) sp(layout, rng.pick(['chair_wood', 'chair_office', 'wet_floor_sign', 'box_small', 'trash_can', 'lamp_floor']), cx + r(), cz + r(), rng.next() * 6.28);
    if (hash01(c.i, c.j, 62, seed) < 0.03) sp(layout, rng.weighted(LOOT_RARE), cx + r(), cz + r(), rng.next() * 6.28);
    return;
  }
  // furniture vignettes (the bulk of the haulable loot)
  const vt = ZONE_VIGNETTES[c.zone];
  if (vt && !c.water && hash01(c.i, c.j, 67, seed) < (ZONE_VIG_P[c.zone] ?? 0.12)) {
    if (addVignette(layout, c, rng.weighted(vt), rng, seed)) {
      if (hash01(c.i, c.j, 62, seed) < 0.05) sp(layout, rng.weighted(LOOT_RARE), cx + r(), cz + r(), rng.next() * 6.28);
      return;
    }
  }
  switch (c.zone) {
    case 'halls':
    case 'dark':
    case 'manila':
    case 'lounge':
    case 'atrium':
    case 'corridors':
    case 'lowrooms': {
      if (h < 0.07) sp(layout, rng.pick(['chair_wood', 'chair_wood', 'chair_folding', 'box_small', 'box_medium', 'trash_can', 'wet_floor_sign', 'traffic_cone', 'paper_stack', 'bucket', 'stool', 'plant_small']), cx + r(), cz + r(), rng.next() * 6.28);
      else if (h < 0.11) sp(layout, rng.pick(['table_folding', 'chair_office', 'box_large', 'water_jug', 'step_ladder', 'nightstand', 'plant_pot', 'cabinet_low']), cx + r() * 0.5, cz + r() * 0.5, rng.next() * 6.28);
      else if (h < 0.13 && c.zone !== 'lowrooms') sp(layout, rng.pick(['lamp_floor', 'coat_rack', 'armchair', 'filing_cabinet']), cx + r() * 0.5, cz + r() * 0.5, rng.next() * 6.28);
      if (hash01(c.i, c.j, 62, seed) < (c.zone === 'dark' ? 0.06 : 0.035)) sp(layout, rng.weighted(LOOT_RARE), cx + r(), cz + r(), rng.next() * 6.28);
      break;
    }
    case 'office': {
      if (h < 0.3) {
        // desk front (drawers, knee space) is +Z: the chair and the monitor/keyboard face that side.
        // Desk top is 0.76 m; desk items spawn just above it so they settle without a drop.
        sp(layout, 'desk', cx, cz - 0.3, r() * 0.04, { base: true });
        if (rng.chance(0.8)) sp(layout, 'chair_office', cx + r() * 0.3, cz + 0.6, Math.PI + r() * 0.9);
        if (rng.chance(0.6)) sp(layout, 'crt_monitor', cx - 0.15 + r() * 0.15, cz - 0.42, r() * 0.35, { y: 0.76 });
        if (rng.chance(0.45)) sp(layout, 'keyboard', cx - 0.15 + r() * 0.08, cz - 0.04, r() * 0.12, { y: 0.76 });
        if (rng.chance(0.4)) sp(layout, rng.pick(['desk_phone', 'mug', 'paper_stack', 'binder', 'lamp_desk']), cx + 0.45, cz - 0.38, rng.next() * 6.28, { y: 0.76 });
      } else if (h < 0.42) sp(layout, 'desk_cubicle_panel', cx, z0 + 0.34, 0);
      else if (h < 0.5) sp(layout, 'filing_cabinet', cx + r(), cz + r(), rng.pick([0, Math.PI / 2, Math.PI]));
      else if (h < 0.6) sp(layout, rng.pick(['printer', 'plant_pot', 'whiteboard', 'trash_can', 'computer_tower', 'box_medium', 'cabinet_low']), cx + r(), cz + r(), rng.next() * 6.28);
      if (hash01(c.i, c.j, 62, seed) < 0.04) sp(layout, rng.weighted(LOOT_RARE), cx + r(), cz + r(), rng.next() * 6.28);
      break;
    }
    case 'maintenance': {
      if (h < 0.22) sp(layout, rng.pick(['barrel', 'barrel', 'crate_wood', 'pallet', 'bucket', 'pipe', 'cinder_block', 'toolbox', 'tire', 'sandbag', 'hand_truck']), cx + r(), cz + r(), rng.next() * 6.28);
      if (hash01(c.i, c.j, 62, seed) < 0.07) sp(layout, rng.pick(['plank', 'metal_scrap', 'screws', 'wire_spool', 'pipe_short', 'gear', 'fabric_scrap', 'battery', 'tape_roll']), cx + r(), cz + r(), rng.next() * 6.28);
      if (hash01(c.i, c.j, 63, seed) < 0.04) layout.decor.push({ kind: 'pipes', li: c.li, lj: c.lj });
      break;
    }
    case 'warehouse': {
      // racks carry their own boxes (rooms / yellow.js); the floor gets pallets, barrels, hand trucks
      if (h < 0.16) sp(layout, rng.pick(['pallet', 'crate_wood', 'barrel', 'hand_truck', 'box_large', 'step_ladder']), cx + r() * 0.5, cz + r() * 0.3, rng.next() * 6.28);
      if (hash01(c.i, c.j, 62, seed) < 0.04) sp(layout, rng.weighted(LOOT_RARE), cx + r(), cz + r() * 0.3, rng.next() * 6.28);
      break;
    }
    case 'flooded': {
      if (h < 0.06) sp(layout, rng.pick(['bucket', 'mop', 'chair_wood', 'wet_floor_sign', 'barrel', 'box_medium']), cx + r(), cz + r(), rng.next() * 6.28);
      if (hash01(c.i, c.j, 62, seed) < 0.02) sp(layout, 'almond_water', cx + r(), cz + r(), 0);
      break;
    }
    case 'pillars': {
      if (h < 0.1) sp(layout, rng.pick(['chair_wood', 'chair_folding', 'table_round', 'box_small', 'traffic_cone']), cx + r(), cz + r(), rng.next() * 6.28);
      break;
    }
  }
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
// nav blockers (warehouse racks) on the N / W edge of global cell (i, j)
export function edgeBlocked(seed, i, j, axis, variantFn) {
  const cx = floorDiv(i, CHUNK), cz = floorDiv(j, CHUNK);
  const l = getLayout(seed, cx, cz, variantFn ? variantFn(cx, cz) : 0);
  return (l.block[(j - cz * CHUNK) * CHUNK + (i - cx * CHUNK)] & (axis === 'n' ? 1 : 2)) !== 0;
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
