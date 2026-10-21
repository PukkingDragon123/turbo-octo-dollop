// Searchable furniture: drawers, cabinets, lockers, fridges, boxes, crates, suitcases, toolboxes, trash cans and
// vending machines can be searched once ([E]). The host rolls the contents from a loot table, pops the items out
// in front of the container and marks it looted (prop.state.looted = n items, synced to everyone); the
// container's drawer / door part slides or swings open on every peer.
//
//   registerLootables(world)  -> register the behaviour for every CONTAINERS type (call once per world)
//   CONTAINERS[type]          -> { table, n: [min, max], part?, verb }
//   LOOT_TABLES[name]         -> [[itemType, weight], ...]
import * as THREE from 'three';
import { net } from '../net/net.js';
import { input } from '../core/input.js';
import { RNG, hash3 } from '../core/rng.js';
import { ITEM, itemName } from '../game/itemdefs.js';

export const LOOT_TABLES = {
  office: [['protein_bar', 3], ['chips', 3], ['candy_bar', 3], ['soda_can', 3], ['painkillers', 1.5], ['battery', 3], ['tape_roll', 2], ['screws', 2], ['wire_spool', 1.5], ['bandage', 1.5], ['almond_water', 1.5], ['energy_drink', 1.5], ['glowstick', 1], ['lighter', 0.6]],
  kitchen: [['canned_food', 4], ['soda_can', 4], ['almond_water', 3], ['almond_milk', 2.5], ['protein_bar', 2], ['chips', 2], ['candy_bar', 2], ['energy_drink', 2], ['paper_cup', 1]],
  bedroom: [['painkillers', 2], ['bandage', 2.5], ['almond_water', 2], ['candy_bar', 2], ['battery', 1.5], ['fabric_scrap', 3], ['glowstick', 1.2], ['lighter', 1], ['flare', 0.6], ['antibiotics', 0.5], ['canned_food', 1]],
  locker: [['bandage', 2], ['energy_drink', 2], ['protein_bar', 2], ['fabric_scrap', 2], ['battery', 2], ['flashlight', 0.7], ['glowstick', 1.5], ['flare', 1], ['medkit', 0.5], ['painkillers', 1.2], ['almond_water', 1.5]],
  tools: [['screws', 4], ['metal_scrap', 3], ['wire_spool', 3], ['tape_roll', 2], ['pipe_short', 2], ['gear', 2], ['battery', 2], ['plank', 2], ['flare', 1], ['wrench', 0.6], ['crowbar', 0.4]],
  storage: [['plank', 3], ['fabric_scrap', 3], ['screws', 2], ['canned_food', 2], ['almond_water', 2], ['battery', 1.5], ['metal_scrap', 2], ['wire_spool', 1], ['tape_roll', 1], ['glowstick', 0.8], ['protein_bar', 1]],
  snacks: [['chips', 4], ['candy_bar', 4], ['protein_bar', 2]],
  drinks: [['soda_can', 5], ['energy_drink', 3], ['almond_water', 2]],
  trash: [['paper_cup', 3], ['soda_can', 1], ['chips', 1], ['metal_scrap', 1], ['fabric_scrap', 1], ['battery', 0.5]],
  medical: [['bandage', 4], ['painkillers', 3], ['antibiotics', 1.5], ['medkit', 1], ['splint', 1.5], ['almond_water', 1]],
  // abandoned camps of earlier clones / R.O.O.M. field supply crates (world/levels/yellow/biome.js)
  camp: [['battery', 3], ['canned_food', 3], ['almond_water', 2.5], ['flare', 1.5], ['glowstick', 1.5], ['tape_roll', 2], ['screws', 2], ['metal_scrap', 2], ['wire_spool', 1.5], ['bandage', 2], ['wheel', 1.5], ['fungus_shelf', 1], ['wrench', 0.6], ['crowbar', 0.5], ['flashlight', 0.6], ['lighter', 0.8]],
  supply: [['battery', 3], ['medkit', 1.5], ['bandage', 2.5], ['canned_food', 3], ['almond_water', 3], ['flare', 2], ['wheel', 2], ['welder', 0.6], ['flashlight', 1], ['painkillers', 1.5], ['energy_drink', 1.5], ['tape_roll', 1.5]],
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

  prompt() {
    if (this.prop.state.looted !== undefined) return null;
    return `[${input.keyName('interact')}] ${this.spec.verb} ${itemName(this.prop.type)}`;
  }

  interact() {
    this.mine = true;
    net.toHost('act', { k: 'p', id: this.prop.id, a: 'loot' });
  }

  hostAction(a) {
    if (a !== 'loot' || this.prop.state.looted !== undefined) return;
    const p = this.prop, w = this.world;
    // deterministic per container (a re-joining host rolls the same) but varied by id
    const rng = new RNG(hash3(p.id, p.type.length, 9137, (w.level?.seed ?? 1) | 0));
    let items;
    const def = ITEM[p.type];
    if (p.type === 'toolbox' && Array.isArray(def?.container)) items = rng.shuffle(def.container.slice()).slice(0, rng.int(1, 3));
    else {
      const [lo, hi] = this.spec.n;
      const n = rng.int(lo, hi);
      const table = LOOT_TABLES[this.spec.table] || LOOT_TABLES.storage;
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
    const kind = this.spec.part === 'drawer0' ? 'drawer0' : this.spec.part === 'door' ? 'door' : p.type.startsWith('box_') ? 'box' : p.type === 'crate_wood' || p.type === 'supply_box' ? 'crate' : p.type.startsWith('vending') ? 'vend' : 'trash';
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
    const target = this.prop.state.looted !== undefined ? 1 : 0;
    if (Math.abs(target - this.anim) < 0.002) return;
    this.anim += (target - this.anim) * Math.min(1, dt * 5);
    const o = this.partObj;
    if (!o) return;
    const ud = o.userData;
    if (ud.axis === 'z' || this.spec.part === 'drawer0') o.position.z = ud.rest.z + (ud.maxOpen ?? 0.3) * this.anim;
    else if (ud.axis === 'y' && ud.maxOpen !== undefined) o.rotation.y = ud.maxOpen * this.anim;
    else o.rotation.y = this.doorSign * 1.7 * this.anim; // device doors (lockers, fridges)
  }
}

export function registerLootables(world) {
  for (const [type, spec] of Object.entries(CONTAINERS)) {
    world.props.registerBehaviour(type, (p, w) => new LootBehaviour(p, w, spec));
  }
}
