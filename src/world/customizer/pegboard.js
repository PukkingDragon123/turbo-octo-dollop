// HATS station: a painted pegboard on a stand with every hat, piece of face gear and trinket hanging on
// its own hook. Click one: it hops off the hook, flies over and settles on the clone (with a squash); the
// thing it replaces hops back onto its hook. Click an empty hook (the one you are wearing) to take it off.
import * as THREE from 'three';
import { profile } from '../../core/profile.js';
import { COSMETICS } from '../../entities/doll/dollcos.js';
import { buildCosmeticModel } from '../../entities/doll/hats.js';
import { LEGACY_RAG } from '../../entities/doll/cloth.js';
import { TX, FM, P, ptex, css, shade } from '../../entities/doll/handpaint.js';
import { PI, TAU, clamp, damp, rnd, V, mesh, rbox, cyl, hitBox, backOut } from './kit.js';
import { Flyers } from './fly.js';
import { sfx, noiseHit } from './sfx.js';
import { registerStation } from './registry.js';

export const BOARD_POS = V(0.72, 0, 1.5);
const COLS = 7, CW = 0.17, CH = 0.19;

function boardTex() {
  return ptex('cz_pegboard', 1024, 768, (g, w, h, r) => {
    P.wash(g, w, h, 0xb08a58, { k: 0.12 });
    P.strokes(g, w, h, 0xb08a58, r, { n: 80, len: 0.5, wid: 0.05, alpha: 0.12, angle: 0, jitter: 0.2 });
    // the perforations
    for (let y = 18; y < h; y += 36) for (let x = 18; x < w; x += 36) {
      g.fillStyle = css(0x2a2016, 0.85); g.beginPath(); g.arc(x, y, 5, 0, TAU); g.fill();
      g.fillStyle = css(0xd8b888, 0.4); g.beginPath(); g.arc(x - 1, y - 2, 5, PI * 1.1, PI * 1.9); g.fill();
    }
    P.blotches(g, w, h, 0x4a3420, r, { n: 9, r: 0.12, alpha: 0.15 });
    // painted tool outlines (hats, glasses), the workshop's shadow board habit
    g.strokeStyle = css(0xf1e6cc, 0.35); g.lineWidth = 4;
    P.edgeWear(g, w, h, r, { amt: 0.8 });
  });
}

class HatWall {
  constructor(cz) {
    this.cz = cz;
    this.group = new THREE.Group(); this.group.name = 'cz_hats';
    this.group.position.copy(BOARD_POS); this.group.rotation.y = 0.18;
    cz.scene.add(this.group);
    this.fly = new Flyers(cz.scene);
    this.items = [];
    this._build();
  }
  _build() {
    const g = this.group;
    const list = [
      ...COSMETICS.hat.filter((e) => e.id !== 'none').map((e) => ['hat', e]),
      ...COSMETICS.visor.filter((e) => e.id !== 'none').map((e) => ['visor', e]),
      ...COSMETICS.accessory.filter((e) => e.id !== 'none' && !LEGACY_RAG[e.id]).map((e) => ['accessory', e]),
    ];
    const rows = Math.ceil(list.length / COLS);
    const W = COLS * CW + 0.08, H = rows * CH + 0.1, y0 = 0.82;
    const steel = FM.paintedMetal('cz_standsteel', TX.paintedSteel(0x3f6b66, 31));
    g.add(mesh(new THREE.BoxGeometry(W, H, 0.012), new THREE.MeshPhysicalMaterial({ map: boardTex(), roughness: 0.85 }), { y: y0 + H / 2, z: 0.01 }));
    g.add(mesh(rbox(W + 0.03, 0.03, 0.03, 0.006), FM.paintedMetal('cz_frame', TX.wood(0x6a4428, 33), { metal: 0, rough: 0.8 }), { y: y0 + H + 0.012, z: 0.0 }));
    g.add(mesh(rbox(W + 0.03, 0.03, 0.03, 0.006), FM.paintedMetal('cz_frame', TX.wood(0x6a4428, 33), { metal: 0, rough: 0.8 }), { y: y0 - 0.012, z: 0.0 }));
    for (const s of [-1, 1]) { g.add(mesh(cyl(0.016, y0 + H, 10), steel, { x: s * (W / 2 - 0.05), y: (y0 + H) / 2, z: 0.03 })); g.add(mesh(rbox(0.05, 0.02, 0.4, 0.006), steel, { x: s * (W / 2 - 0.05), y: 0.01, z: 0.03 })); }
    const sign = ptex('cz_hatsign', 512, 128, (c, w, h, r) => { P.wash(c, w, h, 0xc4572a, { k: 0.15 }); P.strokes(c, w, h, 0xc4572a, r, { n: 30, alpha: 0.15 }); P.text(c, 'hats & trinkets', w / 2, h / 2 + 4, 74, 0xf1e6cc, r, { slot: 'sign' }); P.edgeWear(c, w, h, r); });
    g.add(mesh(new THREE.PlaneGeometry(0.62, 0.155), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.8 }), { y: y0 + H + 0.11, z: -0.01, ry: PI, cast: false }));
    const hookMat = FM.bare('cz_hook', 0x9a968c, { rough: 0.35 });
    list.forEach(([slot, e], i) => {
      const row = Math.floor(i / COLS), col = i % COLS;
      const cell = new THREE.Group();
      cell.position.set(-W / 2 + 0.04 + CW * (col + 0.5), y0 + H - 0.05 - CH * (row + 0.5), -0.004);
      g.add(cell);
      cell.add(mesh(new THREE.TorusGeometry(0.012, 0.0025, 6, 12, PI), hookMat, { y: 0.06, z: -0.012, rx: PI / 2, rz: PI }));
      cell.add(mesh(cyl(0.0025, 0.03, 6), hookMat, { y: 0.06, z: -0.012, rx: PI / 2 }));
      const locked = !!e.unlock && !profile.has(e.unlock);
      let M = null;
      try { M = buildCosmeticModel(slot, e); } catch (err) { console.warn('[customizer] model', slot, e.id, err); }
      if (!M) return;
      const disp = new THREE.Group(); cell.add(disp);
      const obj = M.object;
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj), size = box.getSize(V()), c = box.getCenter(V());
      const k = Math.min(0.15 / Math.max(size.x, 0.01), 0.15 / Math.max(size.y, 0.01), 0.15 / Math.max(size.z, 0.01));
      const inner = new THREE.Group(); inner.add(obj); obj.position.sub(c);
      inner.scale.setScalar(Math.min(k, 1.6)); inner.rotation.y = PI;   // face the room
      disp.add(inner);
      if (locked) inner.traverse((o) => { if (o.isMesh) { const dim = (mt) => { const c = mt.clone(); c.color?.multiplyScalar(0.45); return c; }; o.material = Array.isArray(o.material) ? o.material.map(dim) : dim(o.material); } });
      // a little chalk name tag under each hook
      const tag = ptex('cz_hattag_' + slot + e.id + (locked ? 'l' : ''), 256, 64, (cc, w, h, r) => { cc.clearRect(0, 0, w, h); P.text(cc, (locked ? 'locked · ' : '') + e.name.toLowerCase(), w / 2, h / 2, 34, locked ? 0x9a8a78 : 0xf1e6cc, r, { maxW: w * 0.95 }); });
      cell.add(mesh(new THREE.PlaneGeometry(0.15, 0.0375), new THREE.MeshBasicMaterial({ map: tag, transparent: true, depthWrite: false }), { y: -0.085, z: -0.008, ry: PI, cast: false }));
      const hb = hitBox(CW * 0.95, CH * 0.95, 0.12); hb.position.z = -0.04; cell.add(hb);
      this.cz.hits.add(hb, { st: 'hats', type: 'item', i, hover: () => { this.hoverI = i; } });
      this.items.push({ slot, e, cell, disp, inner, locked, hov: 0, out: false, wob: 0, wobV: 0, pop: 0 });
    });
    this._syncWorn(true);
  }
  wornId(slot) { return this.cz.cos[slot]; }
  // items currently on the clone are off their hooks
  _syncWorn(instant = false) {
    for (const it of this.items) {
      const on = this.wornId(it.slot) === it.e.id;
      if (on && !it.out) { it.out = true; if (instant) it.disp.visible = false; }
      if (!on && it.out && instant) { it.out = false; it.disp.visible = true; }
    }
  }
  click(act) {
    if (act.type !== 'item' || this.fly.busy) return;
    const it = this.items[act.i];
    it.wobV += 7;
    if (it.locked) { sfx('buzzer', { volume: 0.25 }); return; }
    const cz = this.cz;
    if (it.out) {
      // take it off: back onto its hook with a hop
      cz.setCos({ [it.slot]: 'none' });
      this._backOnHook(it);
      sfx('release', { volume: 0.4 });
      return;
    }
    const prev = this.items.find((x) => x.slot === it.slot && x.out);
    const boneName = it.slot === 'hat' ? 'hat' : it.slot === 'visor' ? 'head' : 'chest';
    const fl = it.disp;
    const home = { p: fl.position.clone(), q: fl.quaternion.clone(), s: fl.scale.clone() };
    it.home = home;
    sfx('grab', { volume: 0.35, pitch: 1.3 });
    noiseHit({ freq: 2600, q: 5, dur: 0.05, vol: 0.12 });
    it.out = true;
    this.fly.add(fl, {
      to: () => cz.avatar.bones[boneName].getWorldPosition(V()).add(V(0, it.slot === 'hat' ? 0.06 : 0.02, 0)),
      toQ: () => cz.avatar.bones[boneName].getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), PI)),
      dur: 0.65, arc: 0.3, spin: 3, scaleTo: 0.85,
      onArrive: () => {
        fl.visible = false;
        cz.setCos({ [it.slot]: it.e.id });
        cz.hatPop = 1;
        sfx(it.slot === 'hat' ? 'impact_soft' : 'release', { volume: 0.45, pitch: 1.3 });
        cz.pop(0.5);
        // reset the display copy at its hook (hidden while worn)
        it.cell.add(fl); fl.position.copy(home.p); fl.quaternion.copy(home.q); fl.scale.copy(home.s);
        if (prev) this._backOnHook(prev);
      },
    });
  }
  _backOnHook(it) {
    it.out = false;
    it.disp.visible = true;
    it.pop = 1;
    it.wobV += 8;
    sfx('knob_tick', { volume: 0.3, pitch: 0.8 });
  }
  update(dt, active) {
    this.fly.update(dt);
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const hov = active && this.hoverI === i;
      it.hov = damp(it.hov, hov ? 1 : 0, 10, dt);
      it.wobV += (-90 * it.wob - 5 * it.wobV) * dt; it.wob += it.wobV * dt;
      it.pop = Math.max(0, it.pop - dt * 2.5);
      if (it.disp.parent === it.cell) {
        it.disp.position.set(0, 0, -it.hov * 0.03);
        it.disp.rotation.set(0, Math.sin(this.cz.t * 1.5 + i) * 0.05 * it.hov, it.wob * 0.06);
        const s = 1 + it.hov * 0.08 + (it.pop > 0 ? Math.sin((1 - it.pop) * PI * 3) * 0.25 * it.pop : 0);
        it.disp.scale.setScalar(it.pop > 0.98 ? 0.01 : s);
      }
    }
    this.hoverI = -1;
  }
  dispose() {}
}

registerStation('hats', (cz) => new HatWall(cz));
void clamp; void shade; void backOut;
