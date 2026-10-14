// R.O.O.M. items — crafting materials & crafted traps: plank, metal scrap, screws, cloth, wire spool,
// short pipe, gear, spike trap, barricade panel.
import * as THREE from 'three';
import { Kit, def, PI, TAU, V3, sstep, clamp, lerp, hash, fillet, latheGeo, sheetGeo, extrudeGeo, polyGeo, rrectShape, rrectPath, roundedShape, curve, circlePath } from './core.js';
import { mat, clear, S } from './mats.js';
import { RNG } from '../../core/rng.js';
import {
  atlas, txt, para, rect, rrect, circle, line, noise, mottle, wear, edgeGrime, rubEdge, barcode, roomIcon, brand, lgrad, rgrad,
  hazardStripes, warnTri, inkStamp, endGrain, woodGrain,
  SANS, COND, MONO, SERIF, HAND, INK, ROOM_YELLOW,
} from './paint.js';

// Shared decal atlas for lumber: grade stamps, spray-painted stencils, end grain, hazard tape (RGBA).
function lumberDecals() {
  return atlas('lumber_decals', 1024, 512, (c) => {
    c.clearRect(0, 0, 1024, 512);
    // grade stamp (0,0,256,110)
    inkStamp(c, '', 128, 55, { rot: 0.02, w: 220, h: 86, color: '#2b3a7a', alpha: 0.75, box: true, holes: 90, seed: 3 });
    c.save(); c.globalAlpha = 0.72;
    txt(c, 'R.O.O.M. LUMBER', 128, 30, { size: 21, color: '#2b3a7a', fam: MONO, weight: '900' });
    txt(c, 'KD-HT  SPF  No.2', 128, 56, { size: 18, color: '#2b3a7a', fam: MONO, weight: 'bold' });
    txt(c, 'MILL 0451  S-DRY', 128, 80, { size: 13, color: '#2b3a7a', fam: MONO, weight: 'bold' });
    c.restore();
    // length mark + property text (0,120,512,40)
    txt(c, 'PROPERTY OF R.O.O.M. — DO NOT BURN', 256, 140, { size: 20, color: 'rgba(20,20,20,0.55)', fam: MONO, weight: 'bold' });
    // spray stencils (0,170,1024,170): "KEEP OUT" and "DANGER" with overspray
    const spray = (s, x, y, size, col, seed) => {
      const r = new RNG(seed);
      c.save(); c.filter = 'blur(3px)'; txt(c, s, x, y, { size, color: col, fam: MONO, weight: '900', alpha: 0.35 }); c.restore();
      txt(c, s, x, y, { size, color: col, fam: MONO, weight: '900', alpha: 0.9 });
      for (let i = 0; i < 6; i++) { const dx = x + r.range(-size * 1.6, size * 1.6), dy = y + r.range(-size * 0.2, size * 0.4); c.fillStyle = col; c.globalAlpha = 0.7; c.fillRect(dx, dy, r.range(1.5, 3), r.range(10, 40)); c.globalAlpha = 1; }
    };
    spray('KEEP OUT', 512, 230, 120, '#b5160f', 5);
    spray('DANGER', 256, 400, 90, '#b5160f', 7);
    txt(c, 'PROPERTY OF R.O.O.M.', 768, 400, { size: 34, color: 'rgba(20,20,20,0.85)', fam: MONO, weight: '900' });
    // end grain (900,0,124,124) opaque
    endGrain(c, 900, 0, 124, 124, { seed: 2, base: '#c8a06a', cx: 0.4, cy: 1.8 });
    // hazard tape (640,440,384,72) opaque
    hazardStripes(c, 640, 440, 384, 72, 24);
    noise(c, 640, 440, 384, 72, 10, 4);
  }, { clear: true, plain: false });
}
function decalMat(D) { return mat({ name: 'lumber_decal', map: D, rough: 0.8, transparent: true, depthWrite: false, polygonOffset: true, vc: true, alphaTest: 0.02 }); }

// ============================================================================ plank (2x4 pine, 0.9 m)
def('plank', () => {
  const D = lumberDecals();
  const wood = mat({ name: 'pine', rough: 0.86, det: 'roughwood', detAlbedo: true, ns: 0.9 });
  const decal = decalMat(D);
  const k = new Kit();
  const W = 0.089, T = 0.038, L = 0.9;
  k.rbox(W, T, L, 0.0032, wood, { rs: 2, dU: 'z', dOff: 0.13, col: 0xfff6ea });
  // end grain caps + grade stamp + length mark (decals)
  for (const sz of [-1, 1]) k.add(new THREE.PlaneGeometry(W - 0.004, T - 0.004), decal, { p: [0, 0, sz * (L / 2 + 0.0002)], r: [0, sz > 0 ? 0 : PI, 0], uv: D.R(900, 0, 124, 124) });
  k.add(new THREE.PlaneGeometry(0.075, 0.032), decal, { p: [0, T / 2 + 0.0002, -0.21], r: [-PI / 2, 0, -PI / 2 + 0.03], uv: D.R(0, 0, 256, 110) });
  k.add(new THREE.PlaneGeometry(0.25, 0.02), decal, { p: [W / 2 + 0.0002, 0, 0.18], r: [0, PI / 2, 0], uv: D.R(0, 120, 512, 40) });
  k.colBox([W, T, L]);
  return { kit: k, meta: { mass: 1.4, material: 'wood', hold: { grip: [0, 0, 0.27], rot: [0.32, 0.02, -0.25], off: [0, -0.02, 0] } } };
});

// ============================================================================ spike_trap (crafted)
// Two rough planks on battens with nails driven up through them (some bent, rusty), hazard tape wrapped
// round one end and a spray-painted warning.
def('spike_trap', () => {
  const D = lumberDecals();
  const wood = mat({ name: 'pine', rough: 0.86, det: 'roughwood', detAlbedo: true, ns: 0.9 });
  const decal = decalMat(D);
  const nailM = mat({ name: 'item_nail', color: 0x9a9690, metal: 1, rough: 0.5, det: 'cast', ns: 0.6 });
  const k = new Kit();
  const L = 0.42, t = 0.022, w = 0.112, bt = 0.02;
  for (const sx of [-1, 1]) k.rbox(0.04, bt, 0.232, 0.003, wood, { p: [sx * 0.16, bt / 2, 0], rs: 2, dU: 'z', dOff: sx * 0.3, col: 0xe8dccc });
  for (const [i, sz] of [[0, -1], [1, 1]]) k.rbox(L, t, w, 0.0035, wood, { p: [0, bt + t / 2, sz * (w / 2 + 0.002)], rs: 2, dU: 'x', dOff: i * 0.21, col: i ? 0xf4e8d8 : 0xffffff });
  // hazard tape band round one end (+ seam)
  k.rbox(0.048, t + 0.0016, 2 * w + 0.0062, 0.001, decal, { p: [-L / 2 + 0.042, bt + t / 2, 0], rs: 1, uv: D.R(640, 440, 384, 72) });
  // spray paint on top
  k.add(new THREE.PlaneGeometry(0.3, 0.1), decal, { p: [0.04, bt + t + 0.0002, 0], r: [-PI / 2, 0, 0.02], uv: D.R(96, 340, 330, 120) });
  // nails: shank + point (driven from below), some bent and rusty
  const r = new RNG(77);
  const y0 = bt + t;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
    const x = -0.13 + i * 0.07 + r.range(-0.008, 0.008), z = -0.075 + j * 0.05 + r.range(-0.006, 0.006);
    const bent = (i === 1 && j === 2) || (i === 4 && j === 0);
    const len = r.range(0.04, 0.05);
    const rust = r.next() < 0.4 ? 0x8a5a3a : 0xb0aca6;
    k.push({ p: [x, y0, z], r: [r.range(-0.1, 0.1), r.next() * TAU, r.range(-0.1, 0.1)] });
    if (bent) {
      k.tube([[0, 0, 0], [0, len * 0.5, 0], [0.004, len * 0.72, 0], [0.016, len * 0.8, 0]], 0.0016, nailM, { tseg: 10, rseg: 6, col: rust });
    } else {
      k.lathe([[0.0016, 0], [0.0016, len], [0.0008, len + 0.006, 0.0005], [0, len + 0.0085]], nailM, { seg: 7, col: rust });
    }
    k.pop();
  }
  k.colBox([L, bt + t, 0.232], [0, (bt + t) / 2, 0]);
  k.colBox([0.36, 0.046, 0.2], [0, y0 + 0.023, 0]);
  return { kit: k, meta: { mass: 2.2, material: 'wood', hold: { grip: [0.12, y0, 0.1], rot: [0.25, 0.2, 0.05], off: [0, -0.1, -0.05] } } };
});

// ============================================================================ barricade_panel (crafted)
// Three planks on two battens with a diagonal brace, nailed at every crossing (heads proud / bent), a few
// split ends, spray-painted KEEP OUT stencil and corporate property mark.
def('barricade_panel', () => {
  const D = lumberDecals();
  const wood = mat({ name: 'pine', rough: 0.86, det: 'roughwood', detAlbedo: true, ns: 0.9 });
  const decal = decalMat(D);
  const nailM = mat({ name: 'item_nail', color: 0x9a9690, metal: 1, rough: 0.5, det: 'cast', ns: 0.6 });
  const k = new Kit();
  const L = 1.1, ph = 0.28, t = 0.022, gap = 0.012;
  const tones = [0xffffff, 0xf0e2d0, 0xfaf0e2];
  for (let i = 0; i < 3; i++) {
    const y = (1 - i) * (ph + gap);
    k.rbox(L, ph, t, 0.004, wood, { p: [0, y, 0], rs: 2, dU: 'x', dOff: i * 0.37, col: tones[i] });
  }
  const Hh = 3 * ph + 2 * gap;
  for (const sx of [-1, 1]) k.rbox(0.075, Hh - 0.02, t, 0.004, wood, { p: [sx * 0.4, 0, -t], rs: 2, dU: 'y', dOff: sx * 0.5, col: 0xe8d8c4 });
  const dx = 0.8 - 0.07, dy = Hh - 0.12;
  k.push({ p: [0, 0, -t * 2 + 0.0005], r: [0, 0, Math.atan2(dy, dx)] });
  k.rbox(Math.hypot(dx, dy), 0.075, t, 0.004, wood, { rs: 2, dU: 'x', dOff: 0.9, col: 0xe0d0bc });
  k.pop();
  // stencils
  k.add(new THREE.PlaneGeometry(0.95, 0.2), decal, { p: [0, 0.21, t / 2 + 0.0003], r: [0, 0, -0.03], uv: D.R(0, 170, 1024, 130) });
  k.add(new THREE.PlaneGeometry(0.5, 0.06), decal, { p: [0.1, -0.29, t / 2 + 0.0003], r: [0, 0, 0.02], uv: D.R(560, 370, 420, 60) });
  // nail heads at batten crossings & brace (front)
  const r = new RNG(9);
  for (let i = 0; i < 3; i++) {
    const y = (1 - i) * (ph + gap);
    for (const sx of [-1, 1]) for (const dy2 of [-0.07, 0.07]) {
      k.lathe([[0.0056, 0], [0.0056, 0.0008, 0.0003], [0.0035, 0.0014, 0.001], [0, 0.0016]], nailM, { seg: 10, p: [sx * 0.4 + r.range(-0.012, 0.012), y + dy2 + r.range(-0.01, 0.01), t / 2], r: [PI / 2, 0, 0], col: r.next() < 0.3 ? 0x8a5a3a : 0x8a8680 });
    }
    k.lathe([[0.0056, 0], [0.0056, 0.0008, 0.0003], [0.0035, 0.0014, 0.001], [0, 0.0016]], nailM, { seg: 10, p: [-0.12 + i * 0.12 + r.range(-0.02, 0.02), y, t / 2], r: [PI / 2, 0, 0], col: 0x8a8680 });
  }
  // one bent-over nail head
  k.tube([[0.2, 0.06, t / 2], [0.2, 0.06, t / 2 + 0.012], [0.21, 0.064, t / 2 + 0.016], [0.228, 0.066, t / 2 + 0.006]], 0.0015, nailM, { tseg: 10, rseg: 5, col: 0x8a7a6a });
  k.colBox([L, Hh, t * 2 + 0.002], [0, 0, -t / 2]);
  return { kit: k, meta: { mass: 18, material: 'wood', hold: { grip: [L / 2 - 0.04, 0, 0], rot: [0, -PI / 2 + 0.25, 0], off: [0.08, -0.34, 0.06] } } };
});

// ============================================================================ metal_scrap
// Torn-off painted steel panel: jagged tear outline, real sheet thickness, bent flange, rivet holes with
// two rivets left, dents; olive paint with stencil, chips, rust runs; rusty primer back.
def('metal_scrap', () => {
  const A = atlas('metal_scrap', 512, 512, (c) => {
    // painted face (0,0,512,360): u = x, v = z
    rect(c, 0, 0, 512, 360, '#5d6b52');
    mottle(c, 0, 0, 512, 360, 14, 2, 0.8);
    noise(c, 0, 0, 512, 360, 12, 2);
    txt(c, 'M. CORP', 220, 176, { size: 72, color: '#e6e0cc', fam: MONO, weight: '900', rot: -0.02, alpha: 0.9 });
    txt(c, 'PANEL 4-B', 170, 238, { size: 28, color: '#e6e0cc', fam: MONO, weight: '900', alpha: 0.9 });
    hazardStripes(c, 0, 300, 512, 36, 18);
    const r = new RNG(12);
    for (let i = 0; i < 80; i++) {
      const x = r.range(0, 512), y = r.range(0, 360), w = r.range(2, 16);
      c.fillStyle = 'rgba(220,210,190,0.25)'; c.beginPath(); c.ellipse(x, y, w + 1.5, w * 0.6 + 1.5, r.next() * PI, 0, TAU); c.fill();
      c.fillStyle = r.next() < 0.45 ? '#8a8d8e' : '#7a4524'; c.beginPath(); c.ellipse(x, y, w, w * r.range(0.3, 0.8), r.next() * PI, 0, TAU); c.fill();
    }
    for (let i = 0; i < 12; i++) { const x = r.range(10, 500), y = r.range(0, 200); const g = lgrad(c, 0, y, 0, y + 160, [[0, 'rgba(120,60,20,0.55)'], [1, 'rgba(120,60,20,0)']]); c.fillStyle = g; c.fillRect(x, y, r.range(4, 10), 160); }
    // torn-edge bare steel halo
    edgeGrime(c, 0, 0, 512, 360, 2.4, '120,110,100');
    wear(c, 0, 0, 512, 360, 13, 3, { dirt: 1.6 });
    // rusty primer back (0,364,440,140)
    rect(c, 0, 364, 440, 140, '#7a4a2a');
    noise(c, 0, 364, 440, 140, 40, 4);
    for (let i = 0; i < 70; i++) { c.fillStyle = r.next() < 0.5 ? 'rgba(160,80,30,0.6)' : 'rgba(70,60,50,0.6)'; c.beginPath(); c.arc(r.range(0, 440), r.range(364, 504), r.range(3, 14), 0, TAU); c.fill(); }
    // torn edge steel (444,364,60,60)
    rect(c, 444, 364, 60, 60, '#9a9c9e'); noise(c, 444, 364, 60, 60, 20, 6);
  }, { plain: '#9a9c9e' });
  const p = mat({ name: 'scrap_paint', map: A, rough: 0.6, metal: 0.35, det: 'cast', ns: 0.8 });
  const k = new Kit();
  const W = 0.24, Dz = 0.17, xb = 0.055, ang = 0.75, T = 0.0014;
  // jagged outline
  const r = new RNG(3);
  const outline = [];
  const n = 40;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    let x = Math.cos(a) * W / 2 * 1.02, z = Math.sin(a) * Dz / 2 * 1.02;
    x = Math.sign(x) * Math.min(Math.abs(x), W / 2); z = Math.sign(z) * Math.min(Math.abs(z), Dz / 2);
    const jag = x < -0.05 || z > 0.06 ? r.range(-0.012, 0.004) : r.range(-0.002, 0.001);
    const len = Math.hypot(x, z) || 1;
    outline.push([x + (x / len) * jag, -(z + (z / len) * jag)]);
  }
  const sh = new THREE.Shape();
  outline.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
  sh.closePath();
  for (let i = 0; i < 5; i++) sh.holes.push(circlePath(-0.095, -(-0.06 + i * 0.03), 0.0032));
  const bend = (v) => {
    // v: x, y (=-z), z (thickness) in shape space
    const zz = -v.y;
    v.z += Math.sin(zz * 25 + v.x * 9) * 0.0025 + Math.sin(v.x * 40) * 0.001 - 0.004 * Math.exp(-((v.x + 0.02) ** 2 + (zz - 0.02) ** 2) / 0.0008);
    if (v.x > xb) { const d = v.x - xb; const a = ang * Math.min(1, d / 0.012); v.x = xb + Math.cos(a) * d - Math.sin(a) * v.z; v.z = v.z * Math.cos(a) + Math.sin(a) * d; }
  };
  const face = A.R(0, 0, 512, 360), back = A.R(0, 364, 440, 140), edge = A.R(444, 364, 60, 60);
  k.add(extrudeGeo(sh, T, 0.0002, { curveSegments: 4, bevelSegments: 1, steps: 1 }), p, {
    r: [-PI / 2, 0, 0],
    uvFn: (q, nn) => {
      const u = q.x / W + 0.5, v = 0.5 + q.y / Dz;
      if (nn.z > 0.5) return [face[0] + u * (face[2] - face[0]), face[1] + v * (face[3] - face[1])];
      if (nn.z < -0.5) return [back[0] + u * (back[2] - back[0]), back[1] + v * (back[3] - back[1])];
      return [edge[0] + u * (edge[2] - edge[0]), edge[1] + v * (edge[3] - edge[1])];
    },
    deform: bend,
    smooth: true,
  });
  // two remaining rivets
  for (const zr of [-0.06 + 0.03, -0.06 + 0.09]) {
    const v = V3(-0.095, -zr, T / 2); bend(v);
    k.lathe([[0.0048, 0], [0.0046, 0.0012, 0.0008], [0, 0.0022]], p, { seg: 12, p: [v.x, v.z, -v.y], uv: edge, col: 0x9a9c9e });
  }
  k.colBox([W - (W / 2 - xb) + 0.01, 0.0074, Dz], [-(W / 2 - xb) / 2 + 0.005 - 0.01, 0, 0]); // waves + dent span ~7 mm
  const fl = W / 2 - xb;
  k.colBox([fl, 0.006, Dz], [xb + Math.cos(ang) * fl / 2, Math.sin(ang) * fl / 2, 0], [0, 0, ang]);
  return { kit: k, meta: { mass: 0.5, material: 'metal', hold: { grip: [-0.08, 0, 0.02], rot: [1.0, 0.35, 0.25], off: [0.04, -0.06, -0.03] } } };
});

// ============================================================================ screws (box)
// Hardware carton with its tuck lid flipped open, dust flaps, assorted zinc-plated screws (pan & flat
// heads, real thread ridges) piled inside, printed panels with a screw illustration and SKU sticker.
function screwGeo(len, rHead, flat) {
  // threads come from the 'thread' surface detail (rings), the silhouette keeps a crest/root taper
  const rs = rHead * 0.42;
  const pts = flat
    ? [[0, -0.0016], [rHead * 0.95, -0.0016], [rHead, -0.0012], [rs, 0.0008], [rs * 0.96, len - 0.004], [rs * 0.55, len - 0.0008], [0, len + 0.0004]]
    : [[0, -0.0028], [rHead * 0.55, -0.0026], [rHead * 0.98, -0.0018], [rHead, -0.0002], [rs, 0.0002], [rs * 0.96, len - 0.004], [rs * 0.55, len - 0.0008], [0, len + 0.0004]];
  return latheGeo(pts.map(([x, y]) => [x, y, false]), { seg: 8, dm: 0.02 });
}
def('screws', () => {
  const A = atlas('screws', 512, 512, (c) => {
    // lid top (0,0,512,330) = printed face of the open lid
    rect(c, 0, 0, 512, 330, '#f1ece0');
    noise(c, 0, 0, 512, 330, 6, 2);
    rect(c, 0, 0, 512, 64, '#e8661c');
    brand(c, 256, 32, 24, '#fff', { text: 'R.O.O.M. HARDWARE' });
    txt(c, 'SCREWS', 300, 118, { size: 64, color: INK, weight: '900', maxW: 300 });
    txt(c, 'ASSORTED', 300, 170, { size: 38, color: '#e8661c', weight: '900', ls: 4, maxW: 300 });
    rrect(c, 22, 82, 118, 200, 8, '#2c2a26');
    txt(c, '#8 × 1¼"', 81, 182, { size: 26, color: '#f1ece0', weight: '900', rot: -PI / 2 });
    txt(c, 'QTY: ~100 (APPROX.)', 300, 212, { size: 17, color: INK, fam: MONO, weight: 'bold', maxW: 300 });
    txt(c, 'WOOD • SHEET METAL • ???', 300, 240, { size: 13, color: '#444', fam: MONO, weight: 'bold', maxW: 300 });
    rect(c, 0, 290, 512, 40, INK);
    txt(c, 'PROPERTY OF R.O.O.M. — COUNT BEFORE USE', 256, 310, { size: 15, color: '#f1ece0', fam: MONO, weight: 'bold', maxW: 490 });
    wear(c, 0, 0, 512, 330, 9, 1.4, { dirt: 1.4 });
    // side (0,334,512,80)
    rect(c, 0, 334, 512, 80, '#f1ece0');
    rect(c, 0, 334, 512, 12, '#e8661c');
    txt(c, 'SCREWS ASSORTED', 170, 382, { size: 28, color: INK, weight: '900', maxW: 290 });
    barcode(c, 360, 352, 130, 52, 17, true);
    wear(c, 0, 334, 512, 80, 10, 1.4);
    // end flap (0,418,200,80), inside (210,418,140,80), SKU sticker (360,418,140,60)
    rect(c, 0, 418, 200, 80, '#e9e2d2');
    txt(c, '#8 × 1¼"', 100, 458, { size: 18, color: INK, fam: MONO, weight: 'bold' });
    rect(c, 210, 418, 140, 80, '#c8b48e'); noise(c, 210, 418, 140, 80, 18, 6);
    rect(c, 360, 418, 140, 60, '#fffbe8'); txt(c, 'SKU 0451-S8', 430, 440, { size: 12, color: INK, fam: MONO, weight: 'bold' }); txt(c, '$2.49', 430, 462, { size: 16, color: '#c0302a', weight: '900' });
  }, { plain: '#c8b48e' });
  const card = mat({ name: 'screws_card', map: A, rough: 0.82, det: 'card', ns: 0.5 });
  const zinc = mat({ name: 'item_zinc_screw', color: 0xd0d4d6, metal: 1, rough: 0.34, det: 'thread', ns: 1.0 });
  const k = new Kit();
  const W = 0.095, H = 0.035, D = 0.062, t = 0.0012;
  const inside = A.R(210, 418, 140, 80), side = A.R(0, 334, 512, 80), endR = A.R(0, 418, 200, 80);
  // open tray: bottom + four walls (card thickness), inside surfaces kraft brown
  k.box(W, t, D, card, { p: [0, t / 2, 0], faces: { py: inside, ny: inside, px: inside, nx: inside, pz: inside, nz: inside } });
  for (const sz of [-1, 1]) k.box(W, H, t, card, { p: [0, H / 2, sz * (D / 2 - t / 2)], faces: { pz: sz > 0 ? side : inside, nz: sz > 0 ? inside : side, py: inside, ny: inside, px: inside, nx: inside } });
  for (const sx of [-1, 1]) k.box(t, H, D - 2 * t, card, { p: [sx * (W / 2 - t / 2), H / 2, 0], faces: { px: sx > 0 ? endR : inside, nx: sx > 0 ? inside : endR, py: inside, ny: inside, pz: inside, nz: inside } });
  // lid hinged at the back edge, flipped open ~115 degrees, with its tuck flap
  k.push({ p: [0, H, -D / 2], r: [-2.0, 0, 0] });
  k.box(W, t, D, card, { p: [0, t / 2, D / 2], faces: { py: inside, ny: A.R(0, 0, 512, 330, 0), px: inside, nx: inside, pz: inside, nz: inside } });
  k.push({ p: [0, 0, D], r: [-1.2, 0, 0] });
  k.box(W - 0.004, t, 0.016, card, { p: [0, 0, 0.008], uv: inside });
  k.pop();
  k.pop();
  // dust flaps on the ends, bent outward
  for (const sx of [-1, 1]) { k.push({ p: [sx * (W / 2), H, 0], r: [0, 0, sx * -0.6] }); k.box(t, 0.014, D - 0.012, card, { p: [0, 0.007, 0], uv: inside }); k.pop(); }
  // screws piled inside (pan & flat heads), a couple spilled
  const r = new RNG(21);
  const pile = [];
  for (let i = 0; i < 16; i++) pile.push([r.range(-0.036, 0.036), 0.004 + r.range(0, 0.012) * (1 - Math.abs(r.next() - 0.5)), r.range(-0.022, 0.022), r.next() * TAU, r.range(0.9, 1.6), r.next() < 0.5]);
  pile.push([0.062, 0.0039, 0.018, 0.4, PI / 2, true], [0.07, 0.0039, -0.01, 2.2, PI / 2, false]);
  for (const [x, y, z, ry, rx, flat] of pile) k.add(screwGeo(0.031, 0.0039, flat), zinc, { p: [x, y, z], r: [rx, ry, 0], col: r.next() < 0.2 ? 0xc8b890 : 0xffffff });
  k.colBox([W, H, D], [0, H / 2, 0]);
  return { kit: k, meta: { mass: 0.35, material: 'cardboard', hold: { grip: [0, 0.01, 0.02], rot: [0.75, -0.15, 0.06], off: [0, 0.02, 0] } } };
});

// ============================================================================ fabric_scrap (folded flannel rag)
def('fabric_scrap', () => {
  const A = atlas('fabric_scrap', 512, 512, (c) => {
    rect(c, 0, 0, 512, 512, '#b8352a');
    const band = (vert, pos, w, col) => { c.fillStyle = col; if (vert) c.fillRect(pos, 0, w, 512); else c.fillRect(0, pos, 512, w); };
    for (let i = 0; i < 8; i++) { band(true, i * 64 + 8, 24, 'rgba(26,20,30,0.45)'); band(false, i * 64 + 8, 24, 'rgba(26,20,30,0.45)'); band(true, i * 64 + 44, 3, 'rgba(250,232,190,0.55)'); band(false, i * 64 + 44, 3, 'rgba(250,232,190,0.55)'); }
    for (let i = 0; i < 512; i += 3) line(c, i, 0, i + 512, 512, 'rgba(255,255,255,0.05)', 1);
    noise(c, 0, 0, 512, 512, 22, 8);
    wear(c, 0, 0, 512, 512, 12, 1.4, { lightRatio: 0.2, dirt: 1.6 });
    // frayed edge fringe darkening
    edgeGrime(c, 0, 0, 512, 512, 1.6);
  }, { plain: '#b8352a' });
  const p = mat({ name: 'flannel', map: A, rough: 1.0, det: 'twill', ns: 1.0, sheen: 0.6, sheenColor: 0xffc8b8, sheenRough: 0.55 });
  const k = new Kit();
  const slab = (W, D, T, seed, uvr) => {
    const r = new RNG(seed);
    const ph = [r.range(0, 6), r.range(0, 6), r.range(0, 6)];
    const top = (u, v) => {
      const e = Math.pow(Math.max(0, 1 - Math.pow(2 * u - 1, 8)) * Math.max(0, 1 - Math.pow(2 * v - 1, 8)), 0.35);
      const nn = Math.sin(u * 9 + ph[0]) * Math.sin(v * 7 + ph[1]) * 0.25 + Math.sin(u * 23 + v * 17 + ph[2]) * 0.08;
      const fray = (u < 0.03 || u > 0.97 || v < 0.03 || v > 0.97) ? Math.sin(u * 140 + v * 90) * 0.0012 : 0;
      return [(u - 0.5) * W + Math.sin(v * 5 + ph[1]) * 0.003 + fray, T * e * (0.85 + nn), (0.5 - v) * D + Math.sin(u * 6 + ph[0]) * 0.003 + fray];
    };
    k.add(sheetGeo(16, 14, top), p, { uv: uvr });
    k.add(sheetGeo(8, 7, (u, v) => { const q = top(1 - u, v); return [q[0], 0.0004, q[2]]; }), p, { uv: uvr });
  };
  slab(0.16, 0.13, 0.014, 3, A.R(0, 0, 512, 448));
  k.push({ p: [0.004, 0.011, -0.004], r: [0, 0.16, 0] });
  slab(0.145, 0.115, 0.012, 7, A.R(30, 40, 440, 400));
  k.pop();
  // drooping corner flap over the front edge
  k.add(sheetGeo(6, 7, (u, v) => {
    const x = -0.02 + u * 0.06, a = v * 1.9;
    return [x + v * 0.006, 0.021 - (1 - Math.cos(a)) * 0.011 - v * 0.004, 0.05 + Math.sin(a) * 0.012 + v * 0.004];
  }), p, { uv: A.R(256, 224, 256, 224) });
  k.colBox([0.16, 0.026, 0.13], [0, 0.013, 0]);
  return { kit: k, meta: { mass: 0.08, material: 'soft', hold: { grip: [0.03, 0.01, 0.02], rot: [0.9, 0.3, 0.1], off: [0, 0.02, 0] }, restitution: 0.02, angularDamping: 0.9 } };
});

// ============================================================================ wire_spool
// Moulded plastic spool (flanges with rims, printed label, arbor hole) wound with enamelled copper wire
// (row ridges), loose end with a stripped tip taped down by a strip of tape.
def('wire_spool', () => {
  const A = atlas('wire_spool', 512, 512, (c) => {
    // flange label ring (0,0,290,290) planar
    rect(c, 0, 0, 290, 290, '#e8661c');
    c.fillStyle = '#f6f2e6'; c.beginPath(); c.arc(145, 145, 120, 0, TAU); c.fill();
    c.fillStyle = '#e8661c'; c.beginPath(); c.arc(145, 145, 44, 0, TAU); c.fill();
    txt(c, 'R.O.O.M.', 145, 54, { size: 28, color: INK, weight: '900' });
    txt(c, 'ELECTRIC', 145, 80, { size: 16, color: INK, fam: MONO, weight: '900' });
    txt(c, '14 AWG', 145, 214, { size: 24, color: '#b5160f', weight: '900' });
    txt(c, 'COPPER • 50 m', 145, 240, { size: 14, color: INK, fam: MONO, weight: 'bold' });
    roomIcon(c, 76, 145, 26, INK, null, 0.12); roomIcon(c, 214, 145, 26, INK, null, 0.12);
    wear(c, 0, 0, 290, 290, 4, 1.2, { edge: false });
    // orange plastic (300,0,200,100), tape (300,110,200,40)
    rect(c, 300, 0, 200, 100, '#e8661c'); mottle(c, 300, 0, 200, 100, 8, 2, 0.6); noise(c, 300, 0, 200, 100, 8, 2);
    rect(c, 300, 110, 200, 40, '#e8e4d6'); for (let x = 300; x < 500; x += 3) rect(c, x, 110, 1, 40, 'rgba(120,110,90,0.18)');
  }, { plain: '#e8661c' });
  const p = mat({ name: 'spool_plastic', map: A, rough: 0.42, det: 'stipple', ns: 0.5 });
  const cu = mat({ name: 'spool_copper', color: 0xe09060, metal: 1, rough: 0.3, det: 'coil', ns: 1.0 });
  const k = new Kit();
  const Rf = 0.05, Ri = 0.012, Rw = 0.0415, H = 0.06, tf = 0.006;
  const orange = A.R(300, 0, 200, 100);
  // spool body (flanges + barrel + arbor hole) — one closed profile
  k.lathe([[Ri, 0, 's'], [Rf - 0.0025, 0, 0.0015], [Rf, 0.0022, 0.0015], [Rf, tf - 0.0015, 0.0012], [Rf - 0.0025, tf, 's'], [Rw - 0.002, tf, 0.001], [Rw - 0.002, H - tf, 0.001], [Rf - 0.0025, H - tf, 's'], [Rf, H - tf + 0.0015, 0.0012], [Rf, H - 0.0022, 0.0015], [Rf - 0.0025, H, 0.0015], [Ri, H, 's'], [Ri, 0]], p, { seg: 48, uv: orange });
  // printed flange labels (both faces)
  for (const [y, s2] of [[H + 0.0002, 1], [-0.0002, -1]]) k.add(new THREE.RingGeometry(Ri + 0.0015, Rf - 0.004, 40, 1).rotateX(s2 > 0 ? -PI / 2 : PI / 2), p, { p: [0, y, 0], planar: { rect: A.R(0, 0, 290, 290), R: Rf - 0.003 } });
  // copper windings (slight barrel shape, ridged by the coil detail)
  k.lathe([[Rw, tf], [Rw + 0.0006, H / 2], [Rw, H - tf]], cu, { seg: 56, raw: true });
  // loose end: leaves the windings, loops over the flange, stripped tip
  k.tube([[Rw * 0.72, H - tf - 0.004, Rw * 0.69], [0.034, H - 0.002, 0.034], [0.045, H + 0.007, 0.03], [0.058, H + 0.006, 0.014], [0.064, H - 0.006, 0.0], [0.06, H - 0.022, -0.012]], 0.0009, cu, { tseg: 30, rseg: 6, col: 0xffd0b0 });
  // tape tab holding the wire
  k.add(sheetGeo(2, 3, (u, v) => { const a = 0.78 + (u - 0.5) * 0.3, rr = Rw + 0.0012; return [Math.sin(a) * rr, H - tf - 0.002 - v * 0.016, Math.cos(a) * rr]; }), p, { uv: A.R(300, 110, 200, 40) });
  k.colCyl(Rf, H, [0, H / 2, 0]);
  return { kit: k, meta: { mass: 0.6, material: 'plastic', hold: { grip: [Rf - 0.01, H / 2, 0], rot: [1.3, 0.1, 0.05], off: [0, 0.02, 0] } } };
});

// ============================================================================ pipe_short (galvanised 1" x 16" nipple)
// Hot-dip galvanised pipe with spangle, real helical NPT threads cut at both ends (bright steel), reamed
// bore, white-rust blooms and a corporate sticker.
def('pipe_short', () => {
  const A = atlas('pipe_short', 512, 512, (c) => {
    // galvanised wrap (0,0,512,400): u around (top x = 256), v along
    rect(c, 0, 0, 512, 400, '#a9adb0');
    const r = new RNG(6);
    for (let i = 0; i < 300; i++) {
      const x = r.range(0, 512), y = r.range(0, 400), s2 = r.range(6, 24);
      c.fillStyle = `rgba(${r.next() < 0.5 ? '232,234,236' : '118,122,126'},${r.range(0.1, 0.32)})`;
      c.beginPath(); c.moveTo(x, y - s2); c.lineTo(x + s2 * 0.8, y); c.lineTo(x, y + s2 * 0.7); c.lineTo(x - s2 * 0.9, y); c.fill();
    }
    noise(c, 0, 0, 512, 400, 14, 2);
    for (let i = 0; i < 14; i++) { const x = r.range(0, 512), y = r.range(0, 400); const g = rgrad(c, x, y, 0, r.range(10, 36), [[0, 'rgba(235,235,225,0.5)'], [1, 'rgba(235,235,225,0)']]); c.fillStyle = g; c.fillRect(x - 40, y - 40, 80, 80); }
    for (let i = 0; i < 8; i++) { const x = r.range(0, 512), y = r.range(0, 400); const g = rgrad(c, x, y, 0, r.range(8, 26), [[0, 'rgba(140,80,30,0.4)'], [1, 'rgba(140,80,30,0)']]); c.fillStyle = g; c.fillRect(x - 30, y - 30, 60, 60); }
    // sticker on top near one end
    rrect(c, 196, 60, 120, 150, 4, '#f6f3ea');
    txt(c, 'R.O.O.M.', 256, 84, { size: 20, color: INK, weight: '900' });
    txt(c, 'PLUMBING', 256, 104, { size: 13, color: INK, fam: MONO, weight: 'bold' });
    txt(c, '1" × 16"', 256, 132, { size: 22, color: '#2c5d8a', weight: '900' });
    txt(c, 'SCH 40 • GALV', 256, 154, { size: 11, color: INK, fam: MONO, weight: 'bold' });
    barcode(c, 206, 164, 100, 38, 14, false);
    wear(c, 196, 60, 120, 150, 3, 2.5);
    txt(c, 'MADE IN SUBLEVEL 9', 128, 260, { size: 18, color: 'rgba(40,40,40,0.45)', fam: MONO, weight: 'bold', rot: -PI / 2 });
    wear(c, 0, 0, 512, 400, 8, 1.5, { edge: false, dirt: 1.3 });
    // threads: bright cut steel with oil (0,404,256,100) + bore (260,404,120,100)
    rect(c, 0, 404, 256, 100, '#b8bcbe'); noise(c, 0, 404, 256, 100, 18, 3);
    rect(c, 260, 404, 120, 100, '#4a4c4e'); noise(c, 260, 404, 120, 100, 24, 5);
  }, { plain: '#a9adb0' });
  const galv = mat({ name: 'pipe_galv', map: A, rough: 0.42, metal: 0.9, det: 'cast', ns: 0.5 });
  const k = new Kit();
  const ro = 0.0167, ri = 0.0133, L = 0.4, tl = 0.022, pitch = 0.0022;
  // outer surface: threaded ends (helical via rmod), plain middle
  const prof = [[ri + 0.0012, 0, 's'], [ro - 0.0016, 0, 's']];
  for (let y = 0.0004; y < tl; y += pitch / 4) prof.push([ro - 0.0002, y]);
  prof.push([ro, tl + 0.002]);
  prof.push([ro, L - tl - 0.002]);
  for (let y = L - tl; y < L - 0.0004; y += pitch / 4) prof.push([ro - 0.0002, y]);
  prof.push([ro - 0.0016, L, 's'], [ri + 0.0012, L, 's']);
  const thr = (phi, y) => {
    const inT = y < tl ? sstep(tl, tl - 0.003, y) : y > L - tl ? sstep(L - tl, L - tl + 0.003, y) : 0;
    if (!inT) return 0;
    const f = ((y / pitch + phi / TAU) % 1 + 1) % 1;
    const taper = y < tl ? (tl - y) / tl : (y - (L - tl)) / tl; // NPT taper
    return -0.00065 * (1 - Math.abs(f * 2 - 1)) * inT - taper * 0.0005 * inT;
  };
  k.push({ r: [PI / 2, 0, 0], p: [0, 0, -L / 2] });
  k.lathe(prof, galv, {
    seg: 22, raw: true, rmod: (phi, y, r) => r + thr(phi, y), phi0: PI,
    vFromY: [0, L], uv: A.R(0, 0, 512, 400),
  });
  // reamed bore
  k.lathe([[ri + 0.0012, L], [ri, L - 0.0015, 0.0006], [ri, 0.0015, 0.0006], [ri + 0.0012, 0]], galv, { seg: 20, uv: A.R(260, 404, 120, 100) });
  k.pop();
  k.colCyl(ro, L, [0, 0, 0], [PI / 2, 0, 0]);
  return { kit: k, meta: { mass: 1.0, material: 'metal', hold: { grip: [0, 0, 0.13], rot: [0.75, 0.05, -0.2], off: [0, -0.02, 0] } } };
});

// ============================================================================ gear
// Machined spur gear (16 T): involute-style flanks with chamfered tips, hub bosses with a keyway and a
// socket set screw, five lightening holes, faced surfaces with turning marks, stamped markings, oily grime.
def('gear', () => {
  const A = atlas('gear', 512, 512, (c) => {
    rect(c, 0, 0, 400, 400, '#c2c6ca'); // machined 4140: metallic albedo = F0 (~0.55 linear)
    for (let rr = 4; rr < 200; rr += 2.2) { c.strokeStyle = `rgba(${rr % 4.4 < 2.2 ? '255,255,255' : '40,42,44'},${0.07 + (rr % 7) * 0.012})`; c.lineWidth = 1.3; c.beginPath(); c.arc(200, 200, rr, 0, TAU); c.stroke(); }
    noise(c, 0, 0, 400, 400, 12, 4);
    c.save(); c.translate(200, 200);
    const s = 'R.O.O.M. • 16T M7 • 4140 • ';
    for (let i = 0; i < s.length; i++) { c.save(); c.rotate((i / s.length) * TAU); txt(c, s[i], 0, -150, { size: 15, color: 'rgba(30,30,32,0.75)', fam: MONO, weight: '900' }); c.restore(); }
    c.restore();
    const g = rgrad(c, 200, 200, 60, 200, [[0, 'rgba(60,40,20,0)'], [1, 'rgba(60,40,20,0.3)']]);
    c.fillStyle = g; c.fillRect(0, 0, 400, 400);
    // flank / bore steel (0,404,400,90)
    rect(c, 0, 404, 400, 90, '#a8acb0');
    for (let x = 0; x < 400; x += 3) rect(c, x, 404, 1, 90, 'rgba(255,255,255,0.08)');
    noise(c, 0, 404, 400, 90, 14, 6);
  }, { plain: '#a8acb0' });
  const p = mat({ name: 'gear_steel', map: A, rough: 0.34, metal: 0.92, det: 'turned', ns: 0.35 });
  const k = new Kit();
  const N = 16, Rp = 0.0515, Ra = 0.0565, Rf = 0.0455, Th = 0.012;
  const sh = new THREE.Shape();
  let first = true;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * TAU, hw = PI / N;
    // root -> flank (curved) -> tip -> flank -> root
    const pts = [];
    for (let j = 0; j <= 4; j++) { const t = j / 4; const r = lerp(Rf, Ra, t); const a = a0 - hw * (0.58 - 0.26 * Math.pow(t, 1.4)); pts.push([r, a]); }
    for (let j = 4; j >= 0; j--) { const t = j / 4; const r = lerp(Rf, Ra, t); const a = a0 + hw * (0.58 - 0.26 * Math.pow(t, 1.4)); pts.push([r, a]); }
    pts.forEach(([r, a]) => { const x = Math.cos(a) * r, y = Math.sin(a) * r; if (first) { sh.moveTo(x, y); first = false; } else sh.lineTo(x, y); });
    const am = a0 + hw;
    sh.lineTo(Math.cos(am) * (Rf - 0.0008), Math.sin(am) * (Rf - 0.0008));
  }
  sh.closePath();
  const kw = 0.0028, rb = 0.0115, ak = Math.asin(kw / rb);
  const bore = new THREE.Path();
  bore.moveTo(Math.cos(ak) * rb, Math.sin(ak) * rb); bore.absarc(0, 0, rb, ak, TAU - ak, false); bore.lineTo(0.0148, -kw); bore.lineTo(0.0148, kw); bore.closePath();
  sh.holes.push(bore);
  for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU + 0.3; sh.holes.push(circlePath(Math.cos(a) * 0.031, Math.sin(a) * 0.031, 0.0085)); }
  const face = A.R(0, 0, 400, 400), flank = A.R(0, 404, 400, 90);
  const uvf = (q, n) => {
    if (Math.abs(n.z) > 0.6) return [face[0] + (q.x / 0.114 + 0.5) * (face[2] - face[0]), face[1] + (q.y / 0.114 + 0.5) * (face[3] - face[1])];
    const a = Math.atan2(q.y, q.x) / TAU + 0.5;
    return [flank[0] + a * (flank[2] - flank[0]), flank[1] + (q.z / (Th * 2) + 0.5) * (flank[3] - flank[1])];
  };
  k.push({ r: [-PI / 2, 0, 0] });
  k.add(extrudeGeo(sh, Th - 0.0016, 0.0008, { curveSegments: 7, bevelSegments: 1 }), p, { uvFn: uvf });
  for (const sz of [-1, 1]) {
    const hub = new THREE.Shape(); hub.absarc(0, 0, 0.021, 0, TAU, false);
    const hb = new THREE.Path(); hb.moveTo(Math.cos(ak) * rb, Math.sin(ak) * rb); hb.absarc(0, 0, rb, ak, TAU - ak, false); hb.lineTo(0.0148, -kw); hb.lineTo(0.0148, kw); hb.closePath();
    hub.holes.push(hb);
    k.add(extrudeGeo(hub, 0.0036, 0.0007, { curveSegments: 14, bevelSegments: 1 }), p, { p: [0, 0, sz * (Th / 2 + 0.0018)], uvFn: uvf });
  }
  k.pop();
  // socket set screw in the hub (radial, opposite the keyway)
  k.cyl(0.0032, 0.004, S.blackOxide(), { p: [-0.0198, Th / 2 + 0.0018, 0], r: [0, 0, PI / 2], seg: 10, bevel: 0.0004 });
  k.colCyl(Ra, Th, [0, 0, 0]);
  k.colCyl(0.021, Th + 0.0086, [0, 0, 0]); // hubs stand 4.3 mm proud of each face
  return { kit: k, meta: { mass: 0.7, material: 'metal', hold: { grip: [0.045, 0, 0.0], rot: [1.3, 0.1, 0.15], off: [0, 0.03, 0] } } };
});
