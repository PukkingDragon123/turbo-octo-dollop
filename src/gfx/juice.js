// Game-feel helpers shared by every system. Tune here, call one-liners at game events.
//   juice.shake(0.4)      camera trauma (0..1, squared falloff, decays)
//   juice.hitstop(70)     freeze game time for N ms (main loop scales dt)
//   juice.flash(0.6)      white (or tinted) screen flash through the final post pass
//   juice.punch(0.08)     quick FOV zoom punch on big events
import * as THREE from 'three';
import { engine } from '../core/engine.js';

export const JUICE = { shakeDecay: 1.6, shakeMaxRot: 0.045, shakeMaxPos: 0.06, flashDecay: 9, punchDecay: 7 };

class Juice {
  constructor() {
    this.trauma = 0;
    this.stopT = 0;
    this.fov = 0;
    this._t = 0;
  }
  shake(t = 0.3) { this.trauma = Math.min(1, this.trauma + t); }
  hitstop(ms = 60) { this.stopT = Math.max(this.stopT, ms / 1000); }
  flash(a = 0.5, color = null) {
    const P = engine.post?.params;
    if (!P) return;
    P.uFlash.value = Math.max(P.uFlash.value, a);
    if (color && P.uFadeColor) void color; // tint reserved: uFlash is white
  }
  punch(a = 0.08) { this.fov = Math.max(this.fov, a); }
  // main loop: returns the scaled dt (0 during hit-stop)
  scaleDt(dt) {
    if (this.stopT > 0) { this.stopT -= dt; return dt * 0.04; }
    return dt;
  }
  // after the game positioned the camera: add shake + fov punch
  applyCamera(cam, dt) {
    this._t += dt;
    this.trauma = Math.max(0, this.trauma - JUICE.shakeDecay * dt);
    this.fov = Math.max(0, this.fov - JUICE.punchDecay * dt * this.fov - dt * 0.02);
    const s = this.trauma * this.trauma;
    if (s > 0.0001) {
      const t = this._t * 37;
      const n = (o) => Math.sin(t * 1.3 + o) * 0.6 + Math.sin(t * 2.7 + o * 3.1) * 0.4;
      cam.rotation.z += n(1) * JUICE.shakeMaxRot * s;
      cam.rotation.x += n(2) * JUICE.shakeMaxRot * 0.6 * s;
      cam.position.x += n(3) * JUICE.shakeMaxPos * s;
      cam.position.y += n(4) * JUICE.shakeMaxPos * s;
    }
    if (this.fov > 0.001 && cam.isPerspectiveCamera) {
      cam.fov *= 1 - this.fov;
      cam.updateProjectionMatrix();
      this._fovDirty = true;
    }
  }
}
export const juice = new Juice();
void THREE;
