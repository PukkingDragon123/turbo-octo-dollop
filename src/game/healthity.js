// Healthity MK-VII: an old 1979 medical unit. You do not start with one: on Level 0 a broken Healthity
// slumps out of a crate (game/onboarding.js) and you repair it in a circuit minigame (game/repairgame.js).
// Once rebooted it floats beside your clone, speaks in floating 3D text next to itself (floatText.say) with a
// synthesized voice, prints mission receipts out of its printer mouth (game/receipt.js), gives contextual tips
// for the current task, warns about low health / sanity / battery and charges the multitool.
//   [E] on Healthity: tear off the hanging receipt / charge the tool / pat it.  [X]: read your receipt
//   (or ask for a check-up print).  activate({ from: { pos, quat }, quiet }) is called on every peer when the
//   broken unit is fixed (the companion boots from that pose). game.run.healthity keeps it for the run.
import * as THREE from 'three';
import { input } from '../core/input.js';
import { profile } from '../core/profile.js';
import { engine } from '../core/engine.js';
import { audio } from '../audio/audio.js';
import { buildHealthity } from '../entities/optional.js';
import { damp } from '../core/rng.js';
import { floatText } from '../ui/floattext.js';
import { juice } from '../gfx/juice.js';
import { Q } from '../physics/physics.js';
import { Receipts, missionTasks } from './receipt.js';
import { RepairGame } from './repairgame.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _UP = new THREE.Vector3(0, 1, 0);
const SCALE = 0.72;
const VOICE_COL = '#a8ffd8', ALERT_COL = '#ffc65a';

const LINES = {
  // reboot (once, after the repair)
  boot1: ['R-r-reboot complete. Healthity Medical Unit, Mark Seven. Service year: nineteen seventy-nine.'],
  boot2: ['You fixed me. Nobody has opened that crate in a very, very long time. Thank you, valued employee.'],
  boot3: ['I will keep your body in working order. Your body is company property. Here are your orders.'],
  receipt: ['Please take your receipt. Press E on me.', 'Your receipt. Take it. I printed it with love. And ink.'],
  receipt_floor: ['You dropped your receipt. It is on the floor. It is looking at you.'],
  receipt_taken: ['Keep it safe. Press X to read it again. I will tick the boxes for you.'],
  neworders: ['New orders from HQ. Printing.', 'The orders have changed. Printing a new receipt.'],
  task_done: ['Task complete: {task}. I have ticked your receipt.', '{task}. Done. Good. Very good. Keep going.'],
  all_done: ['All tasks complete. Please wait for further instructions. Do not wander.'],
  charge: ['Hold still. Charging your multitool.', 'Plugging in. This may tingle.'],
  charged: ['Multitool battery at {n} percent. Please do not lick the terminals.'],
  lowbattery: ['Your multitool battery is at {n} percent. Come to me and press E. I will charge it.'],
  lowhp: ['Your health is at {n} percent. Please stop being damaged. A bandage would help.', 'Health {n} percent. I cannot carry you. Bandage. Now.'],
  lowsanity: ['Your sanity is at {n} percent. Stay in the light. Stay near me.', 'The walls are not breathing. I checked. Your sanity is {n} percent.'],
  // survival events / damage
  bleed: ['Bleeding detected. Please apply a bandage. Blood is company property.', 'You are leaking. Kindly stop.'],
  bleed2: ['HEAVY BLEEDING. That is a lot of you on the outside.', 'Critical leak detected. Bandage. Now. Please.'],
  fracture: ['Bone integrity compromised. A splint is recommended. Hopping is discouraged.'],
  infected: ['Infection detected. Antibiotics recommended. Almond water also acceptable.'],
  hungry: ['Your stomach has filed a formal complaint. Please eat.', 'Hunger detected. A protein bar would boost productivity.'],
  thirsty: ['Hydration low. Almond water is ninety-seven percent safe.', 'You are sixty percent water and dropping. Drink something.'],
  tired: ['You look exhausted. Find a bed or couch. Napping is a privilege.'],
  insane: ['Sanity below thirty percent. The walls are not whispering. Probably.', 'Stay near teammates and bright lights. And breathe. Not too loudly.'],
  lowbp: ['Blood pressure dropping. Please stop leaking and eat something.'],
  critical: ['VITALS CRITICAL. Have you considered not dying?', 'Warning: you are about to become a cloning expense.'],
  starving: ['STARVATION IMMINENT. Do not eat the carpet.'],
  dehydrated: ['SEVERE DEHYDRATION. Please drink literally anything.'],
  slashed: ['That looked expensive.', 'Laceration logged. HR has been notified.'],
  hurt: ['Injury logged. Please be careful with company assets.', 'Ouch. Productivity minus twelve percent.'],
  bandaged: ['Wound dressed. Good job, valued employee.', 'Bleeding stopped. You may resume panicking.'],
  splinted: ['Splint applied. You may now resume running away.'],
  insomnia: ['You cannot sleep while you feel watched. I am also watching. Sorry.'],
  fake: ['WARNING: something is right behind y— never mind. False alarm.', 'I am detecting... no. Nothing. Ignore me.'],
  pet: ['Thank you for the head pat. Morale plus one.', 'Bzzt. That is my favourite dent.', 'Physical contact logged as "team bonding".'],
  idle: ['Reminder: smiling increases productivity by four percent.', 'Fun fact: you are the three thousand four hundred and twelfth version of yourself.', 'Please do not lick the wallpaper.', 'I was in that crate since nineteen seventy-nine. Or yesterday. It is hard to tell down here.', 'My fan is fine. The noise is normal. Do not listen to it.', 'Furniture is money. Money is freedom. Freedom is not in your contract.'],
  monster: ['I am detecting elevated scariness.', 'Something big is nearby. Maybe crouch.'],
  day: ['Day {n}. Reality integrity at {i} percent. Stay positive.', 'Day {n} has begun. Everything is fine. Probably.'],
  dead: ['Employee deceased. Initiating sad music.'],
  healed: ['Vitals stabilizing. Good job.'],
  safe: ['Day one is your probation day. Nothing down here will hunt you today. Probably.'],
  day2: ['Day two. Probation is over. Things will start looking for you now. Stay together and stay quiet.'],
  pickup: ['{item}. Company property, but you may borrow it.', '{item} acquired. I have logged it.', 'Nice find. {item}.'],
  hq: ['Welcome back to HQ. Your locker has cosmetics. The break room has snacks.', 'Reminder: talk to Gloria at reception when your team is ready.'],
  // Level 0 camp loop (CampMission._say)
  camp_start: ['Let us build a camp. The TENT KIT crate is by the camp. Press E to open it.'],
  kit_open: ['Tent parts everywhere. Hold the left mouse button to drag a tent pole onto a glowing marker.'],
  attach_hint: ['Perfect spot. Now press the right mouse button with an empty hand. Your multitool is built into your suit.'],
  poles_done: ['Poles up. Now drag the canvas on top. It goes where the glowing tent shape is.'],
  canvas_done: ['Looking good. Last step: the stakes and the camp lamp.'],
  camp_built: ['A home. Sort of. If you ever die, this is where you come back.'],
  growl: ['Was that your stomach? Hunger and thirst are on now. Eat or drink something.'],
  sell: ['Now the real job: furniture is money. Feed it to the crusher teleport machine and the cash goes to your watch.'],
  exit: ['An exit opened next to the camp. Everybody inside, quickly.'],
};
const ALERT = new Set(['critical', 'bleed2', 'monster', 'starving', 'dehydrated', 'slashed', 'day2', 'lowhp', 'lowsanity', 'exit']);
const FACE = {
  bleed: 'alarmed', bleed2: 'alarmed', fracture: 'worried', infected: 'worried', hungry: 'neutral', thirsty: 'neutral', tired: 'sleepy',
  insane: 'glitch', lowbp: 'worried', critical: 'alarmed', starving: 'alarmed', dehydrated: 'alarmed', slashed: 'alarmed', hurt: 'worried',
  bandaged: 'happy', splinted: 'happy', insomnia: 'stare', fake: 'glitch', pet: 'love', idle: 'neutral', monster: 'worried', day: 'neutral',
  dead: 'dead', healed: 'happy', safe: 'happy', day2: 'worried', pickup: 'wink', hq: 'happy', tip: 'neutral', ask: 'neutral',
  boot1: 'glitch', boot2: 'happy', boot3: 'stare', receipt: 'happy', receipt_floor: 'stare', receipt_taken: 'wink', neworders: 'neutral',
  task_done: 'happy', all_done: 'love', charge: 'happy', charged: 'wink', lowbattery: 'worried', lowhp: 'alarmed', lowsanity: 'glitch',
  camp_start: 'happy', kit_open: 'happy', attach_hint: 'wink', poles_done: 'happy', canvas_done: 'happy', camp_built: 'love', growl: 'worried', sell: 'happy', exit: 'alarmed',
};
// contextual tips per kind of mission task (the first open task on the receipt decides)
const TASK_TIPS = {
  base: [
    'Your first task is a base. The TENT KIT crate is at the camp: open it, drag each part onto its glowing ghost, then attach it with the multitool. Empty hand, right mouse button.',
    'A base keeps you alive. If you die, you are re-printed there. For a fee.',
    'Heavy parts are easier with a friend. Two clones, one pole. Teamwork.',
  ],
  food: [
    'Get food. Select something edible with the number keys, then use it with the right mouse button.',
    'Snacks hide on shelves, in desks and in vending machines. Almond water counts as food. Legally.',
  ],
  money: [
    'Earn money. Furniture is money: drag it into the crusher teleport machine and HQ pays you for it.',
    'Look at furniture with an empty hand to see what it is worth. Couches pay. Lamps do not.',
    'Big loads, not tiny ones. The crusher is loud. Something might come to listen.',
  ],
  exit: ['Get out. The exit will not wait. Bring yourselves. Furniture optional.'],
  other: ['Follow the receipt. The receipt knows.'],
};
const HQ_TIPS = [
  'Try the terminals in the open office. One has an orientation. It is mandatory. Ish.',
  'Your locker lets you change your look. Cosmetics only. Upgrades are not in the budget.',
  'When your team is ready, talk to Gloria at reception. She opens the elevator gate.',
];
function taskKind(text) {
  const t = String(text).toUpperCase();
  if (/BASE|CAMP|TENT|BUILD|CONSTRUCT|SHELTER/.test(t)) return 'base';
  if (/FOOD|EAT|DRINK|HUNG|THIRST|SNACK|MEAL/.test(t)) return 'food';
  if (/\$|EARN|MONEY|CASH|QUOTA|SELL|CRUSH|\b1K\b|1,000/.test(t)) return 'money';
  if (/EXIT|LEAVE|ESCAPE|GET OUT|ELEVATOR/.test(t)) return 'exit';
  return 'other';
}
// split speech into bubbles that fit the floating text plate (4 lines max)
function chunks(text, max = 104) {
  const sents = String(text).match(/[^.!?]+[.!?]*\s*/g) || [String(text)];
  const out = [];
  let cur = '';
  for (const s of sents) {
    if ((cur + s).trim().length > max && cur) { out.push(cur.trim()); cur = ''; }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export class Healthity {
  constructor(game) {
    this.game = game;
    this._bot = null;
    this.active = false;
    this.say_cool = 0;
    this.idleT = 70;
    this.talkT = 0;
    this.face = 'neutral';
    this.faceT = 0;
    this.pos = new THREE.Vector3();
    this.attention = 0;
    this.monsterWarned = 0;
    this.others = new Map();
    this.queue = [];
    this.tipI = {};
    this.tipT = 20;
    this.warnT = { hp: 0, san: 0, bat: 30 };
    this.worldRef = null;
    this.lastKey = '';
    this.unseenT = 0;
    this.receiptNo = 0;
    this.receipts = new Receipts(this);
    this.repair = new RepairGame(game);
    this.boot = null;
    this.charging = null;
    this.taskKey = null;
    this.taskDone = {};
    this.taskT = 0;
  }

  // the companion's model (null while Healthity is still broken / absent): player.js aims and pats this
  get bot() { return this.active ? this._bot : null; }

  // ---------------------------------------------------------------- activation (every peer)
  activate(o = {}) {
    const g = this.game;
    if (g.run) g.run.healthity = true;
    if (this.active && !o.from) return;
    this.active = true;
    const w = g.world;
    if (!w) return;
    this._ensure(w);
    const b = this._bot;
    if (o.from && !o.quiet) {
      // boot from the broken unit's pose on the floor: CRT warms up, fan spins, it rises and turns to you
      this.pos.copy(o.from.pos);
      b.root.position.copy(this.pos);
      if (o.from.quat) b.root.quaternion.copy(o.from.quat);
      this.boot = { t: 0, from: o.from.pos.clone(), q: b.root.quaternion.clone() };
      b.setPower(0.05);
      b.setFace('boot');
      audio.play('hl_boot', { pos: this.pos, volume: 1 });
      if (o.local) { juice.flash(0.45); juice.shake(0.2); }
      w.fx?.sparks?.(this.pos, 18, null, [0.7, 0.9, 1], 2.2);
      this.queue = [];
      this.say_cool = 0;
      this.talkT = 0;
      this._introT = 0;
    } else {
      this.pos.copy(g.local.pos).add(_v.set(0.6, 1.6, 0.4));
      b.setPower(1);
    }
  }

  // ---------------------------------------------------------------- speech
  _speak(line) {
    if (profile.settings.healthityVoice === false) return;
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
    try {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(line.replace(/[♥:;)(]/g, ' ').replace(/—/g, ', '));
      u.pitch = 0.62;
      u.rate = 0.96;
      u.volume = Math.max(0, Math.min(1, (profile.settings.master ?? 1) * (profile.settings.sfx ?? 1)));
      const vs = synth.getVoices?.() || [];
      const v = vs.find((x) => /en[-_]US/i.test(x.lang) && /female|samantha|zira|google us/i.test(x.name)) || vs.find((x) => /^en/i.test(x.lang));
      if (v) u.voice = v;
      synth.speak(u);
    } catch (e) { /* voice optional */ }
  }

  say(key, vars = {}, text = null) {
    if (!this.active || !this._bot) return;
    const urgent = key === 'pet' || key === 'critical' || key === 'ask' || key === 'bleed2' || key.startsWith('boot') || key === 'task_done';
    if (this.say_cool > 0 && !urgent) return;
    const arr = text ? [text] : LINES[key];
    if (!arr) return;
    let line = arr[Math.floor(Math.random() * arr.length)];
    for (const k in vars) line = line.replaceAll(`{${k}}`, vars[k]);
    this.say_cool = key === 'pet' ? 1.5 : key === 'pickup' ? 4 : 6;
    this.lastKey = key;
    const parts = chunks(line).map((t) => ({ t, key }));
    if (urgent && !key.startsWith('boot')) this.queue = parts; else this.queue.push(...parts);
    if (urgent && !key.startsWith('boot')) this.talkT = 0;
    this.game.watch?.log('HEALTHITY', line);
    if (!this.queue.length || this.queue[0] === parts[0]) this._speak(line);
    else parts[0].voice = line;
  }

  _nextLine() {
    const it = this.queue.shift();
    if (!it) return;
    const alert = ALERT.has(it.key);
    const len = it.t.length;
    this.talkT = Math.min(8, 1.4 + len * 0.058);
    this.face = FACE[it.key] || 'neutral';
    this.faceT = this.talkT + 1.2;
    if (it.voice) this._speak(it.voice);
    const ps = this._ps();
    this.bubble?.close();
    this.bubble = floatText.say(it.t, { at: this._bot.root, speaker: 'HEALTHITY', color: alert ? ALERT_COL : VOICE_COL, offset: new THREE.Vector3(0, 0.24, 0), size: 0.8 * ps, duration: this.talkT + 1.6 });
    audio.play(alert ? 'healthity_alert' : it.key === 'pet' ? 'healthity_happy' : 'healthity_talk', { pos: this.pos, length: this.talkT, volume: 0.42, pitch: 0.8 });
  }
  // narrow (portrait) screens: smaller bubble, the bot closer to the centre
  _ps() { return Math.max(0.55, Math.min(1, engine.camera.aspect / 1.5)); }

  // ---------------------------------------------------------------- receipts
  receiptData() {
    const g = this.game, l = g.local, s = l.survival, tool = l.tool;
    const tasks = missionTasks(g);
    const open = tasks.find((t) => !t.done);
    const kind = open ? taskKind(open.text) : null;
    return {
      no: this.receiptNo,
      tasks,
      vitals: { health: s.health / 100, sanity: s.sanity / 100, hunger: s.needsActive ? s.hunger / 100 : null, thirst: s.needsActive ? s.thirst / 100 : null, battery: typeof tool?.battery === 'number' ? tool.battery : null },
      tip: kind ? TASK_TIPS[kind][0].replace(/^Your first task is a base\. |^Get food\. |^Earn money\. |^Get out\. /, '') : g.isLobby ? 'Talk to Gloria at reception when your team is ready.' : 'Await further instructions.',
      day: g.day?.day || 1,
      shift: ((g.run?.seed || 0) >>> 0).toString(36).slice(-5).toUpperCase().padStart(5, '0'),
      level: g.isLobby ? 'HQ SUBLEVEL B4' : (g.world?.level?.feedName || 'LEVEL 0: THE YELLOW ROOMS'),
    };
  }
  printReceipt(lineKey = 'receipt') {
    if (!this.bot) return false;
    this.receiptNo++;
    if (!this.receipts.print(this.receiptData())) return false;
    this._printLine = lineKey;
    this.attention = 1;
    return true;
  }
  onReceiptPrinted() { this.say_cool = 0; this.say(this._printLine === 'neworders' ? 'receipt' : this._printLine || 'receipt'); }
  onReceiptTorn() { this.say_cool = 0; this.say('receipt_floor'); }
  onReceiptTaken() {
    if (this._tookOnce) return;
    this._tookOnce = true;
    this.say_cool = 0;
    this.say('receipt_taken');
    this.tipT = 14;
  }

  // ---------------------------------------------------------------- player interaction
  promptText() {
    const k = input.keyName('interact');
    if (this.receipts.hanging) return `[${k}] Take receipt`;
    const tool = this.game.local.tool;
    if (tool && typeof tool.charge === 'function' && (tool.battery ?? 1) < 0.97 && !this.charging) return `[${k}] Charge tool (${Math.round((tool.battery ?? 0) * 100)}%)`;
    return `[${k}] Pat Healthity`;
  }
  pet() {
    if (!this.active) return;
    if (this.receipts.hanging) { this.receipts.take(); return; }
    const tool = this.game.local.tool;
    if (tool && typeof tool.charge === 'function' && (tool.battery ?? 1) < 0.97 && !this.charging) { this._startCharge(); return; }
    this.say('pet');
    this.game.local.survival.applyFx({ sanity: 2 });
  }
  _startCharge() {
    this.charging = { t: 0, dur: 2.0 };
    this.say_cool = 0;
    this.say('charge');
    audio.play('hl_charge', { pos: this.pos, volume: 0.8 });
    if (!this.arc) {
      this.arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(new Array(12).fill(0).map(() => new THREE.Vector3())), new THREE.LineBasicMaterial({ color: 0xa8e8ff, transparent: true, opacity: 0, toneMapped: false, depthTest: false }));
      this.arc.frustumCulled = false; this.arc.renderOrder = 990;
    }
  }
  _updateCharge(dt) {
    const c = this.charging, g = this.game, w = g.world;
    if (!c) { if (this.arc) this.arc.material.opacity = 0; return; }
    c.t += dt;
    const tool = g.local.tool;
    if (tool?.charge && (tool.battery ?? 0) < 1) tool.charge(Math.min(1 - (tool.battery ?? 0), dt / c.dur));
    // an arc from the printer mouth to the clone's right hand
    if (this.arc.parent !== w.group) w.group.add(this.arc);
    const cam = engine.camera;
    const hand = _v.set(0.2, -0.24, -0.45).applyQuaternion(cam.quaternion).add(cam.position);
    const from = this._bot.mouth.getWorldPosition(_v2);
    const A = this.arc.geometry.attributes.position;
    for (let i = 0; i < 12; i++) {
      const k = i / 11;
      A.setXYZ(i, from.x + (hand.x - from.x) * k + (i && i < 11 ? (Math.random() - 0.5) * 0.05 : 0), from.y + (hand.y - from.y) * k + Math.sin(k * Math.PI) * 0.05 + (i && i < 11 ? (Math.random() - 0.5) * 0.05 : 0), from.z + (hand.z - from.z) * k + (i && i < 11 ? (Math.random() - 0.5) * 0.05 : 0));
    }
    A.needsUpdate = true;
    this.arc.material.opacity = c.t < c.dur ? 0.5 + Math.random() * 0.5 : 0;
    if (Math.random() < dt * 14) w.fx?.sparks?.(hand, 3, null, [0.6, 0.85, 1], 1.2);
    if (c.t >= c.dur) {
      this.charging = null;
      this.arc.material.opacity = 0;
      this.say_cool = 0;
      this.say('charged', { n: Math.round((tool?.battery ?? 1) * 100) });
      audio.play('healthity_happy', { pos: this.pos, volume: 0.5, pitch: 0.8 });
    }
  }

  // [X]: read the receipt you hold, or get a check-up printed
  ask() {
    const g = this.game, l = g.local;
    if (!this.active || !g.world || l.dead) return;
    if (performance.now() - (this.receipts.closedAt || 0) < 200) return; // the same key just put it away
    if (this.receipts.held) { this.receipts.refresh(this.receiptData()); this.receipts.read(); return; }
    const s = l.survival;
    const need = s.bleed >= 2 ? 'You are bleeding badly. Bandage first, questions later.'
      : s.bleed ? 'You have a small bleed. A bandage would be lovely.'
      : s.thirst < 30 && s.needsActive ? 'You are thirsty. Drink something.'
      : s.hunger < 30 && s.needsActive ? 'You are hungry. Eat something.'
      : s.sanity < 40 ? 'Your sanity is low. Stay near teammates and bright lights.'
      : s.health < 50 ? 'You are banged up. A bandage or a medkit would help.'
      : 'Vitals look acceptable.';
    this.say('ask', {}, `Health ${Math.round(s.health)} percent. ${need}`);
    if (this.receipts.state === 'none') this.printReceipt('receipt');
  }

  // ---------------------------------------------------------------- per frame
  _ensure(world) {
    if (!this._bot) {
      this._bot = buildHealthity();
      this._bot.root.scale.setScalar(SCALE);
      this._bot.root.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    }
    if (this._bot.root.parent !== world.group) {
      world.group.add(this._bot.root);
      this.pos.copy(this.game.local.pos).add(_v.set(0.6, 1.6, 0.4));
    }
  }

  update(dt) {
    const g = this.game;
    const w = g.world;
    this.repair.update(dt);
    this.receipts.update(dt);
    if (!w) return;
    if (this.worldRef !== w) {
      this.worldRef = w;
      this.receipts.onWorldChange();
      this.queue = [];
      this.bubble = null;
      this.charging = null;
      this.boot = null;
      this.tipT = 18;
      this.taskKey = null;
      this._introT = g.run?.healthity ? 4 : 0;
    }
    this.active = !!g.run?.healthity;
    if (!this.active) {
      if (this._bot?.root.parent) this._bot.root.removeFromParent();
      for (const [, b] of this.others) b.root.removeFromParent();
      return;
    }
    this._ensure(w);
    const l = g.local, s = l.survival, b = this._bot;
    this.say_cool -= dt;
    if (input.hit('healthity') && g.state === 'playing' && !l.dead && !g.terminal?.active && !l.terminal) this.ask();
    // greeting on arrival in a new world (already-repaired unit)
    if (this._introT > 0 && !this.boot) {
      if (!g.ride?.active) this._introT -= dt;
      if (this._introT <= 0) { this.say_cool = 0; this.say(g.isLobby ? 'hq' : g.day?.day <= 1 ? 'safe' : 'day', { n: g.day?.day, i: 100 }); }
    }
    this._updateBoot(dt);
    // speech queue
    this.talkT -= dt;
    if (this.talkT <= -0.35 && this.queue.length) this._nextLine();
    if (!this.boot) {
      this._watchTasks(dt);
      this._warnings(dt);
      this._tips(dt);
      // survival events -> lines
      while (s.events.length) {
        const e = s.events.shift();
        if (!e.value) { if (e.key === 'bleed') this.say('healed'); continue; }
        if (e.key === 'bleed') this.say(s.bleed >= 2 ? 'bleed2' : 'bleed');
        else if (LINES[e.key]) this.say(e.key);
      }
      if (l.dead && this.face !== 'dead') { this.say('dead'); this.face = 'dead'; this.faceT = 1e9; }
      if (!l.dead && this.face === 'dead') this.face = 'neutral';
      const near = w.monsters?.localNear || 0;
      this.monsterWarned -= dt;
      if (near > 0.55 && this.monsterWarned <= 0) { this.monsterWarned = 60; this.say('monster'); }
      this.idleT -= dt;
      if (this.idleT <= 0) { this.idleT = 55 + Math.random() * 50; this.say('idle'); }
    } else s.events.length = 0;
    this._updateCharge(dt);
    // face: speech face, else the clone's condition; stares when you have not looked at it for a while
    this.faceT -= dt;
    let face = this.face;
    if (this.faceT <= 0) {
      face = s.health < 30 ? 'worried' : s.sanity < 30 ? 'glitch' : s.rest < 20 ? 'sleepy' : this.unseenT > 25 ? 'stare' : 'neutral';
      if (l.dead) face = 'dead';
    }
    if (!this.boot || this.boot.t > 1.6) b.setFace(face);
    b.setTalking(this.talkT > 0);
    b.setGaze(this.talkT > 0 || this.receipts.hanging ? 0 : null, 0);
    // movement: beside the clone; into view while it talks, prints or charges
    const busy = this.talkT > -0.3 || this.queue.length > 0 || this.receipts.hanging || !!this.charging;
    this.attention = damp(this.attention, busy && !l.dead ? 1 : 0, busy ? 3 : 1.2, dt);
    const cam = engine.camera;
    if (!this.boot || this.boot.t > 2.4) {
      const ps = this._ps();
      const side = _v.set(0.72, 0.55, 0.15).applyAxisAngle(_UP, l.yaw).add(l.pos);
      side.y = l.pos.y + 1.55;
      const inView = _v2.set(0.42 * ps, -0.08, -1.25).applyQuaternion(cam.quaternion).add(cam.position);
      const target = side.lerp(inView, this.attention);
      target.y += Math.sin(g.time * 1.7) * 0.03;
      // keep out of walls: pull in along the line of sight from the clone's head
      const head = _v2.copy(l.pos); head.y += 1.5;
      const dir = target.clone().sub(head); const dist = dir.length();
      if (dist > 0.05) {
        dir.multiplyScalar(1 / dist);
        const hit = w.physics.raycast(head, dir, dist + 0.15, Q.world);
        if (hit) target.copy(head).addScaledVector(dir, Math.max(0.25, hit.dist - 0.18));
      }
      const k = this.boot ? 1.5 : 5;
      this.pos.x = damp(this.pos.x, target.x, k, dt);
      this.pos.y = damp(this.pos.y, target.y, k, dt);
      this.pos.z = damp(this.pos.z, target.z, k, dt);
      if (this.pos.distanceTo(l.pos) > 8) this.pos.copy(target);
      b.root.position.copy(this.pos);
      _m.lookAt(cam.position, this.pos, _UP);
      _q.setFromRotationMatrix(_m); // +Z (the face) toward the camera
      b.root.quaternion.slerp(_q, Math.min(1, dt * (this.boot ? 2 : 8)));
    }
    b.update(dt);
    // has the clone looked at it lately?
    _v.copy(this.pos).sub(cam.position).normalize();
    const fwd = _v2.set(0, 0, -1).applyQuaternion(cam.quaternion);
    if (fwd.dot(_v) > 0.8) this.unseenT = 0; else this.unseenT += dt;
    this._updateOthers(dt);
  }

  _updateBoot(dt) {
    const B = this.boot;
    if (!B) return;
    const b = this._bot;
    B.t += dt;
    const t = B.t;
    // 0-1.2 s CRT warm-up line, fan spins up; 1.2-1.6 glitch; then rise and turn toward the clone
    b.setPower(Math.min(1, 0.05 + t * 0.7));
    if (t > 1.2 && t < 1.6) b.setFace('glitch');
    if (t > 0.3 && t < 2.6 && Math.random() < dt * 6) this.game.world?.fx?.sparks?.(this.pos, 4, null, [0.7, 0.9, 1], 1.5);
    if (t <= 2.4) {
      const k = Math.min(1, Math.max(0, (t - 0.9) / 1.5)), e = k * k * (3 - 2 * k);
      this.pos.copy(B.from).add(_v.set(0, e * 0.85 + Math.sin(t * 9) * 0.01 * (1 - e), 0));
      b.root.position.copy(this.pos);
      _m.lookAt(engine.camera.position, this.pos, _UP);
      _q.setFromRotationMatrix(_m);
      b.root.quaternion.copy(B.q).slerp(_q, e);
    }
    if (t > 1.7 && !B.spoke) { B.spoke = true; this.say('boot1'); this.say('boot2'); this.say('boot3'); }
    // the third line is up: print the first orders, done booting
    if (B.spoke && t > 3 && !this.queue.length && this.talkT < 0.5 && !B.printed) {
      B.printed = true;
      this.boot = null;
      this.printReceipt('receipt');
    }
  }

  // receipts follow the mission: reprint when the orders change, tick boxes as tasks complete
  _watchTasks(dt) {
    this.taskT -= dt;
    if (this.taskT > 0) return;
    this.taskT = 0.5;
    const tasks = missionTasks(this.game);
    const key = tasks.map((t) => t.text).join('|');
    if (this.taskKey === null) {
      this.taskKey = key;
      for (const t of tasks) this.taskDone[t.text] = t.done;
      return;
    }
    if (key !== this.taskKey) {
      this.taskKey = key;
      this.taskDone = {};
      for (const t of tasks) this.taskDone[t.text] = t.done;
      if (tasks.length && !this.receipts.hanging) { this.say_cool = 0; this.say('neworders'); this.printReceipt('receipt'); }
      return;
    }
    let changed = false;
    for (const t of tasks) {
      if (t.done && !this.taskDone[t.text]) {
        changed = true;
        this.say_cool = 0;
        this.say(tasks.every((x) => x.done) ? 'all_done' : 'task_done', { task: t.text.charAt(0) + t.text.slice(1).toLowerCase() });
        audio.play('healthity_happy', { pos: this.pos, volume: 0.5, pitch: 0.85 });
      }
      this.taskDone[t.text] = t.done;
    }
    if (changed && this.receipts.data) this.receipts.refresh(this.receiptData());
  }

  _warnings(dt) {
    const l = this.game.local, s = l.survival, W = this.warnT;
    if (l.dead) return;
    W.hp -= dt; W.san -= dt; W.bat -= dt;
    if (s.health < 35 && W.hp <= 0) { W.hp = 75; this.say_cool = 0; this.say('lowhp', { n: Math.round(s.health) }); }
    else if (s.sanity < 35 && W.san <= 0) { W.san = 90; this.say('lowsanity', { n: Math.round(s.sanity) }); }
    const tool = l.tool;
    if (typeof tool?.battery === 'number' && tool.battery < 0.2 && W.bat <= 0 && !this.charging) { W.bat = 70; this.say('lowbattery', { n: Math.round(tool.battery * 100) }); }
  }

  _tips(dt) {
    const g = this.game;
    this.tipT -= dt;
    if (this.tipT > 0 || this.say_cool > 0 || this.queue.length || this.receipts.hanging || g.local.dead) return;
    let list, set;
    if (g.isLobby) { list = HQ_TIPS; set = 'hq'; } else {
      const open = missionTasks(g).find((t) => !t.done);
      if (!open) { this.tipT = 30; return; }
      set = taskKind(open.text); list = TASK_TIPS[set];
    }
    const i = this.tipI[set] || 0;
    this.tipT = 34 + Math.random() * 16;
    if (i >= list.length) return;
    this.tipI[set] = i + 1;
    this.say('tip', {}, list[i]);
  }

  _updateOthers(dt) {
    const g = this.game, w = g.world, cam = engine.camera;
    for (const [id, r] of g.remotes) {
      let b = this.others.get(id);
      if (!b && r.inWorld) { b = buildHealthity(); b.root.scale.setScalar(SCALE); this.others.set(id, b); }
      if (!b) continue;
      if (b.root.parent !== w.group) w.group.add(b.root);
      const tp = _v.set(0.6, 1.55 + Math.sin(g.time * 1.5 + id.length) * 0.05, 0.3).applyAxisAngle(_UP, r.yaw).add(r.pos);
      b.root.position.lerp(tp, Math.min(1, dt * 4));
      _m.lookAt(cam.position, b.root.position, _UP);
      b.root.quaternion.setFromRotationMatrix(_m);
      const hs = r.hs || {};
      b.setFace(r.dead ? 'dead' : hs.h < 30 ? 'alarmed' : hs.b ? 'worried' : hs.z ? 'sleepy' : 'neutral');
      b.root.visible = r.inWorld;
      b.update(dt);
    }
    for (const [id, b] of this.others) if (!g.remotes.has(id)) { b.root.removeFromParent(); this.others.delete(id); }
  }

  onDayChange(day, integrity) {
    this.say_cool = 0;
    if (day === 2) this.say('day2');
    else this.say('day', { n: day, i: integrity });
  }

  onPickup(type, name) {
    if (Math.random() < 0.55 || this.lastKey === 'pickup') return;
    this.say('pickup', { item: name });
  }
}
