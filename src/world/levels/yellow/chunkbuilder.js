// Builds the static geometry, colliders and baked lighting of one Yellow Rooms chunk.
import * as THREE from 'three';
import * as Mat from '../../../gfx/materials.js';
import { GeoBuilder } from '../../geom.js';
import { bakeGeometry, bakedMaterial, LightField } from '../../../gfx/bakedlight.js';
import { CELL, CHUNK, HEIGHT, W, getLayout, wallN, wallW, wallTransmission, cellInfo, floorDiv } from './layout.js';
import { buildModel } from '../../../entities/catalog.js';

const T = 0.16; // wall thickness
const DOOR_W = 1.1, DOOR_H = 2.15;
const ARCH_W = 2.0, ARCH_H = 2.45;

export const LIGHT_TONES = [
  new THREE.Color(1.0, 0.92, 0.72),  // 0 warm fluorescent
  new THREE.Color(0.92, 0.96, 1.0),  // 1 office cool
  new THREE.Color(1.0, 0.62, 0.32),  // 2 maintenance sodium
  new THREE.Color(1.0, 0.8, 0.55),   // 3 manila
  new THREE.Color(1.0, 0.12, 0.08),  // 4 red
  new THREE.Color(0.8, 0.95, 1.05),  // 5 pool
];
const TONE_INT = [1.0, 1.05, 0.75, 0.95, 0.9, 1.25];

// ---------------------------------------------------------------------------
// light helpers shared with the level (registration + baking queries)
export function cellLightSpec(cell) {
  if (!cell.light) return null;
  return {
    key: LightField.texel(cell.i, cell.j),
    x: (cell.i + 0.5) * CELL,
    y: HEIGHT - 0.04,
    z: (cell.j + 0.5) * CELL,
    radius: 9,
    color: LIGHT_TONES[cell.lightTone] || LIGHT_TONES[0],
    base: TONE_INT[cell.lightTone] ?? 1,
    mode: cell.lightMode,
    seed: cell.lightSeed,
  };
}

// 2D transmission between two points crossing cell edges (DDA over the cell grid)
export function makeOccluder(seed, variantFn) {
  return function occl(x0, z0, x1, z1) {
    let i = Math.floor(x0 / CELL), j = Math.floor(z0 / CELL);
    const ie = Math.floor(x1 / CELL), je = Math.floor(z1 / CELL);
    if (i === ie && j === je) return 1;
    const dx = x1 - x0, dz = z1 - z0;
    const stepI = dx > 0 ? 1 : -1, stepJ = dz > 0 ? 1 : -1;
    const tDx = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
    const tDz = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
    let tMx = dx !== 0 ? ((dx > 0 ? (i + 1) * CELL - x0 : x0 - i * CELL) / Math.abs(dx)) : Infinity;
    let tMz = dz !== 0 ? ((dz > 0 ? (j + 1) * CELL - z0 : z0 - j * CELL) / Math.abs(dz)) : Infinity;
    let tr = 1;
    for (let n = 0; n < 12 && (i !== ie || j !== je); n++) {
      if (tMx < tMz) {
        // crossing a vertical edge (x = const): wallW of the cell on the +x side
        const wi = stepI > 0 ? i + 1 : i;
        tr *= wallTransmission(wallW(seed, wi, j, variantFn));
        i += stepI;
        tMx += tDx;
      } else {
        const wj = stepJ > 0 ? j + 1 : j;
        tr *= wallTransmission(wallN(seed, i, wj, variantFn));
        j += stepJ;
        tMz += tDz;
      }
      if (tr < 0.02) return 0;
    }
    return tr;
  };
}

export function makeAO(seed, variantFn) {
  const solid = (t) => t === W.FULL || t === W.DOOR || t === W.HALF_A || t === W.HALF_B || t === W.WINDOW;
  return function ao(x, y, z, nx, ny) {
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
    const fx = x - i * CELL, fz = z - j * CELL;
    let d = 9;
    if (solid(wallN(seed, i, j, variantFn))) d = Math.min(d, fz);
    if (solid(wallN(seed, i, j + 1, variantFn))) d = Math.min(d, CELL - fz);
    if (solid(wallW(seed, i, j, variantFn))) d = Math.min(d, fx);
    if (solid(wallW(seed, i + 1, j, variantFn))) d = Math.min(d, CELL - fx);
    if (ny > 0.5) return 0.62 + 0.38 * Math.min(1, d / 0.9);
    if (ny < -0.5) return 0.75 + 0.25 * Math.min(1, d / 0.9);
    // walls: corners at floor and ceiling darker
    const v = Math.min(1, y / 0.5) * 0.25 + 0.75;
    const top = Math.min(1, (HEIGHT - y) / 0.4) * 0.15 + 0.85;
    return v * top;
  };
}

// ---------------------------------------------------------------------------
// Wall piece emission
function emitWallEdge(gb, base, x0, z0, axis, type, len, rec) {
  // axis 'x': wall along x from (x0,z0) to (x0+len, z0); 'z': along z
  const pieces = []; // [s0, s1, y0, y1]
  switch (type) {
    case W.FULL: pieces.push([0, len, 0, HEIGHT]); break;
    case W.DOOR: {
      const a = (len - DOOR_W) / 2;
      pieces.push([0, a, 0, HEIGHT], [a + DOOR_W, len, 0, HEIGHT], [a, a + DOOR_W, DOOR_H, HEIGHT]);
      break;
    }
    case W.ARCH: {
      const a = (len - ARCH_W) / 2;
      pieces.push([0, a, 0, HEIGHT], [a + ARCH_W, len, 0, HEIGHT], [a, a + ARCH_W, ARCH_H, HEIGHT]);
      break;
    }
    case W.HALF_A: pieces.push([0, len * 0.5, 0, HEIGHT]); break;
    case W.HALF_B: pieces.push([len * 0.5, len, 0, HEIGHT]); break;
    case W.LOW: pieces.push([0, len, 0, 1.05]); break;
    case W.WINDOW: pieces.push([0, len, 0, 0.9], [0, len, 2.1, HEIGHT], [0, 0.4, 0.9, 2.1], [len - 0.4, len, 0.9, 2.1]); break;
    default: break;
  }
  for (const [s0, s1, y0, y1] of pieces) {
    if (s1 - s0 < 0.01) continue;
    // extend a bit at ends to close corners
    const e0 = s0 === 0 ? -T / 2 : s0;
    const e1 = s1 === len ? len + T / 2 : s1;
    let min, max;
    if (axis === 'x') {
      min = new THREE.Vector3(x0 + e0, y0, z0 - T / 2);
      max = new THREE.Vector3(x0 + e1, y1, z0 + T / 2);
    } else {
      min = new THREE.Vector3(x0 - T / 2, y0, z0 + e0);
      max = new THREE.Vector3(x0 + T / 2, y1, z0 + e1);
    }
    gb.box(min, max, 1.0, { bottom: true, top: y1 >= HEIGHT - 0.001 });
    rec.colliders.push({ min, max });
    // baseboard along both faces for floor-standing pieces
    if (y0 === 0 && base) {
      const bh = 0.1, bt = 0.012;
      if (axis === 'x') {
        base.box(new THREE.Vector3(min.x, 0, min.z - bt), new THREE.Vector3(max.x, bh, min.z), 2, { bottom: true });
        base.box(new THREE.Vector3(min.x, 0, max.z), new THREE.Vector3(max.x, bh, max.z + bt), 2, { bottom: true });
      } else {
        base.box(new THREE.Vector3(min.x - bt, 0, min.z), new THREE.Vector3(min.x, bh, max.z), 2, { bottom: true });
        base.box(new THREE.Vector3(max.x, 0, min.z), new THREE.Vector3(max.x + bt, bh, max.z), 2, { bottom: true });
      }
    }
  }
}

// ---------------------------------------------------------------------------
export const buildStats = { geo: 0, bake: 0, mat: 0, decor: 0, phys: 0, water: 0 };
export function buildChunk(level, cx, cz) {
  let _t = performance.now(); const _lap = (k) => { const n = performance.now(); buildStats[k] += n - _t; _t = n; };
  const seed = level.seed;
  const variantFn = level.variantFn;
  const layout = getLayout(seed, cx, cz, variantFn(cx, cz));
  const N = CHUNK;
  const ox = cx * N * CELL, oz = cz * N * CELL;
  const group = new THREE.Group();
  group.name = `chunk:${cx},${cz}`;
  const rec = { colliders: [], group, layout, cx, cz, statics: [], waterCells: [] };

  const gWall = new GeoBuilder();
  const gWallConcrete = new GeoBuilder();
  const gWallManila = new GeoBuilder();
  const gWallTile = new GeoBuilder();
  const gBase = new GeoBuilder();
  const gCarpet = new GeoBuilder(true);
  const gConcrete = new GeoBuilder(true);
  const gTile = new GeoBuilder(true);
  const gCeil = new GeoBuilder();
  const gPanel = new GeoBuilder();
  const gHole = new GeoBuilder();
  const panelCells = [];

  const styleOf = (c) => c.roomStyle || (c.zone === 'maintenance' ? 'concrete' : c.zone === 'manila' ? 'manila' : 'wall');
  const wallGB = (style) => (style === 'concrete' ? gWallConcrete : style === 'manila' ? gWallManila : style === 'pool' ? gWallTile : gWall);

  // --- floors & ceilings ---
  for (const c of layout.cells) {
    const x0 = c.i * CELL, z0 = c.j * CELL;
    const fgb = c.floor === 'concrete' ? gConcrete : c.floor === 'tile' ? gTile : gCarpet;
    const wetv = c.wet;
    fgb.grid(new THREE.Vector3(x0, 0, z0 + CELL), new THREE.Vector3(CELL, 0, 0), new THREE.Vector3(0, 0, -CELL), new THREE.Vector3(0, 1, 0), 2, 2,
      (p) => [p.x, p.z], () => wetv);
    // ceiling (concrete rooms keep the drop ceiling for uniformity except maintenance zone)
    gCeil.grid(new THREE.Vector3(x0, HEIGHT, z0), new THREE.Vector3(CELL, 0, 0), new THREE.Vector3(0, 0, CELL), new THREE.Vector3(0, -1, 0), 2, 2, (p) => [p.x, p.z]);
    if (c.light) {
      const w = c.lightRot ? 1.2 : 0.6, d = c.lightRot ? 0.6 : 1.2;
      const px = x0 + CELL / 2, pz = z0 + CELL / 2;
      gPanel.box(new THREE.Vector3(px - w / 2, HEIGHT - 0.03, pz - d / 2), new THREE.Vector3(px + w / 2, HEIGHT + 0.01, pz + d / 2), 2, { top: true }, 'flat');
      panelCells.push(c);
    }
    if (c.hole) {
      const hx = x0 + 0.6 + ((c.i * 7) % 3) * 0.6, hz = z0 + 0.3;
      gHole.grid(new THREE.Vector3(hx, HEIGHT - 0.005, hz), new THREE.Vector3(0.6, 0, 0), new THREE.Vector3(0, 0, 0.6), new THREE.Vector3(0, -1, 0), 1, 1, (p) => [p.x, p.z]);
    }
    if (c.water) rec.waterCells.push(c);
  }

  // --- walls on owned edges (N & W of each cell) ---
  for (const c of layout.cells) {
    const x0 = c.i * CELL, z0 = c.j * CELL;
    const tN = layout.edgesN[c.lj * N + c.li];
    if (tN) {
      const other = cellInfo(seed, c.i, c.j - 1, variantFn);
      const style = styleOf(c) !== 'wall' ? styleOf(c) : styleOf(other);
      emitWallEdge(wallGB(style), gBase, x0, z0, 'x', tN, CELL, rec);
    }
    const tW = layout.edgesW[c.lj * N + c.li];
    if (tW) {
      const other = cellInfo(seed, c.i - 1, c.j, variantFn);
      const style = styleOf(c) !== 'wall' ? styleOf(c) : styleOf(other);
      emitWallEdge(wallGB(style), gBase, x0, z0, 'z', tW, CELL, rec);
    }
  }
  // pillars
  for (const p of layout.pillars) {
    const px = (cx * N + p.li) * CELL, pz = (cz * N + p.lj) * CELL;
    const h = p.size / 2;
    const min = new THREE.Vector3(px - h, 0, pz - h), max = new THREE.Vector3(px + h, HEIGHT, pz + h);
    gWall.box(min, max, 1, { bottom: true, top: true });
    gBase.box(new THREE.Vector3(px - h - 0.012, 0, pz - h - 0.012), new THREE.Vector3(px + h + 0.012, 0.1, pz + h + 0.012), 2, { bottom: true });
    rec.colliders.push({ min, max });
  }

  _lap('geo');
  // --- materials & meshes ---
  const field = level.field;
  const lightsNear = level.lightsNear;
  const occl = level.occluder;
  const ao = level.ao;
  const add = (gb, matName, grime, opts = {}) => {
    if (gb.isEmpty()) return null;
    const geo = gb.build();
    _lap('geo');
    bakeGeometry(geo, new THREE.Matrix4(), lightsNear, occl, ao, opts.bake || {});
    _lap('bake');
    const mat = bakedMaterial(opts.material || Mat.get(matName), field, grime, { wet: !!gb.wet, emissiveLights: opts.emissive });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = !!opts.cast;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    return mesh;
  };
  add(gWall, 'wallpaper', 2, { cast: true });
  add(gWallConcrete, 'concrete', 4, { cast: true });
  add(gWallManila, null, 2, { cast: true, material: manilaMaterial() });
  add(gWallTile, null, 0, { cast: true, material: poolTileMaterial() });
  add(gBase, null, 0, { material: baseboardMaterial() });
  add(gCarpet, 'carpet', 1);
  add(gConcrete, 'concrete_dark', 4);
  add(gTile, null, 0, { material: poolTileMaterial() });
  add(gCeil, 'ceiling', 3, { bake: { direct: 0.2, bounce: 0.55 } });
  if (!gHole.isEmpty()) {
    const m = new THREE.Mesh(gHole.build(), new THREE.MeshBasicMaterial({ color: 0x020202 }));
    group.add(m);
  }
  // light panels: each vertex reads its own light only
  if (!gPanel.isEmpty()) {
    const geo = gPanel.build();
    const n = geo.attributes.position.count;
    const cells = new Float32Array(n * 4), wts = new Float32Array(n * 4), aoA = new Float32Array(n).fill(1);
    const pos = geo.attributes.position;
    for (let v = 0; v < n; v++) {
      const i = Math.floor(pos.getX(v) / CELL), j = Math.floor(pos.getZ(v) / CELL);
      cells[v * 4] = LightField.texel(i, j);
      wts[v * 4] = 1;
    }
    geo.setAttribute('aLightCells', new THREE.BufferAttribute(cells, 4));
    geo.setAttribute('aLightW', new THREE.BufferAttribute(wts, 4));
    geo.setAttribute('aAO', new THREE.BufferAttribute(aoA, 1));
    const mat = bakedMaterial(Mat.get('lightpanel'), field, 0, { emissiveLights: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  _lap('mat');
  // --- water ---
  if (rec.waterCells.length) {
    const wg = new GeoBuilder();
    for (const c of rec.waterCells) {
      wg.grid(new THREE.Vector3(c.i * CELL, 0.09, (c.j + 1) * CELL), new THREE.Vector3(CELL, 0, 0), new THREE.Vector3(0, 0, -CELL), new THREE.Vector3(0, 1, 0), 2, 2, (p) => [p.x, p.z]);
    }
    const geo = wg.build();
    bakeGeometry(geo, new THREE.Matrix4(), lightsNear, occl, ao, { bounce: 0.5 });
    const mesh = new THREE.Mesh(geo, level.waterMaterial);
    mesh.renderOrder = 2;
    group.add(mesh);
    level.reflection.meshes.add(mesh);
    rec.waterMesh = mesh;
  }

  _lap('water');
  // --- static decor (sunk / clipped furniture, pipes) ---
  for (const d of layout.decor) {
    const x = (cx * N + d.li) * CELL + CELL / 2, z = (cz * N + d.lj) * CELL + CELL / 2;
    if (d.kind === 'sunk') {
      const m = buildModel(d.type, { seed: d.li * 31 + d.lj });
      const o = m.object;
      o.position.set(x, (m.halfHeight ?? 0.4) - d.depth, z);
      o.rotation.set(d.tilt, d.rot, d.tilt * 0.5);
      level.prepStatic(o);
      group.add(o);
    } else if (d.kind === 'clip') {
      const m = buildModel(d.type, { seed: d.li * 17 + d.lj });
      const o = m.object;
      // half-way into the wall on the given side if a wall exists there
      if (d.side === 'N') { o.position.set(x + 0.2, m.halfHeight ?? 0.4, (cz * N + d.lj) * CELL + 0.05); o.rotation.y = 0.3; }
      else { o.position.set((cx * N + d.li) * CELL + 0.05, m.halfHeight ?? 0.4, z - 0.3); o.rotation.y = Math.PI / 2 + 0.25; }
      level.prepStatic(o);
      group.add(o);
    } else if (d.kind === 'pipes') {
      const pg = pipeRun(x - CELL / 2, z - CELL / 2);
      level.prepStatic(pg);
      group.add(pg);
    }
  }

  _lap('decor');
  // --- colliders ---
  const phys = level.world.physics;
  const ud = { kind: 'static', surface: 'world' };
  const cols = [];
  cols.push(phys.addStaticBox(ox + N * CELL / 2, -0.25, oz + N * CELL / 2, N * CELL / 2, 0.25, N * CELL / 2, { kind: 'static', surface: 'floor' }));
  cols.push(phys.addStaticBox(ox + N * CELL / 2, HEIGHT + 0.25, oz + N * CELL / 2, N * CELL / 2, 0.25, N * CELL / 2, { kind: 'static', surface: 'ceiling' }));
  for (const b of rec.colliders) {
    cols.push(phys.addStaticBox((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2,
      (b.max.x - b.min.x) / 2, (b.max.y - b.min.y) / 2, (b.max.z - b.min.z) / 2, ud));
  }
  rec.physicsColliders = cols;
  group.updateMatrixWorld(true);
  _lap('phys');
  return rec;
}

// --- special materials ---
let _manila, _base, _poolTile;
function manilaMaterial() {
  if (!_manila) _manila = Mat.make('wallpaper', { color: 0xc7a06a });
  return _manila;
}
function baseboardMaterial() {
  if (!_base) _base = Mat.make('paint', { color: 0x8d7a52, roughness: 0.6 });
  return _base;
}
function poolTileMaterial() {
  if (!_poolTile) {
    _poolTile = Mat.make('tile', { color: 0xdff2f2 });
    const t = _poolTile.map.clone();
    t.repeat.set(1 / 0.6, 1 / 0.6);
    t.needsUpdate = true;
    _poolTile.map = t;
  }
  return _poolTile;
}

// exposed maintenance pipe run along a cell's north wall near the ceiling
function pipeRun(x0, z0) {
  const g = new THREE.Group();
  const mat = Mat.get('rust');
  const mat2 = Mat.get('metal_dark');
  for (let k = 0; k < 3; k++) {
    const r = 0.05 + k * 0.025;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, CELL, 12), k === 1 ? mat2 : mat);
    p.rotation.z = Math.PI / 2;
    p.position.set(x0 + CELL / 2, HEIGHT - 0.2 - k * 0.17, z0 + 0.3 + k * 0.05);
    g.add(p);
    for (const fx of [0.4, CELL - 0.4]) {
      const fl = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.4, r * 1.4, 0.06, 12), mat2);
      fl.rotation.z = Math.PI / 2;
      fl.position.set(x0 + fx, p.position.y, p.position.z);
      g.add(fl);
    }
  }
  return g;
}

export { floorDiv };
