// R.O.O.M. — the AUTO-OUTFITTER MK.II: the wardrobe machine of the main-menu break room (world/menu_scene.js).
//
//   RoboArm          segmented hydraulic arm (turret yaw, shoulder + elbow pitch, wrist pitch/roll) with a
//                    three-finger clamp hand, sliding hydraulic pistons, sagging cables and warning stripes.
//                    Analytic two-bone IK (elbow up) with sprung joints for a heavy, overshooting feel.
//   WardrobeBooth    industrial locker booth with slatted (louvred) double doors that bang open, a lit sign,
//                    beacon, control panel, conduits; three arms are mounted inside.
//   WardrobeChamber  the outfitting bay "inside" the booth (bigger on the inside): ribbed round chamber, harness
//                    hanging from a ceiling rail, spotlight with a fake volumetric cone, three floor robots.
//   Sparks           cheap additive point sparks with gravity and floor bounce.
//
// Everything is procedural (primitives + canvas textures). Static parts are merged per material.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FONT } from '../ui/fonts.js';

const PI = Math.PI, TAU = PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _Y = new THREE.Vector3(0, 1, 0), _S = new THREE.Vector3();

// ------------------------------------------------------------------ textures & materials
export function canvasTex(w, h, draw, { repeat = null, srgb = true, nearest = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  if (nearest) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; }
  t.anisotropy = 4;
  return t;
}
// speckle + streak grime over whatever is on the canvas
export function grime(g, w, h, amt = 0.25, seed = 1) {
  let s = seed * 9301 + 49297;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < w * h * 0.004 * amt * 10; i++) {
    g.fillStyle = `rgba(20,14,8,${0.05 + r() * 0.12 * amt * 2})`;
    const x = r() * w, y = r() * h, s2 = 1 + r() * 3;
    g.fillRect(x, y, s2, s2);
  }
  for (let i = 0; i < 6 * amt * 4; i++) {
    const x = r() * w, y0 = r() * h * 0.5, len = h * (0.2 + r() * 0.5);
    const gr = g.createLinearGradient(0, y0, 0, y0 + len);
    gr.addColorStop(0, 'rgba(30,20,10,0)'); gr.addColorStop(0.3, `rgba(30,20,10,${0.08 * amt * 2})`); gr.addColorStop(1, 'rgba(30,20,10,0)');
    g.fillStyle = gr; g.fillRect(x, y0, 2 + r() * 4, len);
  }
}
export function hazardTex() {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#e8b414'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#16130e';
    for (let k = -2; k < 4; k++) {
      g.beginPath();
      g.moveTo(k * 64, 0); g.lineTo(k * 64 + 32, 0); g.lineTo(k * 64 + 32 + 128, h); g.lineTo(k * 64 + 128, h);
      g.closePath(); g.fill();
    }
    grime(g, w, h, 0.5, 3);
  }, { repeat: [1, 1] });
}
function stencilTex(lines, { w = 512, h = 256, bg = '#e8b414', fg = '#16130e', font = 'VT323, monospace', size = 0.3, border = true } = {}) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    if (border) { g.strokeStyle = fg; g.lineWidth = h * 0.05; g.strokeRect(h * 0.06, h * 0.06, w - h * 0.12, h - h * 0.12); }
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((l, i) => {
      const s = Array.isArray(l) ? l[1] : size;
      g.font = `${Math.round(h * s)}px ${font}`;
      g.fillText(Array.isArray(l) ? l[0] : l, w / 2, h * ((i + 1) / (lines.length + 1)));
    });
    grime(g, w, h, 0.35, lines.length + 7);
  });
}
function glowTex() {
  return canvasTex(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, { srgb: false });
}

let _M = null;
export function wardrobeMats() {
  if (_M) return _M;
  const hz = hazardTex();
  const boothTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#566660'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${i % 2 ? 255 : 0},${i % 2 ? 255 : 0},${i % 2 ? 255 : 0},0.025)`; g.fillRect(Math.random() * w, Math.random() * h, 30 + Math.random() * 80, 20 + Math.random() * 60); }
    grime(g, w, h, 0.6, 11);
  });
  _M = {
    hazardTex: hz,
    paint: new THREE.MeshStandardMaterial({ color: 0xe39a17, roughness: 0.42, metalness: 0.3 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8b9094, roughness: 0.34, metalness: 0.85 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2b2e31, roughness: 0.55, metalness: 0.6 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xe6eaee, roughness: 0.12, metalness: 1.0 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.82, metalness: 0.0 }),
    hazard: new THREE.MeshStandardMaterial({ map: hz, roughness: 0.55, metalness: 0.2 }),
    booth: new THREE.MeshStandardMaterial({ map: boothTex, color: 0x9aa59f, roughness: 0.62, metalness: 0.45 }),
    boothDark: new THREE.MeshStandardMaterial({ color: 0x1b1f1f, roughness: 0.8, metalness: 0.3 }),
    glowRed: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.32, 0.14) }),
    glowAmber: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 1.55, 0.32) }),
    glowWhite: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.8, 3.4) }),
    glowGreen: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 2.6, 0.6) }),
    ledOff: new THREE.MeshBasicMaterial({ color: 0x1a0d08 }),
    glowTex: glowTex(),
  };
  return _M;
}

// ------------------------------------------------------------------ geometry helpers
const M4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}
// cylinder along an axis ('x' | 'y' | 'z')
export function cyl(r, len, axis = 'y', seg = 16, r2 = r) {
  const g = new THREE.CylinderGeometry(r2, r, len, seg);
  if (axis === 'x') g.rotateZ(-PI / 2);
  else if (axis === 'z') g.rotateX(PI / 2);
  return g;
}
const rbox = (w, h, d, r = 0.01, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
// collects transformed geometries per material and merges them into one mesh per material
export class Batch {
  constructor() { this.by = new Map(); }
  add(geo, mat, m4 = null) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (m4) g.applyMatrix4(m4);
    if (!this.by.has(mat)) this.by.set(mat, []);
    this.by.get(mat).push(g);
    return this;
  }
  box(w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0, r = 0) {
    return this.add(r > 0 ? rbox(w, h, d, r) : new THREE.BoxGeometry(w, h, d), mat, M4(x, y, z, rx, ry, rz));
  }
  build(parent, { shadow = true } = {}) {
    const out = [];
    for (const [mat, list] of this.by) {
      const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
      for (const x of list) if (x !== g) x.dispose();
      const m = new THREE.Mesh(g, mat);
      m.castShadow = shadow && !(mat.isMeshBasicMaterial);
      m.receiveShadow = !mat.isMeshBasicMaterial;
      parent.add(m);
      out.push(m);
    }
    this.by.clear();
    return out;
  }
}
function mesh(geo, mat, parent, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = !mat.isMeshBasicMaterial;
  m.receiveShadow = !mat.isMeshBasicMaterial;
  parent?.add(m);
  return m;
}

// critically-tunable spring on a scalar
class SJ {
  constructor(x = 0) { this.x = x; this.v = 0; this.t = x; }
  step(dt, k, z, wrapAngle = false) {
    let target = this.t;
    if (wrapAngle) target = this.x + wrap(target - this.x);
    const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n, c = 2 * z * Math.sqrt(k);
    for (let i = 0; i < n; i++) { this.v += (k * (target - this.x) - c * this.v) * h; this.x += this.v * h; }
    return this.x;
  }
}

// ------------------------------------------------------------------ robotic arm
let _armGeo = null;
function armGeos() {
  if (_armGeo) return _armGeo;
  _armGeo = {
    unitCyl: new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0),
    barrel: new THREE.CylinderGeometry(0.036, 0.036, 1, 14).translate(0, 0.5, 0),
    rod: new THREE.CylinderGeometry(0.017, 0.017, 1, 10).translate(0, -0.5, 0),
    fingerA: rbox(0.034, 0.03, 0.1, 0.008),
    fingerB: rbox(0.03, 0.026, 0.075, 0.008),
    pad: rbox(0.012, 0.03, 0.06, 0.004),
  };
  return _armGeo;
}

export class RoboArm {
  constructor({ L1 = 1.0, L2 = 0.9, H0 = 0.26, cables = true, color = null } = {}) {
    const M = wardrobeMats(), G = armGeos();
    this.L1 = L1; this.L2 = L2; this.H0 = H0; this.handLen = 0.25;
    const paint = color ? M.paint.clone() : M.paint;
    if (color) paint.color.set(color);
    this.root = new THREE.Group();
    this.root.name = 'RoboArm';
    // base plate with a bolt ring (merged)
    const bb = new Batch();
    bb.add(cyl(0.19, 0.05, 'y', 24), M.dark, M4(0, 0.025, 0));
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; bb.add(cyl(0.014, 0.03, 'y', 8), M.steel, M4(Math.cos(a) * 0.155, 0.055, Math.sin(a) * 0.155)); }
    bb.build(this.root);
    // turret (yaw)
    this.turret = new THREE.Group();
    this.root.add(this.turret);
    const tb = new Batch();
    tb.add(cyl(0.14, 0.2, 'y', 24, 0.12), paint, M4(0, 0.15, 0));
    tb.add(scaleUV(cyl(0.145, 0.045, 'y', 24), 6, 0.35), M.hazard, M4(0, 0.075, 0));
    for (const s of [-1, 1]) tb.add(rbox(0.035, 0.24, 0.2, 0.01), paint, M4(s * 0.105, H0 - 0.02, 0));
    tb.add(cyl(0.075, 0.27, 'x', 18), M.dark, M4(0, H0, 0));
    for (const s of [-1, 1]) tb.add(cyl(0.05, 0.02, 'x', 16), M.chrome, M4(s * 0.14, H0, 0));
    tb.add(rbox(0.12, 0.1, 0.1, 0.015), M.dark, M4(0, 0.17, -0.12)); // motor pack
    tb.build(this.turret);
    // upper arm (pitch about X; extends along +Z)
    this.upper = new THREE.Group();
    this.upper.position.set(0, H0, 0);
    this.turret.add(this.upper);
    const ub = new Batch();
    ub.add(rbox(0.13, 0.15, L1 + 0.06, 0.03, 3), paint, M4(0, 0, L1 / 2));
    ub.add(scaleUV(new THREE.BoxGeometry(0.136, 0.156, 0.07), 1.2, 0.5), M.hazard, M4(0, 0, 0.14));
    ub.add(scaleUV(new THREE.BoxGeometry(0.136, 0.156, 0.07), 1.2, 0.5), M.hazard, M4(0, 0, L1 - 0.15));
    ub.add(rbox(0.14, 0.05, L1 * 0.5, 0.012), M.dark, M4(0, 0.085, L1 * 0.5));
    for (let i = 0; i < 4; i++) ub.add(new THREE.BoxGeometry(0.02, 0.02, 0.02), M.steel, M4(0.072, 0.03, 0.25 + i * (L1 - 0.5) / 3));
    ub.build(this.upper);
    // forearm
    this.fore = new THREE.Group();
    this.fore.position.set(0, 0, L1);
    this.upper.add(this.fore);
    const fb = new Batch();
    fb.add(cyl(0.07, 0.21, 'x', 18), M.dark, M4(0, 0, 0));
    for (const s of [-1, 1]) fb.add(cyl(0.045, 0.02, 'x', 14), M.chrome, M4(s * 0.11, 0, 0));
    fb.add(rbox(0.1, 0.11, L2, 0.025, 3), M.steel, M4(0, 0, L2 / 2));
    fb.add(rbox(0.115, 0.125, L2 * 0.42, 0.03, 3), paint, M4(0, 0, L2 * 0.27));
    fb.add(scaleUV(new THREE.BoxGeometry(0.106, 0.116, 0.05), 1, 0.4), M.hazard, M4(0, 0, L2 - 0.08));
    fb.add(cyl(0.05, 0.13, 'x', 14), paint, M4(0, 0.075, 0.12)); // elbow motor
    fb.build(this.fore);
    // wrist (pitch) + roll + clamp hand
    this.wrist = new THREE.Group();
    this.wrist.position.set(0, 0, L2);
    this.fore.add(this.wrist);
    const wb = new Batch();
    wb.add(cyl(0.058, 0.13, 'x', 16), M.dark, M4(0, 0, 0));
    wb.build(this.wrist);
    this.roll = new THREE.Group();
    this.wrist.add(this.roll);
    const hb = new Batch();
    hb.add(cyl(0.05, 0.05, 'z', 16), M.chrome, M4(0, 0, 0.045));
    hb.add(cyl(0.08, 0.07, 'z', 20), M.dark, M4(0, 0, 0.1));
    hb.add(scaleUV(cyl(0.082, 0.025, 'z', 20), 5, 0.3), M.hazard, M4(0, 0, 0.075));
    hb.add(cyl(0.02, 0.03, 'z', 10), M.glowRed, M4(0, 0, 0.14)); // laser eye in the palm
    hb.build(this.roll);
    this.fingers = [];
    for (let k = 0; k < 3; k++) {
      const fk = new THREE.Group();
      fk.rotation.z = (k / 3) * TAU;
      this.roll.add(fk);
      const piv = new THREE.Group();
      piv.position.set(0, 0.058, 0.13);
      fk.add(piv);
      mesh(G.fingerA, M.steel, piv, 0, 0, 0.05);
      const dist = new THREE.Group();
      dist.position.set(0, 0, 0.1);
      piv.add(dist);
      mesh(G.fingerB, paint, dist, 0, 0, 0.035);
      mesh(G.pad, M.rubber, dist, 0, -0.016, 0.04, 0, 0, PI / 2);
      this.fingers.push({ piv, dist });
    }
    // hydraulic pistons: barrel in the parent frame of anchor A, rod slides out of it
    this.pistons = [
      this._piston(this.turret, new THREE.Vector3(0, 0.1, -0.14), this.upper, new THREE.Vector3(0, -0.1, L1 * 0.42), 0.5),
      this._piston(this.upper, new THREE.Vector3(0, 0.12, L1 * 0.5), this.fore, new THREE.Vector3(0, 0.09, 0.2), 0.4),
    ];
    // cables (instanced segments, root space)
    this.cableN = 10;
    this.cables = cables ? [
      { a: [this.turret, new THREE.Vector3(0.11, 0.2, -0.08)], b: [this.fore, new THREE.Vector3(0.07, 0.03, 0.3)], sag: 0.16 },
      { a: [this.turret, new THREE.Vector3(-0.11, 0.18, -0.1)], b: [this.fore, new THREE.Vector3(-0.065, 0.02, L2 * 0.8)], sag: 0.22 },
    ] : [];
    if (this.cables.length) {
      this.cableMesh = new THREE.InstancedMesh(G.unitCyl, M.rubber, this.cables.length * this.cableN);
      this.cableMesh.frustumCulled = false;
      this.cableMesh.castShadow = true;
      this.root.add(this.cableMesh);
    }
    // joints
    this.J = { yaw: new SJ(), e1: new SJ(1.2), bend: new SJ(2.2), wrist: new SJ(0.5), roll: new SJ(), grip: new SJ(0) };
    this.k = 38; this.z = 0.55;      // joint stiffness / damping (hydraulic overshoot)
    this.gripK = 260;
    this.rest = { yaw: 0, e1: 1.3, bend: 2.4, wrist: 0.6 };
    this.restLocal = null;  // optional rest as an IK goal in root space (set via setRestFrom)
    this.restDirLocal = null;
    this.mode = 'rest';
    this.target = new THREE.Vector3();
    this.approach = new THREE.Vector3(0, -1, 0);
    this.jitter = 0;      // small hydraulic tremble (0..1)
    this.t = Math.random() * 10;
    this.speed = 0;       // joint speed (for sound)
    this.setPose(this.rest, true);
  }

  _piston(pa, A, pb, B, len) {
    const M = wardrobeMats(), G = armGeos();
    const barrel = mesh(G.barrel, M.dark, pa);
    const rod = mesh(G.rod, M.chrome, pa);
    barrel.scale.set(1, len, 1);
    rod.scale.set(1, len, 1);
    return { pa, A, pb, B, barrel, rod };
  }

  // direct joint angles (rest poses, scripted moves)
  setPose(p, snap = false) {
    this.mode = 'pose';
    const J = this.J;
    for (const k of ['yaw', 'e1', 'bend', 'wrist']) if (p[k] !== undefined) { J[k].t = p[k]; if (snap) { J[k].x = p[k]; J[k].v = 0; } }
    if (snap) this._apply();
  }
  // rest goal given in world space now (converted to root space so it follows the arm's mount)
  setRestFrom(worldP, worldDir) {
    this.root.updateWorldMatrix(true, false);
    this.restLocal = this.root.worldToLocal(worldP.clone());
    this.restDirLocal = worldDir.clone().normalize().transformDirection(_m2.copy(this.root.matrixWorld).invert());
  }
  toRest(snap = false) {
    if (!this.restLocal) { this.setPose(this.rest, snap); return; }
    this.mode = 'rest';
    if (snap) {
      this._restGoal();
      this._solve();
      for (const k of ['yaw', 'e1', 'bend', 'wrist']) { this.J[k].x = this.J[k].t; this.J[k].v = 0; }
      this._apply();
    }
  }
  _restGoal() {
    this.root.updateWorldMatrix(true, false);
    this.target.copy(this.restLocal).applyMatrix4(this.root.matrixWorld);
    this.approach.copy(this.restDirLocal).transformDirection(this.root.matrixWorld);
  }
  // fingertips to a world point, hand pointing along `approach` (world unit vector)
  reach(target, approach = null) {
    this.mode = 'ik';
    this.target.copy(target);
    if (approach) this.approach.copy(approach).normalize();
  }
  setGrip(v) { this.J.grip.t = clamp(v, 0, 1); }   // 0 open .. 1 closed
  setRoll(v) { this.J.roll.t = v; }

  // world position of the hand tip / palm
  tip(out = new THREE.Vector3()) { return this.roll.localToWorld(out.set(0, 0, 0.22)); }

  _solve() {
    const L1 = this.L1, L2 = this.L2;
    const W = _v1.copy(this.approach).multiplyScalar(-this.handLen).add(this.target);
    this.root.updateWorldMatrix(true, false);
    this.root.worldToLocal(W);
    const yaw = Math.atan2(W.x, W.z);
    const r = Math.hypot(W.x, W.z), h = W.y - this.H0;
    const d = clamp(Math.hypot(r, h), Math.abs(L1 - L2) + 0.03, L1 + L2 - 0.004);
    const phi = Math.atan2(h, r);
    const a = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const e1 = phi + a;
    const b = Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
    const bend = PI - b;
    // approach direction in the yaw frame -> wrist pitch
    _m1.copy(this.root.matrixWorld).invert();
    const ap = _v2.copy(this.approach).transformDirection(_m1);
    const f = ap.x * Math.sin(yaw) + ap.z * Math.cos(yaw);
    const eW = Math.atan2(ap.y, f);
    const J = this.J;
    J.yaw.t = yaw; J.e1.t = e1; J.bend.t = bend; J.wrist.t = clamp(e1 - bend - eW, -2.2, 2.2);
  }

  _apply() {
    const J = this.J;
    this.turret.rotation.y = J.yaw.x;
    this.upper.rotation.x = -J.e1.x;
    this.fore.rotation.x = J.bend.x;
    this.wrist.rotation.x = J.wrist.x;
    this.roll.rotation.z = J.roll.x;
    const g = J.grip.x;
    for (const f of this.fingers) { f.piv.rotation.x = -0.62 + g * 0.86; f.dist.rotation.x = -0.15 + g * 0.6; }
  }

  update(dt) {
    this.t += dt;
    if (this.mode === 'rest') { this._restGoal(); this._solve(); } else if (this.mode === 'ik') this._solve();
    const J = this.J, k = this.k, z = this.z;
    const prev = J.e1.x + J.bend.x + J.yaw.x;
    if (this.jitter > 0) {
      const j = this.jitter * 0.012;
      J.e1.t += Math.sin(this.t * 31) * j; J.bend.t += Math.sin(this.t * 27 + 1) * j;
    }
    J.yaw.step(dt, k * 0.8, z, true);
    J.e1.step(dt, k, z);
    J.bend.step(dt, k * 1.1, z);
    J.wrist.step(dt, k * 1.6, z * 0.9);
    J.roll.step(dt, 60, 0.7);
    J.grip.step(dt, this.gripK, 0.5);
    this.speed = dt > 0 ? Math.abs(J.e1.x + J.bend.x + J.yaw.x - prev) / dt : 0;
    this._apply();
    this.root.updateMatrixWorld(true);
    // pistons
    for (const p of this.pistons) {
      const a = _v1.copy(p.A);
      const b = p.pb.localToWorld(_v2.copy(p.B));
      p.pa.worldToLocal(b);
      const dir = _v3.subVectors(b, a);
      const L = dir.length() || 1e-4;
      dir.divideScalar(L);
      _q1.setFromUnitVectors(_Y, dir);
      p.barrel.position.copy(a); p.barrel.quaternion.copy(_q1);
      p.rod.position.copy(b); p.rod.quaternion.copy(_q1);
      p.barrel.scale.y = Math.max(0.05, L * 0.6);
      p.rod.scale.y = Math.max(0.05, L * 0.62);
    }
    // cables: quadratic bezier with gravity sag, in root space
    if (this.cableMesh) {
      const inv = _m2.copy(this.root.matrixWorld).invert();
      const down = _S.set(0, -1, 0).transformDirection(inv).clone();
      let n = 0;
      for (const c of this.cables) {
        const P0 = c.a[0].localToWorld(_v1.copy(c.a[1])).applyMatrix4(inv);
        const P2 = c.b[0].localToWorld(_v2.copy(c.b[1])).applyMatrix4(inv);
        const P1 = _v3.addVectors(P0, P2).multiplyScalar(0.5).addScaledVector(down, c.sag * (0.6 + 0.4 * Math.max(0, 1 - P0.distanceTo(P2) / (this.L1 + 0.3))));
        let px = P0.x, py = P0.y, pz = P0.z;
        for (let i = 1; i <= this.cableN; i++) {
          const t = i / this.cableN, u = 1 - t;
          const x = u * u * P0.x + 2 * u * t * P1.x + t * t * P2.x;
          const y = u * u * P0.y + 2 * u * t * P1.y + t * t * P2.y;
          const zz = u * u * P0.z + 2 * u * t * P1.z + t * t * P2.z;
          const dx = x - px, dy = y - py, dz = zz - pz, L = Math.hypot(dx, dy, dz) || 1e-4;
          _q1.setFromUnitVectors(_Y, _v4.set(dx / L, dy / L, dz / L));
          _m1.compose(_v4.set(px, py, pz), _q1, _S.set(0.013, L * 1.04, 0.013));
          this.cableMesh.setMatrixAt(n++, _m1);
          px = x; py = y; pz = zz;
        }
      }
      this.cableMesh.instanceMatrix.needsUpdate = true;
    }
  }
}

// ------------------------------------------------------------------ the booth
export class WardrobeBooth {
  constructor() {
    const M = wardrobeMats();
    const W = 1.64, H = 2.62, D = 1.42, OW = 1.36, OH = 2.22;
    this.W = W; this.H = H; this.D = D; this.OW = OW; this.OH = OH;
    this.root = new THREE.Group();
    this.root.name = 'WardrobeBooth';
    const b = new Batch();
    const zf = D / 2;
    // shell
    b.box(W, H, 0.06, M.booth, 0, H / 2, -zf + 0.03);
    for (const s of [-1, 1]) b.box(0.06, H, D, M.booth, s * (W / 2 - 0.03), H / 2, 0);
    b.box(W + 0.04, 0.09, D + 0.04, M.dark, 0, H - 0.045, 0, 0, 0, 0, 0.01);
    b.box(W + 0.06, 0.1, D + 0.06, M.dark, 0, 0.05, 0, 0, 0, 0, 0.01);
    // inner darkness + grating floor
    b.box(W - 0.14, 0.012, D - 0.1, M.boothDark, 0, 0.106, 0);
    b.add(scaleUV(new THREE.BoxGeometry(OW, 0.015, 0.16), 8, 1), M.hazard, M4(0, 0.11, zf - 0.08));
    // front frame: lintel + jambs, hazard edging
    b.box(W, H - OH, 0.1, M.booth, 0, (H + OH) / 2, zf - 0.05);
    for (const s of [-1, 1]) b.box((W - OW) / 2, OH, 0.1, M.booth, s * (OW / 2 + (W - OW) / 4), OH / 2, zf - 0.05);
    b.add(scaleUV(new THREE.BoxGeometry(OW + 0.08, 0.06, 0.11), 10, 0.5), M.hazard, M4(0, OH + 0.03, zf - 0.04));
    for (const s of [-1, 1]) b.add(scaleUV(new THREE.BoxGeometry(0.05, OH, 0.11), 0.4, 16), M.hazard, M4(s * (OW / 2 + 0.025), OH / 2, zf - 0.04));
    // side ribs + top rail
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i++) b.box(0.03, H - 0.25, 0.04, M.booth, s * (W / 2 + 0.012), H / 2, -zf + 0.22 + i * (D - 0.44) / 3);
      b.box(0.04, 0.05, D, M.dark, s * (W / 2 + 0.02), H - 0.32, 0);
    }
    // sign box
    b.box(1.3, 0.3, 0.16, M.dark, 0, H + 0.17, zf - 0.12, 0, 0, 0, 0.02);
    // ducting to the ceiling
    b.add(cyl(0.11, 0.6, 'y', 18), M.rubber, M4(-0.42, H + 0.3, -0.25));
    for (let i = 0; i < 5; i++) b.add(cyl(0.122, 0.03, 'y', 18), M.steel, M4(-0.42, H + 0.08 + i * 0.12, -0.25));
    b.add(cyl(0.045, 0.6, 'y', 12), M.steel, M4(0.35, H + 0.3, -0.35));
    b.add(cyl(0.035, 0.6, 'y', 12), M.paint, M4(0.5, H + 0.3, -0.35));
    // control panel on the right flank
    b.box(0.07, 0.46, 0.34, M.dark, W / 2 + 0.06, 1.35, zf - 0.32, 0, 0, 0, 0.012);
    b.box(0.02, 0.1, 0.24, M.boothDark, W / 2 + 0.1, 1.48, zf - 0.32);
    b.add(cyl(0.03, 0.04, 'x', 12), M.glowRed, M4(W / 2 + 0.11, 1.24, zf - 0.4)); // big red button
    b.add(cyl(0.04, 0.02, 'x', 14), M.hazard, M4(W / 2 + 0.1, 1.24, zf - 0.4));
    // interior: back strip light + arm mount plates
    b.box(OW - 0.1, 0.05, 0.03, M.glowRed, 0, 2.2, -zf + 0.08);
    b.box(OW - 0.1, 0.03, 0.03, M.glowRed, 0, 0.3, -zf + 0.08);
    for (const s of [-1, 1]) b.box(0.42, 0.42, 0.03, M.dark, s * 0.4, 1.22, -zf + 0.065);
    b.box(0.42, 0.03, 0.42, M.dark, 0, H - 0.095, 0.06);
    b.build(this.root);
    // sign face (emissive canvas)
    const signTex = canvasTex(512, 128, (g, w, h) => {
      g.fillStyle = '#120806'; g.fillRect(0, 0, w, h);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = '#ff7a20'; g.shadowBlur = 14;
      g.fillStyle = '#ffb43a'; g.font = '78px VT323, monospace';
      g.fillText('WARDROBE', w / 2, h * 0.42);
      g.shadowBlur = 0; g.fillStyle = '#c8301e'; g.font = '26px VT323, monospace';
      g.fillText('AUTO-OUTFITTER MK.II  ·  BAY 07', w / 2, h * 0.84);
    });
    this.signMat = new THREE.MeshBasicMaterial({ map: signTex, color: new THREE.Color(1.7, 1.7, 1.7) });
    mesh(new THREE.PlaneGeometry(1.22, 0.24), this.signMat, this.root, 0, H + 0.17, zf - 0.035);
    // caution placard on the left jamb + stencil on the right
    const plac = new THREE.MeshStandardMaterial({ map: stencilTex([['CAUTION', 0.32], ['ROBOTIC ARMS', 0.17], ['KEEP 2 M CLEAR', 0.14]], { w: 256, h: 320 }), roughness: 0.6 });
    mesh(new THREE.PlaneGeometry(0.2, 0.25), plac, this.root, -(W / 2 + 0.002), 1.45, zf - 0.35, 0, -PI / 2, 0);
    // beacon (rotating amber reflector under a dome)
    this.beacon = new THREE.Group();
    this.beacon.position.set(0.55, H + 0.32, zf - 0.12);
    this.root.add(this.beacon);
    mesh(cyl(0.07, 0.04, 'y', 16), M.dark, this.beacon, 0, -0.02, 0);
    this.beaconMat = new THREE.MeshStandardMaterial({ color: 0xff8a1a, emissive: 0xff6a00, emissiveIntensity: 0.4, transparent: true, opacity: 0.75, roughness: 0.2 });
    mesh(new THREE.SphereGeometry(0.065, 16, 10, 0, TAU, 0, PI / 2), this.beaconMat, this.beacon, 0, 0, 0);
    this.beaconSpin = new THREE.Group();
    this.beacon.add(this.beaconSpin);
    mesh(new THREE.BoxGeometry(0.06, 0.04, 0.012), M.glowAmber, this.beaconSpin, 0, 0.03, 0.02);
    // status LEDs (blink)
    this.leds = [];
    for (let i = 0; i < 5; i++) {
      const m = mesh(new THREE.BoxGeometry(0.012, 0.022, 0.022), M.ledOff, this.root, W / 2 + 0.11, 1.48, zf - 0.42 + i * 0.05);
      m.castShadow = false;
      this.leds.push(m);
    }
    // doors: louvred leaves hinged at the jambs, swinging out (+z)
    this.doors = [];
    for (const s of [-1, 1]) {
      const piv = new THREE.Group();
      piv.position.set(s * OW / 2, 0.1, zf - 0.02);
      this.root.add(piv);
      const db = new Batch();
      const dw = OW / 2 - 0.006, dh = OH - 0.12, cx = -s * dw / 2;
      db.box(0.07, dh, 0.05, M.booth, -s * 0.035, dh / 2, 0);
      db.box(0.07, dh, 0.05, M.booth, -s * (dw - 0.035), dh / 2, 0);
      for (const y of [0.05, dh - 0.05, dh * 0.5]) db.box(dw, 0.1, 0.05, M.booth, cx, y, 0);
      for (let i = 0; i < 9; i++) db.box(dw - 0.12, 0.085, 0.012, M.booth, cx, 0.16 + i * 0.105, 0, -0.75, 0, 0);
      for (let i = 0; i < 8; i++) db.box(dw - 0.12, 0.085, 0.012, M.booth, cx, dh * 0.5 + 0.1 + i * 0.105, 0, -0.75, 0, 0);
      db.add(scaleUV(new THREE.BoxGeometry(dw, 0.05, 0.055), 6, 0.5), M.hazard, M4(cx, dh * 0.5 + 0.0, 0.002));
      db.add(cyl(0.014, 0.42, 'y', 10), M.chrome, M4(-s * (dw - 0.11), dh * 0.52, 0.06));
      for (const y of [dh * 0.42, dh * 0.62]) db.box(0.03, 0.03, 0.05, M.chrome, -s * (dw - 0.11), y, 0.04);
      for (const y of [0.25, dh - 0.25]) db.add(cyl(0.025, 0.12, 'y', 10), M.dark, M4(0, y, 0.0)); // hinges
      db.build(piv);
      const num = new THREE.MeshStandardMaterial({ map: stencilTex([['0' + (s < 0 ? 7 : 7), 0.7]], { w: 128, h: 128, bg: '#5f6e68', fg: '#e8b414', border: false }), roughness: 0.6 });
      mesh(new THREE.PlaneGeometry(0.16, 0.16), num, piv, cx, dh * 0.82, 0.027);
      this.doors.push({ piv, s, j: new SJ(0) });
    }
    this.doorTarget = 0;   // 0 closed .. 1 open
    this.onDoorHit = null; // (kind 'open' | 'close', strength)
    this._doorWasOpen = false;
    // arms: two on the back wall (yaw axis pointing out of the doors), one hanging from the roof
    this.arms = [];
    const mk = (x, y, z, rx, o) => {
      const a = new RoboArm(o);
      a.root.position.set(x, y, z);
      a.root.rotation.set(rx, 0, 0);
      this.root.add(a.root);
      this.arms.push(a);
      return a;
    };
    this.armL = mk(-0.4, 1.22, -zf + 0.07, PI / 2, { L1: 1.05, L2: 1.08 });
    this.armR = mk(0.4, 1.22, -zf + 0.07, PI / 2, { L1: 1.05, L2: 1.08 });
    this.armT = mk(0, H - 0.1, 0.06, PI, { L1: 0.62, L2: 0.98, cables: false });
    // folded rest poses: upper arm up the back wall, forearm folded down in front of it / tucked under the roof
    this.armL.rest = { yaw: 0.12, e1: PI - 0.2, bend: 2.55, wrist: -1.05 };
    this.armR.rest = { yaw: -0.12, e1: PI - 0.2, bend: 2.55, wrist: -1.05 };
    this.armT.rest = { yaw: 0, e1: 0.1, bend: -2.62, wrist: 0.7 };
    for (const a of this.arms) a.toRest(true);
    this.t = 0;
    this.active = 0;   // 0 idle .. 1 busy (beacon + LEDs)
  }

  setDoors(open) { this.doorTarget = open ? 1 : 0; }
  get doorOpen() { return this.doors[0].j.x; }

  update(dt) {
    this.t += dt;
    const t = this.t;
    for (const d of this.doors) {
      const j = d.j;
      j.t = this.doorTarget * 1.92;
      const opening = this.doorTarget > 0.5;
      j.step(dt, opening ? 70 : 140, opening ? 0.32 : 0.6);
      if (j.x < 0) {
        if (j.v < -1.2 && d.s < 0) this.onDoorHit?.('close', Math.min(1, -j.v / 6));
        j.x = 0; j.v = -j.v * 0.22;
      }
      if (j.x > 2.15) { j.x = 2.15; j.v = -j.v * 0.3; }
      d.piv.rotation.y = -d.s * j.x;
    }
    const open = this.doors[0].j.x > 1.2;
    if (open && !this._doorWasOpen) this.onDoorHit?.('open', 1);
    this._doorWasOpen = open;
    // beacon + LEDs
    const act = this.active;
    this.beaconSpin.rotation.y += dt * (1 + act * 9);
    this.beaconMat.emissiveIntensity = 0.25 + act * (1.6 + Math.sin(t * 18) * 0.6);
    const M = wardrobeMats();
    this.leds.forEach((m, i) => {
      const on = act > 0.5 ? Math.sin(t * (6 + i * 3.1) + i) > 0 : Math.sin(t * (0.9 + i * 0.37) + i * 2) > 0.6;
      m.material = on ? (i === 4 ? M.glowRed : i % 2 ? M.glowAmber : M.glowGreen) : M.ledOff;
    });
    for (const a of this.arms) a.update(dt);
  }
}

// ------------------------------------------------------------------ the outfitting chamber
export class WardrobeChamber {
  constructor() {
    const M = wardrobeMats();
    const R = 3.5, H = 3.9;
    this.R = R; this.H = H;
    this.root = new THREE.Group();
    this.root.name = 'WardrobeChamber';
    const wallTex = canvasTex(1024, 256, (g, w, h) => {
      g.fillStyle = '#3d4643'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 24; i++) {
        const x = (i / 24) * w;
        g.fillStyle = i % 2 ? '#353d3a' : '#444e4a'; g.fillRect(x, 0, w / 24, h);
        g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x, 0, 3, h);
        g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(x + 3, 0, 2, h);
        for (const y of [0.12, 0.5, 0.88]) { g.fillStyle = 'rgba(200,200,190,0.3)'; g.fillRect(x + 8, y * h, 4, 4); g.fillRect(x + w / 24 - 12, y * h, 4, 4); }
      }
      // hazard band near the floor
      for (let x = 0; x < w; x += 32) { g.fillStyle = (x / 32) % 2 ? '#16130e' : '#e8b414'; g.beginPath(); g.moveTo(x, h * 0.84); g.lineTo(x + 32, h * 0.84); g.lineTo(x + 22, h * 0.94); g.lineTo(x - 10, h * 0.94); g.fill(); }
      g.fillStyle = '#e8b414'; g.font = '34px VT323, monospace';
      for (let i = 0; i < 4; i++) g.fillText('BAY 07 · KEEP ARMS INSIDE THE HARNESS', i * w / 4 + 20, h * 0.32);
      grime(g, w, h, 0.8, 5);
    }, { repeat: [3, 1] });
    const wall = mesh(new THREE.CylinderGeometry(R, R, H, 48, 1, true), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.5, metalness: 0.55, side: THREE.BackSide }), this.root, 0, H / 2, 0);
    wall.castShadow = false;
    const floorTex = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#151816'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#4a514d'; g.lineWidth = 5;
      for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * w / 8, 0); g.lineTo(i * w / 8, h); g.stroke(); g.beginPath(); g.moveTo(0, i * h / 8); g.lineTo(w, i * h / 8); g.stroke(); }
      grime(g, w, h, 0.6, 9);
    }, { repeat: [6, 6] });
    const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.6, metalness: 0.7 });
    mesh(new THREE.CircleGeometry(R, 48).rotateX(-PI / 2), floorMat, this.root, 0, 0, 0);
    const ringTex = hazardTex(); ringTex.repeat.set(24, 1);
    mesh(new THREE.RingGeometry(0.95, 1.12, 64, 1).rotateX(-PI / 2), new THREE.MeshStandardMaterial({ map: ringTex, roughness: 0.6 }), this.root, 0, 0.004, 0);
    const b = new Batch();
    b.add(new THREE.CircleGeometry(R, 48).rotateX(PI / 2), M.boothDark, M4(0, H, 0));
    b.add(new THREE.TorusGeometry(0.9, 0.04, 8, 48).rotateX(PI / 2), M.steel, M4(0, H - 0.25, 0));
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; b.add(cyl(0.02, 0.25, 'y', 8), M.steel, M4(Math.cos(a) * 0.9, H - 0.125, Math.sin(a) * 0.9)); }
    // wall pipes + cage lamps
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + 0.15, x = Math.cos(a) * (R - 0.08), z = Math.sin(a) * (R - 0.08);
      b.add(cyl(0.035, H, 'y', 10), i % 3 ? M.steel : M.paint, M4(x, H / 2, z));
      if (i % 2 === 0) { b.add(rbox(0.12, 0.06, 0.12, 0.01), M.dark, M4(Math.cos(a) * (R - 0.12), 2.9, Math.sin(a) * (R - 0.12))); b.add(cyl(0.035, 0.05, 'y', 10), M.glowRed, M4(Math.cos(a) * (R - 0.12), 2.86, Math.sin(a) * (R - 0.12))); }
    }
    // spot fixture
    b.add(cyl(0.22, 0.28, 'y', 24, 0.16), M.dark, M4(0, H - 0.14, 0.35));
    b.add(cyl(0.2, 0.01, 'y', 24), M.glowWhite, M4(0, H - 0.285, 0.35));
    b.build(this.root);
    // volumetric cone under the spot (additive, fades with height and towards the rim)
    const coneH = H - 0.3;
    const coneGeo = new THREE.ConeGeometry(1.15, coneH, 40, 1, true).translate(0, -coneH / 2, 0);
    this.coneMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uI: { value: 0.07 }, uCol: { value: new THREE.Color(1.0, 0.92, 0.75) } },
      vertexShader: 'varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = position.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
      fragmentShader: `uniform float uI; uniform vec3 uCol; varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ float h = clamp(-vY / ${coneH.toFixed(3)}, 0.0, 1.0); float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
          float a = uI * edge * (1.0 - h * 0.75) * smoothstep(0.0, 0.08, h); gl_FragColor = vec4(uCol * a, 1.0); }`,
    });
    this.cone = mesh(coneGeo, this.coneMat, this.root, 0, H - 0.29, 0.35, 0.13, 0, 0);
    this.cone.castShadow = false; this.cone.receiveShadow = false;
    // harness: cable from the rail trolley, yoke with straps (rotates with the subject)
    this.harness = new THREE.Group();
    this.harness.position.y = 0.22;   // the subject's boots dangle well clear of the grating
    this.root.add(this.harness);
    this.harnessY = 1.5;  // yoke height (subject shoulders)
    const hb = new Batch();
    hb.add(cyl(0.012, H - 1.72 - 0.25 - 0.22, 'y', 8), M.steel, M4(0, 1.72 + (H - 1.72 - 0.47) / 2, 0));
    hb.add(rbox(0.12, 0.1, 0.12, 0.015), M.dark, M4(0, 1.72, 0));
    hb.add(rbox(0.62, 0.05, 0.06, 0.015), M.paint, M4(0, 1.62, 0));
    hb.add(scaleUV(new THREE.BoxGeometry(0.2, 0.055, 0.065), 2, 0.5), M.hazard, M4(0, 1.62, 0));
    for (const s of [-1, 1]) {
      hb.add(cyl(0.008, 0.22, 'y', 6), M.steel, M4(s * 0.29, 1.5, 0, 0, 0, s * 0.2));
      hb.add(rbox(0.07, 0.06, 0.07, 0.01), M.dark, M4(s * 0.27, 1.39, 0));
    }
    hb.build(this.harness);
    // status screen on the back wall
    this.screenCv = document.createElement('canvas');
    this.screenCv.width = 512; this.screenCv.height = 256;
    this.screenTex = new THREE.CanvasTexture(this.screenCv);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    const scr = new THREE.Group();
    scr.position.set(0, 2.55, -(R - 0.12));
    this.root.add(scr);
    mesh(rbox(1.0, 0.56, 0.08, 0.02), M.dark, scr, 0, 0, -0.03);
    mesh(new THREE.PlaneGeometry(0.92, 0.46), new THREE.MeshBasicMaterial({ map: this.screenTex, color: new THREE.Color(1.5, 1.5, 1.5) }), scr, 0, 0, 0.012);
    this.setStatus('STANDBY', '');
    // three floor robots on pedestals around the subject (left, right, behind)
    this.arms = [];
    const mk = (ang, rad, o) => {
      const ped = new THREE.Group();
      ped.position.set(Math.sin(ang) * rad, 0, Math.cos(ang) * rad);
      ped.rotation.y = ang + PI;
      this.root.add(ped);
      const pb = new Batch();
      pb.box(0.46, 0.34, 0.46, M.dark, 0, 0.17, 0, 0, 0, 0, 0.02);
      pb.add(scaleUV(new THREE.BoxGeometry(0.47, 0.06, 0.47), 4, 0.5), M.hazard, M4(0, 0.3, 0));
      pb.build(ped);
      const a = new RoboArm(o);
      a.root.position.y = 0.34;
      ped.add(a.root);
      this.arms.push(a);
      return a;
    };
    this.armL = mk(-PI * 0.58, 1.36, { L1: 1.05, L2: 1.0 });
    this.armR = mk(PI * 0.58, 1.36, { L1: 1.05, L2: 1.0 });
    this.armB = mk(PI * 0.8, 1.25, { L1: 1.2, L2: 1.1, color: 0xd8d2c0 });
    for (const a of this.arms) { a.rest = { yaw: 0, e1: 1.75, bend: 2.75, wrist: -1.2 }; a.toRest(true); }
    this.t = 0;
  }

  setStatus(line1, line2 = '', alert = false) {
    const c = this.screenCv, g = c.getContext('2d'), w = c.width, h = c.height;
    g.fillStyle = '#031208'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(80,255,140,0.06)';
    for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 2);
    const col = alert ? '#ff5a3a' : '#4dff7a';
    g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 10;
    g.font = '40px VT323, monospace'; g.textAlign = 'left';
    g.fillText('R.O.O.M. OUTFITTING BAY 07', 24, 52);
    g.font = '58px VT323, monospace';
    g.fillText(String(line1).slice(0, 22), 24, 130);
    g.font = '34px VT323, monospace';
    g.fillText(String(line2).slice(0, 30), 24, 190);
    g.shadowBlur = 0;
    g.fillText('> _', 24, 236);
    this.screenTex.needsUpdate = true;
  }

  update(dt) {
    this.t += dt;
    for (const a of this.arms) a.update(dt);
  }
}

// ------------------------------------------------------------------ sparks
export class Sparks {
  constructor(max = 180) {
    const M = wardrobeMats();
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.floor = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(this.geo, new THREE.PointsMaterial({ size: 0.035, map: M.glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.i = 0;
    for (let k = 0; k < max; k++) this.pos[k * 3 + 1] = -999;
  }
  burst(p, dir = null, n = 40, speed = 2.6, floorY = 0) {
    for (let k = 0; k < n; k++) {
      const i = this.i; this.i = (this.i + 1) % this.max;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      let vx = Math.random() * 2 - 1, vy = Math.random() * 2 - 1, vz = Math.random() * 2 - 1;
      const l = Math.hypot(vx, vy, vz) || 1;
      const s = speed * (0.3 + Math.random() * 0.9);
      vx = vx / l * s; vy = vy / l * s + speed * 0.35; vz = vz / l * s;
      if (dir) { vx += dir.x * speed * 0.6; vy += dir.y * speed * 0.6; vz += dir.z * speed * 0.6; }
      this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
      this.life[i] = 0.35 + Math.random() * 0.6;
      this.floor[i] = floorY;
    }
  }
  update(dt) {
    const P = this.pos, V = this.vel, C = this.col;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { if (P[i * 3 + 1] > -900) { P[i * 3 + 1] = -999; C[i * 3] = C[i * 3 + 1] = C[i * 3 + 2] = 0; } continue; }
      this.life[i] -= dt;
      V[i * 3 + 1] -= 9.8 * dt;
      const drag = 1 - 1.2 * dt;
      V[i * 3] *= drag; V[i * 3 + 2] *= drag;
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
      if (P[i * 3 + 1] < this.floor[i]) { P[i * 3 + 1] = this.floor[i]; V[i * 3 + 1] *= -0.35; V[i * 3] *= 0.6; V[i * 3 + 2] *= 0.6; }
      const l = Math.max(0, this.life[i]);
      const hot = Math.min(1, l * 2.2);
      C[i * 3] = 3.2 * Math.min(1, l * 3); C[i * 3 + 1] = (0.5 + 2.2 * hot) * Math.min(1, l * 3); C[i * 3 + 2] = (0.08 + 1.6 * hot * hot) * Math.min(1, l * 3);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

// =====================================================================================================
// FACTORY KIT — props of the main-menu clone factory (world/menu_scene.js): materials, hanging menu
// panels, the floor hatch + drop shaft, panel controls (knob / toggle / fader / selector), crates,
// debris (bolts, oil, ripped parts), steam and dust motes. All procedural.
// =====================================================================================================
// signage type roles (ui/fonts.js): art-deco display for sign titles, CRT pixel type for the small print
export const PLEX = FONT.deco, VT = FONT.crt;
// green phosphor palette + helpers shared by every readout of the factory (Pip-Boy-like terminals)
export const PHOS = { hi: '#9dffb2', mid: '#5cf07e', soft: '#b8ffc8', dim: '#2c6a3c', bg: '#010603' };
// bracket corners instead of a boxed border
export function brackets(g, x, y, w, h, len = 40, color = PHOS.mid, lw = 4, glow = 10) {
  g.save(); g.strokeStyle = color; g.lineWidth = lw; g.shadowColor = color; g.shadowBlur = glow; g.lineCap = 'square';
  for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
    g.beginPath(); g.moveTo(cx + sx * len, cy); g.lineTo(cx, cy); g.lineTo(cx, cy + sy * len); g.stroke();
  }
  g.restore();
}
export function scanlines(g, w, h, a = 0.25) {
  g.fillStyle = `rgba(0,0,0,${a})`;
  for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 2);
  const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = v; g.fillRect(0, 0, w, h);
}
// dark phosphor screen background with a faint glow in the middle
export function phosphorBg(g, w, h) {
  g.fillStyle = PHOS.bg; g.fillRect(0, 0, w, h);
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
  r.addColorStop(0, 'rgba(40,150,70,0.18)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, w, h);
}
export { mesh as kitMesh, rbox as kitRbox, M4 as kitM4 };

let _F = null;
export function factoryMats() {
  if (_F) return _F;
  const W = wardrobeMats();
  const concrete = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#6f6d68'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { const v = 90 + Math.random() * 40 | 0; g.fillStyle = `rgba(${v},${v - 2},${v - 6},0.18)`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3); }
    for (let i = 0; i < 9; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = 20 + Math.random() * 70;
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(18,14,10,0.55)'); gr.addColorStop(1, 'rgba(18,14,10,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.strokeStyle = 'rgba(30,28,26,0.6)'; g.lineWidth = 2; g.strokeRect(0, 0, w, h);
    g.strokeStyle = 'rgba(25,22,20,0.45)'; g.lineWidth = 1;
    for (let i = 0; i < 5; i++) { let x = Math.random() * w, y = Math.random() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 7; k++) { x += (Math.random() - 0.5) * 40; y += Math.random() * 25; g.lineTo(x, y); } g.stroke(); }
    grime(g, w, h, 0.5, 21);
  }, { repeat: [8, 8] });
  const corr = canvasTex(256, 256, (g, w, h) => {
    for (let x = 0; x < w; x++) { const s = 0.5 + 0.5 * Math.sin((x / w) * Math.PI * 16); const v = 52 + s * 30 | 0; g.fillStyle = `rgb(${v},${v + 3},${v + 6})`; g.fillRect(x, 0, 1, h); }
    for (let i = 0; i < 14; i++) { const x = Math.random() * w, y = Math.random() * h * 0.6, l = 40 + Math.random() * 140; const gr = g.createLinearGradient(0, y, 0, y + l); gr.addColorStop(0, 'rgba(110,54,24,0.5)'); gr.addColorStop(1, 'rgba(110,54,24,0)'); g.fillStyle = gr; g.fillRect(x, y, 2 + Math.random() * 6, l); }
    grime(g, w, h, 0.8, 5);
  }, { repeat: [10, 1] });
  const wood = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#9a7448'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) { g.fillStyle = `rgba(${60 + Math.random() * 30 | 0},40,20,${0.08 + Math.random() * 0.1})`; g.fillRect(0, y, w, 1 + Math.random() * 2); }
    for (let k = 0; k < 4; k++) { g.fillStyle = 'rgba(40,26,14,0.7)'; g.fillRect(0, k * 64, w, 3); }
    for (let k = 0; k < 8; k++) { g.fillStyle = 'rgba(30,30,30,0.8)'; g.beginPath(); g.arc(10 + (k % 2) * (w - 20), 14 + (k >> 1) * 64, 3, 0, Math.PI * 2); g.fill(); }
    grime(g, w, h, 0.6, 9);
  });
  const cash = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#7f9a72'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#3e5638'; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#3e5638'; g.font = `bold 44px ${PLEX}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('100', w / 2, h / 2);
    g.beginPath(); g.arc(46, h / 2, 26, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(w - 46, h / 2, 26, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#c9b88a'; g.fillRect(w / 2 - 22, 0, 44, h);
    g.fillStyle = '#5b4a2a'; g.font = `bold 16px ${PLEX}`; g.fillText('$10K', w / 2, h / 2);
  });
  const straw = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#6e5a2e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) { g.strokeStyle = `rgba(${190 + Math.random() * 50 | 0},${150 + Math.random() * 50 | 0},70,0.8)`; g.lineWidth = 1; const x = Math.random() * w, y = Math.random() * h, a = Math.random() * Math.PI; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14); g.stroke(); }
  }, { repeat: [2, 2] });
  _F = {
    ...W,
    floor: new THREE.MeshStandardMaterial({ map: concrete, color: 0x8b8a86, roughness: 0.86, metalness: 0.05 }),
    wall: new THREE.MeshStandardMaterial({ map: corr, color: 0x8a9096, roughness: 0.62, metalness: 0.55 }),
    beam: new THREE.MeshStandardMaterial({ color: 0x34383c, roughness: 0.55, metalness: 0.6 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xd49a12, roughness: 0.5, metalness: 0.3 }),
    rust: new THREE.MeshStandardMaterial({ color: 0x5b3a26, roughness: 0.8, metalness: 0.4 }),
    wood: new THREE.MeshStandardMaterial({ map: wood, roughness: 0.82, metalness: 0 }),
    cash: new THREE.MeshStandardMaterial({ map: cash, roughness: 0.75 }),
    straw: new THREE.MeshStandardMaterial({ map: straw, roughness: 1 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb08a48, roughness: 0.32, metalness: 1 }),
    gunmetal: new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.5, metalness: 0.8 }),
    cabinet: new THREE.MeshStandardMaterial({ color: 0x556058, roughness: 0.6, metalness: 0.5 }),
    knob: new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.35, metalness: 0.2 }),
    redPaint: new THREE.MeshStandardMaterial({ color: 0xb01c14, roughness: 0.4, metalness: 0.1 }),
    oil: new THREE.MeshStandardMaterial({ color: 0x0b0806, roughness: 0.05, metalness: 0.3 }),
    lampWarm: new THREE.MeshBasicMaterial({ color: new THREE.Color(4.2, 3.2, 2.0) }),
    lampCold: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 3.2, 3.6) }),
    lampRed: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 0.25, 0.12) }),
    black: new THREE.MeshBasicMaterial({ color: 0x000000 }),
  };
  return _F;
}

// draws into a canvas texture that can be redrawn later (signs, CRTs, tags)
export class LiveTex {
  constructor(w, h, draw) {
    this.c = document.createElement('canvas'); this.c.width = w; this.c.height = h;
    this.g = this.c.getContext('2d'); this.w = w; this.h = h;
    this.tex = new THREE.CanvasTexture(this.c); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 4;
    if (draw) this.draw(draw);
  }
  draw(fn) { fn(this.g, this.w, this.h); this.tex.needsUpdate = true; return this; }
}
// fit text into a width by shrinking the font
export function fitText(g, s, x, y, maxW, size, font, align = 'center') {
  let sz = size;
  g.font = font.replace('{s}', sz);
  while (g.measureText(s).width > maxW && sz > 8) { sz -= 2; g.font = font.replace('{s}', sz); }
  g.textAlign = align; g.fillText(s, x, y);
  return sz;
}
export function wrapLines(g, text, maxW) {
  const out = []; let line = '';
  for (const w of String(text).split(' ')) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; }
  if (line) out.push(line);
  return out;
}

// a heavy backlit sign box hanging from two chains (pivot = ceiling point). The face is a LiveTex used as
// map + emissiveMap so only the painted letters glow. Hover brightens it; kick() makes it swing.
export class HangPanel {
  constructor({ w = 1.5, h = 0.42, accent = PHOS.hi } = {}) {
    const F = factoryMats();
    this.w = w; this.h = h; this.accent = accent;
    this.root = new THREE.Group(); this.root.rotation.order = 'YXZ';
    this.body = new THREE.Group(); this.root.add(this.body);
    mesh(rbox(w + 0.1, h + 0.1, 0.12, 0.025), F.dark, this.body, 0, 0, -0.01);
    const hz = mesh(new THREE.BoxGeometry(w + 0.1, 0.035, 0.125), F.hazard, this.body, 0, -h / 2 - 0.068, -0.01);
    hz.material = F.hazard;
    const ch = Math.round(1024 * h / w);
    this.face = new LiveTex(1024, ch);
    this.mat = new THREE.MeshStandardMaterial({ map: this.face.tex, emissiveMap: this.face.tex, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.32, metalness: 0.1 });
    this.hit = mesh(new THREE.PlaneGeometry(w, h), this.mat, this.body, 0, 0, 0.052);
    this.hit.castShadow = false;
    // glass sheen
    mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, roughness: 0.05, metalness: 0, clearcoat: 1, depthWrite: false }), this.body, 0, 0, 0.058).castShadow = false;
    for (const s of [-1, 1]) {
      mesh(new THREE.TorusGeometry(0.025, 0.007, 6, 12), F.steel, this.body, s * (w / 2 - 0.12), h / 2 + 0.08, 0);
    }
    const cg = cyl(0.007, 1, 'y', 6).translate(0, 0.5, 0);
    this.chains = [-1, 1].map((s) => { const m = mesh(cg, F.steel, this.body, s * (w / 2 - 0.12), h / 2 + 0.1, 0); m.castShadow = false; return m; });
    this.glow = 0; this.on = 1; this.base = 1;
    this.sw = { x: 0, z: 0, vx: 0, vz: 0 };
    this.t = Math.random() * 10;
  }
  setText(title, sub = '', { dim = false, tag = '' } = {}) {
    const acc = dim ? PHOS.dim : this.accent;
    this.face.draw((g, w, h) => {
      g.fillStyle = '#020604'; g.fillRect(0, 0, w, h);
      const vg = g.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, w * 0.6);
      vg.addColorStop(0, dim ? 'rgba(20,60,30,0.10)' : 'rgba(40,140,70,0.16)'); vg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = vg; g.fillRect(0, 0, w, h);
      brackets(g, 18, 18, w - 36, h - 36, Math.min(60, h * 0.26), acc, dim ? 3 : 5, dim ? 0 : 14);
      g.fillStyle = acc; g.shadowColor = acc; g.shadowBlur = dim ? 0 : 24; g.textBaseline = 'middle';
      fitText(g, title, w / 2, h * (sub ? 0.42 : 0.52), w - 140, Math.round(h * 0.44), `{s}px ${PLEX}`);
      if (sub) {
        g.shadowBlur = dim ? 0 : 10;
        g.fillStyle = acc; g.fillRect(w * 0.2, h * 0.64, w * 0.6, 2);
        g.fillStyle = dim ? PHOS.dim : PHOS.soft; fitText(g, sub, w / 2, h * 0.79, w - 160, Math.round(h * 0.2), `{s}px ${VT}`);
      }
      g.shadowBlur = 0;
      if (tag) { g.fillStyle = acc; g.font = `${Math.round(h * 0.14)}px ${VT}`; g.textAlign = 'left'; g.fillText(tag, 34, 44); }
      scanlines(g, w, h, 0.22);
    });
    this.base = dim ? 0.5 : 1;
  }
  // pivot at (x, ceilY, z), panel centre at height y
  place(x, y, z, ceilY, yaw = 0) {
    this.root.position.set(x, ceilY, z);
    this.root.rotation.y = yaw;
    const drop = ceilY - y;
    this.body.position.set(0, -drop, 0);
    for (const c of this.chains) c.scale.y = Math.max(0.05, drop - this.h / 2 - 0.1);
  }
  kick(a = 1) { this.sw.vx += (Math.random() - 0.5) * 0.5 * a; this.sw.vz += (Math.random() - 0.5) * 0.9 * a; }
  update(dt, hover = false) {
    this.t += dt;
    this.glow += ((hover ? 1 : 0) - this.glow) * (1 - Math.exp(-10 * dt));
    const fl = this.on < 1 ? (Math.random() < 0.5 ? 0.1 : 1) * this.on : 1;
    this.mat.emissiveIntensity = this.base * fl * (0.75 + 0.95 * this.glow + 0.04 * Math.sin(this.t * 31) * Math.sin(this.t * 7));
    const s = this.sw, L = Math.max(0.5, -this.body.position.y);
    const k = 9.8 / L;
    s.vx += (-k * s.x - 1.2 * s.vx) * dt; s.vz += (-k * s.z - 1.2 * s.vz) * dt;
    s.x += s.vx * dt; s.z += s.vz * dt;
    this.root.rotation.x = s.x + Math.sin(this.t * 0.7) * 0.004;
    this.root.rotation.z = s.z + Math.sin(this.t * 0.53 + 1) * 0.006;
    this.body.position.z = this.glow * 0.02;
  }
}

// floor hatch with two hinged doors over a deep shaft that ends in a dark concrete cell
export class Hatch {
  constructor(w = 1.7, depth = 16) {
    const F = factoryMats();
    this.w = w; this.depth = depth;
    this.root = new THREE.Group();
    const B = new Batch();
    const fw = 0.12;
    for (const s of [-1, 1]) {
      B.box(w + fw * 2, 0.04, fw, F.hazard, 0, 0.02, s * (w / 2 + fw / 2));
      B.box(fw, 0.04, w, F.hazard, s * (w / 2 + fw / 2), 0.02, 0);
    }
    // shaft walls + ribs + lamps
    const sw = w + 0.04;
    const sd = depth - 3;   // the shaft opens into the cell's ceiling
    for (const [x, z, ry] of [[0, -sw / 2, 0], [0, sw / 2, Math.PI], [-sw / 2, 0, Math.PI / 2], [sw / 2, 0, -Math.PI / 2]]) {
      B.add(new THREE.PlaneGeometry(sw, sd), F.wall, M4(x, -sd / 2, z, 0, ry, 0));
    }
    for (let y = -1.2; y > -sd; y -= 1.6) {
      for (const s of [-1, 1]) { B.box(sw, 0.08, 0.06, F.beam, 0, y, s * (sw / 2 - 0.03)); B.box(0.06, 0.08, sw, F.beam, s * (sw / 2 - 0.03), y, 0); }
    }
    // the cell at the bottom
    const cw = 4.2, cy = -depth;
    B.box(cw, 0.1, cw, F.floor, 0, cy - 0.05, 0);
    B.box(cw, 3, 0.1, F.wall, 0, cy + 1.5, -cw / 2); B.box(cw, 3, 0.1, F.wall, 0, cy + 1.5, cw / 2);
    B.box(0.1, 3, cw, F.wall, -cw / 2, cy + 1.5, 0); B.box(0.1, 3, cw, F.wall, cw / 2, cy + 1.5, 0);
    const rw = (cw - sw) / 2;
    B.box(cw, 0.1, rw, F.beam, 0, cy + 3, -(sw + rw) / 2); B.box(cw, 0.1, rw, F.beam, 0, cy + 3, (sw + rw) / 2);
    B.box(rw, 0.1, sw, F.beam, -(sw + rw) / 2, cy + 3, 0); B.box(rw, 0.1, sw, F.beam, (sw + rw) / 2, cy + 3, 0);
    B.build(this.root);
    this.lamps = [];
    const lg = new THREE.BoxGeometry(0.06, 0.1, 0.03);
    for (let y = -2.0, i = 0; y > -sd + 0.5; y -= 3.2, i++) {
      const m = mesh(lg, F.lampRed, this.root, (i % 2 ? 1 : -1) * (sw / 2 - 0.02), y, 0, 0, Math.PI / 2, 0);
      m.castShadow = false; this.lamps.push(m);
    }
    this.bulb = mesh(new THREE.SphereGeometry(0.05, 10, 8), F.lampWarm, this.root, 0.6, cy + 2.6, 0.4);
    this.bulb.castShadow = false;
    // doors (hinged on the x edges, opening downward)
    this.doors = [];
    const dg = new THREE.BoxGeometry(w / 2 - 0.01, 0.05, w - 0.01);
    for (const s of [-1, 1]) {
      const piv = new THREE.Group(); piv.position.set(s * w / 2, 0.0, 0); this.root.add(piv);
      const d = mesh(dg, F.yellow, piv, -s * (w / 4), 0.025, 0);
      const st = mesh(new THREE.PlaneGeometry(w / 2 - 0.04, w - 0.06), F.hazard, piv, -s * (w / 4), 0.051, 0, -Math.PI / 2, 0, 0);
      st.castShadow = false;
      void d;
      this.doors.push({ piv, s, a: 0, v: 0 });
    }
    this.open = 0;
  }
  update(dt) {
    for (const d of this.doors) {
      const tgt = this.open * 1.62;
      d.v += ((tgt - d.a) * 70 - d.v * 9) * dt;
      d.a += d.v * dt;
      if (d.a < 0) { d.a = 0; d.v = Math.abs(d.v) * 0.2; }
      d.piv.rotation.z = d.s * d.a;
    }
  }
}

// ---- panel controls (all built facing +Z on a panel; `hit` meshes carry userData.ctl)
export class Knob {
  constructor(r = 0.045, color = 0x18181a) {
    const F = factoryMats();
    this.root = new THREE.Group();
    const skirt = mesh(cyl(r * 1.35, 0.008, 'z', 28), F.steel, this.root, 0, 0, 0.004);
    void skirt;
    this.cap = new THREE.Group(); this.root.add(this.cap);
    const capMat = color === 0x18181a ? F.knob : new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.2 });
    this.hit = mesh(cyl(r, r * 0.9, 'z', 20, r * 0.86), capMat, this.cap, 0, 0, r * 0.45 + 0.008);
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; mesh(new THREE.BoxGeometry(r * 0.12, r * 0.12, r * 0.8), capMat, this.cap, Math.cos(a) * r * 0.97, Math.sin(a) * r * 0.97, r * 0.45 + 0.008); }
    mesh(new THREE.BoxGeometry(r * 0.14, r * 0.7, 0.004), F.glowWhite, this.cap, 0, r * 0.45, r * 0.9 + 0.01).castShadow = false;
    this.v = 0; this.shown = 0; this.min = -2.35; this.max = 2.35;
  }
  set(v01) { this.v = clamp(v01, 0, 1); }
  update(dt) { this.shown += (this.v - this.shown) * (1 - Math.exp(-22 * dt)); this.cap.rotation.z = -(this.min + (this.max - this.min) * this.shown); }
}
export class Toggle {
  constructor() {
    const F = factoryMats();
    this.root = new THREE.Group();
    mesh(rbox(0.07, 0.11, 0.015, 0.006), F.steel, this.root, 0, 0, 0.0075);
    mesh(cyl(0.018, 0.02, 'z', 16), F.dark, this.root, 0, 0, 0.02);
    this.lever = new THREE.Group(); this.lever.position.set(0, 0, 0.03); this.root.add(this.lever);
    this.hit = mesh(cyl(0.0075, 0.075, 'y', 10, 0.005).translate(0, 0.0375, 0), F.chrome, this.lever);
    mesh(new THREE.SphereGeometry(0.011, 10, 8), F.chrome, this.lever, 0, 0.075, 0);
    // big invisible hit pad for fingers
    this.pad = mesh(new THREE.BoxGeometry(0.09, 0.14, 0.06), new THREE.MeshBasicMaterial({ visible: false }), this.root, 0, 0, 0.04);
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0x220a04 });
    mesh(new THREE.SphereGeometry(0.012, 10, 8), this.lampMat, this.root, 0, 0.075, 0.012).castShadow = false;
    this.on = false; this.a = 0.5; this.av = 0;
  }
  set(on) { this.on = !!on; }
  update(dt) {
    const tgt = this.on ? -0.55 : 0.55;
    this.av += ((tgt - this.a) * 900 - this.av * 30) * dt; this.a += this.av * dt;
    this.lever.rotation.x = this.a;
    this.lampMat.color.setRGB(this.on ? 0.4 : 0.15, this.on ? 3 : 0.04, this.on ? 0.6 : 0.02);
  }
}
export class Fader {
  constructor(len = 0.5) {
    const F = factoryMats();
    this.len = len;
    this.root = new THREE.Group();
    mesh(new THREE.BoxGeometry(len + 0.04, 0.03, 0.01), F.black, this.root, 0, 0, 0.005);
    for (let i = 0; i <= 10; i++) mesh(new THREE.BoxGeometry(0.003, i % 5 ? 0.012 : 0.022, 0.002), F.glowWhite, this.root, -len / 2 + (len * i) / 10, 0.032, 0.006).castShadow = false;
    this.cap = new THREE.Group(); this.root.add(this.cap);
    this.hit = mesh(rbox(0.045, 0.07, 0.04, 0.008), F.knob, this.cap, 0, 0, 0.025);
    mesh(new THREE.BoxGeometry(0.046, 0.006, 0.002), F.glowAmber, this.cap, 0, 0, 0.046).castShadow = false;
    this.track = mesh(new THREE.BoxGeometry(len + 0.08, 0.1, 0.05), new THREE.MeshBasicMaterial({ visible: false }), this.root, 0, 0, 0.03);
    this.v = 0; this.shown = 0;
  }
  set(v01) { this.v = clamp(v01, 0, 1); }
  update(dt) { this.shown += (this.v - this.shown) * (1 - Math.exp(-24 * dt)); this.cap.position.x = -this.len / 2 + this.len * this.shown; }
}
export class Selector {
  constructor(n = 3, r = 0.05) {
    const F = factoryMats();
    this.n = n;
    this.root = new THREE.Group();
    mesh(cyl(r * 1.5, 0.01, 'z', 28), F.dark, this.root, 0, 0, 0.005);
    this.cap = new THREE.Group(); this.root.add(this.cap);
    this.hit = mesh(new THREE.BoxGeometry(r * 0.55, r * 2.2, r * 0.7), F.redPaint, this.cap, 0, 0, r * 0.35 + 0.01);
    mesh(cyl(r * 0.7, r * 0.5, 'z', 20), F.redPaint, this.cap, 0, 0, r * 0.25 + 0.01);
    mesh(new THREE.BoxGeometry(r * 0.12, r * 0.9, 0.004), F.glowWhite, this.cap, 0, r * 0.55, r * 0.72 + 0.01).castShadow = false;
    this.i = 0; this.a = 0;
  }
  angle(i) { return this.n <= 1 ? 0 : -0.9 + (1.8 * i) / (this.n - 1); }
  set(i) { this.i = clamp(i | 0, 0, this.n - 1); }
  update(dt) { this.a += (this.angle(this.i) - this.a) * (1 - Math.exp(-26 * dt)); this.cap.rotation.z = -this.a; }
}

// open-top wooden crate with a separate lid (pop() flings it off)
export class Crate {
  constructor(w = 0.62, h = 0.46, d = 0.5) {
    const F = factoryMats();
    this.w = w; this.h = h; this.d = d;
    this.root = new THREE.Group();
    const B = new Batch(), t = 0.025;
    B.box(w, t, d, F.wood, 0, t / 2, 0);
    B.box(w, h, t, F.wood, 0, h / 2, d / 2 - t / 2); B.box(w, h, t, F.wood, 0, h / 2, -d / 2 + t / 2);
    B.box(t, h, d, F.wood, w / 2 - t / 2, h / 2, 0); B.box(t, h, d, F.wood, -w / 2 + t / 2, h / 2, 0);
    for (const y of [0.04, h - 0.04]) B.box(w + 0.012, 0.05, d + 0.012, F.wood, 0, y, 0);
    B.add(new THREE.PlaneGeometry(w - t * 2, d - t * 2), F.straw, M4(0, h * 0.55, 0, -Math.PI / 2));
    this.meshes = B.build(this.root);
    this.lid = new THREE.Group(); this.root.add(this.lid);
    const lb = new Batch();
    lb.box(w + 0.02, 0.03, d + 0.02, F.wood, 0, 0.015, 0);
    lb.box(0.06, 0.012, d * 1.1, F.wood, 0, 0.035, 0, 0, 0.9, 0);
    lb.build(this.lid);
    this.lid.position.y = h;
    this.lidV = null;
    this.label = null;
  }
  setLabel(tex) {
    if (!this.label) { this.label = mesh(new THREE.PlaneGeometry(this.w * 0.8, this.h * 0.45), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.9 }), this.root, 0, this.h * 0.5, this.d / 2 + 0.002); this.label.castShadow = false; }
    else { this.label.material.map = tex; this.label.material.needsUpdate = true; }
  }
  closeLid() { this.lidV = null; this.lid.position.set(0, this.h, 0); this.lid.rotation.set(0, 0, 0); this.opened = false; }
  pop(side = 1) {
    if (this.opened) return;
    this.opened = true;
    this.lidV = { v: new THREE.Vector3(side * 0.9, 2.6, -0.4), w: new THREE.Vector3(-1.5, 0.6, side * -4.2), floor: 0.016 - this.root.position.y };
  }
  update(dt) {
    const L = this.lidV;
    if (!L) return;
    L.v.y -= 9.8 * dt;
    this.lid.position.addScaledVector(L.v, dt);
    this.lid.rotation.x += L.w.x * dt; this.lid.rotation.y += L.w.y * dt; this.lid.rotation.z += L.w.z * dt;
    if (this.lid.position.y < L.floor) {
      this.lid.position.y = L.floor;
      if (L.v.y < -0.5) { L.v.y *= -0.25; L.v.x *= 0.5; L.v.z *= 0.5; L.w.multiplyScalar(0.3); this.onLand?.(); }
      else { L.v.set(0, 0, 0); L.w.set(0, 0, 0); this.lid.rotation.x = Math.round(this.lid.rotation.x / Math.PI) * Math.PI; this.lid.rotation.z = Math.round(this.lid.rotation.z / Math.PI) * Math.PI; this.lidV = null; }
    }
  }
}

// bolts, nuts, oil droplets and ripped-off parts with gravity and a floor
export class Junk {
  constructor(scene, max = 60) {
    const F = factoryMats();
    this.scene = scene;
    this.bolts = new THREE.InstancedMesh(cyl(0.012, 0.03, 'y', 6), F.steel, max);
    this.bolts.count = max; this.bolts.frustumCulled = false; this.bolts.castShadow = true;
    this.b = []; for (let i = 0; i < max; i++) { this.b.push({ p: new THREE.Vector3(0, -99, 0), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), life: 0, floor: 0 }); }
    this.bi = 0;
    scene.add(this.bolts);
    this.oilN = 160;
    this.op = new Float32Array(this.oilN * 3).fill(-99); this.ov = new Float32Array(this.oilN * 3); this.ol = new Float32Array(this.oilN); this.of = new Float32Array(this.oilN);
    const og = new THREE.BufferGeometry(); og.setAttribute('position', new THREE.BufferAttribute(this.op, 3).setUsage(THREE.DynamicDrawUsage));
    this.oil = new THREE.Points(og, new THREE.PointsMaterial({ color: 0x0c0906, size: 0.022, sizeAttenuation: true, transparent: true, opacity: 0.92, depthWrite: false }));
    this.oil.frustumCulled = false;
    scene.add(this.oil);
    this.oi = 0;
    this.chunks = [];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(1, 1, 1);
    this.onBounce = null;
  }
  burstBolts(p, dir, n = 6, floor = 0) {
    for (let k = 0; k < n; k++) {
      const b = this.b[this.bi]; this.bi = (this.bi + 1) % this.b.length;
      b.p.copy(p); b.v.set((Math.random() - 0.5) * 2.4, 1 + Math.random() * 2, (Math.random() - 0.5) * 2.4).addScaledVector(dir, 1.6);
      b.w.set(Math.random() * 20, Math.random() * 20, Math.random() * 20); b.life = 5 + Math.random() * 3; b.floor = floor + 0.012;
    }
  }
  spray(p, dir, n = 40, speed = 3, floor = 0) {
    for (let k = 0; k < n; k++) {
      const i = this.oi; this.oi = (this.oi + 1) % this.oilN;
      this.op[i * 3] = p.x; this.op[i * 3 + 1] = p.y; this.op[i * 3 + 2] = p.z;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.ov[i * 3] = dir.x * s + (Math.random() - 0.5) * 1.6; this.ov[i * 3 + 1] = dir.y * s + Math.random() * 1.2; this.ov[i * 3 + 2] = dir.z * s + (Math.random() - 0.5) * 1.6;
      this.ol[i] = 1.2 + Math.random(); this.of[i] = floor + 0.004;
    }
  }
  // obj is detached into the scene (world transform kept) and thrown
  fling(obj, v, w, floor = 0, life = 4) {
    obj.updateWorldMatrix(true, false);
    this.scene.attach(obj);
    this.chunks.push({ obj, v: v.clone(), w: w.clone(), floor, life, s0: obj.scale.clone(), r: 0.08 });
  }
  update(dt) {
    let bn = 0;
    for (let i = 0; i < this.b.length; i++) {
      const b = this.b[i];
      if (b.life <= 0) { this._m.makeScale(0, 0, 0); this.bolts.setMatrixAt(i, this._m); continue; }
      b.life -= dt; b.v.y -= 9.8 * dt; b.p.addScaledVector(b.v, dt);
      if (b.p.y < b.floor) { b.p.y = b.floor; if (b.v.y < -1) this.onBounce?.(b.p, 'bolt'); b.v.y *= -0.35; b.v.x *= 0.6; b.v.z *= 0.6; b.w.multiplyScalar(0.5); }
      b.r.x += b.w.x * dt; b.r.y += b.w.y * dt; b.r.z += b.w.z * dt;
      this._q.setFromEuler(b.r); this._s.setScalar(Math.min(1, b.life * 2));
      this._m.compose(b.p, this._q, this._s); this.bolts.setMatrixAt(i, this._m); bn++;
    }
    this.bolts.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.oilN; i++) {
      if (this.ol[i] <= 0) continue;
      this.ol[i] -= dt;
      const j = i * 3;
      if (this.op[j + 1] > this.of[i]) { this.ov[j + 1] -= 9.8 * dt; this.op[j] += this.ov[j] * dt; this.op[j + 1] += this.ov[j + 1] * dt; this.op[j + 2] += this.ov[j + 2] * dt; }
      else this.op[j + 1] = this.of[i];
      if (this.ol[i] <= 0) this.op[j + 1] = -99;
    }
    this.oil.geometry.attributes.position.needsUpdate = true;
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      c.life -= dt; c.v.y -= 9.8 * dt;
      c.obj.position.addScaledVector(c.v, dt);
      c.obj.rotation.x += c.w.x * dt; c.obj.rotation.y += c.w.y * dt; c.obj.rotation.z += c.w.z * dt;
      if (c.obj.position.y < c.floor + c.r) { c.obj.position.y = c.floor + c.r; if (c.v.y < -1.2) this.onBounce?.(c.obj.position, 'chunk'); c.v.y *= -0.3; c.v.x *= 0.55; c.v.z *= 0.55; c.w.multiplyScalar(0.45); }
      if (c.life < 0.5) c.obj.scale.copy(c.s0).multiplyScalar(Math.max(0.001, c.life * 2));
      if (c.life <= 0) { c.obj.removeFromParent(); this.chunks.splice(i, 1); }
    }
    void bn;
  }
}

// soft steam / dust puffs (sprites)
export class Puffs {
  constructor(scene, max = 40, color = 0xd8d8d0) {
    const M = wardrobeMats();
    this.items = [];
    for (let i = 0; i < max; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.glowTex, color, transparent: true, opacity: 0, depthWrite: false }));
      s.visible = false; scene.add(s); this.items.push({ s, v: new THREE.Vector3(), life: 0, max: 1, size: 0.3 });
    }
    this.i = 0;
  }
  puff(p, dir, n = 6, size = 0.35, speed = 0.8, life = 1.6, alpha = 0.22, color = 0xd8d8d0) {
    for (let k = 0; k < n; k++) {
      const it = this.items[this.i]; this.i = (this.i + 1) % this.items.length;
      it.s.material.color.set(color);
      it.s.position.copy(p); it.v.copy(dir).multiplyScalar(speed * (0.5 + Math.random())).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, Math.random() * 0.2, (Math.random() - 0.5) * 0.3));
      it.life = it.max = life * (0.7 + Math.random() * 0.6); it.size = size * (0.6 + Math.random() * 0.8); it.a = alpha;
      it.s.visible = true;
    }
  }
  update(dt) {
    for (const it of this.items) {
      if (it.life <= 0) { if (it.s.visible) it.s.visible = false; continue; }
      it.life -= dt;
      it.s.position.addScaledVector(it.v, dt); it.v.multiplyScalar(1 - 1.2 * dt); it.v.y += 0.25 * dt;
      const k = 1 - it.life / it.max;
      it.s.scale.setScalar(it.size * (0.5 + k * 1.6));
      it.s.material.opacity = it.a * Math.sin(Math.min(1, k * 1.2) * Math.PI) ;
    }
  }
}

// dust motes drifting inside a light cone (apex at top, pointing down)
export class Motes {
  constructor(n = 220, r = 1.2, h = 3.2) {
    const M = wardrobeMats();
    this.n = n; this.r = r; this.h = h;
    this.p = new Float32Array(n * 3); this.ph = new Float32Array(n);
    for (let i = 0; i < n; i++) { this._seed(i); this.p[i * 3 + 1] = Math.random() * h; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.PointsMaterial({ map: M.glowTex, color: 0xffe8c0, size: 0.018, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false;
    this.t = 0;
  }
  _seed(i) { const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * this.r; this.p[i * 3] = Math.cos(a) * rr; this.p[i * 3 + 2] = Math.sin(a) * rr; this.ph[i] = Math.random() * 10; }
  update(dt, level = 1) {
    this.t += dt;
    for (let i = 0; i < this.n; i++) {
      const j = i * 3, ph = this.ph[i];
      this.p[j] += Math.sin(this.t * 0.3 + ph) * 0.02 * dt; this.p[j + 2] += Math.cos(this.t * 0.27 + ph * 1.3) * 0.02 * dt;
      this.p[j + 1] -= (0.02 + 0.015 * Math.sin(ph)) * dt;
      if (this.p[j + 1] < 0) { this._seed(i); this.p[j + 1] = this.h; }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.mat.opacity = 0.55 * level;
  }
}
