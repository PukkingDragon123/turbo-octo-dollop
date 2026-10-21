// What the clone carries, shown in its hands (no inventory bar). The 5-slot Inventory stays the data model:
//   1 item  -> right hand (or the left one, keeping the right fist free: wheel / 1-5 / NEXT switches)
//   2 items -> the selected one in the right hand, the other in the left
//   3+      -> an armful: everything stacked in a wobbly pile in front of the camera; no punching or using,
//              and the weight slows the clone down
// The built-in multitool, when drawn ([Q]), takes the right hand: a gadget with an LED battery bar and a
// charge glow at the emitter.
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { buildModel } from '../entities/catalog.js';
import { applyItemVisual } from './itemfx.js';
import { itemDef } from './itemdefs.js';
import { clamp, damp } from '../core/rng.js';
import { LOOT_TABLES } from '../entities/lootables.js';

// new loot: plasma syringes with the medical supplies, caster wheels in toolboxes and storage
try {
  LOOT_TABLES.medical?.push(['plasma_syringe', 2.5]);
  LOOT_TABLES.locker?.push(['plasma_syringe', 0.6]);
  LOOT_TABLES.bedroom?.push(['plasma_syringe', 0.5]);
  LOOT_TABLES.tools?.push(['wheel', 1.6]);
  LOOT_TABLES.storage?.push(['wheel', 1]);
} catch (e) { /* tables missing */ }

export const HANDS = { armfulAt: 3, pileBase: [0, -0.255, -0.42], pileItem: 0.15, slowPerItem: 0.07, slowPerKg: 0.025, minSpeed: 0.5 };
const WEIGHT = {
  medkit: 1.2, welder: 2.2, flashlight: 0.6, canned_food: 0.6, plank: 1.6, metal_scrap: 1.2, wire_spool: 0.8, crowbar: 1.6,
  wrench: 1, water_tester: 0.5, almond_water: 0.6, almond_milk: 0.5, noise_maker: 0.5, battery: 0.3, gear: 0.5, pipe_short: 0.8,
  fuse: 0.6, sample_jar: 0.5, camera_disposable: 0.3, screws: 0.3, fabric_scrap: 0.2, tape_roll: 0.3,
};
export function itemWeight(type) { return itemDef(type).weight ?? WEIGHT[type] ?? 0.4; }

const _box = new THREE.Box3(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const LED_ON = [0x40ff60, 0x80ff40, 0xffd030, 0xff8020, 0xff3020];

export class Hands {
  constructor(player) {
    this.p = player;
    this.R = { type: null, obj: null, built: null, ver: -1 };
    this.L = { type: null, obj: null, built: null, ver: -1 };
    this.pile = new THREE.Group();
    this.pile.name = 'armful';
    engine.vmScene.add(this.pile);
    this.pileKey = '';
    this.pileT = 0;
    this.pileShow = 0;
    this.hidden = false;
    this.tool = null; // { obj, leds:[], glow }
    this.layout = { right: -1, left: -1, pile: [], n: 0, armful: false, weight: 0 };
  }

  // which slot goes where
  compute() {
    const inv = this.p.inv, sl = inv.slots;
    const occ = [];
    for (let i = 0; i < sl.length; i++) if (sl[i]) occ.push(i);
    const n = occ.length, L = this.layout;
    L.n = n; L.right = -1; L.left = -1; L.pile = []; L.armful = n >= HANDS.armfulAt;
    L.weight = 0;
    for (const i of occ) L.weight += itemWeight(sl[i].type);
    if (L.armful) L.pile = occ;
    else if (n === 2) { L.right = sl[inv.selected] ? inv.selected : occ[0]; L.left = occ.find((i) => i !== L.right); }
    else if (n === 1) { if (sl[inv.selected]) L.right = inv.selected; else L.left = occ[0]; }
    return L;
  }

  // speed factor from what is carried
  get speedFactor() {
    const L = this.layout;
    if (L.armful) return clamp(1 - HANDS.slowPerItem * (L.n - 2) - L.weight * HANDS.slowPerKg, HANDS.minSpeed, 1);
    return clamp(1 - L.weight * 0.012, 0.85, 1);
  }

  rightItem() { const i = this.layout.right; return i >= 0 ? this.p.inv.slots[i] : null; }
  leftItem() { const i = this.layout.left; return i >= 0 ? this.p.inv.slots[i] : null; }

  // re-attach everything to freshly built arms (cosmetics change)
  reattach() {
    for (const h of [this.R, this.L]) { h.obj?.removeFromParent(); h.type = null; h.obj = null; }
  }

  _set(side, type, item) {
    const h = this[side], arms = this.p.arms;
    const anchor = side === 'R' ? arms.rightHand : arms.leftHand;
    if (h.type === type && h.obj?.parent === anchor) {
      if (item && h.built && h.ver !== this.p.inv.version) { h.ver = this.p.inv.version; applyItemVisual(type, item.state, h.built); }
      return;
    }
    if (h.obj) h.obj.removeFromParent();
    h.obj = null; h.built = null; h.type = type; h.ver = this.p.inv.version;
    if (!type) return;
    if (type === '__tool') { h.obj = this._toolModel(); anchor.add(h.obj); return; }
    const m = buildModel(type, { seed: 1 });
    const o = m.object;
    if (m.hold) {
      o.position.fromArray(m.hold.pos);
      o.rotation.set(...m.hold.rot);
      if (side === 'L') { o.position.x *= -1; o.rotation.y *= -1; o.rotation.z *= -1; }
    }
    o.traverse((c) => { if (c.isMesh) { c.castShadow = false; c.receiveShadow = false; } });
    h.obj = o; h.built = m;
    if (item) applyItemVisual(type, item.state, m);
    anchor.add(o);
  }

  // the built-in multitool gadget: the old multitool model + an LED battery bar and an emitter glow
  _toolModel() {
    if (this.tool) return this.tool.obj;
    const m = buildModel('multitool', { seed: 1 });
    const g = new THREE.Group();
    const o = m.object;
    if (m.hold) { o.position.fromArray(m.hold.pos); o.rotation.set(...m.hold.rot); }
    o.traverse((c) => { if (c.isMesh) { c.castShadow = false; c.receiveShadow = false; } });
    g.add(o);
    g.updateMatrixWorld(true);
    _box.setFromObject(o);
    const size = _box.getSize(_s), ctr = _box.getCenter(_v);
    const bar = new THREE.Group();
    bar.position.set(ctr.x, _box.max.y + 0.0025, ctr.z + size.z * 0.15);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.004, 0.05), new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.5, metalness: 0.3 }));
    bar.add(housing);
    const leds = [];
    for (let i = 0; i < 5; i++) {
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.003, 0.0065), new THREE.MeshBasicMaterial({ color: 0x202020, toneMapped: false }));
      led.position.set(0, 0.0022, 0.019 - i * 0.0095);
      bar.add(led);
      leds.push(led);
    }
    g.add(bar);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), new THREE.MeshBasicMaterial({ color: 0x6fe0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    glow.position.set(ctr.x, ctr.y, _box.min.z - 0.004);
    g.add(glow);
    this.tool = { obj: g, leds, glow, bar };
    return g;
  }

  _updateTool(dt) {
    const t = this.tool, tool = this.p.tool;
    if (!t || !t.obj.parent) return;
    const b = tool.battery, pw = tool.power || 0;
    const lit = Math.ceil(b * 5 - 0.001);
    const sput = b <= 0.001 || tool.sputter > 0;
    t.leds.forEach((led, i) => {
      // LED 0 is the top of the charge (green); the bar empties from it toward the red end
      const on = 4 - i < lit;
      let col = on ? LED_ON[Math.min(4, 5 - lit)] : 0x1a1a1a;
      if (!on && i === 4 && b < 0.2 && Math.sin(engine.time * 12) > 0) col = 0xff2010;
      if (pw > 0 && on && Math.random() < pw * 0.15) col = 0xffffff;
      led.material.color.setHex(sput && Math.random() < 0.5 ? 0x400808 : col);
    });
    const g = t.glow.material;
    g.color.setHex(this.p.mtMode === 'dismantle' ? 0xff7a30 : 0x6fe0ff);
    g.opacity = damp(g.opacity, pw > 0 ? 0.35 + pw * 0.65 * (0.8 + Math.random() * 0.2) : 0, 14, dt);
    t.glow.scale.setScalar(0.6 + pw * 1.6);
  }

  update(dt, st = {}) {
    const p = this.p, L = this.compute(), inv = p.inv;
    const hide = this.hidden;
    const toolVis = p.toolOut || (!!p.holdAction?.multitool && L.right < 0);
    this._set('R', hide ? null : toolVis ? '__tool' : L.right >= 0 ? inv.slots[L.right].type : null, L.right >= 0 ? inv.slots[L.right] : null);
    this._set('L', hide ? null : L.left >= 0 ? inv.slots[L.left].type : null, L.left >= 0 ? inv.slots[L.left] : null);
    if (this.R.type === 'flashlight') this.R.obj?.userData.setOn?.(p.flashOn);
    if (this.L.type === 'flashlight') this.L.obj?.userData.setOn?.(p.flashOn);
    if (toolVis) this._updateTool(dt);
    // armful pile
    const key = L.armful ? L.pile.map((i) => inv.slots[i].type + (inv.slots[i].state?.lit ? '*' : '')).join(',') : '';
    if (key !== this.pileKey) this._buildPile(key, L);
    this.pileShow = damp(this.pileShow, L.armful && !hide && st.visible !== false ? 1 : 0, 10, dt);
    this.pile.visible = this.pileShow > 0.02 && st.visible !== false;
    if (this.pile.visible) {
      this.pileT += dt;
      const bob = st.bob || 0, ph = (st.phase || 0) * Math.PI;
      const sw = st.sway || { x: 0, y: 0 };
      this.swayX = damp(this.swayX || 0, clamp(-sw.x * 2.5, -0.25, 0.25), 6, dt);
      this.swayY = damp(this.swayY || 0, clamp(sw.y * 2, -0.2, 0.2), 6, dt);
      const [bx, by, bz] = HANDS.pileBase;
      this.pile.position.set(bx + Math.sin(ph) * 0.012 * bob + this.swayX * 0.05, by - (1 - this.pileShow) * 0.25 - Math.abs(Math.cos(ph)) * 0.014 * bob - (st.landing || 0) * 0.03, bz);
      this.pile.rotation.set(this.swayY * 0.3, this.swayX * 0.4, this.swayX * 0.5 + Math.sin(this.pileT * 1.7) * 0.01 + Math.sin(ph) * 0.02 * bob);
      // the pile leans and items shuffle a little (secondary motion)
      this.pile.children.forEach((c, i) => { c.rotation.z = c.userData.rz + Math.sin(this.pileT * 2.1 + i) * 0.015 * (1 + bob) + this.swayX * 0.12 * i; });
    }
  }

  _buildPile(key, L) {
    this.pileKey = key;
    for (const c of [...this.pile.children]) c.removeFromParent();
    if (!key) return;
    let y = 0;
    L.pile.forEach((slot, i) => {
      const it = this.p.inv.slots[slot];
      const m = buildModel(it.type, { seed: 1 });
      applyItemVisual(it.type, it.state, m);
      const o = m.object;
      o.traverse((c) => { if (c.isMesh) { c.castShadow = false; c.receiveShadow = false; } });
      o.updateMatrixWorld(true);
      _box.setFromObject(o);
      const size = _box.getSize(_s), ctr = _box.getCenter(_v);
      const maxD = Math.max(size.x, size.y, size.z, 0.02);
      const s = clamp(HANDS.pileItem / maxD, 0.45, 1.4);
      const pivot = new THREE.Group();
      o.position.sub(ctr);
      pivot.add(o);
      // lie tall items on their side
      const flat = size.y > size.x && size.y > size.z;
      if (flat) pivot.rotation.z = Math.PI / 2;
      const h = (flat ? size.x : size.y) * s;
      pivot.scale.setScalar(s);
      const r = (n) => Math.sin(slot * 12.9898 + n * 78.233) * 0.5;
      pivot.position.set(r(1) * 0.05, y + h * 0.5, r(2) * 0.03);
      pivot.rotation.y = r(3) * 1.2;
      pivot.userData.rz = (pivot.rotation.z || 0) + r(4) * 0.25;
      y += Math.max(0.03, h * 0.9);
      this.pile.add(pivot);
    });
  }

  dispose() {
    this.pile.removeFromParent();
    this.reattach();
  }
}
