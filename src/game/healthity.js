// Healthity: a cute floating spherical medical robot with a pixel face that follows every clone,
// warns about their condition and dispenses unhelpful corporate wellness advice.
// When it talks it also pops into the corner of your screen (a second copy of the bot hanging off the
// viewmodel camera) with a typewriter speech bubble and a synthesized robot voice. Ask it for a check-up
// with [X] / the HLTH button / by tapping it: it reads your vitals, says what you need most and what to do next.
import { input } from '../core/input.js';
import { profile } from '../core/profile.js';
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { audio } from '../audio/audio.js';
import { buildHealthity } from '../entities/optional.js';
import { damp } from '../core/rng.js';

const _v = new THREE.Vector3(), _dir = new THREE.Vector3(), _zAxis = new THREE.Vector3(0, 0, 1);

const LINES = {
  bleed: ['Bleeding detected! Please apply a bandage. Blood is company property.', 'You are leaking. Kindly stop.'],
  bleed2: ['HEAVY BLEEDING! That is a lot of you on the outside!', 'Critical leak detected. Bandage. Now. Please. :)'],
  fracture: ['Bone integrity compromised. A splint is recommended. Hopping is discouraged.', 'Your leg is now two legs. Please find a splint.'],
  infected: ['Infection detected! Antibiotics recommended. Almond water also acceptable. Crying: not recommended.'],
  hungry: ['Your stomach has filed a formal complaint. Please eat.', 'Hunger detected. A protein bar would boost productivity!'],
  thirsty: ['Hydration low! Almond water is 97% safe!', 'You are 60% water and dropping. Drink something.'],
  tired: ['You look exhausted. Find a bed or couch. Napping is a privilege.', 'Fatigue detected. Rest is permitted. Briefly.'],
  insane: ['Sanity below 30%. Reminder: the walls are not whispering. Probably.', 'Stay near teammates and bright lights. And breathe. Not too loudly.'],
  lowbp: ['Blood pressure dropping! Please stop leaking and eat something.'],
  critical: ['VITALS CRITICAL! Have you considered not dying?', 'Warning: you are about to become a cloning expense.'],
  starving: ['STARVATION IMMINENT. Even the carpet looks tasty. Do not eat the carpet.'],
  dehydrated: ['SEVERE DEHYDRATION. Please drink literally anything.'],
  slashed: ['OW! That looked expensive!', 'Laceration logged. HR has been notified.'],
  hurt: ['Injury logged. Please be more careful with company assets.', 'Ouch! Productivity -12%.'],
  bandaged: ['Wound dressed! Great job, valued employee!', 'Bleeding stopped. You may resume panicking.'],
  splinted: ['Splint applied. You may now resume running away.'],
  insomnia: ['You can\'t sleep while you feel watched. Calm down first. Or don\'t!'],
  fake: ['WARNING: something is right behind y— never mind. False alarm. :)', 'I am detecting... no. Nothing. Ignore me.'],
  pet: ['♥ Thank you for the head pat! Morale +1!', 'Beep boop ♥', 'Physical contact logged as "team bonding".'],
  idle: ['Reminder: smiling increases productivity by 4%.', 'Fun fact: you are the 3,412th version of yourself!', 'Please do not lick the wallpaper.', 'Hydration is the key to survival! So is running.', 'Furniture is money. Money is freedom. Freedom is not in your contract.', 'Stretch your legs! Not in the direction of the monster.', 'That chair looks expensive. Just saying.'],
  monster: ['Uh oh. I am detecting elevated scariness.', 'Something big is nearby. Maybe crouch?'],
  day: ['Day {n}! Reality integrity at {i}%. Stay positive!', 'Day {n} has begun. Everything is fine. Probably.'],
  dead: ['Employee deceased. Initiating sad music.'],
  healed: ['Vitals stabilizing. Good job!'],
  safe: ['Welcome to Day 1, your probation day! Nothing down here will hunt you today. Probably. Explore!', 'Good news! Day 1 is a guaranteed safe probation day. Use it to explore and stock up!'],
  day2: ['Day 2. Probation is over. Things will start looking for you now. Stay together and stay quiet!'],
  pickup: ['Ooh, {item}! Company property, but you may borrow it.', '{item} acquired. I have logged it in your inventory. On your watch!', 'Nice find! {item}.'],
  hq: ['Welcome back to HQ! Your locker has cosmetics. The break room has snacks. Gloria at reception has... adventure!', 'Reminder: talk to Gloria at reception when your team is ready. She opens the elevator. Do not be late for it.'],
  // Level 0 camp loop (CampMission)
  camp_start: ['Welcome to Level 0! First things first: let\'s build a camp. The TENT KIT crate is right here. Press [E] to open it!'],
  kit_open: ['Tent parts everywhere! Hold LMB to drag a tent pole onto one of the glowing markers.'],
  attach_hint: ['Perfect spot! Now press RMB with an empty hand. Your multitool is built into your suit!'],
  poles_done: ['Poles up! Now drag the canvas on top. It goes where the glowing tent shape is.'],
  canvas_done: ['Looking good! Last step: the stakes and the camp lamp.'],
  camp_built: ['Ta-da! A home! Sort of! The lamp marks your camp. If you ever die, this is where you come back.'],
  growl: ['Was that your stomach? Hunger and thirst are on now. Eat or drink something, then keep an eye on the bars, top left!', 'Grrrowl! Your stomach has filed a formal complaint. Eat something from your pockets!'],
  sell: ['Now the real job: furniture is money! Drag it onto the teleport pads, pull the lever, and the cash uploads to your watch.'],
  exit: ['Quota met! An exit opened next to the camp. Everybody inside, quickly!'],
};

// guided tips, one at a time on a calm schedule: per Level 0 camp-loop stage, Day 1 of other dimensions, HQ
const TIPS = {
  camp: [
    'The glowing ghost shapes show where your camp goes. Open the TENT KIT crate with [E].',
    'Hold LMB to drag a part. The mouse wheel pulls it closer or pushes it away.',
    'Carry a part onto its glowing marker, then press RMB with an empty hand. Click! Attached.',
    'Heavy parts are easier with a friend. Two clones, one pole. Teamwork!',
  ],
  survive: [
    'Your hunger and thirst bars are top left now. Keep them out of the red!',
    'Select food or a drink with the number keys, then press RMB to use it.',
  ],
  sell: [
    'Look at furniture with an empty hand: I will tell you what it is worth!',
    'Pad hall routine: furniture on the pads, pull the lever, money on your watch.',
    'Raise your watch with TAB. It shows your quota and where the camp and the pads are.',
    'Your multitool can ATTACH things together. Press R to switch it to DISMANTLE and get crafting materials.',
    'Snacks and drinks hide all over Level 0. Grab them when you see them. Your stomach will thank you.',
    'If you die you get re-printed at the camp, but it costs HALF of the team money. So... please do not die.',
    'Things start hunting from Day 2. A DISTORTER built at the camp workbench keeps them away. Probably.',
    'The pads are loud. Something might come and listen. Send big loads, not tiny ones!',
  ],
  exit: ['The exit is next to the camp. Bring yourselves. Furniture optional.'],
  level: [
    'Open the cardboard starter kit. It has a flashlight, snacks and a bandage.',
    'Your multitool is built into your suit: empty hand + RMB attaches things together. R switches to dismantle.',
    'Raise your wristwatch any time. The MAP tab draws everything you have explored.',
    'Grab almost anything and drag it. Furniture makes a lovely barricade.',
    'Hungry or thirsty? Eat and drink from your inventory with the item button.',
  ],
  hq: [
    'Try the terminals in the open office. One of them has an orientation. It is mandatory. Ish.',
    'Your locker lets you change your look. Cosmetics only. Upgrades are not in the budget.',
    'When your team is ready, talk to Gloria at reception. She opens the elevator gate. Hop in before it closes!',
  ],
};

const FACE = {
  bleed: 'alarmed', bleed2: 'alarmed', fracture: 'worried', infected: 'worried', hungry: 'neutral', thirsty: 'neutral',
  tired: 'sleepy', insane: 'glitch', lowbp: 'worried', critical: 'alarmed', starving: 'alarmed', dehydrated: 'alarmed',
  slashed: 'alarmed', hurt: 'worried', bandaged: 'happy', splinted: 'happy', insomnia: 'worried', fake: 'glitch',
  pet: 'love', idle: 'happy', monster: 'worried', day: 'neutral', dead: 'dead', healed: 'happy',
  safe: 'happy', day2: 'worried', pickup: 'wink', hq: 'happy', tip: 'happy', ask: 'happy',
  camp_start: 'happy', kit_open: 'happy', attach_hint: 'wink', poles_done: 'happy', canvas_done: 'happy',
  camp_built: 'love', growl: 'worried', sell: 'happy', exit: 'alarmed',
};

export class Healthity {
  constructor(game) {
    this.game = game;
    this.bot = null;
    this.say_cool = 0;
    this.idleT = 60;
    this.talkT = 0;
    this.face = 'happy';
    this.faceT = 0;
    this.pos = new THREE.Vector3();
    this.offset = new THREE.Vector3(0.62, 0.3, -1.35);
    this.attention = 0; // 1 when talking -> floats into view
    this.monsterWarned = 0;
    this.others = new Map(); // remote player id -> bot
    // on-screen pop-up
    this.pop = null;          // second bot hanging off the viewmodel camera
    this.popK = 0;            // 0 hidden .. 1 fully in
    this.popT = 0;            // time left on screen
    this.line = '';
    this.typed = 0;
    this.tipI = {};
    this.tipT = 14;
    this.worldRef = null;
    this.lastKey = '';
    this._buildBubble();
  }

  _buildBubble() {
    const d = document.createElement('div');
    d.id = 'hbubble';
    d.innerHTML = '<div class="hb-name"><i class="hb-ico"></i>HEALTHITY<span class="hb-led"></span></div><div class="hb-text"></div><div class="hb-hint"></div>';
    document.body.appendChild(d);
    this.bubble = d;
    this.bubbleText = d.querySelector('.hb-text');
    this.bubbleHint = d.querySelector('.hb-hint');
    // tap the bubble (touch) to ask for a check-up
    d.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); input.lastTouch = performance.now(); this.ask(); });
  }

  _ensurePop() {
    if (this.pop) return;
    this.pop = buildHealthity();
    this.pop.root.scale.setScalar(0.42);
    this.pop.root.visible = false;
    this.pop.root.traverse((o) => { o.frustumCulled = false; });
    engine.vmCamera.add(this.pop.root);
  }

  _speak(line) {
    if (profile.settings.healthityVoice === false) return;
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
    try {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(line.replace(/[♥:;)(]/g, ' ').replace(/—/g, ', '));
      u.pitch = 1.75;
      u.rate = 1.12;
      u.volume = Math.max(0, Math.min(1, (profile.settings.master ?? 1) * (profile.settings.sfx ?? 1)));
      const vs = synth.getVoices?.() || [];
      const v = vs.find((x) => /en[-_]US/i.test(x.lang) && /female|samantha|zira|google us/i.test(x.name)) || vs.find((x) => /^en/i.test(x.lang));
      if (v) u.voice = v;
      synth.speak(u);
    } catch (e) { /* voice optional */ }
  }

  // check-up on request: vitals, the most urgent need, the next objective
  ask() {
    const g = this.game;
    const l = g.local;
    if (!g.world || l.dead) return;
    const s = l.survival;
    const adv = s.advanced;
    const need = s.bleed >= 2 ? 'You are bleeding badly. Bandage first, questions later!'
      : s.bleed ? 'You have a small bleed. A bandage would be lovely.'
      : adv && s.fracture ? 'Your leg is broken. Find a splint before running anywhere.'
      : s.thirst < 30 ? 'You are thirsty. Drink something. Almond water counts.'
      : s.hunger < 30 ? 'You are hungry. Eat something from your pockets.'
      : adv && s.rest < 25 ? 'You are exhausted. A nap on a bed or couch would help.'
      : adv && s.sanity < 40 ? 'Your sanity is low. Stay near teammates and bright lights.'
      : adv && s.infection > 40 ? 'You have an infection brewing. Antibiotics, please.'
      : s.health < 50 ? 'You are banged up. A bandage or a medkit would help.'
      : 'Vitals look acceptable!';
    const needs = s.needsActive && !g.isLobby ? ` Hunger ${Math.round(s.hunger)}, thirst ${Math.round(s.thirst)}.` : '';
    const m = g.world.level?.mission;
    let next = 'Next: talk to Gloria at reception and take the elevator with your team.';
    if (m?.objective) {
      const o = m.objective();
      next = `Next: ${o.title.toLowerCase()}. ${o.detail}.`;
    } else if (m) next = 'Next: follow the instructions from HQ on your watch.';
    const day = g.day.active ? ` Day ${g.day.day} of 7.` : '';
    this.say('ask', {}, `Health ${Math.round(s.health)} percent.${needs} ${need} ${next}${day}`);
    audio.play('healthity_happy', { pos: this.pos, volume: 0.5 });
  }

  _ensure(world) {
    if (!this.bot) {
      this.bot = buildHealthity();
      this.bot.root.scale.setScalar(0.62);
    }
    if (this.bot.root.parent !== world.group) {
      world.group.add(this.bot.root);
      const col = world.physics;
      void col;
      this.pos.copy(this.game.local.pos).add(new THREE.Vector3(0.6, 1.6, 0.4));
    }
  }

  say(key, vars = {}, text = null) {
    const urgent = key === 'pet' || key === 'critical' || key === 'ask' || key === 'bleed2';
    if (this.say_cool > 0 && !urgent) return;
    const arr = text ? [text] : LINES[key];
    if (!arr) return;
    let line = arr[Math.floor(Math.random() * arr.length)];
    for (const k in vars) line = line.replace(`{${k}}`, vars[k]);
    this.say_cool = key === 'pet' ? 1.5 : key === 'pickup' ? 4 : 6;
    this.talkT = Math.min(7, 1.2 + line.length * 0.055);
    this.lastKey = key;
    // on-screen pop-up + voice
    this.line = line;
    this.typed = 0;
    this.popT = this.talkT + 2.2;
    this.bubble.classList.toggle('alarm', ['critical', 'bleed2', 'monster', 'starving', 'dehydrated', 'slashed', 'day2'].includes(key));
    this._speak(line);
    this.face = FACE[key] || 'neutral';
    this.faceT = this.talkT + 1.5;
    this.game.watch?.log('HEALTHITY', line);
    audio.play(key === 'critical' || key === 'bleed2' ? 'healthity_alert' : key === 'pet' ? 'healthity_happy' : 'healthity_talk', { pos: this.pos, length: this.talkT, volume: 0.45 });
  }

  pet() {
    this.say('pet');
    this.game.local.survival.applyFx({ sanity: 2 });
  }

  update(dt) {
    const g = this.game;
    const w = g.world;
    if (!w) return;
    this._ensure(w);
    this._ensurePop();
    const l = g.local;
    const s = l.survival;
    this.say_cool -= dt;
    // arrival in a new world: greet, then guided tips
    if (this.worldRef !== w) {
      this.worldRef = w;
      this.tipT = 16;
      for (const k of ['camp', 'survive', 'sell', 'exit']) delete this.tipI[k]; // camp-loop tips once per dimension
      this.say_cool = 0;
      this._introT = 3.5;
    }
    const stage = !g.isLobby ? w.level?.mission?.stage : null;
    if (this._introT > 0) {
      if (!g.ride?.active) this._introT -= dt; // wait for the elevator ride to end
      if (this._introT <= 0) this.say(g.isLobby ? 'hq' : stage === 'camp' ? 'camp_start' : g.day.day <= 1 ? 'safe' : 'day');
    }
    if (g.state === 'playing' && !l.dead && !g.terminal?.active && input.hit('healthity')) this.ask();
    // tips: the Level 0 camp loop gets its own list per stage (any day); other dimensions on Day 1; HQ always
    const set = g.isLobby ? 'hq' : stage && TIPS[stage] ? stage : 'level';
    if (set !== this._tipSet) { this._tipSet = set; this.tipT = Math.max(this.tipT, 10); }
    const tutorial = g.isLobby || set !== 'level' || (g.day.active && g.day.day <= 1);
    this.tipT -= dt;
    if (tutorial && this.tipT <= 0 && this.say_cool <= 0 && !l.dead) {
      const list = TIPS[set];
      const i = this.tipI[set] || 0;
      if (i < list.length) { this.say('tip', {}, list[i]); this.tipI[set] = i + 1; }
      this.tipT = (set === 'level' || set === 'hq' ? 32 : 24) + Math.random() * 12;
    }
    // survival events -> lines
    while (s.events.length) {
      const e = s.events.shift();
      if (!e.value) { if (e.key === 'bleed') this.say('healed'); continue; }
      if (e.key === 'bleed') this.say(s.bleed >= 2 ? 'bleed2' : 'bleed');
      else if (LINES[e.key]) this.say(e.key);
    }
    if (l.dead && this.face !== 'dead') { this.say('dead'); this.face = 'dead'; this.faceT = 1e9; }
    if (!l.dead && this.face === 'dead') this.face = 'happy';
    // monster warning
    const near = w.monsters?.localNear || 0;
    this.monsterWarned -= dt;
    if (near > 0.55 && this.monsterWarned <= 0) { this.monsterWarned = 60; this.say('monster'); }
    // idle chatter
    this.idleT -= dt;
    if (this.idleT <= 0) { this.idleT = 45 + Math.random() * 45; if (!g.isLobby || Math.random() < 0.6) this.say('idle'); }
    // face
    this.faceT -= dt;
    let face = this.face;
    if (this.faceT <= 0) {
      face = s.health < 30 ? 'worried' : s.sanity < 30 ? 'glitch' : s.rest < 20 ? 'sleepy' : 'happy';
      if (l.dead) face = 'dead';
    }
    this.bot.setFace(face);
    this.talkT -= dt;
    this.bot.setTalking(this.talkT > 0);
    this._updatePop(dt, face);
    // float near the clone: beside/behind it (the on-screen pop-up does the talking up front)
    this.attention = damp(this.attention, 0, 2, dt);
    const cam = engine.camera;
    const idle = new THREE.Vector3(0.75, 0.55, 0.35).applyAxisAngle(new THREE.Vector3(0, 1, 0), l.yaw).add(l.pos).add(new THREE.Vector3(0, 1.2, 0));
    const inView = this.offset.clone().applyQuaternion(cam.quaternion).add(cam.position);
    const target = idle.lerp(inView, l.dead ? 0 : this.attention);
    target.y += Math.sin(g.time * 1.7) * 0.05;
    // keep out of walls
    this.pos.x = damp(this.pos.x, target.x, 5, dt);
    this.pos.y = damp(this.pos.y, target.y, 5, dt);
    this.pos.z = damp(this.pos.z, target.z, 5, dt);
    if (this.pos.distanceTo(l.pos) > 6) this.pos.copy(target);
    this.bot.root.position.copy(this.pos);
    // face the camera
    const look = cam.position.clone();
    this.bot.root.lookAt(look);
    this.bot.update(dt);
    // teammates' bots (cosmetic)
    for (const [id, r] of g.remotes) {
      let b = this.others.get(id);
      if (!b && r.inWorld) {
        b = buildHealthity();
        b.root.scale.setScalar(0.8);
        w.group.add(b.root);
        this.others.set(id, b);
      }
      if (!b) continue;
      if (b.root.parent !== w.group) w.group.add(b.root);
      const tp = new THREE.Vector3(0.6, 1.55 + Math.sin(g.time * 1.5 + id.length) * 0.06, 0.3).applyAxisAngle(new THREE.Vector3(0, 1, 0), r.yaw).add(r.pos);
      b.root.position.lerp(tp, Math.min(1, dt * 4));
      b.root.lookAt(cam.position);
      const hs = r.hs || {};
      b.setFace(r.dead ? 'dead' : hs.h < 30 ? 'alarmed' : hs.b ? 'worried' : hs.z ? 'sleepy' : 'happy');
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

  // the screen-corner pop-up: springs in from the left edge, bobs while talking, typewriter bubble
  _updatePop(dt, face) {
    const g = this.game;
    const l = g.local;
    const pop = this.pop;
    this.popT -= dt;
    const show = this.popT > 0 && g.state === 'playing' && !g.ui.menuOpen && !g.ui.customizing && !g.terminal?.active && !l.dead;
    this.popK = damp(this.popK, show ? 1 : 0, show ? 7 : 5, dt);
    const vis = this.popK > 0.01;
    pop.root.visible = vis;
    this.bubble.classList.toggle('show', show && this.popK > 0.6);
    if (!vis) return;
    const cam = engine.vmCamera;
    const z = 0.62;
    const hh = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * z;
    const hw = hh * cam.aspect;
    // overshoot spring on the way in
    const k = this.popK;
    const e = k < 1 ? 1 - Math.pow(1 - k, 3) + Math.sin(k * Math.PI) * 0.12 : 1;
    // narrow (portrait) screens get a smaller bot so it does not fill the width
    const ps = Math.max(0.5, Math.min(1, cam.aspect * 0.9));
    const x = -hw + 0.115 * ps - (1 - e) * 0.3;
    // sit below the sleeve patch / touch button column when they are showing
    const clearPx = g.ui?.popTopPx?.() || 0;
    const topY = clearPx > 0 ? hh * (1 - 2 * (clearPx + 10 + window.innerHeight * 0.085 * ps) / window.innerHeight) : hh;
    const y = Math.min(hh * 0.42, topY) + Math.sin(g.time * 2.3) * 0.006 + (this.talkT > 0 ? Math.sin(g.time * 13) * 0.002 : 0);
    pop.root.position.set(x, y, -z);
    _dir.set(-x, -y, z).normalize();
    pop.root.quaternion.setFromUnitVectors(_zAxis, _dir);
    pop.root.rotateZ(Math.sin(g.time * 1.3) * 0.08);
    pop.root.scale.setScalar(0.42 * ps * Math.max(0.01, e));
    pop.setFace(face);
    pop.setTalking(this.talkT > 0);
    pop.update(dt);
    // bubble placement: right of the bot, in pixels
    _v.set(x + 0.075 * ps, y + 0.03 * ps, -z).applyMatrix4(cam.matrixWorld).project(cam);
    const px = (_v.x * 0.5 + 0.5) * window.innerWidth, py = (-_v.y * 0.5 + 0.5) * window.innerHeight;
    this.bubble.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px)`;
    const maxW = Math.round(Math.max(150, Math.min(380, window.innerWidth - px - 12)));
    if (this._bubbleMaxW !== maxW) { this._bubbleMaxW = maxW; this.bubble.style.maxWidth = `${maxW}px`; }
    // typewriter
    if (this.typed < this.line.length) {
      this.typed = Math.min(this.line.length, this.typed + dt * 38);
      this.bubbleText.textContent = this.line.slice(0, Math.ceil(this.typed));
    }
    const hint = input.touch ? 'TAP FOR CHECK-UP' : '[X] CHECK-UP';
    if (this.bubbleHint.textContent !== hint) this.bubbleHint.textContent = hint;
  }
}
