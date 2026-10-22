// R.O.O.M. — continuous loops (live Web Audio graphs + pre-rendered seamless material + scheduled events).
// Each loop: { bus, level (dB trim), params: {defaults}, build(L, p) -> { set(k, v, now), tick(now, until), stop(t) } }
// L is a LoopKit: a tiny graph builder that tracks every node so the loop disposes cleanly.

import { Synth, TAU, clamp, lerp, sstep } from './dsp.js';
import { arc, impact, modalHit, rsteps, thud } from './sfx.js';

export const LOOPS = {};
const expRand = (mean) => -Math.log(1 - Math.random() * 0.999) * mean;
const rnd = (a, b) => a + (b - a) * Math.random();
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class LoopKit {
  constructor(A, c, out, params) {
    this.A = A; this.c = c; this.out = out; this.p = params;
    this.nodes = []; this.srcs = []; this.det = []; this.evs = new Set();
    this.pitch = 1; this.t0 = c.currentTime;
  }
  now() { return this.c.currentTime; }
  T(n) { this.nodes.push(n); return n; }
  gain(v = 1) { const g = this.c.createGain(); g.gain.value = v; return this.T(g); }
  filter(type, f, q = 0.707, gain = 0) {
    const b = this.c.createBiquadFilter();
    b.type = type; b.frequency.value = Math.min(f, this.c.sampleRate * 0.45); b.Q.value = q; b.gain.value = gain;
    return this.T(b);
  }
  wave(h, rp = true) {
    const n = h.length, re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 1; k < n; k++) { const a = h[k] || 0, ph = rp ? Math.random() * TAU : 0; re[k] = a * Math.sin(ph); im[k] = a * Math.cos(ph); }
    return this.c.createPeriodicWave(re, im);
  }
  osc(type, f, o = {}) {
    const s = this.c.createOscillator();
    if (typeof type === 'string') s.type = type; else s.setPeriodicWave(type);
    s.frequency.value = f;
    s.detune.value = o.det || 0;
    s.start(this.t0);
    this.srcs.push(s);
    if (o.pitch !== false) this.det.push([s.detune, o.det || 0]);
    return this.T(s);
  }
  buf(buffer, o = {}) {
    const s = this.c.createBufferSource();
    s.buffer = buffer;
    s.loop = o.loop !== false;
    s.playbackRate.value = o.rate ?? 1;
    s.start(this.t0, o.offset ?? Math.random() * buffer.duration);
    this.srcs.push(s);
    if (o.pitch) this.det.push([s.detune, 0]);
    return this.T(s);
  }
  noise(color = 'w', rate = 1) { return this.buf(this.A.noise[color], { rate }); }
  cs(v = 0) { const s = this.c.createConstantSource(); s.offset.value = v; s.start(this.t0); this.srcs.push(s); return this.T(s); }
  lfo(rate, depth, param, type = 'sine') {
    const o = this.osc(type, rate, { pitch: false }), g = this.gain(depth);
    o.connect(g); g.connect(param);
    return { osc: o, gain: g };
  }
  // smooth random modulation (~rate points per second) of +-depth added to param
  rlfo(rate, depth, param) {
    const s = this.buf(this.A.rlfoBuf, { rate: rate / 2 }), g = this.gain(depth);
    s.connect(g); g.connect(param);
    return { src: s, gain: g };
  }
  shaper(k = 2) {
    const ws = this.c.createWaveShaper(), n = 1024, cv = new Float32Array(n), s = 1 / Math.tanh(k);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; cv[i] = Math.tanh(k * x) * s; }
    ws.curve = cv;
    ws.oversample = '2x';
    return this.T(ws);
  }
  panS(p) { const s = this.c.createStereoPanner(); s.pan.value = p; return this.T(s); }
  delay(max, t) { const d = this.c.createDelay(max); d.delayTime.value = t; return this.T(d); }
  chain(...n) { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; }
  set(param, v, tc = 0.1) { param.setTargetAtTime(v, this.c.currentTime, tc); }
  // schedule a cached one-shot buffer (or an AudioBuffer) inside this loop
  ev(what, t, o = {}) {
    const c = this.c;
    const buf = typeof what === 'string' ? this.A.buffer(what, o.i ?? 1) : what;
    if (!buf) return null;
    const s = c.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = (o.rate ?? 1) * this.pitch;
    const g = c.createGain();
    g.gain.value = o.g ?? 1;
    s.connect(g);
    let n = g;
    const nodes = [s, g];
    if (o.lp && o.lp < 18000) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; n.connect(f); n = f; nodes.push(f); }
    if (o.pan) { const p = c.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1); n.connect(p); n = p; nodes.push(p); }
    n.connect(o.dest || this.out);
    s.start(Math.max(t, c.currentTime + 0.005));
    const rec = { s, nodes };
    this.evs.add(rec);
    s.onended = () => { this.evs.delete(rec); for (const x of nodes) x.disconnect(); };
    return rec;
  }
  // scheduled synth tone (for radio tones etc.)
  tone(type, f, t, dur, amp, dest, att = 0.01) {
    const c = this.c, s = c.createOscillator(), g = c.createGain();
    s.type = type; s.frequency.value = f;
    t = Math.max(t, c.currentTime + 0.005);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + att);
    g.gain.setValueAtTime(amp, t + Math.max(att, dur - att));
    g.gain.linearRampToValueAtTime(0, t + dur);
    s.connect(g); g.connect(dest || this.out);
    s.start(t); s.stop(t + dur + 0.02);
    const rec = { s, nodes: [s, g] };
    this.evs.add(rec);
    s.onended = () => { this.evs.delete(rec); s.disconnect(); g.disconnect(); };
    return rec;
  }
  setPitch(p) {
    this.pitch = p;
    const cents = 1200 * Math.log2(Math.max(0.01, p)), now = this.c.currentTime;
    for (const [param, base] of this.det) param.setTargetAtTime(base + cents, now, 0.05);
  }
  sub(out) { const k = new LoopKit(this.A, this.c, out, this.p); return k; }
  dispose() {
    for (const s of this.srcs) { try { s.stop(); } catch (e) { /* not started */ } }
    for (const r of this.evs) { try { r.s.stop(); } catch (e) { /* */ } for (const x of r.nodes) x.disconnect(); }
    this.evs.clear();
    for (const n of this.nodes) { try { n.disconnect(); } catch (e) { /* */ } }
    this.nodes.length = 0; this.srcs.length = 0; this.det.length = 0;
  }
}

// pre-rendered seamless loop material (cached per engine)
function mat(A, key, sec, sr, fn) {
  return A.sample(key, () => {
    const S = new Synth(sr, 777 + key.length);
    const x = fn(S, sec + 0.1);
    S.norm(x, 0.8);
    return A.makeBuffer([S.loopify(x, 0.1)], sr);
  });
}
// wrap-rendered cycle material: fn(S, out) uses S.addWrap so the result loops perfectly
function cycle(A, key, sec, sr, fn) {
  return A.sample(key, () => {
    const S = new Synth(sr, 99 + key.length), o = new Float32Array(Math.round(sec * sr));
    fn(S, o);
    S.norm(o, 0.8);
    return A.makeBuffer([o], sr);
  });
}
const H120 = (() => { const h = [0]; for (let k = 1; k <= 40; k++) h[k] = k === 1 ? 1 : k === 2 ? 0.55 : k === 3 ? 0.42 : k % 2 ? 0.5 / k ** 0.8 : 0.35 / k ** 0.9; return h; })();

// =================================================================== hum
LOOPS.hum = {
  bus: 'ambient', level: -21, params: { flicker: 0, power: 1 },
  build(L, p) {
    const f = 120 * (1 + (Math.random() * 2 - 1) * 0.0025);
    const main = L.gain(1), pg = L.gain(Math.max(0, p.power) ** 1.5), fg = L.gain(1);
    L.chain(L.osc(L.wave(H120), f), L.filter('lowpass', 2400, 0.5), L.gain(0.5), main);
    const bzG = L.gain(0.12);
    L.chain(L.osc('sawtooth', f, { det: 3 }), L.filter('bandpass', 2800, 0.8), L.shaper(2), bzG, main);
    L.rlfo(0.5, 0.05, bzG.gain);
    L.chain(L.noise('p'), L.filter('highpass', 5000), L.gain(0.05), main);
    L.chain(main, pg, fg, L.out);
    let next = 0;
    return {
      set(k, v) {
        if (k === 'power') { L.set(pg.gain, Math.max(0, v) ** 1.5, 0.05); L.set(bzG.gain, 0.12 + 0.25 * v * (1 - v), 0.1); }
      },
      tick(now, until) {
        const fl = clamp(p.flicker, 0, 1);
        if (fl <= 0.001) { next = 0; return; }
        if (!next || next < now) next = now + expRand(lerp(4, 0.4, fl)) * 0.5;
        while (next < until) {
          let t = next;
          const n = 2 + Math.floor(Math.random() * (2 + 6 * fl));
          for (let k = 0; k < n; k++) {
            fg.gain.setTargetAtTime(k % 2 ? rnd(0.8, 1.1) : rnd(0.02, 0.35), t, 0.004);
            if (Math.random() < 0.35 * fl) L.ev('_arc_pop', t, { g: rnd(0.3, 0.8) * fl + 0.2, rate: rnd(0.8, 1.2) });
            t += rnd(0.02, 0.09);
          }
          fg.gain.setTargetAtTime(1, t, 0.006);
          next = t + expRand(lerp(5, 0.35, fl));
        }
      },
    };
  },
};

// =================================================================== ambience (backrooms)
const AMB_EV = [
  ['_amb_creak', 3, 1.8, 1], ['_amb_knock', 2, 1.6, 1], ['_amb_thud', 1.4, 1.6, 1], ['_amb_groan', 0.7, 1.5, 1],
  ['_amb_door', 0.9, 1.4, 1], ['_amb_vent', 1.5, 1.3, 1], ['_amb_buzz', 1, 1.1, 1],
  ['fake_footsteps', 0.6, 1.0, 3], ['whisper', 0.4, 0.7, 5], ['_amb_scream', 0.25, 0.8, 6],
];
LOOPS.ambience_backrooms = {
  bus: 'ambient', level: -8, params: { tension: 0, day: 1 },
  build(L, p) {
    const out = L.gain(1);
    out.connect(L.out);
    const rtF = L.filter('lowpass', 160, 0.5), rtG = L.gain(0.45);
    L.chain(L.noise('b'), rtF, rtG, out);
    L.rlfo(0.06, 0.15, rtG.gain);
    const airB = L.filter('bandpass', 420, 0.5), airL = L.filter('lowpass', 2200), airG = L.gain(0.22);
    L.chain(L.noise('p'), airB, airL, airG, out);
    L.rlfo(0.08, 0.08, airG.gain);
    L.rlfo(0.03, 120, airB.frequency);
    L.chain(L.osc(L.wave([0, 1, 0.5, 0.25, 0.12]), 59.6), L.filter('lowpass', 300), L.gain(0.05), out);
    L.chain(L.osc('sawtooth', 120.2), L.filter('bandpass', 1300, 2), L.filter('lowpass', 2000), L.gain(0.006), out);
    const tG = L.gain(0), t3f = L.filter('lowpass', 140, 1);
    L.osc('sine', 41.2).connect(tG);
    L.osc('sine', 43.65).connect(tG);
    L.chain(L.osc('sawtooth', 55), t3f, L.gain(0.5), tG);
    tG.connect(out);
    const dG = L.gain(0);
    for (const [ty, f] of [['sine', 92.5], ['triangle', 69.7], ['sine', 155.6], ['sine', 233.1]]) {
      const o = L.osc(ty, f);
      L.rlfo(0.05, 18, o.detune);
      o.connect(dG);
    }
    L.chain(dG, L.filter('lowpass', 600), out);
    const apply = (now, tc = 1.5) => {
      const T = clamp(p.tension, 0, 1), D = clamp((p.day - 1) / 6, 0, 1);
      tG.gain.setTargetAtTime(0.25 * T ** 1.3, now, tc);
      rtF.frequency.setTargetAtTime(160 - 70 * T, now, tc);
      airL.frequency.setTargetAtTime(2200 - 1300 * T, now, tc);
      dG.gain.setTargetAtTime(0.05 * D ** 1.2, now, tc);
    };
    apply(L.now(), 0.01);
    let next = 0, last = '';
    return {
      set(k, v, now) { apply(now); },
      tick(now, until) {
        if (!next) next = now + rnd(2, 6);
        while (next < until) {
          const day = p.day || 1, pool = AMB_EV.filter((e) => day >= e[3] && e[0] !== last);
          let tw = 0;
          for (const e of pool) tw += e[1];
          let r = Math.random() * tw, e = pool[0];
          for (const x of pool) { r -= x[1]; if (r <= 0) { e = x; break; } }
          last = e[0];
          L.ev(e[0], next, { g: e[2] * rnd(0.45, 1), rate: rnd(0.85, 1.15), pan: rnd(-0.9, 0.9), lp: Math.random() < 0.5 ? rnd(900, 4000) : 0 });
          const mean = lerp(11, 4, clamp(p.tension, 0, 1)) / (1 + 0.1 * (day - 1));
          next += Math.max(1.5, expRand(mean));
        }
      },
    };
  },
};

// =================================================================== ambience (lobby)
LOOPS.ambience_lobby = {
  bus: 'ambient', level: -5, params: {},
  build(L) {
    const out = L.gain(1);
    out.connect(L.out);
    const hG = L.gain(0.22);
    L.chain(L.noise('p'), L.filter('bandpass', 380, 0.5), L.filter('lowpass', 1800), hG, out);
    L.rlfo(0.05, 0.05, hG.gain);
    L.chain(L.noise('b'), L.filter('lowpass', 110), L.gain(0.4), out);
    L.chain(L.osc(L.wave(H120), 120.1), L.filter('lowpass', 1500), L.gain(0.02), out);
    let next = 0, last = '';
    const EV = [['_printer', 1], ['phone', 0.7], ['typing', 1], ['water_glug', 0.6], ['door_creak', 0.5], ['_uncanny', 0.5], ['_amb_vent', 0.6], ['elevator_ding', 0.35]];
    return {
      tick(now, until) {
        if (!next) next = now + rnd(3, 8);
        while (next < until) {
          const pool = EV.filter((e) => e[0] !== last);
          let tw = 0;
          for (const e of pool) tw += e[1];
          let r = Math.random() * tw, e = pool[0];
          for (const x of pool) { r -= x[1]; if (r <= 0) { e = x; break; } }
          last = e[0];
          const pan = rnd(-0.8, 0.8), t = next;
          if (e[0] === 'typing') {
            let tt = t;
            for (let k = 0, n = 6 + Math.floor(Math.random() * 16); k < n; k++) { L.ev('ui_type', tt, { g: rnd(0.15, 0.3), lp: 1800, pan, rate: rnd(0.9, 1.1) }); tt += rnd(0.07, 0.22); }
          } else if (e[0] === 'phone') L.ev('phone_ring', t, { g: 0.3, lp: 700, pan });
          else if (e[0] === 'water_glug') L.ev('water_glug', t, { g: 0.45, lp: 1500, pan });
          else if (e[0] === 'door_creak') L.ev('door_creak', t, { g: 0.35, lp: 1200, pan });
          else if (e[0] === 'elevator_ding') L.ev('elevator_ding', t, { g: 0.3, lp: 2000, pan });
          else L.ev(e[0], t, { g: rnd(0.8, 1.3), pan });
          next += Math.max(2, expRand(9));
        }
      },
    };
  },
};

// =================================================================== generator_run
function genDiesel(A) {
  return cycle(A, 'gen_diesel', 1.92, 32000, (S, o) => {
    for (let k = 0; k < 48; k++) {
      const t = k / 25 + S.rr(-0.0015, 0.0015), a = S.rr(0.75, 1), x = S.buf(0.09);
      S.tone(x, 0, { f: 72, f1: 42, gt: 0.012, att: 0.001, tau: 0.018, a });
      S.nz(x, 0, { tau: 0.008, lp: 1200, a: 0.6 * a });
      S.nz(x, 0.016, { tau: 0.002, bp: 3500, q: 1.5, a: 0.12 });
      S.nz(x, 0.005, { tau: 0.004, bp: 650, q: 2, a: 0.2 });
      S.addWrap(o, x, t);
    }
  });
}
function genMech(A) {
  return cycle(A, 'gen_mech', 2.88, 32000, (S, o) => {
    for (let k = 0; k < 8; k++) {
      const t0 = k * 0.36, x = S.buf(1.2);
      impact(S, x, 0, 'metal', 0.6, 1.5, 1);
      impact(S, x, 0.09, 'metal', 0.4, 0.6, 0.35);
      impact(S, x, 0.22, 'metal', 0.4, 0.7, 0.3);
      thud(S, x, 0.18, 90, 60, 0.03, 0.5);
      S.scatter(5, 0.02, 0.3, (t) => modalHit(S, x, t, [[S.rr(2000, 4500), 0.02, 1]], 0.0004, 9000, S.rr(0.05, 0.15)));
      S.addWrap(o, x, t0);
    }
  });
}
function genGroup(L, type, p) {
  const g = L.gain(0), out = L.gain(1);
  out.connect(g);
  const load = clamp(p.load, 0, 1), ctl = {};
  if (type === 0) {
    const src = L.buf(genDiesel(L.A), { pitch: true, rate: 1 + 0.25 * load });
    L.rlfo(0.7, 0.012, src.playbackRate);
    const lp = L.filter('lowpass', 600 + 2400 * load, 0.7), body = L.gain(0.9 + 0.4 * load);
    L.chain(src, lp, body, out);
    L.chain(L.noise('b'), L.filter('lowpass', 120), L.gain(0.5), out);
    const clG = L.gain(0.02);
    L.chain(L.noise('w'), L.filter('bandpass', 3000, 1), clG, out);
    const am = L.lfo(50 * (1 + 0.25 * load), 0.02, clG.gain, 'square');
    ctl.set = (ld, now) => {
      src.playbackRate.setTargetAtTime(1 + 0.25 * ld, now, 0.4);
      lp.frequency.setTargetAtTime(600 + 2400 * ld, now, 0.3);
      body.gain.setTargetAtTime(0.9 + 0.4 * ld, now, 0.3);
      am.osc.frequency.setTargetAtTime(50 * (1 + 0.25 * ld), now, 0.4);
    };
  } else if (type === 1) {
    L.chain(L.osc(L.wave([0, 1, 0.6, 0.3, 0.4, 0.15, 0.2, 0.08, 0.1]), 60), L.filter('lowpass', 800), L.gain(0.5), out);
    const wh = L.osc('sine', 1150 * (1 + 0.12 * load)), whG = L.gain(0.03 + 0.04 * load);
    L.rlfo(0.4, 8, wh.detune);
    L.chain(wh, whG, out);
    L.chain(L.noise('p'), L.filter('bandpass', 900, 0.6), L.gain(0.35), out);
    L.chain(L.osc('square', 400), L.filter('bandpass', 2500, 2), L.gain(0.02), out);
    ctl.set = (ld, now) => { wh.frequency.setTargetAtTime(1150 * (1 + 0.12 * ld), now, 0.5); whG.gain.setTargetAtTime(0.03 + 0.04 * ld, now, 0.3); };
  } else {
    const src = L.buf(genMech(L.A), { pitch: true, rate: 1 + 0.3 * load });
    L.chain(src, L.gain(1), out);
    const bw = L.osc('sine', 700 * (1 + 0.3 * load));
    L.rlfo(0.3, 15, bw.detune);
    L.chain(bw, L.gain(0.02), out);
    const gr = L.gain(0.12);
    L.chain(L.noise('w'), L.filter('bandpass', 1800, 2), gr, out);
    L.rlfo(2, 0.05, gr.gain);
    ctl.set = (ld, now) => { src.playbackRate.setTargetAtTime(1 + 0.3 * ld, now, 0.4); bw.frequency.setTargetAtTime(700 * (1 + 0.3 * ld), now, 0.4); };
  }
  return { g, ctl };
}
LOOPS.generator_run = {
  bus: 'sfx', level: -2.5, params: { type: 0, load: 0.3 },
  build(L, p) {
    const mk = (type) => {
      const k = L.sub(L.out);
      const grp = genGroup(k, type, p);
      grp.g.connect(L.out);
      grp.g.gain.setTargetAtTime(1, L.now(), 0.15);
      return { k, ...grp, type };
    };
    let cur = mk(Math.round(clamp(p.type, 0, 2)));
    const all = new Set([cur]);
    return {
      set(key, v, now) {
        if (key === 'load') cur.ctl.set(clamp(v, 0, 1), now);
        if (key === 'type') {
          const ty = Math.round(clamp(v, 0, 2));
          if (ty === cur.type) return;
          const old = cur;
          old.g.gain.setTargetAtTime(0, now, 0.2);
          setTimeout(() => { old.k.dispose(); all.delete(old); }, 1500);
          cur = mk(ty);
          all.add(cur);
        }
      },
      stop() { /* disposal handled by engine via dispose() */ },
      dispose() { for (const g of all) g.k.dispose(); },
    };
  },
};

// =================================================================== weld / aquarium / water / machines
LOOPS.weld = {
  bus: 'sfx', level: -2.5, params: {},
  build(L) {
    const b = mat(L.A, 'weld', 4, 44100, (S, d) => arc(S, d, 1.3));
    const s = L.buf(b, { pitch: true });
    L.rlfo(1.5, 0.04, s.playbackRate);
    const g = L.gain(0.9), hs = L.filter('highshelf', 3000, 0.7, 0);
    L.rlfo(2, 4, hs.gain);
    L.chain(s, hs, g, L.out);
    L.rlfo(6, 0.25, g.gain);
    const bz = L.gain(0.06);
    L.chain(L.osc('sawtooth', 100), L.filter('bandpass', 1500, 1), bz, L.out);
    L.rlfo(8, 0.05, bz.gain);
  },
};

LOOPS.aquarium = {
  bus: 'ambient', level: -11, params: {},
  build(L) {
    const b = mat(L.A, 'aquarium', 5, 32000, (S, d) => {
      const x = S.buf(d);
      S.scatter(Math.round(d * 35), 0, d - 0.1, (t) => S.bubble(x, t, S.rr(400, 1800), S.rr(0.05, 0.3), { rise: S.rr(0.2, 0.8) }));
      const n = S.noise(d);
      S.bp(n, 2200, 0.8);
      S.mul(n, rsteps(S, d, 0.03, 0.2, 1, 50));
      S.norm(n, 0.15);
      S.add(x, n);
      return x;
    });
    L.chain(L.buf(b), L.filter('lowpass', 7000), L.gain(0.9), L.out);
    L.chain(L.osc('sine', 100), L.gain(0.04), L.out);
    L.chain(L.osc('sine', 50.3), L.gain(0.05), L.out);
    const wG = L.gain(0.15);
    L.chain(L.noise('p'), L.filter('bandpass', 700, 0.8), wG, L.out);
    L.rlfo(0.5, 0.06, wG.gain);
  },
};

LOOPS.vending_hum = {
  bus: 'ambient', level: -19, params: {},
  build(L) {
    const main = L.gain(1);
    main.connect(L.out);
    L.rlfo(0.1, 0.12, main.gain);
    L.chain(L.osc(L.wave([0, 0.3, 1, 0.2, 0.5, 0.1, 0.3, 0.05, 0.12]), 60), L.filter('lowpass', 500), L.gain(0.5), main);
    const rG = L.gain(0.15);
    L.chain(L.noise('p'), L.filter('bandpass', 180, 3), rG, main);
    L.lfo(30, 0.1, rG.gain, 'square');
    L.chain(L.noise('p'), L.filter('bandpass', 800, 0.7), L.gain(0.15), main);
    L.chain(L.osc('sawtooth', 120), L.filter('bandpass', 2400, 3), L.gain(0.02), main);
  },
};

LOOPS.crt_whine = {
  bus: 'ambient', level: -22, params: {},
  build(L) {
    const wG = L.gain(0.04);
    L.chain(L.osc('sine', 15734), wG, L.out);
    L.lfo(60, 0.015, wG.gain);
    L.chain(L.osc(L.wave([0, 1, 0.5, 0.35, 0.2, 0.1]), 60), L.filter('lowpass', 400), L.gain(0.5), L.out);
    const sG = L.gain(0.04);
    L.chain(L.noise('w'), L.filter('highpass', 4000), sG, L.out);
    L.rlfo(3, 0.02, sG.gain);
  },
};

LOOPS.fan = {
  bus: 'ambient', level: -8.5, params: {},
  build(L) {
    const lp = L.filter('lowpass', 1600, 0.6), aG = L.gain(0.6);
    L.chain(L.noise('p'), lp, aG, L.out);
    L.lfo(54, 0.15, aG.gain);
    L.rlfo(0.4, 300, lp.frequency);
    L.chain(L.osc('sine', 108), L.gain(0.04), L.out);
    L.chain(L.osc('square', 54), L.filter('bandpass', 2200, 4), L.gain(0.01), L.out);
  },
};

LOOPS.water_flow = {
  bus: 'ambient', level: -13, params: {},
  build(L) {
    const b = mat(L.A, 'flow', 5, 44100, (S, d) => {
      const x = S.buf(d);
      S.scatter(Math.round(d * 260), 0, d - 0.05, (t) => S.bubble(x, t, S.rr(600, 4000), S.rr(0.03, 0.15), { rise: S.rr(0.1, 0.6) }));
      const n = S.noise(d);
      S.bp(n, 1500, 0.6);
      S.mul(n, rsteps(S, d, 0.004, 0.3, 1, 400));
      S.norm(n, 0.3);
      S.add(x, n);
      return x;
    });
    L.chain(L.buf(b), L.filter('lowpass', 6000), L.gain(0.8), L.out);
    const dG = L.gain(0.35);
    L.chain(L.noise('b'), L.filter('lowpass', 300), dG, L.out);
    L.rlfo(0.3, 0.1, dG.gain);
  },
};

LOOPS.drips = {
  bus: 'ambient', level: 4, params: {},
  build(L) {
    L.chain(L.noise('p'), L.filter('bandpass', 2500, 0.8), L.gain(0.015), L.out);
    let next = 0, src = null;
    return {
      tick(now, until) {
        if (!next) next = now + rnd(0.1, 0.6);
        while (next < until) {
          if (!src || Math.random() < 0.6) src = { rate: rnd(0.7, 1.5), pan: rnd(-0.8, 0.8), g: rnd(0.25, 1) };
          L.ev('drip', next, { rate: src.rate * rnd(0.97, 1.03), pan: src.pan, g: src.g * rnd(0.8, 1), lp: Math.random() < 0.3 ? rnd(1500, 4000) : 0 });
          next += Math.random() < 0.25 ? rnd(0.3, 0.9) : expRand(0.6) + 0.05;
        }
      },
    };
  },
};

// =================================================================== radio static
LOOPS.radio_static = {
  bus: 'sfx', level: -19, params: { signal: 0 },
  build(L, p) {
    const band = L.gain(1);
    L.chain(band, L.filter('highpass', 320), L.filter('lowpass', 3200), L.filter('peaking', 1800, 1, 4), L.shaper(1.8), L.gain(0.8), L.out);
    const sG = L.gain(0.5), cG = L.gain(0.4), tG = L.gain(0), wG = L.gain(0);
    L.chain(L.noise('w'), L.filter('bandpass', 1700, 0.45), sG, band);
    L.rlfo(6, 0.12, sG.gain);
    const cb = mat(L.A, 'radio_crackle', 4, 32000, (S, d) => S.crackle(d, 50, { w: 0.0004 }));
    L.chain(L.buf(cb), cG, band);
    tG.connect(band);
    const wh = L.osc('sine', 1500);
    L.rlfo(0.4, 400, wh.detune);
    L.chain(wh, wG, band);
    const apply = (now) => {
      const s = clamp(p.signal, 0, 1);
      sG.gain.setTargetAtTime(0.5 * (1 - 0.85 * s), now, 0.1);
      cG.gain.setTargetAtTime(0.4 * (1 - 0.7 * s), now, 0.1);
      tG.gain.setTargetAtTime(0.5 * s ** 1.5, now, 0.1);
      wG.gain.setTargetAtTime(0.25 * 4 * s * (1 - s), now, 0.1);
    };
    apply(L.now());
    let next = 0;
    const NOTES = [523, 587, 659, 784, 880, 1047];
    return {
      set(k, v, now) { apply(now); },
      tick(now, until) {
        if (!next) next = now + 0.1;
        while (next < until) {
          if (Math.random() < 0.15) { next += rnd(0.3, 0.8); continue; }
          const d = pick([0.08, 0.12, 0.25, 0.4]), f = pick(NOTES);
          L.tone(Math.random() < 0.5 ? 'sine' : 'triangle', f, next, d, 0.6, tG);
          if (Math.random() < 0.3) L.tone('sine', f * 1.5, next, d, 0.3, tG);
          next += d + rnd(0.04, 0.2);
        }
      },
    };
  },
};

// =================================================================== body loops
LOOPS.heartbeat = {
  bus: 'sfx', level: 0, params: { rate: 80, strength: 1 },
  build(L, p) {
    let next = 0;
    return {
      tick(now, until) {
        if (!next || next < now) next = now + 0.05;
        while (next < until) {
          const per = 60 / clamp(p.rate, 30, 220), s = clamp(p.strength, 0, 1);
          const g = 0.25 + 0.75 * s, lp = 250 + 1800 * s;
          L.ev('_lub', next, { g, lp });
          L.ev('_dub', next + Math.min(0.3, 0.36 * per), { g: g * 0.8, lp });
          next += per;
        }
      },
    };
  },
};

LOOPS.breathing = {
  bus: 'sfx', level: 5, params: { rate: 16, panic: 0 },
  build(L, p) {
    let next = 0;
    return {
      tick(now, until) {
        if (!next || next < now) next = now + 0.05;
        while (next < until) {
          const per = 60 / clamp(p.rate, 6, 70), pn = clamp(p.panic, 0, 1), tier = pn > 0.5 ? 1 : 0;
          const g = 0.35 + 0.65 * pn, ib = tier ? 0.42 : 0.8, eb = tier ? 0.5 : 0.95;
          const rIn = clamp(ib / (0.42 * per), 0.85, 1.7), rEx = clamp(eb / (0.5 * per), 0.85, 1.7);
          L.ev('_inhale', next, { i: tier, g: g * 0.8, rate: rIn * rnd(0.97, 1.03) });
          L.ev('_exhale', next + 0.45 * per, { i: tier, g, rate: rEx * rnd(0.97, 1.03) });
          next += per * rnd(0.94, 1.06);
        }
      },
    };
  },
};

// =================================================================== environment
LOOPS.wind_fall = {
  bus: 'sfx', level: -2, params: {},
  build(L) {
    const m = L.gain(0.8);
    m.connect(L.out);
    L.rlfo(0.5, 0.25, m.gain);
    const b1 = L.filter('bandpass', 900, 0.7);
    L.rlfo(0.3, 500, b1.frequency);
    L.chain(L.noise('p'), b1, L.gain(1.2), m);
    const b2 = L.filter('bandpass', 2200, 8);
    L.rlfo(0.2, 600, b2.frequency);
    L.chain(L.noise('w'), b2, L.gain(0.4), m);
    L.chain(L.noise('b'), L.filter('lowpass', 200), L.gain(0.7), m);
  },
};

LOOPS.collapse = {
  bus: 'sfx', level: -5, params: { intensity: 0.5 },
  build(L, p) {
    const rF = L.filter('lowpass', 120, 0.7), rG = L.gain(0.5), dG = L.gain(0);
    L.chain(L.noise('b'), rF, rG, L.out);
    L.rlfo(0.3, 0.15, rG.gain);
    const df = L.filter('lowpass', 130, 1);
    L.osc('sawtooth', 36.7).connect(df);
    L.osc('sawtooth', 38.9).connect(df);
    L.chain(df, L.shaper(3), dG, L.out);
    const apply = (now) => {
      const I = clamp(p.intensity, 0, 1);
      rF.frequency.setTargetAtTime(80 + 150 * I, now, 0.4);
      rG.gain.setTargetAtTime(0.4 + 0.6 * I, now, 0.4);
      dG.gain.setTargetAtTime(0.3 * I, now, 0.4);
    };
    apply(L.now());
    let next = 0;
    return {
      set(k, v, now) { apply(now); },
      tick(now, until) {
        const I = clamp(p.intensity, 0, 1);
        if (!next) next = now + rnd(0.2, 1.5);
        while (next < until) {
          const e = pick(['_tear', '_boom', '_crack', '_amb_groan', '_crack']);
          L.ev(e, next, { g: (0.4 + 0.6 * I) * rnd(0.5, 1), rate: rnd(0.8, 1.15), pan: rnd(-0.8, 0.8) });
          next += Math.max(0.3, expRand(lerp(6, 0.9, I)));
        }
      },
    };
  },
};

LOOPS.bacteria_presence = {
  bus: 'sfx', level: 3, params: {},
  build(L) {
    const bG = L.gain(0.35);
    L.chain(L.noise('b'), L.filter('lowpass', 110), bG, L.out);
    L.rlfo(0.3, 0.12, bG.gain);
    const wG = L.gain(0.04);
    L.chain(L.noise('p'), L.filter('bandpass', 400, 3), wG, L.out);
    L.rlfo(3, 0.04, wG.gain);
    const nx = { b: 0, c: 0, s: 0, g: 0 };
    return {
      tick(now, until) {
        if (!nx.b) { nx.b = now + rnd(0.1, 1); nx.c = now + rnd(2, 5); nx.s = now + rnd(1, 3); nx.g = now + rnd(6, 14); }
        while (nx.b < until) { L.ev('bacteria_breath', nx.b, { g: rnd(0.6, 0.9), rate: rnd(0.9, 1.1) }); nx.b += rnd(2.0, 2.9); }
        while (nx.c < until) { L.ev('bacteria_click', nx.c, { g: rnd(0.4, 0.8), rate: rnd(0.9, 1.15) }); nx.c += rnd(3, 8); }
        while (nx.s < until) { L.ev('_squelch', nx.s, { g: rnd(0.4, 0.8), rate: rnd(0.8, 1.2) }); nx.s += rnd(1.5, 4); }
        while (nx.g < until) { L.ev('bacteria_growl', nx.g, { g: rnd(0.5, 0.8), rate: rnd(0.85, 1.05) }); nx.g += rnd(8, 20); }
      },
    };
  },
};

const SPEC_CHORDS = [[38, 45, 53, 60, 64], [34, 46, 50, 57, 64], [31, 43, 50, 58, 62], [33, 45, 52, 59, 60], [36, 43, 52, 55, 62]];
LOOPS.spectator = {
  bus: 'ambient', level: -14, params: {},
  build(L) {
    const lp = L.filter('lowpass', 900, 0.5);
    L.rlfo(0.1, 250, lp.frequency);
    L.chain(lp, L.gain(1), L.out);
    const voices = SPEC_CHORDS[0].map((m) => {
      const g = L.gain(0.12), f = 440 * 2 ** ((m - 69) / 12);
      const a = L.osc('triangle', f, { det: -7 }), b = L.osc('sine', f, { det: 7 });
      a.connect(g); b.connect(g); g.connect(lp);
      L.rlfo(0.15, 0.05, g.gain);
      return [a, b];
    });
    const aG = L.gain(0.12);
    L.chain(L.noise('p'), L.filter('bandpass', 900, 0.7), aG, lp);
    L.rlfo(0.2, 0.06, aG.gain);
    let next = 0, ci = 0;
    return {
      tick(now, until) {
        if (!next) next = now + rnd(10, 16);
        while (next < until) {
          ci = (ci + 1 + Math.floor(Math.random() * (SPEC_CHORDS.length - 1))) % SPEC_CHORDS.length;
          SPEC_CHORDS[ci].forEach((m, k) => { const f = 440 * 2 ** ((m - 69) / 12); for (const o of voices[k]) o.frequency.setTargetAtTime(f, next, 1.2); });
          next += rnd(10, 16);
        }
      },
    };
  },
};

LOOPS.fridge_hum = {
  bus: 'ambient', level: -21, params: {},
  build(L) {
    L.chain(L.osc(L.wave([0, 1, 0.7, 0.3, 0.35, 0.1, 0.15]), 58), L.filter('lowpass', 350), L.gain(0.6), L.out);
    const wG = L.gain(0.008);
    L.chain(L.osc('sine', 1170), wG, L.out);
    L.rlfo(0.2, 0.004, wG.gain);
    const nx = { g: 0, t: 0 };
    return {
      tick(now, until) {
        if (!nx.g) { nx.g = now + rnd(4, 12); nx.t = now + rnd(3, 9); }
        while (nx.g < until) { L.ev('_gurgle', nx.g, { g: rnd(0.4, 0.8) }); nx.g += rnd(8, 20); }
        while (nx.t < until) { L.ev('_tick_small', nx.t, { g: rnd(0.4, 0.9), rate: rnd(0.8, 1.2) }); nx.t += rnd(5, 15); }
      },
    };
  },
};

LOOPS.phone_ring_loop = {
  bus: 'sfx', level: 0, params: {},
  build(L) {
    let next = 0;
    return {
      tick(now, until) {
        if (!next) next = now + 0.05;
        while (next < until) { L.ev('phone_ring', next, { g: 1 }); next += 5; }
      },
    };
  },
};

// =================================================================== factory floor (main menu)
// distant machinery: low rumble, mains hum, moving air, and a pre-rendered bed of far-off clanks
LOOPS.factory_drone = {
  bus: 'ambient', level: -9, params: {},
  build(L) {
    const m = L.gain(1);
    m.connect(L.out);
    L.chain(L.noise('b'), L.filter('lowpass', 110, 0.7), L.gain(1.3), m);
    const hum = L.gain(0.1);
    L.chain(L.osc('sawtooth', 50), L.filter('lowpass', 240, 0.8), hum, m);
    L.rlfo(0.13, 0.04, hum.gain);
    const air = L.gain(0.22);
    L.chain(L.noise('p'), L.filter('bandpass', 650, 0.5), air, m);
    L.rlfo(0.07, 0.1, air.gain);
    const b = mat(L.A, 'factory_clanks', 11, 32000, (S, o) => {
      S.scatter(9, 0.2, 10.4, (t) => impact(S, o, t, S.pick(['metal', 'heavy']), S.rr(0.4, 1), S.rr(1.2, 2.6), S.rr(0.2, 0.7)));
      S.scatter(3, 0.5, 10, (t) => thud(S, o, t, S.rr(70, 110), 40, 0.3, 0.6));
      S.lp(o, 1100); S.verb(o, 2.6, 0.7, 0.5, 1.4);   // far away in a big hall
    });
    L.chain(L.buf(b), L.gain(0.9), m);
  },
};

export { expRand, rnd, pick, sstep };
