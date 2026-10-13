// Rats and cockroaches (local ambience, simulated per client). They idle and sniff around,
// scatter from footsteps and flashlights, and actually escape into wall vents and pipes.
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { audio } from '../audio/audio.js';
import { RAPIER, G, groups, Q } from '../physics/physics.js';
import { buildRat, buildCockroach } from '../entities/optional.js';
import { CELL } from '../world/levels/yellow/layout.js';

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

class Critter {
  constructor(mgr, kind, pos) {
    this.mgr = mgr;
    this.kind = kind;
    this.model = kind === 'rat' ? buildRat((Math.random() * 1e6) | 0) : buildCockroach((Math.random() * 1e6) | 0);
    this.root = this.model.root;
    this.pos = pos.clone();
    this.pos.y = 0.005;
    this.yaw = Math.random() * Math.PI * 2;
    this.speed = 0;
    this.state = 'idle';
    this.t = Math.random() * 3;
    this.vent = null;
    this.enter = 0;
    this.dead = false;
    this.root.position.copy(this.pos);
    mgr.world.group.add(this.root);
    mgr.world.registerDynamic(this.root);
    if (kind === 'rat') {
      const desc = RAPIER.ColliderDesc.ball(0.12).setCollisionGroups(groups(G.CRITTER, G.TRIGGER)).setTranslation(pos.x, 0.1, pos.z);
      this.collider = mgr.world.physics.world.createCollider(desc);
      mgr.world.physics.setUserData(this.collider, { kind: 'critter', critter: this });
    }
  }

  update(dt) {
    const mgr = this.mgr;
    const l = mgr.game.local;
    const dPlayer = this.pos.distanceTo(l.pos);
    this.t -= dt;
    const scareR = this.kind === 'rat' ? 4.2 : 2.6;
    const lit = l.flashOn && dPlayer < 8 && this._inBeam();
    if (this.state !== 'flee' && this.state !== 'enter' && (dPlayer < scareR * (l.sprinting ? 1.6 : l.crouching ? 0.6 : 1) || lit)) {
      this.state = 'flee';
      this.vent = mgr.nearestVent(this.pos, 18);
      if (this.kind === 'rat') audio.play('rat_squeak', { pos: this.pos, volume: 0.7 });
      else if (Math.random() < 0.3) audio.play('roach_scuttle', { pos: this.pos, volume: 0.5 });
    }
    let targetSpeed = 0;
    if (this.state === 'idle') {
      if (this.t <= 0) {
        this.state = Math.random() < 0.6 ? 'wander' : 'idle';
        this.t = 1 + Math.random() * 3;
        this.yaw += (Math.random() - 0.5) * 2.5;
      }
    } else if (this.state === 'wander') {
      targetSpeed = this.kind === 'rat' ? 0.5 : 0.25;
      if (this.t <= 0) { this.state = 'idle'; this.t = 1 + Math.random() * 3; }
    } else if (this.state === 'flee') {
      targetSpeed = this.kind === 'rat' ? 3.4 : 1.4;
      let goal;
      if (this.vent) goal = this.vent.pos;
      else goal = _v.copy(this.pos).sub(l.pos).setY(0).normalize().multiplyScalar(5).add(this.pos);
      const dx = goal.x - this.pos.x, dz = goal.z - this.pos.z;
      const want = Math.atan2(dx, dz);
      let dy = want - this.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.yaw += dy * Math.min(1, dt * 10);
      if (this.vent && Math.hypot(dx, dz) < 0.35) { this.state = 'enter'; this.enter = 0; }
      if (!this.vent && dPlayer > 16) this.dead = true;
    } else if (this.state === 'enter') {
      this.enter += dt * 2.5;
      if (this.vent?.inside) this.pos.lerp(this.vent.inside, Math.min(1, dt * 7));
      this.root.scale.setScalar(Math.max(0.01, 1 - this.enter));
      if (this.enter >= 1) this.dead = true;
    }
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 8);
    // wall avoidance
    if (this.speed > 0.05 && this.state !== 'enter') {
      _d.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const hit = mgr.world.physics.raycast(_v.copy(this.pos).setY(0.06), _d, 0.35 + this.speed * 0.15, Q.solid);
      if (hit) {
        this.yaw += (Math.random() < 0.5 ? 1 : -1) * (1.2 + Math.random());
      } else this.pos.addScaledVector(_d, this.speed * dt);
    }
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw + Math.PI; // models face -Z
    this.model.update(dt, { speed: this.speed, turning: 0 });
    this.collider?.setTranslation({ x: this.pos.x, y: 0.1, z: this.pos.z });
  }

  _inBeam() {
    const cam = engine.camera;
    _v.subVectors(this.pos, cam.position).normalize();
    _d.set(0, 0, -1).applyQuaternion(cam.quaternion);
    return _v.dot(_d) > 0.85;
  }

  dispose() {
    this.mgr.world.unregisterDynamic(this.root);
    this.root.removeFromParent();
    if (this.collider) this.mgr.world.physics.removeCollider(this.collider);
  }
}

export class Critters {
  constructor(level) {
    this.level = level;
    this.world = level.world;
    this.game = level.game;
    this.list = [];
    this.vents = [];
    this.spawnT = 3;
  }

  // pos: where a fleeing critter heads (floor level, in front of the opening); inside: where it squeezes in
  addVent(pos, obj, inside = null) { this.vents.push({ pos, obj, inside }); }
  removeVentsOf(rec) {
    const statics = new Set(rec.statics || []);
    this.vents = this.vents.filter((v) => !statics.has(v.obj));
  }

  nearestVent(pos, r) {
    let best = null, bd = r;
    for (const v of this.vents) {
      const d = v.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  update(dt) {
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 4 + Math.random() * 6;
      this._spawn();
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      c.update(dt);
      if (c.dead || c.pos.distanceTo(this.game.local.pos) > 40) {
        c.dispose();
        this.list.splice(i, 1);
      }
    }
  }

  _spawn() {
    const l = this.game.local;
    if (l.dead) return;
    const rats = this.list.filter((c) => c.kind === 'rat').length;
    const roaches = this.list.length - rats;
    const a = Math.random() * Math.PI * 2;
    const d = 7 + Math.random() * 10;
    const x = l.pos.x + Math.cos(a) * d, z = l.pos.z + Math.sin(a) * d;
    if (!this.level.isChunkLoaded(x, z)) return;
    const c = this.level.cell(x, z);
    if (!c) return;
    const base = new THREE.Vector3((Math.floor(x / CELL) + 0.5) * CELL, 0, (Math.floor(z / CELL) + 0.5) * CELL);
    // near a wall corner looks natural
    base.x += (Math.random() - 0.5) * 2;
    base.z += (Math.random() - 0.5) * 2;
    const grimy = c.zone === 'maintenance' || c.zone === 'dark' || c.zone === 'flooded';
    if (Math.random() < (grimy ? 0.6 : 0.35) && rats < 5) this.list.push(new Critter(this, 'rat', base));
    else if (roaches < 14) {
      const n = 3 + Math.floor(Math.random() * 5);
      for (let k = 0; k < n; k++) this.list.push(new Critter(this, 'roach', base.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6))));
    }
  }

  // catching a rat in a sample jar removes it
  catchAt(point) {
    for (const c of this.list) if (c.kind === 'rat' && c.pos.distanceTo(point) < 0.5) { c.dead = true; return true; }
    return false;
  }

  dispose() {
    for (const c of this.list) c.dispose();
    this.list = [];
  }
}
