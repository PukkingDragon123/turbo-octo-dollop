// On-screen controls for phones and tablets, drawn in the pixel-art kit: steel / hazmat keycaps with
// phosphor-glass faces, glowing glyphs, amber status LEDs and a real 1 px press travel.
// Left thumb: a floating analog stick (push it all the way to sprint). Right thumb: drag anywhere to look,
// tap to interact, and a cluster of buttons for jump / use / grab / item / crouch. Everything feeds the
// regular input object (virtual keys, mouse buttons and look deltas), so gameplay code is unchanged.
// The layout is computed in pixels for the current viewport + safe area so nothing overlaps, from 360 px
// portrait phones to landscape tablets; the inventory bar and the needs patch are placed around it.
import { input } from '../core/input.js';
import { capPix, stickBasePix, stickKnobPix, Pix, C, text, textWidth, FONT5, glyph } from './pixelart.js';

const LOOK_PER_SCREEN = 3.6; // radians of yaw for a swipe across the full screen width
const SPRINT_AT = 0.9;       // stick deflection that starts a sprint

export function wantsTouch() {
  const q = new URLSearchParams(location.search).get('touch');
  if (q === '1') return true;
  if (q === '0') return false;
  return !!(window.matchMedia?.('(hover: none) and (pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !window.matchMedia?.('(pointer: fine)').matches));
}

// art sizes are in kit pixels; the on-screen size is art * P (2 on phones, 3 on tablets)
const BUTTONS = [
  { id: 'menu', label: 'MENU', icon: 'menu', shape: 'plate', act: 'menu', sys: true },
  { id: 'watch', label: 'WATCH', icon: 'watch', shape: 'plate', key: 'Tab', sys: true, led: true },
  { id: 'light', label: 'LIGHT', icon: 'light', shape: 'plate', key: 'KeyF', sys: true, led: true },
  { id: 'next', label: 'NEXT', icon: 'next', shape: 'plate', act: 'next', sys: true },
  { id: 'drop', label: 'DROP', icon: 'drop', shape: 'plate', key: 'KeyG', sys: true },
  { id: 'ask', label: 'HLTH', icon: 'bot', shape: 'plate', key: 'KeyX', sys: true },
  { id: 'jump', label: 'JUMP', icon: 'jump', d: 32, key: 'Space', bezel: 'hazmat' },
  { id: 'use', label: 'USE', icon: 'hand', d: 28, key: 'KeyE', bezel: 'hazmat' },
  { id: 'grab', label: 'GRAB', icon: 'fist', d: 28, mouse: 0 },
  { id: 'item', label: 'ITEM', icon: 'item', d: 28, mouse: 2 },
  { id: 'duck', label: 'DUCK', icon: 'crouch', d: 24, act: 'duck', led: true },
  { id: 'rot', label: 'ROT', icon: 'rotate', d: 22, key: 'KeyR' },
];
const SYS_ORDER = ['menu', 'watch', 'light', 'next', 'drop', 'ask']; // right to left along the top
const PLATE_W = 30, PLATE_H = 24;

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.crouchOn = false;
    this.stick = null;   // { id, ox, oy }
    this.look = null;    // { id, x, y, t0, moved }
    this.held = new Map(); // pointerId -> button
    this.state = '';
    this.P = 2;
    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.innerHTML = `
      <div class="t-zone t-left"></div>
      <div class="t-zone t-right"></div>
      <div class="t-stick"><canvas class="t-ring"></canvas><canvas class="t-knob"></canvas></div>
      <canvas class="t-ctx"></canvas>
      <div class="t-tabs"></div>
      ${BUTTONS.map((b) => `<button class="t-btn${b.sys ? ' t-sys' : ''}" data-b="${b.id}" type="button" aria-label="${b.label}"><canvas></canvas></button>`).join('')}`;
    document.body.appendChild(this.root);
    this.stickEl = this.root.querySelector('.t-stick');
    this.ringCv = this.root.querySelector('.t-ring');
    this.knobCv = this.root.querySelector('.t-knob');
    this.ctxCv = this.root.querySelector('.t-ctx');
    this.tabsEl = this.root.querySelector('.t-tabs');
    stickBasePix(56).toCanvas(this.ringCv);
    this.knobPix = [stickKnobPix(24, false), stickKnobPix(24, true)];
    this.knobPix[0].toCanvas(this.knobCv);
    this.sprinting = false;
    this.btn = {};
    for (const b of BUTTONS) {
      const el = this.root.querySelector(`[data-b="${b.id}"]`);
      this.btn[b.id] = { def: b, el, cv: el.querySelector('canvas'), down: false, lit: b.led ? false : null, glow: false, label: b.label, icon: b.icon, iconPix: null, key: '' };
    }
    this._buildTabs();
    for (const b of Object.values(this.btn)) this._render(b);
    this._bind();
    this._layout();
    window.addEventListener('resize', () => this._layout());
    window.visualViewport?.addEventListener('resize', () => this._layout());
    window.addEventListener('orientationchange', () => setTimeout(() => this._layout(), 250));
  }

  // ------------------------------------------------------------------ rendering
  _render(b) {
    const d = b.def;
    const key = `${b.down}|${b.lit}|${b.glow}|${b.label}|${b.icon}|${b.iconPix ? b.iconKey : ''}|${b.big ? 1 : 0}`;
    if (key === b.key) return;
    b.key = key;
    const opts = d.shape === 'plate'
      ? { shape: 'plate', w: PLATE_W, h: PLATE_H, icon: b.icon, label: b.label, down: b.down, lit: b.lit, glow: b.glow }
      : { shape: 'round', d: b.big ? 34 : d.d, icon: b.icon, iconPix: b.iconPix, label: b.label, down: b.down, lit: b.lit, glow: b.glow, bezel: d.bezel || 'steel', danger: b.danger };
    const p = capPix(opts);
    p.toCanvas(b.cv);
    b.cv.style.width = `${p.w * this.P}px`;
    b.cv.style.height = `${p.h * this.P}px`;
    b.w = p.w; b.h = p.h;
  }

  _buildTabs() {
    this.tabBtns = [];
    const names = this.game.watch?.tabs || ['STATUS', 'MAP', 'TASK'];
    const icons = ['pulse', 'map', 'task'];
    names.forEach((n, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 't-tab';
      el.dataset.tab = i;
      const cv = document.createElement('canvas');
      el.appendChild(cv);
      this.tabsEl.appendChild(el);
      this.tabBtns.push({ el, cv, name: n, icon: icons[i] || 'item', key: '' });
    });
  }

  _renderTab(tb, sel) {
    const key = `${sel}`;
    if (key === tb.key) return;
    tb.key = key;
    const w = 13 + 2 + textWidth(tb.name, FONT5) + 6, h = 17;
    const p = new Pix(w, h + 2);
    p.rbox(0, 2, w, h, 2, [0, 0, 0, 110]);
    p.rbox(0, 0, w, h, 2, C.ink);
    p.rbox(1, 1, w - 2, h - 2, 1, sel ? C.green : C.st2);
    p.rect(2, 2, w - 4, h - 4, sel ? C.green2 : C.green0);
    p.hline(2, w - 3, 1, sel ? C.green5 : C.st4); p.hline(2, w - 3, h - 2, sel ? C.green1 : C.st1);
    glyph(tb.icon, sel ? C.green0 : C.green2, { pix: p, x: 3, y: 3 });
    text(p, tb.name, 16, 5, sel ? C.green0 : C.green, { shadow: sel ? null : C.ink });
    p.toCanvas(tb.cv);
    tb.cv.style.width = `${w * this.P}px`;
    tb.cv.style.height = `${(h + 2) * this.P}px`;
  }

  _renderCtx(label) {
    if (label === this._ctxLabel) return;
    this._ctxLabel = label;
    if (!label) { this.ctxCv.classList.remove('show'); return; }
    const tw = textWidth(label, FONT5);
    const w = tw + 12, h = 13;
    const p = new Pix(w, h + 4);
    p.rbox(1, 2, w - 1, h, 2, [0, 0, 0, 110]);
    p.rbox(0, 0, w - 1, h, 2, C.ink);
    p.rbox(1, 1, w - 3, h - 2, 1, C.hz2);
    p.rect(2, 2, w - 5, h - 4, C.ink2);
    p.hline(2, w - 4, 1, C.hz4);
    // pointer toward the USE button (down-right)
    p.poly([[w - 8, h - 1], [w - 3, h - 1], [w - 4, h + 3]], C.ink);
    p.poly([[w - 7, h - 2], [w - 4, h - 2], [w - 5, h + 1]], C.hz2);
    text(p, label, 6, 3, C.hz5, { shadow: C.hz0 });
    p.toCanvas(this.ctxCv);
    this.ctxCv.style.width = `${p.w * this.P}px`;
    this.ctxCv.style.height = `${p.h * this.P}px`;
    this.ctxCv.classList.add('show');
    this._placeCtx();
  }

  // ------------------------------------------------------------------ layout
  _insets() {
    if (!this._probe) {
      this._probe = document.createElement('div');
      this._probe.style.cssText = 'position:fixed;inset:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
      document.body.appendChild(this._probe);
    }
    const cs = getComputedStyle(this._probe);
    return { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
  }

  get pixelScale() { return this.P; }

  _layout() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const P = Math.min(vw, vh) >= 700 && Math.max(vw, vh) >= 1000 ? 3 : 2;
    const sizeChanged = P !== this.P;
    this.P = P;
    this.root.style.setProperty('--tp', `${P}px`);
    if (sizeChanged) { for (const b of Object.values(this.btn)) { b.key = ''; this._render(b); } for (const t of this.tabBtns) t.key = ''; this._ctxLabel = null; }
    this.ringCv.style.width = this.ringCv.style.height = `${56 * P}px`;
    this.knobCv.style.width = this.knobCv.style.height = `${26 * P}px`;
    const ins = this._insets();
    const m = 4 * P;
    const portrait = vh > vw;
    const L = {};
    const put = (id, cx, cy) => { L[id] = { cx, cy }; };
    // right cluster around the bottom-right corner
    const bx = vw - ins.r - m, by = vh - ins.b - m;
    put('jump', bx - 16 * P, by - 16 * P);
    put('grab', bx - 50 * P, by - 15 * P);
    put('use', bx - 15 * P, by - 50 * P);
    put('item', bx - 45 * P, by - 45 * P);
    put('duck', bx - 80 * P, by - 13 * P);
    put('rot', bx - 76 * P, by - 41 * P);
    this.cluster = { left: bx - 92 * P, top: by - 64 * P, right: bx, bottom: by };
    // system plates along the top right (two columns in portrait)
    const pw = PLATE_W * P, ph = (PLATE_H + 2) * P, gap = 2 * P;
    const needsRight = ins.l + 10 + 94 * P; // the needs patch hugs the top-left corner
    const rowW = SYS_ORDER.length * pw + (SYS_ORDER.length - 1) * gap;
    const cols = portrait || vw - ins.r - m - rowW < needsRight + m ? (portrait ? 2 : 3) : SYS_ORDER.length;
    SYS_ORDER.forEach((id, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      put(id, vw - ins.r - m - pw / 2 - c * (pw + gap), ins.t + m + ph / 2 + r * (ph + gap));
    });
    this.sysBottom = ins.t + m + Math.ceil(SYS_ORDER.length / cols) * (ph + gap);
    for (const [id, p] of Object.entries(L)) {
      const b = this.btn[id];
      b.el.style.left = `${Math.round(p.cx)}px`;
      b.el.style.top = `${Math.round(p.cy)}px`;
    }
    this.layoutPos = L;
    // stick rest position (bottom-left)
    this.stickRest = { x: ins.l + m + 28 * P, y: vh - ins.b - m - 28 * P };
    if (!this.stick) { this.stickEl.style.left = `${this.stickRest.x}px`; this.stickEl.style.top = `${this.stickRest.y}px`; }
    this.stickR = 22 * P;
    // inventory / watch tabs: bottom centre between the stick and the cluster, or above the cluster in portrait
    const inv = this.game.ui?.hotbar;
    const n = this.game.local?.inv?.slots?.length || 5;
    const hw = n * 28 * P + (n - 1) * P;
    let pos;
    if (portrait) pos = { cx: vw / 2, bottom: ins.b + m + 68 * P };
    else {
      const left = ins.l + m + 56 * P + m, right = this.cluster.left - m;
      if (right - left >= hw) pos = { cx: (left + right) / 2, bottom: ins.b + m };
      else if (right - (ins.l + m) >= hw) pos = { cx: Math.max(ins.l + m + hw / 2, right - hw / 2), bottom: ins.b + m };
      else pos = { cx: vw / 2, bottom: vh - this.cluster.top + m };
    }
    this.invPos = pos;
    inv?.place(pos);
    inv?.setScale(P);
    // the watch tab strip sits where the inventory is
    this.tabsEl.style.left = `${Math.round(pos.cx)}px`;
    this.tabsEl.style.bottom = `${Math.round(pos.bottom)}px`;
    this._placeCtx();
  }

  _placeCtx() {
    const u = this.layoutPos?.use;
    if (!u || !this.ctxCv.classList.contains('show')) return;
    const P = this.P, w = this.ctxCv.width * P, h = this.ctxCv.height * P;
    const r = 14 * P;
    let x = u.cx + r - w + 2 * P, y = u.cy - r - h - 1 * P;
    x = Math.max(8, x);
    this.ctxCv.style.left = `${Math.round(x)}px`;
    this.ctxCv.style.top = `${Math.round(y)}px`;
  }

  // ------------------------------------------------------------------ input
  _bind() {
    const r = this.root;
    const opts = { passive: false };
    r.addEventListener('pointerdown', (e) => this._down(e), opts);
    r.addEventListener('pointermove', (e) => this._move(e), opts);
    r.addEventListener('pointerup', (e) => this._up(e), opts);
    r.addEventListener('pointercancel', (e) => this._up(e), opts);
    r.addEventListener('contextmenu', (e) => e.preventDefault());
    // phones fire touch events too; stop them from scrolling / zooming the page
    r.addEventListener('touchstart', (e) => { input.lastTouch = performance.now(); e.preventDefault(); }, opts);
    r.addEventListener('touchmove', (e) => e.preventDefault(), opts);
    window.addEventListener('touchstart', () => { input.lastTouch = performance.now(); }, { passive: true, capture: true });
    window.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  _down(e) {
    e.preventDefault();
    input.lastTouch = performance.now();
    const t = e.target;
    try { this.root.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const tab = t.closest?.('.t-tab');
    if (tab) { this.game.watch?.setTab?.(+tab.dataset.tab); try { navigator.vibrate?.(6); } catch (err) { /* ignore */ } return; }
    const bEl = t.closest?.('.t-btn');
    if (bEl) {
      const b = this.btn[bEl.dataset.b];
      this.held.set(e.pointerId, b);
      this._press(b, true);
      return;
    }
    if (t.classList.contains('t-left') && !this.stick) {
      this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      this.stickEl.classList.add('on');
      this.stickEl.style.left = `${e.clientX}px`;
      this.stickEl.style.top = `${e.clientY}px`;
      this._stickTo(e.clientX, e.clientY);
      return;
    }
    if ((t.classList.contains('t-right') || t.classList.contains('t-left')) && !this.look) {
      this.look = { id: e.pointerId, x: e.clientX, y: e.clientY, t0: performance.now(), moved: 0 };
    }
  }

  _move(e) {
    if (this.stick && e.pointerId === this.stick.id) {
      e.preventDefault();
      this._stickTo(e.clientX, e.clientY);
      return;
    }
    if (this.look && e.pointerId === this.look.id) {
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      const last = evs && evs.length ? evs[evs.length - 1] : e;
      const dx = last.clientX - this.look.x, dy = last.clientY - this.look.y;
      this.look.x = last.clientX;
      this.look.y = last.clientY;
      this.look.moved += Math.abs(dx) + Math.abs(dy);
      // look() scales mouse units by 0.0022 * sensitivity
      const k = LOOK_PER_SCREEN / Math.max(320, window.innerWidth) / 0.0022;
      input.addLook(dx * k, dy * k);
    }
  }

  _up(e) {
    const b = this.held.get(e.pointerId);
    if (b) {
      this.held.delete(e.pointerId);
      this._press(b, false);
      return;
    }
    if (this.stick && e.pointerId === this.stick.id) {
      this._releaseStick();
      return;
    }
    if (this.look && e.pointerId === this.look.id) {
      // a quick tap without dragging interacts with whatever is under the crosshair
      if (this.look.moved < 12 && performance.now() - this.look.t0 < 260 && input.locked) this._tap('KeyE');
      this.look = null;
    }
  }

  _releaseStick() {
    this.stick = null;
    this.stickEl.classList.remove('on', 'sprint');
    if (this.stickRest) { this.stickEl.style.left = `${this.stickRest.x}px`; this.stickEl.style.top = `${this.stickRest.y}px`; }
    this.knobCv.style.transform = '';
    this._setSprint(false);
    input.moveAxis = null;
    for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ShiftLeft']) input.virtualUp(k);
  }

  _setSprint(on) {
    if (on === this.sprinting) return;
    this.sprinting = on;
    this.knobPix[on ? 1 : 0].toCanvas(this.knobCv);
    this.stickEl.classList.toggle('sprint', on);
  }

  _stickTo(x, y) {
    const R = this.stickR || 44;
    let dx = x - this.stick.ox, dy = y - this.stick.oy;
    const d = Math.hypot(dx, dy);
    if (d > R) {
      // drag the base along so the stick never "runs out" under the thumb
      const over = d - R;
      this.stick.ox += dx / d * over;
      this.stick.oy += dy / d * over;
      this.stickEl.style.left = `${this.stick.ox}px`;
      this.stickEl.style.top = `${this.stick.oy}px`;
      dx = x - this.stick.ox;
      dy = y - this.stick.oy;
    }
    // snap the knob to whole art pixels so it stays crisp
    const P = this.P;
    this.knobCv.style.transform = `translate(${Math.round(dx / P) * P}px, ${Math.round(dy / P) * P}px)`;
    const ax = dx / R, ay = dy / R;
    const m = Math.hypot(ax, ay);
    // soft dead zone and a slight response curve: fine control near the centre, full speed at the rim
    const dz = 0.12;
    const s = m < dz ? 0 : Math.min(1, (m - dz) / (1 - dz)) ** 1.25 / m;
    input.moveAxis = { x: ax * s, y: ay * s };
    // digital edges for menus that read W/A/S/D (terminals)
    const set = (code, on) => (on ? input.virtualDown(code) : input.virtualUp(code));
    set('KeyW', ay < -0.55); set('KeyS', ay > 0.55); set('KeyA', ax < -0.55); set('KeyD', ax > 0.55);
    const sprint = m > SPRINT_AT && ay < 0.2;
    set('ShiftLeft', sprint);
    this._setSprint(sprint);
  }

  _tap(code) {
    input.virtualDown(code);
    setTimeout(() => input.virtualUp(code), 70);
  }

  _press(b, down) {
    const d = b.def;
    b.down = down;
    this._render(b);
    b.el.classList.toggle('on', down);
    if (down) { try { navigator.vibrate?.(8); } catch (e) { /* ignore */ } }
    if (d.key) { if (down) input.virtualDown(d.key); else input.virtualUp(d.key); }
    if (d.mouse !== undefined) input.virtualMouse(d.mouse, down);
    if (!down) return;
    if (d.act === 'next') input.mouse.wheel += 1;
    if (d.act === 'duck') {
      this.crouchOn = !this.crouchOn;
      if (this.crouchOn) input.virtualDown('KeyC'); else input.virtualUp('KeyC');
    }
    if (d.act === 'menu') {
      if (this.game.local?.terminal || this.game.terminal?.active) this._tap('Escape');
      else input.exitLock();
    }
  }

  // ------------------------------------------------------------------
  update() {
    const g = this.game;
    const ui = g.ui;
    const l = g.local;
    const playing = g.state === 'playing' && !!g.world && !ui.menuOpen && !ui.customizing && input.locked;
    this.root.classList.toggle('show', playing);
    if (!playing) {
      if (this.stick || this.look || this.held.size) {
        this.look = null;
        for (const b of this.held.values()) { b.down = false; this._render(b); b.el.classList.remove('on'); }
        this.held.clear();
        if (this.stick) this._releaseStick();
      }
      if (this.crouchOn) { this.crouchOn = false; }
      return;
    }
    if (!this._laidOut || this._slotsN !== (l.inv?.slots?.length || 5)) { this._laidOut = true; this._slotsN = l.inv?.slots?.length || 5; this._layout(); }
    if (this.crouchOn && !input.keys.has('KeyC')) this.crouchOn = false; // released by a pause
    const term = !!(l.terminal || g.terminal?.active);
    const dead = !!l.dead;
    const grab = !!l.grab;
    const watch = !!l.watchOpen;
    const state = `${term}|${dead}|${grab}|${watch}`;
    if (state !== this.state) {
      this.state = state;
      const vis = (id, on) => this.btn[id].el.classList.toggle('gone', !on);
      const full = !term && !dead;
      for (const id of ['watch', 'light', 'next', 'drop', 'ask', 'jump', 'duck']) vis(id, full);
      vis('use', !dead);
      vis('grab', !term);
      vis('item', !term);
      vis('rot', full && grab);
      this.tabsEl.classList.toggle('show', full && watch);
      const set = (id, label, icon) => { const b = this.btn[id]; b.label = label; b.icon = icon; };
      set('grab', dead ? 'NEXT' : 'GRAB', dead ? 'arrowR' : 'fist');
      set('menu', term ? 'EXIT' : 'MENU', term ? 'back' : 'menu');
      set('use', term ? 'OK' : 'USE', term ? 'ok' : 'hand');
      this.btn.use.big = term;
      this.root.classList.toggle('term', term);
      this.root.classList.toggle('watching', watch);
    }
    // ITEM button shows what it will use: the held item's sprite, THROW while carrying, PREV when spectating
    const it = this.btn.item;
    const cur = l.inv?.current;
    if (dead) { it.label = 'PREV'; it.icon = 'arrowL'; it.iconPix = null; }
    else if (grab) { it.label = 'THROW'; it.icon = 'throw'; it.iconPix = null; }
    else if (cur) {
      const variant = cur.type === 'sample_jar' && cur.state?.kind ? 'full' : undefined;
      it.iconKey = `${cur.type}|${variant || ''}`;
      it.iconPix = ui.iconPix?.(cur.type, variant) || null;
      it.label = 'ITEM';
      it.icon = 'item';
    } else { it.label = 'ITEM'; it.icon = 'item'; it.iconPix = null; }
    // context: what USE would do right now
    let ctx = '';
    if (!term && !dead) {
      const p = l.focus?.prompt;
      if (p) ctx = p.replace(/^\[[^\]]*\]\s*/, '').split(/\s+/).slice(0, 3).join(' ').toUpperCase().slice(0, 16);
    }
    this._renderCtx(ctx);
    const use = this.btn.use;
    use.glow = !!ctx || term;
    use.el.classList.toggle('ready', use.glow);
    this.btn.light.lit = !!l.flashOn;
    this.btn.duck.lit = this.crouchOn;
    this.btn.watch.lit = watch;
    for (const b of Object.values(this.btn)) this._render(b);
    if (watch) this.tabBtns.forEach((tb, i) => this._renderTab(tb, i === (g.watch?.tabIdx ?? 0)));
    // the inventory gives way to the watch tabs while the watch is up
    ui.hotbarHiddenByTouch = watch && !term && !dead;
  }
}


