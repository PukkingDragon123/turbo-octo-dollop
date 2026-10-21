// Backrooms fauna (host AI on the shared Agent base; models in entities/monsters/fauna_models.js).
//  MOLE      passive. A mole that tunnelled into Level 0 and mutated: star-nose of pink feelers, milky eyes, huge
//            claws. Snuffles over the carpet, bolts from footsteps / light / noise and BURROWS under the carpet
//            (a hump racing away). Killable, drops raw meat. Tame it by leaving fungus for it (three meals).
//  MOTH      passive drifter. A pale cat-sized moth that grazes fungus and circles any light. Tame it with a lit
//            glowstick / flare on the ground (it orbits it until it bonds with you).
//  DAMP CRAWLER  hostile, damp zones only. A many-armed tangle of mutated flesh that lies twitching in puddles,
//            then skitters at you and PINS you down (BREAK FREE QTE). Hates a flashlight in its face.
//  FUNGAL    hostile, slow, very tough. A black fungus-formed thing the shape of a man. Its spores eat sanity;
//            it slams and engulfs; fire hurts it double, flares keep it back.
// Tamed animals follow their tamer, idle at camp and squeal when something hostile comes near.
import * as THREE from 'three';
import { Agent } from './agent.js';
import { HOSTILE } from './combat.js';
import { net } from '../../net/net.js';
import { RNG } from '../../core/rng.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
export const FUNGI = ['fungus_black', 'fungus_glow', 'fungus_shelf', 'fungus_puff'];
const isFungus = (t) => t.startsWith('fungus_');
const DIG_LOOT = ['battery', 'screws', 'fungus_shelf', 'tape_roll', 'almond_water', 'metal_scrap', 'fungus_glow', 'wire_spool'];

class FaunaAI extends Agent {
  constructor(mgr, id, type, pos, halfH, radius, seed) {
    super(mgr, id, type, pos, halfH, radius);
    this.rng = new RNG(id * 7717 + seed);
    this.goal = null;
    this.cooldown = 0;
    this.tameP = 0;
    this.tamer = null;
    this.warnT = 0;
    this.thinkT = 0;
    this.intensity = 0.2;
  }

  _wander(dt, speed, cells = 3) {
    if (!this.goal || this.pos.distanceTo(this.goal) < 0.8 || this.stateT > 14) {
      const p = this.mgr.level.nav.randomNear(this.pos.x, this.pos.z, 1 + this.rng.int(0, cells), () => this.rng.next());
      this.goal = (this.goal || new THREE.Vector3()).set(p[0] + this.rng.range(-0.8, 0.8), 0, p[1] + this.rng.range(-0.8, 0.8));
      this.stateT = 0;
    }
    return this.moveTo(dt, this.goal, speed);
  }

  _away(from, dist = 7) {
    _v.set(this.pos.x - from.x, 0, this.pos.z - from.z);
    if (_v.lengthSq() < 0.01) _v.set(this.rng.range(-1, 1), 0, this.rng.range(-1, 1));
    _v.normalize().multiplyScalar(dist).add(this.pos);
    const p = this.mgr.level.nav.randomNear(_v.x, _v.z, 1, () => this.rng.next());
    return (this._awayV || (this._awayV = new THREE.Vector3())).set(p[0], 0, p[1]);
  }

  nearestHostile(r) {
    let best = null, bd = r;
    for (const a of this.mgr.agents.values()) {
      if (a === this || a.dead || !HOSTILE.has(a.type)) continue;
      const d = a.pos.distanceTo(this.pos);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  findProp(r, test) {
    let best = null, bd = r * r;
    this.world.props.query(this.pos, r, (p) => {
      if (p.dead || p.isHeld() || !test(p)) return;
      const d = p.root.position.distanceToSquared(this.pos);
      if (d < bd) { bd = d; best = p; }
    });
    return best;
  }

  bond(pl, label) {
    if (!pl) return;
    this.tamer = pl.id;
    this.tameP = 1;
    this.mgr.sound(this.type === 'mole' ? 'mole_squeak' : 'moth_flutter', this.pos, 1);
    net.toPeer(pl.id, 'petBond', { t: this.type, label });
    this.mgr.game.onTame?.(this.type, pl.id);
  }

  // tamed behaviour; returns true if it handled the frame
  petUpdate(dt, speed) {
    if (!this.tamer) return false;
    const mgr = this.mgr;
    const pl = mgr.alivePlayers().find((p) => p.id === this.tamer);
    const camp = mgr.camp();
    this.warnT -= dt;
    const threat = this.nearestHostile(14);
    if (threat) {
      this.setState('warn');
      this.faceToward(threat.pos, dt, 8);
      this.lookAt(threat.pos, 1);
      this.vel.multiplyScalar(0.8);
      if (this.warnT <= 0) {
        this.warnT = 2.6;
        mgr.sound(this.type === 'mole' ? 'mole_alarm' : 'moth_flutter', this.pos, 1);
        if (pl) net.toPeer(pl.id, 'petWarn', { t: this.type, d: Math.round(threat.pos.distanceTo(this.pos)) });
      }
      this.intensity = 1;
      return true;
    }
    this.intensity = 0.3;
    const atCamp = camp && (!pl || pl.pos.distanceTo(camp.pos) < camp.radius + 3);
    if (atCamp) {
      this.setState('idle');
      if (this.pos.distanceTo(camp.pos) > camp.radius + 1) this.moveTo(dt, camp.pos, speed);
      else if (this.rng.chance(dt * 0.3) || this.goal) {
        if (!this.goal || this.pos.distanceTo(this.goal) < 0.5) this.goal = (this.goal || new THREE.Vector3()).set(camp.pos.x + this.rng.range(-2, 2), 0, camp.pos.z + this.rng.range(-2, 2));
        this.moveTo(dt, this.goal, speed * 0.3);
      } else this.vel.multiplyScalar(0.85);
      return true;
    }
    if (!pl) { this.vel.multiplyScalar(0.85); return true; }
    const d = pl.pos.distanceTo(this.pos);
    if (d > 3) { this.setState('follow'); this.moveTo(dt, pl.pos, Math.min(speed * 1.6, 1 + d * 0.8)); } else {
      this.setState('idle');
      this.vel.multiplyScalar(0.85);
      this.lookAt(pl.pos, pl.pos.y + 1.2);
    }
    return true;
  }
}

// ============================================================================ mole
export class MoleAI extends FaunaAI {
  constructor(mgr, id, pos) {
    super(mgr, id, 'mole', pos, 0.06, 0.16, 11);
    this.state = 'graze';
    this.burrowed = false;
    this.fleeFrom = new THREE.Vector3();
    this.food = null;
    this.digT = 60 + this.rng.range(0, 60);
    this.noiseT = 0;
    this.sniffT = 0;
  }

  get idleState() { return 'graze'; }

  _carpet() { const c = this.mgr.level.cell?.(this.pos.x, this.pos.z); return !c || c.floor !== 'concrete'; }

  update(dt) {
    const mgr = this.mgr;
    this.stateT += dt;
    this.cooldown -= dt;
    if (this.zoneReact(dt)) return;
    this.thinkT -= dt;
    // tamed: follows its clone, idles at camp, digs things up now and then
    if (this.tamer && this.state !== 'eat') {
      this.burrowed = false;
      if (this.state !== 'warn') {
        this.digT -= dt;
        if (this.digT <= 0) {
          this.digT = 80 + this.rng.range(0, 60);
          const t = this.rng.pick(DIG_LOOT);
          this.world.props.spawn(t, this.pos.clone().setY(0.25), new THREE.Quaternion(), { vel: new THREE.Vector3(0, 1.6, 0) });
          this.world.fxAll({ k: 'dust', p: this.pos.clone().setY(0.1).toArray(), n: 14, c: [0.55, 0.45, 0.3] });
          mgr.sound('mole_dig', this.pos, 0.9);
        }
      }
      if (this.petUpdate(dt, 2.2)) { this.integrate(dt); this._snd(dt); return; }
    }
    // ---- perception ----
    let threat = null, td = 1e9;
    const scare = 4.6 * (1 - this.tameP * 0.75);
    for (const pl of mgr.alivePlayers()) {
      const d = pl.pos.distanceTo(this.pos);
      const lit = pl.flash && d < 7 && mgr.isWatchedBy(pl, _v.copy(this.pos).setY(0.2), 0.93);
      if ((d < scare || lit) && d < td) { threat = pl.pos; td = d; }
    }
    const heard = this.hear(1.1, this.noiseT);
    this.noiseT = this.world.noise.time - 0.1;
    if (!threat && heard && heard.score > 3 && this.tameP < 0.3) threat = heard.event.pos;
    const hostile = this.nearestHostile(6);
    if (hostile) threat = hostile.pos;
    if (threat && this.state !== 'flee' && this.state !== 'dig' && this.state !== 'burrow') {
      this.fleeFrom.copy(threat);
      this.setState('flee');
      this.food = null;
      mgr.sound('mole_squeak', this.pos, 0.8);
    }
    switch (this.state) {
      case 'graze': {
        this.burrowed = false;
        this._wander(dt, 0.45, 2);
        this.look = null;
        // smell food (fungus) nearby
        if (this.thinkT <= 0) {
          this.thinkT = 0.6;
          const f = this.findProp(5, (p) => isFungus(p.type));
          if (f) { this.food = f.id; this.setState('seek'); }
        }
        if (this.stateT > 6 && this.rng.chance(dt * 0.15)) this.setState('sniff');
        break;
      }
      case 'sniff': {
        this.vel.multiplyScalar(0.8);
        if (this.stateT > 2 + this.rng.range(0, 1)) this.setState('graze');
        break;
      }
      case 'seek': {
        const f = this.food != null ? this.world.props.get(this.food) : null;
        if (!f || f.dead || f.isHeld()) { this.food = null; this.setState('graze'); break; }
        const d = this.moveTo(dt, f.root.position, 1.0);
        this.lookAt(f.root.position);
        if (d < 0.45) this.setState('eat');
        if (this.stateT > 12) this.setState('graze');
        break;
      }
      case 'eat': {
        this.vel.multiplyScalar(0.7);
        const f = this.food != null ? this.world.props.get(this.food) : null;
        if (!f || f.dead || f.isHeld()) { this.food = null; this.setState(this.tamer ? 'follow' : 'graze'); break; }
        this.lookAt(f.root.position);
        if (this.rng.chance(dt * 3)) mgr.sound('eat', this.pos, 0.4);
        if (this.stateT > 2.4) {
          this.world.props.despawn(f.id);
          this.food = null;
          this.tameP = Math.min(1, this.tameP + 0.34);
          mgr.sound('mole_squeak', this.pos, 0.7);
          if (this.tameP >= 1 && !this.tamer) {
            let best = null, bd = 30;
            for (const p of mgr.alivePlayers()) { const d = p.pos.distanceTo(this.pos); if (d < bd) { bd = d; best = p; } }
            this.bond(best, 'MOLE');
          }
          this.setState(this.tamer ? 'follow' : 'graze');
        }
        break;
      }
      case 'flee': {
        this.moveTo(dt, this._away(this.fleeFrom, 6), 3.6);
        this.look = null;
        if (this.stateT > 1.2) this.setState(this._carpet() ? 'dig' : 'hide');
        break;
      }
      case 'hide': {
        this.moveTo(dt, this._away(this.fleeFrom, 8), 3.2);
        if (this.stateT > 3) this.setState('graze');
        break;
      }
      case 'dig': {
        this.vel.multiplyScalar(0.6);
        if (this.stateT > 0.9) {
          this.burrowed = true;
          this.setState('burrow');
          this.goal = this._away(this.fleeFrom, 10).clone();
          this.world.fxAll({ k: 'dust', p: this.pos.clone().setY(0.08).toArray(), n: 12, c: [0.6, 0.52, 0.32] });
          mgr.sound('mole_dig', this.pos, 0.9);
        }
        break;
      }
      case 'burrow': {
        this.burrowed = true;
        const d = this.moveTo(dt, this.goal, 2.4);
        if (this.rng.chance(dt * 1.5)) mgr.sound('mole_dig', this.pos, 0.45);
        if (d < 0.8 || this.stateT > 7) this.setState('surface');
        break;
      }
      case 'surface': {
        this.vel.multiplyScalar(0.6);
        if (this.stateT > 0.7) { this.burrowed = false; this.setState('graze'); }
        break;
      }
      default: this.setState('graze');
    }
    this.integrate(dt);
    this._snd(dt);
  }

  _snd(dt) {
    this.sniffT -= dt;
    if (this.sniffT <= 0) { this.sniffT = 4 + this.rng.range(0, 6); if (!this.burrowed) this.mgr.sound('mole_squeak', this.pos, 0.3); }
  }

  onHurt(dir) {
    this.burrowed = false;
    if (this.tamer) { this.tamer = null; this.tameP = 0; } // betrayal
    this.fleeFrom.copy(this.pos).addScaledVector(dir, -2);
    this.setState('flee');
    this.mgr.sound('mole_squeak', this.pos, 1);
  }

  onRecover() { this.setState('flee'); }
  onFlash(p) { if (!this.tamer) { this.fleeFrom.copy(p); this.setState('flee'); } }
}

// ============================================================================ moth
export class MothAI extends FaunaAI {
  constructor(mgr, id, pos) {
    super(mgr, id, 'moth', pos, 0.05, 0.14, 23);
    this.state = 'drift';
    this.flyY = 1.6 + this.rng.range(0, 0.6);
    this.orbitA = this.rng.next() * 6.28;
    this.light = null;
    this.flapT = 0;
  }

  get idleState() { return 'drift'; }

  update(dt) {
    const mgr = this.mgr;
    this.stateT += dt;
    if (this.zoneReact(dt)) return;
    this.thinkT -= dt;
    this.orbitA += dt * (this.state === 'warn' ? 4.5 : 1.6);
    let wantY = 1.7 + Math.sin(this.stateT * 1.3 + this.id) * 0.25;
    if (this.tamer) {
      const pl = mgr.alivePlayers().find((p) => p.id === this.tamer);
      if (this.petUpdate(dt, 1.8)) {
        // flutter around the tamer's head / circle the camp lamp
        if (pl && this.state !== 'idle') wantY = 1.5 + Math.sin(this.orbitA * 2) * 0.15;
        this.flyY += (wantY - this.flyY) * Math.min(1, dt * 2);
        this._flutter(dt);
        this.integrate(dt);
        return;
      }
    }
    if (this.thinkT <= 0) {
      this.thinkT = 0.5;
      this.light = this.findProp(8, (p) => (p.type === 'glowstick' || p.type === 'flare' || p.type === 'camp_lamp') && (p.state.lit || p.type === 'camp_lamp'));
      if (!this.light && this.state !== 'flee') {
        // a flashlight beam pulls it in too (but never tames it)
        let beam = null;
        for (const pl of mgr.alivePlayers()) if (pl.flash && pl.pos.distanceTo(this.pos) < 7) beam = pl;
        this.beam = beam;
        if (!beam && this.state !== 'graze' && this.rng.chance(0.08)) {
          const f = this.findProp(5, (p) => isFungus(p.type));
          if (f) { this.food = f.id; this.setState('graze'); }
        }
      }
    }
    switch (this.state) {
      case 'flee': {
        this.moveTo(dt, this._away(this.fleeFrom || this.pos, 8), 3.2);
        wantY = 2.3;
        if (this.stateT > 3) this.setState('drift');
        break;
      }
      case 'graze': {
        const f = this.food != null ? this.world.props.get(this.food) : null;
        if (!f || f.dead || f.isHeld() || this.stateT > 9 || this.light) { this.setState('drift'); break; }
        const d = this.moveTo(dt, f.root.position, 0.9);
        if (d < 0.4) { wantY = Math.max(0.12, f.root.position.y + 0.06); this.vel.multiplyScalar(0.7); }
        break;
      }
      default: {
        const lp = this.light ? this.light.root.position : this.beam ? this.beam.pos : null;
        if (lp) {
          this.setState('orbit');
          const R = this.light ? 0.8 : 1.3;
          _w.set(lp.x + Math.cos(this.orbitA) * R, 0, lp.z + Math.sin(this.orbitA) * R);
          this.moveTo(dt, _w, 1.6);
          wantY = this.light ? Math.max(0.5, lp.y + 0.6) : 1.9;
          if (this.light) {
            this.tameP += dt / 11;
            if (this.tameP >= 1) {
              let best = null, bd = 20;
              for (const p of mgr.alivePlayers()) { const d = p.pos.distanceTo(this.pos); if (d < bd) { bd = d; best = p; } }
              if (best) this.bond(best, 'MOTH');
              else this.tameP = 0.9;
            }
          }
        } else {
          if (this.state === 'orbit') this.setState('drift');
          this._wander(dt, 0.7, 3);
        }
      }
    }
    this.flyY += (wantY - this.flyY) * Math.min(1, dt * 1.5);
    this._flutter(dt);
    this.integrate(dt);
  }

  _flutter(dt) {
    // erratic moth flight
    this.vel.x += (this.rng.next() - 0.5) * dt * 10;
    this.vel.z += (this.rng.next() - 0.5) * dt * 10;
    this.flyY += (this.rng.next() - 0.5) * dt * 1.2;
    this.flapT -= dt;
    if (this.flapT <= 0) { this.flapT = 3 + this.rng.range(0, 4); this.mgr.sound('moth_flutter', _v.copy(this.pos).setY(this.flyY), 0.35); }
  }

  onHurt(dir) {
    if (this.tamer) { this.tamer = null; this.tameP = 0; }
    this.fleeFrom = this.pos.clone().addScaledVector(dir, -2);
    this.setState('flee');
  }

  onRecover() { this.setState('flee'); this.fleeFrom = this.pos.clone(); }
  onFlash() { /* drawn to it */ }
}

// ============================================================================ damp crawler
export class DampCrawlerAI extends FaunaAI {
  constructor(mgr, id, pos) {
    super(mgr, id, 'dcrawler', pos, 0.12, 0.42, 37);
    this.state = 'lurk';
    this.target = null;
    this.noiseT = 0;
    this.recoilT = 0;
    this.chitT = 2;
    this.zig = this.rng.chance(0.5) ? 1 : -1;
  }

  get idleState() { return 'lurk'; }

  update(dt) {
    const mgr = this.mgr;
    this.stateT += dt;
    this.cooldown -= dt;
    this.recoilT -= dt;
    if (this.zoneReact(dt)) return;
    const day = mgr.game.day.day;
    const aggro = Math.min(1, 0.3 + day * 0.1);
    let seen = null, sd = 1e9, lit = false;
    for (const pl of mgr.alivePlayers()) {
      if (pl.safe) continue;
      const d = pl.pos.distanceTo(this.pos);
      if (d > 14) continue;
      if (pl.flash && d < 10 && mgr.isWatchedBy(pl, _v.copy(this.pos).setY(0.4), 0.92)) lit = true;
      if (!this.world.physics.lineOfSight(_v.copy(this.pos).setY(0.5), _w.copy(pl.pos).setY(pl.pos.y + 0.8))) continue;
      if (d < sd) { sd = d; seen = pl; }
    }
    const heard = this.hear(1.2, this.noiseT);
    this.noiseT = this.world.noise.time - 0.1;
    if (seen) this.target = seen;
    this.intensity = this.state === 'rush' ? 1 : this.state === 'stalk' ? 0.6 : 0.25;
    if (this.raid) {
      if (seen) this.endRaid(); else { this.raidUpdate(dt, 3.4, { knocks: 3, dragMax: 25 }); this.integrate(dt); return; }
    }
    // a flashlight in its many eyes makes it rear back for a moment
    if (lit && this.recoilT < -3 && (this.state === 'rush' || this.state === 'stalk')) {
      this.recoilT = 0.7;
      mgr.sound('crawler_screech', this.pos, 0.9);
    }
    if (this.recoilT > 0) { this.vel.multiplyScalar(0.7); this.attackT = 0.3; this.integrate(dt); return; }
    switch (this.state) {
      case 'lurk': {
        this.vel.multiplyScalar(0.8);
        this.look = null;
        if (seen && sd < 9) this.setState(sd < 5 ? 'rush' : 'stalk');
        else if (heard && heard.score > 1.5) { this.goal = heard.event.pos.clone().setY(0); this.setState('stalk'); }
        else if (this.stateT > 12 + this.rng.range(0, 10)) this.setState('creep');
        break;
      }
      case 'creep': {
        // shift to another puddle
        this._wander(dt, 0.8, 2);
        if (seen && sd < 9) this.setState('stalk');
        if (this.stateT > 6) this.setState('lurk');
        break;
      }
      case 'stalk': {
        const tp = seen ? seen.pos : this.goal;
        if (!tp) { this.setState('lurk'); break; }
        const d = this.moveTo(dt, tp, 1.4 + aggro * 0.6);
        this.lookAt(tp, 0.6);
        if (seen && sd < 6) { this.setState('rush'); mgr.sound('crawler_screech', this.pos, 1); }
        else if (!seen && (d < 1.2 || this.stateT > 12)) this.setState('lurk');
        break;
      }
      case 'rush': {
        const t = this.target;
        if (!t || t.dead || t.safe) { this.setState('lurk'); break; }
        // zig-zag skitter
        const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z, dl = Math.hypot(dx, dz) || 1;
        const side = Math.sin(this.stateT * 5) * this.zig * Math.min(1, dl / 4);
        _w.set(t.pos.x - (dz / dl) * side * 1.2, 0, t.pos.z + (dx / dl) * side * 1.2);
        const d = this.moveTo(dt, dl < 2 ? t.pos : _w, (lit ? 3.4 : 5.2) + aggro);
        this.lookAt(t.pos, t.pos.y + 0.6);
        if (d < 1.35 && this.cooldown <= 0) {
          this.cooldown = 2.6;
          this.attackT = 1;
          const grabbed = mgr.combat.tryGrab(this, t, { dmg: 22 + aggro * 8, chip: 3, kind: 'bite', cause: 'a Damp Crawler', title: 'SHAKE IT OFF', dur: 2.4, snd: 'crawler_screech' });
          if (!grabbed) { mgr.damagePlayer(t, 14, 'bite', this.pos, 'a Damp Crawler'); this.setState('retreat'); }
        }
        if (!seen && this.stateT > 4) this.setState('stalk');
        break;
      }
      case 'retreat': {
        const t = this.target;
        this.moveTo(dt, t ? this._away(t.pos, 5) : this.pos, 3);
        if (this.stateT > 1.8) this.setState(seen ? 'rush' : 'lurk');
        break;
      }
      default: this.setState('lurk');
    }
    this.attackT = Math.max(0, this.attackT - dt * 1.6);
    this.integrate(dt);
    this.chitT -= dt;
    if (this.chitT <= 0) { this.chitT = 2 + this.rng.range(0, 4); mgr.sound('crawler_chitter', this.pos, this.state === 'rush' ? 1 : 0.6); }
  }

  onGrabDone() { this.setState('retreat'); }
  onHurt(dir) { this.vel.addScaledVector(dir, 2); if (this.state === 'lurk' || this.state === 'creep') this.setState('rush'); this.mgr.sound('crawler_screech', this.pos, 0.9); }
  onRecover() { this.setState('rush'); }
  onFlash() { this.recoilT = 1.4; this.mgr.sound('crawler_screech', this.pos, 1); }
}

// ============================================================================ fungal
export class FungalAI extends FaunaAI {
  constructor(mgr, id, pos) {
    super(mgr, id, 'fungal', pos, 0.75, 0.36, 53);
    this.state = 'drift';
    this.target = null;
    this.sporeT = 6;
    this.auraT = 1;
    this.noiseT = 0;
    this.groanT = 4;
    this.hit = false;
  }

  get idleState() { return 'drift'; }

  update(dt) {
    const mgr = this.mgr;
    this.stateT += dt;
    this.cooldown -= dt;
    if (this.zoneReact(dt)) return;
    let near = null, nd = 1e9;
    for (const pl of mgr.alivePlayers()) {
      if (pl.safe) continue;
      const d = pl.pos.distanceTo(this.pos);
      if (d < nd) { nd = d; near = pl; }
    }
    const heard = this.hear(0.8, this.noiseT);
    this.noiseT = this.world.noise.time - 0.1;
    // fire keeps it back
    const flare = mgr.nearestLight(this.pos, 3.5);
    if (flare && this.state !== 'recoil') { this.setState('recoil'); this.fleeFrom = flare.clone(); mgr.sound('fungal_groan', this.pos, 1); }
    // spore aura (sanity) + periodic bursts
    this.auraT -= dt;
    if (this.auraT <= 0) {
      this.auraT = 1;
      for (const pl of mgr.alivePlayers()) {
        const d = pl.pos.distanceTo(this.pos);
        if (d < 3.2 && !pl.safe) net.toPeer(pl.id, 'spores', { s: 1.6 });
      }
    }
    this.sporeT -= dt;
    if (this.sporeT <= 0 && near && nd < 7) {
      this.sporeT = 8 + this.rng.range(0, 5);
      this.world.fxAll({ k: 'spores', p: this.pos.clone().setY(1.5).toArray() });
      mgr.sound('spore_puff', this.pos, 1);
      for (const pl of mgr.alivePlayers()) if (pl.pos.distanceTo(this.pos) < 4.8 && !pl.safe) net.toPeer(pl.id, 'spores', { s: 9, burst: 1 });
    }
    this.intensity = this.state === 'hunt' ? 0.8 : 0.3;
    if (this.raid) { if (near && nd < 8) this.endRaid(); else { this.raidUpdate(dt, 1.4, { knocks: 2, dragMax: 40 }); this.integrate(dt); return; } }
    switch (this.state) {
      case 'drift': {
        this._wander(dt, 0.55, 2);
        this.look = null;
        if (near && nd < 15 && this.world.physics.lineOfSight(_v.copy(this.pos).setY(1.6), _w.copy(near.pos).setY(near.pos.y + 1))) { this.target = near; this.setState('hunt'); }
        else if (heard && heard.score > 2) { this.goal = heard.event.pos.clone().setY(0); }
        break;
      }
      case 'hunt': {
        const t = this.target;
        if (!t || t.dead || t.safe || t.pos.distanceTo(this.pos) > 22) { this.setState('drift'); break; }
        const d = this.moveTo(dt, t.pos, 1.25 + mgr.game.day.day * 0.06);
        this.lookAt(t.pos, t.pos.y + 1.1);
        if (d < 1.6 && this.cooldown <= 0) {
          this.cooldown = 3.2;
          if (this.rng.chance(0.4) && mgr.combat.tryGrab(this, t, { dmg: 20, chip: 2, san: 14, kind: 'blunt', cause: 'the Fungal', title: 'TEAR FREE', dur: 2.8, snd: 'fungal_groan' })) break;
          this.setState('slam'); this.attackT = 0; this.hit = false;
        }
        break;
      }
      case 'slam': {
        this.attackT = Math.min(1, this.attackT + dt / 1.1);
        this.vel.multiplyScalar(0.6);
        if (this.target) this.faceToward(this.target.pos, dt, 6);
        if (this.attackT > 0.55 && !this.hit) {
          this.hit = true;
          const t = this.target;
          if (t && !t.dead && !t.safe && t.pos.distanceTo(this.pos) < 2.1) mgr.damagePlayer(t, 22, 'blunt', this.pos, 'the Fungal', { sanity: 6 });
          this.world.fxAll({ k: 'spores', p: this.pos.clone().setY(0.6).toArray(), n: 0.5 });
        }
        if (this.attackT >= 1) this.setState('hunt');
        break;
      }
      case 'recoil': {
        this.moveTo(dt, this._away(this.fleeFrom || this.pos, 5), 1.6);
        if (this.stateT > 3) this.setState('drift');
        break;
      }
      default: this.setState('drift');
    }
    if (this.state !== 'slam') this.attackT = Math.max(0, this.attackT - dt * 1.5);
    this.integrate(dt);
    this.groanT -= dt;
    if (this.groanT <= 0) { this.groanT = 5 + this.rng.range(0, 6); mgr.sound('fungal_groan', this.pos, 0.6); }
  }

  onRecover() { this.setState('hunt'); }
  onFlash() { /* it has no eyes */ }
}

export const FAUNA_AI = { mole: MoleAI, moth: MothAI, dcrawler: DampCrawlerAI, fungal: FungalAI };
