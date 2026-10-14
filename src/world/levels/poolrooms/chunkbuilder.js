// Builds the static geometry, colliders, water and baked lighting of one Poolrooms chunk.
// Geometry is accumulated per material in Meshers, baked once per chunk (in time slices when
// streaming) and turned into ~12-18 draw calls.
import * as THREE from 'three';
import { RAPIER, GROUPS } from '../../../physics/physics.js';
import { LightField } from '../../../gfx/bakedlight.js';
import {
  CELL, CHUNK, HEIGHT, TALL, W, T, WATER_Y, SUNK_Y, VAULT_SPRING, getLayout, cellInfo, wallN, wallW,
  wallTransmission,
} from './layout.js';
import { Mesher, archWall, groinVault } from './geo.js';
import { Baker } from './bake.js';
import { surface, BASE } from './poolmat.js';
import { buildPool, poolRect, poolWaterQuads, drainGrate, TINT_NOSE } from './pools.js';
import { poolPoint, poolCoords, poolFloorAt } from './layout.js';
import * as Mat from '../../../gfx/materials.js';
import { lifeguardChair, bench, showerColumn, pipeRun, pumpUnit, filterTank, tileDebris, shaftGeometry, shaftMaterial, waterslide } from './decor.js';
import { SIGN, signQuad, signBaseMaterial } from './signs.js';
import { hash01 } from '../../../core/rng.js';

export const LIGHT_TONES = [
  new THREE.Color(0.95, 0.99, 1.0),   // 0 halls panels: neutral cool white
  new THREE.Color(0.92, 0.96, 1.03),  // 1 offices
  new THREE.Color(1.0, 0.87, 0.68),   // 2 plant rooms
  new THREE.Color(1.0, 0.88, 0.58),   // 3 yellow bleed (Level 0 fluorescents)
  new THREE.Color(0.7, 0.9, 0.92),    // 4 drowned rooms
  new THREE.Color(0.93, 0.98, 1.07),  // 5 skylight daylight
  new THREE.Color(0.86, 1.0, 0.92),   // 6 flooded halls: sickly fluorescent
  new THREE.Color(1.0, 0.97, 0.92),   // 7 dome downlights
];
const TONE_INT = [1.12, 1.1, 0.85, 0.95, 0.8, 1.85, 1.0, 1.25];

export function cellLightSpec(c) {
  if (!c.light) return null;
  const sky = c.lightKind === 'sky';
  return {
    x: (c.i + 0.5) * CELL,
    y: c.vault ? TALL - 0.08 : c.ceil + (sky ? 0.2 : -0.06),
    z: (c.j + 0.5) * CELL,
    radius: sky ? 12.5 : c.ceil > 4 ? 11 : 9,
    color: LIGHT_TONES[c.lightTone] || LIGHT_TONES[0],
    base: TONE_INT[c.lightTone] ?? 1,
    mode: c.lightMode,
    seed: c.lightSeed,
    sky,
  };
}

const solidEdge = (t) => t === W.FULL || t === W.DOOR || t === W.HALF_A || t === W.HALF_B || t === W.WINDOW;
const ceilOf = (c) => (c ? c.ceil : HEIGHT);
const floorOf = (c) => (!c ? 0 : c.floor === 'pool' ? (c.pool.room ? Math.min(c.pool.shallowY, c.pool.deepY) : 0) : c.fy);

// ---------------------------------------------------------------------------
// queries shared with the level (light baking, probes)
export function makeQueries(seed, variantFn) {
  const cellAt = (i, j) => cellInfo(seed, i, j, variantFn);
  const eN = (i, j) => wallN(seed, i, j, variantFn);
  const eW = (i, j) => wallW(seed, i, j, variantFn);

  function occl(x0, z0, x1, z1, sy, ly) {
    let tr = 1;
    if (sy !== undefined && sy < -0.03) {
      const c = cellAt(Math.floor(x0 / CELL), Math.floor(z0 / CELL));
      if (c && c.pool) {
        const r = poolRect(c.pool, (c.i - c.li) * CELL, (c.j - c.lj) * CELL);
        const lyy = ly ?? HEIGHT;
        const t = (0 - sy) / Math.max(0.05, lyy - sy);
        const qx = x0 + (x1 - x0) * t, qz = z0 + (z1 - z0) * t;
        if (qx < r.X0 - 0.04 || qx > r.X1 + 0.04 || qz < r.Z0 - 0.04 || qz > r.Z1 + 0.04) return 0;
        x0 = qx; z0 = qz;
      }
    }
    let i = Math.floor(x0 / CELL), j = Math.floor(z0 / CELL);
    const ie = Math.floor(x1 / CELL), je = Math.floor(z1 / CELL);
    if (i === ie && j === je) return tr;
    const dx = x1 - x0, dz = z1 - z0;
    const stepI = dx > 0 ? 1 : -1, stepJ = dz > 0 ? 1 : -1;
    const tDx = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
    const tDz = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
    let tMx = dx !== 0 ? ((dx > 0 ? (i + 1) * CELL - x0 : x0 - i * CELL) / Math.abs(dx)) : Infinity;
    let tMz = dz !== 0 ? ((dz > 0 ? (j + 1) * CELL - z0 : z0 - j * CELL) / Math.abs(dz)) : Infinity;
    for (let n = 0; n < 14 && (i !== ie || j !== je); n++) {
      let ni = i, nj = j;
      if (tMx < tMz) {
        const wi = stepI > 0 ? i + 1 : i;
        tr *= wallTransmission(eW(wi, j));
        ni = i + stepI;
        tMx += tDx;
      } else {
        const wj = stepJ > 0 ? j + 1 : j;
        tr *= wallTransmission(eN(i, wj));
        nj = j + stepJ;
        tMz += tDz;
      }
      if (ly !== undefined) {
        const a = cellAt(i, j), b = cellAt(ni, nj);
        if (ly > Math.min(ceilOf(a), ceilOf(b)) + 0.05) tr *= 0.3;
      }
      i = ni; j = nj;
      if (tr < 0.02) return 0;
    }
    return tr;
  }

  function ao(x, y, z, nx, ny, nz) {
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
    const fx = x - i * CELL, fz = z - j * CELL;
    const c = cellAt(i, j);
    if (!c) return 1;
    let d = 9;
    if (solidEdge(eN(i, j))) d = Math.min(d, fz);
    if (solidEdge(eN(i, j + 1))) d = Math.min(d, CELL - fz);
    if (solidEdge(eW(i, j))) d = Math.min(d, fx);
    if (solidEdge(eW(i + 1, j))) d = Math.min(d, CELL - fx);
    if (c.pool && y < -0.02) {
      const r = poolRect(c.pool, (c.i - c.li) * CELL, (c.j - c.lj) * CELL);
      const db = Math.min(x - r.X0, r.X1 - x, z - r.Z0, r.Z1 - z);
      if (ny > 0.5) return 0.6 + 0.4 * Math.min(1, db / 0.6);
      return 0.78 + 0.22 * Math.min(1, Math.max(0, -y) / 0.5);
    }
    const fy = floorOf(c);
    if (ny > 0.5) return 0.62 + 0.38 * Math.min(1, d / 0.8);
    if (ny < -0.5) return 0.74 + 0.26 * Math.min(1, d / 0.8);
    const v = Math.min(1, Math.max(0, y - fy) / 0.45) * 0.24 + 0.76;
    const top = Math.min(1, Math.max(0, ceilOf(c) - y) / 0.4) * 0.14 + 0.86;
    return v * top;
  }

  function caust(x, y, z, nx, ny, nz) {
    if (y < WATER_Y - 0.005) return 1;
    if (ny > 0.5) return 0;
    const i0 = Math.floor(x / CELL), j0 = Math.floor(z / CELL);
    let best = 9;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const c = cellAt(i0 + di, j0 + dj);
      if (!c || !c.water) continue;
      const cx0 = (i0 + di) * CELL, cz0 = (j0 + dj) * CELL;
      const ddx = Math.max(cx0 - x, 0, x - (cx0 + CELL)), ddz = Math.max(cz0 - z, 0, z - (cz0 + CELL));
      best = Math.min(best, Math.hypot(ddx, ddz));
    }
    if (best > 5.5) return 0;
    const h = y - WATER_Y;
    if (ny < -0.5) return Math.exp(-best * 0.75) * (1 - Math.min(1, Math.max(0, h - 4.9)));
    return Math.exp(-best * 1.25) * Math.exp(-Math.max(0, h - 0.15) * 0.42);
  }

  // per-vertex deck wetness: puddles near water, dry far away
  function wetAt(x, z) {
    const i0 = Math.floor(x / CELL), j0 = Math.floor(z / CELL);
    const c = cellAt(i0, j0);
    let w = c ? c.wet * 0.55 : 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const o = cellAt(i0 + di, j0 + dj);
      if (!o || !o.water) continue;
      const cx0 = (i0 + di) * CELL, cz0 = (j0 + dj) * CELL;
      const ddx = Math.max(cx0 - x, 0, x - (cx0 + CELL)), ddz = Math.max(cz0 - z, 0, z - (cz0 + CELL));
      w = Math.max(w, Math.exp(-Math.hypot(ddx, ddz) * 1.6));
    }
    return Math.min(1, w);
  }
  return { cellAt, eN, eW, occl, ao, caust, wetAt };
}

function makeGlow(lamps) {
  return function glow(x, y, z, nx, ny, nz, out) {
    for (const L of lamps) {
      if (!L.on) continue;
      const r = L.rect;
      const inside = x > r.X0 - 0.06 && x < r.X1 + 0.06 && z > r.Z0 - 0.06 && z < r.Z1 + 0.06;
      if (!inside) continue;
      const dx = L.x - x, dy = L.y - y, dz = L.z - z;
      const d2 = dx * dx + dy * dy + dz * dz, d = Math.sqrt(d2);
      const lam = Math.max(0, (dx * nx + dy * ny + dz * nz) / Math.max(d, 1e-3)) * 0.7 + 0.3;
      let k = (1.1 / (1 + 1.4 * d2)) * lam;
      if (y > WATER_Y + 0.02) k *= ny < -0.5 ? 0.1 : 0.05;
      out[0] += 0.32 * k; out[1] += 0.72 * k; out[2] += 1.0 * k;
    }
  };
}

// ---------------------------------------------------------------------------
export function buildChunk(level, cx, cz) {
  const it = buildChunkSteps(level, cx, cz);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

// `out.rec` exposes the chunk record while it is being built, so an aborted build can be undone
export function* buildChunkSteps(level, cx, cz, out = null) {
  const seed = level.seed;
  const layout = getLayout(seed, cx, cz, level.variantFn(cx, cz));
  const N = CHUNK;
  const ox = cx * N * CELL, oz = cz * N * CELL;
  const Q = level.Q;
  const group = new THREE.Group();
  group.name = `chunk:${cx},${cz}`;
  const rec = { colliders: [], group, layout, cx, cz, statics: [], waterCells: [], physicsColliders: [], extraBodies: [], ladders: [], vents: [], meshes: [] };
  if (out) out.rec = rec;
  const B = {
    wall: new Mesher({ seg: 0.75 }),
    floor: new Mesher({ wet: true, seg: 0.75 }),
    floorSub: new Mesher({ seg: 0.75 }),
    pool: new Mesher({ seg: 0.6 }),
    trim: new Mesher({ seg: 0.75 }),
    chrome: new Mesher({ seg: 3 }),
    emit: new Mesher({ seg: 3 }),
    sky: new Mesher({ seg: 3 }),
    port: new Mesher({ seg: 3 }),
    lamp: new Mesher({ seg: 3 }),
    void: new Mesher({ seg: 3 }),
    rope: new Mesher({ seg: 3 }),
    wallSub: new Mesher({ seg: 0.75 }),
    steel: new Mesher({ seg: 3 }),
    wood: new Mesher({ seg: 3 }),
    rescue: new Mesher({ seg: 3 }),
    pipe: new Mesher({ seg: 3 }),
    tank: new Mesher({ seg: 3 }),
    red: new Mesher({ seg: 3 }),
    concrete: new Mesher({ seg: 0.75 }),
    yWall: new Mesher({ seg: 0.75 }),
    yFloor: new Mesher({ seg: 0.75 }),
    yCeil: new Mesher({ seg: 0.75 }),
    sign: new Mesher({ seg: 3 }),
    slide: new Mesher({ seg: 3 }),
    slideIn: new Mesher({ seg: 3 }),
    boxes: [], rboxes: [], lamps: [], ladders: [], floats: [], shafts: [],
    water: { pos: [], floor: [], idx: [] }, spill: { pos: [], floor: [], idx: [] },
    windows: new Map(), grilles: new Map(), drains: [],
  };
  for (const w of layout.windows) B.windows.set(`${w.li},${w.lj},${w.side}`, w);
  for (const g of layout.grilles) B.grilles.set(`${g.li},${g.lj},${g.side}`, g);

  yield* emitFloors(B, Q, layout, ox, oz);
  yield 'floors';
  yield* emitCeilings(B, Q, layout, ox, oz);
  yield 'ceilings';
  yield* emitWalls(B, Q, layout, ox, oz, rec);
  yield 'walls';
  emitPillars(B, Q, layout, ox, oz);
  yield 'pillars';
  for (const p of layout.pools) {
    const nl = B.lamps.length;
    buildPool(B, p, ox, oz);
    const r = poolRect(p, ox, oz);
    for (let k = nl; k < B.lamps.length; k++) B.lamps[k].rect = r;
    poolWaterQuads(B.water, p, ox, oz);
    for (let j = p.rz; j < p.rz + p.h; j++) for (let i = p.rx; i < p.rx + p.w; i++) rec.waterCells.push(layout.cells[j * N + i]);
  }
  yield 'pools';
  // sunk-cell water + spill sheets
  for (const c of layout.cells) {
    if (c.floor === 'sunk' && c.water) { waterCell(B.water, c, WATER_Y, SUNK_Y); rec.waterCells.push(c); }
    else if (c.spill && !c.pool) waterCell(B.spill, c, 0, 0);
  }
  // tube slides
  for (const d of layout.decor) {
    if (d.kind !== 'slide') continue;
    const p = layout.pools[d.pool];
    const A = (p.axis === 'x' ? p.h : p.w) * CELL;
    const out = (m) => (d.side < 0 ? -m / A : 1 + m / A); // m metres outside the long side (negative = inside)
    const P = (s, m, y) => { const [x, z] = poolPoint(p, ox, oz, s, out(m)); return new THREE.Vector3(x, y, z); };
    const s0 = d.s;
    const ceil = layout.cells[p.rz * CHUNK + p.rx].ceil;
    const pts = [P(s0 + 1.55, 1.75, ceil + 0.6), P(s0 + 1.6, 1.8, ceil - 0.5), P(s0 + 1.2, 2.25, 3.25), P(s0 + 0.2, 2.2, 2.55), P(s0 - 0.6, 1.5, 1.85), P(s0 - 0.45, 0.6, 1.2), P(s0 + 0.15, -0.25, 0.62), P(s0 + 0.45, -1.1, WATER_Y + 0.42)];
    const ground = (x, z) => {
      const c = Q.cellAt(Math.floor(x / CELL), Math.floor(z / CELL));
      if (!c) return 0;
      if (!c.pool) return floorOf(c);
      const pr = c.pool, [ss, tt] = poolCoords(pr, (c.i - c.li) * CELL, (c.j - c.lj) * CELL, x, z);
      return poolFloorAt(pr, Math.max(0, Math.min(pr.L - 1e-3, ss)), Math.max(0, Math.min(1, tt)));
    };
    for (const b of waterslide(B, pts, ceil, ground)) B.boxes.push(b);
  }
  // lifeguard chairs beside the big pools
  for (const d of layout.decor) {
    if (d.kind !== 'lifeguard') continue;
    const p = layout.pools[d.pool];
    const A = (p.axis === 'x' ? p.h : p.w) * CELL;
    const t = d.side < 0 ? -0.95 / A : 1 + 0.95 / A;
    const [x, z] = poolPoint(p, ox, oz, d.s, t);
    const [px, pz] = poolPoint(p, ox, oz, d.s, 0.5);
    for (const b of lifeguardChair(B, x, z, Math.atan2(px - x, pz - z))) B.boxes.push(b);
  }
  yield 'decor';
  // room set dressing
  for (const room of layout.specials) roomGeometry(B, Q, room, layout, ox, oz);
  // light shafts under skylights
  for (const c of layout.cells) {
    if (!c.light || c.lightKind !== 'sky' || c.vault) continue;
    const top = c.ceil + 0.7, bot = c.pool ? WATER_Y : c.fy;
    B.shafts.push({ x: (c.i + 0.5) * CELL, z: (c.j + 0.5) * CELL, y0: top, y1: bot, h0: 0.86, h1: 1.35, key: LightField.texel(c.i, c.j) });
  }
  rec.lamps = B.lamps;
  yield 'geometry';

  // ---- bake & meshes ----
  const field = level.field;
  const ctx = { lightsNear: level.lightsNear, occl: Q.occl, ao: Q.ao, caust: Q.caust, glow: makeGlow(B.lamps) };
  const baker = new Baker(ctx);
  const meshes = [];
  const add = function* (M, mat, opts = {}) {
    if (M.isEmpty()) return;
    const geo = M.build();
    yield 'mesh';
    if (opts.own) bakeOwn(geo, opts.ownW ?? 1);
    else yield* baker.bakeIter(geo, opts.bake || {});
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = !!opts.cast;
    mesh.matrixAutoUpdate = false;
    // submerged / small detail meshes are skipped by the mirrored water pass
    if (opts.noRefl) mesh.userData.noRefl = true;
    meshes.push(mesh);
  };
  yield* add(B.wall, surface(BASE.wallTile(), field, {}), { cast: true, bake: { bounce: 0.55 } });
  yield* add(B.floor, surface(BASE.deckTile(), field, { wet: true }), { bake: { bounce: 0.5 } });
  yield* add(B.floorSub, surface(BASE.deckTile(), field, { sub: true }), { bake: { bounce: 0.5 }, noRefl: true });
  yield* add(B.pool, surface(BASE.mosaic(), field, { sub: true }), { bake: { bounce: 0.45 }, noRefl: true });
  yield* add(B.trim, surface(BASE.coping(), field, {}), { cast: true, bake: { bounce: 0.5, mode: 'fast' } });
  yield* add(B.chrome, surface(BASE.chrome(), field, {}), { cast: true, bake: { mode: 'fast' } });
  yield* add(B.rope, surface(BASE.rope(), field, {}), { bake: { mode: 'fast' }, noRefl: true });
  yield* add(B.emit, surface(BASE.diffuser(), field, { emit: 0.9, noCaust: true }), { own: true });
  yield* add(B.sky, surface(BASE.sky(), field, { emit: 0.75, noCaust: true }), { own: true });
  yield* add(B.port, surface(BASE.porthole(), field, { emit: 1.4, noCaust: true }), { bake: { mode: 'fast' } });
  yield* add(B.lamp, surface(BASE.lamp(), field, { lamp: true, noCaust: true }), { bake: { mode: 'fast' }, noRefl: true });
  yield* add(B.wallSub, surface(BASE.wallTile(), field, { sub: true }), { bake: { bounce: 0.5 }, noRefl: true });
  yield* add(B.steel, surface(BASE.steel(), field, {}), { cast: true, bake: { mode: 'fast' } });
  yield* add(B.wood, surface(BASE.wood(), field, {}), { cast: true, bake: { mode: 'fast' }, noRefl: true });
  yield* add(B.rescue, surface(BASE.rescue(), field, {}), { cast: true, bake: { mode: 'fast' }, noRefl: true });
  yield* add(B.pipe, surface(BASE.pvc(), field, {}), { cast: true, bake: { mode: 'fast' }, noRefl: true });
  yield* add(B.tank, surface(BASE.tank(), field, {}), { cast: true, bake: { mode: 'fast' }, noRefl: true });
  yield* add(B.red, surface(BASE.red(), field, {}), { bake: { mode: 'fast' }, noRefl: true });
  yield* add(B.concrete, surface(BASE.plantFloor(), field, { wet: false }), { bake: { bounce: 0.45 }, noRefl: true });
  yield* add(B.yWall, surface(Mat.get('wallpaper'), field, {}), { cast: true, bake: { bounce: 0.4 }, noRefl: true });
  yield* add(B.yFloor, surface(Mat.get('carpet'), field, {}), { bake: { bounce: 0.4 }, noRefl: true });
  yield* add(B.yCeil, surface(Mat.get('ceiling'), field, {}), { bake: { bounce: 0.55, direct: 0.3 }, noRefl: true });
  yield* add(B.sign, surface(signBaseMaterial(), field, {}), { bake: { mode: 'fast' }, noRefl: true });
  yield* add(B.slide, surface(BASE.slide(), field, {}), { cast: true, bake: { mode: 'fast' } });
  yield* add(B.slideIn, surface(BASE.slideIn(), field, {}), { bake: { mode: 'fast' }, noRefl: true });
  for (const m of meshes) { group.add(m); rec.meshes.push(m); }
  if (B.shafts.length) {
    const sm = new THREE.Mesh(shaftGeometry(B.shafts), shaftMaterial(field));
    sm.renderOrder = 5;
    sm.matrixAutoUpdate = false;
    group.add(sm);
    rec.shaftMesh = sm;
    level.reflection.hide.add(sm);
  }
  if (!B.void.isEmpty()) {
    const m = new THREE.Mesh(B.void.build(), BASE.void());
    m.matrixAutoUpdate = false;
    group.add(m);
  }
  yield 'details';

  // ---- water ----
  const wmesh = yield* waterMesh(B.water, baker, level.waterMaterial, WATER_Y);
  if (wmesh) { group.add(wmesh); rec.waterMesh = wmesh; level.reflection.meshes.add(wmesh); }
  const smesh = yield* waterMesh(B.spill, baker, level.waterMaterial, 0);
  if (smesh) { smesh.visible = false; group.add(smesh); rec.spillMesh = smesh; level.reflection.meshes.add(smesh); }
  // rope floats
  if (B.floats.length) {
    const im = level.floatMesh(B.floats);
    im.userData.noRefl = true;
    group.add(im);
    rec.floatMesh = im;
  }

  // ---- colliders ----
  yield 'water';
  yield* buildColliders(level, B, layout, ox, oz, rec);
  rec.ladders = B.ladders;
  group.updateMatrixWorld(true);
  return rec;
}

// emissive fixtures read only their own cell's light
function bakeOwn(geo, wOwn) {
  const pos = geo.attributes.position;
  const n = pos.count;
  const cells = new Float32Array(n * 4), wts = new Float32Array(n * 4), aoA = new Float32Array(n).fill(1);
  const ca = new Float32Array(n), gl = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const i = Math.floor(pos.getX(v) / CELL), j = Math.floor(pos.getZ(v) / CELL);
    cells[v * 4] = LightField.texel(i, j);
    wts[v * 4] = wOwn;
  }
  geo.setAttribute('aLightCells', new THREE.BufferAttribute(cells, 4));
  geo.setAttribute('aLightW', new THREE.BufferAttribute(wts, 4));
  geo.setAttribute('aAO', new THREE.BufferAttribute(aoA, 1));
  geo.setAttribute('aCaust', new THREE.BufferAttribute(ca, 1));
  geo.setAttribute('aGlow', new THREE.BufferAttribute(gl, 3));
  geo.setAttribute('aLDir', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
}

function waterCell(Wm, c, y, fy) {
  const x0 = c.i * CELL, z0 = c.j * CELL;
  const n = 6;
  const base = Wm.pos.length / 3;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { Wm.pos.push(x0 + (CELL * i) / n, y, z0 + (CELL * j) / n); Wm.floor.push(fy); }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = base + j * (n + 1) + i, b = a + 1, cc = a + n + 1, d = cc + 1;
    Wm.idx.push(a, cc, b, b, cc, d);
  }
}

function* waterMesh(Wm, baker, mat, baseY) {
  if (!Wm.pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(Wm.pos, 3));
  const nrm = new Float32Array(Wm.pos.length);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('aFloorY', new THREE.Float32BufferAttribute(Wm.floor, 1));
  g.setIndex(Wm.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(Wm.idx, 1) : new THREE.Uint16BufferAttribute(Wm.idx, 1));
  yield* baker.bakeIter(g, { bounce: 0.5 });
  g.computeBoundingSphere();
  g.computeBoundingBox();
  // allow the surface to rise later in the cycle without being culled
  g.boundingBox.max.y += 0.4;
  g.boundingSphere.radius += 0.4;
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = 3;
  m.userData.baseY = baseY;
  return m;
}

// ---------------------------------------------------------------------------
function* emitFloors(B, Q, layout, ox, oz) {
  const drains = new Map();
  for (const d of layout.drains) {
    const k = `${d.li},${d.lj}`;
    if (!drains.has(k)) drains.set(k, []);
    drains.get(k).push(d);
  }
  const wetFn = (p) => Q.wetAt(p.x, p.z);
  let n = 0;
  for (const c of layout.cells) {
    if ((++n & 15) === 0) yield 'floor';
    if (c.pool) continue;
    const x0 = c.i * CELL, z0 = c.j * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
    if (c.floor === 'sunk') {
      B.floorSub.setTint(1, 1, 1);
      B.floorSub.hface(SUNK_Y, 1, x0, x1, z0, z1);
      // steps up to dry neighbours: riser + dark nosing on the deck edge
      const nb = [[0, -1, 'z', z0, 1], [0, 1, 'z', z1, -1], [-1, 0, 'x', x0, 1], [1, 0, 'x', x1, -1]];
      for (const [di, dj, ax, d, sgn] of nb) {
        const o = Q.cellAt(c.i + di, c.j + dj);
        if (!o || o.floor === 'sunk' || o.pool) continue;
        const top = floorOf(o);
        if (ax === 'z') B.floorSub.vface('z', d, sgn, x0, x1, SUNK_Y, top);
        else B.floorSub.vface('x', d, sgn, z0, z1, SUNK_Y, top);
        B.floor.setTint(TINT_NOSE).setWet(0.6);
        if (ax === 'z') B.floor.hface(top + 0.0015, 1, x0, x1, sgn > 0 ? d - 0.06 : d, sgn > 0 ? d : d + 0.06);
        else B.floor.hface(top + 0.0015, 1, sgn > 0 ? d - 0.06 : d, sgn > 0 ? d : d + 0.06, z0, z1);
        B.floor.setTint(1, 1, 1);
      }
    } else {
      const holes = [];
      for (const d of drains.get(`${c.li},${c.lj}`) || []) {
        const x = ox + d.x, z = oz + d.z;
        holes.push({ x0: x - 0.15, x1: x + 0.15, z0: z - 0.15, z1: z + 0.15 });
        B.drains.push([x, z]);
      }
      if (c.roomStyle === 'yellow') { B.yFloor.hface(0, 1, x0, x1, z0, z1, holes); continue; }
      if (c.roomStyle === 'plant') { B.concrete.setTint(0.78, 0.84, 0.82); B.concrete.hface(0, 1, x0, x1, z0, z1, holes); continue; }
      B.floor.setTint(1, 1, 1);
      B.floor.hface(0, 1, x0, x1, z0, z1, holes, wetFn);
    }
  }
  for (const [x, z] of B.drains) drainGrate(B, x, 0, z, 0.15, 'x', true);
}

// ---------------------------------------------------------------------------
function* emitCeilings(B, Q, layout, ox, oz) {
  const N = CHUNK;
  const spawn = layout.specials.find((r) => r.kind === 'spawn');
  let n = 0;
  for (const c of layout.cells) {
    if ((++n & 7) === 0) yield 'ceil';
    const x0 = c.i * CELL, z0 = c.j * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
    const cxm = x0 + CELL / 2, czm = z0 + CELL / 2;
    const y = c.ceil;
    if (c.vault) {
      groinVault(B.wall, cxm, czm, CELL / 2, VAULT_SPRING, 8, 5);
      if (c.light) domeLight(B, cxm, TALL - 0.005, czm, 0.24);
      continue;
    }
    if (c.roomStyle === 'tunnel') {
      barrelVault(B.wall, x0, z0, x1, z1, y, c.special);
      if (c.light) domeLight(B, cxm, y - 0.005, czm, 0.18);
      continue;
    }
    const holes = [];
    if (spawn && c.special === spawn) {
      // the hole the clones fall through: centred on the room's middle corner
      const hx = ox + (spawn.rx + 1) * CELL, hz = oz + (spawn.rz + 1) * CELL;
      holes.push({ x0: hx - 1.15, x1: hx + 1.15, z0: hz - 1.15, z1: hz + 1.15 });
    }
    let kind = c.light ? c.lightKind : null;
    if (spawn && c.special === spawn) kind = c.light ? 'dome' : null;
    let hw = 0, hd = 0;
    if (kind === 'panel') { hw = c.lightRot && c.special ? 0.61 : 0.31; hd = c.lightRot && c.special ? 0.31 : 0.31; holes.push({ x0: cxm - hw, x1: cxm + hw, z0: czm - hd, z1: czm + hd }); }
    else if (kind === 'sky') { hw = hd = 0.9; holes.push({ x0: cxm - hw, x1: cxm + hw, z0: czm - hd, z1: czm + hd }); }
    const CM = c.roomStyle === 'yellow' ? B.yCeil : B.wall;
    CM.setTint(1, 1, 1);
    CM.hface(y, -1, x0, x1, z0, z1, holes);
    if (kind === 'panel') panelLight(B, cxm, y, czm, hw, hd, CM);
    else if (kind === 'sky') skyLight(B, cxm, y, czm, hw);
    else if (kind === 'dome') domeLight(B, c.special === spawn ? cxm + (c.li === spawn.rx ? -0.6 : 0.6) : cxm, y - 0.004, c.special === spawn ? czm + (c.lj === spawn.rz ? -0.6 : 0.6) : czm, 0.2);
  }
  if (spawn) spawnHole(B, ox + (spawn.rx + 1) * CELL, HEIGHT, oz + (spawn.rz + 1) * CELL);
  void N;
}

function panelLight(B, x, y, z, hw, hd, RM = B.wall) {
  const dep = 0.05;
  // recess sides
  RM.vface('x', x - hw, 1, z - hd, z + hd, y, y + dep);
  RM.vface('x', x + hw, -1, z - hd, z + hd, y, y + dep);
  RM.vface('z', z - hd, 1, x - hw, x + hw, y, y + dep);
  RM.vface('z', z + hd, -1, x - hw, x + hw, y, y + dep);
  B.emit.hface(y + dep, -1, x - hw, x + hw, z - hd, z + hd);
  // chrome trim ring
  const f = 0.028, t0 = y - 0.01;
  const C = B.chrome;
  C.box(new THREE.Vector3(x - hw - f, t0, z - hd - f), new THREE.Vector3(x + hw + f, y, z - hd), { py: true });
  C.box(new THREE.Vector3(x - hw - f, t0, z + hd), new THREE.Vector3(x + hw + f, y, z + hd + f), { py: true });
  C.box(new THREE.Vector3(x - hw - f, t0, z - hd), new THREE.Vector3(x - hw, y, z + hd), { py: true });
  C.box(new THREE.Vector3(x + hw, t0, z - hd), new THREE.Vector3(x + hw + f, y, z + hd), { py: true });
}

function skyLight(B, x, y, z, h) {
  const dep = 0.75;
  B.wall.vface('x', x - h, 1, z - h, z + h, y, y + dep);
  B.wall.vface('x', x + h, -1, z - h, z + h, y, y + dep);
  B.wall.vface('z', z - h, 1, x - h, x + h, y, y + dep);
  B.wall.vface('z', z + h, -1, x - h, x + h, y, y + dep);
  B.sky.hface(y + dep, -1, x - h, x + h, z - h, z + h);
  const C = B.chrome;
  const yb = y + dep - 0.05;
  for (const f of [-h / 3, h / 3]) {
    C.box(new THREE.Vector3(x + f - 0.022, yb, z - h), new THREE.Vector3(x + f + 0.022, y + dep, z + h), { py: true });
    C.box(new THREE.Vector3(x - h, yb, z + f - 0.022), new THREE.Vector3(x + h, y + dep, z + f + 0.022), { py: true });
  }
  const fw = 0.04;
  C.box(new THREE.Vector3(x - h, yb, z - h), new THREE.Vector3(x + h, y + dep, z - h + fw), { py: true });
  C.box(new THREE.Vector3(x - h, yb, z + h - fw), new THREE.Vector3(x + h, y + dep, z + h), { py: true });
  C.box(new THREE.Vector3(x - h, yb, z - h), new THREE.Vector3(x - h + fw, y + dep, z + h), { py: true });
  C.box(new THREE.Vector3(x + h - fw, yb, z - h), new THREE.Vector3(x + h, y + dep, z + h), { py: true });
}

function domeLight(B, x, y, z, r) {
  const m = new THREE.Matrix4().makeTranslation(x, y, z);
  B.emit.lathe([[0, -0.045], [r * 0.5, -0.04], [r * 0.85, -0.028], [r, -0.012]], 20, m);
  B.chrome.lathe([[r, -0.012], [r + 0.012, -0.016], [r + 0.035, -0.012], [r + 0.045, -0.004], [r + 0.046, 0.0]], 20, m);
}

function spawnHole(B, x, y, z) {
  // dark shaft above the broken ceiling + jagged hanging tile shards
  const h = 1.15;
  B.void.hface(y + 1.6, -1, x - h, x + h, z - h, z + h);
  B.void.vface('x', x - h, 1, z - h, z + h, y, y + 1.6);
  B.void.vface('x', x + h, -1, z - h, z + h, y, y + 1.6);
  B.void.vface('z', z - h, 1, x - h, x + h, y, y + 1.6);
  B.void.vface('z', z + h, -1, x - h, x + h, y, y + 1.6);
  // broken tile lips around the hole edge (thickness of the ceiling slab)
  B.wall.vface('x', x - h, -1, z - h, z + h, y, y + 0.06);
  B.wall.vface('x', x + h, 1, z - h, z + h, y, y + 0.06);
  B.wall.vface('z', z - h, -1, x - h, x + h, y, y + 0.06);
  B.wall.vface('z', z + h, 1, x - h, x + h, y, y + 0.06);
  let s = 1;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let k = 0; k < 14; k++) {
    const side = k % 4;
    const f = -h + 0.15 + rnd() * (2 * h - 0.3);
    const px = side === 0 ? x - h : side === 1 ? x + h : x + f;
    const pz = side === 2 ? z - h : side === 3 ? z + h : z + f;
    const w = 0.1 + rnd() * 0.12, len = 0.12 + rnd() * 0.25;
    const g = new THREE.BoxGeometry(w, 0.012, len);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(px + (side === 0 ? 0.05 : side === 1 ? -0.05 : 0), y - len * 0.35, pz + (side === 2 ? 0.05 : side === 3 ? -0.05 : 0)),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(side >= 2 ? (side === 2 ? -1 : 1) * (0.9 + rnd() * 0.5) : rnd() * 0.3, rnd() * 0.6, side < 2 ? (side === 0 ? 1 : -1) * (0.9 + rnd() * 0.5) : rnd() * 0.3)),
      new THREE.Vector3(1, 1, 1));
    B.wall.append(g, m);
  }
}

// ---------------------------------------------------------------------------
// Walls
const DOOR_A = 0.9, DOOR_B = 2.1, DOOR_SPRING = 1.6;

function* emitWalls(B, Q, layout, ox, oz, rec) {
  const N = CHUNK;
  let n = 0;
  for (const c of layout.cells) {
    if ((++n & 7) === 0) yield 'wall';
    const tN = layout.edgesN[c.lj * N + c.li];
    if (tN) emitEdge(B, Q, c, Q.cellAt(c.i, c.j - 1), 'x', tN, rec);
    else bulkhead(B, Q, c, Q.cellAt(c.i, c.j - 1), 'x', 0, CELL);
    const tW = layout.edgesW[c.lj * N + c.li];
    if (tW) emitEdge(B, Q, c, Q.cellAt(c.i - 1, c.j), 'z', tW, rec);
    else bulkhead(B, Q, c, Q.cellAt(c.i - 1, c.j), 'z', 0, CELL);
  }
}

// geometry helpers in "edge space": s along the edge (0..CELL), o across (+ = toward cell c)
function edgeFrame(c, axis) {
  if (axis === 'x') return { d: c.j * CELL, s0: c.i * CELL, faceAxis: 'z' }; // wall along x at z = d
  return { d: c.i * CELL, s0: c.j * CELL, faceAxis: 'x' };
}

function emitEdge(B, Q, c, o, axis, type, rec) {
  const { d, s0, faceAxis } = edgeFrame(c, axis);
  const h = T / 2;
  const fyC = floorOf(c), fyO = floorOf(o);
  const y0 = Math.min(fyC, fyO) - 0.001;
  const top = Math.max(ceilOf(c), ceilOf(o));
  const tall = top > HEIGHT + 0.5;
  const M = B.wall;
  M.setTint(1, 1, 1);
  const boxes = B.boxes;
  const sideKey = axis === 'x' ? 'N' : 'W';
  const roomPool = !!(c?.pool || o?.pool);
  const win = roomPool ? null : B.windows.get(`${c.li},${c.lj},${sideKey}`);
  const gr = roomPool ? null : B.grilles.get(`${c.li},${c.lj},${sideKey}`);
  const pushBox = (sa, sb, ya, yb) => {
    if (axis === 'x') boxes.push({ min: [s0 + sa, ya, d - h], max: [s0 + sb, yb, d + h] });
    else boxes.push({ min: [d - h, ya, s0 + sa], max: [d + h, yb, s0 + sb] });
  };
  const sideMesher = (cell) => (cell?.roomStyle === 'yellow' ? B.yWall : M);
  const face1 = (Ms, cell, dd, sg, sa, sb, ya, yb, holes) => {
    if (cell?.pool?.room && ya < WATER_Y) {
      B.wallSub.vface(faceAxis, dd, sg, s0 + sa, s0 + sb, ya, Math.min(yb, WATER_Y), holes);
      if (yb > WATER_Y) Ms.vface(faceAxis, dd, sg, s0 + sa, s0 + sb, WATER_Y, yb, holes);
    } else Ms.vface(faceAxis, dd, sg, s0 + sa, s0 + sb, ya, yb, holes);
  };
  const faces = (sa, sb, ya, yb, holesC = null, holesO = null) => {
    // +o face (toward c) and -o face (toward o)
    face1(sideMesher(c), c, d + h, 1, sa, sb, ya, yb, holesC);
    face1(sideMesher(o), o, d - h, -1, sa, sb, ya, yb, holesO);
  };
  const endCap = (s, sgn, ya, yb) => {
    if (axis === 'x') M.vface('x', s0 + s, sgn, d - h, d + h, ya, yb);
    else M.vface('z', s0 + s, sgn, d - h, d + h, ya, yb);
  };
  const coves = (sa, sb) => {
    if (c && c.floor !== 'pool' && c.roomStyle !== 'yellow') cove(M, faceAxis, d + h, 1, s0 + sa, s0 + sb, fyC);
    if (o && o.floor !== 'pool' && o.roomStyle !== 'yellow') cove(M, faceAxis, d - h, -1, s0 + sa, s0 + sb, fyO);
  };
  const E0 = -h, E1 = CELL + h;
  switch (type) {
    case W.FULL: {
      const holesC = [], holesO = [];
      if (win) {
        const n = win.n, ww = 0.5, wh = 0.5;
        const yc = win.high ? top - 0.95 : Math.min(top - 0.55, 2.15);
        for (let k = 0; k < n; k++) {
          const sc = (CELL * (k + 0.5)) / n;
          const hr = { u0: s0 + sc - ww / 2, u1: s0 + sc + ww / 2, y0: yc - wh / 2, y1: yc + wh / 2 };
          holesC.push(hr); holesO.push(hr);
          porthole(B, axis, d, s0 + sc, yc, ww, wh, true);
        }
      }
      if (gr) {
        const hr = { u0: s0 + CELL / 2 - 0.28, u1: s0 + CELL / 2 + 0.28, y0: fyC + 0.1, y1: fyC + 0.36 };
        holesC.push(hr);
        grille(B, axis, d + h, 1, s0 + CELL / 2, fyC + 0.1, 0.56, 0.26, rec);
      }
      faces(E0, E1, y0, top, holesC.length ? holesC : null, holesO.length ? holesO : null);
      endCap(E0, -1, y0, top); endCap(E1, 1, y0, top);
      coves(E0, E1);
      pushBox(E0, E1, y0, top);
      if (!win && !gr && !roomPool && c.roomStyle !== 'yellow') wallSign(B, c, axis, d + h, s0, fyC);
      break;
    }
    case W.WINDOW: {
      // three see-through square openings at eye level
      const holes = [];
      for (let k = 0; k < 3; k++) {
        const sc = (CELL * (k + 0.5)) / 3;
        const hr = { u0: s0 + sc - 0.22, u1: s0 + sc + 0.22, y0: fyC + 1.08, y1: fyC + 1.52 };
        holes.push(hr);
        porthole(B, axis, d, s0 + sc, fyC + 1.3, 0.44, 0.44, false);
      }
      faces(E0, E1, y0, top, holes, holes);
      endCap(E0, -1, y0, top); endCap(E1, 1, y0, top);
      coves(E0, E1);
      pushBox(E0, E1, y0, top);
      break;
    }
    case W.DOOR:
    case W.ARCH: {
      let a, b, ys;
      if (type === W.DOOR) { a = DOOR_A; b = DOOR_B; ys = Math.max(fyC, fyO) + DOOR_SPRING; }
      else if (tall) { a = 0.42; b = 2.58; ys = Math.max(fyC, fyO) + 2.2; }
      else { a = 0.5; b = 2.5; ys = Math.max(fyC, fyO) + 1.52; }
      const r = (b - a) / 2;
      const apex = ys + r;
      const yBot = Math.min(fyC, fyO) - 0.001;
      archWall(M, axis, d, T, s0 + E0, s0 + E1, yBot, top, s0 + a, s0 + b, ys, 16);
      endCap(E0, -1, yBot, top); endCap(E1, 1, yBot, top);
      coves(E0, a); coves(b, E1);
      // threshold where floors differ (deck step) is drawn by the floors
      pushBox(E0, a, yBot, top);
      pushBox(b, E1, yBot, top);
      if (top > apex) pushBox(a, b, apex, top);
      pushBox(a, a + r * 0.32, ys + r * 0.62, top);
      pushBox(b - r * 0.32, b, ys + r * 0.62, top);
      pushBox(a, a + r * 0.12, ys + r * 0.25, top);
      pushBox(b - r * 0.12, b, ys + r * 0.25, top);
      break;
    }
    case W.HALF_A:
    case W.HALF_B: {
      const sa = type === W.HALF_A ? E0 : CELL * 0.5, sb = type === W.HALF_A ? CELL * 0.5 : E1;
      const free = type === W.HALF_A ? 'end' : 'start';
      if (axis === 'x') M.roundPrism(s0 + sa, d - h, s0 + sb, d + h, y0, top, 0.05, 4);
      else M.roundPrism(d - h, s0 + sa, d + h, s0 + sb, y0, top, 0.05, 4);
      coves(free === 'start' ? sa + 0.06 : sa, free === 'end' ? sb - 0.06 : sb);
      pushBox(sa, sb, y0, top);
      bulkhead(B, Q, c, o, axis, free === 'end' ? sb : 0, free === 'end' ? CELL : sa);
      break;
    }
    case W.LOW: {
      const lh = Math.max(fyC, fyO) + 1.0;
      if (axis === 'x') M.roundPrism(s0 + E0, d - h, s0 + E1, d + h, y0, lh, 0.04, 3);
      else M.roundPrism(d - h, s0 + E0, d + h, s0 + E1, y0, lh, 0.04, 3);
      // rounded cap
      const pts = axis === 'x'
        ? [new THREE.Vector3(s0 + E0 + 0.01, lh, d), new THREE.Vector3(s0 + E1 - 0.01, lh, d)]
        : [new THREE.Vector3(d, lh, s0 + E0 + 0.01), new THREE.Vector3(d, lh, s0 + E1 - 0.01)];
      B.trim.tube(pts, h + 0.012, 12, true);
      coves(E0, E1);
      pushBox(E0, E1, y0, lh + h);
      bulkhead(B, Q, c, o, axis, 0, CELL);
      break;
    }
    default: break;
  }
}

// occasional enamel sign on the +side face of a full wall
const WALL_SIGNS = [[SIGN.NO_RUNNING, 5], [SIGN.SHOWER, 3], [SIGN.LIFEGUARD, 2], [SIGN.ALONE, 2], [SIGN.CLOSED, 1.5], [SIGN.DEEP_END, 1], [SIGN.SHALLOW_END, 1], [SIGN.ROOM, 0.7], [SIGN.EXIT, 0.5]];
function wallSign(B, c, axis, dFace, s0, fy) {
  const h = hash01(c.i * 5 + (axis === 'x' ? 1 : 2), c.j, 97, 1);
  if (h > (c.special ? 0.25 : 0.1)) return;
  let r = hash01(c.i, c.j * 3 + 1, 98, 2) * WALL_SIGNS.reduce((a, b) => a + b[1], 0);
  let k = WALL_SIGNS[0][0];
  for (const [kk, w] of WALL_SIGNS) { r -= w; if (r <= 0) { k = kk; break; } }
  const sc = s0 + 0.7 + hash01(c.i, c.j, 99, 3) * 1.6, y = fy + 1.72, off = dFace + 0.004;
  if (axis === 'x') signQuad(B.sign, k, [sc, y, off], [0.28, 0, 0], [0, 0.14, 0], [0, 0, 1]);
  else signQuad(B.sign, k, [off, y, sc], [0, 0, -0.28], [0, 0.14, 0], [1, 0, 0]);
}

// header slab closing a ceiling height step on an edge (from the low ceiling to the high one)
function bulkhead(B, Q, c, o, axis, sa, sb) {
  if (!c || !o) return;
  if (c.vault && o.vault) return;
  const cc = ceilOf(c), co = ceilOf(o);
  if (Math.abs(cc - co) < 0.05) return;
  const lo = Math.min(cc, co), hi = Math.max(cc, co);
  const { d, s0, faceAxis } = edgeFrame(c, axis);
  const h = T / 2;
  const tallIsC = cc > co;
  const M = B.wall;
  M.setTint(1, 1, 1);
  const E0 = Math.max(-h, sa - (sa <= 0 ? h : 0)), E1 = Math.min(CELL + h, sb + (sb >= CELL ? h : 0));
  M.vface(faceAxis, d + (tallIsC ? h : -h), tallIsC ? 1 : -1, s0 + E0, s0 + E1, lo, hi);
  // underside (soffit) on the tall side half only (the low ceiling covers the rest)
  if (axis === 'x') M.hface(lo, -1, s0 + E0, s0 + E1, tallIsC ? d : d - h, tallIsC ? d + h : d);
  else M.hface(lo, -1, tallIsC ? d : d - h, tallIsC ? d + h : d, s0 + E0, s0 + E1);
  if (axis === 'x') B.boxes.push({ min: [s0 + E0, lo, d - h], max: [s0 + E1, hi, d + h] });
  else B.boxes.push({ min: [d - h, lo, s0 + E0], max: [d + h, hi, s0 + E1] });
}

// concave tile cove where a wall face meets the floor
function cove(M, faceAxis, d, sgn, s0, s1, yf, r = 0.075) {
  if (s1 - s0 < 0.02) return;
  const segs = 4;
  const base = M.vcount;
  const nu = Math.max(1, Math.round((s1 - s0) / 0.75));
  for (let i = 0; i <= nu; i++) {
    const s = s0 + ((s1 - s0) * i) / nu;
    for (let k = 0; k <= segs; k++) {
      const ph = (k / segs) * (Math.PI / 2);
      const off = r - r * Math.cos(ph), y = yf + r - r * Math.sin(ph);
      const no = Math.cos(ph), ny = Math.sin(ph);
      if (faceAxis === 'z') M.vert(s, y, d + sgn * off, 0, ny, sgn * no, s, (k / segs) * r * 1.57);
      else M.vert(d + sgn * off, y, s, sgn * no, ny, 0, s, (k / segs) * r * 1.57);
    }
  }
  const row = segs + 1;
  for (let i = 0; i < nu; i++) for (let k = 0; k < segs; k++) {
    const a = base + i * row + k, b = a + 1, c = a + row, dd = c + 1;
    // winding: compute with the first quad
    const flip = (faceAxis === 'z') !== (sgn > 0);
    if (!flip) M.idx.push(a, b, c, b, dd, c); else M.idx.push(a, c, b, b, c, dd);
  }
}

// recessed porthole window through a wall (glowing pane) or open see-through opening with chrome frames
function porthole(B, axis, d, sc, yc, ww, wh, glow) {
  const h = T / 2;
  const u0 = sc - ww / 2, u1 = sc + ww / 2, y0 = yc - wh / 2, y1 = yc + wh / 2;
  const M = B.wall;
  // reveals (inner faces of the opening)
  if (axis === 'x') {
    M.vface('x', u0, 1, d - h, d + h, y0, y1);
    M.vface('x', u1, -1, d - h, d + h, y0, y1);
    M.hface(y0, 1, u0, u1, d - h, d + h);
    M.hface(y1, -1, u0, u1, d - h, d + h);
  } else {
    M.vface('z', u0, 1, d - h, d + h, y0, y1);
    M.vface('z', u1, -1, d - h, d + h, y0, y1);
    M.hface(y0, 1, d - h, d + h, u0, u1);
    M.hface(y1, -1, d - h, d + h, u0, u1);
  }
  if (glow) {
    const fa = axis === 'x' ? 'z' : 'x';
    B.port.vface(fa, d + 0.004, 1, u0, u1, y0, y1);
    B.port.vface(fa, d - 0.004, -1, u0, u1, y0, y1);
  }
  // chrome frames on both faces
  const C = B.chrome;
  const f = 0.035, t = 0.012;
  for (const sg of [-1, 1]) {
    const pz = d + sg * h;
    const lo = Math.min(pz, pz + sg * t), hi = Math.max(pz, pz + sg * t);
    if (axis === 'x') {
      C.box(new THREE.Vector3(u0 - f, y0 - f, lo), new THREE.Vector3(u1 + f, y0, hi));
      C.box(new THREE.Vector3(u0 - f, y1, lo), new THREE.Vector3(u1 + f, y1 + f, hi));
      C.box(new THREE.Vector3(u0 - f, y0, lo), new THREE.Vector3(u0, y1, hi));
      C.box(new THREE.Vector3(u1, y0, lo), new THREE.Vector3(u1 + f, y1, hi));
    } else {
      C.box(new THREE.Vector3(lo, y0 - f, u0 - f), new THREE.Vector3(hi, y0, u1 + f));
      C.box(new THREE.Vector3(lo, y1, u0 - f), new THREE.Vector3(hi, y1 + f, u1 + f));
      C.box(new THREE.Vector3(lo, y0, u0 - f), new THREE.Vector3(hi, y1, u0));
      C.box(new THREE.Vector3(lo, y0, u1), new THREE.Vector3(hi, y1, u1 + f));
    }
  }
}

// low wall vent grille (critter exit) recessed into one face
function grille(B, axis, dFace, sgn, sc, yb, w, hgt, rec) {
  const dep = 0.09;
  const u0 = sc - w / 2, u1 = sc + w / 2, y0 = yb, y1 = yb + hgt;
  const back = dFace - sgn * dep;
  const M = B.wall;
  if (axis === 'x') {
    B.void.vface('z', back, sgn, u0, u1, y0, y1);
    M.vface('x', u0, 1, Math.min(back, dFace), Math.max(back, dFace), y0, y1);
    M.vface('x', u1, -1, Math.min(back, dFace), Math.max(back, dFace), y0, y1);
    M.hface(y0, 1, u0, u1, Math.min(back, dFace), Math.max(back, dFace));
    M.hface(y1, -1, u0, u1, Math.min(back, dFace), Math.max(back, dFace));
  } else {
    B.void.vface('x', back, sgn, u0, u1, y0, y1);
    M.vface('z', u0, 1, Math.min(back, dFace), Math.max(back, dFace), y0, y1);
    M.vface('z', u1, -1, Math.min(back, dFace), Math.max(back, dFace), y0, y1);
    M.hface(y0, 1, Math.min(back, dFace), Math.max(back, dFace), u0, u1);
    M.hface(y1, -1, Math.min(back, dFace), Math.max(back, dFace), u0, u1);
  }
  const C = B.chrome;
  const f = 0.03;
  const face = dFace + sgn * 0.01;
  const lo = Math.min(dFace, face), hi = Math.max(dFace, face);
  const fb = (a0, a1, b0, b1) => {
    if (axis === 'x') C.box(new THREE.Vector3(a0, b0, lo), new THREE.Vector3(a1, b1, hi));
    else C.box(new THREE.Vector3(lo, b0, a0), new THREE.Vector3(hi, b1, a1));
  };
  fb(u0 - f, u1 + f, y0 - f, y0); fb(u0 - f, u1 + f, y1, y1 + f); fb(u0 - f, u0, y0, y1); fb(u1, u1 + f, y0, y1);
  // louvres
  for (let k = 1; k < 6; k++) {
    const y = y0 + (hgt * k) / 6;
    const ins = dFace - sgn * 0.02;
    const l2 = Math.min(dFace, ins), h2 = Math.max(dFace, ins);
    if (axis === 'x') C.box(new THREE.Vector3(u0, y - 0.007, l2), new THREE.Vector3(u1, y + 0.007, h2));
    else C.box(new THREE.Vector3(l2, y - 0.007, u0), new THREE.Vector3(h2, y + 0.007, u1));
  }
  // critter exit
  const front = dFace + sgn * 0.25, inside = dFace - sgn * 0.06;
  if (axis === 'x') rec.vents.push({ pos: [sc, 0.15 + yb, front], inside: [sc, yb + 0.1, inside] });
  else rec.vents.push({ pos: [front, 0.15 + yb, sc], inside: [inside, yb + 0.1, sc] });
}

// tiled barrel vault over a tunnel cell (axis along the room's long side)
function barrelVault(M, x0, z0, x1, z1, top, room) {
  const alongX = !room || room.w >= room.h;
  const h = T / 2;
  const a0 = alongX ? z0 + h : x0 + h, a1 = alongX ? z1 - h : x1 - h;
  const r = (a1 - a0) / 2, ac = (a0 + a1) / 2, ys = top - r;
  const L0 = alongX ? x0 : z0, L1 = alongX ? x1 : z1;
  const nA = 14, nL = 4;
  M.setTint(1, 1, 1);
  M.param(nL, nA, (fu, fv) => {
    const ang = Math.PI * fv;
    const u = ac - Math.cos(ang) * r, y = ys + Math.sin(ang) * r;
    const L = L0 + (L1 - L0) * fu;
    const nu = Math.cos(ang), ny = -Math.sin(ang);
    return alongX ? [L, y, u, 0, ny, nu, L, ang * r] : [u, y, L, nu, ny, 0, L, ang * r];
  });
  // accent band where the vault springs from the walls
  M.setTint(0.42, 0.6, 0.86);
  for (const side of [a0 + 0.001, a1 - 0.001]) {
    const sg = side < ac ? 1 : -1;
    if (alongX) M.vface('z', side, sg, L0, L1, ys - 0.16, ys - 0.01);
    else M.vface('x', side, sg, L0, L1, ys - 0.16, ys - 0.01);
  }
  M.setTint(1, 1, 1);
}

// runs [i0, i1) of door-free cell edges along a room's N or S wall (chunk-local columns)
function doorFreeRuns(room, side) {
  const runs = [];
  let start = null;
  for (let i = room.rx; i <= room.rx + room.w; i++) {
    const free = i < room.rx + room.w && !room.doors.some((d) => d.side === side && d.i === i);
    if (free && start === null) start = i;
    if (!free && start !== null) { runs.push([start, i]); start = null; }
  }
  return runs;
}

function roomGeometry(B, Q, room, layout, ox, oz) {
  const x0 = ox + room.rx * CELL, z0 = oz + room.rz * CELL;
  const x1 = x0 + room.w * CELL, z1 = z0 + room.h * CELL;
  const h = T / 2;
  const doorSides = new Set(room.doors.map((d) => d.side));
  switch (room.kind) {
    case 'spawn': tileDebris(B, ox + (room.rx + 1) * CELL, oz + (room.rz + 1) * CELL, layout.cx * 31 + layout.cz); break;
    case 'gen_diesel': case 'gen_electric': case 'gen_mech': case 'pump_room': {
      // pipework along the north wall (only over door-free cells), filter tank in a corner away from
      // the doors; the pump room also gets its circulation pump feeding the main
      const yb = room.kind === 'pump_room' ? 1.6 : 2.15;
      const zW = z0 + h;
      for (const [i0, i1] of doorFreeRuns(room, 'N')) pipeRun(B, ox + i0 * CELL + h + 0.05, zW, ox + i1 * CELL - h - 0.05, zW, [0, 1], yb);
      const corners = [[x1 - 0.75, z1 - 0.75, 'E', 'S'], [x0 + 0.75, z1 - 0.75, 'W', 'S']];
      for (const [tx, tz, s1, s2] of corners) {
        if (doorSides.has(s1) || doorSides.has(s2)) continue;
        for (const b of filterTank(B, tx, tz, 1.25, 0.36)) B.boxes.push(b);
        break;
      }
      if (room.kind === 'pump_room') {
        const run = doorFreeRuns(room, 'N').find(([a, b]) => b - a >= 1);
        if (run) {
          const xc = ox + ((run[0] + run[1]) / 2) * CELL - 0.3;
          for (const b of pumpUnit(B, xc, z0 + 0.68, yb, zW + 0.18 + 0.075)) B.boxes.push(b);
        }
      }
      break;
    }
    case 'workshop': {
      // service pipework along a side wall without doors (the workbench stands at the north wall)
      const walls = [['E', x1 - h, z0 + h + 0.05, x1 - h, z1 - h - 0.05, [-1, 0]], ['W', x0 + h, z0 + h + 0.05, x0 + h, z1 - h - 0.05, [1, 0]], ['S', x0 + h + 0.05, z1 - h, x1 - h - 0.05, z1 - h, [0, -1]]];
      const w = walls.find((q) => !doorSides.has(q[0]));
      if (w) pipeRun(B, w[1], w[2], w[3], w[4], w[5], 2.15);
      break;
    }
    case 'locker_room': {
      for (const b of bench(B, (x0 + x1) / 2, (z0 + z1) / 2 + 0.6, 0, 2.2)) B.boxes.push(b);
      break;
    }
    case 'shower_room': {
      for (let k = 0; k < 3; k++) showerColumn(B, x0 + 1.0 + k * ((x1 - x0 - 2) / 2), z0 + h, 0);
      for (let k = 0; k < 2; k++) drainGrate(B, x0 + 1.6 + k * 2.8, 0, (z0 + z1) / 2 + 0.3, 0.1, 'x', false);
      break;
    }
    default: break;
  }
}

// ---------------------------------------------------------------------------
function emitPillars(B, Q, layout, ox, oz) {
  const N = CHUNK;
  for (const p of layout.pillars) {
    const X = (layout.cx * N + p.li) * CELL, Z = (layout.cz * N + p.lj) * CELL;
    const i = layout.cx * N + p.li, j = layout.cz * N + p.lj;
    const around = [Q.cellAt(i - 1, j - 1), Q.cellAt(i, j - 1), Q.cellAt(i - 1, j), Q.cellAt(i, j)];
    const y0 = Math.min(...around.map(floorOf)) - 0.001;
    const top = Math.max(...around.map(ceilOf));
    const hs = p.size / 2;
    const M = B.wall;
    if (p.kind === 'column') {
      // plinth, shaft, accent band, impost
      M.setTint(1, 1, 1);
      M.roundPrism(X - hs - 0.05, Z - hs - 0.05, X + hs + 0.05, Z + hs + 0.05, y0, y0 + 0.32, 0.05, 3, { top: true });
      M.roundPrism(X - hs, Z - hs, X + hs, Z + hs, y0 + 0.32, 1.25, 0.07, 4);
      M.setTint(0.42, 0.6, 0.86);
      M.roundPrism(X - hs - 0.004, Z - hs - 0.004, X + hs + 0.004, Z + hs + 0.004, 1.25, 1.4, 0.07, 4);
      M.setTint(1, 1, 1);
      M.roundPrism(X - hs, Z - hs, X + hs, Z + hs, 1.4, VAULT_SPRING - 0.2, 0.07, 4);
      B.trim.setTint(1, 1, 1);
      B.trim.roundPrism(X - hs - 0.07, Z - hs - 0.07, X + hs + 0.07, Z + hs + 0.07, VAULT_SPRING - 0.2, VAULT_SPRING, 0.03, 3, { bottom: true });
      M.roundPrism(X - hs, Z - hs, X + hs, Z + hs, VAULT_SPRING, top, 0.07, 4);
    } else {
      M.setTint(1, 1, 1);
      M.roundPrism(X - hs, Z - hs, X + hs, Z + hs, y0, 1.15, 0.06, 4);
      M.setTint(0.42, 0.6, 0.86);
      M.roundPrism(X - hs - 0.003, Z - hs - 0.003, X + hs + 0.003, Z + hs + 0.003, 1.15, 1.3, 0.06, 4);
      M.setTint(1, 1, 1);
      M.roundPrism(X - hs, Z - hs, X + hs, Z + hs, 1.3, top, 0.06, 4);
      for (const [fa, d, sg] of [['z', Z - hs, -1], ['z', Z + hs, 1], ['x', X - hs, -1], ['x', X + hs, 1]]) {
        const fl = floorOf(sg < 0 ? (fa === 'z' ? around[1] : around[2]) : around[3]);
        if (fa === 'z') cove(M, 'z', d, sg, X - hs + 0.06, X + hs - 0.06, fl);
        else cove(M, 'x', d, sg, Z - hs + 0.06, Z + hs - 0.06, fl);
      }
    }
    B.boxes.push({ min: [X - hs, y0, Z - hs], max: [X + hs, top, Z + hs] });
  }
  void ox; void oz;
}

// ---------------------------------------------------------------------------
function* buildColliders(level, B, layout, ox, oz, rec) {
  const phys = level.world.physics;
  const N = CHUNK;
  const cols = rec.physicsColliders;
  const udFloor = { kind: 'static', surface: 'floor' }, udCeil = { kind: 'static', surface: 'ceiling' }, udWorld = { kind: 'static', surface: 'world' };
  // floors: greedy runs per row of equal floor height (pool cells are handled by the pools)
  for (let lj = 0; lj < N; lj++) {
    let li = 0;
    while (li < N) {
      const c = layout.cells[lj * N + li];
      if (c.pool) { li++; continue; }
      const fy = floorOf(c);
      let e = li + 1;
      while (e < N) { const o = layout.cells[lj * N + e]; if (o.pool || floorOf(o) !== fy) break; e++; }
      const x0 = ox + li * CELL, x1 = ox + e * CELL, z0 = oz + lj * CELL, z1 = z0 + CELL;
      cols.push(phys.addStaticBox((x0 + x1) / 2, fy - 0.3, (z0 + z1) / 2, (x1 - x0) / 2, 0.3, CELL / 2, udFloor));
      li = e;
    }
  }
  // ceilings
  for (let lj = 0; lj < N; lj++) {
    let li = 0;
    while (li < N) {
      const c = layout.cells[lj * N + li];
      const cy = c.ceil;
      let e = li + 1;
      while (e < N && layout.cells[lj * N + e].ceil === cy) e++;
      const x0 = ox + li * CELL, x1 = ox + e * CELL, z0 = oz + lj * CELL;
      cols.push(phys.addStaticBox((x0 + x1) / 2, cy + 0.3, z0 + CELL / 2, (x1 - x0) / 2, 0.3, CELL / 2, udCeil));
      li = e;
    }
  }
  yield 'colliders';
  let n = 0;
  for (const b of B.boxes) {
    if ((++n & 63) === 0) yield 'colliders';
    const hx = (b.max[0] - b.min[0]) / 2, hy = (b.max[1] - b.min[1]) / 2, hz = (b.max[2] - b.min[2]) / 2;
    if (hx < 0.002 || hy < 0.002 || hz < 0.002) continue;
    cols.push(phys.addStaticBox((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2, hx, hy, hz, b.kind === 'coping' ? { kind: 'static', surface: 'floor' } : udWorld));
  }
  for (const r of B.rboxes) {
    const desc = RAPIER.ColliderDesc.cuboid(r.half[0], r.half[1], r.half[2])
      .setTranslation(r.center[0], r.center[1], r.center[2])
      .setRotation({ x: r.q[0], y: r.q[1], z: r.q[2], w: r.q[3] })
      .setCollisionGroups(GROUPS.static)
      .setFriction(0.8);
    const c = phys.world.createCollider(desc);
    phys.setUserData(c, udFloor);
    cols.push(c);
  }
}
