// Economy & progression for the camp loop (Level 0 and any level whose mission builds an Economy).
// Host authoritative; everything lives in game.run and replicates with game.pushRun():
//   run.credits   spendable money (purchases, re-clone cost)   run.escape  total delivered this level (escape fund)
//   run.unlocks   { 'term:quest', 'term:shop', 'shop:<cat>', 'app:<id>', 'up:<id>': 1 }
//   run.quests    { nodeId: 1 ready | 2 claimed }              run.counters { eat, crush, files, gens, scan, ... }
//   run.scans     { kind: 1 } things studied with the watch SCANNER this level
// Data (read by the terminals, the watch and the FACTORY-MENU trophy wall):
//   LEVEL_RULES, levelRules(type), SECTIONS, QUEST_TREES, SHOP_CATS, SHOP, WATCH_APPS, fmt$(n)
// Economy (one per CampMission): state(node), progress(node), has(key), appInstalled(id), identify(hit),
//   host: bump(c), hostTick, hostClaim, hostBuy, hostScan, hostDelivered; per peer: weapons, armour, upgrades.
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { net } from '../net/net.js';
import { audio } from '../audio/audio.js';
import { input } from '../core/input.js';
import { ITEM, ECON, itemDef, itemName, sellValue } from './itemdefs.js';

// ---------------------------------------------------------------------------------------------- levels
// quota: the escape fund that opens the exit; priceMul scales every crusher payout (and the shop's sense of money)
export const LEVEL_RULES = {
  yellow: {
    key: 'yellow', name: 'LEVEL 0', title: 'THE YELLOW ROOMS', quota: 1000000, priceMul: 30, tree: 'yellow', files: 6, gens: 3, next: 'poolrooms',
    hazards: ['THE BACTERIA', 'STILL LIVES', 'DAY 7 COLLAPSE'],
    rules: ['Furniture is money: feed the crusher', 'Day 1 is a safe probation day', 'Re-cloning costs half your credits'],
  },
  poolrooms: {
    key: 'poolrooms', name: 'LEVEL 37', title: 'THE POOLROOMS', quota: 2500000, priceMul: 45, tree: 'poolrooms', files: 4, gens: 2, next: 'grasslands',
    hazards: ['DEEP WATER', 'OXYGEN', 'THE GOLDFISH', 'LEECHES'],
    rules: ['Swimming drains oxygen', 'Contaminated water infects', 'Punt the raft forward'],
  },
  grasslands: {
    key: 'grasslands', name: 'LEVEL 1-G', title: 'THE GRASSLANDS', quota: 5000000, priceMul: 60, tree: 'grasslands', files: 5, gens: 3, next: null,
    hazards: ['OPEN SKY', 'HOUNDS', 'NIGHTFALL'],
    rules: ['No walls to hide behind', 'Hounds hunt in packs', 'Nights are long'],
  },
};
export function levelRules(type) { return LEVEL_RULES[type] || LEVEL_RULES.yellow; }

export function fmt$(n) { return '$' + Math.round(n || 0).toLocaleString('en-US'); }
// compact money for small screens: $12.4K, $1.2M
export function short$(n) {
  n = Math.round(n || 0);
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e7 ? 0 : 2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1e4) return '$' + (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return '$' + n.toLocaleString('en-US');
}

// ---------------------------------------------------------------------------------------------- quest tree
export const SECTIONS = [
  { id: 'SURVIVAL', col: 0, color: '#9dff5a', icon: 'heart' },
  { id: 'SALVAGE', col: 1, color: '#ffd060', icon: 'coin' },
  { id: 'COMBAT', col: 2, color: '#ff6a4a', icon: 'blade' },
  { id: 'RESEARCH', col: 3, color: '#7ad8ff', icon: 'scan' },
  { id: 'TOOLS', col: 4, color: '#e09aff', icon: 'gear' },
];
export const MAIN_COLOR = '#ffffff';

// node: { id, sec, short (node label), name, desc, task (watch / receipt line), req, deps, reward, x, y, auto, hard }
//   req: { c: counter, n } | { all: [{ c, n, label }] }, optional noDeath (fails once anyone was re-cloned)
//   reward: { credits, unlock: [keys], ach: achievement id (profile.js) }
const Q = (o) => ({ deps: [], reward: {}, ...o });
export const QUEST_TREES = {
  yellow: [
    // ---- MAIN MISSION 1 (auto-claimed: the camp loop drives it)
    Q({ id: 'm_base', sec: 'MAIN', short: 'BUILD BASE', name: 'CONSTRUCT A BASE', desc: 'Open the TENT KIT and attach every part with your multitool.', task: 'Construct a base (tent kit)', req: { c: 'built', n: 1 }, reward: { unlock: ['term:quest', 'app:map'] }, x: 0, y: 0, auto: true }),
    Q({ id: 'm_food', sec: 'MAIN', short: 'GET FOOD', name: 'GET FOOD', desc: 'Eat or drink something before you faint on company time.', task: 'Get food (eat or drink)', req: { c: 'eat', n: 1 }, deps: ['m_base'], reward: { credits: 250, unlock: ['app:scanner'] }, x: 1, y: 0, auto: true }),
    Q({ id: 'm_cash', sec: 'MAIN', short: 'EARN $1K', name: 'EARN $1,000', desc: 'Drop loot in the CRUSHER and hit the button. Value uploads to your watch.', task: 'Earn $1,000 at the crusher', req: { c: 'escape', n: 1000 }, deps: ['m_food'], reward: { unlock: ['term:shop', 'shop:basic', 'shop:apps'] }, x: 2, y: 0, auto: true }),
    Q({ id: 'm_escape', sec: 'MAIN', short: 'ESCAPE $1M', name: 'FILL THE ESCAPE FUND', desc: 'Deliver $1,000,000 in total. The exit opens when the gauge on the crusher is full.', task: 'Fill the escape fund', req: { c: 'escape', n: 'quota' }, deps: ['m_cash'], reward: { ach: 'escape_fund' }, x: 4, y: 0, auto: true, hard: true }),
    // ---- SURVIVAL
    Q({ id: 's_rations', sec: 'SURVIVAL', short: 'RATIONS', name: 'RATIONS', desc: 'Eat or drink 4 times.', req: { c: 'eat', n: 4 }, deps: ['m_cash'], reward: { credits: 12000 }, x: 0, y: 1 }),
    Q({ id: 's_probation', sec: 'SURVIVAL', short: 'PROBATION', name: 'PROBATION OVER', desc: 'Survive into Day 2. Unlocks ARMOR in the company store.', req: { c: 'day', n: 2 }, deps: ['s_rations'], reward: { credits: 20000, unlock: ['shop:armor'] }, x: 0, y: 2 }),
    Q({ id: 's_medic', sec: 'SURVIVAL', short: 'FIELD MEDIC', name: 'FIELD MEDIC', desc: 'Patch yourself up twice (bandage, medkit, syringe).', req: { c: 'heal', n: 2 }, deps: ['s_probation', 'v_press'], reward: { credits: 25000 }, x: 0, y: 3 }),
    Q({ id: 's_iron', sec: 'SURVIVAL', short: 'IRONCLAD', name: 'IRONCLAD', desc: 'HARD: reach Day 5 without a single re-clone.', req: { c: 'day', n: 5, noDeath: true }, deps: ['s_medic'], reward: { credits: 150000, ach: 'ironclad' }, x: 0, y: 4, hard: true }),
    // ---- SALVAGE
    Q({ id: 'v_press', sec: 'SALVAGE', short: 'THE PRESS', name: 'INTO THE PRESS', desc: 'Crush 10 items in the crusher.', req: { c: 'crush', n: 10 }, deps: ['m_cash'], reward: { credits: 15000 }, x: 1, y: 1 }),
    Q({ id: 'v_office', sec: 'SALVAGE', short: 'CLEARANCE', name: 'OFFICE CLEARANCE', desc: 'HQ wants these delivered: 2 CRT monitors, 1 filing cabinet, 1 desk.', req: { all: [{ c: 'deliv_crt_monitor', n: 2, label: 'CRT MONITOR' }, { c: 'deliv_filing_cabinet', n: 1, label: 'FILING CABINET' }, { c: 'deliv_desk', n: 1, label: 'DESK' }] }, deps: ['v_press'], reward: { credits: 45000 }, x: 1, y: 2 }),
    Q({ id: 'v_six', sec: 'SALVAGE', short: 'SIX FIGURES', name: 'SIX FIGURES', desc: 'Deliver $100,000 in total. Unlocks UPGRADES in the store.', req: { c: 'escape', n: 100000 }, deps: ['v_office'], reward: { credits: 25000, unlock: ['shop:upgrades'] }, x: 1, y: 3 }),
    Q({ id: 'v_slam', sec: 'SALVAGE', short: 'BIG SLAM', name: 'BIG SLAM', desc: 'Crush 8 items in a single slam.', req: { c: 'combo', n: 8 }, deps: ['v_six'], reward: { credits: 60000 }, x: 1, y: 4 }),
    Q({ id: 'v_strip', sec: 'SALVAGE', short: 'LIQUIDATOR', name: 'ASSET STRIPPER', desc: 'HARD: deliver $500,000 in this level.', req: { c: 'escape', n: 500000 }, deps: ['v_slam'], reward: { credits: 100000, ach: 'asset_stripper' }, x: 1, y: 5, hard: true }),
    // ---- COMBAT
    Q({ id: 'c_defense', sec: 'COMBAT', short: 'DEFENSE', name: 'SELF DEFENSE', desc: 'Land 3 melee hits on anything. Unlocks WEAPONS in the store.', req: { c: 'swings', n: 3 }, deps: ['m_cash'], reward: { credits: 8000, unlock: ['shop:weapons'] }, x: 2, y: 1 }),
    Q({ id: 'c_pest', sec: 'COMBAT', short: 'PEST CTRL', name: 'PEST CONTROL', desc: 'Land 10 weapon hits on creatures.', req: { c: 'hits', n: 10 }, deps: ['c_defense'], reward: { credits: 35000 }, x: 2, y: 2 }),
    Q({ id: 'c_basher', sec: 'COMBAT', short: 'BASHER', name: 'BACTERIA BASHER', desc: 'HARD: stun the Bacteria 3 times.', req: { c: 'stuns', n: 3 }, deps: ['c_pest'], reward: { credits: 120000, ach: 'bacteria_basher' }, x: 2, y: 3, hard: true }),
    // ---- RESEARCH
    Q({ id: 'r_contact', sec: 'RESEARCH', short: 'CONTACT', name: 'FIRST CONTACT', desc: 'Study 4 different things with the watch SCANNER.', req: { c: 'scan', n: 4 }, deps: ['m_cash'], reward: { credits: 10000, unlock: ['app:radio'] }, x: 3, y: 1 }),
    Q({ id: 'r_paper', sec: 'RESEARCH', short: 'PAPER TRAIL', name: 'PAPER TRAIL', desc: 'Find 3 CASE FILES hidden in office rooms and feed them to the crusher.', req: { c: 'files', n: 3 }, deps: ['r_contact'], reward: { credits: 40000 }, x: 3, y: 2 }),
    Q({ id: 'r_bio', sec: 'RESEARCH', short: 'BIOLOGY', name: 'FIELD BIOLOGY', desc: 'Study 2 kinds of creature with the SCANNER.', req: { c: 'scan_mon', n: 2 }, deps: ['r_paper', 'c_pest'], reward: { credits: 50000 }, x: 3, y: 3 }),
    Q({ id: 'r_dossier', sec: 'RESEARCH', short: 'DOSSIER', name: 'COMPLETE DOSSIER', desc: 'HARD: recover all 6 case files and study 15 things.', req: { all: [{ c: 'files', n: 6, label: 'CASE FILES' }, { c: 'scan', n: 15, label: 'STUDIES' }] }, deps: ['r_bio'], reward: { credits: 200000, ach: 'dossier' }, x: 3, y: 4, hard: true }),
    // ---- TOOLS
    Q({ id: 't_store', sec: 'TOOLS', short: 'CUSTOMER', name: 'VALUED CUSTOMER', desc: 'Buy 2 things from the company store.', req: { c: 'buy', n: 2 }, deps: ['m_cash'], reward: { credits: 6000, unlock: ['app:flash'] }, x: 4, y: 1 }),
    Q({ id: 't_power', sec: 'TOOLS', short: 'POWER UP', name: 'POWER RESTORED', desc: 'Find a dead generator in the maze: tighten its bolts (multitool) and crank it.', req: { c: 'gens', n: 1 }, deps: ['t_store'], reward: { credits: 45000 }, x: 4, y: 2 }),
    Q({ id: 't_grid', sec: 'TOOLS', short: 'GRID', name: 'GRID RESTORED', desc: 'HARD: get all 3 maze generators running.', req: { c: 'gens', n: 3 }, deps: ['t_power'], reward: { credits: 150000, ach: 'grid_restored' }, x: 4, y: 3, hard: true }),
  ],
  // other dimensions (data only until their missions build an Economy)
  poolrooms: [
    Q({ id: 'm_base', sec: 'MAIN', short: 'RAFT CAMP', name: 'MOOR THE RAFT', desc: 'Tie the raft up and set up camp on the deck.', req: { c: 'built', n: 1 }, reward: { unlock: ['term:quest', 'app:map'] }, x: 0, y: 0, auto: true }),
    Q({ id: 'm_food', sec: 'MAIN', short: 'CLEAN WATER', name: 'FIND CLEAN WATER', desc: 'Drink water that the tester says is safe.', req: { c: 'eat', n: 1 }, deps: ['m_base'], reward: { unlock: ['app:scanner'] }, x: 1, y: 0, auto: true }),
    Q({ id: 'm_cash', sec: 'MAIN', short: 'EARN $5K', name: 'EARN $5,000', desc: 'Deliver salvage worth $5,000.', req: { c: 'escape', n: 5000 }, deps: ['m_food'], reward: { unlock: ['term:shop', 'shop:basic', 'shop:apps'] }, x: 2, y: 0, auto: true }),
    Q({ id: 'm_escape', sec: 'MAIN', short: 'ESCAPE', name: 'FILL THE ESCAPE FUND', desc: 'Deliver the level quota.', req: { c: 'escape', n: 'quota' }, deps: ['m_cash'], reward: {}, x: 4, y: 0, auto: true }),
    Q({ id: 's_oxygen', sec: 'SURVIVAL', short: 'DEEP DIVE', name: 'DEEP DIVE', desc: 'Swim 200 m without drowning.', req: { c: 'swim', n: 200 }, deps: ['m_cash'], reward: { credits: 30000 }, x: 0, y: 1 }),
    Q({ id: 'r_fish', sec: 'RESEARCH', short: 'BIG FISH', name: 'BIG FISH', desc: 'Study the goldfish.', req: { c: 'scan_mon', n: 1 }, deps: ['m_cash'], reward: { credits: 80000 }, x: 3, y: 1 }),
  ],
  grasslands: [
    Q({ id: 'm_base', sec: 'MAIN', short: 'CAMP', name: 'PITCH CAMP', desc: 'Pitch the tent before nightfall.', req: { c: 'built', n: 1 }, reward: { unlock: ['term:quest', 'app:map'] }, x: 0, y: 0, auto: true }),
    Q({ id: 'm_cash', sec: 'MAIN', short: 'EARN $10K', name: 'EARN $10,000', desc: 'Deliver salvage worth $10,000.', req: { c: 'escape', n: 10000 }, deps: ['m_base'], reward: { unlock: ['term:shop', 'shop:basic', 'shop:apps', 'app:scanner'] }, x: 1, y: 0, auto: true }),
    Q({ id: 'm_escape', sec: 'MAIN', short: 'ESCAPE', name: 'FILL THE ESCAPE FUND', desc: 'Deliver the level quota.', req: { c: 'escape', n: 'quota' }, deps: ['m_cash'], reward: {}, x: 4, y: 0, auto: true }),
  ],
};

// ---------------------------------------------------------------------------------------------- shop
export const SHOP_CATS = [
  { id: 'basic', name: 'BASIC', unlock: 'shop:basic', hint: 'EARN $1,000' },
  { id: 'weapons', name: 'WEAPONS', unlock: 'shop:weapons', hint: 'COMBAT: DEFENSE' },
  { id: 'armor', name: 'ARMOR', unlock: 'shop:armor', hint: 'SURVIVAL: PROBATION' },
  { id: 'upgrades', name: 'UPGRADES', unlock: 'shop:upgrades', hint: 'SALVAGE: SIX FIGURES' },
  { id: 'apps', name: 'APPS', unlock: 'shop:apps', hint: 'EARN $1,000' },
];
// stats: [[label, 0..1]]  info: one-line effect   req: quest node that must be claimed   app: watch app licence
// upgrade: team upgrade key (installed once)   model: display-case model when it differs from id
const S_ = (o) => ({ stats: [], ...o });
export const SHOP = [
  S_({ id: 'protein_bar', cat: 'basic', price: 300, info: 'Hunger +35, stamina +10', stats: [['FOOD', 0.35]] }),
  S_({ id: 'almond_water', cat: 'basic', price: 450, info: 'Thirst +50, calms the nerves', stats: [['WATER', 0.5], ['SANITY', 0.18]] }),
  S_({ id: 'canned_food', cat: 'basic', price: 700, info: 'Hunger +55. Do not ask what is in it.', stats: [['FOOD', 0.55]] }),
  S_({ id: 'bandage', cat: 'basic', price: 600, info: 'Stops light bleeding', stats: [['HEAL', 0.1]] }),
  S_({ id: 'flashlight', cat: 'basic', price: 1200, info: 'Spare torch, fully charged', stats: [['LIGHT', 0.7]] }),
  S_({ id: 'battery', cat: 'basic', price: 900, info: 'Recharges your flashlight', stats: [['POWER', 1]] }),
  S_({ id: 'glowstick', cat: 'basic', price: 500, info: 'Throwable 12-hour light', stats: [['LIGHT', 0.3]] }),
  S_({ id: 'flare', cat: 'basic', price: 1500, info: 'Monsters back away from it', stats: [['LIGHT', 0.9], ['SCARE', 0.8]] }),
  S_({ id: 'noise_maker', cat: 'basic', price: 2500, info: 'Arm it, throw it, run', stats: [['LURE', 0.8]] }),
  S_({ id: 'medkit', cat: 'basic', price: 4000, info: 'Health +45, stops heavy bleeding', stats: [['HEAL', 0.45]], req: 's_rations' }),
  S_({ id: 'plasma_syringe', cat: 'basic', price: 5000, info: 'Refills the heart plasma chamber', stats: [['HEAL', 0.35]], req: 's_medic' }),
  S_({ id: 'trolley', cat: 'basic', price: 9000, info: 'Four-wheel cart: haul furniture in bulk', stats: [['HAUL', 0.9]], req: 'v_press' }),
  S_({ id: 'distorter', cat: 'basic', price: 30000, info: '7 m field no monster can enter', stats: [['SAFETY', 1]], req: 's_probation' }),
  S_({ id: 'weapon_pipe', cat: 'weapons', price: 6000, info: 'Heavy, honest, galvanised', stats: [['DAMAGE', 0.33], ['REACH', 0.4], ['SPEED', 0.6]] }),
  S_({ id: 'bat', cat: 'weapons', price: 9500, info: 'Nails included. Knocks things back', stats: [['DAMAGE', 0.66], ['REACH', 0.45], ['SPEED', 0.45]] }),
  S_({ id: 'machete', cat: 'weapons', price: 18000, info: 'Fast, mean, three hits a swing', stats: [['DAMAGE', 1], ['REACH', 0.4], ['SPEED', 0.8]], req: 'c_pest' }),
  S_({ id: 'nailgun', cat: 'weapons', price: 42000, info: 'Pneumatic. 22 m range. Never point at coworkers', stats: [['DAMAGE', 0.66], ['REACH', 1], ['SPEED', 1]], req: 'c_pest' }),
  S_({ id: 'hard_hat', cat: 'armor', price: 8000, info: 'Wear it: -15% damage taken', stats: [['ARMOR', 0.15]] }),
  S_({ id: 'padded_vest', cat: 'armor', price: 20000, info: 'Wear it: -30% damage taken', stats: [['ARMOR', 0.3]] }),
  S_({ id: 'riot_shield', cat: 'armor', price: 32000, info: 'Hold it: -45% damage taken', stats: [['ARMOR', 0.45]], req: 's_medic' }),
  S_({ id: 'up_battery', cat: 'upgrades', upgrade: 'battery', price: 22000, info: 'Flashlight runtime x2 for the whole team', stats: [['POWER', 1]], req: 't_power' }),
  S_({ id: 'up_carry', cat: 'upgrades', upgrade: 'carry', price: 35000, info: 'Grab strength +60%: lift furniture alone', stats: [['STRENGTH', 0.6]], req: 't_power' }),
  S_({ id: 'up_sanity', cat: 'upgrades', upgrade: 'sanity', price: 25000, info: 'Psycho-acoustic field: sanity drains far slower', stats: [['SANITY', 0.7]] }),
  S_({ id: 'up_plasma', cat: 'upgrades', upgrade: 'plasma', price: 60000, info: 'Heart plasma reserve: slowly regenerates health', stats: [['REGEN', 0.5]], req: 'v_slam' }),
  S_({ id: 'app_map', cat: 'apps', app: 'map', model: 'keycard', price: 3000, info: 'Watch MAP: explored rooms, camp, crusher, exit' }),
  S_({ id: 'app_scanner', cat: 'apps', app: 'scanner', model: 'keycard', price: 2000, info: 'Watch SCANNER: study creatures, fungus and loot' }),
  S_({ id: 'app_radio', cat: 'apps', app: 'radio', model: 'radio_cassette', price: 6000, info: 'Watch RADIO: HQ log and the R.O.O.M. easy-listening band' }),
  S_({ id: 'app_flash', cat: 'apps', app: 'flash', model: 'flashlight', price: 15000, info: 'Watch FLASH+: overdrives your flashlight (+45% light)' }),
].filter((s) => ITEM[s.id] || s.app);
export const SHOP_BY_ID = Object.fromEntries(SHOP.map((s) => [s.id, s]));

// ---------------------------------------------------------------------------------------------- watch apps
export const WATCH_APPS = [
  { id: 'home', name: 'HOME', icon: 'home', builtin: true },
  { id: 'status', name: 'STATUS', icon: 'pulse', builtin: true },
  { id: 'tasks', name: 'TASKS', icon: 'task', builtin: true },
  { id: 'bank', name: 'BANK', icon: 'coin', builtin: true },
  { id: 'map', name: 'MAP', icon: 'map', via: 'BUILD BASE' },
  { id: 'scanner', name: 'SCANNER', icon: 'scan', via: 'GET FOOD' },
  { id: 'radio', name: 'RADIO', icon: 'radio', via: 'CONTACT' },
  { id: 'flash', name: 'FLASH+', icon: 'bolt', via: 'CUSTOMER' },
];

// research payout per studied kind (Level 0 prices; scaled by the level's priceMul / 30)
const SCAN_VALUE = { mon: 30000, critter: 5000, bio: 7000, obj: 1200, dev: 2500, file: 4000 };
const SCAN_TIME = { mon: 1.0, critter: 0.9, bio: 1.6, obj: 1.2, dev: 1.4, file: 1.0 };

const _f = new THREE.Vector3();
const _v = new THREE.Vector3();

// ---------------------------------------------------------------------------------------------- Economy
export class Economy {
  constructor(mission) {
    this.m = mission;
    this.game = mission.game;
    this.world = mission.world;
    this.rules = levelRules(this.world.type);
    ECON.priceMul = this.rules.priceMul;
    this.tree = QUEST_TREES[this.rules.tree] || QUEST_TREES.yellow;
    this.byId = Object.fromEntries(this.tree.map((n) => [n.id, n]));
    this.main = this.tree.filter((n) => n.sec === 'MAIN');
    this._ensureRun();
    this._t = 0;
    this._dirty = false;
    this._announced = new Set();
    this._lastSwing = 0;
    this.disposed = false;
    this._bindNet();
    this._installSwing();
    this._bindBehaviours();
  }

  get run() { return this.game.run; }

  _ensureRun() {
    const r = this.run;
    r.escape ??= 0;
    r.unlocks ??= {};
    r.quests ??= {};
    r.counters ??= {};
    r.scans ??= {};
  }

  // ------------------------------------------------------------------ queries (every peer)
  has(key) { return !!this.run.unlocks?.[key]; }
  appInstalled(id) { const a = WATCH_APPS.find((x) => x.id === id); return !!a && (a.builtin || this.has('app:' + id)); }
  get quota() { return this.rules.quota; }
  get escape() { return this.run.escape || 0; }
  mainDone() { return this.state(this.byId.m_cash) === 'claimed'; }

  count(c) {
    const r = this.run;
    if (c === 'escape') return r.escape || 0;
    if (c === 'credits') return r.credits || 0;
    if (c === 'day') return Math.max(r.counters?.day || 0, this.game.day?.day || 1);
    return r.counters?.[c] || 0;
  }

  _need(n) { return n === 'quota' ? this.quota : n; }

  // { have, need, frac, parts? }
  progress(node) {
    const q = node.req;
    if (!q) return { have: 1, need: 1, frac: 1 };
    if (q.all) {
      let h = 0, n = 0;
      const parts = q.all.map((p) => { const have = Math.min(this.count(p.c), p.n); h += have; n += p.n; return { label: p.label, have, need: p.n }; });
      return { have: h, need: n, frac: n ? h / n : 1, parts };
    }
    const need = this._need(q.n);
    let have = Math.min(this.count(q.c), need);
    if (q.noDeath && (this.run.deaths || 0) > 0) have = 0;
    return { have, need, frac: need ? have / need : 1, failed: q.noDeath && (this.run.deaths || 0) > 0 };
  }

  // 'claimed' | 'ready' | 'active' | 'locked'
  state(node) {
    if (!node) return 'locked';
    const q = this.run.quests?.[node.id];
    if (q === 2) return 'claimed';
    if (q === 1) return 'ready';
    for (const d of node.deps) if (this.run.quests?.[d] !== 2) return 'locked';
    return 'active';
  }

  // side quests worth showing on the watch / receipt: ready first, then active ones closest to done
  activeSide() {
    const out = this.tree.filter((n) => n.sec !== 'MAIN' && ['ready', 'active'].includes(this.state(n)));
    return out.sort((a, b) => (this.state(b) === 'ready') - (this.state(a) === 'ready') || this.progress(b).frac - this.progress(a).frac);
  }

  // shop item availability -> { ok, why }
  shopStatus(item) {
    const cat = SHOP_CATS.find((c) => c.id === item.cat);
    if (!cat || !this.has(cat.unlock)) return { ok: false, why: 'LOCKED', locked: true };
    if (item.req && this.state(this.byId[item.req]) !== 'claimed') return { ok: false, why: `NEEDS ${this.byId[item.req]?.short || 'QUEST'}`, locked: true };
    if (item.app && this.appInstalled(item.app)) return { ok: false, why: 'INSTALLED', owned: true };
    if (item.upgrade && this.has('up:' + item.upgrade)) return { ok: false, why: 'INSTALLED', owned: true };
    if ((this.run.credits || 0) < item.price) return { ok: false, why: 'NO FUNDS', poor: true };
    return { ok: true, why: '' };
  }

  // ------------------------------------------------------------------ host: counters & quests
  bump(c, n = 1) {
    if (!net.isHost) return;
    const k = this.run.counters;
    k[c] = (k[c] || 0) + n;
    this._dirty = true;
  }

  setMax(c, v) {
    if (!net.isHost) return;
    const k = this.run.counters;
    if ((k[c] || 0) < v) { k[c] = v; this._dirty = true; }
  }

  hostTick(dt) {
    this._t -= dt;
    if (this._t > 0) return;
    this._t = 0.5;
    this.setMax('day', this.game.day?.day || 1);
    for (const n of this.tree) {
      if (this.state(n) !== 'active' || this.progress(n).frac < 1) continue;
      this.run.quests[n.id] = 1;
      this._dirty = true;
      if (n.auto) this.hostClaim(n.id, null);
      else if (!this._announced.has(n.id)) {
        this._announced.add(n.id);
        this.m.hq(`QUEST COMPLETE: ${n.name}. Claim your reward at the MISSION TERMINAL in camp.`, 'FIELD OPS');
        this.world.fxAll({ k: 'crusher', e: 'questReady', id: n.id });
      }
    }
    if (this._dirty) { this._dirty = false; this.game.pushRun(); }
  }

  hostClaim(id, from) {
    const n = this.byId[id];
    if (!n || this.state(n) !== 'ready') { if (from) this._msg(from, 'Nothing to claim there yet.', 'warn'); return false; }
    this.run.quests[id] = 2;
    const r = n.reward || {};
    for (const k of r.unlock || []) this.run.unlocks[k] = 1;
    if (r.credits) this.game.addCredits(r.credits);
    if (r.ach) this.game.unlockAll(r.ach);
    this.game.pushRun();
    const parts = [];
    if (r.credits) parts.push(fmt$(r.credits));
    for (const k of r.unlock || []) parts.push(unlockLabel(k));
    if (!n.auto || parts.length) this.m.hq(`${n.sec === 'MAIN' ? 'MAIN MISSION' : 'QUEST'}: ${n.name} — ${parts.length ? parts.join(', ') : 'well done'}.`, 'FIELD OPS');
    this.world.fxAll({ k: 'crusher', e: 'claim', id, v: r.credits || 0, main: n.sec === 'MAIN' ? 1 : 0 });
    this.m.onQuestClaimed?.(n);
    this.game.saveRun?.('quest');
    return true;
  }

  // ------------------------------------------------------------------ host: shop
  hostBuy(id, from) {
    const item = SHOP_BY_ID[id];
    if (!item) return;
    const st = this.shopStatus(item);
    if (!st.ok) { this._msg(from, st.poor ? `Not enough credits for ${shopName(item)} (${fmt$(item.price)}).` : `${shopName(item)}: ${st.why}`, 'warn'); return; }
    this.run.credits -= item.price;
    this.bump('buy');
    if (item.app) {
      this.run.unlocks['app:' + item.app] = 1;
      this._msg(from, `${shopName(item)} INSTALLED on every team watch.`, 'good');
    } else {
      this.m.crusher?.hostDeliver(item.id);
      this._msg(from, `ORDER PLACED: ${shopName(item)}. It will materialise in the CRUSHER teleporter.`, 'good');
    }
    this._dirty = false;
    this.game.pushRun();
    this.game.saveRun?.('buy');
  }

  // ------------------------------------------------------------------ host: research
  hostScan(d, from) {
    const kind = String(d?.kind || '').slice(0, 40), cat = SCAN_VALUE[d?.cat] ? d.cat : 'obj';
    if (!kind) return;
    if (this.run.scans[kind]) { this._msg(from, `${d.label || 'Target'}: already in the research database.`, 'warn'); return; }
    this.run.scans[kind] = 1;
    this.bump('scan');
    if (cat === 'mon') this.bump('scan_mon');
    if (cat === 'bio') this.bump('scan_bio');
    const v = Math.round(SCAN_VALUE[cat] * this.rules.priceMul / 30);
    this.game.addCredits(v);
    this.world.fxAll({ k: 'crusher', e: 'scanned', v, label: String(d.label || kind).slice(0, 28), to: from });
    this.game.pushRun();
  }

  // crusher: items crushed in one slam -> [{ type, v }]; returns { total paid, combo multiplier }
  hostDelivered(list) {
    if (!list.length) return { total: 0, combo: 1 };
    let total = 0;
    for (const it of list) {
      total += it.v;
      this.bump('deliv_' + it.type);
      if (itemDef(it.type).quest === 'file') { this.bump('files'); this.m.sideq?.onFileDelivered(it.state); }
    }
    this.bump('crush', list.length);
    this.setMax('combo', list.length);
    // combo bonus: +6% per extra item in the same slam (max +60%)
    const combo = 1 + Math.min(0.6, (list.length - 1) * 0.06);
    total = Math.round(total * combo);
    this.game.addCredits(total);
    this.game.pushRun();
    return { total, combo };
  }

  _msg(to, text, kind = '') {
    if (!to) return;
    if (to === net.selfId) this._onMsg({ text, kind });
    else net.toPeer(to, 'econMsg', { text, kind });
  }

  _onMsg(d) {
    this.game.ui.toast(d.text, d.kind);
    audio.play(d.kind === 'good' ? 'ui_select' : 'ui_error', { volume: 0.4, bus: 'ui' });
  }

  // ------------------------------------------------------------------ net
  _bindNet() {
    net.onHost('econScan', (d, from) => this.hostScan(d, from));
    net.onHost('econHit', (d, from) => this._hostHit(d, from));
    net.onClient('econMsg', (d) => this._onMsg(d));
    net.onClient('econGear', (d) => this._wear(d.type));
  }

  // ------------------------------------------------------------------ armour & upgrade props ([E] wear / install)
  _bindBehaviours() {
    const props = this.world.props;
    for (const type of Object.keys(ITEM)) {
      const d = ITEM[type];
      if (!d.upgrade && !d.armor) continue;
      props.registerBehaviour(type, (p) => ({
        prompt: () => `[${input.keyName('interact')}] ${d.upgrade ? 'INSTALL' : 'WEAR'} ${d.name.toUpperCase()}`,
        interact: () => net.toHost('act', { k: 'p', id: p.id, a: 'install' }),
        hostAction: (a, _d, from) => { if (a === 'install') this._hostInstall(p, from); },
        onState() {},
        update() {},
      }));
    }
  }

  _hostInstall(p, from) {
    if (p.dead) return;
    const d = itemDef(p.type);
    const pos = p.root.position.toArray();
    this.world.grab.releaseAllFor(p.id);
    this.world.props.despawn(p.id, { k: 'crusher', e: 'install', p: pos });
    if (d.upgrade) {
      this.run.unlocks['up:' + d.upgrade] = 1;
      this.game.pushRun();
      this.m.hq(`UPGRADE INSTALLED: ${d.name}. Applied to every clone on the roster.`, 'R&D');
    } else if (d.armor) {
      if (from === net.selfId || !from) this._wear(p.type);
      else net.toPeer(from, 'econGear', { type: p.type });
    }
  }

  _wear(type) {
    const d = itemDef(type);
    if (!d.armor) return;
    const l = this.game.local;
    l.gear = l.gear || {};
    l.gear[d.armor.slot] = type;
    this.game.ui.toast(`${d.name.toUpperCase()} ON: -${Math.round((1 - d.armor.mul) * 100)}% damage`, 'good');
    audio.play('suit_rustle', { volume: 0.8, bus: 'ui' });
  }

  // ------------------------------------------------------------------ weapons
  // RMB with a weapon ('swing' items) is the weapon's own attack, using its stats (the nail gun fires): it wraps the
  // built-in swing and goes through the creature combat API (monsters.applyHit) when the level has one.
  // LMB punches / weapon swings are game/combat.js. Quest counters come from host-side wrappers on the creature
  // damage and prop-hit paths, so every kind of hit counts.
  _installSwing() {
    const tools = this.game.tools;
    if (!tools || tools._econSwing) return;
    const orig = tools._swing.bind(tools);
    tools._econSwing = true;
    tools._swing = (item, player) => {
      const econ = this.game.world?.level?.mission?.econ;
      if (!econ || econ.disposed) return orig(item, player);
      return econ._swing(item, player);
    };
    const origHit = tools._hostHit.bind(tools);
    tools._hostHit = (d, from) => {
      const econ = this.game.world?.level?.mission?.econ;
      if (econ && !econ.disposed && (d?.id != null || d?.mon != null)) econ.bump('swings');
      return origHit(d, from);
    };
  }

  // host: count damage dealt to creatures (game/creatures/combat.js)
  _wrapCreatureDamage() {
    const cmb = this.world.monsters?.combat;
    if (!net.isHost || !cmb?.damage || cmb._econWrapped) return;
    cmb._econWrapped = true;
    const orig = cmb.damage.bind(cmb);
    cmb.damage = (a, dmg, dir, o = {}) => {
      const alive = a && !a.dead;
      const r = orig(a, dmg, dir, o);
      const econ = this.game.world?.level?.mission?.econ;
      if (alive && o.from && econ && !econ.disposed) {
        econ.bump('hits');
        if (o.kind !== 'punch') econ.bump('swings');
        if (a.type === 'bacteria') econ.bump('stuns');
      }
      return r;
    };
  }

  _swing(item) {
    const tools = this.game.tools;
    const w = (item && itemDef(item.type).weapon) || { dmg: 1, range: 1.8, cd: 0.45, knock: 1 };
    const now = performance.now() / 1000;
    if (now - this._lastSwing < w.cd) return;
    this._lastSwing = now;
    const l = this.game.local, cam = engine.camera;
    _f.set(0, 0, -1).applyQuaternion(cam.quaternion);
    if (w.ranged) {
      audio.play('nailgun', { volume: 0.9 });
      l.arms.throwKick = 0.5;
      l.shake = Math.max(l.shake || 0, 0.08);
    } else {
      audio.play('throw_whoosh', { volume: 0.55, pitch: w.dmg > 1 ? 0.8 : 1 });
      l.arms.throwKick = 1;
    }
    const mon = this.world.monsters;
    if (mon?.applyHit) {
      let res = null;
      try { res = mon.applyHit({ origin: cam.position.clone(), dir: _f.clone(), range: w.range, damage: w.dmg * 16, from: net.selfId, kind: w.ranged ? 'nail' : 'weapon', heavy: w.dmg >= 2, radius: w.ranged ? 0.15 : 0.3 }); } catch (e) { console.error('[econ] applyHit', e); }
      if (res?.hit) {
        const pt = res.point?.isVector3 ? res.point : Array.isArray(res.point) ? _v.fromArray(res.point) : null;
        if (pt) { this.world.fx.sparks(pt, w.ranged ? 6 : 10, null, [0.8, 0.9, 0.5], 2.5); audio.play(w.ranged ? 'impact_metal' : 'punch_hit', { pos: pt, intensity: 0.8, volume: 0.7 }); }
        return;
      }
    }
    const hit = tools._aim(w.range);
    if (!hit) return;
    if (w.ranged) this.world.fx.sparks(hit.point, 8, null, [1, 0.85, 0.5], 2.5);
    const d = { p: hit.point.toArray(), d: _f.toArray() };
    if (hit.ud?.kind === 'prop') net.toHost('hit', { ...d, id: hit.ud.prop.id, f: Math.min(1.8, w.knock ?? 1), w: 1 });
    else if (hit.ud?.kind === 'monster' && !mon?.applyHit) net.toHost('econHit', { ...d, mon: hit.ud.monster.id, n: w.dmg });
    else audio.play('impact_metal', { pos: hit.point, intensity: 0.7 });
  }

  // host: fallback weapon hit on a level without the creature combat API
  _hostHit(d, from) {
    const w = this.world;
    if (d?.mon == null) return;
    const dir = new THREE.Vector3().fromArray(d.d || [0, 0, -1]);
    const a = w.monsters?.agents?.get?.(d.mon);
    const n = Math.max(1, Math.min(4, d.n | 0));
    for (let i = 0; i < n; i++) w.monsters?.hit(d.mon, dir, from);
    w.noise.emit(_v.fromArray(d.p), 12, 'hit');
    w.fxAll({ k: 'impact', m: 'flesh', p: d.p, i: 0.9 });
    this.bump('hits');
    this.bump('swings');
    if (a?.type === 'bacteria') this.bump('stuns');
  }

  // ------------------------------------------------------------------ SCANNER: what is the reticle on?
  // -> { kind, label, cat, info, time } | null
  identify(hit) {
    if (!hit) return null;
    const ud = hit.ud || {};
    if (ud.kind === 'monster' && ud.monster) {
      const t = ud.monster.type || 'entity';
      const NAMES = { bacteria: 'THE BACTERIA', stilllife: 'STILL LIFE', still_life: 'STILL LIFE', hound: 'HOUND', smiler: 'SMILER', partygoer: 'PARTYGOER', goldfish: 'GOLDFISH' };
      return { kind: 'mon_' + t, label: NAMES[t] || t.toUpperCase(), cat: 'mon', info: 'HOSTILE ENTITY', time: SCAN_TIME.mon };
    }
    if (ud.kind === 'critter') {
      const t = ud.critter?.type || ud.critter?.kind || 'rat';
      return { kind: 'critter_' + t, label: String(t).toUpperCase(), cat: 'critter', info: 'FAUNA', time: SCAN_TIME.critter };
    }
    if (ud.kind === 'prop' && ud.prop && !ud.prop.dead) {
      const p = ud.prop;
      if (p.type.startsWith('rag_')) return { kind: 'obj_clone', label: 'CLONE REMAINS', cat: 'obj', info: 'FORMER EMPLOYEE', time: SCAN_TIME.obj };
      const v = sellValue(p.type, p.mass, p.state);
      const quest = itemDef(p.type).quest === 'file';
      return { kind: 'obj_' + p.type, label: itemName(p.type).toUpperCase(), cat: quest ? 'file' : 'obj', info: v > 0 ? `APPRAISED ${short$(v)}` : 'NO RESALE VALUE', value: v, time: quest ? SCAN_TIME.file : SCAN_TIME.obj };
    }
    if (ud.kind === 'device' && ud.device) {
      const k = ud.device.kind || ud.device.key || ud.device.id;
      return { kind: 'dev_' + String(k).replace(/_\d+$/, ''), label: String(ud.device.label || k).toUpperCase().replace(/_/g, ' ').slice(0, 18), cat: 'dev', info: 'MACHINERY', time: SCAN_TIME.dev };
    }
    const sk = this.world.level?.sampleKindAt?.(hit);
    if (sk && sk !== 'rat') {
      const L = { black_mold: 'BLACK MOLD', carpet_fungus: 'CARPET FUNGUS', wallpaper_growth: 'WALLPAPER GROWTH', flood_water: 'ANOMALOUS WATER', infected_water: 'CONTAMINATED WATER', bacteria_residue: 'BACTERIA RESIDUE', still_life_tissue: 'STILL LIFE TISSUE' };
      return { kind: 'bio_' + sk, label: L[sk] || sk.toUpperCase().replace(/_/g, ' '), cat: 'bio', info: 'BIOLOGICAL SAMPLE', time: SCAN_TIME.bio };
    }
    return null;
  }

  studied(kind) { return !!this.run.scans?.[kind]; }
  scanValue(cat) { return Math.round((SCAN_VALUE[cat] || 0) * this.rules.priceMul / 30); }
  requestScan(t) { net.toHost('econScan', { kind: t.kind, label: t.label, cat: t.cat }); }

  // ------------------------------------------------------------------ per-peer effects
  armorMul() {
    const l = this.game.local;
    let m = 1;
    for (const k in l.gear || {}) m *= itemDef(l.gear[k]).armor?.mul ?? 1;
    const cur = l.inv?.current;
    if (cur && itemDef(cur.type).shield) m *= itemDef(cur.type).shield;
    return m;
  }

  update(dt) {
    const g = this.game, l = g.local, w = this.world;
    w.carryMul = this.has('up:carry') ? 1.6 : 1;
    if (net.isHost) this._wrapCreatureDamage();
    const sv = l.survival;
    if (sv && !sv._econWrapped) {
      const orig = sv.damage.bind(sv);
      sv.damage = (a, kind, o) => {
        const e = g.world?.level?.mission?.econ;
        return orig(e && !e.disposed ? a * e.armorMul() : a, kind, o);
      };
      sv._econWrapped = true;
    }
    if (l.dead || !sv) return;
    if (this.has('up:battery') && l.flashOn) {
      const fi = l.inv.find('flashlight');
      if (fi >= 0) { const st = l.inv.slots[fi].state; st.charge = Math.min(1, (st.charge ?? 1) + dt / (18 * 60)); }
    }
    if (this.has('up:sanity')) sv.sanity = Math.min(100, (sv.sanity ?? 100) + dt * 0.12);
    if (this.has('up:plasma') && sv.health < 100 && (sv.time - (sv.lastDamage ?? -99)) > 5) sv.health = Math.min(100, sv.health + dt * 0.35);
    if (this.appInstalled('flash') && l.flashOn && l.flashlight) l.flashlight.intensity *= 1.45;
  }

  dispose() {
    this.disposed = true;
    ECON.priceMul = 1;
    this.world.carryMul = 1;
    net.hostHandlers.delete('econScan');
    net.hostHandlers.delete('econHit');
    net.clientHandlers.delete('econMsg');
    net.clientHandlers.delete('econGear');
  }
}

export function shopName(item) {
  if (item.app) return `${WATCH_APPS.find((a) => a.id === item.app)?.name || item.app.toUpperCase()} APP`;
  return itemName(item.id);
}

export function unlockLabel(k) {
  const [a, b] = k.split(':');
  if (a === 'term') return b === 'shop' ? 'COMPANY STORE ONLINE' : 'MISSION TERMINAL ONLINE';
  if (a === 'shop') return `STORE: ${SHOP_CATS.find((c) => c.id === b)?.name || b.toUpperCase()}`;
  if (a === 'app') return `APP: ${WATCH_APPS.find((x) => x.id === b)?.name || b.toUpperCase()}`;
  if (a === 'up') return `UPGRADE: ${b.toUpperCase()}`;
  return k.toUpperCase();
}
