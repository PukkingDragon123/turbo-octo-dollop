// R.O.O.M. items — medical: gauze roll, first-aid case, Rx vial, blister pack, field splint.
import * as THREE from 'three';
import { Kit, def, PI, TAU, V3, clamp, lerp, latheGeo, sheetGeo, extrudeGeo, rrectShape } from './core.js';
import { mat, clear, tinted, S } from './mats.js';
import { RNG } from '../../core/rng.js';
import {
  atlas, txt, rect, rrect, circle, line, noise, mottle, wear, edgeGrime, barcode, roomIcon, lgrad, warnTri,
  MONO, HAND, INK,
} from './paint.js';

const RED = '#c8241c';
function cross(c, cx, cy, s, col = RED) { const t = s * 0.34; rect(c, cx - t / 2, cy - s / 2, t, s, col); rect(c, cx - s / 2, cy - t / 2, s, t, col); }

// ============================================================================ bandage
// Conforming gauze roll: open crinkle-weave cotton, spiral-wound layers visible on the faces, printed
// paper sterile band with a glued overlap, loose end unrolled across the floor with a frayed edge.
def('bandage', () => {
  const A = atlas('bandage', 512, 512, (c) => {
    // gauze (0,0,400,300)
    rect(c, 0, 0, 400, 300, '#f2efe6');
    c.strokeStyle = 'rgba(150,140,118,0.28)'; c.lineWidth = 1.2;
    for (let i = 0; i < 400; i += 4) { c.beginPath(); c.moveTo(i, 0); for (let y = 0; y <= 300; y += 20) c.lineTo(i + Math.sin(y * 0.11 + i) * 0.8, y); c.stroke(); }
    for (let j = 0; j < 300; j += 4) { c.beginPath(); c.moveTo(0, j); for (let x = 0; x <= 400; x += 20) c.lineTo(x, j + Math.sin(x * 0.13 + j) * 0.8); c.stroke(); }
    mottle(c, 0, 0, 400, 300, 10, 3, 0.7);
    wear(c, 0, 0, 400, 300, 7, 0.8, { edge: false, lightRatio: 0.1, dirt: 0.8 });
    // loose end strip (0,300,400,100) with a frayed edge at the right
    rect(c, 0, 300, 400, 100, '#f2efe6');
    c.strokeStyle = 'rgba(150,140,118,0.3)';
    for (let i = 0; i < 400; i += 4) { c.beginPath(); c.moveTo(i, 300); c.lineTo(i + 1, 400); c.stroke(); }
    for (let j = 300; j < 400; j += 4) { c.beginPath(); c.moveTo(0, j); c.lineTo(400, j + 1); c.stroke(); }
    const g = lgrad(c, 0, 300, 400, 300, [[0, 'rgba(120,100,70,0.18)'], [0.4, 'rgba(120,100,70,0)']]); c.fillStyle = g; c.fillRect(0, 300, 400, 100);
    // spiral face (404,300,104,104)
    rect(c, 404, 300, 104, 104, '#ece8dc');
    for (let k2 = 0; k2 < 46; k2++) { c.strokeStyle = `rgba(140,128,105,${0.18 + (k2 % 3) * 0.08})`; c.lineWidth = 0.9; c.beginPath(); c.arc(456, 352, 4 + k2 * 1.05, 0, TAU); c.stroke(); }
    circle(c, 456, 352, 4.5, '#6a6250');
    noise(c, 404, 300, 104, 104, 14, 4);
    // sterile paper band (404,0,104,296): x = across the band (roll axis), y = around
    rect(c, 404, 0, 104, 296, '#fbfaf6');
    noise(c, 404, 0, 104, 296, 6, 5);
    rect(c, 404, 0, 6, 296, RED); rect(c, 502, 0, 6, 296, RED);
    for (let i = 0; i < 3; i++) {
      const y0 = i * 98.7;
      c.save(); c.translate(456, y0 + 49); c.rotate(-PI / 2);
      cross(c, -34, 0, 16);
      txt(c, 'GAUZE', 8, -8, { size: 17, color: INK, weight: '900' });
      txt(c, 'STERILE 5cm × 4m', 8, 8, { size: 8, color: INK, fam: MONO, weight: 'bold' });
      txt(c, 'R.O.O.M. MEDICAL', 0, 22, { size: 8, color: RED, fam: MONO, weight: 'bold' });
      c.restore();
    }
    rect(c, 404, 288, 104, 8, 'rgba(160,150,120,0.25)');
    // cut-end fray mask strip (0,410,256,40)
    rect(c, 0, 410, 256, 40, '#f2efe6');
    for (let x = 0; x < 256; x += 3) rect(c, x, 410, 1, 40, 'rgba(150,140,118,0.3)');
  }, { plain: '#f2efe6' });
  const cloth = mat({ name: 'bandage_gauze', map: A, rough: 0.95, det: 'gauze', ns: 1.1, sheen: 0.4, sheenColor: 0xffffff, sheenRough: 0.7 });
  const paper = mat({ name: 'bandage_band', map: A, rough: 0.7, det: 'paper', ns: 0.3 });
  const k = new Kit();
  const R = 0.031, Wd = 0.052;
  k.push({ r: [0, 0, PI / 2] }); // roll axis along X (local Y)
  // roll body: slightly barrel-shaped, soft edges, gauze texture wraps
  const prof = [[R * 0.985, -Wd / 2, 0], [R, -Wd / 2 + 0.003, 0.002], [R, Wd / 2 - 0.003, 0.002], [R * 0.985, Wd / 2, 0]];
  k.lathe(prof, cloth, { seg: 48, vFromY: [-Wd / 2, Wd / 2], uv: A.R(0, 0, 400, 300), rmod: (phi, y, r) => r * (1 + 0.006 * Math.sin(phi * 3 + 1) + 0.004 * Math.sin(phi * 7)) });
  // faces: spiral layers with tiny steps
  for (const sy of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= 10; i++) { const r = R * 0.985 - (i / 10) * (R * 0.985 - 0.005); pts.push([r, sy * (Wd / 2 - (i % 2) * 0.0004 + 0.0003 * Math.sin(i))]); }
    pts.push([0.0045, sy * (Wd / 2 - 0.002)], [0.002, sy * (Wd / 2 - 0.003)]);
    const prof2 = sy > 0 ? pts : pts.slice().reverse();
    k.lathe(prof2.map(([r, y]) => [r, y]), cloth, { seg: 48, raw: true, planar: { rect: A.R(404, 300, 104, 104), R: R }, d: 'box' });
  }
  // sterile band
  k.lathe([[R + 0.0006, -0.017], [R + 0.0006, 0.017]], paper, { seg: 56, vFromY: [-0.017, 0.017], uv: A.R(404, 0, 104, 296, 3), rmod: (phi, y, r) => r + (phi > TAU * 0.97 ? 0.0003 : 0) });
  k.colCyl(R, Wd);
  k.pop();
  // loose end: leaves the roll at the bottom and lies on the floor toward +Z, frayed tip
  k.add(sheetGeo(5, 12, (u, v) => {
    const z = v * 0.05;
    const lift = Math.max(0, 0.0045 - z * 0.12) + Math.sin(v * 9 + u * 2) * 0.0006 + v * v * 0.0012;
    const fray = v > 0.92 ? (Math.sin(u * 53) * 0.5 + 0.5) * 0.004 : 0;
    return [(0.5 - u) * Wd * 0.97, -R + 0.0006 + lift, z - fray];
  }), cloth, { uv: A.R(0, 300, 400, 100, 1), col: 0xe6e0d2 });
  k.add(sheetGeo(5, 12, (u, v) => {
    const z = v * 0.05;
    const lift = Math.max(0, 0.0045 - z * 0.12) + Math.sin(v * 9 + u * 2) * 0.0006 + v * v * 0.0012;
    const fray = v > 0.92 ? (Math.sin(u * 53) * 0.5 + 0.5) * 0.004 : 0;
    return [(u - 0.5) * Wd * 0.97, -R + 0.0002 + lift, z - fray];
  }), cloth, { uv: A.R(0, 300, 400, 100, 1), col: 0xd8d2c4 });
  return { kit: k, meta: { mass: 0.05, material: 'soft', hold: { grip: [0, 0, 0], rot: [0.35, 0.35, 0.1], off: [0, 0.03, 0] }, restitution: 0.05 } };
});

// ============================================================================ medkit
// 90s ABS first-aid case: deep base + lid clamshell with a parting lip, moulded raised cross and a recessed
// label panel on the lid, folding carry handle, two red snap latches, hinge knuckles with a steel pin,
// grip ribs on the ends, rubber feet. Yellowed, scuffed plastic.
def('medkit', () => {
  const A = atlas('medkit', 1024, 512, (c) => {
    // lid top (0,0,640,440): planar, +X right, -Z up
    rect(c, 0, 0, 640, 440, '#e2ddd0');
    mottle(c, 0, 0, 640, 440, 10, 3, 0.9);
    noise(c, 0, 0, 640, 440, 5, 3);
    // recessed label sticker (left half)
    rrect(c, 40, 120, 210, 200, 10, '#f6f3ea');
    roomIcon(c, 145, 170, 46, INK, null, 0.1);
    txt(c, 'R.O.O.M.', 145, 218, { size: 30, color: INK, weight: '900' });
    txt(c, 'MEDICAL', 145, 244, { size: 15, color: RED, fam: MONO, weight: 'bold', ls: 3 });
    txt(c, 'KIT No. 0451', 145, 270, { size: 11, color: '#555', fam: MONO, weight: 'bold' });
    txt(c, 'INSPECTED ✓ 03/97', 145, 290, { size: 10, color: '#1d2b8a', fam: HAND, weight: 'bold' });
    edgeGrime(c, 40, 120, 210, 200, 0.8);
    // cross area (right side) printed red (the raised cross geometry sits here)
    cross(c, 470, 220, 250);
    rect(c, 470 - 42, 220 - 125, 84, 250, 'rgba(255,255,255,0.0)');
    txt(c, 'FIRST AID', 470, 398, { size: 34, color: RED, weight: '900', ls: 5 });
    txt(c, 'EMERGENCY USE ONLY • REPLENISH AFTER USE', 320, 30, { size: 13, color: '#555', fam: MONO, weight: 'bold' });
    wear(c, 0, 0, 640, 440, 51, 2.4, { edgeK: 1.4, dirt: 1.3 });
    // sides (0,444,1024,64): front strip (base), x = along X
    rect(c, 0, 444, 1024, 64, '#e2ddd0');
    mottle(c, 0, 444, 1024, 64, 10, 5, 0.9);
    rect(c, 0, 444, 1024, 6, RED);
    txt(c, 'R.O.O.M. MEDICAL • FIRST AID • EMERGENCY USE ONLY •', 512, 480, { size: 15, color: RED, fam: MONO, weight: 'bold', maxW: 760 });
    wear(c, 0, 444, 1024, 64, 52, 2.2, { dirt: 1.5 });
    // end panel (650,0,300,120)
    rect(c, 650, 0, 300, 120, '#e2ddd0');
    mottle(c, 650, 0, 300, 120, 10, 6, 0.9);
    cross(c, 700, 52, 40);
    txt(c, 'FIRST AID', 820, 44, { size: 26, color: RED, weight: '900' });
    txt(c, 'R.O.O.M. MEDICAL', 820, 72, { size: 13, color: '#333', fam: MONO, weight: 'bold' });
    wear(c, 650, 0, 300, 120, 53, 2.2);
    // red plastic swatch (650,130,120,60), grey rubber (780,130,60,60)
    rect(c, 650, 130, 120, 60, '#b8241c'); noise(c, 650, 130, 120, 60, 8, 7);
    rect(c, 780, 130, 60, 60, '#2a2a2c'); noise(c, 780, 130, 60, 60, 12, 8);
  }, { plain: '#e2ddd0' });
  const shell = mat({ name: 'medkit_shell', map: A, rough: 0.4, det: 'stipple', ns: 0.55 });
  const steel = S.steel();
  const k = new Kit();
  const W = 0.27, D = 0.185, Hb = 0.052, Hl = 0.032, cr = 0.022;
  const redUV = A.R(650, 130, 120, 60), rubUV = A.R(780, 130, 60, 60);
  // plan-view rounded rectangle, extruded vertically with generous bevels
  const plan = rrectShape(W - 0.012, D - 0.012, cr);
  const sideUV = (p, n, lid = false) => {
    // planar mapping by dominant normal: top -> lid art, front/back -> strip, ends -> end panel
    const top = A.R(0, 0, 640, 440), strip = A.R(0, 444, 1024, 64), end = A.R(650, 0, 300, 120);
    if (Math.abs(n.y) > 0.7) { const u = p.x / W + 0.5, v = 0.5 - p.z / D; return [top[0] + u * (top[2] - top[0]), top[1] + v * (top[3] - top[1])]; }
    if (lid) { const pl = A.plain; return [(pl[0] + pl[2]) / 2 + p.x * 0.05, (pl[1] + pl[3]) / 2 + p.z * 0.05]; }
    if (Math.abs(n.x) > Math.abs(n.z)) { const u = 0.5 + p.z / D * (n.x > 0 ? -1 : 1), v = clamp(p.y / 0.052, 0, 1); return [end[0] + u * (end[2] - end[0]), end[1] + v * (end[3] - end[1])]; }
    const u = p.x / W + 0.5, v = clamp((p.y - 0.004) / 0.05, 0, 1); return [strip[0] + u * (strip[2] - strip[0]), strip[1] + v * (strip[3] - strip[1])];
  };
  // base
  k.add(extrudeGeo(plan, Hb - 0.012, 0.006, { bevelSegments: 2, curveSegments: 7 }), shell, { r: [PI / 2, 0, 0], p: [0, Hb / 2, 0], uvFn: (p, n) => sideUV(V3(p.x, -p.z + Hb / 2, p.y), V3(n.x, -n.z, n.y)) });
  // parting lip (darker groove band)
  k.rbox(W - 0.006, 0.0045, D - 0.006, 0.0022, shell, { p: [0, Hb, 0], rs: 2, col: 0x8a8678 });
  // lid with a raised rim
  k.add(extrudeGeo(plan, Hl - 0.012, 0.006, { bevelSegments: 2, curveSegments: 7 }), shell, { r: [PI / 2, 0, 0], p: [0, Hb + 0.0022 + Hl / 2, 0], uvFn: (p, n) => sideUV(V3(p.x, -p.z + Hb + Hl / 2, p.y), V3(n.x, -n.z, n.y), Math.abs(n.z) < 0.7) });
  const yTop = Hb + 0.0022 + Hl;
  // raised moulded cross (red) on the lid
  const cs = new THREE.Shape();
  const a = 0.0205, b = 0.06;
  cs.moveTo(-a, -b); cs.lineTo(a, -b); cs.lineTo(a, -a); cs.lineTo(b, -a); cs.lineTo(b, a); cs.lineTo(a, a); cs.lineTo(a, b); cs.lineTo(-a, b); cs.lineTo(-a, a); cs.lineTo(-b, a); cs.lineTo(-b, -a); cs.lineTo(-a, -a); cs.closePath();
  const redC = [(redUV[0] + redUV[2]) / 2, (redUV[1] + redUV[3]) / 2];
  k.add(extrudeGeo(cs, 0.0018, 0.0009, { bevelSegments: 1 }), shell, { r: [-PI / 2, 0, 0], p: [0.0629, yTop + 0.0004, 0], uvFn: () => redC, col: 0xffffff });
  // hinge knuckles on the back + steel pin
  for (let i = 0; i < 5; i++) {
    const x = -0.09 + i * 0.045;
    k.cyl(0.0058, 0.026, shell, { p: [x, Hb + 0.0015, -D / 2 + 0.0016], r: [0, 0, PI / 2], seg: 12, col: i % 2 ? 0xd8d3c6 : 0xcac5b8, bevel: 0.0012 });
  }
  k.cyl(0.0016, 0.21, steel, { p: [0, Hb + 0.0015, -D / 2 + 0.0016], r: [0, 0, PI / 2], seg: 8, bevel: 0.0004 });
  // latches (red) with a hooked lip
  for (const sx of [-1, 1]) {
    k.push({ p: [sx * 0.092, Hb + 0.002, D / 2 + 0.0015] });
    k.rbox(0.028, 0.036, 0.0075, 0.003, shell, { rs: 1, uv: redUV, col: 0xffffff });
    k.rbox(0.022, 0.006, 0.006, 0.002, shell, { p: [0, 0.019, -0.002], rs: 1, uv: redUV, col: 0xe8e8e8 });
    k.cyl(0.0022, 0.03, steel, { p: [0, -0.012, -0.002], r: [0, 0, PI / 2], seg: 8, bevel: 0.0004 });
    k.pop();
  }
  // folding carry handle (folded flat against the front of the base)
  for (const sx of [-1, 1]) k.rbox(0.016, 0.022, 0.012, 0.004, shell, { p: [sx * 0.05, Hb - 0.008, D / 2 + 0.001], rs: 1, col: 0x6a6a6c, uv: rubUV });
  k.tube([[-0.05, Hb - 0.006, D / 2 + 0.006], [-0.046, Hb - 0.022, D / 2 + 0.012], [-0.025, Hb - 0.03, D / 2 + 0.014], [0.025, Hb - 0.03, D / 2 + 0.014], [0.046, Hb - 0.022, D / 2 + 0.012], [0.05, Hb - 0.006, D / 2 + 0.006]], (t) => [0.0062, 0.0048], shell, { tseg: 24, rseg: 8, uv: rubUV, col: 0x8a8a8c, up: [0, 0, 1] });
  // grip ribs on both ends
  for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) k.box(0.003, 0.03, 0.006, shell, { p: [sx * (W / 2 - 0.0008), Hb * 0.55, -0.03 + i * 0.015], col: 0xcfcabc });
  // rubber feet
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl(0.0085, 0.003, shell, { p: [sx * 0.105, 0.0005, sz * 0.065], seg: 10, uv: rubUV, bevel: 0.001 });
  k.colBox([W, yTop + 0.003, D], [0, (yTop + 0.002) / 2 - 0.0005, 0]); // feet stand 1 mm proud
  return { kit: k, meta: { mass: 1.2, material: 'plastic', hold: { grip: [0, Hb - 0.025, D / 2 + 0.014], rot: [1.2, 0, 0.0], off: [-0.03, -0.02, 0.02] } } };
});

// ============================================================================ antibiotics
// Amber pharmacy vial with a child-resistant push-and-turn cap, printed Rx label wrapped 3/4 of the way
// round (window shows the capsules), two-tone capsules piled inside.
def('antibiotics', () => {
  const A = atlas('antibiotics', 512, 512, (c) => {
    // Rx label (0,0,512,180): spans 300 degrees
    rect(c, 0, 0, 512, 180, '#fbfaf4');
    noise(c, 0, 0, 512, 180, 5, 2);
    rect(c, 0, 0, 512, 30, '#2c5d8a');
    txt(c, 'R.O.O.M. PHARMACY • SUBLEVEL 2 • EXT 0000', 256, 15, { size: 12, color: '#fff', fam: MONO, weight: 'bold', maxW: 480 });
    txt(c, 'AMOXI-ROOM', 256, 54, { size: 28, color: '#111', weight: '900', maxW: 200 });
    txt(c, '500 mg CAPSULES', 256, 76, { size: 13, color: '#2c5d8a', weight: '900', maxW: 200 });
    txt(c, 'Rx #0451  QTY 30  REFILLS 0', 256, 96, { size: 11, color: '#333', fam: MONO, weight: 'bold', maxW: 200 });
    txt(c, 'TAKE 1 CAPSULE 3 TIMES DAILY', 256, 116, { size: 10, color: '#111', fam: MONO, weight: 'bold', maxW: 200 });
    txt(c, 'AS DIRECTED BY YOUR SUPERVISOR', 256, 130, { size: 10, color: '#111', fam: MONO, weight: 'bold', maxW: 200 });
    txt(c, 'DR. ████████', 256, 152, { size: 11, color: '#555', fam: MONO });
    txt(c, 'EMPLOYEE: CLONE #0451', 256, 168, { size: 9, color: '#555', fam: MONO });
    barcode(c, 30, 46, 90, 54, 8, false);
    txt(c, 'KEEP OUT OF', 75, 118, { size: 9, color: '#333', fam: MONO, weight: 'bold' });
    txt(c, 'REACH OF', 75, 131, { size: 9, color: '#333', fam: MONO, weight: 'bold' });
    txt(c, 'ENTITIES', 75, 144, { size: 9, color: '#333', fam: MONO, weight: 'bold' });
    rect(c, 390, 40, 100, 130, '#f6d21c');
    txt(c, 'MAY CAUSE', 440, 60, { size: 10, color: '#111', weight: '900' });
    txt(c, 'DROWSINESS', 440, 74, { size: 10, color: '#111', weight: '900' });
    rect(c, 396, 84, 88, 2, '#111');
    txt(c, 'DO NOT OPERATE', 440, 100, { size: 9, color: '#111', fam: MONO, weight: 'bold' });
    txt(c, 'HEAVY MACHINERY', 440, 112, { size: 9, color: '#111', fam: MONO, weight: 'bold' });
    txt(c, 'OR REALITY', 440, 124, { size: 9, color: '#111', fam: MONO, weight: 'bold' });
    warnTri(c, 440, 150, 22, '#f6d21c', '#111');
    wear(c, 0, 0, 512, 180, 61, 1.3, { dirt: 1.2 });
    // cap ribs (0,190,512,60) + cap top (0,256,140,140)
    rect(c, 0, 190, 512, 60, '#f4f2ec');
    for (let x = 0; x < 512; x += 5) rect(c, x, 190, 2, 50, 'rgba(0,0,0,0.12)');
    rect(c, 0, 240, 512, 10, '#e2dfd6');
    rect(c, 0, 256, 140, 140, '#f4f2ec');
    c.strokeStyle = '#a0a09a'; c.lineWidth = 2; c.beginPath(); c.arc(70, 326, 60, 0, TAU); c.stroke();
    txt(c, 'PUSH DOWN', 70, 310, { size: 12, color: '#333', fam: MONO, weight: 'bold' });
    txt(c, '& TURN', 70, 326, { size: 12, color: '#333', fam: MONO, weight: 'bold' });
    c.strokeStyle = '#333'; c.lineWidth = 2.5; c.beginPath(); c.arc(70, 326, 44, 0.2, 1.4); c.stroke();
    c.beginPath(); c.moveTo(70 + Math.cos(1.4) * 44 - 6, 326 + Math.sin(1.4) * 44 - 3); c.lineTo(70 + Math.cos(1.4) * 44, 326 + Math.sin(1.4) * 44); c.lineTo(70 + Math.cos(1.4) * 44 + 2, 326 + Math.sin(1.4) * 44 - 7); c.stroke();
    // capsule colours (150,256,60,60) red | (214,256,60,60) cream
    rect(c, 150, 256, 60, 60, '#c8302a'); rect(c, 214, 256, 60, 60, '#f2ead6');
  }, { plain: '#f4f2ec' });
  const p = mat({ name: 'rx_print', map: A, rough: 0.45, det: 'stipple', ns: 0.3 });
  const amber = tinted({ color: 0xd8701a, opacity: 0.6, rough: 0.1 });
  const k = new Kit();
  const R = 0.0178;
  // vial: inner and outer walls (amber), thick rounded base, lip
  k.lathe([[0, 0.0003], [0.012, 0, 0.003], [R, 0.0048, 0.004], [R, 0.0565], [R - 0.0004, 0.0575, 0.0006], [0.0168, 0.0585, 's'], [0.0168, 0.0645, 0.0005], [0.0158, 0.0648, 0.0004], [0.0158, 0.003], [0, 0.0028]], amber, { seg: 32, rseg: 0.0014 });
  // capsules piled inside
  const r = new RNG(7);
  const capG = (len, rad) => {
    const pts = [];
    for (let i = 0; i <= 3; i++) { const a = -PI / 2 + (i / 3) * (PI / 2); pts.push([i ? Math.cos(a) * rad : 0, Math.sin(a) * rad - len / 2]); }
    for (let i = 0; i <= 3; i++) { const a = (i / 3) * (PI / 2); pts.push([i < 3 ? Math.cos(a) * rad : 0, Math.sin(a) * rad + len / 2]); }
    return latheGeo(pts.map(([x, y]) => [x, y, false]), { seg: 9 });
  };
  const capPos = [];
  for (let i = 0; i < 13; i++) {
    const layer = Math.floor(i / 6), ang = (i % 6) / 6 * TAU + layer * 0.5 + r.range(-0.2, 0.2);
    const rr = layer === 2 ? 0.002 : 0.0095;
    capPos.push([Math.cos(ang) * rr, 0.0062 + layer * 0.0062 + r.range(0, 0.0012), Math.sin(ang) * rr, r.range(0, PI), r.range(-0.5, 0.5)]);
  }
  for (const [x, y, z, ry, rz] of capPos) {
    const cr1 = A.R(150, 256, 60, 60), cr2 = A.R(214, 256, 60, 60);
    k.add(capG(0.0105, 0.0029), p, { p: [x, y, z], r: [PI / 2, ry, rz], uvFn: (q) => (q.y > 0 ? [(cr1[0] + cr1[2]) / 2, (cr1[1] + cr1[3]) / 2] : [(cr2[0] + cr2[2]) / 2, (cr2[1] + cr2[3]) / 2]), col: 0xffffff });
  }
  // label: 300 degrees, leaving a window toward -Z
  k.lathe([[R + 0.0004, 0.012], [R + 0.0004, 0.05]], p, { seg: 36, phi0: PI + 0.52, phiLen: TAU - 1.04, vFromY: [0.012, 0.05], uv: A.R(0, 0, 512, 180) });
  // child-resistant cap: outer ribbed skirt, rolled top edge, top disc
  k.lathe([[0.0186, 0.0578], [0.0196, 0.0582, 0.0005], [0.0196, 0.0738, 0.001], [0.0186, 0.0752, 0.0012], [0.0174, 0.0754]], p, {
    seg: 40, vFromY: [0.0578, 0.0754], uv: A.R(0, 190, 512, 60),
  });
  k.lathe([[0.0174, 0.0754], [0.008, 0.0758], [0, 0.0759]], p, { seg: 32, planar: { rect: A.R(0, 256, 140, 140), R: 0.0176 } });
  k.colCyl(0.0196, 0.0759, [0, 0.03795, 0]);
  return { kit: k, meta: { mass: 0.06, material: 'plastic', hold: { grip: [0, 0.035, 0], rot: [0.12, -0.2, 0.05], off: [0, 0.02, 0] } } };
});

// ============================================================================ painkillers (blister pack)
// 10-cell blister card: printed foil seen through glossy PVC, thermoformed domes holding scored tablets,
// perforations, two cells popped (crushed dome, torn foil with a curled flap on the back).
def('painkillers', () => {
  const W = 0.1, D = 0.056;
  const cell = (i, j) => [(0.14 + i * 0.18 - 0.5) * W, (0.42 + j * 0.36 - 0.5) * D];
  const popped = (i, j) => (i === 4 && j === 0) || (i === 3 && j === 1);
  const A = atlas('painkillers', 512, 512, (c) => {
    // top print (0,0,512,288) seen through the PVC: canvas x -> +X, canvas y -> +Z
    rect(c, 0, 0, 512, 288, '#d6dce4');
    for (let x = 0; x < 512; x += 3) rect(c, x, 0, 1, 288, 'rgba(255,255,255,0.12)');
    noise(c, 0, 0, 512, 288, 8, 5);
    rect(c, 0, 0, 512, 46, '#1f5fa8');
    txt(c, 'PAIN-B-GONE', 150, 24, { size: 30, color: '#fff', weight: '900', italic: true, maxW: 270, ls: -1 });
    txt(c, 'IBUPROFEN 200 mg', 400, 24, { size: 15, color: '#cfe2ff', fam: MONO, weight: 'bold', maxW: 180 });
    for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) {
      const [cx, cz] = cell(i, j);
      const x = (cx / W + 0.5) * 512, y = (cz / D + 0.5) * 288;
      if (popped(i, j)) {
        // empty cavity: torn foil edge, dark hole
        c.fillStyle = '#8a9098'; c.beginPath();
        for (let a = 0; a < TAU; a += 0.35) c.lineTo(x + Math.cos(a) * (31 + ((a * 7) % 9)), y + Math.sin(a) * (31 + ((a * 5) % 8)));
        c.fill();
        circle(c, x, y, 22, '#2c3036');
        continue;
      }
      circle(c, x, y, 36, null, 'rgba(31,95,168,0.45)', 2);
      txt(c, ['MON', 'TUE', 'WED', 'THU', 'FRI'][i], x, y + (j ? -46 : 46), { size: 11, color: '#1f5fa8', fam: MONO, weight: 'bold' });
    }
    // perforations
    c.strokeStyle = 'rgba(40,60,90,0.45)'; c.setLineDash([4, 3]); c.lineWidth = 1.2;
    for (let i = 1; i < 5; i++) { const x = (cell(i, 0)[0] / W + 0.5) * 512 - 46; line(c, x, 50, x, 288, 'rgba(40,60,90,0.45)', 1.2); }
    line(c, 0, 168, 512, 168, 'rgba(40,60,90,0.45)', 1.2);
    c.setLineDash([]);
    txt(c, 'R.O.O.M. PHARMA — for pain, existential or otherwise', 256, 278, { size: 11, color: '#1f5fa8', fam: MONO, weight: 'bold', maxW: 490 });
    // foil back (0,292,512,150)
    rect(c, 0, 292, 512, 150, '#c3c8cf');
    for (let y = 300; y < 440; y += 20) for (let x = ((y / 20) % 2) * 60; x < 512; x += 120) txt(c, 'PAIN-B-GONE', x, y, { size: 11, color: 'rgba(31,95,168,0.6)', fam: MONO, align: 'left', weight: 'bold' });
    txt(c, 'LOT 0451  EXP ∞', 420, 430, { size: 10, color: '#333', fam: MONO, weight: 'bold' });
    noise(c, 0, 292, 512, 150, 14, 2);
    // tablet face (0,446,60,60): white, embossed score line
    rect(c, 0, 446, 60, 60, '#f6f2ea');
    rect(c, 4, 474, 52, 3, 'rgba(120,110,100,0.35)');
    // torn foil (64,446,60,60)
    rect(c, 64, 446, 60, 60, '#c3c8cf'); noise(c, 64, 446, 60, 60, 20, 3);
  }, { plain: '#c3c8cf' });
  const card = mat({ name: 'blister_card', map: A, rough: 0.22, metal: 0.45, det: 'gloss', ns: 0.2 });
  const pvc = clear({ name: 'blister_pvc', rough: 0.04, env: 1.7 });
  const k = new Kit();
  const t = 0.0011;
  const top = A.R(0, 0, 512, 288), back = A.R(0, 292, 512, 150);
  k.add(extrudeGeo(rrectShape(W, D, 0.004), t, 0.0002, { bevelSegments: 1, curveSegments: 4 }), card, {
    r: [-PI / 2, 0, 0],
    uvFn: (p, n) => {
      const u = p.x / W + 0.5, v = -p.y / D + 0.5; // shape y -> -Z
      if (n.z > 0.5) return [top[0] + u * (top[2] - top[0]), top[1] + (1 - v) * (top[3] - top[1])];
      if (n.z < -0.5) return [back[0] + (1 - u) * (back[2] - back[0]), back[1] + (1 - v) * (back[3] - back[1])];
      return [(A.plain[0] + A.plain[2]) / 2, (A.plain[1] + A.plain[3]) / 2];
    },
  });
  for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) {
    const [x, z] = cell(i, j);
    const pop = popped(i, j);
    // thermoformed dome with a flat flange
    k.lathe([[0.0082, 0], [0.0074, 0.0003, 0.0006], [0.0068, 0.0028, 0.0018], [0.0042, 0.0046, 0.002], [0, 0.0049]], pvc, { seg: 14, rseg: 0.0012, p: [x, t / 2 + 0.0002, z], s: [1, pop ? 0.22 : 1, 1], ymod: pop ? (phi, y) => y * (1 + 0.6 * Math.sin(phi * 3)) : undefined });
    if (!pop) k.lathe([[0.0047, -0.0014], [0.0049, -0.0004, 0.0002], [0.0049, 0.0004, 0.0002], [0.0042, 0.0013, 0.001], [0, 0.0018]], card, { seg: 10, p: [x, t / 2 + 0.0021, z], planar: { rect: A.R(0, 446, 60, 60), R: 0.005 }, col: 0xffffff });
    else {
      // torn foil flap hanging under the card
      k.add(sheetGeo(3, 3, (u, v) => [x - 0.004 + u * 0.008, -t / 2 - 0.00015 - v * v * 0.0006 - u * (1 - u) * 0.0004, z + 0.003 + v * 0.0042 - u * 0.001]), card, { uv: A.R(64, 446, 60, 60), col: 0xdcdcdc });
    }
  }
  k.colBox([W, 0.0064, D], [0, 0.0019, 0]);
  return { kit: k, meta: { mass: 0.02, material: 'plastic', hold: { grip: [0, 0, 0], rot: [1.25, 0.1, 0.12], off: [0, 0.035, 0] } } };
});

// ============================================================================ splint
// Improvised padded field splint: plywood board with eased edges and a stencil, a folded red flannel pad
// on top, bound with two wraps of white cotton strip knotted on top with loose tails.
def('splint', () => {
  const A = atlas('splint', 512, 512, (c) => {
    // flannel plaid (0,0,512,256)
    rect(c, 0, 0, 512, 256, '#c23a2c');
    const band = (vert, pos, w, col) => { c.fillStyle = col; if (vert) c.fillRect(pos, 0, w, 256); else c.fillRect(0, pos, 512, w); };
    for (let i = 0; i < 8; i++) { band(true, i * 64 + 8, 26, 'rgba(25,18,30,0.42)'); band(false, i * 32 + 4, 13, 'rgba(25,18,30,0.42)'); band(true, i * 64 + 46, 3, 'rgba(250,236,200,0.6)'); band(false, i * 32 + 24, 2, 'rgba(250,236,200,0.6)'); }
    for (let i = 0; i < 512; i += 3) line(c, i, 0, i + 256, 256, 'rgba(255,255,255,0.05)', 1);
    noise(c, 0, 0, 512, 256, 20, 8);
    wear(c, 0, 0, 512, 256, 12, 1.2, { lightRatio: 0.2, dirt: 1.2 });
    // cotton strip (0,260,256,64)
    rect(c, 0, 260, 256, 64, '#f2eee4');
    for (let x = 0; x < 256; x += 3) rect(c, x, 260, 1, 64, 'rgba(150,140,118,0.22)');
    for (let y = 260; y < 324; y += 3) rect(c, 0, y, 256, 1, 'rgba(150,140,118,0.16)');
    noise(c, 0, 260, 256, 64, 10, 3);
    const g = lgrad(c, 0, 260, 256, 260, [[0, 'rgba(110,90,50,0.15)'], [0.5, 'rgba(110,90,50,0)'], [1, 'rgba(110,90,50,0.2)']]); c.fillStyle = g; c.fillRect(0, 260, 256, 64);
    // stencil decal for the board (260,260,252,60)
    c.clearRect(260, 260, 252, 60);
    rect(c, 260, 260, 252, 60, 'rgba(0,0,0,0)');
  }, { plain: '#f2eee4' });
  const cloth = mat({ name: 'splint_cloth', map: A, rough: 0.95, det: 'twill', ns: 1.0, sheen: 0.5, sheenColor: 0xffd8c8, sheenRough: 0.6 });
  const wood = mat({ name: 'splint_wood', rough: 0.74, det: 'roughwood', detAlbedo: true, ns: 0.55, color: 0xffffff });
  const k = new Kit();
  const L = 0.32, Wb = 0.072, Tb = 0.0085;
  k.rbox(L, Tb, Wb, 0.0028, wood, { p: [0, Tb / 2, 0], rs: 2 });
  // folded flannel pad on top (puffy, with fold creases and a wavy edge)
  k.add(sheetGeo(28, 8, (u, v) => {
    const x = (u - 0.5) * (L - 0.05), z = (v - 0.5) * (Wb - 0.004);
    const e = Math.pow(Math.max(0, 1 - Math.pow(2 * v - 1, 6)) * Math.max(0, 1 - Math.pow(2 * u - 1, 10)), 0.4);
    const y = Tb + 0.0012 + 0.009 * e * (0.88 + 0.12 * Math.sin(u * 23 + v * 3)) + 0.0012 * Math.sin(u * 9) * e;
    return [x, y, z + Math.sin(u * 17) * 0.0012 * (1 - e)];
  }), cloth, { uv: A.R(0, 0, 512, 256), dm: 0.012 });
  k.add(sheetGeo(8, 4, (u, v) => [(u - 0.5) * (L - 0.05), Tb + 0.0006, (0.5 - v) * (Wb - 0.004)]), cloth, { uv: A.R(0, 0, 128, 64) });
  // cotton ties: flat strips swept around the bundle + knots and tails
  for (const xb of [-0.085, 0.09]) {
    const hw = Wb / 2 + 0.0014, y0 = -0.0012, y1 = Tb + 0.0125, rr = 0.005;
    const loop = [];
    const corners = [[hw - rr, y1 - rr, 0], [-hw + rr, y1 - rr, PI / 2], [-hw + rr, y0 + rr, PI], [hw - rr, y0 + rr, PI * 1.5]];
    for (const [cz, cy, a0] of corners) for (let i = 0; i <= 5; i++) { const a = a0 + (i / 5) * (PI / 2); loop.push(V3(xb + Math.sin(a * 1.5 + xb * 40) * 0.0005, cy + Math.sin(a) * rr, cz + Math.cos(a) * rr)); }
    loop.push(loop[0].clone());
    for (let i = loop.length - 1; i > 0; i--) { // densify the straight runs so the spline cannot bulge below the board
      const a = loop[i - 1], b = loop[i];
      const d = a.distanceTo(b);
      if (d > 0.008) { const n = Math.ceil(d / 0.006); for (let j = n - 1; j >= 1; j--) loop.splice(i, 0, a.clone().lerp(b, j / n)); }
    }
    const path = new THREE.CatmullRomCurve3(loop, false, 'centripetal');
    k.add(sweepFlat(path, 0.0115, 0.0007), cloth, { uv: A.R(0, 260, 256, 64, 1) });
    // knot + two tails on top
    k.lathe([[0.0001, -0.003], [0.0045, -0.0018, 0.002], [0.0042, 0.0016, 0.002], [0, 0.0034]], cloth, { p: [xb, y1 + 0.0022, 0.004], s: [1.2, 0.8, 0.9], seg: 12, uv: A.R(0, 260, 256, 64), rmod: (phi, y, r) => r * (1 + 0.15 * Math.sin(phi * 3 + y * 900)) });
    for (const s2 of [-1, 1]) k.add(sheetGeo(2, 6, (u, v) => [xb + s2 * v * 0.03 + (u - 0.5) * 0.009, y1 + 0.003 - v * v * 0.009 + Math.sin(v * 5) * 0.001, 0.006 + s2 * v * 0.008 + (u - 0.5) * 0.002]), cloth, { uv: A.R(0, 260, 256, 64, 1) });
  }
  k.colBox([L, Tb + 0.0139, Wb + 0.003], [0, (Tb + 0.012) / 2 - 0.00095, 0]); // rests on the two ties (1.9 mm under the board)
  return { kit: k, meta: { mass: 0.25, material: 'wood', hold: { grip: [-0.09, 0, 0], rot: [0.45, 1.35, 0.0], off: [0, 0.01, 0] } } };
});
// flat strip swept along a closed path (normal = outward from the path centroid)
function sweepFlat(path, width, thick) {
  const N = 48, pos = [], uv = [], idx = [];
  const c = V3();
  for (let i = 0; i < N; i++) c.add(path.getPointAt(i / N));
  c.multiplyScalar(1 / N);
  const T = V3(), P = V3(), out = V3(), side = V3();
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    path.getPointAt(t, P); path.getTangentAt(Math.min(0.999, t), T);
    // strip width stays along the board axis (X): the tie wraps in the YZ plane and never twists
    side.set(1, 0, 0).addScaledVector(T, -T.x).normalize();
    out.crossVectors(side, T).normalize();
    if (out.dot(c.clone().sub(P).negate()) < 0) { out.negate(); side.negate(); }
    for (const [sw, so] of [[-1, 1], [1, 1], [1, -1], [-1, -1], [-1, 1]]) {
      pos.push(P.x + side.x * sw * width / 2 + out.x * so * thick, P.y + side.y * sw * width / 2 + out.y * so * thick, P.z + side.z * sw * width / 2 + out.z * so * thick);
      uv.push(t * 4, sw > 0 ? 1 : 0);
    }
  }
  for (let i = 0; i < N; i++) for (let k = 0; k < 4; k++) { const a = i * 5 + k, b = a + 1, c2 = a + 5, d = c2 + 1; idx.push(a, c2, b, b, c2, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
