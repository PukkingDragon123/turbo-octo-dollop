// Screen UI, kept minimal (docs/ART_DIRECTION.md): warm ivory ink with one soft shadow, thin hand-drawn lines,
// Jolly Lodger, no boxes, no glass. Pieces: the crosshair, the use prompt, progress / timing lines, the pause /
// settings / controls / notice screens, the wardrobe, loading, death and the end-of-run summary. Messages are
// floating 3D text (ui/floattext.js) and the wristwatch (ui/watch.js), never screen boxes.
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { input } from '../core/input.js';
import { net } from '../net/net.js';
import { audio } from '../audio/audio.js';
import { profile, ACHIEVEMENTS } from '../core/profile.js';
import { buildModel } from '../entities/catalog.js';
import { itemName, SAMPLES } from '../game/itemdefs.js';
import { Avatar, COSMETICS } from '../entities/avatar.js';
import { buildStillLife } from '../entities/optional.js';
import { damp } from '../core/rng.js';
import { Q } from '../physics/physics.js';
import { LobbyPanel } from './lobbypanel.js';
import { floatText } from './floattext.js';
import { ICON } from './touch.js';

// floating text is all one ink; the kinds stay so callers can keep passing them
const MSG_COL = { '': '#f3e6c8', info: '#f3e6c8', good: '#f3e6c8', warn: '#f3e6c8', bad: '#f3e6c8', hq: '#f3e6c8', healthity: '#f3e6c8' };

const $ = (sel, root = document) => root.querySelector(sel);

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

// a touch button's icon inline in text (controls sheet)
const ico = (n) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[n] || ''}"/></svg>`;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// a pen line across a w x h box: a gentle wobble, never ruler straight (seeded, so it is the same every time)
export function penLine(w, h, seed = 1, amp = 0.9) {
  let s = seed * 7919 + 13;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const y = h / 2, n = 6;
  let d = `M1 ${(y + (rnd() - 0.5) * amp).toFixed(2)}`;
  for (let i = 1; i <= n; i++) {
    const x = 1 + ((w - 2) * i) / n, cx = x - (w - 2) / n / 2;
    d += `Q${cx.toFixed(1)} ${(y + (rnd() - 0.5) * amp * 2).toFixed(2)} ${x.toFixed(1)} ${(y + (rnd() - 0.5) * amp).toFixed(2)}`;
  }
  return d;
}
// a pen circle (a little uneven, the end running past the start)
export function penRing(cx, cy, r, seed = 1, wob = 0.05) {
  let s = seed * 104729 + 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const p1 = rnd() * 6.28, a0 = rnd() * 6.28, N = 28, sweep = Math.PI * 2 + 0.35;
  let d = '';
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const a = a0 + (sweep * i) / N, rr = r * (1 + wob * Math.sin(2 * a + p1) + (i / N) * wob * 0.8);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < pts.length - 1; i++) d += `Q${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)} ${((pts[i][0] + pts[i + 1][0]) / 2).toFixed(2)} ${((pts[i][1] + pts[i + 1][1]) / 2).toFixed(2)}`;
  return d;
}
// a flatline: two weak beats, then nothing (death screen)
function flatline() {
  const pts = [[0, 20.6], [26, 19.8], [44, 20.4], [50, 12], [55, 29], [60, 17], [64, 20.2], [92, 19.7], [98, 15.5], [102, 24], [106, 19.9], [140, 20.5], [170, 19.8], [200, 20.3]];
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('');
}
const LINE = (w, h, seed, cls = '') => `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path class="track" d="${penLine(w, h, seed)}"/>${cls ? `<path class="${cls}" pathLength="100" d="${penLine(w, h, seed + 1)}"/>` : ''}</svg>`;

export class UI {
  constructor() {
    this.game = null;
    this.root = el('<div id="ui"></div>');
    document.body.appendChild(this.root);
    this.root.innerHTML = `
      <div id="hud" class="hidden">
        <div id="crosshair"><svg viewBox="0 0 22 22" aria-hidden="true"><path class="ring" d="${penRing(11, 11, 8, 3, 0.04)}"/><circle class="dot" cx="11" cy="11" r="1.7"/></svg></div>
        <div id="prompt"></div>
        <div id="progress"><div class="label"></div>${LINE(200, 8, 4, 'fill')}</div>
        <div id="timing"><div class="lbl">Pull</div><div class="stage">${LINE(260, 8, 9)}<div class="zone"></div><div class="needle"></div></div></div>
        <div id="voiceind"><i></i>talking</div>
        <div id="death"><div class="t">Clone lost</div><svg class="flat" viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true"><path pathLength="100" d="${flatline()}"/></svg><div class="c"></div><div class="rc"><div class="eta"></div><div class="fee"></div></div><div class="s"></div></div>
      </div>
      <div id="clickstart">${input.touch ? 'Tap to carry on' : 'Click to carry on'}</div>
      <div id="pause" class="screen"><div class="sheet">
        <h2>Paused</h2>
        <div class="sub" id="pause-code"></div>
        <div class="menu">
          <button class="btn interactive" data-act="resume">Carry on</button>
          <button class="btn interactive" data-act="settings">Settings</button>
          <button class="btn interactive" data-act="controls">Controls</button>
          <button class="btn interactive" data-act="leave">Leave</button>
        </div>
        <div class="hint">The rooms keep humming while you rest. Nothing out there waits for you.</div>
      </div></div>
      <div id="settings" class="screen"><div class="sheet">
        <h2>Settings</h2>
        <div class="grid2">
          <span>Volume</span><input class="interactive" type="range" min="0" max="1" step="0.05" data-set="master"/>
          <span>Effects</span><input class="interactive" type="range" min="0" max="1" step="0.05" data-set="sfx"/>
          <span>Music</span><input class="interactive" type="range" min="0" max="1" step="0.05" data-set="music"/>
          <span>Ambience</span><input class="interactive" type="range" min="0" max="1" step="0.05" data-set="ambient"/>
          <span>Voices</span><input class="interactive" type="range" min="0" max="1.5" step="0.05" data-set="voice"/>
          <span>Look speed</span><input class="interactive" type="range" min="0.2" max="3" step="0.05" data-set="sensitivity"/>
          <span>Invert look</span><select class="interactive" data-set="invertY"><option value="false">Off</option><option value="true">On</option></select>
          <span>Graphics</span><select class="interactive" data-set="quality"><option value="low">Light</option><option value="medium">Balanced</option><option value="high">Full</option></select>
          <span>Microphone</span><select class="interactive" data-set="voiceMode"><option value="open">Always open</option><option value="ptt">Push to talk [V]</option><option value="off">Off</option></select>
        </div>
        <div class="menu"><button class="btn interactive" data-act="back">Back</button></div>
      </div></div>
      <div id="controls" class="screen"><div class="sheet">
        <h2>Controls</h2>
        <div class="touch-only ctl">
          <div>Put a thumb down on the left to walk; push to the edge to run.</div>
          <div>Drag on the right to look. A quick tap uses what is under the dot.</div>
          <div>${ico('fist')} punch, or use what is in your hand: eat, drink, swing. Carrying something, it throws ${ico('throw')}</div>
          <div>${ico('hand')} tap to use or pick up, hold to grab and carry. Tap it again to let go.</div>
          <div>${ico('jump')} jump · ${ico('crouch')} crouch</div>
          <div>Small rings fade in when they help: ${ico('rotate')} rotate what you carry, ${ico('drop')} drop (hold: all), ${ico('swap')} swap hands, ${ico('light')} flashlight, ${ico('tool')} multitool</div>
          <div>Top corner: ${ico('pause')} pause and ${ico('watch')} the watch; ${ico('prev')}${ico('next')} under it switch its apps.</div>
        </div>
        <div class="desk-only ctl">
          <div><span class="kbd">WASD</span> move · <span class="kbd">Shift</span> run · <span class="kbd">Ctrl</span> / <span class="kbd">C</span> crouch · <span class="kbd">Space</span> jump</div>
          <div><span class="kbd">E</span> use · <span class="kbd">RMB</span> tap to use or pick up, hold to grab and pull</div>
          <div>while carrying: <span class="kbd">LMB</span> throw · <span class="kbd">Shift</span> throw far · <span class="kbd">Wheel</span> closer / further · <span class="kbd">R</span> + mouse rotate</div>
          <div><span class="kbd">LMB</span> punch (hold to wind up) · with something in your hand, use it</div>
          <div><span class="kbd">Q</span> multitool (hold <span class="kbd">LMB</span> to work, <span class="kbd">R</span> mode) · <span class="kbd">G</span> drop (hold: everything) · <span class="kbd">1-5</span> / <span class="kbd">Wheel</span> swap hands</div>
          <div><span class="kbd">F</span> flashlight · <span class="kbd">Tab</span> watch (<span class="kbd">Q</span> / <span class="kbd">E</span> apps)</div>
          <div><span class="kbd">V</span> talk · <span class="kbd">H</span> wave · <span class="kbd">J</span> dance · <span class="kbd">B</span> point · <span class="kbd">T</span> third person · <span class="kbd">Esc</span> pause</div>
          <div class="dim">The heart at the top of your view is your health, the brain your mind. You carry things in your hands: two fit, more becomes an armful that slows you down.</div>
        </div>
        <div class="menu"><button class="btn interactive" data-act="back">Back</button></div>
      </div></div>
      <div id="custom" class="screen"><div class="sheet"><h2>Wardrobe</h2><div class="sub">Looks only. It changes nothing else.</div><div id="custom-body"></div>
        <div class="menu"><button class="btn interactive" data-act="custom-done">Done</button></div></div></div>
      <div id="runover" class="screen"><div class="sheet"><h2 id="ro-title">The end</h2><div class="stats" id="ro-stats"></div><div class="hint">Your looks and achievements stay with you.</div></div></div>
      <div id="alert" class="screen"><div class="sheet"><div id="alert-text"></div><div class="menu"><button class="btn interactive" data-act="alert-ok">All right</button></div></div></div>
      <div id="loading"><div class="k"></div><div class="t"></div>${LINE(200, 10, 21, 'fill')}<div class="l"></div></div>
    `;
    this.hud = $('#hud', this.root);
    this.menuOpen = true;
    this.screens = {};
    for (const id of ['pause', 'settings', 'controls', 'custom', 'runover', 'alert']) this.screens[id] = $('#' + id, this.root);
    this.promptEl = $('#prompt', this.root);
    this.crossEl = $('#crosshair', this.root);
    this.icons = new Map();
    this.prevScreen = null;
    this.customizing = null;
    this.customAngle = 0;
    // no screen HUD: health / sanity are the 3D heart + brain (ui/vitals3d.js), items sit in the hands
    this.needs = null;
    this.hotbar = null;
    this.lobby = new LobbyPanel(this);
    this.hotbarHiddenByTouch = false;
    this._bind();
    this._iconRig();
  }

  // ------------------------------------------------------------------
  _bind() {
    this.root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      audio.init().then(() => audio.play('ui_select', { volume: 0.5, bus: 'ui' }));
      this._act(b.dataset.act);
    });
    this.root.addEventListener('mouseover', (e) => {
      if (e.target.closest('.btn')) audio.ready && audio.play('ui_blip', { volume: 0.2, bus: 'ui' });
    });
    for (const inp of this.root.querySelectorAll('[data-set]')) {
      const k = inp.dataset.set;
      const v = k === 'quality' ? engine.qualityName : profile.settings[k];
      inp.value = String(v);
      inp.addEventListener('input', () => this._setting(k, inp.value));
      inp.addEventListener('change', () => this._setting(k, inp.value));
    }
    input.onEvent((type, a) => {
      if (type === 'lock') {
        if (!a && this.game?.state === 'playing' && !this.menuOpen && !this.customizing && !this.game.terminal?.active) {
          this.showPause();
        }
        $('#clickstart', this.root).classList.toggle('show', !a && this.game?.state === 'playing' && !this.menuOpen && !this.customizing);
      }
    });
    engine.renderer.domElement.addEventListener('click', () => {
      if (this.game?.state === 'playing' && !this.menuOpen && !this.customizing) input.requestLock();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.customizing) { this._act('custom-done'); return; }
        if (this.screens.settings.classList.contains('show') || this.screens.controls.classList.contains('show')) { this._act('back'); return; }
        if (this.screens.pause.classList.contains('show')) { this._act('resume'); return; }
      }
    });
  }

  _setting(k, raw) {
    let v = raw;
    if (['master', 'sfx', 'music', 'ambient', 'voice', 'sensitivity'].includes(k)) v = parseFloat(raw);
    if (k === 'invertY' || k === 'healthityVoice') v = raw === 'true';
    if (k === 'quality') profile.settings.qualityPicked = true;
    profile.settings[k] = v;
    profile.save();
    this.applySettings();
    if (k === 'quality') engine.setQuality(v);
  }

  applySettings() {
    const s = profile.settings;
    input.sensitivity = s.sensitivity;
    input.invertY = s.invertY;
    if (audio.ready) {
      audio.setBusVolume('master', s.master);
      audio.setBusVolume('sfx', s.sfx);
      audio.setBusVolume('ui', s.sfx);
      audio.setBusVolume('music', s.music);
      audio.setBusVolume('ambient', s.ambient);
      audio.setBusVolume('voice', s.voice);
    }
    this.game?.voice?.setMode(s.voiceMode);
  }

  async _act(a) {
    const g = this.game;
    switch (a) {
      case 'settings': this._show('settings'); break;
      case 'controls': this._show('controls'); break;
      case 'back': this._show(this.prevScreen || (g?.state === 'playing' ? 'pause' : null)); break;
      case 'resume': this.hideMenus(); input.requestLock(); break;
      case 'leave': this.hideMenus(); g.leave(); break;
      case 'custom-done': this.closeCustomizer(); break;
      case 'alert-ok': if (g?.state === 'playing') this._show(null); else this.showMainMenu(); break;
      default: break;
    }
  }

  _show(id) {
    const cur = Object.entries(this.screens).find(([, s]) => s.classList.contains('show'))?.[0];
    if (id === 'settings' || id === 'controls') this.prevScreen = cur && cur !== id ? cur : this.prevScreen;
    for (const [k, s] of Object.entries(this.screens)) s.classList.toggle('show', k === id);
    this.menuOpen = !!id && id !== 'custom';
    if (id) input.exitLock();
    // HUD pieces live above the menu layer: hide them now rather than on the next frame
    if (this.menuOpen) { this.lobby?.setVisible(false); this._watchPanel(false); }
    this.hud.classList.toggle('hidden', !this.game || this.game.state !== 'playing' || id === 'runover');
  }

  // the main menu is the 3D clone factory (world/menu_scene.js): no HTML screen, just free the cursor
  showMainMenu() {
    this._show(null);
    this.menuOpen = false;
    input.exitLock();
  }

  showPause() {
    $('#pause-code', this.root).textContent = net.mode === 'host' ? `Room code ${net.roomCode}` : net.mode === 'client' ? `In room ${net.roomCode}` : '';
    this._show('pause');
  }

  hideMenus() {
    this._show(null);
    this.menuOpen = false;
  }

  alert(text) {
    $('#alert-text', this.root).textContent = text;
    this._show('alert');
  }

  // ------------------------------------------------------------------
  setLoading(on, desc, levelName) {
    const l = $('#loading', this.root);
    l.classList.toggle('show', !!on);
    if (on) {
      // "Level 0 — The Yellow Rooms": the place big, the level number small above it
      const name = String(levelName || 'Level 0 — The Yellow Rooms');
      const m = name.match(/^\s*(level\s+[^—:\-–]+?)\s*[—:\-–]\s*(.+)$/i);
      const lobby = desc?.type === 'lobby';
      $('.k', l).textContent = lobby ? '' : m ? m[1] : '';
      $('.t', l).textContent = lobby ? 'Going back' : m ? m[2] : name;
      $('.l', l).textContent = '';
      $('.fill', l).style.strokeDashoffset = '100';
      audio.ready && audio.play('teleport_whoosh', { volume: 0.5, bus: 'ui' });
    }
  }
  setLoadingProgress(p, label) {
    const l = $('#loading', this.root);
    $('.fill', l).style.strokeDashoffset = String(100 - Math.round(Math.max(0, Math.min(1, p)) * 100));
    if (label) $('.l', l).textContent = String(label).replace(/\.\.\.$/, '…');
  }
  onWorldLoaded(desc) {
    // leaving the run-over screen must also release menuOpen, or the clone can't move
    if (this.screens.runover.classList.contains('show')) this._show(null);
    this.hud.classList.remove('hidden');
    if (desc.type !== 'lobby') {
      const name = this.game?.world?.level?.feedName || 'Level 0: The Yellow Rooms';
      this.feed(`${desc.depth > 1 ? 'Sector ' + desc.depth + ' — ' : ''}${name}`);
    }
  }

  // ------------------------------------------------------------------
  // All messages are floating 3D text (ui/floattext.js): no screen toast / feed boxes. System notices float
  // low in front of the camera; a message from someone who is physically there (Healthity, or a caller
  // passing `at`) hangs next to them. Long radio messages are split into a few bubbles that type in turn.
  toast(text, kind = '') {
    this.game?.watch?.log('SYS', text);
    this._float(String(text), { color: MSG_COL[kind] || MSG_COL[''], size: 0.85 });
  }

  feed(text, kind = '', from = '', at = null) {
    text = String(text);
    this.game?.watch?.log(from || 'SYS', text);
    if (from) this.game?.watch?.notify(text, kind, from);
    const h = this.game?.healthity, o = {};
    if (/^HEALTHITY$/i.test(from) && h?.bot) { h.say('tip', {}, text); return; }
    // HQ: reception speaks from the reception desk when you are in the room
    const desk = !at && /^RECEPTION$/i.test(from) && this.game?.isLobby ? this.game.world?.level?.recDesk?.root : null;
    if (desk && this.game.local?.pos && desk.position.distanceTo(this.game.local.pos) < 8) { at = desk; o.offset = new THREE.Vector3(0, 1.55, 0); }
    if (at) { floatText.say(text, { at, speaker: from || null, color: MSG_COL[kind] || MSG_COL.hq, offset: o.offset, size: 0.8 }); return; }
    this._float(text, { speaker: from || null, color: MSG_COL[kind] || MSG_COL[''] });
  }

  hq(text, from = 'HQ') {
    this.feed(text, 'hq', from);
    if (audio.ready) audio.play('radio_beep', { volume: 0.5, bus: 'ui' });
  }

  achievement(a) {
    this.game?.watch?.notify(`${a.name}: ${a.desc}`, 'good', 'Achievement');
    this._float(`${a.name}\n${a.desc}`, { speaker: 'Achievement', size: 1.05, duration: 5 });
    audio.ready && audio.play('credits', { volume: 0.6, bus: 'ui' });
  }

  // a notice, split into sentence chunks that fit the 4-line plate and appear one after another
  _float(text, o) {
    const now = performance.now();
    if (this._lastFloat === text && now - this._lastFloatT < 1500) return; // the same notice twice in a row
    this._lastFloat = text; this._lastFloatT = now;
    const parts = [];
    let cur = '';
    for (const s of text.match(/[^.!?\n]+[.!?]*\s*|\n/g) || [text]) {
      if (s === '\n') { cur += '\n'; continue; }
      if ((cur + s).trim().length > 120 && cur.trim()) { parts.push(cur.trim()); cur = ''; }
      cur += s;
    }
    if (cur.trim()) parts.push(cur.trim());
    let delay = 0;
    parts.forEach((p, i) => {
      const dur = (o.duration || 2.6) + p.length * 0.055 + (parts.length - 1 - i) * 0.6;
      const fire = () => floatText.notice(p, { ...o, speaker: i === 0 ? o.speaker : o.speaker ? `${o.speaker} ${i + 1}/${parts.length}` : null, duration: dur });
      if (delay <= 0) fire(); else setTimeout(fire, delay * 1000);
      delay += p.length / 48 + 0.9;
    });
  }

  progress(frac, label = '') {
    const p = $('#progress', this.root);
    if (frac === null || frac === undefined) { if (p.style.display !== 'none') p.style.display = 'none'; return; }
    p.style.display = 'block';
    const lab = $('.label', p);
    if (lab.textContent !== label) lab.textContent = label;
    $('.fill', p).style.strokeDashoffset = String(100 - Math.round(Math.max(0, Math.min(1, frac)) * 100));
  }

  timing(frac, a = 0.45, b = 0.62, label = 'Pull') {
    const t = $('#timing', this.root);
    if (frac === null || frac === undefined) { if (t.style.display !== 'none') t.style.display = 'none'; return; }
    t.style.display = 'block';
    const lab = $('.lbl', t), nice = String(label).charAt(0) + String(label).slice(1).toLowerCase();
    if (lab.textContent !== nice) lab.textContent = nice;
    const z = $('.zone', t);
    z.style.left = `${a * 100}%`;
    z.style.width = `${(b - a) * 100}%`;
    $('.needle', t).style.left = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  }

  // pickup feedback: the item's icon flies from the crosshair into the wrist terminal
  flyToWrist(type) {
    const src = this.icon(type);
    if (!src) return;
    const im = el('<img class="flyitem" alt=""/>');
    im.src = src;
    this.root.appendChild(im);
    requestAnimationFrame(() => requestAnimationFrame(() => im.classList.add('go')));
    setTimeout(() => im.remove(), 900);
  }

  shortItem(it) {
    if (!it) return '';
    const n = it.type === 'sample_jar' && it.state.kind ? (SAMPLES[it.state.kind]?.name || 'Sample') : itemName(it.type);
    return n.toUpperCase().split(/\s+/).slice(-1)[0].slice(0, 9);
  }

  setPrompt(t) {
    this._prompt = t;
  }

  // "[E] Pick up · [RMB] drag": keys in honey with a pen underline (on touch the keys are left out: the
  // ring buttons say it), parts separated by a soft dot
  _renderPrompt(text) {
    if (text === this._promptSrc) return;
    this._promptSrc = text;
    if (!text) { this.promptEl.textContent = ''; return; }
    const parts = String(text).split(/\s+·\s+/).map((p) => {
      if (input.touch) return esc(p.replace(/\[[^\]]*\]\s*/g, '').trim());
      return esc(p).replace(/\[([^\]]+)\]/g, (m0, k) => `<span class="key">${k}</span>`);
    }).filter(Boolean);
    this.promptEl.innerHTML = parts.join('<span class="sep">·</span>');
  }

  // where the Healthity pop-up may start (px from the top): below the sleeve patch, the touch button column
  // (portrait) and an open portrait watch panel
  _popBase() {
    let y = Math.max(this.game?.local?.vitals?.bottomPx || 0, this.lobby.bottomPx || 0);
    const t = this.game?.touch;
    if (t && window.innerHeight > window.innerWidth && t.topBottom) y = Math.max(y, t.topBottom);
    return y;
  }

  popTopPx() {
    let y = this._popBase();
    const wp = this.watchPanelEl;
    if (wp && wp.classList.contains('show')) y = Math.max(y, wp.getBoundingClientRect().bottom);
    return y;
  }

  _watchPanel(on, open) {
    if (!this.watchPanelEl) {
      if (!on) return;
      this.watchPanelEl = el('<div id="pxwatch"><div class="wp-in"></div></div>');
      document.body.appendChild(this.watchPanelEl);
    }
    const w = this.game?.watch;
    const wp = this.watchPanelEl;
    const inner = wp.firstChild;
    if (on && w && w.screen.canvas.parentNode !== inner) { inner.appendChild(w.screen.canvas); w.screen.lastDraw = -1; }
    wp.classList.toggle('show', !!on);
    wp.classList.toggle('glance', !!on && !open);
    if (!on) return;
    // fit between the top HUD and the pockets / tab strip
    const rowTop = window.innerHeight * 0.8;
    const border = 14; // the panel's bezel (style.css #pxwatch padding)
    const st = wp.style;
    if (open) {
      const top = this._popBase() + 6;
      const avail = rowTop - 12 - top;
      let width = Math.min(window.innerWidth * 0.94, 520);
      if (width * 0.75 + border > avail) width = Math.max(180, (avail - border) / 0.75);
      st.top = `${Math.round(top)}px`; st.bottom = ''; st.width = `${Math.round(width)}px`;
    } else {
      // glance: a small pager under the top HUD, clear of the crosshair (Healthity steps below it)
      const top = this._popBase() + 6;
      const barTop = rowTop;
      const width = Math.max(150, Math.min(window.innerWidth * 0.62, 250, (barTop - 8 - top - border) / 0.75));
      st.top = `${Math.round(top)}px`; st.bottom = ''; st.width = `${Math.round(width)}px`;
    }
  }

  runOver(stats) {
    $('#ro-title', this.root).textContent = stats.reason || 'The end';
    const m = Math.floor((stats.time || 0) / 60), sec = Math.floor((stats.time || 0) % 60);
    const rows = [['Days', stats.day], ['Levels crossed', Math.max(0, (stats.depth || 1) - 1)], ['Clones lost', stats.deaths], ['Time', `${m}:${String(sec).padStart(2, '0')}`]];
    $('#ro-stats', this.root).innerHTML = rows.filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `<div>${esc(k)}<b>${esc(v)}</b></div>`).join('');
    this._show('runover');
  }

  // ------------------------------------------------------------------
  // Locker customizer
  openCustomizer(onClose) {
    this.customizing = { onClose };
    input.exitLock();
    this.customAngle = 0;
    // turn the clone around to face the room, so the camera can stand in front of it instead of inside the lockers
    const l = this.game?.local;
    if (l) { l.yaw += Math.PI; l.pitch = 0; }
    this._renderCustom();
    this.screens.custom.classList.add('show');
  }

  closeCustomizer() {
    if (!this.customizing) return;
    const cb = this.customizing.onClose;
    this.customizing = null;
    this.screens.custom.classList.remove('show');
    cb?.();
    profile.data.cosmetics = this.game.local.cosmetics;
    profile.save();
    net.toHost('cosmetics', this.game.local.cosmetics);
    input.requestLock();
  }

  _renderCustom() {
    const body = $('#custom-body', this.root);
    body.innerHTML = '';
    const cur = this.game.local.cosmetics;
    for (const [cat, list] of Object.entries(COSMETICS || {})) {
      const c = el(`<div class="cat"><div class="name">${esc(cat.charAt(0).toUpperCase() + cat.slice(1))}</div><div class="opts"></div></div>`);
      const opts = $('.opts', c);
      for (const o of list) {
        const locked = o.unlock && !profile.has(o.unlock);
        const b = el(`<button class="opt interactive ${cur[cat] === o.id ? 'on' : ''} ${locked ? 'locked' : ''}"></button>`);
        b.textContent = o.name || o.id;
        if (locked) b.title = `Locked: ${ACHIEVEMENTS[o.unlock]?.name || o.unlock} — ${ACHIEVEMENTS[o.unlock]?.desc || ''}`;
        b.addEventListener('click', () => {
          if (locked) { audio.play('ui_error', { volume: 0.4, bus: 'ui' }); this.toast(b.title, 'warn'); return; }
          this.game.local.setCosmetics({ [cat]: o.id });
          audio.play('suit_rustle', { volume: 0.6 });
          this._renderCustom();
        });
        opts.appendChild(b);
      }
      body.appendChild(c);
    }
  }

  // ------------------------------------------------------------------
  // Item icons & portraits rendered with the main renderer into a render target
  _iconRig() {
    this.iconScene = new THREE.Scene();
    this.iconScene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.6));
    const d = new THREE.DirectionalLight(0xffffff, 2.2);
    d.position.set(1, 2, 2);
    this.iconScene.add(d);
    this.iconCam = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
    this.iconRT = new THREE.WebGLRenderTarget(128, 128);
    this.portraitRT = new THREE.WebGLRenderTarget(192, 256);
  }

  _renderToCanvas(obj, rt, w, h, camDir = new THREE.Vector3(0.6, 0.45, 1), fill = 1.0, env = null) {
    const r = engine.renderer;
    const scene = this.iconScene;
    scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const cam = this.iconCam;
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    cam.position.copy(c).addScaledVector(camDir.normalize(), (size * 1.0) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * 0.6 / fill);
    cam.lookAt(c);
    const prevRT = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    const prevTM = r.toneMapping;
    scene.environment = env || engine.studioEnv || engine.defaultEnv;
    r.setRenderTarget(rt);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(scene, cam);
    const px = new Uint8Array(w * h * 4);
    r.readRenderTargetPixels(rt, 0, 0, w, h, px);
    r.setRenderTarget(prevRT);
    r.setClearColor(prevClear, prevAlpha);
    r.toneMapping = prevTM;
    scene.remove(obj);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = ((h - 1 - y) * w + x) * 4, di = (y * w + x) * 4;
        for (let k = 0; k < 3; k++) img.data[di + k] = Math.min(255, 255 * Math.pow(px[si + k] / 255, 1 / 2.2));
        img.data[di + 3] = px[si + 3];
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  // item icon: a small 3D render of the model on a transparent ground (data URL, cached)
  icon(type) {
    if (this.icons.has(type)) return this.icons.get(type);
    let url = '';
    try {
      const m = buildModel(type, { seed: 1 });
      if (!this.iconRT96) this.iconRT96 = new THREE.WebGLRenderTarget(96, 96);
      url = this._renderToCanvas(m.object, this.iconRT96, 96, 96, new THREE.Vector3(0.7, 0.6, 1)).toDataURL();
    } catch (e) { url = ''; }
    this.icons.set(type, url);
    return url;
  }

  portrait(cosmetics, wrong) {
    try {
      let obj;
      if (wrong && buildStillLife) obj = buildStillLife('twin', 7).root;
      else {
        const a = new Avatar(cosmetics || this.game.local.cosmetics);
        a.update(0.016, { speed: 0, grounded: true, expression: 'happy', moveDir: new THREE.Vector2() });
        obj = a.root;
      }
      // characters face -Z, so the portrait camera sits on that side
      return this._renderToCanvas(obj, this.portraitRT, 192, 256, new THREE.Vector3(-0.15, 0.1, -1), 1.6);
    } catch (e) {
      return null;
    }
  }

  // ------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    if (!g || g.state !== 'playing' || !g.world) { this.lobby.setVisible(false); return; }
    const l = g.local;
    const s = l.survival;
    const loading = $('#loading', this.root).classList.contains('show');
    const view = !this.menuOpen && !this.customizing && !g.terminal?.active && !loading && !this.hud.classList.contains('hidden');
    // HQ: the shift roster with START SHIFT (host) while everyone walks around
    const ph = g.world.level?.elevator?.state?.ph;
    this.lobby.setVisible(view && g.isLobby && !g.menuBackdrop && ph !== 'depart');
    this.lobby.update(dt);
    // prompt & crosshair
    let prompt = l.dead ? null : g.terminal?.active ? null : l.focus?.prompt || this._prompt;
    this._renderPrompt(prompt || '');
    const cross = l.grab ? 'grab' : l.focus?.prompt ? 'focus' : '';
    if (this.crossEl.className !== cross) this.crossEl.className = cross;
    this.crossEl.style.display = l.dead || g.terminal?.active || this.customizing ? 'none' : 'block';
    // death screen
    const death = $('#death', this.root);
    death.classList.toggle('show', l.dead);
    if (l.dead) {
      const cause = `${s.deathCause || 'unknown'}`;
      const c = `${cause.charAt(0).toUpperCase()}${cause.slice(1)}`;
      if ($('.c', death).textContent !== c) $('.c', death).textContent = c;
      // auto re-cloning: a new clone wakes at camp after a countdown
      const mission = g.world.level?.mission;
      let eta = null;
      try { eta = mission?.reviveEta?.(net.selfId) ?? null; } catch (e) { eta = null; }
      const auto = !!g.autoClone || eta != null;
      const rc = $('.rc', death);
      rc.style.display = auto ? '' : 'none';
      if (auto) {
        const etaTxt = eta != null ? (eta > 0.5 ? `A new clone wakes in ${Math.ceil(eta)}s` : 'A new clone is waking\u2026') : 'A new clone will wake at camp';
        if ($('.eta', rc).textContent !== etaTxt) $('.eta', rc).textContent = etaTxt;
      }
      const sp = l.spectating;
      const sw = input.touch ? 'the arrows switch' : '<span class="kbd">LMB</span> / <span class="kbd">RMB</span> switch';
      const html = sp ? `Watching ${esc(sp.name)} · ${sw}${auto ? '' : '<br/>A teammate can wake you again at the cloning pad'}` : auto ? '' : 'Nobody is left standing\u2026';
      if (this._deathHtml !== html) { this._deathHtml = html; $('.s', death).innerHTML = html; $('.s', death).style.display = html ? '' : 'none'; }
    }
    // voice indicator
    $('#voiceind', this.root).classList.toggle('on', !!g.voice?.transmitting);
    // locker customizer camera
    if (this.customizing) {
      const cam = engine.camera;
      this.customAngle += dt * 0.25;
      const target = l.pos.clone().setY(l.pos.y + 0.72);
      const ang = l.yaw + Math.sin(this.customAngle) * 0.6;
      // stand in front of the clone and look slightly to its left so it sits right of the panel
      const fwd = new THREE.Vector3(-Math.sin(ang), 0, -Math.cos(ang));
      const right = new THREE.Vector3(Math.cos(ang), 0, -Math.sin(ang));
      const pos = target.clone().addScaledVector(fwd, 2.1).add(new THREE.Vector3(0, 0.2, 0));
      const dir = pos.clone().sub(target), dist = dir.length();
      const hit = g.world?.physics.raycast(target, dir.normalize(), dist, Q.world);
      if (hit) pos.copy(target).addScaledVector(dir, Math.max(0.7, hit.dist - 0.25));
      // the player re-seats the camera at eye height every frame, so ease a persistent position instead
      if (!this.customCamPos) this.customCamPos = cam.position.clone();
      this.customCamPos.lerp(pos, Math.min(1, dt * 4));
      cam.position.copy(this.customCamPos);
      cam.lookAt(target.clone().addScaledVector(right, 0.62));
      l.avatar.root.visible = true;
      l.arms.root.visible = false;
    } else this.customCamPos = null;
    // raised wrist terminal: steer the viewmodel camera onto the watch face (stronger on small screens)
    const ws = l.arms?.watchScreen;
    const raise = l.dead || this.customizing ? 0 : Math.max(0, Math.min(1, (l.watchRaised - 0.25) / 0.75));
    // portrait screens are too narrow for the 3D close-up: the watch face is shown as a framed panel instead
    const portrait = window.innerHeight > window.innerWidth * 1.15;
    const panel = portrait && view && !l.dead && (l.watchOpen || (g.watch?.peeking && !l.grab)) && raise > 0.3;
    this._watchPanel(panel, l.watchOpen);
    if (ws && raise > 0 && !portrait) {
      if (!this._wsPos) this._wsPos = new THREE.Vector3();
      ws.getWorldPosition(this._wsPos);
      engine.vmFocus = this._wsPos;
      const small = Math.min(window.innerWidth, window.innerHeight) < 600 ? 1 : 0.7;
      engine.vmFocusW = raise * raise * (3 - 2 * raise) * small * (l.watchOpen ? 1 : 0.15);
    } else engine.vmFocusW = 0;
    floatText.watchRaise = l.watchOpen && !portrait ? raise : 0; // keep notices off the raised watch face
    // post fx from survival state (each param is optional: the post stack may drop one)
    const P = engine.post?.params || {};
    const set = (k, v) => { if (P[k]) P[k].value = v; };
    const get = (k) => P[k]?.value ?? 0;
    set('uDamage', damp(get('uDamage'), Math.max(s.damageFlash, s.health < 30 ? 0.35 + Math.sin(g.time * 3) * 0.1 : 0, s.bleed >= 2 ? 0.25 : 0), 6, dt));
    const lowbp = Math.max(0, (3400 - s.blood) / 2000);
    set('uBlur', damp(get('uBlur'), Math.min(1, lowbp + (s.rest < 15 ? 0.35 : 0) + (s.microsleep > 0 ? 1 : 0)), 3, dt));
    set('uDesat', damp(get('uDesat'), l.dead ? 1 : Math.min(0.6, lowbp * 0.5), 2, dt));
    set('uScan', l.dead ? 0.5 : 0); // dead / spectating: the post stack fades the view like an old photograph
    if (s.microsleep > 0) set('uFade', Math.max(get('uFade'), Math.min(1, s.microsleep * 2)));
    else if (!g.cutscene) set('uFade', damp(get('uFade'), s.sleeping ? 0.85 : 0, 2, dt));
    set('uFlash', damp(get('uFlash'), 0, 10, dt));
  }
}
