// Healthity: a cute floating spherical medical robot with a pixel face that follows every clone,
// warns about their condition and dispenses unhelpful corporate wellness advice.
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { audio } from '../audio/audio.js';
import { buildHealthity } from '../entities/optional.js';
import { damp } from '../core/rng.js';

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
};

const FACE = {
  bleed: 'alarmed', bleed2: 'alarmed', fracture: 'worried', infected: 'worried', hungry: 'neutral', thirsty: 'neutral',
  tired: 'sleepy', insane: 'glitch', lowbp: 'worried', critical: 'alarmed', starving: 'alarmed', dehydrated: 'alarmed',
  slashed: 'alarmed', hurt: 'worried', bandaged: 'happy', splinted: 'happy', insomnia: 'worried', fake: 'glitch',
  pet: 'love', idle: 'happy', monster: 'worried', day: 'neutral', dead: 'dead', healed: 'happy',
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

  say(key, vars = {}) {
    if (this.say_cool > 0 && key !== 'pet' && key !== 'critical') return;
    const arr = LINES[key];
    if (!arr) return;
    let line = arr[Math.floor(Math.random() * arr.length)];
    for (const k in vars) line = line.replace(`{${k}}`, vars[k]);
    this.say_cool = key === 'pet' ? 1.5 : 7;
    this.talkT = Math.min(4, 1 + line.length * 0.04);
    this.face = FACE[key] || 'neutral';
    this.faceT = this.talkT + 1.5;
    this.attention = 1;
    this.game.ui.feed(line, 'healthity', 'HEALTHITY');
    audio.play(key === 'critical' || key === 'bleed2' ? 'healthity_alert' : key === 'pet' ? 'healthity_happy' : 'healthity_talk', { pos: this.pos, length: this.talkT, volume: 0.8 });
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
    const l = g.local;
    const s = l.survival;
    this.say_cool -= dt;
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
    if (this.idleT <= 0) { this.idleT = 90 + Math.random() * 90; if (!g.isLobby || Math.random() < 0.5) this.say('idle'); }
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
    // float near the clone: in view while talking, beside/behind otherwise
    this.attention = damp(this.attention, this.talkT > 0 ? 1 : 0, 2, dt);
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
    this.say('day', { n: day, i: integrity });
  }
}
