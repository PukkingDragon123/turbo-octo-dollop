// Level 37 — The Poolrooms. Endless humid tiled halls, pool basins, flooded colonnades and skylit
// natatoriums. Reuses the Yellow Rooms streaming / light-field / mission / monster / anomaly / critter
// machinery (PoolroomsLevel extends YellowLevel) with its own layout, geometry, materials, water,
// lighting, audio and day-cycle decay (lights fail, pools darken and rise, tiles crack).
import * as THREE from 'three';
import { engine } from '../../../core/engine.js';
import { net } from '../../../net/net.js';
import { audio } from '../../../audio/audio.js';
import { input } from '../../../core/input.js';
import { profile } from '../../../core/profile.js';
import { hash01, RNG, hash3, clamp } from '../../../core/rng.js';
import { LightField } from '../../../gfx/bakedlight.js';
import { YellowLevel } from '../yellow/yellow.js';
import { getLayout as yellowLayout } from '../yellow/layout.js';
import { modelHalfHeight } from '../../../entities/catalog.js';
import { Mission } from '../../../game/mission.js';
import { MonsterManager } from '../../../game/monsters.js';
import { Anomalies } from '../../../game/anomalies.js';
import { Critters } from '../../../game/critters.js';
import { Device } from '../../../game/devices.js';
import {
  CELL, CHUNK, CHUNK_M, HEIGHT, TALL, W, WATER_Y, SUNK_Y, getLayout, wallN, wallW, wallPassable,
  clearLayoutCache, poolFloorAt, poolCoords, poolStairSide, missionChunks, BACK, CANAL_Z0, CANAL_Z1, CANAL_X0,
  GIANT, hallOf,
} from './layout.js';
import { Raft, RAFT_HL, RAFT_HW } from './raft.js';
import { PoolCreatures } from './creatures.js';
import { WaterPlay } from './waterplay.js';
import { buildChunk, buildChunkSteps, cellLightSpec, makeQueries } from './chunkbuilder.js';
import { PU, initPoolTextures } from './poolmat.js';
import { PoolReflection, makePoolWater } from './water.js';
import { poolModel, poolHalfHeight, buoyancyOf, floatGeometry, floatMaterial, floatOffsetOf, isPoolProp } from './props.js';
import { decoratePoolRoom, populatePoolRoom } from './rooms.js';
import { registerPoolAudio } from './audio.js';
import { poolEnvironment } from './env.js';
import { PoolFX } from './fx.js';
import { batchStatics } from './batch.js';

const LOAD_R = 2;
const UNLOAD_R = 3;
const LIGHT_R = 3;
const DEAD_FRAC = [0, 0, 0.0, 0.03, 0.06, 0.12, 0.19, 0.28];
const FLICK_FRAC = [0, 0.0, 0.02, 0.05, 0.09, 0.14, 0.2, 0.3];
const SLICE_MS = 7;

const _v = new THREE.Vector3();
const _c = new THREE.Color();
const _fogLit = new THREE.Color(0.26, 0.31, 0.31);
const _fogDark = new THREE.Color(0.012, 0.018, 0.018);
const _fogWater = new THREE.Color(0.012, 0.05, 0.04);
const _fogBlood = new THREE.Color(0.08, 0.02, 0.02);
const _c2 = new THREE.Color();

// ---------------------------------------------------------------------------
// Chrome pool ladder: E climbs out of / down into the pool (the clone cannot swim)
class PoolLadder extends Device {
  constructor(world, id, spec) {
    super(world, id, {});
    this.spec = spec;
    this.range = 2.8;
    this.addBox(new THREE.Vector3(...spec.center), new THREE.Vector3(...spec.half));
  }
  prompt(player) {
    const inPool = player.pos.y < -0.3;
    return `[${input.keyName('interact')}] ${inPool ? 'Climb out of the pool' : 'Climb down the ladder'}`;
  }
  interact(player) {
    const inPool = player.pos.y < -0.3;
    const t = inPool ? this.spec.deck : this.spec.pool;
    player.teleport(new THREE.Vector3(t[0], t[1], t[2]), inPool ? this.spec.yawOut : this.spec.yawIn);
    audio.play('splash', { pos: new THREE.Vector3(t[0], 0, t[2]), intensity: 0.5, volume: 0.6 });
    engine.post.params.uFade.value = Math.max(engine.post.params.uFade.value, 0.55);
    this.world.level?.fadeIn?.();
    this.world.level?.ripple?.(t[0], t[2], 1.2);
  }
}

export class PoolroomsLevel extends YellowLevel {
  constructor(world, desc) {
    super(world, desc);
    this.name = 'LEVEL 37 — THE POOLROOMS';
    this.feedName = 'LEVEL 37: THE POOLROOMS';
    this.reverb = 'pool';
    clearLayoutCache();
    this.Q = makeQueries(this.seed, this.variantFn);
    this.occluder = this.Q.occl;
    this.ao = this.Q.ao;
    this.cellAt = this.Q.cellAt;
    // own reflection + water (the Yellow ones are replaced)
    this.reflection.dispose();
    const q = engine.qualityName;
    this.reflection = new PoolReflection(engine.renderer, WATER_Y, q === 'high' ? 0.5 : 0.35);
    this.reflection.enabled = q !== 'low';
    initPoolTextures();
    this.waterMaterial = makePoolWater(this.reflection, this.field);
    this.waterMaterial.uniforms.uReflOn.value = this.reflection.enabled ? 1 : 0;
    // the mirrored pass only needs what is near the water: skip far chunks and far / small props
    this.reflection.cull = (cam, hidden) => {
      for (const rec of this.chunks.values()) {
        const g = rec.group;
        if (!g.visible) continue;
        const dx = Math.max(0, Math.abs(cam.x - (rec.cx + 0.5) * CHUNK_M) - CHUNK_M / 2), dz = Math.max(0, Math.abs(cam.z - (rec.cz + 0.5) * CHUNK_M) - CHUNK_M / 2);
        if (dx * dx + dz * dz > 24 * 24) { g.visible = false; hidden.push(g); continue; }
        // submerged surfaces, small fittings and room furniture are not worth a mirrored draw call
        for (const o of rec.reflSkip || []) if (o.visible) { o.visible = false; hidden.push(o); }
      }
      for (const p of this.world.props.props.values()) {
        const r = p.root;
        if (!r.visible) continue;
        const d2 = r.position.distanceToSquared(cam);
        if (d2 > 12 * 12 || (d2 > 5 * 5 && (p.radius ?? 1) < 0.3)) { r.visible = false; hidden.push(r); }
      }
      for (const d of this.world.devices.values()) {
        const r = d.root;
        if (!r?.visible || !r.parent) continue;
        if (r.position.distanceToSquared(cam) > 12 * 12) { r.visible = false; hidden.push(r); }
      }
    };
    this.waterLevel = WATER_Y;
    this.job = null;
    this.ripT = 0;
    this.dripT = 2;
    this.fadeT = 0;
    this.underwater = 0;
    this.envLum = 1;
    this.mapT = 0;
    this.prevEnv = null;
    this.missionChunks = missionChunks(this.seed);
    this.starterExtra = []; // (the water tester was retired from the kit)
    registerPoolAudio();
  }

  // the arrival room sits at the head of the waterway (chunk 0, back of the south deck)
  spawnCenter() { return new THREE.Vector3(2 * CELL, 0, (BACK + 1) * CELL); }

  // generators stand against the south wall of their plant room, facing the deck and the canal
  generatorSpot(m) {
    return { x: (m.cx * CHUNK + 4) * CELL, z: (m.cz * CHUNK + CHUNK) * CELL - 1.55, rot: Math.PI };
  }

  // ---------------------------------------------------------------
  async build(onProgress) {
    onProgress?.(0, 'LEVEL 37 — THE POOLROOMS · FILLING THE POOLS');
    const scene = engine.scene;
    this.prevEnv = { env: scene.environment, int: scene.environmentIntensity, exp: engine.renderer.toneMappingExposure, bloom: engine.post.bloom?.strength, bg: scene.background };
    // remember the post stack's grade so dispose() hands it back untouched
    this.prevPost = {};
    for (const k of ['uTint', 'uSat', 'uGrain', 'uVignette', 'uExposure', 'uLift', 'uGamma', 'uGain', 'uRolloff', 'uContrast']) {
      const v = engine.post.params[k]?.value;
      if (typeof v === 'number') this.prevPost[k] = v;
      else if (v?.isColor || v?.isVector2 || v?.isVector3 || v?.isVector4) this.prevPost[k] = v.clone();
    }
    scene.background = new THREE.Color(0x9fb4b6);
    scene.fog = new THREE.FogExp2(_fogLit.getHex(), 0.024);
    scene.environment = poolEnvironment();
    scene.environmentIntensity = 0.25;
    this.field.uniforms.uAmbient.value.setRGB(0.02, 0.024, 0.026);
    this.field.uniforms.uLightScale.value = 0.36;
    const pp = engine.post.params;
    pp.uTint.value.setRGB(0.96, 1.0, 0.99);
    pp.uSat.value = 0.86;
    pp.uGrain.value = 0.045;
    pp.uVignette.value = 0.36;
    if (engine.post.bloom) { engine.post.bloom.strength = 0.4; this.prevEnv.thr = engine.post.bloom.threshold; engine.post.bloom.threshold = 1.05; }
    // clean, cool film grade (if the post stack offers grading controls)
    if (pp.uLift) {
      pp.uExposure.value = 0.9;
      pp.uLift.value.set(0.004, 0.011, 0.015);
      pp.uGamma.value.set(1.0, 1.0, 1.02);
      pp.uGain.value.set(0.985, 1.0, 1.02);
      pp.uRolloff.value = 0.3;
    }
    if (pp.uContrast) pp.uContrast.value = 1.03;
    engine.renderer.toneMappingExposure = 1.0;
    this.world.monsters = this.monsters = new MonsterManager(this);
    this.mission = new Mission(this);
    this.anomalies = new Anomalies(this);
    this.critters = new Critters(this);
    const prevModel = this.world.customModel;
    this.world.customModel = (type, state, mo) => poolModel(type, state, mo) || prevModel?.(type, state, mo) || null;
    this.fx = new PoolFX(this);
    this._buoy = (dt) => this._buoyancy(dt);
    this.world.physics.beforeStep.push(this._buoy);
    this.world.props.onSpawned.push((p) => this._onPropSpawned(p));
    const centers = [this.spawnCenter()];
    this._registerLights(centers);
    const need = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) need.push([dx, dz]);
    for (let i = 0; i < need.length; i++) {
      this._buildChunk(need[i][0], need[i][1]);
      onProgress?.((i + 1) / need.length, `LEVEL 37 — THE POOLROOMS · ${i < 3 ? 'FILLING THE POOLS' : i < 6 ? 'TILING THE HALLS' : 'WARMING THE WATER'}`);
      await new Promise((r) => setTimeout(r, 0));
    }
    this.mission.build();
    // the raft waits at the dock at the head of the canal
    this.raft = new Raft(this.world, this, 'raft', CANAL_X0 + 2.4 + RAFT_HL + 0.6, CANAL_Z1 - RAFT_HW - 0.12);
    this.world.addDevice(this.raft);
    this.prepStatic(this.raft.root, null);
    this.creatures = new PoolCreatures(this);
    this.waterplay = new WaterPlay(this);
    this._applyDayLights(1, true);
  }

  hostStart(desc) {
    super.hostStart(desc);
    setTimeout(() => this.mission?.hq('LEVEL 37 ADVISORY: The generators are located DOWNSTREAM. The halls are sealed on foot — board the RAFT at the dock and punt it forward (hold [E] while looking at the deck). Bring the field radio.', 'HQ'), 6500);
    setTimeout(() => this.mission?.hq('WATER SAFETY: Deep water exhausts clones. Do not drink the pool water. Report anything large moving beneath the surface.', 'HQ'), 17000);
  }

  startAudio() {
    this.ambience?.stop(1);
    this.ambience = audio.loop('ambience_pool', { bus: 'ambient', volume: 0.95 });
    this.humLoop?.stop(0.5);
    this.humLoop = audio.loop('hum', { bus: 'ambient', volume: 0.22 });
    this.dripLoop?.stop(0.5);
    this.dripLoop = audio.loop('drips', { bus: 'ambient', volume: 0.5 });
    this.waterLoop?.stop(0.5);
    this.waterLoop = audio.loop('water_flow', { bus: 'ambient', volume: 0.0 });
  }

  // ---------------------------------------------------------------
  _registerChunkLights(cx, cz) {
    const layout = getLayout(this.seed, cx, cz, this.variantFn(cx, cz));
    for (const c of layout.cells) {
      const spec = cellLightSpec(c);
      const key = LightField.texel(c.i, c.j);
      const ex = this.field.get(key);
      if (!spec) {
        if (ex && ex.ci === c.i && ex.cj === c.j) this.field.remove(key);
        continue;
      }
      if (ex && ex.ci === c.i && ex.cj === c.j) continue;
      const l = this.field.add(key, spec.x, spec.y, spec.z, spec.color, spec.base, { mode: spec.mode, radius: spec.radius, seed: spec.seed });
      l.ci = c.i; l.cj = c.j;
      l.baseMode = spec.mode;
      l.baseInt = spec.base;
      l.sky = spec.sky;
      l.cell = c;
      this._applyDayToLight(l, this.game.day.day);
      this.lightCells.add(key);
    }
  }

  _applyDayToLight(l, day) {
    if (l.forced) return;
    const h = hash01(l.ci, l.cj, 77, this.seed);
    let mode = l.baseMode;
    if (l.sky) {
      // skylights don't burn out — the "daylight" behind them greys and fades instead
      const k = day >= 7 ? 0.32 : day >= 6 ? 0.5 : day >= 5 ? 0.72 : 1;
      const nb = (l.baseInt ?? 1.85) * k;
      if (Math.abs(nb - l.base) > 1e-3) { l.base = nb; l._force = true; this.field.dirty = true; }
      if (day >= 6 && h < 0.25 && mode === 'on') mode = 'flicker';
    } else {
      if (h < DEAD_FRAC[day]) mode = 'dead';
      else if (h < DEAD_FRAC[day] + FLICK_FRAC[day] && mode === 'on') mode = 'flicker';
    }
    if (mode !== l.mode) { l.mode = mode; l._force = true; this.field.dirty = true; }
  }

  // ---------------------------------------------------------------
  _buildChunk(cx, cz) {
    const key = this._key(cx, cz);
    if (this.chunks.has(key)) return this.chunks.get(key);
    this._ensureLights(cx, cz);
    let rec;
    if (this.job && this.job.key === key) {
      let r = this.job.it.next();
      while (!r.done) r = this.job.it.next();
      rec = r.value;
      this.job = null;
    } else {
      const t0 = performance.now();
      rec = buildChunk(this, cx, cz);
      this.buildMs = (this.buildMs || 0) * 0.8 + (performance.now() - t0) * 0.2;
    }
    this._finishChunk(key, rec);
    return rec;
  }

  _ensureLights(cx, cz) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const k = this._key(cx + dx, cz + dz);
      if (!this._lightChunks?.has(k)) {
        this._registerChunkLights(cx + dx, cz + dz);
        (this._lightChunks = this._lightChunks || new Set()).add(k);
      }
    }
  }

  _finishChunk(key, rec) {
    this.world.group.add(rec.group);
    this.chunks.set(key, rec);
    // critter exits: wall grilles + floor drains
    const anchor = new THREE.Object3D();
    rec.statics.push(anchor);
    for (const v of rec.vents) this.critters?.addVent(new THREE.Vector3(...v.pos), anchor, new THREE.Vector3(...v.inside));
    for (const d of rec.layout.drains) {
      const x = rec.cx * CHUNK_M + d.x, z = rec.cz * CHUNK_M + d.z;
      this.critters?.addVent(new THREE.Vector3(x, 0.15, z), anchor, new THREE.Vector3(x, -0.07, z));
    }
    // ladders
    for (const s of rec.ladders) {
      let dev = this.world.devices.get(s.id);
      if (!dev) {
        dev = new PoolLadder(this.world, s.id, s);
        this.world.addDevice(dev);
      }
      (rec.roomDevices = rec.roomDevices || []).push(dev);
    }
    if (rec.floatMesh) this.prepStatic(rec.floatMesh, rec);
    if (rec.curtains?.length) {
      const cm = this.fx.curtainMesh(rec.curtains);
      if (cm) { cm.userData.noRefl = true; rec.group.add(cm); rec.curtainMesh = cm; this.reflection.hide.add(cm); }
    }
    for (const room of rec.layout.specials) decoratePoolRoom(this, room, rec);
    // room furniture: never mirrored, merged per material
    for (const o of rec.statics || []) if (o.parent === rec.group && o !== rec.floatMesh) o.userData.noRefl = true;
    batchStatics(this, rec);
    rec.reflSkip = rec.group.children.filter((o) => o.userData.noRefl);
    if (net.isHost) this._populate(key);
  }

  _unloadChunk(key) {
    const rec = this.chunks.get(key);
    if (!rec) return;
    if (rec.waterMesh) this.reflection.meshes.delete(rec.waterMesh);
    if (rec.spillMesh) this.reflection.meshes.delete(rec.spillMesh);
    if (rec.shaftMesh) this.reflection.hide.delete(rec.shaftMesh);
    if (rec.curtainMesh) { this.reflection.hide.delete(rec.curtainMesh); rec.curtainMesh.geometry.dispose(); }
    super._unloadChunk(key);
  }

  floatMesh(list) {
    const im = new THREE.InstancedMesh(floatGeometry(), floatMaterial(), list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
    const cols = [new THREE.Color(0x1f5fbf), new THREE.Color(0xf2f2ee)];
    list.forEach((f, i) => {
      q.setFromAxisAngle(new THREE.Vector3(f.axis === 'x' ? 0 : 1, 0, f.axis === 'x' ? 1 : 0), Math.PI / 2);
      m.compose(new THREE.Vector3(f.x, f.y, f.z), q, s);
      im.setMatrixAt(i, m);
      im.setColorAt(i, cols[f.c]);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = true;
    im.userData.baseY = 0;
    im.userData.sharedGeo = true;
    return im;
  }

  // host: spawn a chunk's props the first time it is loaded
  _populate(key) {
    if (!net.isHost || this.populated.has(key)) return;
    const rec = this.chunks.get(key);
    if (!rec) return;
    this.populated.add(key);
    const ox = rec.cx * CHUNK_M, oz = rec.cz * CHUNK_M;
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (const sp of rec.layout.spawns) {
      const hh = poolHalfHeight(sp.type) ?? modelHalfHeight(sp.type);
      q.setFromEuler(e.set(0, sp.rotY || 0, 0));
      let y = (sp.y || 0) + hh + 0.02;
      if (sp.float) y = this.waterLevel + (floatOffsetOf(sp.type) ?? hh * 0.4);
      const mo = isPoolProp(sp.type) ? { variant: Math.floor(hash01(Math.round(sp.x * 10), Math.round(sp.z * 10), 5, this.seed) * 16) } : undefined;
      const p = this.world.props.spawn(sp.type, new THREE.Vector3(ox + sp.x, y, oz + sp.z), q, { sleep: true, state: sp.state, modelOpts: mo });
      if (p && sp.sunk) p._resting = true;
    }
    const rng = new RNG(hash3(rec.cx, rec.cz, 991, this.seed));
    for (const room of rec.layout.specials) populatePoolRoom(this, room, rec, rng);
  }

  // ---------------------------------------------------------------
  _updateStreaming() {
    const centers = this._streamCenters();
    this._registerLights(centers);
    const local = centers[0];
    const want = new Map();
    centers.forEach((c, idx) => {
      const ccx = Math.floor(c.x / CHUNK_M), ccz = Math.floor(c.z / CHUNK_M);
      const r = idx === 0 ? LOAD_R : 1;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const k = this._key(ccx + dx, ccz + dz);
        const cxw = (ccx + dx + 0.5) * CHUNK_M, czw = (ccz + dz + 0.5) * CHUNK_M;
        const d = Math.hypot(cxw - local.x, czw - local.z);
        if (!want.has(k) || want.get(k) > d) want.set(k, d);
      }
    });
    const missing = [...want.entries()].filter(([k]) => !this.chunks.has(k)).sort((a, b) => a[1] - b[1]);
    // the chunk under / next to a player is built at once; farther ones in time slices
    for (const [k, d] of missing) {
      if (d < CHUNK_M * 0.85) { const [cx, cz] = k.split(',').map(Number); this._buildChunk(cx, cz); }
    }
    if (!this.job) {
      const next = missing.find(([k]) => !this.chunks.has(k));
      if (next) {
        const [cx, cz] = next[0].split(',').map(Number);
        this._ensureLights(cx, cz);
        const out = {};
        this.job = { key: next[0], cx, cz, it: buildChunkSteps(this, cx, cz, out), out, ms: 0 };
      }
    }
    if (this.job) {
      const t0 = performance.now();
      let r;
      let ts = t0;
      do {
        r = this.job.it.next();
        const now = performance.now();
        this.job.step = Math.max(this.job.step || 0, now - ts);
        ts = now;
      } while (!r.done && ts - t0 < SLICE_MS);
      this.job.ms += ts - t0;
      if (r.done) {
        const job = this.job;
        this.job = null;
        this.buildMs = (this.buildMs || 0) * 0.8 + job.ms * 0.2;
        // dev stats: total main-thread ms per streamed chunk and its longest single step
        (this.buildLog = this.buildLog || []).push({ k: job.key, ms: +job.ms.toFixed(1), step: +job.step.toFixed(1) });
        if (this.buildLog.length > 32) this.buildLog.shift();
        if (!this.chunks.has(job.key)) this._finishChunk(job.key, r.value);
      }
    }
    for (const k of [...this.chunks.keys()]) {
      if (want.has(k)) continue;
      const [cx, cz] = k.split(',').map(Number);
      const far = centers.every((c) => Math.max(Math.abs(Math.floor(c.x / CHUNK_M) - cx), Math.abs(Math.floor(c.z / CHUNK_M) - cz)) > UNLOAD_R);
      if (far) this._unloadChunk(k);
    }
  }

  // drop a half-built chunk: its colliders may already be in the physics world
  _abortJob() {
    const job = this.job;
    this.job = null;
    const rec = job?.out?.rec;
    if (!rec) return;
    for (const c of rec.physicsColliders) this.world.physics.removeCollider(c);
    rec.physicsColliders.length = 0;
    rec.group.traverse((o) => {
      if (o === rec.waterMesh || o === rec.spillMesh) this.reflection.meshes.delete(o);
      if (o === rec.shaftMesh) this.reflection.hide.delete(o);
      if (o.isMesh && o.geometry && !o.userData.sharedGeo) o.geometry.dispose();
    });
  }

  shiftChunk(cx, cz, variant) {
    const key = this._key(cx, cz);
    if (this.job?.key === key) this._abortJob();
    super.shiftChunk(cx, cz, variant);
  }

  // ---------------------------------------------------------------
  update(dt) {
    this.time += dt;
    this._updateStreaming();
    const day = this.game.day.day;
    if (day !== this.dayApplied) this._applyDayLights(day);
    const inst = this.game.day.instability();
    const col = this.game.day.collapse();
    this.field.uniforms.uCollapse.value = col * 0.8;
    this.field.tint.setRGB(1, 1 - col * 0.55, 1 - col * 0.7);
    if (col > 0) this.field.dirty = true;
    this._updateWater(dt, inst, col);
    this._updateAtmosphere(dt, inst, col);
    // explored cells (watch map)
    const lp = this.game.local.pos;
    if (!this._lostDone && Math.hypot(lp.x - 12, lp.z - 12) > 150) { this._lostDone = true; profile.unlock('lost'); }
    const ci = Math.floor(lp.x / CELL), cj = Math.floor(lp.z / CELL);
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) this.visited.add(`${i},${j}`);
    this._syncWatchMap(dt);
    this._cull(dt);
    if (net.isHost) this._relocateCrates();
    this.mission.update(dt);
    this.monsters.update(dt);
    this.anomalies.update(dt);
    this.critters.update(dt);
    this.creatures?.update(dt);
    this.waterplay?.update(dt);
    this.fx.update(dt);
    this._updateLightLevel();
  }

  fadeIn() { this.fadeT = 0.35; }

  // distance culling: the halls are wide open, so small loose props drop out sooner than big ones
  _cull(dt) {
    this._cullT = (this._cullT || 0) - dt;
    if (this._cullT > 0) return;
    this._cullT = 0.2;
    const cam = engine.camera.position;
    const half = CHUNK_M / 2;
    for (const rec of this.chunks.values()) {
      const dx = Math.max(0, Math.abs(cam.x - (rec.cx + 0.5) * CHUNK_M) - half), dz = Math.max(0, Math.abs(cam.z - (rec.cz + 0.5) * CHUNK_M) - half);
      rec.group.visible = dx * dx + dz * dz < 46 * 46;
    }
    for (const p of this.world.props.props.values()) {
      const r = p.radius ?? 0.5;
      const lim = r < 0.15 ? 16 : r < 0.3 ? 24 : r < 0.6 ? 34 : 42;
      p.root.visible = p.root.position.distanceToSquared(cam) < lim * lim;
    }
  }

  ripple(x, z, s = 1) { this.waterMaterial.userData.addRipple(x, z, s, this.time); }

  _updateWater(dt, inst, col) {
    // pools rise from day 5, overflow onto the decks by day 7
    const rise = clamp((inst - 0.58) / 0.42, 0, 1) * 0.16;
    this.waterLevel = WATER_Y + rise + Math.sin(this.time * 0.4) * 0.003 * (1 + col * 4);
    PU.uWaterY.value = this.waterLevel;
    this.reflection.height = this.waterLevel;
    const wm = this.waterMaterial;
    wm.uniforms.uLevel.value = this.waterLevel;
    wm.userData.tick(this.time);
    wm.uniforms.uMurk.value = 0.12 + clamp((inst - 0.45) / 0.55, 0, 1) * 0.8 + col * 0.1;
    wm.uniforms.uRippleAmp.value = 1 + inst * 0.6 + col * 1.5;
    // clear turquoise -> green -> black
    const m = clamp((inst - 0.3) / 0.7, 0, 1);
    // murky green-black from the start, darker and greener as the days go on
    PU.uAbsorb.value.set(0.95 + m * 0.5 + col * 1.2, 0.42 + m * 0.25 + col * 1.0, 0.55 + m * 0.45 + col * 1.1);
    PU.uScatter.value.setRGB(0.006 + m * 0.012, 0.034 - m * 0.012, 0.028 - m * 0.014);
    PU.uDecay.value = inst;
    PU.uCaustStr.value = 1 - m * 0.5 - col * 0.4;
    // underwater lamps: steady, then failing
    const d = this.game.day.day;
    let glow = d <= 4 ? 1 : d === 5 ? 0.75 : d === 6 ? 0.45 : 0.18;
    if (d >= 5) glow *= Math.sin(this.time * 17.3) + Math.sin(this.time * 5.1) > 1.6 - (d - 5) * 0.3 ? 0.2 : 1;
    PU.uPoolGlow.value = glow * (1 - col * 0.7);
    for (const rec of this.chunks.values()) {
      if (rec.waterMesh) rec.waterMesh.position.y = this.waterLevel - rec.waterMesh.userData.baseY;
      if (rec.spillMesh) {
        const lvl = this.waterLevel - rec.spillMesh.userData.baseY;
        rec.spillMesh.visible = lvl > 0.004 && rec.group.visible;
        rec.spillMesh.position.y = lvl;
      }
      if (rec.floatMesh) rec.floatMesh.position.y = this.waterLevel - WATER_Y + Math.sin(this.time * 1.3 + rec.cx * 3 + rec.cz) * 0.004;
      if (rec.algaeMesh) { rec.algaeMesh.position.y = this.waterLevel - WATER_Y + Math.sin(this.time * 0.9 + rec.cx) * 0.003; rec.algaeMesh.updateMatrix(); rec.algaeMesh.updateMatrixWorld(); }
      if (rec.curtainMesh) { rec.curtainMesh.visible = rec.group.visible; }
    }
    // reflections whenever water is close
    this.reflection.needed = false;
    const lp = this.game.local.pos;
    for (const rec of this.chunks.values()) {
      if (!rec.group.visible || (!rec.waterMesh && !(rec.spillMesh?.visible))) continue;
      const dd = Math.hypot((rec.cx + 0.5) * CHUNK_M - lp.x, (rec.cz + 0.5) * CHUNK_M - lp.z);
      if (dd < CHUNK_M * 1.25) { this.reflection.needed = true; break; }
    }
    if (this.reflection.needed) this.reflection.update(engine.scene, engine.camera);
    // footstep / wading ripples for everyone in the water
    this.ripT -= dt;
    if (this.ripT <= 0) {
      this.ripT = 0.28;
      const movers = [this.game.local];
      for (const r of this.game.remotes.values()) if (r.inWorld) movers.push(r);
      for (const p of movers) {
        if (!p.pos) continue;
        const wd = this.waterDepth(p.pos.x, p.pos.z);
        if (wd > 0.02 && p.pos.y < this.waterLevel + 0.05) {
          const sp = p.realSpeed ?? (p.vel ? Math.hypot(p.vel.x, p.vel.z) : 0.5);
          if (sp > 0.3 || Math.random() < 0.15) this.ripple(p.pos.x, p.pos.z, Math.min(1.2, 0.35 + sp * 0.2));
        }
      }
      for (const v of this.monsters.views.values()) {
        if (this.waterDepth(v.pos.x, v.pos.z) > 0.02 && Math.random() < 0.6) this.ripple(v.pos.x, v.pos.z, 0.8);
      }
    }
  }

  _updateAtmosphere(dt, inst, col) {
    const cam = engine.camera.position;
    // local brightness drives fog colour / env reflections so dark rooms stay dark
    _v.set(cam.x, Math.min(cam.y, 2.2), cam.z);
    this.sampleLight(_v, _c);
    const lum = clamp(_c.r * 0.3 + _c.g * 0.59 + _c.b * 0.11, 0, 1.6);
    this.envLum += (lum - this.envLum) * Math.min(1, dt * 1.5);
    const k = clamp(this.envLum / 0.5, 0, 1);
    const scene = engine.scene;
    // underwater?
    const under = cam.y < this.waterLevel - 0.02 && this.waterDepth(cam.x, cam.z) > 0.25;
    this.underwater += ((under ? 1 : 0) - this.underwater) * Math.min(1, dt * 10);
    const u = this.underwater;
    const fogC = scene.fog.color;
    fogC.copy(_fogDark).lerp(_fogLit, k * (1 - inst * 0.35));
    fogC.lerp(_c2.copy(_fogWater).multiplyScalar(0.25 + k * 0.75 + PU.uPoolGlow.value * 0.3), u);
    if (col > 0) fogC.lerp(_fogBlood, col * 0.6);
    scene.fog.density = 0.013 + inst * 0.012 + col * 0.03 + u * 0.48;
    scene.background.copy(fogC);
    scene.environmentIntensity = (0.05 + 0.2 * k) * (1 - col * 0.5);
    this.field.uniforms.uAmbient.value.setRGB(0.006 + 0.018 * k, 0.007 + 0.021 * k, 0.008 + 0.022 * k);
    const pp = engine.post.params;
    pp.uTint.value.setRGB(0.96 - u * 0.4, 1.0 - u * 0.1, 0.99 - u * 0.15);
    pp.uSat.value = 0.86 - u * 0.2;
    const muf = Math.round(u * 0.75 * 50) / 50;
    if (muf !== this._muf) { this._muf = muf; audio.setMuffle?.(muf); }
    if (this.fadeT > 0) {
      this.fadeT -= dt;
      if (!this.game.cutscene) pp.uFade.value = Math.max(0, pp.uFade.value - dt * 2.5);
    }
  }

  _updateLightLevel() {
    super._updateLightLevel();
    if (this.waterLoop) {
      const p = this.game.local.pos;
      let near = 9;
      const i0 = Math.floor(p.x / CELL), j0 = Math.floor(p.z / CELL);
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const c = this.cellAt(i0 + di, j0 + dj);
        if (c?.water) near = Math.min(near, Math.hypot(di, dj) * CELL);
      }
      this.waterLoop.setVolume(clamp(1 - near / 9, 0, 1) * 0.5);
    }
  }

  // supply crates must crash through a normal-height ceiling onto a dry floor
  _relocateCrates() {
    const m = this.mission;
    for (const c of m.pendingCrates) {
      if (c._pool) continue;
      c._pool = true;
      const ok = (i, j) => {
        const cl = this.cellAt(i, j);
        return cl && !cl.pool && !cl.water && cl.ceil <= HEIGHT + 0.01 && !cl.vault && !(cl.special && cl.special.kind !== 'spawn');
      };
      const i0 = Math.floor(c.pos.x / CELL), j0 = Math.floor(c.pos.z / CELL);
      if (ok(i0, j0)) continue;
      let best = null;
      // the radio may sit in a tall natatorium: look up to ~24 m for a normal ceiling
      for (let r = 1; r <= 8 && !best; r++) {
        for (let dj = -r; dj <= r && !best; dj++) for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          if (ok(i0 + di, j0 + dj)) { best = [i0 + di, j0 + dj]; break; }
        }
      }
      if (best) c.pos.set((best[0] + 0.5) * CELL + (Math.random() - 0.5) * 0.8, 0, (best[1] + 0.5) * CELL + (Math.random() - 0.5) * 0.8);
    }
  }

  // The watch's map reads walls through the Yellow Rooms layout module: mirror our walls into its
  // cache for the chunks around the player (pool rims are drawn as low walls).
  _syncWatchMap(dt) {
    this.mapT -= dt;
    if (this.mapT > 0) return;
    this.mapT = 0.5;
    const p = this.game.local.pos;
    const ccx = Math.floor(p.x / CHUNK_M), ccz = Math.floor(p.z / CHUNK_M);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ccx + dx, cz = ccz + dz;
      const v = this.variantFn(cx, cz);
      const mine = getLayout(this.seed, cx, cz, v);
      const yl = yellowLayout(this.seed, cx, cz, v);
      if (yl._poolSynced === mine) continue;
      yl.edgesN.set(mine.edgesN);
      yl.edgesW.set(mine.edgesW);
      for (const pl of mine.pools) {
        for (let li = pl.rx; li < pl.rx + pl.w; li++) {
          yl.edgesN[pl.rz * CHUNK + li] = W.LOW;
          if (pl.rz + pl.h < CHUNK) yl.edgesN[(pl.rz + pl.h) * CHUNK + li] = W.LOW;
        }
        for (let lj = pl.rz; lj < pl.rz + pl.h; lj++) {
          yl.edgesW[lj * CHUNK + pl.rx] = W.LOW;
          if (pl.rx + pl.w < CHUNK) yl.edgesW[lj * CHUNK + pl.rx + pl.w] = W.LOW;
        }
      }
      yl._poolSynced = mine;
    }
  }

  // ---------------------------------------------------------------
  // physics: buoyancy, drag and a slow drifting current for props in the water (host)
  _buoyancy(fdt) {
    if (!net.isHost) return;
    const g = 11.5;
    const t = this.time;
    for (const p of this.world.props.props.values()) {
      const b = p.body;
      if (!b || p.frozen || p.dead || p.sinking) continue;
      if (b.isSleeping()) continue;
      const tr = b.translation();
      const wd = this.waterDepth(tr.x, tr.z);
      if (wd <= 0.01) { if (p._inWater) { p._inWater = false; b.setLinearDamping(p._ld ?? 0.15); b.setAngularDamping(p._ad ?? 0.35); } continue; }
      const level = this.waterLevel;
      const hh = Math.max(0.03, p._halfH ?? (p.bounds ? (p.bounds.max.y - p.bounds.min.y) / 2 : 0.15));
      const sub = clamp((level - (tr.y - hh)) / (2 * hh), 0, 1);
      if (sub <= 0) continue;
      if (!p._inWater) {
        p._inWater = true;
        p._ld = 0.15; p._ad = 0.35;
        const v = b.linvel();
        if (v.y < -1.5) {
          const s = Math.min(1, -v.y / 7);
          this.world.fxAll({ k: 'splash', p: [tr.x, level + 0.02, tr.z], n: Math.round(8 + s * 22), y: level, i: s });
          this.world.fxAll({ k: 'pripple', p: [tr.x, level, tr.z], s: 0.8 + s });
          this.world.noise.emit(new THREE.Vector3(tr.x, level, tr.z), 6 + s * 14, 'splash');
        }
      }
      const buoy = buoyancyOf(p);
      const m = b.mass();
      const up = m * g * buoy * sub;
      // slow swirling current
      const cx = Math.sin(tr.z * 0.21 + t * 0.07) * 0.6, cz = Math.cos(tr.x * 0.19 - t * 0.05) * 0.6;
      const surface = sub < 0.999 ? 1 : 0.3;
      b.applyImpulse({ x: cx * m * 0.06 * surface * fdt, y: up * fdt, z: cz * m * 0.06 * surface * fdt }, true);
      b.setLinearDamping(1.2 + sub * 1.8);
      b.setAngularDamping(1.0 + sub * 2.0);
    }
  }

  _onPropSpawned(p) {
    const m = p.model;
    if (m && m.halfHeight !== undefined) p._halfH = m.floatHalf ?? m.halfHeight;
  }

  // ---------------------------------------------------------------
  // Queries
  cell(x, z) {
    // water cells are hidden from the shared systems (no critters, monster spawns or exits in pools)
    const c = this.cellAt(Math.floor(x / CELL), Math.floor(z / CELL));
    if (!c || c.water || c.pool || c.void) return null;
    return c;
  }

  waterInfected(x, z) {
    const c = this.cellAt(Math.floor(x / CELL), Math.floor(z / CELL));
    return !!(c && c.infected && (c.pool || c.water || c.spill));
  }

  floorY(x, z) {
    const c = this.cellAt(Math.floor(x / CELL), Math.floor(z / CELL));
    if (!c) return 0;
    if (c.pool) return this._poolFloor(c, x, z);
    return c.fy;
  }

  ceilingY(x, z) {
    const c = this.cellAt(Math.floor(x / CELL), Math.floor(z / CELL));
    return c ? c.ceil : HEIGHT;
  }

  _poolFloor(c, x, z) {
    const p = c.pool;
    const ox = (c.i - c.li) * CELL, oz = (c.j - c.lj) * CELL;
    const [s, t] = poolCoords(p, ox, oz, x, z);
    return poolFloorAt(p, clamp(s, 0, p.L - 1e-3), clamp(t, 0, 1));
  }

  waterDepth(x, z) {
    const c = this.cellAt(Math.floor(x / CELL), Math.floor(z / CELL));
    if (!c) return 0;
    const lvl = this.waterLevel ?? WATER_Y;
    if (c.pool) return Math.max(0, lvl - this._poolFloor(c, x, z));
    if (c.floor === 'sunk') return Math.max(0, lvl - SUNK_Y);
    if (c.spill) return Math.max(0, lvl - c.fy);
    return 0;
  }

  surfaceAt(x, z) {
    const c = this.cellAt(Math.floor(x / CELL), Math.floor(z / CELL));
    if (!c) return 'hard';
    if (c.roomStyle === 'yellow') return 'carpet';
    if (c.roomStyle === 'plant') return 'concrete';
    return 'hard';
  }

  passable(i, j, d) {
    const v = this.variantFn;
    let t;
    if (d === 0) t = wallN(this.seed, i, j, v);
    else if (d === 2) t = wallN(this.seed, i, j + 1, v);
    else if (d === 3) t = wallW(this.seed, i, j, v);
    else t = wallW(this.seed, i + 1, j, v);
    if (!wallPassable(t)) return false;
    const a = this.cellAt(i, j);
    const b = this.cellAt(i + [0, 1, 0, -1][d], j + [-1, 0, 1, 0][d]);
    if (!a || !b) return true;
    if (a.pool !== b.pool) {
      const p = a.pool || b.pool;
      const side = poolStairSide(p);
      if (side === '*') return true;
      const fromPool = a.pool ? d : (d + 2) % 4;
      return 'NESW'[fromPool] === side;
    }
    return true;
  }

  cellCost(i, j) {
    const c = this.cellAt(i, j);
    if (!c) return 0;
    return c.pool ? 3 : c.water ? 1 : 0;
  }

  sampleLight(pos, out) {
    out.setRGB(0, 0, 0);
    for (const l of this._lightsNear(pos.x, pos.z)) {
      if (l.intensity <= 0.001) continue;
      const dx = l.x - pos.x, dy = l.y - pos.y, dz = l.z - pos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > l.radius) continue;
      let w = (1 / (1 + 0.16 * d * d)) * Math.max(0, 1 - (d / l.radius) ** 4) * 0.8;
      w *= this.occluder(pos.x, pos.z, l.x, l.z, pos.y, l.y);
      if (w <= 0) continue;
      const c = l.override || l.color;
      out.r += c.r * this.field.tint.r * l.intensity * w;
      out.g += c.g * this.field.tint.g * l.intensity * w;
      out.b += c.b * this.field.tint.b * l.intensity * w;
    }
    // underwater lamps
    if (pos.y < (this.waterLevel ?? WATER_Y)) {
      const gl = PU.uPoolGlow.value * 0.25;
      out.r += 0.05 * gl; out.g += 0.12 * gl; out.b += 0.16 * gl;
    }
    out.r += 0.02; out.g += 0.022; out.b += 0.024;
    return out;
  }

  sampleKindAt(hit) {
    if (!hit) return null;
    const fromMon = this.monsters?.sampleAt(hit.point);
    if (fromMon) return fromMon;
    if (hit.ud?.kind === 'critter') return 'rat';
    const x = hit.point.x, z = hit.point.z;
    if (this.waterDepth(x, z) > 0.02 && hit.point.y < this.waterLevel + 0.15) return this.waterInfected(x, z) ? 'infected_water' : 'flood_water';
    if (hit.ud?.kind === 'static') {
      const h = hash01(Math.floor(x * 2), Math.floor(z * 2), Math.floor(hit.point.y * 2), this.seed);
      const nearWater = Math.abs(hit.point.y - this.waterLevel) < 0.35;
      if (nearWater && h < 0.6) return 'black_mold';
      if (hit.normal.y > 0.7 && h < 0.18) return 'black_mold';
      if (Math.abs(hit.normal.y) < 0.3 && h < 0.12) return 'wallpaper_growth';
    }
    return null;
  }

  photoSubjects(camera) {
    const out = [];
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const consider = (pos, subject, key, value) => {
      const d = pos.distanceTo(camera.position);
      if (d > 16) return;
      const dir = pos.clone().sub(camera.position).normalize();
      if (dir.dot(fwd) < 0.85) return;
      if (!this.world.physics.lineOfSight(camera.position, pos)) return;
      out.push({ subject, key, value: Math.round(value * (1 - d / 22)), dist: d });
    };
    for (const p of this.world.props.props.values()) {
      if (p.sinking) consider(p.root.position, this.waterDepth(p.root.position.x, p.root.position.z) > 0.05 ? 'DROWNING FURNITURE' : 'SINKING FURNITURE', `sink:${p.id}`, 45);
      else if (p.frozen && p.root.position.y < -0.1 && p.type !== 'dart' && this.waterDepth(p.root.position.x, p.root.position.z) <= 0.01) consider(p.root.position, 'CLIPPED OBJECT', `clip:${p.id}`, 30);
    }
    for (const rec of this.chunks.values()) {
      for (const room of rec.layout.specials) {
        const c = new THREE.Vector3((rec.cx * CHUNK + room.rx + room.w / 2) * CELL, 1.2, (rec.cz * CHUNK + room.rz + room.h / 2) * CELL);
        if (room.kind === 'yellow_bleed') consider(c, 'DIMENSIONAL BLEED (LEVEL 0)', `room:${rec.cx},${rec.cz}`, 90);
        if (room.kind === 'stairs_water') consider(c.setY(-0.3), 'STAIRS INTO NOTHING', `room:${rec.cx},${rec.cz}`, 60);
        if (room.kind === 'drowned_room') consider(c.setY(-0.6), 'DROWNED OFFICE', `room:${rec.cx},${rec.cz}`, 70);
        if (room.kind === 'endless_hall') consider(c, 'NON-EUCLIDEAN CORRIDOR', `room:${rec.cx},${rec.cz}`, 70);
      }
      if (rec.deadClone) consider(rec.deadClone.clone().setY(0.3), 'DECEASED PREDECESSOR', `dc:${rec.cx},${rec.cz}`, 40);
    }
    for (const g of this.mission?.generators || []) if (g.running) consider(g.root.position.clone().setY(0.8), `${g.label} (RUNNING)`, `gen:${g.id}`, 15);
    this.fx?.photoSubjects(consider);
    this.creatures?.photoSubjects(camera, consider);
    return out;
  }

  playFx(m, p) {
    if (m.k === 'pripple' && p) { this.ripple(p.x, p.z, m.s ?? 1); return; }
    super.playFx(m, p);
  }

  serialize() {
    const o = super.serialize();
    if (this.raft) o.raft = this.raft.serializeState();
    return o;
  }

  applySync(d) {
    super.applySync(d);
    if (d.raft) this.raft?.applyState(d.raft);
  }

  // player hooks (see waterplay.js)
  waterMotion(pl, dt, canControl) { return this.waterplay?.waterMotion(pl, dt, canControl); }
  toolAction(kind, item, player) { return this.waterplay?.toolAction(kind, item, player) ?? null; }
  onItemUsed(type) { this.waterplay?.onItemUsed(type); }

  // ---------------------------------------------------------------
  // dev helpers (tools/poolshots.mjs)
  debugViewpoints() {
    const out = [];
    const c = this.spawnCenter();
    out.push({ name: 'spawn', p: [c.x + 0.4, 0.02, c.z - 0.6], yaw: 0.2 });
    out.push({ name: 'dock', p: [c.x + 1.2, 0.02, CANAL_Z1 + 2.2], yaw: -Math.PI / 2 - 0.35, pitch: -0.12 });
    out.push({ name: 'hall0_wide', p: [CELL * 7.5, 0.02, 0.9], yaw: -Math.PI / 2 - 0.45, pitch: 0.05 });
    if (this.raft) out.push({ name: 'raft', p: [this.raft.disp.x - 0.6, this.raft.root.position.y + 0.02, this.raft.disp.z - 0.2], yaw: -Math.PI / 2, pitch: -0.1 });
    for (const rec of this.chunks.values()) {
      if (rec.layout.void) continue;
      const ox = rec.cx * CHUNK_M;
      if (rec.layout.gate) out.push({ name: `gate_${rec.cx}`, p: [ox - 7, 0.02, CANAL_Z1 + 1.2], yaw: -Math.PI / 2 - 0.25, pitch: 0.08 });
      for (const d of rec.layout.decor) {
        if (d.kind === 'mushroom') out.push({ name: `mushroom_${rec.cx}`, p: [ox + d.x + 3.5, 0.02, (BACK - 0.3) * CELL], yaw: Math.PI * 0.62, pitch: -0.08 });
        if (d.kind === 'showers') { out.push({ name: `showers_${rec.cx}`, p: [d.x + 0.2, 0.02, 1.9], yaw: 0.35, pitch: 0.12 }); }
      }
      for (const room of rec.layout.specials) {
        const x = (rec.cx * CHUNK + room.rx + room.w / 2) * CELL, z = (room.rz - 0.4) * CELL;
        out.push({ name: `room_${room.kind}`, p: [x, 0.02, z], yaw: Math.PI, pitch: -0.05 });
      }
    }
    return out;
  }

  debugChunkStats() {
    const out = [];
    for (const rec of this.chunks.values()) {
      let calls = 0, tris = 0;
      rec.group.traverse((o) => {
        if (!o.isMesh) return;
        calls++;
        const g = o.geometry;
        tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
      });
      out.push({ k: `${rec.cx},${rec.cz}`, calls, tris: Math.round(tris) });
    }
    return out;
  }

  // ---------------------------------------------------------------
  dispose() {
    if (this.job) this._abortJob();
    const i = this.world.physics.beforeStep.indexOf(this._buoy);
    if (i >= 0) this.world.physics.beforeStep.splice(i, 1);
    this.dripLoop?.stop(0.3);
    this.waterLoop?.stop(0.3);
    this.fx?.dispose();
    this.creatures?.dispose();
    this.waterplay?.dispose();
    audio.setMuffle?.(0);
    super.dispose();
    const s = engine.scene;
    if (this.prevEnv) {
      s.environment = this.prevEnv.env;
      s.environmentIntensity = this.prevEnv.int;
      engine.renderer.toneMappingExposure = this.prevEnv.exp;
      if (engine.post.bloom && this.prevEnv.bloom !== undefined) { engine.post.bloom.strength = this.prevEnv.bloom; engine.post.bloom.threshold = this.prevEnv.thr ?? 0.92; }
    }
    s.background = this.prevEnv?.bg ?? new THREE.Color(0x000000);
    const pp = engine.post.params;
    for (const [k, v] of Object.entries(this.prevPost || {})) {
      const u = pp[k];
      if (!u) continue;
      if (typeof v === 'number') u.value = v;
      else u.value.copy(v);
    }
  }
}

export { CELL, CHUNK, HEIGHT, TALL };
