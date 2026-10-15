// The elevator ride between dimensions (~15 s, first person, look around freely).
//
// When the HQ gate closes on the riders, each rider's view moves from the HQ car into an identical car far
// below the world (RIDE_ORIGIN) while the next dimension loads in the background (no loading screen).
// The car shudders and drops down a block-walled hoistway; floors, cage lamps and painted numbers rush
// past the brass gate; the floor dial spins through impossible numbers. Five times the car slams to a
// stop and the landing doors open on another dimension (the Yellow Rooms, the Poolrooms, a moonlit
// grass field, a red hotel corridor, a hall of endless doors), then shut again. Finally the hoistway
// dissolves and the car falls through a black void past a single lit door, the brakes scream, the lights
// die, and they come back on in the arrival car standing in Level 0, whose gate clatters open once every
// rider has arrived. Everything is procedural; the ride scene is built once per session and reused.
//
// Exports: ElevatorRide (per ride), prepareRide(game) (build/compile ahead), Elevator (hooks game.js calls
// while loading a world), ArrivalElevator (the car standing in the level).
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { input } from '../core/input.js';
import { net } from '../net/net.js';
import { audio } from '../audio/audio.js';
import * as Mat from '../gfx/materials.js';
import { Device } from '../game/devices.js';
import { ElevatorCar, LandingDoors, GBin, T, CAR, carMaterials } from '../entities/elevator.js';
import { VLRig, vlPatch } from '../entities/vlights.js';

const PI = Math.PI, TAU = PI * 2;
export const RIDE_ORIGIN = new THREE.Vector3(0, -320, 0);
const SEG = 3.6;          // floor-to-floor height in the hoistway
const WZ = 1.5;           // hoistway front wall (shaft side face), car space
const EYE = 1.16;         // clone eye height (player.js EYE_STAND)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

// ------------------------------------------------------------------------------------------ timeline
const T_SWITCH = 1.15, T_MOTOR = 1.2, T_MOVE = 2.1;
const STOPS = [
  { dim: 'yellow', floor: 3, led: '0', ding: 1.0, fog: [0x8a7a3e, 0.07] },
  { dim: 'pool', floor: 7, led: '37', ding: 1.12, fog: [0x9fd2d4, 0.045] },
  { dim: 'field', floor: 12, led: '1.1', ding: 0.86, fog: [0x0b1628, 0.022] },
  { dim: 'hotel', floor: 18, led: '5', ding: 0.79, fog: [0x2a0705, 0.055] },
  { dim: 'doors', floor: 25, led: 'B∞', ding: 1.3, fog: [0x0e0b16, 0.045] },
];
const FIRST_TRAVEL = 0.85, TRAVEL = 0.6, ST_OPEN = 0.12, ST_OPEN_D = 0.28, ST_HOLD = 0.72, ST_CLOSE = 0.22, ST_GO = 0.1;
(function plan() {
  let t = T_MOVE + FIRST_TRAVEL;
  for (const s of STOPS) {
    s.arrive = t; s.open = t + ST_OPEN; s.close = s.open + ST_OPEN_D + ST_HOLD; s.depart = s.close + ST_CLOSE + ST_GO;
    t = s.depart + TRAVEL;
  }
})();
const T_VOID = STOPS[STOPS.length - 1].depart;
const T_BRAKE_SND = T_VOID + 1.35, T_SLAM = T_BRAKE_SND + 1.2, T_HANDOFF = T_SLAM + 0.3;

// travel distance (m) at time t
function travelAt(t) {
  if (t < T_MOVE) return 0;
  let prevT = T_MOVE, prevD = 0;
  for (const s of STOPS) {
    const D = s.floor * SEG;
    if (t < s.arrive) return prevD + (D - prevD) * smoother(clamp((t - prevT) / (s.arrive - prevT), 0, 1));
    if (t < s.depart) return D;
    prevT = s.depart; prevD = D;
  }
  // void freefall: accelerating, then the brakes bite
  const u = t - T_VOID, uSlam = T_SLAM - T_VOID;
  if (u < uSlam) return prevD + 6 * u * u + 2 * u;
  return prevD + 6 * uSlam * uSlam + 2 * uSlam;
}

// ------------------------------------------------------------------------------------------ textures
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function ctex(c, rep = false, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
function damask() {
  const c = canvas(256, 256), x = c.getContext('2d');
  x.fillStyle = '#5a0e12'; x.fillRect(0, 0, 256, 256);
  x.fillStyle = '#6e1a1c';
  for (const [cx, cy] of [[64, 64], [192, 192], [192, 64], [64, 192]]) {
    x.save(); x.translate(cx, cy);
    for (let k = 0; k < 6; k++) { x.rotate(PI / 3); x.beginPath(); x.ellipse(0, 18, 9, 22, 0, 0, TAU); x.fill(); }
    x.beginPath(); x.arc(0, 0, 10, 0, TAU); x.fill();
    x.restore();
  }
  x.strokeStyle = 'rgba(200,150,80,0.18)'; x.lineWidth = 2;
  for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(i * 64 + 32, 0); x.lineTo(i * 64 + 32, 256); x.stroke(); }
  return ctex(c, true);
}
function hotelCarpet() {
  const c = canvas(256, 256), x = c.getContext('2d');
  x.fillStyle = '#6a0f14'; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = '#c9952e'; x.lineWidth = 5;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    x.save(); x.translate(64 + i * 128, 64 + j * 128); x.rotate(PI / 4);
    x.strokeRect(-34, -34, 68, 68); x.strokeRect(-14, -14, 28, 28);
    x.restore();
  }
  x.fillStyle = '#2a0608'; x.fillRect(0, 0, 256, 10); x.fillRect(0, 128, 256, 6);
  const r = rng(7);
  for (let i = 0; i < 1600; i++) { x.fillStyle = `rgba(0,0,0,${0.06 + r() * 0.1})`; x.fillRect(r() * 256, r() * 256, 2, 2); }
  return ctex(c, true);
}
function checker() {
  const c = canvas(256, 256), x = c.getContext('2d');
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#1a1a1e' : '#c9c4b8'; x.fillRect(i * 64, j * 64, 64, 64); }
  const r = rng(11);
  for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(0,0,0,${r() * 0.12})`; x.fillRect(r() * 256, r() * 256, 1 + r() * 3, 1 + r() * 3); }
  return ctex(c, true);
}
function nightSky() {
  const c = canvas(1024, 512), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#02040c'); g.addColorStop(0.42, '#08142c'); g.addColorStop(0.5, '#1a2a48'); g.addColorStop(0.53, '#0a1222'); g.addColorStop(1, '#020306');
  x.fillStyle = g; x.fillRect(0, 0, 1024, 512);
  const r = rng(3);
  for (let i = 0; i < 900; i++) { const y = r() * 250; x.fillStyle = `rgba(220,230,255,${0.2 + r() * 0.8 * (1 - y / 260)})`; const s = r() < 0.03 ? 2 : 1; x.fillRect(r() * 1024, y, s, s); }
  return ctex(c);
}
function grassTex() {
  const c = canvas(256, 256), x = c.getContext('2d');
  x.fillStyle = '#16301e'; x.fillRect(0, 0, 256, 256);
  const r = rng(5);
  for (let i = 0; i < 3000; i++) { x.strokeStyle = `rgba(${40 + r() * 40},${70 + r() * 60},${50 + r() * 30},0.5)`; x.lineWidth = 1; const px = r() * 256, py = r() * 256; x.beginPath(); x.moveTo(px, py); x.lineTo(px + (r() - 0.5) * 4, py - 4 - r() * 6); x.stroke(); }
  return ctex(c, true);
}
function stencil(text) {
  const c = canvas(256, 128), x = c.getContext('2d');
  x.clearRect(0, 0, 256, 128);
  x.fillStyle = 'rgba(235,230,215,0.92)'; x.font = 'bold 96px "Arial Black", Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 128, 68);
  // stencil bridges + overspray
  x.globalCompositeOperation = 'destination-out';
  x.fillRect(0, 60, 256, 6);
  x.globalCompositeOperation = 'source-over';
  const r = rng(text.length * 31 + 7);
  for (let i = 0; i < 200; i++) { x.fillStyle = `rgba(235,230,215,${r() * 0.15})`; x.fillRect(r() * 256, r() * 128, 2, 2); }
  return c;
}

// ------------------------------------------------------------------------------------------ the ride scene (built once)
let SCENE = null;
let PREPARING = null;

class RideScene {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'ElevatorRide';
    this.root.position.copy(RIDE_ORIGIN);
    this.car = new ElevatorCar();
    this.root.add(this.car.root);
    this.envRig = new VLRig();
    this.envRig.ambient(0.02, 0.02, 0.022);
    this.mats = carMaterials(this.envRig);
    const mk = (name, ov = {}) => { const m = Mat.make(name, ov); if (ov.vc) m.vertexColors = true; vlPatch(m, this.envRig); return m; };
    this.M = {
      block: mk('cmu', { vc: true }),
      concrete: mk('concrete', { vc: true }),
      wallpaper: mk('wallpaper'),
      carpet: mk('carpet'),
      ceiling: mk('ceiling'),
      tile: mk('tile_pool'),
      wood: mk('trim', { vc: true }),
    };
    const std = (o) => vlPatch(new THREE.MeshStandardMaterial(o), this.envRig);
    this.M.damask = std({ map: damask(), roughness: 0.8, vertexColors: true });
    this.M.hotelCarpet = std({ map: hotelCarpet(), roughness: 0.95 });
    this.M.checker = std({ map: checker(), roughness: 0.25, metalness: 0.0 });
    this.M.grass = std({ map: grassTex(), roughness: 1, vertexColors: true });
    this.M.paint = std({ vertexColors: true, roughness: 0.6 });
    this.M.water = std({ color: 0x1d6f74, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.88, envMapIntensity: 1.6 });
    this.M.glow = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.M.glow.color.setScalar(1.6);
    this.M.sky = new THREE.MeshBasicMaterial({ map: nightSky(), side: THREE.BackSide, fog: false, depthWrite: false });
    this.M.moon = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.0), fog: false });
    this.M.void = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, fog: false });
    this._shaft();
    this._dust();
    this.vignettes = {
      yellow: this._yellow(), pool: this._pool(), field: this._field(), hotel: this._hotel(), doors: this._doors(),
    };
    for (const v of Object.values(this.vignettes)) { v.group.visible = false; v.group.position.set(0, 0, WZ + 0.25); this.root.add(v.group); }
    this.voidGroup = this._void();
    this.voidGroup.visible = false;
    this.root.add(this.voidGroup);
    this.root.traverse((o) => { if (o.isMesh || o.isPoints) { o.userData.noProbe = true; o.frustumCulled = o.isInstancedMesh ? false : o.frustumCulled; } });
  }

  // ---- hoistway: 3 recycled floor segments (block wall with a landing door, frame, lamp, stencil)
  _shaft() {
    this.segments = [];
    const gw = CAR.GW / 2, gh = CAR.GH;
    for (let k = 0; k < 3; k++) {
      const g = new THREE.Group();
      const block = new GBin(), steel = new GBin(), glow = new GBin(), paint = new GBin();
      const z0 = WZ + 0.02, z1 = WZ + 0.28;
      block.span(-2.4, 0, z0, -gw - 0.1, SEG, z1, 0xbdb8ae, { metric: 1 });
      block.span(gw + 0.1, 0, z0, 2.4, SEG, z1, 0xbdb8ae, { metric: 1 });
      block.span(-gw - 0.1, gh + 0.25, z0, gw + 0.1, SEG, z1, 0xbdb8ae, { metric: 1 });
      // hoistway side walls (seen past the gate edges) with grime streaks
      for (const s of [-1, 1]) block.span(s > 0 ? 1.34 : -1.6, 0, CAR.FRONT - 0.3, s > 0 ? 1.6 : -1.34, SEG, WZ + 0.04, 0x8e8980, { metric: 1, shade: (x, y) => 0.7 + 0.3 * Math.abs(Math.sin(y * 2.3 + x)) });
      // landing sill slab + frame (shaft side)
      steel.span(-gw - 0.1, -0.12, WZ - 0.08, gw + 0.1, 0.0, z0, 0x8a8a8a, { metric: 2 });
      for (const s of [-1, 1]) steel.span(s > 0 ? gw : -gw - 0.1, 0, WZ - 0.03, s > 0 ? gw + 0.1 : -gw, gh + 0.25, z0, 0x9a9a9a, { metric: 2 });
      steel.span(-gw - 0.1, gh + 0.18, WZ - 0.12, gw + 0.1, gh + 0.25, z0, 0x707070);
      // guide rails (T-section) at both sides, + rail brackets
      for (const s of [-1, 1]) {
        steel.span(s * 1.27 - 0.008, 0, CAR.FRONT + 0.02, s * 1.27 + 0.008, SEG, CAR.FRONT + 0.12, 0xb8b8b8);
        steel.span(s * 1.27 - 0.04, 0, CAR.FRONT + 0.1, s * 1.27 + 0.04, SEG, CAR.FRONT + 0.115, 0x8a8a8a);
        steel.span(s * 1.27 - 0.05, 1.6, CAR.FRONT + 0.1, s > 0 ? 1.34 : -1.34, 1.72, CAR.FRONT + 0.16, 0x5a5a5a);
      }
      // conduit + junction box, caged lamp between floors
      paint.cyl(0.025, 0.025, SEG, 0x6e7466, T(-0.95, SEG / 2, WZ - 0.05), { seg: 10 });
      paint.span(-1.05, 1.1, WZ - 0.12, -0.85, 1.4, WZ - 0.0, 0x5c6458);
      paint.span(0.62, 2.82, WZ - 0.08, 0.88, 2.9, z0, 0x2a2a2a);
      glow.sphere(0.06, 0xffe0a0, T(0.75, 2.72, WZ - 0.1), { seg: 12, rings: 8 });
      for (let i = 0; i < 4; i++) steel.add(new THREE.TorusGeometry(0.075, 0.004, 4, 16), 0x404040, T(0.75, 2.66 + i * 0.04, WZ - 0.1, PI / 2, 0, 0));
      for (let i = 0; i < 4; i++) steel.span(0.75 + Math.cos(i * PI / 2) * 0.075 - 0.003, 2.62, WZ - 0.1 + Math.sin(i * PI / 2) * 0.075 - 0.003, 0.75 + Math.cos(i * PI / 2) * 0.075 + 0.003, 2.8, WZ - 0.1 + Math.sin(i * PI / 2) * 0.075 + 0.003, 0x404040);
      // hazard stripes on the sill edge + a "DANGER" plate
      for (let i = 0; i < 9; i++) paint.span(-gw + i * 0.24, -0.12, WZ - 0.081, -gw + i * 0.24 + 0.12, 0, WZ - 0.08, 0xd8a81c);
      block.mesh(this.M.block, g); steel.mesh(this.mats.steel, g); paint.mesh(this.M.paint, g);
      const lamp = glow.mesh(this.M.glow, g);
      // painted floor number (own small texture)
      const sc = stencil('B4');
      const st = new THREE.CanvasTexture(sc); st.colorSpace = THREE.SRGBColorSpace;
      const sm = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.31), vlPatch(new THREE.MeshStandardMaterial({ map: st, transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), this.envRig));
      sm.position.set(-0.45, gh + 0.62, WZ - 0.002);
      sm.rotation.y = PI;
      g.add(sm);
      const doors = new LandingDoors(this.mats, { w: CAR.GW, h: CAR.GH });
      doors.group.position.set(0, 0, WZ + 0.02);
      g.add(doors.group);
      this.root.add(g);
      this.segments.push({ g, doors, lamp, stencil: sc, stencilTex: st, floor: null });
    }
  }

  // dust motes rushing past the gate (falling sensation)
  _dust() {
    const N = 260, pos = new Float32Array(N * 3), r = rng(17);
    for (let i = 0; i < N; i++) { pos[i * 3] = (r() - 0.5) * 2.6; pos[i * 3 + 1] = r() * 8 - 3; pos[i * 3 + 2] = CAR.FRONT + 0.05 + r() * 0.3; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dustBase = pos.slice();
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xd8c8a8, size: 0.012, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.dust.frustumCulled = false;
    this.root.add(this.dust);
  }

  // ---- dimensions (vignette space: origin on the floor at the landing door, +Z away from the car)
  _yellow() {
    const g = new THREE.Group(), M = this.M;
    const wp = new GBin(), cp = new GBin(), ce = new GBin(), glow = new GBin();
    const H = 2.9;
    wp.span(-4, 0, 0, -3.9, H, 14, 0xffffff, { metric: 1 }); wp.span(3.9, 0, 0, 4, H, 14, 0xffffff, { metric: 1 });
    wp.span(-4, 0, 13.9, 4, H, 14, 0xffffff, { metric: 1 });
    wp.span(-4, 0, 6, 1.2, H, 6.12, 0xffffff, { metric: 1 }); wp.span(2.4, 0, 6, 4, H, 6.12, 0xffffff, { metric: 1 }); wp.span(1.2, 2.2, 6, 2.4, H, 6.12, 0xffffff, { metric: 1 });
    wp.span(-2.4, 0, 9.5, -2.28, H, 13.9, 0xffffff, { metric: 1 });
    wp.span(-4, 0, -0.02, 4, H, 0.0, 0xffffff, { metric: 1 }); // landing-side wall face
    cp.span(-4, -0.02, 0, 4, 0, 14, 0xffffff, { metric: 1 });
    ce.span(-4, H, 0, 4, H + 0.02, 14, 0xffffff, { metric: 1 });
    for (const z of [2.6, 8.6, 12.2]) for (const x of [-1.5, 1.5]) glow.span(x - 0.6, H - 0.01, z - 0.3, x + 0.6, H, z + 0.3, 0xfff2c8);
    wp.mesh(M.wallpaper, g); cp.mesh(M.carpet, g); ce.mesh(M.ceiling, g); glow.mesh(M.glow, g);
    return { group: g, lights: [[new THREE.Vector3(-0.8, 2.75, 2.6), 0xffe9b0, 5.5], [new THREE.Vector3(1.2, 2.75, 8.6), 0xffe9b0, 5]], amb: [0.09, 0.08, 0.04] };
  }
  _pool() {
    const g = new THREE.Group(), M = this.M;
    const tile = new GBin(), water = new GBin(), glow = new GBin();
    const H = 4.6;
    tile.span(-5, -0.02, 0, 5, 0, 2.5, 0xffffff, { metric: 2 });
    tile.span(-5, -0.02, 2.5, -3, 0, 14, 0xffffff, { metric: 2 }); tile.span(3, -0.02, 2.5, 5, 0, 14, 0xffffff, { metric: 2 });
    tile.span(-3, -1.2, 2.5, 3, -1.18, 12, 0xd8f0f0, { metric: 2 });
    tile.span(-3, -1.2, 2.5, 3, 0, 2.52, 0xd8f0f0, { metric: 2 }); tile.span(-3, -1.2, 11.98, 3, 0, 12, 0xd8f0f0, { metric: 2 });
    tile.span(-3.02, -1.2, 2.5, -3, 0, 12, 0xd8f0f0, { metric: 2 }); tile.span(3, -1.2, 2.5, 3.02, 0, 12, 0xd8f0f0, { metric: 2 });
    tile.span(-5, -0.02, 12, 5, 0, 16, 0xffffff, { metric: 2 });
    tile.span(-5.1, 0, 0, -5, H, 16, 0xffffff, { metric: 2 }); tile.span(5, 0, 0, 5.1, H, 16, 0xffffff, { metric: 2 });
    tile.span(-5, 0, 15.9, 5, H, 16, 0xffffff, { metric: 2 }); tile.span(-5, 0, -0.02, 5, H, 0, 0xffffff, { metric: 2 });
    tile.span(-5, H, 0, 5, H + 0.05, 16, 0xf0f8f8, { metric: 2 });
    for (const [x, z] of [[-3.9, 5], [3.9, 5], [-3.9, 10], [3.9, 10]]) tile.span(x - 0.3, 0, z - 0.3, x + 0.3, H, z + 0.3, 0xffffff, { metric: 2 });
    water.span(-3, -0.32, 2.5, 3, -0.3, 12, 0xffffff);
    glow.span(-2, H - 0.01, 5, 2, H, 9, 0xf4ffff);
    tile.mesh(M.tile, g); water.mesh(M.water, g); glow.mesh(M.glow, g);
    return { group: g, lights: [[new THREE.Vector3(0, 4.2, 6.5), 0xe8ffff, 14], [new THREE.Vector3(0, 1.0, 3.0), 0x9fe8ff, 1.6]], amb: [0.16, 0.2, 0.21] };
  }
  _field() {
    const g = new THREE.Group(), M = this.M;
    const ground = new GBin(), dark = new GBin();
    ground.span(-80, -0.05, 0, 80, 0, 120, 0x3a5a48, { metric: 0.5 });
    // grass blades (one merged mesh)
    const r = rng(23), pos = [], col = [];
    const c0 = new THREE.Color(0x1d3a2a), c1 = new THREE.Color(0x5a7a80);
    for (let i = 0; i < 4200; i++) {
      const z = 0.3 + Math.pow(r(), 1.7) * 26, x = (r() - 0.5) * (4 + z * 1.6), h = 0.2 + r() * 0.45, w = 0.025, a = r() * PI, lean = (r() - 0.5) * 0.25;
      const ca = Math.cos(a) * w, sa = Math.sin(a) * w;
      pos.push(x - ca, 0, z - sa, x + ca, 0, z + sa, x + lean, h, z + lean * 0.5);
      const tip = c0.clone().lerp(c1, 0.4 + r() * 0.6);
      col.push(c0.r, c0.g, c0.b, c0.r, c0.g, c0.b, tip.r, tip.g, tip.b);
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    bg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    bg.computeVertexNormals();
    const blades = new THREE.Mesh(bg, vlPatch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), this.envRig));
    g.add(blades);
    // tree line + telephone poles with sagging wires
    for (let i = 0; i < 46; i++) { const x = -70 + i * 3.1 + r() * 2, h = 4 + r() * 7; dark.add(new THREE.ConeGeometry(1.6 + r(), h, 6), 0x050807, T(x, h / 2 - 0.5, 85 + r() * 10)); }
    for (let i = 0; i < 6; i++) {
      const z = 8 + i * 12, x = 6 + i * 0.5;
      dark.cyl(0.09, 0.12, 7, 0x0a0a0a, T(x, 3.5, z), { seg: 6 });
      dark.span(x - 0.9, 6.4, z - 0.05, x + 0.9, 6.5, z + 0.05, 0x0a0a0a);
      if (i < 5) for (const dx of [-0.8, 0.8]) dark.tube([new THREE.Vector3(x + dx, 6.45, z), new THREE.Vector3(x + dx + 0.25, 5.9, z + 6), new THREE.Vector3(x + dx + 0.5, 6.45, z + 12)], 0.012, 0x050505, { radial: 4, seg: 12 });
    }
    ground.mesh(M.grass, g); dark.mesh(M.paint, g);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(110, 32, 16), M.sky);
    sky.position.set(0, -10, 20);
    g.add(sky);
    const moon = new THREE.Mesh(new THREE.CircleGeometry(4.2, 32), M.moon);
    moon.position.set(-24, 30, 95); moon.lookAt(0, 1.2, 0);
    g.add(moon);
    const halo = new THREE.Mesh(new THREE.CircleGeometry(14, 32), new THREE.MeshBasicMaterial({ color: 0x8aa0d0, transparent: true, opacity: 0.12, fog: false, depthWrite: false }));
    halo.position.copy(moon.position).multiplyScalar(1.01); halo.lookAt(0, 1.2, 0);
    g.add(halo);
    return { group: g, lights: [[new THREE.Vector3(-24, 30, 95), 0xaac4ff, 5200, 260], [new THREE.Vector3(0, 3, -2), 0x3a4a70, 0.6]], amb: [0.03, 0.04, 0.07] };
  }
  _hotel() {
    const g = new THREE.Group(), M = this.M;
    const wall = new GBin(), carpet = new GBin(), wood = new GBin(), glow = new GBin(), paint = new GBin();
    const W2 = 1.3, H = 2.65, L = 44;
    for (const s of [-1, 1]) {
      wall.span(s > 0 ? W2 : -W2 - 0.05, 0.95, 0, s > 0 ? W2 + 0.05 : -W2, H, L, 0xffffff, { metric: 1.4 });
      wood.span(s > 0 ? W2 - 0.02 : -W2 - 0.03, 0, 0, s > 0 ? W2 + 0.03 : -W2 + 0.02, 0.95, L, 0x8a5a3a, { metric: 1 });
      wood.span(s > 0 ? W2 - 0.04 : -W2 - 0.01, 0.93, 0, s > 0 ? W2 + 0.01 : -W2 + 0.04, 0.98, L, 0x6a4028);
      for (let z = 2.2; z < L - 1; z += 3.4) {
        // door: frame + panel + brass number plate + knob
        const x = s * (W2 - 0.005);
        wood.span(Math.min(x, x - s * 0.04), 0, z - 0.5, Math.max(x, x - s * 0.04), 2.15, z + 0.5, 0x3a1c10);
        wood.span(Math.min(x - s * 0.04, x - s * 0.06), 0, z - 0.44, Math.max(x - s * 0.04, x - s * 0.06), 2.08, z + 0.44, 0x4e2616, { metric: 1 });
        paint.span(Math.min(x - s * 0.06, x - s * 0.07), 1.62, z - 0.06, Math.max(x - s * 0.06, x - s * 0.07), 1.7, z + 0.06, 0xc8a050);
        paint.sphere(0.03, 0xc8a050, T(x - s * 0.09, 1.0, z + 0.32 * s));
        // sconce between doors
        const zs = z + 1.7;
        paint.span(Math.min(x, x - s * 0.06), 1.72, zs - 0.06, Math.max(x, x - s * 0.06), 1.88, zs + 0.06, 0xb08840);
        glow.add(new THREE.CylinderGeometry(0.07, 0.11, 0.16, 12, 1, true), 0xffc070, T(x - s * 0.12, 1.98, zs));
      }
    }
    carpet.span(-W2, -0.02, 0, W2, 0, L, 0xffffff, { metric: 0.7 });
    paint.span(-W2, H, 0, W2, H + 0.03, L, 0xd8ccb0);
    paint.span(-W2 - 0.1, 0, L, W2 + 0.1, H, L + 0.05, 0x1a0604);
    paint.span(-2, 0, -0.02, 2, H, 0, 0x2a0a08);
    // the figure at the far end: tall, thin, too still
    paint.cyl(0.11, 0.08, 1.4, 0x050303, T(0.15, 1.05, L - 3), { seg: 8 });
    paint.sphere(0.12, 0x050303, T(0.15, 1.9, L - 3, 0, 0, 0.3, 0.9, 1.3, 0.9));
    paint.cyl(0.025, 0.02, 1.2, 0x050303, T(-0.05, 1.1, L - 3, 0, 0, 0.15), { seg: 5 });
    paint.cyl(0.025, 0.02, 1.25, 0x050303, T(0.36, 1.1, L - 3, 0, 0, -0.12), { seg: 5 });
    wall.mesh(M.damask, g); carpet.mesh(M.hotelCarpet, g); wood.mesh(M.wood, g); glow.mesh(M.glow, g); paint.mesh(M.paint, g);
    return { group: g, lights: [[new THREE.Vector3(1.0, 1.98, 3.9), 0xffb060, 2.2], [new THREE.Vector3(-1.0, 1.98, 7.3), 0xffb060, 2]], amb: [0.05, 0.015, 0.01] };
  }
  _doors() {
    const g = new THREE.Group(), M = this.M;
    const floor = new GBin(), wood = new GBin(), paint = new GBin(), glow = new GBin();
    floor.span(-30, -0.02, 0, 30, 0, 60, 0xffffff, { metric: 0.5 });
    const r = rng(41);
    const cols = [0x7a1c1c, 0x1c3a7a, 0xd8d4c8, 0x2a5a2a, 0x5a3a20, 0x2a2a2a, 0xc8a020];
    for (let row = 0; row < 16; row++) for (const s of [-1, 1]) for (let lane = 0; lane < 4; lane++) {
      const z = 2.5 + row * 3.4 + lane * 0.8 + r() * 0.4, x = s * (1.4 + lane * 2.4 + r() * 0.3), ry = s * (0.12 + r() * 0.3) + (r() - 0.5) * 0.2;
      const m = T(x, 0, z, 0, ry, 0);
      const add = (bin, w, h, d, cx, cy, cz, c, o) => bin.box(w, h, d, c, m.clone().multiply(T(cx, cy, cz)), o);
      add(wood, 1.04, 2.18, 0.12, 0, 1.09, 0, 0x2a1a10);
      add(paint, 0.88, 2.04, 0.05, 0, 1.03, 0.04, cols[Math.floor(r() * cols.length)]);
      add(paint, 0.05, 0.05, 0.05, 0.36, 1.0, 0.08, 0xc8a050);
      if (r() < 0.22) add(glow, 0.035, 2.0, 0.02, -0.42, 1.03, 0.07, 0xfff0d0);
    }
    // ceiling doors (upside down) for good measure
    for (let i = 0; i < 10; i++) { const m = T((r() - 0.5) * 8, 7.5, 4 + i * 5, PI, r() * PI, 0); paint.box(0.9, 2.0, 0.05, cols[i % cols.length], m); }
    floor.mesh(M.checker, g); wood.mesh(M.wood, g); paint.mesh(M.paint, g); glow.mesh(M.glow, g);
    return { group: g, lights: [[new THREE.Vector3(0, 5.5, 4), 0xc8d0ff, 9], [new THREE.Vector3(-1.6, 1.4, 6.5), 0xffe8c0, 1.8]], amb: [0.025, 0.022, 0.035] };
  }
  _void() {
    const g = new THREE.Group(), M = this.M;
    const shell = new THREE.Mesh(new THREE.SphereGeometry(140, 16, 10), M.void);
    g.add(shell);
    const door = new THREE.Group();
    const wood = new GBin(), glow = new GBin();
    wood.span(-0.6, 0, -0.08, -0.5, 2.3, 0.08, 0x1a1210); wood.span(0.5, 0, -0.08, 0.6, 2.3, 0.08, 0x1a1210); wood.span(-0.6, 2.2, -0.08, 0.6, 2.3, 0.08, 0x1a1210);
    wood.box(0.98, 2.18, 0.05, 0x6a5a48, T(-0.5, 1.09, 0.0, 0, -0.32, 0).multiply(T(0.49, 0, 0)));
    glow.span(-0.5, 0, 0.0, 0.5, 2.2, 0.01, 0xfff6e8);
    wood.mesh(M.paint, door); glow.mesh(M.glow, door);
    door.position.set(1.2, -3, 26);
    door.rotation.y = PI + 0.4;
    g.add(door);
    this.voidDoor = door;
    return g;
  }

  // label a segment with its floor number ("B5" .. "B29")
  label(seg, floor) {
    if (seg.floor === floor) return;
    seg.floor = floor;
    const txt = floor < 0 ? '' : floor > 22 ? ['B∞', '??', 'B-0', '—'][floor % 4] : `B${4 + floor}`;
    const c = stencil(txt);
    seg.stencil.getContext('2d').clearRect(0, 0, 256, 128);
    seg.stencil.getContext('2d').drawImage(c, 0, 0);
    seg.stencilTex.needsUpdate = true;
  }
}

// build the ride scene once and compile its shaders ahead (call when the countdown starts)
export function prepareRide() {
  if (SCENE) return SCENE;
  try {
    SCENE = new RideScene();
    PREPARING = compileRide(SCENE).catch(() => {});
  } catch (e) { console.error('[ride] build failed', e); SCENE = null; }
  return SCENE;
}
// compile every material of the ride (compile() walks invisible objects too) against the current scene's
// lights, detached so nothing renders it half-compiled
function compileRide(S) {
  const wasParent = S.root.parent;
  if (wasParent) S.root.removeFromParent();
  let p;
  try { p = engine.renderer.compileAsync(S.root, engine.camera, engine.scene); } catch (e) { p = Promise.resolve(); }
  return Promise.resolve(p).catch(() => {}).finally(() => { if (wasParent && !S.root.parent) wasParent.add(S.root); });
}

// ------------------------------------------------------------------------------------------ the ride
export class ElevatorRide {
  // o: { riders: [{id, x, z, yaw}], me: {id, x, z, yaw}, car: ElevatorCar (the HQ car), elevator }
  constructor(game, o) {
    this.game = game;
    this.active = true;
    this.t = 0;
    this.riders = o.riders || [];
    this.me = o.me;
    this.srcCar = o.car;
    this.S = prepareRide();
    this.switched = false;
    this.world0 = game.world;
    this.worldSeen = game.world;
    this.blackout = 0; this.compiling = 0;
    this.yaw = 0; this.pitch = game.local.pitch || 0;
    this.srcCar = o.car;
    this.yaw = (game.local.yaw || 0) - this._srcYaw();
    this.rel = new THREE.Vector3(o.me?.x ?? 0, 0, o.me?.z ?? 0.2);
    this.shake = 0; this.jolt = 0;
    this.fired = new Set();
    this.loops = {};
    this.proxies = [];
    this.fog = new THREE.FogExp2(0x000000, 0.02);
    this.saved = null;
    this.ended = false;
    this.lastD = 0;
    game.cutscene = { kind: 'ride', t: 0 };
    if (!this.S) { this.active = false; return; }
    // per-ride state of the shared scene
    for (const v of Object.values(this.S.vignettes)) v.group.visible = false;
    this.S.voidGroup.visible = false;
    for (const s of this.S.segments) { s.g.visible = true; s.doors.set(0); }
    this.S.dust.visible = true;
    this.S.car.gate.set(0);
    this.S.car.dial.setLed('B4');
    this.S.car.dial.setNeedle(PI * 0.85 - (5 / 9) * PI * 0.7, true);
    this.S.root.updateMatrixWorld(true);
    this.S.car.syncLights();
    this.S.envRig.set(0, this.S.car.root.localToWorld(_v.set(0, CAR.H - 0.25, 0)), 0xfff0d6, 2.2, 6);
    for (const r of this.riders) {
      if (r.id === net.selfId) continue;
      const rp = game.remotes.get(r.id);
      if (rp) this.proxies.push({ rp, x: r.x, z: r.z, yaw: r.yaw, t: Math.random() * 10 });
    }
  }

  get handoffReady() { return !this.game.loading && this.game.world && this.game.world !== this.world0; }

  _snd(name, o = {}) { return audio.play(name, { volume: 1, ...o }); }
  _once(key, t, fn) { if (this.t >= t && !this.fired.has(key)) { this.fired.add(key); fn(); } }
  _loop(name, on, vol = 1, o = {}) {
    const L = this.loops[name];
    if (on && !L) this.loops[name] = audio.loop(name, { bus: 'sfx', volume: vol, fadeIn: o.fade ?? 0.3, ...o });
    else if (on && L) L.setVolume(vol, 0.15);
    else if (!on && L) { L.stop(o.fade ?? 0.3); delete this.loops[name]; }
  }

  // switch the view from the HQ car into the ride car (same car-relative spot)
  _switch() {
    if (this.switched) return;
    this.switched = true;
    const g = this.game, l = g.local;
    if (this.srcCar && l.world) {
      this.srcCar.root.updateMatrixWorld(true);
      const p = this.srcCar.root.worldToLocal(l.pos.clone());
      this.rel.set(clamp(p.x, -1.0, 1.0), 0, clamp(p.z, -0.9, 0.95));
      const cy = new THREE.Euler().setFromQuaternion(this.srcCar.root.getWorldQuaternion(_q), 'YXZ').y;
      this.yaw = l.yaw - cy;
      this.pitch = l.pitch;
    } else if (this.me) this.yaw = this.me.yaw;
    engine.scene.add(this.S.root);
    this.flicker = 0.18;
  }

  update(dt) {
    if (!this.active) return;
    const g = this.game;
    if (g.state === 'menu') { this.dispose(); return; }
    dt = Math.min(dt, 0.1);
    this.t += dt;
    const t = this.t;
    g.cutscene = g.cutscene?.kind === 'ride' ? g.cutscene : { kind: 'ride', t: 0 };
    // look around (mouse / touch look delta)
    const lk = input.locked || input.touch ? input.look() : { x: 0, y: 0 };
    this.yaw -= lk.x;
    this.pitch = clamp(this.pitch - lk.y, -1.4, 1.4);
    if (!this.switched) {
      // still in the HQ car: the player's own camera, frozen feet
      if (g.local.world) { g.local.yaw = this.yaw + this._srcYaw(); g.local.pitch = this.pitch; }
      if (t >= T_SWITCH || g.world !== this.world0 || !g.world) this._switch();
      else return;
    }
    this._worldWatch();
    this._timeline(dt);
    this._camera(dt);
    this._proxies(dt);
    this._env(dt);
    if (t >= T_HANDOFF && this.handoffReady && this.compiling <= 0 && !this.ended) this._handoff();
  }

  _srcYaw() {
    if (this._srcYawV === undefined && this.srcCar) this._srcYawV = new THREE.Euler().setFromQuaternion(this.srcCar.root.getWorldQuaternion(_q), 'YXZ').y;
    return this._srcYawV || 0;
  }

  // the world changed under us (HQ disposed, next level loading / loaded): recompile off-screen in a blackout
  _worldWatch() {
    const g = this.game;
    const key = `${g.world ? g.world.desc?.seed : 'none'}|${g.loading ? 1 : 0}`;
    if (key !== this.worldKey) {
      const first = this.worldKey === undefined;
      this.worldKey = key;
      if (!first && this.S) {
        this.compiling++;
        this.blackout = Math.max(this.blackout, 0.3);
        this.S.root.removeFromParent();
        compileRide(this.S).finally(() => { this.compiling--; if (this.active && !this.ended && this.switched) engine.scene.add(this.S.root); });
      }
      if (g.world && g.world !== this.world0 && !this.saved) {
        // duck the next level's ambience while we are still between dimensions
        this.saved = { amb: audio.vol?.ambient ?? 1, mus: audio.vol?.music ?? 1 };
        audio.setBusVolume?.('ambient', this.saved.amb * 0.12);
        audio.setBusVolume?.('music', this.saved.mus * 0.1);
      }
    }
  }

  _timeline(dt) {
    const S = this.S, t = this.t, car = S.car;
    // ---- sound script
    this._once('motor', T_MOTOR, () => { this._snd('elev_motor', { volume: 1 }); this.shake = 0.6; });
    this._once('cable0', T_MOVE - 0.05, () => this._snd('elev_cable', { volume: 0.9 }));
    STOPS.forEach((s, i) => {
      this._once(`brk${i}`, s.arrive - 0.12, () => { this._snd('thunk', { volume: 1, pitch: 0.6 }); this._snd('elevator_ding', { volume: 0.8, pitch: s.ding, delay: 0.1 }); this.jolt = 1; });
      this._once(`open${i}`, s.open, () => { this._snd('elev_doors', { volume: 0.8, pitch: 1.4 }); this._dimOn(s, true); });
      this._once(`close${i}`, s.close, () => { this._snd('elev_doors', { volume: 0.9, pitch: 1.6 }); this._snd('thunk', { volume: 0.7, pitch: 0.9, delay: ST_CLOSE }); });
      this._once(`gone${i}`, s.close + ST_CLOSE, () => this._dimOn(s, false));
      this._once(`go${i}`, s.depart - 0.05, () => { this._snd('elev_cable', { volume: 0.8, pitch: 0.9 + i * 0.05 }); this.shake = Math.max(this.shake, 0.5); });
    });
    this._once('void', T_VOID + 0.3, () => { this._snd('void_drone', { volume: 0.9 }); this._snd('whisper', { volume: 0.7, delay: 0.6 }); this._snd('teleport_whoosh', { volume: 0.6 }); });
    this._once('brake', T_BRAKE_SND, () => this._snd('elev_brake', { volume: 1.1 }));
    this._once('slam', T_SLAM, () => { this.jolt = 2.2; this.shake = 1.4; this._snd('collapse_rumble', { volume: 0.5 }); this.blackout = Math.max(this.blackout, 0.45); });
    // travel speed -> wind + rattle loops
    const D = travelAt(t), v = (D - this.lastD) / Math.max(dt, 1e-3);
    this.lastD = D;
    const speed = clamp(Math.abs(v) / 25, 0, 1);
    this._loop('wind_fall', speed > 0.04, 0.25 + speed * 0.9);
    this.rattleT = (this.rattleT || 0) - dt;
    if (speed > 0.25 && this.rattleT <= 0) { this.rattleT = 1.5; this._snd('elev_rattle', { volume: 0.4 + speed * 0.6 }); }
    this.shake = Math.max(this.shake - dt * 0.9, speed * 0.55);
    // ---- shaft segments around the car
    const inVoid = t > T_VOID + 0.25;
    const n0 = Math.round(D / SEG);
    for (let k = -1; k <= 1; k++) {
      const n = n0 + k, seg = S.segments[((n % 3) + 3) % 3];
      seg.g.position.y = -n * SEG + D;
      seg.g.visible = !inVoid;
      S.label(seg, n);
      // the landing doors of a stop open; all others stay shut
      const st = STOPS.find((s) => s.floor === n);
      let f = 0;
      if (st && t >= st.open && t < st.close + ST_CLOSE) f = t < st.close ? clamp((t - st.open) / ST_OPEN_D, 0, 1) : 1 - clamp((t - st.close) / ST_CLOSE, 0, 1);
      seg.doors.set(f);
      // cage lamps: some are dead, some flicker
      const dead = (n * 7) % 5 === 3, fl = (n * 13) % 4 === 1 && Math.random() < 0.3;
      seg.lamp.visible = !dead && !fl;
    }
    // dimension vignettes ride with their landing (only visible while its doors are open)
    for (const s of STOPS) {
      const v = S.vignettes[s.dim];
      if (!v.group.visible) continue;
      v.group.position.y = -s.floor * SEG + D;
    }
    // ---- dust streaks + void
    const dp = S.dust.geometry.attributes.position.array, base = S.dustBase;
    for (let i = 0; i < dp.length / 3; i++) dp[i * 3 + 1] = ((base[i * 3 + 1] + D * 1.0 + 3) % 8 + 8) % 8 - 3;
    S.dust.geometry.attributes.position.needsUpdate = true;
    S.dust.material.opacity = inVoid ? 0.9 : 0.15 + speed * 0.5;
    S.dust.material.size = 0.008 + speed * 0.02;
    S.voidGroup.visible = inVoid && t < T_SLAM;
    if (inVoid) S.voidDoor.position.y = -3 + (t - T_VOID) * 4.5 - 6;
    // ---- floor dial: spins through impossible numbers while moving, shows the dimension at stops
    const stop = STOPS.find((s) => t >= s.arrive && t < s.depart);
    let led = 'B4', col = '#ffae3a';
    if (t > T_MOVE && t < T_VOID) led = stop ? stop.led : `B${4 + Math.floor(D / SEG)}`;
    if (t >= T_VOID && t < T_SLAM) { led = ['??', 'B∞', '-0', '——', '13', '?!'][Math.floor(t * 9) % 6]; col = '#ff3a2a'; }
    if (t >= T_SLAM) { led = this.handoffReady ? '0' : (Math.floor(t * 2) % 2 ? '--' : ''); col = this.handoffReady ? '#ffae3a' : '#ff3a2a'; }
    car.dial.setLed(led, col);
    if (t > T_MOVE && !stop) car.dial.setNeedle(PI * 0.85 - ((D * 0.37) % 1) * PI * 0.7 + Math.sin(t * 23) * 0.05);
    else if (stop) car.dial.setNeedle(PI * 0.85 - (STOPS.indexOf(stop) / 5 + 0.1) * PI * 0.7);
    car.dial.update(dt, 9);
    // ---- car light: steady, flickers in motion, red emergency light in the void, dead after the slam
    this.flicker = Math.max(0, (this.flicker || 0) - dt);
    let k = 1, lc = 0xfff0d6;
    if (t > T_MOTOR && t < T_MOTOR + 0.6) k = Math.random() < 0.4 ? 0.15 : 1;
    if (speed > 0.3 && Math.random() < dt * 4) this.flicker = 0.06 + Math.random() * 0.1;
    if (this.flicker > 0) k = 0.12;
    if (inVoid && t < T_SLAM) { k = 0.32 + 0.1 * Math.sin(t * 5); lc = 0xff2010; }
    if (t >= T_SLAM) { k = this.handoffReady ? 0 : 0.18 + 0.05 * Math.sin(t * 3); lc = 0xff2010; }
    if (this.blackout > 0) { this.blackout -= dt; k = 0; }
    car.setLight(k, lc);
    // the passing cage lamp nearest the car lights the interior through the gate
    let best = null, bd = 1e9;
    for (const seg of S.segments) {
      if (!seg.g.visible || !seg.lamp.visible) continue;
      const y = seg.g.position.y + 2.72, d = Math.abs(y - 1.4);
      if (d < bd) { bd = d; best = y; }
    }
    if (best !== null && bd < 4) {
      const p = S.root.localToWorld(_v.set(0.75, best, WZ - 0.1));
      const k2 = clamp(1 - bd / 4, 0, 1);
      car.rig.set(2, p, 0xffd9a0, 1.6 * k2, 5); S.envRig.set(1, p, 0xffd9a0, 2.4 * k2, 6);
    } else { car.rig.off(2); S.envRig.off(1); }
    // the shaft: lit by the car spill + the lamps
    S.envRig.set(0, S.root.localToWorld(_v.set(0, 1.9, 0.6)), lc, 1.4 * k, 6);
  }

  // dimension visible: lights, fog, sound
  _dimOn(s, on) {
    const S = this.S, v = S.vignettes[s.dim];
    v.group.visible = on;
    this.dim = on ? s : null;
    if (on) {
      v.lights.forEach(([p, c, i, r], j) => S.envRig.set(2 + j, S.root.localToWorld(_v.copy(p).add(v.group.position)), c, i, r ?? 12));
      S.envRig.ambient(...v.amb);
      // spill through the open doors onto the car
      const L = v.lights[0];
      const sp = S.root.localToWorld(_v.set(0, Math.min(2.2, L[0].y), WZ + 1.2));
      S.car.rig.set(3, sp, L[1], s.dim === 'field' ? 0.45 : s.dim === 'hotel' ? 0.8 : 1.5, 6);
      S.car.rig.ambient(0.035 + v.amb[0] * 0.3, 0.032 + v.amb[1] * 0.3, 0.03 + v.amb[2] * 0.3);
      this.fog.color.set(s.fog[0]); this.fog.density = s.fog[1];
      if (s.dim === 'yellow') { this._loop('hum', true, 0.9); this._snd('_amb_buzz', { volume: 0.6 }); }
      if (s.dim === 'pool') { this._loop('drips', true, 0.8); this._loop('water_flow', true, 0.5); }
      if (s.dim === 'field') { this._snd('crickets', { volume: 0.8 }); this._loop('wind_fall', true, 0.3); }
      if (s.dim === 'hotel') this._snd('music_box', { volume: 0.9 });
      if (s.dim === 'doors') { this._snd('_amb_door', { volume: 0.9, delay: 0.2 }); this._snd('_amb_knock', { volume: 0.8, delay: 0.55 }); }
    } else {
      S.envRig.off(2); S.envRig.off(3); S.envRig.ambient(0.02, 0.02, 0.022);
      S.car.rig.off(3); S.car.rig.ambient(0.035, 0.032, 0.03);
      this._loop('hum', false); this._loop('drips', false); this._loop('water_flow', false);
    }
  }

  _camera(dt) {
    const S = this.S, cam = engine.camera, t = this.t;
    this.jolt = Math.max(0, this.jolt - dt * 4);
    const sh = this.shake * 0.012 + this.jolt * 0.02;
    const bob = -Math.sin(Math.min(1, this.jolt) * PI) * 0.05 * Math.min(1, this.jolt);
    S.root.updateMatrixWorld(true);
    const p = S.car.root.localToWorld(_v.set(this.rel.x, EYE + bob, this.rel.z));
    cam.position.set(p.x + (Math.random() - 0.5) * sh, p.y + (Math.random() - 0.5) * sh, p.z + (Math.random() - 0.5) * sh);
    const roll = (Math.random() - 0.5) * sh * 0.6 + Math.sin(t * 1.3) * 0.004;
    _e.set(this.pitch + (Math.random() - 0.5) * sh * 0.3, this.yaw, roll, 'YXZ');
    cam.quaternion.setFromEuler(_e);
    const fov = 72 + (t > T_VOID && t < T_SLAM ? 8 * sstep(T_VOID, T_VOID + 1, t) : 0);
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 4); cam.updateProjectionMatrix(); }
    if (audio.ready) audio.setListener(cam.position, cam.quaternion);
    // post: glitch at stops / void / slam, fade during blackouts
    const pp = engine.post.params;
    let gl = this.jolt * 0.25 + (this.dim ? 0.12 : 0);
    if (t > T_VOID && t < T_SLAM) gl += 0.25 + 0.2 * Math.sin(t * 7);
    if (this.compiling > 0) gl += 0.3;
    pp.uGlitch.value = clamp(gl, 0, 0.9);
    const fade = this.blackout > 0 || this.compiling > 0 ? 1 : 0;
    pp.uFade.value += (fade - pp.uFade.value) * Math.min(1, dt * (fade ? 30 : 8));
  }

  _env() {
    const sc = engine.scene;
    if (sc.fog !== this.fog) { this.levelFog = sc.fog; sc.fog = this.fog; }
    if (sc.background !== this._bg) { this.levelBg = sc.background; this._bg = new THREE.Color(0, 0, 0); sc.background = this._bg; }
    if (!this.dim) { this.fog.color.setRGB(0, 0, 0); this.fog.density = this.t > T_VOID ? 0.02 : 0.08; }
  }

  // other riders stand in the car with us (their avatars, borrowed from their RemotePlayer)
  _proxies(dt) {
    const S = this.S, g = this.game;
    const arr = g.world?.arrivalElevator;
    for (const p of this.proxies) {
      const rp = p.rp;
      if (!g.remotes.has(rp.id)) continue;
      const root = rp.avatar.root;
      if (root.parent !== S.car.root) S.car.root.add(root);
      let x = p.x, z = p.z, yaw = p.yaw, pitch = 0;
      if (arr && rp.world && rp.pose) {
        // after the load their poses come from the arrival car: map them across
        const l = arr.car.root.worldToLocal(_v2.fromArray(rp.pose.p));
        if (Math.abs(l.x) < 1.3 && Math.abs(l.z) < 1.3) { x = l.x; z = l.z; yaw = (rp.pose.y || 0) - arr.yaw; pitch = rp.pose.pi || 0; }
      }
      root.position.set(x, 0, z);
      root.rotation.set(0, yaw, 0);
      root.visible = true;
      root.userData.probe?.setRGB(0.55 * S.car.lightK + 0.05, 0.5 * S.car.lightK + 0.05, 0.44 * S.car.lightK + 0.05);
      if (!rp.world) rp.avatar.update(dt, { speed: 0, moveDir: new THREE.Vector2(), grounded: true, vy: 0, crouch: 0, sprint: false, pitch, talking: rp.voiceLevel || 0, holding: 0, holdTarget: null, emote: null, expression: 'scared', limp: false, dead: false });
    }
  }

  _restoreProxies() {
    for (const p of this.proxies) {
      const rp = p.rp, root = rp.avatar.root;
      if (rp.world) rp.world.group.add(root);
      else root.removeFromParent();
    }
  }

  // lights out in the ride car, lights on in the arrival car (or the old ceiling drop for other levels)
  _handoff() {
    this.ended = true;
    const g = this.game, l = g.local, w = g.world;
    const arr = w.arrivalElevator;
    if (arr && l.world) {
      const pos = arr.car.root.localToWorld(new THREE.Vector3(clamp(this.rel.x, -0.95, 0.95), 0.03, clamp(this.rel.z, -0.85, 0.85)));
      l.teleport(pos, this.yaw + arr.yaw);
      l.pitch = this.pitch;
      arr.localArrived();
    } else if (l.world) {
      g._arrivalSequence?.();
    }
    this.dispose();
  }

  dispose() {
    if (!this.active) return;
    this.active = false;
    const g = this.game;
    for (const k of Object.keys(this.loops)) this._loop(k, false, 0, { fade: 0.4 });
    this._restoreProxies();
    if (this.S) {
      this.S.root.removeFromParent();
      for (const v of Object.values(this.S.vignettes)) v.group.visible = false;
    }
    const sc = engine.scene;
    if (sc.fog === this.fog) sc.fog = this.levelFog ?? null;
    if (sc.background === this._bg) sc.background = this.levelBg ?? new THREE.Color(0, 0, 0);
    if (this.saved) { audio.setBusVolume?.('ambient', this.saved.amb); audio.setBusVolume?.('music', this.saved.mus); }
    const pp = engine.post.params;
    pp.uGlitch.value = 0;
    if (!(g.cutscene && g.cutscene.kind === 'arrival')) pp.uFade.value = 0;
    if (g.cutscene?.kind === 'ride') g.cutscene = null;
    engine.camera.fov = 72; engine.camera.updateProjectionMatrix();
    if (g.ride === this) g.ride = null;
  }
}

// ------------------------------------------------------------------------------------------ the arrival car
// The car standing in the level (Level 0: the elevator alcove next to the camp; landmarks.elevator =
// { x, z, yaw } is the car floor centre, the gate faces (sin yaw, 0, cos yaw)). Host-authoritative gate:
// it opens once every rider has arrived (or after a timeout); then the mission gets onArrival().
export class ArrivalElevator extends Device {
  constructor(world, at, desc) {
    super(world, 'arrival_elevator');
    this.state = { open: 0 };
    this.yaw = at.yaw || 0;
    this.car = new ElevatorCar({ exterior: true });
    this.root.add(this.car.root);
    this.root.position.set(at.x, at.y ?? 0, at.z);
    this.root.rotation.y = this.yaw;
    this.riderIds = (desc.elevator?.riders || []).map((r) => r.id);
    this.arrived = new Set();
    this.gateF = 0;
    this.t = 0;
    this.notifiedArrival = false;
    this.car.dial.setLed('0');
    this.car.dial.setNeedle(PI * 0.85 - (9 / 9) * PI * 0.7, true);
    this.range = 2.4;
  }
  build() {
    this.root.updateMatrixWorld(true);
    this.car.syncLights();
    const s = new THREE.Color();
    this.world.level?.sampleLight?.(this.root.position.clone().setY(1.4), s);
    this.car.rig.ambient(0.03 + s.r * 0.08, 0.03 + s.g * 0.08, 0.028 + s.b * 0.08);
    this.colliders.push(...this.car.addColliders(this.world.physics, { floor: true }));
  }
  prompt() { return null; }
  localArrived() {
    this.lightIn = 0.01;
    this.send('arrived');
    audio.play('elevator_ding', { pos: this.root.localToWorld(_v.set(0, 2.2, 0.8)), volume: 0.9, delay: 0.25 });
  }
  hostAction(a, d, from) {
    if (a === 'arrived') { this.arrived.add(from); this._check(); }
  }
  _check() {
    if (!net.isHost || this.state.open) return;
    const g = this.world.game;
    const waiting = this.riderIds.filter((id) => g.roster.has(id) && !this.arrived.has(id));
    if (!waiting.length || this.t > 40) {
      this.setState({ open: 1 });
    }
  }
  onState(s, fullSync) {
    if (s.open && fullSync) { this.gateF = 1; this.openT = 99; this.notifiedArrival = true; return; }
    if (s.open) {
      this.openT = 0;
      const p = this.root.localToWorld(_v.set(0, 1.8, 1.2));
      audio.play('elev_gate', { pos: p, volume: 1, delay: 0.35 });
    }
  }
  update(dt) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    if (net.isHost && !this.state.open && this.riderIds.length === 0 && this.t > 2) this.setState({ open: 1 });
    if (net.isHost && !this.state.open && Math.floor(this.t) !== Math.floor(this.t - dt)) this._check();
    if (this.state.open) {
      this.openT = (this.openT ?? 0) + dt;
      this.gateF = clamp((this.openT - 0.35) / 0.8, 0, 1);
      if (!this.notifiedArrival && this.openT > 0.6) {
        this.notifiedArrival = true;
        try { this.world.level?.mission?.onArrival?.({ kind: 'elevator', host: net.isHost, riders: this.riderIds.slice() }); } catch (e) { console.error('[arrival] mission.onArrival', e); }
      }
    }
    this.car.gate.set(this.gateF);
    this.car.gateCollider?.setEnabled(this.gateF < 0.6);
    // lights come back on (flicker) for a rider who just arrived
    let k = 0.95;
    if (this.lightIn !== undefined && this.lightIn < 1.2) {
      this.lightIn += dt;
      k = this.lightIn < 0.15 ? 0 : this.lightIn < 0.3 ? 0.8 : this.lightIn < 0.4 ? 0.1 : Math.min(0.95, (this.lightIn - 0.4) * 2.5);
    }
    this.car.setLight(k + (Math.random() < 0.003 ? -0.5 : 0));
    this.car.update(dt);
  }
  dispose() { super.dispose(); this.car.dispose(); }
}

// ------------------------------------------------------------------------------------------ game.js hooks
// Small, pure helpers the world loader calls; everything elevator-specific lives here.
export const Elevator = {
  // does this level get an arrival car? (Level 0 always; others only with a landmark)
  _spot(world, desc) {
    const lvl = world.level;
    const lm = lvl?.landmarks?.elevator;
    // a level with an elevator landmark always has its car (its spawn points stand in it)
    if (lm) return { x: lm.x, z: lm.z, yaw: lm.yaw || 0, y: lvl.floorY?.(lm.x, lm.z) ?? 0 };
    if (!desc?.elevator || desc.type !== 'yellow') return null;
    // fallback: at the spawn point, back to the nearest wall, facing the room
    const c = lvl.spawnCenter?.() || new THREE.Vector3();
    const phys = world.physics;
    let yaw = 0, far = -1, nearD = 99, nearYaw = 0;
    for (let k = 0; k < 4; k++) {
      const a = (k * PI) / 2, dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      let d = 6;
      try { const h = phys.raycast(new THREE.Vector3(c.x, 1.2, c.z), dir, 6); if (h) d = h.dist; } catch (e) { /* no ray */ }
      if (d > far) { far = d; yaw = a; }
      if (d < nearD) { nearD = d; nearYaw = a; }
    }
    if (nearD < 3.2) {
      yaw = nearYaw + PI;
      const back = new THREE.Vector3(Math.sin(nearYaw), 0, Math.cos(nearYaw));
      return { x: c.x + back.x * (nearD - 1.25), z: c.z + back.z * (nearD - 1.25), yaw, y: 0 };
    }
    return { x: c.x, z: c.z, yaw, y: 0 };
  },
  // after level.build(): place the arrival car
  afterBuild(game, world, desc) {
    try {
      const at = this._spot(world, desc);
      if (!at) return null;
      const dev = new ArrivalElevator(world, at, desc);
      world.addDevice(dev);
      dev.build();
      world.registerDynamic(dev.root);
      world.arrivalElevator = dev;
      return dev;
    } catch (e) { console.error('[elevator] arrival car', e); return null; }
  },
  // riders spawn where they stood in the HQ car; others drop in at the camp the old way
  spawn(game, world, desc, sp, idx, lateJoin) {
    const dev = world.arrivalElevator;
    if (!dev || lateJoin || !desc.elevator) return sp;
    const me = (desc.elevator?.riders || []).find((r) => r.id === net.selfId);
    if (me) {
      const pos = dev.car.root.localToWorld(new THREE.Vector3(clamp(me.x, -0.95, 0.95), 0.03, clamp(me.z, -0.85, 0.85)));
      return { pos, yaw: (me.yaw || 0) + dev.yaw, arrival: false, vy: 0 };
    }
    const c = world.level.spawnCenter?.() || dev.root.position;
    const o = [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]][idx % 4];
    const ceil = world.level.ceilingY?.(c.x + o[0], c.z + o[1]) ?? 2.9;
    return { pos: new THREE.Vector3(c.x + o[0], Math.min(ceil, 6) - 1.25, c.z + o[1]), yaw: Math.atan2(o[0], o[1]), arrival: true, vy: -2 };
  },
  // the host spawns HQ cargo inside the car instead of letting the level drop it from the ceiling
  hostDesc(game, world, desc) {
    if (!world.arrivalElevator || !desc.carry?.length) return desc;
    return { ...desc, carry: [] };
  },
  hostStart(game, world, desc) {
    const dev = world.arrivalElevator;
    if (!dev || !net.isHost) return;
    // nothing the level spawned may stand inside the car
    for (const p of [...world.props.props.values()]) {
      if (p.dead) continue;
      const l = dev.car.root.worldToLocal(_v.copy(p.root.position));
      if (Math.abs(l.x) < CAR.W / 2 + 0.3 && Math.abs(l.z) < CAR.D / 2 + 0.6) world.props.despawn(p.id);
    }
    const q0 = dev.car.root.getWorldQuaternion(new THREE.Quaternion());
    (desc.carry || []).forEach((it, i) => {
      const rp = it.rp || [((i % 3) - 1) * 0.6, 0.3 + Math.floor(i / 6) * 0.4, -0.6 + (Math.floor(i / 3) % 2) * 0.5];
      const pos = dev.car.root.localToWorld(new THREE.Vector3(clamp(rp[0], -1, 1), Math.max(0.15, rp[1]) + 0.05, clamp(rp[2], -0.9, 0.9)));
      const q = it.rq ? q0.clone().multiply(new THREE.Quaternion().fromArray(it.rq)) : new THREE.Quaternion().fromArray(it.q || [0, 0, 0, 1]);
      world.props.spawn(it.type, pos, q, { state: it.state });
    });
  },
  // this peer's arrival is the ride's (no ceiling drop / fade of its own)
  ownsArrival(game) { return !!game.ride?.active; },
};
