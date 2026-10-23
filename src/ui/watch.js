// The R.O.O.M. Corporate Wrist Terminal: a chunky retro watch on the clone's left wrist with APPS.
//   HOME     launcher grid: every app, installed or locked (how to get it)
//   STATUS   health, food, water, stamina + EKG          TASKS   main mission checklist + side quests
//   BANK     credits, ESCAPE FUND gauge, level rules     MAP     explored cells, camp, crusher, exit, quest pins
//   SCANNER  point the crosshair at creatures / fungus / loot: identify, appraise, study for research money
//   RADIO    HQ comms log on the R.O.O.M. band            FLASH+  flashlight overdrive status
// Apps come from game/economy.js WATCH_APPS; HOME, STATUS, TASKS and BANK are built in, the rest are installed
// by quests or bought at the company store (levels without an economy show STATUS / MAP / TASKS).
// Q / E cycle the installed apps while the watch is up. The face is pixel art: drawn at 160x120 with the kit's
// bitmap font, scaled x3 onto the canvas mapped onto the 3D watch screen, with a phosphor glow and LCD grid.
// Notices (HQ radio, pickups, warnings, achievements) make the watch beep and the clone glances at the wrist.
import * as THREE from 'three';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { engine } from '../core/engine.js';
import { CrtScreen } from './crt.js';
import { itemName } from '../game/itemdefs.js';
import { WATCH_APPS, short$, fmt$ } from '../game/economy.js';
import { Q, G, groups } from '../physics/physics.js';
import { CELL, wallN, wallW, W } from '../world/levels/yellow/layout.js';
import { Pix, text, textWidth, wrapText, FONT3, FONT5, bitmap } from './pixelart.js';

const LEGACY = ['status', 'map', 'tasks'];
const AW = 160, AH = 120, K = 3;

// phosphor palette (green terminal)
// monochrome phosphor (Pip-Boy style): every colour is an intensity of the same green
const P = { bg: '#020f05', fg: '#4dff7a', dim: '#1f9a40', faint: '#0c3a1a', hi: '#d8ffe0', bad: '#d8ffe0', badDim: '#1f9a40', warn: '#b8ffc8', cyan: '#8dffad', red: '#4dff7a' };

const MINI = {
  heart: ['.#.#.', '#####', '#####', '.###.', '..#..'],
  food: ['.##..', '#..#.', '####.', '.####', '..##.'],
  drop: ['..#..', '.###.', '#####', '#####', '.###.'],
  bolt: ['..##.', '.##..', '####.', '..##.', '.##..'],
  coin: ['.###.', '##.##', '#.#.#', '##.##', '.###.'],
  pulse: ['..#...', '..#...', '.#.#.#', '##..#.', '......'],
  map: ['##.##', '#.#.#', '#.#.#', '#.#.#', '##.##'],
  task: ['.###.', '#...#', '#.#.#', '#...#', '#####'],
  lock: ['.###.', '#...#', '#####', '##.##', '#####'],
  check: ['....#', '...#.', '#.#..', '.#...', '.....'],
};
// 9x9 app icons
const ICON = {
  home: ['....#....', '...###...', '..#####..', '.#######.', '#########', '.##...##.', '.##.#.##.', '.##.#.##.', '.#######.'],
  pulse: ['.........', '....#....', '....#....', '...#.#...', '#.##..#.#', '.#....##.', '.........', '.........', '.........'],
  task: ['.#######.', '.#.....#.', '.#.##..#.', '.#.....#.', '.#.###.#.', '.#.....#.', '.#.##..#.', '.#.....#.', '.#######.'],
  coin: ['..#####..', '.##...##.', '##..#..##', '#..###..#', '#...#...#', '#..###..#', '##..#..##', '.##...##.', '..#####..'],
  map: ['###.###..', '#.#.#.###', '#.###.#.#', '#.#.#.#.#', '#.#.###.#', '###.#.#.#', '..#.#.###', '..###.#..', '......#..'],
  scan: ['##.....##', '#.......#', '...###...', '..#...#..', '..#.#.#..', '..#...#..', '...###...', '#.......#', '##.....##'],
  radio: ['......#..', '.....#...', '#########', '#.......#', '#.###.#.#', '#.###...#', '#.###.#.#', '#.......#', '#########'],
  bolt: ['....###..', '...###...', '..###....', '.######..', '...###...', '..###....', '.##......', '.#.......', '.........'],
};

const _fwd = new THREE.Vector3();

export class Watch {
  constructor(game) {
    this.game = game;
    this.screen = new CrtScreen(AW * K, AH * K, 'green');
    this.screen.fps = 15;
    this.art = new Pix(AW, AH);
    this.artCv = document.createElement('canvas');
    this.artCv.width = AW; this.artCv.height = AH;
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
    this.scan = { target: null, kind: null, prog: 0, sent: null, sweep: 0, beepT: 0 };
    this.attach(game.local.arms);
  }

  get econ() { const m = this.game.world?.level?.mission; return m?.econ && !m.econ.disposed ? m.econ : null; }

  // installed app ids in launcher order
  installed() {
    const e = this.econ;
    if (!e) return LEGACY;
    return WATCH_APPS.filter((a) => e.appInstalled(a.id)).map((a) => a.id);
  }

  get tab() { return this.app; }
  get tabs() { return this.installed().map((id) => WATCH_APPS.find((a) => a.id === id)?.name || id.toUpperCase()); }
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
      this.screen.attach(arms.watchScreen, 1.5);
      arms.watchScreen.material.toneMapped = true;
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
    if (this.app === 'scanner') this._scanUpdate(dt);
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
        const a = WATCH_APPS.find((x) => x.id === id);
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

  // ------------------------------------------------------------------ SCANNER logic
  _scanUpdate(dt) {
    const g = this.game, l = g.local, e = this.econ, sc = this.scan;
    sc.sweep += dt;
    if (!e || !l.watchOpen || l.dead) { sc.prog = Math.max(0, sc.prog - dt); return; }
    const cam = engine.camera;
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    // creatures and fungus: the bestiary study API (game/bio.js); its completion calls game.onStudy -> research pay
    const mon = g.world.monsters;
    let bio = null;
    try { bio = mon?.study ? mon.study({ origin: cam.position, dir: _fwd, range: 14 }, dt) : null; } catch (err) { bio = null; }
    if (bio) {
      const kind = 'sp_' + bio.species;
      if (kind !== sc.kind) { sc.kind = kind; sc.sent = null; }
      sc.target = { kind, label: String(bio.name || bio.species).toUpperCase(), cat: bio.kind === 'fungus' ? 'bio' : 'mon', info: bio.hostile ? 'HOSTILE ENTITY' : bio.kind === 'fungus' ? 'FUNGUS' : bio.tame ? 'TAMEABLE FAUNA' : 'FAUNA', bio: true, studiedBio: !!bio.studied };
      sc.prog = bio.progress ?? 0;
      sc.dist = bio.dist || 0;
      if (bio.done) { sc.sent = kind; if (audio.ready) audio.play('radio_beep', { volume: 0.4, bus: 'ui' }); }
      else if (!bio.studied) { sc.beepT -= dt; if (sc.beepT <= 0 && audio.ready) { sc.beepT = 0.18; audio.play('watch_beep', { volume: 0.12, bus: 'ui', pitch: 1 + sc.prog * 0.8 }); } }
      return;
    }
    const hit = g.world.physics.raycast(cam.position, _fwd, 14, Q.all & ~groups(0, G.PLAYER), null, (c) => c !== l.collider && !l._isGrabbedCollider?.(c));
    const t = e.identify(hit);
    sc.dist = hit ? hit.dist ?? hit.toi ?? 0 : 0;
    if (!t) { sc.target = null; sc.prog = Math.max(0, sc.prog - dt * 1.5); return; }
    if (t.kind !== sc.kind) { sc.kind = t.kind; sc.prog = 0; }
    sc.target = t;
    if (e.studied(t.kind) || sc.sent === t.kind) return;
    sc.prog += dt / t.time;
    sc.beepT -= dt;
    if (sc.beepT <= 0 && audio.ready) { sc.beepT = 0.18; audio.play('watch_beep', { volume: 0.12, bus: 'ui', pitch: 1 + sc.prog * 0.8 }); }
    if (sc.prog >= 1) {
      sc.sent = t.kind;
      e.requestScan(t);
      if (audio.ready) audio.play('radio_beep', { volume: 0.4, bus: 'ui' });
    }
  }

  // ------------------------------------------------------------------ presentation
  _present(ctx, w, h, t) {
    const a = this.art;
    a.clear();
    this._draw(a, t);
    a.toCanvas(this.artCv);
    ctx.imageSmoothingEnabled = false;
    ctx.shadowColor = 'rgba(77,255,122,0.85)';
    ctx.shadowBlur = 7;
    ctx.drawImage(this.artCv, 0, 0, w, h);
    ctx.shadowBlur = 0;
    // LCD dot grid between art pixels
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    for (let x = 0; x < w; x += K) ctx.fillRect(x, 0, 1, h);
    for (let y = 2; y < h; y += K) ctx.fillRect(0, y, w, 1);
  }

  _draw(a, t) {
    const g = this.game;
    const l = g.local;
    const glance = this.peeking && !l.watchOpen;
    // faint background raster
    for (let y = 22; y < AH; y += 4) for (let x = 2; x < AW; x += 4) a.set(x, y, P.faint);
    // title bar: < APP > and page dots
    const list = this.installed();
    const meta = WATCH_APPS.find((x) => x.id === this.app);
    const name = glance ? 'NOTICE' : meta?.name || this.app.toUpperCase();
    if (!glance) {
      const nw = textWidth(name, FONT5);
      text(a, '<', 3, 2, P.dim);
      text(a, name, 10, 2, P.hi);
      text(a, '>', 12 + nw, 2, P.dim);
      rulePx(a, 2, 18 + nw, 11, P.fg);
      list.forEach((id, i) => {
        const x = AW - 6 - (list.length - 1 - i) * 5;
        if (id === this.app) a.rect(x - 1, 3, 3, 5, P.hi); else a.rect(x, 6, 1, 2, P.dim);
      });
    } else { text(a, name, 4, 2, P.hi); rulePx(a, 2, 8 + textWidth(name, FONT5), 11, P.fg); }
    // day + clock
    const day = g.day?.active ? `DAY ${g.day.day}/7` : 'HQ  B4';
    text(a, day, 4, 14, P.hi);
    const clk = g.day?.active ? g.day.leftString() : 'ON SHIFT';
    text(a, clk, AW - 4, 14, P.fg, { align: 'right' });
    a.hline(2, AW - 3, 22, P.dim);
    const y0 = 25;
    if (glance) { this._notice(a, t, y0); return; }
    switch (this.app) {
      case 'home': this._home(a, t, y0); break;
      case 'status': this._status(a, t, y0); break;
      case 'map': this._map(a, t, y0); break;
      case 'tasks': this._tasks(a, t, y0); break;
      case 'bank': this._bank(a, t, y0); break;
      case 'scanner': this._scanner(a, t, y0); break;
      case 'radio': this._radio(a, t, y0); break;
      case 'flash': this._flash(a, t, y0); break;
      default: break;
    }
    // a notice that arrives while the watch is up runs as a banner along the bottom
    if (this.peeking && this.notices[0]) {
      const n = this.notices[0];
      const bad = n.kind === 'bad' || n.kind === 'warn';
      a.rect(0, AH - 11, AW, 11, P.bg);
      a.hline(0, AW - 1, AH - 11, bad ? P.bad : P.fg);
      const msg = `${n.from ? n.from + ': ' : ''}${n.text}`;
      const mw = textWidth(msg, FONT5);
      const x = mw > AW - 6 ? Math.round(AW - ((t * 30) % (mw + AW))) : 3;
      text(a, msg, x, AH - 9, bad ? P.bad : P.hi);
    }
  }

  _notice(a, t, y0) {
    const n = this.notices[0];
    if (!n) return;
    const bad = n.kind === 'bad' || n.kind === 'warn';
    const col = P.hi;
    if (Math.floor(t * 4) % 2 || !bad) { a.rect(4, y0 + 1, 5, 5, bad ? P.bad : P.fg); a.set(5, y0 + 2, P.hi); }
    text(a, `${(n.from || 'NOTICE').toUpperCase()}${n.n > 1 ? ' X' + n.n : ''}`, 12, y0, bad ? P.bad : P.fg);
    // big type: the glance is short and the watch face small on a phone
    let sc = 2;
    let wrapped = wrapLines(n.text, (AW - 8) / 2);
    if (wrapped.length > 4) { sc = 1; wrapped = wrapText(n.text, AW - 8); }
    const lh = sc === 2 ? 16 : 9;
    wrapped.slice(0, sc === 2 ? 4 : 8).forEach((ln, i) => text(a, ln, 4, y0 + 10 + i * lh, col, { scale: sc }));
    // vitals strip
    const s = this.game.local.survival;
    glyphMini(a, 'heart', 4, AH - 8, s.health < 30 ? P.bad : P.fg);
    segBar(a, 11, AH - 9, 50, 7, s.health / 100, s.health < 30 ? P.bad : P.fg);
    glyphMini(a, 'coin', AW - 8, AH - 8, P.warn);
    text(a, short$(this.game.run?.credits ?? 0), AW - 11, AH - 9, P.hi, { align: 'right' });
  }

  // ------------------------------------------------------------------ HOME: launcher grid
  _home(a, t, y0) {
    const e = this.econ;
    const apps = WATCH_APPS.filter((x) => x.id !== 'home');
    const cols = 4, tw = 38, th = 30, x0 = 3;
    const next = this.installed()[(this.tabIdx + 1) % this.installed().length];
    apps.forEach((app, i) => {
      const x = x0 + (i % cols) * (tw + 1), y = y0 + Math.floor(i / cols) * (th + 2);
      const on = e ? e.appInstalled(app.id) : LEGACY.includes(app.id);
      const hl = app.id === next && Math.floor(t * 2) % 2;
      if (hl) brk(a, x, y, tw, th, 4, P.hi);
      bitmap(ICON[app.icon] || ICON.home, { '#': on ? (hl ? P.hi : P.fg) : P.faint }, a, x + 15, y + 4);
      if (!on) bitmap(MINI.lock, { '#': P.dim }, a, x + tw - 7, y + 2);
      const nm = app.name.slice(0, 7);
      text(a, nm, x + Math.round((tw - textWidth(nm, FONT3)) / 2), y + 18, on ? P.hi : P.dim, { font: FONT3 });
      if (!on && app.via) { const v = app.via.slice(0, 9); text(a, v, x + Math.round((tw - textWidth(v, FONT3)) / 2), y + 24, P.faint, { font: FONT3 }); }
    });
    const by = y0 + 2 * (th + 2) + 2;
    a.hline(2, AW - 3, by, P.faint);
    glyphMini(a, 'coin', 4, by + 4, P.warn);
    text(a, fmt$(this.game.run?.credits ?? 0), 12, by + 3, P.hi);
    text(a, 'Q/E APPS', AW - 4, by + 3, P.dim, { align: 'right', font: FONT3 });
  }

  _status(a, t, y0) {
    const s = this.game.local.survival;
    const rows = [
      ['heart', 'HEALTH', (s.health ?? 100) / 100, s.health < 30],
      ['food', 'FOOD', (s.hunger ?? 100) / 100, s.hunger < 25],
      ['drop', 'WATER', (s.thirst ?? 100) / 100, s.thirst < 25],
      ['bolt', 'STAMINA', (s.stamina ?? 40) / (s.maxStamina || 40), (s.stamina ?? 40) < 8],
    ];
    rows.forEach(([ic, label, f, warn], i) => {
      const y = y0 + i * 12;
      const blink = warn && Math.floor(t * 3) % 2;
      const c = warn ? (blink ? P.badDim : P.bad) : P.fg;
      glyphMini(a, ic, 3, y + 1, c);
      text(a, label, 11, y, warn ? P.bad : P.hi);
      segBar(a, 56, y, 82, 7, f, c);
      text(a, `${Math.round(Math.max(0, Math.min(1, f)) * 100)}`, AW - 3, y + 1, warn ? P.bad : P.dim, { font: FONT3, align: 'right' });
    });
    // EKG
    const ey = y0 + 50, eh = 26;
    brk(a, 2, ey, AW - 4, eh, 5, P.dim);
    for (let x = 6; x < AW - 4; x += 8) a.vline(x, ey + 1, ey + eh - 2, P.faint);
    const n = this.ekg.length, ew = AW - 52;
    let px = -1, py = -1;
    for (let i = 0; i < n; i++) {
      const v = this.ekg[(this.ekgI + 1 + i) % n];
      const x = 4 + Math.round(i / (n - 1) * (ew - 2)), y = ey + Math.round(eh / 2 + 2 - v * (eh / 2 - 3));
      if (px >= 0) a.line(px, py, x, y, i > n - 4 ? P.hi : P.fg);
      px = x; py = y;
    }
    const hr = Math.round(s.heartRate || 72);
    text(a, 'BPM', AW - 6, ey + 3, P.dim, { font: FONT3, align: 'right' });
    text(a, `${hr}`, AW - 6, ey + 10, hr > 140 ? P.bad : P.hi, { align: 'right', scale: 1 });
    if (Math.floor(t * (hr / 30)) % 2) glyphMini(a, 'heart', AW - 44, ey + 3, P.bad);
    // conditions
    const conds = s.conditions ? s.conditions() : [];
    const line = conds.length ? conds.slice(0, 2).join(' · ') : 'ALL VITALS NOMINAL';
    text(a, line.toUpperCase().slice(0, 30), 3, AH - 9, conds.length ? (Math.floor(t * 2) % 2 ? P.bad : P.badDim) : P.dim);
  }

  _map(a, t, y0) {
    const g = this.game;
    const lvl = g.world.level;
    const l = g.local;
    if (!lvl?.visited) {
      text(a, 'HQ FLOORPLAN', 4, y0 + 2, P.hi);
      text(a, 'SUBLEVEL B4 - NO MAPPING', 4, y0 + 14, P.fg);
      const rooms = ['RECEPTION + ELEVATOR', 'OFFICE', 'LOCKERS', 'BREAK ROOM', 'CLONING LAB', 'LOADING BAY'];
      rooms.forEach((r, i) => { a.rect(6, y0 + 28 + i * 10, 3, 3, P.dim); text(a, r, 13, y0 + 26 + i * 10, P.dim); });
      return;
    }
    const top = y0, bot = AH - 2;
    const cx = Math.floor(l.pos.x / CELL), cz = Math.floor(l.pos.z / CELL);
    const R = 7;
    const cs = 7;
    const mx = AW / 2, my = (top + bot) / 2;
    const ox = Math.round(mx - cs / 2 - (l.pos.x / CELL - cx - 0.5) * cs), oy = Math.round(my - cs / 2 - (l.pos.z / CELL - cz - 0.5) * cs);
    const inside = (x, y) => x >= 2 && x < AW - 2 && y >= top && y < bot;
    const put = (x, y, c) => { if (inside(x, y)) a.set(x, y, c); };
    const hl = (x0, x1, y, c) => { for (let x = x0; x <= x1; x++) put(x, y, c); };
    const vl = (x, y0_, y1, c) => { for (let y = y0_; y <= y1; y++) put(x, y, c); };
    for (let dj = -R; dj <= R; dj++) {
      for (let di = -R - 4; di <= R + 4; di++) {
        const i = cx + di, j = cz + dj;
        if (!lvl.visited.has(`${i},${j}`)) continue;
        const x = ox + di * cs, y = oy + dj * cs;
        for (let yy = 1; yy < cs; yy++) for (let xx = 1; xx < cs; xx++) if ((xx + yy) % 2 === 0) put(x + xx, y + yy, P.faint);
        const vf = lvl.variantFn;
        const n = lvl.mapWall ? lvl.mapWall(i, j, false) : wallN(lvl.seed, i, j, vf), wv = lvl.mapWall ? lvl.mapWall(i, j, true) : wallW(lvl.seed, i, j, vf);
        if (n && n !== W.ARCH) hl(x, x + cs, y, P.fg);
        if (wv && wv !== W.ARCH) vl(x, y, y + cs, P.fg);
      }
    }
    const toMap = (p) => [Math.round(ox + (p.x / CELL - cx) * cs), Math.round(oy + (p.z / CELL - cz) * cs)];
    const m = lvl.mission;
    if (m) {
      for (const gen of m.generators || []) {
        const known = lvl.visited.has(`${Math.floor(gen.root.position.x / CELL)},${Math.floor(gen.root.position.z / CELL)}`) || g.day.day >= 2;
        if (!known) continue;
        const [x, y] = toMap(gen.root.position);
        for (let yy = -2; yy <= 2; yy++) for (let xx = -2; xx <= 2; xx++) put(x + xx, y + yy, gen.running ? P.hi : P.bad);
        put(x, y, P.bg);
      }
      const radio = m.radio?.();
      if (radio) {
        const [x, y] = toMap(radio.root.position);
        hl(x - 2, x + 2, y - 2, P.cyan); hl(x - 2, x + 2, y + 2, P.cyan); vl(x - 2, y - 2, y + 2, P.cyan); vl(x + 2, y - 2, y + 2, P.cyan);
      }
      let marks = [];
      try { marks = m.markers?.() || []; } catch (e) { marks = []; }
      for (const mk of marks) this._marker(a, t, mk, toMap(mk.pos), mx, my, top, bot);
      if (m.state?.exit && !marks.some((mk) => mk.kind === 'exit')) {
        const [x, y] = toMap(new THREE.Vector3(m.state.exit.x, 0, m.state.exit.z));
        if (Math.floor(t * 3) % 2) for (let yy = -3; yy <= 3; yy++) for (let xx = -3; xx <= 3; xx++) if (xx * xx + yy * yy <= 9) put(x + xx, y + yy, P.warn);
        if (inside(x + 5, y - 3)) text(a, 'EXIT', x + 5, y - 3, P.warn, { font: FONT3 });
      }
    }
    for (const r of g.remotes.values()) {
      if (!r.inWorld) continue;
      const [x, y] = toMap(r.pos);
      for (const [xx, yy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) put(x + xx, y + yy, r.dead ? P.bad : P.cyan);
    }
    // player arrow (rotated triangle)
    const ang = -l.yaw;
    const pts = [[0, -5], [3.5, 3.5], [0, 2], [-3.5, 3.5]].map(([x, y]) => [mx + x * Math.cos(ang) - y * Math.sin(ang), my + x * Math.sin(ang) + y * Math.cos(ang)]);
    a.poly(pts, P.hi);
    a.set(Math.round(mx), Math.round(my), P.fg);
    // frame + compass
    brk(a, 1, top - 1, AW - 2, bot - top + 2, 6, P.dim);
    a.rect(AW - 12, top + 1, 9, 9, P.bg);
    text(a, 'N', AW - 10, top + 2, P.hi);
  }

  // a mission marker (camp / crusher / kiosk / file / gen / exit): an icon + label, or an arrow on the frame edge
  _marker(a, t, mk, [x, y], mx, my, top, bot) {
    const col = mk.kind === 'exit' ? P.warn : mk.kind === 'pads' || mk.kind === 'crusher' ? P.cyan : mk.kind === 'file' || mk.kind === 'gen' ? P.warn : P.hi;
    const label = String(mk.label || mk.kind).toUpperCase();
    const L = 4, R = AW - 5, T = top + 2, B = bot - 3;
    if (x >= L + 3 && x <= R - 3 && y >= T + 3 && y <= B - 3) {
      if (mk.kind === 'camp') a.poly([[x - 4, y + 3], [x, y - 4], [x + 4, y + 3]], col);
      else if (mk.kind === 'pads' || mk.kind === 'crusher') { a.frame(x - 3, y - 3, 7, 7, col); a.rect(x - 1, y - 1, 3, 3, col); }
      else if (mk.kind === 'file') { a.rect(x - 2, y - 2, 5, 4, col); a.set(x - 2, y - 3, col); a.set(x - 1, y - 3, col); }
      else if (mk.kind === 'gen') { a.frame(x - 2, y - 2, 5, 5, col); if (Math.floor(t * 2) % 2) a.set(x, y, col); }
      else if (Math.floor(t * 3) % 2) a.disc(x + 0.5, y + 0.5, 3.2, col);
      else a.ring(x + 0.5, y + 0.5, 3.6, col);
      if (mk.kind === 'file' || mk.kind === 'gen') return; // small pins: no label clutter
      const lw = textWidth(label, FONT3);
      const lx = x + 5 + lw < R ? x + 5 : x - 5 - lw;
      a.rect(lx - 1, y - 7, lw + 2, 7, P.bg);
      text(a, label, lx, y - 6, col, { font: FONT3 });
      return;
    }
    if (mk.kind === 'file' || mk.kind === 'gen') return;
    // off the map: pin an arrow to the frame, pointing toward it
    const dx = x - mx, dy = y - my;
    const k = Math.min((dx > 0 ? R - mx : L - mx) / (dx || 1e-6), (dy > 0 ? B - my : T - my) / (dy || 1e-6));
    const ex = Math.round(mx + dx * k), ey = Math.round(my + dy * k);
    const ang = Math.atan2(dy, dx);
    const pt = (r, o) => [ex + Math.cos(ang + o) * r, ey + Math.sin(ang + o) * r];
    a.poly([pt(3, 0), pt(4, 2.5), pt(4, -2.5)], col);
    const lw = textWidth(label, FONT3);
    const lx = Math.max(L, Math.min(R - lw, ex - lw / 2 - Math.cos(ang) * (lw / 2 + 5)));
    const ly = Math.max(T, Math.min(B - 5, ey - 2 - Math.sin(ang) * 7));
    a.rect(lx - 1, ly - 1, lw + 2, 7, P.bg);
    text(a, label, lx, ly, col, { font: FONT3 });
  }

  // ------------------------------------------------------------------ TASKS
  _tasks(a, t, y0) {
    const g = this.game;
    const m = g.world.level?.mission;
    const e = this.econ;
    if (!m) {
      let y = y0;
      text(a, 'HQ ORIENTATION', 4, y, P.hi);
      y += 11;
      for (const s of ['VISIT YOUR LOCKER', 'GRAB SNACKS: BREAK ROOM', 'READ THE ORIENTATION', 'HOST: START SHIFT', 'STEP INTO THE ELEVATOR']) {
        diamond(a, 7, y + 3, P.dim, false);
        text(a, s, 12, y, P.fg);
        y += 10;
      }
      return;
    }
    if (!e || !m.tasks) { this._legacyTask(a, t, y0); return; }
    let y = y0;
    const obj = m.objective?.();
    const main = e.main.filter((n) => n.id !== 'm_escape');
    const mainDone = e.mainDone();
    text(a, mainDone ? 'SIDE QUESTS' : 'MAIN MISSION 1', 4, y, P.hi);
    if (obj && !mainDone) text(a, obj.title.slice(0, 14), AW - 4, y, P.warn, { align: 'right', font: FONT3 });
    y += 10;
    if (!mainDone) {
      for (const n of main) {
        const st = e.state(n), done = st === 'claimed', cur = st === 'active';
        diamond(a, 7, y + 4, done ? P.fg : cur ? P.hi : P.dim, done || (cur && Math.floor(t * 3) % 2));
        text(a, (n.task || n.name).toUpperCase().slice(0, 26), 13, y, done ? P.dim : cur ? P.hi : P.fg);
        y += 10;
      }
      if (obj?.detail) {
        wrapText(obj.detail.toUpperCase(), AW - 8, FONT3).slice(0, 3).forEach((ln, i) => text(a, ln, 4, y + 2 + i * 7, P.fg, { font: FONT3 }));
        y += 23;
      }
      if (typeof obj?.progress === 'number') segBar(a, 4, Math.min(y, AH - 22), AW - 8, 7, obj.progress, P.fg);
    } else {
      const side = e.activeSide().slice(0, 5);
      if (!side.length) text(a, 'ALL QUESTS DONE. FILL THE FUND!', 4, y, P.fg, { font: FONT3 });
      for (const n of side) {
        const st = e.state(n), pr = e.progress(n);
        const ready = st === 'ready';
        text(a, n.short.slice(0, 13), 4, y, ready ? (Math.floor(t * 3) % 2 ? P.hi : P.warn) : P.fg);
        if (ready) text(a, 'CLAIM AT CAMP', AW - 4, y + 1, P.warn, { align: 'right', font: FONT3 });
        else { segBar(a, 76, y, 60, 7, pr.frac, P.fg); text(a, `${Math.round(pr.frac * 100)}`, AW - 3, y + 1, P.dim, { align: 'right', font: FONT3 }); }
        y += 10;
      }
    }
    // escape fund strip
    const by = AH - 20;
    a.hline(2, AW - 3, by - 3, P.faint);
    glyphMini(a, 'coin', 4, by + 1, P.warn);
    text(a, `${short$(e.escape)} / ${short$(e.quota)}`, 12, by, P.hi);
    text(a, 'ESCAPE', AW - 4, by, P.dim, { align: 'right', font: FONT3 });
    segBar(a, 4, by + 10, AW - 8, 7, e.escape / e.quota, e.escape >= e.quota ? P.hi : P.red);
  }

  // older dimensions (generator / radio mission): objective + checklist + money vs quota
  _legacyTask(a, t, y0) {
    const g = this.game;
    const m = g.world.level?.mission;
    let obj = null;
    try { obj = m?.objective?.() || null; } catch (e) { obj = null; }
    let y = y0;
    if (obj) {
      a.rect(3, y, 6, 7, P.fg); a.set(5, y + 2, P.bg); a.set(6, y + 3, P.bg); a.set(5, y + 4, P.bg);
      const title = wrapText(obj.title || 'OBJECTIVE', AW - 16);
      title.slice(0, 2).forEach((ln, i) => text(a, ln, 12, y + i * 9, P.hi));
      y += Math.min(2, title.length) * 9 + 2;
      if (obj.detail) {
        const det = wrapText(obj.detail, AW - 8);
        det.slice(0, 4).forEach((ln, i) => text(a, ln, 4, y + i * 9, P.fg));
        y += Math.min(4, det.length) * 9 + 2;
      }
      if (typeof obj.progress === 'number') {
        segBar(a, 4, y, AW - 30, 7, obj.progress, P.fg);
        text(a, `${Math.round(Math.max(0, Math.min(1, obj.progress)) * 100)}%`, AW - 4, y, P.hi, { align: 'right' });
        y += 11;
      }
    } else {
      for (const gen of m.generators || []) {
        const done = gen.running;
        diamond(a, 7, y + 3, done ? P.fg : P.dim, done);
        if (done) { a.set(5, y + 3, P.hi); a.set(6, y + 4, P.hi); a.set(7, y + 2, P.hi); }
        text(a, `REPAIR ${String(gen.label || 'GENERATOR').toUpperCase()}`.slice(0, 22), 12, y, done ? P.dim : P.fg);
        if (gen.state?.linked) text(a, 'LINK', AW - 4, y, P.hi, { align: 'right', font: FONT3 });
        y += 9;
      }
      if (m.state) {
        const ex = m.state.exit;
        diamond(a, 7, y + 3, m.state.extraction ? P.fg : P.dim, !!m.state.extraction);
        text(a, 'REQUEST EXTRACTION', 12, y, m.state.extraction ? P.dim : P.fg);
        y += 9;
        if (ex && !ex.done && m.exitTimeLeft) {
          const left = Math.ceil(m.exitTimeLeft());
          text(a, `EVACUATE ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, 4, y + 1, Math.floor(t * 3) % 2 ? P.bad : P.warn, { scale: 1 });
          y += 10;
        }
      }
    }
    const q = m.quota?.need;
    const cr = g.run?.credits ?? 0;
    const by = AH - 20;
    a.hline(2, AW - 3, by - 3, P.faint);
    glyphMini(a, 'coin', 4, by + 1, P.warn);
    text(a, q ? `${cr} / ${q} CR` : `${cr} CR`, 12, by, P.hi);
    if (q) {
      const met = cr >= q;
      text(a, met ? 'QUOTA MET' : 'QUOTA', AW - 4, by, met ? P.hi : P.dim, { align: 'right', font: FONT3 });
      segBar(a, 4, by + 10, AW - 8, 7, cr / q, met ? P.hi : P.warn);
    }
  }

  // ------------------------------------------------------------------ BANK
  _bank(a, t, y0) {
    const e = this.econ, run = this.game.run || {};
    text(a, 'CREDITS', 4, y0, P.dim, { font: FONT3 });
    text(a, fmt$(run.credits), 4, y0 + 7, P.hi, { scale: 2 });
    if (!e) return;
    const f = Math.min(1, e.escape / e.quota);
    // escape fund: a horizontal thermometer with a bulb
    const gy = y0 + 28;
    text(a, 'ESCAPE FUND', 4, gy, P.warn);
    text(a, `${Math.floor(f * 100)}%`, AW - 4, gy, f >= 1 ? (Math.floor(t * 3) % 2 ? P.hi : P.warn) : P.hi, { align: 'right' });
    const bx = 14, bw = AW - 20, by = gy + 10;
    a.disc(9, by + 4, 5, P.red);
    rulePx(a, bx, bx + bw, by + 8, P.dim);
    segBar(a, bx, by + 2, bw, 5, f, P.fg);
    for (let i = 1; i < 4; i++) a.vline(bx + Math.round(bw * i / 4), by + 9, by + 11, P.dim);
    text(a, `${fmt$(e.escape)} / ${short$(e.quota)}`, 4, by + 13, P.fg, { font: FONT3 });
    // level rules
    const r = e.rules, ry = by + 22;
    a.hline(2, AW - 3, ry, P.faint);
    text(a, `${r.name}: ${r.title}`.slice(0, 30), 4, ry + 3, P.hi, { font: FONT3 });
    text(a, `PRICES X${r.priceMul} · ${r.hazards[0]}`.slice(0, 38), 4, ry + 10, P.dim, { font: FONT3 });
    text(a, 'PURCHASES DO NOT DRAIN THE FUND', 4, ry + 17, P.dim, { font: FONT3 });
    const last = this.game.world?.level?.mission?.crusher?.lastSale;
    if (last) text(a, `LAST UPLOAD +${short$(last)}`, 4, AH - 9, P.fg);
  }

  // ------------------------------------------------------------------ SCANNER
  _scanner(a, t, y0) {
    const sc = this.scan, e = this.econ, tg = sc.target;
    const cx = AW / 2, cy = y0 + 30;
    // reticle brackets + sweeping line
    const R = 22;
    const isDone = (x) => !!x && (e?.studied(x.kind) || x.studiedBio);
    const col = tg ? (isDone(tg) ? P.dim : P.hi) : P.dim;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      a.hline(Math.min(cx + sx * R, cx + sx * (R - 6)), Math.max(cx + sx * R, cx + sx * (R - 6)), cy + sy * R, col);
      a.vline(cx + sx * R, Math.min(cy + sy * R, cy + sy * (R - 6)), Math.max(cy + sy * R, cy + sy * (R - 6)), col);
    }
    if (!tg) {
      const ly = cy - R + Math.round(((sc.sweep * 30) % (R * 2)));
      a.hline(cx - R + 2, cx + R - 2, ly, P.faint);
      a.set(cx, cy, P.dim);
      text(a, 'NO TARGET', cx, cy + R + 4, P.dim, { align: 'center' });
      text(a, 'AIM THE CROSSHAIR AT A THING', cx, cy + R + 14, P.faint, { align: 'center', font: FONT3 });
    } else {
      const studied = isDone(tg);
      // a progress ring
      const segs = 24, done = studied ? segs : Math.floor(Math.min(1, sc.prog) * segs);
      for (let i = 0; i < segs; i++) {
        const ang = -Math.PI / 2 + (i / segs) * Math.PI * 2;
        a.set(Math.round(cx + Math.cos(ang) * 12), Math.round(cy + Math.sin(ang) * 12), i < done ? P.hi : P.faint);
      }
      a.disc(cx + 0.5, cy + 0.5, 2, studied ? P.fg : Math.floor(t * 6) % 2 ? P.hi : P.dim);
      text(a, tg.label.slice(0, 22), cx, cy + R + 3, P.hi, { align: 'center' });
      text(a, tg.info.slice(0, 30), cx, cy + R + 12, tg.cat === 'mon' ? P.bad : P.fg, { align: 'center', font: FONT3 });
      const v = e?.scanValue(tg.cat) || 0;
      text(a, studied ? 'IN DATABASE' : sc.sent === tg.kind ? 'UPLOADING...' : `STUDY: +${short$(v)}`, cx, cy + R + 19, studied ? P.dim : P.warn, { align: 'center', font: FONT3 });
    }
    text(a, `STUDIED ${Object.keys(this.game.run?.scans || {}).length}`, 4, AH - 9, P.dim, { font: FONT3 });
    text(a, `RNG ${sc.dist ? sc.dist.toFixed(1) : '--'}M`, AW - 4, AH - 9, P.dim, { font: FONT3, align: 'right' });
  }

  // ------------------------------------------------------------------ RADIO
  _radio(a, t, y0) {
    // tuner strip
    rulePx(a, 2, AW - 3, y0 + 12, P.dim);
    for (let x = 6; x < AW - 6; x += 6) a.vline(x, y0 + 7, y0 + 10, P.faint);
    const nx = 40 + Math.round(Math.sin(t * 0.3) * 3);
    a.vline(nx, y0 + 1, y0 + 10, P.bad);
    text(a, 'R.O.O.M. BAND 98.6', AW - 6, y0 + 3, P.hi, { align: 'right', font: FONT3 });
    // spectrum
    for (let i = 0; i < 18; i++) {
      const h = Math.round(2 + Math.abs(Math.sin(t * (3 + i * 0.7) + i)) * 6);
      a.rect(4 + i * 3, y0 + 21 - h, 2, h, P.dim);
    }
    text(a, 'HQ COMMS LOG', 64, y0 + 14, P.fg);
    let y = y0 + 24;
    for (const msg of this.messages.slice(0, 6)) {
      const line = `${(msg.from || '').slice(0, 9)}: ${msg.msg}`.toUpperCase();
      text(a, line.slice(0, 38), 3, y, msg.from === 'HQ' || msg.from === 'RECEPTION' ? P.hi : P.fg, { font: FONT3 });
      y += 8;
      if (y > AH - 8) break;
    }
    if (!this.messages.length) text(a, '...STATIC...', AW / 2, y0 + 40, P.dim, { align: 'center' });
  }

  // ------------------------------------------------------------------ FLASH+
  _flash(a, t, y0) {
    const l = this.game.local;
    const fi = l.inv?.find('flashlight') ?? -1;
    const ch = fi >= 0 ? (l.inv.slots[fi].state.charge ?? 1) : 0;
    text(a, 'FLASHLIGHT OVERDRIVE', 4, y0, P.hi);
    const on = l.flashOn && fi >= 0;
    // beam diagram
    const bx = 20, by = y0 + 26;
    a.rect(bx - 12, by - 4, 12, 8, on ? P.fg : P.dim);
    if (on) for (let i = 0; i < 9; i++) { const yy = by - 2 - i, y2 = by + 2 + i; a.line(bx, by - 2, bx + 110, yy - i * 1.4, i % 2 ? P.faint : P.dim); a.line(bx, by + 2, bx + 110, y2 + i * 1.4, i % 2 ? P.faint : P.dim); }
    text(a, on ? 'BOOST ACTIVE +45%' : fi >= 0 ? 'TORCH OFF [F]' : 'NO FLASHLIGHT', AW / 2 + 10, by - 3, on ? (Math.floor(t * 3) % 2 ? P.hi : P.fg) : P.dim, { align: 'center' });
    text(a, 'CELL', 4, y0 + 48, P.dim);
    segBar(a, 28, y0 + 48, AW - 50, 7, ch, ch < 0.2 ? P.bad : P.fg);
    text(a, `${Math.round(ch * 100)}%`, AW - 3, y0 + 49, P.dim, { align: 'right', font: FONT3 });
    const bat = this.econ?.has('up:battery');
    text(a, bat ? 'TOOL BATTERY: RUNTIME X2' : 'TIP: TOOL BATTERY UPGRADE', 4, y0 + 62, bat ? P.fg : P.dim, { font: FONT3 });
  }

  dispose() {}
}

// greedy wrap at 2x scale: maxW is in 1x glyph units
function wrapLines(str, maxW) { return wrapText(str, maxW, FONT5, 1); }

function glyphMini(a, name, x, y, c) { bitmap(MINI[name] || MINI.heart, { '#': c }, a, x, y); }

// chunky segmented bar in the phosphor style
function segBar(a, x, y, w, h, f, c) {
  f = Math.max(0, Math.min(1, Number.isFinite(f) ? f : 0));
  const segs = Math.max(4, Math.floor(w / 3));
  const on = Math.round(f * segs);
  for (let i = 0; i < segs; i++) {
    const sx = x + i * 3;
    if (i < on) a.rect(sx, y, 2, h, c);
    else a.rect(sx, y + h - 2, 2, 2, P.faint);
  }
}

// Fallout-style furniture: an underline rule with end ticks, bracket corners, a diamond bullet
function rulePx(a, x0, x1, y, c) { a.hline(x0, x1, y, c); a.set(x0, y - 1, c); a.set(x1, y - 1, c); }
function brk(a, x, y, w, h, l, c) {
  const x1 = x + w - 1, y1 = y + h - 1;
  a.hline(x, x + l, y, c); a.vline(x, y, y + l, c);
  a.hline(x1 - l, x1, y, c); a.vline(x1, y, y + l, c);
  a.hline(x, x + l, y1, c); a.vline(x, y1 - l, y1, c);
  a.hline(x1 - l, x1, y1, c); a.vline(x1, y1 - l, y1, c);
}
function diamond(a, cx, cy, c, fill) {
  for (let d = -2; d <= 2; d++) { const w = 2 - Math.abs(d); if (fill) a.hline(cx - w, cx + w, cy + d, c); else { a.set(cx - w, cy + d, c); a.set(cx + w, cy + d, c); } }
}
