// Host-side R.E.P.O.-style physics grabbing. Every player's grab is a spring-damper pulling a
// point on the object toward a target in front of their camera, with a force cap per player:
// light stuff flies, heavy furniture drags, and several clones together can lift a couch.
import * as THREE from 'three';
import { net } from '../net/net.js';
import { GROUPS } from '../physics/physics.js';

const MAX_FORCE = 340;   // N per player (incl. gravity compensation) at pull power 1
const THROW_IMPULSE = 11;
const FAR_THROW = 1.9;   // [Shift] far-throw multiplier
// grab messages carry f = pull power (0.5 at the start, ramping to ~1.7 while RMB is held: hold to pull harder)

const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _r = new THREE.Vector3();
const _w = new THREE.Vector3();
const _t = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _i = new THREE.Vector3();

export class GrabServer {
  constructor(world) {
    this.world = world;
    this.grabs = new Map(); // playerId -> {id, lp, target, rot, t}
    world.physics.beforeStep.push((dt) => this.step(dt));
    net.onHost('grab', (d, from) => this.onGrab(d, from));
  }

  onGrab(d, from) {
    const prev = this.grabs.get(from);
    if (d.release) {
      if (prev) this._release(from, prev, d.throw, d.far ? FAR_THROW * (0.8 + Math.min(1.7, d.f || 1) * 0.25) : 1);
      return;
    }
    const prop = this.world.props.get(d.id);
    if (!prop || !prop.body) return;
    if (!prev || prev.id !== d.id) {
      if (prev) this._release(from, prev, null);
      prop.grabbers.set(from, true);
      this.world.physics.setBodyGroups(prop.body, GROUPS.propHeld);
      prop.body.wakeUp();
      prop.touched = true;
      prop.custom?.onGrabbed?.(from);
      this.world.level?.onPropGrabbed?.(prop, from);
    }
    this.grabs.set(from, {
      id: d.id,
      lp: new THREE.Vector3().fromArray(d.lp),
      target: new THREE.Vector3().fromArray(d.tp),
      rot: d.r || null,
      f: Math.max(0.3, Math.min(1.8, d.f ?? 1)),
      t: performance.now(),
    });
  }

  _release(playerId, g, throwVec, mult = 1) {
    this.grabs.delete(playerId);
    const prop = this.world.props.get(g.id);
    if (!prop) return;
    prop.grabbers.delete(playerId);
    if (prop.body && prop.grabbers.size === 0) this.world.physics.setBodyGroups(prop.body, GROUPS.prop);
    if (throwVec && prop.body) {
      const m = prop.body.mass();
      const imp = Math.min(THROW_IMPULSE * 1.4 * mult, Math.max(1.5, m * 9 * mult)) * Math.min(1, 14 / Math.max(m, 1) + 0.15);
      _v.fromArray(throwVec).normalize().multiplyScalar(imp);
      prop.body.applyImpulse(_v, true);
      prop.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * 0.2 * m, y: (Math.random() - 0.5) * 0.2 * m, z: (Math.random() - 0.5) * 0.2 * m }, true);
      prop.thrownBy = playerId;
      prop.thrownAt = performance.now();
      this.world.noise.emit(prop.root.position, 6, 'throw');
    }
  }

  releaseAllFor(propId) {
    for (const [pid, g] of this.grabs) if (g.id === propId) this._release(pid, g, null);
  }

  playerLeft(playerId) {
    const g = this.grabs.get(playerId);
    if (g) this._release(playerId, g, null);
  }

  step(dt) {
    const now = performance.now();
    for (const [pid, g] of this.grabs) {
      const prop = this.world.props.get(g.id);
      if (!prop || !prop.body || prop.dead) { this.grabs.delete(pid); continue; }
      if (now - g.t > 1500) { this._release(pid, g, null); continue; } // stale (lag / disconnect)
      const b = prop.body;
      if (prop.frozen) continue;
      const n = prop.grabbers.size || 1;
      const m = b.mass();
      const t = b.translation();
      const r = b.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      _r.copy(g.lp).applyQuaternion(_q);           // lever arm
      _p.set(t.x, t.y, t.z).add(_r);               // grab point world
      const lv = b.linvel(), av = b.angvel();
      _w.set(av.x, av.y, av.z);
      _v.set(lv.x, lv.y, lv.z).add(_t.crossVectors(_w, _r)); // point velocity
      // desired velocity toward target
      const err = _t.subVectors(g.target, _p);
      const dist = err.length();
      const pf = g.f ?? 1;
      const desired = err.multiplyScalar(Math.min(14, 11 + dist * 4) * Math.min(1, 0.6 + dist) * (0.75 + pf * 0.25));
      if (desired.length() > 12 * (0.8 + pf * 0.2)) desired.setLength(12 * (0.8 + pf * 0.2));
      _i.subVectors(desired, _v).multiplyScalar(m * 0.5);
      // gravity compensation shared between grabbers
      _i.y += (m * 11.5 * dt) / n;
      const maxImp = MAX_FORCE * pf * (this.world.carryMul || 1) * dt; // carryMul: CARRY HARNESS upgrade (game/economy.js)
      if (_i.length() > maxImp) _i.setLength(maxImp);
      b.applyImpulseAtPoint(_i, _p, true);
      // stabilise spin while held; rotate on request
      const damp = Math.min(1, 10 * dt);
      const inertia = Math.max(0.02, m * prop.radius * prop.radius * 0.3);
      if (g.rot) {
        // rot = [yawDelta, pitchDelta, cameraRightX, cameraRightZ]
        const k = 26 * inertia * dt * 60;
        const rx = g.rot[2] ?? 1, rz = g.rot[3] ?? 0;
        b.applyTorqueImpulse({
          x: rx * g.rot[1] * k - av.x * inertia * damp,
          y: g.rot[0] * k - av.y * inertia * damp,
          z: rz * g.rot[1] * k - av.z * inertia * damp,
        }, true);
        g.rot = null;
      } else {
        b.applyTorqueImpulse({ x: -av.x * inertia * damp, y: -av.y * inertia * damp, z: -av.z * inertia * damp }, true);
      }
    }
  }

  // Players currently lifting a prop (for teamwork achievements)
  grabberCount(propId) {
    let n = 0;
    for (const g of this.grabs.values()) if (g.id === propId) n++;
    return n;
  }
}
