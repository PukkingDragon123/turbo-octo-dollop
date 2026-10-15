// The R.O.O.M. Corporate Wrist Terminal: a chunky retro watch on the clone's left wrist.
// Three tabs: STATUS (health, food, water, stamina + EKG) · MAP · TASK (objective, money vs quota).
// The face is pixel art: drawn at 160x120 with the kit's bitmap font and sprites, scaled x3 onto the
// canvas that is mapped onto the 3D watch screen, with a phosphor glow and an LCD dot grid.
// Notices (HQ radio, pickups, warnings, achievements) make the watch beep and the clone glances at
// the wrist for a moment, showing the notice in big type.
import * as THREE from 'three';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { CrtScreen } from './crt.js';
import { itemName } from '../game/itemdefs.js';
import { CELL, wallN, wallW, W } from '../world/levels/yellow/layout.js';
import { Pix, text, textWidth, wrapText, FONT3, FONT5, bitmap } from './pixelart.js';

const TABS = ['status', 'map', 'task'];
const TAB_NAMES = ['STATUS', 'MAP', 'TASK'];
const TAB_ICON = ['pulse', 'map', 'task'];
const AW = 160, AH = 120, K = 3;

// phosphor palette (green terminal)
const P = { bg: '#020f05', fg: '#4dff7a', dim: '#1f9a40', faint: '#0c3a1a', hi: '#d8ffe0', bad: '#ff5a4a', badDim: '#7a1e18', warn: '#ffd060', cyan: '#9fd8ff' };

const MINI = {
  heart: ['.#.#.', '#####', '#####', '.###.', '..#..'],
  food: ['.##..', '#..#.', '####.', '.####', '..##.'],
  drop: ['..#..', '.###.', '#####', '#####', '.###.'],
  bolt: ['..##.', '.##..', '####.', '..##.', '.##..'],
  coin: ['.###.', '##.##', '#.#.#', '##.##', '.###.'],
  pulse: ['..#...', '..#...', '.#.#.#', '##..#.', '......'],
  map: ['##.##', '#.#.#', '#.#.#', '#.#.#', '##.##'],
  task: ['.###.', '#...#', '#.#.#', '#...#', '#####'],
};

export class Watch {
  constructor(game) {
    this.game = game;
    this.screen = new CrtScreen(AW * K, AH * K, 'green');
    this.screen.fps = 15;
    this.art = new Pix(AW, AH);
    this.artCv = document.createElement('canvas');
    this.artCv.width = AW; this.artCv.height = AH;
    this.tabIdx = 0;
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
    this.attach(game.local.arms);
  }

  get tab() { return TABS[this.tabIdx]; }
  get tabs() { return TAB_NAMES; }

  setTab(i) {
    i = ((i % TABS.length) + TABS.length) % TABS.length;
    if (i === this.tabIdx) return;
    this.tabIdx = i;
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
    // tab switching (Q / E while the watch is up)
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
    // tab strip
    const tw = Math.floor((AW - 4) / TABS.length);
    TABS.forEach((_, i) => {
      const sel = i === this.tabIdx && !glance;
      const x = 2 + i * tw;
      if (sel) { a.rect(x, 1, tw - 2, 10, P.fg); a.hline(x, x + tw - 3, 11, P.fg); }
      else { a.frame(x, 1, tw - 2, 10, P.faint); a.hline(x, x + tw - 3, 10, P.dim); }
      const lw = 6 + 2 + textWidth(TAB_NAMES[i], FONT5);
      const lx = Math.round(x + (tw - 2 - lw) / 2);
      glyphMini(a, TAB_ICON[i], lx, 4, sel ? P.bg : P.dim);
      text(a, TAB_NAMES[i], lx + 8, 3, sel ? P.bg : P.dim);
    });
    // day + clock
    const day = g.day?.active ? `DAY ${g.day.day}/7` : 'HQ  B4';
    text(a, day, 4, 14, P.hi);
    const clk = g.day?.active ? g.day.leftString() : 'ON SHIFT';
    text(a, clk, AW - 4, 14, P.fg, { align: 'right' });
    a.hline(2, AW - 3, 22, P.dim);
    const y0 = 25;
    if (glance) { this._notice(a, t, y0); return; }
    switch (this.tab) {
      case 'status': this._status(a, t, y0); break;
      case 'map': this._map(a, t, y0); break;
      case 'task': this._task(a, t, y0); break;
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
    const col = bad ? P.bad : n.kind === 'good' || n.kind === 'healthity' ? P.hi : P.hi;
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
    text(a, `${this.game.run?.credits ?? 0}`, AW - 11, AH - 9, P.hi, { align: 'right' });
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
    a.frame(2, ey, AW - 4, eh, P.faint);
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
    a.frame(1, top - 1, AW - 2, bot - top + 2, P.dim);
    a.rect(AW - 12, top + 1, 9, 9, P.bg);
    text(a, 'N', AW - 10, top + 2, P.hi);
  }

  // a mission marker (camp / pads / exit): an icon + label on the map, or an arrow on the frame edge
  _marker(a, t, mk, [x, y], mx, my, top, bot) {
    const col = mk.kind === 'exit' ? P.warn : mk.kind === 'pads' ? P.cyan : P.hi;
    const label = String(mk.label || mk.kind).toUpperCase();
    const L = 4, R = AW - 5, T = top + 2, B = bot - 3;
    if (x >= L + 3 && x <= R - 3 && y >= T + 3 && y <= B - 3) {
      if (mk.kind === 'camp') a.poly([[x - 4, y + 3], [x, y - 4], [x + 4, y + 3]], col);
      else if (mk.kind === 'pads') { a.frame(x - 3, y - 3, 7, 7, col); a.rect(x - 1, y - 1, 3, 3, col); }
      else if (Math.floor(t * 3) % 2) a.disc(x + 0.5, y + 0.5, 3.2, col);
      else a.ring(x + 0.5, y + 0.5, 3.6, col);
      const lw = textWidth(label, FONT3);
      const lx = x + 5 + lw < R ? x + 5 : x - 5 - lw;
      a.rect(lx - 1, y - 7, lw + 2, 7, P.bg);
      text(a, label, lx, y - 6, col, { font: FONT3 });
      return;
    }
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

  _task(a, t, y0) {
    const g = this.game;
    const m = g.world.level?.mission;
    let obj = null;
    try { obj = m?.objective?.() || null; } catch (e) { obj = null; }
    let y = y0;
    if (!m) {
      text(a, 'HQ ORIENTATION', 4, y, P.hi);
      y += 11;
      for (const s of ['VISIT YOUR LOCKER', 'GRAB SNACKS: BREAK ROOM', 'READ THE ORIENTATION', 'HOST: START SHIFT', 'STEP INTO THE ELEVATOR']) {
        a.frame(4, y + 1, 5, 5, P.dim);
        text(a, s, 12, y, P.fg);
        y += 10;
      }
      return;
    }
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
      // fallback checklist from the generator mission
      const gens = m.generators || [];
      for (const gen of gens) {
        const done = gen.running;
        a.frame(4, y + 1, 5, 5, done ? P.fg : P.dim);
        if (done) { a.set(5, y + 3, P.hi); a.set(6, y + 4, P.hi); a.set(7, y + 2, P.hi); }
        text(a, `REPAIR ${String(gen.label || 'GENERATOR').toUpperCase()}`.slice(0, 22), 12, y, done ? P.dim : P.fg);
        if (gen.state?.linked) text(a, 'LINK', AW - 4, y, P.hi, { align: 'right', font: FONT3 });
        y += 9;
      }
      if (m.state) {
        const ex = m.state.exit;
        a.frame(4, y + 1, 5, 5, m.state.extraction ? P.fg : P.dim);
        text(a, 'REQUEST EXTRACTION', 12, y, m.state.extraction ? P.dim : P.fg);
        y += 9;
        if (ex && !ex.done && m.exitTimeLeft) {
          const left = Math.ceil(m.exitTimeLeft());
          text(a, `EVACUATE ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, 4, y + 1, Math.floor(t * 3) % 2 ? P.bad : P.warn, { scale: 1 });
          y += 10;
        }
      }
    }
    // money vs quota
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
    void t;
  }

  dispose() {}
}

// greedy wrap at 2x scale: maxW is in 1x glyph units
function wrapLines(str, maxW) { return wrapText(str, maxW, FONT5, 1); }

function glyphMini(a, name, x, y, c) { bitmap(MINI[name] || MINI.heart, { '#': c }, a, x, y); }

// chunky segmented bar in the phosphor style
function segBar(a, x, y, w, h, f, c) {
  f = Math.max(0, Math.min(1, Number.isFinite(f) ? f : 0));
  a.frame(x, y, w, h, P.dim);
  const segs = Math.max(4, Math.floor((w - 2) / 5));
  const sw = (w - 2) / segs;
  const n = f * segs;
  for (let i = 0; i < segs; i++) {
    const sx = Math.round(x + 1 + i * sw + 1), ex = Math.round(x + 1 + (i + 1) * sw) - 1;
    if (i < Math.floor(n)) a.rect(sx, y + 2, ex - sx + 1, h - 4, c);
    else if (i < n) a.rect(sx, y + 2, Math.max(1, Math.round((ex - sx + 1) * (n - i))), h - 4, c);
    else a.set(sx, y + Math.floor(h / 2), P.faint);
  }
}

