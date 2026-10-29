// Level 0 camp-loop set pieces (see campmission.js):
//   CAMP_MARKERS / layout constants   camp-local frame (origin = camp centre on the floor, +Z = tent front)
//   CampKitBehaviour                  the TENT KIT crate prop: [E] opens it, the host spills the parts out
//   CampGhosts                        glowing ghost markers that show where each part goes (local visual)
//   CampTent (Device)                 the finished tent: pops up when the last part is attached, lamp lit
// (The old teleport pads + lever were replaced by the crusher: game/crusher.js.)
import * as THREE from 'three';
import { net } from '../net/net.js';
import { input } from '../core/input.js';
import { Device } from './devices.js';
import { buildModel } from '../entities/catalog.js';
import { buildDevice } from '../entities/models_devices.js';
import * as Mat from '../gfx/materials.js';
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
    const cord = Mat.get('fabric_red');
    const zf = TENT_Z + RIDGE_L / 2 + 0.1, zb = TENT_Z - RIDGE_L / 2 - 0.1;
    for (const [sx, z, dz] of [[-1, zf, 0.45], [1, zf, 0.45], [-1, zb, -0.45], [1, zb, -0.45]]) {
      const stake = [sx * (EAVE_X + 0.3), 0, z + dz];
      const peg = buildDevice('cg_stake').object; // modelled hardwood peg (src/entities/devices/camp.js)
      peg.position.set(stake[0], -0.08, stake[2]); peg.rotation.set(-Math.sign(dz) * 0.16, 0, sx * 0.16);
      this.root.add(peg);
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

export { itemName };
