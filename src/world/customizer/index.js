// R.O.O.M. — the CLONE CUSTOMIZER: a self-contained workshop station where you dress your clone by hand.
//
//   PAINT  (first)  a small spray robot on a lift column paints the clone where you drag (body and face),
//                   cans on a trolley pick the colour, a rag wipes, a red mushroom button undoes, a lever
//                   strips everything; a dial switches the nozzle between fine and wide.
//   EYES            glass jars of eyes on a shelf (liquid, bobbing eyeballs): pick a jar, the eyes are fished
//                   out and pop into the sockets.
//   RAGS            cloth garments hanging on a rail (simulated cloth): shirts, ponchos, scarves, hoods,
//                   wraps; click to put one on (one per torso / neck / head), click a worn one to take it off.
//   HATS            hats, face gear and trinkets on a pegboard; they fly over and settle on the clone.
//
// Navigation: paper tags on a string across the top of the view (or keys 1-4, arrows; Esc / Enter =
// done). Drag anywhere off the clone to spin the turntable; wheel / pinch zooms to the face in PAINT.
//
// API:
//   openCustomizer({ game, onDone(cos), onCancel(), cosmetics, station }) -> handle { close(save) }
//   isCustomizerOpen()
// It renders through engine.setView(scene, camera) and runs its own update loop (requestAnimationFrame);
// whoever opens it should not run their own engine.setView() while isCustomizerOpen() is true. On done
// it saves profile.data.cosmetics, applies them to game.local and sends 'cosmetics' to the host.
import * as THREE from 'three';
import { engine } from '../../core/engine.js';
import { profile } from '../../core/profile.js';
import { audio } from '../../audio/audio.js';
import { net } from '../../net/net.js';
import { Avatar } from '../../entities/avatar.js';
import { resolveCos, plainCosmetics } from '../../entities/doll/dollcos.js';
import { PaintLayer, paintTexture, registerFullPaint, paintId } from '../../entities/doll/paint.js';
import { font } from '../../ui/fonts.js';
import { P, ptex, css } from '../../entities/doll/handpaint.js';
import { PI, TAU, clamp, lerp, damp, easeIO, rnd, V, Hits } from './kit.js';
import { buildRoom, buildTurntable } from './room.js';
import { SprayStation } from './sprayer.js';
import { ChassisDials } from './dials.js';
import { sfx } from './sfx.js';
import { STATION_BUILDERS } from './registry.js';
import './jars.js';
import './rack.js';
import './pegboard.js';

let OPEN = null;
export const isCustomizerOpen = () => !!OPEN;

const STATIONS = ['paint', 'eyes', 'rags', 'hats'];
const LABEL = { paint: 'paint', eyes: 'eyes', rags: 'rags', hats: 'hats', done: 'done' };
// camera framings: pos / look / fov; the paint view zooms between 'paint' and 'face'
const VIEWS = {
  paint: { pos: V(-0.4, 1.06, -3.25), look: V(-0.34, 0.84, 0), fov: 34, fit: 2.3 },
  face: { pos: V(-0.2, 1.42, -1.1), look: V(-0.04, 1.34, 0), fov: 30, fit: 0.75 },
  eyes: { pos: V(0.32, 1.4, -1.5), look: V(0.62, 1.2, 0.2), fov: 40, fit: 1.7 },
  rags: { pos: V(-0.12, 1.42, -0.85), look: V(-1.22, 1.3, 1.45), fov: 42, fit: 2.3 },
  hats: { pos: V(-0.45, 1.5, -0.62), look: V(0.42, 1.3, 1.0), fov: 40, fit: 1.6 },
};

class Customizer {
  constructor({ game, onDone, onCancel, cosmetics, station }) {
    this.game = game; this.onDone = onDone; this.onCancel = onCancel;
    this.cos = plainCosmetics(cosmetics || profile.data.cosmetics || game?.local?.cosmetics || {});
    this.t = 0;
    this.scene = new THREE.Scene(); this.scene.name = 'Customizer';
    this.scene.background = new THREE.Color(0x8a7448);
    this.scene.fog = new THREE.FogExp2(0xa98f5c, 0.07);
    this.scene.environment = engine.defaultEnv;
    this.scene.environmentIntensity = 0.45;
    this.camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.03, 40);
    this.scene.add(this.camera);
    this.hits = new Hits();
    this.room = buildRoom(this.scene);
    this.tt = buildTurntable(); this.scene.add(this.tt.group);
    this.yaw = 0; this.yawV = 0; this.yawTick = 0;
    // the clone
    this.avatar = new Avatar(this.cos);
    this.avatar.setName(profile.name);
    this.avatar.root.position.y = 0.104;
    this.tt.top.add(this.avatar.root);
    this.avState = { speed: 0, grounded: true, expression: 'neutral', poseFn: (b) => this._pose(b) };
    this.eyeOut = 0; this.eyePop = 0;
    // paint layer: start from the saved paint (full resolution when this browser painted it)
    this.paint = new PaintLayer(1024);
    this.avatar.setPaintLayer(this.paint);
    if (this.cos.paint) {
      const e = paintTexture(this.cos.paint);
      e?.ready.then((layer) => { if (layer && this.paint.empty) { this.paint.ctx.drawImage(layer.canvas, 0, 0, 1024, 1024); this.paint.empty = false; this.paint.dirty = true; } });
    }
    this._paintStart = this.cos.paint;
    this.proxy = null; this.proxyDirty = true;
    // stations
    this.dials = new ChassisDials(this);
    this.spray = new SprayStation(this);
    this.stations = { paint: this.spray };
    // the other stations are part of the set from the start (built one per frame so opening is quick)
    this._pending = ['eyes', 'rags', 'hats'];
    this._buildTags();
    this.station = 'paint';
    this.zoom = 0; this.zoomT = 0;
    this.cam = { pos: VIEWS.paint.pos.clone(), look: VIEWS.paint.look.clone(), fov: VIEWS.paint.fov };
    this.camFrom = null; this.camT = 1;
    this.ptr = { x: 0, y: 0, ndc: new THREE.Vector2(), down: false, id: null, mode: null, sx: 0, sy: 0, moved: 0, t0: 0 };
    this.pointers = new Map();
    this.hover = null;
    this.fx = { pop: 0 };
    this._input(true);
    if (station && STATIONS.includes(station)) this.go(station, true);
  }

  // ------------------------------------------------------------------ nav tags (paper tags on a string)
  _buildTags() {
    const g = (this.tagRoot = new THREE.Group()); g.name = 'cz_tags';
    this.camera.add(g);
    this.tags = [];
    const keys = [...STATIONS, 'done'];
    const string = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x4a3a28, fog: false, depthTest: false, transparent: true }));
    string.renderOrder = 50; g.add(string); this.tagString = string;
    keys.forEach((k, i) => {
      const tex = ptex('cz_tag_' + k, 256, 160, (c, w, h, r) => {
        const kraft = k === 'done' ? 0xc9a74e : 0xd2b88a;
        c.clearRect(0, 0, w, h);
        c.fillStyle = css(kraft);
        c.beginPath(); c.moveTo(w * 0.16, 6); c.lineTo(w - 6, 6); c.lineTo(w - 6, h - 6); c.lineTo(w * 0.16, h - 6); c.lineTo(6, h / 2); c.closePath(); c.fill();
        P.strokes(c, w, h, kraft, r, { n: 18, alpha: 0.14, wid: 0.05 });
        P.blotches(c, w, h, 0x6a4a28, r, { n: 3, r: 0.25, alpha: 0.12 });
        c.globalCompositeOperation = 'destination-out';
        c.beginPath(); c.arc(w * 0.17, h / 2, 9, 0, TAU); c.fill();
        c.globalCompositeOperation = 'source-over';
        c.strokeStyle = css(0x8a6a40, 0.9); c.lineWidth = 3; c.beginPath(); c.arc(w * 0.17, h / 2, 12, 0, TAU); c.stroke();
        P.text(c, (i < 4 ? (i + 1) + '  ' : '') + LABEL[k], w * 0.6, h / 2 + 4, 76, 0x2e2418, r, { maxW: w * 0.7, slot: 'sign' });
      });
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false, depthTest: false, toneMapped: false, color: 0xe8dcc4 });
      const piv = new THREE.Group(); g.add(piv);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.625), mat);
      m.renderOrder = 51;
      m.rotation.z = PI / 2;   // hangs point-down from its eyelet
      m.position.y = -0.5;
      piv.add(m);
      this.hits.add(m, { type: 'tag', key: k, ui: true });
      this.tags.push({ k, piv, m, ang: 0, v: 0, low: 0 });
    });
  }
  _layoutTags(dt) {
    const d = 0.5, cam = this.camera;
    const hh = d * Math.tan((cam.fov * PI) / 360), hw = hh * cam.aspect;
    const n = this.tags.length;
    const s = Math.min(hh * 0.23, (hw * 1.7) / (n * 0.72));
    const span = s * 0.72 * (n - 1);
    const y0 = hh - s * 0.08;
    const pts = [];
    this.tags.forEach((T, i) => {
      const x = -span / 2 + i * s * 0.72;
      const sag = -s * 0.06 * Math.sin(((i + 0.5) / n) * PI);
      T.piv.position.set(x, y0 + sag, -d);
      T.piv.scale.setScalar(s * 0.62);
      const active = T.k === this.station ? 1 : 0;
      T.low = damp(T.low, active ? 1 : this.hover?.act?.key === T.k ? 0.4 : 0, 10, dt);
      T.v += (-60 * T.ang - 5 * T.v) * dt; T.ang += T.v * dt;
      T.piv.rotation.z = T.ang + Math.sin(this.t * 0.9 + i) * 0.03;
      T.m.position.y = -0.5 - T.low * 0.18;
      T.m.material.color.setHex(active ? 0xffffff : 0xd8ccb4);
      pts.push(V(x, y0 + sag + s * 0.01, -d));
    });
    // the string between the tags (a sagging line)
    const L = [V(-hw * 1.2, y0 + s * 0.1, -d), ...pts, V(hw * 1.2, y0 + s * 0.1, -d)];
    const curve = new THREE.CatmullRomCurve3(L);
    this.tagString.geometry.dispose();
    this.tagString.geometry = new THREE.TubeGeometry(curve, 48, s * 0.008, 4, false);
  }
  kickTag(k, a = 1) { const T = this.tags.find((x) => x.k === k); if (T) T.v += a * (Math.random() < 0.5 ? -6 : 6); }

  // ------------------------------------------------------------------ station flow
  go(st, instant = false) {
    if (st === 'done') { this.finish(); return; }
    if (!this.stations[st] && st !== 'paint') {
      // not built yet (eyes / rags / hats load on first visit)
      this._ensureStation(st);
    }
    if (st === this.station && !instant) return;
    this.station = st;
    this.kickTag(st, 1.2);
    sfx('paper', { volume: 0.5 });
    sfx('robo_whir', { volume: 0.12, pitch: 0.8 });
    this.camFrom = { pos: this.cam.pos.clone(), look: this.cam.look.clone(), fov: this.cam.fov };
    this.camT = instant ? 1 : 0;
    this.zoomT = 0;
  }
  _ensureStation(st) {
    const build = STATION_BUILDERS[st];
    if (build && !this.stations[st]) {
      try { this.stations[st] = build(this); } catch (e) { console.error('[customizer] station', st, e); }
    }
  }
  _view() {
    const v = VIEWS[this.station] || VIEWS.paint;
    if (this.station !== 'paint' || this.zoom < 0.001) return v;
    const f = VIEWS.face, z = easeIO(this.zoom);
    return { pos: v.pos.clone().lerp(f.pos, z), look: v.look.clone().lerp(f.look, z), fov: lerp(v.fov, f.fov, z), fit: lerp(v.fit, f.fit, z) };
  }
  _updateCamera(dt) {
    const v = this._view();
    // narrow screens: back the camera off so `fit` metres stay in view horizontally
    const asp = window.innerWidth / Math.max(1, window.innerHeight);
    const halfW = Math.tan((v.fov * PI) / 360) * asp;
    const dist = v.pos.distanceTo(v.look), need = v.fit / 2 / Math.max(0.05, halfW);
    const pos = need > dist ? v.look.clone().add(v.pos.clone().sub(v.look).multiplyScalar(need / dist)) : v.pos;
    if (this.camT < 1 && this.camFrom) {
      this.camT = Math.min(1, this.camT + dt / 1.1);
      const k = easeIO(this.camT);
      this.cam.pos.copy(this.camFrom.pos).lerp(pos, k);
      this.cam.look.copy(this.camFrom.look).lerp(v.look, k);
      this.cam.fov = lerp(this.camFrom.fov, v.fov, k);
      // a little crane arc on the way
      this.cam.pos.y += Math.sin(k * PI) * 0.12;
    } else {
      this.cam.pos.lerp(pos, 1 - Math.exp(-8 * dt));
      this.cam.look.lerp(v.look, 1 - Math.exp(-8 * dt));
      this.cam.fov = damp(this.cam.fov, v.fov, 8, dt);
    }
    const c = this.camera;
    c.position.copy(this.cam.pos);
    // breathing handheld drift
    c.position.x += Math.sin(this.t * 0.31) * 0.006; c.position.y += Math.sin(this.t * 0.47) * 0.004;
    c.lookAt(this.cam.look);
    if (Math.abs(c.fov - this.cam.fov) > 1e-3 || Math.abs(c.aspect - asp) > 1e-3) { c.fov = this.cam.fov; c.aspect = asp; c.updateProjectionMatrix(); }
  }

  // ------------------------------------------------------------------ the clone's body as a raycast target
  // A static copy of the posed, skinned paint meshes (the clone holds still while it is being painted),
  // in rig-root space so the turntable can spin without rebuilding it.
  _buildProxy() {
    if (this.proxy) for (const m of this.proxy) { m.removeFromParent(); m.geometry.dispose(); }
    this.proxy = [];
    const av = this.avatar;
    av.root.updateMatrixWorld(true);
    const tmp = V();
    for (const sm of av.paintMeshes) {
      const g0 = sm.geometry, n = g0.attributes.position.count;
      const pos = new Float32Array(n * 3);
      sm.skeleton.update();
      for (let i = 0; i < n; i++) { sm.getVertexPosition(i, tmp); pos[i * 3] = tmp.x; pos[i * 3 + 1] = tmp.y; pos[i * 3 + 2] = tmp.z; }
      const g = new THREE.BufferGeometry();
      g.setIndex(g0.index);
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      for (const k of ['normal', 'paintPos', 'skinIndex', 'skinWeight']) if (g0.attributes[k]) g.setAttribute(k, g0.attributes[k]);
      g.computeBoundingSphere(); g.computeBoundingBox();
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
      m.matrixAutoUpdate = false;
      sm.parent.add(m);
      m.matrix.copy(sm.matrix);
      m.updateMatrixWorld(true);
      this.proxy.push(m);
    }
    this.proxyDirty = false;
  }
  _rayFilter(hits) {
    // front faces only (the robot never paints the inside of the coverall)
    for (const h of hits) { if (h.face && h.face.normal) { _n.copy(h.face.normal).transformDirection(h.object.matrixWorld); if (_n.dot(this._rc.ray.direction) < 0.05) return h; } }
    return null;
  }
  rayBody(origin, dir, far = 5) {
    if (this.proxyDirty) this._buildProxy();
    const rc = (this._rc ||= new THREE.Raycaster());
    rc.set(origin, dir); rc.near = 0; rc.far = far;
    return this._rayFilter(rc.intersectObjects(this.proxy, false));
  }
  pickBody(ndc) {
    if (this.proxyDirty) this._buildProxy();
    const rc = (this._rc ||= new THREE.Raycaster());
    rc.setFromCamera(ndc, this.camera); rc.near = 0; rc.far = 20;
    const h = this._rayFilter(rc.intersectObjects(this.proxy, false));
    if (!h) return null;
    const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
    return { point: h.point.clone(), normal: n, it: h };
  }
  pop(k = 0.5) { this.fx.pop = Math.max(this.fx.pop, k); }
  // eyes popped out (empty sockets) / popping back in with an overshoot
  _pose(b) {
    let s = 1;
    if (this.eyePop > 0) { const u = 1 - this.eyePop; s = 1 + Math.sin(u * PI * 2.5) * 0.4 * this.eyePop; this.eyeOut = 0; }
    else if (this.eyeOut > 0) s = 0.0001;
    if (s !== 1) { b.eyeL.scale.setScalar(s); b.eyeR.scale.setScalar(s); }
  }
  markBodyChanged() { this.proxyDirty = true; }

  // ------------------------------------------------------------------ input
  _input(on) {
    const el = engine.renderer.domElement;
    if (on) {
      this._h = {
        down: (e) => this._down(e), move: (e) => this._move(e), up: (e) => this._up(e), cancel: (e) => this._up(e, true),
        wheel: (e) => { if (!OPEN) return; e.preventDefault(); this.zoomIn(-Math.sign(e.deltaY) * 0.18); },
        key: (e) => this._key(e), ctx: (e) => e.preventDefault(),
      };
      el.addEventListener('pointerdown', this._h.down);
      window.addEventListener('pointermove', this._h.move, { passive: true });
      window.addEventListener('pointerup', this._h.up);
      window.addEventListener('pointercancel', this._h.cancel);
      el.addEventListener('wheel', this._h.wheel, { passive: false });
      window.addEventListener('keydown', this._h.key, { capture: true });
      el.addEventListener('contextmenu', this._h.ctx);
      this._prevTouch = el.style.touchAction; el.style.touchAction = 'none';
    } else if (this._h) {
      el.removeEventListener('pointerdown', this._h.down);
      window.removeEventListener('pointermove', this._h.move);
      window.removeEventListener('pointerup', this._h.up);
      window.removeEventListener('pointercancel', this._h.cancel);
      el.removeEventListener('wheel', this._h.wheel);
      window.removeEventListener('keydown', this._h.key, { capture: true });
      el.removeEventListener('contextmenu', this._h.ctx);
      el.style.touchAction = this._prevTouch || '';
      el.style.cursor = '';
    }
  }
  _ndc(e, out) { const r = engine.renderer.domElement.getBoundingClientRect(); out.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); return out; }
  _down(e) {
    if (!OPEN) return;
    if (!audio.ready) audio.init().catch(() => {});
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      // pinch: cancel any stroke, zoom with the finger spread
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.zoom };
      this.ptr.mode = 'pinch';
      return;
    }
    if (this.pointers.size > 2) return;
    const P0 = this.ptr;
    P0.id = e.pointerId; P0.down = true; P0.sx = P0.x = e.clientX; P0.sy = P0.y = e.clientY; P0.moved = 0; P0.t0 = performance.now();
    this._ndc(e, P0.ndc);
    try { engine.renderer.domElement.setPointerCapture?.(e.pointerId); } catch (err) { /* */ }
    // ui first (tags, cans, buttons, jars...), unless the clone stands in front of it
    const h = this._pickUI(P0.ndc);
    if (h) { P0.mode = 'click'; P0.act = h.act; P0.hit = h; this.stations[this.station]?.press?.(h.act, h); return; }
    if (this.station === 'paint' && this.pickBody(P0.ndc)) { P0.mode = 'paint'; return; }
    const st = this.stations[this.station];
    if (st?.dragStart && st.dragStart(P0)) { P0.mode = 'station'; return; }
    P0.mode = 'spin'; P0.lastX = e.clientX; P0.lastT = performance.now();
  }
  _move(e) {
    if (!OPEN) return;
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.ptr.mode === 'pinch' && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      this.zoom = clamp(this.pinch.z + (d - this.pinch.d) / 300, 0, 1);
      return;
    }
    const P0 = this.ptr;
    if (P0.down && e.pointerId !== P0.id) return;
    P0.moved = Math.max(P0.moved, Math.hypot(e.clientX - P0.sx, e.clientY - P0.sy));
    P0.x = e.clientX; P0.y = e.clientY;
    this._ndc(e, P0.ndc);
    if (P0.mode === 'spin') {
      const dx = e.clientX - P0.lastX, now = performance.now();
      this.yaw += dx * 0.009;
      this.yawV = damp(this.yawV, (dx * 0.009) / Math.max(1 / 240, (now - P0.lastT) / 1000), 18, 1 / 60);
      P0.lastX = e.clientX; P0.lastT = now;
    } else if (P0.mode === 'click' && P0.moved > 14 && this.station !== 'paint') {
      P0.mode = 'spin'; P0.lastX = e.clientX; P0.lastT = performance.now();
    } else if (P0.mode === 'station') this.stations[this.station]?.dragMove?.(P0);
  }
  _up(e, cancel = false) {
    if (!OPEN) return;
    this.pointers.delete(e.pointerId);
    const P0 = this.ptr;
    if (P0.mode === 'pinch') { if (this.pointers.size === 0) { P0.mode = null; P0.down = false; } return; }
    if (e.pointerId !== P0.id) return;
    P0.down = false;
    if (!cancel && P0.mode === 'click' && P0.moved < 18) this._click(P0.act, P0.hit);
    if (P0.mode === 'station') this.stations[this.station]?.dragEnd?.(P0);
    P0.mode = null; P0.id = null;
  }
  _key(e) {
    if (!OPEN || (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) return;
    if (!audio.ready) audio.init().catch(() => {});
    const k = e.code;
    let used = true;
    if (k === 'Escape' || k === 'Enter') this.finish();
    else if (/^Digit[1-4]$/.test(k)) this.go(STATIONS[+k.slice(5) - 1]);
    else if (k === 'ArrowRight' || k === 'Tab') this.go(STATIONS[(STATIONS.indexOf(this.station) + 1) % 4]);
    else if (k === 'ArrowLeft') this.go(STATIONS[(STATIONS.indexOf(this.station) + 3) % 4]);
    else if (k === 'KeyZ' && (e.ctrlKey || e.metaKey) && this.station === 'paint') this.spray.undo();
    else if (k === 'KeyQ' || k === 'KeyE') { this.yawV += k === 'KeyQ' ? -4 : 4; }
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }
  // clickable thing under the pointer; things of another station take you there; the clone occludes
  _pickUI(ndc) {
    const h = this.hits.pick(ndc, this.camera);
    if (!h || h.act.ui) return h;
    if (this.station === 'paint' || h.act.st !== this.station) {
      const b = this.pickBody(ndc);
      if (b && b.it.distance < h.dist) return null;
    }
    return h;
  }
  zoomIn(dz) { if (this.station === 'paint') this.zoom = clamp(this.zoom + dz, 0, 1); }
  _click(act, hit) {
    if (!act) return;
    if (act.type === 'tag') { this.kickTag(act.key, 1); this.go(act.key); return; }
    if (act.type === 'dial') { act.click(); return; }
    if (act.st && act.st !== this.station) { this.go(act.st); return; }
    const st = this.stations[act.st || this.station];
    if (act.st === 'paint') {
      const S = this.spray;
      if (act.type === 'can') { S.select(act.i); this.cans?.[act.i]; }
      else if (act.type === 'rag') S.takeRag();
      else if (act.type === 'undo') S.undo();
      else if (act.type === 'nozzle') S.toggleNozzle();
      else if (act.type === 'strip') S.strip();
      return;
    }
    st?.click?.(act, hit);
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    this.t += dt;
    // fade in from black on open
    const PP = engine.post?.params;
    if (PP?.uFade && this.t < 1.2) PP.uFade.value = Math.max(0, 1 - this.t / 0.6);
    if (this._pending.length) this._ensureStation(this._pending.shift());
    if (engine.view?.scene !== this.scene) engine.setView(this.scene, this.camera);
    // turntable: free spin with friction and a soft detent tick every 30 degrees
    if (this.ptr.mode !== 'spin') { this.yaw += this.yawV * dt; this.yawV *= Math.exp(-2.6 * dt); }
    const tick = Math.floor(this.yaw / (PI / 6));
    if (tick !== this.yawTick) { this.yawTick = tick; if (Math.abs(this.yawV) > 0.3 || this.ptr.mode === 'spin') sfx('knob_tick', { volume: 0.18, pitch: 0.7 }); }
    if (Math.abs(this.tt.top.rotation.y - this.yaw) > 1e-5) { this.tt.top.rotation.y = this.yaw; }
    this._updateCamera(dt);
    this._layoutTags(dt);
    // hover (cursor + highlights)
    const P0 = this.ptr;
    if (!P0.down || P0.mode === 'click') {
      const h = (this._hovN = (this._hovN || 0) + 1) % 2 === 0 ? (this._hovLast = this._pickUI(P0.ndc)) : this._hovLast;
      this.hover = h;
      if (h?.act?.hover && (!h.act.st || h.act.st === this.station)) h.act.hover(h);
      let cur = h ? 'pointer' : '';
      if (!h && this.station === 'paint' && !P0.down && this.pickBodyThrottled(P0.ndc)) cur = 'crosshair';
      engine.renderer.domElement.style.cursor = cur || 'grab';
    }
    // the clone: holds still (frozen pose) while in the paint booth so the spray lands true
    const painting = this.station === 'paint';
    const av = this.avatar;
    this.avState.lookAt = painting ? null : this.camera.position;
    const frozen = painting && !this._needPose;
    av.update(frozen ? 0 : dt, this.avState);
    if (frozen) av.cloth?.update(dt);   // the cloth still sways (and follows the turntable)
    this._needPose = false;
    // off the paint booth the clone moves: refresh its raycast copy now and then (occlusion tests only)
    if (!painting) { this._proxyT = (this._proxyT || 0) + dt; if (this._proxyT > 0.6) { this._proxyT = 0; this.proxyDirty = true; } }
    else if (this._wasAway) this.proxyDirty = true;
    this._wasAway = !painting;
    // stations
    // the robot tracks the pointer over the clone (hover pre-aims; holding sprays)
    let aim = null, onBody = false;
    if (painting && P0.mode === 'paint') {
      const b = this.pickBody(P0.ndc);
      if (b) { aim = b; this._lastAim = b; this._aimT = 0; onBody = true; } else aim = this._lastAim;   // off the clone: hold, no spray
    } else if (painting && !P0.down && this._hoverAim) {
      aim = this._hoverAim;
    }
    if (painting && !P0.down) {
      this._aimT = (this._aimT || 0) + dt;
      if ((this._hoverN = (this._hoverN || 0) + 1) % 3 === 0) this._hoverAim = engine.renderer.domElement.style.cursor === 'crosshair' ? this.pickBody(P0.ndc) : null;
    } else this._hoverAim = null;
    this.spray.update(dt, aim, P0.mode === 'paint' && onBody);
    for (const k of Object.keys(this.stations)) if (k !== 'paint') this.stations[k].update?.(dt, this.station === k);
    this.dials.update(dt);
    this.paint.flush();
    this.fx.pop = Math.max(0, this.fx.pop - dt * 2);
    this.eyePop = Math.max(0, this.eyePop - dt * 2.2);
    av.root.scale.setScalar(1 + Math.sin(this.fx.pop * 14) * this.fx.pop * 0.02);
  }
  pickBodyThrottled(ndc) {
    this._pbT = (this._pbT || 0) + 1;
    if (this._pbT % 4 === 0) this._pbLast = !!this.pickBody(ndc);
    return this._pbLast;
  }

  // ------------------------------------------------------------------ done / save
  async finish() {
    if (this._finishing) return;
    this._finishing = true;
    sfx('bell_ding', { volume: 0.35 });
    this.kickTag('done', 1.5);
    let paint = '';
    try { paint = this.paint.empty ? '' : await this.paint.encode(); } catch (e) { console.warn('[customizer] encode paint', e); }
    const cos = { ...this.cos, ...(this.avatar.cosmetics || {}), paint };
    const plain = plainCosmetics(cos);
    if (paint) { registerFullPaint(paint, this.paint); this.paint.undoStack.length = 0; }
    try {
      profile.data.cosmetics = plain;
      profile.save();
      this.game?.local?.setCosmetics?.(plain);
      const r = this.game?.roster?.get?.(this.game?.local?.id);
      if (r) r.cosmetics = { ...plain };
      if (this.game?.roster) net.toHost('cosmetics', plain);
    } catch (e) { console.warn('[customizer] save', e); }
    close(true, plain);
  }
  setCos(patch) {
    this.cos = plainCosmetics({ ...this.cos, ...patch, paint: this.cos.paint });
    this.avatar.setCosmetics({ ...this.cos });
    this.avatar.setPaintLayer(this.paint);
    this.proxyDirty = true; this._needPose = true;
  }
  dispose() {
    this._input(false);
    for (const s of Object.values(this.stations)) s.dispose?.();
    if (this.proxy) for (const m of this.proxy) m.geometry.dispose();
    this.avatar.setPaintLayer(null);
    this.avatar.dispose();
    this.scene.traverse((o) => { if (o.geometry && !o.isSkinnedMesh) o.geometry.dispose?.(); });
  }
}
const _n = V();
void paintId; void rnd; void font;


// ---------------------------------------------------------------------------- entry points
export function openCustomizer(opts = {}) {
  if (OPEN) return OPEN.handle;
  const cz = new Customizer({ game: opts.game || window.__game, ...opts });
  OPEN = cz;
  let last = performance.now();
  const tick = (now) => {
    if (OPEN !== cz) return;
    cz.raf = requestAnimationFrame(tick);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
    try { cz.update(dt); } catch (e) { console.error('[customizer]', e); }
  };
  cz.raf = requestAnimationFrame(tick);
  engine.setView(cz.scene, cz.camera);
  cz.handle = { close: (save = true) => (save ? cz.finish() : close(false)), get customizer() { return cz; } };
  window.__customizer = cz;
  return cz.handle;
}
function close(saved, cos) {
  const cz = OPEN;
  if (!cz) return;
  OPEN = null;
  cancelAnimationFrame(cz.raf);
  if (engine.view?.scene === cz.scene) engine.resetView();
  try { cz.dispose(); } catch (e) { console.warn('[customizer] dispose', e); }
  if (window.__customizer === cz) window.__customizer = null;
  try { if (saved) cz.onDone?.(cos); else cz.onCancel?.(); } catch (e) { console.error('[customizer] callback', e); }
}
export { resolveCos };
