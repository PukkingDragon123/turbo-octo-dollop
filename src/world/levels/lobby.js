// The R.O.O.M. waiting room (HQ, Sublevel B4): one very small, very dark room. A curved reception desk
// with nobody behind it, a buzzing aquarium, four waiting chairs and the dimensional elevator. Clones
// arrive by falling through a hatch in the ceiling; a trapdoor in the floor drops them elsewhere (into the
// host's room when joining a shift, into the robot pit on EXIT). Everything scripted (drop-in, the call
// panel, the shift code, the trapdoor) is played by the lobby director (world/lobby_director.js); the
// elevator itself (doors, flip board, panel, START / EXIT state) is world/hq_elevator.js.
import * as THREE from 'three';
import { engine } from '../../core/engine.js';
import { net } from '../../net/net.js';
import { audio } from '../../audio/audio.js';
import * as Mat from '../../gfx/materials.js';
import { bakedMaterial, bakeGeometry, LightField } from '../../gfx/bakedlight.js';
import { buildLobbyShell, bakeLobbyShell } from '../env/lobbyshell.js';
import { EnvGeo, fr } from '../env/builder.js';
import { Q } from '../../physics/physics.js';
import { modelHalfHeight } from '../../entities/catalog.js';
import { makeDevice } from '../../game/devicekinds.js';
import { CrtScreen, text } from '../../ui/crt.js';
import * as Critters from '../../entities/optional.js';
import { HQElevator } from '../hq_elevator.js';
import { LobbyDirector } from '../lobby_director.js';
import { CAR } from '../../entities/elevator.js';

const H = 2.75;
const T = 0.18;
const PI = Math.PI;
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
// trapdoor (floor) and drop hatch (ceiling)
const TRAP = { x0: -1.8, x1: 1.8, z0: -1.0, z1: 2.25 };
const HATCH = { x0: -0.6, x1: 0.6, z0: -0.6, z1: 0.6 };
const ROOM = {
  id: 'wait', x0: -3, z0: -2.7, x1: 3, z1: 2.7, floor: 'office_carpet', tone: 0xffdcb4,
  floorHole: TRAP, ceilHole: HATCH, grid: { nx: 1, nz: 2, sx: 3.0, sz: 2.7, cx0: 0, cz0: -1.35 },
};
const ROOMS = [ROOM];
const LIGHT_SCALE = 0.3; // "lights on" in here is still dim

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
    this.time = 0;
    this.H = H;
    this.trapCenter = new THREE.Vector3((TRAP.x0 + TRAP.x1) / 2, 0, (TRAP.z0 + TRAP.z1) / 2);
    this.trapF = 0; this.trapOpen = false; this.trapKind = null;
    this.hatchF = 0;
    this.lightK = 1;
    this.remoteY = new Map();
  }

  // ---------------------------------------------------------------
  async build(onProgress) {
    const scene = engine.scene;
    scene.background = new THREE.Color(0x010101);
    scene.fog = new THREE.FogExp2(0x040404, 0.075);
    engine.scene.environmentIntensity = 0.14;
    this.field.uniforms.uAmbient.value.setRGB(0.006, 0.006, 0.006);
    this.field.uniforms.uLightScale.value = LIGHT_SCALE;
    this.field.uniforms.uGrid.value.set(3, H - 0.04, 10, H);
    const pp = engine.post.params;
    // sodium-sick office grade: green-grey shadows, crushed blacks, heavy vignette and grain
    pp.uTint.value.setRGB(0.97, 1.0, 0.93);
    pp.uSat.value = 0.82;
    pp.uGrain.value = 0.075;
    pp.uVignette.value = 0.66;
    pp.uExposure.value = 1.0;
    pp.uLift.value.set(0.004, 0.008, 0.006);
    pp.uGamma.value.set(1.02, 1.0, 1.03);
    pp.uGain.value.set(1.0, 1.0, 0.96);
    pp.uRolloff.value = 0.3;
    pp.uContrast.value = 1.14;
    engine.renderer.toneMappingExposure = 0.95;
    pp.uGlitch.value = 0;
    this.world.customModel = (type, state) => this._customModel(type, state);
    this.world.monsters = null;
    onProgress?.(0.1, 'POWERING SUBLEVEL B4');
    this._buildShell();
    await tick();
    onProgress?.(0.4, 'INSTALLING FURNITURE');
    this._buildDevices();
    this._buildShafts();
    await tick();
    onProgress?.(0.7, 'WARMING UP CRTS');
    this._bake();
    await tick();
    this._captureElevatorProbe();
    this.director = new LobbyDirector(this);
    this.director.attach();
    onProgress?.(1, 'READY');
  }

  _captureElevatorProbe() {
    if (!this.elevatorSteel || this._elevEnv) return;
    try {
      this.field.update(this.world.time || 0);
      this._elevEnv = engine.captureEnvironment(new THREE.Vector3(0, 1.5, 1.2), 0.1, 20);
      for (const m of this.elevatorSteel) { m.envMap = this._elevEnv; m.envMapIntensity = 0.7; m.needsUpdate = true; }
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
    const R = ROOM, box = (x0, x1, y0, y1, z0, z1, u = { kind: 'static', surface: 'carpet' }) => phys.addStaticBox((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, u);
    // floor around the trapdoor, the trapdoor itself (switchable)
    const X0 = R.x0 - 0.2, X1 = R.x1 + 0.2, Z0 = R.z0 - 0.2, Z1 = R.z1 + 0.2;
    box(X0, TRAP.x0, -0.5, 0, Z0, Z1); box(TRAP.x1, X1, -0.5, 0, Z0, Z1);
    box(TRAP.x0, TRAP.x1, -0.5, 0, Z0, TRAP.z0); box(TRAP.x0, TRAP.x1, -0.5, 0, TRAP.z1, Z1);
    this.trapCol = box(TRAP.x0, TRAP.x1, -0.5, 0, TRAP.z0, TRAP.z1);
    // ceiling around the hatch; the drop shaft above it
    const s = { kind: 'static' };
    box(X0, HATCH.x0, H, H + 0.5, Z0, Z1, s); box(HATCH.x1, X1, H, H + 0.5, Z0, Z1, s);
    box(HATCH.x0, HATCH.x1, H, H + 0.5, Z0, HATCH.z0, s); box(HATCH.x0, HATCH.x1, H, H + 0.5, HATCH.z1, Z1, s);
    const SH = H + 7;
    box(HATCH.x0 - 0.2, HATCH.x0, H, SH, HATCH.z0, HATCH.z1, s); box(HATCH.x1, HATCH.x1 + 0.2, H, SH, HATCH.z0, HATCH.z1, s);
    box(HATCH.x0, HATCH.x1, H, SH, HATCH.z0 - 0.2, HATCH.z0, s); box(HATCH.x0, HATCH.x1, H, SH, HATCH.z1, HATCH.z1 + 0.2, s);
    box(HATCH.x0, HATCH.x1, SH, SH + 0.3, HATCH.z0, HATCH.z1, s);
    const P = { lower: 'panel', upper: 'paint', split: 1.0 };
    const W = [
      [R.x0, R.z1, R.x1, R.z1, P, P, [{ a: -R.x0 - CAR.GW / 2, b: -R.x0 + CAR.GW / 2, top: CAR.GH, door: 'elevator' }]],
      [R.x0, R.z0, R.x1, R.z0, P, P],
      [R.x0, R.z0, R.x0, R.z1, P, P],
      [R.x1, R.z0, R.x1, R.z1, P, P],
    ];
    this.shell = buildLobbyShell(this, ROOMS, W, H, T);
  }

  _addLight(x, z, tone, intensity, room) {
    const i = Math.floor(x / 1.5) + 40, j = Math.floor(z / 1.5) + 40;
    const key = LightField.texel(i, j);
    const l = this.field.add(key, x, H - 0.04, z, tone, intensity * 1.1, { mode: this.lights.length === 1 ? 'buzz' : 'on', radius: 8 });
    l.room = room;
    this.lights.push(l);
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

  _buildDevices() {
    // the reception desk (nobody behind it), its CRT still on
    this.recDesk = this._dev('reception_desk', 'reception_desk', 0, 0, -1.55, 0);
    if (this.recDesk.model.screens?.main?.mesh) {
      this.recScreen = new CrtScreen(256, 192, 'green');
      this.recScreen.attach(this.recDesk.model.screens.main.mesh, 1.2);
    }
    this.aquarium = this._dev('aquarium', 'aquarium', -2.55, 0, 0.25, PI / 2, { critterModels: Critters });
    this._elevator(0, ROOM.z1 - T / 2);
    // real lights: the aquarium's blue glow (the brightest thing in here) and a red bulb up the drop shaft
    const addPL = (c, i, d, x, y, z) => { const l = new THREE.PointLight(c, i, d, 2); l.position.set(x, y, z); this.world.group.add(l); return l; };
    this.aquaLight = addPL(0x58c8ff, 0, 3.6, -2.15, 1.3, 0.25);
    this.shaftLight = addPL(0xff2a14, 0.9, 5, 0, H + 4.2, 0);
  }

  _elevator(x, z) {
    const el = new HQElevator(this.world, 'hq_elevator', this);
    el.root.position.set(x, 0, z);
    el.root.rotation.y = PI; // local +z faces the room
    const L = this._roomLightsFor(new THREE.Vector3(x, 1.8, z - 1.2), 2, 0.5);
    el.setRoomLights(L.lights, L.ambient);
    el.build();
    el.car.syncLights();
    this.world.addDevice(el);
    this.elevator = el;
    this.elevatorSteel = [el.mats.steel, el.mats.brass];
  }

  _roomLightsFor(at, n = 2, k = 0.5) {
    const near = this.lights.map((l) => ({ l, d: Math.hypot(l.x - at.x, l.y - at.y, l.z - at.z) })).sort((a, b) => a.d - b.d).slice(0, n);
    const lights = near.map(({ l }) => ({ pos: new THREE.Vector3(l.x, l.y - 0.05, l.z), color: l.color.clone(), intensity: l.intensity * 2.6 * k * 2 * LIGHT_SCALE }));
    const amb = new THREE.Color();
    this.sampleLight?.(at, amb);
    amb.multiplyScalar(0.12);
    return { lights, ambient: amb };
  }

  // drop shaft above the hatch (with its two flaps), the void under the trapdoor (its two leaves are baked
  // floor, see _bake)
  _buildShafts() {
    const g = this.world.group;
    const dark = Mat.make('concrete_dark');
    dark.side = THREE.BackSide;
    const up = new THREE.Mesh(new THREE.BoxGeometry(HATCH.x1 - HATCH.x0, 7, HATCH.z1 - HATCH.z0), dark);
    up.position.set(0, H + 3.5, 0);
    g.add(up);
    const steel = Mat.make('metal_dark');
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 0.25, 0.1) }));
    bulb.position.set(0, H + 4.25, HATCH.z0 + 0.06);
    g.add(bulb);
    // ladder rungs (nobody climbs up)
    for (let k = 0; k < 9; k++) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 6), steel); r.rotation.z = PI / 2; r.position.set(0, H + 0.4 + k * 0.32, HATCH.z1 - 0.05); g.add(r); }
    // hatch flaps (hinged on the hatch's x edges, fall open downwards)
    this.flaps = [-1, 1].map((s) => {
      const piv = new THREE.Group();
      piv.position.set(s * (HATCH.x1 - HATCH.x0) / 2, H - 0.012, 0);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.598, 0.02, HATCH.z1 - HATCH.z0 - 0.01), steel);
      plate.position.x = -s * 0.3;
      piv.add(plate);
      g.add(piv);
      this.world.registerDynamic(piv);
      return { piv, s };
    });
    // under the trapdoor: a deep black shaft, a glow at the bottom (orange furnace / cold void)
    const down = new THREE.Mesh(new THREE.BoxGeometry(TRAP.x1 - TRAP.x0, 12, TRAP.z1 - TRAP.z0), dark);
    down.position.set(this.trapCenter.x, -6.02, this.trapCenter.z);
    g.add(down);
    this.pitGlowMat = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(TRAP.x1 - TRAP.x0 - 0.05, TRAP.z1 - TRAP.z0 - 0.05).rotateX(-PI / 2), this.pitGlowMat);
    glow.position.set(this.trapCenter.x, -11.9, this.trapCenter.z);
    g.add(glow);
    this.pitLight = new THREE.PointLight(0xff5a14, 0, 9, 2);
    this.pitLight.position.set(this.trapCenter.x, -1.2, this.trapCenter.z);
    g.add(this.pitLight);
    // trapdoor leaf undersides (steel, seen when they hang open)
    this.leafUnder = [];
  }

  _bake() {
    this.world.physics.world.step();
    const phys = this.world.physics;
    const lights = this.lights;
    const lightsNear = (x, z) => lights.filter((l) => Math.abs(l.x - x) < 10 && Math.abs(l.z - z) < 10);
    const ray = new THREE.Vector3(), from = new THREE.Vector3(), to = new THREE.Vector3();
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
    // the trapdoor: two baked carpet leaves hinged on its long edges + hazard-striped steel frame
    const leafMat = bakedMaterial(Mat.get('office_carpet'), this.field, 5, { grid: 2, mix: [1, 0.3] });
    const steel = Mat.make('metal_dark');
    const mid = (TRAP.x0 + TRAP.x1) / 2, w = TRAP.x1 - TRAP.x0, d = TRAP.z1 - TRAP.z0;
    this.leaves = [-1, 1].map((s) => {
      const x0 = s < 0 ? TRAP.x0 : mid + 0.004, x1 = s < 0 ? mid - 0.004 : TRAP.x1;
      const eg = new EnvGeo({ room: true });
      eg.room = 0;
      eg.grid([x0, 0.002, TRAP.z1], [x1 - x0, 0, 0], [0, 0, -d], [0, 1, 0], fr(4), fr(5), (x, y, z) => [x, z]);
      const geo = eg.build();
      bakeGeometry(geo, new THREE.Matrix4(), lightsNear, occl, null, { direct: 1, bounce: 0.3 });
      const hx = s < 0 ? TRAP.x0 : TRAP.x1;
      geo.translate(-hx, 0, 0);
      const piv = new THREE.Group();
      piv.position.set(hx, 0, 0);
      const m = new THREE.Mesh(geo, leafMat);
      m.receiveShadow = true;
      piv.add(m);
      const under = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.04, d), steel);
      under.position.set((x0 + x1) / 2 - hx, -0.021, (TRAP.z0 + TRAP.z1) / 2);
      piv.add(under);
      this.world.group.add(piv);
      return { piv, s };
    });
    void w;
    // painted hazard frame around the trapdoor
    const zg = new EnvGeo({ room: true });
    zg.room = 0;
    const b = 0.09;
    for (const [x0, z0, x1, z1] of [[TRAP.x0 - b, TRAP.z0 - b, TRAP.x1 + b, TRAP.z0], [TRAP.x0 - b, TRAP.z1, TRAP.x1 + b, TRAP.z1 + b], [TRAP.x0 - b, TRAP.z0, TRAP.x0, TRAP.z1], [TRAP.x1, TRAP.z0, TRAP.x1 + b, TRAP.z1]]) {
      zg.grid([x0, 0.004, z1], [x1 - x0, 0, 0], [0, 0, -(z1 - z0)], [0, 1, 0], fr(2), fr(2), (x, y, z) => [(x + z) * 2.2, (x - z) * 0.4]);
    }
    const zgeo = zg.build();
    bakeGeometry(zgeo, new THREE.Matrix4(), lightsNear, occl, null, {});
    const zm = new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
    const zone = new THREE.Mesh(zgeo, bakedMaterial(zm, this.field, 0, { grid: 2, mix: [1, 0.3] }));
    zone.renderOrder = 1;
    this.world.group.add(zone);
    this.field.forceRefresh();
  }

  // ---------------------------------------------------------------
  // clones arrive by falling through the ceiling hatch, one above the other
  spawnPoint(index = 0) {
    const offs = [[-0.22, -0.18], [0.24, 0.2], [0.2, -0.24], [-0.2, 0.22]];
    const o = offs[index % 4];
    return { pos: new THREE.Vector3(o[0], H + 1.6 + (index % 4) * 1.3, o[1]), yaw: PI + (Math.random() - 0.5) * 0.8, arrival: true, vy: -1 };
  }

  hostStart() {
    const S = (type, x, y, z, rotY = 0, opts = {}) => {
      const hh = modelHalfHeight(type);
      _q.setFromEuler(_e.set(opts.rx || 0, rotY, 0));
      return this.world.props.spawn(type, new THREE.Vector3(x, y + hh + 0.01, z), _q, { sleep: false, state: opts.state });
    };
    // four waiting chairs along the east wall, a side table between them
    for (const z of [-0.95, -0.3, 0.95, 1.6]) S('chair_wood', 2.45, 0, z, -PI / 2 + (Math.random() - 0.5) * 0.08);
    S('table_round', 2.4, 0, 0.32, 0);
    S('chair_office', 0, 0, -2.38, 0.35); // behind the desk, turned slightly away
  }

  startAudio() {
    this.amb?.stop(0.5);
    this.amb = audio.loop('ambience_lobby', { bus: 'ambient', volume: 0.35 });
    this.hum?.stop(0.3);
    this.hum = audio.loop('hum', { bus: 'ambient', volume: 0.32 });
  }

  // ---------------------------------------------------------------
  // room brightness 0..1 (driven by the director: black on arrival, stutters on)
  setLights(k) {
    this.lightK = k;
    this.field.uniforms.uLightScale.value = LIGHT_SCALE * k;
    this.elevator?.setLightLevel(k);
    if (this.elevator) this.elevator.panel.lampK = Math.min(1, k * 1.2);
  }
  setTint(r, g, b) { this.field.tint.setRGB(r, g, b); this.field.forceRefresh(); }

  // the floor drops open: 'join' (cold void) or 'exit' (the furnace glows up)
  openTrap(kind) {
    this.trapOpen = true;
    this.trapKind = kind;
    this.trapCol?.setEnabled(false);
    this.pitGlowMat.color.setRGB(...(kind === 'exit' ? [3, 1.0, 0.25] : [0.2, 0.7, 1.3]));
    this.pitLight.color.set(kind === 'exit' ? 0xff5a14 : 0x3a8aff);
    // whatever stands on it falls too
    for (const p of this.world.props.props.values()) {
      const q = p.root.position;
      if (q.x > TRAP.x0 && q.x < TRAP.x1 && q.z > TRAP.z0 && q.z < TRAP.z1) p.body?.wakeUp?.();
    }
  }
  closeTrapCollider() { this.trapCol?.setEnabled(true); }

  update(dt) {
    this.time += dt;
    const t = this.time, g = this.game;
    if (!this.started) {
      this.started = true;
      if (!g.menuBackdrop) this.director?.beginDrop();
      else this.setLights(1);
    }
    this.director?.update(dt);
    // the room's lights are never quite steady
    if (!this.director?.busy && this.lightK > 0.05) {
      const n = Math.sin(t * 0.7) * Math.sin(t * 2.9 + 1.3);
      const drop = n > 0.93 ? 0.45 : 1;
      this.field.uniforms.uLightScale.value = LIGHT_SCALE * this.lightK * drop * (0.97 + Math.random() * 0.03);
    }
    if (this.aquaLight) this.aquaLight.intensity = (0.15 + this.lightK * 0.9) * (0.92 + Math.sin(t * 1.3) * 0.06 + Math.sin(t * 5.1) * 0.02);
    if (this.recScreen && this.recScreen.time - this.recScreen.lastDraw > 0.3) {
      this.recScreen.draw(dt, (ctx, w, h, pal, tt) => {
        text(ctx, 'R.O.O.M. RECEPTION', 10, 8, 26, pal.hi);
        text(ctx, Math.floor(tt) % 11 === 0 ? 'WE SEE YOU' : 'PLEASE WAIT', 10, 48, 22, pal.fg);
        text(ctx, `CLONES WAITING: ${g.roster.size}`, 10, 80, 22, pal.dim);
      });
    } else this.recScreen?.draw(dt, () => {});
    // trapdoor leaves
    const tf = this.trapOpen ? 1 : 0;
    if (this.trapF !== tf) {
      const fall = this.trapOpen;
      this.trapV = (this.trapV || 0) + dt * (fall ? 14 : -6);
      this.trapF = clamp01(this.trapF + this.trapV * dt);
      if (this.trapF >= 1 && fall) { this.trapF = 1; this.trapV = -this.trapV * 0.3; if (Math.abs(this.trapV) < 0.4) this.trapV = 0; else audio.play('thunk', { pos: this.trapCenter.clone().setY(-0.6), volume: 0.6, pitch: 0.6 }); }
      if (!fall && this.trapF <= 0) this.trapV = 0;
    }
    for (const L of this.leaves || []) L.piv.rotation.z = L.s < 0 ? -this.trapF * PI * 0.48 : this.trapF * PI * 0.48;
    const glowK = this.trapF;
    this.pitLight.intensity = glowK * (this.trapKind === 'exit' ? 9 + Math.sin(t * 13) * 2 : 3);
    // hatch flaps: open while anyone is in the drop shaft, thud when they land
    let inShaft = false;
    const l = g.local;
    if (l.world && l.pos.y > H - 1.6 && Math.abs(l.pos.x) < 0.7 && Math.abs(l.pos.z) < 0.7) inShaft = true;
    for (const [id, rp] of g.remotes) {
      if (!rp.inWorld) continue;
      const p = rp.pos;
      if (p.y > H - 1.6 && Math.abs(p.x) < 0.7 && Math.abs(p.z) < 0.7) inShaft = true;
      // a teammate dropping in: thud + dust where they land
      const prev = this.remoteY.get(id);
      if (prev && prev.vy < -3.5 && p.y < 0.35 && prev.y > 0.35) {
        audio.play('crate_land', { pos: p.clone(), volume: 0.9 });
        audio.play('robo_clunk', { pos: p.clone(), volume: 0.6 });
        this.world.fx.dustBurst(p.clone().setY(0.1), 20, [0.5, 0.48, 0.42], 1.1);
        if (l.world && l.pos.distanceTo(p) < 4.5) { g.juice?.shake?.(0.25); }
      }
      this.remoteY.set(id, { y: p.y, vy: prev ? (p.y - prev.y) / Math.max(dt, 1e-3) : 0 });
    }
    const hf = inShaft ? 1 : 0;
    if (hf && this.hatchF < 0.05) audio.play('door_heavy_open', { pos: new THREE.Vector3(0, H, 0), volume: 0.7, pitch: 1.4 });
    this.hatchF += (hf - this.hatchF) * Math.min(1, dt * (hf ? 14 : 1.8));
    for (const f of this.flaps || []) f.piv.rotation.z = f.s * this.hatchF * PI * 0.47;
    this.shaftLight.intensity = 0.4 + Math.abs(Math.sin(t * 2.1)) * 0.6;
    if (!this.game.cutscene && !this.game.ride) engine.post.params.uGlitch.value = 0;
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
    out.r = Math.min(out.r, 1.6) + 0.01; out.g = Math.min(out.g, 1.6) + 0.01; out.b = Math.min(out.b, 1.6) + 0.012;
    return out;
  }

  surfaceAt() { return 'carpet'; }
  waterDepth() { return 0; }
  floorY() { return 0; }
  sampleKindAt() { return null; }
  serialize() { return null; }
  applySync() {}
  onImpact() {}

  dispose() {
    this.director?.dispose();
    this._elevEnv?.dispose();
    this._elevEnv = null;
    this.amb?.stop(0.5);
    this.hum?.stop(0.3);
    this.field.tint.setRGB(1, 1, 1);
    const pp = engine.post.params;
    pp.uExposure.value = 1; pp.uLift.value.set(0, 0, 0); pp.uGamma.value.set(1, 1, 1); pp.uGain.value.set(1, 1, 1); pp.uRolloff.value = 0; pp.uContrast.value = 1.04;
    engine.renderer.toneMappingExposure = 1;
  }
}

function stripeTexture() {
  const S = 256, c = document.createElement('canvas');
  c.width = S; c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = '#141412'; x.fillRect(0, 0, S, S);
  for (let i = -S; i < S * 2; i += 64) { x.fillStyle = '#c9971a'; x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 32, 0); x.lineTo(i + 32 - S, S); x.lineTo(i - S, S); x.fill(); }
  for (let k = 0; k < 900; k++) { x.fillStyle = `rgba(20,20,18,${0.2 + Math.random() * 0.5})`; x.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 4, 1 + Math.random() * 3); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function tick() { return new Promise((r) => setTimeout(r, 0)); }
