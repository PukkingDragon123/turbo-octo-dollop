// Item state -> visuals & behaviour: lit glowsticks/flares (with a small pool of real lights),
// filled sample jars, cups of water, armed noise makers, spike traps.
import * as THREE from 'three';
import { net } from '../net/net.js';
import { audio } from '../audio/audio.js';
import { SAMPLES } from './itemdefs.js';

const FLARE_LIFE = 90000;
const GLOW_LIFE = 600000;
const _v = new THREE.Vector3();

export function isLitState(type, s) {
  if (!s?.lit) return false;
  const life = type === 'flare' ? FLARE_LIFE : GLOW_LIFE;
  return Date.now() - (s.litAt || 0) < life;
}

// shared by world props and the first-person held model
export function applyItemVisual(type, s, model, lit = isLitState(type, s)) {
  const ud = model.object.userData;
  if (type === 'sample_jar') {
    ud.setFill?.(s.kind ? 0.7 : 0);
    if (s.kind && SAMPLES[s.kind]) ud.setColor?.(SAMPLES[s.kind].color);
  } else if (type === 'paper_cup') {
    ud.setFill?.(s.water === 0 ? 0 : 0.8);
  } else if (type === 'glowstick' || type === 'flare' || type === 'lighter') {
    ud.setLit?.(lit);
  } else if (type === 'flashlight') {
    ud.setOn?.(false);
  }
}

export class ItemFX {
  constructor(world) {
    this.world = world;
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0x40ff80, 0, 7, 1.8);
      l.visible = false;
      world.group.add(l);
      this.lights.push(l);
    }
    this.t = 0;
    this.trapT = 0;
    world.props.onSpawned.push((p) => this.apply(p));
    this.alarms = new Map(); // prop id -> loop handle
  }

  apply(p) { applyItemVisual(p.type, p.state, p.model, this.isLit(p)); }

  isLit(p) { return isLitState(p.type, p.state); }


  update(dt) {
    this.t += dt;
    const w = this.world;
    const cam = w.game.local.pos;
    // nearest lit items get the real lights
    const lit = [];
    for (const p of w.props.props.values()) {
      if ((p.type === 'flare' || p.type === 'glowstick') && this.isLit(p)) lit.push(p);
    }
    lit.sort((a, b) => a.root.position.distanceToSquared(cam) - b.root.position.distanceToSquared(cam));
    this.lights.forEach((l, i) => {
      const p = lit[i];
      if (!p) { l.visible = false; return; }
      l.visible = true;
      l.position.copy(p.root.position).add(_v.set(0, 0.15, 0));
      if (p.type === 'flare') {
        l.color.setHex(0xff3a1a);
        l.intensity = 5 + Math.sin(this.t * 37 + i) * 1.5 + Math.random() * 1.5;
        l.distance = 10;
        if (Math.random() < dt * 25) w.fx.sparks(p.root.position, 1, null, [1, 0.3, 0.1], 1.5);
        if (Math.random() < dt * 8) w.fx.smoke(p.root.position, 1, [0.5, 0.2, 0.15], 0.5);
      } else {
        l.color.setHex(0x40ff80);
        l.intensity = 2.2;
        l.distance = 6;
      }
    });
    // flares burn out visually
    for (const p of lit) if (p.type === 'flare' && Date.now() - p.state.litAt > FLARE_LIFE - 200) p.model.object.userData.setLit?.(false);
    if (net.isHost) this._hostTraps(dt);
  }

  // host: armed noise makers ring; spike traps hurt whatever steps on them
  _hostTraps(dt) {
    const w = this.world;
    this.trapT -= dt;
    for (const p of w.props.props.values()) {
      if (p.type !== 'noise_maker' || !p.state.armed) continue;
      const age = Date.now() - p.state.armedAt;
      const ringing = age > 6000 && age < 18000;
      if (ringing) {
        if (!this.alarms.has(p.id)) {
          this.alarms.set(p.id, true);
          w.fxAll({ k: 'alarmclock', id: p.id });
        }
        if (Math.random() < dt * 2) w.noise.emit(p.root.position, 34, 'alarm', p.id);
      } else if (age >= 18000) {
        this.alarms.delete(p.id);
        w.props.setState(p.id, { armed: 0 });
      }
    }
    if (this.trapT > 0) return;
    this.trapT = 0.2;
    const mons = w.monsters;
    for (const p of w.props.props.values()) {
      if (p.type !== 'spike_trap' || p.isHeld()) continue;
      const tp = p.root.position;
      if (mons) {
        for (const a of mons.agents.values()) {
          if (a.pos.distanceTo(tp) > 0.75 || (a.trapCool || 0) > w.time) continue;
          a.trapCool = w.time + 3;
          if (a.type === 'bacteria') { a.setState('stunned'); mons.sound('bacteria_growl', a.pos, 1); }
          else { a.hp -= 2; a.stunT = 1.5; mons.sound('stilllife_scream', a.pos, 1); if (a.hp <= 0) mons._kill(a); }
          w.fxAll({ k: 'blood', p: [tp.x, 0.3, tp.z], n: 12 });
          w.fxAll({ k: 'snd', n: 'impact_metal', p: tp.toArray(), v: 1 });
        }
      }
    }
  }

  playFx(m) {
    if (m.k === 'alarmclock') {
      const p = this.world.props.get(m.id);
      if (!p) return;
      const h = audio.loop('phone_ring_loop', { pos: p.root.position.clone(), volume: 1 });
      const follow = setInterval(() => { const q = this.world.props.get(m.id); if (q) h?.setPosition(q.root.position); }, 100);
      setTimeout(() => { clearInterval(follow); h?.stop(0.3); }, 12000);
    }
  }
}
