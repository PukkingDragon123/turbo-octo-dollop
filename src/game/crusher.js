// The CRUSHER: R.O.O.M. asset compactor + teleport uplink, the camp loop's sell AND receive point.
//   Drop loot into the chamber, press [E]: the shutter drops, the hydraulic ram slams the lot into a glowing
//   cube (sparks, debris, screen shake), the cube beams up and its value uploads to every watch.
//   Store purchases materialise inside the chamber in a teleport flash.
//   ESCAPE GAUGE: a giant mercury thermometer on the right column shows run.escape / level quota.
// Device id 'crusher' (same on every peer). Host authoritative cycle; every peer animates from fx:
//   { k: 'crusher', e: 'crush' | 'slam' | 'mat' | 'eject' | ... }  (routed by CampMission.playFx)
import * as THREE from 'three';
import { net } from '../net/net.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { Device } from './devices.js';
import * as Mat from '../gfx/materials.js';
import { CrtScreen, text, bar } from '../ui/crt.js';
import { juice } from '../gfx/juice.js';
import { floatText } from '../ui/floattext.js';
import { itemName, itemDef, sellValue } from './itemdefs.js';
import { fmt$, short$ } from './economy.js';
import { modelHalfHeight } from '../entities/catalog.js';

const PI = Math.PI;
// layout (local, front = +Z, origin = floor centre)
const CX = 1.15, CZ0 = -0.95, CZ1 = 0.95, BED = 0.24, CTOP = 2.05;
const RAM_H = 0.5, RAM_REST = 2.12;
// cycle timeline (s)
const T = { gate: 0.5, lower0: 0.6, lower1: 1.4, slam: 1.58, hold: 2.0, rise: 2.9, beam0: 2.25, beam1: 3.0, upload: 3.05, gateUp0: 3.15, gateUp1: 3.6, done: 3.75 };
const CRUSH_DMG = 75;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function stripes(ctx, x, y, w, h, s = 28) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = '#141414'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#f2c418';
  for (let i = -h; i < w + h; i += s * 2) { ctx.beginPath(); ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + h, y); ctx.lineTo(x + i + h + s, y); ctx.lineTo(x + i + s, y + h); ctx.fill(); }
  ctx.restore();
}

let _tex = null;
function textures() {
  if (_tex) return _tex;
  const sign = canvasTex(1024, 200, (c, w, h) => {
    c.fillStyle = '#1a1c1f'; c.fillRect(0, 0, w, h);
    stripes(c, 0, 0, w, 22); stripes(c, 0, h - 22, w, 22);
    c.fillStyle = '#f2c418'; c.font = '900 74px "IBM Plex Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('ASSET COMPACTOR', w / 2, 78);
    c.fillStyle = '#e8e2d2'; c.font = 'bold 30px "IBM Plex Mono", monospace';
    c.fillText('R.O.O.M. CX-9  ·  CRUSH  ·  COMPRESS  ·  TELEPORT', w / 2, 136);
    c.fillStyle = '#ff5a3a'; c.font = 'bold 22px "IBM Plex Mono", monospace';
    c.fillText('KEEP HANDS, FEET AND COWORKERS CLEAR OF THE PRESS', w / 2, 166);
  });
  const hazard = canvasTex(512, 64, (c, w, h) => stripes(c, 0, 0, w, h, 24));
  const bed = canvasTex(512, 512, (c, w, h) => {
    c.fillStyle = '#2b2f33'; c.fillRect(0, 0, w, h);
    stripes(c, 0, 0, w, 26); stripes(c, 0, h - 26, w, 26);
    c.save(); c.translate(w / 2, h / 2);
    c.strokeStyle = 'rgba(160,230,255,0.5)'; c.lineWidth = 3;
    for (let r = 40; r < 220; r += 34) { c.beginPath(); c.arc(0, 0, r, 0, PI * 2); c.stroke(); }
    for (let i = 0; i < 16; i++) { c.rotate(PI / 8); c.beginPath(); c.moveTo(30, 0); c.lineTo(220, 0); c.stroke(); }
    c.restore();
    c.fillStyle = 'rgba(220,214,196,0.8)'; c.font = 'bold 26px "IBM Plex Mono", monospace'; c.textAlign = 'center';
    c.fillText('TELEPORT BED', w / 2, h / 2 + 8);
    for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; c.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 1 + Math.random() * 3); }
  });
  const scale = canvasTex(256, 1024, (c, w, h) => {
    c.fillStyle = '#ece6d4'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#1a1c1f'; c.fillRect(0, 0, w, 120); c.fillRect(0, h - 70, w, 70);
    c.fillStyle = '#f2c418'; c.font = '900 34px "IBM Plex Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('ESCAPE', w / 2, 40); c.fillText('FUND', w / 2, 82);
    c.fillStyle = '#ff5a3a'; c.font = 'bold 22px "IBM Plex Mono", monospace'; c.fillText('LEVEL QUOTA', w / 2, h - 36);
    // ticks: top of tube = y 150, bottom = y 900 (matches the tube in the model)
    const y0 = 900, y1 = 150;
    c.textAlign = 'left';
    for (let i = 0; i <= 40; i++) {
      const y = y0 + (y1 - y0) * (i / 40);
      const major = i % 10 === 0, mid = i % 5 === 0;
      c.fillStyle = '#1a1c1f';
      c.fillRect(150, y - (major ? 2 : 1), major ? 70 : mid ? 46 : 26, major ? 4 : 2);
      if (major) { c.font = 'bold 30px "IBM Plex Mono", monospace'; c.fillText(['$0', '250K', '500K', '750K', '$1M'][i / 10], 8, y); }
    }
    c.fillStyle = '#c8241c'; c.fillRect(150, y1 - 30, 70, 8);
    c.font = '900 22px "IBM Plex Mono", monospace'; c.fillText('EXIT', 160, y1 - 52);
  });
  _tex = { sign, hazard, bed, scale };
  return _tex;
}

let _beamTex = null;
function beamTexture() {
  if (_beamTex) return _beamTex;
  _beamTex = canvasTex(8, 128, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.6, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,1)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });
  _beamTex.colorSpace = THREE.NoColorSpace;
  return _beamTex;
}

function box(w, h, d, mat, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}
function cyl(r, h, mat, x, y, z, parent, seg = 20, rt = r) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, r, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}
function emis(color, i = 1) {
  const m = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: color, emissiveIntensity: i, roughness: 0.4 });
  m.userData.noProbe = true;
  return m;
}

export class Crusher extends Device {
  constructor(world, mission, x, y, z, yaw) {
    super(world, 'crusher', { state: { busy: 0 } });
    this.mission = mission;
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    this.root.name = 'crusher';
    this.label = 'CRUSHER';
    this.kind = 'crusher';
    this.range = 4.2;
    this._build();
    this.root.updateMatrixWorld(true);
    this.inv = this.root.matrixWorld.clone().invert();
    this.contents = { count: 0, total: 0, names: [], items: [], zero: [] };
    this._scanT = 0;
    this.cycle = null;       // every peer: { t0 } while a crush runs
    this.hostCycle = null;   // host
    this.queue = [];         // host: purchased types waiting to materialise
    this._matT = 0;
    this._matN = 0;
    this.lastSale = 0;
    this.lastCombo = 1;
    this.gauge = 0;          // displayed escape fraction (eased)
    this.beams = [];
    this.cube = null;
    this.t = 0;
    net.onClient('crushed', (d) => this._crushed(d.dmg));
  }

  // ------------------------------------------------------------------ model
  _build() {
    const R = this.root, tx = textures();
    const yellow = Mat.get('metal_yellow'), dark = Mat.get('metal_dark'), steel = Mat.get('steel');
    const chrome = Mat.get('chrome'), rubber = Mat.get('rubber');
    const g = new THREE.Group(); R.add(g);
    // plinth with hazard edge
    box(3.8, BED, 2.5, dark, 0, BED / 2, -0.15, g);
    const hz = new THREE.MeshStandardMaterial({ map: tx.hazard, roughness: 0.6, metalness: 0.3 });
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(3.8, BED - 0.02), hz);
    edge.position.set(0, BED / 2, 1.101); g.add(edge);
    // teleport bed
    const bedMat = new THREE.MeshStandardMaterial({ map: tx.bed, roughness: 0.55, metalness: 0.5 });
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(CX * 2, CZ1 - CZ0), bedMat);
    bed.rotation.x = -PI / 2; bed.position.set(0, BED + 0.003, (CZ0 + CZ1) / 2); bed.receiveShadow = true; g.add(bed);
    this.bedRingMat = emis(0x4fe0ff, 0.6);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.02, 8, 48), this.bedRingMat);
    ring.rotation.x = -PI / 2; ring.position.set(0, BED + 0.01, 0); g.add(ring);
    // chamber walls (heavy steel, riveted)
    for (const s of [-1, 1]) {
      box(0.3, CTOP - BED, CZ1 - CZ0 + 0.3, dark, s * (CX + 0.15), (CTOP + BED) / 2, (CZ0 + CZ1) / 2 - 0.15, g);
      for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) cyl(0.025, 0.02, steel, s * (CX + 0.001), 0.5 + i * 0.34, -0.6 + j * 0.6, g, 8).rotation.z = PI / 2;
    }
    box(CX * 2 + 0.6, CTOP - BED, 0.3, dark, 0, (CTOP + BED) / 2, CZ0 - 0.15, g);
    // wear plates inside
    box(CX * 2 - 0.1, 0.5, 0.02, Mat.get('rust'), 0, BED + 0.3, CZ0 + 0.011, g);
    // columns (I-beams) and crosshead
    for (const s of [-1, 1]) {
      const cx = s * (CX + 0.5);
      box(0.4, 4.4, 0.08, yellow, cx, 2.2, 0.42, g);
      box(0.4, 4.4, 0.08, yellow, cx, 2.2, -0.62, g);
      box(0.08, 4.4, 1.0, yellow, cx, 2.2, -0.1, g);
    }
    box(3.9, 0.7, 1.7, yellow, 0, 4.1, -0.1, g);
    box(3.95, 0.08, 1.75, dark, 0, 3.72, -0.1, g);
    // header plate with the sign (front, above the chamber mouth)
    box(CX * 2 + 0.6, 0.72, 0.12, dark, 0, CTOP + 0.36, CZ1 + 0.06, g);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(CX * 2 + 0.5, 0.62), new THREE.MeshStandardMaterial({ map: tx.sign, roughness: 0.6, metalness: 0.2, emissive: 0xffffff, emissiveMap: tx.sign, emissiveIntensity: 0.08 }));
    sign.position.set(0, CTOP + 0.36, CZ1 + 0.121); g.add(sign);
    // hydraulic cylinders (fixed sleeves under the crosshead) and the ram with its rods
    for (const s of [-1, 1]) {
      cyl(0.22, 1.05, chrome, s * 0.55, 3.2, -0.05, g, 24);
      cyl(0.25, 0.08, dark, s * 0.55, 2.66, -0.05, g, 24);
      cyl(0.25, 0.08, dark, s * 0.55, 3.72, -0.05, g, 24);
    }
    this.ram = new THREE.Group(); R.add(this.ram);
    box(CX * 2 - 0.08, RAM_H, CZ1 - CZ0 - 0.08, steel, 0, RAM_H / 2, 0, this.ram);
    for (let i = 0; i < 6; i++) box(0.05, 0.06, CZ1 - CZ0 - 0.1, dark, -0.9 + i * 0.36, 0.02, 0, this.ram);
    box(CX * 2 - 0.04, 0.12, CZ1 - CZ0 - 0.04, yellow, 0, RAM_H - 0.06, 0, this.ram);
    for (const s of [-1, 1]) cyl(0.11, 2.4, chrome, s * 0.55, RAM_H + 1.2, -0.05 - 0.0, this.ram, 18);
    this.ram.position.set(0, RAM_REST, 0);
    // shutter: vertical bars that extend down over the chamber mouth
    this.gate = new THREE.Group(); this.gate.position.set(0, CTOP, CZ1 + 0.02); R.add(this.gate);
    const barMat = Mat.get('steel');
    for (let i = 0; i < 13; i++) cyl(0.018, CTOP - BED, barMat, -CX + 0.08 + i * ((CX * 2 - 0.16) / 12), -(CTOP - BED) / 2, 0, this.gate, 8);
    for (const y of [0.35, 0.95, 1.55]) box(CX * 2 - 0.1, 0.05, 0.04, Mat.get('metal_red'), 0, -y, 0, this.gate);
    this.gate.scale.y = 0.001; this.gate.visible = false;
    // teleport coils in the back corners
    this.coilMat = emis(0x5ae8ff, 0.3);
    for (const s of [-1, 1]) {
      cyl(0.04, 1.5, dark, s * (CX - 0.12), BED + 0.75, CZ0 + 0.12, g, 10);
      for (let i = 0; i < 9; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.016, 6, 16), Mat.get('brass')); t.rotation.x = PI / 2; t.position.set(s * (CX - 0.12), BED + 0.2 + i * 0.15, CZ0 + 0.12); g.add(t); }
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), this.coilMat); tip.position.set(s * (CX - 0.12), BED + 1.58, CZ0 + 0.12); g.add(tip);
    }
    // hoses down the back
    const hose = (pts) => { const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))); const m = new THREE.Mesh(new THREE.TubeGeometry(c, 30, 0.05, 8), rubber); m.castShadow = true; g.add(m); };
    hose([[-0.55, 3.9, -0.95], [-0.7, 3.2, -1.3], [-1.0, 1.4, -1.45], [-1.3, 0.3, -1.4]]);
    hose([[0.55, 3.9, -0.95], [0.75, 3.0, -1.32], [1.1, 1.2, -1.45], [1.35, 0.3, -1.38]]);
    box(0.9, 0.7, 0.5, dark, 1.4, 0.35 + BED, -1.6, g); // pump unit
    // warning beacon on top
    this.beaconMat = emis(0xffa020, 0.4);
    cyl(0.12, 0.06, dark, -1.4, 4.48, 0.4, g, 16);
    this.beacon = cyl(0.1, 0.2, this.beaconMat, -1.4, 4.61, 0.4, g, 16);
    // pressure dial on the left column
    const dial = new THREE.Mesh(new THREE.CircleGeometry(0.2, 32), new THREE.MeshStandardMaterial({ color: 0xece6d4, roughness: 0.5 }));
    dial.position.set(-(CX + 0.5), 2.95, 0.472); g.add(dial);
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 8, 32), chrome); bezel.position.copy(dial.position); g.add(bezel);
    this.needle = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.17, 0.01), Mat.get('metal_red'));
    this.needle.geometry.translate(0, 0.075, 0);
    this.needle.position.set(dial.position.x, dial.position.y, 0.48); g.add(this.needle);
    // ESCAPE GAUGE: a tall thermometer beside the right column
    const gx = CX + 1.1;
    box(0.62, 3.9, 0.12, dark, gx, 2.15, 0.25, g);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 3.6), new THREE.MeshStandardMaterial({ map: tx.scale, roughness: 0.7 }));
    plate.position.set(gx, 2.15, 0.312); g.add(plate);
    // the scale texture maps y 150..900 of 1024 to the tube: plate spans 3.6 m centred at 2.15
    const yAt = (py) => 2.15 + 1.8 - (py / 1024) * 3.6;
    this.tubeY0 = yAt(900); this.tubeY1 = yAt(150);
    const tubeX = gx - 0.06;
    const glass = new THREE.MeshStandardMaterial({ color: 0xcfe8ee, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.28, depthWrite: false });
    glass.userData.noProbe = true;
    const tube = cyl(0.06, this.tubeY1 - this.tubeY0 + 0.12, glass, tubeX, (this.tubeY0 + this.tubeY1) / 2, 0.38, g, 16); tube.castShadow = false;
    this.mercMat = emis(0xff2a1a, 1.4);
    this.merc = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 1, 14), this.mercMat);
    this.merc.geometry.translate(0, 0.5, 0);
    this.merc.position.set(tubeX, this.tubeY0, 0.38); g.add(this.merc);
    this.bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), this.mercMat);
    this.bulb.position.set(tubeX, this.tubeY0 - 0.14, 0.38); g.add(this.bulb);
    const cap = cyl(0.075, 0.08, chrome, tubeX, this.tubeY1 + 0.08, 0.38, g, 16); void cap;
    this.exitLampMat = emis(0x30ff60, 0.15);
    this.exitLamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 10), this.exitLampMat);
    this.exitLamp.position.set(gx, 4.22, 0.36); g.add(this.exitLamp);
    // counter display under the gauge
    const cnt = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.21), new THREE.MeshBasicMaterial({ color: 0 }));
    cnt.position.set(gx, 0.42, 0.315); g.add(cnt);
    this.counter = new CrtScreen(320, 120, 'green');
    this.counter.fps = 6;
    this.counter.attach(cnt, 1.6);
    // control console at the front left: CRT + big red button
    const kx = -(CX + 1.0), kz = 1.15;
    box(0.66, 1.0, 0.5, dark, kx, 0.5, kz, g);
    box(0.7, 0.06, 0.56, yellow, kx, 1.02, kz, g);
    const head = new THREE.Group(); head.position.set(kx, 1.05, kz - 0.05); head.rotation.x = -0.5; g.add(head);
    box(0.62, 0.46, 0.3, Mat.get('plastic_beige'), 0, 0.23, -0.1, head);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.34), new THREE.MeshBasicMaterial({ color: 0 }));
    scr.position.set(0, 0.24, 0.051); head.add(scr);
    this.scr = new CrtScreen(512, 352, 'green');
    this.scr.fps = 8;
    this.scr.attach(scr, 1.5);
    this.button = new THREE.Group(); this.button.position.set(kx + 0.18, 1.07, kz + 0.17); g.add(this.button);
    cyl(0.085, 0.04, Mat.get('metal_yellow'), 0, 0.0, 0, this.button, 20);
    this.btnMat = new THREE.MeshStandardMaterial({ color: 0xc81e14, emissive: 0xff2010, emissiveIntensity: 0.3, roughness: 0.35 });
    this.btnCap = new THREE.Mesh(new THREE.SphereGeometry(0.07, 18, 10, 0, PI * 2, 0, PI / 2), this.btnMat);
    this.btnCap.position.y = 0.03; this.btnCap.scale.y = 0.6; this.button.add(this.btnCap);
    // colliders
    const half = (w, h, d) => [w, h, d];
    this.addColliders([
      { type: 'box', size: half(3.8, BED, 2.5), pos: [0, BED / 2, -0.15] },
      { type: 'box', size: half(0.3, CTOP - BED, CZ1 - CZ0 + 0.3), pos: [-(CX + 0.15), (CTOP + BED) / 2, -0.15] },
      { type: 'box', size: half(0.3, CTOP - BED, CZ1 - CZ0 + 0.3), pos: [CX + 0.15, (CTOP + BED) / 2, -0.15] },
      { type: 'box', size: half(CX * 2 + 0.6, CTOP - BED, 0.3), pos: [0, (CTOP + BED) / 2, CZ0 - 0.15] },
      { type: 'box', size: half(0.42, 4.4, 1.12), pos: [-(CX + 0.5), 2.2, -0.1] },
      { type: 'box', size: half(0.42, 4.4, 1.12), pos: [CX + 0.5, 2.2, -0.1] },
      { type: 'box', size: half(CX * 2 + 0.6, 1.7, 1.9), pos: [0, CTOP + 0.85, -0.05] },
      { type: 'box', size: half(0.62, 3.9, 0.3), pos: [gx, 2.15, 0.28] },
      { type: 'box', size: half(0.7, 1.4, 0.6), pos: [kx, 0.7, kz] },
      { type: 'box', size: half(0.9, 0.7, 0.5), pos: [1.4, 0.35 + BED, -1.6] },
    ]);
  }

  // world-space chamber centre (y = a bit above the bed)
  chamberPos(out = new THREE.Vector3(), y = 0.6) { return out.set(0, BED + y, 0).applyMatrix4(this.root.matrixWorld); }

  _inChamber(p) {
    _v.copy(p).applyMatrix4(this.inv);
    return _v.x > -CX - 0.05 && _v.x < CX + 0.05 && _v.z > CZ0 - 0.05 && _v.z < CZ1 + 0.12 && _v.y > BED - 0.2 && _v.y < CTOP;
  }

  get online() { return this.mission.padsOnline; }
  nearLocal(r = 12) { return this.root.position.distanceTo(this.world.game.local.pos) < r; }

  _scan() {
    const out = { count: 0, total: 0, names: [], items: [], zero: [] };
    const c = this.chamberPos(_v2, 0.8);
    this.world.props.query(c, 2.2, (p) => {
      if (p.dead || p.frozen || !this._inChamber(p.root.position)) return;
      const v = sellValue(p.type, p.mass, p.state);
      if (v <= 0) { out.zero.push(p); return; }
      out.count++; out.total += v; out.names.push(itemName(p.type)); out.items.push(p);
    });
    return out;
  }

  // ------------------------------------------------------------------ interaction
  prompt() {
    const k = input.keyName('interact');
    if (!this.online) return 'ASSET COMPACTOR — OFFLINE. Build your camp first.';
    if (this.cycle) return 'COMPACTING... stand clear!';
    const c = this.contents;
    if (!c.count) return 'ASSET COMPACTOR — drop loot into the chamber, then press the button';
    const combo = 1 + Math.min(0.6, (c.count - 1) * 0.06);
    return `[${k}] CRUSH & UPLOAD — ${c.count} item${c.count === 1 ? '' : 's'} (~${short$(c.total * combo)})`;
  }

  interact() {
    if (!this.online || this.cycle) { audio.play('ui_error', { volume: 0.4, bus: 'ui' }); return; }
    this.btnPress = 1;
    audio.play('button_press', { pos: this.button.getWorldPosition(_v), volume: 0.9 });
    this.send('crush');
  }

  hostAction(a, d, from) {
    if (a !== 'crush' || !this.online || this.hostCycle) return;
    const c = this._scan();
    if (!c.count) { this.mission.econ?._msg(from, 'The chamber is empty. Drop loot into it first.', 'warn'); return; }
    this.hostCycle = { t0: this.world.time, hit: false, ej: false, up: false };
    this.setState({ busy: 1 });
    this.world.fxAll({ k: 'crusher', e: 'crush', n: c.count });
    this.world.noise.emit(this.root.position, 30, 'crusher');
  }

  // host: queue a purchased item for teleport delivery
  hostDeliver(type) { this.queue.push(type); }

  _hostUpdate(dt) {
    const w = this.world;
    const hc = this.hostCycle;
    if (hc) {
      const t = w.time - hc.t0;
      if (!hc.ej && t >= 0.3) {
        hc.ej = true;
        // worthless things (camp parts, upgrade crates...) get shoved back out of the mouth
        const c = this._scan();
        c.zero.forEach((p, i) => {
          w.grab.releaseAllFor(p.id);
          const out = _v.set(-0.8 + (i % 4) * 0.55, BED + 0.5, CZ1 + 0.9).applyMatrix4(this.root.matrixWorld);
          w.props.teleport(p, out.clone());
        });
      }
      if (!hc.hit && t >= T.slam) {
        hc.hit = true;
        const c = this._scan();
        const list = [];
        for (const p of c.items) {
          if (p.dead) continue;
          list.push({ type: p.type, v: sellValue(p.type, p.mass, p.state), state: p.state });
          w.grab.releaseAllFor(p.id);
          this.mission.game.tools.unweld?.(p);
          w.props.despawn(p.id);
        }
        // clones standing in the press
        for (const r of this.mission.game.roster.values()) {
          if (r.dead) continue;
          const pos = r.id === net.selfId ? this.mission.game.local.pos : r.pose ? _v2.fromArray(r.pose.p) : null;
          if (!pos || !this._inChamber(_v2.copy(pos).setY(pos.y + 0.4))) continue;
          if (r.id === net.selfId) this._crushed(CRUSH_DMG); else net.toPeer(r.id, 'crushed', { dmg: CRUSH_DMG });
        }
        const res = this.mission.econ ? this.mission.econ.hostDelivered(list) : { total: 0, combo: 1 };
        w.fxAll({ k: 'crusher', e: 'slam', v: res.total, n: list.length, combo: +res.combo.toFixed(2) });
        w.noise.emit(this.root.position, 40, 'crusher');
      }
      if (t >= T.done) {
        this.hostCycle = null;
        this.setState({ busy: 0 });
      }
      return;
    }
    // deliveries
    this._matT -= dt;
    if (this.queue.length && this._matT <= 0) {
      this._matT = 0.75;
      const type = this.queue.shift();
      const n = this._matN++ % 6;
      const hh = modelHalfHeight(type);
      const pos = _v.set(-0.7 + (n % 3) * 0.7, BED + hh + 0.35 + Math.floor(n / 3) * 0.4, -0.3 + Math.floor(n / 3) * 0.5).applyMatrix4(this.root.matrixWorld).clone();
      const st = type === 'flashlight' ? { charge: 1 } : type === 'distorter' ? { charge: 1 } : type === 'welder' ? { fuel: 1 } : {};
      w.props.spawn(type, pos, _q.setFromEuler(new THREE.Euler(0, this.root.rotation.y + Math.random() * 0.6, 0)).clone(), { state: st, vel: new THREE.Vector3(0, -0.5, 0) });
      w.fxAll({ k: 'crusher', e: 'mat', p: pos.toArray(), type });
    }
  }

  _crushed(dmg) {
    const l = this.mission.game.local;
    if (l.dead) return;
    l.survival.damage(dmg, 'blunt', { cause: 'the asset compactor' });
    juice.shake(0.9);
    audio.play('hurt', { volume: 0.9 });
    this.mission.game.ui.toast('CRUSHED. Please stand clear of the press.', 'bad');
    if (l.survival.dead) l.onDeath('the asset compactor');
  }

  // ------------------------------------------------------------------ fx (every peer)
  playFx(m) {
    const w = this.world;
    const g = this.mission.game;
    switch (m.e) {
      case 'crush':
        this.cycle = { t0: w.time, slammed: false, beamed: false, uploaded: false, v: 0, n: m.n };
        audio.play('alarm', { pos: this.beacon.getWorldPosition(_v), volume: 0.5, pitch: 1.3 });
        audio.play('pipe_hiss', { pos: this.chamberPos(_v, 1.6), volume: 0.8 });
        break;
      case 'slam': {
        if (!this.cycle) this.cycle = { t0: w.time - T.slam, slammed: false, beamed: false, uploaded: false };
        this.cycle.v = m.v; this.cycle.n = m.n; this.cycle.combo = m.combo;
        this.lastSale = m.v; this.lastCombo = m.combo;
        this._slamFx(m);
        break;
      }
      case 'mat': this._matFx(new THREE.Vector3().fromArray(m.p)); break;
      case 'install': {
        const p = new THREE.Vector3().fromArray(m.p);
        w.fx.sparks(p, 24, new THREE.Vector3(0, 1, 0), [0.5, 1, 0.7], 3);
        w.fx.glow(p, [0.6, 1.6, 0.9], 1.0, 0.3);
        audio.play('fuse_insert', { pos: p, volume: 1 });
        audio.play('credits', { volume: 0.5, bus: 'ui', pitch: 1.4 });
        break;
      }
      case 'scanned':
        if (m.to === net.selfId) {
          floatText.notice(`RESEARCH DATA UPLOADED  +${fmt$(m.v)}\n${m.label}`, { color: '#7ad8ff', duration: 3.2 });
          audio.play('credits', { volume: 0.6, bus: 'ui', pitch: 1.2 });
          g.watch?.notify(`STUDIED: ${m.label} (+${short$(m.v)})`, 'good', 'SCANNER');
        }
        break;
      case 'questReady':
        audio.play('notification', { volume: 0.6, bus: 'ui' });
        break;
      case 'claim':
        this.mission.questKiosk?.onClaimFx?.(m);
        audio.play(m.main ? 'tent_pop' : 'credits', { volume: 0.7, bus: 'ui' });
        if (m.v) setTimeout(() => audio.play('coin', { volume: 0.5, bus: 'ui' }), 260);
        if (m.main) { juice.flash(0.25); juice.punch(0.05); }
        break;
      default: break;
    }
  }

  _slamFx(m) {
    const w = this.world;
    const c = this.chamberPos(_v, 0.15);
    const d = c.distanceTo(this.mission.game.local.pos);
    const near = clamp01(1 - d / 22);
    juice.shake(0.25 + near * 0.55);
    if (near > 0.3) juice.hitstop(70);
    audio.play('crusher_slam', { pos: c, volume: 1.2 });
    audio.play('impact_heavy', { pos: c, intensity: 1, volume: 1 });
    w.fx.sparks(c, 60, null, [1, 0.75, 0.35], 6);
    w.fx.dustBurst(c, 50, [0.62, 0.58, 0.5], 2.4);
    w.fx.chunks?.(c.clone().setY(c.y + 0.3), 16, 0x8a8478, 0.07, 5, this.root.position.y + BED);
    w.fx.flashLight(c, 0xffc070, 16, 0.18, 9);
    // the compressed cube (local visual), sized by the haul
    const s = Math.min(0.85, 0.28 + Math.sqrt(Math.max(1, m.n)) * 0.14);
    if (!this.cube) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x6c6a64, roughness: 0.55, metalness: 0.7, emissive: 0x2ad8ff, emissiveIntensity: 0 });
      this.cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1, 3, 3, 3), mat);
      const pos = this.cube.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * (1 + (Math.random() - 0.5) * 0.12), pos.getY(i) * (1 + (Math.random() - 0.5) * 0.12), pos.getZ(i) * (1 + (Math.random() - 0.5) * 0.12));
      this.cube.geometry.computeVertexNormals();
      this.cube.castShadow = true;
      this.root.add(this.cube);
    }
    this.cube.visible = m.n > 0;
    this.cube.scale.set(s * 1.25, s * 0.55, s);
    this.cube.position.set(0, BED + s * 0.275, 0);
    this.cube.rotation.y = (Math.random() - 0.5) * 0.4;
    this.cube.material.emissiveIntensity = 0;
    this.cubeS = s;
  }

  _matFx(p) {
    const w = this.world;
    audio.play('teleport_in', { pos: p, volume: 1 });
    w.fx.flashLight(p, 0x8fe8ff, 12, 0.4, 6);
    w.fx.sparks(p, 30, new THREE.Vector3(0, 1, 0), [0.5, 0.9, 1], 3.5);
    w.fx.glow(p, [0.6, 1.4, 2], 1.4, 0.35);
    this._beam(_v.copy(p).applyMatrix4(this.inv).setY(BED), 0.9);
  }

  _beam(localPos, dur) {
    const mat = new THREE.MeshBasicMaterial({ map: beamTexture(), color: 0x7fe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    mat.userData.noProbe = true;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, CTOP - BED, 24, 1, true), mat);
    m.position.set(localPos.x, BED + (CTOP - BED) / 2, localPos.z);
    this.root.add(m);
    this.beams.push({ m, t: 0, dur });
  }

  // ------------------------------------------------------------------ frame
  update(dt) {
    const w = this.world, g = this.mission.game;
    this.t += dt;
    this._scanT -= dt;
    if (this._scanT <= 0) { this._scanT = 0.25; this.contents = this._scan(); }
    if (net.isHost) this._hostUpdate(dt);
    // cycle animation
    let ramY = RAM_REST, gate = 0, press = 0;
    const cy = this.cycle;
    if (cy) {
      const t = w.time - cy.t0;
      gate = t < T.gate ? ease(t / T.gate) : t < T.gateUp0 ? 1 : 1 - ease(clamp01((t - T.gateUp0) / (T.gateUp1 - T.gateUp0)));
      const low = BED + (this.cubeS ? this.cubeS * 0.55 : 0.3);
      const mid = Math.max(low + 0.55, 1.1);
      if (t < T.lower0) ramY = RAM_REST;
      else if (t < T.lower1) ramY = RAM_REST + (mid - RAM_REST) * ease((t - T.lower0) / (T.lower1 - T.lower0));
      else if (t < T.slam) { const k = (t - T.lower1) / (T.slam - T.lower1); ramY = mid + (low - mid) * k * k; }
      else if (t < T.hold) ramY = low + Math.sin((t - T.slam) * 60) * 0.01 * Math.max(0, 1 - (t - T.slam) * 4);
      else if (t < T.rise) ramY = low + (RAM_REST - low) * ease((t - T.hold) / (T.rise - T.hold));
      press = t < T.lower1 ? clamp01((t - T.lower0) / (T.lower1 - T.lower0)) * 0.4 : t < T.hold ? 1 : clamp01(1 - (t - T.hold) / 1.2);
      // cube glows, beams up and vanishes
      if (this.cube?.visible && t > T.beam0) {
        const k = clamp01((t - T.beam0) / (T.beam1 - T.beam0));
        this.cube.material.emissiveIntensity = k * 3;
        if (!cy.beamed) {
          cy.beamed = true;
          this._beam(this.cube.position, 0.9);
          audio.play('teleport_whoosh', { pos: this.chamberPos(_v, 0.4), volume: 1 });
          w.fx.flashLight(this.chamberPos(_v, 0.6), 0x8fe8ff, 14, 0.5, 8);
        }
        const s = this.cubeS * (1 - k * 0.9);
        this.cube.scale.set(s * 1.25, this.cubeS * 0.55 * (1 - k) + k * 1.2, s);
        this.cube.position.y = BED + this.cubeS * 0.275 + k * 0.6;
        if (k >= 1) this.cube.visible = false;
      }
      if (!cy.uploaded && t >= T.upload && cy.v != null && cy.n != null && (cy.v || cy.n === 0)) {
        cy.uploaded = true;
        if (cy.v > 0) {
          const combo = cy.combo > 1.001 ? `  ·  x${cy.n} COMBO +${Math.round((cy.combo - 1) * 100)}%` : '';
          floatText.notice(`+${fmt$(cy.v)} UPLOADED TO YOUR WATCH${combo}`, { color: '#7dffb0', duration: 3.4 });
          g.watch?.notify(`+${short$(cy.v)} UPLOADED (${cy.n} item${cy.n === 1 ? '' : 's'})`, 'good', 'CRUSHER');
          audio.play('credits', { volume: 0.9, bus: 'ui' });
          for (let i = 1; i < Math.min(6, cy.n + 1); i++) setTimeout(() => audio.play('coin', { volume: 0.45, bus: 'ui', pitch: 1 + i * 0.08 }), 90 * i);
        }
      }
      if (t > T.done + 0.2) this.cycle = null;
    }
    this.ram.position.y = ramY;
    this.gate.visible = gate > 0.01;
    this.gate.scale.y = Math.max(0.001, gate);
    this.needle.rotation.z = 2.2 - (press * 0.85 + Math.sin(this.t * 23) * 0.02 * press) * 4.4;
    // bed ring + coils + beacon
    const busy = !!cy;
    this.bedRingMat.emissiveIntensity = !this.online ? 0.1 : busy ? 3 + Math.sin(this.t * 20) : this.contents.count ? 1.6 + Math.sin(this.t * 6) * 0.6 : 0.6 + Math.sin(this.t * 2) * 0.2;
    this.bedRingMat.emissive.setHex(this.contents.count && !busy ? 0x7dffb0 : 0x4fe0ff);
    this.coilMat.emissiveIntensity = this.beams.length ? 4 : busy ? 1.5 : this.online ? 0.5 : 0.05;
    const flash = busy && Math.floor(this.t * 6) % 2 === 0;
    this.beaconMat.emissiveIntensity = flash ? 5 : 0.3;
    if (flash && !this._flashOn) w.fx.flashLight(this.beacon.getWorldPosition(_v), 0xffa030, 5, 0.12, 9); // pooled fx light: no extra scene light
    this._flashOn = flash;
    this.beacon.rotation.y += dt * (busy ? 9 : 0);
    this.btnPress = Math.max(0, (this.btnPress || 0) - dt * 4);
    this.btnCap.position.y = 0.03 - this.btnPress * 0.02;
    this.btnMat.emissiveIntensity = this.online && !busy && this.contents.count ? 1.2 + Math.sin(this.t * 7) * 0.8 : 0.2;
    // beams
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.t += dt;
      const k = b.t / b.dur;
      b.m.material.opacity = Math.sin(Math.min(1, k) * PI) * (0.7 + 0.3 * Math.sin(b.t * 50));
      b.m.scale.set(1 - k * 0.4, 1, 1 - k * 0.4);
      if (k >= 1) { b.m.removeFromParent(); b.m.geometry.dispose(); b.m.material.dispose(); this.beams.splice(i, 1); }
    }
    // escape gauge
    const econ = this.mission.econ;
    const frac = econ ? clamp01(econ.escape / econ.quota) : 0;
    this.gauge += (frac - this.gauge) * Math.min(1, dt * 2.2);
    this.merc.scale.y = Math.max(0.002, (this.tubeY1 - this.tubeY0) * this.gauge);
    this.mercMat.emissiveIntensity = 1.2 + (frac >= 1 ? Math.sin(this.t * 8) * 0.8 + 1 : 0);
    this.exitLampMat.emissiveIntensity = frac >= 1 ? (Math.floor(this.t * 3) % 2 ? 6 : 1) : 0.15;
    if (!this.nearLocal(26)) return;
    this._drawScreens(dt, econ, frac);
  }

  _drawScreens(dt, econ, frac) {
    const c = this.contents, cy = this.cycle, w = this.world;
    this.scr.draw(dt, (ctx, W, H, pal, t) => {
      text(ctx, 'ASSET COMPACTOR // UPLINK', 14, 8, 30, pal.hi);
      ctx.fillStyle = pal.dim; ctx.fillRect(14, 42, W - 28, 2);
      if (!this.online) {
        text(ctx, 'OFFLINE', W / 2, 110, 76, Math.floor(t * 2) % 2 ? pal.bad : pal.dim, 'center');
        text(ctx, 'BUILD YOUR CAMP FIRST', W / 2, 210, 30, pal.fg, 'center');
        return;
      }
      if (cy) {
        const tt = w.time - cy.t0;
        const phase = tt < T.slam ? 'COMPACTING' : tt < T.beam1 ? 'TELEPORTING' : 'UPLOADED';
        text(ctx, phase, W / 2, 70, 64, Math.floor(t * 6) % 2 ? pal.hi : pal.fg, 'center');
        bar(ctx, 40, 160, W - 80, 30, clamp01(tt / T.upload), pal.fg, pal.dim);
        if (tt >= T.slam && cy.v != null) text(ctx, `+${fmt$(cy.v)}`, W / 2, 210, 58, pal.good, 'center');
        if (cy.combo > 1.001) text(ctx, `x${cy.n} COMBO  +${Math.round((cy.combo - 1) * 100)}%`, W / 2, 280, 30, pal.hi, 'center');
        return;
      }
      if (c.count) {
        const combo = 1 + Math.min(0.6, (c.count - 1) * 0.06);
        text(ctx, `IN CHAMBER: ${c.count}`, 14, 54, 30, pal.fg);
        text(ctx, short$(c.total * combo), W - 14, 50, 44, pal.good, 'right');
        c.names.slice(0, 4).forEach((n, i) => text(ctx, `· ${n}`.slice(0, 26), 20, 96 + i * 30, 26, pal.fg));
        if (c.names.length > 4) text(ctx, `  +${c.names.length - 4} more`, 20, 216, 24, pal.dim);
        if (combo > 1) text(ctx, `COMBO +${Math.round((combo - 1) * 100)}%`, W - 14, 100, 28, pal.hi, 'right');
        text(ctx, Math.floor(t * 2) % 2 ? '>> PRESS THE RED BUTTON <<' : '', W / 2, 252, 28, pal.hi, 'center');
      } else {
        text(ctx, 'CHAMBER EMPTY', W / 2, 80, 48, pal.dim, 'center');
        text(ctx, 'DROP LOOT ONTO THE TELEPORT BED', W / 2, 150, 26, pal.fg, 'center');
        text(ctx, 'MORE ITEMS PER SLAM = COMBO BONUS', W / 2, 186, 22, pal.dim, 'center');
      }
      if (this.lastSale) text(ctx, `LAST UPLOAD +${fmt$(this.lastSale)}`, 14, 300, 24, pal.dim);
      if (this.queue.length) text(ctx, `INBOUND: ${this.queue.length}`, W - 14, 300, 24, pal.hi, 'right');
    });
    this.counter.draw(dt, (ctx, W, H, pal, t) => {
      const v = econ ? econ.escape : 0;
      text(ctx, 'ESCAPE FUND', 10, 6, 26, pal.dim);
      text(ctx, `${Math.floor(frac * 100)}%`, W - 10, 6, 26, frac >= 1 ? (Math.floor(t * 3) % 2 ? pal.hi : pal.fg) : pal.fg, 'right');
      text(ctx, fmt$(v), W / 2, 40, 52, pal.hi, 'center');
      text(ctx, `/ ${fmt$(econ?.quota || 0)}`, W / 2, 92, 22, pal.dim, 'center');
    });
  }

  dispose() {
    net.clientHandlers.delete('crushed');
    for (const b of this.beams) b.m.removeFromParent();
    super.dispose();
  }
}

export { CRUSH_DMG, itemDef };
