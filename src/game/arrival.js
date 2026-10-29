// Level 0 ARRIVAL director (game.arrival; built by CampMission on every peer, device 'arrival_dir').
// The arrival car flings its riders out (world/elevator_ride.js hands each peer's own clone to fling()): the
// camera NOCLIPS sideways through the alcove wall (inside it the back faces drop away: the dark cell behind,
// the car still spinning seen through the wall) and is spat out of the camp's wall; the clone tumbles onto the
// carpet. Then host-authoritative beats (state.stage), each a short camera shot on every peer (no letterbox:
// eased paths from the clone's own view and back, juice, sound):
//   1 STRANDED  the alcove seals into plain wallpaper; the sound drops out (muffle, heartbeat)
//   2 CRATE     a supply crate glitches up out of the carpet, pops free and thuds down (game/onboarding.js)
//   3 BOT       a broken Healthity is spat out of the wall, a "REPAIR ME" note taped on (paper view)
//   4 FIXED     repaired (repair minigame) -> every peer's Healthity boots from the wreck
//   5 CRUSHER   the crusher phases out of a pad hall wall in heavy lurches and slams down
//   6 TERMINAL  the COMPANY STORE and FIELD OPS kiosks slide out of the camp wall; then the HQ brief
// The crusher and kiosks stay hidden and inert (setHidden) until their beat; late joiners snap to the stage.
// Once you have seen the arrival (localStorage), hold [jump] during a shot to skip the rest (the host also
// fast-forwards its timers).
//   game.arrival.begin(info)  every peer, the car is gone (CampMission.onArrival): the host starts the beats
//   game.arrival.fling(info)  this peer's clone leaves the car -> true when the noclip takes it over
import * as THREE from 'three';
import { net } from '../net/net.js';
import { engine } from '../core/engine.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { Device } from './devices.js';
import * as Mat from '../gfx/materials.js';
import { juice } from '../gfx/juice.js';
import { floatText } from '../ui/floattext.js';
import { Q } from '../physics/physics.js';
import { HEIGHT } from '../world/levels/yellow/layout.js';
import { PaperView } from './receipt.js';

export const STAGE = { WAIT: 0, STRANDED: 1, CRATE: 2, BOT: 3, FIXED: 4, CRUSHER: 5, TERMINAL: 6 };
const GAP = { 1: 5.6, 2: 6.4, 4: 6.5, 5: 8.4 }; // host: seconds spent in a stage before the next one
const SEEN_KEY = 'room.arrivalSeen';
const NARRATE = '#e9e0bd';
const PI = Math.PI;
const UP = new THREE.Vector3(0, 1, 0), ZAX = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const ease = (k) => k * k * (3 - 2 * k);
const easeOut = (k) => 1 - (1 - k) ** 3;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const seen = () => { try { return localStorage.getItem(SEEN_KEY) === '1'; } catch (e) { return false; } };
const markSeen = () => { try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* private mode */ } };

// camera orientation looking from eye at target, rolled about the view axis
function lookQ(eye, at, roll = 0, out = new THREE.Quaternion()) {
  _m.lookAt(eye, at, UP);
  out.setFromRotationMatrix(_m);
  if (roll) out.multiply(_q.setFromAxisAngle(ZAX, roll));
  return out;
}

export class ArrivalDirector extends Device {
  constructor(mission) {
    super(mission.world, 'arrival_dir', { state: { stage: 0, by: null, noBot: 0 } });
    this.mission = mission;
    this.game = mission.game;
    this.level = mission.level;
    this.ob = mission.onboarding;
    if (this.ob) this.ob.director = this;
    this.reader = new PaperView(this.game);
    this.queue = [];
    this.cur = null;
    this.applied = 0;      // last stage whose beat was queued / snapped on this peer
    this.hostT = 0;        // host: time in the current stage
    this.waitT = 0;        // host: nobody arrived by lift
    this.begun = false;
    this.skipAll = false;
    this.holdT = 0;
    this.canSkip = seen();
    this.base = { p: V(), q: new THREE.Quaternion() };
    this.shot = { p: V(), q: new THREE.Quaternion() };
    this.cs = { kind: 'arrival_cine', t: 0 };
    this.want = { glitch: 0, muffle: 0, fade: 0 };
    this.lvl = { glitch: 0, muffle: 0, fade: 0 };
    this.owning = false;
    this.timers = [];
    this.log = [];         // beats played on this peer (name@world time), for tests
    this.kiosks = [mission.shopKiosk, mission.questKiosk].filter(Boolean).map((d) => ({ d, pos: d.root.position.clone(), fwd: V(Math.sin(d.root.rotation.y), 0, Math.cos(d.root.rotation.y)) }));
    this._buildSeal();
    // nothing of the camp's machinery is here yet
    mission.crusher?.setHidden(true);
    for (const k of this.kiosks) k.d.setHidden(true);
  }

  // ------------------------------------------------------------------ the wall that closes the alcove
  _buildSeal() {
    const el = this.level.landmarks?.elevator, A = el?.alcove;
    if (!A) return;
    const yaw = el.yaw || 0;
    const g = V(Math.sin(yaw), 0, Math.cos(yaw)), s = V(Math.cos(yaw), 0, -Math.sin(yaw));
    const fy = this.mission._floorY(A.x, A.z);
    const c = V(A.x, fy, A.z).addScaledVector(g, A.d / 2);
    const w = A.w + 0.14, h = HEIGHT, d = 0.24;
    const root = new THREE.Group();
    root.position.copy(c); root.rotation.y = yaw;
    const geo = new THREE.BoxGeometry(w, h, d); geo.translate(0, h / 2, 0);
    // wallpaper UVs in world metres, like the level's own walls (u = x + z, v = y)
    const P = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < P.count; i++) {
      const lx = P.getX(i), ly = P.getY(i), lz = P.getZ(i);
      const wx = c.x + s.x * lx + g.x * lz, wz = c.z + s.z * lx + g.z * lz;
      uv.setXY(i, wx + wz, ly);
    }
    // the level's walls are light-baked: light the plug by the light the camp has there so it reads as the same wall
    const mat = Mat.get('wallpaper').clone();
    const lc = new THREE.Color(0.3, 0.27, 0.19);
    try { const sc = new THREE.Color(); this.level.sampleLight?.(c.clone().addScaledVector(g, 0.6).setY(fy + 1.4), sc); if (sc.r + sc.g + sc.b > 0.05) lc.copy(sc).multiplyScalar(0.42); } catch (e) { /* keep the default */ }
    mat.emissive = lc; mat.emissiveMap = mat.map; mat.emissiveIntensity = 1;
    this.sealMat = mat;
    const wall = new THREE.Mesh(geo, mat);
    wall.castShadow = wall.receiveShadow = true;
    root.add(wall);
    const base = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, 0.02), Mat.get('rubber_base'));
    base.position.set(0, 0.05, d / 2 + 0.01); root.add(base);
    root.visible = false;
    this.world.group.add(root);
    this.seal = { root, c, g, s, w, h, d, yaw, col: null, on: false, focus: c.clone().setY(fy + 1.35) };
  }
  _sealOn(on) {
    const S = this.seal;
    if (!S || S.on === on) return;
    S.on = on;
    S.root.visible = on;
    if (on && !S.col) {
      const p = S.c.clone().setY(S.c.y + S.h / 2);
      S.col = this.world.physics.addStaticBox(p.x, p.y, p.z, S.w / 2, S.h / 2, S.d / 2, null, S.yaw);
      this.colliders.push(S.col);
    }
  }

  // ------------------------------------------------------------------ entry points
  begin() {
    if (this.begun) return;
    this.begun = true;
    if (net.isHost && this.state.stage === 0) this.setState({ stage: STAGE.STRANDED });
  }

  // this peer's clone is thrown out of the car: take it over (camera noclips through the wall)
  fling(info) {
    const el = this.level.landmarks?.elevator, A = el?.alcove, l = this.game.local, phys = this.world.physics;
    if (!A || this.flung || !l.world || l.dead || this.state.stage > 1) return false;
    this.flung = true;
    try {
      const yaw = el.yaw || 0;
      const g = V(Math.sin(yaw), 0, Math.cos(yaw));
      const sg = (info?.spin || 1) * (Math.random() < 0.5 ? 1 : -1) > 0 ? 1 : -1;
      const s = V(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(sg);
      const fy = this.mission._floorY(A.x, A.z);
      const front = V(A.x, fy, A.z).addScaledVector(g, A.d / 2);
      const E = front.clone().addScaledVector(s, A.w / 2 + 1.15).addScaledVector(g, 0.35).setY(fy + 1.5);
      // the camp-side face of the wall beside the alcove
      const hit = phys.raycast(E.clone().addScaledVector(g, 1.6), g.clone().negate(), 3.4, Q.world);
      const face = hit ? hit.point.clone() : front.clone().addScaledVector(s, A.w / 2 + 1.15).setY(E.y);
      E.copy(face).addScaledVector(g, 0.3);
      const P0 = engine.camera.position.clone(), Q0 = engine.camera.quaternion.clone();
      const dir = E.clone().sub(P0), len = dir.length();
      dir.normalize();
      const h2 = phys.raycast(P0, dir, len, Q.world);
      const C = h2 && h2.dist > 0.3 ? P0.clone().addScaledVector(dir, h2.dist - 0.04) : P0.clone().lerp(E, 0.55);
      const E0 = face.clone().addScaledVector(g, -0.05).setY(fy + 1.45);
      const L = face.clone().addScaledVector(g, 2.1).addScaledVector(s, 0.45);
      L.y = this.mission._floorY(L.x, L.z);
      const look = (this.seal?.focus || front.clone().setY(fy + 1.35)).clone();
      // the clone's body waits on the camp floor, turned to the way it came in
      l.teleport(L.clone().setY(L.y + 0.05), Math.atan2(-(look.x - L.x), -(look.z - L.z)));
      l.pitch = 0.04;
      l.arrivalGrace = Math.max(l.arrivalGrace || 0, 5);
      l.yank?.set?.(0, 0, 0);
      this.queue.unshift(this._noclipBeat({ P0, Q0, C, E0, E, g, s, L, look, roll: Math.random() < 0.5 ? -1 : 1 }));
      return true;
    } catch (e) {
      console.error('[arrival] noclip', e);
      return false;
    }
  }

  // ------------------------------------------------------------------ host
  hostAction(a, d, from) {
    if (a === 'fixed' && this.state.stage === STAGE.BOT) this.setState({ stage: STAGE.FIXED, by: from });
  }
  _hostTick(dt) {
    const st = this.state.stage, g = this.game;
    if (st === 0) {
      // nobody came by lift (direct dispatch / the car never fired): start anyway
      if (g.state !== 'playing' || g.ride?.active || g.world !== this.world) return;
      const car = this.world.arrivalElevator;
      this.waitT += dt;
      if ((!car || car.gone) ? this.waitT > 9 : this.waitT > 45) this.begin();
      return;
    }
    this.hostT += dt;
    const gap = this.skipAll && GAP[st] != null ? 0.3 : GAP[st]; // the host skipped: run the rest through
    if (gap == null || this.hostT < gap) return;
    this.hostT = 0;
    if (st === STAGE.CRATE) {
      if (g.run?.healthity) this.setState({ stage: STAGE.FIXED, noBot: 1 });
      else this.setState({ stage: STAGE.BOT });
    } else if (st < STAGE.TERMINAL) this.setState({ stage: st + 1 });
  }

  // ------------------------------------------------------------------ every peer
  onState(s, sync) {
    const st = this.state.stage | 0;
    if (s.stage !== undefined && net.isHost) this.hostT = 0;
    if (sync) { this._snapTo(st); return; }
    while (this.applied < st) {
      this.applied++;
      const b = this._beatFor(this.applied);
      if (b) this.queue.push(b);
    }
  }
  _snapTo(st) {
    while (this.applied < st) {
      this.applied++;
      const b = this._beatFor(this.applied, true);
      b?.end(true);
    }
  }
  _beatFor(k, sync = false) {
    switch (k) {
      case STAGE.STRANDED: return this._strandedBeat();
      case STAGE.CRATE: return this._crateBeat();
      case STAGE.BOT: return this.state.noBot ? null : this._botBeat();
      case STAGE.FIXED: return { dur: 0, end: () => this.ob?.bot.fixed(this.state.by, sync || this.state.noBot) };
      case STAGE.CRUSHER: return this._crusherBeat();
      case STAGE.TERMINAL: return this._terminalBeat();
      default: return null;
    }
  }

  _nearLocal(p, r) { const l = this.game.local; return !!(p && l.world && !l.dead && l.pos.distanceTo(p) < r); }
  _say(text, delay = 0) {
    const fire = () => { if (this.game.world === this.world && !this.disposed) floatText.notice(text, { color: NARRATE, duration: 3 + text.length * 0.05 }); };
    if (delay > 0) this.timers.push(setTimeout(fire, delay * 1000)); else fire();
  }
  _sfx(name, o) { audio.play(name, o); }
  // a shot from the clone's own eye that turns to `target`, easing `push` metres toward it
  _focus(b, target, push, t, rise = 0) {
    const p = this.shot.p.copy(b.from);
    _v.copy(target).sub(b.from);
    const d = _v.length();
    _v.normalize();
    p.addScaledVector(_v, Math.min(push, Math.max(0, d - 2)) * ease(seg(t, 0, b.dur)));
    p.y += rise * ease(seg(t, 0, b.dur));
    lookQ(p, target, 0, this.shot.q);
    b.shot = true;
  }

  // ------------------------------------------------------------------ beats
  _noclipBeat(o) {
    const self = this, fired = new Set();
    const once = (k, t, at, fn) => { if (t >= at && !fired.has(k)) { fired.add(k); fn(); } };
    const pos = V(), ahead = V(), Hp = o.L.clone().addScaledVector(o.g, -0.55).setY(o.L.y + 1.2), Lf = o.L.clone().addScaledVector(o.s, 0.12).setY(o.L.y + 0.3);
    const ctrl = o.E.clone().setY(o.E.y + 0.2);
    const path = (t, out) => {
      if (t < 0.42) { const k = seg(t, 0, 0.42); return out.lerpVectors(o.P0, o.C, k * k * (1.6 - 0.6 * k)); }
      if (t < 1.8) { const k = seg(t, 0.42, 1.8); out.lerpVectors(o.C, o.E0, ease(k)); out.y += Math.sin(k * PI) * 0.1; return out; }
      if (t < 2.25) {
        const k = easeOut(seg(t, 1.8, 2.25)), a = 1 - k;
        return out.set(0, 0, 0).addScaledVector(o.E0, a * a).addScaledVector(ctrl, 2 * a * k).addScaledVector(Hp, k * k);
      }
      if (t < 2.45) { const k = seg(t, 2.25, 2.45); return out.lerpVectors(Hp, Lf, k * k); }
      return out.copy(Lf);
    };
    return {
      name: 'noclip', dur: 3.9, cam: true, inT: 0, outT: 1.0,
      start() {
        juice.shake(0.7); juice.hitstop(60);
        self._sfx('throw_whoosh', { volume: 1 });
        self._sfx('gasp', { volume: 0.8, delay: 0.1 });
      },
      tick(t) {
        const W = self.want;
        path(t, pos);
        // look along the flight (a sideways sweep while inside: the room seen from behind)
        let roll = 0;
        if (t < 2.25) {
          path(Math.min(2.3, t + 0.12), ahead);
          if (ahead.distanceToSquared(pos) < 1e-6) ahead.copy(pos).add(o.g);
          ahead.sub(pos).normalize();
          if (t >= 0.42 && t < 1.8) { const k = seg(t, 0.42, 1.8); ahead.applyAxisAngle(UP, Math.sin(k * PI * 1.5) * 1.15); ahead.y += Math.sin(k * PI * 2) * 0.25; }
          if (t >= 1.8) ahead.y -= seg(t, 1.8, 2.25) * 0.9;
          roll = o.roll * (t < 0.42 ? t * 1.2 : t < 1.8 ? 0.45 + Math.sin(t * 3) * 0.2 : 0.6 + seg(t, 1.8, 2.25) * 0.8);
          lookQ(pos, ahead.add(pos), roll, self.shot.q);
        } else {
          // flat on the carpet: staring up, rolled, then the clone's own view takes over
          const k = seg(t, 2.45, 3.3);
          _v.copy(Lf).addScaledVector(o.g, -1.2).setY(Lf.y + 2.4).lerp(o.look, ease(k));
          lookQ(pos, _v, o.roll * 1.4 * (1 - ease(k)) + Math.sin(t * 9) * 0.04 * (1 - k), self.shot.q);
        }
        self.shot.p.copy(pos);
        // the wall
        once('hit', t, 0.42, () => {
          juice.shake(0.55); juice.hitstop(110);
          self._sfx('body_impact', { volume: 0.9 }); self._sfx('_crack', { volume: 0.8 }); self._sfx('scare_whoosh', { volume: 0.5, pitch: 0.6 });
        });
        once('void', t, 0.6, () => { self._sfx('void_drone', { volume: 0.7 }); self._sfx('_uncanny', { volume: 0.7, delay: 0.3 }); });
        if (t >= 0.42 && t < 1.8) {
          W.glitch = 0.55 + (Math.random() < 0.15 ? 0.45 : Math.random() * 0.2);
          W.fade = Math.random() < 0.08 ? 0.55 : 0.1;
          W.muffle = 0.8;
        } else if (t >= 1.8) {
          W.glitch = Math.max(0, 1 - (t - 1.8) * 1.4);
          W.fade = 0;
          W.muffle = 0.6;
        } else W.glitch = t * 0.6;
        once('pop', t, 1.8, () => { juice.flash(0.35); self._sfx('teleport_whoosh', { volume: 1, pitch: 0.8 }); self._sfx('_arc_pop', { volume: 0.8 }); });
        once('land', t, 2.45, () => {
          juice.shake(0.7); juice.hitstop(120); juice.punch(0.05);
          self._sfx('crate_land', { volume: 0.9 }); self._sfx('body_impact', { volume: 0.8 }); self._sfx('hurt', { volume: 0.5, delay: 0.1 });
          self.world.fx?.dustBurst?.(o.L.clone().setY(o.L.y + 0.1), 26, [0.62, 0.56, 0.36], 1.2);
        });
        this.shot = true;
      },
      end() {},
    };
  }

  _strandedBeat() {
    const self = this, S = this.seal, fired = new Set();
    const once = (k, t, at, fn) => { if (t >= at && !fired.has(k)) { fired.add(k); fn(); } };
    return {
      name: 'stranded', dur: 3.8, cam: !!S && this._nearLocal(S.c, 16), inT: 0.7, outT: 0.9,
      tick(t) {
        if (S) {
          // the opening flickers between alcove and wallpaper, then it is just wall
          if (t >= 0.5 && t < 1.15) S.root.visible = Math.random() < 0.55;
          once('seal', t, 0.5, () => {
            self._sealOn(true); S.root.visible = false;
            self._sfx('lights_slam', { pos: S.focus, volume: 0.9 }); self._sfx('_boom', { pos: S.focus, volume: 0.7, pitch: 0.7 });
            if (self._nearLocal(S.c, 14)) juice.shake(0.35);
            self.world.fx?.dustBurst?.(S.c.clone().addScaledVector(S.g, 0.2).setY(S.c.y + 0.2), 30, [0.7, 0.64, 0.45], 1.1);
          });
          once('solid', t, 1.15, () => { S.root.visible = true; self._sfx('thunk', { pos: S.focus, volume: 0.7, pitch: 0.5 }); });
          if (this.cam) self._focus(this, S.focus, 0.6, t);
        }
        const W = self.want;
        W.glitch = t > 0.5 && t < 1.15 ? 0.35 + Math.random() * 0.3 : Math.max(0, 0.2 - (t - 1.15));
        W.muffle = t < 1.3 ? 0.55 : 0.92;
        once('heart', t, 1.4, () => { self._sfx('heartbeat', { volume: 0.7, bus: 'ui' }); self._sfx('heartbeat', { volume: 0.55, bus: 'ui', delay: 1.1 }); });
      },
      end(skipped) {
        self._sealOn(true);
        if (S) S.root.visible = true;
        if (!skipped) { self._say('The wall sealed behind you. There is no way back.'); self.silenceT = 5; }
      },
    };
  }

  _crateBeat() {
    const self = this, cr = this.ob?.crate;
    if (!cr) return null;
    return {
      name: 'crate', dur: 3.9, cam: this._nearLocal(cr.restPos, 22), inT: 0.6, outT: 0.8,
      tick(t) {
        cr.clipIn(t);
        if (this.cam) self._focus(this, _v2.copy(cr.root.position).setY(cr.restPos.y + 0.1), 1.4, t);
        self.want.glitch = t < 0.95 ? 0.18 + Math.random() * 0.15 : Math.max(0, 0.4 - (t - 0.95));
        self.want.muffle = Math.max(0, 0.6 - t * 0.2);
      },
      end(skipped) {
        cr.setPresent();
        if (!skipped) self._say('A supply crate clipped in out of nowhere.');
      },
    };
  }

  _botBeat() {
    const self = this, bot = this.ob?.bot;
    if (!bot) return null;
    const tgt = V();
    return {
      name: 'bot', dur: 4.6, cam: this._nearLocal(bot.restPos, 22), inT: 0.6, outT: 0.9,
      start() { bot.wall(); },
      tick(t) {
        bot.clipIn(t);
        tgt.copy(bot.wall()).lerp(bot.restPos, ease(seg(t, 1.1, 2.2)));
        if (this.cam) self._focus(this, tgt, 1.2, t);
        self.want.glitch = t < 1.2 ? 0.2 + Math.random() * 0.2 : Math.max(0, 0.45 - (t - 1.2));
      },
      end(skipped) {
        bot.setPresent();
        if (!skipped) { self._say('A broken Healthity. Someone taped a note to it.'); self._say('[E] on the note to read it.', 3.4); }
      },
    };
  }

  // the crusher phases out of the pad hall wall in five heavy lurches, then slams onto its feet
  _crusherBeat() {
    const self = this, cr = this.mission.crusher;
    if (!cr) return null;
    const P = cr.root.position.clone(), yaw = cr.root.rotation.y;
    const f = V(Math.sin(yaw), 0, Math.cos(yaw)), side = V(Math.cos(yaw), 0, -Math.sin(yaw));
    const phys = this.world.physics;
    // the nearest real wall behind or beside it (two heights must agree: not a doorway)
    let best = null;
    const back = f.clone().negate();
    const dirs = [[back, 1.5], [side, 2.0], [side.clone().negate(), 2.0], [back.clone().add(side).normalize(), 1.9], [back.clone().sub(side).normalize(), 1.9]];
    for (const [dir, ext] of dirs) {
      try {
        const a = phys.raycast(P.clone().setY(P.y + 1.2), dir, 18, Q.world), b = phys.raycast(P.clone().setY(P.y + 3.4), dir, 18, Q.world);
        if (!a || !b || Math.abs(a.dist - b.dist) > 0.6 || a.dist < 2) continue;
        if (!best || a.dist < best.d) best = { dir, d: a.dist, ext };
      } catch (e) { /* physics not ready */ }
    }
    if (!best) best = { dir: f.clone().negate(), d: 3, ext: 1.5 };
    const S = P.clone().addScaledVector(best.dir, best.d + best.ext + 0.4);
    const wallPt = P.clone().addScaledVector(best.dir, best.d);
    // camera: the hall, from the camp side, a little off axis (pulled in if a wall is in the way)
    const camAt = P.clone().addScaledVector(f, 5.8).addScaledVector(side, best.dir.dot(side) > 0.5 ? -2.8 : 2.8).setY(P.y + 2.3);
    try {
      const o = P.clone().setY(P.y + 2.3), d = camAt.clone().sub(o), L = d.length();
      const h = phys.raycast(o, d.normalize(), L, Q.world);
      if (h) camAt.copy(o).addScaledVector(d, Math.max(2.5, h.dist - 0.5));
    } catch (e) { /* keep */ }
    const look = V(), lookS = P.clone().lerp(S, 0.45).setY(P.y + 1.8), fired = new Set();
    const once = (k, t, at, fn) => { if (t >= at && !fired.has(k)) { fired.add(k); fn(); } };
    const N = 5, T0 = 0.9, LT = 0.96;
    const at = V();
    const along = (t) => {
      const u = (t - T0) / LT;
      if (u < 0) return 0;
      if (u >= N) return 1;
      const i = Math.floor(u), k = Math.min(1, (u - i) / 0.62);
      return (i + ease(k)) / N;
    };
    return {
      name: 'crusher', dur: 7.6, cam: true, inT: 0, outT: 0,
      start() {
        cr.root.visible = true;
        self._sfx('collapse_rumble', { pos: wallPt, volume: 1 });
        juice.shake(0.3);
      },
      tick(t, dt) {
        const k = along(t), lift = t < T0 + N * LT ? 0.22 : 0.22 * (1 - ease(seg(t, T0 + N * LT, T0 + N * LT + 0.16)));
        at.lerpVectors(S, P, k);
        const inWall = Math.abs((1 - k) * (best.d + best.ext + 0.4) - best.d) < best.ext + 0.1;
        const j = inWall ? 0.02 : 0.004;
        cr.root.position.set(at.x + (Math.random() - 0.5) * j, P.y + lift + (Math.random() - 0.5) * j, at.z + (Math.random() - 0.5) * j);
        // dust off the wall before it gives, sparks where the machine grinds through it
        if (t < T0 && Math.random() < 0.3) self.world.fx?.dustBurst?.(wallPt.clone().addScaledVector(side, (Math.random() - 0.5) * 3).setY(P.y + 2.5 + Math.random() * 2), 6, [0.7, 0.64, 0.45], 0.8);
        if (inWall && t > T0 && Math.random() < 0.35) self.world.fx?.sparks?.(wallPt.clone().addScaledVector(side, (Math.random() - 0.5) * 3.4).setY(P.y + 0.3 + Math.random() * 3.8), 5, null, [1, 0.8, 0.45], 2.4);
        for (let i = 0; i < N; i++) {
          once('lurch' + i, t, T0 + i * LT + 0.62, () => {
            self._sfx(i === N - 1 ? 'crusher_slam' : 'thunk', { pos: at, volume: i === N - 1 ? 0.8 : 1, pitch: 0.55 + i * 0.05 });
            if (i % 2 === 0) self._sfx('metal_scream', { pos: at, volume: 0.55, pitch: 0.6 });
            juice.shake(0.22);
          });
          once('grind' + i, t, T0 + i * LT, () => self._sfx(i === 0 ? 'metal_rip' : 'pipe_hiss', { pos: at, volume: 0.6, pitch: 0.7 }));
        }
        once('slam', t, T0 + N * LT + 0.16, () => {
          self._sfx('crusher_slam', { pos: P, volume: 1.2, pitch: 0.8 }); self._sfx('_boom', { pos: P, volume: 0.6 });
          juice.shake(0.6); juice.hitstop(90);
          self.world.fx?.dustBurst?.(P.clone().setY(P.y + 0.15), 50, [0.66, 0.6, 0.45], 2.2);
          self.world.fx?.flashLight?.(P.clone().setY(P.y + 1.5), 0x9fffb0, 14, 0.4, 10);
        });
        once('power', t, T0 + N * LT + 0.7, () => { self._sfx('generator_start', { pos: P, volume: 0.8 }); self._sfx('pad_charge', { pos: P, volume: 0.6, delay: 0.4 }); });
        // the shot: slow dolly, the look trails the machine
        look.lerpVectors(lookS, P.clone().setY(P.y + 1.7), ease(seg(t, 0.6, 6.2)));
        self.shot.p.copy(camAt).lerp(P, 0.1 * ease(seg(t, 0, 7.6))).setY(camAt.y);
        lookQ(self.shot.p, look, 0, self.shot.q);
        this.shot = true;
        const W = self.want;
        W.glitch = t < 0.25 || t > 7.35 ? 0.9 : inWall ? 0.12 + Math.random() * 0.12 : 0;
        W.fade = t < 0.12 || t > 7.48 ? 0.85 : 0;
        void dt;
      },
      end(skipped) {
        cr.root.position.copy(P);
        cr.setHidden(false);
        if (!skipped) self._say('The CRUSHER. Feed it loot and it pays in credits.', 0.6);
      },
    };
  }

  // the kiosks slide out of the camp wall either side of the sealed alcove
  _terminalBeat() {
    const self = this, ks = this.kiosks;
    if (!ks.length) return { dur: 0, end: () => this._done() };
    const M = V();
    for (const k of ks) M.add(k.pos);
    M.multiplyScalar(1 / ks.length).setY(ks[0].pos.y + 1.3);
    const fw = ks[0].fwd, C = M.clone().addScaledVector(fw, 5.4).setY(M.y + 0.35);
    try {
      const h = this.world.physics.raycast(M.clone().addScaledVector(fw, 0.6), fw, 5, Q.world);
      if (h) C.copy(M).addScaledVector(fw, Math.max(2.5, h.dist + 0.2)).setY(M.y + 0.35);
    } catch (e) { /* keep */ }
    const fired = new Set();
    const once = (k, t, at, fn) => { if (t >= at && !fired.has(k)) { fired.add(k); fn(); } };
    return {
      name: 'terminal', dur: 5.4, cam: this._nearLocal(M, 26), inT: 0.7, outT: 0.9,
      tick(t) {
        ks.forEach((k, i) => {
          const t0 = 0.5 + i * 0.7, u = t - t0, R = k.d.root;
          if (u < 0) { R.visible = false; return; }
          const e = easeOut(seg(u, 0.35, 1.7));
          R.visible = u > 0.35 || Math.random() < 0.5;
          const j = u < 1.7 ? 0.015 : 0;
          R.position.copy(k.pos).addScaledVector(k.fwd, -1.15 * (1 - e)).add(_v.set((Math.random() - 0.5) * j, (Math.random() - 0.5) * j, (Math.random() - 0.5) * j));
          once('in' + i, t, t0, () => { self._sfx('_uncanny', { pos: k.pos, volume: 0.5 }); self._sfx('metal_rip', { pos: k.pos, volume: 0.5, pitch: 1.2 }); });
          once('seat' + i, t, t0 + 1.7, () => {
            self._sfx('thunk', { pos: k.pos, volume: 0.9 }); self._sfx('robo_clunk', { pos: k.pos, volume: 0.7 });
            self.world.fx?.dustBurst?.(k.pos.clone().setY(k.pos.y + 0.1), 20, [0.7, 0.64, 0.45], 0.9);
            if (self._nearLocal(k.pos, 10)) juice.shake(0.2);
          });
          once('boot' + i, t, t0 + 2.1, () => { k.d.setHidden(false); R.position.copy(k.pos); self._sfx('ui_boot', { pos: k.pos, volume: 0.8 }); });
        });
        if (this.cam) { self.shot.p.copy(C).addScaledVector(fw, -0.9 * ease(seg(t, 0, 5.4))); lookQ(self.shot.p, M, 0, self.shot.q); this.shot = true; }
        self.want.glitch = t > 0.5 && t < 2.9 ? 0.1 + Math.random() * 0.12 : 0;
      },
      end(skipped) {
        for (const k of ks) { k.d.root.position.copy(k.pos); k.d.setHidden(false); }
        if (!skipped) self._say('A COMPANY STORE and a FIELD OPS terminal phased in.', 0.4);
        self._done();
      },
    };
  }
  _done() {
    markSeen();
    this.canSkip = true;
    if (net.isHost) this.mission.fireBrief?.(2200);
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    dt = Math.min(dt, 0.1);
    if (net.isHost) this._hostTick(dt);
    this.reader.update(dt);
    this.want.glitch = this.want.fade = 0;
    this.want.muffle = this.silenceT > 0 ? 0.92 * Math.min(1, this.silenceT / 2.5) : 0;
    if (this.silenceT > 0) this.silenceT -= dt;
    this._runBeats(dt);
    this._applyFx(dt);
  }

  _runBeats(dt) {
    while (!this.cur && this.queue.length) {
      const b = this.queue.shift();
      b.t = 0;
      if (this.skipAll || !b.dur) { b.end(!!this.skipAll); continue; }
      this.cur = b;
      this.log.push(`${b.name}@${this.world.time.toFixed(1)}`);
      b.start?.();
      if (b.cam && this.canSkip && !this._hinted) { this._hinted = true; floatText.notice(`hold ${input.keyName('jump')} to skip`, { color: NARRATE, duration: 2.6 }); }
    }
    const b = this.cur;
    if (!b) return;
    if (b.cam && b.t === 0) { b.from = engine.camera.position.clone(); b.fromQ = engine.camera.quaternion.clone(); }
    b.t += dt;
    b.shot = false;
    b.tick?.(b.t, dt);
    if (b.cam && b.shot) {
      this._takeCam(b);
      // a talking Healthity drifts into the camera's view: keep it beside the clone during a shot
      const h = this.game.healthity;
      if (h?.active && h.attention !== undefined) h.attention = 0;
    }
    if (b.cam && this.canSkip && input.down('jump')) {
      this.holdT += dt;
      if (this.holdT > 0.6) { this._skip(); return; }
    } else this.holdT = 0;
    if (b.t >= b.dur) {
      this.cur = null;
      b.end(false);
      if (!this.queue.some((q) => q.cam)) this._releaseCam();
    }
  }

  _skip() {
    this.skipAll = true;
    this.holdT = 0;
    const b = this.cur;
    this.cur = null;
    b?.end(true);
    for (const q of this.queue.splice(0)) q.end(true);
    this._releaseCam();
    audio.play('ui_back', { volume: 0.4, bus: 'ui' });
  }

  _takeCam(b) {
    const cam = engine.camera, g = this.game;
    if (g.cutscene !== this.cs) { g.cutscene = this.cs; if (engine.post.vmPass) engine.post.vmPass.enabled = false; }
    this.base.p.copy(cam.position); this.base.q.copy(cam.quaternion);
    let w = b.inT ? ease(seg(b.t, 0, b.inT)) : 1;
    if (b.outT && b.t > b.dur - b.outT) w *= ease(clamp01((b.dur - b.t) / b.outT));
    cam.position.lerpVectors(this.base.p, this.shot.p, w);
    cam.quaternion.slerpQuaternions(this.base.q, this.shot.q, w);
    cam.updateMatrixWorld();
    audio.setListener(cam.position, cam.quaternion);
  }
  _releaseCam() {
    const g = this.game;
    if (g.cutscene === this.cs) g.cutscene = null;
    if (engine.post.vmPass) engine.post.vmPass.enabled = !engine.view;
  }

  // post / audio levels this director owns while a beat runs (handed back at zero)
  _applyFx(dt) {
    const L = this.lvl, W = this.want, pp = engine.post.params;
    L.glitch = W.glitch;
    L.fade = W.fade;
    L.muffle += (W.muffle - L.muffle) * Math.min(1, dt * (W.muffle > L.muffle ? 10 : 1.2));
    const any = L.glitch > 0.001 || L.fade > 0.001 || L.muffle > 0.01;
    if (any) {
      this.owning = true;
      pp.uGlitch.value = L.glitch;
      pp.uFade.value = L.fade;
      audio.setMuffle(L.muffle);
    } else if (this.owning) {
      this.owning = false;
      pp.uGlitch.value = 0; pp.uFade.value = 0;
      audio.setMuffle(0);
    }
  }

  dispose() {
    this.disposed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this._releaseCam();
    if (this.owning) { const pp = engine.post.params; pp.uGlitch.value = 0; pp.uFade.value = 0; audio.setMuffle(0); }
    this.reader.dispose();
    if (this.seal) { this.seal.root.removeFromParent(); this.seal.root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); this.sealMat?.dispose(); }
    if (this.game.arrival === this) this.game.arrival = null;
    super.dispose();
  }
}
