// Shared helpers for Level 0 special rooms (rooms.js, weird.js): merged static geometry baked with the chunk's
// grid light field, static furniture (optionally scaled / with colliders), instanced static furniture, static
// collider bodies and prop spawning (with or without the placement checker).
import * as THREE from 'three';
import { CELL, CHUNK } from './layout.js';
import { buildModel, modelHalfHeight } from '../../../entities/catalog.js';
import { bakedMaterial } from '../../../gfx/bakedlight.js';
import { GridBaker } from '../../env/gridbake.js';
import { DEFS, getTemplate } from '../../../entities/furniture/core.js';
import { matFor } from '../../../entities/furniture/mats.js';

// merged static room geometry, lit by the chunk's grid light field like the rest of the level
export function bakeInto(level, rec, g, mat, o = {}) {
  if (g.isEmpty()) return null;
  const geo = g.build();
  const baker = rec._roomBaker || (rec._roomBaker = new GridBaker(level.seed, level.variantFn, rec.cx, rec.cz));
  const mix = o.mix || [1, 0.3];
  baker.bake(geo, { direct: mix[0], bounce: mix[1], quant: o.quant ?? 0.15 });
  const m = new THREE.Mesh(geo, bakedMaterial(mat, level.field, o.grime ?? 0, { grid: 1, mix, emissiveLights: o.emissive, lens: o.lens }));
  m.receiveShadow = true;
  m.castShadow = !!o.cast;
  m.matrixAutoUpdate = false;
  rec.group.add(m);
  return m;
}

export function roomBounds(room, rec) {
  const x0 = (rec.cx * CHUNK + room.rx) * CELL, z0 = (rec.cz * CHUNK + room.rz) * CELL;
  return { x0, z0, x1: x0 + room.w * CELL, z1: z0 + room.h * CELL, cx: x0 + (room.w * CELL) / 2, cz: z0 + (room.h * CELL) / 2, w: room.w * CELL, d: room.h * CELL };
}

// colliders of a model scaled uniformly
export function scaleColliders(desc, s) {
  return desc.map((c) => {
    const o = { ...c, pos: c.pos ? c.pos.map((v) => v * s) : [0, 0, 0] };
    if (c.size) o.size = c.size.map((v) => v * s);
    if (c.radius !== undefined) o.radius = c.radius * s;
    if (c.height !== undefined) o.height = c.height * s;
    if (c.halfHeight !== undefined) o.halfHeight = c.halfHeight * s;
    return o;
  });
}

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
export function placeStatic(level, rec, type, x, y, z, rotY = 0, opts = {}) {
  const m = buildModel(type, { seed: (x * 13 + z * 7) | 0, ...(opts.modelOpts || {}) });
  const o = m.object;
  const sc = opts.scale ?? 1;
  o.position.set(x, y + (opts.useHalf === false ? 0 : (m.halfHeight ?? 0) * sc), z);
  o.rotation.set(opts.rx || 0, rotY, opts.rz || 0);
  if (sc !== 1) o.scale.setScalar(sc);
  rec.group.add(o);
  level.prepStatic(o, rec);
  if (opts.collide && m.colliders?.length) {
    o.updateMatrixWorld(true);
    o.matrixWorld.decompose(_p, _q, _s);
    const res = level.world.physics.addStaticCollidersFromDesc(sc !== 1 ? scaleColliders(m.colliders, sc) : m.colliders, _p, _q, { kind: 'static', surface: 'prop' });
    rec.physicsColliders.push(...res.colliders);
    (rec.extraBodies = rec.extraBodies || []).push(res.body);
  }
  return { o, m };
}

// one fixed body holding world-space collider descriptors
export function staticBody(level, rec, cols, surface = 'world') {
  if (!cols.length) return;
  const res = level.world.physics.addStaticCollidersFromDesc(cols, _p.set(0, 0, 0), _q.identity(), { kind: 'static', surface });
  rec.physicsColliders.push(...res.colliders);
  (rec.extraBodies = rec.extraBodies || []).push(res.body);
}

// Static furniture as instanced meshes (one draw call per material slot of the model for all copies), probe-lit
// as one object from `probeAt`. matrices: THREE.Matrix4[] placing the model's ORIGIN (bbox centre).
export function instancedFurniture(level, rec, name, matrices, probeAt, variant = 0) {
  const spec = DEFS[name];
  if (!spec || !matrices.length) return null;
  const t = getTemplate(name, variant);
  const ov = spec.mats ? spec.mats({}, variant) : null;
  const root = new THREE.Group();
  root.name = `inst:${name}`;
  const addPack = (pk, off) => {
    for (const m of [...pk.meshes, ...pk.named]) {
      const im = new THREE.InstancedMesh(m.geo, matFor(m.slot, ov), matrices.length);
      const local = off ? new THREE.Matrix4().makeTranslation(off.x, off.y, off.z) : null;
      matrices.forEach((M, i) => im.setMatrixAt(i, local ? M.clone().multiply(local) : M));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = m.cast; im.receiveShadow = true;
      im.computeBoundingSphere();
      im.userData.sharedGeo = true;
      root.add(im);
    }
  };
  addPack(t.main, null);
  for (const p of t.parts) addPack(p, p.pos);
  // the probe samples the light at the group's position; the instances carry their own world matrices
  root.position.copy(probeAt);
  root.updateMatrix();
  for (const c of root.children) { c.position.copy(probeAt).negate(); c.updateMatrix(); }
  rec.group.add(root);
  level.prepStatic(root, rec);
  return root;
}

// host prop spawn resting on (y) with yaw rotY; opts: { rx, rz, sleep, state }
const _e = new THREE.Euler();
export function sp(level, type, x, y, z, rotY = 0, opts = {}) {
  const hh = modelHalfHeight(type);
  _q.setFromEuler(_e.set(opts.rx || 0, rotY, opts.rz || 0));
  // resting props start on their support (they settle briefly, then sleep); piles get a little air
  const lift = opts.sleep === false ? 0.012 : 0.001;
  return level.world.props.spawn(type, new THREE.Vector3(x, y + hh + lift, z), _q.clone(), { sleep: opts.sleep !== false, state: opts.state });
}

// prop spawn through the placement checker (keeps clear of walls, doorways, pillars and what is already placed);
// returns the prop or null when no clear spot was found
export function spPlaced(level, placer, type, x, z, rotY = 0, opts = {}) {
  const got = placer.place(type, x, z, rotY, opts.ax ?? x, opts.az ?? z, opts.gap ?? 0.04);
  if (!got) return null;
  return sp(level, type, got.x, opts.y || 0, got.z, got.rotY, opts);
}
