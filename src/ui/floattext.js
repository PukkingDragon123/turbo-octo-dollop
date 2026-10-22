// Floating 3D text for all dialogue and notices (no screen HUD).
//   floatText.say(text, { at, offset, speaker, color, duration, size, scene })
//       world text that hangs near a speaker (Object3D or Vector3), types itself out, bobs, fades.
//   floatText.notice(text, { color, duration, speaker })
//       text that floats in front of the camera, lower centre; several stack upwards.
// Both return a handle { set(text), close() }. Call floatText.update(dt, camera) once per frame.
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { FONT } from './fonts.js';

const W = 1024, H = 256;
const NOTICE_BASE = -0.86; // bottom of the notice stack, in screen half-heights below centre
export const FLOAT = { typeRate: 48, popTime: 0.32, fade: 0.45, bobAmp: 0.012, worldScale: 0.0013, noticeScale: 0.0008 };

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
const easeOutBack = (t) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };

// any caller colour becomes a dark ink of the same hue on paper (light amber -> burnt umber)
function inkOn(col) {
  if (!col || !/^#[0-9a-f]{6}$/i.test(col)) return '#2b2216';
  const n = parseInt(col.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const m = (v, base) => Math.round(v * 0.3 + base * 0.7);
  return `rgb(${m(r, 40)},${m(g, 26)},${m(b, 16)})`;
}

function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      const t = line ? `${line} ${w}` : w;
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}

class Bubble {
  constructor(text, o, notice) {
    this.o = o;
    this.notice = notice;
    this.text = String(text);
    this.shown = 0;
    this.t = 0;
    this.life = o.duration ?? Math.min(9, 2.4 + this.text.length * 0.06);
    this.closing = -1;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: !notice, depthWrite: false, toneMapped: false, opacity: 0 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), this.mat);
    this.mesh.renderOrder = 999;
    this.mesh.frustumCulled = false;
    this.lines = [];
    this._layout();
    this._draw(0);
  }
  // look: notices are torn scraps of aged paper with hand-written ink; spoken lines are chalky
  // hand-lettering floating in the air (no box), each speaker with its own face
  _style() {
    if (this._st) return this._st;
    const sp = String(this.o.speaker || '').toUpperCase();
    // floating speech (say) is set in EB Garamond; notices are hand-written paper scraps
    const role = this.o.font || (!this.notice ? 'speech' : sp === 'HEALTHITY' ? 'type' : sp === 'HQ' || sp === 'RECEPTION' ? 'print' : sp === 'ACHIEVEMENT' ? 'title' : 'hand');
    const big = role === 'hand' || role === 'messy' || role === 'speech';
    this._st = {
      role,
      body: `${role === 'hand' ? '700 ' : role === 'speech' ? '500 ' : ''}${big ? 60 : 44}px ${FONT[role] || FONT.hand}`,
      label: `30px ${FONT.title}`,
      lh: big ? 58 : 54,
      paper: this.notice && this.o.paper !== false,
      seed: (this.text.length * 9301 + 49297) % 233280,
    };
    return this._st;
  }
  _layout() {
    const c = this.ctx, st = this._style();
    c.font = st.body;
    this.lines = wrap(c, this.text, W - 150).slice(0, 4);
  }
  _rand(i) { const x = Math.sin((this._style().seed + i) * 12.9898) * 43758.5453; return x - Math.floor(x); }
  _paper(c, x0, y0, w, h) {
    // aged paper scrap: torn edges, uneven yellowing, a coffee ring, a strip of tape
    const R = (i) => this._rand(i);
    c.save();
    c.translate(W / 2, y0 + h / 2);
    c.rotate((R(1) - 0.5) * 0.035);
    c.translate(-W / 2, -(y0 + h / 2));
    c.beginPath();
    const step = 18;
    c.moveTo(x0, y0 + R(2) * 6);
    for (let x = x0; x <= x0 + w; x += step) c.lineTo(x, y0 + R(x) * 7);
    for (let y = y0; y <= y0 + h; y += step) c.lineTo(x0 + w - R(y + 500) * 6, y);
    for (let x = x0 + w; x >= x0; x -= step) c.lineTo(x, y0 + h - R(x + 900) * 8);
    for (let y = y0 + h; y >= y0; y -= step) c.lineTo(x0 + R(y + 1300) * 6, y);
    c.closePath();
    c.shadowColor = 'rgba(0,0,0,0.55)'; c.shadowBlur = 14; c.shadowOffsetY = 6;
    const g = c.createLinearGradient(x0, y0, x0 + w, y0 + h);
    g.addColorStop(0, '#efe4c6'); g.addColorStop(0.55, '#e6d7b1'); g.addColorStop(1, '#d8c493');
    c.fillStyle = g; c.fill();
    c.shadowColor = 'transparent';
    c.clip();
    // fibres + foxing
    for (let i = 0; i < 70; i++) {
      c.fillStyle = `rgba(120,90,40,${0.04 + R(i + 40) * 0.07})`;
      c.beginPath(); c.arc(x0 + R(i + 60) * w, y0 + R(i + 80) * h, 1 + R(i + 99) * 5, 0, Math.PI * 2); c.fill();
    }
    c.strokeStyle = 'rgba(110,80,35,0.18)'; c.lineWidth = 7;
    c.beginPath(); c.arc(x0 + w * (0.72 + R(7) * 0.2), y0 + h * 0.6, 34 + R(8) * 18, 0, Math.PI * 1.7); c.stroke();
    const eg = c.createLinearGradient(x0, 0, x0 + w, 0);
    eg.addColorStop(0, 'rgba(90,60,20,0.25)'); eg.addColorStop(0.12, 'rgba(0,0,0,0)'); eg.addColorStop(0.88, 'rgba(0,0,0,0)'); eg.addColorStop(1, 'rgba(90,60,20,0.25)');
    c.fillStyle = eg; c.fillRect(x0, y0, w, h);
    c.restore();
    // tape
    c.save();
    c.translate(x0 + w * (0.2 + R(9) * 0.6), y0 + 2);
    c.rotate((R(10) - 0.5) * 0.4);
    c.fillStyle = 'rgba(235,228,200,0.55)'; c.fillRect(-46, -12, 92, 26);
    c.restore();
  }
  _draw(n) {
    const c = this.ctx, st = this._style();
    c.clearRect(0, 0, W, H);
    const lh = st.lh, top = this.o.speaker ? 54 : 16;
    const h = top + this.lines.length * lh + 26;
    const y0 = (H - h) / 2;
    const ink = st.paper ? inkOn(this.o.color) : (this.o.color || '#f2ecd8');
    if (st.paper) this._paper(c, 34, y0, W - 68, h);
    if (this.o.speaker) {
      c.font = st.label; c.fillStyle = st.paper ? '#7a1f14' : ink; c.globalAlpha = 0.9;
      c.fillText(String(this.o.speaker).toUpperCase(), 64, y0 + 38);
      c.globalAlpha = 1;
    }
    c.font = st.body;
    let left = Math.floor(n);
    this.lines.forEach((ln, i) => {
      const part = left >= ln.length ? ln : ln.slice(0, Math.max(0, left));
      left -= ln.length + 1;
      const y = y0 + top + (i + 1) * lh - 6;
      if (!st.paper) {
        // floating lettering: dark halo for contrast, then chalky ink with a faint glow
        c.lineJoin = 'round'; c.lineWidth = 9; c.strokeStyle = 'rgba(8,6,4,0.78)';
        c.strokeText(part, 64, y);
        c.shadowColor = ink; c.shadowBlur = 8;
      }
      c.fillStyle = ink;
      c.fillText(part, 64, y);
      c.shadowBlur = 0;
      if (part.length < ln.length && left < 0 && left > -ln.length - 2) {
        const x = 64 + c.measureText(part).width + 6;
        c.fillRect(x, y - lh * 0.55, 4, lh * 0.62); // pen tip
      }
    });
    this.tex.needsUpdate = true;
  }
  // visible plate height as a fraction of the screen half-height (FOV-independent)
  plateNdc() {
    const st = this._style();
    const ph = (this.o.speaker ? 54 : 16) + this.lines.length * st.lh + 26;
    return ph * FLOAT.noticeScale * (this.o.size || 1) / (Math.tan(Math.PI / 6) * 1.2);
  }
  set(text) { this.text = String(text); this.shown = 0; this.t = Math.min(this.t, FLOAT.popTime); this._layout(); }
  close() { if (this.closing < 0) this.closing = 0; }
  update(dt, cam, stackY) {
    this.t += dt;
    const total = this.lines.join(' ').length;
    if (this.shown < total) {
      this.shown = Math.min(total, this.shown + dt * FLOAT.typeRate);
      this._draw(this.shown);
    }
    if (this.t > this.life && this.closing < 0) this.closing = 0;
    let a = Math.min(1, this.t / 0.15);
    let s = easeOutBack(Math.min(1, this.t / FLOAT.popTime));
    if (this.closing >= 0) {
      this.closing += dt;
      const k = Math.min(1, this.closing / FLOAT.fade);
      a *= 1 - k; s *= 1 - k * 0.25;
      if (k >= 1) return false;
    }
    this.mat.opacity = a;
    const m = this.mesh;
    if (this.notice) {
      // camera space, laid out in screen units (stackY = bottom of this plate, 0..1 of the half-height
      // above NOTICE_BASE) so the size and spacing hold for any FOV (the watch close-up narrows it)
      cam.updateMatrixWorld();
      const d = 1.2, th = Math.tan(THREE.MathUtils.degToRad((cam.fov || 60) / 2));
      const k = th / Math.tan(Math.PI / 6);
      const half = this.plateNdc(cam) / 2;
      _v.set(0, (NOTICE_BASE + stackY + half) * th * d + Math.sin(this.t * 2) * 0.002, -d).applyMatrix4(cam.matrixWorld);
      m.position.copy(_v);
      m.quaternion.copy(cam.getWorldQuaternion(_q));
      m.scale.setScalar(FLOAT.noticeScale * (this.o.size || 1) * s * k);
    } else {
      const at = this.o.at;
      if (at?.isObject3D) at.getWorldPosition(_v); else if (at) _v.copy(at); else _v.set(0, 0, 0);
      if (this.o.offset) _v.add(this.o.offset); else _v.y += 0.45;
      _v.y += Math.sin(this.t * 1.7) * FLOAT.bobAmp;
      m.position.copy(_v);
      m.quaternion.copy(cam.getWorldQuaternion(_q));
      m.scale.setScalar(FLOAT.worldScale * (this.o.size || 1) * s);
    }
    return true;
  }
  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose(); this.mat.dispose(); this.tex.dispose();
  }
}

class FloatText {
  constructor() { this.items = []; }
  _add(b, scene) {
    b.fixedScene = scene || null;
    (scene || (b.notice ? noticeLayer().scene : null) || engine.view?.scene || engine.scene).add(b.mesh);
    this.items.push(b);
    return { set: (t) => b.set(t), close: () => b.close(), bubble: b };
  }
  say(text, o = {}) {
    // one bubble per speaker object: replace instead of stacking
    if (o.at) for (const b of this.items) if (!b.notice && b.o.at === o.at && b.closing < 0) b.close();
    return this._add(new Bubble(text, o, false), o.scene);
  }
  notice(text, o = {}) {
    const live = this.items.filter((b) => b.notice && b.closing < 0);
    if (live.length >= 2) live[0].close();
    return this._add(new Bubble(text, o, true), o.scene);
  }
  clear() { for (const b of this.items) b.close(); }
  update(dt, cam = engine.view?.camera || engine.camera) {
    let stack = 0;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const b = this.items[i];
      // slide smoothly when a notice above or below closes
      if (b.notice) b._sy = b._sy === undefined ? stack : b._sy + (stack - b._sy) * Math.min(1, dt * 10);
      const y = b.notice ? b._sy : 0;
      // notices ride the viewmodel layer (drawn over hands and the raised watch) unless a view is active
      let c = cam;
      if (b.notice && !b.fixedScene) { const L = noticeLayer(); if (b.mesh.parent !== L.scene) L.scene.add(b.mesh); c = L.camera; }
      if (!b.update(dt, c, y)) { b.dispose(); this.items.splice(i, 1); continue; }
      if (b.notice && b.closing < 0) stack += b.plateNdc() + 0.035;
    }
  }
}
// where screen notices live: the active view's scene (menu, minigames) or the viewmodel overlay
function noticeLayer() {
  if (engine.view && !engine.view.scene?.userData?.noNotices) return { scene: engine.view.scene, camera: engine.view.camera };
  return { scene: engine.vmScene || engine.scene, camera: engine.vmCamera || engine.camera };
}
export const floatText = new FloatText();
