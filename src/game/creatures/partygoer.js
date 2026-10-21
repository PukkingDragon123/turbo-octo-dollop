// THE PARTYGOER — a clone in a party hat with a stitched ear-to-ear grin and a red balloon, standing
// stock-still among the furniture like it was left there after an office party. It only moves while
// nobody is looking at it. When it reaches you from behind it SNATCHES whatever you are holding and
// runs off with it, giggling (it drags camp loot away the same way). Hit it and it drops the loot.
import * as THREE from 'three';
import { Agent } from './agent.js';
import { RNG } from '../../core/rng.js';
import { net } from '../../net/net.js';

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();

export class PartygoerAI extends Agent {
  constructor(mgr, id, pos) {
    super(mgr, id, 'partygoer', pos, 0.42, 0.3);
    this.rng = new RNG(id * 2711 + 13);
    this.state = 'pose';
    this.hp = 2;
    this.unseenT = 0;
    this.cooldown = 4;
    this.carry = null;    // prop id being run off with
    this.victim = null;
    this.runFrom = new THREE.Vector3();
    this.stunT = 0;
    this.giggleT = 8 + this.rng.range(0, 10);
    this.intensity = 0.3;
  }

  get idleState() { return 'pose'; }

  update(dt) {
    const mgr = this.mgr;
    this.stateT += dt;
    this.cooldown -= dt;
    if (this.zoneReact(dt)) return;
    if (this.stunT > 0) {
      this.stunT -= dt;
      this.frozen = true;
      this.vel.set(0, 0, 0);
      this.integrate(dt);
      return;
    }
    const day = mgr.game.day.day;
    const near = this.nearestPlayer(30);
    const nd = this._nearD;
    _v.copy(this.pos).setY(1.0);
    let watched = false;
    for (const p of mgr.alivePlayers()) if (mgr.isWatchedBy(p, _v, 0.7)) { watched = true; break; }
    this.frozen = false;
    this.intensity = this.state === 'follow' ? 0.7 : this.state === 'run' ? 1 : 0.3;

    if (this.raid && this.state !== 'run' && this.state !== 'snatch') {
      if (watched) { this.frozen = true; this.vel.set(0, 0, 0); this.integrate(dt); return; }
      this.raidUpdate(dt, 3.4, { knocks: 1, dragMax: 30 });
      this.integrate(dt);
      return;
    }

    switch (this.state) {
      case 'pose': {
        this.vel.multiplyScalar(0.6);
        this.frozen = true;
        if (near) this.lookAt(near.pos, 1.3); else this.look = null;
        if (near && nd < 20 && !watched) {
          this.unseenT += dt;
          if (this.unseenT > 1.4) this.setState('follow');
        } else this.unseenT = 0;
        break;
      }
      case 'follow': {
        if (!near || nd > 26) { this.setState('pose'); break; }
        this.lookAt(near.pos, 1.3);
        if (watched) {
          // caught: freezes mid-step
          this.frozen = true;
          this.vel.set(0, 0, 0);
        } else {
          this.moveTo(dt, near.pos, 3.4 + day * 0.12);
          if (nd < 1.35 && this.cooldown <= 0) {
            this.setState('snatch');
            this.victim = near;
            this.attackT = 0;
            this.hit = false;
          }
        }
        break;
      }
      case 'snatch': {
        this.attackT = Math.min(1, this.attackT + dt / 0.55);
        this.vel.multiplyScalar(0.5);
        if (this.victim) this.faceToward(this.victim.pos, dt, 12);
        if (this.attackT >= 0.4 && !this.hit) {
          this.hit = true;
          mgr.sound('party_horn', this.pos, 1);
          const v = this.victim;
          if (v && !v.dead && !v.safe && v.pos.distanceTo(this.pos) < 2.2) {
            // ask the victim's client to hand over what it is holding (see MonsterManager._onYoink)
            if (v.id === net.selfId) mgr._onYoink({ mon: this.id });
            else net.toPeer(v.id, 'yoink', { mon: this.id });
          }
        }
        if (this.attackT >= 1) {
          this.cooldown = 9;
          if (this.carry == null) this.setState('follow');
        }
        break;
      }
      case 'run': {
        const p = this.carry != null ? this.world.props.get(this.carry) : null;
        if (!p || p.dead || p.isHeld() || !p.body) { this._drop(); this.setState('pose'); break; }
        // run away from whoever is nearest, hauling the loot behind
        const from = near ? near.pos : this.runFrom;
        _f.set(this.pos.x - from.x, 0, this.pos.z - from.z);
        if (_f.lengthSq() < 0.01) _f.set(1, 0, 0);
        _f.normalize().multiplyScalar(6).add(this.pos);
        this.moveTo(dt, _f, 4.6);
        _f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        _v.copy(this.pos).addScaledVector(_f, -0.7).setY(0.6);
        this._haul(p, _v, dt);
        this.look = null;
        this.giggleT -= dt * 3;
        if (this.stateT > 9 || (near && nd > 22)) { this._drop(); this.setState('pose'); }
        break;
      }
      default: this.setState('pose');
    }
    this.giggleT -= dt;
    if (this.giggleT <= 0) { this.giggleT = 10 + this.rng.range(0, 14); mgr.sound('party_giggle', this.pos, this.state === 'pose' ? 0.5 : 0.8); }
    if (this.state !== 'snatch') this.attackT = Math.max(0, this.attackT - dt * 2);
    this.integrate(dt);
  }

  // host: the victim's item arrived as a prop in our hands
  carryProp(prop) {
    this.carry = prop.id;
    this.runFrom.copy(this.victim?.pos || this.pos);
    this.setState('run');
    this.mgr.sound('party_giggle', this.pos, 1);
  }

  _drop() { this.carry = null; }

  // combat.js reaction hook (damage / death are handled there)
  onHurt(dir) {
    this.vel.addScaledVector(dir, 4);
    this._drop();
    this.stunT = 0.8;
    if (this.raid) this.endRaid();
    this.setState('pose');
    this.cooldown = 6;
    this.mgr.sound('party_giggle', this.pos, 1);
  }

  onFlash() { this.stunT = 2.5; this.vel.set(0, 0, 0); }

  dispose() { this._drop(); super.dispose(); }
}
