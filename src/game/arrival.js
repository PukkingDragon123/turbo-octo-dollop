// Waking up (game.arrival; built by the Level 0 mission on every peer). The clone comes to on the carpet:
// black, a breath, the eyes blink open slowly (two soft eyelids in front of the camera part, close, part again),
// the ceiling lights swim into focus, then the clone sits up and gets to its feet, the camera riding its head on
// eased curves with a little anticipation and overshoot, servos whirring, breath, the suit rustling. Then the
// player has it. No props appear, nothing explains itself.
//   wake({ short })  play it for the local clone (short: waking again after dying, in your bed)
//   closeEyes(k)     eyelids 0 (open) .. 1 (shut), used while sleeping
//   update(dt)       every frame after the player (it owns the camera while it plays)
// While it plays the clone counts as asleep (no hands, no control) and game.cutscene is set.
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { audio } from '../audio/audio.js';
import { juice } from '../gfx/juice.js';

const PI = Math.PI;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const ease = (k) => k * k * (3 - 2 * k);
const easeOut = (k) => 1 - (1 - k) ** 3;
// overshoot ease (back out): rises past 1 a touch and settles
const back = (k, s = 1.4) => 1 + (s + 1) * (k - 1) ** 3 + s * (k - 1) ** 2;
const _v = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const LID_H = 1.4;

// eyelid openness over time (1 = shut) for the full wake and the short one
const LIDS = [[0, 1], [1.3, 1], [1.75, 0.72], [2.2, 0.98], [2.55, 0.98], [3.2, 0.42], [3.55, 0.85], [3.75, 0.85], [4.5, 0]];
const LIDS_SHORT = [[0, 1], [0.5, 1], [1.0, 0.55], [1.25, 0.9], [1.4, 0.9], [2.0, 0]];
function curve(pts, t) {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) { const k = ease((t - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0])); return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k; }
  }
  return pts[pts.length - 1][1];
}

export class WakeUp {
  constructor(mission) {
    this.mission = mission;
    this.game = mission.game;
    this.world = mission.world;
    this.cur = null;
    this.cs = { kind: 'wake', t: 0 };
    this.lid = 0;       // current eyelid closure 0..1
    this.lidWant = 0;
    this.lids = null;
    this.log = [];      // played wakes (for tests)
  }

  // eyelids: two soft-edged dark shapes in front of the viewmodel camera (an eye-shaped arc, a soft rim)
  _buildLids() {
    if (this.lids) return this.lids;
    const cv = document.createElement('canvas');
    cv.width = 16; cv.height = 256;
    const c = cv.getContext('2d');
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(6,5,4,1)'); g.addColorStop(0.88, 'rgba(8,6,4,1)'); g.addColorStop(0.95, 'rgba(14,9,6,0.7)'); g.addColorStop(1, 'rgba(18,12,8,0)');
    c.fillStyle = g; c.fillRect(0, 0, 16, 256);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    const grp = new THREE.Group();
    const mk = (flip) => {
      const geo = new THREE.PlaneGeometry(3.2, LID_H, 32, 1);
      const P = geo.attributes.position;
      for (let i = 0; i < P.count; i++) { const x = P.getX(i); P.setY(i, P.getY(i) - x * x * 0.25); }
      geo.translate(0, LID_H / 2, 0); // the soft rim sits at local y = 0
      const m = new THREE.Mesh(geo, mat);
      if (flip) m.rotation.z = PI;
      m.renderOrder = 60;
      m.frustumCulled = false;
      grp.add(m);
      return m;
    };
    this.lids = { grp, top: mk(false), bot: mk(true), mat };
    grp.position.z = -0.5;
    return this.lids;
  }

  _applyLids() {
    const L = this.lids;
    if (!L) return;
    const on = this.lid > 0.003;
    if (on && !L.grp.parent) engine.vmCamera.add(L.grp);
    if (!on) { if (L.grp.parent) L.grp.removeFromParent(); return; }
    const cam = engine.vmCamera;
    const halfH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * 0.5;
    // open: the rims beyond the frame edges; shut: they overlap a rim's width past the middle (no gap of light)
    const k = ease(this.lid), soft = LID_H * 0.12;
    L.top.position.y = halfH * 1.25 * (1 - k) - soft * k;
    L.bot.position.y = -halfH * 1.25 * (1 - k) + soft * k - 0.01 * k;
  }

  closeEyes(k) { this.lidWant = clamp01(k); }

  // ------------------------------------------------------------------ the sequence
  wake(o = {}) {
    const g = this.game, l = g.local;
    if (!l.world || l.dead) return;
    this._buildLids();
    const short = !!o.short;
    const fwd = new THREE.Vector3(-Math.sin(l.yaw), 0, -Math.cos(l.yaw));
    const side = new THREE.Vector3(Math.cos(l.yaw), 0, -Math.sin(l.yaw));
    const base = l.pos.clone();
    this.cur = { t: 0, short, dur: short ? 4.2 : 8.2, base, fwd, side, yaw: l.yaw, roll: (Math.random() < 0.5 ? -1 : 1), fired: new Set() };
    this.lid = 1;
    this.lidWant = 1;
    this._applyLids();
    g.cutscene = this.cs;
    l.releaseGrab?.(false);
    l.survival.sleeping = true; // no hands, no control: the clone is still out
    l.sleepT = 0;
    l.watchOpen = false;
    engine.post.params.uFade.value = 1;
    audio.setMuffle?.(0.85);
    this.log.push(`${short ? 'short' : 'full'}@${(this.world.time || 0).toFixed(1)}`);
  }

  get playing() { return !!this.cur; }

  update(dt) {
    dt = Math.min(dt, 0.1);
    const c = this.cur;
    if (!c) {
      // sleeping: the lids drift shut / open
      const l = this.game.local;
      const want = l.survival?.sleeping && !l.dead ? Math.min(1, (l.sleepT || 0) * 0.8) : 0;
      this.lid += (want - this.lid) * Math.min(1, dt * (want > this.lid ? 1.5 : 5));
      if (this.lid > 0.003 || this.lids?.grp.parent) { this._buildLids(); this._applyLids(); }
      return;
    }
    const g = this.game, l = g.local;
    if (!l.world || l.dead || g.world !== this.world) { this._finish(true); return; }
    c.t += dt;
    const t = c.t, S = c.short;
    const once = (k, at, fn) => { if (t >= at && !c.fired.has(k)) { c.fired.add(k); fn(); } };
    // the eyelids carry the darkness from the first parting on
    this.lid = curve(S ? LIDS_SHORT : LIDS, t);
    const pp = engine.post.params;
    pp.uFade.value = t < (S ? 0.5 : 1.25) ? 1 : Math.max(0, pp.uFade.value - dt * 4);
    audio.setMuffle?.(Math.max(0, 0.85 - seg(t, S ? 0.5 : 1.0, S ? 2.2 : 4.4) * 0.85));
    this._applyLids();
    // sounds: breath in the dark, a gasp at the first look, servos as it sits up, a knee clunk, the stand
    const T = S ? { breath: 0.2, look: 0.9, sit: 1.9, sitEnd: 2.9, stand: 2.9, standEnd: 3.9 } : { breath: 0.4, look: 1.7, sit: 4.4, sitEnd: 5.9, stand: 6.0, standEnd: 7.7 };
    once('breath', T.breath, () => audio.play('_inhale', { volume: 0.6, bus: 'ui' }));
    once('look', T.look, () => { audio.play(S ? '_exhale' : 'gasp', { volume: 0.45, bus: 'ui' }); audio.play('robo_whir', { volume: 0.25, pitch: 1.4 }); });
    once('blink', S ? 1.3 : 3.5, () => audio.play('android_servo', { volume: 0.2, pitch: 1.8 }));
    once('sit', T.sit, () => { audio.play('android_servo', { volume: 0.5, pitch: 0.8 }); audio.play('suit_rustle', { volume: 0.6 }); audio.play('_exhale', { volume: 0.5, bus: 'ui', delay: 0.3 }); });
    once('knee', T.stand + 0.35, () => { audio.play('robo_clunk', { volume: 0.5 }); audio.play('robo_whir', { volume: 0.4, pitch: 0.7 }); });
    once('up', T.stand + 0.9, () => { audio.play('breath_heavy', { volume: 0.35, bus: 'ui' }); audio.play('suit_rustle', { volume: 0.4 }); juice.shake?.(0.06); });
    // the head: lying flat (looking up at the ceiling) -> sitting up (looking at the floor ahead) -> standing
    const lie = c.base.clone().addScaledVector(c.fwd, S ? -0.5 : -0.78).setY(c.base.y + 0.17);
    const sit = c.base.clone().addScaledVector(c.fwd, -0.32).setY(c.base.y + 0.74);
    const kneel = c.base.clone().addScaledVector(c.fwd, -0.06).setY(c.base.y + 0.92);
    const stand = c.base.clone().setY(c.base.y + 1.36);
    const pos = _v;
    let pitch, roll, yaw = c.yaw;
    const ks = seg(t, T.sit, T.sitEnd), kt = seg(t, T.stand, T.standEnd);
    if (ks <= 0) {
      // flat on the back: the ceiling, a slow drift, the head rolls a little toward one side
      pos.copy(lie);
      pitch = 1.42 - Math.sin(t * 0.7) * 0.03;
      roll = c.roll * (0.28 - seg(t, T.look, T.sit) * 0.1) + Math.sin(t * 0.9) * 0.02;
      yaw += Math.sin(t * 0.4) * 0.05;
    } else if (kt <= 0) {
      // sitting up: a little dip first (anticipation), then up and forward past the mark, settle
      const k = back(easeOut(ks), 0.9);
      const dip = Math.sin(seg(ks, 0, 0.18) * PI) * 0.03;
      pos.lerpVectors(lie, sit, k);
      pos.y -= dip;
      pitch = 1.42 + (-0.42 - 1.42) * ease(ks);
      roll = c.roll * 0.18 * (1 - ks) + Math.sin(ks * PI) * 0.04 * -c.roll;
      yaw += Math.sin(ks * PI) * 0.08 * c.roll;
    } else {
      // getting up: weight forward onto a knee, push up, a sway at the top
      const k1 = ease(seg(kt, 0, 0.45)), k2 = back(seg(kt, 0.4, 1), 1.1);
      if (kt < 0.45) pos.lerpVectors(sit, kneel, k1);
      else pos.lerpVectors(kneel, stand, Math.min(1.04, k2));
      pitch = -0.42 + (0.04 + 0.42) * ease(seg(kt, 0.35, 1)) - Math.sin(seg(kt, 0.1, 0.6) * PI) * 0.16;
      roll = Math.sin(kt * PI * 1.5) * 0.035 * c.roll;
      yaw += Math.sin(kt * PI) * 0.06 * -c.roll;
    }
    // hand back: blend into the player's own camera over the last half second
    const out = seg(t, c.dur - 0.5, c.dur);
    const cam = engine.camera;
    _e.set(pitch, yaw, roll, 'YXZ');
    const q = new THREE.Quaternion().setFromEuler(_e);
    if (out > 0) {
      const lp = new THREE.Vector3(l.pos.x, l.pos.y + 1.36, l.pos.z);
      pos.lerp(lp, ease(out));
      _e.set(l.pitch, l.yaw, 0, 'YXZ');
      q.slerp(new THREE.Quaternion().setFromEuler(_e), ease(out));
    }
    cam.position.copy(pos);
    cam.quaternion.copy(q);
    cam.fov += (66 - cam.fov) * Math.min(1, dt * 3);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    audio.setListener(cam.position, cam.quaternion);
    // the player's look follows where the head ended up, so control starts where the camera is
    l.pitch = t < T.stand ? 0 : pitch * (1 - out);
    if (t >= c.dur) this._finish(false);
  }

  _finish(aborted) {
    const c = this.cur;
    this.cur = null;
    const g = this.game, l = g.local;
    if (g.cutscene === this.cs) g.cutscene = null;
    this.lid = 0;
    this._applyLids();
    engine.post.params.uFade.value = 0;
    audio.setMuffle?.(0);
    if (l.survival.sleeping && !aborted) { l.survival.sleeping = false; l.sleepT = 0; }
    else if (aborted) l.survival.sleeping = false;
    if (!aborted) this.mission.onWoke?.(c);
  }

  dispose() {
    if (this.cur) this._finish(true);
    if (this.lids) { this.lids.grp.removeFromParent(); this.lids.mat.map?.dispose(); this.lids.mat.dispose(); }
    if (this.game.arrival === this) this.game.arrival = null;
  }
}
