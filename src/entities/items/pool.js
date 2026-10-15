// R.O.O.M. items — Poolrooms field kit: the AQUA-CHECK water test meter and the (edible) leech.
import * as THREE from 'three';
import { Kit, def, PI } from './core.js';
import { mat, S } from './mats.js';
import { atlas, txt, rect, rrect, noise, wear, roomIcon, MONO, INK } from './paint.js';

// ============================================================================ water_tester
// Handheld water-quality meter: chunky yellow ABS body with a grey rubber over-mould, a small green
// LCD, a sealed membrane button, and a clear sampling vial clipped below with a reagent strip that
// changes colour (state.result: 'safe' | 'bad' | 'trace'). setResult(r) drives the strip + LCD.
const RESULT_COL = { safe: 0x2fd05a, bad: 0xb02aa8, trace: 0xe8c020 };
def('water_tester', () => {
  const A = atlas('water_tester', 512, 256, (c) => {
    // front label (0,0,256,256)
    rect(c, 0, 0, 256, 256, '#f2c418');
    noise(c, 0, 0, 256, 256, 8, 2);
    rrect(c, 22, 18, 212, 70, 8, '#1d2420');
    txt(c, 'AQUA-CHECK', 128, 120, { size: 30, color: INK, weight: '900' });
    txt(c, 'PATHOGEN / pH / Cl', 128, 148, { size: 15, color: INK, fam: MONO, weight: 'bold' });
    roomIcon(c, 64, 205, 26, INK, null, 0.12);
    txt(c, 'R.O.O.M. FIELD KIT', 160, 200, { size: 13, color: INK, fam: MONO, weight: 'bold' });
    txt(c, 'DIP · WAIT · READ', 160, 222, { size: 12, color: INK, fam: MONO });
    wear(c, 0, 0, 256, 256, 3, 1.1, { edge: true });
    // body plastic (260,0,120,120), rubber (390,0,120,120)
    rect(c, 260, 0, 120, 120, '#f2c418'); noise(c, 260, 0, 120, 120, 10, 4);
    rect(c, 390, 0, 120, 120, '#4a4e50'); noise(c, 390, 0, 120, 120, 14, 5);
  }, { plain: '#f2c418' });
  const body = mat({ name: 'tester_body', map: A, rough: 0.45, det: 'stipple', ns: 0.5 });
  const rubber = mat({ name: 'tester_rubber', color: 0x4a4e50, rough: 0.85, det: 'rubber', ns: 0.7 });
  const lcd = mat({ key: null, name: 'tester_lcd', color: 0x203028, rough: 0.2, emissive: 0x3a6a40, ei: 0.6 });
  const strip = mat({ key: null, name: 'tester_strip', color: 0xf2f0e8, rough: 0.6, emissive: 0x000000, ei: 1 });
  const vial = mat({ name: 'tester_vial', color: 0xd8e8ee, rough: 0.08, transparent: true, opacity: 0.45, cc: 1, physical: true });
  const k = new Kit();
  const W = 0.07, H = 0.15, D = 0.034;
  // body + rubber bumpers
  k.rbox(W, H, D, 0.012, body, { p: [0, 0, 0], uv: A.R(260, 0, 120, 120) });
  k.add(new THREE.PlaneGeometry(W * 0.92, H * 0.92), body, { p: [0, 0, D / 2 + 0.0004], uv: A.R(0, 0, 256, 256) });
  for (const sy of [-1, 1]) k.rbox(W + 0.006, 0.026, D + 0.006, 0.01, rubber, { p: [0, sy * (H / 2 - 0.012), 0] });
  // LCD window (the readout)
  k.box(W * 0.62, 0.026, 0.002, lcd, { p: [0, H / 2 - 0.045, D / 2 + 0.0012], part: 'lcd' });
  // membrane button
  k.cyl(0.011, 0.004, rubber, { p: [0, -0.012, D / 2 + 0.002], r: [PI / 2, 0, 0] });
  // sampling vial clipped under the meter, reagent strip inside
  k.cyl(0.009, 0.07, vial, { p: [0.0, -H / 2 - 0.035, 0], open: false });
  k.box(0.006, 0.05, 0.001, strip, { p: [0, -H / 2 - 0.035, 0], part: 'strip' });
  k.cyl(0.011, 0.012, rubber, { p: [0, -H / 2 - 0.002, 0] });
  k.colBox([W + 0.006, H + 0.07, D + 0.006], [0, -0.035, 0]);
  return {
    kit: k,
    meta: {
      mass: 0.35, material: 'plastic',
      hold: { grip: [0, -0.02, 0], rot: [0.25, 0.35, 0.12], off: [0.0, 0.04, -0.02] },
      init(inst) {
        const setResult = (r) => {
          const c = RESULT_COL[r];
          const sm = inst.parts.strip?.material, lm = inst.parts.lcd?.material;
          if (sm) { sm.color.setHex(c ?? 0xf2f0e8); sm.emissive.setHex(c ?? 0x000000); sm.emissiveIntensity = c ? 0.6 : 0; }
          if (lm) { lm.emissive.setHex(r === 'bad' ? 0xa02a40 : r === 'safe' ? 0x3aa050 : r === 'trace' ? 0xa08a20 : 0x3a6a40); lm.emissiveIntensity = r ? 1.4 : 0.6; }
        };
        inst.object.userData.setResult = setResult;
      },
    },
  };
});

// ============================================================================ leech
// A fat mutant pool leech: glossy olive-black segmented body with two orange stripes, a sucker disc.
def('leech', () => {
  const skin = mat({ name: 'leech_skin', color: 0xffffff, rough: 0.22, cc: 1, ccr: 0.06, det: 'rubber', ns: 0.4 });
  const k = new Kit();
  const prof = [[0.0, -0.055], [0.007, -0.052], [0.013, -0.035], [0.016, -0.01], [0.015, 0.02], [0.011, 0.04], [0.006, 0.05], [0.0, 0.052]];
  k.lathe(prof, skin, {
    seg: 18, raw: true, p: [0, 0.009, 0], r: [PI / 2, 0, 0], s: [1, 1, 0.58],
    col: (p) => {
      const ring = Math.abs(Math.sin(p.z * 240)) > 0.86 ? 1 : 0;
      const stripe = Math.abs(Math.abs(p.x) - 0.007) < 0.0018 && p.y > 0.012 ? 1 : 0;
      if (stripe) return 0xc0602a;
      return ring ? 0x2a2c1c : 0x1a1d12;
    },
  });
  // the sucker disc at the tail
  k.cyl(0.011, 0.003, skin, { p: [0, 0.004, 0.05], col: 0x3a2a20 });
  k.colBox([0.032, 0.018, 0.11], [0, 0.009, 0]);
  return { kit: k, meta: { mass: 0.04, material: 'soft', hold: { grip: [0, 0.01, 0], rot: [0.8, 0.4, 0.2], off: [0, 0.03, -0.02] } } };
});
