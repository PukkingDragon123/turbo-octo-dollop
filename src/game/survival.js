// Local survival simulation: hunger, thirst, blood volume & pressure, bleeding, fractures,
// infection, stamina, sleep/insomnia and sanity. Rates are per real-time second and tuned so
// a careful team can survive a full 70-minute dimension with the supplies they find.
//
// SIMPLE MODE (ADVANCED_SURVIVAL = false, the default for now): only health, hunger, thirst, stamina,
// bleeding and SANITY matter (the mechanical-brain HUD: it drains in the dark, alone and near monsters;
// low sanity hallucinates, 0 for a while kills by insanity). Blood pressure / blood volume, infection,
// fractures, rest / microsleep / insomnia keep their code paths but are held at neutral values every
// tick (so other systems writing to them are neutralised too). Flip the flag to bring them back.
//
// needsActive: hunger & thirst only drain while true. Level 0 keeps it false until the camp is built
// (CampMission); Game.loadWorld turns it on for every other level.
import { clamp } from '../core/rng.js';

export const ADVANCED_SURVIVAL = false;
export const INSANE_DEATH = 9; // seconds at zero sanity before the clone dies of insanity

export class Survival {
  constructor() {
    this.advanced = ADVANCED_SURVIVAL;
    this.needsActive = true;
    this.reset();
  }

  reset() {
    this.health = 100;
    this.blood = 5000;       // ml
    this.bleed = 0;          // 0 none, 1 light, 2 heavy
    this.bleedTimer = 0;
    this.fracture = false;
    this.infection = 0;      // 0..100
    this.hunger = 100;       // 100 = full
    this.thirst = 100;
    this.stamina = 40;
    this.maxStamina = 40;
    this.rest = 100;         // 100 = fully rested
    this.sanity = 100;
    this.pain = 0;           // 0..1
    this.stress = 0;         // 0..1 (monster proximity, chase)
    this.heartRate = 72;
    this.bpSys = 120;
    this.bpDia = 80;
    this.temp = 36.7;
    this.sleeping = false;
    this.insomnia = false;
    this.dead = false;
    this.deathCause = '';
    this.staminaDelay = 0;
    this.lastDamage = 0;
    this.damageFlash = 0;
    this.events = []; // condition change notifications for Healthity
    this._prev = {};
    this.time = 0;
    this.microsleep = 0;
    this.insaneT = 0;        // seconds spent at zero sanity (death by insanity at INSANE_DEATH)
    this.lastHit = null;     // { amount, kind, time } of the latest damage (hard deaths break the clone apart)
  }

  // ---- external effects ----
  applyFx(fx = {}) {
    // food and drink patch the clone up a little (unless the item already heals)
    const feed = Math.max(0, fx.hunger || 0) + Math.max(0, fx.thirst || 0);
    if (feed > 0 && !fx.health) this.health = clamp(this.health + feed * 0.2, 0, 100);
    if (fx.hunger) this.hunger = clamp(this.hunger + fx.hunger, 0, 100);
    if (fx.thirst) this.thirst = clamp(this.thirst + fx.thirst, 0, 100);
    if (fx.stamina) this.stamina = clamp(this.stamina + fx.stamina, 0, this.maxStamina);
    if (fx.sanity) this.sanity = clamp(this.sanity + fx.sanity, 0, 100);
    if (fx.rest) this.rest = clamp(this.rest + fx.rest, 0, 100);
    if (fx.health) this.health = clamp(this.health + fx.health, 0, 100);
    if (fx.blood) this.blood = clamp(this.blood + fx.blood, 0, 5000);
    if (fx.infection) this.infection = clamp(this.infection + fx.infection, 0, 100);
    if (fx.pain) this.pain = clamp(this.pain + fx.pain * 0.6, 0, 1);
    if (fx.bleed) this.bleed = Math.max(0, this.bleed + fx.bleed);
    if (fx.fracture && fx.fracture < 0) this.fracture = false;
  }

  damage(amount, kind = 'blunt', opts = {}) {
    if (this.dead) return false;
    // Day 1 probation: bumps and scrapes only, never fatal on their own
    if (this.safeDay) {
      amount *= 0.3;
      opts = { ...opts, heavy: false, fractureChance: 0, fracture: false };
      if (this.health - amount < 15) amount = Math.max(0, this.health - 15);
    }
    const adv = this.advanced;
    this.health -= amount;
    this.lastHit = { amount, kind, time: this.time };
    this.pain = clamp(this.pain + amount / 60, 0, 1);
    this.lastDamage = this.time;
    this.damageFlash = Math.min(1, this.damageFlash + amount / 35 + 0.25);
    this.sanity = clamp(this.sanity - amount * (adv ? 0.2 : 0.08), 0, 100);
    if (kind === 'slash') {
      this.bleed = Math.max(this.bleed, opts.heavy === false ? 1 : 2);
      this.bleedTimer = 0;
      if (adv && Math.random() < (opts.fractureChance ?? 0.2)) this.fracture = true;
    } else if (kind === 'bite') {
      this.bleed = Math.max(this.bleed, 1);
      if (adv) this.infection = clamp(this.infection + 14, 0, 100);
    } else if (kind === 'fall') {
      if (adv && opts.fracture) this.fracture = true;
    } else if (kind === 'blunt' && amount > 25 && !this.safeDay && Math.random() < 0.3) {
      this.bleed = Math.max(this.bleed, 1);
    }
    if (this.health <= 0) this.die(opts.cause || kind);
    return this.dead;
  }

  die(cause) {
    if (this.dead) return;
    this.dead = true;
    this.health = 0;
    this.deathCause = cause;
  }

  // ctx: {dt, sprinting, moving, light (0..1 local brightness), teammatesNear (count within 8m),
  //       monsterVisible (bool), monsterNear (0..1), inWater, safeRoom, lobby}
  update(dt, ctx) {
    if (this.dead) return;
    this.time += dt;
    const lobby = !!ctx.lobby;
    const adv = this.advanced;
    this.safeDay = !!ctx.safeDay;
    if (!adv) this._neutralise();
    const sleepMul = this.sleeping ? 0.5 : 1;
    const fever = this.infection > 50;
    // hunger & thirst (only once the level switched them on: Level 0 waits for the camp)
    if (!lobby && this.needsActive) {
      this.hunger -= dt * (100 / (34 * 60)) * (ctx.sprinting ? 1.6 : 1) * sleepMul;
      this.thirst -= dt * (100 / (24 * 60)) * (ctx.sprinting ? 1.6 : 1) * (fever ? 1.5 : 1) * sleepMul;
    }
    if (!lobby && adv) this.rest -= dt * (100 / (40 * 60)) * (ctx.sprinting ? 1.3 : 1) * (this.sleeping ? 0 : 1);
    this.hunger = clamp(this.hunger, 0, 100);
    this.thirst = clamp(this.thirst, 0, 100);
    if (this.hunger <= 0) this.health -= dt * 0.18;
    if (this.thirst <= 0) this.health -= dt * 0.32;

    // bleeding (light clots after a while, heavy slows to light). Simple mode: it costs health directly.
    if (this.bleed > 0) {
      this.bleedTimer += dt;
      const mul = ctx.sprinting ? 1.5 : 1;
      if (adv) this.blood -= (this.bleed >= 2 ? 9 : 2.2) * dt * mul;
      else this.health = Math.max(this.safeDay ? Math.min(this.health, 15) : -1, this.health - (this.bleed >= 2 ? 0.45 : 0.1) * dt * mul);
      if (this.bleed === 1 && this.bleedTimer > 100) { this.bleed = 0; this.bleedTimer = 0; }
      if (this.bleed >= 2 && this.bleedTimer > 140) { this.bleed = 1; this.bleedTimer = 0; }
      if (!lobby && adv) this.infection += dt * 0.05; // open wound
    } else if (this.hunger > 35 && this.thirst > 35) {
      this.blood = Math.min(5000, this.blood + dt * 1.4);
    }

    // infection
    if (this.infection > 0 && this.infection < 30) this.infection -= dt * 0.02;
    if (this.infection > 80) this.health -= dt * 0.08;
    if (this.infection >= 100) this.health -= dt * 0.3;
    this.infection = clamp(this.infection, 0, 100);
    this.temp = 36.7 + Math.max(0, this.infection - 35) * 0.045;

    // stress from monsters
    const targetStress = clamp((ctx.monsterNear || 0) * 0.8 + (ctx.monsterVisible ? 0.5 : 0) + (ctx.chased ? 0.5 : 0), 0, 1);
    this.stress += (targetStress - this.stress) * Math.min(1, dt * (targetStress > this.stress ? 3 : 0.3));

    // blood pressure & heart rate
    const bv = clamp(this.blood / 5000, 0, 1);
    this.bpSys = Math.round(clamp(122 * Math.pow(bv, 1.6) + this.stress * 25 + (fever ? 6 : 0) - (this.sleeping ? 10 : 0), 40, 190));
    this.bpDia = Math.round(clamp(this.bpSys * 0.65, 25, 120));
    const hrTarget = 68 + this.stress * 70 + (1 - bv) * 90 + (ctx.sprinting ? 45 : ctx.moving ? 12 : 0) + (fever ? 12 : 0) - (this.sleeping ? 12 : 0) + this.pain * 15;
    this.heartRate += (hrTarget - this.heartRate) * Math.min(1, dt * 0.8);

    // stamina
    const exhausted = this.rest < 20 || this.hunger < 15 || this.thirst < 10;
    this.maxStamina = this.fracture ? 25 : 40;
    if (ctx.sprinting && ctx.moving) {
      this.stamina -= dt * 7.5;
      this.staminaDelay = 1.0;
    } else {
      this.staminaDelay -= dt;
      if (this.staminaDelay <= 0) this.stamina += dt * (exhausted ? 3 : 6.5) * (this.sleeping ? 2 : 1);
    }
    this.stamina = clamp(this.stamina, 0, this.maxStamina);

    // sleep
    if (this.sleeping) {
      this.rest = Math.min(100, this.rest + dt * 1.4);
      this.sanity = Math.min(100, this.sanity + dt * 0.25);
      this.health = Math.min(100, this.health + dt * 0.25);
    }
    this.rest = clamp(this.rest, 0, 100);
    if (adv && this.rest < 12 && !this.sleeping) {
      this.microsleep -= dt;
      if (this.microsleep < -6 - Math.random() * 10) this.microsleep = 0.6 + Math.random() * 0.8;
    } else this.microsleep = Math.min(this.microsleep, 0);

    // sanity (always on: the mechanical brain on the HUD)
    if (!lobby) {
      const light = ctx.light ?? 1;
      let ds = 0;
      if (light < 0.12) ds -= adv ? 0.32 : 0.2;
      else if (light < 0.3) ds -= adv ? 0.08 : 0.06;
      if (!ctx.teammatesNear) ds -= adv ? 0.05 : 0.035;
      else if (light > 0.3) ds += 0.25 * Math.min(2, ctx.teammatesNear);
      if (!ctx.teammatesNear && light > 0.6) ds += 0.04; // bright light calms a little
      if (ctx.monsterVisible) ds -= adv ? 2.2 : 1.4;
      ds -= this.stress * (adv ? 0.4 : 0.35);
      if (ctx.safeRoom) ds += 0.6;
      if (this.infection > 60) ds -= 0.1;
      ds -= (ctx.dayPressure || 0) * 0.08;
      if (ds < 0) ds *= ctx.sanityDrainMul ?? 1;
      if (ctx.safeDay) ds = Math.max(ds, 0.05);
      this.sanity = clamp(this.sanity + ds * dt, 0, 100);
    } else {
      this.sanity = Math.min(100, this.sanity + dt * 2);
    }
    // zero sanity: the clone's mind burns out unless it recovers in time
    if (this.sanity <= 0.5 && !lobby && !ctx.safeDay) {
      this.insaneT += dt;
      if (this.insaneT >= INSANE_DEATH) { this.health = 0; this.die('insanity'); return; }
    } else this.insaneT = Math.max(0, this.insaneT - dt * (this.sanity > 3 ? 2 : 0.5));
    this.insomnia = adv && (this.sanity < 30 || this.stress > 0.35 || (ctx.monsterNear || 0) > 0.3);

    // natural healing
    if (this.bleed === 0 && this.hunger > 45 && this.thirst > 45 && this.blood > 3800 && this.infection < 50) {
      this.health = Math.min(100, this.health + dt * 0.12);
    }
    this.pain = Math.max(0, this.pain - dt * 0.02);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.2);

    if (this.blood <= 1500) this.die('blood loss');
    if (this.health <= 0) this.die(this.hunger <= 0 ? 'starvation' : this.thirst <= 0 ? 'dehydration' : this.infection >= 100 ? 'infection' : this.bleed ? 'blood loss' : 'injuries');

    if (!adv) this._neutralise();
    this._detectChanges();
  }

  // simple mode: hold the advanced systems at neutral values (also undoes writes from level code)
  _neutralise() {
    this.infection = 0;
    this.fracture = false;
    this.rest = 100;
    this.microsleep = 0;
    this.insomnia = false;
    this.blood = 5000;
  }

  // condition flags for UI/Healthity
  conditions() {
    const c = [];
    const adv = this.advanced;
    if (this.bleed >= 2) c.push('HEAVY BLEEDING');
    else if (this.bleed === 1) c.push('BLEEDING');
    if (adv && this.fracture) c.push('FRACTURE');
    if (adv && this.infection > 50) c.push('INFECTION');
    else if (adv && this.infection > 25) c.push('INFECTED WOUND');
    if (this.hunger < 20) c.push('STARVING');
    else if (this.hunger < 40) c.push('HUNGRY');
    if (this.thirst < 20) c.push('DEHYDRATED');
    else if (this.thirst < 40) c.push('THIRSTY');
    if (adv && this.rest < 20) c.push('EXHAUSTED');
    else if (adv && this.rest < 40) c.push('TIRED');
    if (this.sanity < 25) c.push('PSYCHOSIS');
    else if (this.sanity < 50) c.push('ANXIOUS');
    if (adv && this.blood < 3200) c.push('LOW BLOOD PRESSURE');
    if (adv && this.insomnia) c.push('INSOMNIA');
    return c;
  }

  _detectChanges() {
    const cur = {
      bleed: this.bleed, fracture: this.fracture, infected: this.infection > 50, hungry: this.hunger < 30,
      thirsty: this.thirst < 30, tired: this.rest < 25, insane: this.sanity < 30, lowbp: this.blood < 3200,
      critical: this.health < 30, starving: this.hunger < 8, dehydrated: this.thirst < 8,
    };
    for (const k in cur) {
      if (this._prev[k] !== undefined && cur[k] !== this._prev[k]) this.events.push({ key: k, value: cur[k] });
    }
    this._prev = cur;
  }

  // compact summary for network (remote Healthity faces, spectator info)
  summary() {
    return {
      h: Math.round(this.health), b: this.bleed, f: this.fracture ? 1 : 0,
      s: Math.round(this.sanity), z: this.sleeping ? 1 : 0,
    };
  }

  serialize() {
    const o = {};
    for (const k of ['health', 'blood', 'bleed', 'fracture', 'infection', 'hunger', 'thirst', 'stamina', 'rest', 'sanity']) o[k] = this[k];
    return o;
  }
  restore(o) { if (o) Object.assign(this, o); }
}
