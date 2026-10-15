// On-screen controls for phones and tablets, styled like the knobs and bezels of a 1990s field terminal.
// Left thumb: a floating analog stick (push it all the way to sprint). Right thumb: drag anywhere to look,
// tap to interact, and a cluster of buttons for jump / use / grab / item / crouch. Everything feeds the
// regular input object (virtual keys, mouse buttons and look deltas), so gameplay code is unchanged.
import { input } from '../core/input.js';

const LOOK_PER_SCREEN = 3.6; // radians of yaw for a swipe across the full screen width
const STICK_R = 54;          // px of knob travel
const SPRINT_AT = 0.9;       // stick deflection that starts a sprint

export function wantsTouch() {
  const q = new URLSearchParams(location.search).get('touch');
  if (q === '1') return true;
  if (q === '0') return false;
  return !!(window.matchMedia?.('(hover: none) and (pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !window.matchMedia?.('(pointer: fine)').matches));
}

const BUTTONS = [
  // id, label, cluster, binding
  { id: 'menu', label: 'MENU', cls: 'sys', act: 'menu' },
  { id: 'watch', label: 'WATCH', cls: 'sys', key: 'Tab' },
  { id: 'light', label: 'LIGHT', cls: 'sys', key: 'KeyF', toggle: 'flash' },
  { id: 'next', label: 'NEXT', cls: 'sys', act: 'next' },
  { id: 'drop', label: 'DROP', cls: 'sys', key: 'KeyG' },
  { id: 'view', label: 'VIEW', cls: 'sys', key: 'KeyT' },
  { id: 'ask', label: 'HLTH', cls: 'sys', key: 'KeyX' },
  { id: 'jump', label: 'JUMP', cls: 'big', key: 'Space' },
  { id: 'use', label: 'USE', cls: 'mid', key: 'KeyE' },
  { id: 'grab', label: 'GRAB', cls: 'mid', mouse: 0 },
  { id: 'item', label: 'ITEM', cls: 'sm', mouse: 2 },
  { id: 'duck', label: 'DUCK', cls: 'sm', act: 'duck' },
  { id: 'rot', label: 'ROT', cls: 'sm', key: 'KeyR' },
  { id: 'tabl', label: '◀', cls: 'tab', key: 'KeyQ' },
  { id: 'tabr', label: '▶', cls: 'tab', key: 'KeyE' },
];

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.crouchOn = false;
    this.stick = null;   // { id, ox, oy }
    this.look = null;    // { id, x, y, t0, moved }
    this.held = new Map(); // pointerId -> button def
    this.state = '';
    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.innerHTML = `
      <div class="t-zone t-left"></div>
      <div class="t-zone t-right"></div>
      <div class="t-stick"><div class="t-ring"><i></i></div><div class="t-knob"></div></div>
      ${BUTTONS.map((b) => `<button class="t-btn t-${b.cls}" data-b="${b.id}" type="button"><span class="t-l">${b.label}</span><span class="t-s"></span></button>`).join('')}`;
    document.body.appendChild(this.root);
    this.stickEl = this.root.querySelector('.t-stick');
    this.knobEl = this.root.querySelector('.t-knob');
    this.btn = {};
    for (const b of BUTTONS) this.btn[b.id] = { def: b, el: this.root.querySelector(`[data-b="${b.id}"]`), sub: null };
    for (const b of Object.values(this.btn)) b.sub = b.el.querySelector('.t-s');
    this._bind();
  }

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
    const bEl = t.closest?.('.t-btn');
    try { this.root.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
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
      this.stick = null;
      this.stickEl.classList.remove('on');
      this.stickEl.style.left = '';
      this.stickEl.style.top = '';
      this.knobEl.style.transform = '';
      input.moveAxis = null;
      for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ShiftLeft']) input.virtualUp(k);
      return;
    }
    if (this.look && e.pointerId === this.look.id) {
      // a quick tap without dragging interacts with whatever is under the crosshair
      if (this.look.moved < 12 && performance.now() - this.look.t0 < 260 && input.locked) this._tap('KeyE');
      this.look = null;
    }
  }

  _stickTo(x, y) {
    let dx = x - this.stick.ox, dy = y - this.stick.oy;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) {
      // drag the base along so the stick never "runs out" under the thumb
      const over = d - STICK_R;
      this.stick.ox += dx / d * over;
      this.stick.oy += dy / d * over;
      this.stickEl.style.left = `${this.stick.ox}px`;
      this.stickEl.style.top = `${this.stick.oy}px`;
      dx = x - this.stick.ox;
      dy = y - this.stick.oy;
    }
    this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
    const ax = dx / STICK_R, ay = dy / STICK_R;
    const m = Math.hypot(ax, ay);
    // soft dead zone and a slight response curve: fine control near the centre, full speed at the rim
    const dz = 0.12;
    const s = m < dz ? 0 : Math.min(1, (m - dz) / (1 - dz)) ** 1.25 / m;
    input.moveAxis = { x: ax * s, y: ay * s };
    // digital edges for menus that read W/A/S/D (terminals)
    const set = (code, on) => (on ? input.virtualDown(code) : input.virtualUp(code));
    set('KeyW', ay < -0.55); set('KeyS', ay > 0.55); set('KeyA', ax < -0.55); set('KeyD', ax > 0.55);
    set('ShiftLeft', m > SPRINT_AT && ay < 0.2);
    this.stickEl.classList.toggle('sprint', m > SPRINT_AT && ay < 0.2);
  }

  _tap(code) {
    input.virtualDown(code);
    setTimeout(() => input.virtualUp(code), 70);
  }

  _press(b, down) {
    const d = b.def;
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
      if (this.stick || this.look || this.held.size) { this.stick = null; this.look = null; this.held.clear(); this.stickEl.classList.remove('on'); }
      if (this.crouchOn) { this.crouchOn = false; }
      return;
    }
    if (this.crouchOn && !input.keys.has('KeyC')) this.crouchOn = false; // released by a pause
    const term = !!(l.terminal || g.terminal?.active);
    const dead = !!l.dead;
    const grab = !!l.grab;
    const watch = !!l.watchOpen;
    const cam = watch && g.watch?.tab === 'camera';
    const state = `${term}|${dead}|${grab}|${watch}|${cam}`;
    if (state !== this.state) {
      this.state = state;
      const vis = (id, on) => this.btn[id].el.classList.toggle('gone', !on);
      const full = !term && !dead;
      for (const id of ['watch', 'light', 'next', 'drop', 'view', 'ask', 'jump', 'duck']) vis(id, full);
      vis('use', !dead);
      vis('grab', !term);
      vis('item', !term);
      vis('rot', full && grab);
      vis('tabl', full && watch);
      vis('tabr', full && watch);
      this.btn.grab.el.querySelector('.t-l').textContent = dead ? 'NEXT' : cam ? 'SNAP' : 'GRAB';
      this.btn.item.el.querySelector('.t-l').textContent = dead ? 'PREV' : grab ? 'THROW' : 'ITEM';
      this.btn.menu.el.querySelector('.t-l').textContent = term ? 'EXIT' : 'MENU';
      this.btn.use.el.querySelector('.t-l').textContent = term ? 'OK' : 'USE';
      this.root.classList.toggle('term', term);
    }
    // context: what USE would do right now, and lit indicators
    let ctx = '';
    if (!term && !dead) {
      const p = l.focus?.prompt;
      if (p) ctx = p.replace(/^\[[^\]]*\]\s*/, '').split(/\s+/).slice(0, 2).join(' ').toUpperCase().slice(0, 12);
    }
    if (ctx !== this._ctx) {
      this._ctx = ctx;
      this.btn.use.sub.textContent = ctx;
      this.btn.use.el.classList.toggle('ready', !!ctx || term);
    }
    this.btn.light.el.classList.toggle('lit', !!l.flashOn);
    this.btn.duck.el.classList.toggle('lit', this.crouchOn);
    this.btn.watch.el.classList.toggle('lit', watch);
    this.btn.view.el.classList.toggle('lit', !!l.thirdPerson);
    const cur = l.inv?.current;
    const nm = cur ? (g.ui.shortItem?.(cur) || '') : '';
    if (nm !== this._item) { this._item = nm; this.btn.item.sub.textContent = nm; }
  }
}
