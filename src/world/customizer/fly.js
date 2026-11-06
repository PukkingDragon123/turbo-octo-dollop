// Things flying between the shelves and the clone: an eased arc with a little spin and squash, plus
// drip / dust particles. Everything in world space (the flyer is re-parented to the scene).
import * as THREE from 'three';
import { clamp, easeIO, lerp, rnd, V } from './kit.js';

const _q = new THREE.Quaternion();
export class Flyers {
  constructor(scene) { this.scene = scene; this.list = []; }
  // obj flies from its current world pose to to() (a function returning the live world target) over dur
  add(obj, { to, toQ = null, dur = 0.7, arc = 0.25, spin = 0, scaleTo = null, onArrive = null, onUpdate = null } = {}) {
    const p0 = obj.getWorldPosition(V()), q0 = obj.getWorldQuaternion(new THREE.Quaternion()), s0 = obj.getWorldScale(V());
    this.scene.attach(obj);
    const F = { obj, p0, q0, s0, to, toQ, dur, arc, spin, scaleTo, onArrive, onUpdate, t: 0 };
    this.list.push(F);
    return F;
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const F = this.list[i];
      F.t += dt;
      const u = clamp(F.t / F.dur, 0, 1), k = easeIO(u);
      const p1 = typeof F.to === 'function' ? F.to() : F.to;
      F.obj.position.copy(F.p0).lerp(p1, k);
      F.obj.position.y += Math.sin(u * Math.PI) * F.arc;
      const q1 = typeof F.toQ === 'function' ? F.toQ() : F.toQ;
      if (q1) F.obj.quaternion.copy(F.q0).slerp(q1, k); else F.obj.quaternion.copy(F.q0);
      if (F.spin) F.obj.quaternion.multiply(_q.setFromAxisAngle(V(0, 1, 0), F.spin * Math.sin(u * Math.PI)));
      if (F.scaleTo != null) F.obj.scale.copy(F.s0).multiplyScalar(lerp(1, F.scaleTo, k));
      F.onUpdate?.(F, u);
      if (u >= 1) { this.list.splice(i, 1); F.onArrive?.(F); }
    }
  }
  get busy() { return this.list.length > 0; }
}

// small droplets (liquid off the eyes, dust off the pegboard)
export class Drops {
  constructor(scene, n = 80, color = 0xd8e0a0) {
    this.n = n; this.i = 0;
    const g = new THREE.BufferGeometry();
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.l = new Float32Array(n);
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
    this.mat = new THREE.PointsMaterial({ color, size: 0.008, transparent: true, opacity: 0.75, depthWrite: false });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false;
    this.geo = g;
    for (let i = 0; i < n; i++) this.p[i * 3 + 1] = -100;
    scene.add(this.pts);
  }
  emit(pos, k = 1, spread = 0.3) {
    for (let j = 0; j < k; j++) {
      const i = (this.i = (this.i + 1) % this.n);
      pos.toArray(this.p, i * 3);
      this.v[i * 3] = rnd(-spread, spread); this.v[i * 3 + 1] = rnd(-0.2, 0.3); this.v[i * 3 + 2] = rnd(-spread, spread);
      this.l[i] = rnd(0.4, 0.9);
    }
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.l[i] <= 0) { this.p[i * 3 + 1] = -100; continue; }
      this.l[i] -= dt;
      this.v[i * 3 + 1] -= 9.8 * dt;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}
