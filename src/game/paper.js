// The first-person "hold the paper up to the light" view for any canvas (the field notebook, notes):
//   const v = new PaperView(game); v.open(canvas, { width }); v.update(dt) every frame; v.reading
// Any key, a click or a tap puts it down again.
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';

export class PaperView {
  constructor(game) { this.game = game; this.reading = false; this.group = null; }
  open(canvas, o = {}) {
    const l = this.game.local;
    if (this.reading || l.terminal) return;
    this.W = o.width || 0.09;
    this.H = this.W * (canvas.height / canvas.width);
    if (!this.group) {
      this.group = new THREE.Group();
      this.back = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false }));
      this.back.position.z = -0.9; this.back.renderOrder = 50;
      this.mat = new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide, transparent: true });
      this.mat.color.setRGB(1.15, 1.13, 1.08);
      this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 8, 8), this.mat);
      this.mesh.renderOrder = 51;
      this.group.add(this.back, this.mesh);
      this.group.traverse((m) => { m.frustumCulled = false; });
    }
    if (this.canvas !== canvas) {
      this.tex?.dispose();
      this.tex = new THREE.CanvasTexture(canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
      this.mat.map = this.tex; this.mat.needsUpdate = true;
      this.canvas = canvas;
    }
    // a slight curl: pad paper never lies flat
    const P = this.mesh.geometry.attributes.position;
    const base = this._base || (this._base = Float32Array.from(P.array));
    for (let i = 0; i < P.count; i++) {
      const x = base[i * 3] * this.W, y = base[i * 3 + 1] * this.H;
      P.setXYZ(i, x, y, -((x / this.W) ** 2) * 0.01 - Math.sin((y / this.H + 0.5) * Math.PI) * 0.003);
    }
    P.needsUpdate = true;
    this.reading = true;
    this.t = 0; this.closeT = 0;
    this.session = { kind: 'paper' };
    l.releaseGrab?.(false);
    l.terminal = this.session;
    this.game.ui?.setPrompt?.(null);
    engine.vmCamera.add(this.group);
    this._tap = (e) => { if (this.t > 0.3 && !this.game.ui?.menuOpen) { e.preventDefault?.(); this.close(); } };
    window.addEventListener('pointerdown', this._tap, true);
  }
  close() {
    if (!this.reading) return;
    this.reading = false;
    this.closeT = 0;
    window.removeEventListener('pointerdown', this._tap, true);
    const l = this.game.local;
    if (l.terminal === this.session) l.terminal = null;
    audio.play('paper', { volume: 0.5, bus: 'ui', pitch: 1.2 });
  }
  update(dt) {
    const g = this.group;
    if (this.reading) {
      this.t += dt;
      const l = this.game.local;
      const lost = l.dead || this.game.state !== 'playing' || !this.game.world || (l.terminal && l.terminal !== this.session);
      const keys = this.t > 0.25 && !this.game.ui?.menuOpen && (input.hit('interact') || input.hit('pause') || input.hit('Backspace') || input.hit('Space') || input.hit('drop') || input.hit('watch') || input.mouseHit(0) || input.mouseHit(2));
      if (lost || keys) this.close();
    }
    if (!g || !g.parent) return;
    const k = this.reading ? Math.min(1, this.t / 0.35) : Math.max(0, 1 - (this.closeT += dt) / 0.25);
    if (!this.reading && k <= 0) { g.removeFromParent(); return; }
    const e = 1 - (1 - k) ** 3, cam = engine.vmCamera;
    const fov = THREE.MathUtils.degToRad(cam.fov / 2);
    const dist = Math.max((this.H * 0.62) / Math.tan(fov), (this.W * 0.62) / (Math.tan(fov) * cam.aspect));
    const t = this.t;
    this.mesh.position.set(Math.sin(t * 0.7) * 0.002, -0.3 * (1 - e) + Math.sin(t * 1.1) * 0.0015, -dist);
    this.mesh.rotation.set(-0.9 * (1 - e) - 0.04, Math.sin(t * 0.5) * 0.03, 0.04 * (1 - e) + Math.sin(t * 0.8) * 0.01 - 0.02);
    this.back.material.opacity = 0.55 * e;
  }
  dispose() { if (this.reading) this.close(); this.group?.removeFromParent(); this.tex?.dispose(); }
}
