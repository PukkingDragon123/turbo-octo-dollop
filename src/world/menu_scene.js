// R.O.O.M. — main-menu backdrop: an isolated 3D set rendered through the post stack with engine.setView().
//
// A dingy 1990s R.O.O.M. staff break room after hours: a laminate table under a flickering fluorescent panel,
// plastic chairs, coffee, cake and a slowly bobbing balloon, glowing vending machines, a wall clock stuck at
// 4:59, posters, drop ceiling, darkness beyond. Five clones sit at the table and laugh — out of sync,
// stuttering, heads snapping like stop motion; now and then one stops and stares into the camera, and every
// so often all of them fall silent at once. One of them is YOU (profile cosmetics).
//
// Hover / tap your clone: it lights up with an outline and a pixel "CUSTOMIZE" tag. Click it and the
// AUTO-OUTFITTER MK.II (entities/wardrobe.js) in the corner bangs its doors open, robotic arms grab you off
// your chair and drag you inside; the doors slam and you hang in a harness in the outfitting bay while arms
// swap parts with sparks (panel: ui/wardrobe.js). DONE: the arms push you back out to your seat.
//
// API (used by main.js): new MenuScene(game); update(dt) while the menu shows; deactivate() when leaving it.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { engine } from '../core/engine.js';
import { audio } from '../audio/audio.js';
import { profile } from '../core/profile.js';
import * as AV from '../entities/avatar.js';
import { buildModel } from '../entities/catalog.js';
import { WardrobeBooth, WardrobeChamber, Sparks, Batch, canvasTex, grime, wardrobeMats, cyl } from '../entities/wardrobe.js';
import { WardrobeUI } from '../ui/wardrobe.js';

const { Avatar, COSMETICS, randomCosmetics } = AV;
const PI = Math.PI, TAU = PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const easeIO = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const rnd = (a, b) => a + (b - a) * Math.random();
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();

// the 'laugh' expression arrives with the robot clones; until then 'happy' + talking + our own head jitter
const LAUGH = (() => {
  try { return Object.values(AV).some((f) => typeof f === 'function' && /['"`]laugh['"`]|\blaugh\s*:/.test(Function.prototype.toString.call(f))); } catch (e) { return false; }
})();

// seats around the table: x, z, yaw (avatars face -Z; yaw PI faces the camera)
const SEATS = [
  { x: 0.46, z: -0.8, yaw: PI, you: true },
  { x: -0.5, z: -0.8, yaw: PI },
  { x: -1.22, z: 0.02, yaw: -PI / 2 + 0.12 },
  { x: 1.22, z: -0.04, yaw: PI / 2 - 0.1 },
  { x: -0.12, z: 0.84, yaw: 0.05 },
];
const CHAIR_COLORS = [0xc8642a, 0x2f6f7a, 0xb8a88a, 0x8a2f3a, 0x3d5a8a];
const SEAT_TOP = 0.468;
const CHAMBER_POS = new THREE.Vector3(40, 0, 0);

// ------------------------------------------------------------------ procedural textures for the room
function roomTextures() {
  const floor = canvasTex(512, 512, (g, w, h) => {
    const n = 4, s = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.fillStyle = (i + j) % 2 ? '#8f8a78' : '#a9a28c';
      g.fillRect(i * s, j * s, s, s);
      for (let k = 0; k < 160; k++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '40,34,26' : '220,214,196'},${0.08 + Math.random() * 0.12})`; g.fillRect(i * s + Math.random() * s, j * s + Math.random() * s, 2 + Math.random() * 3, 2); }
      g.strokeStyle = 'rgba(30,24,16,0.45)'; g.lineWidth = 2; g.strokeRect(i * s + 1, j * s + 1, s - 2, s - 2);
    }
    grime(g, w, h, 0.7, 2);
  }, { repeat: [7 / 1.2, 7.6 / 1.2] });
  const wall = canvasTex(512, 512, (g, w, h) => {
    const rail = h * (1 - 0.92 / 2.75);
    g.fillStyle = '#b9b097'; g.fillRect(0, 0, w, rail);
    g.fillStyle = '#6c6853'; g.fillRect(0, rail, w, h - rail);
    for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(60,50,30,${Math.random() * 0.05})`; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
    const gr = g.createLinearGradient(0, 0, 0, rail);
    gr.addColorStop(0, 'rgba(60,46,20,0.28)'); gr.addColorStop(0.25, 'rgba(60,46,20,0)'); gr.addColorStop(1, 'rgba(60,46,20,0.12)');
    g.fillStyle = gr; g.fillRect(0, 0, w, rail);
    grime(g, w, h, 0.9, 4);
  }, { repeat: [3, 1] });
  const ceil = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#c9c3ae'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 2200; k++) { g.fillStyle = `rgba(70,60,40,${Math.random() * 0.25})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1); }
    g.fillStyle = '#7b7564';
    for (const p of [0, w / 2]) { g.fillRect(p, 0, 4, h); g.fillRect(0, p, w, 4); }
    const st = g.createRadialGradient(w * 0.7, h * 0.3, 2, w * 0.7, h * 0.3, 40);
    st.addColorStop(0, 'rgba(120,80,20,0.35)'); st.addColorStop(0.7, 'rgba(120,80,20,0.18)'); st.addColorStop(1, 'rgba(120,80,20,0)');
    g.fillStyle = st; g.fillRect(0, 0, w, h);
  }, { repeat: [7 / 1.2, 7.6 / 1.2] });
  const laminate = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#cdb78f'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) { g.fillStyle = `rgba(120,86,40,${0.05 + 0.08 * Math.abs(Math.sin(y * 0.11 + Math.sin(y * 0.031) * 3))})`; g.fillRect(0, y, w, 2); }
    for (let k = 0; k < 60; k++) { g.strokeStyle = `rgba(90,60,30,${0.05 + Math.random() * 0.08})`; g.beginPath(); const y = Math.random() * h; g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + rnd(-10, 10), w * 0.6, y + rnd(-10, 10), w, y + rnd(-6, 6)); g.stroke(); }
    // coffee rings
    for (let k = 0; k < 5; k++) { g.strokeStyle = 'rgba(90,50,20,0.25)'; g.lineWidth = 3; g.beginPath(); g.arc(rnd(40, w - 40), rnd(30, h - 30), rnd(14, 22), 0, TAU); g.stroke(); }
    grime(g, w, h, 0.4, 7);
  });
  return { floor, wall, ceil, laminate };
}

// ------------------------------------------------------------------ the scene
export class MenuScene {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.scene.name = 'MenuScene';
    this.scene.background = new THREE.Color(0x020202);
    this.scene.fog = new THREE.FogExp2(0x040302, 0.075);
    this.scene.environment = engine.defaultEnv;
    this.scene.environmentIntensity = 0.22;
    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.05, 90);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.t = 0;
    this.active = false;
    this.mode = 'menu';         // 'menu' | 'grab' | 'inside' | 'eject'
    this.seq = null;             // { name, t }
    this.hover = false;
    this.pointer = { x: 0, y: 0, over: false, has: false };
    this.flashV = 0;
    this.glitch = 0;
    this.fade = 0;
    this.tex = roomTextures();
    this.ui = new WardrobeUI({
      onPick: (cat, id, kind) => (kind === 'tab' ? this._sfx('ui_blip', { volume: 0.3, bus: 'ui' }) : this._request(cat, id)),
      onDone: () => this._done(),
      onRandom: () => this._randomize(),
      onLocked: (cat, o) => this._denied(cat, o),
    });
    this._buildRoom();
    this._buildFurniture();
    this._buildLights();
    this._buildWardrobe();
    this._buildClones();
    this._initCamera();
    this._bindInput();
    this._audio = { on: false, loops: [] };
  }

  _add(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.receiveShadow = true;
    this.scene.add(m);
    return m;
  }

  // ================================================================== build: room shell
  _buildRoom() {
    const T = this.tex, M = wardrobeMats();
    const b = new Batch();
    const X0 = -3.6, X1 = 3.4, Z0 = -3.4, Z1 = 4.2, H = 2.75;
    const floorMat = new THREE.MeshStandardMaterial({ map: T.floor, roughness: 0.42, metalness: 0.0 });
    const wallMat = new THREE.MeshStandardMaterial({ map: T.wall, roughness: 0.88 });
    const ceilMat = new THREE.MeshStandardMaterial({ map: T.ceil, roughness: 0.95 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x3b3328, roughness: 0.7 });
    const rail = new THREE.MeshStandardMaterial({ color: 0x8a7e62, roughness: 0.6 });
    const W = X1 - X0, D = Z1 - Z0;
    b.add(new THREE.PlaneGeometry(W, D).rotateX(-PI / 2), floorMat, new THREE.Matrix4().makeTranslation((X0 + X1) / 2, 0, (Z0 + Z1) / 2));
    b.add(new THREE.PlaneGeometry(W, D).rotateX(PI / 2), ceilMat, new THREE.Matrix4().makeTranslation((X0 + X1) / 2, H, (Z0 + Z1) / 2));
    const wall = (len, rep) => { const g = new THREE.PlaneGeometry(len, H); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * rep); return g; };
    b.add(wall(W, W / 2.4), wallMat, new THREE.Matrix4().makeTranslation((X0 + X1) / 2, H / 2, Z0));
    b.add(wall(D, D / 2.4).rotateY(PI / 2), wallMat, new THREE.Matrix4().makeTranslation(X0, H / 2, (Z0 + Z1) / 2));
    b.add(wall(D, D / 2.4).rotateY(-PI / 2), wallMat, new THREE.Matrix4().makeTranslation(X1, H / 2, (Z0 + Z1) / 2));
    // cove base + chair rail
    b.box(W, 0.1, 0.02, trim, (X0 + X1) / 2, 0.05, Z0 + 0.01);
    b.box(0.02, 0.1, D, trim, X0 + 0.01, 0.05, (Z0 + Z1) / 2);
    b.box(0.02, 0.1, D, trim, X1 - 0.01, 0.05, (Z0 + Z1) / 2);
    b.box(W, 0.035, 0.025, rail, (X0 + X1) / 2, 0.92, Z0 + 0.012);
    b.box(0.025, 0.035, D, rail, X0 + 0.012, 0.92, (Z0 + Z1) / 2);
    b.box(0.025, 0.035, D, rail, X1 - 0.012, 0.92, (Z0 + Z1) / 2);
    // counter with base cabinets along the back wall (left of the booth)
    const cab = new THREE.MeshStandardMaterial({ color: 0x8c7a5c, roughness: 0.7 });
    const top = new THREE.MeshStandardMaterial({ map: T.laminate, color: 0xd8d0bc, roughness: 0.45 });
    b.box(2.1, 0.86, 0.6, cab, -0.75, 0.43, Z0 + 0.3);
    b.box(2.14, 0.04, 0.64, top, -0.75, 0.88, Z0 + 0.32, 0, 0, 0, 0.008);
    for (let i = 0; i < 4; i++) {
      b.box(0.5, 0.7, 0.012, rail, -1.53 + i * 0.52, 0.45, Z0 + 0.606, 0, 0, 0, 0.004);
      b.add(cyl(0.008, 0.1, 'y', 8), M.chrome, new THREE.Matrix4().makeTranslation(-1.33 + i * 0.52, 0.66, Z0 + 0.625));
    }
    b.box(2.1, 0.08, 0.56, trim, -0.75, 0.04, Z0 + 0.27);
    // cork board with memos
    const cork = canvasTex(256, 160, (g, w, h) => {
      g.fillStyle = '#9a7448'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '60,40,20' : '200,160,110'},0.3)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      const notes = [['#f2e98a', 'SMILE'], ['#efe6cf', 'SHIFT ROTA'], ['#f5b8c8', 'HAPPY B-DAY'], ['#bfe0f0', 'NO LOITERING'], ['#efe6cf', 'MEMO 77-B']];
      notes.forEach(([c, t], i) => {
        g.save(); g.translate(30 + (i % 3) * 78, 30 + Math.floor(i / 3) * 70); g.rotate(rnd(-0.15, 0.15));
        g.fillStyle = c; g.fillRect(-26, -22, 56, 48); g.fillStyle = '#2a2420'; g.font = '13px "IBM Plex Mono", monospace'; g.fillText(t, -22, -4);
        for (let l = 0; l < 3; l++) g.fillRect(-22, 6 + l * 6, 40 - l * 7, 2);
        g.fillStyle = '#c8301e'; g.beginPath(); g.arc(2, -18, 3, 0, TAU); g.fill(); g.restore();
      });
    });
    const corkMat = new THREE.MeshStandardMaterial({ map: cork, roughness: 0.9 });
    b.box(0.9, 0.56, 0.02, trim, X0 + 0.012, 1.55, -1.95 + 0.0, 0, PI / 2, 0);
    this._add(new THREE.PlaneGeometry(0.85, 0.52), corkMat, X0 + 0.03, 1.55, -1.95, 0, PI / 2, 0);
    // door on the left wall, a wired-glass window onto a dark corridor
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x5d5446, roughness: 0.6, metalness: 0.2 });
    b.box(0.06, 2.12, 1.02, trim, X0 + 0.03, 1.06, 1.6);
    b.box(0.045, 2.04, 0.9, doorMat, X0 + 0.035, 1.02, 1.6);
    b.add(cyl(0.035, 0.08, 'x', 12), M.chrome, new THREE.Matrix4().makeTranslation(X0 + 0.09, 1.0, 1.25));
    const winMat = new THREE.MeshBasicMaterial({ map: canvasTex(64, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#2c3a20'); gr.addColorStop(1, '#0a0d06'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(160,170,140,0.25)'; g.lineWidth = 1; for (let i = -h; i < w + h; i += 10) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke(); g.beginPath(); g.moveTo(i + h, 0); g.lineTo(i, h); g.stroke(); }
    }), color: new THREE.Color(0.9, 1.0, 0.75) });
    this._add(new THREE.PlaneGeometry(0.22, 0.5), winMat, X0 + 0.06, 1.45, 1.6, 0, PI / 2, 0);
    b.build(this.scene);
    // troffers: the one over the table flickers, one is dead, one buzzes faintly near the door
    this.troffers = [];
    const tg = new RoundedBoxGeometry(1.24, 0.07, 0.64, 2, 0.01);
    const frame = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.5, metalness: 0.4 });
    for (const [x, z, on] of [[0.1, -0.12, 1], [-2.2, -1.9, 0], [1.5, 1.9, 0.35], [-1.3, 2.2, 0]]) {
      const g = new THREE.Group();
      g.position.set(x, H - 0.035, z);
      this.scene.add(g);
      const fr = new THREE.Mesh(tg, frame);
      g.add(fr);
      const lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.08, 0.08, 0.07) });
      const lens = new THREE.Mesh(new THREE.PlaneGeometry(1.14, 0.56).rotateX(PI / 2), lensMat);
      lens.position.y = -0.037;
      g.add(lens);
      for (let k = 0; k < 6; k++) { const l = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.004, 0.006), frame); l.position.set(0, -0.039, -0.26 + k * 0.104); g.add(l); }
      this.troffers.push({ g, lensMat, on, level: on });
    }
    this.tableTroffer = this.troffers[0];
  }

  // ================================================================== build: furniture & props
  _model(type, opts, x, y, z, ry = 0, scale = 1) {
    try {
      const m = buildModel(type, { seed: 1, ...(opts || {}) });
      const o = m.object;
      o.position.set(x, y + (m.kind === 'DEVICES' ? 0 : (m.halfHeight ?? 0)) * scale, z);
      o.rotation.y = ry;
      if (scale !== 1) o.scale.setScalar(scale);
      this.scene.add(o);
      return m;
    } catch (e) {
      console.warn('[menu] model', type, e);
      return null;
    }
  }
  _buildFurniture() {
    const T = this.tex, M = wardrobeMats();
    // laminate table on chrome tube legs
    const table = new Batch();
    const top = new THREE.MeshStandardMaterial({ map: T.laminate, roughness: 0.38, metalness: 0.0 });
    const edge = new THREE.MeshStandardMaterial({ color: 0x6b5a40, roughness: 0.5 });
    table.box(1.72, 0.03, 0.97, top, 0, 0.745, 0, 0, 0, 0, 0.008);
    table.box(1.74, 0.026, 0.99, edge, 0, 0.722, 0, 0, 0, 0, 0.01);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) table.add(cyl(0.022, 0.72, 'y', 12), M.chrome, new THREE.Matrix4().makeTranslation(sx * 0.76, 0.36, sz * 0.4));
    for (const sz of [-1, 1]) table.add(cyl(0.012, 1.52, 'x', 8), M.chrome, new THREE.Matrix4().makeTranslation(0, 0.12, sz * 0.4));
    table.build(this.scene);
    // molded plastic chairs
    this.chairs = SEATS.map((s, i) => {
      const g = new THREE.Group();
      g.position.set(s.x, 0, s.z);
      g.rotation.y = s.yaw;
      this.scene.add(g);
      const pm = new THREE.MeshStandardMaterial({ color: CHAIR_COLORS[i % CHAIR_COLORS.length], roughness: 0.48, metalness: 0.0 });
      const c = new Batch();
      c.box(0.44, 0.03, 0.42, pm, 0, 0.452, -0.01, 0, 0, 0, 0.012);
      c.box(0.42, 0.28, 0.025, pm, 0, 0.76, 0.215, -0.12, 0, 0, 0.012);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) c.add(cyl(0.011, 0.46, 'y', 8), M.chrome, new THREE.Matrix4().makeRotationX(sz * 0.06).setPosition(sx * 0.19, 0.225, sz * 0.18));
        c.add(cyl(0.01, 0.36, 'y', 8), M.chrome, new THREE.Matrix4().makeRotationX(-0.12).setPosition(sx * 0.17, 0.62, 0.2));
      }
      c.build(g);
      return g;
    });
    // table dressing: cake, mugs, plates, a fallen party hat, a balloon on a string
    this._model('cake', null, -0.05, 0.76, -0.06, 0.4);
    const mugPos = [[0.45, -0.3, 0.2], [-0.5, -0.28, 2.4], [-0.78, 0.12, 1.2], [0.72, 0.05, 4.1], [-0.1, 0.34, 0.9], [0.18, 0.3, 2.9]];
    for (const [x, z, r] of mugPos) this._model('mug', null, x, 0.76, z, r);
    const plateMat = new THREE.MeshStandardMaterial({ color: 0xf0ece2, roughness: 0.7 });
    const pb = new Batch();
    for (const [x, z] of [[0.35, -0.22], [-0.42, -0.2], [-0.62, 0.05], [0.62, -0.02], [-0.12, 0.26]]) pb.add(cyl(0.11, 0.008, 'y', 20, 0.095), plateMat, new THREE.Matrix4().makeTranslation(x, 0.764, z));
    pb.build(this.scene);
    this._model('party_hat', null, 0.28, 0.76, 0.18, 1.2);
    this.balloon = this._model('balloon', null, -0.9, 1.75, -0.55, 0);
    if (this.balloon) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 1, 4).translate(0, -0.5, 0), new THREE.MeshBasicMaterial({ color: 0xdddddd }));
      s.scale.y = 1.0;
      this.balloonString = s;
      this.scene.add(s);
    }
    // back wall: counter appliances, clock, poster, vending machines, water cooler
    this._model('coffee_machine', null, -1.25, 0.9, -3.08, 0);
    this._model('microwave', null, -0.35, 0.9, -3.12, 0);
    this._model('mug', null, -0.85, 0.9, -2.95, 1.0);
    this._model('mug', null, -0.95, 0.9, -3.0, 2.0);
    this.clock = this._model('wall_clock', null, -0.75, 2.02, -3.395, 0);
    this._model('poster', { text: 'LAUGHTER\nis mandatory. Smile until it hurts.' }, 0.32, 1.62, -3.395, 0);
    this._model('poster', { text: 'TEAMWORK\nAlone you are disposable.' }, -3.595, 1.55, -0.7, PI / 2);
    this.vending = this._model('vending_drink', null, -2.72, 0, -3.0, 0);
    this._model('vending_snack', null, -3.18, 0, -1.95 + 0.85, PI / 2);
    this._model('water_cooler', null, -3.25, 0, 0.55, PI / 2);
    this._model('trash_can', null, -1.95, 0, -2.75, 0);
    this._model('wet_floor_sign', null, -2.4, 0, 1.2, 0.6);
    this._model('exit_sign', null, -3.595, 2.32, 1.6, PI / 2);
    this._model('employee_of_month', null, 3.395, 1.6, 0.9, -PI / 2);
  }

  // ================================================================== build: lights
  _buildLights() {
    const S = this.scene;
    this.hemi = new THREE.HemisphereLight(0x8c8472, 0x1d1610, 0.32);
    S.add(this.hemi);
    const key = (this.key = new THREE.SpotLight(0xfff0d2, 13, 7.5, 1.05, 0.75, 2));
    key.position.set(0.1, 2.42, -0.12);
    key.target.position.set(0.1, 0.4, -0.15);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.4; key.shadow.camera.far = 6;
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.025;
    S.add(key, key.target);
    this.keyBase = 13;
    this.vendLight = new THREE.PointLight(0xc8e6ff, 2.2, 5.5, 1);
    this.vendLight.position.set(-2.6, 1.25, -2.35);
    S.add(this.vendLight);
    this.redLight = new THREE.PointLight(0xff2a12, 1.0, 3.2, 1);
    S.add(this.redLight);
    this.accent = new THREE.PointLight(0xffa040, 0, 2.2, 1);
    S.add(this.accent);
  }

  // ================================================================== build: wardrobe booth + chamber
  _buildWardrobe() {
    const you = SEATS[0];
    // the booth stands in the back-right corner, its doors facing YOUR chair
    const dir = new THREE.Vector2(0.62, -0.78).normalize();
    this.booth = new WardrobeBooth();
    const bp = new THREE.Vector3(you.x + dir.x * 1.86, 0, you.z + dir.y * 1.86);
    this.booth.root.position.copy(bp);
    this.booth.root.rotation.y = Math.atan2(-dir.x, -dir.y);
    this.scene.add(this.booth.root);
    this.booth.root.updateMatrixWorld(true);
    this.booth.onDoorHit = (kind, s) => this._doorHit(kind, s);
    this.redLight.position.copy(this.booth.root.localToWorld(new THREE.Vector3(0, 2.0, -0.52)));
    // outfitting bay, far away in the same scene
    this.chamber = new WardrobeChamber();
    this.chamber.root.position.copy(CHAMBER_POS);
    this.scene.add(this.chamber.root);
    this.chamber.root.updateMatrixWorld(true);
    this.harnessPivot = new THREE.Group();
    this.harnessPivot.position.set(0, 1.42, 0);
    this.chamber.harness.add(this.harnessPivot);
    this.sparks = new Sparks(220);
    this.scene.add(this.sparks.points);
    // scanner ring (suit swaps)
    this.scanRing = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.012, 6, 48).rotateX(PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 3.0, 1.2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scanRing.visible = false;
    this.chamber.root.add(this.scanRing);
  }

  // ================================================================== build: clones
  _buildClones() {
    this.clones = [];
    const seed = (Math.random() * 1e6) | 0;
    SEATS.forEach((s, i) => {
      const cos = s.you ? { ...(this.game.local?.cosmetics || profile.data.cosmetics || {}) } : randomCosmetics(seed + i * 7919, true);
      let av;
      try { av = new Avatar(cos); } catch (e) { console.warn('[menu] avatar', e); return; }
      av.setName?.(s.you ? profile.name : `Clone-${(seed + i * 131) % 9000 + 1000}`);
      const c = {
        av, seat: s, you: !!s.you, i,
        root: av.root,
        // laugh rhythm & character
        rate: rnd(5.2, 7.8), burst: false, burstT: rnd(0.2, 1.5), voice: rnd(0.82, 1.22),
        head: new THREE.Vector3(), headT: new THREE.Vector3(), snapT: 0, fps: rnd(7, 12), tick: 0,
        stareT: 0, mode: 'laugh', look: null, lookW: 0, expr: 'laugh', laughH: null,
        pounder: i === 3, seatY: 0,
      };
      av.root.rotation.order = 'YXZ';
      this.scene.add(av.root);
      // sit pose, measure how far the body reaches below the root so the clone sits ON the chair
      av.root.position.set(0, 0, 0); av.root.rotation.set(0, 0, 0);
      c.minY = 0; c.height = 1.1; c.headY = 0.95; c.chairSit = false;
      try {
        av.update(0, { emote: 'sit', grounded: true, speed: 0, table: 0.76 });
        av.root.updateMatrixWorld(true);
        const b = av.bones || {};
        const pel = b.pelvis ? b.pelvis.getWorldPosition(new THREE.Vector3()).y : 0;
        if (b.head) c.headY = b.head.getWorldPosition(new THREE.Vector3()).y + 0.12;
        // the android rig sits on a 0.45 m chair seat above its root; the old sack doll sat on the floor
        c.chairSit = pel > 0.3;
        if (c.chairSit) { c.minY = pel - 0.12; c.height = c.headY + 0.25 - c.minY; } else {
          const box = new THREE.Box3().setFromObject(av.root, true);
          c.minY = Number.isFinite(box.min.y) ? box.min.y : 0;
          c.height = Number.isFinite(box.max.y) ? box.max.y - box.min.y : 1;
        }
      } catch (e) { console.warn('[menu] clone pose', e); }
      c.seatY = c.chairSit ? SEAT_TOP - 0.45 : SEAT_TOP - c.minY - 0.005;
      this._placeAtSeat(c);
      this.clones.push(c);
      if (c.you) this.you = c;
    });
    if (!this.you) return;
    // picking proxy (invisible; raycasts ignore visibility)
    const h = clamp(this.you.height || 1, 0.6, 2.2);
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.6, h, 0.55), new THREE.MeshBasicMaterial());
    proxy.visible = false;
    proxy.position.set(0, this.you.minY + h * 0.5, 0.02);
    this.you.root.add(proxy);
    this.proxy = proxy;
    this.raycaster = new THREE.Raycaster();
    this.outlineW = { value: 0.0 };
    this._outline = null;
  }
  _placeAtSeat(c) {
    const s = c.seat;
    c.root.position.set(s.x - Math.sin(s.yaw) * 0.02, c.seatY, s.z - Math.cos(s.yaw) * 0.02);
    c.root.rotation.set(0, s.yaw, 0);
  }

  // outline hull for the hover highlight: back faces of each skinned mesh pushed out along the normals
  _ensureOutline() {
    const av = this.you?.av;
    if (!av) return;
    if (this._outline && this._outline.src === av.meshes) return;
    if (this._outline) for (const m of this._outline.list) m.removeFromParent();
    if (!this._outlineMat) {
      const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.0, 1.05, 0.22), side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false, fog: false });
      const W = this.outlineW;
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uOW = W;
        sh.vertexShader = 'uniform float uOW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\ttransformed += normalize( normal ) * uOW;');
      };
      m.customProgramCacheKey = () => 'menu-outline';
      this._outlineMat = m;
    }
    const list = [];
    const src = [];
    av.root.traverse((o) => { if (o.isSkinnedMesh && o.visible && !o.material?.transparent && !/decal|glass|face/.test(o.name || '')) src.push(o); });
    for (const o of src) {
      const h = new THREE.SkinnedMesh(o.geometry, this._outlineMat);
      h.bind(o.skeleton, o.bindMatrix);
      h.bindMode = o.bindMode;
      h.frustumCulled = false;
      h.castShadow = false; h.receiveShadow = false;
      h.renderOrder = 3;
      o.parent.add(h);
      list.push(h);
    }
    this._outline = { src: av.meshes, list };
  }

  // ================================================================== camera rig & framing
  _initCamera() {
    this.shots = {
      table: { p: new THREE.Vector3(0.45, 1.72, 3.5), l: new THREE.Vector3(0.3, 1.02, -0.62), hw: 1.75, hh: 0.92 },
      booth: null, inside: null,
    };
    const bw = this.booth.root;
    const mid = new THREE.Vector3(SEATS[0].x, 1.15, SEATS[0].z).lerp(bw.localToWorld(new THREE.Vector3(0, 1.2, 0.4)), 0.5);
    this.shots.booth = { p: new THREE.Vector3(-1.05, 1.72, 1.85), l: mid, hw: 1.45, hh: 1.25 };
    this.shots.inside = { p: CHAMBER_POS.clone().add(new THREE.Vector3(-0.45, 1.5, 2.75)), l: CHAMBER_POS.clone().add(new THREE.Vector3(0, 1.42, 0)), hw: 0.85, hh: 1.18 };
    this.rig = { from: null, to: 'table', t: 1, dur: 1, p: new THREE.Vector3(), l: new THREE.Vector3(), hw: 1, hh: 1, shake: 0, drift: true };
    this._snapShot('table');
    this.view = { cx: window.innerWidth / 2, cy: window.innerHeight / 2, fr: null, frT: 0 };
  }
  _shot(name) {
    const s = this.shots[name];
    const p = s.p.clone(), l = s.l.clone();
    if (name === 'table') {
      // slow cinematic orbit + breathing dolly
      const t = this.t;
      const a = Math.sin(t * 0.045) * 0.32 + Math.sin(t * 0.017 + 1) * 0.12;
      const r = p.clone().sub(l);
      r.applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
      r.multiplyScalar(1 + Math.sin(t * 0.07) * 0.05);
      p.copy(l).add(r);
      p.y += Math.sin(t * 0.11) * 0.05;
    }
    return { p, l, hw: s.hw, hh: s.hh };
  }
  _snapShot(name) { const s = this._shot(name); this.rig.to = name; this.rig.from = null; this.rig.t = 1; this.rig.p.copy(s.p); this.rig.l.copy(s.l); this.rig.hw = s.hw; this.rig.hh = s.hh; }
  _goShot(name, dur = 1.2) {
    const r = this.rig;
    r.from = { p: r.p.clone(), l: r.l.clone(), hw: r.hw, hh: r.hh };
    r.to = name; r.t = 0; r.dur = dur;
  }
  _freeRect() {
    const W = window.innerWidth, H = window.innerHeight;
    let el = null;
    if (this.ui.isOpen) el = this.ui.panel;
    else if (this.mode === 'menu') {
      const m = document.querySelector('#menu-main.show');
      if (m && m.style.visibility !== 'hidden') el = m.querySelector('.crt') || null;
    }
    const full = { x: 0, y: 0, w: W, h: H };
    if (!el) return full;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return full;
    const c = [
      { x: r.right, y: 0, w: W - r.right, h: H },
      { x: 0, y: 0, w: r.left, h: H },
      { x: 0, y: 0, w: W, h: r.top },
      { x: 0, y: r.bottom, w: W, h: H - r.bottom },
    ].sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (c.w * c.h < W * H * 0.16 || c.w < 120 || c.h < 120) return full;
    return c;
  }
  _updateCamera(dt) {
    const r = this.rig, cam = this.camera;
    const tgt = this._shot(r.to);
    if (r.from && r.t < 1) {
      r.t = Math.min(1, r.t + dt / r.dur);
      const k = easeIO(r.t);
      r.p.lerpVectors(r.from.p, tgt.p, k);
      r.l.lerpVectors(r.from.l, tgt.l, k);
      r.hw = lerp(r.from.hw, tgt.hw, k); r.hh = lerp(r.from.hh, tgt.hh, k);
    } else { r.p.copy(tgt.p); r.l.copy(tgt.l); r.hw = tgt.hw; r.hh = tgt.hh; }
    // where on screen is there room for the picture (right of / above the menu or wardrobe panel)
    const W = window.innerWidth, H = window.innerHeight;
    if ((this.view.frT -= dt) <= 0 || !this.view.fr) { this.view.fr = this._freeRect(); this.view.frT = 0.25; }
    const fr = this.view.fr;
    const aspect = W / H;
    const fx = fr.w / W, fy = fr.h / H;
    const dir = _v1.subVectors(r.p, r.l);
    let dist = dir.length();
    dir.divideScalar(dist || 1);
    const need = Math.max(r.hh / (dist * fy), r.hw / (dist * fx * aspect));
    const tMax = Math.tan(THREE.MathUtils.degToRad(29)), tMin = Math.tan(THREE.MathUtils.degToRad(17));
    let tn = clamp(need, tMin, tMax);
    if (need > tMax) dist *= need / tMax;
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan(tn));
    const pos = _v2.copy(r.l).addScaledVector(dir, dist);
    // handheld drift + shake
    const t = this.t;
    r.shake = Math.max(0, r.shake - dt * 2.2);
    const sh = r.shake * r.shake;
    pos.x += Math.sin(t * 0.63) * 0.012 + Math.sin(t * 1.71) * 0.004;
    pos.y += Math.sin(t * 0.81 + 1) * 0.01 + Math.sin(t * 2.3) * 0.003;
    cam.position.copy(pos);
    cam.lookAt(r.l);
    cam.rotateY(Math.sin(t * 0.52) * 0.0045 + Math.sin(t * 1.37 + 2) * 0.002 + (Math.random() - 0.5) * sh * 0.05);
    cam.rotateX(Math.sin(t * 0.71 + 0.5) * 0.0035 + Math.sin(t * 1.9) * 0.0015 + (Math.random() - 0.5) * sh * 0.05);
    cam.rotateZ(Math.sin(t * 0.37 + 1.2) * 0.004 + (Math.random() - 0.5) * sh * 0.03);
    // centre the subject in the free area with an off-axis view
    const cx = fr.x + fr.w / 2, cy = fr.y + fr.h / 2;
    const v = this.view;
    const kk = this._snapView ? 1 : 1 - Math.exp(-6 * dt);
    this._snapView = false;
    v.cx += (cx - v.cx) * kk; v.cy += (cy - v.cy) * kk;
    if (Math.abs(cam.fov - fov) > 0.01 || cam.aspect !== aspect || Math.abs((cam.view?.offsetX ?? 0) - (W / 2 - v.cx)) > 0.25 || Math.abs((cam.view?.offsetY ?? 0) - (H / 2 - v.cy)) > 0.25 || cam.view?.fullWidth !== W || cam.view?.fullHeight !== H) {
      cam.fov = cam.fov + (fov - cam.fov) * kk;
      cam.aspect = aspect;
      cam.setViewOffset(W, H, W / 2 - v.cx, H / 2 - v.cy, W, H);
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld(true);
    if (audio.ready) audio.setListener(cam.position, cam.quaternion);
  }
  _shake(a) { this.rig.shake = Math.min(1.2, this.rig.shake + a); }

  // ================================================================== input
  _bindInput() {
    const isUI = (t) => !!(t && t.closest && t.closest('.crt, button, input, select, textarea, a, label, [data-act], .wd-panel, .interactive, #touch, .touch-ui'));
    this._isUI = isUI;
    const setPtr = (e) => {
      this.pointer.x = e.clientX; this.pointer.y = e.clientY;
      this.pointer.has = true;
      this.pointer.over = !isUI(e.target);
      this.pointer.touch = e.pointerType === 'touch';
    };
    this._onMove = (e) => {
      if (!this.active) return;
      setPtr(e);
      const d = this._drag;
      if (d && e.pointerId === d.id) {
        const dx = e.clientX - d.x;
        d.moved = Math.max(d.moved, Math.abs(dx) + Math.abs(e.clientY - d.y));
        if (this.mode === 'inside') { this.spinT += (e.clientX - d.lx) * 0.012; }
        d.lx = e.clientX;
      }
    };
    this._onDown = (e) => {
      if (!this.active) return;
      setPtr(e);
      this._gesture();
      if (!this.pointer.over) return;
      this._drag = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, moved: 0, t: performance.now() };
    };
    this._onUp = (e) => {
      if (!this.active) return;
      const d = this._drag;
      this._drag = null;
      if (!d || e.pointerId !== d.id) return;
      setPtr(e);
      if (d.moved < 10 && performance.now() - d.t < 700 && this.mode === 'menu' && !this.seq && this.pointer.over && this._menuUp()) {
        if (this._hitYou(e.clientX, e.clientY)) this._startWardrobe();
      }
    };
    this._onKey = (e) => {
      if (!this.active) return;
      this._gesture();
      if (e.code === 'Escape' && this.mode === 'inside') { e.stopPropagation(); this._done(); }
    };
    window.addEventListener('pointermove', this._onMove, { passive: true, capture: true });
    window.addEventListener('pointerdown', this._onDown, { passive: true, capture: true });
    window.addEventListener('pointerup', this._onUp, { passive: true, capture: true });
    window.addEventListener('pointercancel', (e) => { if (this._drag?.id === e.pointerId) this._drag = null; }, { passive: true, capture: true });
    window.addEventListener('keydown', this._onKey, { capture: true });
  }
  // the main menu screen (not settings / controls / an alert) is up and we are really in the menu
  _menuUp() {
    if (this.game.state !== 'menu') return false;
    const m = document.getElementById('menu-main');
    return !!m && m.classList.contains('show') && m.style.visibility !== 'hidden';
  }
  _hitYou(x, y) {
    if (!this.proxy) return false;
    const W = window.innerWidth, H = window.innerHeight;
    this.raycaster.setFromCamera(new THREE.Vector2((x / W) * 2 - 1, -(y / H) * 2 + 1), this.camera);
    return this.raycaster.intersectObject(this.proxy, false).length > 0;
  }
  // audio can only start after a user gesture
  _gesture() {
    if (this._gestured) return;
    this._gestured = true;
    audio.init().then(() => { try { this.game.ui?.applySettings?.(); } catch (e) { /* */ } }).catch(() => {});
  }

  // ================================================================== menu-panel coordination
  _setMenuVisible(on) {
    const ui = this.game.ui;
    if (typeof ui?.setMenuVisible === 'function') { ui.setMenuVisible(on); return; }
    const m = document.getElementById('menu-main');
    if (m) { m.style.visibility = on ? '' : 'hidden'; m.style.pointerEvents = on ? '' : 'none'; }
  }

  // ================================================================== audio
  _sfx(name, opts = {}) {
    if (!audio.ready) return null;
    try { return audio.play(name, opts); } catch (e) { return null; }
  }
  _startAudio() {
    if (this._audio.on || !audio.ready) return;
    this._audio.on = true;
    try {
      audio.setReverb('office');
      const tp = this.tableTroffer.g.position;
      this._audio.hum = audio.loop('hum', { pos: tp.clone(), volume: 0.7, params: { flicker: 0 } });
      this._audio.vend = audio.loop('vending_hum', { pos: this.vendLight.position.clone(), volume: 0.8 });
      this._audio.loops = [this._audio.hum, this._audio.vend];
    } catch (e) { console.warn('[menu] audio', e); }
  }
  _stopAudio() {
    if (!this._audio.on) return;
    this._audio.on = false;
    for (const l of this._audio.loops) try { l?.stop?.(0.6); } catch (e) { /* */ }
    this._audio.loops = [];
    for (const c of this.clones) { c.laughH?.stop?.(0.1); c.laughH = null; }
  }

  // compile every material of the set up front (KHR_parallel_shader_compile where available) so the first
  // menu frame does not stall on dozens of synchronous shader compiles
  async warm(timeoutMs = 9000) {
    try {
      const r = engine.renderer;
      const p = r.compileAsync ? r.compileAsync(this.scene, this.camera) : Promise.resolve(r.compile(this.scene, this.camera));
      await Promise.race([p, new Promise((res) => setTimeout(res, timeoutMs))]);
    } catch (e) { /* warm-up only */ }
  }

  // ================================================================== activation
  activate() {
    if (this.active) return;
    this.active = true;
    engine.setView(this.scene, this.camera);
    this._snapView = true;
    this.view.frT = 0;
    if (audio.ready) this._startAudio();
  }
  deactivate() {
    if (!this.active) return;
    this.active = false;
    // leaving the menu mid-wardrobe: save, put everything back
    if (this.mode !== 'menu') this._abortWardrobe();
    this.ui.setTag(0, 0, null);
    this._stopAudio();
    const P = engine.post.params;
    P.uFade.value = 0; P.uGlitch.value = 0; P.uFlash.value = 0;
    engine.resetView();
  }

  // ================================================================== per frame
  update(dt) {
    if (!this.active) this.activate();
    this.t += dt;
    if (audio.ready && !this._audio.on) this._startAudio();
    this._updateLights(dt);
    this._updateSequence(dt);
    if (this.mode === 'inside') this._updateInside(dt);
    else this._updateTable(dt);
    this.booth.update(dt);
    if (this.mode === 'inside' || this.chamberBusy) this.chamber.update(dt);
    this.sparks.update(dt);
    this._updateCamera(dt);
    this._updateHover(dt);
    this._updatePost(dt);
  }

  _updatePost(dt) {
    const P = engine.post.params;
    this.flashV = Math.max(0, this.flashV - dt * 4);
    P.uFlash.value = Math.max(P.uFlash.value * Math.exp(-8 * dt), this.flashV * 0.6);
    this.glitch = Math.max(0, this.glitch - dt * 1.8);
    P.uGlitch.value = this.glitch;
    P.uFade.value = this.fade;
  }

  // fluorescent flicker (synced with the hum), balloon bob, clock stuck at 4:59
  _updateLights(dt) {
    const t = this.t, tr = this.tableTroffer;
    this._flk = (this._flk ?? 3) - dt;
    if (this._flk <= 0 && !this._flkOn) { this._flkOn = rnd(0.15, 0.7); this._flk = rnd(4, 11); }
    let lv = 1;
    if (this._flkOn > 0) {
      this._flkOn -= dt;
      lv = Math.random() < 0.55 ? rnd(0.05, 0.35) : rnd(0.85, 1.1);
      if (Math.random() < 0.06) this._sfx('_arc_pop', { pos: tr.g.position, volume: 0.35 });
      if (this._flkOn <= 0) this._flkOn = 0;
    }
    lv *= 0.97 + Math.sin(t * 50) * 0.01 + Math.sin(t * 7.3) * 0.015;
    tr.level = lv;
    this.key.intensity = this.keyInside ? this.key.intensity : this.keyBase * lv;
    tr.lensMat.color.setRGB(2.2 * lv, 2.1 * lv, 1.85 * lv);
    if (this._audio.hum) this._audio.hum.setVolume(0.7 * (0.35 + 0.65 * lv), 0.02);
    const far = this.troffers[2];
    const fl = Math.sin(t * 13) > 0.92 || Math.sin(t * 2.1) > 0.995 ? 0.1 : 0.32;
    far.lensMat.color.setRGB(1.6 * fl, 1.6 * fl, 1.3 * fl);
    // vending glow breathing
    this.vendLight.intensity = 2.2 * (0.9 + 0.1 * Math.sin(t * 3.1) + (Math.random() < 0.01 ? -0.6 : 0));
    // balloon
    if (this.balloon) {
      const o = this.balloon.object;
      o.position.set(-0.9 + Math.sin(t * 0.31) * 0.04, 1.72 + Math.sin(t * 0.47) * 0.03, -0.55 + Math.sin(t * 0.23 + 1) * 0.04);
      o.rotation.set(Math.sin(t * 0.4) * 0.08, t * 0.1, Math.sin(t * 0.33) * 0.08);
      const s = this.balloonString;
      s.position.copy(o.position);
      s.scale.y = o.position.y - 0.76;
    }
    // wall clock: 4:59 forever, the second hand twitches back and forth
    const P = this.clock?.parts;
    if (P) {
      const sec = Math.floor(t) % 4 === 3 ? 47 : 48 + (Math.floor(t) % 4);
      if (P.second) P.second.rotation.z = -(sec / 60) * TAU;
      if (P.minute) P.minute.rotation.z = -(59 / 60) * TAU;
      if (P.hour) P.hour.rotation.z = -((4 + 59 / 60) / 12) * TAU;
    }
    // red glow inside the booth (seen through the louvres), stronger while it works
    const bo = this.booth.doorOpen;
    this.redLight.intensity = this.mode === 'inside' ? 2.2 : (0.5 + bo * 0.8 + this.booth.active * 0.8) * (0.85 + 0.15 * Math.sin(t * 9));
  }

  // ================================================================== the laughing table
  _updateTable(dt) {
    const t = this.t;
    // director: stares, synchronized silence
    this._stareT = (this._stareT ?? rnd(6, 10)) - dt;
    this._silT = (this._silT ?? rnd(14, 22)) - dt;
    const busy = this.mode !== 'menu';
    if (!busy && this._silent > 0) {
      this._silent -= dt;
      if (this._silent <= 0) {
        // everyone bursts out laughing again at the same instant
        for (const c of this.clones) if (c.mode !== 'stare') { c.mode = 'laugh'; c.burst = false; c.burstT = 0; }
      }
    } else if (!busy && this._silT <= 0) {
      this._silT = rnd(16, 28);
      this._silent = rnd(1.6, 2.8);
      for (const c of this.clones) { if (c.mode === 'stare') continue; c.mode = 'freeze'; c.laughH?.stop?.(0.015); c.laughH = null; }
    }
    if (!busy && this._stareT <= 0 && !(this._silent > 0)) {
      this._stareT = rnd(8, 15);
      const cand = this.clones.filter((c) => c.mode === 'laugh' && (!c.you || Math.random() < 0.3));
      const c = cand[Math.floor(Math.random() * cand.length)];
      if (c) { c.mode = 'stare'; c.stareT = rnd(2.2, 3.6); c.laughH?.stop?.(0.02); c.laughH = null; }
    }
    for (const c of this.clones) {
      if (busy && c.you) continue;   // the wardrobe sequence drives your clone
      this._updateClone(c, dt, t, busy);
    }
  }

  _updateClone(c, dt, t, busy) {
    const av = c.av, b = av.bones || {};
    // the android rig laughs by itself (stuttering bursts, jaw clacks); we only sync sound and add head snaps
    const native = LAUGH && av.st && 'laughBurst' in av.st;
    let talking = 0, expr = LAUGH ? 'laugh' : 'happy', look = null, lookAt = null;
    if (busy) {
      // the wardrobe has YOUR clone: everybody stops and watches
      c.mode = 'watch';
      look = lookAt = this._youHead(_v4);
      expr = 'neutral';
      c.laughH?.stop?.(0.05); c.laughH = null;
    } else if (c.mode === 'watch') {
      c.mode = 'laugh'; c.burst = false; c.burstT = rnd(0, 0.15);
    }
    if (c.mode === 'laugh') {
      // who am I laughing with? glance at another clone (or the cake) every few seconds
      c.gazeT = (c.gazeT ?? 0) - dt;
      if (c.gazeT <= 0 || !c.gaze) {
        c.gazeT = rnd(1.5, 4.5);
        const o = this.clones[Math.floor(Math.random() * this.clones.length)];
        c.gaze = o && o !== c ? this._headOf(o, new THREE.Vector3()) : new THREE.Vector3(rnd(-0.3, 0.3), 0.8, rnd(-0.2, 0.2));
      }
      lookAt = c.gaze;
      if (!native) {
        c.burstT -= dt;
        if (c.burstT <= 0) {
          c.burst = !c.burst;
          c.burstT = c.burst ? rnd(0.7, 2.3) : rnd(0.15, 1.3);
          if (c.burst) { c.rate = rnd(5, 8.5); this._laughSound(c); } else if (Math.random() < 0.5) { c.laughH?.stop?.(0.03); c.laughH = null; }
        }
      }
      if (c.burst) {
        if (!native) talking = 0.45 + 0.55 * Math.abs(Math.sin(t * c.rate * PI * 0.5));
        // head snaps to a new laughing angle a few times per second (stop-motion)
        c.snapT -= dt;
        if (c.snapT <= 0) {
          c.snapT = rnd(0.09, 0.3);
          const s = native ? 0.55 : 1;
          c.headT.set(rnd(0.0, 0.3) * s + (native ? 0 : 0.12), rnd(-0.28, 0.28) * s, rnd(-0.22, 0.22) * s);
          if (Math.random() < 0.12) c.headT.set(rnd(0.3, 0.6) * s, rnd(-0.6, 0.6), rnd(-0.4, 0.4)); // violent snap
        }
      } else {
        c.headT.set(c.headT.x * 0.5, c.headT.y * 0.5, c.headT.z * 0.5);
        if (Math.random() < dt * 0.8) c.headT.set(rnd(-0.1, 0.1), rnd(-0.4, 0.4), rnd(-0.15, 0.15));
      }
    } else if (c.mode === 'stare') {
      c.stareT -= dt;
      expr = 'neutral';
      look = lookAt = this.camera.position;
      if (c.stareT <= 0) { c.mode = 'laugh'; c.burst = false; c.burstT = 0; }
    } else if (c.mode === 'freeze') {
      // synchronized silence: hold the pose exactly
      c.headT.copy(c.head);
    }
    this._laughCD = (this._laughCD ?? 0) - dt / Math.max(1, this.clones.length);
    // turning to look: stepped like stop motion (the rig's own head only follows a little)
    if (look) {
      c.root.updateWorldMatrix(true, false);
      const loc = c.root.worldToLocal(_v1.copy(look));
      const yaw = clamp(Math.atan2(-loc.x, -loc.z), -2.6, 2.6);
      const pitch = Math.atan2(loc.y - (c.headY ?? 1), Math.hypot(loc.x, loc.z));
      c.tick -= dt;
      if (c.tick <= 0) { c.tick = 1 / c.fps; c.headT.set(clamp(pitch, -0.5, 0.5), Math.abs(yaw) < 0.25 ? 0 : yaw * (native ? 0.8 : 1), 0); }
    }
    const k = c.mode === 'freeze' ? 0 : look ? 9 : 26;
    c.head.x = damp(c.head.x, c.headT.x, k, dt); c.head.y = damp(c.head.y, c.headT.y, k, dt); c.head.z = damp(c.head.z, c.headT.z, k, dt);
    const wasBurst = !!av.st?.laughBurst;
    try {
      av.update(c.mode === 'freeze' ? 0 : dt, { emote: 'sit', grounded: true, speed: 0, expression: expr, talking, pitch: 0, table: 0.76 - c.seatY, lookAt: lookAt || undefined });
    } catch (e) { if (!this._warned) { this._warned = true; console.warn('[menu] clone update', e); } }
    if (native && c.mode === 'laugh') {
      const now = !!av.st.laughBurst;
      if (now && !wasBurst) this._laughSound(c);
      if (!now && wasBurst && Math.random() < 0.6) { c.laughH?.stop?.(0.03); c.laughH = null; }
      c.burst = now;
    }
    // additive overrides on top of the sit pose (only if the rig exposes these bones)
    if (b.head) {
      const big = Math.abs(c.head.y) > 1.1;
      b.head.rotation.x += c.head.x * (big ? 0.6 : 1);
      b.head.rotation.y += big ? Math.sign(c.head.y) * 1.1 : c.head.y;
      b.head.rotation.z += c.head.z;
      // owl turn: the rest of the way comes from the neck / chest
      const rest = big ? Math.sign(c.head.y) * (Math.abs(c.head.y) - 1.1) : 0;
      if (rest) { if (b.neck) { b.neck.rotation.y += rest * 0.6; if (b.chest) b.chest.rotation.y += rest * 0.4; } else if (b.chest) b.chest.rotation.y += rest; }
    }
    if (!native) {
      const bounce = c.mode === 'laugh' && c.burst ? Math.abs(Math.sin(t * c.rate * PI * 0.5)) : 0;
      if (b.chest) b.chest.rotation.x += -0.05 * bounce + (c.mode === 'laugh' && c.burst ? 0.04 : 0);
      if (b.shL && b.shR) { b.shL.rotation.z -= 0.12 * bounce; b.shR.rotation.z += 0.12 * bounce; }
    }
    // one of them pounds the table while laughing
    if (c.pounder && b.shR && b.elR && c.mode === 'laugh' && c.burst) {
      const ph = (t * 3.4) % 1;
      const up = ph < 0.6 ? ph / 0.6 : 1 - (ph - 0.6) / 0.4;
      b.shR.rotation.x += up * 0.9;
      if (c._lastPh !== undefined && c._lastPh > ph) this._sfx('thunk', { pos: c.root.position, volume: 0.22, pitch: rnd(0.8, 1.0) });
      c._lastPh = ph;
    }
    c.root.updateMatrixWorld(true);
  }
  _laughSound(c) {
    if (!audio.ready || !this.active || (this._laughCD ?? 0) > 0) return;
    this._laughCD = 0.18;
    c.laughH = this._sfx('menu_laugh', { pos: this._headOf(c, _v3), volume: 0.42, pitch: c.voice * rnd(0.94, 1.06) });
  }
  _headOf(c, out) {
    const b = c.av.bones?.head;
    if (b) { b.getWorldPosition(out); out.y += 0.12; return out; }
    return c.root.localToWorld(out.set(0, c.headY ?? 1, 0));
  }
  _youHead(out) { return this.you ? this._headOf(this.you, out) : out.set(0, 1, 0); }

  // ================================================================== hover highlight + tag
  _updateHover(dt) {
    const you = this.you;
    const idle = this.mode === 'menu' && !this.seq && this.active && this._menuUp();
    let hover = false;
    if (idle && this.pointer.has && this.pointer.over && !this.pointer.touch) hover = this._hitYou(this.pointer.x, this.pointer.y);
    if (hover !== this.hover) {
      this.hover = hover;
      document.documentElement.classList.toggle('wd-hover', hover);
      if (hover) this._sfx('ui_blip', { volume: 0.25, bus: 'ui' });
    }
    // outline hull
    this._hoverK = damp(this._hoverK || 0, hover ? 1 : 0, 10, dt);
    if (this._hoverK > 0.01) this._ensureOutline();
    if (this._outlineMat) {
      this._outlineMat.opacity = this._hoverK * (0.75 + 0.25 * Math.sin(this.t * 7));
      this.outlineW.value = 0.008 + 0.006 * this._hoverK;
      for (const m of this._outline?.list || []) m.visible = this._hoverK > 0.01;
    }
    if (you && this.mode === 'menu') {
      this._headOf(you, _v1);
      this.accent.position.copy(_v1).add(_v2.set(0, 0.25, 0.45));
      this.accent.intensity = this._hoverK * (1.2 + 0.3 * Math.sin(this.t * 7));
    } else if (this.mode !== 'inside') this.accent.intensity = damp(this.accent.intensity, 0, 6, dt);
    // pixel tag over your clone
    if (!you || !idle) { this.ui.setTag(0, 0, null); return; }
    this._headOf(you, _v1);
    _v1.y += 0.2;
    _v1.project(this.camera);
    const W = window.innerWidth, H = window.innerHeight;
    const x = (_v1.x * 0.5 + 0.5) * W, y = (-_v1.y * 0.5 + 0.5) * H;
    const fr = this.view.fr;
    const visible = _v1.z < 1 && x > fr.x + 20 && x < fr.x + fr.w - 20 && y > fr.y + 30 && y < fr.y + fr.h;
    const touch = this.pointer.touch || document.documentElement.classList.contains('touch');
    const mode = hover ? 'hover' : touch ? 'touch' : (Math.sin(this.t * 0.9) > -0.2 ? 'you' : 'hover');
    const px = Math.min(W, H) < 500 ? 2 : W > 1700 ? 3 : 2;
    this.ui.setTag(x, y - 4 + (hover ? Math.round(Math.sin(this.t * 6) * 2) : 0), visible ? mode : null, px);
  }

  // ================================================================== wardrobe: sequence
  _startWardrobe() {
    if (this.mode !== 'menu' || !this.you) return;
    this._gesture();
    this.mode = 'grab';
    this.seq = { name: 'turn', t: 0 };
    this.cos = { ...this.you.av.cosmetics };
    this.ui.setTag(0, 0, null);
    document.documentElement.classList.remove('wd-hover');
    this._setMenuVisible(false);
    this._goShot('booth', 1.25);
    this._sfx('ui_select', { volume: 0.5, bus: 'ui' });
    this.you.laughH?.stop?.(0.05);
  }

  // attachment points on your clone for the booth arms
  _grabPoints() {
    const c = this.you, av = c.av, b = av.bones || {};
    c.root.updateMatrixWorld(true);
    const L = new THREE.Vector3(), R = new THREE.Vector3(), Hd = new THREE.Vector3();
    if (b.shL && b.shR) { b.shL.getWorldPosition(L); b.shR.getWorldPosition(R); } else {
      c.root.localToWorld(L.set(-0.2, (c.height ?? 1) * 0.65, 0)); c.root.localToWorld(R.set(0.2, (c.height ?? 1) * 0.65, 0));
    }
    this._headOf(c, Hd);
    Hd.y += 0.14;
    // the booth's right arm takes whichever shoulder is on its side
    const inv = this.booth.root.matrixWorld.clone().invert();
    const lx = L.clone().applyMatrix4(inv).x, rx = R.clone().applyMatrix4(inv).x;
    const back = _v1.set(Math.sin(c.root.rotation.y), 0, Math.cos(c.root.rotation.y));
    L.addScaledVector(back, 0.06); R.addScaledVector(back, 0.06);
    return lx > rx ? { armR: L, armL: R, head: Hd } : { armR: R, armL: L, head: Hd };
  }
  _armDirTo(arm, p) { return _v2.subVectors(p, arm.root.getWorldPosition(_v3)).normalize().clone(); }

  _updateSequence(dt) {
    const s = this.seq;
    if (!s) return;
    const prevT = s.t;
    s.t += dt;
    const at = (x) => prevT < x && s.t >= x;
    const B = this.booth, you = this.you, av = you?.av;
    switch (s.name) {
      // ---------------------------------------------------------------- grab
      case 'turn': {
        this._poseYouSit(dt, 'neutral');
        if (at(0.3)) { B.active = 1; this._sfx('buzzer', { pos: B.root.position, volume: 0.35 }); }
        if (at(0.85)) { B.setDoors(true); this._sfx('pipe_hiss', { pos: B.root.position, volume: 0.35 }); }
        if (s.t >= 1.35) this.seq = { name: 'reach', t: 0 };
        break;
      }
      case 'reach': {
        this._poseYouSit(dt, s.t > 0.6 ? 'scared' : 'neutral');
        const g = this._grabPoints();
        if (at(0.0001)) {
          for (const a of [B.armL, B.armR]) { a.k = 26; a.z = 0.6; a.setGrip(0); }
          this._sfx('robo_whir', { pos: B.root.position, volume: 0.6 });
          this._sfx('robo_whir', { pos: B.root.position, volume: 0.45, pitch: 0.85, delay: 0.12 });
        }
        B.armL.reach(g.armL, this._armDirTo(B.armL, g.armL));
        B.armR.reach(g.armR, this._armDirTo(B.armR, g.armR));
        if (at(1.05)) {
          B.armL.setGrip(1); B.armR.setGrip(1);
          this._sfx('robo_clunk', { pos: g.armL, volume: 0.8 });
          this._sfx('robo_clunk', { pos: g.armR, volume: 0.7, delay: 0.05 });
          this._sfx('gasp', { pos: g.head, volume: 0.45 });
          this.sparks.burst(g.armL, null, 14, 1.6); this.sparks.burst(g.armR, null, 14, 1.6);
          this._shake(0.25);
        }
        if (s.t >= 1.35) {
          this.seq = { name: 'yank', t: 0, from: you.root.position.clone(), fromYaw: you.root.rotation.y };
          this._sfx('robo_whir', { pos: B.root.position, volume: 0.8, pitch: 0.7 });
          this._sfx('pipe_hiss', { pos: B.root.position, volume: 0.5 });
        }
        break;
      }
      case 'yank': {
        const u = clamp(s.t / 1.3, 0, 1);
        const inside = B.root.localToWorld(new THREE.Vector3(0, 0.48, 0.12));
        const yawIn = B.root.rotation.y + PI;
        // lift off the chair, then accelerate backwards into the booth
        const lift = ease(clamp(u / 0.22, 0, 1));
        const pull = Math.pow(clamp((u - 0.12) / 0.88, 0, 1), 1.6);
        const p = _v1.lerpVectors(s.from, inside, pull);
        p.y = lerp(s.from.y, inside.y, pull) + lift * 0.28 * (1 - pull) + Math.sin(pull * PI) * 0.18;
        you.root.position.copy(p);
        you.root.rotation.set(0.35 * lift * (1 - pull * 0.7), s.fromYaw + wrapA(yawIn - s.fromYaw) * ease(pull), Math.sin(s.t * 23) * 0.05 * (1 - pull));
        try { av.update(dt, { emote: null, grounded: false, vy: 0.5, speed: 0, expression: 'scared', talking: 0 }); } catch (e) { /* */ }
        you.root.updateMatrixWorld(true);
        const g = this._grabPoints();
        B.armL.k = 60; B.armR.k = 60;
        B.armL.reach(g.armL, this._armDirTo(B.armL, g.armL));
        B.armR.reach(g.armR, this._armDirTo(B.armR, g.armR));
        if (u > 0.45) { B.armT.k = 40; B.armT.reach(g.head, _v3.set(0, -1, 0).clone()); B.armT.setGrip(u > 0.75 ? 1 : 0); }
        if (at(1.0)) this._sfx('robo_clunk', { pos: g.head, volume: 0.6 });
        if (s.t >= 1.35) { this.seq = { name: 'slam', t: 0 }; B.setDoors(false); }
        break;
      }
      case 'slam': {
        this._hangInBooth(dt);
        if (s.t >= 0.75) { this.seq = { name: 'cutIn', t: 0 }; this.glitch = 1; }
        break;
      }
      case 'cutIn': {
        if (!s.done) this._hangInBooth(dt);
        this.fade = clamp(s.t / 0.25, 0, 1);
        if (s.t >= 0.3 && !s.done) {
          s.done = true;
          this._enterChamber();
        }
        if (s.t >= 0.3) this.fade = clamp(1 - (s.t - 0.3) / 0.45, 0, 1);
        if (s.t >= 0.8) { this.fade = 0; this.seq = null; }
        break;
      }
      // ---------------------------------------------------------------- inside: handled by _updateInside
      case 'cutOut': {
        this.fade = clamp(s.t / 0.3, 0, 1);
        if (s.t >= 0.35 && !s.done) { s.done = true; this._leaveChamber(); }
        if (s.t >= 0.35) { this.fade = clamp(1 - (s.t - 0.35) / 0.4, 0, 1); this._hangInBooth(dt); }
        if (s.t >= 0.8) { this.fade = 0; this.seq = { name: 'ejectOpen', t: 0 }; B.setDoors(true); B.active = 1; this._sfx('pipe_hiss', { pos: B.root.position, volume: 0.4 }); }
        break;
      }
      case 'ejectOpen': {
        this._hangInBooth(dt);
        if (s.t >= 0.6) {
          this.seq = { name: 'eject', t: 0, from: you.root.position.clone(), fromYaw: you.root.rotation.y };
          this._sfx('robo_whir', { pos: B.root.position, volume: 0.8, pitch: 0.8 });
        }
        break;
      }
      case 'eject': {
        const u = clamp(s.t / 1.35, 0, 1), k = easeIO(u);
        const seat = new THREE.Vector3(you.seat.x, you.seatY, you.seat.z);
        const p = _v1.lerpVectors(s.from, seat, k);
        p.y += Math.sin(k * PI) * 0.3;
        you.root.position.copy(p);
        you.root.rotation.set(0, s.fromYaw + wrapA(you.seat.yaw - s.fromYaw) * k, 0);
        const sitting = u > 0.72;
        try { av.update(dt, { emote: sitting ? 'sit' : null, grounded: sitting, speed: 0, expression: 'happy', talking: 0 }); } catch (e) { /* */ }
        you.root.updateMatrixWorld(true);
        const g = this._grabPoints();
        B.armL.reach(g.armL, this._armDirTo(B.armL, g.armL));
        B.armR.reach(g.armR, this._armDirTo(B.armR, g.armR));
        if (at(0.35)) { B.armT.setGrip(0); B.armT.toRest(); }
        if (s.t >= 1.4) {
          this.seq = { name: 'release', t: 0 };
          this._placeAtSeat(you);
          for (const a of [B.armL, B.armR]) a.setGrip(0);
          this._sfx('robo_clunk', { pos: g.armL, volume: 0.6 });
          this._sfx('pipe_hiss', { pos: g.head, volume: 0.35 });
        }
        break;
      }
      case 'release': {
        this._poseYouSit(dt, 'happy');
        if (at(0.25)) { for (const a of B.arms) { a.k = 30; a.toRest(); } this._sfx('robo_whir', { pos: B.root.position, volume: 0.6 }); }
        if (s.t >= 1.05) { B.setDoors(false); this.seq = { name: 'ejectClose', t: 0 }; }
        break;
      }
      case 'ejectClose': {
        this._poseYouSit(dt, 'happy');
        if (s.t >= 0.5) {
          B.active = 0;
          this.seq = { name: 'return', t: 0 };
          this._goShot('table', 1.5);
          this._setMenuVisible(true);
          this.view.frT = 0;
        }
        break;
      }
      case 'return': {
        this._poseYouSit(dt, LAUGH ? 'laugh' : 'happy', 0.6);
        if (s.t >= 1.5) {
          this.seq = null;
          this.mode = 'menu';
          // everyone laughs at the new outfit, all at once
          for (const c of this.clones) { c.mode = 'laugh'; c.burst = false; c.burstT = 0; }
          this._silT = rnd(14, 22);
        }
        break;
      }
      default: break;
    }
  }

  _doorHit(kind, s) {
    this._sfx('booth_bang', { pos: this.booth.root.position, volume: 0.55 + 0.45 * s, pitch: kind === 'open' ? 1.05 : 0.9 });
    this._shake(kind === 'open' ? 0.35 : 0.55 * s);
    if (kind === 'close') this.glitch = Math.max(this.glitch, 0.25 * s);
  }

  _poseYouSit(dt, expr, talk = 0) {
    const you = this.you;
    try { you.av.update(dt, { emote: 'sit', grounded: true, speed: 0, expression: expr, talking: talk ? (0.4 + 0.6 * Math.abs(Math.sin(this.t * 9))) * talk : 0 }); } catch (e) { /* */ }
    you.root.updateMatrixWorld(true);
  }
  _hangInBooth(dt) {
    const you = this.you, B = this.booth;
    you.root.position.copy(B.root.localToWorld(_v1.set(0, 0.48 + Math.sin(this.t * 3) * 0.01, 0.12)));
    you.root.rotation.set(0, B.root.rotation.y + PI, 0);
    try { you.av.update(dt, { emote: null, grounded: false, vy: 0, speed: 0, expression: 'scared', talking: 0 }); } catch (e) { /* */ }
    you.root.updateMatrixWorld(true);
    const g = this._grabPoints();
    B.armL.reach(g.armL, this._armDirTo(B.armL, g.armL));
    B.armR.reach(g.armR, this._armDirTo(B.armR, g.armR));
  }

  // ================================================================== inside the outfitting bay
  _enterChamber() {
    const you = this.you;
    this.mode = 'inside';
    this.chamberBusy = true;
    this.spin = 0; this.spinT = 0; this.sway = { x: 0, z: 0, vx: 0, vz: 0 };
    this.jobs = [];
    this.job = null;
    this.exitAfterJobs = false;
    this.exprT = 0; this.exprNow = 'scared';
    // hang the clone in the harness, facing the camera
    this.harnessPivot.add(you.root);
    you.root.position.set(0, 0, 0); you.root.rotation.set(0, PI, 0);
    try { you.av.update(0.016, { grounded: true, speed: 0, expression: 'scared' }); } catch (e) { /* */ }
    you.root.updateMatrixWorld(true);
    const b = you.av.bones;
    let shY = 0.75;
    this.harnessPivot.updateWorldMatrix(true, true);
    if (b?.shL) shY = you.root.worldToLocal(b.shL.getWorldPosition(_v1)).y;
    you.root.position.set(0, -shY + 0.02, 0);
    // booth arms go back to rest behind the closed doors
    for (const a of this.booth.arms) { a.setGrip(0); a.toRest(true); }
    this.booth.setDoors(false);
    for (const d of this.booth.doors) { d.j.x = 0; d.j.v = 0; }
    this.booth.active = 0;
    // key light becomes the bay spotlight
    this.keyInside = true;
    const k = this.key;
    k.position.copy(CHAMBER_POS).add(_v1.set(0, 3.32, 0.35));
    k.target.position.copy(CHAMBER_POS).add(_v1.set(0, 0.6, 0));
    k.angle = 0.55; k.penumbra = 0.5; k.intensity = 15; k.distance = 9;
    this.redLight.position.copy(CHAMBER_POS).add(_v1.set(0.95, 2.6, -2.15));
    this.vendLight.position.copy(CHAMBER_POS).add(_v1.set(-1.6, 1.6, 1.6));
    this.hemi.intensity = 0.18;
    this.accent.position.copy(CHAMBER_POS).add(_v1.set(0, 1.2, 0.6));
    this.accent.intensity = 0;
    this.scene.fog.density = 0.05;
    this._snapShot('inside');
    this._snapView = true;
    this.chamber.setStatus('SUBJECT SECURED', `EMPLOYEE ${profile.name}`.toUpperCase());
    this.ui.open(this.cos);
    this.view.frT = 0;
    this.ui.status('OUTFITTING BAY 07 · SUBJECT SECURED');
    for (const a of this.chamber.arms) { a.k = 26; a.toRest(); }
    this._sfx('robo_clunk', { pos: CHAMBER_POS.clone().add(_v1.set(0, 1.6, 0)), volume: 0.6 });
    this._sfx('pipe_hiss', { pos: CHAMBER_POS.clone().add(_v1.set(0, 1.6, 0)), volume: 0.4 });
  }

  _leaveChamber() {
    const you = this.you;
    this.ui.close();
    this.ui.setBusy(false);
    this.mode = 'eject';
    this.chamberBusy = false;
    this.scene.add(you.root);
    this._restoreRoomLights();
    // the clone is back in the booth, held by the arms
    this._hangInBooth(0.016);
    for (const a of [this.booth.armL, this.booth.armR]) { a.setGrip(1); a.k = 40; }
    for (const a of [this.booth.armL, this.booth.armR]) { a.update(0); }
    this._snapShot('booth');
    this._snapView = true;
    this.view.frT = 0;
    this.scanRing.visible = false;
  }
  _restoreRoomLights() {
    this.keyInside = false;
    const k = this.key;
    k.position.set(0.1, 2.42, -0.12);
    k.target.position.set(0.1, 0.4, -0.15);
    k.angle = 1.05; k.penumbra = 0.75; k.distance = 7.5;
    this.redLight.position.copy(this.booth.root.localToWorld(new THREE.Vector3(0, 2.0, -0.52)));
    this.vendLight.position.set(-2.6, 1.25, -2.35);
    this.hemi.intensity = 0.32;
    this.scene.fog.density = 0.075;
  }

  _updateInside(dt) {
    const you = this.you, av = you.av, t = this.t;
    // harness: user spin + pendulum sway (+ an automatic show-off turn after some installs)
    this.spin = damp(this.spin, this.spinT, 6, dt);
    const sw = this.sway;
    sw.vx += (-28 * sw.x - 2.2 * sw.vx) * dt; sw.vz += (-28 * sw.z - 2.2 * sw.vz) * dt;
    sw.x += sw.vx * dt; sw.z += sw.vz * dt;
    this.chamber.harness.rotation.y = this.spin + Math.sin(t * 0.4) * 0.12;
    this.harnessPivot.rotation.set(sw.x + Math.sin(t * 1.3) * 0.02, 0, sw.z + Math.sin(t * 0.9 + 1) * 0.02);
    // expression: shocked right after a change, then a little too pleased with the result
    this.exprT -= dt;
    if (this.exprT <= 0 && this.exprNow !== 'happy') this.exprNow = Math.random() < 0.5 ? 'happy' : (LAUGH ? 'laugh' : 'happy');
    try { av.update(dt, { grounded: true, speed: 0, expression: this.exprNow, talking: this.exprNow === 'laugh' ? 0.5 + 0.5 * Math.abs(Math.sin(t * 8)) : 0 }); } catch (e) { /* */ }
    const b = av.bones || {};
    if (b.shL && b.shR) { b.shL.rotation.z -= 0.75; b.shR.rotation.z += 0.75; b.shL.rotation.x -= 0.1; b.shR.rotation.x -= 0.1; }
    if (b.head) { b.head.rotation.x -= 0.08 + Math.sin(t * 0.7) * 0.05; b.head.rotation.z += Math.sin(t * 0.5) * 0.06; }
    if (b.hipL && b.hipR) { b.hipL.rotation.x += Math.sin(t * 1.1) * 0.08; b.hipR.rotation.x -= Math.sin(t * 1.1 + 0.6) * 0.08; }
    you.root.updateMatrixWorld(true);
    // jobs
    this._updateJobs(dt);
    // scanner ring
    const r = this.scanRing;
    if (r.visible) {
      this._scanT += dt;
      const u = this._scanT / 0.9;
      r.position.set(0, lerp(1.95, 0.45, ease(u)), 0);
      r.material.opacity = Math.sin(clamp(u, 0, 1) * PI) * 0.9;
      if (u >= 1) r.visible = false;
    }
    // status screen idles
    if (!this.job && !this.jobs.length && this.exitAfterJobs) this._beginExit();
  }

  // a requested change: queue a job for an arm
  _request(cat, id) {
    if (this.mode !== 'inside' || !cat) return;
    this.cos = { ...this.cos, [cat]: id };
    // only one pending job; the newest request wins (the arm installs whatever is current at contact)
    this.jobs = [{ cat }];
    this._sfx('ui_select', { volume: 0.4, bus: 'ui' });
  }
  _randomize() {
    if (this.mode !== 'inside') return;
    const c = {};
    for (const [cat, list] of Object.entries(COSMETICS)) {
      const ok = list.filter((o) => !o.unlock || profile.has(o.unlock));
      c[cat] = ok[Math.floor(Math.random() * ok.length)]?.id ?? this.cos[cat];
    }
    this.cos = c;
    this.ui.setCurrent(c);
    this.ui.info('FULL REFIT AUTHORIZED. PLEASE REMAIN CALM.');
    this.jobs = [{ cat: 'all' }];
    this._sfx('ui_select', { volume: 0.4, bus: 'ui' });
  }
  _denied(cat, o) {
    this._sfx('ui_error', { volume: 0.45, bus: 'ui' });
    this._sfx('buzzer', { pos: CHAMBER_POS.clone().add(_v1.set(0, 2.5, -2.4)), volume: 0.3 });
    this.chamber.setStatus('ACCESS DENIED', 'REQUIRES COMMENDATION', true);
    this.ui.status('ACCESS DENIED · PART NOT ISSUED TO THIS CLONE', true);
    // the rear arm wags its clamp: no.
    const a = this.chamber.armB;
    if (!this.job || !this.job.arms.includes(a)) { this._wag = 0.9; }
  }
  _done() {
    if (this.mode !== 'inside') return;
    this.exitAfterJobs = true;
    this.ui.setBusy(true);
    this._sfx('ui_select', { volume: 0.5, bus: 'ui' });
    // save now (the animation is just for show)
    this._save();
  }
  _save() {
    const cos = { ...this.cos };
    try {
      profile.data.cosmetics = cos;
      profile.save();
      if (this.game.local?.setCosmetics) {
        this.game.local.setCosmetics(cos);
        profile.data.cosmetics = { ...this.game.local.cosmetics };
        profile.save();
      }
      const r = this.game.roster?.get?.(this.game.local?.id);
      if (r) r.cosmetics = { ...cos };
    } catch (e) { console.warn('[menu] save cosmetics', e); }
  }
  _beginExit() {
    if (this.seq) return;
    this.exitAfterJobs = false;
    this.chamber.setStatus('OUTFITTING COMPLETE', 'RETURN TO WORK');
    this.ui.status('OUTFITTING COMPLETE · RETURNING SUBJECT');
    this.seq = { name: 'cutOut', t: 0 };
    this.glitch = 0.8;
    this._sfx('robo_clunk', { pos: CHAMBER_POS.clone().add(_v1.set(0, 1.6, 0)), volume: 0.5 });
  }

  // targets on the hanging clone (clone-root local offsets + outward normal) per category
  _jobTarget(cat, side = 1) {
    const you = this.you, b = you.av.bones || {};
    const r = you.root;
    r.updateMatrixWorld(true);
    const headW = b.head ? b.head.getWorldPosition(new THREE.Vector3()) : r.localToWorld(new THREE.Vector3(0, 0.95, 0));
    const chestW = b.chest ? b.chest.getWorldPosition(new THREE.Vector3()) : r.localToWorld(new THREE.Vector3(0, 0.7, 0));
    const q = r.getWorldQuaternion(new THREE.Quaternion());
    const L = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(q);
    switch (cat) {
      case 'hat': return { p: headW.clone().add(L(0, 0.33, 0)), n: L(0, 1, 0.25).normalize(), spark: 'spark' };
      case 'visor': case 'face': return { p: headW.clone().add(L(0, 0.16, -0.21)), n: L(side * 0.7, 0.1, -1).normalize(), spark: 'weld_crackle' };
      case 'skin': return { p: headW.clone().add(L(side * 0.22, 0.14, 0)), n: L(side, 0.15, -0.2).normalize(), spark: 'weld_crackle' };
      case 'backpack': return { p: chestW.clone().add(L(0, 0.0, 0.26)), n: L(0, 0.2, 1).normalize(), spark: 'spark' };
      case 'accessory': return { p: chestW.clone().add(L(0, 0.12, -0.2)), n: L(side * 0.6, 0.1, -1).normalize(), spark: 'spark' };
      default: return { p: chestW.clone().add(L(side * 0.27, -0.05, 0)), n: L(side, 0, -0.1).normalize(), spark: 'weld_crackle' };
    }
  }
  _startJob(j) {
    const C = this.chamber;
    const cat = j.cat;
    const camSide = Math.sign(Math.sin(this.spin) || 1);
    let plan;
    if (cat === 'suit' || cat === 'all') plan = [[C.armL, cat === 'all' ? 'hat' : 'suit', -1], [C.armR, cat === 'all' ? 'suit' : 'suit', 1]];
    else if (cat === 'hat' || cat === 'backpack') plan = [[C.armB, cat, 1]];
    else if (cat === 'skin') plan = [[camSide > 0 ? C.armL : C.armR, cat, camSide > 0 ? -1 : 1]];
    else plan = [[Math.random() < 0.5 ? C.armL : C.armR, cat, 0]];
    if (cat === 'all') plan.push([C.armB, 'backpack', 1]);
    j.arms = plan.map((p) => p[0]);
    j.plan = plan.map(([arm, tcat, side]) => ({ arm, tcat, side: side || (arm === C.armL ? -1 : 1) }));
    j.t = 0;
    j.applied = false;
    this.job = j;
    this.chamber.setStatus('INSTALLING', (cat === 'all' ? 'FULL REFIT' : (this._entryName(cat) || cat)).toUpperCase());
    this.ui.status(`ARM ${j.plan.map((p) => (p.arm === C.armL ? 1 : p.arm === C.armR ? 2 : 3)).join('+')} · INSTALLING ${cat === 'all' ? 'FULL REFIT' : (this._entryName(cat) || cat).toUpperCase()}`);
    for (const p of j.plan) { p.arm.k = 34; p.arm.z = 0.5; p.arm.setGrip(0); }
    this._sfx('robo_whir', { pos: this.you.root.getWorldPosition(new THREE.Vector3()), volume: 0.7, pitch: rnd(0.9, 1.15) });
  }
  _entryName(cat) { return COSMETICS[cat]?.find((o) => o.id === this.cos[cat])?.name; }
  _updateJobs(dt) {
    if (this._wag > 0) {
      this._wag -= dt;
      const a = this.chamber.armB;
      if (!this.job?.arms.includes(a)) {
        a.mode = 'pose';
        a.J.yaw.t = Math.sin(this._wag * 22) * 0.35;
        a.J.e1.t = 1.35; a.J.bend.t = 1.2; a.J.wrist.t = -0.3;
        a.setRoll(Math.sin(this._wag * 30) * 0.8);
        if (this._wag <= 0) { a.setRoll(0); a.toRest(); }
      }
    }
    if (!this.job && this.jobs.length) this._startJob(this.jobs.shift());
    const j = this.job;
    if (!j) return;
    const prev = j.t;
    j.t += dt;
    const at = (x) => prev < x && j.t >= x;
    for (const p of j.plan) {
      const tg = this._jobTarget(p.tcat, p.side);
      p.last = tg;
      const a = p.arm;
      if (j.t < 0.42) a.reach(tg.p.clone().addScaledVector(tg.n, 0.34), tg.n.clone().negate());
      else if (j.t < 1.0) { a.k = 60; a.reach(tg.p.clone().addScaledVector(tg.n, 0.05 + (j.t > 0.6 ? Math.sin(j.t * 40) * 0.01 : 0)), tg.n.clone().negate()); }
      else a.toRest();
      if (at(0.55)) { a.setGrip(0.75); a.jitter = 1; a.setRoll(a.J.roll.t + (Math.random() < 0.5 ? -1 : 1) * 7); }
      if (at(1.0)) { a.jitter = 0; a.setGrip(0); a.k = 26; }
      // sparks while working
      if (j.t > 0.55 && j.t < 0.98 && Math.random() < dt * 18) this.sparks.burst(tg.p, tg.n, 7, 2.2, CHAMBER_POS.y);
    }
    if (at(0.42)) this._sfx('robo_whir', { pos: j.plan[0].last.p, volume: 0.5, pitch: 1.3 });
    if (at(0.55)) {
      // contact: the swap happens under a shower of sparks
      const p0 = j.plan[0].last;
      this._sfx('robo_clunk', { pos: p0.p, volume: 0.85 });
      this._sfx(p0.spark, { pos: p0.p, volume: 0.6 });
      for (const p of j.plan) this.sparks.burst(p.last.p, p.last.n, 34, 3.0, CHAMBER_POS.y);
      this.flashV = 0.55;
      this._shake(0.18);
      this._applyCos();
      this.sway.vx += rnd(-1.4, 1.4); this.sway.vz += rnd(-1.4, 1.4);
      this.exprNow = Math.random() < 0.5 ? 'shocked' : 'scared';
      this.exprT = 0.9;
      if (j.cat === 'suit' || j.cat === 'all' || j.cat === 'skin') { this.scanRing.visible = true; this._scanT = 0; this._sfx('teleport_whoosh', { pos: p0.p, volume: 0.25 }); }
    }
    if (at(0.75) && Math.random() < 0.6) this._sfx('drill', { pos: j.plan[0].last.p, volume: 0.25 });
    if (at(1.0)) { this._sfx('pipe_hiss', { pos: j.plan[0].last.p, volume: 0.3 }); this._sfx('robo_whir', { pos: j.plan[0].last.p, volume: 0.5, pitch: 0.9 }); }
    if (j.t >= 1.35) {
      this.job = null;
      this.chamber.setStatus('STANDING BY', 'SELECT NEXT PART');
      this.ui.status(this.jobs.length ? 'NEXT PART QUEUED' : 'OUTFITTING BAY 07 · STANDING BY');
      if (j.cat === 'backpack' || j.cat === 'all') this.spinT += TAU; // show-off turn
    }
  }
  _applyCos() {
    const av = this.you.av;
    try {
      av.setCosmetics(this.cos);
      av.setName?.(profile.name);
    } catch (e) { console.warn('[menu] setCosmetics', e); }
    this._outline = this._outline ? (this._outline.list.forEach((m) => m.removeFromParent()), null) : null;
  }

  // leaving the menu while the wardrobe is busy: keep the pick, put the clone back on its chair
  _abortWardrobe() {
    if (this.mode === 'inside' || this.mode === 'eject') this._save();
    this.seq = null;
    this.job = null; this.jobs = [];
    this.ui.close();
    this.scene.add(this.you.root);
    this._placeAtSeat(this.you);
    this._restoreRoomLights();
    for (const a of this.booth.arms) { a.setGrip(0); a.toRest(true); }
    this.booth.setDoors(false);
    for (const d of this.booth.doors) { d.j.x = 0; d.j.v = 0; }
    this.booth.active = 0;
    this.mode = 'menu';
    this.chamberBusy = false;
    this.fade = 0; this.glitch = 0;
    this._snapShot('table');
    this._setMenuVisible(true);
  }
}
