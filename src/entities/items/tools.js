// R.O.O.M. items — hand tools & equipment: flashlight, multitool, welder, crowbar, wrench, lighter,
// disposable camera, battery, tape, fuse.
import * as THREE from 'three';
import { Kit, def, PI, TAU, V3, sstep, clamp, lerp, fillet, latheGeo, loftGeo, capRound, sweepGeo, extrudeGeo, rrectShape, roundedShape, curve, HelixCurve, sheetGeo } from './core.js';
import { RNG } from '../../core/rng.js';
import { mat, clear, S } from './mats.js';
import {
  atlas, txt, rect, rrect, noise, mottle, wear, rubEdge, barcode, roomIcon, brand, hazardStripes, warnTri, lgrad,
  hazardDiamond, SANS, COND, MONO, VT, INK, ROOM_YELLOW,
} from './paint.js';

// ============================================================================ flashlight
// "ROOM-LITE 3000": yellow ABS body with rubber overmould grip, ribbed screw-on head, rubber impact bezel,
// orange-peel reflector, bulb with filament, rubber switch boot on a raised boss, tail cap with lanyard lug.
// Built along +Y (tail at 0), then turned so the beam points -Z; build +Z = final top.
def('flashlight', () => {
  const Y0 = 0.027, Y1 = 0.232; // print range along the body
  const yl = (y) => 448 * (1 - (y - Y0) / (Y1 - Y0)); // canvas y of a body station
  const A = atlas('flashlight', 512, 512, (c) => {
    const BODY = '#f0bf17';
    rect(c, 0, 0, 512, 448, BODY);
    mottle(c, 0, 0, 512, 448, 10, 4, 0.6);
    noise(c, 0, 0, 512, 448, 6, 11);
    // moulded parting line along both sides (u = 0.25 / 0.75)
    for (const x of [128, 384]) { rect(c, x - 1, 0, 2, 448, 'rgba(120,80,0,0.25)'); rect(c, x + 1, 0, 1, 448, 'rgba(255,240,180,0.35)'); }
    // head: thin black band + warning around the top of the head
    rect(c, 0, yl(0.2015) - 3, 512, 3, 'rgba(60,40,0,0.45)');
    txt(c, 'DO NOT LOOK INTO BEAM', 256, yl(0.216), { size: 15, color: INK, fam: MONO, maxW: 200, ls: 1 });
    txt(c, 'DO NOT LOOK INTO BEAM', 0, yl(0.216), { size: 15, color: INK, fam: MONO, maxW: 200, ls: 1 });
    txt(c, 'DO NOT LOOK INTO BEAM', 512, yl(0.216), { size: 15, color: INK, fam: MONO, maxW: 200, ls: 1 });
    // neck: model plate on top, "PUSH" arrow near the switch
    const yb0 = yl(0.101), yb1 = yl(0.158); // visible straight body between grip and neck
    txt(c, 'ON / OFF', 256, yl(0.1115), { size: 13, color: INK, fam: MONO, weight: 'bold' });
    // sides: big model name (reads tail -> head), corporate line
    for (const [x, rot] of [[128, PI / 2], [384, -PI / 2]]) {
      const ym = (yb0 + yb1) / 2;
      c.save(); c.translate(x, ym); c.rotate(rot);
      txt(c, 'ROOM-LITE', 0, -22, { size: 30, color: INK, fam: SANS, weight: '900', italic: true, maxW: 112, ls: -1 });
      rect(c, -52, -4, 104, 3, INK);
      txt(c, '3000', -16, 14, { size: 22, color: '#b3261e', fam: SANS, weight: '900', italic: true });
      txt(c, 'HEAVY', 34, 8, { size: 9, color: INK, fam: MONO, weight: 'bold' });
      txt(c, 'DUTY', 34, 18, { size: 9, color: INK, fam: MONO, weight: 'bold' });
      txt(c, '6 VOLT • IMPACT RESISTANT', 0, 36, { size: 9, color: INK, fam: MONO, weight: 'bold', maxW: 106 });
      c.restore();
    }
    // underside: white regulatory sticker with serial
    c.save(); c.translate(0, (yb0 + yb1) / 2);
    for (const x0 of [0, 512]) {
      c.save(); c.translate(x0, 0); c.rotate(-PI / 2);
      rrect(c, -40, -34, 80, 68, 3, '#f4f1e6');
      txt(c, 'PROPERTY OF', 0, -22, { size: 9, color: INK, fam: MONO, weight: 'bold' });
      roomIcon(c, -22, -2, 14, INK, null, 0.12);
      txt(c, 'R.O.O.M.', 10, -2, { size: 13, color: INK, weight: '900' });
      txt(c, 'SN 0451-B', 0, 16, { size: 10, color: INK, fam: MONO });
      barcode(c, -30, 22, 60, 9, 7, false);
      c.restore();
    }
    c.restore();
    // tail end of the body (just above the cap): stamped text
    txt(c, 'MADE IN SUBLEVEL 4', 256, yl(0.034), { size: 10, color: 'rgba(70,50,0,0.8)', fam: MONO });
    // grime: darker toward the tail (handled), lighter scuffs, rubbed edges near the head step
    wear(c, 0, 0, 512, 448, 21, 2.6, { edge: false, lightRatio: 0.55, dirt: 1.2 });
    const g = lgrad(c, 0, yl(0.2), 0, yl(0.19), [[0, 'rgba(255,250,220,0.35)'], [1, 'rgba(255,250,220,0)']]);
    c.fillStyle = g; c.fillRect(0, yl(0.2), 512, yl(0.19) - yl(0.2));
    rubEdge(c, 0, yl(0.2) - 2, 512, 4, '#fff6cf', 3, 'tb', 0.5);
    // inside of the grip (hidden) left plain
  }, { plain: '#f0bf17' });
  const yellow = mat({ name: 'flashlight_body', map: A, rough: 0.42, det: 'stipple', ns: 0.5 });
  const rubber = S.rubber();
  const chrome = S.chrome();
  const lensMat = clear({ name: 'flashlight_lens', unique: true, rough: 0.03, env: 1.4 });
  lensMat.emissive.setHex(0xfff0c8);
  lensMat.emissiveIntensity = 0;
  const steel = chrome;
  const k = new Kit();
  k.push({ r: [-PI / 2, 0, 0] }); // build along +Y, tail at y = 0 -> beam toward -Z
  // ---- tail cap (rubberised) with lanyard lug
  k.lathe([[0, -0.0032], [0.008, -0.003], [0.0172, -0.0016, 0.0025], [0.0206, 0.003, 0.002], [0.0208, 0.009, 0.0004], [0.0201, 0.0098, 0.0003], [0.0201, 0.0106, 0.0003], [0.0208, 0.0114, 0.0004], [0.0208, 0.0172, 0.0004], [0.0201, 0.018, 0.0003], [0.0201, 0.0188, 0.0003], [0.0208, 0.0196, 0.0004], [0.0208, 0.0235], [0.0203, 0.0262, 0.0008], [0.0189, 0.0268]], rubber, { seg: 36 });
  k.torus(0.0052, 0.0019, rubber, { arc: PI, r: [0, 0, PI], p: [0, -0.0026, 0], rseg: 8, tseg: 12 });
  k.torus(0.0068, 0.00075, steel, { r: [0, PI / 2, 0], p: [0, -0.0112, 0], rseg: 6, tseg: 24 });
  // ---- body + neck (print), parting step
  const flare = [];
  for (let i = 1; i <= 9; i++) { const t = i / 9; flare.push([0.0195 + (0.0338 - 0.0195) * (1 - Math.cos(PI * t)) / 2, 0.158 + t * 0.04]); }
  k.lathe([[0.0189, 0.0262], [0.0195, 0.0285, 0.001], [0.0195, 0.158], ...flare, [0.0338, 0.1995, 0.0005], [0.0331, 0.2006, 's'], [0.0322, 0.2006]], yellow, { seg: 40, phi0: PI, vFromY: [Y0, Y1], uv: A.R(0, 0, 512, 448), raw: false });
  // ---- ribbed screw-on head
  const head = [[0.0322, 0.2006], [0.0331, 0.2006, 's'], [0.0345, 0.2016, 0.0006]];
  for (let y = 0.2045; y < 0.2295; y += 0.0035) head.push([0.0346, y]);
  head.push([0.0346, 0.2305], [0.0342, 0.2322]);
  k.lathe(head, yellow, {
    seg: 60, phi0: PI, vFromY: [Y0, Y1], uv: A.R(0, 0, 512, 448),
    rmod: (phi, y, r) => {
      const e = sstep(0.2032, 0.2072, y) * (1 - sstep(0.2262, 0.2302, y));
      return r + 0.00115 * e * Math.pow(0.5 + 0.5 * Math.cos(phi * 10), 3);
    },
  });
  // ---- rubber overmould grip: twelve flutes + ring grooves
  const grip = [[0.0191, 0.0405], [0.0207, 0.0416, 0.0006]];
  for (let i = 0; i < 6; i++) {
    const y = 0.0442 + i * 0.0094;
    grip.push([0.0211, y], [0.0211, y + 0.0068, 0.0007], [0.0205, y + 0.0078, 0.0003], [0.0205, y + 0.0085, 0.0003], [0.0211, y + 0.0094]);
  }
  grip.push([0.0211, 0.0985], [0.0207, 0.0995, 0.0006], [0.0191, 0.1005]);
  k.lathe(grip, rubber, {
    seg: 48,
    rmod: (phi, y, r) => {
      const e = sstep(0.0435, 0.0475, y) * (1 - sstep(0.094, 0.098, y));
      return r - 0.00055 * e * Math.pow(0.5 + 0.5 * Math.cos(phi * 12), 2);
    },
  });
  // ---- switch boss on top (+Z) with rubber boot
  k.rbox(0.021, 0.032, 0.013, 0.0042, yellow, { p: [0, 0.128, 0.0158], rs: 3 });
  k.push({ p: [0, 0.128, 0.0222], r: [PI / 2, 0, 0] });
  k.lathe([[0.0082, -0.0016], [0.0082, 0.0004, 0.0012], [0.0066, 0.0026, 0.002], [0.0032, 0.0042, 0.003], [0, 0.0046]], rubber, { seg: 28 });
  k.pop();
  // ---- rubber impact bezel
  k.lathe([[0.0338, 0.2302], [0.0362, 0.2316, 0.001], [0.0369, 0.2462, 0.0026], [0.0356, 0.2489, 0.0014], [0.0303, 0.2489, 0.0009], [0.0298, 0.2446]], rubber, { seg: 48 });
  // ---- orange-peel parabolic reflector (inner surface) + bulb socket
  const refl = [];
  const fL = 0.0071, yv = 0.2135;
  for (let i = 0; i <= 10; i++) { const r = 0.0296 - (0.0296 - 0.0046) * (i / 10); refl.push([r, yv + (r * r) / (4 * fL)]); }
  refl.push([0.0046, yv + 0.0005], [0.0034, yv + 0.0005, 's'], [0.0034, yv - 0.002]);
  k.lathe(refl, chrome, { seg: 40, raw: true });
  // ---- lens (glass) + bulb (glass envelope) + filament: part 'lens' (glows when on)
  k.lathe([[0.0297, 0.2438], [0.0297, 0.2444, 's'], [0.0284, 0.2449], [0, 0.2449]], lensMat, { seg: 40, part: 'lens', raw: true });
  k.lathe([[0.0022, 0.214], [0.0021, 0.2148, 0.001], [0.003, 0.2175, 0.0015], [0.0029, 0.2205, 0.0012], [0.0016, 0.2226], [0, 0.2228]], lensMat, { seg: 16, part: 'lens' });
  k.add(new THREE.TubeGeometry(new HelixCurve(0.0007, 0.0034, 5), 30, 0.00018, 4, false), steel, { p: [0.0017, 0.2172, 0], r: [0, 0, PI / 2], col: 0x6a6a6a });
  k.pivot('lens', [0, 0.2449, 0]);
  // ---- colliders, anchors
  k.colCyl(0.0208, 0.2005, [0, 0.0968, 0]);
  k.colCyl(0.0369, 0.05, [0, 0.2235, 0]);
  k.anchor('lens', [0, 0.2452, 0]);
  k.pop();
  return {
    kit: k,
    meta: {
      mass: 0.45, material: 'plastic',
      hold: { grip: [0, 0, -0.072], rot: [0.04, 0.02, 0] },
      init(inst, opts) {
        const lens = inst.parts.lens;
        const mats = [];
        lens.traverse((o) => { if (o.isMesh) mats.push(o.material); });
        inst.object.userData.setOn = (on) => {
          for (const m of mats) { m.emissiveIntensity = on ? 3.2 : 0; }
        };
        if (opts.on) inst.object.userData.setOn(true);
      },
    },
  };
});

// ============================================================================ multitool
// Butterfly-style pliers multitool, pliers deployed: forged needle-nose jaws with wire cutters and a
// big pivot screw, two stainless channel handles with red anodised scales (laser-etched logo, machined
// grip grooves), stowed tool tangs visible along the inner side, rivets and a lanyard ring.
// Lies flat: length along Z (jaws toward -Z), scales facing up.
def('multitool', () => {
  const A = atlas('multitool', 512, 256, (c) => {
    // scale face (0,0,512,96): length along x (pivot end at x = 0), anodised red with etched graphics
    const g = lgrad(c, 0, 0, 0, 96, [[0, '#c7342a'], [0.5, '#a8231b'], [1, '#86170f']]);
    c.fillStyle = g; c.fillRect(0, 0, 512, 96);
    for (let y = 0; y < 96; y += 2) rect(c, 0, y, 512, 1, `rgba(255,255,255,${0.02 + (y % 6 === 0 ? 0.03 : 0)})`);
    noise(c, 0, 0, 512, 96, 8, 8);
    const etch = '#e8e2d8';
    roomIcon(c, 112, 48, 40, etch, null, 0.11);
    txt(c, 'R.O.O.M.', 236, 38, { size: 38, color: etch, weight: '900', maxW: 170, ls: 2 });
    txt(c, 'MULTI-TOOL  •  MK II', 236, 70, { size: 13, color: etch, fam: MONO, maxW: 170, ls: 1 });
    for (let x = 352; x < 470; x += 11) { rect(c, x, 16, 4, 64, 'rgba(240,230,220,0.85)'); rect(c, x + 4, 16, 1, 64, 'rgba(60,10,8,0.6)'); }
    rubEdge(c, 0, 0, 512, 96, '#d8d2cc', 4, 'all', 0.6);
    wear(c, 0, 0, 512, 96, 9, 2.4, { edge: false, lightRatio: 0.9 });
    // plain anodised red (0,100,256,60)
    rect(c, 0, 100, 256, 60, '#a8231b');
    noise(c, 0, 100, 256, 60, 8, 9);
    // tool tang face (260,100,252,60): satin steel with etched markings
    rect(c, 260, 100, 252, 60, '#d8dadc');
    txt(c, '420HC • R.O.O.M.', 386, 130, { size: 14, color: 'rgba(60,60,64,0.8)', fam: MONO });
  }, { plain: '#d8dadc' });
  const red = mat({ name: 'multitool_scale', map: A, metal: 1, rough: 0.36, det: 'brushed', ns: 0.35 });
  const steel = S.steel();
  const k = new Kit();
  const dH = 0.14, dJ = 0.14;
  const P0 = [0, 0, 0];
  // ---- jaws (each half: plan outline extruded, tapered toward the tip)
  for (const sx of [-1, 1]) {
    k.push({ p: P0, r: [0, -sx * dJ, 0] });
    const pts = [[0, -0.0445], [0.0013, -0.0447, 0.001], [0.0032, -0.036], [0.0047, -0.025], [0.0068, -0.013], [0.0088, -0.004, 0.003], [0.0092, 0.008, 0.003], [0.0035, 0.018], [0.0006, 0.018], [0.0006, 0.004], [0.0018, 0.0015], [0.0018, -0.0035], [0, -0.0062]];
    const sh = roundedShape(pts.map(([x, z, f]) => [sx * x, -z, f]), 0, { step: 0.4 });
    k.add(extrudeGeo(sh, 0.0068, 0.0009, { bevelSegments: 2, curveSegments: 6 }), steel, {
      r: [-PI / 2, 0, 0],
      deform: (v) => { const t = Math.min(1, Math.max(0, v.y / 0.045)); v.z *= 1 - 0.55 * t * t; },
      col: 0xd6d8da,
    });
    k.pop();
  }
  // pivot: washer + domed screw (top and bottom)
  for (const sy of [-1, 1]) {
    k.push({ p: [0, sy * 0.0042, 0], r: [sy < 0 ? PI : 0, 0, 0] });
    k.lathe([[0.0068, -0.0003], [0.0068, 0.0006, 0.0003], [0.0052, 0.0009], [0.0046, 0.0014, 0.0008], [0.0024, 0.0021, 0.001], [0, 0.0022]], steel, { seg: 24, col: 0xc4c6c8 });
    k.cyl(0.0012, 0.0008, steel, { p: [0, 0.0019, 0], seg: 6, col: 0x2a2a2c, bevel: 0.0001 });
    k.pop();
  }
  // ---- handles
  for (const sx of [-1, 1]) {
    k.push({ p: P0, r: [0, sx * dH, 0] });
    k.push({ p: [sx * 0.0118, 0, 0.058] });
    // stainless channel body
    k.rbox(0.021, 0.0118, 0.098, 0.0032, steel, { rs: 3, col: 0xcfd1d3 });
    k.colBox([0.022, 0.0154, 0.1]);
    // scales top & bottom (scale print on the outside faces)
    for (const sy of [1, -1]) {
      k.rbox(0.0176, 0.0018, 0.082, 0.0008, red, {
        p: [0, sy * 0.0062, 0.002], rs: 2,
        faces: { py: A.R(0, 0, 512, 96, sx > 0 ? 3 : 1), ny: A.R(0, 0, 512, 96, sx > 0 ? 1 : 3), px: A.R(0, 100, 256, 60), nx: A.R(0, 100, 256, 60), pz: A.R(0, 100, 256, 60), nz: A.R(0, 100, 256, 60) },
      });
      for (const z of [-0.033, 0.035]) k.lathe([[0.0021, 0], [0.0021, 0.0003, 0.0002], [0.0014, 0.0007, 0.0004], [0, 0.0008]], steel, { seg: 12, p: [0, sy * 0.0071, z], r: [sy < 0 ? PI : 0, 0, 0], col: 0xbfc2c4 });
    }
    // stowed tool tangs along the inner side (stacked plates with nail nicks)
    for (let i = 0; i < 3; i++) {
      const y = -0.0034 + i * 0.0034;
      k.rbox(0.0016, 0.0026, 0.07 - i * 0.008, 0.0006, steel, { p: [-sx * 0.0103, y, 0.004 + i * 0.004], rs: 1, col: [0xb8bbbe, 0xd0d2d4, 0xa8abae][i] });
      k.rbox(0.0008, 0.0008, 0.0045, 0.0003, steel, { p: [-sx * 0.0112, y, -0.012 + i * 0.006], rs: 1, col: 0x6a6c70 });
    }
    k.pop();
    k.pop();
  }
  // lanyard ring on the right handle butt
  k.push({ p: P0, r: [0, dH, 0] });
  k.torus(0.0052, 0.0009, steel, { p: [0.0118, 0, 0.1105], r: [PI / 2, 0, 0], rseg: 6, tseg: 20, col: 0xd8dadc });
  k.pop();
  // ---- colliders
  k.colBox([0.02, 0.0084, 0.05], [0, 0, -0.02]);
  return { kit: k, meta: { mass: 0.24, material: 'metal', hold: { grip: [0, 0, 0.045], rot: [0.45, 0.1, -0.25] } } };
});

// ============================================================================ welder
// "ARC-MATE 18V": cordless handheld inverter stick welder. Moulded red housing with vents, rating plate and
// warning labels, rubber overmould pistol grip with arc trigger, current dial + LCD, slide-on battery pack
// (the item's "fuel"), rubber nose collar with a copper electrode holder clamping a flux-coated rod, and
// a ground lead coiled to a spring clamp clipped to the battery. Stands on its battery; rod points -Z.
def('welder', () => {
  const RED = '#b3241b';
  const A = atlas('welder', 512, 512, (c) => {
    // housing wrap (0,0,512,256): x = around (bottom seam, right side x=128, top x=256, left x=384), y: rear (top) -> nose (bottom)
    rect(c, 0, 0, 512, 256, RED);
    mottle(c, 0, 0, 512, 256, 10, 2, 0.7);
    noise(c, 0, 0, 512, 256, 7, 5);
    // vents on both sides near the rear (reads as slots with depth)
    for (const x0 of [128, 384]) {
      for (let i = 0; i < 6; i++) {
        const y = 22 + i * 13;
        rrect(c, x0 - 34, y, 68, 7, 3.5, '#1a0c0a');
        rect(c, x0 - 31, y + 6, 62, 1.5, 'rgba(255,190,170,0.25)');
      }
    }
    // side logos (text runs along the body, reading nose -> rear on the right side)
    for (const [x0, rot] of [[128, PI / 2], [384, -PI / 2]]) {
      c.save(); c.translate(x0, 170); c.rotate(rot);
      rrect(c, -62, -30, 124, 44, 4, '#f0ece2');
      txt(c, 'ARC-MATE', 0, -14, { size: 26, color: RED, weight: '900', italic: true, maxW: 116, ls: -0.5 });
      txt(c, '18V CORDLESS INVERTER', 0, 6, { size: 9, color: INK, fam: MONO, weight: 'bold', maxW: 116 });
      brand(c, 0, 28, 10, '#f0ece2');
      c.restore();
    }
    // top: rating plate + warning
    rrect(c, 222, 110, 68, 90, 3, '#d8d6d0');
    txt(c, 'IN  18V ⎓', 256, 122, { size: 9, color: INK, fam: MONO, weight: 'bold' });
    txt(c, 'OUT 20–120A', 256, 134, { size: 9, color: INK, fam: MONO, weight: 'bold' });
    txt(c, 'X 35% 120A', 256, 146, { size: 9, color: INK, fam: MONO });
    txt(c, 'IP21S  CLASS F', 256, 158, { size: 9, color: INK, fam: MONO });
    barcode(c, 230, 166, 52, 14, 42, false);
    txt(c, 'SN 0451-W', 256, 190, { size: 9, color: INK, fam: MONO });
    rrect(c, 216, 206, 80, 40, 3, ROOM_YELLOW);
    warnTri(c, 232, 226, 22, ROOM_YELLOW, INK);
    txt(c, 'ARC RAYS', 268, 219, { size: 9, color: INK, weight: '900' });
    txt(c, 'BURN EYES', 268, 231, { size: 9, color: INK, weight: '900' });
    wear(c, 0, 0, 512, 256, 4, 2.6, { edge: false, lightRatio: 0.65, dirt: 1.4 });
    // battery pack (0,256,512,128): sides of an rbox (front/back faces + top/bottom)
    rect(c, 0, 256, 512, 128, '#1c1d1f');
    noise(c, 0, 256, 512, 128, 8, 3);
    rect(c, 0, 300, 512, 10, ROOM_YELLOW);
    txt(c, 'R.O.O.M. POWER  18V  4.0Ah  Li-ION', 150, 334, { size: 16, color: '#e8e4dc', fam: MONO, weight: 'bold', maxW: 280 });
    for (let i = 0; i < 4; i++) circle4(c, 340 + i * 18, 334, 5, i < 3 ? '#3ae070' : '#264a30');
    txt(c, 'PUSH', 440, 334, { size: 12, color: '#e8e4dc', fam: MONO, weight: 'bold' });
    wear(c, 0, 256, 512, 128, 6, 3, { edge: false, lightRatio: 0.85 });
    // LCD (0,388,128,60)
    rect(c, 0, 388, 128, 60, '#2a3226');
    rect(c, 6, 394, 116, 48, '#9fb98a');
    txt(c, '090A', 60, 420, { size: 36, color: '#18220f', fam: VT });
    txt(c, 'MMA', 110, 404, { size: 10, color: '#18220f', fam: MONO, weight: 'bold' });
    // dial cap (132,388,60,60)
    rect(c, 132, 388, 60, 60, '#202022');
    rect(c, 160, 392, 4, 22, '#f0ece2');
    // copper clamp & flux coating swatches
    rect(c, 200, 388, 60, 60, '#9a9690');
    noise(c, 200, 388, 60, 60, 30, 4);
    function circle4(cc, x, y, r, col) { cc.beginPath(); cc.arc(x, y, r, 0, TAU); cc.fillStyle = col; cc.fill(); }
  }, { plain: RED });
  const body = mat({ name: 'welder_body', map: A, rough: 0.46, det: 'stipple', ns: 0.6 });
  const rubber = S.rubber();
  const copper = S.copper();
  const k = new Kit();
  // ---- housing (loft along Z: nose at -Z)
  const Z0 = -0.082, Z1 = 0.092;
  k.add(loftGeo(40, 30, (v) => {
    const z = lerp(Z0, Z1, v);
    const f = capRound(v, 0.14) * capRound(1 - v, 0.07);
    const nose = 0.52 + 0.48 * sstep(0.0, 0.42, v);
    return { x: 0, y: 0.05 + 0.004 * v - 0.004 * (1 - sstep(0, 0.4, v)), z, w: 0.031 * nose * f + 0.0004, h: 0.034 * (0.62 + 0.38 * sstep(0, 0.35, v)) * f + 0.0004, n: 3.4, n2: 3.0 };
  }), body, { uv: A.R(0, 0, 512, 256) });
  // vent louvres: raised bars between the printed slots on both sides
  for (const sx of [-1, 1]) for (let i = 0; i < 7; i++) {
    const z = Z1 - ((19 + i * 13) / 256) * (Z1 - Z0);
    k.rbox(0.0022, 0.026, 0.0026, 0.0008, body, { p: [sx * 0.0311, 0.0535, z], rs: 1, col: 0xa82218 });
  }
  // ---- grip (rubber overmould), tilted back
  k.push({ p: [0, 0.03, 0.05], r: [PI / 2 - 0.24, 0, 0] });
  k.add(loftGeo(28, 18, (v) => {
    const t = v;
    const swell = 1 + 0.08 * Math.sin(t * PI);
    return { x: 0, y: 0.002 * Math.sin(t * PI), z: lerp(-0.01, 0.105, t), w: 0.0168 * swell, h: 0.0215 * swell, n: 2.6 };
  }), rubber, {});
  // finger ridges on the front of the grip
  for (let i = 0; i < 3; i++) k.rbox(0.028, 0.006, 0.0065, 0.0025, rubber, { p: [0, -0.0225, 0.04 + i * 0.017], rs: 2 });
  k.pop();
  // trigger
  k.push({ p: [0, 0.012, 0.0285], r: [-0.24, 0, 0] });
  k.rbox(0.011, 0.022, 0.012, 0.004, body, { rs: 2, col: 0x2a2a2c });
  k.pop();
  // ---- battery pack
  k.rbox(0.072, 0.034, 0.092, 0.006, body, {
    p: [0, -0.077, 0.068], rs: 3,
    faces: { px: A.R(0, 256, 512, 128), nx: A.R(0, 256, 512, 128, 4), pz: A.R(0, 290, 120, 30), nz: A.R(0, 290, 120, 30), py: A.R(0, 260, 120, 30), ny: A.R(0, 260, 120, 30) },
  });
  k.rbox(0.052, 0.012, 0.07, 0.004, body, { p: [0, -0.056, 0.062], rs: 2, uv: A.R(0, 260, 120, 30), col: 0xd0d0d0 });
  // ---- dial + LCD on top
  k.push({ p: [0, 0.087, 0.05] });
  k.lathe([[0.0118, -0.004], [0.0118, 0.006, 0.0015], [0.0102, 0.0095, 0.002], [0, 0.0098]], rubber, {
    seg: 36, rmod: (phi, y, r) => r + (y > -0.002 && y < 0.007 ? 0.0006 * Math.pow(0.5 + 0.5 * Math.cos(phi * 16), 2) : 0),
  });
  k.add(new THREE.CircleGeometry(0.0085, 24), body, { p: [0, 0.0101, 0], r: [-PI / 2, 0, 0], uv: A.R(132, 388, 60, 60) });
  k.pop();
  k.push({ p: [0, 0.0835, 0.004], r: [-0.08, 0, 0] });
  k.rbox(0.03, 0.004, 0.022, 0.0015, body, { rs: 1, faces: { py: A.R(0, 388, 128, 60, 1) }, col: 0xffffff });
  k.pop();
  // ---- nose: rubber collar + copper electrode holder + flux-coated rod
  k.push({ p: [0, 0.046, Z0 + 0.006], r: [-PI / 2, 0, 0] }); // local +Y -> -Z
  k.lathe([[0.0165, -0.006], [0.0168, 0.004, 0.002], [0.0142, 0.012, 0.003], [0.0105, 0.016, 0.002], [0.0098, 0.022]], rubber, { seg: 32 });
  k.lathe([[0.0098, 0.02], [0.0102, 0.022, 0.001], [0.0088, 0.03, 0.002], [0.0058, 0.036, 0.0015], [0.0044, 0.038]], copper, { seg: 24 });
  // clamp jaws + spring lever
  for (const sx of [-1, 1]) k.rbox(0.0042, 0.016, 0.0055, 0.0012, copper, { p: [sx * 0.0024, 0.044, 0], rs: 2, col: 0xd8a080 });
  k.tube([[0.004, 0.026, 0.009], [0.006, 0.034, 0.014], [0.003, 0.042, 0.011]], 0.0011, copper, { tseg: 10, rseg: 6, col: 0xb0b4b8 });
  // rod: bare end in the clamp, flux coating, struck tip
  k.cyl(0.00125, 0.03, copper, { p: [0, 0.046, 0], seg: 8, col: 0x9a9ea2, bevel: 0.0003 });
  k.lathe([[0.0021, 0.05], [0.0021, 0.147], [0.0017, 0.1495, 0.0004], [0.0012, 0.1505]], body, { seg: 10, uv: A.R(200, 388, 60, 60), col: 0xd2d0c8 });
  k.cyl(0.00125, 0.006, copper, { p: [0, 0.052, 0], seg: 8, col: 0x8a8e92, bevel: 0.0002 });
  k.anchor('tip', [0, 0.1508, 0]);
  k.pop();
  // ---- ground lead: from the rear of the housing, a loose loop down to a spring clamp clipped on the battery
  k.tube([[0, 0.032, 0.095], [0.006, 0.012, 0.112], [0.03, -0.012, 0.118], [0.048, -0.04, 0.1], [0.046, -0.058, 0.082], [0.0405, -0.066, 0.07]], 0.0034, rubber, { tseg: 36, rseg: 8, col: 0x3a3a3c });
  k.push({ p: [0.0418, -0.072, 0.06], r: [0, 0, 0.12] });
  k.rbox(0.006, 0.03, 0.016, 0.002, copper, { p: [0.002, 0.0, 0], rs: 2, col: 0xc8ccd0 });
  k.rbox(0.0045, 0.026, 0.013, 0.0018, copper, { p: [-0.0025, -0.002, 0], rs: 2, col: 0xd09070 });
  k.torus(0.004, 0.001, copper, { p: [0.003, 0.012, 0], r: [0, PI / 2, 0], rseg: 6, tseg: 14, col: 0xb0b4b8 });
  k.pop();
  // ---- colliders
  k.colBox([0.064, 0.072, 0.176], [0, 0.05, 0.005]);
  k.push({ p: [0, 0.03, 0.05], r: [PI / 2 - 0.24, 0, 0] });
  k.colBox([0.036, 0.046, 0.1], [0, 0, 0.048]);
  k.pop();
  k.colBox([0.074, 0.046, 0.094], [0, -0.071, 0.068]);
  k.colBox([0.024, 0.024, 0.04], [0, 0.046, Z0 - 0.012]);
  k.colBox([0.006, 0.006, 0.11], [0, 0.046, Z0 - 0.097]);
  return { kit: k, meta: { mass: 2.4, material: 'metal', hold: { grip: [0, -0.019, 0.062], rot: [0.06, 0, 0], off: [0, 0.01, 0.01] } } };
});

// ============================================================================ crowbar
// 24" gooseneck wrecking bar: 3/4" hex forged stock with rounded arrises, red powder coat with chips and
// stencils, ground bare ends. Chisel end flattened into a bent wedge; gooseneck hook ending in a flared,
// split (fishtail) nail claw. Lies flat with the hook in the floor plane.
const smin = (a, b, k) => -k * Math.log(Math.exp(-a / k) + Math.exp(-b / k));
function roundHex(a, round = 1.075) {
  const seg = PI / 3;
  const aa = (((a % seg) + seg) % seg) - seg / 2;
  const r = smin(1 / Math.cos(aa), round, 0.035);
  return [Math.cos(a) * r, Math.sin(a) * r];
}
def('crowbar', () => {
  const A = atlas('crowbar', 1024, 256, (c) => {
    // painted shaft (0,0,1024,256): x = along (chisel -> claw), y = around (top face at y = 192)
    rect(c, 0, 0, 1024, 256, '#b32a1f');
    mottle(c, 0, 0, 1024, 256, 12, 5, 0.8);
    noise(c, 0, 0, 1024, 256, 10, 5);
    // stencils on the top flat
    txt(c, 'R.O.O.M.', 300, 192, { size: 30, color: '#efe8da', weight: '900', ls: 6 });
    txt(c, 'TOOL CRIB 4', 520, 192, { size: 17, color: '#efe8da', fam: MONO, weight: 'bold', ls: 2 });
    txt(c, 'FORGED • 24"', 300, 64, { size: 17, color: '#efe8da', fam: MONO, weight: 'bold', ls: 2 });
    // paint chips: bare dark steel with a light rim, more toward both ends
    const r = new RNG(4);
    for (let i = 0; i < 70; i++) {
      const u = r.next() < 0.5 ? Math.pow(r.next(), 3) : 1 - Math.pow(r.next(), 3);
      const e = r.int(0, 5), y = 256 - (e / 6 + 1 / 12) * 256 + r.range(-10, 10);
      const x = u * 1024, w = r.range(1.5, 6) * (0.5 + Math.abs(u - 0.5));
      c.save(); c.translate(x, y); c.rotate(r.range(-0.4, 0.4));
      c.fillStyle = 'rgba(235,215,205,0.3)';
      c.beginPath(); c.ellipse(0, 0, w * 1.6 + 1, w * 0.6 + 1, 0, 0, TAU); c.fill();
      c.fillStyle = r.next() < 0.75 ? '#4c4e50' : '#5c3c2a';
      c.beginPath(); c.moveTo(-w * 1.6, 0);
      for (let a = 0; a <= TAU; a += 0.7) c.lineTo(Math.cos(a) * w * 1.6 * r.range(0.6, 1), Math.sin(a) * w * 0.6 * r.range(0.6, 1));
      c.fill(); c.restore();
    }
    // arris wear: the six hex edges rub through first (u-lines at v = k/6 + 1/12)
    for (let e = 0; e < 6; e++) {
      const y = 256 - (e / 6 + 1 / 12) * 256;
      for (let x = 0; x < 1024; x += r.range(3, 12)) { const w = r.range(2, 10); if (r.next() < 0.45) rect(c, x, y - r.range(0.5, 2), w, r.range(1, 3), r.next() < 0.6 ? '#505254' : '#8a8c8e'); }
    }
    // dipped paint edge fade at both ends
    for (const [x0, dir] of [[0, 1], [1024, -1]]) {
      const g = lgrad(c, x0, 0, x0 + dir * 26, 0, [[0, 'rgba(70,70,72,1)'], [0.5, 'rgba(110,40,30,0.7)'], [1, 'rgba(179,42,31,0)']]);
      c.fillStyle = g; c.fillRect(Math.min(x0, x0 + dir * 26), 0, 26, 256);
    }
    wear(c, 0, 0, 1024, 256, 6, 2.2, { edge: false, lightRatio: 0.5, dirt: 1.5 });
  }, { plain: '#b32a1f' });
  const paint = mat({ name: 'crowbar_paint', map: A, rough: 0.5, metal: 0.05, det: 'powder', ns: 0.7 });
  const steel = mat({ name: 'item_forged', color: 0x7c8084, metal: 1, rough: 0.44, det: 'cast', ns: 0.9 });
  const k = new Kit();
  const R = 0.0095; // apothem (19 mm across flats)
  // path in XZ: chisel tip (+Z) -> straight shaft -> gooseneck hook toward +X -> claw pointing back toward +Z
  const pts = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push([0.012 * Math.pow(1 - t, 2), 0, 0.31 - t * 0.045]); }
  pts.push([0, 0, -0.19]);
  const hc = [0.047, -0.19], hr = 0.047;
  for (let i = 1; i <= 32; i++) { const a = PI - (i / 32) * PI * 1.03; pts.push([hc[0] + Math.cos(a) * hr, 0, hc[1] - Math.sin(a) * hr]); }
  pts.push([0.0965, 0, -0.17], [0.0985, 0, -0.152]);
  const path = new (class extends THREE.Curve {
    constructor() { super(); this.c = new THREE.CatmullRomCurve3(pts.map((p) => V3(...p)), false, 'centripetal'); this.arcLengthDivisions = 600; }
    getPoint(t, out = V3()) { return this.c.getPoint(t, out); }
  })();
  const L = path.getLength();
  const tAt = (s) => s / L;
  const prof = (t) => {
    const s = t * L, e = L - s;
    let rx = R, ry = R;
    if (s < 0.05) { const f = Math.pow(1 - s / 0.05, 1.3); rx = R * (1 - 0.7 * f); ry = R * (1 + 0.28 * f); }
    if (e < 0.056) { const f = Math.pow(1 - e / 0.056, 1.15); rx = R * (1 - 0.5 * f); ry = R * (1 + 0.36 * f); }
    return [rx, ry];
  };
  const sw = (t0, t1, seg, m, o = {}) => k.add(sweepGeo(path, prof, { t0, t1, seg, sides: 36, up: [0, 1, 0], shape: (a) => roundHex(a), cap0: o.cap0 ?? false, cap1: o.cap1 ?? false, dm: m.userData.dm, warp: o.warp }), m, o.add || {});
  const tA = tAt(0.062), tS = tAt(0.045 + 0.455 - 0.01), tB = tAt(L - 0.058);
  const pr = A.R(0, 0, 1024, 256);
  const pmap = (u0, u1) => ({ uvFn: (p, n, u, v) => { const U = u0 + u * (u1 - u0); return [pr[0] + U * (pr[2] - pr[0]), pr[1] + v * (pr[3] - pr[1])]; } });
  // bare ground chisel end (brighter toward the tip)
  sw(0, tA, 22, steel, { cap0: true, add: { col: (p) => (p.z > 0.27 ? 0xd8dadc : 0xa8acb0) } });
  sw(tA, tS, 4, paint, { add: pmap(0, (tS - tA) / (tB - tA)) });
  sw(tS, tB, 34, paint, { add: pmap((tS - tA) / (tB - tA), 1) });
  // ground claw end: flattened, flared wedge that forks into two tines (fishtail nail claw)
  const sSplit = L - 0.02, tSp = tAt(sSplit);
  sw(tB, tSp - 0.0015, 14, steel, { cap1: true, add: { col: 0xff3030 } });
  for (const sb of [-1, 1]) {
    k.add(sweepGeo(path, (t) => {
      const f = clamp((t * L - sSplit) / (L - sSplit), 0, 1);
      const [rx, H] = prof(t);
      const g = 0.0027 * Math.pow(f, 0.85);
      const h = ((H * 1.02 - g) / 2) * (1 - 0.18 * f * f);
      return [rx * 1.08 * (1 - 0.35 * f * f), h];
    }, {
      t0: tSp - 0.006, t1: 1, seg: 12, sides: 24, up: [0, 1, 0], cap0: false, cap1: true, dm: steel.userData.dm,
      shape: (a) => { const c = Math.cos(a), s2 = Math.sin(a); return [Math.sign(c) * Math.pow(Math.abs(c), 0.6), Math.sign(s2) * Math.pow(Math.abs(s2), 0.6)]; },
      off: (t) => {
        const f = clamp((t * L - sSplit) / (L - sSplit), 0, 1);
        const [, H] = prof(t);
        const g = 0.0027 * Math.pow(f, 0.85);
        const h = ((H * 1.02 - g) / 2) * (1 - 0.18 * f * f);
        return [0, sb * (g + h)];
      },
    }), steel, { col: (p) => (sb > 0 ? 0x30ff30 : 0x3030ff) });
  }
  // colliders
  k.colBox([0.022, 0.022, 0.5], [0.002, 0, 0.06]);
  k.colBox([0.118, 0.028, 0.07], [0.048, 0, -0.205]);
  return { kit: k, meta: { mass: 1.8, material: 'metal', hold: { grip: [0, 0, 0.2], rot: [0.42, 0.25, -1.2], off: [0, -0.02, 0] } } };
});
