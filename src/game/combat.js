// Fists, knock-outs and gore for the local clone.
//   * LMB punch (hold to wind up a haymaker, release to swing; quick clicks alternate jabs). Weapons in the
//     right hand ('swing' items: crowbar, wrench) swing harder and further.
//   * Hits go to monsters first (world.monsters.applyHit, CREATURES), then teammates (knockback, a hard hit
//     or a flurry knocks them out: a real physics ragdoll for ~2 s, then they get up), then physics props.
//   * A clone killed by a big hit breaks apart: the host snaps its ragdoll's joints, flings the limbs and
//     scatters robot parts (plates, gears, wire) in a spray of green plasma and black oil.
// Net (host-relayed like yank / grab): punch -> punched, ko / koEnd (host spawns / removes the KO ragdoll
// through level.spawnBody('ko:<id>')), gore -> goreFx.
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { input } from '../core/input.js';
import { net } from '../net/net.js';
import { G, groups, Q } from '../physics/physics.js';
import { audio } from '../audio/audio.js';
import { juice } from '../gfx/juice.js';
import { clamp, damp } from '../core/rng.js';
import { itemDef } from './itemdefs.js';

export const COMBAT = {
  chargeTime: 0.7,        // s to a full haymaker
  swingTime: 0.26,        // s of one swing
  hitAt: 0.32,            // swing fraction where the fist connects
  range: 1.65, weaponRange: 2.15,
  damage: [7, 25], weaponDamage: [16, 40],
  friendDamage: [2, 8],
  koPower: 0.8,           // a punch this hard always knocks a teammate out
  dazePerHit: [0.3, 0.9], // daze added per hit; 1 = knocked out (decays 0.35/s)
  koTime: 2.2,
  goreDamage: 30,         // killing blow this big tears the clone apart
};

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _f = new THREE.Vector3();
const GORE_PARTS = ['metal_scrap', 'metal_scrap', 'gear', 'wire_spool', 'screws'];

export class Combat {
  constructor(player) {
    this.p = player;
    this.game = player.game;
    this.winding = false;
    this.charge = 0;
    this.swing = null;      // { t, side, power, weapon, hit }
    this.nextSide = 1;
    this.daze = 0;
    this.ko = null;         // { t, dur, key, rag, torsoId }
    this.getUp = 0;
    this.bindNet();
  }

  get busy() { return !!(this.winding || this.swing); }

  bindNet() {
    net.onHost('punch', (d, from) => {
      const w = this.game.world;
      if (w && d.p) w.fxAll({ k: 'snd', n: 'punch_hit', p: d.p, v: 0.9, i: d.f ?? 0.5 });
      const msg = { ...d, from };
      if (d.to === net.selfId) this.onPunched(msg);
      else net.toPeer(d.to, 'punched', msg);
    });
    net.onClient('punched', (d) => this.onPunched(d));
    net.onHost('ko', (d, from) => this._hostKO(d, from));
    net.onHost('koEnd', (d, from) => this.game.world?.level?.removeBody?.('ko:' + from));
    net.onHost('gore', (d, from) => this._hostGore(d, from));
    net.onClient('goreFx', (d) => this._goreFx(d));
  }

  // ---------------- local punching ----------------
  // opts: { weapon (item|null), sides: { R: free, L: free } }
  input(dt, opts) {
    if (this.ko) return;
    const s = this.swing;
    if (!this.winding && !s && input.mouseHit(0)) { this.winding = true; this.charge = 0; this.windSide = this._side(opts); }
    if (this.winding) {
      if (input.mouseDown(0)) {
        const was = this.charge;
        this.charge = Math.min(1, this.charge + dt / COMBAT.chargeTime);
        if (was < 1 && this.charge >= 1) audio.play('android_servo', { volume: 0.35 });
      } else {
        this.winding = false;
        this._throw(this.charge, this.windSide, opts.weapon);
      }
    }
    if (this.swing) {
      const sw = this.swing;
      sw.t += dt / (COMBAT.swingTime * (sw.weapon ? 1.25 : 1));
      if (!sw.hit && sw.t >= COMBAT.hitAt) { sw.hit = true; this._resolve(sw); }
      if (sw.t >= 1) this.swing = null;
    }
  }

  cancel() { this.winding = false; this.swing = null; this.charge = 0; }

  _side(opts) {
    if (opts.weapon) return 1;
    const R = opts.sides?.R !== false, L = opts.sides?.L !== false;
    if (R && L) { this.nextSide = -this.nextSide; return this.nextSide; }
    if (L && !R) return -1;
    return 1;
  }

  _throw(charge, side, weapon) {
    const power = clamp(charge, 0, 1);
    this.swing = { t: 0, side, power, weapon: weapon || null, hit: false };
    audio.play('punch_swing', { volume: 0.5 + power * 0.4, intensity: power });
    if (power > 0.6) juice.punch(0.02 * power);
    this.p.stats.punches = (this.p.stats.punches || 0) + 1;
  }

  // fparms weights: wind-up and jab extension per side
  armState() {
    const o = { windR: 0, jabR: 0, windL: 0, jabL: 0 };
    if (this.winding) o[this.windSide < 0 ? 'windL' : 'windR'] = 0.25 + this.charge * 0.75;
    const sw = this.swing;
    if (sw) {
      const t = sw.t, e = t < 0.38 ? Math.sin((t / 0.38) * Math.PI / 2) : Math.max(0, 1 - (t - 0.38) / 0.62) ** 1.6;
      o[sw.side < 0 ? 'jabL' : 'jabR'] = e;
    }
    return o;
  }

  _resolve(sw) {
    const p = this.p, w = p.world;
    if (!w) return;
    const cam = engine.camera;
    const origin = cam.position.clone();
    const dir = _f.set(0, 0, -1).applyQuaternion(cam.quaternion).clone();
    // shop weapons carry stats (itemdefs weapon: dmg = hits per swing, range, knock)
    const ws = sw.weapon ? itemDef(sw.weapon.type).weapon : null;
    const range = ws?.range ?? (sw.weapon ? COMBAT.weaponRange : COMBAT.range);
    const [d0, d1] = sw.weapon ? COMBAT.weaponDamage : COMBAT.damage;
    const damage = (d0 + (d1 - d0) * sw.power) * (ws ? Math.max(0.6, ws.dmg * 0.7) : 1);
    const kind = sw.weapon ? 'weapon' : 'punch';
    // 1) monsters (the creature manager does its own cone test and reports what it hit)
    let res = null;
    try { res = w.monsters?.applyHit?.({ origin, dir: dir.clone(), range, damage, from: net.selfId, kind, power: sw.power }); } catch (e) { console.error('[combat] applyHit', e); }
    if (res) {
      const pt = res.point?.isVector3 ? res.point.clone() : Array.isArray(res.point) ? new THREE.Vector3().fromArray(res.point) : origin.clone().addScaledVector(dir, range * 0.7);
      this._landed(pt, sw, 'flesh');
      return;
    }
    // 2) the view ray + a cone check for teammates (a chest is easy to miss with a thin ray)
    const hit = w.physics.raycast(origin, dir, range, Q.all & ~groups(0, G.PLAYER), null, (c) => c !== p.collider && !p._isGrabbedCollider(c));
    let best = null, bd = range + 0.3;
    for (const r of this.game.remotes.values()) {
      if (r.dead || !r.inWorld) continue;
      const chest = _v2.copy(r.pos).setY(r.pos.y + 0.95);
      const to = chest.sub(origin);
      const d = to.length();
      if (d > range + 0.35 || d < 0.05) continue;
      if (to.normalize().dot(dir) < 0.88) continue;
      if (hit && hit.ud?.kind !== 'remote' && hit.dist < d - 0.25) continue; // something solid in between
      if (d < bd) { bd = d; best = r; }
    }
    if (best || (hit?.ud?.kind === 'remote' && hit.ud.remote && !hit.ud.remote.dead)) {
      const r = best || hit.ud.remote;
      const at = r.pos.clone().setY(r.pos.y + 0.95);
      net.toHost('punch', { to: r.id, d: [dir.x, dir.y, dir.z], f: +sw.power.toFixed(2), w: sw.weapon ? 1 : 0, p: at.toArray().map((x) => +x.toFixed(2)) });
      this._landed(at, sw, null, true); // the host broadcasts the smack
      return;
    }
    if (!hit) return; // whiff
    const ud = hit.ud;
    if (ud?.kind === 'prop' && ud.prop) {
      net.toHost('hit', { id: ud.prop.id, p: hit.point.toArray(), d: dir.toArray(), f: Math.max(0.3, sw.power) * (ws?.knock ?? 1), w: sw.weapon ? 1 : 0 });
      this._landed(hit.point, sw, ud.prop.material);
    } else if (ud?.kind === 'monster' && ud.monster) {
      net.toHost('hit', { mon: ud.monster.id, p: hit.point.toArray(), d: dir.toArray(), f: sw.power, w: sw.weapon ? 1 : 0 });
      this._landed(hit.point, sw, 'flesh');
    } else {
      // a wall: knuckles on concrete
      audio.play(sw.weapon ? 'impact_metal' : 'punch_hit', { pos: hit.point, intensity: 0.4 + sw.power * 0.4, volume: 0.6 });
      w.fx.dustBurst(hit.point, 4, [0.7, 0.66, 0.5], 0.3);
      juice.shake(0.12 + sw.power * 0.15);
      juice.hitstop(25);
    }
  }

  _landed(point, sw, mat, quiet = false) {
    const w = this.p.world;
    const pw = sw.power;
    juice.hitstop(35 + pw * 70);
    juice.shake(0.16 + pw * 0.34);
    if (pw > 0.7) juice.flash(0.08);
    if (!quiet) audio.play('punch_hit', { pos: point, intensity: pw, volume: 0.8 + pw * 0.2 });
    if (mat === 'flesh') w.fx.blood(point, 4 + Math.floor(pw * 8));
    else w.fx.sparks(point, 3 + Math.floor(pw * 6), null, [1, 0.85, 0.6], 2 + pw * 2);
    w.noise.emit(point, 6 + pw * 8, 'punch');
  }

  // ---------------- being punched ----------------
  onPunched(d) {
    const p = this.p;
    if (p.dead || this.ko) return;
    const f = clamp(d.f ?? 0.5, 0, 1);
    const dir = _v.fromArray(d.d || [0, 0, 1]).setY(0).normalize();
    const kb = (d.w ? 4 : 3) + 7 * f;
    p.applyYank([dir.x * kb, 1.4 + 2.6 * f, dir.z * kb]);
    const [a, b] = COMBAT.friendDamage;
    const died = p.survival.damage((a + (b - a) * f) * (d.w ? 1.8 : 1), 'blunt', { cause: 'a teammate' });
    p.shake = Math.max(p.shake, 0.5 + f * 0.5);
    juice.shake(0.3 + f * 0.4);
    juice.hitstop(30 + f * 50);
    audio.play('hurt', { volume: 0.8 });
    if (died) { p.onDeath('a teammate'); return; }
    this.daze += COMBAT.dazePerHit[0] + (COMBAT.dazePerHit[1] - COMBAT.dazePerHit[0]) * f;
    if (f >= COMBAT.koPower || this.daze >= 1) this.startKO(new THREE.Vector3(dir.x * kb, 2 + f * 2, dir.z * kb));
  }

  startKO(vel = new THREE.Vector3()) {
    const p = this.p;
    if (this.ko || p.dead || !p.world) return;
    p.releaseGrab(false);
    p._cancelUse?.();
    this.cancel();
    const w = p.world;
    const rag = !!(w.level?.spawnBody && w.customModel);
    this.ko = { t: 0, dur: COMBAT.koTime, key: 'ko:' + net.selfId, rag, torsoId: null, yaw: p.yaw, pitch: -0.5 };
    this.daze = 0;
    if (p.collider) p.collider.setEnabled(false);
    net.toHost('ko', { p: p.pos.toArray(), yaw: p.yaw, v: vel.toArray() });
    audio.play('robo_clunk', { volume: 0.8 });
    juice.shake(0.7);
    juice.flash(0.2);
  }

  _torso() {
    const k = this.ko, w = this.p.world;
    if (!k || !w) return null;
    if (k.torsoId != null) { const t = w.props.get(k.torsoId); if (t && !t.dead) return t; k.torsoId = null; }
    for (const pr of w.props.props.values()) if (pr.type === 'rag_torso' && pr.state?.owner === k.key) { k.torsoId = pr.id; return pr; }
    return null;
  }

  // knocked out: a dazed camera orbits the ragdoll; returns true while it owns the camera
  updateKO(dt) {
    const k = this.ko, p = this.p;
    this.daze = Math.max(0, this.daze - dt * 0.35);
    if (this.getUp > 0) this.getUp = Math.max(0, this.getUp - dt);
    if (!k) return false;
    k.t += dt;
    const torso = this._torso();
    const center = torso ? torso.root.position.clone() : p.pos.clone().setY(p.pos.y + 0.3);
    const cam = engine.camera;
    if (input.locked) { const lk = input.look(); k.yaw -= lk.x; k.pitch = clamp(k.pitch - lk.y, -1.2, 0.3); }
    const wob = Math.sin(k.t * 2.3) * 0.12 * (1 - k.t / k.dur);
    cam.quaternion.setFromEuler(new THREE.Euler(k.pitch + wob * 0.5, k.yaw + wob, wob * 0.6, 'YXZ'));
    _v.set(0, 0, 1).applyQuaternion(cam.quaternion);
    const hit = p.world.physics.raycast(center, _v, 1.8, Q.world);
    cam.position.copy(center).addScaledVector(_v, hit ? Math.max(0.25, hit.dist - 0.15) : 1.8);
    cam.fov = damp(cam.fov, 64, 4, dt);
    cam.updateProjectionMatrix();
    audio.setListener(cam.position, cam.quaternion);
    const P = engine.post?.params;
    if (P) P.uBlur.value = Math.max(P.uBlur.value, 0.5 * (1 - k.t / k.dur));
    if (k.t >= k.dur) {
      // get up where the body ended
      const at = center.clone();
      const down = p.world.physics.raycast(at.clone().setY(at.y + 0.6), _v.set(0, -1, 0), 3, Q.world);
      at.y = down ? down.point.y + 0.02 : p.pos.y;
      if (torso || !k.rag) p.teleport(at, k.yaw);
      if (p.collider) p.collider.setEnabled(true);
      net.toHost('koEnd', {});
      this.ko = null;
      this.getUp = 0.6;
      audio.play('android_servo', { volume: 0.6 });
    }
    return true;
  }

  // pose flag for teammates: 1 = hidden (a ragdoll stands in), 2 = lying-down fallback
  get poseFlag() { return this.ko ? (this.ko.rag ? 1 : 2) : 0; }

  // ---------------- host ----------------
  _hostKO(d, from) {
    const w = this.game.world, lvl = w?.level;
    if (!lvl?.spawnBody || !w.customModel) return;
    const r = this.game.roster.get(from);
    const key = 'ko:' + from;
    lvl.spawnBody(key, r?.cosmetics || (from === net.selfId ? this.p.cosmetics : {}), new THREE.Vector3().fromArray(d.p), d.yaw || 0, new THREE.Vector3().fromArray(d.v || [0, 0, 0]));
    clearTimeout(this._koTimers?.[from]);
    (this._koTimers ||= {})[from] = setTimeout(() => { if (this.game.world === w) lvl.removeBody?.(key); }, (COMBAT.koTime + 13) * 1000); // safety net if koEnd never arrives (disconnect)
  }

  // host: a clone died to a huge hit -> snap its ragdoll apart and scatter robot parts
  _hostGore(d, from) {
    const w = this.game.world;
    if (!w) return;
    const center = new THREE.Vector3().fromArray(d.p).setY(d.p[1] + 0.8);
    const push = new THREE.Vector3().fromArray(d.v || [0, 0, 0]);
    const power = clamp(d.n ?? 1, 0.5, 2);
    const ids = w.level?.mission?.bodies?.get(from) || [];
    const phys = w.physics;
    for (const id of ids) {
      const pr = w.props.get(id);
      if (!pr?.body) continue;
      const hs = [];
      try {
        phys.world.impulseJoints.forEachJointHandleAttachedToRigidBody(pr.body.handle, (h) => hs.push(h));
        for (const h of hs) { const j = phys.world.getImpulseJoint(h); if (j) phys.world.removeImpulseJoint(j, true); }
      } catch (e) { /* joint already gone */ }
      const out = pr.root.position.clone().sub(center).setY(0);
      if (out.lengthSq() < 1e-4) out.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      out.normalize().multiplyScalar(2.5 * power).add(push.clone().multiplyScalar(0.25)).setY(2 + Math.random() * 2 * power);
      const m = pr.body.mass();
      pr.body.applyImpulse({ x: out.x * m, y: out.y * m, z: out.z * m }, true);
      pr.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * m * 0.3, y: (Math.random() - 0.5) * m * 0.3, z: (Math.random() - 0.5) * m * 0.3 }, true);
    }
    GORE_PARTS.forEach((t, i) => {
      const a = (i / GORE_PARTS.length) * Math.PI * 2 + Math.random();
      const v = new THREE.Vector3(Math.cos(a) * 3 * power, 2.5 + Math.random() * 2.5, Math.sin(a) * 3 * power).add(push.clone().multiplyScalar(0.3));
      w.props.spawn(t, center.clone().add(new THREE.Vector3(Math.cos(a) * 0.15, (Math.random() - 0.5) * 0.3, Math.sin(a) * 0.15)), new THREE.Quaternion().setFromEuler(new THREE.Euler(a, a * 2, 0)), { vel: v, angvel: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8) });
    });
    net.toAll('goreFx', { p: center.toArray().map((x) => +x.toFixed(2)), v: push.toArray().map((x) => +x.toFixed(2)), n: +power.toFixed(2) });
  }

  // everyone: plasma + oil spray, sparks, plastic chips, a crunch
  _goreFx(d) {
    const w = this.game.world;
    if (!w?.fx) return;
    const c = new THREE.Vector3().fromArray(d.p);
    const push = new THREE.Vector3().fromArray(d.v || [0, 0, 0]).multiplyScalar(0.15);
    const n = d.n || 1;
    const floor = c.y - 1.2;
    const A = w.fx.alpha;
    for (let i = 0; i < 70 * n; i++) {
      const plasma = i % 3 !== 0;
      _v.set(Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 4.5).add(push);
      if (plasma) A.add(c, _v, 0.7 + Math.random() * 0.8, 0.05, 0.03, 0.15, 1.2, 0.3, 0.95, 9.8, 0.25, floor, 0);
      else A.add(c, _v, 0.8 + Math.random() * 0.8, 0.06, 0.04, 0.02, 0.02, 0.025, 0.95, 9.8, 0.3, floor, 0);
    }
    w.fx.sparks(c, 26 * n, null, [1, 0.8, 0.4], 5);
    w.fx.chunks(c, 16, 0xd8d2c0, 0.06, 4, floor, 8);
    w.fx.chunks(c, 10, 0x2a2c30, 0.05, 4.5, floor, 8);
    w.fx.flashLight(c, 0x7dff9a, 10, 0.25, 5);
    audio.play('robo_clunk', { pos: c, volume: 1 });
    audio.play('break_plastic', { pos: c, volume: 0.9 });
    audio.play('distorter_zap', { pos: c, volume: 0.6 });
    const l = this.game.local;
    if (l && !l.dead && l.pos.distanceTo(c) < 8) juice.shake(0.4);
  }
}
