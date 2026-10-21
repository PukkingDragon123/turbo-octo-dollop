// Host-side AI agent base shared by every monster type: character-controller movement on the
// grid nav, safe-zone (distorter field) constraints, sound perception that ignores anything
// inside a field, and the camp-raid sub-machine (approach -> ransack -> drag -> leave).
import * as THREE from 'three';
import { RAPIER, GROUPS, G, groups, Q } from '../../physics/physics.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _f = new THREE.Vector3();

export function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// is p inside any active safe zone (margin widens the test)?
export function zoneAt(world, p, margin = 0) {
  const zones = world.safeZones;
  if (!zones || !zones.length) return null;
  for (const z of zones) {
    const dx = p.x - z.pos.x, dz = p.z - z.pos.z;
    const r = z.r + margin;
    if (dx * dx + dz * dz < r * r) return z;
  }
  return null;
}

export class Agent {
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
    // safe zones: flinch/back-off timers
    this.flinchT = 0;
    this.flinchDir = new THREE.Vector3();
    this.repelCool = 0;
    this.avoidT = 0;
    this.raid = null;
    this._goal = new THREE.Vector3();
    this._pv = new THREE.Vector3();
    this._lookV = new THREE.Vector3();
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
    // combat (creatures/combat.js sets maxHp / armor / poise from its tables right after construction)
    this.maxHp = 3;
    this.armor = 1;       // damage multiplier
    this.maxPoise = 20;   // damage that staggers it
    this.poise = 20;
    this.hurtT = 0;       // short flinch after a hit (snapshot label 'hurt')
    this.staggerT = 0;    // reeling: AI suspended, open to a finisher (label 'stagger')
    this.dead = false;
    this.grab = null;     // { pid, t, dur, o } while it holds a player (combat.js)
    this.lastHitBy = null;
  }

  // reeling after a heavy hit: drift with the knock-back, no AI (the manager calls this instead of update)
  staggerUpdate(dt) {
    this.staggerT -= dt;
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.vel.multiplyScalar(Math.max(0, 1 - dt * 4));
    this.attackT = Math.max(0, this.attackT - dt * 2);
    this.frozen = false;
    this.integrate(dt);
    if (this.staggerT <= 0) { this.staggerT = 0; this.poise = this.maxPoise; this.onRecover?.(); }
  }

  // state the AI falls back to after a flinch / raid
  get idleState() { return 'roam'; }

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
          if (this.world.physics.lineOfSight(_v.copy(this.pos).setY(0.8), _v3.set(n[0], 0.8, n[1]))) this.pathI++;
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
    return Math.hypot(target.x - this.pos.x, target.z - this.pos.z);
  }

  // gaze target (own vector: snapshots read it after the shared scratch vectors have moved on)
  lookAt(p, y = null) {
    this.look = this._lookV.copy(p);
    if (y !== null) this.look.y = y;
    return this.look;
  }

  faceToward(p, dt, rate = 10) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    if (dx * dx + dz * dz > 1e-4) this.yaw = angleLerp(this.yaw, Math.atan2(-dx, -dz), Math.min(1, dt * rate));
  }

  integrate(dt) {
    this._zoneConstrain(dt);
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

  // ---------------------------------------------------------------- safe zones
  // Distorter fields are hard walls: the inward velocity is removed, anything inside is pushed out,
  // and touching the edge makes the creature flinch and back off (see zoneReact).
  _zoneConstrain(dt) {
    this.repelCool -= dt;
    this.avoidT -= dt;
    const zones = this.world.safeZones;
    if (!zones || !zones.length) return;
    for (const z of zones) {
      const dx = this.pos.x - z.pos.x, dz = this.pos.z - z.pos.z;
      const d = Math.hypot(dx, dz) || 1e-3;
      const R = z.r + this.radius + 0.1;
      if (d > R + 1.5) continue;
      const nx = dx / d, nz = dz / d;
      const vin = -(this.vel.x * nx + this.vel.z * nz);
      // walking into the field: it bites back (flinch + back off) before the wall even stops it
      if (d < R + 0.6 && (vin > 0.3 || d < R) && this.repelCool <= 0) {
        this.repelCool = 3.5;
        this._repel(z, nx, nz);
      }
      if (d < R + 0.15 && vin > 0) { this.vel.x += nx * vin; this.vel.z += nz * vin; }
      if (d < R) {
        const push = Math.min(R - d, 6 * dt);
        this.pos.x += nx * push;
        this.pos.z += nz * push;
      }
    }
  }

  _repel(z, nx, nz) {
    this.flinchT = 0.9;
    this.flinchDir.set(nx, 0, nz);
    this.avoidT = 9;
    this.path = null;
    if (this.raid) { this.raid.phase = 'blocked'; this.raid.t = 0; this.raid.zone = z; this.raid.ang = Math.atan2(nz, nx); }
    this.mgr.onRepelled(this, z, _v.set(z.pos.x + nx * z.r, 1.2, z.pos.z + nz * z.r));
  }

  // returns true while flinching (the AI skips its own update)
  zoneReact(dt) {
    if (this.flinchT <= 0) return false;
    this.flinchT -= dt;
    this.stateT += dt;
    this.frozen = false;
    // stagger back out of the field, turned toward it
    this.vel.x += (this.flinchDir.x * 2.4 - this.vel.x) * Math.min(1, dt * 8);
    this.vel.z += (this.flinchDir.z * 2.4 - this.vel.z) * Math.min(1, dt * 8);
    this.yaw = angleLerp(this.yaw, Math.atan2(this.flinchDir.x, this.flinchDir.z), Math.min(1, dt * 10));
    this.attackT = Math.max(0, this.attackT - dt * 2);
    this.integrate(dt);
    if (this.flinchT <= 0 && !this.raid) {
      // wander off away from the field
      this.setState(this.idleState);
      this.goal = new THREE.Vector3(this.pos.x + this.flinchDir.x * 9, 0, this.pos.z + this.flinchDir.z * 9);
    }
    return true;
  }

  // loudest noise this creature can hear (events inside distorter fields are scrambled)
  hear(mul, since) {
    const ns = this.world.noise;
    let best = null, bestScore = 0;
    const zones = this.world.safeZones;
    for (const e of ns.events) {
      if (e.t < since) continue;
      if (zones?.length && zoneAt(this.world, e.pos, 0.3)) continue;
      const d = e.pos.distanceTo(this.pos);
      const age = ns.time - e.t;
      const score = (e.loudness * mul - d) * (1 - age / 4);
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best ? { event: best, score: bestScore } : null;
  }

  // nearest living player outside every safe zone
  nearestPlayer(maxD = 1e9) {
    let best = null, bd = maxD;
    for (const p of this.mgr.alivePlayers()) {
      if (p.safe) continue;
      const d = p.pos.distanceTo(this.pos);
      if (d < bd) { bd = d; best = p; }
    }
    this._nearD = bd;
    return best;
  }

  // ---------------------------------------------------------------- camp raids
  startRaid(camp) {
    this.raid = { camp, phase: 'approach', t: 0, knocks: 0, prop: null, propT: 0, zone: null, ang: 0, exit: null };
    this.path = null;
  }

  endRaid() {
    const r = this.raid;
    if (!r) return;
    this.raid = null;
    this.mgr.raidEnded?.(this);
    this.setState(this.idleState);
  }

  // drives the creature while raiding; returns true if it handled the update this frame
  raidUpdate(dt, speed, o = {}) {
    const r = this.raid;
    if (!r) return false;
    const camp = r.camp;
    const props = this.world.props;
    r.t += dt;
    this.frozen = false;
    switch (r.phase) {
      case 'approach': {
        // (a camp under a distorter field turns this into 'blocked' at the first touch of its edge)
        const d = this.moveTo(dt, camp.pos, speed);
        this.lookAt(camp.pos, 1);
        this.raidLabel = 'investigate';
        if (d < Math.max(2, camp.radius * 0.75)) { r.phase = 'ransack'; r.t = 0; r.prop = null; }
        // no progress for a while (boxed in, no path): try a fresh path, then give up
        if (r.best === undefined || d < r.best - 0.5) { r.best = d; r.stall = 0; }
        else r.stall = (r.stall || 0) + dt;
        if (r.stall > 5 && !r.repathed) { r.repathed = true; this.path = null; this.vel.set(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(4); }
        if (r.stall > 12 || r.t > 60) this.endRaid();
        break;
      }
      case 'blocked': {
        // prowl along the edge of the field, growling, then give up
        const z = r.zone;
        if (!z || !this.world.safeZones.includes(z)) { r.phase = 'approach'; r.t = 0; break; }
        r.ang += dt * 0.5 * (this.id % 2 ? 1 : -1);
        this._goal.set(z.pos.x + Math.cos(r.ang) * (z.r + 2.2), 0, z.pos.z + Math.sin(r.ang) * (z.r + 2.2));
        this.moveTo(dt, this._goal, speed * 0.45);
        this.lookAt(z.pos, 1.2);
        this.raidLabel = 'stalk';
        if (r.t > 8) { r.phase = 'leave'; r.t = 0; }
        break;
      }
      case 'ransack': {
        this.raidLabel = 'investigate';
        let p = r.prop != null ? props.get(r.prop) : null;
        if (!p || p.dead || p.isHeld()) {
          p = this._pickCampProp(camp, 120);
          r.prop = p ? p.id : null;
          r.propT = 0;
          if (!p) { r.phase = 'leave'; r.t = 0; break; }
        }
        r.propT += dt;
        const pp = p.root.position;
        const d = this.moveTo(dt, pp, speed * 0.8);
        this.lookAt(pp);
        if (d < 1.5 + p.radius * 0.5) {
          this._knock(p);
          r.knocks++;
          r.prop = null;
          this.raidLabel = 'smash';
        } else if (r.propT > 6) r.prop = null;
        if (r.knocks >= (o.knocks ?? 3) || r.t > 16) {
          r.phase = 'drag'; r.t = 0;
          const dp = this._pickCampProp(camp, o.dragMax ?? 45, true);
          r.prop = dp ? dp.id : null;
          if (!dp) { r.phase = 'leave'; break; }
          _f.set(this.pos.x - camp.pos.x, 0, this.pos.z - camp.pos.z);
          if (_f.lengthSq() < 0.01) _f.set(1, 0, 0);
          _f.normalize();
          r.exit = new THREE.Vector3(camp.pos.x + _f.x * (camp.radius + 10), 0, camp.pos.z + _f.z * (camp.radius + 10));
          const ex = this.mgr.level.nav.randomNear(r.exit.x, r.exit.z, 1, Math.random);
          r.exit.set(ex[0], 0, ex[1]);
        }
        break;
      }
      case 'drag': {
        const p = r.prop != null ? props.get(r.prop) : null;
        if (!p || p.dead || p.isHeld() || !p.body) { r.phase = 'leave'; r.t = 0; break; }
        const pp = p.root.position;
        const dProp = Math.hypot(pp.x - this.pos.x, pp.z - this.pos.z);
        if (dProp > 2.6 && r.t < 4) {
          // walk up to it first
          this.moveTo(dt, pp, speed * 0.8);
          this.lookAt(pp);
          this.raidLabel = 'investigate';
          break;
        }
        this.raidLabel = 'retreat';
        const d = this.moveTo(dt, r.exit, speed * 0.5);
        // haul: spring the prop toward a point just behind the creature (walking backwards would read worse)
        _f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        _v.copy(this.pos).addScaledVector(_f, -0.9 - p.radius * 0.6).setY(Math.max(0.25, pp.y));
        this._haul(p, _v, dt);
        this.lookAt(pp);
        if (d < 1.5 || r.t > 10 || dProp > 4) { r.phase = 'leave'; r.t = 0; }
        break;
      }
      case 'leave': {
        this.raidLabel = 'roam';
        if (!r.exit) {
          _f.set(this.pos.x - camp.pos.x, 0, this.pos.z - camp.pos.z);
          if (_f.lengthSq() < 0.01) _f.set(1, 0, 0);
          _f.normalize();
          const ex = this.mgr.level.nav.randomNear(this.pos.x + _f.x * 14, this.pos.z + _f.z * 14, 2, Math.random);
          r.exit = new THREE.Vector3(ex[0], 0, ex[1]);
        }
        const d = this.moveTo(dt, r.exit, speed * 0.7);
        if (d < 1.5 || r.t > 9) this.endRaid();
        break;
      }
      default: this.endRaid();
    }
    return true;
  }

  // a random physics prop inside the camp (not held, not inside a field)
  _pickCampProp(camp, maxMass, dragging = false) {
    const list = this._campList || (this._campList = []);
    list.length = 0;
    this.world.props.query(camp.pos, camp.radius + 0.5, (p) => {
      if (p.dead || !p.body || p.frozen || p.isHeld()) return;
      if (p.def.device && dragging) return; // the radio / crates stay
      if (p.type === 'field_bench' || p.type === 'distorter') return;
      if (/tent|camp|teleport|pad/.test(p.type)) return;
      const m = p.body.mass();
      if (m > maxMass || m < 0.3) return;
      if (zoneAt(this.world, p.root.position, 0.2)) return;
      if (dragging && m < 3) return;
      list.push(p);
    });
    if (!list.length) return null;
    return list[Math.floor(Math.random() * list.length)];
  }

  _knock(p) {
    const b = p.body;
    if (!b) return;
    const m = b.mass();
    _f.set(p.root.position.x - this.pos.x, 0, p.root.position.z - this.pos.z);
    if (_f.lengthSq() < 1e-4) _f.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    _f.normalize();
    _v.copy(_f).multiplyScalar(Math.min(m * 4, 160)).setY(Math.min(m * 1.6, 60));
    _v2.copy(p.root.position);
    _v2.y += Math.max(0.15, p.radius * 0.5);
    b.wakeUp();
    b.applyImpulseAtPoint(_v, _v2, true);
    this.attackT = 0.6;
    this.mgr.onRaidKnock(this, p);
  }

  _haul(p, target, dt) {
    const b = p.body;
    const m = b.mass();
    const t = b.translation(), lv = b.linvel();
    _v3.set(target.x - t.x, 0, target.z - t.z);
    const dist = _v3.length();
    _v3.multiplyScalar(Math.min(5, 3 + dist * 2));
    if (_v3.length() > 3) _v3.setLength(3);
    // horizontal velocity impulse, capped like a strong grab; a little lift so it scrapes rather than sticks
    this._pv.set((_v3.x - lv.x) * m * 0.5, m * 11.5 * dt * 0.35, (_v3.z - lv.z) * m * 0.5);
    const cap = 900 * dt;
    if (this._pv.length() > cap) this._pv.setLength(cap);
    b.wakeUp();
    b.applyImpulse(this._pv, true);
  }

  dispose() {
    try {
      this.world.physics.world.removeCharacterController(this.controller);
      this.world.physics.removeCollider(this.collider);
    } catch (e) { /* freed */ }
  }

  snapshot() {
    const st = this.flinchT > 0 ? 'flinch' : this.staggerT > 0 ? 'stagger' : this.grab ? 'grab' : this.hurtT > 0 ? 'hurt' : this.raid && this.raidLabel ? this.raidLabel : this.state;
    const o = {
      id: this.id, t: this.type, v: this.variant || null,
      p: [+this.pos.x.toFixed(2), +this.pos.y.toFixed(2), +this.pos.z.toFixed(2)],
      y: +this.yaw.toFixed(2), s: st,
      l: this.look ? [+this.look.x.toFixed(1), +this.look.y.toFixed(1), +this.look.z.toFixed(1)] : null,
      a: +this.attackT.toFixed(2), f: this.frozen ? 1 : 0, i: +(this.intensity || 0).toFixed(2),
    };
    if (this.hp < this.maxHp) o.h = +Math.max(0, this.hp / this.maxHp).toFixed(2);
    if (this.flyY) o.fy = +this.flyY.toFixed(2);
    if (this.tamer) o.tm = 1;
    if (this.burrowed) o.b = 1;
    return o;
  }
}
