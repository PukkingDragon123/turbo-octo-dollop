// R.O.O.M. — the clone android's face plate, hand-painted (procedurally) to look like a real human
// face: layered skin tones (warm cheeks / nose, cool under-eyes and temples, a stubble shadow on the
// broad frame), baked form shading (sockets, nose sides, nasolabial folds, under-lip), pores,
// hair-stroke brows, lash lines + lashes, caruncles, soft realistic lips with vertical lip lines and a
// wet highlight. It is a little too even, a little asymmetric, and still split by the factory seam
// under the eyes and the ventriloquist jaw cuts: the uncanny part. 1024 x 1024 canvas per
// (face cosmetic x frame), cached. No photographs: everything is drawn with canvas primitives.
//
// UV layout: u = (th1 - th) / (th1 - th0) (mirrored so the canvas reads like the face seen from the
// front), v = (ph - ph0) / (ph1 - ph0). PLAIN_UV is a plain skin spot (forehead) for the eyelids.
import * as THREE from 'three';
import { cached, mkCanvas } from './kit.js';
import { RNG } from '../../core/rng.js';
import { FACE } from './robotshape.js';

const PI = Math.PI, TAU = PI * 2;
const N = 1024;
export const faceU = (th) => (FACE.th1 - th) / (FACE.th1 - FACE.th0);
export const faceV = (ph) => (ph - FACE.ph0) / (FACE.ph1 - FACE.ph0);
export const PLAIN_UV = [0.5, faceV(0.56)];
const FU = (th) => faceU(th) * N;
const FV = (ph) => (1 - faceV(ph)) * N;
const MONO = "'IBM Plex Mono', monospace";
const PX = N / (FACE.th1 - FACE.th0);   // px per radian of azimuth

// soft elliptical blob (radial gradient), canvas coordinates
function soft(x, cx, cy, rx, ry, rgb, a, rot = 0) {
  if (rx <= 0 || ry <= 0) return;
  x.save(); x.translate(cx, cy); x.rotate(rot); x.scale(1, ry / rx);
  const g = x.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(0.55, `rgba(${rgb},${a * 0.55})`); g.addColorStop(1, `rgba(${rgb},0)`);
  x.fillStyle = g; x.beginPath(); x.arc(0, 0, rx, 0, TAU); x.fill(); x.restore();
}
const blob = (x, th, ph, rx, ry, rgb, a, rot = 0) => soft(x, FU(th), FV(ph), rx, ry, rgb, a, rot);
function blurred(x, px, fn) {
  x.save();
  try { x.filter = `blur(${px}px)`; } catch (e) { /* no canvas filters */ }
  fn(); x.restore();
}

// mouth styles: corner lift (px at 1024, + up), width k, extras
const MOUTH = {
  smile: { lift: 7, w: 1 },
  grin: { lift: 16, w: 1.18, teeth: 1 },
  flat: { lift: 0, w: 0.95 },
  grumpy: { lift: -11, w: 0.98, frownL: true },
  shy: { lift: 5, w: 0.78 },
  cat: { lift: 6, w: 1.0, cat: true },
  gap: { lift: 12, w: 1.1, teeth: 2 },
  o: { lift: -4, w: 0.72 },
};

function paintFace(x, f, frame) {
  const rng = new RNG(31 + (f.id || 'x').length * 7 + (frame === 'masc' ? 3 : frame === 'fem' ? 11 : 0));
  const cyc = f.eyes === 'cyclops';
  const masc = frame === 'masc', fem = frame === 'fem';
  const cx = N / 2;
  // ---- base skin: warm centre, a touch paler forehead, darker toward the plate edge
  const g = x.createRadialGradient(cx, N * 0.5, 40, cx, N * 0.52, N * 0.7);
  g.addColorStop(0, '#f6dccb'); g.addColorStop(0.5, '#f0d1bd'); g.addColorStop(0.85, '#dcb7a0'); g.addColorStop(1, '#c49d86');
  x.fillStyle = g; x.fillRect(0, 0, N, N);
  const fh = x.createLinearGradient(0, 0, 0, FV(0.25));
  fh.addColorStop(0, 'rgba(250,232,214,0.55)'); fh.addColorStop(1, 'rgba(250,232,214,0)');
  x.fillStyle = fh; x.fillRect(0, 0, N, FV(0.25));
  // ---- blood: cheeks, nose, chin, ears side; cool: under-eyes, temples
  for (const s of [-1, 1]) {
    blob(x, s * 0.5, -0.12, 120, 95, '214,112,98', fem ? 0.3 : 0.22);
    blob(x, s * 0.47, -0.08, 60, 44, '226,120,104', f.blush ? 0.4 : 0.12);
    blob(x, s * 0.74, 0.32, 90, 140, '150,150,190', 0.08);          // temples (veins)
    blob(x, s * 0.92, -0.2, 70, 160, '200,120,110', 0.16);          // toward the ears
  }
  blob(x, 0, -0.18, 34, 52, '220,110,100', 0.3);                    // nose tip
  blob(x, 0, -0.72, 70, 44, '212,120,110', 0.16);                   // chin
  blob(x, 0, 0.42, 160, 70, '255,236,220', 0.18);                   // forehead sheen
  // ---- masc stubble shadow (blue-grey) over jaw / upper lip / chin
  if (masc) {
    for (const [th, ph, rx, ry, a] of [[0, -0.36, 120, 26, 0.24], [0, -0.66, 150, 90, 0.26], [-0.42, -0.56, 90, 120, 0.22], [0.42, -0.56, 90, 120, 0.22]]) blob(x, th, ph, rx, ry, '92,96,112', a);
    x.fillStyle = 'rgba(60,52,50,0.22)';
    for (let i = 0; i < 2600; i++) {
      const th = (rng.next() - 0.5) * 1.3, ph = -0.3 - rng.next() * 0.62;
      if (Math.abs(th) < 0.14 && ph > -0.34 && ph < -0.5) continue;
      const k = Math.abs(th) / 0.65 + Math.max(0, -0.32 - ph) * 0.4;
      if (k > 1.15 || (ph > -0.42 && Math.abs(th) > 0.32)) continue;
      x.fillRect(FU(th), FV(ph), 1.4, 1.4);
    }
  }
  // ---- form shading (baked light from above): sockets, nose sides, folds, under-lip, jaw
  blurred(x, 8, () => {
    for (const s of (cyc ? [0] : [-1, 1])) {
      const th = s * FACE.eyeTh * (cyc ? 0 : 1);
      blob(x, th + s * -0.13, FACE.eyePh + 0.03, 40, 56, '110,60,60', 0.45);       // inner corner (nose bridge side)
      blob(x, th, FACE.eyePh + 0.1, 104, 46, '140,88,86', 0.42);                    // upper lid crease / socket
      blob(x, th + s * 0.1, FACE.eyePh + 0.02, 60, 70, '120,80,84', 0.22);          // outer socket
      blob(x, th, FACE.eyePh - 0.11, 86, 30, f.id === 'sleepy' ? '110,70,120' : '120,86,116', f.id === 'sleepy' ? 0.55 : 0.34);   // under-eye
      blob(x, s * 0.82, 0.18, 60, 150, '120,90,90', 0.3);                             // temples turn away
    }
    blob(x, 0, -0.95, 300, 60, '120,80,76', 0.35);                                    // under the jaw
    for (const s of [-1, 1]) {
      blob(x, s * 0.1, -0.02, 18, 120, '150,92,84', 0.28);                           // sides of the nose bridge
      x.strokeStyle = 'rgba(150,84,76,0.38)'; x.lineWidth = 9; x.lineCap = 'round';
      x.beginPath(); x.moveTo(FU(s * 0.13), FV(-0.24)); x.quadraticCurveTo(FU(s * 0.3), FV(-0.33), FU(s * (0.33 + (masc ? 0.02 : 0))), FV(-0.47)); x.stroke();   // nasolabial
      blob(x, s * 0.62, -0.42, 70, 140, '140,92,84', 0.2);                           // under the cheekbones
    }
    blob(x, 0, -0.29, 46, 16, '110,52,52', 0.55);                                    // under the nose
    blob(x, 0, -0.56, 80, 22, '110,62,60', 0.5);                                     // under the lower lip
    for (const s of [-1, 1]) blob(x, s * 0.022, -0.33, 7, 30, '150,96,90', 0.35);    // philtrum ridges' groove
    blob(x, 0, 0.35, 140, 24, '150,108,96', 0.12);                                   // brow ridge underside
  });
  // highlights: bridge, tip, cheekbones, chin, cupid's bow
  blob(x, 0, 0.06, 16, 120, '255,244,232', 0.32);
  blob(x, 0.005, -0.18, 22, 18, '255,240,230', 0.3);
  for (const s of [-1, 1]) blob(x, s * 0.012, -0.33, 4, 26, '255,236,226', 0.35);   // philtrum ridges
  // fine lines: forehead, crow's feet, under-eye crease
  x.strokeStyle = 'rgba(150,100,90,0.12)'; x.lineWidth = 1.6;
  for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(FU(0.4), FV(0.46 + i * 0.05)); x.quadraticCurveTo(FU(0), FV(0.49 + i * 0.05), FU(-0.4), FV(0.46 + i * 0.05)); x.stroke(); }
  if (!cyc) for (const s of [-1, 1]) {
    for (let i = 0; i < (fem ? 1 : 3); i++) { x.beginPath(); x.moveTo(FU(s * 0.58), FV(FACE.eyePh + 0.02 - i * 0.04)); x.lineTo(FU(s * 0.66), FV(FACE.eyePh + 0.05 - i * 0.07)); x.stroke(); }
    x.beginPath(); x.moveTo(FU(s * 0.26), FV(FACE.eyePh - 0.1)); x.quadraticCurveTo(FU(s * 0.4), FV(FACE.eyePh - 0.16), FU(s * 0.52), FV(FACE.eyePh - 0.11)); x.stroke();
  }
  for (const s of [-1, 1]) blob(x, s * 0.5, 0.0, 60, 26, '255,240,228', 0.28, s * -0.3);
  blob(x, 0, -0.74, 34, 18, '255,240,230', 0.3);
  // ---- pores and fine mottling
  for (let i = 0; i < 9000; i++) {
    const px = rng.next() * N, py = rng.next() * N, d = rng.next();
    x.fillStyle = d < 0.5 ? 'rgba(120,70,60,0.07)' : 'rgba(255,240,230,0.07)';
    x.fillRect(px, py, 1 + (d * 3 | 0) * 0.5, 1 + (d * 3 | 0) * 0.5);
  }
  for (let i = 0; i < 60; i++) blob(x, (rng.next() - 0.5) * 2, -0.9 + rng.next() * 1.5, 10 + rng.next() * 40, 10 + rng.next() * 40, rng.next() < 0.5 ? '200,120,110' : '240,220,200', 0.04 + rng.next() * 0.05);
  if (f.freckles) {
    for (let i = 0; i < 90; i++) {
      const s = i % 2 ? 1 : -1, th = s * (0.06 + rng.next() * 0.5), ph = 0.02 - rng.next() * 0.26 + (Math.abs(th) < 0.12 ? 0.08 : 0);
      x.fillStyle = `rgba(${130 + rng.next() * 30 | 0},${70 + rng.next() * 20 | 0},46,${0.25 + rng.next() * 0.35})`;
      x.beginPath(); x.ellipse(FU(th), FV(ph), 1.5 + rng.next() * 3, 1.2 + rng.next() * 2.5, rng.next() * PI, 0, TAU); x.fill();
    }
  }
  // ---- eyes: lid crease, lash lines, lashes, caruncle, waterline (around the glass eyeballs)
  const er = (cyc ? 1.5 : 1) * 0.0125 / 0.085 * PX;   // eye opening radius in px
  const eyes = cyc ? [[0, FACE.eyePh + 0.03, 1, 0]] : [[-FACE.eyeTh, FACE.eyePh, 1, 0], [FACE.eyeTh, FACE.eyePh + 0.006, f.eyes === 'mismatch' ? 1.16 : f.eyes === 'button' ? 1.18 : 1, 1]];
  for (const [th, ph, k] of eyes) {
    const ecx = FU(th), ecy = FV(ph), s = th <= 0 ? -1 : 1;   // s: character side (-1 left); on canvas the outer corner is at -s
    const w = er * 1.18 * k, h = er * 0.78 * k;
    x.save(); x.translate(ecx, ecy);
    // eyelid crease
    blurred(x, 1.5, () => {
      x.strokeStyle = 'rgba(120,70,64,0.5)'; x.lineWidth = 3;
      x.beginPath(); x.ellipse(0, -h * 0.25, w * 1.08, h * 1.25, 0, PI * 1.08, PI * 1.92); x.stroke();
    });
    // eyeshadow (fem: a soft taupe wash)
    if (fem) soft(x, 0, -h * 0.6, w * 1.1, h * 0.8, '140,96,100', 0.24);
    // caruncle (inner corner, toward the nose: canvas +s side)
    soft(x, s * w * 0.95, h * 0.1, 9, 7, '214,120,120', 0.8);
    // upper lid skin shadow + smudged lash line
    blurred(x, 3, () => {
      x.strokeStyle = 'rgba(60,34,30,0.55)'; x.lineWidth = fem ? 10 : 8; x.lineCap = 'round';
      x.beginPath(); x.ellipse(0, h * 0.14, w * 0.98, h, 0, PI * 1.06, PI * 1.94); x.stroke();
    });
    x.strokeStyle = 'rgba(26,16,14,0.9)'; x.lineCap = 'round';
    x.lineWidth = fem ? 4 : 2.8;
    x.beginPath(); x.ellipse(0, h * 0.12, w, h, 0, PI * 1.05, PI * 1.95); x.stroke();
    // waterline + soft lower lid rim
    blurred(x, 2, () => {
      x.lineWidth = 3; x.strokeStyle = 'rgba(200,120,112,0.45)';
      x.beginPath(); x.ellipse(0, -h * 0.12, w * 0.93, h * 0.88, 0, PI * 0.12, PI * 0.88); x.stroke();
      x.lineWidth = 2; x.strokeStyle = 'rgba(80,46,40,0.35)';
      x.beginPath(); x.ellipse(0, -h * 0.04, w * 0.97, h * 0.95, 0, PI * 0.1, PI * 0.9); x.stroke();
    });
    // upper lashes: a dense fringe of fine curved hairs, longer and swept out toward the outer corner
    const nUp = fem ? 90 : masc ? 46 : 64, lenUp = fem ? 20 : masc ? 9 : 13;
    for (let i = 0; i < nUp; i++) {
      const t = rng.next(), a = PI * (1.08 + t * 0.84);
      const outer = (Math.cos(a) * -s + 1) / 2;   // 0 inner .. 1 outer
      const px = Math.cos(a) * w, py = Math.sin(a) * h + h * 0.12;
      const L = lenUp * (0.35 + 0.85 * outer) * (0.7 + rng.next() * 0.5);
      const dx = Math.cos(a) * 0.35 - s * outer * 0.55, dy = -1;
      x.strokeStyle = `rgba(20,12,10,${0.45 + rng.next() * 0.4})`;
      x.lineWidth = 0.7 + rng.next() * 0.7;
      x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + dx * L * 0.3, py + dy * L * 0.7, px + dx * L * 1.1 - s * outer * 4, py + dy * L * 0.9); x.stroke();
    }
    x.strokeStyle = 'rgba(40,26,22,0.3)'; x.lineWidth = 0.7;
    for (let i = 0; i < (fem ? 22 : 12); i++) {
      const a = PI * (0.18 + rng.next() * 0.64), px = Math.cos(a) * w * 0.96, py = Math.sin(a) * h * 0.92 - h * 0.05;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * 2, py + 3 + rng.next() * 4); x.stroke();
    }
    if (f.eyes === 'button') {
      x.strokeStyle = 'rgba(30,20,16,0.8)'; x.lineWidth = 3;
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.2; x.beginPath(); x.moveTo(Math.cos(a) * w * 1.1, Math.sin(a) * h * 1.3); x.lineTo(Math.cos(a) * w * 1.4, Math.sin(a) * h * 1.7); x.stroke(); }
    }
    x.restore();
  }
  // ---- brows: hair strokes following the growth direction (inner: upward, outer: sweeping out/down)
  const browC = masc ? '46,32,26' : fem ? '70,48,36' : '58,40,30';
  for (const s of (cyc ? [0] : [-1, 1])) {
    const bth = s * FACE.browTh, bph = FACE.browPh + (s > 0 ? 0.008 : 0);
    const half = (masc ? 0.18 : fem ? 0.16 : 0.17) * PX, thick = (masc ? 26 : fem ? 15 : 20);
    const arch = fem ? 16 : masc ? 4 : 9;
    const bx = FU(bth), by = FV(bph) + 6;
    blurred(x, 5, () => soft(x, bx, by, half * 1.05, thick * 1.3, browC, 0.35));
    const nH = masc ? 900 : fem ? 520 : 700;
    for (let i = 0; i < nH; i++) {
      const t = rng.next() * 2 - 1;                 // -1 inner .. 1 outer (in character space)
      const cxp = bx + -s * t * half, inner = (1 - t) / 2;
      const prof = Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, t), 2.2)));   // tapers at the tail
      const cyp = by - arch * (1 - t * t) + t * 4 + (rng.next() - 0.5) * thick * (0.5 + inner * 0.6) * prof;
      const ang = -PI / 2 + -s * (0.25 + (1 - inner) * 1.05);     // inner hairs point up, outer hairs sweep outward
      const L = (masc ? 13 : 10) * (0.6 + rng.next() * 0.7);
      x.strokeStyle = `rgba(${browC},${0.32 + rng.next() * 0.45})`;
      x.lineWidth = 0.9 + rng.next() * 0.9;
      x.beginPath(); x.moveTo(cxp, cyp); x.quadraticCurveTo(cxp + Math.cos(ang) * L * 0.5, cyp + Math.sin(ang) * L * 0.5, cxp + Math.cos(ang + -s * 0.3) * L, cyp + Math.sin(ang + -s * 0.3) * L + 2); x.stroke();
    }
  }
  if (f.browRot > 0.3 || f.id === 'grumpy') blob(x, 0, FACE.browPh - 0.04, 28, 30, '130,80,70', 0.3);   // frown furrow
  // ---- nose: nostrils, alar creases, tip
  for (const s of [-1, 1]) {
    soft(x, FU(s * 0.04), FV(-0.272), 15, 8, '62,30,28', 0.7, s * 0.3);
    soft(x, FU(s * 0.078), FV(-0.24), 14, 26, '140,74,68', 0.45, s * 0.4);
  }
  if (f.mouth === 'cat') {
    x.fillStyle = 'rgba(200,110,130,0.85)'; x.beginPath(); x.moveTo(FU(-0.05), FV(-0.19)); x.lineTo(FU(0.05), FV(-0.19)); x.lineTo(FU(0), FV(-0.235)); x.closePath(); x.fill();
    x.strokeStyle = 'rgba(40,26,22,0.7)'; x.lineWidth = 2;
    for (const s of [-1, 1]) for (let i = -1; i <= 1; i++) { x.beginPath(); x.moveTo(FU(s * 0.2), FV(-0.27 + i * 0.03)); x.lineTo(FU(s * 0.5), FV(-0.24 + i * 0.07)); x.stroke(); }
  }
  // ---- lips (soft-edged, no outline), parting line on the jaw cut
  const M = MOUTH[f.mouth] || MOUTH.smile;
  const my = FV(FACE.mouth) + 2, mw = FACE.mouthW * M.w * (fem ? 0.94 : masc ? 1.04 : 1);
  const L = FU(mw), R = FU(-mw), C = FU(0) + 3;
  const lift = M.lift;
  const yAt = (t) => my - lift * t * t;
  const upH = fem ? 40 : masc ? 30 : 35, loH = fem ? 50 : masc ? 40 : 46;
  const lipCol = fem ? ['176,74,84', '198,96,104', '150,58,70'] : masc ? ['168,98,96', '182,112,108', '140,78,78'] : ['172,86,90', '192,104,106', '146,66,74'];
  if (M.cat) {
    x.strokeStyle = 'rgba(90,34,40,0.9)'; x.lineWidth = 4;
    x.beginPath(); x.moveTo(L, my - 3); x.quadraticCurveTo((L + C) / 2, my + 12, C, my - 1); x.quadraticCurveTo((R + C) / 2, my + 12, R, my - 3); x.stroke();
  } else {
    const lip = (top) => {
      x.beginPath();
      x.moveTo(L, yAt(1));
      if (top) {
        x.bezierCurveTo((L + C) / 2, my - upH * 0.9, C - 18, my - upH * 1.05, C, my - upH * 0.7);   // cupid's bow
        x.bezierCurveTo(C + 18, my - upH * 1.05, (R + C) / 2, my - upH * 0.9, R, yAt(1));
        x.quadraticCurveTo(C, my + 4, L, yAt(1));
      } else {
        x.quadraticCurveTo(C, my + 4, R, yAt(1));
        x.bezierCurveTo((R + C) / 2 - 8, my + loH - lift * 0.4, (L + C) / 2 + 8, my + loH - lift * 0.4, L, yAt(1));
      }
      x.closePath();
      const lg = x.createLinearGradient(0, my - upH, 0, my + loH);
      lg.addColorStop(0, `rgba(${lipCol[0]},0.85)`); lg.addColorStop(0.45, `rgba(${lipCol[2]},0.95)`); lg.addColorStop(0.6, `rgba(${lipCol[1]},0.9)`); lg.addColorStop(1, `rgba(${lipCol[0]},0.7)`);
      x.fillStyle = lg; x.fill();
    };
    blurred(x, 3.5, () => { lip(true); lip(false); });
    // vermilion border: a faint darker rim, then the inner wet darkening toward the parting line
    x.save(); x.globalAlpha = 0.18; x.strokeStyle = '#6a2a30'; x.lineWidth = 2; lip(true); x.stroke(); lip(false); x.stroke(); x.restore();
    soft(x, C, my + 4, (R - L) * 0.42, 9, '90,26,34', 0.5);
    // vertical lip lines
    x.strokeStyle = 'rgba(110,40,48,0.25)'; x.lineWidth = 1;
    for (let i = 0; i < 46; i++) {
      const t = rng.next() * 2 - 1, px = C + (R - C) * Math.max(0, t) + (L - C) * Math.max(0, -t);
      const top = rng.next() < 0.45, y0 = yAt(Math.abs(t)) + (top ? -2 : 3), l = (top ? upH : loH) * (0.3 + 0.5 * (1 - t * t)) * rng.next();
      x.beginPath(); x.moveTo(px, y0); x.lineTo(px + (rng.next() - 0.5) * 2, y0 + (top ? -l : l)); x.stroke();
    }
    if (M.teeth) {
      x.fillStyle = '#efe8da';
      x.beginPath(); x.moveTo(L + 14, yAt(0.8) - 1); x.quadraticCurveTo(C, my + 6, R - 14, yAt(0.8) - 1); x.quadraticCurveTo(C, my + 16, L + 14, yAt(0.8) - 1); x.fill();
      x.strokeStyle = 'rgba(150,130,120,0.6)'; x.lineWidth = 1.2;
      const n = M.teeth === 2 ? 0 : 9;
      for (let i = 1; i < n; i++) { const px = L + (R - L) * (i / n); x.beginPath(); x.moveTo(px, my - 1); x.lineTo(px, my + 10); x.stroke(); }
      if (M.teeth === 2) { x.fillStyle = 'rgba(40,20,20,0.9)'; x.fillRect(C - 3, my - 1, 6, 12); }
    }
    x.strokeStyle = 'rgba(70,24,30,0.85)'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(L + 2, yAt(1) - 1); x.quadraticCurveTo(C, my + 4, R - 2, yAt(1) - 1); x.stroke();
    // corners + wet highlight
    for (const px of [L, R]) soft(x, px, yAt(1), 9, 7, '90,40,40', 0.6);
    soft(x, C + 6, my + loH * 0.5, 30, 6, '255,236,236', 0.45);
    soft(x, C - 22, my - upH * 0.95, 10, 3, '255,240,236', 0.35);
  }
  if (M.frownL) {
    x.strokeStyle = 'rgba(110,64,56,0.3)'; x.lineWidth = 3;
    for (const s of [-1, 1]) { x.beginPath(); x.moveTo(FU(s * 0.3), FV(-0.46)); x.quadraticCurveTo(FU(s * 0.32), FV(-0.56), FU(s * 0.28), FV(-0.66)); x.stroke(); }
  }
  // ---- the machine shows through: jaw cuts, the mould seam under the eyes, temple seams
  x.strokeStyle = 'rgba(52,30,26,0.8)'; x.lineWidth = 3;
  const jy = FV(FACE.mouth);
  for (const s of [-1, 1]) { x.beginPath(); x.moveTo(FU(s * FACE.jawTh), jy); x.lineTo(FU(s * FACE.jawTh), N); x.stroke(); }
  x.beginPath(); x.moveTo(FU(-FACE.jawTh), jy); x.lineTo(L, yAt(1)); x.moveTo(R, yAt(1)); x.lineTo(FU(FACE.jawTh), jy); x.stroke();
  x.strokeStyle = 'rgba(90,60,50,0.32)'; x.lineWidth = 2;
  x.beginPath(); x.moveTo(0, FV(FACE.seamPh)); x.lineTo(N, FV(FACE.seamPh)); x.stroke();
  x.strokeStyle = 'rgba(255,240,230,0.25)'; x.lineWidth = 1;
  x.beginPath(); x.moveTo(0, FV(FACE.seamPh) - 3); x.lineTo(N, FV(FACE.seamPh) - 3); x.stroke();
  x.strokeStyle = 'rgba(80,50,40,0.22)'; x.lineWidth = 2;
  for (const s of [-1, 1]) { x.beginPath(); x.moveTo(FU(s * 0.76), FV(0.44)); x.quadraticCurveTo(FU(s * 0.82), FV(0.0), FU(s * 0.7), FV(-0.44)); x.stroke(); }
  // hairline shadow at the top of the plate
  const hl = x.createLinearGradient(0, 0, 0, FV(0.5));
  hl.addColorStop(0, 'rgba(70,46,36,0.45)'); hl.addColorStop(1, 'rgba(70,46,36,0)');
  x.fillStyle = hl; x.fillRect(0, 0, N, FV(0.5));
  if (f.scar) {
    x.strokeStyle = 'rgba(60,30,28,0.85)'; x.lineWidth = 3;
    x.beginPath(); let th = -0.18, ph = 0.6; x.moveTo(FU(th), FV(ph));
    for (let i = 0; i < 9; i++) { th -= 0.05 + rng.next() * 0.02; ph -= 0.08 + rng.next() * 0.03; x.lineTo(FU(th + (rng.next() - 0.5) * 0.04), FV(ph)); }
    x.stroke();
    x.save(); x.translate(FU(0.55), FV(-0.22)); x.rotate(0.35);
    x.fillStyle = '#8a8e92'; x.fillRect(-52, -18, 104, 36);
    x.strokeStyle = 'rgba(60,62,66,0.6)'; x.lineWidth = 1; for (let i = -48; i < 52; i += 6) { x.beginPath(); x.moveTo(i, -18); x.lineTo(i + 4, 18); x.stroke(); }
    x.restore();
  }
  // tiny factory serial on the jaw corner + QC dot
  x.save(); x.translate(FU(-0.86), FV(-0.52)); x.rotate(1.25);
  x.fillStyle = 'rgba(90,60,52,0.45)'; x.font = `bold 18px ${MONO}`; x.textAlign = 'center';
  x.fillText('RC-' + ((f.id || 'x').charCodeAt(0) * 7 % 90 + 10) + '/' + (masc ? 'M' : fem ? 'F' : 'N'), 0, 0); x.restore();
  x.fillStyle = 'rgba(70,150,80,0.6)'; x.beginPath(); x.arc(FU(0.9), FV(-0.62), 6, 0, TAU); x.fill();
  // plate edge: dark gap fading in
  const e = x.createLinearGradient(0, 0, N, 0);
  e.addColorStop(0, 'rgba(36,24,20,0.95)'); e.addColorStop(0.035, 'rgba(36,24,20,0)'); e.addColorStop(0.965, 'rgba(36,24,20,0)'); e.addColorStop(1, 'rgba(36,24,20,0.95)');
  x.fillStyle = e; x.fillRect(0, 0, N, N);
  const ev = x.createLinearGradient(0, 0, 0, N);
  ev.addColorStop(0, 'rgba(36,24,20,0.85)'); ev.addColorStop(0.03, 'rgba(36,24,20,0)'); ev.addColorStop(0.975, 'rgba(36,24,20,0)'); ev.addColorStop(1, 'rgba(36,24,20,0.95)');
  x.fillStyle = ev; x.fillRect(0, 0, N, N);
  // plain lid skin spot
  x.fillStyle = '#eccab6'; x.fillRect(PLAIN_UV[0] * N - 12, (1 - PLAIN_UV[1]) * N - 12, 24, 24);
}

export function faceTexture(entry = {}, frame = 'neutral') {
  return cached('rface2_' + (entry.id || 'dots') + '_' + frame, () => {
    const c = mkCanvas(N, N), ctx = c.getContext('2d');
    paintFace(ctx, entry, frame);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true;
    if (typeof document !== 'undefined' && document.fonts && document.fonts.status !== 'loaded') {
      document.fonts.ready.then(() => { ctx.clearRect(0, 0, N, N); paintFace(ctx, entry, frame); t.needsUpdate = true; });
    }
    return t;
  });
}
