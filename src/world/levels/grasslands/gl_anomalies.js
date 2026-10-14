// The Grasslands are subtly wrong: things from an office that should not be in a mountain valley.
// A lone door frame in a meadow (it loops you back from day 2), office light poles that hum to life at
// dusk, power lines that run into the ground, a ringing phone booth, an office chair sinking into the
// riverbank, a line of identical boulders, a piece of Yellow Rooms wall, a vending machine and a TV in the
// grass, the remains of an earlier clone, a damp square of office carpet. One per chunk at most
// (placement is part of the deterministic layout), built when the chunk streams in.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as Synth from '../../../gfx/texsynth.js';
import { engine } from '../../../core/engine.js';
import { net } from '../../../net/net.js';
import { input } from '../../../core/input.js';
import { audio } from '../../../audio/audio.js';
import { RNG, hash3, hash01 } from '../../../core/rng.js';
import { buildModel, modelHalfHeight } from '../../../entities/catalog.js';
import { makeDevice } from '../../../game/devicekinds.js';
import { Device } from '../../../game/devices.js';
import { RAPIER, GROUPS } from '../../../physics/physics.js';
import { CELL, WATER_Y } from './layout.js';
import { texSize } from './textures.js';

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();

let M = null;
function mats() {
  if (M) return M;
  const size = texSize(512);
  const pm = (name, o) => Synth.pbrMaterial(name, { size, world: true, ...o });
  M = {
    paint: pm('plastic', { c0: 0xe4ded0, c1: 0xcfc6b0, c2: 0x6a6050, p0: [0.55, 0.3, 0, 0], wear: 0.6, meters: 0.8 }),
    door: pm('wood', { c0: 0x6a4a2c, c1: 0x9a7650, c2: 0x3a2616, p0: [16, 0.6, 0.6, 0.45], wear: 0.4, meters: 1.2 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc9a65a, roughness: 0.32, metalness: 1 }),
    galv: pm('metal', { c0: 0xa9adb0, c1: 0x7f8387, c2: 0x5a4a3a, p0: [0.7, 0.42, 0.4, 0], wear: 0.5, meters: 1 }),
    pole: pm('wood', { c0: 0x4a3a2a, c1: 0x6a5a48, c2: 0x2a2018, p0: [10, 1, 1, 0.9], wear: 0.8, meters: 2 }),
    wire: new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.6, metalness: 0.4 }),
    glassIns: new THREE.MeshStandardMaterial({ color: 0x3a6a5a, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.85 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xaac4c0, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28, depthWrite: false }),
    alu: new THREE.MeshStandardMaterial({ color: 0xb4b8bc, roughness: 0.4, metalness: 1 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0e0e0e, roughness: 0.55 }),
    wallpaper: pm('wallpaper', { meters: 1.2, wear: 0.5 }),
    base: new THREE.MeshStandardMaterial({ color: 0x8d7a52, roughness: 0.6 }),
    carpet: pm('carpet', { c0: 0x8a7a4a, c1: 0x6d5f36, c2: 0x3a3020, c3: 0xa79b6a, p0: [180, 0.5, 0.7, 0.8], wear: 0.6, meters: 1 }),
    panel: new THREE.MeshStandardMaterial({ color: 0xfff6e4, emissive: 0xfff2d6, emissiveIntensity: 0, roughness: 0.4 }),
  };
  return M;
}

function signMat(lines, bg = '#1a2a4a', fg = '#e8e4d8', w = 512, h = 128) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  c.fillStyle = bg; c.fillRect(0, 0, w, h);
  c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle';
  lines.forEach(([t, sz, y]) => { c.font = `bold ${sz}px "IBM Plex Mono", monospace`; c.fillText(t, w / 2, y); });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.05 });
}

class Kit {
  constructor() { this.parts = new Map(); }
  add(mat, geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
  }
  box(mat, w, h, d, x, y, z, ry = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); }
    this.add(mat, g, x, y, z, 0, ry, 0);
  }
  build(group, name) {
    const out = new THREE.Group();
    out.name = name;
    for (const [mat, list] of this.parts) {
      const g = mergeGeometries(list, false);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.castShadow = !mat.transparent;
      m.receiveShadow = true;
      m.name = name;
      out.add(m);
    }
    group.add(out);
    return out;
  }
}

// a payphone that rings in an empty valley
class PhoneBooth extends Device {
  constructor(world, id, level, pos) {
    super(world, id, {});
    this.level = level;
    this.ringPos = pos.clone();
    this.ringT = 20 + Math.random() * 40;
    this.ringing = 0;
    this.loop = null;
  }
  prompt() { return this.ringing > 0 ? `[${input.keyName('interact')}] Answer the phone` : 'Payphone — the line is dead. It is warm.'; }
  interact() {
    if (this.ringing <= 0) { audio.play('ui_error', { volume: 0.3 }); return; }
    this.ringing = 0;
    this.loop?.stop(0.05); this.loop = null;
    audio.play('radio_static_burst', { pos: this.ringPos, volume: 0.8 });
    const lines = [
      'You have reached the R.O.O.M. Grasslands field office. Please stay on the trail.',
      '…is the river still flowing the right way? Don\'t answer. Just look.',
      'We counted the trees. There are more of them than yesterday.',
      'HQ here. We did not call you. Hang up. Hang up now.',
      'Your clone number has been reassigned. Please return to the meadow.',
    ];
    const g = this.level.game;
    g.ui.feed(lines[(g.day.day + Math.floor(Math.random() * lines.length)) % lines.length], 'hq', '???');
    g.local.survival.sanity = Math.max(0, g.local.survival.sanity - 4);
  }
  update(dt) {
    const g = this.level.game;
    const d = this.ringPos.distanceTo(g.local.pos);
    if (this.ringing > 0) {
      this.ringing -= dt;
      if (!this.loop && d < 45) this.loop = audio.loop('phone_ring_loop', { pos: this.ringPos.clone(), volume: 0.9 });
      if (this.ringing <= 0 || d > 60) { this.loop?.stop(0.1); this.loop = null; if (d > 60) this.ringing = 0; }
    } else if (d < 40) {
      this.ringT -= dt * (0.5 + g.day.instability() * 2);
      if (this.ringT <= 0) { this.ringT = 35 + Math.random() * 60; this.ringing = 9; }
    }
  }
  dispose() { this.loop?.stop(0.05); super.dispose(); }
}

// ---------------------------------------------------------------------------
export class GrassAnomalies {
  constructor(level) {
    this.level = level;
    this.gw = level.gw;
    this.world = level.world;
    this.poles = [];     // lit light-pole fixtures {pos, panel, rec}
    this.doors = [];     // {pos, n (normal), rec}
    this.lights = [];
    for (let k = 0; k < 2; k++) {
      const l = new THREE.PointLight(0xfff0d6, 0, 16, 1.6);
      l.castShadow = false;
      this.lights.push(l);
      level.world.group.add(l);
    }
    this.loopT = 0;
    this.doorLoops = 0;
    this.doorCool = 0;
  }

  _col(rec, desc, x, y, z, ry = 0) {
    desc.setTranslation(x, y, z).setCollisionGroups(GROUPS.static);
    if (ry) { _q.setFromEuler(_e.set(0, ry, 0)); desc.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }); }
    const c = this.world.physics.world.createCollider(desc);
    this.world.physics.setUserData(c, { kind: 'static', surface: 'prop' });
    rec.physicsColliders.push(c);
  }

  _photo(rec, pos, subject, key, value, maxD = 18) {
    const a = { pos, subject, key, value, maxD, rec };
    (this.level.anomalyList = this.level.anomalyList || []).push(a);
    (rec.photos = rec.photos || []).push(a);
  }

  // critter exits: burrows in the meadow and crevices under boulders next to the cliffs
  _burrows(rec) {
    const C = this.gw.chunkCells(rec.cx, rec.cz, rec.variant);
    const seed = this.level.seed;
    let n = 0;
    for (const c of C.cells) {
      if (n >= 2) break;
      if (!c || c.blocked || c.water || c.special || c.zone === 'path') continue;
      if (hash01(c.i, c.j, 4401, seed) > 0.035) continue;
      const x = c.x + (hash01(c.i, c.j, 4402, seed) - 0.5) * 1.2, z = c.z + (hash01(c.i, c.j, 4403, seed) - 0.5) * 1.2;
      const y = this.level.groundAt(x, z);
      const o = new THREE.Group();
      const mound = new THREE.Mesh(this._moundGeo || (this._moundGeo = new THREE.LatheGeometry([new THREE.Vector2(0.09, -0.05), new THREE.Vector2(0.1, 0.02), new THREE.Vector2(0.16, 0.06), new THREE.Vector2(0.26, 0.03), new THREE.Vector2(0.36, -0.02)], 14)), this._soilMat());
      mound.geometry.userData.shared = true;
      mound.userData.sharedGeo = true;
      const hole = new THREE.Mesh(this._holeGeo || (this._holeGeo = new THREE.CircleGeometry(0.095, 12)), mats().black);
      hole.geometry.userData.shared = true;
      hole.userData.sharedGeo = true;
      hole.rotation.x = -Math.PI / 2;
      hole.position.y = 0.0;
      o.add(mound, hole);
      o.position.set(x, y, z);
      o.rotation.y = hash01(c.i, c.j, 4404, seed) * 6.28;
      mound.receiveShadow = true;
      rec.group.add(o);
      this.level.prepStatic(o, rec);
      this.level.critters?.addVent(new THREE.Vector3(x + 0.25, y, z), o, new THREE.Vector3(x, y - 0.12, z));
      n++;
    }
    // rock crevices: boulders near the cliffs hide a dark gap at their base
    const sc = this.gw.scatter(rec.cx, rec.cz, rec.variant);
    let k = 0;
    for (const r of sc.rocks) {
      if (r.type !== 'boulder' || r.r < 0.55 || k >= 2) continue;
      const y = this.level.groundAt(r.x, r.z);
      const o = new THREE.Object3D();
      o.position.set(r.x, y, r.z);
      rec.group.add(o);
      (rec.statics = rec.statics || []).push(o);
      const out = new THREE.Vector3(r.x + r.r * 1.15, y, r.z);
      this.level.critters?.addVent(out, o, new THREE.Vector3(r.x + r.r * 0.6, y - 0.05, r.z));
      k++;
    }
  }

  _soilMat() {
    if (!this._soil) this._soil = Synth.pbrMaterial('soil', { size: texSize(512), world: true, c0: 0x5a4632, c1: 0x3a2c1e, meters: 0.6 });
    return this._soil;
  }

  // build the chunk's anomaly (every peer); host also spawns its props
  build(rec) {
    this._burrows(rec);
    const C = this.gw.chunkCells(rec.cx, rec.cz, rec.variant);
    const a = C.anomaly;
    if (!a) return;
    const m = mats();
    const g = (x, z) => this.level.groundAt(x, z);
    const rng = new RNG(hash3(rec.cx, rec.cz, 77, this.level.seed));
    const fn = this['_' + a.kind];
    if (fn) fn.call(this, rec, a, m, g, rng);
  }

  unload(rec) {
    for (const d of rec.roomDevices || []) this.level.unregisterProxy?.(d);
    if (rec.photos) this.level.anomalyList = (this.level.anomalyList || []).filter((p) => p.rec !== rec);
    this.poles = this.poles.filter((p) => p.rec !== rec);
    this.doors = this.doors.filter((d) => d.rec !== rec);
  }

  // ---- lone office door in a frame ----
  _door(rec, a, m, g) {
    const kit = new Kit();
    const y = g(a.x, a.z) - 0.05;
    const W = 0.92, Hd = 2.06, T = 0.1, D = 0.14;
    kit.box(m.paint, T, Hd + T, D, -W / 2 - T / 2, (Hd + T) / 2, 0);
    kit.box(m.paint, T, Hd + T, D, W / 2 + T / 2, (Hd + T) / 2, 0);
    kit.box(m.paint, W + T * 2, T, D, 0, Hd + T / 2, 0);
    // casing trim
    for (const s of [-1, 1]) {
      kit.box(m.paint, 0.07, Hd + 0.17, 0.02, s * (W / 2 + T + 0.03), (Hd + 0.17) / 2, D / 2 + 0.01);
      kit.box(m.paint, 0.07, Hd + 0.17, 0.02, s * (W / 2 + T + 0.03), (Hd + 0.17) / 2, -D / 2 - 0.01);
    }
    const grp = kit.build(rec.group, 'anomaly door');
    // the leaf, ajar
    const leafK = new Kit();
    leafK.box(m.door, W - 0.02, Hd - 0.02, 0.042, (W - 0.02) / 2, (Hd - 0.02) / 2, 0);
    leafK.add(m.brass, new THREE.SphereGeometry(0.03, 12, 8), W - 0.1, 1.0, 0.05);
    leafK.add(m.brass, new THREE.SphereGeometry(0.03, 12, 8), W - 0.1, 1.0, -0.05);
    leafK.add(m.brass, new THREE.CylinderGeometry(0.035, 0.035, 0.012, 14), W - 0.1, 1.0, 0.024, Math.PI / 2);
    const leaf = leafK.build(grp, 'anomaly door leaf');
    leaf.position.set(-W / 2, 0.01, 0);
    leaf.rotation.y = -1.35;
    grp.position.set(a.x, y, a.z);
    grp.rotation.y = a.rot;
    grp.updateMatrixWorld(true);
    // colliders: jambs + open leaf
    const ry = a.rot;
    const loc = (lx, lz) => _v.set(lx, 0, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry).add(new THREE.Vector3(a.x, 0, a.z));
    for (const s of [-1, 1]) { const p = loc(s * (W / 2 + T / 2), 0); this._col(rec, RAPIER.ColliderDesc.cuboid(T / 2, (Hd + T) / 2, D / 2), p.x, y + (Hd + T) / 2, p.z, ry); }
    const lp = loc(-W / 2 + Math.cos(1.35) * W / 2, Math.sin(1.35) * W / 2);
    this._col(rec, RAPIER.ColliderDesc.cuboid(W / 2, Hd / 2, 0.025), lp.x, y + Hd / 2, lp.z, ry - 1.35);
    this.doors.push({ pos: new THREE.Vector3(a.x, y, a.z), n: new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)), t: new THREE.Vector3(Math.cos(ry), 0, -Math.sin(ry)), rec, side: 0 });
    this._photo(rec, new THREE.Vector3(a.x, y + 1.1, a.z), 'DOOR TO NOWHERE', `an:door:${rec.cx},${rec.cz}`, 55);
  }

  // ---- office light fixtures on poles, standing in a row in the grass ----
  _poles(rec, a, m, g, rng) {
    const n = 4;
    const ax = Math.abs(Math.sin(a.rot)) > 0.5;
    for (let k = 0; k < n; k++) {
      const i = a.i + (ax ? k - 1 : 0), j = a.j + (ax ? 0 : k - 1);
      const x = i * CELL + 0.05, z = j * CELL + 0.05;
      if (this.gw.cornerItem(i, j, rec.variant)) continue;
      const cell = this.level.cell(x + 1, z + 1);
      if (!cell) continue;
      const y = g(x, z) - 0.1;
      const kit = new Kit();
      const H = 4.4 + rng.next() * 0.3;
      kit.add(m.galv, new THREE.CylinderGeometry(0.055, 0.075, H, 12), 0, H / 2, 0);
      kit.add(m.galv, new THREE.CylinderGeometry(0.16, 0.16, 0.03, 14), 0, 0.12, 0);
      kit.box(m.galv, 0.14, 0.24, 0.1, 0, 1.1, 0.07);
      kit.add(m.galv, new THREE.CylinderGeometry(0.03, 0.03, 0.9, 8), 0.42, H - 0.08, 0, 0, 0, Math.PI / 2 - 0.15);
      kit.box(m.galv, 1.25, 0.09, 0.64, 0.95, H - 0.22, 0);
      kit.box(m.galv, 1.27, 0.02, 0.66, 0.95, H - 0.17, 0);
      const grp = kit.build(rec.group, 'anomaly pole');
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.015, 0.55), m.panel.clone());
      panel.position.set(0.95, H - 0.272, 0);
      grp.add(panel);
      grp.position.set(x, y, z);
      grp.rotation.y = a.rot + (rng.next() - 0.5) * 0.08;
      grp.updateMatrixWorld(true);
      this._col(rec, RAPIER.ColliderDesc.cylinder(H / 2, 0.08), x, y + H / 2, z);
      const lp = new THREE.Vector3(0.95, H - 0.4, 0).applyMatrix4(grp.matrixWorld);
      this.poles.push({ pos: lp, panel, rec, seed: rng.next() * 100 });
    }
    this._photo(rec, new THREE.Vector3(a.x, 3.5, a.z), 'FLUORESCENT LIGHTS IN A MEADOW', `an:poles:${rec.cx},${rec.cz}`, 40, 26);
  }

  // ---- utility poles, wires sagging off toward nothing and into the ground ----
  _powerline(rec, a, m, g, rng) {
    const dir = new THREE.Vector3(Math.sin(a.rot), 0, Math.cos(a.rot));
    const p0 = new THREE.Vector3(Math.round(a.x / CELL) * CELL, 0, Math.round(a.z / CELL) * CELL);
    const pts = [p0.clone().addScaledVector(dir, -9), p0.clone().addScaledVector(dir, 9)];
    const tops = [];
    for (const p of pts) {
      if (!this.level.cell(p.x + 0.5, p.z + 0.5)) return;
      const y = g(p.x, p.z) - 0.2;
      const kit = new Kit();
      const H = 8.5;
      kit.add(m.pole, new THREE.CylinderGeometry(0.12, 0.16, H, 12), 0, H / 2, 0, (rng.next() - 0.5) * 0.04, 0, (rng.next() - 0.5) * 0.04);
      kit.box(m.pole, 2.2, 0.12, 0.12, 0, H - 0.6, 0);
      const ins = [];
      for (const s of [-0.95, 0, 0.95]) {
        kit.add(m.glassIns, new THREE.CylinderGeometry(0.05, 0.07, 0.16, 10), s, H - 0.46, 0);
        ins.push(s);
      }
      kit.add(m.galv, new THREE.CylinderGeometry(0.22, 0.22, 0.7, 14), 0, H - 1.6, 0.25);
      const grp = kit.build(rec.group, 'anomaly powerpole');
      grp.position.set(p.x, y, p.z);
      grp.rotation.y = a.rot + Math.PI / 2;
      grp.updateMatrixWorld(true);
      this._col(rec, RAPIER.ColliderDesc.cylinder(H / 2, 0.16), p.x, y + H / 2, p.z);
      tops.push(ins.map((s) => new THREE.Vector3(s, H - 0.38, 0).applyMatrix4(grp.matrixWorld)));
    }
    // wires: pole to pole, then from the second pole down into the meadow
    const kit = new Kit();
    const wire = (A, B, sag) => {
      const mid = A.clone().lerp(B, 0.5); mid.y -= sag;
      const curve = new THREE.QuadraticBezierCurve3(A, mid, B);
      kit.add(m.wire, new THREE.TubeGeometry(curve, 16, 0.012, 4), 0, 0, 0);
    };
    for (let k = 0; k < 3; k++) {
      wire(tops[0][k], tops[1][k], 0.9);
      const end = tops[1][k].clone().addScaledVector(dir, 7 + k * 0.6);
      end.y = g(end.x, end.z) - 0.3;
      wire(tops[1][k], end, 0.4);
    }
    kit.build(rec.group, 'anomaly wires');
    this._photo(rec, tops[1][1].clone(), 'POWER LINES TO NOWHERE', `an:wire:${rec.cx},${rec.cz}`, 35, 30);
  }

  // ---- phone booth ----
  _phone(rec, a, m, g) {
    const kit = new Kit();
    const y = g(a.x, a.z) - 0.03;
    const S = 0.95, H = 2.25;
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) kit.box(m.alu, 0.06, H, 0.06, px * S / 2, H / 2, pz * S / 2);
    kit.box(m.alu, S + 0.08, 0.14, S + 0.08, 0, H + 0.07, 0);
    kit.box(m.galv, S, 0.04, S, 0, 0.02, 0);
    kit.box(m.glass, 0.01, H - 0.4, S - 0.06, -S / 2, H / 2 + 0.05, 0);
    kit.box(m.glass, 0.01, H - 0.4, S - 0.06, S / 2, H / 2 + 0.05, 0);
    kit.box(m.galv, S - 0.06, H - 0.3, 0.03, 0, H / 2, -S / 2);
    // payphone
    kit.box(m.alu, 0.32, 0.55, 0.14, 0, 1.35, -S / 2 + 0.09);
    kit.box(m.black, 0.07, 0.22, 0.06, -0.1, 1.42, -S / 2 + 0.19);
    kit.box(m.black, 0.12, 0.16, 0.012, 0.06, 1.3, -S / 2 + 0.165);
    const sign = signMat([['TELEPHONE', 64, 64]]);
    kit.add(sign, new THREE.PlaneGeometry(S, 0.13), 0, H + 0.07, S / 2 + 0.045);
    kit.add(sign, new THREE.PlaneGeometry(S, 0.13), 0, H + 0.07, -S / 2 - 0.045, 0, Math.PI, 0);
    const grp = kit.build(rec.group, 'anomaly phone');
    grp.position.set(a.x, y, a.z);
    grp.rotation.y = a.rot;
    grp.updateMatrixWorld(true);
    this._col(rec, RAPIER.ColliderDesc.cuboid(S / 2 + 0.04, H / 2, 0.04), ...new THREE.Vector3(0, 0, -S / 2).applyAxisAngle(new THREE.Vector3(0, 1, 0), a.rot).add(new THREE.Vector3(a.x, y + H / 2, a.z)).toArray(), a.rot);
    for (const s of [-1, 1]) this._col(rec, RAPIER.ColliderDesc.cuboid(0.04, H / 2, S / 2), ...new THREE.Vector3(s * S / 2, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), a.rot).add(new THREE.Vector3(a.x, y + H / 2, a.z)).toArray(), a.rot);
    const id = `phone:${rec.cx},${rec.cz}`;
    let dev = this.world.devices.get(id);
    if (!dev) {
      dev = new PhoneBooth(this.world, id, this.level, new THREE.Vector3(a.x, y + 1.35, a.z));
      dev.root.position.set(a.x, y, a.z);
      dev.root.rotation.y = a.rot;
      this.world.addDevice(dev);
      dev.root.updateMatrixWorld(true);
      dev.addBox(new THREE.Vector3(0, 0, -S / 2 + 0.12).applyAxisAngle(new THREE.Vector3(0, 1, 0), a.rot).add(new THREE.Vector3(a.x, y + 1.35, a.z)), new THREE.Vector3(0.2, 0.3, 0.12));
    }
    (rec.roomDevices = rec.roomDevices || []).push(dev);
    dev.root.visible = true;
    this._photo(rec, new THREE.Vector3(a.x, y + 1.2, a.z), 'PHONE BOOTH IN THE WILDERNESS', `an:phone:${rec.cx},${rec.cz}`, 45);
  }

  // ---- office chair half sunk into the riverbank ----
  _chair(rec, a, m, g, rng) {
    const mdl = buildModel('chair_office', { seed: rec.cx * 7 + rec.cz });
    const o = mdl.object;
    const y = g(a.x, a.z);
    o.position.set(a.x, y + (mdl.halfHeight ?? 0.45) - 0.42, a.z);
    o.rotation.set(0.32, rng.next() * 6.28, -0.18);
    rec.group.add(o);
    this.level.prepStatic(o, rec);
    this._photo(rec, new THREE.Vector3(a.x, y + 0.2, a.z), 'OFFICE CHAIR SINKING INTO THE RIVERBANK', `an:chair:${rec.cx},${rec.cz}`, 50);
  }

  // ---- identical boulders in a perfect line ----
  _rocks(rec, a, m, g) {
    const rs = this.level.rocks;
    if (!rs) return;
    const geo = rs.boulders[0][0];
    const n = 5;
    const ax = Math.abs(Math.sin(a.rot)) > 0.5;
    const mesh = new THREE.InstancedMesh(geo, rs.mat, n);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.name = 'anomaly rocks';
    let k = 0;
    const mtx = new THREE.Matrix4();
    for (let s = 0; s < n; s++) {
      const i = a.i + (ax ? s - 2 : 0), j = a.j + (ax ? 0 : s - 2);
      const x = i * CELL, z = j * CELL;
      if (!this.level.cell(x + 1, z + 1) || !this.level.cell(x - 1, z - 1)) continue;
      const y = g(x, z) - 0.15;
      mtx.compose(new THREE.Vector3(x, y, z), _q.setFromEuler(_e.set(0, 0.6, 0)), new THREE.Vector3(0.62, 0.55, 0.62));
      mesh.setMatrixAt(k++, mtx);
      const pts = rs.hulls[0];
      const arr = new Float32Array(pts.length);
      for (let q = 0; q < pts.length; q += 3) { _v.set(pts[q], pts[q + 1], pts[q + 2]).applyMatrix4(mtx); arr[q] = _v.x - x; arr[q + 1] = _v.y - y; arr[q + 2] = _v.z - z; }
      const d = RAPIER.ColliderDesc.convexHull(arr);
      if (d) this._col(rec, d, x, y, z);
    }
    mesh.count = k;
    mesh.computeBoundingSphere();
    rec.group.add(mesh);
    this._photo(rec, new THREE.Vector3(a.x, 0.6, a.z), 'REPEATING ROCKS', `an:rocks:${rec.cx},${rec.cz}`, 40);
  }

  // ---- a piece of Level 0 standing in the field ----
  _wall(rec, a, m, g) {
    const kit = new Kit();
    const H = 2.9, T = 0.16, L = CELL + 0.1;
    const x = a.alongX ? (a.i + 0.5) * CELL : a.i * CELL;
    const z = a.alongX ? a.j * CELL : (a.j + 0.5) * CELL;
    const y = Math.min(g(x - 1, z - 1), g(x + 1, z + 1), g(x, z)) - 0.05;
    kit.box(m.wallpaper, L, H, T, 0, H / 2, 0);
    kit.box(m.base, L, 0.1, T + 0.025, 0, 0.05, 0);
    // outlet + switch
    kit.box(m.paint, 0.07, 0.12, 0.012, 0.6, 0.32, T / 2 + 0.006);
    kit.box(m.paint, 0.08, 0.12, 0.012, -0.9, 1.2, T / 2 + 0.006);
    // ragged top edge: a broken ceiling-grid stub hangs on
    kit.box(m.alu, L, 0.03, 0.4, 0, H + 0.015, 0.15);
    const grp = kit.build(rec.group, 'anomaly wall');
    grp.position.set(x, y, z);
    grp.rotation.y = a.alongX ? 0 : Math.PI / 2;
    grp.updateMatrixWorld(true);
    this._col(rec, RAPIER.ColliderDesc.cuboid(L / 2, H / 2, T / 2), x, y + H / 2, z, grp.rotation.y);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.02, 1.2), m.panel.clone());
    panel.material.emissiveIntensity = 1.6;
    panel.position.set(0, H + 0.04, 0.8);
    grp.add(panel);
    this._photo(rec, new THREE.Vector3(x, y + 1.4, z), 'DIMENSIONAL BLEED (LEVEL 0 WALL)', `an:wall:${rec.cx},${rec.cz}`, 65);
  }

  _vending(rec, a) {
    const y = this.level.groundAt(a.x, a.z);
    const dev = this._device(rec, 'vending_snack', `vend:gl:${rec.cx},${rec.cz}`, new THREE.Vector3(a.x, y - 0.03, a.z), a.rot, { backrooms: true });
    if (dev) this._photo(rec, new THREE.Vector3(a.x, y + 1, a.z), 'VENDING MACHINE IN THE WOODS', `an:vend:${rec.cx},${rec.cz}`, 40);
  }

  _tv(rec, a) {
    const y = this.level.groundAt(a.x, a.z);
    const dev = this._device(rec, 'creepy_tv', `tv:gl:${rec.cx},${rec.cz}`, new THREE.Vector3(a.x, y - 0.02, a.z), a.rot);
    if (dev) this._photo(rec, new THREE.Vector3(a.x, y + 0.7, a.z), 'TELEVISION IN THE GRASS', `an:tv:${rec.cx},${rec.cz}`, 45);
  }

  _clone(rec, a, m, g, rng) {
    const pos = new THREE.Vector3(a.x + 0.3, g(a.x, a.z), a.z - 0.2);
    this.level.mission?.decorDeadClone(rec, pos, rng);
    // decorDeadClone assumes a floor at y = 0
    const last = rec.group.children[rec.group.children.length - 1];
    if (last) { last.position.y = pos.y + 0.12; last.updateMatrixWorld(true); }
    if (net.isHost && !this.level.populated.has('an:' + rec.key)) {
      this.level.populated.add('an:' + rec.key);
      const t = rng.pick(['flashlight', 'sample_jar', 'medkit', 'almond_water', 'battery']);
      const hh = modelHalfHeight(t);
      this.world.props.spawn(t, new THREE.Vector3(a.x - 0.5, g(a.x - 0.5, a.z + 0.3) + hh + 0.05, a.z + 0.3), _q.setFromEuler(_e.set(0, rng.next() * 6, 0)), { sleep: true });
    }
    this._photo(rec, pos.clone().setY(pos.y + 0.3), 'DECEASED PREDECESSOR', `an:clone:${rec.cx},${rec.cz}`, 40);
  }

  _carpet(rec, a, m, g) {
    const kit = new Kit();
    const y = g(a.x, a.z);
    kit.box(m.carpet, CELL - 0.2, 0.06, CELL - 0.2, 0, 0, 0);
    const grp = kit.build(rec.group, 'anomaly carpet');
    grp.position.set(a.x, y + 0.01, a.z);
    grp.rotation.y = a.rot + 0.07;
    grp.updateMatrixWorld(true);
    this._photo(rec, new THREE.Vector3(a.x, y + 0.1, a.z), 'OFFICE CARPET GROWING IN A MEADOW', `an:carpet:${rec.cx},${rec.cz}`, 35);
  }

  _device(rec, kind, id, pos, rotY, opts = {}) {
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
    dev.root.visible = true;
    (rec.roomDevices = rec.roomDevices || []).push(dev);
    this.level.registerProxy?.(dev, { near: 12, far: 62, shadows: true });
    return dev;
  }

  // ---------------------------------------------------------------------------
  update(dt, S, t) {
    const g = this.level.game;
    const dusk = THREE.MathUtils.smoothstep(-S.elev, -14, -6) > 0 ? 1 : THREE.MathUtils.smoothstep(8 - S.elev, 0, 6);
    const day = g.day.day;
    // light poles: on at dusk (and always a little wrong: they come on early from day 4)
    const on = Math.max(dusk, day >= 4 ? 0.6 : 0);
    const cam = engine.camera.position;
    const lit = [];
    for (const p of this.poles) {
      let v = on;
      if (day >= 5) { const f = Math.sin(t * 9 + p.seed) + Math.sin(t * 23.7 + p.seed * 2); if (f > 1.35) v *= 0.1; }
      p.level = v;
      p.panel.material.emissiveIntensity = v * 2.4;
      if (v > 0.05) lit.push(p);
    }
    lit.sort((a, b) => a.pos.distanceToSquared(cam) - b.pos.distanceToSquared(cam));
    this.lights.forEach((l, k) => {
      const p = lit[k];
      if (p && p.pos.distanceTo(cam) < 60) { l.position.copy(p.pos); l.intensity = 9 * p.level; } else l.intensity = 0;
    });
    // pole hum
    const near = lit[0];
    const d = near ? near.pos.distanceTo(cam) : 1e9;
    if (near && d < 24) {
      if (!this.hum) this.hum = audio.loop('hum', { bus: 'ambient', volume: 0.5, pos: near.pos.clone() });
      this.hum.setPosition?.(near.pos);
      this.hum.setParam?.('flicker', day >= 5 ? 1 : 0.2);
    } else if (this.hum) { this.hum.stop(0.5); this.hum = null; }
    this._doorLoop(dt);
  }

  // sampleLight contribution of lit poles
  lightAt(pos, out) {
    for (const p of this.poles) {
      if (!(p.level > 0.05)) continue;
      const d = p.pos.distanceTo(pos);
      if (d > 14) continue;
      const w = p.level * 1.3 / (1 + 0.09 * d * d);
      out.r += 1.0 * w; out.g += 0.95 * w; out.b += 0.82 * w;
    }
  }

  // stepping through the lone door from day 2 on brings you back out of it (three times, then it lets you go)
  _doorLoop(dt) {
    const l = this.level.game.local;
    this.doorCool -= dt;
    if (l.dead || this.level.game.day.day < 2) return;
    for (const d of this.doors) {
      const rel = _v.subVectors(l.pos, d.pos);
      const side = rel.dot(d.n);
      const lateral = Math.abs(rel.dot(d.t));
      if (lateral > 0.45 || Math.abs(rel.y) > 1.5 || rel.length() > 2.5) { d.side = Math.sign(side) || d.side; continue; }
      const s = Math.sign(side);
      if (d.side && s && s !== d.side && this.doorCool <= 0 && this.doorLoops < 3) {
        this.doorLoops++;
        this.doorCool = 2;
        engine.post.params.uFade.value = 0.9;
        setTimeout(() => { engine.post.params.uFade.value = 0; }, 140);
        audio.play('teleport_whoosh', { volume: 0.3 });
        const back = d.pos.clone().addScaledVector(d.n, d.side * 1.6);
        back.y = this.level.groundAt(back.x, back.z);
        const keep = l.vel.clone();
        l.teleport(back);
        l.vel.copy(keep);
        if (this.doorLoops === 3) this.level.game.ui.toast('The door lets you through.', 'info');
        return;
      }
      if (s) d.side = s;
    }
  }

  dispose() {
    this.hum?.stop(0.2);
    for (const l of this.lights) l.removeFromParent();
  }
}

export { WATER_Y, hash01 };
