// R.O.O.M. — main menu: the CLONE FACTORY. An isolated 3D set rendered through the post stack with
// engine.setView(). There is no HTML on screen: everything is a physical, clickable object.
//
// HUB      A dark assembly hall. Your clone hangs limp from an overhead conveyor hook (it is not alive
//          yet: it dangles, sways and lolls like a ragdoll) under one work lamp. Next to it hang big
//          backlit sign boxes: NEW MISSION, CONTINUE, SETTINGS and COMMENDATIONS. Hover makes them glow
//          and swing; a click flies the camera (eased crane moves) to that station in first person.
// WORKSHOP Click the clone: the floodlight banks slam on one by one. Two hydraulic arms flank the hook
//          and a parts board hangs beside it. Swipe (drag / touch) or use the arrow keys to move between
//          sections (FRAME, HEAD SHAPE, BODY SHAPE, CLOTHING, EYES, ACCESSORIES, FACE, SHELL FINISH,
//          HEADWEAR, FACE GEAR, BACKPACK). Clicking a part on the board is brutal: one arm clamps the old
//          part and rips it off (sparks, oil, bolts, the body jerks), the other grabs the new part off the
//          board and slams it on. Choices save to profile.data.cosmetics.
// DISPATCH The NEW MISSION console: destination selector + a big lever. Pull it: alarm, the floor hatch
//          opens, the hook lets go, the camera follows the body down the shaft, impact (hit-stop), the
//          eyes flicker on in the dark cell — then game.enterLobby({ continued }) (or startSolo()).
// CONTINUE Three crates pried open: cash bundles with a value tag, the old inventory (catalog models),
//          a stamped run record. Click a crate to drop. No save: one taped-off empty crate.
// SETTINGS A calibration cabinet with knobs, a fader, toggle switches, rotary selectors and a CRT.
// COMMENDATIONS  A wall of plaques (core/profile.js ACHIEVEMENTS) with the cosmetics they unlock.
// Back: the "◄ BACK" pull-tag hanging at the top-left of the view, Esc / Backspace or right click.
//
// API (main.js): new MenuScene(game); warm(); update(dt) while the menu shows; deactivate() when leaving.
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { audio } from '../audio/audio.js';
import { profile, ACHIEVEMENTS } from '../core/profile.js';
import { save } from '../core/save.js';
import { juice } from '../gfx/juice.js';
import * as AV from '../entities/avatar.js';
import { buildModel } from '../entities/catalog.js';
import {
  RoboArm, Sparks, Batch, cyl, factoryMats, LiveTex, fitText, wrapLines, HangPanel, Hatch, Knob, Toggle, Fader, Selector,
  Crate, Junk, Puffs, Motes, kitMesh as mesh, kitRbox as rbox, PHOS, brackets, scanlines, phosphorBg,
} from '../entities/wardrobe.js';
import { FONT } from '../ui/fonts.js';
import { getPart } from '../entities/doll/doll_avatar.js';
import { buildHatPart, buildVisorPart, buildAccPart, buildPackPart } from '../entities/doll/robotcos.js';
import { buildRobotHead } from '../entities/doll/robotbody.js';
import { headKind } from '../entities/doll/robothead.js';
import { robotMaterial, RM, SKIN_TONE } from '../entities/doll/robotmat.js';
import { faceTexture } from '../entities/doll/robotface.js';
import { ROBOT_SCALE } from '../entities/doll/robotrig.js';
import { HC } from '../entities/doll/robotshape.js';

const { Avatar, COSMETICS, resolveCos, DEFAULT_COSMETICS } = AV;
// type roles (ui/fonts.js): deco signage, typewriter forms, CRT terminals, marker labels, handwriting
const F_SIGN = FONT.deco, F_TYPE = FONT.type, F_CRT = FONT.crt, F_MONO = FONT.mono, F_MARK = FONT.marker, F_HAND = FONT.hand, F_PRINT = FONT.print, F_TITLE = FONT.title;
const PI = Math.PI, TAU = PI * 2, DEG = PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const easeIO = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const rnd = (a, b) => a + (b - a) * Math.random();
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _v1 = V(), _v2 = V(), _v3 = V(), _v4 = V();
const _q1 = new THREE.Quaternion();

const RAIL_Y = 3.78, CABLE = 0.55, TILT = 0.32;
const PIVOT = V(0, RAIL_Y - 0.12, 0);
const ARM_BASE = [V(-1.32, 1.24, -0.42), V(1.32, 1.24, -0.42)];
const SECTIONS = [
  { cat: 'frame', title: 'FRAME', sub: 'GENDER · CHASSIS', focus: 'body', yaw: 0.2 },
  { cat: 'skull', title: 'HEAD SHAPE', sub: 'CRANIAL SHELL', focus: 'head', yaw: 0.45 },
  { cat: 'build', title: 'BODY SHAPE', sub: 'BUILD', focus: 'body', yaw: 0.3 },
  { cat: 'suit', title: 'CLOTHING', sub: 'COVERALL ISSUE', focus: 'body', yaw: 0.12 },
  { cat: 'eyes', title: 'EYES', sub: 'OPTICAL UNITS', focus: 'head', yaw: 0.0 },
  { cat: 'accessory', title: 'ACCESSORIES', sub: 'NECK · BELT · CHEST', focus: 'body', yaw: 0.25 },
  { cat: 'face', title: 'FACE', sub: 'PAINTED FACE PLATE', focus: 'head', yaw: 0.1 },
  { cat: 'skin', title: 'SHELL FINISH', sub: 'ABS / PORCELAIN', focus: 'body', yaw: 0.35 },
  { cat: 'hat', title: 'HEADWEAR', sub: 'CRANIAL ACCESSORIES', focus: 'head', yaw: 0.55 },
  { cat: 'visor', title: 'FACE GEAR', sub: 'EYEWEAR · MASKS', focus: 'head', yaw: 0.3 },
  { cat: 'backpack', title: 'BACKPACK', sub: 'REAR MOUNT', focus: 'back', yaw: 2.75 },
];
const LEVEL_NAME = { yellow: 'LEVEL 0', poolrooms: 'LEVEL 37', grasslands: 'LEVEL 1.1' };
const DESTS = ['yellow', 'poolrooms', 'grasslands'];
const CAT_NAME = { suit: 'COVERALL', skin: 'FINISH', hat: 'HEADWEAR', visor: 'FACE GEAR', face: 'FACE', backpack: 'BACKPACK', accessory: 'ACCESSORY', frame: 'FRAME', skull: 'HEAD', build: 'BUILD', eyes: 'EYES' };
const NONE_OK = { hat: 'none', visor: 'none', accessory: 'none', backpack: 'none' };
const plainCos = (c) => { const r = resolveCos(c); const o = {}; for (const k of Object.keys(DEFAULT_COSMETICS)) o[k] = r[k]; return o; };
const unlocked = (o) => !o.unlock || profile.has(o.unlock);
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

// ----------------------------------------------------------------------------------------------
// the hanging body: pendulum on the hook cable + lagging, sprung limbs (a ragdoll that is not alive)
class Dangle {
  constructor() {
    this.ax = 0; this.az = 0; this.vx = 0; this.vz = 0; this.yaw = 0; this.yv = 0; this.yawT = 0;
    this.L = 1.15; this.jerk = 0; this.t = Math.random() * 10;
    this.limb = { aL: [0, 0, 0, 0], aR: [0, 0, 0, 0], lL: [0, 0, 0, 0], lR: [0, 0, 0, 0], hd: [0, 0, 0, 0] };
    this.headless = false; this.eyeless = false; this.mode = 'hang'; this.flail = 0;
  }
  kick(ix, iz, iy = 0, lim = 1) {
    this.vx += ix; this.vz += iz; this.yv += iy;
    for (const l of Object.values(this.limb)) { l[2] += rnd(-3, 3) * lim; l[3] += rnd(-3, 3) * lim; }
    this.jerk = Math.min(1.5, this.jerk + 0.6 * lim);
  }
  step(dt) {
    this.t += dt;
    const k = 9.8 / this.L;
    const accX = -k * Math.sin(this.ax) - 0.5 * this.vx + Math.sin(this.t * 0.31) * 0.012;
    const accZ = -k * Math.sin(this.az) - 0.5 * this.vz + Math.sin(this.t * 0.23 + 1) * 0.015;
    this.vx += accX * dt; this.vz += accZ * dt;
    this.ax += this.vx * dt; this.az += this.vz * dt;
    this.yv += ((this.yawT - this.yaw) * 5 - this.yv * 2.4 + Math.sin(this.t * 0.17) * 0.05) * dt;
    this.yaw += this.yv * dt;
    const drv = [[-accX * 0.05, -accZ * 0.05], [-accX * 0.05, -accZ * 0.05], [-accX * 0.035, -accZ * 0.035], [-accX * 0.035, -accZ * 0.035], [-accX * 0.04, -accZ * 0.04]];
    let i = 0;
    for (const l of Object.values(this.limb)) {
      const d = drv[i++];
      l[2] += (-40 * l[0] - 4.5 * l[2] + d[0] * 40) * dt; l[3] += (-40 * l[1] - 4.5 * l[3] + d[1] * 40) * dt;
      l[0] += l[2] * dt; l[1] += l[3] * dt;
      l[0] = clamp(l[0], -1.2, 1.2); l[1] = clamp(l[1], -0.9, 0.9);
    }
    this.jerk = Math.max(0, this.jerk - dt * 2.2);
  }
}

export class MenuScene {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.scene.name = 'FactoryMenu';
    this.scene.background = new THREE.Color(0x010101);
    this.scene.fog = new THREE.FogExp2(0x020203, 0.045);
    this.scene.environment = engine.defaultEnv;
    this.scene.environmentIntensity = 0.1;
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.03, 140);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.F = factoryMats();
    this.t = 0;
    this.active = false;
    this.mode = 'intro';
    this.hits = [];
    this.raycaster = new THREE.Raycaster();
    this.pointer = { x: -1, y: -1, has: false, touch: false };
    this.hover = null;
    this.cos = plainCos(profile.data.cosmetics || game.local?.cosmetics || {});
    this.secIdx = 0;
    this.jobs = []; this.job = null;
    this.fx = { flash: 0, glitch: 0, fade: 1, letter: 0, letterT: 0 };
    this.banks = 0; this.bankT = 0; this.bankOn = 0;
    this._audio = { on: false, loops: [] };
    this.aspect = window.innerWidth / window.innerHeight;
    this._buildHall();
    this._buildLights();
    this._buildRobot();
    this._buildArms();
    this._buildPanels();
    this._buildDispatch();
    this._buildContinue();
    this._buildSettings();
    this._buildTrophies();
    this._buildRack();
    this._buildBackTag();
    this._buildFx();
    this._buildBackline();
    this.rig = { p: V(0, 1.7, 6), l: V(0, 2.4, 0), fov: 50, from: null, t: 1, dur: 1, shot: 'hub', arc: 0.2, vel: V(), roll: 0 };
    this._layout();
    this._snap('introStart');
    this._bindInput();
    this.debug = {
      go: (m) => this._enter(m), section: (i) => this._section(i), choose: (cat, id) => this._choose(cat, id),
      drop: (c) => this._startDrop(!!c), skip: () => this._skipIntro(),
    };
  }

  // ============================================================================ helpers
  _addHit(obj, act) { obj.userData.act = act; this.hits.push(obj); return obj; }
  _removeHit(obj) { const i = this.hits.indexOf(obj); if (i >= 0) this.hits.splice(i, 1); }
  _sfx(name, opts = {}) { if (!audio.ready) return null; try { return audio.play(name, opts); } catch (e) { return null; } }
  _tex(w, h, draw) { return new LiveTex(w, h, draw); }
  _plane(w, h, mat, parent, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { const m = mesh(new THREE.PlaneGeometry(w, h), mat, parent, x, y, z, rx, ry, rz); m.castShadow = false; return m; }
  _basicTexMat(tex, opts = {}) { return new THREE.MeshBasicMaterial({ map: tex, toneMapped: true, ...opts }); }
  _emTexMat(tex, k = 1, opts = {}) { return new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: k, roughness: 0.5, ...opts }); }

  // ============================================================================ build: hall
  _buildHall() {
    const S = this.scene, F = this.F;
    const B = new Batch();
    const hs = 0.97;
    const fp = (x0, x1, z0, z1) => {
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-PI / 2).translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
      const P = g.attributes.position, U = g.attributes.uv;
      for (let i = 0; i < P.count; i++) U.setXY(i, P.getX(i) / 44, -P.getZ(i) / 44);
      B.add(g, F.floor);
    };
    fp(-22, 22, -18, -hs); fp(-22, 22, hs, 16); fp(-22, -hs, -hs, hs); fp(hs, 22, -hs, hs);
    // walls
    B.add(new THREE.PlaneGeometry(44, 10), F.wall, new THREE.Matrix4().makeTranslation(0, 5, -10));
    B.add(new THREE.PlaneGeometry(34, 10), F.wall, new THREE.Matrix4().makeRotationY(PI / 2).setPosition(-16, 5, -1));
    B.add(new THREE.PlaneGeometry(34, 10), F.wall, new THREE.Matrix4().makeRotationY(-PI / 2).setPosition(16, 5, -1));
    // I-beam columns
    for (let x = -12; x <= 12; x += 6) for (const z of [-3.4, 4.6]) {
      if (Math.abs(x) < 1 && z > 0) continue;
      B.box(0.32, 7.2, 0.04, F.beam, x, 3.6, z); B.box(0.04, 7.2, 0.3, F.beam, x, 3.6, z); B.box(0.32, 0.3, 0.32, F.yellow, x, 0.15, z);
    }
    // roof trusses + main rail (I-beam) + background rail
    for (let x = -14; x <= 14; x += 3.5) B.box(0.18, 0.36, 22, F.beam, x, 7.2, -1);
    B.box(30, 0.05, 0.22, F.beam, 0, RAIL_Y + 0.12, 0); B.box(30, 0.05, 0.22, F.beam, 0, RAIL_Y - 0.12, 0); B.box(30, 0.24, 0.035, F.beam, 0, RAIL_Y, 0);
    for (let x = -12; x <= 12; x += 4) B.box(0.06, 7.2 - RAIL_Y, 0.06, F.beam, x, (7.2 + RAIL_Y) / 2, 0);
    B.box(30, 0.2, 0.18, F.beam, 0, 4.5, -5.6);
    for (let x = -12; x <= 12; x += 4) B.box(0.05, 2.7, 0.05, F.beam, x, 5.85, -5.6);
    // pipes along the back wall
    for (const [y, r] of [[5.6, 0.12], [5.25, 0.08], [6.1, 0.18]]) B.add(cyl(r, 32, 'x', 12), F.rust, new THREE.Matrix4().makeTranslation(0, y, -9.6));
    // floor markings: walkway lines + the hatch keep-out box
    for (const z of [2.9, -2.4]) B.box(26, 0.004, 0.08, F.yellow, 0, 0.002, z);
    for (const s of [-1, 1]) { B.box(2.6, 0.004, 0.07, F.yellow, 0, 0.003, s * 1.3); B.box(0.07, 0.004, 2.6, F.yellow, s * 1.3, 0.003, 0); }
    // drums, scrap bin, spare-part shelves in the gloom
    for (const [x, z] of [[-7.5, -3], [-7.0, -2.6], [8.2, 4.1], [6.6, -7.8], [-9.6, 3.8]]) { B.add(cyl(0.29, 0.88, 'y', 16), F.rust, new THREE.Matrix4().makeTranslation(x, 0.44, z)); }
    B.box(0.9, 0.05, 0.7, F.rust, 2.2, 0.025, 1.2);
    for (const s of [-1, 1]) { B.box(0.9, 0.5, 0.04, F.rust, 2.2, 0.25, 1.2 + s * 0.33); B.box(0.04, 0.5, 0.7, F.rust, 2.2 + s * 0.43, 0.25, 1.2); }
    for (const x of [-11, -8.5, 9.5, 12]) { for (let y = 0.5; y < 3; y += 0.9) B.box(2.2, 0.05, 0.7, F.beam, x, y, -9.3); for (const s of [-1, 1]) B.box(0.05, 3, 0.05, F.beam, x + s * 1.1, 1.5, -9.0); }
    // pedestals of the outfitting arms
    for (const b of ARM_BASE) { B.add(cyl(0.2, b.y, 'y', 18, 0.26), F.beam, new THREE.Matrix4().makeTranslation(b.x, b.y / 2, b.z)); B.add(cyl(0.3, 0.05, 'y', 18), F.hazard, new THREE.Matrix4().makeTranslation(b.x, 0.025, b.z)); }
    B.build(S);
    // high windows (faint night light) + the line sign
    const win = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.08, 0.12) });
    for (let x = -12; x <= 12; x += 4) { const m = mesh(new THREE.PlaneGeometry(2.6, 1.4), win, S, x, 7.4, -9.95); m.castShadow = false; }
    const sign = this._tex(1024, 192, (g, w, h) => {
      g.fillStyle = '#0a0907'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#c9b48a'; g.textBaseline = 'middle';
      fitText(g, 'R.O.O.M. CLONE ASSEMBLY · LINE 04', w / 2, h * 0.42, w - 60, 86, `{s}px ${F_PRINT}`);
      g.fillStyle = '#8a7a5a'; fitText(g, 'NO UNIT LEAVES THIS FLOOR ALIVE · IT LEAVES IT FINISHED', w / 2, h * 0.8, w - 80, 34, `{s}px ${F_TYPE}`);
    });
    this.lineSign = this._plane(7, 1.3, this._emTexMat(sign.tex, 0.25), S, 0, 5.3, -9.9);
    // ceiling floodlight fixtures in 4 banks (lenses glow when the bank is on)
    this.bankFix = [];
    const fixG = new THREE.BoxGeometry(1.6, 0.14, 0.5), lensG = new THREE.PlaneGeometry(1.5, 0.4);
    for (let b = 0; b < 4; b++) {
      const lens = new THREE.MeshBasicMaterial({ color: 0x060504 });
      for (const [x, z] of [[-4.5 + b * 3, 2.2], [-4.5 + b * 3, -2.2]]) {
        mesh(fixG, F.dark, S, x, 6.6, z);
        this._plane(1.5, 0.4, lens, S, x, 6.52, z, PI / 2);
      }
      this.bankFix.push(lens);
    }
    void lensG;
    // work lamp cage over the hook
    this.lampLens = new THREE.MeshBasicMaterial({ color: 0x050403 });
    const lamp = new THREE.Group(); lamp.position.set(0.6, 6.55, 1.4); S.add(lamp);
    mesh(new THREE.ConeGeometry(0.32, 0.32, 18, 1, true), F.dark, lamp, 0, 0, 0);
    this._plane(0.4, 0.4, this.lampLens, lamp, 0, -0.12, 0, PI / 2).geometry = new THREE.CircleGeometry(0.26, 18);
    mesh(cyl(0.01, 0.65, 'y', 6), F.steel, lamp, 0, 0.48, 0);
  }

  _buildLights() {
    const S = this.scene;
    this.hemi = new THREE.HemisphereLight(0x7d8a9c, 0x0b0907, 0.05);
    S.add(this.hemi);
    const key = (this.key = new THREE.SpotLight(0xffdcb0, 0, 10, 0.4, 0.6, 2));
    key.position.set(0.6, 6.5, 1.4); key.target.position.set(0, 2.5, 0);
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.camera.near = 1; key.shadow.camera.far = 10; key.shadow.bias = -0.0005; key.shadow.normalBias = 0.03;
    S.add(key, key.target);
    this.ws = [new THREE.SpotLight(0xfff1dc, 0, 18, 0.95, 0.75, 2), new THREE.SpotLight(0xe8f0ff, 0, 18, 0.95, 0.75, 2)];
    this.ws[0].position.set(-3.5, 6.6, 3.2); this.ws[1].position.set(4, 6.6, -1.5);
    for (const l of this.ws) { l.target.position.set(0.4, 1.6, 0.3); S.add(l, l.target); }
    this.weldLight = new THREE.PointLight(0x9fd0ff, 0, 8, 2); this.weldLight.position.set(-6, 3.0, -5.1); S.add(this.weldLight);
    this.beacon = new THREE.PointLight(0xff2a10, 0, 12, 2); this.beacon.position.set(-1.6, 3.4, 1.2); S.add(this.beacon);
    this.stLight = new THREE.SpotLight(0xffe6c4, 0, 7, 0.8, 0.6, 2); S.add(this.stLight, this.stLight.target);
    this.shaftLight = new THREE.PointLight(0xff4a2a, 0, 7, 2); this.shaftLight.position.set(0, -3, 0); S.add(this.shaftLight);
  }

  // ============================================================================ build: the clone on the hook
  _buildRobot() {
    const S = this.scene, F = this.F;
    // trolley on the rail + cable + hook
    this.trolley = new THREE.Group(); this.trolley.position.set(0, RAIL_Y, 0); S.add(this.trolley);
    const tb = new Batch();
    tb.box(0.36, 0.16, 0.3, F.yellow, 0, 0.0, 0, 0, 0, 0, 0.02);
    for (const s of [-1, 1]) tb.add(cyl(0.06, 0.05, 'z', 14), F.dark, new THREE.Matrix4().makeTranslation(s * 0.12, 0.1, 0));
    tb.add(cyl(0.035, 0.12, 'y', 10), F.steel, new THREE.Matrix4().makeTranslation(0, -0.12, 0));
    tb.build(this.trolley);
    this.swing = new THREE.Group(); this.swing.rotation.order = 'XZY'; this.swing.position.copy(PIVOT); S.add(this.swing);
    const cable = mesh(cyl(0.009, CABLE, 'y', 6), F.steel, this.swing, 0, -CABLE / 2, 0); cable.castShadow = true;
    this.hook = new THREE.Group(); this.hook.position.y = -CABLE; this.swing.add(this.hook);
    mesh(new THREE.TorusGeometry(0.06, 0.014, 8, 18, PI * 1.5), F.chrome, this.hook, 0, -0.06, 0, 0, PI / 2, PI * 0.25);
    this.clamp = mesh(new THREE.BoxGeometry(0.05, 0.08, 0.04), F.yellow, this.hook, 0, 0.02, 0);
    this.dg = new Dangle();
    this.av = new Avatar(this.cos);
    this.av.setName(profile.name);
    this.body = new THREE.Group(); this.swing.add(this.body); this.body.position.y = -CABLE;
    this.body.add(this.av.root);
    this.av.root.position.y = -1.2;
    this.av.root.rotation.y = PI;   // faces the hall (the rig looks down -Z)
    // harness ring on the upper back
    this.ring = mesh(new THREE.TorusGeometry(0.035 / ROBOT_SCALE, 0.008 / ROBOT_SCALE, 6, 14), F.steel, null, 0, 0.17, 0.13, PI / 2);
    this.av.bones.chest.add(this.ring);
    this.expr = 'dead';
    this._poseHang = (b) => this._hangPose(b);
    this.av.update(0.016, { expression: 'dead', poseFn: this._poseHang });
    // click proxy
    this.robotHit = this._addHit(mesh(new THREE.BoxGeometry(0.62, 1.55, 0.45), new THREE.MeshBasicMaterial({ visible: false }), this.body, 0, -0.62, 0), { type: 'robot', modes: ['hub'] });
    this.robotHit.castShadow = false;
    // toe tag
    const tag = this._tex(256, 128, (g, w, h) => {
      g.fillStyle = '#e8dcb8'; g.fillRect(0, 0, w, h); g.fillStyle = '#2a2018'; g.textBaseline = 'middle';
      fitText(g, 'UNIT ' + this.av.empNo, w / 2, h * 0.3, w - 30, 40, `bold {s}px ${F_HAND}`);
      g.fillStyle = '#7a2a1a'; fitText(g, 'AWAITING ASSEMBLY', w / 2, h * 0.68, w - 26, 34, `bold {s}px ${F_HAND}`);
      g.beginPath(); g.fillStyle = '#1a1410'; g.arc(18, h / 2, 7, 0, TAU); g.fill();
    });
    this.tagMat = new THREE.MeshStandardMaterial({ map: tag.tex, emissiveMap: tag.tex, emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.9, side: THREE.DoubleSide });
    this.toeTag = new THREE.Group();
    const tg = this._plane(0.13, 0.065, this.tagMat, this.toeTag, 0, -0.07, 0);
    tg.material = this.tagMat;
    mesh(cyl(0.002, 0.05, 'y', 4), F.steel, this.toeTag, 0, -0.02, 0);
    this.toeTag.scale.setScalar(1 / ROBOT_SCALE);
    this.av.bones.anR.add(this.toeTag);
    this.toeTag.position.set(0.02, -0.04, -0.02);
  }
  _hangPose(b) {
    const D = this.dg, t = this.t, l = D.limb, j = D.jerk;
    if (D.mode === 'fall') return this._fallPose(b);
    if (D.mode === 'wake') return this._wakePose(b);
    const tw = j > 0.05 ? (Math.random() - 0.5) * j * 0.25 : 0;
    b.pelvis.rotation.set(0.04 + D.vx * 0.04, 0, D.vz * 0.05);
    b.spine.rotation.set(-0.07 + tw, 0, 0.02);
    b.chest.rotation.set(-0.13 + tw, 0, -0.03 + tw);
    // the head lolls: chin down in the dark, rolled to one side under the work lights (face to the camera)
    const up = this._headUp = damp(this._headUp ?? 0, this.mode === 'workshop' ? 1 : 0, 2, 1 / 60);
    b.neck.rotation.set(lerp(-0.26, -0.08, up) + l.hd[0] * 0.4, 0, lerp(0.1, 0.16, up) + l.hd[1] * 0.4);
    b.head.rotation.set(lerp(-0.34, -0.1, up) + l.hd[0] + Math.sin(t * 0.4) * 0.02, lerp(0.12, 0.05, up), lerp(0.24, 0.3, up) + l.hd[1]);
    for (const [S, s, a, g] of [['L', -1, l.aL, l.lL], ['R', 1, l.aR, l.lR]]) {
      b['sh' + S].rotation.set(0.1 + a[0], 0, s * 0.08 + a[1]);
      b['el' + S].rotation.set(0.28 + Math.max(0, a[0]) * 0.5, 0, 0);
      b['wr' + S].rotation.set(0.18, 0, -s * 0.12);
      b['hip' + S].rotation.set(0.1 + g[0], 0, s * 0.05 + g[1]);
      b['kn' + S].rotation.set(-0.32 - Math.abs(g[0]) * 0.4, 0, 0);
      b['an' + S].rotation.set(-0.55, 0, 0);
    }
    b.jaw.rotation.x = -0.05 - j * 0.12;   // slack, not gaping
    const hs = D.headless ? 1e-4 : 1, es = D.eyeless ? 1e-4 : 1;
    b.head.scale.setScalar(hs); b.eyeL.scale.setScalar(es); b.eyeR.scale.setScalar(es);
    // twitches of not-quite-life: LEDs stutter while it is being worked on
    if (j > 0.4 && Math.random() < 0.3) { const p = Math.random() * 0.8; b.ledL.scale.set(p, p, 1); b.ledR.scale.set(p, p, 1); }
  }
  _fallPose(b) {
    const t = this.t, f = this.dg.flail;
    b.pelvis.rotation.set(0.25, 0, 0); b.spine.rotation.set(0.15, 0, 0); b.chest.rotation.set(0.2, 0, 0);
    b.neck.rotation.set(0.35, 0, 0); b.head.rotation.set(0.4 + Math.sin(t * 9) * 0.15 * f, Math.sin(t * 5) * 0.3, 0);
    for (const [S, s, o] of [['L', -1, 0], ['R', 1, 1.7]]) {
      b['sh' + S].rotation.set(-2.2 + Math.sin(t * 8 + o) * 0.5 * f, 0, s * (0.7 + Math.sin(t * 6 + o) * 0.3 * f));
      b['el' + S].rotation.set(0.5 + Math.sin(t * 10 + o) * 0.4 * f, 0, 0);
      b['hip' + S].rotation.set(0.6 + Math.sin(t * 7 + o) * 0.5 * f, 0, s * 0.25);
      b['kn' + S].rotation.set(-0.9 - Math.sin(t * 9 + o) * 0.4 * f, 0, 0);
      b['an' + S].rotation.set(-0.4, 0, 0);
    }
    b.head.scale.setScalar(1); b.eyeL.scale.setScalar(1); b.eyeR.scale.setScalar(1);
  }
  _wakePose(b) {
    const w = this.wake || 0;
    const on = w > 0 ? (w < 1 ? (Math.random() < 0.55 ? Math.random() : 0) : 1) : 0;
    const p = Math.max(1e-4, on);
    b.ledL.scale.set(p, p, 1); b.ledR.scale.set(p, p, 1);
    const lid = -(1 - lerp(0.3, 0.85, clamp(w, 0, 1))) * 0.88;
    b.lidUL.rotation.x = lid; b.lidUR.rotation.x = lid;
    b.head.rotation.y += 0.35 * clamp(w - 0.6, 0, 1);
    b.head.rotation.x -= 0.15 * clamp(w - 0.6, 0, 1);
  }
  _robotPoint(kind, out = V()) {
    const b = this.av.bones;
    b.head.updateWorldMatrix(true, false);
    if (kind === 'head') return b.head.localToWorld(out.copy(HC));
    if (kind === 'face') return b.head.localToWorld(out.set(HC.x, HC.y - 0.005, HC.z - 0.1));
    if (kind === 'top') return b.head.localToWorld(out.set(HC.x, HC.y + 0.12, HC.z));
    if (kind === 'eyes') return b.head.localToWorld(out.set(0, HC.y + 0.012, HC.z - 0.105));
    if (kind === 'chest') return b.chest.localToWorld(out.set(0, 0.06, -0.13));
    if (kind === 'back') return b.chest.localToWorld(out.set(0, 0.08, 0.2));
    if (kind === 'hook') return b.chest.localToWorld(out.set(0, 0.17, 0.13));
    if (kind === 'feet') return b.anL.localToWorld(out.set(0, -0.06, 0));
    return b.spine.localToWorld(out.set(0, 0, 0));
  }
  _updateRobot(dt) {
    const D = this.dg;
    if (this.mode !== 'drop' || D.mode === 'hang') {
      D.step(dt);
      this.swing.rotation.set(D.ax, D.yaw, D.az);
    }
    this.av.update(dt, { expression: this.expr, poseFn: this._poseHang, dead: D.mode === 'wake' });
    if (D.mode === 'hang') {
      // keep the harness ring exactly on the hook
      this.swing.updateMatrixWorld(true);
      const p = this._robotPoint('hook', _v1);
      this.body.worldToLocal(p);
      const r = this.av.root.position;
      r.x -= p.x * 0.6; r.y -= p.y * 0.6; r.z -= p.z * 0.6;
    }
    this.tagMat.emissiveIntensity = damp(this.tagMat.emissiveIntensity, this.hover?.userData.act?.type === 'robot' ? 1.4 : 0.05, 10, dt);
  }

  // ============================================================================ build: outfitting arms
  _buildArms() {
    this.arms = ARM_BASE.map((b, i) => {
      const a = new RoboArm({ L1: 1.15, L2: 1.0, H0: 0.26 });
      a.root.position.copy(b);
      a.root.rotation.y = i === 0 ? PI / 2 : -PI / 2;
      this.scene.add(a.root);
      a.setRestFrom(V(b.x * 0.92, b.y + 1.05, b.z + 0.25), V(-Math.sign(b.x) * 0.3, -1, 0.2));
      a.toRest(true);
      a.side = i === 0 ? -1 : 1;
      return a;
    });
    this.sparks = new Sparks(260);
    this.scene.add(this.sparks.points);
  }

  // ============================================================================ build: hub sign panels
  _buildPanels() {
    const mk = (key, w, h, accent) => {
      const p = new HangPanel({ w, h, accent });
      this.scene.add(p.root);
      this._addHit(p.hit, { type: 'panel', key, modes: ['hub'] });
      p.on = 0;
      return p;
    };
    this.panels = {
      new: mk('new', 1.5, 0.42, PHOS.hi),
      cont: mk('cont', 1.5, 0.42, PHOS.hi),
      settings: mk('settings', 1.5, 0.42, PHOS.hi),
      trophies: mk('trophies', 1.2, 0.3, PHOS.mid),
    };
    this._refreshPanels();
  }
  _refreshPanels() {
    const P = this.panels, s = save.summary();
    P.new.setText('NEW MISSION', 'PRINT · ASSEMBLE · DISPATCH');
    P.cont.setText('CONTINUE', s ? `${LEVEL_NAME[s.level] || 'LEVEL 0'} · DAY ${s.day}/7 · ${money(s.credits)}` : 'NO RECORD ON FILE', { dim: !s });
    P.settings.setText('SETTINGS', 'CALIBRATION BAY');
    const n = Object.keys(ACHIEVEMENTS).length, got = Object.keys(ACHIEVEMENTS).filter((k) => profile.has(k)).length;
    P.trophies.setText('COMMENDATIONS', `${got} / ${n} EARNED`);
  }

  // ============================================================================ build: dispatch console (NEW MISSION)
  _buildDispatch() {
    const F = this.F;
    const g = (this.dispatch = new THREE.Group());
    g.position.set(-2.55, 0, 2.15); g.rotation.y = -0.85;
    this.scene.add(g);
    const B = new Batch();
    B.box(1.1, 0.95, 0.6, F.cabinet, 0, 0.475, 0, 0, 0, 0, 0.02);
    B.box(1.14, 0.06, 0.72, F.dark, 0, 0.98, 0.05, TILT, 0, 0);
    B.box(0.5, 0.42, 0.36, F.cabinet, -0.22, 1.22, -0.16, 0, 0, 0, 0.03);
    B.box(1.14, 0.04, 0.64, F.hazard, 0, 0.02, 0.0);
    B.build(g);
    this.dCrt = this._tex(512, 384);
    const crt = this._plane(0.4, 0.3, this._basicTexMat(this.dCrt.tex), g, -0.22, 1.24, 0.025);
    void crt;
    // lever
    this.lever = new THREE.Group(); this.lever.position.set(0.3, 1.02, 0.08); g.add(this.lever);
    mesh(cyl(0.05, 0.12, 'x', 16), F.dark, g, 0.3, 1.02, 0.08);
    this.leverArm = new THREE.Group(); this.lever.add(this.leverArm);
    mesh(cyl(0.014, 0.42, 'y', 10).translate(0, 0.21, 0), F.chrome, this.leverArm);
    const knob = mesh(new THREE.SphereGeometry(0.045, 16, 12), F.redPaint, this.leverArm, 0, 0.43, 0);
    this.leverA = -0.5; this.leverT = -0.5; this.leverArm.rotation.x = -0.5;
    this._addHit(mesh(new THREE.BoxGeometry(0.16, 0.55, 0.2), new THREE.MeshBasicMaterial({ visible: false }), this.leverArm, 0, 0.27, 0), { type: 'lever', modes: ['dispatch'] });
    void knob;
    // big mushroom button under a guard
    const btn = mesh(cyl(0.055, 0.04, 'y', 20), F.redPaint, g, -0.05, 1.03, 0.16, TILT, 0, 0);
    this._addHit(btn, { type: 'lever', modes: ['dispatch'] });
    mesh(cyl(0.075, 0.02, 'y', 20), F.yellow, g, -0.05, 1.005, 0.155, TILT, 0, 0);
    // destination selector
    this.destSel = new Selector(3, 0.045);
    this.destSel.root.position.set(-0.38, 1.0, 0.18); this.destSel.root.rotation.x = -PI / 2 + TILT; g.add(this.destSel.root);
    this._addHit(this.destSel.hit, { type: 'dest', modes: ['dispatch'] });
    this.destSel.set(Math.max(0, DESTS.indexOf(profile.settings.destination || 'yellow')));
    const lab = this._tex(256, 96, (x, w, h) => { x.fillStyle = '#1b1d1a'; x.fillRect(0, 0, w, h); x.fillStyle = '#d8c79a'; x.textBaseline = 'middle'; fitText(x, 'L0   L37   L1.1', w / 2, h * 0.35, w - 20, 34, `{s}px ${F_MARK}`); x.fillStyle = '#8a8060'; fitText(x, 'DESTINATION', w / 2, h * 0.75, w - 20, 26, `{s}px ${F_TYPE}`); });
    this._plane(0.2, 0.075, new THREE.MeshStandardMaterial({ map: lab.tex, roughness: 0.8 }), g, -0.38, 0.985, 0.3, -PI / 2 + TILT, 0, 0);
    this._drawDispatchCrt();
  }
  _drawDispatchCrt(msg = '') {
    const d = profile.settings.destination || 'yellow';
    this.dCrt.draw((x, w, h) => {
      phosphorBg(x, w, h);
      brackets(x, 10, 10, w - 20, h - 20, 34, PHOS.mid, 3, 8);
      x.fillStyle = PHOS.hi; x.shadowColor = PHOS.mid; x.shadowBlur = 10; x.textBaseline = 'top'; x.font = `34px ${F_CRT}`;
      x.fillText('R.O.O.M. DISPATCH', 28, 22);
      x.fillRect(28, 64, w - 56, 2);
      x.font = `28px ${F_CRT}`; x.fillStyle = PHOS.mid;
      const L = [`UNIT ....... #${this.av.empNo}`, `NAME ....... ${(profile.name || '').toUpperCase()}`, `DEST ....... ${LEVEL_NAME[d] || d.toUpperCase()}`, 'STATUS ..... NOT ALIVE YET'];
      L.forEach((s, i) => x.fillText(s, 28, 82 + i * 40));
      x.fillStyle = PHOS.hi; x.font = `30px ${F_CRT}`;
      x.fillText((msg || '> PULL LEVER TO DISPATCH') + ((Date.now() / 500 | 0) % 2 ? '_' : ''), 28, 262);
      x.shadowBlur = 0; scanlines(x, w, h, 0.28);
    });
  }

  // ============================================================================ build: continue crates
  _buildContinue() {
    const g = (this.contG = new THREE.Group());
    g.position.set(3.1, 0, 2.3); g.rotation.y = 0.55;
    this.scene.add(g);
    const B = new Batch();
    B.box(2.3, 0.12, 0.95, this.F.wood, 0, 0.06, 0);
    B.build(g);
    this.crates = [-0.76, 0, 0.76].map((x, i) => {
      const c = new Crate(0.62, 0.46, 0.5);
      c.root.position.set(x, 0.12, 0); c.root.rotation.y = rnd(-0.06, 0.06);
      g.add(c.root);
      c.idx = i;
      c.hit = this._addHit(mesh(new THREE.BoxGeometry(0.66, 0.6, 0.54), new THREE.MeshBasicMaterial({ visible: false }), c.root, 0, 0.3, 0), { type: 'crate', i, modes: ['continue'] });
      c.contents = new THREE.Group(); c.root.add(c.contents);
      c.onLand = () => this._sfx('impact_wood', { pos: c.root.getWorldPosition(V()), volume: 0.5 });
      return c;
    });
    // hazard tape (no save)
    this.tape = new THREE.Group(); g.add(this.tape);
    const tm = new THREE.MeshStandardMaterial({ map: this.F.hazardTex, roughness: 0.6, side: THREE.DoubleSide });
    for (const s of [-1, 1]) this._plane(0.86, 0.07, tm, this.tape, 0, 0.62, 0.27, 0, 0, s * 0.62).material = tm;
    this._plane(0.08, 0.6, tm, this.tape, 0, 0.6, -0.0, -PI / 2, 0, PI / 2).material = tm;
    this._contentsBuilt = false;
  }
  _fillCrates() {
    const s = save.summary();
    this.hasSave = !!s;
    for (const c of this.crates) { c.contents.clear(); c.closeLid(); c.root.visible = true; }
    this.tape.visible = !s;
    const label = (t1, t2) => this._tex(512, 220, (x, w, h) => {
      x.clearRect(0, 0, w, h); x.fillStyle = 'rgba(22,16,10,0.85)'; x.textBaseline = 'middle';
      fitText(x, t1, w / 2, h * 0.38, w - 40, 96, `{s}px ${F_MARK}`);
      x.font = `44px ${F_MARK}`; fitText(x, t2, w / 2, h * 0.78, w - 40, 48, `{s}px ${F_MARK}`);
    }).tex;
    if (!s) {
      this.crates[0].root.visible = false; this.crates[2].root.visible = false;
      this.crates[1].setLabel(label('NO RECORD', 'NOTHING TO CONTINUE'));
      return;
    }
    const [c1, c2, c3] = this.crates;
    c1.setLabel(label('FUNDS', money(s.credits)));
    c2.setLabel(label('INVENTORY', `${s.inventory.length + s.stash.length} ITEMS`));
    c3.setLabel(label('RECORDS', `DAY ${s.day} / 7`));
    // cash bundles + a value tag
    const n = clamp(Math.ceil((s.credits || 0) / 250), 1, 9);
    for (let i = 0; i < n; i++) {
      const b = mesh(rbox(0.17, 0.04, 0.08, 0.004), this.F.cash, c1.contents, -0.15 + (i % 3) * 0.15, 0.3 + Math.floor(i / 3) * 0.042, -0.08 + ((i * 7) % 3) * 0.08, 0, rnd(-0.2, 0.2), 0);
      void b;
    }
    const tag = this._tex(256, 128, (x, w, h) => { x.fillStyle = '#efe3bf'; x.fillRect(0, 0, w, h); x.fillStyle = '#1e1a12'; x.textBaseline = 'middle'; fitText(x, money(s.credits), w / 2, h * 0.45, w - 30, 64, `bold {s}px ${F_HAND}`); x.fillStyle = '#7a2a1a'; fitText(x, 'TEAM FUNDS', w / 2, h * 0.82, w - 30, 30, `{s}px ${F_TYPE}`); });
    this.cashTag = new THREE.Group(); this.cashTag.position.set(0.12, 0.55, 0.12); c1.contents.add(this.cashTag);
    this._plane(0.16, 0.08, new THREE.MeshStandardMaterial({ map: tag.tex, roughness: 0.9, side: THREE.DoubleSide }), this.cashTag, 0, -0.06, 0);
    mesh(cyl(0.0015, 0.05, 'y', 4), this.F.steel, this.cashTag, 0, -0.005, 0);
    // inventory items
    const items = [...s.inventory, ...s.stash].slice(0, 6);
    items.forEach((type, i) => {
      try {
        const m = buildModel(type, { seed: i + 1 });
        const o = m.object;
        const box = new THREE.Box3().setFromObject(o), sz = box.getSize(V()), k = 0.2 / Math.max(0.05, sz.x, sz.y, sz.z);
        o.scale.multiplyScalar(k);
        const wrap = new THREE.Group(); wrap.add(o);
        const ctr = box.getCenter(V()).multiplyScalar(k); o.position.sub(ctr);
        wrap.position.set(-0.16 + (i % 3) * 0.16, 0.36 + Math.floor(i / 3) * 0.06, -0.08 + Math.floor(i / 3) * 0.14);
        wrap.rotation.set(rnd(-0.4, 0.4), rnd(0, TAU), rnd(-0.3, 0.3));
        c2.contents.add(wrap);
      } catch (e) { console.warn('[menu] crate item', type, e); }
    });
    // the run manifest: a green holographic projection rising out of the records crate, stamped for continuation
    const un = Object.keys(s.unlocks || {}).filter((k) => s.unlocks[k]);
    const doc = this._tex(512, 640, (x, w, h) => {
      x.clearRect(0, 0, w, h);
      x.fillStyle = 'rgba(30,140,60,0.10)'; x.fillRect(0, 0, w, h);
      brackets(x, 10, 10, w - 20, h - 20, 40, PHOS.mid, 4, 12);
      x.fillStyle = PHOS.hi; x.shadowColor = PHOS.mid; x.shadowBlur = 12; x.textBaseline = 'top';
      x.font = `40px ${F_CRT}`; x.fillText('RUN MANIFEST', 34, 30);
      x.fillRect(34, 78, w - 68, 2);
      x.font = `30px ${F_CRT}`;
      const rows = [['DIMENSION', LEVEL_NAME[s.level] || s.level], ['DAY', `${s.day} OF 7`], ['FUNDS', money(s.credits)], ['POCKETS', `${s.inventory.length} ITEMS`], ['STASH', `${s.stash.length} ITEMS`], ['UNLOCKS', un.length ? un.slice(0, 2).join(', ').toUpperCase() : 'NONE']];
      rows.forEach(([a2, b2], i) => { x.fillStyle = PHOS.mid; x.fillText(a2, 34, 96 + i * 42); x.fillStyle = PHOS.hi; x.textAlign = 'right'; x.fillText(String(b2), w - 34, 96 + i * 42); x.textAlign = 'left'; });
      const esc = clamp(s.escape || 0, 0, 1);
      x.fillStyle = PHOS.mid; x.fillText('ESCAPE', 34, 362);
      for (let i = 0; i < 20; i++) { x.fillStyle = i / 20 < esc ? PHOS.hi : PHOS.dim; x.fillRect(34 + i * 22, 402, 18, 22); }
      x.save(); x.translate(w * 0.52, h * 0.82); x.rotate(-0.16);
      x.strokeStyle = PHOS.hi; x.lineWidth = 5; x.strokeRect(-190, -50, 380, 100);
      x.fillStyle = PHOS.hi; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = `48px ${F_CRT}`; x.fillText('APPROVED', 0, -14); x.font = `24px ${F_CRT}`; x.fillText('FOR CONTINUATION', 0, 26);
      x.restore();
      x.shadowBlur = 0; x.fillStyle = 'rgba(0,0,0,0.35)'; for (let y = 0; y < h; y += 4) x.fillRect(0, y, w, 2);
    });
    const holo = new THREE.Group(); holo.position.set(0, 0.86, 0.02); c3.contents.add(holo);
    this.holoMat = new THREE.MeshBasicMaterial({ map: doc.tex, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, color: new THREE.Color(1.6, 1.8, 1.6) });
    this._plane(0.4, 0.5, this.holoMat, holo, 0, 0, 0);
    const beam = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.08, 0.4, 0.16), transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const cone = mesh(new THREE.ConeGeometry(0.2, 0.36, 24, 1, true), beam, c3.contents, 0, 0.49, 0.0, PI, 0, 0); cone.castShadow = false;
    mesh(cyl(0.05, 0.03, 'y', 18), this.F.dark, c3.contents, 0, 0.29, 0);
    mesh(new THREE.CircleGeometry(0.04, 18), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.6, 0.8) }), c3.contents, 0, 0.306, 0, -PI / 2).castShadow = false;
    this.holo = holo; holo.scale.setScalar(0.01);
  }

  // ============================================================================ build: settings cabinet
  _buildSettings() {
    const F = this.F;
    const g = (this.setG = new THREE.Group());
    g.position.set(-5.6, 0, -1.2); g.rotation.y = PI / 2 - 0.25;
    this.scene.add(g);
    const W = 1.5, H = 1.1;
    const B = new Batch();
    B.box(W + 0.1, H + 0.1, 0.32, F.cabinet, 0, 1.45, -0.16, 0, 0, 0, 0.02);
    B.box(0.12, 0.92, 0.12, F.beam, -0.6, 0.46, -0.16); B.box(0.12, 0.92, 0.12, F.beam, 0.6, 0.46, -0.16);
    B.build(g);
    this.setFace = this._tex(1024, 752);
    this._plane(W, H, new THREE.MeshStandardMaterial({ map: this.setFace.tex, roughness: 0.7, metalness: 0.2 }), g, 0, 1.45, 0.002);
    this.crt = this._tex(512, 384);
    this._plane(0.46, 0.34, this._basicTexMat(this.crt.tex), g, -0.47, 1.73, 0.01);
    const s = profile.settings;
    // controls: [key, type, x, y, label, min, max]
    const defs = [
      ['master', 'knob', -0.08, 1.83, 'MASTER', 0, 1], ['sfx', 'knob', 0.17, 1.83, 'EFFECTS', 0, 1], ['music', 'knob', 0.42, 1.83, 'MUSIC', 0, 1],
      ['ambient', 'knob', -0.08, 1.5, 'AMBIENCE', 0, 1], ['voice', 'knob', 0.17, 1.5, 'VOICE CHAT', 0, 1.5],
      ['invertY', 'toggle', 0.42, 1.5, 'INVERT Y'],
      ['healthityVoice', 'toggle', 0.62, 1.5, 'HEALTHITY'],
      ['sensitivity', 'fader', -0.42, 1.16, 'LOOK SENSITIVITY', 0.2, 3],
      ['quality', 'sel', 0.15, 1.16, 'GRAPHICS', ['low', 'medium', 'high']],
      ['voiceMode', 'sel', 0.5, 1.16, 'MICROPHONE', ['open', 'ptt', 'off']],
    ];
    this.ctls = [];
    for (const [key, type, x, y, label, a, b] of defs) {
      let o;
      if (type === 'knob') o = new Knob(0.05);
      else if (type === 'fader') o = new Fader(0.5);
      else if (type === 'toggle') o = new Toggle();
      else o = new Selector(3, 0.04);
      o.root.position.set(x, y, 0.004); g.add(o.root);
      const c = { key, type, o, x, y, label, min: a, max: b, opts: type === 'sel' ? a : null };
      if (type === 'sel') { c.min = 0; c.max = 2; }
      this._addHit(o.hit, { type: 'ctl', c, modes: ['settings'] });
      if (o.pad) this._addHit(o.pad, { type: 'ctl', c, modes: ['settings'] });
      if (o.track) this._addHit(o.track, { type: 'ctl', c, modes: ['settings'] });
      this.ctls.push(c);
    }
    this._syncControls(true);
    this._drawSettingsFace();
    this.activeCtl = this.ctls[0];
    this._drawCrt();
    void s;
  }
  _ctlValue(c) {
    const s = profile.settings;
    if (c.key === 'quality') return Math.max(0, c.opts.indexOf(engine.qualityName || s.quality));
    if (c.key === 'voiceMode') return Math.max(0, c.opts.indexOf(s.voiceMode || 'open'));
    if (c.key === 'healthityVoice') return s.healthityVoice !== false;
    if (c.key === 'invertY') return !!s.invertY;
    return s[c.key] ?? 1;
  }
  _syncControls() {
    for (const c of this.ctls) {
      const v = this._ctlValue(c);
      if (c.type === 'knob' || c.type === 'fader') c.o.set((v - c.min) / (c.max - c.min));
      else if (c.type === 'toggle') c.o.set(v);
      else c.o.set(v);
    }
  }
  _drawSettingsFace() {
    this.setFace.draw((x, w, h) => {
      x.fillStyle = '#4b554e'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`; x.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 30, 1 + Math.random() * 3); }
      x.strokeStyle = '#2c332e'; x.lineWidth = 8; x.strokeRect(10, 10, w - 20, h - 20);
      x.fillStyle = '#e9dcb2'; x.textBaseline = 'middle';
      fitText(x, 'CALIBRATION BAY · CLONE PERIPHERALS', w * 0.68, 42, w * 0.6, 34, `{s}px ${F_SIGN}`);
      const px = (X) => (X / 1.5 + 0.5) * w, py = (Y) => (1 - ((Y - 1.45) / 1.1 + 0.5)) * h;
      for (const c of this.ctls) {
        const cx = px(c.x), cy = py(c.y);
        x.fillStyle = '#e9dcb2';
        if (c.type === 'knob') {
          fitText(x, c.label, cx, cy + 62, 140, 22, `{s}px ${F_TYPE}`);
          x.strokeStyle = '#e9dcb2'; x.lineWidth = 2;
          for (let i = 0; i <= 10; i++) { const a = -PI / 2 - 2.35 + (4.7 * i) / 10; const r0 = 44, r1 = i % 5 ? 50 : 56; x.beginPath(); x.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); x.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); x.stroke(); }
        } else if (c.type === 'fader') {
          fitText(x, c.label, cx, cy - 52, 300, 22, `{s}px ${F_TYPE}`);
          x.font = `20px ${F_HAND}`; x.textAlign = 'left'; x.fillText('SLOW', cx - 170, cy + 44); x.textAlign = 'right'; x.fillText('FAST', cx + 170, cy + 44);
        } else if (c.type === 'toggle') {
          fitText(x, c.label, cx, cy + 60, 180, 22, `{s}px ${F_TYPE}`);
          x.font = `20px ${F_HAND}`; x.textAlign = 'center'; x.fillText('ON', cx, cy - 58);
        } else {
          fitText(x, c.label, cx, cy + 62, 200, 22, `{s}px ${F_TYPE}`);
          x.font = `18px ${F_TYPE}`; x.textAlign = 'center';
          const SH = { low: 'LO', medium: 'MED', high: 'HI', open: 'OPEN', ptt: 'PTT', off: 'OFF' };
          c.opts.forEach((o, i) => { const a = -PI / 2 - 0.9 + 0.9 * i; x.fillText(SH[o] || o.toUpperCase(), cx + Math.cos(a) * 64, cy + Math.sin(a) * 50); });
        }
      }
      x.fillStyle = 'rgba(20,20,20,0.6)'; for (const [X, Y] of [[24, 24], [w - 24, 24], [24, h - 24], [w - 24, h - 24]]) { x.beginPath(); x.arc(X, Y, 9, 0, TAU); x.fill(); }
    });
  }
  _fmt(c) {
    const v = this._ctlValue(c);
    if (c.type === 'toggle') return v ? 'ON' : 'OFF';
    if (c.type === 'sel') return c.opts[v].toUpperCase();
    if (c.key === 'sensitivity') return v.toFixed(2) + 'x';
    return Math.round(v * 100) + '%';
  }
  _drawCrt() {
    const a = this.activeCtl;
    this.crt.draw((x, w, h) => {
      phosphorBg(x, w, h);
      brackets(x, 8, 8, w - 16, h - 16, 28, PHOS.mid, 3, 8);
      x.fillStyle = PHOS.hi; x.shadowColor = PHOS.mid; x.shadowBlur = 8; x.textBaseline = 'top'; x.font = `26px ${F_CRT}`;
      x.fillText('> ' + (a ? a.label : 'SELECT A CONTROL'), 20, 18);
      if (a) {
        x.font = `60px ${F_CRT}`; x.fillText(this._fmt(a), 20, 44);
        if (a.type === 'knob' || a.type === 'fader') { const k = clamp((this._ctlValue(a) - a.min) / (a.max - a.min), 0, 1), n = 24; for (let i = 0; i < n; i++) { x.fillStyle = i / n < k ? PHOS.hi : PHOS.dim; x.fillRect(20 + i * ((w - 40) / n), 116, (w - 40) / n - 4, 18); } }
      }
      x.fillStyle = PHOS.dim; x.fillRect(20, 146, w - 40, 2);
      x.font = `22px ${F_CRT}`;
      this.ctls.forEach((c, i) => { x.fillStyle = c === a ? PHOS.soft : PHOS.mid; x.fillText(`${c.label.slice(0, 11).padEnd(12, '.')}${this._fmt(c)}`, 20 + (i % 2) * 240, 160 + Math.floor(i / 2) * 40); });
      x.shadowBlur = 0; scanlines(x, w, h, 0.3);
    });
  }
  _applySetting(c, v, commit = false) {
    let raw;
    if (c.type === 'toggle') raw = String(!!v);
    else if (c.type === 'sel') raw = c.opts[v];
    else { const st = c.key === 'sensitivity' ? 0.05 : 0.05; raw = String(Math.round(clamp(v, c.min, c.max) / st) * st); }
    if (c.key === 'quality' && (!commit || raw === engine.qualityName)) return;
    const ui = this.game.ui;
    try {
      if (ui?._setting) ui._setting(c.key, raw);
      else { profile.settings[c.key] = c.type === 'toggle' ? v : c.type === 'sel' ? raw : parseFloat(raw); profile.save(); }
      const el = document.querySelector(`[data-set="${c.key}"]`); if (el) el.value = raw;
    } catch (e) { console.warn('[menu] setting', c.key, e); }
  }

  // ============================================================================ build: commendations wall
  _buildTrophies() {
    const g = (this.troG = new THREE.Group());
    g.position.set(5.2, 0, -6.6); g.rotation.y = -0.3;
    this.scene.add(g);
    this.troBoard = mesh(rbox(4.4, 3.2, 0.08, 0.02), this.F.gunmetal, g, 0, 2.3, -0.05);
    mesh(new THREE.BoxGeometry(6, 5, 0.2), this.F.wall, g, 0, 2.5, -0.2);
    this.troHead = this._tex(1024, 128);
    this.troHeadM = this._plane(2.6, 0.32, this._emTexMat(this.troHead.tex, 0.8), g, 0, 3.98, 0.0);
    this.plaques = [];
    this._rewardMap = {};
    for (const [cat, list] of Object.entries(COSMETICS)) for (const o of list) if (o.unlock) (this._rewardMap[o.unlock] ||= []).push({ cat, name: o.name });
    for (const id of Object.keys(ACHIEVEMENTS)) {
      const p = { id, g: new THREE.Group(), tex: this._tex(384, 232) };
      p.mat = new THREE.MeshStandardMaterial({ map: p.tex.tex, emissiveMap: p.tex.tex, emissive: 0xffffff, emissiveIntensity: 0.0, roughness: 0.18, metalness: 0.1 });
      p.face = this._plane(0.5, 0.3, p.mat, p.g, 0, 0, 0.012);
      p.back = mesh(rbox(0.54, 0.34, 0.02, 0.006), this.F.brass, p.g, 0, 0, 0);
      p.lamp = mesh(new THREE.BoxGeometry(0.3, 0.012, 0.012), this.F.ledOff, p.g, 0, 0.2, 0.03);
      p.lamp.castShadow = false;
      this._addHit(p.face, { type: 'plaque', p, modes: ['trophies', 'plaque'] });
      g.add(p.g);
      this.plaques.push(p);
    }
    this._drawPlaques();
  }
  _drawPlaques() {
    const ids = Object.keys(ACHIEVEMENTS), got = ids.filter((k) => profile.has(k)).length;
    this.troHead.draw((x, w, h) => { phosphorBg(x, w, h); brackets(x, 8, 8, w - 16, h - 16, 30, PHOS.mid, 3, 8); x.fillStyle = PHOS.hi; x.shadowColor = PHOS.mid; x.shadowBlur = 16; x.textBaseline = 'middle'; fitText(x, `COMMENDATIONS · ${got} / ${ids.length}`, w / 2, h / 2, w - 80, 72, `{s}px ${F_SIGN}`); x.shadowBlur = 0; scanlines(x, w, h, 0.25); });
    for (const p of this.plaques) {
      const A = ACHIEVEMENTS[p.id], on = profile.has(p.id), rw = this._rewardMap[p.id] || [];
      p.on = on;
      p.back.material = on ? this.F.brass : this.F.gunmetal;
      p.lamp.material = on ? this.F.glowAmber : this.F.ledOff;
      p.mat.emissiveIntensity = on ? 1.1 : 0.75;
      p.tex.draw((x, w, h) => {
        phosphorBg(x, w, h);
        const c1 = on ? PHOS.hi : '#5aa86e', c2 = on ? PHOS.mid : '#3f8a55';
        brackets(x, 8, 8, w - 16, h - 16, 24, c2, 3, on ? 8 : 0);
        x.shadowColor = PHOS.mid; x.shadowBlur = on ? 10 : 0; x.textBaseline = 'top';
        x.fillStyle = c1; fitText(x, A.name.toUpperCase(), w / 2, 18, w - 40, 30, `{s}px ${F_CRT}`);
        x.fillStyle = c2; x.fillRect(24, 54, w - 48, 2);
        x.font = `20px ${F_MONO}`; x.fillStyle = c2; x.textAlign = 'center';
        wrapLines(x, A.desc, w - 48).slice(0, 3).forEach((l, i) => x.fillText(l, w / 2, 64 + i * 24));
        if (rw.length) {
          x.fillStyle = on ? PHOS.soft : '#3c7a4c'; x.font = `22px ${F_CRT}`;
          wrapLines(x, '\u25B8 SPECIAL ISSUE: ' + rw.map((r) => r.name.toUpperCase()).join(', '), w - 40).slice(0, 2).forEach((l, i) => x.fillText(l, w / 2, 152 + i * 24));
        }
        if (!on) {
          for (let i = 0; i < 260; i++) { x.fillStyle = `rgba(90,200,120,${Math.random() * 0.08})`; x.fillRect(Math.random() * w, Math.random() * h, 2, 1); }
          x.save(); x.translate(w - 70, h - 34); x.rotate(-0.12); x.strokeStyle = '#3c7a4c'; x.lineWidth = 2; x.strokeRect(-58, -16, 116, 32); x.fillStyle = '#3c7a4c'; x.font = `22px ${F_CRT}`; x.textBaseline = 'middle'; x.fillText('CLASSIFIED', 0, 1); x.restore();
        }
        x.shadowBlur = 0; scanlines(x, w, h, 0.3);
      });
    }
  }

  // ============================================================================ build: workshop parts board
  _buildRack() {
    const g = (this.rack = new THREE.Group());
    this.scene.add(g);
    this.rackInner = new THREE.Group(); g.add(this.rackInner);
    this.rackBoard = mesh(rbox(1, 1, 0.05, 0.015), this.F.gunmetal, this.rackInner, 0, 0, -0.03);
    this.rackHead = this._tex(1024, 160);
    this.rackHeadM = this._plane(1, 0.16, this._emTexMat(this.rackHead.tex, 1.0), this.rackInner, 0, 0, 0.005);
    const arrowG = new THREE.ConeGeometry(0.06, 0.11, 3); arrowG.rotateZ(-PI / 2);
    this.arrowMat = new THREE.MeshStandardMaterial({ color: 0x08200e, emissive: 0x5cf07e, emissiveIntensity: 0.6, roughness: 0.4 });
    this.arrows = [-1, 1].map((s) => {
      const m = mesh(arrowG, this.arrowMat, this.rackInner, 0, 0, 0.02, 0, 0, s < 0 ? PI : 0);
      this._addHit(m, { type: 'arrow', dir: s, modes: ['workshop'] });
      const pad = mesh(new THREE.BoxGeometry(0.2, 0.2, 0.08), new THREE.MeshBasicMaterial({ visible: false }), m, 0, 0, 0);
      this._addHit(pad, { type: 'arrow', dir: s, modes: ['workshop'] });
      return m;
    });
    this.cells = [];
    this.itemCache = new Map();
    this.flip = null;
    this.rack.visible = false;
  }
  _fillRack() {
    const sec = SECTIONS[this.secIdx], list = COSMETICS[sec.cat] || [];
    for (const c of this.cells) { this._removeHit(c.hit); c.g.removeFromParent(); }
    this.cells = [];
    const L = this._rackLayout(list.length);
    this.rackBoard.scale.set(L.w, L.h, 1);
    this.rackBoard.position.set(0, -0.06, -0.03);
    this.rackHeadM.position.set(0, L.h / 2 + 0.06, 0.006); this.rackHeadM.scale.set(L.w, 1, 1);
    this.arrows[0].position.set(-L.w / 2 + 0.07, L.h / 2 + 0.06, 0.04); this.arrows[1].position.set(L.w / 2 - 0.07, L.h / 2 + 0.06, 0.04);
    this.rackHead.draw((x, w, h) => {
      phosphorBg(x, w, h);
      brackets(x, 150, 10, w - 300, h - 20, 26, PHOS.mid, 3, 8);
      x.fillStyle = PHOS.hi; x.shadowColor = PHOS.mid; x.shadowBlur = 16; x.textBaseline = 'middle';
      fitText(x, sec.title, w / 2, h * 0.4, w - 340, 80, `{s}px ${F_SIGN}`);
      x.shadowBlur = 6; x.fillStyle = PHOS.mid;
      fitText(x, `${String(this.secIdx + 1).padStart(2, '0')}/${SECTIONS.length} · ${sec.sub} · SWIPE ◄ ►`, w / 2, h * 0.8, w - 340, 34, `{s}px ${F_CRT}`);
      x.shadowBlur = 0; scanlines(x, w, h, 0.25);
    });
    const cur = this.cos[sec.cat];
    list.forEach((o, i) => {
      const col = i % L.cols, row = Math.floor(i / L.cols);
      const c = { o, cat: sec.cat, g: new THREE.Group(), i };
      c.g.position.set(-L.w / 2 + 0.05 + L.cell * (col + 0.5), L.h / 2 - 0.08 - L.cell * (row + 0.5), 0);
      this.rackInner.add(c.g);
      const ok = unlocked(o);
      c.ok = ok;
      // cubby backing + label
      mesh(new THREE.BoxGeometry(L.cell - 0.02, L.cell - 0.02, 0.01), this.F.dark, c.g, 0, 0, -0.002);
      c.lamp = mesh(new THREE.BoxGeometry(L.cell - 0.06, 0.008, 0.008), this.F.ledOff, c.g, 0, L.cell / 2 - 0.02, 0.01);
      c.lamp.castShadow = false;
      const lab = this._tex(256, 64, (x, w, h) => {
        x.fillStyle = ok ? '#151310' : '#1a0d0a'; x.fillRect(0, 0, w, h);
        x.fillStyle = ok ? '#e8d4a8' : '#c04a3a'; x.textBaseline = 'middle';
        fitText(x, ok ? o.name.toUpperCase() : 'LOCKED', w / 2, h * (ok ? 0.5 : 0.32), w - 12, 30, `{s}px ${F_MARK}`);
        if (!ok) { x.fillStyle = '#a07050'; fitText(x, (ACHIEVEMENTS[o.unlock]?.name || o.unlock).toUpperCase(), w / 2, h * 0.74, w - 12, 22, `bold {s}px ${F_HAND}`); }
      });
      c.label = this._plane(L.cell - 0.03, (L.cell - 0.03) / 4, this._emTexMat(lab.tex, 0.55), c.g, 0, -L.cell / 2 + (L.cell - 0.03) / 8 + 0.01, 0.012);
      c.item = this._itemFor(sec.cat, o, L.cell * 0.7);
      c.item.position.set(0, 0.02, 0.07);
      c.g.add(c.item);
      if (!ok) this._lockLook(c);
      c.hit = this._addHit(mesh(new THREE.BoxGeometry(L.cell - 0.01, L.cell - 0.01, 0.12), new THREE.MeshBasicMaterial({ visible: false }), c.g, 0, 0, 0.06), { type: 'item', c, modes: ['workshop'] });
      c.sel = o.id === cur;
      c.spin = rnd(0, TAU);
      this.cells.push(c);
    });
  }
  _rackLayout(n) {
    const portrait = this.aspect < 1.05;
    const cols = n <= 4 ? 2 : n <= 9 ? 3 : portrait ? 3 : 4;
    const rows = Math.ceil(n / cols);
    const cell = portrait ? 0.4 : 0.31;
    return { cols, rows, cell, w: cols * cell + 0.1, h: rows * cell + 0.12 };
  }
  _lockLook(c) {
    const dark = this._darkMat || (this._darkMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.5, metalness: 0.7 }));
    c.item.traverse((m) => { if (m.isMesh) m.material = dark; });
    const lk = new THREE.Group(); lk.position.set(0.0, 0.0, 0.14); c.g.add(lk);
    mesh(rbox(0.06, 0.05, 0.02, 0.006), this.F.brass, lk, 0, -0.01, 0);
    mesh(new THREE.TorusGeometry(0.018, 0.005, 6, 12, PI), this.F.steel, lk, 0, 0.015, 0);
  }

  // 3D representations of every option, normalised to `size`
  _itemFor(cat, o, size) {
    const key = cat + ':' + o.id + ':' + (cat === 'face' ? this.cos.frame : '');
    let src = this.itemCache.get(key);
    if (!src) { src = this._buildItem(cat, o); this.itemCache.set(key, src); }
    const g = src.clone(true);
    const box = new THREE.Box3().setFromObject(g), sz = box.getSize(V()), k = size / Math.max(0.01, sz.x, sz.y, sz.z * 0.8);
    const w = new THREE.Group();
    g.scale.multiplyScalar(k); g.position.copy(box.getCenter(V()).multiplyScalar(-k));
    w.add(g);
    return w;
  }
  _buildItem(cat, o) {
    const F = this.F, g = new THREE.Group();
    const cos = resolveCos({ ...this.cos, [cat]: o.id });
    const shell = RM.shell(SKIN_TONE[cos.skin] ?? 0xe0d2b0);
    const suitMat = (id, e) => cached2('suit_' + id, () => new THREE.MeshStandardMaterial({ color: e?.color ?? 0xf3c010, roughness: e?.gloss ? 0.3 : 0.8, metalness: e?.gloss ? 0.75 : 0.02 }));
    const noneSign = () => { const m = new THREE.MeshStandardMaterial({ color: 0x401010, emissive: 0xff2010, emissiveIntensity: 0.6 }); for (const r of [PI / 4, -PI / 4]) mesh(new THREE.BoxGeometry(0.5, 0.08, 0.04), m, g, 0, 0, 0, 0, 0, r); };
    const partGeo = (k, build) => {
      const P = getPart(k, build);
      for (const [mat, geo] of P.geos) {
        const mm = mat === 'suit' ? suitMat(cos.suit, cos.suitEntry) : robotMaterial(mat, cos);
        const m = new THREE.Mesh(geo, mm); m.castShadow = true; g.add(m);
      }
    };
    switch (cat) {
      case 'frame': {
        const prof = o.id === 'masc' ? [[0.0, 0], [0.13, 0.02], [0.14, 0.1], [0.15, 0.25], [0.22, 0.42], [0.2, 0.5], [0.08, 0.55], [0.06, 0.62]] : o.id === 'fem' ? [[0.0, 0], [0.16, 0.02], [0.17, 0.1], [0.12, 0.25], [0.16, 0.42], [0.15, 0.5], [0.06, 0.55], [0.05, 0.62]] : [[0.0, 0], [0.14, 0.02], [0.15, 0.1], [0.14, 0.25], [0.18, 0.42], [0.17, 0.5], [0.07, 0.55], [0.055, 0.62]];
        const lg = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 20); lg.scale(1, 1, 0.62);
        mesh(lg, shell, g); mesh(cyl(0.02, 0.5, 'y', 8), F.steel, g, 0, -0.2, 0); mesh(new THREE.BoxGeometry(0.3, 0.04, 0.2), F.dark, g, 0, -0.45, 0);
        break;
      }
      case 'skull': {
        const s = o.s || [1, 1, 1];
        const h = mesh(new THREE.SphereGeometry(0.2, 26, 18), shell, g); h.scale.set(0.79 * s[0], 1.05 * s[1], s[2]);
        const j = o.jaw || [1, 1, 1];
        mesh(new THREE.SphereGeometry(0.12, 16, 10, 0, TAU, PI / 2, PI / 2), shell, g, 0, -0.08 * s[1], -0.04).scale.set(1.05 * j[0] * s[0], 0.9 * j[1], 1.2 * j[2]);
        for (const e of [-1, 1]) mesh(new THREE.SphereGeometry(0.022, 10, 8), this._eyeMat(DEFAULT_IRIS), g, e * 0.06 * s[0], 0.03, -0.19 * s[2]);
        mesh(cyl(0.05, 0.12, 'y', 10), F.steel, g, 0, -0.24 * s[1], 0);
        break;
      }
      case 'build': {
        const k = { std: [1, 1], slim: [0.8, 1], stocky: [1.25, 0.9], tall: [0.92, 1.18], heavy: [1.5, 0.95] }[o.id] || [1, 1];
        mesh(new THREE.CapsuleGeometry(0.09 * k[0], 0.2 * k[1], 4, 10), shell, g, 0, 0.12, 0).scale.set(1, 1, 0.75);
        mesh(new THREE.SphereGeometry(0.06, 12, 10), shell, g, 0, 0.36 * k[1] + 0.04, 0);
        for (const s of [-1, 1]) {
          mesh(new THREE.CapsuleGeometry(0.03 * k[0], 0.22 * k[1], 4, 8), shell, g, s * (0.13 * k[0] + 0.02), 0.1, 0);
          mesh(new THREE.CapsuleGeometry(0.038 * k[0], 0.28 * k[1], 4, 8), shell, g, s * 0.05 * k[0], -0.2 * k[1] - 0.06, 0);
        }
        break;
      }
      case 'suit': {
        const m = suitMat(o.id, o);
        mesh(rbox(0.36, 0.42, 0.08, 0.03), m, g, 0, 0, 0);
        for (const s of [-1, 1]) mesh(rbox(0.1, 0.32, 0.07, 0.03), m, g, s * 0.22, 0.02, 0, 0, 0, s * 0.25);
        mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 14, PI), F.dark, g, 0, 0.21, 0.02, 0, 0, PI);
        mesh(new THREE.TorusGeometry(0.16, 0.008, 6, 20, PI), F.steel, g, 0, 0.22, -0.02);
        mesh(new THREE.BoxGeometry(0.36, 0.035, 0.085), F.dark, g, 0, -0.08, 0);
        if (o.pattern) { const pm = new THREE.MeshStandardMaterial({ color: o.pattern === 'camo' ? 0x3a4024 : 0xffe060, roughness: 0.8 }); for (let i = 0; i < 7; i++) mesh(new THREE.CircleGeometry(0.03, 8), pm, g, rnd(-0.14, 0.14), rnd(-0.18, 0.18), 0.041); }
        break;
      }
      case 'skin': {
        const m = RM.shell(SKIN_TONE[o.id] ?? 0xe0d2b0);
        mesh(rbox(0.3, 0.3, 0.06, 0.03), m, g, 0, 0, 0);
        mesh(new THREE.SphereGeometry(0.1, 20, 14), RM.face(cos.faceEntry, SKIN_TONE[o.id] ?? 0xe0d2b0, cos.frame), g, 0.06, 0.06, 0.06);
        break;
      }
      case 'face': {
        const geo = new THREE.PlaneGeometry(0.5, 0.42, 20, 20);
        const p = geo.attributes.position;
        for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, -1.1 * (x * x) - 0.5 * (y * y)); }
        geo.computeVertexNormals();
        mesh(geo, new THREE.MeshStandardMaterial({ map: faceTexture(o, this.cos.frame), color: SKIN_TONE[cos.skin] ?? 0xe0d2b0, roughness: 0.5 }), g);
        mesh(cyl(0.015, 0.2, 'y', 6), F.steel, g, 0, -0.3, -0.05);
        break;
      }
      case 'eyes': {
        for (const s of [-1, 1]) {
          const e = new THREE.Group(); e.position.x = s * 0.13 * (o.s || 1); g.add(e);
          const r = 0.1 * (o.s || 1);
          mesh(new THREE.SphereGeometry(r, 22, 16), this._eyeMat([0.86, 0.83, 0.78]), e);
          mesh(new THREE.CircleGeometry(r * 0.48, 22), this._eyeMat(o.iris || DEFAULT_IRIS), e, 0, 0, r * 0.985);
          const led = o.led === 'red' ? this.F.glowRed : new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.4, 3.2) });
          mesh(new THREE.CircleGeometry(r * 0.13 * (o.pupil || 1), 14), led, e, 0, 0, r * 0.995).castShadow = false;
        }
        mesh(new THREE.BoxGeometry(0.5, 0.03, 0.12), F.dark, g, 0, -0.13, 0);
        break;
      }
      case 'hat':
        if (o.id === 'none') noneSign(); else partGeo('rhat:' + o.id, () => buildHatPart(o));
        break;
      case 'visor':
        if (o.id === 'none') noneSign(); else partGeo('rvisor:' + o.id, () => buildVisorPart(o));
        break;
      case 'accessory':
        if (o.id === 'none') noneSign(); else partGeo('racc:' + o.id, () => buildAccPart(o));
        break;
      case 'backpack':
        if (o.id === 'none') noneSign(); else partGeo('rpack:' + o.id, () => buildPackPart(o));
        break;
      default: noneSign();
    }
    g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    whiteVC(g);
    return g;
  }
  _eyeMat(rgb) { return cached2('eye_' + rgb.join(','), () => new THREE.MeshPhysicalMaterial({ color: new THREE.Color(rgb[0], rgb[1], rgb[2]), roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03 })); }

  // the real-size part that gets ripped off (static meshes, centred on its bounds)
  _chunkFor(cat, cosIn) {
    const cos = resolveCos(cosIn), g = new THREE.Group(), inner = new THREE.Group(); g.add(inner);
    const add = (P, filter = null) => { for (const [mat, geo] of P.geos) { if (filter && !filter(mat)) continue; const m = new THREE.Mesh(geo, mat === 'suit' ? cached2('suit_' + cos.suit, () => new THREE.MeshStandardMaterial({ color: cos.suitEntry.color, roughness: 0.8 })) : robotMaterial(mat, cos)); m.castShadow = true; inner.add(m); } };
    const id = cos[cat];
    if (cat === 'hat' && id !== 'none') add(getPart('rhat:' + id, () => buildHatPart(cos.hatEntry)));
    else if (cat === 'visor' && id !== 'none') add(getPart('rvisor:' + id, () => buildVisorPart(cos.visorEntry)));
    else if (cat === 'accessory' && id !== 'none') add(getPart('racc:' + id, () => buildAccPart(cos.accEntry)));
    else if (cat === 'backpack' && id !== 'none') add(getPart('rpack:' + id, () => buildPackPart(cos.packEntry)));
    else if (cat === 'skull') add(getPart('rhead:' + headKind(cos.faceEntry), () => buildRobotHead(cos.faceEntry)));
    else if (cat === 'face') add(getPart('rhead:' + headKind(cos.faceEntry), () => buildRobotHead(cos.faceEntry)), (m) => m === 'face');
    else if (cat === 'eyes') {
      for (const s of [-1, 1]) { const e = mesh(new THREE.SphereGeometry(0.013, 14, 10), this._eyeMat([0.86, 0.83, 0.78]), inner, s * 0.032, 0, 0); mesh(new THREE.CircleGeometry(0.0062, 14), this._eyeMat(cos.eyesEntry.iris || DEFAULT_IRIS), e, 0, 0, 0.0129); }
      mesh(cyl(0.002, 0.05, 'z', 5), this.F.rubber, inner, 0, 0, 0.03);
    } else {
      // a torn torso panel (coverall + shell)
      const m = cat === 'suit' || cat === 'frame' || cat === 'build' ? cached2('suit_' + cos.suit, () => new THREE.MeshStandardMaterial({ color: cos.suitEntry.color, roughness: 0.8 })) : RM.shell(SKIN_TONE[cos.skin] ?? 0xe0d2b0);
      mesh(new THREE.CylinderGeometry(0.15, 0.14, 0.22, 14, 1, true, -0.8, 1.6), m, inner).material.side = THREE.DoubleSide;
      mesh(cyl(0.004, 0.08, 'y', 5), this.F.rubber, inner, 0.02, -0.12, 0.13);
    }
    if (!inner.children.length) return null;
    whiteVC(inner);
    const box = new THREE.Box3().setFromObject(inner);
    inner.position.copy(box.getCenter(V()).multiplyScalar(-1));
    const big = ['skull', 'face', 'hat', 'visor', 'accessory', 'backpack'].includes(cat);
    g.scale.setScalar(big ? ROBOT_SCALE : 1);
    return g;
  }

  // ============================================================================ build: back tag, fx, background line
  _buildBackTag() {
    const g = (this.backTag = new THREE.Group());
    this.camera.add(g);
    const t = this._tex(256, 96, (x, w, h) => { x.fillStyle = '#e8b414'; x.fillRect(0, 0, w, h); x.fillStyle = '#16130e'; x.textBaseline = 'middle'; x.strokeStyle = '#16130e'; x.lineWidth = 5; x.strokeRect(6, 6, w - 12, h - 12); fitText(x, '◄ BACK', w / 2, h / 2 + 2, w - 40, 54, `{s}px ${F_MARK}`); });
    this.backPiv = new THREE.Group(); g.add(this.backPiv);
    const chain = mesh(cyl(0.0012, 0.08, 'y', 4), new THREE.MeshBasicMaterial({ color: 0x777777 }), this.backPiv, 0, -0.04, 0); chain.castShadow = false;
    this.backPlate = this._plane(0.07, 0.026, new THREE.MeshBasicMaterial({ map: t.tex, side: THREE.DoubleSide }), this.backPiv, 0, -0.093, 0);
    this._addHit(this.backPlate, { type: 'back', modes: ['workshop', 'dispatch', 'continue', 'settings', 'trophies', 'plaque'] });
    const pad = mesh(new THREE.BoxGeometry(0.1, 0.05, 0.01), new THREE.MeshBasicMaterial({ visible: false }), this.backPiv, 0, -0.093, 0);
    this._addHit(pad, { type: 'back', modes: ['workshop', 'dispatch', 'continue', 'settings', 'trophies', 'plaque'] });
    g.visible = false; this.backShow = 0; this.backSw = { a: 0, v: 0 };
    this.letter = [0, 1].map(() => { const m = mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ color: 0x000000, depthTest: false, fog: false }), this.camera, 0, 0, -0.2); m.renderOrder = 20; m.castShadow = false; m.visible = false; return m; });
  }
  _buildFx() {
    this.junk = new Junk(this.scene, 70);
    this.junk.onBounce = (p, k) => { if (Math.random() < 0.5) this._sfx(k === 'bolt' ? '_tick_small' : 'impact_metal', { pos: p.clone(), volume: k === 'bolt' ? 0.25 : 0.5 }); };
    this.puffs = new Puffs(this.scene, 50);
    this.motes = new Motes(240, 1.0, 4.2);
    this.motes.points.position.set(0.1, 0.4, 0.3);
    this.scene.add(this.motes.points);
    this.hatch = new Hatch(1.7, 16);
    this.scene.add(this.hatch.root);
  }
  _buildBackline() {
    this.line2 = [];
    for (let i = 0; i < 3; i++) {
      const av = new Avatar(AV.randomCosmetics(77 + i * 31, false));
      const sw = new THREE.Group(); sw.position.set(-12 + i * 8.5, 4.35, -5.6); this.scene.add(sw);
      mesh(cyl(0.007, 0.5, 'y', 5), this.F.steel, sw, 0, -0.25, 0);
      const body = new THREE.Group(); body.position.y = -0.5; sw.add(body); body.add(av.root);
      av.root.position.set(0, -1.18, 0.12);
      const ph = Math.random() * 10;
      const fn = (b) => {
        b.neck.rotation.set(-0.4, 0, 0.2); b.head.rotation.set(-0.5, 0.2, 0.3);
        for (const [S, s] of [['L', -1], ['R', 1]]) { b['sh' + S].rotation.set(0.1, 0, s * 0.08); b['el' + S].rotation.set(0.3, 0, 0); b['hip' + S].rotation.set(0.1, 0, s * 0.05); b['kn' + S].rotation.set(-0.3, 0, 0); b['an' + S].rotation.set(-0.5, 0, 0); }
      };
      av.update(0.016, { expression: 'dead', poseFn: fn });
      this.line2.push({ av, sw, ph, fn, k: i });
    }
    this.weldP = V(-6, 3.0, -5.25);
  }

  // ============================================================================ layout (responsive)
  _layout() {
    const W = window.innerWidth, H = window.innerHeight;
    this.aspect = W / H;
    const portrait = this.aspect < 1.05;
    this.portrait = portrait;
    const P = this.panels;
    const px = portrait ? 1.05 : 1.38, pw = portrait ? 1.0 : 1.0;
    const ys = portrait ? [3.05, 2.55, 2.05, 1.62] : [3.12, 2.58, 2.04, 1.58];
    const ceil = 7.0;
    const order = [P.new, P.cont, P.settings, P.trophies];
    order.forEach((p, i) => { p.root.scale.setScalar(pw * (i === 3 ? 0.95 : 1)); p.place(px, ys[i], 0.38, ceil, -0.12); });
    // re-place children after scale (chains measured in panel space)
    for (const p of order) { const s = p.root.scale.x; p.body.position.y /= s; p.drop0 = p.body.position.y; }
    this._layoutBoard();
    // trophy plaques grid
    const cols = portrait ? 4 : 7, n = this.plaques.length, rows = Math.ceil(n / cols);
    const cw = 0.58, ch = 0.4;
    this.plaques.forEach((p, i) => { const c = i % cols, r = Math.floor(i / cols); p.g.position.set((c - (cols - 1) / 2) * cw, 2.3 + ((rows - 1) / 2 - r) * ch, 0.02); });
    this.troBoard.scale.set((cols * cw + 0.3) / 4.4, (rows * ch + 0.3) / 3.2, 1);
    this.troHeadM.position.y = 2.3 + (rows * ch) / 2 + 0.36;
    this.troGrid = { w: cols * cw + 0.3, h: rows * ch + 0.9 };
  }
  _layoutBoard() {
    const sec = SECTIONS[this.secIdx], n = (COSMETICS[sec.cat] || []).length;
    const L = this._rackLayout(n);
    const f = this._focus(sec.focus);
    let x, y, z;
    if (this.portrait) { x = 0; y = Math.max(L.h / 2 + 0.25, f.y0 - 0.1 - L.h / 2); z = 0.7; }
    else { x = 0.45 + L.w / 2; y = clamp(f.cy, L.h / 2 + 0.3, 4.4 - L.h / 2); z = 0.5; }
    this.rackTarget = { x, y, z, L };
  }
  // static focus regions of the hanging clone (world)
  _focus(kind) {
    const top = this._robTop ?? 3.3, feet = this._robFeet ?? 1.85;
    if (kind === 'head') return { cx: 0, cy: top - 0.16, hw: 0.22, hh: 0.24, y0: top - 0.42 };
    return { cx: 0, cy: (top + feet) / 2, hw: 0.4, hh: (top - feet) / 2 + 0.05, y0: feet - 0.05 };
  }

  // ============================================================================ camera
  _fitPos(look, dir, hw, hh, fov, margin = 1.08) {
    const t = Math.tan((fov * DEG) / 2), a = this.aspect;
    const d = Math.max(hh / t, hw / (t * a)) * margin;
    return look.clone().addScaledVector(dir, d);
  }
  _shotPose(name) {
    const fov = 50;
    const port = this.portrait;
    switch (name) {
      case 'introStart': { const l = V(0, 2.7, 0); return { p: l.clone().add(V(0.2, -0.3, 1.6)), l, fov: 40 }; }
      case 'hub': {
        const P = this.panels, x1 = (port ? 1.05 : 1.38) + 0.78;
        const l = V((x1 - 0.42) / 2, port ? 2.45 : 2.42, 0.2);
        const hw = (x1 + 0.42) / 2 + 0.05, hh = port ? 1.3 : 1.05;
        void P;
        return { p: this._fitPos(l, V(0.1, -0.2, 1).normalize(), hw, hh, fov), l, fov };
      }
      case 'workshop': {
        const R = this.rackTarget, f = this._focus(SECTIONS[this.secIdx].focus);
        const x0 = Math.min(f.cx - f.hw, R.x - R.L.w / 2), x1 = Math.max(f.cx + f.hw, R.x + R.L.w / 2);
        const y0 = Math.min(f.cy - f.hh, R.y - R.L.h / 2 - 0.05), y1 = Math.max(f.cy + f.hh, R.y + R.L.h / 2 + 0.2);
        const l = V((x0 + x1) / 2, (y0 + y1) / 2, 0.3);
        return { p: this._fitPos(l, V(port ? 0.05 : 0.18, -0.06, 1).normalize(), (x1 - x0) / 2 + 0.04, (y1 - y0) / 2 + 0.04, fov), l, fov };
      }
      case 'dispatch': {
        const g = this.dispatch; g.updateWorldMatrix(true, false);
        // first person at the console: over the lever and the CRT, the hook and the hatch beyond
        const l = g.localToWorld(V(0.02, 1.1, -0.1)).lerp(V(0, 2.2, 0), 0.3);
        const eye = g.localToWorld(V(0.05, 1.68, 0.95));
        const dir = eye.clone().sub(l).normalize();
        const p = this._fitPos(l, dir, 0.62, 0.5, 54, 1.0);
        if (p.distanceTo(l) < eye.distanceTo(l)) p.copy(eye);
        return { p, l, fov: 54 };
      }
      case 'continue': {
        const g = this.contG; g.updateWorldMatrix(true, false);
        const l = g.localToWorld(V(0, 0.62, 0.02));
        const dir = V(0, 0.7, 1).transformDirection(g.matrixWorld).normalize();
        return { p: this._fitPos(l, dir, 1.25, 0.72, 46), l, fov: 46 };
      }
      case 'settings': {
        const g = this.setG; g.updateWorldMatrix(true, false);
        const l = g.localToWorld(V(0, 1.45, 0));
        const dir = V(0, 0.08, 1).transformDirection(g.matrixWorld).normalize();
        return { p: this._fitPos(l, dir, 0.8, 0.6, 46, 1.04), l, fov: 46 };
      }
      case 'trophies': {
        const g = this.troG; g.updateWorldMatrix(true, false);
        const G = this.troGrid, l = g.localToWorld(V(0, 2.3 + 0.2, 0));
        const dir = V(0, 0.05, 1).transformDirection(g.matrixWorld).normalize();
        return { p: this._fitPos(l, dir, G.w / 2, G.h / 2, 46), l, fov: 46 };
      }
      case 'plaque': {
        const p = this.plaqueSel; p.g.updateWorldMatrix(true, false);
        const l = p.g.getWorldPosition(V());
        const dir = V(0, 0, 1).transformDirection(p.g.matrixWorld).normalize();
        return { p: this._fitPos(l, dir, 0.32, 0.22, 40), l, fov: 40 };
      }
      default: return { p: this.rig.p.clone(), l: this.rig.l.clone(), fov: this.rig.fov };
    }
  }
  _snap(name) { const s = this._shotPose(name); const r = this.rig; r.shot = name; r.from = null; r.t = 1; r.p.copy(s.p); r.l.copy(s.l); r.fov = s.fov; }
  _go(name, dur = 1.4, arc = 0.22) {
    const r = this.rig;
    r.from = { p: r.p.clone(), l: r.l.clone(), fov: r.fov };
    r.shot = name; r.t = 0; r.dur = dur; r.arc = arc;
  }
  _updateCamera(dt) {
    const r = this.rig, cam = this.camera;
    if (r.shot === 'manual') {
      // drop sequence drives r.p / r.l itself
    } else {
      const tgt = this._shotPose(r.shot);
      const prev = _v4.copy(r.p);
      if (r.from && r.t < 1) {
        r.t = Math.min(1, r.t + dt / r.dur);
        const k = easeIO(r.t);
        const a = r.from.p, b = tgt.p;
        const ctrl = _v1.addVectors(a, b).multiplyScalar(0.5);
        ctrl.y += a.distanceTo(b) * r.arc;
        const u = 1 - k;
        r.p.set(u * u * a.x + 2 * u * k * ctrl.x + k * k * b.x, u * u * a.y + 2 * u * k * ctrl.y + k * k * b.y, u * u * a.z + 2 * u * k * ctrl.z + k * k * b.z);
        r.l.lerpVectors(r.from.l, tgt.l, easeIO(clamp(r.t * 1.15, 0, 1)));
        r.fov = lerp(r.from.fov, tgt.fov, k) - Math.sin(k * PI) * 6;
      } else {
        r.p.x = damp(r.p.x, tgt.p.x, 3, dt); r.p.y = damp(r.p.y, tgt.p.y, 3, dt); r.p.z = damp(r.p.z, tgt.p.z, 3, dt);
        r.l.x = damp(r.l.x, tgt.l.x, 4, dt); r.l.y = damp(r.l.y, tgt.l.y, 4, dt); r.l.z = damp(r.l.z, tgt.l.z, 4, dt);
        r.fov = damp(r.fov, tgt.fov, 4, dt);
      }
      if (dt > 0) r.vel.subVectors(r.p, prev).divideScalar(dt);
    }
    // handheld drift + pointer parallax (first-person feel) + banking on lateral moves
    const t = this.t;
    cam.position.copy(r.p);
    cam.position.x += Math.sin(t * 0.61) * 0.008 + Math.sin(t * 1.7) * 0.003;
    cam.position.y += Math.sin(t * 0.83 + 1) * 0.007 + Math.sin(t * 2.3) * 0.002;
    cam.lookAt(r.l);
    const px = this.pointer.has && !this.pointer.touch ? this.pointer.x / window.innerWidth - 0.5 : 0;
    const py = this.pointer.has && !this.pointer.touch ? this.pointer.y / window.innerHeight - 0.5 : 0;
    this._par = this._par || { x: 0, y: 0 };
    this._par.x = damp(this._par.x, px, 3, dt); this._par.y = damp(this._par.y, py, 3, dt);
    const fp = this.mode === 'hub' || this.mode === 'intro' ? 0.6 : 1;
    cam.rotateY(-this._par.x * 0.035 * fp + Math.sin(t * 0.52) * 0.003);
    cam.rotateX(-this._par.y * 0.025 * fp + Math.sin(t * 0.71 + 0.5) * 0.0025);
    const lat = _v2.set(1, 0, 0).applyQuaternion(cam.quaternion).dot(r.vel);
    r.roll = damp(r.roll, clamp(-lat * 0.025, -0.08, 0.08), 4, dt);
    cam.rotateZ(r.roll + Math.sin(t * 0.37 + 1.2) * 0.003);
    const W = window.innerWidth, H = window.innerHeight;
    cam.fov = r.fov; cam.aspect = W / H;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    if (audio.ready) audio.setListener(cam.position, cam.quaternion);
  }

  // ============================================================================ input
  _bindInput() {
    const isUI = (t) => !!(t && t.closest && t.closest('button, input, select, textarea, a, label, .crt, #touch, .touch-ui'));
    const setP = (e) => { this.pointer.x = e.clientX; this.pointer.y = e.clientY; this.pointer.has = true; this.pointer.touch = e.pointerType !== 'mouse'; };
    this._onMove = (e) => {
      if (!this.active) return;
      setP(e);
      const d = this._drag;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      d.moved = Math.max(d.moved, Math.hypot(dx, dy));
      if (d.ctl) this._dragCtl(d, e);
      else if (this.mode === 'workshop' && !this.flip) this._rackDrag = clamp(dx / 400, -0.6, 0.6);
    };
    this._onDown = (e) => {
      if (!this.active || isUI(e.target)) return;
      if (e.button === 2) return;
      setP(e);
      this._gesture();
      const hit = this._pick(e.clientX, e.clientY);
      const act = hit?.userData.act;
      this._drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, act, ctl: act?.type === 'ctl' ? act.c : null };
      if (this._drag.ctl) this._beginCtl(this._drag);
    };
    this._onUp = (e) => {
      if (!this.active) return;
      const d = this._drag; this._drag = null; this._rackDrag = 0;
      if (!d || d.id !== e.pointerId) return;
      setP(e);
      const dx = e.clientX - d.x, dy = e.clientY - d.y, dtm = performance.now() - d.t;
      if (d.ctl) { this._endCtl(d); return; }
      const big = Math.abs(dx) > Math.max(50, window.innerWidth * 0.12);
      if (this.mode === 'workshop' && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2 && (dtm < 1200 || big)) { this._section(this.secIdx + (dx < 0 ? 1 : -1)); return; }
      if (d.moved < 12 && dtm < 900) this._click(d.act, e);
    };
    this._onKey = (e) => {
      if (!this.active || this.game.state !== 'menu') return;
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      this._gesture();
      if (e.code === 'Escape' || e.code === 'Backspace') { this._back(); e.preventDefault(); return; }
      if (this.mode === 'intro') { this._skipIntro(); return; }
      if (this.mode === 'workshop' && (e.code === 'ArrowRight' || e.code === 'KeyD')) this._section(this.secIdx + 1);
      if (this.mode === 'workshop' && (e.code === 'ArrowLeft' || e.code === 'KeyA')) this._section(this.secIdx - 1);
    };
    this._onCtx = (e) => { if (!this.active || this.game.state !== 'menu') return; e.preventDefault(); this._back(); };
    window.addEventListener('pointermove', this._onMove, { passive: true, capture: true });
    window.addEventListener('pointerdown', this._onDown, { passive: true, capture: true });
    window.addEventListener('pointerup', this._onUp, { passive: true, capture: true });
    window.addEventListener('pointercancel', (e) => { if (this._drag?.id === e.pointerId) { if (this._drag.ctl) this._endCtl(this._drag); this._drag = null; } }, { passive: true, capture: true });
    window.addEventListener('keydown', this._onKey, { capture: true });
    window.addEventListener('contextmenu', this._onCtx);
  }
  _gesture() {
    if (this._gestured) return;
    this._gestured = true;
    audio.init().then(() => { try { this.game.ui?.applySettings?.(); } catch (e) { /* */ } }).catch(() => {});
  }
  _pick(x, y) {
    const W = window.innerWidth, H = window.innerHeight;
    this.camera.updateMatrixWorld(true);
    this.raycaster.setFromCamera(new THREE.Vector2((x / W) * 2 - 1, -(y / H) * 2 + 1), this.camera);
    const list = this.hits.filter((h) => h.userData.act.modes.includes(this.mode) && this._visible(h));
    const hit = this.raycaster.intersectObjects(list, false)[0];
    return hit ? hit.object : null;
  }
  _visible(o) { for (let p = o; p; p = p.parent) if (!p.visible && !(p.material && p.material.visible === false && p === o)) return false; return true; }

  _click(act) {
    if (this.mode === 'intro') { this._skipIntro(); return; }
    if (!act) { if (this.mode === 'plaque') this._enter('trophies'); return; }
    switch (act.type) {
      case 'panel': {
        const p = this.panels[act.key];
        p.kick(1.6);
        this._sfx('toggle_clack', { volume: 0.6, bus: 'ui' });
        if (act.key === 'new') this._enter('dispatch');
        else if (act.key === 'cont') this._enter('continue');
        else if (act.key === 'settings') this._enter('settings');
        else this._enter('trophies');
        break;
      }
      case 'robot': this._enter('workshop'); break;
      case 'back': this._back(); break;
      case 'arrow': this._section(this.secIdx + act.dir); break;
      case 'item': this._choose(act.c.cat, act.c.o.id, act.c); break;
      case 'lever': this._pullLever(); break;
      case 'dest': {
        this.destSel.set((this.destSel.i + 1) % 3);
        const d = DESTS[this.destSel.i];
        try { this.game.ui?._setting ? this.game.ui._setting('destination', d) : (profile.settings.destination = d, profile.save()); } catch (e) { /* */ }
        this._sfx('knob_tick', { volume: 0.8, bus: 'ui' });
        this._drawDispatchCrt(`> DESTINATION SET: ${LEVEL_NAME[d]}`);
        break;
      }
      case 'crate': {
        if (!this.hasSave) { this._sfx('buzzer', { volume: 0.35, bus: 'ui' }); this.crates[1].root.rotation.z = 0.04; this._shake(0.1); break; }
        this._sfx('robo_clunk', { volume: 0.6 });
        this._startDrop(true);
        break;
      }
      case 'plaque': {
        if (this.mode === 'plaque' && this.plaqueSel === act.p) { this._enter('trophies'); break; }
        this.plaqueSel = act.p; this.mode = 'plaque'; this._go('plaque', 0.9, 0.05);
        this._sfx(act.p.on ? 'bell_ding' : 'knob_tick', { volume: 0.3, bus: 'ui' });
        break;
      }
      default: break;
    }
  }
  _shake(a) { juice.shake(a); }

  // settings drags
  _beginCtl(d) {
    const c = d.ctl;
    this.activeCtl = c; this._drawCrt();
    d.v0 = this._ctlValue(c);
    if (c.type === 'fader') {
      const tr = c.o.track; tr.updateWorldMatrix(true, false);
      const a = tr.localToWorld(V(-c.o.len / 2, 0, 0)).project(this.camera), b = tr.localToWorld(V(c.o.len / 2, 0, 0)).project(this.camera);
      const W = window.innerWidth, H = window.innerHeight;
      d.ax = (a.x + 1) / 2 * W; d.ay = (1 - a.y) / 2 * H; d.bx = (b.x + 1) / 2 * W; d.by = (1 - b.y) / 2 * H;
      this._dragCtl(d, { clientX: d.x, clientY: d.y });
    }
  }
  _dragCtl(d, e) {
    const c = d.ctl;
    if (c.type === 'knob') {
      const dv = ((e.clientX - d.x) - (e.clientY - d.y)) / 260 * (c.max - c.min);
      const v = clamp(d.v0 + dv, c.min, c.max), st = Math.round(v * 20);
      if (st !== d.lastStep) { d.lastStep = st; this._sfx('knob_tick', { volume: 0.5, bus: 'ui', pitch: 0.8 + v * 0.4 }); }
      c.o.set((v - c.min) / (c.max - c.min));
      this._applySetting(c, v); this._drawCrtSoon();
    } else if (c.type === 'fader') {
      const ux = d.bx - d.ax, uy = d.by - d.ay, L2 = ux * ux + uy * uy || 1;
      const k = clamp(((e.clientX - d.ax) * ux + (e.clientY - d.ay) * uy) / L2, 0, 1);
      const v = c.min + k * (c.max - c.min), st = Math.round(k * 20);
      if (st !== d.lastStep) { d.lastStep = st; this._sfx('knob_tick', { volume: 0.4, bus: 'ui', pitch: 1.4 }); }
      c.o.set(k); this._applySetting(c, v); this._drawCrtSoon();
    } else if (c.type === 'sel' && d.moved > 30) {
      const i = clamp(d.v0 + Math.round((e.clientX - d.x) / 60), 0, 2);
      if (i !== c.o.i) { c.o.set(i); this._sfx('knob_tick', { volume: 0.8, bus: 'ui' }); this._applySetting(c, i, true); this._drawCrtSoon(); }
    }
  }
  _endCtl(d) {
    const c = d.ctl;
    if (d.moved < 12) {
      if (c.type === 'toggle') { const v = !this._ctlValue(c); c.o.set(v); this._applySetting(c, v, true); this._sfx('toggle_clack', { volume: 0.8, bus: 'ui' }); }
      else if (c.type === 'sel') { const i = (c.o.i + 1) % 3; c.o.set(i); this._applySetting(c, i, true); this._sfx('knob_tick', { volume: 0.9, bus: 'ui' }); }
    }
    this._drawCrt();
  }
  _drawCrtSoon() { if (!this._crtT) this._crtT = setTimeout(() => { this._crtT = null; this._drawCrt(); }, 60); }

  // ============================================================================ modes
  _skipIntro() { if (this.mode !== 'intro') return; this.introT = 99; }
  _enter(m) {
    if (this.mode === 'drop') return;
    const prev = this.mode;
    this.mode = m;
    if (prev === 'workshop' && m !== 'workshop') this._leaveWorkshop();
    switch (m) {
      case 'hub': this._go('hub', 1.5, 0.25); this._refreshPanels(); this._station(null); break;
      case 'workshop': this._enterWorkshop(); break;
      case 'dispatch': this._go('dispatch', 1.6, 0.3); this._station('dispatch'); this._drawDispatchCrt(); this.leverT = -0.5; break;
      case 'continue': this._go('continue', 1.6, 0.3); this._station('continue'); this._fillCrates(); this._openCratesT = 1.2; break;
      case 'settings': this._go('settings', 1.7, 0.3); this._station('settings'); this._syncControls(); this._drawCrt(); break;
      case 'trophies': this._go('trophies', prev === 'plaque' ? 0.9 : 1.8, prev === 'plaque' ? 0.05 : 0.3); this._station('trophies'); if (prev !== 'plaque') this._drawPlaques(); break;
      default: break;
    }
    this._sfx('robo_whir', { volume: 0.18, pitch: 0.6, bus: 'ui' });
  }
  _back() {
    if (this.mode === 'intro') { this._skipIntro(); return; }
    if (this.mode === 'drop' || this.mode === 'hub') return;
    if (this.mode === 'plaque') { this._enter('trophies'); return; }
    this._sfx('ui_back', { volume: 0.4, bus: 'ui' });
    this._enter('hub');
  }
  _station(name) {
    const L = this.stLight;
    this._stTarget = 0;
    if (!name) return;
    const g = name === 'dispatch' ? this.dispatch : name === 'continue' ? this.contG : name === 'settings' ? this.setG : this.troG;
    g.updateWorldMatrix(true, false);
    const off = name === 'settings' ? V(0, 2.6, 1.4) : name === 'trophies' ? V(0, 4.6, 2.2) : name === 'continue' ? V(0, 3.0, 1.0) : V(0.3, 2.8, 1.2);
    const tgt = name === 'settings' ? V(0, 1.45, 0) : name === 'trophies' ? V(0, 2.3, 0) : name === 'continue' ? V(0, 0.4, 0) : V(0, 1.0, 0);
    L.position.copy(g.localToWorld(off)); L.target.position.copy(g.localToWorld(tgt));
    L.angle = name === 'trophies' ? 0.7 : 0.55;
    L.distance = name === 'trophies' ? 9 : 6;
    this._stTarget = name === 'trophies' ? 16 : 9;
    this._stFlick = 0.35;
    setTimeout(() => this._sfx('lights_slam', { volume: 0.25, pos: L.position.clone() }), 650);
  }

  _enterWorkshop() {
    this._layoutBoard();
    this._fillRack();
    this.rack.visible = true;
    const R = this.rackTarget;
    this.rack.position.set(R.x, R.y + 2.5, R.z);
    this._go('workshop', 1.7, 0.18);
    this.bankT = 0; this.bankOn = 0;
    this.dg.kick(rnd(-0.4, 0.4), rnd(-0.3, 0.3), 0.6, 0.6);
    this.dg.yawT = SECTIONS[this.secIdx].yaw;
    this._sfx('robo_clunk', { volume: 0.4, pos: PIVOT.clone() });
  }
  _leaveWorkshop() {
    this.bankOn = -1;
    this.dg.yawT = 0;
    this._sfx('lights_out', { volume: 0.45 });
    for (const a of this.arms) { a.k = 26; a.toRest(); a.setGrip(0); }
    this.job = null; this.jobs = [];
    this.dg.headless = false; this.dg.eyeless = false;
    for (const c of this.cells) if (c.item.parent !== c.g) { c.g.add(c.item); c.item.position.set(0, 0.02, 0.07); c.item.rotation.set(0, 0, 0); c.item.scale.setScalar(1); }
    this._applyCos();
  }
  _section(i) {
    if (this.mode !== 'workshop') return;
    const n = SECTIONS.length;
    i = ((i % n) + n) % n;
    if (i === this.secIdx || this.flip || this.job) return;
    this.flip = { t: 0, to: i, dir: i > this.secIdx ? 1 : -1, swapped: false };
    this._sfx('robo_whir', { volume: 0.35, pitch: 1.3 });
    this._sfx('knob_tick', { volume: 0.7, bus: 'ui' });
  }

  // ============================================================================ outfitting jobs (brutal part swaps)
  _choose(cat, id, cell = null) {
    if (this.mode !== 'workshop' || this.flip) return;
    const o = COSMETICS[cat].find((e) => e.id === id);
    if (!o) return;
    if (!unlocked(o)) {
      this._sfx('buzzer', { volume: 0.4, bus: 'ui' }); this._sfx('ui_error', { volume: 0.4, bus: 'ui' });
      if (cell) { cell.shake = 0.6; }
      const a = this.arms[1]; a.mode = 'pose'; this._wag = 0.9;
      return;
    }
    if (this.cos[cat] === id && !this.job) { if (cell) cell.shake = 0.3; this._sfx('knob_tick', { volume: 0.5, bus: 'ui' }); return; }
    this.jobs = [{ cat, id, cell }];
    this._sfx('ui_select', { volume: 0.35, bus: 'ui' });
  }
  _partKind(cat) {
    return cat === 'hat' ? 'top' : cat === 'eyes' ? 'eyes' : ['skull', 'face', 'visor'].includes(cat) ? 'face' : cat === 'backpack' ? 'back' : 'chest';
  }
  _startJob(j) {
    const kind = this._partKind(j.cat);
    // rip arm: the one on the camera side for chest / head work, the right one for the back
    const camX = this.rig.p.x;
    const ripI = kind === 'back' ? 1 : camX > 0.3 ? 0 : 1;
    j.rip = this.arms[ripI]; j.ins = this.arms[1 - ripI];
    j.kind = kind; j.t = 0; j.old = { ...this.cos };
    j.chunk = null; j.newItem = j.cell?.item || null;
    this.job = j;
    for (const a of this.arms) { a.k = 38; a.z = 0.5; a.setGrip(0); }
    this._sfx('robo_whir', { pos: j.rip.root.position.clone(), volume: 0.75, pitch: rnd(0.9, 1.1) });
  }
  _updateJobs(dt) {
    if (this._wag > 0) {
      this._wag -= dt;
      const a = this.arms[1];
      if (!this.job) { a.mode = 'pose'; a.J.yaw.t = Math.sin(this._wag * 22) * 0.35; a.J.e1.t = 1.35; a.J.bend.t = 1.2; a.J.wrist.t = -0.3; a.setRoll(Math.sin(this._wag * 30) * 0.8); if (this._wag <= 0) { a.setRoll(0); a.toRest(); } }
    }
    if (!this.job && this.jobs.length && this.mode === 'workshop') this._startJob(this.jobs.shift());
    const j = this.job;
    if (!j) return;
    const prev = j.t; j.t += dt;
    const at = (x) => prev < x && j.t >= x;
    const p = this._robotPoint(j.kind, V());
    const out = j.kind === 'top' ? V(0, 1, 0) : V(0, 0, j.kind === 'back' ? 1 : -1).applyQuaternion(this.av.root.getWorldQuaternion(_q1));
    out.normalize();
    const R = j.rip, I = j.ins;
    const side = Math.sign(R.root.position.x) || 1;
    const app = (a, dist) => p.clone().addScaledVector(out, dist).addScaledVector(V(Math.sign(a.root.position.x), 0, 0), dist * 0.6);
    // ---- rip arm
    if (j.t < 0.42) R.reach(app(R, 0.42), p.clone().sub(app(R, 0.42)).normalize());
    else if (j.t < 0.66) { R.k = 70; R.reach(app(R, 0.03), p.clone().sub(app(R, 0.4)).normalize()); }
    else if (j.t < 1.1) { R.k = 85; R.reach(app(R, 0.75).add(V(0, 0.35, 0)), out.clone().negate()); }
    else if (j.t < 1.45) { R.k = 40; R.reach(V(side * 2.0, 1.4, 1.0), V(side * 0.5, -1, 0.3).normalize()); }
    else { R.k = 26; R.toRest(); }
    if (at(0.5)) {
      R.setGrip(0.85); R.jitter = 1;
      this._sfx('robo_clunk', { pos: p.clone(), volume: 0.9 });
      this.dg.kick(-side * 0.6 * 0.4, 0.25, 0, 0.6);
      this.sparks.burst(p, out, 18, 2.2, 0);
    }
    if (at(0.66)) {
      // RIP
      R.jitter = 0;
      this._sfx('metal_rip', { pos: p.clone(), volume: 1 });
      this._sfx('spark', { pos: p.clone(), volume: 0.6 });
      this.sparks.burst(p, out, 60, 3.4, 0);
      this.junk.spray(p, out.clone().add(V(0, 0.3, 0)).normalize(), 45, 3.2, 0);
      this.junk.burstBolts(p, out, 7, 0);
      this.puffs.puff(p, out, 4, 0.25, 0.6, 1.2, 0.18);
      this.dg.kick(-side * 1.4 * 0.5, -0.9 * 0.5, rnd(-1, 1), 1.4);
      this.fx.flash = 0.35; this.fx.glitch = 0.25;
      juice.shake(0.35); juice.hitstop(45);
      // the old part comes off with the clamp
      j.chunk = this._chunkFor(j.cat, j.old);
      if (j.chunk) { R.roll.add(j.chunk); j.chunk.position.set(0, 0, 0.27); }
      if (j.cat === 'skull') this.dg.headless = true;
      else if (j.cat === 'eyes') this.dg.eyeless = true;
      else if (NONE_OK[j.cat]) { this.cos = { ...this.cos, [j.cat]: NONE_OK[j.cat] }; this._applyCos(); }
    }
    if (j.t > 0.66 && j.t < 1.0 && Math.random() < dt * 22) { const sp = j.cat === 'skull' ? this._robotPoint('head', V()).add(V(0, -0.1, 0)) : p; this.sparks.burst(sp, V(0, 1, 0), 6, 2.6, 0); }
    if (at(1.32) && j.chunk) {
      R.setGrip(0);
      this.junk.fling(j.chunk, V(side * 1.6, 0.8, 0.9), V(rnd(-8, 8), rnd(-8, 8), rnd(-8, 8)), 0, 6);
      this._sfx('throw_whoosh', { pos: R.tip(V()), volume: 0.4 });
      j.chunk = null;
    }
    // ---- install arm: grab the new part off the board, slam it on
    const cellW = j.cell ? j.cell.g.getWorldPosition(V()) : null;
    if (j.t < 0.35) I.toRest();
    else if (j.t < 0.8 && cellW) { I.k = 48; const n = V(0, 0, 1).applyQuaternion(this.rack.getWorldQuaternion(_q1)); I.reach(cellW.clone().addScaledVector(n, 0.12), n.clone().negate()); }
    else if (j.t < 1.25) { I.k = 52; I.reach(app(I, 0.4), p.clone().sub(app(I, 0.4)).normalize()); }
    else if (j.t < 1.42) { I.k = 110; I.reach(app(I, 0.0), p.clone().sub(app(I, 0.35)).normalize()); }
    else if (j.t < 1.75) { I.k = 40; I.reach(app(I, 0.5), out); }
    else { I.k = 26; I.toRest(); }
    if (at(0.62)) { I.setGrip(0.7); this._sfx('robo_clunk', { pos: I.tip(V()), volume: 0.4 }); }
    if (j.t > 0.62 && j.t < 1.42 && j.newItem) {
      // the part is pulled from its cubby into the clamp
      if (j.newItem.parent !== I.roll) { j.newItem.updateWorldMatrix(true, false); I.roll.attach(j.newItem); j.flyT = 0; j.from = j.newItem.position.clone(); }
      j.flyT += dt;
      j.newItem.position.lerpVectors(j.from, V(0, 0, 0.3), easeOut(j.flyT / 0.22));
    }
    if (at(1.42)) {
      // SLAM
      this._sfx('robo_clunk', { pos: p.clone(), volume: 1 });
      this._sfx('booth_bang', { pos: p.clone(), volume: 0.45 });
      this._sfx('weld_crackle', { pos: p.clone(), volume: 0.5 });
      this.sparks.burst(p, out, 70, 3.6, 0);
      this.junk.burstBolts(p, out, 3, 0);
      this.dg.headless = false; this.dg.eyeless = false;
      this.cos = { ...this.cos, [j.cat]: j.id };
      if (j.cat === 'face') this.itemCache.clear();
      this._applyCos();
      this._saveCos();
      this.dg.kick(Math.sign(I.root.position.x) * -0.7, 0.6, rnd(-1.5, 1.5), 1.6);
      this.fx.flash = 0.5; juice.shake(0.45); juice.hitstop(70); juice.punch?.(0.05);
      if (j.newItem) j.newItem.visible = false;
      I.setGrip(0);
      for (const c of this.cells) c.sel = c.o.id === j.id;
    }
    if (j.t >= 2.0) {
      if (j.newItem && j.cell) { j.cell.g.add(j.newItem); j.newItem.position.set(0, 0.02, 0.07); j.newItem.rotation.set(0, 0, 0); j.newItem.visible = true; j.newItem.scale.setScalar(0.01); j.cell.pop = 0; }
      this.job = null;
    }
  }
  _applyCos() {
    try { this.av.setCosmetics(this.cos); this.av.setName(profile.name); } catch (e) { console.warn('[menu] setCosmetics', e); }
    if (this.ring.parent !== this.av.bones.chest) this.av.bones.chest.add(this.ring);
    if (this.toeTag.parent !== this.av.bones.anR) this.av.bones.anR.add(this.toeTag);
  }
  _saveCos() {
    const cos = { ...this.cos };
    try {
      profile.data.cosmetics = cos;
      profile.save();
      this.game.local?.setCosmetics?.(cos);
      const r = this.game.roster?.get?.(this.game.local?.id);
      if (r) r.cosmetics = { ...cos };
    } catch (e) { console.warn('[menu] save cosmetics', e); }
  }

  // ============================================================================ the drop
  _pullLever() {
    if (this.mode !== 'dispatch' || this.leverT > 0) return;
    this.leverT = 0.75;
    this._sfx('lever', { volume: 0.8 });
    this._drawDispatchCrt('> DISPATCH AUTHORIZED. GOODBYE.');
    setTimeout(() => this._startDrop(false), 450);
  }
  _startDrop(continued) {
    if (this.mode === 'drop') return;
    if (this.mode === 'workshop') this._leaveWorkshop();
    this.mode = 'drop';
    this.drop = { t: 0, continued, phase: 0, vy: 0, fallen: 0 };
    this.fx.letterT = 1;
    this._station(null);
    this.dg.yawT = 0;
    this.bankOn = Math.max(this.bankOn, 0);
    this.rig.from = null; this.rig.shot = 'manual';
    this._dropCamFrom = { p: this.rig.p.clone(), l: this.rig.l.clone(), fov: this.rig.fov };
    this._sfx('alarm', { volume: 0.5 });
    if (!audio.ready) audio.init().catch(() => {});
  }
  _updateDrop(dt) {
    const D = this.drop, r = this.rig;
    const prev = D.t; D.t += dt;
    const at = (x) => prev < x && D.t >= x;
    const t = D.t;
    // beacon
    this.beacon.intensity = t < 3.2 ? 12 * Math.max(0, Math.sin(t * 9)) : 0;
    // camera
    const shot1 = { p: V(1.7, 1.0, 2.6), l: V(0, 2.2, 0), fov: 46 };
    if (t < 1.0) {
      const k = easeIO(t / 1.0), f = this._dropCamFrom;
      r.p.lerpVectors(f.p, shot1.p, k); r.l.lerpVectors(f.l, shot1.l, k); r.fov = lerp(f.fov, shot1.fov, k);
    } else if (D.phase < 2) {
      r.p.lerp(shot1.p, 1 - Math.exp(-3 * dt)); r.l.lerp(this._robotPoint('chest', V()), 1 - Math.exp(-4 * dt));
    }
    if (at(0.7)) { this.hatch.open = 1; this._sfx('pipe_hiss', { volume: 0.8, pos: V(0, 0, 0) }); this._sfx('door_heavy_open', { volume: 0.7, pos: V(0, 0, 0) }); this.puffs.puff(V(0, 0.1, 0), V(0, 1, 0), 14, 0.9, 1.2, 2.2, 0.16); juice.shake(0.12); }
    if (at(1.75)) {
      // release
      D.phase = 1;
      this._sfx('hook_release', { volume: 1, pos: PIVOT.clone() });
      this.sparks.burst(this._robotPoint('hook', V()), V(0, -1, 0), 20, 2, 0);
      this.dg.mode = 'fall'; this.dg.flail = 1;
      // detach the body from the cable into a free-falling pivot at the chest
      const c = this._robotPoint('chest', V());
      this.fallBody = new THREE.Group(); this.fallBody.position.copy(c); this.scene.add(this.fallBody);
      this.fallBody.attach(this.av.root);
      D.vy = 0; D.w = V(rnd(-1.2, 1.2), rnd(-1, 1), rnd(-0.8, 0.8));
      this._windH = audio.ready ? audio.loop('wind_fall', { volume: 0 }) : null;
    }
    if (D.phase >= 1 && D.phase < 3) {
      const fb = this.fallBody;
      D.vy = Math.max(-16, D.vy - 9.8 * dt);
      fb.position.y += D.vy * dt;
      fb.rotation.x += D.w.x * dt; fb.rotation.y += D.w.y * dt; fb.rotation.z += D.w.z * dt;
      D.fallen = -D.vy;
      this._windH?.setVolume?.(clamp(D.fallen / 12, 0, 1), 0.05);
      // camera dives after it
      if (fb.position.y < 1.2) D.phase = 2;
      if (D.phase === 2) {
        const tgt = V(0.05, fb.position.y + 2.2 + Math.min(2.0, D.fallen * 0.1), 0.35);
        r.p.lerp(tgt, 1 - Math.exp(-(6 + D.fallen) * dt));
        r.l.lerp(fb.position, 1 - Math.exp(-14 * dt));
        r.fov = damp(r.fov, 62, 3, dt);
      }
      this.shaftLight.position.set(0.5, fb.position.y + 0.8, 0.5);
      this.shaftLight.intensity = 4 * (0.6 + 0.4 * Math.sin(fb.position.y * 3));
      if (fb.position.y < -16 + 0.45) {
        // IMPACT
        D.phase = 3; D.impactT = t;
        fb.position.y = -16 + 0.45;
        this.scene.attach(this.av.root);
        this.fallBody.removeFromParent();
        this.av.root.position.set(0.1, -16, -0.1);
        this.av.root.rotation.set(0, rnd(-0.6, 0.6) + PI * 0.2, 0);
        this.dg.mode = 'wake'; this.wake = 0;
        this._windH?.stop?.(0.15); this._windH = null;
        this._sfx('body_impact', { volume: 1, pos: this.av.root.position.clone() });
        this._sfx('crate_land', { volume: 0.5, pos: this.av.root.position.clone() });
        juice.hitstop(140); juice.shake(1.0); this.fx.flash = 0.55; this.fx.glitch = 0.6;
        this.puffs.puff(V(0.1, -15.9, -0.1), V(0, 0.4, 0), 12, 0.6, 1.2, 2.4, 0.12, 0x4a443c);
        this.junk.burstBolts(V(0.1, -15.7, -0.1), V(0, 1, 0), 8, -16);
        this.shaftLight.intensity = 0;
        r.p.set(0.9, -14.9, 1.3); r.l.set(0.05, -15.75, -0.1); r.fov = 44;
        this.hatchBulb = 1;
      }
    }
    if (D.phase === 3) {
      const k = t - D.impactT;
      r.p.lerp(V(0.75, -15.15, 1.05), 1 - Math.exp(-0.6 * dt)); r.fov = damp(r.fov, 38, 0.6, dt);
      this.hatch.bulb.material.color.setRGB(Math.random() < 0.08 ? 0.3 : 4.2, Math.random() < 0.08 ? 0.2 : 3.2, 2.0);
      this.shaftLight.position.set(0.6, -13.4, 0.4); this.shaftLight.color.set(0xffd8a0); this.shaftLight.distance = 6;
      this.shaftLight.intensity = Math.random() < 0.08 ? 0.3 : 3.2;
      if (k > 1.4 && k < 3.0) { this.wake = clamp((k - 1.4) / 1.2, 0, 1.4); if (!this._wokeS) { this._wokeS = true; this._sfx('android_servo', { volume: 0.6, pos: this.av.root.position.clone() }); } }
      if (k > 2.9) this.fx.fade = Math.min(1, this.fx.fade + dt * 1.6);
      if (k > 3.6 && !D.handed) { D.handed = true; this._handoff(D.continued); }
    }
  }
  async _handoff(continued) {
    const g = this.game;
    try { await audio.init(); g.ui?.applySettings?.(); } catch (e) { /* */ }
    try {
      if (typeof g.enterLobby === 'function') await g.enterLobby({ continued });
      else { await g.startSolo(); g.ui?.hideMenus?.(); }
    } catch (e) {
      console.error('[menu] could not start', e);
      this._resetAfterDrop();
      this.mode = 'hub'; this._snap('hub');
      this.fx.fade = 0;
    }
  }
  _resetAfterDrop() {
    if (this.fallBody) { this.fallBody.removeFromParent(); this.fallBody = null; }
    this.body.add(this.av.root);
    this.av.root.position.set(0, -1.2, 0); this.av.root.rotation.set(0, PI, 0);
    this.dg = new Dangle();
    this.hatch.open = 0; for (const d of this.hatch.doors) { d.a = 0; d.v = 0; }
    this.wake = 0; this._wokeS = false;
    this.shaftLight.intensity = 0; this.shaftLight.color.set(0xff4a2a);
    this.fx.letterT = 0;
    this.drop = null;
    this.cos = plainCos(profile.data.cosmetics || this.cos);
    this._applyCos();
  }

  // ============================================================================ activation
  async warm(timeoutMs = 9000) {
    try {
      const r = engine.renderer;
      const p = r.compileAsync ? r.compileAsync(this.scene, this.camera) : Promise.resolve(r.compile(this.scene, this.camera));
      await Promise.race([p, new Promise((res) => setTimeout(res, timeoutMs))]);
    } catch (e) { /* warm-up only */ }
  }
  activate() {
    if (this.active) return;
    this.active = true;
    engine.setView(this.scene, this.camera);
    if (this.drop) this._resetAfterDrop();
    this.mode = 'intro'; this.introT = 0;
    this.fx.fade = 1;
    for (const p of Object.values(this.panels)) p.on = 0;
    this._refreshPanels();
    this._layout();
    this._snap('introStart');
    if (audio.ready) this._startAudio();
  }
  deactivate() {
    if (!this.active) return;
    this.active = false;
    if (this.mode === 'workshop') this._leaveWorkshop();
    this._stopAudio();
    const P = engine.post.params;
    P.uFade.value = 0; P.uGlitch.value = 0; P.uFlash.value = 0;
    document.body.style.cursor = '';
    engine.resetView();
  }
  _startAudio() {
    if (this._audio.on || !audio.ready) return;
    this._audio.on = true;
    try {
      audio.setReverb('large');
      this._audio.loops = [
        (this._audio.drone = audio.loop('factory_drone', { volume: 0.9 })),
        (this._audio.weld = audio.loop('weld', { pos: this.weldP.clone(), volume: 0 })),
        (this._audio.hum = audio.loop('hum', { pos: V(0, 6.4, 0), volume: 0, params: { flicker: 0 } })),
      ];
    } catch (e) { console.warn('[menu] audio', e); }
  }
  _stopAudio() {
    if (!this._audio.on) return;
    this._audio.on = false;
    for (const l of this._audio.loops) try { l?.stop?.(0.6); } catch (e) { /* */ }
    this._audio.loops = [];
    this._windH?.stop?.(0.2); this._windH = null;
  }

  // ============================================================================ per frame
  update(dt) {
    if (!this.active) this.activate();
    this.t += dt;
    if (audio.ready && !this._audio.on) this._startAudio();
    const asp = window.innerWidth / window.innerHeight;
    if (Math.abs(asp - this.aspect) > 0.01) { this._layout(); if (this.mode === 'workshop') this._fillRack(); }
    if (this.mode === 'intro') this._updateIntro(dt);
    this._updateHover();
    this._updateRobot(dt);
    if (this.mode === 'drop') this._updateDrop(dt);
    this._updateJobs(dt);
    for (const a of this.arms) a.update(dt);
    this._updateLights(dt);
    this._updatePanels(dt);
    this._updateRack(dt);
    this._updateStations(dt);
    this._updateBackline(dt);
    this.hatch.update(dt);
    this.sparks.update(dt);
    this.junk.update(dt);
    this.puffs.update(dt);
    this.motes.update(dt, this.key.intensity / 60);
    this._updateCamera(dt);
    this._updateBackTag(dt);
    this._updatePost(dt);
  }
  _updateIntro(dt) {
    const prev = this.introT; this.introT += dt;
    const t = this.introT, at = (x) => prev < x && t >= x;
    if (t === dt || prev === 0) this._go('hub', 3.4, 0.08);
    this.fx.fade = Math.max(0, 1 - t * 1.2);
    if (at(0.55)) { this._sfx('lights_slam', { volume: 0.55, pos: V(0.6, 6.4, 1.4) }); this.keyFlick = 0.4; }
    const order = [this.panels.new, this.panels.cont, this.panels.settings, this.panels.trophies];
    order.forEach((p, i) => { const tt = 1.15 + i * 0.28; if (at(tt)) { p.on = 0.5; this._sfx('_arc_pop', { volume: 0.35, pos: p.root.position.clone() }); p.kick(0.5); } if (prev < tt + 0.25 && t >= tt + 0.25) p.on = 1; });
    if (t > 3.5) { this.mode = 'hub'; for (const p of order) p.on = 1; }
    if (t > 90) { this.mode = 'hub'; this.fx.fade = 0; for (const p of order) p.on = 1; this.keyFlick = 0; this._go('hub', 0.6, 0.05); }
  }
  _updateHover() {
    let h = null;
    if (this.pointer.has && !this.pointer.touch && !this._drag && this.mode !== 'drop' && this.mode !== 'intro') h = this._pick(this.pointer.x, this.pointer.y);
    if (h !== this.hover) {
      const a = h?.userData.act;
      if (a && ['panel', 'robot', 'item', 'crate', 'plaque', 'lever', 'arrow', 'back', 'dest', 'ctl'].includes(a.type)) this._sfx('ui_blip', { volume: 0.12, bus: 'ui' });
      if (a?.type === 'panel') this.panels[a.key].kick(0.35);
      if (a?.type === 'robot') this.dg.kick(rnd(-0.1, 0.1), rnd(-0.05, 0.05), 0, 0.2);
      this.hover = h;
      document.body.style.cursor = h ? 'pointer' : '';
    }
  }
  _updateLights(dt) {
    const t = this.t;
    // hub work lamp (flicker on start + rare flutter)
    let key = this.mode === 'intro' && this.introT < 0.55 ? 0 : this.mode === 'workshop' ? 34 : 62;
    if (this.keyFlick > 0) { this.keyFlick -= dt; key *= Math.random() < 0.5 ? 0.1 : 1; }
    if (Math.sin(t * 0.7) > 0.995) key *= 0.4;
    if (this.mode === 'drop' && this.drop?.phase >= 2) key = damp(this.key.intensity, 8, 2, dt);
    this.key.intensity = key;
    this.lampLens.color.setRGB(4 * key / 62, 3.4 * key / 62, 2.4 * key / 62);
    // workshop banks
    if (this.mode === 'workshop' && this.bankOn >= 0) {
      this.bankT += dt;
      const want = Math.min(4, Math.floor(this.bankT / 0.34 + 0.4));
      if (want > this.bankOn) { this.bankOn = want; this._sfx('lights_slam', { volume: 0.75, pos: V(-4.5 + (want - 1) * 3, 6.5, 0) }); juice.shake(0.06); this.bankFlick = 0.12; }
    }
    const banks = this.bankOn < 0 ? 0 : this.bankOn;
    if (this.bankOn < 0) { this.bankFade = Math.max(0, (this.bankFade ?? 0) - dt * 2.5); if (this.bankFade <= 0) this.bankOn = 0; }
    else this.bankFade = banks / 4;
    const lv = this.bankFade * (this.bankFlick > 0 ? (Math.random() < 0.5 ? 0.3 : 1) : 1);
    if (this.bankFlick > 0) this.bankFlick -= dt;
    this.ws[0].intensity = 85 * lv; this.ws[1].intensity = 60 * lv;
    this.hemi.intensity = 0.05 + 0.35 * lv;
    this.scene.environmentIntensity = 0.1 + 0.25 * lv;
    this.bankFix.forEach((m, i) => { const on = this.bankOn < 0 ? this.bankFade : i < banks ? 1 : 0; m.color.setRGB(0.05 + 4 * on, 0.05 + 3.9 * on, 0.04 + 3.4 * on); });
    if (this._audio.hum) this._audio.hum.setVolume(0.6 * lv, 0.05);
    // background welder
    const welding = Math.sin(t * 0.9) > 0.1;
    this.weldLight.intensity = welding ? (Math.random() < 0.6 ? rnd(2, 6) : 0.2) : 0;
    if (welding && Math.random() < dt * 25) this.sparks.burst(this.weldP, V(0.4, -0.2, 0.6), 4, 1.8, 0);
    if (this._audio.weld) this._audio.weld.setVolume(welding ? 0.35 : 0, 0.05);
    // station spot
    if (this._stTarget !== undefined) {
      let s = damp(this.stLight.intensity, this._stTarget, 6, dt);
      if (this._stFlick > 0) { this._stFlick -= dt; s = this._stFlick > 0.25 ? 0 : s * (Math.random() < 0.5 ? 0.2 : 1); }
      this.stLight.intensity = s;
    }
    if (this.drop && this.drop.phase < 3) this.beacon.position.set(-1.6 + Math.sin(t * 6) * 0.4, 3.4, 1.2 + Math.cos(t * 6) * 0.4);
    else if (!this.drop) this.beacon.intensity = 0;
    this.lineSign.material.emissiveIntensity = 0.18 + 0.4 * lv;
  }
  _updatePanels(dt) {
    // the sign boxes are winched up into the dark while you are at a station
    const up = this.mode === 'hub' || this.mode === 'intro' ? 0 : 3.4;
    this._panelLift = damp(this._panelLift ?? 0, up, up ? 1.8 : 3.2, dt);
    for (const p of Object.values(this.panels)) {
      p.body.position.y = (p.drop0 ?? p.body.position.y) + this._panelLift / p.root.scale.x;
      for (const c of p.chains) c.scale.y = Math.max(0.05, -p.body.position.y - p.h / 2 - 0.1);
      p.root.visible = p.body.position.y < -0.4;
    }
    for (const [k, p] of Object.entries(this.panels)) {
      const hov = this.hover?.userData.act?.type === 'panel' && this.hover.userData.act.key === k;
      p.update(dt, hov);
    }
  }
  _updateRack(dt) {
    if (!this.rack.visible) return;
    const R = this.rackTarget;
    // ride in from above, flip between sections, follow the layout
    const tgtY = this.mode === 'workshop' ? R.y : R.y + 3;
    this.rack.position.x = damp(this.rack.position.x, R.x, 5, dt);
    this.rack.position.y = damp(this.rack.position.y, tgtY, this.mode === 'workshop' ? 5 : 3, dt);
    this.rack.position.z = damp(this.rack.position.z, R.z, 5, dt);
    if (this.mode !== 'workshop' && this.rack.position.y > R.y + 2.7) this.rack.visible = false;
    const cam = this.rig.p;
    const yaw = Math.atan2(cam.x - this.rack.position.x, cam.z - this.rack.position.z);
    this.rack.rotation.y = damp(this.rack.rotation.y, yaw, 4, dt);
    this.rack.rotation.x = Math.sin(this.t * 0.6) * 0.01;
    let flipA = 0;
    if (this.flip) {
      const F = this.flip; F.t += dt / 0.55;
      flipA = Math.sin(clamp(F.t, 0, 1) * PI) * (PI / 2) * F.dir;
      if (!F.swapped && F.t >= 0.5) {
        F.swapped = true; this.secIdx = F.to;
        this._layoutBoard(); this._fillRack();
        this.dg.yawT = SECTIONS[this.secIdx].yaw;
        this.dg.kick(0, 0, 0.8, 0.3);
        this._sfx('robo_clunk', { volume: 0.5, pos: this.rack.position.clone() });
      }
      if (F.t >= 1) this.flip = null;
    }
    this.rackInner.rotation.y = flipA + (this._rackDrag || 0) * 0.5;
    const hov = this.hover?.userData.act;
    for (const c of this.cells) {
      const h = hov?.type === 'item' && hov.c === c;
      c.spin += dt * (h ? 2.2 : 0.4);
      if (c.item.parent === c.g) {
        c.item.rotation.y = Math.sin(c.spin) * 0.6;
        if (c.pop !== undefined) { c.pop += dt * 3; c.item.scale.setScalar(easeOutBack(clamp(c.pop, 0, 1))); if (c.pop >= 1) c.pop = undefined; }
        else c.item.scale.setScalar(damp(c.item.scale.x, h ? 1.15 : 1, 12, dt));
      }
      if (c.shake > 0) { c.shake -= dt; c.g.rotation.z = Math.sin(c.shake * 40) * 0.12 * c.shake; } else c.g.rotation.z = 0;
      c.lamp.material = c.sel ? this.F.glowAmber : h ? this.F.glowWhite : this.F.ledOff;
    }
    const ah = hov?.type === 'arrow';
    this.arrowMat.emissiveIntensity = ah ? 2.2 : 0.7 + 0.3 * Math.sin(this.t * 3);
  }
  _updateStations(dt) {
    // lever
    if (this.leverT > 0) { this.leverT -= dt; this.leverA = damp(this.leverA, 0.9, 14, dt); } else this.leverA = damp(this.leverA, -0.5, 6, dt);
    this.leverArm.rotation.x = this.leverA;
    this.destSel.update(dt);
    for (const c of this.ctls) c.o.update(dt);
    // crates
    if (this.mode === 'continue' && this._openCratesT > 0) {
      const prev = this._openCratesT; this._openCratesT -= dt;
      if (this.hasSave) this.crates.forEach((c, i) => { const tt = 0.9 - i * 0.35; if (prev > tt && this._openCratesT <= tt) { this._sfx('crate_pry', { pos: c.root.getWorldPosition(V()), volume: 0.7 }); c.pop(i === 2 ? 1 : -1); this.puffs.puff(c.root.getWorldPosition(V()).add(V(0, 0.5, 0)), V(0, 1, 0), 5, 0.35, 0.5, 1.4, 0.12); } });
    }
    const hov = this.hover?.userData.act;
    for (const c of this.crates) {
      c.update(dt);
      const h = hov?.type === 'crate' && hov.i === c.idx && this.mode === 'continue';
      c.root.position.y = damp(c.root.position.y, 0.12 + (h ? 0.03 : 0), 12, dt);
      c.root.rotation.z = damp(c.root.rotation.z, 0, 8, dt);
    }
    if (this.cashTag) this.cashTag.rotation.y = Math.sin(this.t * 1.3) * 0.4;
    if (this.holo) {
      const open = this.crates[2].opened && this.mode === 'continue';
      const k = damp(this.holo.scale.y, open ? 1 : 0.01, open ? 4 : 10, dt);
      this.holo.scale.set(open ? Math.min(1, k * 1.4) : k, k, 1);
      this.holo.position.y = 0.86 + Math.sin(this.t * 1.7) * 0.01;
      this.holo.rotation.y = Math.sin(this.t * 0.5) * 0.12;
      this.holoMat.opacity = 0.85 * (Math.random() < 0.04 ? 0.4 : 1) * (0.92 + 0.08 * Math.sin(this.t * 40));
    }
    // plaques
    for (const p of this.plaques) {
      const h = hov?.type === 'plaque' && hov.p === p;
      p.g.position.z = damp(p.g.position.z, 0.02 + (h ? 0.04 : 0), 10, dt);
      p.mat.emissiveIntensity = damp(p.mat.emissiveIntensity, (p.on ? 1.1 : 0.75) + (h ? 0.5 : 0) + (Math.random() < 0.02 ? -0.3 : 0), 10, dt);
    }
  }
  _updateBackline(dt) {
    this._bl = (this._bl || 0) + 1;
    for (const L of this.line2) {
      L.sw.position.x += dt * 0.32;
      if (L.sw.position.x > 13) L.sw.position.x -= 25.5;
      L.sw.rotation.x = Math.sin(this.t * 1.9 + L.ph) * 0.05; L.sw.rotation.z = Math.sin(this.t * 1.3 + L.ph) * 0.03;
      L.sw.rotation.y = Math.sin(this.t * 0.2 + L.ph) * 0.4;
      if ((this._bl + L.k) % 3 === 0) L.av.update(dt * 3, { expression: 'dead', poseFn: L.fn });
    }
    // measure the hanging clone once it has settled (focus regions)
    if (this.dg.mode === 'hang' && (this._bl % 30 === 1)) {
      this._robTop = this._robotPoint('top', V()).y; this._robFeet = this._robotPoint('feet', V()).y;
    }
  }
  _updateBackTag(dt) {
    const show = !['hub', 'intro', 'drop'].includes(this.mode);
    this.backShow = damp(this.backShow, show ? 1 : 0, 6, dt);
    const g = this.backTag;
    g.visible = this.backShow > 0.02;
    if (!g.visible) return;
    const d = 0.35, hh = Math.tan((this.camera.fov * DEG) / 2) * d, hw = hh * this.camera.aspect;
    const k = clamp(hw / 0.2, 0.5, 1);
    g.scale.setScalar(k);
    g.position.set(-hw + 0.055 * k + 0.008, hh + 0.12 * (1 - this.backShow) + 0.002, -d);
    const s = this.backSw;
    s.v += (-60 * s.a - 3 * s.v - this.rig.vel.x * 0.4) * dt; s.a += s.v * dt;
    const h = this.hover?.userData.act?.type === 'back';
    this.backPiv.rotation.z = s.a + (h ? Math.sin(this.t * 12) * 0.05 : 0);
    this.backPlate.scale.setScalar(h ? 1.12 : 1);
  }
  _updatePost(dt) {
    const P = engine.post.params, f = this.fx;
    f.flash = Math.max(0, f.flash - dt * 3.5);
    P.uFlash.value = Math.max(P.uFlash.value * Math.exp(-8 * dt), f.flash);
    f.glitch = Math.max(0, f.glitch - dt * 1.6);
    P.uGlitch.value = f.glitch;
    if (this.mode !== 'drop' && this.mode !== 'intro') f.fade = Math.max(0, f.fade - dt * 2);
    P.uFade.value = f.fade;
    // letterbox bars for the drop cutscene
    f.letter = damp(f.letter, f.letterT, 3, dt);
    const vis = f.letter > 0.01;
    const d = 0.2, hh = Math.tan((this.camera.fov * DEG) / 2) * d, hw = hh * this.camera.aspect;
    this.letter.forEach((m, i) => {
      m.visible = vis;
      if (!vis) return;
      const bh = hh * 0.24 * f.letter;
      m.scale.set(hw * 2.2, bh * 2, 1);
      m.position.set(0, (i ? -1 : 1) * (hh - bh), -d);
    });
  }
}

const DEFAULT_IRIS = [0.12, 0.16, 0.2];
const _cache2 = new Map();
function cached2(k, f) { if (!_cache2.has(k)) _cache2.set(k, f()); return _cache2.get(k); }
// robot materials use vertex colours: primitives without a colour attribute would render black
function whiteVC(root) {
  root.traverse((m) => {
    if (!m.isMesh || !m.material?.vertexColors || m.geometry.attributes.color) return;
    m.geometry = m.geometry.clone();
    m.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(m.geometry.attributes.position.count * 3).fill(1), 3));
  });
}
function easeOutBack(t) { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
