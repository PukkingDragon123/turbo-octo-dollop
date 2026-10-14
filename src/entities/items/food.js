// R.O.O.M. items — food & drink: wrapped bars, almond milk carton, almond water bottle, cans, mystery stew,
// chips, paper cup. Printed packaging is drawn as a flat "dieline" per item (what the printer would get).
import * as THREE from 'three';
import { Kit, def, PI, TAU, V3, sstep, clamp, lerp, hash, fillet, latheGeo, loftGeo, superSection, capRound, sheetGeo, extrudeGeo, polyGeo, roundedShape, rrectShape } from './core.js';
import { mat, clear, S } from './mats.js';
import { RNG } from '../../core/rng.js';
import {
  atlas, txt, para, rect, rrect, circle, line, noise, mottle, wear, edgeGrime, rubEdge, barcode, roomIcon, brand, lgrad, rgrad,
  almond, leaf, drawClone, nutrition, starburst, halftone, recycle, colorBar, regMark, warnTri,
  SANS, COND, MONO, SERIF, VT, INK, NAVY, ROOM_YELLOW,
} from './paint.js';

// ============================================================================ wrapped bars
// Flow-wrap film around a bar: pillow section, gathered pleats where the film is pulled into the crimped
// end seals (corrugated, pinked cut edge), longitudinal fin seal folded flat on the back.
// Dieline (512 x 512): x = along the bar (crimps at both ends, 40 px), y = around (0 = back centre, 256 = front centre).
function wrapperGeo(L, H, D, c) {
  const Lw = L + 2 * c, finT = 0.00055;
  let rowV = -1, sec = null, tb = 0, az = 0, z = 0;
  return sheetGeo(40, 36, (u, v) => {
    if (v !== rowV) {
      rowV = v;
      z = lerp(-Lw / 2, Lw / 2, v);
      az = Math.abs(z);
      tb = sstep(L / 2 - 0.011, L / 2 + 0.0015, az); // body -> fin
      sec = superSection(lerp(D / 2, D / 2 + 0.0016, tb), lerp(H / 2, finT, Math.pow(tb, 0.65)), lerp(5.2, 2.2, tb));
    }
    let [x, y] = sec(u);
    const up = y >= 0 ? 1 : -1;
    // pleats where the film gathers
    const pl = tb * (1 - tb) * 4;
    const ph = Math.sin(u * TAU * 6 + az * 260) + 0.5 * Math.sin(u * TAU * 11 - az * 410);
    y += pl * 0.0011 * ph * up;
    x += pl * 0.0006 * Math.cos(u * TAU * 5 + az * 300);
    let zz = z;
    if (v === 0 || v === 1) zz -= Math.sign(z) * 0.0011 * (1 - Math.abs(((x * 900) % 2 + 2) % 2 - 1));
    // back fin seal folded flat (slight ridge along the bottom centre)
    if (up < 0 && Math.abs(x) < 0.008) y -= 0.00035 * (1 - tb) * Math.exp(-Math.pow(x / 0.004, 2));
    return [x, y, zz];
  }, { wrapU: true });
}
function wrappedBar(name, dims, draw, meta) {
  def(name, () => {
    const [L, H, D] = dims, c = 0.011;
    // dieline bands (canvas y) from the real section: top face, near (+Z) side, far side, back halves
    const P = 2 * (D + H) - (8 - 2 * PI) * H * 0.18;
    const tw = Math.round((256 * D) / P), sw = Math.round((512 * H) / P);
    const bands = { top: [256 - tw, 256 + tw], near: [256 + tw, 256 + tw + sw], far: [256 - tw - sw, 256 - tw], backA: [256 + tw + sw, 512], backB: [0, 256 - tw - sw] };
    const A = atlas(name, 512, 512, (cx) => { draw(cx, bands); }, { plain: meta.plain || '#cccccc' });
    const film = mat({ name: name + '_film', map: A, rough: meta.rough ?? 0.3, metal: meta.metal ?? 0.28, det: 'film', ns: 0.55 });
    const k = new Kit();
    k.push({ r: [0, PI / 2, 0] }); // build along Z, length -> X
    k.add(wrapperGeo(L, H, D, c), film, { uv: A.R(0, 0, 512, 512, 1), dm: 0.09 });
    k.colBox([D + 0.002, H, L + 2 * c - 0.004]);
    k.pop();
    return { kit: k, meta: { mass: meta.mass, material: 'paper', hold: { grip: [0, 0, 0], rot: meta.rot || [1.15, 0.18, 0.12], off: [0, 0.02, 0] } } };
  });
}
function repeatText(c, s, x, y, w, h, o) {
  c.save(); c.font = `${o.weight || 'bold'} ${o.size}px ${o.fam || SANS}`;
  const tw = c.measureText(s).width; c.restore();
  for (let xx = x + 6; xx < x + w; xx += tw + 4) txt(c, s, xx, y + h / 2, { ...o, align: 'left' });
}
// common dieline furniture: crimp zones, side bands, back halves split by the fin seal
function dieline(c, B, o) {
  const X0 = 40, XW = 432;
  for (const x0 of [0, 472]) {
    rect(c, x0, 0, 40, 512, o.crimp);
    for (let y = 0; y < 512; y += 5) rect(c, x0, y, 40, 2, 'rgba(255,255,255,0.12)');
  }
  c.save(); c.beginPath(); c.rect(X0, 0, XW, 512); c.clip();
  rect(c, X0, 0, XW, 512, o.side);
  // sides
  for (const [k, [y0, y1]] of [['near', B.near], ['far', B.far]]) { c.save(); c.beginPath(); c.rect(X0, y0, XW, y1 - y0); c.clip(); o.sideArt(c, X0, y0, XW, y1 - y0, k === 'near'); c.restore(); }
  // back halves (fin seal at the canvas top / bottom edge)
  c.save(); c.beginPath(); c.rect(X0, B.backA[0], XW, B.backA[1] - B.backA[0]); c.clip(); o.backA(c, X0, B.backA[0], XW, B.backA[1] - B.backA[0]); c.restore();
  c.save(); c.beginPath(); c.rect(X0, B.backB[0], XW, B.backB[1] - B.backB[0]); c.clip(); o.backB(c, X0, B.backB[0], XW, B.backB[1] - B.backB[0]); c.restore();
  // front panel (bleeds 6 px onto the edges)
  c.save(); c.beginPath(); c.rect(X0, B.top[0] - 6, XW, B.top[1] - B.top[0] + 12); c.clip();
  o.front(c, X0, B.top[0] - 6, XW, B.top[1] - B.top[0] + 12);
  c.restore();
  rect(c, X0, 0, XW, 3, 'rgba(0,0,0,0.3)'); rect(c, X0, 509, XW, 3, 'rgba(0,0,0,0.3)');
  colorBar(c, 60, B.backB[1] - 10, 60, 6);
  c.restore();
  wear(c, X0, 0, XW, 512, o.seed || 31, 1.3, { edge: false, lightRatio: 0.8 });
}

wrappedBar('protein_bar', [0.118, 0.019, 0.044], (c, B) => {
  const NAVYB = '#252b3e', BEIGE = '#d6c49c';
  dieline(c, B, {
    crimp: '#2b3350', side: NAVYB, seed: 31,
    front: (c, x, y, w, h) => {
      rect(c, x, y, w, h, NAVYB);
      c.fillStyle = lgrad(c, x, y, x, y + h, [[0, 'rgba(255,255,255,0.1)'], [0.5, 'rgba(255,255,255,0)'], [1, 'rgba(0,0,0,0.25)']]); c.fillRect(x, y, w, h);
      const m = y + h * 0.8;
      c.fillStyle = BEIGE;
      c.beginPath(); c.moveTo(x, m); c.bezierCurveTo(x + 140, m - 22, x + 300, m + 20, x + w, m - 14); c.lineTo(x + w, y + h); c.lineTo(x, y + h); c.closePath(); c.fill();
      c.fillStyle = ROOM_YELLOW;
      c.beginPath(); c.moveTo(x, m - 8); c.bezierCurveTo(x + 140, m - 30, x + 300, m + 12, x + w, m - 22); c.lineTo(x + w, m - 14); c.bezierCurveTo(x + 300, m + 20, x + 140, m - 22, x, m); c.closePath(); c.fill();
      brand(c, x + 66, y + 22, 13, ROOM_YELLOW);
      txt(c, 'PROTEIN', x + 190, y + h * 0.42, { size: 62, color: ROOM_YELLOW, italic: true, weight: '900', maxW: 270, ls: -2, shadow: 'rgba(0,0,0,0.45)' });
      txt(c, '+', x + 342, y + h * 0.38, { size: 66, color: '#ff5a3a', weight: '900' });
      txt(c, 'CORPORATE RATION • FLAVOR: BEIGE', x + 190, y + h * 0.9, { size: 12, color: NAVYB, fam: MONO, weight: 'bold', maxW: 300 });
      starburst(c, x + 396, y + h * 0.72, 30, 14, '#c33a2a');
      txt(c, '31g', x + 396, y + h * 0.7, { size: 19, color: '#fff', weight: '900' });
      txt(c, 'PROTEIN', x + 396, y + h * 0.7 + 15, { size: 7, color: '#fff', fam: MONO, weight: 'bold' });
    },
    sideArt: (c, x, y, w, h, near) => {
      rect(c, x, y, w, h, NAVYB);
      repeatText(c, near ? 'PROTEIN+ • 31g PROTEIN • ' : 'NET WT 2.1 OZ (60 g) • ', x, y, w, h, { size: Math.min(13, h * 0.45), color: ROOM_YELLOW, fam: MONO, weight: 'bold' });
    },
    backA: (c, x, y, w, h) => {
      rect(c, x, y, w, h, BEIGE);
      nutrition(c, x + 14, y + 6, 150, [['Calories', '240', true], ['Protein', '31g', true], ['Beige', '100%'], ['Hope', '0g']], { size: 9, bg: '#efe6cf', h: h - 12 });
      txt(c, 'PROPERTY OF R.O.O.M.', x + 300, y + 16, { size: 13, color: NAVYB, weight: '900' });
      txt(c, 'DO NOT CONSUME IN DIMENSION 0', x + 300, y + 32, { size: 9, color: NAVYB, fam: MONO, weight: 'bold' });
      barcode(c, x + 210, y + 42, 120, Math.max(30, h - 50), 12);
      recycle(c, x + 380, y + h * 0.62, 22, NAVYB);
    },
    backB: (c, x, y, w, h) => {
      rect(c, x, y, w, h, BEIGE);
      para(c, 'INGREDIENTS: SOY PROTEIN ISOLATE, CORN SYRUP, BEIGE (COLOUR), OAT FIBRE, NATURAL & ARTIFICIAL FLAVOUR, ANTI-ANXIETY AGENT E-451.', x + 14, y + 8, 290, { size: 9, fam: MONO, color: NAVYB, lh: 11 });
      txt(c, 'Mfd. for R.O.O.M. Corp., Sublevel 4', x + 160, y + h - 24, { size: 9, color: NAVYB, fam: MONO });
      txt(c, 'BEST BEFORE: ∞   LOT 0451P', x + 160, y + h - 11, { size: 9, color: '#7a5a2a', fam: MONO, weight: 'bold' });
    },
  });
}, { mass: 0.06, plain: '#252b3e' });

wrappedBar('candy_bar', [0.112, 0.017, 0.032], (c, B) => {
  const CHOC = '#3a140a', GOLD = '#e8b21c', CREAM = '#f1e6c4';
  dieline(c, B, {
    crimp: '#4a1a0c', side: CHOC, seed: 33,
    front: (c, x, y, w, h) => {
      c.fillStyle = lgrad(c, x, y, x, y + h, [[0, '#6a2614'], [0.6, CHOC], [1, '#2a0c04']]); c.fillRect(x, y, w, h);
      const m = y + h * 0.7;
      c.fillStyle = GOLD;
      c.beginPath(); c.moveTo(x, m); c.bezierCurveTo(x + 150, m - 34, x + 330, m + 30, x + w, m - 20); c.lineTo(x + w, y + h); c.lineTo(x, y + h); c.closePath(); c.fill();
      c.fillStyle = '#5a2414';
      c.beginPath(); c.moveTo(x, m + 10);
      for (let i = 0; i <= 12; i++) { const xx = x + (i / 12) * w; c.lineTo(xx, m + 16 + Math.sin(i * 1.7) * 5 + (i % 3 === 0 ? 10 : 0)); }
      c.lineTo(x + w, y + h); c.lineTo(x, y + h); c.closePath(); c.fill();
      txt(c, 'NOUGAT', x + w / 2 - 30, y + h * 0.36, { size: 62, color: '#f6e6b0', weight: '900', italic: true, stroke: '#2a0c04', sw: 8, maxW: 300, ls: -1 });
      txt(c, 'NOIR', x + w / 2 + 150, y + h * 0.42, { size: 32, color: GOLD, weight: '900', italic: true, maxW: 120 });
      txt(c, 'nougat of uncertain origin', x + 150, y + h * 0.66, { size: 13, color: '#f6e6b0', fam: SERIF, weight: 'normal', italic: true, maxW: 240 });
      brand(c, x + 64, y + 18, 11, '#f6e6b0');
    },
    sideArt: (c, x, y, w, h, near) => {
      rect(c, x, y, w, h, near ? GOLD : CHOC);
      repeatText(c, near ? 'NOUGAT NOIR • 1.86 OZ • ' : 'R.O.O.M. CONFECTIONERY • ', x, y, w, h, { size: Math.min(12, h * 0.45), color: near ? CHOC : GOLD, fam: MONO, weight: 'bold' });
    },
    backA: (c, x, y, w, h) => {
      rect(c, x, y, w, h, CREAM);
      nutrition(c, x + 14, y + 5, 140, [['Calories', '250', true], ['Sugars', '27g'], ['Nougat', '???', true]], { size: 9, bg: '#fff', h: h - 10 });
      txt(c, 'PROPERTY OF R.O.O.M.', x + 290, y + 16, { size: 12, color: '#5a2414', weight: '900' });
      barcode(c, x + 200, y + 30, 110, Math.max(28, h - 36), 77);
      recycle(c, x + 370, y + h * 0.6, 20, '#5a2414');
    },
    backB: (c, x, y, w, h) => {
      rect(c, x, y, w, h, CREAM);
      para(c, 'INGREDIENTS: SUGAR, CHOCOLATE-TYPE COATING, NOUGAT (ORIGIN CLASSIFIED), PEANUTS?, SOY LECITHIN, ARTIFICIAL CALM.', x + 14, y + 8, 290, { size: 9, fam: MONO, color: CHOC, lh: 11 });
      txt(c, '1 BAR = 1 SHIFT', x + 370, y + h - 16, { size: 10, color: '#5a2414', fam: MONO, weight: 'bold' });
    },
  });
}, { mass: 0.055, plain: '#3a140a', metal: 0.38, rough: 0.26 });

// ============================================================================ almond_milk
// Half-pint gable-top carton: coated paperboard with creased, slightly rounded vertical edges and bowed
// panels, gable roof with inward-folded side gussets, sealed top fin with a date code, folded bottom.
def('almond_milk', () => {
  const PW = 256, PH = 350;
  const A = atlas('almond_milk', 1024, 512, (c) => {
    // FRONT (+Z)
    let x = 0;
    c.fillStyle = lgrad(c, 0, 0, 0, PH, [[0, '#5aa8de'], [0.5, '#c6e6f8'], [1, '#ffffff']]); c.fillRect(0, 0, PW, PH);
    c.fillStyle = '#ffffff';
    c.beginPath(); c.moveTo(0, 214); c.bezierCurveTo(70, 186, 170, 244, PW, 198); c.lineTo(PW, PH); c.lineTo(0, PH); c.fill();
    halftone(c, 0, 0, PW, 190, 'rgba(255,255,255,0.35)', 7, (u, v) => (1 - v) * 0.5 + u * 0.2);
    brand(c, PW / 2, 26, 16, NAVY);
    txt(c, 'ALMOND', PW / 2, 76, { size: 50, color: NAVY, weight: '900', maxW: 228, ls: -1 });
    txt(c, 'MILK', PW / 2, 126, { size: 64, color: '#ffffff', weight: '900', stroke: NAVY, sw: 9, maxW: 200 });
    leaf(c, 88, 222, 52, -2.4); leaf(c, 170, 216, 46, -0.7);
    almond(c, 108, 240, 60, -0.5); almond(c, 150, 244, 62, 0.45);
    rrect(c, 22, 272, 212, 22, 11, NAVY);
    txt(c, 'UNSWEETENED ORIGINAL', PW / 2, 283, { size: 12, color: '#fff', fam: MONO, weight: 'bold', maxW: 200 });
    txt(c, 'DAIRY-ADJACENT BEVERAGE', PW / 2, 306, { size: 12, color: NAVY, fam: MONO, weight: 'bold', maxW: 236 });
    txt(c, '1/2 PINT (8 FL OZ) 236 mL', PW / 2, 322, { size: 10, color: NAVY, fam: MONO, maxW: 236 });
    rect(c, 0, PH - 18, PW, 18, NAVY);
    txt(c, 'R.O.O.M. NUTRITION SERVICES', PW / 2, PH - 9, { size: 10, color: '#fff', fam: MONO, maxW: 236 });
    // RIGHT (+X): nutrition facts
    x = 256;
    rect(c, x, 0, PW, PH, '#ffffff');
    rect(c, x, 0, PW, 40, '#5aa8de');
    txt(c, 'PROPERTY OF R.O.O.M.', x + PW / 2, 20, { size: 18, color: '#fff', weight: '900', maxW: 230 });
    nutrition(c, x + 22, 52, 212, [['Serving size', '1 carton'], ['Calories', '35', true], ['Total Fat', '2.5 g'], ['Sodium', '170 mg'], ['Carbohydrate', '1 g'], ['Almonds', 'trace', false, true], ['Calcium', '45%'], ['Vitamin E', '50%'], ['Liminality', '12%', true]], { size: 12, h: 196 });
    txt(c, 'DO NOT CONSUME IN', x + PW / 2, 272, { size: 15, color: '#c0302a', weight: '900', maxW: 230 });
    txt(c, 'DIMENSION 0', x + PW / 2, 292, { size: 20, color: '#c0302a', weight: '900', maxW: 230 });
    para(c, 'Keep refrigerated, if refrigeration exists. Shake well. Then shake again.', x + 20, 308, 216, { size: 9, fam: MONO, color: '#333', align: 'center' });
    // BACK (-Z): missing employee
    x = 512;
    rect(c, x, 0, PW, PH, '#ffffff');
    rect(c, x, 0, PW, 56, '#c0302a');
    txt(c, 'HAVE YOU SEEN', x + PW / 2, 18, { size: 19, color: '#fff', weight: '900', maxW: 236 });
    txt(c, 'THIS EMPLOYEE?', x + PW / 2, 40, { size: 21, color: '#fff', weight: '900', maxW: 236 });
    rect(c, x + 58, 68, 140, 150, '#d9d4c4');
    c.save(); c.beginPath(); c.rect(x + 58, 68, 140, 150); c.clip(); drawClone(c, x + 128, 132, 92, { face: true }); c.restore();
    c.strokeStyle = '#111'; c.lineWidth = 2; c.strokeRect(x + 58, 68, 140, 150);
    halftone(c, x + 58, 68, 140, 150, 'rgba(0,0,0,0.18)', 4, () => 0.35);
    txt(c, 'CLONE #4471', x + PW / 2, 236, { size: 19, color: '#111', weight: '900' });
    ['Last seen: Level 0, near the', 'humming lights. Answers to', '"Hey you". Do not approach.', 'Report sightings: ext. 0000'].forEach((s, i) => txt(c, s, x + PW / 2, 258 + i * 17, { size: 11, color: '#222', fam: MONO, maxW: 236 }));
    rect(c, x, PH - 14, PW, 14, '#5aa8de');
    // LEFT (-X): barcode, dates, recycling
    x = 768;
    rect(c, x, 0, PW, PH, '#e9f5fc');
    almond(c, x + 70, 66, 70, -0.4); almond(c, x + 120, 72, 74, 0.3); leaf(c, x + 150, 56, 54, -0.6);
    txt(c, 'ALMOND MILK', x + PW / 2, 136, { size: 28, color: NAVY, weight: '900', maxW: 226 });
    txt(c, 'BEST BEFORE: ∞', x + PW / 2, 168, { size: 16, color: '#111', fam: MONO, weight: 'bold' });
    txt(c, 'LOT 0000-A  •  SUBLEVEL 2', x + PW / 2, 188, { size: 10, color: '#333', fam: MONO });
    barcode(c, x + 48, 204, 160, 78, 44);
    recycle(c, x + 60, 314, 30, NAVY);
    txt(c, 'PLEASE RECYCLE', x + 150, 308, { size: 11, color: NAVY, fam: MONO, weight: 'bold' });
    txt(c, 'THE CARTON', x + 150, 322, { size: 11, color: NAVY, fam: MONO, weight: 'bold' });
    // ROOF panels (front 0..256, back 256..512) at y 352..500
    c.fillStyle = lgrad(c, 0, 352, 0, 500, [[0, '#ffffff'], [1, '#7cbbe6']]); c.fillRect(0, 352, 256, 148);
    almond(c, 52, 428, 48, -0.4); almond(c, 204, 428, 48, 0.4);
    txt(c, 'ALMOND MILK', 128, 418, { size: 24, color: NAVY, weight: '900', maxW: 140 });
    txt(c, 'R.O.O.M.', 128, 446, { size: 14, color: NAVY, fam: MONO, weight: 'bold' });
    rect(c, 256, 352, 256, 148, '#ffffff');
    txt(c, '◄ OPEN HERE ►', 384, 404, { size: 20, color: NAVY, weight: '900', maxW: 230 });
    txt(c, 'PUSH BACK • PULL OUT', 384, 434, { size: 12, color: '#555', fam: MONO, weight: 'bold', maxW: 230 });
    // gusset triangles (512..768, 352..450) and the top fin (512..768, 452..492)
    rect(c, 512, 352, 256, 98, '#f2f9fe');
    colorBar(c, 600, 430, 80, 10);
    rect(c, 512, 452, 256, 40, '#5aa8de');
    txt(c, 'EXP ∞  0451  A3', 640, 472, { size: 16, color: '#fff', fam: MONO, weight: 'bold' });
    // bottom (768..896, 352..480)
    rect(c, 768, 352, 128, 128, '#dfe8ee');
    txt(c, '▲ 5', 832, 416, { size: 16, color: '#7a8a98', fam: MONO });
    // print wear: rubbed white board along the panel edges + grime
    for (let i = 0; i < 4; i++) rubEdge(c, i * 256, 0, 256, PH, '#f6f4ee', 61 + i, 'lr', 0.8);
    wear(c, 0, 0, 1024, 500, 61, 1.1, { edge: true, edgeK: 0.5, lightRatio: 0.25 });
  }, { plain: '#ffffff' });
  const card = mat({ name: 'milk_card', map: A, rough: 0.4, det: 'card', ns: 0.35 });
  const k = new Kit();
  const w = 0.07, hw = w / 2, h = 0.095, rh = 0.03, cr = 0.0028, bulge = 0.0011;
  // perimeter of the rounded square by arc length: front edge (+Z) going +X, then +X, back, -X sides
  const straight = w - 2 * cr, quarter = (PI / 2) * cr, P = 4 * (straight + quarter);
  const NS = 8, NC = 3;
  const sides = [[-hw + cr, hw, 1, 0], [hw, hw - cr, 0, -1], [hw - cr, -hw, -1, 0], [-hw, -hw + cr, 0, 1]];
  const centres = [[hw - cr, hw - cr], [hw - cr, -hw + cr], [-hw + cr, -hw + cr], [-hw + cr, hw - cr]];
  const perim = [];
  let sAcc = 0;
  for (let si = 0; si < 4; si++) {
    const [x0, z0, dx, dz] = sides[si];
    for (let i = 0; i < NS; i++) { const t = i / NS; perim.push({ x: x0 + dx * straight * t, z: z0 + dz * straight * t, s: sAcc + straight * t, panel: si, pu: t }); }
    sAcc += straight;
    const ex = x0 + dx * straight, ez = z0 + dz * straight;
    const [cxc, czc] = centres[si];
    const a0 = Math.atan2(ez - czc, ex - cxc);
    for (let i = 0; i < NC; i++) { const t = i / NC; const a = a0 - t * (PI / 2); perim.push({ x: cxc + Math.cos(a) * cr, z: czc + Math.sin(a) * cr, s: sAcc + quarter * t, panel: si, corner: true }); }
    sAcc += quarter;
  }
  perim.push({ ...perim[0], s: P });
  const nu = perim.length - 1, nv = 8;
  const body = sheetGeo(nu, nv, (u, v) => {
    const p = perim[Math.round(u * nu)];
    const y = v * h;
    const fy = Math.sin(v * PI) * (0.6 + 0.4 * sstep(0.0, 0.25, v));
    const b = p.corner ? 0 : bulge * Math.sin(p.pu * PI) * fy;
    const nrm = [[0, 1], [1, 0], [0, -1], [-1, 0]][p.panel];
    return [p.x + nrm[0] * b, y, p.z + nrm[1] * b];
  }, { wrapU: true });
  const RB = A.R(0, 0, 1024, PH);
  k.add(body, card, { uvFn: (pp, n, u, v) => { const U = perim[Math.round(u * nu)].s / P; return [RB[0] + U * (RB[2] - RB[0]), RB[1] + v * (RB[3] - RB[1])]; } });
  // bottom (folded flaps, slightly recessed)
  k.add(polyGeo([[-hw + 0.001, 0.0012, -hw + 0.001], [hw - 0.001, 0.0012, -hw + 0.001], [hw - 0.001, 0.0012, hw - 0.001], [-hw + 0.001, 0.0012, hw - 0.001]], [[0, 0], [1, 0], [1, 1], [0, 1]]).rotateX(0), card, { uv: A.R(768, 352, 128, 128), col: 0xe8eef2 });
  // gable roof: front & back panels (slight bow), gussets folded in, fin
  const roofUV = [A.R(0, 352, 256, 148), A.R(256, 352, 256, 148)];
  for (const [si, sz] of [[0, 1], [1, -1]]) {
    const g = sheetGeo(6, 4, (u, v) => {
      const x = (u - 0.5) * w * (sz > 0 ? 1 : -1);
      const y = h + v * rh, z = sz * hw * (1 - v) + sz * 0.0009 * Math.sin(u * PI) * Math.sin(v * PI);
      return [x, y, z];
    });
    k.add(g, card, { uv: roofUV[si] });
  }
  const gu = A.R(512, 352, 256, 98);
  const inset = 0.0075;
  for (const sx of [-1, 1]) {
    const xs = sx * hw;
    const Afr = [xs, h, hw], Bbk = [xs, h, -hw], M = [xs, h, 0], C = [xs - sx * inset, h + rh * 0.96, 0];
    const t1 = sx > 0 ? [Afr, M, C] : [M, Afr, C], t2 = sx > 0 ? [M, Bbk, C] : [Bbk, M, C];
    k.add(polyGeo(t1, [[gu[0], gu[1]], [(gu[0] + gu[2]) / 2, gu[1]], [(gu[0] + gu[2]) / 2, gu[3]]]), card, { keepUV: true, col: 0xeef2f4 });
    k.add(polyGeo(t2, [[(gu[0] + gu[2]) / 2, gu[1]], [gu[2], gu[1]], [(gu[0] + gu[2]) / 2, gu[3]]]), card, { keepUV: true, col: 0xeef2f4 });
  }
  k.rbox(w + 0.0008, 0.0122, 0.0034, 0.0012, card, { p: [0, h + rh + 0.0055, 0], rs: 2, faces: { pz: A.R(512, 452, 256, 40), nz: A.R(512, 452, 256, 40, 4), py: A.R(512, 452, 256, 8), px: A.R(512, 452, 20, 40), nx: A.R(512, 452, 20, 40) } });
  k.colBox([w, h, w], [0, h / 2, 0]);
  k.colBox([w, 0.03, 0.036], [0, h + 0.018, 0]);
  return { kit: k, meta: { mass: 0.25, material: 'cardboard', hold: { grip: [0, 0.05, 0], rot: [0.12, -0.35, 0.04], off: [0, 0.02, 0] } } };
});

// ============================================================================ almond_water
// 500 mL PET bottle: petaloid-free flat base with a push-up, grip rings, recessed label panel, fluted
// shoulder, neck support ring, threads; printed film label with a glued overlap; ribbed screw cap with a
// tamper band; milky almond water with a meniscus and air gap.
def('almond_water', () => {
  const A = atlas('almond_water', 1024, 512, (c) => {
    // label wrap (0,0,1024,256): u around (front at x = 512), v up
    c.fillStyle = lgrad(c, 0, 0, 0, 256, [[0, '#3274c4'], [0.6, '#1f56a2'], [1, '#173f7a']]); c.fillRect(0, 0, 1024, 256);
    c.fillStyle = 'rgba(255,255,255,0.13)';
    for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(0, 190 + i * 14); for (let x = 0; x <= 1024; x += 16) c.lineTo(x, 190 + i * 14 + Math.sin(x / 70 + i) * 8); c.lineTo(1024, 256); c.lineTo(0, 256); c.fill(); }
    halftone(c, 0, 0, 1024, 150, 'rgba(255,255,255,0.08)', 8, (u, v) => (1 - v) * 0.6);
    rect(c, 0, 0, 1024, 8, '#e8eef6'); rect(c, 0, 248, 1024, 8, '#e8eef6');
    almond(c, 392, 106, 74, -0.5); leaf(c, 412, 64, 40, -0.9, '#7ab84a');
    txt(c, 'Almond', 548, 90, { size: 80, color: '#ffffff', fam: SERIF, weight: 'bold', italic: true, maxW: 250, shadow: 'rgba(0,20,60,0.4)' });
    txt(c, 'Water', 570, 160, { size: 70, color: '#ffffff', fam: SERIF, weight: 'bold', italic: true, maxW: 220, shadow: 'rgba(0,20,60,0.4)' });
    txt(c, 'R.O.O.M. HYDRATION DIVISION', 512, 214, { size: 16, color: '#cfe0f6', fam: MONO, weight: 'bold', maxW: 330 });
    starburst(c, 760, 64, 40, 16, '#f2c418');
    txt(c, 'RESTORES', 760, 58, { size: 11, color: '#173f7a', weight: '900' });
    txt(c, 'SANITY*', 760, 72, { size: 12, color: '#173f7a', weight: '900' });
    txt(c, '*not a medical claim', 812, 118, { size: 11, color: '#cfe0f6', fam: MONO });
    txt(c, '500 mL • 16.9 FL OZ', 812, 142, { size: 14, color: '#fff', fam: MONO, weight: 'bold' });
    // back of the label
    barcode(c, 110, 50, 150, 70, 5);
    txt(c, 'PROPERTY OF R.O.O.M.', 185, 142, { size: 15, color: '#fff', weight: '900', maxW: 230 });
    txt(c, 'Do not consume in Dimension 0', 185, 162, { size: 11, color: '#cfe0f6', fam: MONO, maxW: 230 });
    nutrition(c, 920, 26, 96, [['Calories', '0', true], ['Sodium', '5mg'], ['Almond', '?']], { size: 9, h: 90 });
    recycle(c, 300, 92, 26, '#cfe0f6');
    txt(c, 'PET 1', 300, 118, { size: 10, color: '#cfe0f6', fam: MONO, weight: 'bold' });
    // glue overlap strip at the seam
    rect(c, 1010, 0, 14, 256, 'rgba(255,255,255,0.18)');
    wear(c, 0, 0, 1024, 256, 3, 0.9, { edge: false, lightRatio: 0.8 });
    // cap (0,264,512,90) ribs + top disc (520,264,120,120)
    rect(c, 0, 264, 512, 90, '#2a5aa8');
    for (let x = 0; x < 512; x += 6) rect(c, x, 264, 3, 70, 'rgba(255,255,255,0.12)');
    rect(c, 0, 336, 512, 18, '#24508f');
    for (let x = 0; x < 512; x += 16) rect(c, x, 338, 8, 14, '#1b3e70');
    rect(c, 520, 264, 120, 120, '#2a5aa8');
    roomIcon(c, 580, 324, 50, '#cfe0f6', null, 0.1);
    txt(c, 'R.O.O.M.', 580, 362, { size: 11, color: '#cfe0f6', fam: MONO, weight: 'bold' });
  }, { plain: '#2a5aa8' });
  const label = mat({ name: 'almondwater_label', map: A, rough: 0.32, det: 'gloss', ns: 0.25 });
  const pet = clear({ name: 'item_pet', rough: 0.06, env: 1.5 });
  const liquid = mat({ name: 'almondwater_liquid', color: 0xe6dcc2, rough: 0.12, vc: false, physical: true, specular: 0.6 });
  const k = new Kit();
  const R = 0.032;
  // PET shell profile (outer)
  const shell = [[0, 0.0042], [0.0175, 0.0014, 0.003], [0.0285, 0.0, 0.003], [R, 0.006, 0.004], [R, 0.022], [R - 0.0016, 0.0255, 0.0012], [R, 0.029, 0.0012], [R, 0.033], [R - 0.0016, 0.0365, 0.0012], [R, 0.04, 0.0012], [R, 0.142], [R - 0.0016, 0.1455, 0.0012], [R, 0.149, 0.0012], [R, 0.152, 0.002], [0.0298, 0.166, 0.006], [0.0226, 0.181, 0.006], [0.0152, 0.1905, 0.003], [0.0138, 0.1915], [0.0138, 0.1925, 's'], [0.0178, 0.193, 0.0004], [0.0178, 0.1945, 0.0004], [0.0136, 0.195, 's'], [0.0134, 0.2]]; // neck finish ends inside the cap
  k.lathe(shell, pet, { seg: 32, rseg: 0.0025, rmod: (phi, y, r) => r - (y > 0.153 && y < 0.186 ? 0.0011 * sstep(0.153, 0.162, y) * (1 - sstep(0.178, 0.186, y)) * Math.pow(0.5 + 0.5 * Math.cos(phi * 8), 2) : 0) });
  // liquid (fill ~86%) with meniscus
  const fy = 0.168;
  k.lathe([[0, 0.0052], [0.0118, 0.0044], [0.018, 0.0021, 0.002], [0.0278, 0.0012, 0.003], [R - 0.0012, 0.0066, 0.003], [R - 0.0012, 0.022], [R - 0.0026, 0.0255, 0.001], [R - 0.0012, 0.029], [R - 0.0012, 0.033], [R - 0.0026, 0.0365, 0.001], [R - 0.0012, 0.04], [R - 0.0012, 0.142], [R - 0.0026, 0.1455], [R - 0.0012, 0.149], [R - 0.0012, 0.152], [0.0284, 0.1655], [0.0276, fy + 0.0012, 0.0008], [0.026, fy, 0.0015], [0, fy - 0.0004]], liquid, { seg: 24, rseg: 0.0025 });
  // printed film label in the recessed panel (with the overlap step)
  k.lathe([[R + 0.00045, 0.0412], [R + 0.00045, 0.1408]], label, { seg: 48, vFromY: [0.0412, 0.1408], uv: A.R(0, 0, 1024, 256), rmod: (phi, y, r) => r + (phi > TAU * 0.985 ? 0.00025 : 0), phi0: PI });
  // neck threads (2 turns)
  k.add(new THREE.TubeGeometry(new (class extends THREE.Curve { getPoint(t, o = V3()) { const a = t * TAU * 2.2; return o.set(Math.cos(a) * 0.01375, 0.1965 + t * 0.0065, Math.sin(a) * 0.01375); } })(), 32, 0.00055, 4, false), pet, {});
  // cap: ribbed skirt, top with logo, tamper band with bridges
  k.lathe([[0.0153, 0.1952], [0.0158, 0.1958, 0.0004], [0.0158, 0.2078], [0.0151, 0.2088, 0.0008], [0.0141, 0.2092]], label, {
    seg: 32, vFromY: [0.1952, 0.2092], uv: A.R(0, 264, 512, 70),
  });
  k.lathe([[0.0141, 0.2092], [0.008, 0.2094], [0, 0.2095]], label, { seg: 32, planar: { rect: A.R(520, 264, 120, 120), R: 0.0142 } });
  k.lathe([[0.0151, 0.1918], [0.0154, 0.1922, 0.0003], [0.0154, 0.1945], [0.0149, 0.1949]], label, { seg: 28, vFromY: [0.1918, 0.1949], uv: A.R(0, 336, 512, 18) });
  k.colCyl(R, 0.1925, [0, 0.0962, 0]);
  k.colCyl(0.0158, 0.017, [0, 0.201, 0]);
  return { kit: k, meta: { mass: 0.52, material: 'plastic', hold: { grip: [0, 0.09, 0], rot: [0.1, -0.15, 0.06], off: [0, 0.035, 0] } } };
});

// ============================================================================ beverage cans
// Two-piece aluminium can: domed base with stand ring, printed body, necked shoulder, double seam,
// countersunk lid with embossed ring text, score line, rivet and a stay-on tab with finger hole.
function canLid(c, x0, y0, s, txtRing, seed) {
  // lid art (planar), centre x0+s/2: brushed alu, emboss ring text, score teardrop
  rect(c, x0, y0, s, s, '#c8ccd0');
  const cx = x0 + s / 2, cy = y0 + s / 2;
  for (let r = 4; r < s / 2; r += 1.5) { c.strokeStyle = `rgba(${r % 3 < 1.5 ? '255,255,255' : '90,94,98'},0.12)`; c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.stroke(); }
  c.save(); c.translate(cx, cy);
  const t = txtRing;
  for (let i = 0; i < t.length; i++) { c.save(); c.rotate((i / t.length) * TAU - PI / 2 + PI); txt(c, t[i], 0, -s * 0.36, { size: s * 0.05, color: 'rgba(60,64,70,0.75)', fam: MONO, weight: 'bold' }); c.restore(); }
  c.restore();
  // score line around the opening (toward -Z = canvas up)
  c.strokeStyle = 'rgba(50,54,58,0.7)'; c.lineWidth = s * 0.008;
  c.beginPath(); c.ellipse(cx, cy + s * 0.2, s * 0.12, s * 0.15, 0, 0, TAU); c.stroke();
  txt(c, 'R', cx + s * 0.28, cy + s * 0.05, { size: s * 0.06, color: 'rgba(60,64,70,0.6)', fam: MONO });
  noise(c, x0, y0, s, s, 10, seed);
}
function beverageCan(name, R, H, draw, meta) {
  def(name, () => {
    const LH = 448;
    const A = atlas(name, 1024, 512, (c) => {
      const sy = meta.sy || 1;
      c.save(); c.scale(1, sy);
      c.beginPath(); c.rect(0, 0, 1024, LH / sy); c.clip();
      draw(c, 1024, LH / sy);
      c.restore();
      // lid (0,452,60,60 small) & tab swatch at (64,452)
      canLid(c, 448, 452, 60, meta.lidText || 'R.O.O.M. • RECYCLE ME • 5¢ CA ', 4);
      rect(c, 512, 452, 60, 60, '#d4d8dc');
      noise(c, 512, 452, 60, 60, 12, 6);
      wear(c, 0, 0, 1024, LH, 13, 0.9, { edge: false, lightRatio: 0.85 });
      // scuffs near the bottom where the can is set down
      const g = lgrad(c, 0, LH - 24, 0, LH, [[0, 'rgba(255,255,255,0)'], [1, 'rgba(230,230,230,0.35)']]);
      c.fillStyle = g; c.fillRect(0, LH - 24, 1024, 24);
    }, { plain: '#d8dcdf' });
    const label = mat({ name: name + '_print', map: A, rough: 0.26, metal: 0.55, det: 'polished', ns: 0.2 });
    const alu = mat({ name: name + '_alu', map: A, rough: 0.24, metal: 1, det: 'brushed', ns: 0.3 });
    const k = new Kit();
    const yb = 0.0095, yt = H - 0.0145; // printed body range
    // base: dome + stand ring + lower taper
    k.lathe([[0, 0.0108], [R * 0.5, 0.0088, 0.004], [R * 0.66, 0.0042, 0.002], [R * 0.74, 0.0006, 0.0012], [R * 0.81, 0, 0.0012], [R * 0.88, 0.0012, 0.0015], [R * 0.97, 0.0062, 0.003], [R, yb, 0.002]], alu, { seg: 40, uv: A.R(512, 452, 60, 60) });
    // printed wall
    k.lathe([[R, yb], [R, yt]], label, { seg: 48, vFromY: [yb, yt], uv: A.R(0, 0, 1024, LH), phi0: PI });
    // neck + double seam + lid
    k.lathe([[R, yt], [R * 0.975, H - 0.0105, 0.004], [R * 0.9, H - 0.0045, 0.003], [R * 0.872, H - 0.0022, 0.0012], [R * 0.878, H - 0.0004, 0.0008], [R * 0.866, H + 0.0004, 0.0005], [R * 0.852, H - 0.0008, 's'], [R * 0.842, H - 0.004, 0.0006], [R * 0.79, H - 0.0047, 0.0008], [R * 0.76, H - 0.0036, 0.0006], [0, H - 0.0036]], alu, { seg: 48, capUV: { rect: A.R(448, 452, 60, 60), R: R * 0.8, t: 0.85 }, uv: A.R(512, 452, 60, 60) });
    // rivet
    k.lathe([[0.0026, H - 0.0036], [0.0022, H - 0.0026, 0.0006], [0, H - 0.0024]], alu, { seg: 14, uv: A.R(512, 452, 60, 60) });
    // stay-on tab: outline with finger hole + rivet hole, slightly bent up at the finger end
    const tw = 0.0062, tl = 0.0122;
    const ts = roundedShape([[-tw, -0.0045, 0.002], [tw, -0.0045, 0.002], [tw * 0.92, tl, 0.0042], [-tw * 0.92, tl, 0.0042]], 0, { step: 0.4 });
    const fh = new THREE.Path(); fh.absellipse(0, 0.0068, 0.0041, 0.0033, 0, TAU, true); ts.holes.push(fh);
    const rh = new THREE.Path(); rh.absarc(0, -0.0012, 0.0011, 0, TAU, true); ts.holes.push(rh);
    k.add(extrudeGeo(ts, 0.0004, 0.00022, { bevelSegments: 1, curveSegments: 8 }), alu, {
      p: [0, H - 0.0022, -0.0012], r: [-PI / 2, 0, 0],
      deform: (v) => { if (v.y > 0.004) v.z += (v.y - 0.004) * 0.12; },
      uv: A.R(512, 452, 60, 60), col: 0xd8dce0,
    });
    k.colCyl(R, H, [0, H / 2, 0]);
    return { kit: k, meta: { mass: meta.mass, material: 'metal', hold: { grip: [0, H * 0.45, 0], rot: [0.1, -0.25, 0.05], off: [0, 0.012, 0] } } };
  });
}

beverageCan('soda_can', 0.033, 0.1225, (c, W, H) => {
  rect(c, 0, 0, W, H, '#c41f26');
  c.fillStyle = lgrad(c, 0, 0, 0, H, [[0, 'rgba(255,255,255,0.08)'], [0.5, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.18)']]); c.fillRect(0, 0, W, H);
  // ribbon
  c.fillStyle = '#fff';
  c.beginPath(); c.moveTo(0, 300); for (let x = 0; x <= W; x += 16) c.lineTo(x, 300 + Math.sin((x / W) * TAU * 2) * 40); for (let x = W; x >= 0; x -= 16) c.lineTo(x, 330 + Math.sin((x / W) * TAU * 2 + 0.4) * 40); c.fill();
  c.fillStyle = '#ffd34a';
  c.beginPath(); c.moveTo(0, 334); for (let x = 0; x <= W; x += 16) c.lineTo(x, 334 + Math.sin((x / W) * TAU * 2 + 0.4) * 40); for (let x = W; x >= 0; x -= 16) c.lineTo(x, 342 + Math.sin((x / W) * TAU * 2 + 0.5) * 40); c.fill();
  // bubbles
  const r = new RNG(9);
  for (let i = 0; i < 46; i++) { const x = r.next() * W, y = 30 + r.next() * 230, rr = 2 + r.next() * 7; circle(c, x, y, rr, null, 'rgba(255,255,255,0.35)', 1.5); c.fillStyle = 'rgba(255,255,255,0.4)'; c.beginPath(); c.arc(x - rr * 0.3, y - rr * 0.3, rr * 0.25, 0, TAU); c.fill(); }
  roomIcon(c, 512, 62, 56, '#fff', null, 0.1);
  txt(c, 'R.O.O.M.', 512, 152, { size: 100, color: '#fff', weight: '900', italic: true, maxW: 280, stroke: '#7a0c10', sw: 6, ls: -2 });
  txt(c, 'COLA', 512, 234, { size: 60, color: '#ffe9c0', weight: '900', ls: 18, maxW: 240 });
  txt(c, 'CLASSIC TASTE OF NORMALCY', 512, 400, { size: 20, color: '#fff', fam: MONO, weight: 'bold', maxW: 300 });
  // back
  txt(c, 'PROPERTY OF R.O.O.M.', 110, 70, { size: 20, color: '#fff', weight: '900', maxW: 190 });
  txt(c, 'Do not consume in', 110, 96, { size: 14, color: '#ffd9d9', fam: MONO, maxW: 190 });
  txt(c, 'Dimension 0', 110, 114, { size: 14, color: '#ffd9d9', fam: MONO, maxW: 190 });
  nutrition(c, 30, 140, 160, [['Calories', '140', true], ['Sodium', '45mg'], ['Sugars', '39g'], ['Caffeine', '34mg'], ['Nostalgia', '110%', true]], { size: 11, h: 118 });
  barcode(c, 880, 50, 110, 80, 9);
  txt(c, '12 FL OZ', 935, 168, { size: 22, color: '#fff', weight: '900' });
  txt(c, '355 mL', 935, 192, { size: 16, color: '#fff', fam: MONO, weight: 'bold' });
  recycle(c, 935, 240, 30, '#fff');
}, { mass: 0.37, lidText: 'R.O.O.M. COLA • RECYCLE • CA CASH REFUND • ' });

beverageCan('energy_drink', 0.0332, 0.168, (c, W, H) => {
  // virtual canvas 1024 x 705 (squashed onto the 448 px label so the art keeps its proportions)
  rect(c, 0, 0, W, H, '#0d0f10');
  noise(c, 0, 0, W, H, 10, 4);
  halftone(c, 0, 0, W, H, 'rgba(125,255,58,0.12)', 10, (u, v) => Math.max(0, Math.sin(u * TAU * 2) * 0.5 + 0.5 - v * 0.4));
  c.fillStyle = '#7dff3a';
  for (let i = 0; i < 3; i++) { const x0 = 400 + i * 80; c.beginPath(); c.moveTo(x0, 50); c.quadraticCurveTo(x0 + 66, 280, x0 + 8, 560); c.lineTo(x0 + 24, 560); c.quadraticCurveTo(x0 + 92, 270, x0 + 22, 50); c.fill(); }
  txt(c, 'KINETIC', 512, 300, { size: 150, color: '#7dff3a', weight: '900', italic: true, maxW: 360, stroke: '#0d0f10', sw: 14, rot: -0.08 });
  txt(c, 'ENERGY+', 540, 430, { size: 72, color: '#ffffff', weight: '900', italic: true, maxW: 260, stroke: '#0d0f10', sw: 10 });
  txt(c, 'MANDATORY ALERTNESS FORMULA', 512, 540, { size: 24, color: '#7dff3a', fam: MONO, weight: 'bold', maxW: 330 });
  brand(c, 512, 620, 30, '#ffffff');
  txt(c, 'CAFFEINE: YES', 120, 110, { size: 28, color: '#7dff3a', weight: '900', maxW: 200 });
  txt(c, 'SLEEP: NO', 120, 146, { size: 24, color: '#fff', weight: '900', maxW: 200 });
  ['Not recommended for', 'children, pregnant', 'women, or entities', 'sensitive to time.', '', 'PROPERTY OF R.O.O.M.', 'Do not consume in', 'Dimension 0.'].forEach((s2, i) => txt(c, s2, 120, 210 + i * 30, { size: 18, color: '#cfd8cf', fam: MONO, maxW: 200 }));
  barcode(c, 860, 100, 130, 120, 21);
  txt(c, '16 FL OZ', 925, 280, { size: 30, color: '#fff', weight: '900' });
  txt(c, '473 mL', 925, 316, { size: 22, color: '#7dff3a', fam: MONO, weight: 'bold' });
  warnTri(c, 925, 420, 56, '#7dff3a', '#0d0f10');
}, { mass: 0.5, sy: 0.635, lidText: 'KINETIC • STAY ALERT • RECYCLE • ' });

// ============================================================================ canned_food
// 15 oz tinplate can with a paper label: rolled double seams, beading above/below the label, lid with
// expansion rings and a lot code, glued label seam, torn & curling label corner exposing the tin, a dent.
def('canned_food', () => {
  const R = 0.0425, H = 0.11, y0 = 0.0155, y1 = 0.0945; // label range
  const A = atlas('canned_food', 1024, 512, (c) => {
    const W = 1024, LH = 400;
    rect(c, 0, 0, W, LH, '#efe2bf');
    mottle(c, 0, 0, W, LH, 12, 6, 0.8);
    noise(c, 0, 0, W, LH, 10, 6);
    rect(c, 0, 0, W, 64, '#7c1d1a'); rect(c, 0, LH - 56, W, 56, '#7c1d1a');
    rect(c, 0, 64, W, 6, '#d6a734'); rect(c, 0, LH - 62, W, 6, '#d6a734');
    txt(c, 'R.O.O.M. PROVISIONS', 512, 33, { size: 28, color: '#efe2bf', fam: MONO, weight: 'bold', ls: 4, maxW: 600 });
    txt(c, 'MYSTERY', 512, 116, { size: 70, color: '#7c1d1a', weight: '900', maxW: 300, ls: -1 });
    txt(c, 'STEW', 512, 176, { size: 64, color: '#7c1d1a', weight: '900', ls: 12, maxW: 230 });
    // bowl illustration with halftone shading
    const bx = 512, by = 256;
    c.fillStyle = '#5b3418'; c.beginPath(); c.ellipse(bx, by, 80, 20, 0, 0, TAU); c.fill();
    c.fillStyle = '#9c5a2a'; c.beginPath(); c.ellipse(bx, by - 3, 72, 15, 0, 0, TAU); c.fill();
    const rr = new RNG(3);
    for (let i = 0; i < 12; i++) { c.fillStyle = ['#c8752f', '#6b8e3a', '#e0b050', '#b04a30'][i % 4]; c.beginPath(); c.arc(bx - 56 + rr.next() * 112, by - 7 + rr.next() * 8, 5 + rr.next() * 3, 0, TAU); c.fill(); }
    c.fillStyle = '#e8e2d2'; c.beginPath(); c.moveTo(bx - 82, by + 2); c.quadraticCurveTo(bx, by + 82, bx + 82, by + 2); c.fill();
    halftone(c, bx - 82, by, 164, 50, 'rgba(120,110,100,0.35)', 5, (u, v) => v * 0.8 + Math.abs(u - 0.5) * 0.6);
    c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 4;
    for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(bx - 26 + i * 26, by - 22); c.bezierCurveTo(bx - 38 + i * 26, by - 36, bx - 14 + i * 26, by - 44, bx - 26 + i * 26, by - 58); c.stroke(); }
    txt(c, '?', bx + 94, by - 36, { size: 56, color: '#7c1d1a', weight: '900', rot: 0.25 });
    txt(c, '?', bx - 98, by - 28, { size: 40, color: '#7c1d1a', weight: '900', rot: -0.3, alpha: 0.7 });
    txt(c, 'SERVING SUGGESTION', bx, by + 54, { size: 10, color: '#3a2a1a', fam: MONO });
    starburst(c, 760, 220, 52, 14, '#d6a734');
    txt(c, 'CONTENTS:', 760, 210, { size: 13, color: '#3a2a1a', fam: MONO, weight: 'bold' });
    txt(c, 'YES', 760, 234, { size: 26, color: '#7c1d1a', weight: '900' });
    roomIcon(c, 264, 214, 54, '#7c1d1a', null, 0.1);
    txt(c, 'EST. 19██', 264, 262, { size: 13, color: '#3a2a1a', fam: MONO, weight: 'bold' });
    txt(c, 'NET WT 15 OZ (425 g)', 512, LH - 28, { size: 20, color: '#efe2bf', fam: MONO, weight: 'bold', maxW: 400 });
    // back panel
    nutrition(c, 24, 84, 210, [['Serving', '1 cup'], ['Calories', '310', true], ['Fat', '14g'], ['Sodium', '980mg'], ['Protein', '19g'], ['Mystery', '100%', true]], { size: 12, h: 150, bg: '#f6eed6' });
    para(c, 'INGREDIENTS: WATER, MEAT-LIKE PROTEIN, VEGETABLES (ASSORTED), GRAVY, SALT, ????, ¿¿¿¿. HEAT BEFORE EATING (OPTIONAL).', 24, 244, 214, { size: 10, fam: MONO, color: '#3a2a1a', lh: 12 });
    txt(c, 'PROPERTY OF R.O.O.M.', 130, 316, { size: 13, color: '#7c1d1a', weight: '900' });
    barcode(c, 860, 96, 140, 80, 31);
    recycle(c, 930, 230, 34, '#7c1d1a');
    // torn region near the seam (u ~ 0.03): bare tin
    c.fillStyle = '#b4b8bc';
    c.beginPath(); c.moveTo(0, 190); c.lineTo(46, 204); c.lineTo(30, 232); c.lineTo(62, 262); c.lineTo(36, 296); c.lineTo(56, 322); c.lineTo(0, 330); c.fill();
    c.strokeStyle = '#f2ead0'; c.lineWidth = 3; c.stroke();
    // glue seam strip
    rect(c, 1008, 0, 16, LH, 'rgba(160,140,80,0.25)');
    wear(c, 0, 0, W, LH, 41, 1.7, { edge: true, edgeK: 0.9, dirt: 1.4 });
    // lid (0,404,100,100): lot code
    rect(c, 0, 404, 100, 100, '#c4c8cc');
    noise(c, 0, 404, 100, 100, 14, 5);
    txt(c, 'L0 0451', 50, 446, { size: 11, color: '#3a3a3a', fam: MONO, weight: 'bold' });
    txt(c, '24 1997', 50, 462, { size: 10, color: '#3a3a3a', fam: MONO });
    // tin swatch (110,404,100,100) with faint rust spots
    rect(c, 110, 404, 100, 100, '#c8ccd0');
    noise(c, 110, 404, 100, 100, 12, 8);
    for (let i = 0; i < 9; i++) { const g = rgrad(c, 110 + rr.next() * 100, 404 + rr.next() * 100, 0, 6 + rr.next() * 8, [[0, 'rgba(120,60,20,0.35)'], [1, 'rgba(120,60,20,0)']]); c.fillStyle = g; c.fillRect(110, 404, 100, 100); }
  }, { plain: '#c8ccd0' });
  const label = mat({ name: 'stew_label', map: A, rough: 0.72, det: 'paper', ns: 0.4 });
  const tin = mat({ name: 'stew_tin', map: A, rough: 0.3, metal: 1, det: 'brushed', ns: 0.35 });
  const dent = (v) => {
    const a = Math.atan2(v.x, v.z), r = Math.hypot(v.x, v.z);
    if (r < R * 0.6) return;
    const d = Math.hypot((a - 0.75) * R, (v.y - 0.068) * 0.9);
    const k2 = Math.exp(-((d / 0.016) ** 2));
    const s = (r - 0.0052 * k2) / r;
    v.x *= s; v.z *= s;
  };
  const k = new Kit();
  const tinUV = A.R(110, 404, 100, 100);
  // bottom seam + beads, top beads + seam + lid (two lathes: the wall under the label is never seen, and leaving
  // it out lets the label carry the dent on its own)
  const bead = (y) => [[R, y], [R - 0.0009, y + 0.0011], [R, y + 0.0022]];
  const lower = [[0, 0.0026], [R - 0.0045, 0.0026, 0.0008], [R - 0.0034, 0.0005, 0.0005], [R - 0.0006, 0, 0.0005], [R + 0.0012, 0.0018, 0.0006], [R + 0.0012, 0.0056, 0.0006], [R, 0.0078, 0.0005]];
  for (let i = 0; i < 3; i++) lower.push(...bead(0.009 + i * 0.0022));
  lower.push([R, y0 + 0.001]);
  const upper = [[R, y1 - 0.001]];
  for (let i = 0; i < 3; i++) upper.push(...bead(0.0955 + i * 0.0022));
  upper.push([R, H - 0.0074], [R + 0.0012, H - 0.0054, 0.0006], [R + 0.0012, H - 0.0014, 0.0006], [R, H, 0.0006], [R - 0.0022, H - 0.0005, 's'], [R - 0.0036, H - 0.0036, 0.0006]);
  for (let i = 0; i < 3; i++) upper.push([R - 0.009 - i * 0.0095, H - 0.0036], [R - 0.0128 - i * 0.0095, H - 0.0026, 0.0012]);
  upper.push([0.004, H - 0.003], [0, H - 0.003]);
  const tinO = { seg: 36, rseg: 0.0013, uv: tinUV, capUV: { rect: A.R(0, 404, 100, 100), R: R * 0.95, t: 0.9 } };
  k.lathe(lower, tin, tinO);
  k.lathe(upper, tin, tinO);
  // paper label (slightly proud of the tin) with rows through the dent
  k.lathe([y0, 0.052, 0.06, 0.068, 0.076, 0.084, y1].map((y) => [R + 0.0003, y]), label, { seg: 48, phi0: PI, vFromY: [y0, y1], uv: A.R(0, 0, 1024, 400), deform: dent });
  // peeled label corner curling away near the torn region
  const pa = PI + 0.03 * TAU;
  k.add(sheetGeo(4, 5, (u, v) => {
    const a = pa + 0.15 + u * 0.13, y = 0.052 + v * 0.03;
    const lift = Math.pow(u, 1.6) * 0.008 * (0.6 + 0.4 * v);
    const r = R + 0.0004 + lift;
    return [Math.sin(a) * r, y, Math.cos(a) * r];
  }), label, { uv: A.R(60, 200, 50, 120, 0), col: 0xf6eed6 });
  k.colCyl(R + 0.0012, H, [0, H / 2, 0]);
  return { kit: k, meta: { mass: 0.45, material: 'metal', hold: { grip: [0, 0.05, 0], rot: [0.12, -0.35, 0.05], off: [0, 0.015, 0] } } };
});

// ============================================================================ chips
// 28 g pillow pack: metallised film puffed with nitrogen, crimped & pinked top/bottom seals with
// gathered creases fanning from the corners, folded side edges, fin seal on the back.
def('chips', () => {
  const A = atlas('chips', 1024, 512, (c) => {
    // FRONT (0,0,512,512): v = 1 top seal (canvas top)
    c.fillStyle = lgrad(c, 0, 0, 0, 512, [[0, '#ffa424'], [1, '#e4520c']]); c.fillRect(0, 0, 512, 512);
    c.save(); c.translate(256, 330);
    for (let i = 0; i < 20; i++) { c.rotate(TAU / 20); c.fillStyle = i % 2 ? 'rgba(255,232,120,0.28)' : 'rgba(255,255,255,0)'; c.beginPath(); c.moveTo(0, 0); c.lineTo(400, -64); c.lineTo(400, 64); c.fill(); }
    c.restore();
    const r = new RNG(5);
    for (let i = 0; i < 18; i++) {
      const x = 256 + r.range(-140, 140), y = 380 + r.range(-40, 50), s2 = r.range(36, 56);
      c.save(); c.translate(x, y); c.rotate(r.range(-1, 1));
      const cg = c.createRadialGradient(-s2 * 0.2, -s2 * 0.2, 2, 0, 0, s2);
      cg.addColorStop(0, '#ffe78e'); cg.addColorStop(1, '#d99a2a');
      c.fillStyle = cg; c.beginPath(); c.ellipse(0, 0, s2, s2 * 0.68, 0, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(150,90,20,0.5)'; c.lineWidth = 2; c.stroke();
      for (let j = 0; j < 4; j++) { c.fillStyle = 'rgba(160,100,30,0.4)'; c.beginPath(); c.arc(r.range(-s2 * 0.5, s2 * 0.5), r.range(-s2 * 0.3, s2 * 0.3), 1.5, 0, TAU); c.fill(); }
      c.restore();
    }
    rect(c, 0, 40, 512, 46, '#1d1d1f');
    brand(c, 256, 63, 22, ROOM_YELLOW, { text: 'R.O.O.M. SNACKS' });
    txt(c, 'LIMINAL', 256, 136, { size: 86, color: '#ffe23a', weight: '900', italic: true, stroke: '#a3170c', sw: 12, maxW: 420, ls: -2 });
    txt(c, 'CRISPS', 256, 210, { size: 76, color: '#ffffff', weight: '900', italic: true, stroke: '#a3170c', sw: 12, maxW: 380 });
    rrect(c, 70, 248, 372, 48, 24, '#2a6a3a');
    txt(c, 'SOUR CREAM & STATIC', 256, 272, { size: 24, color: '#fff', weight: '900', maxW: 340 });
    txt(c, 'POTATO-ADJACENT', 256, 314, { size: 18, color: '#4a1405', fam: MONO, weight: 'bold', maxW: 300 });
    starburst(c, 430, 170, 46, 16, '#2a6a3a', '#fff');
    txt(c, '60%', 430, 162, { size: 22, color: '#fff', weight: '900' });
    txt(c, 'AIR!', 430, 184, { size: 14, color: '#fff', weight: '900' });
    rect(c, 0, 446, 512, 26, '#a3170c');
    txt(c, 'NET WT 1 OZ (28.3 g)', 256, 459, { size: 14, color: '#fff', fam: MONO, weight: 'bold' });
    // seal zones (crimp stripes) top & bottom
    for (const y0 of [0, 472]) { rect(c, 0, y0, 512, 40, 'rgba(0,0,0,0.12)'); for (let x = 0; x < 512; x += 6) rect(c, x, y0, 3, 40, 'rgba(0,0,0,0.16)'); }
    wear(c, 0, 0, 512, 512, 23, 1.2, { edge: false, lightRatio: 0.9 });
    // BACK (512,0,512,512)
    rect(c, 512, 0, 512, 512, '#f2a03a');
    rect(c, 512, 40, 512, 46, '#1d1d1f');
    txt(c, 'PROPERTY OF R.O.O.M.', 768, 63, { size: 24, color: ROOM_YELLOW, weight: '900' });
    nutrition(c, 540, 104, 210, [['Calories', '160', true], ['Total Fat', '10g'], ['Sodium', '170mg'], ['Carbohydrate', '15g'], ['Static', '3 mV', true], ['Air', '60%']], { size: 13, h: 150 });
    barcode(c, 790, 110, 200, 90, 19);
    para(c, 'DO NOT CONSUME IN DIMENSION 0. Bag is 60% air for your protection. Crunch responsibly: noise attracts attention.', 548, 280, 440, { size: 14, fam: MONO, color: '#3a1a05', lh: 18 });
    recycle(c, 610, 400, 40, '#3a1a05');
    txt(c, 'BEST BEFORE: ∞', 820, 400, { size: 18, color: '#3a1a05', fam: MONO, weight: 'bold' });
    // back fin seal stripe down the middle
    rect(c, 756, 0, 24, 512, 'rgba(0,0,0,0.14)'); rect(c, 766, 0, 3, 512, 'rgba(255,255,255,0.3)');
    for (const y0 of [0, 472]) { rect(c, 512, y0, 512, 40, 'rgba(0,0,0,0.12)'); for (let x = 512; x < 1024; x += 6) rect(c, x, y0, 3, 40, 'rgba(0,0,0,0.16)'); }
    wear(c, 512, 0, 512, 512, 24, 1.2, { edge: false, lightRatio: 0.9 });
  }, { plain: '#e8a030' });
  const film = mat({ name: 'chips_film', map: A, rough: 0.3, metal: 0.32, det: 'foil', ns: 0.6 });
  const W = 0.15, L = 0.2, T = 0.024;
  const shape = (u, v, sgn) => {
    const seal = Math.min(1, Math.min(v, 1 - v) / 0.085);
    const s = seal <= 0 ? 0 : Math.pow(Math.sin(seal * PI / 2), 0.75);
    const bu = Math.sqrt(Math.max(0, 1 - Math.pow(2 * u - 1, 6)));
    const pinch = 1 - 0.055 * (1 - s) * (1 - Math.pow(2 * u - 1, 2));
    // creases fanning from the corners into the seals + general crinkle
    const cu = Math.min(u, 1 - u), cv = Math.min(v, 1 - v);
    const fan = (1 - s) * Math.sin((u - 0.5) * 38 + Math.sign(v - 0.5) * 3) * 0.0016 + Math.exp(-((cu * 9) ** 2 + (cv * 7) ** 2)) * Math.sin(Math.atan2(cv, cu) * 9) * 0.002;
    const crinkle = (Math.sin(u * 41 + v * 13) * Math.sin(v * 37 - u * 9) + Math.sin(u * 87 + v * 71) * 0.4) * 0.0009;
    const z = sgn * ((sgn > 0 ? T * 1.12 : T * 0.62) * bu * s + (crinkle + fan) * s * 0.9 + 0.0004) + (s < 0.05 ? Math.sin(u * 160) * 0.0003 : 0);
    let zz = (v - 0.5) * L;
    if (v === 0 || v === 1) zz -= Math.sign(v - 0.5) * 0.0012 * (1 - Math.abs(((u * 75) % 2 + 2) % 2 - 1));
    return [(u - 0.5) * W * pinch, z, zz];
  };
  const k = new Kit();
  k.add(sheetGeo(20, 28, (u, v) => { const p = shape(u, 1 - v, 1); return p; }), film, { uv: A.R(0, 0, 512, 512, 0), dm: 0.07 });
  k.add(sheetGeo(20, 28, (u, v) => { const p = shape(1 - u, 1 - v, -1); return p; }), film, { uv: A.R(512, 0, 512, 512, 0), dm: 0.07 });
  k.colBox([W * 0.96, 0.0416, L * 0.9], [0, 0.00435, 0]);
  return { kit: k, meta: { mass: 0.08, material: 'paper', hold: { grip: [0, 0.02, 0], rot: [1.22, 0, 0.1], off: [0, 0.04, 0] }, restitution: 0.05, angularDamping: 0.8 } };
});

// ============================================================================ paper_cup
// 7 oz water-cooler cup: printed coated paper, side seam overlap, rolled rim curl, recessed bottom with
// skirt; water surface part (setFill) with a faint meniscus ring.
def('paper_cup', () => {
  const A = atlas('paper_cup', 512, 256, (c) => {
    rect(c, 0, 0, 512, 160, '#fbfbf7');
    noise(c, 0, 0, 512, 160, 5, 2);
    c.fillStyle = '#7fb2dc';
    c.beginPath(); c.moveTo(0, 122); for (let x = 0; x <= 512; x += 8) c.lineTo(x, 122 + Math.sin((x / 512) * TAU * 4) * 7); c.lineTo(512, 160); c.lineTo(0, 160); c.fill();
    c.fillStyle = '#4f8fcf';
    c.beginPath(); c.moveTo(0, 134); for (let x = 0; x <= 512; x += 8) c.lineTo(x, 134 + Math.sin((x / 512) * TAU * 4 + 1) * 5); c.lineTo(512, 160); c.lineTo(0, 160); c.fill();
    for (const x of [128, 384]) {
      c.fillStyle = '#3f7fbf';
      c.beginPath(); c.moveTo(x, 16); c.quadraticCurveTo(x + 16, 42, x, 50); c.quadraticCurveTo(x - 16, 42, x, 16); c.fill();
      txt(c, 'R.O.O.M.', x, 70, { size: 20, color: '#2c5d8a', weight: '900' });
      txt(c, 'HYDRATION BREAK', x, 90, { size: 10, color: '#2c5d8a', fam: MONO, weight: 'bold' });
      txt(c, 'MAX. 30 SECONDS', x, 104, { size: 9, color: '#2c5d8a', fam: MONO });
    }
    // seam overlap at u = 0
    rect(c, 0, 0, 7, 160, 'rgba(120,120,110,0.18)');
    wear(c, 0, 0, 512, 160, 2, 0.6, { edge: false, lightRatio: 0.1 });
    // inside (0,164,256,60) + bottom (260,164,90,90)
    rect(c, 0, 164, 256, 60, '#f4f2ec');
    noise(c, 0, 164, 256, 60, 6, 3);
    rect(c, 260, 164, 90, 90, '#ecebe4');
    txt(c, '7 OZ', 305, 209, { size: 12, color: '#9a9a94', fam: MONO, weight: 'bold' });
  }, { plain: '#fbfbf7' });
  const paper = mat({ name: 'cup_paper', map: A, rough: 0.62, det: 'paper', ns: 0.35 });
  const waterMat = mat({ key: null, name: 'cup_water', color: 0x6f9ec4, rough: 0.03, metal: 0, transparent: true, opacity: 0.82, vc: false, env: 1.6 });
  const k = new Kit();
  const r0 = 0.0245, r1 = 0.0355, H = 0.082;
  const rAt = (y) => r0 + (r1 - r0) * (y / H);
  // outer wall (with the side seam step) + rim curl + inside + recessed bottom with skirt
  k.lathe([[r0 - 0.0006, 0.0, 's'], [r0, 0.0018], [rAt(H - 0.0025), H - 0.0025]], paper, { seg: 48, phi0: PI, vFromY: [0, H], uv: A.R(0, 0, 512, 160), rmod: (phi, y, r) => r + (phi < PI + 0.07 ? 0.00022 : 0) });
  k.lathe([[rAt(H - 0.0025), H - 0.0025], [r1 + 0.0012, H - 0.0018, 0.0011], [r1 + 0.0009, H + 0.0012, 0.001], [r1 - 0.0012, H + 0.0006, 0.0008], [r1 - 0.0008, H - 0.0026]], paper, { seg: 48, col: 0xf6f6f0 });
  k.lathe([[r1 - 0.0009, H - 0.0026], [rAt(0.006) - 0.0008, 0.006], [rAt(0.0055) - 0.0018, 0.0054, 0.001], [0, 0.0054]], paper, { seg: 40, uv: A.R(0, 164, 256, 60), capUV: { rect: A.R(260, 164, 90, 90), R: r0, t: 0.9 } });
  k.lathe([[0, 0.0012], [r0 - 0.0016, 0.0012, 0.0008], [r0 - 0.0012, 0.0002, 's'], [r0 - 0.0006, 0.0]], paper, { seg: 32, col: 0xe6e3da, uv: A.R(260, 164, 90, 90) });
  // water surface (part) with meniscus ring
  const fillY = 0.006 + (H - 0.014) * 0.8;
  const wr = rAt(fillY) - 0.0009;
  k.lathe([[wr, fillY + 0.0006], [wr * 0.94, fillY + 0.00005, 0.0006], [0, fillY]], waterMat, { seg: 32, part: 'water', raw: false });
  k.pivot('water', [0, fillY, 0]);
  k.colCyl(r1, H, [0, H / 2, 0]);
  return {
    kit: k,
    meta: {
      mass: 0.12, material: 'paper', hold: { grip: [0, 0.035, 0], rot: [0.12, 0, 0.04], off: [0, 0.015, 0] },
      init(inst, opts) {
        const w = inst.parts.water;
        const base = w.position.y - fillY;
        const set = (f) => {
          f = Math.max(0, Math.min(1, f));
          w.visible = f > 0.01;
          const y = 0.006 + (H - 0.014) * f;
          w.position.y = base + y;
          const s = (rAt(y) - 0.0009) / wr;
          w.scale.set(s, 1, s);
        };
        inst.object.userData.setFill = set;
        set(opts.fill ?? 0.8);
      },
    },
  };
});
