// HTML overlay UI: retro CRT main menu, minimal HUD, pause/settings, locker customizer,
// death/spectator & run-summary screens, toasts, HQ feed, item icon & portrait rendering.
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { input } from '../core/input.js';
import { net } from '../net/net.js';
import { audio } from '../audio/audio.js';
import { profile, ACHIEVEMENTS } from '../core/profile.js';
import { buildModel } from '../entities/catalog.js';
import { itemName, itemDef, SAMPLES } from '../game/itemdefs.js';
import { Avatar, COSMETICS } from '../entities/avatar.js';
import { buildStillLife } from '../entities/optional.js';
import { damp } from '../core/rng.js';
import { Q } from '../physics/physics.js';

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
        <div id="vitals"><div class="row hp">+<span class="v">100</span><span class="max">/100</span></div><div class="row stam">⚡<span class="v">40</span><span class="max">/40</span></div><div class="cond"></div></div>
        <div id="topright"><div class="cr">$0</div><div class="obj"></div><div class="exit"></div></div>
        <div id="crosshair"></div>
        <div id="prompt"></div>
        <div id="progress"><div class="label"></div><div class="bar"><div class="fill"></div></div></div>
        <div id="timing"><div class="lbl">PULL</div><div class="zone"></div><div class="needle"></div></div>
        <div id="itemname"></div>
        <div id="hotbar"></div>
        <div id="feed"></div>
        <div id="toasts"></div>
        <div id="ach"><div>ACHIEVEMENT UNLOCKED</div><div class="t"></div><div class="d" style="color:var(--fg-dim)"></div></div>
        <div id="voiceind">● TRANSMITTING</div>
        <div id="netinfo"></div>
        <div id="death"><div class="t">CLONE TERMINATED</div><div class="c"></div><div class="s"></div></div>
      </div>
      <div id="clickstart">CLICK TO CONTINUE</div>
      <div id="menu-main" class="screen"><div class="crt">
        <div class="boot"></div>
        <h1>R.O.O.M.</h1>
        <div class="logo-sub">RESEARCH OFFICE FOR OTHERWORLDLY MATTERS</div>
        <label>EMPLOYEE DESIGNATION</label>
        <input type="text" id="in-name" maxlength="16" spellcheck="false"/>
        <div class="menu" style="margin-top:18px">
          <button class="btn interactive" data-act="solo">SOLO SHIFT</button>
          <button class="btn interactive" data-act="host">HOST SHIFT (1-4 CLONES)</button>
          <button class="btn interactive" data-act="join">JOIN SHIFT</button>
          <button class="btn interactive" data-act="settings">SETTINGS</button>
          <button class="btn interactive" data-act="controls">CONTROLS</button>
        </div>
        <div id="join-row" style="display:none;margin-top:10px">
          <label>SHIFT CODE</label>
          <div class="row"><input type="text" id="in-code" maxlength="6" spellcheck="false"/><button class="btn interactive" data-act="dojoin" style="white-space:nowrap">CONNECT</button></div>
        </div>
        <div class="err" id="menu-err"></div>
        <div class="hint">Online co-op uses peer-to-peer WebRTC. Proximity voice chat needs a microphone (optional).</div>
        <div class="tag">v1.0 · SUBLEVEL B4 · (C) 1994 R.O.O.M. CORP</div>
      </div></div>
      <div id="pause" class="screen"><div class="crt">
        <h2>SHIFT PAUSED</h2>
        <div class="sub" id="pause-code"></div>
        <div class="menu">
          <button class="btn interactive" data-act="resume">RESUME</button>
          <button class="btn interactive" data-act="settings">SETTINGS</button>
          <button class="btn interactive" data-act="controls">CONTROLS</button>
          <button class="btn interactive" data-act="leave">CLOCK OUT (LEAVE)</button>
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
          <span>MOUSE SENSITIVITY</span><input class="interactive" type="range" min="0.2" max="3" step="0.05" data-set="sensitivity"/>
          <span>INVERT Y</span><select class="interactive" data-set="invertY"><option value="false">OFF</option><option value="true">ON</option></select>
          <span>GRAPHICS</span><select class="interactive" data-set="quality"><option value="low">LOW</option><option value="medium">MEDIUM</option><option value="high">HIGH</option></select>
          <span>MICROPHONE</span><select class="interactive" data-set="voiceMode"><option value="open">OPEN MIC</option><option value="ptt">PUSH-TO-TALK [V]</option><option value="off">OFF</option></select>
        </div>
        <div class="menu" style="margin-top:16px"><button class="btn interactive" data-act="back">BACK</button></div>
      </div></div>
      <div id="controls" class="screen"><div class="crt">
        <h2>CONTROLS</h2>
        <div style="font-size:24px;line-height:1.35">
          <span class="kbd">WASD</span> move · <span class="kbd">SHIFT</span> sprint · <span class="kbd">CTRL</span>/<span class="kbd">C</span> crouch · <span class="kbd">SPACE</span> jump<br/>
          <span class="kbd">LMB</span> hold to GRAB physics objects (and teammates)<br/>
          &nbsp;&nbsp;while grabbing: <span class="kbd">WHEEL</span> push/pull · <span class="kbd">R</span>+mouse rotate · <span class="kbd">RMB</span> throw<br/>
          <span class="kbd">E</span> interact / pick up · <span class="kbd">G</span> drop · <span class="kbd">1-5</span>/<span class="kbd">WHEEL</span> slots<br/>
          <span class="kbd">RMB</span> use held item (eat, drink, heal, weld, dismantle, sample)<br/>
          <span class="kbd">F</span> flashlight · <span class="kbd">TAB</span> wristwatch (<span class="kbd">Q</span>/<span class="kbd">E</span> tabs, <span class="kbd">LMB</span> photo in CAMERA)<br/>
          <span class="kbd">V</span> push-to-talk · <span class="kbd">H</span> wave · <span class="kbd">J</span> dance · <span class="kbd">B</span> point · <span class="kbd">T</span> 3rd person<br/>
          <span class="kbd">ESC</span> pause
        </div>
        <div class="menu" style="margin-top:16px"><button class="btn interactive" data-act="back">BACK</button></div>
      </div></div>
      <div id="custom" class="screen"><div class="crt"><h2>LOCKER #<span id="locker-no">07</span></h2><div class="sub">COSMETICS ONLY — R.O.O.M. DOES NOT ISSUE UPGRADES</div><div id="custom-body"></div>
        <div class="menu" style="margin-top:10px"><button class="btn interactive" data-act="custom-done">CLOSE LOCKER</button></div></div></div>
      <div id="runover" class="screen"><div class="crt"><h2 id="ro-title">SHIFT TERMINATED</h2><div class="stats" id="ro-stats"></div><div class="hint">Returning to headquarters... cosmetics & achievements are kept. Everything else is company property.</div></div></div>
      <div id="alert" class="screen"><div class="crt"><h2>NOTICE</h2><div id="alert-text" style="font-size:26px"></div><div class="menu" style="margin-top:14px"><button class="btn interactive" data-act="alert-ok">OK</button></div></div></div>
      <div id="loading"><div class="t">DISPATCHING</div><div class="l">...</div><div class="bar"><div></div></div></div>
    `;
    this.hud = $('#hud', this.root);
    this.menuOpen = true;
    this.screens = {};
    for (const id of ['menu-main', 'pause', 'settings', 'controls', 'custom', 'runover', 'alert']) this.screens[id] = $('#' + id, this.root);
    this.feedEl = $('#feed', this.root);
    this.toastEl = $('#toasts', this.root);
    this.promptEl = $('#prompt', this.root);
    this.crossEl = $('#crosshair', this.root);
    this.hotbarEl = $('#hotbar', this.root);
    this.icons = new Map();
    this.invVersion = -1;
    this.itemNameT = 0;
    this.prevScreen = null;
    this.customizing = null;
    this.customAngle = 0;
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
    const nameIn = $('#in-name', this.root);
    nameIn.value = profile.name;
    nameIn.addEventListener('change', () => { profile.name = nameIn.value.trim() || profile.name; if (this.game) this.game.local.name = profile.name; });
    $('#in-code', this.root).addEventListener('keydown', (e) => { if (e.key === 'Enter') this._act('dojoin'); });
    for (const inp of this.root.querySelectorAll('[data-set]')) {
      const k = inp.dataset.set;
      const v = profile.settings[k];
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
    if (k === 'invertY') v = raw === 'true';
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
      case 'back': this._show(this.prevScreen || (g?.state === 'playing' ? 'pause' : 'menu-main')); break;
      case 'resume': this.hideMenus(); input.requestLock(); break;
      case 'leave': this.hideMenus(); g.leave(); break;
      case 'custom-done': this.closeCustomizer(); break;
      case 'alert-ok': this._show(g?.state === 'playing' ? null : 'menu-main'); break;
      default: break;
    }
  }

  _show(id) {
    const cur = Object.entries(this.screens).find(([, s]) => s.classList.contains('show'))?.[0];
    if (id === 'settings' || id === 'controls') this.prevScreen = cur && cur !== id ? cur : this.prevScreen;
    for (const [k, s] of Object.entries(this.screens)) s.classList.toggle('show', k === id);
    this.menuOpen = !!id && id !== 'custom';
    if (id) input.exitLock();
    this.hud.classList.toggle('hidden', !this.game || this.game.state !== 'playing' || id === 'menu-main' || id === 'runover');
  }

  showMainMenu() {
    this._show('menu-main');
    this._bootText();
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
  setLoading(on, desc) {
    const l = $('#loading', this.root);
    l.classList.toggle('show', !!on);
    if (on) {
      $('.t', l).textContent = desc?.type === 'lobby' ? 'RETURNING TO HQ' : 'DIMENSIONAL DISPATCH';
      $('.l', l).textContent = desc?.type === 'lobby' ? 'SUBLEVEL B4' : `DIMENSION 0${desc?.depth > 1 ? '-' + String.fromCharCode(64 + desc.depth) : ''} — THE YELLOW ROOMS`;
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
    else this.feed('Welcome back to Sublevel B4. Pull the dispatch lever when your team is ready.', 'hq', 'HQ');
  }

  // ------------------------------------------------------------------
  toast(text, kind = '') {
    const t = el(`<div class="toast ${kind}"></div>`);
    t.textContent = text;
    this.toastEl.appendChild(t);
    while (this.toastEl.children.length > 4) this.toastEl.firstChild.remove();
    setTimeout(() => { t.style.transition = 'opacity 0.5s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 500); }, 2600);
  }

  feed(text, kind = '', from = '') {
    const m = el(`<div class="msg ${kind}"></div>`);
    if (from) { const f = el('<span class="from"></span>'); f.textContent = `[${from}]`; m.appendChild(f); }
    m.appendChild(document.createTextNode(text));
    this.feedEl.appendChild(m);
    while (this.feedEl.children.length > 5) this.feedEl.firstChild.remove();
    setTimeout(() => { m.style.transition = 'opacity 1s'; m.style.opacity = '0'; setTimeout(() => m.remove(), 1000); }, 9000 + text.length * 40);
    this.game?.watch?.log(from || 'SYS', text);
  }

  hq(text, from = 'HQ') {
    this.feed(text, 'hq', from);
    if (audio.ready) audio.play('radio_beep', { volume: 0.5, bus: 'ui' });
  }

  achievement(a) {
    const box = $('#ach', this.root);
    $('.t', box).textContent = a.name;
    $('.d', box).textContent = a.desc;
    box.style.display = 'block';
    audio.ready && audio.play('credits', { volume: 0.6, bus: 'ui' });
    clearTimeout(this._achT);
    this._achT = setTimeout(() => { box.style.display = 'none'; }, 4500);
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

  setPrompt(t) {
    this._prompt = t;
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

  icon(type) {
    if (this.icons.has(type)) return this.icons.get(type);
    let url = '';
    try {
      const m = buildModel(type, { seed: 1 });
      const cv = this._renderToCanvas(m.object, this.iconRT, 128, 128, new THREE.Vector3(0.7, 0.6, 1));
      url = cv.toDataURL();
    } catch (e) { /* icon optional */ }
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
      return this._renderToCanvas(obj, this.portraitRT, 192, 256, new THREE.Vector3(0.15, 0.1, 1), 1.6);
    } catch (e) {
      return null;
    }
  }

  // ------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    if (!g || g.state !== 'playing' || !g.world) return;
    const l = g.local;
    const s = l.survival;
    // vitals
    const hp = $('#vitals .hp .v', this.root);
    hp.textContent = Math.max(0, Math.round(s.health));
    $('#vitals .stam .v', this.root).textContent = Math.round(s.stamina);
    $('#vitals .stam .max', this.root).textContent = `/${s.maxStamina}`;
    const conds = s.conditions().slice(0, 3);
    $('#vitals .cond', this.root).textContent = conds.join(' · ');
    // credits / objectives
    $('#topright .cr', this.root).textContent = `$${g.run.credits}`;
    const mission = g.world.level?.mission;
    let obj = '', exit = '';
    if (mission) {
      const n = mission.generators.filter((x) => x.running).length;
      const lk = mission.linksCount();
      obj = n < 3 ? `GEN ${n}/3` : lk < 3 ? `LINK ${lk}/3` : mission.state.exit ? '' : 'EXTRACT';
      if (mission.state.exit && !mission.state.exit.done) {
        const t = Math.ceil(mission.exitTimeLeft());
        exit = `EXIT ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      }
    }
    $('#topright .obj', this.root).textContent = obj;
    $('#topright .exit', this.root).textContent = exit;
    // prompt & crosshair
    const prompt = l.dead ? null : g.terminal?.active ? null : l.focus?.prompt || this._prompt;
    this.promptEl.textContent = prompt || '';
    this.crossEl.className = l.grab ? 'grab' : l.focus ? 'focus' : '';
    this.crossEl.style.display = l.dead || g.terminal?.active || this.customizing ? 'none' : 'block';
    // hotbar
    if (l.inv.version !== this.invVersion) {
      const changedSel = this._lastSel !== l.inv.selected;
      this._lastSel = l.inv.selected;
      this.invVersion = l.inv.version;
      this.hotbarEl.innerHTML = '';
      l.inv.slots.forEach((it, i) => {
        const sl = el(`<div class="slot ${i === l.inv.selected ? 'sel' : ''}"><span class="num">${i + 1}</span></div>`);
        if (it) {
          const src = this.icon(it.type);
          if (src) { const im = el('<img/>'); im.src = src; sl.appendChild(im); }
          let tag = '';
          if (it.type === 'flashlight') tag = `${Math.round((it.state.charge ?? 1) * 100)}%`;
          if (it.type === 'welder') tag = `${Math.round((it.state.fuel ?? 1) * 100)}%`;
          if (it.type === 'sample_jar') tag = it.state.kind ? 'FULL' : 'EMPTY';
          if (it.state.lit) tag = 'LIT';
          if (tag) { const t = el('<span class="tag"></span>'); t.textContent = tag; sl.appendChild(t); }
        }
        this.hotbarEl.appendChild(sl);
      });
      const cur = l.inv.current;
      if (changedSel || cur) {
        const nm = $('#itemname', this.root);
        nm.textContent = cur ? (cur.type === 'sample_jar' && cur.state.kind ? `Sample: ${SAMPLES[cur.state.kind]?.name}` : itemName(cur.type)) + (itemDef(cur.type).use ? '  [RMB]' : '') : '';
        nm.style.opacity = '1';
        this.itemNameT = 2.2;
      }
    }
    this.itemNameT -= dt;
    if (this.itemNameT <= 0) $('#itemname', this.root).style.opacity = '0';
    // flashlight charge tag refresh (cheap)
    if (Math.floor(g.time) !== this._lastSec) { this._lastSec = Math.floor(g.time); this.invVersion = -1; }
    // death screen
    const death = $('#death', this.root);
    death.classList.toggle('show', l.dead);
    if (l.dead) {
      $('.c', death).textContent = `Cause: ${s.deathCause || 'unknown'}`;
      const sp = l.spectating;
      $('.s', death).innerHTML = sp ? `SPECTATING ${sp.name.toUpperCase()} — <span class="kbd">LMB</span>/<span class="kbd">RMB</span> switch<br/>Teammates can re-clone you at the CLONING PAD for ${g.cloneCost()} CR` : 'No living employees remain...';
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
    // post fx from survival state
    const P = engine.post.params;
    P.uDamage.value = damp(P.uDamage.value, Math.max(s.damageFlash, s.health < 30 ? 0.35 + Math.sin(g.time * 3) * 0.1 : 0, s.bleed >= 2 ? 0.25 : 0), 6, dt);
    const lowbp = Math.max(0, (3400 - s.blood) / 2000);
    P.uBlur.value = damp(P.uBlur.value, Math.min(1, lowbp + (s.rest < 15 ? 0.35 : 0) + (s.microsleep > 0 ? 1 : 0)), 3, dt);
    P.uDesat.value = damp(P.uDesat.value, l.dead ? 1 : Math.min(0.6, lowbp * 0.5), 2, dt);
    P.uScan.value = l.dead ? 0.5 : (l.watchOpen && g.watch?.tab === 'camera' ? 0.6 : 0);
    if (s.microsleep > 0) P.uFade.value = Math.max(P.uFade.value, Math.min(1, s.microsleep * 2));
    else if (!g.cutscene) P.uFade.value = damp(P.uFade.value, s.sleeping ? 0.85 : 0, 2, dt);
    P.uFlash.value = damp(P.uFlash.value, 0, 10, dt);
  }
}
