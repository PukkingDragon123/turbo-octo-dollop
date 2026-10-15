// Level 0's weird rooms (rare): the slide pit (playground chute + spiral flume into a deep ball pit), the play-tower
// ball pit, the carpeted conversation pit, the endless tower of stacked chairs, the room with its furniture on the
// ceiling, the giant-furniture room, the corridor of identical doors, the office party frozen mid-celebration and
// the tilted room. decorateWeird: static geometry / colliders on every peer; populateWeird: host physics props.
import * as THREE from 'three';
import * as Mat from '../../../gfx/materials.js';
import { CELL, CHUNK, HEIGHT } from './layout.js';
import { EnvGeo } from '../../env/builder.js';
import { troffer } from '../../env/ceiling.js';
import { slide, samplePath, pit, stair, railing, ballTexture, aabbCol } from '../../env/playground.js';
import { bakeInto, roomBounds, placeStatic, staticBody, instancedFurniture, sp, spPlaced } from './roomkit.js';
import { modelHalfHeight } from '../../../entities/catalog.js';
import { RNG, hash3 } from '../../../core/rng.js';
import { Placer } from './placement.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const WEIRD = new Set(['slide_pit', 'ball_pit', 'carpet_pit', 'chair_tower', 'ceiling_room', 'giant_room', 'door_corridor', 'frozen_party', 'tilted_room']);

const mats = {};
const mk = (k, f) => mats[k] || (mats[k] = f());
const plastic = (hex) => mk('pl' + hex, () => Mat.make('plastic_white', { color: hex }));
const ballMat = () => mk('balls', () => { const m = new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.32 }); m.name = 'ballpit'; return m; });
const pitCarpet = () => mk('pitcarpet', () => Mat.make('carpet', { color: 0xa0584a }));
const cushionMat = () => mk('cushion', () => Mat.make('fabric_brown', { color: 0xc8925a }));
const confettiMat = () => mk('confetti', () => { const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }); m.name = 'confetti'; return m; });

function pitRect(room, rec) {
  const ox = rec.cx * CHUNK * CELL, oz = rec.cz * CHUNK * CELL, p = room.pit;
  return { x0: ox + p.x0, z0: oz + p.z0, x1: ox + p.x1, z1: oz + p.z1, depth: p.depth };
}

// ---------------------------------------------------------------------------
export function decorateWeird(level, room, rec) {
  const b = roomBounds(room, rec);
  const rng = new RNG(hash3(rec.cx, rec.cz, 5151, level.seed));
  rec.slides = rec.slides || [];
  rec.ballPits = rec.ballPits || [];
  switch (room.kind) {
    case 'slide_pit': slidePit(level, rec, room, b, rng); break;
    case 'ball_pit': ballPit(level, rec, room, b, rng); break;
    case 'carpet_pit': carpetPit(level, rec, room, b, rng); break;
    case 'chair_tower': chairTower(level, rec, room, b, rng); break;
    case 'ceiling_room': ceilingRoom(level, rec, room, b, rng); break;
    case 'giant_room': giantRoom(level, rec, room, b, rng); break;
    case 'door_corridor': doorCorridor(level, rec, room, b, rng); break;
    case 'frozen_party': frozenParty(level, rec, room, b, rng); break;
    case 'tilted_room': tiltedRoom(level, rec, room, b, rng); break;
    default: break;
  }
}

// ball fill: a textured surface (packed balls) with a scatter of real balls on top
function ballFill(level, rec, r, y, n, rng) {
  const g = new EnvGeo();
  g.grid([r.x0, y, r.z1], [r.x1 - r.x0, 0, 0], [0, 0, -(r.z1 - r.z0)], [0, 1, 0], [0, 0.5, 1], [0, 0.5, 1], (x, yy, z) => [x * 1.4, z * 1.4]);
  bakeInto(level, rec, g, ballMat(), { quant: 0.3, mix: [1, 0.5] });
  const geo = new THREE.SphereGeometry(0.075, 8, 6);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0 });
  const im = new THREE.InstancedMesh(geo, mat, n);
  const cols = [0xd8322a, 0x2a62c8, 0xf2c21a, 0x2fa84a, 0xe86ab0, 0xf07a1a].map((h) => new THREE.Color(h));
  const M = new THREE.Matrix4();
  for (let k = 0; k < n; k++) {
    M.makeTranslation(r.x0 + 0.08 + rng.next() * (r.x1 - r.x0 - 0.16), y + 0.02 + rng.next() * 0.07, r.z0 + 0.08 + rng.next() * (r.z1 - r.z0 - 0.16));
    im.setMatrixAt(k, M);
    im.setColorAt(k, cols[k % cols.length]);
  }
  im.instanceMatrix.needsUpdate = true;
  im.computeBoundingSphere();
  im.castShadow = false;
  const holder = new THREE.Group();
  holder.position.set((r.x0 + r.x1) / 2, y + 0.4, (r.z0 + r.z1) / 2);
  im.position.copy(holder.position).negate();
  holder.add(im);
  rec.group.add(holder);
  level.prepStatic(holder, rec);
  rec.ballPits.push({ x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, y });
}

// railing around a rect at y = 0, offset outwards, leaving gaps [{side: 'N'|'S'|'W'|'E', a, b}] (world coords along)
function rimRailing(g, r, off, gaps) {
  const cols = [];
  const sides = [
    ['N', r.x0 - off, r.x1 + off, (t) => [t, 0, r.z0 - off]],
    ['S', r.x0 - off, r.x1 + off, (t) => [t, 0, r.z1 + off]],
    ['W', r.z0 - off, r.z1 + off, (t) => [r.x0 - off, 0, t]],
    ['E', r.z0 - off, r.z1 + off, (t) => [r.x1 + off, 0, t]],
  ];
  for (const [side, a0, a1, P] of sides) {
    const gs = gaps.filter((q) => q.side === side).sort((p, q) => p.a - q.a);
    let a = a0;
    for (const q of [...gs, { a: a1, b: a1 }]) {
      if (q.a - a > 0.3) cols.push(...railing(g, [P(a), P(q.a)], 0.95));
      a = q.b;
    }
  }
  return cols;
}

// --- the slide pit: a 2.6 m deep ball pit with a straight chute and a spiral flume, steel stairs back up ---
function slidePit(level, rec, room, b, rng) {
  const r = pitRect(room, rec);
  const D = r.depth, yBall = -D + 0.9, yCol = -D + 0.45;
  const gWall = new EnvGeo(), gRim = new EnvGeo(), gYel = new EnvGeo(), gRed = new EnvGeo(), gBlue = new EnvGeo(), gSteel = new EnvGeo(), gRail = new EnvGeo();
  const cols = pit(gWall, null, gRim, r, D, yCol);
  // straight chute from the north walkway
  const sx = (r.x0 + r.x1) / 2 - 1.1;
  const zs = r.z0 - 0.75, ze = r.z0 + 3.3, yEnd = yBall + 0.22;
  const pts = samplePath((t) => {
    const z = zs + (ze - zs) * t;
    let y;
    if (t < 0.12) y = 0.03;
    else if (t > 0.9) y = yEnd;
    else { const u = (t - 0.12) / 0.78; y = 0.03 + (yEnd - 0.03) * (u * u * (3 - 2 * u)); }
    return [sx, y, z];
  }, 18);
  const s1 = slide(gYel, gRed, pts, { w: 0.84, wall: 0.32 });
  cols.push(...s1.cols);
  rec.slides.push(...s1.segs.map((s) => ({ ...s, speed: 6.5 })));
  // legs under the chute
  for (const t of [0.45, 0.75]) {
    const p = pts[Math.round(t * 18)];
    gSteel.tube('y', -D, p[1] - 0.08, p[0], p[2], 0.035, 8);
  }
  // spiral flume in the south-east corner: lead-in from the east walkway, one full turn down into the balls
  // (the turn ends right under the lead-in, low enough that a standing clone clears it)
  const R = 0.95, C = [r.x1 - 1.6, r.z1 - 1.65];
  const yTop = 0.03, yLow = yBall - 0.35;
  const yAt = (t) => yTop + (yLow - yTop) * Math.pow(t, 0.9); // a little steeper early: ~1.5 m headroom under the lead-in
  const lead = 1.75, nH = 26, turns = 1.0;
  const spts = [];
  for (let k = 0; k <= 4; k++) spts.push([C[0] + lead - (lead * k) / 4, yTop, C[1] + R]);
  for (let k = 1; k <= nH; k++) {
    const t = k / nH, th = Math.PI / 2 + t * turns * Math.PI * 2;
    spts.push([C[0] + R * Math.cos(th), yAt(t), C[1] + R * Math.sin(th)]);
  }
  const s2 = slide(gBlue, gBlue, spts, { w: 0.82, wall: 0.52 });
  cols.push(...s2.cols);
  rec.slides.push(...s2.segs.map((s) => ({ ...s, speed: 5.5 })));
  // central pole + arms
  gSteel.tube('y', -D, 0.9, C[0], C[1], 0.07, 12);
  cols.push(aabbCol(C[0] - 0.08, -D, C[1] - 0.08, C[0] + 0.08, 0.9, C[1] + 0.08));
  for (let k = 0; k < 5; k++) {
    const t = (k + 0.5) / 5, th = Math.PI / 2 + t * turns * Math.PI * 2, y = yAt(t) - 0.1;
    gSteel.tubePath([[C[0], y, C[1]], [C[0] + (R - 0.2) * Math.cos(th), y, C[1] + (R - 0.2) * Math.sin(th)]], 0.025, 6);
  }
  // steel stair up the west pit wall
  cols.push(...stair(gSteel, gSteel, r.x0 + 0.9, r.z0 + 0.25, yCol, -yCol, 8, [0, 1], 0.9, 0.3));
  // railing with gaps at the chute, the flume lead-in and the stair top
  const sz2 = C[1] + R;
  cols.push(...rimRailing(gRail, r, 0.14, [
    { side: 'N', a: sx - 0.52, b: sx + 0.52 },
    { side: 'E', a: sz2 - 0.52, b: sz2 + 0.52 },
    { side: 'W', a: r.z0 + 0.25 + 2.1, b: r.z0 + 0.25 + 2.5 },
  ]));
  ballFill(level, rec, r, yBall, 220, rng);
  bakeInto(level, rec, gWall, plastic(0x3a62b0), { cast: false });
  bakeInto(level, rec, gRim, plastic(0xf0c020), { quant: 0.3 });
  bakeInto(level, rec, gYel, plastic(0xf2c21a), { cast: true, quant: 0.2 });
  bakeInto(level, rec, gRed, plastic(0xd0402a), { cast: true, quant: 0.2 });
  bakeInto(level, rec, gBlue, plastic(0x2f78c8), { cast: true, quant: 0.2 });
  bakeInto(level, rec, gSteel, Mat.get('galvanized'), { cast: true, quant: 0.25 });
  bakeInto(level, rec, gRail, plastic(0xe0602a), { cast: true, quant: 0.3 });
  staticBody(level, rec, cols, 'prop');
}

// --- play tower over a shallow ball pit: stairs up to a deck, a slide down into the balls ---
function ballPit(level, rec, room, b, rng) {
  const r = pitRect(room, rec);
  const D = r.depth, yBall = -D + 0.8, yCol = -D + 0.4;
  const gWall = new EnvGeo(), gRim = new EnvGeo(), gSl = new EnvGeo(), gSh = new EnvGeo(), gDeck = new EnvGeo(), gPost = new EnvGeo(), gRail = new EnvGeo();
  const cols = pit(gWall, null, gRim, r, D, yCol);
  const cx = (r.x0 + r.x1) / 2, dy = 1.3;
  // deck on four posts against the north wall
  const dz0 = b.z0 + 0.25, dz1 = r.z0 - 0.15, dx0 = cx - 0.55, dx1 = cx + 0.55;
  gDeck.box(dx0, dy - 0.06, dz0, dx1, dy, dz1, {}, 0.6);
  cols.push(aabbCol(dx0, dy - 0.06, dz0, dx1, dy, dz1));
  for (const [x, z] of [[dx0 + 0.05, dz0 + 0.05], [dx1 - 0.05, dz0 + 0.05], [dx0 + 0.05, dz1 - 0.05], [dx1 - 0.05, dz1 - 0.05]]) {
    gPost.box(x - 0.05, 0, z - 0.05, x + 0.05, dy + 1.5, z + 0.05, { ny: true }, 0.6);
    cols.push(aabbCol(x - 0.05, 0, z - 0.05, x + 0.05, dy + 1.5, z + 0.05));
  }
  // roof canopy just under the 2.9 m ceiling (clones on the deck stand 2.66 m tall)
  gSh.box(dx0 - 0.08, dy + 1.5, dz0 - 0.02, dx1 + 0.08, dy + 1.55, dz1 + 0.08, {}, 0.6);
  cols.push(aabbCol(dx0 - 0.08, dy + 1.5, dz0 - 0.02, dx1 + 0.08, dy + 1.55, dz1 + 0.08));
  // stairs from the west walkway up to the deck (5 x 0.26)
  cols.push(...stair(gDeck, gPost, dx0 - 1.5, dz0 + 0.1, 0, dy, 5, [1, 0], 0.8, 0.3));
  // rails on the east side and the back
  cols.push(...railing(gRail, [[dx1, dy, dz0 + 0.05], [dx1, dy, dz1 - 0.05]], 0.75));
  cols.push(...railing(gRail, [[dx0 + 0.05, dy, dz0 + 0.03], [dx1 - 0.05, dy, dz0 + 0.03]], 0.75));
  // the slide from the deck's front edge into the balls
  const zs = dz1 - 0.05, ze = r.z0 + 2.1, yEnd = yBall + 0.2;
  const pts = samplePath((t) => {
    let y;
    if (t < 0.08) y = dy + 0.02;
    else if (t > 0.88) y = yEnd;
    else { const u = (t - 0.08) / 0.8; y = dy + 0.02 + (yEnd - dy - 0.02) * (u * u * (3 - 2 * u)); }
    return [cx, y, zs + (ze - zs) * t];
  }, 14);
  const s = slide(gSl, gSh, pts, { w: 0.82, wall: 0.3 });
  cols.push(...s.cols);
  // the pit is short: brake on the run-out and only nudge clones off the end, so they drop into the balls
  // instead of flying across and over the far wall
  const segs = s.segs.map((q) => ({ ...q, speed: 5.5 }));
  Object.assign(segs[segs.length - 1], { speed: 2.6, runout: 0.3 });
  rec.slides.push(...segs);
  // rail around the pit, open where the slide passes (north) and at the steps out (south-east corner)
  cols.push(...rimRailing(gRail, r, 0.12, [{ side: 'N', a: cx - 0.52, b: cx + 0.52 }, { side: 'S', a: r.x1 - 1.05, b: r.x1 - 0.05 }]));
  // steps out of the pit in the south-east corner (clear of where the slide drops you)
  cols.push(...stair(gDeck, gPost, r.x1 - 0.1, r.z1 - 1.25, yCol, -yCol, 3, [0, 1], 0.9, 0.38));
  ballFill(level, rec, r, yBall, 120, rng);
  bakeInto(level, rec, gWall, plastic(0xd04a5a));
  bakeInto(level, rec, gRim, plastic(0x2f78c8), { quant: 0.3 });
  bakeInto(level, rec, gSl, plastic(0x3fa84a), { cast: true, quant: 0.2 });
  bakeInto(level, rec, gSh, plastic(0xf0c020), { cast: true, quant: 0.2 });
  bakeInto(level, rec, gDeck, Mat.get('wood'), { cast: true, quant: 0.25 });
  bakeInto(level, rec, gPost, plastic(0x2f78c8), { cast: true, quant: 0.25 });
  bakeInto(level, rec, gRail, plastic(0xf0c020), { cast: true, quant: 0.3 });
  staticBody(level, rec, cols, 'prop');
}

// --- sunken conversation pit, carpeted, built-in benches, steps on the south side ---
function carpetPit(level, rec, room, b, rng) {
  const r = pitRect(room, rec);
  const D = r.depth;
  const gC = new EnvGeo({ edge: true }), gCush = new EnvGeo(), gTrim = new EnvGeo();
  const cols = pit(gC, gC, gTrim, r, D, -D);
  // benches along N, W, E (seat 0.45 above the pit floor, 0.55 deep), cushions on top
  const sy = -D + 0.45, dpt = 0.55;
  const benches = [[r.x0, r.z0, r.x1, r.z0 + dpt], [r.x0, r.z0 + dpt, r.x0 + dpt, r.z1 - 0.1], [r.x1 - dpt, r.z0 + dpt, r.x1, r.z1 - 0.1]];
  for (const [x0, z0, x1, z1] of benches) {
    gC.box(x0, -D, z0, x1, sy, z1, { ny: true }, 0.75);
    cols.push(aabbCol(x0, -D, z0, x1, sy, z1));
    gCush.box(x0 + 0.03, sy, z0 + 0.03, x1 - 0.03, sy + 0.1, z1 - 0.03, { ny: true }, 0.6);
  }
  // back cushions against the pit walls
  gCush.box(r.x0 + 0.05, sy + 0.1, r.z0 + 0.02, r.x1 - 0.05, sy + 0.5, r.z0 + 0.16, {}, 0.6);
  // steps (4 x 0.26) down from the south walkway, centre
  const cx = (r.x0 + r.x1) / 2;
  cols.push(...stair(gC, gTrim, cx + 0.9, r.z1 - 1.45, -D, D, 4, [0, 1], 1.8, 0.36));
  bakeInto(level, rec, gC, pitCarpet(), { quant: 0.12 });
  bakeInto(level, rec, gCush, cushionMat(), { cast: true, quant: 0.2 });
  bakeInto(level, rec, gTrim, Mat.get('trim'), { quant: 0.3 });
  staticBody(level, rec, cols, 'prop');
  void rng;
}

// --- towers of stacking chairs rising into the dark ---
function chairTower(level, rec, room, b, rng) {
  const H = 8.5;
  const hh = modelHalfHeight('chair_wood');
  const towers = [];
  const n = 5;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rng.range(-0.3, 0.3), rr = k === 0 ? 0 : rng.range(1.1, 1.8);
    towers.push([b.cx + Math.cos(a) * rr, b.cz + Math.sin(a) * rr]);
  }
  const M = [];
  const e = new THREE.Euler(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  const cols = [];
  for (const [tx, tz] of towers) {
    let y = 0;
    let lean = [0, 0];
    while (y < H - 0.4) {
      lean = [lean[0] + rng.range(-0.05, 0.05), lean[1] + rng.range(-0.05, 0.05)];
      const flip = rng.chance(0.25);
      e.set(rng.range(-0.12, 0.12) + (flip ? Math.PI : 0), rng.range(-Math.PI, Math.PI), rng.range(-0.12, 0.12));
      q.setFromEuler(e);
      p.set(tx + lean[0], y + hh, tz + lean[1]);
      M.push(new THREE.Matrix4().compose(p, q, s));
      y += rng.range(0.5, 0.62);
    }
    cols.push(aabbCol(tx - 0.32, 0, tz - 0.32, tx + 0.32, H, tz + 0.32));
  }
  // detailed chairs where you can see them up close, a low-poly stacking chair for the stacks above (tens of
  // chairs vanishing into the dark would otherwise cost ~7k triangles each)
  const near = M.filter((m) => m.elements[13] < 2.3), far = M.filter((m) => m.elements[13] >= 2.3);
  instancedFurniture(level, rec, 'chair_wood', near, new THREE.Vector3(b.cx, 1.5, b.cz));
  if (far.length) {
    const im = new THREE.InstancedMesh(lowChair(hh), lowChairMat(), far.length);
    far.forEach((m, k) => im.setMatrixAt(k, m));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.userData.sharedGeo = true;
    const holder = new THREE.Group();
    holder.position.set(b.cx, 3.2, b.cz);
    im.position.copy(holder.position).negate();
    holder.add(im);
    rec.group.add(holder);
    level.prepStatic(holder, rec);
  }
  staticBody(level, rec, cols, 'wood');
  room.towers = towers;
}

// low-poly stacking chair (frame + green seat and back, vertex coloured), origin at its bounding-box centre
let _lowChair = null;
function lowChair(hh) {
  if (_lowChair) return _lowChair;
  const parts = [];
  const wood = new THREE.Color(0xd2b48a), seat = new THREE.Color(0x24493c);
  const piece = (w, h, d, x, y, z, col) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y - hh, z);
    const n = g.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(g);
  };
  for (const sx of [-0.2, 0.2]) for (const sz of [-0.19, 0.19]) piece(0.032, 0.45, 0.032, sx, 0.225, sz, wood);
  for (const sx of [-0.2, 0.2]) piece(0.035, 0.42, 0.035, sx, 0.66, -0.2, wood);
  piece(0.46, 0.035, 0.44, 0, 0.46, 0, wood);
  piece(0.42, 0.05, 0.4, 0, 0.5, 0.01, seat);
  piece(0.42, 0.24, 0.04, 0, 0.74, -0.2, seat);
  _lowChair = mergeGeometries(parts);
  _lowChair.userData.shared = true;
  return _lowChair;
}
let _lowChairMat = null;
function lowChairMat() { return _lowChairMat || (_lowChairMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 })); }

// --- furniture stuck to the ceiling, upside down ---
function ceilingRoom(level, rec, room, b, rng) {
  const put = (type, x, z, yaw) => placeStatic(level, rec, type, x, HEIGHT - 2 * modelHalfHeight(type), z, yaw, { rx: Math.PI });
  // (the troffers run along x through the cell centres: everything stays off those strips)
  put('desk', b.x0 + 3.0, b.z0 + 0.62, 0.02);
  put('chair_office', b.x0 + 3.0, b.z0 + 1.55, 2.9);
  put('couch', b.x0 + 3.0, b.z0 + 5.4, Math.PI);
  put('table_round', b.x0 + 1.5, b.z0 + 3.0, 0);
  put('mug', b.x0 + 1.5, b.z0 + 3.0, 1.2);
  put('filing_cabinet', b.x0 + 0.45, b.z0 + 3.0, Math.PI / 2);
  put('plant_pot', b.x0 + 5.5, b.z0 + 0.5, 0.3);
  put('lamp_floor', b.x0 + 5.5, b.z0 + 5.5, 0);
  put('chair_wood', b.x0 + 4.5, b.z0 + 3.0, rng.next() * 6);
  put('trash_can', b.x0 + 0.5, b.z0 + 5.5, 0);
}

// --- giant furniture (scaled models with scaled colliders) in a tall hall ---
function giantRoom(level, rec, room, b, rng) {
  placeStatic(level, rec, 'chair_wood', b.cx - 1.2, 0, b.cz - 0.6, 0.35, { scale: 4.2, collide: true });
  placeStatic(level, rec, 'table_round', b.cx + 1.6, 0, b.cz - 1.4, 0.2, { scale: 3.4, collide: true });
  placeStatic(level, rec, 'lamp_desk', b.cx + 0.2, 0, b.z1 - 1.3, -2.4, { scale: 5.5, collide: true });
  // a giant mug knocked over on its side, a giant stack of paper (the corners are lit by the only fixtures)
  placeStatic(level, rec, 'mug', b.x0 + 1.6, 0.42, b.z1 - 1.6, 0.8, { scale: 9, collide: true, rz: Math.PI / 2, useHalf: false });
  placeStatic(level, rec, 'paper_stack', b.x0 + 1.4, 0, b.z0 + 1.6, 0.3, { scale: 6, collide: true });
  placeStatic(level, rec, 'crt_monitor', b.cx + 1.6, 2.45, b.cz - 1.4, -0.4, { scale: 2.6 });
  void rng;
}

// --- a corridor lined on both sides with identical six-panel doors ---
export function sixPanelDoors(leaf, frame, brass, x0, x1, wz, side, pitch = 1.5) {
  // doors on the wall face at z = wz facing `side` (+1: +z, -1: -z)
  const S = side;
  const Z = (dz) => wz + S * dz;
  const zb = (a, c) => [Math.min(Z(a), Z(c)), Math.max(Z(a), Z(c))];
  const front = S > 0 ? 'pz' : 'nz', back = S > 0 ? { nz: true } : { pz: true };
  for (let x = x0 + pitch / 2; x < x1 - 0.3; x += pitch) {
    const dw = 0.46, dh = 2.04, t = 0.04;
    leaf.ao = 1;
    let [za, zc] = zb(0.02, 0.02 + t);
    leaf.chamferBox(x - dw, 0.012, za, x + dw, dh, zc, 0.006, front, back, (px, py) => [py, px]);
    const fz = 0.02 + t;
    for (const [u0, u1] of [[-0.36, -0.04], [0.04, 0.36]]) {
      for (const [v0, v1] of [[0.14, 0.86], [0.98, 1.56], [1.68, 1.92]]) {
        [za, zc] = zb(fz - 0.002, fz + 0.006);
        leaf.chamferBox(x + u0, v0, za, x + u1, v1, zc, 0.006, front, back, (px, py) => [py, px]);
      }
    }
    frame.ao = 1;
    const cw = 0.065;
    [za, zc] = zb(0, 0.078);
    frame.chamferBox(x - dw - cw, 0, za, x - dw + 0.004, dh + cw, zc, 0.005, front, { ...back, ny: true }, (px, py) => [py, px]);
    frame.chamferBox(x + dw - 0.004, 0, za, x + dw + cw, dh + cw, zc, 0.005, front, { ...back, ny: true }, (px, py) => [py, px]);
    frame.chamferBox(x - dw - cw, dh - 0.004, za, x + dw + cw, dh + cw, zc, 0.005, front, back, (px, py) => [px, py]);
    brass.ao = 1;
    const kx = x + dw - 0.07;
    brass.tube('z', Z(fz), Z(fz + 0.055), kx, 1.0, 0.009, 8, [false, false]);
    brass.tube('z', Z(fz + 0.05), Z(fz + 0.075), kx, 1.0, 0.027, 12, [true, true]);
    // number plate
    [za, zc] = zb(fz, fz + 0.004);
    brass.box(x - 0.06, 1.62, za, x + 0.06, 1.68, zc, back);
  }
}
function doorCorridor(level, rec, room, b) {
  const leaf = new EnvGeo(), frame = new EnvGeo(), brass = new EnvGeo();
  const T2 = 0.08;
  sixPanelDoors(leaf, frame, brass, b.x0 + 0.4, b.x1 - 0.4, b.z0 + T2, 1);
  sixPanelDoors(leaf, frame, brass, b.x0 + 0.4, b.x1 - 0.4, b.z1 - T2, -1);
  bakeInto(level, rec, leaf, Mat.make('trim', { color: 0xd8c4a8 }), { cast: true });
  bakeInto(level, rec, frame, Mat.get('trim'));
  bakeInto(level, rec, brass, Mat.get('brass'), { quant: 0.3 });
}

// --- the office party, frozen mid-celebration ---
function frozenParty(level, rec, room, b, rng) {
  // banner across the north wall
  placeStatic(level, rec, 'party_banner', b.cx, 2.05, b.z0 + 0.12, 0, { useHalf: false });
  // balloons hanging motionless at every height
  for (let k = 0; k < 14; k++) {
    const x = b.x0 + 0.5 + rng.next() * (b.w - 1), z = b.z0 + 0.5 + rng.next() * (b.d - 1);
    placeStatic(level, rec, 'balloon', x, rng.range(-0.2, 1.1), z, rng.next() * 6, { useHalf: false, modelOpts: { variant: k % 4 }, rx: rng.range(-0.15, 0.15), rz: rng.range(-0.15, 0.15) });
  }
  // a chair caught mid-topple, a mug mid-spill (with the coffee in the air)
  placeStatic(level, rec, 'chair_folding', b.x0 + 1.6, 0.12, b.z1 - 1.3, 0.6, { rx: -0.85 });
  const mx = b.cx + 1.9, mz = b.cz + 0.9;
  placeStatic(level, rec, 'mug', mx, 1.05, mz, 0.4, { rz: 2.1, useHalf: false });
  const coffee = new EnvGeo();
  const pts = [];
  for (let k = 0; k <= 8; k++) { const t = k / 8; pts.push([mx + 0.06 + t * 0.12, 1.02 - t * t * 1.0, mz + Math.sin(t * 3) * 0.02]); }
  coffee.tubePath(pts, 0.012, 6);
  coffee.ring(mx + 0.2, 0.004, mz, 0, 0.22, 14, 1);
  bakeInto(level, rec, coffee, mk('coffee', () => Mat.make('plastic_black', { color: 0x3a2412 })), { quant: 0.3 });
  // confetti hanging in the air over the tables (and some on the carpet)
  const cf = new EnvGeo({ color: true });
  const pal = [[0.9, 0.2, 0.2], [0.2, 0.45, 0.9], [0.95, 0.8, 0.15], [0.3, 0.8, 0.35], [0.9, 0.4, 0.8], [1, 1, 1]];
  for (let k = 0; k < 360; k++) {
    const onFloor = k < 90;
    const x = b.cx + rng.range(-2.6, 2.6), z = b.cz + rng.range(-1.6, 1.6), y = onFloor ? 0.003 : rng.range(0.9, 2.5);
    const s = 0.012 + rng.next() * 0.01;
    const c = pal[k % pal.length];
    cf.setRGB(c[0], c[1], c[2]);
    const u = [Math.cos(k * 1.7), onFloor ? 0 : Math.sin(k * 2.3) * 0.7, Math.sin(k * 1.7)];
    const nl = Math.hypot(...u);
    const uu = [u[0] / nl, u[1] / nl, u[2] / nl];
    const vv = onFloor ? [0, 0, 1] : [-uu[2], 0.4, uu[0]];
    const n = onFloor ? [0, 1, 0] : [0, 1, 0];
    cf.rectOriented([[x - uu[0] * s - vv[0] * s, y - uu[1] * s - vv[1] * s, z - uu[2] * s - vv[2] * s], [x + uu[0] * s - vv[0] * s, y + uu[1] * s - vv[1] * s, z + uu[2] * s - vv[2] * s],
      [x + uu[0] * s + vv[0] * s, y + uu[1] * s + vv[1] * s, z + uu[2] * s + vv[2] * s], [x - uu[0] * s + vv[0] * s, y - uu[1] * s + vv[1] * s, z - uu[2] * s + vv[2] * s]], n);
  }
  bakeInto(level, rec, cf, confettiMat(), { quant: 0.3 });
  // party hats left on the tables' corners
  placeStatic(level, rec, 'party_hat', b.cx - 1.1, 0.735, b.cz - 0.6, 0.3, { modelOpts: { variant: 0 } });
  placeStatic(level, rec, 'party_hat', b.cx + 1.2, 1.4, b.cz + 0.2, 0.3, { modelOpts: { variant: 1 }, rx: 0.8 });
}

// --- the tilted room: floor, walls and ceiling pitched 9 degrees, everything glued to the slope ---
const TILT = 0.157;
function tiltedRoom(level, rec, room, b, rng) {
  const zs = b.z1 - 0.08, Hs = 2.6, xa = b.x0 + 0.11, xb = b.x1 - 0.11;
  const L = (b.z1 - b.z0 - 0.2) / Math.cos(TILT);
  const M = new THREE.Matrix4().makeTranslation(0, 0, zs).multiply(new THREE.Matrix4().makeRotationX(TILT));
  const tan = Math.tan(TILT);
  const gF = new EnvGeo({ edge: true }), gW = new EnvGeo({ wet: true }), gC = new EnvGeo({ edge: true }), gT = new EnvGeo(), gEn = new EnvGeo(), gLens = new EnvGeo();
  const marks = [gF, gW, gC, gT, gEn, gLens].map((g) => g.vc);
  // local frame: room floor at y = 0, south (entrance) line at z = 0, the room runs towards -z
  gF.grid([xa, 0, 0], [xb - xa, 0, 0], [0, 0, -L], [0, 1, 0], [0, 0.33, 0.67, 1], [0, 0.2, 0.4, 0.6, 0.8, 1], (x, y, z) => [x, z]);
  const uMin = (v) => v * tan + 0.02;
  for (const [x, nx] of [[xa, 1], [xb, -1]]) {
    gW.rectOriented([[x, 0, -uMin(0)], [x, 0, -L], [x, Hs, -L], [x, Hs, -uMin(Hs)]], [nx, 0, 0], (px, py, pz) => [pz, py]);
    // skirting
    gT.box(nx > 0 ? x : x - 0.015, 0, -L, nx > 0 ? x + 0.015 : x, 0.1, -uMin(0.1), {});
  }
  gW.rectOriented([[xa, 0, -L], [xb, 0, -L], [xb, Hs, -L], [xa, Hs, -L]], [0, 0, 1], (px, py) => [px, py]);
  gT.box(xa, 0, -L, xb, 0.1, -L + 0.015, {});
  gC.grid([xa, Hs, -uMin(Hs)], [xb - xa, 0, 0], [0, 0, -(L - uMin(Hs))], [0, -1, 0], [0, 0.5, 1], [0, 0.25, 0.5, 0.75, 1], (x, y, z) => [x, z]);
  // three troffers down the middle of the slanted ceiling
  const xm = (xa + xb) / 2;
  for (const u of [1.6, 4.6, 7.6]) if (u < L - 0.8) troffer({ enamel: gEn, lens: gLens }, xm - 0.3, -u - 0.6, xm + 0.3, -u + 0.6, false, 0.5, Hs - 0.05);
  for (let k = 0; k < marks.length; k++) [gF, gW, gC, gT, gEn, gLens][k].transformRange(marks[k], M);
  bakeInto(level, rec, gF, Mat.get('carpet'), { quant: 0.1 });
  bakeInto(level, rec, gW, Mat.get('wallpaper'), { quant: 0.1, cast: true });
  bakeInto(level, rec, gC, Mat.get('ceiling'), { quant: 0.12, mix: [0.3, 0.4] });
  bakeInto(level, rec, gT, Mat.get('trim'), { quant: 0.3 });
  bakeInto(level, rec, gEn, Mat.get('enamel'), { quant: 0.3 });
  bakeInto(level, rec, gLens, Mat.get('lightpanel'), { quant: 0.6, emissive: true, lens: true, mix: [0.2, 0.4] });
  // colliders: the ramp, the slanted ceiling and the far wall (rotated boxes)
  const P = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(M).toArray();
  const R = [TILT, 0, 0];
  const cols = [
    { type: 'box', size: [xb - xa, 0.3, L], pos: P(xm, -0.15, -L / 2), rot: R },
    { type: 'box', size: [xb - xa, 0.3, L], pos: P(xm, Hs + 0.15, -L / 2), rot: R },
    { type: 'box', size: [xb - xa, Hs, 0.3], pos: P(xm, Hs / 2, -L - 0.15), rot: R },
  ];
  staticBody(level, rec, cols, 'floor');
  // furniture glued to the slope (static, with colliders)
  const glue = (type, lx, u, yaw, collide = true, ly = 0) => {
    const hh = modelHalfHeight(type);
    const c = new THREE.Vector3(lx, ly + hh, -u).applyMatrix4(M);
    return placeStatic(level, rec, type, c.x, c.y, c.z, yaw, { rx: TILT, useHalf: false, collide });
  };
  glue('desk', xa + 0.6, 4.2, Math.PI / 2);
  glue('chair_office', xa + 1.3, 4.3, -Math.PI / 2 + 0.3);
  glue('crt_monitor', xa + 0.5, 4.2, Math.PI / 2, false, 0.76);
  glue('bookshelf', xm - 0.6, L - 0.2, 0);
  glue('bookshelf', xm + 0.4, L - 0.2, 0);
  glue('armchair', xb - 0.6, 2.2, -Math.PI / 2 - 0.2);
  glue('table_round', xm + 0.6, 2.6, 0);
  glue('mug', xm + 0.6, 2.6, 1.1, false, 0.72);
  glue('lamp_floor', xa + 0.4, 0.9, 0);
  glue('filing_cabinet', xb - 0.35, 6.4, -Math.PI / 2);
  glue('plant_pot', xa + 0.35, 7.6, 0);
  glue('couch', xb - 0.5, 4.6, -Math.PI / 2);
  room.tiltM = M;
  void rng;
}

// ---------------------------------------------------------------------------
export function populateWeird(level, room, rec, rng) {
  const b = roomBounds(room, rec);
  const placer = new Placer(level);
  const r = (a) => rng.range(-a, a);
  switch (room.kind) {
    case 'slide_pit': {
      for (let k = 0; k < 3; k++) spPlaced(level, placer, rng.pick(['basketball', 'rubber_duck', 'traffic_cone']), b.x0 + 0.8, b.z0 + 0.8 + k * 2.6, rng.next() * 6);
      spPlaced(level, placer, 'stool', b.x1 - 0.7, b.z0 + 0.8, 0);
      sp(level, rng.pick(['almond_water', 'soda_can', 'candy_bar']), (b.x0 + b.x1) / 2 + r(1.2), -room.pit.depth + 0.9, (b.z0 + b.z1) / 2 + r(1.2), 0, { sleep: false });
      break;
    }
    case 'ball_pit': {
      const rr = pitRect(room, rec);
      for (let k = 0; k < 3; k++) sp(level, rng.pick(['rubber_duck', 'basketball']), rr.x0 + 0.5 + rng.next() * (rr.x1 - rr.x0 - 1), -room.pit.depth + 0.85, rr.z0 + 0.5 + rng.next() * (rr.z1 - rr.z0 - 1), rng.next() * 6, { sleep: false });
      spPlaced(level, placer, 'box_medium', b.x1 - 0.5, b.z1 - 0.5, 0.2);
      break;
    }
    case 'carpet_pit': {
      const rr = pitRect(room, rec), D = room.pit.depth;
      const cx = (rr.x0 + rr.x1) / 2, cz = (rr.z0 + rr.z1) / 2;
      sp(level, 'table_round', cx, -D, cz - 0.1, 0);
      sp(level, 'armchair', cx - 1.0, -D, cz + 0.9, 2.6);
      sp(level, 'armchair', cx + 1.1, -D, cz + 0.8, -2.5);
      sp(level, 'mug', cx + 0.1, -D + 0.72, cz - 0.1, r(3));
      sp(level, rng.pick(['chips', 'soda_can', 'candy_bar']), cx - 0.15, -D + 0.72, cz, r(3));
      sp(level, 'lamp_floor', rr.x1 + 0.6, 0, rr.z0 - 0.6, 0);
      sp(level, 'plant_pot', rr.x0 - 0.6, 0, rr.z0 - 0.6, 0);
      spPlaced(level, placer, 'tv_crt', cx, rr.z0 - 0.75, 0);
      break;
    }
    case 'chair_tower': {
      for (let k = 0; k < 6; k++) {
        const a = rng.next() * 6.28, rr = rng.range(0.9, 2.4);
        spPlaced(level, placer, 'chair_wood', b.cx + Math.cos(a) * rr, b.cz + Math.sin(a) * rr, rng.next() * 6.28);
      }
      break;
    }
    case 'ceiling_room': {
      spPlaced(level, placer, 'paper_stack', b.cx + r(1), b.cz + r(1), rng.next() * 6);
      spPlaced(level, placer, rng.pick(['almond_water', 'battery', 'protein_bar']), b.cx + r(1.5), b.cz + r(1.5), rng.next() * 6);
      break;
    }
    case 'giant_room': {
      for (const t of ['chair_wood', 'box_small', 'mug', 'chair_folding']) spPlaced(level, placer, t, b.cx + r(2.5), b.cz + 1.5 + r(1), rng.next() * 6);
      break;
    }
    case 'door_corridor': {
      if (rng.chance(0.6)) spPlaced(level, placer, rng.pick(['almond_water', 'flashlight', 'battery']), b.cx + r(6), b.cz, rng.next() * 6);
      break;
    }
    case 'frozen_party': {
      const tables = [[b.cx - 1.1, b.cz - 0.4], [b.cx + 1.2, b.cz + 0.3]];
      const th = modelHalfHeight('table_folding') * 2;
      tables.forEach(([x, z], i) => {
        const p = sp(level, 'table_folding', x, 0, z, i ? 0.08 : -0.05);
        if (!p) return;
        if (i === 0) sp(level, 'cake', x + 0.2, th, z, 0.1);
        for (let k = 0; k < 3; k++) sp(level, rng.pick(['chips', 'soda_can', 'candy_bar', 'soda_can', 'mug']), x - 0.5 + k * 0.35 + r(0.05), th, z + (i ? 0.2 : -0.22), rng.next() * 6);
        for (const s2 of [-1, 1]) spPlaced(level, placer, 'chair_folding', x + s2 * 0.5, z + s2 * 0.75, s2 > 0 ? Math.PI : 0);
      });
      spPlaced(level, placer, 'radio_cassette', b.x1 - 0.6, b.z0 + 0.5, Math.PI + 0.3);
      spPlaced(level, placer, 'trash_can', b.x0 + 0.5, b.z1 - 0.5, 0);
      break;
    }
    case 'tilted_room': {
      // a ball left at the top of the slope (it rolls down to greet you)
      if (room.tiltM) {
        const c = new THREE.Vector3((b.x0 + b.x1) / 2 - 0.3, 0.3, -(b.z1 - b.z0 - 0.9)).applyMatrix4(room.tiltM);
        sp(level, 'basketball', c.x, c.y - modelHalfHeight('basketball'), c.z, 0, { sleep: false });
      }
      break;
    }
    default: break;
  }
}

export function weirdPhotoSubject(kind) {
  return {
    slide_pit: ['THE PIT OF FUN', 80], ball_pit: ['ABANDONED PLAYROOM', 50], carpet_pit: ['SUNKEN LOUNGE', 40],
    chair_tower: ['ENDLESS STACKED CHAIRS', 85], ceiling_room: ['GRAVITY ANOMALY', 90], giant_room: ['GIANT FURNITURE', 75],
    door_corridor: ['CORRIDOR OF IDENTICAL DOORS', 60], frozen_party: ['FROZEN CELEBRATION', 85], tilted_room: ['TILTED ROOM', 80],
    mirror_room: ['MIRRORED ROOM', 55],
  }[kind] || null;
}
