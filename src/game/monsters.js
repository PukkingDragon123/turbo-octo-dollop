// Monsters: host-simulated AI, replicated as compact snapshots, rendered procedurally on peers.
//  - The Bacteria hunts by sound: it investigates noises (footsteps, impacts, generators, welding,
//    voices), stalks players at the edge of their flashlight, chases with terrifying speed,
//    smashes through barricades and retreats after a strike.
//  - Still Lifes: wrong-anatomy copies of clones. Watchers creep closer when unobserved,
//    crawlers skitter in the dark and flee light, twins giggle, masses lumber and attack.
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { net } from '../net/net.js';
import { audio } from '../audio/audio.js';
import { RAPIER, GROUPS, G, groups, Q } from '../physics/physics.js';
import { BacteriaBody } from '../entities/monsters/bacteria_body.js';
import { buildStillLife } from '../entities/optional.js';
import { RNG } from '../core/rng.js';
import { CELL, HEIGHT } from '../world/levels/yellow/layout.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _f = new THREE.Vector3();
const _frustum = new THREE.Frustum();
const _m4 = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

const BACTERIA_BY_DAY = [0, 1, 1, 2, 2, 3, 3, 4];
const STILL_BY_DAY = [0, 1, 1, 2, 3, 4, 5, 6];

function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ===========================================================================
// Host-side AI agents
class Agent {
  constructor(mgr, id, type, pos, halfH = 0.8, radius = 0.35) {
    this.mgr = mgr;
    this.world = mgr.world;
    this.id = id;
    this.type = type;
    this.pos = pos.clone();
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.state = 'roam';
    this.stateT = 0;
    this.path = null;
    this.pathI = 0;
    this.repathT = 0;
    this.look = null;
    this.attackT = 0;
    this.hp = 3;
    this.frozen = false;
    this.farT = 0;
    this.radius = radius;
    this.halfH = halfH;
    const desc = RAPIER.ColliderDesc.capsule(this.halfH, this.radius).setCollisionGroups(GROUPS.monster).setTranslation(pos.x, pos.y + this.halfH + this.radius, pos.z);
    this.collider = this.world.physics.world.createCollider(desc);
    this.world.physics.setUserData(this.collider, { kind: 'monster', monster: this });
    this.controller = this.world.physics.world.createCharacterController(0.03);
    this.controller.enableAutostep(0.35, 0.2, false);
    this.controller.enableSnapToGround(0.3);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(90);
    this.lastPos = pos.clone();
    this.stuckT = 0;
  }

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.stateT = 0;
    this.path = null;
  }

  // move toward a world point using grid paths; returns remaining distance
  moveTo(dt, target, speed) {
    const lvl = this.mgr.level;
    this.repathT -= dt;
    const direct = this.pos.distanceTo(target) < 4 && this.world.physics.lineOfSight(_v.copy(this.pos).setY(0.8), _v2.copy(target).setY(0.8));
    let wp;
    if (direct) wp = target;
    else {
      if (!this.path || this.repathT <= 0 || this.pathI >= this.path.length) {
        this.repathT = 1.2;
        this.path = lvl.nav.findPath(this.pos.x, this.pos.z, target.x, target.z, 900);
        this.pathI = 0;
      }
      if (this.path && this.pathI < this.path.length) {
        const p = this.path[this.pathI];
        wp = _v2.set(p[0], 0, p[1]);
        if (Math.hypot(p[0] - this.pos.x, p[1] - this.pos.z) < 0.9) this.pathI++;
        // string pulling: skip ahead if the next is visible
        if (this.pathI + 1 < this.path.length) {
          const n = this.path[this.pathI + 1];
          if (this.world.physics.lineOfSight(_v.copy(this.pos).setY(0.8), new THREE.Vector3(n[0], 0.8, n[1]))) this.pathI++;
        }
      } else wp = target;
    }
    const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.05) {
      const want = Math.atan2(-dx, -dz);
      this.yaw = angleLerp(this.yaw, want, Math.min(1, dt * 7));
      this.vel.x += ((dx / d) * speed - this.vel.x) * Math.min(1, dt * 6);
      this.vel.z += ((dz / d) * speed - this.vel.z) * Math.min(1, dt * 6);
    } else {
      this.vel.x *= 0.8;
      this.vel.z *= 0.8;
    }
    return this.pos.distanceTo(target);
  }

  integrate(dt) {
    const desired = { x: this.vel.x * dt + 1e-4, y: -0.6 * dt, z: this.vel.z * dt + 7e-5 };
    this.collider.setTranslation({ x: this.pos.x, y: this.pos.y + this.halfH + this.radius, z: this.pos.z });
    this.controller.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(G.MONSTER, G.STATIC | G.PROP | G.PLAYER));
    const mv = this.controller.computedMovement();
    this.pos.x += mv.x; this.pos.y += mv.y; this.pos.z += mv.z;
    // monsters walk on the static floor (they shove furniture, never climb onto it)
    const g = this.world.physics.raycast(_v.set(this.pos.x, this.pos.y + 0.9, this.pos.z), _v2.set(0, -1, 0), 4, Q.world);
    if (g) this.pos.y = g.point.y;
    else if (this.pos.y < 0) this.pos.y = 0;
    this.collider.setTranslation({ x: this.pos.x, y: this.pos.y + this.halfH + this.radius, z: this.pos.z });
    // stuck detection
    const moved = Math.hypot(this.pos.x - this.lastPos.x, this.pos.z - this.lastPos.z);
    const wanted = Math.hypot(this.vel.x, this.vel.z) * dt;
    if (wanted > 0.01 && moved < wanted * 0.25) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    this.lastPos.copy(this.pos);
  }

  dispose() {
    try {
      this.world.physics.world.removeCharacterController(this.controller);
      this.world.physics.removeCollider(this.collider);
    } catch (e) { /* freed */ }
  }

  snapshot() {
    return {
      id: this.id, t: this.type, v: this.variant || null,
      p: [+this.pos.x.toFixed(2), +this.pos.y.toFixed(2), +this.pos.z.toFixed(2)],
      y: +this.yaw.toFixed(2), s: this.state,
      l: this.look ? [+this.look.x.toFixed(1), +this.look.y.toFixed(1), +this.look.z.toFixed(1)] : null,
      a: +this.attackT.toFixed(2), f: this.frozen ? 1 : 0, i: +(this.intensity || 0).toFixed(2),
    };
  }
}

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

  update(dt) {
    const mgr = this.mgr;
    const day = mgr.game.day.day;
    const aggro = Math.min(1, 0.25 + day * 0.11 + (mgr.level.depth - 1) * 0.1);
    this.intensity = this.state === 'chase' ? 1 : this.state === 'stalk' ? 0.6 : aggro * 0.5;
    this.stateT += dt;
    this.cooldown -= dt;
    const players = mgr.alivePlayers();
    // ---- perception ----
    let seen = null, seenD = 1e9;
    const head = _v.copy(this.pos).setY(2.0);
    _f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    for (const pl of players) {
      const chest = _v2.copy(pl.pos).setY(pl.pos.y + 0.8);
      const d = head.distanceTo(chest);
      if (d > 32) continue;
      const lum = pl.flash ? 1.2 : mgr.lightAt(pl.pos);
      const visDist = 5 + lum * 20 + (pl.flash ? 8 : 0);
      if (d > visDist) continue;
      const dir = chest.clone().sub(this.pos).setY(0).normalize();
      if (d > 4.5 && dir.dot(_f) < -0.1) continue;
      if (!this.world.physics.lineOfSight(head, chest)) continue;
      if (d < seenD) { seen = pl; seenD = d; }
    }
    // hearing
    const heard = this.world.noise.loudestFor(this.pos, 0.9 + aggro * 0.6, this.noiseT);
    if (seen) {
      this.target = seen;
      this.lastKnown = seen.pos.clone();
      this.lostT = 0;
    } else this.lostT += dt;

    // ---- flee lit flares ----
    const flare = mgr.nearestFlare(this.pos, 4.5);
    if (flare && this.state !== 'flee') {
      this.setState('flee');
      this.fleeFrom = flare.clone();
      mgr.sound('bacteria_growl', this.pos, 0.8);
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
        if (this.target && !this.target.dead && this.lostT < 0.5 && this.pos.distanceTo(this.target.pos) < 1.7 && this.cooldown <= 0) {
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

  update(dt) {
    const mgr = this.mgr;
    this.stateT += dt;
    this.cooldown -= dt;
    if (this.stunT > 0) {
      this.stunT -= dt;
      this.frozen = true;
      this.vel.set(0, 0, 0);
      this.integrate(dt);
      return;
    }
    const players = mgr.alivePlayers();
    let near = null, nd = 1e9;
    for (const p of players) { const d = p.pos.distanceTo(this.pos); if (d < nd) { nd = d; near = p; } }
    const watched = players.some((p) => mgr.isWatchedBy(p, this.pos.clone().setY(0.8)));
    const lit = players.some((p) => p.flash && mgr.isWatchedBy(p, this.pos.clone().setY(0.6), 0.93) && p.pos.distanceTo(this.pos) < 14);
    this.look = near ? near.pos.clone().setY(1.0) : null;
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
    if (this.type === 'bacteria') {
      this.body = new BacteriaBody(snap.id);
      this.root = this.body.root;
      this.body.onStep = (p, loud) => {
        audio.play('bacteria_step', { pos: p, intensity: loud, volume: 0.5 + loud * 0.6 });
        if (Math.random() < 0.08) mgr.dropResidueLocal(p);
      };
      this.presence = audio.loop('bacteria_presence', { pos: this.pos.clone().setY(1.6), volume: 0.9 });
    } else {
      this.sl = buildStillLife(this.variant || 'watcher', snap.id);
      this.root = this.sl.root;
    }
    this.root.position.copy(this.pos);
    mgr.world.group.add(this.root);
    mgr.world.registerDynamic(this.root);
    // collision proxy so the local player can't walk through monsters
    const r = this.type === 'bacteria' ? 0.38 : this.sl?.radius || 0.35;
    const hh = this.type === 'bacteria' ? 0.75 : Math.max(0.2, (this.sl?.height || 1.2) / 2 - r);
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
    const vel = _v2.subVectors(this.pos, this.prevPos).divideScalar(Math.max(dt, 1e-3));
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    const s = this.snap;
    const look = s.l ? new THREE.Vector3().fromArray(s.l) : null;
    if (this.body) {
      this.body.update(dt, { velocity: vel.clone(), state: s.s, lookTarget: look, attackT: s.a, ceilingY: HEIGHT, intensity: s.i });
      this.presence?.setPosition(this.pos.clone().setY(1.7));
      this.presence?.setParam?.('intensity', s.s === 'chase' ? 1 : 0.3);
      if (this.dissolve > 0) { this.dissolve = Math.max(0, this.dissolve - dt * 0.8); this.body.setDissolve?.(this.dissolve); }
    } else if (this.sl) {
      const sp = Math.hypot(vel.x, vel.z);
      this.sl.update(dt, { speed: sp, moving: sp > 0.1, attacking: s.a, alert: s.s === 'chase' ? 1 : 0.3, lookTarget: look, frozen: !!s.f });
    }
    this.collider?.setTranslation({ x: this.pos.x, y: this.pos.y + this.colHalf, z: this.pos.z });
  }

  headPos(out) {
    if (this.body?.getHeadWorldPosition) return this.body.getHeadWorldPosition(out);
    return out.copy(this.pos).setY(this.pos.y + (this.sl?.height || 1.2) * 0.85);
  }

  dispose() {
    this.presence?.stop(0.4);
    this.mgr.world.unregisterDynamic(this.root);
    this.root.removeFromParent();
    this.body?.dispose?.();
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
    net.onClient('mons', (list) => this._onSnap(list));
    net.onClient('hurt', (d) => this._onHurt(d));
    net.onClient('residue', (d) => this._addResidueMesh(new THREE.Vector3().fromArray(d.p)));
    net.onHost('residueLocal', (d) => this.dropResidue(new THREE.Vector3().fromArray(d.p)));
    net.onHost('flash', (d) => this._hostFlash(d));
  }

  // ---------- host helpers ----------
  alivePlayers() {
    const out = [];
    const l = this.game.local;
    if (!l.dead && l.world) out.push({ id: net.selfId, pos: l.pos, flash: l.flashOn, dead: false, yaw: l.yaw, pitch: l.pitch });
    for (const r of this.game.remotes.values()) {
      if (r.dead || !r.inWorld) continue;
      out.push({ id: r.id, pos: r.pos, flash: !!r.pose?.fl, dead: false, yaw: r.yaw, pitch: r.pitch });
    }
    return out;
  }

  lightAt(pos) {
    const c = new THREE.Color();
    this.level.sampleLight(_v.copy(pos).setY(1.2), c);
    return Math.min(1.2, c.r * 0.3 + c.g * 0.59 + c.b * 0.11);
  }

  // is the player looking toward point p (with line of sight)?
  isWatchedBy(pl, p, dotMin = 0.72) {
    const eye = _v.copy(pl.pos).setY(pl.pos.y + 1.15);
    const dir = _v2.subVectors(p, eye);
    const d = dir.length();
    if (d > 35) return false;
    dir.divideScalar(d);
    const fwd = new THREE.Vector3(-Math.sin(pl.yaw) * Math.cos(pl.pitch), Math.sin(pl.pitch), -Math.cos(pl.yaw) * Math.cos(pl.pitch));
    if (fwd.dot(dir) < dotMin) return false;
    return this.world.physics.lineOfSight(eye, p);
  }

  nearestFlare(pos, r) {
    let best = null;
    this.world.props.query(pos, r, (p) => {
      if ((p.type === 'flare') && p.state.lit && Date.now() - (p.state.litAt || 0) < 90000) best = p.root.position;
    });
    return best;
  }

  sound(name, pos, vol = 1) {
    this.world.fxAll({ k: 'snd', n: name, p: [+pos.x.toFixed(2), 1.6, +pos.z.toFixed(2)], v: vol });
  }

  damagePlayer(pl, dmg, kind, from, cause, opts = {}) {
    const d = { dmg, kind, from: from.toArray(), cause, heavy: opts.heavy };
    if (pl.id === net.selfId) this._onHurt(d);
    else net.toPeer(pl.id, 'hurt', d);
    this.world.fxAll({ k: 'blood', p: [pl.pos.x, pl.pos.y + 0.9, pl.pos.z], n: 14 });
  }

  _onHurt(d) {
    const l = this.game.local;
    if (l.dead) return;
    const died = l.survival.damage(d.dmg, d.kind, { cause: d.cause, heavy: d.heavy });
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
    this.dropResidue(a.pos, 'still_life_tissue');
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
    const a = type === 'bacteria' ? new BacteriaAI(this, this.nextId++, pos) : new StillLifeAI(this, this.nextId++, pos, variant);
    this.agents.set(a.id, a);
    return a;
  }

  // ---------- spawning ----------
  _spawnPoint(minD, maxD) {
    const players = this.alivePlayers();
    if (!players.length) return null;
    for (let tries = 0; tries < 30; tries++) {
      const base = players[this.rng.int(0, players.length - 1)].pos;
      const a = this.rng.next() * Math.PI * 2;
      const d = this.rng.range(minD, maxD);
      const x = base.x + Math.cos(a) * d, z = base.z + Math.sin(a) * d;
      if (!this.level.isChunkLoaded(x, z)) continue;
      const c = this.level.cell(x, z);
      if (!c || c.special?.kind === 'spawn') continue;
      const cx = (Math.floor(x / CELL) + 0.5) * CELL, cz = (Math.floor(z / CELL) + 0.5) * CELL;
      const p = new THREE.Vector3(cx, 0, cz);
      if (players.some((pl) => pl.pos.distanceTo(p) < minD * 0.8)) continue;
      if (players.some((pl) => this.isWatchedBy(pl, p.clone().setY(1.2), 0.5))) continue;
      return p;
    }
    return null;
  }

  _hostSpawning(dt) {
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    this.spawnT = 6;
    const day = this.game.day.day;
    const depthBonus = Math.min(2, this.level.depth - 1);
    const wantB = Math.min(5, BACTERIA_BY_DAY[day] + (day >= 3 ? depthBonus : 0));
    const wantS = STILL_BY_DAY[day] + depthBonus;
    const bac = [...this.agents.values()].filter((a) => a.type === 'bacteria');
    const sl = [...this.agents.values()].filter((a) => a.type === 'still');
    if (bac.length < wantB) {
      const p = this._spawnPoint(28, 42);
      if (p) {
        const a = new BacteriaAI(this, this.nextId++, p);
        this.agents.set(a.id, a);
      }
    }
    if (sl.length < wantS) {
      const p = this._spawnPoint(14, 30);
      if (p) {
        const variants = day < 3 ? [['watcher', 3], ['tall', 2], ['twin', 1]] : [['watcher', 3], ['crawler', 3], ['twin', 2], ['mass', 1], ['tall', 1]];
        const v = this.rng.weighted(variants);
        const a = new StillLifeAI(this, this.nextId++, p, v);
        this.agents.set(a.id, a);
      }
    }
    // cull agents far from everyone (they'll respawn nearer)
    const players = this.alivePlayers();
    for (const a of [...this.agents.values()]) {
      const nd = Math.min(...players.map((p) => p.pos.distanceTo(a.pos)), 1e9);
      if (nd > 70 || !this.level.isChunkLoaded(a.pos.x, a.pos.z) || a.vanish) {
        a.dispose();
        this.agents.delete(a.id);
      }
    }
  }

  // ---------- update ----------
  update(dt) {
    this.time += dt;
    if (net.isHost) {
      if (!this.level.game.isLobby) this._hostSpawning(dt);
      for (const a of this.agents.values()) a.update(Math.min(dt, 0.05));
      this.snapT -= dt;
      if (this.snapT <= 0) {
        this.snapT = 1 / 15;
        net.toAll('mons', [...this.agents.values()].map((a) => a.snapshot()));
      }
    }
    for (const v of this.views.values()) v.update(dt);
    this._localPerception(dt);
  }

  _onSnap(list) {
    const seen = new Set();
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
      const w = v.type === 'bacteria' ? 1 : 0.5;
      near = Math.max(near, w * Math.max(0, 1 - d / 22));
      if (d < 26 && _frustum.containsPoint(v.headPos(_v))) {
        if (this.world.physics.lineOfSight(cam.position, _v)) {
          visible = true;
          v.seenByLocal = true;
        }
      }
      if (v.type === 'bacteria' && v.snap.s === 'chase' && d < 25) chased = true;
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
      if (v.type === 'bacteria') out.push({ subject: 'THE BACTERIA', key: `bac:${v.id}`, value: Math.round(220 * q + 40), dist: d, ach: 'photo_bacteria' });
      else out.push({ subject: `STILL LIFE (${(v.variant || '').toUpperCase()})`, key: `sl:${v.id}`, value: Math.round(140 * q + 25), dist: d, ach: 'stilllife' });
    }
    return out;
  }

  // camera flash: Still Lifes in front of the flash freeze for a moment
  flashStun(camPos) {
    net.toHost('flash', { p: camPos.toArray() });
  }

  _hostFlash(d) {
    const p = new THREE.Vector3().fromArray(d.p);
    for (const a of this.agents.values()) {
      if (a.type !== 'still' || a.pos.distanceTo(p) > 12) continue;
      if (!this.world.physics.lineOfSight(p, a.pos.clone().setY(0.8))) continue;
      a.stunT = 2.5;
      a.vel.set(0, 0, 0);
    }
  }

  playFx() {}

  dispose() {
    for (const a of this.agents.values()) a.dispose();
    this.agents.clear();
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    for (const m of this.residueMeshes) m.removeFromParent();
    for (const t of ['mons', 'hurt', 'residue']) net.clientHandlers.delete(t);
    net.hostHandlers.delete('residueLocal');
    net.hostHandlers.delete('flash');
  }
}

export { UP };
