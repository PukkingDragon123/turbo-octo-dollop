// Quick-time events, diegetic: the title floats in front of the camera (floatText), big 3D keycaps hang
// under the crosshair in the viewmodel layer, the clone's hands shake and the screen pulses with every hit.
// Keyboard and touch (a full-screen tap / hold area, or tappable keycaps for sequences).
//
//   game.qte.start({ kind: 'mash' | 'sequence' | 'hold', keys (codes, or a count for random WASD), duration, title, onWin, onFail,
//                    count (mash presses, 14), hold (seconds for 'hold', 1.6), decay (mash drain/s, 0.2),
//                    strict (sequence: a wrong key fails), lock (freeze the player, default true), color })
//     -> handle { cancel(), get progress(), get done } ; a new start replaces the running one.
//   game.qte.active  -> the running QTE (or null)
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { juice } from '../gfx/juice.js';
import { floatText } from '../ui/floattext.js';

export const QTE_TUNE = { mashCount: 14, mashDecay: 0.2, holdTime: 1.6, duration: 3.5, wrongPenalty: 0.35, panelDepth: 0.34, panelY: -0.045 };
const SEQ_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
const TITLES = { mash: 'BREAK FREE!', sequence: 'FOLLOW THE KEYS!', hold: 'HOLD ON!' };
const CW = 512, CH = 256;

export function keyLabel(code) {
  if (code === 'LMB' || code === 'RMB') return code;
  if (code === 'Space') return 'SPACE';
  return String(code).replace('Key', '').replace('Digit', '').replace('Arrow', '').replace('Left', '').replace('Right', '').toUpperCase();
}

export class QTE {
  constructor(game) {
    this.game = game;
    this.active = null;
    this.canvas = document.createElement('canvas');
    this.canvas.width = CW; this.canvas.height = CH;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.panel = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.08), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    this.panel.renderOrder = 999;
    this.panel.visible = false;
    this.panel.frustumCulled = false;
    engine.vmCamera.add(this.panel);
    this.pop = 0;
    this.drawT = 0;
    this.touchEl = null;
  }

  start(o = {}) {
    if (this.active) this._end(null);
    const kind = ['mash', 'sequence', 'hold'].includes(o.kind) ? o.kind : 'mash';
    let keys = Array.isArray(o.keys) && o.keys.length ? o.keys.slice() : null;
    // keys: an array of codes, or (sequence) a number of random WASD keys
    if (!keys) keys = kind === 'sequence' ? Array.from({ length: Math.max(2, Math.min(8, typeof o.keys === 'number' ? o.keys : 4)) }, () => SEQ_KEYS[(Math.random() * 4) | 0]) : ['Space'];
    const q = {
      o, kind, keys, idx: 0, t: 0, progress: 0, done: false, flash: 0, wrong: 0,
      duration: o.duration ?? (kind === 'sequence' ? 1.1 + keys.length * 0.7 : QTE_TUNE.duration),
      count: o.count ?? QTE_TUNE.mashCount, hold: o.hold ?? QTE_TUNE.holdTime, decay: o.decay ?? QTE_TUNE.mashDecay,
      lock: o.lock !== false, color: o.color || '#ffcc33',
      touchHold: false,
    };
    q.title = floatText.notice(o.title || TITLES[kind], { color: q.color, duration: q.duration + 0.6 });
    this.active = q;
    this.pop = 1;
    audio.play('scare_sting', { volume: 0.25, bus: 'ui' });
    juice.shake(0.25);
    this._touch(true);
    const self = this;
    return { cancel() { if (self.active === q) self._end(null); }, get progress() { return q.progress; }, get done() { return q.done; } };
  }

  get locking() { return !!(this.active && this.active.lock); }
  // 0..1 how hard the hands should shake
  get intensity() { const q = this.active; return q ? 0.45 + q.flash * 0.55 : 0; }

  // touch / external: one press of a key
  press(code) { const q = this.active; if (q) this._onKey(q, code); }

  _onKey(q, code) {
    if (q.kind === 'mash') {
      if (!q.keys.includes(code) && !(code === '*')) return;
      q.progress = Math.min(1, q.progress + 1 / Math.max(1, q.count));
      this._hitFx(0.08);
    } else if (q.kind === 'sequence') {
      const want = q.keys[q.idx];
      if (code === want || code === '*') {
        q.idx++;
        q.progress = q.idx / q.keys.length;
        this._hitFx(0.14);
      } else if (SEQ_KEYS.includes(code) || q.keys.includes(code)) {
        q.wrong = 1;
        juice.shake(0.35);
        audio.play('ui_error', { volume: 0.5, bus: 'ui' });
        if (q.o.strict) { this._end(false); return; }
        q.t += QTE_TUNE.wrongPenalty;
      }
    }
    if (q.progress >= 1) this._end(true);
  }

  _hitFx(shake) {
    const q = this.active;
    q.flash = 1;
    this.pop = Math.max(this.pop, 0.6);
    juice.shake(shake);
    juice.punch(0.015);
    const P = engine.post?.params;
    if (P) P.uFlash.value = Math.max(P.uFlash.value, 0.05);
    audio.play('qte_hit', { volume: 0.7, bus: 'ui' });
    try { navigator.vibrate?.(10); } catch (e) { /* ignore */ }
  }

  update(dt) {
    const q = this.active;
    if (!q) { this.panel.visible = false; return; }
    if (this.game.local?.dead) { this._end(false); return; }
    q.t += dt;
    q.flash = Math.max(0, q.flash - dt * 6);
    q.wrong = Math.max(0, q.wrong - dt * 3);
    if (q.kind === 'mash') {
      for (const k of q.keys) if (input.codeHit(k)) this._onKey(q, k);
      if (!this.active) return;
      q.progress = Math.max(0, q.progress - q.decay * dt);
    } else if (q.kind === 'sequence') {
      for (const code of input.anyPressed()) { this._onKey(q, code); if (!this.active) return; }
      for (const b of ['LMB', 'RMB']) if (q.keys.includes(b) && input.codeHit(b)) { this._onKey(q, b); if (!this.active) return; }
    } else {
      const down = q.touchHold || q.keys.some((k) => input.codeDown(k));
      q.progress = Math.max(0, Math.min(1, q.progress + (down ? dt / q.hold : -dt * 0.5 / q.hold)));
      if (down) { q.flash = Math.max(q.flash, 0.5); this._holdBeepT = (this._holdBeepT || 0) - dt; if (this._holdBeepT <= 0) { this._holdBeepT = 0.18; audio.play('qte_hit', { volume: 0.3, bus: 'ui', pitch: 0.8 + q.progress * 0.6 }); } }
      if (q.progress >= 1) { this._end(true); return; }
    }
    if (q.t >= q.duration) { this._end(false); return; }
    // heartbeat screen pulse that speeds up as time runs out
    const urg = q.t / q.duration;
    const P = engine.post?.params;
    if (P) P.uFlash.value = Math.max(P.uFlash.value, 0.025 * Math.max(0, Math.sin(q.t * (6 + urg * 10))));
    this._place(dt);
    this.drawT -= dt;
    if (this.drawT <= 0) { this.drawT = 1 / 30; this._draw(q); }
  }

  _place(dt) {
    const cam = engine.vmCamera, p = this.panel;
    const z = QTE_TUNE.panelDepth;
    this.pop = Math.max(0, this.pop - dt * 4);
    const q = this.active;
    const sh = (q.flash * 0.003 + q.wrong * 0.006);
    p.position.set((Math.random() - 0.5) * sh, QTE_TUNE.panelY * (z / 0.34) * (cam.fov / 60) + (Math.random() - 0.5) * sh, -z);
    const s = (1 + this.pop * 0.25 * Math.sin(this.pop * Math.PI)) * Math.tan((cam.fov * Math.PI) / 360) / Math.tan(Math.PI / 6);
    p.scale.setScalar(s);
    p.visible = true;
  }

  _draw(q) {
    const c = this.ctx;
    c.clearRect(0, 0, CW, CH);
    const keys = q.kind === 'sequence' ? q.keys : [q.keys[0]];
    const n = keys.length, kw = Math.min(110, (CW - 40) / n - 12), kh = 92, gap = 12;
    const total = n * kw + (n - 1) * gap;
    let x = (CW - total) / 2;
    const y = 36;
    keys.forEach((k, i) => {
      const cur = q.kind !== 'sequence' || i === q.idx, done = q.kind === 'sequence' && i < q.idx;
      const pressed = cur && q.flash > 0.5;
      const lab = keyLabel(k), wide = lab.length > 3;
      const w = wide && n === 1 ? 230 : kw, xx = n === 1 ? (CW - w) / 2 : x;
      const yy = y + (pressed ? 6 : 0);
      // keycap: dark skirt, beige top, legend
      rr(c, xx, y + 10, w, kh, 14); c.fillStyle = 'rgba(0,0,0,0.55)'; c.fill();
      rr(c, xx, yy, w, kh - 6, 14); c.fillStyle = done ? '#3a5a3a' : q.wrong > 0.3 && cur ? '#a83020' : cur ? '#e8dcb8' : '#8a8270'; c.fill();
      rr(c, xx + 8, yy + 6, w - 16, kh - 26, 10); c.fillStyle = done ? '#4f7a4f' : cur ? '#f6efd8' : '#a39a86'; c.fill();
      c.fillStyle = done ? '#bfffbf' : '#1a1610';
      c.font = `bold ${wide ? 40 : 58}px "Jolly Lodger", Georgia, serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(done ? '✓' : lab, xx + w / 2, yy + (kh - 26) / 2 + 8);
      if (cur && !done) { c.strokeStyle = q.color; c.lineWidth = 5; rr(c, xx - 5, yy - 5, w + 10, kh + 4, 18); c.stroke(); }
      x += kw + gap;
    });
    // progress bar + time fuse
    const by = 168, bw = 380, bx = (CW - bw) / 2;
    rr(c, bx, by, bw, 22, 11); c.fillStyle = 'rgba(0,0,0,0.6)'; c.fill();
    rr(c, bx + 3, by + 3, Math.max(0, (bw - 6) * q.progress), 16, 8); c.fillStyle = q.color; c.fill();
    const left = 1 - q.t / q.duration;
    c.fillStyle = left < 0.3 ? '#ff5040' : 'rgba(255,255,255,0.7)';
    c.fillRect(bx + (bw * (1 - left)) / 2, by + 30, bw * left, 5);
    c.font = 'bold 30px "Jolly Lodger", Georgia, serif';
    c.fillStyle = '#fff';
    const hint = input.touch ? (q.kind === 'mash' ? 'TAP! TAP! TAP!' : q.kind === 'hold' ? 'HOLD THE SCREEN' : 'TAP THE KEYS') : (q.kind === 'mash' ? 'MASH IT!' : q.kind === 'hold' ? 'HOLD IT!' : '');
    if (hint) c.fillText(hint, CW / 2, 228);
    this.tex.needsUpdate = true;
  }

  _end(win) {
    const q = this.active;
    if (!q) return;
    this.active = null;
    q.done = true;
    q.title?.close?.();
    this.panel.visible = false;
    this._touch(false);
    if (win === true) {
      audio.play('ui_select', { volume: 0.7, bus: 'ui' });
      juice.flash(0.25);
      juice.shake(0.3);
      floatText.notice('FREE!', { color: '#8dffa6', duration: 1.1 });
      try { q.o.onWin?.(q); } catch (e) { console.error('[qte] onWin', e); }
    } else if (win === false) {
      audio.play('ui_error', { volume: 0.7, bus: 'ui' });
      juice.shake(0.6);
      try { q.o.onFail?.(q); } catch (e) { console.error('[qte] onFail', e); }
    }
    try { q.o.onEnd?.(q, win); } catch (e) { console.error('[qte] onEnd', e); }
  }

  // touch: a full-screen tap / hold area above the on-screen controls; sequences get tappable keycaps
  _touch(on) {
    if (!input.touch) return;
    if (!this.touchEl) {
      const el = document.createElement('div');
      el.id = 'qte-touch';
      el.style.cssText = 'position:fixed;inset:0;z-index:60;display:none;touch-action:none;';
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const q = this.active;
        if (!q) return;
        const k = e.target?.dataset?.k;
        if (q.kind === 'hold') q.touchHold = true;
        else if (q.kind === 'sequence') { if (k) this.press(k); } else this.press('*');
      });
      const up = () => { if (this.active) this.active.touchHold = false; };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      document.body.appendChild(el);
      this.touchEl = el;
    }
    const el = this.touchEl;
    el.innerHTML = '';
    el.style.display = on ? 'block' : 'none';
    const q = this.active;
    if (on && q?.kind === 'sequence') {
      const uniq = [...new Set(q.keys)];
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:absolute;left:50%;bottom:18%;transform:translateX(-50%);display:flex;gap:14px;';
      for (const k of uniq) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.k = k;
        b.textContent = keyLabel(k);
        b.style.cssText = 'min-width:68px;height:68px;font:bold 28px "Jolly Lodger", Georgia, serif;background:#e8dcb8;color:#1a1610;border:3px solid #ffcc33;border-radius:12px;';
        wrap.appendChild(b);
      }
      el.appendChild(wrap);
    }
  }
}

function rr(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}
