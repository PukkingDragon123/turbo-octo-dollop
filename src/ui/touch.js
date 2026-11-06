// On-screen controls for phones and tablets: calm and minimal. Everything is drawn in one warm ivory ink with
// one soft shadow, thin hand-drawn rings (a pen circle that overlaps where it started) and simple line icons.
//   Left thumb   a floating stick that appears where the thumb lands (push to the rim to sprint)
//   Right thumb  drag anywhere to look, a quick tap uses what is under the dot ([E])
//   Corner       pause (top right) and the watch beside it
//   Cluster      HIT (LMB: punch / use the item in hand / multitool / throw while carrying), HAND (RMB: tap = use
//                or pick up, hold = grab and carry; the grab stays latched until HAND is tapped again), JUMP, CROUCH
//                (its ring breathes when the player sets crawlHint, near a vent or crawlspace)
//   Contextual   small rings on an outer arc that ease in only when they mean something: ROTATE while carrying,
//                DROP / SWAP with something in hand, LIGHT with a flashlight, the multitool and its MODE.
//                The list is data (CONTEXT below): each entry says when it shows and what it presses.
// Terminals: HIT becomes OK, HAND becomes BACK and the stick steps through the menu. Dead: HIT / HAND flip
// between teammates. Everything feeds the regular input object (virtual keys, mouse buttons, look deltas), so
// gameplay code is unchanged; the stick sprints through 'TouchSprint' (never the Shift far-throw).
import { input } from '../core/input.js';

// ---------------------------------------------------------------- icons (24 x 24, stroked in currentColor)
// drawn a little loose on purpose: nothing is a perfect geometric primitive
export const ICON = {
  pause: 'M9.4 7.1c.2 3.3.1 6.5-.1 9.8M14.7 7c-.1 3.4 0 6.6.1 9.9',
  watch: 'M17.2 12.1c0 3-2.3 5.3-5.2 5.3S6.7 15 6.8 12 9.2 6.8 12.1 6.8s5.1 2.4 5.1 5.3zM12 9.3v3.1l2.1 1.2M9.7 6.9l.4-2.8h3.9l.3 2.8M9.7 17.3l.4 2.7h3.9l.3-2.7',
  jump: 'M12.1 18.4c-.2-4.1 0-8.1-.1-12M7.7 10.5c1.5-1.5 2.9-2.9 4.4-4.3 1.5 1.4 3 2.8 4.4 4.4M7.1 20.1c3.3-.4 6.6-.3 9.9.1',
  crouch: 'M7.3 8.9c1.6 1.5 3.1 3 4.7 4.6 1.6-1.6 3.1-3.1 4.7-4.6M6.5 18.2c3.7-.3 7.4-.3 11 0',
  hand: 'M8.4 12.5V7.4c0-1 1.5-1.1 1.6 0v4M10 11V5.7c0-1.1 1.7-1.1 1.7 0v5.2M11.7 10.9V6.3c0-1 1.6-1 1.6.1v4.8M13.3 11.3V8.1c0-1 1.6-1 1.6.1v5.3c.1 3.6-2 6-4.9 6.1-2.4 0-3.7-1.2-4.8-3l-1.5-2.8c-.5-1 .8-1.8 1.5-.9l1.4 1.7',
  fist: 'M7.1 11.1V8.7c0-1.9 2.9-2 2.9 0V10M10 9.7V7.7c0-1.9 3-2 3 0V10M13 9.9V8.5c0-1.9 3-1.9 3 0v3.2M7.1 11.1c-.9 0-1.7.7-1.7 1.6v1.7c0 3.1 2.5 5.6 5.6 5.6h1.4c2.5 0 4.6-2.1 4.6-4.6v-4',
  swing: 'M5.6 18.7c3.6-3.9 7.5-7.9 11.4-11.8M14.3 4.7c1.9 1.7 3.5 3.4 5.2 5.3M8.1 16.5l-2.7-.4.5 2.8',
  eat: 'M16.8 9.7c-1.4-1.6-3.3-1.2-4.8-.5-1.6-.8-3.6-1-5 .6-1.8 2.1-1 5.9 1.2 8.2 1.2 1.3 2.5 1.2 3.8.6 1.3.6 2.6.7 3.8-.6.9-1 1.6-2.4 1.9-3.8-1.3-.2-2.2-1.4-2-2.7.1-.7.6-1.4 1.1-1.8zM12 8.9c-.1-1.6.4-3 1.8-4',
  drink: 'M7.3 7.5h9.4l-1.1 11c-.1.8-.7 1.3-1.5 1.3H9.9c-.8 0-1.4-.5-1.5-1.3zM7.7 11.4c2.9.6 5.8-.6 8.7 0',
  heal: 'M10.4 5.9h3.3v4.4h4.4v3.3h-4.4V18h-3.3v-4.4H6v-3.3h4.4z',
  item: 'M12 5.3l6.2 3.3v6.8L12 18.7l-6.2-3.3V8.6zM5.9 8.7L12 12l6.1-3.3M12 12v6.5',
  throw: 'M4.9 18.5c1.9-6.5 6.4-10.5 13-11.5M14.5 4.5l3.7 2.6-2.4 3.8',
  rotate: 'M18.5 12.4c-.2 3.6-3.1 6.3-6.7 6.2-3.6-.1-6.5-3.1-6.4-6.7.1-3.6 3.1-6.4 6.7-6.3 1.9 0 3.6.9 4.8 2.3M17.5 4.7l-.4 3.4-3.4-.2',
  drop: 'M12 4.9c.1 3.3 0 6.6 0 9.9M8.3 11.5l3.7 3.6 3.7-3.6M5.7 19.2c4.2-.3 8.5-.3 12.7 0',
  swap: 'M6.1 8.7c3.9-.2 7.9-.1 11.8 0M15.3 5.9l2.7 2.8-2.7 2.7M17.9 15.4c-3.9.2-7.9.1-11.8 0M8.7 12.7L6 15.4l2.7 2.8',
  light: 'M4.7 10.1h5.1l3.5-2.6v9.1L9.8 14H4.7zM16.6 8.3l2.5-1.6M16.8 12.1h2.9M16.6 15.8l2.5 1.6',
  tool: 'M14.8 5.5c-1.9-.6-3.9.3-4.7 2.1-.4 1-.4 2.1 0 3l-5.2 5.2c-.7.7-.7 1.7 0 2.3.6.6 1.6.6 2.2 0l5.2-5.2c2.6 1 5.3-.7 5.5-3.3l-2.6 1.2-2.3-1.1-.6-2.4z',
  link: 'M10.3 13.7l3.5-3.5M8.7 11.4l-1.9 1.9c-1.3 1.3-1.3 3.2 0 4.5 1.3 1.3 3.2 1.3 4.5 0l1.9-1.9M15.3 12.6l1.9-1.9c1.3-1.3 1.3-3.2 0-4.5-1.3-1.3-3.2-1.3-4.5 0l-1.9 1.9',
  scrap: 'M6.3 7.1l4.3 4.2M13.4 12.7l4.3 4.3M17.7 7.1l-4.3 4.3M10.6 12.7l-4.3 4.3',
  next: 'M9.5 6.1c2.1 2 4 4 6 5.9-2 2-3.9 4-6 6',
  prev: 'M14.5 6.1c-2.1 2-4 4-6 5.9 2 2 3.9 4 6 6',
  ok: 'M5.7 12.6c1.5 1.5 2.9 3 4.3 4.5 2.8-3.4 5.6-6.6 8.5-9.7',
  back: 'M9.2 7.7L5.7 11l3.5 3.4M6.1 11.1c3.8-.1 7.6-.2 10 .5 2.3.7 2.6 3.8.6 5.1-.9.6-2 .7-3 .7',
};
const icoSvg = (name) => `<path d="${ICON[name] || ICON.item}"/>`;

// a pen circle in the 48 x 48 button box: a slightly uneven radius and an end that overlaps its start
function ringPath(seed, r = 21.2) {
  let s = (seed * 9301 + 49297) % 233280 || 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const p1 = rnd() * 6.28, p2 = rnd() * 6.28, a0 = rnd() * 6.28;
  const N = 36, sweep = Math.PI * 2 + 0.38;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const a = a0 + (sweep * i) / N;
    const rr = r + 0.42 * Math.sin(2 * a + p1) + 0.28 * Math.sin(3 * a + p2) + (i / N) * 0.75;
    pts.push([24 + Math.cos(a) * rr, 24 + Math.sin(a) * rr]);
  }
  let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += `Q${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`;
  }
  return d;
}
const btnSvg = (seed, icon) => `<svg viewBox="0 0 48 48" aria-hidden="true"><path class="ring" d="${ringPath(seed)}"/><g class="ico" transform="translate(12 12)">${icoSvg(icon)}</g></svg>`;

const LOOK_PER_SCREEN = 3.6; // radians of yaw for a swipe across the full screen width
const SPRINT_AT = 0.9;       // stick deflection that starts a sprint
const TAP_MS = 260;          // a look touch shorter than this (and nearly still) is a tap = [E]

export function wantsTouch() {
  const q = new URLSearchParams(location.search).get('touch');
  if (q === '1') return true;
  if (q === '0') return false;
  return !!(window.matchMedia?.('(hover: none) and (pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !window.matchMedia?.('(pointer: fine)').matches));
}

// the always-there buttons: d = diameter in layout units (1 unit = 1 px on a 390 px phone side)
const MAIN = [
  { id: 'pause', icon: 'pause', d: 40, label: 'Pause', act: 'pause' },
  { id: 'watch', icon: 'watch', d: 40, label: 'Watch', key: 'Tab', toggle: (l) => !!l.watchOpen },
  { id: 'hit', icon: 'fist', d: 74, label: 'Hit', mouse: 0 },
  { id: 'hand', icon: 'hand', d: 60, label: 'Use / grab', mouse: 2 },
  { id: 'jump', icon: 'jump', d: 60, label: 'Jump', key: 'Space' },
  { id: 'crouch', icon: 'crouch', d: 46, label: 'Crouch', act: 'crouch' },
];

// contextual buttons, in priority order (they take the outer arc's slots in this order). when(l, game) says
// whether the button is wanted right now; on(l) lights it as a toggle. Change the list, not the drawing code.
const handsOf = (l) => l.hands?.layout || null; // cached by the player every frame
export const CONTEXT = [
  { id: 'rotate', icon: 'rotate', label: 'Rotate', act: 'rotate', when: (l) => !!l.grab, on: (l, t) => t.rotateOn },
  { id: 'drop', icon: 'drop', label: 'Drop (hold: all)', key: 'KeyG', when: (l) => !l.grab && (handsOf(l)?.n || 0) > 0 },
  { id: 'swap', icon: 'swap', label: 'Swap hands', act: 'swap', when: (l) => !l.grab && (handsOf(l)?.n || 0) > 0 },
  { id: 'light', icon: 'light', label: 'Flashlight', key: 'KeyF', when: (l) => (l.inv?.find?.('flashlight') ?? -1) >= 0, on: (l) => !!l.flashOn },
  { id: 'tool', icon: 'tool', label: 'Multitool', key: 'KeyQ', when: (l) => !!l.tool && !l.grab && (l.toolOut || ((handsOf(l)?.n || 0) < 2 && !handsOf(l)?.armful)), on: (l) => !!l.toolOut },
  { id: 'mode', icon: 'link', label: 'Tool mode', act: 'mode', when: (l) => !l.grab && !!(l.toolOut || l._mtItem?.()) },
];
const ARC = [194, 214, 234, 254, 274]; // outer slots (degrees around HIT: 180 = left, 270 = up)

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.crouchOn = false;
    this.rotateOn = false;
    this.grabLatched = false;
    this.stick = null;     // { id, ox, oy }
    this.look = null;      // { id, x, y, t0, moved }
    this.held = new Map(); // pointerId -> button
    this.usedStick = false;
    this.u = 1;
    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.innerHTML = `
      <div class="t-zone t-left"></div>
      <div class="t-zone t-right"></div>
      <div class="t-stick"><svg class="t-ring" viewBox="0 0 48 48" aria-hidden="true"><path d="${ringPath(91, 22)}"/></svg><div class="t-knob"></div></div>
      <div class="t-apps"><span class="t-appname"></span></div>`;
    document.body.appendChild(this.root);
    this.stickEl = this.root.querySelector('.t-stick');
    this.ringEl = this.root.querySelector('.t-ring');
    this.knobEl = this.root.querySelector('.t-knob');
    this.appsEl = this.root.querySelector('.t-apps');
    this.appName = this.root.querySelector('.t-appname');
    this.btn = {};
    let seed = 3;
    const make = (def, ctx) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `tb${ctx ? ' ctx' : ''}`;
      el.dataset.b = def.id;
      el.setAttribute('aria-label', def.label || def.id);
      el.innerHTML = btnSvg(seed += 7, def.icon);
      this.root.appendChild(el);
      const b = { def, el, ico: el.querySelector('.ico'), icon: def.icon, show: false, lit: false, hint: false, down: false, ctx };
      this.btn[def.id] = b;
      return b;
    };
    for (const d of MAIN) make(d, false);
    for (const d of CONTEXT) make({ ...d, d: 44 }, true);
    // watch app switcher: two small rings either side of the app's name
    const prev = make({ id: 'appPrev', icon: 'prev', d: 40, label: 'Previous app', act: 'appPrev' }, false);
    const next = make({ id: 'appNext', icon: 'next', d: 40, label: 'Next app', act: 'appNext' }, false);
    this.appsEl.prepend(prev.el);
    this.appsEl.append(next.el);
    prev.inline = next.inline = true;
    this._bind();
    this._layout();
    window.addEventListener('resize', () => this._layout());
    window.visualViewport?.addEventListener('resize', () => this._layout());
    window.addEventListener('orientationchange', () => setTimeout(() => this._layout(), 250));
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

  // kept for callers that size things to the touch layout (1 on a phone, up to 1.45 on a tablet)
  get pixelScale() { return this.u; }

  _place(b, x, y) {
    const d = Math.round(b.def.d * this.u);
    b.el.style.setProperty('--d', `${d}px`);
    if (b.inline) return;
    b.el.style.left = `${Math.round(x)}px`;
    b.el.style.top = `${Math.round(y)}px`;
  }

  _layout() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const u = (this.u = Math.max(0.88, Math.min(1.45, Math.min(vw, vh) / 390)));
    const ins = this._insets();
    this.portrait = vh > vw;
    const m = 14 * u; // margin from the safe edge
    // the cluster hugs the bottom-right corner
    const hx = vw - ins.r - m - 37 * u, hy = vh - ins.b - m - 37 * u;
    this.hitPos = { x: hx, y: hy };
    const B = this.btn;
    this._place(B.hit, hx, hy);
    this._place(B.hand, hx - 80 * u, hy + 5 * u);
    this._place(B.jump, hx + 4 * u, hy - 80 * u);
    this._place(B.crouch, hx - 70 * u, hy - 70 * u);
    // pause in the top-right corner, the watch beside it
    const ty = ins.t + m + 20 * u;
    this._place(B.pause, vw - ins.r - m - 20 * u, ty);
    this._place(B.watch, vw - ins.r - m - 20 * u - 52 * u, ty);
    this.topBottom = ty + 20 * u; // px under the corner buttons
    // contextual slots on the outer arc around HIT
    const R = 158 * u;
    this.slots = ARC.map((a) => ({ x: hx + Math.cos((a * Math.PI) / 180) * R, y: hy + Math.sin((a * Math.PI) / 180) * R }));
    for (const b of Object.values(B)) if (b.ctx) { b.slot = -1; this._place(b, this.slots[0].x, this.slots[0].y); }
    this._assignSlots(true);
    for (const id of ['appPrev', 'appNext']) this._place(B[id], 0, 0);
    // stick: radius of travel, ghost ring at rest until the first touch
    this.stickR = 46 * u;
    this.root.style.setProperty('--sr', `${Math.round(52 * u)}px`);
    this.root.style.setProperty('--kr', `${Math.round(20 * u)}px`);
    this.root.style.setProperty('--u', `${u}`);
    this.stickRest = { x: ins.l + m + 62 * u, y: vh - ins.b - m - 62 * u };
    if (!this.stick) this._stickAt(this.stickRest.x, this.stickRest.y);
    this._placeApps();
  }

  _placeApps() {
    const vw = window.innerWidth, vh = window.innerHeight, u = this.u, ins = this._insets();
    let y = vh - ins.b - 30 * u;
    if (this.portrait) {
      // under the portrait watch panel, clear of the cluster
      const wp = this.game.ui?.watchPanelEl;
      const r = wp && wp.classList.contains('show') ? wp.getBoundingClientRect() : null;
      y = r && r.height ? r.bottom + 34 * u : vh * 0.6;
    }
    const x = this.portrait ? vw / 2 : (ins.l + 150 * u + (this.hitPos.x - 130 * u)) / 2;
    this.appsEl.style.left = `${Math.round(x)}px`;
    this.appsEl.style.top = `${Math.round(y)}px`;
  }

  // give the wanted contextual buttons the outer slots in priority order; a button keeps its slot while it stays
  _assignSlots(force = false) {
    const want = CONTEXT.filter((c) => this.btn[c.id].show).map((c) => this.btn[c.id]);
    const key = want.map((b) => b.def.id).join(',');
    if (!force && key === this._slotKey) return;
    this._slotKey = key;
    // a hidden button gives its slot up and will fade in wherever its next slot is
    for (const c of CONTEXT) if (!this.btn[c.id].show) this.btn[c.id].slot = -1;
    want.forEach((b, i) => {
      const s = this.slots[Math.min(i, this.slots.length - 1)];
      if (b.slot === i && !force) return;
      // a button that is fading in starts at its slot (no slide across the screen); a visible one glides over
      b.el.classList.toggle('glide', b.slot >= 0 && !force);
      b.slot = i;
      b.el.style.left = `${Math.round(s.x)}px`;
      b.el.style.top = `${Math.round(s.y)}px`;
    });
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
    const bEl = t.closest?.('.tb');
    if (bEl && bEl.classList.contains('show')) {
      const b = this.btn[bEl.dataset.b];
      this.held.set(e.pointerId, b);
      this._press(b, true);
      return;
    }
    const left = t.classList.contains('t-left') || (bEl && e.clientX < window.innerWidth * 0.45);
    if (left && !this.stick) {
      this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      this.usedStick = true;
      this.stickEl.classList.remove('ghost');
      this.stickEl.classList.add('on');
      this._stickAt(e.clientX, e.clientY);
      this._stickTo(e.clientX, e.clientY);
      return;
    }
    if (!this.look) this.look = { id: e.pointerId, x: e.clientX, y: e.clientY, t0: performance.now(), moved: 0 };
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
    if (this.stick && e.pointerId === this.stick.id) { this._releaseStick(); return; }
    if (this.look && e.pointerId === this.look.id) {
      // a quick tap without dragging interacts with whatever is under the crosshair
      if (this.look.moved < 12 && performance.now() - this.look.t0 < TAP_MS && input.locked) this._tap('KeyE');
      this.look = null;
    }
  }

  _stickAt(x, y) {
    this.stickEl.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  _releaseStick() {
    this.stick = null;
    this.stickEl.classList.remove('on', 'sprint');
    this.knobEl.style.transform = '';
    this._sprint = false;
    input.moveAxis = null;
    for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'TouchSprint']) input.virtualUp(k);
    // the ring fades where it was, then hides (it only ever shows under the thumb)
  }

  _stickTo(x, y) {
    const R = this.stickR || 46;
    let dx = x - this.stick.ox, dy = y - this.stick.oy;
    const d = Math.hypot(dx, dy);
    if (d > R) {
      // drag the base along so the stick never "runs out" under the thumb
      const over = d - R;
      this.stick.ox += (dx / d) * over;
      this.stick.oy += (dy / d) * over;
      this._stickAt(this.stick.ox, this.stick.oy);
      dx = x - this.stick.ox;
      dy = y - this.stick.oy;
    }
    this.knobEl.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    const ax = dx / R, ay = dy / R;
    const mag = Math.hypot(ax, ay);
    // soft dead zone and a slight response curve: fine control near the centre, full speed at the rim
    const dz = 0.12;
    const s = mag < dz ? 0 : Math.min(1, (mag - dz) / (1 - dz)) ** 1.25 / mag;
    input.moveAxis = { x: ax * s, y: ay * s };
    // digital edges for menus that read W/A/S/D (terminals)
    const set = (code, on) => (on ? input.virtualDown(code) : input.virtualUp(code));
    set('KeyW', ay < -0.55); set('KeyS', ay > 0.55); set('KeyA', ax < -0.55); set('KeyD', ax > 0.55);
    const sprint = mag > SPRINT_AT && ay < 0.2;
    set('TouchSprint', sprint);
    if (sprint !== this._sprint) { this._sprint = sprint; this.stickEl.classList.toggle('sprint', sprint); }
  }

  _tap(code) {
    input.virtualDown(code);
    setTimeout(() => input.virtualUp(code), 70);
  }

  _key(code, down) { if (down) input.virtualDown(code); else input.virtualUp(code); }

  _press(b, down) {
    const d = b.def;
    const g = this.game, l = g.local;
    b.down = down;
    b.el.classList.toggle('on', down);
    if (down) { try { navigator.vibrate?.(7); } catch (e) { /* ignore */ } }
    // what this press does is decided when it starts, so a button that changes meaning mid-press releases cleanly
    if (down) b.via = this._route(b);
    const v = b.via || {};
    if (v.key) this._key(v.key, down);
    if (v.mouse !== undefined) {
      if (v.latch) {
        // HAND: hold to grab; once something is caught the grab stays latched when the thumb lifts
        if (down) {
          if (this.grabLatched) { this.grabLatched = false; this._holdUntilRelease = true; input.virtualMouse(2, false); } else input.virtualMouse(2, true);
        } else if (this._holdUntilRelease) this._holdUntilRelease = false;
        else if (l?.grab) this.grabLatched = true;
        else input.virtualMouse(2, false);
      } else input.virtualMouse(v.mouse, down);
    }
    if (!down) return;
    switch (v.act) {
      case 'pause':
        if (l?.terminal || g.terminal?.active) this._tap('Escape');
        else input.exitLock();
        break;
      case 'crouch':
        this.crouchOn = !this.crouchOn;
        this._key('KeyC', this.crouchOn);
        break;
      case 'rotate':
        this.rotateOn = !this.rotateOn;
        this._key('KeyR', this.rotateOn);
        break;
      case 'swap': input.mouse.wheel += 1; break;
      case 'mode': l?.toggleMultitoolMode?.(); break;
      case 'appPrev': g.watch?.setTab?.((g.watch?.tabIdx ?? 0) - 1); break;
      case 'appNext': g.watch?.setTab?.((g.watch?.tabIdx ?? 0) + 1); break;
      default: break;
    }
  }

  // what a press of b means in the current state: { key | mouse (+latch) | act }
  _route(b) {
    const d = b.def, l = this.game.local, st = this.mode;
    if (st === 'term') {
      if (d.id === 'hit') return { key: 'KeyE' };      // OK
      if (d.id === 'hand') return { act: 'pause' };    // BACK
    }
    if (st === 'dead') {
      if (d.id === 'hit') return { mouse: 0 };          // next teammate
      if (d.id === 'hand') return { mouse: 2 };         // previous teammate
    }
    // carrying something that is not a camp part: HIT is the far throw
    if (d.id === 'hit' && l?.grab && !l._mtOwnsLmb?.()) return { key: 'TouchThrow' };
    if (d.id === 'hand') return { mouse: 2, latch: true };
    if (d.key) return { key: d.key };
    if (d.mouse !== undefined) return { mouse: d.mouse };
    return { act: d.act };
  }

  // ------------------------------------------------------------------ per frame
  _set(b, show, icon, lit, hint) {
    if (show !== b.show) { b.show = show; b.el.classList.toggle('show', show); if (!show && b.down) this._forceUp(b); }
    if (icon && icon !== b.icon) { b.icon = icon; b.ico.innerHTML = icoSvg(icon); }
    lit = !!lit; if (lit !== b.lit) { b.lit = lit; b.el.classList.toggle('lit', lit); }
    hint = !!hint; if (hint !== b.hint) { b.hint = hint; b.el.classList.toggle('hint', hint); }
  }

  _forceUp(b) {
    for (const [id, hb] of this.held) if (hb === b) { this.held.delete(id); this._press(b, false); }
  }

  _releaseAll() {
    this.look = null;
    for (const b of this.held.values()) { b.down = false; b.el.classList.remove('on'); }
    this.held.clear();
    if (this.stick) this._releaseStick();
    if (this.grabLatched) input.virtualMouse(2, false);
    if (this.crouchOn) input.virtualUp('KeyC');
    if (this.rotateOn) input.virtualUp('KeyR');
    this.crouchOn = false; this.rotateOn = false; this.grabLatched = false; this._holdUntilRelease = false;
  }

  update() {
    const g = this.game;
    const ui = g.ui;
    const l = g.local;
    const playing = g.state === 'playing' && !!g.world && !ui.menuOpen && !ui.customizing && input.locked;
    this.root.classList.toggle('show', playing);
    if (!playing) {
      if (this.stick || this.look || this.held.size || this.crouchOn || this.grabLatched) this._releaseAll();
      return;
    }
    if (!this._laidOut) { this._laidOut = true; this._layout(); }
    // keys released elsewhere (a pause clears every virtual key)
    if (this.crouchOn && !input.keys.has('KeyC')) this.crouchOn = false;
    if (this.rotateOn && (!input.keys.has('KeyR') || !l.grab)) { this.rotateOn = false; input.virtualUp('KeyR'); }
    if (this.grabLatched && (!l.grab || !(input.mouse.buttons & 4))) { this.grabLatched = false; if (!this.btn.hand.down) input.virtualMouse(2, false); }
    const term = !!(l.terminal || g.terminal?.active);
    const dead = !!l.dead;
    this.mode = term ? 'term' : dead ? 'dead' : 'play';
    const play = this.mode === 'play';
    const watch = !!l.watchOpen;
    this.root.classList.toggle('term', term);
    const B = this.btn;
    // HIT shows what LMB does right now
    let hit = 'fist';
    if (term) hit = 'ok';
    else if (dead) hit = 'next';
    else if (l.grab) hit = l._mtOwnsLmb?.() ? 'link' : 'throw';
    else {
      const H = handsOf(l);
      const use = l._handItemUse?.();
      if (H?.armful) hit = 'drop';
      else if (l.toolOut || use === 'multitool') hit = 'tool';
      else if (use === 'swing') hit = 'swing';
      else if (use === 'eat' || use === 'drink' || use === 'heal') hit = use;
      else if (use) hit = 'item';
    }
    const focus = play && !watch && !!l.focus?.prompt;
    this._set(B.hit, true, hit, false, false);
    this._set(B.hand, !watch || term || dead, term ? 'back' : dead ? 'prev' : l.grab ? 'fist' : 'hand', play && (this.grabLatched || !!l.grab), focus);
    this._set(B.jump, play, null);
    // a level can set player.crawlHint near a vent or crawlspace: the crouch ring then breathes softly
    this._set(B.crouch, play, null, this.crouchOn || l.crouching, !!l.crawlHint && !l.crouching);
    this._set(B.pause, !term, null);
    this._set(B.watch, play, null, watch);
    for (const c of CONTEXT) {
      let want = false;
      try { want = play && !watch && !!c.when(l, g); } catch (e) { want = false; }
      const b = B[c.id];
      const icon = c.id === 'mode' ? (l.mtMode === 'dismantle' ? 'scrap' : 'link') : null;
      this._set(b, want, icon, c.on ? c.on(l, this) : false);
    }
    this._assignSlots();
    // the watch's app switcher (names come from the watch, so apps can change without touching this)
    const tabs = (play && watch && g.watch?.tabs) || [];
    const apps = tabs.length > 1;
    this.appsEl.classList.toggle('show', apps);
    this._set(B.appPrev, apps, null);
    this._set(B.appNext, apps, null);
    if (apps) {
      const name = String(tabs[g.watch.tabIdx ?? 0] || '');
      const nice = name.charAt(0) + name.slice(1).toLowerCase();
      if (this.appName.textContent !== nice) this.appName.textContent = nice;
      if (this.portrait) this._placeApps();
    }
    // the ghost ring at rest only until the stick has been found once
    this.stickEl.classList.toggle('ghost', !this.usedStick && !this.stick && play);
  }
}
