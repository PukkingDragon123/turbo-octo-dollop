// Level 0 onboarding (built by CampMission on every peer): you arrive without Healthity. Two crates wait
// between the arrival lift and the camp:
//   crate A  "RATIONS / FIRST AID": [E] opens it, basic supplies fly out (food, drink, bandage, flashlight)
//   crate B  "MEDICAL UNIT. DO NOT REACTIVATE": knocks from the inside now and then; [E] opens it and a broken,
//            sparking Healthity slumps out onto the floor. [E] on it starts the repair minigame
//            (game/repairgame.js); when it is fixed, every peer's Healthity boots from that spot.
// Arrival narration floats in as 3D notices (mission.onArrival -> onboarding.onArrival).
// Devices: 'ob_crate_a', 'ob_crate_b' (state { open, empty, fixed, by }).
import * as THREE from 'three';
import { net } from '../net/net.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { ModelDevice } from './devicekinds.js';
import { buildHealthity } from '../entities/optional.js';
import { floatText } from '../ui/floattext.js';
import { campToWorld } from './campdevices.js';
import { Q } from '../physics/physics.js';

const SUPPLIES = ['protein_bar', 'almond_milk', 'bandage', 'flashlight'];
const SPOTS = [[-1.55, 3.35, 0.25], [1.3, 4.05, -0.3]]; // camp-local x, z, yaw offset (camp +z faces the lift)
const HH = 0.3;            // crate half height (model origin = centre)
const BOT_SCALE = 0.72;    // same as the companion
const NARRATE = '#e9e0bd';
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

function tagTexture(lines, opts = {}) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = opts.paper || '#e6dcc0'; x.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '120,100,60' : '255,250,235'},0.12)`; x.fillRect(Math.random() * 512, Math.random() * 256, 2, 2); }
  x.strokeStyle = 'rgba(40,30,20,0.8)'; x.lineWidth = 6; x.strokeRect(12, 12, 488, 232);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  lines.forEach(([t, y, px, col, font]) => { x.font = `${font || 'bold'} ${px}px "Courier New", monospace`; x.fillStyle = col || '#2a2018'; x.fillText(t, 256, y); });
  if (opts.cross) { x.fillStyle = '#9e3528'; x.fillRect(46, 70, 22, 66); x.fillRect(24, 92, 66, 22); }
  if (opts.scrawl) { x.save(); x.translate(330, 214); x.rotate(-0.08); x.font = 'italic 30px cursive, serif'; x.fillStyle = 'rgba(70,60,70,0.85)'; x.fillText(opts.scrawl, 0, 0); x.restore(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

class Crate extends ModelDevice {
  constructor(world, id, ob, spot, tag) {
    super(world, id, 'supply_crate', { state: { open: 0 } });
    this.ob = ob;
    this.game = world.game;
    const p = ob.place(spot[0], spot[1]);
    this.root.position.set(p.x, p.y + HH, p.z);
    this.root.rotation.y = ob.mission.camp.yaw + spot[2];
    this.root.updateMatrixWorld(true);
    this.baseY = this.root.position.y;
    this.build();
    this.anim = 0;
    this.vel = 0;
    // paper tag on the front
    this.tagMat = new THREE.MeshStandardMaterial({ map: tag, roughness: 0.9 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17), this.tagMat);
    m.position.set(0.12, -0.04, 0.3045); m.rotation.z = -0.04;
    this.root.add(m);
    this.tag = m;
  }
  prompt() { return this.state.open ? null : `[${input.keyName('interact')}] Open crate`; }
  interact() { this.send('open'); }
  hostAction(a, d, from) { if (a === 'open' && !this.state.open) this.hostOpen(from); }
  onState(s, sync) { if (s.open && sync) this.anim = 1; }
  hostOpen() {}
  update(dt) {
    // spring the lid open (it slams back a little)
    const target = this.state.open ? 1 : 0;
    this.vel += ((target - this.anim) * 90 - this.vel * 9) * dt;
    this.anim = Math.max(0, Math.min(1.08, this.anim + this.vel * dt));
    const lid = this.parts.lid;
    if (lid) lid.rotation.x = (this.model.params?.lidOpenSign ?? -1) * this.anim * 1.9;
  }
  dispose() { super.dispose(); this.tagMat.map?.dispose(); this.tagMat.dispose(); }
}

// crate A: basic supplies, one set per clone
class SupplyCrate extends Crate {
  constructor(world, ob, spot) {
    super(world, 'ob_crate_a', ob, spot, tagTexture([['RATIONS', 70, 54], ['& FIRST AID', 128, 36], ['FOR NEW EMPLOYEES', 182, 26]]));
  }
  hostOpen() {
    const w = this.world;
    this.setState({ open: 1 });
    const items = [];
    for (let k = 0; k < Math.max(1, this.game.roster?.size || 1); k++) items.push(...SUPPLIES);
    const base = this.root.position;
    const fwd = _v.set(0, 0, 1).applyQuaternion(this.root.quaternion).clone();
    items.forEach((t, i) => {
      const a = (i / items.length) * Math.PI * 1.4 - 0.7 + Math.atan2(fwd.x, fwd.z);
      const pos = base.clone().add(new THREE.Vector3(Math.sin(a) * 0.2, 0.42 + (i % 3) * 0.12, Math.cos(a) * 0.2));
      w.props.spawn(t, pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random(), Math.random() * 6, 0)), {
        vel: new THREE.Vector3(Math.sin(a) * 1.5, 2.6 + Math.random() * 1.2, Math.cos(a) * 1.5),
        state: t === 'flashlight' ? { charge: 1 } : {},
      });
    });
    w.fxAll({ k: 'snd', n: 'locker_open', p: base.toArray(), v: 1 });
    w.fxAll({ k: 'snd', n: 'paper', p: base.toArray(), v: 0.8 });
    w.fxAll({ k: 'dust', p: [base.x, base.y + 0.3, base.z], n: 22 });
  }
}

// crate B: the broken Healthity
class BotCrate extends Crate {
  constructor(world, ob, spot) {
    super(world, 'ob_crate_b', ob, spot, tagTexture([['MEDICAL UNIT', 74, 50], ['FRAGILE  -  THIS WAY UP', 128, 26], ['DO NOT REACTIVATE', 176, 34, '#8e2a20']], { cross: true, scrawl: 'it still talks' }));
    this.state = { open: 0, empty: 0, fixed: 0 };
    this.knockT = 5 + Math.random() * 5;
    this.shake = 0;
    this.outT = -1;
    this.sparkT = 2;
    this.flick = 0;
    // resting pose of the slumped unit, crate-local: in front of the crate, face tilted up, rolled on its side
    this.restLocal = new THREE.Vector3(0.06, -HH + 0.15 * BOT_SCALE - 0.004, 0.74);
    this.restQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.05, 0.35, 0.55));
  }
  hostOpen() {
    const empty = this.game.run?.healthity ? 1 : 0;
    this.setState({ open: 1, empty });
    const w = this.world, base = this.root.position;
    w.fxAll({ k: 'snd', n: 'locker_open', p: base.toArray(), v: 1 });
    w.fxAll({ k: 'dust', p: [base.x, base.y + 0.3, base.z], n: 30 });
    if (empty) {
      ['screws', 'battery'].forEach((t, i) => w.props.spawn(t, base.clone().add(new THREE.Vector3(0, 0.45, 0)), new THREE.Quaternion(), { vel: new THREE.Vector3((i - 0.5) * 1.2, 2.5, 0.8) }));
    }
  }
  hostAction(a, d, from) {
    if (a === 'open' && !this.state.open) this.hostOpen(from);
    if (a === 'fixed' && this.state.open && !this.state.empty && !this.state.fixed) this.setState({ fixed: 1, by: from });
  }
  onState(s, sync) {
    super.onState(s, sync);
    if (s.open && !this.state.empty && this.outT < 0) { this._ensureBot(); this.outT = sync ? 99 : 0; }
    if (s.fixed) {
      const from = this.botPose();
      this._removeBot();
      const h = this.game.healthity;
      if (sync || !from) { if (!h.active) h.activate({ quiet: true }); }
      else h.activate({ from, local: s.by === net.selfId });
    }
  }
  botPose() {
    if (!this.bot) return null;
    this.bot.root.updateMatrixWorld(true);
    return { pos: this.bot.root.getWorldPosition(new THREE.Vector3()), quat: this.bot.root.getWorldQuaternion(new THREE.Quaternion()) };
  }
  _ensureBot() {
    if (this.bot || this.state.fixed) return;
    const b = (this.bot = buildHealthity());
    b.root.scale.setScalar(BOT_SCALE);
    b.setPower(0);
    b.setFace('off');
    this.world.group.add(b.root);
  }
  _removeBot() {
    if (this.collider) { try { this.world.physics.removeCollider(this.collider); } catch (e) { /* gone */ } this.collider = null; }
    if (this.bot) { this.bot.root.removeFromParent(); this.bot.root.userData.dispose?.(); this.bot = null; }
    if (this.game.healthity?.repair?.active && this.game.healthity.repair.o?.crate === this) this.game.healthity.repair.close(false);
  }
  _addCollider(p) {
    const self = this;
    this.pick = {
      prompt() { return self.state.fixed ? null : `[${input.keyName('interact')}] Repair Healthity (multitool)`; },
      interact() { self.startRepair(); },
      holdTime: 0,
    };
    this.collider = this.world.physics.addStaticBox(p.x, p.y, p.z, 0.12, 0.11, 0.12, { kind: 'device', device: this.pick });
  }
  startRepair() {
    const h = this.game.healthity;
    if (!h || this.state.fixed) return;
    audio.play('multitool', { volume: 0.5, bus: 'ui' });
    h.repair.open({
      crate: this,
      seed: 1979 + (net.selfId || '').length,
      onDone: () => this.send('fixed'),
      abort: () => !!this.state.fixed,
    });
  }
  update(dt) {
    super.update(dt);
    this.onTick?.(dt);
    const g = this.game, l = g.local;
    const near = l && !l.dead ? this.root.position.distanceTo(l.pos) : 99;
    // closed: something knocks from the inside now and then
    if (!this.state.open && !g.run?.healthity) {
      this.knockT -= dt;
      if (this.knockT <= 0) {
        this.knockT = 6 + Math.random() * 8;
        if (near < 10) { audio.play('hl_knock', { pos: this.root.position, volume: 0.9 }); this.shake = 0.35; }
      }
      if (near < 2.6 && !this.ob.stencilSeen) { this.ob.stencilSeen = true; this.ob.narrate('A stencil on the crate: "MEDICAL UNIT. DO NOT REACTIVATE."'); }
    }
    if (this.shake > 0) {
      this.shake -= dt;
      const k = Math.max(0, this.shake);
      this.root.rotation.z = Math.sin(k * 70) * 0.025 * Math.min(1, k * 4);
      this.root.position.y = this.baseY + Math.abs(Math.sin(k * 45)) * 0.01 * Math.min(1, k * 4);
    }
    // the slump: up over the front edge, a heavy roll, a bounce, then it lies there sparking
    if (this.bot && this.outT >= 0) {
      const b = this.bot;
      const was = this.outT;
      this.outT += dt;
      const T = 1.15, k = Math.min(1, this.outT / T);
      const p0 = new THREE.Vector3(0, -0.05, 0), p1 = new THREE.Vector3(0.02, 0.5, 0.32), p2 = this.restLocal;
      const a = p0.clone().lerp(p1, k), c = p1.clone().lerp(p2, k);
      const pos = a.lerp(c, k);
      if (k >= 1) { const bt = this.outT - T; pos.copy(p2); pos.y += Math.abs(Math.sin(bt * 9)) * Math.exp(-bt * 6) * 0.05; }
      b.root.position.copy(pos).applyMatrix4(this.root.matrixWorld);
      _q.setFromEuler(_e.set(-2.4 * k, 0.6 * k, 1.2 * k)).slerp(this.restQ, Math.min(1, Math.max(0, (this.outT - 0.7) / 0.6)));
      b.root.quaternion.copy(this.root.quaternion).multiply(_q);
      if (was < T * 0.98 && this.outT >= T * 0.98 && was < 50) {
        audio.play('thunk', { pos: b.root.position, volume: 1, pitch: 0.7 });
        audio.play('hl_dying', { pos: b.root.position, volume: 0.9 });
        this.world.fx?.sparks?.(b.root.position, 26, null, [1, 0.8, 0.4], 2.6);
        this.world.fx?.dustBurst?.(b.root.position, 14, [0.75, 0.7, 0.55], 0.6);
        this.flick = 0.5;
      }
      if (this.outT >= T && !this.collider && !this.state.fixed) {
        b.root.updateMatrixWorld(true);
        this._addCollider(b.root.position);
        if (was < 50) setTimeout(() => { if (!this.disposed && !this.state.fixed && near < 12) this.ob.narrate('It is still sparking. Your multitool could fix that.'); }, 2200);
      }
      // dying unit: sparks from the crack, the CRT stutters into static and dies again
      if (this.outT > T) {
        this.sparkT -= dt;
        if (this.sparkT <= 0) {
          this.sparkT = 1.2 + Math.random() * 2.2;
          _v.set(0.06, 0.08, 0.05).applyQuaternion(b.root.quaternion).add(b.root.position);
          this.world.fx?.sparks?.(_v, 6 + Math.floor(Math.random() * 6), null, [1, 0.8, 0.4], 1.6);
          if (near < 12) audio.play('spark', { pos: _v, volume: 0.35 });
          if (Math.random() < 0.5) this.flick = 0.18;
        }
      }
      this.flick -= dt;
      if (this.flick > 0) { b.setPower(0.35); b.setFace(Math.random() < 0.5 ? 'static' : 'dead'); } else { b.setPower(0); b.setFace('off'); }
      b.update(dt);
    }
  }
  dispose() { this.disposed = true; this._removeBot(); super.dispose(); }
}

export class Onboarding {
  constructor(mission) {
    this.mission = mission;
    this.world = mission.world;
    this.game = mission.game;
    this.introduced = false;
    this.timers = [];
    const w = this.world;
    this.crateA = new SupplyCrate(w, this, SPOTS[0]);
    this.crateB = new BotCrate(w, this, SPOTS[1]);
    for (const c of [this.crateA, this.crateB]) { w.addDevice(c); this.mission.level.prepStatic?.(c.root, null); }
    // narration fallback when nobody arrives by lift (direct dispatch / late join)
    this.fallbackT = 9;
    this.crateB.onTick = (dt) => this._tick(dt);
  }

  // a camp-local spot pulled in from walls (camp centre -> spot line of sight)
  place(lx, lz) {
    const camp = this.mission.camp;
    const p = campToWorld(camp, lx, 0, lz);
    const o = camp.pos.clone(); o.y += 0.5;
    const d = new THREE.Vector3(p.x - o.x, 0, p.z - o.z);
    const dist = d.length();
    d.normalize();
    try {
      const hit = this.world.physics.raycast(o, d, dist + 0.7, Q.world);
      if (hit && hit.dist < dist + 0.7) p.copy(o).addScaledVector(d, Math.max(1.2, hit.dist - 0.8));
    } catch (e) { /* physics not ready: keep the spot */ }
    p.y = this.mission._floorY(p.x, p.z);
    return p;
  }

  narrate(text, delay = 0) {
    const fire = () => { if (this.game.world === this.world) floatText.notice(text, { color: NARRATE, duration: 3.2 + text.length * 0.05 }); };
    if (delay > 0) this.timers.push(setTimeout(fire, delay * 1000)); else fire();
  }

  // every peer, when the arrival lift opens (CampMission.onArrival)
  onArrival() {
    if (this.introduced) return;
    this.introduced = true;
    this.narrate('The doors shut behind you. There is no button on this side.', 0.6);
    if (!this.game.run?.healthity) this.narrate('Two crates wait by the camp. One of them is knocking.', 6.5);
  }

  _tick(dt) {
    if (this.introduced) return;
    const g = this.game;
    if (g.ride?.active || g.state !== 'playing' || this.game.world !== this.world) return;
    this.fallbackT -= dt;
    if (this.fallbackT <= 0) this.onArrival();
  }

  dispose() { for (const t of this.timers) clearTimeout(t); this.timers = []; }
}
