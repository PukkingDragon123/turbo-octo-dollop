// R.O.O.M. items — crafted camp gear: wheel trolley (flat cart on four casters), distorter (field
// generator with a spinning coil in a glass tube and an antenna) and the field workbench (folding
// trestle bench with a portable terminal). Behaviour lives in game/basecamp.js.
//   trolley      parts.w0..w3 (wheels, spin about local X at their pivots); anchors.deckMax (deck corner, top)
//   distorter    parts.coil (spins about Y), parts.tube (inner glow), parts.lamp (antenna tip), parts.needle (gauge)
//   field_bench  parts.screen (terminal CRT, faces +Z), anchors.top (free spot on the bench top)
import * as THREE from 'three';
import { Kit, def, PI, TAU, HelixCurve } from './core.js';
import { mat, clear, glow, S } from './mats.js';
import { RNG } from '../../core/rng.js';
import { atlas, txt, rect, rrect, noise, wear, edgeGrime, hazardStripes, roomIcon, MONO, INK, ROOM_YELLOW } from './paint.js';

// shared print atlas for the camp gear (stencils, plates, gauge faces)
function campAtlas() {
  return atlas('campgear', 1024, 512, (c) => {
    // (0,0,512,96) cart side stencil: hazard stripes + "R.O.O.M. CART 07"
    hazardStripes(c, 0, 0, 512, 96, 28);
    rect(c, 140, 18, 232, 60, '#151515');
    txt(c, 'CART 07', 256, 49, { size: 40, color: ROOM_YELLOW, fam: MONO, weight: '900' });
    wear(c, 0, 0, 512, 96, 5, 2.2, { dirt: 1.4 });
    // (0,100,512,160) deck stencil (spray paint)
    rect(c, 0, 100, 512, 160, 'rgba(0,0,0,0)');
    c.save(); c.globalAlpha = 0.85;
    txt(c, 'PROPERTY OF R.O.O.M.', 256, 150, { size: 38, color: '#1a1a1a', fam: MONO, weight: '900' });
    txt(c, 'MAX LOAD 300 KG — DO NOT RIDE', 256, 205, { size: 26, color: '#1a1a1a', fam: MONO, weight: '900' });
    c.restore();
    // (520,0,500,250) distorter front plate: black panel, title, logo, warnings
    rrect(c, 520, 0, 500, 250, 10, '#1b1c1e');
    noise(c, 520, 0, 500, 250, 10, 4);
    txt(c, 'FIELD DISTORTER', 770, 34, { size: 40, color: '#e9e2cc', fam: MONO, weight: '900' });
    txt(c, 'MODEL MK-II  ·  R.O.O.M. APPLIED PHYSICS', 770, 70, { size: 18, color: '#b9b29c', fam: MONO, weight: 'bold' });
    roomIcon(c, 568, 200, 54, '#e9e2cc');
    txt(c, 'DO NOT STARE INTO COIL', 800, 186, { size: 22, color: '#ff6a3a', fam: MONO, weight: '900' });
    txt(c, 'KEEP UPRIGHT WHILE ACTIVE', 800, 214, { size: 18, color: '#e9e2cc', fam: MONO, weight: 'bold' });
    wear(c, 520, 0, 500, 250, 9, 1.6, { dirt: 1.2 });
    edgeGrime(c, 520, 0, 500, 250, 1.6);
    // (0,270,240,240) gauge face: cream dial, ticks, red zone
    rect(c, 0, 270, 240, 240, '#e8e0c6');
    c.save(); c.translate(120, 400);
    c.strokeStyle = '#1a1a1a'; c.lineWidth = 3;
    c.beginPath(); c.arc(0, 0, 92, PI * 1.15, PI * 1.85); c.stroke();
    c.strokeStyle = '#c42a1a'; c.lineWidth = 10;
    c.beginPath(); c.arc(0, 0, 86, PI * 1.15, PI * 1.3); c.stroke();
    for (let i = 0; i <= 10; i++) {
      const a = PI * 1.15 + (i / 10) * PI * 0.7;
      c.strokeStyle = '#1a1a1a'; c.lineWidth = i % 5 === 0 ? 4 : 2;
      c.beginPath(); c.moveTo(Math.cos(a) * 92, Math.sin(a) * 92); c.lineTo(Math.cos(a) * (i % 5 === 0 ? 72 : 80), Math.sin(a) * (i % 5 === 0 ? 72 : 80)); c.stroke();
    }
    c.restore();
    txt(c, 'FIELD %', 120, 440, { size: 22, color: '#1a1a1a', fam: MONO, weight: '900' });
    txt(c, '0', 52, 360, { size: 18, color: '#c42a1a', fam: MONO, weight: '900' });
    txt(c, '100', 190, 360, { size: 18, color: '#1a1a1a', fam: MONO, weight: '900' });
    wear(c, 0, 270, 240, 240, 3, 1, { dirt: 1 });
    // (250,270,260,110) bench terminal plate
    rrect(c, 250, 270, 260, 110, 8, '#2e3328');
    txt(c, 'FIELD-TERM 4', 380, 305, { size: 30, color: '#d8d0b0', fam: MONO, weight: '900' });
    txt(c, 'PORTABLE FABRICATION AID', 380, 345, { size: 16, color: '#a8a088', fam: MONO, weight: 'bold' });
    // (520,260,500,70) bench edge hazard tape
    hazardStripes(c, 520, 260, 500, 70, 22);
    noise(c, 520, 260, 500, 70, 10, 5);
    // (520,340,500,170) bench top marks: burns, rings, spray "CAMP"
    c.save(); c.globalAlpha = 0.75;
    txt(c, 'CAMP', 770, 425, { size: 96, color: '#8a1a10', fam: MONO, weight: '900', rot: -0.04 });
    c.restore();
  }, { clear: true });
}

const decalMat = (A) => mat({ name: 'campgear_decal', map: A, rough: 0.7, transparent: true, depthWrite: false, polygonOffset: true, vc: true, alphaTest: 0.03 });

// ============================================================================ trolley
// Flat platform cart: plywood deck on a welded square-tube frame, low angle rails along the sides,
// a tall U push handle with rubber grip at one end, four orange polyurethane casters.
def('trolley', () => {
  const A = campAtlas();
  const k = new Kit();
  const wood = mat({ name: 'pine', rough: 0.86, det: 'roughwood', detAlbedo: true, ns: 0.9 });
  const paint = mat({ name: 'trolley_paint', color: 0xffffff, rough: 0.5, metal: 0.2, det: 'powder', ns: 0.6 });
  const steel = S.steelDark();
  const wheelM = mat({ name: 'trolley_wheel', rough: 0.55, det: 'rubber', ns: 0.6 });
  const decal = decalMat(A);
  const grip = S.rubber();
  const L = 1.2, Wd = 0.7, WR = 0.075, FY = 0.17;           // length (Z), width (X), wheel radius, frame centre height
  const BLUE = 0x2f5fa8;
  // frame: perimeter square tube + three cross members
  for (const sx of [-1, 1]) k.rbox(0.035, 0.035, L, 0.004, paint, { p: [sx * (Wd / 2 - 0.0175), FY, 0], col: BLUE });
  for (const sz of [-1, 1]) k.rbox(Wd - 0.07, 0.035, 0.035, 0.004, paint, { p: [0, FY, sz * (L / 2 - 0.0175)], col: BLUE });
  for (const z of [-0.2, 0.2]) k.rbox(Wd - 0.07, 0.03, 0.03, 0.004, paint, { p: [0, FY, z], col: BLUE });
  // plywood deck with a spray stencil
  const DY = FY + 0.0175 + 0.011;
  k.rbox(L - 0.02, 0.022, Wd - 0.03, 0.004, wood, { p: [0, DY, 0], rs: 2, dU: 'z', col: 0xf0e2c8 });
  k.add(new THREE.PlaneGeometry(0.62, 0.2), decal, { p: [0, DY + 0.0115, -0.12], r: [-PI / 2, 0, PI / 2], uv: A.R(0, 100, 512, 160) });
  // side rails (angle steel) with hazard-striped stencil plates
  const RY = DY + 0.011 + 0.028;
  for (const sx of [-1, 1]) {
    k.rbox(0.008, 0.056, L - 0.04, 0.002, paint, { p: [sx * (Wd / 2 - 0.004), RY, 0], col: BLUE });
    k.add(new THREE.PlaneGeometry(0.5, 0.05), decal, { p: [sx * (Wd / 2 + 0.0005), RY, -0.1], r: [0, sx * PI / 2, 0], uv: A.R(0, 0, 512, 96) });
  }
  // front bumper (rubber strip)
  k.rbox(Wd - 0.04, 0.04, 0.02, 0.008, grip, { p: [0, FY, -L / 2 - 0.01] });
  // push handle: U tube, slightly raked back, gussets at the feet
  const HZ = L / 2 - 0.04, HT = 0.98, HB = 0.31;
  k.tube([[-HB, DY, HZ], [-HB, 0.6, HZ + 0.03], [-HB, HT - 0.06, HZ + 0.07], [-HB + 0.06, HT, HZ + 0.075], [HB - 0.06, HT, HZ + 0.075], [HB, HT - 0.06, HZ + 0.07], [HB, 0.6, HZ + 0.03], [HB, DY, HZ]], 0.014, paint, { tseg: 64, rseg: 10, tension: 0.15, col: BLUE });
  for (const sx of [-1, 1]) k.rbox(0.008, 0.08, 0.08, 0.002, steel, { p: [sx * HB, DY + 0.05, HZ - 0.03], r: [PI / 4, 0, 0] });
  k.cyl(0.02, 0.36, grip, { p: [0, HT, HZ + 0.075], r: [0, 0, PI / 2], seg: 16, bevel: 0.006 });
  // casters: mount plate + fork + wheel (wheel is its own part, spins at its axle)
  const WX = Wd / 2 - 0.08, WZ = L / 2 - 0.13;
  let wi = 0;
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
    const x = sx * WX, z = sz * WZ;
    k.rbox(0.09, 0.008, 0.09, 0.002, steel, { p: [x, FY - 0.0215, z] });
    k.cyl(0.018, 0.016, steel, { p: [x, FY - 0.033, z], seg: 12 });
    for (const fx of [-1, 1]) k.rbox(0.006, 0.08, 0.05, 0.002, steel, { p: [x + fx * 0.03, WR + 0.025, z - 0.01] });
    k.cyl(0.006, 0.07, S.chrome(), { p: [x, WR, z], r: [0, 0, PI / 2], seg: 8 });
    const part = 'w' + wi++;
    // tyre + hub in one material (vertex colour), lathe around X
    k.push({ p: [x, WR, z], r: [0, 0, PI / 2] });
    k.lathe([[0.012, -0.022], [0.045, -0.022, 0.004], [WR - 0.004, -0.02, 0.01], [WR, 0, 0.012], [WR - 0.004, 0.02, 0.01], [0.045, 0.022, 0.004], [0.012, 0.022]], wheelM, { seg: 22, part, col: 0xd8701c });
    k.lathe([[0, -0.024], [0.04, -0.024, 0.004], [0.04, 0.024, 0.004], [0, 0.024]], wheelM, { seg: 16, part, col: 0x55585c });
    k.pop();
    k.pivot(part, [x, WR, z]);
  }
  // colliders: deck slab, rails, handle, four ball wheels
  k.colBox([Wd, 0.07, L], [0, FY + 0.012, 0]);
  for (const sx of [-1, 1]) k.colBox([0.02, 0.06, L - 0.04], [sx * (Wd / 2 - 0.01), RY, 0]);
  for (const sx of [-1, 1]) k.colBox([0.04, HT - DY, 0.05], [sx * HB, (HT + DY) / 2, HZ + 0.04]);
  k.colBox([2 * HB + 0.04, 0.05, 0.05], [0, HT, HZ + 0.075]);
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) k.colBall(WR, [sx * WX, WR, sz * WZ]);
  k.anchor('deckMax', [Wd / 2, DY + 0.011, L / 2]);
  k.anchor('handle', [0, HT, HZ + 0.075]);
  return { kit: k, meta: { mass: 20, material: 'metal', center: [0, 0.3, 0], friction: 1.0, restitution: 0.02, linearDamping: 0.35, angularDamping: 3 } };
});

// ============================================================================ distorter
// A cream-enamel instrument case on rubber feet: black front plate with an analog FIELD % gauge,
// toggles and a pilot lamp, louvred sides with chrome carry handles. On top, a turned chrome collar
// holds a glass tube with a copper coil wound on a ferrite core (spins up when the field is on) and a
// glow inside; brass cap, telescopic antenna with a red tip lamp. Mains cable coiled at the back.
def('distorter', () => {
  const A = campAtlas();
  const k = new Kit();
  const enamel = mat({ name: 'distorter_enamel', color: 0xffffff, rough: 0.38, det: 'gloss', ns: 0.5, cc: 0.4, ccr: 0.2 });
  const dark = mat({ name: 'distorter_dark', color: 0x2a2b2d, rough: 0.55, det: 'powder', ns: 0.6 });
  const plate = mat({ name: 'distorter_plate', map: A, rough: 0.5, metal: 0.1, det: 'powder', ns: 0.4 });
  const chrome = S.chrome(), brass = S.brass(), copper = S.copper(), rubber = S.rubber();
  const W = 0.42, H = 0.26, D = 0.32, FY = 0.018;
  const CY = FY + H / 2;
  // case + top/bottom trims
  k.rbox(W, H, D, 0.022, enamel, { p: [0, CY, 0], rs: 2, col: 0xd9cfb2 });
  k.rbox(W - 0.03, 0.012, D - 0.03, 0.004, dark, { p: [0, FY + H + 0.002, 0] });
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.cyl(0.022, FY, rubber, { p: [x * (W / 2 - 0.04), FY / 2, z * (D / 2 - 0.04)], seg: 12 });
  // front plate
  k.add(new THREE.PlaneGeometry(W - 0.03, H - 0.03), plate, { p: [0, CY, D / 2 + 0.0008], uv: A.R(520, 0, 500, 250) });
  // gauge: chrome bezel + face + needle (part, pivot at the dial centre)
  const GX = -0.1, GY = CY + 0.005, GZ = D / 2 + 0.002;
  k.torus(0.052, 0.007, chrome, { p: [GX, GY, GZ + 0.004], rseg: 8, tseg: 28 });
  k.add(new THREE.CircleGeometry(0.05, 28), plate, { p: [GX, GY, GZ + 0.001], uv: A.R(0, 270, 240, 240) });
  k.add(new THREE.CircleGeometry(0.05, 28), clear({ tint: 0x101010 }), { p: [GX, GY, GZ + 0.009] });
  k.box(0.004, 0.044, 0.002, mat({ name: 'distorter_needle', color: 0xc42a1a, rough: 0.4 }), { p: [GX, GY + 0.018, GZ + 0.005], part: 'needle' });
  k.pivot('needle', [GX, GY - 0.004, GZ + 0.005]);
  // toggles + pilot lamp + knob
  for (let i = 0; i < 3; i++) {
    const x = 0.04 + i * 0.045;
    k.cyl(0.009, 0.008, chrome, { p: [x, CY - 0.06, GZ + 0.004], r: [PI / 2, 0, 0], seg: 12 });
    k.cyl(0.0035, 0.03, chrome, { p: [x, CY - 0.052, GZ + 0.016], r: [PI / 2 - 0.5 + (i % 2) * 1.0, 0, 0], seg: 8 });
  }
  k.sphere(0.011, glow({ name: 'distorter_pilot', color: 0x300805, emissive: 0xff3010, ei: 2.5 }), { p: [0.14, CY + 0.05, GZ + 0.004], ws: 12, hs: 8 });
  k.cyl(0.02, 0.018, dark, { p: [0.07, CY + 0.045, GZ + 0.01], r: [PI / 2, 0, 0], seg: 18, bevel: 0.004 });
  // louvred sides + carry handles
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 6; i++) k.rbox(0.004, 0.012, D * 0.6, 0.002, dark, { p: [sx * (W / 2 + 0.001), FY + 0.06 + i * 0.026, -0.01] });
    k.tube([[sx * (W / 2), CY + 0.06, -0.08], [sx * (W / 2 + 0.035), CY + 0.06, -0.06], [sx * (W / 2 + 0.035), CY + 0.06, 0.06], [sx * (W / 2), CY + 0.06, 0.08]], 0.007, chrome, { tseg: 24, rseg: 8, tension: 0.3 });
  }
  // coiled mains cable at the back
  k.tube(new HelixCurve(0.026, 0.08, 6), 0.006, rubber, { p: [0.12, FY + 0.05, -D / 2 - 0.035], r: [PI / 2, 0, 0], tseg: 120, rseg: 6 });
  // top: chrome collar, glass tube, coil assembly (part), glow (part), brass cap, antenna + lamp (part)
  const TY = FY + H + 0.008, TH = 0.27, TR = 0.075;
  k.lathe([[0.0, 0], [0.11, 0, 0.01], [0.11, 0.025, 0.006], [0.085, 0.04, 0.006], [0.0, 0.04]], chrome, { p: [0, TY, 0], seg: 36 });
  k.cyl(TR, TH, clear({ tint: 0x0a1018, rough: 0.04 }), { p: [0, TY + 0.04 + TH / 2, 0], seg: 32, open: true });
  k.cyl(TR * 0.62, TH - 0.02, glow({ name: 'distorter_tube', color: 0x050a12, emissive: 0x7ab4ff, ei: 0.3, transparent: true, opacity: 0.55, additive: true }), { p: [0, TY + 0.04 + TH / 2, 0], seg: 20, part: 'tube' });
  // coil: ferrite core + helical copper winding + end discs (spins as one part)
  const CB = TY + 0.055, CT = TY + 0.04 + TH - 0.02;
  k.cyl(0.016, CT - CB, mat({ name: 'distorter_core', color: 0x1c1c1e, rough: 0.35, metal: 0.6, det: 'cast' }), { p: [0, (CB + CT) / 2, 0], seg: 14, part: 'coil' });
  k.push({ p: [0, CB + 0.01, 0] });
  k.tube(new HelixCurve(0.042, CT - CB - 0.02, 14), 0.0045, copper, { tseg: 360, rseg: 6, part: 'coil' });
  k.pop();
  for (const y of [CB + 0.004, CT - 0.004]) k.cyl(0.055, 0.008, brass, { p: [0, y, 0], seg: 24, part: 'coil' });
  k.pivot('coil', [0, CB, 0]);
  k.lathe([[0.0, 0], [0.09, 0, 0.006], [0.088, 0.02, 0.008], [0.05, 0.045, 0.02], [0.012, 0.055], [0, 0.055]], brass, { p: [0, TY + 0.04 + TH, 0], seg: 32 });
  // antenna: two telescoping sections, red lamp on top
  const AY = TY + 0.04 + TH + 0.05;
  k.cyl(0.006, 0.22, chrome, { p: [0, AY + 0.11, 0], seg: 10 });
  k.cyl(0.0038, 0.2, chrome, { p: [0, AY + 0.3, 0], seg: 8 });
  k.sphere(0.014, glow({ name: 'distorter_lamp', color: 0x300505, emissive: 0xff2010, ei: 2 }), { p: [0, AY + 0.41, 0], ws: 12, hs: 8, part: 'lamp' });
  // colliders: case + tube column
  k.colBox([W, H + FY, D], [0, (H + FY) / 2, 0]);
  k.colCyl(0.1, TH + 0.1, [0, TY + (TH + 0.1) / 2, 0]);
  return { kit: k, meta: { mass: 14, material: 'metal', friction: 0.9, restitution: 0.05, angularDamping: 0.6 } };
});

// ============================================================================ field_bench
// Folding trestle bench: thick plywood top with hazard-taped front edge on two steel A-frame trestles,
// lower shelf with a car battery and a red toolbox, a vise, a clamp work-lamp and a portable olive
// terminal (FIELD-TERM 4) whose CRT faces the front (+Z).
def('field_bench', () => {
  const A = campAtlas();
  const k = new Kit();
  const r = new RNG(5);
  const wood = mat({ name: 'pine', rough: 0.86, det: 'roughwood', detAlbedo: true, ns: 0.9 });
  const decal = decalMat(A);
  const steel = mat({ name: 'fb_steel', color: 0xffffff, rough: 0.5, metal: 0.25, det: 'powder', ns: 0.6 });
  const olive = mat({ name: 'fb_olive', color: 0xffffff, rough: 0.6, det: 'powder', ns: 0.6 });
  const plate = mat({ name: 'fb_plate', map: A, rough: 0.6, det: 'powder', ns: 0.4 });
  const rubber = S.rubber(), chrome = S.chrome();
  const L = 1.5, D = 0.62, TY = 0.86, T = 0.04;
  // top: two laminated slabs + edge banding + hazard tape on the front edge
  k.rbox(L, T, D, 0.006, wood, { p: [0, TY - T / 2, 0], rs: 2, dU: 'x', col: 0xf4e6cc });
  k.add(new THREE.PlaneGeometry(L - 0.02, T * 0.7), decal, { p: [0, TY - T / 2, D / 2 + 0.0008], uv: A.R(520, 260, 500, 70) });
  k.add(new THREE.PlaneGeometry(0.7, 0.24), decal, { p: [-0.35, TY + 0.0009, 0.05], r: [-PI / 2, 0, 0.05], uv: A.R(520, 340, 500, 170) });
  // trestles: A-frames of square tube at each end, with a cross bar and foot caps
  for (const sx of [-1, 1]) {
    const x = sx * (L / 2 - 0.16);
    for (const sz of [-1, 1]) {
      k.tube([[x, TY - T, sz * 0.12], [x, 0.02, sz * (D / 2 - 0.02)]], 0.016, steel, { tseg: 2, rseg: 6, col: 0x7a8a5a });
      k.cyl(0.022, 0.02, rubber, { p: [x, 0.01, sz * (D / 2 - 0.02)], seg: 10 });
    }
    k.rbox(0.06, 0.04, 0.3, 0.005, steel, { p: [x, TY - T - 0.02, 0], col: 0x7a8a5a });
    k.tube([[x, 0.3, -0.22], [x, 0.3, 0.22]], 0.012, steel, { tseg: 2, rseg: 6, col: 0x7a8a5a });
  }
  // lower shelf across the cross bars
  k.rbox(L - 0.26, 0.02, 0.42, 0.003, wood, { p: [0, 0.32, 0], rs: 2, dU: 'x', col: 0xd8c4a0 });
  // car battery + red toolbox on the shelf
  // car battery: moulded case with ribbed walls, stepped lid, vent caps, lead posts, strap handle, label
  const BAT = mat({ name: 'fb_battery', color: 0x1d1e20, rough: 0.5, det: 'stipple' });
  k.rbox(0.26, 0.16, 0.17, 0.01, BAT, { p: [0.3, 0.41, -0.04] });
  k.rbox(0.266, 0.026, 0.176, 0.008, BAT, { p: [0.3, 0.502, -0.04], col: 0x34363a });
  for (let i = 0; i < 7; i++) for (const sz of [-1, 1]) k.rbox(0.008, 0.13, 0.008, 0.003, BAT, { p: [0.19 + i * 0.0367, 0.405, -0.04 + sz * 0.087] });
  for (let i = 0; i < 6; i++) k.cyl(0.009, 0.008, BAT, { p: [0.245 + i * 0.022, 0.519, -0.07], seg: 10, col: 0x55575c });
  k.rbox(0.13, 0.06, 0.004, 0.003, mat({ name: 'fb_bat_label', color: 0xd8d2c0, rough: 0.6, det: 'paper' }), { p: [0.3, 0.43, -0.04 + 0.087] });
  for (const bx of [0.22, 0.38]) k.lathe([[0.0, 0.0], [0.013, 0.0], [0.011, 0.02, 0.002], [0.0095, 0.026], [0, 0.026]], bx < 0.3 ? S.copper() : chrome, { p: [bx, 0.515, -0.04], seg: 12 });
  for (const sx of [-1, 1]) k.rbox(0.012, 0.03, 0.03, 0.004, BAT, { p: [0.3 + sx * 0.136, 0.48, -0.04] });
  k.tube([[0.165, 0.49, -0.04], [0.17, 0.56, -0.04], [0.3, 0.585, -0.04], [0.43, 0.56, -0.04], [0.435, 0.49, -0.04]], 0.005, rubber, { tseg: 28, rseg: 6 });
  k.tube([[0.22, 0.53, -0.04], [0.2, 0.62, 0.02], [0.24, 0.85, -0.12], [0.36, TY + 0.04, -0.15]], 0.006, mat({ name: 'fb_cable_r', color: 0xa81c14, rough: 0.6 }), { tseg: 24, rseg: 6 });
  k.tube([[0.38, 0.53, -0.04], [0.42, 0.64, 0.0], [0.46, 0.85, -0.14], [0.46, TY + 0.04, -0.16]], 0.006, rubber, { tseg: 24, rseg: 6 });
  // steel toolbox: body + domed lid with a seam, front catches, rolled hinge, end rivets
  const TB = mat({ name: 'fb_toolbox', color: 0xa8261c, rough: 0.45, det: 'powder', ns: 0.5 });
  k.rbox(0.42, 0.105, 0.2, 0.008, TB, { p: [-0.32, 0.3825, 0.0] });
  k.rbox(0.424, 0.006, 0.204, 0.002, S.steelDark(), { p: [-0.32, 0.437, 0.0] });
  k.rbox(0.42, 0.045, 0.2, 0.014, TB, { p: [-0.32, 0.4625, 0.0] });
  k.rbox(0.4, 0.012, 0.16, 0.006, TB, { p: [-0.32, 0.486, 0.0] });
  for (const sx of [-1, 1]) {
    k.rbox(0.03, 0.04, 0.006, 0.002, chrome, { p: [-0.32 + sx * 0.12, 0.437, 0.103] });
    k.cyl(0.004, 0.026, chrome, { p: [-0.32 + sx * 0.12, 0.452, 0.106], r: [0, 0, PI / 2], seg: 8 });
    for (const sy of [-1, 1]) k.cyl(0.004, 0.003, chrome, { p: [-0.32 + sx * 0.211, 0.41 + sy * 0.03, 0.06], r: [0, 0, PI / 2], seg: 8 });
  }
  k.cyl(0.005, 0.4, S.steelDark(), { p: [-0.32, 0.44, -0.101], r: [0, 0, PI / 2], seg: 8 });
  k.tube([[-0.47, 0.49, 0], [-0.47, 0.53, 0], [-0.17, 0.53, 0], [-0.17, 0.49, 0]], 0.008, chrome, { tseg: 16, rseg: 6, tension: 0.1 });
  // vise at the front-left corner
  const vx = -L / 2 + 0.18, vz = D / 2 - 0.04;
  const VM = mat({ name: 'fb_vise', color: 0x3d5a7a, rough: 0.5, det: 'cast', ns: 0.6 });
  k.rbox(0.14, 0.05, 0.2, 0.01, VM, { p: [vx, TY + 0.025, vz - 0.08] });
  k.rbox(0.13, 0.1, 0.05, 0.01, VM, { p: [vx, TY + 0.08, vz - 0.1] });
  k.rbox(0.13, 0.09, 0.05, 0.01, VM, { p: [vx, TY + 0.075, vz + 0.0] });
  k.cyl(0.01, 0.18, chrome, { p: [vx, TY + 0.06, vz + 0.06], r: [PI / 2, 0, 0], seg: 10 });
  k.cyl(0.006, 0.18, chrome, { p: [vx, TY + 0.06, vz + 0.14], r: [0, 0, PI / 2], seg: 8 });
  // clamp work lamp at the back-left
  const lx = -0.5, lz = -D / 2 + 0.06;
  k.rbox(0.05, 0.06, 0.05, 0.006, steel, { p: [lx, TY + 0.03, lz], col: 0x2a2a2a });
  k.tube([[lx, TY + 0.06, lz], [lx + 0.02, TY + 0.3, lz + 0.04], [lx + 0.12, TY + 0.42, lz + 0.12]], 0.007, chrome, { tseg: 16, rseg: 6 });
  k.push({ p: [lx + 0.14, TY + 0.4, lz + 0.14], r: [0.9, 0.3, 0] });
  k.lathe([[0.07, -0.08], [0.055, -0.035], [0.03, 0.0], [0.016, 0.02], [0, 0.024]], mat({ name: 'fb_lampshade', color: 0x2f5a3a, rough: 0.45, det: 'powder' }), { seg: 20, r: [PI, 0, 0] });
  k.sphere(0.026, glow({ name: 'fb_bulb', color: 0x3a3020, emissive: 0xffe2a8, ei: 1.1 }), { p: [0, 0.045, 0], ws: 12, hs: 8 });
  k.pop();
  // scattered tools: hammer, screwdriver, a few screws
  k.cyl(0.012, 0.28, mat({ name: 'fb_handle', color: 0xc89a60, rough: 0.7 }), { p: [0.05, TY + 0.012, 0.18], r: [0, 0.4, PI / 2], seg: 10 });
  k.rbox(0.03, 0.03, 0.11, 0.005, S.steelDark(), { p: [0.05 + Math.cos(0.4) * 0.14, TY + 0.016, 0.18 - Math.sin(0.4) * 0.14], r: [0, 0.4, 0] });
  k.cyl(0.01, 0.1, mat({ name: 'fb_sd', color: 0xe8c41a, rough: 0.35 }), { p: [-0.12, TY + 0.01, 0.2], r: [0, -0.9, PI / 2], seg: 10 });
  for (let i = 0; i < 5; i++) k.cyl(0.003, 0.025, chrome, { p: [-0.02 + r.range(-0.05, 0.05), TY + 0.003, 0.24 + r.range(-0.03, 0.03)], r: [PI / 2, r.next() * TAU, 0], seg: 6 });
  // portable terminal: olive case, CRT facing +Z, handle on top, name plate
  const tx = 0.42, tz = -0.1, tw = 0.36, th = 0.28, td = 0.3;
  k.rbox(tw, th, td, 0.02, olive, { p: [tx, TY + th / 2, tz], col: 0x6a7350 });
  k.rbox(tw - 0.03, th - 0.05, 0.02, 0.01, mat({ name: 'fb_bezel', color: 0x1a1a1a, rough: 0.6 }), { p: [tx, TY + th / 2 + 0.01, tz + td / 2 + 0.002] });
  k.add(new THREE.PlaneGeometry(0.25, 0.18), mat({ name: 'fb_screen', color: 0x0a0c0a, rough: 0.2 }), { p: [tx - 0.02, TY + th / 2 + 0.015, tz + td / 2 + 0.0135], part: 'screen' });
  for (let i = 0; i < 4; i++) k.cyl(0.008, 0.01, chrome, { p: [tx + 0.14, TY + 0.06 + i * 0.045, tz + td / 2 + 0.013], r: [PI / 2, 0, 0], seg: 10 });
  k.add(new THREE.PlaneGeometry(0.2, 0.085), plate, { p: [tx, TY + th + 0.0009, tz - 0.02], r: [-PI / 2, 0, 0], uv: A.R(250, 270, 260, 110) });
  k.tube([[tx - 0.1, TY + th, tz], [tx - 0.1, TY + th + 0.05, tz], [tx + 0.1, TY + th + 0.05, tz], [tx + 0.1, TY + th, tz]], 0.009, rubber, { tseg: 16, rseg: 6, tension: 0.2 });
  // keyboard lip
  k.rbox(0.3, 0.025, 0.11, 0.006, olive, { p: [tx, TY + 0.0125, tz + td / 2 + 0.07], col: 0x5a6244 });
  for (let i = 0; i < 3; i++) for (let j = 0; j < 9; j++) k.rbox(0.022, 0.008, 0.02, 0.002, mat({ name: 'fb_keys', color: 0xd8d0b8, rough: 0.5 }), { p: [tx - 0.12 + j * 0.03, TY + 0.029, tz + td / 2 + 0.035 + i * 0.03] });
  // colliders: top, trestles, shelf, terminal, vise
  k.colBox([L, T, D], [0, TY - T / 2, 0]);
  for (const sx of [-1, 1]) k.colBox([0.06, TY - T, D - 0.04], [sx * (L / 2 - 0.16), (TY - T) / 2, 0]);
  k.colBox([L - 0.26, 0.04, 0.42], [0, 0.32, 0]);
  k.colBox([tw, th, td], [tx, TY + th / 2, tz]);
  k.colBox([0.14, 0.12, 0.22], [vx, TY + 0.06, vz - 0.06]);
  k.anchor('top', [-0.2, TY, 0.04]);
  return { kit: k, meta: { mass: 55, material: 'wood', friction: 0.9, restitution: 0.05, center: [0, 0.5, 0] } };
});
