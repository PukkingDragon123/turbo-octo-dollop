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

// ---------------------------------------------------------------------------
export function decorateRoom(level, room, rec) {
  const b = roomBounds(room, rec);
  const rid = `${rec.cx},${rec.cz}:${room.kind}`;
  const rng = new RNG(hash3(rec.cx, rec.cz, 4242, level.seed));
  switch (room.kind) {
    case 'spawn': {
      // hole in the ceiling where the clones fall through
      const hole = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshBasicMaterial({ color: 0x000000 }));
      hole.rotation.x = Math.PI / 2;
      hole.position.set(b.cx, HEIGHT - 0.004, b.cz);
      rec.group.add(hole);
      // dangling broken tiles
      for (let k = 0; k < 6; k++) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 0.3), Mat.get('ceiling'));
        const a = (k / 6) * Math.PI * 2;
        t.position.set(b.cx + Math.cos(a) * 1.22, HEIGHT - 0.1, b.cz + Math.sin(a) * 1.22);
        t.rotation.set(Math.cos(a) * 0.45, a, Math.sin(a) * 0.45);
        rec.group.add(t);
        level.prepStatic(t, rec);
      }
      break;
    }
    case 'workshop': {
      addDevice(level, rec, 'workbench', `wb:${rid}`, new THREE.Vector3(b.cx, 0, b.z0 + 0.55), 0);
      placeStatic(level, rec, 'pipe_cluster', b.x1 - 0.15, 0, b.cz, -Math.PI / 2, { useHalf: false });
      break;
    }
    case 'vending_lonely': {
      addDevice(level, rec, 'vending_snack', `vend:${rid}`, new THREE.Vector3(b.cx, 0, b.z0 + 0.6), 0, { backrooms: true });
      break;
    }
    case 'office_room':
    case 'fuse_office': {
      addDevice(level, rec, 'lore_terminal', `term:${rid}`, new THREE.Vector3(b.cx, 0.76, b.z0 + 0.55), 0, { lore: rng.int(0, 99) });
      placeStatic(level, rec, 'desk', b.cx, 0, b.z0 + 0.65, Math.PI, { collide: true });
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
      const steps = 12;
      const g = new THREE.Group();
      const mat = Mat.get('wood_dark');
      for (let s = 0; s < steps; s++) {
        const h = (s + 1) * (HEIGHT / steps);
        const d = 0.32;
        const step = new THREE.Mesh(new THREE.BoxGeometry(1.2, h, d), mat);
        const z = b.z0 + 0.3 + s * d + d / 2;
        step.position.set(b.cx, h / 2, z);
        step.castShadow = true;
        step.receiveShadow = true;
        g.add(step);
        const c = level.world.physics.addStaticBox(b.cx, h / 2, z, 0.6, h / 2, d / 2, { kind: 'static', surface: 'wood' });
        rec.physicsColliders.push(c);
      }
      rec.group.add(g);
      level.prepStatic(g, rec);
      break;
    }
    case 'many_doors': {
      // a wall of identical doors that lead nowhere
      for (let k = 0; k < room.w * 2; k++) {
        const x = b.x0 + 0.75 + k * 1.5;
        const door = new THREE.Group();
        const frame = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.1, 0.05), Mat.get('wood'));
        frame.position.y = 1.05;
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), Mat.get('brass'));
        knob.position.set(0.38, 1.0, 0.04);
        door.add(frame, knob);
        door.position.set(x, 0, b.z0 + 0.11);
        rec.group.add(door);
        level.prepStatic(door, rec);
      }
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
      placeStatic(level, rec, 'pipe_cluster', b.x1 - 0.15, 0, b.cz, -Math.PI / 2, { useHalf: false });
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
      level.critters?.addVent(pos.clone().setY(0.15), o);
    }
  }
}

// ---------------------------------------------------------------------------
function sp(level, type, x, y, z, rotY = 0, opts = {}) {
  const hh = modelHalfHeight(type);
  _q.setFromEuler(_e.set(opts.rx || 0, rotY, opts.rz || 0));
  return level.world.props.spawn(type, new THREE.Vector3(x, y + hh + 0.01, z), _q, { sleep: opts.sleep !== false, state: opts.state });
}

export function populateRoom(level, room, rec, rng) {
  const b = roomBounds(room, rec);
  const r = (a) => rng.range(-a, a);
  switch (room.kind) {
    case 'chairpile': {
      // the iconic chaotic pile of stacked chairs
      const n = 18 + rng.int(0, 10);
      for (let k = 0; k < n; k++) {
        const layer = Math.floor(k / 6);
        sp(level, 'chair_wood', b.cx + r(1.2), layer * 0.75 + 0.05, b.cz + r(1.2), rng.next() * 6.28, { rx: r(0.5), rz: r(0.5), sleep: false });
      }
      for (let k = 0; k < 4; k++) sp(level, 'chair_wood', b.x0 + 0.7 + rng.next() * (b.x1 - b.x0 - 1.4), 0, b.z0 + 0.7 + rng.next() * 1.5, rng.next() * 6.28);
      break;
    }
    case 'office_room': {
      sp(level, 'chair_office', b.cx + 0.2, 0, b.z0 + 1.4, Math.PI + r(0.5));
      sp(level, 'filing_cabinet', b.x0 + 0.4, 0, b.z1 - 0.5, Math.PI / 2);
      sp(level, 'desk_phone', b.cx + 0.45, 0.76, b.z0 + 0.6, r(0.4));
      sp(level, 'paper_stack', b.cx - 0.5, 0.76, b.z0 + 0.65, r(1));
      if (rng.chance(0.6)) sp(level, rng.pick(['almond_water', 'protein_bar', 'chips', 'bandage', 'battery']), b.cx - 0.2, 0.78, b.z0 + 0.75, 0);
      break;
    }
    case 'fuse_office': {
      sp(level, 'chair_office', b.cx + 0.2, 0, b.z0 + 1.4, Math.PI + r(0.5));
      sp(level, 'fuse', b.cx - 0.3, 0.78, b.z0 + 0.6, 0.4, { state: { mission: 1 } });
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
      if (rng.chance(0.7)) sp(level, rng.pick(['almond_milk', 'canned_food', 'painkillers', 'energy_drink']), b.cx + 0.5, 0.6, b.z0 + 1.1, 0);
      break;
    }
    case 'tv_room': {
      sp(level, 'couch', b.cx, 0, b.z1 - 0.8, Math.PI);
      sp(level, 'table_round', b.cx, 0, b.cz, 0);
      sp(level, 'mug', b.cx, 0.72, b.cz, 0);
      break;
    }
    case 'storage': {
      for (let k = 0; k < 10; k++) {
        const t = rng.pick(['box_small', 'box_medium', 'box_large', 'crate_wood', 'box_medium']);
        sp(level, t, b.x0 + 0.6 + rng.next() * (b.x1 - b.x0 - 1.2), (k % 3) * 0.5, b.z0 + 0.6 + rng.next() * 1.0, rng.next() * 0.4, { sleep: false });
      }
      sp(level, 'pallet', b.cx, 0, b.z1 - 1.2, 0);
      for (let k = 0; k < 3 + rng.int(0, 2); k++) sp(level, rng.weighted(CRATE_LOOT), b.cx + r(1.5), 0.2, b.z1 - 1.2 + r(0.4), rng.next() * 6);
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
      for (let k = 0; k < 5; k++) {
        const p = sp(level, rng.pick(['chair_wood', 'chair_office', 'table_folding', 'box_medium']), b.cx + r(1.1), -rng.range(0.1, 0.5), b.cz + r(1.1), rng.next() * 6, { rx: r(0.3) });
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
        sp(level, 'desk', x, 0, z, Math.PI);
        sp(level, 'chair_office', x + r(0.3), 0, z + 0.8, rng.next() * 6);
        if (rng.chance(0.7)) sp(level, 'crt_monitor', x, 0.76, z - 0.1, Math.PI);
        if (rng.chance(0.3)) sp(level, rng.pick(['desk_phone', 'mug', 'binder', 'keyboard']), x + 0.4, 0.76, z, rng.next() * 6);
      }
      if (rng.chance(0.5)) sp(level, rng.pick(['chips', 'soda_can', 'candy_bar']), b.cx, 0.78, b.cz, 0);
      break;
    }
    case 'workshop': {
      for (const t of ['plank', 'plank', 'screws', 'metal_scrap', 'fabric_scrap', 'wire_spool']) sp(level, t, b.cx + r(1.2), 0, b.z0 + 1.4 + r(0.4), rng.next() * 6);
      sp(level, 'toolbox', b.x0 + 0.6, 0, b.z1 - 0.6, 0.3);
      sp(level, 'welder', b.cx + 0.4, 0.95, b.z0 + 0.5, 0, { state: { fuel: 1 } });
      sp(level, 'sample_jar', b.cx - 0.5, 0.95, b.z0 + 0.5, 0);
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
