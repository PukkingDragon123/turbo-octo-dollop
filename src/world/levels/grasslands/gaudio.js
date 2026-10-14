// Grasslands soundscape (procedural, registered into the shared audio registries at level build):
//  gl_meadow  — wind in the grass, gusts, birdsong that thins out and goes wrong over the days (identical
//               repeating phrases, calls played backwards, a phone trill), crickets at dusk, a low wrongness drone
//  gl_river   — the rushing river (positional, follows the nearest bank)
//  gl_fall    — the waterfall's roar (positional)
//  step_grass / step_gravel — footsteps
import { LOOPS } from '../../../audio/loops.js';
import { ONESHOTS } from '../../../audio/sfx.js';

const rnd = (a, b) => a + (b - a) * Math.random();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// one synthesized chirp inside a loop's graph (cleaned up when it ends)
function chirp(L, t, f0, f1, dur, amp, pan, wave = 'sine', reverse = false) {
  const c = L.c;
  t = Math.max(t, c.currentTime + 0.005);
  const o = c.createOscillator();
  o.type = wave;
  const g = c.createGain();
  const p = c.createStereoPanner();
  p.pan.value = clamp(pan, -1, 1);
  o.frequency.setValueAtTime(reverse ? f1 : f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(40, reverse ? f0 : f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  if (reverse) {
    g.gain.exponentialRampToValueAtTime(amp, t + dur * 0.9);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
  } else {
    g.gain.linearRampToValueAtTime(amp, t + Math.min(0.006, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  o.connect(g); g.connect(p); p.connect(L.out);
  o.start(t); o.stop(t + dur + 0.03);
  const rec = { s: o, nodes: [o, g, p] };
  L.evs.add(rec);
  o.onended = () => { L.evs.delete(rec); for (const n of rec.nodes) n.disconnect(); };
}

// a little bird phrase: a seeded pattern of chirps
function phrase(L, t, seed, pan, amp, wrong) {
  let s = seed;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const kind = Math.floor(r() * 4);
  const n = 3 + Math.floor(r() * 6);
  const base = 2400 + r() * 2600;
  let tt = t;
  for (let k = 0; k < n; k++) {
    const d = kind === 0 ? 0.05 + r() * 0.05 : kind === 1 ? 0.12 + r() * 0.08 : 0.03 + r() * 0.03;
    const f0 = base * (kind === 2 ? 1 + k * 0.05 : 1 + (r() - 0.5) * 0.4), f1 = f0 * (kind === 1 ? 0.55 : 1.35 + r() * 0.4);
    chirp(L, tt, wrong === 'low' ? f0 * 0.45 : f0, wrong === 'low' ? f1 * 0.45 : f1, d, amp * (0.6 + r() * 0.4), pan, 'sine', wrong === 'rev');
    tt += d + (kind === 2 ? 0.02 : 0.05 + r() * 0.12);
  }
  return tt - t;
}

export function registerGrassAudio() {
  if (LOOPS.gl_meadow) return;

  LOOPS.gl_meadow = {
    bus: 'ambient', level: -9, params: { day: 1, wind: 0.5, dusk: 0, sick: 0 },
    build(L, p) {
      const out = L.gain(1);
      out.connect(L.out);
      // wind body + gusts
      const wb = L.filter('bandpass', 520, 0.45), wg = L.gain(0.5);
      L.chain(L.noise('p'), wb, L.filter('lowpass', 1800), wg, out);
      L.rlfo(0.09, 0.32, wg.gain);
      L.rlfo(0.05, 260, wb.frequency);
      // grass rustle shimmer
      const rb = L.filter('bandpass', 4200, 0.6), rg = L.gain(0.05);
      L.chain(L.noise('w'), rb, rg, out);
      L.rlfo(0.4, 0.04, rg.gain);
      // distant low air
      L.chain(L.noise('b'), L.filter('lowpass', 160), L.gain(0.3), out);
      // crickets (dusk)
      const cg = L.gain(0);
      const co = L.osc('sine', 4650);
      const cam = L.gain(0);
      L.lfo(26, 0.5, cam.gain, 'square');
      co.connect(cam); cam.connect(cg); cg.connect(out);
      // wrongness: detuned drone that grows over the week
      const dg = L.gain(0);
      for (const f of [55, 55.7, 82.4, 110.9]) { const o = L.osc('sine', f); L.rlfo(0.04, 9, o.detune); o.connect(dg); }
      L.chain(dg, L.filter('lowpass', 400), out);
      const apply = (now, tc = 2) => {
        const D = clamp((p.day - 1) / 6, 0, 1), W = clamp(p.wind, 0, 2);
        wg.gain.setTargetAtTime(0.35 + 0.45 * W, now, tc);
        rg.gain.setTargetAtTime(0.03 + 0.05 * W, now, tc);
        cg.gain.setTargetAtTime(0.022 * clamp(p.dusk, 0, 1) * (p.sick > 0.5 ? 0.3 : 1), now, tc);
        dg.gain.setTargetAtTime(0.06 * D * D + 0.1 * p.sick, now, tc);
      };
      apply(L.now(), 0.01);
      let next = 0, rep = 0;
      const repeatSeed = Math.floor(Math.random() * 1e6) + 7;
      return {
        set(k, v, now) { apply(now); },
        tick(now, until) {
          if (!next) next = now + rnd(1, 3);
          while (next < until) {
            const day = p.day || 1;
            const life = clamp(1.15 - (day - 1) * 0.2, 0, 1) * (1 - clamp(p.dusk, 0, 1) * 0.6);
            const r = Math.random();
            if (p.sick > 0.5) {
              // day 7: a single bird call, the same one, from everywhere
              if (r < 0.5) phrase(L, next, repeatSeed, rnd(-1, 1), 0.05, 'low');
              next += rnd(3, 7);
              continue;
            }
            if (r < life) {
              let wrong = null;
              if (day >= 4 && Math.random() < 0.25) wrong = 'rev';
              if (day >= 5 && Math.random() < 0.25) wrong = 'low';
              // from day 3 one bird keeps singing the exact same phrase
              const seed = day >= 3 && Math.random() < 0.35 ? repeatSeed : Math.floor(Math.random() * 1e6) + 1;
              if (seed === repeatSeed) rep++;
              const d = phrase(L, next, seed, rnd(-0.95, 0.95), 0.035 + Math.random() * 0.04, wrong);
              next += d + rnd(0.6, 4.5) / Math.max(0.25, life);
            } else {
              next += rnd(3, 9);
            }
          }
        },
      };
    },
  };

  LOOPS.gl_river = {
    bus: 'ambient', level: -6, params: { rush: 1 },
    build(L, p) {
      const out = L.gain(1);
      out.connect(L.out);
      const hiss = L.filter('lowpass', 3800, 0.6), hg = L.gain(0.5);
      L.chain(L.noise('w'), L.filter('highpass', 500), hiss, hg, out);
      L.rlfo(0.7, 0.18, hg.gain);
      const body = L.filter('bandpass', 380, 0.7), bg = L.gain(0.9);
      L.chain(L.noise('p'), body, bg, out);
      L.rlfo(0.35, 120, body.frequency);
      L.rlfo(0.5, 0.3, bg.gain);
      const low = L.gain(0.6);
      L.chain(L.noise('b'), L.filter('lowpass', 220), low, out);
      let next = 0;
      return {
        tick(now, until) {
          if (!next) next = now + 0.1;
          while (next < until) {
            // gurgles
            chirp(L, next, rnd(260, 900), rnd(500, 1500), rnd(0.03, 0.09), 0.04 * p.rush, rnd(-0.6, 0.6));
            next += rnd(0.03, 0.22);
          }
        },
      };
    },
  };

  LOOPS.gl_fall = {
    bus: 'ambient', level: -3, params: {},
    build(L) {
      const out = L.gain(1);
      out.connect(L.out);
      const a = L.gain(1.0);
      L.chain(L.noise('b'), L.filter('lowpass', 600), a, out);
      const b = L.gain(0.5), bb = L.filter('bandpass', 1300, 0.5);
      L.chain(L.noise('p'), bb, b, out);
      L.rlfo(0.3, 0.15, b.gain);
      L.chain(L.noise('w'), L.filter('highpass', 3500), L.gain(0.08), out);
    },
  };

  const STEP_T = [0.25, 0.6, 1];
  ONESHOTS.step_grass = {
    d: 0.42, tiers: STEP_T, vars: 1, live: true, db: -9, jit: 60, max: 6,
    fn(S, o, pr) {
      const i = pr.i;
      // swish of blades + muffled heel into turf
      S.nz(o, 0.0, { att: 0.012, tau: 0.07 + 0.05 * i, bp: S.rr(2600, 4200), q: 0.6, a: 0.55 + 0.3 * i });
      S.nz(o, 0.06, { att: 0.02, tau: 0.09, bp: S.rr(1500, 2500), q: 0.8, a: 0.35 });
      S.tone(o, 0.01, { f: S.rr(70, 95), f1: 55, gt: 0.02, att: 0.003, tau: 0.035, a: 0.35 + 0.35 * i });
      if (S.chance(0.4)) S.nz(o, S.rr(0.05, 0.12), { att: 0.001, tau: 0.008, bp: S.rr(3000, 5000), q: 2, a: 0.25 });
    },
  };
  ONESHOTS.step_gravel = {
    d: 0.4, tiers: STEP_T, vars: 1, live: true, db: -8, jit: 50, max: 6,
    fn(S, o, pr) {
      const i = pr.i;
      const g = S.crackle(0.12 + 0.06 * i, 600 + 1800 * i, { w: 0.0002, hp: 1800 });
      S.norm(g, 1);
      S.mul(g, S.ad(0.12 + 0.06 * i, 0.004, 0.04 + 0.03 * i));
      S.add(o, g, 0.005, 0.55 + 0.3 * i);
      S.nz(o, 0.0, { att: 0.004, tau: 0.05, bp: S.rr(1800, 2600), q: 0.7, a: 0.4 });
      S.tone(o, 0.0, { f: S.rr(100, 130), f1: 70, gt: 0.02, att: 0.002, tau: 0.03, a: 0.4 + 0.3 * i });
    },
  };
}
