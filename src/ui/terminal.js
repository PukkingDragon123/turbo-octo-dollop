// Diegetic terminal sessions: when a clone uses a device with a CRT, the camera glides up to
// the in-world screen and the keyboard drives its menu (W/S select, E/Enter confirm, Esc/Tab leave).
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { drawMenu } from './crt.js';
import { damp } from '../core/rng.js';

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

export class Terminal {
  constructor(game) {
    this.game = game;
    this.session = null;
    this.blend = 0;
    this.fromPos = new THREE.Vector3();
    this.fromQuat = new THREE.Quaternion();
  }

  get active() { return !!this.session; }

  // spec: { screen: CrtScreen, mesh: Mesh, view(): view, select(item, idx), anchorNormal?: Vector3, distance? }
  open(spec) {
    if (this.session) this.close();
    this.session = { ...spec, sel: 0, t: 0 };
    // small physical screens: show the same canvas as a readable CRT panel beside the device
    if (spec.overlay && spec.screen) {
      if (!this.panel) {
        this.panel = document.createElement('div');
        this.panel.id = 'pxterm';
        this.panel.style.cssText = 'position:fixed;right:4vw;top:50%;transform:translateY(-50%);width:min(46vw,620px);z-index:12;pointer-events:none;line-height:0;';
        document.body.appendChild(this.panel);
      }
      this.panel.innerHTML = '';
      spec.screen.canvas.style.cssText = 'width:100%;height:auto;display:block;image-rendering:auto;';
      this.panel.appendChild(spec.screen.canvas);
      this.panel.style.display = 'block';
    }
    this.game.local.terminal = this.session;
    this.game.local.releaseGrab(false);
    this.blend = 0;
    this.fromPos.copy(engine.camera.position);
    this.fromQuat.copy(engine.camera.quaternion);
    audio.play('ui_boot', { volume: 0.4, bus: 'ui' });
    this._computePose();
    this.game.ui.setPrompt(null);
  }

  close() {
    if (!this.session) return;
    if (this.panel) { this.panel.style.display = 'none'; this.panel.innerHTML = ''; }
    this.session.onClose?.();
    this.session = null;
    this.game.local.terminal = null;
    audio.play('ui_back', { volume: 0.4, bus: 'ui' });
  }

  _computePose() {
    const s = this.session;
    const mesh = s.mesh;
    if (!mesh && !s.target) { s.pose = null; return; }
    let size;
    if (s.target) {
      _p.copy(s.target);
      size = new THREE.Vector3(0.5, 0.5, 0.5);
    } else {
      mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mesh);
      box.getCenter(_p);
      size = box.getSize(new THREE.Vector3());
    }
    // facing normal: the device/prop front (+Z by convention), else the screen geometry
    const owner = s.prop?.root || s.device?.root;
    if (s.anchorNormal) _n.copy(s.anchorNormal);
    else if (owner) _n.set(0, 0, 1).applyQuaternion(owner.getWorldQuaternion(_q)).normalize();
    else {
      const nAttr = mesh?.geometry?.attributes?.normal;
      _n.set(0, 0, 0);
      if (nAttr) {
        const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
        const tmp = new THREE.Vector3();
        for (let i = 0; i < Math.min(nAttr.count, 64); i++) _n.add(tmp.fromBufferAttribute(nAttr, i).applyMatrix3(nm));
      }
      if (_n.lengthSq() < 0.01) _n.set(0, 0, 1).applyQuaternion(mesh.getWorldQuaternion(_q));
      _n.normalize();
    }
    const extent = Math.max(0.12, Math.max(size.x * Math.abs(_n.z) + size.z * Math.abs(_n.x), size.y));
    const fov = THREE.MathUtils.degToRad(engine.camera.fov);
    const dist = s.distance ?? (extent * 0.78) / Math.tan(fov / 2);
    const pos = _p.clone().addScaledVector(_n, dist);
    _m.lookAt(pos, _p, new THREE.Vector3(0, 1, 0));
    const quat = new THREE.Quaternion().setFromRotationMatrix(_m);
    s.pose = { pos, quat };
  }

  update(dt) {
    const s = this.session;
    if (!s) return;
    s.t += dt;
    if (s.device?.root && !s.device.root.parent) { this.close(); return; }
    if (s.prop && s.prop.dead) { this.close(); return; }
    // follow moving props (radio being carried)
    if (s.prop) this._computePose();
    // input
    const view = s.view();
    const items = view.items || [];
    const ready = s.t > 0.15;
    if (!ready) { /* swallow the key press that opened us */ }
    else if (items.length) {
      if (input.hit('forward') || input.hit('ArrowUp')) { s.sel = (s.sel - 1 + items.length) % items.length; audio.play('ui_blip', { volume: 0.3, bus: 'ui' }); }
      if (input.hit('back') || input.hit('ArrowDown')) { s.sel = (s.sel + 1) % items.length; audio.play('ui_blip', { volume: 0.3, bus: 'ui' }); }
      const w = input.consumeWheel();
      if (w) { s.sel = (s.sel + (w > 0 ? 1 : -1) + items.length) % items.length; audio.play('ui_blip', { volume: 0.25, bus: 'ui' }); }
      s.sel = Math.min(s.sel, items.length - 1);
      if (input.hit('interact') || input.hit('Enter') || input.hit('Space') || input.mouseHit(0)) {
        const it = items[s.sel];
        if (it && !it.disabled) {
          audio.play('ui_select', { volume: 0.4, bus: 'ui' });
          s.select(it, s.sel);
        } else audio.play('ui_error', { volume: 0.4, bus: 'ui' });
      }
    } else if (input.hit('interact') || input.hit('Enter')) {
      s.select?.(null, -1);
    }
    for (let i = 0; i < 9 && ready; i++) {
      if (input.hit('Digit' + (i + 1)) && items[i] && !items[i].disabled) { s.sel = i; s.select(items[i], i); }
    }
    if (ready && (input.hit('pause') || input.hit('watch') || input.hit('Backspace') || input.hit('drop'))) {
      if (s.back && s.back()) audio.play('ui_back', { volume: 0.3, bus: 'ui' });
      else { this.close(); return; }
    }
    // draw
    if (s.screen) {
      view.sel = s.sel;
      s.screen.draw(dt, (ctx, w, h, pal, t) => (s.draw ? s.draw(ctx, w, h, pal, t, view) : drawMenu(ctx, w, h, pal, t, view)), true);
    }
    // camera glide
    this.blend = damp(this.blend, 1, 7, dt);
    if (s.pose) {
      const cam = engine.camera;
      cam.position.lerpVectors(this.fromPos, s.pose.pos, this.blend);
      cam.quaternion.slerpQuaternions(this.fromQuat, s.pose.quat, this.blend);
      audio.setListener(cam.position, cam.quaternion);
    }
    // walk away = close
    const lp = this.game.local.pos;
    const anchor = s.prop ? s.prop.root.position : s.device?.root.position;
    if (anchor && Math.hypot(anchor.x - lp.x, anchor.z - lp.z) > 4) this.close();
  }
}
