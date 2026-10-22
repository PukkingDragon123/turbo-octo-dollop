// Camp kiosks, green phosphor / Fallout-terminal style (ui/phosphor.js, gfx/hologram.js):
//   ShopKiosk   COMPANY STORE: a 3D interactive console. Three item HOLOGRAMS spin above a projector deck
//               (previous / selected / next, the selected one big and centred) under holographic name + price.
//               Physical controls on the sloped console: CATEGORY DRUM (turn it), < > buttons, a small green CRT
//               with pictograms and tick-mark stats, and the big BUY button: slam it and the hologram beams down
//               (the item materialises in the crusher's teleporter). A split-flap counter shows the credits.
//               Look at a control and press [E] (touch: USE); [E] on the deck / screen leans in (A/D item, W/S
//               category, E / click / Enter buy, mouse wheel item).
//   QuestKiosk  FIELD OPS: the quest network on a green CRT as glowing glyph nodes with pulsing links; the
//               selected node opens a rotating holographic ring; a desk projector shows its section hologram.
// Both start locked: FIELD OPS powers up with CONSTRUCT A BASE, the store with EARN $1,000.
import * as THREE from 'three';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { Device } from './devices.js';
import * as Mat from '../gfx/materials.js';
import { CrtScreen } from '../ui/crt.js';
import { buildModel } from '../entities/catalog.js';
import { juice } from '../gfx/juice.js';
import { holoMaterial, holoLineMaterial, buildHologram, holoCone } from '../gfx/hologram.js';
import { PH, ptext, pfont, rule, brackets, ticks, icon, phosphorFx } from '../ui/phosphor.js';
import { SECTIONS, SHOP, SHOP_CATS, fmt$, short$, shopName, unlockLabel } from './economy.js';

const PI = Math.PI;
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ease = (t) => t * t * (3 - 2 * t);

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.userData.ctx = ctx;
  return t;
}
function box(w, h, d, mat, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}
function cyl(r, h, mat, x, y, z, parent, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}
// additive "light" plane (holographic text, etched glow)
function glowPlane(w, h, tex, parent) {
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  mat.userData.noProbe = true;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.userData.noProbe = true;
  m.renderOrder = 7;
  parent.add(m);
  return m;
}
const greenEmissive = (i = 1.6) => { const m = new THREE.MeshStandardMaterial({ color: 0x062a10, emissive: 0x4dff7a, emissiveIntensity: i, roughness: 0.35 }); m.userData.noProbe = true; return m; };
const ITEM_ICON = { basic: 'food', weapons: 'blade', armor: 'shield', upgrades: 'gear', apps: 'radio' };
const UP_ICON = { battery: 'battery', carry: 'arm', sanity: 'brain', plasma: 'drop' };

// etched green sign texture (dark plate, glowing letters, rule underneath)
function signTex(title, sub) {
  return canvasTex(1024, 256, (c, w, h) => {
    c.fillStyle = '#040c06'; c.fillRect(0, 0, w, h);
    ptext(c, title, w / 2, 26, 110, { align: 'center', c: PH.fg, blur: 22 });
    rule(c, 120, w - 120, 150, PH.dim, 4);
    ptext(c, sub, w / 2, 172, 46, { align: 'center', c: PH.dim, blur: 8 });
    icon(c, 'vault', 70, 100, 44, PH.fg, 5);
    icon(c, 'vault', w - 70, 100, 44, PH.fg, 5);
  });
}

// ------------------------------------------------------------------------------------------ kiosk base
class KioskBase extends Device {
  constructor(world, id, mission, x, y, z, yaw) {
    super(world, id, {});
    this.mission = mission;
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    this.kind = id;
    this.t = 0;
    this.range = 2.6;
  }
  get econ() { return this.mission.econ; }
  get unlocked() { return !!this.econ?.has(this.unlockKey); }
  nearLocal(r = 12) { return this.root.position.distanceTo(this.world.game.local.pos) < r; }

  _open(spec) {
    const self = this;
    this.world.game.terminal.open({ device: this, screen: this.scr, mesh: this.screenMesh, ...spec, onClose() { self.sess = null; } });
    this.sess = this.world.game.terminal.session;
  }
  get inSession() { return this.world.game.terminal.session?.device === this; }

  // root-local point of a hit
  _local(hit) { return hit?.point ? this.root.worldToLocal(_v.copy(hit.point)) : null; }

  _lockedScreen(ctx, w, h, t, title, need) {
    ptext(ctx, title, w / 2, h * 0.12, Math.round(h * 0.11), { align: 'center', c: PH.dim });
    icon(ctx, 'lock', w / 2, h * 0.45, h * 0.12, Math.floor(t * 2) % 2 ? PH.hi : PH.dim, 4);
    ptext(ctx, 'OFFLINE', w / 2, h * 0.62, Math.round(h * 0.1), { align: 'center', c: PH.fg });
    rule(ctx, w * 0.25, w * 0.75, h * 0.75, PH.dim);
    ptext(ctx, need, w / 2, h * 0.79, Math.round(h * 0.065), { align: 'center', c: PH.dim });
    phosphorFx(ctx, w, h, t);
  }
}

// ------------------------------------------------------------------------------------------ COMPANY STORE
const SLOT_X = 0.47, HOLO_Y = 1.4, DECK_Y = 0.93;

export class ShopKiosk extends KioskBase {
  constructor(world, mission, x, y, z, yaw) {
    super(world, 'kiosk_shop', mission, x, y, z, yaw);
    this.label = 'COMPANY STORE';
    this.unlockKey = 'term:shop';
    this.cat = 0;
    this.sel = 0;
    this.slide = 0;
    this.beam = null;
    this.drumA = 0;
    this.holos = new Map();
    this.press = { prev: 0, next: 0, buy: 0, drum: 0 };
    this._txtKey = '';
    this._digits = '';
    this._build();
  }

  // ---------------- model
  _build() {
    const R = this.root;
    const olive = Mat.get('metal_green'), dark = Mat.get('metal_dark'), steel = Mat.get('steel'), black = Mat.get('plastic_black');
    // cabinet + trim
    box(1.4, 0.86, 0.62, olive, 0, 0.47, 0, R);
    box(1.44, 0.1, 0.66, dark, 0, 0.05, 0, R);
    box(1.46, 0.035, 0.68, steel, 0, 0.915, 0, R);
    for (const s of [-1, 1]) box(0.05, 0.84, 0.05, steel, s * 0.7, 0.47, 0.3, R);
    // backdrop: dark glass with a faint phosphor grid, framed
    box(1.46, 1.3, 0.06, dark, 0, 1.58, -0.33, R);
    const grid = canvasTex(512, 456, (c, w, h) => {
      c.fillStyle = '#020804'; c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(77,255,122,0.10)'; c.lineWidth = 1;
      for (let x = 0; x < w; x += 32) { c.beginPath(); c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, h); c.stroke(); }
      for (let y = 0; y < h; y += 32) { c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(w, y + 0.5); c.stroke(); }
      brackets(c, 14, 14, w - 28, h - 28, 30, 'rgba(77,255,122,0.35)', 3);
    });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 1.2), new THREE.MeshStandardMaterial({ map: grid, emissive: 0xffffff, emissiveMap: grid, emissiveIntensity: 0.6, roughness: 0.15, metalness: 0.2 }));
    back.position.set(0, 1.58, -0.296); R.add(back);
    // marquee
    box(1.46, 0.26, 0.12, dark, 0, 2.36, -0.3, R);
    this.signMat = new THREE.MeshStandardMaterial({ map: signTex('COMPANY STORE', 'DELIVERY BY TELEPORT'), emissive: 0xffffff, emissiveIntensity: 0.1, roughness: 0.5 });
    this.signMat.emissiveMap = this.signMat.map;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.24), this.signMat); sign.position.set(0, 2.36, -0.238); R.add(sign);
    // projector deck: three emitters + light cones
    this.emitMat = greenEmissive(1.4);
    this.cones = [];
    for (let i = -1; i <= 1; i++) {
      const x = i * SLOT_X;
      cyl(0.11, 0.04, dark, x, DECK_Y + 0.02, -0.1, R, 24);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.01, 6, 32), this.emitMat); ring.rotation.x = -PI / 2; ring.position.set(x, DECK_Y + 0.045, -0.1); R.add(ring);
      cyl(0.05, 0.012, this.emitMat, x, DECK_Y + 0.046, -0.1, R, 16);
      const cm = holoMaterial(0x4dff7a); cm.uniforms.uAlpha.value = 0.25;
      const cone = holoCone(0.05, i ? 0.17 : 0.24, 0.62, cm); cone.position.set(x, DECK_Y + 0.36, -0.1); R.add(cone);
      this.cones.push(cone);
    }
    this.holoRoot = new THREE.Group(); this.holoRoot.position.set(0, 0, -0.1); R.add(this.holoRoot);
    // holographic name + price above the centre slot
    this.nameTex = canvasTex(768, 96, () => {});
    this.priceTex = canvasTex(512, 128, () => {});
    this.namePlane = glowPlane(0.86, 0.108, this.nameTex, R); this.namePlane.position.set(0, 2.06, -0.12);
    this.pricePlane = glowPlane(0.5, 0.125, this.priceTex, R); this.pricePlane.position.set(0, 1.93, -0.12);
    // sloped console with the physical controls
    const con = new THREE.Group(); con.position.set(0, 0.95, 0.19); con.rotation.x = 0.5; R.add(con);
    this.console = con;
    box(1.38, 0.05, 0.3, dark, 0, 0, 0, con);
    box(1.38, 0.012, 0.3, Mat.get('rubber'), 0, 0.03, 0, con);
    // category drum (pentagonal, etched labels), turned by the crank knob beside it
    const drum = new THREE.Group(); drum.position.set(-0.5, 0.075, 0); con.add(drum);
    this.drum = drum;
    SHOP_CATS.forEach((c, k) => {
      const a = (k / SHOP_CATS.length) * PI * 2;
      const tex = canvasTex(256, 64, (cx, w, h) => {
        cx.fillStyle = '#0b1a0e'; cx.fillRect(0, 0, w, h);
        ptext(cx, c.name, w / 2 + 14, 10, 42, { align: 'center', c: PH.fg, blur: 6 });
        icon(cx, ITEM_ICON[c.id], 22, 32, 14, PH.fg, 3, false);
      });
      const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.9, roughness: 0.6 });
      mat.userData.noProbe = true;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.05), mat);
      face.position.set(0, Math.sin(a) * 0.035, Math.cos(a) * 0.035);
      face.rotation.x = -a;
      drum.add(face);
    });
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 5), Mat.get('metal_dark')); hub.rotation.z = PI / 2; drum.add(hub);
    for (const s of [-1, 1]) { const d = cyl(0.05, 0.012, steel, -0.5 + s * 0.108, 0.075, 0, con, 20); d.rotation.z = PI / 2; }
    this.knob = new THREE.Group(); this.knob.position.set(-0.64, 0.075, 0); con.add(this.knob);
    const kn = cyl(0.03, 0.03, black, 0, 0, 0, this.knob, 14); kn.rotation.z = PI / 2;
    box(0.012, 0.05, 0.012, steel, -0.02, 0.025, 0, this.knob);
    // < > buttons with glowing arrows
    const arrowTex = (dir) => canvasTex(64, 64, (c, w, h) => { c.fillStyle = '#000'; c.fillRect(0, 0, w, h); c.fillStyle = PH.fg; c.shadowColor = PH.fg; c.shadowBlur = 8; c.beginPath(); if (dir < 0) { c.moveTo(42, 14); c.lineTo(18, 32); c.lineTo(42, 50); } else { c.moveTo(22, 14); c.lineTo(46, 32); c.lineTo(22, 50); } c.closePath(); c.fill(); });
    this.btn = {};
    for (const [key, x, dir] of [['prev', -0.27, -1], ['next', 0.27, 1]]) {
      const g = new THREE.Group(); g.position.set(x, 0.03, 0); con.add(g);
      box(0.1, 0.02, 0.1, steel, 0, 0.005, 0, con).position.set(x, 0.035, 0);
      box(0.08, 0.03, 0.08, black, 0, 0.03, 0, g);
      const p = glowPlane(0.06, 0.06, arrowTex(dir), g); p.rotation.x = -PI / 2; p.position.y = 0.046;
      this.btn[key] = g;
    }
    // small green CRT in a bezel
    box(0.38, 0.03, 0.27, black, 0, 0.035, 0, con);
    this.screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.225), new THREE.MeshBasicMaterial({ color: 0 }));
    this.screenMesh.rotation.x = -PI / 2; this.screenMesh.position.set(0, 0.052, 0); con.add(this.screenMesh);
    this.scr = new CrtScreen(512, 340, 'green');
    this.scr.fps = 6;
    this.scr.attach(this.screenMesh, 1.5);
    // the big BUY button
    const bb = new THREE.Group(); bb.position.set(0.52, 0.03, 0); con.add(bb);
    cyl(0.085, 0.025, steel, 0, 0.01, 0, bb, 24);
    cyl(0.075, 0.012, Mat.get('metal_yellow'), 0, 0.028, 0, bb, 24);
    this.buyMat = greenEmissive(1.2);
    this.buyCap = new THREE.Mesh(new THREE.SphereGeometry(0.06, 20, 10, 0, PI * 2, 0, PI / 2), this.buyMat);
    this.buyCap.scale.y = 0.55; this.buyCap.position.y = 0.034; bb.add(this.buyCap);
    const lab = canvasTex(128, 64, (c, w, h) => { c.fillStyle = '#000'; c.fillRect(0, 0, w, h); ptext(c, 'BUY', w / 2, 8, 46, { align: 'center', c: PH.hi, blur: 8 }); });
    const lp = glowPlane(0.08, 0.04, lab, bb); lp.rotation.x = -PI / 2; lp.position.set(0, 0.034, 0.1);
    this.btn.buy = bb;
    // split-flap credits counter on the cabinet front
    box(0.7, 0.13, 0.03, black, 0.0, 0.72, 0.318, R);
    const lt = canvasTex(256, 48, (c, w, h) => { c.fillStyle = '#000'; c.fillRect(0, 0, w, h); ptext(c, 'CREDITS', 4, 4, 38, { c: PH.dim, blur: 4 }); });
    glowPlane(0.16, 0.03, lt, R).position.set(-0.26, 0.815, 0.335);
    this.digitAtlas = canvasTex(704, 96, (c, w, h) => {
      c.fillStyle = '#030a05'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 11; i++) {
        c.fillStyle = '#071a0c'; c.fillRect(i * 64 + 3, 3, 58, 90);
        c.fillStyle = '#000'; c.fillRect(i * 64 + 3, 47, 58, 2);
        if (i < 10) ptext(c, String(i), i * 64 + 32, 6, 84, { align: 'center', c: PH.fg, blur: 10 });
      }
    });
    this.flaps = [];
    for (let i = 0; i < 7; i++) {
      const tex = this.digitAtlas.clone(); tex.repeat.set(1 / 11, 1); tex.offset.set(10 / 11, 0); tex.needsUpdate = true;
      const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
      mat.userData.noProbe = true;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.1), mat);
      m.position.set(-0.24 + i * 0.08, 0.72, 0.335); R.add(m);
      this.flaps.push({ m, tex, d: 10, flip: 0 });
    }
    // controls (root-local) + colliders
    this.root.updateMatrixWorld(true);
    con.updateMatrix();
    const at = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(con.matrix);
    this.controls = { drum: at(-0.55, 0.075, 0), prev: at(-0.27, 0.06, 0), screen: at(0, 0.05, 0), next: at(0.27, 0.06, 0), buy: at(0.52, 0.06, 0) };
    const rot = [0.5, 0, 0];
    this.addColliders([
      { type: 'box', size: [1.46, 0.92, 0.68], pos: [0, 0.46, 0] },
      { type: 'box', size: [1.46, 1.32, 0.1], pos: [0, 1.58, -0.33] },
      { type: 'box', size: [1.46, 0.26, 0.12], pos: [0, 2.36, -0.3] },
      { type: 'box', size: [1.38, 0.08, 0.3], pos: con.position.toArray(), rot },
      ...['drum', 'prev', 'next', 'buy'].map((k) => ({ type: 'box', size: [k === 'drum' ? 0.26 : 0.13, 0.08, 0.13], pos: this.controls[k].toArray(), rot })),
      // the projector volume: aiming at a hologram leans in to browse
      { type: 'box', size: [1.3, 0.7, 0.3], pos: [0, 1.4, -0.1] },
    ]);
  }

  _items() { return SHOP.filter((s) => s.cat === SHOP_CATS[this.cat].id); }
  _cur() { const it = this._items(); return it[Math.min(this.sel, it.length - 1)] || null; }

  // which control is the crosshair on? (root-local hit point -> nearest control)
  _control(hit) {
    const p = this._local(hit);
    if (!p) return 'browse';
    let best = 'browse', bd = 0.12;
    for (const k in this.controls) { const d = p.distanceTo(this.controls[k]); if (d < bd) { bd = d; best = k; } }
    return best === 'screen' ? 'browse' : best;
  }

  prompt(player, hit) {
    const k = input.keyName('interact');
    if (!this.unlocked) return 'COMPANY STORE — OFFLINE. Complete EARN $1,000 to power it up.';
    const it = this._cur(), c = this._control(hit);
    if (c === 'prev') return `[${k}] < PREVIOUS ITEM`;
    if (c === 'next') return `[${k}] NEXT ITEM >`;
    if (c === 'drum') return `[${k}] TURN THE CATEGORY DRUM (${SHOP_CATS[(this.cat + 1) % SHOP_CATS.length].name} next)`;
    if (c === 'buy') {
      if (!it) return 'Nothing in this category';
      const st = this.econ.shopStatus(it);
      return st.ok ? `[${k}] SLAM BUY — ${shopName(it)} ${fmt$(it.price)}` : `${shopName(it)} — ${st.why}`;
    }
    return `[${k}] Lean in to browse the COMPANY STORE (${short$(this.world.game.run.credits)})`;
  }

  interact(player, kind, hit) {
    if (!this.unlocked) { audio.play('ui_error', { volume: 0.4, bus: 'ui' }); this.world.game.ui.toast('STORE OFFLINE: earn $1,000 first', 'warn'); return; }
    const c = this._control(hit);
    if (c === 'prev') this._step(-1);
    else if (c === 'next') this._step(1);
    else if (c === 'drum') this._turnDrum(1);
    else if (c === 'buy') this._buy();
    else this._lean();
  }

  _lean() {
    const self = this;
    const target = new THREE.Vector3(0, 1.3, 0).applyMatrix4(this.root.matrixWorld);
    this._open({
      target, distance: 1.55,
      view() { return self._view(); },
      select() { self._buy(); },
      draw(ctx, w, h, pal, t) { self._drawCrt(ctx, w, h, t, true); },
    });
  }

  _view() {
    if (input.hit('left')) this._step(-1);
    if (input.hit('right')) this._step(1);
    if (input.hit('forward')) this._turnDrum(-1);
    if (input.hit('back')) this._turnDrum(1);
    const wh = input.consumeWheel();
    if (wh) this._step(wh > 0 ? 1 : -1);
    const st = this._cur() && this.econ ? this.econ.shopStatus(this._cur()) : { ok: false };
    return { items: [{ label: 'BUY', disabled: !st.ok }] };
  }

  _step(d) {
    const n = this._items().length;
    if (!n) return;
    this.sel = (this.sel + d + n) % n;
    this.slide = d;
    this.press[d < 0 ? 'prev' : 'next'] = 1;
    audio.play('button_press', { pos: this.root.position, volume: 0.6 });
    audio.play('ui_blip', { volume: 0.25, bus: 'ui', pitch: d < 0 ? 0.9 : 1.1 });
  }

  _turnDrum(d) {
    this.cat = (this.cat + d + SHOP_CATS.length) % SHOP_CATS.length;
    this.sel = 0;
    this.slide = 0;
    this.press.drum = 1;
    audio.play('bolt_turn', { pos: this.root.position, volume: 0.7 });
    audio.play('ui_blip', { volume: 0.2, bus: 'ui', pitch: 0.7 });
  }

  _buy() {
    const it = this._cur();
    this.press.buy = 1;
    juice.shake(0.06);
    audio.play('thunk', { pos: this.root.position, volume: 0.9 });
    if (!it) return;
    const st = this.econ.shopStatus(it);
    if (!st.ok) { audio.play('ui_error', { volume: 0.4, bus: 'ui' }); this.world.game.ui.toast(st.poor ? `Not enough credits (${fmt$(it.price)})` : `${shopName(it)}: ${st.why}`, 'warn'); return; }
    this.beam = { t0: this.t, id: it.model || it.id };
    audio.play('teleport_whoosh', { pos: this.root.position, volume: 0.8, pitch: 1.4 });
    this.world.fx.flashLight(_v.set(0, DECK_Y + 0.2, -0.1).applyMatrix4(this.root.matrixWorld), 0x4dff7a, 9, 0.35, 4);
    this.send('buy', { id: it.id });
  }

  hostAction(a, d, from) { if (a === 'buy') this.econ?.hostBuy(d?.id, from); }

  // ---------------- holograms
  _holo(type) {
    let h = this.holos.get(type);
    if (h) return h;
    const mats = { shell: holoMaterial(0x4dff7a), line: holoLineMaterial(0x9dffb4) };
    let g;
    try {
      g = type === '__lock' ? buildHologram(lockModel(), mats, 0.36) : buildHologram(buildModel(type, { seed: 1 }).object, mats, 0.5);
    } catch (e) { console.warn('[shop] hologram', type, e); g = buildHologram(lockModel(), mats, 0.3); }
    g.userData.mats = mats;
    g.visible = false;
    this.holoRoot.add(g);
    this.holos.set(type, g);
    return g;
  }

  _updateHolos(dt) {
    const e = this.econ, items = this._items();
    for (const h of this.holos.values()) h.visible = false;
    this.slide += (0 - this.slide) * Math.min(1, dt * 9);
    if (Math.abs(this.slide) < 0.002) this.slide = 0;
    const catOpen = e?.has(SHOP_CATS[this.cat].unlock);
    const slots = [];
    if (!this.unlocked || !catOpen || !items.length) slots.push({ o: 0, type: '__lock', locked: true });
    else {
      const n = items.length;
      const offs = n >= 3 ? [-1, 0, 1] : n === 2 ? [0, 1] : [0];
      for (const o of offs) { const it = items[(this.sel + o + n) % n]; slots.push({ o, type: it.model || it.id, locked: !!e.shopStatus(it).locked }); }
    }
    const beamK = this.beam ? (this.t - this.beam.t0) / 0.75 : -1;
    if (beamK > 1.6) this.beam = null;
    for (const s of slots) {
      const h = this._holo(s.type);
      h.visible = true;
      const x = (s.o + this.slide) * SLOT_X;
      const c = clamp01(1 - Math.abs(x) / SLOT_X); // 1 at the centre
      const sc = 0.55 + 0.45 * c;
      let y = HOLO_Y + 0.12 * c + Math.sin(this.t * 1.6 + s.o) * 0.012;
      let sy = 1, glitch = s.locked ? 0.35 : 0.03, alpha = (0.45 + 0.55 * c) * (s.locked ? 0.55 : 1);
      if (this.beam && s.o === 0 && beamK >= 0) {
        if (beamK < 1) { const k = ease(beamK); sy = 1 - k; y -= k * 0.35; glitch = 1; alpha *= 1 + k; }
        else { const k = clamp01((beamK - 1) / 0.6); sy = k; glitch = 0.6 * (1 - k); }
      }
      h.position.set(x, y, 0);
      h.scale.set(sc, sc * Math.max(0.02, sy), sc);
      h.rotation.y += dt * (0.5 + 0.6 * c);
      const m = h.userData.mats;
      for (const mm of [m.shell, m.line]) { mm.uniforms.uTime.value = this.t; mm.uniforms.uAlpha.value = alpha * (this.unlocked ? 1 : 0.6); mm.uniforms.uGlitch.value = glitch + (Math.random() < 0.01 ? 0.8 : 0); }
    }
    this.cones.forEach((cone, i) => {
      const u = cone.material.uniforms;
      u.uTime.value = this.t;
      const active = slots.some((s) => s.o === i - 1);
      u.uAlpha.value = !this.unlocked ? 0.04 : !active ? 0.05 : i === 1 ? (this.beam && beamK < 1 ? 0.7 : 0.26) : 0.16;
    });
    this.emitMat.emissiveIntensity = this.unlocked ? 1.4 + Math.sin(this.t * 5) * 0.2 : 0.15;
  }

  // holographic name + price (redrawn only when they change)
  _updateText() {
    const it = this._cur(), e = this.econ;
    const catOpen = e?.has(SHOP_CATS[this.cat].unlock);
    let name, price, sub;
    if (!this.unlocked) { name = 'COMPANY STORE'; price = 'OFFLINE'; sub = ''; }
    else if (!catOpen) { name = SHOP_CATS[this.cat].name; price = 'LOCKED'; sub = SHOP_CATS[this.cat].hint; }
    else if (!it) { name = '—'; price = ''; sub = ''; }
    else { const st = e.shopStatus(it); name = shopName(it).toUpperCase(); price = st.owned ? 'OWNED' : fmt$(it.price); sub = st.ok ? '' : st.why; }
    const key = `${name}|${price}|${sub}|${this.cat}`;
    if (key === this._txtKey) return;
    this._txtKey = key;
    const nc = this.nameTex.userData.ctx, pc = this.priceTex.userData.ctx;
    nc.clearRect(0, 0, 768, 96);
    ptext(nc, name, 384, 8, 64, { align: 'center', c: PH.hi, blur: 14 });
    brackets(nc, 40, 6, 688, 84, 18, PH.dim, 3);
    pc.clearRect(0, 0, 512, 128);
    ptext(pc, price, 256, 4, 92, { align: 'center', c: PH.fg, blur: 18 });
    if (sub) ptext(pc, sub, 256, 96, 28, { align: 'center', c: PH.dim, blur: 4 });
    this.nameTex.needsUpdate = true;
    this.priceTex.needsUpdate = true;
  }

  _updateFlaps(dt) {
    const v = Math.max(0, Math.min(9999999, Math.floor(this.world.game.run?.credits || 0)));
    const s = String(v).padStart(7, ' ');
    for (let i = 0; i < 7; i++) {
      const f = this.flaps[i], d = s[i] === ' ' ? 10 : +s[i];
      if (d !== f.d && f.flip <= 0) { f.next = d; f.flip = 1; if (this.nearLocal(6) && Math.random() < 0.5) audio.play('ui_type', { pos: this.root.position, volume: 0.15 }); }
      if (f.flip > 0) {
        f.flip = Math.max(0, f.flip - dt * 9);
        if (f.flip < 0.5 && f.next != null) { f.d = f.next; f.next = null; f.tex.offset.x = f.d / 11; }
        f.m.scale.y = Math.max(0.05, Math.abs(f.flip - 0.5) * 2);
      } else f.m.scale.y = 1;
    }
  }

  update(dt) {
    this.t += dt;
    this.signMat.emissiveIntensity = this.unlocked ? 0.75 + 0.06 * Math.sin(this.t * 3) : 0.06;
    // controls: drum turns to the category, buttons spring back
    const target = (this.cat / SHOP_CATS.length) * PI * 2;
    this.drumA += (target - this.drumA) * Math.min(1, dt * 8);
    this.drum.rotation.x = this.drumA - PI / 2; // the selected face points up the console slope, toward the clone
    this.knob.rotation.x = this.drumA * 2;
    for (const k in this.press) this.press[k] = Math.max(0, this.press[k] - dt * 5);
    this.btn.prev.position.y = 0.03 - this.press.prev * 0.012;
    this.btn.next.position.y = 0.03 - this.press.next * 0.012;
    this.btn.buy.position.y = 0.03 - this.press.buy * 0.02;
    const it = this._cur(), ok = this.unlocked && it && this.econ?.shopStatus(it).ok;
    this.buyMat.emissiveIntensity = ok ? 1.4 + Math.sin(this.t * 6) * 0.8 : 0.25;
    if (!this.nearLocal(22)) return;
    this._updateHolos(dt);
    this._updateText();
    this._updateFlaps(dt);
    if (!this.inSession && this.nearLocal(10)) this.scr.draw(dt, (ctx, w, h, pal, t) => this._drawCrt(ctx, w, h, t, false));
  }

  // the console CRT: category, item, pictogram, tick-mark stats, status
  _drawCrt(ctx, W, H, t, live) {
    if (!this.unlocked) return this._lockedScreen(ctx, W, H, t, 'COMPANY STORE', 'COMPLETE: EARN $1,000');
    const e = this.econ, cat = SHOP_CATS[this.cat], items = this._items(), it = this._cur();
    ctx.fillStyle = PH.bg; ctx.fillRect(0, 0, W, H);
    // category strip: names etched along the top, the current one bright and underlined
    const cw = W / SHOP_CATS.length;
    SHOP_CATS.forEach((c, i) => {
      const on = i === this.cat, open = e.has(c.unlock);
      ptext(ctx, c.name, cw * i + cw / 2, 10, 26, { align: 'center', c: on ? PH.hi : open ? PH.dim : PH.faint, blur: on ? 8 : 0 });
      if (on) rule(ctx, cw * i + 8, cw * (i + 1) - 8, 40, PH.fg);
    });
    if (!e.has(cat.unlock)) {
      icon(ctx, 'lock', W / 2, 150, 36, PH.dim, 3);
      ptext(ctx, 'LOCKED', W / 2, 200, 44, { align: 'center', c: PH.fg });
      ptext(ctx, cat.hint, W / 2, 252, 26, { align: 'center', c: PH.dim });
      phosphorFx(ctx, W, H, t);
      return;
    }
    if (it) {
      const st = e.shopStatus(it);
      icon(ctx, it.upgrade ? UP_ICON[it.upgrade] || 'gear' : it.app ? 'radio' : ITEM_ICON[it.cat] || 'crate', 52, 100, 30, PH.fg, 3);
      ptext(ctx, shopName(it).toUpperCase(), 100, 60, 40, { c: PH.hi });
      ptext(ctx, `${this.sel + 1}/${items.length}`, W - 16, 64, 24, { align: 'right', c: PH.dim, blur: 0 });
      ptext(ctx, (it.info || '').slice(0, 40), 100, 102, 22, { c: PH.dim, blur: 0 });
      (it.stats || []).slice(0, 3).forEach(([lab, f], i) => {
        const y = 150 + i * 34;
        ptext(ctx, lab, 24, y, 24, { c: PH.fg, blur: 0 });
        ticks(ctx, 160, y + 4, W - 184, 18, f, PH.fg, 24);
      });
      const yb = 262;
      rule(ctx, 16, W - 16, yb, PH.faint);
      ptext(ctx, fmt$(it.price), 20, yb + 12, 42, { c: st.poor ? PH.dim : PH.fg });
      const msg = st.ok ? (Math.floor(t * 2.5) % 2 ? 'SLAM [BUY]' : '') : st.why;
      ptext(ctx, msg, W - 20, yb + 18, 32, { align: 'right', c: st.ok ? PH.hi : PH.dim });
      if (live) ptext(ctx, 'A/D ITEM   W/S DRUM   E BUY', W / 2, H - 22, 18, { align: 'center', c: PH.faint, blur: 0 });
    }
    phosphorFx(ctx, W, H, t);
  }
}

// a padlock for locked slots (hologram source)
let _lock = null;
function lockModel() {
  if (_lock) return _lock;
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.24, 0.1), m); body.position.y = -0.08; g.add(body);
  const sh = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.025, 8, 24, PI), m); sh.position.y = 0.04; g.add(sh);
  const key = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.11, 12), m); key.rotation.x = PI / 2; key.position.y = -0.07; g.add(key);
  _lock = g;
  return g;
}

// ------------------------------------------------------------------------------------------ FIELD OPS (quests)
const COLX = (x) => 82 + x * 151;
const ROWY = (y) => (y === 0 ? 74 : 152 + (y - 1) * 48);
const NR = 15;
const SEC_ICON = { SURVIVAL: 'heart', SALVAGE: 'coin', COMBAT: 'fist', RESEARCH: 'scan', TOOLS: 'gear' };
const MAIN_ICON = { m_base: 'tent', m_food: 'food', m_cash: 'coin', m_escape: 'exit' };
const nodeIcon = (n) => MAIN_ICON[n.id] || (n.hard ? 'star' : SEC_ICON[n.sec]) || 'star';

export class QuestKiosk extends KioskBase {
  constructor(world, mission, x, y, z, yaw) {
    super(world, 'kiosk_quest', mission, x, y, z, yaw);
    this.label = 'FIELD OPS';
    this.unlockKey = 'term:quest';
    this.sel = 'm_base';
    this.claimFx = null;
    this.ring = 0;
    const R = this.root;
    const beige = Mat.get('plastic_beige'), dark = Mat.get('metal_dark'), olive = Mat.get('metal_green');
    box(1.0, 0.95, 0.6, olive, 0, 0.475, 0, R);
    box(1.02, 0.12, 0.62, dark, 0, 0.06, 0, R);
    const desk = box(1.06, 0.05, 0.34, dark, 0, 0.98, 0.2, R); desk.rotation.x = 0.12;
    const kb = box(0.62, 0.03, 0.17, beige, 0, 1.015, 0.24, R); kb.rotation.x = 0.12;
    for (let r = 0; r < 4; r++) { const k = box(0.56 - (r === 3 ? 0.2 : 0), 0.012, 0.028, Mat.get('plastic_grey'), 0, 1.035 - r * 0.004, 0.18 + r * 0.035, R); k.rotation.x = 0.12; }
    // RobCo-style monitor
    this.head = new THREE.Group(); this.head.position.set(0.04, 1.04, -0.06); this.head.rotation.x = -0.06; R.add(this.head);
    box(0.84, 0.66, 0.5, beige, 0, 0.33, -0.04, this.head);
    box(0.6, 0.48, 0.18, beige, 0, 0.3, -0.36, this.head);
    box(0.74, 0.54, 0.02, Mat.get('plastic_black'), 0, 0.34, 0.215, this.head);
    this.screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.44), new THREE.MeshBasicMaterial({ color: 0 }));
    this.screenMesh.position.set(0, 0.34, 0.228); this.head.add(this.screenMesh);
    this.scr = new CrtScreen(768, 512, 'green');
    this.scr.fps = 4;
    this.scr.attach(this.screenMesh, 1.5);
    this.ledMat = greenEmissive(1.2);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), this.ledMat); led.position.set(0.33, 0.06, 0.218); this.head.add(led);
    // marquee
    this.signMat = new THREE.MeshStandardMaterial({ map: signTex('FIELD OPS', 'QUEST NETWORK'), emissive: 0xffffff, emissiveIntensity: 0.1, roughness: 0.5 });
    this.signMat.emissiveMap = this.signMat.map;
    box(1.04, 0.28, 0.1, dark, 0, 1.95, -0.08, R);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.25), this.signMat); sign.position.set(0, 1.95, -0.028); R.add(sign);
    for (const s of [-1, 1]) box(0.04, 0.3, 0.04, dark, s * 0.45, 1.78, -0.12, R);
    // desk hologram projector (left): the selected node's section glyph inside a spinning ring
    cyl(0.07, 0.03, dark, -0.4, 1.01, 0.12, R, 20);
    this.projMat = greenEmissive(1.4);
    cyl(0.045, 0.01, this.projMat, -0.4, 1.03, 0.12, R, 16);
    const cm = holoMaterial(0x4dff7a); cm.uniforms.uAlpha.value = 0.22;
    this.cone = holoCone(0.04, 0.12, 0.3, cm); this.cone.position.set(-0.4, 1.18, 0.12); R.add(this.cone);
    this.holo = new THREE.Group(); this.holo.position.set(-0.4, 1.3, 0.12); R.add(this.holo);
    this.ringMat = holoMaterial(0x4dff7a);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.006, 6, 48), this.ringMat); this.holo.add(ring);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.003, 4, 40), this.ringMat); ring2.rotation.x = PI / 2; this.holo.add(ring2);
    this.glyphTex = canvasTex(256, 256, () => {});
    this.glyph = glowPlane(0.15, 0.15, this.glyphTex, this.holo);
    this._glyphKey = '';
    // receipt printer on the right of the desk: the paper strip feeds out on every claim
    box(0.22, 0.1, 0.18, dark, 0.38, 1.08, 0.12, R);
    this.paper = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 1), new THREE.MeshStandardMaterial({ color: 0xf2efe4, roughness: 0.9, side: THREE.DoubleSide }));
    this.paper.geometry.translate(0, -0.5, 0);
    this.paper.position.set(0.38, 1.13, 0.215); this.paper.scale.y = 0.001; R.add(this.paper);
    this.paperT = 0;
    this.addColliders([{ type: 'box', size: [1.04, 1.0, 0.64], pos: [0, 0.5, 0] }, { type: 'box', size: [0.86, 0.7, 0.9], pos: [0.04, 1.38, -0.22] }, { type: 'box', size: [1.04, 0.3, 0.12], pos: [0, 1.95, -0.08] }]);
  }

  get nodes() { return this.econ?.tree || []; }

  prompt() {
    const k = input.keyName('interact');
    if (!this.unlocked) return 'FIELD OPS — OFFLINE. Build your camp first.';
    const ready = this.nodes.filter((n) => this.econ.state(n) === 'ready').length;
    return `[${k}] Open the QUEST NETWORK${ready ? ` — ${ready} reward${ready === 1 ? '' : 's'} to claim!` : ''}`;
  }

  interact() {
    if (!this.unlocked) { audio.play('ui_error', { volume: 0.4, bus: 'ui' }); this.world.game.ui.toast('FIELD OPS OFFLINE: build your camp first', 'warn'); return; }
    const self = this, e = this.econ;
    const pick = this.nodes.find((n) => e.state(n) === 'ready') || this.nodes.find((n) => e.state(n) === 'active' && n.sec !== 'MAIN') || this.nodes.find((n) => e.state(n) === 'active');
    if (pick) this.sel = pick.id;
    this._open({
      distance: 0.56,
      view() { return self._view(); },
      select() { self._claim(); },
      draw(ctx, w, h, pal, t) { self._draw(ctx, w, h, t, true); },
    });
  }

  _move(dx, dy) {
    const cur = this.econ.byId[this.sel];
    if (!cur) { this.sel = this.nodes[0]?.id; return; }
    let best = null, bs = Infinity;
    for (const n of this.nodes) {
      if (n === cur) continue;
      const ex = n.x - cur.x, ey = n.y - cur.y;
      if (dx && Math.sign(ex) !== dx) continue;
      if (dy && Math.sign(ey) !== dy) continue;
      const s = dx ? Math.abs(ex) + Math.abs(ey) * 2.5 : Math.abs(ey) + Math.abs(ex) * 2.5;
      if (s < bs) { bs = s; best = n; }
    }
    if (best) { this.sel = best.id; this.ring = 0; audio.play('ui_blip', { volume: 0.25, bus: 'ui', pitch: 1.1 }); }
  }

  _view() {
    if (input.hit('left')) this._move(-1, 0);
    if (input.hit('right')) this._move(1, 0);
    if (input.hit('forward')) this._move(0, -1);
    if (input.hit('back')) this._move(0, 1);
    const n = this.econ?.byId[this.sel];
    return { items: [{ label: 'CLAIM', disabled: !n || this.econ.state(n) !== 'ready' }] };
  }

  _claim() { const n = this.econ.byId[this.sel]; if (n) this.send('claim', { id: n.id }); }
  hostAction(a, d, from) { if (a === 'claim') this.econ?.hostClaim(d?.id, from); }

  // every peer (crusher fx hub): a reward was claimed
  onClaimFx(m) {
    this.claimFx = { t0: this.t, id: m.id, v: m.v };
    this.paperT = 1.4;
    audio.play('stamp_claim', { pos: this.root.position, volume: 0.9 });
    audio.play('_printer', { pos: this.root.position, volume: 0.6 });
  }

  update(dt) {
    this.t += dt;
    this.ring = Math.min(1, this.ring + dt * 3);
    const on = this.unlocked;
    this.ledMat.emissiveIntensity = on ? 1.4 : 0.5 * (Math.floor(this.t * 2) % 2);
    this.signMat.emissiveIntensity = on ? 0.75 + 0.06 * Math.sin(this.t * 3) : 0.06;
    this.paperT = Math.max(0, this.paperT - dt);
    const k = this.paperT > 0 ? Math.min(1, (1.4 - this.paperT) / 0.9) : Math.max(0, this.paper.scale.y - dt * 0.6);
    this.paper.scale.y = Math.max(0.001, k * 0.22);
    if (!this.nearLocal(16)) return;
    // desk hologram
    this.holo.visible = on;
    this.cone.material.uniforms.uTime.value = this.t;
    this.cone.material.uniforms.uAlpha.value = on ? 0.22 : 0.02;
    this.projMat.emissiveIntensity = on ? 1.4 : 0.1;
    if (on) {
      this.ringMat.uniforms.uTime.value = this.t;
      this.holo.rotation.y += dt * 0.9;
      this.holo.children[0].rotation.x = Math.sin(this.t * 0.7) * 0.4;
      const n = this.econ.byId[this.sel] || this.nodes[0];
      const key = n ? `${n.id}|${this.econ.state(n)}` : '';
      if (key !== this._glyphKey && n) {
        this._glyphKey = key;
        const c = this.glyphTex.userData.ctx;
        c.clearRect(0, 0, 256, 256);
        icon(c, nodeIcon(n), 128, 112, 70, PH.fg, 7);
        ptext(c, n.short, 128, 206, 34, { align: 'center', c: PH.hi, blur: 8 });
        this.glyphTex.needsUpdate = true;
      }
      this.glyph.material.opacity = 0.75 + 0.25 * Math.sin(this.t * 23) * Math.sin(this.t * 7);
    }
    if (!this.inSession) this.scr.draw(dt, (ctx, w, h, pal, t) => (on ? this._draw(ctx, w, h, t, false) : this._lockedScreen(ctx, w, h, t, 'FIELD OPS', 'COMPLETE: CONSTRUCT A BASE')));
  }

  _draw(ctx, W, H, t, live) {
    const e = this.econ;
    if (!e) return;
    const nodes = this.nodes, mainDone = e.mainDone();
    ctx.fillStyle = PH.bg; ctx.fillRect(0, 0, W, H);
    // header
    ptext(ctx, 'FIELD OPS', 16, 8, 34, { c: PH.hi });
    ptext(ctx, `${e.rules.name} · ${e.rules.title}`, W - 16, 14, 22, { align: 'right', c: PH.dim, blur: 0 });
    rule(ctx, 16, W - 16, 44, PH.dim);
    const P = (n) => [COLX(n.x), ROWY(n.y)];
    const colorOf = (st) => (st === 'locked' ? PH.faint : PH.fg);
    // ---- links
    const link = (pts, a, b) => {
      const sa = e.state(a), sb = e.state(b);
      const done = sa === 'claimed' && sb === 'claimed', live2 = sa === 'claimed' && !done;
      ctx.save();
      ctx.strokeStyle = done ? PH.dim : live2 ? PH.fg : PH.faint;
      ctx.lineWidth = done ? 2 : live2 ? 2 : 1.5;
      if (!done && !live2) ctx.setLineDash([2, 6]);
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      ctx.restore();
      if (!live2) return;
      // pulses travelling to the node
      let L = 0; const seg = [];
      for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); L += l; }
      for (let p = 0; p < 2; p++) {
        let d = ((t * 70 + p * L / 2) % L);
        for (let i = 1; i < pts.length; i++) {
          if (d <= seg[i - 1]) {
            const k = d / seg[i - 1], x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k;
            ctx.fillStyle = PH.hi; ctx.shadowColor = PH.fg; ctx.shadowBlur = 8; ctx.fillRect(x - 2, y - 2, 4, 4); ctx.shadowBlur = 0;
            break;
          }
          d -= seg[i - 1];
        }
      }
    };
    const root = e.byId.m_cash;
    const BUS = 108;
    for (const n of nodes) {
      for (const dId of n.deps) {
        const d = e.byId[dId];
        if (!d) continue;
        const [x0, y0] = P(d), [x1, y1] = P(n);
        if (n.sec === 'MAIN') link([[x0 + NR + 3, y0], [x1 - NR - 3, y1]], d, n);
        else if (d === root) link([[x1, BUS], [x1, y1 - NR - 3]], d, n);
        else if (d.x === n.x) link([[x0, y0 + NR + 14], [x1, y1 - NR - 3]], d, n);
        else { const sx = d.x < n.x ? 1 : -1, gx = (x0 + x1) / 2, my = y1 - 24; link([[x0 + sx * (NR + 3), y0], [gx, y0], [gx, my], [x1, my], [x1, y1 - NR - 3]], d, n); }
      }
    }
    if (root) {
      const [rx, ry] = P(root);
      const rs = e.state(root);
      ctx.strokeStyle = rs === 'claimed' ? PH.dim : PH.faint; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(rx, ry + NR + 14); ctx.lineTo(rx, BUS); ctx.moveTo(COLX(0), BUS); ctx.lineTo(COLX(4), BUS); ctx.stroke();
      // escape fund gauge along the trunk to the last node
      const esc = e.byId.m_escape;
      if (esc) {
        const [ex] = P(esc), bx = rx + NR + 10, bw = ex - NR - 10 - bx, f = clamp01(e.escape / e.quota);
        ticks(ctx, bx, ry - 5, bw, 10, f, PH.fg, 26);
        ptext(ctx, `${short$(e.escape)} / ${short$(e.quota)}`, bx + bw / 2, ry - 30, 20, { align: 'center', c: PH.dim, blur: 0 });
      }
      for (const s of SECTIONS) {
        const x = COLX(s.col);
        ptext(ctx, s.id, x, BUS + 6, 18, { align: 'center', c: mainDone ? PH.fg : PH.faint, blur: 0 });
      }
    }
    // ---- nodes: glowing glyph circles
    for (const n of nodes) {
      const st = e.state(n), [x, y] = P(n), sel = live && n.id === this.sel;
      const pr = e.progress(n);
      const r = sel ? NR + 5 * ease(this.ring) : NR;
      const c = colorOf(st);
      ctx.save();
      ctx.lineWidth = 2;
      if (st === 'claimed') { ctx.fillStyle = PH.fg; ctx.shadowColor = PH.fg; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(x, y, r, 0, PI * 2); ctx.fill(); ctx.shadowBlur = 0; }
      else {
        ctx.strokeStyle = c;
        if (st === 'locked') ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.arc(x, y, r, 0, PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        if (st === 'active' && pr.frac > 0) { ctx.strokeStyle = PH.hi; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r + 4, -PI / 2, -PI / 2 + PI * 2 * pr.frac); ctx.stroke(); }
        if (st === 'ready') { const p = 0.5 + 0.5 * Math.sin(t * 6); ctx.strokeStyle = PH.hi; ctx.globalAlpha = 0.4 + p * 0.6; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 5 + p * 4, 0, PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
      }
      icon(ctx, st === 'locked' && !(n.sec !== 'MAIN' && mainDone) ? 'lock' : nodeIcon(n), x, y, r * 0.55, st === 'claimed' ? PH.bg : st === 'locked' ? PH.faint : st === 'ready' ? PH.hi : PH.fg, 2, st !== 'claimed');
      if (n.hard) icon(ctx, 'star', x + r * 0.95, y - r * 0.95, 5, st === 'locked' ? PH.faint : PH.hi, 1.5, false);
      if (sel) {
        // holographic ring: rotating segments + bracket corners
        const R2 = r + 11;
        ctx.strokeStyle = PH.hi; ctx.lineWidth = 2; ctx.shadowColor = PH.fg; ctx.shadowBlur = 8;
        for (let i = 0; i < 6; i++) { const a0 = t * 1.6 + i * PI / 3; ctx.beginPath(); ctx.arc(x, y, R2, a0, a0 + 0.6); ctx.stroke(); }
        ctx.shadowBlur = 0;
      }
      ctx.restore();
      if (sel || st === 'ready' || (n.sec === 'MAIN')) ptext(ctx, n.short, x, y + r + 4, 17, { align: 'center', c: sel ? PH.hi : st === 'locked' ? PH.faint : PH.dim, blur: sel ? 6 : 0 });
    }
    if (!mainDone) {
      const blink = Math.floor(t * 2) % 2;
      ptext(ctx, 'SIDE QUESTS LOCKED', W / 2, 228, 32, { align: 'center', c: blink ? PH.hi : PH.fg });
      ptext(ctx, 'COMPLETE MAIN MISSION 1', W / 2, 262, 22, { align: 'center', c: PH.dim, blur: 0 });
      brackets(ctx, W / 2 - 170, 220, 340, 72, 14, PH.dim);
    }
    // ---- detail
    const n = live ? e.byId[this.sel] : (nodes.find((x) => e.state(x) === 'ready') || nodes.find((x) => e.state(x) === 'active'));
    const py = 404;
    rule(ctx, 16, W - 16, py - 8, PH.dim);
    if (n) {
      const st = e.state(n), pr = e.progress(n);
      icon(ctx, nodeIcon(n), 34, py + 22, 16, PH.fg, 2.5);
      ptext(ctx, n.name, 62, py + 2, 30, { c: PH.hi });
      ptext(ctx, `${n.sec}${n.hard ? ' ★' : ''} · ${st.toUpperCase()}`, W - 16, py + 8, 20, { align: 'right', c: st === 'ready' ? PH.hi : PH.dim, blur: 0 });
      ptext(ctx, n.desc.length > 74 ? n.desc.slice(0, 72) + '…' : n.desc, 62, py + 36, 20, { c: PH.dim, blur: 0 });
      ticks(ctx, 62, py + 66, 300, 12, st === 'claimed' ? 1 : pr.frac, PH.fg, 30);
      ptext(ctx, pr.failed ? 'FAILED' : pr.need >= 1000 ? `${short$(pr.have)}/${short$(pr.need)}` : `${Math.floor(pr.have)}/${pr.need}`, 372, py + 61, 20, { c: PH.dim, blur: 0 });
      const r = n.reward || {};
      let rx = W - 16;
      const parts = [];
      if (r.credits) parts.push(['coin', short$(r.credits)]);
      for (const k of r.unlock || []) parts.push([k.startsWith('app') ? 'radio' : k.startsWith('shop') ? 'cart' : k.startsWith('term') ? 'home' : 'gear', unlockLabel(k).replace(/^(STORE|APP|UPGRADE): /, '')]);
      if (r.ach) parts.push(['star', 'COSMETIC']);
      for (const [ic, label] of parts.slice(0, 3).reverse()) {
        const w = ptext(ctx, label, rx, py + 61, 18, { align: 'right', c: PH.fg, blur: 0 });
        icon(ctx, ic, rx - w - 12, py + 71, 8, PH.fg, 1.5, false);
        rx -= w + 34;
      }
      if (live && st === 'ready') ptext(ctx, Math.floor(t * 3) % 2 ? '[E] CLAIM' : '', W - 16, py + 36, 22, { align: 'right', c: PH.hi });
    }
    if (this.claimFx) {
      const k = (this.t - this.claimFx.t0) / 1.6;
      if (k > 1) this.claimFx = null;
      else {
        const s = 1 + (1 - ease(clamp01(k * 2))) * 0.6;
        ctx.save(); ctx.globalAlpha = 1 - clamp01((k - 0.7) / 0.3);
        brackets(ctx, W / 2 - 160 * s, 210 - 40 * s, 320 * s, 80 * s, 16, PH.hi, 3);
        ptext(ctx, 'REWARD CLAIMED', W / 2, 196, 42, { align: 'center', c: PH.hi, blur: 16 });
        if (this.claimFx.v) ptext(ctx, `+${fmt$(this.claimFx.v)}`, W / 2, 238, 26, { align: 'center', c: PH.fg });
        ctx.restore();
      }
    }
    ptext(ctx, live ? 'WASD NAVIGATE   E CLAIM   TAB EXIT' : `[${input.keyName('interact')}] OPEN THE QUEST NETWORK`, 16, H - 26, 18, { c: PH.faint, blur: 0 });
    phosphorFx(ctx, W, H, t);
  }
}
void pfont;
