// Monsters: host-simulated AI, replicated as compact snapshots, rendered procedurally on peers.
//  - The Bacteria hunts by sound: it investigates noises (footsteps, impacts, generators, welding,
//    voices), stalks players at the edge of their flashlight, chases with terrifying speed,
//    smashes through barricades and retreats after a strike.
//  - Still Lifes: wrong-anatomy copies of clones. Watchers creep closer when unobserved,
//    crawlers skitter in the dark and flee light, twins giggle, masses lumber and attack.
//  - Hounds (creatures/hound.js) gallop at noise and bolt from light; Smilers (creatures/smiler.js)
//    hang in dark sectors and rush whoever stares at them; Partygoers (creatures/partygoer.js) only
//    move unobserved and snatch what you hold.
//  - Every creature respects distorter safe zones (world.safeZones) and, from Day 2 once the team has
//    a camp, periodically RAIDS it: knocks things over and drags loot away (see Agent.raidUpdate).
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { net } from '../net/net.js';
import { audio } from '../audio/audio.js';
import { BacteriaBody } from '../entities/monsters/bacteria_body.js';
import { buildStillLife } from '../entities/optional.js';
import { buildSmiler } from '../entities/monsters/smiler.js';
import { RAPIER, G, groups, Q } from '../physics/physics.js';
import { RNG } from '../core/rng.js';
import { CELL, HEIGHT } from '../world/levels/yellow/layout.js';
import { Agent, angleLerp, zoneAt } from './creatures/agent.js';
import { HoundAI } from './creatures/hound.js';
import { SmilerAI } from './creatures/smiler.js';
import { PartygoerAI } from './creatures/partygoer.js';
import { BaseSystems } from './basecamp.js';
import { isLitState } from './itemfx.js';
import { itemName } from './itemdefs.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _f = new THREE.Vector3();
const _c = new THREE.Color();
const _frustum = new THREE.Frustum();
const _m4 = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

// Day 1 is the probation day: nothing hunts you yet
const BACTERIA_BY_DAY = [0, 0, 1, 2, 2, 3, 3, 4];
const STILL_BY_DAY = [0, 0, 1, 2, 3, 4, 5, 6];
// newer creatures (land levels only); a solo clone gets a little less of them from Day 4
const HOUND_BY_DAY = [0, 0, 1, 1, 1, 2, 2, 3];
const SMILER_BY_DAY = [0, 0, 0, 1, 1, 1, 2, 2];
const PARTY_BY_DAY = [0, 0, 1, 1, 1, 1, 2, 2];
// camp raids: seconds between raids by day, raiders per raid
const RAID_GAP = [0, 0, 150, 130, 115, 100, 90, 75];
const RAIDERS = [0, 0, 1, 1, 2, 2, 2, 3];
const STAGE_RAIDS = new Set(['survive', 'sell', 'exit']);
const LABEL = { bacteria: 'THE BACTERIA', hound: 'HOUND', smiler: 'SMILER', partygoer: 'PARTYGOER' };

class BacteriaAI extends Agent {
  constructor(mgr, id, pos) {
    super(mgr, id, 'bacteria', pos, 0.75, 0.38);
    this.target = null;
    this.lastKnown = null;
    this.lostT = 0;
    this.noiseT = 0;
    this.cooldown = 0;
    this.smashTarget = null;
    this.smashT = 0;
    this.listenT = 0;
    this.rng = new RNG(id * 7919);
    this.goal = null;
    this.intensity = 0.3;
    this.screeched = false;
  }

  get idleState() { return 'roam'; }

  update(dt) {
    const mgr = this.mgr;
    const day = mgr.game.day.day;
    const aggro = Math.min(1, 0.25 + day * 0.11 + (mgr.level.depth - 1) * 0.1);
    this.intensity = this.state === 'chase' ? 1 : this.state === 'stalk' ? 0.6 : aggro * 0.5;
    this.stateT += dt;
    this.cooldown -= dt;
    if (this.zoneReact(dt)) return;
    const players = mgr.alivePlayers();
    // ---- perception (clones inside a distorter field are invisible to it) ----
    let seen = null, seenD = 1e9;
    const head = _v.copy(this.pos).setY(2.0);
    _f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    for (const pl of players) {
      if (pl.safe) continue;
      const chest = _v2.copy(pl.pos).setY(pl.pos.y + 0.8);
      const d = head.distanceTo(chest);
      if (d > 32) continue;
      const lum = pl.flash ? 1.2 : mgr.lightAt(pl.pos);
      const visDist = 5 + lum * 20 + (pl.flash ? 8 : 0);
      if (d > visDist) continue;
      const dx = chest.x - this.pos.x, dz = chest.z - this.pos.z, dl = Math.hypot(dx, dz) || 1;
      if (d > 4.5 && (dx * _f.x + dz * _f.z) / dl < -0.1) continue;
      if (!this.world.physics.lineOfSight(head, chest)) continue;
      if (d < seenD) { seen = pl; seenD = d; }
    }
    // hearing
    const heard = this.hear(0.9 + aggro * 0.6, this.noiseT);
    if (seen) {
      this.target = seen;
      this.lastKnown = (this.lastKnown || new THREE.Vector3()).copy(seen.pos);
      this.lostT = 0;
    } else this.lostT += dt;

    // ---- flee lit flares ----
    const flare = mgr.nearestFlare(this.pos, 4.5);
    if (flare && this.state !== 'flee') {
      this.setState('flee');
      this.fleeFrom = flare.clone();
      if (this.raid) this.endRaid();
      mgr.sound('bacteria_growl', this.pos, 0.8);
    }

    // ---- camp raid (abandoned the moment it spots a clone) ----
    if (this.raid && this.state !== 'flee') {
      if (seen) { this.raid = null; this.setState('chase'); }
      else {
        this.raidUpdate(dt, 2.6 + aggro, { knocks: 4, dragMax: 60 });
        this.noiseT = this.world.noise.time - 0.1;
        if (this.raidLabel !== 'smash') this.attackT = Math.max(0, this.attackT - dt * 2);
        this.integrate(dt);
        if (Math.random() < dt * 0.5) mgr.sound('bacteria_click', this.pos, 0.8);
        return;
      }
    }

    // ---- state machine ----
    switch (this.state) {
      case 'roam': {
        if (!this.goal || this.pos.distanceTo(this.goal) < 1.2 || this.stateT > 25) {
          const p = mgr.level.nav.randomNear(this.pos.x, this.pos.z, 3 + this.rng.int(0, 5), () => this.rng.next());
          this.goal = new THREE.Vector3(p[0], 0, p[1]);
          this.stateT = 0;
          if (this.rng.chance(0.35)) { this.setState('listen'); this.listenT = 2 + this.rng.range(0, 3); break; }
        }
        this.moveTo(dt, this.goal, 1.5 + aggro * 0.6);
        this.look = null;
        if (seen) this.setState(seenD > 10 && this.rng.chance(0.6) ? 'stalk' : 'chase');
        else if (heard && heard.score > 2) this._investigate(heard.event);
        break;
      }
      case 'listen': {
        this.vel.multiplyScalar(0.85);
        this.listenT -= dt;
        this.look = heard ? heard.event.pos : null;
        if (seen) this.setState('chase');
        else if (heard && heard.score > 1) this._investigate(heard.event);
        else if (this.listenT <= 0) this.setState('roam');
        break;
      }
      case 'investigate': {
        const d = this.moveTo(dt, this.goal, 2.4 + aggro * 1.4);
        this.look = this.goal.clone().setY(1);
        if (seen) this.setState(seenD > 11 && this.rng.chance(0.45) ? 'stalk' : 'chase');
        else if (heard && heard.score > 4 && heard.event.pos.distanceTo(this.goal) > 3) this._investigate(heard.event);
        else if (d < 1.5 || this.stateT > 20) { this.setState('listen'); this.listenT = 3 + this.rng.range(0, 2); }
        this._smashIfBlocked(dt);
        break;
      }
      case 'stalk': {
        if (!this.target || this.target.dead) { this.setState('roam'); break; }
        const tp = this.target.pos;
        const d = this.pos.distanceTo(tp);
        // keep 9-12 m away, freeze if watched
        const watched = mgr.isWatchedBy(this.target, this.pos.clone().setY(1.6));
        if (watched && this.stateT > 1) {
          this.vel.multiplyScalar(0.6);
          this.frozen = true;
          if (this.rng.chance(dt * 0.6)) { this.frozen = false; this.setState('chase'); }
        } else {
          this.frozen = false;
          if (d > 11) this.moveTo(dt, tp, 2.0 + aggro);
          else this.vel.multiplyScalar(0.85);
        }
        this.look = tp.clone().setY(1.1);
        if (d < 6.5 || this.stateT > 8 + this.rng.range(0, 8) * (1 - aggro)) { this.frozen = false; this.setState('chase'); }
        if (this.lostT > 6) this.setState('roam');
        break;
      }
      case 'chase': {
        if (!this.screeched) {
          this.screeched = true;
          mgr.sound('bacteria_screech', this.pos, 1);
          this.world.noise.emit(this.pos, 10, 'monster');
        }
        const tgt = this.lostT < 0.5 && this.target ? this.target.pos : this.lastKnown;
        if (!tgt) { this.setState('roam'); break; }
        const speed = 4.6 + aggro * 1.6 + (this.stateT < 1 ? 1 : 0);
        const d = this.moveTo(dt, tgt, speed);
        this.look = tgt.clone().setY(1.1);
        if (this.target && !this.target.dead && !this.target.safe && this.lostT < 0.5 && this.pos.distanceTo(this.target.pos) < 1.7 && this.cooldown <= 0) {
          this.setState('attack');
          this.attackT = 0;
          mgr.sound('bacteria_attack', this.pos, 1);
        } else if (this.lostT > 5 || (this.lostT > 0.5 && d < 1.2)) {
          this.screeched = false;
          this._investigate({ pos: this.lastKnown || this.pos.clone() });
        }
        if (this.target?.dead) { this.screeched = false; this.setState('roam'); }
        this._smashIfBlocked(dt);
        break;
      }
      case 'attack': {
        this.attackT = Math.min(1, this.attackT + dt / 0.75);
        this.vel.multiplyScalar(0.7);
        if (this.target) {
          const dx = this.target.pos.x - this.pos.x, dz = this.target.pos.z - this.pos.z;
          this.yaw = angleLerp(this.yaw, Math.atan2(-dx, -dz), Math.min(1, dt * 10));
        }
        if (this.attackT >= 0.55 && !this.hit) {
          this.hit = true;
          if (this.target && !this.target.dead && this.pos.distanceTo(this.target.pos) < 2.2) {
            mgr.damagePlayer(this.target, 34 + aggro * 14, 'slash', this.pos, 'the Bacteria');
            this.mgr.dropResidue(this.pos);
          }
        }
        if (this.attackT >= 1) {
          this.hit = false;
          this.cooldown = 2.4 - aggro;
          this.setState('retreat');
        }
        break;
      }
      case 'retreat': {
        const away = this.target ? this.pos.clone().sub(this.target.pos).setY(0).normalize().multiplyScalar(6).add(this.pos) : this.pos;
        this.moveTo(dt, away, 3.2);
        if (this.stateT > 2.5) { this.screeched = false; this.setState(this.rng.chance(0.5) ? 'stalk' : 'chase'); }
        break;
      }
      case 'flee': {
        const away = this.pos.clone().sub(this.fleeFrom || this.pos).setY(0).normalize().multiplyScalar(8).add(this.pos);
        this.moveTo(dt, away, 4);
        if (this.stateT > 3.5) this.setState('roam');
        break;
      }
      case 'stunned': {
        this.vel.multiplyScalar(0.8);
        if (this.stateT > 1.4) this.setState('chase');
        break;
      }
      case 'smash': {
        this.vel.multiplyScalar(0.6);
        const p = this.smashTarget ? this.world.props.get(this.smashTarget) : null;
        if (!p || p.dead || p.root.position.distanceTo(this.pos) > 3) { this.setState(this.prevState || 'chase'); break; }
        this.look = p.root.position.clone();
        this.smashT -= dt;
        if (this.smashT <= 0) {
          this.smashT = 0.9;
          this.attackT = 0.6;
          p.hp -= 30;
          mgr.sound('bacteria_attack', this.pos, 0.8);
          this.world.fxAll({ k: 'impact', m: p.material, p: p.root.position.toArray(), i: 1 });
          this.world.noise.emit(p.root.position, 22, 'smash');
          if (p.body) {
            _v.copy(p.root.position).sub(this.pos).setY(0.4).normalize().multiplyScalar(Math.min(60, p.body.mass() * 3 + 10));
            p.body.applyImpulse(_v, true);
          }
          if (p.hp <= 0) {
            this.mgr.game.tools.unweld(p);
            if (p.def.breakF || p.def.dismantle) this.world.breakProp(p);
            this.setState(this.prevState || 'chase');
          }
        }
        break;
      }
      default: this.setState('roam');
    }
    this.noiseT = this.world.noise.time - 0.1;
    if (this.state !== 'attack' && this.state !== 'smash') this.attackT = Math.max(0, this.attackT - dt * 2);
    this.integrate(dt);
    // clicks & breathing
    if (Math.random() < dt * (this.state === 'chase' ? 1.5 : 0.25)) mgr.sound('bacteria_click', this.pos, 0.8);
  }

  _investigate(ev) {
    this.goal = ev.pos.clone().setY(0);
    this.setState('investigate');
  }

  _smashIfBlocked() {
    if (this.stuckT < 1.0) return;
    _f.set(this.vel.x, 0, this.vel.z);
    if (_f.lengthSq() < 0.01) _f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _f.normalize();
    const hit = this.world.physics.raycast(_v.copy(this.pos).setY(0.9), _f, 1.6, Q.solid);
    if (hit?.ud?.kind === 'prop') {
      this.prevState = this.state === 'smash' ? 'chase' : this.state;
      this.smashTarget = hit.ud.prop.id;
      this.smashT = 0.3;
      this.setState('smash');
      this.mgr.sound('bacteria_growl', this.pos, 1);
    } else {
      this.path = null; // re-path around
    }
    this.stuckT = 0;
  }
}

class StillLifeAI extends Agent {
  constructor(mgr, id, pos, variant) {
    super(mgr, id, 'still', pos, variant === 'tall' ? 0.9 : variant === 'crawler' ? 0.15 : 0.4, variant === 'mass' ? 0.5 : 0.32);
    this.variant = variant;
    this.rng = new RNG(id * 31337);
    this.hp = variant === 'mass' ? 5 : 3;
    this.state = variant === 'watcher' || variant === 'tall' || variant === 'twin' ? 'idle' : 'roam';
    this.unseenT = 0;
    this.cooldown = 0;
    this.goal = null;
  }

  get idleState() { return this.variant === 'watcher' || this.variant === 'tall' || this.variant === 'twin' ? 'idle' : 'roam'; }

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
    const players = mgr.alivePlayers();
    let near = null, nd = 1e9;
    for (const p of players) { if (p.safe) continue; const d = p.pos.distanceTo(this.pos); if (d < nd) { nd = d; near = p; } }
    _v.copy(this.pos).setY(0.8);
    let watched = false, lit = false;
    for (const p of players) {
      if (!watched && mgr.isWatchedBy(p, _v)) watched = true;
      if (!lit && p.flash && p.pos.distanceTo(this.pos) < 14 && mgr.isWatchedBy(p, _v2.copy(this.pos).setY(0.6), 0.93)) lit = true;
    }
    if (near) this.lookAt(near.pos, 1.0); else this.look = null;
    this.frozen = false;
    switch (this.variant) {
      case 'watcher':
      case 'twin': {
        // moves only when nobody is looking
        if (watched) {
          this.frozen = true;
          this.vel.set(0, 0, 0);
          this.unseenT = 0;
        } else if (near && nd < 22) {
          this.unseenT += dt;
          if (this.unseenT > (this.variant === 'twin' ? 1.0 : 2.0)) this.moveTo(dt, near.pos, this.variant === 'twin' ? 2.2 : 3.4);
          if (nd < 1.3 && this.cooldown <= 0) {
            this.cooldown = 3;
            mgr.damagePlayer(near, this.variant === 'twin' ? 15 : 24, 'blunt', this.pos, 'a Still Life');
            mgr.sound('stilllife_scream', this.pos, 1);
            this.attackT = 1;
          }
        } else this.vel.multiplyScalar(0.8);
        if (this.variant === 'twin' && Math.random() < dt * 0.15) mgr.sound('stilllife_giggle', this.pos, 0.7);
        break;
      }
      case 'crawler': {
        if (lit) {
          // hates light: skitter away
          const away = this.pos.clone().sub(near.pos).setY(0).normalize().multiplyScalar(5).add(this.pos);
          this.moveTo(dt, away, 4.2);
          this.state = 'flee';
        } else if (near && nd < 16) {
          this.moveTo(dt, near.pos, 3.6);
          this.state = 'chase';
          if (nd < 1.2 && this.cooldown <= 0) {
            this.cooldown = 2.2;
            mgr.damagePlayer(near, 18, 'bite', this.pos, 'a Still Life');
            mgr.sound('stilllife_scream', this.pos, 0.9);
            this.attackT = 1;
          }
        } else {
          this.state = 'roam';
          this._wander(dt, 1.2);
        }
        if (Math.random() < dt * 0.4) mgr.sound('stilllife_crawl', this.pos, 0.6);
        break;
      }
      case 'mass': {
        if (near && nd < 10) {
          this.moveTo(dt, near.pos, 1.3);
          if (nd < 1.6 && this.cooldown <= 0) {
            this.cooldown = 2.5;
            mgr.damagePlayer(near, 22, 'slash', this.pos, 'a Still Life', { heavy: false });
            this.attackT = 1;
          }
        } else this._wander(dt, 0.8);
        break;
      }
      case 'tall': {
        // stands at a distance; walks away & vanishes when approached
        if (near && nd < 7) {
          const away = this.pos.clone().sub(near.pos).setY(0).normalize().multiplyScalar(6).add(this.pos);
          this.moveTo(dt, away, 1.6);
          if (nd < 4.5) this.vanish = true;
        } else this.vel.multiplyScalar(0.8);
        break;
      }
      default: break;
    }
    this.attackT = Math.max(0, this.attackT - dt * 1.5);
    this.integrate(dt);
  }

  _wander(dt, speed) {
    if (!this.goal || this.pos.distanceTo(this.goal) < 1 || this.stateT > 15) {
      const p = this.mgr.level.nav.randomNear(this.pos.x, this.pos.z, 2 + this.rng.int(0, 3), () => this.rng.next());
      this.goal = new THREE.Vector3(p[0], 0, p[1]);
      this.stateT = 0;
    }
    this.moveTo(dt, this.goal, speed);
  }
}

// ===========================================================================
// Client-side visuals
class MonsterView {
  constructor(mgr, snap) {
    this.mgr = mgr;
    this.id = snap.id;
    this.type = snap.t;
    this.variant = snap.v;
    this.buffer = [];
    this.pos = new THREE.Vector3().fromArray(snap.p);
    this.prevPos = this.pos.clone();
    this.yaw = snap.y;
    this.snap = snap;
    this.time = 0;
    this.dissolve = 1;
    this._look = new THREE.Vector3();
    this._vel = new THREE.Vector3();
    this._st = {};
    this.stepT = 0;
    if (this.type === 'bacteria') {
      this.body = new BacteriaBody(snap.id);
      this.root = this.body.root;
      this.body.onStep = (p, loud) => {
        audio.play('bacteria_step', { pos: p, intensity: loud, volume: 0.5 + loud * 0.6 });
        if (Math.random() < 0.08) mgr.dropResidueLocal(p);
      };
      this.presence = audio.loop('bacteria_presence', { pos: this.pos.clone().setY(1.6), volume: 0.9 });
    } else if (this.type === 'smiler') {
      this.sm = buildSmiler(snap.id);
      this.root = this.sm.root;
    } else {
      // Still Lifes, Hounds and Partygoers share the sculpted / skinned creature pipeline
      this.sl = buildStillLife(this.type === 'still' ? this.variant || 'watcher' : this.type, snap.id);
      this.root = this.sl.root;
    }
    this.root.position.copy(this.pos);
    mgr.world.group.add(this.root);
    mgr.world.registerDynamic(this.root);
    // collision proxy so the local player can't walk through monsters
    const r = this.type === 'bacteria' ? 0.38 : this.type === 'smiler' ? 0.24 : this.type === 'hound' ? 0.34 : this.sl?.radius || 0.35;
    const hh = this.type === 'bacteria' ? 0.75 : this.type === 'smiler' ? 0.5 : this.type === 'hound' ? 0.14 : Math.max(0.2, (this.sl?.height || 1.2) / 2 - r);
    this.colHalf = hh + r;
    this.collider = null;
    if (!net.isHost) {
      // (the host already has the AI agent's own collider)
      const desc = RAPIER.ColliderDesc.capsule(hh, r).setCollisionGroups(groups(G.MONSTER, G.PLAYER)).setTranslation(this.pos.x, this.pos.y + hh + r, this.pos.z);
      this.collider = mgr.world.physics.world.createCollider(desc);
      mgr.world.physics.setUserData(this.collider, { kind: 'monster', monster: this });
    }
  }

  push(snap, t) {
    this.buffer.push({ t, s: snap });
    if (this.buffer.length > 8) this.buffer.shift();
    this.snap = snap;
  }

  update(dt) {
    this.time += dt;
    const rt = this.time - 0.13;
    let a = null, b = null;
    for (let i = this.buffer.length - 1; i >= 0; i--) if (this.buffer[i].t <= rt) { a = this.buffer[i]; b = this.buffer[i + 1] || null; break; }
    if (!a) a = this.buffer[0];
    this.prevPos.copy(this.pos);
    if (a && b) {
      const k = THREE.MathUtils.clamp((rt - a.t) / Math.max(1e-4, b.t - a.t), 0, 1);
      this.pos.fromArray(a.s.p).lerp(_v.fromArray(b.s.p), k);
      this.yaw = angleLerp(a.s.y, b.s.y, k);
    } else if (a) {
      this.pos.lerp(_v.fromArray(a.s.p), Math.min(1, dt * 10));
      this.yaw = angleLerp(this.yaw, a.s.y, Math.min(1, dt * 10));
    }
    while (this.buffer.length > 3 && this.buffer[1].t < rt) this.buffer.shift();
    const vel = this._vel.subVectors(this.pos, this.prevPos).divideScalar(Math.max(dt, 1e-3));
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    const s = this.snap;
    const look = s.l ? this._look.fromArray(s.l) : null;
    const sp = Math.hypot(vel.x, vel.z);
    if (this.body) {
      const st = s.s === 'flinch' ? 'hurt' : s.s;
      this.body.update(dt, { velocity: vel, state: st, lookTarget: look, attackT: s.a, ceilingY: HEIGHT, intensity: s.i, frozen: !!s.f });
      this.presence?.setPosition(_v.copy(this.pos).setY(1.7));
      this.presence?.setParam?.('intensity', s.s === 'chase' ? 1 : 0.3);
      if (this.dissolve > 0) { this.dissolve = Math.max(0, this.dissolve - dt * 0.8); this.body.setDissolve?.(this.dissolve); }
    } else if (this.sm) {
      const st = this._st;
      st.state = s.s; st.intensity = s.i; st.attacking = s.a; st.lookTarget = look; st.frozen = !!s.f; st.speed = sp;
      this.sm.update(dt, st);
    } else if (this.sl) {
      const st = this._st;
      st.speed = sp; st.moving = sp > 0.1; st.attacking = s.a; st.lookTarget = look; st.frozen = !!s.f; st.mode = s.s; st.intensity = s.i;
      st.alert = s.s === 'chase' || s.s === 'hunt' || s.s === 'run' || s.s === 'pounce' || s.s === 'follow' ? 1 : s.s === 'flinch' || s.s === 'flee' ? 0.8 : 0.3;
      this.sl.update(dt, st);
      if (this.type === 'hound' && sp > 0.4) {
        // padding gallop: soft quick steps, louder at speed
        this.stepT -= dt * (1.2 + sp * 0.9);
        if (this.stepT <= 0) { this.stepT = 1; audio.play('hound_step', { pos: _v.copy(this.pos).setY(0.2), volume: Math.min(1, 0.25 + sp * 0.12), intensity: Math.min(1, sp / 6) }); }
      }
    }
    this.collider?.setTranslation({ x: this.pos.x, y: this.pos.y + this.colHalf, z: this.pos.z });
  }

  headPos(out) {
    if (this.body?.getHeadWorldPosition) return this.body.getHeadWorldPosition(out);
    if (this.sm) return out.copy(this.pos).setY(this.pos.y + 1.6);
    if (this.type === 'hound') return out.copy(this.pos).setY(this.pos.y + 0.6);
    return out.copy(this.pos).setY(this.pos.y + (this.sl?.height || 1.2) * 0.85);
  }

  dispose() {
    this.presence?.stop(0.4);
    this.mgr.world.unregisterDynamic(this.root);
    this.root.removeFromParent();
    this.root.userData.dispose?.(); // Still Life instance resources (shared geometry/materials stay cached)
    this.body?.dispose?.();
    this.sm?.dispose?.();
    if (this.collider) { try { this.mgr.world.physics.removeCollider(this.collider); } catch (e) { /* freed */ } }
  }
}

// ===========================================================================
export class MonsterManager {
  constructor(level) {
    this.level = level;
    this.world = level.world;
    this.game = level.game;
    this.agents = new Map();
    this.views = new Map();
    this.nextId = 1;
    this.snapT = 0;
    this.spawnT = 60;
    this.time = 0;
    this.residue = []; // {pos, t}
    this.residueMeshes = [];
    this.rng = new RNG(level.seed ^ 0xbac7);
    this.typeCool = {};       // creature type -> seconds before it may spawn again
    this.raidT = 70;          // host: seconds to the next camp raid
    this.raidActive = 0;
    this.fakeCamp = null;     // debug / test camp when the mission has none
    this._players = [];
    this._playerPool = [];
    this._playersAt = -1;
    this._litList = [];
    this._litAt = -1;
    net.onClient('mons', (list) => this._onSnap(list));
    net.onClient('hurt', (d) => this._onHurt(d));
    net.onClient('residue', (d) => this._addResidueMesh(new THREE.Vector3().fromArray(d.p)));
    net.onClient('yoink', (d) => this._onYoink(d));
    net.onHost('residueLocal', (d) => this.dropResidue(new THREE.Vector3().fromArray(d.p)));
    net.onHost('flash', (d) => this._hostFlash(d));
    net.onHost('yoinked', (d, from) => this._hostYoinked(d, from));
    // camp systems: distorter safe zones, wheel trolleys, field workbench (and world.safeZones / world.isSafe)
    this.base = new BaseSystems(this);
  }

  // ---------- host helpers ----------
  // living players in this world, rebuilt once per frame (records are pooled: do not keep them)
  alivePlayers() {
    if (this._playersAt === this.time) return this._players;
    this._playersAt = this.time;
    const out = this._players;
    out.length = 0;
    let n = 0;
    const rec = (id, pos, flash, yaw, pitch) => {
      const r = this._playerPool[n] || (this._playerPool[n] = { id: null, pos: null, flash: false, dead: false, yaw: 0, pitch: 0, safe: false });
      n++;
      r.id = id; r.pos = pos; r.flash = flash; r.yaw = yaw; r.pitch = pitch; r.dead = false;
      r.safe = !!zoneAt(this.world, pos);
      out.push(r);
    };
    const l = this.game.local;
    if (!l.dead && l.world) rec(net.selfId, l.pos, l.flashOn, l.yaw, l.pitch);
    for (const r of this.game.remotes.values()) {
      if (r.dead || !r.inWorld) continue;
      rec(r.id, r.pos, !!r.pose?.fl, r.yaw, r.pitch);
    }
    return out;
  }

  lightAt(pos) {
    this.level.sampleLight(_v.copy(pos).setY(1.2), _c);
    return Math.min(1.2, _c.r * 0.3 + _c.g * 0.59 + _c.b * 0.11);
  }

  // is the player looking toward point p (with line of sight)?
  isWatchedBy(pl, p, dotMin = 0.72) {
    const ex = pl.pos.x, ey = pl.pos.y + 1.15, ez = pl.pos.z;
    let dx = p.x - ex, dy = p.y - ey, dz = p.z - ez;
    const d = Math.hypot(dx, dy, dz);
    if (d > 35 || d < 1e-4) return d < 1e-4;
    dx /= d; dy /= d; dz /= d;
    const cp = Math.cos(pl.pitch);
    const dot = -Math.sin(pl.yaw) * cp * dx + Math.sin(pl.pitch) * dy - Math.cos(pl.yaw) * cp * dz;
    if (dot < dotMin) return false;
    return this.world.physics.lineOfSight(_f.set(ex, ey, ez), p);
  }

  nearestFlare(pos, r) {
    let best = null;
    this.world.props.query(pos, r, (p) => {
      if ((p.type === 'flare') && p.state.lit && Date.now() - (p.state.litAt || 0) < 90000) best = p.root.position;
    });
    return best;
  }

  // nearest lit flare / glowstick (Hounds and Smilers can't stand any light source)
  nearestLight(pos, r) {
    if (this._litAt !== this.time) {
      this._litAt = this.time;
      this._litList.length = 0;
      for (const p of this.world.props.props.values()) if ((p.type === 'flare' || p.type === 'glowstick') && isLitState(p.type, p.state)) this._litList.push(p);
    }
    let best = null, bd = r * r;
    for (const p of this._litList) {
      const d = p.root.position.distanceToSquared(pos);
      if (d < bd) { bd = d; best = p.root.position; }
    }
    return best;
  }

  sound(name, pos, vol = 1) {
    this.world.fxAll({ k: 'snd', n: name, p: [+pos.x.toFixed(2), 1.6, +pos.z.toFixed(2)], v: vol });
  }

  damagePlayer(pl, dmg, kind, from, cause, opts = {}) {
    // a distorter field protects whoever stands inside it
    if (zoneAt(this.world, pl.pos)) return;
    const d = { dmg, kind, from: from.toArray(), cause, heavy: opts.heavy, san: opts.sanity || 0 };
    if (pl.id === net.selfId) this._onHurt(d);
    else net.toPeer(pl.id, 'hurt', d);
    this.world.fxAll({ k: 'blood', p: [pl.pos.x, pl.pos.y + 0.9, pl.pos.z], n: 14 });
  }

  _onHurt(d) {
    const l = this.game.local;
    if (l.dead) return;
    const died = l.survival.damage(d.dmg, d.kind, { cause: d.cause, heavy: d.heavy });
    if (d.san) l.survival.sanity = Math.max(0, l.survival.sanity - d.san);
    l.shake = 1;
    audio.play('hurt', { volume: 1 });
    // knockback away from attacker
    const from = new THREE.Vector3().fromArray(d.from);
    const k = l.pos.clone().sub(from).setY(0).normalize().multiplyScalar(5);
    l.applyYank([k.x, 2.5, k.z]);
    this.game.healthity?.say(d.kind === 'slash' ? 'slashed' : 'hurt');
    if (died) l.onDeath(d.cause);
  }

  hit(id, dir) {
    const a = this.agents.get(id);
    if (!a) return;
    if (a.type === 'bacteria') {
      a.setState('stunned');
      a.vel.addScaledVector(dir, 3);
      this.sound('bacteria_growl', a.pos, 1);
    } else if (a.onHit) {
      if (a.onHit(dir)) this._kill(a);
    } else {
      a.hp--;
      a.vel.addScaledVector(dir, 4);
      this.sound('stilllife_scream', a.pos, 0.9);
      if (a.hp <= 0) this._kill(a);
    }
  }

  _kill(a) {
    this.world.fxAll({ k: 'sparks', p: a.pos.clone().setY(0.6).toArray(), n: 10 });
    this.world.fxAll({ k: 'dust', p: a.pos.clone().setY(0.5).toArray(), n: 30, c: [0.85, 0.75, 0.6] });
    if (a.type !== 'smiler') this.dropResidue(a.pos, 'still_life_tissue');
    a.dispose();
    this.agents.delete(a.id);
  }

  dropResidue(pos, kind = 'bacteria_residue') {
    if (!net.isHost) return;
    if (this.residue.length > 40) this.residue.shift();
    this.residue.push({ pos: pos.clone().setY(0.01), kind });
    net.toAll('residue', { p: [pos.x, 0.01, pos.z], k: kind });
  }

  dropResidueLocal(p) {
    if (net.isHost) this.dropResidue(p);
  }

  _addResidueMesh(p) {
    if (!net.isHost) this.residue.push({ pos: p.clone(), kind: 'bacteria_residue' });
    const geo = new THREE.CircleGeometry(0.22 + Math.random() * 0.2, 12);
    const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: 0x050805, roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.92 }));
    m.rotation.x = -Math.PI / 2;
    m.position.copy(p).setY(0.012 + Math.random() * 0.003);
    m.scale.set(1, 0.6 + Math.random() * 0.8, 1);
    this.world.group.add(m);
    this.residueMeshes.push(m);
    if (this.residueMeshes.length > 40) this.residueMeshes.shift().removeFromParent();
  }

  sampleAt(point) {
    for (const r of this.residue) if (r.pos.distanceTo(point) < 0.6) return r.kind;
    return null;
  }

  // debug / scripted spawns (host)
  debugSpawn(type, pos, variant = 'watcher') {
    const a = this._make(type, pos, variant);
    this.agents.set(a.id, a);
    return a;
  }

  // console helper: spawn a creature `dist` metres in front of the local player
  spawnNear(type = 'hound', dist = 6, variant = 'watcher') {
    const l = this.game.local;
    const p = new THREE.Vector3(l.pos.x - Math.sin(l.yaw) * dist, 0, l.pos.z - Math.cos(l.yaw) * dist);
    return this.debugSpawn(type, p, variant);
  }

  _make(type, pos, variant) {
    const id = this.nextId++;
    switch (type) {
      case 'bacteria': return new BacteriaAI(this, id, pos);
      case 'hound': return new HoundAI(this, id, pos);
      case 'smiler': return new SmilerAI(this, id, pos);
      case 'partygoer': return new PartygoerAI(this, id, pos);
      default: return new StillLifeAI(this, id, pos, variant);
    }
  }

  typeCooldown(type, sec) { this.typeCool[type] = Math.max(this.typeCool[type] || 0, sec); }

  // ---------- camp ----------
  // the team's camp ({pos, radius, built}) once it exists: mission.camp, else a debug camp
  camp() {
    const m = this.level.mission;
    const c = m?.camp;
    if (c && c.pos && c.built !== false) return c;
    return this.fakeCamp;
  }

  _raidsAllowed() {
    const m = this.level.mission;
    if (this.fakeCamp && this.camp() === this.fakeCamp) return true;
    return !m?.stage || STAGE_RAIDS.has(m.stage);
  }

  // ---------- spawning ----------
  // a free cell-centre point minD..maxD away from a random player (or from `around`), out of sight
  _spawnPoint(minD, maxD, around = null, accept = null) {
    const players = this.alivePlayers();
    if (!players.length) return null;
    for (let tries = 0; tries < 30; tries++) {
      const base = around || players[this.rng.int(0, players.length - 1)].pos;
      const a = this.rng.next() * Math.PI * 2;
      const d = this.rng.range(minD, maxD);
      const x = base.x + Math.cos(a) * d, z = base.z + Math.sin(a) * d;
      if (!this.level.isChunkLoaded(x, z)) continue;
      const c = this.level.cell(x, z);
      if (!c || c.special?.kind === 'spawn') continue;
      const cx = (Math.floor(x / CELL) + 0.5) * CELL, cz = (Math.floor(z / CELL) + 0.5) * CELL;
      const p = new THREE.Vector3(cx, 0, cz);
      const minSep = around ? Math.min(minD, 14) * 0.8 : minD * 0.8;
      if (players.some((pl) => pl.pos.distanceTo(p) < minSep)) continue;
      if (players.some((pl) => this.isWatchedBy(pl, _v2.copy(p).setY(1.2), 0.5))) continue;
      if (zoneAt(this.world, p, 2)) continue;
      const camp = this.camp();
      if (!around && camp && p.distanceTo(camp.pos) < camp.radius + 6) continue;
      if (accept && !accept(p)) continue;
      return p;
    }
    return null;
  }

  _hostSpawning(dt) {
    for (const k in this.typeCool) this.typeCool[k] -= dt;
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    this.spawnT = 6;
    const day = this.game.day.day;
    const depthBonus = Math.min(2, this.level.depth - 1);
    const wantB = Math.min(5, BACTERIA_BY_DAY[day] + (day >= 3 ? depthBonus : 0));
    const wantS = STILL_BY_DAY[day] + depthBonus;
    let bac = 0, sl = 0, hound = 0, smiler = 0, party = 0;
    for (const a of this.agents.values()) {
      if (a.raid) continue; // raiders come on top of the day's population
      if (a.type === 'bacteria') bac++;
      else if (a.type === 'still') sl++;
      else if (a.type === 'hound') hound++;
      else if (a.type === 'smiler') smiler++;
      else if (a.type === 'partygoer') party++;
    }
    if (bac < wantB) {
      const p = this._spawnPoint(28, 42);
      if (p) this.debugSpawn('bacteria', p);
    }
    if (sl < wantS) {
      const p = this._spawnPoint(14, 30);
      if (p) {
        const variants = day < 3 ? [['watcher', 3], ['tall', 2], ['twin', 1]] : [['watcher', 3], ['crawler', 3], ['twin', 2], ['mass', 1], ['tall', 1]];
        this.debugSpawn('still', p, this.rng.weighted(variants));
      }
    }
    // newer creatures stay on dry land (no hounds paddling through the Poolrooms)
    if (this.world.type !== 'poolrooms' && !this.level.game.isLobby) {
      const solo = this.alivePlayers().length <= 1 && day >= 4 ? 1 : 0;
      const want = (tbl) => Math.max(0, (tbl[day] || 0) - solo);
      if (hound < want(HOUND_BY_DAY) && !(this.typeCool.hound > 0)) {
        const p = this._spawnPoint(22, 36);
        if (p) this.debugSpawn('hound', p);
      }
      if (smiler < want(SMILER_BY_DAY) && !(this.typeCool.smiler > 0)) {
        // only where it is properly dark
        const p = this._spawnPoint(12, 28, null, (q) => this.lightAt(q) < 0.12);
        if (p) this.debugSpawn('smiler', p);
        else this.typeCooldown('smiler', 12);
      }
      if (party < (PARTY_BY_DAY[day] || 0) && !(this.typeCool.partygoer > 0)) {
        // left standing among furniture, like a mannequin after the office party
        const p = this._spawnPoint(16, 30, null, (q) => {
          let n = 0;
          this.world.props.query(q, 2.6, (pr) => { if (pr.mass > 6) n++; });
          return n > 0;
        });
        if (p) this.debugSpawn('partygoer', p);
      }
    }
    // cull agents far from everyone (they'll respawn nearer)
    const players = this.alivePlayers();
    for (const a of [...this.agents.values()]) {
      let nd = 1e9;
      for (const p of players) nd = Math.min(nd, p.pos.distanceTo(a.pos));
      if ((nd > 70 && !a.raid) || !this.level.isChunkLoaded(a.pos.x, a.pos.z) || a.vanish) {
        a.dispose();
        this.agents.delete(a.id);
      }
    }
  }

  // ---------- camp raids (host) ----------
  _hostRaids(dt) {
    const camp = this.camp();
    const day = this.game.day.day;
    if (!camp || day < 2 || !this._raidsAllowed() || this.world.type === 'poolrooms') { this.raidT = Math.max(this.raidT, 45); return; }
    this.raidT -= dt;
    if (this.raidT > 0) return;
    this.raidT = (RAID_GAP[day] || 90) + this.rng.range(-20, 20);
    this.startRaid();
  }

  // send creatures at the camp now (also a console helper: __game.world.monsters.startRaid())
  startRaid(count = null) {
    const camp = this.camp();
    if (!camp || !net.isHost) return 0;
    if (!this.level.isChunkLoaded(camp.pos.x, camp.pos.z)) return 0; // nobody near enough to witness it
    const day = Math.max(2, this.game.day.day);
    const n = count ?? RAIDERS[Math.min(7, day)] ?? 1;
    const raiders = [];
    // creatures already out there turn toward the camp first
    const cands = [...this.agents.values()].filter((a) => !a.raid && (a.type === 'bacteria' || a.type === 'hound' || a.type === 'partygoer') && a.state !== 'chase' && a.state !== 'attack' && a.pos.distanceTo(camp.pos) < 60);
    cands.sort((a, b) => a.pos.distanceTo(camp.pos) - b.pos.distanceTo(camp.pos));
    for (const a of cands) { if (raiders.length >= n) break; raiders.push(a); }
    // then fresh ones from the dark around it
    const types = day >= 3 ? ['hound', 'bacteria', 'partygoer', 'hound'] : ['hound', 'partygoer'];
    for (let i = raiders.length; i < n; i++) {
      const p = this._spawnPoint(16, 28, camp.pos);
      if (!p) break;
      raiders.push(this.debugSpawn(types[(i + this.rng.int(0, 3)) % types.length], p));
    }
    for (const a of raiders) a.startRaid(camp);
    if (raiders.length) {
      this.raidActive += raiders.length;
      const covered = zoneAt(this.world, camp.pos);
      net.toAll('hq', { text: covered ? 'CAMP SENSOR: movement closing on your camp. Distorter field is up.' : 'CAMP SENSOR: movement closing on your camp. It is not protected.', from: 'CAMP' });
      this.world.fxAll({ k: 'snd', n: 'radio_static_burst', p: camp.pos.toArray(), v: 0.6 });
    }
    return raiders.length;
  }

  raidEnded() { this.raidActive = Math.max(0, this.raidActive - 1); }

  onRaidKnock(a, p) {
    const snd = a.type === 'bacteria' ? 'bacteria_attack' : a.type === 'hound' ? 'hound_snarl' : 'party_giggle';
    this.sound(snd, a.pos, 0.9);
    this.world.fxAll({ k: 'impact', m: p.material, p: p.root.position.toArray(), i: 0.9 });
    this.world.noise.emit(p.root.position, 16, 'smash');
  }

  // a creature bounced off a distorter field
  onRepelled(a, z, edge) {
    const snd = a.type === 'bacteria' ? 'bacteria_growl' : a.type === 'hound' ? 'hound_yelp' : a.type === 'smiler' ? 'smiler_hiss' : a.type === 'partygoer' ? 'party_giggle' : 'stilllife_scream';
    this.sound(snd, a.pos, 0.9);
    this.base.onRepelled(z, edge, a);
  }

  // ---------- partygoer snatching ----------
  // victim's client: hand over the held item (or a random one)
  _onYoink(d) {
    const l = this.game.local;
    if (l.dead) return;
    const inv = l.inv;
    let slot = inv.current ? inv.selected : -1;
    if (slot < 0) {
      const full = [];
      inv.slots.forEach((it, i) => { if (it) full.push(i); });
      if (full.length) slot = full[Math.floor(Math.random() * full.length)];
    }
    let type = null, state = null;
    if (slot >= 0) {
      const it = inv.remove(slot);
      type = it.type; state = it.state;
      if (type === 'flashlight' && l.flashOn && inv.find('flashlight') < 0) l.flashOn = false;
      l._cancelUse?.();
      this.game.ui.toast(`Something snatched your ${itemName(type)}!`, 'bad');
    } else this.game.ui.toast('Something shoved you from behind!', 'bad');
    audio.play('party_giggle', { volume: 0.9 });
    l.survival.sanity = Math.max(0, l.survival.sanity - 6);
    net.toHost('yoinked', { mon: d.mon, type, state });
  }

  _hostYoinked(d, from) {
    const a = this.agents.get(d.mon);
    const victim = this.alivePlayers().find((p) => p.id === from);
    if (!d.type) {
      // empty pockets: a shove and a giggle
      if (victim && a) this.damagePlayer(victim, 8, 'blunt', a.pos, 'a Partygoer');
      return;
    }
    const at = a ? _v.set(a.pos.x - Math.sin(a.yaw) * 0.5, 0.9, a.pos.z - Math.cos(a.yaw) * 0.5) : _v.copy(victim?.pos || this.game.local.pos).setY(1);
    const p = this.world.props.spawn(d.type, at.clone(), new THREE.Quaternion(), { state: d.state || {} });
    if (p && a?.carryProp) a.carryProp(p);
  }

  // ---------- update ----------
  update(dt) {
    this.time += dt;
    if (net.isHost) {
      if (!this.level.game.isLobby) {
        this._hostSpawning(dt);
        this._hostRaids(dt);
      }
      for (const a of this.agents.values()) a.update(Math.min(dt, 0.05));
      this.snapT -= dt;
      if (this.snapT <= 0) {
        this.snapT = 1 / 15;
        net.toAll('mons', [...this.agents.values()].map((a) => a.snapshot()));
      }
    }
    for (const v of this.views.values()) v.update(dt);
    this._localPerception(dt);
    this.base.update(dt);
  }

  _onSnap(list) {
    const seen = this._seenIds || (this._seenIds = new Set());
    seen.clear();
    for (const s of list) {
      seen.add(s.id);
      let v = this.views.get(s.id);
      if (!v) {
        v = new MonsterView(this, s);
        this.views.set(s.id, v);
      }
      v.push(s, v.time);
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) { v.dispose(); this.views.delete(id); }
    }
  }

  // stress/sanity input for the local player + photo subjects
  _localPerception() {
    const l = this.game.local;
    let near = 0, visible = false, chased = false;
    const cam = engine.camera;
    _m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_m4);
    for (const v of this.views.values()) {
      const d = v.pos.distanceTo(l.pos);
      const w = v.type === 'bacteria' ? 1 : v.type === 'smiler' || v.type === 'hound' ? 0.75 : 0.5;
      near = Math.max(near, w * Math.max(0, 1 - d / 22));
      if (d < 26 && _frustum.containsPoint(v.headPos(_v))) {
        if (this.world.physics.lineOfSight(cam.position, _v)) {
          visible = true;
          v.seenByLocal = true;
        }
      }
      if ((v.type === 'bacteria' || v.type === 'hound') && (v.snap.s === 'chase' || v.snap.s === 'pounce') && d < 25) chased = true;
      if (v.type === 'smiler' && v.snap.s === 'charge' && d < 20) chased = true;
    }
    this.localNear = near;
    this.localVisible = visible;
    this.localChased = chased;
  }

  // photo subjects in the camera view: [{subject, key, value, dist}]
  photoSubjects(camera) {
    const out = [];
    _m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_m4);
    for (const v of this.views.values()) {
      const hp = v.headPos(new THREE.Vector3());
      const d = hp.distanceTo(camera.position);
      if (d > 24 || !_frustum.containsPoint(hp)) continue;
      if (!this.world.physics.lineOfSight(camera.position, hp)) continue;
      // how centred is it?
      const ndc = hp.clone().project(camera);
      const centred = 1 - Math.min(1, Math.hypot(ndc.x, ndc.y));
      const q = Math.max(0.2, centred) * Math.max(0.3, 1 - d / 24);
      if (v.type === 'bacteria') out.push({ subject: LABEL.bacteria, key: `bac:${v.id}`, value: Math.round(220 * q + 40), dist: d, ach: 'photo_bacteria' });
      else if (LABEL[v.type]) out.push({ subject: LABEL[v.type], key: `${v.type}:${v.id}`, value: Math.round(160 * q + 30), dist: d });
      else out.push({ subject: `STILL LIFE (${(v.variant || '').toUpperCase()})`, key: `sl:${v.id}`, value: Math.round(140 * q + 25), dist: d, ach: 'stilllife' });
    }
    return out;
  }

  // camera flash: Still Lifes in front of the flash freeze for a moment, Hounds/Smilers bolt
  flashStun(camPos) {
    net.toHost('flash', { p: camPos.toArray() });
  }

  _hostFlash(d) {
    const p = new THREE.Vector3().fromArray(d.p);
    for (const a of this.agents.values()) {
      if (a.type === 'bacteria' || a.pos.distanceTo(p) > 12) continue;
      if (!this.world.physics.lineOfSight(p, _v.copy(a.pos).setY(0.8))) continue;
      if (a.onFlash) { a.onFlash(p); continue; }
      a.stunT = 2.5;
      a.vel.set(0, 0, 0);
    }
  }

  playFx(m, p) { this.base.playFx(m, p); }

  dispose() {
    for (const a of this.agents.values()) a.dispose();
    this.agents.clear();
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    for (const m of this.residueMeshes) m.removeFromParent();
    this.base.dispose();
    for (const t of ['mons', 'hurt', 'residue', 'yoink']) net.clientHandlers.delete(t);
    for (const t of ['residueLocal', 'flash', 'yoinked']) net.hostHandlers.delete(t);
  }
}

export { UP };
