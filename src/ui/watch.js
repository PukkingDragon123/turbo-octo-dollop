// The wristwatch: an old digital watch on the clone's left wrist, a warm backlit LCD (ui/watchdraw.js paints it)
// with a few APPS. The app list is data: [{ id, name, icon, via?, builtin?, draw? }]. Today it comes from
// game/economy.js WATCH_APPS (and which are installed from its economy); a system that owns the apps can hand
// over its own list with setWatchApps(list, installedFn) and draw any app with registerWatchApp(id, draw) or a
// draw(ctx, kit, t, y0, watch) on the entry, without touching this file. An app with no drawing gets a plain
// card (its icon and name). Built-in faces: HOME (launcher), STATUS (vitals + pulse), MAP and a RADIO log.
// Q / E cycle the installed apps while the watch is up. Notices (radio, pickups, warnings,
// achievements) make the watch beep and the clone glances at the wrist.
import * as THREE from 'three';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { CrtScreen } from './crt.js';
import { itemName } from '../game/itemdefs.js';
import * as ECON from '../game/economy.js';
import { CELL, wallN, wallW, W } from '../world/levels/yellow/layout.js';
import { S, INK, DIM, LINE, TRACK, RED, SM, M, L, begin, txt, tw, wrap, rule, vrule, frame, bar, dot, ring, icon, bullet, erase, face } from './watchdraw.js';

let APPS = ECON.WATCH_APPS || [];
let INSTALLED = null; // optional (watch) => [app ids]
const DRAW = {};      // id -> draw(ctx, kit, t, y0, watch), from registerWatchApp
// hand the watch a new app list (and optionally which of them are installed right now)
export function setWatchApps(list, installedFn = null) { APPS = Array.isArray(list) ? list : []; INSTALLED = installedFn; }
// draw an app's face: fn(ctx, kit, t, y0, watch); kit holds the palette, sizes and drawing helpers
export function registerWatchApp(id, fn) { DRAW[id] = fn; }
export function watchApps() { return APPS; }

const LEGACY = ['status', 'map']; // shown when nothing says which apps are installed
const AW = 160, AH = 120; // the face in watch units
// STATUS rows: icon, name, value 0..1 from the survival model, warn below this percent
const VITALS = [
  ['heart', 'HEALTH', (s) => (s.health ?? 100) / 100, 30],
  ['food', 'FOOD', (s) => (s.hunger ?? 100) / 100, 25],
  ['drop', 'WATER', (s) => (s.thirst ?? 100) / 100, 25],
  ['flame', 'WARMTH', (s) => (s.warmth ?? 100) / 100, 30],
  ['moon', 'REST', (s) => (s.rest ?? 100) / 100, 20],
  ['bolt', 'STAMINA', (s) => (s.stamina ?? 40) / (s.maxStamina || 40), 20],
];
const noop = () => {};
const appMeta = (id) => APPS.find((a) => a.id === id);


export class Watch {
  constructor(game) {
    this.game = game;
    this.screen = new CrtScreen(AW * S, AH * S, 'amber');
    this.screen.fps = 15;
    // an LCD, not a CRT: none of the CRT's scanlines, rolling bar or vignette; _present paints the whole face
    this.screen.overlay = noop;
    this.layer = document.createElement('canvas'); // the LCD ink, composed over the backlit ground by face()
    this.layer.width = AW * S; this.layer.height = AH * S;
    this.lctx = this.layer.getContext('2d');
    const tex = this.screen.texture;
    tex.generateMipmaps = true; // sharp up close, no shimmer when the wrist is small on screen
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    this.screen.canvas.style.imageRendering = 'auto';
    this.app = 'status';
    this.messages = [];
    this.ekg = new Float32Array(90);
    this.ekgPhase = 0;
    this.ekgI = 0;
    this.notices = [];
    this.peekT = 0;
    this._beepT = 0;
    this._exitPeekT = 0;
    this._hurtPeekT = 0;
    this._lastSel = -1;
    this._known = null;
    this.attach(game.local.arms);
  }

  get econ() { const m = this.game.world?.level?.mission; return m?.econ && !m.econ.disposed ? m.econ : null; }

  // installed app ids in launcher order
  installed() {
    if (INSTALLED) { try { const l = INSTALLED(this); if (l?.length) return l; } catch (e) { /* fall through */ } }
    const e = this.econ;
    if (!e?.appInstalled) return LEGACY.filter((id) => (APPS.length ? appMeta(id) : BUILTIN[id]));
    return APPS.filter((a) => e.appInstalled(a.id)).map((a) => a.id);
  }

  get tab() { return this.app; }
  get tabs() { return this.installed().map((id) => appMeta(id)?.name || id.toUpperCase()); }
  get tabIdx() { return Math.max(0, this.installed().indexOf(this.app)); }
  set tabIdx(i) { const list = this.installed(); this.app = list[((i % list.length) + list.length) % list.length]; }

  setTab(i) {
    const list = this.installed();
    i = ((i % list.length) + list.length) % list.length;
    if (list[i] === this.app) return;
    this.app = list[i];
    this.screen.lastDraw = -1;
    if (audio.ready) audio.play('watch_beep', { volume: 0.3, bus: 'ui' });
  }

  attach(arms) {
    if (arms?.watchScreen) {
      // a backlit LCD: the face's own colours carry it (albedo + a gentle emissive under the bloom threshold),
      // matte like the painted world, so the room light still falls on it a little
      this.screen.attach(arms.watchScreen, 0.62);
      const mat = arms.watchScreen.material;
      mat.color.setHex(0x8a7a62);
      mat.roughness = 0.8;
      mat.toneMapped = true;
    }
  }

  // a notice glances the watch up for a few seconds (unless it is already raised, then it shows as a banner)
  notify(text, kind = '', from = '') {
    if (!text) return;
    const top = this.notices[0];
    if (top && top.text === text && this.peekT > 0) { top.n++; this.peekT = Math.max(this.peekT, 2.2); return; }
    this.notices.unshift({ text, kind, from, n: 1, t: Date.now() });
    if (this.notices.length > 4) this.notices.pop();
    this.peekT = Math.min(5.5, 2.4 + text.length * 0.035);
    if (this._beepT <= 0 && audio.ready) { audio.play('watch_beep', { volume: kind === 'bad' || kind === 'warn' ? 0.4 : 0.25, bus: 'ui' }); this._beepT = 0.35; }
    this.screen.lastDraw = -1;
  }

  // true while the clone glances at the watch for a notice
  get peeking() { return this.peekT > 0 && !this.game.local?.dead; }

  log(from, msg) {
    this.messages.unshift({ from, msg, t: Date.now() });
    if (this.messages.length > 30) this.messages.pop();
  }

  // the research camera was retired; kept so the main loop's call stays harmless
  captureIfRequested() {}

  update(dt) {
    const g = this.game;
    const l = g.local;
    if (!g.world) return;
    this.peekT = Math.max(0, this.peekT - dt);
    this._beepT -= dt;
    this._autoNotices(dt);
    this._appsChanged();
    if (!this.installed().includes(this.app)) this.app = this.installed()[this.econ ? 1 : 0] || 'status';
    // app switching (Q / E while the watch is up)
    if (l.watchOpen && !l.dead && !g.terminal.active) {
      if (input.hit('tabPrev')) this.setTab(this.tabIdx - 1);
      if (input.pressed.has('KeyE')) this.setTab(this.tabIdx + 1);
    }
    // EKG
    const hr = l.survival.heartRate || 72;
    this.ekgPhase += dt * hr / 60;
    const ph = this.ekgPhase % 1;
    let v = 0;
    if (!l.dead) {
      if (ph < 0.06) v = Math.sin(ph / 0.06 * Math.PI) * 0.15;
      else if (ph > 0.12 && ph < 0.15) v = -0.2;
      else if (ph >= 0.15 && ph < 0.19) v = 1.0;
      else if (ph >= 0.19 && ph < 0.23) v = -0.35;
      else if (ph > 0.35 && ph < 0.47) v = Math.sin((ph - 0.35) / 0.12 * Math.PI) * 0.25;
    }
    this._ekgAcc = (this._ekgAcc || 0) + dt;
    while (this._ekgAcc > 1 / 45) { this._ekgAcc -= 1 / 45; this.ekg[this.ekgI = (this.ekgI + 1) % this.ekg.length] = v; }
    // draw
    if (l.watchRaised > 0.05 || Math.random() < 0.05) this.screen.draw(dt, (ctx, w, h, pal, t) => this._present(ctx, w, h, t));
    else this.screen.time += dt;
  }

  // a quest or a purchase installed an app: tell the clone about it
  _appsChanged() {
    if (!this.econ) { this._known = null; return; }
    const list = this.installed();
    if (this._known) {
      for (const id of list) {
        if (this._known.includes(id)) continue;
        const a = appMeta(id);
        this.notify(`APP INSTALLED: ${a?.name || id.toUpperCase()}. Raise the watch, Q/E to switch.`, 'good', 'WATCH OS');
        if (audio.ready) audio.play('radio_beep', { volume: 0.4, bus: 'ui' });
      }
    }
    this._known = list;
  }

  _autoNotices(dt) {
    const g = this.game;
    const l = g.local;
    if (g.state !== 'playing' || l.dead) return;
    // item in hand changed: glance at the wrist to read what it is
    const inv = l.inv;
    if (inv && inv.selected !== this._lastSel) {
      const first = this._lastSel < 0;
      this._lastSel = inv.selected;
      const cur = inv.current;
      if (!first && cur && this.peekT < 1) { this.notices.unshift({ text: `HOLDING: ${itemName(cur.type)}`, kind: '', from: `SLOT ${inv.selected + 1}`, n: 1, t: Date.now() }); this.notices.length = Math.min(this.notices.length, 4); this.peekT = 1.4; }
    }
    // evacuation countdown: check the wrist regularly
    const m = g.world.level?.mission;
    if (m?.state?.exit && !m.state.exit.done && m.exitTimeLeft) {
      this._exitPeekT -= dt;
      const left = Math.ceil(m.exitTimeLeft());
      if (this._exitPeekT <= 0 || (left <= 10 && this._exitPeekT <= 6)) {
        this._exitPeekT = left <= 30 ? 8 : 18;
        this.notify(`EVACUATE! EXIT CLOSES IN ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, 'bad', 'EXIT');
      }
    }
    // vitals alarm
    this._hurtPeekT -= dt;
    const s = l.survival;
    if (this._hurtPeekT <= 0 && (s.health < 25 || s.bleed >= 2)) {
      this._hurtPeekT = 40;
      this.notify(s.bleed >= 2 ? 'HEAVY BLEEDING. APPLY BANDAGE.' : `VITALS CRITICAL. HP ${Math.round(s.health)}`, 'bad', 'MEDICAL');
    }
  }

  // ------------------------------------------------------------------ presentation
  // the apps draw their LCD ink onto a clear layer in watch units (transform scale S, text at whole device pixel
  // sizes), then face() lays it over the painted, backlit ground
  _present(c, w, h, t) {
    const k = this.lctx;
    k.setTransform(1, 0, 0, 1, 0, 0);
    k.clearRect(0, 0, w, h);
    begin(k);
    k.setTransform(S, 0, 0, S, 0, 0);
    this._draw(k, t);
    const l = this.game.local;
    face(c, this.layer, t, l?.dead ? 0.35 : 1);
  }

  _draw(c, t) {
    const g = this.game;
    const l = g.local;
    const glance = this.peeking && !l.watchOpen;
    // title bar: < APP > and page dots
    const list = this.installed();
    const meta = appMeta(this.app);
    const name = glance ? 'NOTICE' : meta?.name || this.app.toUpperCase();
    if (!glance) {
      const nw = tw(c, name, M);
      txt(c, '<', 3, 2, M, DIM);
      txt(c, name, 10, 2, M, INK);
      txt(c, '>', 12 + nw, 2, M, DIM);
      rule(c, 2, 18 + nw, 11, DIM);
      for (let i = 0; i < list.length; i++) {
        const x = AW - 5.5 - (list.length - 1 - i) * 5;
        if (list[i] === this.app) dot(c, x, 5.5, 1.6, INK); else dot(c, x, 6, 0.8, DIM);
      }
    } else { txt(c, name, 4, 2, M, INK); rule(c, 2, 8 + tw(c, name, M), 11, DIM); }
    // day + clock
    txt(c, g.day?.active ? `DAY ${g.day.day}` : '', 4, 14, M, INK);
    txt(c, g.day?.active ? g.day.leftString() : this._clock(), AW - 4, 14, M, INK, 'right');
    rule(c, 2, AW - 2, 22.5, LINE, 0.25);
    const y0 = 25;
    if (glance) { this._notice(c, t, y0); return; }
    this._app(c, t, y0);
    // a notice that arrives while the watch is up runs as a banner along the bottom
    if (this.peeking && this.notices[0]) {
      const n = this.notices[0];
      const bad = n.kind === 'bad' || n.kind === 'warn';
      erase(c, 0, AH - 11, AW, 11);
      rule(c, 0, AW, AH - 11, bad ? RED : DIM);
      const msg = `${n.from ? n.from + ': ' : ''}${n.text}`;
      const mw = tw(c, msg, M);
      const x = mw > AW - 6 ? AW - ((t * 30) % (mw + AW)) : 3;
      txt(c, msg, x, AH - 9, M, bad ? RED : INK);
    }
  }

  _notice(c, t, y0) {
    const n = this.notices[0];
    if (!n) return;
    const bad = n.kind === 'bad' || n.kind === 'warn';
    dot(c, 6.5, y0 + 3.5, 2.5, bad ? RED : INK);
    txt(c, `${(n.from || 'NOTICE').toUpperCase()}${n.n > 1 ? ' X' + n.n : ''}`, 12, y0, M, bad ? RED : DIM, 'left', AW - 16);
    // big type: the glance is short and the watch face small on a phone
    let size = L, lh = 16, max = 4;
    let lines = wrap(c, n.text, AW - 8, L);
    if (lines.length > 4) { size = 13; lh = 12; max = 6; lines = wrap(c, n.text, AW - 8, size); }
    if (lines.length > 6) { size = M; lh = 9; max = 8; lines = wrap(c, n.text, AW - 8, M); }
    for (let i = 0; i < lines.length && i < max; i++) txt(c, lines[i], 4, y0 + 10 + i * lh, size, INK, 'left', AW - 8);
    // vitals strip
    const s = this.game.local.survival;
    const low = s.health < 30;
    icon(c, 'heart', 6.5, AH - 5.5, 2.5, low ? RED : DIM, true);
    bar(c, 11, AH - 7, 50, 3, s.health / 100, low ? RED : INK);
  }

  // the watch's own time (a real watch keeps time even where the days do not)
  _clock() {
    const d = new Date();
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // one app's face: a registered drawing, the entry's own draw(), a built-in face, or a plain card
  _app(c, t, y0) {
    const id = this.app, meta = appMeta(id);
    const fn = DRAW[id] || meta?.draw;
    if (fn) { try { fn(c, KIT, t, y0, this); } catch (e) { console.error('[watch] app', id, e); } return; }
    const b = BUILTIN[id];
    if (b) { this[b](c, t, y0); return; }
    icon(c, meta?.icon || 'home', AW / 2, y0 + 28, 12, INK);
    txt(c, meta?.name || id.toUpperCase(), AW / 2, y0 + 48, L, INK, 'center', AW - 8);
    if (meta?.via) txt(c, meta.via, AW / 2, y0 + 70, SM, DIM, 'center', AW - 8);
  }

  // ------------------------------------------------------------------ HOME: launcher grid
  _home(c, t, y0) {
    const cols = 4, cw = 38, ch = 30, x0 = 3;
    const inst = this.installed();
    const next = inst[(this.tabIdx + 1) % inst.length];
    const apps = APPS.filter((x) => x.id !== 'home').slice(0, 8);
    for (let i = 0; i < apps.length; i++) {
      const app = apps[i];
      const x = x0 + (i % cols) * (cw + 1), y = y0 + Math.floor(i / cols) * (ch + 2);
      const on = inst.includes(app.id);
      if (app.id === next) frame(c, x, y, cw, ch, DIM); // where E goes next
      icon(c, app.icon, x + cw / 2, y + 8.5, 4.5, on ? INK : LINE);
      if (!on) icon(c, 'lock', x + cw - 4.5, y + 4.5, 2.2, DIM);
      txt(c, app.name, x + cw / 2, y + 18, SM, on ? INK : DIM, 'center', cw - 3);
      if (!on && app.via) txt(c, app.via, x + cw / 2, y + 24, SM, DIM, 'center', cw - 3);
    }
    const by = y0 + 2 * (ch + 2) + 2;
    rule(c, 2, AW - 2, by, LINE, 0.25);
    txt(c, input.touch ? 'ARROWS: APPS' : 'Q / E: APPS', AW - 4, by + 4, SM, DIM, 'right');
  }

  // ------------------------------------------------------------------ STATUS
  _status(c, t, y0) {
    const s = this.game.local.survival;
    // the survival model in two columns: body on the left, comfort on the right
    for (let i = 0; i < VITALS.length; i++) {
      const [ic, name, get, low] = VITALS[i];
      let f = get(s);
      f = Math.max(0, Math.min(1, Number.isFinite(f) ? f : 1));
      const warn = f * 100 < low;
      const x0 = i < 3 ? 3 : 83, y = y0 + (i % 3) * 14;
      icon(c, ic, x0 + 3, y + 3.5, 2.4, warn ? RED : DIM, true);
      txt(c, name, x0 + 8, y, SM, warn ? RED : INK);
      txt(c, `${Math.round(f * 100)}`, x0 + 73, y, SM, warn ? RED : DIM, 'right');
      bar(c, x0 + 8, y + 7.5, 65, 2.5, f, warn ? RED : INK);
    }
    // EKG
    const ey = y0 + 44, eh = 24, n = this.ekg.length, ew = AW - 52;
    frame(c, 2, ey, AW - 4, eh, LINE);
    c.fillStyle = TRACK;
    for (let x = 6; x < 4 + ew; x += 8) c.fillRect(x, ey + 1, 0.25, eh - 2);
    c.strokeStyle = INK;
    c.lineWidth = 0.5;
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const v = this.ekg[(this.ekgI + 1 + i) % n];
      const x = 4 + i / (n - 1) * (ew - 2), y = ey + eh / 2 + 2 - v * (eh / 2 - 3);
      if (i) c.lineTo(x, y); else c.moveTo(x, y);
    }
    c.stroke();
    const hr = Math.round(s.heartRate || 72);
    icon(c, 'heart', AW - 41.5, ey + 5.5, 2.5, hr > 140 ? RED : DIM, true);
    txt(c, 'BPM', AW - 6, ey + 3, SM, DIM, 'right');
    txt(c, `${hr}`, AW - 6, ey + 11, M, hr > 140 ? RED : INK, 'right');
    // conditions
    const conds = s.conditions ? s.conditions() : [];
    const line = conds.length ? conds.slice(0, 2).join(' · ') : 'ALL VITALS NOMINAL';
    txt(c, line.toUpperCase().slice(0, 30), 3, AH - 9, M, conds.length ? RED : DIM, 'left', AW - 6);
  }

  // ------------------------------------------------------------------ MAP
  _map(c, t, y0) {
    const g = this.game;
    const lvl = g.world.level;
    const l = g.local;
    if (!lvl?.visited) {
      icon(c, 'map', AW / 2, y0 + 24, 10, DIM);
      txt(c, 'NO MAP HERE', AW / 2, y0 + 40, M, INK, 'center');
      txt(c, 'IT DRAWS ITSELF AS YOU WALK', AW / 2, y0 + 52, SM, DIM, 'center', AW - 8);
      return;
    }
    const top = y0, bot = AH - 2;
    const cx = Math.floor(l.pos.x / CELL), cz = Math.floor(l.pos.z / CELL);
    const R = 7;
    const cs = 7;
    const mx = AW / 2, my = (top + bot) / 2;
    // cell (i, j) has its corner at (ox + (i - cx) * cs, oy + (j - cz) * cs); the clone sits at (mx, my)
    const ox = mx - (l.pos.x / CELL - cx) * cs, oy = my - (l.pos.z / CELL - cz) * cs;
    c.save();
    c.beginPath();
    c.rect(2, top, AW - 4, bot - top);
    c.clip();
    // explored floor (faint) and its walls (thin dim lines, one path)
    const vf = lvl.variantFn;
    c.fillStyle = TRACK;
    c.beginPath();
    for (let dj = -R; dj <= R; dj++) {
      for (let di = -R - 4; di <= R + 4; di++) {
        const i = cx + di, j = cz + dj;
        if (!lvl.visited.has(`${i},${j}`)) continue;
        const x = ox + di * cs, y = oy + dj * cs;
        c.fillRect(x, y, cs, cs);
        const n = lvl.mapWall ? lvl.mapWall(i, j, false) : wallN(lvl.seed, i, j, vf), wv = lvl.mapWall ? lvl.mapWall(i, j, true) : wallW(lvl.seed, i, j, vf);
        if (n && n !== W.ARCH) { c.moveTo(x, y); c.lineTo(x + cs, y); }
        if (wv && wv !== W.ARCH) { c.moveTo(x, y); c.lineTo(x, y + cs); }
      }
    }
    c.strokeStyle = DIM;
    c.lineWidth = 0.5;
    c.stroke();
    const m = lvl.mission;
    if (m) {
      for (const gen of m.generators || []) {
        const p = gen.root.position;
        const known = lvl.visited.has(`${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`) || g.day.day >= 2;
        if (!known) continue;
        const x = ox + (p.x / CELL - cx) * cs, y = oy + (p.z / CELL - cz) * cs;
        c.fillStyle = gen.running ? INK : RED;
        c.fillRect(x - 2.5, y - 2.5, 5, 5);
        erase(c, x - 0.75, y - 0.75, 1.5, 1.5);
      }
      const radio = m.radio?.();
      if (radio) {
        const p = radio.root.position;
        frame(c, ox + (p.x / CELL - cx) * cs - 2.5, oy + (p.z / CELL - cz) * cs - 2.5, 5, 5, INK, 0.5);
      }
      let marks = [];
      try { marks = m.markers?.() || []; } catch (e) { marks = []; }
      let exitMarked = false;
      for (const mk of marks) {
        if (mk.kind === 'exit') exitMarked = true;
        this._marker(c, t, mk, ox + (mk.pos.x / CELL - cx) * cs, oy + (mk.pos.z / CELL - cz) * cs, mx, my, top, bot);
      }
      if (m.state?.exit && !exitMarked) {
        const x = ox + (m.state.exit.x / CELL - cx) * cs, y = oy + (m.state.exit.z / CELL - cz) * cs;
        dot(c, x, y, 3, INK);
        if (x + 5 >= 2 && x + 5 < AW - 2 && y - 3 >= top && y - 3 < bot) txt(c, 'EXIT', x + 5, y - 3, SM, INK);
      }
    }
    for (const r of g.remotes.values()) {
      if (!r.inWorld) continue;
      dot(c, ox + (r.pos.x / CELL - cx) * cs, oy + (r.pos.z / CELL - cz) * cs, 1.6, r.dead ? RED : INK);
    }
    // player arrow (rotated triangle: tip (0,-5), wings (+-3.5, 3.5), notch (0, 2))
    const ang = -l.yaw, ca = Math.cos(ang), sa = Math.sin(ang);
    c.fillStyle = INK;
    c.beginPath();
    c.moveTo(mx + 5 * sa, my - 5 * ca);
    c.lineTo(mx + 3.5 * ca - 3.5 * sa, my + 3.5 * sa + 3.5 * ca);
    c.lineTo(mx - 2 * sa, my + 2 * ca);
    c.lineTo(mx - 3.5 * ca - 3.5 * sa, my - 3.5 * sa + 3.5 * ca);
    c.closePath();
    c.fill();
    c.restore();
    // frame + compass
    frame(c, 1, top - 1, AW - 2, bot - top + 2, LINE);
    erase(c, AW - 12, top + 1, 9, 9);
    txt(c, 'N', AW - 7.5, top + 2, M, INK, 'center');
  }

  // a mission marker (camp / crusher / kiosk / file / gen / exit): a shape + label, or an arrow on the frame edge
  _marker(c, t, mk, x, y, mx, my, top, bot) {
    const label = String(mk.label || mk.kind).toUpperCase();
    const Lx = 4, Rx = AW - 5, T = top + 2, B = bot - 3;
    if (x >= Lx + 3 && x <= Rx - 3 && y >= T + 3 && y <= B - 3) {
      c.fillStyle = INK;
      if (mk.kind === 'camp') { c.beginPath(); c.moveTo(x - 4, y + 3); c.lineTo(x, y - 4); c.lineTo(x + 4, y + 3); c.closePath(); c.fill(); }
      else if (mk.kind === 'pads' || mk.kind === 'crusher') { frame(c, x - 3.5, y - 3.5, 7, 7, INK, 0.5); c.fillRect(x - 1.5, y - 1.5, 3, 3); }
      else if (mk.kind === 'file') { c.fillRect(x - 2.5, y - 2, 5, 4); c.fillRect(x - 2.5, y - 3, 2, 1); }
      else if (mk.kind === 'gen') frame(c, x - 2.5, y - 2.5, 5, 5, INK, 0.5);
      else dot(c, x, y, 3, INK);
      if (mk.kind === 'file' || mk.kind === 'gen') return; // small pins: no label clutter
      const lw = tw(c, label, SM);
      const lx = x + 5 + lw < Rx ? x + 5 : x - 5 - lw;
      erase(c, lx - 1, y - 7, lw + 2, 7);
      txt(c, label, lx, y - 6, SM, INK);
      return;
    }
    if (mk.kind === 'file' || mk.kind === 'gen') return;
    // off the map: pin an arrow to the frame, pointing toward it
    const dx = x - mx, dy = y - my;
    const k = Math.min((dx > 0 ? Rx - mx : Lx - mx) / (dx || 1e-6), (dy > 0 ? B - my : T - my) / (dy || 1e-6));
    const ex = mx + dx * k, ey = my + dy * k;
    const ang = Math.atan2(dy, dx);
    c.fillStyle = INK;
    c.beginPath();
    c.moveTo(ex + Math.cos(ang) * 3, ey + Math.sin(ang) * 3);
    c.lineTo(ex + Math.cos(ang + 2.5) * 4, ey + Math.sin(ang + 2.5) * 4);
    c.lineTo(ex + Math.cos(ang - 2.5) * 4, ey + Math.sin(ang - 2.5) * 4);
    c.closePath();
    c.fill();
    const lw = tw(c, label, SM);
    const lx = Math.max(Lx, Math.min(Rx - lw, ex - lw / 2 - Math.cos(ang) * (lw / 2 + 5)));
    const ly = Math.max(T, Math.min(B - 5, ey - 2 - Math.sin(ang) * 7));
    erase(c, lx - 1, ly - 1, lw + 2, 7);
    txt(c, label, lx, ly, SM, INK);
  }

  // ------------------------------------------------------------------ RADIO
  _radio(c, t, y0) {
    // tuner strip
    rule(c, 2, AW - 2, y0 + 12, DIM);
    c.fillStyle = LINE;
    for (let x = 6; x < AW - 6; x += 6) c.fillRect(x, y0 + 9, 0.25, 3);
    vrule(c, 40 + Math.sin(t * 0.3) * 3, y0 + 1, y0 + 12, INK, 0.5);
    txt(c, 'BAND 98.6', AW - 6, y0 + 1, SM, INK, 'right');
    // spectrum
    c.fillStyle = DIM;
    for (let i = 0; i < 18; i++) {
      const h = 2 + Math.abs(Math.sin(t * (3 + i * 0.7) + i)) * 6;
      c.fillRect(4 + i * 3, y0 + 22 - h, 2, h);
    }
    txt(c, 'HEARD ON AIR', 64, y0 + 14, M, INK);
    let y = y0 + 24;
    for (let i = 0; i < this.messages.length && i < 6; i++) {
      const msg = this.messages[i];
      const line = `${(msg.from || '').slice(0, 9)}: ${msg.msg}`.toUpperCase();
      txt(c, line.slice(0, 38), 3, y, SM, msg.from === 'HQ' || msg.from === 'RECEPTION' ? INK : DIM, 'left', AW - 6);
      y += 8;
      if (y > AH - 8) break;
    }
    if (!this.messages.length) txt(c, '...STATIC...', AW / 2, y0 + 40, M, DIM, 'center');
  }

  dispose() {}
}

// built-in faces by app id (method names on Watch)
const BUILTIN = { home: '_home', status: '_status', map: '_map', radio: '_radio' };
// what a registered app's draw() gets: the face size, palette, type sizes and the drawing kit
const KIT = { AW, AH, S, INK, DIM, LINE, TRACK, RED, SM, M, L, txt, tw, wrap, rule, vrule, frame, bar, dot, ring, icon, bullet, erase };
