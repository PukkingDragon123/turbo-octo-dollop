// HTML overlay UI: retro CRT main menu, minimal HUD, pause/settings, locker customizer,
// death/spectator & run-summary screens, toasts, HQ feed, item icon & portrait rendering.
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
import { installPixelCSS, logoPix, Pix, C, glyph } from './pixelart.js';
import { itemSprite, pixelizeCanvas } from './itemsprites.js';
import { LobbyPanel } from './lobbypanel.js';
import { floatText } from './floattext.js';

const MSG_COL = { '': '#eaf6ee', info: '#cfe8ff', good: '#8dffb0', warn: '#ffc65a', bad: '#ff7a64', hq: '#9fd8ff', healthity: '#a8ffd8' };

const $ = (sel, root = document) => root.querySelector(sel);

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

export class UI {
  constructor() {
    this.game = null;
    this.root = el('<div id="ui"></div>');
    document.body.appendChild(this.root);
    this.root.innerHTML = `
      <div id="hud" class="hidden">
        <div id="crosshair"></div>
        <div id="prompt"></div>
        <div id="progress"><div class="label"></div><div class="bar"><div class="fill"></div></div></div>
        <div id="timing"><div class="lbl">PULL</div><div class="zone"></div><div class="needle"></div></div>
        <div id="voiceind"><i></i>TRANSMITTING</div>
        <div id="netinfo"></div>
        <div id="death"><canvas class="skull"></canvas><div class="t">CLONE TERMINATED</div><canvas class="flat"></canvas><div class="c"></div><div class="rc"><div class="eta"></div><div class="fee"></div></div><div class="s"></div></div>
      </div>
      <div id="clickstart">CLICK TO CONTINUE</div>
      <div id="menu-main" class="screen"><div class="crt">
        <div class="boot"></div>
        <h1><canvas class="logo" aria-label="R.O.O.M."></canvas></h1>
        <div class="logo-sub">RESEARCH OFFICE FOR OTHERWORLDLY MATTERS</div>
        <label>EMPLOYEE DESIGNATION</label>
        <input type="text" id="in-name" maxlength="16" spellcheck="false"/>
        <label>FIRST DIMENSION</label>
        <select class="interactive" data-set="destination" id="in-dest">
          <option value="yellow">LEVEL 0 · THE YELLOW ROOMS</option>
          <option value="poolrooms">LEVEL 37 · THE POOLROOMS</option>
          <option value="grasslands">LEVEL 1.1 · THE GRASSLANDS</option>
        </select>
        <div class="menu" style="margin-top:14px">
          <button class="btn interactive" data-act="solo" data-icon="solo">SOLO SHIFT</button>
          <button class="btn interactive" data-act="host" data-icon="host">HOST SHIFT</button>
          <button class="btn interactive" data-act="join" data-icon="join">JOIN SHIFT</button>
          <button class="btn interactive" data-act="settings" data-icon="gear">SETTINGS</button>
          <button class="btn interactive" data-act="controls" data-icon="pad">CONTROLS</button>
        </div>
        <div id="join-row" style="display:none;margin-top:10px">
          <label>SHIFT CODE</label>
          <div class="row"><input type="text" id="in-code" maxlength="6" spellcheck="false"/><button class="btn interactive" data-act="dojoin" data-icon="ok" style="white-space:nowrap">CONNECT</button></div>
        </div>
        <div class="err" id="menu-err"></div>
        <div class="note" id="menu-note"></div>
        <div class="hint">Host a shift for up to 4 clones (peer-to-peer). Proximity voice chat needs a microphone (optional).</div>
        <div class="tag">v1.0 · SUBLEVEL B4 · (C) 1994 R.O.O.M. CORP</div>
      </div></div>
      <div id="pause" class="screen"><div class="crt">
        <h2>SHIFT PAUSED</h2>
        <div class="sub" id="pause-code"></div>
        <div class="menu">
          <button class="btn interactive" data-act="resume" data-icon="play">RESUME</button>
          <button class="btn interactive" data-act="settings" data-icon="gear">SETTINGS</button>
          <button class="btn interactive" data-act="controls" data-icon="pad">CONTROLS</button>
          <button class="btn interactive" data-act="leave" data-icon="door">CLOCK OUT (LEAVE)</button>
        </div>
        <div class="hint">The world keeps running while paused. Monsters do not take breaks.</div>
      </div></div>
      <div id="settings" class="screen"><div class="crt">
        <h2>SETTINGS</h2>
        <div class="grid2">
          <span>MASTER VOLUME</span><input class="interactive" type="range" min="0" max="1" step="0.05" data-set="master"/>
          <span>EFFECTS</span><input class="interactive" type="range" min="0" max="1" step="0.05" data-set="sfx"/>
          <span>MUSIC</span><input class="interactive" type="range" min="0" max="1" step="0.05" data-set="music"/>
          <span>AMBIENCE</span><input class="interactive" type="range" min="0" max="1" step="0.05" data-set="ambient"/>
          <span>VOICE CHAT</span><input class="interactive" type="range" min="0" max="1.5" step="0.05" data-set="voice"/>
          <span>LOOK SENSITIVITY</span><input class="interactive" type="range" min="0.2" max="3" step="0.05" data-set="sensitivity"/>
          <span>INVERT Y</span><select class="interactive" data-set="invertY"><option value="false">OFF</option><option value="true">ON</option></select>
          <span>GRAPHICS</span><select class="interactive" data-set="quality"><option value="low">LOW</option><option value="medium">MEDIUM</option><option value="high">HIGH</option></select>
          <span>HEALTHITY VOICE</span><select class="interactive" data-set="healthityVoice"><option value="true">ON</option><option value="false">OFF</option></select>
          <span>MICROPHONE</span><select class="interactive" data-set="voiceMode"><option value="open">OPEN MIC</option><option value="ptt">PUSH-TO-TALK [V]</option><option value="off">OFF</option></select>
        </div>
        <div class="menu" style="margin-top:14px"><button class="btn interactive" data-act="back" data-icon="back">BACK</button></div>
      </div></div>
      <div id="controls" class="screen"><div class="crt">
        <h2>CONTROLS</h2>
        <div class="touch-only ctl">
          <div><span class="kbd">LEFT THUMB</span> drag anywhere to walk · push the stick to the rim to sprint</div>
          <div><span class="kbd">RIGHT THUMB</span> drag to look · tap to use what is under the dot</div>
          <div><span class="kbd">USE</span> interact / pick up (a tag shows the action) · <span class="kbd">JUMP</span> · <span class="kbd">DUCK</span> toggle crouch</div>
          <div><span class="kbd">GRAB</span> tap to use / pick up, hold to grab and pull (longer = harder) · <span class="kbd">THROW</span> while carrying · <span class="kbd">ROT</span> hold + drag to rotate</div>
          <div><span class="kbd">PUNCH</span> tap to jab, hold to wind up a haymaker · with an item in hand it uses the item · <span class="kbd">TOOL</span> draws the multitool (hold to charge)</div>
          <div><span class="kbd">WATCH</span> raise the wrist terminal (tap STATUS / MAP / TASK) · <span class="kbd">LIGHT</span> flashlight</div>
          <div><span class="kbd">NEXT</span> swap hands · <span class="kbd">DROP</span> drop (hold: drop everything) · <span class="kbd">MODE</span> multitool attach / dismantle · <span class="kbd">MENU</span> pause</div>
          <div><span class="kbd">HLTH</span> read Healthity's receipt (your orders) or ask for a check-up</div>
        </div>
        <div class="desk-only ctl">
          <div><span class="kbd">WASD</span> move · <span class="kbd">SHIFT</span> sprint · <span class="kbd">CTRL</span>/<span class="kbd">C</span> crouch · <span class="kbd">SPACE</span> jump</div>
          <div><span class="kbd">RMB</span> tap: interact / pick up · hold: GRAB and pull (hold longer to pull harder; teammates too)</div>
          <div>&nbsp;&nbsp;while grabbing: <span class="kbd">SHIFT</span> throw far · <span class="kbd">LMB</span> throw · <span class="kbd">WHEEL</span> push/pull · <span class="kbd">R</span>+mouse rotate</div>
          <div><span class="kbd">LMB</span> punch (hold to wind up; knock teammates out) · with an item in the right hand: use it (eat, drink, heal, swing)</div>
          <div><span class="kbd">Q</span> multitool: hold <span class="kbd">LMB</span> to charge power (attach, detach, dismantle; full charge zaps) · <span class="kbd">R</span> mode</div>
          <div><span class="kbd">E</span> interact · <span class="kbd">G</span> drop (hold: drop all) · <span class="kbd">1-5</span>/<span class="kbd">WHEEL</span> swap hands</div>
          <div><span class="kbd">F</span> flashlight · <span class="kbd">TAB</span> wristwatch (<span class="kbd">Q</span>/<span class="kbd">E</span> STATUS · MAP · TASK)</div>
          <div><span class="kbd">V</span> push-to-talk · <span class="kbd">H</span> wave · <span class="kbd">J</span> dance · <span class="kbd">B</span> point · <span class="kbd">T</span> 3rd person</div>
          <div><span class="kbd">X</span> read Healthity's receipt / check-up · <span class="kbd">ESC</span> pause</div>
          <div class="dim">The mechanical heart (health) and brain (sanity) hang at the top of your view. You carry things in your hands: two items fit, more become an armful that slows you and blocks your fists. Everything else lives on the wristwatch.</div>
        </div>
        <div class="menu" style="margin-top:14px"><button class="btn interactive" data-act="back" data-icon="back">BACK</button></div>
      </div></div>
      <div id="custom" class="screen"><div class="crt"><h2>LOCKER #<span id="locker-no">07</span></h2><div class="sub">COSMETICS ONLY — R.O.O.M. DOES NOT ISSUE UPGRADES</div><div id="custom-body"></div>
        <div class="menu" style="margin-top:10px"><button class="btn interactive" data-act="custom-done" data-icon="ok">CLOSE LOCKER</button></div></div></div>
      <div id="runover" class="screen"><div class="crt"><h2 id="ro-title">SHIFT TERMINATED</h2><div class="stats" id="ro-stats"></div><div class="hint">Returning to headquarters... cosmetics & achievements are kept. Everything else is company property.</div></div></div>
      <div id="alert" class="screen"><div class="crt"><h2>NOTICE</h2><div id="alert-text"></div><div class="menu" style="margin-top:14px"><button class="btn interactive" data-act="alert-ok" data-icon="ok">OK</button></div></div></div>
      <div id="loading"><canvas class="sprite"></canvas><div class="t">DISPATCHING</div><div class="l">...</div><div class="bar"><div></div></div></div>
    `;
    // the artifact build runs in a sandboxed frame without WebRTC: HOST / JOIN stay visible but locked
    if (import.meta.env.VITE_SOLO_ONLY) {
      for (const a of ['host', 'join']) {
        const b = $(`[data-act="${a}"]`, this.root);
        if (b) { b.disabled = true; b.title = 'Online co-op needs the full version'; }
      }
      $('#menu-note', this.root).textContent = 'HOST / JOIN need the full version: this sandboxed build has no online play.';
    }
    this.hud = $('#hud', this.root);
    this.menuOpen = true;
    this.screens = {};
    for (const id of ['menu-main', 'pause', 'settings', 'controls', 'custom', 'runover', 'alert']) this.screens[id] = $('#' + id, this.root);
    this.promptEl = $('#prompt', this.root);
    this.crossEl = $('#crosshair', this.root);
    this.icons = new Map();
    this.iconPixes = new Map();
    this.prevScreen = null;
    this.customizing = null;
    this.customAngle = 0;
    // no screen HUD: health / sanity are the 3D heart + brain (ui/vitals3d.js), items sit in the hands
    this.needs = null;
    this.hotbar = null;
    this.lobby = new LobbyPanel(this);
    this.hotbarHiddenByTouch = false;
    this._pixelArt();
    this._bind();
    this._iconRig();
  }

  // pixel-art pieces of the DOM screens: logo, death skull + flatline, loading sprite
  _pixelArt() {
    installPixelCSS();
    logoPix('R.O.O.M.', 2).toCanvas($('#menu-main canvas.logo', this.root));
    const sk = new Pix(15, 13);
    glyph('skull', C.red2, { pix: sk, x: 2, y: 1 });
    sk.outline(C.ink).shadow(0.5);
    sk.toCanvas($('#death canvas.skull', this.root));
    this._loadPix = new Pix(24, 28);
    this._deathT = 0;
  }

  _hudScale() {
    if (input.touch) return this.game?.touch?.pixelScale || 2;
    const w = window.innerWidth, h = window.innerHeight;
    return Math.max(2, Math.min(4, Math.floor(Math.min(w / 560, h / 300))));
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
    const nameIn = $('#in-name', this.root);
    nameIn.value = profile.name;
    nameIn.addEventListener('change', () => { profile.name = nameIn.value.trim() || profile.name; if (this.game) this.game.local.name = profile.name; });
    $('#in-code', this.root).addEventListener('keydown', (e) => { if (e.key === 'Enter') this._act('dojoin'); });
    for (const inp of this.root.querySelectorAll('[data-set]')) {
      const k = inp.dataset.set;
      const v = k === 'quality' ? engine.qualityName : k === 'healthityVoice' ? profile.settings[k] !== false : k === 'destination' ? (profile.settings[k] || 'yellow') : profile.settings[k];
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
    const err = $('#menu-err', this.root);
    switch (a) {
      case 'solo':
      case 'host': {
        err.textContent = a === 'host' ? 'Opening a line to the matchmaking server...' : '';
        await audio.init();
        this.applySettings();
        try {
          if (a === 'solo') await g.startSolo();
          else {
            const code = await g.startHost();
            this.toast(`SHIFT CODE: ${code}`, 'good');
            this.feed(`Your shift code is ${code}. Give it to up to 3 co-workers.`, 'hq', 'HQ');
          }
          this.hideMenus();
          input.requestLock();
          err.textContent = '';
        } catch (e) {
          err.textContent = `Could not start: ${e.message || e}. Try SOLO SHIFT or check your connection.`;
        }
        break;
      }
      case 'join':
        $('#join-row', this.root).style.display = 'block';
        this.screens['menu-main'].classList.add('joining');
        $('#in-code', this.root).focus();
        break;
      case 'dojoin': {
        const code = $('#in-code', this.root).value.trim().toUpperCase();
        if (code.length < 4) { err.textContent = 'Enter the 5-character shift code.'; return; }
        err.textContent = 'Connecting...';
        await audio.init();
        this.applySettings();
        try {
          await g.join(code);
          err.textContent = 'Connected. Clocking in...';
        } catch (e) {
          err.textContent = String(e.message || e);
        }
        break;
      }
      case 'settings': this._show('settings'); break;
      case 'controls': this._show('controls'); break;
      case 'back': this._show(this.prevScreen && this.prevScreen !== 'menu-main' ? this.prevScreen : g?.state === 'playing' ? 'pause' : null); break;
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
    this.hud.classList.toggle('hidden', !this.game || this.game.state !== 'playing' || id === 'menu-main' || id === 'runover');
  }

  // the main menu is the 3D clone factory (world/menu_scene.js): no HTML screen, just free the cursor.
  // (#menu-main stays in the markup for the join-code flow but is never shown.)
  showMainMenu() {
    this._show(null);
    this.menuOpen = false;
    input.exitLock();
  }

  _bootText() {
    const lines = ['R.O.O.M. PERSONNEL TERMINAL v3.11', 'MEMORY CHECK ......... 640K OK', 'CLONE VATS .......... 4/4 ONLINE', 'DIMENSIONAL DISPATCH . STANDBY', 'WELCOME, EMPLOYEE.'];
    const box = $('#menu-main .boot', this.root);
    box.textContent = '';
    let i = 0;
    clearInterval(this._bootI);
    this._bootI = setInterval(() => {
      if (i >= lines.length) { clearInterval(this._bootI); return; }
      box.textContent += lines[i++] + '\n';
    }, 220);
  }

  showPause() {
    $('#pause-code', this.root).textContent = net.mode === 'host' ? `SHIFT CODE: ${net.roomCode}` : net.mode === 'client' ? `CONNECTED TO SHIFT ${net.roomCode}` : 'SOLO SHIFT';
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
      $('.t', l).textContent = desc?.type === 'lobby' ? 'RETURNING TO HQ' : 'DIMENSIONAL DISPATCH';
      const place = (levelName || 'Level 0 — The Yellow Rooms').toUpperCase();
      $('.l', l).textContent = desc?.type === 'lobby' ? 'SUBLEVEL B4' : `DIMENSION 0${desc?.depth > 1 ? '-' + String.fromCharCode(64 + desc.depth) : ''} — ${place}`;
      $('.bar div', l).style.width = '0%';
      audio.ready && audio.play('teleport_whoosh', { volume: 0.5, bus: 'ui' });
    }
  }
  setLoadingProgress(p, label) {
    const l = $('#loading', this.root);
    $('.bar div', l).style.width = `${Math.round(p * 100)}%`;
    if (label) $('.l', l).textContent = label;
  }
  onWorldLoaded(desc) {
    // leaving the run-over screen must also release menuOpen, or the clone can't move in the lobby
    if (this.screens.runover.classList.contains('show')) this._show(null);
    this.hud.classList.remove('hidden');
    if (desc.type !== 'lobby') this.feed(`${desc.depth > 1 ? 'SECTOR ' + desc.depth + ' — ' : ''}${this.game?.world?.level?.feedName || 'LEVEL 0: THE YELLOW ROOMS'}. DAY 1/7.`, 'hq', 'HQ');
    else this.feed(net.mode === 'client' ? 'Welcome back to Sublevel B4. Walk around while the host starts the shift.' : 'Welcome back to Sublevel B4. START SHIFT (or talk to GLORIA) when your team is ready.', 'hq', 'HQ');
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
    this.game?.watch?.notify(`${a.name}: ${a.desc}`, 'good', 'ACHIEVEMENT');
    this._float(`${a.name}\n${a.desc}`, { speaker: '* ACHIEVEMENT UNLOCKED *', color: '#ffd76a', size: 1.05, duration: 5 });
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
    if (frac === null || frac === undefined) { p.style.display = 'none'; return; }
    p.style.display = 'block';
    $('.label', p).textContent = label;
    $('.fill', p).style.width = `${Math.round(Math.min(1, frac) * 100)}%`;
  }

  timing(frac, a = 0.45, b = 0.62, label = 'PULL') {
    const t = $('#timing', this.root);
    if (frac === null || frac === undefined) { t.style.display = 'none'; return; }
    t.style.display = 'block';
    $('.lbl', t).textContent = label;
    const z = $('.zone', t);
    z.style.left = `${a * 100}%`;
    z.style.width = `${(b - a) * 100}%`;
    $('.needle', t).style.left = `${Math.min(1, frac) * 100}%`;
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

  // where the Healthity pop-up may start (px from the top): below the sleeve patch, the touch button column
  // (portrait) and an open portrait watch panel
  _popBase() {
    let y = Math.max(this.game?.local?.vitals?.bottomPx || 0, this.lobby.bottomPx || 0);
    const t = this.game?.touch;
    if (t && window.innerHeight > window.innerWidth && t.sysBottom) y = Math.max(y, t.sysBottom);
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
    const border = 2 * 8 * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--px')) || 2);
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

  // death screen: a flatlining EKG strip in pixel art
  _flatline(dt) {
    this._deathT += dt;
    const cv = $('#death canvas.flat', this.root);
    if (!this._flatPix) this._flatPix = new Pix(96, 16);
    const p = this._flatPix;
    p.clear();
    for (let x = 0; x < 96; x += 6) p.vline(x, 1, 14, [255, 90, 58, 40]);
    p.hline(0, 95, 8, [255, 90, 58, 40]);
    const head = Math.floor((this._deathT * 30) % 120);
    for (let x = 0; x < 96; x++) {
      const age = (head - x + 120) % 120;
      if (age > 90) continue;
      const blip = x > 20 && x < 30 && this._deathT < 1.2 ? Math.round(Math.sin((x - 20) / 10 * Math.PI) * 6) : 0;
      p.set(x, 8 - blip, age < 3 ? C.red5 : age < 30 ? C.red : C.red2);
    }
    p.toCanvas(cv);
  }

  // loading screen: a little hazmat clone tumbling through the void
  _loadingAnim(dt) {
    const l = $('#loading', this.root);
    if (!l.classList.contains('show')) return;
    this._loadT = (this._loadT || 0) + dt;
    if ((this._loadDraw = (this._loadDraw || 0) - dt) > 0) return;
    this._loadDraw = 1 / 12;
    const p = this._loadPix;
    p.clear();
    const t = this._loadT;
    const f = Math.floor(t * 6) % 4;
    // speed lines
    for (let i = 0; i < 6; i++) { const x = (i * 5 + 2) % 24, y = Math.floor((t * 60 + i * 13) % 34) - 6; p.vline(x, y, y + 3, [255, 180, 58, 90]); }
    const bob = [0, 1, 0, -1][f];
    const ox = 6, oy = 6 + bob;
    // body: chubby hazmat sack-doll, arms flailing
    p.rbox(ox + 2, oy + 6, 9, 10, 3, C.hz);
    p.rbox(ox + 3, oy, 7, 7, 3, C.hz4);
    p.rect(ox + 4, oy + 2, 5, 3, C.ink2); p.set(ox + 5, oy + 3, C.cyan); p.set(ox + 7, oy + 3, C.cyan);
    const arm = [[-3, 4], [-3, 2], [-3, 6], [-3, 3]][f];
    p.rod(ox + 2, oy + 8, ox + 2 + arm[0], oy + 8 - arm[1], 1.2, ['#3e300a', '#715a14', '#a8871f', '#d9b437', '#f2d469', '#fff1a8'], { round: true, spec: false });
    p.rod(ox + 10, oy + 8, ox + 13, oy + 8 - [2, 5, 3, 6][f], 1.2, ['#3e300a', '#715a14', '#a8871f', '#d9b437', '#f2d469', '#fff1a8'], { round: true, spec: false });
    p.rect(ox + 3, oy + 15, 3, 3, C.hz2); p.rect(ox + 7, oy + 15, 3, 3 - (f % 2), C.hz2);
    p.hline(ox + 2, ox + 10, oy + 11, C.hz1);
    p.rim(0.3, 0.25).outline(C.ink);
    p.toCanvas($('canvas.sprite', l));
  }

  runOver(stats) {
    $('#ro-title', this.root).textContent = stats.reason || 'SHIFT TERMINATED';
    const m = Math.floor(stats.time / 60), s = stats.time % 60;
    $('#ro-stats', this.root).innerHTML = `DIMENSIONS SURVIVED ... ${stats.depth - 1}<br/>LAST DAY REACHED ..... ${stats.day}/7<br/>CREDITS EARNED ....... ${stats.earned}<br/>CLONES LOST .......... ${stats.deaths}<br/>SHIFT DURATION ....... ${m}:${String(s).padStart(2, '0')}`;
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
    $('#locker-no', this.root).textContent = String(1 + (Math.abs(profile.name.length * 7) % 32)).padStart(2, '0');
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
      const c = el(`<div class="cat"><div class="name">${cat.toUpperCase()}</div><div class="opts"></div></div>`);
      const opts = $('.opts', c);
      for (const o of list) {
        const locked = o.unlock && !profile.has(o.unlock);
        const b = el(`<button class="opt interactive ${cur[cat] === o.id ? 'on' : ''} ${locked ? 'locked' : ''}"></button>`);
        b.textContent = locked ? `🔒 ${o.name || o.id}` : (o.name || o.id);
        if (locked) b.title = `Unlock: ${ACHIEVEMENTS[o.unlock]?.name || o.unlock} — ${ACHIEVEMENTS[o.unlock]?.desc || ''}`;
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

  // pixel-art item sprite (24x24 Pix): hand-built for pocketable items, otherwise a palette-quantized 3D render
  iconPix(type, variant) {
    const key = variant ? `${type}:${variant}` : type;
    if (this.iconPixes.has(key)) return this.iconPixes.get(key);
    let p = null;
    try { p = itemSprite(type, variant); } catch (e) { p = null; }
    if (!p) {
      try {
        const m = buildModel(type, { seed: 1 });
        if (!this.iconRT88) this.iconRT88 = new THREE.WebGLRenderTarget(88, 88);
        const cv = this._renderToCanvas(m.object, this.iconRT88, 88, 88, new THREE.Vector3(0.7, 0.6, 1));
        p = pixelizeCanvas(cv);
      } catch (e) { p = null; }
    }
    this.iconPixes.set(key, p);
    return p;
  }

  icon(type) {
    if (this.icons.has(type)) return this.icons.get(type);
    let url = '';
    const p = this.iconPix(type);
    if (p) { try { url = p.scaled(4).toDataURL(); } catch (e) { url = ''; } }
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
    this._loadingAnim(dt);
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
    if (prompt && input.touch) prompt = prompt.replace(/^\[[^\]]*\]\s*/, '');
    if (this.promptEl.textContent !== (prompt || '')) this.promptEl.textContent = prompt || '';
    this.crossEl.className = l.grab ? 'grab' : l.focus?.prompt ? 'focus' : '';
    this.crossEl.style.display = l.dead || g.terminal?.active || this.customizing ? 'none' : 'block';
    // death screen
    const death = $('#death', this.root);
    death.classList.toggle('show', l.dead);
    if (l.dead) {
      $('.c', death).textContent = `Cause: ${s.deathCause || 'unknown'}`;
      // auto re-cloning (Level 0): a new clone is printed at camp after a countdown, for half the team's money
      const mission = g.world.level?.mission;
      let eta = null;
      try { eta = mission?.reviveEta?.(net.selfId) ?? null; } catch (e) { eta = null; }
      const auto = !!g.autoClone || eta != null;
      const rc = $('.rc', death);
      rc.style.display = auto ? '' : 'none';
      if (auto) {
        const etaTxt = eta != null ? (eta > 0.5 ? `RE-CLONING IN ${Math.ceil(eta)}s` : 'PRINTING NEW CLONE...') : 'RE-CLONING AT CAMP...';
        const fee = g.cloneCost?.() ?? 0;
        const feeTxt = fee > 0 ? `CLONING FEE: -$${fee}` : 'CLONING FEE: $0 (TEAM IS BROKE)';
        if ($('.eta', rc).textContent !== etaTxt) $('.eta', rc).textContent = etaTxt;
        if ($('.fee', rc).textContent !== feeTxt) $('.fee', rc).textContent = feeTxt;
      }
      const sp = l.spectating;
      const sw = `${input.touch ? '<span class="kbd">PREV</span>/<span class="kbd">NEXT</span>' : '<span class="kbd">LMB</span>/<span class="kbd">RMB</span>'} switch`;
      const html = sp ? `SPECTATING ${sp.name.toUpperCase()} — ${sw}${auto ? '' : `<br/>Teammates can re-clone you at the CLONING PAD for ${g.cloneCost()} CR`}` : auto ? '' : 'No living employees remain...';
      if (this._deathHtml !== html) { this._deathHtml = html; $('.s', death).innerHTML = html; $('.s', death).style.display = html ? '' : 'none'; }
      this._flatline(dt);
    }
    // voice indicator
    $('#voiceind', this.root).classList.toggle('on', !!g.voice?.transmitting);
    $('#netinfo', this.root).textContent = net.mode === 'host' ? `SHIFT ${net.roomCode} · ${g.roster.size}/4` : net.mode === 'client' ? `SHIFT ${net.roomCode}` : '';
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
    // post fx from survival state
    const P = engine.post.params;
    P.uDamage.value = damp(P.uDamage.value, Math.max(s.damageFlash, s.health < 30 ? 0.35 + Math.sin(g.time * 3) * 0.1 : 0, s.bleed >= 2 ? 0.25 : 0), 6, dt);
    const lowbp = Math.max(0, (3400 - s.blood) / 2000);
    P.uBlur.value = damp(P.uBlur.value, Math.min(1, lowbp + (s.rest < 15 ? 0.35 : 0) + (s.microsleep > 0 ? 1 : 0)), 3, dt);
    P.uDesat.value = damp(P.uDesat.value, l.dead ? 1 : Math.min(0.6, lowbp * 0.5), 2, dt);
    P.uScan.value = l.dead ? 0.5 : 0;
    if (s.microsleep > 0) P.uFade.value = Math.max(P.uFade.value, Math.min(1, s.microsleep * 2));
    else if (!g.cutscene) P.uFade.value = damp(P.uFade.value, s.sleeping ? 0.85 : 0, 2, dt);
    P.uFlash.value = damp(P.uFlash.value, 0, 10, dt);
  }
}
