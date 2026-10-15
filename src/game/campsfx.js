// Level 0 camp-loop one-shots (procedural, no audio files): stomach growl, tent pop-up, teleport-pad charge.
// Registered as `live` recipes in the shared one-shot table: they render on the main thread when played
// (the render worker and the start-up prewarm only know sfx.js' own recipes, so cached variations would fail
// there). Importing this module is enough; play them with audio.play('stomach_growl') etc.
import { defShot, thud, click } from '../audio/sfx.js';
import { TAU } from '../audio/dsp.js';

// a long, wet, rising-and-falling gurgle: resonant low noise + a wobbling low tone + bubbles
defShot('stomach_growl', 2.2, (S, o) => {
  const d = 2.0;
  const f = S.env(d, [[0, 70], [0.5, 120, 's'], [1.1, 85, 's'], [1.6, 140, 's'], [d, 60]]);
  for (let i = 0; i < f.length; i++) f[i] *= 1 + 0.18 * Math.sin((TAU * 7.5 * i) / S.sr) * Math.sin((TAU * 0.9 * i) / S.sr);
  const tone = S.osc(d, f, 'saw');
  S.lp(tone, S.env(d, [[0, 300], [0.5, 700], [1.2, 380], [1.6, 820], [d, 250]]), 4);
  S.mul(tone, S.env(d, [[0, 0], [0.12, 0.7, 's'], [0.55, 1], [0.9, 0.35], [1.25, 0.9], [1.7, 0.6], [d, 0, 's']]));
  S.norm(tone, 1);
  S.add(o, tone, 0, 0.75);
  S.nz(o, 0, { dur: d, color: 'p', env: [[0, 0], [0.3, 1, 's'], [1.4, 0.8], [d, 0, 's']], bp: S.env(d, [[0, 180], [0.6, 420], [1.4, 260], [d, 160]]), q: 6, a: 0.45 });
  S.scatter(S.ri(10, 16), 0.15, 1.8, (t) => S.bubble(o, t, S.rr(110, 320), S.rr(0.15, 0.45), { rise: S.rr(0.2, 0.6), d: S.rr(25, 45) }), 1.1);
  S.lp(o, 1500);
}, { live: true, db: -2, jit: 60 });

// canvas whoosh + snapping fabric + springy "boing" + a thump as the tent hits the ground
defShot('tent_pop', 1.4, (S, o) => {
  S.nz(o, 0, { dur: 0.5, env: [[0, 0], [0.3, 1, 2], [0.36, 0.2], [0.5, 0]], bp: S.env(0.5, [[0, 500], [0.32, 2600, 'e'], [0.5, 900]]), q: 0.9, a: 0.8 });
  // fabric flaps: short bursts of crackly noise
  for (const t of [0.3, 0.36, 0.43, 0.52]) {
    const c = S.crackle(0.08, 900, { w: 0.0003, hp: 1500 });
    S.norm(c, 1);
    S.add(o, c, t, S.rr(0.25, 0.4));
  }
  thud(S, o, 0.34, 140, 55, 0.09, 1);
  click(S, o, 0.34, 1800, 0.35, 0.004);
  // spring wobble
  const d = 0.7, x = S.osc(d, (t) => 220 + 160 * Math.exp(-t * 6) * Math.sin(TAU * 9 * t), 'tri');
  S.mul(x, S.ad(d, 0.01, 0.18));
  S.add(o, x, 0.36, 0.3);
  // a small rising chime: "done!"
  S.bell(o, 0.62, 880, [[1, 0.5, 0.25], [2, 0.2, 0.15]], 0.5);
  S.bell(o, 0.74, 1318, [[1, 0.5, 0.3], [2, 0.2, 0.18]], 0.5);
}, { live: true, db: -3 });

// rising capacitor whine + mains hum swelling into a crackle, ~2.6 s (the pads charge up before the beam)
defShot('pad_charge', 2.8, (S, o) => {
  const d = 2.6;
  const f = S.env(d, [[0, 120], [d, 1900, 'e']]);
  const w = S.fm(d, f, 2.01, S.env(d, [[0, 0.5], [d, 3]]));
  S.mul(w, S.env(d, [[0, 0], [0.3, 0.4], [2.3, 1, 2], [d, 0.2]]));
  S.add(o, w, 0, 0.35);
  const hum = S.osc(d, 50, 'saw');
  S.lp(hum, 400);
  S.mul(hum, S.env(d, [[0, 0], [0.4, 1], [2.4, 1], [d, 0]]));
  S.norm(hum, 1);
  S.add(o, hum, 0, 0.25);
  const cr = S.crackle(d, S.env(d, [[0, 0], [1.4, 30], [d, 600, 'e']]), { w: 0.0003, hp: 2500 });
  S.norm(cr, 1);
  S.add(o, cr, 0, 0.3);
}, { live: true, db: -4 });
