// The raft: a lashed-together pontoon raft (planks on blue drums) that carries the team down the
// waterway. A host-authoritative kinematic vehicle (Device 'raft'):
//  - players punt it by holding E while looking at it (from the deck, from the shore, or pushing
//    off while swimming) — the push goes the way they face; several punters go faster
//  - host integrates velocity / drag / yaw, keeps it inside the canal and streams the state at 15 Hz;
//    clients ease toward the extrapolated state
//  - every peer moves its own kinematic collider and carries its local clone (and camera) along
//    when standing on the deck, so riding is smooth on every machine
//  - the goldfish rams it (jolts can knock riders into the water)
import * as THREE from 'three';
import { engine } from '../../../core/engine.js';
import { net } from '../../../net/net.js';
import { input } from '../../../core/input.js';
import { audio } from '../../../audio/audio.js';
import { RAPIER, GROUPS } from '../../../physics/physics.js';
import { Device } from '../../../game/devices.js';
import * as Synth from '../../../gfx/texsynth.js';
import { CANAL_Z0, CANAL_Z1, CANAL_X0 } from './layout.js';

export const RAFT_HL = 1.8, RAFT_HW = 1.3; // half length (x) / half width (z) of the deck
export const DECK_H = 0.22;                // deck top above the water line
const MAXV = 2.7;
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

let _mats = null;
function mats() {
  if (_mats) return _mats;
  _mats = {
    wood: Synth.pbrMaterial('planks', { c0: 0x6e5236, c1: 0x9a7650, c2: 0x2a1c10, p0: [4, 0.012, 1, 0.6], wear: 0.6, size: 512, repeat: [1, 1], name: 'raft_wood' }),
    drum: Synth.pbrMaterial('plastic', { c0: 0x1f5d9e, c1: 0x1a4f88, c2: 0x0e2238, p0: [0.32, 0.4, 0, 0], wear: 0.55, size: 256, repeat: [2, 2], name: 'raft_drum' }),
    rope: Synth.pbrMaterial('pool_rope', { size: 256, repeat: [1, 1], name: 'raft_rope' }),
    steel: Synth.pbrMaterial('metal', { c0: 0x9a9c9e, c1: 0x6a6c6e, c2: 0x4a3020, p0: [0.5, 0.3, 0.1, 0], wear: 0.5, size: 256, repeat: [2, 2], name: 'raft_steel' }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffb860, emissiveIntensity: 3.2, roughness: 0.3, name: 'raft_lantern' }),
    orange: Synth.pbrMaterial('plastic', { c0: 0xe8642a, c1: 0xd85a22, c2: 0x5a2a10, p0: [0.4, 0.4, 0, 0], wear: 0.4, size: 256, repeat: [2, 2], name: 'raft_orange' }),
  };
  return _mats;
}

function buildRaftModel() {
  const M = mats();
  const g = new THREE.Group();
  g.name = 'raft';
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  // drums: three rows of two, horizontal along x, half under water
  const drum = new THREE.CylinderGeometry(0.27, 0.27, 1.55, 18, 1);
  const rim = new THREE.TorusGeometry(0.27, 0.025, 6, 18);
  for (const z of [-0.95, 0, 0.95]) for (const x of [-0.85, 0.85]) {
    add(drum, M.drum, x, -0.38, z, 0, 0, Math.PI / 2);
    for (const e of [-0.6, 0, 0.6]) add(rim, M.drum, x + e, -0.38, z, 0, Math.PI / 2, 0);
  }
  // stringers + deck planks (across z, with gaps)
  for (const z of [-1.05, 0, 1.05]) add(new THREE.BoxGeometry(3.6, 0.1, 0.12), M.wood, 0, -0.13, z);
  const plank = new THREE.BoxGeometry(0.34, 0.05, 2.6);
  for (let k = 0; k < 10; k++) {
    const p = add(plank, M.wood, -1.62 + k * 0.36, -0.025 + ((k * 7) % 3) * 0.004, ((k * 5) % 3 - 1) * 0.02, 0, ((k * 3) % 5 - 2) * 0.006, 0);
    p.scale.set(1, 1, 1 - ((k * 11) % 4) * 0.015);
  }
  // rope lashings over the deck ends
  const lash = new THREE.TorusGeometry(0.29, 0.016, 5, 16);
  for (const z of [-0.95, 0.95]) for (const x of [-1.55, 1.55]) add(lash, M.rope, x, -0.3, z, 0, Math.PI / 2, 0);
  // mooring cleat + coiled rope
  add(new THREE.TorusGeometry(0.16, 0.035, 6, 20), M.rope, 1.35, 0.03, -0.9, Math.PI / 2, 0, 0);
  add(new THREE.TorusGeometry(0.11, 0.03, 6, 18), M.rope, 1.35, 0.07, -0.9, Math.PI / 2, 0, 0);
  // lantern post (steel pipe) with a hanging storm lantern
  add(new THREE.CylinderGeometry(0.03, 0.035, 1.9, 8), M.steel, -1.55, 0.95, 1.1);
  add(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 6), M.steel, -1.38, 1.86, 1.1, 0, 0, Math.PI / 2);
  const lantern = new THREE.Group();
  lantern.position.set(-1.22, 1.8, 1.1);
  g.add(lantern);
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.16, 10), M.lamp);
  glass.position.y = -0.14;
  lantern.add(glass);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.08, 10), M.steel);
  cap.position.y = -0.02;
  lantern.add(cap);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 10), M.steel);
  base.position.y = -0.235;
  lantern.add(base);
  // two long punt poles lying in crutches along the sides
  const pole = new THREE.CylinderGeometry(0.025, 0.03, 4.2, 8);
  add(pole, M.wood, 0.1, 0.09, -1.18, 0, 0, Math.PI / 2 + 0.03);
  add(pole, M.wood, -0.1, 0.09, 1.2, 0, 0, Math.PI / 2 - 0.02);
  for (const [x, z] of [[-1.2, -1.18], [1.3, -1.18], [-1.0, 1.2], [1.1, 1.2]]) add(new THREE.BoxGeometry(0.06, 0.12, 0.08), M.steel, x, 0.04, z);
  // a lashed orange buoy and a crate of salvage
  add(new THREE.TorusGeometry(0.2, 0.07, 8, 16), M.orange, 1.2, 0.07, 0.6, Math.PI / 2, 0, 0);
  add(new THREE.BoxGeometry(0.45, 0.3, 0.38), M.wood, 0.75, 0.15, 0.85, 0, 0.3, 0);
  return { root: g, lantern };
}

export class Raft extends Device {
  constructor(world, level, id, x, z) {
    super(world, id, {});
    this.level = level;
    this.range = 3.4;
    this.holdTime = 1;
    const m = buildRaftModel();
    this.model = m;
    this.root.add(m.root);
    this.s = { x, z, yaw: 0, vx: 0, vz: 0, w: 0 };   // simulated / received state
    this.disp = { x, z, yaw: 0 };                     // displayed (smoothed) transform
    this.prev = { x, z, yaw: 0, y: 0 };
    this.thrust = [];                                // host: [{x, z, t, from}]
    this.rock = 0;
    this.rockAxis = 0;
    this.sendT = 0;
    this.puntT = 0;
    this.lastSnapT = 0;
    this.snapAge = 0;
    this.bumpT = 0;
    this.time = 0;
    this.moored = true;
    // kinematic deck collider (the KCC stands on it, props ride on it)
    const phys = world.physics;
    this.body = phys.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, this._deckY(), z));
    const ud = { kind: 'device', device: this, surface: 'wood' };
    const deck = phys.world.createCollider(RAPIER.ColliderDesc.cuboid(RAFT_HL, 0.11, RAFT_HW).setTranslation(0, -0.11, 0).setCollisionGroups(GROUPS.static).setFriction(1.0), this.body);
    phys.setUserData(deck, ud);
    this.colliders.push(deck);
    this.root.position.set(x, this._deckY(), z);
    net.onClient('raft', (d) => this._onSnap(d));
    net.onClient('raftjolt', (d) => this._onJolt(d));
  }

  _deckY() { return (this.level.waterLevel ?? -0.1) + DECK_H; }

  // ------------------------------------------------------------------
  // queries
  toLocal(p, out = _v) {
    const dx = p.x - this.disp.x, dz = p.z - this.disp.z;
    const c = Math.cos(this.disp.yaw), s = Math.sin(this.disp.yaw);
    // rotation about +y by yaw maps local (lx, lz) -> world (lx*c + lz*s, -lx*s + lz*c)
    return out.set(dx * c - dz * s, p.y - this.root.position.y, dx * s + dz * c);
  }

  isOn(p, margin = 0.08) {
    const l = this.toLocal(p);
    return Math.abs(l.x) < RAFT_HL + margin && Math.abs(l.z) < RAFT_HW + margin && l.y > -0.35 && l.y < 0.6;
  }

  near(p, r = 1.2) {
    const l = this.toLocal(p);
    return Math.abs(l.x) < RAFT_HL + r && Math.abs(l.z) < RAFT_HW + r;
  }

  // ------------------------------------------------------------------
  // interaction
  prompt(player) {
    const k = input.keyName('interact');
    if (player.swimming) return `[${k}] Climb onto the raft`;
    if (this.isOn(player.pos)) return `Hold [${k}] Punt the raft${this.moored ? ' (cast off)' : ''}`;
    return `Hold [${k}] Push the raft`;
  }

  interact(player) {
    if (player.swimming) {
      // haul yourself up over the side nearest to you
      const l = this.toLocal(player.pos, new THREE.Vector3());
      const lx = THREE.MathUtils.clamp(l.x, -RAFT_HL + 0.45, RAFT_HL - 0.45), lz = THREE.MathUtils.clamp(l.z, -RAFT_HW + 0.45, RAFT_HW - 0.45);
      const c = Math.cos(this.disp.yaw), s = Math.sin(this.disp.yaw);
      const p = new THREE.Vector3(this.disp.x + lx * c + lz * s, this.root.position.y + 0.03, this.disp.z - lx * s + lz * c);
      if (player.survival.stamina < 4) { this.level.game.ui.toast('Too exhausted to climb aboard', 'warn'); return; }
      player.survival.stamina = Math.max(0, player.survival.stamina - 6);
      player.teleport(p, player.yaw);
      audio.play('splash', { pos: p, intensity: 0.6, volume: 0.7 });
      this.level.ripple?.(p.x, p.z, 1.2);
      return;
    }
    this.interactHold(player, 0.2);
  }

  interactHold(player, dt) {
    if (player.swimming) return;
    this.puntT -= dt;
    if (this.puntT > 0) return;
    this.puntT = 0.12;
    const f = _v.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    this.send('punt', { d: [+f.x.toFixed(3), +f.z.toFixed(3)], on: this.isOn(player.pos) ? 1 : 0 });
    // the pole bites the water beside the raft
    if (Math.random() < 0.35) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const px = player.pos.x - f.z * side * 0.9 + f.x * 0.3, pz = player.pos.z + f.x * side * 0.9 + f.z * 0.3;
      this.level.ripple?.(px, pz, 0.9);
      if (Math.random() < 0.5) audio.play('water_glug', { pos: new THREE.Vector3(px, this.level.waterLevel, pz), volume: 0.35 });
    }
  }

  hostAction(a, d) {
    if (a === 'punt' && d?.d) {
      const len = Math.hypot(d.d[0], d.d[1]) || 1;
      this.thrust.push({ x: d.d[0] / len, z: d.d[1] / len, t: 0.3, k: d.on ? 1 : 0.8 });
      if (this.moored) { this.moored = false; this.level.world.fxAll({ k: 'snd', n: 'scrape_short', p: [this.s.x, 0.2, this.s.z], v: 0.8 }); }
    }
  }

  // host: something big hit the raft from below / the side
  ram(dir, strength) {
    if (!net.isHost) return;
    this.s.vx += dir.x * strength;
    this.s.vz += dir.z * strength;
    this.s.w += (Math.random() - 0.5) * strength * 0.8;
    net.toAll('raftjolt', { s: +strength.toFixed(2), d: [+dir.x.toFixed(2), +dir.z.toFixed(2)] });
  }

  _onJolt(d) {
    this.rock = Math.min(1.2, this.rock + d.s * 0.5);
    this.rockAxis = Math.atan2(d.d[1], d.d[0]);
    const pos = new THREE.Vector3(this.disp.x, this.level.waterLevel, this.disp.z);
    audio.play('impact_wood', { pos, intensity: Math.min(1, d.s), volume: 1 });
    audio.play('water_splash_big', { pos, volume: 0.8 });
    this.level.ripple?.(this.disp.x, this.disp.z, 1.6);
    this.world.fx.splash(pos.setY(this.level.waterLevel + 0.05), 24, this.level.waterLevel);
    const l = this.level.game.local;
    if (!l.dead && this.isOn(l.pos)) {
      l.shake = Math.max(l.shake || 0, 0.6 + d.s * 0.3);
      // a hard jolt throws riders off balance — toward the water
      const k = d.s * (1.4 + Math.random() * 1.6);
      l.applyYank?.([d.d[0] * k, 1.2 + d.s * 0.8, d.d[1] * k]);
      l.survival.sanity = Math.max(0, l.survival.sanity - 3);
    }
  }

  _onSnap(d) {
    if (net.isHost) return;
    const [x, z, yaw, vx, vz, moored] = d;
    this.s.x = x; this.s.z = z; this.s.yaw = yaw; this.s.vx = vx; this.s.vz = vz;
    this.moored = !!moored;
    this.snapAge = 0;
  }

  serializeState() { return [this.s.x, this.s.z, this.s.yaw, this.s.vx, this.s.vz, this.moored ? 1 : 0]; }
  applyState(a) { if (Array.isArray(a)) { this._onSnap(a); this.disp.x = this.s.x; this.disp.z = this.s.z; this.disp.yaw = this.s.yaw; } }

  // ------------------------------------------------------------------
  _hostStep(dt) {
    const s = this.s;
    let ax = 0, az = 0, n = 0;
    for (let i = this.thrust.length - 1; i >= 0; i--) {
      const t = this.thrust[i];
      t.t -= dt;
      if (t.t <= 0) { this.thrust.splice(i, 1); continue; }
      ax += t.x * t.k; az += t.z * t.k; n++;
    }
    if (n) {
      // one punter ~1.9 m/s, more punters add up (diminishing)
      const crew = Math.min(4, this.thrust.length / 2.5);
      const acc = 1.25 * (1 + Math.max(0, crew - 1) * 0.35);
      const l = Math.hypot(ax, az) || 1;
      ax = (ax / l) * acc; az = (az / l) * acc;
    }
    s.vx += ax * dt; s.vz += az * dt;
    // water drag: low along the raft's length, higher sideways
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    let along = s.vx * c - s.vz * sn, side = s.vx * sn + s.vz * c;
    along *= Math.exp(-0.32 * dt);
    side *= Math.exp(-1.1 * dt);
    s.vx = along * c + side * sn; s.vz = -along * sn + side * c;
    const sp = Math.hypot(s.vx, s.vz);
    if (sp > MAXV) { s.vx *= MAXV / sp; s.vz *= MAXV / sp; }
    s.x += s.vx * dt; s.z += s.vz * dt;
    // the raft turns slowly to follow its drift (it stays roughly lengthwise in the canal)
    if (sp > 0.15) {
      const want = THREE.MathUtils.clamp(Math.atan2(-s.vz, Math.abs(s.vx)) * Math.sign(s.vx || 1), -0.45, 0.45);
      s.w += (want - s.yaw) * dt * 0.8;
    }
    s.w *= Math.exp(-1.6 * dt);
    s.yaw += s.w * dt;
    s.yaw = THREE.MathUtils.clamp(s.yaw, -0.6, 0.6);
    // the canal walls
    const ext = Math.abs(Math.sin(s.yaw)) * RAFT_HL + Math.abs(Math.cos(s.yaw)) * RAFT_HW + 0.06;
    const z0 = CANAL_Z0 + ext, z1 = CANAL_Z1 - ext;
    const x0 = CANAL_X0 + 2.4 + RAFT_HL;
    let bump = 0;
    if (s.z < z0) { s.z = z0; if (s.vz < 0) { bump = -s.vz; s.vz *= -0.25; } s.w += 0.1 * Math.sign(s.vx || 1); }
    if (s.z > z1) { s.z = z1; if (s.vz > 0) { bump = s.vz; s.vz *= -0.25; } s.w -= 0.1 * Math.sign(s.vx || 1); }
    if (s.x < x0) { s.x = x0; if (s.vx < 0) { bump = Math.max(bump, -s.vx); s.vx *= -0.2; } }
    this.bumpT -= dt;
    if (bump > 0.5 && this.bumpT <= 0) {
      this.bumpT = 0.6;
      this.world.fxAll({ k: 'snd', n: 'impact_wood', p: [s.x, 0.1, s.z], i: Math.min(1, bump / 2), v: 0.8 });
      this.world.noise.emit(_v.set(s.x, 0.2, s.z), 6 + bump * 6, 'raft');
    }
    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = 1 / 15;
      net.toAll('raft', this.serializeState().map((v, i) => (i < 5 ? +v.toFixed(3) : v)));
    }
  }

  update(dt) {
    this.time += dt;
    if (net.isHost) {
      this._hostStep(dt);
      this.disp.x = this.s.x; this.disp.z = this.s.z; this.disp.yaw = this.s.yaw;
    } else {
      // extrapolate the last snapshot, ease the display toward it
      this.snapAge += dt;
      const t = Math.min(this.snapAge, 0.4);
      const tx = this.s.x + this.s.vx * t, tz = this.s.z + this.s.vz * t;
      const k = 1 - Math.exp(-dt * 8);
      this.disp.x += (tx - this.disp.x) * k;
      this.disp.z += (tz - this.disp.z) * k;
      this.disp.yaw += (this.s.yaw - this.disp.yaw) * k;
    }
    const y = this._deckY() + Math.sin(this.time * 1.3) * 0.015;
    // carry the local clone (and the camera) along with the deck
    const lp = this.level.game.local;
    const dyaw = this.disp.yaw - this.prev.yaw, dx = this.disp.x - this.prev.x, dz = this.disp.z - this.prev.z, dy = y - this.prev.y;
    if (lp && !lp.dead && lp.world && (Math.abs(dx) + Math.abs(dz) + Math.abs(dyaw) + Math.abs(dy)) > 1e-6) {
      // test against the previous transform (where the clone stood this frame)
      const rx = lp.pos.x - this.prev.x, rz = lp.pos.z - this.prev.z;
      const c0 = Math.cos(this.prev.yaw), s0 = Math.sin(this.prev.yaw);
      const lx = rx * c0 - rz * s0, lz = rx * s0 + rz * c0, ly = lp.pos.y - this.prev.y;
      if (Math.abs(lx) < RAFT_HL + 0.1 && Math.abs(lz) < RAFT_HW + 0.1 && ly > -0.2 && ly < 0.45 && lp.vel.y < 2) {
        const c1 = Math.cos(this.disp.yaw), s1 = Math.sin(this.disp.yaw);
        const nx = this.disp.x + lx * c1 + lz * s1, nz = this.disp.z - lx * s1 + lz * c1;
        const mx = nx - lp.pos.x, mz = nz - lp.pos.z, my = Math.max(0, dy);
        lp.pos.x = nx; lp.pos.z = nz; lp.pos.y += my;
        lp.yaw += dyaw;
        engine.camera.position.x += mx; engine.camera.position.z += mz; engine.camera.position.y += my;
        lp.onRaft = true;
      } else lp.onRaft = false;
    }
    // host: loose props resting on the deck (the radio!) ride along too
    if (net.isHost && (Math.abs(dx) + Math.abs(dz) + Math.abs(dyaw)) > 1e-5) this._carryProps(dx, dz, dyaw, Math.max(0, dy));
    this.prev.x = this.disp.x; this.prev.z = this.disp.z; this.prev.yaw = this.disp.yaw; this.prev.y = y;
    // kinematic collider: teleported (zero platform velocity — riders are carried explicitly above,
    // the character controller would otherwise add its own frame-rate dependent platform push)
    this.body.setTranslation({ x: this.disp.x, y, z: this.disp.z }, true);
    _q.setFromAxisAngle(UP, this.disp.yaw);
    this.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    this.rock = Math.max(0, this.rock - dt * 0.7);
    const sp = Math.hypot(this.s.vx, this.s.vz);
    const rr = this.rock * Math.sin(this.time * 7.3) * 0.12;
    this.root.position.set(this.disp.x, y, this.disp.z);
    _e.set(Math.sin(this.time * 0.9) * 0.012 + rr * Math.sin(this.rockAxis), this.disp.yaw, Math.sin(this.time * 1.1 + 1) * 0.015 + rr * Math.cos(this.rockAxis) - sp * 0.008, 'YXZ');
    this.root.rotation.copy(_e);
    // lantern swings
    this.model.lantern.rotation.z = Math.sin(this.time * 1.7) * 0.12 + this.rock * Math.sin(this.time * 6) * 0.3;
    this.model.lantern.rotation.x = Math.sin(this.time * 1.3 + 2) * 0.08;
    // bow wave
    if (sp > 0.6 && Math.random() < dt * (2 + sp * 2)) {
      const f = Math.sign(this.s.vx || 1);
      this.level.ripple?.(this.disp.x + f * (RAFT_HL + 0.2), this.disp.z + (Math.random() - 0.5) * 2, 0.5 + sp * 0.25);
    }
  }

  _carryProps(dx, dz, dyaw, dy) {
    const px = this.prev.x, pz = this.prev.z, c0 = Math.cos(this.prev.yaw), s0 = Math.sin(this.prev.yaw);
    const c1 = Math.cos(this.disp.yaw), s1 = Math.sin(this.disp.yaw);
    const deckY = this.prev.y;
    _v.set(px, deckY, pz);
    this.world.props.query(_v, RAFT_HL + RAFT_HW, (p) => {
      const b = p.body;
      if (!b || p.frozen || p.dead || p.isHeld?.()) return;
      const t = b.translation();
      const rx = t.x - px, rz = t.z - pz, ly = t.y - deckY;
      const lx = rx * c0 - rz * s0, lz = rx * s0 + rz * c0;
      if (Math.abs(lx) > RAFT_HL + 0.05 || Math.abs(lz) > RAFT_HW + 0.05 || ly < -0.05 || ly > 1.6) return;
      if (Math.abs(b.linvel().y) > 1.5) return;
      const nx = this.disp.x + lx * c1 + lz * s1, nz = this.disp.z - lx * s1 + lz * c1;
      b.setTranslation({ x: nx, y: t.y + dy, z: nz }, true);
      if (Math.abs(dyaw) > 1e-5) {
        const r = b.rotation();
        const q = new THREE.Quaternion(r.x, r.y, r.z, r.w).premultiply(_q.setFromAxisAngle(UP, dyaw));
        b.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      }
      p.root.position.set(nx, t.y + dy, nz);
    });
    void dx; void dz;
  }

  dispose() {
    net.clientHandlers.delete('raft');
    net.clientHandlers.delete('raftjolt');
    super.dispose();
  }
}
