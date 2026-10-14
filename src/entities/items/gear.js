// R.O.O.M. items — field gear & paperwork: glowstick, road flare, sample jar, sample kit, keycard, dart,
// instant photo, clipboard, noise maker, fuel can.
import * as THREE from 'three';
import { Kit, def, PI, TAU, V3, sstep, clamp, lerp, fillet, latheGeo, sheetGeo, extrudeGeo, polyGeo, rrectShape, rrectPath, roundedShape, curve, circlePath, HelixCurve } from './core.js';
import { mat, clear, tinted, glow, S } from './mats.js';
import { flameGeos, flameMaterial, flicker } from './tools.js';
import { RNG } from '../../core/rng.js';
import {
  atlas, txt, para, rect, rrect, circle, line, noise, mottle, wear, edgeGrime, rubEdge, barcode, roomIcon, brand, lgrad, rgrad,
  starburst, warnTri, hazardStripes, hazardDiamond, biohazard, drawClone, scribble, checkmark, inkStamp, colorBar, halftone,
  SANS, COND, MONO, SERIF, HAND, VT, INK, NAVY, ROOM_YELLOW,
} from './paint.js';

// ============================================================================ glowstick
// 6" light stick: translucent PE tube with the glowing chemical, a thin glass ampoule inside, moulded end
// cap with a hanging hook and a short lanyard loop. parts.glow (emissive), setLit(bool). Variant: colour.
def('glowstick', (opts) => {
  const col = new THREE.Color(opts.color ?? 0x39ff6a);
  const glowMat = glow({ name: 'glowstick_glow', color: col.clone().multiplyScalar(0.12).getHex(), emissive: col.getHex(), ei: 1.0, rough: 0.35 });
  const capCol = col.clone().lerp(new THREE.Color(0x202020), 0.55);
  const A = atlas('glowstick', 256, 128, (c) => {
    rect(c, 0, 0, 256, 64, '#e8e6dc');
    txt(c, 'R.O.O.M. 12 HR', 128, 32, { size: 18, color: '#111', fam: MONO, weight: 'bold' });
    rect(c, 0, 64, 128, 64, '#2a2a2a');
  }, { plain: '#d8d8d8' });
  const cap = mat({ name: 'glowstick_cap', map: A, rough: 0.5, det: 'stipple', ns: 0.4 });
  const shellM = clear({ name: 'glowstick_tube', rough: 0.12, env: 1.3 });
  const k = new Kit();
  const L = 0.13, R = 0.0074;
  k.push({ r: [-PI / 2, 0, 0] }); // build along +Y -> -Z
  // tube: rounded far end, open into the cap
  k.lathe([[0, -L / 2 - 0.004], [R * 0.7, -L / 2 - 0.0032, 0.002], [R, -L / 2, 0.003], [R, L / 2]], shellM, { seg: 24 });
  // glowing liquid (slightly inside the tube) - part
  k.lathe([[0, -L / 2 - 0.0028], [R - 0.0016, -L / 2 + 0.0005, 0.002], [R - 0.0012, L / 2 - 0.002], [R - 0.003, L / 2 - 0.0005, 0.001], [0, L / 2 - 0.0004]], glowMat, { seg: 20, part: 'glow' });
  // inner glass ampoule (faint)
  k.lathe([[0, -0.052], [0.0021, -0.0505, 0.0012], [0.0021, 0.05], [0, 0.0515]], shellM, { seg: 10, p: [0.0012, 0, 0] });
  // moulded end cap with a hook loop
  k.lathe([[R - 0.0004, L / 2 - 0.002], [R + 0.0006, L / 2 - 0.0015, 0.0006], [R + 0.0006, L / 2 + 0.008, 0.001], [R * 0.6, L / 2 + 0.0105, 0.002], [0, L / 2 + 0.0108]], cap, { seg: 24, col: capCol.getHex() });
  k.torus(0.0042, 0.0012, cap, { p: [0, L / 2 + 0.0148, 0], r: [0, PI / 2, 0], rseg: 6, tseg: 16, col: capCol.getHex() });
  k.pop();
  // lanyard cord loop through the hook
  k.add(new THREE.TubeGeometry(curve([[0, 0, L / 2 + 0.0145], [0.001, -0.0035, L / 2 + 0.03], [0.006, -0.0058, L / 2 + 0.045], [0.014, -0.0058, L / 2 + 0.04], [0.012, -0.0035, L / 2 + 0.024], [0.002, 0.001, L / 2 + 0.015]], 0.5, false), 40, 0.0011, 6, false), cap, { uv: A.R(0, 64, 128, 64), col: 0x303030 });
  k.colCyl(0.0078, L + 0.014, [0, 0, 0.002], [PI / 2, 0, 0]);
  return {
    kit: k,
    meta: {
      mass: 0.03, material: 'plastic', hold: { grip: [0, 0, 0.02], rot: [0.75, 0.15, -0.35] },
      init(inst, opts2) {
        const g = inst.parts.glow;
        inst.object.userData.setLit = (on) => { g.material.emissiveIntensity = on ? 1.0 : 0.04; };
        if (opts2.lit === false) inst.object.userData.setLit(false);
      },
    },
  };
}, (o) => `${o.color ?? 'g'}`);

// ============================================================================ flare
// 15-minute road fusee: red waxed-paper tube with printed warnings, crimped base with a steel stand wire,
// black plastic cap with the abrasive striker (part 'cap'), dark ignition button underneath.
// Lit: cap hidden, red-pink plume (part 'flame', kept upright) + glowing slag bead.
def('flare', () => {
  const A = atlas('flare', 512, 512, (c) => {
    // body wrap (0,0,512,400): u around (top at 256), v along (ignition end = canvas top)
    rect(c, 0, 0, 512, 400, '#c4221c');
    mottle(c, 0, 0, 512, 400, 12, 9, 0.8);
    noise(c, 0, 0, 512, 400, 10, 9);
    rect(c, 0, 16, 512, 8, '#fff'); rect(c, 0, 376, 512, 8, '#fff');
    for (const [x, r] of [[256, -PI / 2], [128, PI / 2], [384, -PI / 2]]) txt(c, 'R.O.O.M. EMERGENCY FLARE', x, 200, { size: 24, color: '#fff', weight: '900', rot: r, maxW: 320 });
    txt(c, 'STRIKE AWAY FROM FACE', 300, 200, { size: 14, color: '#ffe23a', fam: MONO, weight: 'bold', rot: -PI / 2, maxW: 320 });
    txt(c, '15 MIN • FUSEE • DANGER: FLAMMABLE', 212, 200, { size: 13, color: '#ffe23a', fam: MONO, weight: 'bold', rot: -PI / 2, maxW: 320 });
    txt(c, 'PROPERTY OF R.O.O.M.', 84, 200, { size: 13, color: '#ffe23a', fam: MONO, weight: 'bold', rot: PI / 2, maxW: 320 });
    hazardDiamond(c, 40, 200, 46, '#c8241c', '#fff', '', 'flame');
    hazardDiamond(c, 470, 200, 46, '#c8241c', '#fff', '', 'flame');
    wear(c, 0, 0, 512, 400, 10, 2.2, { edge: false, dirt: 1.3 });
    // wax sheen streaks
    for (let i = 0; i < 30; i++) rect(c, (i * 37) % 512, 0, 2, 400, 'rgba(255,220,200,0.06)');
    // cap band (0,404,256,50) + striker (260,404,100,100) + ignition button (370,404,100,100)
    rect(c, 0, 404, 256, 50, '#1d1d1d');
    rect(c, 0, 420, 256, 14, '#c4221c');
    txt(c, 'REMOVE CAP • STRIKE', 128, 427, { size: 9, color: '#fff', fam: MONO, weight: 'bold' });
    rect(c, 260, 404, 100, 100, '#3a3430'); noise(c, 260, 404, 100, 100, 34, 3);
    rect(c, 370, 404, 100, 100, '#2a2420'); noise(c, 370, 404, 100, 100, 24, 6);
  }, { plain: '#c4221c' });
  const p = mat({ name: 'flare_body', map: A, rough: 0.55, det: 'paper', ns: 0.4, cc: 0.3, ccr: 0.4 });
  const flame = flameMaterial();
  const k = new Kit();
  const R = 0.0132, L = 0.2;
  k.push({ r: [-PI / 2, 0, 0] }); // +Y -> -Z (ignition end forward)
  k.lathe([[R - 0.0008, -L / 2 - 0.002], [R, -L / 2 + 0.002, 0.001], [R, L / 2 - 0.002], [R - 0.0006, L / 2, 0.0006], [0.008, L / 2 + 0.0004], [0, L / 2 + 0.0005]], p, { seg: 28, phi0: PI, vFromY: [-L / 2, L / 2], uv: A.R(0, 0, 512, 400), capUV: { rect: A.R(370, 404, 100, 100), R: R, t: 0.9 } });
  // crimped base + plug
  k.lathe([[0, -L / 2 - 0.0035], [R * 0.7, -L / 2 - 0.0032, 0.001], [R - 0.0008, -L / 2 - 0.002]], p, { seg: 24, col: 0x5a1a14, rmod: (phi, y, r) => r * (1 - 0.05 * Math.pow(0.5 + 0.5 * Math.cos(phi * 8), 3)) });
  // striker cap (part 'cap')
  k.lathe([[R + 0.0004, L / 2 - 0.026], [R + 0.0014, L / 2 - 0.025, 0.0006], [R + 0.0014, L / 2 + 0.0035, 0.0015], [R * 0.6, L / 2 + 0.0055, 0.002], [0, L / 2 + 0.0058]], p, { seg: 28, part: 'cap', vFromY: [L / 2 - 0.026, L / 2 + 0.006], uv: A.R(0, 404, 256, 50), capUV: { rect: A.R(260, 404, 100, 100), R: R + 0.0014, t: 0.85 } });
  k.pop();
  // steel stand wire folded along the base
  k.tube([[0, -R + 0.002, L / 2 - 0.004], [0, -R - 0.0004, L / 2 + 0.006], [0.006, -R - 0.0006, L / 2 + 0.016], [0.0125, -R - 0.0004, L / 2 + 0.024], [0.016, -R + 0.002, L / 2 + 0.02]], 0.0011, p, { tseg: 18, rseg: 6, uv: A.R(370, 404, 100, 100), col: 0xa0a4a8 });
  // flame + glowing slag bead (part 'flame')
  flameGeos(k, flame, [0, 0, -L / 2 - 0.004], 0.15, 0.026, 'flame', 0xc8140a, 0xffb0a0);
  k.sphere(0.009, flame, { p: [0, 0, -L / 2 - 0.004], ws: 10, hs: 6, part: 'flame', uvFn: () => [0.5, 0.08], col: 0xff8060, bounds: false });
  k.colCyl(R + 0.0012, L + 0.01, [0, 0, 0], [PI / 2, 0, 0]);
  k.anchor('tip', [0, 0, -L / 2 - 0.004]);
  return {
    kit: k,
    meta: {
      mass: 0.2, material: 'cardboard', hold: { grip: [0, 0, 0.03], rot: [0.55, 0.05, 0.05] },
      init(inst, opts) {
        const { flame: f, cap } = inst.parts;
        inst.object.userData.setLit = (on) => { f.visible = !!on; cap.visible = !on; };
        inst.object.userData.setLit(!!opts.lit);
        flicker(f, 0.75);
      },
    },
  };
});

// ============================================================================ sample_jar
// Wide-mouth specimen jar: thick-walled glass with a moulded base, screw cap (knurled skirt, printed top),
// biohazard label with handwriting, red tamper tape over the cap; contents part (fill / colour hooks).
def('sample_jar', () => {
  const A = atlas('sample_jar', 512, 512, (c) => {
    // biohazard label (0,0,512,200)
    rect(c, 0, 0, 512, 200, '#f4cf1d');
    noise(c, 0, 0, 512, 200, 10, 4);
    c.strokeStyle = INK; c.lineWidth = 7; c.strokeRect(8, 8, 496, 184);
    biohazard(c, 88, 100, 60, INK);
    txt(c, 'BIOHAZARD', 300, 44, { size: 44, color: INK, weight: '900', maxW: 330 });
    txt(c, 'R.O.O.M. BIO-CONTAINMENT', 300, 80, { size: 16, color: INK, fam: MONO, weight: 'bold', maxW: 330 });
    txt(c, 'SPECIMEN #', 220, 126, { size: 20, color: INK, fam: MONO, weight: 'bold' });
    rect(c, 290, 140, 190, 2, INK);
    txt(c, '0042', 380, 122, { size: 34, color: '#1d2b8a', fam: HAND, weight: 'bold', italic: true, rot: -0.06 });
    txt(c, 'LEVEL: ?  DATE: ██/██', 300, 166, { size: 14, color: INK, fam: MONO, weight: 'bold' });
    wear(c, 0, 0, 512, 200, 7, 1.6, { dirt: 1.3 });
    // lid knurl (0,210,512,50) + lid top (0,270,160,160)
    rect(c, 0, 210, 512, 50, '#b8bcc0');
    for (let x = 0; x < 512; x += 6) rect(c, x, 210, 3, 50, 'rgba(0,0,0,0.14)');
    rect(c, 0, 270, 160, 160, '#c4c8cc');
    noise(c, 0, 270, 160, 160, 12, 6);
    circle(c, 80, 350, 60, '#f4cf1d');
    biohazard(c, 80, 350, 44, INK);
    // seal tape (170,270,300,40)
    rect(c, 170, 270, 300, 40, '#d6332a');
    txt(c, 'SEALED • DO NOT OPEN • SEALED', 320, 290, { size: 15, color: '#fff', weight: '900', maxW: 290 });
  }, { plain: '#c4c8cc' });
  const p = mat({ name: 'jar_print', map: A, rough: 0.5, det: 'paper', ns: 0.3 });
  const met = mat({ name: 'jar_lid', map: A, rough: 0.32, metal: 0.85, det: 'brushed', ns: 0.4 });
  const glass = clear({ name: 'jar_glass', rough: 0.03, env: 1.7 });
  const contents = mat({ key: null, name: 'jar_contents', color: 0x6f9a34, rough: 0.28, vc: false, emissive: 0x000000, ei: 0, physical: true, specular: 0.7 });
  const k = new Kit();
  const R = 0.037, Hc = 0.08, y0 = 0.0062;
  // glass: outer wall, rim, inner wall, thick base
  k.lathe([[0, 0.0015], [0.028, 0.0004, 0.003], [0.0345, 0.0028, 0.003], [R, 0.011, 0.003], [R, 0.083], [0.035, 0.0905, 0.004], [0.0322, 0.093, 0.002], [0.0322, 0.1005, 0.0005], [0.0298, 0.101, 0.0005], [0.0298, 0.093], [0.0335, 0.0882, 0.003], [R - 0.0024, 0.082], [R - 0.0024, 0.011, 0.003], [0.026, 0.0062, 0.003], [0, 0.0058]], glass, { seg: 32, rseg: 0.0016 });
  // threads on the neck
  k.add(new THREE.TubeGeometry(new (class extends THREE.Curve { getPoint(t, o = V3()) { const a = t * TAU * 1.6; return o.set(Math.cos(a) * 0.0324, 0.0945 + t * 0.0045, Math.sin(a) * 0.0324); } })(), 32, 0.0006, 4, false), glass, {});
  // contents (part, pivot at the jar floor): volume with a meniscus top
  k.lathe([[0, 0], [0.0255, 0, 0.002], [0.0343, 0.0045, 0.003], [0.0344, Hc - 0.0012], [0.0336, Hc, 0.0008], [0.03, Hc - 0.0006, 0.002], [0, Hc - 0.0012]], contents, { seg: 24, rseg: 0.0016, p: [0, y0, 0], part: 'contents' });
  k.pivot('contents', [0, y0, 0]);
  // label (partial wrap toward +Z)
  k.lathe([[R + 0.0005, 0.026], [R + 0.0005, 0.07]], p, { seg: 20, phi0: -0.95, phiLen: 1.9, vFromY: [0.026, 0.07], uv: A.R(0, 0, 512, 200) });
  // screw cap: knurled skirt + top with printed biohazard + liner edge
  k.lathe([[0.0336, 0.0915], [0.0349, 0.092, 0.0006], [0.0349, 0.107, 0.001], [0.0338, 0.1088, 0.0015], [0.0322, 0.109]], met, {
    seg: 40, rseg: 0.0012, vFromY: [0.0915, 0.109], uv: A.R(0, 210, 512, 50),
  });
  k.lathe([[0.0322, 0.109], [0.02, 0.1094], [0, 0.1095]], met, { seg: 32, planar: { rect: A.R(0, 270, 160, 160), R: 0.0338 } });
  // tamper tape over the lid, tucked down both sides
  k.add(sheetGeo(1, 12, (u, v) => {
    const t = v * 2 - 1, w = (u - 0.5) * 0.015;
    const top = 0.1102, x = t * 0.036;
    const y = Math.abs(t) < 0.94 ? top : top - (Math.abs(t) - 0.94) * 0.55 / 0.06 * 0.02;
    const xx = Math.abs(t) < 0.94 ? x : Math.sign(t) * (0.0352 + 0.0004);
    return [xx, y, w];
  }), p, { uv: A.R(170, 270, 300, 40, 1) });
  k.colCyl(R, 0.11, [0, 0.055, 0]);
  k.anchor('contents', [0, y0 + Hc / 2, 0]);
  return {
    kit: k,
    meta: {
      mass: 0.4, material: 'glass', hold: { grip: [0, 0.05, 0], rot: [0.12, -0.15, 0.05], off: [0, 0.015, 0] },
      init(inst, opts) {
        const m = inst.parts.contents;
        inst.object.userData.setFill = (f) => { f = Math.max(0, Math.min(1, f)); m.visible = f > 0.01; m.scale.y = Math.max(0.01, f); };
        inst.object.userData.setColor = (hex, emissive = 0) => { m.material.color.set(hex); m.material.emissive.set(hex); m.material.emissiveIntensity = emissive; };
        inst.object.userData.setFill(opts.fill ?? 0.65);
        if (opts.color !== undefined) inst.object.userData.setColor(opts.color, opts.glow ?? 0);
      },
    },
  };
});

// ============================================================================ sample_kit
// Rugged micro case for field samples: orange moulded base with ribs, hinged lid frame with a clear
// window, front latch, foam insert holding three screw-cap sample tubes with handwritten labels.
def('sample_kit', () => {
  const A = atlas('sample_kit', 512, 512, (c) => {
    // front label (0,0,512,120)
    rect(c, 0, 0, 512, 120, '#e8661c');
    mottle(c, 0, 0, 512, 120, 10, 2, 0.7);
    rrect(c, 70, 14, 372, 92, 6, '#f6f2e6');
    biohazard(c, 116, 60, 30, INK);
    txt(c, 'FIELD SAMPLE KIT', 290, 44, { size: 28, color: INK, weight: '900', maxW: 270 });
    txt(c, 'R.O.O.M. BIO-CONTAINMENT • 3 TUBES', 290, 76, { size: 12, color: INK, fam: MONO, weight: 'bold', maxW: 270 });
    wear(c, 0, 0, 512, 120, 3, 2.2, { dirt: 1.3 });
    // case orange (0,124,256,80)
    rect(c, 0, 124, 256, 80, '#e8661c'); mottle(c, 0, 124, 256, 80, 10, 3, 0.7); wear(c, 0, 124, 256, 80, 4, 2, { edge: false });
    // foam (260,124,240,120)
    rect(c, 260, 124, 240, 120, '#34363a'); noise(c, 260, 124, 240, 120, 34, 5);
    // tube label (0,210,256,60)
    rect(c, 0, 210, 256, 60, '#f6f2e6');
    txt(c, 'SPECIMEN', 128, 226, { size: 16, color: INK, weight: '900' });
    txt(c, 'L0 #0451', 128, 250, { size: 18, color: '#1d2b8a', fam: HAND, weight: 'bold' });
    // lid sticker (0,280,300,120)
    rect(c, 0, 280, 300, 120, ROOM_YELLOW);
    txt(c, 'DO NOT OPEN', 150, 314, { size: 28, color: INK, weight: '900' });
    txt(c, 'OUTSIDE DESIGNATED ZONES', 150, 346, { size: 13, color: INK, fam: MONO, weight: 'bold' });
    roomIcon(c, 150, 376, 20, INK, null, 0.12);
    // dark rubber (310,280,60,60), cap colours (380,280,120,30)
    rect(c, 310, 280, 60, 60, '#232325');
  }, { plain: '#e8661c' });
  const p = mat({ name: 'samplekit_case', map: A, rough: 0.45, det: 'stipple', ns: 0.6 });
  const clr = clear({ name: 'samplekit_clear', rough: 0.05, env: 1.6 });
  const k = new Kit();
  const W = 0.17, D = 0.11, Hb = 0.03, Hl = 0.016;
  const plain = A.R(0, 124, 256, 80);
  const caseUV = (fr) => (p2, n) => { if (n.z > 0.7 && fr) { const u = p2.x / W + 0.5, v = (p2.y) / Hb + 0.5; const r = A.R(0, 0, 512, 120); return [r[0] + u * (r[2] - r[0]), r[1] + v * (r[3] - r[1])]; } return [plain[0] + (p2.x / W + 0.5) * (plain[2] - plain[0]), plain[1] + 0.5 * (plain[3] - plain[1])]; };
  // base: rounded box with draft-ish bevel
  k.rbox(W, Hb, D, 0.007, p, { p: [0, Hb / 2, 0], rs: 3, uvFn: caseUV(true) });
  // vertical ribs on the base front/back corners
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.006, Hb - 0.006, 0.004, p, { p: [sx * (W / 2 - 0.016), Hb / 2, sz * (D / 2 + 0.0008)], uv: plain });
  // foam insert with three cut-outs + tubes
  k.box(W - 0.014, 0.002, D - 0.014, p, { p: [0, Hb - 0.0004, 0], uv: A.R(260, 124, 240, 120) });
  const caps = [0xc0302a, 0x2f5d9e, 0x3f8a4a], fills = [0x8a1a3a, 0x6f9a34, 0xd8c040];
  caps.forEach((cc, i) => {
    const z = -0.028 + i * 0.028, y = Hb + 0.0055;
    k.push({ p: [-0.004, y, z], r: [0, 0, -PI / 2] }); // tube along +X
    k.lathe([[0, -0.042], [0.0052, -0.0405, 0.003], [0.0062, -0.034, 0.002], [0.0062, 0.03], [0.0058, 0.031]], clr, { seg: 16, rseg: 0.0014 });
    k.lathe([[0, -0.04], [0.004, -0.039, 0.002], [0.0052, -0.034, 0.001], [0.0052, 0.004], [0, 0.0045]], p, { seg: 12, rseg: 0.0014, col: fills[i], uv: A.R(0, 124, 256, 80) });
    k.lathe([[0.0064, 0.029], [0.0068, 0.0295, 0.0004], [0.0068, 0.043, 0.001], [0.004, 0.0445, 0.0015], [0, 0.0447]], p, { seg: 18, col: cc, rmod: (phi, yy, r) => r + (yy > 0.031 && yy < 0.041 ? 0.00035 * Math.pow(0.5 + 0.5 * Math.cos(phi * 6), 2) : 0) });
    k.lathe([[0.0063, -0.022], [0.0063, 0.012]], p, { seg: 16, phi0: PI * 0.6, phiLen: PI * 0.9, vFromY: [-0.022, 0.012], uv: A.R(0, 210, 256, 60, 1) });
    k.pop();
  });
  // lid frame (orange) with a clear window, raised on its hinge side
  const ly = Hb + 0.002 + Hl / 2;
  k.rbox(W - 0.004, 0.0025, D - 0.004, 0.003, clr, { p: [0, Hb + 0.002 + Hl - 0.00125, 0], rs: 1 });
  for (const sz of [-1, 1]) k.rbox(W + 0.001, Hl, 0.011, 0.003, p, { p: [0, ly, sz * (D / 2 - 0.0045)], rs: 1, uv: plain });
  for (const sx of [-1, 1]) k.rbox(0.011, Hl, D + 0.001, 0.003, p, { p: [sx * (W / 2 - 0.0045), ly, 0], rs: 1, uv: plain });
  k.box(0.058, 0.0006, 0.026, p, { p: [0.042, Hb + 0.002 + Hl + 0.0003, -0.025], uv: A.R(0, 280, 300, 120) });
  // front latch + hinge barrels
  k.rbox(0.03, 0.026, 0.007, 0.0025, p, { p: [0, Hb + 0.002, D / 2 + 0.003], rs: 1, uv: A.R(310, 280, 60, 60) });
  k.rbox(0.022, 0.005, 0.004, 0.0015, p, { p: [0, Hb + 0.012, D / 2 + 0.0055], rs: 1, uv: A.R(310, 280, 60, 60) });
  for (const sx of [-1, 0, 1]) k.cyl(0.0042, 0.03, p, { p: [sx * 0.05, Hb + 0.002, -D / 2 - 0.0022], r: [0, 0, PI / 2], seg: 10, uv: plain, bevel: 0.001 });
  k.cyl(0.0012, 0.14, S.steel(), { p: [0, Hb + 0.002, -D / 2 - 0.0022], r: [0, 0, PI / 2], seg: 8, bevel: 0.0003 });
  k.colBox([W, Hb + Hl + 0.004, D], [0, (Hb + Hl + 0.004) / 2, 0]);
  return { kit: k, meta: { mass: 0.5, material: 'plastic', hold: { grip: [0, 0.01, D / 2], rot: [1.05, 0, 0.04], off: [-0.02, 0.0, 0.02] } } };
});

// ============================================================================ keycard
// CR80 PVC access badge (85.6 x 54 x 0.76 mm) with rounded corners, slot punch for a clip, laminated
// front (photo, level band, chip, hologram, barcode) and back (magstripe, signature panel); white core
// visible on the edges. Variant: level 1..5.
const KEY_LEVELS = { 1: ['#3f8a4a', 'GREEN'], 2: ['#2f5d9e', 'BLUE'], 3: ['#e0a810', 'YELLOW'], 4: ['#e8661c', 'ORANGE'], 5: ['#c0302a', 'RED'] };
def('keycard', (opts) => {
  const lvl = Math.min(5, Math.max(1, opts.level ?? 2));
  const [col] = KEY_LEVELS[lvl];
  const A = atlas(`keycard_${lvl}`, 512, 512, (c) => {
    // front (0,0,512,324)
    rect(c, 0, 0, 512, 324, '#f6f4ee');
    noise(c, 0, 0, 512, 324, 4, 3);
    c.fillStyle = lgrad(c, 0, 0, 512, 0, [[0, col], [1, col]]); c.fillRect(0, 0, 512, 74);
    halftone(c, 0, 0, 512, 74, 'rgba(255,255,255,0.12)', 6, (u) => u * 0.6);
    roomIcon(c, 40, 37, 38, '#fff', null, 0.11);
    txt(c, 'R.O.O.M. CORP', 70, 28, { size: 24, color: '#fff', weight: '900', align: 'left', maxW: 136 });
    txt(c, 'PERSONNEL ACCESS', 71, 54, { size: 11, color: '#fff', fam: MONO, align: 'left', weight: 'bold', maxW: 136 });
    rrect(c, 216, 16, 80, 22, 11, 'rgba(0,0,0,0.22)');
    rrect(c, 322, 14, 176, 48, 6, 'rgba(0,0,0,0.25)');
    txt(c, `LEVEL ${lvl}`, 410, 38, { size: 30, color: '#fff', weight: '900', maxW: 160 });
    // slot punch area left clear at the top centre (hole geometry)
    rect(c, 22, 92, 132, 156, '#cfd6dc');
    c.save(); c.beginPath(); c.rect(22, 92, 132, 156); c.clip(); drawClone(c, 88, 168, 104); c.restore();
    c.strokeStyle = '#555'; c.lineWidth = 2; c.strokeRect(22, 92, 132, 156);
    txt(c, 'EMPLOYEE #0451', 172, 106, { size: 21, color: INK, weight: '900', align: 'left', maxW: 320 });
    txt(c, 'CLONE — FIELD OPERATIONS', 172, 132, { size: 14, color: '#333', fam: MONO, align: 'left', weight: 'bold', maxW: 320 });
    txt(c, 'VALID UNTIL: TERMINATION', 172, 154, { size: 13, color: '#333', fam: MONO, align: 'left', maxW: 320 });
    // contact chip
    rrect(c, 176, 176, 62, 50, 8, '#d9b45a', '#9a7a2a', 2);
    c.strokeStyle = '#9a7a2a'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(176, 201); c.lineTo(238, 201); c.moveTo(207, 176); c.lineTo(207, 226); c.moveTo(190, 176); c.lineTo(190, 226); c.moveTo(224, 176); c.lineTo(224, 226); c.stroke();
    // hologram foil
    const hg = c.createLinearGradient(256, 178, 300, 226);
    ['#ff8ad8', '#8ad8ff', '#b0ff8a', '#ffe28a', '#ff8ad8'].forEach((h, i) => hg.addColorStop(i / 4, h));
    c.fillStyle = hg; c.beginPath(); c.arc(278, 202, 23, 0, TAU); c.fill();
    roomIcon(c, 278, 202, 22, 'rgba(255,255,255,0.75)', null, 0.12);
    barcode(c, 318, 176, 176, 54, 451, false);
    rect(c, 0, 258, 512, 66, col);
    txt(c, 'DO NOT BEND • DO NOT DUPLICATE', 256, 290, { size: 17, color: '#fff', fam: MONO, weight: 'bold', maxW: 470 });
    wear(c, 0, 0, 512, 324, 70 + lvl, 1.3, { lightRatio: 0.75 });
    // back (0,330,512,180) at reduced height (card back is mostly plain)
    rect(c, 0, 330, 512, 180, '#ecebe6');
    rect(c, 0, 348, 512, 40, '#121214');
    rect(c, 30, 400, 300, 30, '#ffffff');
    for (let x = 30; x < 330; x += 10) rect(c, x, 400, 5, 30, 'rgba(200,190,170,0.3)');
    scribble(c, 44, 414, 120, 9, 'rgba(30,40,110,0.85)', 2);
    txt(c, 'AUTHORIZED SIGNATURE', 34, 438, { size: 10, color: '#555', fam: MONO, align: 'left', weight: 'bold' });
    txt(c, 'If found, return to R.O.O.M. Corporation. Do not bring to Dimension 0.', 256, 460, { size: 11, color: '#222', fam: MONO, maxW: 480 });
    txt(c, 'Misuse is grounds for reassignment.', 256, 478, { size: 10, color: '#666', fam: MONO, maxW: 480 });
    rect(c, 0, 494, 512, 16, col);
  }, { plain: '#f2f0ea' });
  const p = mat({ name: 'keycard_print', map: A, rough: 0.3, det: 'gloss', ns: 0.2, cc: 0.6, ccr: 0.15 });
  const W = 0.0856, H = 0.054, T = 0.00076;
  const sh = rrectShape(W, H, 0.0032);
  sh.holes.push(rrectPath(0.0136, 0.0032, 0.0016, 0, H / 2 - 0.0058));
  const fr = A.R(0, 0, 512, 324), br = A.R(0, 330, 512, 180), pl = A.plain;
  const k = new Kit();
  k.add(extrudeGeo(sh, T * 0.7, T * 0.15, { curveSegments: 4, bevelSegments: 1 }), p, {
    r: [-PI / 2, 0, 0],
    uvFn: (q, n) => {
      const u = (q.x + W / 2) / W, v = (q.y + H / 2) / H;
      if (n.z > 0.5) return [fr[0] + u * (fr[2] - fr[0]), fr[1] + v * (fr[3] - fr[1])];
      if (n.z < -0.5) return [br[0] + (1 - u) * (br[2] - br[0]), br[1] + v * (br[3] - br[1])];
      return [(pl[0] + pl[2]) / 2, (pl[1] + pl[3]) / 2];
    },
  });
  k.colBox([W, 0.0024, H], [0, 0.0008, 0]); // thick enough not to tunnel; bottom flush with the card
  return { kit: k, meta: { mass: 0.006, material: 'plastic', hold: { grip: [0.03, 0, 0.015], rot: [1.3, -0.1, 0.06], off: [0, 0.045, 0] }, restitution: 0.05, angularDamping: 0.9 } };
}, (o) => `${Math.min(5, Math.max(1, o.level ?? 2))}`);

// ============================================================================ dart
// Steel-tip dart: polished point, tungsten barrel with machined grip rings and a gold accent, aluminium
// shaft with ring grooves, printed kite flights with a slight dihedral and a flight protector.
def('dart', () => {
  const A = atlas('dart', 256, 256, (c) => {
    rect(c, 0, 0, 200, 200, ROOM_YELLOW);
    hazardStripes(c, 0, 0, 200, 26, 12);
    roomIcon(c, 84, 116, 66, INK, null, 0.12);
    txt(c, 'R.O.O.M.', 100, 178, { size: 22, color: INK, weight: '900' });
    rect(c, 0, 194, 200, 6, INK);
    rect(c, 204, 0, 52, 120, '#1b1b1d');
  }, { plain: '#1b1b1d' });
  const p = mat({ name: 'dart_print', map: A, rough: 0.42, det: 'stipple', ns: 0.3 });
  const steel = S.chrome();
  const tung = mat({ name: 'dart_tungsten', color: 0x9aa0a6, metal: 1, rough: 0.3, det: 'turned', ns: 0.6 });
  const k = new Kit();
  k.push({ r: [-PI / 2, 0, 0] }); // +Y (tip) -> -Z
  // shaft (aluminium, black anodised) with rings + flight slots
  const shaft = [[0, -0.064], [0.0018, -0.0636, 0.0006], [0.0021, -0.06]];
  for (let i = 0; i < 4; i++) { const y = -0.05 + i * 0.008; shaft.push([0.0021, y], [0.0017, y + 0.0007, 0.0002], [0.0021, y + 0.0014]); }
  shaft.push([0.0021, -0.014], [0.0028, -0.0112, 0.0006], [0.0028, -0.0106]);
  k.lathe(shaft, p, { seg: 14, uv: A.R(204, 0, 52, 120) });
  // tungsten barrel with grip rings
  const barrel = [[0.0028, -0.0108], [0.0033, -0.0094, 0.0006], [0.0035, -0.006]];
  for (let i = 0; i < 7; i++) { const y = -0.004 + i * 0.0058; barrel.push([0.0035, y], [0.00305, y + 0.0013, 0.0003], [0.00305, y + 0.0033, 0.0003], [0.0035, y + 0.0046]); }
  barrel.push([0.0034, 0.038], [0.0024, 0.044, 0.002], [0.0013, 0.0455]);
  k.lathe(barrel, tung, { seg: 18 });
  k.cyl(0.0036, 0.0016, S.brass(), { p: [0, -0.007, 0], seg: 18, bevel: 0.0003 });
  // steel point
  k.lathe([[0.0013, 0.0455], [0.0012, 0.05], [0.00095, 0.072, 0.003], [0, 0.0815]], steel, { seg: 12 });
  // flights (X configuration), slight dihedral
  const fs = new THREE.Shape();
  fs.moveTo(0.0016, -0.026); fs.lineTo(0.007, -0.034); fs.lineTo(0.0178, -0.051); fs.lineTo(0.0168, -0.0638); fs.lineTo(0.0016, -0.0638); fs.closePath();
  const fr = A.R(0, 0, 200, 200);
  for (let q = 0; q < 4; q++) {
    k.add(extrudeGeo(fs, 0.0004, 0, { curveSegments: 1 }), p, {
      r: [0, PI / 4 + q * PI / 2, 0],
      deform: (v) => { v.z += (v.x - 0.0016) * (v.x - 0.0016) * 6; },
      uvFn: (v) => { const u = (v.x - 0.0016) / 0.0162, w = (v.y + 0.0638) / 0.0378; return [fr[0] + u * (fr[2] - fr[0]), fr[1] + w * (fr[3] - fr[1])]; },
    });
  }
  // flight protector ring
  k.lathe([[0.0029, -0.0655], [0.003, -0.0628, 0.0004], [0.0024, -0.0622]], steel, { seg: 12, col: 0xc8ccd0 });
  k.pop();
  k.colBox([0.007, 0.007, 0.145], [0, 0, -0.0085]);
  k.colBox([0.026, 0.026, 0.036], [0, 0, 0.045]);
  return { kit: k, meta: { mass: 0.022, material: 'metal', hold: { grip: [0, 0, -0.016], rot: [0.12, 0.05, 0], off: [-0.01, 0.04, 0] } } };
});

// ============================================================================ photo (instant film)
// Integral instant print (88 x 107 mm): glossy image window in a matte white frame with the thicker
// reagent-pod border at the bottom, a slight curl, handwritten caption, dark back with print text.
const PHOTO_CAPTIONS = ['Level 0 — day 3?', 'who is that??', 'team building :)', 'EXIT?? (it moved)'];
function drawCorridor(c, x, y, w, h, o = {}) {
  const vx = x + w * (o.vx ?? 0.5), vy = y + h * 0.48;
  const quad = (pts, col) => { c.fillStyle = col; c.beginPath(); pts.forEach(([a, b], i) => (i ? c.lineTo(a, b) : c.moveTo(a, b))); c.fill(); };
  const s = 0.16;
  const ix0 = vx - w * s, ix1 = vx + w * s, iy0 = vy - h * s * 0.8, iy1 = vy + h * s;
  quad([[x, y], [x + w, y], [ix1, iy0], [ix0, iy0]], o.ceil || '#d8d3bd');
  quad([[x, y + h], [x + w, y + h], [ix1, iy1], [ix0, iy1]], o.floor || '#8f7a45');
  quad([[x, y], [ix0, iy0], [ix0, iy1], [x, y + h]], o.wall || '#cbb45a');
  quad([[x + w, y], [ix1, iy0], [ix1, iy1], [x + w, y + h]], o.wall2 || '#bfa650');
  quad([[ix0, iy0], [ix1, iy0], [ix1, iy1], [ix0, iy1]], o.back || '#7a6a30');
  // wallpaper stripes on the side walls
  c.strokeStyle = 'rgba(120,100,40,0.18)'; c.lineWidth = 2;
  for (let i = 1; i < 10; i++) { const t = i / 10; c.beginPath(); c.moveTo(x + (ix0 - x) * t, y + (iy0 - y) * t); c.lineTo(x + (ix0 - x) * t, y + h + (iy1 - y - h) * t); c.stroke(); c.beginPath(); c.moveTo(x + w + (ix1 - x - w) * t, y + (iy0 - y) * t); c.lineTo(x + w + (ix1 - x - w) * t, y + h + (iy1 - y - h) * t); c.stroke(); }
  for (let i = 0; i < 4; i++) {
    const t = 1 - Math.pow(0.55, i + 0.6);
    const cxp = x + w / 2 + (vx - x - w / 2) * t, cyp = y + (iy0 - y) * t;
    const lw = w * 0.22 * (1 - t), lh = h * 0.05 * (1 - t);
    c.fillStyle = '#fffbe8'; c.fillRect(cxp - lw / 2, cyp, lw, lh);
    const g = c.createRadialGradient(cxp, cyp, 0, cxp, cyp, lw * 1.6);
    g.addColorStop(0, 'rgba(255,250,220,0.35)'); g.addColorStop(1, 'rgba(255,250,220,0)');
    c.fillStyle = g; c.fillRect(cxp - lw * 2, cyp - lw, lw * 4, lw * 3);
  }
  c.fillStyle = 'rgba(30,24,10,0.85)';
  c.beginPath(); c.moveTo(x + w * 0.12, y + h * 0.3); c.lineTo(x + w * 0.22, y + h * 0.35); c.lineTo(x + w * 0.22, y + h * 0.72); c.lineTo(x + w * 0.12, y + h * 0.8); c.fill();
}
def('photo', (opts) => {
  const vr = (((opts.variant ?? 0) % 4) + 4) % 4;
  const A = atlas(`photo_${vr}`, 512, 512, (c) => {
    // front frame + image (0,0,400,486): image window 360x360 at (20,20)
    rect(c, 0, 0, 400, 486, '#f2efe4');
    noise(c, 0, 0, 400, 486, 6, 3);
    const ix = 20, iy = 20, iw = 360, ih = 360;
    c.save(); c.beginPath(); c.rect(ix, iy, iw, ih); c.clip();
    if (vr === 0 || vr === 1) drawCorridor(c, ix, iy, iw, ih, { vx: vr ? 0.55 : 0.45 });
    if (vr === 1) {
      const fx = ix + iw * 0.55, fy = iy + ih * 0.48;
      c.fillStyle = '#0b0906'; c.beginPath(); c.ellipse(fx, fy - 14, 7, 9, 0, 0, TAU); c.fill();
      c.beginPath(); c.moveTo(fx - 8, fy - 5); c.lineTo(fx + 8, fy - 5); c.lineTo(fx + 5, fy + 46); c.lineTo(fx - 5, fy + 46); c.fill();
      c.fillStyle = '#fff'; c.fillRect(fx - 4, fy - 16, 2, 2); c.fillRect(fx + 2, fy - 16, 2, 2);
    }
    if (vr === 2) {
      rect(c, ix, iy, iw, ih, '#cbb45a');
      for (let i = 0; i < 10; i++) rect(c, ix + i * 40, iy, 3, ih * 0.62, 'rgba(120,100,40,0.25)');
      rect(c, ix, iy + ih * 0.62, iw, ih * 0.38, '#8f7a45');
      drawClone(c, ix + 96, iy + 196, 118, { face: true });
      drawClone(c, ix + 266, iy + 200, 118, { face: true });
      drawClone(c, ix + 180, iy + 228, 134, { face: true });
      const g = c.createRadialGradient(ix + 190, iy + 160, 10, ix + 190, iy + 160, 240);
      g.addColorStop(0, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(ix, iy, iw, ih);
    }
    if (vr === 3) {
      drawCorridor(c, ix, iy, iw, ih, { ceil: '#3a372c', floor: '#2a2414', wall: '#4a4020', wall2: '#40381c', back: '#1a160a' });
      const dx = ix + iw * 0.5, dy = iy + ih * 0.47;
      rect(c, dx - 20, dy - 24, 40, 72, '#2c2a26');
      rect(c, dx - 19, dy - 50, 38, 16, '#c82018');
      txt(c, 'EXIT', dx, dy - 42, { size: 14, color: '#ffd8c8', weight: '900' });
      const g = c.createRadialGradient(dx, dy - 42, 4, dx, dy - 42, 70);
      g.addColorStop(0, 'rgba(255,60,40,0.5)'); g.addColorStop(1, 'rgba(255,60,40,0)');
      c.fillStyle = g; c.fillRect(dx - 80, dy - 120, 160, 160);
    }
    // film look: warm cast, vignette, grain, light leak, slight underexposure
    c.fillStyle = 'rgba(255,200,120,0.12)'; c.fillRect(ix, iy, iw, ih);
    const vg = c.createRadialGradient(ix + iw / 2, iy + ih / 2, iw * 0.25, ix + iw / 2, iy + ih / 2, iw * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = vg; c.fillRect(ix, iy, iw, ih);
    const lk = c.createLinearGradient(ix + iw, iy, ix + iw - 100, iy + 70);
    lk.addColorStop(0, 'rgba(255,120,60,0.45)'); lk.addColorStop(1, 'rgba(255,120,60,0)');
    c.fillStyle = lk; c.fillRect(ix, iy, iw, ih);
    c.restore();
    noise(c, ix, iy, iw, ih, 26, 7 + vr);
    txt(c, PHOTO_CAPTIONS[vr], 200, 432, { size: 32, color: '#23285a', fam: HAND, weight: 'bold', rot: -0.025, maxW: 350 });
    wear(c, 0, 0, 400, 486, 9 + vr, 0.8, { lightRatio: 0.1 });
    // back (404,0,108,132) dark
    rect(c, 404, 0, 108, 132, '#262626');
    noise(c, 404, 0, 108, 132, 12, 2);
    txt(c, 'R.O.O.M.', 458, 30, { size: 14, color: '#8a8a8a', fam: MONO, weight: 'bold' });
    txt(c, 'INSTANT FILM', 458, 48, { size: 9, color: '#8a8a8a', fam: MONO, weight: 'bold' });
    txt(c, 'EVIDENCE', 458, 70, { size: 9, color: '#777', fam: MONO });
    txt(c, `#${4200 + vr * 17}`, 458, 104, { size: 16, color: '#ddd', fam: HAND, weight: 'bold' });
  }, { plain: '#f2efe4' });
  const frame = mat({ name: 'photo_frame', map: A, rough: 0.75, det: 'paper', ns: 0.3 });
  const gloss = mat({ name: 'photo_image', map: A, rough: 0.12, det: 'gloss', ns: 0.15, cc: 0.5, ccr: 0.08 });
  const W = 0.088, H = 0.107, T = 0.0009, iw = 0.079;
  const k = new Kit();
  const curl = (x, z) => 0.0016 * Math.pow((x / (W / 2)), 2) + 0.0006 * Math.pow(z / (H / 2), 2);
  const uvF = (r) => (q) => { const u = q.x / W + 0.5, v = 0.5 - q.z / H; return [r[0] + u * (r[2] - r[0]), r[1] + v * (r[3] - r[1])]; };
  const front = A.R(0, 0, 400, 486);
  // frame top surface (thicker strip at the bottom = reagent pod), with a window hole for the image
  const sh = rrectShape(W, H, 0.0012);
  const zc = -(H / 2 - 0.0045 - iw / 2); // image window centre (top border 4.5 mm)
  sh.holes.push(rrectPath(iw, iw, 0.0004, 0, -zc));
  k.add(extrudeGeo(sh, T, 0.00012, { curveSegments: 3, bevelSegments: 1 }), frame, {
    r: [-PI / 2, 0, 0],
    deform: (v) => { v.z += curl(v.x, -v.y) / 1 + (-v.y > H / 2 - 0.016 ? 0.00035 * Math.min(1, (-v.y - (H / 2 - 0.016)) / 0.004) : 0) * (v.z > 0 ? 1 : 0); },
    uvFn: (q, n) => {
      const u = q.x / W + 0.5, v = q.y / H + 0.5;
      if (n.z < -0.5) { const b = A.R(404, 0, 108, 132); return [b[0] + (1 - u) * (b[2] - b[0]), b[1] + v * (b[3] - b[1])]; }
      return [front[0] + u * (front[2] - front[0]), front[1] + v * (front[3] - front[1])];
    },
  });
  // glossy image window (slightly recessed)
  k.add(sheetGeo(8, 8, (u, v) => { const x = (u - 0.5) * iw, z = zc + (0.5 - v) * iw; return [x, curl(x, z) + T * 0.35, z]; }), gloss, { uvFn: uvF(front) });
  const bk = A.R(404, 0, 108, 132);
  k.add(sheetGeo(4, 4, (u, v) => { const x = (u - 0.5) * (iw + 0.001), z = zc + (0.5 - v) * (iw + 0.001); return [x, curl(x, z) - T * 0.5, z]; }, { flip: true }), frame, { uvFn: (q) => { const u = q.x / W + 0.5, v = 0.5 - q.z / H; return [bk[0] + (1 - u) * (bk[2] - bk[0]), bk[1] + v * (bk[3] - bk[1])]; } });
  k.colBox([W, 0.0024, H], [0, 0.0006, 0]);
  return { kit: k, meta: { mass: 0.005, material: 'paper', hold: { grip: [0.032, 0, 0.035], rot: [1.3, 0, 0.06], off: [0, 0.05, 0] }, restitution: 0.02, angularDamping: 0.95, linearDamping: 0.6 } };
}, (o) => `${(((o.variant ?? 0) % 4) + 4) % 4}`);

// ============================================================================ clipboard
// Hardboard clipboard: smooth tempered face, eased edges, hanging hole; nickel lever clip (riveted base
// plate, spring roll, pierced lever, clamp lip with rubber feet); three sheets with a printed incident
// report, curled corners and a dog-ear; a ballpoint pen tucked under the clip.
def('clipboard', () => {
  const A = atlas('clipboard', 512, 1024, (c) => {
    // form (0,0,512,662)
    rect(c, 0, 0, 512, 662, '#f6f3ea');
    noise(c, 0, 0, 512, 662, 6, 3);
    brand(c, 30, 52, 26, INK, { align: 'left' });
    txt(c, 'INCIDENT REPORT', 482, 44, { size: 24, color: INK, weight: '900', align: 'right' });
    txt(c, 'FORM 27-B/6', 482, 68, { size: 14, color: '#444', fam: MONO, align: 'right' });
    rect(c, 30, 86, 452, 3, INK);
    [['EMPLOYEE #', '0451'], ['LEVEL', '0'], ['DATE', '??/??/19??'], ['SUPERVISOR', 'Mr. ████']].forEach(([a, b], i) => {
      const y = 120 + i * 40;
      txt(c, a + ':', 34, y, { size: 16, color: INK, fam: MONO, align: 'left' });
      rect(c, 170, y + 12, 300, 1.5, '#666');
      txt(c, b, 182, y, { size: 22, color: '#23285a', fam: HAND, align: 'left', weight: 'bold' });
    });
    txt(c, 'ENTITY SIGHTED?', 34, 296, { size: 16, color: INK, fam: MONO, align: 'left' });
    for (const [x, l] of [[220, 'YES'], [320, 'NO'], [400, 'UNSURE']]) { c.strokeStyle = INK; c.lineWidth = 2; c.strokeRect(x, 286, 18, 18); txt(c, l, x + 26, 296, { size: 14, color: INK, fam: MONO, align: 'left' }); }
    checkmark(c, 229, 294, 26);
    txt(c, 'DESCRIBE INCIDENT:', 34, 340, { size: 16, color: INK, fam: MONO, align: 'left' });
    for (let i = 0; i < 6; i++) { rect(c, 34, 374 + i * 32, 444, 1.2, '#99a'); if (i < 4) scribble(c, 40, 366 + i * 32, i === 3 ? 180 : 400, 30 + i); }
    txt(c, 'it was smiling', 300, 494, { size: 22, color: '#23285a', fam: HAND, rot: -0.04 });
    txt(c, 'SIGNATURE:', 34, 590, { size: 16, color: INK, fam: MONO, align: 'left' });
    scribble(c, 150, 590, 160, 99, '#23285a', 2.5);
    inkStamp(c, 'CONFIDENTIAL', 360, 230, { rot: -0.25, w: 240, h: 56, size: 32, color: '#c0302a', seed: 3 });
    c.strokeStyle = 'rgba(120,80,40,0.35)'; c.lineWidth = 7; c.beginPath(); c.arc(410, 560, 48, 0.3, 5.6); c.stroke();
    c.strokeStyle = 'rgba(120,80,40,0.15)'; c.lineWidth = 12; c.beginPath(); c.arc(408, 562, 44, 2, 5); c.stroke();
    wear(c, 0, 0, 512, 662, 4, 0.6, { lightRatio: 0.05, edgeK: 0.5 });
    // hardboard (0,670,300,300) + under sheets edge (310,670,190,60) + pen (310,740,190,40)
    rect(c, 0, 670, 300, 300, '#7a4c2a');
    mottle(c, 0, 670, 300, 300, 18, 5, 0.5);
    noise(c, 0, 670, 300, 300, 18, 5);
    wear(c, 0, 670, 300, 300, 6, 3, { edge: false, lightRatio: 0.6 });
    rect(c, 310, 670, 190, 60, '#efebe0');
    for (let y = 672; y < 730; y += 6) rect(c, 310, y, 190, 1, 'rgba(150,140,120,0.3)');
    rect(c, 310, 740, 190, 40, '#1d3f8a');
    txt(c, 'R.O.O.M.  MEDIUM', 405, 760, { size: 14, color: '#d8d8d8', fam: MONO, weight: 'bold' });
  }, { plain: '#e6e6e6' });
  const board = mat({ name: 'clipboard_board', map: A, rough: 0.5, det: 'card', ns: 0.5 });
  const paper = mat({ name: 'clipboard_paper', map: A, rough: 0.85, det: 'paper', ns: 0.4 });
  const met = mat({ name: 'clipboard_clip', color: 0xd8dadc, metal: 1, rough: 0.24, det: 'polished', ns: 0.3 });
  const k = new Kit();
  const W = 0.23, H = 0.32;
  const sh = rrectShape(W, H, 0.012);
  sh.holes.push(circlePath(0, H / 2 - 0.011, 0.0055));
  const mr = A.R(0, 670, 300, 300);
  k.add(extrudeGeo(sh, 0.0022, 0.0006, { curveSegments: 6, bevelSegments: 2 }), board, { r: [-PI / 2, 0, 0], uvFn: (q) => [mr[0] + (q.x / W + 0.5) * (mr[2] - mr[0]), mr[1] + (q.y / H + 0.5) * (mr[3] - mr[1])] });
  // paper stack: two under sheets (offset) + printed top sheet with curl & a dog-eared corner
  const pw = 0.212, pl = 0.276, pz = 0.014;
  for (let i = 0; i < 2; i++) k.box(pw, 0.0004, pl, paper, { p: [0.0015 - i * 0.002, 0.0021 + i * 0.0004, pz + 0.002 + i * 0.001], r: [0, 0.01 - i * 0.02, 0], uv: A.R(310, 670, 190, 60) });
  const top = A.R(0, 0, 512, 662);
  k.add(sheetGeo(10, 14, (u, v) => {
    const x = (u - 0.5) * pw, z = pz + (0.5 - v) * pl;
    let y = 0.0031 + Math.max(0, z - 0.11) * Math.max(0, z - 0.11) * 0.6 * (0.5 + 0.5 * Math.sin(u * 4));
    // dog-ear at the bottom-right corner
    const cu = 1 - u, cv = v;
    if (cu + cv < 0.18) { y += (0.18 - cu - cv) * 0.035; }
    return [x, y, z];
  }), paper, { uvFn: (q) => { const u = (q.x / pw + 0.5), v = 0.5 - (q.z - pz) / pl; return [top[0] + u * (top[2] - top[0]), top[1] + v * (top[3] - top[1])]; } });
  // clip
  const cz = -H / 2 + 0.03;
  k.rbox(0.112, 0.0016, 0.034, 0.0008, met, { p: [0, 0.0034, cz], rs: 2 });
  for (const sx of [-1, 1]) k.lathe([[0.0032, 0], [0.0031, 0.0007, 0.0003], [0, 0.0009]], met, { p: [sx * 0.043, 0.0042, cz - 0.008], seg: 12, col: 0xb0b4b8 });
  k.cyl(0.0058, 0.1, met, { p: [0, 0.0094, cz - 0.004], r: [0, 0, PI / 2], seg: 20, bevel: 0.0012 });
  k.push({ p: [0, 0.0072, cz + 0.016], r: [-0.22, 0, 0] });
  k.rbox(0.104, 0.0018, 0.03, 0.0008, met, { rs: 2 });
  k.pop();
  for (const sx of [-1, 1]) k.rbox(0.012, 0.0018, 0.005, 0.0008, board, { p: [sx * 0.035, 0.0041, cz + 0.031], rs: 1, uv: A.R(310, 740, 190, 40), col: 0x2a2a2a });
  // lever arch with a punched hole (tube loop)
  k.tube([[-0.034, 0.012, cz - 0.004], [-0.031, 0.029, cz - 0.015], [-0.012, 0.036, cz - 0.021], [0.012, 0.036, cz - 0.021], [0.031, 0.029, cz - 0.015], [0.034, 0.012, cz - 0.004]], (t) => [0.0042, 0.0012], met, { tseg: 28, rseg: 8, up: [0, 0, 1] });
  // ballpoint pen lying on the report
  k.push({ p: [0.066, 0.0078, 0.03], r: [0, 0.32, 0] });
  k.lathe([[0, -0.07], [0.0012, -0.0695, 0.0008], [0.0042, -0.058, 0.004], [0.0046, 0.05], [0.0043, 0.056, 0.001], [0.0028, 0.066, 0.002], [0, 0.068]], board, { r: [-PI / 2, 0, 0], seg: 16, vFromY: [-0.07, 0.068], uv: A.R(310, 740, 190, 40, 1) });
  k.rbox(0.0024, 0.0016, 0.036, 0.0007, met, { p: [0, 0.0049, 0.04], rs: 1 });
  k.pop();
  k.colBox([W, 0.0058, H], [0, 0.0015, 0]);
  k.colBox([0.11, 0.034, 0.03], [0, 0.017, cz - 0.01]);
  return { kit: k, meta: { mass: 0.4, material: 'wood', hold: { grip: [W / 2 - 0.03, 0, 0.06], rot: [1.12, 0.08, 0.05], off: [-0.05, 0.03, 0] } } };
});

// ============================================================================ noise_maker (crafted alarm-clock trap)
// Twin-bell wind-up alarm clock (enamelled steel case, chrome bezel, domed crystal, printed dial, hands,
// hammer between polished bells, ball feet) rigged as a trap: duct-tape band holding a 9 V battery and
// trigger wiring, scribbled cardboard tag on a string.
def('noise_maker', () => {
  const A = atlas('noise_maker', 512, 512, (c) => {
    // dial (0,0,300,300)
    rect(c, 0, 0, 300, 300, '#f3eedf');
    const cx = 150, cy = 150;
    c.fillStyle = rgrad(c, cx, cy, 20, 150, [[0, '#f8f4e8'], [1, '#e6dfca']]); c.fillRect(0, 0, 300, 300);
    c.strokeStyle = '#222'; c.lineWidth = 3; c.beginPath(); c.arc(cx, cy, 140, 0, TAU); c.stroke();
    for (let i = 0; i < 60; i++) { const a = (i / 60) * TAU, l = i % 5 ? 6 : 14; c.lineWidth = i % 5 ? 2 : 4; c.beginPath(); c.moveTo(cx + Math.sin(a) * 132, cy - Math.cos(a) * 132); c.lineTo(cx + Math.sin(a) * (132 - l), cy - Math.cos(a) * (132 - l)); c.stroke(); }
    for (let h = 1; h <= 12; h++) { const a = (h / 12) * TAU; txt(c, String(h), cx + Math.sin(a) * 102, cy - Math.cos(a) * 102 + 2, { size: 28, color: '#222', fam: SERIF, weight: 'bold' }); }
    roomIcon(c, cx, cy - 52, 24, '#b52a20', null, 0.12);
    txt(c, 'R.O.O.M.', cx, cy + 44, { size: 18, color: '#222', weight: '900' });
    txt(c, 'WAKE UP, EMPLOYEE', cx, cy + 64, { size: 10, color: '#555', fam: MONO, weight: 'bold' });
    wear(c, 0, 0, 300, 300, 3, 1.0, { edge: false, lightRatio: 0.2 });
    // duct tape (310,0,200,60)
    rect(c, 310, 0, 200, 60, '#9da1a6');
    for (let x = 310; x < 510; x += 4) rect(c, x, 0, 1, 60, 'rgba(255,255,255,0.1)');
    noise(c, 310, 0, 200, 60, 14, 2);
    // tag (310,70,200,120)
    rect(c, 310, 70, 200, 120, '#d8c49a');
    noise(c, 310, 70, 200, 120, 14, 5);
    txt(c, 'TRAP!', 410, 108, { size: 40, color: '#b52a20', fam: HAND, weight: 'bold', rot: -0.05 });
    txt(c, 'wind • set • THROW', 410, 150, { size: 18, color: '#1d2b8a', fam: HAND, rot: -0.03 });
    circle(c, 326, 86, 6, '#8a7a5a');
    // red enamel (310,200,200,100)
    rect(c, 310, 200, 200, 100, '#b52a20');
    mottle(c, 310, 200, 200, 100, 10, 6, 0.6);
    wear(c, 310, 200, 200, 100, 8, 3, { edge: false, lightRatio: 0.8 });
    // 9V battery wrap (0,310,256,80)
    rect(c, 0, 310, 256, 80, '#141416');
    rect(c, 0, 350, 256, 40, ROOM_YELLOW);
    txt(c, '9V', 50, 332, { size: 26, color: '#fff', weight: '900' });
    txt(c, 'R.O.O.M. POWER', 160, 332, { size: 14, color: ROOM_YELLOW, weight: '900' });
    txt(c, 'ALKALINE', 128, 370, { size: 16, color: INK, weight: '900' });
  }, { plain: '#d8dadc' });
  const p = mat({ name: 'noisemaker_print', map: A, rough: 0.36, metal: 0.15, det: 'stipple', ns: 0.4 });
  const chrome = S.chrome();
  const glass = clear({ name: 'clock_crystal', rough: 0.02, env: 1.6 });
  const k = new Kit();
  const R = 0.05, red = A.R(310, 200, 200, 100);
  k.push({ r: [PI / 2, 0, 0] }); // lathe +Y -> +Z (face toward +Z)
  // enamelled case (back dome -> drum)
  k.lathe([[0, -0.024], [0.03, -0.0235, 0.004], [0.044, -0.021, 0.004], [0.049, -0.016, 0.003], [R, -0.01, 0.002], [R, 0.009]], p, { seg: 36, rseg: 0.0014, uv: red });
  // chrome bezel ring
  k.lathe([[R, 0.009], [R + 0.0015, 0.0105, 0.0008], [R + 0.0015, 0.0155, 0.0012], [R - 0.0012, 0.0172, 0.0008], [0.0465, 0.0162]], chrome, { seg: 40 });
  // dial
  k.lathe([[0.0466, 0.0115], [0, 0.0115]], p, { seg: 40, planar: { rect: A.R(0, 0, 300, 300), R: 0.0466 } });
  // hands + centre cap (+ red alarm hand)
  k.box(0.0034, 0.0007, 0.024, p, { p: [0.0068, 0.0124, -0.0086], r: [0, 0.8, 0], col: 0x161616 });
  k.box(0.0023, 0.0007, 0.036, p, { p: [-0.0088, 0.0131, -0.0134], r: [0, -0.55, 0], col: 0x161616 });
  k.box(0.0013, 0.0007, 0.029, p, { p: [0.0106, 0.0138, 0.0078], r: [0, 2.3, 0], col: 0xc0302a });
  k.cyl(0.0024, 0.003, chrome, { p: [0, 0.0142, 0], seg: 12 });
  // domed crystal
  k.lathe([[0.0466, 0.0158], [0.03, 0.0182, 0.01], [0, 0.0192]], glass, { seg: 32 });
  // winding keys & alarm set knob on the back
  for (const sx of [-1, 1]) {
    k.cyl(0.0022, 0.008, chrome, { p: [sx * 0.016, -0.0275, 0], seg: 8 });
    k.rbox(0.017, 0.0024, 0.011, 0.002, chrome, { p: [sx * 0.016, -0.0325, 0], rs: 1, col: 0xd8b878 });
  }
  k.pop();
  // bells, hammer, frame, legs
  for (const sx of [-1, 1]) {
    k.push({ p: [sx * 0.033, 0.056, -0.004], r: [0, 0, -sx * 0.62] });
    k.lathe([[0, 0.0015], [0.0215, 0.0015, 0.001], [0.0248, 0.0, 0.0008], [0.0248, 0.004, 0.003], [0.0215, 0.0145, 0.006], [0.012, 0.0212, 0.004], [0, 0.0228]], chrome, { seg: 24, rseg: 0.0014 });
    k.cyl(0.0021, 0.012, chrome, { p: [0, -0.005, 0], seg: 8 });
    k.pop();
    k.push({ p: [sx * 0.03, -0.047, -0.004], r: [0, 0, sx * 0.55] });
    k.cyl(0.0023, 0.018, chrome, { p: [0, -0.008, 0], seg: 8 });
    k.sphere(0.0056, chrome, { p: [0, -0.0182, 0], ws: 10, hs: 7 });
    k.pop();
  }
  k.tube([[-0.034, 0.05, -0.004], [0, 0.063, -0.004], [0.034, 0.05, -0.004]], 0.0021, chrome, { tseg: 16, rseg: 6 });
  k.cyl(0.0015, 0.022, chrome, { p: [0, 0.06, -0.004], seg: 6 });
  k.sphere(0.0036, chrome, { p: [0, 0.071, -0.004], ws: 10, hs: 6, col: 0xe0c070 });
  // rigged parts: duct-tape band holding a 9 V battery on the back, trigger wires, tag
  k.lathe([[R + 0.0012, -0.007], [R + 0.0014, 0.007]], p, { seg: 40, phi0: PI * 0.55, phiLen: PI * 0.9, r: [PI / 2, 0, 0], p: [0, 0, -0.004], vFromY: [-0.007, 0.007], uv: A.R(310, 0, 200, 60, 1) });
  k.rbox(0.026, 0.048, 0.017, 0.002, p, { p: [0.004, -0.004, -0.033], r: [0, 0, 0.12], rs: 2, faces: { pz: A.R(0, 310, 256, 80, 1), nz: A.R(0, 310, 256, 80, 3), px: A.R(0, 310, 256, 80, 1), nx: A.R(0, 310, 256, 80, 1) } });
  for (const sx of [-1, 1]) k.cyl(0.003, 0.004, chrome, { p: [0.004 + sx * 0.0065 - 0.003, 0.022, -0.033], seg: sx > 0 ? 6 : 10 });
  k.rbox(0.03, 0.012, 0.026, 0.002, p, { p: [0.004, 0.0, -0.03], rs: 1, uv: A.R(310, 0, 200, 60), col: 0xd0d0d0 });
  k.tube([[0.001, 0.024, -0.033], [-0.01, 0.034, -0.04], [-0.03, 0.03, -0.035], [-0.045, 0.012, -0.022], [-0.05, -0.01, -0.004]], 0.0011, p, { tseg: 24, rseg: 5, col: 0xc0302a });
  k.tube([[0.009, 0.024, -0.033], [0.022, 0.03, -0.042], [0.04, 0.022, -0.038], [0.052, 0.0, -0.022], [0.054, -0.02, -0.006]], 0.0011, p, { tseg: 24, rseg: 5, col: 0x1a1a1a });
  k.add(sheetGeo(2, 2, (u, v) => [-0.05 + u * 0.034 + v * 0.004, -0.0638, 0.012 + v * 0.022 - u * 0.012]), p, { uv: A.R(310, 70, 200, 120) });
  k.tube([[-0.034, -0.055, -0.004], [-0.042, -0.062, 0.006], [-0.047, -0.0635, 0.016]], 0.0005, p, { tseg: 8, rseg: 3, col: 0xd8d0b8 });
  k.colCyl(R + 0.0015, 0.05, [0, 0, -0.002], [PI / 2, 0, 0]);
  k.colBox([0.11, 0.03, 0.03], [0, 0.06, -0.004]);
  k.colBall(0.0056, [-0.0402, -0.0626, -0.004]);
  k.colBall(0.0056, [0.0402, -0.0626, -0.004]);
  return { kit: k, meta: { mass: 0.45, material: 'metal', hold: { grip: [0, -0.01, 0], rot: [0.12, -0.25, 0.04], off: [0, 0.02, 0] } } };
});

// ============================================================================ fuel_can (20 L jerrycan)
// Pressed-steel jerrycan: X-embossed broad faces with a raised border (displaced sheets), perimeter weld
// bead, triple handle, cam-lever spout cap with locking pin, worn red paint with chips, runs and stencils.
def('fuel_can', () => {
  const W = 0.165, H = 0.42, L = 0.345;
  const A = atlas('fuel_can', 1024, 512, (c) => {
    // broad sides (each 512 x 420): x along Z (front = -Z at the right on the +X face), y up
    for (const [x0, seed] of [[0, 3], [512, 4]]) {
      rect(c, x0, 0, 512, 420, '#b52a20');
      mottle(c, x0, 0, 512, 420, 14, seed, 0.9);
      noise(c, x0, 0, 512, 420, 10, seed);
      txt(c, 'R.O.O.M.', x0 + 256, 72, { size: 54, color: '#f1e9d8', fam: MONO, weight: '900', ls: 4, alpha: 0.9 });
      txt(c, 'FUEL', x0 + 256, 336, { size: 62, color: '#f1e9d8', fam: MONO, weight: '900', ls: 8, alpha: 0.9 });
      txt(c, '20 L • GASOLINE', x0 + 256, 382, { size: 20, color: '#f1e9d8', fam: MONO, weight: 'bold', alpha: 0.9 });
      hazardDiamond(c, x0 + 86, 210, 70, '#c8241c', '#fff', 'FLAMMABLE', 'flame', '3');
      txt(c, 'NO', x0 + 428, 196, { size: 22, color: '#f1e9d8', fam: MONO, weight: '900' });
      txt(c, 'SMOKING', x0 + 428, 222, { size: 16, color: '#f1e9d8', fam: MONO, weight: '900' });
      const r = new RNG(seed);
      for (let i = 0; i < 70; i++) {
        const x = x0 + r.range(0, 512), y = r.range(0, 420), w = r.range(2, 9);
        c.fillStyle = 'rgba(240,215,200,0.25)'; c.beginPath(); c.ellipse(x, y, w + 1.5, w * 0.6 + 1.5, r.next() * PI, 0, TAU); c.fill();
        c.fillStyle = r.next() < 0.5 ? '#4a4844' : '#6a3a1e'; c.beginPath(); c.ellipse(x, y, w, w * r.range(0.4, 0.9), r.next() * PI, 0, TAU); c.fill();
      }
      for (let i = 0; i < 8; i++) { const x = x0 + r.range(20, 490), y = r.range(280, 380); const g = lgrad(c, 0, y, 0, y + 70, [[0, 'rgba(110,55,20,0.5)'], [1, 'rgba(110,55,20,0)']]); c.fillStyle = g; c.fillRect(x, y, r.range(3, 8), 70); }
      // fuel stain running down from the spout corner
      const g2 = lgrad(c, x0 + 470, 0, x0 + 470, 200, [[0, 'rgba(60,30,10,0.4)'], [1, 'rgba(60,30,10,0)']]); c.fillStyle = g2; c.fillRect(x0 + 440, 0, 60, 200);
      wear(c, x0, 0, 512, 420, seed + 10, 3, { edgeK: 1.6, dirt: 1.6 });
    }
    // plain worn red (0,424,512,80)
    rect(c, 0, 424, 512, 80, '#b52a20'); mottle(c, 0, 424, 512, 80, 14, 9, 0.9); noise(c, 0, 424, 512, 80, 12, 9); wear(c, 0, 424, 512, 80, 19, 3, { edge: false });
    // cap (520,424,80,80) + bare steel (610,424,80,80)
    rect(c, 520, 424, 80, 80, '#2e2e2e'); txt(c, 'R', 560, 464, { size: 40, color: '#666', weight: '900' });
    rect(c, 610, 424, 80, 80, '#9a9ea2'); noise(c, 610, 424, 80, 80, 18, 4);
  }, { plain: '#b52a20' });
  const red = mat({ name: 'fuelcan_paint', map: A, rough: 0.5, metal: 0.2, det: 'powder', ns: 0.8 });
  const k = new Kit();
  const pr = A.R(0, 424, 512, 80), steelUV = A.R(610, 424, 80, 80);
  // core body (rounded box), broad faces replaced by embossed sheets
  k.rbox(W - 0.008, H, L, 0.022, red, { p: [0, H / 2, 0], rs: 3, faces: { px: pr, nx: pr, py: pr, ny: pr, pz: pr, nz: pr } });
  // Broad faces: a pillowed panel (rolled edge, flat plateau) plus pressed ridges built as real strips - a
  // raised border and the X - following the panel surface. Far fewer triangles than a displaced grid and the
  // relief stays crisp. Panel coordinates: z across, y up; uv from position so the print stays undistorted.
  const zA = L / 2 - 0.015, yA = 0.015, yB = H - 0.015;
  const roll = (z, y) => {
    const u = 0.5 + z / (2 * zA), v = (y - yA) / (yB - yA);
    const e = clamp(Math.min(u, 1 - u, v, 1 - v) / 0.045, 0, 1);
    return W / 2 - 0.004 + 0.0034 * Math.sin(e * PI / 2);
  };
  const gu = [0, 0.015, 0.03, 0.045, 0.06, 0.5, 0.94, 0.955, 0.97, 0.985, 1];
  const SEC = [-1, -0.62, -0.28, 0, 0.28, 0.62, 1];
  const ridge = (sx, P, hw, h, taper) => {
    // P: [[z, y], ...] path on the panel; cross-section bump (raised cosine), feet sunk 0.4 mm into the panel
    const pos = [], idx = [];
    const n = P.length;
    for (let i = 0; i < n; i++) {
      const a0 = P[Math.max(0, i - 1)], a1 = P[Math.min(n - 1, i + 1)];
      let tz = a1[0] - a0[0], ty = a1[1] - a0[1];
      const l = Math.hypot(tz, ty) || 1; tz /= l; ty /= l;
      const k = taper ? taper(i / (n - 1)) : 1;
      for (const sv of SEC) {
        const z = P[i][0] - ty * sv * hw * (0.5 + 0.5 * k), y = P[i][1] + tz * sv * hw * (0.5 + 0.5 * k);
        const hh = (h * k + 0.0004) * (0.5 + 0.5 * Math.cos(PI * sv)) - 0.0004;
        pos.push(sx * (roll(z, y) + hh), y, z * (sx > 0 ? -1 : 1));
      }
    }
    const m = SEC.length;
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < m - 1; j++) {
      const q = i * m + j;
      idx.push(q, q + m, q + 1, q + 1, q + m, q + m + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // wind outward (+x on the +X face)
    let nx = 0; const na = g.attributes.normal;
    for (let i = 0; i < na.count; i++) nx += na.getX(i);
    if (Math.sign(nx) !== sx) { for (let i = 0; i < idx.length; i += 3) { const t2 = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t2; } g.setIndex(idx); g.computeVertexNormals(); }
    return g;
  };
  const bz = L / 2 - 0.041, by0 = 0.045, by1 = H - 0.045, rc = 0.03;
  const border = [];
  for (const [cz, cy, a0] of [[bz - rc, by1 - rc, 0], [-bz + rc, by1 - rc, PI / 2], [-bz + rc, by0 + rc, PI], [bz - rc, by0 + rc, PI * 1.5]]) {
    for (let i = 0; i <= 4; i++) { const a = a0 + (i / 4) * (PI / 2); border.push([cz + Math.cos(a) * rc, cy + Math.sin(a) * rc]); }
  }
  border.push(border[0]);
  const diag = (z0, y0, z1, y1) => {
    const out = [];
    const d = rc * 0.45;
    const l = Math.hypot(z1 - z0, y1 - y0), dz = (z1 - z0) / l, dy = (y1 - y0) / l;
    for (const t of [0, 0.07, 0.14, 0.5, 0.86, 0.93, 1]) out.push([z0 + dz * d + (z1 - z0 - 2 * dz * d) * t, y0 + dy * d + (y1 - y0 - 2 * dy * d) * t]);
    return out;
  };
  const taper = (t) => sstep(0, 0.16, t) * sstep(0, 0.16, 1 - t);
  for (const sx of [-1, 1]) {
    const rect = sx > 0 ? A.R(0, 0, 512, 420) : A.R(512, 0, 512, 420);
    const uvFn = (q) => {
      const z = q.z * (sx > 0 ? -1 : 1);
      const u = 0.5 + z / (2 * zA), v = (q.y - yA) / (yB - yA);
      return [rect[0] + u * (rect[2] - rect[0]), rect[1] + v * (rect[3] - rect[1])];
    };
    k.add(sheetGeo(gu.length - 1, gu.length - 1, (u, v) => {
      const z = (gu[Math.round(u * (gu.length - 1))] - 0.5) * 2 * zA, y = yA + gu[Math.round(v * (gu.length - 1))] * (yB - yA);
      return [sx * roll(z, y), y, z * (sx > 0 ? -1 : 1)];
    }), red, { uvFn, dm: 0.03 });
    k.add(ridge(sx, border, 0.011, 0.0045), red, { uvFn, dm: 0.03 });
    k.add(ridge(sx, diag(-bz, by0, bz, by1), 0.013, 0.004, taper), red, { uvFn, dm: 0.03 });
    k.add(ridge(sx, diag(-bz, by1, bz, by0), 0.013, 0.004, taper), red, { uvFn, dm: 0.03 });
  }
  // perimeter weld bead in the centre plane (around top, front, bottom, back)
  const bead = [];
  const hz = L / 2 + 0.001, rr = 0.022;
  const cs = [[hz - rr, H - rr, 0], [-hz + rr, H - rr, PI / 2], [-hz + rr, rr, PI], [hz - rr, rr, PI * 1.5]];
  for (const [cz, cy, a0] of cs) for (let i = 0; i <= 4; i++) { const a = a0 + (i / 4) * (PI / 2); bead.push(V3(0, cy + Math.sin(a) * rr, cz + Math.cos(a) * rr)); }
  bead.push(bead[0].clone());
  k.tube(new THREE.CatmullRomCurve3(bead, false, 'centripetal'), 0.0042, red, { tseg: 48, rseg: 6, uv: pr, col: 0xd8d0c8 });
  // triple handle: bar + three posts
  const hy = H + 0.042;
  k.cyl(0.0115, 0.27, red, { p: [0, hy, 0.012], r: [PI / 2, 0, 0], seg: 16, uv: pr, bevel: 0.004 });
  for (const z of [-0.118, -0.034, 0.056, 0.142]) k.rbox(0.022, 0.05, 0.015, 0.005, red, { p: [0, H + 0.02, z], rs: 1, uv: pr });
  // spout: neck, cam-lever cap, locking pin chain
  k.push({ p: [0, H - 0.006, -L / 2 + 0.046], r: [-0.55, 0, 0] });
  k.lathe([[0.027, -0.01], [0.027, 0.03, 0.003], [0.025, 0.04]], red, { seg: 24, uv: pr });
  k.lathe([[0.0292, 0.036], [0.0298, 0.0372, 0.0006], [0.0298, 0.0565, 0.0015], [0.025, 0.059, 0.003], [0, 0.0595]], red, { seg: 28, uv: A.R(520, 424, 80, 80), col: 0xffffff });
  k.tube([[0.031, 0.05, 0.0], [0.034, 0.066, 0.016], [0.02, 0.06, 0.048], [0.004, 0.032, 0.062]], (t) => [0.004, 0.0028], red, { tseg: 16, rseg: 8, uv: steelUV, col: 0xc8ccd0 });
  k.cyl(0.0025, 0.03, red, { p: [0.031, 0.045, 0.004], r: [PI / 2, 0, 0], seg: 8, uv: steelUV, bevel: 0.0006 });
  k.pop();
  k.colBox([W, H + 0.0127, L], [0, H / 2, 0]); // weld bead stands 6 mm proud top and bottom
  k.colBox([0.03, 0.06, 0.29], [0, H + 0.03, 0.012]);
  k.colBox([0.06, 0.06, 0.06], [0, H + 0.02, -L / 2 + 0.035]);
  return { kit: k, meta: { mass: 15, material: 'metal', hold: { grip: [0, hy, 0.012], rot: [0, 0, 0.06], off: [0.05, -0.03, 0.05] } } };
});
