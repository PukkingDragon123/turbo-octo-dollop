// Floating 3D text for all dialogue and notices (no screen HUD).
//   floatText.say(text, { at, offset, speaker, duration, size, scene, slot })
//       world text that hangs near a speaker (Object3D or Vector3), types itself out, bobs, fades.
//   floatText.notice(text, { duration, speaker, paper })
//       text that floats in front of the camera, lower centre; several stack upwards.
// slot picks a font slot other than the default (e.g. 'label' for hover pop-ups; see fonts.js).
// Both return a handle { set(text), close() }. Call floatText.update(dt, camera) once per frame.
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { font } from './fonts.js';

const W = 1024, H = 352; // tall enough for a speaker name over four lines
const NOTICE_BASE = -0.86; // bottom of the notice stack, in screen half-heights below centre
export const FLOAT = { typeRate: 40, popTime: 0.5, fade: 0.45, bobAmp: 0.012, worldScale: 0.0013, noticeScale: 0.0008 };
const INK = '#eee5d1';        // every line of floating text is this one colour
const PAPER_INK = '#2a2118';  // except on a paper scrap

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
const easeOutBack = (t) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };

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
  // look: plain lettering in the slot's font (speech, notices = hint, paper scraps = note), one colour, a soft
  // shadow so it reads against anything. Whole lines are drawn as the font sets them (kerning, ligatures).
  // Paper scraps only when a caller asks (o.paper === true).
  _style() {
    if (this._st) return this._st;
    const paper = this.notice && this.o.paper === true;
    let hs = 2166136261;
    for (let i = 0; i < this.text.length; i++) hs = Math.imul(hs ^ this.text.charCodeAt(i), 16777619);
    this._st = {
      body: font(this.o.slot || (paper ? 'note' : this.notice ? 'hint' : 'speech'), this.notice ? 56 : 62),
      label: font('name', 28),
      lh: this.notice ? 62 : 68,
      paper,
      ink: paper ? PAPER_INK : INK,
      seed: (hs >>> 0) % 233280,
    };
    return this._st;
  }
  _layout() {
    const c = this.ctx, st = this._style();
    c.font = st.body;
    this.lines = wrap(c, this.text, W - 150).slice(0, 4);
    const top = this.o.speaker ? 44 : 10;
    this._h = top + this.lines.length * st.lh + 24;
    this._y0 = (H - this._h) / 2;
    this._freeLayer();
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
  // the paper scrap and the speaker name are drawn once onto a layer while the line types out; the layer is
  // dropped once the line is complete
  _initLayer() {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    this._layer = cv;
    this._drawBase(cv.getContext('2d'));
    return cv;
  }
  _freeLayer() {
    if (!this._layer) return;
    this._layer.width = 0; // release the backing store now (Safari)
    this._layer = null;
  }
  _drawBase(c) {
    const st = this._style(), y0 = this._y0;
    if (st.paper) this._paper(c, 34, y0, W - 68, this._h);
    if (!this.o.speaker) return;
    // the name, small and spaced, between two thin rules, in the same ink
    c.font = st.label;
    c.letterSpacing = '6px';
    const name = String(this.o.speaker).toUpperCase(), nw = c.measureText(name).width;
    c.fillStyle = st.ink;
    c.globalAlpha = 0.75;
    if (!st.paper) { c.shadowColor = 'rgba(0,0,0,0.6)'; c.shadowBlur = 5; }
    c.fillText(name, (W - nw) / 2, y0 + 30);
    c.shadowBlur = 0; c.shadowColor = 'transparent';
    c.letterSpacing = '0px';
    c.globalAlpha = 0.4;
    c.fillRect((W - nw) / 2 - 66, y0 + 21, 48, 1.5);
    c.fillRect((W + nw) / 2 + 18, y0 + 21, 48, 1.5);
    c.globalAlpha = 1;
  }
  _draw(n) {
    const c = this.ctx, st = this._style();
    const layer = this._layer || this._initLayer();
    c.clearRect(0, 0, W, H);
    c.drawImage(layer, 0, 0);
    c.font = st.body;
    c.fillStyle = st.ink;
    if (!st.paper) { c.shadowColor = 'rgba(0,0,0,0.6)'; c.shadowBlur = 6; c.shadowOffsetY = 2; }
    const top = this.o.speaker ? 44 : 10;
    let left = n;
    this.lines.forEach((ln, i) => {
      const y = this._y0 + top + (i + 1) * st.lh - 10;
      const x = st.paper ? 64 : (W - c.measureText(ln).width) / 2; // centred lines
      const full = Math.max(0, Math.min(ln.length, Math.floor(left)));
      if (full) c.fillText(ln.slice(0, full), x, y);
      // the next letter fades in instead of popping
      const frac = left - Math.floor(left);
      if (full < ln.length && left > 0 && frac > 0.02) {
        c.globalAlpha = frac;
        c.fillText(ln[full], x + c.measureText(ln.slice(0, full)).width, y);
        c.globalAlpha = 1;
      }
      left -= ln.length + 1;
    });
    c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0;
    this.tex.needsUpdate = true;
    if (n >= this.lines.join(' ').length) this._freeLayer(); // the main canvas now holds the finished plate
  }
  // visible plate height as a fraction of the screen half-height (FOV-independent)
  plateNdc() {
    const st = this._style();
    const ph = (this.o.speaker ? 44 : 10) + this.lines.length * st.lh + 24;
    return ph * FLOAT.noticeScale * (this.o.size || 1) / (Math.tan(Math.PI / 6) * 1.2);
  }
  set(text) { this.text = String(text); this.shown = 0; this.t = Math.min(this.t, FLOAT.popTime); this._st = null; this._layout(); }
  close() { if (this.closing < 0) this.closing = 0; }
  update(dt, cam, stackY) {
    this.t += dt;
    const total = this.lines.join(' ').length;
    if (this.shown < total) {
      this.shown = Math.min(total, this.shown + dt * FLOAT.typeRate);
      this._draw(this.shown);
    }
    if (this.t > this.life && this.closing < 0) this.closing = 0;
    let a = Math.min(1, this.t / 0.18);
    const pin = Math.min(1, this.t / FLOAT.popTime);
    let s = 0.82 + 0.18 * easeOutBack(pin);
    // flip up like a card standing on its baseline, with a slight swing
    let flip = (1 - easeOutBack(pin)) * -1.25, rise = 0;
    if (this.closing >= 0) {
      this.closing += dt;
      const k = Math.min(1, this.closing / FLOAT.fade);
      const e = k * k;
      a *= 1 - k; s *= 1 - e * 0.12; flip += e * 0.55; rise = e;
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
      _v.set(0, (NOTICE_BASE + stackY + half) * th * d + Math.sin(this.t * 2) * 0.002 + rise * 0.03 * th * d, -d).applyMatrix4(cam.matrixWorld);
      m.position.copy(_v);
      m.quaternion.copy(cam.getWorldQuaternion(_q));
      m.rotateX(flip);
      m.scale.setScalar(FLOAT.noticeScale * (this.o.size || 1) * s * k);
    } else {
      const at = this.o.at;
      if (at?.isObject3D) at.getWorldPosition(_v); else if (at) _v.copy(at); else _v.set(0, 0, 0);
      if (this.o.offset) _v.add(this.o.offset); else _v.y += 0.45;
      _v.y += Math.sin(this.t * 1.7) * FLOAT.bobAmp + rise * 0.12;
      m.position.copy(_v);
      m.quaternion.copy(cam.getWorldQuaternion(_q));
      m.rotateX(flip);
      m.rotateY(Math.sin(this.t * 0.7) * 0.06);
      m.scale.setScalar(FLOAT.worldScale * (this.o.size || 1) * s);
    }
    return true;
  }
  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose(); this.mat.dispose(); this.tex.dispose();
    this._freeLayer();
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
