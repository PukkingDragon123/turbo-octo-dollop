// Economy one-shots (procedural): crusher slam, teleport materialise, nail gun, terminal stamp.
// Live recipes like campsfx.js: importing this module registers them; play with audio.play('crusher_slam') etc.
import { defShot, thud, click, modalHit } from '../audio/sfx.js';
import { TAU } from '../audio/dsp.js';

// hydraulic press bottoming out: sub thump, metal crunch, a ringing frame and a hiss of released pressure
defShot('crusher_slam', 2.4, (S, o) => {
  thud(S, o, 0.002, 95, 32, 0.22, 1.2, 0.002);
  thud(S, o, 0.004, 210, 60, 0.07, 0.8);
  modalHit(S, o, 0.003, [[148, 1, 0.9], [233, 0.6, 0.7], [412, 0.45, 0.5], [655, 0.3, 0.35], [1190, 0.18, 0.2]], 0.006, 0.9, 0.7);
  // crunch: dense crackle of crumpling scrap
  const c = S.crackle(0.45, 2600, { w: 0.0006, hp: 700 });
  S.mul(c, S.env(0.45, [[0, 1], [0.12, 0.7], [0.45, 0, 's']]));
  S.norm(c, 1);
  S.add(o, c, 0.005, 0.55);
  S.nz(o, 0.0, { dur: 0.35, env: [[0, 1], [0.05, 0.6], [0.35, 0, 's']], bp: 900, q: 0.7, a: 0.5 });
  // pressure release hiss
  S.nz(o, 0.55, { dur: 1.6, color: 'w', env: [[0, 0], [0.08, 0.8, 's'], [0.6, 0.5], [1.6, 0, 's']], bp: S.env(1.6, [[0, 5200], [1.6, 2600]]), q: 1.4, a: 0.32 });
  click(S, o, 0.5, 2400, 0.3, 0.004);
  S.lp(o, 9000);
}, { live: true, db: 0, jit: 40 });

// purchased item beams in: rising shimmer, a sparkle burst and a soft "thoom"
defShot('teleport_in', 1.3, (S, o) => {
  const d = 0.9;
  const sweep = S.osc(d, S.env(d, [[0, 300], [0.7, 2400, 'e'], [d, 2600]]), 'saw');
  S.lp(sweep, S.env(d, [[0, 800], [0.7, 5000], [d, 3000]]), 3);
  S.mul(sweep, S.env(d, [[0, 0], [0.5, 0.6, 's'], [0.75, 1], [d, 0, 's']]));
  S.norm(sweep, 1);
  S.add(o, sweep, 0, 0.35);
  for (let i = 0; i < 9; i++) S.bell(o, 0.55 + i * 0.035, 1400 + i * 260 + S.rr(-60, 60), [[1, 0.5, 0.2], [2.7, 0.15, 0.1]], 0.12);
  thud(S, o, 0.74, 160, 50, 0.12, 0.8);
  const shim = S.osc(1.2, (t) => 3200 + 400 * Math.sin(TAU * 13 * t), 'sin');
  S.mul(shim, S.env(1.2, [[0, 0], [0.4, 0.3], [0.8, 0.15], [1.2, 0, 's']]));
  S.add(o, shim, 0, 0.12);
}, { live: true, db: -3, jit: 50 });

// pneumatic nailer: sharp chunk + air spit + nail ring
defShot('nailgun', 0.5, (S, o) => {
  click(S, o, 0.001, 3600, 0.9, 0.003);
  thud(S, o, 0.002, 420, 140, 0.03, 0.7);
  S.nz(o, 0.004, { dur: 0.16, env: [[0, 1], [0.03, 0.5], [0.16, 0, 's']], bp: 3000, q: 0.8, a: 0.6 });
  S.bell(o, 0.012, 5200, [[1, 0.3, 0.06], [1.6, 0.2, 0.05]], 0.25);
}, { live: true, db: -2, jit: 80 });

// rubber stamp + bell: reward claimed at the mission terminal
defShot('stamp_claim', 0.9, (S, o) => {
  thud(S, o, 0.002, 180, 70, 0.05, 1);
  click(S, o, 0.002, 1500, 0.5, 0.006);
  S.bell(o, 0.12, 1318, [[1, 0.5, 0.35], [2, 0.2, 0.2], [3, 0.08, 0.12]], 0.6);
  S.bell(o, 0.24, 1760, [[1, 0.5, 0.4], [2, 0.2, 0.25]], 0.55);
}, { live: true, db: -2 });
