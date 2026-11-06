// Gathering: furniture and junk come apart into materials.
//  * Hit it. Every punch or swing at a prop that is made of something (itemdefs `dismantle`) works it loose a
//    little (host side, from the 'hit' message): the prop wobbles, dust and splinters fly, it creaks. When the work
//    is done it falls apart into what the tool could recover:
//      bare hands  slow; the soft parts (cloth, foam, glass) and splinters (a plank becomes a stick); metal won't give
//      rock hammer bashes: metal comes off bent (no screws), glass and electronics smash out quickly
//      pry bar     metal panels, screws, whole planks; the all-rounder
//      saw/hatchet wood fast, whole planks             shiv knife  cloth, foam and wire, cleanly
//  * The built-in MULTITOOL (dismantle mode) takes anything apart completely, but it eats battery.
//  A container that was never searched spills its contents first.
//  * BOARDED DOORWAYS (fixed planks across a doorway, world/levels/yellow/biome.js): a pry bar or a hatchet tears
//    them down in two or three swings, a rock hammer in a few more; fists do nothing. LOCKED FOOTLOCKERS: the same
//    swings at the padlock open the lid (lootables.js 'unlock') instead of breaking it.
//  Quick and juicy: a few hits per piece, chips fly on every hit, the one who breaks it feels it (shake, thunk).
//   new Gather(game): hostHit(prop, d, from), breakDown(prop, caps, from), capsOf(toolType | null), recover(type, caps)
import * as THREE from 'three';
import { net } from '../net/net.js';
import { audio } from '../audio/audio.js';
import { floatText } from '../ui/floattext.js';
import { itemDef, itemName } from './itemdefs.js';

// work speed per hit, per capability and material class
const SPEED = {
  hand: { wood: 0.3, soft: 0.75, electro: 0.3, glass: 0.55, stone: 0.12, metal: 0 },
  bash: { wood: 0.75, soft: 0.5, electro: 1.0, glass: 1.5, stone: 1.1, metal: 0.6 },
  pry: { wood: 0.95, soft: 0.6, electro: 1.0, glass: 0.8, stone: 0.45, metal: 1.15 },
  cut: { wood: 1.6, soft: 1.1, electro: 0.5, glass: 0.3, stone: 0.1, metal: 0.25 },
  fine: { wood: 0.3, soft: 1.6, electro: 1.2, glass: 0.4, stone: 0, metal: 0.2 },
};
// nailed boards across a doorway / a padlock: leverage beats force
const HARD = {
  boarded: { hand: 0, bash: 0.32, pry: 1.25, cut: 0.95, fine: 0 },
  lock: { hand: 0, bash: 0.3, pry: 1.5, cut: 0.6, fine: 0.1 },
};
const CHIP = { wood: [0.62, 0.46, 0.28], metal: [0.6, 0.6, 0.62], soft: [0.8, 0.76, 0.66], glass: [0.75, 0.88, 0.9], stone: [0.66, 0.64, 0.6], electro: [0.4, 0.4, 0.42], boarded: [0.62, 0.46, 0.28], lock: [0.8, 0.66, 0.3] };
const FREE = new Set(['fabric_scrap', 'foam', 'glass_shard', 'stick', 'tape_roll', 'bottle', 'rock']);

export function classOf(def, prop) {
  if (def.gather) return def.gather;
  const m = prop?.material;
  if (m === 'metal') return 'metal';
  if (m === 'fabric' || m === 'soft' || m === 'rubber') return 'soft';
  if (m === 'glass') return 'glass';
  if (m === 'stone' || m === 'concrete') return 'stone';
  return 'wood';
}

export class Gather {
  constructor(game) {
    this.game = game;
    this.work = new Map(); // host: prop id -> { w, need, t }
    this._msgT = new Map();
    this.prog = null; // client: { id, f, t }
    this.bind();
  }

  bind() {
    net.onClient('gatherProg', (d) => this._onProg(d));
  }

  // capabilities of what is in the hand ('hand' for bare fists, power for the multitool)
  capsOf(type) {
    if (type === '__mt') return { power: 1 };
    const t = type ? itemDef(type).tool : null;
    if (!t) return type && itemDef(type).weapon ? { bash: 0.45 } : { hand: 1 };
    return { ...t };
  }

  // how fast these caps work this class (one full-power hit)
  rate(caps, cls) {
    if (caps.power) return 9;
    let r = 0;
    const hard = HARD[cls];
    for (const k in caps) { const s = hard ? hard[k] : SPEED[k]?.[cls]; if (s) r = Math.max(r, s * caps[k]); }
    return r;
  }

  // work to take it apart: a chair is a handful of punches, a desk a few more; tools cut that to two or three
  needOf(prop, cls) {
    if (cls === 'boarded') return 2.4;
    if (cls === 'lock') return 2.0;
    return 0.6 + Math.min(2.4, (prop.mass || 5) * 0.03);
  }

  // what one yield entry becomes with these caps (null: lost)
  recover(type, caps, rng = Math.random) {
    if (caps.power) return type;
    const pry = caps.pry || 0, bash = caps.bash || 0, cut = caps.cut || 0, fine = caps.fine || 0;
    switch (type) {
      case 'plank': return cut >= 0.8 || pry >= 0.8 ? 'plank' : bash >= 0.9 && rng() < 0.4 ? 'plank' : 'stick';
      case 'metal_scrap': return pry >= 0.5 || bash >= 0.5 || cut >= 1.2 ? 'metal_scrap' : null;
      case 'screws': return pry >= 0.5 || fine >= 1 ? 'screws' : null;
      case 'wire_spool': return fine >= 0.5 || pry >= 0.5 ? 'wire_spool' : rng() < 0.5 ? 'wire_spool' : null;
      case 'gear': case 'pipe_short': case 'battery': return pry >= 0.5 || bash >= 0.5 || caps.hand ? type : null;
      case 'wheel': return type;
      default: return FREE.has(type) ? type : (pry || bash ? type : null);
    }
  }

  // host: a punch / swing landed on a prop (d: { f power, t tool type })
  hostHit(prop, d, from) {
    const def = itemDef(prop.type);
    if (!def.dismantle?.length || prop.dead || def.camp) return;
    if (prop.frozen && !def.boarded) return;
    if (prop.state?.welded > 0 && def.shelter) return; // a fixed barricade / door takes a pry bar or the multitool
    const caps = this.capsOf(d.t || null);
    const locked = !!def.locked && prop.state?.locked !== 0 && prop.state?.looted === undefined;
    const cls = def.boarded ? 'boarded' : locked ? 'lock' : classOf(def, prop);
    const rate = this.rate(caps, cls);
    const p = prop.root.position;
    if (rate <= 0) {
      this._say(from, prop.id, cls === 'boarded' ? 'The boards are nailed fast. A pry bar would rip them off; a rock hammer would get there.'
        : cls === 'lock' ? 'Padlocked. A pry bar would snap the hasp (a hatchet would too).'
          : cls === 'metal' ? `The ${itemName(prop.type).toLowerCase()} won't give with bare hands. A pry bar would get the metal off.` : `Your hands do nothing to it.`);
      return;
    }
    const now = this.game.world.time;
    let wk = this.work.get(prop.id);
    if (!wk || now - wk.t > 45 || wk.cls !== cls) wk = { w: 0, need: this.needOf(prop, cls), t: now, cls };
    const power = Math.max(0.45, Math.min(1.2, d.pw ?? d.f ?? 0.6));
    wk.w += power * rate;
    wk.t = now;
    this.work.set(prop.id, wk);
    const f = Math.min(1, wk.w / wk.need);
    const w = this.game.world;
    const at = Array.isArray(d.p) ? d.p : [p.x, p.y + 0.2, p.z];
    w.fxAll({ k: 'chip', p: at, n: 3 + Math.round(f * 5), c: CHIP[cls] || CHIP.wood, m: cls });
    if (f < 1) {
      w.fxAll({ k: 'snd', n: cls === 'metal' || cls === 'lock' ? 'metal_rip' : cls === 'wood' || cls === 'boarded' ? 'sign_creak' : 'scrape_short', p: p.toArray(), v: 0.4 + f * 0.45, pi: 0.8 + f * 0.5 });
      net.toPeer(from, 'gatherProg', { id: prop.id, f: +f.toFixed(2) });
      return;
    }
    this.work.delete(prop.id);
    net.toPeer(from, 'gatherProg', { id: prop.id, f: 1, done: cls });
    if (cls === 'lock') {
      w.fxAll({ k: 'snd', n: 'metal_rip', p: p.toArray(), v: 1, pi: 1.3 });
      w.fxAll({ k: 'sparks', p: [p.x, p.y + 0.1, p.z], n: 14, s: 2.5 });
      prop.custom?.hostAction?.('unlock');
      this.game.survival?.hostOpened?.(prop, from);
      return;
    }
    this.breakDown(prop, caps, from);
  }

  // host: the prop comes apart into what the tool recovered
  breakDown(prop, caps, from) {
    const w = this.game.world;
    if (!w || prop.dead) return;
    const def = itemDef(prop.type);
    // a container nobody searched spills what it held
    if (prop.custom?.hostAction && prop.state.looted === undefined && prop.custom.spec) {
      try { prop.custom.hostAction(prop.custom.locked ? 'unlock' : 'loot'); } catch (e) { /* not a container */ }
    }
    if (def.boarded) this.game.survival?.hostOpened?.(prop, from);
    const pos = prop.root.position.clone();
    const yields = [];
    for (const t of def.dismantle || def.into || []) {
      const got = this.recover(t, caps);
      if (got) yields.push(got);
    }
    // anything that rolled on casters gives its wheels back
    for (const t of prop.model?.breakInto || []) if (t === 'wheel') yields.push('wheel');
    this.game.tools.unweld(prop);
    w.grab.releaseAllFor(prop.id);
    w.props.despawn(prop.id, { k: 'break', m: prop.material, p: pos.toArray() });
    w.noise.emit(pos, 11, 'dismantle');
    w.fxAll({ k: 'snd', n: 'dismantle', p: pos.toArray(), v: 0.9 });
    const floor = (w.level?.floorY?.(pos.x, pos.z) ?? 0) + 0.15;
    yields.forEach((t, i) => {
      const a = i * 2.39996;
      const off = new THREE.Vector3(Math.cos(a) * 0.22, 0.15 + i * 0.07, Math.sin(a) * 0.22);
      const at = pos.clone().add(off);
      at.y = Math.max(floor, at.y);
      w.props.spawn(t, at, new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 3, i, 0)), { vel: off.clone().multiplyScalar(2.2) });
    });
    if (!yields.length) this._say(from, prop.id, 'Nothing worth keeping came off it.');
    this.game.survival?.hostDismantled(prop.type, from, yields);
  }

  _say(to, id, text) {
    const k = `${to}:${id}`, now = this.game.world?.time ?? 0;
    if (now - (this._msgT.get(k) ?? -99) < 4) return;
    this._msgT.set(k, now);
    net.toPeer(to, 'gatherProg', { id, f: -1, text });
  }

  // client: show how far along the work is (a ring that fills; it fades when you stop)
  _onProg(d) {
    const ui = this.game.ui;
    if (d.text) { floatText.notice(d.text, { duration: 2.6 }); audio.play('ui_error', { volume: 0.25, bus: 'ui' }); return; }
    const l = this.game.local;
    if (d.f >= 1) {
      // it gave: a thump in the hands
      l.shake = Math.max(l.shake || 0, d.done === 'boarded' ? 0.22 : 0.12);
      audio.play('robo_clunk', { volume: 0.35, pitch: 1.25, bus: 'ui' });
      this.prog = null;
      ui.progress(null);
      return;
    }
    l.shake = Math.max(l.shake || 0, 0.035);
    this.prog = { id: d.id, f: d.f, t: 1.3 };
    const p = this.game.world?.props.get(d.id);
    ui.progress(d.f, p ? `Taking apart: ${itemName(p.type)}` : 'Taking it apart');
  }

  update(dt) {
    if (!this.prog) return;
    this.prog.t -= dt;
    if (this.prog.t <= 0) { this.prog = null; this.game.ui.progress(null); }
  }
}
