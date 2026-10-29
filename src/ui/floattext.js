// Floating 3D text for all dialogue and notices (no screen HUD).
//   floatText.say(text, { at, offset, speaker, color, duration, size, scene })
//       world text that hangs near a speaker (Object3D or Vector3), types itself out, bobs, fades.
//   floatText.notice(text, { color, duration, speaker })
//       text that floats in front of the camera, lower centre; several stack upwards.
// Both return a handle { set(text), close() }. Call floatText.update(dt, camera) once per frame.
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { FONT } from './fonts.js';

const W = 1024, H = 352; // tall enough for a speaker name over four lines
const NOTICE_BASE = -0.86; // bottom of the notice stack, in screen half-heights below centre
export const FLOAT = { typeRate: 40, popTime: 0.5, fade: 0.45, bobAmp: 0.012, worldScale: 0.0013, noticeScale: 0.0008 };

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
const GS = 192, GOX = 56, GOY = 132; // per-letter scratch canvas and the baseline origin inside it

// shared rough-ink textures (built once): dry specks that bite out of the ink, and soft pools where it lay heavier
let _ink = null;
function inkTextures() {
  if (_ink) return _ink;
  let seed = 7;
  const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const mk = () => { const cv = document.createElement('canvas'); cv.width = cv.height = 256; return cv; };
  const specks = mk(), pools = mk();
  let c = specks.getContext('2d');
  for (let i = 0; i < 1500; i++) {
    c.fillStyle = `rgba(0,0,0,${0.35 + r() * 0.6})`;
    c.beginPath(); c.arc(r() * 256, r() * 256, 0.4 + r() * r() * 1.6, 0, Math.PI * 2); c.fill();
  }
  c.lineCap = 'round'; // dry-brush streaks along the stroke direction
  for (let i = 0; i < 26; i++) {
    const x = r() * 256, y = r() * 256, a = -1.2 + r() * 0.5, l = 4 + r() * 10;
    c.strokeStyle = `rgba(0,0,0,${0.25 + r() * 0.4})`; c.lineWidth = 0.5 + r() * 0.8;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
  }
  c = pools.getContext('2d');
  for (let i = 0; i < 40; i++) {
    const x = r() * 256, y = r() * 256, rad = 6 + r() * 22;
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(60,38,14,${0.18 + r() * 0.2})`); g.addColorStop(1, 'rgba(60,38,14,0)');
    c.fillStyle = g; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return (_ink = { specks, pools });
}
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
    // a dark copy floating behind the lettering: real depth that shifts with parallax as you move
    this.shadowMat = new THREE.MeshBasicMaterial({ map: this.tex, color: 0x000000, transparent: true, opacity: 0, depthTest: !notice, depthWrite: false, toneMapped: false });
    this.shadow = new THREE.Mesh(this.mesh.geometry, this.shadowMat);
    this.shadow.position.set(10, -16, notice ? -30 : -46);
    this.shadow.scale.setScalar(1.02);
    this.shadow.renderOrder = 998;
    this.shadow.frustumCulled = false;
    this.mesh.add(this.shadow);
    this.lines = [];
    this._layout();
    this._draw(0);
  }
  // look: one face for everything (FONT.main, Cormorant Garamond) set as raised 3D lettering: an extruded
  // bronze body under an ivory-to-gold face, floating in the air with a parallax shadow behind it.
  // Every letter is set by hand: its own lean, baseline, size and ink pressure, with dry specks and
  // heavier pools in the ink, so no two lines look machine-set. Speech is italic, notices upright.
  // Paper scraps only when a caller asks (o.paper === true).
  _style() {
    if (this._st) return this._st;
    const italic = !this.notice || this.o.italic;
    const fam = FONT.main; // one face everywhere (callers' o.font is ignored on purpose)
    let hs = 2166136261;
    for (let i = 0; i < this.text.length; i++) hs = Math.imul(hs ^ this.text.charCodeAt(i), 16777619);
    this._st = {
      body: `${italic ? 'italic ' : ''}600 ${this.notice ? 58 : 64}px ${fam}`,
      label: `700 30px ${FONT.main}`,
      lh: this.notice ? 62 : 68,
      depth: this.notice ? 5 : 7,
      paper: this.notice && this.o.paper === true,
      ink: inkOn(this.o.color),
      seed: (hs >>> 0) % 233280,
    };
    return this._st;
  }
  _layout() {
    const c = this.ctx, st = this._style();
    c.font = st.body;
    this.lines = wrap(c, this.text, W - 150).slice(0, 4);
    const lh = st.lh, top = this.o.speaker ? 44 : 10;
    this._h = top + this.lines.length * lh + 24;
    this._y0 = (H - this._h) / 2;
    // place every letter once; k is its index in lines.join(' ') so typing order matches update()
    const R = (i) => this._rand(i);
    this.glyphs = [];
    let k = 0;
    this.lines.forEach((ln, i) => {
      const lx = st.paper ? 64 : (W - c.measureText(ln).width) / 2;
      const y = this._y0 + top + (i + 1) * lh - 10;
      const wave = R(i * 31 + 3) * 6.28;
      let drift = 0;
      for (let j = 0; j < ln.length; j++, k++) {
        const ch = ln[j], q = k * 11 + 100;
        if (ch === ' ') { drift += (R(q) - 0.5) * 2.2; continue; }
        const x = lx + c.measureText(ln.slice(0, j)).width + drift;
        drift += (R(q + 1) - 0.5) * 1.3;
        this.glyphs.push({
          ch, k, x, w: c.measureText(ch).width,
          y: y + Math.sin(x * 0.011 + wave) * 1.6 + (R(q + 2) - 0.5) * 3.2,
          rot: (R(q + 3) - 0.5) * 0.1,
          sx: 0.97 + R(q + 4) * 0.06, sy: 0.95 + R(q + 5) * 0.09,
          a: 0.84 + R(q + 6) * 0.16,
          p1: R(q + 7) * 256, p2: R(q + 8) * 256, p3: R(q + 9) * 256, p4: R(q + 10) * 256,
        });
      }
      k++; // the line break counts as one character
    });
    this._freeLayers();
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
  // the typed plate lives in two layers (under: paper, name, letter bodies; face: inked letter faces) so a
  // new letter's bronze body never covers an earlier face; both are freed once the line is fully inked
  _initLayers() {
    const mk = (w, h) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return cv; };
    const L = this._layers = { underCan: mk(W, H), faceCan: mk(W, H) };
    L.under = L.underCan.getContext('2d'); L.face = L.faceCan.getContext('2d');
    this.gcan = mk(GS, GS);
    const g = this.gctx = this.gcan.getContext('2d');
    const ink = inkTextures();
    this.speckPat = g.createPattern(ink.specks, 'repeat');
    this.poolPat = g.createPattern(ink.pools, 'repeat');
    const tint = this.o.color || '#f1e7cf';
    this.grad = g.createLinearGradient(0, -50, 0, 14);
    this.grad.addColorStop(0, '#fffaf0'); this.grad.addColorStop(0.55, tint); this.grad.addColorStop(1, '#b8955a');
    this._next = 0; this._cur = -1;
    this._drawBase(L.under);
    return L;
  }
  _freeLayers() {
    if (!this._layers) return;
    this._layers.underCan.width = this._layers.faceCan.width = 0; // release the backing stores now (Safari)
    this.gcan.width = 0;
    this._layers = null;
  }
  _drawBase(c) {
    const st = this._style(), R = (i) => this._rand(i);
    const y0 = this._y0;
    if (st.paper) this._paper(c, 34, y0, W - 68, this._h);
    if (!this.o.speaker) return;
    // the name in small caps between two pen strokes, each letter put down separately
    c.font = st.label;
    const name = String(this.o.speaker).toUpperCase(), sp = 7;
    const ws = [...name].map((ch) => c.measureText(ch).width);
    const nw = ws.reduce((a, b) => a + b, 0) + sp * (name.length - 1);
    c.fillStyle = c.strokeStyle = st.paper ? '#7a1f14' : '#d9bb7c';
    c.shadowColor = 'rgba(0,0,0,0.85)'; c.shadowBlur = 6;
    let x = (W - nw) / 2;
    for (let i = 0; i < name.length; i++) {
      c.save();
      c.translate(x, y0 + 30 + (R(i + 700) - 0.5) * 1.8);
      c.rotate((R(i + 740) - 0.5) * 0.06);
      c.globalAlpha = 0.85 + R(i + 780) * 0.15;
      c.fillText(name[i], 0, 0);
      c.restore();
      x += ws[i] + sp;
    }
    c.shadowBlur = 0; c.shadowColor = 'transparent';
    c.lineCap = 'round';
    const stroke = (xa, xb, yy, s) => {
      c.lineWidth = 1.4 + R(s) * 0.6;
      c.beginPath();
      c.moveTo(xa, yy + (R(s + 1) - 0.5) * 1.5);
      c.quadraticCurveTo((xa + xb) / 2, yy + (R(s + 2) - 0.5) * 3.5, xb, yy + (R(s + 3) - 0.5) * 1.5);
      c.stroke();
    };
    stroke((W - nw) / 2 - 74, (W - nw) / 2 - 18, y0 + 21, 820);
    stroke((W + nw) / 2 + 18, (W + nw) / 2 + 74, y0 + 21, 830);
  }
  _place(c, g, dx, dy) {
    c.save();
    c.translate(g.x + g.w / 2 + dx, g.y + dy);
    c.rotate(g.rot); c.scale(g.sx, g.sy);
    c.fillText(g.ch, -g.w / 2, 0);
    c.restore();
  }
  // a letter's body: stacked offsets from dark bronze to near-black, soft shadow on the deepest layer
  // (on paper: a faint bleed of ink into the fibres instead)
  _glyphBody(c, g, alpha) {
    const st = this._style();
    c.font = st.body;
    c.globalAlpha = alpha;
    if (st.paper) {
      c.fillStyle = st.ink; c.shadowColor = st.ink; c.shadowBlur = 2.5; c.globalAlpha = alpha * 0.3;
      this._place(c, g, 0.4, 0.4);
    } else {
      for (let d = st.depth; d >= 1; d--) {
        const k = d / st.depth;
        c.shadowColor = d === st.depth ? 'rgba(0,0,0,0.75)' : 'transparent';
        c.shadowBlur = d === st.depth ? 14 : 0; c.shadowOffsetY = d === st.depth ? 6 : 0;
        c.fillStyle = `rgb(${Math.round(70 - k * 55)},${Math.round(52 - k * 42)},${Math.round(30 - k * 26)})`;
        this._place(c, g, d * 0.8, d * 1.15);
      }
    }
    c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0;
    c.globalAlpha = 1;
  }
  // a letter's face, inked into the glyph canvas: gilded (or ink on paper), then heavier pools where
  // the pen pressed and dry specks where it skipped, at an offset of its own
  _glyphFace(g) {
    const c = this.gctx, st = this._style();
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, GS, GS);
    c.font = st.body;
    const gl = { ...g, x: GOX, y: GOY };
    if (st.paper) { c.fillStyle = st.ink; this._place(c, gl, 0, 0); } else {
      c.globalAlpha = 0.35; c.fillStyle = '#ffffff'; this._place(c, gl, -0.6, -1.2); // top-edge highlight
      c.globalAlpha = 1; c.fillStyle = this.grad; this._place(c, gl, 0, 0);
    }
    const tex = (pat, ox, oy) => { c.save(); c.translate(-ox, -oy); c.fillStyle = pat; c.fillRect(ox, oy, GS, GS); c.restore(); };
    c.globalCompositeOperation = 'source-atop';
    c.globalAlpha = st.paper ? 0.9 : 0.75;
    tex(this.poolPat, g.p1, g.p2);
    c.globalCompositeOperation = 'destination-out';
    c.globalAlpha = st.paper ? 0.9 : 0.7;
    tex(this.speckPat, g.p3, g.p4);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
  }
  _draw(n) {
    const L = this._layers || this._initLayers();
    const done = Math.floor(n), frac = n - done;
    // commit every letter that has fully inked in
    while (this._next < this.glyphs.length && this.glyphs[this._next].k < done) {
      const g = this.glyphs[this._next];
      this._glyphBody(L.under, g, g.a);
      if (this._cur !== this._next) this._glyphFace(g);
      L.face.globalAlpha = g.a;
      L.face.drawImage(this.gcan, g.x - GOX, g.y - GOY);
      L.face.globalAlpha = 1;
      this._next++;
    }
    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    c.drawImage(L.underCan, 0, 0);
    c.drawImage(L.faceCan, 0, 0);
    // the next letter inks in softly instead of popping
    const g = this.glyphs[this._next];
    if (g && g.k === done && frac > 0.02) {
      if (this._cur !== this._next) { this._glyphFace(g); this._cur = this._next; }
      this._glyphBody(c, g, g.a * frac);
      c.globalAlpha = g.a * frac;
      c.drawImage(this.gcan, g.x - GOX, g.y - GOY);
      c.globalAlpha = 1;
    }
    this.tex.needsUpdate = true;
    if (this._next >= this.glyphs.length) this._freeLayers(); // the main canvas now holds the finished plate
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
    this.shadowMat.opacity = a * 0.42;
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
    this.mesh.geometry.dispose(); this.mat.dispose(); this.shadowMat.dispose(); this.tex.dispose();
    this._freeLayers();
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
