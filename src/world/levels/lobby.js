// The R.O.O.M. underground office (lobby): reception, open-plan office, locker room with a
// mirror, break room (vending, water cooler, aquarium, darts, couch & TV), cloning laboratory
// and the dimensional dispatch bay. Slightly uncanny: chairs sink, posters and clocks change
// when nobody is looking, the receptionist turns to watch you.
import * as THREE from 'three';
import { engine } from '../../core/engine.js';
import { net } from '../../net/net.js';
import { input } from '../../core/input.js';
import { audio } from '../../audio/audio.js';
import * as Mat from '../../gfx/materials.js';
import { GeoBuilder } from '../geom.js';
import { bakeGeometry, bakedMaterial, LightField } from '../../gfx/bakedlight.js';
import { Q } from '../../physics/physics.js';
import { buildModel, modelHalfHeight } from '../../entities/catalog.js';
import { makeDevice, ModelDevice } from '../../game/devicekinds.js';
import { Device } from '../../game/devices.js';
import { CrtScreen, text } from '../../ui/crt.js';
import { LORE } from '../../game/lore.js';
import { buildUnfinishedClone, buildReceptionist } from '../../entities/optional.js';
import * as Critters from '../../entities/optional.js';
import { MonsterManager } from '../../game/monsters.js';

const H = 2.8;
const T = 0.18;
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

// rooms: floor material + light tone
const ROOMS = [
  { id: 'reception', x0: -7, z0: 6, x1: 7, z1: 16, floor: 'office_carpet', tone: 0xfff0d8 },
  { id: 'office', x0: -12, z0: -6, x1: 12, z1: 6, floor: 'office_carpet', tone: 0xf4f6ff },
  { id: 'lockers', x0: -22, z0: -6, x1: -12, z1: 6, floor: 'linoleum', tone: 0xeef4ff },
  { id: 'break', x0: 12, z0: -6, x1: 24, z1: 6, floor: 'linoleum', tone: 0xfff2dc },
  { id: 'lab', x0: -22, z0: -18, x1: -4, z1: -6, floor: 'linoleum', tone: 0xdcfff0 },
  { id: 'dispatch', x0: 4, z0: -18, x1: 22, z1: -6, floor: 'concrete_dark', tone: 0xffe2b0 },
];

export class LobbyLevel {
  constructor(world, desc) {
    this.world = world;
    this.game = world.game;
    this.desc = desc;
    this.seed = desc.seed;
    this.name = 'R.O.O.M. HEADQUARTERS — SUBLEVEL B4';
    this.reverb = 'office';
    this.field = world.field;
    this.lights = [];
    this.mats = {};
    this.uncanny = { sinkT: 0, chair: null };
    this.dispatch = null;
    this.time = 0;
  }

  // ---------------------------------------------------------------
  async build(onProgress) {
    const scene = engine.scene;
    scene.background = new THREE.Color(0x050505);
    scene.fog = new THREE.FogExp2(0x0a0a0a, 0.012);
    engine.scene.environmentIntensity = 0.3;
    this.field.uniforms.uAmbient.value.setRGB(0.03, 0.03, 0.028);
    this.field.uniforms.uLightScale.value = 0.62;
    engine.post.params.uTint.value.setRGB(1.0, 0.99, 0.96);
    engine.post.params.uSat.value = 1.0;
    engine.post.params.uGrain.value = 0.05;
    engine.post.params.uVignette.value = 0.42;
    engine.post.params.uGlitch.value = 0;
    engine.post.params.uFade.value = 0;
    this.world.customModel = (type, state) => this._customModel(type, state);
    this.world.monsters = null;
    onProgress?.(0.1, 'POWERING SUBLEVEL B4');
    this._buildShell();
    await tick();
    onProgress?.(0.4, 'INSTALLING FURNITURE');
    this._buildDevices();
    await tick();
    onProgress?.(0.7, 'WARMING UP CRTS');
    this._bake();
    await tick();
    onProgress?.(1, 'READY');
  }

  _customModel(type, state) {
    if (type === 'fish' && Critters.buildFish) {
      const f = Critters.buildFish(state?.kind || 'goldfish', state?.seed || 1);
      const object = new THREE.Group();
      object.add(f.root);
      object.userData.fish = f;
      return { object, colliders: [{ type: 'box', size: [0.1, 0.05, 0.03], pos: [0, 0, 0] }], mass: 0.15, material: 'soft', halfHeight: 0.03, parts: {}, anchors: {} };
    }
    return null;
  }

  // ---------------------------------------------------------------
  _buildShell() {
    const g = this.world.group;
    const phys = this.world.physics;
    this.gb = {};
    const gbFor = (mat) => (this.gb[mat] = this.gb[mat] || new GeoBuilder());
    // floors & ceilings
    for (const r of ROOMS) {
      const w = r.x1 - r.x0, d = r.z1 - r.z0;
      gbFor(r.floor).grid(new THREE.Vector3(r.x0, 0, r.z1), new THREE.Vector3(w, 0, 0), new THREE.Vector3(0, 0, -d), new THREE.Vector3(0, 1, 0), Math.ceil(w / 1.5), Math.ceil(d / 1.5), (p) => [p.x, p.z]);
      const ceilMat = r.id === 'dispatch' ? 'concrete' : 'ceiling';
      gbFor(ceilMat).grid(new THREE.Vector3(r.x0, H, r.z0), new THREE.Vector3(w, 0, 0), new THREE.Vector3(0, 0, d), new THREE.Vector3(0, -1, 0), Math.ceil(w / 1.5), Math.ceil(d / 1.5), (p) => [p.x, p.z]);
      phys.addStaticBox((r.x0 + r.x1) / 2, -0.25, (r.z0 + r.z1) / 2, w / 2 + 0.2, 0.25, d / 2 + 0.2, { kind: 'static', surface: r.floor === 'office_carpet' ? 'carpet' : r.floor === 'concrete_dark' ? 'concrete' : 'hard' });
      phys.addStaticBox((r.x0 + r.x1) / 2, H + 0.25, (r.z0 + r.z1) / 2, w / 2 + 0.2, 0.25, d / 2 + 0.2, { kind: 'static' });
      // ceiling light grid
      const nx = Math.max(1, Math.round(w / 3.2)), nz = Math.max(1, Math.round(d / 3.2));
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const x = r.x0 + (i + 0.5) * (w / nx), z = r.z0 + (j + 0.5) * (d / nz);
        this._addLight(x, z, r.tone, r.id === 'dispatch' ? 0.9 : 1.05, r.id);
      }
    }
    // walls: [x0,z0,x1,z1, matA (left/-normal side), matB, openings[{a,b,top}]]
    const P = { panel: { lower: 'panel', upper: 'paint', split: 1.0 }, tile: { lower: 'tile', upper: 'paint_white', split: 1.3 }, labt: { lower: 'tile_green', upper: 'paint_white', split: 1.3 } };
    const W = [
      // reception (x -7..7, z 6..16)
      [-7, 16, 7, 16, P.panel, null, [{ a: 5.5, b: 8.5, top: 2.3, door: 'elevator' }]],
      [-7, 6, -7, 16, null, P.panel],
      [7, 6, 7, 16, P.panel, P.tile],
      [-12, 6, -2, 6, 'paint', P.panel],
      [2, 6, 12, 6, 'paint', P.panel],
      // office outer
      [-12, -6, -9, -6, 'paint_white', 'paint'],
      [-6, -6, 6, -6, 'paint_white', 'paint'],
      [9, -6, 12, -6, 'concrete', 'paint'],
      [-12, -6, -12, -1.2, 'paint_blue', 'paint'],
      [-12, 1.2, -12, 6, 'paint_blue', 'paint'],
      [12, -6, 12, -1.2, 'paint', P.tile],
      [12, 1.2, 12, 6, 'paint', P.tile],
      // lockers outer
      [-22, -6, -22, 6, null, 'paint_blue'],
      [-22, 6, -12, 6, 'paint_blue', null],
      [-22, -6, -12, -6, P.labt, 'paint_blue'],
      // break room outer
      [24, -6, 24, 6, P.tile, null],
      [12, 6, 24, 6, P.tile, null],
      [12, -6, 24, -6, 'concrete', P.tile],
      // lab
      [-22, -18, -4, -18, null, P.labt],
      [-22, -18, -22, -6, null, P.labt],
      [-4, -18, -4, -6, P.labt, 'concrete'],
      // dispatch
      [4, -18, 22, -18, null, 'concrete', [{ a: 7.4, b: 10.6, top: 2.6, door: 'dispatch' }]],
      [4, -18, 4, -6, null, 'concrete'],
      [22, -18, 22, -6, 'concrete', null],
    ];
    for (const w of W) this._wall(...w);
  }

  _addLight(x, z, tone, intensity, room) {
    const i = Math.floor(x / 1.5) + 40, j = Math.floor(z / 1.5) + 40;
    const key = LightField.texel(i, j);
    const l = this.field.add(key, x, H - 0.04, z, tone, intensity, { mode: 'on', radius: 10 });
    l.room = room;
    this.lights.push(l);
    // panel mesh (emissive, follows the light value)
    const gb = (this.gb.__panels = this.gb.__panels || new GeoBuilder());
    gb.box(new THREE.Vector3(x - 0.6, H - 0.03, z - 0.3), new THREE.Vector3(x + 0.6, H + 0.01, z + 0.3), 2, { top: true }, 'flat');
    (this.panelKeys = this.panelKeys || []).push({ key, x, z });
    return l;
  }

  _wall(x0, z0, x1, z1, matA, matB, openings = []) {
    const phys = this.world.physics;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const axis = Math.abs(x1 - x0) > Math.abs(z1 - z0) ? 'x' : 'z';
    const s0 = axis === 'x' ? Math.min(x0, x1) : Math.min(z0, z1);
    const fixed = axis === 'x' ? z0 : x0;
    const pieces = []; // [a, b, y0, y1]
    let cur = 0;
    const ops = openings.slice().sort((a, b) => a.a - b.a);
    for (const o of ops) {
      if (o.a > cur) pieces.push([cur, o.a, 0, H]);
      pieces.push([o.a, o.b, o.top, H]);
      cur = o.b;
    }
    if (cur < len) pieces.push([cur, len, 0, H]);
    for (const [a, b, y0, y1] of pieces) {
      if (b - a < 0.01 || y1 - y0 < 0.01) continue;
      const e0 = a === 0 ? -T / 2 : a, e1 = b === len ? len + T / 2 : b;
      for (const side of [-1, 1]) {
        const mat = side < 0 ? matA : matB;
        if (!mat) continue;
        const spec = typeof mat === 'string' ? { lower: mat, upper: mat, split: 0 } : mat;
        const bands = spec.split > y0 && spec.split < y1 ? [[y0, spec.split, spec.lower], [spec.split, y1, spec.upper]] : [[y0, y1, spec.split >= y1 ? spec.lower : spec.upper]];
        for (const [b0, b1, m] of bands) {
          const gb = (this.gb[m] = this.gb[m] || new GeoBuilder());
          let min, max;
          if (axis === 'x') {
            min = new THREE.Vector3(s0 + e0, b0, side < 0 ? fixed - T / 2 : fixed);
            max = new THREE.Vector3(s0 + e1, b1, side < 0 ? fixed : fixed + T / 2);
          } else {
            min = new THREE.Vector3(side < 0 ? fixed - T / 2 : fixed, b0, s0 + e0);
            max = new THREE.Vector3(side < 0 ? fixed : fixed + T / 2, b1, s0 + e1);
          }
          const skip = { bottom: true, top: b1 >= H - 0.001 };
          if (axis === 'x') { skip[side < 0 ? 'pz' : 'nz'] = true; } else { skip[side < 0 ? 'px' : 'nx'] = true; }
          gb.box(min, max, 1.0, skip);
          if (y0 === 0 && b0 === 0) {
            // baseboard
            const bb = (this.gb.__base = this.gb.__base || new GeoBuilder());
            const bt = 0.015;
            if (axis === 'x') {
              if (side < 0) bb.box(new THREE.Vector3(min.x, 0, min.z - bt), new THREE.Vector3(max.x, 0.1, min.z), 2, { bottom: true });
              else bb.box(new THREE.Vector3(min.x, 0, max.z), new THREE.Vector3(max.x, 0.1, max.z + bt), 2, { bottom: true });
            } else if (side < 0) bb.box(new THREE.Vector3(min.x - bt, 0, min.z), new THREE.Vector3(min.x, 0.1, max.z), 2, { bottom: true });
            else bb.box(new THREE.Vector3(max.x, 0, min.z), new THREE.Vector3(max.x + bt, 0.1, max.z), 2, { bottom: true });
          }
        }
      }
      // collider for the full thickness
      if (axis === 'x') phys.addStaticBox(s0 + (e0 + e1) / 2, (y0 + y1) / 2, fixed, (e1 - e0) / 2, (y1 - y0) / 2, T / 2, { kind: 'static' });
      else phys.addStaticBox(fixed, (y0 + y1) / 2, s0 + (e0 + e1) / 2, T / 2, (y1 - y0) / 2, (e1 - e0) / 2, { kind: 'static' });
    }
  }

  // ---------------------------------------------------------------
  _dev(kind, id, x, y, z, rotY, opts = {}) {
    const d = makeDevice(this.world, kind, id, opts);
    d.root.position.set(x, y, z);
    d.root.rotation.y = rotY;
    d.build?.();
    this.world.addDevice(d);
    this.world.registerDynamic(d.root);
    return d;
  }

  _static(type, x, y, z, rotY = 0, collide = true, opts = {}) {
    const m = buildModel(type, { seed: (x * 31 + z * 7) | 0, ...opts });
    m.object.position.set(x, y + (m.halfHeight ?? 0), z);
    m.object.rotation.y = rotY;
    this.world.group.add(m.object);
    this.world.registerDynamic(m.object);
    if (collide && m.colliders?.length) {
      m.object.updateMatrixWorld(true);
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      m.object.matrixWorld.decompose(p, q, s);
      this.world.physics.addStaticCollidersFromDesc(m.colliders, p, q, { kind: 'static', surface: 'prop' });
    }
    return m;
  }

  _buildDevices() {
    const L = LORE;
    // --- Reception ---
    this.recDesk = this._dev('reception_desk', 'reception_desk', 0, 0, 10.2, 0);
    if (buildReceptionist) {
      this.receptionist = buildReceptionist();
      const rp = this.recDesk.anchors.receptionist;
      this.receptionist.root.position.set(rp ? rp.x : 0, 0, rp ? 10.2 + rp.z : 9.4);
      this.world.group.add(this.receptionist.root);
      this.world.registerDynamic(this.receptionist.root);
    }
    const bellA = this.recDesk.anchors.bell;
    this._dev('service_bell', 'bell', bellA ? bellA.x : 0.6, bellA ? bellA.y : 1.05, bellA ? 10.2 + bellA.z : 10.6, 0, { onRing: () => this._receptionistSnap() });
    if (this.recDesk.model.screens?.main?.mesh) {
      this.recScreen = new CrtScreen(256, 192, 'green');
      this.recScreen.attach(this.recDesk.model.screens.main.mesh, 1.2);
    }
    this._dev('employee_of_month', 'eotm', 6.88, 1.6, 11, -Math.PI / 2, { renderPortrait: (c, wrong) => this.game.ui.portrait?.(c, wrong) });
    this._dev('wall_clock', 'clock_rec', -6.88, 2.15, 11, Math.PI / 2);
    this._dev('poster', 'poster_r1', -6.88, 1.5, 8.2, Math.PI / 2, { texts: L.posters.slice(0, 3), creepy: L.creepy, color: '#3a5a8a' });
    this._dev('poster', 'poster_r2', 6.88, 1.5, 14.2, -Math.PI / 2, { texts: L.posters.slice(3), creepy: L.creepy, color: '#8a3a3a' });
    this._static('plant_pot', -6.3, 0, 15.3, 0);
    this._static('plant_pot', 6.3, 0, 7, 1);
    this._static('exit_sign', 0, 2.55, 15.88, Math.PI, false);
    // elevator doors (decorative) on the south wall
    this._elevator(0, 15.9);
    // --- Office ---
    this._dev('crt_terminal', 'term_shift', -8.6, 0.76, -3.5, Math.PI / 2, { program: 'shift', palette: 'green' });
    this._dev('crt_terminal', 'term_howto', 8.6, 0.76, 3.0, -Math.PI / 2, { program: 'howto', palette: 'amber' });
    this._dev('crt_terminal', 'term_ach', -3.2, 0.76, -5.2, 0, { program: 'achievements', palette: 'green' });
    this._static('desk', -8.6, 0, -3.5, Math.PI / 2);
    this._static('desk', 8.6, 0, 3.0, -Math.PI / 2);
    this._static('desk', -3.2, 0, -5.25, 0);
    this._dev('water_cooler', 'cooler_office', 11.4, 0, -4.8, -Math.PI / 2);
    this._dev('poster', 'poster_o1', 0, 1.6, -5.88, 0, { texts: [L.posters[1], L.posters[4]], creepy: L.creepy, color: '#2a6a4a' });
    this._dev('wall_clock', 'clock_off', 4, 2.2, -5.88, 0);
    this._dev('server_rack', 'rack1', -11.4, 0, 4.6, Math.PI / 2);
    // --- Locker room ---
    this._dev('locker_bank', 'lockers', -21.65, 0, 0, Math.PI / 2, { count: 8 });
    this._dev('mirror', 'mirror', -17, 0, -5.88, 0, { width: 1.2, height: 1.6 });
    this._dev('poster', 'poster_l1', -12.12, 1.5, 3.8, -Math.PI / 2, { texts: [L.posters[2]], creepy: L.creepy, color: '#5a3a7a' });
    // --- Break room ---
    this._dev('vending_snack', 'vend_snack', 15.2, 0, -5.45, 0);
    this._dev('vending_drink', 'vend_drink', 16.5, 0, -5.45, 0);
    this._dev('water_cooler', 'cooler_break', 18.2, 0, -5.6, 0);
    this._dev('coffee_machine', 'coffee', 21.3, 0.92, -5.55, 0);
    this._static('table_folding', 21.3, 0, -5.5, 0);
    this._dev('fridge', 'fridge', 23.45, 0, -4.2, -Math.PI / 2);
    this._dev('aquarium', 'aquarium', 23.55, 0, 1.8, -Math.PI / 2, { critterModels: Critters });
    this.dartBoard = this._dev('dart_board', 'darts', 18, 1.73, 5.9, Math.PI, {
      scoreboard: { redraw: (st) => this._drawScoreboard(st) },
    });
    this._scoreboard(15.6, 5.9);
    this.tv = this._dev('creepy_tv', 'tv_break', 13.0, 0, 0.5, Math.PI / 2, { mode: 'training' });
    // --- Cloning lab ---
    this.tubes = [];
    for (let k = 0; k < 4; k++) {
      const x = -19 + k * 3.4;
      const d = this._dev('clone_tube', `tube${k}`, x, 0, -16.9, 0);
      this.tubes.push(d);
      if (buildUnfinishedClone) {
        const c = buildUnfinishedClone(k, 100 + k);
        const a = d.anchors.specimen;
        c.root.position.set(a ? a.x : 0, a ? a.y : 1.2, a ? a.z : 0);
        d.root.add(c.root);
        d.specimen = c;
      }
    }
    this._dev('clone_console', 'clone_console', -8, 0, -15.5, -0.5);
    this._dev('clone_pad', 'demo_pad', -13, 0, -10, 0, { collide: true });
    this._dev('server_rack', 'rack2', -21.4, 0, -9, Math.PI / 2);
    this._dev('server_rack', 'rack3', -21.4, 0, -10.2, Math.PI / 2);
    this._dev('crt_terminal', 'term_records', -5, 0.76, -9.5, -Math.PI / 2, { program: 'records', palette: 'cyan', lore: 0 });
    this._static('desk', -5, 0, -9.5, -Math.PI / 2);
    // --- Dispatch bay ---
    this.dispatchDoor = this._dev('dispatch_door', 'dispatch_door', 13, 0, -17.9, 0, { collide: false });
    this.dispatchLever = new DispatchLever(this.world, 'dispatch_lever', this);
    this.dispatchLever.root.position.set(16.6, 0, -14.2);
    this.dispatchLever.root.rotation.y = -0.4;
    this.dispatchLever.build();
    this.world.addDevice(this.dispatchLever);
    this.world.registerDynamic(this.dispatchLever.root);
    this._static('hazard_sign', 9.5, 1.4, -17.88, 0, false);
    this._static('fuse_box', 21.88, 1.3, -10, -Math.PI / 2, false);
    this._static('fire_alarm', 4.12, 1.5, -12, Math.PI / 2, false);
    // dispatch floor zone (hazard stripes)
    const zone = new THREE.Mesh(new THREE.PlaneGeometry(6, 5), new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.7 }));
    zone.rotation.x = -Math.PI / 2;
    zone.position.set(13, 0.006, -14.6);
    zone.receiveShadow = true;
    this.world.group.add(zone);
    this.dispatchZone = new THREE.Box3(new THREE.Vector3(10, -0.5, -17.2), new THREE.Vector3(16, 3, -12.1));
    // collision for dispatch door halves (closed)
    this.doorCols = [
      this.world.physics.addStaticBox(11.7, 1.3, -17.95, 1.6, 1.3, 0.15, { kind: 'static' }),
      this.world.physics.addStaticBox(14.3, 1.3, -17.95, 1.6, 1.3, 0.15, { kind: 'static' }),
    ];
    // feature real lights (highlights only)
    const addPL = (c, i, d, x, y, z) => { const l = new THREE.PointLight(c, i, d, 2); l.position.set(x, y, z); this.world.group.add(l); return l; };
    this.vendLight = addPL(0xbfe4ff, 1.4, 4, 15.8, 1.4, -4.6);
    this.aquaLight = addPL(0x7fd8ff, 1.2, 3.5, 22.8, 1.5, 1.8);
    this.labLight = addPL(0x3dff9a, 2.2, 7, -14, 1.6, -15.5);
    this.beaconLight = addPL(0xff3010, 0, 9, 13, 2.4, -16.8);
  }

  _elevator(x, z) {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.5, 0.12), Mat.get('steel'));
    frame.position.set(0, 1.25, 0);
    const doorL = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.25, 0.06), Mat.get('chrome'));
    doorL.position.set(-0.71, 1.13, -0.08);
    const doorR = doorL.clone();
    doorR.position.x = 0.71;
    const ind = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.04), Mat.get('emissive_amber'));
    ind.position.set(0, 2.45, -0.09);
    g.add(frame, doorL, doorR, ind);
    g.position.set(x, 0, z);
    g.rotation.y = Math.PI;
    this.world.group.add(g);
    this.world.registerDynamic(g);
    this.elevatorDoors = [doorL, doorR];
  }

  _scoreboard(x, z) {
    this.sbScreen = new CrtScreen(384, 288, 'green');
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.82), new THREE.MeshStandardMaterial({ map: this.sbScreen.texture, roughness: 0.9 }));
    m.position.set(x, 1.6, z - 0.045);
    m.rotation.y = Math.PI;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.92, 0.04), Mat.get('wood'));
    frame.position.set(x, 1.6, z - 0.01);
    this.world.group.add(frame, m);
    this._drawScoreboard({ throws: [], scores: {} });
  }

  _drawScoreboard(st) {
    const s = this.sbScreen;
    const { ctx, w, h } = s;
    ctx.fillStyle = '#1f2a22';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e8eadf';
    ctx.font = 'bold 34px "VT323", monospace';
    ctx.fillText('DARTS — BREAK ROOM', 16, 36);
    ctx.font = '26px "VT323", monospace';
    const sc = Object.entries(st.scores || {}).sort((a, b) => b[1] - a[1]);
    sc.slice(0, 4).forEach(([n, v], i) => ctx.fillText(`${n.slice(0, 12).padEnd(12, '.')} ${v}`, 20, 80 + i * 28));
    ctx.fillStyle = 'rgba(232,234,223,0.6)';
    (st.throws || []).slice(0, 4).forEach((t, i) => ctx.fillText(`${t.n.slice(0, 8)}: ${t.l} (${t.s})`, 20, 200 + i * 22));
    s.texture.needsUpdate = true;
  }

  _receptionistSnap() {
    this.recLookT = 2.5;
  }

  _bake() {
    // make sure the ray queries see all static colliders
    this.world.physics.world.step();
    const phys = this.world.physics;
    const lights = this.lights;
    const lightsNear = (x, z) => lights.filter((l) => Math.abs(l.x - x) < 10 && Math.abs(l.z - z) < 10);
    const ray = new THREE.Vector3();
    const occl = (x0, z0, x1, z1, y0) => {
      const from = new THREE.Vector3(x0, Math.min(y0 ?? 1.2, H - 0.12), z0);
      const to = new THREE.Vector3(x1, H - 0.12, z1);
      ray.subVectors(to, from);
      const d = ray.length();
      if (d < 0.05) return 1;
      ray.divideScalar(d);
      const hit = phys.raycast(from, ray, d - 0.05, Q.world);
      return hit ? 0.08 : 1;
    };
    const ao = (x, y, z, nx, ny) => {
      if (ny > 0.5) return 0.8;
      if (ny < -0.5) return 0.9;
      return Math.min(1, 0.75 + y * 0.4) * Math.min(1, 0.85 + (H - y) * 0.4);
    };
    const field = this.field;
    const grime = { office_carpet: 0, linoleum: 0, concrete_dark: 4, concrete: 4, ceiling: 3, paint: 0, panel: 0, tile: 0 };
    for (const [name, gb] of Object.entries(this.gb)) {
      if (gb.isEmpty()) continue;
      const geo = gb.build();
      if (name === '__panels') {
        const n = geo.attributes.position.count;
        const cells = new Float32Array(n * 4), wts = new Float32Array(n * 4), a = new Float32Array(n).fill(1);
        const pos = geo.attributes.position;
        for (let v = 0; v < n; v++) {
          let best = null, bd = 1e9;
          for (const pk of this.panelKeys) {
            const d = (pk.x - pos.getX(v)) ** 2 + (pk.z - pos.getZ(v)) ** 2;
            if (d < bd) { bd = d; best = pk; }
          }
          cells[v * 4] = best.key;
          wts[v * 4] = 1;
        }
        geo.setAttribute('aLightCells', new THREE.BufferAttribute(cells, 4));
        geo.setAttribute('aLightW', new THREE.BufferAttribute(wts, 4));
        geo.setAttribute('aAO', new THREE.BufferAttribute(a, 1));
        const mesh = new THREE.Mesh(geo, bakedMaterial(Mat.get('lightpanel'), field, 0, { emissiveLights: true }));
        this.world.group.add(mesh);
        continue;
      }
      bakeGeometry(geo, new THREE.Matrix4(), lightsNear, occl, ao, name === 'ceiling' ? { direct: 0.3, bounce: 0.9 } : {});
      const base = name === '__base' ? Mat.make('paint', { color: 0x5a4632, roughness: 0.6 }) : Mat.get(name);
      const mesh = new THREE.Mesh(geo, bakedMaterial(base, field, grime[name] ?? 0));
      mesh.receiveShadow = true;
      mesh.castShadow = name !== 'ceiling';
      this.world.group.add(mesh);
    }
    this.field.forceRefresh();
  }

  // ---------------------------------------------------------------
  spawnPoint(index = 0) {
    const offs = [[-1, 13.6], [1, 13.6], [-1, 12.4], [1, 12.4]];
    const o = offs[index % 4];
    return { pos: new THREE.Vector3(o[0], 0.02, o[1]), yaw: 0, arrival: false };
  }

  hostStart() {
    const S = (type, x, y, z, rotY = 0, opts = {}) => {
      const hh = modelHalfHeight(type);
      _q.setFromEuler(_e.set(opts.rx || 0, rotY, 0));
      return this.world.props.spawn(type, new THREE.Vector3(x, y + hh + 0.01, z), _q, { sleep: true, state: opts.state });
    };
    // reception waiting area (one of these chairs likes to sink)
    for (let k = 0; k < 4; k++) S('chair_wood', -6.2, 0, 8.4 + k * 0.9, Math.PI / 2);
    this.uncanny.chairId = S('chair_wood', -5.2, 0, 14.2, 2.4)?.id;
    S('table_round', -5.4, 0, 12.2, 0);
    S('paper_stack', -5.4, 0.72, 12.2, 0.4);
    S('chair_office', 0.2, 0, 9.0, Math.PI);
    S('trash_can', 2.4, 0, 9.5, 0);
    S('wet_floor_sign', 3.2, 0, 13.5, 0.6);
    // office cubicles
    for (let k = 0; k < 4; k++) {
      const x = -5.5 + (k % 2) * 6, z = -1.8 + Math.floor(k / 2) * 4;
      S('desk_cubicle_panel', x, 0, z - 0.85, 0);
      S('desk', x, 0, z, Math.PI);
      S('chair_office', x + 0.1, 0, z + 0.85, Math.PI + 0.3 * (k - 1.5));
      S('crt_monitor', x - 0.15, 0.76, z - 0.15, Math.PI);
      S('keyboard', x - 0.15, 0.76, z + 0.2, Math.PI);
      S(['mug', 'desk_phone', 'binder', 'lamp_desk'][k], x + 0.55, 0.76, z - 0.1, k);
    }
    S('filing_cabinet', -11.5, 0, -5.4, Math.PI / 2);
    S('filing_cabinet', -11.5, 0, -4.7, Math.PI / 2);
    S('printer', 10.8, 0, 1.5, -Math.PI / 2);
    S('whiteboard', 4, 0, 4.9, Math.PI);
    S('plant_pot', -11.3, 0, 5.3, 0);
    S('office_divider_plant', 1, 0, 1, 0.5);
    S('box_medium', 9.8, 0, -5.2, 0.2);
    S('box_small', 9.9, 0.55, -5.2, -0.3);
    S('traffic_cone', 5.5, 0, -4.8, 0);
    S('rubber_duck', -3.2, 0.78, -5.0, 0.4);
    // locker room
    S('stool', -18, 0, 0, 0);
    S('stool', -16.5, 0, 0.8, 0);
    S('basketball', -15, 0.2, 3, 0);
    S('suitcase', -13.5, 0, 5.2, 0.3);
    S('coat_rack', -13, 0, -5.2, 0);
    // break room
    S('couch', 15.4, 0, 0.5, -Math.PI / 2);
    S('table_round', 19, 0, -1.6, 0);
    S('table_round', 19, 0, 2.2, 0);
    for (const [x, z, r] of [[18.2, -1.6, 1.4], [19.8, -1.6, -1.4], [18.2, 2.2, 1.6], [19.8, 2.2, -1.6]]) S('chair_folding', x, 0, z, r);
    S('mug', 19, 0.72, -1.6, 0);
    S('microwave', 21.6, 0.76, 5.5, Math.PI);
    S('table_folding', 21.6, 0, 5.5, 0);
    S('table_folding', 18, 0, 3.8, 0);
    for (let k = 0; k < 6; k++) S('dart', 17.6 + k * 0.15, 0.77, 3.8, Math.PI, { rx: Math.PI / 2 });
    S('radio_cassette', 23.3, 0, -1.5, -Math.PI / 2);
    S('trash_can', 13.4, 0, 5.4, 0);
    // lab
    S('table_folding', -14, 0, -13, 0.1);
    S('sample_jar', -14.3, 0.76, -13, 0, { state: { kind: 'still_life_tissue' } });
    S('clipboard', -13.6, 0.76, -12.9, 0.4);
    S('crate_wood', -6, 0, -16.8, 0.2);
    // dispatch bay: bring-along supplies
    S('crate_wood', 18.5, 0, -16.5, 0.1);
    S('box_large', 20, 0, -16.6, -0.2);
    S('pallet', 6.5, 0, -16.5, 0);
    S('barrel', 21.2, 0, -7, 0);
    S('hand_truck', 7, 0, -8, 0.6);
    S('toolbox', 18.5, 0.6, -16.5, 0.3);
    S('fire_extinguisher', 4.4, 0, -6.6, 0);
  }

  startAudio() {
    this.amb?.stop(0.5);
    this.amb = audio.loop('ambience_lobby', { bus: 'ambient', volume: 0.8 });
    this.muzak?.stop(0.5);
    this.muzak = audio.loop('muzak', { pos: new THREE.Vector3(0, 2.6, 10), bus: 'music', volume: 0.55 });
    this.muzak2 = audio.loop('muzak', { pos: new THREE.Vector3(18, 2.6, 0), bus: 'music', volume: 0.0 });
    this.hum?.stop(0.3);
    this.hum = audio.loop('hum', { bus: 'ambient', volume: 0.25 });
  }

  // ---------------------------------------------------------------
  update(dt) {
    this.time += dt;
    const t = this.time;
    // muzak gets slightly warbly over time (uncanny)
    this.muzak?.setParam('warble', Math.min(0.6, t / 600));
    // receptionist: watches you, but only moves when nobody looks
    if (this.receptionist) {
      const g = this.game;
      let tgt = null, bd = 1e9;
      const cand = [g.local.pos, ...[...g.remotes.values()].filter((r) => r.inWorld).map((r) => r.pos)];
      for (const p of cand) { const d = p.distanceTo(this.receptionist.root.position); if (d < bd) { bd = d; tgt = p; } }
      const watched = !this.recDesk.unobserved();
      this.recLookT = Math.max(0, (this.recLookT || 0) - dt);
      this.receptionist.update(dt, { lookTarget: tgt ? tgt.clone().setY(1.1) : null, snap: !watched || this.recLookT > 0 });
    }
    if (this.recScreen && this.recScreen.time - this.recScreen.lastDraw > 0.25) {
      this.recScreen.draw(dt, (ctx, w, h, pal, tt) => {
        text(ctx, 'R.O.O.M. RECEPTION', 10, 8, 26, pal.hi);
        text(ctx, `WELCOME ${this.game.local.name.toUpperCase()}`, 10, 48, 22, pal.fg);
        text(ctx, Math.floor(tt) % 9 === 0 ? 'WE SEE YOU' : 'PLEASE WAIT', 10, 80, 22, pal.dim);
      });
    } else this.recScreen?.draw(dt, () => {});
    // clone tubes: specimens twitch / turn when unobserved
    for (const tube of this.tubes || []) {
      tube.specimen?.update?.(dt, t);
      if (tube.specimen && Math.random() < dt * 0.05 && tube.unobserved()) tube.specimen.root.rotation.y += (Math.random() - 0.5) * 2;
      if (Math.random() < dt * 4 && tube.parts.bubbleOrigin) this.world.fx.bubbles(tube.parts.bubbleOrigin.getWorldPosition(_v), 1, 0.25);
    }
    this.labLight.intensity = 2.2 + Math.sin(t * 1.7) * 0.4;
    // sinking chair (host)
    this._uncannyChair(dt);
    // dispatch door & beacons
    const ds = this.dispatchLever?.state;
    const counting = ds?.count > 0;
    const left = counting ? Math.max(0, ds.count - this.world.time) : 0;
    const open = counting && left < 6 ? 1 : 0;
    this.doorOpen = (this.doorOpen || 0) + (open - (this.doorOpen || 0)) * Math.min(1, dt * 1.5);
    const P = this.dispatchDoor?.parts || {};
    if (P.left) P.left.position.x = -this.doorOpen * 1.55;
    if (P.right) P.right.position.x = this.doorOpen * 1.55;
    for (const [i, b] of (P.beacons || []).entries()) {
      b.rotation.y += dt * (counting ? 8 : 0.0);
      void i;
    }
    this.beaconLight.intensity = counting ? 4 + Math.sin(t * 16) * 3 : 0;
    const passable = this.doorOpen > 0.8;
    this.doorCols.forEach((c) => c.setEnabled(!passable));
    if (counting) {
      engine.post.params.uGlitch.value = Math.max(0, (6 - left) / 6) * 0.35;
      if (this.doorOpen > 0.3 && Math.random() < dt * 30) this.world.fx.dustBurst(new THREE.Vector3(13 + (Math.random() - 0.5) * 3, 1.3, -17.6), 1, [0.2, 0.2, 0.25], 0.6);
    } else if (!this.game.cutscene) engine.post.params.uGlitch.value = 0;
  }

  _uncannyChair(dt) {
    if (!net.isHost || this.uncanny.chairId == null) return;
    const p = this.world.props.get(this.uncanny.chairId);
    if (!p) return;
    const u = this.uncanny;
    u.sinkT += dt;
    if (u.sinkT > 40 && !p.sinking && !p.isHeld() && this.recDesk.unobserved()) {
      this.world.props.setFrozen(p, true);
      p.sinking = { rate: 0.012 };
      u.base = p.root.position.clone();
    }
    if (p.sinking) {
      if (p.isHeld()) { p.sinking = null; this.world.props.setFrozen(p, false); u.sinkT = 0; return; }
      p.root.position.y -= p.sinking.rate * dt;
      this.world.props.forceSendIds.add(p.id);
      if (p.root.position.y < -0.9 && this.recDesk.unobserved()) {
        // pops back up as if nothing happened
        p.sinking = null;
        p.root.position.copy(u.base);
        this.world.props.setFrozen(p, false);
        this.world.props.teleport(p, u.base);
        u.sinkT = 0;
      }
    }
  }

  // ---------------------------------------------------------------
  sampleLight(pos, out) {
    out.setRGB(0, 0, 0);
    for (const l of this.lights) {
      const dx = l.x - pos.x, dy = l.y - pos.y, dz = l.z - pos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > l.radius) continue;
      const w = (1 / (1 + 0.16 * d * d)) * Math.max(0, 1 - (d / l.radius) ** 4) * 0.7;
      out.r += l.color.r * l.intensity * w;
      out.g += l.color.g * l.intensity * w;
      out.b += l.color.b * l.intensity * w;
    }
    out.r = Math.min(out.r, 1.6) + 0.03; out.g = Math.min(out.g, 1.6) + 0.03; out.b = Math.min(out.b, 1.6) + 0.03;
    return out;
  }

  surfaceAt(x, z) {
    for (const r of ROOMS) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r.floor === 'office_carpet' ? 'carpet' : r.floor === 'concrete_dark' ? 'concrete' : 'hard';
    return 'hard';
  }
  waterDepth() { return 0; }
  floorY() { return 0; }
  sampleKindAt() { return null; }

  inDispatchZone(p) { return this.dispatchZone.containsPoint(p); }

  serialize() { return { lever: this.dispatchLever?.state }; }
  applySync() {}

  onImpact() {}

  dispose() {
    this.amb?.stop(0.5);
    this.muzak?.stop(0.5);
    this.muzak2?.stop(0.5);
    this.hum?.stop(0.3);
    this.dispatchLever?.alarm?.stop(0.2);
  }
}

// ---------------------------------------------------------------------------
class DispatchLever extends ModelDevice {
  constructor(world, id, lobby) {
    super(world, id, 'dispatch_lever', {});
    this.lobby = lobby;
    this.state = { count: 0 };
    this.scr = this.screen('main', 256, 192, 'amber', 1.5);
    this.anim = 0;
    this.alarm = null;
    this.lastTick = 0;
  }
  prompt() {
    const k = input.keyName('interact');
    if (this.state.count > 0) return `[${k}] ABORT DISPATCH`;
    return `[${k}] PULL LEVER — dispatch the team into Dimension 0`;
  }
  interact() { this.send('pull'); }
  hostAction(a) {
    if (a !== 'pull') return;
    if (this.state.count > 0) {
      this.setState({ count: 0 });
      net.toAll('hq', { text: 'DISPATCH ABORTED. Please make up your minds.', from: 'DISPATCH' });
      return;
    }
    this.setState({ count: this.world.time + 12 });
    this.world.fxAll({ k: 'snd', n: 'lever', p: this.root.position.toArray(), v: 1 });
    net.toAll('hq', { text: 'DIMENSIONAL DISPATCH IN 12 SECONDS. All clones to the dispatch bay. Bring snacks.', from: 'DISPATCH' });
  }
  onState(s) {
    if (s.count > 0 && !this.alarm) {
      this.alarm = audio.loop('radio_static', { pos: this.lobby.dispatchDoor.root.position.clone().setY(2), volume: 0.6 });
      audio.play('alarm', { pos: this.root.position, volume: 1 });
    }
    if (!s.count && this.alarm) { this.alarm.stop(0.3); this.alarm = null; }
  }
  update(dt) {
    const counting = this.state.count > 0;
    this.anim += ((counting ? 1 : 0) - this.anim) * Math.min(1, dt * 6);
    if (this.parts.handle) this.parts.handle.rotation.x = -0.7 + this.anim * 1.4;
    const left = counting ? Math.max(0, this.state.count - this.world.time) : 0;
    if (counting) {
      const s = Math.ceil(left);
      if (s !== this.lastTick) {
        this.lastTick = s;
        audio.play(s <= 3 ? 'alarm' : 'countdown_tick', { pos: this.root.position, volume: 0.9 });
      }
      if (net.isHost && left <= 0 && !this.fired) {
        this.fired = true;
        // props inside the hazard zone come along
        const carry = [];
        for (const p of this.world.props.props.values()) {
          if (p.dead || !this.lobby.inDispatchZone(p.root.position)) continue;
          if (p.type === 'fish') continue;
          carry.push({ type: p.type, state: p.state, q: p.root.quaternion.toArray() });
        }
        this.world.game.hostDispatch(carry.slice(0, 24));
      }
    }
    this.scr.draw(dt, (ctx, w, h, pal, t) => {
      text(ctx, 'DISPATCH', 10, 6, 32, pal.hi);
      if (counting) {
        text(ctx, `T-${Math.ceil(left)}`, w / 2, 60, 76, Math.floor(t * 4) % 2 ? pal.bad : pal.hi, 'center');
      } else {
        text(ctx, 'DIMENSION 0', 10, 56, 26, pal.fg);
        text(ctx, 'STATUS: READY', 10, 90, 26, pal.good);
        text(ctx, 'PULL LEVER', 10, 130, 26, Math.floor(t * 2) % 2 ? pal.fg : pal.dim);
      }
    });
  }
}

function hazardTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(0, 0, 512, 512);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, 512, 512);
  ctx.rect(40, 40, 432, 432);
  ctx.clip('evenodd');
  for (let i = -512; i < 1024; i += 56) {
    ctx.fillStyle = '#e8b81c';
    ctx.beginPath();
    ctx.moveTo(i, 0); ctx.lineTo(i + 28, 0); ctx.lineTo(i + 28 - 512, 512); ctx.lineTo(i - 512, 512);
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(232,184,28,0.85)';
  ctx.font = 'bold 54px "Arial Black", Arial';
  ctx.textAlign = 'center';
  ctx.fillText('STAND HERE', 256, 250);
  ctx.font = 'bold 30px "IBM Plex Mono", monospace';
  ctx.fillText('DISPATCH ZONE', 256, 300);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function tick() { return new Promise((r) => setTimeout(r, 0)); }

export { Device, MonsterManager };
