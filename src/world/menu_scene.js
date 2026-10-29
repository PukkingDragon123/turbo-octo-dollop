// R.O.O.M. — main menu: the CLONE FACTORY. An isolated 3D set rendered through the post stack with
// engine.setView(). There is no HTML on screen: everything is a physical, clickable object.
//
// HUB      A dark assembly hall. Your clone hangs limp from an overhead conveyor hook (it is not alive
//          yet: it dangles, sways and lolls like a ragdoll) under one work lamp. Beside it hang the signs:
//          the R.O.O.M. title marquee, NEW MISSION and CONTINUE (enamel sign boxes with gilt letters in
//          brass frames ringed with marquee bulbs), COMMENDATIONS, and the SETTINGS cog (a brass gear on
//          chains). Hover lights the bulbs / spins the cog; NEW MISSION and CONTINUE drop the clone straight
//          down the floor hatch; the cog and the plaques fly the camera (eased crane moves) to their station.
// WORKSHOP Click the clone: the floodlight banks slam on one by one. Two hydraulic arms flank the hook
//          and a parts board hangs beside it. Swipe (drag / touch) or use the arrow keys to move between
//          sections (FRAME, HEAD SHAPE, BODY SHAPE, CLOTHING, EYES, ACCESSORIES, FACE, SHELL FINISH,
//          HEADWEAR, FACE GEAR, BACKPACK). Clicking a part on the board is brutal: one arm clamps the old
//          part and rips it off (sparks, oil, bolts, the body jerks), the other grabs the new part off the
//          board and slams it on. Choices save to profile.data.cosmetics.
// DROP     NEW MISSION / CONTINUE: alarm, the floor hatch opens, the hook lets go, the camera follows the
//          body down the shaft, impact, the eyes flicker on in the dark cell, then game.enterLobby().
// SETTINGS The calibration gear: a big ring gear with every setting bolted on as a knob / lever / switch
//          (names engraved round the rim); it turns to bring the chosen one under the pointer, the enamel
//          dial in the middle shows the value. Includes the first dimension (destination).
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
  RoboArm, Sparks, Batch, cyl, factoryMats, LiveTex, fitText, wrapLines, HangPanel, Hatch, Knob, Toggle, Selector, GearSign, gearGeo,
  Junk, Puffs, Motes, kitMesh as mesh, kitRbox as rbox, PHOS, brackets, scanlines, phosphorBg, rustySign, rustTex,
} from '../entities/wardrobe.js';
import { FONT } from '../ui/fonts.js';
import { factorySet, signLampShade, machinePlate, plaqueBoard, partsBoard } from './menu_props.js';
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
// (one face everywhere now: FONT.main, Cormorant Garamond; the role names stay for readability)
const F_SIGN = FONT.main, F_TYPE = FONT.main, F_CRT = FONT.main, F_MONO = FONT.main, F_MARK = FONT.main, F_HAND = FONT.main, F_PRINT = FONT.main, F_TITLE = FONT.main;
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
const LEVEL_TITLE = { yellow: 'Level 0', poolrooms: 'Level 37', grasslands: 'Level 1.1' };
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
    // floor markings: walkway lines + the hatch keep-out box
    for (const z of [2.9, -2.4]) B.box(26, 0.004, 0.08, F.yellow, 0, 0.002, z);
    for (const s of [-1, 1]) { B.box(2.6, 0.004, 0.07, F.yellow, 0, 0.003, s * 1.3); B.box(0.07, 0.004, 2.6, F.yellow, s * 1.3, 0.003, 0); }
    // columns, trusses, crane rail, pipes, drums, bin, shelving, pedestals, lamp housings: modelled props
    this.props = factorySet({ railY: RAIL_Y, armBase: ARM_BASE }).object;
    S.add(this.props);
    B.build(S);
    // high windows (faint night light) + the line sign
    const win = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.08, 0.12) });
    for (let x = -12; x <= 12; x += 4) { const m = mesh(new THREE.PlaneGeometry(2.6, 1.4), win, S, x, 7.4, -9.95); m.castShadow = false; }
    const sign = this._tex(1024, 192, (g, w, h) => rustySign(g, w, h, { title: 'CLONE ASSEMBLY \u00b7 LINE 04', sub: 'no unit leaves this floor alive \u00b7 it leaves it finished', seed: 61, paint: 'yellow', ghost: 9, spacing: 0.1 }));
    this.lineSign = this._plane(7, 1.3, new THREE.MeshStandardMaterial({ map: sign.tex, roughness: 0.85, metalness: 0.2 }), S, 0, 5.3, -9.9);
    // ceiling floodlight fixtures in 4 banks (lenses glow when the bank is on)
    this.bankFix = [];
    const lensG = new THREE.PlaneGeometry(1.5, 0.4);
    for (let b = 0; b < 4; b++) {
      const lens = new THREE.MeshBasicMaterial({ color: 0x060504 });
      for (const [x, z] of [[-4.5 + b * 3, 2.2], [-4.5 + b * 3, -2.2]]) {
        this._plane(1.5, 0.4, lens, S, x, 6.598, z, PI / 2);
      }
      this.bankFix.push(lens);
    }
    void lensG;
    // work lamp cage over the hook
    this.lampLens = new THREE.MeshBasicMaterial({ color: 0x050403 });
    const lamp = new THREE.Group(); lamp.position.set(0.6, 6.55, 1.4); S.add(lamp);
    this._plane(0.4, 0.4, this.lampLens, lamp, 0, -0.12, 0, PI / 2).geometry = new THREE.CircleGeometry(0.26, 18);
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
    // the only light on the hub signs: a caged work lamp on a bracket above and in front of them
    const sl = (this.signLamp = new THREE.SpotLight(0xffd8a8, 0, 9.5, 0.74, 0.45, 2));
    sl.position.set(1.7, 4.75, 2.5); sl.target.position.set(1.5, 2.1, 0.38);
    S.add(sl, sl.target);
    const cage = new THREE.Group(); cage.position.copy(sl.position); cage.lookAt(sl.target.position); S.add(cage);
    cage.add(signLampShade().object);
    this.signBulb = new THREE.MeshBasicMaterial({ color: 0x000000 });
    mesh(new THREE.SphereGeometry(0.045, 10, 8), this.signBulb, cage, 0, 0, 0.04).castShadow = false;
    mesh(cyl(0.012, 2.4, 'y', 6), this.F.steel, S, 1.7, 4.75 + 1.2, 2.5).castShadow = false;
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
  // the hub signage: the R.O.O.M. title marquee, enamel sign boxes in brass frames ringed with bulbs, and
  // the SETTINGS cog (a brass gear hanging on chains)
  _buildPanels() {
    const mk = (key, p) => {
      this.scene.add(p.root);
      if (key) this._addHit(p.hit, { type: 'panel', key, modes: ['hub'] });
      p.on = 0;
      return p;
    };
    this.panels = {
      title: mk(null, new HangPanel({ w: 1.62, h: 0.46, seed: 5, paint: 'green' })),
      new: mk('new', new HangPanel({ w: 1.5, h: 0.36, seed: 12, paint: 'blue' })),
      cont: mk('cont', new HangPanel({ w: 1.5, h: 0.36, seed: 27, paint: 'yellow' })),
      trophies: mk('trophies', new HangPanel({ w: 0.92, h: 0.3, seed: 33, paint: 'red', crooked: -0.2 })),
      settings: mk('settings', new GearSign({ r: 0.27 })),
    };
    this._refreshPanels();
  }
  _refreshPanels() {
    const P = this.panels, s = save.summary();
    this.hasSave = !!s;
    P.title.setText('R.O.O.M.', 'clone assembly \u00b7 line 04', { big: true, ghost: 4 });
    P.new.setText('New Mission', 'print \u00b7 assemble \u00b7 dispatch');
    P.cont.setText('Continue', s ? `${LEVEL_TITLE[s.level] || 'Level 0'} \u00b7 day ${s.day} of 7 \u00b7 ${money(s.credits)}` : 'no record on file', { dim: !s, ghost: 5 });
    P.settings.setText('SETTINGS');
    const n = Object.keys(ACHIEVEMENTS).length, got = Object.keys(ACHIEVEMENTS).filter((k) => profile.has(k)).length;
    P.trophies.setText('Commendations', `${got} of ${n} earned`);
  }

  // ============================================================================ build: settings (the calibration gear)
  // A big cast-iron ring gear on a riveted wall plate. Every setting is bolted onto the ring as a knob, a
  // lever or a rotary switch, its name engraved in the enamel band around the rim. The ring turns (two
  // smaller gears and a crank turn with it) to bring the chosen setting up under the brass pointer; the
  // fixed enamel dial in the middle shows its name and value. Click a control (or its sector) to bring it
  // up, drag a knob, click a lever / switch; arrows / A D / wheel turn the gear, W S / up down adjust.
  _buildSettings() {
    const F = this.F;
    const g = (this.setG = new THREE.Group());
    g.position.set(-5.6, 0, -1.2); g.rotation.y = PI / 2 - 0.25;
    this.scene.add(g);
    const C = (this.gearC = V(0, 1.55, 0)), R = 0.8;
    const iron = new THREE.MeshStandardMaterial({ color: 0x5a5048, roughness: 0.42, metalness: 0.55 });
    this.setFill = new THREE.PointLight(0xffd6a0, 0, 4.5, 2); this.setFill.position.set(0.3, 2.0, 1.1); g.add(this.setFill);
    const mp = machinePlate(2.5, 2.2, 1.62).object; mp.position.z = -0.17; g.add(mp);
    mesh(cyl(0.05, 0.22, 'z', 20), F.dark, g, C.x, C.y, -0.08);
    // the ring gear (turns)
    this.gear = new THREE.Group(); this.gear.position.copy(C); g.add(this.gear);
    mesh(gearGeo(R, R - 0.055, 40, 0.07, { hole: 0.275 }), iron, this.gear);
    this.gearBandTex = this._tex(2048, 2048);
    const band = new THREE.RingGeometry(0.575, 0.735, 120, 1);
    this.gearBandMat = new THREE.MeshStandardMaterial({ map: this.gearBandTex.tex, emissiveMap: this.gearBandTex.tex, emissive: 0xffffff, emissiveIntensity: 0.32, roughness: 0.3, metalness: 0.3 });
    this._plane(1, 1, this.gearBandMat, this.gear, 0, 0, 0.043).geometry = band;
    mesh(new THREE.TorusGeometry(0.575, 0.008, 6, 96), F.brass, this.gear, 0, 0, 0.043).castShadow = false;
    // side gears meshing with the ring (+ a crank on the right one)
    this.sideGears = [];
    for (const [a, r, n] of [[PI + 0.42, 0.36, 18], [-0.42, 0.36, 18], [-PI / 2 - 0.05, 0.22, 11]]) {
      const d = R + r - 0.052, sg = new THREE.Group();
      sg.position.set(C.x + Math.cos(a) * d, C.y + Math.sin(a) * d, -0.075); g.add(sg);
      mesh(gearGeo(r, r - 0.05, n, 0.05, { hole: 0.03, holes: n > 12 ? 5 : 0, holeR: r * 0.2, holeAt: r * 0.55 }), F.brass, sg);
      mesh(cyl(0.045, 0.09, 'z', 16), F.dark, g, sg.position.x, sg.position.y, -0.075);
      this.sideGears.push({ g: sg, k: -(40 / n), ph: (n % 2 ? 0 : PI / n) });
    }
    const crank = new THREE.Group(); this.sideGears[1].g.add(crank);
    mesh(new THREE.BoxGeometry(0.05, 0.3, 0.025), F.dark, crank, 0, 0.15, 0.05);
    mesh(cyl(0.022, 0.14, 'z', 14), F.redPaint, crank, 0, 0.28, 0.12);
    this._addHit(mesh(new THREE.BoxGeometry(0.16, 0.42, 0.2), new THREE.MeshBasicMaterial({ visible: false }), crank, 0, 0.18, 0.08), { type: 'crank', modes: ['settings'] });
    // the fixed dial in the middle (name + value) and the pointer at twelve o'clock
    mesh(cyl(0.262, 0.05, 'z', 64), F.brass, g, C.x, C.y, 0.02);
    this.crt = this._tex(768, 768);
    const dial = this._plane(1, 1, new THREE.MeshStandardMaterial({ map: this.crt.tex, emissiveMap: this.crt.tex, emissive: 0xffffff, emissiveIntensity: 0.22, roughness: 0.22, metalness: 0.05 }), g, C.x, C.y, 0.047);
    dial.geometry = new THREE.CircleGeometry(0.235, 64);
    mesh(new THREE.TorusGeometry(0.236, 0.008, 6, 64), F.brass, g, C.x, C.y, 0.048).castShadow = false;
    const ptr = new THREE.Group(); ptr.position.set(C.x, C.y + R + 0.03, 0.09); g.add(ptr);
    mesh(new THREE.ConeGeometry(0.045, 0.13, 4), F.brass, ptr, 0, -0.02, 0, 0, PI / 4, PI);
    mesh(new THREE.BoxGeometry(0.16, 0.05, 0.05), F.dark, ptr, 0, 0.07, -0.03);
    this.ptrLamp = mesh(new THREE.SphereGeometry(0.022, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2, 0.9) }), ptr, 0, 0.11, 0);
    this.ptrLamp.castShadow = false;
    // gilt name plate over the machine
    const np = this._tex(1024, 192, (x, w, h) => rustySign(x, w, h, { title: 'SETTINGS', sub: 'clone calibration engine', seed: 51, paint: 'steel', spacing: 0.22, bolts: [[0.04, 0.5, false], [0.96, 0.5, true]] }));
    this._plane(1.2, 0.225, new THREE.MeshStandardMaterial({ map: np.tex, bumpMap: np.tex, bumpScale: 1, roughness: 0.82, metalness: 0.25 }), g, 0, 2.66, -0.12).rotation.z = 0.025;
    // the controls, bolted onto the ring: [key, type, label, min, max] (sel: options)
    const defs = [
      ['master', 'knob', 'Master volume', 0, 1, 'Master'], ['sfx', 'knob', 'Effects', 0, 1], ['music', 'knob', 'Music', 0, 1], ['ambient', 'knob', 'Ambience', 0, 1],
      ['voice', 'knob', 'Voice chat', 0, 1.5, 'Voices'], ['voiceMode', 'sel', 'Microphone', ['open', 'ptt', 'off'], 0, 'Mic'], ['sensitivity', 'knob', 'Look speed', 0.2, 3, 'Look'],
      ['invertY', 'toggle', 'Invert look', 0, 0, 'Invert'], ['quality', 'sel', 'Graphics', ['low', 'medium', 'high']], ['healthityVoice', 'toggle', 'Healthity voice', 0, 0, 'Healthity'],
      ['destination', 'sel', 'First dimension', DESTS, 0, 'Dimension'],
    ];
    const n = defs.length, step = TAU / n;
    this.gearStep = step; this.gearSel = 0; this.gearRot = 0; this.gearRotT = 0; this.gearV = 0;
    this.ctls = [];
    defs.forEach(([key, type, label, a, b, short], i) => {
      const th = PI / 2 - i * step;
      let o;
      if (type === 'knob') o = new Knob(0.058);
      else if (type === 'toggle') o = new Toggle();
      else o = new Selector(3, 0.05);
      const slot = new THREE.Group(); slot.position.set(Math.cos(th) * 0.43, Math.sin(th) * 0.43, 0.041); slot.rotation.z = th - PI / 2;
      this.gear.add(slot); slot.add(o.root);
      if (type === 'toggle') o.root.scale.setScalar(1.35);
      mesh(cyl(0.085, 0.008, 'z', 28), F.dark, slot, 0, 0, 0.002);
      const c = { key, type, o, i, label, short, min: a, max: b, opts: type === 'sel' ? a : null };
      if (type === 'sel') { c.min = 0; c.max = 2; }
      this._addHit(o.hit, { type: 'ctl', c, modes: ['settings'] });
      if (o.pad) this._addHit(o.pad, { type: 'ctl', c, modes: ['settings'] });
      // the whole sector is a click target too (brings it up)
      const sec = mesh(new THREE.RingGeometry(0.29, 0.75, 6, 1, th - step / 2, step), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }), this.gear, 0, 0, 0.03);
      this._addHit(sec, { type: 'gearSel', i, modes: ['settings'] });
      this.ctls.push(c);
    });
    this._syncControls(true);
    this._drawGearBand();
    this.activeCtl = this.ctls[0];
    this._drawCrt();
  }
  // turn the ring so setting i sits under the pointer (shortest way round)
  _gearSelect(i, snd = true) {
    const n = this.ctls.length;
    i = ((i % n) + n) % n;
    let t = i * this.gearStep;
    while (t - this.gearRotT > PI) t -= TAU;
    while (t - this.gearRotT < -PI) t += TAU;
    this.gearRotT = t;
    if (this.gearSel !== i && snd) this._sfx('robo_clunk', { volume: 0.35, pitch: 1.4, bus: 'ui' });
    this.gearSel = i;
    this.activeCtl = this.ctls[i];
    this._drawCrt();
  }
  _nudgeSetting(dir) {
    const c = this.activeCtl;
    if (!c) return;
    if (c.type === 'knob') {
      const v = clamp(this._ctlValue(c) + dir * (c.max - c.min) * 0.05, c.min, c.max);
      c.o.set((v - c.min) / (c.max - c.min)); this._applySetting(c, v); this._sfx('knob_tick', { volume: 0.5, bus: 'ui', pitch: 0.8 + v * 0.4 });
    } else if (c.type === 'toggle') { const v = !this._ctlValue(c); c.o.set(v); this._applySetting(c, v, true); this._sfx('toggle_clack', { volume: 0.8, bus: 'ui' }); }
    else { const i = clamp(c.o.i + dir, 0, 2); if (i !== c.o.i) { c.o.set(i); this._applySetting(c, i, true); this._sfx('knob_tick', { volume: 0.9, bus: 'ui' }); } }
    this._drawCrt();
  }
  _ctlValue(c) {
    const s = profile.settings;
    if (c.key === 'quality') return Math.max(0, c.opts.indexOf(engine.qualityName || s.quality));
    if (c.key === 'voiceMode') return Math.max(0, c.opts.indexOf(s.voiceMode || 'open'));
    if (c.key === 'destination') return Math.max(0, c.opts.indexOf(s.destination || 'yellow'));
    if (c.key === 'healthityVoice') return s.healthityVoice !== false;
    if (c.key === 'invertY') return !!s.invertY;
    return s[c.key] ?? 1;
  }
  _syncControls() {
    for (const c of this.ctls) {
      const v = this._ctlValue(c);
      if (c.type === 'knob') c.o.set((v - c.min) / (c.max - c.min));
      else c.o.set(v);
    }
  }
  // the engraved enamel band: each setting's name around the rim, reading outwards
  _drawGearBand() {
    const n = this.ctls.length, step = TAU / n;
    this.gearBandTex.draw((x, w, h) => {
      const cx = w / 2, cy = h / 2, k = w / 2 / 0.735;
      x.clearRect(0, 0, w, h);
      const rg = x.createRadialGradient(cx, cy, 0.575 * k, cx, cy, 0.735 * k);
      rg.addColorStop(0, '#120c07'); rg.addColorStop(0.5, '#1e140b'); rg.addColorStop(1, '#0e0905');
      x.fillStyle = rg; x.beginPath(); x.arc(cx, cy, 0.735 * k, 0, TAU); x.arc(cx, cy, 0.575 * k, 0, TAU, true); x.fill();
      x.strokeStyle = '#c99a4c'; x.lineWidth = 4;
      for (const r of [0.588, 0.722]) { x.beginPath(); x.arc(cx, cy, r * k, 0, TAU); x.stroke(); }
      x.textAlign = 'center'; x.textBaseline = 'middle';
      this.ctls.forEach((c, i) => {
        const th = PI / 2 - i * step;
        // sector ticks
        const tb = th + step / 2;
        x.lineWidth = 3; x.beginPath(); x.moveTo(cx + Math.cos(tb) * 0.592 * k, cy - Math.sin(tb) * 0.592 * k); x.lineTo(cx + Math.cos(tb) * 0.718 * k, cy - Math.sin(tb) * 0.718 * k); x.stroke();
        // the name, set along the arc (centred on the sector, letters upright at the top)
        const txt = (c.short || c.label).toUpperCase(), r = 0.655 * k;
        let fs = Math.round(0.052 * k);
        x.font = `700 ${fs}px ${FONT.main}`;
        const fit = (step * r * 0.8) / (x.measureText(txt).width * 1.12);
        if (fit < 1) { fs = Math.floor(fs * fit); x.font = `700 ${fs}px ${FONT.main}`; }
        const tw = x.measureText(txt).width * 1.12, a0 = th + (tw / r) / 2;
        let a = a0;
        for (const ch of txt) {
          const cw = x.measureText(ch).width * 1.12, am = a - (cw / r) / 2;
          x.save(); x.translate(cx + Math.cos(am) * r, cy - Math.sin(am) * r); x.rotate(PI / 2 - am);
          x.fillStyle = '#e9c069'; x.fillText(ch, 0, 0); x.restore();
          a -= cw / r;
        }
      });
    });
  }
  _drawSettingsFace() { this._drawGearBand(); }
  _fmt(c) {
    const v = this._ctlValue(c);
    if (c.type === 'toggle') return v ? 'On' : 'Off';
    if (c.type === 'sel') { const o = c.opts[v]; return c.key === 'destination' ? (LEVEL_TITLE[o] || o) : ({ low: 'Low', medium: 'Medium', high: 'High', open: 'Open mic', ptt: 'Push to talk', off: 'Off' }[o] || o); }
    if (c.key === 'sensitivity') return v.toFixed(2) + '×';
    return Math.round(v * 100) + '%';
  }
  // the enamel dial in the middle of the gear: the setting under the pointer and its value
  _drawCrt() {
    const a = this.activeCtl;
    if (!this.crt) return;
    this.crt.draw((x, w, h) => {
      const cx = w / 2, cy = h / 2, R = w / 2;
      const bg = x.createRadialGradient(cx, cy * 0.8, R * 0.1, cx, cy, R);
      bg.addColorStop(0, '#f4ead2'); bg.addColorStop(0.8, '#e1d2ad'); bg.addColorStop(1, '#b9a57a');
      x.fillStyle = bg; x.fillRect(0, 0, w, h);
      x.strokeStyle = '#2a1c10'; x.lineWidth = 4; x.beginPath(); x.arc(cx, cy, R * 0.93, 0, TAU); x.stroke();
      x.lineWidth = 1.5; x.beginPath(); x.arc(cx, cy, R * 0.88, 0, TAU); x.stroke();
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#2a1c10';
      if (!a) return;
      fitText(x, a.label, cx, cy - R * 0.38, R * 1.35, 92, `italic 600 {s}px ${FONT.main}`);
      x.fillStyle = '#1a1008';
      fitText(x, this._fmt(a), cx, cy + R * 0.04, R * 1.45, 176, `700 {s}px ${FONT.main}`);
      if (a.type === 'knob') {
        const k = clamp((this._ctlValue(a) - a.min) / (a.max - a.min), 0, 1), a0 = PI * 0.8, a1 = PI * 2.2;
        x.lineCap = 'round'; x.lineWidth = 14; x.strokeStyle = 'rgba(40,28,16,0.18)'; x.beginPath(); x.arc(cx, cy, R * 0.74, a0, a1); x.stroke();
        x.strokeStyle = '#9a2a1a'; x.beginPath(); x.arc(cx, cy, R * 0.74, a0, a0 + (a1 - a0) * k); x.stroke();
        for (let i = 0; i <= 10; i++) { const b = a0 + ((a1 - a0) * i) / 10; x.lineWidth = i % 5 ? 2 : 4; x.strokeStyle = '#2a1c10'; x.beginPath(); x.moveTo(cx + Math.cos(b) * R * 0.8, cy + Math.sin(b) * R * 0.8); x.lineTo(cx + Math.cos(b) * R * (i % 5 ? 0.84 : 0.86), cy + Math.sin(b) * R * (i % 5 ? 0.84 : 0.86)); x.stroke(); }
      } else if (a.type === 'sel') {
        a.opts.forEach((o, i) => { const on = i === this._ctlValue(a); x.fillStyle = on ? '#9a2a1a' : 'rgba(40,28,16,0.35)'; x.beginPath(); x.arc(cx + (i - 1) * 60, cy + R * 0.4, on ? 16 : 11, 0, TAU); x.fill(); });
      } else {
        x.fillStyle = this._ctlValue(a) ? '#9a2a1a' : 'rgba(40,28,16,0.35)'; x.beginPath(); x.arc(cx, cy + R * 0.4, 16, 0, TAU); x.fill();
      }
      x.fillStyle = 'rgba(42,28,16,0.75)';
      fitText(x, a.type === 'knob' ? 'drag the knob' : a.type === 'toggle' ? 'pull the lever' : 'turn the switch', cx, cy + R * 0.62, R * 1.1, 38, `italic 600 {s}px ${FONT.main}`);
    });
  }
  _applySetting(c, v, commit = false) {
    let raw;
    if (c.type === 'toggle') raw = String(!!v);
    else if (c.type === 'sel') raw = c.opts[v];
    else { const st = 0.05; raw = String(Math.round(clamp(v, c.min, c.max) / st) * st); }
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
    this.troBoard = plaqueBoard(4.4, 3.2).object; this.troBoard.position.set(0, 2.3, -0.012); g.add(this.troBoard);
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
        const c1 = on ? PHOS.hi : '#9a8358', c2 = on ? PHOS.mid : '#7a6440';
        brackets(x, 8, 8, w - 16, h - 16, 24, c2, 3, on ? 8 : 0);
        x.shadowColor = PHOS.mid; x.shadowBlur = on ? 10 : 0; x.textBaseline = 'top';
        x.fillStyle = c1; fitText(x, A.name.toUpperCase(), w / 2, 18, w - 40, 30, `{s}px ${F_CRT}`);
        x.fillStyle = c2; x.fillRect(24, 54, w - 48, 2);
        x.font = `20px ${F_MONO}`; x.fillStyle = c2; x.textAlign = 'center';
        wrapLines(x, A.desc, w - 48).slice(0, 3).forEach((l, i) => x.fillText(l, w / 2, 64 + i * 24));
        if (rw.length) {
          x.fillStyle = on ? PHOS.soft : '#6e5a3a'; x.font = `22px ${F_CRT}`;
          wrapLines(x, '\u25B8 SPECIAL ISSUE: ' + rw.map((r) => r.name.toUpperCase()).join(', '), w - 40).slice(0, 2).forEach((l, i) => x.fillText(l, w / 2, 152 + i * 24));
        }
        if (!on) {
          for (let i = 0; i < 260; i++) { x.fillStyle = `rgba(200,160,90,${Math.random() * 0.08})`; x.fillRect(Math.random() * w, Math.random() * h, 2, 1); }
          x.save(); x.translate(w - 70, h - 34); x.rotate(-0.12); x.strokeStyle = '#6e5a3a'; x.lineWidth = 2; x.strokeRect(-58, -16, 116, 32); x.fillStyle = '#6e5a3a'; x.font = `22px ${F_CRT}`; x.textBaseline = 'middle'; x.fillText('CLASSIFIED', 0, 1); x.restore();
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
    this.rackBoard = partsBoard().object; this.rackInner.add(this.rackBoard);
    this.rackHead = this._tex(1024, 160);
    this.rackHeadM = this._plane(1, 0.16, new THREE.MeshStandardMaterial({ map: this.rackHead.tex, bumpMap: this.rackHead.tex, bumpScale: 1, roughness: 0.82, metalness: 0.2 }), this.rackInner, 0, 0, 0.005);
    const arrowG = new THREE.ConeGeometry(0.06, 0.11, 3); arrowG.rotateZ(-PI / 2);
    this.arrowMat = new THREE.MeshStandardMaterial({ color: 0xa8842e, map: rustTex(), roughness: 0.75, metalness: 0.3 });
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
    this.rackBoard.position.set(0, -0.06, -0.012);
    this.rackHeadM.position.set(0, L.h / 2 + 0.06, 0.006); this.rackHeadM.scale.set(L.w, 1, 1);
    this.arrows[0].position.set(-L.w / 2 + 0.07, L.h / 2 + 0.06, 0.04); this.arrows[1].position.set(L.w / 2 - 0.07, L.h / 2 + 0.06, 0.04);
    this.rackHead.draw((x, w, h) => rustySign(x, w, h, { title: sec.title, sub: `${String(this.secIdx + 1).padStart(2, '0')} of ${SECTIONS.length} \u00b7 ${sec.sub.toLowerCase()} \u00b7 swipe \u25c4 \u25ba`, seed: 40 + this.secIdx, paint: 'blue', spacing: 0.12 }));
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
      const lab = this._tex(512, 128, (x, w, h) => rustySign(x, w, h, ok ? { title: o.name.toUpperCase(), seed: 90 + i, paint: 'label', spacing: 0.04 } : { title: 'LOCKED', sub: ACHIEVEMENTS[o.unlock]?.name || o.unlock, seed: 90 + i, paint: 'red' }));
      c.label = this._plane(L.cell - 0.03, (L.cell - 0.03) / 4, new THREE.MeshStandardMaterial({ map: lab.tex, roughness: 0.82, metalness: 0.2 }), c.g, 0, -L.cell / 2 + (L.cell - 0.03) / 8 + 0.01, 0.012);
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
    const t = this._tex(256, 96, (x, w, h) => { rustySign(x, w, h, { title: '\u2039 BACK', seed: 17, paint: 'yellow', spacing: 0.12, bolts: [[0.08, 0.5, false]] }); });
    this.backPiv = new THREE.Group(); g.add(this.backPiv);
    const chain = mesh(cyl(0.0012, 0.08, 'y', 4), new THREE.MeshBasicMaterial({ color: 0x777777 }), this.backPiv, 0, -0.04, 0); chain.castShadow = false;
    this.backPlate = this._plane(0.07, 0.026, new THREE.MeshBasicMaterial({ map: t.tex, side: THREE.DoubleSide }), this.backPiv, 0, -0.093, 0);
    this._addHit(this.backPlate, { type: 'back', modes: ['workshop', 'settings', 'trophies', 'plaque'] });
    const pad = mesh(new THREE.BoxGeometry(0.1, 0.05, 0.01), new THREE.MeshBasicMaterial({ visible: false }), this.backPiv, 0, -0.093, 0);
    this._addHit(pad, { type: 'back', modes: ['workshop', 'settings', 'trophies', 'plaque'] });
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
    const px = portrait ? 1.05 : 1.38, ceil = 7.0;
    // title marquee, NEW MISSION, CONTINUE, then COMMENDATIONS and the SETTINGS cog side by side
    const at = portrait
      ? [[P.title, 0, 3.5], [P.new, 0, 2.9], [P.cont, 0, 2.35], [P.trophies, -0.36, 1.83], [P.settings, 0.5, 1.8]]
      : [[P.title, 0, 3.36], [P.new, 0, 2.76], [P.cont, 0, 2.21], [P.trophies, -0.4, 1.67], [P.settings, 0.45, 1.61]];
    for (const [p, dx, y] of at) { p.root.scale.setScalar(1); p.place(px + dx, y, 0.38, ceil, -0.12); p.drop0 = p.body.position.y; }
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
        const P = this.panels, x1 = (port ? 1.05 : 1.38) + 0.86;
        const l = V((x1 - 0.42) / 2, port ? 2.5 : 2.37, 0.2);
        const hw = (x1 + 0.42) / 2 + 0.05, hh = port ? 1.55 : 1.36;
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
      case 'settings': {
        const g = this.setG; g.updateWorldMatrix(true, false);
        const l = g.localToWorld(V(0, 1.7, 0));
        const dir = V(0, 0.06, 1).transformDirection(g.matrixWorld).normalize();
        return { p: this._fitPos(l, dir, 1.32, 1.14, 46, 1.03), l, fov: 46 };
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
      if (this.mode === 'settings') {
        if (e.code === 'ArrowRight' || e.code === 'KeyD') this._gearSelect(this.gearSel + 1);
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') this._gearSelect(this.gearSel - 1);
        if (e.code === 'ArrowUp' || e.code === 'KeyW') this._nudgeSetting(1);
        if (e.code === 'ArrowDown' || e.code === 'KeyS') this._nudgeSetting(-1);
        if (e.code === 'Enter' || e.code === 'Space') this._nudgeSetting(1);
      }
    };
    this._onCtx = (e) => { if (!this.active || this.game.state !== 'menu') return; e.preventDefault(); this._back(); };
    window.addEventListener('pointermove', this._onMove, { passive: true, capture: true });
    window.addEventListener('pointerdown', this._onDown, { passive: true, capture: true });
    window.addEventListener('pointerup', this._onUp, { passive: true, capture: true });
    window.addEventListener('pointercancel', (e) => { if (this._drag?.id === e.pointerId) { if (this._drag.ctl) this._endCtl(this._drag); this._drag = null; } }, { passive: true, capture: true });
    window.addEventListener('keydown', this._onKey, { capture: true });
    window.addEventListener('contextmenu', this._onCtx);
    // the wheel turns the settings gear
    this._wheelT = 0;
    window.addEventListener('wheel', (e) => {
      if (!this.active || this.game.state !== 'menu' || this.mode !== 'settings' || Math.abs(e.deltaY) < 4) return;
      const now = performance.now(); if (now - this._wheelT < 120) return; this._wheelT = now;
      this._gearSelect(this.gearSel + (e.deltaY > 0 ? 1 : -1));
    }, { passive: true });
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
        this._signTouch(p, 1.6);
        this._sfx('toggle_clack', { volume: 0.6, bus: 'ui' });
        // NEW MISSION / CONTINUE drop straight down the hatch (no dispatch console, no lever)
        if (act.key === 'new') { this._sfx('robo_clunk', { volume: 0.6 }); this._startDrop(false); }
        else if (act.key === 'cont') {
          if (!save.summary()) { this._sfx('buzzer', { volume: 0.35, bus: 'ui' }); p.kick(3); this._shake(0.08); break; }
          this._sfx('robo_clunk', { volume: 0.6 }); this._startDrop(true);
        } else if (act.key === 'settings') { this._sfx('robo_whir', { volume: 0.3, pitch: 1.4, bus: 'ui' }); this._enter('settings'); }
        else this._enter('trophies');
        break;
      }
      case 'robot': this._enter('workshop'); break;
      case 'back': this._back(); break;
      case 'arrow': this._section(this.secIdx + act.dir); break;
      case 'item': this._choose(act.c.cat, act.c.o.id, act.c); break;
      case 'gearSel': this._gearSelect(act.i); break;
      case 'crank': this._gearSelect(this.gearSel + 1); this.gearV -= 2; break;
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
  // a sign was touched: it swings and creaks on its chains and shakes a little rust dust loose
  _signTouch(p, k = 1) {
    p.kick(k);
    const pos = p.body.getWorldPosition(V()); pos.y += (p.h || 0.4) / 2 + 0.04;
    this._sfx('sign_creak', { pos: pos.clone(), volume: 0.3 + 0.2 * Math.min(1, k), pitch: rnd(0.85, 1.15) });
    this.puffs.puff(pos, V(0, -1, 0), 3 + Math.round(k * 3), 0.1, 0.2, 1.6, 0.18, 0x7a6450);
  }

  // settings drags
  _beginCtl(d) {
    const c = d.ctl;
    if (c.i !== undefined) this._gearSelect(c.i); else { this.activeCtl = c; this._drawCrt(); }
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
    const g = name === 'settings' ? this.setG : this.troG;
    g.updateWorldMatrix(true, false);
    const off = name === 'settings' ? V(0, 3.1, 1.6) : V(0, 4.6, 2.2);
    const tgt = name === 'settings' ? V(0, 1.6, 0) : V(0, 2.3, 0);
    L.position.copy(g.localToWorld(off)); L.target.position.copy(g.localToWorld(tgt));
    L.angle = name === 'trophies' ? 0.7 : 0.55;
    L.distance = name === 'trophies' ? 9 : 7;
    this._stTarget = name === 'trophies' ? 16 : 18;
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
        juice.hitstop(100); juice.shake(0.5); this.fx.flash = 0.3;
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
    const order = [this.panels.title, this.panels.new, this.panels.cont, this.panels.trophies, this.panels.settings];
    order.forEach((p, i) => { const tt = 1.15 + i * 0.28; if (at(tt)) { p.on = 0.5; this._sfx('_arc_pop', { volume: 0.35, pos: p.root.position.clone() }); p.kick(0.5); } if (prev < tt + 0.25 && t >= tt + 0.25) p.on = 1; });
    if (t > 3.5) { this.mode = 'hub'; for (const p of order) p.on = 1; }
    if (t > 90) { this.mode = 'hub'; this.fx.fade = 0; for (const p of order) p.on = 1; this.keyFlick = 0; this._go('hub', 0.6, 0.05); }
  }
  _updateHover() {
    let h = null;
    if (this.pointer.has && !this.pointer.touch && !this._drag && this.mode !== 'drop' && this.mode !== 'intro') h = this._pick(this.pointer.x, this.pointer.y);
    if (h !== this.hover) {
      const a = h?.userData.act;
      if (a && ['robot', 'item', 'plaque', 'arrow', 'back', 'ctl', 'gearSel', 'crank'].includes(a.type)) this._sfx('ui_blip', { volume: 0.12, bus: 'ui' });
      if (a?.type === 'panel') this._signTouch(this.panels[a.key], 0.7);
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
    // the hub signs' work lamp: a caged bulb that slams on in the intro and is never quite steady
    const hubOn = this.mode === 'hub' || this.mode === 'intro' || this.mode === 'drop';
    const on = this.panels.new.on < 1 ? (Math.random() < 0.5 ? 0.08 : 1) * this.panels.new.on : 1;
    let sl = 34 * on * (hubOn ? 1 : 0.35);
    if (Math.sin(t * 0.43) > 0.985 || Math.random() < dt * 0.3) sl *= 0.25;
    this.signLamp.intensity = damp(this.signLamp.intensity, sl, 18, dt);
    this.signBulb.color.setRGB(0.3 + 3.2 * this.signLamp.intensity / 34, 0.2 + 2.4 * this.signLamp.intensity / 34, 0.1 + 1.2 * this.signLamp.intensity / 34);
  }
  _updatePanels(dt) {
    // the sign boxes are winched up into the dark while you are at a station
    const up = this.mode === 'hub' || this.mode === 'intro' ? 0 : 3.4;
    this._panelLift = damp(this._panelLift ?? 0, up, up ? 1.8 : 3.2, dt);
    for (const p of Object.values(this.panels)) {
      p.body.position.y = (p.drop0 ?? p.body.position.y) + this._panelLift / p.root.scale.x;
      for (const c of p.chains) c.scale.y = Math.max(0.05, -p.body.position.y - p.top);
      p.root.visible = p.body.position.y < -0.4;
    }
    for (const [k, p] of Object.entries(this.panels)) {
      const hov = this.hover?.userData.act?.type === 'panel' && this.hover.userData.act.key === k;
      if (p.update(dt, hov)) this._sfx('knob_tick', { volume: 0.22, bus: 'ui', pitch: 0.7 });
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
    for (const c of this.ctls) c.o.update(dt);
    // the settings gear: a sprung turn towards the chosen sector; the side gears and the crank follow
    const prev = this.gearRot;
    this.gearV += ((this.gearRotT - this.gearRot) * 90 - this.gearV * 13) * dt;
    this.gearRot += this.gearV * dt;
    this.gear.rotation.z = this.gearRot;
    for (const s of this.sideGears) s.g.rotation.z = this.gearRot * s.k + s.ph;
    const tooth = TAU / 40, sel = this.mode === 'settings';
    if (sel && Math.floor(prev / tooth) !== Math.floor(this.gearRot / tooth)) this._sfx('_tick_small', { volume: 0.3, bus: 'ui' });
    this.ptrLamp.material.color.setRGB(sel ? 3 : 0.6, sel ? 2 : 0.4, sel ? 0.9 : 0.2);
    this.gearBandMat.emissiveIntensity = sel ? 0.55 : 0.2;
    this.setFill.intensity = damp(this.setFill.intensity, sel ? 4 : 0, 4, dt);
    const hov = this.hover?.userData.act;
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
