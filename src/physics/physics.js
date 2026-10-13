// Rapier physics wrapper: world, fixed-step integration, collision groups, queries,
// and helpers to build bodies from the simple collider descriptions used by model builders.
import RAPIER_NS from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export let RAPIER = null;
export async function initPhysics() {
  if (RAPIER) return RAPIER;
  await RAPIER_NS.init();
  RAPIER = RAPIER_NS;
  return RAPIER;
}

// Collision group bits
export const G = {
  STATIC: 1 << 0,
  PROP: 1 << 1,
  PLAYER: 1 << 2,
  MONSTER: 1 << 3,
  DEBRIS: 1 << 4,
  TRIGGER: 1 << 5,
  REMOTE: 1 << 6,
  CRITTER: 1 << 7,
  RAGDOLL: 1 << 8,
};
export const ALL = 0xffff;
export function groups(member, filter) {
  return ((member & 0xffff) << 16) | (filter & 0xffff);
}
export const GROUPS = {
  static: groups(G.STATIC, ALL),
  prop: groups(G.PROP, G.STATIC | G.PROP | G.PLAYER | G.MONSTER | G.REMOTE | G.DEBRIS | G.RAGDOLL),
  propHeld: groups(G.PROP, G.STATIC | G.PROP | G.MONSTER | G.DEBRIS | G.RAGDOLL), // held props don't shove their holder
  debris: groups(G.DEBRIS, G.STATIC | G.PROP),
  player: groups(G.PLAYER, G.STATIC | G.PROP | G.MONSTER | G.REMOTE),
  remote: groups(G.REMOTE, G.PROP | G.PLAYER | G.RAGDOLL),
  monster: groups(G.MONSTER, G.STATIC | G.PROP | G.PLAYER),
  ragdoll: groups(G.RAGDOLL, G.STATIC | G.PROP | G.RAGDOLL | G.REMOTE),
  critter: groups(G.CRITTER, G.STATIC),
};
// Query filters
export const Q = {
  world: groups(ALL, G.STATIC),
  solid: groups(ALL, G.STATIC | G.PROP),
  grab: groups(ALL, G.STATIC | G.PROP | G.REMOTE | G.RAGDOLL),
  sight: groups(ALL, G.STATIC),
  all: groups(ALL, ALL & ~G.TRIGGER),
};

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export class Physics {
  constructor(gravity = -11.5) {
    this.world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
    this.world.integrationParameters.numSolverIterations = 6;
    this.events = new RAPIER.EventQueue(true);
    this.fixedDt = 1 / 60;
    this.acc = 0;
    this.userData = new Map(); // collider handle -> userData object
    this.onContactForce = null; // (ud1, ud2, magnitude, c1, c2)
    this.onCollision = null;    // (ud1, ud2, started, c1, c2)
    this.beforeStep = [];       // fns(dt) called before each fixed step
    this.world.timestep = this.fixedDt;
  }

  setUserData(collider, ud) { this.userData.set(collider.handle, ud); }
  getUserData(collider) { return collider ? this.userData.get(collider.handle) : null; }

  // --- Static geometry ---
  addStaticBox(cx, cy, cz, hx, hy, hz, ud = null, rotY = 0, friction = 0.8) {
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(cx, cy, cz)
      .setCollisionGroups(GROUPS.static)
      .setFriction(friction);
    if (rotY) {
      _q.setFromEuler(_e.set(0, rotY, 0));
      desc.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
    }
    const c = this.world.createCollider(desc);
    if (ud) this.setUserData(c, ud);
    return c;
  }

  addStaticCollidersFromDesc(colliders, position, quaternion, ud = null) {
    // colliders in a model's local space, placed at world transform
    const out = [];
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(position.x, position.y, position.z)
        .setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w }),
    );
    for (const c of colliders) {
      const d = colliderDesc(c);
      if (!d) continue;
      d.setCollisionGroups(GROUPS.static).setFriction(0.8);
      const col = this.world.createCollider(d, body);
      if (ud) this.setUserData(col, ud);
      out.push(col);
    }
    return { body, colliders: out };
  }

  removeCollider(c) {
    if (!c) return;
    this.userData.delete(c.handle);
    try { this.world.removeCollider(c, true); } catch (e) { /* already gone */ }
  }

  removeBody(body) {
    if (!body) return;
    const n = body.numColliders();
    for (let i = 0; i < n; i++) this.userData.delete(body.collider(i).handle);
    try { this.world.removeRigidBody(body); } catch (e) { /* already gone */ }
  }

  // --- Dynamic bodies from model collider descriptions ---
  createDynamic(colliders, mass, position, quaternion, ud, opts = {}) {
    const bd = (opts.kinematic ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.dynamic())
      .setTranslation(position.x, position.y, position.z)
      .setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w })
      .setLinearDamping(opts.linearDamping ?? 0.15)
      .setAngularDamping(opts.angularDamping ?? 0.35)
      .setCcdEnabled(!!opts.ccd);
    if (opts.linvel) bd.setLinvel(opts.linvel.x, opts.linvel.y, opts.linvel.z);
    if (opts.angvel) bd.setAngvel(opts.angvel);
    const body = this.world.createRigidBody(bd);
    // distribute mass by collider volume
    let totalVol = 0;
    const vols = colliders.map((c) => {
      const v = colliderVolume(c);
      totalVol += v;
      return v;
    });
    colliders.forEach((c, i) => {
      const d = colliderDesc(c);
      if (!d) return;
      const m = mass * (vols[i] / (totalVol || 1));
      d.setMass(Math.max(0.01, m))
        .setFriction(opts.friction ?? 0.65)
        .setRestitution(opts.restitution ?? 0.12)
        .setCollisionGroups(opts.groups ?? GROUPS.prop)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(Math.max(5, mass * 12));
      const col = this.world.createCollider(d, body);
      this.setUserData(col, ud);
    });
    return body;
  }

  setBodyGroups(body, grp) {
    const n = body.numColliders();
    for (let i = 0; i < n; i++) body.collider(i).setCollisionGroups(grp);
  }

  // --- Step ---
  step(dt) {
    this.acc += Math.min(dt, 0.1);
    let steps = 0;
    while (this.acc >= this.fixedDt && steps < 4) {
      for (const f of this.beforeStep) f(this.fixedDt);
      this.world.step(this.events);
      this.drainEvents();
      this.acc -= this.fixedDt;
      steps++;
    }
    if (steps >= 4) this.acc = 0;
    return steps;
  }

  drainEvents() {
    if (this.onContactForce) {
      this.events.drainContactForceEvents((e) => {
        const c1 = this.world.getCollider(e.collider1());
        const c2 = this.world.getCollider(e.collider2());
        this.onContactForce(this.getUserData(c1), this.getUserData(c2), e.maxForceMagnitude(), c1, c2, e.totalForceMagnitude());
      });
    } else {
      this.events.drainContactForceEvents(() => {});
    }
    this.events.drainCollisionEvents((h1, h2, started) => {
      if (!this.onCollision) return;
      const c1 = this.world.getCollider(h1);
      const c2 = this.world.getCollider(h2);
      this.onCollision(this.getUserData(c1), this.getUserData(c2), started, c1, c2);
    });
  }

  // --- Queries ---
  raycast(origin, dir, maxDist, filterGroups = Q.all, excludeBody = null, predicate = null) {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, undefined, filterGroups, undefined, excludeBody ?? undefined, predicate ?? undefined);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return {
      dist: t,
      point: new THREE.Vector3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      collider: hit.collider,
      ud: this.getUserData(hit.collider),
    };
  }

  // true if a static-geometry ray between a and b is clear
  lineOfSight(a, b, filter = Q.sight) {
    _v.subVectors(b, a);
    const d = _v.length();
    if (d < 1e-4) return true;
    _v.multiplyScalar(1 / d);
    const ray = new RAPIER.Ray(a, _v);
    const hit = this.world.castRay(ray, d, true, undefined, filter);
    return !hit;
  }

  overlapSphere(center, radius, filterGroups = Q.all, cb) {
    const shape = new RAPIER.Ball(radius);
    this.world.intersectionsWithShape(center, { x: 0, y: 0, z: 0, w: 1 }, shape, (c) => {
      cb(c, this.getUserData(c));
      return true;
    }, undefined, filterGroups);
  }

  overlapBox(center, half, filterGroups = Q.all, cb, rot = { x: 0, y: 0, z: 0, w: 1 }) {
    const shape = new RAPIER.Cuboid(half.x, half.y, half.z);
    this.world.intersectionsWithShape(center, rot, shape, (c) => {
      cb(c, this.getUserData(c));
      return true;
    }, undefined, filterGroups);
  }

  dispose() {
    try { this.world.free(); } catch (e) { /* ignore */ }
    try { this.events.free(); } catch (e) { /* ignore */ }
    this.userData.clear();
  }
}

export function colliderDesc(c) {
  let d = null;
  if (c.type === 'box') d = RAPIER.ColliderDesc.cuboid(Math.max(0.005, c.size[0] / 2), Math.max(0.005, c.size[1] / 2), Math.max(0.005, c.size[2] / 2));
  else if (c.type === 'cylinder') d = RAPIER.ColliderDesc.cylinder(Math.max(0.005, c.height / 2), Math.max(0.005, c.radius));
  else if (c.type === 'ball') d = RAPIER.ColliderDesc.ball(Math.max(0.005, c.radius));
  else if (c.type === 'capsule') d = RAPIER.ColliderDesc.capsule(Math.max(0.005, c.halfHeight), Math.max(0.005, c.radius));
  if (!d) return null;
  if (c.pos) d.setTranslation(c.pos[0], c.pos[1], c.pos[2]);
  if (c.rot) {
    _q.setFromEuler(_e.set(c.rot[0] || 0, c.rot[1] || 0, c.rot[2] || 0));
    d.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
  }
  return d;
}

export function colliderVolume(c) {
  if (c.type === 'box') return c.size[0] * c.size[1] * c.size[2];
  if (c.type === 'cylinder') return Math.PI * c.radius * c.radius * c.height;
  if (c.type === 'ball') return (4 / 3) * Math.PI * c.radius ** 3;
  if (c.type === 'capsule') return Math.PI * c.radius * c.radius * (c.halfHeight * 2 + (4 / 3) * c.radius);
  return 0.001;
}

// Bounding radius of a collider set (for culling / spawn spacing)
export function collidersBounds(colliders) {
  const box = new THREE.Box3();
  for (const c of colliders) {
    const p = new THREE.Vector3(...(c.pos || [0, 0, 0]));
    let h;
    if (c.type === 'box') h = new THREE.Vector3(c.size[0] / 2, c.size[1] / 2, c.size[2] / 2);
    else if (c.type === 'cylinder') h = new THREE.Vector3(c.radius, c.height / 2, c.radius);
    else if (c.type === 'ball') h = new THREE.Vector3(c.radius, c.radius, c.radius);
    else h = new THREE.Vector3(c.radius, c.halfHeight + c.radius, c.radius);
    if (c.rot) {
      const m = Math.max(h.x, h.y, h.z);
      h.set(m, m, m);
    }
    box.expandByPoint(p.clone().sub(h));
    box.expandByPoint(p.clone().add(h));
  }
  return box;
}
