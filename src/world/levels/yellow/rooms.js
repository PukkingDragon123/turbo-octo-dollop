// Contents of memorable / special rooms in the Yellow Rooms.
// decorateRoom: static meshes, extra colliders and devices (runs on every peer, deterministic).
// populateRoom: physics props (host only, once per run).
import * as THREE from 'three';
import * as Mat from '../../../gfx/materials.js';
import { CELL, CHUNK, HEIGHT } from './layout.js';
import { buildModel, modelHalfHeight } from '../../../entities/catalog.js';
import { RNG, hash3 } from '../../../core/rng.js';
import { makeDevice } from '../../../game/devicekinds.js';
import { CRATE_LOOT } from '../../../game/itemdefs.js';
import { bakedMaterial } from '../../../gfx/bakedlight.js';
import { EnvGeo } from '../../env/builder.js';
import { GridBaker } from '../../env/gridbake.js';

// merged static room geometry, lit by the chunk's grid light field like the rest of the level
function bakeInto(level, rec, g, mat, o = {}) {
  if (g.isEmpty()) return null;
  const geo = g.build();
  const baker = rec._roomBaker || (rec._roomBaker = new GridBaker(level.seed, level.variantFn, rec.cx, rec.cz));
  const mix = o.mix || [1, 0.3];
  baker.bake(geo, { direct: mix[0], bounce: mix[1], quant: o.quant ?? 0.15 });
  const m = new THREE.Mesh(geo, bakedMaterial(mat, level.field, o.grime ?? 0, { grid: 1, mix }));
  m.receiveShadow = true;
  m.castShadow = !!o.cast;
  m.matrixAutoUpdate = false;
  rec.group.add(m);
  return m;
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

function roomBounds(room, rec) {
  const x0 = (rec.cx * CHUNK + room.rx) * CELL, z0 = (rec.cz * CHUNK + room.rz) * CELL;
  return { x0, z0, x1: x0 + room.w * CELL, z1: z0 + room.h * CELL, cx: x0 + (room.w * CELL) / 2, cz: z0 + (room.h * CELL) / 2 };
}

function placeStatic(level, rec, type, x, y, z, rotY = 0, opts = {}) {
  const m = buildModel(type, { seed: (x * 13 + z * 7) | 0, ...(opts.modelOpts || {}) });
  const o = m.object;
  o.position.set(x, y + (opts.useHalf === false ? 0 : m.halfHeight ?? 0), z);
  o.rotation.set(opts.rx || 0, rotY, opts.rz || 0);
  if (opts.scale) o.scale.setScalar(opts.scale);
  rec.group.add(o);
  level.prepStatic(o, rec);
  if (opts.collide && m.colliders?.length) {
    o.updateMatrixWorld(true);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    o.matrixWorld.decompose(p, q, s);
    const res = level.world.physics.addStaticCollidersFromDesc(m.colliders, p, q, { kind: 'static', surface: 'prop' });
    rec.physicsColliders.push(...res.colliders);
    rec.extraBodies = rec.extraBodies || [];
    rec.extraBodies.push(res.body);
  }
  return { o, m };
}

// the pipe cluster's open floor duct is a critter exit: they run to the mouth and climb inside
function pipeExit(level, { o, m }) {
  if (!level.critters || !m.anchors?.mouth) return;
  o.updateWorldMatrix(true, false);
  const mouth = m.anchors.mouth.clone().applyMatrix4(o.matrixWorld);
  const inside = (m.anchors.inside || m.anchors.mouth).clone().applyMatrix4(o.matrixWorld);
  level.critters.addVent(mouth.setY(0.15), o, inside);
}

function addDevice(level, rec, kind, id, pos, rotY, opts = {}) {
  let dev = level.world.devices.get(id);
  if (!dev) {
    dev = makeDevice(level.world, kind, id, opts);
    if (!dev) return null;
    dev.root.position.copy(pos);
    dev.root.rotation.y = rotY;
    dev.build?.();
    level.world.addDevice(dev);
    level.prepStatic(dev.root, null);
  }
  dev.root.visible = true;
  rec.roomDevices = rec.roomDevices || [];
  rec.roomDevices.push(dev);
  return dev;
}

let _stairPaint = null, _doorPaint = null;
function stairPaint() { return _stairPaint || (_stairPaint = Mat.make('trim_paint', { color: 0xb8ab88 })); }
function doorPaint() { return _doorPaint || (_doorPaint = Mat.make('trim', { color: 0xd8c4a8 })); }

// ---------------------------------------------------------------------------
export function decorateRoom(level, room, rec) {
  const b = roomBounds(room, rec);
  const rid = `${rec.cx},${rec.cz}:${room.kind}`;
  const rng = new RNG(hash3(rec.cx, rec.cz, 4242, level.seed));
  switch (room.kind) {
    case 'spawn': {
      // the torn-open ceiling (shaft, hanging tiles / tees, cables) is built with the chunk ceiling
      break;
    }
    case 'workshop': {
      addDevice(level, rec, 'workbench', `wb:${rid}`, new THREE.Vector3(b.cx, 0, b.z0 + 0.55), 0);
      pipeExit(level, placeStatic(level, rec, 'pipe_cluster', b.x1 - 0.15, 0, b.cz, -Math.PI / 2, { useHalf: false }));
      break;
    }
    case 'vending_lonely': {
      addDevice(level, rec, 'vending_snack', `vend:${rid}`, new THREE.Vector3(b.cx, 0, b.z0 + 0.6), 0, { backrooms: true });
      break;
    }
    case 'office_room':
    case 'fuse_office': {
      addDevice(level, rec, 'lore_terminal', `term:${rid}`, new THREE.Vector3(b.cx, 0.76, b.z0 + 0.55), 0, { lore: rng.int(0, 99) });
      placeStatic(level, rec, 'desk', b.cx, 0, b.z0 + 0.65, 0, { collide: true });
      break;
    }
    case 'tv_room': {
      addDevice(level, rec, 'creepy_tv', `tv:${rid}`, new THREE.Vector3(b.cx, 0, b.z0 + 0.5), 0);
      break;
    }
    case 'red_chair': {
      const { o } = placeStatic(level, rec, 'chair_wood', b.cx, 0, b.cz, Math.PI + 0.02, { collide: true });
      o.userData.redChair = true;
      break;
    }
    case 'stairs_nowhere': {
      // a solid timber staircase climbing straight into the drop ceiling: nosed treads, painted risers
      // and closed strings (colliders are the same stepped blocks as always)
      const steps = 12, d = 0.32, hw = 0.6;
      const tread = new EnvGeo(), paint = new EnvGeo();
      for (let s = 0; s < steps; s++) {
        const h = (s + 1) * (HEIGHT / steps), hp = s * (HEIGHT / steps);
        const z0 = b.z0 + 0.3 + s * d, z1 = z0 + d;
        // tread with a rounded nosing over the riser
        tread.ao = 1;
        tread.chamferBox(b.cx - hw - 0.012, h - 0.032, z0 - 0.028, b.cx + hw + 0.012, h, z1, 0.01, 'nz', { pz: true }, (x, y, z) => [x, z + y]);
        // riser (front) and the closed side strings
        paint.ao = 0.92;
        paint.rectOriented([[b.cx - hw, hp, z0], [b.cx + hw, hp, z0], [b.cx + hw, h - 0.032, z0], [b.cx - hw, h - 0.032, z0]], [0, 0, -1], (x, y) => [x, y]);
        paint.ao = 1;
        for (const sx of [-1, 1]) {
          const x = b.cx + sx * hw;
          paint.rectOriented([[x, 0, z0], [x, 0, z1], [x, h - 0.032, z1], [x, h - 0.032, z0]], [sx, 0, 0], (xx, y, z) => [z, y]);
        }
        const c = level.world.physics.addStaticBox(b.cx, h / 2, z0 + d / 2, hw, h / 2, d / 2, { kind: 'static', surface: 'wood' });
        rec.physicsColliders.push(c);
      }
      // back of the flight
      {
        const zb = b.z0 + 0.3 + steps * d;
        paint.rectOriented([[b.cx - hw, 0, zb], [b.cx + hw, 0, zb], [b.cx + hw, HEIGHT, zb], [b.cx - hw, HEIGHT, zb]], [0, 0, 1], (x, y) => [x, y]);
      }
      // skirting along both strings
      const sk = new EnvGeo();
      for (const sx of [-1, 1]) sk.extrude([[0.014, 0], [0.014, 0.074], [0.0075, 0.094], [0, 0.1]], 'z', b.cx + sx * hw, sx, b.z0 + 0.3, b.z0 + 0.3 + steps * d, [true, true]);
      bakeInto(level, rec, tread, Mat.get('trim'), { cast: true });
      bakeInto(level, rec, paint, stairPaint(), { cast: true });
      bakeInto(level, rec, sk, Mat.get('trim'));
      break;
    }
    case 'many_doors': {
      // a wall of identical six-panel doors that lead nowhere: cased frames, raised panels, brass knobs
      const leaf = new EnvGeo(), frame = new EnvGeo(), brass = new EnvGeo();
      const wz = b.z0 + 0.08;
      for (let k = 0; k < room.w * 2; k++) {
        const x = b.x0 + 0.75 + k * 1.5;
        const dw = 0.46, dh = 2.04, t = 0.04;
        leaf.ao = 1;
        leaf.chamferBox(x - dw, 0.012, wz + 0.02, x + dw, dh, wz + 0.02 + t, 0.006, 'pz', { nz: true }, (px, py) => [py, px]);
        // six raised panels (2 x 3)
        const fz = wz + 0.02 + t;
        for (const [u0, u1] of [[-0.36, -0.04], [0.04, 0.36]]) {
          for (const [v0, v1] of [[0.14, 0.86], [0.98, 1.56], [1.68, 1.92]]) {
            leaf.chamferBox(x + u0, v0, fz - 0.002, x + u1, v1, fz + 0.006, 0.006, 'pz', { nz: true }, (px, py) => [py, px]);
          }
        }
        // casing
        frame.ao = 1;
        const cw = 0.065, cd = 0.018;
        frame.chamferBox(x - dw - cw, 0, wz, x - dw + 0.004, dh + cw, wz + 0.02 + cd + 0.02, 0.005, 'pz', { nz: true, ny: true }, (px, py) => [py, px]);
        frame.chamferBox(x + dw - 0.004, 0, wz, x + dw + cw, dh + cw, wz + 0.02 + cd + 0.02, 0.005, 'pz', { nz: true, ny: true }, (px, py) => [py, px]);
        frame.chamferBox(x - dw - cw, dh - 0.004, wz, x + dw + cw, dh + cw, wz + 0.02 + cd + 0.02, 0.005, 'pz', { nz: true }, (px, py) => [px, py]);
        // knob + rose, hinges
        brass.ao = 1;
        const kx = x + dw - 0.07;
        brass.tube('z', fz, fz + 0.012, kx, 1.0, 0.03, 12, [false, true]);
        brass.tube('z', fz + 0.012, fz + 0.055, kx, 1.0, 0.009, 8, [false, false]);
        brass.tube('z', fz + 0.05, fz + 0.075, kx, 1.0, 0.027, 12, [true, true]);
        for (const hy of [0.25, 1.0, 1.8]) brass.box(x - dw - 0.006, hy - 0.05, fz - 0.01, x - dw + 0.004, hy + 0.05, fz + 0.002, { nz: true });
      }
      bakeInto(level, rec, leaf, doorPaint(), { cast: true });
      bakeInto(level, rec, frame, Mat.get('trim'));
      bakeInto(level, rec, brass, Mat.get('brass'), { quant: 0.3 });
      break;
    }
    case 'poolrooms_glimpse': {
      // shallow tiled pool: a glimpse of a future level
      const geo = new THREE.PlaneGeometry(room.w * CELL - 1.2, room.h * CELL - 1.2);
      const pool = new THREE.Mesh(geo, level.waterMaterial);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(b.cx, 0.09, b.cz);
      // light-field attributes so the water shader is lit
      const n = geo.attributes.position.count;
      const cells = new Float32Array(n * 4), w = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        const l = level._lightsNear(b.cx, b.cz)[0];
        cells[i * 4] = l ? l.key : 0;
        w[i * 4] = 1.2;
      }
      geo.setAttribute('aLightCells', new THREE.BufferAttribute(cells, 4));
      geo.setAttribute('aLightW', new THREE.BufferAttribute(w, 4));
      pool.renderOrder = 2;
      rec.group.add(pool);
      level.reflection.meshes.add(pool);
      rec.waterCells.push({ fake: true });
      break;
    }
    case 'vent_room': {
      placeStatic(level, rec, 'wall_vent', b.x0 + 0.12, 0, b.cz, Math.PI / 2, { useHalf: false });
      pipeExit(level, placeStatic(level, rec, 'pipe_cluster', b.x1 - 0.15, 0, b.cz, -Math.PI / 2, { useHalf: false }));
      break;
    }
    case 'dead_clone': {
      // remains of a previous disposable employee
      level.mission?.decorDeadClone(rec, new THREE.Vector3(b.cx + 0.3, 0, b.cz - 0.2), rng);
      break;
    }
    case 'manila_room': {
      placeStatic(level, rec, 'plant_pot', b.x0 + 0.5, 0, b.z0 + 0.5, 0);
      break;
    }
    default: break;
  }
  // wall vents from the layout (critter exits)
  if (!rec._ventsDone) {
    rec._ventsDone = true;
    for (const v of rec.layout.vents) {
      const x = (rec.cx * CHUNK + v.li) * CELL, z = (rec.cz * CHUNK + v.lj) * CELL;
      const pos = v.side === 'N' ? new THREE.Vector3(x + CELL / 2, 0, z + 0.09) : new THREE.Vector3(x + 0.09, 0, z + CELL / 2);
      const { o } = placeStatic(level, rec, 'wall_vent', pos.x, 0, pos.z, v.side === 'N' ? 0 : Math.PI / 2, { useHalf: false });
      const inside = v.side === 'N' ? new THREE.Vector3(pos.x, 0.12, z - 0.02) : new THREE.Vector3(x - 0.02, 0.12, pos.z);
      level.critters?.addVent(pos.clone().setY(0.15), o, inside);
    }
  }
}

// ---------------------------------------------------------------------------
function sp(level, type, x, y, z, rotY = 0, opts = {}) {
  const hh = modelHalfHeight(type);
  _q.setFromEuler(_e.set(opts.rx || 0, rotY, opts.rz || 0));
  // sleeping props start exactly on their support; awake ones (piles) get a few mm to settle into
  const lift = opts.sleep === false ? 0.012 : 0.003;
  return level.world.props.spawn(type, new THREE.Vector3(x, y + hh + lift, z), _q, { sleep: opts.sleep !== false, state: opts.state });
}

export function populateRoom(level, room, rec, rng) {
  const b = roomBounds(room, rec);
  const r = (a) => rng.range(-a, a);
  switch (room.kind) {
    case 'chairpile': {
      // the iconic chaotic pile of stacked chairs: each layer drops onto its own staggered slots (no two chairs
      // start inside each other, so the pile collapses into a heap instead of exploding apart)
      const layers = 3 + rng.int(0, 1);
      for (let layer = 0; layer < layers; layer++) {
        const slots = [6, 4, 3, 1][layer];
        const rr = [0.95, 0.62, 0.42, 0][layer];
        const a0 = rng.next() * 6.28;
        for (let k = 0; k < slots; k++) {
          const a = a0 + (k / slots) * Math.PI * 2;
          sp(level, 'chair_wood', b.cx + Math.cos(a) * rr + r(0.08), 0.05 + layer * 0.95, b.cz + Math.sin(a) * rr + r(0.08), a + rng.range(-0.6, 0.6),
            { rx: r(0.35), rz: r(0.35), sleep: false });
        }
      }
      // a few strays left standing by the walls (south half: the north wall is kept door-free for the pile)
      for (let k = 0; k < 3; k++) sp(level, 'chair_wood', b.x0 + 0.9 + k * ((b.x1 - b.x0 - 1.8) / 2) + r(0.2), 0, b.z1 - 0.7 - rng.next() * 0.3, rng.next() * 6.28);
      break;
    }
    case 'office_room': {
      sp(level, 'chair_office', b.cx + 0.2, 0, b.z0 + 1.4, Math.PI + r(0.5));
      sp(level, 'filing_cabinet', b.x0 + 0.4, 0, b.z1 - 0.5, Math.PI / 2);
      sp(level, 'desk_phone', b.cx + 0.45, 0.76, b.z0 + 0.6, r(0.4));
      sp(level, 'paper_stack', b.cx - 0.5, 0.76, b.z0 + 0.65, r(1));
      if (rng.chance(0.6)) sp(level, rng.pick(['almond_water', 'protein_bar', 'chips', 'bandage', 'battery']), b.cx + 0.5, 0.76, b.z0 + 0.88, 0);
      break;
    }
    case 'fuse_office': {
      sp(level, 'chair_office', b.cx + 0.2, 0, b.z0 + 1.4, Math.PI + r(0.5));
      sp(level, 'fuse', b.cx - 0.45, 0.76, b.z0 + 0.8, 0.4, { state: { mission: 1 } });
      sp(level, 'filing_cabinet', b.x1 - 0.4, 0, b.z1 - 0.5, -Math.PI / 2);
      break;
    }
    case 'fuel_store': {
      sp(level, 'fuel_can', b.cx, 0, b.cz, rng.next() * 6, { state: { fuel: 1 } });
      sp(level, 'barrel', b.x0 + 0.5, 0, b.z0 + 0.5, 0);
      sp(level, 'barrel', b.x0 + 0.5, 0, b.z0 + 1.2, 1);
      break;
    }
    case 'bedroom': {
      sp(level, 'bed', b.cx, 0, b.z0 + 1.1, 0);
      sp(level, 'lamp_floor', b.x0 + 0.4, 0, b.z0 + 0.4, 0);
      sp(level, 'armchair', b.x1 - 0.7, 0, b.z1 - 0.8, Math.PI * 0.75);
      // on the mattress (0.94 m wide, top at 0.52 m)
      if (rng.chance(0.7)) sp(level, rng.pick(['almond_milk', 'canned_food', 'painkillers', 'energy_drink']), b.cx + 0.15, 0.52, b.z0 + 1.45, rng.next() * 6);
      break;
    }
    case 'tv_room': {
      sp(level, 'couch', b.cx, 0, b.z1 - 0.8, Math.PI);
      sp(level, 'table_round', b.cx, 0, b.cz, 0);
      sp(level, 'mug', b.cx, 0.73, b.cz, 0);
      break;
    }
    case 'storage': {
      // stacks of boxes and crates along the back (north) wall: one stack per slot, heaviest at the bottom,
      // each box set on the one below (no overlap, so nothing jumps when the stack wakes)
      const width = b.x1 - b.x0;
      const nSlots = Math.floor((width - 0.6) / 0.85);
      for (let k = 0; k < nSlots; k++) {
        if (rng.chance(0.15)) continue;
        const x = b.x0 + 0.3 + 0.425 + k * ((width - 0.6 - 0.85) / Math.max(1, nSlots - 1)) + r(0.05);
        const z = b.z0 + 0.55 + r(0.05);
        let y = 0;
        const tall = 1 + rng.int(0, 2);
        for (let s2 = 0; s2 < tall; s2++) {
          const t = s2 === 0 ? rng.pick(['crate_wood', 'box_large', 'box_large']) : s2 === 1 ? rng.pick(['box_medium', 'box_large']) : rng.pick(['box_small', 'box_medium']);
          sp(level, t, x + r(0.03), y, z + r(0.03), r(0.12));
          y += modelHalfHeight(t) * 2 + 0.004;
        }
      }
      sp(level, 'pallet', b.cx, 0, b.z1 - 1.2, 0);
      // loot on the pallet's deck (0.146 m), inside its 1.2 x 0.8 footprint, spaced apart
      const nl = 3 + rng.int(0, 2);
      for (let k = 0; k < nl; k++) sp(level, rng.weighted(CRATE_LOOT), b.cx - 0.42 + (k / Math.max(1, nl - 1)) * 0.84, 0.146, b.z1 - 1.2 + r(0.2), rng.next() * 6);
      break;
    }
    case 'clipping': {
      // furniture half inside walls and floor (frozen, can't be moved)
      const p1 = sp(level, 'desk', b.x0 + 0.3, -0.25, b.cz, Math.PI / 2 + 0.2, { rz: 0.3 });
      const p2 = sp(level, 'chair_wood', b.cx, -0.35, b.cz + 0.4, 0.4, { rx: 0.5 });
      const p3 = sp(level, 'filing_cabinet', b.x1 - 0.1, 0, b.z0 + 0.8, 0.3);
      for (const p of [p1, p2, p3]) if (p) level.world.props.setFrozen(p, true);
      break;
    }
    case 'sinking': {
      // five pieces slowly going under, spread on a ring so they never sink through each other
      const a0 = rng.next() * 6.28;
      for (let k = 0; k < 5; k++) {
        const a = a0 + (k / 5) * Math.PI * 2 + r(0.2);
        const rr = k === 0 ? 0 : 1.6;
        const x = k === 0 ? b.cx : b.cx + Math.cos(a) * rr, z = k === 0 ? b.cz : b.cz + Math.sin(a) * rr;
        const p = sp(level, rng.pick(['chair_wood', 'chair_office', 'table_folding', 'box_medium']), x, -rng.range(0.1, 0.4), z, rng.next() * 6, { rx: r(0.2) });
        if (p) { level.world.props.setFrozen(p, true); p.sinking = { rate: rng.range(0.002, 0.008) }; }
      }
      break;
    }
    case 'manila_room': {
      sp(level, 'armchair', b.cx, 0, b.cz, rng.next() * 6);
      sp(level, 'almond_water', b.cx + 0.6, 0, b.cz + 0.5, 0);
      sp(level, 'almond_water', b.cx + 0.7, 0, b.cz + 0.3, 0);
      break;
    }
    case 'red_chair': break;
    case 'cubicle_farm': {
      for (let k = 0; k < 4; k++) {
        const x = b.x0 + 1.2 + (k % 2) * 4.2, z = b.z0 + 1.2 + Math.floor(k / 2) * 2.8;
        sp(level, 'desk_cubicle_panel', x, 0, z - 0.8, 0);
        sp(level, 'desk', x, 0, z, 0);
        sp(level, 'chair_office', x + r(0.3), 0, z + 0.8, rng.next() * 6);
        if (rng.chance(0.7)) sp(level, 'crt_monitor', x, 0.76, z - 0.1, 0);
        if (rng.chance(0.3)) sp(level, rng.pick(['desk_phone', 'mug', 'binder', 'keyboard']), x + 0.4, 0.76, z, rng.next() * 6);
      }
      // a snack left on the first desk (not floating mid-room)
      if (rng.chance(0.5)) sp(level, rng.pick(['chips', 'soda_can', 'candy_bar']), b.x0 + 1.2 - 0.45, 0.76, b.z0 + 1.2 + 0.15, rng.next() * 6);
      break;
    }
    case 'workshop': {
      for (const t of ['plank', 'plank', 'screws', 'metal_scrap', 'fabric_scrap', 'wire_spool']) sp(level, t, b.cx + r(1.2), 0, b.z0 + 1.4 + r(0.4), rng.next() * 6);
      // against the south wall between the two door slots (arches can open anywhere but the north wall)
      sp(level, 'toolbox', b.cx - 0.2, 0, b.z1 - 0.32, 0.1);
      // on the workbench top (0.92 m)
      sp(level, 'welder', b.cx + 0.4, 0.921, b.z0 + 0.5, 0, { state: { fuel: 1 } });
      sp(level, 'sample_jar', b.cx - 0.5, 0.921, b.z0 + 0.5, 0);
      break;
    }
    case 'vent_room': {
      for (let k = 0; k < 3; k++) sp(level, rng.pick(['bucket', 'pipe', 'barrel', 'cinder_block']), b.cx + r(1.2), 0, b.cz + r(0.8), rng.next() * 6);
      break;
    }
    case 'dead_clone': {
      sp(level, rng.pick(['flashlight', 'sample_jar', 'medkit', 'almond_water', 'battery']), b.cx - 0.4, 0, b.cz + 0.3, rng.next() * 6);
      sp(level, 'clipboard', b.cx + 0.6, 0, b.cz - 0.5, rng.next() * 6);
      break;
    }
    case 'poolrooms_glimpse': {
      sp(level, 'rubber_duck', b.cx + 0.5, 0.1, b.cz, 0, { sleep: false });
      break;
    }
    default: break;
  }
}
