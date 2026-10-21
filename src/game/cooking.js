// Physical camp cooking. A CAMP STOVE (prop) carries a cast-iron pan. Light it [E]; drag raw food (mole meat,
// crawler limbs, fungi, a can of stew) into the pan with the grab: it sizzles, steams and browns. Only the side
// facing the pan cooks (the prop's real orientation): flip it [E on the food] or it burns. When both sides are
// done it turns into the cooked item (more food, heals); a side left too long chars it into the burnt item.
// Take it off the pan (grab) and eat it. Cooking is loud: it makes noise creatures can hear.
//   state on food props: c = [sideUp, sideDown] doneness (0 raw .. 1 cooked .. 2 burnt), kept across the type swaps
//   state on the stove: lit (0/1)
import * as THREE from 'three';
import { net } from '../net/net.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { itemName } from './itemdefs.js';

// raw type -> [cooked type, burnt type (null: can't burn), seconds per side]
export const COOK = {
  mole_meat: ['mole_meat_cooked', 'mole_meat_burnt', 9],
  crawler_meat: ['crawler_meat_cooked', 'crawler_meat_burnt', 11],
  fungus_black: ['fungus_black_cooked', 'fungus_black_burnt', 6],
  fungus_glow: ['fungus_glow_cooked', 'fungus_glow_burnt', 5],
  fungus_shelf: ['fungus_shelf_cooked', 'fungus_shelf_burnt', 7],
  fungus_puff: ['fungus_puff_cooked', 'fungus_puff_burnt', 6],
  canned_food: ['canned_food_hot', null, 10],
};
// every cookable / cooked / burnt type -> { base, stage }
export const FOOD = {};
for (const [base, [ck, bt]] of Object.entries(COOK)) {
  FOOD[base] = { base, stage: 0 };
  FOOD[ck] = { base, stage: 1 };
  if (bt) FOOD[bt] = { base, stage: 2 };
}
const COOKED_TINT = new THREE.Color(0.72, 0.5, 0.3);
const BURNT_TINT = new THREE.Color(0.1, 0.08, 0.07);
const WHITE = new THREE.Color(1, 1, 1);
const _v = new THREE.Vector3(), _u = new THREE.Vector3(), _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const stoves = new Set();

// which side faces up: 0 = the food's own +Y side, 1 = its -Y side
function upSide(p) { return _u.copy(UP).applyQuaternion(p.root.quaternion).y >= 0 ? 0 : 1; }
function cookOf(p) {
  const c = p.state.c;
  if (Array.isArray(c)) return c;
  const st = FOOD[p.type]?.stage || 0;
  return [st, st];
}

// ---------------------------------------------------------------------------- stove
class StoveBehaviour {
  constructor(prop, world) {
    this.prop = prop;
    this.world = world;
    this.flame = prop.model.parts?.flame || null;
    this.foods = [];
    this.scanT = 0;
    this.sendT = 0;
    this.sizzleT = 0;
    this.noiseT = 0;
    this.lit = 0;
    stoves.add(this);
  }

  panPos(out = _v) {
    const a = this.prop.model.anchors?.pan;
    out.copy(a || _v.set(0, 0.35, 0));
    return this.prop.root.localToWorld(out);
  }

  prompt() { return `[${input.keyName('interact')}] ${this.prop.state.lit ? 'Turn off' : 'Light'} the camp stove`; }
  interact() { net.toHost('act', { k: 'p', id: this.prop.id, a: 'toggle' }); }

  hostAction(a) {
    if (a !== 'toggle') return;
    const lit = this.prop.state.lit ? 0 : 1;
    this.world.props.setState(this.prop.id, { lit });
    this.world.fxAll({ k: 'snd', n: lit ? 'stove_ignite' : 'ui_type', p: this.prop.root.position.toArray(), v: 0.8 });
  }

  // props resting in the pan
  _scan() {
    const pan = this.panPos(new THREE.Vector3());
    this.foods.length = 0;
    this.world.props.query(pan, 0.3, (p) => {
      if (p === this.prop || p.dead || !FOOD[p.type] || p.isHeld()) return;
      const q = p.root.position;
      if (Math.hypot(q.x - pan.x, q.z - pan.z) > 0.17 || q.y < pan.y - 0.04 || q.y > pan.y + 0.14) return;
      this.foods.push(p);
    });
    return pan;
  }

  update(dt) {
    const lit = this.prop.state.lit ? 1 : 0;
    this.lit += (lit - this.lit) * Math.min(1, dt * 6);
    const f = this.flame;
    if (f?.material) f.material.emissiveIntensity = this.lit * (2.2 + Math.sin(this.world.time * 31) * 0.4 + Math.random() * 0.3);
    if (!lit) { this.foods.length = 0; return; }
    this.scanT -= dt;
    const pan = this.scanT <= 0 ? this._scan() : this.panPos(new THREE.Vector3());
    if (this.scanT <= 0) this.scanT = 0.2;
    // visible blue burner flicker close by
    if (Math.random() < dt * 20) this.world.fx.glow(_v.copy(pan).setY(pan.y - 0.055), [0.25, 0.45, 1.6], 0.07, 0.08);
    if (!this.foods.length) return;
    // sizzle + steam / smoke (every peer, from the replicated cook state)
    let char = 0;
    for (const p of this.foods) char = Math.max(char, Math.max(...cookOf(p)));
    this.sizzleT -= dt;
    if (this.sizzleT <= 0) { this.sizzleT = 0.9 + Math.random() * 0.4; audio.play('sizzle', { pos: pan, volume: 0.55 + Math.min(0.4, this.foods.length * 0.15), intensity: Math.min(1, char) }); }
    if (Math.random() < dt * 9) {
      const k = Math.min(1, Math.max(0, char - 0.9));
      const g = 0.85 - k * 0.6;
      this.world.fx.smoke(_v.copy(pan).add({ x: (Math.random() - 0.5) * 0.15, y: 0.05, z: (Math.random() - 0.5) * 0.15 }), 1, [g, g, g * 0.97], 0.5 + k * 0.4);
    }
    if (!net.isHost) return;
    // ---- host: cook the side that faces the pan ----
    let changed = false;
    for (const p of this.foods) {
      const [, , secs] = COOK[FOOD[p.type].base];
      const c = cookOf(p).slice();
      const down = upSide(p) === 0 ? 1 : 0;
      c[down] = Math.min(3, c[down] + dt / secs);
      c[1 - down] = Math.min(3, c[1 - down] + (dt / secs) * 0.12); // a little heat comes through
      p.state.c = c;
      if (!p._sizzled) { p._sizzled = true; this.world.fxAll({ k: 'snd', n: 'sizzle', p: pan.toArray(), v: 1, i: 1 }); }
      changed = true;
      this._stage(p, c);
    }
    this.sendT -= dt;
    if (changed && this.sendT <= 0) {
      this.sendT = 0.4;
      for (const p of this.foods) if (!p.dead) this.world.props.setState(p.id, { c: p.state.c.map((x) => +x.toFixed(2)) });
    }
    this.noiseT -= dt;
    if (this.noiseT <= 0) { this.noiseT = 2; this.world.noise.emit(pan, 9, 'cook'); }
  }

  // host: raw -> cooked -> burnt type swap (same pose, cook state carried over)
  _stage(p, c) {
    const F = FOOD[p.type], [ck, bt] = COOK[F.base];
    // (a can just heats through: no sides, no burning)
    const want = !bt ? (Math.max(c[0], c[1]) >= 1 ? 1 : 0) : Math.max(c[0], c[1]) >= 2 ? 2 : Math.min(c[0], c[1]) >= 1 ? 1 : 0;
    if (want <= F.stage) return;
    const type = want === 2 ? bt : ck;
    const pos = p.root.position.clone(), q = p.root.quaternion.clone();
    this.world.props.despawn(p.id);
    p.dead = true;
    this.world.props.spawn(type, pos, q, { state: { c: c.map((x) => +x.toFixed(2)) } });
    if (want === 2) this.world.fxAll({ k: 'snd', n: 'sizzle', p: pos.toArray(), v: 1, i: 1 });
  }

  dispose() { stoves.delete(this); }
}

// ---------------------------------------------------------------------------- food
class FoodBehaviour {
  constructor(prop, world) {
    this.prop = prop;
    this.world = world;
    this.mats = [];
    const part = prop.model.parts?.food;
    if (part) part.traverse((o) => { if (o.isMesh && o.material && !this.mats.includes(o.material)) this.mats.push(o.material); });
    this.key = '';
    this.t = 0;
    this._tint(true);
  }

  // on a lit stove's pan?
  _stove() {
    const q = this.prop.root.position;
    for (const s of stoves) {
      if (!s.prop.state.lit || s.prop.dead) continue;
      const pan = s.panPos(new THREE.Vector3());
      if (Math.hypot(q.x - pan.x, q.z - pan.z) < 0.18 && q.y > pan.y - 0.05 && q.y < pan.y + 0.16) return s;
    }
    return null;
  }

  prompt() {
    if (!this._stove()) return null; // default pick-up prompt
    const c = cookOf(this.prop);
    const up = upSide(this.prop);
    const word = (x) => (x >= 2 ? 'burnt' : x >= 1 ? 'done' : x > 0.5 ? 'browning' : 'raw');
    return `[${input.keyName('interact')}] Flip ${itemName(this.prop.type)} (top ${word(c[up])}, bottom ${word(c[1 - up])})`;
  }

  interact() { net.toHost('act', { k: 'p', id: this.prop.id, a: 'flip' }); }

  hostAction(a) {
    if (a !== 'flip') return;
    const b = this.prop.body;
    if (!b) return;
    // toss it up with half a turn about a random horizontal axis: it lands on its other side
    const ang = Math.random() * Math.PI * 2;
    b.wakeUp();
    b.setLinvel({ x: 0, y: 2.3, z: 0 }, true);
    b.setAngvel({ x: Math.cos(ang) * 6.6, y: (Math.random() - 0.5) * 2, z: Math.sin(ang) * 6.6 }, true);
    this.world.fxAll({ k: 'snd', n: 'pan_flip', p: this.prop.root.position.toArray(), v: 0.9 });
  }

  // colour: raw -> golden brown -> charred, from the side that faces up (mostly) and the one below
  _tint(force) {
    if (!this.mats.length) return;
    const c = cookOf(this.prop);
    const up = upSide(this.prop);
    const d = c[up] * 0.75 + c[1 - up] * 0.25;
    const key = d.toFixed(2);
    if (!force && key === this.key) return;
    this.key = key;
    const col = d <= 1 ? _c0.copy(WHITE).lerp(COOKED_TINT, d) : _c0.copy(COOKED_TINT).lerp(BURNT_TINT, Math.min(1, (d - 1) / 1));
    for (const m of this.mats) { m.color.copy(col); m.roughness = 0.45 + Math.min(1, d) * 0.2 + Math.max(0, d - 1) * 0.3; }
  }

  update(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.15;
    this._tint(false);
  }
}
const _c0 = new THREE.Color();

export function registerCooking(world) {
  world.props.registerBehaviour('camp_stove', (p, w) => new StoveBehaviour(p, w));
  for (const type of Object.keys(FOOD)) if (type !== 'canned_food') world.props.registerBehaviour(type, (p, w) => new FoodBehaviour(p, w));
}
export { stoves };
void _q;
