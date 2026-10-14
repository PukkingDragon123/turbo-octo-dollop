// Level 1.1 — The Grasslands. An endless, subtly wrong mountain river valley: golden meadows, conifer
// forest, granite cliffs and a fast turquoise river under a low sun that sinks a little more every day.
// Plugs into the game exactly like the Yellow Rooms: 3 m gameplay cells in 8x8-cell chunks (mission,
// nav, monsters, critters and anomalies all work through cell()/passable()), streamed physics chunks
// (heightfield + trunks + boulders + structures) around every player, and a camera-centred visual
// world (quadtree terrain, grass, trees, water, sky) that reaches the horizon.
import * as THREE from 'three';
import { engine } from '../../../core/engine.js';
import { net } from '../../../net/net.js';
import { audio } from '../../../audio/audio.js';
import { profile } from '../../../core/profile.js';
import { hash01, hash3, RNG } from '../../../core/rng.js';
import { modelHalfHeight } from '../../../entities/catalog.js';
import { Mission } from '../../../game/mission.js';
import { MonsterManager } from '../../../game/monsters.js';
import { Anomalies } from '../../../game/anomalies.js';
import { Critters } from '../../../game/critters.js';
import { SAMPLES } from '../../../game/itemdefs.js';
import { GridNav } from '../../nav.js';
import { GrassWorld, CELL, CHUNK, CHUNK_M, WATER_Y, SKY_DROP, DIRS, Z } from './layout.js';
import { TerrainLOD, chunkCollider } from './terrain.js';
import { GrassSky } from './sky.js';
import { TreeSystem } from './trees.js';
import { GrassSystem } from './grass.js';
import { RockSystem } from './rocks.js';
import { WaterSystem } from './water.js';
import { terrainUniforms } from './terrain.js';
import { Structures, slabMaterial } from './structures.js';
import { patchInteriorObject, unpatchAllInterior, setInteriors, interiorUniforms } from './interior.js';
import { buildProxy, disposeProxy, stateSig } from './proxy.js';
import { GrassAnomalies } from './gl_anomalies.js';
import { registerGrassAudio } from './gaudio.js';
import { MistSystem } from './mist.js';
import { sstep } from './noise.js';

const LOAD_R = 2;
const UNLOAD_R = 3;
const _v = new THREE.Vector3();
const _c = new THREE.Color();
const _q = new THREE.Quaternion();

// grassland research samples (added to the shared registry once)
Object.assign(SAMPLES, {
  meadow_static: { name: 'Static-Charged Grass', color: 0xc8b45a, credits: 30 },
  river_water: { name: 'Anomalous River Water', color: 0x5fb8b0, credits: 40 },
  pine_resin: { name: 'Weeping Resin', color: 0x8a5a1a, credits: 45 },
  granite_lichen: { name: 'Repeating Lichen', color: 0x9a9a52, credits: 40 },
});

export class GrasslandsLevel {
  constructor(world, desc) {
    this.world = world;
    this.game = world.game;
    this.desc = desc;
    this.seed = desc.seed >>> 0;
    this.depth = desc.depth || 1;
    this.name = 'LEVEL 1.1 — THE GRASSLANDS';
    this.feedName = 'LEVEL 1.1: THE GRASSLANDS';
    this.field = world.field;
    this.gw = new GrassWorld(this.seed);
    this.chunks = new Map();
    this.populated = new Set();
    this.variants = new Map();
    this.variantFn = (cx, cz) => this.variants.get(`${cx},${cz}`) || 0;
    this.gw._vfn = this.variantFn;
    this.missionChunks = this.gw.mission;
    this.nav = new GridNav(this);
    this.visited = new Set();
    this.reverb = 'none';
    this.time = 0;
    this.crates = new Map(); // host: supply crates on their way down
    this.sunCache = new Map();
    this.sunKey = '';
    this.debugT = null;
    this.proxies = new Map(); // device -> distance proxy record
  }

  // ---------------------------------------------------------------
  async build(onProgress) {
    const scene = engine.scene;
    const step = async (p, label) => { onProgress?.(p, `LEVEL 1.1 — THE GRASSLANDS · ${label}`); await new Promise((r) => setTimeout(r, 0)); };
    this._saved = { far: engine.camera.far, bg: scene.background, fog: scene.fog };
    scene.background = new THREE.Color(0x8aa0b4);
    scene.fog = null;
    engine.camera.far = 2600;
    engine.camera.updateProjectionMatrix();
    // probes stay dark: everything outdoors is lit by the real sun + sky IBL
    this.field.uniforms.uLightScale.value = 0;
    this.field.uniforms.uAmbient.value.setRGB(0, 0, 0);
    const P = engine.post.params;
    P.uTint.value.setRGB(1.0, 0.99, 0.97);
    P.uGrain.value = 0.045;
    P.uVignette.value = 0.38;
    P.uContrast.value = 1.05;
    await step(0.05, 'GROWING MEADOWS');
    this.sky = new GrassSky(this);
    const h = this.gw.hero;
    this.sky.setSunAzimuth(Math.atan2(h.lipX - this.gw.spawn.x, h.lipZ - this.gw.spawn.z) + 0.25);
    this.world.group.add(this.sky.group);
    this.world.monsters = this.monsters = new MonsterManager(this);
    this.mission = new Mission(this);
    this.anomalies = new Anomalies(this);
    this.critters = new Critters(this);
    await step(0.15, 'SURVEYING TERRAIN');
    this.terrain = new TerrainLOD(this);
    this.world.group.add(this.terrain.group);
    const c = this.spawnCenter();
    this.terrain.update(c, 0, true);
    await step(0.3, 'PLANTING THE FOREST');
    this.trees = new TreeSystem(this);
    this.world.group.add(this.trees.group);
    this.trees.forceBuild = true;
    this.trees.update(0.016, c, this.sky);
    this.trees.forceBuild = false;
    await step(0.36, 'SPLITTING GRANITE');
    this.rocks = new RockSystem(this);
    this.world.group.add(this.rocks.group);
    this.rocks.force = true;
    this.rocks.update(0.016, c);
    this.rocks.force = false;
    await step(0.38, 'FILLING THE RIVER');
    this.water = new WaterSystem(this);
    this.world.group.add(this.water.group);
    this.water.force = true;
    this.water.update(0.016, c, this.sky);
    this.water.force = false;
    this.mist = new MistSystem(this);
    this.world.group.add(this.mist.mesh);
    await step(0.4, 'GROWING GRASS');
    this.grass = new GrassSystem(this);
    this.world.group.add(this.grass.group);
    this.grass.update(0.016, c, this.sky, []);
    await step(0.44, 'POURING CONCRETE');
    this.structures = new Structures(this);
    this.structures.build();
    this.world.group.add(this.structures.group);
    patchInteriorObject(this.structures.group);
    for (const v of this.structures.vents) this.critters.addVent(v.pos, null, v.inside);
    this.oddities = new GrassAnomalies(this);
    registerGrassAudio();
    await step(0.45, 'PLACING THE VALLEY');
    const need = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) need.push([dx, dz]);
    for (let i = 0; i < need.length; i++) {
      this._buildChunk(need[i][0], need[i][1]);
      await step(0.45 + 0.4 * ((i + 1) / need.length), 'PLACING THE VALLEY');
    }
    this.mission.build();
    for (const g of this.mission.generators) patchInteriorObject(g.root);
    for (const d of this.structures.devices) if (d.root) patchInteriorObject(d.root);
    // machines swap to merged proxies past a few metres (the two shed generators stand under a roof: no sun
    // shadow, and only visible through the open south side)
    for (const g of this.mission.generators) {
      const st = (g.id === 'gen_diesel' || g.id === 'gen_mech') && this.gw.structures.find((x) => x.kind === g.id);
      if (st) g.root.traverse((o) => { if (o.isMesh) o.castShadow = false; });
      this.registerProxy(g, {
        near: 12, far: 56, shadows: !st,
        blind: st ? (cam) => cam.z < st.z1 - 0.3 && !(cam.x > st.x0 - 0.5 && cam.x < st.x1 + 0.5 && cam.z > st.z0 - 0.5) : null,
      });
    }
    for (const d of this.structures.devices) if (d.root) this.registerProxy(d, { near: 10, far: 50, shadows: false });
    this._interiorList = [...this.structures.interiors];
    setInteriors(this._interiorList);
    this.sky.update(0.016, this._dayT(), c);
    await step(1, 'SUNLIGHT');
  }

  spawnCenter() { return new THREE.Vector3(this.gw.spawn.x, 0, this.gw.spawn.z); }

  spawnPoint(index = 0, lateJoin = false, arrival = false) {
    const c = this.spawnCenter();
    const offs = [[-1.4, -1.2], [1.4, -1.2], [-1.4, 1.3], [1.4, 1.3]];
    const o = offs[index % 4];
    const x = c.x + o[0], z = c.z + o[1];
    const g = this.groundAt(x, z);
    const sky = arrival || lateJoin;
    const pos = new THREE.Vector3(x, sky ? g + SKY_DROP + (index % 4) * 2.2 : g + 0.05, z);
    return { pos, yaw: Math.atan2(o[0], o[1]), arrival: sky, vy: sky ? -6 : 0 };
  }

  hostStart(desc) {
    const before = new Set(this.world.props.props.keys());
    this.mission.hostStart(desc);
    // the mission spawns its kit as if under a ceiling: re-seat everything on the meadow, drop the box from the sky
    const c = this.spawnCenter();
    let carried = 0;
    for (const p of this.world.props.props.values()) {
      if (before.has(p.id)) continue;
      const pos = p.root.position.clone();
      const g = this.groundAt(pos.x, pos.z);
      const hh = modelHalfHeight(p.type);
      if (p.type === 'starter_box') {
        this.world.props.teleport(p, new THREE.Vector3(c.x, g + 24, c.z), null, new THREE.Vector3(0, -5, 0));
      } else if (p.type === 'radio' || p.type === 'clone_pad') {
        this.world.props.teleport(p, new THREE.Vector3(pos.x, g + hh + 0.06, pos.z), p.root.quaternion);
      } else {
        // carried through the exit: they tumble out of the sky a few metres up with the clones
        this.world.props.teleport(p, new THREE.Vector3(pos.x, g + 1.4 + (carried++ % 4) * 0.45 + hh, pos.z), p.root.quaternion, new THREE.Vector3(0, -2, 0));
      }
    }
    for (const key of this.chunks.keys()) this._populate(key);
  }

  startAudio() {
    registerGrassAudio();
    this.ambience?.stop(1);
    this.meadowLoop?.stop(1);
    this.riverLoop?.stop(1);
    this.fallLoop?.stop(1);
    // the backrooms bed stays underneath, very quietly: the valley is not really outside
    this.ambience = audio.loop('ambience_backrooms', { bus: 'ambient', volume: 0.12 });
    this.meadowLoop = audio.loop('gl_meadow', { bus: 'ambient', volume: 0.9 });
    this.riverLoop = audio.loop('gl_river', { bus: 'ambient', volume: 0, pos: this.spawnCenter(), maxDistance: 70, refDistance: 4 });
    const f = this.water?.fall;
    if (f) this.fallLoop = audio.loop('gl_fall', { bus: 'ambient', volume: 1, pos: f.base.clone().setY(2), maxDistance: 110, refDistance: 7 });
  }

  _updateAudio(dt) {
    const S = this.sky.state;
    const lp = this.game.local.pos;
    if (this.meadowLoop) {
      this.meadowLoop.setParam('day', this.game.day.day);
      this.meadowLoop.setParam('wind', 0.5 + this.game.day.instability() * 0.9);
      this.meadowLoop.setParam('dusk', THREE.MathUtils.smoothstep(10 - S.elev, 0, 12));
      this.meadowLoop.setParam('sick', S.sick);
    }
    // river: follow the nearest point of the bank
    this._riverT = (this._riverT || 0) - dt;
    if (this.riverLoop && this._riverT <= 0) {
      this._riverT = 0.25;
      const r = this.gw.river(lp.x, lp.z);
      const toC = r.du;
      // nearest centreline point: step back along the across-river axis
      const ax = this.gw.rc, az = this.gw.rs;
      const k = r.dist > 0 ? Math.min(r.dist, Math.max(0, r.dist - r.w * 0.6)) : 0;
      const sgn = toC > 0 ? -1 : 1;
      const p = new THREE.Vector3(lp.x + ax * sgn * k, 0.6, lp.z + az * sgn * k);
      this.riverLoop.setPosition(p);
      this.riverLoop.setVolume(r.dist < 70 ? 1 : 0, 0.5);
    }
  }

  // ---------------------------------------------------------------
  // height queries
  groundAt(x, z) { return this.gw.groundAt(x, z, this.variantFn); }
  floorY(x, z) { return x === undefined ? 0 : this.groundAt(x, z); }
  ceilingY() { return 1000; }

  _key(cx, cz) { return `${cx},${cz}`; }

  _buildChunk(cx, cz) {
    const key = this._key(cx, cz);
    if (this.chunks.has(key)) return this.chunks.get(key);
    const t0 = performance.now();
    const variant = this.variantFn(cx, cz);
    const group = new THREE.Group();
    group.name = `gchunk:${key}`;
    const rec = { cx, cz, key, variant, group, physicsColliders: [], extraBodies: [], statics: [], layout: { specials: [] } };
    rec.physicsColliders.push(chunkCollider(this.gw, this.world.physics, cx, cz, variant));
    if (this.trees) rec.physicsColliders.push(...this.trees.colliders(this.world.physics, cx, cz));
    if (this.rocks) rec.physicsColliders.push(...this.rocks.colliders(this.world.physics, cx, cz));
    this.oddities?.build(rec);
    this.world.group.add(group);
    this.chunks.set(key, rec);
    this.buildMs = (this.buildMs || 0) * 0.8 + (performance.now() - t0) * 0.2;
    if (net.isHost) this._populate(key);
    return rec;
  }

  _unloadChunk(key) {
    const rec = this.chunks.get(key);
    if (!rec) return;
    rec.group.removeFromParent();
    rec.group.traverse((o) => { if (o.isMesh && o.geometry && !o.geometry.userData.shared && !o.userData.sharedGeo) o.geometry.dispose(); });
    for (const col of rec.physicsColliders) this.world.physics.removeCollider(col);
    for (const b of rec.extraBodies || []) this.world.physics.removeBody(b);
    for (const o of rec.statics || []) this.world.unregisterDynamic(o);
    for (const d of rec.roomDevices || []) d.root.visible = false;
    this.critters?.removeVentsOf(rec);
    this.oddities?.unload(rec);
    this.chunks.delete(key);
  }

  prepStatic(o, rec) {
    o.updateMatrixWorld(true);
    this.world.registerDynamic(o);
    if (rec) (rec.statics = rec.statics || []).push(o);
  }

  _populate(key) {
    if (!net.isHost || this.populated.has(key)) return;
    const rec = this.chunks.get(key);
    if (!rec) return;
    this.populated.add(key);
    const rng = new RNG(hash3(rec.cx, rec.cz, 991, this.seed));
    for (const st of this.gw.structures) {
      if (Math.floor(st.cx / CHUNK_M) !== rec.cx || Math.floor(st.cz / CHUNK_M) !== rec.cz) continue;
      this.structures?.populate(st, rng);
    }
  }

  _streamCenters() {
    const out = [this.game.local.pos.clone()];
    if (net.isHost) for (const r of this.game.remotes.values()) if (r.inWorld) out.push(r.pos.clone());
    return out;
  }

  _updateStreaming() {
    const centers = this._streamCenters();
    const local = centers[0];
    const want = new Map();
    centers.forEach((c, idx) => {
      const ccx = Math.floor(c.x / CHUNK_M), ccz = Math.floor(c.z / CHUNK_M);
      const r = idx === 0 ? LOAD_R : 1;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const k = this._key(ccx + dx, ccz + dz);
        const d = Math.hypot((ccx + dx + 0.5) * CHUNK_M - local.x, (ccz + dz + 0.5) * CHUNK_M - local.z);
        if (!want.has(k) || want.get(k) > d) want.set(k, d);
      }
    });
    const missing = [...want.entries()].filter(([k]) => !this.chunks.has(k)).sort((a, b) => a[1] - b[1]);
    let budget = missing.length && missing[0][1] < CHUNK_M * 1.2 ? 2 : 1;
    for (const [k] of missing) {
      if (budget-- <= 0) break;
      const [cx, cz] = k.split(',').map(Number);
      this._buildChunk(cx, cz);
    }
    for (const k of [...this.chunks.keys()]) {
      if (want.has(k)) continue;
      const [cx, cz] = k.split(',').map(Number);
      const far = centers.every((c) => Math.max(Math.abs(Math.floor(c.x / CHUNK_M) - cx), Math.abs(Math.floor(c.z / CHUNK_M) - cz)) > UNLOAD_R);
      if (far) this._unloadChunk(k);
    }
  }

  // Day-7 shifting valley: an unseen chunk regrows differently
  shiftChunk(cx, cz, variant) {
    const key = this._key(cx, cz);
    this.variants.set(key, variant);
    const had = this.chunks.has(key);
    if (had) this._unloadChunk(key);
    this.terrain?.invalidateChunk(cx, cz);
    this.trees?.invalidateChunk(cx, cz);
    this.grass?.invalidate();
    this.rocks?.invalidate();
    this.water?.invalidate(cx, cz);
    this.sunCache.clear();
    if (had) this._buildChunk(cx, cz);
  }

  // ---------------------------------------------------------------
  _dayT() {
    if (this.debugT !== null) return this.debugT;
    const d = this.game.day;
    if (!d.active) return 0;
    return Math.min(6.999, (d.day - 1) + Math.min(1, d.dayProgress));
  }

  update(dt) {
    this.time += dt;
    this._updateStreaming();
    const cam = engine.camera.position;
    this.terrain.update(cam, 3);
    const t = this._dayT();
    this.sky.update(dt, t, this.game.local.pos);
    this.trees.update(dt, cam, this.sky);
    this.grass.update(dt, cam, this.sky, this._pushers());
    this.rocks.update(dt, cam);
    this.water.update(dt, cam, this.sky);
    this.mist.update(dt, cam, this.sky, this.game.day.day);
    terrainUniforms.uTime.value = this.time;
    if (net.isHost) this._interceptCrates(dt);
    // explored cells (watch map)
    const lp = this.game.local.pos;
    if (!this._lostDone && Math.hypot(lp.x - 12, lp.z - 12) > 150) { this._lostDone = true; profile.unlock('lost'); }
    const ci = Math.floor(lp.x / CELL), cj = Math.floor(lp.z / CELL);
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) this.visited.add(`${i},${j}`);
    this.structures.update(dt, this.time, this.mission);
    interiorUniforms.uIntBounce.value.copy(this.sky.envGround.value).multiplyScalar(Math.PI * 0.42);
    setInteriors(this._interiorList);
    this.mission.update(dt);
    this.monsters.update(dt);
    this.anomalies.update(dt);
    this.critters.update(dt);
    this._fixups(dt);
    this._cullSmall();
    this._updateCrates(dt);
    this.oddities.update(dt, this.sky.state, this.time);
    this._updateAudio(dt);
    this._updateLightLevel();
  }

  // grass bends away from people and monsters
  _pushers() {
    const out = [];
    const l = this.game.local;
    if (!l.dead) out.push({ x: l.pos.x, z: l.pos.z, r: 0.75 });
    for (const r of this.game.remotes.values()) if (r.inWorld && !r.dead && out.length < 3) out.push({ x: r.pos.x, z: r.pos.z, r: 0.75 });
    for (const v of this.monsters?.views?.values() || []) {
      if (out.length >= 4) break;
      if (v.pos.distanceTo(l.pos) < 25) out.push({ x: v.pos.x, z: v.pos.z, r: 1.0 });
    }
    return out;
  }

  // ---------------------------------------------------------------
  // supply crates fall out of the sky under a torn parachute instead of through a ceiling
  _interceptCrates(dt) {
    const pc = this.mission.pendingCrates;
    for (let i = pc.length - 1; i >= 0; i--) {
      const c = pc[i];
      if (c.t - dt > 0) continue;
      pc.splice(i, 1);
      const spot = this._dropSpot(c.pos.x, c.pos.z);
      const g = this.groundAt(spot.x, spot.z);
      const e = new THREE.Euler(0.08, Math.random() * 6.28, 0.05);
      const p = this.world.props.spawn('supply_crate', new THREE.Vector3(spot.x, g + 70, spot.z), _q.setFromEuler(e), {
        state: { loot: c.loot, tier: c.tier, open: 0, chute: 1 }, vel: new THREE.Vector3(0, -9, 0),
      });
      if (p) this.crates.set(p.id, { landed: false, t: 0 });
      this.world.fxAll({ k: 'snd', n: 'crate_rumble', p: [spot.x, g + 30, spot.z], v: 1 });
    }
  }

  _dropSpot(x, z) {
    // nearest open cell centre around the requested spot
    const i0 = Math.floor(x / CELL), j0 = Math.floor(z / CELL);
    for (let r = 0; r <= 4; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const c = this.cell((i0 + di + 0.5) * CELL, (j0 + dj + 0.5) * CELL);
        if (c && !c.water && !c.special) return { x: (i0 + di + 0.5) * CELL + (Math.random() - 0.5), z: (j0 + dj + 0.5) * CELL + (Math.random() - 0.5) };
      }
    }
    return { x, z };
  }

  // torn R.O.O.M. parachutes over falling supply crates (every peer, visual only)
  _chuteMesh() {
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 128;
    const c = cv.getContext('2d');
    for (let k = 0; k < 8; k++) { c.fillStyle = k % 2 ? '#c8641e' : '#d8d2bc'; c.fillRect(k * 64, 0, 64, 128); }
    c.fillStyle = '#1a1a1a'; c.font = 'bold 30px monospace'; c.fillText('R.O.O.M.', 140, 70);
    // tears
    c.globalCompositeOperation = 'destination-out';
    const rng = new RNG(77);
    for (let k = 0; k < 6; k++) {
      c.beginPath();
      const x = rng.next() * 512, y = 20 + rng.next() * 90;
      c.moveTo(x, y);
      for (let q = 0; q < 7; q++) c.lineTo(x + (rng.next() - 0.5) * 70, y + (rng.next() - 0.5) * 40);
      c.closePath(); c.fill();
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 });
    const dome = new THREE.SphereGeometry(2.6, 24, 7, 0, Math.PI * 2, 0, Math.PI / 2.3);
    dome.scale(1, 0.55, 1);
    const g = new THREE.Group();
    const canopy = new THREE.Mesh(dome, mat);
    canopy.castShadow = true;
    g.add(canopy);
    const pts = [];
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      pts.push(Math.cos(a) * 2.25, 0.4, Math.sin(a) * 2.25, Math.cos(a) * 0.35 * (k % 2 ? 1 : 0.6), -4.4, Math.sin(a) * 0.25);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2a2a24 })));
    g.userData.canopy = canopy;
    g.userData.lines = g.children[1];
    return g;
  }

  _updateChutes(dt) {
    this._chutes = this._chutes || new Map();
    for (const p of this.world.props.props.values()) {
      if (p.type !== 'supply_crate' || !p.state.chute) continue;
      let ch = this._chutes.get(p.id);
      if (!ch) {
        ch = { g: this._chuteMesh(), t: 0, landed: false, k: 0 };
        this.world.group.add(ch.g);
        this._chutes.set(p.id, ch);
      }
      ch.t += dt;
      const pos = p.root.position;
      const g = this.groundAt(pos.x, pos.z);
      if (p.state.chute === 1 && pos.y > g + 0.9) {
        ch.g.position.set(pos.x + Math.sin(ch.t * 0.9) * 0.3, pos.y + 4.6, pos.z + Math.cos(ch.t * 0.7) * 0.3);
        ch.g.rotation.set(Math.sin(ch.t * 1.3) * 0.08, ch.t * 0.3, Math.cos(ch.t * 1.1) * 0.08);
        const breathe = 1 + Math.sin(ch.t * 3.1) * 0.04;
        ch.g.userData.canopy.scale.set(breathe, 1 / breathe, breathe);
      } else {
        // collapse onto the meadow beside the crate
        if (!ch.landed) { ch.landed = true; ch.base = pos.clone(); ch.dir = Math.random() * 6.28; }
        ch.k = Math.min(1, ch.k + dt * 0.8);
        const k = ch.k;
        const x = ch.base.x + Math.cos(ch.dir) * 2.4 * k, z = ch.base.z + Math.sin(ch.dir) * 2.4 * k;
        ch.g.position.set(x, THREE.MathUtils.lerp(ch.base.y + 4.6, this.groundAt(x, z) + 0.12, k), z);
        ch.g.rotation.set(THREE.MathUtils.lerp(0, 1.25, k), ch.dir, 0);
        ch.g.userData.canopy.scale.set(1, THREE.MathUtils.lerp(1, 0.08, k), 1);
        ch.g.userData.lines.visible = k < 0.6;
      }
    }
    for (const [id, ch] of this._chutes) {
      if (this.world.props.props.has(id)) continue;
      ch.g.removeFromParent();
      this._chutes.delete(id);
    }
  }

  _updateCrates(dt) {
    this._updateChutes(dt);
    if (!net.isHost) return;
    for (const [id, st] of this.crates) {
      const p = this.world.props.get(id);
      if (!p || !p.body) { this.crates.delete(id); continue; }
      st.t += dt;
      const pos = p.root.position;
      const g = this.groundAt(pos.x, pos.z);
      if (!st.landed) {
        // canopy drag: settle to ~6 m/s and sway
        const v = p.body.linvel();
        if (pos.y > g + 1.2) {
          const vy = Math.max(v.y, -6.5);
          const sway = Math.sin(st.t * 1.3) * 0.6;
          p.body.setLinvel({ x: v.x * 0.96 + sway * 0.04, y: vy, z: v.z * 0.96 }, true);
          p.body.setAngvel({ x: 0, y: 0.3, z: 0 }, true);
        } else {
          st.landed = true;
          this.world.noise.emit(pos, 30, 'crate');
          this.world.fxAll({ k: 'dust', p: [pos.x, g + 0.2, pos.z], n: 30, c: [0.62, 0.56, 0.42], s: 2 });
          this.world.fxAll({ k: 'impact', m: 'wood', p: [pos.x, pos.y, pos.z], i: 1 });
          this.world.props.setState(id, { chute: 2 });
        }
      } else if (st.t > 120) this.crates.delete(id);
    }
  }

  // keep everything that assumes a flat y=0 floor standing on the actual ground
  _fixups(dt) {
    // monsters (host): never inside rock, never under the ground
    if (net.isHost) {
      for (const a of this.monsters.agents.values()) {
        const c = this.cell(a.pos.x, a.pos.z);
        if (!c) {
          const s = this._nearestOpen(a.pos.x, a.pos.z);
          if (s) { a.pos.x = s.x; a.pos.z = s.z; a.path = null; }
        }
        const g = this.groundAt(a.pos.x, a.pos.z);
        if (a.pos.y < g - 0.05 || a.pos.y > g + 2.5) {
          a.pos.y = g;
          a.collider.setTranslation({ x: a.pos.x, y: a.pos.y + a.halfH + a.radius, z: a.pos.z });
        }
      }
      // props that ended up inside the terrain (teleports, tunnelling) pop back out
      this._rescueT = (this._rescueT || 0) - dt;
      if (this._rescueT <= 0) {
        this._rescueT = 0.5;
        for (const p of this.world.props.props.values()) {
          if (!p.body || p.frozen || p.sinking || p.isHeld() || p.type.startsWith('rag_')) continue;
          const pos = p.root.position;
          const g = this.groundAt(pos.x, pos.z);
          const lo = (p.bounds?.min?.y ?? -0.2);
          if (pos.y + lo < g - 0.35) {
            this.world.props.teleport(p, new THREE.Vector3(pos.x, g - lo + 0.1, pos.z), p.root.quaternion);
          }
        }
      }
    }
    // the local player never ends up under the valley floor (a bad teleport, a physics tunnel): put them back
    // on the surface right away instead of letting them fall out of the world and get sky-dropped
    {
      const l = this.game.local;
      if (l && !l.dead && this.isChunkLoaded(l.pos.x, l.pos.z)) {
        const g = this.groundAt(l.pos.x, l.pos.z);
        if (l.pos.y < g - 1.2) {
          l.teleport(new THREE.Vector3(l.pos.x, g + 0.08, l.pos.z));
          // the fall under the surface must not count as a landing impact
          l.fallSpeed = 0;
          l.arrivalGrace = Math.max(l.arrivalGrace || 0, 0.5);
        }
      }
    }
    // props pick up the roofed-space light occlusion (shared catalog materials, restored on dispose)
    {
      const seen = this._patchedProps || (this._patchedProps = new WeakSet());
      for (const p of this.world.props.props.values()) {
        if (seen.has(p.root)) continue;
        seen.add(p.root);
        patchInteriorObject(p.root);
      }
    }
    // critters run on the ground, not at y = 0
    for (const cr of this.critters.list) {
      const g = this.groundAt(cr.pos.x, cr.pos.z);
      cr.pos.y = g + 0.005;
      cr.root.position.y = g + 0.005;
      cr.collider?.setTranslation({ x: cr.pos.x, y: g + 0.1, z: cr.pos.z });
    }
    // the exit booth materialises on the meadow (the mission places it at y = 0)
    const ex = this.mission.exitDevice;
    if (ex && !ex._grassFixed) this._seatExit(ex);
  }

  // machines: the real (interactive, animated) device up close, a merged proxy further out, nothing far away
  registerProxy(dev, o = {}) {
    if (!dev?.root || this.proxies.has(dev)) return;
    this.proxies.set(dev, { dev, near: o.near ?? 12, far: o.far ?? 60, shadows: o.shadows !== false, blind: o.blind || null, proxy: null, sig: null, mode: -1 });
  }

  unregisterProxy(dev) {
    const P = this.proxies.get(dev);
    if (!P) return;
    disposeProxy(P.proxy);
    this.proxies.delete(dev);
  }

  // the valley is wide open: loose props and machines far away are each 5-60 draw calls for a few pixels
  _cullSmall() {
    this._cullT = (this._cullT || 0) - 1;
    if (this._cullT > 0) return;
    this._cullT = 6;
    this._cullN = (this._cullN || 0) + 1;
    const cam = engine.camera.position;
    let builds = 0; // at most one proxy (re)build per pass: no hitch when several machines come into range
    for (const P of this.proxies.values()) {
      const root = P.dev.root;
      if (!root.parent) continue;
      const d2 = root.position.distanceToSquared(cam);
      const mode = (P.blind && P.blind(cam)) || d2 > P.far * P.far ? 0 : d2 < P.near * P.near ? 2 : 1;
      if (mode === 1) {
        const sig = stateSig(P.dev);
        if (builds < 1 && (P.proxy === null || (sig !== P.sig && this._cullN % 5 === 0))) {
          builds++;
          // build from the live device (temporarily visible so its parts are collected)
          const was = root.visible;
          root.visible = true;
          const px = buildProxy(root, { shadows: P.shadows });
          root.visible = was;
          disposeProxy(P.proxy);
          P.proxy = px || false;
          P.sig = sig;
          if (px) this.world.group.add(px);
        }
      }
      root.visible = mode === 2 || (mode === 1 && !P.proxy);
      if (P.proxy) P.proxy.visible = mode === 1;
      P.mode = mode;
    }
    // loose props: hidden far away (never a held one; only ever un-hide what was hidden here), and only the
    // ones near the camera cast sun shadows
    const hid = this._culled || (this._culled = new Set());
    const noShadow = this._noShadow || (this._noShadow = new WeakSet());
    for (const p of this.world.props.props.values()) {
      const o = p.root;
      const d2 = o.position.distanceToSquared(cam);
      const far = d2 > 65 * 65;
      if (far && o.visible && !p.isHeld?.()) { o.visible = false; hid.add(o); } else if (!far && hid.has(o)) { o.visible = true; hid.delete(o); }
      const cast = d2 < 14 * 14;
      if (cast !== !o.userData.glNoShadow) {
        o.userData.glNoShadow = !cast;
        o.traverse((m) => {
          if (!m.isMesh) return;
          if (!cast && m.castShadow) { m.castShadow = false; noShadow.add(m); } else if (cast && noShadow.has(m)) { m.castShadow = true; noShadow.delete(m); }
        });
      }
    }
    for (const o of hid) if (!o.parent) hid.delete(o);
  }

  _nearestOpen(x, z) {
    const i0 = Math.floor(x / CELL), j0 = Math.floor(z / CELL);
    for (let r = 1; r <= 5; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const c = this.cell((i0 + di + 0.5) * CELL, (j0 + dj + 0.5) * CELL);
        if (c) return { x: (i0 + di + 0.5) * CELL, z: (j0 + dj + 0.5) * CELL };
      }
    }
    return null;
  }

  _seatExit(ex) {
    ex._grassFixed = true;
    const p = ex.root.position;
    let top = -1e9;
    for (const [dx, dz] of [[0, 0], [-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4], [0, 1.5], [0, -1.5], [1.5, 0], [-1.5, 0]]) top = Math.max(top, this.groundAt(p.x + dx, p.z + dz));
    const dy = top + 0.02 - p.y;
    p.y += dy;
    ex.root.updateMatrixWorld(true);
    for (const col of ex.colliders) {
      const t = col.translation();
      col.setTranslation({ x: t.x, y: t.y + dy, z: t.z });
    }
    // a poured concrete plinth so the booth never floats over the grass
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.8, 3.5), slabMaterial());
    plinth.position.set(0, -0.39, 0);
    plinth.receiveShadow = true;
    plinth.castShadow = true;
    ex.root.add(plinth);
    ex.root.updateMatrixWorld(true);
    // the booth is a roofed room: its own panel light instead of the sky
    patchInteriorObject(ex.root);
    const yaw = ex.root.rotation.y;
    this._interiorList = this._interiorList.filter((b) => !b.exit);
    // (the decon room is centred on the device root, door in its +z wall)
    this._interiorList.push({
      exit: true, cx: p.x, cz: p.z, hx: 1.55, hz: 1.5,
      y0: p.y - 0.3, y1: p.y + 2.7, yaw, open: 1, soft: 0.6, strength: 1, fill: new THREE.Color(0.85, 0.9, 1.0).multiplyScalar(1.3),
    });
  }

  // ---------------------------------------------------------------
  // light
  _sunVis(x, z) {
    const S = this.sky.state;
    const key = `${Math.round(S.elev)}`;
    if (key !== this.sunKey) { this.sunCache.clear(); this.sunKey = key; }
    const i = Math.floor(x / 1.5), j = Math.floor(z / 1.5);
    const k = i * 100003 + j;
    let v = this.sunCache.get(k);
    if (v !== undefined) return v;
    v = 1;
    const c = this.cell(x, z);
    if (c?.forest) v *= 1 - 0.55 * c.forest;
    const sd = this.sky.uniforms.uSunDir.value;
    const hl = Math.hypot(sd.x, sd.z);
    if (hl > 1e-3 && sd.y > -0.05) {
      const tanE = Math.max(0.01, sd.y) / hl;
      const y0 = this.groundAt(x, z) + 1.2;
      for (const d of [3, 7, 13, 21, 32, 48]) {
        const sx = x + (sd.x / hl) * d, sz = z + (sd.z / hl) * d;
        if (this.gw.height(sx, sz) > y0 + d * tanE) { v *= 0.25; break; }
      }
    }
    if (this.sunCache.size > 4000) this.sunCache.clear();
    this.sunCache.set(k, v);
    return v;
  }

  sampleLight(pos, out) {
    const S = this.sky.state;
    const above = sstep(-2.5, 3.5, S.elev);
    const sunVis = above > 0.01 ? this._sunVis(pos.x, pos.z) : 0;
    const sunK = (S.sunI / 6) * above * sunVis * 0.8;
    // sky dome brightness
    const skyL = (S.hor.r + S.hor.g + S.hor.b) / 3 * 0.45 + (S.zen.r + S.zen.g + S.zen.b) / 3 * 0.25;
    out.setRGB(0, 0, 0);
    out.r = S.sun.r * sunK + S.hor.r * skyL * 0.6 + 0.012;
    out.g = S.sun.g * sunK + S.hor.g * skyL * 0.6 + 0.012;
    out.b = S.sun.b * sunK + S.hor.b * skyL * 0.6 + 0.014;
    this.oddities?.lightAt(pos, out);
    return out;
  }

  _updateLightLevel() {
    const p = this.game.local.pos;
    _v.set(p.x, p.y + 1.2, p.z);
    this.sampleLight(_v, _c);
    const lum = _c.r * 0.3 + _c.g * 0.59 + _c.b * 0.11;
    const fl = this.game.local.flashOn ? 0.25 : 0;
    this.game.local.lightLevel = Math.min(1.5, lum + fl);
    this.game.local.lightColor = (this.game.local.lightColor || new THREE.Color()).copy(_c).multiplyScalar(1.2).addScalar(fl * 0.5);
    if (this.ambience) {
      this.ambience.setParam('tension', Math.min(1, this.game.local.survival.stress + this.game.day.instability() * 0.4));
      this.ambience.setParam('day', this.game.day.day);
    }
  }

  // ---------------------------------------------------------------
  // Gameplay queries (same contract as the Yellow Rooms)
  cell(x, z) {
    const c = this.gw.cellAt(Math.floor(x / CELL), Math.floor(z / CELL), this.variantFn);
    return c && !c.blocked && !c.occupied ? c : null;
  }

  passable(i, j, d) {
    const a = this.gw.cellAt(i, j, this.variantFn);
    if (!a || a.blocked || a.occupied) return false;
    const b = this.gw.cellAt(i + DIRS[d][0], j + DIRS[d][1], this.variantFn);
    if (!b || b.blocked || b.occupied) return false;
    return this.gw.edgeOpen(i, j, d);
  }

  // watch map: outline the walkable valley (cliff feet, structure walls, fallen logs)
  mapWall(i, j, west) {
    const d = west ? 3 : 0;
    const a = this.cell((i + 0.5) * CELL, (j + 0.5) * CELL);
    const b = this.cell((i + DIRS[d][0] + 0.5) * CELL, (j + DIRS[d][1] + 0.5) * CELL);
    if (!a && !b) return false;
    if (!a || !b) return true;
    return !this.passable(i, j, d);
  }

  cellCost(i, j) {
    const c = this.gw.cellAt(i, j, this.variantFn);
    if (!c) return 0;
    if (c.water) return 2.5;
    if (c.zone === Z.BANK) return 0.4;
    if (c.zone === Z.FOREST) return 0.25;
    return 0;
  }

  isChunkLoaded(x, z) {
    return this.chunks.has(this._key(Math.floor(x / CHUNK_M), Math.floor(z / CHUNK_M)));
  }

  waterDepth(x, z) {
    return this.gw.waterDepth(x, z);
  }

  surfaceAt(x, z) {
    const c = this.gw.cellAt(Math.floor(x / CELL), Math.floor(z / CELL), this.variantFn);
    if (!c) return 'gravel';
    if (c.zone === Z.STRUCT) return Math.abs(this.groundAt(x, z) - 0) < 0.08 ? 'concrete' : 'grass';
    if (c.zone === Z.PATH || c.zone === Z.BANK) return 'gravel';
    return 'grass';
  }

  sampleKindAt(hit) {
    if (!hit) return null;
    const fromMon = this.monsters?.sampleAt(hit.point);
    if (fromMon) return fromMon;
    if (hit.ud?.kind === 'critter') return 'rat';
    const p = hit.point;
    if (this.waterDepth(p.x, p.z) > 0.03 && p.y < WATER_Y + 0.3) return 'river_water';
    if (hit.ud?.surface === 'terrain') return hit.normal.y > 0.7 ? 'meadow_static' : 'granite_lichen';
    if (hit.ud?.surface === 'tree') return 'pine_resin';
    if (hit.ud?.surface === 'rock') return 'granite_lichen';
    return null;
  }

  onSampleTaken(kind, hit) {
    if (kind === 'rat') this.critters?.catchAt(hit.point);
  }

  photoSubjects(camera) {
    const out = [];
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const consider = (pos, subject, key, value, maxD = 18) => {
      const d = pos.distanceTo(camera.position);
      if (d > maxD) return;
      const dir = pos.clone().sub(camera.position).normalize();
      if (dir.dot(fwd) < 0.85) return;
      if (!this.world.physics.lineOfSight(camera.position, pos)) return;
      out.push({ subject, key, value: Math.round(value * (1 - d / (maxD + 6))), dist: d });
    };
    for (const p of this.world.props.props.values()) {
      if (p.sinking) consider(p.root.position, 'SINKING OBJECT (MEADOW)', `sink:${p.id}`, 45);
    }
    for (const g of this.mission?.generators || []) if (g.running) consider(g.root.position.clone().setY(0.8), `${g.label} (RUNNING)`, `gen:${g.id}`, 15);
    for (const a of this.anomalyList || []) consider(a.pos, a.subject, a.key, a.value, a.maxD || 18);
    for (const a of this.structures?.photo || []) consider(a.pos, a.subject, a.key, a.value, a.maxD || 18);
    return out;
  }

  // ---------------------------------------------------------------
  spawnBody(id, cosmetics, pos, yaw, vel) { this.mission?.spawnBody(id, cosmetics, pos, yaw, vel); }
  removeBody(id) { this.mission?.removeBody(id); }
  onPropGrabbed(prop, from) { this.mission?.onPropGrabbed?.(prop, from); }
  playFx(m, p) {
    this.mission?.playFx?.(m, p);
    this.monsters?.playFx?.(m, p);
  }
  onImpact(prop, intensity, other) { this.mission?.onImpact?.(prop, intensity, other); }

  serialize() {
    return { variants: [...this.variants.entries()], mission: this.mission.serialize(), populated: [...this.populated] };
  }

  applySync(d) {
    if (d.variants) for (const [k, v] of d.variants) { const [cx, cz] = k.split(',').map(Number); this.shiftChunk(cx, cz, v); }
    if (d.mission) this.mission.applySync(d.mission);
  }

  // debug: what is drawn this frame (frustum-visible meshes grouped by name prefix)
  debugDraw() {
    const cam = engine.camera;
    cam.updateMatrixWorld();
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const groups = {};
    let tris = 0;
    this.world.group.traverseVisible((o) => {
      if (!o.isMesh && !o.isPoints) return;
      if (o.frustumCulled && o.geometry.boundingSphere) {
        const sph = o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld);
        if (!fr.intersectsSphere(sph)) return;
      }
      const k = (o.name || o.parent?.name || 'unnamed').split(/[ :_]/)[0];
      const idx = o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position?.count || 0;
      const inst = o.isInstancedMesh ? o.count : o.geometry.isInstancedBufferGeometry ? o.geometry.instanceCount : 1;
      if (inst === 0) return;
      const tt = (idx / 3) * inst;
      groups[k] = groups[k] || [0, 0];
      groups[k][0]++;
      groups[k][1] += Math.round(tt / 1000);
      tris += tt;
    });
    return { groups, tris: Math.round(tris) };
  }

  dispose() {
    unpatchAllInterior();
    for (const P of this.proxies.values()) disposeProxy(P.proxy);
    this.proxies.clear();
    this.ambience?.stop(0.5);
    this.meadowLoop?.stop(0.5);
    this.riverLoop?.stop(0.5);
    this.fallLoop?.stop(0.5);
    this.oddities?.dispose();
    this.mission?.dispose();
    this.monsters?.dispose();
    this.anomalies?.dispose?.();
    this.critters?.dispose();
    for (const k of [...this.chunks.keys()]) this._unloadChunk(k);
    this.terrain?.dispose();
    this.trees?.dispose();
    this.grass?.dispose();
    this.rocks?.dispose();
    this.water?.dispose();
    this.structures?.dispose();
    this.mist?.dispose();
    this.sky?.dispose();
    const s = this._saved;
    if (s) {
      engine.camera.far = s.far;
      engine.camera.updateProjectionMatrix();
      engine.scene.background = s.bg;
    }
    engine.scene.fog = null;
    engine.post.params.uContrast.value = 1.04;
  }
}
