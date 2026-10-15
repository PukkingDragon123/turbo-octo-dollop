// R.O.O.M. — wardrobe-mode UI (main menu): the floating "CUSTOMIZE" tag over your clone at the break-room
// table, and the AUTO-OUTFITTER control panel shown while your clone hangs in the outfitting bay.
// Pixel-art look from ui/pixelart.js (frames, glyphs, bitmap font). Owned by world/menu_scene.js.
import { installPixelCSS, Pix, C, text, textWidth, FONT5, FONT3, glyphURL } from './pixelart.js';
import { profile, ACHIEVEMENTS } from '../core/profile.js';
import { COSMETICS } from '../entities/avatar.js';

const LABEL = { suit: 'SUIT', skin: 'SKIN', hat: 'HAT', visor: 'GEAR', face: 'FACE', backpack: 'PACK', accessory: 'EXTRA' };

const CSS = `
#wardrobe-ui { position: fixed; inset: 0; pointer-events: none; z-index: 12; font-family: var(--font, 'VT323', monospace); color: var(--fg, #ffb43a); }
#wardrobe-ui .wd-tag { position: absolute; left: 0; top: 0; image-rendering: pixelated; display: none; will-change: transform; }
#wardrobe-ui .wd-tag.show { display: block; }
#wardrobe-ui .wd-panel { position: absolute; left: 12px; top: 12px; bottom: 12px; width: min(440px, 40vw); display: none; flex-direction: column; pointer-events: auto;
  border: calc(var(--px, 2px) * 8) solid transparent; border-image: var(--pa-panel) 8 fill / calc(var(--px, 2px) * 8) stretch; image-rendering: pixelated;
  filter: drop-shadow(0 calc(var(--px, 2px) * 3) 0 rgba(0,0,0,0.55)); padding: 6px 10px 8px; }
#wardrobe-ui .wd-panel.show { display: flex; animation: wd-in 0.35s steps(5); }
@keyframes wd-in { from { transform: translateX(-24px); } to { transform: none; } }
#wardrobe-ui .wd-panel::before { content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0 1px, transparent 1px 3px); pointer-events: none; z-index: 3; }
#wardrobe-ui .wd-head { display: flex; align-items: center; gap: 8px; flex: none; }
#wardrobe-ui .wd-head canvas { image-rendering: pixelated; flex: none; }
#wardrobe-ui .wd-title { font-size: 30px; line-height: 1; color: var(--fg-hi, #fff0c0); letter-spacing: 2px; text-shadow: 3px 3px 0 #4a2a06; }
#wardrobe-ui .wd-sub { font-size: 17px; line-height: 1.05; color: var(--fg-dim, #a8701c); letter-spacing: 1px; }
#wardrobe-ui .wd-rule { flex: none; height: var(--px, 2px); margin: 6px 0 6px; background: repeating-linear-gradient(90deg, #d68a1e 0 calc(var(--px, 2px) * 3), transparent calc(var(--px, 2px) * 3) calc(var(--px, 2px) * 5)); }
#wardrobe-ui .wd-tabs { display: flex; flex-wrap: wrap; gap: 4px; flex: none; }
#wardrobe-ui button { font-family: inherit; cursor: pointer; background: none; color: var(--fg, #ffb43a); text-shadow: 1px 1px 0 #000; image-rendering: pixelated;
  border: calc(var(--px, 2px) * 3) solid transparent; border-image: var(--pa-btn) 3 fill / calc(var(--px, 2px) * 3); -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
#wardrobe-ui button:hover { color: var(--fg-hi, #fff0c0); }
#wardrobe-ui button:active { border-image-source: var(--pa-btn-down); transform: translateY(var(--px, 2px)); }
#wardrobe-ui .wd-tab { font-size: 20px; line-height: 1; padding: 1px 6px 2px; flex: 1 1 auto; }
#wardrobe-ui .wd-tab.on { border-image-source: var(--pa-btn-hot); color: #1b130c; text-shadow: 1px 1px 0 #ffd681; }
#wardrobe-ui .wd-cat { flex: none; display: flex; justify-content: space-between; align-items: baseline; margin: 8px 2px 4px; font-size: 18px; color: var(--fg-dim, #a8701c); letter-spacing: 1px; }
#wardrobe-ui .wd-opts { flex: 1 1 auto; min-height: 0; overflow: hidden auto; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; align-content: start; padding-right: 2px;
  scrollbar-width: thin; scrollbar-color: #a8701c #1b130c; }
#wardrobe-ui .wd-opts::-webkit-scrollbar { width: 8px; }
#wardrobe-ui .wd-opts::-webkit-scrollbar-thumb { background: #a8701c; box-shadow: inset 0 0 0 2px #0d0906; }
#wardrobe-ui .wd-opts::-webkit-scrollbar-track { background: #1b130c; }
#wardrobe-ui .wd-opt { position: relative; display: flex; align-items: center; gap: 6px; text-align: left; padding: 2px 5px 3px; min-height: 34px; font-size: 19px; line-height: 0.95; }
#wardrobe-ui .wd-opt .sw { flex: none; width: calc(var(--px, 2px) * 7); height: calc(var(--px, 2px) * 7); box-shadow: 0 0 0 var(--px, 2px) #0d0906, inset calc(var(--px, 2px) * -2) calc(var(--px, 2px) * -2) 0 rgba(0,0,0,0.3), inset var(--px, 2px) var(--px, 2px) 0 rgba(255,255,255,0.35); }
#wardrobe-ui .wd-opt .nm { flex: 1 1 auto; min-width: 0; overflow: hidden; }
#wardrobe-ui .wd-opt .lk { display: block; font-size: 15px; color: #c8301e; text-shadow: 1px 1px 0 #000; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#wardrobe-ui .wd-opt.on { border-image-source: var(--pa-btn-hot); color: #1b130c; text-shadow: 1px 1px 0 #ffd681; }
#wardrobe-ui .wd-opt.locked { border-image-source: var(--pa-btn-off); color: #6a4a20; cursor: not-allowed; }
#wardrobe-ui .wd-opt.locked .sw { filter: grayscale(1) brightness(0.45); }
#wardrobe-ui .wd-opt.locked::after { content: ''; position: absolute; right: 3px; top: 3px; width: calc(var(--px, 2px) * 7); height: calc(var(--px, 2px) * 7); background: var(--wd-lock) center / 100% 100% no-repeat; image-rendering: pixelated; opacity: 0.85; }
#wardrobe-ui .wd-info { flex: none; min-height: 40px; margin-top: 6px; padding: 3px 8px; font-size: 18px; line-height: 1.1; color: var(--fg-hi, #fff0c0); text-shadow: 2px 2px 0 #000;
  border: calc(var(--px, 2px) * 3) solid transparent; border-image: var(--pa-inset) 3 fill / calc(var(--px, 2px) * 3); image-rendering: pixelated; }
#wardrobe-ui .wd-info.err { color: #ff9c80; }
#wardrobe-ui .wd-foot { flex: none; display: flex; gap: 6px; margin-top: 6px; }
#wardrobe-ui .wd-foot button { font-size: 25px; line-height: 1; padding: 3px 10px 4px; display: flex; align-items: center; gap: 8px; }
#wardrobe-ui .wd-foot button::before { content: ''; width: calc(var(--px, 2px) * 11); height: calc(var(--px, 2px) * 11); background: center / 100% 100% no-repeat; image-rendering: pixelated; flex: none; }
#wardrobe-ui .wd-rand { flex: 1 1 40%; }
#wardrobe-ui .wd-rand::before { background-image: var(--wd-next); }
#wardrobe-ui .wd-done { flex: 1 1 60%; border-image-source: var(--pa-plate-green) !important; color: #a8ffbe !important; justify-content: center; }
#wardrobe-ui .wd-done::before { background-image: var(--wd-ok); }
#wardrobe-ui .wd-done:hover { color: #e4ffe9 !important; }
#wardrobe-ui .wd-status { position: absolute; top: 12px; right: 12px; display: none; max-width: 46vw; font-size: 19px; line-height: 1.1; padding: 2px 10px 3px; color: #a8ffbe; text-shadow: 2px 2px 0 #000;
  border: calc(var(--px, 2px) * 3) solid transparent; border-image: var(--pa-plate-green) 3 fill / calc(var(--px, 2px) * 3); image-rendering: pixelated; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#wardrobe-ui .wd-status.show { display: block; }
#wardrobe-ui .wd-status.err { color: #ff9c80; border-image-source: var(--pa-plate-red); }
#wardrobe-ui .wd-hint { position: absolute; bottom: 14px; right: 16px; display: none; font-size: 17px; color: var(--fg-dim, #a8701c); text-shadow: 2px 2px 0 #000; }
#wardrobe-ui .wd-hint.show { display: block; animation: blink 1.6s steps(2) infinite; }
#wardrobe-ui .wd-panel.busy .wd-done { opacity: 0.6; }
/* phone landscape: narrower panel, tighter type */
@media (max-height: 520px) and (orientation: landscape) {
  #wardrobe-ui .wd-panel { left: 6px; top: 6px; bottom: 6px; width: min(400px, 47vw); padding: 2px 6px 4px; }
  #wardrobe-ui .wd-head canvas { display: none; }
  #wardrobe-ui .wd-title { font-size: 22px; }
  #wardrobe-ui .wd-sub { display: none; }
  #wardrobe-ui .wd-rule { margin: 3px 0; }
  #wardrobe-ui .wd-tab { font-size: 16px; padding: 0 4px 1px; }
  #wardrobe-ui .wd-cat { margin: 3px 2px 2px; font-size: 15px; }
  #wardrobe-ui .wd-opt { font-size: 16px; min-height: 28px; padding: 1px 4px 2px; }
  #wardrobe-ui .wd-opt .lk { font-size: 13px; }
  #wardrobe-ui .wd-info { min-height: 0; font-size: 15px; margin-top: 3px; padding: 1px 6px; }
  #wardrobe-ui .wd-foot { margin-top: 3px; }
  #wardrobe-ui .wd-foot button { font-size: 19px; padding: 1px 8px 2px; }
  #wardrobe-ui .wd-status { font-size: 16px; top: 6px; right: 6px; }
}
/* portrait phones: the panel docks along the bottom, the clone hangs above it */
@media (orientation: portrait) and (max-width: 760px) {
  #wardrobe-ui .wd-panel { left: 6px; right: 6px; top: auto; bottom: 6px; width: auto; height: min(54vh, 470px); padding: 2px 6px 4px; }
  #wardrobe-ui .wd-panel.show { animation: wd-up 0.35s steps(5); }
  @keyframes wd-up { from { transform: translateY(30px); } to { transform: none; } }
  #wardrobe-ui .wd-head canvas { display: none; }
  #wardrobe-ui .wd-title { font-size: 24px; }
  #wardrobe-ui .wd-sub { font-size: 15px; }
  #wardrobe-ui .wd-tabs { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
  #wardrobe-ui .wd-tabs::-webkit-scrollbar { display: none; }
  #wardrobe-ui .wd-tab { font-size: 18px; flex: 0 0 auto; }
  #wardrobe-ui .wd-opt { font-size: 17px; min-height: 30px; }
  #wardrobe-ui .wd-info { font-size: 16px; min-height: 0; }
  #wardrobe-ui .wd-foot button { font-size: 22px; }
  #wardrobe-ui .wd-status { left: 6px; right: 6px; top: 6px; max-width: none; font-size: 16px; text-align: center; }
  #wardrobe-ui .wd-hint { bottom: auto; top: 40px; right: 10px; }
}
`;

const hex6 = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6);

export class WardrobeUI {
  constructor({ onPick, onDone, onRandom, onLocked } = {}) {
    installPixelCSS();
    this.cb = { onPick, onDone, onRandom, onLocked };
    if (!document.getElementById('wardrobe-css')) {
      const st = document.createElement('style');
      st.id = 'wardrobe-css';
      st.textContent = CSS + `:root{--wd-lock:url("${glyphURL('lock', C.red4)}");--wd-next:url("${glyphURL('next', C.amber)}");--wd-ok:url("${glyphURL('ok', C.green)}");}`;
      document.head.appendChild(st);
    }
    const root = (this.root = document.createElement('div'));
    root.id = 'wardrobe-ui';
    root.innerHTML = `
      <canvas class="wd-tag"></canvas>
      <div class="wd-status"></div>
      <div class="wd-hint"></div>
      <div class="wd-panel" role="dialog" aria-label="Wardrobe">
        <div class="wd-head"><canvas class="wd-icon"></canvas><div><div class="wd-title">AUTO-OUTFITTER</div><div class="wd-sub">MK.II · BAY 07 · HOLD STILL. THIS WILL NOT HURT.</div></div></div>
        <div class="wd-rule"></div>
        <div class="wd-tabs"></div>
        <div class="wd-cat"><span class="wd-catname"></span><span class="wd-count"></span></div>
        <div class="wd-opts"></div>
        <div class="wd-info"></div>
        <div class="wd-foot"><button class="wd-rand" type="button">RANDOM</button><button class="wd-done" type="button">DONE</button></div>
      </div>`;
    document.body.appendChild(root);
    this.tag = root.querySelector('.wd-tag');
    this.panel = root.querySelector('.wd-panel');
    this.tabsEl = root.querySelector('.wd-tabs');
    this.optsEl = root.querySelector('.wd-opts');
    this.infoEl = root.querySelector('.wd-info');
    this.statusEl = root.querySelector('.wd-status');
    this.hintEl = root.querySelector('.wd-hint');
    this.catName = root.querySelector('.wd-catname');
    this.countEl = root.querySelector('.wd-count');
    root.querySelector('.wd-done').addEventListener('click', () => this.cb.onDone?.());
    root.querySelector('.wd-rand').addEventListener('click', () => this.cb.onRandom?.());
    this._icon(root.querySelector('.wd-icon'));
    this.cat = Object.keys(COSMETICS)[0];
    this.cos = {};
    this.isOpen = false;
    this._tagKey = '';
    this._tagCache = new Map();
  }

  // little pixel robot-arm emblem for the panel header
  _icon(cv) {
    const p = new Pix(22, 22);
    p.rect(2, 18, 10, 3, C.st2); p.hline(2, 11, 18, C.st4);
    p.rod(7, 17, 7, 9, 2, ['#3e300a', '#715a14', '#a8871f', '#d9b437', '#f2d469', '#fff1a8'], { round: true });
    p.rod(7, 9, 15, 5, 1.7, ['#3e300a', '#715a14', '#a8871f', '#d9b437', '#f2d469', '#fff1a8'], { round: true });
    p.disc(7, 9, 2, C.st1); p.set(7, 8, C.st4);
    p.line(15, 5, 19, 3, C.st4); p.line(15, 5, 19, 8, C.st4); p.line(19, 3, 20, 5, C.st3); p.line(19, 8, 20, 6, C.st3);
    p.set(17, 12, C.amber); p.set(19, 11, C.amber4); p.set(18, 14, C.amber2); p.set(20, 13, C.red);
    p.finish({ shadow: 0.4 });
    p.toCanvas(cv);
    cv.style.width = '44px'; cv.style.height = '44px';
  }

  // ---- floating tag over the clone ('you' | 'hover' | 'touch' | null)
  _tagPix(mode) {
    if (this._tagCache.has(mode)) return this._tagCache.get(mode);
    const label = mode === 'hover' ? 'CUSTOMIZE' : mode === 'touch' ? 'TAP TO CUSTOMIZE' : 'YOU';
    const font = mode === 'you' ? FONT3 : FONT5;
    const tw = textWidth(label, font, 1), th = font.h;
    const padX = mode === 'you' ? 3 : 5, padY = mode === 'you' ? 2 : 3;
    const w = tw + padX * 2 + 2, h = th + padY * 2 + 2 + 5;
    const p = new Pix(w + 2, h + 2);
    const hot = mode !== 'you';
    const face = hot ? C.amber : C.ink3, rim = hot ? C.amber5 : C.ink4, lo = hot ? C.amber1 : C.ink;
    const bh = th + padY * 2 + 2;
    p.rbox(1, 1, w, bh, 1, face);
    p.hline(2, w - 1, 1, rim); p.vline(1, 2, bh - 1, rim); p.hline(2, w, bh, lo);
    const cx = Math.floor(w / 2) + 1;
    p.poly([[cx - 3, bh], [cx + 4, bh], [cx + 0.5, bh + 4.5]], face);
    text(p, label, 1 + padX + 1, 1 + padY + 1, hot ? C.ink2 : C.amber, { font });
    p.outline(C.ink).shadow(0.45);
    this._tagCache.set(mode, p);
    return p;
  }
  setTag(x, y, mode, scale = 2) {
    if (!mode) { this.tag.classList.remove('show'); this._tagKey = ''; return; }
    const key = mode + scale;
    if (key !== this._tagKey) {
      const p = this._tagPix(mode);
      p.toCanvas(this.tag);
      this.tag.style.width = `${p.w * scale}px`;
      this.tag.style.height = `${p.h * scale}px`;
      this._tagKey = key;
    }
    this.tag.classList.add('show');
    this.tag.style.transform = `translate(${Math.round(x - (this.tag.width * scale) / 2)}px, ${Math.round(y - this.tag.height * scale)}px)`;
  }

  // ---- panel
  open(cos) {
    this.cos = { ...cos };
    this.isOpen = true;
    this._renderTabs();
    this._renderOpts();
    this.info('Pick a category. Each change is installed by hand. Mostly.');
    this.panel.classList.add('show');
    this.hintEl.textContent = window.matchMedia?.('(pointer: coarse)').matches ? 'DRAG TO SPIN THE SUBJECT' : 'DRAG TO SPIN THE SUBJECT · ESC = DONE';
    this.hintEl.classList.add('show');
  }
  close() {
    this.isOpen = false;
    this.panel.classList.remove('show');
    this.hintEl.classList.remove('show');
    this.status(null);
  }
  setCurrent(cos) { this.cos = { ...cos }; if (this.isOpen) this._renderOpts(); }
  setBusy(b) { this.panel.classList.toggle('busy', !!b); }
  panelRect() { return this.isOpen ? this.panel.getBoundingClientRect() : null; }
  status(msg, err = false) {
    if (!msg) { this.statusEl.classList.remove('show'); return; }
    this.statusEl.textContent = msg;
    this.statusEl.classList.toggle('err', !!err);
    this.statusEl.classList.add('show');
  }
  info(msg, err = false) {
    this.infoEl.textContent = msg;
    this.infoEl.classList.toggle('err', !!err);
  }

  _renderTabs() {
    this.tabsEl.innerHTML = '';
    for (const cat of Object.keys(COSMETICS)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wd-tab' + (cat === this.cat ? ' on' : '');
      b.textContent = LABEL[cat] || cat.toUpperCase();
      b.addEventListener('click', () => { this.cat = cat; this._renderTabs(); this._renderOpts(); this.optsEl.scrollTop = 0; this.cb.onPick?.(null, null, 'tab'); });
      this.tabsEl.appendChild(b);
    }
  }
  _renderOpts() {
    const cat = this.cat, list = COSMETICS[cat] || [];
    this.catName.textContent = `${LABEL[cat] || cat.toUpperCase()} · ${list.length} PARTS`;
    const unlocked = list.filter((o) => !o.unlock || profile.has(o.unlock)).length;
    this.countEl.textContent = `${unlocked}/${list.length} ISSUED`;
    const scroll = this.optsEl.scrollTop;
    this.optsEl.innerHTML = '';
    for (const o of list) {
      const locked = !!o.unlock && !profile.has(o.unlock);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wd-opt' + (this.cos[cat] === o.id ? ' on' : '') + (locked ? ' locked' : '');
      if (o.color !== undefined) {
        const sw = document.createElement('span');
        sw.className = 'sw';
        sw.style.background = o.color2 !== undefined ? `linear-gradient(135deg, ${hex6(o.color)} 0 55%, ${hex6(o.color2)} 55% 100%)` : hex6(o.color);
        b.appendChild(sw);
      }
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = (o.name || o.id).toUpperCase();
      if (locked) {
        const lk = document.createElement('span');
        lk.className = 'lk';
        lk.textContent = '◆ ' + (ACHIEVEMENTS[o.unlock]?.name || o.unlock).toUpperCase();
        nm.appendChild(lk);
        b.title = `Locked: ${ACHIEVEMENTS[o.unlock]?.name || o.unlock} — ${ACHIEVEMENTS[o.unlock]?.desc || ''}`;
      }
      b.appendChild(nm);
      b.addEventListener('click', () => {
        if (locked) {
          this.info(`LOCKED · ${ACHIEVEMENTS[o.unlock]?.name || o.unlock}: ${ACHIEVEMENTS[o.unlock]?.desc || 'classified'}`, true);
          this.cb.onLocked?.(cat, o);
          return;
        }
        if (this.cos[cat] === o.id) return;
        this.cos[cat] = o.id;
        this.info(`INSTALLING: ${(o.name || o.id).toUpperCase()}`);
        this._renderOpts();
        this.cb.onPick?.(cat, o.id);
      });
      this.optsEl.appendChild(b);
    }
    this.optsEl.scrollTop = scroll;
  }

  dispose() { this.root.remove(); }
}
