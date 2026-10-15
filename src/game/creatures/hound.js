// THE HOUND — a clone stretched into a dog: runs on its gloved hands and booted feet, eyeless sack
// head split by a mouth full of teeth. Nearly blind: it hunts by SOUND (sprinting, impacts, voices),
// galloping straight at the loudest noise. Light hurts it: a flashlight beam held on it (or a lit
// flare / glowstick nearby) makes it yelp and bolt. It bites, backs off, circles, bites again.
import * as THREE from 'three';
import { Agent } from './agent.js';
import { RNG } from '../../core/rng.js';

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();

export class HoundAI extends Agent {
  constructor(mgr, id, pos) {
    super(mgr, id, 'hound', pos, 0.14, 0.34);
    this.rng = new RNG(id * 4421 + 7);
    this.state = 'prowl';
    this.hp = 3;
    this.goal = null;
    this.target = null;
    this.lastKnown = new THREE.Vector3();
    this.hasLast = false;
    this.lostT = 0;
    this.cooldown = 0;
    this.noiseT = 0;
    this.waryT = 0;
    this.fleeFrom = new THREE.Vector3();
    this.circleDir = this.rng.chance(0.5) ? 1 : -1;
    this.howlT = 20 + this.rng.range(0, 30);
    this.pantT = 0;
    this.stunT = 0;
    this.intensity = 0.3;
  }

  get idleState() { return 'prowl'; }

  update(dt) {
    const mgr = this.mgr;
    this.stateT += dt;
    this.cooldown -= dt;
    this.waryT -= dt;
    if (this.zoneReact(dt)) return;
    if (this.stunT > 0) {
      this.stunT -= dt;
      this.vel.multiplyScalar(0.8);
      this.integrate(dt);
      return;
    }
    const day = mgr.game.day.day;
    const aggro = Math.min(1, 0.3 + day * 0.1);
    // ---- perception: near-blind, sharp ears, hates light ----
    let seen = null, seenD = 1e9, lightThreat = null;
    for (const pl of mgr.alivePlayers()) {
      const d = pl.pos.distanceTo(this.pos);
      if (d > 30) continue;
      if (pl.flash && d < 13 && mgr.isWatchedBy(pl, _v.copy(this.pos).setY(0.6), 0.9)) lightThreat = pl;
      if (pl.safe || d > 7) continue;
      if (!this.world.physics.lineOfSight(_v.copy(this.pos).setY(0.7), _f.copy(pl.pos).setY(pl.pos.y + 0.8))) continue;
      if (d < seenD) { seen = pl; seenD = d; }
    }
    const flare = mgr.nearestLight(this.pos, 5);
    if ((lightThreat || flare) && this.state !== 'flee') {
      this.setState('flee');
      this.fleeFrom.copy(lightThreat ? lightThreat.pos : flare);
      this.waryT = 10;
      this.raid && this.endRaid();
      mgr.sound('hound_yelp', this.pos, 1);
    }
    const heard = this.hear(1.5 + aggro * 0.5, this.noiseT);
    this.noiseT = this.world.noise.time - 0.1;
    if (seen) { this.target = seen; this.lastKnown.copy(seen.pos); this.hasLast = true; this.lostT = 0; } else this.lostT += dt;
    this.intensity = this.state === 'chase' || this.state === 'pounce' ? 1 : this.state === 'hunt' ? 0.75 : 0.35;

    if (this.raid && this.state !== 'flee') {
      if (seen && !seen.safe) { this.endRaid(); this.setState('chase'); }
      else {
        this.raidUpdate(dt, 4.2, { knocks: 3, dragMax: 30 });
        this.attackT = Math.max(0, this.attackT - dt * 2);
        this.integrate(dt);
        this._sounds(dt);
        return;
      }
    }

    switch (this.state) {
      case 'prowl': {
        if (!this.goal || this.pos.distanceTo(this.goal) < 1.2 || this.stateT > 18) {
          const p = mgr.level.nav.randomNear(this.pos.x, this.pos.z, 2 + this.rng.int(0, 4), () => this.rng.next());
          this.goal = new THREE.Vector3(p[0], 0, p[1]);
          this.stateT = 0;
          if (this.rng.chance(0.3)) { this.setState('sniff'); break; }
        }
        this.moveTo(dt, this.goal, 1.3);
        this.look = null;
        if (seen && this.waryT <= 0) this._lockOn();
        else if (heard && heard.score > 1.2) this._hunt(heard.event.pos);
        this.howlT -= dt;
        if (this.howlT <= 0) { this.howlT = 35 + this.rng.range(0, 40); mgr.sound('hound_howl', this.pos, 1); }
        break;
      }
      case 'sniff': {
        this.vel.multiplyScalar(0.85);
        this.look = null;
        if (seen && this.waryT <= 0) this._lockOn();
        else if (heard && heard.score > 0.8) this._hunt(heard.event.pos);
        else if (this.stateT > 2.5) this.setState('prowl');
        break;
      }
      case 'hunt': {
        // gallop at the noise
        const d = this.moveTo(dt, this.goal, 5.2 + aggro * 1.2);
        this.lookAt(this.goal, 0.6);
        if (seen && this.waryT <= 0) this._lockOn();
        else if (heard && heard.score > 3 && heard.event.pos.distanceTo(this.goal) > 2.5) this.goal.copy(heard.event.pos).setY(0);
        else if (d < 1.3 || this.stateT > 14) this.setState('sniff');
        break;
      }
      case 'chase': {
        const tgt = this.target && !this.target.dead && this.lostT < 0.6 ? this.target.pos : this.hasLast ? this.lastKnown : null;
        if (!tgt) { this.setState('prowl'); break; }
        const d = this.moveTo(dt, tgt, 6.0 + aggro * 1.4);
        this.lookAt(tgt, 0.9);
        if (this.target && this.lostT < 0.6 && d < 1.6 && this.cooldown <= 0) {
          this.setState('pounce');
          this.attackT = 0;
          this.hit = false;
          mgr.sound('hound_snarl', this.pos, 1);
        } else if (this.lostT > 4 || (this.lostT > 0.6 && d < 1.2)) {
          if (heard && heard.score > 0.5) this._hunt(heard.event.pos);
          else this.setState('sniff');
        }
        break;
      }
      case 'pounce': {
        this.attackT = Math.min(1, this.attackT + dt / 0.6);
        if (this.target) {
          this.faceToward(this.target.pos, dt, 12);
          // lunge forward during the strike
          if (this.attackT < 0.45) { _f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); this.vel.x = _f.x * 5; this.vel.z = _f.z * 5; }
          else this.vel.multiplyScalar(0.6);
        }
        if (this.attackT >= 0.4 && !this.hit) {
          this.hit = true;
          if (this.target && !this.target.dead && !this.target.safe && this.pos.distanceTo(this.target.pos) < 2.1) {
            mgr.damagePlayer(this.target, 16 + aggro * 8, 'bite', this.pos, 'a Hound');
            mgr.sound('hound_bite', this.pos, 1);
          }
        }
        if (this.attackT >= 1) {
          this.cooldown = 2.2 - aggro * 0.6;
          this.circleDir = this.rng.chance(0.5) ? 1 : -1;
          this.setState('circle');
        }
        break;
      }
      case 'circle': {
        // back off and circle the prey before the next bite
        const t = this.target;
        if (!t || t.dead) { this.setState('prowl'); break; }
        _v.set(this.pos.x - t.pos.x, 0, this.pos.z - t.pos.z);
        const d = _v.length() || 1;
        _v.divideScalar(d);
        const R = 3.8;
        _f.set(-_v.z * this.circleDir, 0, _v.x * this.circleDir).multiplyScalar(4.2).addScaledVector(_v, (R - d) * 2.5);
        this.vel.x += (_f.x - this.vel.x) * Math.min(1, dt * 5);
        this.vel.z += (_f.z - this.vel.z) * Math.min(1, dt * 5);
        this.faceToward(t.pos, dt, 6);
        this.lookAt(t.pos, 0.9);
        if (this.stateT > 1.6 + this.rng.range(0, 1.4) && this.cooldown <= 0) this.setState('chase');
        if (this.lostT > 3) this.setState('sniff');
        if (this.rng.chance(dt * 0.6)) mgr.sound('hound_snarl', this.pos, 0.7);
        break;
      }
      case 'flee': {
        _v.set(this.pos.x - this.fleeFrom.x, 0, this.pos.z - this.fleeFrom.z);
        if (_v.lengthSq() < 0.01) _v.set(1, 0, 0);
        _v.normalize().multiplyScalar(8).add(this.pos);
        this.moveTo(dt, _v, 7);
        this.look = null;
        if (this.stateT > 3.2) this.setState('prowl');
        break;
      }
      default: this.setState('prowl');
    }
    if (this.state !== 'pounce') this.attackT = Math.max(0, this.attackT - dt * 2);
    this.integrate(dt);
    this._sounds(dt);
  }

  _lockOn() {
    if (this.state !== 'chase') this.mgr.sound('hound_snarl', this.pos, 1);
    this.setState('chase');
  }

  _hunt(p) {
    if (!this.goal) this.goal = new THREE.Vector3();
    this.goal.copy(p).setY(0);
    if (this.state !== 'hunt') this.mgr.sound('hound_snarl', this.pos, 0.6);
    this.setState('hunt');
  }

  _sounds(dt) {
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.pantT -= dt * (sp > 3 ? 2.5 : 0.6);
    if (this.pantT <= 0) { this.pantT = 1.6 + this.rng.range(0, 1.2); this.mgr.sound('hound_pant', this.pos, sp > 3 ? 0.9 : 0.5); }
  }

  onHit(dir) {
    this.hp--;
    this.vel.addScaledVector(dir, 5);
    this.setState('flee');
    this.fleeFrom.copy(this.pos).addScaledVector(dir, -2);
    this.waryT = 6;
    this.mgr.sound('hound_yelp', this.pos, 1);
    if (this.raid) this.endRaid();
    return this.hp <= 0;
  }

  onFlash(p) {
    this.setState('flee');
    this.fleeFrom.copy(p);
    this.waryT = 12;
    this.mgr.sound('hound_yelp', this.pos, 1);
  }
}
