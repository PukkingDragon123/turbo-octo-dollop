// Gear the clone wears and the things it does with what it holds (game.gear):
//  * WEAR: [E] on padded armour, a scrap helmet or a backpack puts it on (local.gear[slot]). Armour cuts the
//    damage taken (survival.armorMul), padding keeps the cold out, the backpack adds PACK_SLOTS slots: [X]
//    stows what the right hand holds, or takes the last thing back out. Everything worn drops where the clone dies.
//  * LIGHT: a torch (lit from a lighter, a burning stove, a flare or another torch) or a lantern in the hand
//    lights the way (a warm point light at the hand) and warms; a torch burns out into a charred stick.
//  * WATER: an empty bottle aimed at a puddle (or a water cooler) fills up; a water filter in the right hand with
//    dirty water in the left cleans it.
//  * READ: the field notebook opens in the paper view (game/paper.js).
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { net } from '../net/net.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { floatText } from '../ui/floattext.js';
import { itemDef, itemName } from './itemdefs.js';
import { isLitState } from './itemfx.js';
import { PaperView } from './paper.js';
import { drawNotebook } from './progress.js';
import { Q } from '../physics/physics.js';

export const HAND_SLOTS = 5;
const _f = new THREE.Vector3();

export class Gear {
  constructor(game) {
    this.game = game;
    this.paper = new PaperView(game);
    this.light = new THREE.PointLight(0xffb060, 0, 7, 1.6);
    this.light.position.set(0.25, -0.2, -0.3);
    engine.camera.add(this.light);
    this.t = 0;
    this._bind();
  }

  _bind() {
    net.onHost('svWear', (d, from) => this._hostWear(d.id, from));
    net.onClient('svWorn', (d) => this.wear(d.type));
    net.onHost('svPlace', (d, from) => this._hostPlace(d, from));
  }

  // host: a big thing made in the hands (a bedroll, a bench) goes down on the floor where its maker put it
  _hostPlace(d, from) {
    const w = this.game.world;
    if (!w || !d?.type) return;
    const p = new THREE.Vector3().fromArray(d.p);
    p.y = (w.level?.floorY?.(p.x, p.z) ?? 0) + 0.5;
    w.props.spawn(d.type, p, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, d.yaw || 0, 0)), { state: { ...(d.state || {}), maker: from } });
    w.fxAll({ k: 'dust', p: [p.x, p.y - 0.3, p.z], n: 14 });
  }

  // ------------------------------------------------------------------ wearing
  wearPrompt(p) { return `${itemName(p.type)} · [${input.keyName('interact')}] Put it on`; }
  requestWear(p) { net.toHost('svWear', { id: p.id }); }

  _hostWear(id, from) {
    const w = this.game.world, p = w?.props.get(id);
    if (!p || p.dead || !itemDef(p.type).wear) return;
    w.grab.releaseAllFor(p.id);
    w.props.despawn(p.id);
    if (from === net.selfId) this.wear(p.type, p.root.position);
    else net.toPeer(from, 'svWorn', { type: p.type });
  }

  // every peer, for its own clone
  wear(type) {
    const l = this.game.local, d = itemDef(type).wear;
    if (!d) return;
    l.gear = l.gear || {};
    const old = l.gear[d.slot];
    if (old && old !== type) l.dropItem({ type: old, state: {} }, false);
    l.gear[d.slot] = type;
    audio.play('suit_rustle', { volume: 0.8 });
    const what = [d.armor ? `bites hurt ${Math.round((1 - d.armor) * 100)}% less` : '', d.warm ? 'warmer' : '', d.slots ? `[${input.keyName('healthity')}] stows things in it` : ''].filter(Boolean).join(', ');
    floatText.notice(`${itemName(type)} on${what ? ': ' + what : ''}.`, { duration: 2.8 });
  }

  armorMul(l) {
    let m = 1;
    for (const k in l.gear || {}) m *= itemDef(l.gear[k]).wear?.armor ?? 1;
    const cur = l.hands?.rightItem?.();
    if (cur && itemDef(cur.type).shield) m *= itemDef(cur.type).shield;
    return m;
  }

  capacity(l) {
    let n = HAND_SLOTS;
    for (const k in l.gear || {}) n += itemDef(l.gear[k]).wear?.slots || 0;
    return n;
  }

  // everything worn comes off (death): [{ type, state }]
  strip(l) {
    const out = [];
    for (const k in l.gear || {}) if (l.gear[k]) out.push({ type: l.gear[k], state: {} });
    l.gear = {};
    return out;
  }

  // [X] with a backpack: the right hand's thing goes in, or the last thing comes back out
  packSwap(l) {
    const inv = l.inv, cap = inv.slots.length;
    if (cap <= HAND_SLOTS) { floatText.notice('Nowhere to stow it. A backpack would help.', { duration: 2 }); return; }
    const H = l.hands.compute();
    const freePack = inv.slots.findIndex((s, i) => i >= HAND_SLOTS && !s);
    const hand = H.right >= 0 ? H.right : H.armful ? H.pile[H.pile.length - 1] : H.left;
    if (hand >= 0 && hand != null && freePack >= 0) {
      inv.slots[freePack] = inv.slots[hand];
      inv.slots[hand] = null;
      inv.version++;
      audio.play('suit_rustle', { volume: 0.6 });
      floatText.notice(`${itemName(inv.slots[freePack].type)} stowed (${inv.slots.slice(HAND_SLOTS).filter(Boolean).length}/${cap - HAND_SLOTS})`, { duration: 1.6 });
      return;
    }
    let last = -1;
    for (let i = cap - 1; i >= HAND_SLOTS; i--) if (inv.slots[i]) { last = i; break; }
    const freeHand = inv.slots.findIndex((s, i) => i < HAND_SLOTS && !s);
    if (last >= 0 && freeHand >= 0) {
      inv.slots[freeHand] = inv.slots[last];
      inv.slots[last] = null;
      inv.select(freeHand);
      inv.version++;
      audio.play('suit_rustle', { volume: 0.6 });
      return;
    }
    floatText.notice(last < 0 ? 'The pack is empty.' : 'The pack is full.', { duration: 1.6 });
  }

  // ------------------------------------------------------------------ use actions (LMB)
  use(l, item, def) {
    switch (def.use) {
      case 'light': return this._light(l, item);
      case 'fill': return this._fill(l, item);
      case 'filter': return this._filter(l, item);
      case 'read': return this._read(l, item);
      default: return false;
    }
  }

  // a torch needs a flame to start; a lantern just switches
  _light(l, item) {
    const s = item.state;
    if (item.type === 'lantern') {
      s.lit = s.lit ? 0 : 1; s.litAt = Date.now();
      audio.play('toggle_clack', { volume: 0.6 });
    } else if (isLitState(item.type, s)) {
      floatText.notice('It is burning. Drop it [G] to light the floor.', { duration: 1.6 });
      return true;
    } else {
      const fire = l.inv.find('lighter') >= 0 || this._flameNear(l);
      if (!fire) { floatText.notice('You need a flame: a lighter, a lit stove, a flare.', { duration: 2.4 }); audio.play('ui_error', { volume: 0.3, bus: 'ui' }); return true; }
      s.lit = 1; s.litAt = Date.now();
      audio.play('stove_ignite', { volume: 0.7 });
    }
    l.inv.version++;
    l.arms?.gesture?.('use', 'R');
    return true;
  }

  _flameNear(l) {
    let ok = false;
    this.game.world.props.query(l.pos, 2.2, (p) => {
      if (p.type === 'camp_stove' && p.state.lit) ok = true;
      else if ((p.type === 'flare' || p.type === 'torch') && isLitState(p.type, p.state)) ok = true;
    });
    for (const it of l.inv.slots) if (it && it.type === 'torch' && isLitState('torch', it.state)) ok = true;
    return ok;
  }

  // what the crosshair is on: a puddle / flooded floor, or a water cooler
  _waterAt(l) {
    const cam = engine.camera, w = this.game.world;
    _f.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const hit = w.physics.raycast(cam.position, _f, 2.4, Q.all, null, (c) => c !== l.collider);
    if (!hit) return null;
    if (hit.ud?.kind === 'device' && /water_cooler/.test(hit.ud.device?.key || '')) return 'clean';
    if (hit.ud?.kind === 'prop' && hit.ud.prop?.type === 'water_cooler') return 'clean';
    const lvl = w.level;
    if (lvl?.sampleKindAt?.(hit) === 'flood_water') return 'dirty';
    const c = lvl?.cell?.(hit.point.x, hit.point.z);
    if (c && (c.water || c.wet > 0) && hit.normal.y > 0.6 && hit.point.y < 0.3) return 'dirty';
    if ((lvl?.waterDepth?.(hit.point.x, hit.point.z) || 0) > 0 && hit.point.y < 0.4) return 'dirty';
    return null;
  }

  _fill(l, item) {
    const kind = this._waterAt(l);
    if (!kind) { floatText.notice('Aim the bottle at a puddle, or a water cooler.', { duration: 2 }); return true; }
    item.type = kind === 'clean' ? 'water_clean' : 'water_dirty';
    item.state = {};
    l.inv.version++;
    audio.play('water_glug', { volume: 0.7 });
    audio.play('splash', { volume: 0.3 });
    l.arms?.gesture?.('pickup', 'R');
    if (kind === 'dirty') floatText.notice('Murky. Boil it in a stove pan, or filter it.', { duration: 2.4 });
    return true;
  }

  _filter(l, item) {
    const H = l.hands.compute();
    const other = H.left >= 0 ? l.inv.slots[H.left] : null;
    if (!other || other.type !== 'water_dirty') { floatText.notice('Hold the dirty water in your other hand.', { duration: 2 }); return true; }
    other.type = 'water_clean';
    other.state = {};
    l.inv.version++;
    audio.play('drip', { volume: 0.7 });
    audio.play('water_glug', { volume: 0.5, delay: 0.3, pitch: 1.3 });
    return true;
  }

  _read(l) {
    const sv = this.game.survival;
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 1400;
    drawNotebook(cv, sv?.book() || [], sv?.notes || []);
    this.paper.open(cv, { width: 0.1 });
    audio.play('paper', { volume: 0.7 });
    return true;
  }

  // ------------------------------------------------------------------ per frame (local clone)
  update(dt) {
    this.t += dt;
    this.paper.update(dt);
    const g = this.game, l = g.local;
    if (!g.world || !l.world) { this.light.intensity = 0; return; }
    l.survival.armorMul = this.armorMul(l);
    // the backpack makes room (taking it off is dying)
    const cap = this.capacity(l);
    if (l.inv.slots.length !== cap) l.inv.setCapacity?.(cap, (it) => l.dropItem(it, false));
    // a burning torch / lit lantern in the hand
    let best = null;
    for (const side of ['R', 'L']) {
      const it = side === 'R' ? l.hands.rightItem() : l.hands.leftItem();
      if (it && itemDef(it.type).light && isLitState(it.type, it.state)) best = it;
    }
    // torches burn out into charred sticks
    for (const it of l.inv.slots) {
      if (!it || it.type !== 'torch' || !it.state?.lit) continue;
      if (!isLitState('torch', it.state)) { it.type = 'stick'; it.state = {}; l.inv.version++; floatText.notice('The torch burned out.', { duration: 1.6 }); }
    }
    if (best && !l.dead) {
      const torch = best.type === 'torch';
      this.light.color.setHex(torch ? 0xff9a40 : 0xffc880);
      this.light.distance = itemDef(best.type).light.r;
      this.light.intensity = (torch ? 2.6 + Math.sin(this.t * 21) * 0.35 + Math.sin(this.t * 13.7) * 0.25 : 2.0);
    } else this.light.intensity = 0;
  }

  dispose() { this.paper.dispose(); this.light.removeFromParent(); }
}

