// Creature combat: health, hit reactions, death / gore, grabs with a BREAK FREE QTE, pin-down finishers.
//
// Host-authoritative. Players (or anything else) hit creatures through
//   world.monsters.applyHit({ origin, dir, range = 2, damage = 10, from = selfId, kind = 'blunt', radius = 0.3, heavy, power })
//     -> { hit: true, agent, killed, point } when a creature was hit, null on a miss
//   kind: 'blunt' | 'slash' | 'stab' | 'fire' | 'shot' (fire burns fungal things and the Bacteria x2.2)
//   On a client the ray is tested against the local views for an instant answer ({hit, agent: view, killed: false})
//   and forwarded to the host, which applies the real damage.
// Every agent has maxHp / armor (damage multiplier) / poise (damage that staggers it). A hit flinches it (label
// 'hurt'), knocks it back and sprays blood / ichor; spending its poise STAGGERS it (label 'stagger', AI suspended,
// takes x1.5 damage) and offers the closest clone a finisher QTE (game.qte kind 'sequence') for a brutal kill.
// Heavy hits hit-stop and shake the attacker's camera (juice). Deaths topple the body on every peer and burst
// into gore chunks; edible creatures leave meat (DROPS).
// Hostiles that GRAB a clone start a 'mash' QTE on the victim's client (game.qte.start); a win throws the
// creature off staggered, a fail (or no QTE system) lands the full hit. A teammate hitting the grabber frees you.
import * as THREE from 'three';
import { net } from '../../net/net.js';
import { audio } from '../../audio/audio.js';
import { juice } from '../../gfx/juice.js';

// type (or Still Life variant) -> [maxHp, armor, poise]
export const COMBAT = {
  bacteria: [320, 0.55, 75], hound: [70, 1, 26], smiler: [40, 1, 16], partygoer: [55, 1, 22],
  watcher: [60, 1, 24], twin: [45, 1, 18], crawler: [35, 1, 14], mass: [130, 0.8, 42], tall: [80, 1, 30],
  mole: [24, 1, 9], dcrawler: [95, 0.9, 30], fungal: [190, 0.75, 55], moth: [12, 1, 5],
};
// stagger seconds
const STAGGER = { bacteria: 1.5, mass: 2.2, fungal: 2.4, dcrawler: 2.2, mole: 2.6, moth: 2.4 };
// blood / ichor (linear rgb) and gore chunk colours
const ICHOR = {
  bacteria: [0.015, 0.02, 0.015], fungal: [0.03, 0.035, 0.015], smiler: [0.03, 0.03, 0.03], still: [0.42, 0.06, 0.04],
  hound: [0.42, 0.02, 0.02], partygoer: [0.42, 0.02, 0.02], mole: [0.45, 0.02, 0.02], dcrawler: [0.5, 0.44, 0.08], moth: [0.8, 0.76, 0.6],
};
const CHUNKS = {
  bacteria: [0x070a07, 0x101510], fungal: [0x111309, 0x2a2a18], smiler: [0x101010, 0xe8e0c8], still: [0xc8a878, 0x7a1810],
  hound: [0x6a1410, 0xc8a878], partygoer: [0x7a1810, 0xd8c8b0], mole: [0x5a2420, 0x3a3029], dcrawler: [0x8a8a68, 0x7a1a10], moth: [0xd8ccb0, 0x8a7a60],
};
const POOL = { bacteria: 0x040604, fungal: 0x0c0e06, smiler: 0x0a0a0a, dcrawler: 0x6a6018, moth: 0x9a9070 };
// edible / useful remains (host spawns props): [type, min, max]
export const DROPS = { mole: [['mole_meat', 1, 2]], dcrawler: [['crawler_meat', 1, 2]], fungal: [['fungus_black', 2, 3]], moth: [['fungus_glow', 0, 1]] };
const FIN_TITLE = { mole: 'PIN IT DOWN', moth: 'PIN IT DOWN', dcrawler: 'PIN IT DOWN', bacteria: 'FINISH IT', fungal: 'TEAR IT APART' };
const HURT_SND = { bacteria: 'bacteria_growl', hound: 'hound_yelp', smiler: 'smiler_hiss', partygoer: 'party_giggle', mole: 'mole_squeak', dcrawler: 'crawler_screech', fungal: 'fungal_groan', moth: 'moth_flutter' };
export const HOSTILE = new Set(['bacteria', 'hound', 'smiler', 'partygoer', 'still', 'dcrawler', 'fungal']);

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _p = new THREE.Vector3(), _v = new THREE.Vector3();

export function combatKey(type, variant) { return type === 'still' ? variant || 'watcher' : type; }
export function initCombat(a) {
  const [hp, armor, poise] = COMBAT[combatKey(a.type, a.variant)] || [40, 1, 20];
  a.maxHp = a.hp = hp; a.armor = armor; a.maxPoise = a.poise = poise;
}

// closest approach of segment P(s) = p + s*u (s in 0..1) to segment Q(t) = q + t*v; returns [dist^2, s]
function segSeg(p, u, q, v) {
  const r = _e.subVectors(p, q);
  const a = u.dot(u), e = v.dot(v), f = v.dot(r);
  let s, t;
  if (a < 1e-9 && e < 1e-9) return [r.lengthSq(), 0];
  if (a < 1e-9) { s = 0; t = THREE.MathUtils.clamp(f / e, 0, 1); } else {
    const c = u.dot(r);
    if (e < 1e-9) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); } else {
      const b = u.dot(v), den = a * e - b * b;
      s = den > 1e-9 ? THREE.MathUtils.clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
    }
  }
  _c.copy(p).addScaledVector(u, s);
  _d.copy(q).addScaledVector(v, t);
  return [_c.distanceToSquared(_d), s];
}

// ray (origin, unit dir, range, sweep radius) against a list of capsules {pos, r, h (height), lift}
export function rayCapsules(list, origin, dir, range, sweep, get) {
  let best = null, bt = 1e9;
  _a.copy(dir).multiplyScalar(range);
  for (const it of list) {
    const c = get(it);
    if (!c) continue;
    _b.set(c.pos.x, c.pos.y + c.lift + c.r, c.pos.z);
    _p.set(0, Math.max(0.01, c.h - c.r * 2), 0);
    const [d2, s] = segSeg(origin, _a, _b, _p);
    const R = c.r + sweep;
    if (d2 > R * R) continue;
    const t = s * range;
    if (t < bt) { bt = t; best = it; }
  }
  return best ? { item: best, t: bt } : null;
}

// coloured spray (FX alpha particles) along dir
function spray(fx, pos, dir, n, col, speed = 2.2) {
  const sys = fx.alpha;
  for (let i = 0; i < n; i++) {
    _v.set(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).multiplyScalar(1.6);
    if (dir) _v.addScaledVector(dir, speed * (0.4 + Math.random()));
    const s = 0.03 + Math.random() * 0.04;
    sys.add(pos, _v, 0.5 + Math.random() * 0.6, s, s * 0.6, col[0], col[1], col[2], 0.92, 9.8, 0.25, 0.01, 0);
  }
}

export class Combat {
  constructor(mgr) {
    this.mgr = mgr;
    this.world = mgr.world;
    this.game = mgr.game;
    this.grabbed = new Map(); // host: player id -> agent id holding them
    this.localGrab = null;    // victim client: { mon, t }
    this.pools = [];
    this._poolGeo = new THREE.CircleGeometry(1, 14);
    this._poolMats = new Map();
    net.onHost('mhitReq', (d, from) => this.applyHit({ origin: _p.fromArray(d.o).clone(), dir: new THREE.Vector3().fromArray(d.d), range: d.r, damage: d.dmg, kind: d.k, radius: d.rad, heavy: !!d.hv, from }));
    net.onHost('mgrabEnd', (d, from) => this._hostGrabEnd(d, from));
    net.onHost('mfinish', (d, from) => this._hostFinish(d, from));
    net.onClient('mfx', (d) => this._fx(d));
    net.onClient('mdie', (d) => this._onDie(d));
    net.onClient('mgrab', (d) => this._onGrab(d));
    net.onClient('mgrabFree', (d) => this._onGrabFree(d));
    net.onClient('mfin', (d) => this._onFin(d));
  }

  // ------------------------------------------------------------------ hits
  applyHit(o = {}) {
    const origin = o.origin, dir = _v.copy(o.dir || new THREE.Vector3(0, 0, -1)).normalize().clone();
    const range = o.range ?? 2, sweep = o.radius ?? 0.3, dmg = o.damage ?? 10;
    const heavy = !!o.heavy || (o.power ?? 0) > 0.8;
    if (!origin) return null;
    const from = o.from ?? net.selfId;
    const mgr = this.mgr;
    // rats and roaches (per client) die to any blow that reaches them first
    const critter = () => {
      const c = mgr.level.critters?.hit?.(origin, dir, range, Math.min(0.3, sweep));
      return c ? { hit: true, agent: null, critter: c.critter, killed: true, point: c.point } : null;
    };
    if (!net.isHost) {
      const r = rayCapsules(mgr.views.values(), origin, dir, range, sweep, (v) => (v.dead ? null : { pos: v.pos, r: v.hitR, h: v.hitH, lift: v.flyY || 0 }));
      if (!r) return critter();
      const point = origin.clone().addScaledVector(dir, r.t);
      if (!this.world.physics.lineOfSight(origin, point)) return null;
      net.toHost('mhitReq', { o: origin.toArray(), d: dir.toArray(), r: range, dmg, k: o.kind || 'blunt', rad: sweep, hv: heavy ? 1 : 0 });
      return { hit: true, agent: r.item, killed: false, point };
    }
    const r = rayCapsules(mgr.agents.values(), origin, dir, range, sweep, (a) => (a.dead || a.burrowed ? null : { pos: a.pos, r: a.radius, h: a.halfH * 2 + a.radius * 2, lift: a.flyY || 0 }));
    if (!r) return o.from === net.selfId ? critter() : null;
    const point = origin.clone().addScaledVector(dir, Math.max(0, r.t - 0.05));
    if (!this.world.physics.lineOfSight(origin, point)) return null;
    const killed = this.damage(r.item, dmg, dir, { from, kind: o.kind || 'blunt', point, heavy });
    return { hit: true, agent: r.item, killed, point };
  }

  // host: apply damage to an agent; returns true if it died
  damage(a, dmg, dir, o = {}) {
    if (!a || a.dead || !net.isHost) return false;
    const mgr = this.mgr;
    let mul = a.armor ?? 1;
    if (o.kind === 'fire' && (a.type === 'fungal' || a.type === 'bacteria' || a.type === 'moth')) mul *= 2.2;
    if (a.staggerT > 0) mul *= 1.5;
    const d = dmg * mul;
    a.hp -= d;
    a.hurtT = 0.3;
    a.lastHitBy = o.from ?? null;
    const flat = _a.set(dir.x, 0, dir.z);
    if (flat.lengthSq() < 1e-6) flat.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    flat.normalize();
    const kb = Math.min(6, 1.4 + d * 0.12) * (a.type === 'bacteria' || a.type === 'fungal' ? 0.35 : 1);
    a.vel.addScaledVector(flat, kb);
    const heavy = !!o.heavy || d >= 22;
    const point = o.point || _b.copy(a.pos).setY(a.pos.y + (a.flyY || 0) + a.halfH + a.radius);
    this.world.noise.emit(point, 10 + d * 0.3, 'hit');
    // a teammate hitting the thing that holds you breaks its grip
    if (a.grab && o.from !== a.grab.pid) this.releaseGrab(a, true, true);
    if (a.hp <= 0) {
      this.kill(a, flat, { gore: heavy || d > a.maxHp * 0.5 ? 2 : 1, by: o.from, point });
      return true;
    }
    net.toAll('mfx', { k: 'hit', id: a.id, t: a.type, p: point.toArray().map((x) => +x.toFixed(2)), d: [+flat.x.toFixed(2), +flat.z.toFixed(2)], i: +Math.min(1, d / 30).toFixed(2), by: o.from, hv: heavy ? 1 : 0 });
    a.poise -= d;
    if (a.poise <= 0 && a.staggerT <= 0) this.stagger(a, STAGGER[a.type] ?? 1.8);
    if (a.onHurt) a.onHurt(flat, d, o.from);
    else if (HURT_SND[a.type]) mgr.sound(HURT_SND[a.type], a.pos, 0.9);
    else mgr.sound('stilllife_scream', a.pos, 0.8);
    return false;
  }

  stagger(a, sec) {
    a.staggerT = Math.max(a.staggerT, sec);
    a.poise = a.maxPoise;
    a.finOffered = false;
    if (a.grab) this.releaseGrab(a, true, false);
    if (a.raid) a.endRaid?.();
    this.mgr.sound(HURT_SND[a.type] || 'stilllife_scream', a.pos, 1);
    net.toAll('mfx', { k: 'stagger', id: a.id });
  }

  kill(a, dir, o = {}) {
    if (a.dead) return;
    const mgr = this.mgr;
    a.dead = true;
    if (a.grab) this.releaseGrab(a, true, false);
    if (a.raid) mgr.raidEnded();
    const seed = (Math.random() * 1e6) | 0;
    net.toAll('mdie', { id: a.id, t: a.type, v: a.variant || null, p: a.pos.toArray().map((x) => +x.toFixed(2)), y: +a.yaw.toFixed(2), fy: a.flyY || 0, d: [+dir.x.toFixed(2), +dir.z.toFixed(2)], g: o.gore || 1, by: o.by ?? null, s: seed });
    // remains
    const drops = DROPS[a.type];
    if (drops) {
      for (const [type, lo, hi] of drops) {
        const n = lo + Math.floor(Math.random() * (hi - lo + 1));
        for (let k = 0; k < n; k++) {
          const p = a.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.25 + k * 0.1, (Math.random() - 0.5) * 0.4));
          this.world.props.spawn(type, p, new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 6, 0)), { vel: new THREE.Vector3(dir.x * 1.2 + (Math.random() - 0.5), 1.5, dir.z * 1.2 + (Math.random() - 0.5)) });
        }
      }
    }
    if (a.type === 'bacteria' || a.type === 'fungal') mgr.dropResidue(a.pos);
    else if (a.type === 'still' || a.type === 'hound' || a.type === 'partygoer') mgr.dropResidue(a.pos, 'still_life_tissue');
    this.world.noise.emit(a.pos, 18, 'kill');
    a.onDeath?.();
    a.dispose();
    mgr.agents.delete(a.id);
    this.game.onCreatureKilled?.(a.type, o.by);
  }

  // legacy hit (tools.js melee swing)
  legacyHit(id, dir, from) {
    const a = this.mgr.agents.get(id);
    if (a) this.damage(a, 18, dir, { from, kind: 'blunt' });
  }

  // ------------------------------------------------------------------ grabs
  // host: creature `a` seizes player record `pl`. o: { dmg, kind, cause, title, dur, san, chip, snd }
  tryGrab(a, pl, o = {}) {
    if (!pl || pl.dead || pl.safe || a.grab || a.dead) return false;
    if (this.grabbed.has(pl.id)) return false;
    const dur = o.dur ?? 2.6;
    a.grab = { pid: pl.id, t: 0, dur, o, tick: 0.6 };
    this.grabbed.set(pl.id, a.id);
    net.toPeer(pl.id, 'mgrab', { mon: a.id, t: a.type, title: o.title || 'BREAK FREE', dur, p: a.pos.toArray() });
    this.mgr.sound(o.snd || HURT_SND[a.type] || 'bacteria_attack', a.pos, 1);
    return true;
  }

  // host, per frame for an agent that holds someone (instead of its AI)
  grabUpdate(a, dt) {
    const g = a.grab;
    g.t += dt;
    const pl = this.mgr.alivePlayers().find((p) => p.id === g.pid);
    if (!pl || pl.safe) { this.releaseGrab(a, false, false); return; }
    a.faceToward(pl.pos, dt, 12);
    a.lookAt(pl.pos, pl.pos.y + 1.1);
    // keep pressed against the victim
    _a.set(pl.pos.x - a.pos.x, 0, pl.pos.z - a.pos.z);
    const d = _a.length();
    if (d > 0.9) a.vel.addScaledVector(_a.normalize(), Math.min(4, (d - 0.9) * 6) * dt * 8);
    a.vel.multiplyScalar(0.6);
    a.attackT = 0.45 + Math.sin(g.t * 9) * 0.12;
    a.integrate(dt);
    g.tick -= dt;
    if (g.tick <= 0) {
      g.tick = 0.8;
      this.mgr.damagePlayer(pl, g.o.chip ?? 2.5, g.o.kind || 'bite', a.pos, g.o.cause || 'something', { noKnock: true });
    }
    if (g.t > g.dur + 2.5) this.resolveGrab(a, false); // the victim's client never answered
  }

  _hostGrabEnd(d, from) {
    const a = this.mgr.agents.get(d.mon);
    if (!a || !a.grab || a.grab.pid !== from) return;
    this.resolveGrab(a, !!d.win);
  }

  resolveGrab(a, win) {
    const g = a.grab;
    if (!g) return;
    const pl = this.mgr.alivePlayers().find((p) => p.id === g.pid);
    this.grabbed.delete(g.pid);
    a.grab = null;
    if (win) {
      if (pl) { _a.set(a.pos.x - pl.pos.x, 0, a.pos.z - pl.pos.z).normalize(); a.vel.addScaledVector(_a, 5); }
      this.stagger(a, 1.7);
      a.cooldown = Math.max(a.cooldown || 0, 3);
    } else {
      if (pl) this.mgr.damagePlayer(pl, g.o.dmg ?? 30, g.o.kind || 'slash', a.pos, g.o.cause || 'something', { heavy: true, sanity: g.o.san || 0 });
      a.cooldown = Math.max(a.cooldown || 0, 2.5);
      a.onGrabDone?.(false);
    }
  }

  // drop whoever it holds (stagger, death, a teammate's hit); notify: tell the victim's client to stop its QTE
  releaseGrab(a, notify, freedByTeammate) {
    const g = a.grab;
    if (!g) return;
    this.grabbed.delete(g.pid);
    a.grab = null;
    if (notify) net.toPeer(g.pid, 'mgrabFree', { mon: a.id, tm: freedByTeammate ? 1 : 0 });
  }

  // victim client
  _onGrab(d) {
    const l = this.game.local;
    if (l.dead) return;
    this.localGrab = { mon: d.mon, t: 0, p: new THREE.Vector3().fromArray(d.p) };
    juice.shake(0.55);
    juice.punch(0.06);
    audio.play('hurt', { volume: 0.8 });
    const end = (win) => {
      if (!this.localGrab || this.localGrab.mon !== d.mon) return;
      this.localGrab = null;
      if (win) { juice.shake(0.3); audio.play('impact_flesh', { volume: 0.9, intensity: 1 }); }
      net.toHost('mgrabEnd', { mon: d.mon, win: win ? 1 : 0 });
    };
    const qte = this.game.qte;
    if (qte?.start && !qte.active) {
      try { this._qte = qte.start({ kind: 'mash', title: d.title || 'BREAK FREE', duration: d.dur, onWin: () => end(true), onFail: () => end(false) }); } catch (e) { console.warn('qte', e); end(false); }
    } else end(false); // no QTE system: the old straight hit
  }

  _onGrabFree(d) {
    if (!this.localGrab || this.localGrab.mon !== d.mon) return;
    this.localGrab = null;
    try { this._qte?.cancel?.(); } catch (e) { /* none */ }
    this._qte = null;
    if (d.tm) this.game.ui?.toast?.('Your teammate tore it off you!', 'good');
  }

  // ------------------------------------------------------------------ finishers
  // host, per frame while staggered: offer the closest clone a pin-down finisher (once per stagger)
  staggerTick(a, dt) {
    if (a.finOffer) {
      a.finOffer.t += dt;
      a.staggerT = Math.max(a.staggerT, 0.2); // stays down while the finisher plays out
      if (a.finOffer.t > 5) { a.finOffer = null; a.staggerT = 0.01; }
      return;
    }
    if (a.finOffered) return;
    if (a.type === 'smiler' || (a.type === 'bacteria' && a.hp > a.maxHp * 0.35)) return;
    let best = null, bd = 2.6;
    for (const p of this.mgr.alivePlayers()) {
      if (this.grabbed.has(p.id)) continue;
      const d = Math.hypot(p.pos.x - a.pos.x, p.pos.z - a.pos.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) return;
    a.finOffered = true;
    a.finOffer = { pid: best.id, t: 0 };
    net.toPeer(best.id, 'mfin', { mon: a.id, t: a.type, title: FIN_TITLE[a.type] || 'PIN IT DOWN' });
  }

  _onFin(d) {
    const qte = this.game.qte;
    if (!qte?.start || qte.active || this.game.local.dead) { net.toHost('mfinish', { mon: d.mon, win: 0 }); return; }
    let done = false;
    const end = (win) => { if (done) return; done = true; net.toHost('mfinish', { mon: d.mon, win: win ? 1 : 0 }); };
    try { qte.start({ kind: 'sequence', title: d.title || 'PIN IT DOWN', duration: 2.6, keys: 4, finisher: true, onWin: () => end(true), onFail: () => end(false) }); } catch (e) { end(false); }
  }

  _hostFinish(d, from) {
    const a = this.mgr.agents.get(d.mon);
    if (!a || a.dead || a.finOffer?.pid !== from) return;
    a.finOffer = null;
    if (d.win) {
      const pl = this.mgr.alivePlayers().find((p) => p.id === from);
      const dir = pl ? _a.set(a.pos.x - pl.pos.x, 0, a.pos.z - pl.pos.z).normalize().clone() : new THREE.Vector3(1, 0, 0);
      this.kill(a, dir, { gore: 2, by: from, finisher: true });
    } else {
      // it squirms free and goes for whoever failed
      a.staggerT = 0.01;
      a.cooldown = 0;
      this.mgr.sound(HURT_SND[a.type] || 'stilllife_scream', a.pos, 1);
    }
  }

  // ------------------------------------------------------------------ host per-frame (called before AI)
  // returns true if the agent's own AI must be skipped this frame
  preUpdate(a, dt) {
    a.hurtT = Math.max(0, a.hurtT - dt);
    if (a.grab) { this.grabUpdate(a, dt); return true; }
    if (a.staggerT > 0) { this.staggerTick(a, dt); a.staggerUpdate(dt); return true; }
    return false;
  }

  // ------------------------------------------------------------------ client fx
  _fx(d) {
    const fx = this.world.fx;
    const v = this.mgr.views.get(d.id);
    if (d.k === 'hit') {
      const p = _p.fromArray(d.p);
      const dir = _a.set(d.d[0], 0.25, d.d[1]);
      const col = ICHOR[d.t] || ICHOR.still;
      spray(fx, p, dir, 8 + Math.round(d.i * 14), col);
      if (d.i > 0.5) fx.chunks(p, 2 + Math.round(d.i * 3), (CHUNKS[d.t] || CHUNKS.still)[0], 0.035, 2.2, this.world.level?.floorY?.(p.x, p.z) ?? 0, 6);
      audio.play('flesh_hit', { pos: p, volume: 0.6 + d.i * 0.5, intensity: d.i });
      if (d.i > 0.35) this.addPool(_b.set(p.x + d.d[0] * 0.3, 0, p.z + d.d[1] * 0.3), 0.12 + d.i * 0.2, d.t);
      v?.kick(d.d, d.i);
      if (d.by === net.selfId) {
        if (d.hv) { juice.hitstop(75); juice.shake(0.28); juice.punch(0.03); } else juice.shake(0.08);
      }
    } else if (d.k === 'stagger') v?.kick(null, 0.8);
  }

  _onDie(d) {
    const mgr = this.mgr;
    let v = mgr.views.get(d.id);
    if (v) mgr.views.delete(d.id);
    else v = mgr.makeView({ id: d.id, t: d.t, v: d.v, p: d.p, y: d.y, s: 'dead', a: 0, i: 0, fy: d.fy });
    if (!v) return;
    v.die(d);
    mgr.corpses.push(v);
    while (mgr.corpses.length > 10) mgr.corpses.shift().dispose();
    const fx = this.world.fx;
    const p = _p.fromArray(d.p);
    p.y += (d.fy || 0) + Math.min(1.1, (v.hitH || 1) * 0.5);
    const dir = _a.set(d.d[0], 0.4, d.d[1]);
    const brutal = d.g >= 2;
    const col = ICHOR[d.t] || ICHOR.still;
    spray(fx, p, dir, brutal ? 60 : 28, col, brutal ? 3.4 : 2.4);
    const [c0, c1] = CHUNKS[d.t] || CHUNKS.still;
    const fy = this.world.level?.floorY?.(p.x, p.z) ?? 0;
    const big = Math.max(0.5, Math.min(2.2, (v.hitH || 1)));
    fx.chunks(p, Math.round((brutal ? 16 : 7) * big), c0, 0.05 * big, brutal ? 4 : 2.6, fy, 14);
    fx.chunks(p, Math.round((brutal ? 8 : 3) * big), c1, 0.035 * big, brutal ? 3.5 : 2.2, fy, 14);
    if (d.t === 'fungal' || d.t === 'bacteria') fx.dustBurst(p, 26, [0.06, 0.07, 0.05], 1.4);
    if (d.t === 'moth') fx.dustBurst(p, 30, [0.85, 0.8, 0.6], 0.9);
    this.addPool(_b.set(p.x, 0, p.z), (brutal ? 0.55 : 0.32) * big, d.t);
    audio.play(brutal ? 'gore_splat' : 'flesh_hit', { pos: p, volume: 1, intensity: 1 });
    if (brutal) audio.play('bone_crack', { pos: p, volume: 0.9 });
    if (d.by === net.selfId) {
      juice.hitstop(brutal ? 140 : 90);
      juice.shake(brutal ? 0.6 : 0.35);
      juice.punch(brutal ? 0.07 : 0.04);
      if (brutal) juice.flash(0.18);
    }
  }

  addPool(pos, r, type) {
    const hex = POOL[type] ?? 0x3a0606;
    let m = this._poolMats.get(hex);
    if (!m) { m = new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.15, clearcoat: 1, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }); this._poolMats.set(hex, m); }
    const mesh = new THREE.Mesh(this._poolGeo, m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.random() * 6.28;
    const fy = this.world.level?.floorY?.(pos.x, pos.z) ?? 0;
    mesh.position.set(pos.x, fy + 0.008 + Math.random() * 0.004, pos.z);
    mesh.userData.r = r;
    mesh.userData.t = 0;
    mesh.userData.sy = 0.6 + Math.random() * 0.6;
    mesh.scale.setScalar(0.01);
    mesh.receiveShadow = true;
    this.world.group.add(mesh);
    this.pools.push(mesh);
    if (this.pools.length > 36) this.pools.shift().removeFromParent();
  }

  update(dt) {
    for (const m of this.pools) {
      const u = m.userData;
      if (u.t >= 1) continue;
      u.t = Math.min(1, u.t + dt * 0.6);
      const s = u.r * (1 - (1 - u.t) ** 3);
      m.scale.set(s, s * u.sy, 1);
    }
    if (this.localGrab) {
      this.localGrab.t += dt;
      if (Math.random() < dt * 6) juice.shake(0.12);
      if (this.localGrab.t > 12) this.localGrab = null;
    }
  }

  dispose() {
    for (const m of this.pools) m.removeFromParent();
    this.pools = [];
    for (const t of ['mfx', 'mdie', 'mgrab', 'mgrabFree', 'mfin']) net.clientHandlers.delete(t);
    for (const t of ['mhitReq', 'mgrabEnd', 'mfinish']) net.hostHandlers.delete(t);
  }
}
