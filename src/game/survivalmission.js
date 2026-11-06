// Level 0 survival loop (SurvivalMission, level.mission). There is no job: the clone woke up in the Backrooms and
// the only goals are to stay alive and to find a way out. Nothing is handed out and nothing is ticked off.
//
//   wake up      the clone comes to on the carpet of the clearing next to where the elevator left it
//                (game/arrival.js); a field notebook lies by its hand, a broken field radio in a corner nearby
//   gather       furniture and junk come apart into materials (game/gather.js): by hand, with tools, or with
//                the multitool (battery)
//   craft        in the hands, then at benches you build (game/crafting.js); tiers: hands -> workbench ->
//                + vise -> + soldering kit (game.survival.progress, game/progress.js)
//   shelter      the first bed you sleep in claims a shelter; build it up (game/shelter.js): door, barricades,
//                storage, stove, light, insulation, traps. Warm and safer at night.
//   food, water  rooms, vending machines, fridges, coolers; puddles fill a bottle with dirty water (boil it in
//                the stove pan, or filter it)
//   the radio    game/radio.js (another module) owns it and game.escape; this mission only places the radio
//   death        everything carried drops where the clone died; after CLONE_DELAY s it wakes up again in its bed
//                (or where it first woke up), short wake-up sequence. The 7-day clock keeps running.
// Public API (UI / monsters / the watch build against it):
//   mission.survival = true             mission.camp -> { pos, radius, built } (the shelter, for the raids)
//   mission.objective() -> { title, detail, progress: null }   mission.tasks() -> []
//   mission.markers()   -> [{ kind, pos, label }]               mission.reviveEta(playerId)
//   mission.shelter     -> Shelter      mission.wakeSpot(i) -> { pos, yaw }
import * as THREE from 'three';
import { net } from '../net/net.js';
import { profile } from '../core/profile.js';
import { Mission } from './mission.js';
import { Q } from '../physics/physics.js';
import { Shelter, SHELTER_R, DUSK_FROM } from './shelter.js';
import { WakeUp } from './arrival.js';
import { NOTES } from './bio.js';

const CLONE_DELAY = 7;
// item types retired from the Level 0 loop: swapped at spawn (loot tables, old saves, HQ cargo)
const RETIRED = { sample_jar: 'bottle', water_tester: 'battery', camera_disposable: 'candy_bar', clone_pad: null, supply_crate: null, case_file: 'note_scribble', nailgun: 'metal_scrap', up_battery: 'battery', up_carry: null, up_plasma: null, up_sanity: null, camp_kit: null, camp_pole: 'stick', camp_canvas: 'fabric_scrap', camp_stakes: 'stick' };
// the furniture someone left stacked in the big hall next to the clearing: the first things to take apart
const HALL_PILE = [
  ['pallet', 2], ['crate_wood', 2], ['chair_wood', 3], ['chair_folding', 2], ['table_folding', 1], ['desk', 1], ['filing_cabinet', 1],
  ['box_large', 2], ['box_medium', 2], ['cinder_block', 3], ['lamp_floor', 1], ['mattress', 1], ['chair_office', 1], ['trash_can', 1],
  ['broom', 1], ['bucket', 1], ['coat_rack', 1], ['crt_monitor', 1], ['stool', 2],
];

const _v = new THREE.Vector3();

export class SurvivalMission extends Mission {
  constructor(level) {
    super(level);
    this.survival = true;
    this.autoClone = true;
    this.state = { shelter: null, beds: {}, rating: 0, ins: 0, clones: {} };
    this.camp = { pos: new THREE.Vector3(), radius: SHELTER_R, built: false, yaw: 0 };
    this.pendingClones = new Map(); // host: playerId -> world time of waking up again
    this._cloneSeen = {};
    this.disposed = false;
    this.shelter = new Shelter(this);
    this.shelter.register();
    this.wakeup = new WakeUp(this);
    this.game.arrival = this.wakeup;
    this.radio = null; // the radio module's handle (game/radio.js), if it is there
    this._dusk = -1;
    this._patchSpawns();
    this.game.local.survival.needsActive = true;
    NOTE_TOTAL(this.game);
  }

  // ------------------------------------------------------------------ public API
  // 'camp' until the team has a shelter (Level 0 scares stay quiet on Day 1 until then), then none
  get stage() { return this.state.shelter ? undefined : 'camp'; }
  tasks() { return []; }
  objective() {
    const p = this.game.survival?.progress || {};
    const detail = !p.shelter ? 'Find somewhere to sleep' : p.bench < 1 ? 'Somewhere to work' : p.tool < 2 ? 'Better tools' : 'Find a way out';
    return { title: 'STAY ALIVE', detail, progress: null };
  }

  markers() {
    const out = [];
    const sh = this.state.shelter;
    if (sh) out.push({ kind: 'camp', pos: new THREE.Vector3(sh.x, 0, sh.z), label: 'SHELTER' });
    const bed = this.shelter.bedOf(net.selfId);
    if (bed && (!sh || Math.hypot(bed.root.position.x - sh.x, bed.root.position.z - sh.z) > 3)) out.push({ kind: 'spot', pos: bed.root.position.clone(), label: 'BED' });
    if (!sh && this.wakeAt) out.push({ kind: 'spot', pos: this.wakeAt.clone(), label: 'WOKE UP' });
    let benches = 0;
    for (const p of this.world.props.props.values()) {
      if ((p.type === 'scrap_bench' || p.type === 'field_bench') && benches < 3) { benches++; if (!sh || p.root.position.distanceTo(_v.set(sh.x, 0, sh.z)) > 3) out.push({ kind: 'spot', pos: p.root.position.clone(), label: 'BENCH' }); }
      else if (p.type === 'radio') out.push({ kind: 'spot', pos: p.root.position.clone(), label: 'RADIO' });
    }
    out.push(...(this.game.survival?.discoveryMarkers() || []));
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

  // compatibility with older mission consumers
  radioProp() { return null; }
  linksCount() { return 0; }
  get generators() { return []; }
  set generators(v) { void v; } // Mission's constructor assigns []

  // ------------------------------------------------------------------ setup
  _bindBehaviours() {
    this.world.customModel = (type, state) => this._customModel(type, state); // ragdolls of the fallen
  }

  _bindNet() {
    net.onClient('mstate', (s) => this._applyState(s));
  }

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

  // where clone i wakes up: lying on the carpet of the clearing by the elevator alcove, head toward the alcove,
  // facing the way out to the big hall
  wakeSpot(i = 0) {
    const lm = this.level.landmarks?.camp;
    const cx = lm ? lm.x : this.level.spawnCenter().x, cz = lm ? lm.z : this.level.spawnCenter().z;
    const offs = [[0, -0.6], [-1.3, 0.5], [1.3, 0.4], [0.1, 1.7]];
    const o = offs[i % offs.length];
    return { pos: new THREE.Vector3(cx + o[0], this._floorY(cx, cz) + 0.05, cz + o[1]), yaw: -Math.PI / 2 + (i % 2 ? 0.25 : -0.15) };
  }

  build() {
    const w = this.wakeSpot(0);
    this.wakeAt = w.pos.clone();
    this.camp.pos.copy(w.pos);
    // the radio module plugs in here, when it is there (game/radio.js: export installRadio(mission))
    try {
      const mods = import.meta.glob('./radio.js', { eager: true });
      const R = Object.values(mods)[0];
      if (R?.installRadio) this.radio = R.installRadio(this) || null;
    } catch (e) { console.error('[survival] radio', e); }
  }

  hostStart(desc) {
    const w = this.world;
    const ws = this.wakeSpot(0);
    // what the clones carried out of the elevator lies scattered around them
    const carry = desc.carry || [];
    carry.forEach((it, i) => {
      const a = (i / Math.max(1, carry.length)) * Math.PI * 2;
      const r = 1.1 + (i % 3) * 0.35;
      w.props.spawn(it.type, new THREE.Vector3(ws.pos.x + Math.cos(a) * r, ws.pos.y + 0.4, ws.pos.z + Math.sin(a) * r), new THREE.Quaternion().fromArray(it.q || [0, 0, 0, 1]), { state: it.state });
    });
    // the field notebook by the first clone's hand
    const fwd = new THREE.Vector3(-Math.sin(ws.yaw), 0, -Math.cos(ws.yaw)), side = new THREE.Vector3(Math.cos(ws.yaw), 0, -Math.sin(ws.yaw));
    const nb = ws.pos.clone().addScaledVector(fwd, -0.35).addScaledVector(side, 0.5).setY(ws.pos.y + 0.06);
    w.props.spawn('notebook', nb, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ws.yaw + 0.5, 0)), { sleep: true });
    // the broken field radio, in a corner of the clearing
    const lm = this.level.landmarks?.camp;
    if (lm) {
      const rx = lm.x - lm.w / 2 + 1.1, rz = lm.z - lm.d / 2 + 1.3;
      w.props.spawn('radio', new THREE.Vector3(rx, this._floorY(rx, rz) + 0.3, rz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.7, 0)), { state: { broken: 1 }, sleep: true });
      // a few things kicked into the corners of the clearing
      const bits = [['chair_wood', -0.35, 0.3], ['box_medium', 0.38, -0.36], ['cinder_block', 0.4, 0.38]];
      for (const [t, fx, fz] of bits) {
        const x = lm.x + fx * lm.w, z = lm.z + fz * lm.d;
        w.props.spawn(t, new THREE.Vector3(x, this._floorY(x, z) + 0.5, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, x * 3.1, 0)), { sleep: true });
      }
    }
    this._hallPile();
    this.pushState();
  }

  // host: furniture stacked in the big concrete hall next to the clearing (the old storage hall)
  _hallPile() {
    const H = this.level.landmarks?.padHall;
    if (!H) return;
    const w = this.world;
    let seed = (this.level.seed >>> 0) || 1;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const list = [];
    for (const [t, n] of HALL_PILE) for (let i = 0; i < n; i++) list.push(t);
    // three loose heaps against the far walls
    const heaps = [[-0.28, -0.32], [0.3, -0.05], [-0.22, 0.3]];
    list.forEach((t, i) => {
      const [hx, hz] = heaps[i % heaps.length];
      const x = H.x + hx * H.w + (rnd() - 0.5) * 3.2, z = H.z + hz * H.d + (rnd() - 0.5) * 3.2;
      const y = this._floorY(x, z) + 0.45 + Math.floor(i / heaps.length) % 2 * 0.6;
      w.props.spawn(t, new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 6.28, 0)), { sleep: true });
    });
    // a few loose materials so the hands have something to start with
    for (const t of ['stick', 'stick', 'fabric_scrap', 'plank', 'glass_shard']) {
      const x = H.x + (rnd() - 0.5) * H.w * 0.6, z = H.z + (rnd() - 0.5) * H.d * 0.6;
      w.props.spawn(t, new THREE.Vector3(x, this._floorY(x, z) + 0.2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 6, 0)), { sleep: true });
    }
  }

  // every peer when the arrival car would have opened: nothing to do any more (the clone just wakes up)
  onArrival() {}

  // the wake-up sequence finished on this peer
  onWoke(c) {
    if (c?.short) return;
    profile.unlock('first_day');
    const sv = this.game.survival;
    setTimeout(() => { if (!this.disposed) sv?.say('wake'); }, 400);
    setTimeout(() => { if (!this.disposed) sv?.say('notebook'); }, 5200);
  }

  // ------------------------------------------------------------------ state
  pushState() { if (net.isHost) net.toAll('mstate', this.state); }

  _applyState(s) {
    this.state = s;
    const sh = s.shelter;
    this.camp.built = !!sh;
    if (sh) this.camp.pos.set(sh.x, this._floorY(sh.x, sh.z), sh.z);
    for (const id in s.clones || {}) if (!this._cloneSeen[id] || this._cloneSeen[id].left !== s.clones[id]) this._cloneSeen[id] = { t: this.world.time, left: s.clones[id] };
    for (const id in this._cloneSeen) if (!(id in (s.clones || {}))) delete this._cloneSeen[id];
  }

  serialize() { return this.state; }
  applySync(s) { this._applyState(s); }

  // ------------------------------------------------------------------ deaths: wake up again in your bed
  onPlayerDied(id) {
    if (!net.isHost) return;
    this.pendingClones.set(id, this.world.time + CLONE_DELAY);
    this.state.clones[id] = CLONE_DELAY;
    this.pushState();
  }

  // where a clone wakes up again: beside its bed, else where it first woke up
  _revivePos(id, k) {
    const bed = this.shelter.bedOf(id);
    if (bed) {
      // beside the bed, on whichever side has room (no furniture there, no wall between), getting up away from it
      const q = bed.root.quaternion, side = new THREE.Vector3(1, 0, 0).applyQuaternion(q).setY(0).normalize();
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q).setY(0).normalize();
      const c = bed.root.position.clone();
      const tries = [[side, 0.95], [side.clone().negate(), 0.95], [fwd, 1.3], [fwd.clone().negate(), 1.3], [side, 1.6], [side.clone().negate(), 1.6]];
      for (const [dir, d] of tries) {
        const p = c.clone().addScaledVector(dir, d);
        p.y = this._floorY(p.x, p.z) + 0.05;
        let busy = false;
        this.world.props.query(p, 0.55, (pr) => { if (pr !== bed && !pr.dead && pr.mass > 1.5) busy = true; });
        const wall = this.world.physics.raycast(c.clone().setY(p.y + 0.6), dir, d + 0.4, Q.world);
        if (busy || wall) continue;
        return { pos: p, yaw: Math.atan2(dir.x, dir.z) + Math.PI, bed: 1 };
      }
    }
    const w = this.wakeSpot(k);
    return { pos: w.pos, yaw: w.yaw, bed: 0 };
  }

  _hostClones() {
    let k = 0;
    for (const [id, at] of this.pendingClones) {
      if (this.world.time < at) continue;
      this.pendingClones.delete(id);
      delete this.state.clones[id];
      const r = this.game.roster.get(id);
      if (!r || !r.dead) { this.pushState(); continue; }
      const sp = this._revivePos(id, k++);
      this.game.hostRevive(id, sp.pos, sp.yaw, null, { bed: sp.bed });
      this.pushState();
    }
  }

  // ------------------------------------------------------------------ fx (every peer)
  playFx(m, p) { return super.playFx(m, p); }

  // ------------------------------------------------------------------ frame
  update(dt) {
    this.wakeup.update(dt);
    this.shelter.updateLights(dt);
    this.radio?.update?.(dt);
    this._dayLines();
    if (!net.isHost) return;
    this.shelter.hostUpdate(dt);
    if (this.pendingClones.size) this._hostClones();
  }

  // dusk: the first evening says something; later ones only darken the hum
  _dayLines() {
    const d = this.game.day;
    if (!d?.active) return;
    if (d.dayProgress >= DUSK_FROM && this._dusk !== d.day) {
      this._dusk = d.day;
      if (d.day === 1) this.game.survival?.say('dusk');
    }
  }

  // a new day (every peer, from game.onDayChange)
  onDayChange(day) {
    this.shelter.onDawn(day);
    if (net.isHost) this.game.survival?.hostDawn(day);
  }

  dispose() {
    this.disposed = true;
    this.wakeup.dispose();
    this.shelter.dispose();
    this.radio?.dispose?.();
    net.clientHandlers.delete('mstate');
    this.game.local.survival.needsActive = true;
  }
}

function NOTE_TOTAL(game) { if (game.survival) game.survival.noteTotal = NOTES.length; }

