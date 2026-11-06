// Customizer foley: the spray hiss (live noise through a resonant band, its pressure following the
// trigger), the rattle of the mixing ball, and thin wrappers over the shared one-shots (audio.js).
import { audio } from '../../audio/audio.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function sfx(name, opts = {}) {
  if (!audio.ready) return null;
  try { return audio.play(name, { bus: 'ui', reverb: 0.4, ...opts }); } catch (e) { return null; }
}

// a short burst of filtered noise (rattle clicks, glass ticks, cloth swishes) without a recipe
export function noiseHit({ freq = 3000, q = 4, dur = 0.05, vol = 0.3, type = 'bandpass', delay = 0 } = {}) {
  if (!audio.ready || !audio.ctx || audio.ctx.state !== 'running' || !audio.noise) return;
  const c = audio.ctx, t = c.currentTime + delay;
  const src = c.createBufferSource(); src.buffer = audio.noise.w;
  src.playbackRate.value = 0.9 + Math.random() * 0.2;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  src.connect(f).connect(g).connect(audio.bus.ui || audio.bus.sfx);
  src.start(t, Math.random() * 4, dur + 0.05);
}
// the steel mixing ball rattling inside a spray can (n clacks)
export function rattle(n = 6, rate = 0.085, vol = 0.22) {
  for (let i = 0; i < n; i++) {
    noiseHit({ freq: 2600 + Math.random() * 1800, q: 9, dur: 0.035, vol: vol * (0.7 + Math.random() * 0.5), delay: i * rate + Math.random() * 0.015 });
    noiseHit({ freq: 900 + Math.random() * 300, q: 3, dur: 0.05, vol: vol * 0.5, delay: i * rate + 0.004 });
  }
}

// continuous spray hiss: set(pressure 0..1, nozzle 0 fine .. 1 wide)
export class Hiss {
  constructor() { this.on = false; this.p = 0; }
  _build() {
    if (this.src || !audio.ready || !audio.ctx || !audio.noise) return false;
    const c = audio.ctx;
    this.src = c.createBufferSource(); this.src.buffer = audio.noise.w; this.src.loop = true;
    this.hp = c.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 1400; this.hp.Q.value = 0.5;
    this.bp = c.createBiquadFilter(); this.bp.type = 'peaking'; this.bp.frequency.value = 4200; this.bp.Q.value = 1.4; this.bp.gain.value = 7;
    this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 9000; this.lp.Q.value = 0.4;
    this.g = c.createGain(); this.g.gain.value = 0;
    this.src.connect(this.hp).connect(this.bp).connect(this.lp).connect(this.g).connect(audio.bus.ui || audio.bus.sfx);
    this.src.start();
    return true;
  }
  set(p, wide = 0.5, flutter = 0) {
    if (!this._build()) return;
    const c = audio.ctx, t = c.currentTime;
    p = clamp(p, 0, 1);
    if (p > 0.02 && this.p <= 0.02) noiseHit({ freq: 5200, q: 1.2, dur: 0.12, vol: 0.12 });   // the "pssht" as the valve opens
    this.p = p;
    const v = p * (0.16 + 0.08 * wide) * (1 + flutter * 0.25);
    this.g.gain.setTargetAtTime(v, t, p > 0.02 ? 0.02 : 0.06);
    this.bp.frequency.setTargetAtTime(3600 + 1600 * (1 - wide) + flutter * 400, t, 0.05);
    this.lp.frequency.setTargetAtTime(7000 + 4000 * p, t, 0.05);
  }
  stop() {
    if (!this.src) return;
    const c = audio.ctx, t = c.currentTime;
    try { this.g.gain.setTargetAtTime(0, t, 0.04); this.src.stop(t + 0.3); } catch (e) { /* */ }
    const s = this.src; setTimeout(() => { try { s.disconnect(); } catch (e) { /* */ } }, 500);
    this.src = null;
  }
}
