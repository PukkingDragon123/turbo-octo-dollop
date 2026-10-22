// Printed artwork for the furniture atlas: labels, stickers, stencils, screens, spines, glyphs.
// (Regions are drawn once into the shared atlas canvas on first use.)
import { RNG } from '../../core/rng.js';
import { region as atlasRegion, rUV, txt, marker, grunge, rrect, noiseFill, barcode, logo, lines, blobStains, seg7, font } from './atlas.js';
import { ageCanvas, typeText, handText, stamp, AGE, INK } from '../../gfx/aged.js';

// paper / printed regions get the aged-print pass (yellowing, foxing, folds, grime... see src/gfx/aged.js)
const AGED = {
  memo: { ...AGE.file, coffee: 1, dogEar: 0.5 }, memo2: { ...AGE.file, coffee: 0, folds: 'h' }, sticky: AGE.note,
  calendar: { ...AGE.poster, folds: 'none', tape: 0 }, fc_label: AGE.label, box_label: AGE.label, box_files: AGE.label,
  box_records: AGE.label, box_roomcorp: AGE.label, box_fragile: AGE.label, box_misc: AGE.label, asset_tag: AGE.sign,
  inspect_tag: AGE.label, ext_label: AGE.sign, barrel_label: AGE.sign, jug_label: AGE.label, wetfloor: AGE.sign,
  toolbox_sticker: AGE.sign, ladder_warn: AGE.sign, crate_stencil: AGE.sign, pallet_stamp: AGE.label, mug_logo: { ...AGE.label, foxing: 0 },
};
let ageSeed = 1;
function region(name, w, h, draw) {
  const a = AGED[name];
  atlasRegion(name, w, h, a ? (ctx, w2, h2, rng) => { draw(ctx, w2, h2, rng); ageCanvas(ctx, w2, h2, { ...a, seed: ageSeed++ }); } : draw);
}

const PI = Math.PI, TAU = PI * 2, HP = PI / 2;

region('stain', 128, 128, (ctx, w, h, rng) => {
  blobStains(ctx, w, h, rng, 2, ['95,62,28', '110,75,35'], { center: 24, rMin: 22, rMax: 38 });
});
region('waterstain', 256, 256, (ctx, w, h, rng) => {
  blobStains(ctx, w, h, rng, 3, ['150,105,45', '125,85,40'], { center: 60, rMin: 45, rMax: 78 });
});
region('asset_tag', 128, 48, (ctx, w, h, rng) => {
  ctx.fillStyle = '#c9cccf'; rrect(ctx, 1, 1, w - 2, h - 2, 6); ctx.fill();
  ctx.strokeStyle = '#8a8d90'; ctx.lineWidth = 2; ctx.stroke();
  txt(ctx, 'ROOM CORP PROPERTY', w / 2, 10, 10, '#222');
  barcode(ctx, 14, 17, w - 28, 18, rng);
  txt(ctx, `No. ${1000 + Math.floor(rng.next() * 8999)}`, w / 2, 41, 9, '#222', { fam: 'mono' });
});
region('box_files', 256, 128, (ctx, w, h, rng) => {
  marker(ctx, 'FILES', w / 2, 44, 58, 'rgba(20,20,25,0.9)', rng);
  marker(ctx, '1993', w / 2, 98, 52, 'rgba(20,20,25,0.9)', rng);
  ctx.strokeStyle = 'rgba(20,20,25,0.85)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(40, 124); ctx.quadraticCurveTo(128, 116, 216, 122); ctx.stroke();
});
region('box_donotopen', 256, 128, (ctx, w, h, rng) => {
  ctx.strokeStyle = 'rgba(170,25,20,0.9)'; ctx.lineWidth = 7; rrect(ctx, 10, 10, w - 20, h - 20, 8); ctx.stroke();
  txt(ctx, 'DO NOT', w / 2, 44, 44, 'rgba(170,25,20,0.92)', { fam: 'mono' });
  txt(ctx, 'OPEN', w / 2, 88, 50, 'rgba(170,25,20,0.92)', { fam: 'mono' });
  grunge(ctx, w, h, rng, 700, 1, 3);
});
region('box_roomcorp', 256, 160, (ctx, w, h, rng) => {
  logo(ctx, 52, 64, 64, 'rgba(25,30,45,0.85)');
  txt(ctx, 'ROOM', 168, 44, 44, 'rgba(25,30,45,0.85)');
  txt(ctx, 'CORP.', 168, 86, 40, 'rgba(25,30,45,0.85)');
  txt(ctx, 'SUPPLY DIVISION  ·  LEVEL 0', w / 2, 132, 15, 'rgba(25,30,45,0.8)', { fam: 'mono' });
  grunge(ctx, w, h, rng, 400, 0.8, 2);
});
region('box_arrows', 128, 128, (ctx, w, h, rng) => {
  ctx.fillStyle = 'rgba(25,30,45,0.85)';
  for (const x of [38, 90]) { ctx.beginPath(); ctx.moveTo(x, 14); ctx.lineTo(x + 20, 44); ctx.lineTo(x + 8, 44); ctx.lineTo(x + 8, 84); ctx.lineTo(x - 8, 84); ctx.lineTo(x - 8, 44); ctx.lineTo(x - 20, 44); ctx.closePath(); ctx.fill(); }
  ctx.fillRect(14, 92, 100, 5);
  txt(ctx, 'THIS SIDE UP', w / 2, 112, 15, 'rgba(25,30,45,0.85)');
  grunge(ctx, w, h, rng, 200, 0.8, 2);
});
region('box_fragile', 256, 112, (ctx, w, h, rng) => {
  ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(-0.06);
  ctx.strokeStyle = 'rgba(185,30,25,0.9)'; ctx.lineWidth = 6; ctx.strokeRect(-112, -38, 224, 76);
  txt(ctx, 'FRAGILE', 30, 0, 38, 'rgba(185,30,25,0.9)');
  // broken glass icon
  ctx.strokeStyle = 'rgba(185,30,25,0.9)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(-100, -26); ctx.lineTo(-72, -26); ctx.lineTo(-77, 4); ctx.lineTo(-95, 4); ctx.closePath(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-86, 4); ctx.lineTo(-86, 24); ctx.moveTo(-96, 26); ctx.lineTo(-76, 26); ctx.moveTo(-90, -26); ctx.lineTo(-84, -14); ctx.lineTo(-90, -6); ctx.stroke();
  ctx.restore();
  grunge(ctx, w, h, rng, 500, 1, 2.5);
});
region('box_label', 192, 128, (ctx, w, h, rng) => {
  ctx.fillStyle = '#f3f0e6'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.strokeRect(4, 4, w - 8, h - 8);
  txt(ctx, 'FROM: ROOM CORP. — RECEIVING', 10, 18, 11, '#222', { align: 'left', fam: 'mono' });
  txt(ctx, 'TO:   DEPT. ____  LEVEL 0', 10, 36, 11, '#222', { align: 'left', fam: 'mono' });
  ctx.fillRect(8, 46, w - 16, 2);
  barcode(ctx, 14, 56, w - 28, 40, rng);
  txt(ctx, `PKG ${Math.floor(rng.next() * 900000 + 100000)}  WT 4.2LB`, w / 2, 110, 12, '#222', { fam: 'mono' });
  ctx.fillStyle = 'rgba(120,90,40,0.15)'; ctx.fillRect(0, 0, w, h);
});
region('box_misc', 256, 128, (ctx, w, h, rng) => {
  marker(ctx, 'KITCHEN', w / 2, 30, 34, 'rgba(20,20,25,0.85)', rng);
  ctx.strokeStyle = 'rgba(20,20,25,0.9)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(52, 34); ctx.lineTo(208, 24); ctx.moveTo(56, 22); ctx.lineTo(204, 36); ctx.stroke();
  marker(ctx, 'MISC. ACCT.', w / 2, 82, 42, 'rgba(15,30,110,0.9)', rng);
  marker(ctx, '— Dale', 178, 116, 22, 'rgba(15,30,110,0.9)', rng);
});
region('box_records', 256, 128, (ctx, w, h, rng) => {
  ctx.fillStyle = 'rgba(245,242,232,0.95)'; ctx.fillRect(6, 6, w - 12, h - 12);
  ctx.strokeStyle = '#2a3550'; ctx.lineWidth = 3; ctx.strokeRect(6, 6, w - 12, h - 12);
  txt(ctx, 'RECORDS STORAGE', w / 2, 26, 20, '#2a3550');
  ctx.fillStyle = '#2a3550';
  for (const [i, l] of ['DEPT.', 'CONTENTS', 'YEARS'].entries()) { txt(ctx, l, 16, 54 + i * 26, 12, '#2a3550', { align: 'left', fam: 'mono' }); ctx.fillRect(86, 60 + i * 26, 156, 1.5); }
  marker(ctx, 'ACCOUNTS', 160, 50, 20, 'rgba(20,20,25,0.85)', rng);
  marker(ctx, 'LEDGERS / MEMOS', 166, 76, 17, 'rgba(20,20,25,0.85)', rng);
  marker(ctx, '1991 – 1994', 160, 102, 19, 'rgba(20,20,25,0.85)', rng);
});
region('box_handhole', 64, 32, (ctx, w, h) => {
  ctx.fillStyle = 'rgba(25,15,8,0.95)'; rrect(ctx, 4, 6, w - 8, h - 12, 9); ctx.fill();
  ctx.strokeStyle = 'rgba(120,90,55,0.8)'; ctx.lineWidth = 2; ctx.stroke();
});
region('crt_badge', 160, 40, (ctx, w, h) => {
  txt(ctx, 'ROOMVISION', w / 2, 16, 18, '#5a5446', { fam: 'sans' });
  txt(ctx, 'SVGA 14"  MODEL 1493', w / 2, 32, 9, '#6a6455', { fam: 'mono' });
});
region('vents', 128, 64, (ctx, w, h) => {
  ctx.fillStyle = 'rgba(25,22,18,0.85)';
  for (let y = 4; y < h - 4; y += 9) for (let x = 6; x < w - 6; x += 20) rrect(ctx, x, y, 15, 4, 2), ctx.fill();
});
region('memo', 192, 256, (ctx, w, h, rng) => {
  noiseFill(ctx, w, h, rng, '#f2efe4', 300, 0.04);
  txt(ctx, 'MEMORANDUM', w / 2, 22, 18, '#1a1a1a', { fam: 'serif' });
  ctx.fillStyle = '#222'; ctx.fillRect(14, 34, w - 28, 2);
  typeText(ctx, 'TO:   ALL STAFF\nFROM: FACILITIES\nRE:   EXITS', 14, 50, { size: 11, lineHeight: 15, seed: 21 });
  lines(ctx, 14, 100, w - 28, 9, 13, rng, 'rgba(30,30,40,0.7)', 2);
  stamp(ctx, 'RECEIVED', w * 0.66, h * 0.6, { size: 15, color: INK.red, angle: -0.22, sub: 'OCT 14 1993', seed: 4 });
  ctx.fillStyle = 'rgba(160,120,50,0.12)'; ctx.beginPath(); ctx.arc(w * 0.7, h * 0.8, 26, 0, TAU); ctx.fill();
});
region('sticky', 96, 96, (ctx, w, h, rng) => {
  ctx.fillStyle = '#f3e26a'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.fillRect(0, 0, w, 10);
  handText(ctx, "ext. 4471\ndon't use\nstairwell B", w / 2, 34, { size: 20, lineHeight: 21, align: 'center', color: INK.blue, font: 'hand', seed: 6 });
});
region('calendar', 160, 224, (ctx, w, h, rng) => {
  ctx.fillStyle = '#f4f1e8'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#3d5a80'; ctx.fillRect(0, 0, w, 70);
  logo(ctx, 26, 35, 30, '#e8e2d0');
  txt(ctx, 'ROOM CORP', 96, 28, 16, '#e8e2d0');
  txt(ctx, '1993', 96, 50, 14, '#e8e2d0');
  txt(ctx, 'OCTOBER', w / 2, 86, 15, '#222');
  for (let r = 0; r < 5; r++) for (let c = 0; c < 7; c++) {
    const d = r * 7 + c - 4;
    ctx.strokeStyle = '#bbb'; ctx.lineWidth = 1; ctx.strokeRect(6 + c * 21, 98 + r * 24, 21, 24);
    if (d > 0 && d <= 31) txt(ctx, String(d), 9 + c * 21, 105 + r * 24, 8, c === 0 ? '#a33' : '#333', { align: 'left', weight: 'normal' });
  }
  for (let d = 5; d < 31; d++) if (rng.next() < 0.7) { const r = Math.floor((d + 4) / 7), c = (d + 4) % 7; ctx.strokeStyle = 'rgba(180,20,20,0.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(8 + c * 21, 100 + r * 24); ctx.lineTo(25 + c * 21, 120 + r * 24); ctx.stroke(); }
});
region('fc_label', 384, 96, (ctx, w, h, rng) => {
  const L = ['A – F', 'PERSONNEL', '1991–1993', 'MISC.', 'CLAIMS', 'DO NOT FILE'];
  for (let i = 0; i < 6; i++) {
    const x = (i % 3) * 128, y = Math.floor(i / 3) * 48;
    ctx.fillStyle = i === 5 ? '#e9d9b0' : '#efe9d8'; ctx.fillRect(x, y, 128, 48);
    ctx.fillStyle = 'rgba(80,60,30,0.10)'; ctx.fillRect(x, y + 36, 128, 12);
    typeText(ctx, L[i], x + 64, y + 30, { size: L[i].length > 9 ? 15 : 19, align: 'center', seed: 30 + i });
  }
});
region('spines', 512, 256, (ctx, w, h, rng) => {
  for (let i = 0; i < 32; i++) {
    const x = (i % 16) * 32, y = Math.floor(i / 16) * 128, col = SPINE_COLS[i];
    ctx.fillStyle = col; ctx.fillRect(x, y, 32, 128);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x, y, 3, 128); ctx.fillRect(x + 29, y, 3, 128);
    const gold = rng.next() > 0.5 ? '#d8bf6a' : '#ece6d4';
    ctx.fillStyle = gold;
    const k = i % 4;
    if (k !== 3) { ctx.fillRect(x + 4, y + 10, 24, 2); ctx.fillRect(x + 4, y + 116, 24, 2); }
    if (k === 1) { ctx.fillRect(x + 4, y + 14, 24, 2); ctx.fillRect(x + 4, y + 112, 24, 2); }
    if (k === 2) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x + 4, y + 22, 24, 30); ctx.fillStyle = gold; }
    for (let j = 0; j < 3 + Math.floor(rng.next() * 4); j++) ctx.fillRect(x + 13 + (rng.next() - 0.5) * 3, y + 26 + j * 9, 6, 6);
    ctx.fillRect(x + 9, y + 96, 14, 5);
  }
});
region('binder_spines', 256, 192, (ctx, w, h, rng) => {
  const L = ['Q3 REPORTS', 'PERSONNEL', 'BUDGET 1993', 'MEMOS'];
  for (let i = 0; i < 4; i++) {
    const x = i * 64;
    ctx.fillStyle = BINDER_COLS[i]; ctx.fillRect(x, 0, 64, 192);
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x + 4, 0, 8, 192);
    ctx.fillStyle = '#ecebe4'; ctx.fillRect(x + 10, 20, 44, 112);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; ctx.strokeRect(x + 10, 20, 44, 112);
    ctx.save(); ctx.translate(x + 32, 76); ctx.rotate(-HP); txt(ctx, L[i], 0, 0, 14, '#1a1a2a', { fam: 'mono', maxW: 104 }); ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.beginPath(); ctx.arc(x + 32, 160, 12, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(200,200,200,0.5)'; ctx.lineWidth = 2; ctx.stroke();
  }
});
export const SPINE_COLS = ['#6e1f1f', '#1f3a5f', '#2d4a2b', '#5a3d1e', '#1d1d22', '#7a6a3a', '#4b2d4d', '#8a4a23', '#2f5d62', '#b8ad8e', '#33333a', '#6b2a3c', '#405d7a', '#a2462b', '#24433f', '#7d7660',
  '#3a2618', '#9b8a5a', '#503030', '#21304a', '#5e6b3a', '#8c2f2f', '#2b2b2b', '#c4b48a', '#4a5a6a', '#6a4a7a', '#7a3a1a', '#1f5040', '#5a5a5a', '#943c2a', '#384838', '#8a7a6a'];
export const BINDER_COLS = ['#1d2c4d', '#1c1c1e', '#5e1d22', '#1f4030'];
region('snakeleaf', 64, 256, (ctx, w, h, rng) => {
  ctx.fillStyle = '#2f5a2a'; ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 6 + rng.next() * 8) {
    ctx.fillStyle = `rgba(${rng.next() > 0.5 ? '170,200,140' : '20,40,20'},${0.25 + rng.next() * 0.3})`;
    ctx.beginPath(); ctx.moveTo(8, y); ctx.quadraticCurveTo(w / 2, y + 4 + rng.next() * 6, w - 8, y); ctx.lineTo(w - 8, y + 2.5); ctx.quadraticCurveTo(w / 2, y + 7, 8, y + 2.5); ctx.fill();
  }
  ctx.fillStyle = '#c9c25a'; ctx.fillRect(0, 0, 6, h); ctx.fillRect(w - 6, 0, 6, h);
});
region('crate_stencil', 256, 128, (ctx, w, h, rng) => {
  const c = 'rgba(25,22,18,0.88)';
  txt(ctx, 'ROOM CORP.', w / 2, 34, 40, c, { fam: 'mono' });
  txt(ctx, 'SECTOR 0 — HANDLE WITH CARE', w / 2, 70, 15, c, { fam: 'mono' });
  txt(ctx, `LOT ${Math.floor(rng.next() * 9000 + 1000)}-B   GROSS 41 KG`, w / 2, 98, 14, c, { fam: 'mono' });
  ctx.save(); ctx.globalCompositeOperation = 'destination-out';
  for (let x = 8; x < w; x += 23) ctx.fillRect(x, 14, 2, 44);
  ctx.restore();
  grunge(ctx, w, h, rng, 600, 1, 2.5);
});
region('pallet_stamp', 128, 64, (ctx, w, h, rng) => {
  const c = 'rgba(30,25,20,0.8)';
  ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.strokeRect(4, 4, w - 8, h - 8);
  ctx.beginPath(); ctx.arc(26, 32, 14, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.moveTo(12, 32); ctx.lineTo(40, 32); ctx.moveTo(26, 18); ctx.lineTo(26, 46); ctx.stroke();
  txt(ctx, 'HT  DB', 84, 22, 16, c, { fam: 'mono' });
  txt(ctx, 'XX-0447', 84, 44, 13, c, { fam: 'mono' });
  grunge(ctx, w, h, rng, 200, 1, 1.5);
});
region('wetfloor', 256, 512, (ctx, w, h, rng) => {
  const k = '#141414';
  ctx.strokeStyle = k; ctx.lineWidth = 6; rrect(ctx, 12, 30, w - 24, h - 44, 18); ctx.stroke();
  txt(ctx, 'CAUTION', w / 2, 72, 44, k);
  ctx.fillStyle = k; ctx.fillRect(28, 98, w - 56, 4);
  // warning triangle with slipping figure
  ctx.save(); ctx.translate(w / 2, 215);
  ctx.lineWidth = 9; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(0, -88); ctx.lineTo(92, 72); ctx.lineTo(-92, 72); ctx.closePath(); ctx.stroke();
  ctx.lineWidth = 9; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(6, -26, 11, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(-14, 22); ctx.lineTo(10, 42); ctx.moveTo(-14, 22); ctx.lineTo(-38, 34); ctx.moveTo(-4, -2); ctx.lineTo(26, -14); ctx.moveTo(-4, -2); ctx.lineTo(-30, 4); ctx.stroke();
  ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-60, 56); ctx.quadraticCurveTo(0, 46, 60, 56); ctx.stroke();
  ctx.restore();
  txt(ctx, 'WET', w / 2, 340, 52, k);
  txt(ctx, 'FLOOR', w / 2, 392, 52, k);
  ctx.fillRect(28, 422, w - 56, 3);
  txt(ctx, 'CUIDADO', w / 2, 446, 22, k);
  txt(ctx, 'PISO MOJADO', w / 2, 472, 22, k);
});
region('barrel_label', 256, 192, (ctx, w, h, rng) => {
  ctx.fillStyle = '#efece2'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#222'; ctx.lineWidth = 3; ctx.strokeRect(5, 5, w - 10, h - 10);
  // NFPA style diamond
  ctx.save(); ctx.translate(58, 96); ctx.rotate(PI / 4);
  const q = 30;
  [['#2e5aa8', -q, 0], ['#c8302a', -q, -q], ['#e6c62a', 0, -q], ['#f4f4f4', 0, 0]].forEach(([c, x, y]) => { ctx.fillStyle = c; ctx.fillRect(x, y, q, q); ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.strokeRect(x, y, q, q); });
  ctx.restore();
  txt(ctx, '1', 36, 96, 18, '#fff'); txt(ctx, '0', 58, 74, 18, '#fff'); txt(ctx, '0', 80, 96, 18, '#111');
  txt(ctx, 'NON-POTABLE', 172, 50, 22, '#111');
  txt(ctx, 'WATER', 172, 76, 22, '#111');
  txt(ctx, 'DO NOT DRINK', 172, 106, 15, '#b02020');
  txt(ctx, 'ROOM CORP. FACILITIES', 172, 140, 11, '#333', { fam: 'mono' });
  txt(ctx, 'DRUM 55 GAL  #0447', 172, 160, 11, '#333', { fam: 'mono' });
  grunge(ctx, w, h, rng, 250, 0.7, 3);
});
region('janitor', 128, 64, (ctx, w, h, rng) => {
  txt(ctx, 'ROOM CORP', w / 2, 18, 15, 'rgba(20,20,20,0.9)');
  txt(ctx, 'JANITORIAL', w / 2, 38, 13, 'rgba(20,20,20,0.9)', { fam: 'mono' });
  txt(ctx, '35 QT', w / 2, 56, 11, 'rgba(20,20,20,0.9)', { fam: 'mono' });
});
region('jug_label', 512, 96, (ctx, w, h, rng) => {
  ctx.fillStyle = 'rgba(240,246,250,0.92)'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1e4f9a'; ctx.fillRect(0, 0, w, 14); ctx.fillRect(0, h - 14, w, 14);
  for (const x of [128, 384]) {
    txt(ctx, 'ROOM SPRINGS', x, 40, 26, '#1e4f9a', { fam: 'serif' });
    txt(ctx, 'PURE DRINKING WATER · 5 GAL (18.9 L)', x, 66, 11, '#244', { fam: 'mono' });
  }
  ctx.fillStyle = '#1e4f9a'; ctx.beginPath(); ctx.moveTo(256, 30); ctx.quadraticCurveTo(268, 52, 256, 62); ctx.quadraticCurveTo(244, 52, 256, 30); ctx.fill();
});
export const KEY_GLYPHS = ['Esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', '`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Bksp', 'Tab',
  'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\', 'Caps', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'Enter', 'Shift', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/',
  'Ctrl', 'Alt', 'Ins', 'Home', 'PgUp', 'Del', 'End', 'PgDn', '↑', '←', '↓', '→', 'Num', '*', '+', 'PrtSc', 'ScrLk', 'Pause', '#', 'MUTE', 'HOLD', 'REDIAL', 'XFER', 'CONF', 'SPKR'];
const KEY_IDX = new Map(KEY_GLYPHS.map((k, i) => [k, i]));
region('keyglyphs', 512, 256, (ctx) => {
  KEY_GLYPHS.forEach((k, i) => {
    const x = (i % 16) * 32, y = Math.floor(i / 16) * 32;
    const n = [...k].length;
    txt(ctx, k, x + 16, y + 16, n === 1 ? 20 : n === 2 ? 14 : n === 3 ? 11 : 8.5, '#2b2822', { weight: n === 1 ? 'bold' : 'bold' });
  });
});
export function glyphUV(k) { return rUV('keyglyphs', KEY_IDX.get(k) ?? KEY_IDX.get('*'), 16, 8); }
region('tower_badge', 128, 48, (ctx) => {
  logo(ctx, 18, 24, 22, '#4a4436');
  txt(ctx, 'ROOM CORP', 76, 16, 14, '#4a4436');
  txt(ctx, '486DX2 / 66', 76, 34, 12, '#7a2a20', { fam: 'mono' });
});
region('mhz', 64, 40, (ctx) => {
  ctx.fillStyle = '#120202'; ctx.fillRect(0, 0, 64, 40);
  seg7(ctx, '66', 12, 6, 28, '#ff3a20', '#2a0805');
});
region('cdrom', 96, 24, (ctx) => {
  txt(ctx, 'CD-ROM', 34, 12, 12, '#3c372d');
  ctx.strokeStyle = '#3c372d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(80, 12, 8, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(80, 12, 2, 0, TAU); ctx.stroke();
});
region('floppy_lbl', 64, 16, (ctx) => txt(ctx, '1.44 MB', 32, 8, 9, '#3c372d', { fam: 'mono' }));
region('fan_grille', 128, 128, (ctx) => {
  ctx.strokeStyle = 'rgba(20,20,20,0.95)'; ctx.lineWidth = 5;
  for (let r = 12; r < 62; r += 10) { ctx.beginPath(); ctx.arc(64, 64, r, 0, TAU); ctx.stroke(); }
  ctx.fillStyle = 'rgba(20,20,20,0.95)'; ctx.fillRect(61, 4, 6, 120); ctx.fillRect(4, 61, 120, 6);
});
region('ports', 128, 192, (ctx, w, h, rng) => {
  ctx.fillStyle = 'rgba(160,160,160,0.95)'; ctx.fillRect(0, 0, w, h);
  const P = [['#5a2a6a', 10, 10, 18, 18], ['#2a6a3a', 34, 10, 18, 18], ['#c26a9a', 10, 40, 100, 14], ['#2a3a8a', 10, 62, 46, 14], ['#555', 62, 62, 46, 14], ['#555', 10, 84, 46, 14], ['#222', 70, 88, 10, 10], ['#c8a03a', 86, 88, 10, 10]];
  for (const [c, x, y, ww, hh] of P) { ctx.fillStyle = c; rrect(ctx, x, y, ww, hh, 3); ctx.fill(); ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5; ctx.stroke(); }
  for (let i = 0; i < 3; i++) { ctx.fillStyle = '#8a8a8a'; ctx.fillRect(8 + i * 38, 110, 32, 76); ctx.strokeStyle = '#555'; ctx.strokeRect(8 + i * 38, 110, 32, 76); }
});
region('kb_badge', 96, 24, (ctx) => { logo(ctx, 12, 12, 14, '#5a5446'); txt(ctx, 'ROOM CORP', 56, 12, 11, '#5a5446'); });
region('phone_lcd', 128, 32, (ctx) => {
  ctx.fillStyle = '#9fa98a'; ctx.fillRect(0, 0, 128, 32);
  txt(ctx, 'EXT 4471  12:00', 64, 11, 12, '#2a2f24', { fam: 'lcd', weight: 'normal' });
  txt(ctx, '1 NEW MESSAGE', 64, 24, 11, '#2a2f24', { fam: 'lcd', weight: 'normal' });
});
region('mug_logo', 256, 288, (ctx, w, h, rng) => {
  // cell 0: logo
  logo(ctx, 60, 48, 52, '#2d4a7a');
  txt(ctx, 'ROOM', 160, 34, 34, '#2d4a7a');
  txt(ctx, 'CORP.', 160, 68, 26, '#2d4a7a');
  // cell 1
  txt(ctx, "WORLD'S", w / 2, 96 + 22, 24, '#8a2020', { fam: 'serif' });
  txt(ctx, 'OKAYEST', w / 2, 96 + 50, 28, '#8a2020', { fam: 'serif' });
  txt(ctx, 'EMPLOYEE', w / 2, 96 + 78, 20, '#8a2020', { fam: 'serif' });
  // cell 2
  txt(ctx, 'I SURVIVED', w / 2, 192 + 26, 24, '#1f5a4a');
  txt(ctx, 'Q3 1993', w / 2, 192 + 62, 34, '#1f5a4a');
});
region('memo2', 192, 256, (ctx, w, h, rng) => {
  noiseFill(ctx, w, h, rng, '#f3f1ea', 200, 0.03);
  logo(ctx, 22, 22, 18, '#333');
  txt(ctx, 'ROOM CORP. — INTERNAL', 40, 22, 10, '#333', { align: 'left', fam: 'mono' });
  txt(ctx, 'QUARTERLY OCCUPANCY REPORT', w / 2, 46, 11, '#111');
  lines(ctx, 14, 62, w - 28, 6, 11, rng, 'rgba(30,30,40,0.7)', 2);
  ctx.strokeStyle = '#444'; ctx.strokeRect(14, 136, w - 28, 60);
  for (let i = 0; i < 5; i++) { ctx.fillStyle = '#556'; const hh = 10 + rng.next() * 40; ctx.fillRect(24 + i * 30, 192 - hh, 16, hh); }
  lines(ctx, 14, 208, w - 28, 3, 11, rng, 'rgba(30,30,40,0.7)', 2);
  txt(ctx, 'PAGE 1 OF ∞', w / 2, 248, 9, '#555', { fam: 'mono' });
});
region('printer_lcd', 96, 24, (ctx) => {
  ctx.fillStyle = '#1d2a12'; ctx.fillRect(0, 0, 96, 24);
  txt(ctx, '00 READY', 48, 12, 16, '#b8f070', { fam: 'lcd', weight: 'normal' });
});
region('printer_badge', 128, 32, (ctx) => {
  txt(ctx, 'ROOMJET 4L', 4, 12, 15, '#4a4436', { align: 'left' });
  txt(ctx, 'LASER PRINTER · 300 DPI', 4, 26, 9, '#6a6455', { align: 'left', fam: 'mono' });
});
region('tray_lbl', 64, 16, (ctx) => { txt(ctx, 'LETTER  ▲', 32, 8, 10, '#3c372d', { fam: 'mono' }); });
region('mw_display', 96, 32, (ctx) => {
  ctx.fillStyle = '#04100c'; ctx.fillRect(0, 0, 96, 32);
  seg7(ctx, '12:00', 12, 5, 22, '#3dffb0', '#0c2a20');
});
region('mw_keys', 64, 128, (ctx) => {
  const L = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLR', '0', 'TIME'];
  L.forEach((l, i) => txt(ctx, l, 11 + (i % 3) * 21, 9 + Math.floor(i / 3) * 18, l.length > 1 ? 7 : 11, '#222'));
  txt(ctx, 'POWER', 32, 84, 9, '#222'); txt(ctx, 'START', 32, 112, 11, '#eee');
});
region('mwmesh', 128, 96, (ctx) => {
  ctx.fillStyle = 'rgba(10,10,10,0.55)'; ctx.fillRect(0, 0, 128, 96);
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  for (let y = 2; y < 96; y += 4) for (let x = 2 + ((y / 4) & 1) * 2; x < 128; x += 4) ctx.fillRect(x, y, 2, 2);
});
region('tv_badge', 128, 24, (ctx) => { txt(ctx, 'ROOMVISION', 64, 12, 15, '#c9c4b4', { fam: 'serif' }); });
region('tv_grille', 64, 128, (ctx) => {
  ctx.fillStyle = 'rgba(8,8,8,0.9)';
  for (let y = 4; y < 124; y += 7) rrect(ctx, 6, y, 52, 3.5, 1.5), ctx.fill();
});
region('clock_display', 128, 48, (ctx) => {
  ctx.fillStyle = '#0d0202'; ctx.fillRect(0, 0, 128, 48);
  seg7(ctx, '12:00', 12, 8, 32, '#ff2a1a', '#260604');
  ctx.fillStyle = '#ff2a1a'; ctx.fillRect(116, 10, 5, 5);
  ctx.fillStyle = '#4a0c06'; ctx.fillRect(116, 32, 5, 5);
});
region('clock_lbl', 96, 16, (ctx) => { txt(ctx, 'SNOOZE', 48, 8, 10, '#bbb'); });
region('grille', 128, 128, (ctx) => {
  ctx.fillStyle = 'rgba(70,72,76,0.9)';
  ctx.beginPath(); ctx.arc(64, 64, 63, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(5,5,6,0.95)';
  for (let y = 4; y < 128; y += 5) for (let x = 4 + ((y / 5) & 1) * 2.5; x < 128; x += 5) { if ((x - 64) ** 2 + (y - 64) ** 2 < 58 * 58) { ctx.beginPath(); ctx.arc(x, y, 1.7, 0, TAU); ctx.fill(); } }
});
region('tuner', 192, 40, (ctx) => {
  ctx.fillStyle = '#e9e4d2'; ctx.fillRect(0, 0, 192, 40);
  ctx.fillStyle = '#222';
  for (let i = 0; i <= 40; i++) ctx.fillRect(10 + i * 4.3, i % 5 ? 14 : 10, 1, i % 5 ? 4 : 8);
  ['88', '92', '96', '100', '104', '108'].forEach((s, i) => txt(ctx, s, 10 + i * 34.4, 26, 9, '#222', { fam: 'mono' }));
  txt(ctx, 'FM', 6, 6, 7, '#a22', { align: 'left' });
  ctx.fillStyle = '#e8501a'; ctx.fillRect(118, 2, 2.5, 36);
});
region('cassette', 128, 80, (ctx) => {
  ctx.fillStyle = 'rgba(30,30,32,0.6)'; ctx.fillRect(0, 0, 128, 80);
  ctx.fillStyle = '#d8d2c0'; rrect(ctx, 12, 10, 104, 58, 4); ctx.fill();
  ctx.fillStyle = '#e8b04a'; ctx.fillRect(16, 14, 96, 14);
  marker(ctx, "MIXTAPE '93", 64, 21, 11, '#222', new RNG(5));
  ctx.fillStyle = '#2a2a2a'; rrect(ctx, 30, 34, 68, 22, 10); ctx.fill();
  ctx.fillStyle = '#d8d2c0'; for (const x of [44, 84]) { ctx.beginPath(); ctx.arc(x, 45, 7, 0, TAU); ctx.fill(); }
  ctx.fillStyle = '#5a3a20'; ctx.beginPath(); ctx.arc(44, 45, 11, 0, TAU); ctx.globalAlpha = 0.5; ctx.fill(); ctx.globalAlpha = 1;
});
region('boombox_badge', 256, 24, (ctx) => {
  txt(ctx, 'ROOM SOUND', 4, 12, 15, '#e8e8e8', { align: 'left' });
  txt(ctx, 'STEREO RADIO CASSETTE', 252, 12, 9, '#cfcfcf', { align: 'right', fam: 'mono' });
});
region('deck_keys', 128, 16, (ctx) => { ['REC', 'PLAY', 'REW', 'FF', 'STOP', 'PAUSE'].forEach((s, i) => txt(ctx, s, 10 + i * 21.5, 8, 7, '#ddd')); });
region('ext_label', 256, 192, (ctx, w, h, rng) => {
  ctx.fillStyle = '#f1efe6'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#b3201a'; ctx.fillRect(0, 0, w, 40);
  txt(ctx, 'FIRE EXTINGUISHER', w / 2, 21, 20, '#fff');
  txt(ctx, 'ABC DRY CHEMICAL · 5 LB', w / 2, 56, 14, '#111');
  ctx.fillStyle = '#2f8a3a'; ctx.beginPath(); ctx.moveTo(40, 72); ctx.lineTo(62, 108); ctx.lineTo(18, 108); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#c22a20'; ctx.fillRect(106, 74, 34, 34);
  ctx.fillStyle = '#2a58a8'; ctx.beginPath(); ctx.arc(208, 91, 18, 0, TAU); ctx.fill();
  txt(ctx, 'A', 40, 96, 16, '#fff'); txt(ctx, 'B', 123, 92, 18, '#fff'); txt(ctx, 'C', 208, 92, 18, '#fff');
  ['1. PULL PIN', '2. AIM AT BASE OF FIRE', '3. SQUEEZE HANDLE', '4. SWEEP SIDE TO SIDE'].forEach((s, i) => txt(ctx, s, 16, 126 + i * 15, 11, '#222', { align: 'left', fam: 'mono' }));
  grunge(ctx, w, h, rng, 120, 0.5, 2);
});
region('gauge', 64, 64, (ctx) => {
  ctx.fillStyle = '#f4f4ee'; ctx.beginPath(); ctx.arc(32, 32, 31, 0, TAU); ctx.fill();
  ctx.lineWidth = 7;
  [['#c22a20', 2.4, 3.6], ['#2f9a3a', 3.6, 5.8], ['#c22a20', 5.8, 7.0]].forEach(([c, a0, a1]) => { ctx.strokeStyle = c; ctx.beginPath(); ctx.arc(32, 32, 22, a0, a1); ctx.stroke(); });
  ctx.strokeStyle = '#111'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(32, 32); ctx.lineTo(32 + Math.cos(4.9) * 22, 32 + Math.sin(4.9) * 22); ctx.stroke();
  txt(ctx, 'PSI', 32, 46, 8, '#333');
});
region('inspect_tag', 64, 112, (ctx) => {
  ctx.fillStyle = '#f2d23c'; rrect(ctx, 2, 2, 60, 108, 6); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(32, 12, 5, 0, TAU); ctx.fill();
  txt(ctx, 'INSPECTED', 32, 28, 9, '#111');
  for (let i = 0; i < 12; i++) { ctx.strokeStyle = '#333'; ctx.strokeRect(8 + (i % 4) * 12, 40 + Math.floor(i / 4) * 14, 10, 12); txt(ctx, String(i + 1), 13 + (i % 4) * 12, 46 + Math.floor(i / 4) * 14, 6, '#333', { weight: 'normal' }); }
  ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(37, 74, 3, 0, TAU); ctx.fill();
  txt(ctx, '1993', 32, 96, 12, '#111', { fam: 'mono' });
});
region('toolbox_sticker', 160, 64, (ctx, w, h, rng) => {
  ctx.fillStyle = '#e9e5d6'; rrect(ctx, 2, 2, w - 4, h - 4, 8); ctx.fill();
  ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.stroke();
  txt(ctx, 'PROPERTY OF', w / 2, 18, 11, '#111', { fam: 'mono' });
  txt(ctx, 'FACILITIES', w / 2, 38, 20, '#111');
  marker(ctx, 'do not borrow!!', w / 2, 54, 11, '#1a2a8a', rng, { weight: 'normal' });
  grunge(ctx, w, h, rng, 150, 0.8, 2);
});
region('ladder_warn', 64, 160, (ctx) => {
  ctx.fillStyle = '#f2c418'; ctx.fillRect(0, 0, 64, 160);
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 64, 24);
  txt(ctx, 'DANGER', 32, 12, 13, '#f2c418');
  ['DO NOT', 'STAND ON', 'OR ABOVE', 'THIS STEP', '', 'MAX', '225 LB'].forEach((s, i) => txt(ctx, s, 32, 38 + i * 16, 10, '#111'));
});
export function drawWhiteboard(ctx, w, h) {
  const rng = new RNG(1993);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#f2f3ef'); g.addColorStop(0.5, '#e9ebe6'); g.addColorStop(1, '#eef0ec');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // ghosting from old erasures
  for (let i = 0; i < 26; i++) {
    const x = rng.next() * w, y = rng.next() * h, r = 40 + rng.next() * 140;
    const gg = ctx.createRadialGradient(x, y, 0, x, y, r);
    gg.addColorStop(0, `rgba(${rng.next() > 0.7 ? '80,90,140' : '90,90,90'},0.07)`); gg.addColorStop(1, 'rgba(90,90,90,0)');
    ctx.fillStyle = gg; ctx.save(); ctx.translate(x, y); ctx.scale(1.8, 0.6); ctx.translate(-x, -y); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.restore();
  }
  ctx.save(); ctx.filter = 'blur(1.5px)'; ctx.globalAlpha = 0.18;
  marker(ctx, 'MEETING 2PM — RM 0', 700, 90, 34, '#223', rng, { weight: 'normal' });
  ctx.restore();
  const blue = 'rgba(30,50,150,0.92)', blk = 'rgba(25,25,30,0.9)', red = 'rgba(190,25,25,0.85)', grn = 'rgba(20,110,50,0.85)';
  marker(ctx, 'Q3 TARGETS', 70, 80, 56, blue, rng, { align: 'left' });
  ctx.strokeStyle = blue; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(66, 118); ctx.quadraticCurveTo(250, 108, 400, 116); ctx.stroke();
  ['- SYNERGY  ↑ 12%', '- REDUCE TURNOVER', '- AUDIT LEVEL 0 EXITS', '- FIND STAIRWELL B ??'].forEach((s, i) => marker(ctx, s, 80, 170 + i * 52, 32, i === 3 ? red : blk, rng, { align: 'left', weight: 'normal' }));
  // bar chart
  ctx.strokeStyle = blk; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(620, 160); ctx.lineTo(620, 400); ctx.lineTo(940, 400); ctx.stroke();
  [120, 170, 150, 230, 60].forEach((hh, i) => { ctx.strokeStyle = i === 4 ? red : grn; ctx.lineWidth = 4; ctx.strokeRect(645 + i * 58, 400 - hh, 36, hh); });
  marker(ctx, 'Q1 Q2 Q3 Q4 ??', 785, 430, 24, blk, rng, { weight: 'normal' });
  ctx.strokeStyle = red; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(890, 300, 44, 70, 0.1, 0, TAU); ctx.stroke();
  marker(ctx, 'x4471', 880, 520, 30, blk, rng, { weight: 'normal' });
  ctx.strokeStyle = blk; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(470, 300); ctx.lineTo(590, 260); ctx.moveTo(575, 252); ctx.lineTo(592, 260); ctx.lineTo(580, 274); ctx.stroke();
  // half-erased, smudged warning
  ctx.save();
  ctx.filter = 'blur(2.2px)';
  marker(ctx, "DON'T LOOK BEHIND YOU", 360, 640, 50, red, rng, { weight: 'bold' });
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.filter = 'blur(10px)';
  for (let i = 0; i < 7; i++) { ctx.fillStyle = `rgba(0,0,0,${0.35 + rng.next() * 0.45})`; ctx.fillRect(80 + i * 85 + rng.next() * 30, 600 + rng.next() * 30, 60 + rng.next() * 50, 30 + rng.next() * 40); }
  ctx.restore();
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#eceee9'; ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  ctx.save(); ctx.filter = 'blur(6px)'; ctx.fillStyle = 'rgba(160,120,120,0.12)'; ctx.fillRect(100, 610, 560, 60); ctx.restore();
}
region('lug_tag', 64, 112, (ctx, w, h, rng) => {
  ctx.fillStyle = '#c4a26a'; rrect(ctx, 2, 2, 60, 108, 8); ctx.fill();
  ctx.fillStyle = '#efe9d8'; ctx.fillRect(8, 26, 48, 74);
  ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(32, 13, 5, 0, TAU); ctx.fill();
  txt(ctx, 'NAME', 12, 34, 7, '#444', { align: 'left' });
  marker(ctx, 'M. Halloran', 32, 46, 9, '#1a2a8a', rng, { weight: 'normal' });
  txt(ctx, 'DEST.', 12, 62, 7, '#444', { align: 'left' });
  marker(ctx, 'HOME', 32, 76, 12, '#1a2a8a', rng);
  marker(ctx, '(please)', 32, 90, 8, '#1a2a8a', rng, { weight: 'normal' });
});
export const CONTINENTS = [
  [[-168, 66], [-162, 70], [-140, 70], [-120, 72], [-95, 74], [-80, 72], [-62, 66], [-56, 52], [-66, 44], [-75, 35], [-81, 25], [-81, 31], [-90, 30], [-97, 26], [-97, 20], [-88, 15], [-83, 9], [-78, 8], [-85, 13], [-92, 15], [-105, 20], [-112, 30], [-118, 34], [-124, 40], [-124, 48], [-135, 58], [-150, 60], [-160, 58], [-165, 62]],
  [[-55, 60], [-44, 60], [-20, 70], [-20, 80], [-40, 83], [-65, 80], [-72, 77], [-60, 70]],
  [[-80, 8], [-72, 12], [-62, 10], [-50, 0], [-35, -6], [-40, -22], [-48, -28], [-58, -38], [-65, -42], [-68, -55], [-74, -50], [-72, -35], [-71, -18], [-76, -14], [-81, -5]],
  [[-10, 36], [-9, 43], [-2, 44], [-4, 48], [5, 52], [8, 57], [5, 62], [15, 69], [28, 71], [40, 67], [60, 70], [80, 73], [100, 77], [120, 73], [140, 72], [160, 70], [180, 68], [180, 62], [163, 60], [155, 58], [140, 52], [142, 46], [135, 43], [130, 35], [122, 40], [120, 30], [110, 20], [106, 10], [100, 13], [98, 8], [104, 1], [96, 17], [92, 22], [88, 21], [80, 15], [77, 8], [72, 20], [67, 25], [57, 25], [56, 27], [50, 30], [48, 29], [52, 24], [59, 22], [55, 17], [44, 12], [42, 16], [35, 28], [33, 31], [36, 36], [28, 36], [26, 40], [23, 38], [20, 40], [16, 38], [12, 44], [8, 44], [3, 42], [-1, 37], [-6, 36]],
  [[-17, 15], [-17, 21], [-13, 27], [-6, 35], [10, 37], [20, 31], [32, 31], [34, 28], [43, 12], [51, 12], [44, 0], [40, -15], [35, -24], [32, -29], [20, -35], [17, -29], [12, -17], [13, -5], [9, 4], [0, 5], [-8, 4], [-13, 8]],
  [[114, -22], [122, -18], [130, -12], [137, -12], [142, -11], [146, -19], [153, -26], [150, -37], [143, -39], [135, -35], [129, -32], [115, -34]],
  [[-5, 50], [1, 51], [0, 54], [-3, 58], [-6, 56]], [[130, 31], [135, 34], [141, 38], [142, 45], [140, 41], [133, 35]],
  [[44, -16], [50, -15], [49, -25], [44, -24]], [[95, 5], [105, -6], [115, -8], [120, -2], [110, 2]], [[166, -46], [174, -36], [178, -38], [170, -46]],
];
region('globe', 512, 256, (ctx, w, h, rng) => {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#5b8c94'); g.addColorStop(0.5, '#4a7f8d'); g.addColorStop(1, '#5b8c94');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const P = (lon, lat) => [((lon + 180) / 360) * w, ((90 - lat) / 180) * h];
  const cols = ['#d8c48a', '#c9b47a', '#b9c486', '#d6b98a', '#c8a978', '#d9c08c'];
  CONTINENTS.forEach((poly, i) => {
    ctx.beginPath(); poly.forEach(([lo, la], j) => { const [x, y] = P(lo, la); if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath();
    ctx.fillStyle = cols[i % cols.length]; ctx.fill(); ctx.strokeStyle = 'rgba(70,50,30,0.7)'; ctx.lineWidth = 1.2; ctx.stroke();
  });
  ctx.fillStyle = '#eef0ea'; ctx.beginPath(); ctx.moveTo(0, h); for (let x = 0; x <= w; x += 16) ctx.lineTo(x, h - 18 - rng.next() * 10); ctx.lineTo(w, h); ctx.fill();
  ctx.strokeStyle = 'rgba(30,40,50,0.25)'; ctx.lineWidth = 1;
  for (let lo = 0; lo < 360; lo += 30) { const x = (lo / 360) * w; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let la = -60; la <= 60; la += 30) { const y = ((90 - la) / 180) * h; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  ctx.fillStyle = 'rgba(240,232,205,0.9)'; rrect(ctx, 150, 150, 70, 26, 4); ctx.fill();
  txt(ctx, 'WORLD', 185, 158, 9, '#4a3a2a', { fam: 'serif' }); txt(ctx, 'ROOM CORP 1993', 185, 169, 6, '#4a3a2a', { fam: 'serif' });
});
region('sandbag_print', 128, 64, (ctx, w, h, rng) => {
  txt(ctx, 'ROOM CORP', w / 2, 20, 16, 'rgba(30,25,20,0.7)', { fam: 'mono' });
  txt(ctx, 'SAND · 25 KG', w / 2, 44, 14, 'rgba(30,25,20,0.7)', { fam: 'mono' });
  grunge(ctx, w, h, rng, 300, 1, 2);
});
region('tire_text', 1024, 32, (ctx, w, h) => {
  for (const x of [w * 0.25, w * 0.75]) {
    txt(ctx, 'ROADMASTER  ALL-SEASON', x - 40, 16, 22, 'rgba(230,230,225,0.95)');
    txt(ctx, '205/65 R15', x + 190, 16, 16, 'rgba(200,200,195,0.85)', { fam: 'mono' });
  }
});

// --- added for the remake ---
region('tape', 128, 32, (ctx, w, h, rng) => {
  ctx.fillStyle = 'rgba(196,160,104,0.78)'; ctx.fillRect(0, 2, w, h - 4);
  ctx.fillStyle = 'rgba(255,240,200,0.18)'; ctx.fillRect(0, 4, w, 3);
  for (let i = 0; i < 24; i++) { ctx.fillStyle = `rgba(${rng.next() > 0.5 ? '255,245,220' : '120,90,50'},${0.06 + rng.next() * 0.1})`; ctx.fillRect(rng.next() * w, 2 + rng.next() * (h - 6), 4 + rng.next() * 30, 1 + rng.next() * 2); }
  ctx.clearRect(0, 0, w, 2); ctx.clearRect(0, h - 2, w, 2);
});

// leaf cards (alpha cut-outs, drawn base at the bottom, tip at the top of each cell)
function leafPath(ctx, cx, y0, y1, hw, tip = 0.25) {
  const L = y0 - y1;
  ctx.beginPath();
  ctx.moveTo(cx, y0);
  ctx.bezierCurveTo(cx - hw * 0.9, y0 - L * 0.12, cx - hw * 1.08, y0 - L * 0.55, cx - hw * 0.5, y1 + L * tip);
  ctx.quadraticCurveTo(cx - hw * 0.12, y1 + L * 0.05, cx, y1);
  ctx.quadraticCurveTo(cx + hw * 0.12, y1 + L * 0.05, cx + hw * 0.5, y1 + L * tip);
  ctx.bezierCurveTo(cx + hw * 1.08, y0 - L * 0.55, cx + hw * 0.9, y0 - L * 0.12, cx, y0);
  ctx.closePath();
}
function drawLeaf(ctx, x, y, w, h, rng, o) {
  const cx = x + w / 2, y0 = y + h - 2, y1 = y + 3, hw = w * 0.46;
  ctx.save();
  leafPath(ctx, cx, y0, y1, hw, o.tip ?? 0.25);
  ctx.clip();
  const g = ctx.createLinearGradient(x, y0, x + w, y1);
  g.addColorStop(0, o.c0); g.addColorStop(1, o.c1);
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  // mottling + dying spots
  for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(${rng.next() > 0.5 ? '255,255,200' : '0,20,0'},${rng.next() * 0.06})`; ctx.beginPath(); ctx.arc(x + rng.next() * w, y + rng.next() * h, 1 + rng.next() * w * 0.12, 0, TAU); ctx.fill(); }
  if (o.spots) for (let i = 0; i < o.spots; i++) { ctx.fillStyle = `rgba(${120 + rng.next() * 60},${90 + rng.next() * 40},30,${0.4 + rng.next() * 0.4})`; ctx.beginPath(); ctx.arc(cx + (rng.next() - 0.5) * hw * 1.4, y1 + rng.next() * (y0 - y1), 1 + rng.next() * 3.5, 0, TAU); ctx.fill(); }
  // veins
  ctx.strokeStyle = o.vein; ctx.lineWidth = Math.max(1, w * 0.035);
  ctx.beginPath(); ctx.moveTo(cx, y0); ctx.quadraticCurveTo(cx + w * 0.03, (y0 + y1) / 2, cx, y1 + 2); ctx.stroke();
  ctx.lineWidth = Math.max(0.6, w * 0.012); ctx.globalAlpha = 0.55;
  for (let k = 1; k < 9; k++) {
    const t = k / 9, yy = y0 - (y0 - y1) * t;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx, yy); ctx.quadraticCurveTo(cx + s * hw * 0.5, yy - h * 0.04, cx + s * hw * 0.9, yy - h * 0.1); ctx.stroke(); }
  }
  ctx.globalAlpha = 1;
  // darker rim
  ctx.strokeStyle = o.rim; ctx.lineWidth = 2.5; leafPath(ctx, cx, y0, y1, hw, o.tip ?? 0.25); ctx.stroke();
  ctx.restore();
}
region('leaf_ficus', 320, 128, (ctx, w, h, rng) => {
  const looks = [
    { c0: '#2f5a22', c1: '#4c7a32', vein: 'rgba(170,200,120,0.6)', rim: 'rgba(20,40,10,0.6)' },
    { c0: '#2a4f1e', c1: '#3f6a2a', vein: 'rgba(160,190,110,0.6)', rim: 'rgba(20,40,10,0.6)' },
    { c0: '#3a6428', c1: '#5c8a3a', vein: 'rgba(190,210,140,0.6)', rim: 'rgba(30,50,15,0.5)', spots: 4 },
    { c0: '#6a7a2a', c1: '#a89a3a', vein: 'rgba(220,210,140,0.6)', rim: 'rgba(90,70,20,0.6)', spots: 10 },
    { c0: '#7a5a28', c1: '#b0883e', vein: 'rgba(220,190,120,0.5)', rim: 'rgba(80,50,20,0.7)', spots: 16 },
  ];
  looks.forEach((o, i) => drawLeaf(ctx, i * 64, 0, 64, 128, rng, o));
});
region('leaf_rubber', 256, 192, (ctx, w, h, rng) => {
  drawLeaf(ctx, 0, 0, 128, 192, rng, { c0: '#16301a', c1: '#24462a', vein: 'rgba(200,190,150,0.7)', rim: 'rgba(60,20,20,0.5)', tip: 0.18 });
  drawLeaf(ctx, 128, 0, 128, 192, rng, { c0: '#1c3a1e', c1: '#2e5432', vein: 'rgba(210,200,160,0.7)', rim: 'rgba(70,30,20,0.5)', tip: 0.18, spots: 3 });
});
