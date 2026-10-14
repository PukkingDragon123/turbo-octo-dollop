// Still Lifes — procedural animation toolkit: springs, hold-then-snap timers, saccadic gaze, tremor,
// two-bone IK for bones with identity rest rotations, and world-space foot planting.
import * as THREE from 'three';
import { clamp, lerp, noise3, wrapAngle, smooth01, PI } from './core.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _e = new THREE.Euler();
export const UP = new THREE.Vector3(0, 1, 0);

export class Spring {
  constructor(k = 120, d = 12, x = 0) { this.k = k; this.d = d; this.x = x; this.v = 0; }
  step(dt, target, force = 0) {
    const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    for (let i = 0; i < n; i++) { this.v += (this.k * (target - this.x) - this.d * this.v + force) * h; this.x += this.v * h; }
    return this.x;
  }
  set(x) { this.x = x; this.v = 0; return this; }
}
export class SpringV {
  constructor(k = 120, d = 12) { this.k = k; this.d = d; this.x = new THREE.Vector3(); this.v = new THREE.Vector3(); this.init = false; }
  step(dt, target) {
    if (!this.init) { this.x.copy(target); this.init = true; return this.x; }
    const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    for (let i = 0; i < n; i++) {
      _v1.subVectors(target, this.x).multiplyScalar(this.k).addScaledVector(this.v, -this.d);
      this.v.addScaledVector(_v1, h); this.x.addScaledVector(this.v, h);
    }
    return this.x;
  }
}
// random hold timer: fire() returns true when the hold ends (then re-arms)
export class Hold {
  constructor(rng, lo, hi) { this.rng = rng; this.lo = lo; this.hi = hi; this.t = rng.range(lo, hi) * rng.next(); }
  step(dt, rate = 1) { this.t -= dt * rate; if (this.t <= 0) { this.t = this.rng.range(this.lo, this.hi); return true; } return false; }
}
// smooth tremor in [-1,1]
export const tremor = (t, seed, f = 7) => noise3(t * f, seed * 13.7, seed * 3.1) * 2 - 1;

// Saccadic gaze: holds, then jumps (stiff underdamped spring) to the target plus an error that
// sometimes overshoots far past it. Returns {yaw, pitch, roll}.
export class Saccade {
  constructor(rng, { lo = 0.25, hi = 1.6, k = 900, d = 26, err = 0.25, over = 0.35, maxYaw = 2.6, maxPitch = 1.0 } = {}) {
    this.rng = rng; this.hold = new Hold(rng, lo, hi); this.err = err; this.over = over; this.maxYaw = maxYaw; this.maxPitch = maxPitch;
    this.y = new Spring(k, d); this.p = new Spring(k, d); this.r = new Spring(k * 0.5, d * 0.7);
    this.ty = 0; this.tp = 0; this.tr = 0; this.jumped = false;
  }
  update(dt, wantYaw, wantPitch, rate = 1, rollAmt = 0.4) {
    this.jumped = false;
    if (this.hold.step(dt, rate)) {
      const R = this.rng;
      const e = this.err * (R.next() < 0.75 ? R.range(-1, 1) : 0);
      let ny = wantYaw + e;
      if (R.next() < this.over) ny = wantYaw + (wantYaw - this.ty) * R.range(0.2, 0.6); // overshoot past target
      this.ty = clamp(wrapAngle(ny), -this.maxYaw, this.maxYaw);
      this.tp = clamp(wantPitch + R.range(-0.5, 0.5) * this.err, -this.maxPitch, this.maxPitch);
      this.tr = R.range(-1, 1) * rollAmt;
      this.jumped = true;
    }
    return { yaw: this.y.step(dt, this.ty), pitch: this.p.step(dt, this.tp), roll: this.r.step(dt, this.tr) };
  }
}

// set a bone's local rotation from euler angles (radians) on top of identity rest
export function rot(bone, x = 0, y = 0, z = 0, order = 'XYZ') { bone.quaternion.setFromEuler(_e.set(x, y, z, order)); return bone; }
export function addRot(bone, x = 0, y = 0, z = 0, order = 'XYZ') { bone.quaternion.multiply(_q1.setFromEuler(_e.set(x, y, z, order))); return bone; }
export function preRot(bone, x = 0, y = 0, z = 0, order = 'XYZ') { bone.quaternion.premultiply(_q1.setFromEuler(_e.set(x, y, z, order))); return bone; }

// world point -> bone.parent local
export function parentLocal(bone, world, out) {
  bone.parent.updateWorldMatrix(true, false);
  return bone.parent.worldToLocal(out.copy(world));
}
export function worldDirToParent(bone, dir, out) {
  bone.parent.updateWorldMatrix(true, false);
  bone.parent.getWorldQuaternion(_q2).invert();
  return out.copy(dir).applyQuaternion(_q2);
}

// Rotate `bone` so its rest child direction restDir (bone-local, = child.position at rest) points at
// dir (bone.parent space). Minimal rotation.
export function aim(bone, restDir, dir) {
  bone.quaternion.setFromUnitVectors(_v1.copy(restDir).normalize(), _v2.copy(dir).normalize());
  return bone;
}

// Two-bone IK. U (upper), L (lower), E (end) with identity rest rotations.
// target, pole: in U.parent space. restBend: direction the middle joint points at rest (U.parent space).
// returns reach ratio (1 = fully extended)
export function ik2(U, L, E, target, pole, restBend, softness = 0.0) {
  const H = U.position;
  const A0 = _v1.copy(L.position); const a = A0.length(); A0.divideScalar(a);
  const b = E.position.length();
  const D = _v2.subVectors(target, H);
  let d = D.length();
  const dir = D.divideScalar(Math.max(d, 1e-6));
  const reach = d / (a + b);
  d = clamp(d, Math.abs(a - b) + 1e-4, (a + b) * (1 - 1e-4) - softness);
  const along = (a * a - b * b + d * d) / (2 * d), hgt = Math.sqrt(Math.max(0, a * a - along * along));
  const perp = _v3.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (perp.lengthSq() < 1e-8) perp.copy(restBend).addScaledVector(dir, -restBend.dot(dir));
  perp.normalize();
  const K = _v4.copy(H).addScaledVector(dir, along).addScaledVector(perp, hgt);
  // upper: frame (A0, B0) -> (A1, B1)
  const A1 = new THREE.Vector3().subVectors(K, H).normalize();
  const B0 = restBend.clone().addScaledVector(A0, -restBend.dot(A0)).normalize();
  const B1 = perp.clone().addScaledVector(A1, -perp.dot(A1)).normalize();
  _m1.makeBasis(A0, B0, new THREE.Vector3().crossVectors(A0, B0));
  _m2.makeBasis(A1, B1, new THREE.Vector3().crossVectors(A1, B1));
  _m2.multiply(_m1.transpose());
  U.quaternion.setFromRotationMatrix(_m2);
  // lower: point rest child dir at (T' - K) in U local
  const Tc = new THREE.Vector3().copy(H).addScaledVector(dir, d);
  const dl = Tc.sub(K).applyQuaternion(_q1.copy(U.quaternion).invert());
  L.quaternion.setFromUnitVectors(_v3.copy(E.position).normalize(), dl.normalize());
  return reach;
}

// Give E a world-space orientation (e.g. keep a foot flat): qWorld target
export function setWorldQuat(bone, qWorld) {
  bone.parent.updateWorldMatrix(true, false);
  bone.parent.getWorldQuaternion(_q2);
  bone.quaternion.copy(_q2.invert().multiply(qWorld));
}

// ---------------------------------------------------------------------------
// World-space foot planting. legs: [{rest: Vector3 (root-local foot rest), group, lift, dur}]
export class Planter {
  constructor(rng, legs, { lead = 0.18, stride = 0.22, maxStepping = 1, overshoot = 0.35, jitter = 0.3 } = {}) {
    this.rng = rng; this.lead = lead; this.stride = stride; this.maxStepping = maxStepping; this.overshoot = overshoot; this.jitter = jitter;
    this.legs = legs.map((l) => ({ ...l, planted: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), cur: new THREE.Vector3(), t: 1, has: false, lift: l.lift ?? 0.08, dur: l.dur ?? 0.22, land: 0 }));
    this.prev = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.hasPrev = false;
    this.groupBusy = new Map();
  }
  reset(root) { for (const l of this.legs) l.has = false; this.hasPrev = false; }
  // root: creature root Object3D (world matrix current). returns legs with .cur (world) and .t
  update(dt, root, rate = 1) {
    root.updateWorldMatrix(true, false);
    const wp = _v1.setFromMatrixPosition(root.matrixWorld);
    if (this.hasPrev && dt > 0) {
      const jump = wp.distanceTo(this.prev);
      if (jump > 1.5) { for (const l of this.legs) l.has = false; this.vel.set(0, 0, 0); }
      else this.vel.lerp(_v2.subVectors(wp, this.prev).divideScalar(dt), 1 - Math.exp(-10 * dt));
    }
    this.prev.copy(wp); this.hasPrev = true;
    const groundY = wp.y;
    const busy = this.groupBusy; busy.clear();
    for (const l of this.legs) if (l.t < 1) busy.set(l.group, (busy.get(l.group) || 0) + 1);
    let nStepping = 0; for (const v of busy.values()) nStepping += v;
    const speed = this.vel.length();
    for (const l of this.legs) {
      const des = _v3.copy(l.rest); root.localToWorld(des); des.y = groundY;
      des.addScaledVector(this.vel, this.lead);
      if (!l.has) { l.planted.copy(des); l.cur.copy(des); l.has = true; l.t = 1; }
      if (l.t >= 1) {
        const far = Math.hypot(l.planted.x - des.x, l.planted.z - des.z);
        const otherBusy = [...busy.entries()].some(([g, n]) => g !== l.group && n > 0);
        const urgent = far > this.stride * 1.9;
        if ((far > this.stride * (1 + (this.rng.next() - 0.5) * this.jitter) && !otherBusy && nStepping < this.maxStepping + (urgent ? 2 : 0)) || (urgent && nStepping < this.maxStepping + 3)) {
          l.from.copy(l.planted);
          l.to.copy(des).addScaledVector(_v4.subVectors(des, l.planted).setY(0), this.overshoot * clamp(speed, 0, 1.5));
          l.to.y = groundY;
          l.t = 0; l.curDur = l.dur * (0.8 + this.rng.next() * 0.45) / Math.max(0.4, rate);
          busy.set(l.group, (busy.get(l.group) || 0) + 1); nStepping++;
        }
      }
      if (l.t < 1) {
        l.t = Math.min(1, l.t + dt / l.curDur);
        const u = smooth01(l.t);
        l.cur.lerpVectors(l.from, l.to, u);
        l.cur.y = groundY + Math.sin(l.t * PI) * l.lift;
        if (l.t >= 1) { l.planted.copy(l.to); l.land = 1; }
      } else { l.cur.copy(l.planted); l.cur.y = groundY; }
      l.land = Math.max(0, l.land - dt * 6);
    }
    return this.legs;
  }
}

export { _v1 as tmpV };
export const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;
export { clamp, lerp };
