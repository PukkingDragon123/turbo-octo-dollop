// R.O.O.M. — offline DSP toolkit.
// Every one-shot in the game is synthesized here in plain JS into Float32Arrays (fast, deterministic,
// sample-accurate), then wrapped into AudioBuffers by audio.js, cached with several variations and
// played back with per-play pitch/gain jitter. Loops use these helpers to pre-render seamless material.

export const TAU = Math.PI * 2;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
export const dbg = (db) => 10 ** (db / 20);
export const sstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function mulberry32(seed) {
  let s = seed >>> 0 || 0x9e3779b9;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

// Formant tables F1..F4 (Hz), neutral adult voice; scale up for child/creature voices.
export const VOWELS = {
  a: [800, 1150, 2800, 3500], e: [480, 1850, 2600, 3500], i: [300, 2300, 3000, 3700],
  o: [480, 820, 2600, 3400], u: [330, 760, 2450, 3300], ae: [700, 1650, 2500, 3400],
  uh: [600, 1200, 2500, 3400], er: [480, 1350, 1700, 3300], m: [260, 1000, 2300, 3300],
  ee: [270, 2600, 3300, 4000],
};
const WAVE = { sin: 0, saw: 1, sq: 2, pulse: 2, tri: 3 };

export class Synth {
  constructor(sr = 44100, seed = (Math.random() * 4294967296) >>> 0) {
    this.sr = sr;
    this.rnd = mulberry32(seed);
  }
  // ---------- random ----------
  r() { return this.rnd(); }
  rr(a, b) { return a + (b - a) * this.rnd(); }
  ri(a, b) { return Math.floor(a + (b - a + 1) * this.rnd()); }
  pick(a) { return a[Math.floor(this.rnd() * a.length)]; }
  chance(p) { return this.rnd() < p; }
  j(v, amt = 0.1) { return v * (1 + (this.rnd() * 2 - 1) * amt); }
  sgn() { return this.rnd() < 0.5 ? -1 : 1; }
  // ---------- time ----------
  n(sec) { return Math.max(1, Math.ceil(sec * this.sr)); }
  buf(sec) { return new Float32Array(this.n(sec)); }
  dur(x) { return x.length / this.sr; }

  // number | Float32Array | fn(t) | breakpoints[[t,v,shape]] -> number or Float32Array
  sig(v, n) {
    if (typeof v === 'number') return v;
    if (v instanceof Float32Array) return v;
    if (typeof v === 'function') {
      const a = new Float32Array(n), sr = this.sr;
      for (let i = 0; i < n; i++) a[i] = v(i / sr);
      return a;
    }
    if (Array.isArray(v)) return this.env(n / this.sr, v);
    return 0;
  }

  // Breakpoint envelope. pts: [[t, v, shape?]], shape: undefined=linear, 'e'=exponential, 's'=cosine, number=power curve
  env(sec, pts) {
    const n = this.n(sec), a = new Float32Array(n), sr = this.sr;
    if (!pts.length) return a;
    let pt = 0, pv = pts[0][1];
    for (const p of pts) {
      const t1 = p[0], v1 = p[1], sh = p[2];
      const i0 = Math.max(0, Math.round(pt * sr)), i1 = Math.min(n, Math.round(t1 * sr));
      const L = Math.max(1, i1 - i0);
      if (sh === 'e') {
        const sgn = (v1 || pv) < 0 ? -1 : 1;
        let v = Math.max(Math.abs(pv), 1e-5);
        const r = Math.pow(Math.max(Math.abs(v1), 1e-5) / v, 1 / L);
        for (let i = i0; i < i1; i++) { a[i] = v * sgn; v *= r; }
      } else if (sh === 's') {
        for (let i = i0; i < i1; i++) a[i] = pv + (v1 - pv) * (0.5 - 0.5 * Math.cos((Math.PI * (i - i0)) / L));
      } else if (typeof sh === 'number') {
        for (let i = i0; i < i1; i++) a[i] = pv + (v1 - pv) * Math.pow((i - i0) / L, sh);
      } else {
        for (let i = i0; i < i1; i++) a[i] = pv + ((v1 - pv) * (i - i0)) / L;
      }
      pt = t1; pv = v1;
    }
    for (let i = Math.max(0, Math.round(pt * sr)); i < n; i++) a[i] = pv;
    return a;
  }

  // attack (raised cosine) -> hold -> exponential decay (time constant tau)
  ad(sec, att, tau, hold = 0) {
    const n = this.n(sec), a = new Float32Array(n), sr = this.sr;
    const na = Math.max(1, Math.round(att * sr)), nh = Math.round(hold * sr), k = Math.exp(-1 / (Math.max(tau, 1e-4) * sr));
    let v = 1;
    for (let i = 0; i < n; i++) {
      if (i < na) a[i] = 0.5 - 0.5 * Math.cos((Math.PI * i) / na);
      else if (i < na + nh) a[i] = 1;
      else { a[i] = v; v *= k; }
    }
    return a;
  }

  // ---------- oscillators ----------
  osc(sec, f, wave = 'sin', o = {}) {
    const n = this.n(sec), out = new Float32Array(n), sr = this.sr;
    const F = this.sig(f, n), fn = typeof F === 'number', last = fn ? 0 : F.length - 1;
    const w = WAVE[wave] ?? 0, pw = o.pw ?? 0.5;
    let ph = o.ph ?? this.rnd();
    for (let i = 0; i < n; i++) {
      const fr = fn ? F : F[i < last ? i : last];
      const dt = Math.min(Math.abs(fr) / sr, 0.49);
      let v;
      if (w === 0) v = Math.sin(TAU * ph);
      else if (w === 1) v = 2 * ph - 1 - blep(ph, dt);
      else if (w === 2) { let p2 = ph + 1 - pw; if (p2 >= 1) p2 -= 1; v = (ph < pw ? 1 : -1) + blep(ph, dt) - blep(p2, dt); }
      else v = 1 - 4 * Math.abs(ph - 0.5);
      out[i] = v;
      ph += dt;
      if (ph >= 1) ph -= 1;
    }
    return out;
  }

  // 2-op phase modulation: sin(2πφc + I·sin(2πφm)), modulator = ratio·fc (+ fixed Hz offset)
  fm(sec, fc, ratio, index, o = {}) {
    const n = this.n(sec), out = new Float32Array(n), sr = this.sr;
    const F = this.sig(fc, n), fn = typeof F === 'number', lf = fn ? 0 : F.length - 1;
    const I = this.sig(index, n), inum = typeof I === 'number', li = inum ? 0 : I.length - 1;
    const off = o.off || 0, fb = o.fb || 0;
    let pc = o.ph ?? 0, pm = 0, prev = 0;
    for (let i = 0; i < n; i++) {
      const fr = fn ? F : F[i < lf ? i : lf];
      const idx = inum ? I : I[i < li ? i : li];
      pm += (fr * ratio + off) / sr;
      pc += fr / sr;
      if (pm > 1e6) pm -= Math.floor(pm);
      if (pc > 1e6) pc -= Math.floor(pc);
      const m = Math.sin(TAU * pm + fb * prev);
      prev = m;
      out[i] = Math.sin(TAU * pc + idx * m);
    }
    return out;
  }

  // ---------- noise ----------
  noise(sec, color = 'w') {
    const n = this.n(sec), a = new Float32Array(n), r = this.rnd;
    if (color === 'p') {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) {
        const w = r() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        a[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    } else if (color === 'b') {
      let b = 0;
      for (let i = 0; i < n; i++) { b = (b + 0.02 * (r() * 2 - 1)) / 1.02; a[i] = b * 3.5; }
    } else {
      for (let i = 0; i < n; i++) a[i] = r() * 2 - 1;
    }
    return a;
  }

  // Poisson impulse train (crackle). rate: events/s (sig). o: {w: grain width (s), ap: amplitude exponent, min, hp}
  crackle(sec, rate, o = {}) {
    const n = this.n(sec), x = new Float32Array(n), sr = this.sr, r = this.rnd;
    const R = this.sig(rate, n), rn = typeof R === 'number', lr = rn ? 0 : R.length - 1;
    const W = Math.max(1, Math.round((o.w ?? 0.0006) * sr)), ap = o.ap ?? 3, mn = o.min ?? 0.05;
    for (let i = 0; i < n; i++) {
      const rt = rn ? R : R[i < lr ? i : lr];
      if (r() < rt / sr) {
        const amp = (mn + (1 - mn) * Math.pow(r(), ap)) * (r() < 0.5 ? -1 : 1);
        const L = Math.round(W * (0.5 + r()));
        for (let k = 0; k < L * 3 && i + k < n; k++) x[i + k] += amp * Math.exp(-k / L) * (r() * 2 - 1);
      }
    }
    if (o.hp) this.hp(x, o.hp);
    return x;
  }

  // ---------- filters (in place unless noted) ----------
  // TPT state-variable filter (stable under per-sample modulation). f: number|sig
  svf(x, mode, f, q = 0.707) {
    const n = x.length, sr = this.sr, F = this.sig(f, n), fn = typeof F === 'number', last = fn ? 0 : F.length - 1;
    const k = 1 / q;
    let cl = 0, cb = 0, ch = 0;
    if (mode === 'lp') cl = 1;
    else if (mode === 'hp') ch = 1;
    else if (mode === 'bp') cb = k;
    else if (mode === 'bpq') cb = 1;
    else if (mode === 'notch') { cl = 1; ch = 1; }
    let ic1 = 0, ic2 = 0, lf = -1, a1 = 0, a2 = 0, a3 = 0;
    const nyq = sr * 0.47;
    for (let i = 0; i < n; i++) {
      let fr = fn ? F : F[i < last ? i : last];
      if (fr !== lf && (fn || (i & 7) === 0)) {
        lf = fr;
        if (fr > nyq) fr = nyq; else if (fr < 5) fr = 5;
        const g = Math.tan((Math.PI * fr) / sr);
        a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2;
      }
      const v0 = x[i], v3 = v0 - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
      x[i] = cl * v2 + cb * v1 + ch * (v0 - k * v1 - v2);
    }
    return x;
  }
  lp(x, f, q = 0.707) { return this.svf(x, 'lp', f, q); }
  hp(x, f, q = 0.707) { return this.svf(x, 'hp', f, q); }
  bp(x, f, q = 1) { return this.svf(x, 'bp', f, q); }
  lp1(x, f) {
    const a = Math.exp((-TAU * f) / this.sr);
    let y = 0;
    for (let i = 0; i < x.length; i++) { y = x[i] + a * (y - x[i]); x[i] = y; }
    return x;
  }
  hp1(x, f) {
    const a = Math.exp((-TAU * f) / this.sr);
    let y = 0;
    for (let i = 0; i < x.length; i++) { y = x[i] + a * (y - x[i]); x[i] -= y; }
    return x;
  }
  // static RBJ biquad: type 'peak' | 'ls' | 'hs'
  eq(x, type, f, q, db) {
    const A = 10 ** (db / 40), w = (TAU * f) / this.sr, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'peak') { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; }
    else {
      const s = 2 * Math.sqrt(A) * al;
      if (type === 'ls') { b0 = A * (A + 1 - (A - 1) * cw + s); b1 = 2 * A * (A - 1 - (A + 1) * cw); b2 = A * (A + 1 - (A - 1) * cw - s); a0 = A + 1 + (A - 1) * cw + s; a1 = -2 * (A - 1 + (A + 1) * cw); a2 = A + 1 + (A - 1) * cw - s; }
      else { b0 = A * (A + 1 + (A - 1) * cw + s); b1 = -2 * A * (A - 1 + (A + 1) * cw); b2 = A * (A + 1 + (A - 1) * cw - s); a0 = A + 1 - (A - 1) * cw + s; a1 = 2 * (A - 1 - (A + 1) * cw); a2 = A + 1 - (A - 1) * cw - s; }
    }
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const xi = x[i], y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = xi; y2 = y1; y1 = y; x[i] = y;
    }
    return x;
  }
  // 2-pole resonator (impulse response = unit-amplitude decaying sine, time constant tau). Adds into out.
  reson(x, f, tau, g = 1, out) {
    const sr = this.sr, n = out.length, nx = x.length;
    if (f <= 0 || f >= sr * 0.48) return out;
    const w = (TAU * f) / sr, r = Math.exp(-1 / (tau * sr)), b1 = 2 * r * Math.cos(w), b2 = -r * r, a0 = g * Math.sin(w);
    let y1 = 0, y2 = 0;
    const end = Math.min(n, nx + Math.ceil(tau * sr * 7));
    for (let i = 0; i < end; i++) {
      const y = (i < nx ? a0 * x[i] : 0) + b1 * y1 + b2 * y2;
      y2 = y1; y1 = y; out[i] += y;
    }
    return out;
  }
  // modal bank: modes [[f, tau, amp], ...] excited by x, output length n (sec)
  modal(x, modes, sec) {
    const out = new Float32Array(this.n(sec));
    for (const m of modes) this.reson(x, m[0], m[1], m[2], out);
    return out;
  }

  // ---------- generators that add into an output buffer ----------
  // Tone with glide/vibrato/envelope. q: {f, f1, gt, wave, a, att, tau, hold, dur, env, vib:[rate, depth], fm:[ratio, index], lp, pw}
  tone(out, t, q) {
    const att = q.att ?? 0.002, tau = q.tau ?? 0.1, hold = q.hold || 0;
    const dur = q.dur ?? Math.min(att + hold + tau * 7, 10);
    const n = this.n(dur);
    let f = q.f;
    if (q.f1 != null || q.vib) {
      const f0 = q.f, f1 = q.f1 ?? q.f, gt = q.gt ?? dur / 3, vib = q.vib;
      const vph = this.rnd() * TAU;
      f = (tt) => {
        let v = f1 + (f0 - f1) * Math.exp(-tt / gt);
        if (vib) v *= 1 + vib[1] * Math.sin(TAU * vib[0] * tt + vph) * Math.min(1, tt / (vib[2] ?? 0.0001));
        return v;
      };
    }
    const x = q.fm ? this.fm(dur, f, q.fm[0], q.fm[1]) : this.osc(dur, f, q.wave || 'sin', { ph: q.ph ?? 0, pw: q.pw });
    this.mul(x, q.env ? this.sig(q.env, n) : this.ad(dur, att, tau, hold));
    if (q.lp) this.lp(x, q.lp, q.lq ?? 0.707);
    if (q.hp) this.hp(x, q.hp);
    return this.add(out, x, t, q.a ?? 1);
  }
  // Filtered noise burst. q: {color, att, tau, hold, dur, env, bp, q, lp, hp, a}
  nz(out, t, q) {
    const att = q.att ?? 0.001, tau = q.tau ?? 0.05, hold = q.hold || 0;
    const dur = q.dur ?? Math.min(att + hold + tau * 7, 10);
    const x = this.noise(dur, q.color || 'w');
    if (q.bp) this.svf(x, 'bp', q.bp, q.q ?? 1);
    if (q.lp) this.lp(x, q.lp, q.lq ?? 0.707);
    if (q.hp) this.hp(x, q.hp, q.hq ?? 0.707);
    this.mul(x, q.env ? this.sig(q.env, x.length) : this.ad(dur, att, tau, hold));
    this.norm(x, 1);
    return this.add(out, x, t, q.a ?? 1);
  }
  // Decaying sinusoid (fast rotation recurrence). Adds into out.
  part(out, t, f, a, tau, att = 0.0005, ph = 0) {
    const sr = this.sr;
    if (f <= 0 || f >= sr * 0.48 || a === 0) return out;
    const i0 = Math.round(t * sr), w = (TAU * f) / sr, c = Math.cos(w), s = Math.sin(w), k = Math.exp(-1 / (tau * sr));
    const na = Math.max(1, Math.round(att * sr));
    let re = Math.cos(ph), im = Math.sin(ph), e = a;
    const end = Math.min(out.length, i0 + Math.ceil(tau * sr * 7.5));
    for (let i = Math.max(0, i0), j = i - i0; i < end; i++, j++) {
      out[i] += im * e * (j < na ? j / na : 1);
      const nr = re * c - im * s;
      im = re * s + im * c; re = nr; e *= k;
    }
    return out;
  }
  // Bell/bar: partials [[ratio, amp, tau, beatHz?]] at fundamental f
  bell(out, t, f, partials, a = 1, att = 0.0008) {
    for (const p of partials) {
      const ph = this.rnd() * TAU;
      this.part(out, t, f * p[0], a * p[1], p[2], att, ph);
      if (p[3]) this.part(out, t, f * p[0] + p[3], a * p[1] * 0.7, p[2] * 0.9, att, ph + 1);
    }
    return out;
  }
  // Bubble (van den Doel): decaying sine with rising chirp. o: {rise, d (damping /s)}
  bubble(out, t, f0, a = 1, o = {}) {
    const sr = this.sr, d = o.d ?? 0.043 * f0 + 0.0014 * Math.pow(f0, 1.5), rise = o.rise ?? 0.15;
    const sig = rise * d, i0 = Math.round(t * sr), n = Math.min(out.length - i0, Math.ceil((7.5 / d) * sr));
    let ph = 0, e = a;
    const k = Math.exp(-d / sr), na = Math.max(1, Math.round(0.0006 * sr));
    for (let j = 0; j < n; j++) {
      const f = f0 * (1 + sig * (j / sr));
      ph += f / sr;
      if (i0 + j >= 0) out[i0 + j] += Math.sin(TAU * ph) * e * (j < na ? j / na : 1);
      e *= k;
    }
    return out;
  }
  // Scatter count events over [t0,t1]; pow>1 front-loads. fn(t, u, k)
  scatter(count, t0, t1, fn, pow = 1) {
    for (let k = 0; k < count; k++) {
      const u = Math.pow(this.rnd(), pow);
      fn(t0 + (t1 - t0) * u, u, k);
    }
  }
  // Formant tracks from vowel keyframes [[t, 'a'|[F1..F4], shape?]]
  formants(sec, keys, scale = 1) {
    const out = [];
    for (let k = 0; k < 4; k++) {
      const pts = keys.map(([t, v, sh]) => [t, (typeof v === 'string' ? VOWELS[v] : v)[k] * scale, sh]);
      out.push(this.env(sec, pts));
    }
    return out;
  }
  // Source-filter voice. q: {f0 sig, vow keys, scale, voice sig (0..1 voiced), breath sig, jit, tilt Hz, bw mult, gains, env sig, saw:true}
  vox(sec, q) {
    const n = this.n(sec), sr = this.sr, r = this.rnd;
    const F = this.formants(sec, q.vow || [[0, 'a']], q.scale ?? 1);
    const F0 = this.sig(q.f0 ?? 150, n), f0n = typeof F0 === 'number', lf = f0n ? 0 : F0.length - 1;
    const V = this.sig(q.voice ?? 1, n), vn = typeof V === 'number';
    const B = this.sig(q.breath ?? 0.08, n), bn = typeof B === 'number';
    const jit = q.jit ?? 0.012, tilt = Math.exp((-TAU * (q.tilt ?? 2500)) / sr);
    const src = new Float32Array(n);
    let ph = r(), jw = 0, ls = 0;
    for (let i = 0; i < n; i++) {
      jw = jw * 0.999 + (r() * 2 - 1) * 0.045;
      const f = (f0n ? F0 : F0[i < lf ? i : lf]) * (1 + jit * jw);
      const dt = Math.min(f / sr, 0.45);
      ph += dt;
      if (ph >= 1) ph -= 1;
      const g = 1 - 2 * ph + blep(ph, dt); // falling saw ~ glottal closure
      ls = g + tilt * (ls - g);
      const v = vn ? V : V[i], b = bn ? B : B[i];
      src[i] = ls * v * 1.6 + (r() * 2 - 1) * b * (ph < 0.6 ? 1 : 0.55);
    }
    const out = new Float32Array(n), gains = q.gains || [1, 0.7, 0.4, 0.22], bw = q.bw ?? 1, BW = [90, 110, 170, 250];
    for (let k = 0; k < 4; k++) {
      if (!gains[k]) continue;
      const x = src.slice();
      let mean = 0;
      for (let i = 0; i < n; i += 64) mean += F[k][i];
      mean /= Math.ceil(n / 64);
      this.svf(x, 'bp', F[k], clamp(mean / (BW[k] * bw), 0.7, 40));
      this.add(out, x, 0, gains[k]);
    }
    if (q.env) this.mul(out, this.sig(q.env, n));
    return out;
  }

  // ---------- effects ----------
  drive(x, k = 2) {
    const s = 1 / Math.tanh(k);
    for (let i = 0; i < x.length; i++) x[i] = Math.tanh(k * x[i]) * s;
    return x;
  }
  fold(x, k = 2) {
    for (let i = 0; i < x.length; i++) x[i] = Math.sin(x[i] * k);
    return x;
  }
  crush(x, bits = 8, hold = 1) {
    const q = 2 ** (bits - 1);
    let h = 0;
    for (let i = 0; i < x.length; i++) {
      if (i % hold === 0) h = Math.round(x[i] * q) / q;
      x[i] = h;
    }
    return x;
  }
  ring(x, f, mix = 1) {
    const sr = this.sr, F = this.sig(f, x.length), fn = typeof F === 'number';
    let ph = 0;
    for (let i = 0; i < x.length; i++) {
      ph += (fn ? F : F[i]) / sr;
      x[i] *= 1 - mix + mix * Math.sin(TAU * ph);
    }
    return x;
  }
  // feedback comb with damping (in place)
  comb(x, sec, fb, damp = 0) {
    const D = Math.max(1, Math.round(sec * this.sr)), b = new Float32Array(D);
    let w = 0, lpv = 0;
    for (let i = 0; i < x.length; i++) {
      const d = b[w];
      lpv = d + damp * (lpv - d);
      const y = x[i] + fb * lpv;
      b[w] = y;
      if (++w >= D) w = 0;
      x[i] = y;
    }
    return x;
  }
  allpass(x, sec, g = 0.6) {
    const D = Math.max(1, Math.round(sec * this.sr)), b = new Float32Array(D);
    let w = 0;
    for (let i = 0; i < x.length; i++) {
      const d = b[w], v = x[i] + g * d;
      b[w] = v;
      if (++w >= D) w = 0;
      x[i] = d - g * v;
    }
    return x;
  }
  // small Schroeder reverb (mono). Returns x mixed with wet, in place.
  verb(x, rt = 1.2, mix = 0.4, damp = 0.35, size = 1) {
    const dels = [0.0297, 0.0371, 0.0411, 0.0437, 0.0253, 0.0331];
    const wet = new Float32Array(x.length);
    for (const d0 of dels) {
      const d = d0 * size, c = x.slice();
      this.comb(c, d, 10 ** ((-3 * d) / rt), damp);
      for (let i = 0; i < x.length; i++) wet[i] += c[i];
    }
    this.allpass(wet, 0.0051 * size, 0.6);
    this.allpass(wet, 0.0017 * size, 0.6);
    this.allpass(wet, 0.0123 * size, 0.5);
    const wg = mix * 0.3;
    for (let i = 0; i < x.length; i++) x[i] = x[i] * (1 - mix) + wet[i] * wg;
    return x;
  }
  // variable-speed resample (linear). rate: number|sig over output index. Returns new array.
  speed(x, rate, outSec) {
    const n = outSec ? this.n(outSec) : Math.floor(x.length / (typeof rate === 'number' ? rate : 1));
    const R = this.sig(rate, n), rn = typeof R === 'number', out = new Float32Array(n);
    let p = 0;
    for (let i = 0; i < n; i++) {
      const k = Math.floor(p);
      if (k + 1 >= x.length) break;
      const f = p - k;
      out[i] = x[k] * (1 - f) + x[k + 1] * f;
      p += rn ? R : R[i];
    }
    return out;
  }
  rev(x) { return x.slice().reverse(); }

  // ---------- utils ----------
  add(dst, src, at = 0, g = 1) {
    const o = Math.round(at * this.sr);
    const s0 = Math.max(0, -o), e = Math.min(src.length, dst.length - o);
    for (let i = s0; i < e; i++) dst[i + o] += src[i] * g;
    return dst;
  }
  // add with wrap-around (for seamless loop rendering)
  addWrap(dst, src, at = 0, g = 1) {
    const N = dst.length;
    let o = Math.round(at * this.sr) % N;
    if (o < 0) o += N;
    for (let i = 0; i < src.length; i++) dst[(o + i) % N] += src[i] * g;
    return dst;
  }
  mul(x, y) {
    if (typeof y === 'number') { for (let i = 0; i < x.length; i++) x[i] *= y; return x; }
    if (typeof y === 'function') { const sr = this.sr; for (let i = 0; i < x.length; i++) x[i] *= y(i / sr); return x; }
    const L = y.length - 1;
    for (let i = 0; i < x.length; i++) x[i] *= y[i < L ? i : L];
    return x;
  }
  pan(o, src, at, g, p) {
    const a = ((clamp(p, -1, 1) + 1) * Math.PI) / 4;
    this.add(o[0], src, at, g * Math.cos(a));
    this.add(o[1], src, at, g * Math.sin(a));
    return o;
  }
  fadeIn(x, sec) {
    const n = Math.min(x.length, this.n(sec));
    for (let i = 0; i < n; i++) x[i] *= i / n;
    return x;
  }
  fadeOut(x, sec) {
    const n = Math.min(x.length, this.n(sec)), L = x.length;
    for (let i = 0; i < n; i++) x[L - 1 - i] *= i / n;
    return x;
  }
  peak(x) {
    let p = 0;
    for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > p) p = v; }
    return p;
  }
  norm(x, to = 1) {
    const p = this.peak(x);
    if (p > 1e-9) this.mul(x, to / p);
    return x;
  }
  // make a seamless loop: renders with extra tail, crossfades tail into head (equal power)
  loopify(x, xfSec) {
    const X = this.n(xfSec), N = x.length - X, out = x.slice(0, N);
    for (let i = 0; i < X; i++) {
      const u = i / X;
      out[i] = x[i] * Math.sin((u * Math.PI) / 2) + x[N + i] * Math.cos((u * Math.PI) / 2);
    }
    return out;
  }
}

// ---------- analysis / mastering ----------
// Perceptual-ish short-term loudness: HP 80 Hz + high shelf +4 dB @1.5k, max RMS over 50 ms windows.
export function measure(chs, sr) {
  const n = chs[0].length, m = new Float32Array(n);
  let peak = 0, nan = false, sum = 0;
  for (const c of chs) {
    for (let i = 0; i < n; i++) {
      const v = c[i];
      if (v !== v) { nan = true; continue; }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      m[i] += v / chs.length;
    }
  }
  const S = new Synth(sr, 1);
  S.hp(m, 80, 0.7);
  S.eq(m, 'hs', 1500, 0.7, 4);
  const W = Math.max(1, Math.round(sr * 0.05)), H = Math.max(1, W >> 1);
  let st = 0;
  for (let i = 0; i < n; i++) sum += m[i] * m[i];
  for (let s = 0; s < n; s += H) {
    let e = 0;
    const end = Math.min(n, s + W);
    for (let i = s; i < end; i++) e += m[i] * m[i];
    const r = Math.sqrt(e / W);
    if (r > st) st = r;
    if (end === n) break;
  }
  return { peak, st, rms: Math.sqrt(sum / n), nan, dur: n / sr };
}

function softclip(x) {
  const a = Math.abs(x);
  if (a <= 0.6) return x;
  const y = 0.6 + 0.395 * Math.tanh((a - 0.6) / 0.4);
  return x < 0 ? -y : y;
}

// Normalize to target short-term loudness (+db), cap peaks, trim silence, fade edges. Returns trimmed chans.
export function master(chs, sr, o = {}) {
  for (const c of chs) for (let i = 0; i < c.length; i++) if (c[i] !== c[i] || !isFinite(c[i])) c[i] = 0;
  if (o.norm !== false) {
    const m = measure(chs, sr);
    if (m.st > 1e-7) {
      let g = dbg((o.target ?? -16) + (o.db || 0)) / m.st;
      let pk = m.peak * g;
      const lim = o.clean ? 0.95 : 1.5;
      if (pk > lim) { g *= lim / pk; pk = lim; }
      for (const c of chs) {
        for (let i = 0; i < c.length; i++) {
          const v = c[i] * g;
          c[i] = pk > 0.95 ? softclip(v) : v;
        }
      }
    }
  }
  // trim tail below -78 dB
  let last = 0;
  const thr = 1.3e-4;
  for (const c of chs) for (let i = c.length - 1; i > last; i--) if (Math.abs(c[i]) > thr) { last = i; break; }
  const end = Math.min(chs[0].length, last + Math.round(sr * 0.012));
  const fo = Math.min(end, Math.round(sr * 0.01)), fi = 12;
  return chs.map((c) => {
    const t = c.slice(0, Math.max(end, 64));
    for (let i = 0; i < fo; i++) t[t.length - 1 - i] *= i / fo;
    for (let i = 0; i < fi && i < t.length; i++) t[i] *= i / fi;
    return t;
  });
}
