// What the water does to the local clone (every client simulates its own clone):
//  - swimming: deep water can't be waded; the clone treads water at the surface (Space strokes up,
//    crouch dives), every second costs stamina and an exhausted clone sinks
//  - drowning: holding your breath under the surface runs out, then it hurts, fast
//  - contamination: wading / swimming in infected water feeds the infection, drinking it far more
//  - prompts: drink the pool water, haul yourself out over the coping
//  - the AQUA-CHECK tester (RMB): dip the strip, read SAFE / TRACE / CONTAMINATED
//  - eating a leech: mild food, real risk
import * as THREE from 'three';
import { engine } from '../../../core/engine.js';
import { input } from '../../../core/input.js';
import { audio } from '../../../audio/audio.js';
import { hash01 } from '../../../core/rng.js';
import { CELL, CANAL_Z0, CANAL_Z1 } from './layout.js';

const GRAVITY = 15.5; // the player controller's gravity (player.js)
const BREATH = 13;
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class WaterPlay {
  constructor(level) {
    this.level = level;
    this.game = level.game;
    this.breath = BREATH;
    this.wasIn = false;
    this.warnT = 0;
    this.lastInfWarn = -99;
    this.gaspT = 0;
    this.pr = null;
    this.prShown = null;
    this.usedE = false;
    this.exposure = 0;
    // prompt / input helpers shared with the leeches
    level.keyName = () => input.keyName('interact');
    level.setPrompt = (text, owner) => this.setPrompt(text, owner);
    level.clearPrompt = () => {};
    level.interactPressed = () => this.interactPressed();
  }

  setPrompt(text, owner) { if (!this.pr) this.pr = { text, owner }; }
  interactPressed() {
    if (this.usedE || !input.hit('interact')) return false;
    this.usedE = true;
    return true;
  }

  _flush() {
    const t = this.pr?.text || null;
    if (t !== this.prShown) { this.game.ui.setPrompt?.(t); this.prShown = t; }
    this.pr = null;
    this.usedE = false;
  }

  // ------------------------------------------------------------------
  // player movement hook: swimming (returns a speed factor, or undefined = not swimming)
  waterMotion(pl, dt, canControl) {
    const lvl = this.level;
    const wl = lvl.waterLevel;
    const depth = pl.waterDepth;
    const floor = wl - depth;
    const swim = depth > 1.12 && pl.pos.y < wl - 0.5 && !pl.onRaft && !pl.dead;
    if (!swim) {
      if (pl.swimming) pl.swimming = false;
      return undefined;
    }
    if (!pl.swimming) {
      pl.swimming = true;
      if (pl.vel.y < -2.5 || pl.fallSpeed < -2.5) {
        const p = _v.set(pl.pos.x, wl + 0.05, pl.pos.z);
        pl.world.playFx({ k: 'splash', p: [p.x, p.y, p.z], n: 30, y: wl, i: 0.9 });
        pl.world.noise.emit(p, 18, 'splash');
        lvl.ripple(p.x, p.z, 1.8);
      }
    }
    const s = pl.survival;
    if (s.stamina <= 0.5) pl._exhausted = true;
    else if (s.stamina > 10) pl._exhausted = false;
    const sinking = pl._exhausted && this.game.day.day > 1; // Day 1: exhausted swimmers just tread slowly
    let target = wl - 0.98; // treading water, eyes just above the surface
    if (!sinking && canControl && input.down('jump')) target = wl - 0.8;
    if (canControl && input.down('crouch')) target = floor + 0.25; // dive
    if (sinking) target = Math.max(floor, pl.pos.y - 1.5);
    const want = clamp((target - pl.pos.y) * 2.4, sinking ? -0.75 : -1.9, 1.7);
    pl.vel.y += (want - pl.vel.y) * Math.min(1, dt * 6);
    pl.vel.y += GRAVITY * dt; // the controller applies gravity afterwards
    // effort: treading costs, swimming costs more, sprinting a lot more
    const cost = pl.sprinting ? 2.5 : pl.moving ? 2.3 : 1.15;
    s.stamina = Math.max(0, s.stamina - dt * cost * (s.fracture ? 1.6 : 1) * (s.blood < 3500 ? 1.3 : 1));
    s.staminaDelay = Math.max(s.staminaDelay, 0.8);
    if (sinking && Math.random() < dt * 0.6) audio.play('water_glug', { volume: 0.5 });
    return pl.sprinting ? 0.6 : 0.55;
  }

  // ------------------------------------------------------------------
  update(dt) {
    const lvl = this.level, l = this.game.local;
    if (!l.world || l.dead) { this.breath = BREATH; this._flush(); return; }
    const s = l.survival;
    const wl = lvl.waterLevel;
    const depth = l.waterDepth ?? 0;
    const inWater = depth > 0.05 && l.pos.y < wl + 0.02 && !l.onRaft;
    const safeDay = this.game.day.day <= 1; // the first day is safe: contamination only starts to bite on Day 2
    const infected = inWater && lvl.waterInfected(l.pos.x, l.pos.z) && !safeDay;
    this.warnT -= dt;
    // ---- contamination from the water itself ----
    if (inWater) {
      const sub = clamp((wl - l.pos.y) / 1.1, 0.12, 1);
      if (infected) {
        s.infection = Math.min(100, s.infection + dt * 0.4 * sub);
        s.sanity = Math.max(0, s.sanity - dt * 0.05);
        this.exposure += dt;
        if (this.exposure > 1.5 && lvl.time - this.lastInfWarn > 40) {
          this.lastInfWarn = lvl.time;
          this.game.ui.toast('Your skin is burning. Something in this water is ALIVE.', 'bad');
          this.game.healthity?.say?.('hurt');
        }
      } else if (!safeDay) {
        s.infection = Math.min(100, s.infection + dt * 0.01 * sub);
        this.exposure = Math.max(0, this.exposure - dt);
      }
    } else this.exposure = Math.max(0, this.exposure - dt * 0.5);
    // ---- breath / drowning ----
    const cam = engine.camera.position;
    const under = cam.y < wl - 0.03 && lvl.waterDepth(cam.x, cam.z) > 0.3;
    if (under) {
      this.breath -= dt;
      if (infected) s.infection = Math.min(100, s.infection + dt * 0.8); // swallowing it
      if (this.breath < 0) {
        s.health -= dt * 6;
        s.damageFlash = Math.min(1, s.damageFlash + dt * 0.8);
        if (Math.random() < dt * 1.5) audio.play('bubble', { volume: 0.7 });
        if (this.warnT <= 0) { this.warnT = 6; this.game.ui.toast('NO AIR — SURFACE!', 'bad'); }
        if (s.health <= 0 && !s.dead) s.die('drowning');
      } else if (this.breath < 4 && this.warnT <= 0) { this.warnT = 4; this.game.ui.toast('Running out of breath...', 'warn'); }
    } else {
      if (this.breath < BREATH * 0.6 && this.gaspT <= 0) { audio.play('gasp', { volume: 0.8 }); this.gaspT = 3; }
      this.breath = Math.min(BREATH, this.breath + dt * 3);
    }
    this.gaspT -= dt;
    if (l.swimming && l._exhausted && this.warnT <= 0) { this.warnT = 7; this.game.ui.toast('Too exhausted to stay up — you are sinking!', 'bad'); }
    // ---- prompts ----
    if (!l.focus && !l.watchOpen) {
      if (l.swimming) this._climbOutPrompt(l);
      else this._drinkPrompt(l);
    }
    this._flush();
  }

  // swimming next to the canal wall, facing the deck: haul yourself out
  _climbOutPrompt(l) {
    const lvl = this.level;
    const z = l.pos.z;
    let n = 0, zEdge = 0;
    if (z > CANAL_Z0 - 0.1 && z < CANAL_Z0 + 0.75) { n = -1; zEdge = CANAL_Z0; }
    else if (z < CANAL_Z1 + 0.1 && z > CANAL_Z1 - 0.75) { n = 1; zEdge = CANAL_Z1; }
    if (!n) return;
    const fz = -Math.cos(l.yaw);
    if (fz * n < 0.35) return;
    const tx = l.pos.x, tz = zEdge + n * 0.65;
    const c = lvl.cell(tx, tz);
    if (!c || c.pool || c.water) return;
    this.setPrompt(`[${input.keyName('interact')}] Haul yourself out`, 'climb');
    if (!this.interactPressed()) return;
    const s = l.survival;
    if (s.stamina < 7) { this.game.ui.toast('Too exhausted to climb out — find a ladder', 'warn'); return; }
    s.stamina -= 7;
    l.swimming = false;
    l.teleport(new THREE.Vector3(tx, 0.03, tz), l.yaw);
    audio.play('splash', { pos: _v.set(tx, lvl.waterLevel, zEdge), intensity: 0.5, volume: 0.6 });
    lvl.ripple(tx, zEdge - n * 0.4, 1.2);
  }

  // looking down at the water within reach
  _waterAim(maxD = 2.4) {
    const lvl = this.level, cam = engine.camera;
    _d.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const wl = lvl.waterLevel;
    if (_d.y > -0.15 || cam.position.y < wl) return null;
    const t = (wl - cam.position.y) / _d.y;
    if (t > maxD) return null;
    const p = _v.copy(cam.position).addScaledVector(_d, t);
    if (lvl.waterDepth(p.x, p.z) < 0.03) return null;
    const hit = lvl.world.physics.raycast(cam.position, _d, t - 0.03, undefined, null, (c) => c !== this.game.local.collider);
    if (hit && hit.dist < t - 0.05) return null;
    return p;
  }

  _drinkPrompt(l) {
    const p = this._waterAim(2.4);
    if (!p) return;
    this.setPrompt(`[${input.keyName('interact')}] Drink the pool water`, 'drink');
    if (!this.interactPressed()) return;
    const s = l.survival;
    const bad = this.level.waterInfected(p.x, p.z) && this.game.day.day > 1;
    s.applyFx({ thirst: 14, sanity: -3, infection: bad ? 26 : this.game.day.day > 1 ? 4 : 0 });
    audio.play('water_glug', { volume: 0.8 });
    audio.play('drink', { volume: 0.6 });
    this.level.ripple(p.x, p.z, 0.8);
    this.game.ui.toast(bad ? 'It tastes sweet and wrong. Your stomach turns.' : 'Lukewarm. Chlorine and something else.', bad ? 'bad' : '');
    if (bad) this.game.healthity?.say?.('hurt');
  }

  // ------------------------------------------------------------------
  // the AQUA-CHECK water tester (RMB)
  toolAction(kind, item, player) {
    if (kind !== 'test') return null;
    const lvl = this.level;
    let pt = null;
    if ((player.waterDepth > 0.05 && player.pos.y < lvl.waterLevel + 0.05) || player.onRaft) pt = player.pos.clone();
    else { const a = this._waterAim(3.2); if (a) pt = a.clone(); }
    if (!pt) {
      this.game.ui.toast('AQUA-CHECK: no sample. Aim at the water (or stand in it).', 'warn');
      audio.play('ui_error', { volume: 0.4, bus: 'ui' });
      return null;
    }
    item.state.result = null;
    player.inv.version++;
    audio.play('ui_type', { volume: 0.6 });
    this.game.ui.toast('Dipping the reagent strip...');
    let t = 0, done = false;
    return {
      tick: (dt) => {
        if (done) return;
        t += dt;
        if (t < 1.2) return;
        done = true;
        const r = this.testWater(pt.x, pt.z);
        item.state.result = r.result;
        player.inv.version++;
        this.game.ui.toast(r.text, r.kind);
        audio.play(r.result === 'bad' ? 'buzzer' : r.result === 'trace' ? 'radio_beep' : 'watch_beep', { volume: 0.7, bus: 'ui' });
      },
      end: () => { if (!done) this.game.ui.toast('Test aborted — hold RMB until the strip develops'); },
    };
  }

  testWater(x, z) {
    const lvl = this.level;
    if (lvl.waterInfected(x, z)) return { result: 'bad', kind: 'bad', text: 'AQUA-CHECK: ■ CONTAMINATED ■ pathogen load HIGH. Do NOT drink or swim.' };
    const day = this.game.day.day;
    const h = hash01(Math.floor(x / CELL), Math.floor(z / CELL), 808, lvl.seed);
    if (day >= 4 && h < 0.15 + day * 0.05) return { result: 'trace', kind: 'warn', text: 'AQUA-CHECK: TRACE contamination. Avoid prolonged contact.' };
    return { result: 'safe', kind: 'good', text: 'AQUA-CHECK: SAFE. Chlorine low, no pathogens detected.' };
  }

  // eating a leech: mild food, real risk
  onItemUsed(type) {
    if (type !== 'leech') return;
    const l = this.game.local, s = l.survival;
    if (Math.random() < 0.35) {
      s.applyFx({ infection: 12, sanity: -6, health: -4 });
      s.bleed = Math.max(s.bleed, 1);
      audio.play('_squelch', { volume: 0.9 });
      this.game.ui.toast('It was still alive. It latched onto the inside of your cheek.', 'bad');
    } else {
      this.game.ui.toast('Chewy. Salty. Warm. You feel slightly less hungry.');
    }
  }

  dispose() {
    if (this.prShown) this.game.ui.setPrompt?.(null);
    void CANAL_Z1;
  }
}
