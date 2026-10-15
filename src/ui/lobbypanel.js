// HQ lobby roster: a compact pixel-art panel in the top-left corner while the team waits in the lobby
// (everyone can walk around meanwhile). Shows the shift code (host), the clone count as four little
// clone badges, each clone's name with a status lamp, and START SHIFT for the host / solo player
// (calls level.requestDispatch(): the elevator gate opens with a countdown). Clients see WAITING FOR HOST.
// Desktop players keep pointer lock: [ENTER] starts. Touch players tap the button.
import { input } from '../core/input.js';
import { net } from '../net/net.js';
import { audio } from '../audio/audio.js';
import { Pix, C, glyph } from './pixelart.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class LobbyPanel {
  constructor(ui) {
    this.ui = ui;
    this.root = document.createElement('div');
    this.root.id = 'pxlobby';
    this.root.className = 'hidden';
    this.root.innerHTML = `
      <div class="lp-head"><i class="lp-ico"></i><span class="lp-title">SHIFT ROSTER</span><span class="lp-mode"></span></div>
      <div class="lp-code"></div>
      <div class="lp-count"><canvas class="lp-badges"></canvas><span class="lp-n"></span></div>
      <ul class="lp-list"></ul>
      <button class="lp-start" type="button"><span class="lp-lbl">START SHIFT</span><kbd>ENTER</kbd></button>
      <div class="lp-status"></div>`;
    document.body.appendChild(this.root);
    this.el = {
      mode: this.root.querySelector('.lp-mode'), code: this.root.querySelector('.lp-code'), badges: this.root.querySelector('.lp-badges'),
      n: this.root.querySelector('.lp-n'), list: this.root.querySelector('.lp-list'), start: this.root.querySelector('.lp-start'),
      lbl: this.root.querySelector('.lp-lbl'), status: this.root.querySelector('.lp-status'),
    };
    this.visible = false;
    this.key = '';
    this.requested = 0; // seconds since START was pressed (local feedback until the elevator answers)
    const go = (e) => { e.preventDefault(); e.stopPropagation(); input.lastTouch = performance.now(); this.start(); };
    this.el.start.addEventListener('pointerdown', go);
    this.el.start.addEventListener('click', (e) => e.preventDefault());
    this.el.start.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
      if (!this.visible || !this.canStart) return;
      const g = this.ui.game;
      if (this.ui.menuOpen || this.ui.customizing || g?.terminal?.active || input.textCapture) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
      this.start();
    });
  }

  get bottomPx() { return this.visible ? this.root.getBoundingClientRect().bottom : 0; }

  start() {
    const g = this.ui.game;
    const lvl = g?.world?.level;
    if (!this.canStart || !lvl) return;
    audio.ready && audio.play('ui_select', { volume: 0.6, bus: 'ui' });
    try { navigator.vibrate?.(12); } catch (e) { /* ignore */ }
    if (typeof lvl.requestDispatch === 'function') {
      lvl.requestDispatch();
      this.requested = 0.001;
    } else {
      // older HQ builds: dispatch goes through the receptionist
      g.ui.toast('Talk to GLORIA at reception to be dispatched', 'warn');
    }
  }

  setVisible(on) {
    if (on === this.visible) return;
    this.visible = on;
    this.root.classList.toggle('hidden', !on);
    if (!on) this.requested = 0;
  }

  _badges(n, max) {
    const p = new Pix(max * 12 + 1, 13);
    for (let i = 0; i < max; i++) {
      glyph('person', i < n ? C.green : C.ink4, { pix: p, x: i * 12, y: 1, light: i < n ? C.green5 : C.ink4, shade: i < n ? C.green2 : C.ink3 });
    }
    p.outline(C.ink);
    p.toCanvas(this.el.badges);
  }

  update(dt) {
    const g = this.ui.game;
    if (!this.visible || !g) return;
    if (this.requested > 0) this.requested += dt;
    const host = net.mode !== 'client';
    const mode = net.mode === 'host' ? 'HOST' : net.mode === 'client' ? 'CLIENT' : 'SOLO';
    const roster = [...g.roster.values()];
    const max = 4;
    const elev = g.world?.level?.elevator;
    const ph = elev?.state?.ph;
    const left = ph === 'board' && elev.secondsLeft ? elev.secondsLeft() : 0;
    if (ph === 'board' || ph === 'depart') this.requested = 0;
    this.canStart = host && ph !== 'board' && ph !== 'depart' && !(this.requested > 0 && this.requested < 6);
    const rows = roster.map((r) => {
      const self = r.id === net.selfId;
      const rem = g.remotes?.get(r.id);
      const here = self || (rem && rem.inWorld);
      const isHost = (net.mode === 'host' && self) || (net.mode === 'client' && r.id === roster[0]?.id);
      return { name: r.name || 'Clone', self, here, isHost };
    });
    const key = JSON.stringify([mode, net.roomCode, rows, ph, left, this.canStart, this.requested > 0, input.touch]);
    if (key === this.key) return;
    this.key = key;
    this.el.mode.textContent = mode;
    this.el.code.innerHTML = net.mode === 'host' ? `SHIFT CODE <b>${esc(net.roomCode || '-----')}</b>` : net.mode === 'client' ? `ON SHIFT <b>${esc(net.roomCode || '')}</b>` : 'SOLO SHIFT · OFFLINE';
    this._badges(roster.length, max);
    this.el.n.textContent = `${roster.length}/${max}`;
    this.el.list.innerHTML = rows.map((r) => `<li class="${r.here ? 'ok' : 'wait'}"><i></i><span class="nm">${esc(r.name.toUpperCase())}</span>${r.self ? '<em>YOU</em>' : ''}${r.isHost ? '<em class="h">HOST</em>' : ''}<span class="st">${r.here ? 'IN HQ' : 'JOINING'}</span></li>`).join('');
    // start / waiting
    this.el.start.style.display = host ? '' : 'none';
    this.el.start.disabled = !this.canStart;
    this.el.start.classList.toggle('touch', !!input.touch);
    this.el.lbl.textContent = ph === 'board' ? `DEPARTS IN ${left}s` : ph === 'depart' ? 'DEPARTING' : this.requested > 0 ? 'CALLING LIFT...' : 'START SHIFT';
    let status = '';
    if (ph === 'board') status = 'GET INTO THE ELEVATOR!';
    else if (!host) status = 'WAITING FOR HOST...';
    else if (net.mode === 'host' && roster.length < 2) status = 'Share the code. Up to 4 clones.';
    this.el.status.textContent = status;
    this.el.status.classList.toggle('blink', ph === 'board' || !host);
  }
}
