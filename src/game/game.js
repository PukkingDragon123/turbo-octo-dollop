// Game/session orchestrator: modes (solo/host/join), roster, world loading & transitions,
// run state (credits, depth, day timer), deaths, cloning, evacuation and run-over flow.
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { input } from '../core/input.js';
import { net } from '../net/net.js';
import { profile } from '../core/profile.js';
import { audio } from '../audio/audio.js';
import { World } from './world.js';
import { LocalPlayer } from './player.js';
import { RemotePlayer } from './remoteplayer.js';
import { createLevel, LEVELS } from '../world/levels/registry.js';
import { DayCycle, DAY_LENGTH } from './daycycle.js';
import { Tools } from './tools.js';
import { buildRagdoll } from '../entities/avatar.js';
import { buildStillLife, prewarmStillLifes } from '../entities/stilllife_model.js';
import { BacteriaBody, prewarmBacteria } from '../entities/monsters/bacteria_body.js';
import { itemDef } from './itemdefs.js';

const _v = new THREE.Vector3();

export class Game {
  constructor(ui) {
    this.ui = ui;
    ui.game = this;
    this.world = null;
    this.local = new LocalPlayer(this);
    this.local.name = profile.name;
    if (profile.data.cosmetics) this.local.setCosmetics(profile.data.cosmetics);
    this.remotes = new Map();
    this.roster = new Map(); // id -> {id, name, cosmetics, dead, loaded}
    this.run = this._newRun();
    this.day = new DayCycle(this);
    this.tools = new Tools(this);
    this.state = 'menu';
    this.loading = false;
    this.cutscene = null;
    this.poseRelayT = 0;
    this.time = 0;
    this.pendingWorld = null;
    this._bindNet();
    profile.onUnlock((id, a) => this.ui.achievement(a));
  }

  _newRun() {
    return {
      depth: 1, credits: 0, earned: 0, levelType: 'lobby', seed: 0,
      deaths: 0, research: 0, photos: [], startedAt: Date.now(), starterGiven: false,
      objectives: null, exitOpen: false,
    };
  }

  get isLobby() { return this.world?.type === 'lobby'; }

  // ------------------------------------------------------------------
  // Modes
  // ------------------------------------------------------------------
  async startSolo() {
    this.menuBackdrop = false;
    await net.startOffline();
    this._resetRoster();
    this.state = 'playing';
    await this.hostLoadWorld({ type: 'lobby', seed: (Math.random() * 1e9) | 0 });
  }

  async startHost() {
    const code = await net.host();
    this.menuBackdrop = false;
    this._resetRoster();
    this.state = 'playing';
    await this.hostLoadWorld({ type: 'lobby', seed: (Math.random() * 1e9) | 0 });
    return code;
  }

  async join(code) {
    this.remotes.forEach((r) => r.dispose());
    this.remotes.clear();
    // set before connecting: the host's 'welcome' can arrive before net.join() resolves
    this.state = 'joining';
    this.menuBackdrop = false;
    try {
      await net.join(code, { name: profile.name });
    } catch (e) {
      this.state = 'menu';
      this.menuBackdrop = true;
      throw e;
    }
    net.toHost('hello', { name: profile.name, cosmetics: this.local.cosmetics });
  }

  leave() {
    net.shutdown();
    this.disposeWorld();
    this.remotes.forEach((r) => r.dispose());
    this.remotes.clear();
    this.roster.clear();
    this.state = 'menu';
    this.run = this._newRun();
    this.ui.showMainMenu();
  }

  _resetRoster() {
    this.roster.clear();
    this.roster.set(net.selfId, { id: net.selfId, name: profile.name, cosmetics: this.local.cosmetics, dead: false, loaded: false });
  }

  // ------------------------------------------------------------------
  // Networking
  // ------------------------------------------------------------------
  _bindNet() {
    net.on('peerJoined', (id, meta) => {
      if (this.roster.size >= 4) return;
      const lateJoin = !this.isLobby && !!this.world;
      this.roster.set(id, { id, name: meta?.name || 'Clone', cosmetics: null, dead: false, loaded: false, lateJoin });
      net.toPeer(id, 'welcome', {
        roster: [...this.roster.values()],
        world: this.world?.desc || null,
        run: this._publicRun(),
      });
      this._broadcastRoster();
      this.ui.toast(`${meta?.name || 'A clone'} clocked in`, 'info');
    });
    net.on('peerLeft', (id) => {
      const r = this.roster.get(id);
      this.roster.delete(id);
      this.world?.grab.playerLeft(id);
      this._broadcastRoster();
      if (r) this.ui.toast(`${r.name} disconnected`, 'warn');
      this._checkAllDead();
    });
    net.on('disconnected', (reason) => {
      if (this.state === 'menu') return;
      this.leave();
      this.ui.alert(reason || 'Disconnected');
    });

    // ---- host handlers ----
    net.onHost('hello', (d, from) => {
      const r = this.roster.get(from);
      if (!r) return;
      r.name = String(d.name || 'Clone').slice(0, 16);
      r.cosmetics = d.cosmetics;
      this._broadcastRoster();
    });
    net.onHost('cosmetics', (d, from) => {
      const r = this.roster.get(from);
      if (r) { r.cosmetics = d; this._broadcastRoster(); }
    });
    net.onHost('loaded', (d, from) => {
      const r = this.roster.get(from);
      if (!r || !this.world) return;
      r.loaded = true;
      if (from !== net.selfId) {
        net.toPeer(from, 'sync', this._fullSync());
      }
    });
    net.onHost('pose', (d, from) => {
      const r = this.roster.get(from);
      if (!r) return;
      r.pose = d;
      r.dead = !!d.d;
      if (from !== net.selfId) this.remotes.get(from)?.pushPose(d, this.time);
    });
    net.onHost('pickup', (d, from) => {
      const p = this.world?.props.get(d.id);
      if (!p || p.dead || !p.def.pocket || (p.frozen && p.type !== 'dart')) return;
      if ([...p.grabbers.keys()].some((g) => g !== from)) return;
      this.world.grab.releaseAllFor(p.id);
      this.world.props.despawn(p.id);
      net.toPeer(from, 'gotItem', { type: p.type, state: p.state });
      this.world.level?.onPickup?.(p, from);
    });
    net.onHost('drop', (d, from) => {
      if (!this.world) return;
      const pos = new THREE.Vector3().fromArray(d.p);
      const q = new THREE.Quaternion().fromArray(d.q);
      const v = new THREE.Vector3().fromArray(d.v);
      const p = this.world.props.spawn(d.type, pos, q, { state: d.state, vel: v, angvel: d.type === 'dart' ? null : new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3) });
      if (p) { p.thrownBy = from; p.thrownAt = performance.now(); p.touched = true; }
    });
    net.onHost('yank', (d, from) => {
      if (d.to === net.selfId) this.local.applyYank(d.v);
      else net.toPeer(d.to, 'yanked', d.v);
      void from;
    });
    net.onHost('died', (d, from) => this._hostPlayerDied(from, d));
    net.onHost('requestClone', (d, from) => this._hostClone(d.target, from, d.pad));

    // ---- client handlers ----
    net.onClient('welcome', (d) => {
      this.roster.clear();
      for (const r of d.roster) this.roster.set(r.id, r);
      this._syncRemotes();
      Object.assign(this.run, d.run || {});
      if (d.world) this.loadWorld(d.world, true);
      this.state = 'playing';
      this.ui.hideMenus();
    });
    net.onClient('roster', (list) => {
      if (net.isHost) return;
      this.roster.clear();
      for (const r of list) this.roster.set(r.id, r);
      this._syncRemotes();
    });
    net.onClient('poses', (all) => {
      const t = this.time;
      for (const id in all) {
        if (id === net.selfId) continue;
        const r = this.remotes.get(id);
        if (r) r.pushPose(all[id], t);
      }
    });
    net.onClient('loadWorld', (desc) => {
      if (net.isHost) return; // host loads itself
      this.loadWorld(desc, false);
    });
    net.onClient('sync', (d) => this._applySync(d));
    net.onClient('gotItem', (it) => this.local.receiveItem(it));
    net.onClient('yanked', (v) => this.local.applyYank(v));
    net.onClient('run', (r) => Object.assign(this.run, r));
    net.onClient('playerDied', (d) => {
      const name = this.roster.get(d.id)?.name || 'A clone';
      if (d.id !== net.selfId) this.ui.feed(`${name} was terminated (${d.cause})`, 'bad');
      audio.play('radio_static_burst', { volume: 0.4, bus: 'ui' });
    });
    net.onClient('revived', (d) => {
      if (d.id === net.selfId) {
        this.local.revive({ pos: new THREE.Vector3().fromArray(d.p), yaw: d.yaw || 0 });
        this.ui.toast('CLONE RESTORED. Welcome back, valued employee.', 'good');
        profile.unlock('cloned');
      } else {
        this.ui.feed(`${this.roster.get(d.id)?.name || 'A clone'} has been re-cloned`, 'good');
      }
      audio.play('clone_splat', { pos: new THREE.Vector3().fromArray(d.p) });
    });
    net.onClient('hq', (d) => this.ui.hq(d.text, d.from || 'HQ'));
    net.onClient('runOver', (d) => this._showRunOver(d));
    net.onClient('evacuated', (d) => this.ui.feed(d.text, d.good ? 'good' : 'bad'));
    net.onClient('time', (d) => this.day.sync(d));
    net.onClient('ach', (id) => profile.unlock(id));
    net.onClient('leftBehind', () => this.local.onDeath('left behind'));
  }

  _publicRun() {
    const { depth, credits, earned, deaths, research, exitOpen } = this.run;
    return { depth, credits, earned, deaths, research, exitOpen };
  }

  pushRun() {
    if (net.isHost) net.toAll('run', this._publicRun());
  }

  addCredits(n, reason) {
    if (!net.isHost) return;
    this.run.credits += n;
    if (n > 0) this.run.earned += n;
    this.pushRun();
    if (reason) net.toAll('hq', { text: `+${n} CR — ${reason}`, from: 'ACCOUNTING' });
    if (this.run.earned >= 1000) this.unlockAll('researcher');
    if (this.run.earned >= 500) this.unlockAll('quota');
  }

  // host -> everyone: unlock an achievement locally on every peer
  unlockAll(id) {
    net.toAll('ach', id);
  }

  _broadcastRoster() {
    if (!net.isHost) return;
    net.toAll('roster', [...this.roster.values()].map((r) => ({ id: r.id, name: r.name, cosmetics: r.cosmetics, dead: r.dead })));
    this._syncRemotes();
  }

  _syncRemotes() {
    // create/remove RemotePlayer instances to match the roster
    for (const [id, r] of this.roster) {
      if (id === net.selfId) continue;
      let rp = this.remotes.get(id);
      if (!rp) {
        rp = new RemotePlayer(this, r);
        this.remotes.set(id, rp);
        if (this.world) rp.attachWorld(this.world);
      } else {
        rp.name = r.name;
        if (r.cosmetics && JSON.stringify(r.cosmetics) !== JSON.stringify(rp.cosmetics)) rp.setCosmetics(r.cosmetics);
      }
    }
    for (const [id, rp] of this.remotes) {
      if (!this.roster.has(id)) {
        rp.dispose();
        this.remotes.delete(id);
        this.voice?.remove(id);
      }
    }
    this.voice?.syncPeers([...this.roster.keys()]);
  }

  // ------------------------------------------------------------------
  // Worlds
  // ------------------------------------------------------------------
  async hostLoadWorld(desc) {
    if (!net.isHost) return;
    desc.seed = desc.seed >>> 0;
    for (const r of this.roster.values()) r.loaded = false;
    net.toAll('loadWorld', desc); // clients load; host handler ignored
    await this.loadWorld(desc, false);
  }

  disposeWorld() {
    if (!this.world) return;
    this.local.detachWorld();
    for (const r of this.remotes.values()) r.detachWorld();
    this.world.dispose();
    this.world = null;
  }

  async loadWorld(desc, lateJoin) {
    if (this.loading) { this.pendingWorld = { desc, lateJoin }; return; }
    this.loading = true;
    this.ui.setLoading(true, desc);
    const fromType = this.world?.type;
    this.disposeWorld();
    const world = new World(this, desc);
    this.world = world;
    world.level = createLevel(desc.type, world, desc);
    this.run.levelType = desc.type;
    this.run.seed = desc.seed;
    if (desc.depth) this.run.depth = desc.depth;
    try {
      await world.level.build((p, label) => this.ui.setLoadingProgress(p, label));
    } catch (e) {
      console.error('[game] level build failed', e);
    }
    if (this.world !== world) { this.loading = false; return; }
    // spawn point
    // roster order is the host's join order (clients rebuild it from the host's list), so indexes never collide
    const idx = [...this.roster.keys()].indexOf(net.selfId);
    const arrival = !!desc.arrival && !lateJoin;
    const sp = world.level.spawnPoint(Math.max(0, idx), lateJoin, arrival);
    this.local.attachWorld(world, sp);
    if (desc.type === 'lobby') {
      // everyone is alive & fresh in the lobby
      this.local.dead = false;
      this.local.survival.reset();
    }
    if (this.local.dead) {
      this.local.collider?.setEnabled(false);
    }
    for (const r of this.remotes.values()) r.attachWorld(world);
    this.day.reset(desc.type !== 'lobby', desc.dayTime || 0);
    audio.setReverb(world.level.reverb || 'office');
    world.level.startAudio?.();
    if (net.isHost) {
      world.level.hostStart?.(desc);
      const me = this.roster.get(net.selfId);
      if (me) me.loaded = true;
    } else {
      net.toHost('loaded', {});
    }
    // compile every shader now (behind the loading screen) instead of stuttering later
    this.ui.setLoadingProgress(1, 'COMPILING SHADERS');
    const warmups = desc.type !== 'lobby' ? await this._monsterWarmups(world, sp.pos) : [];
    try {
      await new Promise((r) => setTimeout(r, 0));
      engine.camera.position.copy(sp.pos).setY(sp.pos.y + 1.2);
      await engine.renderer.compileAsync(engine.scene, engine.camera);
      await engine.renderer.compileAsync(engine.vmScene, engine.vmCamera);
    } catch (e) { /* older drivers */ }
    for (const w of warmups) {
      world.unregisterDynamic(w.root);
      w.root.removeFromParent();
      w.root.userData.dispose?.();
      w.dispose?.();
    }
    if (this.world !== world) { this.loading = false; return; }
    this.loading = false;
    this.ui.setLoading(false);
    if (!this.menuBackdrop) this.ui.onWorldLoaded(desc, fromType);
    if (arrival) this._arrivalSequence(sp);
    if (this.pendingWorld) {
      const pw = this.pendingWorld;
      this.pendingWorld = null;
      this.loadWorld(pw.desc, pw.lateJoin);
    }
  }

  _arrivalSequence() {
    audio.play('fall_wind', { volume: 0.7 });
    engine.post.params.uGlitch.value = 0.8;
    engine.post.params.uFade.value = 1;
    this.cutscene = { t: 0, kind: 'arrival' };
  }

  _fullSync() {
    const devs = {};
    for (const [id, d] of this.world.devices) devs[id] = d.serialize();
    return {
      props: this.world.props.serializeAll(),
      devices: devs,
      level: this.world.level.serialize?.() || null,
      day: this.day.serialize(),
      run: this._publicRun(),
    };
  }

  _applySync(d) {
    if (!this.world) return;
    for (const m of d.props || []) this.world.props._create(m);
    for (const id in d.devices || {}) {
      const dev = this.world.devices.get(id);
      if (dev) { Object.assign(dev.state, d.devices[id]); dev.onState(d.devices[id], true); }
    }
    if (d.level) this.world.level.applySync?.(d.level);
    if (d.day) this.day.sync(d.day);
    if (d.run) Object.assign(this.run, d.run);
  }

  // ------------------------------------------------------------------
  // Deaths, cloning, run over
  // ------------------------------------------------------------------
  _hostPlayerDied(from, d) {
    const r = this.roster.get(from);
    if (!r || !this.world) return;
    r.dead = true;
    this.run.deaths++;
    // body ragdoll + dropped items
    const pos = new THREE.Vector3().fromArray(d.p);
    this.world.level?.spawnBody?.(from, r.cosmetics, pos, d.yaw, new THREE.Vector3().fromArray(d.v || [0, 0, 0]));
    for (const it of d.items || []) {
      const off = new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.3, (Math.random() - 0.5) * 0.6);
      this.world.props.spawn(it.type, pos.clone().add(off), new THREE.Quaternion(), { state: it.state, vel: off.clone().multiplyScalar(2) });
    }
    net.toAll('playerDied', { id: from, cause: d.cause });
    this._broadcastRoster();
    this._checkAllDead();
  }

  _checkAllDead() {
    if (!net.isHost || !this.world || this.isLobby) return;
    const all = [...this.roster.values()];
    if (all.length && all.every((r) => r.dead)) {
      setTimeout(() => this.hostRunOver('ALL CLONES TERMINATED'), 3500);
    }
  }

  cloneCost() { return 150 + (this.run.depth - 1) * 50; }

  _hostClone(targetId, from, padId) {
    if (!this.world) return;
    const r = targetId ? this.roster.get(targetId) : [...this.roster.values()].find((x) => x.dead);
    if (!r || !r.dead) return;
    const cost = this.cloneCost();
    if (this.run.credits < cost) {
      net.toAll('hq', { text: `INSUFFICIENT CREDITS FOR CLONING (${cost} CR REQUIRED)`, from: 'CLONING' });
      return;
    }
    const pad = this.world.props.get(padId) || null;
    const p = pad ? pad.root.position.clone().add(_v.set(0, 0.3, 0)) : this.world.level.spawnPoint(0, true).pos;
    this.run.credits -= cost;
    this.pushRun();
    r.dead = false;
    this.world.level?.removeBody?.(r.id);
    net.toAll('revived', { id: r.id, p: p.toArray(), yaw: 0 });
    if (from === net.selfId) profile.unlock('revived'); else if (from) net.toPeer(from, 'ach', 'revived');
    this.world.fxAll({ k: 'sparks', p: [p.x, p.y + 0.5, p.z], n: 30 });
    this._broadcastRoster();
  }

  hostRunOver(reason) {
    if (!net.isHost) return;
    if (this.runOverPending) return;
    this.runOverPending = true;
    const stats = {
      reason,
      depth: this.run.depth,
      day: this.day.day,
      earned: this.run.earned,
      deaths: this.run.deaths,
      time: Math.round((Date.now() - this.run.startedAt) / 1000),
    };
    net.toAll('runOver', stats);
    setTimeout(() => {
      this.runOverPending = false;
      this.run = this._newRun();
      for (const r of this.roster.values()) r.dead = false;
      this._broadcastRoster();
      this.hostLoadWorld({ type: 'lobby', seed: (Math.random() * 1e9) | 0 });
    }, 9000);
  }

  _showRunOver(stats) {
    this.ui.runOver(stats);
    audio.play('collapse_rumble', { volume: 0.8 });
    profile.stat('runs');
  }

  // Exit door closed: survivors transfer, others die. carry = serialized props
  hostEvacuate(survivorIds, carry) {
    if (!net.isHost) return;
    for (const r of this.roster.values()) {
      if (!survivorIds.includes(r.id) && !r.dead) {
        r.dead = true;
        net.toAll('evacuated', { text: `${r.name} was left behind.`, good: false });
        if (r.id === net.selfId) this.local.onDeath('left behind');
        else net.toPeer(r.id, 'leftBehind', {});
      }
    }
    if (!survivorIds.length) {
      this.hostRunOver('NO SURVIVORS EVACUATED');
      return;
    }
    this.unlockAll('escape');
    const next = LEVELS.nextAfter(this.world.type, this.run.depth);
    this.run.depth += 1;
    this.run.exitOpen = false;
    this.addCredits(100 * survivorIds.length, 'Successful evacuation bonus');
    this.hostLoadWorld({ type: next, seed: (Math.random() * 1e9) | 0, depth: this.run.depth, arrival: true, carry });
  }

  hostDispatch(carry, type = 'yellow') {
    // from lobby into the first dimension (fresh run); `type` lets test hooks start in a later dimension
    this.run = this._newRun();
    const depth = Math.max(1, LEVELS.order.indexOf(type) + 1);
    this.run.depth = depth;
    for (const r of this.roster.values()) r.dead = false;
    this.unlockAll('first_day');
    this.hostLoadWorld({ type, seed: (Math.random() * 1e9) | 0, depth, arrival: true, carry, fresh: true });
  }

  // Temporary, probe-lit monster instances placed in the scene while shaders compile, so the first
  // Bacteria / Still Life sighting doesn't stall on shader compilation (they share materials).
  async _monsterWarmups(world, at) {
    const out = [];
    try {
      await Promise.race([Promise.all([prewarmStillLifes(), prewarmBacteria?.()]), new Promise((r) => setTimeout(r, 4000))]);
      const sl = buildStillLife('watcher', 1);
      out.push(sl);
      const bac = new BacteriaBody(-1);
      out.push(bac);
      for (const m of out) {
        m.root.position.copy(at).add(new THREE.Vector3(0, -30, 0));
        world.group.add(m.root);
        world.registerDynamic(m.root);
      }
    } catch (e) { console.warn('[game] monster warmup', e); }
    return out;
  }

  // ------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------
  onDayChange(day) {
    const integrity = Math.round((1 - this.day.instability()) * 100);
    audio.play('day_change', { volume: 1 });
    this.ui.toast(`DAY ${day}/7`, day >= 6 ? 'bad' : 'warn');
    this.healthity?.onDayChange(day, integrity);
    if (net.isHost) {
      const msgs = {
        2: 'DAY 2/7. Reality integrity holding. Furniture may begin to relocate.',
        3: 'DAY 3/7. Anomalous activity increasing. Additional entities detected.',
        4: 'DAY 4/7. Integrity below 60%. Please hurry.',
        5: 'DAY 5/7. SEVERE INSTABILITY. Lights failing across the sector.',
        6: 'DAY 6/7. Final warning. Complete objectives or be written off.',
        7: 'DAY 7/7. REALITY COLLAPSE IN PROGRESS. Corridors are shifting. EVACUATE.',
      };
      if (msgs[day]) net.toAll('hq', { text: msgs[day], from: 'HQ' });
      if (day >= 3) this.unlockAll('survive3');
      if (day >= 7) this.unlockAll('survivor7');
    }
    engine.post.params.uGlitch.value = 0.6;
    setTimeout(() => { if (!this.cutscene) engine.post.params.uGlitch.value = 0; }, 900);
  }

  onTotalCollapse() {
    if (!net.isHost || this.isLobby) return;
    net.toAll('hq', { text: 'DIMENSION LOST. All personnel written off.', from: 'HQ' });
    this.world.fxAll({ k: 'snd', n: 'collapse_rumble', v: 1 });
    for (const r of this.roster.values()) r.dead = true;
    if (!this.local.dead) this.local.onDeath('reality collapse');
    net.toRemotes('leftBehind', {});
    setTimeout(() => this.hostRunOver('DIMENSION COLLAPSED'), 2500);
  }

  onLocalDeath() {
    profile.stat('deaths');
    if ((profile.data.stats.deaths || 0) >= 10) profile.unlock('disposable');
    const alive = [...this.roster.values()].some((r) => r.id !== net.selfId && !r.dead);
    this.ui.feed(alive ? 'Your clone has been terminated. Teammates can re-clone you at the cloning pad.' : 'Your clone has been terminated.', 'bad', 'R.O.O.M.');
  }

  onItemUsed(type, wasBleeding) {
    if ((type === 'bandage' || type === 'medkit') && wasBleeding && this.local.survival.bleed === 0) profile.unlock('medic');
    if (type === 'almond_water' || type === 'almond_milk') {
      if (profile.stat('almond') >= 10) profile.unlock('hydrated');
    }
  }

  onItemPicked() {}

  // ------------------------------------------------------------------
  // Frame
  // ------------------------------------------------------------------
  update(dt) {
    this.time += dt;
    if (!this.world || this.loading) return;
    // cutscenes
    if (this.cutscene) {
      const c = this.cutscene;
      c.t = (performance.now() - (c.start ??= performance.now())) / 1000;
      if (c.kind === 'arrival') {
        engine.post.params.uFade.value = Math.max(0, 1 - c.t * 1.2);
        engine.post.params.uGlitch.value = Math.max(0, 0.8 - c.t * 0.6);
        if (c.t > 1.5) this.cutscene = null;
      }
    }
    this.local.update(dt);
    for (const r of this.remotes.values()) r.update(dt);
    this.day.update(dt);
    this.world.update(dt);
    this.tools.update(dt);
    // host relays poses
    if (net.isHost && net.isOnline) {
      this.poseRelayT -= dt;
      if (this.poseRelayT <= 0) {
        this.poseRelayT = 1 / 20;
        const all = {};
        for (const [id, r] of this.roster) if (r.pose) all[id] = r.pose;
        if (Object.keys(all).length) net.toRemotes('poses', all);
      }
    }
    // pose of the host's own local player goes into the roster directly via toHost
  }
}
