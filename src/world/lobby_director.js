// Lobby cinematics (HQ waiting room): owns the camera while a scripted moment plays, then hands it back to
// the clone with an eased blend. Every peer runs its own director; nothing here is networked except through
// the elevator device and game.js (lobbyHost / lobbyJoin / lobbyStart / lobbyExit).
//   drop     a clone falls through the ceiling hatch into the pitch-black room, crumples, the lights stutter on
//   panel    first-person zoom onto the elevator call panel; the clone's hand presses HOST / JOIN (or START /
//            EXIT for the host); JOIN drops the keypad cover and the hand types the shift code (keys or taps)
//   pull     HOST: the camera pulls back to the split-flap board while the line is dialled (code or LINE DEAD)
//   board    START: wide shot of the doors opening, then control returns for the countdown
//   joinfall the code connected: the trapdoor drops and the clone falls into the host's room (game.js loads it)
//   exit     EXIT: klaxon, red light, the floor drops under everyone, into the robot pit (world/robot_pit.js)
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { input } from '../core/input.js';
import { net } from '../net/net.js';
import { audio } from '../audio/audio.js';
import { juice } from '../gfx/juice.js';
import { floatText } from '../ui/floattext.js';
import { CODE_CHARS } from './hq_elevator.js';
import { RobotPit, preparePit } from './robot_pit.js';

const PI = Math.PI;
const EYE = 1.36;
const SOLO_ONLY = !!import.meta.env.VITE_SOLO_ONLY;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const outBack = (t) => { const c = 1.4; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const UP = new THREE.Vector3(0, 1, 0), ZA = new THREE.Vector3(0, 0, 1);
const _m = new THREE.Matrix4(), _qr = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2(), _plane = new THREE.Plane();
const pose = () => ({ p: new THREE.Vector3(), q: new THREE.Quaternion(), fov: 72 });
const BOUNDS = { x0: -0.145, x1: 0.145, y0: -0.2, y1: 0.28 };

// the clone's right hand: yellowed ABS shell, mould seams, rubber wrist bellows, coverall cuff.
// Hand space: index fingertip at the origin pointing -Z, the arm runs back along +Z.
function buildHand() {
  const g = new THREE.Group();
  g.name = 'LobbyHand';
  const abs = new THREE.MeshStandardMaterial({ color: 0xd9c69a, roughness: 0.4 });
  const rub = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.9 });
  const suit = new THREE.MeshStandardMaterial({ color: 0x3d4b54, roughness: 0.9 });
  const seam = new THREE.MeshStandardMaterial({ color: 0x6a5634, roughness: 0.7 });
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const cap = (r, a, b, mat) => {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, 10), mat);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(UP, d.normalize());
    g.add(m);
    return m;
  };
  // index (pointing), three curled fingers, thumb
  cap(0.0082, V(0, 0, 0.0082), V(0, 0.001, 0.029), abs);
  cap(0.0092, V(0, 0.001, 0.031), V(0, 0.002, 0.055), abs);
  cap(0.0102, V(0, 0.002, 0.057), V(0.002, 0, 0.082), abs);
  for (let i = 0; i < 3; i++) {
    const x = 0.019 + i * 0.016, r = 0.0098 - i * 0.0008;
    cap(r, V(x, 0, 0.084), V(x, -0.02, 0.07), abs);
    cap(r * 0.92, V(x, -0.021, 0.069), V(x, -0.03, 0.092), abs);
  }
  cap(0.0105, V(-0.02, -0.01, 0.134), V(-0.026, -0.016, 0.106), abs);
  cap(0.0095, V(-0.026, -0.017, 0.104), V(-0.014, -0.022, 0.084), abs);
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.026, 0.078), abs);
  palm.position.set(0.017, -0.006, 0.118);
  g.add(palm);
  const sm = new THREE.Mesh(new THREE.BoxGeometry(0.074, 0.0025, 0.078), seam);
  sm.position.set(0.017, -0.006, 0.118);
  g.add(sm);
  // wrist bellows, ABS forearm, coverall cuff + sleeve
  for (let i = 0; i < 4; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.006, 6, 14), rub);
    r.position.set(0.017, -0.008, 0.162 + i * 0.011);
    g.add(r);
  }
  cap(0.031, V(0.018, -0.009, 0.2), V(0.026, -0.016, 0.31), abs);
  const sl = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.05, 0.36, 14, 1, true), suit);
  sl.material.side = THREE.DoubleSide;
  sl.position.set(0.03, -0.02, 0.45); sl.rotation.x = PI / 2;
  g.add(sl);
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.008, 6, 16), suit);
  cuff.position.set(0.027, -0.018, 0.272);
  g.add(cuff);
  g.traverse((o) => { if (o.isMesh) { o.userData.noProbe = true; o.castShadow = false; } });
  g.visible = false;
  return g;
}

export class LobbyDirector {
  constructor(lobby) {
    this.lobby = lobby;
    this.game = lobby.game;
    this.cur = pose(); this.from = pose(); this.live = pose(); this.tmp = pose();
    this.to = null;
    this.tr = { t: 0, dur: 1, ease: inOut };
    this.active = false;
    this.mode = null;
    this.t = 0;
    this.hand = buildHand();
    this.handPos = new THREE.Vector3(0.2, -0.3, 0.4);
    this.cursor = new THREE.Vector2(-0.066, 0.11);
    this.pressT = -1;
    this.entry = '';
    this.inputLock = 0;
    this.loops = {};
    this.lineMode = net.mode === 'host' ? 'host' : net.mode === 'client' ? 'client' : 'none';
    this._onKey = (e) => this._key(e);
  }

  get busy() { return !!this.mode; }
  get el() { return this.lobby.elevator; }
  get panel() { return this.lobby.elevator?.panel; }

  attach() { this.panel?.group.add(this.hand); }

  // ------------------------------------------------------------------ camera plumbing
  _grab(out) { const c = engine.camera; out.p.copy(c.position); out.q.copy(c.quaternion); out.fov = c.fov; return out; }
  _take() {
    if (!this.active) { this._grab(this.cur); this.active = true; }
    this.game.cutscene = this.game.cutscene?.kind === 'lobby' ? this.game.cutscene : { kind: 'lobby', t: 0 };
    const vm = engine.post?.vmPass;
    if (vm) vm.enabled = false;
  }
  goTo(to, dur, ease = inOut) {
    this._take();
    this.from.p.copy(this.cur.p); this.from.q.copy(this.cur.q); this.from.fov = this.cur.fov;
    this.to = to;
    this.tr = { t: 0, dur: Math.max(0.001, dur), ease };
  }
  _lookQ(out, eye, target, roll = 0) {
    _m.lookAt(eye, target, UP);
    out.setFromRotationMatrix(_m);
    if (roll) out.multiply(_qr.setFromAxisAngle(ZA, roll));
    return out;
  }
  _eulerQ(out, yaw, pitch, roll) { _e.set(pitch, yaw, roll, 'YXZ'); return out.setFromEuler(_e); }
  _done() {
    this.active = false;
    this.to = null;
    this.mode = null;
    this.hand.visible = false;
    this.panel?.setHover(null);
    if (input.textCapture === this._onKey) input.textCapture = null;
    if (this.game.cutscene?.kind === 'lobby') this.game.cutscene = null;
    const vm = engine.post?.vmPass;
    if (vm) vm.enabled = !engine.view;
  }
  // drop everything (the ride takes the camera)
  release() { if (this.mode !== 'exit') this._done(); }

  // ------------------------------------------------------------------ frame
  update(dt) {
    const g = this.game;
    if (g.ride?.active && this.mode !== 'exit') { if (this.mode) this._done(); return; }
    this.t += dt;
    this.inputLock = Math.max(0, this.inputLock - dt);
    this._grab(this.live);
    // a click on the call panel zooms in too (E / tap go through the device's interact())
    const f = g.local.focus;
    if (!this.mode && f?.kind === 'device' && f.target === this.el && input.mouseHit(0) && this.el.state.ph === 'idle') this.openPanel();
    if (this.mode === 'drop') this._drop(dt);
    else if (this.mode === 'panel') this._panelInput(dt);
    else if (this.mode === 'joinfall') this._joinFall(dt);
    else if (this.mode === 'exit') this._exit(dt);
    if (this.mode === 'pull' || this.mode === 'board') {
      this.holdT -= dt;
      if (this.holdT <= 0 && this.to !== 'player') { this.goTo('player', 1.1); this.mode = 'closing'; }
    }
    this._handUpdate(dt);
    if (!this.active || this.pit) return;
    const tr = this.tr;
    tr.t += dt;
    const k = tr.ease(clamp(tr.t / tr.dur, 0, 1));
    const tg = this.to === 'player' ? this.live : this.to(dt, this.tmp);
    this.cur.p.lerpVectors(this.from.p, tg.p, k);
    this.cur.q.slerpQuaternions(this.from.q, tg.q, k);
    this.cur.fov = this.from.fov + (tg.fov - this.from.fov) * k;
    const c = engine.camera;
    c.position.copy(this.cur.p);
    c.quaternion.copy(this.cur.q);
    c.fov = this.cur.fov;
    c.updateProjectionMatrix();
    if (audio.ready) audio.setListener(c.position, c.quaternion);
    if (this.to === 'player' && k >= 1) this._done();
  }

  _loop(name, on, vol = 1) {
    const L = this.loops[name];
    if (on && !L) this.loops[name] = audio.loop(name, { bus: 'sfx', volume: vol, fadeIn: 0.3 });
    else if (on && L) L.setVolume(vol, 0.2);
    else if (!on && L) { L.stop(0.4); delete this.loops[name]; }
  }

  // ------------------------------------------------------------------ drop-in
  beginDrop() {
    this.mode = 'drop';
    this.dropT = 0; this.landT = -1; this.lit = false;
    this.lobby.setLights(0);
    engine.post.params.uFade.value = 0;
    this._grab(this.cur);
    this.goTo((dt, o) => this._dropPose(o), 0.01);
    this._loop('wind_fall', true, 0.55);
    audio.play('fall_wind', { volume: 0.6 });
    this.spin = (Math.random() - 0.5) * 1.2;
  }
  _dropPose(o) {
    const l = this.game.local, t = this.dropT;
    if (this.landT < 0) {
      o.p.copy(l.pos).setY(l.pos.y + EYE);
      this._eulerQ(o.q, l.yaw + this.spin * t, -0.55 - Math.sin(t * 3) * 0.08, Math.sin(t * 2.2) * 0.25);
      o.fov = 78 + t * 6;
      return o;
    }
    // crumpled on the floor, then up on unsteady legs
    const u = this.dropT - this.landT;
    const up = sstep(2.5, 4.0, u);
    const slump = sstep(0, 0.16, u);
    const base = EYE - (EYE - 0.22) * slump;
    const eye = base + (EYE - base) * up + Math.sin(up * PI) * 0.06;
    const roll = (1.2 * slump) * (1 - up) + Math.sin(up * PI * 2) * 0.12 * up * (1 - up) * 4;
    const pitch = -0.15 * (1 - up) + Math.sin(u * 0.7) * 0.04 * (1 - up) - 0.05 * up;
    o.p.copy(l.pos).setY(l.pos.y + eye);
    o.p.x += Math.sin(u * 1.1) * 0.03 * (1 - up);
    this._eulerQ(o.q, l.yaw + (1 - up) * 0.35, pitch, roll);
    o.fov = 72 - (1 - up) * 6;
    return o;
  }
  _drop(dt) {
    const l = this.game.local;
    this.dropT += dt;
    const t = this.dropT;
    // hatch bang as the clone passes the ceiling
    if (!this.hatchBang && l.pos.y < this.lobby.H + 0.4) { this.hatchBang = true; audio.play('door_heavy_open', { volume: 0.5, pitch: 1.3 }); }
    if (this.landT < 0 && ((l.grounded && l.pos.y < 0.5 && t > 0.15) || t > 5)) {
      this.landT = t;
      juice.shake(0.95); juice.hitstop(150); juice.flash(0.22); juice.punch(0.07);
      audio.play('crate_land', { volume: 1 });
      audio.play('robo_clunk', { volume: 0.9, delay: 0.03 });
      audio.play('gasp', { volume: 0.7, delay: 0.25 });
      audio.play('breath_heavy', { volume: 0.5, delay: 0.7 });
      this._loop('wind_fall', false);
      this.game.world?.fx.dustBurst(l.pos.clone().setY(0.1), 24, [0.5, 0.48, 0.42], 1.2);
    }
    if (this.landT < 0) return;
    const u = t - this.landT;
    // fluorescent tubes stutter on (dim)
    const seq = [[0.9, 0.85], [0.96, 0], [1.12, 0.6], [1.18, 0.04], [1.5, 0.95], [1.57, 0.15], [1.66, 0.7], [1.72, 0.3]];
    let k = 0;
    for (const [at, v] of seq) if (u >= at) k = v;
    if (u >= 1.72) k = 0.3 + 0.7 * sstep(1.72, 2.3, u);
    if (u < 0.9) k = 0;
    this.lobby.setLights(k);
    if (!this.lit && u >= 0.9) { this.lit = true; audio.play('spark', { volume: 0.35 }); audio.play('_amb_buzz', { volume: 0.5, delay: 0.1 }); audio.play('_amb_buzz', { volume: 0.35, delay: 0.65, pitch: 1.1 }); }
    if (u > 2.5 && !this.rose) { this.rose = true; audio.play('suit_rustle', { volume: 0.6 }); audio.play('robo_whir', { volume: 0.4, delay: 0.3 }); }
    if (u > 4.0 && this.to !== 'player') {
      this.goTo('player', 0.5);
      this.mode = 'closing';
      this._welcome();
    }
  }
  _welcome() {
    const host = net.mode === 'host', client = net.mode === 'client';
    floatText.notice('SUBLEVEL B4  //  WAITING ROOM', { color: '#ffd9a0', duration: 3.4 });
    const at = this.panel?.group;
    if (!at) return;
    const msg = client ? 'WAITING FOR THE HOST' : this.lineMode === 'host' ? (host ? 'PANEL: START OR EXIT' : 'PANEL: START OR EXIT') : 'CALL PANEL: HOST OR JOIN';
    floatText.say(msg, { at, offset: new THREE.Vector3(0, 0.45, 0), size: 0.55, duration: 6, color: client ? '#9fd0ff' : '#ffcf8a' });
  }

  // ------------------------------------------------------------------ the call panel
  openPanel() {
    if (this.busy || !this.panel) return;
    if (net.mode === 'client' || this.lineMode === 'client') {
      floatText.say('ONLY THE SHIFT HOST RUNS THE CAR', { at: this.panel.group, offset: new THREE.Vector3(0, 0.45, 0), size: 0.55, color: '#9fd0ff', duration: 3 });
      audio.play('ui_error', { volume: 0.5, bus: 'ui' });
      return;
    }
    const g = this.game, l = g.local, P = this.panel.group;
    this.mode = 'panel';
    this.panelMode = this.lineMode === 'host' ? 'host' : 'call';
    this.panel.setMode(this.panelMode);
    this.armedExit = 0;
    // the clone steps up to the panel (hidden by the camera move)
    P.updateMatrixWorld(true);
    const stand = P.localToWorld(_v.set(0, -P.position.y, 0.62)).setY(0.02);
    const face = P.localToWorld(_v2.set(0, 0, 0));
    l.teleport(stand.clone(), Math.atan2(-(face.x - stand.x), -(face.z - stand.z)));
    l.pitch = -0.1;
    l.releaseGrab?.(false);
    this.goTo((dt, o) => this._panelPose(o), 0.95);
    this.cursor.set(this.panelMode === 'host' ? -0.066 : -0.066, 0.11);
    this.handPos.set(0.25, -0.35, 0.5);
    this.mx = input.mouse.x; this.my = input.mouse.y;
    this.hand.visible = true;
    this.inputLock = 0.45;
    audio.play('suit_rustle', { volume: 0.5 });
  }
  _panelPose(o) {
    const P = this.panel.group, kp = this.panelMode === 'keypad';
    const cy = kp ? 0.03 : 0.13, d = kp ? 0.6 : 0.52, t = this.t;
    const px = this.cursor.x * 0.12, py = (this.cursor.y - cy) * 0.08;
    o.p.copy(P.localToWorld(_v.set(px + Math.sin(t * 0.6) * 0.004, cy + py + Math.sin(t * 0.83) * 0.003 + 0.01, d)));
    const tg = P.localToWorld(_v2.set(this.cursor.x * 0.3, cy + (this.cursor.y - cy) * 0.25, 0));
    this._lookQ(o.q, o.p, tg, Math.sin(t * 0.37) * 0.006);
    o.fov = kp ? 46 : 44;
    return o;
  }
  closePanel() {
    if (this.mode !== 'panel') return;
    if (input.textCapture === this._onKey) input.textCapture = null;
    this.panel.setMode(this.lineMode === 'host' ? 'host' : 'call');
    this.mode = 'closing';
    this.goTo('player', 0.75);
    audio.play('ui_back', { volume: 0.4, bus: 'ui' });
  }
  _panelInput(dt) {
    const P = this.panel;
    if (this.inputLock > 0) return;
    // move the fingertip: mouse / touch look deltas (locked), or the mouse cursor ray (unlocked)
    if (input.locked || input.touch) {
      const lk = input.look();
      this.cursor.x += lk.x * 0.2; this.cursor.y -= lk.y * 0.2;
    } else if (this.to !== 'player' && this.pressT < 0 && (input.mouse.x !== this.mx || input.mouse.y !== this.my)) {
      // unlocked: the fingertip follows the mouse pointer (only when it moves: typed keys keep the hand)
      this.mx = input.mouse.x; this.my = input.mouse.y;
      const c = engine.camera;
      _ndc.set((input.mouse.x / innerWidth) * 2 - 1, -(input.mouse.y / innerHeight) * 2 + 1);
      _ray.setFromCamera(_ndc, c);
      P.group.updateMatrixWorld();
      _plane.setFromNormalAndCoplanarPoint(_v.set(0, 0, 1).transformDirection(P.group.matrixWorld), P.group.localToWorld(_v2.set(0, 0, 0.03)));
      if (_ray.ray.intersectPlane(_plane, _v3)) { P.group.worldToLocal(_v3); this.cursor.set(_v3.x, _v3.y); }
    }
    this.cursor.x = clamp(this.cursor.x, BOUNDS.x0, BOUNDS.x1);
    this.cursor.y = clamp(this.cursor.y, BOUNDS.y0, BOUNDS.y1);
    const hv = this.pressT < 0 ? P.hitTest(this.cursor.x, this.cursor.y) : P.hover;
    if ((hv?.id ?? null) !== (P.hover?.id ?? null) && hv) audio.play('ui_blip', { volume: 0.18, bus: 'ui', pitch: 1.6 });
    P.setHover(hv);
    if (this.mode !== 'panel') return;
    if ((input.mouseHit(0) || input.hit('interact')) && hv && this.pressT < 0) this._press(hv);
    const back = input.mouseHit(2) || input.hit('jump') || input.hit('crouch') || input.pressed.has('Escape') || input.pressed.has('Backspace');
    if (back) {
      if (this.panelMode === 'keypad' && !this.dialing) this._toCall();
      else if (!this.dialing) this.closePanel();
    }
  }
  _press(t) {
    this.pressT = 0;
    this.pressTarget = t;
    this.cursor.set(t.x, t.y);
  }
  _handUpdate(dt) {
    const P = this.panel;
    if (!P || !this.hand.visible) return;
    let z = 0.072, k = 0;
    if (this.pressT >= 0) {
      this.pressT += dt;
      const t = this.pressTarget;
      const surf = t.kind === 'btn' ? 0.052 : 0.03;
      k = this.pressT < 0.075 ? sstep(0, 0.075, this.pressT) : 1 - sstep(0.075, 0.2, this.pressT);
      z = 0.072 + (surf - 0.072) * k;
      if (this.pressT >= 0.075 && !this.pressFired) { this.pressFired = true; P.pressAnim(t); this._action(t); }
      if (this.pressT > 0.2) { this.pressT = -1; this.pressFired = false; }
    }
    const tgx = this.cursor.x + Math.sin(this.t * 1.7) * 0.0015, tgy = this.cursor.y + Math.sin(this.t * 2.3) * 0.0012;
    const r = Math.min(1, dt * (this.pressT >= 0 ? 30 : 16));
    this.handPos.x += (tgx - this.handPos.x) * r;
    this.handPos.y += (tgy - this.handPos.y) * r;
    this.handPos.z += (z - this.handPos.z) * Math.min(1, dt * 40);
    if (this.mode !== 'panel' && this.mode !== 'dial') { this.handPos.y -= dt * 0.8; this.handPos.z += dt * 0.6; if (this.handPos.z > 0.6) this.hand.visible = false; }
    this.hand.position.copy(this.handPos);
    // the forearm dives in from below-right, so the hand never covers what it is about to press
    this.hand.rotation.set(0.78 + k * 0.06 + (this.cursor.y - 0.05) * 0.5, 0.55 - this.cursor.x * 1.1, 0.12, 'YXZ');
  }

  _action(t) {
    const P = this.panel, el = this.el, g = this.game;
    audio.play(t.kind === 'btn' ? 'button_press' : 'ui_type', { volume: t.kind === 'btn' ? 0.9 : 0.6, pitch: t.kind === 'btn' ? 0.8 : 0.9 + Math.random() * 0.2 });
    if (t.kind === 'btn') { audio.play('robo_clunk', { volume: 0.3 }); juice.shake(0.05); }
    switch (t.id) {
      case 'HOST': this._doHost(); break;
      case 'JOIN':
        this.panelMode = 'keypad';
        P.setMode('keypad');
        this.entry = '';
        P.readout.set('-----');
        audio.play('locker_open', { volume: 0.6, delay: 0.05 });
        this.goTo((dt, o) => this._panelPose(o), 0.6);
        input.textCapture = this._onKey;
        this.cursor.set(0, -0.07);
        break;
      case 'START':
        if (!g.lobbyStart?.()) audio.play('ui_error', { volume: 0.5, bus: 'ui' });
        break;
      case 'EXIT':
        if (!this.armedExit) {
          this.armedExit = 1;
          P.readout.set('SURE?');
          audio.play('buzzer', { volume: 0.5 });
          floatText.say('EXIT RECYCLES EVERY CLONE IN THE ROOM. PRESS AGAIN.', { at: P.group, offset: new THREE.Vector3(0, 0.42, 0), size: 0.5, color: '#ff8a6a', duration: 3.2 });
          setTimeout(() => { if (this.armedExit === 1 && !this.disposed) { this.armedExit = 0; P.readout.set(''); } }, 3500);
        } else {
          this.armedExit = 2;
          g.lobbyExit?.();
        }
        break;
      case 'DEL':
        this.entry = this.entry.slice(0, -1);
        P.readout.set(this.entry.padEnd(5, '-'), { left: true, stagger: 0 });
        break;
      case 'ENTER':
        if (this.entry.length === 5) this._doJoin(this.entry);
        else { audio.play('ui_error', { volume: 0.5, bus: 'ui' }); P.readout.set('?????'); setTimeout(() => !this.disposed && P.readout.set(this.entry.padEnd(5, '-'), { left: true }), 700); }
        break;
      default:
        if (this.entry.length < 5) {
          this.entry += t.id;
          P.readout.set(this.entry.padEnd(5, '-'), { left: true, stagger: 0 });
        } else audio.play('ui_error', { volume: 0.4, bus: 'ui' });
    }
  }
  _toCall() {
    if (input.textCapture === this._onKey) input.textCapture = null;
    this.panelMode = 'call';
    this.panel.setMode('call');
    this.panel.readout.set('');
    this.goTo((dt, o) => this._panelPose(o), 0.5);
    this.cursor.set(0.066, 0.11);
  }
  // keyboard typing on the keypad: the hand flies to the key and presses it
  _key(e) {
    if (this.mode !== 'panel' || this.panelMode !== 'keypad' || this.dialing) return;
    e.preventDefault?.();
    if (e.code === 'Escape' || this.pressT >= 0) return; // Escape also reaches _panelInput (back)
    let id = null;
    if (e.code === 'Backspace' || e.code === 'Delete') id = 'DEL';
    else if (e.code === 'Enter' || e.code === 'NumpadEnter') id = 'ENTER';
    else {
      const ch = String(e.key || '').toUpperCase();
      if (ch.length === 1 && CODE_CHARS.includes(ch)) id = ch;
      else if (ch.length === 1 && /[A-Z0-9]/.test(ch)) { audio.play('ui_error', { volume: 0.35, bus: 'ui' }); return; }
    }
    if (!id) return;
    const c = this.panel.keyCenter(id);
    if (!c) return;
    const k = this.panel.keys.find((q) => q.id === id);
    this._press({ kind: 'key', id, x: c.x, y: c.y, w: k.w, h: k.h });
    this.panel.setHover({ kind: 'key', id, x: c.x, y: c.y, w: k.w, h: k.h });
  }

  // HOST: dial the switchboard while the camera pulls back to the board
  _doHost() {
    const el = this.el, P = this.panel, g = this.game;
    this.mode = 'pull';
    this.holdT = 99;
    P.readout.set('DIAL');
    el.flash(['DIAL', 'DIAL..'], 30, 1.6);
    audio.play('radio_beep', { volume: 0.6 });
    audio.play('pull_cord', { volume: 0.4, delay: 0.3 });
    this.goTo((dt, o) => this._boardPose(o), 1.7);
    const t0 = this.t;
    const done = (code, err) => {
      if (this.disposed) return;
      this.lineMode = 'host';
      el.override = null;
      P.setMode('host');
      if (code) {
        el.hostCode(code, '');
        P.readout.set('OPEN');
        audio.play('elevator_ding', { volume: 0.8, pitch: 1.2 });
        floatText.say(`SHIFT CODE  ${code}`, { at: el.board.group, offset: new THREE.Vector3(0, -0.32, 0), size: 0.8, color: '#ffe2a0', duration: 6 });
        floatText.notice('Give the code to up to 3 clones. They drop in through the ceiling.', { color: '#ffd9a0', duration: 5 });
      } else {
        el.hostCode('', 'dead');
        P.readout.set('DEAD');
        audio.play('buzzer', { volume: 0.7 });
        audio.play('radio_static_burst', { volume: 0.5, delay: 0.1 });
        juice.shake(0.12);
        floatText.say('LINE DEAD', { at: el.board.group, offset: new THREE.Vector3(0, -0.3, 0), size: 0.9, color: '#ff6a4a', duration: 5 });
        floatText.notice(SOLO_ONLY ? 'No outside line in this build. Solo shift: press START when ready.' : `${err || 'No line to the switchboard'}. Solo shift: press START when ready.`, { color: '#ffb08a', duration: 6 });
      }
      this.holdT = Math.max(2.6, 1.9 - (this.t - t0) + 1.2);
    };
    if (SOLO_ONLY) { setTimeout(() => done(null), 1700); return; }
    g.lobbyHost().then((code) => done(code)).catch((e) => done(null, String(e?.message || e || '').replace(/\.$/, '')));
  }
  _boardPose(o) {
    const R = this.el.root, t = this.t;
    o.p.copy(R.localToWorld(_v.set(0.42 + Math.sin(t * 0.4) * 0.02, 1.48, 2.75 - Math.min(0.4, this.tr.t * 0.06))));
    this._lookQ(o.q, o.p, R.localToWorld(_v2.set(0, 2.36, 0)), 0.01);
    o.fov = 50;
    return o;
  }

  // JOIN: dial the code (game.lobbyJoin); the host's welcome triggers joinFall()
  _doJoin(code) {
    const P = this.panel, el = this.el, g = this.game;
    this.dialing = true;
    if (input.textCapture === this._onKey) input.textCapture = null;
    P.readout.set('.....');
    audio.play('radio_beep', { volume: 0.5 });
    audio.play('countdown_tick', { volume: 0.4, delay: 0.25 }); audio.play('countdown_tick', { volume: 0.4, delay: 0.5 });
    const fail = (msg) => {
      if (this.disposed || this.mode === 'joinfall') return;
      this.dialing = false;
      P.readout.set(SOLO_ONLY ? 'DEAD' : 'NONE?');
      el.flash(SOLO_ONLY ? ['LINE', 'DEAD'] : ['NO', 'SHIFT'], 6, 2.6);
      audio.play('buzzer', { volume: 0.7 });
      juice.shake(0.1);
      floatText.say(SOLO_ONLY ? 'LINE DEAD' : String(msg || 'NO SHIFT ON THAT CODE').toUpperCase(), { at: P.group, offset: new THREE.Vector3(0, 0.45, 0), size: 0.6, color: '#ff6a4a', duration: 3.5 });
      if (SOLO_ONLY) floatText.notice('No outside line in this build. Solo shift only.', { color: '#ffb08a', duration: 4 });
      setTimeout(() => {
        if (this.disposed || this.mode !== 'panel') return;
        this.entry = '';
        P.readout.set('-----');
        if (this.panelMode === 'keypad') input.textCapture = this._onKey;
      }, 1600);
    };
    if (SOLO_ONLY) { setTimeout(() => fail(), 1100); return; }
    g.lobbyJoin(code).then(() => {
      if (this.disposed || this.mode === 'joinfall') return;
      P.readout.set('LINK!');
      el.flash(['LINK', 'OK'], 6, 2.4);
    }).catch((e) => fail(e?.message));
  }

  // the host accepted us: the floor drops, we fall, then game.js loads the host's room (cb)
  joinFall(cb) {
    if (this.mode === 'joinfall') return;
    if (input.textCapture === this._onKey) input.textCapture = null;
    if (!this.active) this._grab(this.cur);
    this.mode = 'joinfall';
    this.jt = 0;
    this.joinCb = cb;
    this.panel?.readout.set('LINK!');
    this.el?.flash(['LINK', 'OK'], 6, 2.4);
    audio.play('elevator_ding', { volume: 0.7 });
    audio.play('robo_clunk', { volume: 0.8, delay: 0.25 });
  }
  _fallPose(o, up) {
    const l = this.game.local, t = this.jt ?? this.et ?? 0;
    o.p.copy(l.pos).setY(l.pos.y + EYE * 0.85);
    const c = this.lobby.trapCenter;
    if (up) this._lookQ(o.q, o.p, _v.set(c.x + Math.sin(t) * 0.3, 2.8, c.z), t * 0.9);
    else this._lookQ(o.q, o.p, _v.set(o.p.x + Math.sin(t * 1.3) * 0.6, o.p.y - 4, o.p.z + Math.cos(t * 1.3) * 0.6 + 0.3), -t * 0.7);
    o.fov = 78 + Math.min(14, t * 6);
    return o;
  }
  _joinFall(dt) {
    this.jt += dt;
    const t = this.jt, pp = engine.post.params;
    if (t < 0.5) this.lobby.setLights(0.5 + Math.random() * 0.5);
    if (t >= 0.55 && !this.trapped) {
      this.trapped = true;
      this.lobby.openTrap('join');
      this.game.local.arrivalGrace = 1e3;
      juice.shake(0.55); juice.hitstop(80);
      audio.play('door_heavy_open', { volume: 1, pitch: 0.8 });
      audio.play('_boom', { volume: 0.5 });
      this._loop('wind_fall', true, 0.8);
      this.goTo((d, o) => this._fallPose(o, true), 0.45);
      this.hand.visible = false;
    }
    if (t > 0.6) pp.uGlitch.value = clamp((t - 0.6) * 0.45, 0, 0.7);
    this._noKillPlane();
    if (t > 1.5) pp.uFade.value = sstep(1.5, 1.95, t);
    if (t > 2.0 && this.joinCb) {
      const cb = this.joinCb;
      this.joinCb = null;
      this._loop('wind_fall', false);
      cb();
    }
  }

  // START pressed (every peer): a wide shot of the doors for whoever is at the panel
  onBoard() {
    const host = this.mode === 'panel';
    floatText.notice('THE CAR LEAVES IN 8 SECONDS. EVERYONE IN THE ROOM GOES.', { color: '#ffd9a0', duration: 4.5 });
    if (!host) return;
    if (input.textCapture === this._onKey) input.textCapture = null;
    this.mode = 'board';
    this.holdT = 2.2;
    this.goTo((dt, o) => {
      const R = this.el.root;
      o.p.copy(R.localToWorld(_v.set(-0.25, 1.45, 3.0 - Math.min(0.5, this.tr.t * 0.15))));
      this._lookQ(o.q, o.p, R.localToWorld(_v2.set(0, 1.25, -0.8)), -0.01);
      o.fov = 56;
      return o;
    }, 1.0);
  }

  // ------------------------------------------------------------------ EXIT: into the robot pit
  exitFall() {
    if (this.mode === 'exit') return;
    if (input.textCapture === this._onKey) input.textCapture = null;
    const g = this.game;
    g.exiting = true;
    // nobody dies of the fall itself (that is the furnace's job)
    if (g.local) g.local.arrivalGrace = 1e3;
    if (!this.active) this._grab(this.cur);
    this.mode = 'exit';
    this.et = 0;
    this.hand.visible = false;
    preparePit(); // build + compile the pit while the klaxon runs
    this.goTo((dt, o) => {
      const l = this.game.local, t = this.et;
      o.p.copy(l.pos).setY(l.pos.y + EYE - Math.min(0.25, t * 0.2));
      this._eulerQ(o.q, l.yaw + Math.sin(t * 0.9) * 0.15, -0.35 - Math.min(0.5, t * 0.3), Math.sin(t * 7) * 0.02);
      o.fov = 70;
      return o;
    }, 0.6);
    audio.play('alarm', { volume: 0.8 });
    audio.play('alarm', { volume: 0.7, delay: 1.1 });
    this.lobby.setTint(1, 0.18, 0.1);
    floatText.notice('SHIFT CANCELLED. ALL CLONES ARE BEING RECYCLED.', { color: '#ff6a4a', duration: 4 });
  }
  _exit(dt) {
    const t = (this.et += dt), g = this.game, l = g.local;
    if (this.pit) {
      this.pit.update(dt);
      if (this.pit.finished && !this.leaving) {
        this.leaving = true;
        g.finishExit?.();
      }
      return;
    }
    this.lobby.setLights(t < 1.3 ? (Math.floor(t * 7) % 2 ? 1 : 0.15) : 0.6 + Math.random() * 0.3);
    if (t >= 1.3 && !this.trapped) {
      this.trapped = true;
      this.lobby.openTrap('exit');
      juice.shake(0.7); juice.hitstop(90); juice.flash(0.15);
      audio.play('door_heavy_open', { volume: 1, pitch: 0.7 });
      audio.play('_boom', { volume: 0.7 });
      audio.play('_amb_scream', { volume: 0.6, delay: 0.4 });
      this._loop('wind_fall', true, 0.9);
      // nobody stays on the ledge
      const c = this.lobby.trapCenter;
      if (!l.dead && l.world) l.applyYank([(c.x - l.pos.x) * 1.6, 2.2, (c.z - l.pos.z) * 1.6]);
      this.goTo((d, o) => this._fallPose(o, false), 0.5);
    }
    if (t > 1.6) engine.post.params.uGlitch.value = clamp((t - 1.6) * 0.3, 0, 0.35);
    this._noKillPlane();
    if (t >= 2.5) {
      this._loop('wind_fall', false);
      this.pit = new RobotPit(g, { yaw: l.yaw });
      this.pit.start();
      // keep the clone safe up here while the view is in the pit
      this.lobby.closeTrapCollider();
      if (l.world) { l.teleport(this.lobby.trapCenter.clone().setY(0.05)); l.fallSpeed = 0; }
    }
  }

  // never let a falling clone reach the world's out-of-bounds respawn while the cutscene still follows it
  _noKillPlane() {
    const l = this.game.local;
    if (l.world && l.pos.y < -11) { l.teleport(l.pos.clone().setY(-11)); l.fallSpeed = 0; }
  }

  dispose() {
    this.disposed = true;
    for (const k of Object.keys(this.loops)) this._loop(k, false);
    if (input.textCapture === this._onKey) input.textCapture = null;
    this.pit?.dispose();
    this.pit = null;
    this.hand.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    this.hand.removeFromParent();
    if (this.game.cutscene?.kind === 'lobby') this.game.cutscene = null;
    const vm = engine.post?.vmPass;
    if (vm) vm.enabled = !engine.view;
  }
}
