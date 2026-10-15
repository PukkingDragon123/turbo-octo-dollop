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
  idle: ['Reminder: smiling increases productivity by 4%.', 'Fun fact: you are the 3,412th version of yourself!', 'Please do not lick the wallpaper.', 'Hydration is the key to survival! So is running.', 'Have you photographed something horrible today? Research pays!', 'Stretch your legs! Not in the direction of the monster.'],
  monster: ['Uh oh. I am detecting elevated scariness.', 'Something big is nearby. Maybe crouch?'],
  day: ['Day {n}! Reality integrity at {i}%. Stay positive!', 'Day {n} has begun. Everything is fine. Probably.'],
  dead: ['Employee deceased. Initiating sad music.'],
  healed: ['Vitals stabilizing. Good job!'],
  safe: ['Welcome to Day 1, your probation day! Nothing down here will hunt you today. Probably. Explore!', 'Good news! Day 1 is a guaranteed safe probation day. Use it to explore and stock up!'],
  day2: ['Day 2. Probation is over. Things will start looking for you now. Stay together and stay quiet!'],
  pickup: ['Ooh, {item}! Company property, but you may borrow it.', '{item} acquired. I have logged it in your inventory. On your watch!', 'Nice find! {item}.'],
  hq: ['Welcome back to HQ! Your locker has cosmetics. The break room has snacks. The lever has... adventure!', 'Reminder: the dispatch lever is in the hazard-striped bay. Pull it when your team is ready.'],
};

// guided tips, one at a time on a calm schedule (Day 1 of a dimension and at HQ)
const TIPS = {
  level: [
    'Open the cardboard starter kit. It has a flashlight, snacks, a bandage and a multitool.',
    'Raise your wristwatch any time. The MAP tab draws everything you have explored.',
    'Find three generators. Follow the loudest hum. Each one breaks in its own special way!',
    'Carry the field radio to every running generator to set up an uplink. It is heavy. Lift with your legs.',
    'See something weird? The CAMERA tab on your watch takes research photos. Weird pays!',
    'Grab almost anything and drag it. Furniture makes a lovely barricade.',
    'Hungry or thirsty? Eat and drink from your inventory with the item button.',
  ],
  hq: [
    'Try the terminals in the open office. One of them has an orientation. It is mandatory. Ish.',
    'Your locker lets you change your look. Cosmetics only. Upgrades are not in the budget.',
    'Gather your team in the dispatch bay, then pull the lever. Anything in the striped zone comes along!',
  ],
};

const FACE = {
  bleed: 'alarmed', bleed2: 'alarmed', fracture: 'worried', infected: 'worried', hungry: 'neutral', thirsty: 'neutral',
  tired: 'sleepy', insane: 'glitch', lowbp: 'worried', critical: 'alarmed', starving: 'alarmed', dehydrated: 'alarmed',
  slashed: 'alarmed', hurt: 'worried', bandaged: 'happy', splinted: 'happy', insomnia: 'worried', fake: 'glitch',
  pet: 'love', idle: 'happy', monster: 'worried', day: 'neutral', dead: 'dead', healed: 'happy',
  safe: 'happy', day2: 'worried', pickup: 'wink', hq: 'happy', tip: 'happy', ask: 'happy',
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
    this.tipI = { level: 0, hq: 0 };
    this.tipT = 14;
    this.worldRef = null;
    this.lastKey = '';
    this._buildBubble();
  }

  _buildBubble() {
    const d = document.createElement('div');
    d.id = 'hbubble';
    d.innerHTML = '<div class="hb-name">HEALTHITY<span class="hb-led"></span></div><div class="hb-text"></div><div class="hb-hint"></div>';
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
    const need = s.bleed >= 2 ? 'You are bleeding badly. Bandage first, questions later!'
      : s.bleed ? 'You have a small bleed. A bandage would be lovely.'
      : s.fracture ? 'Your leg is broken. Find a splint before running anywhere.'
      : s.thirst < 30 ? 'You are thirsty. Drink something. Almond water counts.'
      : s.hunger < 30 ? 'You are hungry. Eat something from your pockets.'
      : s.rest < 25 ? 'You are exhausted. A nap on a bed or couch would help.'
      : s.sanity < 40 ? 'Your sanity is low. Stay near teammates and bright lights.'
      : s.infection > 40 ? 'You have an infection brewing. Antibiotics, please.'
      : 'Vitals look acceptable!';
    const m = g.world.level?.mission;
    let next = 'Next: pull the dispatch lever with your team.';
    if (m) {
      const n = m.generators.filter((x) => x.running).length;
      const lk = m.linksCount();
      next = n < 3 ? `Next: generators. ${n} of 3 are running.` : lk < 3 ? `Next: carry the radio to the generators. ${lk} of 3 linked.` : !m.state.extraction ? 'Next: request extraction on the radio.' : 'Next: get to the exit door. Quickly!';
    }
    const day = g.day.active ? ` Day ${g.day.day} of 7.` : '';
    this.say('ask', {}, `Health ${Math.round(s.health)} percent. ${need} ${next}${day}`);
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
      this.say_cool = 0;
      this._introT = 3.5;
    }
    if (this._introT > 0) {
      this._introT -= dt;
      if (this._introT <= 0) this.say(g.isLobby ? 'hq' : g.day.day <= 1 ? 'safe' : 'day');
    }
    if (g.state === 'playing' && !l.dead && !g.terminal?.active && input.hit('healthity')) this.ask();
    const tutorial = g.isLobby || (g.day.active && g.day.day <= 1);
    this.tipT -= dt;
    if (tutorial && this.tipT <= 0 && this.say_cool <= 0 && !l.dead) {
      const set = g.isLobby ? 'hq' : 'level';
      const list = TIPS[set];
      if (this.tipI[set] < list.length) this.say('tip', {}, list[this.tipI[set]++]);
      this.tipT = 32 + Math.random() * 14;
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
    const x = -hw + 0.115 - (1 - e) * 0.3;
    const y = hh * 0.42 + Math.sin(g.time * 2.3) * 0.006 + (this.talkT > 0 ? Math.sin(g.time * 13) * 0.002 : 0);
    pop.root.position.set(x, y, -z);
    _dir.set(-x, -y, z).normalize();
    pop.root.quaternion.setFromUnitVectors(_zAxis, _dir);
    pop.root.rotateZ(Math.sin(g.time * 1.3) * 0.08);
    pop.root.scale.setScalar(0.42 * Math.max(0.01, e));
    pop.setFace(face);
    pop.setTalking(this.talkT > 0);
    pop.update(dt);
    // bubble placement: right of the bot, in pixels
    _v.set(x + 0.075, y + 0.03, -z).applyMatrix4(cam.matrixWorld).project(cam);
    const px = (_v.x * 0.5 + 0.5) * window.innerWidth, py = (-_v.y * 0.5 + 0.5) * window.innerHeight;
    this.bubble.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px)`;
    // typewriter
    if (this.typed < this.line.length) {
      this.typed = Math.min(this.line.length, this.typed + dt * 38);
      this.bubbleText.textContent = this.line.slice(0, Math.ceil(this.typed));
    }
    const hint = input.touch ? 'TAP FOR CHECK-UP' : '[X] CHECK-UP';
    if (this.bubbleHint.textContent !== hint) this.bubbleHint.textContent = hint;
  }
}
