// Shelter, sleep, cold and the night (Level 0 survival loop; owned by the mission: mission.shelter).
//  * BEDS: anything you can sleep on (a bedroll you made, a camp cot, an old sleeping bag, a mattress, a couch).
//    [E] lies down in it: it becomes YOUR bed (you wake up there after dying) and, if it is a real bed (bedroll,
//    cot, sleeping bag) and the team has no shelter yet (or its bed is gone), the place it stands becomes the shelter. Sleeping heals and warms you; when everyone alive is asleep at night
//    the night goes by fast (day clock x NIGHT_FF) until the lights come back up.
//  * THE SHELTER is the space around the first bed (SHELTER_R). What stands in it counts (itemdefs `shelter`):
//    a hinged door, fixed barricades, storage, a lit stove, lights, insulation pads, traps. Rated 0..4
//    (game.survival.progress.shelter). Inside it is warmer, and fewer things come for you at night.
//  * DOOR: a plank door attached to the world with the multitool hangs on a hinge (game/tools.js weld): [E] opens
//    or closes it (a soft motor), and you can shove it.
//  * STORAGE CRATE: [E] with something in your hand puts it in; [E] empty-handed takes the top thing out.
//  * STANDING LAMP: [E] switches it; it lights the room (light field) while it is on.
//  * COLD: warmth (survival.warmth) drains, faster at night and later in the week; fires, the stove, a lit torch
//    or lantern, worn padding, the shelter and sleeping put it back (climate()).
//   night: day.dayProgress >= NIGHT_FROM (22:00 on the watch clock)
import * as THREE from 'three';
import { net } from '../net/net.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { profile } from '../core/profile.js';
import { floatText } from '../ui/floattext.js';
import { ITEM, itemDef, itemName } from './itemdefs.js';
import { isLitState } from './itemfx.js';
import { LightField } from '../gfx/bakedlight.js';
import { CELL } from '../world/levels/yellow/layout.js';

export const SHELTER_R = 6.5;
export const NIGHT_FROM = 16 / 24;  // 22:00
export const DUSK_FROM = 15 / 24;   // 21:00
const NIGHT_FF = 10;                // day clock speed while everyone sleeps at night
const STASH_MAX = 6;
const WARM = new THREE.Color(1.0, 0.74, 0.46);
const _v = new THREE.Vector3();

export const isNight = (day) => !!day?.active && day.dayProgress >= NIGHT_FROM;

const BED_TYPES = (def) => !!(def.bed || def.sleep);

export class Shelter {
  constructor(mission) {
    this.m = mission;
    this.world = mission.world;
    this.game = mission.game;
    this.rateT = 1;
    this.lightT = 0;
    this.counts = {};
    this.tier = 0;
    this._forced = new Set();
    this._bind();
  }

  get state() { return this.m.state; }
  get claimed() { return !!this.state.shelter; }
  center(out = new THREE.Vector3()) { const s = this.state.shelter; return s ? out.set(s.x, 0, s.z) : null; }
  inside(pos, margin = 0) { const s = this.state.shelter; return !!s && Math.hypot(pos.x - s.x, pos.z - s.z) < SHELTER_R + margin; }

  _bind() {
    net.onHost('svBed', (d, from) => this._hostBed(d.id, from));
    net.onClient('svWake', () => { const l = this.game.local; if (l.survival.sleeping) { l.wake(); this.game.survival?.say('dawn'); } });
  }

  // ------------------------------------------------------------------ behaviours
  register() {
    const props = this.world.props;
    const self = this;
    for (const [type, def] of Object.entries(ITEM)) {
      if (!BED_TYPES(def)) continue;
      // a searchable bed (an old sleeping bag) is searched first, slept in after
      const inner = props.behaviours.get(type);
      props.registerBehaviour(type, (p, w) => new BedBehaviour(p, self, inner ? inner(p, w) : null));
    }
    props.registerBehaviour('plank_door', (p) => new DoorBehaviour(p, self));
    props.registerBehaviour('stash_crate', (p) => new CrateBehaviour(p, self));
    props.registerBehaviour('camp_lamp', (p) => new LampBehaviour(p, self));
  }

  // host: a clone lay down in a bed -> it is theirs; the first bed claims the shelter
  _hostBed(id, from) {
    const p = this.world.props.get(id);
    if (!p || p.dead) return;
    const st = this.state;
    // a bed belongs to one clone: the previous owner of this bed loses it, the clone's old bed is free again
    for (const k in st.beds) if (st.beds[k] === id && k !== from) delete st.beds[k];
    const old = st.beds[from];
    st.beds[from] = id;
    if (old !== id) {
      const r = this.game.roster.get(from);
      this.world.props.setState(id, { owner: from, ownerName: r?.name || 'Clone' });
      const op = old != null ? this.world.props.get(old) : null;
      if (op && op.state.owner === from) this.world.props.setState(old, { owner: null, ownerName: null });
      net.toPeer(from, 'svLine', { k: 'bed' });
    }
    // a bed made for it (bedroll, cot, sleeping bag) claims the shelter, or moves it once the old one's bed is gone
    const home = st.shelter && this.world.props.get(st.shelter.bed);
    if (itemDef(p.type).bed && (!st.shelter || !home || home.dead)) {
      const q = p.root.position;
      st.shelter = { x: +q.x.toFixed(2), z: +q.z.toFixed(2), bed: id };
      this.m.camp.pos.set(q.x, this.world.level?.floorY?.(q.x, q.z) ?? 0, q.z);
      this.m.camp.built = true;
      this.m.camp.radius = SHELTER_R;
      this.game.survival?.hostShelter(1);
    }
    this.m.pushState();
  }

  // the bed a clone owns (prop) or null
  bedOf(id) {
    const b = this.state.beds?.[id];
    const p = b != null ? this.world.props.get(b) : null;
    return p && !p.dead ? p : null;
  }

  // ------------------------------------------------------------------ host tick
  hostUpdate(dt) {
    this.rateT -= dt;
    if (this.rateT <= 0) { this.rateT = 2; this._rate(); }
    this._nightFF();
  }

  // what the shelter has -> tier
  _rate() {
    const c = this.center(_v);
    if (!c) { this.counts = {}; this.tier = 0; return; }
    const n = { bed: 0, door: 0, barricade: 0, storage: 0, stove: 0, light: 0, trap: 0, insulation: 0, bench: 0 };
    this.world.props.query(c, SHELTER_R, (p) => {
      const d = itemDef(p.type), k = d.shelter || (BED_TYPES(d) ? 'bed' : null);
      if (!k || p.dead) return;
      if (k === 'door' && !(p.state.welded > 0)) return;
      if (k === 'barricade' && !(p.state.welded > 0)) return;
      if (k === 'light' && !lit(p)) return;
      if (k === 'stove' && !p.state.lit) { n.stoveCold = (n.stoveCold || 0) + 1; return; }
      n[k]++;
    });
    this.counts = n;
    let t = n.bed ? 1 : 0;
    if (t >= 1 && (n.light || n.stove)) t = 2;
    if (t >= 2 && (n.door || n.barricade >= 2) && n.storage) t = 3;
    if (t >= 3 && n.stove && n.light && n.insulation && n.trap) t = 4;
    this.tier = t;
    const ins = Math.min(3, n.insulation);
    if (this.state.rating !== t || this.state.ins !== ins) { this.state.rating = t; this.state.ins = ins; this.m.pushState(); }
    this.game.survival?.hostShelter(t);
  }

  // everyone alive asleep at night -> the night goes by fast; dawn wakes everybody
  _nightFF() {
    const g = this.game, day = g.day;
    if (!day.active) return;
    const alive = [...g.roster.values()].filter((r) => !r.dead);
    const asleep = alive.length > 0 && alive.every((r) => (r.id === net.selfId ? g.local.survival.sleeping && !g.local.dead : r.pose?.em === 'sleep'));
    const ff = asleep && isNight(day) ? NIGHT_FF : 1;
    if (day.speed !== ff) { day.speed = ff; day.syncT = 0; }
  }

  // every peer at a day change: the night is over
  onDawn(d) {
    const g = this.game;
    if (g.day.speed !== 1) g.day.speed = 1;
    if (net.isHost && d > 1) net.toAll('svWake', {});
  }

  // ------------------------------------------------------------------ cold
  // per second: { gain, loss } of warmth for the local clone
  climate(l) {
    const g = this.game, day = g.day, s = l.survival;
    const night = isNight(day);
    let loss = night ? 0.3 : 0.07;
    loss *= day.day <= 1 ? 0.55 : 1 + (day.instability?.() || 0) * 0.6;
    // what the clone wears
    let wear = 0;
    for (const k in l.gear || {}) wear += itemDef(l.gear[k]).wear?.warm || 0;
    loss *= 1 - Math.min(0.6, wear);
    let gain = 0;
    const inside = this.inside(l.pos);
    if (inside) { loss *= Math.max(0.15, 0.5 - 0.1 * (this.state.ins || 0)); gain += 0.12; }
    if (s.sleeping) { loss *= 0.4; gain += 0.25 + (l.sleepBed || 0) * 0.15; }
    // fires and lamps nearby, a lit torch / lantern in the hand
    const p = l.pos;
    this.world.props.query(p, 4, (pr) => {
      const L = itemDef(pr.type).light;
      if (!L?.warm || !lit(pr)) return;
      const d = pr.root.position.distanceTo(p);
      gain += L.warm * Math.max(0, 1 - d / 4);
    });
    for (const it of l.inv.slots.slice(0, 5)) if (it && itemDef(it.type).light?.warm && litItem(it)) gain += itemDef(it.type).light.warm * 0.8;
    if (l.flareNear) gain += 0.3;
    return { gain, loss, night, inside };
  }

  // ------------------------------------------------------------------ lights (every peer)
  // lit standing lamps / lanterns light the room they stand in (light field cell override)
  updateLights(dt) {
    this.lightT -= dt;
    if (this.lightT > 0) return;
    this.lightT = 0.6;
    const want = new Set();
    for (const p of this.world.props.props.values()) {
      if ((p.type !== 'camp_lamp' && p.type !== 'lantern') || !lit(p)) continue;
      const i = Math.floor(p.root.position.x / CELL), j = Math.floor(p.root.position.z / CELL);
      want.add(`${i},${j}`);
    }
    for (const k of want) if (!this._forced.has(k)) { const [i, j] = k.split(',').map(Number); this._force(i, j, true); }
    for (const k of this._forced) if (!want.has(k)) { const [i, j] = k.split(',').map(Number); this._force(i, j, false); }
    this._forced = want;
  }

  _force(i, j, on) {
    const f = this.world.field;
    const l = f?.get(LightField.texel(i, j));
    if (!l || l.ci !== i || l.cj !== j) return;
    if (on) {
      if (!l._svSaved) l._svSaved = { mode: l.mode, override: l.override || null, base: l.base, forced: !!l.forced };
      l.forced = true; l.mode = 'on'; l.override = WARM.clone(); l.base = Math.max(l.base || 1, 1.2);
    } else if (l._svSaved) {
      Object.assign(l, l._svSaved);
      l._svSaved = null;
    }
    l._force = true;
    f.dirty = true;
  }

  dispose() {
    for (const k of this._forced) { const [i, j] = k.split(',').map(Number); this._force(i, j, false); }
    net.hostHandlers.delete('svBed');
    net.clientHandlers.delete('svWake');
  }
}

// is this prop's light / fire burning
export function lit(p) {
  const d = itemDef(p.type);
  if (p.type === 'camp_stove') return !!p.state.lit;
  if (p.type === 'camp_lamp') return p.state.lit !== 0;
  if (d.light) return isLitState(p.type, p.state);
  return false;
}
function litItem(it) { return isLitState(it.type, it.state); }

// ---------------------------------------------------------------------------------------------- beds
class BedBehaviour {
  constructor(prop, shelter, inner) { this.prop = prop; this.sh = shelter; this.inner = inner; this.spec = inner?.spec; }
  prompt(pl) {
    if (this.inner && this.prop.state.looted === undefined) return this.inner.prompt(pl);
    if (pl.survival.sleeping) return null;
    const own = this.prop.state.owner, me = net.selfId;
    const k = `[${input.keyName('interact')}]`;
    if (own === me) return `${itemName(this.prop.type)} · ${k} Sleep`;
    if (own) return `${this.prop.state.ownerName || 'Someone'}'s bed · ${k} Sleep here (make it yours)`;
    return `${itemName(this.prop.type)} · ${k} Sleep here (your bed)`;
  }
  interact(pl) {
    if (this.inner && this.prop.state.looted === undefined) { this.inner.interact(pl); return; }
    const l = pl || this.sh.game.local;
    net.toHost('svBed', { id: this.prop.id });
    l.sleepIn?.(this.prop);
    if (this.prop.state.maker === net.selfId) profile.unlock('sleepy');
  }
  hostAction(a, d, from) { this.inner?.hostAction?.(a, d, from); }
  update(dt) { this.inner?.update?.(dt); }
  onState(s) { this.inner?.onState?.(s); }
}

// ---------------------------------------------------------------------------------------------- door
class DoorBehaviour {
  constructor(prop, shelter) { this.prop = prop; this.sh = shelter; this.swingT = 0; }
  prompt() {
    const k = `[${input.keyName('interact')}]`;
    if (!(this.prop.state.welded > 0)) return `Plank Door · stand it in a doorway, attach it with the multitool [${input.keyName('tool')}]`;
    return `Plank Door · ${k} ${this.prop.state.open ? 'Close' : 'Open'}`;
  }
  interact() {
    if (!(this.prop.state.welded > 0)) { floatText.notice('It needs hanging first: hold it in the doorway and attach it with the multitool.', { duration: 2.8 }); return; }
    net.toHost('act', { k: 'p', id: this.prop.id, a: 'swing' });
  }
  hostAction(a) {
    if (a !== 'swing') return;
    const p = this.prop, w = this.sh.world;
    const open = p.state.open ? 0 : 1;
    w.props.setState(p.id, { open });
    this.swingT = 2.5; // host: drive it on its hinge for a moment (then it is free to be shoved)
    p.body?.wakeUp();
    w.fxAll({ k: 'snd', n: open ? 'door_creak' : 'thunk', p: p.root.position.toArray(), v: 0.8 });
    w.noise.emit(p.root.position, 5, 'door');
  }
  // host: swing toward open (1.5 rad) / closed (0) about the hinge (the joint keeps it on the hinge)
  update(dt) {
    const p = this.prop;
    if (!net.isHost || this.swingT <= 0 || !p.hinge || !p.body || !p.hingeQ0) return;
    this.swingT -= dt;
    const r = p.body.rotation();
    _q2.set(r.x, r.y, r.z, r.w);
    _q3.copy(p.hingeQ0).invert().multiply(_q2);
    const ang = 2 * Math.atan2(_q3.y, _q3.w);
    const err = (p.state.open ? 1.5 : 0) - ang;
    const w = Math.max(-2.6, Math.min(2.6, err * 5));
    p.body.setAngvel({ x: 0, y: Math.abs(err) < 0.02 ? 0 : w, z: 0 }, true);
  }
  onState() {}
}
const _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();

// ---------------------------------------------------------------------------------------------- storage crate
class CrateBehaviour {
  constructor(prop, shelter) { this.prop = prop; this.sh = shelter; this.open = 0; this.openT = 0; }
  get items() { return this.prop.state.items || []; }
  prompt(pl) {
    const k = `[${input.keyName('interact')}]`, n = this.items.length;
    const cur = pl.hands?.rightItem?.() || pl.hands?.leftItem?.();
    if (cur && n < STASH_MAX) return `Storage Crate (${n}/${STASH_MAX}) · ${k} Put the ${itemName(cur.type).toLowerCase()} in`;
    if (n) return `Storage Crate (${n}/${STASH_MAX}) · ${k} Take out the ${itemName(this.items[n - 1].type).toLowerCase()}`;
    return `Storage Crate · empty${cur ? ' · full' : ''}`;
  }
  interact(pl) {
    const l = pl || this.sh.game.local;
    const H = l.hands, inv = l.inv;
    const slot = H.layout.right >= 0 ? H.layout.right : H.layout.left;
    const cur = slot >= 0 ? inv.slots[slot] : null;
    if (cur && this.items.length < STASH_MAX) {
      inv.remove(slot);
      l.arms?.gesture?.('drop', slot === H.layout.left ? 'L' : 'R');
      net.toHost('act', { k: 'p', id: this.prop.id, a: 'put', d: { type: cur.type, state: cur.state } });
      return;
    }
    if (this.items.length) net.toHost('act', { k: 'p', id: this.prop.id, a: 'take' });
  }
  hostAction(a, d, from) {
    const p = this.prop, w = this.sh.world;
    const items = [...this.items];
    if (a === 'put' && d?.type) {
      if (items.length >= STASH_MAX) {
        // no room: it lands on the lid
        w.props.spawn(d.type, p.root.position.clone().add(_v.set(0, 0.5, 0)), new THREE.Quaternion(), { state: d.state || {} });
        return;
      }
      items.push({ type: d.type, state: d.state || {} });
      w.props.setState(p.id, { items, t: Date.now() });
      w.fxAll({ k: 'snd', n: 'locker_close', p: p.root.position.toArray(), v: 0.6, pi: 1.3 });
      if (items.length >= STASH_MAX) { if (from === net.selfId) profile.unlock('collector'); else net.toPeer(from, 'ach', 'collector'); }
    } else if (a === 'take' && items.length) {
      const it = items.pop();
      w.props.setState(p.id, { items, t: Date.now() });
      if (from === net.selfId) this.sh.game.local.receiveItem(it);
      else net.toPeer(from, 'gotItem', it);
      w.fxAll({ k: 'snd', n: 'locker_open', p: p.root.position.toArray(), v: 0.6, pi: 1.3 });
    }
  }
  onState(s) { if (s.t) this.openT = 1.2; }
  update(dt) {
    this.openT = Math.max(0, this.openT - dt);
    this.open += ((this.openT > 0 ? 1 : 0) - this.open) * Math.min(1, dt * 8);
    this.prop.model.object.userData.setOpen?.(this.open);
  }
}

// ---------------------------------------------------------------------------------------------- standing lamp
class LampBehaviour {
  constructor(prop, shelter) { this.prop = prop; this.sh = shelter; prop.model.object.userData.setLit?.(prop.state.lit !== 0); }
  prompt() { return `Standing Lamp · [${input.keyName('interact')}] Switch ${this.prop.state.lit !== 0 ? 'off' : 'on'}`; }
  interact() { net.toHost('act', { k: 'p', id: this.prop.id, a: 'switch' }); }
  hostAction(a) {
    if (a !== 'switch') return;
    const on = this.prop.state.lit !== 0 ? 0 : 1;
    this.sh.world.props.setState(this.prop.id, { lit: on });
    this.sh.world.fxAll({ k: 'snd', n: 'toggle_clack', p: this.prop.root.position.toArray(), v: 0.8 });
  }
  onState(s) { if (s.lit !== undefined) this.prop.model.object.userData.setLit?.(s.lit !== 0); }
  update() {}
}
