// Level 0 game loop (CampMission): one simple system at a time, each stage announced by the HQ
// receptionist (wristwatch feed) and by Healthity.
//
//   camp     BUILD YOUR CAMP. Open the TENT KIT crate, drag each part onto its glowing ghost marker and
//            attach it with the built-in multitool (empty hand + RMB). The last part pops the tent up.
//   survive  The stomach growls: hunger & thirst start draining (survival.needsActive). Eat or drink once.
//   sell     EARN $1,000: drop loot into the CRUSHER in the hall next to the camp (game/crusher.js) and press
//            its button: the press slams it into a cube that beams away; the value uploads to the watch
//            (game.run.credits) and fills the level's ESCAPE FUND (game.run.escape). Main mission 1 done ->
//            side quests open in the quest tree (game/economy.js; FIELD OPS kiosk) and the COMPANY STORE opens.
//            The stage stays 'sell' while the team works toward the escape fund ($1,000,000 on Level 0).
//   exit     Escape fund full: an exit materialises next to the camp. Get inside before it closes -> back to HQ.
//   done     Level cleared.
// Death: the clone is re-printed at the camp after a few seconds, costing HALF of the team's money.
//
// Public API (UI / monsters / Healthity build against it):
//   mission.objective() -> { title, detail, progress (0..1 | null) }
//   mission.tasks()     -> [{ id, text, done }]  main mission checklist (+ escape fund and open side quests after it)
//   mission.stage       -> 'camp' | 'survive' | 'sell' | 'exit' | 'done'
//   mission.quota       -> { need }            ($1,000 during main mission 1, then 0; current money: game.run.credits)
//   mission.escape      -> { have, need }      escape fund
//   mission.econ        -> Economy (quests, shop, scanner, upgrades)    mission.crusher -> Crusher device
//   mission.camp        -> { pos: Vector3, radius, built, yaw }
//   mission.padHall     -> { pos: Vector3, w, d, yaw } | null   (the crusher hall)
//   mission.markers()   -> [{ kind: 'camp' | 'crusher' | 'store' | 'ops' | 'file' | 'gen' | 'exit', pos: Vector3, label }]
//   mission.reviveEta(playerId) -> seconds until a dead clone is re-printed (null if not pending)
//   compatibility: generators = [], linksCount() = 0, radio() = null, state.exit, exitTimeLeft()
import * as THREE from 'three';
import { net } from '../net/net.js';
import { audio } from '../audio/audio.js';
import { Mission, BoxBehaviour } from './mission.js';
import { CELL, HEIGHT } from '../world/levels/yellow/layout.js';
import { LightField } from '../gfx/bakedlight.js';
import { itemDef, itemName, sellValue } from './itemdefs.js';
import {
  CAMP_MARKERS, CAMP_PARTS, PART_LANDING, KIT_POS, REVIVE_SPOTS, SNAP_DIST, TENT_Z,
  campToWorld, CampKitBehaviour, CampGhosts, CampTent,
} from './campdevices.js';
import './campsfx.js';
import './econsfx.js';
import { Economy, fmt$ } from './economy.js';
import { Crusher } from './crusher.js';
import { ShopKiosk, QuestKiosk } from './terminals.js';
import { SideQuests } from './sidequests.js';
import { Onboarding } from './onboarding.js';

const STARTER_SUPPLIES = ['flashlight', 'protein_bar', 'almond_milk', 'bandage'];
const CAMP_EXIT_SECONDS = 180;
const CLONE_DELAY = 7;
const MAIN_CASH = 1000; // main mission 1: EARN $1,000
const SURVIVE_MIN = 9, SURVIVE_MAX = 45;
// item types retired from the Level 0 loop (built-in multitool, no research / scanner / radio): swapped at spawn
const RETIRED = { multitool: 'screws', sample_jar: 'almond_water', water_tester: 'battery', camera_disposable: 'candy_bar', radio: null, clone_pad: null, supply_crate: null };
const WARM = new THREE.Color(1.0, 0.72, 0.42);
const COOL = new THREE.Color(0.75, 0.95, 1.1);

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export class CampMission extends Mission {
  constructor(level) {
    super(level);
    this.autoClone = true;
    Object.assign(this.state, { stage: 'camp', kit: 0, slots: {}, built: 0, quota: MAIN_CASH, sold: 0, clones: {}, half: 0 });
    this.camp = { pos: new THREE.Vector3(), radius: 4, built: false, yaw: 0 };
    this.padHall = null;
    this.crusher = null;
    this.shopKiosk = null;
    this.questKiosk = null;
    this.tent = null;
    this.ghosts = null;
    this.econ = new Economy(this);
    this.sideq = new SideQuests(this);
    this.snaps = [];
    this.pendingClones = new Map(); // host: playerId -> world time of re-print
    this._cloneSeen = {};           // every peer: playerId -> { t, left }
    this._stageSeen = null;
    this._slotsSeen = 0;
    this._kitSeen = 0;
    this._scanT = 0;
    this._lightT = 0;
    this._near = new Set();
    this._filled = new Set();
    this.disposed = false;
    this._placeCamp();
    this.game.local.survival.needsActive = false;
    this._patchSpawns();
  }

  // ------------------------------------------------------------------ public API
  get stage() { return this.state.stage; }
  get quota() { return { need: this.econ.mainDone() ? 0 : MAIN_CASH }; }
  get escape() { return { have: this.econ.escape, need: this.econ.quota }; }
  // the crusher runs from the moment the stomach growls (so the first meal and first sale can overlap)
  get padsOnline() { const s = this.state.stage; return s === 'survive' || s === 'sell' || s === 'exit' || s === 'done'; }
  get showValues() { return this.padsOnline; }
  get lastSale() { return this.crusher?.lastSale || 0; }

  // main mission checklist (+ escape fund and the open side quests once it is done) for the watch / receipt
  tasks() {
    const e = this.econ, out = [];
    for (const n of e.main) {
      if (n.id === 'm_escape') continue;
      out.push({ id: n.id, text: n.task || n.name, done: e.state(n) === 'claimed' });
    }
    if (e.mainDone()) {
      out.push({ id: 'escape', text: `Fill the escape fund (${fmt$(e.escape)} / ${fmt$(e.quota)})`, done: e.escape >= e.quota });
      for (const n of e.activeSide().slice(0, 4)) out.push({ id: n.id, text: e.state(n) === 'ready' ? `${n.name}: claim at FIELD OPS` : n.name, done: e.state(n) === 'ready' });
    }
    return out;
  }

  objective() {
    const st = this.state;
    const N = CAMP_MARKERS.length, n = this._filledCount();
    switch (st.stage) {
      case 'camp': {
        if (st.built) return { title: 'BUILD YOUR CAMP', detail: 'Camp built!', progress: 1 };
        if (!st.kit) return { title: 'BUILD YOUR CAMP', detail: 'Open the TENT KIT crate at the camp site', progress: 0 };
        const step = this._step();
        const what = step === 0 ? 'Attach the tent poles' : step === 1 ? 'Attach the canvas' : 'Stake it down & hang the lamp';
        return { title: 'BUILD YOUR CAMP', detail: `${what} (${n}/${N})`, progress: n / N };
      }
      case 'survive':
        return { title: 'STAY FED', detail: 'Your stomach is growling. Eat or drink something (select it, RMB)', progress: null };
      case 'sell': {
        const e = this.econ;
        if (!e.mainDone()) {
          const c = Math.min(e.escape, MAIN_CASH);
          return { title: 'EARN $1,000', detail: `Drop loot into the CRUSHER in the hall and press its button (${fmt$(c)} / ${fmt$(MAIN_CASH)})`, progress: c / MAIN_CASH };
        }
        return { title: 'FILL THE ESCAPE FUND', detail: `Crush loot, finish side quests at FIELD OPS (${fmt$(e.escape)} / ${fmt$(e.quota)})`, progress: Math.min(1, e.escape / e.quota) };
      }
      case 'exit': {
        const open = st.exit && !st.exit.done;
        return { title: 'GET OUT', detail: open ? `The exit is open next to the camp. Get inside! (${Math.ceil(this.exitTimeLeft())}s)` : 'An exit is forming next to the camp...', progress: 1 };
      }
      default:
        return { title: 'LEVEL CLEARED', detail: 'Returning to HQ', progress: 1 };
    }
  }

  markers() {
    const out = [{ kind: 'camp', pos: this.camp.pos.clone(), label: 'CAMP' }];
    if (this.crusher) out.push({ kind: 'crusher', pos: this.crusher.root.position.clone(), label: 'CRUSHER' });
    out.push(...this.sideq.markers());
    const e = this.state.exit;
    if (e && !e.done) out.push({ kind: 'exit', pos: new THREE.Vector3(e.x, 0, e.z), label: 'EXIT' });
    return out;
  }

  reviveEta(id) {
    if (net.isHost) {
      const at = this.pendingClones.get(id);
      return at == null ? null : Math.max(0, at - this.world.time);
    }
    const c = this._cloneSeen[id];
    return c ? Math.max(0, c.left - (this.world.time - c.t)) : null;
  }

  // compatibility with the old mission UI
  radio() { return null; }
  linksCount() { return 0; }
  orderCrate() {}
  requestExtraction() {}
  get generators() { return this.sideq?.gens || []; }
  set generators(v) { void v; } // Mission's constructor assigns []

  // host: a side-quest generator came online (game/generators.js)
  onGeneratorRepaired(g) {
    this.econ.bump('gens');
    this.hq(`${g.label || 'A generator'} is back online. Power restored to the sector. Mind the noise: things heard that.`, 'FIELD OPS');
  }

  // host: a quest node was claimed (game/economy.js)
  onQuestClaimed(n) {
    if (n.id === 'm_cash') {
      this.hq('MAIN MISSION 1 COMPLETE. The COMPANY STORE is open and FIELD OPS has side quests for you. The level goal: fill the ESCAPE FUND on the crusher gauge.', 'RECEPTION');
      this.world.fxAll({ k: 'snd', n: 'elevator_ding', p: this.camp.pos.toArray(), v: 0.8 });
    }
  }

  // ------------------------------------------------------------------ setup
  _bindBehaviours() {
    const props = this.world.props;
    props.registerBehaviour('camp_kit', (p) => new CampKitBehaviour(p, this));
    props.registerBehaviour('starter_box', (p) => new BoxBehaviour(p, this, 'starter'));
    this.world.customModel = (type, state) => this._customModel(type, state); // ragdolls of the fallen
  }

  _bindNet() {
    net.onClient('mstate', (s) => this._applyState(s));
    net.onHost('campAte', (d) => this._hostAte(d));
  }

  // Level 0 loot / carried items: swap the retired tool types for something useful
  _patchSpawns() {
    const props = this.world.props;
    const spawn = props.spawn.bind(props);
    props.spawn = (type, pos, quat, opts) => {
      if (Object.prototype.hasOwnProperty.call(RETIRED, type)) {
        type = RETIRED[type];
        if (!type) return null;
      }
      return spawn(type, pos, quat, opts);
    };
  }

  _floorY(x, z) { return this.level.floorY?.(x, z) ?? 0; }

  // camp clearing: the map's landmark when it has one, else the arrival room around the spawn point
  _placeCamp() {
    const lm = this.level.landmarks || null;
    let x, z, r = 3;
    if (lm?.camp) {
      x = lm.camp.x; z = lm.camp.z;
      r = Math.max(3, Math.min(lm.camp.w || 6, lm.camp.d || 6) / 2);
    } else {
      const c = this.level.spawnCenter();
      x = c.x; z = c.z;
    }
    let yaw = 0;
    const el = lm?.elevator;
    if (el) {
      // the tent faces the arrival elevator (snapped to the grid)
      const a = Math.atan2(el.x - x, el.z - z);
      yaw = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
    }
    this.camp.pos.set(x, this._floorY(x, z), z);
    this.camp.yaw = yaw;
    this.camp.radius = r;
  }

  build() {
    this._placeCamp(); // landmarks may only exist once the level finished building
    const hall = this._planPadHall();
    this.padHall = { pos: new THREE.Vector3(hall.x, this._floorY(hall.x, hall.z), hall.z), w: hall.w, d: hall.d, yaw: hall.crusher.yaw };
    // the crusher stands in the hall facing the way in from the camp
    const C = hall.crusher;
    this.crusher = new Crusher(this.world, this, C.x, this._floorY(C.x, C.z), C.z, C.yaw);
    this.world.addDevice(this.crusher);
    this.level.prepStatic(this.crusher.root, null);
    // the two kiosks flank the arrival elevator on the camp's elevator wall, facing the camp
    for (const [K, key, lx] of [[ShopKiosk, 'shopKiosk', 3.9], [QuestKiosk, 'questKiosk', -3.9]]) {
      const k = this._kioskSpot(lx);
      const dev = new K(this.world, this, k.x, this._floorY(k.x, k.z), k.z, k.yaw);
      this.world.addDevice(dev);
      this.level.prepStatic(dev.root, null);
      this[key] = dev;
    }
    this.sideq.build();
    this.ghosts = new CampGhosts(this.world, this.camp);
    this.onboarding = new Onboarding(this); // arrival crates: supplies + the broken Healthity (game/onboarding.js)
  }

  // teleport pad hall: pads in a row on the far side, the lever between them and the camp
  _planPadHall() {
    const lm = this.level.landmarks?.padHall;
    if (lm) {
      const dx = this.camp.pos.x - lm.x, dz = this.camp.pos.z - lm.z;
      const u = Math.abs(dx) > Math.abs(dz) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dz) || 1]; // toward the camp
      const v = [-u[1], u[0]];
      const Lu = u[0] ? lm.w : lm.d, Lv = u[0] ? lm.d : lm.w;
      const sp = Lv >= 8 ? 1.9 : 1.55;
      const per = Math.max(2, Math.min(4, Math.floor((Lv - 0.6) / sp)));
      const rows = Lu >= 7 ? 2 : 1;
      const pads = [];
      for (let r = 0; r < rows; r++) {
        const off = rows === 1 ? -Lu * 0.12 : -Lu * 0.08 - r * 2.2;
        for (let k = 0; k < per; k++) {
          const s = (k - (per - 1) / 2) * sp;
          pads.push([lm.x + u[0] * off + v[0] * s, lm.z + u[1] * off + v[1] * s]);
        }
      }
      const lo = Math.min(Lu / 2 - 1.0, 2.4);
      // the crusher: a little past the hall centre, its chamber mouth facing the camp
      const co = Math.min(Lu * 0.12, 2.4);
      return { x: lm.x, z: lm.z, w: lm.w, d: lm.d, pads, lever: { x: lm.x + u[0] * lo, z: lm.z + u[1] * lo, yaw: Math.atan2(u[0], u[1]) }, crusher: { x: lm.x - u[0] * co, z: lm.z - u[1] * co, yaw: Math.atan2(u[0], u[1]) } };
    }
    const fb = this._fallbackPadHall();
    fb.crusher = { x: fb.x, z: fb.z, yaw: fb.lever.yaw };
    return fb;
  }

  // kiosk on the camp's elevator wall (camp-local +Z side), lx metres left / right of the alcove, facing the camp
  _kioskSpot(lx) {
    const lm = this.level.landmarks?.camp;
    const lz = lm ? Math.min(lm.w, lm.d) / 2 - 0.7 : 3.4;
    const p = campToWorld(this.camp, lm ? lx : lx * 0.8, 0, lz);
    return { x: p.x, z: p.z, yaw: this.camp.yaw + Math.PI };
  }

  // no map landmark yet: a 2x2-cell block next to the arrival room, the most open of the four sides
  _fallbackPadHall() {
    const lvl = this.level;
    const ci = Math.round(this.camp.pos.x / CELL), cj = Math.round(this.camp.pos.z / CELL); // camp sits on a cell corner
    const cands = [
      { dir: [1, 0], i: ci + 2, j: cj - 1 }, { dir: [0, 1], i: ci - 1, j: cj + 2 },
      { dir: [-1, 0], i: ci - 4, j: cj - 1 }, { dir: [0, -1], i: ci - 1, j: cj - 4 },
    ];
    let best = null, bs = -Infinity;
    for (const c of cands) {
      let s = 0;
      for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) {
        const info = lvl.cell((c.i + di + 0.5) * CELL, (c.j + dj + 0.5) * CELL);
        if (!info) { s -= 20; continue; }
        if (info.special) s -= 10;
        if (info.water) s -= 6;
        if (info.hole) s -= 4;
      }
      if (lvl.passable) {
        s += lvl.passable(c.i, c.j, 1) ? 1 : 0;       // internal edges
        s += lvl.passable(c.i, c.j + 1, 1) ? 1 : 0;
        s += lvl.passable(c.i, c.j, 2) ? 1 : 0;
        s += lvl.passable(c.i + 1, c.j, 2) ? 1 : 0;
      }
      if (s > bs) { bs = s; best = c; }
    }
    const [ux, uz] = best.dir; // camp -> hall
    const cx = (best.i + 1) * CELL, cz = (best.j + 1) * CELL;
    const vx = -uz, vz = ux;
    const pads = [];
    for (const side of [-1, 1]) for (const o of [-0.72, 0.72]) {
      const s = side * 1.5 + o;
      pads.push([cx + ux * 1.5 + vx * s, cz + uz * 1.5 + vz * s]);
    }
    return { x: cx, z: cz, w: 6, d: 6, pads, lever: { x: cx - ux * 1.5 + vx * 1.5, z: cz - uz * 1.5 + vz * 1.5, yaw: Math.atan2(-ux, -uz) } };
  }

  hostStart(desc) {
    const w = this.world;
    this.state.quota = MAIN_CASH;
    // carried items / props from HQ fall in around the camp
    const carry = desc.carry || [];
    carry.forEach((it, i) => {
      const a = (i / Math.max(1, carry.length)) * Math.PI * 2;
      const r = 0.8 + (i % 3) * 0.4;
      const pos = campToWorld(this.camp, Math.cos(a) * r - 1.2, HEIGHT - 0.6 - (i % 2) * 0.3, 1.6 + Math.sin(a) * r * 0.6);
      w.props.spawn(it.type, pos, new THREE.Quaternion().fromArray(it.q || [0, 0, 0, 1]), { state: it.state, vel: new THREE.Vector3(0, -2, 0) });
    });
    // the tent kit waits at the camp site
    const kp = campToWorld(this.camp, KIT_POS[0], 0.26, KIT_POS[1]);
    w.props.spawn('camp_kit', kp, _q.setFromEuler(_e.set(0, this.camp.yaw + 0.25, 0)).clone(), { state: { open: 0 }, sleep: true });
    this._clearSetPieces();
    this.pushState();
    const delay = (ms, fn) => setTimeout(() => { if (!this.disposed) fn(); }, ms);
    const brief = () => this.hq(`Welcome to Level 0, employees. First task: BUILD YOUR CAMP. Your TENT KIT is waiting at the camp site. Open it, drag each part onto its glowing marker and attach it with your built-in multitool (empty hand, RMB).`, 'RECEPTION');
    // arriving by elevator: brief when the gate opens (onArrival), not in the middle of the ride
    if (this.game.ride?.active) {
      this._brief = brief;
      delay(45000, () => { if (this._brief) { this._brief = null; brief(); } });
    } else delay(3000, brief);
  }

  // called on every peer when the arrival elevator's gate opens (world/elevator_ride.js)
  onArrival() {
    this.onboarding?.onArrival();
    if (!this._brief) return;
    const b = this._brief;
    this._brief = null;
    setTimeout(() => { if (!this.disposed) b(); }, 1200);
  }

  // host: nothing may stand on the pads or the lever (chunk furniture spawned before the mission existed)
  _clearSetPieces() {
    const w = this.world;
    const spots = [[this.crusher.chamberPos(new THREE.Vector3(), 0), 2.6], [this.crusher.root.position, 2.4], [this.shopKiosk.root.position, 1.4], [this.questKiosk.root.position, 1.0], [this.camp.pos, 0]];
    for (const p of [...w.props.props.values()]) {
      if (p.dead || p.type.startsWith('camp_')) continue;
      for (const [c, r] of spots) {
        if (!r) continue;
        const rr = r + Math.min(0.8, p.radius || 0.3);
        if ((p.root.position.x - c.x) ** 2 + (p.root.position.z - c.z) ** 2 < rr * rr) { w.props.despawn(p.id); break; }
      }
    }
  }

  // ------------------------------------------------------------------ state
  pushState() { if (net.isHost) net.toAll('mstate', this.state); }

  _applyState(s) {
    this.state = s;
    if (s.exit && !this.exitDevice) this._createExit(s.exit);
    if (s.built && !this.tent) this._ensureTent(false);
    this.camp.built = !!s.built;
    for (const id in s.clones || {}) if (!this._cloneSeen[id] || this._cloneSeen[id].left !== s.clones[id]) this._cloneSeen[id] = { t: this.world.time, left: s.clones[id] };
    for (const id in this._cloneSeen) if (!(id in (s.clones || {}))) delete this._cloneSeen[id];
    if (s.stage !== this._stageSeen) {
      const was = this._stageSeen;
      this._stageSeen = s.stage;
      this._enterStage(s.stage, was);
    }
    // build-progress hints (not on the first sync: a late joiner doesn't need the play-by-play)
    const first = !this._synced;
    this._synced = true;
    if (s.kit && !this._kitSeen) {
      this._kitSeen = 1;
      if (!first && this._stageSeen === 'camp') this._say('kit_open');
    }
    const n = this._filledCount();
    if (n !== this._slotsSeen) {
      const was = this._slotsSeen;
      this._slotsSeen = n;
      if (!first && n > was && !s.built) {
        if (n === 2) this._say('poles_done');
        else if (n === 3) this._say('canvas_done');
      }
    }
  }

  serialize() { return this.state; }
  applySync(s) { this._applyState(s); }

  // every peer: the local side of a stage change
  _enterStage(stage, was) {
    const g = this.game;
    g.local.survival.needsActive = stage !== 'camp';
    if (was === null) return; // first sync / late join: no fanfare
    if (stage === 'survive') {
      audio.play('stomach_growl', { volume: 1, bus: 'ui' });
      setTimeout(() => { if (!this.disposed) audio.play('stomach_growl', { volume: 0.55, bus: 'ui', pitch: 1.25 }); }, 2600);
      g.local.shake = Math.max(g.local.shake || 0, 0.25);
      // building is hungry work: the bars show up already part-drained so eating makes a visible difference
      const sv = g.local.survival;
      if (!g.local.dead) { sv.hunger = Math.min(sv.hunger, 70); sv.thirst = Math.min(sv.thirst, 78); }
      g.ui.toast('HUNGER & THIRST ACTIVE', 'warn');
      this._say('growl');
    } else if (stage === 'sell') {
      this._say('sell');
    } else if (stage === 'exit') {
      this._say('exit');
    }
  }

  _say(key) {
    const h = this.game.healthity;
    if (!h) return;
    h.say_cool = 0;
    h.say(key);
  }

  _filledCount() {
    let n = 0;
    for (const m of CAMP_MARKERS) if (this.state.slots?.[m.key] != null) n++;
    return n;
  }

  // current build step: the lowest step that still has an empty marker (3 = all done)
  _step() {
    let s = 3;
    for (const m of CAMP_MARKERS) if (this.state.slots?.[m.key] == null) s = Math.min(s, m.step);
    return s;
  }

  _markerWorld(m, out = new THREE.Vector3()) { return campToWorld(this.camp, m.pos[0], m.pos[1], m.pos[2], out); }

  // ------------------------------------------------------------------ camp building
  hostOpenKit(prop) {
    if (prop.state.open) return;
    const w = this.world;
    w.props.setState(prop.id, { open: 1 });
    const base = prop.root.position.clone();
    const T = 0.75, G = 11.5;
    CAMP_PARTS.forEach((type, i) => {
      const [lx, lz] = PART_LANDING[i];
      const target = campToWorld(this.camp, lx, 0.3, lz);
      const from = base.clone().add(_v.set(0, 0.78 + i * 0.29, 0));
      const vel = new THREE.Vector3((target.x - from.x) / T, (target.y - from.y) / T + (G * T) / 2, (target.z - from.z) / T);
      // long parts fly lying down so they never start inside the crate or each other
      const rot = type === 'camp_pole' ? _e.set(Math.PI / 2, this.camp.yaw + i, 0) : type === 'camp_lamp' ? _e.set(0, this.camp.yaw + 1.2, Math.PI / 2) : _e.set(0, this.camp.yaw + i * 0.7, 0);
      w.props.spawn(type, from, new THREE.Quaternion().setFromEuler(rot), { vel, angvel: new THREE.Vector3(0, (Math.random() - 0.5) * 2, 0) });
    });
    // personal supplies: one set per clone
    const items = [];
    for (let k = 0; k < Math.max(1, this.game.roster.size); k++) items.push(...STARTER_SUPPLIES);
    items.forEach((t, i) => {
      const a = (i / items.length) * Math.PI * 2 + 0.3;
      const pos = base.clone().add(_v.set(Math.cos(a) * 0.5, 0.62 + (i % 2) * 0.16, Math.sin(a) * 0.5));
      w.props.spawn(t, pos, new THREE.Quaternion().setFromEuler(_e.set(Math.random(), Math.random() * 6, 0)), {
        vel: new THREE.Vector3(Math.cos(a) * 1.4, 2.2 + Math.random(), Math.sin(a) * 1.4), state: t === 'flashlight' ? { charge: 1 } : {},
      });
    });
    w.fxAll({ k: 'snd', n: 'locker_open', p: base.toArray(), v: 1 });
    w.fxAll({ k: 'snd', n: 'paper', p: base.toArray(), v: 0.8 });
    w.fxAll({ k: 'dust', p: [base.x, base.y + 0.4, base.z], n: 26 });
    this.state.kit = 1;
    this.pushState();
  }

  // every peer: can this camp part be attached right now? -> { ok, text, marker }
  campAttachCheck(prop) {
    const st = this.state;
    if (st.built || st.stage !== 'camp') return { ok: false, text: 'The camp is already built' };
    const step = this._step();
    const p = prop.root.position;
    let best = null, bd = Infinity, later = null;
    for (const m of CAMP_MARKERS) {
      if (m.type !== prop.type || st.slots?.[m.key] != null) continue;
      if (m.step !== step) { later = m; continue; }
      const wp = this._markerWorld(m, _v);
      const d = Math.hypot(p.x - wp.x, p.z - wp.z);
      if (d < bd) { bd = d; best = m; }
    }
    if (!best) {
      if (later) return { ok: false, text: step === 0 ? 'Put both tent poles up first' : 'Attach the canvas first' };
      return { ok: false, text: 'Not needed any more' };
    }
    if (bd > SNAP_DIST) return { ok: false, text: 'Drag it onto its glowing marker', marker: best };
    return { ok: true, marker: best, text: '' };
  }

  hostCampAttach(prop, from) {
    const c = this.campAttachCheck(prop);
    if (!c.ok) { net.toPeer(from, 'mtMsg', { text: c.text }); return; }
    const m = c.marker;
    const w = this.world;
    w.grab.releaseAllFor(prop.id);
    this.game.tools.unweld(prop);
    w.props.setFrozen(prop, true);
    const to = this._markerWorld(m);
    const tq = new THREE.Quaternion().setFromEuler(_e.set(0, this.camp.yaw + m.yaw, 0));
    this.snaps.push({ id: prop.id, from: prop.root.position.clone(), fq: prop.root.quaternion.clone(), to, tq, t: 0 });
    this.state.slots[m.key] = prop.id;
    if (prop.type === 'camp_lamp') w.props.setState(prop.id, { lit: 1 });
    w.fxAll({ k: 'camp', e: 'attach', key: m.key, p: to.toArray() });
    w.noise.emit(to, 8, 'camp');
    this.pushState();
    if (this._filledCount() >= CAMP_MARKERS.length) this.popAt = w.time + 0.9;
  }

  _hostPop() {
    const w = this.world;
    for (const m of CAMP_MARKERS) {
      const id = this.state.slots[m.key];
      if (id != null) w.props.despawn(id);
    }
    this.snaps.length = 0;
    this.state.built = 1;
    this.econ.bump('built');
    w.fxAll({ k: 'camp', e: 'pop' }); // builds + animates the tent on every peer
    this.pushState();
    this.stageAt = { stage: 'survive', t: w.time + 5.5 }; // let the pop + cheer land, then the stomach growls
    this.hq('Camp registered. Lovely work. Your new home has been added to the company asset register.', 'RECEPTION');
  }

  _ensureTent(animate) {
    if (!this.tent) {
      this.tent = new CampTent(this.world, this.camp);
      this.world.addDevice(this.tent);
      this.level.prepStatic(this.tent.root, null);
    }
    if (animate) this.tent.pop();
    this.camp.built = true;
  }

  // ------------------------------------------------------------------ survive -> sell
  onItemUsed(type) {
    const u = itemDef(type).use;
    if (u === 'eat' || u === 'drink' || u === 'heal') net.toHost('campAte', { u });
  }

  _hostAte(d) {
    this.econ.bump(d?.u === 'heal' ? 'heal' : 'eat');
    if (this.state.stage !== 'survive' || this._ate || d?.u === 'heal') return;
    this._ate = true;
    const t = Math.max(this.world.time + 1.5, (this.surviveAt ?? 0) + SURVIVE_MIN);
    if (!this.stageAt || this.stageAt.t > t) this.stageAt = { stage: 'sell', t };
  }

  _hostSetStage(stage) {
    const st = this.state;
    if (st.stage === stage) return;
    st.stage = stage;
    this.stageAt = null;
    if (stage === 'survive') {
      this.surviveAt = this.world.time;
      this.stageAt = { stage: 'sell', t: this.world.time + SURVIVE_MAX };
      setTimeout(() => { if (!this.disposed) this.hq('Hunger and thirst monitoring is now ACTIVE. Please eat or drink something before you faint on company time.', 'RECEPTION'); }, 1200);
    } else if (stage === 'sell') {
      this.hq(`Final step of your first mission: EARN $${st.quota}. Furniture is money. Drop it into the CRUSHER in the hall next to camp and press the red button. Payment uploads to your watch.`, 'RECEPTION');
    }
    this.pushState();
  }

  // ------------------------------------------------------------------ deaths: automatic re-cloning at camp
  onPlayerDied(id) {
    if (!net.isHost) return;
    this.pendingClones.set(id, this.world.time + CLONE_DELAY);
    this.state.clones[id] = CLONE_DELAY;
    this.pushState();
  }

  _revivePos(i) {
    const [x, z] = REVIVE_SPOTS[i % REVIVE_SPOTS.length];
    const p = campToWorld(this.camp, x, 0.05, z);
    const t = campToWorld(this.camp, 0, 0, TENT_Z);
    return { pos: p, yaw: Math.atan2(-(p.x - t.x), -(p.z - t.z)) }; // back to the tent, looking out over the camp
  }

  _hostClones() {
    let k = 0;
    for (const [id, at] of this.pendingClones) {
      if (this.world.time < at) continue;
      this.pendingClones.delete(id);
      delete this.state.clones[id];
      const r = this.game.roster.get(id);
      if (!r || !r.dead) { this.pushState(); continue; }
      const run = this.game.run;
      const cost = Math.floor(run.credits / 2);
      run.credits -= cost;
      this.game.pushRun();
      const sp = this._revivePos(k++);
      this.game.hostRevive(id, sp.pos, sp.yaw, cost);
      this.world.fxAll({ k: 'snd', n: 'clone_machine', p: sp.pos.toArray(), v: 0.8 });
      this.pushState();
    }
  }

  // ------------------------------------------------------------------ the exit
  _hostOpenExit() {
    const st = this.state;
    if (st.exit) return;
    if (st.stage !== 'exit') { st.stage = 'exit'; this.stageAt = null; }
    const spot = this._findExitSpot(this.camp.pos);
    if (!spot) { this.exitRetryAt = this.world.time + 4; this.pushState(); return; }
    st.extraction = 1;
    st.exit = { x: spot.x, z: spot.z, rot: spot.rot, endsAt: this.game.day.time + CAMP_EXIT_SECONDS, done: 0 };
    // clear the room's footprint (props get pushed out into the open neighbour cell)
    const c = new THREE.Vector3(spot.x, 0, spot.z);
    const fx = Math.sin(spot.rot), fz = Math.cos(spot.rot);
    let k = 0;
    this.world.props.query(c, 4, (p) => {
      if (p.frozen) return;
      const r = Math.min(1.2, p.radius || 0.3);
      if (Math.abs(p.root.position.x - spot.x) < 1.6 + r && Math.abs(p.root.position.z - spot.z) < 1.6 + r) {
        const side = ((k % 3) - 1) * 0.95, up = 0.3 + Math.floor(k / 3) * 0.6;
        k++;
        this.world.props.teleport(p, new THREE.Vector3(spot.x + fx * 3.2 + fz * side, p.root.position.y + up, spot.z + fz * 3.2 - fx * side));
      }
    });
    this.pushState();
    this.world.fxAll({ k: 'snd', n: 'exit_door_appear', p: [spot.x, 1.2, spot.z], v: 1 });
    this.hq(`ESCAPE FUND FULL (${fmt$(this.econ.escape)}). An EXIT has opened next to your camp. Everyone inside within ${CAMP_EXIT_SECONDS} seconds. Thank you for your service.`, 'RECEPTION');
  }

  // exit room: a closed-off corner cell of the camp clearing when the map has one (door facing the camp),
  // else the base ring search around the camp (never inside the camp or the pad hall)
  _findExitSpot(from) {
    const lvl = this.level;
    const lm = lvl.landmarks?.camp;
    if (lm && lvl.passable) {
      const i0 = Math.round((lm.x - lm.w / 2) / CELL), j0 = Math.round((lm.z - lm.d / 2) / CELL);
      const i1 = i0 + Math.round(lm.w / CELL) - 1, j1 = j0 + Math.round(lm.d / CELL) - 1;
      const tent = campToWorld(this.camp, 0, 0, TENT_Z);
      const kit = campToWorld(this.camp, KIT_POS[0], 0, KIT_POS[1]);
      const el = lvl.landmarks.elevator;
      const hall = this.padHall?.pos;
      const corners = [[i0, j0], [i1, j0], [i0, j1], [i1, j1]].map(([i, j]) => ({ i, j, x: (i + 0.5) * CELL, z: (j + 0.5) * CELL }));
      // nearest the pad hall first: clones coming back from the pads walk right into it
      if (hall) corners.sort((a, b) => Math.hypot(a.x - hall.x, a.z - hall.z) - Math.hypot(b.x - hall.x, b.z - hall.z));
      for (const c of corners) {
        if (Math.hypot(c.x - tent.x, c.z - tent.z) < 4 || Math.hypot(c.x - kit.x, c.z - kit.z) < 2.6) continue;
        if (el && Math.hypot(c.x - el.x, c.z - el.z) < 4.5) continue;
        // both outward edges must be solid (a corner with an opening is a way out of the clearing)
        const outX = c.i === i0 ? 3 : 1, outZ = c.j === j0 ? 0 : 2;
        if (lvl.passable(c.i, c.j, outX) || lvl.passable(c.i, c.j, outZ)) continue;
        const dx = lm.x - c.x, dz = lm.z - c.z;
        const dir = Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 1 : 3) : (dz > 0 ? 2 : 0);
        return { x: c.x, z: c.z, rot: [Math.PI, Math.PI / 2, 0, -Math.PI / 2][dir], i: c.i, j: c.j };
      }
    }
    const i0 = Math.floor(from.x / CELL), j0 = Math.floor(from.z / CELL);
    const hall = this.padHall;
    const blocked = (x, z) => {
      if (Math.hypot(x - this.camp.pos.x, z - this.camp.pos.z) < this.camp.radius + 1.6) return true;
      if (hall && Math.abs(x - hall.pos.x) < hall.w / 2 + 1.6 && Math.abs(z - hall.pos.z) < hall.d / 2 + 1.6) return true;
      return false;
    };
    for (let r = 2; r <= 7; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di, j = j0 + dj;
        const x = (i + 0.5) * CELL, z = (j + 0.5) * CELL;
        if (blocked(x, z)) continue;
        const c = lvl.cell(x, z);
        if (!c || c.special || c.water) continue;
        const dir = Math.abs(di) > Math.abs(dj) ? (di > 0 ? 3 : 1) : (dj > 0 ? 0 : 2);
        if (!lvl.passable(i, j, dir)) continue;
        return { x, z, rot: [Math.PI, Math.PI / 2, 0, -Math.PI / 2][dir], i, j };
      }
    }
    return null;
  }

  _hostExitTick() {
    const e = this.state.exit;
    if (!e || e.done || !this.exitDevice) return;
    const now = this.game.day.time;
    const inside = [], outside = [];
    for (const r of this.game.roster.values()) {
      if (r.dead) continue;
      const p = r.id === net.selfId ? this.game.local.pos : r.pose ? _v.fromArray(r.pose.p) : null;
      if (p && this.exitDevice.contains(p)) inside.push(r.id); else outside.push(r.id);
    }
    // everyone alive is in: close early
    if (inside.length && !outside.length && e.endsAt - now > 4.5) {
      e.endsAt = now + 4;
      this.pushState();
      this.hq('All employees accounted for. Doors closing.', 'RECEPTION');
    }
    if (now < e.endsAt) return;
    if (!inside.length) {
      // nobody made it in: the exit wavers but holds a little longer
      e.endsAt = now + 60;
      this.pushState();
      this.hq('EXIT VECTOR UNSTABLE. It will hold for 60 more seconds. Get inside!', 'RECEPTION');
      return;
    }
    this._hostCloseExit(inside);
  }

  _hostCloseExit(survivors) {
    const e = this.state.exit;
    if (!e || e.done) return;
    e.done = 1;
    this.state.stage = 'done';
    this.pushState();
    this.world.fxAll({ k: 'snd', n: 'door_heavy_open', p: [e.x, 1, e.z], v: 1, pi: 0.6 });
    net.toAll('exitClosing', {});
    this.game.unlockAll('escape');
    const n = (survivors || []).length;
    this.game.saveRun?.('escape', { cleared: this.world.type });
    setTimeout(() => this.game.hostRunOver(`ESCAPE FUND FILLED — ${this.econ.rules.name} CLEARED`, { success: true, quota: this.econ.quota, escape: this.econ.escape, survivors: n }), 1800);
  }

  // ------------------------------------------------------------------ fx (every peer)
  playFx(m, p) {
    if (m.k === 'crusher') return this.crusher?.playFx(m);
    if (m.k !== 'camp') return super.playFx(m, p);
    const w = this.world;
    const pos = m.p ? new THREE.Vector3().fromArray(m.p) : null;
    switch (m.e) {
      case 'attach':
        this.ghosts?.flash(m.key);
        if (pos) {
          w.fx.sparks(pos, 26, null, [0.6, 1, 0.7], 3.5);
          w.fx.flashLight(pos, 0x9dffb8, 10, 0.2, 5);
          audio.play('fuse_insert', { pos, volume: 1 });
          audio.play('bolt_turn', { pos, volume: 0.8 });
        }
        break;
      case 'pop': {
        this._ensureTent(true);
        const c = campToWorld(this.camp, 0, 0.5, TENT_Z);
        w.fx.dustBurst(c, 50, [0.7, 0.68, 0.55], 2.2);
        w.fx.sparks(c.setY(c.y + 1), 40, new THREE.Vector3(0, 1, 0), [1, 0.8, 0.4], 4);
        w.fx.flashLight(c, 0xffc070, 14, 0.5, 8);
        audio.play('tent_pop', { pos: c, volume: 1 });
        this._say('camp_built');
        setTimeout(() => { if (!this.disposed) audio.play('credits', { volume: 0.7, bus: 'ui' }); }, 700);
        break;
      }
      default: break;
    }
  }

  // ------------------------------------------------------------------ frame
  update(dt) {
    this.econ.update(dt);
    this._updateGhosts(dt);
    this._updateLights(dt);
    this._updateExitClient(dt);
    if (!net.isHost) return;
    this._hostUpdate(dt);
  }

  _hostUpdate(dt) {
    const w = this.world;
    const st = this.state;
    // parts gliding onto their markers
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      const s = this.snaps[i];
      const p = w.props.get(s.id);
      if (!p || p.dead) { this.snaps.splice(i, 1); continue; }
      s.t = Math.min(1, s.t + dt / 0.35);
      const k = s.t * s.t * (3 - 2 * s.t);
      p.root.position.lerpVectors(s.from, s.to, k);
      p.root.quaternion.slerpQuaternions(s.fq, s.tq, k);
      w.props.forceSendIds.add(p.id);
      if (s.t >= 1) this.snaps.splice(i, 1);
    }
    if (this.popAt && w.time >= this.popAt) { this.popAt = null; this._hostPop(); }
    if (this.stageAt && w.time >= this.stageAt.t) this._hostSetStage(this.stageAt.stage);
    this.econ.hostTick(dt);
    this.sideq.hostUpdate(dt);
    if (st.stage === 'sell' && this.econ.escape >= this.econ.quota) this._hostOpenExit();
    if (st.stage === 'exit' && !st.exit && this.exitRetryAt && w.time >= this.exitRetryAt) { this.exitRetryAt = null; this._hostOpenExit(); }
    this._hostExitTick();
    if (this.pendingClones.size) this._hostClones();
  }

  _updateGhosts(dt) {
    if (!this.ghosts) return;
    const st = this.state;
    const show = st.stage === 'camp' && !st.built;
    this._filled.clear();
    this._near.clear();
    if (show) {
      for (const m of CAMP_MARKERS) if (st.slots?.[m.key] != null) this._filled.add(m.key);
      const step = this._step();
      const l = this.game.local;
      for (const p of this.world.props.props.values()) {
        if (!p.def.camp || p.frozen || p.dead) continue;
        const c = this.campAttachCheck(p);
        if (c.ok) {
          this._near.add(c.marker.key);
          // first time someone holds a part over its marker: tell them how to attach it
          if (!this._attachHinted && l.grab?.id === p.id) { this._attachHinted = true; this._say('attach_hint'); }
        }
      }
      this.ghosts.update(dt, this._filled, step, this._near, true);
    } else this.ghosts.update(dt, this._filled, 3, this._near, false);
  }

  // the lit camp lamp warms the camp's light; the pad hall goes cold white once it is online
  _updateLights(dt) {
    this._lightT -= dt;
    if (this._lightT > 0) return;
    this._lightT = 0.5;
    if (this.camp.built) {
      const lm = CAMP_MARKERS.find((m) => m.key === 'lamp');
      const lp = this._markerWorld(lm, _v);
      this._forceLight(lp.x, lp.z, WARM, 1.45);
      const tc = campToWorld(this.camp, 0, 0, TENT_Z);
      this._forceLight(tc.x, tc.z, WARM, 1.25);
    }
    if (this.padsOnline && this.crusher) {
      const c = this.crusher.chamberPos(_v, 0);
      this._forceLight(c.x, c.z, COOL, 1.5);
    }
  }

  _forceLight(x, z, color, base) {
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
    const l = this.world.field.get(LightField.texel(i, j));
    if (!l || l.ci !== i || l.cj !== j) return;
    if (l.forced && l.override?.equals(color) && l.base === base) return;
    l.forced = true;
    l.mode = 'on';
    l.override = color.clone();
    l.base = base;
    l._force = true;
    this.world.field.dirty = true;
  }

  dispose() {
    this.disposed = true;
    this.onboarding?.dispose();
    this.econ.dispose();
    this.sideq.dispose();
    net.clientHandlers.delete('mstate');
    net.clientHandlers.delete('exitClosing');
    net.hostHandlers.delete('campAte');
    this.ghosts?.dispose();
    this.game.local.survival.needsActive = true;
  }
}
