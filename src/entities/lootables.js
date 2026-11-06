// Searchable furniture: drawers, cabinets, lockers, fridges, boxes, crates, suitcases, toolboxes, trash cans and
// vending machines can be searched once ([E]); breaking one apart (game/gather.js) spills it too. The host rolls the contents from a loot table, pops the items out
// in front of the container and marks it looted (prop.state.looted = n items, synced to everyone); the
// container's drawer / door part slides or swings open on every peer.
//
//   registerLootables(world)  -> register the behaviour for every CONTAINERS type (call once per world)
//   CONTAINERS[type]          -> { table, n: [min, max], part?, verb, locked? }
//   LOOT_TABLES[name]         -> [[itemType, weight], ...]
//   prop.state overrides (set at spawn by world/levels/yellow/biome.js): table, extra (more items: far out, off
//   the beaten path); state.locked = 1 for a locked container until it is opened ('unlock' host action)
//   level.mission.lootBonus(pos) -> extra items for containers far from where you woke up
import * as THREE from 'three';
import { net } from '../net/net.js';
import { input } from '../core/input.js';
import { RNG, hash3 } from '../core/rng.js';
import { ITEM, itemName } from '../game/itemdefs.js';

export const LOOT_TABLES = {
  office: [['protein_bar', 3], ['chips', 3], ['candy_bar', 3], ['soda_can', 3], ['painkillers', 1.5], ['battery', 3], ['tape_roll', 2.5], ['screws', 2], ['wire_spool', 1.5], ['bandage', 1.5], ['almond_water', 1.5], ['energy_drink', 1.5], ['glowstick', 1], ['lighter', 0.8], ['bottle', 1.2], ['glass_shard', 0.8]],
  kitchen: [['canned_food', 4], ['soda_can', 4], ['almond_water', 3], ['almond_milk', 2.5], ['protein_bar', 2], ['chips', 2], ['candy_bar', 2], ['energy_drink', 2], ['paper_cup', 1], ['bottle', 2], ['water_clean', 1], ['lighter', 0.6]],
  bedroom: [['painkillers', 2], ['bandage', 2.5], ['almond_water', 2], ['candy_bar', 2], ['battery', 1.5], ['fabric_scrap', 3.5], ['foam', 1.5], ['glowstick', 1.2], ['lighter', 1], ['flare', 0.6], ['antibiotics', 0.5], ['canned_food', 1], ['plasma_syringe', 0.5]],
  locker: [['bandage', 2], ['energy_drink', 2], ['protein_bar', 2], ['fabric_scrap', 2], ['battery', 2], ['flashlight', 0.7], ['glowstick', 1.5], ['flare', 1], ['medkit', 0.5], ['painkillers', 1.2], ['almond_water', 1.5], ['plasma_syringe', 0.6], ['tape_roll', 1]],
  tools: [['screws', 4], ['metal_scrap', 3], ['wire_spool', 3], ['tape_roll', 2.5], ['pipe_short', 2], ['gear', 2], ['battery', 2], ['plank', 2], ['flare', 1], ['wrench', 0.6], ['crowbar', 0.3], ['wheel', 1.6], ['lighter', 0.6], ['radio_antenna', 0.25], ['radio_battery', 0.2]],
  storage: [['plank', 3], ['fabric_scrap', 3], ['screws', 2], ['canned_food', 2], ['almond_water', 2], ['battery', 1.5], ['metal_scrap', 2], ['wire_spool', 1], ['tape_roll', 1.5], ['glowstick', 0.8], ['protein_bar', 1], ['wheel', 1], ['foam', 1], ['stick', 1.5], ['bottle', 1]],
  snacks: [['chips', 4], ['candy_bar', 4], ['protein_bar', 2]],
  drinks: [['soda_can', 5], ['energy_drink', 3], ['almond_water', 2]],
  trash: [['paper_cup', 2], ['soda_can', 1], ['chips', 1], ['metal_scrap', 1], ['fabric_scrap', 1], ['battery', 0.5], ['bottle', 2], ['glass_shard', 1], ['stick', 0.6]],
  medical: [['bandage', 4], ['painkillers', 3], ['antibiotics', 1.5], ['medkit', 1], ['splint', 1.5], ['almond_water', 1], ['plasma_syringe', 2.5]],
  // abandoned camps of earlier clones and the supply crates they left (world/levels/yellow/biome.js)
  camp: [['battery', 3], ['canned_food', 3], ['almond_water', 2.5], ['flare', 1.5], ['glowstick', 1.5], ['tape_roll', 2], ['screws', 2], ['metal_scrap', 2], ['wire_spool', 1.5], ['bandage', 2], ['wheel', 1.5], ['fungus_shelf', 1], ['wrench', 0.6], ['crowbar', 0.4], ['flashlight', 0.6], ['lighter', 1], ['torch', 0.8], ['water_clean', 1], ['rag_bandage', 1], ['radio_antenna', 0.2], ['radio_coil', 0.1]],
  // things worth finding (game/explore.js): stashes in dead ends, crawlspaces, boarded rooms, strange rooms. Tools
  // you cannot make are found here, and the best of them in the locked footlockers (a pry bar opens those)
  cache: [['knife', 2], ['saw', 1.6], ['bat', 1.4], ['machete', 0.7], ['hard_hat', 1.2], ['crowbar', 1.2], ['wrench', 1], ['noise_maker', 0.8], ['lighter', 2], ['torch', 1.4], ['flare', 1.6], ['flashlight', 1], ['battery', 2.5], ['medkit', 1], ['bandage', 2], ['canned_food', 2.5], ['almond_water', 2.5], ['water_clean', 1.5], ['wire_spool', 1.5], ['gear', 1.2], ['tape_roll', 1.2], ['insulation', 0.8], ['radio_antenna', 0.5], ['radio_battery', 0.5], ['radio_coil', 0.3]],
  vault: [['lantern', 2], ['hatchet', 1.4], ['backpack', 1.4], ['padded_vest', 1.2], ['hard_hat', 1], ['crossbow', 0.5], ['bolt_bundle', 0.8], ['machete', 1], ['medkit', 1.5], ['radio_coil', 1.2], ['radio_amp', 0.8], ['radio_battery', 1], ['radio_antenna', 0.8], ['distorter', 0.25], ['plasma_syringe', 1], ['canned_food', 1.5], ['almond_water', 1.5], ['battery', 1.5], ['flare', 1]],
  supply: [['battery', 3], ['medkit', 1.5], ['bandage', 2.5], ['canned_food', 3], ['almond_water', 3], ['flare', 2], ['wheel', 2], ['welder', 0.6], ['flashlight', 1], ['painkillers', 1.5], ['energy_drink', 1.5], ['tape_roll', 2], ['bottle', 1], ['radio_battery', 0.4], ['radio_coil', 0.15], ['radio_amp', 0.06]],
};

// part: animated sub-mesh that opens (furniture 'drawer0' slides along z, 'door' swings about y; device lockers /
// fridges: parts.door with params.doorOpenSign). n: [min, max] items (0 = sometimes empty)
export const CONTAINERS = {
  filing_cabinet: { table: 'office', n: [0, 2], part: 'drawer0', verb: 'Search' },
  desk: { table: 'office', n: [0, 2], part: 'drawer0', verb: 'Search' },
  dresser: { table: 'bedroom', n: [1, 3], part: 'drawer0', verb: 'Search' },
  nightstand: { table: 'bedroom', n: [0, 2], part: 'drawer0', verb: 'Search' },
  cabinet_low: { table: 'office', n: [1, 3], part: 'door', verb: 'Search' },
  locker: { table: 'locker', n: [1, 2], part: 'door', verb: 'Open' },
  fridge: { table: 'kitchen', n: [2, 4], part: 'door', verb: 'Open' },
  microwave: { table: 'kitchen', n: [0, 1], part: 'door', verb: 'Open' },
  toolbox: { table: 'tools', n: [2, 3], verb: 'Open' },
  box_small: { table: 'storage', n: [0, 1], verb: 'Open' },
  box_medium: { table: 'storage', n: [0, 2], verb: 'Open' },
  box_large: { table: 'storage', n: [1, 2], verb: 'Open' },
  crate_wood: { table: 'tools', n: [1, 3], verb: 'Pry open' },
  suitcase: { table: 'bedroom', n: [1, 2], verb: 'Open' },
  trash_can: { table: 'trash', n: [0, 1], verb: 'Dig through' },
  vending_snack: { table: 'snacks', n: [1, 3], verb: 'Shake' },
  vending_drink: { table: 'drinks', n: [1, 3], verb: 'Shake' },
  photocopier: { table: 'office', n: [0, 1], verb: 'Search' },
  water_cooler: { table: 'kitchen', n: [0, 1], verb: 'Search' },
  supply_box: { table: 'supply', n: [2, 4], verb: 'Pry open' },
  sleeping_bag: { table: 'camp', n: [0, 2], verb: 'Search' },
  tent_ruin: { table: 'camp', n: [1, 3], verb: 'Search' },
  stash_bag: { table: 'cache', n: [2, 3], verb: 'Unzip' },
  // locked: [E] only says what opens it; swinging a pry bar / hatchet at it (game/gather.js) unlocks and spills it
  locked_cache: { table: 'vault', n: [2, 3], part: 'lid', verb: 'Open', locked: true },
};

const SND = { drawer0: 'scrape_short', door: 'door_creak', box: 'paper', crate: 'dismantle', vend: 'vending_drop', trash: 'paper' };
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

class LootBehaviour {
  constructor(prop, world, spec) {
    this.prop = prop;
    this.world = world;
    this.spec = spec;
    this.anim = prop.state.looted !== undefined ? 1 : 0;
    this.mine = false;
    const P = prop.model.parts || {};
    this.partObj = spec.part ? P[spec.part] || null : null;
    if (this.partObj && !this.partObj.userData.rest) this.partObj.userData.rest = this.partObj.position.clone();
    this.doorSign = prop.model.params?.doorOpenSign ?? (this.partObj?.userData.maxOpen < 0 ? -1 : 1);
  }

  get locked() { return !!this.spec.locked && this.prop.state.locked !== 0; }

  prompt() {
    if (this.prop.state.looted !== undefined) return null;
    if (this.locked) return `${itemName(this.prop.type)}: padlocked. Swing a pry bar at the lock`;
    return `[${input.keyName('interact')}] ${this.spec.verb} ${itemName(this.prop.type)}`;
  }

  interact() {
    if (this.locked) {
      this.world.game?.ui?.toast?.('Padlocked. A pry bar would have it open in a couple of swings (a hatchet too).');
      return;
    }
    this.mine = true;
    net.toHost('act', { k: 'p', id: this.prop.id, a: 'loot' });
  }

  hostAction(a) {
    if (a === 'unlock') {
      if (!this.locked) return;
      this.world.props.setState(this.prop.id, { locked: 0 });
      this.prop.state.locked = 0;
      a = 'loot';
    }
    if (a !== 'loot' || this.prop.state.looted !== undefined || this.locked) return;
    const p = this.prop, w = this.world;
    // deterministic per container (a re-joining host rolls the same) but varied by id
    const rng = new RNG(hash3(p.id, p.type.length, 9137, (w.level?.seed ?? 1) | 0));
    let items;
    const def = ITEM[p.type];
    if (p.type === 'toolbox' && Array.isArray(def?.container)) items = rng.shuffle(def.container.slice()).slice(0, rng.int(1, 3));
    else {
      const [lo, hi] = this.spec.n;
      // far from where you woke up, and off the beaten path, there is more to find
      let bonus = 0;
      try { bonus = w.level?.mission?.lootBonus?.(p.root.position, rng) || 0; } catch (e) { bonus = 0; }
      const n = rng.int(lo, hi) + (p.state.extra | 0) + bonus;
      const table = LOOT_TABLES[p.state.table] || LOOT_TABLES[this.spec.table] || LOOT_TABLES.storage;
      items = [];
      for (let k = 0; k < n; k++) items.push(rng.weighted(table));
    }
    w.props.setState(p.id, { looted: items.length });
    // pop the items out of the container's front (+z), a little above its middle
    const r = p.root;
    const b = p.bounds;
    const front = b ? b.max.z + 0.12 : 0.35;
    const up = b ? Math.min(b.max.y, 0.9) : 0.4;
    items.forEach((t, i) => {
      const lx = (i - (items.length - 1) / 2) * 0.16;
      _v.set(lx, up * 0.6, front).applyQuaternion(r.quaternion).add(r.position);
      if (_v.y < 0.15) _v.y = 0.15;
      const dir = new THREE.Vector3(lx * 0.8, 0, 1).applyQuaternion(r.quaternion);
      dir.y = 0; dir.normalize();
      w.props.spawn(t, _v.clone(), _q.setFromEuler(_e.set(rng.next(), rng.next() * 6.28, 0)).clone(), {
        vel: new THREE.Vector3(dir.x * 1.1, 1.6 + rng.next() * 0.8, dir.z * 1.1),
        state: t === 'flashlight' ? { charge: 0.6 } : {},
      });
    });
    const kind = this.spec.part === 'drawer0' ? 'drawer0' : this.spec.part === 'door' ? 'door' : p.type.startsWith('box_') ? 'box' : p.type === 'crate_wood' || p.type === 'supply_box' || p.type === 'locked_cache' ? 'crate' : p.type.startsWith('vending') ? 'vend' : 'trash';
    w.fxAll({ k: 'snd', n: SND[kind] || 'paper', p: r.position.toArray(), v: 0.8 });
    if (kind === 'box' || kind === 'crate') w.fxAll({ k: 'dust', p: r.position.toArray(), n: 8 });
    w.noise?.emit?.(r.position, 4, 'loot');
  }

  onState(s) {
    if (s.looted === undefined || !this.mine) return;
    this.mine = false;
    const ui = this.world.game?.ui;
    if (s.looted === 0) ui?.toast?.(`${itemName(this.prop.type)}: nothing useful.`);
  }

  update(dt) {
    if (this.spec.locked) this.prop.model.object.userData.setLocked?.(this.locked);
    const target = this.prop.state.looted !== undefined ? 1 : 0;
    if (Math.abs(target - this.anim) < 0.002) return;
    this.anim += (target - this.anim) * Math.min(1, dt * 5);
    const o = this.partObj;
    if (!o) return;
    const ud = o.userData;
    if (ud.axis === 'x') o.rotation.x = (ud.maxOpen ?? -1.6) * this.anim;
    else if (ud.axis === 'z' || this.spec.part === 'drawer0') o.position.z = ud.rest.z + (ud.maxOpen ?? 0.3) * this.anim;
    else if (ud.axis === 'y' && ud.maxOpen !== undefined) o.rotation.y = ud.maxOpen * this.anim;
    else o.rotation.y = this.doorSign * 1.7 * this.anim; // device doors (lockers, fridges)
  }
}

export function registerLootables(world) {
  for (const [type, spec] of Object.entries(CONTAINERS)) {
    world.props.registerBehaviour(type, (p, w) => new LootBehaviour(p, w, spec));
  }
}
