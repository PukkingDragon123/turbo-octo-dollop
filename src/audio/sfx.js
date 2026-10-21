// R.O.O.M. — one-shot sound recipes (procedural, no audio files).
// Each recipe renders into a Float32Array with the offline DSP toolkit (dsp.js). audio.js renders a few
// variations per sound (and per intensity tier), masters them to consistent loudness, caches them and
// plays them with random pitch/gain jitter so repeats never sound identical.
//
// Recipe fields: d (sec | fn(p)), fn(S, out, p) with p = { i: intensity tier, len },
//   tiers [..intensity values], ig (intensity scales gain only), vars (variations cached), db (level trim),
//   jit (pitch jitter, cents), bus, sr, stereo, live (re-render every play), clean (no soft-clip), max (voices/name)

import { Synth, master, TAU, clamp, lerp, VOWELS } from './dsp.js';

export const ONESHOTS = {};
function def(name, d, fn, o = {}) { ONESHOTS[name] = { d, fn, ...o }; }

// ======================================================================
// shared building blocks
// ======================================================================
function click(S, o, t, f = 3000, a = 0.5, tau = 0.003, q = 1.2) {
  S.nz(o, t, { att: 0.0002, tau, bp: f, q, a, norm: 1 });
}
function thud(S, o, t, f0, f1, tau, a = 1, att = 0.0015) {
  S.tone(o, t, { f: f0, f1, gt: tau * 0.5, att, tau, a });
}
function exc(S, dur, bright) {
  const nb = Math.max(2, Math.round(dur * S.sr)), x = new Float32Array(nb + 48);
  for (let i = 0; i < nb; i++) x[i] = (S.r() * 2 - 1) * Math.sin((Math.PI * i) / nb);
  x[0] += 0.6;
  S.lp(x, bright, 0.6);
  return x;
}
// excite a modal bank with a windowed noise burst; result normalized to peak a
function modalHit(S, o, t, modes, excDur, bright, a = 1) {
  if (a <= 0) return;
  const e = exc(S, excDur, bright);
  let mt = 0;
  for (const m of modes) mt = Math.max(mt, m[1]);
  const room = o.length / S.sr - t;
  if (room <= 0.001) return;
  const y = S.modal(e, modes, Math.min(mt * 6 + excDur, room));
  S.norm(y, 1);
  S.add(o, y, t, a);
}
// smoothed random step function (AM / roughness)
function rsteps(S, sec, step, lo, hi, sm = 150) {
  const n = S.n(sec), a = new Float32Array(n);
  let v = S.rr(lo, hi), c = 0, st = 1;
  for (let i = 0; i < n; i++) {
    if (--c <= 0) { v = S.rr(lo, hi); st = Math.max(1, Math.round(step * S.sr * S.rr(0.5, 1.5))); c = st; }
    a[i] = v;
  }
  return S.lp1(a, sm);
}
const scaleArr = (a, k) => a.map((v) => v * k);

// rubber hazmat crinkle
function crinkle(S, o, t, dur, a) {
  const x = S.crackle(dur, S.env(dur, [[0, 0], [dur * 0.25, 900], [dur, 0]]), { w: 0.00025, ap: 2.5, min: 0.1 });
  S.bp(x, 3200, 0.5);
  S.norm(x, 1);
  const f = S.noise(dur);
  S.bp(f, 900, 2);
  S.mul(f, S.env(dur, [[0, 0], [dur * 0.4, 1], [dur, 0]]));
  S.norm(f, 0.25);
  S.add(x, f);
  S.add(o, x, t, a);
}

// stick-slip friction (creaks, groans, squeals): pulse train at F through a resonant body
function friction(S, o, t, d, F, modes, a = 1, jit = 0.1) {
  const n = S.n(d), x = new Float32Array(n), Fs = S.sig(F, n), fn = typeof Fs === 'number', wan = rsteps(S, d, 0.12, -0.14, 0.14, 6);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    ph += ((fn ? Fs : Fs[i]) * (1 + wan[i]) * (1 + (S.r() - 0.5) * 2 * jit)) / S.sr;
    if (ph >= 1) { ph -= 1; x[i] += S.chance(0.03) ? 0.15 : S.rr(0.6, 1); }
  }
  S.mul(x, rsteps(S, d, 0.06, 0.25, 1, 12));
  const y = S.modal(x, modes, d + 0.08);
  S.norm(y, 1);
  S.mul(y, S.env(d + 0.08, [[0, 0], [0.06, 1], [d - 0.1, 0.85], [d + 0.08, 0]]));
  S.add(o, y, t, a);
}
function creak(S, o, t, d, f0, f1, a = 1, bright = 1) {
  const F = S.env(d, [[0, f0], [d * 0.5, ((f0 + f1) / 2) * S.rr(0.8, 1.25), 's'], [d, f1, 's']]);
  friction(S, o, t, d, F, [[S.rr(280, 360), 0.025, 1], [S.rr(700, 900), 0.018, 0.8], [S.rr(1400, 1800), 0.012, 0.6 * bright], [S.rr(2600, 3200), 0.007, 0.35 * bright]], a, 0.08);
}
// big metal structure groan
function groan(S, o, t, d, f0, a = 1) {
  const F = S.env(d, [[0, f0], [d * 0.4, f0 * S.rr(0.75, 1.35), 's'], [d, f0 * S.rr(0.6, 1.1), 's']]);
  const b = S.rr(160, 260);
  friction(S, o, t, d, F, [[b, 0.35, 1], [b * 1.53, 0.3, 0.8], [b * 2.37, 0.22, 0.7], [b * 3.6, 0.18, 0.5], [b * 5.1, 0.12, 0.35], [b * 7.3, 0.08, 0.2]], a, 0.05);
}

function ratchetClick(S, o, t, a, f = 4000) {
  click(S, o, t, f * S.rr(0.85, 1.15), a, 0.0012, 1);
  modalHit(S, o, t, [[f * S.rr(0.95, 1.05), 0.012, 1], [f * 1.63, 0.008, 0.6], [f * 0.42, 0.015, 0.4]], 0.0004, 12000, a * 0.8);
}
function tink(S, o, t, f, a) {
  const tau = S.rr(0.02, 0.12);
  S.part(o, t, f, a, tau, 0.0002, S.r() * TAU);
  S.part(o, t, f * S.rr(2.2, 2.8), a * 0.5, tau * 0.6, 0.0002, S.r() * TAU);
}
function arc(S, d, density = 1) {
  const x = S.crackle(d, 600 * density, { w: 0.0003, ap: 2.2, min: 0.05 });
  S.hp(x, 1500);
  S.norm(x, 1);
  const s = S.noise(d);
  S.hp(s, 3500);
  S.mul(s, rsteps(S, d, 0.01, 0.2, 1, 120));
  S.norm(s, 0.35);
  S.add(x, s);
  const b = S.osc(d, 100 * S.j(1, 0.02), 'saw');
  S.bp(b, 1200, 0.8);
  S.mul(b, rsteps(S, d, 0.02, 0.3, 1, 60));
  S.norm(b, 0.25);
  S.add(x, b);
  S.scatter(Math.max(1, Math.round(d * 6 * density)), 0, d, (t) => click(S, x, t, S.rr(1000, 4000), S.rr(0.4, 0.9), 0.003, 0.7));
  return x;
}
function radioBand(S, x, drive = 1.8) {
  S.hp(x, 320);
  S.lp(x, 3200);
  S.eq(x, 'peak', 1800, 1, 4);
  S.drive(x, drive);
  return x;
}
function distant(S, o, lp = 1500, rt = 2.2, mix = 0.55) {
  S.lp(o, lp);
  S.verb(o, rt, mix, 0.5, 1.4);
}

// ---------------------------------------------------------------------- impacts (modal materials)
function impact(S, o, t, mat, i, sz = 1, a = 1) {
  const bounce = (modes, ex, br) => {
    if (S.chance(0.25 + 0.5 * i)) modalHit(S, o, t + S.rr(0.012, 0.055), modes, ex * 1.4, br * 0.6, S.rr(0.1, 0.3) * a);
  };
  switch (mat) {
    case 'wood': {
      const f0 = S.rr(190, 340) / sz;
      const modes = [1, 1.93, 2.84, 3.97, 5.11, 6.68].map((r, k) => [f0 * r * S.j(1, 0.04), (0.08 - k * 0.0095) * S.j(1, 0.25) * Math.sqrt(sz), (1 - k * 0.12) * S.j(1, 0.35)]);
      const ex = lerp(0.0045, 0.0012, i), br = lerp(1600, 7000, i);
      modalHit(S, o, t, modes, ex, br, a);
      thud(S, o, t, S.rr(115, 165) / sz, S.rr(75, 100) / sz, 0.03 * sz, 0.5 * a);
      click(S, o, t, S.rr(2500, 4500), (0.1 + 0.3 * i) * a, 0.0025);
      bounce(modes, ex, br);
      break;
    }
    case 'metal': {
      const f0 = S.rr(260, 600) / sz, modes = [];
      [1, 2.756, 5.404, 8.933, 1.47, 3.21, 4.37, 6.62, 10.8].forEach((r, k) => {
        const f = f0 * r * S.j(1, 0.03);
        const tau = (k < 4 ? 0.7 - k * 0.12 : S.rr(0.15, 0.4)) * S.j(1, 0.25) * Math.sqrt(sz) * lerp(0.75, 1, i);
        const am = (k < 4 ? 1 - k * 0.18 : S.rr(0.25, 0.6)) * (r > 4 ? lerp(0.35, 1, i) : 1);
        modes.push([f, tau, am], [f * (1 + S.rr(0.002, 0.006)), tau * 0.9, am * 0.5]);
      });
      const ex = lerp(0.0025, 0.0006, i), br = lerp(2500, 12000, i);
      modalHit(S, o, t, modes, ex, br, a);
      click(S, o, t, S.rr(3500, 6000), (0.12 + 0.3 * i) * a, 0.0015);
      thud(S, o, t, 160 / sz, 100 / sz, 0.02, 0.3 * a);
      bounce(modes, ex, br);
      break;
    }
    case 'plastic': {
      const f0 = S.rr(420, 820) / sz;
      const modes = [1, 1.62, 2.37, 3.31, 4.52].map((r, k) => [f0 * r * S.j(1, 0.04), (0.05 - k * 0.007) * S.j(1, 0.25) * Math.sqrt(sz), (1 - k * 0.15) * S.j(1, 0.3)]);
      modes.push([S.rr(220, 380) / sz, 0.035, 0.8]);
      const ex = lerp(0.0035, 0.001, i), br = lerp(2000, 7000, i);
      modalHit(S, o, t, modes, ex, br, a);
      click(S, o, t, S.rr(3000, 5000), (0.12 + 0.3 * i) * a, 0.002);
      bounce(modes, ex, br);
      break;
    }
    case 'cardboard': {
      const f0 = S.rr(130, 220) / sz;
      modalHit(S, o, t, [[f0, 0.035, 1], [f0 * 1.73, 0.025, 0.6], [f0 * 2.6, 0.018, 0.4], [f0 * 3.9, 0.012, 0.25]], lerp(0.006, 0.0025, i), lerp(900, 3000, i), a);
      thud(S, o, t, 95, 65, 0.035, 0.6 * a);
      S.nz(o, t, { att: 0.002, tau: 0.03, bp: S.rr(450, 650), q: 1.2, a: 0.5 * a });
      const c = S.crackle(0.06, 600, { w: 0.0003 });
      S.bp(c, 2800, 0.7);
      S.norm(c, 1);
      S.mul(c, S.ad(0.06, 0.001, 0.015));
      S.add(o, c, t, (0.1 + 0.3 * i) * a);
      break;
    }
    case 'glass': {
      const f0 = S.rr(1300, 2600) / sz;
      const modes = [1, 2.32, 3.94, 5.82, 8.04].map((r, k) => [f0 * r * S.j(1, 0.02), (0.42 - k * 0.07) * S.j(1, 0.25), [1, 0.6, 0.45, 0.3, 0.2][k] * (k > 1 ? lerp(0.5, 1, i) : 1)]);
      if (i > 0.3) modes.push([S.rr(500, 800) / sz, 0.02, 0.3 * i]);
      const ex = lerp(0.0012, 0.0004, i), br = lerp(5000, 14000, i);
      modalHit(S, o, t, modes, ex, br, a);
      click(S, o, t, 7000, 0.2 * a, 0.0008);
      bounce(modes, ex, br);
      break;
    }
    case 'soft':
      S.nz(o, t, { att: 0.003, tau: lerp(0.03, 0.05, i), lp: lerp(300, 1100, i), a });
      thud(S, o, t, 90, 60, 0.04, 0.6 * a);
      S.nz(o, t, { att: 0.004, tau: 0.05, bp: 1400, q: 0.6, a: 0.12 * a });
      break;
    case 'heavy': {
      thud(S, o, t, lerp(95, 115, i), lerp(55, 42, i), lerp(0.07, 0.13, i), a);
      S.nz(o, t, { att: 0.002, tau: lerp(0.05, 0.1, i), lp: lerp(350, 1500, i), a: 0.8 * a });
      S.nz(o, t, { tau: 0.035, bp: 900, q: 0.8, a: 0.35 * i * a });
      const f0 = S.rr(110, 190);
      modalHit(S, o, t, [[f0, 0.1, 1], [f0 * 2.3, 0.07, 0.8], [f0 * 3.7, 0.05, 0.6], [f0 * 5.2, 0.04, 0.4], [f0 * 7.9, 0.03, 0.25]], lerp(0.005, 0.0018, i), lerp(1200, 4000, i), 0.6 * a);
      S.scatter(Math.round(2 + 6 * i), 0.02, 0.3, (tt) => impact(S, o, t + tt, S.pick(['wood', 'metal', 'plastic']), 0.2, 0.4, S.rr(0.03, 0.1) * a), 1.5);
      break;
    }
    case 'flesh':
      S.nz(o, t, { att: 0.0008, tau: lerp(0.008, 0.014, i), bp: S.rr(1400, 2200), q: 0.7, a: (0.5 + 0.5 * i) * a });
      thud(S, o, t, 100, 55, lerp(0.05, 0.08, i), 0.9 * a);
      S.nz(o, t + 0.004, { att: 0.006, tau: 0.04, dur: 0.2, bp: S.env(0.2, [[0, 1100], [0.06, 380, 'e']]), q: 3, a: (0.2 + 0.25 * i) * a });
      S.scatter(S.ri(1, 3), t + 0.01, t + 0.08, (tt) => S.bubble(o, tt, S.rr(500, 1300), 0.12 * a, { rise: 0.6 }));
      break;
  }
}

// ---------------------------------------------------------------------- footsteps
function step(S, o, surf, i) {
  const toe = S.rr(0.035, 0.06) * (1.2 - 0.4 * i);
  if (surf === 'carpet') {
    for (const [t, a] of [[0.002, 1], [toe, S.rr(0.35, 0.55)]]) {
      thud(S, o, t, S.rr(85, 110), 55, 0.02 + 0.01 * i, a);
      S.nz(o, t, { att: 0.003, tau: 0.02 + 0.01 * i, lp: 400 + 800 * i, a: 0.9 * a });
      S.nz(o, t + 0.003, { att: 0.006, tau: 0.03 + 0.02 * i, bp: S.rr(1800, 3200), q: 0.6, a: (0.08 + 0.25 * i) * a });
      // damp carpet squish
      S.nz(o, t + 0.008, { att: 0.008, tau: 0.03, dur: 0.12, bp: S.env(0.12, [[0, S.rr(900, 1200)], [0.06, S.rr(350, 450), 'e']]), q: 2.5, a: (0.06 + 0.08 * i) * a });
    }
  } else if (surf === 'hard') {
    for (const [t, a] of [[0.002, 1], [toe, S.rr(0.3, 0.5)]]) {
      click(S, o, t, S.rr(2200, 3500), (0.4 + 0.5 * i) * a, 0.0018, 0.9);
      modalHit(S, o, t, [[S.rr(170, 220), 0.03, 1], [S.rr(400, 480), 0.022, 0.8], [S.rr(900, 1100), 0.015, 0.5], [S.rr(1800, 2300), 0.01, 0.35]], lerp(0.003, 0.0012, i), lerp(2500, 8000, i), 0.9 * a);
      S.nz(o, t, { tau: 0.015, lp: 600, a: 0.4 * a });
    }
    if (i > 0.7 && S.chance(0.25)) S.tone(o, toe + 0.01, { f: S.rr(1600, 2400), f1: S.rr(1800, 2800), gt: 0.02, wave: 'saw', att: 0.004, tau: 0.02, lp: 4000, a: 0.08 });
  } else if (surf === 'metal') {
    const f0 = S.rr(280, 380);
    const md = [1, 2.31, 3.72, 5.15, 7.4, 9.9].map((r, k) => [f0 * r * S.j(1, 0.04), (0.22 - k * 0.025) * S.j(1, 0.2), 1 - k * 0.12]);
    for (const [t, a] of [[0.002, 1], [toe, 0.45]]) {
      modalHit(S, o, t, md, lerp(0.003, 0.0012, i), lerp(3000, 9000, i), a);
      thud(S, o, t, 140, 90, 0.03, 0.5 * a);
      click(S, o, t, 3500, 0.3 * a, 0.002);
    }
    S.scatter(S.ri(3, 6), 0.01, 0.09, (t) => modalHit(S, o, t, [[S.rr(1500, 3500), 0.03, 1]], 0.0005, 8000, S.rr(0.05, 0.15)));
  } else if (surf === 'water') {
    for (const [t, a] of [[0.002, 1], [toe + 0.04, 0.5]]) {
      S.nz(o, t, { att: 0.004, tau: 0.05 + 0.03 * i, hp: 500, lp: 5000, a: (0.6 + 0.3 * i) * a });
      thud(S, o, t, 130, 80, 0.03, 0.4 * a);
      S.scatter(S.ri(4, 9), t, t + 0.12, (tt) => S.bubble(o, tt, S.rr(500, 2500), S.rr(0.1, 0.35) * a, { rise: S.rr(0.1, 0.4) }), 1.5);
    }
    S.scatter(S.ri(2, 5), 0.12, 0.35, (tt) => S.bubble(o, tt, S.rr(1500, 4000), S.rr(0.05, 0.15), { rise: 0.3 }));
  } else {
    for (const [t, a] of [[0.002, 1], [toe, 0.5]]) {
      thud(S, o, t, S.rr(100, 130), 65, 0.018, 0.8 * a);
      click(S, o, t, S.rr(1500, 2500), (0.35 + 0.4 * i) * a, 0.002, 0.8);
      const gd = 0.06 + 0.04 * i, g = S.crackle(gd, 900 + 1500 * i, { w: 0.00015, hp: 2500 });
      S.norm(g, 1);
      S.mul(g, S.ad(gd, 0.002, 0.02 + 0.02 * i));
      S.add(o, g, t, (0.15 + 0.3 * i) * a);
      S.nz(o, t + 0.005, { att: 0.005, tau: 0.03, bp: S.rr(1200, 2000), q: 0.8, a: (0.1 + 0.25 * i) * a });
    }
  }
}
const STEP_T = [0.25, 0.6, 1];
for (const [s, d] of [['carpet', 0.3], ['hard', 0.32], ['metal', 0.7], ['water', 0.6], ['concrete', 0.32]]) {
  def('step_' + s, d, (S, o, p) => step(S, o, s, p.i), { tiers: STEP_T, vars: 4, db: -7, jit: 45, max: 6 });
}

// ---------------------------------------------------------------------- formant voice helper
function heartThump(S, o, t, f, a, tau) {
  thud(S, o, t, f * 1.4, f, tau, a, 0.006);
  S.tone(o, t, { f: f * 2.1, f1: f * 1.8, gt: 0.03, att: 0.004, tau: tau * 0.6, a: a * 0.25 });
  S.nz(o, t, { att: 0.004, tau: tau * 0.7, lp: 180, a: a * 0.5 });
}
function breathPart(S, inhale, d, panic) {
  if (inhale) {
    const v = S.vox(d, { f0: 220, voice: panic * 0.25, breath: 1, vow: [[0, 'uh'], [d, panic > 0.5 ? 'a' : 'o']], scale: 1.1, gains: [0.6, 0.8, 0.7, 0.5] });
    S.hp(v, 500);
    S.mul(v, S.env(d, [[0, 0], [d * 0.6, 1, 0.7], [d, 0]]));
    if (panic > 0.5) S.mul(v, rsteps(S, d, 0.04, 0.5, 1, 40));
    return v;
  }
  const v = S.vox(d, { f0: [[0, 150 + 60 * panic], [d, 115 + 40 * panic]], voice: [[0, 0.12 + 0.3 * panic], [d, 0]], breath: 1, vow: [[0, 'a'], [d, 'uh']] });
  S.mul(v, S.env(d, [[0, 0], [0.05, 1], [d, 0, 1.5]]));
  return v;
}

// ======================================================================
// UI / devices
// ======================================================================
def('ui_blip', 0.12, (S, o) => {
  const f = S.j(1180, 0.02);
  S.tone(o, 0, { f: f * 1.06, f1: f, gt: 0.01, att: 0.0015, tau: 0.028 });
  S.part(o, 0, f * 2.01, 0.2, 0.012);
  S.part(o, 0, f * 3.98, 0.06, 0.006);
}, { bus: 'ui', db: -10, jit: 15, clean: true, sr: 44100 });

def('ui_select', 0.4, (S, o) => {
  const f = S.j(880, 0.01);
  for (const [t, m, a] of [[0, 1, 0.8], [0.065, 1.5, 1]]) {
    const x = S.fm(0.35, f * m, 2, S.env(0.35, [[0, 1.6], [0.08, 0.2, 'e']]));
    S.mul(x, S.ad(0.35, 0.002, 0.07));
    S.add(o, x, t, a);
    S.part(o, t, f * m * 3, 0.08 * a, 0.03);
  }
}, { bus: 'ui', db: -9, clean: true, jit: 10, sr: 44100 });

def('ui_back', 0.3, (S, o) => {
  const f = S.j(990, 0.01);
  S.tone(o, 0, { f, wave: 'tri', tau: 0.045, a: 0.8 });
  S.tone(o, 0.06, { f: f * 0.75, f1: f * 0.7, gt: 0.06, wave: 'tri', tau: 0.07, a: 0.9 });
  S.lp(o, 4000);
}, { bus: 'ui', db: -10, clean: true, jit: 10, sr: 44100 });

def('ui_error', 0.42, (S, o) => {
  for (const [t, d] of [[0, 0.11], [0.15, 0.2]]) {
    const x = S.osc(d, 147, 'sq'), y = S.osc(d, 155.5, 'saw');
    for (let i = 0; i < x.length; i++) x[i] = 0.6 * x[i] + 0.4 * y[i];
    S.mul(x, S.env(d, [[0, 0], [0.004, 1], [d - 0.012, 0.85], [d, 0]]));
    S.lp(x, 2200);
    S.add(o, x, t);
  }
  S.drive(o, 1.5);
}, { bus: 'ui', db: -11, jit: 5, sr: 44100 });

def('ui_type', 0.16, (S, o) => {
  click(S, o, 0, S.rr(3500, 5200), 0.6, 0.0012, 0.9);
  modalHit(S, o, 0.0008, [[S.rr(1100, 1500), 0.012, 1], [S.rr(2200, 2800), 0.008, 0.6], [S.rr(600, 800), 0.014, 0.5], [S.rr(3600, 4400), 0.005, 0.3]], 0.0012, 6500, 0.8);
  S.part(o, 0.002, S.rr(3800, 4600), 0.04, 0.03);
  const t2 = S.rr(0.06, 0.09);
  click(S, o, t2, S.rr(2500, 3500), 0.18, 0.0015);
  modalHit(S, o, t2, [[S.rr(1300, 1700), 0.008, 1], [S.rr(2600, 3000), 0.006, 0.5]], 0.001, 5000, 0.25);
}, { bus: 'ui', db: -12, vars: 6, jit: 60, max: 8, sr: 44100 });

def('ui_boot', 2.6, (S, o) => {
  thud(S, o, 0, 120, 48, 0.09, 1);
  S.nz(o, 0, { tau: 0.05, lp: 500, a: 0.7 });
  click(S, o, 0, 2200, 0.35, 0.004);
  const dg = S.osc(1.4, 60, 'saw');
  S.lp(dg, 600);
  S.mul(dg, S.env(1.4, [[0, 0], [0.05, 1], [1.4, 0.001, 'e']]));
  S.mul(dg, (t) => 1 + 0.4 * Math.sin(TAU * 7 * t));
  S.add(o, dg, 0.02, 0.5);
  const wf = S.env(2.3, [[0, 300], [1.4, 8800, 'e'], [2.3, 9200]]);
  const w = S.osc(2.3, wf);
  S.mul(w, S.env(2.3, [[0, 0], [0.4, 0.5], [1.4, 1], [2.3, 0, 1.5]]));
  S.add(o, w, 0.15, 0.1);
  const cr = S.crackle(1.0, [[0, 400], [1, 30]], { w: 0.0003, hp: 3000 });
  S.norm(cr, 0.4);
  S.add(o, cr, 0.1);
  const h = S.osc(2.4, 120);
  S.mul(h, S.env(2.4, [[0, 0], [0.3, 1], [2.4, 0]]));
  S.add(o, h, 0.1, 0.12);
}, { bus: 'ui', db: -6, vars: 1, jit: 10 });

def('watch_beep', 0.3, (S, o) => {
  const f = 4096 * S.j(1, 0.004);
  for (const t of [0, 0.115]) {
    const x = S.osc(0.065, f, 'sq');
    S.mul(x, S.env(0.065, [[0, 0], [0.002, 1], [0.06, 1], [0.065, 0]]));
    S.bp(x, f, 1.4);
    S.add(o, x, t);
  }
}, { bus: 'ui', db: -15, clean: true, jit: 0, sr: 44100 });

const CHIME = [[1, 1, 0.5], [2.0, 0.25, 0.25], [3.0, 0.08, 0.12], [4.17, 0.05, 0.08]];
def('notification', 1.3, (S, o) => {
  S.bell(o, 0, 1046.5, CHIME, 0.8);
  S.bell(o, 0.11, 1568, CHIME, 1);
}, { bus: 'ui', db: -9, clean: true, jit: 4, sr: 44100 });

def('radio_beep', 0.42, (S, o) => {
  const x = S.buf(0.42);
  S.tone(x, 0, { f: 1000, wave: 'sq', att: 0.003, hold: 0.08, tau: 0.004, a: 0.5 });
  S.tone(x, 0.095, { f: 1350, wave: 'sq', att: 0.003, hold: 0.06, tau: 0.004, a: 0.5 });
  S.nz(x, 0.17, { att: 0.002, hold: 0.06, tau: 0.03, a: 0.6 });
  radioBand(S, x, 2.2);
  S.add(o, x);
}, { db: -9, jit: 5 });

def('radio_static_burst', 0.75, (S, o) => {
  const d = S.rr(0.45, 0.65), D = d + 0.05;
  const x = S.noise(D);
  S.mul(x, rsteps(S, D, 0.012, 0.3, 1, 300));
  const c = S.crackle(D, 120, { w: 0.0004 });
  S.norm(c, 0.8);
  S.add(x, c);
  S.tone(x, 0.05, { f: S.rr(900, 2000), f1: S.rr(600, 2600), gt: 0.3, att: 0.05, tau: 0.3, a: 0.12 });
  radioBand(S, x, 2);
  S.mul(x, S.env(D, [[0, 0], [0.01, 1], [d - 0.08, 0.9], [D, 0]]));
  S.add(o, x);
}, { db: -9, vars: 3 });

def('button_press', 0.25, (S, o) => {
  click(S, o, 0, S.rr(2800, 3800), 0.5, 0.0015);
  modalHit(S, o, 0.001, [[S.rr(700, 900), 0.02, 1], [S.rr(1500, 1900), 0.012, 0.7], [S.rr(2600, 3200), 0.008, 0.4], [S.rr(300, 380), 0.025, 0.6]], 0.0018, 5000, 1);
  thud(S, o, 0, 160, 110, 0.015, 0.25);
  const t2 = S.rr(0.07, 0.11);
  click(S, o, t2, 3200, 0.2, 0.0012);
  modalHit(S, o, t2, [[S.rr(900, 1100), 0.012, 1], [2100, 0.008, 0.5]], 0.001, 4500, 0.35);
}, { db: -8, vars: 4, jit: 40 });

def('lever', 1.4, (S, o) => {
  const g = S.noise(0.32);
  S.mul(g, rsteps(S, 0.32, 0.01, 0.2, 1, 300));
  const gm = S.modal(g, [[S.rr(700, 900), 0.04, 1], [S.rr(1500, 1800), 0.03, 0.7], [S.rr(2500, 3100), 0.02, 0.4]], 0.4);
  S.norm(gm, 1);
  S.mul(gm, S.env(0.4, [[0, 0], [0.25, 1, 2], [0.3, 0.6], [0.4, 0]]));
  S.add(o, gm, 0, 0.3);
  const t = 0.3;
  thud(S, o, t, 130, 55, 0.12, 1);
  S.nz(o, t, { tau: 0.04, lp: 900, a: 0.6 });
  modalHit(S, o, t, [[S.rr(310, 350), 0.45, 1], [S.rr(850, 900), 0.3, 0.7], [S.rr(1450, 1550), 0.2, 0.5], [S.rr(2250, 2400), 0.12, 0.35], [S.rr(3300, 3600), 0.08, 0.25]], 0.0015, 6000, 0.7);
  click(S, o, t + 0.008, 3500, 0.4, 0.002);
  modalHit(S, o, t + 0.11, [[S.rr(2000, 2400), 0.05, 1], [S.rr(4000, 4600), 0.03, 0.5]], 0.0008, 8000, 0.15);
}, { db: -1 });

def('coin', 0.9, (S, o) => {
  const f = S.rr(2000, 2400);
  const P = [[1, 1, 0.3, 3], [1.62, 0.7, 0.22, 5], [2.37, 0.5, 0.15], [2.93, 0.4, 0.12, 7], [3.52, 0.3, 0.09], [4.6, 0.2, 0.06]];
  for (const [t, a] of [[0, 1], [S.rr(0.05, 0.08), 0.45], [S.rr(0.13, 0.17), 0.2]]) {
    S.bell(o, t, f * S.j(1, 0.01), P, a);
    click(S, o, t, 6000, 0.3 * a, 0.001);
  }
}, { db: -7, vars: 3, clean: true, sr: 44100 });

def('credits', 1.6, (S, o) => {
  for (let k = 0; k < 5; k++) click(S, o, k * 0.018, S.rr(2500, 4000), 0.25, 0.002);
  modalHit(S, o, 0.09, [[420, 0.08, 1], [1100, 0.05, 0.6], [2300, 0.03, 0.4]], 0.002, 4000, 0.6);
  thud(S, o, 0.09, 140, 80, 0.05, 0.6);
  const f = S.rr(2050, 2200);
  S.bell(o, 0.14, f, [[1, 1, 0.9, 4], [2.0, 0.5, 0.5, 6], [2.92, 0.35, 0.35], [4.13, 0.25, 0.22, 9], [5.4, 0.15, 0.15]], 0.9);
  S.bell(o, 0.14, f * 0.749, [[1, 0.5, 0.6], [2, 0.2, 0.3]], 0.6);
  S.scatter(8, 0.2, 0.55, (t) => S.bell(o, t, S.rr(3000, 5000), [[1, 1, 0.05], [1.6, 0.5, 0.03]], S.rr(0.04, 0.12)), 1.5);
}, { db: -6, vars: 2 });

def('alarm', 1.1, (S, o) => {
  const d = 0.9;
  const fA = S.env(d, [[0, 250], [0.09, 370, 0.5], [0.75, 360], [d, 300]]);
  for (let i = 0; i < fA.length; i++) fA[i] *= 1 + 0.01 * Math.sin((TAU * 28 * i) / S.sr);
  const x = S.osc(d, fA, 'saw'), y = S.osc(d, scaleArr(fA, 1.006), 'sq');
  for (let i = 0; i < x.length; i++) x[i] = 0.6 * x[i] + 0.4 * y[i];
  S.drive(x, 3);
  S.bp(x, 900, 0.7);
  S.eq(x, 'peak', 1400, 2, 6);
  S.mul(x, S.env(d, [[0, 0], [0.02, 1], [0.75, 1], [d, 0]]));
  S.add(o, x);
}, { db: -3, jit: 10 });

def('buzzer', 0.65, (S, o) => {
  const d = 0.55;
  const x = S.osc(d, 120, 'pulse', { pw: 0.12 }), y = S.osc(d, 240.7, 'saw');
  for (let i = 0; i < x.length; i++) x[i] = (x[i] + 0.4 * y[i]) * (1 + 0.3 * Math.sign(Math.sin((TAU * 60 * i) / S.sr)));
  S.drive(x, 2.5);
  S.bp(x, 1100, 0.6);
  S.eq(x, 'peak', 2400, 3, 6);
  S.mul(x, S.env(d, [[0, 0], [0.005, 1], [d - 0.01, 1], [d, 0]]));
  S.add(o, x);
}, { db: -5, jit: 5 });

def('elevator_ding', 2.4, (S, o) => {
  const f = S.j(932, 0.002);
  S.nz(o, 0, { tau: 0.006, lp: 2000, a: 0.12 });
  const x = S.buf(2.4);
  S.bell(x, 0, f, [[1, 1, 1.5], [3.93, 0.12, 0.25], [9.1, 0.04, 0.06], [2.0, 0.06, 0.4]]);
  S.mul(x, (t) => 1 + 0.12 * Math.sin(TAU * 4.5 * t) * Math.min(1, t * 5));
  S.add(o, x);
}, { db: -7, clean: true, jit: 5 });

def('bell_ding', 3.8, (S, o) => {
  const f = S.rr(1850, 2050);
  S.bell(o, 0.002, f, [[1, 1, 2.6, 2.7], [2.32, 0.55, 1.4, 4.1], [4.25, 0.35, 0.75, 6.3], [6.63, 0.22, 0.42, 9.1], [9.38, 0.12, 0.22]], 1, 0.0003);
  click(S, o, 0, 7000, 0.5, 0.0008, 0.8);
}, { db: -5, clean: true, jit: 10, sr: 44100 });

def('phone_ring', 2.6, (S, o) => {
  const f1 = S.rr(1150, 1250), f2 = f1 * S.rr(1.18, 1.24), ring = 1.9, n = S.n(2.6);
  const e1 = new Float32Array(n), e2 = new Float32Array(n);
  for (let k = 0; k < ring * 40; k++) {
    const t = k / 40 + S.rr(-0.002, 0.002), i0 = Math.round(Math.max(0, t) * S.sr);
    const a = Math.min(1, t / 0.05 + 0.2) * S.rr(0.7, 1);
    const e = k & 1 ? e2 : e1;
    for (let j = 0; j < 14; j++) e[i0 + j] += a * Math.sin((Math.PI * j) / 14) * (S.r() * 0.6 + 0.7);
  }
  const P = (f) => [[f, 0.35, 1], [f * 1.004, 0.3, 0.6], [f * 2.08, 0.2, 0.45], [f * 3.3, 0.12, 0.3], [f * 4.6, 0.07, 0.15]];
  const y1 = S.modal(e1, P(f1), 2.6), y2 = S.modal(e2, P(f2), 2.6);
  S.add(o, y1);
  S.add(o, y2);
  const cl = S.crackle(ring, 40, { w: 0.0005, hp: 2000 });
  S.norm(cl, S.peak(o) * 0.08);
  S.add(o, cl);
}, { db: -4, vars: 1, jit: 8 });

def('camera_shutter', 0.75, (S, o) => {
  click(S, o, 0, S.rr(1800, 2400), 0.6, 0.004, 0.7);
  modalHit(S, o, 0, [[S.rr(1700, 2000), 0.02, 1], [S.rr(3100, 3500), 0.014, 0.7], [S.rr(5000, 5600), 0.008, 0.5], [S.rr(800, 950), 0.02, 0.5]], 0.001, 9000, 0.9);
  thud(S, o, 0, 220, 150, 0.015, 0.4);
  const t2 = S.rr(0.035, 0.055);
  click(S, o, t2, 4500, 0.5, 0.002);
  modalHit(S, o, t2, [[S.rr(2600, 3000), 0.012, 1], [S.rr(5200, 6000), 0.008, 0.6]], 0.0008, 10000, 0.6);
  const md = 0.32, t3 = 0.16;
  const m = S.osc(md, S.env(md, [[0, 90], [0.05, 160], [md, 150]]), 'saw');
  S.bp(m, 1800, 1.2);
  S.mul(m, S.env(md, [[0, 0], [0.03, 1], [md - 0.03, 0.8], [md, 0]]));
  S.norm(m, 0.25);
  S.add(o, m, t3);
  for (let k = 0; k < md * 45; k++) click(S, o, t3 + k / 45, S.rr(3000, 4500), 0.12, 0.001);
  modalHit(S, o, t3 + md, [[S.rr(1500, 1800), 0.015, 1], [S.rr(3200, 3600), 0.01, 0.5]], 0.001, 7000, 0.35);
}, { db: -7, vars: 2 });

def('camera_flash', 1.8, (S, o) => {
  click(S, o, 0, 3000, 1, 0.003, 0.5);
  S.nz(o, 0, { tau: 0.012, hp: 1500, a: 0.6 });
  thud(S, o, 0, 180, 70, 0.03, 0.5);
  const d = 1.6;
  const x = S.osc(d, S.env(d, [[0, 2600], [d, 9800, 0.6]]));
  S.mul(x, S.env(d, [[0, 0], [0.15, 0.7], [1.2, 1], [d, 0]]));
  S.add(o, x, 0.08, 0.08);
}, { db: -6, vars: 2 });

def('flashlight_click', 0.12, (S, o) => {
  click(S, o, 0, S.rr(3000, 3800), 0.7, 0.0012, 0.8);
  modalHit(S, o, 0.0005, [[S.rr(2900, 3400), 0.01, 1], [S.rr(6000, 6800), 0.006, 0.6], [S.rr(1200, 1500), 0.012, 0.5]], 0.0008, 9000, 0.9);
  click(S, o, S.rr(0.012, 0.02), S.rr(4000, 5000), 0.3, 0.001);
}, { db: -11, vars: 3, jit: 40, sr: 44100 });

def('typewriter', 0.3, (S, o) => {
  click(S, o, 0, S.rr(2200, 3000), 1, 0.003, 0.6);
  modalHit(S, o, 0, [[S.rr(950, 1150), 0.035, 1], [S.rr(2100, 2500), 0.025, 0.8], [S.rr(3600, 4200), 0.015, 0.5], [S.rr(5600, 6400), 0.01, 0.3]], 0.0007, 10000, 1);
  thud(S, o, 0, 260, 170, 0.025, 0.5);
  S.nz(o, 0, { tau: 0.02, bp: 400, q: 1.5, a: 0.3 });
  modalHit(S, o, S.rr(0.025, 0.04), [[S.rr(3800, 4400), 0.02, 1], [S.rr(7000, 7800), 0.012, 0.5]], 0.0005, 12000, 0.35);
  click(S, o, S.rr(0.09, 0.12), 2000, 0.12, 0.002);
}, { db: -6, vars: 5, jit: 50 });

// ======================================================================
// Player
// ======================================================================
def('jump', 0.4, (S, o) => {
  S.nz(o, 0, { att: 0.004, tau: 0.03, bp: 1500, q: 0.7, a: 0.5 });
  thud(S, o, 0, 120, 80, 0.02, 0.4);
  S.nz(o, 0.02, { dur: 0.35, env: [[0, 0], [0.08, 1, 2], [0.35, 0, 0.7]], bp: S.env(0.35, [[0, 400], [0.3, 1400]]), q: 1.2, a: 0.6 });
  crinkle(S, o, 0.02, 0.2, 0.3);
}, { db: -11, vars: 3 });

def('land', 0.9, (S, o, p) => {
  const i = p.i;
  thud(S, o, 0, lerp(110, 130, i), lerp(60, 45, i), lerp(0.05, 0.12, i), 1);
  S.nz(o, 0, { att: 0.002, tau: lerp(0.03, 0.09, i), lp: lerp(400, 1400, i), a: 0.8 });
  S.nz(o, 0.004, { tau: 0.04, bp: 1800, q: 0.6, a: 0.15 + 0.3 * i });
  S.scatter(S.ri(3, 8) + Math.round(i * 6), 0.01, 0.2, (t) => modalHit(S, o, t, [[S.rr(1800, 4200), 0.025, 1], [S.rr(4000, 6000), 0.015, 0.4]], 0.0005, 9000, S.rr(0.03, 0.1) * (0.4 + i)), 1.6);
  crinkle(S, o, 0, 0.25, 0.25 + 0.3 * i);
}, { tiers: [0.25, 0.6, 1], vars: 3, db: -5 });

def('suit_rustle', 0.6, (S, o) => {
  const d = S.rr(0.4, 0.55);
  crinkle(S, o, 0, d, 1);
  S.nz(o, 0, { att: d * 0.4, tau: 0.08, bp: 1100, q: 0.8, a: 0.3, color: 'p' });
  if (S.chance(0.4)) S.tone(o, S.rr(0.1, 0.25), { f: S.rr(500, 800), f1: S.rr(700, 1000), gt: 0.05, wave: 'saw', att: 0.01, tau: 0.03, lp: 2000, a: 0.08 });
}, { db: -13, vars: 4 });

def('breath_heavy', 1.6, (S, o) => {
  const ti = S.rr(0.45, 0.55), te = S.rr(0.6, 0.75);
  S.add(o, breathPart(S, true, ti, 0.3), 0, 0.7);
  S.add(o, breathPart(S, false, te, 0.3), ti + 0.05, 1);
}, { db: -11, vars: 3 });

def('heartbeat', 0.7, (S, o) => {
  heartThump(S, o, 0.005, 52, 1, 0.07);
  heartThump(S, o, 0.26, 62, 0.75, 0.055);
}, { db: -5, vars: 2, jit: 10 });

def('hurt', 0.6, (S, o) => {
  const d = S.rr(0.26, 0.34), f0 = S.rr(230, 290);
  const v = S.vox(d, { f0: [[0, f0 * 1.15], [0.05, f0], [d, f0 * 0.72, 1.3]], vow: [[0, 'o'], [d * 0.7, 'u'], [d, 'm']], scale: 1.15, breath: 0.15, jit: 0.03, tilt: 1600 });
  S.mul(v, S.env(d, [[0, 0], [0.015, 1], [d * 0.6, 0.7], [d, 0]]));
  S.lp(v, 2200);
  S.add(o, v, 0.01);
  S.nz(o, 0.01 + d * 0.85, { att: 0.02, tau: 0.04, bp: 1800, q: 0.6, a: 0.12 });
  thud(S, o, 0, 120, 60, 0.05, 0.6);
  S.nz(o, 0, { tau: 0.03, lp: 700, a: 0.4 });
}, { db: -4, vars: 4 });

def('death', 2.4, (S, o) => {
  const d = 1.5, n = S.n(d), f = new Float32Array(n);
  let w = 0;
  for (let k = 0; k < n; k++) {
    const t = k / S.sr;
    w = w * 0.998 + (S.r() - 0.5) * 0.02;
    f[k] = 820 * Math.pow(260 / 820, t / d) * (1 + 0.06 * Math.sin(TAU * 23 * t) + w);
  }
  const x = S.osc(d, f, 'pulse', { pw: 0.3 });
  S.bp(x, S.env(d, [[0, 2200], [d, 900]]), 1.5);
  const am = S.env(d, [[0, 0], [0.04, 1], [d - 0.35, 0.9], [d, 0]]);
  for (let k = Math.round((d - 0.45) * S.sr); k < n; k++) am[k] *= Math.sin((TAU * 14 * k) / S.sr) > -0.2 ? 1 : 0.15;
  S.mul(x, S.lp1(am, 60));
  S.add(o, x, 0, 0.6);
  S.nz(o, 0, { dur: d, env: [[0, 0], [0.1, 1], [d, 0]], bp: 3000, q: 0.5, a: 0.1 });
  const tt = d + 0.12;
  thud(S, o, tt, 110, 50, 0.08, 1);
  S.nz(o, tt, { tau: 0.05, lp: 900, a: 0.6 });
  crinkle(S, o, tt, 0.2, 0.3);
}, { db: -3, vars: 2 });

def('eat', 1.1, (S, o) => {
  let t = 0;
  for (const a of [1, 0.7, 0.45]) {
    const cd = S.rr(0.08, 0.14), c = S.crackle(cd, 2500, { w: 0.0004, ap: 2 });
    S.bp(c, S.rr(1500, 2800), 0.7);
    S.norm(c, 1);
    S.mul(c, S.env(cd, [[0, 0], [0.005, 1], [cd, 0, 1.5]]));
    S.add(o, c, t, a);
    thud(S, o, t, 140, 90, 0.025, 0.35 * a);
    S.nz(o, t, { tau: 0.03, lp: 800, a: 0.3 * a });
    t += S.rr(0.26, 0.34);
  }
}, { db: -7, vars: 3 });

def('drink', 1.3, (S, o) => {
  let t = 0.03;
  for (let k = 0, n = S.ri(2, 3); k < n; k++) {
    S.bubble(o, t, S.rr(180, 260), 1, { rise: 0.9, d: 50 });
    click(S, o, t, 900, 0.2, 0.006);
    S.nz(o, Math.max(0, t - 0.03), { att: 0.03, tau: 0.04, bp: 700, q: 1, a: 0.12 });
    S.scatter(3, t + 0.02, t + 0.12, (tt) => S.bubble(o, tt, S.rr(600, 1300), S.rr(0.08, 0.2), { rise: 0.4 }));
    t += S.rr(0.32, 0.42);
  }
}, { db: -7, vars: 3 });

def('bandage', 1.1, (S, o) => {
  const d = S.rr(0.4, 0.55);
  const c = S.crackle(d, S.env(d, [[0, 300], [d * 0.3, 2500], [d, 1800]]), { w: 0.0002, ap: 1.5, min: 0.2 });
  S.bp(c, S.env(d, [[0, 1800], [d, 3000]]), 0.8);
  S.norm(c, 1);
  const nzz = S.noise(d);
  S.bp(nzz, 2500, 0.7);
  S.mul(nzz, rsteps(S, d, 0.004, 0.2, 1, 800));
  S.norm(nzz, 0.5);
  S.add(c, nzz);
  S.mul(c, S.env(d, [[0, 0], [0.02, 0.8], [d * 0.7, 1], [d, 0]]));
  S.add(o, c);
  click(S, o, d, 2500, 0.6, 0.004, 0.7);
  for (const t of [d + 0.18, d + 0.3]) {
    thud(S, o, t, 150, 100, 0.015, 0.3);
    S.nz(o, t, { tau: 0.015, lp: 1200, a: 0.25 });
  }
}, { db: -8, vars: 3 });

def('gasp', 0.6, (S, o) => {
  const d = S.rr(0.3, 0.4);
  const v = S.vox(d, { f0: [[0, 330], [d, 260]], voice: [[0, 0.3], [0.05, 0.06], [d, 0]], breath: 1, vow: [[0, 'a'], [d, 'uh']], scale: 1.1 });
  S.hp(v, 300);
  S.mul(v, S.env(d, [[0, 0], [0.025, 1], [d * 0.5, 0.7], [d, 0]]));
  S.add(o, v, 0.005);
}, { db: -7, vars: 3 });

def('yawn', 2.6, (S, o) => {
  const d = 2.2;
  const v = S.vox(d, { f0: [[0, 200], [0.5, 290, 's'], [1.4, 260], [d, 140, 's']], voice: [[0, 0.2], [0.3, 0.8], [1.5, 0.6], [d, 0]], breath: [[0, 0.6], [1, 0.3], [d, 0.8]], vow: [[0, 'uh'], [0.6, 'a'], [1.4, 'a'], [1.9, 'o'], [d, 'u']], jit: 0.02, tilt: 2000 });
  S.mul(v, S.env(d, [[0, 0], [0.3, 0.6], [0.8, 1], [1.6, 0.8], [d, 0]]));
  S.add(o, v);
}, { db: -9, vars: 2 });

def('snore', 2.8, (S, o) => {
  const d = 1.4;
  const v = S.vox(d, { f0: S.rr(26, 34), jit: 0.15, voice: 1, breath: 0.6, vow: [[0, 'uh'], [d, 'o']], scale: 0.9, tilt: 900 });
  S.mul(v, S.env(d, [[0, 0], [0.9, 1, 1.5], [d, 0]]));
  S.add(o, v);
  const e = 0.8, t = d + 0.25;
  S.nz(o, t, { dur: e, env: [[0, 0], [0.15, 1], [e, 0, 1.5]], bp: 900, q: 0.7, a: 0.25 });
  S.nz(o, t, { dur: e, env: [[0, 0], [0.2, 1], [e, 0]], bp: S.rr(1900, 2400), q: 12, a: 0.06 });
}, { db: -9, vars: 2 });

// ======================================================================
// Physics
// ======================================================================
const IMP_T = [0.2, 0.55, 1];
for (const [m, d, db] of [['wood', 0.7, -3], ['metal', 1.6, -4], ['plastic', 0.5, -4], ['cardboard', 0.45, -4], ['glass', 1.4, -5], ['soft', 0.4, -5], ['heavy', 1.2, 0], ['flesh', 0.5, -3]]) {
  def('impact_' + m, d, (S, o, p) => impact(S, o, 0.001, m, p.i), { tiers: IMP_T, vars: m === 'metal' || m === 'glass' || m === 'heavy' ? 2 : 3, db, max: 8, sr: m === 'glass' ? 44100 : 32000 });
}

def('break_wood', 1.5, (S, o) => {
  click(S, o, 0, 2500, 1, 0.006, 0.5);
  impact(S, o, 0, 'wood', 1, 0.8, 0.9);
  S.nz(o, 0, { tau: 0.05, lp: 3000, a: 0.5 });
  S.scatter(S.ri(16, 28), 0.005, 0.45, (t, u) => {
    const f = S.rr(1200, 5000);
    modalHit(S, o, t, [[f, S.rr(0.006, 0.02), 1], [f * S.rr(1.5, 2.3), 0.008, 0.5]], 0.0004, 9000, S.rr(0.15, 0.6) * (1 - u * 0.7));
  }, 2);
  const td = 0.35, ft = S.noise(td);
  S.bp(ft, 3000, 0.6);
  S.mul(ft, rsteps(S, td, 0.006, 0, 1, 500));
  S.mul(ft, S.env(td, [[0, 1], [td, 0, 1.5]]));
  S.norm(ft, 0.35);
  S.add(o, ft, 0.01);
  S.scatter(S.ri(3, 6), 0.25, 1.0, (t) => impact(S, o, t, 'wood', S.rr(0.2, 0.6), S.rr(0.4, 0.8), S.rr(0.15, 0.4)));
}, { db: -1, vars: 3 });

def('break_glass', 2.0, (S, o) => {
  click(S, o, 0, 6000, 1, 0.003, 0.5);
  S.nz(o, 0, { tau: 0.06, hp: 2500, a: 0.6 });
  impact(S, o, 0, 'glass', 1, 1.2, 0.6);
  S.scatter(S.ri(40, 70), 0.002, 0.35, (t, u) => tink(S, o, t, S.rr(2500, 9000), S.rr(0.1, 0.5) * (1 - u * 0.6)), 2.5);
  S.scatter(S.ri(14, 24), 0.25, 1.6, (t, u) => tink(S, o, t, S.rr(2000, 7000), S.rr(0.05, 0.25) * (1 - u * 0.8)), 1.4);
}, { db: -2, vars: 3, sr: 44100 });

def('break_plastic', 1.0, (S, o) => {
  click(S, o, 0, 3000, 1, 0.004, 0.6);
  impact(S, o, 0, 'plastic', 1, 0.9, 0.8);
  S.scatter(S.ri(6, 12), 0, 0.15, (t) => modalHit(S, o, t, [[S.rr(1500, 4000), 0.01, 1]], 0.0005, 8000, S.rr(0.1, 0.4)), 2);
  S.scatter(S.ri(3, 5), 0.15, 0.7, (t) => impact(S, o, t, 'plastic', S.rr(0.2, 0.5), S.rr(0.4, 0.7), S.rr(0.15, 0.35)));
}, { db: -2, vars: 3 });

def('glass_shatter', 3.4, (S, o) => {
  thud(S, o, 0, 160, 70, 0.08, 0.6);
  click(S, o, 0, 4000, 1, 0.004, 0.4);
  S.nz(o, 0, { att: 0.001, tau: 0.25, hp: 1200, a: 0.9 });
  S.nz(o, 0, { att: 0.001, tau: 0.1, bp: 700, q: 0.7, a: 0.4 });
  S.scatter(160, 0, 0.5, (t, u) => tink(S, o, t, S.rr(1800, 10000), S.rr(0.1, 0.5) * (1 - u * 0.5)), 2.2);
  S.scatter(12, 0.3, 1.4, (t) => impact(S, o, t, 'glass', S.rr(0.4, 0.9), S.rr(0.8, 1.6), S.rr(0.2, 0.5)), 1.3);
  S.scatter(40, 0.4, 2.8, (t, u) => tink(S, o, t, S.rr(2500, 9000), S.rr(0.04, 0.2) * (1 - u * 0.85)), 1.6);
}, { db: 1, vars: 2, sr: 44100 });

def('grab', 0.3, (S, o) => {
  S.nz(o, 0, { dur: 0.12, env: [[0, 0], [0.08, 1, 2], [0.12, 0.2]], bp: S.env(0.12, [[0, 400], [0.1, 1600, 'e']]), q: 1.5, a: 0.6, color: 'p' });
  const t = 0.075;
  click(S, o, t, 2200, 0.5, 0.002, 0.9);
  modalHit(S, o, t, [[S.rr(900, 1100), 0.015, 1], [S.rr(1900, 2300), 0.01, 0.5]], 0.0012, 4000, 0.6);
}, { db: -11, vars: 3 });

def('release', 0.3, (S, o) => {
  click(S, o, 0, 1800, 0.4, 0.002, 0.9);
  modalHit(S, o, 0, [[S.rr(700, 900), 0.012, 1], [1600, 0.008, 0.4]], 0.0012, 3500, 0.5);
  S.nz(o, 0.01, { dur: 0.18, env: [[0, 0], [0.01, 1], [0.18, 0, 1.5]], bp: S.env(0.18, [[0, 1400], [0.15, 350, 'e']]), q: 1.5, a: 0.45, color: 'p' });
}, { db: -13, vars: 3 });

def('throw_whoosh', 0.6, (S, o, p) => {
  const d = lerp(0.35, 0.5, p.i), env = [[0, 0], [d * 0.35, 1, 2], [d, 0, 0.6]];
  const fc = S.env(d, [[0, 500], [d * 0.35, lerp(1400, 2400, p.i), 's'], [d, 600, 's']]);
  S.nz(o, 0, { dur: d, env, bp: fc, q: 1.8, a: 1, color: 'p' });
  S.nz(o, 0, { dur: d, env, bp: scaleArr(fc, 2.3), q: 3, a: 0.3, color: 'p' });
}, { tiers: [0.4, 1], vars: 3, db: -7 });

def('scrape_short', 0.5, (S, o, p) => {
  const d = S.rr(0.25, 0.4);
  const x = S.noise(d);
  S.mul(x, rsteps(S, d, 1 / S.rr(60, 140), 0.1, 1, 900));
  const y = S.modal(x, [[S.rr(500, 900), 0.03, 1], [S.rr(1200, 1900), 0.02, 0.7], [S.rr(2400, 3600), 0.015, 0.5 * (0.5 + p.i)], [S.rr(4000, 6000), 0.01, 0.3 * p.i]], d + 0.1);
  S.norm(y, 1);
  S.mul(y, S.env(d + 0.1, [[0, 0], [0.03, 1], [d * 0.7, 0.8], [d + 0.1, 0]]));
  S.add(o, y);
  S.nz(o, 0, { dur: d, env: [[0, 0], [0.03, 1], [d, 0]], bp: 2500, q: 0.5, a: 0.2 });
}, { tiers: [0.3, 1], vars: 3, db: -7 });

def('squeak', 0.5, (S, o) => {
  const duck = S.chance(0.5), d = S.rr(0.2, 0.35);
  const f0 = duck ? S.rr(850, 1100) : S.rr(500, 750);
  const f = S.env(d, [[0, f0 * 0.8], [d * 0.25, f0 * 1.25, 's'], [d * 0.7, f0 * 1.1], [d, f0 * (duck ? 0.85 : 1.2)]]);
  for (let i = 0; i < f.length; i++) f[i] *= 1 + 0.03 * Math.sin((TAU * 18 * i) / S.sr);
  const x = S.osc(d, f, duck ? 'pulse' : 'saw', { pw: 0.35 });
  S.bp(x, duck ? 2600 : 1800, 1.2);
  S.mul(x, S.env(d, [[0, 0], [0.015, 1], [d - 0.04, 0.9], [d, 0]]));
  S.add(o, x);
  S.nz(o, 0, { dur: d, env: [[0, 0], [0.01, 1], [d, 0]], bp: 3500, q: 0.6, a: 0.12 });
}, { db: -7, vars: 4 });

// ======================================================================
// Tools / crafting
// ======================================================================
def('weld_crackle', 0.8, (S, o) => {
  const d = S.rr(0.5, 0.7), x = arc(S, d);
  S.mul(x, S.env(d, [[0, 0], [0.01, 1], [d - 0.08, 0.9], [d, 0]]));
  S.add(o, x);
}, { db: -5, vars: 3 });

def('spark', 0.35, (S, o) => {
  click(S, o, 0, S.rr(3000, 6000), 1, 0.0015, 0.5);
  S.nz(o, 0, { tau: 0.004, hp: 2000, a: 0.8 });
  S.part(o, 0, S.rr(5000, 8000), 0.2, 0.01);
  const c = S.crackle(0.15, [[0, 400], [0.15, 20]], { w: 0.0002, hp: 2500 });
  S.norm(c, 0.5);
  S.add(o, c, 0.005);
  S.nz(o, 0.003, { tau: 0.04, hp: 5000, a: 0.15 });
  thud(S, o, 0, 200, 120, 0.01, 0.2);
}, { db: -6, vars: 4, sr: 44100 });

def('multitool', 0.9, (S, o) => {
  let t = 0.01;
  for (let s = 0; s < 2; s++) {
    const n = S.ri(4, 6), rate = S.rr(13, 18);
    S.nz(o, t, { dur: n / rate, env: [[0, 0], [0.05, 1], [n / rate, 0]], bp: 700, q: 0.8, a: 0.08, color: 'p' });
    for (let k = 0; k < n; k++) { ratchetClick(S, o, t, S.rr(0.5, 0.9), 4200); t += (1 / rate) * S.rr(0.85, 1.15); }
    t += 0.08;
  }
}, { db: -8, vars: 3 });

def('dismantle', 1.5, (S, o) => {
  const d = 0.45;
  for (let k = 0; k < 7; k++) modalHit(S, o, (k * d) / 7 + S.rr(0, 0.02), [[S.rr(2000, 3000), 0.01, 1], [S.rr(4500, 5500), 0.006, 0.5]], 0.0006, 9000, S.rr(0.15, 0.3));
  const sq = S.noise(d);
  S.mul(sq, rsteps(S, d, 1 / 80, 0, 1, 1200));
  const sqm = S.modal(sq, [[S.rr(1600, 2200), 0.02, 1], [S.rr(3300, 4000), 0.012, 0.5]], d);
  S.norm(sqm, 0.25);
  S.mul(sqm, S.env(d, [[0, 0], [0.05, 1], [d, 0.6]]));
  S.add(o, sqm);
  impact(S, o, d + 0.05, 'metal', 0.5, 0.25, 0.5);
  S.scatter(S.ri(3, 5), d + 0.15, d + 0.8, (t) => impact(S, o, t, S.pick(['metal', 'plastic', 'metal']), S.rr(0.3, 0.8), S.rr(0.4, 0.8), S.rr(0.4, 0.8)), 1.3);
}, { db: -4, vars: 3 });

def('craft', 1.9, (S, o) => {
  for (let k = 0; k < 3; k++) {
    const t = k * 0.2 + S.rr(0, 0.02);
    impact(S, o, t, 'metal', 0.9, S.rr(0.8, 1.0), 0.8);
    impact(S, o, t, 'wood', 0.8, 1, 0.5);
    thud(S, o, t, 130, 80, 0.04, 0.4);
  }
  [1, 1.26, 1.498, 2].forEach((m, k) => S.bell(o, 0.75 + k * 0.075, 1046.5 * m, [[1, 1, 0.5], [2.0, 0.2, 0.2], [3.0, 0.08, 0.1], [4.07, 0.05, 0.06]], 0.55));
  S.scatter(6, 1.05, 1.4, (t) => S.part(o, t, S.rr(5000, 9000), 0.06, 0.05));
}, { db: -4, vars: 2 });

def('drill', 1.6, (S, o) => {
  const d = 1.45;
  const rpm = S.env(d, [[0, 20], [0.15, 190, 0.5], [0.45, 200], [0.55, 165, 's'], [0.9, 175], [1.05, 200], [1.15, 195], [d, 10, 1.6]]);
  const m = S.osc(d, rpm, 'saw');
  S.lp(m, 1200);
  S.norm(m, 0.6);
  const wh = S.osc(d, scaleArr(rpm, 7.3));
  S.norm(wh, 0.25);
  S.add(m, wh);
  const br = S.noise(d);
  S.bp(br, 5000, 0.7);
  S.norm(br, 0.2);
  S.add(m, br);
  const gr = S.noise(d);
  S.bp(gr, 1500, 0.8);
  let ph = 0;
  for (let i = 0; i < gr.length; i++) { ph += rpm[i] / S.sr; gr[i] *= 0.6 + 0.4 * Math.sin(TAU * ph); }
  S.mul(gr, S.env(d, [[0, 0], [0.45, 0], [0.55, 1], [1.05, 1], [1.12, 0]]));
  S.norm(gr, 0.5);
  S.add(m, gr);
  S.mul(m, S.env(d, [[0, 0], [0.05, 1], [d - 0.3, 1], [d, 0]]));
  S.add(o, m);
}, { db: -4, vars: 2 });

// ======================================================================
// Lobby
// ======================================================================
def('vending_motor', 1.7, (S, o) => {
  const d = 1.55, rot = S.env(d, [[0, 0], [0.08, 1, 0.5], [d - 0.15, 1], [d - 0.05, 0.3], [d, 0]]);
  const hum = S.osc(d, scaleArr(rot, 75), 'saw');
  S.lp(hum, 500);
  S.norm(hum, 0.6);
  const gear = S.osc(d, scaleArr(rot, 720), 'saw');
  S.bp(gear, 1500, 1.5);
  S.norm(gear, 0.25);
  S.add(hum, gear);
  S.mul(hum, S.env(d, [[0, 0], [0.04, 1], [d - 0.1, 1], [d, 0]]));
  S.add(o, hum);
  let ph = 0;
  for (let i = 0; i < rot.length; i++) {
    ph += (rot[i] * 9) / S.sr;
    if (ph >= 1) { ph -= 1; modalHit(S, o, i / S.sr, [[S.rr(1800, 2200), 0.01, 1], [S.rr(3600, 4200), 0.006, 0.5]], 0.0006, 8000, S.rr(0.15, 0.25)); }
  }
  modalHit(S, o, d - 0.05, [[S.rr(500, 600), 0.04, 1], [S.rr(1300, 1500), 0.02, 0.6]], 0.002, 5000, 0.5);
}, { db: -5, vars: 2 });

def('vending_drop', 1.0, (S, o) => {
  S.nz(o, 0, { att: 0.02, tau: 0.03, dur: 0.08, bp: 2000, q: 0.8, a: 0.2 });
  const t = S.rr(0.08, 0.12);
  thud(S, o, t, 120, 65, 0.07, 1);
  modalHit(S, o, t, [[S.rr(170, 200), 0.18, 1], [S.rr(410, 450), 0.12, 0.8], [S.rr(740, 800), 0.09, 0.6], [S.rr(1250, 1400), 0.06, 0.4], [S.rr(2100, 2400), 0.04, 0.25]], 0.002, 4500, 0.8);
  impact(S, o, t + 0.002, S.pick(['metal', 'plastic', 'cardboard']), 0.8, 1, 0.5);
  impact(S, o, t + S.rr(0.1, 0.15), 'metal', 0.3, 1.3, 0.25);
  S.nz(o, t + 0.2, { tau: 0.03, bp: 600, a: 0.1 });
}, { db: -2, vars: 3 });

def('water_glug', 1.9, (S, o) => {
  S.nz(o, 0, { dur: 1.7, env: [[0, 0], [0.1, 1], [1.4, 0.8], [1.7, 0]], bp: 1300, q: 0.7, a: 0.06, color: 'p' });
  const x = S.buf(1.9);
  let t = 0.05;
  for (let k = 0, n = S.ri(3, 5); k < n; k++) {
    S.bubble(x, t, S.rr(150, 230), 1, { rise: S.rr(0.3, 0.45), d: S.rr(26, 34) });
    S.bubble(x, t + 0.03, S.rr(280, 380), 0.4, { rise: 0.35, d: 40 });
    S.scatter(S.ri(3, 6), t + 0.02, t + 0.2, (tt) => S.bubble(x, tt, S.rr(500, 1400), S.rr(0.05, 0.15), { rise: 0.5 }));
    t += S.rr(0.26, 0.36);
  }
  S.comb(x, 1 / S.rr(180, 230), 0.45, 0.3);
  S.add(o, x);
}, { db: -5, vars: 3 });

def('dart_throw', 0.3, (S, o) => {
  const d = 0.2;
  S.nz(o, 0, { dur: d, env: [[0, 0], [0.04, 1, 2], [d, 0, 0.7]], bp: S.env(d, [[0, 1500], [d, 4000, 'e']]), q: 2, a: 0.8 });
  S.nz(o, 0, { tau: 0.02, bp: 900, q: 1, a: 0.15 });
}, { db: -13, vars: 3 });

function dartThunk(S, o, t) {
  S.nz(o, t, { att: 0.0005, tau: 0.008, bp: S.rr(1200, 2000), q: 0.8, a: 0.8 });
  thud(S, o, t, 260, 180, 0.03, 0.7);
  modalHit(S, o, t, [[S.rr(190, 240), 0.06, 1], [S.rr(480, 560), 0.04, 0.6]], 0.002, 2500, 0.6);
  const d = 0.35, f = S.rr(28, 40), v = S.osc(d, S.rr(550, 700), 'tri');
  S.mul(v, (tt) => 0.5 + 0.5 * Math.sin(TAU * f * tt));
  S.mul(v, S.ad(d, 0.002, 0.08));
  S.bp(v, 800, 1);
  S.norm(v, 0.15);
  S.add(o, v, t + 0.005);
}
def('dart_hit', 0.5, (S, o) => dartThunk(S, o, 0.001), { db: -7, vars: 4 });
def('dart_bull', 1.3, (S, o) => {
  dartThunk(S, o, 0.001);
  const f = 2637;
  S.bell(o, 0.08, f, [[1, 1, 0.5], [2.0, 0.3, 0.25], [3.0, 0.1, 0.12]], 0.7);
  S.bell(o, 0.16, f * 1.335, [[1, 1, 0.6], [2, 0.25, 0.25]], 0.6);
}, { db: -6, vars: 2 });

def('fish_flop', 0.9, (S, o) => {
  let t = 0.005;
  for (let k = 0, n = S.ri(2, 3); k < n; k++) {
    const a = [1, 0.7, 0.5][k];
    impact(S, o, t, 'flesh', 0.6, 0.7, a);
    S.scatter(2, t, t + 0.05, (tt) => S.bubble(o, tt, S.rr(700, 1600), 0.15 * a, { rise: 0.8 }));
    S.nz(o, t + 0.01, { att: 0.01, tau: 0.03, bp: 1800, q: 1.2, a: 0.15 * a });
    t += S.rr(0.14, 0.22);
  }
}, { db: -6, vars: 3 });

def('bubble', 0.3, (S, o) => {
  const f = S.rr(350, 1100);
  S.bubble(o, 0.002, f, 1, { rise: S.rr(0.3, 0.8) });
  if (S.chance(0.4)) S.bubble(o, S.rr(0.02, 0.06), f * S.rr(1.3, 1.8), 0.4, { rise: 0.5 });
}, { db: -11, vars: 6, clean: true });

def('door_heavy_open', 2.4, (S, o) => {
  impact(S, o, 0.01, 'metal', 0.7, 0.8, 0.7);
  thud(S, o, 0.01, 120, 70, 0.05, 0.6);
  click(S, o, 0, 3000, 0.4, 0.002);
  creak(S, o, 0.2, S.rr(1.2, 1.6), S.rr(90, 130), S.rr(60, 90), 0.8, 0.6);
  S.nz(o, 0.25, { dur: 1.5, env: [[0, 0], [0.6, 1, 's'], [1.5, 0, 's']], lp: 500, a: 0.25, color: 'p' });
}, { db: -3, vars: 2 });

def('door_creak', 1.8, (S, o) => creak(S, o, 0.01, S.rr(0.9, 1.5), S.rr(180, 320), S.rr(120, 260), 1, 1), { db: -6, vars: 4 });

def('locker_open', 1.0, (S, o) => {
  click(S, o, 0, 2800, 0.6, 0.002);
  modalHit(S, o, 0, [[S.rr(1900, 2300), 0.03, 1], [S.rr(3700, 4200), 0.02, 0.5]], 0.0008, 8000, 0.5);
  const t = 0.06, f0 = S.rr(170, 230);
  modalHit(S, o, t, [[f0, 0.35, 1], [f0 * 1.52, 0.25, 0.8], [f0 * 2.31, 0.2, 0.6], [f0 * 3.13, 0.15, 0.4], [f0 * 4.47, 0.1, 0.3], [f0 * 6.1, 0.07, 0.2]], 0.006, 2000, 0.6);
  creak(S, o, 0.1, 0.35, S.rr(500, 700), S.rr(400, 600), 0.25, 1);
}, { db: -6, vars: 3 });

def('locker_close', 1.6, (S, o) => {
  const f0 = S.rr(150, 200), modes = [];
  for (let k = 0; k < 14; k++) modes.push([f0 * (1 + k * 0.73 + S.rr(-0.2, 0.2)) ** 1.25, S.rr(0.15, 0.6) / (1 + k * 0.08), S.rr(0.4, 1) / (1 + k * 0.1)]);
  modalHit(S, o, 0.002, modes, 0.0012, 9000, 1);
  thud(S, o, 0.002, 110, 60, 0.07, 0.9);
  S.nz(o, 0.002, { tau: 0.05, lp: 3000, a: 0.6 });
  click(S, o, 0.012, 3200, 0.5, 0.002);
  modalHit(S, o, 0.014, [[S.rr(2200, 2600), 0.04, 1], [S.rr(4100, 4600), 0.025, 0.5]], 0.0006, 9000, 0.35);
  S.scatter(5, 0.03, 0.15, (t) => modalHit(S, o, t, [[S.rr(800, 2500), 0.03, 1]], 0.0008, 6000, S.rr(0.1, 0.25)), 1.4);
}, { db: -1, vars: 3 });

def('microwave_ding', 2.0, (S, o) => {
  const f = S.rr(1250, 1400);
  click(S, o, 0, 3000, 0.3, 0.002);
  S.bell(o, 0.002, f, [[1, 1, 1.2, 2.2], [2.42, 0.5, 0.6, 3.5], [4.05, 0.3, 0.35], [5.8, 0.15, 0.2]], 1, 0.0005);
}, { db: -6, vars: 2, clean: true });

def('toilet_flush', 4.5, (S, o) => {
  impact(S, o, 0, 'plastic', 0.6, 0.8, 0.4);
  const d = 4.2, x = S.noise(d, 'p');
  S.bp(x, S.env(d, [[0, 900], [0.5, 1400], [2.5, 700], [d, 400]]), 0.6);
  S.mul(x, (t) => 0.7 + 0.3 * Math.sin(TAU * 0.9 * t + 1));
  S.mul(x, rsteps(S, d, 0.03, 0.6, 1, 40));
  S.mul(x, S.env(d, [[0, 0], [0.15, 1, 0.5], [2.2, 0.8], [3.2, 0.35], [d, 0]]));
  S.norm(x, 1);
  S.add(o, x, 0.05);
  S.scatter(110, 0.3, 3.4, (t, u) => S.bubble(o, t, S.rr(150, 700), S.rr(0.05, 0.2) * (0.5 + u), { rise: S.rr(0.2, 0.6), d: S.rr(30, 60) }), 0.8);
  const r = S.noise(1.7);
  S.hp(r, 3000);
  S.mul(r, S.env(1.7, [[0, 0], [0.3, 1], [1.7, 0]]));
  S.norm(r, 0.08);
  S.add(o, r, 2.5);
}, { db: -3, sr: 32000, vars: 1 });

// ======================================================================
// Mission
// ======================================================================
def('pull_cord', 1.3, (S, o) => {
  const d = 0.55, sp = S.env(d, [[0, 0], [0.12, 1, 0.5], [0.4, 0.8], [d, 0]]);
  let ph = 0;
  for (let i = 0; i < sp.length; i++) {
    ph += (sp[i] * 55) / S.sr;
    if (ph >= 1) { ph -= 1; ratchetClick(S, o, i / S.sr, 0.3 * sp[i] + 0.05, 3500); }
  }
  const f = S.noise(d);
  S.bp(f, 1500, 0.8);
  S.mul(f, sp);
  S.norm(f, 0.5);
  S.add(o, f);
  for (const t of [0.05, 0.17, 0.27, 0.36]) {
    thud(S, o, t, 90, 55, 0.04, 0.6);
    S.nz(o, t, { tau: 0.03, lp: 500, a: 0.4 });
  }
  const rd = 0.35, rs = S.env(rd, [[0, 0], [0.05, 1], [rd, 0]]), r = S.noise(rd);
  S.bp(r, 2200, 1);
  S.mul(r, rs);
  S.norm(r, 0.25);
  S.add(o, r, 0.65);
  modalHit(S, o, 1.0, [[S.rr(800, 1000), 0.03, 1], [S.rr(2000, 2400), 0.02, 0.5]], 0.001, 5000, 0.3);
}, { db: -4, vars: 3 });

function firing(S, o, t, a, bright = 1) {
  thud(S, o, t, 78, 45, 0.03, a);
  S.nz(o, t, { tau: 0.018, lp: 700 * bright, a: 0.7 * a });
  click(S, o, t + 0.01, 3500, 0.1 * a, 0.001);
}
def('generator_start', 3.6, (S, o) => {
  const cd = 1.0, sm = S.osc(cd, S.env(cd, [[0, 30], [0.2, 50], [cd, 55]]), 'saw');
  S.lp(sm, 400);
  S.mul(sm, (t) => 0.6 + 0.4 * Math.sin(TAU * 6 * t));
  S.mul(sm, S.env(cd, [[0, 0], [0.05, 1], [0.85, 1], [cd, 0]]));
  S.norm(sm, 0.35);
  S.add(o, sm);
  const wh = S.osc(cd, 620);
  S.mul(wh, S.env(cd, [[0, 0], [0.1, 1], [0.85, 1], [cd, 0]]));
  S.add(o, wh, 0, 0.05);
  for (const t of [0.5, 0.74, 0.88, 1.08, 1.17, 1.31]) firing(S, o, t + S.rr(-0.02, 0.02), S.rr(0.4, 0.8));
  let t = 1.42, r = 7;
  while (t < 3.45) {
    const a = Math.min(1, (t - 1.4) * 2) * (t > 3.1 ? (3.5 - t) / 0.4 : 1);
    firing(S, o, t, 0.75 * a * S.rr(0.85, 1.1), 1.2);
    r = Math.min(26, r + 2.2);
    t += (1 / r) * S.rr(0.9, 1.1);
  }
  S.nz(o, 1.4, { dur: 2.1, env: [[0, 0], [0.4, 1], [1.7, 1], [2.1, 0]], lp: 160, a: 0.3, color: 'b' });
}, { db: -1, sr: 32000, vars: 2 });

def('generator_fail', 3.0, (S, o) => {
  for (const t of [0.05, 0.3, 0.42, 0.66]) firing(S, o, t, S.rr(0.4, 0.8));
  let t = 0.8, r = 6;
  while (t < 1.9) {
    firing(S, o, t, S.rr(0.5, 0.8));
    r = t < 1.3 ? Math.min(11, r + 1.5) : Math.max(2.5, r - 2);
    t += (1 / r) * S.rr(0.8, 1.25);
  }
  firing(S, o, 2.1, 1, 1.5);
  S.nz(o, 2.12, { tau: 0.08, bp: 900, q: 0.6, a: 0.4 });
  impact(S, o, 2.3, 'metal', 0.5, 1.6, 0.3);
  S.nz(o, 2.25, { dur: 0.7, env: [[0, 0], [0.05, 1], [0.7, 0, 1.5]], hp: 3000, a: 0.12 });
}, { db: -1, sr: 32000, vars: 2 });

def('fuse_insert', 0.8, (S, o) => {
  S.nz(o, 0, { dur: 0.1, env: [[0, 0], [0.05, 1], [0.1, 0.3]], bp: 2500, q: 1, a: 0.2 });
  const t = 0.1;
  click(S, o, t, 4000, 0.9, 0.0015, 0.8);
  modalHit(S, o, t, [[S.rr(3000, 3500), 0.03, 1], [S.rr(5200, 5900), 0.02, 0.6], [S.rr(1600, 1900), 0.025, 0.5]], 0.0006, 11000, 0.8);
  thud(S, o, t, 200, 140, 0.02, 0.4);
  const h = S.osc(0.5, 120, 'saw');
  S.lp(h, 900);
  S.mul(h, S.env(0.5, [[0, 0], [0.1, 1], [0.5, 0]]));
  S.norm(h, 0.2);
  S.add(o, h, t + 0.03);
}, { db: -5, vars: 3 });

def('wire_connect', 0.6, (S, o) => {
  click(S, o, 0, 5000, 1, 0.0012, 0.5);
  S.nz(o, 0, { tau: 0.003, hp: 3000, a: 0.8 });
  const c = S.crackle(0.12, [[0, 900], [0.12, 50]], { w: 0.0002, hp: 2500 });
  S.norm(c, 0.5);
  S.add(o, c, 0.002);
  modalHit(S, o, 0.04, [[S.rr(2400, 2900), 0.02, 1], [S.rr(4800, 5400), 0.012, 0.5]], 0.0008, 9000, 0.5);
  const b = S.osc(0.3, 120, 'sq');
  S.bp(b, 1500, 1);
  S.mul(b, S.ad(0.3, 0.005, 0.07));
  S.norm(b, 0.2);
  S.add(o, b, 0.01);
}, { db: -5, vars: 3 });

def('bolt_turn', 1.0, (S, o) => {
  const n = S.ri(9, 13), rate = S.rr(16, 22), d = n / rate;
  for (let k = 0; k < n; k++) ratchetClick(S, o, (k / rate) * S.rr(0.97, 1.03) + 0.01, S.rr(0.4, 0.7), 3300);
  const x = S.noise(d);
  S.mul(x, rsteps(S, d, 1 / 150, 0, 1, 2000));
  const y = S.modal(x, [[S.rr(700, 900), 0.03, 1], [S.rr(1700, 2000), 0.02, 0.5]], d);
  S.norm(y, 0.15);
  S.add(o, y, 0.01);
  ratchetClick(S, o, d + 0.05, 1, 2800);
  impact(S, o, d + 0.05, 'metal', 0.5, 0.7, 0.3);
}, { db: -6, vars: 3 });

def('pipe_hiss', 2.0, (S, o) => {
  thud(S, o, 0, 140, 60, 0.04, 0.6);
  click(S, o, 0, 2000, 0.5, 0.004);
  const d = 1.8, x = S.noise(d);
  S.hp(x, 2200);
  S.mul(x, rsteps(S, d, 0.015, 0.7, 1, 60));
  S.mul(x, S.env(d, [[0, 0], [0.02, 1], [0.3, 0.8], [d, 0, 1.8]]));
  S.norm(x, 0.9);
  S.add(o, x);
  S.nz(o, 0, { dur: d, env: [[0, 0], [0.03, 1], [d, 0, 2]], bp: 600, q: 0.6, a: 0.4, color: 'p' });
}, { db: -4, vars: 2 });

def('crank', 1.4, (S, o) => {
  const n = S.ri(9, 12), rate = S.rr(7, 9), d = n / rate;
  for (let k = 0; k < n; k++) {
    const t = 0.01 + (k / rate) * S.rr(0.97, 1.03);
    ratchetClick(S, o, t, S.rr(0.6, 0.9), 1800);
    impact(S, o, t + 0.003, 'metal', 0.4, 1.4, 0.25);
  }
  const sq = S.osc(d, S.rr(850, 1000) * 1, 'saw');
  S.bp(sq, 1100, 3);
  S.mul(sq, (t) => Math.max(0, Math.sin((TAU * rate * t) / 4)) ** 2);
  S.norm(sq, 0.12);
  S.add(o, sq, 0.01);
  S.scatter(12, 0, d, (t) => modalHit(S, o, t, [[S.rr(2500, 5000), 0.02, 1]], 0.0005, 9000, S.rr(0.05, 0.12)));
}, { db: -5, vars: 3 });

def('radio_on', 1.5, (S, o) => {
  click(S, o, 0, 2500, 0.6, 0.002);
  modalHit(S, o, 0, [[S.rr(1300, 1600), 0.012, 1], [S.rr(2800, 3200), 0.008, 0.5]], 0.001, 6000, 0.6);
  thud(S, o, 0.03, 90, 40, 0.06, 0.6);
  const d = 1.35, x = S.noise(d);
  S.mul(x, rsteps(S, d, 0.02, 0.4, 1, 100));
  S.mul(x, 0.4);
  S.tone(x, 0.1, { f: 2400, f1: 700, gt: 0.35, att: 0.05, tau: 0.5, a: 0.3 });
  const c = S.crackle(d, 60, { w: 0.0004 });
  S.norm(c, 0.5);
  S.add(x, c);
  radioBand(S, x, 1.6);
  S.mul(x, S.env(d, [[0, 0], [0.4, 1], [d - 0.3, 0.7], [d, 0]]));
  S.norm(x, 0.7);
  S.add(o, x, 0.04);
}, { db: -7, vars: 2 });

def('transmit', 2.6, (S, o) => {
  const x = S.buf(2.6), pairs = [[697, 1209], [770, 1336], [852, 1477], [941, 1633]];
  let t = 0.02;
  for (let k = 0; k < 4; k++) {
    const [a, b] = S.pick(pairs);
    S.tone(x, t, { f: a, att: 0.003, hold: 0.06, tau: 0.005, a: 0.3 });
    S.tone(x, t, { f: b, att: 0.003, hold: 0.06, tau: 0.005, a: 0.3 });
    t += 0.09;
  }
  const fd = 0.7, fsk = new Float32Array(S.n(fd)), bitN = Math.round(S.sr / 150);
  let bit = 0;
  for (let i = 0; i < fsk.length; i++) { if (i % bitN === 0) bit = S.chance(0.5) ? 1200 : 2200; fsk[i] = bit; }
  const fx = S.osc(fd, fsk, 'sin');
  S.mul(fx, S.env(fd, [[0, 0], [0.01, 1], [fd - 0.01, 1], [fd, 0]]));
  S.add(x, fx, t, 0.35);
  t += fd + 0.05;
  S.tone(x, t, { f: 600, f1: 2400, gt: 0.12, att: 0.01, hold: 0.25, tau: 0.02, a: 0.3, dur: 0.35 });
  t += 0.36;
  const sn = S.noise(0.6);
  S.bp(sn, 1800, 0.6);
  S.mul(sn, rsteps(S, 0.6, 0.005, 0.3, 1, 400));
  S.mul(sn, S.env(0.6, [[0, 0], [0.02, 1], [0.55, 1], [0.6, 0]]));
  S.norm(sn, 0.4);
  S.add(x, sn, t);
  const c = S.crackle(2.5, 60, { w: 0.0004 });
  S.norm(c, 0.2);
  S.add(x, c);
  S.nz(x, 0, { dur: 2.55, env: [[0, 0], [0.05, 1], [2.4, 1], [2.55, 0]], a: 0.05 });
  radioBand(S, x, 1.5);
  S.add(o, x);
}, { db: -8, vars: 2 });

def('crate_rumble', 4.0, (S, o) => {
  const d = 3.8, r = S.noise(d, 'b');
  S.lp(r, 140);
  S.mul(r, S.env(d, [[0, 0], [1.5, 0.7, 's'], [2.4, 1], [d, 0, 's']]));
  S.mul(r, rsteps(S, d, 0.15, 0.5, 1, 6));
  S.norm(r, 1);
  S.add(o, r);
  S.scatter(S.ri(4, 7), 0.4, 3.0, (t) => {
    const a = S.rr(0.3, 0.7);
    thud(S, o, t, 70, 35, 0.15, a);
    S.nz(o, t, { tau: 0.12, lp: 250, a: 0.4 * a });
  });
  groan(S, o, S.rr(0.8, 1.6), 1.5, S.rr(70, 110), 0.25);
  const c = S.crackle(d, [[0, 0], [1.5, 80], [3, 150], [d, 0]], { w: 0.0002, hp: 3000 });
  S.norm(c, 0.08);
  S.add(o, c);
}, { db: 0, sr: 22050, vars: 2 });

def('ceiling_break', 2.6, (S, o) => {
  click(S, o, 0, 1500, 1, 0.006, 0.6);
  impact(S, o, 0, 'cardboard', 1, 1.3, 0.8);
  const cr = S.crackle(0.5, [[0, 3000], [0.5, 200]], { w: 0.0006, ap: 1.8 });
  S.bp(cr, 1400, 0.6);
  S.norm(cr, 0.6);
  S.add(o, cr);
  S.scatter(S.ri(3, 5), 0.05, 0.6, (t) => impact(S, o, t, 'metal', S.rr(0.5, 1), S.rr(0.5, 0.9), S.rr(0.3, 0.6)));
  friction(S, o, 0.1, 0.4, S.rr(60, 120), [[S.rr(600, 800), 0.1, 1], [S.rr(1300, 1600), 0.07, 0.7], [S.rr(2200, 2600), 0.05, 0.4]], 0.25, 0.1);
  S.scatter(S.ri(5, 8), 0.3, 1.4, (t) => impact(S, o, t, 'cardboard', S.rr(0.5, 1), S.rr(0.8, 1.5), S.rr(0.3, 0.7)));
  S.scatter(25, 0.35, 1.9, (t) => impact(S, o, t, S.pick(['cardboard', 'plastic', 'metal', 'wood']), S.rr(0.1, 0.4), S.rr(0.3, 0.6), S.rr(0.05, 0.2)), 1.4);
  S.nz(o, 0.1, { dur: 2, env: [[0, 0], [0.3, 1], [2, 0, 2]], bp: 3000, q: 0.4, a: 0.06, color: 'p' });
}, { db: 1, vars: 2 });

def('crate_land', 3.0, (S, o) => {
  thud(S, o, 0, 105, 38, 0.32, 1);
  thud(S, o, 0, 60, 30, 0.5, 0.6);
  S.nz(o, 0, { att: 0.001, tau: 0.25, lp: 1600, a: 0.9 });
  S.nz(o, 0, { tau: 0.06, bp: 1200, q: 0.6, a: 0.5 });
  impact(S, o, 0.002, 'heavy', 1, 1, 0.8);
  impact(S, o, 0.004, 'wood', 1, 2.2, 0.6);
  impact(S, o, 0.006, 'metal', 1, 2.5, 0.4);
  S.scatter(30, 0.05, 1.6, (t, u) => impact(S, o, t, S.pick(['wood', 'metal', 'plastic', 'cardboard']), S.rr(0.2, 0.7), S.rr(0.3, 0.8), S.rr(0.08, 0.3) * (1 - u * 0.6)), 1.6);
  S.nz(o, 0, { dur: 2.5, env: [[0, 0], [0.05, 1], [2.5, 0, 2]], lp: 120, a: 0.5, color: 'b' });
  S.drive(o, 1.2);
}, { db: 3, sr: 32000, vars: 2 });

def('clone_machine', 4.0, (S, o) => {
  const d = 3.7, sp = S.env(d, [[0, 0.1], [2.2, 1, 0.6], [3.2, 1], [d, 0.3]]);
  const f = scaleArr(sp, 1);
  for (let i = 0; i < f.length; i++) f[i] = 110 + 520 * sp[i];
  const w = S.osc(d, f, 'saw');
  S.bp(w, scaleArr(f, 3), 2);
  S.norm(w, 0.5);
  const wh = S.osc(d, scaleArr(f, 4.02));
  S.norm(wh, 0.18);
  S.add(w, wh);
  S.mul(w, S.env(d, [[0, 0], [0.3, 1], [d - 0.3, 1], [d, 0]]));
  S.add(o, w);
  const b = S.osc(d, 100, 'saw');
  S.bp(b, 900, 1);
  S.mul(b, rsteps(S, d, 0.05, 0.3, 1, 20));
  S.mul(b, S.env(d, [[0, 0], [0.5, 1], [d, 0]]));
  S.norm(b, 0.25);
  S.add(o, b);
  S.scatter(10, 0.5, 3.3, (t) => { const c = arc(S, S.rr(0.05, 0.2), 1.5); S.norm(c, S.rr(0.3, 0.6)); S.add(o, c, t); });
  S.scatter(90, 0.2, 3.5, (t) => S.bubble(o, t, S.rr(200, 900), S.rr(0.05, 0.25), { rise: S.rr(0.3, 1) }));
}, { db: -2, vars: 2 });

def('clone_splat', 1.1, (S, o) => {
  S.bubble(o, 0.005, S.rr(110, 150), 1, { rise: 0.7, d: 22 });
  impact(S, o, 0, 'flesh', 1, 1.3, 0.9);
  const d = 0.5;
  S.nz(o, 0.03, { dur: d, env: [[0, 0], [0.02, 1], [d, 0, 1.5]], bp: (t) => 500 + 350 * Math.sin(TAU * 11 * t) * Math.exp(-t * 3), q: 4, a: 0.35 });
  S.scatter(6, 0.05, 0.6, (t) => S.bubble(o, t, S.rr(500, 1800), S.rr(0.08, 0.25), { rise: 0.7 }));
}, { db: -3, vars: 3 });

def('exit_door_appear', 6, (S, o) => {
  const d = 6, [L, R] = o;
  const sub = S.osc(d, 41.2);
  S.mul(sub, S.env(d, [[0, 0], [2.2, 1, 's'], [3.0, 0.8], [d, 0, 's']]));
  S.add(L, sub, 0, 0.6);
  S.add(R, sub, 0, 0.6);
  const lpE = S.env(d, [[0, 200], [2.2, 2500, 'e'], [d, 500, 'e']]);
  const chEnv = S.env(d, [[0, 0], [2.0, 1, 's'], [2.4, 0.7], [d, 0, 's']]);
  for (const [ch, det] of [[L, -0.004], [R, 0.004]]) {
    const x = S.buf(d);
    for (const m of [38, 45, 50, 53, 57, 60]) S.add(x, S.osc(d, 440 * 2 ** ((m - 69) / 12) * (1 + det + S.rr(-0.002, 0.002)), 'saw'));
    S.lp(x, lpE, 0.9);
    S.mul(x, chEnv);
    S.add(ch, x, 0, 0.09);
  }
  for (const ch of [L, R]) {
    const nz = S.noise(2.3);
    S.hp(nz, 2500);
    S.mul(nz, S.env(2.3, [[0, 0], [2.15, 1, 3], [2.25, 0]]));
    S.norm(nz, 0.35);
    S.add(ch, nz);
  }
  const BELL = [[0.5, 0.6, 4], [1, 1, 3.5, 0.6], [1.19, 0.7, 2.5], [1.5, 0.4, 2], [2, 0.8, 2.2, 1.1], [2.51, 0.3, 1.5], [3.0, 0.35, 1.2], [4.2, 0.2, 0.8], [5.4, 0.12, 0.5]];
  S.bell(L, 2.2, 110, BELL, 0.9);
  S.bell(R, 2.2, 110.3, BELL, 0.9);
  S.verb(L, 3, 0.35, 0.3, 1.3);
  S.verb(R, 3, 0.35, 0.3, 1.37);
}, { db: 2, stereo: true, vars: 1, jit: 0, sr: 32000 });

def('countdown_tick', 0.15, (S, o) => {
  click(S, o, 0, 3000, 0.7, 0.0015, 0.9);
  modalHit(S, o, 0, [[2500, 0.015, 1], [4100, 0.01, 0.6], [6200, 0.006, 0.3], [800, 0.02, 0.4]], 0.0006, 10000, 0.9);
}, { db: -7, vars: 1, jit: 0, clean: true, sr: 44100 });

def('day_change', 5, (S, o) => {
  const d = 4.6, [L, R] = o;
  const env = S.env(d, [[0, 0], [1.6, 1, 's'], [2.8, 0.9], [d, 0, 's']]);
  const lpE = S.env(d, [[0, 200], [1.6, 900, 'e'], [d, 280, 'e']]);
  for (const [ch, det] of [[L, 0.997], [R, 1.003]]) {
    const x = S.buf(d);
    for (const [f, a] of [[55, 1], [82.4, 0.7], [110.3, 0.35]]) S.add(x, S.osc(d, (t) => f * det * (1 + 0.003 * Math.sin(TAU * 0.3 * t)), 'saw'), 0, a);
    S.lp(x, lpE, 1.2);
    S.mul(x, env);
    S.add(ch, x, 0, 0.5);
  }
  const r = S.noise(d, 'b');
  S.lp(r, 70);
  S.mul(r, S.env(d, [[0, 0], [2, 1, 's'], [d, 0, 's']]));
  S.norm(r, 0.6);
  const sub = S.osc(d, 28);
  S.mul(sub, S.env(d, [[0, 0], [2, 1, 's'], [d, 0, 's']]));
  for (const ch of [L, R]) { S.add(ch, r); S.add(ch, sub, 0, 0.4); }
  S.verb(L, 3.5, 0.5, 0.5, 1.5);
  S.verb(R, 3.5, 0.5, 0.5, 1.58);
}, { db: 1, stereo: true, sr: 32000, vars: 1, jit: 0 });

def('collapse_rumble', 3.2, (S, o) => {
  const d = 3.1, r = S.noise(d, 'b');
  S.lp(r, 120);
  S.mul(r, S.env(d, [[0, 0], [0.3, 1], [2.6, 0.6], [d, 0]]));
  S.norm(r, 1);
  S.add(o, r);
  thud(S, o, 0, 50, 30, 0.4, 0.8);
  S.scatter(8, 0.1, 2.4, (t) => S.nz(o, t, { tau: 0.03, bp: S.rr(200, 500), q: 1, a: S.rr(0.3, 0.6) }));
  groan(S, o, 0.3, 2.2, S.rr(60, 90), 0.35);
  S.drive(o, 1.5);
}, { db: 1, sr: 22050, vars: 2 });

def('teleport_whoosh', 1.4, (S, o) => {
  const d = 1.2;
  S.nz(o, 0, { dur: d, env: [[0, 0], [0.6, 1, 3], [0.62, 0.3], [d, 0]], bp: S.env(d, [[0, 800], [0.6, 6000, 'e'], [d, 1500]]), q: 1.2, a: 0.7 });
  const x = S.fm(d, S.env(d, [[0, 200], [0.6, 1800, 'e'], [d, 300, 'e']]), 1.5, S.env(d, [[0, 3], [d, 0.5]]));
  S.mul(x, S.env(d, [[0, 0], [0.55, 1, 2], [0.65, 0.4], [d, 0]]));
  S.add(o, x, 0, 0.35);
  S.scatter(10, 0.5, 1.0, (t) => S.part(o, t, S.rr(3000, 8000), 0.1, 0.05));
  thud(S, o, 0.6, 200, 60, 0.05, 0.6);
  click(S, o, 0.6, 2500, 0.4, 0.003);
}, { db: -3, vars: 2 });

def('fall_wind', 1.8, (S, o) => {
  const d = 1.6;
  S.nz(o, 0, { dur: d, env: [[0, 0], [0.5, 1, 's'], [d, 0, 's']], bp: S.env(d, [[0, 400], [1, 1200, 'e'], [d, 900]]), q: 0.8, a: 1, color: 'p' });
  S.nz(o, 0, { dur: d, env: [[0, 0], [0.7, 1, 's'], [d, 0, 's']], bp: S.env(d, [[0, 1800], [d, 2600]]), q: 10, a: 0.2 });
  S.mul(o, rsteps(S, d + 0.1, 0.04, 0.6, 1, 30));
}, { db: -5, vars: 2 });

// ======================================================================
// Creatures
// ======================================================================
def('bacteria_click', 0.9, (S, o) => {
  const d = S.rr(0.45, 0.75), r0 = S.rr(25, 40), r1 = S.rr(45, 70);
  let t = 0.005;
  while (t < d) {
    const u = t / d, rate = lerp(r0, r1, Math.sin(Math.PI * u));
    const a = Math.sin(Math.PI * Math.min(1, u * 1.1)) * S.rr(0.5, 1) + 0.05, f = S.rr(1600, 3200);
    modalHit(S, o, t, [[f, S.rr(0.003, 0.007), 1], [f * S.rr(1.6, 2.2), 0.003, 0.5], [S.rr(500, 800), 0.006, 0.6]], 0.0003, 9000, a);
    if (S.chance(0.3)) S.bubble(o, t + 0.002, S.rr(500, 1100), 0.15 * a, { rise: 0.8 });
    t += (1 / rate) * S.rr(0.6, 1.4);
  }
  S.nz(o, 0, { dur: d, env: [[0, 0], [0.05, 1], [d, 0]], bp: 350, q: 2, a: 0.15 });
}, { db: -5, vars: 4 });

def('bacteria_screech', 2.6, (S, o) => {
  const d = S.rr(1.6, 2.3), n = S.n(d), base = S.rr(500, 650);
  // contour: violent onset rise, wavering hold, a 'voice crack' peak, collapsing fall
  const F = S.env(d, [[0, base * 0.5], [0.12, base * 2.4, 0.4], [0.35, base * 1.9, 's'], [d * 0.55, base * 2.0], [d * 0.62, base * 2.8, 0.5], [d * 0.75, base * 2.1, 's'], [d, base * 0.7, 1.6]]);
  let w = 0;
  for (let i = 0; i < n; i++) {
    const t = i / S.sr;
    w = w * 0.9993 + (S.r() - 0.5) * 0.01;
    F[i] *= 1 + (0.03 + 0.05 * Math.min(1, t * 2)) * Math.sin(TAU * 7.8 * t + 2 * Math.sin(TAU * 0.9 * t)) + w;
  }
  const idx = S.env(d, [[0, 1], [0.12, 6], [0.5, 3], [d * 0.62, 6], [d, 1.5]]);
  const x = S.fm(d, F, 1.414, idx), b = S.fm(d, scaleArr(F, 1.059), 2.71, scaleArr(idx, 0.7));
  const sub = S.osc(d, scaleArr(F, 0.5), 'saw');
  S.lp(sub, 1400);
  const fry = S.osc(d, scaleArr(F, 0.25), 'pulse', { pw: 0.2 });
  S.lp(fry, 500);
  const nz = S.noise(d);
  S.bp(nz, 3000, 1.2);
  S.mul(nz, S.env(d, [[0, 1], [0.15, 0.5], [d, 0.8]]));
  for (let i = 0; i < n; i++) x[i] = 0.5 * x[i] + 0.35 * b[i] + 0.3 * sub[i] + 0.2 * fry[i] + 0.35 * nz[i];
  S.eq(x, 'peak', 2800, 2, 7);
  S.eq(x, 'peak', 3700, 3, 5);
  S.drive(x, 2.4);
  S.crush(x, 10, 2);
  // flutter + violent onset spike
  S.mul(x, (t) => 1 + 0.25 * Math.sin(TAU * 13 * t) * Math.min(1, t * 3));
  S.mul(x, S.env(d, [[0, 0], [0.025, 1.25], [0.2, 0.85], [d * 0.62, 1.05], [d - 0.35, 0.8], [d, 0]]));
  S.add(o, x);
}, { db: 0, vars: 3, max: 3 });

def('bacteria_step', 0.6, (S, o) => {
  thud(S, o, 0.002, 85, 42, 0.09, 1);
  S.nz(o, 0.002, { tau: 0.04, lp: 500, a: 0.6 });
  click(S, o, 0.004, S.rr(2000, 3200), 0.6, 0.002, 0.8);
  modalHit(S, o, 0.004, [[S.rr(1100, 1400), 0.015, 1], [S.rr(2500, 2900), 0.01, 0.6]], 0.0006, 8000, 0.5);
  S.nz(o, 0.01, { att: 0.006, tau: 0.05, dur: 0.25, bp: S.env(0.25, [[0, 1000], [0.08, 380, 'e']]), q: 3, a: 0.45 });
  S.scatter(S.ri(2, 4), 0.01, 0.12, (t) => S.bubble(o, t, S.rr(300, 900), S.rr(0.1, 0.3), { rise: 0.8 }));
}, { db: -3, vars: 5, ig: true, max: 6 });

def('bacteria_breath', 2.0, (S, o) => {
  const d1 = S.rr(0.6, 0.8), d2 = S.rr(0.8, 1.1);
  const inh = S.vox(d1, { f0: S.rr(30, 40), jit: 0.25, voice: 0.6, breath: 0.9, vow: [[0, 'uh'], [d1, 'o']], scale: 0.8, tilt: 1500 });
  S.mul(inh, S.env(d1, [[0, 0], [d1 * 0.7, 1, 0.8], [d1, 0]]));
  S.hp(inh, 200);
  S.add(o, inh, 0, 0.7);
  const exh = S.vox(d2, { f0: S.rr(28, 36), jit: 0.3, voice: 0.8, breath: 0.8, vow: [[0, 'a'], [d2, 'uh']], scale: 0.75, tilt: 1200 });
  S.mul(exh, S.env(d2, [[0, 0], [0.08, 1], [d2, 0, 1.5]]));
  S.add(o, exh, d1 + 0.05);
  S.scatter(S.ri(4, 8), d1, d1 + d2, (t) => S.bubble(o, t, S.rr(150, 400), S.rr(0.05, 0.15), { rise: 0.3, d: S.rr(40, 70) }));
}, { db: -6, vars: 3 });

def('bacteria_growl', 2.2, (S, o) => {
  const d = S.rr(1.4, 2.0), f0 = S.rr(55, 75);
  const v = S.vox(d, { f0: S.env(d, [[0, f0 * 0.8], [0.3, f0 * 1.15], [d * 0.7, f0], [d, f0 * 0.7]]), jit: 0.12, voice: 1, breath: 0.5, vow: [[0, 'o'], [d * 0.5, 'a'], [d, 'u']], scale: 0.7, tilt: 1800 });
  S.ring(v, f0 * 0.5, 0.5);
  S.drive(v, 3);
  S.mul(v, S.env(d, [[0, 0], [0.15, 1], [d * 0.8, 0.8], [d, 0]]));
  S.add(o, v);
  S.scatter(S.ri(10, 18), 0.1, d, (t) => S.bubble(o, t, S.rr(120, 350), S.rr(0.08, 0.3), { rise: 0.35, d: S.rr(40, 70) }));
  S.lp(o, 3000);
}, { db: -3, vars: 3 });

def('bacteria_attack', 1.1, (S, o) => {
  const d = 0.75, f0 = S.rr(85, 110);
  const v = S.vox(d, { f0: S.env(d, [[0, f0 * 0.8], [0.1, f0 * 1.6, 0.5], [0.4, f0 * 1.3], [d, f0 * 0.8]]), jit: 0.15, voice: 1, breath: 0.9, vow: [[0, 'a'], [0.3, 'ae'], [d, 'o']], scale: 0.85, tilt: 3000 });
  S.ring(v, f0 * 0.5, 0.4);
  S.drive(v, 5);
  S.mul(v, S.env(d, [[0, 0], [0.03, 1], [0.5, 0.8], [d, 0]]));
  S.add(o, v);
  S.nz(o, 0, { dur: 0.4, env: [[0, 0], [0.15, 1, 2], [0.4, 0]], bp: S.env(0.4, [[0, 500], [0.2, 2000, 'e']]), q: 1, a: 0.4, color: 'p' });
  for (let k = 0; k < 5; k++) modalHit(S, o, k * 0.012, [[S.rr(1800, 3000), 0.004, 1]], 0.0003, 9000, 0.4);
}, { db: 0, vars: 3 });

def('stilllife_scream', 2.2, (S, o) => {
  const d = S.rr(1.5, 1.9), f0 = S.rr(620, 780);
  const F0 = S.env(d, [[0, f0 * 0.7], [0.12, f0 * 1.15, 0.5], [0.6, f0 * 1.25, 's'], [d * 0.8, f0 * 1.1], [d, f0 * 0.6, 1.5]]);
  for (let i = 0; i < F0.length; i++) { const t = i / S.sr; F0[i] *= 1 + 0.03 * Math.sin(TAU * 6.5 * t) + 0.02 * Math.sin(TAU * 13.3 * t); }
  const v = S.vox(d, { f0: F0, jit: 0.04, voice: 1, breath: 0.35, vow: [[0, 'a'], [d * 0.5, 'ae'], [d, 'ee']], scale: 1.35, tilt: 5000, gains: [1, 0.9, 0.6, 0.4] });
  S.ring(v, 147, 0.35);
  S.drive(v, 3.5);
  S.crush(v, 9, 3);
  S.mul(v, S.env(d, [[0, 0], [0.06, 1], [d * 0.85, 0.8], [d, 0]]));
  S.add(o, v);
  const g = S.speed(v, 0.5, d);
  S.lp(g, 1200);
  S.add(o, g, 0.04, 0.25);
}, { db: 0, vars: 3, max: 3 });

def('stilllife_crawl', 1.4, (S, o) => {
  let t = 0.01;
  while (t < 1.2) {
    for (let k = 0, b = S.ri(3, 6); k < b && t < 1.25; k++) {
      const gd = S.rr(0.02, 0.06), x = S.noise(gd);
      S.mul(x, rsteps(S, gd, 1 / S.rr(200, 600), 0, 1, 3000));
      const y = S.modal(x, [[S.rr(1500, 2500), 0.01, 1], [S.rr(3000, 5000), 0.008, 0.6]], gd + 0.03);
      S.norm(y, 1);
      S.mul(y, S.env(gd + 0.03, [[0, 0], [0.003, 1], [gd, 0.6], [gd + 0.03, 0]]));
      S.add(o, y, t, S.rr(0.3, 0.8));
      if (S.chance(0.5)) impact(S, o, t, 'wood', 0.3, 0.5, S.rr(0.15, 0.4));
      t += S.rr(0.035, 0.07);
    }
    t += S.rr(0.08, 0.2);
  }
}, { db: -6, vars: 4 });

def('stilllife_giggle', 1.6, (S, o) => {
  let t = 0.01, f = S.rr(520, 650);
  for (let k = 0, n = S.ri(4, 6); k < n; k++) {
    const d = S.rr(0.08, 0.11);
    const h = S.vox(0.04, { voice: 0, breath: 1, vow: [[0, 'i']], scale: 1.3 });
    S.mul(h, S.env(0.04, [[0, 0], [0.02, 1], [0.04, 0.3]]));
    S.add(o, h, t, 0.3);
    const v = S.vox(d, { f0: S.env(d, [[0, f * 1.08], [d, f * 0.9]]), voice: 1, breath: 0.25, vow: [[0, 'i'], [d, 'ee']], scale: 1.3, jit: 0.02, tilt: 3500 });
    S.mul(v, S.env(d, [[0, 0], [0.012, 1], [d * 0.6, 0.8], [d, 0]]));
    S.add(o, v, t + 0.03);
    t += d + S.rr(0.04, 0.07);
    f *= S.rr(0.92, 0.97);
  }
  const d = 0.3, v = S.vox(d, { f0: S.env(d, [[0, f * 0.8], [d, f * 0.5]]), voice: 1, breath: 0.3, vow: [[0, 'i'], [d, 'uh']], scale: 1.2, jit: 0.04 });
  S.mul(v, S.env(d, [[0, 0], [0.02, 1], [d, 0]]));
  S.add(o, v, t + 0.05, 0.8);
  S.ring(o, 90, 0.15);
}, { db: -4, vars: 3 });

def('rat_squeak', 0.5, (S, o) => {
  let t = 0.005;
  for (let k = 0, n = S.ri(2, 3); k < n; k++) {
    const d = S.rr(0.04, 0.09), f = S.rr(3200, 4800);
    S.tone(o, t, { f, f1: f * S.rr(0.7, 1.25), gt: d * 0.4, wave: 'tri', dur: d, env: [[0, 0], [0.006, 1], [d * 0.7, 0.7], [d, 0]], vib: [S.rr(40, 70), 0.04] });
    t += d + S.rr(0.03, 0.08);
  }
  S.nz(o, 0, { dur: t, env: [[0, 0], [0.03, 1], [t, 0]], bp: 5000, q: 0.6, a: 0.1 });
}, { db: -10, vars: 4 });

def('roach_scuttle', 0.7, (S, o) => {
  const d = S.rr(0.35, 0.6);
  const c = S.crackle(d, S.env(d, [[0, 40], [d * 0.3, 160], [d, 30]]), { w: 0.00012, ap: 1.5, min: 0.2 });
  S.bp(c, 6000, 0.7);
  S.norm(c, 1);
  S.mul(c, S.env(d, [[0, 0], [0.05, 1], [d * 0.7, 0.8], [d, 0]]));
  S.add(o, c);
  S.nz(o, 0, { dur: d, env: [[0, 0], [0.1, 1], [d, 0]], bp: 4000, q: 0.5, a: 0.06 });
}, { db: -13, vars: 4 });

def('whisper', 3.2, (S, o) => {
  const [L, R] = o, VW = ['a', 'e', 'i', 'o', 'u', 'uh', 'er'];
  const p0 = S.rr(-1, 1), p1 = S.rr(-1, 1), n = S.ri(6, 11);
  let t = 0.05;
  for (let k = 0; k < n && t < 2.8; k++) {
    const sd = S.rr(0.1, 0.22);
    const syl = S.vox(sd + 0.05, { voice: 0, breath: 1, vow: [[0.05, S.pick(VW)], [sd, S.pick(VW)]], scale: S.rr(0.95, 1.15), gains: [0.7, 1, 0.8, 0.5] });
    S.mul(syl, S.env(sd + 0.05, [[0, 0], [0.05, 0], [0.05 + sd * 0.25, 1], [sd + 0.05, 0, 1.5]]));
    if (S.chance(0.6)) {
      const cs = S.noise(0.05);
      S.hp(cs, S.pick([3000, 4500, 6000]));
      S.mul(cs, S.ad(0.05, 0.005, 0.015));
      S.norm(cs, S.peak(syl) * 0.6);
      S.add(syl, cs);
    }
    S.pan(o, syl, t, S.rr(0.6, 1), lerp(p0, p1, k / n));
    t += sd + (S.chance(0.25) ? S.rr(0.15, 0.35) : S.rr(0.01, 0.05));
  }
  for (const [c, s] of [[L, 1], [R, 1.07]]) { S.hp(c, 400); S.verb(c, 1.2, 0.3, 0.4, s); }
}, { db: -9, stereo: true, live: true });

def('fake_footsteps', 3.2, (S, o) => {
  const surf = S.pick(['hard', 'carpet', 'concrete']), n = S.ri(4, 7), iv = S.rr(0.32, 0.5), approach = S.chance(0.5);
  for (let k = 0; k < n; k++) {
    const a = approach ? lerp(0.35, 1, k / n) : lerp(1, 0.3, k / n);
    const x = S.buf(0.6);
    step(S, x, surf, S.rr(0.5, 0.8));
    S.add(o, x, 0.02 + k * iv * S.rr(0.95, 1.05), a);
  }
  S.lp(o, 1400);
  S.verb(o, 1.6, 0.45, 0.4);
}, { db: -11, live: true });

def('splash', 1.4, (S, o) => {
  S.nz(o, 0, { att: 0.001, tau: 0.012, bp: 1800, q: 0.6, a: 0.8 });
  S.nz(o, 0, { att: 0.005, tau: 0.15, lp: 4000, hp: 300, a: 0.7 });
  thud(S, o, 0, 120, 60, 0.05, 0.5);
  S.scatter(S.ri(20, 35), 0.005, 0.4, (t) => S.bubble(o, t, S.rr(300, 2200), S.rr(0.08, 0.35), { rise: S.rr(0.1, 0.6) }), 1.8);
  S.scatter(S.ri(8, 14), 0.25, 1.0, (t) => S.bubble(o, t, S.rr(1200, 3500), S.rr(0.04, 0.15), { rise: 0.5 }));
}, { db: -4, vars: 3 });

def('drip', 0.25, (S, o) => {
  click(S, o, 0.001, 4000, 0.15, 0.0008);
  S.bubble(o, 0.002, S.rr(900, 2000), 1, { rise: S.rr(0.35, 0.8), d: S.rr(45, 80) });
}, { db: -10, vars: 6, clean: true });

def('water_splash_big', 3.0, (S, o) => {
  thud(S, o, 0, 90, 45, 0.12, 1);
  S.nz(o, 0, { att: 0.002, tau: 0.02, bp: 1500, q: 0.5, a: 0.9 });
  S.nz(o, 0, { att: 0.01, tau: 0.35, lp: 3000, hp: 200, a: 0.9 });
  S.scatter(70, 0.01, 0.8, (t) => S.bubble(o, t, S.rr(200, 1800), S.rr(0.1, 0.4), { rise: S.rr(0.1, 0.6) }), 1.8);
  S.scatter(40, 0.4, 2.6, (t, u) => S.bubble(o, t, S.rr(1000, 3800), S.rr(0.05, 0.2) * (1 - u * 0.7), { rise: 0.5 }), 1.3);
  S.nz(o, 0.3, { dur: 2, env: [[0, 0], [0.2, 1], [2, 0, 2]], bp: 2500, q: 0.5, a: 0.12 });
}, { db: -1, vars: 2 });

def('paper', 0.7, (S, o) => {
  const d = S.rr(0.35, 0.55);
  const c = S.crackle(d, S.env(d, [[0, 100], [d * 0.4, 700], [d, 50]]), { w: 0.0005, ap: 2, min: 0.1 });
  S.bp(c, 3500, 0.5);
  S.norm(c, 1);
  S.add(o, c, 0, 0.7);
  S.nz(o, 0, { dur: d, env: [[0, 0], [d * 0.3, 1, 's'], [d, 0, 's']], bp: 2500, q: 0.6, a: 0.4 });
}, { db: -10, vars: 4 });

def('thunk', 0.6, (S, o) => {
  impact(S, o, 0.001, 'wood', 0.7, 1.6, 1);
  thud(S, o, 0.001, 110, 70, 0.05, 0.6);
}, { db: -4, vars: 4, ig: true });

// ======================================================================
// Healthity (cute floating medical robot)
// ======================================================================
def('healthity_talk', (p) => clamp(p.len ?? 1.5, 0.2, 12) + 0.3, (S, o, p) => {
  const L = clamp(p.len ?? 1.5, 0.2, 12), base = S.rr(620, 720), sc = [0, 2, 4, 7, 9, 12];
  let t = 0.01, wl = S.ri(2, 5);
  while (t < L) {
    const d = S.rr(0.055, 0.085), semi = S.pick(sc) + (t > L - 0.35 ? 5 : 0), f = base * 2 ** (semi / 12);
    const F = VOWELS[S.pick(['a', 'e', 'i', 'o', 'u'])];
    const x = S.osc(d, S.env(d, [[0, f * 1.06], [d, f * 0.97]]), 'pulse', { pw: 0.25 });
    const y = S.bp(x.slice(), F[0] * 1.6, 2), z = S.bp(x, F[1] * 1.3, 3);
    for (let i = 0; i < y.length; i++) y[i] = y[i] + 0.7 * z[i] + 0.15 * x[i];
    S.mul(y, S.env(d, [[0, 0], [0.006, 1], [d * 0.6, 0.8], [d, 0]]));
    S.add(o, y, t);
    t += d + S.rr(0.008, 0.02);
    if (--wl <= 0) { t += S.rr(0.06, 0.14); wl = S.ri(2, 5); }
  }
  S.crush(o, 8, 2);
}, { db: -7, live: true, jit: 0 });

def('healthity_alert', 1.1, (S, o) => {
  for (let k = 0; k < 6; k++) {
    const f = k % 2 ? 1568 : 1175;
    S.tone(o, k * 0.1, { f, f1: f * 1.03, gt: 0.03, wave: 'tri', att: 0.004, hold: 0.05, tau: 0.015, a: 0.8 });
    S.part(o, k * 0.1, f * 2, 0.15, 0.03);
  }
  S.tone(o, 0.62, { f: 1400, f1: 500, gt: 0.12, wave: 'sq', att: 0.01, hold: 0.15, tau: 0.08, a: 0.35, lp: 3000 });
}, { db: -7, clean: true, jit: 5 });

def('healthity_happy', 0.8, (S, o) => {
  const base = S.rr(880, 990);
  [0, 4, 7, 12].forEach((s, k) => S.tone(o, k * 0.06, { f: base * 2 ** ((s - 1) / 12), f1: base * 2 ** (s / 12), gt: 0.015, wave: 'tri', att: 0.003, tau: 0.06, hold: 0.02, a: 0.8 }));
  for (let k = 0; k < 5; k++) S.part(o, 0.26 + k * 0.035, base * 4 * 2 ** (S.pick([0, 4, 7]) / 12), 0.2, 0.05);
}, { db: -7, clean: true, jit: 10 });

// Healthity MK-VII (old unit): thermal receipt printer, CRT boot, repair minigame, tool charging
def('hl_print', 2.7, (S, o) => {
  const d = 2.4;
  // stepper motor: a buzzy pulse train that stutters line by line
  const m = S.osc(d, (t) => 210 + 30 * Math.sin(TAU * 1.3 * t), 'pulse', { pw: 0.18 });
  S.bp(m, 1400, 1.2);
  S.mul(m, rsteps(S, d, 0.045, 0.25, 1, 400));
  S.mul(m, S.env(d, [[0, 0], [0.04, 1], [d - 0.08, 1], [d, 0]]));
  S.norm(m, 0.5);
  S.add(o, m, 0.02);
  const h = S.noise(d); S.bp(h, 5200, 2); S.mul(h, S.env(d, [[0, 0], [0.1, 1], [d - 0.1, 1], [d, 0]])); S.norm(h, 0.12); S.add(o, h, 0.02);
  for (let t = 0.05; t < d; t += S.rr(0.07, 0.12)) click(S, o, t, S.rr(2500, 4200), S.rr(0.15, 0.35), 0.002, 1.4);
}, { db: -9, vars: 2 });
def('hl_tear', 0.5, (S, o) => {
  const d = S.rr(0.22, 0.32), x = S.noise(d);
  S.mul(x, rsteps(S, d, 0.004, 0.1, 1, 700));
  S.bp(x, S.env(d, [[0, 1800], [d, 4200, 'e']]), 0.8);
  S.mul(x, S.env(d, [[0, 0], [0.015, 1], [d, 0, 0.5]]));
  S.norm(x, 1);
  S.add(o, x, 0.005);
  click(S, o, d, 3000, 0.5, 0.003);
}, { db: -9, vars: 3 });
def('hl_boot', 3.2, (S, o) => {
  // relay clunk, degauss "bwong", 15 kHz-ish CRT whine, fan spin-up, an old detuned three-note chime
  thud(S, o, 0, 140, 55, 0.07, 1);
  click(S, o, 0.002, 1800, 0.6, 0.004);
  const dg = S.osc(1.6, 50, 'saw'); S.lp(dg, 500);
  S.mul(dg, S.env(1.6, [[0, 0], [0.04, 1], [1.6, 0.001, 'e']]));
  S.mul(dg, (t) => 1 + 0.5 * Math.sin(TAU * 9 * t));
  S.add(o, dg, 0.05, 0.6);
  const w = S.osc(2.8, S.env(2.8, [[0, 2000], [0.8, 9400, 'e'], [2.8, 9800]]));
  S.mul(w, S.env(2.8, [[0, 0], [0.5, 0.25], [2.4, 0.2], [2.8, 0]]));
  S.add(o, w, 0.2, 0.06);
  const f = S.noise(2.6); S.bp(f, S.env(2.6, [[0, 150], [1.6, 900, 'e'], [2.6, 1000]]), 1.5);
  S.mul(f, S.env(2.6, [[0, 0], [1.2, 1], [2.6, 0.6]])); S.mul(f, (t) => 0.8 + 0.2 * Math.sin(TAU * 31 * t)); S.norm(f, 0.25); S.add(o, f, 0.3);
  [0, 7, 4].forEach((s, k) => S.tone(o, 1.5 + k * 0.22, { f: 523 * 2 ** (s / 12) * S.j(1, 0.012), wave: 'sq', att: 0.004, hold: 0.12, tau: 0.12, a: 0.22, lp: 2200 }));
}, { db: -6, vars: 1 });
def('hl_short', 0.9, (S, o) => {
  S.add(o, arc(S, 0.32, 2.4), 0, 1);
  const b = S.osc(0.4, 100, 'sq'); S.lp(b, 900); S.mul(b, S.env(0.4, [[0, 1], [0.4, 0, 0.5]])); S.norm(b, 0.6); S.add(o, b);
  S.nz(o, 0, { tau: 0.02, hp: 1200, a: 1 });
  thud(S, o, 0, 220, 70, 0.04, 0.7);
  for (let k = 0; k < 4; k++) click(S, o, 0.32 + k * S.rr(0.04, 0.09), S.rr(2000, 5000), S.rr(0.2, 0.5), 0.002);
}, { db: -5, vars: 3 });
def('hl_zap', 0.3, (S, o) => {
  const x = arc(S, S.rr(0.12, 0.2), 1.4); S.add(o, x, 0, 0.8);
  const s = S.noise(0.2); S.hp(s, 4000); S.mul(s, S.env(0.2, [[0, 0], [0.01, 1], [0.2, 0, 0.6]])); S.norm(s, 0.3); S.add(o, s);
}, { db: -10, vars: 5 });
def('hl_charge', 2.2, (S, o) => {
  const d = 1.9, h = S.osc(d, S.env(d, [[0, 120], [d, 520, 'e']]), 'saw');
  S.lp(h, 1800); S.mul(h, (t) => 0.75 + 0.25 * Math.sin(TAU * 60 * t));
  S.mul(h, S.env(d, [[0, 0], [0.2, 0.8], [d - 0.15, 1], [d, 0]])); S.norm(h, 0.45); S.add(o, h);
  const c = S.crackle(d, S.env(d, [[0, 80], [d, 500]]), { w: 0.0003, hp: 3000 }); S.norm(c, 0.25); S.add(o, c);
  S.tone(o, d - 0.05, { f: 1568, wave: 'tri', att: 0.003, tau: 0.25, a: 0.5 });
  S.tone(o, d + 0.07, { f: 2093, wave: 'tri', att: 0.003, tau: 0.3, a: 0.4 });
}, { db: -8, vars: 2 });
def('hl_knock', 1.2, (S, o) => {
  // something knocking from inside a crate: two or three muffled knocks
  const n = S.ri(2, 3);
  for (let k = 0; k < n; k++) { const t = k * S.rr(0.16, 0.28); thud(S, o, t, S.rr(120, 160), 70, 0.05, 1); impact(S, o, t, 'wood', 0.35, 1.4, 0.4); }
  S.lp(o, 1400);
}, { db: -6, vars: 3 });
def('hl_dying', 1.6, (S, o) => {
  const d = 1.3, w = S.osc(d, S.env(d, [[0, 900], [d, 90, 'e']]), 'sq');
  S.lp(w, 1600); S.mul(w, S.env(d, [[0, 0], [0.02, 1], [d, 0, 0.7]])); S.mul(w, rsteps(S, d, 0.03, 0.3, 1, 200)); S.norm(w, 0.4); S.add(o, w);
  S.crush(o, 6, 3);
  S.add(o, arc(S, 0.15, 1), 0.02, 0.4);
}, { db: -8, vars: 2 });

// ======================================================================
// Internal event material for loops (names start with '_', not listed publicly)
// ======================================================================
def('_arc_pop', 0.35, (S, o) => {
  const x = arc(S, S.rr(0.06, 0.15), 2);
  S.add(o, x);
  click(S, o, 0, S.rr(1500, 3000), 1, 0.004, 0.6);
}, { db: -8, vars: 4 });
def('_amb_creak', 3.0, (S, o) => { creak(S, o, 0.05, S.rr(0.6, 1.4), S.rr(80, 200), S.rr(60, 180), 1, 0.6); distant(S, o, S.rr(900, 2000)); }, { vars: 4, db: -6, sr: 22050 });
def('_amb_knock', 3.0, (S, o) => {
  const n = S.ri(1, 3), dt = S.rr(0.25, 0.45);
  for (let k = 0; k < n; k++) impact(S, o, 0.02 + k * dt * S.rr(0.9, 1.1), 'wood', 0.7, 1.5, 1);
  distant(S, o, S.rr(700, 1400));
}, { vars: 4, db: -6, sr: 22050 });
def('_amb_thud', 3.5, (S, o) => { impact(S, o, 0.02, 'heavy', S.rr(0.6, 1), 1, 1); distant(S, o, 500, 2.8, 0.6); }, { vars: 3, db: -4, sr: 22050 });
def('_amb_groan', 5.0, (S, o) => { groan(S, o, 0.1, S.rr(2, 3.5), S.rr(45, 80), 1); distant(S, o, 1200, 3, 0.5); }, { sr: 22050, vars: 3, db: -6 });
def('_amb_door', 3.0, (S, o) => {
  impact(S, o, 0.02, 'heavy', 0.8, 1, 1);
  impact(S, o, 0.025, 'wood', 0.9, 1.8, 0.7);
  impact(S, o, 0.04, 'metal', 0.5, 0.8, 0.3);
  distant(S, o, 800, 2.5, 0.6);
}, { vars: 3, db: -5, sr: 22050 });
def('_amb_vent', 2.5, (S, o) => {
  S.scatter(S.ri(3, 6), 0.02, 0.9, (t) => impact(S, o, t, 'metal', S.rr(0.3, 0.7), S.rr(0.8, 1.6), S.rr(0.4, 1)));
  distant(S, o, 2500, 1.5, 0.4);
}, { vars: 4, db: -8, sr: 22050 });
def('_amb_buzz', 1.5, (S, o) => {
  const x = arc(S, 0.2, 1.5);
  S.add(o, x, 0.02);
  const b = S.osc(0.6, 120, 'saw');
  S.bp(b, 2000, 1);
  S.mul(b, S.env(0.6, [[0, 0], [0.02, 1], [0.6, 0, 2]]));
  S.norm(b, 0.4);
  S.add(o, b, 0.02);
  distant(S, o, 3000, 1.2, 0.35);
}, { vars: 3, db: -9, sr: 22050 });
def('_amb_scream', 4, (S, o) => {
  const d = S.rr(1.0, 1.6), f0 = S.rr(380, 520);
  const v = S.vox(d, { f0: S.env(d, [[0, f0 * 0.8], [0.15, f0 * 1.2], [d, f0 * 0.6, 1.5]]), jit: 0.05, breath: 0.4, vow: [[0, 'a'], [d, 'o']], scale: 1.1, tilt: 4000 });
  S.mul(v, S.env(d, [[0, 0], [0.08, 1], [d, 0]]));
  S.add(o, v, 0.1);
  distant(S, o, 900, 3.2, 0.75);
}, { vars: 2, db: -10, sr: 22050 });
def('_printer', 3.5, (S, o) => {
  const d = 2.6, m = S.osc(d, 140, 'saw');
  S.bp(m, 900, 1.5);
  S.mul(m, (t) => 0.7 + 0.3 * Math.sin(TAU * 3 * t));
  S.mul(m, S.env(d, [[0, 0], [0.1, 1], [d - 0.1, 1], [d, 0]]));
  S.norm(m, 0.4);
  S.add(o, m, 0.05);
  for (let t = 0.1; t < d; t += S.rr(0.08, 0.2)) modalHit(S, o, t + 0.05, [[S.rr(1200, 2400), 0.015, 1], [S.rr(3000, 4000), 0.008, 0.4]], 0.001, 6000, S.rr(0.2, 0.5));
  S.nz(o, 0.05, { dur: d, env: [[0, 0], [0.3, 1], [d, 0]], bp: 3000, q: 0.5, a: 0.15 });
  distant(S, o, 1800, 1.4, 0.45);
}, { vars: 2, db: -10, sr: 22050 });
def('_uncanny', 4.5, (S, o) => {
  const d = 4, f = S.rr(300, 600);
  const x = S.osc(d, f), y = S.osc(d, f * 1.029);
  for (let i = 0; i < x.length; i++) x[i] += y[i];
  S.mul(x, S.env(d, [[0, 0], [2.5, 1, 's'], [d, 0, 's']]));
  S.add(o, x);
  S.verb(o, 2.5, 0.5, 0.4, 1.2);
}, { vars: 2, db: -16, clean: true, sr: 22050 });
def('_tear', 1.6, (S, o) => {
  const d = S.rr(0.8, 1.3), x = S.noise(d);
  S.mul(x, rsteps(S, d, 0.003, 0, 1, 900));
  S.bp(x, S.env(d, [[0, 600], [d, 2500, 'e']]), 0.7);
  S.mul(x, S.env(d, [[0, 0], [0.05, 1], [d, 0, 0.6]]));
  S.norm(x, 1);
  S.add(o, x);
  groan(S, o, 0, d, S.rr(50, 80), 0.5);
  S.drive(o, 2);
}, { vars: 3, db: -5 });
def('_boom', 3.0, (S, o) => {
  thud(S, o, 0, 70, 28, 0.6, 1);
  S.nz(o, 0, { att: 0.005, tau: 0.5, lp: 180, a: 0.8, color: 'b' });
  S.nz(o, 0, { tau: 0.1, lp: 900, a: 0.3 });
  S.drive(o, 1.6);
  S.verb(o, 2.5, 0.35, 0.6, 1.5);
}, { vars: 3, db: -2, sr: 22050 });
def('_crack', 1.0, (S, o) => {
  click(S, o, 0, S.rr(600, 1400), 1, 0.01, 0.6);
  S.nz(o, 0, { tau: 0.06, lp: 2000, a: 0.6 });
  thud(S, o, 0, 90, 40, 0.1, 0.7);
  S.verb(o, 1.8, 0.3, 0.5, 1.2);
}, { vars: 3, db: -4 });
def('_squelch', 0.5, (S, o) => {
  S.nz(o, 0, { att: 0.01, tau: 0.06, dur: 0.3, bp: S.env(0.3, [[0, 900], [0.15, 300, 'e']]), q: 4, a: 0.7 });
  S.scatter(S.ri(2, 4), 0, 0.15, (t) => S.bubble(o, t, S.rr(200, 700), S.rr(0.2, 0.5), { rise: 0.5, d: S.rr(35, 60) }));
}, { vars: 4, db: -10 });
def('_gurgle', 1.6, (S, o) => {
  S.scatter(S.ri(8, 15), 0.02, 1.2, (t) => S.bubble(o, t, S.rr(150, 600), S.rr(0.2, 0.8), { rise: S.rr(0.2, 0.5), d: S.rr(35, 60) }), 1.3);
  S.lp(o, 2000);
}, { vars: 3, db: -12 });
def('_tick_small', 0.2, (S, o) => impact(S, o, 0.001, 'plastic', 0.4, 0.4, 1), { vars: 3, db: -16 });
def('_lub', 0.4, (S, o) => heartThump(S, o, 0.005, 52, 1, 0.07), { vars: 2, db: -4, jit: 8 });
def('_dub', 0.35, (S, o) => heartThump(S, o, 0.005, 62, 1, 0.055), { vars: 2, db: -7, jit: 8 });
def('_inhale', 1.0, (S, o, p) => S.add(o, breathPart(S, true, p.i > 0.5 ? 0.42 : 0.8, p.i)), { tiers: [0, 1], vars: 3, db: -12 });
def('_exhale', 1.1, (S, o, p) => S.add(o, breathPart(S, false, p.i > 0.5 ? 0.5 : 0.95, p.i)), { tiers: [0, 1], vars: 3, db: -12 });

// ======================================================================
// HQ elevator, the android receptionist and the ride between dimensions
// ======================================================================
// brass scissor gate folding/unfolding: dense link rattle, track scrape, latch clank
def('elev_gate', 1.4, (S, o) => {
  const d = S.rr(0.7, 0.9);
  S.scatter(48, 0, d, (t, u) => modalHit(S, o, t, [[S.rr(1700, 3300), S.rr(0.02, 0.05), 1], [S.rr(3600, 5600), 0.018, 0.5], [S.rr(650, 1100), 0.04, 0.45]], 0.0004, 9000, S.rr(0.15, 0.55) * (0.45 + 0.55 * Math.sin(Math.PI * u))));
  S.nz(o, 0, { dur: d, env: [[0, 0], [0.08, 1], [d - 0.1, 0.8], [d, 0]], bp: 1500, q: 0.8, a: 0.22 });
  creak(S, o, 0.04, d * 0.9, S.rr(260, 340), S.rr(200, 280), 0.25, 1.2);
  impact(S, o, d + 0.02, 'metal', 0.95, 0.55, 0.9);
  click(S, o, d + 0.025, 3500, 0.5, 0.002);
  thud(S, o, d + 0.02, 170, 90, 0.05, 0.45);
}, { db: -3, vars: 3 });

// heavy landing doors sliding on rollers, motor whir, end stop
def('elev_doors', 1.7, (S, o) => {
  const d = S.rr(0.95, 1.1);
  const whir = S.osc(d, S.env(d, [[0, 85], [0.2, 140, 's'], [d - 0.2, 135], [d, 80, 's']]), 'saw');
  S.lp(whir, 650);
  S.mul(whir, S.env(d, [[0, 0], [0.1, 1], [d - 0.1, 0.9], [d, 0]]));
  S.norm(whir, 1);
  S.add(o, whir, 0, 0.14);
  S.nz(o, 0, { dur: d, env: [[0, 0], [0.15, 1], [d - 0.1, 0.9], [d, 0]], lp: 360, a: 0.5, color: 'b' });
  S.scatter(9, 0.05, d - 0.1, (t) => click(S, o, t, S.rr(1400, 2600), S.rr(0.04, 0.11), 0.002));
  impact(S, o, d, 'metal', 0.75, 1.7, 0.75);
  thud(S, o, d, 110, 55, 0.12, 0.9);
}, { db: -4, vars: 2 });

// hoist motor: brake release clunk, rising electric whine, rumble, structural groan
def('elev_motor', 3.4, (S, o) => {
  const d = 3.2;
  impact(S, o, 0, 'metal', 1, 1.8, 0.9);
  thud(S, o, 0, 90, 45, 0.15, 1);
  const f = S.env(d, [[0, 40], [1.4, 210, 's'], [d, 250]]);
  const w = S.osc(d, f, 'saw');
  S.bp(w, 900, 0.7);
  const h = S.osc(d, scaleArr(f, 2), 'sin');
  for (let i = 0; i < w.length; i++) w[i] = 0.6 * w[i] + 0.5 * h[i];
  S.mul(w, S.env(d, [[0, 0], [0.3, 0.6], [1.5, 1], [d - 0.3, 0.9], [d, 0]]));
  S.norm(w, 1);
  S.add(o, w, 0.05, 0.35);
  S.nz(o, 0, { dur: d, env: [[0, 0], [0.4, 1], [d, 0.7]], lp: 160, a: 0.7, color: 'b' });
  groan(S, o, 0.3, 1.6, S.rr(70, 100), 0.25);
}, { db: -2, vars: 1 });

// hoist cable twang: a long steel string plucked by the load
def('elev_cable', 2.4, (S, o) => {
  const f = S.rr(48, 72);
  S.bell(o, 0.01, f, [[1, 1, 1.2], [2.01, 0.6, 0.9], [3.03, 0.4, 0.6], [4.07, 0.3, 0.4], [5.6, 0.2, 0.3], [7.9, 0.12, 0.2]], 0.8);
  const x = S.fm(1.6, S.env(1.6, [[0, f * 3], [1.6, f * 2.6, 'e']]), 1.5, S.env(1.6, [[0, 4], [1.6, 0.5]]));
  S.mul(x, S.ad(1.6, 0.002, 0.4));
  S.add(o, x, 0.01, 0.3);
  creak(S, o, 0.2, 1.2, S.rr(60, 90), S.rr(40, 70), 0.5, 0.5);
  S.verb(o, 2.2, 0.35, 0.5, 1.6);
}, { db: -3, vars: 3 });

// emergency brakes: shoe screech on the rails, then the slam
def('elev_brake', 2.4, (S, o) => {
  const d = 1.2;
  friction(S, o, 0, d, S.env(d, [[0, 950], [d, 380, 's']]), [[S.rr(1800, 2400), 0.02, 1], [S.rr(3200, 4000), 0.015, 0.7], [S.rr(5200, 6400), 0.01, 0.4]], 0.9, 0.04);
  S.nz(o, 0, { dur: d, env: [[0, 0], [0.05, 1], [d, 0.4]], bp: 3000, q: 2, a: 0.3 });
  impact(S, o, d, 'metal', 1, 2.2, 1);
  thud(S, o, d, 80, 35, 0.25, 1);
  S.nz(o, d, { tau: 0.2, lp: 500, a: 0.6, color: 'b' });
  S.drive(o, 1.4);
}, { db: -1, vars: 2 });

// the car rattling in its guide rails at speed (re-triggered while travelling)
def('elev_rattle', 2.0, (S, o) => {
  const d = 1.9;
  S.nz(o, 0, { dur: d, env: [[0, 0], [0.25, 1], [d - 0.3, 1], [d, 0]], lp: 220, a: 0.8, color: 'b' });
  S.nz(o, 0, { dur: d, env: [[0, 0], [0.3, 1], [d - 0.3, 1], [d, 0]], bp: 900, q: 0.6, a: 0.22, color: 'p' });
  S.scatter(40, 0.05, d - 0.1, (t) => modalHit(S, o, t, [[S.rr(500, 1400), S.rr(0.02, 0.06), 1], [S.rr(1800, 3000), 0.02, 0.5]], 0.0006, 6000, S.rr(0.1, 0.4)));
  S.mul(o, rsteps(S, d + 0.1, 0.03, 0.6, 1, 40));
}, { db: -5, vars: 3, sr: 22050 });

// android neck servo: a short geared whine
def('android_servo', 0.5, (S, o) => {
  const d = S.rr(0.18, 0.32);
  const f = S.env(d, [[0, S.rr(900, 1300)], [d, S.rr(500, 800), 's']]);
  const x = S.osc(d, f, 'sq');
  S.bp(x, 2200, 1.2);
  S.mul(x, S.env(d, [[0, 0], [0.02, 1], [d - 0.03, 0.8], [d, 0]]));
  S.mul(x, rsteps(S, d, 0.004, 0.5, 1, 400));
  S.norm(x, 1);
  S.add(o, x, 0, 0.5);
  S.scatter(6, 0, d, (t) => click(S, o, t, S.rr(3000, 5000), 0.12, 0.0008));
}, { db: -14, vars: 3 });

// a distant, detuned music box in an empty hotel corridor
def('music_box', 4.2, (S, o) => {
  const notes = [0, 3, 7, 12, 10, 7, 3, 5], base = S.rr(880, 990), det = S.rr(0.985, 0.995);
  notes.forEach((n, i) => {
    const t = 0.05 + i * S.rr(0.36, 0.42) * (1 + i * 0.04);
    S.bell(o, t, base * 2 ** (n / 12) * (i % 3 === 2 ? det : 1), [[1, 1, 0.9], [3.01, 0.25, 0.35], [5.4, 0.08, 0.15], [2.0, 0.05, 0.5]], 0.5);
  });
  distant(S, o, 3000, 2.8, 0.55);
}, { db: -9, vars: 2, clean: true });

// crickets in a moonlit field
def('crickets', 3.2, (S, o) => {
  const f = S.rr(4200, 4900);
  for (let c = 0; c < 3; c++) {
    const ff = f * S.rr(0.92, 1.08), period = S.rr(0.32, 0.5), pan = S.rr(0.4, 1);
    for (let t = S.rr(0, 0.3); t < 3.0; t += period) {
      for (let k = 0; k < 4; k++) S.part(o, t + k * 0.018, ff, 0.25 * pan, 0.008, 0.002);
    }
  }
  S.lp(o, 7000);
}, { db: -14, vars: 2, clean: true });

// the void between dimensions: a deep beating drone with a reversed swell
def('void_drone', 4.5, (S, o) => {
  const d = 4.2;
  const a = S.osc(d, 41, 'sin'), b = S.osc(d, 43.3, 'sin'), c = S.osc(d, 82.5, 'tri');
  for (let i = 0; i < a.length; i++) a[i] = a[i] + b[i] + 0.3 * c[i];
  S.mul(a, S.env(d, [[0, 0], [1.2, 1, 's'], [d - 0.8, 0.9], [d, 0, 's']]));
  S.norm(a, 1);
  S.add(o, a, 0, 0.8);
  S.nz(o, 0, { dur: d, env: [[0, 0], [d * 0.7, 1, 2], [d, 0]], bp: S.env(d, [[0, 300], [d, 2400, 'e']]), q: 3, a: 0.25 });
  S.verb(o, 3.5, 0.5, 0.4, 1.8);
}, { db: -4, vars: 1, sr: 22050 });

// ======================================================================
// Hounds, Smilers, Partygoers; distorter field, wheel trolley (game/creatures/*, game/basecamp.js)
// ======================================================================
// ragged, too-human panting
def('hound_pant', 1.2, (S, o) => {
  let t = 0.01;
  for (let k = 0, n = S.ri(4, 6); k < n; k++) {
    const d = S.rr(0.08, 0.12);
    const v = S.vox(d, { f0: S.rr(85, 120), voice: 0.3, breath: 1, vow: [[0, k % 2 ? 'ae' : 'a'], [d, 'uh']], scale: 0.85, jit: 0.25, tilt: 2600 });
    S.mul(v, S.env(d, [[0, 0], [0.012, 1], [d * 0.6, 0.7], [d, 0]]));
    S.add(o, v, t, k % 2 ? 0.65 : 1);
    if (S.chance(0.4)) S.bubble(o, t + d * 0.5, S.rr(500, 1100), 0.15, { rise: 0.5 });
    t += d + S.rr(0.025, 0.055);
  }
  S.hp(o, 250);
}, { db: -9, vars: 4, max: 4 });

// low wet growl with teeth chatter
def('hound_snarl', 1.6, (S, o) => {
  const d = S.rr(0.9, 1.3), f0 = S.rr(62, 80);
  const v = S.vox(d, { f0: S.env(d, [[0, f0 * 0.8], [0.15, f0 * 1.25], [d * 0.6, f0 * 1.05], [d, f0 * 0.7]]), jit: 0.18, voice: 1, breath: 0.6, vow: [[0, 'o'], [d * 0.4, 'ae'], [d, 'uh']], scale: 0.75, tilt: 2200 });
  S.ring(v, f0 * 0.5, 0.45);
  S.drive(v, 3.5);
  S.mul(v, rsteps(S, d, 0.035, 0.45, 1, 60));
  S.mul(v, S.env(d, [[0, 0], [0.08, 1], [d * 0.75, 0.85], [d, 0]]));
  S.add(o, v);
  S.scatter(S.ri(5, 9), 0.1, d * 0.8, (t) => modalHit(S, o, t, [[S.rr(2200, 3400), 0.006, 1], [S.rr(4200, 5200), 0.004, 0.5]], 0.0003, 9000, S.rr(0.15, 0.35)));
  S.lp(o, 3600);
}, { db: -3, vars: 3 });

// a long distorted howl that almost sounds like a person
def('hound_howl', 3.2, (S, o) => {
  const d = S.rr(2.3, 2.8), f0 = S.rr(210, 250);
  const F = S.env(d, [[0, f0 * 0.75], [0.4, f0 * 1.6, 0.5], [d * 0.55, f0 * 1.8, 's'], [d * 0.8, f0 * 1.45], [d, f0 * 0.9, 1.5]]);
  for (let i = 0; i < F.length; i++) F[i] *= 1 + 0.02 * Math.sin(TAU * 5.5 * i / S.sr);
  const a = S.vox(d, { f0: F, jit: 0.05, voice: 1, breath: 0.35, vow: [[0, 'u'], [0.5, 'o'], [d * 0.7, 'a'], [d, 'u']], scale: 0.95, tilt: 2400 });
  const b = S.vox(d, { f0: scaleArr(F, 1.031), jit: 0.07, voice: 1, breath: 0.25, vow: [[0, 'o'], [d * 0.6, 'u'], [d, 'o']], scale: 0.9, tilt: 1800 });
  for (let i = 0; i < a.length; i++) a[i] = a[i] + b[i] * 0.7;
  S.ring(a, 33, 0.25);
  S.drive(a, 2);
  S.mul(a, S.env(d, [[0, 0], [0.3, 1, 's'], [d * 0.8, 0.8], [d, 0, 's']]));
  S.add(o, a);
  S.verb(o, 2.2, 0.45, 0.4, 1.6);
}, { db: -2, vars: 2, max: 2 });

// pained yelp / whimper (light hurts it)
def('hound_yelp', 1.0, (S, o) => {
  const d = S.rr(0.35, 0.5), f0 = S.rr(520, 640);
  const v = S.vox(d, { f0: S.env(d, [[0, f0], [0.06, f0 * 1.55, 0.5], [d * 0.6, f0 * 1.15], [d, f0 * 0.75]]), jit: 0.05, voice: 1, breath: 0.4, vow: [[0, 'i'], [d, 'u']], scale: 1.2, tilt: 4000 });
  S.drive(v, 2.2);
  S.mul(v, S.env(d, [[0, 0], [0.02, 1], [d * 0.5, 0.6], [d, 0]]));
  S.add(o, v);
  const w = S.vox(0.35, { f0: S.env(0.35, [[0, f0 * 0.9], [0.35, f0 * 0.6]]), voice: 0.7, breath: 0.6, vow: [[0, 'i'], [0.35, 'uh']], scale: 1.2 });
  S.mul(w, S.env(0.35, [[0, 0], [0.05, 0.6], [0.35, 0]]));
  S.add(o, w, d + 0.05, 0.6);
}, { db: -3, vars: 3 });

// jaw snap: teeth click, wet crunch
def('hound_bite', 0.7, (S, o) => {
  click(S, o, 0.003, 3200, 1, 0.003, 1.5);
  modalHit(S, o, 0.004, [[S.rr(1800, 2400), 0.01, 1], [S.rr(3600, 4600), 0.006, 0.6]], 0.0004, 9000, 0.9);
  thud(S, o, 0.003, 140, 70, 0.04, 0.6);
  S.nz(o, 0.01, { dur: 0.3, env: [[0, 0], [0.01, 1], [0.3, 0]], bp: S.env(0.3, [[0, 1800], [0.3, 600]]), q: 1.2, a: 0.5 });
  S.scatter(S.ri(3, 6), 0.02, 0.2, (t) => S.bubble(o, t, S.rr(400, 900), S.rr(0.1, 0.3), { rise: 0.6 }));
}, { db: -2, vars: 3 });

// ---- creatures & cooking (game/creatures/combat.js, fauna.js, game/cooking.js, game/bio.js) ----
// wet blow into flesh
def('flesh_hit', 0.6, (S, o) => {
  impact(S, o, 0.001, 'flesh', 1, S.rr(0.8, 1.2), 1);
  thud(S, o, 0.002, S.rr(90, 130), 50, 0.06, 0.8);
  S.nz(o, 0.01, { dur: 0.25, env: [[0, 0], [0.01, 1], [0.25, 0]], bp: S.env(0.25, [[0, 1600], [0.25, 500]]), q: 1.1, a: 0.4 });
  S.scatter(S.ri(2, 5), 0.02, 0.25, (t) => S.bubble(o, t, S.rr(300, 800), S.rr(0.1, 0.25), { rise: 0.5 }));
}, { db: -3, vars: 4 });
// a body bursting: splat, crunch, gurgle
def('gore_splat', 1.4, (S, o) => {
  thud(S, o, 0, 70, 35, 0.18, 1);
  impact(S, o, 0.002, 'flesh', 1, 1.6, 1);
  S.nz(o, 0.005, { dur: 0.5, env: [[0, 0], [0.008, 1], [0.12, 0.5], [0.5, 0]], bp: S.env(0.5, [[0, 2400], [0.5, 400]]), q: 0.8, a: 0.8 });
  const c = S.crackle(0.3, 900, { w: 0.0005, ap: 2 });
  S.bp(c, 2200, 0.7); S.norm(c, 1); S.mul(c, S.env(0.3, [[0, 0], [0.01, 1], [0.3, 0]]));
  S.add(o, c, 0.02, 0.5);
  S.scatter(S.ri(10, 18), 0.05, 1.2, (t, u) => S.bubble(o, t, S.rr(200, 700), S.rr(0.1, 0.35) * (1 - u * 0.7), { rise: 0.4 }), 1.5);
  S.scatter(S.ri(4, 8), 0.2, 1.1, (t) => impact(S, o, t, 'flesh', S.rr(0.2, 0.5), S.rr(0.4, 0.8), S.rr(0.15, 0.35)));
}, { db: -1, vars: 3 });
def('bone_crack', 0.5, (S, o) => {
  for (let k = 0, n = S.ri(2, 4); k < n; k++) {
    const t = 0.003 + k * S.rr(0.015, 0.04);
    click(S, o, t, S.rr(1800, 3200), 1 - k * 0.2, 0.004, 1.3);
    modalHit(S, o, t, [[S.rr(900, 1400), 0.02, 1], [S.rr(2200, 3000), 0.012, 0.6]], 0.0005, 6000, 0.7 - k * 0.12);
  }
  thud(S, o, 0, 160, 80, 0.03, 0.5);
}, { db: -3, vars: 3 });
// mole: snuffly chirps
def('mole_squeak', 0.6, (S, o) => {
  let t = 0.005;
  for (let k = 0, n = S.ri(1, 3); k < n; k++) {
    const d = S.rr(0.05, 0.1), f = S.rr(1900, 2800);
    S.tone(o, t, { f, f1: f * S.rr(0.75, 1.15), gt: d * 0.4, wave: 'tri', dur: d, env: [[0, 0], [0.008, 1], [d * 0.7, 0.6], [d, 0]], vib: [S.rr(30, 55), 0.05] });
    t += d + S.rr(0.04, 0.09);
  }
  for (let k = 0; k < 3; k++) S.nz(o, t + k * 0.06, { att: 0.005, tau: 0.02, bp: S.rr(2500, 4000), q: 0.8, a: 0.25 });
}, { db: -11, vars: 4 });
def('mole_alarm', 1.1, (S, o) => {
  for (let k = 0; k < 4; k++) {
    const t = k * 0.22, d = 0.14, f = S.rr(2600, 3100);
    S.tone(o, t, { f: f * 0.8, f1: f * 1.2, gt: d * 0.3, wave: 'saw', dur: d, env: [[0, 0], [0.01, 1], [d, 0]], vib: [45, 0.04], a: 0.6 });
  }
}, { db: -8, vars: 2 });
// digging / scratching inside the walls or under the carpet
def('mole_dig', 1.0, (S, o) => {
  let t = 0.01;
  while (t < 0.85) {
    const d = S.rr(0.04, 0.09), c = S.crackle(d, S.rr(500, 1200), { w: 0.0003, ap: 1.5 });
    S.bp(c, S.rr(1800, 3800), 0.8); S.norm(c, 1); S.mul(c, S.env(d, [[0, 0], [0.006, 1], [d, 0]]));
    S.add(o, c, t, S.rr(0.4, 1));
    t += d + S.rr(0.03, 0.12);
  }
  S.nz(o, 0, { dur: 0.9, env: [[0, 0], [0.1, 1], [0.9, 0]], lp: 500, a: 0.15 });
}, { db: -10, vars: 3 });
// damp crawler: wet teeth clicks and a rattle of breath
def('crawler_chitter', 1.2, (S, o) => {
  let t = 0.01;
  for (let k = 0, n = S.ri(5, 11); k < n; k++) {
    click(S, o, t, S.rr(1200, 2600), S.rr(0.4, 1), 0.003, 1.6);
    if (S.chance(0.4)) S.bubble(o, t + 0.005, S.rr(400, 900), 0.2, { rise: 0.6 });
    t += S.rr(0.03, 0.11);
  }
  const v = S.vox(0.9, { f0: S.rr(70, 95), jit: 0.2, voice: 0.4, breath: 0.9, vow: [[0, 'uh'], [0.9, 'er']], scale: 0.8, tilt: 1800 });
  S.mul(v, S.env(0.9, [[0, 0], [0.2, 0.6], [0.9, 0]]));
  S.add(o, v, 0.02, 0.4);
}, { db: -7, vars: 3 });
def('crawler_screech', 1.1, (S, o) => {
  const d = S.rr(0.6, 0.85), f0 = S.rr(380, 520);
  const v = S.vox(d, { f0: S.env(d, [[0, f0 * 0.7], [0.08, f0 * 1.4, 0.5], [d, f0 * 0.6]]), jit: 0.12, voice: 1, breath: 0.6, vow: [[0, 'a'], [d * 0.5, 'e'], [d, 'i']], scale: 1.3, tilt: 5000 });
  S.drive(v, 3.5);
  S.mul(v, S.env(d, [[0, 0], [0.02, 1], [d * 0.6, 0.7], [d, 0]]));
  S.add(o, v, 0);
  S.nz(o, 0, { dur: d, env: [[0, 0], [0.03, 1], [d, 0]], bp: 3500, q: 0.7, a: 0.35 });
}, { db: -2, vars: 3 });
// the fungal: a deep, wet, wordless groan
def('fungal_groan', 2.4, (S, o) => {
  const d = S.rr(1.4, 2.1), f0 = S.rr(52, 68);
  const v = S.vox(d, { f0: S.env(d, [[0, f0], [d * 0.5, f0 * 1.25, 's'], [d, f0 * 0.8, 's']]), jit: 0.18, voice: 0.8, breath: 0.7, vow: [[0, 'o'], [d * 0.5, 'u'], [d, 'uh']], scale: 0.7, tilt: 900 });
  S.drive(v, 1.8);
  S.mul(v, S.env(d, [[0, 0], [0.3, 1], [d * 0.7, 0.8], [d, 0]]));
  S.add(o, v, 0.02);
  S.scatter(S.ri(8, 14), 0.1, d, (t) => S.bubble(o, t, S.rr(150, 420), S.rr(0.08, 0.2), { rise: 0.3 }));
}, { db: -4, vars: 3 });
def('spore_puff', 1.3, (S, o) => {
  S.nz(o, 0, { dur: 1.1, env: [[0, 0], [0.03, 1], [0.25, 0.5], [1.1, 0]], lp: S.env(1.1, [[0, 3000], [1.1, 500]]), a: 0.9, color: 'p' });
  thud(S, o, 0, 80, 40, 0.1, 0.4);
}, { db: -6, vars: 2 });
// moth wings: a soft papery flutter
def('moth_flutter', 0.9, (S, o) => {
  const d = S.rr(0.4, 0.75), x = S.noise(d), rate = S.rr(22, 32);
  S.mul(x, S.env(d, [[0, 0], [0.05, 1], [d * 0.7, 0.8], [d, 0]]));
  for (let i = 0; i < x.length; i++) x[i] *= 0.35 + 0.65 * Math.max(0, Math.sin((TAU * rate * i) / S.sr));
  S.lp(x, 1100); S.norm(x, 1);
  S.add(o, x, 0.005);
}, { db: -12, vars: 3 });
// fat sizzling in a hot pan
def('sizzle', 1.5, (S, o, p) => {
  const d = 1.4;
  const c = S.crackle(d, S.env(d, [[0, 2600 * p.i + 600], [d, 1600 * p.i + 400]]), { w: 0.00015, ap: 1.6, min: 0.15 });
  S.hp(c, 2500); S.norm(c, 1); S.mul(c, S.env(d, [[0, 0], [0.04, 1], [d - 0.2, 0.8], [d, 0]]));
  S.add(o, c, 0, 0.8);
  S.nz(o, 0, { dur: d, env: [[0, 0], [0.05, 1], [d - 0.15, 0.7], [d, 0]], hp: 4500, a: 0.35 });
}, { db: -10, vars: 3, tiers: [0.3, 1] });
def('pan_flip', 0.9, (S, o) => {
  impact(S, o, 0.001, 'metal', 0.6, 1.2, 0.8);
  S.nz(o, 0.02, { dur: 0.5, env: [[0, 0], [0.02, 1], [0.5, 0]], hp: 3000, a: 0.5 });
  impact(S, o, S.rr(0.38, 0.46), 'flesh', 0.5, 0.6, 0.6);
}, { db: -6, vars: 3 });
def('stove_ignite', 1.2, (S, o) => {
  click(S, o, 0.01, 3500, 1, 0.003, 1.2);
  click(S, o, 0.09, 3800, 0.8, 0.003, 1.2);
  S.nz(o, 0.12, { dur: 0.5, env: [[0, 0], [0.04, 1], [0.5, 0]], lp: 600, a: 0.8, color: 'p' });
  S.nz(o, 0.15, { dur: 1.0, env: [[0, 0], [0.2, 1], [1.0, 0.6]], bp: 2200, q: 0.5, a: 0.3 });
}, { db: -7, vars: 2 });
def('cough', 1.0, (S, o) => {
  let t = 0.01;
  for (let k = 0, n = S.ri(2, 3); k < n; k++) {
    const d = S.rr(0.12, 0.2), f0 = S.rr(130, 170);
    const v = S.vox(d, { f0, jit: 0.08, voice: 0.5, breath: 1, vow: [[0, 'a'], [d, 'uh']], scale: 1.05, tilt: 2500 });
    S.mul(v, S.env(d, [[0, 0], [0.008, 1], [d, 0, 2]]));
    S.add(o, v, t, 1 - k * 0.2);
    S.nz(o, t, { att: 0.003, tau: 0.05, bp: 1200, q: 0.6, a: 0.4 });
    t += d + S.rr(0.08, 0.16);
  }
}, { db: -6, vars: 3 });

// soft padded footfall on carpet (hand / boot)
def('hound_step', 0.3, (S, o, p) => {
  thud(S, o, 0.002, 95, 55, 0.03, 0.8 * (0.5 + p.i * 0.5));
  S.nz(o, 0.002, { tau: 0.035, bp: S.rr(900, 1600), q: 0.8, a: 0.35 + p.i * 0.3, color: 'p' });
}, { db: -10, vars: 4, tiers: [0.3, 1], max: 6 });

// whispered, breathy giggle that seems to come from everywhere
def('smiler_giggle', 1.8, (S, o) => {
  let t = 0.02, f = S.rr(380, 460);
  for (let k = 0, n = S.ri(4, 7); k < n; k++) {
    const d = S.rr(0.07, 0.1);
    const v = S.vox(d, { f0: S.env(d, [[0, f * 1.1], [d, f * 0.9]]), voice: 0.35, breath: 1, vow: [[0, 'i'], [d, 'ee']], scale: 1.25, jit: 0.04, tilt: 5000 });
    S.mul(v, S.env(d, [[0, 0], [0.01, 1], [d * 0.6, 0.8], [d, 0]]));
    S.add(o, v, t);
    t += d + S.rr(0.035, 0.07);
    f *= S.rr(0.93, 0.98);
  }
  S.hp(o, 600);
  S.verb(o, 1.8, 0.55, 0.3, 1.4);
}, { db: -8, vars: 3 });

// rising shriek with chattering teeth as it rushes you
def('smiler_charge', 1.8, (S, o) => {
  const d = 1.3, f0 = S.rr(700, 820);
  const x = S.fm(d, S.env(d, [[0, f0 * 0.5], [0.25, f0 * 1.6, 0.4], [d, f0 * 2.2]]), 1.5, S.env(d, [[0, 1], [0.3, 5], [d, 7]]));
  S.drive(x, 2.5);
  S.crush(x, 9, 2);
  S.mul(x, S.env(d, [[0, 0], [0.1, 0.7], [d * 0.8, 1], [d, 0]]));
  S.add(o, x, 0, 0.7);
  for (let t = 0.05; t < d; t += S.rr(0.025, 0.045)) modalHit(S, o, t, [[S.rr(2500, 3800), 0.004, 1]], 0.0002, 10000, S.rr(0.2, 0.45));
  S.nz(o, 0, { dur: d, env: [[0, 0], [d, 1, 2]], bp: S.env(d, [[0, 1500], [d, 5000, 'e']]), q: 1.5, a: 0.3 });
}, { db: -2, vars: 2 });

// light hits it: a hiss that tears into static and is gone
def('smiler_hiss', 1.2, (S, o) => {
  const d = 0.9;
  S.nz(o, 0, { dur: d, env: [[0, 0], [0.03, 1], [d, 0, 1.5]], bp: S.env(d, [[0, 5500], [d, 2500]]), q: 0.8, a: 1 });
  const v = S.vox(0.5, { f0: S.env(0.5, [[0, 900], [0.5, 380]]), voice: 0.6, breath: 0.9, vow: [[0, 'ee'], [0.5, 'a']], scale: 1.3 });
  S.mul(v, S.env(0.5, [[0, 0], [0.02, 1], [0.5, 0]]));
  S.add(o, v, 0, 0.6);
  S.crush(o, 6, 4);
  S.mul(o, rsteps(S, d + 0.3, 0.02, 0.3, 1, 200));
}, { db: -4, vars: 2 });

// paper party blower: buzzy reed + unrolling crinkle
def('party_horn', 1.0, (S, o) => {
  const d = S.rr(0.55, 0.75), f0 = S.rr(290, 340);
  const x = S.osc(d, S.env(d, [[0, f0 * 0.9], [0.08, f0 * 1.06], [d * 0.7, f0], [d, f0 * 0.82]]), 'pulse', { pw: 0.18 });
  S.bp(x, 1300, 0.8);
  S.mul(x, rsteps(S, d, 0.012, 0.75, 1, 400));
  S.mul(x, S.env(d, [[0, 0], [0.03, 1], [d * 0.85, 0.85], [d, 0]]));
  S.norm(x, 1);
  S.add(o, x, 0, 0.8);
  S.nz(o, 0.02, { dur: d * 0.6, env: [[0, 0], [0.05, 1], [d * 0.6, 0]], bp: 4200, q: 0.9, a: 0.25 });
}, { db: -4, vars: 3 });

// childish "hee-hee" with a delighted "yay" at the end
def('party_giggle', 1.8, (S, o) => {
  let t = 0.01, f = S.rr(560, 660);
  for (let k = 0, n = S.ri(3, 5); k < n; k++) {
    const d = S.rr(0.08, 0.11);
    const v = S.vox(d, { f0: S.env(d, [[0, f * 1.08], [d, f * 0.92]]), voice: 1, breath: 0.25, vow: [[0, 'i'], [d, 'ee']], scale: 1.35, jit: 0.02, tilt: 3800 });
    S.mul(v, S.env(d, [[0, 0], [0.01, 1], [d * 0.6, 0.8], [d, 0]]));
    S.add(o, v, t);
    t += d + S.rr(0.04, 0.07);
    f *= S.rr(0.94, 0.98);
  }
  const d = 0.42;
  const y = S.vox(d, { f0: S.env(d, [[0, f * 0.9], [0.12, f * 1.35, 0.4], [d, f * 0.95]]), voice: 1, breath: 0.2, vow: [[0, 'i'], [0.1, 'ae'], [d, 'ee']], scale: 1.3, jit: 0.02 });
  S.mul(y, S.env(d, [[0, 0], [0.02, 1], [d * 0.7, 0.8], [d, 0]]));
  S.add(o, y, t + 0.06, 0.9);
  S.ring(o, 70, 0.12);
}, { db: -4, vars: 3 });

// distorter spin-up: rising whine, relay clunk, field "settling" shimmer
def('distorter_on', 2.2, (S, o) => {
  const d = 1.9;
  const w = S.osc(d, S.env(d, [[0, 90], [1.2, 880, 'e'], [d, 660]]), 'saw');
  S.lp(w, S.env(d, [[0, 400], [1.2, 3000], [d, 1600]]));
  S.mul(w, S.env(d, [[0, 0], [0.4, 0.5], [1.2, 1], [d, 0, 's']]));
  S.norm(w, 1);
  S.add(o, w, 0, 0.45);
  thud(S, o, 0.02, 120, 60, 0.05, 0.8);
  click(S, o, 0.02, 2600, 0.8, 0.003);
  const sh = S.fm(0.9, 1400, 2.01, 3);
  S.mul(sh, S.env(0.9, [[0, 0], [0.1, 1], [0.9, 0, 1.5]]));
  S.add(o, sh, 1.0, 0.25);
  S.verb(o, 1.6, 0.35, 0.4, 1.2);
}, { db: -5, vars: 2 });

// field collapse: falling whine and a crackle
def('distorter_off', 1.6, (S, o) => {
  const d = 1.2;
  const w = S.osc(d, S.env(d, [[0, 700], [d, 60, 'e']]), 'saw');
  S.lp(w, S.env(d, [[0, 2600], [d, 300, 'e']]));
  S.mul(w, S.env(d, [[0, 1], [d, 0, 1.2]]));
  S.norm(w, 1);
  S.add(o, w, 0, 0.5);
  S.scatter(S.ri(6, 12), 0.0, 0.4, (t) => S.nz(o, t, { tau: 0.006, bp: S.rr(2000, 6000), q: 2, a: S.rr(0.2, 0.5) }));
  thud(S, o, 0.01, 90, 45, 0.08, 0.6);
}, { db: -5, vars: 2 });

// the field's slow throb (played with each rising pulse ring)
def('distorter_pulse', 1.6, (S, o) => {
  const d = 1.4;
  const x = S.fm(d, S.env(d, [[0, 55], [0.3, 68], [d, 50]]), 0.5, S.env(d, [[0, 0.5], [0.3, 2.5], [d, 0.3]]));
  S.mul(x, S.env(d, [[0, 0], [0.12, 1], [d, 0, 1.6]]));
  S.add(o, x);
  const sh = S.noise(d);
  S.bp(sh, 5200, 6);
  S.mul(sh, S.env(d, [[0, 0], [0.3, 0.6], [d, 0]]));
  S.add(o, sh, 0, 0.12);
}, { db: -10, vars: 3 });

// something hits the field: electric snap, crackle and a bassy push
def('distorter_zap', 1.0, (S, o) => {
  S.scatter(S.ri(14, 24), 0.0, 0.25, (t, u) => S.nz(o, t, { tau: S.rr(0.002, 0.008), bp: S.rr(1500, 7000), q: 1.5, a: (1 - u) * S.rr(0.4, 1) }));
  thud(S, o, 0.0, 150, 50, 0.09, 1);
  const z = S.fm(0.4, S.env(0.4, [[0, 2400], [0.4, 300, 'e']]), 3.01, 4);
  S.mul(z, S.env(0.4, [[0, 1], [0.4, 0, 1.4]]));
  S.add(o, z, 0, 0.35);
}, { db: -3, vars: 3 });

// four casters rumbling over carpet, the deck rattling
def('trolley_roll', 1.0, (S, o, p) => {
  const d = 0.9;
  S.nz(o, 0, { dur: d, color: 'p', env: [[0, 0], [0.1, 1], [d - 0.15, 0.9], [d, 0]], bp: 180 + p.i * 150, q: 1.2, a: 0.6 });
  S.scatter(S.ri(6, 12), 0.02, d - 0.05, (t) => modalHit(S, o, t, [[S.rr(700, 1300), 0.012, 1], [S.rr(2200, 3000), 0.006, 0.4]], 0.0005, 6000, S.rr(0.1, 0.3) * (0.5 + p.i)));
}, { db: -10, vars: 3, tiers: [0.3, 1] });

// ---------------------------------------------------------------- Level 0 jumpscares / unsettling events
// dissonant orchestral stab: a detuned saw cluster slammed in with a noise hit, a screeching glissando on top
def('scare_sting', 2.2, (S, o) => {
  const d = 2.0;
  const notes = [110, 116.5, 164.8, 233.1, 349.2, 370];
  for (const f of notes) {
    for (const dt of [-0.012, 0.011]) {
      const x = S.osc(d, f * (1 + dt) * S.rr(0.995, 1.005), 'saw');
      S.lp(x, 2600);
      S.mul(x, S.env(d, [[0, 0], [0.006, 1], [0.12, 0.55], [d, 0, 1.6]]));
      S.add(o, x, 0, 0.12);
    }
  }
  const sc = S.fm(1.3, S.env(1.3, [[0, 1900], [0.08, 2600], [1.3, 1500, 'e']]), 1.003, S.env(1.3, [[0, 0.4], [1.3, 2.5]]));
  S.mul(sc, S.env(1.3, [[0, 0], [0.04, 1], [1.3, 0, 1.4]]));
  S.add(o, sc, 0.01, 0.18);
  S.nz(o, 0, { tau: 0.09, lp: 1800, a: 0.9 });
  thud(S, o, 0, 70, 38, 0.25, 1.1);
  S.drive(o, 1.6);
}, { db: 1, vars: 3, jit: 30, max: 2 });

// a high, torn shriek
def('scare_shriek', 1.6, (S, o) => {
  const d = S.rr(1.0, 1.3), f0 = S.rr(900, 1150);
  const F = S.env(d, [[0, f0 * 0.6], [0.05, f0 * 1.3, 0.4], [d * 0.4, f0 * 1.1, 's'], [d, f0 * 0.5, 1.6]]);
  for (let i = 0; i < F.length; i++) { const t = i / S.sr; F[i] *= 1 + 0.05 * Math.sin(TAU * 11 * t) + 0.03 * Math.sin(TAU * 27 * t); }
  const v = S.vox(d, { f0: F, jit: 0.06, voice: 1, breath: 0.5, vow: [[0, 'a'], [d * 0.3, 'ee'], [d, 'i']], scale: 1.5, tilt: 6000, gains: [1, 1, 0.7, 0.5] });
  S.drive(v, 4);
  S.crush(v, 8, 2);
  S.mul(v, S.env(d, [[0, 0], [0.02, 1], [d * 0.7, 0.85], [d, 0]]));
  S.add(o, v);
  S.nz(o, 0, { tau: 0.4, bp: 3500, q: 0.8, a: 0.35 });
}, { db: 0, vars: 3, max: 2 });

// something rushing past: a fast filtered-noise sweep with a soft thump of feet
def('scare_whoosh', 0.8, (S, o) => {
  const d = 0.7, x = S.noise(d, 'p');
  const n = x.length, y = new Float32Array(n);
  let lp = 0, bp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n, f = 300 + 3200 * Math.sin(Math.PI * t) ** 2;
    const g = 2 * Math.sin(Math.PI * Math.min(0.45, f / S.sr));
    lp += g * bp; const hp = x[i] - lp - 0.7 * bp; bp += g * hp;
    y[i] = bp * Math.sin(Math.PI * t) ** 1.5;
  }
  S.norm(y, 1);
  S.add(o, y, 0, 0.9);
  for (const t of [0.12, 0.26, 0.38]) thud(S, o, t, 140, 70, 0.04, 0.35);
}, { db: -2, vars: 3, jit: 60 });

// a breaker trips: relay clunk, the ballasts' dying whine
def('lights_out', 1.1, (S, o) => {
  thud(S, o, 0, 95, 45, 0.12, 1);
  click(S, o, 0.0, 1800, 0.8, 0.006);
  const d = 0.9, w = S.osc(d, S.env(d, [[0, 120], [d, 40, 'e']]), 'saw');
  S.lp(w, 900);
  S.mul(w, S.env(d, [[0, 0.6], [d, 0, 1.2]]));
  S.add(o, w, 0.02, 0.4);
  S.scatter(6, 0.03, 0.4, (t) => click(S, o, t, S.rr(2500, 6000), S.rr(0.1, 0.3), 0.002));
}, { db: -3, vars: 2 });

// ======================================================================
// Main-menu break room & the AUTO-OUTFITTER wardrobe (world/menu_scene.js, entities/wardrobe.js)
// ======================================================================
// clones laughing at the table: "ha-ha-ha" bursts, out of rhythm, crushed and muffled as if heard
// through a wall on an old tape (no real voice, every variation slightly wrong)
def('menu_laugh', 2.2, (S, o) => {
  let t = 0.02, f = S.rr(150, 260);
  const n = S.ri(4, 8), stut = S.ri(1, n - 2);
  for (let k = 0; k < n; k++) {
    const d = k === stut ? S.rr(0.04, 0.06) : S.rr(0.09, 0.15);
    const h = S.vox(0.05, { voice: 0, breath: 1, vow: [[0, 'a']], scale: 1.1 });
    S.mul(h, S.env(0.05, [[0, 0], [0.015, 1], [0.05, 0]]));
    S.add(o, h, t, 0.35);
    const v = S.vox(d, { f0: S.env(d, [[0, f * S.rr(1.0, 1.15)], [d, f * 0.86]]), voice: 1, breath: 0.35, vow: [[0, S.pick(['a', 'ae', 'uh'])], [d, 'uh']], scale: S.rr(0.95, 1.12), jit: 0.05, tilt: 2400 });
    S.mul(v, S.env(d, [[0, 0], [0.012, 1], [d * 0.55, 0.75], [d, 0]]));
    S.add(o, v, t + 0.03, k === stut ? 0.6 : 1);
    t += d + (k === stut ? S.rr(0.01, 0.03) : S.rr(0.035, 0.09));
    f *= k === stut ? S.rr(1.15, 1.35) : S.rr(0.93, 1.02);
  }
  // wheezing inhale
  if (S.chance(0.6)) {
    const d = S.rr(0.25, 0.4), w = S.vox(d, { f0: S.env(d, [[0, 700], [d, 900]]), voice: 0.15, breath: 1, vow: [[0, 'ee'], [d, 'i']], scale: 1.2 });
    S.mul(w, S.env(d, [[0, 0], [0.08, 1], [d, 0]]));
    S.add(o, w, t + 0.05, 0.35);
  }
  S.drive(o, 2.4);
  S.crush(o, 7, 2);
  S.ring(o, S.rr(18, 34), 0.25);
  S.mul(o, rsteps(S, o.length / S.sr, 0.05, 0.55, 1, 30));
  distant(S, o, S.rr(1100, 1700), 1.1, 0.35);
}, { db: -8, vars: 6, max: 4, jit: 70, sr: 22050 });

// servo/hydraulic arm move: geared motor whine up and down, chatter, a breath of hydraulics
def('robo_whir', 1.0, (S, o) => {
  const d = S.rr(0.55, 0.85), f0 = S.rr(180, 260), f1 = f0 * S.rr(2.2, 3.2);
  const w = S.osc(d, S.env(d, [[0, f0], [d * 0.3, f1, 's'], [d * 0.75, f1 * 0.92], [d, f0 * 1.2, 's']]), 'saw');
  S.bp(w, 1400, 0.7);
  S.mul(w, S.env(d, [[0, 0], [0.05, 1], [d - 0.1, 0.9], [d, 0]]));
  S.mul(w, rsteps(S, d, 0.006, 0.6, 1, 300));
  S.norm(w, 1);
  S.add(o, w, 0, 0.45);
  const g = S.osc(d, S.env(d, [[0, f0 * 4], [d * 0.3, f1 * 4, 's'], [d, f0 * 4.5]]), 'sq');
  S.bp(g, 3800, 2);
  S.mul(g, S.env(d, [[0, 0], [0.05, 1], [d, 0]]));
  S.norm(g, 0.12);
  S.add(o, g);
  S.nz(o, 0, { dur: d, env: [[0, 0], [0.1, 1], [d, 0]], bp: 2600, q: 0.7, a: 0.12 });
  S.scatter(5, 0.02, d, (t) => click(S, o, t, S.rr(2500, 5000), 0.12, 0.001));
}, { db: -9, vars: 4, max: 4 });

// clamp hand locking shut / heavy steel joint hitting its stop
def('robo_clunk', 0.9, (S, o) => {
  thud(S, o, 0.002, S.rr(95, 130), 55, 0.08, 1);
  const f0 = S.rr(320, 520), modes = [];
  for (let k = 0; k < 8; k++) modes.push([f0 * (1 + k * 0.81 + S.rr(-0.1, 0.1)), S.rr(0.08, 0.3) / (1 + k * 0.2), 1 / (1 + k * 0.3)]);
  modalHit(S, o, 0.003, modes, 0.0015, 6000, 0.8);
  click(S, o, 0.0, 2600, 0.7, 0.003);
  S.nz(o, 0.06, { dur: 0.35, env: [[0, 0], [0.01, 1], [0.35, 0, 2]], hp: 3000, a: 0.25 });
}, { db: -3, vars: 4, max: 4 });

// the wardrobe booth's louvred steel doors banging open / slamming shut
def('booth_bang', 1.6, (S, o) => {
  impact(S, o, 0.004, 'metal', 1, 2.2, 1);
  thud(S, o, 0.002, 85, 40, 0.14, 1);
  S.nz(o, 0.002, { tau: 0.06, lp: 2200, a: 0.6 });
  S.scatter(14, 0.01, 0.35, (t) => modalHit(S, o, t, [[S.rr(700, 2600), S.rr(0.03, 0.08), 1], [S.rr(3000, 5000), 0.02, 0.4]], 0.0006, 7000, S.rr(0.08, 0.3)), 1.6);
  S.verb(o, 1.2, 0.25, 0.4, 1.2);
}, { db: 0, vars: 3, max: 3 });

// helpers shared with loops.js / music.js
export { def as defShot, click, thud, modalHit, rsteps, impact, friction, groan, arc, creak, step, scaleArr, distant };

// Render a one-shot to mastered channel data (used on the main thread and in the render worker).
export function renderShot(name, intensity = 1, len) {
  const R = ONESHOTS[name];
  if (!R) return null;
  const sr = R.sr || 32000, S = new Synth(sr), p = { i: intensity, len };
  const d = typeof R.d === 'function' ? R.d(p) : R.d, n = S.n(d);
  const o = R.stereo ? [new Float32Array(n), new Float32Array(n)] : new Float32Array(n);
  R.fn(S, o, p);
  return { chs: master(R.stereo ? o : [o], sr, { db: R.db, clean: R.clean, norm: R.norm }), sr };
}

// ---------------------------------------------------------------------- player & combat (game/combat.js, qte.js, ui/vitals3d.js)
// a fist (ABS knuckles) landing: meaty low thud + plastic clack, harder at high intensity
def('punch_hit', 0.5, (S, o, p) => {
  thud(S, o, 0.001, lerp(140, 110, p.i), 50, lerp(0.05, 0.09, p.i), 1);
  impact(S, o, 0.002, 'plastic', lerp(0.5, 1, p.i), 0.8, 0.6);
  click(S, o, 0, S.rr(1800, 2600), lerp(0.4, 0.9, p.i), 0.003, 0.8);
  S.nz(o, 0, { tau: lerp(0.02, 0.05, p.i), lp: 900, a: 0.6 });
}, { tiers: [0.3, 1], vars: 3, db: -3, max: 4 });
// short fast swing
def('punch_swing', 0.3, (S, o, p) => {
  const d = lerp(0.14, 0.24, p.i), env = [[0, 0], [d * 0.4, 1, 2], [d, 0, 0.6]];
  S.nz(o, 0, { dur: d, env, bp: S.env(d, [[0, 700], [d * 0.4, lerp(1800, 2800, p.i), 's'], [d, 800, 's']]), q: 2, a: 1, color: 'p' });
}, { tiers: [0.3, 1], vars: 3, db: -9 });
// the heart's glass chamber cracking
def('glass_crack', 0.6, (S, o) => {
  click(S, o, 0, S.rr(5000, 7000), 0.8, 0.002, 0.6);
  S.scatter(S.ri(6, 12), 0.002, 0.12, (t, u) => tink(S, o, t, S.rr(3000, 8000), S.rr(0.1, 0.4) * (1 - u * 0.5)), 2);
  const c = S.crackle(0.25, [[0, 900], [0.25, 40]], { w: 0.0002, hp: 3000 });
  S.norm(c, 0.4);
  S.add(o, c, 0.003);
}, { db: -8, vars: 3, sr: 44100 });
// QTE key hit: a stiff mechanical click with a bright blip
def('qte_hit', 0.18, (S, o) => {
  click(S, o, 0, S.rr(2600, 3400), 0.9, 0.002, 1);
  S.tone(o, 0.002, { f: S.rr(1180, 1260), f1: 1500, gt: 0.03, att: 0.002, tau: 0.04, a: 0.35 });
  thud(S, o, 0, 220, 140, 0.012, 0.4);
}, { db: -8, vars: 4, max: 6 });
// fully charged multitool discharge
def('mt_zap', 0.9, (S, o) => {
  S.scatter(S.ri(18, 28), 0.0, 0.3, (t, u) => S.nz(o, t, { tau: S.rr(0.002, 0.01), bp: S.rr(1200, 8000), q: 1.5, a: (1 - u) * S.rr(0.5, 1) }));
  thud(S, o, 0.0, 180, 45, 0.1, 1);
  const z = S.fm(0.5, S.env(0.5, [[0, 3200], [0.5, 200, 'e']]), 2.01, 5);
  S.mul(z, S.env(0.5, [[0, 1], [0.5, 0, 1.2]]));
  S.add(o, z, 0, 0.4);
}, { db: -2, vars: 3, sr: 44100 });

// ======================================================================
// Factory main menu (world/menu_scene.js): brutal outfitting arms, light banks, the hook and the drop
// metal panel torn off by a hydraulic clamp: shriek + crunch + scattering fasteners
def('metal_rip', 1.5, (S, o) => {
  impact(S, o, 0.002, 'metal', 1, 1.6, 0.9);
  thud(S, o, 0.0, 150, 55, 0.08, 0.9);
  const cr = S.crackle(0.5, S.env(0.5, [[0, 5200], [0.5, 700]]), { w: 0.0004, ap: 2.2 });
  S.bp(cr, 2600, 0.7); S.norm(cr, 0.7); S.add(o, cr, 0.01);
  friction(S, o, 0.0, 0.45, S.env(0.45, [[0, S.rr(160, 240)], [0.45, S.rr(60, 90), 's']]), [[S.rr(900, 1200), 0.05, 1], [S.rr(2100, 2600), 0.03, 0.8], [S.rr(3800, 4600), 0.02, 0.6], [S.rr(6000, 7000), 0.012, 0.4]], 0.9, 0.2);
  S.scatter(S.ri(4, 7), 0.18, 1.2, (t) => tink(S, o, t, S.rr(2400, 5200), S.rr(0.1, 0.3)));
  S.drive(o, 1.5);
}, { db: -1, vars: 3, max: 3 });
// a bank of factory floodlights slamming on: contactor thunk, transformer surge, ballast buzz
def('lights_slam', 1.8, (S, o) => {
  thud(S, o, 0.0, 120, 38, 0.2, 1);
  click(S, o, 0.0, 1600, 1, 0.008, 0.6);
  impact(S, o, 0.002, 'metal', 1, 2.4, 0.7);
  const d = 1.6, w = S.osc(d, 100, 'saw');
  S.bp(w, 900, 1.2);
  S.mul(w, S.env(d, [[0, 0], [0.02, 1], [0.25, 0.45], [d, 0, 1.5]]));
  S.add(o, w, 0.01, 0.35);
  const h = S.osc(d, 50, 'sq'); S.lp(h, 300); S.mul(h, S.env(d, [[0, 0], [0.03, 1], [d, 0, 1.2]])); S.add(o, h, 0.0, 0.3);
  S.verb(o, 1.8, 0.35, 0.4, 1.6);
}, { db: 0, vars: 3, max: 3 });
// hook clamp springs open
def('hook_release', 1.2, (S, o) => {
  ratchetClick(S, o, 0.0, 0.8, 3200);
  impact(S, o, 0.01, 'metal', 1, 1.1, 0.9);
  thud(S, o, 0.0, 160, 90, 0.04, 0.6);
  modalHit(S, o, 0.02, [[S.rr(520, 600), 0.4, 1], [S.rr(1300, 1450), 0.25, 0.6], [S.rr(2700, 3000), 0.12, 0.35]], 0.001, 7000, 0.5);
  S.nz(o, 0.0, { tau: 0.18, hp: 2500, a: 0.25 });
}, { db: -2, vars: 2, max: 2 });
// a heavy android body slamming onto concrete
def('body_impact', 2.4, (S, o) => {
  thud(S, o, 0, 90, 30, 0.35, 1);
  thud(S, o, 0.004, 55, 28, 0.5, 0.7);
  impact(S, o, 0.002, 'heavy', 1, 1.2, 1);
  impact(S, o, 0.006, 'metal', 1, 1.6, 0.6);
  impact(S, o, 0.003, 'plastic', 1, 1.4, 0.5);
  S.scatter(12, 0.04, 0.9, (t, u) => impact(S, o, t, S.pick(['metal', 'plastic']), S.rr(0.2, 0.6), S.rr(0.4, 0.9), S.rr(0.1, 0.35) * (1 - u * 0.6)), 1.6);
  S.nz(o, 0, { dur: 1.6, env: [[0, 0], [0.03, 1], [1.6, 0, 2]], lp: 180, a: 0.5, color: 'b' });
  S.drive(o, 1.3);
}, { db: 0, vars: 2, max: 2 });
// knob detent / rotary switch click
def('knob_tick', 0.12, (S, o) => {
  ratchetClick(S, o, 0.0, 0.6, S.rr(3600, 4600));
}, { db: -10, vars: 4, max: 6 });
// heavy toggle switch throw
def('toggle_clack', 0.35, (S, o) => {
  click(S, o, 0.0, S.rr(2600, 3400), 1, 0.003, 0.7);
  thud(S, o, 0.0, 240, 140, 0.02, 0.5);
  click(S, o, S.rr(0.012, 0.02), 5200, 0.3, 0.001);
}, { db: -6, vars: 3, max: 4 });
// crowbar prying a crate lid
def('crate_pry', 1.2, (S, o) => {
  creak(S, o, 0.0, 0.5, 70, 180, 0.8, 1.2);
  impact(S, o, 0.5, 'wood', 1, 1.2, 1);
  S.scatter(5, 0.52, 0.9, (t) => impact(S, o, t, 'wood', S.rr(0.2, 0.5), S.rr(0.3, 0.6), S.rr(0.1, 0.3)));
  tink(S, o, 0.55, S.rr(3000, 4200), 0.3);
}, { db: -3, vars: 3, max: 3 });

// ======================================================================
// HQ waiting room, elevator ride, robot pit (lobby & elevator)
// ======================================================================
// one split-flap flap falling over (the board re-triggers it while it rattles)
def('flap_clack', 0.08, (S, o) => {
  click(S, o, 0.001, S.rr(2600, 3800), 0.6, 0.002, 1.4);
  modalHit(S, o, 0.002, [[S.rr(1800, 2400), 0.012, 1], [S.rr(4200, 5200), 0.006, 0.5]], 0.0008, 7000, 0.5);
  thud(S, o, 0.003, 420, 200, 0.01, 0.25);
}, { vars: 6, db: -8, max: 6, jit: 60 });
// an android clone burning: a voice that climbs, buzzes through its speaker grille and distorts
def('clone_scream', 2.0, (S, o) => {
  const d = S.rr(1.4, 1.8), f0 = S.rr(330, 460);
  const v = S.vox(d, { f0: S.env(d, [[0, f0 * 0.7], [0.12, f0 * 1.35], [0.5, f0 * 1.2], [d, f0 * 0.55, 's']]), jit: 0.08, breath: 0.35, vow: [[0, 'a'], [0.5, 'e'], [d, 'o']], scale: 1.05, tilt: 4500 });
  S.ring(v, S.rr(60, 90), 0.35);
  S.mul(v, S.env(d, [[0, 0], [0.05, 1], [d * 0.7, 0.8], [d, 0]]));
  S.drive(v, 2.2);
  S.norm(v, 1);
  S.add(o, v, 0.02);
}, { vars: 3, db: -4, sr: 22050, max: 4 });
// the furnace under HQ: low roar, gusts, crackling slag
def('furnace_roar', 4.2, (S, o) => {
  const d = 4.0;
  S.nz(o, 0, { dur: d, env: [[0, 0], [0.5, 1], [d - 0.8, 0.9], [d, 0]], lp: 380, a: 0.9, color: 'b' });
  S.nz(o, 0, { dur: d, env: [[0, 0], [0.3, 0.6], [1.6, 0.25], [2.4, 0.7], [d, 0]], bp: 900, q: 0.8, a: 0.25 });
  S.scatter(70, 0.1, d - 0.2, (t) => click(S, o, t, S.rr(1500, 5000), S.rr(0.1, 0.4), 0.002, 1));
  S.drive(o, 1.3);
}, { vars: 2, db: -5 });
// a hoist cable letting go: whip crack, twang, the rope screaming through the sheave
def('cable_snap', 2.2, (S, o) => {
  click(S, o, 0, 3500, 1, 0.006, 0.8);
  S.nz(o, 0, { tau: 0.04, bp: 2500, q: 0.7, a: 1 });
  impact(S, o, 0.01, 'metal', 1, 2.0, 0.9);
  S.tone(o, 0.02, { f: 220, f1: 70, gt: 0.6, att: 0.002, tau: 0.5, a: 0.5 });
  friction(S, o, 0.05, 1.1, S.env(1.1, [[0, 1800], [1.1, 600, 's']]), [[S.rr(2400, 3000), 0.02, 1], [S.rr(4100, 4800), 0.012, 0.6]], 0.4, 0.06);
  S.drive(o, 1.6);
}, { db: -2, vars: 2 });
// steel on steel at speed: guide shoes, a buckling car frame
def('metal_scream', 2.6, (S, o) => {
  const d = S.rr(1.6, 2.3);
  friction(S, o, 0, d, S.env(d, [[0, S.rr(500, 800)], [d * 0.5, S.rr(1100, 1500)], [d, S.rr(400, 700), 's']]), [[S.rr(1900, 2600), 0.03, 1], [S.rr(3300, 4200), 0.02, 0.7], [S.rr(5600, 6800), 0.012, 0.4], [S.rr(900, 1200), 0.04, 0.5]], 1, 0.08);
  S.nz(o, 0, { dur: d, env: [[0, 0], [0.1, 0.5], [d, 0]], bp: 3200, q: 3, a: 0.15 });
  S.drive(o, 1.5);
}, { db: -4, vars: 3, max: 3 });
