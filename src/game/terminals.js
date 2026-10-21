// Camp kiosks (in-world CRT consoles, driven through ui/terminal.js sessions):
//   ShopKiosk   COMPANY STORE: category tabs (BASIC / WEAPONS / ARMOR / UPGRADES / APPS), item list, stats, and a
//               glass display case beside the screen where the selected item turns on a hologram pedestal.
//               Purchases deduct credits (never the escape fund) and materialise in the crusher's teleporter.
//   QuestKiosk  FIELD OPS: the quest network as a branching tree (MAIN trunk -> SURVIVAL / SALVAGE / COMBAT /
//               RESEARCH / TOOLS), animated data links, node states, claim rewards ([E]) with a stamp + receipt.
// Both start locked: the quest kiosk powers up with CONSTRUCT A BASE, the store with EARN $1,000.
import * as THREE from 'three';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { Device } from './devices.js';
import * as Mat from '../gfx/materials.js';
import { CrtScreen, text, wrap } from '../ui/crt.js';
import { buildModel } from '../entities/catalog.js';
import { SECTIONS, MAIN_COLOR, SHOP, SHOP_CATS, WATCH_APPS, fmt$, short$, shopName, unlockLabel } from './economy.js';
import { itemName } from './itemdefs.js';

const PI = Math.PI;
const _v = new THREE.Vector3();
const SW = 768, SH = 512;

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function box(w, h, d, mat, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}
const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// pixel padlock / check / star glyphs (drawn as little rects so they stay crisp on the CRT)
function lock(ctx, x, y, s, c) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y + s * 0.45, s, s * 0.55);
  ctx.fillRect(x + s * 0.15, y, s * 0.14, s * 0.5); ctx.fillRect(x + s * 0.71, y, s * 0.14, s * 0.5); ctx.fillRect(x + s * 0.15, y, s * 0.7, s * 0.14);
}
function check(ctx, x, y, s, c) {
  ctx.strokeStyle = c; ctx.lineWidth = Math.max(2, s * 0.18); ctx.beginPath();
  ctx.moveTo(x, y + s * 0.55); ctx.lineTo(x + s * 0.38, y + s * 0.9); ctx.lineTo(x + s, y + s * 0.1); ctx.stroke();
}
function star(ctx, x, y, r, c) {
  ctx.fillStyle = c; ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = -PI / 2 + i * PI / 5, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  ctx.fill();
}
function stamp(ctx, str, x, y, k, color) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(-0.18); const s = 1 + (1 - k) * 1.6; ctx.scale(s, s);
  ctx.globalAlpha = Math.min(1, k * 3);
  ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.strokeRect(-150, -34, 300, 68);
  text(ctx, str, 0, -26, 56, color, 'center');
  ctx.restore();
}

// ------------------------------------------------------------------------------------------ kiosk base
class Kiosk extends Device {
  constructor(world, id, mission, x, y, z, yaw, o) {
    super(world, id, {});
    this.mission = mission;
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    this.label = o.title;
    this.kind = id;
    const beige = Mat.get('plastic_beige'), dark = Mat.get('metal_dark');
    // cabinet, kick plate, desk + keyboard
    box(1.0, 0.95, 0.6, Mat.get('metal_beige'), 0, 0.475, 0, this.root);
    box(1.02, 0.12, 0.62, dark, 0, 0.06, 0, this.root);
    const desk = box(1.06, 0.05, 0.34, dark, 0, 0.98, 0.2, this.root); desk.rotation.x = 0.12;
    const kb = box(0.62, 0.03, 0.17, beige, 0, 1.015, 0.24, this.root); kb.rotation.x = 0.12;
    for (let r = 0; r < 4; r++) { const k = box(0.56 - (r === 3 ? 0.2 : 0), 0.012, 0.028, Mat.get('plastic_grey'), 0, 1.035 - r * 0.004, 0.18 + r * 0.035, this.root); k.rotation.x = 0.12; }
    // CRT monitor
    this.head = new THREE.Group(); this.head.position.set(0, 1.04, -0.06); this.head.rotation.x = -0.06; this.root.add(this.head);
    box(0.84, 0.66, 0.5, beige, 0, 0.33, -0.04, this.head);
    box(0.6, 0.48, 0.18, beige, 0, 0.3, -0.36, this.head);
    box(0.74, 0.54, 0.02, Mat.get('plastic_black'), 0, 0.34, 0.215, this.head);
    this.screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.44), new THREE.MeshBasicMaterial({ color: 0 }));
    this.screenMesh.position.set(0, 0.34, 0.228); this.head.add(this.screenMesh);
    this.scr = new CrtScreen(SW, SH, o.palette);
    this.scr.fps = 4;
    this.scr.attach(this.screenMesh, 1.45);
    // power LED + marquee sign
    this.ledMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff3020, emissiveIntensity: 1.5 });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), this.ledMat); led.position.set(0.33, 0.06, 0.218); this.head.add(led);
    const signTex = canvasTex(512, 128, (c, w, h) => {
      c.fillStyle = '#121416'; c.fillRect(0, 0, w, h);
      c.strokeStyle = o.signColor; c.lineWidth = 6; c.strokeRect(8, 8, w - 16, h - 16);
      c.fillStyle = o.signColor; c.font = '900 56px "IBM Plex Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(o.title, w / 2, 54);
      c.font = 'bold 22px "IBM Plex Mono", monospace'; c.fillStyle = '#e8e2d2'; c.fillText(o.sub, w / 2, 98);
    });
    this.signMat = new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.15, roughness: 0.5 });
    box(1.04, 0.28, 0.1, dark, 0, 1.95, -0.08, this.root);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.25), this.signMat); sign.position.set(0, 1.95, -0.028); this.root.add(sign);
    for (const s of [-1, 1]) box(0.04, 0.3, 0.04, dark, s * 0.45, 1.78, -0.12, this.root);
    this.cols = [{ type: 'box', size: [1.04, 1.0, 0.64], pos: [0, 0.5, 0] }, { type: 'box', size: [0.86, 0.7, 0.9], pos: [0, 1.38, -0.22] }, { type: 'box', size: [1.04, 0.3, 0.12], pos: [0, 1.95, -0.08] }];
    this.t = 0;
    this.sess = null;
    this.range = 2.6;
  }

  get econ() { return this.mission.econ; }
  nearLocal(r = 12) { return this.root.position.distanceTo(this.world.game.local.pos) < r; }
  get unlocked() { return !!this.econ?.has(this.unlockKey); }

  _open(spec) {
    const g = this.world.game;
    const self = this;
    g.terminal.open({
      device: this, screen: this.scr, mesh: this.screenMesh, ...spec,
      onClose() { self.sess = null; },
    });
    this.sess = g.terminal.session;
  }

  update(dt) {
    this.t += dt;
    const on = this.unlocked;
    this.ledMat.emissive.setHex(on ? 0x40ff70 : 0xff3020);
    this.ledMat.emissiveIntensity = on ? 1.6 : 0.8 + 0.8 * (Math.floor(this.t * 2) % 2);
    this.signMat.emissiveIntensity = on ? 0.55 + 0.05 * Math.sin(this.t * 3) : 0.08;
    const inSession = this.world.game.terminal.session?.device === this;
    if (!inSession && this.nearLocal(14)) this.scr.draw(dt, (ctx, w, h, pal, t) => this.drawIdle(ctx, w, h, pal, t));
  }

  // locked screen
  _lockedScreen(ctx, w, h, pal, t, title, need) {
    text(ctx, title, w / 2, 40, 44, pal.dim, 'center');
    lock(ctx, w / 2 - 40, 130, 80, Math.floor(t * 2) % 2 ? pal.bad : pal.dim);
    text(ctx, 'OFFLINE — LICENCE PENDING', w / 2, 250, 40, pal.bad, 'center');
    text(ctx, need, w / 2, 310, 30, pal.fg, 'center');
    text(ctx, 'R.O.O.M. FIELD SERVICES · TERMINAL ' + this.id.toUpperCase(), w / 2, 460, 22, pal.dim, 'center');
  }
}

// ------------------------------------------------------------------------------------------ COMPANY STORE
export class ShopKiosk extends Kiosk {
  constructor(world, mission, x, y, z, yaw) {
    super(world, 'kiosk_shop', mission, x, y, z, yaw, { title: 'COMPANY STORE', sub: 'DELIVERY BY TELEPORT · NO REFUNDS', palette: 'cyan', signColor: '#5ae8ff' });
    this.unlockKey = 'term:shop';
    this.cat = 0;
    this.sel = 0;
    this.scroll = 0;
    this.orderFx = null;
    this.featured = 0;
    this.featT = 0;
    this._buildCase();
    this.addColliders([...this.cols, { type: 'cylinder', radius: 0.26, height: 1.75, pos: [0.86, 0.875, 0] }]);
  }

  _buildCase() {
    const dark = Mat.get('metal_dark'), chrome = Mat.get('chrome');
    const X = 0.86;
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 1.02, 24), dark); ped.position.set(X, 0.51, 0); ped.castShadow = true; this.root.add(ped);
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.05, 28), chrome); lip.position.set(X, 1.045, 0); this.root.add(lip);
    this.projMat = new THREE.MeshStandardMaterial({ color: 0x041014, emissive: 0x5ae8ff, emissiveIntensity: 1.6, roughness: 0.3 });
    this.projMat.userData.noProbe = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.014, 8, 36), this.projMat); ring.rotation.x = -PI / 2; ring.position.set(X, 1.075, 0); this.root.add(ring);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.03, 16), this.projMat); lens.position.set(X, 1.08, 0); this.root.add(lens);
    // hologram cone + scan ring (additive)
    this.coneMat = new THREE.MeshBasicMaterial({ color: 0x5ae8ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.coneMat.userData.noProbe = true;
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.06, 0.56, 24, 1, true), this.coneMat); cone.position.set(X, 1.36, 0); this.root.add(cone);
    this.scanRing = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.004, 4, 40), this.coneMat); this.scanRing.rotation.x = -PI / 2; this.scanRing.position.set(X, 1.3, 0); this.root.add(this.scanRing);
    // glass dome + top cap
    const glass = new THREE.MeshStandardMaterial({ color: 0xd8f0f4, roughness: 0.04, transparent: true, opacity: 0.16, depthWrite: false });
    glass.userData.noProbe = true;
    const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.62, 28, 1, true), glass); dome.position.set(X, 1.38, 0); this.root.add(dome);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.05, 28), dark); top.position.set(X, 1.71, 0); this.root.add(top);
    this.disp = new THREE.Group(); this.disp.position.set(X, 1.34, 0); this.root.add(this.disp);
    this.models = new Map();
    this.shown = null;
  }

  // the 3D model in the display case
  _show(item) {
    const type = item ? (item.model || item.id) : null;
    if (type === this.shown) return;
    if (this.shown && this.models.get(this.shown)) this.models.get(this.shown).visible = false;
    this.shown = type;
    if (!type) return;
    let piv = this.models.get(type);
    if (!piv) {
      piv = new THREE.Group();
      try {
        const m = buildModel(type, { seed: 1 }).object;
        const b = new THREE.Box3().setFromObject(m);
        const size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
        const s = 0.34 / Math.max(0.05, size.x, size.y, size.z);
        m.position.sub(c);
        const inner = new THREE.Group(); inner.add(m); inner.scale.setScalar(s);
        piv.add(inner);
      } catch (e) { console.warn('[shop] preview', type, e); }
      this.disp.add(piv);
      this.models.set(type, piv);
    }
    piv.visible = true;
    piv.userData.t0 = this.t;
  }

  _items() {
    const cat = SHOP_CATS[this.cat];
    return SHOP.filter((s) => s.cat === cat.id);
  }

  prompt() {
    const k = input.keyName('interact');
    if (!this.unlocked) return 'COMPANY STORE — CLOSED. Complete EARN $1,000 to activate it.';
    return `[${k}] Browse the COMPANY STORE (${short$(this.world.game.run.credits)} available)`;
  }

  interact() {
    if (!this.unlocked) { audio.play('ui_error', { volume: 0.4, bus: 'ui' }); this.world.game.ui.toast('STORE CLOSED: earn $1,000 first', 'warn'); return; }
    const self = this;
    // the session frames the screen AND the display case
    this.root.updateMatrixWorld(true);
    const target = new THREE.Vector3(0.42, 1.38, 0.1).applyMatrix4(this.root.matrixWorld);
    this._open({
      target, distance: 1.25,
      view() { return self._view(); },
      select() { self._buy(); },
      draw(ctx, w, h, pal, t) { self._draw(ctx, w, h, pal, t, true); },
    });
    audio.play('ui_boot', { volume: 0.4, bus: 'ui' });
  }

  _view() {
    // own navigation: A/D categories, W/S items (the terminal sees a single pseudo item)
    const n = this._items().length;
    if (input.hit('left')) { this.cat = (this.cat + SHOP_CATS.length - 1) % SHOP_CATS.length; this.sel = 0; this.scroll = 0; audio.play('ui_blip', { volume: 0.3, bus: 'ui', pitch: 0.9 }); }
    if (input.hit('right')) { this.cat = (this.cat + 1) % SHOP_CATS.length; this.sel = 0; this.scroll = 0; audio.play('ui_blip', { volume: 0.3, bus: 'ui', pitch: 0.9 }); }
    if (input.hit('forward') && n) this.sel = (this.sel + n - 1) % n;
    if (input.hit('back') && n) this.sel = (this.sel + 1) % n;
    const it = this._items()[this.sel];
    const st = it && this.econ ? this.econ.shopStatus(it) : { ok: false };
    return { items: [{ label: 'BUY', disabled: !st.ok }] };
  }

  _buy() {
    const it = this._items()[this.sel];
    if (!it) return;
    this.orderFx = { t0: this.t, name: shopName(it) };
    audio.play('stamp_claim', { volume: 0.6, bus: 'ui' });
    this.send('buy', { id: it.id });
  }

  hostAction(a, d, from) { if (a === 'buy') this.econ?.hostBuy(d?.id, from); }

  update(dt) {
    super.update(dt);
    // display case: selected item while browsing, otherwise a slow rotation of what is on sale
    const inSession = this.world.game.terminal.session?.device === this;
    let item = null;
    if (this.unlocked) {
      if (inSession) item = this._items()[this.sel];
      else {
        this.featT -= dt;
        const pool = SHOP.filter((s) => this.econ?.shopStatus(s).locked !== true);
        if (this.featT <= 0) { this.featT = 4; this.featured = (this.featured + 1) % Math.max(1, pool.length); }
        item = pool[this.featured % Math.max(1, pool.length)] || null;
      }
    }
    if (this.nearLocal(18)) this._show(item);
    const piv = this.shown ? this.models.get(this.shown) : null;
    if (piv) {
      const k = clamp01((this.t - (piv.userData.t0 || 0)) / 0.35);
      piv.rotation.y += dt * 0.9;
      piv.position.y = Math.sin(this.t * 1.7) * 0.012;
      piv.scale.setScalar(0.2 + 0.8 * (1 - (1 - k) ** 3));
    }
    const on = this.unlocked;
    this.coneMat.opacity = on ? 0.1 + 0.04 * Math.sin(this.t * 9) : 0;
    this.projMat.emissiveIntensity = on ? 1.6 : 0.1;
    this.scanRing.position.y = 1.1 + ((this.t * 0.35) % 1) * 0.55;
  }

  drawIdle(ctx, w, h, pal, t) {
    if (!this.unlocked) return this._lockedScreen(ctx, w, h, pal, t, 'COMPANY STORE', 'COMPLETE: EARN $1,000');
    this._draw(ctx, w, h, pal, t, false);
  }

  _draw(ctx, W, H, pal, t, live) {
    const e = this.econ;
    if (!e) return;
    const run = this.world.game.run;
    ctx.imageSmoothingEnabled = false;
    // header (glow only on the big type: canvas shadows are expensive per primitive)
    text(ctx, 'R.O.O.M. COMPANY STORE', 16, 6, 34, pal.hi);
    ctx.shadowBlur = 0;
    text(ctx, `CREDITS ${fmt$(run.credits)}`, W - 16, 8, 30, pal.good, 'right');
    ctx.fillStyle = pal.dim; ctx.fillRect(16, 42, W - 32, 2);
    // category tabs
    const tw = (W - 32) / SHOP_CATS.length;
    SHOP_CATS.forEach((c, i) => {
      const x = 16 + i * tw, sel = i === this.cat, open = e.has(c.unlock);
      ctx.fillStyle = sel ? (open ? pal.fg : pal.dim) : 'rgba(0,0,0,0)';
      if (sel) ctx.fillRect(x + 2, 50, tw - 4, 30);
      ctx.strokeStyle = open ? pal.fg : pal.dim; ctx.lineWidth = 2; ctx.strokeRect(x + 2, 50, tw - 4, 30);
      if (!open) lock(ctx, x + 10, 57, 14, sel ? pal.bg : pal.dim);
      text(ctx, c.name, x + tw / 2 + (open ? 0 : 8), 51, 26, sel ? pal.bg : open ? pal.fg : pal.dim, 'center');
    });
    const cat = SHOP_CATS[this.cat];
    const items = this._items();
    const sel = Math.min(this.sel, Math.max(0, items.length - 1));
    if (!e.has(cat.unlock)) {
      lock(ctx, W / 2 - 34, 150, 68, pal.dim);
      text(ctx, `${cat.name} — LOCKED`, W / 2, 250, 44, pal.bad, 'center');
      text(ctx, `UNLOCK VIA QUEST: ${cat.hint}`, W / 2, 304, 28, pal.fg, 'center');
      text(ctx, 'CHECK THE MISSION TERMINAL', W / 2, 340, 24, pal.dim, 'center');
      this._footer(ctx, W, H, pal, live);
      return;
    }
    // list (left)
    const rows = 9, rh = 36, y0 = 90;
    if (sel < this.scroll) this.scroll = sel;
    if (sel >= this.scroll + rows) this.scroll = sel - rows + 1;
    items.slice(this.scroll, this.scroll + rows).forEach((it, k) => {
      const i = k + this.scroll, y = y0 + k * rh, st = e.shopStatus(it), on = i === sel && live;
      if (on) { ctx.fillStyle = hexA(pal.fg, 0.22); ctx.fillRect(14, y, 362, rh - 4); ctx.fillStyle = pal.hi; ctx.fillRect(14, y, 4, rh - 4); }
      const col = st.locked ? pal.dim : st.owned ? pal.good : st.poor ? pal.dim : pal.fg;
      if (st.locked) lock(ctx, 24, y + 8, 14, pal.dim);
      text(ctx, shopName(it).slice(0, 18), 46, y + 2, 28, on ? pal.hi : col);
      text(ctx, st.owned ? 'OWNED' : short$(it.price), 370, y + 2, 28, st.owned ? pal.good : st.poor && !st.locked ? pal.bad : col, 'right');
    });
    if (items.length > rows) text(ctx, `${sel + 1}/${items.length}`, 370, y0 + rows * rh, 20, pal.dim, 'right');
    // detail (right)
    const it = items[sel];
    ctx.fillStyle = pal.dim; ctx.fillRect(388, 88, 2, 330);
    if (it) {
      const st = e.shopStatus(it);
      const x = 404;
      text(ctx, shopName(it).toUpperCase(), x, 88, 36, pal.hi);
      text(ctx, `${cat.name}${it.upgrade ? ' · TEAM UPGRADE' : it.app ? ' · WATCH LICENCE' : ''}`, x, 124, 22, pal.dim);
      ctx.font = `24px "VT323", monospace`;
      wrap(ctx, it.info || '', W - x - 16, 24).slice(0, 3).forEach((ln, i) => text(ctx, ln, x, 152 + i * 24, 24, pal.fg));
      (it.stats || []).slice(0, 3).forEach(([lab, f], i) => {
        const y = 234 + i * 30;
        text(ctx, lab, x, y, 22, pal.dim);
        const segs = 12, bw = 220, bx = W - 16 - bw;
        for (let s = 0; s < segs; s++) { ctx.fillStyle = s < Math.round(f * segs) ? pal.fg : hexA(pal.dim, 0.35); ctx.fillRect(bx + s * (bw / segs), y + 6, bw / segs - 3, 14); }
      });
      text(ctx, fmt$(it.price), x, 330, 46, st.poor ? pal.bad : pal.good);
      const why = st.ok ? (live ? (Math.floor(t * 2.5) % 2 ? '[E] BUY' : '') : '') : st.why;
      text(ctx, why, W - 16, 340, 32, st.ok ? pal.hi : st.owned ? pal.good : pal.bad, 'right');
      text(ctx, it.app ? 'INSTALLS ON EVERY TEAM WATCH' : 'DELIVERED TO THE CRUSHER TELEPORTER', x, 386, 20, pal.dim);
      if (live && !it.app) text(ctx, 'LIVE PREVIEW: DISPLAY CASE  >>', W - 16, 410, 20, pal.fg, 'right');
    }
    if (this.orderFx) {
      const k = (this.t - this.orderFx.t0) / 1.6;
      if (k > 1) this.orderFx = null;
      else stamp(ctx, 'ORDERED', 570, 250, clamp01(k * 2.2), pal.good);
    }
    this._footer(ctx, W, H, pal, live);
  }

  _footer(ctx, W, H, pal, live) {
    ctx.fillStyle = pal.dim; ctx.fillRect(16, H - 52, W - 32, 2);
    text(ctx, live ? '[A/D] CATEGORY  [W/S] ITEM  [E] BUY  [TAB] LEAVE' : `[${input.keyName('interact')}] BROWSE THE STORE`, 16, H - 44, 24, pal.fg);
    text(ctx, 'NO REFUNDS', W - 16, H - 44, 24, pal.dim, 'right');
  }
}

// ------------------------------------------------------------------------------------------ FIELD OPS (quests)
const COLX = (x) => 82 + x * 151;
const ROWY = (y) => (y === 0 ? 62 : 126 + (y - 1) * 44);
const NW = 134, NH = 30;

export class QuestKiosk extends Kiosk {
  constructor(world, mission, x, y, z, yaw) {
    super(world, 'kiosk_quest', mission, x, y, z, yaw, { title: 'FIELD OPS', sub: 'QUEST NETWORK · CLAIM REWARDS HERE', palette: 'amber', signColor: '#ffb43a' });
    this.unlockKey = 'term:quest';
    this.sel = 'm_base';
    this.claimFx = null;
    // receipt printer on the right of the desk: the paper strip feeds out on every claim
    const dark = Mat.get('metal_dark');
    box(0.22, 0.1, 0.18, dark, 0.38, 1.08, 0.12, this.root);
    this.paper = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 1), new THREE.MeshStandardMaterial({ color: 0xf2efe4, roughness: 0.9, side: THREE.DoubleSide }));
    this.paper.geometry.translate(0, -0.5, 0);
    this.paper.position.set(0.38, 1.13, 0.215); this.paper.scale.y = 0.001; this.root.add(this.paper);
    this.paperT = 0;
    this.addColliders(this.cols);
  }

  get nodes() { return this.econ?.tree || []; }

  prompt() {
    const k = input.keyName('interact');
    if (!this.unlocked) return 'FIELD OPS TERMINAL — OFFLINE. Build your camp first.';
    const ready = this.nodes.filter((n) => this.econ.state(n) === 'ready').length;
    return `[${k}] Open the QUEST NETWORK${ready ? ` — ${ready} reward${ready === 1 ? '' : 's'} to claim!` : ''}`;
  }

  interact() {
    if (!this.unlocked) { audio.play('ui_error', { volume: 0.4, bus: 'ui' }); this.world.game.ui.toast('FIELD OPS OFFLINE: build your camp first', 'warn'); return; }
    const self = this;
    // start on something worth looking at: a claimable node, else the first active one
    const e = this.econ;
    const pick = this.nodes.find((n) => e.state(n) === 'ready') || this.nodes.find((n) => e.state(n) === 'active' && n.sec !== 'MAIN') || this.nodes.find((n) => e.state(n) === 'active');
    if (pick) this.sel = pick.id;
    this._open({
      view() { return self._view(); },
      select() { self._claim(); },
      draw(ctx, w, h, pal, t) { self._draw(ctx, w, h, pal, t, true); },
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
    if (best) { this.sel = best.id; audio.play('ui_blip', { volume: 0.25, bus: 'ui', pitch: 1.1 }); }
  }

  _view() {
    if (input.hit('left')) this._move(-1, 0);
    if (input.hit('right')) this._move(1, 0);
    if (input.hit('forward')) this._move(0, -1);
    if (input.hit('back')) this._move(0, 1);
    const n = this.econ?.byId[this.sel];
    return { items: [{ label: 'CLAIM', disabled: !n || this.econ.state(n) !== 'ready' }] };
  }

  _claim() {
    const n = this.econ.byId[this.sel];
    if (!n) return;
    this.send('claim', { id: n.id });
  }

  hostAction(a, d, from) { if (a === 'claim') this.econ?.hostClaim(d?.id, from); }

  // every peer (crusher fx hub): a reward was claimed
  onClaimFx(m) {
    this.claimFx = { t0: this.t, id: m.id, v: m.v };
    this.paperT = 1.4;
    audio.play('stamp_claim', { pos: this.root.position, volume: 0.9 });
    audio.play('_printer', { pos: this.root.position, volume: 0.6 });
  }

  update(dt) {
    super.update(dt);
    this.paperT = Math.max(0, this.paperT - dt);
    const k = this.paperT > 0 ? Math.min(1, (1.4 - this.paperT) / 0.9) : Math.max(0, this.paper.scale.y - dt * 0.6);
    this.paper.scale.y = Math.max(0.001, k * 0.22);
  }

  drawIdle(ctx, w, h, pal, t) {
    if (!this.unlocked) return this._lockedScreen(ctx, w, h, pal, t, 'FIELD OPS', 'COMPLETE: CONSTRUCT A BASE');
    this._draw(ctx, w, h, pal, t, false);
  }

  _nodeRect(n) { return [COLX(n.x) - NW / 2, ROWY(n.y), NW, NH]; }

  _draw(ctx, W, H, pal, t, live) {
    const e = this.econ;
    if (!e) return;
    const nodes = this.nodes;
    const mainDone = e.mainDone();
    ctx.imageSmoothingEnabled = false;
    // header (glow only on the big type: canvas shadows are expensive per primitive)
    text(ctx, 'FIELD OPS // QUEST NETWORK', 14, 4, 30, pal.hi);
    ctx.shadowBlur = 0;
    text(ctx, `${e.rules.name}: ${e.rules.title}`, W - 14, 6, 24, pal.dim, 'right');
    ctx.fillStyle = pal.dim; ctx.fillRect(14, 36, W - 28, 2);
    // ---- links
    const center = (n) => [COLX(n.x), ROWY(n.y) + NH / 2];
    const linkStyle = (a, b) => {
      const sa = e.state(a), sb = e.state(b);
      if (sa === 'claimed' && sb === 'claimed') return 'done';
      if (sa === 'claimed') return 'live';
      return 'off';
    };
    const colorOf = (n) => (n.sec === 'MAIN' ? MAIN_COLOR : SECTIONS.find((s) => s.id === n.sec)?.color || pal.fg);
    const drawLink = (pts, style, col) => {
      ctx.save();
      ctx.lineJoin = 'miter';
      if (style === 'done') { ctx.strokeStyle = hexA(col, 0.85); ctx.lineWidth = 3; ctx.setLineDash([]); }
      else if (style === 'live') { ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.setLineDash([10, 6]); ctx.lineDashOffset = -t * 40; }
      else { ctx.strokeStyle = hexA(pal.dim, 0.6); ctx.lineWidth = 2; ctx.setLineDash([3, 6]); }
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.restore();
      if (style === 'live') {
        // a data packet running along the link
        let L = 0;
        const seg = [];
        for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); L += l; }
        let d = ((t * 90) % (L + 40)) - 20;
        for (let i = 1; i < pts.length && d >= 0; i++) {
          if (d <= seg[i - 1]) {
            const k = d / seg[i - 1];
            const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k;
            ctx.fillStyle = pal.hi; ctx.fillRect(x - 3, y - 3, 6, 6);
            break;
          }
          d -= seg[i - 1];
        }
      }
    };
    const root = e.byId.m_cash;
    // main trunk (horizontal)
    for (const n of nodes) {
      for (const dId of n.deps) {
        const d = e.byId[dId];
        if (!d) continue;
        const [x0, y0] = center(d), [x1, y1] = center(n);
        const st = linkStyle(d, n);
        if (n.sec === 'MAIN') drawLink([[x0 + NW / 2, y0], [x1 - NW / 2, y1]], st, MAIN_COLOR);
        else if (d === root) continue; // the bus below
        else if (d.x === n.x) drawLink([[x0, y0 + NH / 2], [x1, y1 - NH / 2]], st, colorOf(n));
        else {
          // cross-link: out of the side of the parent, along the gutter, into the child's top corner
          const sx = d.x < n.x ? 1 : -1;
          const gx = x0 + sx * (NW / 2 + 8), my = ROWY(n.y) - 7;
          drawLink([[x0 + sx * NW / 2, y0], [gx, y0], [gx, my], [x1 - sx * 30, my], [x1 - sx * 30, ROWY(n.y)]], st, colorOf(n));
        }
      }
    }
    // the escape link carries the escape-fund gauge
    const esc = e.byId.m_escape;
    if (esc && root) {
      const [x0, y0] = center(root), [x1] = center(esc);
      const bx = x0 + NW / 2 + 10, bw = x1 - NW / 2 - 10 - bx, f = clamp01(e.escape / e.quota);
      ctx.fillStyle = hexA(pal.dim, 0.4); ctx.fillRect(bx, y0 + 6, bw, 8);
      ctx.fillStyle = pal.bad; ctx.fillRect(bx, y0 + 6, bw * f, 8);
      text(ctx, `${short$(e.escape)} / ${short$(e.quota)}`, bx + bw / 2, y0 - 16, 20, pal.fg, 'center');
    }
    // bus from the root down to every section
    if (root) {
      const [rx, ry] = center(root);
      const busY = 96;
      const live = e.state(root) === 'claimed';
      drawLink([[rx, ry + NH / 2], [rx, busY]], live ? 'done' : 'off', MAIN_COLOR);
      drawLink([[COLX(0), busY], [COLX(4), busY]], live ? 'done' : 'off', MAIN_COLOR);
      for (const s of SECTIONS) {
        const first = nodes.find((n) => n.sec === s.id && n.deps.includes('m_cash'));
        if (!first) continue;
        drawLink([[COLX(s.col), busY], [COLX(s.col), ROWY(first.y)]], linkStyle(root, first), s.color);
        // section tab
        const tw = 104, tx = COLX(s.col) - tw / 2;
        ctx.fillStyle = pal.bg; ctx.fillRect(tx, 101, tw, 18);
        ctx.strokeStyle = mainDone ? s.color : hexA(pal.dim, 0.8); ctx.lineWidth = 1.5; ctx.strokeRect(tx + 0.5, 101.5, tw - 1, 17);
        text(ctx, s.id, COLX(s.col), 100, 19, mainDone ? s.color : pal.dim, 'center');
      }
    }
    // ---- nodes
    for (const n of nodes) {
      const st = e.state(n), [x, y, w, h] = this._nodeRect(n), col = colorOf(n);
      const sel = live && n.id === this.sel;
      const pr = e.progress(n);
      const lockedSide = n.sec !== 'MAIN' && !mainDone;
      ctx.save();
      if (st === 'claimed') { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); }
      else if (st === 'ready') { ctx.fillStyle = hexA(col, Math.floor(t * 4) % 2 ? 0.55 : 0.25); ctx.fillRect(x, y, w, h); }
      else { ctx.fillStyle = pal.bg; ctx.fillRect(x, y, w, h); }
      ctx.strokeStyle = st === 'locked' ? hexA(pal.dim, lockedSide ? 0.45 : 0.8) : col;
      ctx.lineWidth = st === 'ready' ? 3 : 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      if (n.hard) { ctx.strokeRect(x - 3, y - 3, w + 6, h + 6); star(ctx, x + w - 2, y + 2, 7, st === 'locked' ? pal.dim : '#ffd060'); }
      const tc = st === 'claimed' ? pal.bg : st === 'locked' ? pal.dim : st === 'ready' ? pal.hi : col;
      if (st === 'locked') lock(ctx, x + 6, y + 8, 13, hexA(pal.dim, 0.9));
      else if (st === 'claimed') check(ctx, x + 6, y + 9, 13, pal.bg);
      text(ctx, n.short, x + 24, y + 2, 22, tc, 'left');
      if (st === 'active') {
        ctx.fillStyle = hexA(col, 0.25); ctx.fillRect(x + 4, y + h - 6, w - 8, 3);
        ctx.fillStyle = col; ctx.fillRect(x + 4, y + h - 6, (w - 8) * pr.frac, 3);
      }
      if (st === 'ready') text(ctx, 'CLAIM', x + w - 4, y + 4, 16, pal.hi, 'right');
      if (sel) {
        const p = 4 + Math.sin(t * 8) * 2, L = 10;
        ctx.strokeStyle = pal.hi; ctx.lineWidth = 2;
        for (const [cx, cy, sx, sy] of [[x - p, y - p, 1, 1], [x + w + p, y - p, -1, 1], [x - p, y + h + p, 1, -1], [x + w + p, y + h + p, -1, -1]]) {
          ctx.beginPath(); ctx.moveTo(cx + sx * L, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy * L); ctx.stroke();
        }
      }
      ctx.restore();
    }
    if (!mainDone) {
      ctx.fillStyle = hexA(pal.bg, 0.72); ctx.fillRect(14, 196, W - 28, 52);
      ctx.strokeStyle = pal.bad; ctx.lineWidth = 2; ctx.strokeRect(14, 196, W - 28, 52);
      text(ctx, 'SIDE QUESTS LOCKED — COMPLETE MAIN MISSION 1', W / 2, 208, 30, Math.floor(t * 2) % 2 ? pal.bad : pal.fg, 'center');
    }
    // ---- detail panel
    const n = live ? e.byId[this.sel] : (nodes.find((x) => e.state(x) === 'ready') || nodes.find((x) => e.state(x) === 'active'));
    const py = 352;
    ctx.fillStyle = pal.dim; ctx.fillRect(14, py - 8, W - 28, 2);
    if (n) {
      const st = e.state(n), pr = e.progress(n), col = colorOf(n);
      text(ctx, n.name, 16, py, 32, col);
      text(ctx, `${n.sec}${n.hard ? ' · HARD' : ''} · ${st.toUpperCase()}`, W - 16, py + 4, 22, st === 'ready' ? pal.hi : pal.dim, 'right');
      ctx.font = '23px "VT323", monospace';
      wrap(ctx, n.desc, 440, 23).slice(0, 2).forEach((ln, i) => text(ctx, ln, 16, py + 34 + i * 22, 23, pal.fg));
      // progress
      const by = py + 96;
      if (pr.parts) pr.parts.forEach((p, i) => text(ctx, `${p.label} ${p.have}/${p.need}`, 16 + i * 150, by - 6, 20, p.have >= p.need ? pal.good : pal.dim));
      else text(ctx, pr.failed ? 'FAILED: A CLONE WAS RE-PRINTED' : `PROGRESS ${pr.need >= 1000 ? `${short$(pr.have)} / ${short$(pr.need)}` : `${Math.floor(pr.have)} / ${pr.need}`}`, 16, by - 6, 20, pr.failed ? pal.bad : pal.dim);
      ctx.fillStyle = hexA(pal.dim, 0.35); ctx.fillRect(16, by + 18, 440, 8);
      ctx.fillStyle = st === 'claimed' ? pal.good : col; ctx.fillRect(16, by + 18, 440 * (st === 'claimed' ? 1 : pr.frac), 8);
      // rewards
      const rx = 480;
      text(ctx, 'REWARD', rx, py + 34, 22, pal.dim);
      const r = n.reward || {};
      const lines = [];
      if (r.credits) lines.push([fmt$(r.credits), pal.good]);
      for (const k of r.unlock || []) lines.push([unlockLabel(k), pal.fg]);
      if (r.ach) lines.push(['ACHIEVEMENT + COSMETIC', '#ffd060']);
      if (!lines.length) lines.push(['HQ\'S GRATITUDE', pal.dim]);
      lines.slice(0, 3).forEach(([s, c], i) => text(ctx, s, rx, py + 56 + i * 22, 22, c));
      if (live && st === 'ready') text(ctx, Math.floor(t * 3) % 2 ? '[E] CLAIM REWARD' : '', W - 16, by + 6, 30, pal.hi, 'right');
      else if (st === 'claimed') text(ctx, 'CLAIMED', W - 16, by + 6, 28, pal.good, 'right');
    }
    if (this.claimFx) {
      const k = (this.t - this.claimFx.t0) / 1.8;
      if (k > 1) this.claimFx = null;
      else stamp(ctx, 'CLAIMED', W - 180, py + 60, clamp01(k * 2.4), pal.good);
    }
    text(ctx, live ? '[WASD] NAVIGATE  [E] CLAIM  [TAB] EXIT' : `[${input.keyName('interact')}] OPEN THE QUEST NETWORK`, 16, H - 24, 20, pal.dim);
    void itemName; void WATCH_APPS;
  }
}
