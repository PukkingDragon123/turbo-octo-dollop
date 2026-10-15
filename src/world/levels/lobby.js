// The R.O.O.M. underground office (lobby): reception with GLORIA, the android receptionist, and the
// dimensional elevator; open-plan office, locker room with a mirror, break room (vending, water cooler,
// aquarium, darts, couch & TV), cloning laboratory and the loading bay. Talk to the receptionist to be
// dispatched: she opens the elevator gate, and everyone inside the car when it closes rides it to the
// next dimension. Slightly uncanny: chairs sink, posters and clocks change when nobody is looking, the
// receptionist turns to stare at you whenever nobody is looking at her.
import * as THREE from 'three';
import { engine } from '../../core/engine.js';
import { net } from '../../net/net.js';
import { audio } from '../../audio/audio.js';
import * as Mat from '../../gfx/materials.js';
import { bakedMaterial, bakeGeometry, LightField } from '../../gfx/bakedlight.js';
import { buildLobbyShell, bakeLobbyShell } from '../env/lobbyshell.js';
import { EnvGeo, fr } from '../env/builder.js';
import { Q } from '../../physics/physics.js';
import { buildModel, modelHalfHeight } from '../../entities/catalog.js';
import { makeDevice } from '../../game/devicekinds.js';
import { Device } from '../../game/devices.js';
import { CrtScreen, text } from '../../ui/crt.js';
import { LORE } from '../../game/lore.js';
import { buildUnfinishedClone } from '../../entities/optional.js';
import * as Critters from '../../entities/optional.js';
import { MonsterManager } from '../../game/monsters.js';
import { ReceptionistBot } from '../../entities/receptionist.js';
import { HQElevator } from '../hq_elevator.js';
import { CAR } from '../../entities/elevator.js';

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
    scene.fog = new THREE.FogExp2(0x2a2a26, 0.014);
    engine.scene.environmentIntensity = 0.26;
    this.field.uniforms.uAmbient.value.setRGB(0.02, 0.02, 0.019);
    this.field.uniforms.uLightScale.value = 0.5;
    this.field.uniforms.uGrid.value.set(3, H - 0.04, 10, H);
    const pp = engine.post.params;
    pp.uTint.value.setRGB(1.0, 0.99, 0.97);
    pp.uSat.value = 0.95;
    pp.uGrain.value = 0.04;
    pp.uVignette.value = 0.42;
    // corporate fluorescent grade: neutral-cool, soft toe, gentle highlight roll-off
    pp.uExposure.value = 0.98;
    pp.uLift.value.set(0.012, 0.014, 0.016);
    pp.uGamma.value.set(1.0, 1.0, 1.01);
    pp.uGain.value.set(0.99, 1.0, 1.0);
    pp.uRolloff.value = 0.3;
    pp.uContrast.value = 1.07;
    engine.renderer.toneMappingExposure = 0.92;
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
    this._captureElevatorProbe();
    onProgress?.(1, 'READY');
  }

  // one-off local reflection probe of the lit reception for the elevator's brushed steel
  _captureElevatorProbe() {
    if (!this.elevatorSteel || this._elevEnv) return;
    try {
      this.field.update(this.world.time || 0);
      this._elevEnv = engine.captureEnvironment(new THREE.Vector3(0, 1.5, 13.6), 0.1, 40);
      for (const m of this.elevatorSteel) {
        m.envMap = this._elevEnv;
        m.envMapIntensity = 1.0;
        m.needsUpdate = true;
      }
    } catch (e) { /* keeps the scene environment */ }
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
    const phys = this.world.physics;
    // floors & ceilings colliders per room
    for (const r of ROOMS) {
      const w = r.x1 - r.x0, d = r.z1 - r.z0;
      phys.addStaticBox((r.x0 + r.x1) / 2, -0.25, (r.z0 + r.z1) / 2, w / 2 + 0.2, 0.25, d / 2 + 0.2, { kind: 'static', surface: r.floor === 'office_carpet' ? 'carpet' : r.floor === 'concrete_dark' ? 'concrete' : 'hard' });
      phys.addStaticBox((r.x0 + r.x1) / 2, H + 0.25, (r.z0 + r.z1) / 2, w / 2 + 0.2, 0.25, d / 2 + 0.2, { kind: 'static' });
    }
    // walls: [x0,z0,x1,z1, matA (left/-normal side), matB, openings[{a,b,top}]]
    const P = { panel: { lower: 'panel', upper: 'paint', split: 1.0 }, tile: { lower: 'tile', upper: 'paint_white', split: 1.3 }, labt: { lower: 'tile_green', upper: 'paint_white', split: 1.3 } };
    const W = [
      // reception (x -7..7, z 6..16)
      [-7, 16, 7, 16, P.panel, null, [{ a: 7 - CAR.GW / 2, b: 7 + CAR.GW / 2, top: CAR.GH, door: 'elevator' }]],
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
    this.shell = buildLobbyShell(this, ROOMS, W, H, T);
  }

  _addLight(x, z, tone, intensity, room) {
    const i = Math.floor(x / 1.5) + 40, j = Math.floor(z / 1.5) + 40;
    const key = LightField.texel(i, j);
    const l = this.field.add(key, x, H - 0.04, z, tone, intensity, { mode: 'on', radius: 10 });
    l.room = room;
    this.lights.push(l);
    (this.panelKeys = this.panelKeys || []).push({ key, x, z });
    return l;
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
    // GLORIA: the android receptionist (talk to her to be dispatched), lit by the two troffers above her
    {
      const rp = this.recDesk.anchors.receptionist;
      const at = new THREE.Vector3(rp ? rp.x : 0, 0, rp ? 10.2 + rp.z : 9.4);
      this.receptionist = new ReceptionistBot(this.world, 'receptionist', { lobby: this, ...this._roomLightsFor(at.clone().setY(1.3), 2, 0.55) });
      this.receptionist.root.position.copy(at);
      this.receptionist.build();
      this.world.addDevice(this.receptionist);
    }
    const bellA = this.recDesk.anchors.bell;
    this._dev('service_bell', 'bell', bellA ? bellA.x : 0.6, bellA ? bellA.y : 1.05, bellA ? 10.2 + bellA.z : 10.6, 0, { onRing: () => this._receptionistSnap() });
    if (this.recDesk.model.screens?.main?.mesh) {
      this.recScreen = new CrtScreen(256, 192, 'green');
      this.recScreen.attach(this.recDesk.model.screens.main.mesh, 1.2);
    }
    this._dev('employee_of_month', 'eotm', 6.909, 1.6, 11, -Math.PI / 2, { renderPortrait: (c, wrong) => this.game.ui.portrait?.(c, wrong) });
    this._dev('wall_clock', 'clock_rec', -6.909, 2.15, 11, Math.PI / 2);
    this._dev('poster', 'poster_r1', -6.911, 1.5, 8.2, Math.PI / 2, { texts: L.posters.slice(0, 3), creepy: L.creepy, color: '#3a5a8a' });
    this._dev('poster', 'poster_r2', 6.911, 1.5, 14.2, -Math.PI / 2, { texts: L.posters.slice(3), creepy: L.creepy, color: '#8a3a3a' });
    this._static('plant_pot', -6.3, 0, 15.3, 0);
    this._static('plant_pot', 6.25, 0, 7, 1, true, { seed: 244 }); // foliage clear of the east wall
    this._static('exit_sign', -4.2, 2.61, 15.909, Math.PI, false);
    // the dimensional elevator on the south wall (opened by the receptionist)
    this._elevator(0, 16 - T / 2);
    // --- Office ---
    this._dev('crt_terminal', 'term_shift', -8.52, 0.762, -3.5, Math.PI / 2, { program: 'shift', palette: 'green' });
    this._dev('crt_terminal', 'term_howto', 8.52, 0.762, 3.0, -Math.PI / 2, { program: 'howto', palette: 'amber' });
    this._dev('crt_terminal', 'term_ach', -3.2, 0.762, -5.16, 0, { program: 'achievements', palette: 'green' });
    this._static('desk', -8.6, 0, -3.5, Math.PI / 2);
    this._static('desk', 8.6, 0, 3.0, -Math.PI / 2);
    this._static('desk', -3.2, 0, -5.25, 0);
    this._dev('water_cooler', 'cooler_office', 11.4, 0, -4.8, -Math.PI / 2);
    this._dev('poster', 'poster_o1', 0, 1.6, -5.911, 0, { texts: [L.posters[1], L.posters[4]], creepy: L.creepy, color: '#2a6a4a' });
    this._dev('wall_clock', 'clock_off', 4, 2.2, -5.909, 0);
    this._dev('server_rack', 'rack1', -11.4, 0, 4.6, Math.PI / 2);
    // --- Locker room ---
    this._dev('locker_bank', 'lockers', -21.65, 0, 0, Math.PI / 2, { count: 8 });
    this._dev('mirror', 'mirror', -17, 1.45, -5.909, 0, { width: 1.2, height: 1.6 });
    this._dev('poster', 'poster_l1', -12.089, 1.5, 3.8, -Math.PI / 2, { texts: [L.posters[2]], creepy: L.creepy, color: '#5a3a7a' });
    // --- Break room ---
    this._dev('vending_snack', 'vend_snack', 15.2, 0, -5.45, 0);
    this._dev('vending_drink', 'vend_drink', 16.5, 0, -5.45, 0);
    this._dev('water_cooler', 'cooler_break', 18.2, 0, -5.6, 0);
    this._dev('coffee_machine', 'coffee', 21.3, 0.762, -5.55, 0);
    this._static('table_folding', 21.3, 0, -5.5, 0);
    this._dev('fridge', 'fridge', 23.45, 0, -4.2, -Math.PI / 2);
    this._dev('aquarium', 'aquarium', 23.55, 0, 1.8, -Math.PI / 2, { critterModels: Critters });
    this.dartBoard = this._dev('dart_board', 'darts', 18, 1.73, 5.9, Math.PI, {
      scoreboard: { redraw: (st) => this._drawScoreboard(st) },
    });
    this._scoreboard(15.6, 5.9);
    this.tv = this._dev('creepy_tv', 'tv_break', 13.0, modelHalfHeight('tv_crt'), 0.5, Math.PI / 2, { mode: 'training' }); // console TV: centred model, stands on its feet
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
    this._dev('crt_terminal', 'term_records', -5.08, 0.762, -9.5, -Math.PI / 2, { program: 'records', palette: 'cyan', lore: 0 });
    this._static('desk', -5, 0, -9.5, -Math.PI / 2);
    // --- Loading bay (the old dispatch bay: its blast door stays sealed; dispatch is by elevator now) ---
    this.dispatchDoor = this._dev('dispatch_door', 'dispatch_door', 13, 0, -17.9, 0, { collide: false });
    this._static('hazard_sign', 9.5, 1.4, -17.909, 0, false);
    this._static('fuse_box', 21.909, 1.3, -10, -Math.PI / 2, false);
    this._static('fire_alarm', 4.091, 1.5, -12, Math.PI / 2, false);
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

  // the dimensional elevator: landing doors in the south wall, the car behind it (see world/hq_elevator.js)
  _elevator(x, z) {
    const el = new HQElevator(this.world, 'hq_elevator', this);
    el.root.position.set(x, 0, z);
    el.root.rotation.y = Math.PI; // local +z faces the reception
    const L = this._roomLightsFor(new THREE.Vector3(x, 1.8, z - 1.2), 2, 0.5);
    el.setRoomLights(L.lights, L.ambient);
    el.build();
    el.car.syncLights();
    this.world.addDevice(el);
    this.elevator = el;
    // landing steel + brass get the reception's reflection probe once the room is lit
    this.elevatorSteel = [el.mats.steel, el.mats.brass];
  }

  // nearest ceiling lights of the lobby as virtual key lights for hand-lit set pieces
  _roomLightsFor(at, n = 2, k = 0.5) {
    const near = this.lights.map((l) => ({ l, d: Math.hypot(l.x - at.x, l.y - at.y, l.z - at.z) })).sort((a, b) => a.d - b.d).slice(0, n);
    const lights = near.map(({ l }) => ({ pos: new THREE.Vector3(l.x, l.y - 0.05, l.z), color: l.color.clone(), intensity: l.intensity * 2.6 * k * 2 }));
    const amb = new THREE.Color();
    this.sampleLight?.(at, amb);
    amb.multiplyScalar(0.16);
    return { lights, ambient: amb };
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

  // the service bell makes her look up at whoever rang it
  _receptionistSnap() {
    const r = this.receptionist;
    if (r) { r.attend = 1; r.anim.twitch = { t: 0, dir: 1 }; }
  }

  _bake() {
    // make sure the ray queries see all static colliders
    this.world.physics.world.step();
    const phys = this.world.physics;
    const lights = this.lights;
    const lightsNear = (x, z) => lights.filter((l) => Math.abs(l.x - x) < 10 && Math.abs(l.z - z) < 10);
    const ray = new THREE.Vector3();
    const from = new THREE.Vector3(), to = new THREE.Vector3();
    const occl = (x0, z0, x1, z1, y0) => {
      from.set(x0, Math.min(y0 ?? 1.2, H - 0.12), z0);
      to.set(x1, H - 0.12, z1);
      ray.subVectors(to, from);
      const d = ray.length();
      if (d < 0.05) return 1;
      ray.divideScalar(d);
      const hit = phys.raycast(from, ray, d - 0.05, Q.world);
      return hit ? 0.08 : 1;
    };
    bakeLobbyShell(this, this.shell, ROOMS, lightsNear, occl, H);
    // dispatch floor zone (hazard stripes), lit like the floor around it
    const zg = new EnvGeo({ room: true });
    zg.room = ROOMS.findIndex((r) => r.id === 'dispatch');
    zg.grid([10, 0.004, -12.1], [6, 0, 0], [0, 0, -5], [0, 1, 0], fr(4), fr(4), (x, y, z) => [(x - 10) / 6, (-12.1 - z) / 5]);
    const zgeo = zg.build();
    bakeGeometry(zgeo, new THREE.Matrix4(), lightsNear, occl, null, { exclude: (l) => l.roomIndex === zg.room });
    const zm = new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.78, polygonOffset: true, polygonOffsetFactor: -2 });
    zm.name = 'hazard_zone';
    const zone = new THREE.Mesh(zgeo, bakedMaterial(zm, this.field, 0, { grid: 2, mix: [1, 0.3] }));
    zone.receiveShadow = true;
    zone.renderOrder = 1;
    this.world.group.add(zone);
    this.field.forceRefresh();
  }

  // ---------------------------------------------------------------
  // everyone arrives at HQ in the elevator car (its gate opens on load) and steps out into reception
  spawnPoint(index = 0) {
    const offs = [[-0.5, 0.45], [0.5, 0.45], [-0.5, -0.35], [0.5, -0.35]];
    const o = offs[index % 4];
    const car = this.elevator?.car;
    if (!car) return { pos: new THREE.Vector3(o[0], 0.02, 13.6), yaw: 0, arrival: false };
    car.root.updateMatrixWorld(true);
    const pos = car.root.localToWorld(new THREE.Vector3(o[0], 0.02, o[1]));
    return { pos, yaw: 0, arrival: false };
  }

  hostStart() {
    const S = (type, x, y, z, rotY = 0, opts = {}) => {
      const hh = modelHalfHeight(type);
      _q.setFromEuler(_e.set(opts.rx || 0, rotY, 0));
      // not pre-slept: a body put to sleep the moment it is created skips contact generation for its first
      // steps, plunges ~5 cm into whatever it rests on and pops back up, which knocked keyboards, darts and
      // the lab clipboard through their tables. Awake, everything settles from the 1 cm drop in ~0.7 s.
      return this.world.props.spawn(type, new THREE.Vector3(x, y + hh + 0.01, z), _q, { sleep: false, state: opts.state });
    };
    // reception waiting area (one of these chairs likes to sink)
    for (let k = 0; k < 4; k++) S('chair_wood', -6.2, 0, 8.4 + k * 0.9, Math.PI / 2);
    this.uncanny.chairId = S('chair_wood', -5.2, 0, 14.2, 2.4)?.id;
    S('table_round', -5.4, 0, 12.2, 0);
    S('paper_stack', -5.4, 0.73, 12.2, 0.4);
    S('chair_office', 0, 0, 9.36, 0); // under the receptionist, backrest behind her (not through her)
    S('trash_can', 2.4, 0, 9.5, 0);
    S('wet_floor_sign', 3.2, 0, 13.5, 0.6);
    // office cubicles
    for (let k = 0; k < 4; k++) {
      const x = -5.5 + (k % 2) * 6, z = -1.8 + Math.floor(k / 2) * 4;
      S('desk_cubicle_panel', x, 0, z - 0.62, 0); // against the desk's back edge
      S('desk', x, 0, z, 0);  // workstation faces the chair on +Z
      S('chair_office', x + 0.1, 0, z + 0.85, Math.PI + 0.3 * (k - 1.5));
      S('crt_monitor', x - 0.15, 0.76, z - 0.15, 0);
      S('keyboard', x - 0.15, 0.76, z + 0.22, 0);
      S(['mug', 'desk_phone', 'binder', 'lamp_desk'][k], x + 0.55, 0.76, z - 0.1, k);
    }
    S('filing_cabinet', -11.5, 0, -5.4, Math.PI / 2);
    S('filing_cabinet', -11.5, 0, -4.7, Math.PI / 2);
    S('printer', 10.8, 0, 1.5, -Math.PI / 2);
    S('whiteboard', 4, 0, 4.9, Math.PI);
    S('plant_pot', -11.3, 0, 5.42, 0); // clear of the server rack
    S('office_divider_plant', 2.35, 0, 1.58, 0); // continues the cubicle partition line
    S('box_medium', 9.8, 0, -5.2, 0.2);
    S('box_small', 9.9, 0.326, -5.2, -0.3); // stacked on the medium box (0.326 m)
    S('traffic_cone', 5.5, 0, -4.8, 0);
    S('rubber_duck', -3.8, 0.76, -5.05, 0.4); // free desk corner, not on the keyboard
    // locker room
    S('stool', -18, 0, 0, 0);
    S('stool', -16.5, 0, 0.8, 0);
    S('basketball', -15, 0, 3, 0);
    S('suitcase', -13.5, 0, 5.2, 0.3);
    S('coat_rack', -13, 0, -5.2, 0);
    // break room
    S('couch', 15.4, 0, 0.5, -Math.PI / 2);
    S('table_round', 19, 0, -1.6, 0);
    S('table_round', 19, 0, 2.2, 0);
    for (const [x, z, r] of [[18.2, -1.6, 1.4], [19.8, -1.6, -1.4], [18.2, 2.2, 1.6], [19.8, 2.2, -1.6]]) S('chair_folding', x, 0, z, r);
    S('mug', 19, 0.73, -1.6, 0);
    S('microwave', 21.6, 0.76, 5.5, Math.PI);
    S('table_folding', 21.6, 0, 5.5, 0);
    S('table_folding', 18, 0, 3.8, 0);
    for (let k = 0; k < 6; k++) S('dart', 17.6 + k * 0.15, 0.762, 3.8, Math.PI); // darts lie flat on the table
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
    S('toolbox', 18.5, 0.5, -16.5, 0.3); // on the crate lid
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
    // loading bay beacons spin while the elevator counts down (the blast door stays sealed)
    const counting = this.elevator?.state.ph === 'board';
    const P = this.dispatchDoor?.parts || {};
    for (const r of P.beaconReflectors || []) r.rotation.y += dt * (counting ? 9 : 0);
    for (const l of P.beaconLamps || []) {
      if (!l.material) continue;
      if (!l.userData.own) { l.material = l.material.clone(); l.userData.own = true; }
      l.material.emissiveIntensity = counting ? 4 : 0.15;
    }
    this.beaconLight.intensity = counting ? 4 + Math.sin(t * 16) * 3 : 0;
    if (!this.game.cutscene && !this.game.ride) engine.post.params.uGlitch.value = 0;
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

  // START / dispatch request from UI (lobby waiting panel): exactly like confirming with the receptionist.
  // Host: opens the elevator gate and starts the countdown; client: asks the host. Returns false if busy.
  requestDispatch(name) {
    const ph = this.elevator?.state.ph;
    if (!this.receptionist || ph === 'board' || ph === 'depart') return false;
    return this.receptionist.requestDispatch(name);
  }

  serialize() { return null; }
  applySync() {}

  onImpact() {}

  dispose() {
    this._elevEnv?.dispose();
    this._elevEnv = null;
    this.amb?.stop(0.5);
    this.muzak?.stop(0.5);
    this.muzak2?.stop(0.5);
    this.hum?.stop(0.3);
    const pp = engine.post.params;
    pp.uExposure.value = 1; pp.uLift.value.set(0, 0, 0); pp.uGamma.value.set(1, 1, 1); pp.uGain.value.set(1, 1, 1); pp.uRolloff.value = 0; pp.uContrast.value = 1.04;
    engine.renderer.toneMappingExposure = 1;
  }
}

function hazardTexture() {
  // floor-paint dispatch marking: safety-yellow chevrons and stencil text on sealed concrete, scuffed by
  // carts and boots, chipped at the stripe edges, darker in the traffic lane
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  let seed = 1337;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  ctx.fillStyle = '#3a3936';
  ctx.fillRect(0, 0, S, S);
  // mottled sealer
  for (let k = 0; k < 900; k++) {
    ctx.fillStyle = `rgba(${rnd() < 0.5 ? '20,20,18' : '90,88,82'},${0.03 + rnd() * 0.05})`;
    ctx.beginPath(); ctx.ellipse(rnd() * S, rnd() * S, 10 + rnd() * 60, 6 + rnd() * 40, rnd() * 3, 0, 7); ctx.fill();
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, S, S);
  ctx.rect(80, 80, S - 160, S - 160);
  ctx.clip('evenodd');
  for (let i = -S; i < S * 2; i += 112) {
    ctx.fillStyle = '#d9a91c';
    ctx.beginPath();
    ctx.moveTo(i, 0); ctx.lineTo(i + 56, 0); ctx.lineTo(i + 56 - S, S); ctx.lineTo(i - S, S);
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(217,169,28,0.9)';
  ctx.font = 'bold 108px "Arial Black", Arial';
  ctx.textAlign = 'center';
  ctx.fillText('LOADING', S / 2, S * 0.49);
  ctx.font = 'bold 60px "IBM Plex Mono", monospace';
  ctx.fillText('CARGO \u2192 ELEVATOR', S / 2, S * 0.59);
  // wear: chipped paint (sealer showing through), boot scuffs, a darker trafficked lane
  for (let k = 0; k < 2600; k++) {
    const x = rnd() * S, y = rnd() * S, r = 1 + rnd() * rnd() * 7;
    ctx.fillStyle = `rgba(52,51,48,${0.5 + rnd() * 0.5})`;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.4 + rnd()), rnd() * 3, 0, 7); ctx.fill();
  }
  for (let k = 0; k < 260; k++) {
    ctx.strokeStyle = `rgba(16,15,14,${0.05 + rnd() * 0.12})`;
    ctx.lineWidth = 2 + rnd() * 10;
    const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI, l = 20 + rnd() * 90;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (rnd() - 0.5) * 20, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, 'rgba(10,10,9,0.18)'); g.addColorStop(0.5, 'rgba(10,10,9,0.04)'); g.addColorStop(1, 'rgba(10,10,9,0.2)');
  ctx.fillStyle = g;
  ctx.fillRect(S * 0.3, 0, S * 0.4, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function tick() { return new Promise((r) => setTimeout(r, 0)); }

export { Device, MonsterManager };
