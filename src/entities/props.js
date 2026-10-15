// Networked physics props. The host simulates dynamic Rapier bodies; clients mirror them as
// kinematic bodies driven by interpolated snapshots (so local characters still collide).
import * as THREE from 'three';
import { net } from '../net/net.js';
import { buildModel } from './catalog.js';
import { itemDef } from '../game/itemdefs.js';
import { RAPIER, GROUPS, colliderDesc, collidersBounds } from '../physics/physics.js';

const SNAP_FLOATS = 8;
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

export class Prop {
  constructor(mgr, id, type, model, state) {
    this.mgr = mgr;
    this.id = id;
    this.type = type;
    this.def = itemDef(type);
    this.model = model;
    this.state = state || {};
    this.root = new THREE.Group();
    this.root.name = `prop:${type}:${id}`;
    this.root.add(model.object);
    this.root.userData.prop = this;
    this.mass = model.mass ?? 5;
    this.material = model.material || 'plastic';
    this.body = null;
    this.buffer = []; // client interpolation [{t, p, q}]
    this.lastImpact = 0;
    this.speed = 0;       // host: linear speed at the last visual sync (pre-step speed during contact events)
    this.spawnT = mgr.world.time ?? 0;
    this.hp = this.def.hp ?? 100;
    this.grabbers = new Map(); // host: playerId -> grab info
    this.bounds = collidersBounds(model.colliders || []);
    this.radius = this.bounds.getSize(_v).length() * 0.5;
    this.frozen = false; // kinematic override (sinking, welded-to-world animation, etc.)
    this.settleT = 0;    // host: seconds left before a spawned-'asleep' prop is put to sleep (see _create)
    this.custom = null;  // per-type behaviour object (devices)
    this.dead = false;
  }

  get position() { return this.root.position; }
  get quaternion() { return this.root.quaternion; }

  isHeld() { return this.grabbers.size > 0; }
}

export class PropManager {
  constructor(world) {
    this.world = world;
    this.physics = world.physics;
    this.props = new Map();
    this.nextId = 1;
    this.snapTimer = 0;
    this.snapRate = 1 / 20;
    this.interpDelay = 0.11;
    this.time = 0;
    this.behaviours = new Map(); // type -> factory(prop, world) returning behaviour {update(dt), onState(), dispose()}
    this.onSpawned = [];
    this.onRemoved = [];
    this.awakeList = [];
    this.forceSendIds = new Set();
  }

  registerBehaviour(type, factory) { this.behaviours.set(type, factory); }

  // ---------------- host API ----------------
  spawn(type, pos, quat, opts = {}) {
    if (!net.isHost) return null;
    const id = opts.id ?? this.nextId++;
    if (id >= this.nextId) this.nextId = id + 1;
    const msg = {
      id, type,
      p: [pos.x, pos.y, pos.z],
      q: quat ? [quat.x, quat.y, quat.z, quat.w] : [0, 0, 0, 1],
      s: opts.state || {},
      mo: opts.modelOpts || null,
      v: opts.vel ? [opts.vel.x, opts.vel.y, opts.vel.z] : null,
      av: opts.angvel ? [opts.angvel.x, opts.angvel.y, opts.angvel.z] : null,
      fz: opts.frozen ? 1 : 0,
      sl: opts.sleep ? 1 : 0,
    };
    net.toRemotes('pspawn', msg);
    return this._create(msg);
  }

  despawn(id, fx = null) {
    if (!net.isHost) return;
    if (!this.props.has(id)) return;
    net.toAll('pdespawn', { id, fx });
  }

  setState(id, partial) {
    const p = this.props.get(id);
    if (!p || !net.isHost) return;
    net.toAll('pstate', { id, s: partial });
  }

  // Full spawn list for late joiners
  serializeAll() {
    const out = [];
    for (const p of this.props.values()) {
      if (p.dead) continue;
      out.push({
        id: p.id, type: p.type,
        p: p.root.position.toArray(), q: p.root.quaternion.toArray(),
        s: p.state, mo: p.modelOpts || null, fz: p.frozen ? 1 : 0, sl: 1,
      });
    }
    return out;
  }

  // ---------------- shared ----------------
  bindNet() {
    net.onClient('pspawn', (m) => { if (!net.isHost) this._create(m); });
    net.onClient('pspawnMany', (list) => { if (!net.isHost) for (const m of list) this._create(m); });
    net.onClient('pdespawn', (m) => this._remove(m.id, m.fx));
    net.onClient('pstate', (m) => {
      const p = this.props.get(m.id);
      if (!p) return;
      Object.assign(p.state, m.s);
      p.custom?.onState?.(m.s);
      this.world.itemfx?.apply(p);
    });
    net.onClient('psnap', (buf) => { if (!net.isHost) this._applySnapshot(buf); });
    net.onClient('pfreeze', (m) => {
      const p = this.props.get(m.id);
      if (p) p.frozen = !!m.f;
    });
  }

  _create(m) {
    if (this.props.has(m.id)) return this.props.get(m.id);
    let model;
    const custom = this.world.customModel?.(m.type, m.s, m.mo);
    model = custom || buildModel(m.type, m.mo || { seed: m.id });
    const p = new Prop(this, m.id, m.type, model, { ...(m.s || {}) });
    p.modelOpts = m.mo || null;
    p.frozen = !!m.fz;
    p.root.position.fromArray(m.p);
    p.root.quaternion.fromArray(m.q);
    this.world.group.add(p.root);
    // physics body
    const colliders = model.colliders || [];
    if (colliders.length) {
      if (net.isHost) {
        p.body = this.physics.createDynamic(colliders, p.mass, p.root.position, p.root.quaternion, { kind: 'prop', prop: p }, {
          kinematic: p.frozen,
          linvel: m.v ? { x: m.v[0], y: m.v[1], z: m.v[2] } : null,
          angvel: m.av ? { x: m.av[0], y: m.av[1], z: m.av[2] } : null,
          ccd: p.mass < 2,
          friction: model.friction,
          restitution: model.restitution,
          linearDamping: model.linearDamping,
          angularDamping: model.angularDamping,
        });
        // 'spawn asleep': a body put to sleep the moment it is created never gets its first contact
        // pairs (Rapier 0.21), so light items on tables / desks sank into or fell through their support
        // as soon as anything woke them. Let it run a short settle window to make its contacts and come
        // to rest, then sleep it. Impacts from that settle (props start a few mm above their support)
        // are muted: no clatter, no noise for monsters, no breakage on level load.
        if (m.sl) {
          p.settleT = 0.75;
          p.lastImpact = (this.world.time ?? 0) + 0.75;
        }
      } else {
        p.body = this.physics.createDynamic(colliders, p.mass, p.root.position, p.root.quaternion, { kind: 'prop', prop: p }, { kinematic: true });
      }
    }
    this.props.set(p.id, p);
    if (p.id >= this.nextId) this.nextId = p.id + 1;
    const beh = this.behaviours.get(p.type) || this.behaviours.get(p.def.device);
    if (beh) p.custom = beh(p, this.world);
    for (const f of this.onSpawned) f(p);
    return p;
  }

  _remove(id, fx) {
    const p = this.props.get(id);
    if (!p) return;
    p.dead = true;
    for (const f of this.onRemoved) f(p, fx);
    p.custom?.dispose?.();
    if (p.body) this.physics.removeBody(p.body);
    p.body = null;
    p.root.removeFromParent();
    this.props.delete(id);
  }

  get(id) { return this.props.get(id); }

  // ---------------- per-frame ----------------
  update(dt) {
    this.time += dt;
    if (net.isHost) this._hostUpdate(dt);
    else this._clientUpdate(dt);
    for (const p of this.props.values()) p.custom?.update?.(dt);
  }

  _hostUpdate(dt) {
    // sync visuals from bodies
    for (const p of this.props.values()) {
      const b = p.body;
      if (!b) continue;
      if (p.frozen) {
        // kinematic: visual drives body
        if (b.bodyType() !== RAPIER.RigidBodyType.KinematicPositionBased) b.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        b.setNextKinematicTranslation(p.root.position);
        b.setNextKinematicRotation(p.root.quaternion);
        continue;
      } else if (b.bodyType() !== RAPIER.RigidBodyType.Dynamic) {
        b.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      }
      if (b.isSleeping()) { p.speed = 0; p.settleT = 0; continue; }
      const lv = b.linvel();
      p.speed = Math.hypot(lv.x, lv.y, lv.z);
      if (p.settleT > 0) {
        p.settleT -= dt;
        if (p.settleT <= 0 && p.speed < 0.06 && !p.isHeld()) {
          const av = b.angvel();
          if (av.x * av.x + av.y * av.y + av.z * av.z < 0.02) b.sleep();
        }
      }
      const t = b.translation();
      const r = b.rotation();
      p.root.position.set(t.x, t.y, t.z);
      p.root.quaternion.set(r.x, r.y, r.z, r.w);
      // fell through the world? put it back on top
      if (t.y < -20) {
        b.setTranslation({ x: t.x, y: 3, z: t.z }, true);
        b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    // snapshots
    this.snapTimer += dt;
    if (net.isOnline && this.snapTimer >= this.snapRate) {
      this.snapTimer = 0;
      this._sendSnapshot();
    }
  }

  _sendSnapshot() {
    const list = [];
    for (const p of this.props.values()) {
      if (!p.body) continue;
      if ((!p.body.isSleeping() && !p.frozen) || p.frozen || this.forceSendIds.has(p.id)) list.push(p);
      else if (p._sentAwake) list.push(p); // one final rest pose
      p._sentAwake = !p.body.isSleeping() && !p.frozen;
    }
    this.forceSendIds.clear();
    if (!list.length) return;
    const arr = new Float32Array(list.length * SNAP_FLOATS);
    let o = 0;
    for (const p of list) {
      arr[o++] = p.id;
      arr[o++] = p.root.position.x;
      arr[o++] = p.root.position.y;
      arr[o++] = p.root.position.z;
      arr[o++] = p.root.quaternion.x;
      arr[o++] = p.root.quaternion.y;
      arr[o++] = p.root.quaternion.z;
      arr[o++] = p.root.quaternion.w;
    }
    net.toRemotes('psnap', arr.buffer);
  }

  _applySnapshot(buf) {
    const arr = new Float32Array(buf instanceof ArrayBuffer ? buf : buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf);
    const now = this.time;
    for (let o = 0; o + SNAP_FLOATS <= arr.length; o += SNAP_FLOATS) {
      const p = this.props.get(arr[o]);
      if (!p) continue;
      p.buffer.push({ t: now, p: new THREE.Vector3(arr[o + 1], arr[o + 2], arr[o + 3]), q: new THREE.Quaternion(arr[o + 4], arr[o + 5], arr[o + 6], arr[o + 7]) });
      if (p.buffer.length > 8) p.buffer.shift();
    }
  }

  _clientUpdate() {
    const rt = this.time - this.interpDelay;
    for (const p of this.props.values()) {
      const buf = p.buffer;
      if (!buf.length) continue;
      // find bracketing samples
      let a = null, b = null;
      for (let i = buf.length - 1; i >= 0; i--) {
        if (buf[i].t <= rt) { a = buf[i]; b = buf[i + 1] || null; break; }
      }
      if (!a) { a = buf[0]; b = null; }
      if (b) {
        const k = THREE.MathUtils.clamp((rt - a.t) / Math.max(1e-4, b.t - a.t), 0, 1);
        p.root.position.lerpVectors(a.p, b.p, k);
        p.root.quaternion.slerpQuaternions(a.q, b.q, k);
      } else {
        // extrapolate softly toward last
        p.root.position.lerp(a.p, 0.35);
        p.root.quaternion.slerp(a.q, 0.35);
      }
      // drop consumed samples
      while (buf.length > 2 && buf[1].t < rt) buf.shift();
      if (p.body) {
        p.body.setNextKinematicTranslation(p.root.position);
        p.body.setNextKinematicRotation(p.root.quaternion);
      }
    }
  }

  // Teleport (host): moves body and forces a snapshot
  teleport(p, pos, quat, vel = null) {
    p.root.position.copy(pos);
    if (quat) p.root.quaternion.copy(quat);
    if (p.body && net.isHost) {
      p.body.setTranslation(pos, true);
      if (quat) p.body.setRotation(quat, true);
      p.body.setLinvel(vel || { x: 0, y: 0, z: 0 }, true);
      p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.forceSendIds.add(p.id);
  }

  setFrozen(p, frozen) {
    p.frozen = frozen;
    net.toAll('pfreeze', { id: p.id, f: frozen ? 1 : 0 });
  }

  // all props within radius of a point (cheap distance check)
  query(center, radius, fn) {
    const r2 = radius * radius;
    for (const p of this.props.values()) {
      if (p.root.position.distanceToSquared(center) <= r2) fn(p);
    }
  }

  clear() {
    for (const id of [...this.props.keys()]) this._remove(id);
    this.nextId = 1;
  }
}

export { _q, _q2, colliderDesc, GROUPS };
