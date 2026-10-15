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
    const R = 2.7, H = 3.9;
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
    }, { repeat: [2, 1] });
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
      uniforms: { uI: { value: 0.12 }, uCol: { value: new THREE.Color(1.0, 0.92, 0.75) } },
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
    this.armB = mk(PI, 1.25, { L1: 1.2, L2: 1.1, color: 0xd8d2c0 });
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
