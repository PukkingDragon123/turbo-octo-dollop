// THE SMILER — a grin of glowing teeth and two pale eyes hanging in a dark sector. It only exists in
// darkness: light (a lamp overhead, a flare, a flashlight beam) makes it hiss and dissolve, to come
// back somewhere else dark later. Don't STARE at it in the dark: the longer you hold its gaze without
// a light on it, the wider the grin gets, until it rushes you.
import * as THREE from 'three';
import { Agent } from './agent.js';
import { RNG } from '../../core/rng.js';

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();

export class SmilerAI extends Agent {
  constructor(mgr, id, pos) {
    super(mgr, id, 'smiler', pos, 0.5, 0.24);
    this.rng = new RNG(id * 1597 + 3);
    this.state = 'lurk';
    this.stare = 0;
    this.lum = 0;
    this.lightT = 0;
    this.cooldown = 0;
    this.target = null;
    this.fleeFrom = new THREE.Vector3();
    this.giggleT = 4 + this.rng.range(0, 6);
    this.intensity = 0.2;
    this.stunT = 0;
  }

  get idleState() { return 'lurk'; }

  update(dt) {
    const mgr = this.mgr;
    this.stateT += dt;
    this.cooldown -= dt;
    if (this.zoneReact(dt)) return;
    this.lightT -= dt;
    if (this.lightT <= 0) { this.lightT = 0.35; this.lum = mgr.lightAt(this.pos); }
    const day = mgr.game.day.day;
    const players = mgr.alivePlayers();
    // ---- threats: any light on it ----
    let threat = null, starer = null, starerD = 1e9;
    for (const pl of players) {
      const d = pl.pos.distanceTo(this.pos);
      if (d > 20) continue;
      _v.copy(this.pos).setY(1.7);
      if (pl.flash && d < 15 && mgr.isWatchedBy(pl, _v, 0.9)) { threat = pl.pos; continue; }
      if (!pl.safe && !pl.flash && mgr.isWatchedBy(pl, _v, 0.84) && d < starerD) { starer = pl; starerD = d; }
    }
    const lamp = mgr.nearestLight(this.pos, 6);
    if (!threat && lamp) threat = lamp;
    if (!threat && this.lum > 0.3) threat = this.pos;
    if (this.stunT > 0) { this.stunT = 0; threat = threat || this.pos; }
    if (threat && this.state !== 'flee') {
      this.setState('flee');
      this.fleeFrom.copy(threat);
      mgr.sound('smiler_hiss', this.pos, 1);
    }
    this.frozen = false;
    switch (this.state) {
      case 'lurk': {
        if (starer) {
          // held in someone's gaze: hangs perfectly still while the grin widens
          this.stare += dt;
          this.vel.multiplyScalar(0.7);
          this.frozen = true;
          this.target = starer;
          this.lookAt(starer.pos, 1.5);
          this.faceToward(starer.pos, dt, 3);
        } else {
          this.stare = Math.max(0, this.stare - dt * 0.5);
          const near = this.nearestPlayer(24);
          if (near) {
            this.lookAt(near.pos, 1.5);
            this.faceToward(near.pos, dt, 2);
            // drift closer while nobody looks, but keep a distance
            if (this._nearD > 7) this.moveTo(dt, near.pos, 1.1);
            else this.vel.multiplyScalar(0.85);
          } else { this.vel.multiplyScalar(0.85); this.look = null; }
        }
        this.giggleT -= dt * (1 + this.stare);
        if (this.giggleT <= 0) { this.giggleT = 6 + this.rng.range(0, 8); mgr.sound('smiler_giggle', this.pos, 0.8); }
        const need = Math.max(1.4, 2.6 - (day - 2) * 0.2);
        this.intensity = Math.min(1, 0.2 + (this.stare / need) * 0.8);
        if (this.stare >= need && this.target && !this.target.dead && this.cooldown <= 0) {
          this.setState('charge');
          mgr.sound('smiler_charge', this.pos, 1);
          this.world.noise.emit(this.pos, 12, 'monster');
        }
        break;
      }
      case 'charge': {
        const t = this.target;
        if (!t || t.dead || t.safe) { this.setState('lurk'); this.stare = 0; break; }
        const d = this.moveTo(dt, t.pos, 8.5 + day * 0.2);
        this.lookAt(t.pos, 1.5);
        this.intensity = 1;
        if (d < 1.3) {
          mgr.damagePlayer(t, 22 + day * 2, 'slash', this.pos, 'the Smiler', { sanity: 18 });
          this.attackT = 1;
          this.stare = 0;
          this.cooldown = 8;
          // it is gone as fast as it came
          this.setState('flee');
          this.fleeFrom.copy(t.pos);
        } else if (this.stateT > 3.5) { this.setState('lurk'); this.stare = 0; }
        break;
      }
      case 'flee': {
        _f.set(this.pos.x - this.fleeFrom.x, 0, this.pos.z - this.fleeFrom.z);
        if (_f.lengthSq() < 0.01) _f.set(Math.cos(this.id), 0, Math.sin(this.id));
        _f.normalize();
        this.vel.x += (_f.x * 6 - this.vel.x) * Math.min(1, dt * 6);
        this.vel.z += (_f.z * 6 - this.vel.z) * Math.min(1, dt * 6);
        this.intensity = Math.max(0, this.intensity - dt * 1.5);
        if (this.stateT > 1.3) { this.vanish = true; this.mgr.typeCooldown('smiler', 30); }
        break;
      }
      default: this.setState('lurk');
    }
    this.attackT = Math.max(0, this.attackT - dt * 1.5);
    this.integrate(dt);
  }

  // combat.js reaction hook (damage / death are handled there)
  onHurt(dir) {
    this.setState('flee');
    this.fleeFrom.copy(this.pos).addScaledVector(dir, -2);
    this.mgr.sound('smiler_hiss', this.pos, 1);
  }

  onFlash(p) {
    this.setState('flee');
    this.fleeFrom.copy(p);
    this.mgr.sound('smiler_hiss', this.pos, 1);
  }
}
