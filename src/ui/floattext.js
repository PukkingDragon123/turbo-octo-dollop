// Floating 3D text for all dialogue and notices (no screen HUD).
//   floatText.say(text, { at, offset, speaker, color, duration, size, scene })
//       world text that hangs near a speaker (Object3D or Vector3), types itself out, bobs, fades.
//   floatText.notice(text, { color, duration, speaker })
//       text that floats in front of the camera, lower centre; several stack upwards.
// Both return a handle { set(text), close() }. Call floatText.update(dt, camera) once per frame.
import * as THREE from 'three';
import { engine } from '../core/engine.js';

const W = 1024, H = 256;
const BODY = '600 44px "IBM Plex Mono", monospace';
const LABEL = '30px "VT323", monospace';
export const FLOAT = { typeRate: 48, popTime: 0.32, fade: 0.45, bobAmp: 0.012, worldScale: 0.0011, noticeScale: 0.00052 };

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
  _layout() {
    const c = this.ctx;
    c.font = BODY;
    this.lines = wrap(c, this.text, W - 120).slice(0, 4);
  }
  _draw(n) {
    const c = this.ctx, col = this.o.color || '#eaf6ee';
    c.clearRect(0, 0, W, H);
    const lh = 54, top = this.o.speaker ? 62 : 26;
    const h = top + this.lines.length * lh + 22;
    const y0 = (H - h) / 2;
    // soft plate: dark glass with a thin accent edge and scanlines
    c.fillStyle = 'rgba(6,10,9,0.62)';
    c.beginPath(); c.roundRect(20, y0, W - 40, h, 18); c.fill();
    c.strokeStyle = col; c.globalAlpha = 0.35; c.lineWidth = 2; c.stroke(); c.globalAlpha = 1;
    c.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = y0 + 2; y < y0 + h; y += 4) c.fillRect(22, y, W - 44, 1);
    if (this.o.speaker) {
      c.font = LABEL; c.fillStyle = col; c.globalAlpha = 0.85;
      c.fillText(String(this.o.speaker).toUpperCase(), 52, y0 + 40);
      c.globalAlpha = 1;
    }
    c.font = BODY;
    c.shadowColor = col; c.shadowBlur = 10;
    let left = Math.floor(n);
    this.lines.forEach((ln, i) => {
      const part = left >= ln.length ? ln : ln.slice(0, Math.max(0, left));
      left -= ln.length + 1;
      c.fillStyle = col;
      c.fillText(part, 52, y0 + top + 18 + i * lh + 22);
      if (part.length < ln.length && part.length >= 0 && left < 0 && left > -ln.length - 2) {
        const x = 52 + c.measureText(part).width + 4;
        c.fillRect(x, y0 + top + i * lh + 10, 20, 38); // block cursor
      }
    });
    c.shadowBlur = 0;
    this.tex.needsUpdate = true;
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
      // camera space: lower centre, stacked
      cam.updateMatrixWorld();
      const d = 1.2;
      _v.set(0, -0.26 + stackY + Math.sin(this.t * 2) * 0.003, -d).applyMatrix4(cam.matrixWorld);
      m.position.copy(_v);
      m.quaternion.copy(cam.getWorldQuaternion(_q));
      m.scale.setScalar(FLOAT.noticeScale * (this.o.size || 1) * s);
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
    if (live.length >= 3) live[0].close();
    return this._add(new Bubble(text, o, true), o.scene);
  }
  clear() { for (const b of this.items) b.close(); }
  update(dt, cam = engine.view?.camera || engine.camera) {
    let stack = 0;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const b = this.items[i];
      const y = b.notice ? stack : 0;
      // notices ride the viewmodel layer (drawn over hands and the raised watch) unless a view is active
      let c = cam;
      if (b.notice && !b.fixedScene) { const L = noticeLayer(); if (b.mesh.parent !== L.scene) L.scene.add(b.mesh); c = L.camera; }
      if (!b.update(dt, c, y)) { b.dispose(); this.items.splice(i, 1); continue; }
      if (b.notice) stack += 0.075 * (b.lines.length * 0.55 + 0.6) * (b.o.size || 1);
    }
  }
}
// where screen notices live: the active view's scene (menu, minigames) or the viewmodel overlay
function noticeLayer() {
  if (engine.view && !engine.view.scene?.userData?.noNotices) return { scene: engine.view.scene, camera: engine.view.camera };
  return { scene: engine.vmScene || engine.scene, camera: engine.vmCamera || engine.camera };
}
export const floatText = new FloatText();
