// Special and mission rooms of the Poolrooms.
// decoratePoolRoom: static decor, extra colliders and devices (every peer, deterministic).
// populatePoolRoom: physics props (host only, once per run).
// Mission rooms keep the Yellow Rooms contents (same items in the same places) so the generator
// support items stay reachable exactly as in Level 0.
import * as THREE from 'three';
import { decorateRoom as yellowDecorate, populateRoom as yellowPopulate } from '../yellow/rooms.js';
import { CELL, CHUNK, poolFloorAt, poolPoint } from './layout.js';
import { buildModel, modelHalfHeight } from '../../../entities/catalog.js';
import { makeDevice } from '../../../game/devicekinds.js';
import { CRATE_LOOT } from '../../../game/itemdefs.js';
import { RNG, hash3 } from '../../../core/rng.js';
import { poolHalfHeight, isPoolProp } from './props.js';

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

const YELLOW_KINDS = new Set(['workshop', 'fuel_store', 'fuse_office', 'dead_clone', 'vending_lonely']);

export function decoratePoolRoom(level, room, rec) {
  rec._ventsDone = true; // our critter exits are registered by the level
  const b = roomBounds(room, rec);
  const rid = `${rec.cx},${rec.cz}:${room.kind}`;
  if (YELLOW_KINDS.has(room.kind)) { yellowDecorate(level, room, rec); return; }
  switch (room.kind) {
    case 'lifeguard_office': yellowDecorate(level, { ...room, kind: 'office_room' }, rec); break;
    case 'locker_room': {
      // rows of abandoned lockers (static set pieces; a few doors left hanging open)
      const n = room.w * 2;
      const rng = new RNG(hash3(rec.cx, rec.cz, 77, level.seed));
      for (let k = 0; k < n; k++) {
        const x = b.x0 + 0.9 + k * 1.45;
        if (x > b.x1 - 0.7) break;
        const { m } = placeStatic(level, rec, 'locker_bank', x, 0, b.z0 + 0.32, 0, { collide: true, useHalf: false, modelOpts: { count: 3 } });
        for (const d of m.parts?.doors || []) if (rng.chance(0.3)) d.rotation.y = -rng.range(0.4, 1.6);
      }
      break;
    }
    case 'drowned_room': {
      // an office that sank into the pool: desks, chairs and a cabinet on the flooded floor
      const p = rec.layout.pools.find((pp) => pp.room && pp.rx === room.rx && pp.rz === room.rz);
      if (!p) break;
      const ox = rec.cx * CHUNK * CELL, oz = rec.cz * CHUNK * CELL;
      const items = [['desk', p.run + 1.2, 0.35, 0.3], ['chair_office', p.run + 1.9, 0.42, 2.6], ['desk', p.run + 1.1, 0.75, Math.PI + 0.15], ['filing_cabinet', p.L - 0.45, 0.85, -Math.PI / 2], ['chair_office', p.run + 0.7, 0.8, 1.2], ['crt_monitor', p.run + 1.25, 0.33, 0.4]];
      const tint = new THREE.Color(0.58, 0.82, 0.86);
      for (const [type, s, t, rot] of items) {
        const [x, z] = poolPoint(p, ox, oz, s, t);
        let y = poolFloorAt(p, s, t);
        if (type === 'crt_monitor') y += 0.76;
        const { o } = placeStatic(level, rec, type, x, y, z, rot, { collide: type !== 'crt_monitor', rx: type === 'chair_office' && s > p.run + 1.5 ? 0.25 : 0 });
        o.traverse((m) => {
          if (!m.isMesh) return;
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          const nm = mats.map((mt) => { const c = mt.clone(); if (c.color) c.color.multiply(tint); return c; });
          m.material = Array.isArray(m.material) ? nm : nm[0];
        });
      }
      break;
    }
    case 'pump_room': {
      const { o, m } = placeStatic(level, rec, 'pipe_cluster', b.x1 - 0.15, 0, b.cz, -Math.PI / 2, { useHalf: false });
      if (level.critters && m.anchors?.mouth) {
        o.updateWorldMatrix(true, false);
        const mouth = m.anchors.mouth.clone().applyMatrix4(o.matrixWorld);
        const inside = (m.anchors.inside || m.anchors.mouth).clone().applyMatrix4(o.matrixWorld);
        level.critters.addVent(mouth.setY(0.15), o, inside);
      }
      break;
    }
    default: break;
  }
}

function sp(level, type, x, y, z, rotY = 0, opts = {}) {
  const hh = isPoolProp(type) ? poolHalfHeight(type) : modelHalfHeight(type);
  _q.setFromEuler(_e.set(opts.rx || 0, rotY, opts.rz || 0));
  return level.world.props.spawn(type, new THREE.Vector3(x, y + hh + 0.01, z), _q, { sleep: opts.sleep !== false, state: opts.state, modelOpts: opts.mo });
}

export function populatePoolRoom(level, room, rec, rng) {
  const b = roomBounds(room, rec);
  const r = (a) => rng.range(-a, a);
  if (YELLOW_KINDS.has(room.kind)) { yellowPopulate(level, room, rec, rng); return; }
  switch (room.kind) {
    case 'lifeguard_office': {
      yellowPopulate(level, { ...room, kind: 'office_room' }, rec, rng);
      sp(level, rng.pick(['medkit', 'bandage', 'almond_water']), b.cx + 0.3, 0.78, b.z0 + 0.7, r(1));
      break;
    }
    case 'storage': {
      for (let k = 0; k < 6; k++) sp(level, rng.pick(['kickboard', 'kickboard', 'pool_noodle', 'pool_ring', 'float_mat']), b.x0 + 0.7 + rng.next() * (b.x1 - b.x0 - 1.4), (k % 3) * 0.06, b.z0 + 0.7 + rng.next() * (b.z1 - b.z0 - 1.4), rng.next() * 6, { mo: { variant: k } });
      for (let k = 0; k < 2; k++) sp(level, 'pool_lounger', b.x0 + 1.2, k * 0.24, b.z1 - 0.8, Math.PI / 2 + r(0.05), { mo: { variant: k } });
      for (let k = 0; k < 3 + rng.int(0, 2); k++) sp(level, rng.weighted(CRATE_LOOT), b.cx + r(1.2), 0.1, b.cz + r(1.2), rng.next() * 6);
      break;
    }
    case 'locker_room': {
      for (let k = 0; k < 3; k++) sp(level, 'towel', b.cx + r(1.5), 0, b.z1 - 0.8 + r(0.3), rng.next() * 6, { mo: { variant: k } });
      if (rng.chance(0.8)) sp(level, rng.pick(['almond_water', 'bandage', 'energy_drink', 'battery', 'flashlight']), b.cx + r(1), 0, b.cz + r(0.5), rng.next() * 6);
      break;
    }
    case 'shower_room': {
      sp(level, 'towel', b.cx + r(0.8), 0, b.cz + r(0.5), rng.next() * 6, { mo: { variant: rng.int(0, 3) } });
      if (rng.chance(0.6)) sp(level, rng.pick(['almond_water', 'sample_jar', 'painkillers']), b.cx + r(1), 0, b.cz, 0);
      break;
    }
    case 'pump_room': {
      for (let k = 0; k < 3; k++) sp(level, rng.pick(['barrel', 'bucket', 'pipe', 'toolbox']), b.cx + r(1.2), 0, b.cz + r(0.6), rng.next() * 6);
      break;
    }
    case 'sinking':
    case 'clipping':
      yellowPopulate(level, room, rec, rng);
      break;
    case 'yellow_bleed': {
      sp(level, 'chair_wood', b.cx + r(0.6), 0, b.cz + r(0.6), rng.next() * 6);
      sp(level, 'almond_water', b.cx + 0.6, 0, b.cz + 0.4, 0);
      break;
    }
    default: break;
  }
  void RNG; void hash3;
}
