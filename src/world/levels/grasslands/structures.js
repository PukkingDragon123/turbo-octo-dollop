// R.O.O.M. structures in the Grasslands: the three generator houses (a poured-concrete pump house, a fenced
// 90s relay station with a lattice mast, a corrugated tin shed), the workshop lean-to, the fuel depot, the
// office cubicle standing alone in the meadow, and the landing site under the hole in the sky.
// All built at level load (they are visible from far away); colliders are static boxes; devices and props
// follow the Yellow Rooms' mission-room contracts so the Mission finds everything where it expects it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as Synth from '../../../gfx/texsynth.js';
import { engine } from '../../../core/engine.js';
import { net } from '../../../net/net.js';
import { RNG, hash3 } from '../../../core/rng.js';
import { buildModel, modelHalfHeight } from '../../../entities/catalog.js';
import { makeDevice } from '../../../game/devicekinds.js';
import { CRATE_LOOT } from '../../../game/itemdefs.js';
import { CELL, PAD_Y, WATER_Y } from './layout.js';
import { texSize, noiseTexture } from './textures.js';
import { buildProxy } from './proxy.js';

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

// ---------------------------------------------------------------------------
// materials
let M = null;
function mats() {
  if (M) return M;
  // concrete gets the big maps (walked on, seen up close everywhere); sheet metal, timber and carpet are
  // 1024 only on high quality to keep the level's texture memory in budget
  const size = texSize(1024), small = texSize(512), mid = engine.qualityName === 'high' ? 1024 : small;
  const pm = (name, o, extra = {}) => Synth.pbrMaterial(name, { size, world: true, ...o, ...extra });
  M = {
    concrete: pm('concrete', { c0: 0xa29d93, c1: 0x7d786f, c2: 0x4c4741, c3: 0xbab3a6, p0: [60, 0.5, 0.6, 0.65], wear: 0.6, meters: 2.5 }),

    tin: pm('gl_corrugated', { wear: 0.55, size: mid }),
    tinRust: pm('gl_corrugated', { c0: 0x7d7268, c1: 0x5a5048, c2: 0x7a3a18, wear: 0.95, seed: 4, size: mid }),
    tinPaint: pm('gl_corrugated', { c0: 0x8a9488, c1: 0x5f6a60, c3: 0x4f6e58, p0: [10, 0.6, 0.85, 0], wear: 0.45, seed: 9, size: mid }),
    planks: pm('planks', { c0: 0x5c4a38, c1: 0x8c7356, c2: 0x2a2018, p0: [6, 0.01, 2, 0.8], wear: 0.6, meters: 2.4, size: mid }),
    wood: pm('wood', { c0: 0x4e3a28, c1: 0x7a6046, c2: 0x2a1c12, p0: [18, 1, 1, 0.8], wear: 0.6, meters: 1.5, size: mid }),
    steel: pm('paint_metal', { c0: 0x5b6a5f, c1: 0x8a8d90, c2: 0x6a3a1c, c3: 0x8a6a52, wear: 0.55, meters: 1, size: small }),
    yellow: pm('paint_metal', { c0: 0xc9a226, c1: 0x8a8d90, c2: 0x6a3a1c, c3: 0x8a6a52, wear: 0.5, meters: 1, size: small, seed: 5 }),
    galv: pm('metal', { c0: 0xa6aaad, c1: 0x7c8084, c2: 0x4a3a2a, p0: [0.6, 0.45, 0.3, 0], wear: 0.4, meters: 1, size: small }),
    beige: pm('plastic', { c0: 0xc9bea2, c1: 0xb3a684, c2: 0x5a5040, wear: 0.5, meters: 0.6, size: small }),
    fabric: pm('fabric', { c0: 0x5d6670, c1: 0x6c7580, c2: 0x8a929c, p0: [90, 90, 0, 0.6], meters: 0.4, size: small }),
    carpet: pm('carpet', { c0: 0x6a6450, c1: 0x58533f, c2: 0x3a3424, c3: 0x8a8264, p0: [200, 0.4, 0.6, 0.4], wear: 0.6, meters: 1, size: mid }),
    alu: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.35, metalness: 1 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9fb8b4, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.35, depthWrite: false }),
    dark: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.7 }),
    tube: new THREE.MeshStandardMaterial({ color: 0xeef2ff, emissive: 0xe8f0ff, emissiveIntensity: 0, roughness: 0.3 }),
    red: new THREE.MeshStandardMaterial({ color: 0x9a1e16, roughness: 0.55, metalness: 0.2 }),
  };
  // the poured slabs share the wall concrete's maps, a shade darker and dustier
  M.slab = M.concrete.clone();
  M.slab.color.multiplyScalar(0.86);
  M.slab.name = 'gl_slab';
  M.fence = fenceMaterial();
  return M;
}

function fenceMaterial() {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, S, S);
  c.strokeStyle = '#c2c6c8';
  c.lineWidth = 3;
  for (let k = -1; k <= 1; k++) {
    c.beginPath(); c.moveTo(k * S, 0); c.lineTo(k * S + S, S); c.stroke();
    c.beginPath(); c.moveTo(k * S + S, 0); c.lineTo(k * S, S); c.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.35, side: THREE.DoubleSide, metalness: 0.8, roughness: 0.45, color: 0xbfc4c6 });
}

function signTexture(lines, opts = {}) {
  const W = opts.w || 512, H = opts.h || 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.fillStyle = opts.bg || '#e9e4d6';
  c.fillRect(0, 0, W, H);
  if (opts.band) { c.fillStyle = opts.band; c.fillRect(0, 0, W, H * 0.28); }
  c.fillStyle = '#111';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  lines.forEach(([t, size, col, y], i) => {
    c.font = `bold ${size}px "IBM Plex Mono", monospace`;
    c.fillStyle = col || '#111';
    c.fillText(t, W / 2, y ?? (H * (0.2 + i * 0.25)));
  });
  // weathering
  const rng = new RNG(lines.length * 97 + W);
  for (let k = 0; k < 900; k++) {
    c.fillStyle = `rgba(${60 + rng.next() * 60},${50 + rng.next() * 40},${30},${rng.next() * 0.08})`;
    c.fillRect(rng.next() * W, rng.next() * H, 1 + rng.next() * 6, 1 + rng.next() * 6);
  }
  const g = c.createLinearGradient(0, H * 0.6, 0, H);
  g.addColorStop(0, 'rgba(90,60,30,0)'); g.addColorStop(1, 'rgba(90,60,30,0.35)');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, metalness: 0.1 });
}

// box with UVs in metres (so world-scaled textures tile correctly)
function mbox(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
  }
  return g;
}

// accumulates transformed geometry per material, merges at the end
class Kit {
  constructor(name) { this.name = name; this.parts = new Map(); this.boxes = []; this.group = new THREE.Group(); this.group.name = name; }
  add(mat, geo, x, y, z, ry = 0, rx = 0, rz = 0) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
    return g;
  }
  box(mat, w, h, d, x, y, z, ry = 0, collide = false) {
    this.add(mat, mbox(w, h, d), x, y, z, ry);
    if (collide) this.boxes.push({ x, y, z, hx: w / 2, hy: h / 2, hz: d / 2, ry });
  }
  cyl(mat, r0, r1, h, x, y, z, seg = 12, rx = 0, rz = 0, ry = 0) { this.add(mat, new THREE.CylinderGeometry(r0, r1, h, seg), x, y, z, ry, rx, rz); }
  done() {
    for (const [mat, list] of this.parts) {
      const g = mergeGeometries(list, false);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = !mat.transparent;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.name = `${this.name}`;
      this.group.add(mesh);
    }
    this.group.updateMatrixWorld(true);
    return this.group;
  }
}

// ---------------------------------------------------------------------------
export class Structures {
  constructor(level) {
    this.level = level;
    this.gw = level.gw;
    this.world = level.world;
    this.group = new THREE.Group();
    this.group.name = 'structures';
    this.colliders = [];
    this.lights = []; // fluorescent tubes that come on with their generator
    this.devices = [];
    this.vents = [];
    this.photo = [];
    this.interiors = []; // roofed spaces (interior light occlusion, see interior.js)
  }

  // the outer wall envelope of a roofed space; open: +1 when the +z (south) side is open
  _interior(s, roof, open, strength, gen = null) {
    this.interiors.push({
      cx: (s.x0 + s.x1) / 2, cz: (s.z0 + s.z1) / 2, hx: (s.x1 - s.x0) / 2, hz: (s.z1 - s.z0) / 2,
      y0: PAD_Y - 0.3, y1: roof, yaw: 0, open, soft: 0.85, strength, gen, on: 0, fill: new THREE.Color(0, 0, 0),
    });
  }

  build() {
    const m = mats();
    for (const s of this.gw.structures) {
      const fn = { gen_diesel: this._pumpHouse, gen_electric: this._relay, gen_mech: this._tinShed, workshop: this._workshop, fuel_store: this._fuelStore, fuse_office: this._cubicle, spawn: this._landing }[s.kind];
      if (fn) fn.call(this, s, m);
    }
  }

  _addColliders(kit) {
    const phys = this.world.physics;
    for (const b of kit.boxes) {
      this.colliders.push(phys.addStaticBox(b.x, b.y, b.z, b.hx, b.hy, b.hz, { kind: 'static', surface: 'concrete' }, b.ry));
    }
  }

  _finish(kit) {
    const g = kit.done();
    this.group.add(g);
    this._addColliders(kit);
    return g;
  }

  _slab(kit, s, m, pad = 0.45) {
    const w = s.x1 - s.x0 + pad * 2, d = s.z1 - s.z0 + pad * 2;
    kit.box(m.slab, w, 0.5, d, s.cx, PAD_Y - 0.25, s.cz, 0, true);
    // a skirt down into the meadow so the slab never floats
    kit.box(m.slab, w - 0.02, 0.6, d - 0.02, s.cx, PAD_Y - 0.75, s.cz);
  }

  _tubeLight(kit, x, y, z, ry = 0) {
    const m = mats();
    kit.box(m.galv, 1.3, 0.06, 0.16, x, y + 0.04, z, ry);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 8), m.tube.clone());
    tube.rotation.set(0, ry, Math.PI / 2);
    tube.position.set(x, y, z);
    this.group.add(tube);
    return tube;
  }

  // ---- generator A: poured-concrete pump house (open roll-up door to the south) ----
  _pumpHouse(s, m) {
    const kit = new Kit('pumphouse');
    this._slab(kit, s, m);
    const H = 2.75, T = 0.25;
    const { x0, x1, z0, z1, cx } = s;
    const W = x1 - x0;
    kit.box(m.concrete, W + T, H, T, cx, H / 2, z0 + T / 2, 0, true);                 // north
    kit.box(m.concrete, T, H, z1 - z0, x0 + T / 2, H / 2, (z0 + z1) / 2, 0, true);    // west
    kit.box(m.concrete, T, H, z1 - z0, x1 - T / 2, H / 2, (z0 + z1) / 2, 0, true);    // east
    kit.box(m.concrete, 0.7, H, T, x0 + 0.35, H / 2, z1 - T / 2, 0, true);           // south piers
    kit.box(m.concrete, 0.7, H, T, x1 - 0.35, H / 2, z1 - T / 2, 0, true);
    kit.box(m.concrete, W - 1.4, 0.42, T, cx, H - 0.21, z1 - T / 2, 0, true);         // lintel
    // roof: corrugated sheets on purlins, falling toward the door
    for (let k = 0; k < 4; k++) kit.box(m.wood, W + 0.6, 0.12, 0.09, cx, H + 0.06, z0 + 0.3 + k * (z1 - z0 - 0.6) / 3);
    for (let k = 0; k < 3; k++) kit.add(m.tinRust, mbox(W / 3 + 0.12, 0.03, z1 - z0 + 0.8), x0 + W / 6 + k * W / 3, H + 0.2, (z0 + z1) / 2, 0, 0.06, 0);
    // rolled-up door drum over the opening + guide rails
    kit.cyl(m.steel, 0.22, 0.22, W - 1.2, cx, H - 0.6, z1 - 0.45, 16, 0, Math.PI / 2);
    kit.box(m.steel, W - 1.25, 0.25, 0.04, cx, H - 0.95, z1 - 0.32);
    for (const sx of [-1, 1]) kit.box(m.galv, 0.06, H - 0.4, 0.08, cx + sx * (W / 2 - 0.72), (H - 0.4) / 2, z1 - 0.36);
    // pipework coming out of the floor along the west wall
    kit.cyl(m.steel, 0.09, 0.09, 2.2, x0 + 0.55, 1.1, z0 + 0.7, 14);
    kit.cyl(m.steel, 0.09, 0.09, 1.6, x0 + 1.3, 2.05, z0 + 0.7, 14, 0, Math.PI / 2);
    kit.cyl(m.red, 0.16, 0.16, 0.04, x0 + 0.75, 1.3, z0 + 0.7, 16, 0, Math.PI / 2);
    kit.cyl(m.galv, 0.11, 0.11, 0.18, x0 + 0.55, 0.05, z0 + 0.7, 14);
    // window (east wall)
    kit.box(m.steel, 0.06, 0.8, 1.1, x1 - 0.02, 1.7, (z0 + z1) / 2);
    kit.box(m.glass, 0.02, 0.7, 1.0, x1 - 0.05, 1.7, (z0 + z1) / 2);
    // vent grille + junction box outside
    kit.box(m.galv, 0.6, 0.4, 0.06, cx + 1.4, 2.2, z0 - 0.02);
    kit.box(m.steel, 0.45, 0.6, 0.22, x1 + 0.12, 1.3, z1 - 1.0);
    kit.cyl(m.galv, 0.025, 0.025, 1.0, x1 + 0.12, 0.5, z1 - 1.0, 8);
    // sign
    const sign = signTexture([['R.O.O.M.', 58, '#fff', 34], ['PUMP STATION 3', 40, '#111', 120], ['AUTHORIZED PERSONNEL', 26, '#333', 180], ['ONLY · DO NOT DRINK', 26, '#333', 215]], { band: '#b3221a' });
    kit.add(sign, new THREE.PlaneGeometry(1.2, 0.6), x0 + 1.0, 1.75, z1 + 0.01);
    const tube = this._tubeLight(kit, cx, H - 0.12, (z0 + z1) / 2, 0);
    this.lights.push({ gen: 'gen_diesel', mesh: tube });
    this._interior(s, H + 0.2, 1, 1, 'gen_diesel');
    this._finish(kit);
    this.photo.push({ pos: new THREE.Vector3(cx, 1.5, z1 + 0.5), subject: 'R.O.O.M. PUMP STATION', key: 'st:pump', value: 20 });
  }

  // ---- generator B: fenced 90s relay station with a lattice mast ----
  _relay(s, m) {
    const kit = new Kit('relay');
    this._slab(kit, s, m, 0.3);
    const { x0, x1, z0, z1, cx, cz } = s;
    const FH = 2.3;
    const post = (x, z) => { kit.cyl(m.galv, 0.04, 0.04, FH + 0.2, x, (FH + 0.2) / 2, z, 8); };
    const fenceSeg = (ax, az, bx, bz) => {
      const L = Math.hypot(bx - ax, bz - az), ry = Math.atan2(-(bz - az), bx - ax);
      const g = new THREE.PlaneGeometry(L, FH - 0.1);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L * 6, uv.getY(i) * (FH - 0.1) * 6);
      kit.add(m.fence, g, (ax + bx) / 2, FH / 2 + 0.02, (az + bz) / 2, ry);
      kit.add(m.galv, new THREE.CylinderGeometry(0.025, 0.025, L, 6), (ax + bx) / 2, FH, (az + bz) / 2, ry, 0, Math.PI / 2);
      this.colliders.push(this.world.physics.addStaticBox((ax + bx) / 2, FH / 2, (az + bz) / 2, L / 2, FH / 2, 0.05, { kind: 'static', surface: 'metal' }, ry));
    };
    const e = 0.12;
    // gate gap: the west cell's south edge (x0 .. x0+3)
    const pts = [[x0 + e, z1 - e], [x0 + e, z0 + e], [x1 - e, z0 + e], [x1 - e, z1 - e], [x0 + CELL + 0.1, z1 - e]];
    for (const [x, z] of pts) post(x, z);
    fenceSeg(pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
    fenceSeg(pts[1][0], pts[1][1], pts[2][0], pts[2][1]);
    fenceSeg(pts[2][0], pts[2][1], pts[3][0], pts[3][1]);
    fenceSeg(pts[3][0], pts[3][1], pts[4][0], pts[4][1]);
    // open gate leaf swung outward
    const gate = new THREE.PlaneGeometry(2.6, FH - 0.2);
    const guv = gate.attributes.uv;
    for (let i = 0; i < guv.count; i++) guv.setXY(i, guv.getX(i) * 15, guv.getY(i) * 13);
    kit.add(m.fence, gate, x0 + e - 0.05, FH / 2, z1 + 1.3, Math.PI / 2 - 0.25);
    // lattice mast in the NE corner
    const mx = x1 - 0.8, mz = z0 + 0.8, MH = 11;
    for (const [dx, dz] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]]) kit.add(m.galv, new THREE.CylinderGeometry(0.03, 0.035, MH, 6), mx + dx * 0.8, MH / 2, mz + dz * 0.8, 0, dz * 0.03, -dx * 0.03);
    for (let y = 0.6; y < MH - 0.5; y += 0.9) {
      const r = 0.29 - (y / MH) * 0.08;
      for (const [ax, az, bx, bz] of [[-r, -r, r, -r], [r, -r, r, r], [r, r, -r, r], [-r, r, -r, -r]]) {
        const L = Math.hypot(bx - ax, bz - az);
        kit.add(m.galv, new THREE.CylinderGeometry(0.012, 0.012, Math.hypot(L, 0.9), 4), mx + (ax + bx) / 2, y + 0.45, mz + (az + bz) / 2, Math.atan2(-(bz - az), bx - ax), 0, Math.PI / 2 - Math.atan2(0.9, L));
      }
    }
    kit.cyl(m.beige, 0.5, 0.5, 0.08, mx, MH - 1.4, mz + 0.35, 20, Math.PI / 2 - 0.2);
    kit.cyl(m.galv, 0.015, 0.015, 2.2, mx, MH + 1.0, mz, 6);
    for (const y of [MH - 2.5, MH - 3.6]) kit.box(m.beige, 0.12, 1.1, 0.16, mx - 0.3, y, mz - 0.3);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff2010, emissiveIntensity: 2 }));
    beacon.position.set(mx, MH + 2.15, mz);
    this.group.add(beacon);
    this.beacon = beacon;
    // 90s equipment cabinet
    kit.box(m.beige, 1.0, 1.6, 0.6, x0 + 0.8, 0.8, z0 + 0.5, 0, true);
    kit.box(m.dark, 0.8, 0.25, 0.02, x0 + 0.8, 1.3, z0 + 0.81);
    for (let k = 0; k < 6; k++) kit.box(m.dark, 0.7, 0.012, 0.02, x0 + 0.8, 0.45 + k * 0.08, z0 + 0.81);
    // cable tray to the mast
    kit.box(m.galv, 3.3, 0.06, 0.3, (x0 + 0.8 + mx) / 2, 2.0, z0 + 0.4);
    const sign = signTexture([['R.O.O.M.', 56, '#fff', 34], ['RELAY STATION 07', 38, '#111', 118], ['HIGH VOLTAGE · KEEP OUT', 26, '#7a1010', 178], ['UPLINK HARDWARE PROPERTY OF HQ', 20, '#333', 214]], { band: '#1f3a6a' });
    kit.add(sign, new THREE.PlaneGeometry(1.0, 0.5), x0 + 4.5, 1.4, z1 - e + 0.04);
    this._finish(kit);
    this.photo.push({ pos: new THREE.Vector3(mx, MH * 0.6, mz), subject: 'RELAY MAST', key: 'st:mast', value: 20 });
    this.relayMast = new THREE.Vector3(mx, MH, mz);
    void cz;
  }

  // ---- generator C: corrugated tin shed, open to the south ----
  _tinShed(s, m) {
    const kit = new Kit('tinshed');
    this._slab(kit, s, m);
    const { x0, x1, z0, z1, cx } = s;
    const W = x1 - x0, D = z1 - z0, H = 2.6;
    // timber frame
    for (const [x, z] of [[x0 + 0.1, z0 + 0.1], [x1 - 0.1, z0 + 0.1], [x0 + 0.1, z1 - 0.1], [x1 - 0.1, z1 - 0.1], [cx, z0 + 0.1]]) kit.box(m.wood, 0.14, H + 0.3, 0.14, x, (H + 0.3) / 2, z);
    kit.box(m.wood, W, 0.16, 0.14, cx, H + 0.2, z1 - 0.1);
    // walls (west, north, east) of corrugated sheet on rails
    kit.add(m.tinPaint, mbox(W, H, 0.04), cx, H / 2 + 0.05, z0 + 0.02);
    kit.add(m.tinPaint, mbox(0.04, H, D), x0 + 0.02, H / 2 + 0.05, (z0 + z1) / 2);
    kit.add(m.tinRust, mbox(0.04, H, D), x1 - 0.02, H / 2 + 0.05, (z0 + z1) / 2);
    kit.boxes.push({ x: cx, y: H / 2, z: z0 + 0.05, hx: W / 2, hy: H / 2, hz: 0.08, ry: 0 });
    kit.boxes.push({ x: x0 + 0.05, y: H / 2, z: (z0 + z1) / 2, hx: 0.08, hy: H / 2, hz: D / 2, ry: 0 });
    kit.boxes.push({ x: x1 - 0.05, y: H / 2, z: (z0 + z1) / 2, hx: 0.08, hy: H / 2, hz: D / 2, ry: 0 });
    // mono-pitch roof
    for (let k = 0; k < 3; k++) kit.add(m.tinRust, mbox(W / 3 + 0.1, 0.03, D + 0.9), x0 + W / 6 + k * W / 3, H + 0.38, (z0 + z1) / 2, 0, -0.09, 0);
    // shelving in the corners, oil drums, tyre
    for (const sx of [-1, 1]) {
      const x = cx + sx * (W / 2 - 0.45);
      for (const y of [0.5, 1.1, 1.7]) kit.box(m.wood, 0.7, 0.04, 0.45, x, y, z0 + 0.35, 0, false);
      kit.box(m.wood, 0.05, 1.9, 0.05, x - 0.33, 0.95, z0 + 0.15); kit.box(m.wood, 0.05, 1.9, 0.05, x + 0.33, 0.95, z0 + 0.15);
    }
    kit.cyl(m.red, 0.29, 0.29, 0.88, x1 - 0.5, 0.44, z1 - 0.9, 16);
    kit.cyl(m.steel, 0.29, 0.29, 0.88, x1 - 0.55, 0.44, z1 - 1.55, 16);
    const sign = signTexture([['R.O.O.M.', 56, '#fff', 34], ['MECHANICAL STORE C', 34, '#111', 118], ['WELD · TIGHTEN · CRANK', 24, '#333', 178], ['report missing tools to HQ', 18, '#555', 214]], { band: '#3a5a2a' });
    kit.add(sign, new THREE.PlaneGeometry(1.0, 0.5), x0 + 1.0, 1.9, z0 + 0.06);
    const tube = this._tubeLight(kit, cx, H - 0.1, (z0 + z1) / 2, 0);
    this.lights.push({ gen: 'gen_mech', mesh: tube });
    this._interior(s, H + 0.3, 1, 1, 'gen_mech');
    this._finish(kit);
  }

  // ---- workshop lean-to: plank walls, workbench, a culvert pipe the critters use ----
  _workshop(s, m) {
    const kit = new Kit('workshop');
    this._slab(kit, s, m, 0.3);
    const { x0, x1, z0, z1, cx } = s;
    const W = x1 - x0, D = z1 - z0, H = 2.5;
    kit.add(m.planks, mbox(W, H, 0.06), cx, H / 2, z0 + 0.03, 0);
    kit.add(m.planks, mbox(0.06, H, D), x0 + 0.03, H / 2, (z0 + z1) / 2, 0);
    kit.add(m.planks, mbox(0.06, H, D), x1 - 0.03, H / 2, (z0 + z1) / 2, 0);
    kit.boxes.push({ x: cx, y: H / 2, z: z0 + 0.05, hx: W / 2, hy: H / 2, hz: 0.08, ry: 0 });
    kit.boxes.push({ x: x0 + 0.05, y: H / 2, z: (z0 + z1) / 2, hx: 0.08, hy: H / 2, hz: D / 2, ry: 0 });
    kit.boxes.push({ x: x1 - 0.05, y: H / 2, z: (z0 + z1) / 2, hx: 0.08, hy: H / 2, hz: D / 2, ry: 0 });
    for (const x of [x0 + 0.1, x1 - 0.1]) kit.box(m.wood, 0.14, H + 0.3, 0.14, x, (H + 0.3) / 2, z1 - 0.1);
    for (let k = 0; k < 3; k++) kit.add(m.tin, mbox(W / 3 + 0.1, 0.03, D + 0.8), x0 + W / 6 + k * W / 3, H + 0.25, (z0 + z1) / 2, 0, -0.08, 0);
    // pegboard with tool silhouettes
    const peg = signTexture([['', 10, '#000', 0]], { bg: '#8a7a5a', w: 256, h: 128 });
    kit.add(peg, new THREE.PlaneGeometry(1.6, 0.8), cx + 1.6, 1.7, z0 + 0.07);
    // culvert pipe sticking out of the bank next to the shed (critter exit)
    const px = x1 + 1.1, pz = z0 + 1.0;
    const g = this.gw.groundAt(px, pz);
    kit.add(m.galv, new THREE.CylinderGeometry(0.32, 0.32, 1.4, 18, 1, true), px, g + 0.05, pz, 0, Math.PI / 2, 0);
    kit.add(m.dark, new THREE.CircleGeometry(0.3, 16), px, g + 0.05, pz + 0.66);
    this._interior(s, H + 0.2, 1, 0.75);
    this._finish(kit);
    this.vents.push({ pos: new THREE.Vector3(px, g + 0.02, pz + 0.95), inside: new THREE.Vector3(px, g + 0.05, pz + 0.2) });
    this._device('workbench', `wb:grass`, new THREE.Vector3(cx, PAD_Y, z0 + 0.55), 0);
  }

  // ---- fuel depot: open shelter, drums, the diesel can ----
  _fuelStore(s, m) {
    const kit = new Kit('fuelstore');
    const { x0, x1, z0, z1, cx, cz } = s;
    this._slab(kit, s, m, 0.2);
    const H = 2.2;
    for (const [x, z] of [[x0 + 0.08, z0 + 0.08], [x1 - 0.08, z0 + 0.08], [x0 + 0.08, z1 - 0.08], [x1 - 0.08, z1 - 0.08]]) {
      kit.box(m.yellow, 0.1, H, 0.1, x, H / 2, z, 0, true);
    }
    kit.add(m.tin, mbox(CELL + 0.6, 0.03, CELL + 0.6), cx, H + 0.05, cz, 0, 0.05, 0);
    kit.box(m.yellow, CELL, 0.08, 0.08, cx, H - 0.05, z0 + 0.08);
    kit.box(m.yellow, CELL, 0.08, 0.08, cx, H - 0.05, z1 - 0.08);
    const sign = signTexture([['DIESEL', 70, '#111', 70], ['FLAMMABLE · NO SMOKING', 30, '#b3221a', 150], ['R.O.O.M. FUEL DEPOT 2', 24, '#333', 205]], { bg: '#e8c23a' });
    kit.add(sign, new THREE.PlaneGeometry(0.9, 0.45), cx, 1.75, z0 + 0.14);
    kit.box(m.yellow, 0.9, 0.06, 0.04, cx, 1.47, z0 + 0.12);
    this._interior({ x0: cx - CELL / 2 - 0.3, x1: cx + CELL / 2 + 0.3, z0: cz - CELL / 2 - 0.3, z1: cz + CELL / 2 + 0.3 }, H + 0.05, 0, 0.45);
    this._finish(kit);
  }

  // ---- the office cubicle standing alone in the meadow ----
  _cubicle(s, m) {
    const kit = new Kit('cubicle');
    const { x0, x1, z0, z1, cx, cz } = s;
    const g = Math.max(this.gw.groundAt(cx, cz), PAD_Y);
    // carpet tile square laid on the grass
    kit.box(m.carpet, CELL - 0.1, 0.05, CELL - 0.1, cx, PAD_Y + 0.0, cz, 0, true);
    const PH = 1.55, T = 0.07;
    const panel = (x, z, w, ry) => {
      kit.box(m.fabric, w, PH - 0.05, T, x, (PH - 0.05) / 2 + 0.03, z, ry, true);
      kit.box(m.alu, w + 0.02, 0.035, T + 0.02, x, PH, z, ry);
    };
    panel(cx, z0 + 0.06, CELL - 0.12, 0);
    panel(x0 + 0.06, cz, CELL - 0.12, Math.PI / 2);
    panel(x1 - 0.06, cz, CELL - 0.12, Math.PI / 2);
    for (const [x, z] of [[x0 + 0.06, z0 + 0.06], [x1 - 0.06, z0 + 0.06], [x0 + 0.06, z1 - 0.06], [x1 - 0.06, z1 - 0.06]]) kit.box(m.alu, 0.08, PH + 0.02, 0.08, x, (PH + 0.02) / 2, z);
    const name = signTexture([['EMPLOYEE OF THE MONTH:', 22, '#222', 60], ['[VACANT]', 44, '#7a1010', 130], ['please return all fuses', 18, '#444', 200]], { bg: '#efeadf', w: 512, h: 256 });
    kit.add(name, new THREE.PlaneGeometry(0.45, 0.22), cx - 0.6, 1.15, z0 + 0.1);
    this._finish(kit);
    this._static('desk', cx, PAD_Y + 0.05, z0 + 0.65, Math.PI, true);
    this._device('lore_terminal', `term:grass_cubicle`, new THREE.Vector3(cx, PAD_Y + 0.81, z0 + 0.55), 0, { lore: hash3(this.level.seed, 3, 4, 5) % 100 });
    this._static('lamp_desk', cx + 0.55, PAD_Y + 0.81, z0 + 0.5, -0.4, false);
    void g;
  }

  // ---- landing site: scattered ceiling tiles, a fallen light fixture, the hole in the sky ----
  _landing(s, m) {
    const rng = new RNG(hash3(this.level.seed, 1, 2, 3));
    const sp = this.gw.spawn;
    const kit = new Kit('landing');
    // fallen ceiling tiles: placed as catalog models, then merged into one static mesh per material
    const tiles = new THREE.Group();
    for (let k = 0; k < 9; k++) {
      const a = rng.next() * Math.PI * 2, r = 1.5 + rng.next() * 4.5;
      const x = sp.x + Math.cos(a) * r, z = sp.z + Math.sin(a) * r;
      const y = this.gw.groundAt(x, z);
      const tile = buildModel('ceiling_tile', { seed: k + 3 });
      tile.object.position.set(x, y + 0.02, z);
      tile.object.rotation.set(rng.range(-0.2, 0.2), rng.next() * 6.28, rng.range(-0.25, 0.25));
      tiles.add(tile.object);
    }
    // fallen 2x4 troffer with a cracked tube, still flickering
    const fx = sp.x + 2.8, fz = sp.z - 1.6, fy = this.gw.groundAt(fx, fz);
    kit.box(m.galv, 1.22, 0.1, 0.62, fx, fy + 0.06, fz, 0.7);
    const tube = this._tubeLight(kit, fx + 0.02, fy + 0.13, fz, 0.7);
    this.flicker = tube;
    // the hole in the sky they fell through: a black ceiling-tile gap with a broken grid and dangling tiles
    const hy = sp.y || 0;
    const H = 58 + hy;
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide }));
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(sp.x, H, sp.z);
    hole.name = 'skyhole';
    this.group.add(hole);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      kit.box(m.alu, k % 2 ? 0.04 : 3.0, 0.05, k % 2 ? 3.0 : 0.04, sp.x + Math.cos(a) * 1.32, H - 0.02, sp.z + Math.sin(a) * 1.32);
    }
    for (let k = 0; k < 5; k++) {
      const a = rng.next() * Math.PI * 2;
      const t = buildModel('ceiling_tile', { seed: 40 + k });
      t.object.position.set(sp.x + Math.cos(a) * 1.5, H - 0.2 - rng.next() * 0.4, sp.z + Math.sin(a) * 1.5);
      t.object.rotation.set(0.6 + rng.next() * 0.6, a, rng.range(-0.3, 0.3));
      tiles.add(t.object);
    }
    tiles.updateMatrixWorld(true);
    const merged = buildProxy(tiles, { shadows: true });
    if (merged) { merged.name = 'landing_tiles'; this.group.add(merged); } else this.group.add(tiles);
    this._finish(kit);
    this.skyHole = hole;
    this.photo.push({ pos: new THREE.Vector3(sp.x, H, sp.z), subject: 'HOLE IN THE SKY', key: 'st:skyhole', value: 80, maxD: 80 });
  }

  // ---------------------------------------------------------------------------
  _static(type, x, y, z, ry, collide) {
    const mdl = buildModel(type, { seed: (x * 13 + z * 7) | 0 });
    const o = mdl.object;
    o.position.set(x, y + (mdl.halfHeight ?? 0), z);
    o.rotation.y = ry;
    this.group.add(o);
    this.level.prepStatic(o, null);
    if (collide && mdl.colliders?.length) {
      o.updateMatrixWorld(true);
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      o.matrixWorld.decompose(p, q, sc);
      const res = this.world.physics.addStaticCollidersFromDesc(mdl.colliders, p, q, { kind: 'static', surface: 'prop' });
      this.colliders.push(...res.colliders);
      (this.bodies = this.bodies || []).push(res.body);
    }
    return o;
  }

  _device(kind, id, pos, rotY, opts = {}) {
    let dev = this.world.devices.get(id);
    if (!dev) {
      dev = makeDevice(this.world, kind, id, opts);
      if (!dev) return null;
      dev.root.position.copy(pos);
      dev.root.rotation.y = rotY;
      dev.build?.();
      this.world.addDevice(dev);
      this.level.prepStatic(dev.root, null);
    }
    this.devices.push(dev);
    return dev;
  }

  // host: physics props for a structure (once, when its chunk is first loaded)
  populate(s, rng) {
    const sp = (type, x, y, z, rotY = 0, opts = {}) => {
      const hh = modelHalfHeight(type);
      _q.setFromEuler(_e.set(opts.rx || 0, rotY, opts.rz || 0));
      return this.world.props.spawn(type, new THREE.Vector3(x, y + hh + 0.02, z), _q, { sleep: opts.sleep !== false, state: opts.state });
    };
    const r = (a) => rng.range(-a, a);
    const { x0, x1, z0, z1, cx, cz } = s;
    switch (s.kind) {
      case 'fuel_store':
        sp('fuel_can', cx + 0.3, PAD_Y, cz + 0.3, rng.next() * 6, { state: { fuel: 1 } });
        sp('barrel', x0 + 0.55, PAD_Y, z0 + 0.6, 0);
        sp('barrel', x0 + 0.55, PAD_Y, z0 + 1.3, 1);
        sp('pallet', x1 - 0.8, PAD_Y, z0 + 0.9, 0.2);
        break;
      case 'fuse_office':
        sp('chair_office', cx + 0.2, PAD_Y + 0.05, z0 + 1.45, Math.PI + r(0.5));
        sp('fuse', cx - 0.35, PAD_Y + 0.83, z0 + 0.6, 0.4, { state: { mission: 1 } });
        sp('filing_cabinet', x1 - 0.45, PAD_Y + 0.05, z1 - 0.7, -Math.PI / 2);
        sp('mug', cx + 0.3, PAD_Y + 0.83, z0 + 0.7, 0);
        break;
      case 'workshop':
        for (const t of ['plank', 'plank', 'screws', 'metal_scrap', 'fabric_scrap', 'wire_spool']) sp(t, cx + r(1.2), PAD_Y, z0 + 1.6 + r(0.4), rng.next() * 6);
        sp('toolbox', x0 + 0.6, PAD_Y, z1 - 0.7, 0.3);
        sp('welder', cx + 0.4, PAD_Y + 0.95, z0 + 0.5, 0, { state: { fuel: 1 } });
        sp('sample_jar', cx - 0.5, PAD_Y + 0.95, z0 + 0.5, 0);
        sp('sample_jar', cx - 0.7, PAD_Y + 0.95, z0 + 0.45, 0);
        break;
      case 'gen_mech':
        sp('toolbox', x0 + 0.6, PAD_Y, z1 - 0.8, 0.5);
        sp(rng.pick(['almond_water', 'canned_food', 'battery']), x1 - 0.45, PAD_Y + 1.12, z0 + 0.35, 0);
        break;
      case 'gen_diesel':
        sp('bucket', x1 - 0.7, PAD_Y, z1 - 1.1, 0);
        sp(rng.weighted(CRATE_LOOT), x0 + 0.8, PAD_Y, z1 - 1.2, rng.next() * 6);
        break;
      case 'gen_electric':
        sp('traffic_cone', x0 + 1.5, PAD_Y, z1 + 1.0, 0);
        break;
      default: break;
    }
  }

  // fluorescent tubes light up with their generator; the fallen fixture flickers
  update(dt, t, mission) {
    for (const l of this.lights) {
      const g = mission?.generators.find((x) => x.id === l.gen);
      const on = g?.running ? 1 : 0;
      l.mesh.material.emissiveIntensity += ((on ? 2.2 : 0) - l.mesh.material.emissiveIntensity) * Math.min(1, dt * 6);
    }
    // the tube's light inside its shed (a cool fluorescent fill once the generator runs)
    for (const b of this.interiors) {
      if (!b.gen) continue;
      const g = mission?.generators.find((x) => x.id === b.gen);
      b.on += ((g?.running ? 1 : 0) - b.on) * Math.min(1, dt * 6);
      b.fill.setRGB(0.82, 0.9, 1.0).multiplyScalar(1.25 * b.on);
    }
    if (this.flicker) {
      const f = Math.sin(t * 13) + Math.sin(t * 31.7) > 1.3 ? 1.8 : 0.05;
      this.flicker.material.emissiveIntensity = f;
    }
    if (this.beacon) this.beacon.material.emissiveIntensity = Math.sin(t * 2.4) > 0.6 ? 4 : 0.2;
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    for (const c of this.colliders) this.world.physics.removeCollider(c);
    for (const b of this.bodies || []) this.world.physics.removeBody(b);
  }
}

export { WATER_Y, noiseTexture, engine, net };
export const slabMaterial = () => mats().slab;
