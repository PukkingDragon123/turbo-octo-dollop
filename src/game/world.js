// A World = one loaded dimension (lobby or a Backrooms level): physics, props, devices,
// FX, noise, light field, monsters and the level-specific logic object.
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { net } from '../net/net.js';
import { Physics } from '../physics/physics.js';
import { PropManager } from '../entities/props.js';
import { FX } from '../gfx/particles.js';
import { NoiseSystem } from './noise.js';
import { sharedField, applyProbe } from '../gfx/bakedlight.js';
import { GrabServer } from './grab.js';
import { audio } from '../audio/audio.js';
import { ItemFX } from './itemfx.js';

const _c = new THREE.Color();

export class World {
  constructor(game, desc) {
    this.game = game;
    this.desc = desc;
    this.type = desc.type;
    this.seed = desc.seed >>> 0;
    this.group = new THREE.Group();
    this.group.name = `world:${desc.type}`;
    engine.scene.add(this.group);
    this.physics = new Physics();
    this.props = new PropManager(this);
    this.devices = new Map();
    this.fx = new FX(engine.scene);
    this.fx.setPixelScale(window.innerHeight);
    // debris chunks are lit like probe objects (sampled from the level's light field)
    this.fx.debris.lightSampler = (pos, out) => {
      if (this.level?.sampleLight) {
        this.level.sampleLight(pos, out);
        out.multiplyScalar(this.field?.uniforms.uLightScale.value ?? 1);
      } else out.setRGB(0.3, 0.28, 0.25);
    };
    this.noise = new NoiseSystem();
    this.field = sharedField();
    this.field.clear();
    this.time = 0;
    this.probeObjects = new Set();
    this.probeCursor = 0;
    this.grab = new GrabServer(this);
    this.props.bindNet();
    this.props.onSpawned.push((p) => {
      applyProbe(p.root);
      this.updateProbe(p.root);
      this.probeObjects.add(p.root);
    });
    this.props.onRemoved.push((p, fx) => {
      this.probeObjects.delete(p.root);
      if (fx) this.playFx(fx);
    });
    this.physics.onContactForce = (a, b, force, c1, c2) => this.onContact(a, b, force, c1, c2);
    this.lastImpactSound = 0;
    this.itemfx = new ItemFX(this);
    this._bindNet();
  }

  _bindNet() {
    net.onClient('dstate', (m) => {
      const d = this.devices.get(m.id);
      if (!d) return;
      Object.assign(d.state, m.s);
      d.onState(m.s);
    });
    net.onClient('fx', (m) => this.playFx(m));
    net.onHost('act', (m, from) => {
      if (m.k === 'd') {
        const d = this.devices.get(m.id);
        if (d) d.hostAction(m.a, m.d, from);
      } else if (m.k === 'p') {
        const p = this.props.get(m.id);
        if (p?.custom?.hostAction) p.custom.hostAction(m.a, m.d, from);
      }
    });
  }

  addDevice(dev) {
    this.devices.set(dev.id, dev);
    if (!dev.root.parent) this.group.add(dev.root);
    return dev;
  }

  // ---------------- FX / sound replication ----------------
  // host: broadcast an effect to everyone (incl. self)
  fxAll(m) { net.toAll('fx', m); }

  playFx(m) {
    const p = m.p ? new THREE.Vector3(m.p[0], m.p[1], m.p[2]) : null;
    switch (m.k) {
      case 'snd': audio.play(m.n, { pos: p, volume: m.v ?? 1, pitch: m.pi ?? 1, intensity: m.i ?? 1 }); break;
      case 'impact': {
        const fam = { fabric: 'soft', paper: 'cardboard', stone: 'heavy', concrete: 'heavy', rubber: 'soft' }[m.m] || m.m || 'plastic';
        audio.play('impact_' + fam, { pos: p, intensity: m.i, volume: 0.4 + m.i * 0.8 });
        if (m.i > 0.55) this.fx.dustBurst(p, 4 + Math.floor(m.i * 6), [0.7, 0.66, 0.5], 0.6, 0.02);
        break;
      }
      case 'break': {
        audio.play(m.m === 'glass' ? 'break_glass' : m.m === 'plastic' ? 'break_plastic' : 'break_wood', { pos: p, intensity: 1 });
        const col = m.m === 'glass' ? 0xbfe0e0 : m.m === 'wood' ? 0x7a5a3a : m.m === 'cardboard' ? 0xa0784a : 0x888888;
        this.fx.chunks(p, 14, col, 0.08, 3.5, this.level?.floorY?.(p.x, p.z) ?? 0);
        this.fx.dustBurst(p, 16, [0.6, 0.55, 0.45], 1.2);
        break;
      }
      case 'sparks': this.fx.sparks(p, m.n ?? 20, null, [1, 0.75, 0.35], m.s ?? 4); break;
      case 'weld': this.fx.weldSparks(p, m.nrm ? new THREE.Vector3().fromArray(m.nrm) : null); break;
      case 'splash': this.fx.splash(p, m.n ?? 16, m.y ?? 0.1); audio.play('splash', { pos: p, intensity: m.i ?? 0.6 }); break;
      case 'dust': this.fx.dustBurst(p, m.n ?? 20, m.c ?? [0.75, 0.7, 0.55], m.s ?? 1); break;
      case 'ceiling': {
        this.fx.chunks(p, 22, 0xd8d0b8, 0.16, 3, 0, 10);
        this.fx.dustBurst(p, 40, [0.85, 0.82, 0.72], 2.2);
        audio.play('ceiling_break', { pos: p });
        break;
      }
      case 'blood': this.fx.blood(p, m.n ?? 10); break;
      case 'alarmclock': this.itemfx.playFx(m); break;
      default:
        this.level?.playFx?.(m, p);
    }
  }

  // host: physics contact -> impact sounds, noise, breakage
  onContact(a, b, force, c1, c2) {
    for (const ud of [a, b]) {
      if (!ud || ud.kind !== 'prop') continue;
      const prop = ud.prop;
      if (!prop.body || prop.dead) continue;
      const now = this.time;
      if (now - prop.lastImpact < 0.12) continue;
      const mass = prop.body.mass();
      const intensity = Math.min(1, force / (mass * 160 + 40));
      if (intensity < 0.06) continue;
      prop.lastImpact = now;
      const pos = prop.root.position;
      this.noise.emit(pos, 4 + intensity * 18 * Math.min(2, 0.5 + mass / 10), 'impact', prop.id);
      const other = ud === a ? b : a;
      if (other?.kind === 'device') other.device?.onHit?.(intensity, prop);
      if (prop.def.breakF && force > prop.def.breakF && !prop.isHeld()) {
        this.breakProp(prop);
        continue;
      }
      if (this.time - this.lastImpactSound > 0.03) {
        this.lastImpactSound = this.time;
        this.fxAll({ k: 'impact', m: prop.material, p: [pos.x, pos.y, pos.z], i: +intensity.toFixed(2) });
      }
      this.level?.onImpact?.(prop, intensity, other);
      this.game.onPropImpact?.(prop, intensity, other);
    }
  }

  breakProp(prop) {
    if (!net.isHost || prop.dead) return;
    const pos = prop.root.position.clone();
    this.grab.releaseAllFor(prop.id);
    this.props.despawn(prop.id, { k: 'break', m: prop.material, p: [pos.x, pos.y, pos.z] });
    this.noise.emit(pos, 22, 'break');
    for (const t of prop.def.into || []) {
      const off = new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.15 + Math.random() * 0.2, (Math.random() - 0.5) * 0.4);
      this.props.spawn(t, pos.clone().add(off), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, 0)), {
        vel: off.clone().multiplyScalar(4),
      });
    }
  }

  // ---------------- lighting probes ----------------
  updateProbe(root) {
    const probe = root.userData.probe;
    if (!probe) return;
    if (this.level?.sampleLight) {
      this.level.sampleLight(root.position, _c);
      _c.multiplyScalar(this.field.uniforms.uLightScale.value);
    } else _c.setRGB(0.3, 0.28, 0.25);
    probe.lerp(_c, 0.5);
  }

  registerDynamic(root) {
    applyProbe(root);
    this.probeObjects.add(root);
    this.updateProbe(root);
  }
  unregisterDynamic(root) { this.probeObjects.delete(root); }

  // ---------------- update ----------------
  update(dt) {
    this.time += dt;
    this.noise.update(dt);
    this.physics.step(dt);
    this.props.update(dt);
    for (const d of this.devices.values()) d.update(dt);
    this.level?.update(dt);
    this.fx.update(dt);
    this.itemfx.update(dt);
    this.field.update(this.time);
    // probes: refresh a slice per frame
    const arr = [...this.probeObjects];
    const n = Math.min(arr.length, 24);
    for (let k = 0; k < n; k++) {
      this.probeCursor = (this.probeCursor + 1) % Math.max(1, arr.length);
      const o = arr[this.probeCursor];
      if (o && o.parent) this.updateProbe(o);
    }
  }

  dispose() {
    this.level?.dispose?.();
    for (const d of this.devices.values()) d.dispose();
    this.devices.clear();
    this.props.clear();
    this.fx.dispose();
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o.isMesh && o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    });
    this.physics.dispose();
    this.field.clear();
    // remove net handlers owned by the world (re-bound by next world)
    for (const t of ['dstate', 'fx', 'pspawn', 'pspawnMany', 'pdespawn', 'pstate', 'psnap', 'pfreeze']) net.clientHandlers.delete(t);
    for (const t of ['act', 'grab']) net.hostHandlers.delete(t);
  }
}
