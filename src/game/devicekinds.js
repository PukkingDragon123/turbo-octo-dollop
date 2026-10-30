// Concrete interactive devices shared by the lobby and the Backrooms.
import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { engine } from '../core/engine.js';
import { net } from '../net/net.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { profile, ACHIEVEMENTS } from '../core/profile.js';
import { Device } from './devices.js';
import { buildModel } from '../entities/catalog.js';
import { CrtScreen, text, bar, drawMenu, wrap } from '../ui/crt.js';
import { RECIPES, itemName } from './itemdefs.js';
import * as Devs from '../entities/models_devices.js';
import { LORE } from './lore.js';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

// Base: a device built from a catalog model with its colliders and optional CRT screens
export class ModelDevice extends Device {
  constructor(world, id, key, opts = {}) {
    super(world, id, opts);
    this.key = key;
    this.opts = opts;
    this.model = buildModel(key, { seed: opts.seed ?? 1, ...(opts.modelOpts || {}) });
    this.root.add(this.model.object);
    this.parts = this.model.parts || {};
    this.anchors = this.model.anchors || {};
    this.screens = {};
  }
  build() {
    this.root.updateMatrixWorld(true);
    if (this.model.colliders?.length && this.opts.collide !== false) this.addColliders(this.model.colliders);
  }
  screen(name, w = 512, h = 384, pal = 'amber', intensity = 1.3) {
    const sm = this.model.screens?.[name]?.mesh;
    const s = new CrtScreen(w, h, pal);
    if (sm) s.attach(sm, intensity);
    this.screens[name] = s;
    return s;
  }
  anchorWorld(name, idx = null, out = new THREE.Vector3()) {
    let a = this.anchors[name];
    if (idx !== null && Array.isArray(a)) a = a[idx];
    this.root.updateMatrixWorld(true);
    if (!a) return this.root.getWorldPosition(out);
    return out.set(a.x, a.y, a.z).applyMatrix4(this.root.matrixWorld);
  }
  nearLocal(r = 12) { return this.root.position.distanceTo(this.world.game.local.pos) < r; }
  // anyone looking at this device? (for uncanny "changes when nobody looks")
  unobserved() {
    const players = [];
    const g = this.world.game;
    if (!g.local.dead) players.push({ pos: g.local.pos, yaw: g.local.yaw, pitch: g.local.pitch });
    for (const r of g.remotes.values()) if (!r.dead && r.inWorld) players.push({ pos: r.pos, yaw: r.yaw, pitch: r.pitch });
    const p = this.root.getWorldPosition(_v).clone();
    p.y += 1;
    for (const pl of players) {
      const eye = pl.pos.clone().setY(pl.pos.y + 1.15);
      const dir = p.clone().sub(eye);
      const d = dir.length();
      if (d > 30) continue;
      dir.normalize();
      const fwd = new THREE.Vector3(-Math.sin(pl.yaw) * Math.cos(pl.pitch), Math.sin(pl.pitch), -Math.cos(pl.yaw) * Math.cos(pl.pitch));
      if (fwd.dot(dir) > 0.35) return false;
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
const SNACKS = [
  ['chips', 'CRUNCH-O CHIPS'], ['candy_bar', 'CHOCO-SLAB'], ['protein_bar', 'PROTEIN+ BEIGE'], ['chips', 'CHEESE PUFFS'],
  ['candy_bar', 'NOUGAT NUGGET'], ['protein_bar', 'OAT BRICK'], ['canned_food', 'SOUP CAN (?)'], ['chips', 'SALT CRISPS'],
];
const DRINKS = [['soda_can', 'R.O.O.M. COLA'], ['energy_drink', 'VOLT ENERGY'], ['almond_water', 'ALMOND WATER'], ['almond_milk', 'ALMOND MILK'], ['soda_can', 'DIET COLA'], ['energy_drink', 'NIGHT SHIFT']];

export class VendingMachine extends ModelDevice {
  constructor(world, id, key, opts) {
    super(world, id, key, opts);
    this.drink = key === 'vending_drink';
    this.list = this.drink ? DRINKS : SNACKS;
    // credits can't buy anything: machines out in the Backrooms are free but only hold a few snacks
    this.price = 0;
    this.stock = opts.backrooms ? 3 : Infinity;
    this.state = { stuck: null, busy: 0, sold: 0, broken: opts.backrooms ? (Math.random() < 0.2 ? 1 : 0) : 0 };
    this.scr = this.screen('main', 256, 128, 'green', 1.6);
    this.spin = new Map(); // coil index -> t
  }
  prompt() { return `[${input.keyName('interact')}] Use ${this.drink ? 'Drink' : 'Snack'} Machine${this.state.stuck != null ? ' (something is stuck — whack it!)' : ''}`; }
  interact() {
    const self = this;
    const g = this.world.game;
    const scr = new CrtScreen(512, 384, 'green');
    this.root.updateMatrixWorld(true);
    g.terminal.open({
      device: this, screen: scr, overlay: true,
      target: this.root.localToWorld(new THREE.Vector3(-0.15, 1.15, 0)),
      distance: 1.9,
      anchorNormal: new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion),
      view() {
        const items = self.list.map(([t, name], i) => ({ label: `${String.fromCharCode(65 + Math.floor(i / 4))}${(i % 4) + 1}  ${name}`, hint: self.price ? `${self.price} CR` : 'FREE', disabled: !!self.state.broken || (self.price > 0 && g.run.credits < self.price), i }));
        return {
          title: self.drink ? 'R.O.O.M. COLA' : 'SNAK-MATIC 3000',
          subtitle: self.price ? `${g.run.credits} CR` : 'EMPLOYEE PERK',
          lines: [self.state.broken ? { t: 'OUT OF ORDER. DO NOT SHAKE.', c: 'bad' } : self.state.sold >= self.stock ? { t: 'SOLD OUT.', c: 'bad' } : { t: self.price ? 'Snacks billed to your team account.' : 'Complimentary refreshments. Consumption is mandatory.', c: 'dim', s: 20 }],
          items,
          footer: '[W/S] SELECT  [E] VEND  [TAB] LEAVE',
        };
      },
      select(it) { self.send('vend', { i: it.i }); },
    });
  }
  hostAction(a, d, from) {
    if (a !== 'vend' || this.state.busy || this.state.broken || this.state.sold >= this.stock) return;
    const g = this.world.game;
    if (this.price) {
      if (g.run.credits < this.price) return;
      g.run.credits -= this.price;
      g.pushRun();
    }
    this.setState({ busy: 1 });
    this.world.fxAll({ k: 'vend', id: this.id, i: d.i });
    this.world.noise.emit(this.root.position, 8, 'vend');
    setTimeout(() => {
      if (!this.world.devices.has(this.id)) return;
      const [type] = this.list[d.i % this.list.length];
      const slots = this.anchors.slots || [];
      const sp = slots.length ? this.anchorWorld('slots', d.i % slots.length) : this.anchorWorld('tray');
      if (Math.random() < 0.12 && !this.state.stuck) {
        this.setState({ busy: 0, stuck: { type, p: sp.toArray() } });
        net.toPeer(from, 'hq', { text: 'Your snack is stuck. Typical.', from: 'SNAK-MATIC' });
        return;
      }
      this._drop(type, sp);
      this.setState({ busy: 0, sold: this.state.sold + 1 });
      if (from === net.selfId) { if (profile.stat('vending') >= 10) profile.unlock('vending'); } else net.toPeer(from, 'vendStat', 1);
    }, 1500);
  }
  _drop(type, sp) {
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
    this.world.props.spawn(type, sp.clone().addScaledVector(fwd, 0.05), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random(), Math.random() * 6, 0)), { vel: fwd.clone().multiplyScalar(0.4) });
    this.world.fxAll({ k: 'snd', n: 'vending_drop', p: sp.toArray(), v: 1 });
  }
  // a hard hit (thrown prop, body slam) frees a stuck snack
  onHit(intensity) {
    if (!net.isHost || !this.state.stuck || intensity < 0.35) return;
    const st = this.state.stuck;
    this.setState({ stuck: null });
    this._drop(st.type, new THREE.Vector3().fromArray(st.p));
  }
  playFx(m) {
    if (m.k === 'vend') {
      this.spin.set(m.i, 0);
      const prods = this.parts.products || [];
      const pr = prods[m.i % Math.max(1, prods.length)];
      if (pr) { setTimeout(() => { pr.visible = false; }, 1400); setTimeout(() => { pr.visible = true; }, 45000); }
      const bl = (this.parts.buttonLights || [])[m.i % Math.max(1, (this.parts.buttonLights || []).length)];
      if (bl?.material) { const prev = bl.material.emissiveIntensity; bl.material.emissiveIntensity = 4; setTimeout(() => { bl.material.emissiveIntensity = prev; }, 1500); }
      audio.play('coin', { pos: this.root.position, volume: 0.7 });
      audio.play('vending_motor', { pos: this.root.position, volume: 0.9 });
    }
  }
  update(dt) {
    const coils = this.parts.coils || [];
    for (const [i, t] of this.spin) {
      const nt = t + dt;
      const c = coils[i % Math.max(1, coils.length)];
      if (c) c.rotation.z = -nt / 1.5 * Math.PI * 2;
      if (nt > 1.5) this.spin.delete(i); else this.spin.set(i, nt);
    }
    if (this.parts.flap) this.parts.flap.rotation.x = 0;
    if (this.scr && this.nearLocal(10)) {
      this.scr.draw(dt, (ctx, w, h, pal, t) => {
        if (this.state.broken) { text(ctx, 'ERR 0x0BAD', 10, 30, 40, pal.bad); return; }
        text(ctx, this.state.busy ? 'VENDING...' : this.state.stuck ? 'ITEM JAMMED' : 'MAKE SELECTION', 10, 20, 34, this.state.stuck ? pal.bad : pal.fg);
        text(ctx, this.price ? `${this.price} CR` : 'FREE', 10, 70, 30, pal.dim);
        if (Math.floor(t * 2) % 2) text(ctx, '_', 200, 70, 30, pal.fg);
      });
    }
  }
}

// ---------------------------------------------------------------------------
export class WaterCooler extends ModelDevice {
  constructor(world, id, opts) {
    super(world, id, 'water_cooler', opts);
    this.glug = 0;
    this.bubT = 0;
  }
  prompt() { return `[${input.keyName('interact')}] Get a cup of water`; }
  interact() { this.send('cup'); }
  hostAction(a) {
    if (a !== 'cup') return;
    this.world.fxAll({ k: 'cooler', id: this.id });
    const tap = this.anchorWorld('tap');
    setTimeout(() => this.world.props.spawn('paper_cup', tap.clone().add(_v.set(0, 0.02, 0)), new THREE.Quaternion(), { state: { water: 1 } }), 600);
  }
  playFx(m) {
    if (m.k === 'cooler') {
      this.glug = 1.2;
      audio.play('water_glug', { pos: this.root.position, volume: 0.9 });
    }
  }
  update(dt) {
    const wtr = this.parts.water;
    if (wtr) {
      this.level = Math.min(1, (this.level ?? 1) + dt * 0.004);
      wtr.scale.y = 0.25 + this.level * 0.75;
    }
    if (this.glug > 0) {
      this.glug -= dt;
      this.level = Math.max(0, (this.level ?? 1) - dt * 0.05);
      this.bubT -= dt;
      const bo = this.parts.bubbleOrigin;
      if (bo && this.bubT <= 0) {
        this.bubT = 0.05;
        this.world.fx.bubbles(bo.getWorldPosition(_v), 2, 0.08);
      }
    }
  }
}

// ---------------------------------------------------------------------------
export class Aquarium extends ModelDevice {
  constructor(world, id, opts) {
    super(world, id, 'aquarium', opts);
    this.state = { broken: 0 };
    this.fish = [];
    this.bubT = 0;
    this.loop = null;
    this.critters = opts.critterModels;
    const min = this.anchors.tankMin, max = this.anchors.tankMax;
    this.tmin = min ? new THREE.Vector3(min.x, min.y, min.z) : new THREE.Vector3(-0.5, 1.0, -0.2);
    this.tmax = max ? new THREE.Vector3(max.x, max.y, max.z) : new THREE.Vector3(0.5, 1.35, 0.2);
    const kinds = ['goldfish', 'neon', 'angel', 'clown', 'guppy', 'goldfish', 'neon', 'neon'];
    if (this.critters?.buildFish) {
      kinds.forEach((k, i) => {
        const f = this.critters.buildFish(k, i * 17 + 3);
        const p = new THREE.Vector3().lerpVectors(this.tmin, this.tmax, 0.5).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.2));
        f.root.position.copy(p);
        this.root.add(f.root);
        this.fish.push({ f, kind: k, p, v: new THREE.Vector3((Math.random() - 0.5) * 0.2, 0, (Math.random() - 0.5) * 0.1), phase: Math.random() * 10 });
      });
    }
  }
  prompt() { return this.state.broken ? 'The aquarium is... broken. Oops.' : 'Aquarium (please do not tap the glass)'; }
  interact() {
    if (!this.state.broken) {
      audio.play('impact_glass', { pos: this.root.position, intensity: 0.2 });
      for (const f of this.fish) f.v.add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.3));
    }
  }
  onHit(intensity) {
    if (!net.isHost || this.state.broken || intensity < 0.7) return;
    this.setState({ broken: 1 });
    const c = this.anchorWorld('tankMin').lerp(this.anchorWorld('tankMax'), 0.5);
    this.world.fxAll({ k: 'aquabreak', id: this.id, p: c.toArray() });
    this.world.game.unlockAll('aquarium');
    this.world.noise.emit(c, 25, 'break');
    // fish flop out as physics props
    this.fish.forEach((f, i) => {
      const wp = f.f.root.getWorldPosition(new THREE.Vector3());
      this.world.props.spawn('fish', wp, new THREE.Quaternion(), { state: { kind: f.kind, seed: i * 17 + 3 }, vel: new THREE.Vector3((Math.random() - 0.5) * 2, 1, 1.5 + Math.random()).applyQuaternion(this.root.quaternion) });
    });
  }
  onState(s) {
    if (s.broken) {
      for (const g of this.parts.glass || []) g.visible = false;
      if (this.parts.water) this.parts.water.visible = false;
      for (const f of this.fish) f.f.root.visible = false;
      this.loop?.stop(0.3);
      this.loop = null;
    }
  }
  playFx(m) {
    if (m.k === 'aquabreak') {
      const p = new THREE.Vector3().fromArray(m.p);
      audio.play('glass_shatter', { pos: p, volume: 1 });
      audio.play('water_splash_big', { pos: p, volume: 1 });
      this.world.fx.chunks(p, 30, 0xbfe6e6, 0.1, 4, 0);
      for (let i = 0; i < 4; i++) this.world.fx.splash(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0, 0)), 30, 0.02);
      this.onState({ broken: 1 });
    }
  }
  update(dt) {
    if (!this.loop && !this.state.broken && this.nearLocal(14)) this.loop = audio.loop('aquarium', { pos: this.root.position.clone().setY(1.2), volume: 0.6 });
    else if (this.loop && !this.nearLocal(18)) { this.loop.stop(0.5); this.loop = null; }
    if (this.state.broken) return;
    const t = this.world.time;
    for (const f of this.fish) {
      // simple wander + wall avoidance inside the tank
      f.phase += dt;
      f.v.x += Math.sin(f.phase * 0.7 + f.p.z * 3) * dt * 0.15;
      f.v.z += Math.cos(f.phase * 0.5 + f.p.x * 2) * dt * 0.08;
      f.v.y += Math.sin(f.phase * 1.3) * dt * 0.03;
      const m = 0.05;
      if (f.p.x < this.tmin.x + m) f.v.x += dt * 0.6;
      if (f.p.x > this.tmax.x - m) f.v.x -= dt * 0.6;
      if (f.p.y < this.tmin.y + m) f.v.y += dt * 0.4;
      if (f.p.y > this.tmax.y - m) f.v.y -= dt * 0.4;
      if (f.p.z < this.tmin.z + m) f.v.z += dt * 0.6;
      if (f.p.z > this.tmax.z - m) f.v.z -= dt * 0.6;
      const sp = f.v.length();
      if (sp > 0.18) f.v.multiplyScalar(0.18 / sp);
      f.v.y *= 0.98;
      f.p.addScaledVector(f.v, dt);
      f.f.root.position.copy(f.p);
      if (sp > 0.01) f.f.root.rotation.y = Math.atan2(-f.v.x, -f.v.z);
      f.f.update(dt, { speed: sp });
    }
    this.bubT -= dt;
    if (this.bubT <= 0 && this.parts.bubbler && this.nearLocal(10)) {
      this.bubT = 0.12;
      this.world.fx.bubbles(this.parts.bubbler.getWorldPosition(_v), 1, 0.03);
    }
    for (const [i, pl] of (this.parts.plants || []).entries()) pl.rotation.z = Math.sin(t * 1.3 + i) * 0.08;
  }
}

// ---------------------------------------------------------------------------
export class DartBoard extends ModelDevice {
  constructor(world, id, opts) {
    super(world, id, 'dart_board', opts);
    this.state = { throws: [], scores: {} };
    this.board = opts.scoreboard || null;
    net.onClient('vendStat', () => { if (profile.stat('vending') >= 10) profile.unlock('vending'); });
  }
  prompt() { return 'Dart board — grab darts from the table and throw them [RMB]'; }
  interact() {}
  // host: dart contact
  onHit(intensity, prop) {
    if (!net.isHost || !prop || prop.type !== 'dart' || prop.frozen) return;
    // stick if travelling tip-first reasonably fast
    const v = prop.body?.linvel();
    const sp = v ? Math.hypot(v.x, v.y, v.z) : 0;
    if (sp < 3) return;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(prop.root.quaternion);
    const vel = new THREE.Vector3(v.x, v.y, v.z).normalize();
    if (fwd.dot(vel) < 0.5) return;
    const tip = prop.root.position.clone().addScaledVector(fwd, 0.07);
    const local = this.root.worldToLocal(tip.clone());
    const res = Devs.scoreDart ? Devs.scoreDart(local.x, local.y) : { score: 0, label: 'MISS' };
    // embed the dart
    this.world.props.setFrozen(prop, true);
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
    const faceZ = this.model.params?.faceZ ?? this.anchors.center?.z ?? 0.015;
    const embed = this.root.localToWorld(new THREE.Vector3(local.x, local.y, faceZ + 0.01)).addScaledVector(fwd, -0.06);
    prop.root.position.copy(embed);
    this.world.props.forceSendIds.add(prop.id);
    const by = prop.thrownBy || net.selfId;
    const name = this.world.game.roster.get(by)?.name || 'Clone';
    const throws = [{ n: name, s: res.score, l: res.label }, ...this.state.throws].slice(0, 6);
    const scores = { ...this.state.scores, [name]: (this.state.scores[name] || 0) + res.score };
    this.setState({ throws, scores });
    this.world.fxAll({ k: 'snd', n: res.label === 'BULL' || res.label === 'DBULL' || res.label === 'BULLSEYE' ? 'dart_bull' : 'dart_hit', p: tip.toArray(), v: 1 });
    if (/BULL/.test(res.label) && res.score >= 50) {
      if (by === net.selfId) profile.unlock('bullseye');
      else net.toPeer(by, 'ach', 'bullseye');
      net.toAll('hq', { text: `${name} hit a BULLSEYE!`, from: 'BREAK ROOM' });
    }
    void n;
  }
  onState() {
    this.board?.redraw?.(this.state);
  }
}

// ---------------------------------------------------------------------------
// Lockers: customisation booth
export class LockerBank extends ModelDevice {
  constructor(world, id, opts) {
    super(world, id, 'locker_bank', { ...opts, modelOpts: { count: opts.count || 4 } });
    this.state = { open: [] };
    this.anim = [];
    const doors = this.parts.doors || [];
    doors.forEach(() => this.anim.push(0));
    (this.model.screens ? Object.values(this.model.screens) : []).forEach(() => {});
  }
  prompt() { return `[${input.keyName('interact')}] Open your locker (customize)`; }
  interact(player, kind, hit) {
    // open the door nearest to the hit point
    let idx = 0, bd = 1e9;
    (this.parts.doors || []).forEach((d, i) => {
      const p = d.getWorldPosition(new THREE.Vector3());
      const dd = hit ? p.distanceTo(hit.point) : i;
      if (dd < bd) { bd = dd; idx = i; }
    });
    this.send('open', { i: idx });
    this.world.game.ui.openCustomizer(() => this.send('close', { i: idx }));
  }
  hostAction(a, d) {
    const open = new Set(this.state.open);
    if (a === 'open') open.add(d.i);
    else open.delete(d.i);
    this.setState({ open: [...open] });
    this.world.fxAll({ k: 'snd', n: a === 'open' ? 'locker_open' : 'locker_close', p: this.root.position.toArray(), v: 0.9 });
  }
  update(dt) {
    (this.parts.doors || []).forEach((door, i) => {
      const target = this.state.open.includes(i) ? 1 : 0;
      this.anim[i] = (this.anim[i] || 0) + (target - (this.anim[i] || 0)) * Math.min(1, dt * 6);
      door.rotation.y = -this.anim[i] * 1.75;
    });
  }
}

// ---------------------------------------------------------------------------
export class ServiceBell extends ModelDevice {
  constructor(world, id, opts) { super(world, id, 'service_bell', { ...opts, collide: false }); this.onRing = opts.onRing; }
  prompt() { return `[${input.keyName('interact')}] Ring for service`; }
  interact() { this.send('ring'); }
  hostAction() {
    this.world.fxAll({ k: 'snd', n: 'bell_ding', p: this.root.position.toArray(), v: 1 });
    this.world.fxAll({ k: 'bell', id: this.id });
  }
  playFx() { this.onRing?.(); }
}

// ---------------------------------------------------------------------------
export class CrtTerminal extends ModelDevice {
  constructor(world, id, opts) {
    super(world, id, opts.model || 'crt_terminal', opts);
    this.program = opts.program || 'records';
    this.scr = this.screen('main', 512, 384, opts.palette || 'green', 1.3);
    this.page = 0;
    this.view = null;
    this.idleT = Math.random() * 10;
  }
  prompt() { return `[${input.keyName('interact')}] Use terminal`; }
  interact() {
    const self = this;
    const g = this.world.game;
    this.page = 0;
    g.terminal.open({
      device: this, screen: this.scr, mesh: this.model.screens?.main?.mesh,
      view: () => self.programView(g),
      select: (it) => self.programSelect(g, it),
      back: () => { if (self.page) { self.page = 0; return true; } return false; },
    });
  }
  programView(g) {
    switch (this.program) {
      case 'shift': {
        const roster = [...g.roster.values()];
        return {
          title: 'SHIFT ROSTER', subtitle: net.isOnline ? `CODE ${net.roomCode}` : 'OFFLINE',
          lines: [
            net.isOnline ? { t: `Share shift code ${net.roomCode} with up to 3 co-workers.`, c: 'hi' } : { t: 'Solo shift. Host from the main menu to invite co-workers.', c: 'dim' },
            ...roster.map((r) => `  ${r.id === net.selfId ? '>' : ' '} ${r.name}${r.id === net.hostId ? '  [SUPERVISOR]' : ''}`),
            { t: `Lifetime: ${profile.data.stats.runs} shifts, ${profile.data.stats.deaths || 0} deaths`, c: 'dim', s: 20 },
          ],
          items: [{ label: 'CLOSE', act: 'close' }],
          footer: 'R.O.O.M. PERSONNEL SYSTEM v3.11',
        };
      }
      case 'achievements': {
        const ids = Object.keys(ACHIEVEMENTS);
        const per = 8;
        const pages = Math.ceil(ids.length / per);
        const pg = this.page % pages;
        const got = ids.filter((i) => profile.has(i)).length;
        return {
          title: 'PERFORMANCE REVIEW', subtitle: `${got}/${ids.length}`,
          lines: ids.slice(pg * per, pg * per + per).map((i) => ({ t: `${profile.has(i) ? '[X]' : '[ ]'} ${ACHIEVEMENTS[i].name} — ${ACHIEVEMENTS[i].desc}`, c: profile.has(i) ? 'good' : 'dim', s: 20 })),
          items: [{ label: 'NEXT PAGE', act: 'next' }, { label: 'CLOSE', act: 'close' }],
          footer: 'Achievements unlock cosmetics at your locker.',
        };
      }
      case 'howto': {
        const pages = LORE.howto;
        const pg = pages[this.page % pages.length];
        return { title: 'ORIENTATION', subtitle: `${(this.page % pages.length) + 1}/${pages.length}`, lines: pg.map((t) => ({ t, s: 21 })), items: [{ label: 'NEXT', act: 'next' }, { label: 'CLOSE', act: 'close' }] };
      }
      default: {
        const list = LORE.records;
        const e = list[(this.opts.lore ?? 0 + this.page) % list.length];
        return { title: e.title, subtitle: 'R.O.O.M. ARCHIVE', lines: e.lines.map((t) => ({ t, s: 21 })), items: [{ label: 'NEXT FILE', act: 'next' }, { label: 'CLOSE', act: 'close' }] };
      }
    }
  }
  programSelect(g, it) {
    if (it.act === 'close') g.terminal.close();
    else if (it.act === 'next') this.page++;
  }
  update(dt) {
    if (this.world.game.terminal.session?.device === this) return;
    if (!this.nearLocal(9)) return;
    this.scr.fps = 3;
    this.scr.draw(dt, (ctx, w, h, pal, t) => {
      const v = this.programView(this.world.game);
      drawMenu(ctx, w, h, pal, t, { ...v, items: [], footer: 'PRESS [E]' });
    });
  }
}

// ---------------------------------------------------------------------------
// Uncanny wall pieces
export class Poster extends ModelDevice {
  constructor(world, id, opts) {
    super(world, id, 'poster', { ...opts, collide: false, modelOpts: { aspect: opts.aspect || 0.75 } });
    this.texts = opts.texts || [['TEAMWORK', 'Many clones. One mission.']];
    this.creepy = opts.creepy || [['DON\'T LOOK BEHIND YOU', '']];
    this.idx = 0;
    this.creepyOn = false;
    this.changeT = 8 + Math.random() * 10;
    this.scr = new CrtScreen(384, 512, 'amber');
    const sm = this.model.screens?.main?.mesh;
    if (sm) {
      sm.material = new THREE.MeshStandardMaterial({ map: this.scr.texture, roughness: 0.6 });
      this.scr.texture.colorSpace = THREE.SRGBColorSpace;
    }
    this.color = opts.color || '#2a4a7a';
    this._paint();
  }
  _paint() {
    const [title, sub] = this.creepyOn ? this.creepy[this.idx % this.creepy.length] : this.texts[this.idx % this.texts.length];
    const { ctx, w, h } = this.scr;
    ctx.fillStyle = this.creepyOn ? '#1a0a08' : this.color;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = this.creepyOn ? '#5a1a10' : 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.4, w * 0.3, 0, Math.PI * 2);
    ctx.fill();
    // cute clone mascot silhouette
    ctx.fillStyle = this.creepyOn ? '#2a0a06' : '#f2c418';
    ctx.beginPath(); ctx.ellipse(w / 2, h * 0.44, 60, 72, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(w / 2, h * 0.3, 46, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = this.creepyOn ? '#ff3020' : '#111';
    ctx.beginPath(); ctx.arc(w / 2 - 15, h * 0.29, 6, 0, Math.PI * 2); ctx.arc(w / 2 + 15, h * 0.29, 6, 0, Math.PI * 2); ctx.fill();
    if (this.creepyOn) { ctx.beginPath(); ctx.arc(w / 2, h * 0.36, 9, 0, Math.PI * 2); ctx.arc(w / 2 - 30, h * 0.33, 5, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 42px "Jolly Lodger", Georgia, serif, Arial, sans-serif';
    const lines = wrap(ctx, title, w - 40, 42);
    lines.forEach((l, i) => ctx.fillText(l, w / 2, h * 0.72 + i * 44));
    ctx.font = '22px "Jolly Lodger", Georgia, serif';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    if (sub) ctx.fillText(sub, w / 2, h * 0.72 + lines.length * 44 + 10);
    ctx.font = '16px "Jolly Lodger", Georgia, serif';
    ctx.fillText('R.O.O.M. CORP — INTERNAL USE ONLY', w / 2, h - 18);
    this.scr.texture.needsUpdate = true;
  }
  update(dt) {
    this.changeT -= dt;
    if (this.changeT <= 0 && this.unobserved()) {
      this.changeT = 15 + Math.random() * 25;
      this.creepyOn = Math.random() < 0.3;
      this.idx++;
      this._paint();
    }
  }
}

export class WallClock extends ModelDevice {
  constructor(world, id, opts) {
    super(world, id, 'wall_clock', { ...opts, collide: false });
    this.offset = 0;
    this.glitchT = 20;
    this.dir = 1;
  }
  update(dt) {
    this.glitchT -= dt;
    if (this.glitchT <= 0 && this.unobserved()) {
      this.glitchT = 20 + Math.random() * 30;
      this.offset += (Math.random() - 0.3) * 3600 * 3;
      this.dir = Math.random() < 0.15 ? -1 : 1;
    }
    const d = new Date();
    const secs = (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000) * this.dir + this.offset;
    const P = this.parts;
    if (P.second) P.second.rotation.z = -((secs % 60) / 60) * Math.PI * 2;
    if (P.minute) P.minute.rotation.z = -((secs / 60) % 60 / 60) * Math.PI * 2;
    if (P.hour) P.hour.rotation.z = -((secs / 3600) % 12 / 12) * Math.PI * 2;
  }
}

export class EmployeeOfMonth extends ModelDevice {
  constructor(world, id, opts) {
    super(world, id, 'employee_of_month', { ...opts, collide: false });
    this.portrait = new CrtScreen(384, 512, 'amber');
    this.nameScr = new CrtScreen(512, 96, 'amber');
    for (const [k, s] of [['portrait', this.portrait], ['name', this.nameScr]]) {
      const sm = this.model.screens?.[k]?.mesh;
      if (sm) sm.material = new THREE.MeshStandardMaterial({ map: s.texture, roughness: 0.5 });
    }
    this.changeT = 2;
    this.wrong = false;
    this.renderPortrait = opts.renderPortrait;
  }
  _paint() {
    const g = this.world.game;
    const roster = [...g.roster.values()];
    const r = roster.length ? roster[Math.floor(Math.random() * roster.length)] : { name: 'YOU', cosmetics: g.local.cosmetics };
    const pc = this.portrait.ctx;
    const nm = this.wrong ? ['EMPLOYEE #0000', 'IT WAS ALWAYS YOU', 'THE OTHER ONE', 'NOT YOU'][Math.floor(Math.random() * 4)] : r.name;
    if (this.renderPortrait) {
      const img = this.renderPortrait(this.wrong ? null : r.cosmetics, this.wrong);
      pc.fillStyle = '#6a5a3a';
      pc.fillRect(0, 0, 384, 512);
      if (img) pc.drawImage(img, 0, 0, 384, 512);
    } else {
      pc.fillStyle = '#5a6a8a';
      pc.fillRect(0, 0, 384, 512);
    }
    this.portrait.texture.needsUpdate = true;
    const nc = this.nameScr.ctx;
    nc.fillStyle = '#c9a65a';
    nc.fillRect(0, 0, 512, 96);
    nc.fillStyle = '#2a1a08';
    nc.font = 'bold 44px "Jolly Lodger", Georgia, serif';
    nc.textAlign = 'center';
    nc.textBaseline = 'middle';
    nc.fillText(nm.toUpperCase(), 256, 50);
    this.nameScr.texture.needsUpdate = true;
  }
  update(dt) {
    this.changeT -= dt;
    if (this.changeT <= 0 && (this.unobserved() || !this._painted)) {
      this._painted = true;
      this.changeT = 20 + Math.random() * 30;
      this.wrong = Math.random() < 0.22;
      this._paint();
    }
  }
}

// ---------------------------------------------------------------------------
export class Mirror extends ModelDevice {
  constructor(world, id, opts) {
    super(world, id, 'mirror', { ...opts, modelOpts: { width: 1.2, height: 1.6 } });
    const c = this.anchors.glassCenter || new THREE.Vector3(0, 1.4, 0.02);
    const w = opts.width || 1.1, h = opts.height || 1.5;
    this.reflector = new Reflector(new THREE.PlaneGeometry(w, h), {
      textureWidth: 512, textureHeight: 768, color: 0xb8c0c0, clipBias: 0.003,
    });
    this.reflector.position.set(c.x, c.y, c.z + 0.012);
    this.root.add(this.reflector);
    // show the local avatar while the mirror renders
    const prev = this.reflector.onBeforeRender;
    const self = this;
    this.reflector.onBeforeRender = function (...args) {
      const av = self.world.game.local.avatar;
      const was = av.root.visible;
      av.root.visible = true;
      self.world.game.local.mirrorRendering = true;
      av.setVisibleFirstPerson?.(false);
      prev.apply(this, args);
      av.setVisibleFirstPerson?.(true);
      av.root.visible = was;
    };
  }
  update() {
    this.reflector.visible = this.nearLocal(12);
  }
}

// ---------------------------------------------------------------------------
export class CoffeeMachine extends ModelDevice {
  constructor(world, id, opts) { super(world, id, 'coffee_machine', opts); }
  prompt() { return `[${input.keyName('interact')}] Brew coffee`; }
  interact() { this.send('brew'); }
  hostAction() {
    this.world.fxAll({ k: 'snd', n: 'drill', p: this.root.position.toArray(), v: 0.4, pi: 0.5 });
    const p = this.root.position.clone().add(new THREE.Vector3(0, 0.15, 0.2).applyQuaternion(this.root.quaternion)).setY(this.root.position.y + 0.4);
    setTimeout(() => this.world.props.spawn('mug', p, new THREE.Quaternion(), { state: { coffee: 1 } }), 1800);
  }
}

export class Fridge extends ModelDevice {
  constructor(world, id, opts) { super(world, id, 'fridge', opts); this.state = { open: 0 }; this.anim = 0; this.hum = null; }
  prompt() { return `[${input.keyName('interact')}] ${this.state.open ? 'Close' : 'Open'} fridge`; }
  interact() { this.send('toggle'); }
  hostAction() {
    this.setState({ open: this.state.open ? 0 : 1 });
    this.world.fxAll({ k: 'snd', n: this.state.open ? 'door_creak' : 'locker_close', p: this.root.position.toArray(), v: 0.6 });
  }
  update(dt) {
    this.anim += ((this.state.open ? 1 : 0) - this.anim) * Math.min(1, dt * 5);
    if (this.parts.door) this.parts.door.rotation.y = (this.model.params?.doorOpenSign ?? 1) * this.anim * 1.6;
    if (!this.hum && this.nearLocal(8)) this.hum = audio.loop('fridge_hum', { pos: this.root.position.clone().setY(1), volume: 0.4 });
    else if (this.hum && !this.nearLocal(12)) { this.hum.stop(0.3); this.hum = null; }
  }
}

export class ServerRack extends ModelDevice {
  constructor(world, id, opts) { super(world, id, 'server_rack', opts); this.t = 0; }
  update(dt) {
    this.t += dt;
    (this.parts.leds || []).forEach((l, i) => {
      if (!l.material) return;
      if (!l.userData.own) { l.material = l.material.clone(); l.userData.own = true; }
      l.material.emissiveIntensity = Math.sin(this.t * (3 + (i % 7)) + i * 1.7) > 0.3 ? 2.5 : 0.2;
    });
  }
}

// ---------------------------------------------------------------------------
// Workbench crafting
export class Workbench extends ModelDevice {
  constructor(world, id, opts) {
    super(world, id, 'workbench', opts);
    this.scr = this.screen('main', 512, 384, 'amber', 1.3);
  }
  _materialsOnBench() {
    const min = this.anchors.surfaceMin, max = this.anchors.surfaceMax;
    const out = [];
    this.root.updateMatrixWorld(true);
    const inv = this.root.matrixWorld.clone().invert();
    this.world.props.query(this.root.position, 2.4, (p) => {
      if (!p.def.material && p.type !== 'plank') return;
      const l = p.root.position.clone().applyMatrix4(inv);
      if (min && max) {
        if (l.x < min.x - 0.1 || l.x > max.x + 0.1 || l.z < min.z - 0.15 || l.z > max.z + 0.15 || l.y < min.y - 0.1 || l.y > max.y + 0.6) return;
      } else if (p.root.position.distanceTo(this.root.position) > 1.3) return;
      out.push(p);
    });
    return out;
  }
  _counts(list) {
    const c = {};
    for (const p of list) c[p.type] = (c[p.type] || 0) + 1;
    return c;
  }
  prompt() { return `[${input.keyName('interact')}] Use workbench — place materials on it`; }
  interact() {
    const self = this;
    const g = this.world.game;
    g.terminal.open({
      device: this, screen: this.scr, mesh: this.model.screens?.main?.mesh,
      view() {
        const counts = self._counts(self._materialsOnBench());
        const have = Object.entries(counts).map(([k, n]) => `${n}x ${itemName(k)}`).join(', ') || 'nothing';
        return {
          title: 'FABRICATION BENCH', subtitle: 'DIY-OS',
          lines: [{ t: `ON BENCH: ${have}`, s: 20 }],
          items: RECIPES.map((r) => {
            const ok = Object.entries(r.needs).every(([k, n]) => (counts[k] || 0) >= n);
            return { label: r.name, hint: Object.entries(r.needs).map(([k, n]) => `${n}${itemName(k).slice(0, 5).toUpperCase()}`).join(' '), disabled: !ok, r };
          }),
          footer: 'Put planks/scrap/screws/cloth/wire ON the bench.',
        };
      },
      select(it) { self.send('craft', { id: it.r.id }); },
    });
  }
  hostAction(a, d, from) {
    if (a !== 'craft') return;
    const r = RECIPES.find((x) => x.id === d.id);
    if (!r) return;
    const mats = this._materialsOnBench();
    const counts = this._counts(mats);
    if (!Object.entries(r.needs).every(([k, n]) => (counts[k] || 0) >= n)) return;
    const need = { ...r.needs };
    for (const p of mats) {
      if (need[p.type] > 0) { need[p.type]--; this.world.props.despawn(p.id); }
    }
    const c = this.anchorWorld('surfaceMin').lerp(this.anchorWorld('surfaceMax'), 0.5);
    this.world.fxAll({ k: 'snd', n: 'craft', p: c.toArray(), v: 1 });
    this.world.fxAll({ k: 'dust', p: c.toArray(), n: 16 });
    this.world.noise.emit(c, 14, 'craft');
    setTimeout(() => this.world.props.spawn(r.id, c.clone().add(_v.set(0, 0.35, 0)), new THREE.Quaternion(), {}), 900);
    if (from === net.selfId) profile.unlock('craft');
    else net.toPeer(from, 'ach', 'craft');
  }
  update(dt) {
    if (this.world.game.terminal.session?.device === this || !this.nearLocal(8)) return;
    this.scr.fps = 2;
    this.scr.draw(dt, (ctx, w, h, pal, t) => {
      text(ctx, 'FABRICATION BENCH', 20, 16, 34, pal.hi);
      text(ctx, 'Place materials on the bench', 20, 70, 24, pal.fg);
      text(ctx, 'and press [E] to fabricate.', 20, 96, 24, pal.fg);
      RECIPES.slice(0, 6).forEach((r, i) => text(ctx, `- ${r.name}`, 30, 140 + i * 30, 24, pal.dim));
      void t;
    });
  }
}

// ---------------------------------------------------------------------------
export class CreepyTV extends ModelDevice {
  constructor(world, id, opts) {
    super(world, id, opts.model || 'tv_crt', opts);
    this.scr = new CrtScreen(256, 192, 'green');
    this.scr.fps = 15;
    const sm = this.model.screens?.main?.mesh || this.model.object.getObjectByName?.('screen');
    if (sm) this.scr.attach(sm, 1.5);
    this.mode = opts.mode || 'static';
    this.t = 0;
    this.loop = null;
  }
  prompt() { return this.mode === 'training' ? 'R.O.O.M. Orientation Video (looping)' : '...it is watching you back'; }
  update(dt) {
    this.t += dt;
    if (!this.nearLocal(14)) { if (this.loop) { this.loop.stop(0.3); this.loop = null; } return; }
    if (!this.loop) this.loop = audio.loop('crt_whine', { pos: this.root.position.clone().setY(0.8), volume: 0.35 });
    this.scr.draw(dt, (ctx, w, h, pal, t) => {
      if (this.mode === 'training') {
        const slides = LORE.training;
        const s = slides[Math.floor(t / 4) % slides.length];
        ctx.fillStyle = '#123';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#f2c418';
        const bob = Math.sin(t * 4) * 4;
        ctx.beginPath(); ctx.ellipse(54, 120 + bob, 30, 36, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(54, 76 + bob, 24, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#000';
        ctx.fillRect(46, 72 + bob, 4, 4); ctx.fillRect(58, 72 + bob, 4, 4);
        text(ctx, s[0], 100, 30, 26, '#ffffff');
        wrap(ctx, s[1], w - 110, 20).forEach((l, i) => text(ctx, l, 100, 64 + i * 20, 20, '#cde'));
        return;
      }
      // static with occasional face
      const img = ctx.createImageData(w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 200;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      if (Math.sin(t * 0.7) > 0.93) {
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.beginPath(); ctx.arc(w / 2, h / 2, 60, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillRect(w / 2 - 25, h / 2 - 15, 10, 10); ctx.fillRect(w / 2 + 15, h / 2 - 15, 10, 10);
        ctx.fillRect(w / 2 - 20, h / 2 + 20, 40, 4);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Extension point: modules can supply their own builder for a device kind (game/crafting.js registers
// the workbench's crafting station here) without this file importing them.
export const DEVICE_FACTORIES = {};

export function makeDevice(world, kind, id, opts = {}) {
  if (DEVICE_FACTORIES[kind]) return DEVICE_FACTORIES[kind](world, id, opts);
  switch (kind) {
    case 'vending_snack': case 'vending_drink': return new VendingMachine(world, id, kind, opts);
    case 'water_cooler': return new WaterCooler(world, id, opts);
    case 'aquarium': return new Aquarium(world, id, opts);
    case 'dart_board': return new DartBoard(world, id, opts);
    case 'locker_bank': return new LockerBank(world, id, opts);
    case 'service_bell': return new ServiceBell(world, id, opts);
    case 'crt_terminal': return new CrtTerminal(world, id, opts);
    case 'lore_terminal': return new CrtTerminal(world, id, { ...opts, program: 'records' });
    case 'poster': return new Poster(world, id, opts);
    case 'wall_clock': return new WallClock(world, id, opts);
    case 'employee_of_month': return new EmployeeOfMonth(world, id, opts);
    case 'mirror': return new Mirror(world, id, opts);
    case 'coffee_machine': return new CoffeeMachine(world, id, opts);
    case 'fridge': return new Fridge(world, id, opts);
    case 'server_rack': return new ServerRack(world, id, opts);
    case 'workbench': return new Workbench(world, id, opts);
    case 'creepy_tv': return new CreepyTV(world, id, opts);
    default: {
      // generic static set-piece device
      const d = new ModelDevice(world, id, kind, opts);
      return d;
    }
  }
}

export { _q, engine };
