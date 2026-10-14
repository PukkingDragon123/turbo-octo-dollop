// Poolrooms ambience, registered into the shared loop table at runtime (no shared file edits):
// humid room tone, slow water lapping against tiles, the deep hum of filter pumps far away,
// echoing drips and plinks, distant splashes, pipe knocks and gurgles — and, on later days,
// things that should not be in an empty pool hall.
import { LOOPS } from '../../../audio/loops.js';

const rnd = (a, b) => a + (b - a) * Math.random();
const expRand = (mean) => -Math.log(1 - Math.random() * 0.999) * mean;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const EVENTS = [
  // [sound, weight, gain, minDay, lowpass]
  ['drip', 9, 0.9, 1, 0],
  ['drip', 5, 0.6, 1, 2600],
  ['bubble', 3, 0.55, 1, 3200],
  ['splash', 1.2, 0.22, 1, 1400],
  ['_gurgle', 1.6, 0.5, 1, 1800],
  ['_amb_knock', 1.0, 0.7, 1, 2200],
  ['_amb_creak', 0.8, 0.6, 2, 2600],
  ['_amb_vent', 0.8, 0.5, 1, 0],
  ['water_splash_big', 0.25, 0.35, 3, 900],
  ['fake_footsteps', 0.5, 0.7, 3, 2400],
  ['stilllife_giggle', 0.25, 0.35, 5, 2000],
  ['whisper', 0.3, 0.45, 5, 0],
];

export function registerPoolAudio() {
  if (LOOPS.ambience_pool) return;
  LOOPS.ambience_pool = {
    bus: 'ambient', level: -8, params: { tension: 0, day: 1 },
    build(L, p) {
      const out = L.gain(1);
      out.connect(L.out);
      // humid room tone
      const airF = L.filter('lowpass', 700, 0.5), airG = L.gain(0.32);
      L.chain(L.noise('p'), airF, airG, out);
      L.rlfo(0.05, 0.08, airG.gain);
      // water lapping against the tiles: band-passed noise with slow swells
      const lapF = L.filter('bandpass', 420, 1.1), lapF2 = L.filter('lowpass', 1400), lapG = L.gain(0.16);
      L.chain(L.noise('b'), lapF, lapF2, lapG, out);
      L.lfo(0.23, 0.07, lapG.gain);
      L.rlfo(0.5, 0.06, lapG.gain);
      L.rlfo(0.18, 140, lapF.frequency);
      const sloshF = L.filter('bandpass', 1500, 2.2), sloshG = L.gain(0.03);
      L.chain(L.noise('w'), sloshF, sloshG, out);
      L.rlfo(0.9, 0.028, sloshG.gain);
      L.rlfo(0.3, 500, sloshF.frequency);
      // filter pumps humming somewhere behind the walls
      L.chain(L.osc(L.wave([0, 1, 0.45, 0.22, 0.12, 0.06]), 49.8), L.filter('lowpass', 260), L.gain(0.055), out);
      const pumpG = L.gain(0.02);
      L.chain(L.osc('sawtooth', 99.7), L.filter('bandpass', 700, 3), pumpG, out);
      L.rlfo(0.07, 0.012, pumpG.gain);
      // dread drone (rises with the days)
      const dG = L.gain(0);
      for (const [ty, f] of [['sine', 73.4], ['triangle', 110.2], ['sine', 146.1], ['sine', 196.3]]) {
        const o = L.osc(ty, f);
        L.rlfo(0.04, 14, o.detune);
        o.connect(dG);
      }
      L.chain(dG, L.filter('lowpass', 700), out);
      const tG = L.gain(0);
      L.osc('sine', 41.2).connect(tG);
      L.osc('sine', 43.6).connect(tG);
      tG.connect(out);
      const apply = (now, tc = 1.5) => {
        const T = clamp(p.tension, 0, 1), D = clamp((p.day - 1) / 6, 0, 1);
        dG.gain.setTargetAtTime(0.045 * D ** 1.3, now, tc);
        tG.gain.setTargetAtTime(0.22 * T ** 1.4, now, tc);
        airF.frequency.setTargetAtTime(700 - 260 * T, now, tc);
      };
      apply(L.now(), 0.01);
      let next = 0, last = '';
      return {
        set(k, v, now) { apply(now); },
        tick(now, until) {
          if (!next) next = now + rnd(0.5, 2.5);
          while (next < until) {
            const day = p.day || 1;
            const pool = EVENTS.filter((e) => day >= e[3] && !(e[0] === last && e[0] !== 'drip'));
            let tw = 0;
            for (const e of pool) tw += e[1];
            let r = Math.random() * tw, e = pool[0];
            for (const x of pool) { r -= x[1]; if (r <= 0) { e = x; break; } }
            last = e[0];
            const far = Math.random() < 0.55;
            L.ev(e[0], next, { g: e[2] * rnd(0.35, 1) * (far ? 0.5 : 1), rate: rnd(0.85, 1.18), pan: rnd(-0.95, 0.95), lp: e[4] || (far ? rnd(900, 3000) : 0) });
            const mean = (e[0] === 'drip' ? 1.6 : 3.2) / (1 + 0.08 * (day - 1)) * (1 - clamp(p.tension, 0, 1) * 0.3);
            next += Math.max(0.25, expRand(mean));
          }
        },
      };
    },
  };
}
