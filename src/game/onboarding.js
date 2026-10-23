// Level 0 onboarding props (built by CampMission on every peer; staged by the arrival director, game/arrival.js).
// Nothing is there when you land: each thing CLIPS IN on its beat.
//   SupplyCrate 'ob_crate_a'  glitches up out of the carpet, pops free, thuds down. [E] opens the lid: the
//              supplies (food, drink, bandage, flashlight per clone) stay INSIDE, nested on the foam; pick them
//              out one by one (hollow colliders, items spawned asleep). state { open }
//   BrokenBot  'ob_bot'      a broken Healthity spat out of the camp wall, sparking, a "REPAIR ME" note taped
//              to its shell ([E] on the note: paper view). [E] on the unit starts the repair minigame
//              (game/repairgame.js); when it is fixed every peer's Healthity boots from that spot.
//              Its state lives on the director (stage 3 = present, 4 = fixed).
import * as THREE from 'three';
import { net } from '../net/net.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { Device } from './devices.js';
import { ModelDevice } from './devicekinds.js';
import { buildHealthity } from '../entities/optional.js';
import { floatText } from '../ui/floattext.js';
import { FONT } from '../ui/fonts.js';
import { campToWorld } from './campdevices.js';
import { Q } from '../physics/physics.js';
import { juice } from '../gfx/juice.js';

const SUPPLIES = ['protein_bar', 'almond_milk', 'bandage', 'flashlight'];
const SPOTS = [[-1.55, 3.35, 0.25], [1.3, 4.05, -0.3]]; // camp-local x, z, yaw offset (camp +z faces the lift)
const HH = 0.3;            // crate half height (model origin = centre)
const BOT_SCALE = 0.72;    // same as the companion
const NARRATE = '#e9e0bd';
const PI = Math.PI;
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const ease = (k) => k * k * (3 - 2 * k);

function canvasTex(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }

function tagTexture(lines) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#e6dcc0'; x.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '120,100,60' : '255,250,235'},0.12)`; x.fillRect(Math.random() * 512, Math.random() * 256, 2, 2); }
  x.strokeStyle = 'rgba(40,30,20,0.8)'; x.lineWidth = 6; x.strokeRect(12, 12, 488, 232);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  lines.forEach(([t, y, px]) => { x.font = `bold ${px}px ${FONT.type}`; x.fillStyle = '#2a2018'; x.fillText(t, 256, y); });
  return canvasTex(c);
}

// the note taped to the broken unit (also the paper view's canvas)
export function drawRepairNote() {
  const c = document.createElement('canvas'); c.width = 640; c.height = 480;
  const x = c.getContext('2d');
  x.fillStyle = '#ece4cc'; x.fillRect(0, 0, 640, 480);
  // ruled pad paper, a torn top edge, smudges
  x.strokeStyle = 'rgba(70,110,170,0.28)'; x.lineWidth = 2;
  for (let y = 112; y < 480; y += 38) { x.beginPath(); x.moveTo(0, y); x.lineTo(640, y); x.stroke(); }
  x.strokeStyle = 'rgba(190,60,60,0.35)'; x.beginPath(); x.moveTo(64, 0); x.lineTo(64, 480); x.stroke();
  for (let i = 0; i < 700; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '110,90,50' : '255,252,240'},0.1)`; x.fillRect(Math.random() * 640, Math.random() * 480, 2, 2); }
  x.globalCompositeOperation = 'destination-out';
  x.beginPath(); x.moveTo(0, 0);
  for (let px = 0; px <= 640; px += 16) x.lineTo(px, 4 + Math.random() * 10);
  x.lineTo(640, 0); x.closePath(); x.fill();
  x.globalCompositeOperation = 'source-over';
  x.textBaseline = 'middle';
  const ink = (s, px, y, font = FONT.hand, col = '#1f2a4a', rot = 0, X = 86) => { x.save(); x.translate(X, y); x.rotate(rot); x.font = `${px}px ${font}`; x.fillStyle = col; x.fillText(s, 0, 0); x.restore(); };
  ink('REPAIR ME', 66, 62, FONT.marker, '#8e2a20', -0.03, 150);
  ink('I am a HEALTHITY Mk-VII. I keep clones alive.', 33, 130);
  ink('I fell forty floors. My logic board is cooked.', 33, 168);
  ink('1. empty hand, MULTITOOL out (RMB)', 33, 206);
  ink('2. each wire onto the terminal of its colour', 33, 244);
  ink('3. zap every joint until it holds', 33, 282);
  ink('Then I can get you out of here.', 33, 320);
  ink('There is no way back. Only through.', 33, 358, FONT.hand, '#5a2a2a');
  ink('- H.', 40, 420, FONT.hand, '#1f2a4a', -0.05, 470);
  // crossed-out factory stencil
  x.font = `bold 22px ${FONT.type}`; x.fillStyle = 'rgba(40,30,20,0.55)'; x.fillText('MEDICAL UNIT - DO NOT REACTIVATE', 92, 452);
  x.strokeStyle = 'rgba(142,42,32,0.85)'; x.lineWidth = 4; x.beginPath(); x.moveTo(86, 455); x.lineTo(430, 447); x.stroke();
  return c;
}

// ------------------------------------------------------------------------------------------ supply crate
class SupplyCrate extends ModelDevice {
  constructor(world, ob, spot) {
    super(world, 'ob_crate_a', 'supply_crate', { state: { open: 0 }, collide: false });
    this.ob = ob;
    this.game = world.game;
    const p = ob.place(spot[0], spot[1]);
    this.restPos = new THREE.Vector3(p.x, p.y + HH, p.z);
    this.restYaw = ob.mission.camp.yaw + spot[2];
    this.root.position.copy(this.restPos);
    this.root.rotation.set(0, this.restYaw, 0);
    this.anim = 0;
    this.vel = 0;
    this.range = 2.2;
    this.tagMat = new THREE.MeshStandardMaterial({ map: tagTexture([['RATIONS', 70, 54], ['& FIRST AID', 128, 36], ['FOR NEW EMPLOYEES', 182, 26]]), roughness: 0.9 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17), this.tagMat);
    m.position.set(0.12, -0.04, 0.3045); m.rotation.z = -0.04;
    this.root.add(m);
    this.root.visible = false;
    this.present = false;
    this.fired = new Set();
  }
  // in the world for good: rest pose + hollow colliders (floor, four walls, the lid while it is shut)
  setPresent() {
    this.root.position.copy(this.restPos);
    this.root.rotation.set(0, this.restYaw, 0);
    this.root.visible = true;
    if (this.present) return;
    this.present = true;
    this.addColliders([
      { type: 'box', size: [0.9, 0.17, 0.6], pos: [0, -0.215, 0] },
      { type: 'box', size: [0.04, 0.6, 0.6], pos: [-0.43, 0, 0] },
      { type: 'box', size: [0.04, 0.6, 0.6], pos: [0.43, 0, 0] },
      { type: 'box', size: [0.9, 0.6, 0.04], pos: [0, 0, -0.28] },
      { type: 'box', size: [0.9, 0.6, 0.04], pos: [0, 0, 0.28] },
    ]);
    this.root.updateMatrixWorld(true);
    _v.set(0, 0.27, 0).applyMatrix4(this.root.matrixWorld);
    this.lidCol = this.world.physics.addStaticBox(_v.x, _v.y, _v.z, 0.45, 0.03, 0.3, { kind: 'device', device: this }, this.restYaw);
    this.colliders.push(this.lidCol);
    if (this.state.open) this.lidCol.setEnabled(false);
  }
  prompt() { return this.present && !this.state.open ? `[${input.keyName('interact')}] Open the supply crate` : null; }
  interact() { if (this.present && !this.state.open) this.send('open'); }
  hostAction(a) { if (a === 'open' && this.present && !this.state.open) this.hostOpen(); }
  onState(s, sync) {
    if (s.open) { if (sync) this.anim = 1; this.lidCol?.setEnabled(false); if (!sync) this.vel = 9; }
  }
  // host: the lid swings up and the supplies are right there, nested in the foam (one set per clone)
  hostOpen() {
    const w = this.world;
    this.setState({ open: 1 });
    const items = [];
    for (let k = 0; k < Math.max(1, Math.min(4, this.game.roster?.size || 1)); k++) items.push(...SUPPLIES);
    this.root.updateMatrixWorld(true);
    const q0 = this.root.quaternion;
    items.forEach((t, i) => {
      const layer = Math.floor(i / 8), k = i % 8;
      const lx = -0.3 + (k % 4) * 0.2, lz = k < 4 ? -0.12 : 0.12;
      const pos = new THREE.Vector3(lx, -0.07 + layer * 0.11, lz).applyMatrix4(this.root.matrixWorld);
      const q = q0.clone().multiply(_q.setFromEuler(_e.set(0, (Math.random() - 0.5) * 0.5 + (t === 'flashlight' ? PI / 2 : 0), 0)));
      w.props.spawn(t, pos, q, { sleep: true, vel: new THREE.Vector3(0, -0.2, 0), state: t === 'flashlight' ? { charge: 1 } : {} });
    });
    const base = this.root.position;
    w.fxAll({ k: 'snd', n: 'crate_pry', p: base.toArray(), v: 0.9 });
    w.fxAll({ k: 'snd', n: 'locker_open', p: base.toArray(), v: 0.8 });
    w.fxAll({ k: 'dust', p: [base.x, base.y + 0.35, base.z], n: 14, s: 0.6 });
    this.ob.narrate('The supplies are still inside. Take what you need.', 1.2);
  }

  // clip-in, t = seconds into the beat: stuck half-sunk in the carpet, jittering, then the floor spits it out
  // and it thuds down onto its spot
  clipIn(t) {
    const R = this.root, P = this.restPos, w = this.world;
    const once = (k, at, fn) => { if (t >= at && !this.fired.has(k)) { this.fired.add(k); fn(); } };
    const floor = _v.set(P.x, P.y - HH + 0.02, P.z).clone();
    if (t < 0.95) {
      const j = 0.012 + 0.02 * Math.random();
      R.visible = Math.random() < 0.82;
      R.position.set(P.x + (Math.random() - 0.5) * j, P.y - 0.42 + (Math.random() - 0.5) * j, P.z + (Math.random() - 0.5) * j);
      R.rotation.set(0.22 + (Math.random() - 0.5) * 0.05, this.restYaw + 0.4, -0.16 + (Math.random() - 0.5) * 0.05);
      once('rumble', 0, () => { audio.play('crate_rumble', { pos: floor, volume: 1 }); audio.play('_uncanny', { pos: floor, volume: 0.5 }); });
      if (Math.random() < 0.25) w.fx?.sparks?.(floor.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0, (Math.random() - 0.5) * 0.6)), 3, null, [1, 0.85, 0.5], 1.4);
      once('dust0', 0.1, () => w.fx?.dustBurst?.(floor, 18, [0.62, 0.52, 0.4], 0.9));
      return;
    }
    R.visible = true;
    once('pop', 0.95, () => {
      audio.play('_crack', { pos: floor, volume: 1 }); audio.play('throw_whoosh', { pos: floor, volume: 0.8, pitch: 0.7 });
      w.fx?.dustBurst?.(floor, 30, [0.62, 0.52, 0.4], 1.3);
      w.fx?.sparks?.(floor, 24, null, [1, 0.85, 0.5], 3);
    });
    const T = 0.85, u = t - 0.95;
    if (u < T) {
      const v0 = (0.42 + 4.9 * T * T) / T;
      const y = -0.42 + v0 * u - 4.9 * u * u;
      const k = u / T;
      R.position.set(P.x, P.y + y, P.z);
      R.rotation.set(0.22 * (1 - k) + Math.sin(k * PI) * 0.9, this.restYaw + 0.4 * (1 - k) - Math.sin(k * PI) * 0.6, -0.16 * (1 - k) + Math.sin(k * PI * 2) * 0.25);
      return;
    }
    once('land', 0.95 + T, () => {
      audio.play('crate_land', { pos: floor, volume: 1.1 }); audio.play('thunk', { pos: floor, volume: 0.9, pitch: 0.6 });
      w.fx?.dustBurst?.(floor, 34, [0.62, 0.56, 0.42], 1.4);
      if (this.game.local.pos.distanceTo(P) < 9) juice.shake(0.35);
    });
    const b = u - T;
    R.position.set(P.x, P.y + Math.abs(Math.sin(b * 13)) * 0.07 * Math.exp(-b * 6), P.z);
    R.rotation.set(Math.sin(b * 17) * 0.05 * Math.exp(-b * 5), this.restYaw, Math.sin(b * 11) * 0.04 * Math.exp(-b * 5));
  }

  update(dt) {
    if (!this.present) return;
    const target = this.state.open ? 1 : 0;
    this.vel += ((target - this.anim) * 90 - this.vel * 9) * dt;
    this.anim = Math.max(0, Math.min(1.08, this.anim + this.vel * dt));
    const lid = this.parts.lid;
    if (lid) lid.rotation.x = (this.model.params?.lidOpenSign ?? -1) * this.anim * 1.9;
  }
  dispose() { super.dispose(); this.tagMat.map?.dispose(); this.tagMat.dispose(); }
}

// ------------------------------------------------------------------------------------------ broken Healthity
class BrokenBot extends Device {
  constructor(world, ob, spot) {
    super(world, 'ob_bot', {});
    this.ob = ob;
    this.game = world.game;
    const p = ob.place(spot[0], spot[1]);
    const yaw = ob.mission.camp.yaw + spot[2];
    this.restPos = new THREE.Vector3(p.x, p.y + 0.15 * BOT_SCALE - 0.004, p.z);
    this.restQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.05, 0.35, 0.55)));
    this.wallPt = null;
    this.noteCanvas = drawRepairNote();
    this.bot = null;
    this.present = false;
    this.fired = new Set();
    this.sparkT = 2;
    this.flick = 0;
  }
  _ensure() {
    if (this.bot) return this.bot;
    const b = (this.bot = buildHealthity());
    b.root.scale.setScalar(BOT_SCALE);
    b.setPower?.(0);
    b.setFace?.('off');
    // the note, taped across the top of the shell
    this.noteTex = canvasTex(this.noteCanvas);
    this.noteMat = new THREE.MeshStandardMaterial({ map: this.noteTex, roughness: 0.95, side: THREE.DoubleSide });
    const note = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.15), this.noteMat);
    note.position.set(0, 0.148, -0.01); note.rotation.set(-PI / 2 + 0.12, 0, 0.18);
    const tape = new THREE.MeshStandardMaterial({ color: 0xd9d2b8, roughness: 0.6, transparent: true, opacity: 0.75 });
    for (const s of [-1, 1]) { const t = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.09), tape); t.position.set(s * 0.085, 0.002, 0.0); t.rotation.z = s * 0.3; note.add(t); }
    b.root.add(note);
    this.note = note;
    this.world.group.add(b.root);
    return b;
  }
  get bpos() { return this.bot?.root.position || this.restPos; }
  // the wall it is spat out of: from the rest spot toward the lift wall (measured on first use)
  wall() {
    if (this.wallPt) return this.wallPt;
    const dir = campToWorld({ pos: new THREE.Vector3(), yaw: this.ob.mission.camp.yaw }, 0, 0, 1).normalize();
    const o = this.restPos.clone().setY(this.restPos.y + 0.6);
    let d = 3;
    try { const hit = this.world.physics.raycast(o, dir, 9, Q.world); if (hit) d = hit.dist; } catch (e) { /* physics not ready */ }
    this.wallDir = dir.clone().negate(); // out of the wall, into the camp
    return (this.wallPt = o.clone().addScaledVector(dir, d));
  }
  // clip-in, t = seconds into the beat: half out of the wall, jittering and sparking, then it is spat out,
  // hits the carpet, rolls once and lies there
  clipIn(t) {
    const b = this._ensure(), R = b.root, w = this.world;
    const once = (k, at, fn) => { if (t >= at && !this.fired.has(k)) { this.fired.add(k); fn(); } };
    const W = this.wall(), D = this.wallDir;
    if (t < 1.2) {
      R.visible = Math.random() < 0.85;
      const j = 0.01 + Math.random() * 0.015;
      R.position.copy(W).addScaledVector(D, 0.05 + (Math.random() - 0.5) * j).add(_v.set((Math.random() - 0.5) * j, 0.35 + (Math.random() - 0.5) * j, (Math.random() - 0.5) * j));
      R.quaternion.setFromEuler(_e.set(0.6, Math.atan2(D.x, D.z) + 0.3, 0.4 + Math.random() * 0.05));
      b.setPower?.(Math.random() < 0.3 ? 0.4 : 0); b.setFace?.(Math.random() < 0.4 ? 'static' : 'off');
      once('in', 0, () => { audio.play('hl_knock', { pos: W, volume: 1 }); audio.play('_uncanny', { pos: W, volume: 0.6 }); w.fx?.dustBurst?.(W, 16, [0.7, 0.62, 0.4], 0.7); });
      once('spark', 0.5, () => { audio.play('hl_short', { pos: W, volume: 0.8 }); w.fx?.sparks?.(W, 20, null, [1, 0.8, 0.4], 2.4); });
      if (Math.random() < 0.2) w.fx?.sparks?.(W, 4, null, [1, 0.8, 0.4], 1.6);
      b.update?.(1 / 60);
      return;
    }
    R.visible = true;
    once('spit', 1.2, () => { audio.play('_arc_pop', { pos: W, volume: 1 }); audio.play('throw_whoosh', { pos: W, volume: 0.7, pitch: 1.2 }); w.fx?.sparks?.(W, 30, null, [1, 0.8, 0.4], 3.2); w.fx?.dustBurst?.(W, 24, [0.7, 0.62, 0.4], 1); });
    const T = 0.62, u = t - 1.2;
    const P0 = _v.copy(W).addScaledVector(D, 0.12).setY(W.y + 0.35).clone();
    if (u < T) {
      const k = u / T;
      R.position.lerpVectors(P0, this.restPos, k);
      R.position.y += Math.sin(k * PI) * 0.45;
      R.quaternion.setFromEuler(_e.set(0.6 - k * 3.6, Math.atan2(D.x, D.z) + 0.3 + k * 1.2, 0.4 + k * 2.2));
      b.update?.(1 / 60);
      return;
    }
    once('land', 1.2 + T, () => {
      audio.play('thunk', { pos: this.restPos, volume: 1, pitch: 0.7 });
      audio.play('hl_dying', { pos: this.restPos, volume: 0.9 });
      w.fx?.sparks?.(this.restPos, 26, null, [1, 0.8, 0.4], 2.6);
      w.fx?.dustBurst?.(this.restPos, 16, [0.75, 0.7, 0.55], 0.6);
      this.flick = 0.5;
    });
    const bt = u - T;
    R.position.copy(this.restPos);
    R.position.y += Math.abs(Math.sin(bt * 9)) * Math.exp(-bt * 6) * 0.06;
    _q.setFromEuler(_e.set(-3 + 3 * clamp01(bt * 2.5), 1.5 * (1 - clamp01(bt * 2.5)), 2.6 * (1 - ease(clamp01(bt * 2)))));
    R.quaternion.copy(this.restQ).multiply(_q);
  }
  // lying there for good: rest pose + its two pick colliders (the unit, the note)
  setPresent() {
    const b = this._ensure();
    b.root.visible = true;
    b.root.position.copy(this.restPos);
    b.root.quaternion.copy(this.restQ);
    b.root.updateMatrixWorld(true);
    if (this.present) return;
    this.present = true;
    const self = this, k = () => input.keyName('interact');
    this.pick = { prompt() { return self.present ? `[${k()}] Repair Healthity (multitool)` : null; }, interact() { self.startRepair(); }, holdTime: 0 };
    this.notePick = { prompt() { return self.present ? `[${k()}] Read the note` : null; }, interact() { self.readNote(); }, holdTime: 0 };
    const p = this.restPos;
    this.colliders.push(this.world.physics.addStaticBox(p.x, p.y, p.z, 0.12, 0.11, 0.12, { kind: 'device', device: this.pick }));
    this.note.getWorldPosition(_v);
    this.colliders.push(this.world.physics.addStaticBox(_v.x, _v.y + 0.02, _v.z, 0.09, 0.03, 0.09, { kind: 'device', device: this.notePick }));
  }
  readNote() {
    audio.play('paper', { volume: 0.7, bus: 'ui' });
    this.ob.director?.reader.open(this.noteCanvas, { width: 0.1 });
    if (!this.noteRead) { this.noteRead = true; this.ob.narrate('Empty hand, multitool out. Then [E] on the unit.', 2.4); }
  }
  startRepair() {
    const h = this.game.healthity, d = this.ob.director;
    if (!h || !this.present || (d && d.state.stage >= 4)) return;
    audio.play('multitool', { volume: 0.5, bus: 'ui' });
    h.repair.open({ crate: this, seed: 1979 + (net.selfId || '').length, onDone: () => d?.send('fixed'), abort: () => !this.present });
  }
  pose() {
    if (!this.bot) return null;
    this.bot.root.updateMatrixWorld(true);
    return { pos: this.bot.root.getWorldPosition(new THREE.Vector3()), quat: this.bot.root.getWorldQuaternion(new THREE.Quaternion()) };
  }
  // repaired (every peer): the wreck goes, the companion boots from its pose
  fixed(by, sync) {
    const from = this.present ? this.pose() : null;
    this._remove();
    const h = this.game.healthity;
    if (!h) return;
    if (sync || !from) { if (!h.active) h.activate({ quiet: true }); } else h.activate({ from, local: by === net.selfId });
  }
  _remove() {
    this.present = false;
    for (const c of this.colliders) { try { this.world.physics.removeCollider(c); } catch (e) { /* gone */ } }
    this.colliders = [];
    if (this.game.healthity?.repair?.active && this.game.healthity.repair.o?.crate === this) this.game.healthity.repair.close(false);
    if (this.bot) { this.bot.root.removeFromParent(); this.bot.root.userData.dispose?.(); this.bot = null; }
    this.noteTex?.dispose(); this.noteMat?.dispose();
  }
  update(dt) {
    if (!this.present || !this.bot) return;
    const b = this.bot, l = this.game.local;
    const near = l && !l.dead ? b.root.position.distanceTo(l.pos) : 99;
    // dying unit: sparks from the crack, the CRT stutters into static and dies again
    this.sparkT -= dt;
    if (this.sparkT <= 0) {
      this.sparkT = 1.2 + Math.random() * 2.2;
      _v.set(0.06, 0.08, 0.05).applyQuaternion(b.root.quaternion).add(b.root.position);
      this.world.fx?.sparks?.(_v, 6 + Math.floor(Math.random() * 6), null, [1, 0.8, 0.4], 1.6);
      if (near < 12) audio.play('spark', { pos: _v, volume: 0.35 });
      if (Math.random() < 0.5) this.flick = 0.18;
    }
    this.flick -= dt;
    if (this.flick > 0) { b.setPower?.(0.35); b.setFace?.(Math.random() < 0.5 ? 'static' : 'dead'); } else { b.setPower?.(0); b.setFace?.('off'); }
    b.update?.(dt);
  }
  dispose() { this._remove(); super.dispose(); }
}

export class Onboarding {
  constructor(mission) {
    this.mission = mission;
    this.world = mission.world;
    this.game = mission.game;
    this.timers = [];
    this.director = null; // set by the arrival director
    const w = this.world;
    this.crate = new SupplyCrate(w, this, SPOTS[0]);
    this.bot = new BrokenBot(w, this, SPOTS[1]);
    for (const c of [this.crate, this.bot]) w.addDevice(c);
    this.mission.level.prepStatic?.(this.crate.root, null);
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

  dispose() { for (const t of this.timers) clearTimeout(t); this.timers = []; }
}
