// On-screen controls for phones and tablets: soft smoked-glass discs with thin ivory / gold rings, simple
// line icons and small labels in the 'hint' font slot; a gentle press dip, gold rims for toggles.
// Left thumb: a floating analog stick (push it all the way to sprint). Right thumb: drag anywhere to look,
// tap to interact, and a cluster of buttons: JUMP, USE (E), GRAB (RMB: tap = use, hold = grab and pull),
// PUNCH (LMB: punch / use the right-hand item / the drawn multitool; THROW while carrying), TOOL ([Q]),
// DUCK, ROT / MODE. Everything feeds the regular input object (virtual keys, mouse buttons and look deltas),
// so gameplay code is unchanged. The stick sprints through 'TouchSprint' (so it never triggers the
// Shift far-throw). The layout is computed in pixels for the current viewport + safe area so nothing
// overlaps, from 360 px portrait phones to landscape tablets.
import { input } from '../core/input.js';
import { FONT, weightOf } from './fonts.js';

// line icons (24 x 24, stroked in currentColor)
const ICON = {
  menu: 'M5 7h14M5 12h14M5 17h14',
  watch: 'M9 3h6M9 21h6M12 9v3.2l2.2 1.4M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0z',
  light: 'M3.5 9.5h6l4-3v11l-4-3h-6zM17 8l3-2M17 12h4M17 16l3 2',
  next: 'M9 5.5l6.5 6.5L9 18.5',
  back: 'M15 5.5L8.5 12l6.5 6.5',
  drop: 'M12 4v10.5M7.5 10l4.5 4.5 4.5-4.5M5 19.5h14',
  bot: 'M12 19.5s-7-4.3-7-9.6A3.9 3.9 0 0 1 12 7.6a3.9 3.9 0 0 1 7 2.3c0 5.3-7 9.6-7 9.6z',
  jump: 'M12 19.5V6M6.5 11.5L12 6l5.5 5.5M7 20h10',
  hand: 'M8.5 12.5V6.8a1.4 1.4 0 0 1 2.8 0V11M11.3 10.6V5.4a1.4 1.4 0 0 1 2.8 0v5.2M14.1 10.8V7a1.4 1.4 0 0 1 2.8 0v6.5c0 3.8-2.4 6-5.4 6-2.4 0-3.9-1.2-5-3.2l-1.6-3a1.4 1.4 0 0 1 2.4-1.4l1.2 1.7',
  grab: 'M4.5 8.5h15M7 8.5v5.5a5 5 0 0 0 10 0V8.5M10 12v2.5M14 12v2.5',
  fist: 'M7 11V8.6a1.5 1.5 0 0 1 3 0V10M10 9.6V7.6a1.5 1.5 0 0 1 3 0V10M13 9.8V8.4a1.5 1.5 0 0 1 3 0v3.3M7 11a1.6 1.6 0 0 0-1.6 1.6v1.8A5.6 5.6 0 0 0 11 20h1.4a4.6 4.6 0 0 0 4.6-4.6v-4',
  throw: 'M4.5 18.5C6.5 11 11.5 7 18.5 6.5M15 3.5l3.5 3-3 3.5',
  gear: 'M14.6 5.2a4 4 0 0 0-5.1 5.1L4 15.8 8.2 20l5.5-5.5a4 4 0 0 0 5.1-5.1l-2.6 2.6-2.6-.8-.8-2.6z',
  crouch: 'M6.5 9l5.5 5.5L17.5 9M5 19.5h14',
  rotate: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.7h-4.7',
  swap: 'M6 8h12l-3-3M18 16H6l3 3',
  ok: 'M5 12.5l4.5 4.5L19 7.5',
  item: 'M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7zM12 12l7.5-4.3M12 12v8.5M12 12L4.5 7.7',
  swing: 'M5 19L16.5 7.5M14 4.5l5.5 5.5',
  pulse: 'M3 12h4l2-5 4 10 2-5h6',
  map: 'M9 4.5L3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2zM9 4.5v13M15 6.5v13',
  task: 'M9.5 6.5h10M9.5 12h10M9.5 17.5h10M4 6.5l1 1 2-2M4 12l1 1 2-2M4 17.5l1 1 2-2',
};
const svg = (name) => `<svg class="t-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[name] || ICON.item}"/></svg>`;

const CSS = `
#touch.glass { --ink: #f3e7c8; --gold: 236,206,140; font-family: ${FONT.hint}; }
#touch.glass .t-btn { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px;
  width: var(--w); height: var(--h); border-radius: 50%; color: var(--ink); filter: none;
  background: radial-gradient(120% 100% at 50% 22%, rgba(255,247,226,0.17), rgba(255,247,226,0.04) 45%, rgba(14,11,8,0.34) 100%);
  box-shadow: inset 0 0 0 1px rgba(var(--gold),0.5), inset 0 1px 1px rgba(255,255,255,0.16), 0 3px 12px rgba(0,0,0,0.32);
  -webkit-backdrop-filter: blur(5px) saturate(1.2); backdrop-filter: blur(5px) saturate(1.2);
  transition: transform 0.16s cubic-bezier(0.3, 1.5, 0.5, 1), box-shadow 0.18s, background 0.18s, color 0.18s, opacity 0.2s; }
#touch.glass .t-btn > * { pointer-events: none; }
#touch.glass .t-btn .t-ico { width: 44%; height: 44%; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round;
  filter: drop-shadow(0 1px 1.5px rgba(0,0,0,0.55)); }
#touch.glass .t-btn .t-lbl { font: ${weightOf('hint')} var(--fs) ${FONT.hint}; letter-spacing: 0.06em; line-height: 1; opacity: 0.9;
  text-shadow: 0 1px 3px rgba(0,0,0,0.7); white-space: nowrap; }
#touch.glass .t-btn.on { transform: translate(-50%, -50%) scale(0.9); transition-duration: 0.06s;
  background: radial-gradient(120% 100% at 50% 30%, rgba(var(--gold),0.38), rgba(var(--gold),0.1) 55%, rgba(14,11,8,0.4));
  box-shadow: inset 0 0 0 1.5px rgba(var(--gold),0.95), 0 0 16px rgba(var(--gold),0.35); }
#touch.glass .t-btn.lit { color: #ffe0a0; box-shadow: inset 0 0 0 1.5px rgba(var(--gold),0.95), inset 0 0 12px rgba(var(--gold),0.22), 0 0 12px rgba(var(--gold),0.28); }
#touch.glass .t-btn.ready { animation: tg-ready 1.8s ease-in-out infinite; }
#touch.glass .t-btn.ready canvas { animation: none; }
@keyframes tg-ready { 50% { box-shadow: inset 0 0 0 1.5px rgba(var(--gold),1), inset 0 0 10px rgba(var(--gold),0.25), 0 0 20px rgba(var(--gold),0.5); } }
#touch.glass .t-btn.big .t-ico { width: 40%; height: 40%; }
#touch.glass .t-sys { border-radius: calc(var(--h) * 0.32); opacity: 0.9; }
#touch.glass .t-sys .t-ico { width: auto; height: 46%; }
#touch.glass .t-stick { opacity: 0.5; transition: opacity 0.2s; }
#touch.glass .t-stick.on { opacity: 1; }
#touch.glass .t-ring { border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(var(--gold),0.55), inset 0 0 0 calc(var(--tp) * 7) rgba(255,247,226,0.035), 0 0 18px rgba(0,0,0,0.25);
  background: radial-gradient(closest-side, rgba(14,11,8,0.0) 60%, rgba(14,11,8,0.22)); }
#touch.glass .t-ring::after { content: ''; position: absolute; inset: 34%; border-radius: 50%; border: 1px solid rgba(var(--gold),0.22); }
#touch.glass .t-knob { border-radius: 50%; transition: box-shadow 0.2s, background 0.2s;
  background: radial-gradient(110% 100% at 50% 25%, rgba(255,247,226,0.45), rgba(255,247,226,0.12) 50%, rgba(14,11,8,0.35));
  box-shadow: inset 0 0 0 1px rgba(var(--gold),0.8), 0 3px 10px rgba(0,0,0,0.4); }
#touch.glass .t-stick.sprint .t-knob { background: radial-gradient(110% 100% at 50% 25%, rgba(255,228,160,0.7), rgba(var(--gold),0.3) 55%, rgba(14,11,8,0.3));
  box-shadow: inset 0 0 0 1.5px rgba(var(--gold),1), 0 0 18px rgba(var(--gold),0.55); }
#touch.glass .t-ctx { padding: 0.32em 0.85em 0.38em; border-radius: 0.8em; color: var(--ink); white-space: nowrap;
  font: ${weightOf('hint')} var(--cfs, 15px) ${FONT.hint}; letter-spacing: 0.03em; text-shadow: 0 1px 3px rgba(0,0,0,0.7);
  background: rgba(14,11,8,0.5); box-shadow: inset 0 0 0 1px rgba(var(--gold),0.5); -webkit-backdrop-filter: blur(5px); backdrop-filter: blur(5px); }
#touch.glass .t-ctx::after { content: ''; position: absolute; right: 1.1em; bottom: -5px; width: 9px; height: 9px; transform: rotate(45deg);
  background: rgba(14,11,8,0.5); box-shadow: inset -1px -1px 0 rgba(var(--gold),0.5); }
#touch.glass .t-ctx.show { animation: tg-ctx 0.22s cubic-bezier(0.3, 1.4, 0.5, 1); }
@keyframes tg-ctx { from { transform: translateY(6px); opacity: 0; } }
#touch.glass .t-tab { display: flex; align-items: center; gap: 0.35em; padding: 0.3em 0.85em; border-radius: 1em; color: var(--ink);
  font: ${weightOf('hint')} var(--cfs, 15px) ${FONT.hint}; letter-spacing: 0.05em; background: rgba(14,11,8,0.42); box-shadow: inset 0 0 0 1px rgba(var(--gold),0.4);
  -webkit-backdrop-filter: blur(5px); backdrop-filter: blur(5px); transition: background 0.18s, box-shadow 0.18s; }
#touch.glass .t-tab > * { pointer-events: none; }
#touch.glass .t-tab .t-ico { width: 1.15em; height: 1.15em; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
#touch.glass .t-tab.sel { color: #ffe0a0; background: rgba(var(--gold),0.22); box-shadow: inset 0 0 0 1.5px rgba(var(--gold),0.9); }
`;
const LABEL = (l) => (l || '').charAt(0) + (l || '').slice(1).toLowerCase(); // 'GRAB' -> 'Grab'

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
  { id: 'ask', label: 'HEALTH', icon: 'bot', shape: 'plate', key: 'KeyX', sys: true },
  { id: 'jump', label: 'JUMP', icon: 'jump', d: 32, key: 'Space', bezel: 'hazmat' },
  { id: 'use', label: 'USE', icon: 'hand', d: 28, key: 'KeyE', bezel: 'hazmat' },
  { id: 'grab', label: 'GRAB', icon: 'grab', d: 28, mouse: 2 },
  { id: 'item', label: 'PUNCH', icon: 'fist', d: 28, mouse: 0 },
  { id: 'tool', label: 'TOOL', icon: 'gear', d: 22, key: 'KeyQ', led: true },
  { id: 'duck', label: 'DUCK', icon: 'crouch', d: 24, act: 'duck', led: true },
  { id: 'rot', label: 'ROT', icon: 'rotate', d: 22, key: 'KeyR' },
  { id: 'mode', label: 'MODE', icon: 'swap', d: 22, act: 'mode' },
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
      <div class="t-stick"><div class="t-ring"></div><div class="t-knob"></div></div>
      <div class="t-ctx"></div>
      <div class="t-tabs"></div>
      ${BUTTONS.map((b) => `<button class="t-btn${b.sys ? ' t-sys' : ''}" data-b="${b.id}" type="button" aria-label="${b.label}"><span class="t-icw"></span><span class="t-lbl"></span></button>`).join('')}`;
    this.root.classList.add('glass');
    if (!document.getElementById('touch-glass-css')) {
      const css = document.createElement('style');
      css.id = 'touch-glass-css';
      css.textContent = CSS;
      document.head.appendChild(css);
    }
    document.body.appendChild(this.root);
    this.stickEl = this.root.querySelector('.t-stick');
    this.ringCv = this.root.querySelector('.t-ring');
    this.knobCv = this.root.querySelector('.t-knob');
    this.ctxCv = this.root.querySelector('.t-ctx');
    this.tabsEl = this.root.querySelector('.t-tabs');
    this.sprinting = false;
    this.btn = {};
    for (const b of BUTTONS) {
      const el = this.root.querySelector(`[data-b="${b.id}"]`);
      this.btn[b.id] = { def: b, el, icw: el.querySelector('.t-icw'), lbl: el.querySelector('.t-lbl'), down: false, lit: b.led ? false : null, glow: false, label: b.label, icon: b.icon, key: '', iconKey: '' };
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
    const key = `${b.down}|${b.lit}|${b.glow}|${b.label}|${b.icon}|${b.big ? 1 : 0}|${this.P}`;
    if (key === b.key) return;
    b.key = key;
    const P = this.P;
    const w = d.shape === 'plate' ? PLATE_W * P : (b.big ? 34 : d.d) * P, h = d.shape === 'plate' ? PLATE_H * P : w;
    const el = b.el;
    el.style.setProperty('--w', `${w}px`);
    el.style.setProperty('--h', `${h}px`);
    el.style.setProperty('--fs', `${Math.round(Math.max(10, Math.min(w, h) * (d.shape === 'plate' ? 0.24 : 0.2)))}px`);
    el.classList.toggle('lit', !!b.lit);
    el.classList.toggle('big', !!b.big);
    if (b.iconKey !== b.icon) { b.iconKey = b.icon; b.icw.outerHTML = svg(b.icon); b.icw = el.querySelector('.t-ico'); }
    const lbl = LABEL(b.label);
    if (b.lbl.textContent !== lbl) b.lbl.textContent = lbl;
    b.w = w / P; b.h = h / P;
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
      el.innerHTML = `${svg(icons[i] || 'item')}<span>${LABEL(n)}</span>`;
      this.tabsEl.appendChild(el);
      this.tabBtns.push({ el, name: n, icon: icons[i] || 'item', key: '' });
    });
  }

  _renderTab(tb, sel) {
    const key = `${sel}`;
    if (key === tb.key) return;
    tb.key = key;
    tb.el.classList.toggle('sel', !!sel);
  }

  _renderCtx(label) {
    if (label === this._ctxLabel) return;
    this._ctxLabel = label;
    if (!label) { this.ctxCv.classList.remove('show'); return; }
    this.ctxCv.textContent = label;
    this.ctxCv.classList.remove('show');
    void this.ctxCv.offsetWidth; // restart the pop-in
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
    this.root.style.setProperty('--cfs', `${Math.round(7.5 * P)}px`);
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
    put('mode', bx - 76 * P, by - 41 * P); // shares ROT's spot: ROT while carrying, MODE with the multitool out
    put('tool', bx - 80 * P, by - 69 * P);
    this.cluster = { left: bx - 92 * P, top: by - 82 * P, right: bx, bottom: by };
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
    this.sysLeft = vw - ins.r - m - Math.min(cols, SYS_ORDER.length) * (pw + gap) + gap;
    for (const [id, p] of Object.entries(L)) {
      const b = this.btn[id];
      b.el.style.left = `${Math.round(p.cx)}px`;
      b.el.style.top = `${Math.round(p.cy)}px`;
    }
    this.layoutPos = L;
    this._placeUse();
    // stick rest position (bottom-left)
    this.stickRest = { x: ins.l + m + 28 * P, y: vh - ins.b - m - 28 * P };
    if (!this.stick) { this.stickEl.style.left = `${this.stickRest.x}px`; this.stickEl.style.top = `${this.stickRest.y}px`; }
    this.stickR = 22 * P;
    // inventory / watch tabs: bottom centre between the stick and the cluster, or above the cluster in portrait
    const inv = this.game.ui?.hotbar;
    const n = this.game.local?.inv?.slots?.length || 5;
    const hw = n * 28 * P + (n - 1) * P;
    let pos;
    // portrait: above the cluster, leaving a lane for the USE context tag
    if (portrait) pos = { cx: vw / 2, bottom: ins.b + m + 86 * P };
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

  // terminals: USE becomes a big OK key in JUMP's corner
  _placeUse() {
    const L = this.layoutPos;
    if (!L) return;
    const p = this.root.classList.contains('term') ? L.jump : L.use;
    this.btn.use.el.style.left = `${Math.round(p.cx)}px`;
    this.btn.use.el.style.top = `${Math.round(p.cy)}px`;
  }

  _placeCtx() {
    const u = this.layoutPos?.use;
    if (!u || !this.ctxCv.classList.contains('show')) return;
    const P = this.P, w = this.ctxCv.offsetWidth, h = this.ctxCv.offsetHeight + 5;
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
    for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ShiftLeft', 'TouchSprint']) input.virtualUp(k);
  }

  _setSprint(on) {
    if (on === this.sprinting) return;
    this.sprinting = on;
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
    this.knobCv.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
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
    set('TouchSprint', sprint);
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
    // PUNCH while carrying something (not a camp part) is the far THROW
    if (down) b.via = b.def.id === 'item' && this.throwMode ? 'TouchThrow' : null;
    if (b.via) { if (down) input.virtualDown(b.via); else input.virtualUp(b.via); } else {
      if (d.key) { if (down) input.virtualDown(d.key); else input.virtualUp(d.key); }
      if (d.mouse !== undefined) input.virtualMouse(d.mouse, down);
    }
    if (!down) return;
    if (d.act === 'next') input.mouse.wheel += 1;
    if (d.act === 'duck') {
      this.crouchOn = !this.crouchOn;
      if (this.crouchOn) input.virtualDown('KeyC'); else input.virtualUp('KeyC');
    }
    if (d.act === 'mode') this.game.local?.toggleMultitoolMode?.();
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
    // the drawn multitool (or the old multitool item) owns PUNCH and shows MODE
    const cur = l.hands?.rightItem?.() ?? l.inv?.current;
    const mt = !!(l.toolOut || l._mtItem?.());
    const state = `${term}|${dead}|${grab}|${watch}|${mt}`;
    if (state !== this.state) {
      this.state = state;
      const vis = (id, on) => this.btn[id].el.classList.toggle('gone', !on);
      const full = !term && !dead;
      for (const id of ['watch', 'light', 'next', 'drop', 'ask', 'jump', 'duck']) vis(id, full);
      vis('use', !dead);
      vis('grab', !term);
      vis('item', !term);
      vis('rot', full && grab);
      vis('mode', full && !grab && mt);
      vis('tool', full);
      this.tabsEl.classList.toggle('show', full && watch);
      const set = (id, label, icon) => { const b = this.btn[id]; b.label = label; b.icon = icon; };
      set('grab', dead ? 'PREV' : 'GRAB', dead ? 'back' : 'grab');
      set('menu', term ? 'EXIT' : 'MENU', term ? 'back' : 'menu');
      set('use', term ? 'OK' : 'USE', term ? 'ok' : 'hand');
      this.btn.use.big = term;
      this.root.classList.toggle('term', term);
      this._placeUse();
      this.root.classList.toggle('watching', watch);
    }
    // PUNCH button shows what LMB does: punch, the right-hand item, the multitool, THROW while carrying
    const it = this.btn.item;
    const owns = grab && l._mtOwnsLmb?.();
    this.throwMode = grab && !owns;
    const armful = !!l.hands?.layout?.armful;
    if (dead) { it.label = 'NEXT'; it.icon = 'next'; }
    else if (owns) { it.label = 'ATTACH'; it.icon = 'gear'; }
    else if (grab) { it.label = 'THROW'; it.icon = 'throw'; }
    else if (armful) { it.label = 'FULL'; it.icon = 'drop'; }
    else if (mt) { it.label = l.mtMode === 'dismantle' ? 'SCRAP' : 'ATTACH'; it.icon = 'gear'; }
    else if (cur && l._handItemUse?.()) {
      const u = l._handItemUse();
      it.label = u === 'swing' ? 'SWING' : u === 'eat' ? 'EAT' : u === 'drink' ? 'DRINK' : 'USE';
      it.icon = u === 'swing' ? 'swing' : 'item';
    } else { it.label = 'PUNCH'; it.icon = 'fist'; }
    // context: what USE would do right now
    let ctx = '';
    if (!term && !dead) {
      const p = l.focus?.prompt;
      if (p) ctx = p.replace(/^\[[^\]]*\]\s*/, '').split(' · ')[0].split(/\s+/).slice(0, 4).join(' ').slice(0, 26);
    }
    this._renderCtx(ctx);
    const use = this.btn.use;
    use.glow = !!ctx || term;
    use.el.classList.toggle('ready', use.glow);
    this.btn.light.lit = !!l.flashOn;
    this.btn.duck.lit = this.crouchOn;
    this.btn.watch.lit = watch;
    this.btn.tool.lit = !!l.toolOut;
    for (const b of Object.values(this.btn)) this._render(b);
    if (watch) this.tabBtns.forEach((tb, i) => this._renderTab(tb, i === (g.watch?.tabIdx ?? 0)));
    // the inventory gives way to the watch tabs while the watch is up
    ui.hotbarHiddenByTouch = watch && !term && !dead;
  }
}


