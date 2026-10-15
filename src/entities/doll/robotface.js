// R.O.O.M. — the clone android's painted porcelain face plate (512 x 512 canvas, one per face
// cosmetic, cached). Cheap mass-production paint: a calm painted smile split by the ventriloquist
// jaw cut, eyeliner + lashes round the glass eyes, faint blush, a factory seam right across the face
// under the eyes, chipped glaze, a jaw serial and a dark gap along the plate edge.
//
// UV layout: u = (th1 - th) / (th1 - th0) (mirrored so painted text reads correctly from the front),
// v = (ph - ph0) / (ph1 - ph0). PLAIN_UV is a clean porcelain spot (forehead) for eyelids.
import * as THREE from 'three';
import { cached, mkCanvas } from './kit.js';
import { RNG } from '../../core/rng.js';
import { FACE } from './robotshape.js';

const PI = Math.PI, TAU = PI * 2;
const N = 512;
export const faceU = (th) => (FACE.th1 - th) / (FACE.th1 - FACE.th0);
export const faceV = (ph) => (ph - FACE.ph0) / (FACE.ph1 - FACE.ph0);
export const PLAIN_UV = [0.5, faceV(0.56)];
const FU = (th) => faceU(th) * N;
const FV = (ph) => (1 - faceV(ph)) * N;
const MONO = "'IBM Plex Mono', monospace";

function blob(x, th, ph, rx, ry, rgb, a) {
  const cx = FU(th), cy = FV(ph);
  const r = x.createRadialGradient(cx, cy, 0, cx, cy, rx);
  r.addColorStop(0, `rgba(${rgb},${a})`); r.addColorStop(1, `rgba(${rgb},0)`);
  x.save(); x.translate(cx, cy); x.scale(1, ry / rx); x.translate(-cx, -cy);
  x.fillStyle = r; x.beginPath(); x.arc(cx, cy, rx, 0, TAU); x.fill(); x.restore();
}

// mouth styles: corner lift (px, + up), width k, extras
const MOUTH = {
  smile: { lift: 4, w: 1 },
  grin: { lift: 9, w: 1.3, teeth: 1 },
  flat: { lift: 0, w: 0.95 },
  grumpy: { lift: -6, w: 1.0, frownL: true },
  shy: { lift: 3, w: 0.62 },
  cat: { lift: 3, w: 1.05, cat: true },
  gap: { lift: 7, w: 1.15, teeth: 2 },
  o: { lift: -3, w: 0.7 },
};

function paintFace(x, f) {
  const rng = new RNG(31 + (f.id || 'x').length * 7);
  const cyc = f.eyes === 'cyclops';
  // porcelain base: warm in the middle, cooler and greyer toward the plate edge
  const g = x.createRadialGradient(N / 2, N * 0.5, 30, N / 2, N * 0.5, N * 0.66);
  g.addColorStop(0, '#f5f0e6'); g.addColorStop(0.65, '#eee5d6'); g.addColorStop(1, '#d9cdb9');
  x.fillStyle = g; x.fillRect(0, 0, N, N);
  // faint mottling + yellowed patches (aged glaze)
  for (let i = 0; i < 70; i++) {
    const th = FACE.th0 + rng.next() * (FACE.th1 - FACE.th0), ph = FACE.ph0 + rng.next() * (FACE.ph1 - FACE.ph0);
    blob(x, th, ph, 8 + rng.next() * 40, 8 + rng.next() * 40, rng.next() < 0.5 ? '210,190,150' : '255,255,250', 0.05 + rng.next() * 0.06);
  }
  // blush (cheap round cheek paint)
  const blush = f.blush ? 0.45 : 0.16;
  for (const s of [-1, 1]) blob(x, s * 0.52, -0.15, f.blush ? 52 : 60, f.blush ? 40 : 38, '214,118,118', blush);
  // eyes: socket shadow, eyeshadow, eyeliner almond, lashes (none at the cyclops' normal spots)
  const eyes = cyc ? [[0, FACE.eyePh + 0.03, 1.55]] : [[-FACE.eyeTh, FACE.eyePh, 1], [FACE.eyeTh, FACE.eyePh, f.eyes === 'mismatch' ? 1.16 : f.eyes === 'button' ? 1.18 : 1]];
  for (const [th, ph, k] of eyes) {
    const s = th < 0 ? -1 : 1;
    blob(x, th, ph, 46 * k, 36 * k, '96,80,90', 0.2);
    if (f.id === 'sleepy') blob(x, th, ph + 0.06, 42, 22, '90,60,110', 0.35);
    if (f.id === 'grumpy' || f.id === 'sleepy') blob(x, th, ph - 0.1, 34, 14, '80,60,70', 0.28);
    x.save(); x.translate(FU(th), FV(ph));
    x.strokeStyle = 'rgba(38,24,20,0.9)'; x.lineWidth = 3.2; x.lineCap = 'round';
    x.beginPath(); x.ellipse(0, 1, 31 * k, 23 * k, 0, PI * 1.05, PI * 1.95); x.stroke();
    x.lineWidth = 1.5; x.strokeStyle = 'rgba(60,36,30,0.55)';
    x.beginPath(); x.ellipse(0, 0, 30 * k, 21 * k, 0, PI * 0.12, PI * 0.88); x.stroke();
    // lashes on the outer upper corner (canvas x is mirrored: the outer side is -s on the canvas)
    x.strokeStyle = 'rgba(28,16,14,0.9)'; x.lineWidth = 1.6;
    for (let i = 0; i < 4; i++) {
      const a = PI * (1.12 + i * 0.07), ex = Math.cos(a) * 31 * k, ey = Math.sin(a) * 23 * k;
      const ox = -s * Math.abs(ex);
      x.beginPath(); x.moveTo(ox, ey); x.lineTo(ox - s * 5, ey - 6); x.stroke();
    }
    if (f.eyes === 'button') {
      // crude stitch marks round the button eyes
      x.strokeStyle = 'rgba(30,20,16,0.8)'; x.lineWidth = 2;
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.2; x.beginPath(); x.moveTo(Math.cos(a) * 34, Math.sin(a) * 30); x.lineTo(Math.cos(a) * 44, Math.sin(a) * 39); x.stroke(); }
    }
    x.restore();
  }
  // brow shadow (the brows themselves are moving plastic pieces)
  for (const s of (cyc ? [0] : [-1, 1])) blob(x, s * FACE.browTh, FACE.browPh - 0.04, 34, 12, '90,70,60', 0.14);
  // nose: nostrils + philtrum
  for (const s of [-1, 1]) blob(x, s * 0.036, -0.275, 6, 4, '60,36,32', 0.6);
  blob(x, 0, -0.33, 9, 16, '150,110,100', 0.12);
  if (f.mouth === 'cat') {
    x.fillStyle = 'rgba(200,110,130,0.85)'; x.beginPath(); x.moveTo(FU(-0.05), FV(-0.19)); x.lineTo(FU(0.05), FV(-0.19)); x.lineTo(FU(0), FV(-0.235)); x.closePath(); x.fill();
    x.strokeStyle = 'rgba(40,26,22,0.8)'; x.lineWidth = 1.6;
    for (const s of [-1, 1]) for (let i = -1; i <= 1; i++) { x.beginPath(); x.moveTo(FU(s * 0.2), FV(-0.27 + i * 0.03)); x.lineTo(FU(s * 0.5), FV(-0.24 + i * 0.07)); x.stroke(); }
  }
  if (f.freckles) {
    x.fillStyle = 'rgba(120,70,46,0.6)';
    for (let i = 0; i < 28; i++) { const s = i % 2 ? 1 : -1; const th = s * (0.12 + rng.next() * 0.38), ph = -0.02 - rng.next() * 0.2; x.beginPath(); x.arc(FU(th), FV(ph), 1.6 + rng.next() * 1.4, 0, TAU); x.fill(); }
  }
  // lips: painted slightly off-register from the sculpted lips (a cheap pad print)
  const M = MOUTH[f.mouth] || MOUTH.smile;
  const my = FV(FACE.mouth) + 1.5, mw = FACE.mouthW * M.w, off = 2.5;
  const L = FU(mw), R = FU(-mw), C = FU(0) + off;
  const lift = M.lift;
  const yAt = (t) => my - lift * t * t;   // t = -1..1 along the mouth
  if (M.cat) {
    x.strokeStyle = 'rgba(70,24,34,0.95)'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(L, my - 3); x.quadraticCurveTo((L + C) / 2, my + 9, C, my - 1); x.quadraticCurveTo((R + C) / 2, my + 9, R, my - 3); x.stroke();
  } else {
    const lip = (top) => {
      x.beginPath();
      x.moveTo(L, yAt(1));
      if (top) {
        x.bezierCurveTo((L + C) / 2, my - 11, C - 9, my - 9, C, my - 7);
        x.bezierCurveTo(C + 9, my - 9, (R + C) / 2, my - 11, R, yAt(1));
        x.quadraticCurveTo(C, my + 3, L, yAt(1));
      } else {
        x.quadraticCurveTo(C, my + 3, R, yAt(1));
        x.bezierCurveTo((R + C) / 2 - 4, my + 15 - lift * 0.4, (L + C) / 2 + 4, my + 15 - lift * 0.4, L, yAt(1));
      }
      x.closePath();
      const lg = x.createLinearGradient(0, my - 12, 0, my + 16);
      lg.addColorStop(0, '#a4505e'); lg.addColorStop(0.5, '#b8606a'); lg.addColorStop(1, '#8c3c4a');
      x.fillStyle = lg; x.fill();
    };
    lip(true); lip(false);
    if (M.teeth) {
      // painted teeth between the lips: a too-even white bar with grey separators
      x.fillStyle = '#f4f0e4';
      x.beginPath(); x.moveTo(L + 8, yAt(0.8) - 1); x.quadraticCurveTo(C, my + 4, R - 8, yAt(0.8) - 1); x.quadraticCurveTo(C, my + 10, L + 8, yAt(0.8) - 1); x.fill();
      x.strokeStyle = 'rgba(120,110,100,0.7)'; x.lineWidth = 1;
      const n = M.teeth === 2 ? 2 : 8;
      for (let i = 1; i < n; i++) { const t = M.teeth === 2 ? 0.5 : i / n, px = L + (R - L) * (M.teeth === 2 ? (i === 1 ? 0.5 : 0.5) : t); x.beginPath(); x.moveTo(px, my - 1); x.lineTo(px, my + 7); x.stroke(); }
      if (M.teeth === 2) { x.fillStyle = 'rgba(40,20,20,0.9)'; x.fillRect(C - 1.5, my - 1, 3, 8); }
    }
    // the parting line (drawn exactly on the jaw cut, not on the paint)
    x.strokeStyle = 'rgba(64,22,30,0.9)'; x.lineWidth = 2.2;
    x.beginPath(); x.moveTo(L + 1, yAt(1) - 1); x.quadraticCurveTo(C, my + 3, R - 1, yAt(1) - 1); x.stroke();
    blob(x, 0.02, -0.465, 16, 5, '255,240,240', 0.3);   // lower-lip gloss
  }
  if (M.frownL) {
    x.strokeStyle = 'rgba(90,60,50,0.35)'; x.lineWidth = 2;
    for (const s of [-1, 1]) { x.beginPath(); x.moveTo(FU(s * 0.14), FV(-0.24)); x.quadraticCurveTo(FU(s * 0.27), FV(-0.33), FU(s * 0.3), FV(-0.44)); x.stroke(); }
  }
  // ventriloquist jaw cut: from the mouth line straight down to the chin edge
  x.strokeStyle = 'rgba(44,30,26,0.85)'; x.lineWidth = 2.4;
  const jy = FV(FACE.mouth);
  for (const s of [-1, 1]) { x.beginPath(); x.moveTo(FU(s * FACE.jawTh), jy); x.lineTo(FU(s * FACE.jawTh), N); x.stroke(); }
  x.beginPath(); x.moveTo(FU(-FACE.jawTh), jy); x.lineTo(L, yAt(1)); x.moveTo(R, yAt(1)); x.lineTo(FU(FACE.jawTh), jy); x.stroke();
  // the seam across the face under the eyes (mould parting line)
  x.strokeStyle = 'rgba(70,56,46,0.55)'; x.lineWidth = 2;
  x.beginPath(); x.moveTo(0, FV(FACE.seamPh)); x.lineTo(N, FV(FACE.seamPh)); x.stroke();
  x.strokeStyle = 'rgba(255,252,244,0.4)'; x.lineWidth = 1;
  x.beginPath(); x.moveTo(0, FV(FACE.seamPh) - 2); x.lineTo(N, FV(FACE.seamPh) - 2); x.stroke();
  // panel seams at the temples
  x.strokeStyle = 'rgba(60,50,40,0.3)'; x.lineWidth = 1.5;
  for (const s of [-1, 1]) { x.beginPath(); x.moveTo(FU(s * 0.74), FV(0.42)); x.quadraticCurveTo(FU(s * 0.8), FV(0.0), FU(s * 0.68), FV(-0.42)); x.stroke(); }
  // chipped glaze + scratches
  for (const [th, ph, r] of [[0.0, -0.2, 3], [0.06, -0.78, 4], [-0.62, -0.3, 3], [0.55, 0.42, 2.5]]) {
    x.fillStyle = 'rgba(150,140,124,0.7)'; x.beginPath();
    for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU, rr = r * (0.6 + rng.next() * 0.7); x.lineTo(FU(th) + Math.cos(a) * rr, FV(ph) + Math.sin(a) * rr); }
    x.closePath(); x.fill();
  }
  x.strokeStyle = 'rgba(120,108,96,0.25)'; x.lineWidth = 0.8;
  for (let i = 0; i < 16; i++) { const px = rng.next() * N, py = rng.next() * N, a = rng.next() * PI, l = 6 + rng.next() * 22; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke(); }
  if (f.scar) {
    // a crack across the face (repaired: the staples are geometry), grey tape on the cheek
    x.strokeStyle = 'rgba(40,30,26,0.9)'; x.lineWidth = 2.2;
    x.beginPath(); let th = -0.18, ph = 0.6; x.moveTo(FU(th), FV(ph));
    for (let i = 0; i < 9; i++) { th -= 0.05 + rng.next() * 0.02; ph -= 0.08 + rng.next() * 0.03; x.lineTo(FU(th + (rng.next() - 0.5) * 0.04), FV(ph)); }
    x.stroke();
    x.save(); x.translate(FU(0.55), FV(-0.22)); x.rotate(0.35);
    x.fillStyle = '#8a8e92'; x.fillRect(-26, -9, 52, 18);
    x.strokeStyle = 'rgba(60,62,66,0.6)'; x.lineWidth = 0.7; for (let i = -24; i < 26; i += 3) { x.beginPath(); x.moveTo(i, -9); x.lineTo(i + 2, 9); x.stroke(); }
    x.restore();
  }
  // factory serial on the jaw corner + a QC sticker dot under the ear line
  x.save(); x.translate(FU(-0.86), FV(-0.5)); x.rotate(1.25);
  x.fillStyle = 'rgba(70,60,52,0.55)'; x.font = `bold 11px ${MONO}`; x.textAlign = 'center';
  x.fillText('RC-' + ((f.id || 'x').charCodeAt(0) * 7 % 90 + 10) + '/B', 0, 0); x.restore();
  x.fillStyle = 'rgba(70,150,80,0.75)'; x.beginPath(); x.arc(FU(0.9), FV(-0.6), 4, 0, TAU); x.fill();
  // plate edge: dark gap fading in
  const e = x.createLinearGradient(0, 0, N, 0);
  e.addColorStop(0, 'rgba(36,28,22,0.95)'); e.addColorStop(0.035, 'rgba(36,28,22,0)'); e.addColorStop(0.965, 'rgba(36,28,22,0)'); e.addColorStop(1, 'rgba(36,28,22,0.95)');
  x.fillStyle = e; x.fillRect(0, 0, N, N);
  const ev = x.createLinearGradient(0, 0, 0, N);
  ev.addColorStop(0, 'rgba(36,28,22,0.85)'); ev.addColorStop(0.03, 'rgba(36,28,22,0)'); ev.addColorStop(0.975, 'rgba(36,28,22,0)'); ev.addColorStop(1, 'rgba(36,28,22,0.95)');
  x.fillStyle = ev; x.fillRect(0, 0, N, N);
  // plain porcelain spot for the eyelids
  x.fillStyle = '#f0e9dc'; x.fillRect(PLAIN_UV[0] * N - 8, (1 - PLAIN_UV[1]) * N - 8, 16, 16);
}

export function faceTexture(entry = {}) {
  return cached('rface_' + (entry.id || 'dots'), () => {
    const c = mkCanvas(N, N), ctx = c.getContext('2d');
    paintFace(ctx, entry);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true;
    if (typeof document !== 'undefined' && document.fonts && document.fonts.status !== 'loaded') {
      document.fonts.ready.then(() => { ctx.clearRect(0, 0, N, N); paintFace(ctx, entry); t.needsUpdate = true; });
    }
    return t;
  });
}
