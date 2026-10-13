// R.O.O.M. — procedural audio engine (Web Audio API, zero audio files).
//
//   import { audio } from './audio/audio.js';
//   await audio.init();                       // after a user gesture; idempotent, resumes if suspended
//   audio.setListener(camera.position, camera.quaternion);   // every frame
//   audio.update(dt);                         // every frame (loop schedulers, housekeeping)
//   const h = audio.play('impact_metal', { pos, intensity: 0.7 });   h?.stop()
//   const l = audio.loop('hum', { pos, flicker: 0.3 });   l.setParam('flicker', 1); l.stop(0.5)
//
// One-shots are synthesized in JS (sfx.js / dsp.js), mastered to consistent loudness, cached with several
// variations per sound (+ intensity tiers) and played with pitch/gain jitter. Loops are live graphs
// (loops.js / music.js). Graph: voices -> buses -> mix -> muffle LP -> compressor -> limiter -> master -> soft clip.

import { Synth, measure, mulberry32, clamp, dbg, TAU } from './dsp.js';
import { ONESHOTS, renderShot } from './sfx.js';
import { LOOPS, LoopKit } from './loops.js';
import { renderNote } from './music.js';

const BUSES = ['sfx', 'ambient', 'music', 'voice', 'ui'];
const BUS_SEND = { sfx: 0.5, ambient: 0.22, music: 0.12, voice: 0.25, ui: 0 };
const REF = 2, MAXD = 60;
const REVERBS = {
  none: null,
  office: { rt: 0.7, pre: 0.006, f0: 7000, f1: 1400, er: 12, erT: 0.025, wet: 0.5 },
  backrooms: { rt: 1.5, pre: 0.008, f0: 6000, f1: 900, er: 18, erT: 0.04, flut: 0.0165, ffb: 0.25, wet: 0.75 },
  small: { rt: 0.35, pre: 0.002, f0: 8000, f1: 2500, er: 8, erT: 0.012, wet: 0.4 },
  large: { rt: 2.8, pre: 0.025, f0: 7000, f1: 1200, er: 20, erT: 0.08, wet: 0.85 },
  pipe: { rt: 2.2, pre: 0.004, f0: 5000, f1: 1800, er: 25, erT: 0.02, flut: 0.0058, ffb: 0.55, wet: 0.85 },
  pool: { rt: 3.4, pre: 0.012, f0: 11000, f1: 3000, er: 24, erT: 0.05, flut: 0.021, ffb: 0.2, wet: 1.0 },
};
const NOOP = Object.freeze({ stop() {}, playing: false, duration: 0 });
const NOOP_LOOP = Object.freeze({ setPosition() {}, setVolume() {}, setPitch() {}, setParam() {}, setOcclusion() {}, stop() {}, playing: false });
const MASTER_TRIM = -13; // Chrome's compressor adds auto make-up gain; -13 dB makes the chain unity below ~-4 dBFS
const igain = (i) => 0.15 + 0.85 * Math.pow(clamp(i, 0, 1), 1.4);

function rampTo(param, v, now, dur) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
  else { param.cancelScheduledValues(now); param.setValueAtTime(param.value, now); }
  param.linearRampToValueAtTime(v, now + Math.max(0.005, dur));
}

function makeIR(sr, P) {
  const r = mulberry32((Math.random() * 1e9) | 0), len = Math.ceil((P.rt * 1.15 + P.pre + 0.05) * sr), k60 = 6.91 / P.rt;
  const hpA = Math.exp((-TAU * 90) / sr), chs = [];
  for (let c = 0; c < 2; c++) {
    const d = new Float32Array(len), pre = Math.round(P.pre * sr);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr, fc = P.f1 + (P.f0 - P.f1) * Math.exp(-t / (P.rt * 0.25));
      const a = Math.exp((-TAU * fc) / sr), w = r() * 2 - 1;
      lp = w + a * (lp - w);
      d[i] = lp * Math.exp(-k60 * t) * Math.min(1, t / (P.erT * 0.6 + 0.002));
    }
    for (let k = 0; k < P.er; k++) {
      const t = P.pre + Math.pow(r(), 1.3) * P.erT, i = Math.round(t * sr);
      const amp = (0.5 + 0.5 * r()) * Math.exp(-k60 * t) * (r() < 0.5 ? -1 : 1) * 1.2;
      [0.5, 1, 0.6, 0.25].forEach((v, j) => { if (i + j < len) d[i + j] += amp * v; });
    }
    if (P.flut) {
      const D = Math.round(P.flut * sr * (1 + c * 0.03));
      for (let i = D; i < len; i++) d[i] += P.ffb * d[i - D];
    }
    let y = 0;
    for (let i = 0; i < len; i++) { y = d[i] + hpA * (y - d[i]); d[i] -= y; }
    const fo = Math.round(0.05 * sr);
    for (let i = 0; i < fo; i++) d[len - 1 - i] *= i / fo;
    chs.push(d);
  }
  let e = 0;
  for (const d of chs) for (let i = 0; i < d.length; i++) e += d[i] * d[i];
  const g = 1 / Math.sqrt(e / 2 + 1e-12);
  for (const d of chs) for (let i = 0; i < d.length; i++) d[i] *= g;
  return chs;
}

// master chain: mix -> muffle LP -> trim -> compressor -> limiter -> master gain -> soft clip -> out
function buildMaster(c, o = {}) {
  const m = {};
  m.mixIn = c.createGain();
  m.muffleF = c.createBiquadFilter();
  m.muffleF.type = 'lowpass';
  m.muffleF.frequency.value = Math.min(22000, c.sampleRate * 0.49);
  m.muffleF.Q.value = 0.5;
  m.muffleG = c.createGain();
  m.trim = c.createGain();
  m.trim.gain.value = dbg(o.trim ?? MASTER_TRIM);
  m.comp = c.createDynamicsCompressor();
  for (const [k, v] of Object.entries({ threshold: -18, knee: 12, ratio: 3, attack: 0.008, release: 0.25, ...o.comp })) m.comp[k].value = v;
  m.lim = c.createDynamicsCompressor();
  for (const [k, v] of Object.entries({ threshold: -4, knee: 0, ratio: 20, attack: 0.001, release: 0.12, ...o.lim })) m.lim[k].value = v;
  m.masterG = c.createGain();
  m.clip = c.createWaveShaper();
  const n = 4096, cv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 4 - 2, a = Math.abs(x);
    cv[i] = Math.sign(x) * (a < 0.8 ? a : 0.8 + 0.195 * Math.tanh((a - 0.8) / 0.2));
  }
  m.clip.curve = cv;
  m.clip.oversample = '2x';
  m.mixIn.connect(m.muffleF).connect(m.muffleG).connect(m.trim).connect(m.comp).connect(m.lim).connect(m.masterG).connect(m.clip);
  return m;
}

class AudioSystem {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.hrtf = true;
    this.maxVoices = 48;
    this.voices = [];
    this.loops = new Set();
    this.vol = { master: 1, sfx: 1, ambient: 1, music: 1, voice: 1, ui: 1 };
    this.cache = new Map();
    this._samples = new Map();
    this._irs = new Map();
    this._queue = [];
    this._queued = new Set();
    this._recent = new Map();
    this._warned = new Set();
    this.L = { x: 0, y: 0, z: 0 };
    this._lInit = false;
    this.reverb = 'none';
    this.muffle = 0;
    this.stats = { renders: 0, renderMs: 0, stolen: 0, bytes: 0 };
    this.cacheBudgetMB = 48; // extra variations stop being rendered beyond this
    this._cacheBytes = 0;
    this._lastUpdate = 0;
  }

  // ------------------------------------------------------------------ init
  async init() {
    if (this.ctx) { await this._resume(); return this; }
    if (this._initP) return this._initP;
    this._initP = (async () => {
      const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      let c;
      try { c = new AC({ latencyHint: 'interactive' }); } catch (e) {
        console.warn('[audio] Web Audio unavailable, running silent', e);
        this._initP = null;
        return this;
      }
      this.ctx = c;
      Object.assign(this, buildMaster(c));
      this.masterG.gain.value = this.vol.master;
      this.analyser = c.createAnalyser();
      this.analyser.fftSize = 2048;
      this.clip.connect(c.destination);
      this.clip.connect(this.analyser);
      this.bus = {};
      for (const b of BUSES) {
        const g = c.createGain();
        g.gain.value = this.vol[b];
        g.connect(this.mixIn);
        this.bus[b] = g;
      }
      this.revIn = c.createGain();
      this.revHP = c.createBiquadFilter();
      this.revHP.type = 'highpass';
      this.revHP.frequency.value = 150;
      this.revIn.connect(this.revHP);
      this._mkNoise();
      this.ready = true;
      const rv = this._pendingReverb || 'backrooms';
      this.reverb = 'none';
      this.setReverb(rv);
      if (this.muffle) this.setMuffle(this.muffle);
      this._watch = setInterval(() => {
        // fallback scheduler when update() is not being called (hidden tab, paused game loop)
        if (this.loops.size && performance.now() - this._lastUpdate > 400) this._tickLoops(1.6);
      }, 500);
      const unlock = () => this._resume();
      for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, unlock, { passive: true });
      await this._resume();
      this._prewarm();
      return this;
    })();
    return this._initP;
  }
  async _resume() {
    const c = this.ctx;
    if (!c || c.state === 'running') return;
    try { await Promise.race([c.resume(), new Promise((r) => setTimeout(r, 300))]); } catch (e) { /* needs gesture */ }
  }
  _mkNoise() {
    const sr = this.ctx.sampleRate, S = new Synth(sr, 4242);
    const mk = (color) => this.makeBuffer([S.loopify(S.noise(6.05, color), 0.05)], sr);
    this.noise = { w: mk('w'), p: mk('p'), b: mk('b') };
    const lsr = 8000, n = lsr * 32, x = new Float32Array(n), P = 64, v = [];
    for (let k = 0; k < P; k++) v.push(S.r() * 2 - 1);
    v.push(v[0]);
    for (let i = 0; i < n; i++) {
      const u = (i / n) * P, k = Math.floor(u), f = u - k, s = 0.5 - 0.5 * Math.cos(Math.PI * f);
      x[i] = v[k] * (1 - s) + v[k + 1] * s;
    }
    this.rlfoBuf = this.makeBuffer([x], lsr);
  }
  makeBuffer(chs, sr) {
    const b = new AudioBuffer({ length: chs[0].length, numberOfChannels: chs.length, sampleRate: sr });
    chs.forEach((c, i) => b.copyToChannel(c, i));
    this.stats.bytes += chs.length * chs[0].length * 4;
    return b;
  }
  // generic cached sample (loops/music material)
  sample(key, fn) {
    let b = this._samples.get(key);
    if (!b) { b = fn(); this._samples.set(key, b); }
    return b;
  }

  // ------------------------------------------------------------------ rendering / cache
  // Render a one-shot (uncached). Public for tests/tools.
  render(name, intensity = 1, opts = {}) {
    const t0 = performance.now(), r = renderShot(name, intensity, opts.length);
    if (!r) return null;
    this.stats.renders++;
    this.stats.renderMs += performance.now() - t0;
    return this.makeBuffer(r.chs, r.sr);
  }
  _entry(name, R) {
    let e = this.cache.get(name);
    if (!e) { e = { tiers: (R.tiers || [1]).map(() => []), last: [] }; this.cache.set(name, e); }
    return e;
  }
  _tier(R, i) {
    if (!R.tiers) return 0;
    let best = 0;
    for (let k = 1; k < R.tiers.length; k++) if (Math.abs(R.tiers[k] - i) < Math.abs(R.tiers[best] - i)) best = k;
    return best;
  }
  // AudioBuffer for name (cached variation, or fresh render for live recipes)
  _vars(R) { return R.vars ?? (typeof R.d === 'number' && R.d > 1.5 ? 1 : 2); }
  buffer(name, intensity = 1, opts) {
    const R = ONESHOTS[name];
    if (!R) return null;
    const ti = this._tier(R, intensity), tv = R.tiers ? R.tiers[ti] : 1;
    if (R.live) return this.render(name, tv, opts || {});
    const e = this._entry(name, R), arr = e.tiers[ti];
    if (!arr.length) this._push(arr, this.render(name, tv));
    if (arr.length < this._vars(R) && this._cacheBytes < this.cacheBudgetMB * 1048576) this._enqueue(name, ti);
    let k = Math.floor(Math.random() * arr.length);
    if (arr.length > 1 && k === e.last[ti]) k = (k + 1 + Math.floor(Math.random() * (arr.length - 1))) % arr.length;
    e.last[ti] = k;
    return arr[k];
  }
  _enqueue(name, ti, min) {
    const key = name + '|' + ti;
    if (this._queued.has(key)) return;
    this._queued.add(key);
    this._queue.push({ name, ti, key, min });
    this._pump();
  }
  // instrument sample (music.js) render request
  queueNote(key, instr, zone, vt) {
    if (this._samples.has(key) || this._queued.has(key)) return;
    this._queued.add(key);
    this._queue.push({ note: true, key, instr, zone, vt });
    this._pump();
  }
  _needed(job) {
    if (job.note) return !this._samples.has(job.key);
    const R = ONESHOTS[job.name];
    return this._entry(job.name, R).tiers[job.ti].length < (job.min ?? this._vars(R));
  }
  _accept(job, buf) {
    this._queued.delete(job.key);
    if (job.note) { if (!this._samples.has(job.key)) this._samples.set(job.key, buf); return; }
    const R = ONESHOTS[job.name], arr = this._entry(job.name, R).tiers[job.ti];
    if (arr.length < (job.min ?? this._vars(R))) this._push(arr, buf);
  }
  _push(arr, buf) {
    arr.push(buf);
    this._cacheBytes += buf.length * buf.numberOfChannels * 4;
  }
  _startWorker() {
    this._inflight = new Map();
    this._jid = 0;
    this._worker = null;
    if (typeof Worker === 'undefined' || this.noWorker) return;
    try {
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => {
        const d = e.data, job = this._inflight.get(d.id);
        this._inflight.delete(d.id);
        if (job) {
          if (d.error) { console.error('[audio] worker render failed', job.key, d.error); this._queued.delete(job.key); }
          else this._accept(job, this.makeBuffer(d.chs, d.sr));
        }
        this._pump();
      };
      w.onerror = (e) => {
        console.warn('[audio] render worker unavailable, rendering on main thread', e.message || '');
        e.preventDefault?.();
        this._worker = null;
        for (const j of this._inflight.values()) this._queue.unshift(j);
        this._inflight.clear();
        this._pump();
      };
      this._worker = w;
    } catch (e) { this._worker = null; }
  }
  _pump() {
    if (this._worker === undefined) this._startWorker();
    if (this._worker) {
      while (this._inflight.size < 2 && this._queue.length) {
        const job = this._queue.shift();
        if (!this._needed(job)) { this._queued.delete(job.key); continue; }
        const id = ++this._jid;
        this._inflight.set(id, job);
        if (job.note) this._worker.postMessage({ id, kind: 'note', instr: job.instr, zone: job.zone, vt: job.vt });
        else { const R = ONESHOTS[job.name]; this._worker.postMessage({ id, name: job.name, i: R.tiers ? R.tiers[job.ti] : 1 }); }
      }
      return;
    }
    if (this._pumpT) return;
    const run = () => {
      this._pumpT = null;
      const t0 = performance.now();
      while (this._queue.length && performance.now() - t0 < 6) {
        const job = this._queue.shift();
        if (!this._needed(job)) { this._queued.delete(job.key); continue; }
        try {
          if (job.note) { const r = renderNote(job.instr, job.zone, job.vt); this._accept(job, this.makeBuffer(r.chs, r.sr)); }
          else { const R = ONESHOTS[job.name]; this._accept(job, this.render(job.name, R.tiers ? R.tiers[job.ti] : 1)); }
        } catch (err) { console.error('[audio] render failed', job.key, err); this._queued.delete(job.key); }
      }
      if (this._queue.length && !this._worker) this._pumpT = setTimeout(run, 8);
    };
    this._pumpT = setTimeout(run, 0);
  }
  _prewarm() {
    const names = Object.keys(ONESHOTS).filter((n) => !ONESHOTS[n].live);
    names.sort((a, b) => (ONESHOTS[b].tiers ? 1 : 0) - (ONESHOTS[a].tiers ? 1 : 0));
    for (const name of names) (ONESHOTS[name].tiers || [1]).forEach((_, ti) => this._enqueue(name, ti, 1));
  }
  // bytes held by cached audio
  memory() {
    let b = 0;
    const add = (buf) => { if (buf) b += buf.length * buf.numberOfChannels * 4; };
    for (const e of this.cache.values()) for (const t of e.tiers) t.forEach(add);
    for (const x of this._samples.values()) add(x);
    for (const x of this._irs.values()) add(x);
    if (this.noise) Object.values(this.noise).forEach(add);
    add(this.rlfoBuf);
    return +(b / 1048576).toFixed(1);
  }
  // offline gain of the master chain for test tones at given dBFS levels -> output dBFS
  async measureChain(levels = [-40, -30, -20, -12, -6, 0], opts) {
    const sr = 44100, seg = 0.5, oc = new OfflineAudioContext(1, Math.ceil(sr * seg * levels.length), sr);
    const m = buildMaster(oc, opts), o = oc.createOscillator(), g = oc.createGain();
    o.frequency.value = 997;
    levels.forEach((l, k) => g.gain.setValueAtTime(dbg(l), k * seg));
    o.connect(g).connect(m.mixIn);
    m.clip.connect(oc.destination);
    o.start();
    const d = (await oc.startRendering()).getChannelData(0);
    return levels.map((l, k) => {
      let e = 0, pk = 0;
      const a = Math.round((k + 0.6) * seg * sr), b = Math.round((k + 1) * seg * sr);
      for (let i = a; i < b; i++) { e += d[i] * d[i]; pk = Math.max(pk, Math.abs(d[i])); }
      const rms = Math.sqrt(e / (b - a)) * Math.SQRT2;
      return { in: l, out: +(20 * Math.log10(rms + 1e-9)).toFixed(1), peak: +pk.toFixed(3) };
    });
  }

  // ------------------------------------------------------------------ spatial helpers
  _dist(p) { const dx = p.x - this.L.x, dy = p.y - this.L.y, dz = p.z - this.L.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }
  _distGain(d, ref = REF) { return ref / (ref + Math.max(0, Math.min(d, MAXD) - ref)); }
  _cutoff(d, occ) { return Math.min(22000 * Math.exp(-d / 40), 20000 * Math.pow(600 / 20000, occ)); }
  _panner(pos, o = {}) {
    const p = this.ctx.createPanner();
    p.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = o.refDistance ?? REF;
    p.maxDistance = o.maxDistance ?? MAXD;
    p.rolloffFactor = o.rolloff ?? 1;
    this._setPos(p, pos, false);
    return p;
  }
  _setPos(p, v, smooth) {
    if (p.positionX) {
      if (smooth) {
        const t = this.ctx.currentTime;
        p.positionX.setTargetAtTime(v.x, t, 0.02); p.positionY.setTargetAtTime(v.y, t, 0.02); p.positionZ.setTargetAtTime(v.z, t, 0.02);
      } else { p.positionX.value = v.x; p.positionY.value = v.y; p.positionZ.value = v.z; }
    } else p.setPosition(v.x, v.y, v.z);
  }

  // ------------------------------------------------------------------ listener / global
  setListener(pos, quat) {
    if (!this.ready) return;
    const l = this.ctx.listener, now = this.ctx.currentTime;
    this.L.x = pos.x; this.L.y = pos.y; this.L.z = pos.z;
    const { x, y, z, w } = quat || { x: 0, y: 0, z: 0, w: 1 };
    const fx = -2 * (w * y + x * z), fy = 2 * (w * x - y * z), fz = -1 + 2 * (x * x + y * y);
    const ux = 2 * (x * y - w * z), uy = 1 - 2 * (x * x + z * z), uz = 2 * (y * z + w * x);
    if (l.positionX) {
      const vals = [[l.positionX, pos.x], [l.positionY, pos.y], [l.positionZ, pos.z], [l.forwardX, fx], [l.forwardY, fy], [l.forwardZ, fz], [l.upX, ux], [l.upY, uy], [l.upZ, uz]];
      for (const [p, v] of vals) { if (!this._lInit) p.value = v; else p.setTargetAtTime(v, now, 0.012); }
      this._lInit = true;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }
  setReverb(preset) {
    if (!(preset in REVERBS)) { this._warn('reverb:' + preset); return; }
    if (!this.ready) { this._pendingReverb = preset; return; }
    if (preset === this.reverb) return;
    this.reverb = preset;
    const c = this.ctx, now = c.currentTime, old = this._conv;
    if (old) {
      old.g.gain.setTargetAtTime(0, now, 0.4);
      setTimeout(() => { old.conv.disconnect(); old.g.disconnect(); }, 2500);
    }
    this._conv = null;
    const P = REVERBS[preset];
    if (!P) return;
    let ir = this._irs.get(preset);
    if (!ir) { ir = this.makeBuffer(makeIR(c.sampleRate, P), c.sampleRate); this._irs.set(preset, ir); }
    const conv = c.createConvolver();
    conv.normalize = false;
    conv.buffer = ir;
    const g = c.createGain();
    g.gain.value = 0;
    this.revHP.connect(conv);
    conv.connect(g);
    g.connect(this.mixIn);
    g.gain.setTargetAtTime(P.wet, now, 0.4);
    this._conv = { conv, g };
  }
  setBusVolume(bus, v) {
    if (!(bus in this.vol)) return;
    this.vol[bus] = Math.max(0, v);
    if (!this.ready) return;
    const node = bus === 'master' ? this.masterG : this.bus[bus];
    node.gain.setTargetAtTime(this.vol[bus], this.ctx.currentTime, 0.03);
  }
  setMuffle(amount) {
    this.muffle = clamp(amount || 0, 0, 1);
    if (!this.ready) return;
    const now = this.ctx.currentTime, a = this.muffle;
    this.muffleF.frequency.setTargetAtTime(Math.min(this.ctx.sampleRate / 2, 22000 * Math.pow(300 / 22000, a)), now, 0.08);
    this.muffleG.gain.setTargetAtTime(1 - 0.3 * a, now, 0.08);
  }

  // ------------------------------------------------------------------ one-shots
  play(name, opts = {}) {
    if (!this.ready) return null;
    const R = ONESHOTS[name];
    if (!R) { this._warn(name); return null; }
    const c = this.ctx;
    if (c.state !== 'running') return NOOP;
    const now = c.currentTime;
    // spam guard: same sound >4x within 30ms (physics piles)
    const rc = this._recent.get(name);
    if (rc && now - rc.t < 0.03) { if (++rc.n > 4) return NOOP; } else this._recent.set(name, { t: now, n: 1 });
    let dist = 0;
    if (opts.pos) { dist = this._dist(opts.pos); if (dist > MAXD * 1.1) return NOOP; }
    const intensity = clamp(opts.intensity ?? 1, 0, 1);
    let buf;
    try { buf = this.buffer(name, intensity, opts); } catch (e) { console.error('[audio] render', name, e); return null; }
    const src = c.createBufferSource();
    src.buffer = buf;
    const jit = R.jit ?? 30, rate = clamp((opts.pitch ?? 1) * 2 ** (((Math.random() * 2 - 1) * jit) / 1200), 0.05, 8);
    src.playbackRate.value = rate;
    const occ = clamp(opts.occlusion || 0, 0, 1);
    let vol = (opts.volume ?? 1) * dbg((Math.random() * 2 - 1) * 0.7) * (R.tiers || R.ig ? igain(intensity) : 1) * (1 - 0.55 * occ);
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(g);
    let tail = g;
    const nodes = [src, g];
    if (opts.pos || occ > 0) {
      const cut = this._cutoff(dist, occ);
      if (cut < 18000) {
        const f = c.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = Math.min(cut, c.sampleRate * 0.45); f.Q.value = 0.6;
        tail.connect(f); tail = f; nodes.push(f);
      }
    }
    const busName = opts.bus || R.bus || 'sfx', bus = this.bus[busName] || this.bus.sfx;
    const send = (opts.reverb ?? 1) * (R.send ?? 1) * (BUS_SEND[busName] ?? 0) * (opts.pos ? Math.sqrt(this._distGain(dist)) : 0.6);
    if (send > 0.002 && this._conv) {
      const s = c.createGain();
      s.gain.value = send;
      tail.connect(s); s.connect(this.revIn); nodes.push(s);
    }
    if (opts.pos) { const p = this._panner(opts.pos, opts); tail.connect(p); tail = p; nodes.push(p); }
    tail.connect(bus);
    const when = now + Math.max(0, opts.delay || 0), dur = buf.duration / rate;
    src.start(when);
    const v = { name, src, g, nodes, start: when, end: when + dur, vol: vol * (opts.pos ? this._distGain(dist) : 1), done: false, stopping: false };
    src.onended = () => this._free(v);
    this._limit(v, R);
    this.voices.push(v);
    return { stop: (fade = 0.05) => this._stopVoice(v, fade), get playing() { return !v.done; }, duration: dur };
  }
  _limit(v, R) {
    const now = this.ctx.currentTime;
    let live = 0, same = 0, oldestSame = null, victim = null, vs = Infinity;
    for (const x of this.voices) {
      if (x.done || x.stopping) continue;
      live++;
      if (x.name === v.name) { same++; if (!oldestSame || x.start < oldestSame.start) oldestSame = x; }
      const rem = clamp((x.end - now) / Math.max(0.01, x.end - x.start), 0, 1);
      const s = x.vol * (0.2 + rem);
      if (s < vs) { vs = s; victim = x; }
    }
    if (oldestSame && same >= (R.max ?? 6)) { this._stopVoice(oldestSame, 0.03); this.stats.stolen++; live--; if (victim === oldestSame) victim = null; }
    if (live >= this.maxVoices && victim) { this._stopVoice(victim, 0.03); this.stats.stolen++; }
    if (this.voices.length > this.maxVoices * 3) this.voices = this.voices.filter((x) => !x.done);
  }
  _stopVoice(v, fade = 0.05) {
    if (v.done || v.stopping) return;
    v.stopping = true;
    const t = this.ctx.currentTime;
    rampTo(v.g.gain, 0, t, fade);
    try { v.src.stop(t + fade + 0.01); } catch (e) { /* already stopped */ }
  }
  _free(v) {
    if (v.done) return;
    v.done = true;
    for (const n of v.nodes) n.disconnect();
  }
  get activeVoices() { return this.voices.filter((v) => !v.done && !v.stopping).length; }

  // ------------------------------------------------------------------ loops
  loop(name, opts = {}) {
    const D = LOOPS[name];
    if (!this.ready) return NOOP_LOOP;
    if (!D) { this._warn(name); return NOOP_LOOP; }
    const c = this.ctx, now = c.currentTime;
    const params = { ...D.params, ...(opts.params || {}) };
    for (const k in D.params) if (opts[k] !== undefined) params[k] = opts[k];
    const pre = c.createGain();
    pre.gain.value = dbg(D.level || 0);
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = Math.min(20000, c.sampleRate * 0.45); filt.Q.value = 0.6;
    const vol = c.createGain();
    vol.gain.value = 0;
    pre.connect(filt).connect(vol);
    const busName = opts.bus || D.bus || 'sfx', bus = this.bus[busName] || this.bus.sfx;
    const send = c.createGain();
    const baseSend = (opts.reverb ?? 1) * (BUS_SEND[busName] ?? 0);
    send.gain.value = baseSend * (opts.pos ? Math.sqrt(this._distGain(this._dist(opts.pos))) : 0.6);
    vol.connect(send);
    send.connect(this.revIn);
    const rec = { name, vol, filt, send, pre, bus, panner: null, params, occ: 0, dist: 0, baseSend, alive: true, opts };
    if (opts.pos) { rec.panner = this._panner(opts.pos, opts); rec.dist = this._dist(opts.pos); vol.connect(rec.panner).connect(bus); } else vol.connect(bus);
    const L = (rec.L = new LoopKit(this, c, pre, params));
    try { rec.inst = D.build(L, params) || {}; } catch (e) { console.error('[audio] loop build', name, e); rec.inst = {}; }
    const target = opts.volume ?? 1;
    vol.gain.setValueAtTime(0, now);
    vol.gain.linearRampToValueAtTime(target, now + Math.max(0.02, opts.fadeIn ?? 0.4));
    if (opts.pitch) L.setPitch(opts.pitch);
    this._applyFilt(rec, true);
    this.loops.add(rec);
    try { rec.inst.tick?.(now, now + 0.3); } catch (e) { console.error('[audio] loop tick', name, e); }
    const self = this;
    return (rec.h = {
      params,
      get playing() { return rec.alive; },
      setPosition(v) {
        if (!rec.alive || !v) return;
        if (!rec.panner) {
          rec.panner = self._panner(v, rec.opts);
          vol.disconnect(bus);
          vol.connect(rec.panner).connect(bus);
        } else self._setPos(rec.panner, v, true);
        rec.dist = self._dist(v);
        send.gain.setTargetAtTime(baseSend * Math.sqrt(self._distGain(rec.dist)), c.currentTime, 0.1);
        self._applyFilt(rec);
      },
      setVolume(v, rampSec = 0.1) { if (rec.alive) rampTo(vol.gain, Math.max(0, v), c.currentTime, rampSec); },
      setPitch(p) { if (rec.alive) L.setPitch(p); },
      setParam(k, v) {
        params[k] = v;
        if (!rec.alive) return;
        try { rec.inst.set?.(k, v, c.currentTime); } catch (e) { console.error('[audio] setParam', name, k, e); }
      },
      setOcclusion(o) { rec.occ = clamp(o || 0, 0, 1); if (rec.alive) self._applyFilt(rec); },
      stop(fadeSec = 0.3) { self._stopLoop(rec, fadeSec); },
    });
  }
  _applyFilt(rec, instant) {
    const d = rec.panner ? rec.dist : 0, maxD = rec.opts.maxDistance ?? MAXD;
    const cut = Math.min(this.ctx.sampleRate * 0.45, this._cutoff(d, rec.occ));
    const far = clamp((maxD * 1.1 - d) / (maxD * 0.3), 0, 1); // fade out past maxDistance (inverse model never reaches 0)
    const t = this.ctx.currentTime;
    if (instant) rec.filt.frequency.value = cut; else rec.filt.frequency.setTargetAtTime(cut, t, 0.08);
    rec.pre.gain.setTargetAtTime(dbg(LOOPS[rec.name].level || 0) * (1 - 0.55 * rec.occ) * far, t, instant ? 0.001 : 0.08);
  }
  _stopLoop(rec, fade = 0.3) {
    if (!rec.alive) return;
    rec.alive = false;
    this.loops.delete(rec);
    const c = this.ctx, now = c.currentTime;
    rampTo(rec.vol.gain, 0, now, Math.max(0.01, fade));
    try { rec.inst.stop?.(now + fade); } catch (e) { /* */ }
    setTimeout(() => {
      try { rec.inst.dispose?.(); } catch (e) { /* */ }
      rec.L.dispose();
      for (const n of [rec.pre, rec.filt, rec.vol, rec.send, rec.panner]) if (n) n.disconnect();
    }, (Math.max(0.01, fade) + 0.2) * 1000);
  }

  // ------------------------------------------------------------------ voice chat input
  makeSpatialInput(opts = {}) {
    if (!this.ready) return null;
    const c = this.ctx, input = c.createGain();
    input.gain.value = opts.volume ?? 1;
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = Math.min(20000, c.sampleRate * 0.45); filt.Q.value = 0.6;
    const pos = opts.pos || { x: 0, y: 0, z: 0 }, panner = this._panner(pos, { refDistance: 1.5, maxDistance: 40, ...opts });
    const send = c.createGain(), bus = this.bus[opts.bus || 'voice'];
    send.gain.value = BUS_SEND.voice;
    input.connect(filt).connect(panner).connect(bus);
    filt.connect(send).connect(this.revIn);
    const st = { occ: 0, dist: this._dist(pos), alive: true, vol: opts.volume ?? 1 };
    const upd = () => {
      const t = c.currentTime;
      filt.frequency.setTargetAtTime(Math.min(c.sampleRate * 0.45, this._cutoff(st.dist, st.occ)), t, 0.08);
      send.gain.setTargetAtTime(BUS_SEND.voice * Math.sqrt(this._distGain(st.dist, 1.5)), t, 0.1);
    };
    upd();
    return {
      input,
      setPosition: (v) => { if (!st.alive || !v) return; this._setPos(panner, v, true); st.dist = this._dist(v); upd(); },
      setOcclusion: (o) => { st.occ = clamp(o || 0, 0, 1); input.gain.setTargetAtTime(st.vol * (1 - 0.5 * st.occ), c.currentTime, 0.08); upd(); },
      setVolume: (v) => { st.vol = Math.max(0, v); input.gain.setTargetAtTime(st.vol * (1 - 0.5 * st.occ), c.currentTime, 0.05); },
      dispose: () => { if (!st.alive) return; st.alive = false; for (const n of [input, filt, panner, send]) n.disconnect(); },
    };
  }

  // ------------------------------------------------------------------ per frame
  update(dt = 0.016) {
    if (!this.ready) return;
    this._lastUpdate = performance.now();
    this._tickLoops(clamp((dt || 0.016) * 4, 0.25, 1));
    const now = this.ctx.currentTime;
    if ((this._frame = (this._frame || 0) + 1) % 60 === 0) {
      for (const v of this.voices) if (!v.done && v.end < now - 2) this._free(v); // onended safety net
      this.voices = this.voices.filter((v) => !v.done);
      for (const [k, r] of this._recent) if (now - r.t > 1) this._recent.delete(k);
    }
  }
  _tickLoops(ahead) {
    const now = this.ctx.currentTime, until = now + ahead;
    for (const rec of this.loops) {
      if (!rec.inst.tick) continue;
      try { rec.inst.tick(now, until); } catch (e) { console.error('[audio] loop tick', rec.name, e); rec.inst.tick = null; }
    }
  }
  // stop every loop and one-shot (level transitions, game over)
  stopAll(fade = 0.3) {
    if (!this.ready) return;
    for (const rec of [...this.loops]) this._stopLoop(rec, fade);
    for (const v of this.voices) this._stopVoice(v, Math.max(0.01, fade));
  }
  list() {
    return { oneShots: Object.keys(ONESHOTS).filter((n) => n[0] !== '_'), loops: Object.keys(LOOPS) };
  }
  _warn(name) {
    if (this._warned.has(name)) return;
    this._warned.add(name);
    console.warn('[audio] unknown sound:', name);
  }
  // Offline render of a loop for tests/tools: returns AudioBuffer (ticks scheduler via suspend()).
  async renderLoop(name, sec = 4, params = {}, sr = 44100) {
    const D = LOOPS[name], oc = new OfflineAudioContext(2, Math.ceil(sec * sr), sr);
    const pre = oc.createGain();
    pre.gain.value = dbg(D.level || 0);
    pre.connect(oc.destination);
    const pr = { ...D.params, ...params }, L = new LoopKit(this, oc, pre, pr), inst = D.build(L, pr) || {};
    inst.tick?.(0, 0.3);
    for (let t = 0.1; t < sec - 0.05; t += 0.1) {
      const tt = t;
      oc.suspend(tt).then(() => { inst.tick?.(tt, tt + 0.3); oc.resume(); });
    }
    const out = await oc.startRendering();
    inst.dispose?.();
    return out;
  }
}

export const audio = new AudioSystem();
export default audio;
export { measure };
