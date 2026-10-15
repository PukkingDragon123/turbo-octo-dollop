// On-screen inventory: every slot visible as a pixel-art pocket (steel frame, dark well, item sprite,
// slot number, charge / state tag). The selected pocket lifts with a little bounce and an item-name
// plate pops above the bar. On touch screens a tap selects a pocket and dragging one up off the bar
// drops that item (select + G in the same frame, so gameplay code is untouched).
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { itemName, itemDef, SAMPLES } from '../game/itemdefs.js';
import { Pix, C, mix, text, textWidth, FONT3, FONT5 } from './pixelart.js';

const SLOT = 28;
const VERB = {
  eat: 'EAT', drink: 'DRINK', heal: 'APPLY', flashlight: 'TOGGLE', weld: 'WELD', multitool: 'DISMANTLE', sample: 'COLLECT',
  battery: 'RECHARGE', glowstick: 'CRACK', flare: 'LIGHT', lighter: 'LIGHT', swing: 'SWING', test: 'TEST', arm: 'ARM',
  throw: 'THROW', music: 'PLAY', spray: 'SPRAY',
};

export function itemTag(it) {
  if (!it) return null;
  const st = it.state || {};
  const pct = (v) => { const n = Math.round(Math.max(0, Math.min(1, v ?? 1)) * 100); return { t: `${n}%`, c: n < 20 ? C.red : n < 50 ? C.amber : C.green }; };
  if (st.lit) return { t: 'LIT', c: C.amber4 };
  if (it.type === 'flashlight') return pct(st.charge);
  if (it.type === 'welder') return pct(st.fuel);
  if (it.type === 'sample_jar') return st.kind ? { t: 'FULL', c: C.green } : null;
  if (st.count > 1) return { t: `x${st.count}`, c: C.white };
  if (st.uses > 1) return { t: `x${st.uses}`, c: C.white };
  return null;
}

export function itemLabel(it) {
  if (!it) return '';
  return it.type === 'sample_jar' && it.state?.kind ? `Sample: ${SAMPLES[it.state.kind]?.name || 'Sample'}` : itemName(it.type);
}

function slotPix(i, it, sel, iconPix) {
  const p = new Pix(SLOT, SLOT);
  const edge = sel ? C.amber : C.st2;
  p.rbox(0, 0, SLOT, SLOT, 2, C.ink);
  p.rbox(1, 1, SLOT - 2, SLOT - 2, 1, edge);
  // bevel
  p.hline(2, SLOT - 3, 1, sel ? C.amber5 : C.st3); p.vline(1, 2, SLOT - 3, sel ? C.amber4 : C.st3);
  p.hline(2, SLOT - 3, SLOT - 2, sel ? C.amber1 : C.st1); p.vline(SLOT - 2, 2, SLOT - 3, sel ? C.amber2 : C.st1);
  // well
  p.rect(2, 2, SLOT - 4, SLOT - 4, sel ? [40, 24, 6, 225] : [10, 7, 4, 205]);
  p.hline(2, SLOT - 3, 2, C.ink); p.vline(2, 2, SLOT - 3, C.ink);
  if (sel) { // warm glow pooling at the bottom of the well
    for (let y = SLOT - 9; y < SLOT - 2; y++) for (let x = 3; x < SLOT - 2; x++) p.set(x, y, [255, 180, 58, (y - (SLOT - 9)) * 7]);
  }
  if (iconPix) p.blit(iconPix, 2, 2);
  else { // empty pocket: stitched outline
    for (let k = 6; k < SLOT - 6; k += 2) { p.set(k, 6, C.ink4); p.set(k, SLOT - 7, C.ink4); p.set(6, k, C.ink4); p.set(SLOT - 7, k, C.ink4); }
  }
  // corner brackets on the selected pocket
  if (sel) {
    for (const [x, y, dx, dy] of [[1, 1, 1, 1], [SLOT - 2, 1, -1, 1], [1, SLOT - 2, 1, -1], [SLOT - 2, SLOT - 2, -1, -1]]) {
      p.set(x, y, C.white); p.set(x + dx, y, C.amber5); p.set(x, y + dy, C.amber5); p.set(x + dx * 2, y, C.amber4); p.set(x, y + dy * 2, C.amber4);
    }
  }
  // number + tag (outlined so they read over the sprite)
  text(p, String(i + 1), 4, 4, sel ? C.amber5 : it ? C.st4 : C.st2, { font: FONT3, outline: C.ink });
  const tag = itemTag(it);
  if (tag) text(p, tag.t, SLOT - 4, SLOT - 9, tag.c, { font: FONT3, align: 'right', outline: C.ink });
  return p;
}

function namePix(name, hint) {
  const w1 = textWidth(name, FONT5), w2 = hint ? textWidth(hint, FONT3) : 0;
  const w = Math.max(w1, w2) + 10, h = hint ? 19 : 12;
  const p = new Pix(w, h + 1);
  p.rect(1, 1, w, h, [0, 0, 0, 100]);
  p.rbox(0, 0, w, h, 1, C.ink);
  p.rect(1, 1, w - 2, h - 2, [18, 11, 4, 235]);
  p.hline(2, w - 3, 1, C.amber2); p.hline(2, w - 3, h - 2, C.amber1);
  p.set(1, 2, C.amber1); p.set(w - 2, 2, C.amber1);
  text(p, name, w / 2, 3, C.amber5, { align: 'center', shadow: C.amber0 });
  if (hint) text(p, hint, w / 2, 12, C.amber2, { font: FONT3, align: 'center' });
  return p;
}

export class Hotbar {
  constructor(ui) {
    this.ui = ui;
    this.root = document.createElement('div');
    this.root.id = 'pxinv';
    this.root.className = 'hidden';
    this.root.innerHTML = '<canvas class="inv-name"></canvas><div class="inv-row"></div>';
    document.body.appendChild(this.root);
    this.row = this.root.querySelector('.inv-row');
    this.nameCv = this.root.querySelector('.inv-name');
    this.nameCv.width = 1; this.nameCv.height = 1; // no 300x150 default box before the first name is drawn
    this.nameCv.style.width = '0px'; this.nameCv.style.height = '0px';
    this.slots = [];
    this.keys = [];
    this.lastSel = -1;
    this.nameT = 0;
    this.drag = null;
    this.ghost = null;
    this.visible = false;
    this._bind();
  }

  setScale(s) {
    if (this._scale === s) return;
    this._scale = s;
    this.root.style.setProperty('--hs', `${s}px`);
    this._sizeName();
  }

  _sizeName() {
    if (!this._nameWH) return;
    const s = this._scale || 2;
    this.nameCv.style.width = `${this._nameWH[0] * s}px`;
    this.nameCv.style.height = `${this._nameWH[1] * s}px`;
  }

  // touch layout hook: centre x and bottom offset (px)
  place(pos) {
    const st = this.root.style;
    if (!pos) { st.left = ''; st.bottom = ''; st.top = ''; return; }
    st.left = `${Math.round(pos.cx)}px`;
    st.bottom = pos.bottom != null ? `${Math.round(pos.bottom)}px` : '';
    st.top = pos.top != null ? `${Math.round(pos.top)}px` : '';
  }

  get width() { return this.row.getBoundingClientRect().width; }

  _ensureSlots(n) {
    while (this.slots.length < n) {
      const i = this.slots.length;
      const d = document.createElement('div');
      d.className = 'inv-slot';
      d.dataset.i = i;
      const cv = document.createElement('canvas');
      cv.width = SLOT; cv.height = SLOT;
      d.appendChild(cv);
      this.row.appendChild(d);
      this.slots.push({ el: d, cv });
      this.keys.push('');
    }
    while (this.slots.length > n) { this.slots.pop().el.remove(); this.keys.pop(); }
  }

  _bind() {
    const r = this.row;
    r.addEventListener('pointerdown', (e) => {
      const s = e.target.closest('.inv-slot');
      if (!s || !input.touch) return;
      e.preventDefault(); e.stopPropagation();
      input.lastTouch = performance.now();
      try { s.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      this.drag = { i: +s.dataset.i, id: e.pointerId, x0: e.clientX, y0: e.clientY, on: false, el: s };
    }, { passive: false });
    const move = (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      e.preventDefault();
      const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
      if (!d.on && Math.hypot(dx, dy) > 14 && this._slotItem(d.i)) {
        d.on = true;
        d.el.classList.add('drag');
        this._ghost(d.i);
        audio.ready && audio.play('grab', { volume: 0.25, bus: 'ui' });
      }
      if (d.on && this.ghost) {
        this.ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -60%)`;
        this.ghost.classList.toggle('armed', this._outside(e));
      }
    };
    const up = (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      e.preventDefault();
      this.drag = null;
      d.el.classList.remove('drag');
      const out = d.on && this._outside(e);
      if (this.ghost) { this.ghost.remove(); this.ghost = null; }
      if (e.type === 'pointercancel') return;
      if (!d.on || out) this._select(d.i);
      if (out) this._tapKey('KeyG');
    };
    r.addEventListener('pointermove', move, { passive: false });
    r.addEventListener('pointerup', up, { passive: false });
    r.addEventListener('pointercancel', up, { passive: false });
    r.addEventListener('contextmenu', (e) => e.preventDefault());
    r.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  }

  _outside(e) {
    const b = this.row.getBoundingClientRect();
    return e.clientY < b.top - 18 || e.clientY > b.bottom + 30 || e.clientX < b.left - 30 || e.clientX > b.right + 30;
  }

  _slotItem(i) { return this.ui.game?.local?.inv?.slots?.[i] || null; }

  _select(i) {
    const inv = this.ui.game?.local?.inv;
    if (!inv) return;
    const b = input.binds[`slot${i + 1}`];
    if (b && b[0]) this._tapKey(b[0]);
    else inv.select(i);
    try { navigator.vibrate?.(6); } catch (err) { /* ignore */ }
  }

  _tapKey(code) {
    input.virtualDown(code);
    setTimeout(() => input.virtualUp(code), 70);
  }

  _ghost(i) {
    const it = this._slotItem(i);
    const ip = it ? this.ui.iconPix(it.type, it.type === 'sample_jar' && it.state?.kind ? 'full' : undefined) : null;
    if (!ip) return;
    const g = document.createElement('div');
    g.className = 'inv-ghost';
    const cv = ip.toCanvas();
    g.appendChild(cv);
    const lab = document.createElement('span');
    lab.textContent = 'DROP';
    g.appendChild(lab);
    g.style.setProperty('--hs', `${this._scale || 2}px`);
    document.body.appendChild(g);
    this.ghost = g;
  }

  setVisible(on) {
    if (on === this.visible) return;
    this.visible = on;
    this.root.classList.toggle('hidden', !on);
    if (!on && this.drag) { this.drag = null; this.ghost?.remove(); this.ghost = null; }
  }

  update(dt, l, tick) {
    const inv = l?.inv;
    if (!inv) return;
    const slots = inv.slots || [];
    this._ensureSlots(slots.length);
    const sel = inv.selected;
    slots.forEach((it, i) => {
      const tag = itemTag(it);
      const variant = it?.type === 'sample_jar' && it.state?.kind ? 'full' : '';
      const key = `${it ? it.type : '-'}|${variant}|${tag ? tag.t : ''}|${i === sel ? 1 : 0}`;
      if (key === this.keys[i]) return;
      this.keys[i] = key;
      const ip = it ? this.ui.iconPix(it.type, variant || undefined) : null;
      slotPix(i, it, i === sel, ip).toCanvas(this.slots[i].cv);
      this.slots[i].el.classList.toggle('sel', i === sel);
      this.slots[i].el.classList.toggle('empty', !it);
    });
    // selection changed: bounce + name plate (a free hand shows the built-in multitool's mode)
    const cur = inv.current;
    const mtFree = typeof l.toggleMultitoolMode === 'function' && !(cur && itemDef(cur.type).use);
    const curKey = `${sel}|${cur ? cur.type : ''}|${mtFree ? l.mtMode : ''}`;
    if (curKey !== this.lastSel) {
      const first = this.lastSel === -1;
      this.lastSel = curKey;
      const el = this.slots[sel]?.el;
      if (el && !first) { el.classList.remove('bounce'); void el.offsetWidth; el.classList.add('bounce'); }
      if (mtFree && !cur) {
        const mode = l.mtMode === 'dismantle' ? 'DISMANTLE' : 'ATTACH';
        const np = namePix(`MULTITOOL: ${mode}`, input.touch ? 'ITEM: USE · MODE: SWITCH' : 'RMB: USE · R: SWITCH MODE');
        np.toCanvas(this.nameCv);
        this._nameWH = [np.w, np.h];
        this._sizeName();
        this.nameT = first ? 0 : 2.4;
      } else if (cur) {
        const use = itemDef(cur.type).use;
        const verb = VERB[use] || (use ? 'USE' : '');
        const hint = verb ? (input.touch ? `ITEM: ${verb}` : `RMB: ${verb}`) : mtFree ? (input.touch ? 'ITEM: MULTITOOL' : 'RMB: MULTITOOL') : '';
        const np = namePix(itemLabel(cur), hint);
        np.toCanvas(this.nameCv);
        this._nameWH = [np.w, np.h];
        this._sizeName();
        this.nameT = first ? 0 : 2.4;
      } else this.nameT = 0;
    }
    this.nameT -= dt;
    this.nameCv.classList.toggle('show', this.nameT > 0);
    void tick;
  }
}
