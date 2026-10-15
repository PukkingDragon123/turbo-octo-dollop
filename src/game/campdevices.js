// Level 0 camp-loop set pieces (see campmission.js):
//   CAMP_MARKERS / layout constants   camp-local frame (origin = camp centre on the floor, +Z = tent front)
//   CampKitBehaviour                  the TENT KIT crate prop: [E] opens it, the host spills the parts out
//   CampGhosts                        glowing ghost markers that show where each part goes (local visual)
//   CampTent (Device)                 the finished tent: pops up when the last part is attached, lamp lit
//   TelePad (Device)                  a teleport pad in the pad hall (furniture placed on it gets sold)
//   PadLever (Device)                 send lever + status board: pull it to teleport everything on the pads
import * as THREE from 'three';
import { net } from '../net/net.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { Device } from './devices.js';
import { ModelDevice } from './devicekinds.js';
import { buildModel } from '../entities/catalog.js';
import * as Mat from '../gfx/materials.js';
import { CrtScreen, text, bar } from '../ui/crt.js';
import { POLE_W, POLE_H, LAMP_H } from '../entities/models_camp.js';
import { itemName } from './itemdefs.js';

const PI = Math.PI;
const _v = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Camp layout (camp-local)
export const TENT_Z = -0.6;          // tent centre
export const RIDGE_L = 2.0;          // front pole at TENT_Z + RIDGE_L / 2, back pole at TENT_Z - RIDGE_L / 2
export const RIDGE_Y = POLE_H;       // ridge height
export const EAVE_X = POLE_W + 0.14; // canvas hem half-width
export const CAMP_MARKERS = [
  { key: 'pole_f', type: 'camp_pole', step: 0, label: 'TENT POLE', pos: [0, POLE_H / 2, TENT_Z + RIDGE_L / 2], yaw: 0 },
  { key: 'pole_b', type: 'camp_pole', step: 0, label: 'TENT POLE', pos: [0, POLE_H / 2, TENT_Z - RIDGE_L / 2], yaw: 0 },
  { key: 'canvas', type: 'camp_canvas', step: 1, label: 'CANVAS', pos: [0, RIDGE_Y + 0.15, TENT_Z], yaw: PI / 2 },
  { key: 'stakes', type: 'camp_stakes', step: 2, label: 'STAKES', pos: [0.62, 0.09, TENT_Z + RIDGE_L / 2 + 0.45], yaw: 0.3 },
  { key: 'lamp', type: 'camp_lamp', step: 2, label: 'CAMP LAMP', pos: [1.45, LAMP_H / 2, TENT_Z + 1.55], yaw: -PI / 2 },
];
export const CAMP_PARTS = ['camp_pole', 'camp_pole', 'camp_canvas', 'camp_stakes', 'camp_lamp'];
// where each part lands when the kit bursts open (same order as CAMP_PARTS)
export const PART_LANDING = [[-0.55, 2.2], [-1.75, 1.45], [0.45, 2.55], [2.25, 0.75], [-1.95, 2.45]];
export const KIT_POS = [1.75, 2.0];
export const REVIVE_SPOTS = [[0, 1.75], [-0.8, 1.9], [0.5, 2.9], [-1.4, 1.2]];
export const SNAP_DIST = 1.35;       // horizontal distance from a marker at which a part can be attached

// camp-local -> world
export function campToWorld(camp, x, y, z, out = new THREE.Vector3()) {
  const c = Math.cos(camp.yaw), s = Math.sin(camp.yaw);
  return out.set(camp.pos.x + x * c + z * s, camp.pos.y + y, camp.pos.z - x * s + z * c);
}

// ---------------------------------------------------------------------------
// The tent canvas: two sagging slopes, a closed back gable and front flaps tied open
function tentCanvasGeometry(sag = 0.05) {
  const pos = [], uv = [], idx = [];
  const H = RIDGE_Y + 0.03, EX = EAVE_X, EY = 0.05;
  const z0 = TENT_Z - RIDGE_L / 2 - 0.1, z1 = TENT_Z + RIDGE_L / 2 + 0.1;
  const nu = 6, nv = 10;
  for (const side of [-1, 1]) {
    const base = pos.length / 3;
    for (let j = 0; j <= nv; j++) {
      const v = j / nv, z = z0 + (z1 - z0) * v;
      for (let i = 0; i <= nu; i++) {
        const u = i / nu;
        const s = Math.sin(PI * u) * Math.sin(PI * v) * sag;
        // ridge -> eave, sag pulls the cloth inward / down
        pos.push(side * (EX * u - s * 0.4), H + (EY - H) * u - s, z);
        uv.push(u * 2, v * 3);
      }
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      if (side > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  const tri = (p0, p1, p2, u0 = [0, 0], u1 = [1, 0], u2 = [0.5, 1]) => {
    const b = pos.length / 3;
    pos.push(...p0, ...p1, ...p2);
    uv.push(...u0, ...u1, ...u2);
    idx.push(b, b + 1, b + 2);
  };
  // back gable (closed)
  tri([-EX + 0.08, EY, z0 + 0.02], [EX - 0.08, EY, z0 + 0.02], [0, H - 0.02, z0 + 0.02]);
  // front flaps, tied back to the sides
  for (const sx of [-1, 1]) tri([0, H - 0.02, z1], [sx * (EX - 0.06), EY, z1], [sx * (EX + 0.12), EY + 0.25, z1 - 0.32]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function rod(a, b, r, mat, seg = 8) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, A.distanceTo(B), seg), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}

let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}

function labelSprite(str, color = '#bff4ff') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 34px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.fillStyle = color;
  ctx.fillText(str, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.9 }));
  sp.scale.set(0.62, 0.155, 1);
  return sp;
}

// ---------------------------------------------------------------------------
// TENT KIT crate (prop behaviour)
export class CampKitBehaviour {
  constructor(prop, mission) {
    this.prop = prop;
    this.mission = mission;
    this.anim = prop.state.open ? 1 : 0;
  }
  prompt() {
    if (this.prop.state.open) return null;
    return `[${input.keyName('interact')}] Open the TENT KIT`;
  }
  interact() { net.toHost('act', { k: 'p', id: this.prop.id, a: 'open' }); }
  hostAction(a) { if (a === 'open') this.mission.hostOpenKit(this.prop); }
  onState() {}
  update(dt) {
    const target = this.prop.state.open ? 1 : 0;
    this.anim += (target - this.anim) * Math.min(1, dt * 5);
    const lid = this.prop.model.parts.lid;
    if (lid) lid.rotation.x = -this.anim * 1.95;
  }
}

// ---------------------------------------------------------------------------
// Ghost markers: a translucent copy of each part at its slot, a floor ring and a floating label.
// Only the current step's markers show; they turn green when the matching part is close enough to attach.
export class CampGhosts {
  constructor(world, camp) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'camp:ghosts';
    world.group.add(this.group);
    this.items = [];
    this.t = 0;
    for (const m of CAMP_MARKERS) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x66d8ff, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      mat.userData.noProbe = true;
      const root = new THREE.Group();
      let shape;
      if (m.type === 'camp_canvas') {
        // the canvas shows the finished tent's silhouette (the bundle itself snaps onto the ridge)
        shape = new THREE.Mesh(tentCanvasGeometry(0.02), mat);
        shape.position.set(-m.pos[0], -m.pos[1], -m.pos[2]); // the geometry is built in camp space
        shape.rotation.y = 0;
        const holder = new THREE.Group();
        holder.add(shape);
        holder.rotation.y = -m.yaw; // undo the marker yaw (applied to root below)
        root.add(holder);
      } else {
        shape = buildModel(m.type, { seed: 1 }).object;
        shape.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = false; o.receiveShadow = false; o.userData.noProbe = true; } });
        root.add(shape);
      }
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x66d8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40), ringMat);
      ring.rotation.x = -PI / 2;
      const label = labelSprite(m.label);
      const wp = campToWorld(camp, m.pos[0], m.pos[1], m.pos[2]);
      root.position.copy(wp);
      root.rotation.y = camp.yaw + m.yaw;
      ring.position.set(wp.x, camp.pos.y + 0.025, wp.z);
      label.position.set(wp.x, camp.pos.y + Math.min(2.35, Math.max(m.pos[1] + 0.95, 0.75)), wp.z);
      this.group.add(root, ring, label);
      this.items.push({ m, root, ring, label, mat, ringMat, near: false });
    }
    this.group.visible = false;
  }

  // filled: Set of marker keys; step: current build step; near: Set of marker keys with a part in reach
  update(dt, filled, step, near, show) {
    this.t += dt;
    this.group.visible = show;
    if (!show) return;
    for (const it of this.items) {
      const vis = !filled.has(it.m.key) && it.m.step === step;
      it.root.visible = it.ring.visible = it.label.visible = vis;
      if (!vis) continue;
      const isNear = near.has(it.m.key);
      const col = isNear ? 0x7dffa0 : 0x66d8ff;
      it.mat.color.setHex(col);
      it.ringMat.color.setHex(col);
      const pulse = 0.5 + 0.5 * Math.sin(this.t * (isNear ? 9 : 3));
      it.mat.opacity = (isNear ? 0.38 : 0.2) + pulse * 0.12;
      it.ringMat.opacity = 0.35 + pulse * 0.4;
      const s = 1 + pulse * (isNear ? 0.18 : 0.08);
      it.ring.scale.set(s, s, 1);
      it.label.material.opacity = 0.65 + pulse * 0.35;
    }
  }

  // a marker got filled: quick bright flash
  flash(key) {
    const it = this.items.find((x) => x.m.key === key);
    if (!it) return;
    this.world.fx.glow(it.root.position, [0.6, 1.6, 0.8], 0.9, 0.25);
  }

  dispose() { this.group.removeFromParent(); }
}

// ---------------------------------------------------------------------------
// The finished tent (static device). pop() plays the pop-up animation.
export class CampTent extends Device {
  constructor(world, camp) {
    super(world, 'camp_tent', {});
    this.camp = camp;
    this.root.position.copy(camp.pos);
    this.root.rotation.y = camp.yaw;
    this.shape = new THREE.Group(); // everything that springs up
    this.root.add(this.shape);
    const cloth = Mat.get('fabric_green').clone();
    cloth.side = THREE.DoubleSide;
    const canvas = new THREE.Mesh(tentCanvasGeometry(0.06), cloth);
    canvas.castShadow = true;
    this.shape.add(canvas);
    // groundsheet + dark interior floor
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(EAVE_X * 2 + 0.1, RIDGE_L + 0.3), Mat.get('fabric_grey'));
    sheet.rotation.x = -PI / 2;
    sheet.position.set(0, 0.012, TENT_Z);
    this.root.add(sheet);
    // frame: A-frames front & back, ridge pole
    for (const m of CAMP_MARKERS.filter((x) => x.type === 'camp_pole')) {
      const p = buildModel('camp_pole', { seed: 1 }).object;
      p.position.set(m.pos[0], m.pos[1], m.pos[2]);
      this.shape.add(p);
    }
    this.shape.add(rod([0, RIDGE_Y - 0.02, TENT_Z - RIDGE_L / 2 - 0.05], [0, RIDGE_Y - 0.02, TENT_Z + RIDGE_L / 2 + 0.05], 0.02, Mat.get('metal_green')));
    // stakes + guy lines at the four corners
    const wood = Mat.get('wood_light'), cord = Mat.get('fabric_red');
    const zf = TENT_Z + RIDGE_L / 2 + 0.1, zb = TENT_Z - RIDGE_L / 2 - 0.1;
    for (const [sx, z, dz] of [[-1, zf, 0.45], [1, zf, 0.45], [-1, zb, -0.45], [1, zb, -0.45]]) {
      const stake = [sx * (EAVE_X + 0.3), 0, z + dz];
      this.root.add(rod([stake[0], -0.05, stake[2]], [stake[0] - sx * 0.04, 0.2, stake[2] - Math.sign(dz) * 0.04], 0.018, wood, 6));
      this.shape.add(rod([0, RIDGE_Y - 0.02, z], [stake[0], 0.17, stake[2]], 0.005, cord, 4));
    }
    // camp lamp (lit) + a soft glow
    const lm = CAMP_MARKERS.find((x) => x.key === 'lamp');
    const lamp = buildModel('camp_lamp', { seed: 1 });
    lamp.object.position.set(...lm.pos);
    lamp.object.rotation.y = lm.yaw;
    lamp.object.userData.setLit?.(true);
    this.root.add(lamp.object);
    this.lamp = lamp;
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffb35a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.0 }));
    this.glow.scale.setScalar(0.9);
    this.root.add(this.glow);
    this.root.updateMatrixWorld(true);
    lamp.parts.mantle?.getWorldPosition(_v);
    this.glow.position.copy(this.root.worldToLocal(_v.clone()));
    // colliders: two thin canvas slopes, the back gable and the lamp post
    const th = Math.atan2(RIDGE_Y - 0.05, EAVE_X), sl = Math.hypot(RIDGE_Y - 0.05, EAVE_X);
    this.addColliders([
      { type: 'box', size: [sl, 0.04, RIDGE_L + 0.15], pos: [EAVE_X / 2, (RIDGE_Y + 0.05) / 2, TENT_Z], rot: [0, 0, -th] },
      { type: 'box', size: [sl, 0.04, RIDGE_L + 0.15], pos: [-EAVE_X / 2, (RIDGE_Y + 0.05) / 2, TENT_Z], rot: [0, 0, th] },
      { type: 'box', size: [1.2, 0.8, 0.04], pos: [0, 0.4, zb + 0.02] },
      { type: 'box', size: [0.08, LAMP_H, 0.08], pos: [lm.pos[0], lm.pos[1], lm.pos[2]] },
    ]);
    this.popT = 1; // 0..1 animation progress (1 = settled)
    this.lit = 1;
    this.time = 0;
  }

  pop() {
    this.popT = 0;
    this.lit = 0;
  }

  prompt() { return 'FIELD CAMP — new clones are printed here'; }

  update(dt) {
    this.time += dt;
    if (this.popT < 1) {
      this.popT = Math.min(1, this.popT + dt / 1.1);
      const t = this.popT;
      // spring: shoots up past full height, wobbles, settles
      const y = t < 0.25 ? 0.03 + (t / 0.25) * 1.15 : 1 + 0.18 * Math.exp(-(t - 0.25) * 7) * Math.cos((t - 0.25) * 26);
      const xz = 1 + (1 - y) * 0.35;
      this.shape.scale.set(xz, Math.max(0.03, y), xz);
      if (t > 0.45) this.lit = Math.min(1, this.lit + dt * 2.5);
    } else {
      this.shape.scale.set(1, 1, 1);
    }
    // lantern flicker
    const fl = this.lit * (0.85 + 0.1 * Math.sin(this.time * 13) + 0.05 * Math.sin(this.time * 31));
    this.lamp.object.userData.setLit?.(this.lit > 0.3);
    this.glow.material.opacity = 0.55 * fl;
    this.glow.scale.setScalar(0.8 + 0.08 * Math.sin(this.time * 9));
  }
}

// ---------------------------------------------------------------------------
// Teleport pad
export const PAD_R = 0.6;
let _padTex = null;
function padTexture() {
  if (_padTex) return _padTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2b2f33';
  ctx.fillRect(0, 0, 256, 256);
  // hazard ring
  ctx.save();
  ctx.translate(128, 128);
  for (let i = 0; i < 24; i++) {
    ctx.rotate((PI * 2) / 24);
    ctx.fillStyle = i % 2 ? '#e8b417' : '#141414';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 128, 0, (PI * 2) / 24);
    ctx.fill();
  }
  ctx.fillStyle = '#34393e';
  ctx.beginPath(); ctx.arc(0, 0, 104, 0, PI * 2); ctx.fill();
  // emitter grid
  ctx.strokeStyle = 'rgba(160,220,240,0.35)';
  ctx.lineWidth = 2;
  for (let r = 24; r < 100; r += 18) { ctx.beginPath(); ctx.arc(0, 0, r, 0, PI * 2); ctx.stroke(); }
  for (let i = 0; i < 12; i++) { ctx.rotate(PI / 6); ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(100, 0); ctx.stroke(); }
  ctx.fillStyle = '#d8d0bc';
  ctx.font = 'bold 20px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('R.O.O.M.', 0, -42);
  ctx.font = '13px "IBM Plex Mono", monospace';
  ctx.fillText('ASSET RECOVERY PAD', 0, 52);
  ctx.restore();
  _padTex = new THREE.CanvasTexture(c);
  _padTex.colorSpace = THREE.SRGBColorSpace;
  _padTex.anisotropy = 4;
  return _padTex;
}

let _beamTex = null;
function beamTexture() {
  if (_beamTex) return _beamTex;
  const c = document.createElement('canvas');
  c.width = 8; c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 128);
  _beamTex = new THREE.CanvasTexture(c);
  return _beamTex;
}

export class TelePad extends Device {
  constructor(world, id, mission, x, y, z) {
    super(world, id, {});
    this.mission = mission;
    this.root.position.set(x, y, z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(PAD_R, PAD_R + 0.04, 0.07, 40), Mat.get('metal_dark'));
    base.position.y = 0.035;
    const top = new THREE.Mesh(new THREE.CircleGeometry(PAD_R - 0.01, 48), new THREE.MeshStandardMaterial({ map: padTexture(), roughness: 0.6, metalness: 0.4 }));
    top.rotation.x = -PI / 2;
    top.position.y = 0.0715;
    this.ringMat = new THREE.MeshStandardMaterial({ color: 0x0a2a33, emissive: 0x4fe0ff, emissiveIntensity: 0.3, roughness: 0.3 });
    this.ringMat.userData.noProbe = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(PAD_R - 0.075, 0.016, 8, 48), this.ringMat);
    ring.rotation.x = -PI / 2;
    ring.position.y = 0.074;
    ring.userData.noProbe = true;
    this.beamMat = new THREE.MeshBasicMaterial({ map: beamTexture(), color: 0x7fe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(PAD_R - 0.06, PAD_R - 0.04, 2.6, 32, 1, true), this.beamMat);
    this.beam.position.y = 1.35;
    this.beam.visible = false;
    this.beam.userData.noProbe = true;
    this.root.add(base, top, ring, this.beam);
    this.root.updateMatrixWorld(true);
    this.addColliders([{ type: 'cylinder', radius: PAD_R + 0.02, height: 0.07, pos: [0, 0.035, 0] }]);
    this.t = Math.random() * 10;
    this.loaded = 0; // $ currently on this pad (refreshed by the mission)
  }

  contains(p) {
    const dx = p.x - this.root.position.x, dz = p.z - this.root.position.z;
    return dx * dx + dz * dz < (PAD_R + 0.12) ** 2 && p.y > this.root.position.y - 0.3 && p.y < this.root.position.y + 2.4;
  }

  prompt() {
    const m = this.mission;
    if (!m.padsOnline) return 'Teleport pad — OFFLINE';
    return this.loaded > 0 ? `Teleport pad — $${this.loaded} loaded. Pull the lever to send.` : 'Teleport pad — drag furniture onto it';
  }

  update(dt) {
    this.t += dt;
    const m = this.mission;
    const ch = m.padCharge; // 0..1 while charging, -1 idle
    let e;
    if (!m.padsOnline) e = 0.15;
    else if (ch >= 0) e = 1.5 + ch * 7;
    else e = (this.loaded > 0 ? 2.2 : 1.0) + Math.sin(this.t * (this.loaded > 0 ? 6 : 2)) * 0.5;
    this.ringMat.emissiveIntensity = e;
    this.ringMat.emissive.setHex(this.loaded > 0 && ch < 0 ? 0x7dffb0 : 0x4fe0ff);
    this.beam.visible = ch >= 0;
    if (ch >= 0) {
      this.beamMat.opacity = Math.min(1, ch * 1.3) * (0.55 + 0.25 * Math.sin(this.t * 40));
      this.beam.scale.set(1 - ch * 0.25, 0.2 + ch * 0.8, 1 - ch * 0.25);
      this.beam.position.y = 0.07 + 1.3 * (0.2 + ch * 0.8);
      if (Math.random() < dt * 30 * ch) {
        const a = Math.random() * PI * 2, r = Math.random() * PAD_R * 0.9;
        this.world.fx.sparks(_v.set(this.root.position.x + Math.cos(a) * r, this.root.position.y + 0.1, this.root.position.z + Math.sin(a) * r), 1, new THREE.Vector3(0, 1, 0), [0.4, 0.9, 1], 3);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Send lever + status board
export class PadLever extends ModelDevice {
  constructor(world, mission, x, y, z, yaw) {
    super(world, 'pad_lever', 'dispatch_lever', {});
    this.mission = mission;
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    // status board on a post beside the lever
    const frame = Mat.get('metal_dark');
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.4, 0.07), frame);
    post.position.set(-0.62, 0.7, -0.05);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.58, 0.08), frame);
    box.position.set(-0.62, 1.55, -0.05);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.5), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    scr.position.set(-0.62, 1.55, -0.008);
    this.root.add(post, box, scr);
    this.board = new CrtScreen(512, 328, 'cyan');
    this.board.fps = 6;
    this.board.attach(scr, 1.6);
    this.scr = this.screen('main', 256, 192, 'cyan', 1.5);
    this.scr.fps = 4;
    this.root.updateMatrixWorld(true);
    this.addColliders([...(this.model.colliders || []), { type: 'box', size: [0.1, 1.4, 0.1], pos: [-0.62, 0.7, -0.05] }, { type: 'box', size: [0.86, 0.58, 0.1], pos: [-0.62, 1.55, -0.05] }]);
    this.anim = 0;
  }

  prompt() {
    const m = this.mission;
    const k = input.keyName('interact');
    if (!m.padsOnline) return 'Teleport pads — OFFLINE. Build your camp first.';
    if (m.padCharge >= 0) return 'TELEPORTING...';
    const c = m.padContents;
    if (!c.count) return 'Teleport pads are empty — drag furniture onto them';
    return `[${k}] PULL LEVER — send ${c.count} item${c.count === 1 ? '' : 's'} ($${c.total})`;
  }

  interact() {
    if (!this.mission.padsOnline || this.mission.padCharge >= 0) { audio.play('ui_error', { volume: 0.4, bus: 'ui' }); return; }
    this.send('pull');
  }

  hostAction(a, d, from) { if (a === 'pull') this.mission.hostPullLever(from); }

  update(dt) {
    const m = this.mission;
    const charging = m.padCharge >= 0;
    this.anim += ((charging ? 1 : 0) - this.anim) * Math.min(1, dt * 8);
    if (this.parts.handle) this.parts.handle.rotation.x = -0.6 + this.anim * 1.2;
    for (const l of this.parts.lamps || []) {
      if (!l.material) continue;
      if (!l.userData.own) { l.material = l.material.clone(); l.userData.own = true; }
      const armed = l.name === 'lamp_armed';
      l.material.emissiveIntensity = armed ? (charging && Math.floor(this.world.time * 6) % 2 ? 4 : 0.1) : (m.padsOnline && !charging ? 2.5 : 0.1);
    }
    if (!this.nearLocal(16)) return;
    const c = m.padContents;
    const need = m.quota.need, cr = this.world.game.run.credits;
    this.board.draw(dt, (ctx, w, h, pal, t) => {
      text(ctx, 'ASSET RECOVERY — TELEPORT PADS', 16, 10, 28, pal.hi);
      if (!m.padsOnline) {
        text(ctx, 'OFFLINE', w / 2, 110, 72, Math.floor(t * 2) % 2 ? pal.bad : pal.dim, 'center');
        text(ctx, 'BUILD YOUR CAMP FIRST', w / 2, 200, 30, pal.fg, 'center');
        return;
      }
      if (charging) {
        text(ctx, 'TELEPORTING', w / 2, 70, 60, Math.floor(t * 6) % 2 ? pal.hi : pal.fg, 'center');
        bar(ctx, 40, 160, w - 80, 34, m.padCharge, pal.fg, pal.dim);
      } else {
        text(ctx, `ON PADS: $${c.total}`, 16, 52, 46, c.total ? pal.good : pal.dim);
        const names = c.names.slice(0, 3).join(', ') + (c.names.length > 3 ? ` +${c.names.length - 3}` : '');
        text(ctx, c.count ? names : 'drag furniture onto the pads', 16, 108, 24, pal.fg);
        text(ctx, c.count ? 'PULL THE LEVER TO SEND' : '', 16, 140, 26, Math.floor(t * 2) % 2 ? pal.hi : pal.fg);
      }
      text(ctx, `QUOTA  $${cr} / $${need}`, 16, 214, 32, cr >= need ? pal.good : pal.fg);
      bar(ctx, 16, 256, w - 32, 26, Math.min(1, cr / Math.max(1, need)), cr >= need ? pal.good : pal.fg, pal.dim);
      if (m.lastSale) text(ctx, `LAST UPLOAD +$${m.lastSale}`, 16, 292, 22, pal.dim);
    });
    this.scr.draw(dt, (ctx, w, h, pal, t) => {
      text(ctx, 'SEND', 10, 6, 32, pal.hi);
      text(ctx, m.padsOnline ? `$${c.total}` : 'OFF', 10, 56, 54, c.total ? pal.good : pal.dim);
      text(ctx, charging ? 'CHARGING' : c.count ? 'PULL LEVER' : 'PADS EMPTY', 10, 130, 26, Math.floor(t * 2) % 2 ? pal.fg : pal.dim);
    });
  }
}

export { itemName };
