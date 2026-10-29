// The R.O.O.M. Corporate Wrist Terminal: a chunky retro watch on the clone's left wrist with APPS.
//   HOME     launcher grid: every app, installed or locked (how to get it)
//   STATUS   health, food, water, stamina + EKG          TASKS   main mission checklist + side quests
//   BANK     credits, ESCAPE FUND gauge, level rules     MAP     explored cells, camp, crusher, exit, quest pins
//   SCANNER  point the crosshair at creatures / fungus / loot: identify, appraise, study for research money
//   RADIO    HQ comms log on the R.O.O.M. band            FLASH+  flashlight overdrive status
// Apps come from game/economy.js WATCH_APPS; HOME, STATUS, TASKS and BANK are built in, the rest are installed
// by quests or bought at the company store (levels without an economy show STATUS / MAP / TASKS).
// Q / E cycle the installed apps while the watch is up. The face is plain and flat: laid out in 160 x 120 watch
// units, drawn 4 device px per unit (640 x 480) with real type in the 'watch' font slot (ui/watchdraw.js), one ink
// colour and a dimmer tone of it, thin rules and simple vector shapes; no scanlines, glow or LCD grid.
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
import { S, BG, INK, DIM, LINE, TRACK, RED, SM, M, L, begin, txt, tw, wrap, rule, vrule, frame, bar, dot, ring, icon, bullet } from './watchdraw.js';

const LEGACY = ['status', 'map', 'tasks'];
const AW = 160, AH = 120; // the face in watch units
const HOME_APPS = WATCH_APPS.filter((x) => x.id !== 'home');
const VITALS = [['heart', 'HEALTH'], ['food', 'FOOD'], ['drop', 'WATER'], ['bolt', 'STAMINA']];
const HQ_ROOMS = ['RECEPTION + ELEVATOR', 'OFFICE', 'LOCKERS', 'BREAK ROOM', 'CLONING LAB', 'LOADING BAY'];
const HQ_STEPS = ['VISIT YOUR LOCKER', 'GRAB SNACKS: BREAK ROOM', 'READ THE ORIENTATION', 'HOST: START SHIFT', 'STEP INTO THE ELEVATOR'];
const noop = () => {};

const _fwd = new THREE.Vector3();

export class Watch {
  constructor(game) {
    this.game = game;
    this.screen = new CrtScreen(AW * S, AH * S, 'green');
    this.screen.fps = 15;
    // a flat face: none of the CRT's scanlines, rolling bar or vignette (its glow shadow is cleared in _present)
    this.screen.overlay = noop;
    this.screen.pal = { ...this.screen.pal, bg: BG };
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
      // self-lit only: a dark albedo so the scene lights don't wash the face, emissive kept under the bloom threshold
      this.screen.attach(arms.watchScreen, 1.0);
      arms.watchScreen.material.color.setHex(0x0c0c0c);
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
  // CrtScreen.draw fills its ground and sets a glow shadow before calling this; begin() clears the shadow and the
  // face is drawn flat in watch units (transform scale S), text at whole device pixel sizes
  _present(c, w, h, t) {
    begin(c);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = BG;
    c.fillRect(0, 0, w, h);
    c.setTransform(S, 0, 0, S, 0, 0);
    this._draw(c, t);
  }

  _draw(c, t) {
    const g = this.game;
    const l = g.local;
    const glance = this.peeking && !l.watchOpen;
    // title bar: < APP > and page dots
    const list = this.installed();
    const meta = WATCH_APPS.find((x) => x.id === this.app);
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
    txt(c, g.day?.active ? `DAY ${g.day.day}/7` : 'HQ  B4', 4, 14, M, INK);
    txt(c, g.day?.active ? g.day.leftString() : 'ON SHIFT', AW - 4, 14, M, INK, 'right');
    rule(c, 2, AW - 2, 22.5, LINE, 0.25);
    const y0 = 25;
    if (glance) { this._notice(c, t, y0); return; }
    switch (this.app) {
      case 'home': this._home(c, t, y0); break;
      case 'status': this._status(c, t, y0); break;
      case 'map': this._map(c, t, y0); break;
      case 'tasks': this._tasks(c, t, y0); break;
      case 'bank': this._bank(c, t, y0); break;
      case 'scanner': this._scanner(c, t, y0); break;
      case 'radio': this._radio(c, t, y0); break;
      case 'flash': this._flash(c, t, y0); break;
      default: break;
    }
    // a notice that arrives while the watch is up runs as a banner along the bottom
    if (this.peeking && this.notices[0]) {
      const n = this.notices[0];
      const bad = n.kind === 'bad' || n.kind === 'warn';
      c.fillStyle = BG;
      c.fillRect(0, AH - 11, AW, 11);
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
    icon(c, 'coin', AW - 5.5, AH - 5.5, 2.5, DIM, true);
    txt(c, short$(this.game.run?.credits ?? 0), AW - 11, AH - 9, M, INK, 'right');
  }

  // ------------------------------------------------------------------ HOME: launcher grid
  _home(c, t, y0) {
    const e = this.econ;
    const cols = 4, cw = 38, ch = 30, x0 = 3;
    const inst = this.installed();
    const next = inst[(this.tabIdx + 1) % inst.length];
    for (let i = 0; i < HOME_APPS.length; i++) {
      const app = HOME_APPS[i];
      const x = x0 + (i % cols) * (cw + 1), y = y0 + Math.floor(i / cols) * (ch + 2);
      const on = e ? e.appInstalled(app.id) : LEGACY.includes(app.id);
      if (app.id === next) frame(c, x, y, cw, ch, DIM); // where E goes next
      icon(c, app.icon, x + cw / 2, y + 8.5, 4.5, on ? INK : LINE);
      if (!on) icon(c, 'lock', x + cw - 4.5, y + 4.5, 2.2, DIM);
      txt(c, app.name, x + cw / 2, y + 18, SM, on ? INK : DIM, 'center', cw - 3);
      if (!on && app.via) txt(c, app.via, x + cw / 2, y + 24, SM, DIM, 'center', cw - 3);
    }
    const by = y0 + 2 * (ch + 2) + 2;
    rule(c, 2, AW - 2, by, LINE, 0.25);
    icon(c, 'coin', 6.5, by + 6.5, 2.5, DIM, true);
    txt(c, fmt$(this.game.run?.credits ?? 0), 12, by + 3, M, INK, 'left', 100);
    txt(c, 'Q/E APPS', AW - 4, by + 4, SM, DIM, 'right');
  }

  // ------------------------------------------------------------------ STATUS
  _status(c, t, y0) {
    const s = this.game.local.survival;
    for (let i = 0; i < VITALS.length; i++) {
      let f, warn;
      if (i === 0) { f = (s.health ?? 100) / 100; warn = s.health < 30; }
      else if (i === 1) { f = (s.hunger ?? 100) / 100; warn = s.hunger < 25; }
      else if (i === 2) { f = (s.thirst ?? 100) / 100; warn = s.thirst < 25; }
      else { f = (s.stamina ?? 40) / (s.maxStamina || 40); warn = (s.stamina ?? 40) < 8; }
      const y = y0 + i * 12;
      icon(c, VITALS[i][0], 5.5, y + 3.5, 2.6, warn ? RED : DIM, true);
      txt(c, VITALS[i][1], 11, y, M, warn ? RED : INK);
      bar(c, 56, y + 2, 82, 3, f, warn ? RED : INK);
      txt(c, `${Math.round(Math.max(0, Math.min(1, f)) * 100)}`, AW - 3, y + 1, SM, warn ? RED : DIM, 'right');
    }
    // EKG
    const ey = y0 + 50, eh = 26, n = this.ekg.length, ew = AW - 52;
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
      txt(c, 'HQ FLOORPLAN', 4, y0 + 2, M, INK);
      txt(c, 'SUBLEVEL B4 - NO MAPPING', 4, y0 + 14, M, DIM, 'left', AW - 8);
      for (let i = 0; i < HQ_ROOMS.length; i++) {
        c.fillStyle = DIM;
        c.fillRect(6, y0 + 28 + i * 10, 3, 3);
        txt(c, HQ_ROOMS[i], 13, y0 + 26 + i * 10, M, INK, 'left', AW - 17);
      }
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
        c.fillStyle = BG;
        c.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
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
    c.fillStyle = BG;
    c.fillRect(AW - 12, top + 1, 9, 9);
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
      c.fillStyle = BG;
      c.fillRect(lx - 1, y - 7, lw + 2, 7);
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
    c.fillStyle = BG;
    c.fillRect(lx - 1, ly - 1, lw + 2, 7);
    txt(c, label, lx, ly, SM, INK);
  }

  // ------------------------------------------------------------------ TASKS
  _tasks(c, t, y0) {
    const g = this.game;
    const m = g.world.level?.mission;
    const e = this.econ;
    if (!m) {
      let y = y0;
      txt(c, 'HQ ORIENTATION', 4, y, M, INK);
      y += 11;
      for (const s of HQ_STEPS) {
        bullet(c, 7, y + 3.5, '');
        txt(c, s, 12, y, M, INK, 'left', AW - 15);
        y += 10;
      }
      return;
    }
    if (!e || !m.tasks) { this._legacyTask(c, t, y0); return; }
    let y = y0;
    const obj = m.objective?.();
    const main = e.main.filter((n) => n.id !== 'm_escape');
    const mainDone = e.mainDone();
    txt(c, mainDone ? 'SIDE QUESTS' : 'MAIN MISSION 1', 4, y, M, INK);
    if (obj && !mainDone) txt(c, obj.title.slice(0, 22), AW - 4, y + 1, SM, DIM, 'right', 66);
    y += 10;
    if (!mainDone) {
      for (const n of main) {
        const st = e.state(n), done = st === 'claimed', cur = st === 'active';
        bullet(c, 7, y + 3.5, done ? 'done' : cur ? 'cur' : '');
        txt(c, (n.task || n.name).toUpperCase().slice(0, 32), 13, y, M, done ? DIM : INK, 'left', AW - 16);
        y += 10;
      }
      if (obj?.detail) {
        const det = wrap(c, obj.detail, AW - 8, SM);
        for (let i = 0; i < det.length && i < 3; i++) txt(c, det[i], 4, y + 2 + i * 7, SM, DIM, 'left', AW - 8);
        y += 23;
      }
      if (typeof obj?.progress === 'number') bar(c, 4, Math.min(y, AH - 28), AW - 8, 3, obj.progress, INK);
    } else {
      const side = e.activeSide().slice(0, 5);
      if (!side.length) txt(c, 'ALL QUESTS DONE. FILL THE FUND!', 4, y, SM, INK, 'left', AW - 8);
      for (const n of side) {
        const st = e.state(n), pr = e.progress(n);
        txt(c, n.short.slice(0, 13), 4, y, M, INK, 'left', 70);
        if (st === 'ready') txt(c, 'CLAIM AT CAMP', AW - 4, y + 1, SM, INK, 'right');
        else { bar(c, 76, y + 2, 60, 3, pr.frac, INK); txt(c, `${Math.round(pr.frac * 100)}`, AW - 3, y + 1, SM, DIM, 'right'); }
        y += 10;
      }
    }
    // escape fund strip
    const by = AH - 20;
    rule(c, 2, AW - 2, by - 3, LINE, 0.25);
    icon(c, 'coin', 6.5, by + 3.5, 2.5, DIM, true);
    txt(c, `${short$(e.escape)} / ${short$(e.quota)}`, 12, by, M, INK, 'left', 110);
    txt(c, 'ESCAPE', AW - 4, by + 1, SM, DIM, 'right');
    bar(c, 4, by + 12, AW - 8, 3, e.escape / e.quota, INK);
  }

  // older dimensions (generator / radio mission): objective + checklist + money vs quota
  _legacyTask(c, t, y0) {
    const g = this.game;
    const m = g.world.level?.mission;
    let obj = null;
    try { obj = m?.objective?.() || null; } catch (e) { obj = null; }
    let y = y0;
    if (obj) {
      icon(c, 'flag', 6, y + 3.5, 3, INK);
      const title = wrap(c, obj.title || 'OBJECTIVE', AW - 16, M);
      for (let i = 0; i < title.length && i < 2; i++) txt(c, title[i], 12, y + i * 9, M, INK, 'left', AW - 16);
      y += Math.min(2, title.length) * 9 + 2;
      if (obj.detail) {
        const det = wrap(c, obj.detail, AW - 8, M);
        for (let i = 0; i < det.length && i < 4; i++) txt(c, det[i], 4, y + i * 9, M, DIM, 'left', AW - 8);
        y += Math.min(4, det.length) * 9 + 2;
      }
      if (typeof obj.progress === 'number') {
        bar(c, 4, y + 2, AW - 30, 3, obj.progress, INK);
        txt(c, `${Math.round(Math.max(0, Math.min(1, obj.progress)) * 100)}%`, AW - 4, y, M, INK, 'right');
        y += 11;
      }
    } else {
      for (const gen of m.generators || []) {
        const done = gen.running;
        bullet(c, 7, y + 3.5, done ? 'done' : '');
        txt(c, `REPAIR ${String(gen.label || 'GENERATOR').toUpperCase()}`.slice(0, 22), 12, y, M, done ? DIM : INK, 'left', AW - 34);
        if (gen.state?.linked) txt(c, 'LINK', AW - 4, y + 1, SM, INK, 'right');
        y += 9;
      }
      if (m.state) {
        const ex = m.state.exit;
        bullet(c, 7, y + 3.5, m.state.extraction ? 'done' : '');
        txt(c, 'REQUEST EXTRACTION', 12, y, M, m.state.extraction ? DIM : INK);
        y += 9;
        if (ex && !ex.done && m.exitTimeLeft) {
          const left = Math.ceil(m.exitTimeLeft());
          txt(c, `EVACUATE ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, 4, y + 1, M, RED);
          y += 10;
        }
      }
    }
    const q = m.quota?.need;
    const cr = g.run?.credits ?? 0;
    const by = AH - 20;
    rule(c, 2, AW - 2, by - 3, LINE, 0.25);
    icon(c, 'coin', 6.5, by + 3.5, 2.5, DIM, true);
    txt(c, q ? `${cr} / ${q} CR` : `${cr} CR`, 12, by, M, INK, 'left', 100);
    if (q) {
      const met = cr >= q;
      txt(c, met ? 'QUOTA MET' : 'QUOTA', AW - 4, by + 1, SM, met ? INK : DIM, 'right');
      bar(c, 4, by + 12, AW - 8, 3, cr / q, INK);
    }
  }

  // ------------------------------------------------------------------ BANK
  _bank(c, t, y0) {
    const e = this.econ, run = this.game.run || {};
    txt(c, 'CREDITS', 4, y0, SM, DIM);
    txt(c, fmt$(run.credits), 4, y0 + 7, L, INK, 'left', AW - 8);
    if (!e) return;
    const f = Math.min(1, e.escape / e.quota);
    // escape fund: a horizontal thermometer with a bulb
    const gy = y0 + 28;
    txt(c, 'ESCAPE FUND', 4, gy, M, INK);
    txt(c, `${Math.floor(f * 100)}%`, AW - 4, gy, M, INK, 'right');
    const bx = 12, bw = AW - 18, by = gy + 10;
    dot(c, 8, by + 4.5, 4, INK);
    bar(c, bx, by + 2.5, bw, 4, f, INK);
    for (let i = 1; i < 4; i++) vrule(c, bx + bw * i / 4, by + 8, by + 10.5, DIM);
    txt(c, `${fmt$(e.escape)} / ${short$(e.quota)}`, 4, by + 13, SM, INK, 'left', AW - 8);
    // level rules
    const r = e.rules, ry = by + 22;
    rule(c, 2, AW - 2, ry, LINE, 0.25);
    txt(c, `${r.name}: ${r.title}`.slice(0, 30), 4, ry + 3, SM, INK, 'left', AW - 8);
    txt(c, `PRICES X${r.priceMul} · ${r.hazards[0]}`.slice(0, 38), 4, ry + 10, SM, DIM, 'left', AW - 8);
    txt(c, 'PURCHASES DO NOT DRAIN THE FUND', 4, ry + 17, SM, DIM, 'left', AW - 8);
    const last = this.game.world?.level?.mission?.crusher?.lastSale;
    if (last) txt(c, `LAST UPLOAD +${short$(last)}`, 4, AH - 9, M, INK, 'left', AW - 8);
  }

  // ------------------------------------------------------------------ SCANNER
  _scanner(c, t, y0) {
    const sc = this.scan, e = this.econ, tg = sc.target;
    const cx = AW / 2, cy = y0 + 30;
    const R = 22;
    const studied = !!tg && !!(e?.studied(tg.kind) || tg.studiedBio);
    // reticle corners
    c.strokeStyle = tg && !studied ? INK : DIM;
    c.lineWidth = 0.5;
    c.beginPath();
    for (let k = 0; k < 4; k++) {
      const sx = k & 1 ? 1 : -1, sy = k & 2 ? 1 : -1;
      c.moveTo(cx + sx * (R - 6), cy + sy * R); c.lineTo(cx + sx * R, cy + sy * R); c.lineTo(cx + sx * R, cy + sy * (R - 6));
    }
    c.stroke();
    if (!tg) {
      rule(c, cx - R + 2, cx + R - 2, cy - R + ((sc.sweep * 30) % (R * 2)), LINE, 0.25);
      dot(c, cx, cy, 0.8, DIM);
      txt(c, 'NO TARGET', cx, cy + R + 4, M, DIM, 'center');
      txt(c, 'AIM THE CROSSHAIR AT A THING', cx, cy + R + 14, SM, DIM, 'center', AW - 8);
    } else {
      // progress ring
      const p = studied ? 1 : Math.max(0, Math.min(1, sc.prog));
      ring(c, cx, cy, 12, TRACK, 0.75);
      if (p > 0) {
        c.strokeStyle = INK;
        c.lineWidth = 0.75;
        c.beginPath();
        c.arc(cx, cy, 12, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
        c.stroke();
      }
      dot(c, cx, cy, 2, studied ? DIM : INK);
      txt(c, tg.label.slice(0, 22), cx, cy + R + 3, M, INK, 'center', AW - 6);
      txt(c, tg.info.slice(0, 30), cx, cy + R + 12, SM, tg.info === 'HOSTILE ENTITY' ? RED : DIM, 'center', AW - 6);
      const v = e?.scanValue(tg.cat) || 0;
      txt(c, studied ? 'IN DATABASE' : sc.sent === tg.kind ? 'UPLOADING...' : `STUDY: +${short$(v)}`, cx, cy + R + 19, SM, studied ? DIM : INK, 'center');
    }
    txt(c, `STUDIED ${Object.keys(this.game.run?.scans || {}).length}`, 4, AH - 9, SM, DIM);
    txt(c, `RNG ${sc.dist ? sc.dist.toFixed(1) : '--'}M`, AW - 4, AH - 9, SM, DIM, 'right');
  }

  // ------------------------------------------------------------------ RADIO
  _radio(c, t, y0) {
    // tuner strip
    rule(c, 2, AW - 2, y0 + 12, DIM);
    c.fillStyle = LINE;
    for (let x = 6; x < AW - 6; x += 6) c.fillRect(x, y0 + 9, 0.25, 3);
    vrule(c, 40 + Math.sin(t * 0.3) * 3, y0 + 1, y0 + 12, INK, 0.5);
    txt(c, 'R.O.O.M. BAND 98.6', AW - 6, y0 + 1, SM, INK, 'right');
    // spectrum
    c.fillStyle = DIM;
    for (let i = 0; i < 18; i++) {
      const h = 2 + Math.abs(Math.sin(t * (3 + i * 0.7) + i)) * 6;
      c.fillRect(4 + i * 3, y0 + 22 - h, 2, h);
    }
    txt(c, 'HQ COMMS LOG', 64, y0 + 14, M, INK);
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

  // ------------------------------------------------------------------ FLASH+
  _flash(c, t, y0) {
    const l = this.game.local;
    const fi = l.inv?.find('flashlight') ?? -1;
    const ch = fi >= 0 ? (l.inv.slots[fi].state.charge ?? 1) : 0;
    txt(c, 'FLASHLIGHT OVERDRIVE', 4, y0, M, INK, 'left', AW - 8);
    const on = l.flashOn && fi >= 0;
    // beam diagram: a torch and, when lit, its cone
    const bx = 20, by = y0 + 26;
    if (on) {
      c.fillStyle = TRACK;
      c.beginPath();
      c.moveTo(bx, by - 2); c.lineTo(bx + 110, by - 21); c.lineTo(bx + 110, by + 21); c.lineTo(bx, by + 2);
      c.closePath();
      c.fill();
      c.strokeStyle = DIM;
      c.lineWidth = 0.5;
      c.beginPath();
      c.moveTo(bx, by - 2); c.lineTo(bx + 110, by - 21);
      c.moveTo(bx, by + 2); c.lineTo(bx + 110, by + 21);
      c.stroke();
    }
    c.fillStyle = on ? INK : DIM;
    c.fillRect(bx - 12, by - 3, 9, 6);
    c.fillRect(bx - 3, by - 4, 3, 8);
    txt(c, on ? 'BOOST ACTIVE +45%' : fi >= 0 ? 'TORCH OFF [F]' : 'NO FLASHLIGHT', AW / 2 + 10, by - 3, M, on ? INK : DIM, 'center');
    const low = fi >= 0 && ch < 0.2;
    txt(c, 'CELL', 4, y0 + 48, M, DIM);
    bar(c, 31, y0 + 50, AW - 53, 3, ch, low ? RED : INK);
    txt(c, `${Math.round(ch * 100)}%`, AW - 3, y0 + 49, SM, low ? RED : DIM, 'right');
    const bat = this.econ?.has('up:battery');
    txt(c, bat ? 'TOOL BATTERY: RUNTIME X2' : 'TIP: TOOL BATTERY UPGRADE', 4, y0 + 62, SM, bat ? INK : DIM, 'left', AW - 8);
  }

  dispose() {}
}
