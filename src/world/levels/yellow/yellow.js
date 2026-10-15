// Level 0 — The Yellow Rooms. Endless procedurally streamed office-yellow maze with
// dynamic baked fluorescent lighting, flooded sectors, maintenance areas and special rooms.
import * as THREE from 'three';
import { engine } from '../../../core/engine.js';
import { net } from '../../../net/net.js';
import { audio } from '../../../audio/audio.js';
import { profile } from '../../../core/profile.js';
import { hash01, RNG, hash3 } from '../../../core/rng.js';
import { LightField, GRID_FALL } from '../../../gfx/bakedlight.js';
import { PlanarReflection, makeWaterMaterial } from '../../../gfx/water.js';
import { CELL, CHUNK, CHUNK_M, HEIGHT, getLayout, cellInfo, wallN, wallW, wallPassable, missionChunks, clearLayoutCache, W } from './layout.js';
import { buildChunk, cellLightSpec, makeOccluder, makeAO } from './chunkbuilder.js';
import { decorateRoom, populateRoom } from './rooms.js';
import { Placer } from './placement.js';
import { modelHalfHeight } from '../../../entities/catalog.js';
import { Mission } from '../../../game/mission.js';
import { MonsterManager } from '../../../game/monsters.js';
import { Anomalies } from '../../../game/anomalies.js';
import { Critters } from '../../../game/critters.js';
import { GridNav } from '../../nav.js';

const LOAD_R = 2;     // chunks around players that get built
const UNLOAD_R = 3;   // beyond this they're dropped
const LIGHT_R = 3;    // light registration radius (chunks)

const DEAD_FRAC = [0, 0, 0.0, 0.03, 0.06, 0.11, 0.17, 0.26];
const FOG_DENSITY = 0.03;
// haze colour in well-lit halls: a dim brown murk, so depth reads as the light giving out rather than grey wash
const FOG_LIT = new THREE.Color(0x3f3a27);
const FOG_DARK = new THREE.Color(0x0e0c07);  // in dead / dark sectors
// field light scale (the probes were calibrated at 0.56)
const LIGHT_SCALE = 0.78;
const FLICK_FRAC = [0, 0.0, 0.02, 0.05, 0.09, 0.14, 0.2, 0.3];

const _v = new THREE.Vector3();
const _c = new THREE.Color();

export class YellowLevel {
  constructor(world, desc) {
    this.world = world;
    this.game = world.game;
    this.desc = desc;
    this.seed = desc.seed >>> 0;
    this.depth = desc.depth || 1;
    this.name = 'LEVEL 0 — THE YELLOW ROOMS';
    this.field = world.field;
    this.chunks = new Map();
    this.populated = new Set();
    this.variants = new Map();
    this.lightCells = new Set(); // registered light texel keys
    this.devicesByRoom = new Map();
    this.buildQueue = [];
    this.reverb = 'backrooms';
    this.variantFn = (cx, cz) => this.variants.get(`${cx},${cz}`) || 0;
    this.occluder = makeOccluder(this.seed, this.variantFn);
    this.ao = makeAO(this.seed, this.variantFn);
    this.lightsNear = (x, z) => this._lightsNear(x, z);
    this.reflection = new PlanarReflection(engine.renderer, 0.09, engine.qualityName === 'high' ? 0.6 : 0.4);
    this.reflection.enabled = engine.qualityName !== 'low';
    this.waterMaterial = makeWaterMaterial(this.reflection, this.field);
    this.missionChunks = missionChunks(this.seed);
    this.nav = new GridNav(this);
    this.dayApplied = 0;
    this.visited = new Set(); // explored cells (for the watch map)
    this.time = 0;
    clearLayoutCache();
  }

  // ---------------------------------------------------------------
  async build(onProgress) {
    const scene = engine.scene;
    scene.background = new THREE.Color(0x0b0904);
    // humid haze: the fog colour follows the local light level (see update), density rises with instability
    scene.fog = new THREE.FogExp2(0x3a3424, FOG_DENSITY);
    engine.scene.environmentIntensity = 0.14;
    // troffer pools: a steeper falloff (darker between fixtures and down the walls) at the same brightness
    // right under a fixture; CPU probes (sampleLight) and the outer-ring bake follow the same curve
    GRID_FALL.value = 0.28;
    this.field.uniforms.uAmbient.value.setRGB(0.006, 0.0055, 0.0035);
    this.field.uniforms.uLightScale.value = LIGHT_SCALE;
    this.field.uniforms.uGrid.value.set(CELL, HEIGHT - 0.04, 9, HEIGHT);
    this.hazeOn = engine.qualityName !== 'low';
    const pp = engine.post.params;
    pp.uTint.value.setRGB(1.02, 1.0, 0.9);
    pp.uSat.value = 1.0;
    pp.uGrain.value = 0.045;
    pp.uVignette.value = 0.46;
    // film grade: warm lifted blacks, slightly green-yellow mids, tamed highlights
    pp.uExposure.value = 1.06;
    pp.uLift.value.set(0.01, 0.009, 0.003);
    pp.uGamma.value.set(1.0, 1.01, 0.97);
    pp.uGain.value.set(1.0, 0.985, 0.93);
    pp.uRolloff.value = 0.25;
    pp.uContrast.value = 1.12;
    engine.renderer.toneMappingExposure = 0.95;
    this._fogCol = new THREE.Color();
    this.world.monsters = this.monsters = new MonsterManager(this);
    this.mission = new Mission(this);
    this.anomalies = new Anomalies(this);
    this.critters = new Critters(this);
    // initial chunks around spawn (blocking)
    const centers = [this.spawnCenter()];
    this._registerLights(centers);
    const need = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) need.push([dx, dz]);
    for (let i = 0; i < need.length; i++) {
      this._buildChunk(need[i][0], need[i][1]);
      onProgress?.((i + 1) / need.length, 'MATERIALIZING DIMENSION');
      await new Promise((r) => setTimeout(r, 0));
    }
    this.mission.build();
    this._applyDayLights(1, true);
  }

  spawnCenter() {
    return new THREE.Vector3(4 * CELL, 0, 4 * CELL);
  }

  spawnPoint(index = 0, lateJoin = false, arrival = false) {
    const c = this.spawnCenter();
    const offs = [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]];
    const o = offs[index % 4];
    const pos = new THREE.Vector3(c.x + o[0], arrival ? HEIGHT - 1.25 : 0.02, c.z + o[1]);
    if (lateJoin) pos.y = HEIGHT - 1.25;
    return { pos, yaw: Math.atan2(o[0], o[1]), arrival: arrival || lateJoin, vy: arrival || lateJoin ? -2 : 0 };
  }

  hostStart(desc) {
    this.mission.hostStart(desc);
    // populate initial chunks
    for (const key of this.chunks.keys()) this._populate(key);
  }

  startAudio() {
    this.ambience?.stop(1);
    this.ambience = audio.loop('ambience_backrooms', { bus: 'ambient', volume: 0.9 });
    this.humLoop?.stop(0.5);
    this.humLoop = audio.loop('hum', { bus: 'ambient', volume: 0.45 });
  }

  // ---------------------------------------------------------------
  _key(cx, cz) { return `${cx},${cz}`; }

  _lightsNear(x, z) {
    const out = [];
    const i0 = Math.floor(x / CELL), j0 = Math.floor(z / CELL);
    for (let j = j0 - 3; j <= j0 + 3; j++) {
      for (let i = i0 - 3; i <= i0 + 3; i++) {
        const l = this.field.get(LightField.texel(i, j));
        if (l && l.ci === i && l.cj === j) out.push(l);
      }
    }
    return out;
  }

  _registerChunkLights(cx, cz) {
    const layout = getLayout(this.seed, cx, cz, this.variantFn(cx, cz));
    for (const c of layout.cells) {
      const spec = cellLightSpec(c);
      const key = LightField.texel(c.i, c.j);
      if (!spec) {
        const ex = this.field.get(key);
        if (ex && ex.ci === c.i && ex.cj === c.j) this.field.remove(key);
        continue;
      }
      const ex = this.field.get(key);
      if (ex && ex.ci === c.i && ex.cj === c.j) continue;
      const l = this.field.add(key, spec.x, spec.y, spec.z, spec.color, spec.base, { mode: spec.mode, radius: spec.radius, seed: spec.seed });
      l.ci = c.i; l.cj = c.j;
      l.baseMode = spec.mode;
      l.cell = c;
      this._applyDayToLight(l, this.game.day.day);
      this.lightCells.add(key);
    }
  }

  _registerLights(centers) {
    const want = new Set();
    for (const c of centers) {
      const ccx = Math.floor(c.x / CHUNK_M), ccz = Math.floor(c.z / CHUNK_M);
      for (let dz = -LIGHT_R; dz <= LIGHT_R; dz++) for (let dx = -LIGHT_R; dx <= LIGHT_R; dx++) want.add(this._key(ccx + dx, ccz + dz));
    }
    this._lightChunks = this._lightChunks || new Set();
    for (const k of want) {
      if (!this._lightChunks.has(k)) {
        const [cx, cz] = k.split(',').map(Number);
        this._registerChunkLights(cx, cz);
        this._lightChunks.add(k);
      }
    }
    // unregister far chunks' lights
    for (const k of [...this._lightChunks]) {
      if (want.has(k)) continue;
      const [cx, cz] = k.split(',').map(Number);
      const far = centers.every((c) => Math.max(Math.abs(Math.floor(c.x / CHUNK_M) - cx), Math.abs(Math.floor(c.z / CHUNK_M) - cz)) > LIGHT_R + 1);
      if (!far) continue;
      for (let j = cz * CHUNK; j < cz * CHUNK + CHUNK; j++) for (let i = cx * CHUNK; i < cx * CHUNK + CHUNK; i++) {
        const key = LightField.texel(i, j);
        const l = this.field.get(key);
        if (l && l.ci === i && l.cj === j) this.field.remove(key);
      }
      this._lightChunks.delete(k);
    }
  }

  _applyDayToLight(l, day) {
    if (l.forced) return;
    const h = hash01(l.ci, l.cj, 77, this.seed);
    let mode = l.baseMode;
    if (h < DEAD_FRAC[day]) mode = 'dead';
    else if (h < DEAD_FRAC[day] + FLICK_FRAC[day] && mode === 'on') mode = 'flicker';
    if (this.poweredCells?.has(`${l.ci},${l.cj}`)) mode = 'on';
    if (mode !== l.mode) { l.mode = mode; l._force = true; this.field.dirty = true; }
  }

  _applyDayLights(day, quiet = false) {
    for (const l of this.field.lights.values()) if (l.ci !== undefined) this._applyDayToLight(l, day);
    this.dayApplied = day;
    if (!quiet) this.field.forceRefresh();
  }

  _buildChunk(cx, cz) {
    const key = this._key(cx, cz);
    if (this.chunks.has(key)) return this.chunks.get(key);
    // make sure all lights that can reach this chunk are registered
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const k = this._key(cx + dx, cz + dz);
      if (!this._lightChunks?.has(k)) {
        this._registerChunkLights(cx + dx, cz + dz);
        (this._lightChunks = this._lightChunks || new Set()).add(k);
      }
    }
    const t0 = performance.now();
    const rec = buildChunk(this, cx, cz);
    this.world.group.add(rec.group);
    this.buildMs = (this.buildMs || 0) * 0.8 + (performance.now() - t0) * 0.2;
    this.chunks.set(key, rec);
    // special rooms: static decor + devices
    for (const room of rec.layout.specials) {
      decorateRoom(this, room, rec);
    }
    if (net.isHost) this._populate(key);
    return rec;
  }

  _unloadChunk(key) {
    const rec = this.chunks.get(key);
    if (!rec) return;
    rec.group.removeFromParent();
    if (rec.waterMesh) this.reflection.meshes.delete(rec.waterMesh);
    rec.group.traverse((o) => { if (o.isMesh && o.geometry && !o.userData.sharedGeo) o.geometry.dispose(); });
    for (const c of rec.physicsColliders) this.world.physics.removeCollider(c);
    for (const b of rec.extraBodies || []) this.world.physics.removeBody(b);
    for (const o of rec.statics || []) this.world.unregisterDynamic(o);
    for (const d of rec.roomDevices || []) d.root.visible = false;
    this.critters?.removeVentsOf(rec);
    this.chunks.delete(key);
  }

  // static decor gets probe lighting (refreshed with the light field)
  prepStatic(o, rec) {
    o.updateMatrixWorld(true);
    this.world.registerDynamic(o);
    if (rec) (rec.statics = rec.statics || []).push(o);
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
    // every floor-standing spawn is checked against walls, pillars, doorways, wall vents and the props already
    // put down (pulled towards its cell centre / turned a quarter if needed, dropped if it still doesn't fit).
    // Items resting on a desk follow their desk: they are skipped with it.
    const placer = new Placer(this);
    for (const v of rec.layout.vents) {
      const x = ox + v.li * CELL, z = oz + v.lj * CELL;
      if (v.side === 'N') placer.reserveBox(x + CELL / 2 - 0.35, z, x + CELL / 2 + 0.35, z + 0.4);
      else placer.reserveBox(x, z + CELL / 2 - 0.35, x + 0.4, z + CELL / 2 + 0.35);
    }
    let base = null; // last desk-like spawn: {from: [x, z, rot], to: [x, z, rot]} or false when it was dropped
    for (const sp of rec.layout.spawns) {
      let x = ox + sp.x, z = oz + sp.z, rotY = sp.rotY || 0;
      if (sp.y) {
        // on top of the last base: follow its nudge / turn
        if (!base) continue;
        const [fx, fz, fr] = base.from, [tx, tz, tr] = base.to;
        const d = tr - fr, c = Math.cos(d), s = Math.sin(d), lx = x - fx, lz = z - fz;
        x = tx + lx * c + lz * s; z = tz - lx * s + lz * c; rotY += d;
      } else {
        const ci = Math.floor(sp.x / CELL), cj = Math.floor(sp.z / CELL);
        const got = placer.place(sp.type, x, z, rotY, ox + (ci + 0.5) * CELL, oz + (cj + 0.5) * CELL);
        if (sp.base) base = got ? { from: [x, z, rotY], to: [got.x, got.z, got.rotY] } : null;
        if (!got) continue;
        x = got.x; z = got.z; rotY = got.rotY;
      }
      const hh = modelHalfHeight(sp.type);
      q.setFromEuler(e.set(0, rotY, 0));
      // start (almost) resting on their support: they settle a moment, then sleep (props.js)
      this.world.props.spawn(sp.type, new THREE.Vector3(x, (sp.y || 0) + hh + 0.001, z), q, { sleep: true, state: sp.state });
    }
    const rng = new RNG(hash3(rec.cx, rec.cz, 991, this.seed));
    for (const room of rec.layout.specials) populateRoom(this, room, rec, rng);
  }

  // ---------------------------------------------------------------
  _streamCenters() {
    const out = [this.game.local.pos.clone()];
    if (net.isHost) {
      for (const r of this.game.remotes.values()) if (r.inWorld) out.push(r.pos.clone());
    }
    return out;
  }

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
    // build nearest missing chunk (1 per frame; 2 if one is adjacent to the player)
    const missing = [...want.entries()].filter(([k]) => !this.chunks.has(k)).sort((a, b) => a[1] - b[1]);
    let budget = missing.length && missing[0][1] < CHUNK_M * 1.2 ? 2 : 1;
    for (const [k] of missing) {
      if (budget-- <= 0) break;
      const [cx, cz] = k.split(',').map(Number);
      this._buildChunk(cx, cz);
    }
    // unload far
    for (const k of [...this.chunks.keys()]) {
      if (want.has(k)) continue;
      const [cx, cz] = k.split(',').map(Number);
      const far = centers.every((c) => Math.max(Math.abs(Math.floor(c.x / CHUNK_M) - cx), Math.abs(Math.floor(c.z / CHUNK_M) - cz)) > UNLOAD_R);
      if (far) this._unloadChunk(k);
    }
  }

  // Day-7 shifting corridors: regenerate an unseen chunk with a new variant
  shiftChunk(cx, cz, variant) {
    const key = this._key(cx, cz);
    this.variants.set(key, variant);
    // drop cached layout so walls regenerate
    const had = this.chunks.has(key);
    if (had) this._unloadChunk(key);
    // re-register lights for this & neighbours
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this._lightChunks?.delete(this._key(cx + dx, cz + dz));
    if (had) this._buildChunk(cx, cz);
  }

  // ---------------------------------------------------------------
  update(dt) {
    this.time += dt;
    this._updateStreaming();
    const day = this.game.day.day;
    if (day !== this.dayApplied) this._applyDayLights(day);
    // collapse visuals
    const col = this.game.day.collapse();
    this.field.uniforms.uCollapse.value = col * 0.8;
    this.field.tint.setRGB(1, 1 - col * 0.55, 1 - col * 0.7);
    if (col > 0) this.field.dirty = true;
    engine.scene.fog.density = FOG_DENSITY + this.game.day.instability() * 0.016 + col * 0.03;
    {
      // haze picks up the local light: bright warm murk in lit halls, near black in dead sectors
      const ll = Math.min(1, Math.max(0, (this.game.local.lightLevel ?? 0.6) * 0.95));
      this._fogCol.copy(FOG_DARK).lerp(FOG_LIT, ll);
      engine.scene.fog.color.lerp(this._fogCol, Math.min(1, dt * 1.5));
    }
    // floating dust in the light
    if (this.hazeOn) this.world.fx.ambient(dt, engine.camera.position, 1, this.game.local.lightColor);
    // water reflections when any water is near
    this.reflection.needed = false;
    for (const rec of this.chunks.values()) {
      if (rec.waterCells.length && rec.group.visible) {
        const d = Math.hypot((rec.cx + 0.5) * CHUNK_M - this.game.local.pos.x, (rec.cz + 0.5) * CHUNK_M - this.game.local.pos.z);
        if (d < CHUNK_M * 1.3) { this.reflection.needed = true; break; }
      }
    }
    this.waterMaterial.userData.tick(this.time);
    if (this.reflection.needed) this.reflection.update(engine.scene, engine.camera);
    // explored cells
    const lp = this.game.local.pos;
    if (!this._lostDone && Math.hypot(lp.x - 12, lp.z - 12) > 150) { this._lostDone = true; profile.unlock('lost'); }
    const ci = Math.floor(lp.x / CELL), cj = Math.floor(lp.z / CELL);
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) this.visited.add(`${i},${j}`);
    // hum follows nearest lit light
    this._cull(dt);
    this.mission.update(dt);
    this.monsters.update(dt);
    this.anomalies.update(dt);
    this.critters.update(dt);
    this._updateLightLevel();
  }

  // distance culling (the fog hides everything beyond ~40 m anyway)
  _cull(dt) {
    this._cullT = (this._cullT || 0) - dt;
    if (this._cullT > 0) return;
    this._cullT = 0.2;
    const cam = engine.camera.position;
    const half = CHUNK_M / 2;
    for (const rec of this.chunks.values()) {
      const cx = (rec.cx + 0.5) * CHUNK_M, cz = (rec.cz + 0.5) * CHUNK_M;
      const dx = Math.max(0, Math.abs(cam.x - cx) - half), dz = Math.max(0, Math.abs(cam.z - cz) - half);
      rec.group.visible = dx * dx + dz * dz < 46 * 46;
    }
    for (const p of this.world.props.props.values()) {
      p.root.visible = p.root.position.distanceToSquared(cam) < 40 * 40;
    }
  }

  _updateLightLevel() {
    // local brightness for sanity + viewmodel
    const p = this.game.local.pos;
    _v.set(p.x, 1.2, p.z);
    this.sampleLight(_v, _c);
    const lum = _c.r * 0.3 + _c.g * 0.59 + _c.b * 0.11;
    const fl = this.game.local.flashOn ? 0.25 : 0;
    this.game.local.lightLevel = Math.min(1.5, lum + fl);
    this.game.local.lightColor = (this.game.local.lightColor || new THREE.Color()).copy(_c).multiplyScalar(1.2).addScalar(fl * 0.5);
    // fluorescent hum louder near flickering lights
    const l = this._nearestLight(p);
    if (this.humLoop && l) {
      this.humLoop.setParam('flicker', l.mode === 'flicker' ? 1 : l.mode === 'buzz' ? 0.5 : 0);
      this.humLoop.setVolume(0.25 + Math.min(1, l.intensity) * 0.35);
    }
    if (this.ambience) {
      this.ambience.setParam('tension', Math.min(1, this.game.local.survival.stress + this.game.day.instability() * 0.4));
      this.ambience.setParam('day', this.game.day.day);
    }
  }

  _nearestLight(p) {
    let best = null, bd = 1e9;
    for (const l of this._lightsNear(p.x, p.z)) {
      const d = (l.x - p.x) ** 2 + (l.z - p.z) ** 2;
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }

  // ---------------------------------------------------------------
  // Queries
  sampleLight(pos, out) {
    out.setRGB(0, 0, 0);
    for (const l of this._lightsNear(pos.x, pos.z)) {
      if (l.intensity <= 0.001) continue;
      const dx = l.x - pos.x, dy = l.y - pos.y, dz = l.z - pos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > l.radius) continue;
      let w = (1 / (1 + GRID_FALL.value * d * d)) * Math.max(0, 1 - (d / l.radius) ** 4) * 0.8 * (LIGHT_SCALE / 0.56);
      w *= this.occluder(pos.x, pos.z, l.x, l.z);
      if (w <= 0) continue;
      const c = l.override || l.color;
      out.r += c.r * this.field.tint.r * l.intensity * w;
      out.g += c.g * this.field.tint.g * l.intensity * w;
      out.b += c.b * this.field.tint.b * l.intensity * w;
    }
    out.r += 0.015; out.g += 0.014; out.b += 0.01;
    return out;
  }

  cell(x, z) {
    return cellInfo(this.seed, Math.floor(x / CELL), Math.floor(z / CELL), this.variantFn);
  }

  floorY() { return 0; }
  ceilingY() { return HEIGHT; }

  waterDepth(x, z) {
    const c = this.cell(x, z);
    return c && c.water ? 0.09 : 0;
  }

  surfaceAt(x, z) {
    const c = this.cell(x, z);
    if (!c) return 'carpet';
    if (c.floor === 'concrete') return 'concrete';
    if (c.floor === 'tile') return 'hard';
    return 'carpet';
  }

  // can you walk from cell (i,j) in direction d (0=N,1=E,2=S,3=W)?
  passable(i, j, d) {
    const v = this.variantFn;
    let t;
    if (d === 0) t = wallN(this.seed, i, j, v);
    else if (d === 2) t = wallN(this.seed, i, j + 1, v);
    else if (d === 3) t = wallW(this.seed, i, j, v);
    else t = wallW(this.seed, i + 1, j, v);
    return wallPassable(t);
  }

  isChunkLoaded(x, z) {
    return this.chunks.has(this._key(Math.floor(x / CHUNK_M), Math.floor(z / CHUNK_M)));
  }

  sampleKindAt(hit) {
    if (!hit) return null;
    // monster residue / special spots registered by systems
    const fromMon = this.monsters?.sampleAt(hit.point);
    if (fromMon) return fromMon;
    if (hit.ud?.kind === 'critter') return 'rat';
    const c = this.cell(hit.point.x, hit.point.z);
    if (!c) return null;
    if (c.water && hit.point.y < 0.3) return 'flood_water';
    if (hit.ud?.kind === 'static') {
      const h = hash01(Math.floor(hit.point.x * 2), Math.floor(hit.point.z * 2), Math.floor(hit.point.y * 2), this.seed);
      if (hit.normal.y > 0.7 && h < 0.35) return c.zone === 'maintenance' ? 'black_mold' : 'carpet_fungus';
      if (Math.abs(hit.normal.y) < 0.3 && h < 0.25) return 'wallpaper_growth';
    }
    return null;
  }

  onSampleTaken(kind, hit) {
    if (kind === 'rat') this.critters?.catchAt(hit.point);
  }

  // anomalies worth photographing (beyond monsters)
  photoSubjects(camera) {
    const out = [];
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const consider = (pos, subject, key, value) => {
      const d = pos.distanceTo(camera.position);
      if (d > 14) return;
      const dir = pos.clone().sub(camera.position).normalize();
      if (dir.dot(fwd) < 0.85) return;
      if (!this.world.physics.lineOfSight(camera.position, pos)) return;
      out.push({ subject, key, value: Math.round(value * (1 - d / 20)), dist: d });
    };
    for (const p of this.world.props.props.values()) {
      if (p.sinking) consider(p.root.position, 'SINKING FURNITURE', `sink:${p.id}`, 45);
      else if (p.frozen && p.root.position.y < 0.2 && p.type !== 'dart') consider(p.root.position, 'CLIPPED OBJECT', `clip:${p.id}`, 30);
    }
    for (const rec of this.chunks.values()) {
      for (const room of rec.layout.specials) {
        const c = new THREE.Vector3((rec.cx * CHUNK + room.rx + room.w / 2) * CELL, 1.2, (rec.cz * CHUNK + room.rz + room.h / 2) * CELL);
        if (room.kind === 'red_chair') consider(c, 'THE RED CHAIR', `room:${rec.cx},${rec.cz}`, 60);
        if (room.kind === 'poolrooms_glimpse') consider(c, 'DIMENSIONAL BLEED (POOLROOMS)', `room:${rec.cx},${rec.cz}`, 90);
        if (room.kind === 'stairs_nowhere') consider(c, 'STAIRS TO NOWHERE', `room:${rec.cx},${rec.cz}`, 55);
        if (room.kind === 'many_doors') consider(c, 'FALSE DOORS', `room:${rec.cx},${rec.cz}`, 45);
        if (room.kind === 'endless_hall') consider(c, 'NON-EUCLIDEAN CORRIDOR', `room:${rec.cx},${rec.cz}`, 70);
      }
      if (rec.deadClone) consider(rec.deadClone.clone().setY(0.3), 'DECEASED PREDECESSOR', `dc:${rec.cx},${rec.cz}`, 40);
    }
    for (const g of this.mission?.generators || []) if (g.running) consider(g.root.position.clone().setY(0.8), `${g.label} (RUNNING)`, `gen:${g.id}`, 15);
    return out;
  }

  // ---------------------------------------------------------------
  // dead bodies
  spawnBody(id, cosmetics, pos, yaw, vel) {
    this.mission?.spawnBody(id, cosmetics, pos, yaw, vel);
  }
  removeBody(id) {
    this.mission?.removeBody(id);
  }

  onPropGrabbed(prop, from) {
    this.mission?.onPropGrabbed?.(prop, from);
  }

  playFx(m, p) {
    this.mission?.playFx?.(m, p);
    this.monsters?.playFx?.(m, p);
  }

  onImpact(prop, intensity, other) {
    this.mission?.onImpact?.(prop, intensity, other);
  }

  serialize() {
    return {
      variants: [...this.variants.entries()],
      mission: this.mission.serialize(),
      populated: [...this.populated],
    };
  }

  applySync(d) {
    if (d.variants) for (const [k, v] of d.variants) { const [cx, cz] = k.split(',').map(Number); this.shiftChunk(cx, cz, v); }
    if (d.mission) this.mission.applySync(d.mission);
  }

  dispose() {
    this.ambience?.stop(0.5);
    this.humLoop?.stop(0.3);
    this.mission?.dispose();
    this.monsters?.dispose();
    this.anomalies?.dispose?.();
    this.critters?.dispose();
    for (const k of [...this.chunks.keys()]) this._unloadChunk(k);
    this.reflection.dispose();
    engine.scene.fog = null;
    // reset the grade this level applied (other dimensions set their own)
    const pp = engine.post.params;
    pp.uExposure.value = 1; pp.uLift.value.set(0, 0, 0); pp.uGamma.value.set(1, 1, 1); pp.uGain.value.set(1, 1, 1); pp.uRolloff.value = 0; pp.uContrast.value = 1.04;
    engine.renderer.toneMappingExposure = 1;
    GRID_FALL.value = 0.16;
  }
}

export { W };
