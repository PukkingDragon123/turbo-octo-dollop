// The HQ elevator (the small black waiting room, Sublevel B4): landing doors, a brass architrave, a
// split-flap floor indicator above the doors (shows the shift code while hosting, countdowns, LINE DEAD)
// and the call panel: a steel plate with two big mushroom buttons (HOST / JOIN, relabelled START / EXIT for
// the host once the shift is open), a little flap readout and a 32-key line keypad under a hinged cover.
// The panel is operated in first person through the lobby director (world/lobby_director.js): the camera
// zooms onto it and the clone's hand presses the buttons.
//
// Host-authoritative state: { ph: 'idle' | 'board' | 'depart' | 'exit', dur, k, riders, code, line }.
//   START: 'board' (doors + gate open, short countdown), then 'depart': every living clone in the room
//   rides (stragglers are pulled into the car in a blackout), the ride (world/elevator_ride.js) starts.
//   EXIT:  'exit': the floor drops open under everyone (lobby director: robot pit, back to the menu).
import * as THREE from 'three';
import { net } from '../net/net.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { engine } from '../core/engine.js';
import { Device } from '../game/devices.js';
import { ElevatorCar, LandingDoors, GBin, T, CAR, carMaterials, FlipBoard, glyphUV, glyphIndex, flapAtlas } from '../entities/elevator.js';
import { VLRig, vlPatch } from '../entities/vlights.js';
import { ElevatorRide, prepareRide } from './elevator_ride.js';

export const BOARD_TIME = 8;        // seconds the gate stays open after START
export const DEPART_DISPATCH = 1.6; // gate closed -> world change (host)
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PI = Math.PI;
const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
const SLOTS = [[-0.5, 0.35], [0.5, 0.35], [-0.5, -0.45], [0.5, -0.45]];

// ------------------------------------------------------------------------------------------ call panel
// Panel space: origin at the plate centre, x to the viewer's right, y up, +z out of the wall.
const PF = 0.02; // plate front face
const BTN = [{ x: -0.066, y: 0.11 }, { x: 0.066, y: 0.11 }];
const KEY_ROWS = 4, KEY_COLS = 8, KP = 0.032;
const keyPos = (i) => ({ x: ((i % KEY_COLS) - 3.5) * KP, y: -0.04 - Math.floor(i / KEY_COLS) * 0.033 });
const LABELS = { HOST: 0, JOIN: 1, START: 2, EXIT: 3, DEL: 4, ENTER: 5 };
const MODE_LABELS = { call: ['HOST', 'JOIN'], host: ['START', 'EXIT'], keypad: ['HOST', 'JOIN'] };
const MODE_CAPS = { call: [0xffa21a, 0x2cff6a], host: [0x2cff6a, 0xff2a1a], keypad: [0x553300, 0x0a3315] };

let LABEL_TEX = null;
function labelAtlas() {
  if (LABEL_TEX) return LABEL_TEX;
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#1b1a18'; x.fillRect(0, 0, 256, 256);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  Object.keys(LABELS).forEach((s, i) => {
    const gx = (i % 2) * 128, gy = Math.floor(i / 2) * 64;
    x.fillStyle = '#d8d2c0'; x.fillRect(gx + 4, gy + 6, 120, 52);
    x.fillStyle = '#141414'; x.font = `bold ${s.length > 4 ? 30 : 38}px "Arial Black", Arial`;
    x.fillText(s, gx + 64, gy + 34);
  });
  // keypad cover: hazard stripes + stencil
  for (let i = -4; i < 20; i++) { x.fillStyle = i % 2 ? '#141414' : '#d9a91c'; x.beginPath(); x.moveTo(i * 16, 192); x.lineTo(i * 16 + 16, 192); x.lineTo(i * 16 - 48, 256); x.lineTo(i * 16 - 64, 256); x.fill(); }
  x.fillStyle = '#2a2a28'; x.fillRect(10, 200, 236, 48);
  x.fillStyle = '#e8e2cf'; x.font = 'bold 22px "IBM Plex Mono", monospace'; x.fillText('LINE ACCESS', 128, 216);
  x.font = '13px "IBM Plex Mono", monospace'; x.fillText('AUTHORISED CLONES ONLY', 128, 236);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  LABEL_TEX = t;
  return t;
}
function labelUV(geo, i) {
  const gx = (i % 2) * 128, gy = Math.floor(i / 2) * 64, uv = geo.attributes.uv;
  const u0 = gx / 256, u1 = (gx + 128) / 256, vt = 1 - gy / 256, vb = 1 - (gy + 64) / 256;
  uv.setXY(0, u0, vt); uv.setXY(1, u1, vt); uv.setXY(2, u0, vb); uv.setXY(3, u1, vb); uv.needsUpdate = true;
}

export class CallPanel {
  constructor(mats) {
    this.group = new THREE.Group();
    this.mode = 'call';
    this.press = new Map(); // target key -> 0..1 press anim
    this.hover = null;
    this.coverF = 0; this.coverTarget = 0;
    const steel = new GBin(), brass = new GBin(), paint = new GBin();
    steel.span(-0.15, -0.27, 0, 0.15, 0.29, PF, 0xd8d8d8, { metric: 2 });
    for (const s of [-1, 1]) brass.span(s > 0 ? 0.146 : -0.156, -0.276, 0, s > 0 ? 0.156 : -0.146, 0.296, PF + 0.006, 0xffffff);
    for (const y of [-0.276, 0.286]) brass.span(-0.156, y, 0, 0.156, y + 0.01, PF + 0.006, 0xffffff);
    // screws
    for (const [sx, sy] of [[-0.132, 0.272], [0.132, 0.272], [-0.132, -0.252], [0.132, -0.252]]) brass.cyl(0.006, 0.006, 0.004, 0xffffff, T(sx, sy, PF + 0.002, PI / 2, 0, 0), { seg: 10 });
    // readout window, button bezels, keypad recess
    paint.span(-0.108, 0.19, PF, 0.108, 0.262, PF + 0.002, 0x0c0c0c);
    brass.span(-0.112, 0.186, PF, 0.112, 0.19, PF + 0.006, 0xffffff); brass.span(-0.112, 0.262, PF, 0.112, 0.266, PF + 0.006, 0xffffff);
    for (const b of BTN) {
      brass.add(new THREE.TorusGeometry(0.043, 0.006, 8, 28), 0xffffff, T(b.x, b.y, PF + 0.004));
      paint.cyl(0.04, 0.04, 0.003, 0x101010, T(b.x, b.y, PF + 0.0015, PI / 2, 0, 0), { seg: 24 });
    }
    paint.span(-0.142, -0.192, PF, 0.142, -0.016, PF + 0.001, 0x121212);
    // lamp hood over the plate
    steel.span(-0.11, 0.3, 0, 0.11, 0.315, 0.09, 0x9a9a9a);
    paint.span(-0.1, 0.298, 0.02, 0.1, 0.3, 0.085, 0x2a2420);
    this.meshes = [steel.mesh(mats.steel, this.group), brass.mesh(mats.brass, this.group), paint.mesh(mats.paint, this.group)];
    const lampGlow = new GBin(); lampGlow.span(-0.08, 0.296, 0.03, 0.08, 0.298, 0.075, 0xffffff);
    this.lampMat = new THREE.MeshBasicMaterial({ vertexColors: true }); this.lampMat.color.setRGB(1.6, 1.2, 0.7);
    lampGlow.mesh(this.lampMat, this.group);
    // the readout
    this.readout = new FlipBoard(5, 0.034, 0.05, { gap: 0.006, glow: 0.45, rig: mats.rig, flip: 0.04, onFlip: (n) => this.onFlip?.(n, 0.5) });
    this.readout.group.position.set(0, 0.226, PF + 0.003);
    this.group.add(this.readout.group);
    // big buttons: caps (own materials, recoloured per mode) + flip labels
    this.caps = BTN.map((b) => {
      const m = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.3, emissive: 0xffa21a, emissiveIntensity: 0.9 });
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.036, 0.022, 28), m);
      cap.rotation.x = PI / 2;
      const g = new THREE.Group(); g.position.set(b.x, b.y, PF + 0.011); g.add(cap);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.05, 24, 8, 0, PI * 2, 0, 0.75), m);
      dome.rotation.x = PI / 2; dome.position.z = 0.011 - 0.05 * Math.cos(0.75);
      g.add(dome);
      this.group.add(g);
      return { g, m, col: new THREE.Color(0xffa21a), target: new THREE.Color(0xffa21a) };
    });
    const lm = new THREE.MeshStandardMaterial({ map: labelAtlas(), roughness: 0.6, metalness: 0.2, emissive: 0xffffff, emissiveMap: labelAtlas(), emissiveIntensity: 0.12 });
    for (const m of [lm, ...this.caps.map((c) => c.m)]) vlPatch(m, mats.rig);
    this.labelMat = lm;
    this.labels = BTN.map((b, i) => {
      const pivot = new THREE.Group(); pivot.position.set(b.x, b.y - 0.066, PF + 0.004);
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.03), lm), k = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.03), lm);
      f.position.z = 0.0005; k.position.z = -0.0005; k.rotation.x = PI;
      labelUV(f.geometry, i); labelUV(k.geometry, i);
      pivot.add(f, k); this.group.add(pivot);
      return { pivot, f, k, rot: 0, target: 0, shown: MODE_LABELS.call[i] };
    });
    // keypad: dark caps with flap-atlas legends, plus DEL / ENTER
    this.keyMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.45, metalness: 0.1 });
    this.legendMat = new THREE.MeshStandardMaterial({ map: flapAtlas().tex, emissive: 0xffffff, emissiveMap: flapAtlas().tex, emissiveIntensity: 0.35, roughness: 0.5 });
    vlPatch(this.keyMat, mats.rig); vlPatch(this.legendMat, mats.rig);
    this.keys = [];
    const capGeo = new THREE.BoxGeometry(0.027, 0.027, 0.01);
    const addKey = (id, x, y, w, legend) => {
      const g = new THREE.Group(); g.position.set(x, y, PF + 0.006);
      const cap = new THREE.Mesh(w > 0.03 ? new THREE.BoxGeometry(w, 0.027, 0.01) : capGeo, this.keyMat);
      const lg = new THREE.Mesh(new THREE.PlaneGeometry(w > 0.03 ? Math.min(0.06, w - 0.008) : 0.016, w > 0.03 ? 0.016 : 0.024), legend === 'glyph' ? this.legendMat : lm);
      lg.position.z = 0.0052;
      if (legend === 'glyph') glyphUV(lg.geometry, glyphIndex(id), 0); else labelUV(lg.geometry, LABELS[id]);
      g.add(cap, lg); this.group.add(g);
      this.keys.push({ id, g, x, y, w, h: 0.027 });
    };
    for (let i = 0; i < KEY_ROWS * KEY_COLS; i++) { const p = keyPos(i); addKey(CODE_CHARS[i], p.x, p.y, 0.027, 'glyph'); }
    addKey('DEL', -0.08, -0.172, 0.09, 'label');
    addKey('ENTER', 0.064, -0.172, 0.13, 'label');
    // hinged cover over the keypad (hinge at the bottom, it drops open)
    this.cover = new THREE.Group(); this.cover.position.set(0, -0.194, PF + 0.016);
    const cv = new GBin(); cv.span(-0.144, 0, -0.003, 0.144, 0.18, 0.003, 0xc0c0c0, { metric: 2 });
    cv.mesh(mats.steel, this.cover);
    const cl = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.07), lm);
    const uv = cl.geometry.attributes.uv; uv.setXY(0, 0, 0.25); uv.setXY(1, 1, 0.25); uv.setXY(2, 0, 0); uv.setXY(3, 1, 0);
    cl.position.set(0, 0.09, 0.0035); this.cover.add(cl);
    this.group.add(this.cover);
    // hover frame
    const hm = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.4, 0.4), transparent: true, opacity: 0.9, depthWrite: false });
    this.hoverMesh = new THREE.Group();
    for (const [x, y, w, h] of [[0, 0.5, 1, 0.08], [0, -0.5, 1, 0.08], [-0.5, 0, 0.08, 1], [0.5, 0, 0.08, 1]]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), hm); m.position.set(x, y, 0); this.hoverMesh.add(m); }
    this.hoverMesh.visible = false;
    this.group.add(this.hoverMesh);
    this.hoverMat = hm;
    // warm lamp over the panel (a real light: the room is dark)
    this.lamp = new THREE.PointLight(0xffc890, 0, 1.6, 2);
    this.lamp.position.set(0, 0.3, 0.22);
    this.group.add(this.lamp);
    this.lampK = 0;
    this.setMode('call', true);
  }

  setMode(mode, snap = false) {
    this.mode = mode;
    const lbl = MODE_LABELS[mode];
    this.labels.forEach((L, i) => {
      if (L.shown === lbl[i]) return;
      L.shown = lbl[i];
      // the hidden face gets the new legend, then the plate flips over
      const hidden = Math.round(L.target / PI) % 2 === 0 ? L.k : L.f;
      labelUV(hidden.geometry, LABELS[lbl[i]]);
      L.target += PI;
      if (snap) { L.rot = L.target; L.pivot.rotation.x = L.rot; }
    });
    MODE_CAPS[mode].forEach((c, i) => this.caps[i].target.set(c));
    if (snap) this.caps.forEach((c) => { c.col.copy(c.target); c.m.emissive.copy(c.col); });
    this.coverTarget = mode === 'keypad' ? 1 : 0;
  }

  // what is under the fingertip at (x, y) panel-space
  hitTest(x, y) {
    if (this.mode === 'keypad') {
      if (this.coverF < 0.85) return null;
      for (const k of this.keys) if (Math.abs(x - k.x) < k.w / 2 + 0.003 && Math.abs(y - k.y) < k.h / 2 + 0.003) return { kind: 'key', id: k.id, x: k.x, y: k.y, w: k.w, h: k.h };
      return null;
    }
    for (let i = 0; i < 2; i++) if (Math.hypot(x - BTN[i].x, y - BTN[i].y) < 0.046) return { kind: 'btn', i, id: MODE_LABELS[this.mode][i], x: BTN[i].x, y: BTN[i].y, w: 0.094, h: 0.094 };
    return null;
  }
  keyCenter(id) { const k = this.keys.find((q) => q.id === id); return k ? { x: k.x, y: k.y } : null; }
  pressAnim(t) { this.press.set(t.kind === 'btn' ? 'b' + t.i : t.id, 1); }
  setHover(t) {
    this.hover = t;
    this.hoverMesh.visible = !!t;
    if (t) { this.hoverMesh.position.set(t.x, t.y, PF + (t.kind === 'btn' ? 0.026 : 0.013)); this.hoverMesh.scale.set(t.w + 0.008, t.h + 0.008, 1); }
  }

  update(dt, time) {
    this.readout.update(dt);
    for (const L of this.labels) {
      if (L.rot === L.target) continue;
      L.rot = Math.min(L.target, L.rot + dt * 9);
      L.pivot.rotation.x = L.rot;
    }
    for (const c of this.caps) { c.col.lerp(c.target, Math.min(1, dt * 6)); c.m.emissive.copy(c.col); c.m.emissiveIntensity = 0.75 + Math.sin(time * 3 + c.g.position.x * 40) * 0.12; }
    // presses ease back out
    for (const [k, v] of this.press) {
      const nv = Math.max(0, v - dt * 5);
      if (nv <= 0) this.press.delete(k); else this.press.set(k, nv);
    }
    const pz = (k) => { const v = this.press.get(k) || 0; return Math.sin(Math.min(1, v) * PI * 0.5) ** 0.6; };
    this.caps.forEach((c, i) => { c.g.position.z = PF + 0.011 - pz('b' + i) * 0.012; });
    for (const k of this.keys) k.g.position.z = PF + 0.006 - pz(k.id) * 0.005;
    // cover: drops open with a little bounce, snaps shut
    const d = this.coverTarget - this.coverF;
    this.coverF += Math.sign(d) * Math.min(Math.abs(d), dt * (this.coverTarget ? 3.2 : 4));
    const f = this.coverF, bounce = this.coverTarget ? Math.sin(Math.min(1, f) * PI * 3) * (1 - f) * 0.12 : 0;
    this.cover.rotation.x = (f * f * (3 - 2 * f)) * PI * 0.9 + bounce;
    this.hoverMat.opacity = 0.55 + Math.sin(time * 9) * 0.3;
    this.lamp.intensity = this.lampK * 0.32 * (0.96 + Math.random() * 0.04);
    this.lampMat.color.setRGB(0.15 + this.lampK * 0.85, 0.1 + this.lampK * 0.62, 0.06 + this.lampK * 0.34);
  }

  dispose() {
    this.readout.dispose();
    this.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    for (const c of this.caps) c.m.dispose();
    this.keyMat.dispose(); this.legendMat.dispose(); this.labelMat.dispose(); this.hoverMat.dispose(); this.lampMat.dispose();
  }
}

// ------------------------------------------------------------------------------------------ the elevator
export class HQElevator extends Device {
  // root: at the room-side face of the wall, centred on the opening; local +Z = into the room
  constructor(world, id, lobby, opts = {}) {
    super(world, id, opts);
    this.lobby = lobby;
    this.range = 2.4;
    // a host coming back from a run keeps its line open: the code stays on the board
    this.state = { ph: 'idle', dur: 0, k: 0, riders: null, code: net.mode === 'host' ? net.roomCode || '' : '', line: '' };
    this.phT = 0;
    this.gateF = 0; this.doorF = 0;
    this.car = new ElevatorCar();
    this.car.root.position.set(0, 0, -(0.21 + CAR.GATE_Z));
    this.root.add(this.car.root);
    this.rig = new VLRig();
    this.mats = carMaterials(this.rig);
    this.mats.rig = this.rig;
    this.doors = new LandingDoors(this.mats, { w: CAR.GW, h: CAR.GH, track: false });
    this.doors.group.position.set(0, 0, -0.06);
    this.root.add(this.doors.group);
    this._frame();
    // split-flap indicator above the doors
    this.board = new FlipBoard(6, 0.1, 0.15, { gap: 0.014, glow: 0.4, rig: this.rig, onFlip: (n) => this._flipSound(n, 1) });
    this.board.group.position.set(0, 2.52, 0.052);
    this.root.add(this.board.group);
    this.board.set('B4');
    this.panel = new CallPanel(this.mats);
    this.panel.group.position.set(CAR.GW / 2 + 0.46, 1.22, 0);
    this.panel.onFlip = (n, v) => this._flipSound(n, v);
    this.root.add(this.panel.group);
    this.root.traverse((o) => { if (o.isMesh && !o.userData.probeOK) o.userData.noProbe = true; });
    this.override = null; // local board message { texts: [...], t, dur, period }
    this.flipSndT = 0;
    this.lightK = 1;
  }

  _frame() {
    const steel = new GBin(), brass = new GBin(), paint = new GBin();
    const gw = CAR.GW / 2, gh = CAR.GH;
    for (const s of [-1, 1]) {
      steel.span(s > 0 ? gw : -gw - 0.14, 0, 0, s > 0 ? gw + 0.14 : -gw, gh + 0.16, 0.035, 0xe0e0e0, { metric: 1 });
      steel.span(s > 0 ? gw : -gw - 0.012, 0, -0.18, s > 0 ? gw + 0.012 : -gw, gh, 0.0, 0xb0b0b0, { metric: 2 });
      brass.span(s > 0 ? gw + 0.004 : -gw - 0.016, 0, 0.035, s > 0 ? gw + 0.016 : -gw - 0.004, gh + 0.012, 0.045, 0xffffff);
    }
    steel.span(-gw - 0.14, gh, 0, gw + 0.14, gh + 0.16, 0.035, 0xe0e0e0, { metric: 1 });
    steel.span(-gw, gh - 0.012, -0.18, gw, gh, 0, 0xb0b0b0);
    brass.span(-gw - 0.016, gh, 0.035, gw + 0.016, gh + 0.012, 0.045, 0xffffff);
    steel.span(-gw - 0.05, 0, -0.2, gw + 0.05, 0.006, 0.08, 0xc8c8c8, { metric: 3 });
    for (let i = 0; i < 4; i++) steel.span(-gw - 0.04, 0.006, -0.17 + i * 0.06, gw + 0.04, 0.009, -0.16 + i * 0.06, 0x6a6a6a);
    // flip-board housing: black box in a brass frame, two rivets, a stencilled "FLOOR"
    paint.span(-0.38, 2.4, 0, 0.38, 2.645, 0.045, 0x0a0a0a);
    for (const y of [2.395, 2.64]) brass.span(-0.39, y, 0.0, 0.39, y + 0.012, 0.05, 0xffffff);
    for (const s of [-1, 1]) brass.span(s > 0 ? 0.38 : -0.39, 2.395, 0.0, s > 0 ? 0.39 : -0.38, 2.652, 0.05, 0xffffff);
    this.frameMeshes = [steel.mesh(this.mats.steel, this.root), brass.mesh(this.mats.brass, this.root), paint.mesh(this.mats.paint, this.root)];
  }

  setRoomLights(list, ambient) {
    list.slice(0, 3).forEach((l, i) => this.rig.set(i, l.pos, l.color, l.intensity, 10));
    if (ambient) { this.amb = ambient.clone(); this.rig.ambient(ambient.r, ambient.g, ambient.b); }
  }
  // room brightness 0..1 (the lobby's flickering lights): scales the landing's virtual lights
  setLightLevel(k) {
    this.lightK = k;
    for (let i = 0; i < 3; i++) this.rig.level(i, k);
    if (this.amb) this.rig.ambient(this.amb.r * k + 0.004, this.amb.g * k + 0.004, this.amb.b * k + 0.004);
  }

  build() {
    this.root.updateMatrixWorld(true);
    const ud = { kind: 'device', device: this };
    const phys = this.world.physics;
    const ry = this.root.rotation.y;
    const box = (x0, y0, z0, x1, y1, z1, u) => {
      const c = this.root.localToWorld(_v.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
      const col = phys.addStaticBox(c.x, c.y, c.z, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, u || { kind: 'static', surface: 'metal' }, ry);
      this.colliders.push(col);
      return col;
    };
    const gw = CAR.GW / 2;
    this.doorCol = box(-gw, 0, -0.1, gw, CAR.GH, -0.02);
    const px = this.panel.group.position.x, py = this.panel.group.position.y;
    box(px - 0.16, py - 0.28, 0, px + 0.16, py + 0.3, 0.04, ud);
    this.carCols = this.car.addColliders(phys);
    this.colliders.push(...this.carCols);
    // the panel lamp as a virtual light for the plate, buttons and keys
    this.rig.set(3, this.panel.group.localToWorld(new THREE.Vector3(0, 0.25, 0.14)), 0xffc890, 0.9, 1.1);
    this.rig.level(3, 0);
  }

  get director() { return this.lobby.director; }
  prompt() {
    if (this.director?.busy) return null;
    if (this.state.ph !== 'idle') return this.state.ph === 'board' ? `Departs in ${this.secondsLeft()} s — step inside` : null;
    return `[${input.keyName('interact')}] Elevator panel`;
  }
  interact() { if (this.state.ph === 'idle') this.director?.openPanel(); }

  secondsLeft() { return this.state.ph === 'board' ? Math.max(0, Math.ceil((this.state.dur || 0) - this.phT)) : 0; }

  // a message on the big board for a while (local), e.g. LINE / DEAD alternating
  flash(texts, dur = 4, period = 0.9) { this.override = { texts: [].concat(texts), t: 0, dur, period }; }

  _flipSound(n, vol) {
    if (this.flipSndT > 0 || !audio.ready) return;
    this.flipSndT = 0.035;
    const p = this.board.group.getWorldPosition(_v);
    audio.play('flap_clack', { pos: p, volume: Math.min(0.9, 0.2 + n * 0.1) * vol });
  }

  // ------------------------------------------------------------------ host
  hostBoard() {
    if (!net.isHost || this.state.ph !== 'idle') return false;
    this._set({ ph: 'board', dur: BOARD_TIME, riders: null });
    return true;
  }
  hostExit() {
    if (!net.isHost || this.state.ph !== 'idle') return false;
    this._set({ ph: 'exit', dur: 0, riders: null });
    return true;
  }
  hostCode(code, line) { if (net.isHost) this.setState({ code: code || '', line: line || '' }); }
  _set(s) { this.setState({ ...s, k: (this.state.k || 0) + 1 }); }
  serialize() { return { ...this.state, left: Math.max(0, (this.state.dur || 0) - this.phT) }; }

  _clones() {
    const g = this.world.game, out = [];
    for (const r of g.roster.values()) {
      if (r.id === net.selfId) { if (g.local.world && !g.local.dead) out.push({ id: r.id, pos: g.local.pos.clone(), yaw: g.local.yaw }); continue; }
      if (r.dead || !r.pose?.p) continue;
      out.push({ id: r.id, pos: new THREE.Vector3().fromArray(r.pose.p), yaw: r.pose.y || 0 });
    }
    return out;
  }
  _carYaw() { this.car.root.getWorldQuaternion(_q); return new THREE.Euler().setFromQuaternion(_q, 'YXZ').y; }
  inCar(pos, margin = 0) { return this.car.containsLocal(this.car.root.worldToLocal(_v.copy(pos)), margin); }

  _hostUpdate() {
    const ph = this.state.ph;
    if (ph === 'board' && this.phT >= this.state.dur) {
      // everyone in the room goes: the ones inside keep their spot, stragglers get a free one
      const carYaw = this._carYaw(), riders = [];
      const used = [];
      const clones = this._clones();
      for (const c of clones) {
        if (!this.inCar(c.pos, 0.05)) continue;
        const l = this.car.root.worldToLocal(_v.copy(c.pos));
        used.push([l.x, l.z]);
        riders.push({ id: c.id, x: +l.x.toFixed(3), z: +l.z.toFixed(3), yaw: +(c.yaw - carYaw).toFixed(3), in: 1 });
      }
      for (const c of clones) {
        if (riders.some((r) => r.id === c.id)) continue;
        const s = SLOTS.map((p) => ({ p, d: Math.min(9, ...used.map((u) => Math.hypot(u[0] - p[0], u[1] - p[1]))) })).sort((a, b) => b.d - a.d)[0].p;
        used.push(s);
        riders.push({ id: c.id, x: s[0], z: s[1], yaw: 0, in: 0 });
      }
      const carry = [];
      const cq = this.car.root.getWorldQuaternion(new THREE.Quaternion()).invert();
      for (const p of this.world.props.props.values()) {
        if (p.dead || p.type === 'fish' || !this.inCar(p.root.position, -0.05)) continue;
        const l = this.car.root.worldToLocal(p.root.position.clone());
        const q = cq.clone().multiply(p.root.quaternion);
        carry.push({ type: p.type, state: p.state, q: p.root.quaternion.toArray(), rp: [l.x, Math.max(0.05, l.y), l.z].map((v) => +v.toFixed(3)), rq: q.toArray().map((v) => +v.toFixed(4)) });
      }
      this.departCarry = carry.slice(0, 24);
      this._set({ ph: 'depart', dur: DEPART_DISPATCH, riders });
    } else if (ph === 'depart' && this.phT >= this.state.dur && !this.dispatched) {
      this.dispatched = true;
      const g = this.world.game, carry = this.departCarry || [], riders = this.state.riders || [];
      setTimeout(() => { if (g.world === this.world) g.hostDispatch(carry, undefined, { elevator: { riders } }); }, 0);
    }
  }

  // ------------------------------------------------------------------ every peer
  onState(s, fullSync) {
    this.phT = fullSync && s.left !== undefined ? Math.max(0, (s.dur || 0) - s.left) : 0;
    this.lastTick = -1;
    const head = this.root.localToWorld(_v.set(0, 2.2, 0.3)).clone();
    const g = this.world.game;
    if (s.ph === 'board') {
      if (!fullSync) {
        audio.play('elevator_ding', { pos: head, volume: 0.9 });
        audio.play('elev_doors', { pos: head, volume: 0.9, delay: 0.15 });
        audio.play('elev_gate', { pos: head, volume: 1, delay: 0.75 });
        this.director?.onBoard?.();
      }
      prepareRide();
    } else if (s.ph === 'depart') {
      if (fullSync) return;
      audio.play('elev_gate', { pos: head, volume: 1.1 });
      audio.play('elev_doors', { pos: head, volume: 0.9, delay: 0.4 });
      const me = (s.riders || []).find((r) => r.id === net.selfId);
      if (me && g.local.world && !g.local.dead) {
        if (!this.inCar(g.local.pos, 0.05)) {
          // the lights cut and when they stutter back you are in the car
          const p = this.car.root.localToWorld(new THREE.Vector3(me.x, 0.03, me.z));
          g.local.teleport(p, this._carYaw() + PI + (me.x > 0 ? -0.25 : 0.25));
          engine.post.params.uFade.value = 1;
          audio.play('lights_out', { volume: 0.7 });
        }
        this.director?.release?.();
        g.ride?.dispose?.();
        g.ride = new ElevatorRide(g, { riders: s.riders, me, car: this.car, elevator: this });
      }
    } else if (s.ph === 'exit') {
      if (!fullSync) this.director?.exitFall();
    }
  }

  update(dt) {
    if (this.disposed) return;
    dt = Math.min(dt, 0.1);
    this.phT += dt;
    this.flipSndT -= dt;
    const ph = this.state.ph, t = this.phT;
    if (net.isHost) this._hostUpdate();
    let door = 0, gate = 0;
    if (ph === 'board') {
      door = Math.max(this.doorF, clamp01((t - 0.15) / 0.75));
      gate = Math.max(this.gateF, clamp01((t - 0.75) / 0.55));
    } else if (ph === 'depart') {
      gate = Math.min(this.gateF, 1 - clamp01(t / 0.3));
      door = Math.min(this.doorF, 1 - clamp01((t - 0.3) / 0.5));
    } else {
      gate = Math.max(0, this.gateF - dt * 2.4);
      door = this.gateF < 0.05 ? Math.max(0, this.doorF - dt * 1.5) : this.doorF;
    }
    this.gateF = gate; this.doorF = door;
    this.car.gate.set(gate);
    this.doors.set(door);
    this.doorCol?.setEnabled(door < 0.7);
    this.car.gateCollider?.setEnabled(gate < 0.6);
    // the big board
    let txt;
    const o = this.override;
    if (o) {
      o.t += dt;
      txt = o.texts[Math.floor(o.t / o.period) % o.texts.length];
      if (o.t > o.dur) this.override = null;
    } else if (ph === 'board') {
      const left = this.secondsLeft();
      txt = `GO ${String(left).padStart(2, '0')}`;
      if (left !== this.lastTick) {
        this.lastTick = left;
        audio.play(left <= 3 ? 'elevator_ding' : 'countdown_tick', { pos: this.root.localToWorld(_v.set(0, 2.4, 0.2)), volume: left <= 3 ? 0.35 : 0.7, pitch: left <= 3 ? 1.5 : 1 });
      }
    } else if (ph === 'depart') txt = 'DOWN';
    else if (ph === 'exit') txt = Math.floor(t / 2.6) % 2 ? 'BURN' : 'RECYCL';
    else if (this.state.line === 'dead') txt = Math.floor(t / 2.8) % 2 ? 'DEAD' : 'LINE';
    else if (this.state.code) txt = this.state.code;
    else txt = 'B4';
    this.board.set(txt);
    this.board.update(dt);
    this.panel.update(dt, engine.time);
    this.rig.level(3, this.panel.lampK);
    this.car.dial.setLed(ph === 'board' ? String(this.secondsLeft()).padStart(2, '0') : 'B4', ph === 'board' && this.secondsLeft() <= 3 ? '#ff4a2a' : '#ffae3a');
    this.car.update(dt);
    this.car.setLight((ph === 'board' ? 0.95 : 0.6) * (0.94 + Math.sin(engine.time * 31) * 0.01 + (Math.random() < 0.004 ? -0.4 : 0)));
  }

  dispose() {
    this.disposed = true;
    super.dispose();
    this.car.dispose();
    this.board.dispose();
    this.panel.dispose();
    for (const [k, m] of Object.entries(this.mats)) if (k !== 'rig') m.dispose();
  }
}
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
