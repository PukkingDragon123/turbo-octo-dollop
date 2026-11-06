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
    for (const k in caps) { const s = SPEED[k]?.[cls]; if (s) r = Math.max(r, s * caps[k]); }
    return r;
  }

  needOf(prop) { return 1.1 + Math.min(4, (prop.mass || 5) * 0.055); }

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
    if (!def.dismantle?.length || prop.dead || prop.frozen || def.camp) return;
    if (prop.state?.welded > 0 && def.shelter) return; // a fixed barricade / door takes a pry bar or the multitool
    const caps = this.capsOf(d.t || null);
    const cls = classOf(def, prop);
    const rate = this.rate(caps, cls);
    const p = prop.root.position;
    if (rate <= 0) {
      this._say(from, prop.id, cls === 'metal' ? `The ${itemName(prop.type).toLowerCase()} won't give with bare hands. A pry bar would get the metal off.` : `Your hands do nothing to it.`);
      return;
    }
    const now = this.game.world.time;
    let wk = this.work.get(prop.id);
    if (!wk || now - wk.t > 45) wk = { w: 0, need: this.needOf(prop), t: now };
    const power = Math.max(0.3, Math.min(1.2, d.pw ?? d.f ?? 0.6));
    wk.w += power * rate;
    wk.t = now;
    this.work.set(prop.id, wk);
    const f = Math.min(1, wk.w / wk.need);
    const w = this.game.world;
    w.fxAll({ k: 'dust', p: [p.x, p.y + 0.2, p.z], n: 4 + Math.round(f * 6), c: cls === 'wood' ? [0.62, 0.48, 0.3] : [0.7, 0.68, 0.6], s: 0.5 });
    if (f < 1) {
      w.fxAll({ k: 'snd', n: cls === 'metal' ? 'metal_rip' : cls === 'wood' ? 'sign_creak' : 'scrape_short', p: p.toArray(), v: 0.35 + f * 0.4, pi: 0.8 + f * 0.5 });
      net.toPeer(from, 'gatherProg', { id: prop.id, f: +f.toFixed(2) });
      return;
    }
    this.work.delete(prop.id);
    this.breakDown(prop, caps, from);
  }

  // host: the prop comes apart into what the tool recovered
  breakDown(prop, caps, from) {
    const w = this.game.world;
    if (!w || prop.dead) return;
    const def = itemDef(prop.type);
    // a container nobody searched spills what it held
    if (prop.custom?.hostAction && prop.state.looted === undefined && prop.custom.spec) {
      try { prop.custom.hostAction('loot'); } catch (e) { /* not a container */ }
    }
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
