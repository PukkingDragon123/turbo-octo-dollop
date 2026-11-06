// Crafting. No menus: you put the parts together with your hands.
//  * IN YOUR HANDS (tier 0): hold the parts (right hand, left hand, or an armful) and press [R]: the clone brings
//    them together, they twist and snap into the new thing (game/hands.js combine animation). Rag bandages,
//    torches, sharpened sticks, a rock hammer, a bedroll and the first workbench are made like this.
//  * AT A WORKBENCH (tier 1..3): lay the parts on the bench top (drag them there or drop them on it). When they
//    make something, its ghost turns slowly above the bench; [E] on the bench and the parts lift, spin together and
//    slam into it (every peer plays the same assembly). A bench vise (made at the bench) takes it to tier 2, a
//    soldering kit to tier 3. The old trestle bench found in some camps already has a vise.
//  * A recipe can keep a tool (a water filter, the radio being repaired) and change its state instead of using it up.
// Host authoritative for benches (props); hand crafting is local (the inventory is the client's) and reported.
//   RECIPES, recipeById(id), findRecipe(counts, tier, where), nearMiss(counts, tier, where), recipeText(r)
//   HandCraft (one per local player: game.local.craft), registerBenches(world, game)
import * as THREE from 'three';
import { net } from '../net/net.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { engine } from '../core/engine.js';
import { floatText } from '../ui/floattext.js';
import { itemDef, itemName } from './itemdefs.js';
import { buildModel } from '../entities/catalog.js';
import { Q } from '../physics/physics.js';
import { ModelDevice, DEVICE_FACTORIES } from './devicekinds.js';

// at: 0 = in the hands (also works on any bench), 1 = workbench, 2 = with a vise, 3 = with a soldering kit
// needs: { type: count }   keep: [types] not used up   state: state given to the output (or to the kept prop)
// note: a line for the recipe book, in the voice of whoever wrote it down first
const R = (o) => ({ keep: [], ...o });
export const RECIPES = [
  // ---- hands
  R({ id: 'rag_bandage', out: 'rag_bandage', at: 0, needs: { fabric_scrap: 2 }, note: 'Two rags, twisted tight. Stops the bleeding. Mostly.' }),
  R({ id: 'torch', out: 'torch', at: 0, needs: { stick: 1, fabric_scrap: 1 }, note: 'Rag round a stick. Light it off anything burning, or a lighter.' }),
  R({ id: 'sharp_stick', out: 'sharp_stick', at: 0, needs: { stick: 1, glass_shard: 1 }, note: 'Scrape a point onto a stick with a bit of glass. Better than fists.' }),
  R({ id: 'rock_hammer', out: 'rock_hammer', at: 0, needs: { rock: 1, stick: 1, fabric_scrap: 1 }, note: 'Lash a lump of concrete to a stick. Smashes glass, dents metal.' }),
  R({ id: 'rock_hammer_t', out: 'rock_hammer', at: 0, needs: { rock: 1, stick: 1, tape_roll: 1 }, hidden: true }),
  R({ id: 'bedroll', out: 'bedroll', at: 0, needs: { fabric_scrap: 2, foam: 1 }, note: 'Foam inside, rags round it. Lie on it: it is your bed now. You wake up there.' }),
  R({ id: 'scrap_bench', out: 'scrap_bench', at: 0, needs: { plank: 2, stick: 2 }, note: 'Two planks on four legs of stick. Everything better starts on a bench.' }),
  R({ id: 'water_filter_use', out: 'water_clean', at: 0, needs: { water_dirty: 1, water_filter: 1 }, keep: ['water_filter'], note: 'Pour dirty water through the filter. Or boil it in a pan.' }),
  R({ id: 'reload', out: null, at: 0, needs: { crossbow: 1, bolt_bundle: 1 }, keep: ['crossbow'], keepState: { crossbow: (s) => ({ bolts: Math.min(12, (s.bolts || 0) + 6) }) }, note: 'Bolts and crossbow in your hands to load it.' }),
  // ---- workbench
  R({ id: 'crowbar', out: 'crowbar', at: 1, needs: { pipe_short: 1, metal_scrap: 1 }, note: 'Pipe, flattened at one end on the bench edge. A pry bar gets the metal and the screws off.' }),
  R({ id: 'crowbar_t', out: 'crowbar', at: 1, needs: { metal_scrap: 2, tape_roll: 1 }, hidden: true }),
  R({ id: 'saw', out: 'saw', at: 1, needs: { metal_scrap: 1, plank: 1, screws: 1 }, note: 'File teeth into a strip of scrap, screw a grip on. A saw gives you whole planks.' }),
  R({ id: 'knife', out: 'knife', at: 1, needs: { glass_shard: 1, stick: 1, tape_roll: 1 }, note: 'A shard taped into a stick. Cuts cloth and wire clean. Mind your fingers.' }),
  R({ id: 'knife_m', out: 'knife', at: 1, needs: { metal_scrap: 1, stick: 1, fabric_scrap: 1 }, hidden: true }),
  R({ id: 'spear', out: 'spear', at: 1, needs: { stick: 2, glass_shard: 1, tape_roll: 1 }, note: 'Two sticks end to end, a blade on the front. Keeps things at arm\'s length and then some.' }),
  R({ id: 'bat', out: 'bat', at: 1, needs: { plank: 1, screws: 1 }, note: 'Screws through a plank. Ugly. Works.' }),
  R({ id: 'barricade_panel', out: 'barricade_panel', at: 1, needs: { plank: 3, screws: 1 }, note: 'Planks screwed into a panel. Prop it in a doorway, fix it in place with the multitool.' }),
  R({ id: 'plank_door', out: 'plank_door', at: 1, needs: { plank: 3, screws: 1, metal_scrap: 1 }, note: 'A door that opens. Stand it in a doorway, attach it with the multitool: it hangs on a hinge.' }),
  R({ id: 'stash_crate', out: 'stash_crate', at: 1, needs: { plank: 2, stick: 2, screws: 1 }, note: 'A crate with a lid. What you put in stays put, even when you don\'t.' }),
  R({ id: 'spike_trap', out: 'spike_trap', at: 1, needs: { plank: 1, metal_scrap: 1, screws: 1 }, note: 'Nails up. Lay it where they come in.' }),
  R({ id: 'splint', out: 'splint', at: 1, needs: { stick: 2, fabric_scrap: 1 }, note: 'Two straight sticks and a rag.' }),
  R({ id: 'battery', out: 'battery', at: 1, needs: { metal_scrap: 1, wire_spool: 1, tape_roll: 1 }, note: 'Scrap plates, copper wire, taped tight: a cell. Charges the multitool, the flashlight.' }),
  R({ id: 'trolley', out: 'trolley', at: 1, needs: { plank: 2, wheel: 2, screws: 1 }, note: 'Wheels under planks: a cart for the heavy things.' }),
  R({ id: 'radio_fix', out: null, at: 1, needs: { radio: 1, wire_spool: 1, screws: 1, tape_roll: 1 }, keep: ['radio'], keepState: { radio: () => ({ broken: 0 }) }, note: 'The radio by the place I woke up: new wire, new screws, tape. It hisses. Someone is out there.' }),
  R({ id: 'radio_antenna', out: 'radio_antenna', at: 1, needs: { wire_spool: 1, metal_scrap: 1 }, note: 'More wire, more metal, more reach.' }),
  R({ id: 'radio_battery', out: 'radio_battery', at: 1, needs: { battery: 2, tape_roll: 1 }, note: 'Two cells taped in series. The radio drinks them.' }),
  R({ id: 'bench_vise', out: 'bench_vise', at: 1, needs: { metal_scrap: 2, gear: 1, screws: 1 }, upgrade: 2, note: 'A gear and a screw make a vise. Bolt it to the bench: now it holds metal still.' }),
  // ---- with a vise
  R({ id: 'hatchet', out: 'hatchet', at: 2, needs: { metal_scrap: 2, plank: 1, screws: 1 }, note: 'A wedge of scrap on a haft. Chops furniture to planks in a few swings.' }),
  R({ id: 'padded_vest', out: 'padded_vest', at: 2, needs: { fabric_scrap: 2, foam: 2, tape_roll: 1 }, note: 'Foam sewn between rags. Bites hurt less. Warmer too.' }),
  R({ id: 'hard_hat', out: 'hard_hat', at: 2, needs: { metal_scrap: 1, foam: 1, fabric_scrap: 1 }, note: 'Beat a bowl out of scrap, line it with foam.' }),
  R({ id: 'backpack', out: 'backpack', at: 2, needs: { fabric_scrap: 3, tape_roll: 1 }, note: 'A bag on your back: three more things you can carry ([X] stows or takes out).' }),
  R({ id: 'lantern', out: 'lantern', at: 2, needs: { glass_shard: 1, metal_scrap: 1, wire_spool: 1, battery: 1 }, note: 'A bulb in a cage. It does not burn out. Hang it at home.' }),
  R({ id: 'camp_lamp', out: 'camp_lamp', at: 2, needs: { pipe_short: 1, glass_shard: 1, wire_spool: 1, battery: 1 }, note: 'A lamp on a pole. The room stays lit while you sleep.' }),
  R({ id: 'water_filter', out: 'water_filter', at: 2, needs: { bottle: 1, fabric_scrap: 1, foam: 1, rock: 1 }, note: 'Cut a bottle, stuff it with grit, foam and cloth. Dirty water comes out drinkable.' }),
  R({ id: 'camp_stove', out: 'camp_stove', at: 2, needs: { metal_scrap: 2, pipe_short: 1, screws: 1 }, note: 'A stove: warmth, and food that does not make you sick. Boils water too.' }),
  R({ id: 'cot', out: 'cot', at: 2, needs: { plank: 2, fabric_scrap: 2, foam: 1 }, note: 'Off the floor, out of the damp. You sleep deeper.' }),
  R({ id: 'insulation', out: 'insulation', at: 2, needs: { foam: 2, fabric_scrap: 1, tape_roll: 1 }, note: 'Pads against the walls keep the cold out of the room.' }),
  R({ id: 'noise_maker', out: 'noise_maker', at: 2, needs: { metal_scrap: 1, wire_spool: 1, battery: 1 }, note: 'Arm it, throw it, run.' }),
  R({ id: 'radio_coil', out: 'radio_coil', at: 2, needs: { wire_spool: 2, screws: 1, gear: 1 }, note: 'Wind the wire tight on a former, a gear for the tuning. The radio finds more voices.' }),
  R({ id: 'solder_kit', out: 'solder_kit', at: 2, needs: { wire_spool: 1, battery: 1, metal_scrap: 1, pipe_short: 1 }, upgrade: 3, note: 'An iron that gets hot off a battery. Now you can make the fine things.' }),
  // ---- with a soldering kit
  R({ id: 'crossbow', out: 'crossbow', at: 3, needs: { plank: 1, wire_spool: 1, pipe_short: 1, gear: 1, screws: 1 }, state: { bolts: 6 }, note: 'A plank, a pipe, spring steel and a wire string. Quiet, and far.' }),
  R({ id: 'bolt_bundle', out: 'bolt_bundle', at: 3, needs: { stick: 2, metal_scrap: 1 }, note: 'Straight sticks, scrap points. Six to a bundle.' }),
  R({ id: 'radio_amp', out: 'radio_amp', at: 3, needs: { wire_spool: 1, battery: 1, glass_shard: 1, gear: 1 }, note: 'A valve that glows. The radio reaches the far ones.' }),
  R({ id: 'distorter', out: 'distorter', at: 3, needs: { wire_spool: 2, metal_scrap: 2, glass_shard: 1, battery: 1 }, note: 'The thing in the glass hums and they cannot come near it.' }),
];
const BY_ID = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
export function recipeById(id) { return BY_ID[id] || null; }
export const TIER_NAMES = ['hands', 'workbench', 'workbench + vise', 'workbench + soldering kit'];

const count = (needs) => Object.values(needs).reduce((a, b) => a + b, 0);
function covers(have, needs) { for (const k in needs) if ((have[k] || 0) < needs[k]) return false; return true; }
function exact(have, needs) {
  for (const k in have) if ((have[k] || 0) !== (needs[k] || 0)) return false;
  return covers(have, needs);
}
const usable = (r, tier, where) => (where === 'hand' ? r.at === 0 : r.at <= tier);

// the recipe the parts make: an exact match first, then the one that uses the most of them
export function findRecipe(have, tier = 0, where = 'hand') {
  let best = null, bs = -1;
  for (const r of RECIPES) {
    if (!usable(r, tier, where) || !covers(have, r.needs)) continue;
    const s = count(r.needs) + (exact(have, r.needs) ? 100 : 0);
    if (s > bs) { bs = s; best = r; }
  }
  return best;
}

// almost a recipe: one part short (at this tier), or the right parts on a bench that is not good enough yet
export function nearMiss(have, tier = 0, where = 'hand') {
  const n = Object.values(have).reduce((a, b) => a + b, 0);
  if (!n) return null;
  let best = null, bs = -1;
  for (const r of RECIPES) {
    if (r.hidden || (where === 'hand' && r.at !== 0)) continue;
    let miss = null, missN = 0, used = 0, extra = 0;
    for (const k in r.needs) { const h = have[k] || 0; used += Math.min(h, r.needs[k]); if (h < r.needs[k]) { missN += r.needs[k] - h; miss = k; } }
    for (const k in have) if (!r.needs[k]) extra += have[k];
    if (extra || used < Math.max(1, count(r.needs) - 1)) continue;
    if (missN === 0 && r.at > tier) { if (used + 50 > bs) { bs = used + 50; best = { r, tierShort: r.at }; } continue; }
    if (missN === 1 && r.at <= tier && used > bs) { bs = used; best = { r, missing: miss }; }
  }
  return best;
}

export function recipeText(r) {
  const parts = Object.entries(r.needs).map(([k, n]) => `${n > 1 ? n + ' ' : ''}${itemName(k).toLowerCase()}${n > 1 && !/s$/.test(itemName(k)) ? 's' : ''}`);
  return parts.join(' + ');
}

const outName = (r) => (r.out ? itemName(r.out) : r.id === 'radio_fix' ? 'Repaired Radio' : r.id === 'reload' ? 'Loaded Crossbow' : itemName(r.keep[0]));

// ---------------------------------------------------------------------------------------------- hand crafting
// the local clone's [R] combine: reads what the hands hold, offers the recipe once, plays the combine
export class HandCraft {
  constructor(player) {
    this.p = player;
    this.hint = null;      // recipe currently in the hands
    this._key = '';
    this._said = new Set();
    this.busy = false;
  }

  // slot indices of the items in the hands (right, left, armful pile; not the backpack)
  heldSlots() {
    const L = this.p.hands.layout;
    const out = [];
    if (L.armful) out.push(...L.pile);
    else { if (L.right >= 0) out.push(L.right); if (L.left >= 0) out.push(L.left); }
    return out;
  }

  update() {
    const p = this.p;
    if (this.busy || !p.world || p.dead) return;
    const slots = this.heldSlots();
    const have = {};
    for (const i of slots) { const it = p.inv.slots[i]; if (it) have[it.type] = (have[it.type] || 0) + 1; }
    const key = Object.entries(have).sort().map(([k, n]) => k + n).join(',');
    if (key !== this._key) {
      this._key = key;
      this.hint = slots.length >= 2 ? findRecipe(have, 0, 'hand') : null;
      if (this.hint && !this._said.has(this.hint.id)) {
        this._said.add(this.hint.id);
        floatText.notice(`[${input.keyName('rotate')}] put them together: ${outName(this.hint)}`, { duration: 3.2 });
      }
    }
    if (!this.hint) return;
    const can = !p.grab && !p.toolOut && !p.watchOpen && !p.useAction && !p.holdAction && !p.terminal;
    if (can && input.hit('rotate')) this.combine(this.hint, slots);
  }

  combine(r, slots) {
    const p = this.p;
    // pick the slots that the recipe uses (and the ones it keeps)
    const need = { ...r.needs }, use = [], keep = [];
    for (const i of slots) {
      const it = p.inv.slots[i];
      if (!it || !need[it.type]) continue;
      need[it.type]--;
      (r.keep.includes(it.type) ? keep : use).push(i);
    }
    if (Object.values(need).some((n) => n > 0)) return;
    this.busy = true;
    const types = [...use, ...keep].map((i) => p.inv.slots[i].type);
    audio.play('suit_rustle', { volume: 0.6 });
    p.arms.gesture?.('snatch', 'both');
    const usedItems = use.map((i) => p.inv.slots[i]), keptItems = keep.map((i) => p.inv.slots[i]);
    p.hands.combine(types, r.out || r.keep[0], () => {
      this.busy = false;
      // the parts must still be in the hands (nothing was dropped meanwhile)
      if (p.dead || usedItems.some((it) => !p.inv.slots.includes(it))) { this._key = ''; return; }
      // the parts are gone, the new thing is in the hands (or set down, if it is too big to hold)
      for (const it of keptItems) {
        const f = r.keepState?.[it?.type];
        if (it && f) it.state = { ...it.state, ...f(it.state || {}) };
      }
      for (const it of usedItems) p.inv.remove(p.inv.slots.indexOf(it));
      p.inv.version++;
      if (r.out) {
        const item = { type: r.out, state: { ...(r.state || {}) } };
        if (itemDef(r.out).pocket) {
          const slot = p.inv.add(item);
          if (slot >= 0) p.inv.select(slot); else p.dropItem(item, false);
        } else this.place(item);
      }
      audio.play('craft', { volume: 0.8 });
      audio.play('bolt_turn', { volume: 0.4, delay: 0.1 });
      p.game.survival?.onCrafted(r, 'hand');
      this._key = '';
    });
  }

  // a big thing (bedroll, bench): put it down on the floor in front of the clone
  place(item) {
    const p = this.p, cam = engine.camera;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).setY(0);
    if (f.lengthSq() < 1e-4) f.set(0, 0, -1);
    f.normalize();
    let d = 1.3;
    const hit = p.world.physics.raycast(new THREE.Vector3(p.pos.x, p.pos.y + 0.5, p.pos.z), f, 2, Q.world);
    if (hit) d = Math.max(0.6, hit.dist - 0.7);
    const pos = p.pos.clone().addScaledVector(f, d);
    net.toHost('svPlace', { type: item.type, state: item.state, p: pos.toArray(), yaw: Math.atan2(f.x, f.z) });
  }
}

// ---------------------------------------------------------------------------------------------- workbenches
// bench geometry per prop type: top centre comes from the model anchor 'top'; w / d = usable top area
const BENCHES = {
  scrap_bench: { w: 1.15, d: 0.56 },
  field_bench: { w: 1.3, d: 0.56 },
};
const _v = new THREE.Vector3(), _m = new THREE.Matrix4();

// A bench is a prop (made at the hands, the old trestle bench) or a device (the heavy bench standing in workshop
// rooms). `o` adapts either: { root, top (local Vector3), w, d, tier(), busy(), setState(partial), send(a, d),
// setTier(n), selfProp }
class Bench {
  constructor(world, o) {
    this.world = world;
    this.o = o;
    this.scanT = 0;
    this.match = null;
    this.near = null;
    this.ids = [];
    this.have = {};
    this.ghost = null;
    this.ghostType = null;
    this.ghostT = 0;
    o.setTier?.(o.tier());
  }

  get tier() { return this.o.tier(); }

  topCenter(out = new THREE.Vector3()) {
    this.o.root.updateMatrixWorld(true);
    return out.copy(this.o.top).applyMatrix4(this.o.root.matrixWorld);
  }

  // the props lying on the bench top
  onTop() {
    const out = [];
    const c = this.topCenter(new THREE.Vector3());
    const inv = _m.copy(this.o.root.matrixWorld).invert();
    const { x: tx, y: ty, z: tz } = this.o.top;
    this.world.props.query(c, 1.3, (p) => {
      if (p.dead || p === this.o.selfProp || p.isHeld() || p.type.startsWith('rag_')) return;
      const l = _v.copy(p.root.position).applyMatrix4(inv);
      if (Math.abs(l.x - tx) > this.o.w / 2 + 0.05 || Math.abs(l.z - tz) > this.o.d / 2 + 0.08) return;
      if (l.y < ty - 0.12 || l.y > ty + 0.6) return;
      if (!p.def.pocket && !p.def.radio && !p.def.upgrade) return; // only things small enough to work on (+ the radio)
      out.push(p);
    });
    return out;
  }

  _scan() {
    const list = this.onTop();
    const have = {};
    for (const p of list) have[p.type] = (have[p.type] || 0) + 1;
    this.ids = list.map((p) => p.id);
    this.have = have;
    this.match = list.length ? findRecipe(have, this.tier, 'bench') : null;
    // a radio that already works does not need repairing
    if (this.match?.id === 'radio_fix' && !list.find((p) => p.type === 'radio')?.state?.broken) this.match = null;
    this.near = this.match ? null : nearMiss(have, this.tier, 'bench');
  }

  prompt() {
    const key = `[${input.keyName('interact')}]`;
    if (this.o.busy()) return 'Workbench · ...';
    if (this.match) return `Workbench · ${key} Assemble: ${outName(this.match)}`;
    if (this.near?.tierShort) return `Workbench · ${outName(this.near.r)} needs a ${this.near.tierShort === 2 ? 'vise' : 'soldering kit'} on the bench`;
    if (this.near?.missing) return `Workbench · ${outName(this.near.r)}: one ${itemName(this.near.missing).toLowerCase()} short`;
    return `Workbench (${TIER_NAMES[this.tier]}) · lay parts on top`;
  }

  interact() {
    if (!this.match) {
      audio.play('ui_error', { volume: 0.3, bus: 'ui' });
      floatText.notice(this.ids.length ? 'These parts don\'t make anything. Try the notes.' : 'Lay the parts on the bench top first.', { duration: 2.4 });
      return;
    }
    this.o.send('assemble', { r: this.match.id });
  }

  // host: carry out the recipe on what lies on the top
  hostAction(a, d, from) {
    if (a !== 'assemble' || this.o.busy()) return;
    this._scan();
    const r = this.match;
    if (!r || (d?.r && d.r !== r.id)) return;
    const need = { ...r.needs }, used = [], kept = [];
    for (const id of this.ids) {
      const p = this.world.props.get(id);
      if (!p || !need[p.type]) continue;
      need[p.type]--;
      (r.keep.includes(p.type) ? kept : used).push(p);
    }
    if (Object.values(need).some((n) => n > 0)) return;
    const w = this.world, c = this.topCenter(new THREE.Vector3());
    const parts = used.map((p) => ({ t: p.type, p: p.root.position.toArray().map((x) => +x.toFixed(3)), q: p.root.quaternion.toArray().map((x) => +x.toFixed(3)) }));
    this.o.setState({ busy: 1 });
    for (const p of used) { w.grab.releaseAllFor(p.id); w.props.despawn(p.id); }
    w.fxAll({ k: 'assemble', parts, c: c.toArray() });
    w.noise.emit(c, 12, 'craft');
    const tier = this.tier;
    setTimeout(() => {
      if (this.disposed || this.world.game.world !== w) return;
      this.o.setState({ busy: 0 });
      for (const p of kept) {
        if (p.dead) continue;
        const f = r.keepState?.[p.type];
        if (f) w.props.setState(p.id, f(p.state || {}));
        w.fxAll({ k: 'sparks', p: p.root.position.toArray(), n: 14 });
      }
      if (r.upgrade) {
        this.o.setState({ tier: Math.max(tier, r.upgrade) });
      } else if (r.out) {
        const big = !itemDef(r.out).pocket;
        const pos = big ? this._besidePos() : c.clone().add(_v.set(0, 0.25, 0));
        w.props.spawn(r.out, pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.o.root.rotation.y + (big ? 0 : 0.6), 0)), { state: { ...(r.state || {}), ...(big ? { maker: from } : {}) }, vel: new THREE.Vector3(0, big ? 0 : 1.2, 0) });
      }
      w.game.survival?.hostCrafted(r, from, tier);
    }, 1150);
  }

  // big results stand on the floor beside the bench (in front of it, clear of it)
  _besidePos() {
    const p = this.o.root;
    p.updateMatrixWorld(true);
    const wp = p.getWorldPosition(new THREE.Vector3());
    const f = _v.set(0, 0, 1).applyQuaternion(p.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
    return wp.addScaledVector(f, 1.1).setY((this.world.level?.floorY?.(wp.x, wp.z) ?? 0) + 0.4);
  }

  onState(s, quiet) {
    if (s.tier === undefined) return;
    this.o.setTier?.(s.tier);
    if (quiet) return;
    audio.play('bolt_turn', { pos: this.topCenter(_v), volume: 1 });
    floatText.notice(s.tier >= 3 ? 'The bench can do fine work now.' : 'The vise bites. The bench can hold metal now.', { duration: 3 });
  }

  update(dt) {
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.35;
      const l = this.world.game.local;
      if (l.pos && l.pos.distanceTo(this.o.root.getWorldPosition(_v)) < 7) this._scan();
      else { this.match = null; this.near = null; }
    }
    this._ghost(dt);
  }

  // the slowly turning ghost of what the parts will make
  _ghost(dt) {
    const want = this.match && !this.o.busy() ? (this.match.out || this.match.keep[0]) : null;
    if (want !== this.ghostType) {
      if (this.ghost) { this.ghost.removeFromParent(); this.ghost = null; }
      this.ghostType = want;
      if (want) {
        try {
          const o = buildModel(want, { seed: 1 }).object;
          o.traverse((c) => {
            if (!c.isMesh) return;
            c.castShadow = false; c.receiveShadow = false;
            c.material = new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false });
          });
          const size = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
          o.scale.setScalar(Math.min(1, 0.45 / Math.max(size.x, size.y, size.z, 0.05)));
          this.ghost = new THREE.Group();
          this.ghost.add(o);
          this.world.group.add(this.ghost);
          this.ghostT = 0;
        } catch (e) { this.ghost = null; }
      }
    }
    if (!this.ghost) return;
    this.ghostT += dt;
    const c = this.topCenter(_v);
    const k = Math.min(1, this.ghostT * 2);
    this.ghost.position.set(c.x, c.y + 0.42 + Math.sin(this.ghostT * 1.6) * 0.03, c.z);
    this.ghost.rotation.y = this.ghostT * 0.8;
    this.ghost.scale.setScalar(0.85 + 0.15 * k);
    this.ghost.traverse((m) => { if (m.isMesh) m.material.opacity = (0.38 + Math.sin(this.ghostT * 3) * 0.1) * k; });
  }

  dispose() { this.disposed = true; this.ghost?.removeFromParent(); this.ghost = null; }
}

// a bench prop (scrap_bench, field_bench)
function propBench(prop, world) {
  const spec = BENCHES[prop.type];
  const b = new Bench(world, {
    root: prop.root,
    top: prop.model.anchors?.top?.clone?.() || new THREE.Vector3(0, 0.85, 0),
    w: spec.w, d: spec.d, selfProp: prop,
    tier: () => prop.state.tier || itemDef(prop.type).bench || 1,
    busy: () => !!prop.state.busy,
    setState: (s) => world.props.setState(prop.id, s),
    send: (a, d) => net.toHost('act', { k: 'p', id: prop.id, a, d }),
    setTier: (n) => prop.model.object.userData.setTier?.(n),
  });
  return {
    prompt: () => b.prompt(), interact: () => b.interact(), hostAction: (a, d, from) => b.hostAction(a, d, from),
    onState: (s) => b.onState(s, false), update: (dt) => b.update(dt), dispose: () => b.dispose(), bench: b,
  };
}

// the heavy workbench standing in workshop rooms (a level device): a proper bench with a vise
export class DeviceBench extends ModelDevice {
  constructor(world, id, opts) {
    super(world, id, 'workbench', opts);
    this.state = { tier: 2, busy: 0 };
    const a = this.anchors.surfaceMin, z = this.anchors.surfaceMax;
    const top = a && z ? new THREE.Vector3((a.x + z.x) / 2, Math.max(a.y, z.y), (a.z + z.z) / 2) : new THREE.Vector3(0, 0.9, 0);
    this.bench = new Bench(world, {
      root: this.root, top, w: a && z ? Math.abs(z.x - a.x) : 1.4, d: a && z ? Math.abs(z.z - a.z) : 0.6,
      tier: () => this.state.tier || 2, busy: () => !!this.state.busy,
      setState: (s) => this.setState(s), send: (act, d) => this.send(act, d),
    });
    this.scr = this.screen('main', 256, 192, 'amber', 0.9);
    if (this.scr) this.scr.fps = 1;
  }
  prompt() { return this.bench.prompt(); }
  interact() { this.bench.interact(); }
  hostAction(a, d, from) { this.bench.hostAction(a, d, from); }
  onState(s, sync) { this.bench.onState(s, !!sync); }
  update(dt) {
    this.bench.update(dt);
    if (this.scr && this.nearLocal(6)) this.scr.draw(dt, (ctx, w, h, pal) => { ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, w, h); });
  }
  dispose() { this.bench.dispose(); super.dispose(); }
}
DEVICE_FACTORIES.workbench = (world, id, opts) => new DeviceBench(world, id, opts);

// every peer: the assembly — copies of the parts lift off the top, swirl in, spin, squash and pop
const assemblies = [];
export function playAssemble(world, m) {
  const c = new THREE.Vector3().fromArray(m.c);
  const parts = [];
  for (const pt of m.parts || []) {
    try {
      const mdl = buildModel(pt.t, { seed: 1 });
      const o = mdl.object;
      o.position.fromArray(pt.p);
      o.quaternion.fromArray(pt.q);
      o.traverse((x) => { if (x.isMesh) x.castShadow = false; });
      world.group.add(o);
      world.registerDynamic?.(o);
      parts.push({ o, from: o.position.clone(), q0: o.quaternion.clone(), spin: (Math.random() - 0.5) * 9, ph: Math.random() * 6 });
    } catch (e) { /* model missing */ }
  }
  assemblies.push({ world, c, parts, t: 0, fired: new Set() });
  audio.play('suit_rustle', { pos: c, volume: 0.5 });
}

export function updateAssemblies(dt) {
  for (let i = assemblies.length - 1; i >= 0; i--) {
    const A = assemblies[i];
    A.t += dt;
    const t = A.t, w = A.world;
    const once = (k, at, fn) => { if (t >= at && !A.fired.has(k)) { A.fired.add(k); fn(); } };
    const air = A.c.clone().setY(A.c.y + 0.3);
    A.parts.forEach((p, j) => {
      // lift (anticipation), then in toward the middle on a spiral, overshoot, settle
      const lift = Math.min(1, t / 0.25);
      const k = Math.max(0, Math.min(1, (t - 0.2 - j * 0.04) / 0.55));
      const e = k * k * (3 - 2 * k);
      const a = p.ph + e * 3.5;
      const r = (1 - e) * 0.18;
      p.o.position.lerpVectors(p.from, air, e).add(_v.set(Math.cos(a) * r, lift * 0.08 * (1 - e) + Math.sin(t * 12 + j) * 0.01, Math.sin(a) * r));
      p.o.rotation.y += p.spin * dt * (0.4 + e);
      const s = 1 - e * 0.65;
      p.o.scale.setScalar(Math.max(0.05, s));
    });
    once('tap1', 0.35, () => audio.play('thunk', { pos: A.c, volume: 0.6, pitch: 1.3 }));
    once('tap2', 0.6, () => audio.play('bolt_turn', { pos: A.c, volume: 0.7 }));
    once('tap3', 0.85, () => audio.play('craft', { pos: A.c, volume: 1 }));
    once('pop', 1.1, () => {
      for (const p of A.parts) { w.unregisterDynamic?.(p.o); p.o.removeFromParent(); }
      w.fx?.dustBurst?.(air, 18, [0.85, 0.78, 0.6], 0.9);
      w.fx?.sparks?.(air, 10, null, [1, 0.85, 0.5], 2.2);
      w.fx?.flashLight?.(air, 0xffd08a, 6, 0.18, 4);
      audio.play('fuse_insert', { pos: A.c, volume: 0.9 });
      const l = w.game?.local;
      if (l?.pos && l.pos.distanceTo(A.c) < 4) l.shake = Math.max(l.shake || 0, 0.12);
    });
    if (t > 1.2) assemblies.splice(i, 1);
  }
}

export function registerBenches(world) {
  for (const type of Object.keys(BENCHES)) world.props.registerBehaviour(type, (p, w) => propBench(p, w));
}
