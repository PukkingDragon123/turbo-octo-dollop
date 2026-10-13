// Mission logic for a Backrooms dimension: generators, the carryable field radio (research
// uplink, sample deposit, supply orders, extraction), starter kit, supply crates, cloning pad,
// the exit door + evacuation countdown, dead bodies and HQ chatter.
import * as THREE from 'three';
import { net } from '../net/net.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { profile } from '../core/profile.js';
import { RNG, hash3 } from '../core/rng.js';
import { Device } from './devices.js';
import { DieselGenerator, ElectricGenerator, MechGenerator } from './generators.js';
import { buildModel } from '../entities/catalog.js';
import { buildRagdoll, Avatar } from '../entities/avatar.js';
import { CrtScreen, text, bar, drawMenu } from '../ui/crt.js';
import { CRATE_LOOT, SAMPLES, itemName } from './itemdefs.js';
import { RAPIER, GROUPS } from '../physics/physics.js';
import { CELL, CHUNK, HEIGHT } from '../world/levels/yellow/layout.js';
import { LightField } from '../gfx/bakedlight.js';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const EXIT_SECONDS = 120;
const STARTER = ['flashlight', 'protein_bar', 'almond_milk', 'bandage', 'multitool'];

export const CRATE_TIERS = [
  { id: 'basic', name: 'RATIONS CRATE', cost: 120, n: 4, pool: ['almond_water', 'canned_food', 'protein_bar', 'soda_can', 'chips', 'almond_milk', 'candy_bar', 'energy_drink'] },
  { id: 'medical', name: 'MEDICAL CRATE', cost: 160, n: 4, pool: ['medkit', 'bandage', 'bandage', 'antibiotics', 'painkillers', 'splint', 'almond_water'] },
  { id: 'tools', name: 'FIELD EQUIPMENT', cost: 200, n: 4, pool: ['battery', 'battery', 'flare', 'glowstick', 'welder', 'sample_jar', 'sample_jar', 'flashlight', 'noise_maker', 'multitool'] },
  { id: 'random', name: 'MYSTERY CRATE', cost: 90, n: 3, pool: null },
];

export class Mission {
  constructor(level) {
    this.level = level;
    this.world = level.world;
    this.game = level.game;
    this.generators = [];
    this.state = { links: [], extraction: 0, exit: null, crates: 0 };
    this.bodies = new Map(); // playerId -> [prop ids] (host)
    this.pendingCrates = [];
    this.linkT = 0;
    this.radioId = null;
    this.exitDevice = null;
    this.photosSubmitted = new Map(); // subjectKey -> count
    this._bindBehaviours();
    this._bindNet();
  }

  // -------------------------------------------------------------
  _bindNet() {
    net.onClient('shock', (d) => {
      const l = this.game.local;
      l.survival.damage(d.dmg, 'blunt', { cause: 'electrocution' });
      l.shake = 0.6;
      audio.play('hurt', { volume: 0.7 });
      this.game.ui.toast('ZAP! Wrong terminal.', 'bad');
      if (l.survival.dead) l.onDeath('electrocution');
    });
    net.onClient('mstate', (s) => this._applyState(s));
    net.onHost('photos', (d, from) => this._hostPhotos(d, from));
    net.onHost('samples', (d, from) => this._hostSamples(d, from));
  }

  _bindBehaviours() {
    const props = this.world.props;
    props.registerBehaviour('radio', (p) => new RadioBehaviour(p, this));
    props.registerBehaviour('starter_box', (p) => new BoxBehaviour(p, this, 'starter'));
    props.registerBehaviour('supply_crate', (p) => new BoxBehaviour(p, this, 'crate'));
    props.registerBehaviour('clone_pad', (p) => new ClonePadBehaviour(p, this));
    props.registerBehaviour('fuel_can', (p) => ({ prompt: () => null, update() {}, onState() {} }));
    this.world.customModel = (type, state) => this._customModel(type, state);
  }

  // -------------------------------------------------------------
  build() {
    const lvl = this.level;
    for (const m of lvl.missionChunks) {
      const x = (m.cx * CHUNK + 4) * CELL, z = (m.cz * CHUNK + 4) * CELL;
      const id = `gen_${m.kind}`;
      let g;
      if (m.kind === 'diesel') g = new DieselGenerator(this.world, id, this);
      else if (m.kind === 'electric') g = new ElectricGenerator(this.world, id, this, hash3(lvl.seed, 5, 5, 5));
      else g = new MechGenerator(this.world, id, this);
      // generators against the room's north side, facing into the room
      g.root.position.set(x, 0, z - 1.6);
      g.root.rotation.y = 0;
      g.chunk = [m.cx, m.cz];
      this.world.addDevice(g);
      lvl.prepStatic(g.root, null);
      this.generators.push(g);
      // re-add colliders at final transform
      for (const c of g.colliders) this.world.physics.removeCollider(c);
      if (g.body) this.world.physics.removeBody(g.body);
      g.colliders = [];
      g.addColliders(g.model.colliders);
    }
  }

  hostStart(desc) {
    const lvl = this.level;
    const c = lvl.spawnCenter();
    const players = [...this.game.roster.values()];
    // carried items/props from the previous dimension fall in with the clones
    const carry = desc.carry || [];
    carry.forEach((it, i) => {
      const a = (i / Math.max(1, carry.length)) * Math.PI * 2;
      const r = 0.6 + (i % 3) * 0.5;
      const pos = new THREE.Vector3(c.x + Math.cos(a) * r, HEIGHT - 0.6 - (i % 2) * 0.3, c.z + Math.sin(a) * r);
      this.world.props.spawn(it.type, pos, new THREE.Quaternion().fromArray(it.q || [0, 0, 0, 1]), { state: it.state, vel: new THREE.Vector3(0, -2, 0) });
    });
    // fresh start: starter kit box (one kit per clone present), radio and cloning pad
    const items = [];
    for (let i = 0; i < Math.max(1, players.length); i++) items.push(...STARTER);
    this.world.props.spawn('starter_box', new THREE.Vector3(c.x, HEIGHT - 0.5, c.z), new THREE.Quaternion(), { state: { items, open: 0 }, vel: new THREE.Vector3(0, -3, 0) });
    this.world.fxAll({ k: 'ceiling', p: [c.x, HEIGHT - 0.1, c.z] });
    const radio = this.world.props.spawn('radio', new THREE.Vector3(c.x + 2.6, 0.3, c.z - 0.4), _q.setFromEuler(new THREE.Euler(0, -0.6, 0)), { state: { battery: 45, links: [] } });
    this.radioId = radio?.id ?? null;
    this.world.props.spawn('clone_pad', new THREE.Vector3(c.x - 2.6, 0.2, c.z + 0.2), _q.setFromEuler(new THREE.Euler(0, 0.8, 0)), {});
    this.state.radioId = this.radioId;
    this.pushState();
    // HQ briefing
    setTimeout(() => {
      this.hq(`WELCOME TO DIMENSION ${this.game.run.depth - 1 === 0 ? '0' : `0-${String.fromCharCode(65 + this.game.run.depth - 1)}`}, EMPLOYEES. Locate and restart 3 GENERATORS. Carry the FIELD RADIO to each running generator to establish uplink.`);
    }, 2500);
    setTimeout(() => this.hq('Reminder: reality in this sector degrades over 7 days. You have 70 minutes. Cloning is expensive. Please do not die.'), 11000);
  }

  pushState() { if (net.isHost) net.toAll('mstate', this.state); }
  _applyState(s) {
    const hadExit = this.state.exit;
    this.state = s;
    this.radioId = s.radioId ?? this.radioId;
    if (s.exit && (!hadExit || !this.exitDevice)) this._createExit(s.exit);
  }
  serialize() { return this.state; }
  applySync(s) { this._applyState(s); }

  hq(textStr, from = 'HQ') { if (net.isHost) net.toAll('hq', { text: textStr, from }); }

  // -------------------------------------------------------------
  onGeneratorRepaired(g) {
    const n = this.generators.filter((x) => x.running).length;
    this.hq(`${g.label} ONLINE (${n}/3). Bring the field radio within cable range to establish uplink.`, 'DIAGNOSTICS');
    this.game.addCredits(60, `${g.label} restored`);
    if (n === 3) this.game.unlockAll('generators');
  }

  weldTick(point) {
    for (const g of this.generators) if (g.weldTick && g.root.position.distanceTo(point) < 3 && g.weldTick(point)) return true;
    return false;
  }

  radio() { return this.radioId != null ? this.world.props.get(this.radioId) : null; }

  linksCount() { return this.generators.filter((g) => g.state.linked).length; }

  // -------------------------------------------------------------
  update(dt) {
    if (!net.isHost) { this._updateExitClient(dt); return; }
    // radio uplink to running generators
    this.linkT -= dt;
    const radio = this.radio();
    if (this.linkT <= 0 && radio) {
      this.linkT = 0.5;
      for (const g of this.generators) {
        if (!g.running || g.state.linked) continue;
        const d = g.root.position.distanceTo(radio.root.position);
        if (d < 3.6) {
          const link = Math.min(1, (g.state.link || 0) + 0.5 / 6);
          g.setState({ link });
          if (link >= 1) {
            g.setState({ linked: 1 });
            const n = this.linksCount();
            this.world.props.setState(radio.id, { battery: Math.min(100, (radio.state.battery ?? 40) + 40), links: this.generators.filter((x) => x.state.linked).map((x) => x.id) });
            this.world.fxAll({ k: 'snd', n: 'transmit', p: radio.root.position.toArray(), v: 1 });
            this.hq(n < 3 ? `UPLINK ${n}/3 ESTABLISHED. Radio battery recharged.` : 'ALL UPLINKS ESTABLISHED. Request EXTRACTION from the field radio when your team is ready.');
            this.game.addCredits(40, `Uplink ${n}/3`);
          }
        } else if (g.state.link > 0 && g.state.link < 1) {
          g.setState({ link: Math.max(0, g.state.link - 0.05) });
        }
      }
      // passive battery drain
      const b = radio.state.battery ?? 40;
      if (b > 0 && Math.random() < 0.12) this.world.props.setState(radio.id, { battery: Math.max(0, +(b - 0.25).toFixed(2)) });
    }
    // incoming supply crates
    for (let i = this.pendingCrates.length - 1; i >= 0; i--) {
      const c = this.pendingCrates[i];
      c.t -= dt;
      if (!c.rumbled && c.t < 3) {
        c.rumbled = true;
        this.world.fxAll({ k: 'snd', n: 'crate_rumble', p: [c.pos.x, HEIGHT, c.pos.z], v: 1 });
      }
      if (c.t <= 0) {
        this.pendingCrates.splice(i, 1);
        this.world.fxAll({ k: 'ceiling', p: [c.pos.x, HEIGHT - 0.1, c.pos.z] });
        this.world.props.spawn('supply_crate', new THREE.Vector3(c.pos.x, HEIGHT - 0.45, c.pos.z), _q.setFromEuler(new THREE.Euler(0.1, Math.random() * 6, 0.05)), {
          state: { loot: c.loot, tier: c.tier, open: 0 }, vel: new THREE.Vector3(0, -7, 0),
        });
        this.world.noise.emit(c.pos, 30, 'crate');
      }
    }
    // the exit door countdown
    if (this.state.exit && !this.state.exit.done) {
      const left = this.state.exit.endsAt - this.game.day.time;
      if (left <= 0) this._hostCloseExit();
    }
    this._updateExitClient(dt);
    // sinking bodies etc. are handled by anomalies
  }

  // -------------------------------------------------------------
  // photos & samples (host)
  _hostPhotos(d, from) {
    let total = 0;
    const lines = [];
    for (const ph of d.photos || []) {
      const key = ph.key || ph.subject;
      const n = this.photosSubmitted.get(key) || 0;
      const mul = n === 0 ? 1 : n === 1 ? 0.35 : 0.1;
      const val = Math.round((ph.value || 0) * mul);
      this.photosSubmitted.set(key, n + 1);
      total += val;
      lines.push(`${ph.subject}: ${val} CR`);
    }
    if (total > 0) this.game.addCredits(total, `Research photos (${(d.photos || []).length})`);
    net.toPeer(from, 'hq', { text: lines.length ? `RESEARCH RECEIVED — ${lines.slice(0, 4).join(' · ')}` : 'NO USABLE RESEARCH IN TRANSMISSION.', from: 'RESEARCH DIV.' });
  }

  _hostSamples(d, from) {
    let total = 0;
    const kinds = [...(d.kinds || [])];
    const radio = this.radio();
    if (radio) {
      this.world.props.query(radio.root.position, 1.8, (p) => {
        if (p.type === 'sample_jar' && p.state.kind && !p.dead) {
          kinds.push(p.state.kind);
          this.world.props.despawn(p.id, { k: 'snd', n: 'transmit', p: p.root.position.toArray() });
        }
      });
    }
    for (const k of kinds) total += SAMPLES[k]?.credits || 20;
    this.samplesDeposited = (this.samplesDeposited || 0) + kinds.length;
    if (this.samplesDeposited >= 5) this.game.unlockAll('collector');
    if (total > 0) {
      this.game.addCredits(total, `${kinds.length} sample${kinds.length > 1 ? 's' : ''} received`);
      if (radio) this.world.fxAll({ k: 'snd', n: 'transmit', p: radio.root.position.toArray(), v: 1 });
    } else net.toPeer(from, 'hq', { text: 'NO SAMPLES DETECTED. Hold filled jars or place them next to the radio.', from: 'RESEARCH DIV.' });
  }

  orderCrate(tierId) {
    const tier = CRATE_TIERS.find((t) => t.id === tierId);
    const radio = this.radio();
    if (!tier || !radio) return;
    if (this.game.run.credits < tier.cost) {
      this.hq(`INSUFFICIENT CREDITS. ${tier.name} costs ${tier.cost} CR.`, 'LOGISTICS');
      return;
    }
    this.game.run.credits -= tier.cost;
    this.game.pushRun();
    const rng = new RNG((Math.random() * 1e9) | 0);
    const loot = [];
    for (let i = 0; i < tier.n + rng.int(0, 1); i++) loot.push(tier.pool ? rng.pick(tier.pool) : rng.weighted(CRATE_LOOT));
    // drop spot: a cell centre near the radio
    const rp = radio.root.position;
    const ci = Math.floor(rp.x / CELL) + rng.int(-1, 1), cj = Math.floor(rp.z / CELL) + rng.int(-1, 1);
    const pos = new THREE.Vector3((ci + 0.5) * CELL + rng.range(-0.5, 0.5), 0, (cj + 0.5) * CELL + rng.range(-0.5, 0.5));
    this.pendingCrates.push({ t: 14, pos, loot, tier: tier.id });
    this.state.crates++;
    this.pushState();
    this.hq(`${tier.name} DISPATCHED. ETA 14 SECONDS. Stand clear of the ceiling.`, 'LOGISTICS');
    this.game.unlockAll('crate');
  }

  // -------------------------------------------------------------
  // extraction & exit door
  requestExtraction() {
    if (!net.isHost || this.state.extraction) return;
    if (this.linksCount() < 3) return;
    const radio = this.radio();
    const spot = this._findExitSpot(radio ? radio.root.position : this.level.spawnCenter());
    if (!spot) { this.hq('NO STABLE EXIT VECTOR NEARBY. Move the radio and try again.'); return; }
    this.state.extraction = 1;
    this.state.exit = { x: spot.x, z: spot.z, rot: spot.rot, endsAt: this.game.day.time + EXIT_SECONDS, done: 0 };
    // clear props out of the room footprint
    const c = new THREE.Vector3(spot.x, 0, spot.z);
    this.world.props.query(c, 2.4, (p) => {
      if (Math.abs(p.root.position.x - spot.x) < 1.6 && Math.abs(p.root.position.z - spot.z) < 1.6) {
        const out = new THREE.Vector3(spot.x + Math.sin(spot.rot) * 3.2, p.root.position.y + 0.3, spot.z + Math.cos(spot.rot) * 3.2);
        this.world.props.teleport(p, out);
      }
    });
    this.pushState();
    this.world.fxAll({ k: 'snd', n: 'exit_door_appear', p: [spot.x, 1.2, spot.z], v: 1 });
    this.hq(`EXIT VECTOR MATERIALIZED. You have ${EXIT_SECONDS} seconds. Carry everything of value through the door. Anyone left behind is a write-off.`);
  }

  _findExitSpot(from) {
    const lvl = this.level;
    const i0 = Math.floor(from.x / CELL), j0 = Math.floor(from.z / CELL);
    let best = null;
    for (let r = 2; r <= 6 && !best; r++) {
      for (let dj = -r; dj <= r && !best; dj++) for (let di = -r; di <= r && !best; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di, j = j0 + dj;
        const c = lvl.cell((i + 0.5) * CELL, (j + 0.5) * CELL);
        if (!c || c.special || c.water) continue;
        // door faces the side the radio is on; that edge must be passable
        const dir = Math.abs(di) > Math.abs(dj) ? (di > 0 ? 3 : 1) : (dj > 0 ? 0 : 2);
        if (!lvl.passable(i, j, dir)) continue;
        const rot = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][dir];
        best = { x: (i + 0.5) * CELL, z: (j + 0.5) * CELL, rot, i, j };
      }
    }
    return best;
  }

  _createExit(e) {
    if (this.exitDevice) return;
    const dev = new ExitDoor(this.world, 'exit', this, e);
    this.world.addDevice(dev);
    this.level.prepStatic(dev.root, null);
    this.exitDevice = dev;
    // force the cell's light on and cold white
    const l = this.world.field.get(LightField.texel(Math.floor(e.x / CELL), Math.floor(e.z / CELL)));
    if (l) { l.forced = true; l.mode = 'on'; l.override = new THREE.Color(1, 0.98, 0.95); l.base = 1.5; l._force = true; }
  }

  exitTimeLeft() {
    if (!this.state.exit || this.state.exit.done) return 0;
    return Math.max(0, this.state.exit.endsAt - this.game.day.time);
  }

  _updateExitClient() {
    if (!this.state.exit || !this.exitDevice) return;
    this.exitDevice.timeLeft = this.exitTimeLeft();
  }

  _hostCloseExit() {
    const e = this.state.exit;
    e.done = 1;
    this.pushState();
    const dev = this.exitDevice;
    const survivors = [];
    for (const r of this.game.roster.values()) {
      if (r.dead) continue;
      const p = r.id === net.selfId ? this.game.local.pos : r.pose ? new THREE.Vector3().fromArray(r.pose.p) : null;
      if (p && dev.contains(p)) survivors.push(r.id);
    }
    // props inside travel along
    const carry = [];
    this.world.props.query(new THREE.Vector3(e.x, 1, e.z), 2.5, (p) => {
      if (p.dead || !dev.contains(p.root.position)) return;
      if (p.type.startsWith('rag_') || p.type === 'clone_pad' && false) return;
      carry.push({ type: p.type, state: p.state, q: p.root.quaternion.toArray() });
    });
    this.world.fxAll({ k: 'snd', n: 'door_heavy_open', p: [e.x, 1, e.z], v: 1, pi: 0.6 });
    net.toAll('exitClosing', {});
    setTimeout(() => this.game.hostEvacuate(survivors, carry), 1800);
  }

  // -------------------------------------------------------------
  // dead bodies: ragdolls made of jointed props
  _customModel(type, state) {
    if (!type.startsWith('rag_')) return null;
    const part = type.slice(4);
    const rd = buildRagdoll(state?.cos || {});
    const P = rd.parts[part];
    if (!P) return null;
    const object = new THREE.Group();
    object.add(P.mesh);
    let colliders, mass;
    if (part === 'torso') { colliders = [{ type: 'box', size: [P.half[0] * 2, P.half[1] * 2, P.half[2] * 2], pos: [0, 0, 0] }]; mass = 16; }
    else if (part === 'head') { colliders = [{ type: 'ball', radius: P.radius, pos: [0, 0, 0] }]; mass = 4; }
    else { colliders = [{ type: 'capsule', radius: P.radius, halfHeight: P.halfHeight, pos: [0, 0, 0] }]; mass = 2.5; }
    return { object, colliders, mass, material: 'soft', halfHeight: 0.15, anchors: {}, parts: {}, ragdoll: rd };
  }

  spawnBody(id, cosmetics, pos, yaw, vel) {
    if (!net.isHost) return;
    this.removeBody(id);
    const rd = buildRagdoll(cosmetics || {});
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw || 0, 0));
    const ids = {};
    for (const name of Object.keys(rd.parts)) {
      const local = new THREE.Vector3(...(rd.pose[name] || [0, 0.5, 0])).applyQuaternion(q);
      const p = this.world.props.spawn('rag_' + name, pos.clone().add(local), q, { state: { cos: cosmetics || {}, owner: id }, vel: vel.clone().multiplyScalar(0.6).add(new THREE.Vector3((Math.random() - 0.5), 1, (Math.random() - 0.5))) });
      if (p) ids[name] = p;
    }
    // joints
    for (const j of rd.joints) {
      const a = ids[j.a], b = ids[j.b];
      if (!a?.body || !b?.body) continue;
      const jd = RAPIER.JointData.spherical({ x: j.anchorA[0], y: j.anchorA[1], z: j.anchorA[2] }, { x: j.anchorB[0], y: j.anchorB[1], z: j.anchorB[2] });
      this.world.physics.world.createImpulseJoint(jd, a.body, b.body, true);
    }
    for (const p of Object.values(ids)) this.world.physics.setBodyGroups(p.body, GROUPS.ragdoll | 0);
    this.bodies.set(id, Object.values(ids).map((p) => p.id));
  }

  removeBody(id) {
    const list = this.bodies.get(id);
    if (!list) return;
    for (const pid of list) this.world.props.despawn(pid);
    this.bodies.delete(id);
  }

  // decorative remains of an earlier clone (static)
  decorDeadClone(rec, pos, rng) {
    const a = new Avatar({ suit: rng.pick(['yellow', 'orange', 'white']), hat: rng.pick(['none', 'hardhat', 'beanie']), visor: 'dark', face: 'dots', backpack: 'tank', accessory: 'none' });
    a.update(0.016, { speed: 0, grounded: true, dead: true, expression: 'dead', moveDir: new THREE.Vector2() });
    a.root.position.copy(pos).setY(0.12);
    a.root.rotation.set(-Math.PI / 2 + 0.15, rng.next() * 6, 0.2);
    rec.group.add(a.root);
    this.level.prepStatic(a.root, rec);
    rec.deadClone = a.root.position.clone();
  }

  onPropGrabbed(prop, from) {
    if (this.world.grab.grabberCount(prop.id) >= 3) this.game.unlockAll('teamlift');
    void from;
  }

  playFx(m) {
    if (m.k === 'gen') {
      const d = this.world.devices.get(m.id);
      d?.playFx?.(m);
    }
  }

  dispose() {
    for (const t of ['shock', 'mstate', 'exitClosing']) net.clientHandlers.delete(t);
    for (const t of ['photos', 'samples']) net.hostHandlers.delete(t);
    for (const g of this.generators) g.runLoop?.stop(0.2);
  }
}

// =============================================================================
// Field radio (physics prop behaviour)
class RadioBehaviour {
  constructor(prop, mission) {
    this.prop = prop;
    this.mission = mission;
    this.game = mission.game;
    const m = prop.model;
    this.screen = new CrtScreen(512, 384, 'amber');
    this.screen.fps = 5;
    if (m.screens?.main?.mesh) this.screen.attach(m.screens.main.mesh, 1.4);
    this.view = 'main';
    this.staticLoop = null;
    this.ledT = 0;
    mission.radioId = prop.id;
    this.cable = null;
  }

  prompt() {
    const k = input.keyName('interact');
    return `[${k}] Use Field Radio   [hold LMB] Carry`;
  }

  interact() {
    const self = this;
    const g = this.game;
    g.terminal.open({
      prop: this.prop,
      screen: this.screen,
      mesh: this.prop.model.screens?.main?.mesh,
      view: () => self._menu(),
      select: (it) => self._select(it),
      back: () => { if (self.view !== 'main') { self.view = 'main'; return true; } return false; },
      onClose: () => { self.view = 'main'; },
    });
  }

  _menu() {
    const g = this.game;
    const st = this.prop.state;
    const battery = st.battery ?? 40;
    const links = this.mission.linksCount();
    const day = g.day;
    const photos = g.local.photos?.length || 0;
    const jars = g.local.inv.slots.filter((s) => s && s.type === 'sample_jar' && s.state.kind).length;
    const pwr = battery > 0;
    const header = {
      title: 'R.O.O.M. FIELD RADIO',
      subtitle: `DAY ${day.day}/7  ${day.leftString()}`,
    };
    if (this.view === 'order') {
      return {
        ...header,
        lines: [`CREDITS: ${g.run.credits} CR`, { t: 'Crates arrive through the ceiling ~14s after ordering.', c: 'dim', s: 20 }],
        items: [...CRATE_TIERS.map((t) => ({ label: t.name, hint: `${t.cost} CR`, disabled: g.run.credits < t.cost || !pwr, act: 'buy', tier: t.id })), { label: 'BACK', act: 'back' }],
        footer: '[W/S] SELECT  [E] ORDER  [TAB] BACK',
      };
    }
    if (this.view === 'tasks') {
      const lines = this.mission.generators.map((gen) => ({ t: `${gen.label}: ${gen.running ? (gen.state.linked ? 'UPLINKED' : 'RUNNING - NEEDS RADIO') : 'OFFLINE'}`, c: gen.state.linked ? 'good' : gen.running ? 'fg' : 'bad', s: 22 }));
      const ex = this.mission.state.exit;
      lines.push({ t: ex ? `EXIT CLOSES IN ${Math.ceil(this.mission.exitTimeLeft())}s` : links >= 3 ? 'READY FOR EXTRACTION' : `UPLINKS ${links}/3`, c: 'hi', s: 22 });
      return { ...header, lines, items: [{ label: 'BACK', act: 'back' }], footer: 'OBJECTIVES' };
    }
    const dead = [...g.roster.values()].filter((r) => r.dead);
    return {
      ...header,
      lines: [
        { t: `BATTERY ${Math.round(battery)}%   UPLINKS ${links}/3   CREDITS ${g.run.credits}`, c: battery < 15 ? 'bad' : 'fg', s: 22 },
        dead.length ? { t: `DECEASED: ${dead.map((d) => d.name).join(', ')} (clone ${g.cloneCost()} CR at pad)`, c: 'bad', s: 20 } : { t: 'ALL EMPLOYEES ACCOUNTED FOR', c: 'dim', s: 20 },
      ],
      items: [
        { label: `TRANSMIT RESEARCH (${photos} photo${photos === 1 ? '' : 's'})`, hint: '5%', disabled: !pwr || !photos, act: 'photos' },
        { label: `DEPOSIT SAMPLES (${jars} held)`, hint: '5%', disabled: !pwr, act: 'samples' },
        { label: 'ORDER SUPPLY CRATE >', hint: '10%', disabled: !pwr, act: 'order' },
        { label: 'OBJECTIVES >', act: 'tasks' },
        { label: this.mission.state.extraction ? 'EXTRACTION IN PROGRESS' : 'REQUEST EXTRACTION', hint: links >= 3 ? '' : `${links}/3`, disabled: !pwr || links < 3 || !!this.mission.state.extraction, act: 'extract' },
      ],
      footer: pwr ? '[W/S] SELECT  [E] CONFIRM  [TAB] LEAVE' : 'NO POWER — LINK TO A RUNNING GENERATOR',
    };
  }

  _select(it) {
    const g = this.game;
    switch (it.act) {
      case 'back': this.view = 'main'; break;
      case 'order': this.view = 'order'; break;
      case 'tasks': this.view = 'tasks'; break;
      case 'buy': net.toHost('act', { k: 'p', id: this.prop.id, a: 'buy', d: { tier: it.tier } }); this.view = 'main'; break;
      case 'photos': {
        const photos = (g.local.photos || []).map((p) => ({ subject: p.subject, key: p.key, value: p.value }));
        g.local.photos = [];
        net.toHost('photos', { photos });
        net.toHost('act', { k: 'p', id: this.prop.id, a: 'drain', d: { n: 5 } });
        audio.play('transmit', { pos: this.prop.root.position });
        break;
      }
      case 'samples': {
        const kinds = [];
        g.local.inv.slots.forEach((s, i) => {
          if (s && s.type === 'sample_jar' && s.state.kind) { kinds.push(s.state.kind); g.local.inv.remove(i); }
        });
        net.toHost('samples', { kinds });
        net.toHost('act', { k: 'p', id: this.prop.id, a: 'drain', d: { n: 5 } });
        break;
      }
      case 'extract': net.toHost('act', { k: 'p', id: this.prop.id, a: 'extract' }); break;
      default: break;
    }
  }

  hostAction(a, d) {
    const m = this.mission;
    const b = this.prop.state.battery ?? 40;
    if (b <= 0 && a !== 'extract') return;
    if (a === 'buy') {
      m.orderCrate(d.tier);
      this.mission.world.props.setState(this.prop.id, { battery: Math.max(0, b - 10) });
    } else if (a === 'drain') {
      this.mission.world.props.setState(this.prop.id, { battery: Math.max(0, b - (d?.n || 5)) });
    } else if (a === 'extract') {
      m.requestExtraction();
    }
  }

  onState() {}

  update(dt) {
    const g = this.game;
    const st = this.prop.state;
    // idle screen (the radio always shows DAY X/7)
    if (!g.terminal.session || g.terminal.session.prop !== this.prop) {
      const d = this.prop.root.position.distanceTo(g.local.pos);
      if (d < 14) {
        this.screen.draw(dt, (ctx, w, h, pal, t) => {
          text(ctx, 'R.O.O.M. FIELD RADIO', 20, 14, 30, pal.hi);
          text(ctx, `DAY ${g.day.day}/7`, w / 2, 70, 92, pal.fg, 'center');
          text(ctx, `${g.day.leftString()} UNTIL DAY ${Math.min(7, g.day.day + 1)}`, w / 2, 168, 26, pal.dim, 'center');
          text(ctx, `UPLINKS ${this.mission.linksCount()}/3`, 24, 220, 30, pal.fg);
          text(ctx, `${g.run.credits} CR`, w - 24, 220, 30, pal.fg, 'right');
          text(ctx, 'BATTERY', 24, 268, 24, pal.fg);
          bar(ctx, 130, 268, w - 154, 26, (st.battery ?? 40) / 100, (st.battery ?? 40) < 15 ? pal.bad : pal.fg, pal.dim);
          const ex = this.mission.state.exit;
          if (ex && !ex.done) text(ctx, `EVACUATE: ${Math.ceil(this.mission.exitTimeLeft())}s`, w / 2, 316, 34, Math.floor(t * 3) % 2 ? pal.bad : pal.hi, 'center');
          else text(ctx, (st.battery ?? 40) > 0 ? 'SIGNAL ▂▃▅▆ ' + (Math.floor(t * 2) % 2 ? '◉' : ' ') : 'NO POWER', 24, 320, 24, pal.dim);
        });
      }
    }
    // LEDs + antenna
    const P = this.prop.model.parts;
    this.ledT += dt;
    (P.leds || []).forEach((l, i) => {
      if (!l.material) return;
      if (!l.userData.own) { l.material = l.material.clone(); l.userData.own = true; }
      const on = i < this.mission.linksCount() || (i === 3 && Math.floor(this.ledT * 2) % 2 === 0);
      l.material.emissiveIntensity = on ? 2.5 : 0.1;
    });
    if (P.antenna) P.antenna.scale.y = 1 + Math.sin(this.ledT * 0.5) * 0.02;
    // uplink cable to the closest linking generator
    this._updateCable();
  }

  _updateCable() {
    let target = null;
    for (const gen of this.mission.generators) {
      if (!gen.running) continue;
      if (gen.root.position.distanceTo(this.prop.root.position) < 3.6) { target = gen; break; }
    }
    if (!target) { if (this.cable) this.cable.visible = false; return; }
    const a = this.prop.root.position.clone().add(_v.set(0, 0.1, 0));
    const b = target.root.position.clone().add(_v.set(0, 0.6, 0.5));
    const mid = a.clone().lerp(b, 0.5);
    mid.y = Math.min(a.y, b.y) - 0.15;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    if (!this.cable) {
      this.cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.015, 6), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }));
      this.mission.world.group.add(this.cable);
    } else {
      this.cable.geometry.dispose();
      this.cable.geometry = new THREE.TubeGeometry(curve, 20, 0.015, 6);
    }
    this.cable.visible = true;
  }

  dispose() { this.cable?.removeFromParent(); }
}

// =============================================================================
// Starter box / supply crate
class BoxBehaviour {
  constructor(prop, mission, kind) {
    this.prop = prop;
    this.mission = mission;
    this.kind = kind;
    this.anim = prop.state.open ? 1 : 0;
  }
  prompt() {
    if (this.prop.state.open) return null;
    return `[${input.keyName('interact')}] Open ${this.kind === 'starter' ? 'Starter Kit' : 'Supply Crate'}`;
  }
  interact() { net.toHost('act', { k: 'p', id: this.prop.id, a: 'open' }); }
  hostAction(a) {
    if (a !== 'open' || this.prop.state.open) return;
    const w = this.mission.world;
    w.props.setState(this.prop.id, { open: 1 });
    const items = this.kind === 'starter' ? this.prop.state.items || STARTER : this.prop.state.loot || [];
    const base = this.prop.root.position.clone();
    items.forEach((t, i) => {
      const a2 = (i / items.length) * Math.PI * 2;
      const pos = base.clone().add(new THREE.Vector3(Math.cos(a2) * 0.15, 0.35 + (i % 3) * 0.12, Math.sin(a2) * 0.15));
      w.props.spawn(t, pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random(), Math.random() * 6, 0)), {
        vel: new THREE.Vector3(Math.cos(a2) * 1.6, 3 + Math.random() * 1.5, Math.sin(a2) * 1.6),
        state: t === 'flashlight' ? { charge: 1 } : t === 'welder' ? { fuel: 1 } : {},
      });
    });
    w.fxAll({ k: 'snd', n: this.kind === 'starter' ? 'paper' : 'locker_open', p: base.toArray(), v: 1 });
    w.fxAll({ k: 'dust', p: base.toArray(), n: 14 });
  }
  onState() {}
  update(dt) {
    const target = this.prop.state.open ? 1 : 0;
    this.anim += (target - this.anim) * Math.min(1, dt * 6);
    const P = this.prop.model.parts;
    if (P.lid) P.lid.rotation.x = (this.prop.model.params?.lidOpenSign ?? -1) * this.anim * 1.9;
    (P.flaps || []).forEach((f) => {
      if (f.userData.rest === undefined) f.userData.rest = { x: f.rotation.x };
      f.rotation.x = f.userData.rest.x + this.anim * 2.1; // +x opens every flap
    });
  }
}

// =============================================================================
// Cloning pad
class ClonePadBehaviour {
  constructor(prop, mission) {
    this.prop = prop;
    this.mission = mission;
    this.game = mission.game;
    this.screen = new CrtScreen(256, 192, 'cyan');
    this.screen.fps = 4;
    if (prop.model.screens?.main?.mesh) this.screen.attach(prop.model.screens.main.mesh, 1.3);
    this.t = 0;
    const ring = prop.model.parts.ring;
    if (ring?.material) ring.material = ring.material.clone();
  }
  prompt() {
    const dead = [...this.game.roster.values()].filter((r) => r.dead);
    if (!dead.length) return 'Cloning Pad — no deceased employees  [hold LMB] Drag';
    return `[${input.keyName('interact')}] Clone ${dead[0].name} (${this.game.cloneCost()} CR)`;
  }
  interact() {
    const dead = [...this.game.roster.values()].filter((r) => r.dead);
    if (!dead.length) return;
    if (this.game.run.credits < this.game.cloneCost()) {
      this.game.ui.toast(`Need ${this.game.cloneCost()} CR — transmit research!`, 'bad');
      audio.play('ui_error', { volume: 0.5 });
      return;
    }
    net.toHost('requestClone', { target: dead[0].id, pad: this.prop.id });
  }
  onState() {}
  update(dt) {
    this.t += dt;
    const dead = [...this.game.roster.values()].filter((r) => r.dead);
    const ring = this.prop.model.parts.ring;
    if (ring?.material?.emissive) ring.material.emissiveIntensity = dead.length ? 1.5 + Math.sin(this.t * 4) * 1.2 : 0.6;
    if (this.prop.root.position.distanceTo(this.game.local.pos) < 10) {
      this.screen.draw(dt, (ctx, w, h, pal) => {
        text(ctx, 'CLONE-O-MAT', 10, 6, 28, pal.hi);
        text(ctx, dead.length ? `${dead.length} PENDING` : 'STANDBY', 10, 44, 26, dead.length ? pal.bad : pal.good);
        text(ctx, `COST ${this.game.cloneCost()} CR`, 10, 84, 24, pal.fg);
        text(ctx, `BALANCE ${this.game.run.credits}`, 10, 114, 24, pal.fg);
      });
    }
  }
}

// =============================================================================
// Exit door + decontamination room
class ExitDoor extends Device {
  constructor(world, id, mission, e) {
    super(world, id, {});
    this.mission = mission;
    this.e = e;
    this.timeLeft = EXIT_SECONDS;
    this.root.position.set(e.x, 0, e.z);
    this.root.rotation.y = e.rot;
    // shell occupies the cell; door on its +Z side (toward the radio)
    const shell = buildModel('exit_room_shell', { seed: 1, frontWall: true });
    // the shell extends toward -Z from its open side; inset slightly to avoid z-fighting with cell walls
    shell.object.position.set(0, 0, CELL / 2 - 0.08);
    shell.object.scale.set(0.95, 1, 0.95);
    this.root.add(shell.object);
    const door = buildModel('exit_door', { seed: 1 });
    door.object.position.set(0, 0, CELL / 2 - 0.05);
    this.root.add(door.object);
    this.door = door;
    this.shell = shell;
    this.root.updateMatrixWorld(true);
    // colliders: three walls + ceiling handled by world; door frame sides
    const t = 0.15, H = HEIGHT, half = CELL / 2;
    const add = (lx, lz, hx, hz) => {
      const p = new THREE.Vector3(lx, H / 2, lz).applyMatrix4(this.root.matrixWorld);
      const rot = Math.abs(Math.sin(e.rot)) > 0.5;
      this.addBox(p, new THREE.Vector3(rot ? hz : hx, H / 2, rot ? hx : hz));
    };
    add(0, -half, half, t);          // back wall
    add(-half, 0, t, half);          // left
    add(half, 0, t, half);           // right
    add(-half + 0.55, half, 0.55, t); // front left of door
    add(half - 0.55, half, 0.55, t);  // front right of door
    this.screen = new CrtScreen(256, 128, 'red');
    this.screen.fps = 8;
    const sm = door.screens?.countdown?.mesh || door.screens?.sign?.mesh;
    if (sm) this.screen.attach(sm, 2);
    this.anim = 0;
    this.redLights = shell.parts.lights || [];
    this.redLights.forEach((l) => { if (l.material) l.material = l.material.clone(); });
    if (door.parts.glow?.material) door.parts.glow.material = door.parts.glow.material.clone();
    this.tick = 0;
    this.closing = false;
    net.onClient('exitClosing', () => { this.closing = true; audio.play('door_heavy_open', { pos: this.root.position, pitch: 0.6 }); });
  }

  contains(p) {
    const local = this.root.worldToLocal(p.clone());
    return Math.abs(local.x) < CELL / 2 - 0.1 && local.z > -CELL / 2 + 0.1 && local.z < CELL / 2 + 0.25 && local.y > -0.5 && local.y < HEIGHT;
  }

  prompt() {
    return `EXIT — ${Math.ceil(this.timeLeft)}s. Get inside with everything you want to keep!`;
  }

  update(dt) {
    const tl = this.timeLeft;
    const open = this.closing || tl <= 0 ? 0 : 1;
    this.anim += (open - this.anim) * Math.min(1, dt * (open ? 2 : 6));
    const d = this.door.parts.door;
    if (d) d.rotation.y = (this.door.params?.doorOpenSign ?? 1) * this.anim * 1.7;
    const glow = this.door.parts.glow;
    if (glow?.material) glow.material.emissiveIntensity = 2 + Math.sin(this.world.time * 6) * 0.8;
    this.redLights.forEach((l) => { if (l.material) l.material.emissiveIntensity = tl < 30 ? (Math.floor(this.world.time * 4) % 2 ? 3 : 0.3) : 1.5; });
    this.screen.draw(dt, (ctx, w, h, pal, t) => {
      text(ctx, 'EXIT', w / 2, 4, 44, pal.fg, 'center');
      const s = Math.ceil(tl);
      text(ctx, `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, w / 2, 52, 64, tl < 30 && Math.floor(t * 4) % 2 ? pal.hi : pal.fg, 'center');
    });
    // ticking
    const sec = Math.ceil(tl);
    if (sec !== this.tick && tl > 0) {
      this.tick = sec;
      if (sec <= 10 || sec % 10 === 0) audio.play('countdown_tick', { pos: this.root.position, volume: sec <= 10 ? 1 : 0.5 });
    }
  }

  dispose() {
    net.clientHandlers.delete('exitClosing');
    super.dispose();
  }
}
