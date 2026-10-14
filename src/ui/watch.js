// The R.O.O.M. Corporate Wrist Terminal: a chunky retro watch on the clone's left wrist.
// Tabs: STATUS (vitals + EKG) · CAMERA (research photos) · RESEARCH · MAP · MSG · TASKS.
// Drawn on a canvas that is mapped onto the 3D watch screen in the first-person viewmodel.
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { profile } from '../core/profile.js';
import { CrtScreen, text, bar, box, wrap } from './crt.js';
import { SAMPLES } from '../game/itemdefs.js';
import { CELL, wallN, wallW, W } from '../world/levels/yellow/layout.js';

const TABS = ['status', 'camera', 'research', 'map', 'msg', 'tasks'];

export class Watch {
  constructor(game) {
    this.game = game;
    this.screen = new CrtScreen(512, 384, 'green');
    this.screen.fps = 15;
    this.tabIdx = 0;
    this.messages = [];
    this.ekg = new Float32Array(120);
    this.ekgPhase = 0;
    this.ekgI = 0;
    this.photoRequest = false;
    this.lastPhoto = null;
    this.viewfinder = null;
    this._buildViewfinder();
    this.attach(game.local.arms);
  }

  get tab() { return TABS[this.tabIdx]; }

  attach(arms) {
    if (arms?.watchScreen) {
      this.screen.attach(arms.watchScreen, 1.5);
      arms.watchScreen.material.toneMapped = true;
    }
  }

  log(from, msg) {
    this.messages.unshift({ from, msg, t: Date.now() });
    if (this.messages.length > 30) this.messages.pop();
  }

  _buildViewfinder() {
    const d = document.createElement('div');
    d.id = 'viewfinder';
    d.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9;display:none;font-family:VT323,monospace;color:#d8ffd8;text-shadow:0 0 6px #6f6';
    d.innerHTML = `
      <div style="position:absolute;left:8vw;top:10vh;width:60px;height:60px;border-left:3px solid;border-top:3px solid"></div>
      <div style="position:absolute;right:8vw;top:10vh;width:60px;height:60px;border-right:3px solid;border-top:3px solid"></div>
      <div style="position:absolute;left:8vw;bottom:14vh;width:60px;height:60px;border-left:3px solid;border-bottom:3px solid"></div>
      <div style="position:absolute;right:8vw;bottom:14vh;width:60px;height:60px;border-right:3px solid;border-bottom:3px solid"></div>
      <div style="position:absolute;left:50%;top:50%;width:90px;height:60px;margin:-30px 0 0 -45px;border:2px solid rgba(220,255,220,0.6)"></div>
      <div style="position:absolute;left:calc(8vw + 10px);top:calc(10vh + 10px);font-size:30px"><span id="vf-rec" style="color:#ff4040">●</span> R.O.O.M. RESEARCH CAM</div>
      <div id="vf-info" style="position:absolute;right:calc(8vw + 10px);top:calc(10vh + 10px);font-size:26px;text-align:right"></div>
      <div id="vf-subj" style="position:absolute;left:50%;top:calc(50% + 46px);transform:translateX(-50%);font-size:26px;white-space:nowrap"></div>
      <div style="position:absolute;left:50%;bottom:calc(14vh + 10px);transform:translateX(-50%);font-size:24px">[LMB] CAPTURE · [Q/E] TABS · [TAB] LOWER</div>
      <img id="vf-last" style="position:absolute;right:calc(8vw + 10px);bottom:calc(14vh + 40px);width:200px;border:3px solid #fff;box-shadow:0 0 12px #000;display:none;transform:rotate(3deg)"/>`;
    document.body.appendChild(d);
    this.viewfinder = d;
  }

  update(dt) {
    const g = this.game;
    const l = g.local;
    if (!g.world) { this.viewfinder.style.display = 'none'; return; }
    // tab switching
    if (l.watchOpen && !l.dead && !g.terminal.active) {
      if (input.hit('tabPrev')) { this.tabIdx = (this.tabIdx - 1 + TABS.length) % TABS.length; audio.play('watch_beep', { volume: 0.3, bus: 'ui' }); }
      if (input.pressed.has('KeyE')) { this.tabIdx = (this.tabIdx + 1) % TABS.length; audio.play('watch_beep', { volume: 0.3, bus: 'ui' }); }
      if (this.tab === 'camera' && input.mouseHit(0)) this.snap();
    }
    const camMode = l.watchOpen && this.tab === 'camera' && !l.dead && l.watchRaised > 0.6;
    this.viewfinder.style.display = camMode ? 'block' : 'none';
    if (camMode) {
      const subj = (g.world.monsters?.photoSubjects(engine.camera) || []).concat(g.world.level?.photoSubjects?.(engine.camera) || []);
      const vfS = this.viewfinder.querySelector('#vf-subj');
      vfS.textContent = subj.length ? `SUBJECT: ${subj[0].subject} (~${subj[0].value} CR)` : 'NO SUBJECT';
      this.viewfinder.querySelector('#vf-info').innerHTML = `FILM ${12 - (l.photos?.length || 0)}/12<br/>DAY ${g.day.day}/7`;
      this.viewfinder.querySelector('#vf-rec').style.opacity = Math.floor(g.time * 2) % 2 ? 1 : 0.2;
    }
    // EKG
    const hr = l.survival.heartRate;
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
    this.ekg[this.ekgI = (this.ekgI + 1) % this.ekg.length] = v;
    // draw
    if (l.watchRaised > 0.05 || Math.random() < 0.05) this.screen.draw(dt, (ctx, w, h, pal, t) => this._draw(ctx, w, h, pal, t));
  }

  snap() {
    const g = this.game;
    const l = g.local;
    l.photos = l.photos || [];
    if (l.photos.length >= 12) { g.ui.toast('Film roll full — transmit research at the radio', 'warn'); audio.play('ui_error', { volume: 0.4 }); return; }
    audio.play('camera_shutter', { volume: 0.8 });
    audio.play('camera_flash', { volume: 0.5 });
    engine.post.params.uFlash.value = 0.85;
    g.world.fx.flashLight(engine.camera.position.clone(), 0xffffff, 20, 0.15, 14);
    g.world.noise && g.world.noise.emit(l.pos, 7, 'flash');
    const subj = (g.world.monsters?.photoSubjects(engine.camera) || []).concat(g.world.level?.photoSubjects?.(engine.camera) || []);
    subj.sort((a, b) => b.value - a.value);
    const best = subj[0];
    this.photoRequest = true; // thumbnail captured right after the next render
    const ph = { subject: best ? best.subject : 'NOTHING OF INTEREST', key: best?.key || `none:${Date.now()}`, value: best ? best.value : 0, thumb: null, t: Date.now() };
    l.photos.push(ph);
    this.pendingPhoto = ph;
    l.stats.photos++;
    if (best?.ach) profile.unlock(best.ach);
    g.ui.toast(best ? `PHOTO: ${best.subject} (~${best.value} CR)` : 'Photo taken (no research value)', best ? 'good' : '');
    // stun Still Lifes caught in the flash (host)
    if (best) g.world.monsters?.flashStun?.(engine.camera.position);
  }

  // called by the main loop right after rendering
  captureIfRequested(canvas) {
    if (!this.photoRequest || !this.pendingPhoto) return;
    this.photoRequest = false;
    try {
      const c = document.createElement('canvas');
      c.width = 240; c.height = 135;
      const ctx = c.getContext('2d');
      ctx.drawImage(canvas, 0, 0, c.width, c.height);
      ctx.fillStyle = 'rgba(255,200,80,0.9)';
      ctx.font = '14px VT323, monospace';
      ctx.fillText(new Date().toISOString().slice(0, 16).replace('T', ' '), 6, 130);
      this.pendingPhoto.thumb = c.toDataURL('image/jpeg', 0.7);
      this.pendingPhoto.img = c;
      const im = this.viewfinder.querySelector('#vf-last');
      im.src = this.pendingPhoto.thumb;
      im.style.display = 'block';
      clearTimeout(this._imT);
      this._imT = setTimeout(() => { im.style.display = 'none'; }, 2500);
    } catch (e) { /* ignore */ }
    this.pendingPhoto = null;
  }

  // ------------------------------------------------------------------
  _draw(ctx, w, h, pal, t) {
    const g = this.game;
    const l = g.local;
    const s = l.survival;
    // header: tab strip + day
    const tabs = ['STAT', 'CAM', 'RSCH', 'MAP', 'MSG', 'TASK'];
    const tw = (w - 12) / tabs.length;
    tabs.forEach((n, i) => {
      const sel = i === this.tabIdx;
      if (sel) { ctx.fillStyle = pal.fg; ctx.fillRect(6 + i * tw, 4, tw - 3, 30); }
      text(ctx, n, 6 + i * tw + tw / 2 - 1, 4, 28, sel ? pal.bg : pal.dim, 'center');
    });
    text(ctx, `DAY ${g.day.active ? g.day.day : '-'}/7`, 10, 38, 34, pal.hi);
    text(ctx, g.day.active ? `${g.day.leftString()}` : 'HQ', w - 10, 38, 34, pal.fg, 'right');
    ctx.fillStyle = pal.dim;
    ctx.fillRect(6, 74, w - 12, 2);
    const y0 = 80;
    switch (this.tab) {
      case 'status': this._status(ctx, w, h, pal, t, y0, s); break;
      case 'camera': {
        text(ctx, 'RESEARCH CAMERA', 20, y0 + 10, 34, pal.hi);
        text(ctx, `FILM: ${12 - (l.photos?.length || 0)}/12`, 20, y0 + 56, 30, pal.fg);
        text(ctx, 'AIM AT ANOMALIES,', 20, y0 + 110, 28, pal.fg);
        text(ctx, 'MONSTERS & STILL LIFES.', 20, y0 + 140, 28, pal.fg);
        text(ctx, '[LMB] CAPTURE', 20, y0 + 200, 30, Math.floor(t * 2) % 2 ? pal.hi : pal.dim);
        const last = l.photos?.[l.photos.length - 1];
        if (last?.img) { ctx.drawImage(last.img, w - 250, h - 150, 240, 135); box(ctx, w - 250, h - 150, 240, 135, pal.fg); }
        break;
      }
      case 'research': {
        text(ctx, `CREDITS: ${g.run.credits} CR`, 20, y0 + 4, 32, pal.hi);
        text(ctx, 'PHOTOS (transmit at radio):', 20, y0 + 44, 24, pal.dim);
        const ph = l.photos || [];
        ph.slice(-6).forEach((p, i) => text(ctx, `- ${p.subject.slice(0, 26)} ${p.value}`, 26, y0 + 72 + i * 26, 24, p.value ? pal.fg : pal.dim));
        if (!ph.length) text(ctx, '  (none)', 26, y0 + 72, 24, pal.dim);
        const jars = l.inv.slots.filter((x) => x && x.type === 'sample_jar');
        text(ctx, 'SAMPLES HELD:', 20, y0 + 250, 24, pal.dim);
        jars.forEach((j, i) => text(ctx, `- ${j.state.kind ? SAMPLES[j.state.kind]?.name : 'empty jar'}`, 26, y0 + 278 + i * 26, 24, j.state.kind ? pal.good : pal.dim));
        if (!jars.length) text(ctx, '  (none)', 26, y0 + 278, 24, pal.dim);
        break;
      }
      case 'map': this._map(ctx, w, h, pal, t, y0); break;
      case 'msg': {
        let y = y0 + 4;
        for (const m of this.messages.slice(0, 9)) {
          const lines = wrap(ctx, `${m.from}: ${m.msg}`, w - 40, 22);
          for (const ln of lines.slice(0, 2)) { text(ctx, ln, 20, y, 22, m.from === 'HEALTHITY' ? pal.good : pal.fg); y += 22; }
          y += 6;
          if (y > h - 30) break;
        }
        if (!this.messages.length) text(ctx, 'NO MESSAGES', 20, y0 + 10, 28, pal.dim);
        break;
      }
      case 'tasks': this._tasks(ctx, w, h, pal, t, y0); break;
      default: break;
    }
  }

  _status(ctx, w, h, pal, t, y0, s) {
    const rows = [
      ['HP', s.health / 100, s.health < 30],
      ['BLD', s.blood / 5000, s.blood < 3200],
      ['FOOD', s.hunger / 100, s.hunger < 25],
      ['H2O', s.thirst / 100, s.thirst < 25],
      ['REST', s.rest / 100, s.rest < 25],
      ['SAN', s.sanity / 100, s.sanity < 30],
    ];
    rows.forEach(([label, f, warn], i) => {
      const y = y0 + 4 + i * 33;
      text(ctx, label, 10, y, 28, warn ? pal.bad : pal.fg);
      bar(ctx, 76, y + 4, 176, 22, f, warn ? pal.bad : pal.fg, pal.dim);
    });
    const x2 = 268;
    text(ctx, `BP ${s.bpSys}/${s.bpDia}`, x2, y0 + 4, 30, s.bpSys < 90 ? pal.bad : pal.hi);
    text(ctx, `HR ${Math.round(s.heartRate)}`, x2, y0 + 36, 30, s.heartRate > 140 ? pal.bad : pal.hi);
    text(ctx, `${s.temp.toFixed(1)}C  INF ${Math.round(s.infection)}%`, x2, y0 + 68, 24, s.infection > 50 ? pal.bad : pal.fg);
    // EKG
    const ey = y0 + 140, eh = 34;
    ctx.strokeStyle = pal.fg;
    ctx.lineWidth = 3;
    ctx.beginPath();
    const n = this.ekg.length;
    for (let i = 0; i < n; i++) {
      const v = this.ekg[(this.ekgI + 1 + i) % n];
      const x = x2 + (i / (n - 1)) * (w - x2 - 10);
      const y = ey - v * eh;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    const conds = s.conditions();
    const lines = conds.length ? conds.slice(0, 3) : ['NOMINAL'];
    lines.forEach((c, i) => text(ctx, c, x2, y0 + 172 + i * 26, 24, conds.length ? pal.bad : pal.good));
    void t;
  }

  _map(ctx, w, h, pal, t, y0) {
    const g = this.game;
    const lvl = g.world.level;
    const l = g.local;
    if (!lvl.visited) {
      text(ctx, 'HQ FLOORPLAN', 20, y0 + 10, 32, pal.hi);
      text(ctx, 'SUBLEVEL B4 — no mapping needed.', 20, y0 + 56, 24, pal.fg);
      text(ctx, 'Reception · Office · Lockers', 20, y0 + 96, 24, pal.dim);
      text(ctx, 'Break Room · Cloning Lab · Dispatch', 20, y0 + 122, 24, pal.dim);
      return;
    }
    const cx = Math.floor(l.pos.x / CELL), cz = Math.floor(l.pos.z / CELL);
    const R = 7;
    const cs = Math.floor((Math.min(w, h - y0) - 30) / (R * 2 + 1));
    const ox = w / 2 - cs / 2 - (l.pos.x / CELL - cx - 0.5) * cs, oy = y0 + (h - y0) / 2 - cs / 2 - (l.pos.z / CELL - cz - 0.5) * cs;
    ctx.save();
    ctx.beginPath();
    ctx.rect(10, y0, w - 20, h - y0 - 10);
    ctx.clip();
    ctx.shadowBlur = 0;
    for (let dj = -R; dj <= R; dj++) {
      for (let di = -R; di <= R; di++) {
        const i = cx + di, j = cz + dj;
        if (!lvl.visited.has(`${i},${j}`)) continue;
        const x = ox + di * cs, y = oy + dj * cs;
        ctx.fillStyle = 'rgba(77,255,122,0.16)';
        ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
        ctx.strokeStyle = pal.fg;
        ctx.lineWidth = 2;
        const vf = lvl.variantFn;
        const n = lvl.mapWall ? lvl.mapWall(i, j, false) : wallN(lvl.seed, i, j, vf), wv = lvl.mapWall ? lvl.mapWall(i, j, true) : wallW(lvl.seed, i, j, vf);
        if (n && n !== W.ARCH) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + cs, y); ctx.stroke(); }
        if (wv && wv !== W.ARCH) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + cs); ctx.stroke(); }
      }
    }
    const toMap = (p) => [ox + (p.x / CELL - cx) * cs, oy + (p.z / CELL - cz) * cs];
    // markers
    const m = lvl.mission;
    if (m) {
      for (const gen of m.generators) {
        const known = lvl.visited.has(`${Math.floor(gen.root.position.x / CELL)},${Math.floor(gen.root.position.z / CELL)}`) || g.day.day >= 2;
        const [x, y] = toMap(gen.root.position);
        if (!known) continue;
        ctx.fillStyle = gen.running ? pal.good : pal.bad;
        ctx.fillRect(x - 6, y - 6, 12, 12);
        text(ctx, gen.label.slice(-1), x + 8, y - 12, 22, pal.hi);
      }
      const radio = m.radio();
      if (radio) {
        const [x, y] = toMap(radio.root.position);
        ctx.strokeStyle = pal.hi;
        ctx.strokeRect(x - 5, y - 5, 10, 10);
        text(ctx, 'R', x + 7, y - 12, 20, pal.hi);
      }
      if (m.state.exit) {
        const [x, y] = toMap(new THREE.Vector3(m.state.exit.x, 0, m.state.exit.z));
        if (Math.floor(t * 3) % 2) { ctx.fillStyle = pal.hi; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill(); }
        text(ctx, 'EXIT', x + 10, y - 12, 22, pal.hi);
      }
    }
    for (const r of g.remotes.values()) {
      if (!r.inWorld) continue;
      const [x, y] = toMap(r.pos);
      ctx.fillStyle = r.dead ? pal.bad : '#9fd8ff';
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    }
    // player arrow
    const [px, py] = toMap(l.pos);
    ctx.translate(px, py);
    ctx.rotate(-l.yaw);
    ctx.fillStyle = pal.hi;
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(7, 8); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill();
    ctx.restore();
    text(ctx, 'N', w - 30, y0 + 4, 24, pal.dim);
  }

  _tasks(ctx, w, h, pal, t, y0) {
    const g = this.game;
    const m = g.world.level?.mission;
    if (!m) {
      text(ctx, 'HQ OBJECTIVES', 20, y0 + 6, 32, pal.hi);
      ['- Customize at your LOCKER', '- Grab snacks in the BREAK ROOM', '- Read the ORIENTATION terminal', '- Gather your team in the', '  DISPATCH BAY & pull the lever'].forEach((s, i) => text(ctx, s, 20, y0 + 50 + i * 30, 26, pal.fg));
      return;
    }
    text(ctx, `DIMENSION 0 · INTEGRITY ${Math.round((1 - g.day.instability()) * 100)}%`, 20, y0 + 4, 26, pal.hi);
    let y = y0 + 40;
    for (const gen of m.generators) {
      const done = gen.running;
      text(ctx, `[${done ? 'X' : ' '}] Repair ${gen.label}`, 20, y, 26, done ? pal.good : pal.fg);
      y += 28;
      text(ctx, `[${gen.state.linked ? 'X' : ' '}]   uplink radio${gen.state.link > 0 && !gen.state.linked ? ` ${Math.round(gen.state.link * 100)}%` : ''}`, 20, y, 22, gen.state.linked ? pal.good : pal.dim);
      y += 26;
    }
    const ex = m.state.exit;
    text(ctx, `[${m.state.extraction ? 'X' : ' '}] Request extraction (radio)`, 20, y + 4, 26, m.state.extraction ? pal.good : pal.fg);
    y += 34;
    text(ctx, `[ ] Evacuate${ex && !ex.done ? ` — ${Math.ceil(m.exitTimeLeft())}s` : ''}`, 20, y, 26, ex ? pal.hi : pal.fg);
    void t;
  }

  dispose() { this.viewfinder.remove(); }
}
