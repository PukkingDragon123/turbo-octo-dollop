// R.O.O.M. — procedural music loops: 'muzak' (90s corporate hold music on a worn cassette) and
// 'tension' (horror chase score). Notes are multisampled from JS-rendered instruments (every 3 semitones,
// played back with playbackRate), scheduled bar-by-bar with currentTime lookahead from audio.update().

import { Synth, TAU, clamp, lerp, mtof, sstep } from './dsp.js';
import { defShot, click, thud, modalHit, friction } from './sfx.js';
import { LOOPS } from './loops.js';

const rnd = (a, b) => a + (b - a) * Math.random();
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const chance = (p) => Math.random() < p;

// ------------------------------------------------------------------ instrument renderers (mono Float32Array)
const INSTR = {
  ep(S, f, vel) { // FM electric piano (DX-style tine)
    const d = clamp(2.6 - Math.log2(f / 130) * 0.5, 1.3, 2.6);
    const idx = S.env(d, [[0, 1.1 + vel * 1.3], [0.3, 0.45 + vel * 0.25, 'e'], [d, 0.15, 'e']]);
    const a = S.fm(d, f, 1, idx), b = S.fm(d, f * 1.0016, 1, idx, { ph: 0.3 });
    const ping = S.fm(d, f, 14, S.env(d, [[0, 1.6 * vel], [0.05, 0.01, 'e']]));
    const ea = S.ad(d, 0.002, d * 0.32), ep = S.ad(d, 0.001, 0.035);
    const x = new Float32Array(a.length);
    for (let i = 0; i < x.length; i++) x[i] = (a[i] + b[i]) * 0.5 * ea[i] + ping[i] * ep[i] * 0.22 * vel;
    S.lp1(x, 6500);
    return x;
  },
  bass(S, f, vel) { // fingered bass
    const d = 2.0, x = S.osc(d, f, 'saw');
    S.lp(x, S.env(d, [[0, f * 8 + 500], [0.12, f * 3 + 200, 'e'], [d, f * 2 + 60, 'e']]), 1.1);
    const s = S.osc(d, f);
    for (let i = 0; i < x.length; i++) x[i] = x[i] * 0.55 + s[i] * 0.7;
    S.mul(x, S.ad(d, 0.004, 0.75));
    S.nz(x, 0, { tau: 0.006, bp: 1100, q: 1, a: 0.12 * vel });
    return x;
  },
  vibes(S, f) { // vibraphone (tuned bar partials + motor tremolo)
    const d = 2.6, x = S.buf(d);
    S.bell(x, 0, f, [[1, 1, 1.4], [3.98, 0.22, 0.22], [9.8, 0.05, 0.05]], 1, 0.001);
    S.nz(x, 0, { tau: 0.004, lp: 2000, a: 0.08 });
    S.mul(x, (t) => 1 + 0.22 * Math.sin(TAU * 5.2 * t) * Math.min(1, t * 6));
    return x;
  },
  flute(S, f, vel) { // soft synth flute / pan lead
    const d = 2.6;
    const fq = (t) => f * (1 + 0.007 * Math.sin(TAU * 5 * t) * sstep(0.15, 0.45, t));
    const x = S.osc(d, fq), h2 = S.osc(d, (t) => fq(t) * 2), h3 = S.osc(d, (t) => fq(t) * 3);
    for (let i = 0; i < x.length; i++) x[i] = x[i] + 0.22 * h2[i] + 0.07 * h3[i];
    const br = S.noise(d);
    S.bp(br, f * 2, 2);
    S.norm(br, 0.12);
    S.add(x, br);
    S.mul(x, S.env(d, [[0, 0], [0.045, 1], [0.3, 0.85], [d, 0.5]]));
    return x;
  },
  stab(S, f) { // tension: low string stab cluster
    const d = 0.45, x = S.buf(d);
    for (const r of [1, 1.0595, 2.001]) { const y = S.osc(d, f * r * S.j(1, 0.003), 'saw'); S.add(x, y, 0, 0.5); }
    S.lp(x, S.env(d, [[0, 2400], [0.3, 500, 'e']]), 1.2);
    S.nz(x, 0, { tau: 0.02, bp: 2500, q: 1, a: 0.3 });
    S.mul(x, S.env(d, [[0, 0], [0.006, 1], [0.12, 0.6], [d, 0]]));
    return x;
  },
};

// ------------------------------------------------------------------ drum / fx one-shots (normalized & cached by engine)
defShot('_m_kick', 0.4, (S, o) => { thud(S, o, 0, 110, 48, 0.16, 1); click(S, o, 0, 3000, 0.08, 0.002); S.nz(o, 0, { tau: 0.02, lp: 300, a: 0.3 }); }, { vars: 2, db: -6, jit: 15 });
defShot('_m_rim', 0.2, (S, o) => { click(S, o, 0, 3000, 0.6, 0.001); modalHit(S, o, 0, [[1700, 0.02, 1], [480, 0.04, 0.6], [3400, 0.01, 0.4]], 0.0006, 9000, 0.9); }, { vars: 3, db: -10, jit: 20 });
defShot('_m_brush', 0.4, (S, o) => {
  S.nz(o, 0, { att: 0.004, tau: 0.07, bp: 3500, q: 0.5, a: 1 });
  S.nz(o, 0, { att: 0.03, tau: 0.08, bp: 5000, q: 0.6, a: 0.4 });
  thud(S, o, 0, 220, 190, 0.04, 0.25);
}, { vars: 3, db: -12, jit: 30 });
function metalHat(S, o, tau, a) {
  const d = Math.min(tau * 6 + 0.01, S.dur(o)), x = S.buf(d);
  for (const f of [205.3, 304.4, 369.6, 522.7, 540, 800]) S.add(x, S.osc(d, f * 1.9, 'sq'), 0, 0.3);
  S.hp(x, 7000);
  const n = S.noise(d);
  S.hp(n, 6000);
  S.norm(n, 0.6);
  S.add(x, n);
  S.mul(x, S.ad(d, 0.0008, tau));
  S.add(o, x, 0, a);
}
defShot('_m_hat', 0.2, (S, o) => metalHat(S, o, 0.025, 1), { vars: 3, db: -16, jit: 40, sr: 44100 });
defShot('_m_ride', 1.2, (S, o) => { metalHat(S, o, 0.3, 0.7); S.bell(o, 0, S.rr(3200, 3600), [[1, 0.15, 0.6], [1.47, 0.1, 0.5]], 1); }, { vars: 2, db: -18, jit: 25, sr: 44100 });
defShot('_m_shaker', 0.15, (S, o) => S.nz(o, 0, { att: 0.012, tau: 0.03, bp: 6500, q: 1, a: 1 }), { vars: 3, db: -18, jit: 40, sr: 44100 });
defShot('_m_crash', 2.5, (S, o) => { metalHat(S, o, 0.6, 1); S.nz(o, 0, { att: 0.004, tau: 0.5, bp: 4500, q: 0.4, a: 0.4 }); }, { vars: 1, db: -14, jit: 10 });
defShot('_t_boom', 3.0, (S, o) => {
  thud(S, o, 0, 62, 28, 0.6, 1);
  S.nz(o, 0, { att: 0.002, tau: 0.25, lp: 250, a: 0.8, color: 'b' });
  S.nz(o, 0, { tau: 0.05, lp: 2500, a: 0.4 });
  S.drive(o, 1.8);
  S.verb(o, 2.6, 0.3, 0.6, 1.5);
}, { vars: 2, db: -2, sr: 32000 });
defShot('_t_kick', 0.6, (S, o) => {
  thud(S, o, 0, 150, 44, 0.13, 1, 0.0008);
  click(S, o, 0, 2500, 0.35, 0.002, 0.8);
  S.nz(o, 0, { tau: 0.025, lp: 600, a: 0.5 });
  S.drive(o, 2.2);
}, { vars: 2, db: -2, jit: 10 });
defShot('_t_tom', 0.8, (S, o) => {
  thud(S, o, 0, 120, 72, 0.22, 1);
  S.nz(o, 0, { tau: 0.03, lp: 1500, a: 0.4 });
  modalHit(S, o, 0, [[S.rr(150, 170), 0.15, 1], [S.rr(250, 270), 0.1, 0.6], [S.rr(380, 420), 0.06, 0.4]], 0.003, 1500, 0.5);
}, { vars: 3, db: -6 });
defShot('_t_tick', 0.15, (S, o) => modalHit(S, o, 0, [[S.rr(3000, 3400), 0.02, 1], [S.rr(5000, 5300), 0.015, 0.6], [S.rr(7600, 8200), 0.01, 0.4]], 0.0004, 12000, 1), { vars: 3, db: -16, jit: 30 });
defShot('_t_scrape', 1.6, (S, o) => {
  friction(S, o, 0.01, S.rr(1.0, 1.4), S.env(1.4, [[0, S.rr(150, 220)], [1.4, S.rr(250, 400)]]), [[S.rr(1800, 2200), 0.03, 1], [S.rr(3100, 3600), 0.02, 0.8], [S.rr(4800, 5600), 0.015, 0.6]], 1, 0.15);
  S.verb(o, 1.8, 0.35, 0.4, 1.2);
}, { vars: 3, db: -8 });
defShot('_t_hit', 2.4, (S, o) => {
  const d = 2.2, x = S.buf(d);
  for (const m of [38, 44, 51, 57, 58]) { const y = S.osc(d, mtof(m) * S.j(1, 0.003), 'saw'); S.add(x, y, 0, 0.3); }
  S.lp(x, S.env(d, [[0, 3000], [0.4, 800, 'e'], [d, 300, 'e']]), 1);
  S.drive(x, 2.5);
  S.mul(x, S.env(d, [[0, 0], [0.012, 1], [0.3, 0.6], [d, 0, 1.5]]));
  S.add(o, x);
  thud(S, o, 0, 70, 35, 0.4, 0.8);
  S.verb(o, 2.4, 0.3, 0.5, 1.4);
}, { vars: 2, db: -3, sr: 32000 });
defShot('_t_riser', 2.2, (S, o) => {
  const d = 2.0;
  S.nz(o, 0, { dur: d, env: [[0, 0], [d, 1, 3]], bp: S.env(d, [[0, 400], [d, 6000, 'e']]), q: 2, a: 0.8 });
  const x = S.osc(d, S.env(d, [[0, 200], [d, 1600, 'e']]), 'saw');
  S.lp(x, 3000);
  S.mul(x, S.env(d, [[0, 0], [d, 1, 2.5]]));
  S.add(o, x, 0, 0.4);
}, { vars: 2, db: -6 });

// ------------------------------------------------------------------ sampler
export function renderNote(instr, zone, vt) {
  const S = new Synth(instr === 'bass' ? 16000 : 24000, zone * 13 + vt);
  const x = INSTR[instr](S, mtof(zone), vt ? 1 : 0.6);
  S.fadeOut(x, 0.05);
  S.norm(x, 0.7);
  return { chs: [x], sr: S.sr };
}
const zoneOf = (midi, vel) => [Math.round(midi / 3) * 3, vel > 0.7 ? 1 : 0];
function sampleNote(A, instr, midi, vel = 1) {
  const [zone, vt] = zoneOf(midi, vel);
  const buf = A.sample(`${instr}:${zone}:${vt}`, () => { const r = renderNote(instr, zone, vt); return A.makeBuffer(r.chs, r.sr); });
  return { buf, rate: 2 ** ((midi - zone) / 12) };
}
function warmNote(A, instr, midi, vel) {
  const [zone, vt] = zoneOf(midi, vel);
  A.queueNote(`${instr}:${zone}:${vt}`, instr, zone, vt);
}
function playNote(L, A, dest, instr, midi, t, dur, amp, rel = 0.15, detCents = 0, vel = 0.6) {
  const c = L.c, { buf, rate } = sampleNote(A, instr, midi, vel);
  t = Math.max(t, c.currentTime + 0.003);
  const s = c.createBufferSource(), g = c.createGain();
  s.buffer = buf;
  s.playbackRate.value = rate * 2 ** (detCents / 1200) * L.pitch;
  g.gain.setValueAtTime(amp, t);
  const end = Math.min(t + dur, t + buf.duration / rate);
  g.gain.setValueAtTime(amp, end);
  g.gain.setTargetAtTime(0, end, rel / 3);
  s.connect(g);
  g.connect(dest);
  s.start(t);
  s.stop(end + rel * 2 + 0.02);
  const rec = { s, nodes: [s, g] };
  L.evs.add(rec);
  s.onended = () => { L.evs.delete(rec); s.disconnect(); g.disconnect(); };
}

// ------------------------------------------------------------------ harmony
const QUAL = { maj7: [0, 4, 7, 11, 14], m7: [0, 3, 7, 10, 14], 7: [0, 4, 7, 10, 14], sus: [0, 5, 7, 10, 14], 69: [0, 4, 7, 9, 14], m6: [0, 3, 7, 9, 14], m7b5: [0, 3, 6, 10, 13] };
const CH = {
  I: [0, 'maj7'], ii: [2, 'm7'], iii: [4, 'm7'], IV: [5, 'maj7'], V: [7, '7'], vi: [9, 'm7'], Vs: [7, 'sus'], I6: [0, '69'],
  ivm: [5, 'm6'], bVII: [10, '7'], VV: [2, '7'], Vii: [9, '7'], Vvi: [4, '7'], I7: [0, '7'], iim: [2, 'm7b5'],
};
const A_PH = [
  [['I'], ['vi'], ['ii'], ['V']], [['I'], ['iii'], ['IV'], ['Vs', 'V']], [['I'], ['Vvi'], ['vi'], ['VV']], [['I', 'vi'], ['ii', 'V'], ['iii', 'vi'], ['ii', 'V']],
  [['I'], ['I7'], ['IV'], ['ivm']], [['IV'], ['V'], ['iii'], ['vi']], [['I'], ['ii'], ['iii'], ['IV', 'V']],
];
const A_CAD = [[['ii'], ['V'], ['I'], ['I6']], [['IV'], ['V'], ['I'], ['I']], [['ii'], ['Vs', 'V'], ['I', 'vi'], ['ii', 'V']], [['IV'], ['ivm'], ['I'], ['I6']], [['iii'], ['Vii'], ['ii', 'V'], ['I']]];
const B_PH = [[['IV'], ['iii'], ['ii'], ['I']], [['vi'], ['Vvi'], ['vi'], ['VV']], [['IV'], ['V'], ['iii'], ['vi']], [['ii'], ['V'], ['I'], ['Vii']], [['bVII'], ['IV'], ['I'], ['I7']]];
const B_HALF = [[['ii'], ['V'], ['ii'], ['Vs', 'V']], [['IV'], ['iii'], ['ii'], ['V']], [['vi'], ['VV'], ['ii'], ['V']], [['IV'], ['ivm'], ['iii', 'Vii'], ['ii', 'V']]];
const RCELL = [
  [[0, 1], [1, 1], [2, 2]], [[0, 1.5], [1.5, 0.5], [2, 2]], [[0, 0.5], [0.5, 0.5], [1, 1], [2, 1], [3, 1]], [[0.5, 0.5], [1, 1], [2, 1.5], [3.5, 0.5]],
  [[0, 3]], [[1, 1], [2, 1], [3, 1]], [[0, 2], [2, 1], [3, 1]], [[0, 0.5], [0.5, 1], [1.5, 0.5], [2, 2]], [[0, 1], [1.5, 1], [3, 1]],
];
const COMP = [[[0, 3.6]], [[0, 1.4], [1.5, 2.2]], [[0, 0.8], [1.5, 0.8], [3, 0.9]], [[0.5, 1.2], [2.5, 1.4]], [[0, 1.8], [2, 1.8]], [[0, 0.45], [1, 0.45], [2, 0.45], [3, 0.45]]];
const SCALE = [0, 2, 4, 5, 7, 9, 11];

function voicing(root, qual, prev) {
  const iv = QUAL[qual], pcs = [iv[1], iv[2], iv[3], iv[4]].map((x) => (root + x) % 12);
  let best = null, bs = 1e9;
  for (let inv = 0; inv < 4; inv++) {
    for (let base = 50; base <= 60; base++) {
      const notes = [];
      let cur = base;
      for (let k = 0; k < 4; k++) {
        const pc = pcs[(inv + k) % 4];
        while ((cur % 12 + 12) % 12 !== pc) cur++;
        notes.push(cur);
        cur++;
      }
      if (notes[0] < 50 || notes[3] > 74) continue;
      let s = 0;
      if (prev) for (let k = 0; k < 4; k++) s += Math.abs(notes[k] - prev[k]);
      else s = Math.abs(notes[0] - 55) * 2;
      s += Math.random() * 1.5;
      if (s < bs) { bs = s; best = notes; }
    }
  }
  return best;
}

class Muzak {
  constructor(L, A, p, buses) {
    Object.assign(this, { L, A, p, ...buses });
    this.key = pick([51, 53, 55, 56, 58, 60]);
    this.bpm = rnd(88, 104);
    this.beat = 60 / this.bpm;
    this.bar = 0;
    this.next = 0;
    this.chorus = -1;
    this.prevV = null;
    this.mel = 72;
    this.newChorus();
  }
  newChorus() {
    this.chorus++;
    if (this.chorus > 0 && this.chorus % 2 === 0) { this.key += chance(0.6) ? 2 : 1; if (this.key > 62) this.key -= 7; }
    if (!this.A8 || chance(0.35)) this.A8 = [...pick(A_PH), ...pick(A_CAD)];
    this.B8 = [...pick(B_PH), ...pick(B_HALF)];
    this.groove = chance(0.55) ? 'swing' : 'bossa';
    this.swing = this.groove === 'swing' ? 0.62 : 0.5;
    this.lead = this.chorus % 2 ? 'flute' : 'vibes';
    this.melA = this.makeMelody(this.A8);
    this.melB = this.makeMelody(this.B8);
    const solo = chance(0.5) ? 2 : -1;
    this.form = [];
    ['A', 'A', 'B', 'A'].forEach((s, si) => {
      for (let b = 0; b < 8; b++) {
        this.form.push({ sec: s, b, chords: (s === 'A' ? this.A8 : this.B8)[b], mel: si === solo ? null : (s === 'A' ? this.melA : this.melB)[b], last: b === 7, first: b === 0, varied: si === 3 });
      }
    });
  }
  chordAt(chords, beat) { return chords.length > 1 && beat >= 2 ? chords[1] : chords[0]; }
  tonesOf(name) { const [r, q] = CH[name]; return QUAL[q].map((x) => (this.key + r + x) % 12); }
  makeMelody(prog) {
    const cA = pick(RCELL), cB = pick(RCELL), cC = pick(RCELL), cD = pick(RCELL), plan = [cA, cB, cA, cC, cA, cB, cD, [[0, 3]]];
    let m = this.mel;
    return plan.map((cell, b) => cell.map(([st, du]) => {
      const strong = st === 0 || st === 2, ch = this.chordAt(prog[b], st), tones = this.tonesOf(ch);
      const rel = (x) => ((x - this.key) % 12 + 12) % 12;
      const dir = b < 4 ? 1 : -1;
      let cand = [];
      if (strong || b === 7) {
        for (let n = 64; n <= 86; n++) if (tones.slice(0, b === 7 ? 3 : 5).includes(n % 12)) cand.push(n);
      } else {
        for (let n = 64; n <= 86; n++) if (SCALE.includes(rel(n))) cand.push(n);
      }
      cand = cand.filter((n) => Math.abs(n - m) <= (strong ? 5 : 3) && n !== m || (cand.length < 3));
      cand.sort((a, b2) => Math.abs(a - m - dir * 1.5) - Math.abs(b2 - m - dir * 1.5) + (Math.random() - 0.5) * 3);
      const n = cand[0] ?? m;
      m = clamp(n, 65, 86);
      return [st, du, m];
    }));
  }
  swingT(beatPos) { const b = Math.floor(beatPos), f = beatPos - b; return (f === 0.5 ? b + this.swing : beatPos) * this.beat; }
  scheduleBar(t0) {
    const L = this.L, A = this.A;
    if (this.bar >= this.form.length) { this.bar = 0; this.newChorus(); }
    const B = this.form[this.bar++], bt = this.beat, T = (bp) => t0 + this.swingT(bp);
    const det = () => (Math.random() - 0.5) * 8;
    // electric piano comp
    const segs = B.chords.length > 1 ? [[B.chords[0], [[0, 1.8]]], [B.chords[1], [[2, 1.8]]]] : [[B.chords[0], pick(COMP)]];
    for (const [cn, pat] of segs) {
      const [r, q] = CH[cn], root = (this.key + r) % 12;
      const v = voicing(root, q, this.prevV);
      this.prevV = v;
      for (const [st, du] of pat) {
        const amp = rnd(0.45, 0.65) * (st === 0 ? 1 : 0.85);
        const vel = chance(0.2) ? 1 : 0.6;
        v.forEach((n, k) => playNote(L, A, this.ep, 'ep', n, T(st) + k * 0.004 * Math.random(), du * bt, amp * 0.55, 0.25, det(), vel));
      }
    }
    // bass
    const ch0 = CH[B.chords[0]], nextB = this.form[this.bar % this.form.length], nRoot = (this.key + CH[nextB.chords[0]][0]) % 12;
    const bassN = (pc) => 31 + (((pc - 31) % 12) + 12) % 12;
    const r0 = bassN((this.key + ch0[0]) % 12), q0 = QUAL[ch0[1]];
    let line;
    const mode = B.sec === 'B' && this.groove === 'swing' ? 'walk' : this.groove === 'bossa' ? 'bossa' : 'two';
    if (B.chords.length > 1) {
      const r1 = bassN((this.key + CH[B.chords[1]][0]) % 12);
      line = [[0, 1, r0], [1, 1, r0 + q0[2]], [2, 1, r1], [3, 1, chance(0.5) ? r1 + 7 : bassN(nRoot) + pick([-1, 1])]];
    } else if (mode === 'walk') {
      const nr = bassN(nRoot);
      line = [[0, 1, r0], [1, 1, r0 + pick([q0[1], 2, q0[2]])], [2, 1, r0 + pick([q0[2], q0[3], 9])], [3, 1, nr + pick([-1, 1, -5])]];
    } else if (mode === 'bossa') {
      line = [[0, 1.4, r0], [1.5, 0.45, r0 + 7], [2, 1.4, r0], [3.5, 0.45, r0 + 7]];
    } else {
      line = [[0, 1.9, r0], [2, 1.9, chance(0.7) ? r0 + 7 : r0 + q0[1]]];
    }
    for (const [st, du, n] of line) playNote(L, A, this.bass, 'bass', clamp(n, 28, 55), T(st), du * bt * 0.95, rnd(0.7, 0.85), 0.08, det());
    // melody
    if (B.mel) {
      const transpose = 0;
      for (const [st, du, n] of B.mel) {
        if (B.varied && B.b === 6 && chance(0.4)) continue;
        playNote(L, A, this.leadBus, this.lead, n + transpose, T(st), du * bt * 0.92, rnd(0.55, 0.7), this.lead === 'flute' ? 0.12 : 0.4, det());
      }
    }
    // drums
    const D = (name, bp, g) => L.ev(name, T(bp), { g: g * rnd(0.85, 1.1), dest: this.drums });
    if (B.first && B.b === 0 && this.bar > 1) D('_m_crash', 0, 0.35);
    if (this.groove === 'swing') {
      for (const bp of [0, 1, 1.5, 2, 3, 3.5]) D('_m_ride', bp, bp % 1 ? 0.35 : 0.55);
      for (const bp of [1, 3]) D('_m_hat', bp, 0.6);
      for (const bp of [0, 1, 2, 3]) D('_m_brush', bp, bp % 2 ? 0.55 : 0.3);
      for (const bp of [0, 2]) D('_m_kick', bp, 0.45);
    } else {
      for (let k = 0; k < 8; k++) D('_m_shaker', k / 2, k % 2 ? 0.35 : 0.6);
      for (const bp of (this.bar % 2 ? [0, 1.5, 3] : [1, 2.5])) D('_m_rim', bp, 0.6);
      for (const bp of [0, 1.5, 2, 3.5]) D('_m_kick', bp, bp % 2 === 0 ? 0.55 : 0.35);
    }
    if (B.last) for (const bp of [3, 3.5, 3.75]) D('_m_brush', bp, 0.6);
  }
  tick(now, until) {
    if (!this.next || this.next < now - 0.5) this.next = now + 0.1;
    while (this.next < until) {
      this.scheduleBar(this.next);
      this.next += 4 * this.beat;
    }
  }
}

LOOPS.muzak = {
  bus: 'music', level: -8.5, params: { warble: 0 },
  build(L, p) {
    const A = L.A;
    const mix = L.gain(1);
    const ep = L.gain(0.7), bass = L.gain(0.8), leadBus = L.gain(0.6), drums = L.gain(0.8);
    L.chain(ep, L.panS(-0.2), mix);
    L.chain(bass, mix);
    L.chain(leadBus, L.panS(0.22), mix);
    L.chain(drums, L.panS(0.1), mix);
    // worn cassette: lowpass -> saturation -> wow/flutter delay -> hiss
    const lp = L.filter('lowpass', 7500, 0.6), hp = L.filter('highpass', 70, 0.6), sat = L.shaper(1.4), dl = L.delay(0.1, 0.02);
    L.chain(mix, hp, lp, sat, dl, L.out);
    const wow = L.lfo(0.55, 0.0008, dl.delayTime), flt = L.lfo(6.5, 0.00005, dl.delayTime), drift = L.rlfo(0.3, 0.0003, dl.delayTime);
    const drag = L.cs(0);
    drag.connect(dl.delayTime);
    const hissG = L.gain(0.004);
    L.chain(L.noise('p'), L.filter('highpass', 4500), hissG, L.out);
    const apply = (now) => {
      const w = clamp(p.warble, 0, 1);
      wow.gain.gain.setTargetAtTime(0.0008 + 0.004 * w, now, 0.3);
      flt.gain.gain.setTargetAtTime(0.00005 + 0.00025 * w, now, 0.3);
      drift.gain.gain.setTargetAtTime(0.0003 + 0.002 * w, now, 0.3);
      lp.frequency.setTargetAtTime(7500 - 4500 * w, now, 0.3);
      hissG.gain.setTargetAtTime(0.004 + 0.008 * w, now, 0.3);
    };
    apply(L.now());
    const mz = new Muzak(L, A, p, { ep, bass, leadBus, drums });
    // warm the sampler zones in the background
    for (const ins of ['ep', 'bass', 'vibes', 'flute']) {
      const lo = ins === 'bass' ? 30 : ins === 'ep' ? 48 : 63, hi = ins === 'bass' ? 57 : ins === 'ep' ? 78 : 90;
      for (let m = lo; m <= hi; m += 3) { warmNote(A, ins, m, 0.6); if (ins === 'ep') warmNote(A, ins, m, 1); }
    }
    let nextDrag = 0;
    return {
      set(k, v, now) { apply(now); },
      tick(now, until) {
        mz.tick(now, until);
        const w = clamp(p.warble, 0, 1);
        if (w > 0.4) {
          if (!nextDrag) nextDrag = now + rnd(3, 10);
          if (nextDrag < until) {
            const t = Math.max(nextDrag, now), depth = 0.006 + 0.012 * w;
            drag.offset.setTargetAtTime(depth, t, 0.25);
            drag.offset.setTargetAtTime(0, t + rnd(0.5, 1.2), 0.8);
            nextDrag = t + rnd(4, 14) / w;
          }
        } else nextDrag = 0;
      },
    };
  },
};

// ------------------------------------------------------------------ tension (horror chase score)
LOOPS.tension = {
  bus: 'music', level: -7, params: { intensity: 0 },
  build(L, p) {
    const A = L.A, master = L.gain(0), duck = L.gain(1);
    master.connect(L.out);
    duck.connect(master);
    // low drone
    const droneF = L.filter('lowpass', 250, 1.2), droneG = L.gain(0);
    for (const [f, d] of [[73.42, -4], [77.78, 3], [55, 0], [36.71, 0]]) L.osc('sawtooth', f, { det: d }).connect(droneF);
    L.rlfo(0.2, 80, droneF.frequency);
    L.chain(droneF, L.shaper(1.5), droneG, duck);
    // mid dissonant cluster (beating)
    const midG = L.gain(0);
    for (const f of [146.8, 155.6, 207.7, 220.4]) { const o = L.osc('triangle', f); L.rlfo(0.1, 12, o.detune); o.connect(midG); }
    L.chain(midG, L.filter('lowpass', 1200), duck);
    // shrieking strings (detuned saw cluster, vibrato, tremolo)
    const hiBp = L.filter('bandpass', 2600, 0.7), trem = L.gain(1), hiG = L.gain(0);
    const vibO = L.osc('sine', 5.7, { pitch: false }), vibG = L.gain(22);
    vibO.connect(vibG);
    for (const m of [86, 87, 89, 92, 93]) {
      const o = L.osc('sawtooth', mtof(m), { det: rnd(-10, 10) });
      vibG.connect(o.detune);
      L.rlfo(0.08, 60, o.detune);
      o.connect(hiBp);
    }
    L.chain(L.noise('w'), L.filter('bandpass', 3200, 2), L.gain(0.25), hiBp);
    const tl = L.lfo(13, 0, trem.gain);
    L.chain(hiBp, trem, hiG, master);
    let I = -1, nextHit = 0, nextStep = 0, step = 0, nextRise = 0;
    const apply = (now, tc = 0.4) => {
      I = clamp(p.intensity, 0, 1);
      master.gain.setTargetAtTime(I > 0.01 ? 1 : 0, now, I > 0.01 ? 0.05 : 0.6);
      droneG.gain.setTargetAtTime(0.35 * sstep(0.03, 0.35, I) * (1 - 0.5 * sstep(0.6, 1, I)), now, tc);
      droneF.frequency.setTargetAtTime(200 + 900 * I, now, tc);
      midG.gain.setTargetAtTime(0.12 * sstep(0.25, 0.55, I), now, tc);
      hiG.gain.setTargetAtTime(0.09 * sstep(0.5, 0.95, I) ** 1.5, now, tc);
      tl.gain.gain.setTargetAtTime(0.5 * sstep(0.6, 1, I), now, tc);
      tl.osc.frequency.setTargetAtTime(9 + 8 * I, now, tc);
    };
    apply(L.now(), 0.01);
    return {
      set(k, v, now) { apply(now); },
      tick(now, until) {
        const In = clamp(p.intensity, 0, 1);
        if (In !== I) apply(now);
        if (In > 0.25) {
          if (!nextHit) nextHit = now + rnd(0.5, 3);
          while (nextHit < until) {
            const e = In > 0.6 && chance(0.35) ? '_t_hit' : pick(['_t_boom', '_t_scrape', '_t_scrape']);
            L.ev(e, nextHit, { g: (0.4 + 0.6 * In) * rnd(0.6, 1), rate: rnd(0.85, 1.1), pan: rnd(-0.6, 0.6) });
            nextHit += Math.max(1.2, -Math.log(1 - Math.random() * 0.99) * lerp(9, 2.5, In));
          }
        } else nextHit = 0;
        if (In > 0.75) {
          if (!nextRise) nextRise = now + rnd(6, 14);
          if (nextRise < until) { L.ev('_t_riser', nextRise, { g: 0.5 }); nextRise += rnd(10, 20); }
        } else nextRise = 0;
        if (In > 0.55) {
          const bpm = lerp(100, 165, (In - 0.55) / 0.45), sd = 60 / bpm / 4;
          if (!nextStep || nextStep < now - 0.2) { nextStep = now + 0.05; step = 0; }
          while (nextStep < until) {
            const k = step % 16, t = nextStep, g = 0.5 + 0.5 * In;
            if ([0, 6, 8, 11].includes(k)) {
              L.ev('_t_kick', t, { g: g * (k === 0 ? 2.6 : 2.0) });
              duck.gain.setTargetAtTime(0.35, t, 0.004);
              duck.gain.setTargetAtTime(1, t + 0.05, 0.07);
            }
            if ((In > 0.7 ? [4, 10, 12, 14] : [4, 12]).includes(k)) L.ev('_t_tom', t, { g: g * 2.0, rate: k > 9 ? 1.12 : 1, pan: k > 9 ? 0.3 : -0.3 });
            if (In > 0.75 ? true : k % 2 === 0) L.ev('_t_tick', t, { g: g * (k % 4 === 2 ? 0.8 : 0.45), pan: 0.4 });
            if (In > 0.7 && [0, 3, 6, 10].includes(k)) {
              const n = Math.floor(step / 16) % 4 === 3 ? 39 : 38;
              playNote(L, A, master, 'stab', n + (k === 10 ? 1 : 0), t, 0.3, 0.8 * g, 0.08);
            }
            step++;
            nextStep += sd;
          }
        } else nextStep = 0;
      },
    };
  },
};

export { sampleNote };
