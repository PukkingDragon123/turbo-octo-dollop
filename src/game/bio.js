// Level 0 biology & mystery systems (owned by the MonsterManager: world.monsters.bio).
//  * STUDY API for the watch SCANNER (economy):
//      world.monsters.creatureAt(ray)   ray: { origin, dir, range = 14 } or a THREE.Ray
//        -> { kind: 'creature'|'fungus', species, name, desc, hostile, tame, studied, id, dist, tamed, hp } | null
//      world.monsters.study(ray, dt)    accumulates study time on what the ray points at; returns the info above
//        plus { progress 0..1, done } and calls game.onStudy?.(species, info) once when a species is first studied.
//      BESTIARY[species] -> { name, kind, hostile, study (seconds), tame, desc }
//  * taming notices (fauna.js bonds a mole / moth to a clone: 'petBond', 'petWarn')
//  * fungal SPORES: sanity loss + coughing on the clones they reach
//  * the camp STOVE: once the team's camp exists (mission.camp), a stove with a pan is placed beside it
//  * scribbled NOTES left by earlier clones ([E] reads them), glowcap pulse, and strange sounds in the dark
import * as THREE from 'three';
import { net } from '../net/net.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { floatText } from '../ui/floattext.js';
import { registerCooking } from './cooking.js';
import { rayCapsules } from './creatures/combat.js';
import { GLOW } from '../entities/models_bio.js';

export const BESTIARY = {
  mole: { name: 'Backrooms Mole', kind: 'creature', hostile: false, study: 3, tame: 'Leave fungus where it can find it. Three meals.', desc: 'A mole that tunnelled into Level 0 and never found the way back. Star-nosed, three-eyed, burrows under the carpet. Edible.' },
  moth: { name: 'Pale Moth', kind: 'creature', hostile: false, study: 3, tame: 'Drop a lit glowstick or flare near it and wait.', desc: 'A cat-sized moth that grazes fungus and circles any light it finds.' },
  dcrawler: { name: 'Damp Crawler', kind: 'creature', hostile: true, study: 5, desc: 'Eight human arms grown around one appetite. Lies still in puddles, skitters, pins its prey. Light in its eyes stalls it.' },
  fungal: { name: 'The Fungal', kind: 'creature', hostile: true, study: 6, desc: 'Black fungus that grew into the shape of a man. Its spores rot the mind. Fire hurts it; flares keep it back.' },
  bacteria: { name: 'The Bacteria', kind: 'creature', hostile: true, study: 8, desc: 'Hunts by sound. Freezes when watched. Fears flares. Almost impossible to kill.' },
  hound: { name: 'Hound', kind: 'creature', hostile: true, study: 4, desc: 'A clone stretched into a dog. Nearly blind, hunts by sound, bolts from light.' },
  smiler: { name: 'Smiler', kind: 'creature', hostile: true, study: 4, desc: 'Exists only in darkness. Do not hold its gaze without a light on it.' },
  partygoer: { name: 'Partygoer', kind: 'creature', hostile: true, study: 4, desc: 'Moves only when unobserved. Steals what you carry.' },
  still: { name: 'Still Life', kind: 'creature', hostile: true, study: 4, desc: 'Sack-doll copies of clones with wrong anatomy. A camera flash freezes them.' },
  fungus_black: { name: 'Black Mold Cap', kind: 'fungus', study: 1.5, desc: 'Glossy black caps from damp walls. Raw: nausea and dread. Fried: edible.' },
  fungus_glow: { name: 'Glowcap', kind: 'fungus', study: 1.5, desc: 'Bioluminescent. Raw, the walls start breathing. Toasted, it calms.' },
  fungus_shelf: { name: 'Carpet Bracket', kind: 'fungus', study: 1.5, desc: 'Bracket fungus feeding on wet carpet underlay. Best seared.' },
  fungus_puff: { name: 'Spore Puffball', kind: 'fungus', study: 1.5, desc: 'Full of spores. Do not squeeze. Roast it.' },
};
const FUNGUS_SPECIES = (t) => (t.startsWith('fungus_') ? t.replace(/_(cooked|burnt)$/, '') : null);

// notes from earlier clones (mystery / hints)
export const NOTES = [
  'Day 3. The hum changes pitch near the wet rooms. Something under the carpet moves AGAINST the hum.',
  'Do not follow the hum. Do not follow the hum. Do not follow',
  'Moles are friendly if you feed them the mushrooms. Mine warns me now. It squeals before they come.',
  'The thing with all the arms lies in puddles and pretends to be laundry. It is not laundry.',
  'Fry everything. The raw caps made me see my supervisor in the ceiling tiles.',
  'Pan on the stove, meat in the pan. FLIP IT or it turns to charcoal. Eat it hot.',
  'Found a cart with two wheels gone. There are wheels in the supply crates. Weld them on, carry more.',
  'If it grabs you, fight. Pull, kick, anything. It lets go if you fight.',
  'Black fungus walks. Lights don\'t scare it. Flares do. Fire does.',
  'R.O.O.M. says the moths are harmless. R.O.O.M. said a lot of things.',
  'I counted the exits twice. The second time there was one more.',
  'The other clone stopped answering on day 4. I found his lamp still lit. No clone.',
  'When it staggers, get on top of it. Pin it. Finish it. Don\'t give it a second chance.',
  'Somebody keeps leaving supply crates out here. Somebody who knew we would come.',
  'My replacement will read this. Hello. Sorry. Keep the stove lit.',
  'The walls are damp because something is breathing behind them.',
];

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3();

class NoteBehaviour {
  constructor(prop) { this.prop = prop; }
  prompt() { return `[${input.keyName('interact')}] Read the scribbled note`; }
  interact() {
    const i = (this.prop.state.n ?? this.prop.id) % NOTES.length;
    floatText.notice(`"${NOTES[i]}"`, { duration: 8, speaker: 'SCRIBBLED NOTE', color: '#f0e6c8' });
    audio.play('paper', { volume: 0.7 });
  }
}

export class Bio {
  constructor(mgr) {
    this.mgr = mgr;
    this.world = mgr.world;
    this.game = mgr.game;
    this.studied = new Set();
    this.cur = null;      // study in progress { key, p }
    this.stoveT = 3;
    this.stoveId = null;
    this.ambT = 25;
    this.sporeMsgT = 0;
    this.warnT = 0;
    registerCooking(this.world);
    this.world.props.registerBehaviour('note_scribble', (p) => new NoteBehaviour(p));
    net.onClient('spores', (d) => this._onSpores(d));
    net.onClient('petBond', (d) => this.game.ui?.toast?.(`The ${d.label.toLowerCase()} trusts you now. It follows you and warns you of danger.`, 'good'));
    net.onClient('petWarn', (d) => {
      if (this.warnT > 0) return;
      this.warnT = 6;
      this.game.ui?.toast?.(`Your ${d.t === 'mole' ? 'mole is squealing' : 'moth is going frantic'}: something is coming (${d.d} m).`, 'warn');
    });
    net.onClient('bioStudied', (d) => this.studied.add(d.sp));
    net.onHost('bioStudied', (d) => net.toAll('bioStudied', d));
  }

  // ---------------------------------------------------------------- study / scanner
  creatureAt(ray) {
    if (!ray) return null;
    const origin = ray.origin, dir = _d.copy(ray.dir || ray.direction).normalize(), range = ray.range ?? 14;
    const mgr = this.mgr;
    let best = null, bt = 1e9;
    const r = rayCapsules(mgr.views.values(), origin, dir, range, 0.2, (v) => (v.dead ? null : { pos: v.pos, r: v.hitR || 0.3, h: v.hitH || 1, lift: v.flyY || 0 }));
    if (r) { best = { v: r.item }; bt = r.t; }
    // fungus props: ray vs bounding sphere
    for (const p of this.world.props.props.values()) {
      const sp = FUNGUS_SPECIES(p.type);
      if (!sp || p.dead) continue;
      _v.subVectors(p.root.position, origin);
      const t = _v.dot(dir);
      if (t < 0 || t > range || t > bt) continue;
      const rr = Math.max(0.12, p.radius);
      if (_v.lengthSq() - t * t > rr * rr) continue;
      best = { p, sp }; bt = t;
    }
    if (!best) return null;
    _w.copy(origin).addScaledVector(dir, Math.max(0, bt - 0.1));
    if (!this.world.physics.lineOfSight(origin, _w)) return null;
    let species, id, kind, extra = {};
    if (best.v) {
      const v = best.v;
      species = v.type === 'still' ? 'still' : v.type;
      id = v.id; kind = 'creature';
      extra = { tamed: !!v.snap?.tm, hp: v.snap?.h ?? 1, state: v.snap?.s, variant: v.variant || null };
    } else { species = best.sp; id = best.p.id; kind = 'fungus'; }
    const B = BESTIARY[species] || { name: species, study: 3, desc: '' };
    return { kind, species, name: B.name, desc: B.desc, hostile: !!B.hostile, tame: B.tame || null, studied: this.studied.has(species), id, dist: +bt.toFixed(2), ...extra };
  }

  study(ray, dt) {
    const t = this.creatureAt(ray);
    if (!t) { this.cur = null; return null; }
    const key = `${t.kind}:${t.id}`;
    if (!this.cur || this.cur.key !== key) this.cur = { key, p: 0 };
    if (t.studied) return { ...t, progress: 1, done: false };
    const dur = BESTIARY[t.species]?.study ?? 3;
    this.cur.p = Math.min(1, this.cur.p + dt / dur);
    if (this.cur.p >= 1) {
      this.studied.add(t.species);
      net.toHost('bioStudied', { sp: t.species });
      audio.play('ui_select', { volume: 0.7 });
      try { this.game.onStudy?.(t.species, t); } catch (e) { console.error('onStudy', e); }
      return { ...t, studied: true, progress: 1, done: true };
    }
    return { ...t, progress: this.cur.p, done: false };
  }

  // ---------------------------------------------------------------- spores
  _onSpores(d) {
    const l = this.game.local;
    if (l.dead) return;
    l.survival.sanity = Math.max(0, l.survival.sanity - d.s);
    if (d.burst) {
      audio.play('cough', { volume: 0.8 });
      l.shake = Math.max(l.shake || 0, 0.3);
      if (this.sporeMsgT <= 0) { this.sporeMsgT = 30; this.game.ui?.toast?.('Spores! Your thoughts go soft. Get away from it.', 'bad'); }
    }
  }

  playFx(m, p) {
    if (m.k !== 'spores' || !p) return;
    const n = m.n ?? 1;
    this.world.fx.dustBurst(p, Math.round(40 * n), [0.07, 0.09, 0.06], 2.4 * n);
    this.world.fx.dustBurst(p, Math.round(10 * n), [0.35, 0.5, 0.4], 1.4 * n);
  }

  // ---------------------------------------------------------------- camp stove (host)
  _hostStove() {
    const camp = this.mgr.camp();
    if (!camp || !this.mgr.level.isChunkLoaded?.(camp.pos.x, camp.pos.z)) return;
    if (this.stoveId != null && this.world.props.get(this.stoveId)) return;
    let found = null;
    this.world.props.query(camp.pos, camp.radius + 8, (p) => { if (p.type === 'camp_stove' && !p.dead) found = p; });
    if (found) { this.stoveId = found.id; return; }
    const yaw = camp.yaw || 0;
    for (let k = 0; k < 12; k++) {
      const a = yaw + 0.9 + k * 0.52, R = 2.4 + (k % 3) * 0.5;
      const x = camp.pos.x + Math.cos(a) * R, z = camp.pos.z + Math.sin(a) * R;
      const y = this.mgr.level.floorY?.(x, z) ?? 0;
      _v.set(x, y + 0.5, z);
      if (!this.world.physics.lineOfSight(_w.set(camp.pos.x, y + 0.5, camp.pos.z), _v)) continue;
      let blocked = false;
      this.world.props.query(_v, 0.9, () => { blocked = true; });
      if (blocked) continue;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.PI / 2);
      const st = this.world.props.spawn('camp_stove', new THREE.Vector3(x, y + 0.2, z), q, { state: { lit: 0 } });
      if (!st) return;
      this.stoveId = st.id;
      // something to practise on
      this.world.props.spawn('canned_food', new THREE.Vector3(x + 0.45, y + 0.15, z + 0.2), new THREE.Quaternion());
      this.world.props.spawn('fungus_shelf', new THREE.Vector3(x - 0.4, y + 0.15, z + 0.25), new THREE.Quaternion());
      net.toAll('hq', { text: 'CAMP: a field stove has been issued. Light it [E], drop raw food in the pan, flip it [E] before it burns. Cooked food heals.', from: 'R.O.O.M.' });
      return;
    }
  }

  // ---------------------------------------------------------------- strange sounds (local)
  _ambient(dt) {
    this.ambT -= dt;
    if (this.ambT > 0) return;
    this.ambT = 22 + Math.random() * 40;
    const l = this.game.local;
    if (l.dead || this.world.type !== 'yellow') return;
    const c = this.mgr.level.cell?.(l.pos.x, l.pos.z);
    if (!c) return;
    const wet = c.wet > 0 || c.zone === 'flooded' || c.zone === 'maintenance';
    const pick = wet ? ['crawler_chitter', 'fungal_groan', 'mole_dig', 'whisper'] : c.zone === 'dark' ? ['fungal_groan', 'whisper', 'crawler_chitter'] : ['mole_dig', 'whisper', 'moth_flutter'];
    const a = Math.random() * Math.PI * 2, d = 8 + Math.random() * 8;
    audio.play(pick[Math.floor(Math.random() * pick.length)], { pos: _v.set(l.pos.x + Math.cos(a) * d, 1 + Math.random(), l.pos.z + Math.sin(a) * d), volume: 0.3 + Math.random() * 0.25 });
  }

  update(dt) {
    this.sporeMsgT -= dt;
    this.warnT -= dt;
    if (GLOW.mat) GLOW.mat.emissiveIntensity = 1.3 + Math.sin(this.world.time * 1.7) * 0.5 + Math.sin(this.world.time * 4.3) * 0.15;
    if (net.isHost && !this.game.isLobby) {
      this.stoveT -= dt;
      if (this.stoveT <= 0) { this.stoveT = 2; this._hostStove(); }
    }
    this._ambient(dt);
  }

  dispose() {
    for (const t of ['spores', 'petBond', 'petWarn', 'bioStudied']) net.clientHandlers.delete(t);
    net.hostHandlers.delete('bioStudied');
  }
}
