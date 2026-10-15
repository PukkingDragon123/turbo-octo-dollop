// Level 0 haul-and-sell furniture: dresser, nightstand, low cabinet (credenza), arcade cabinet, upright piano,
// plus party decor for the frozen office party (cake, balloon, party hat). Containers expose an animated part
// ('drawer0' / 'door') that the loot-container behaviour (entities/lootables.js) slides or swings open.
import * as THREE from 'three';
import { def, CB, CC, CS, PI, HP } from './core.js';
import { matFor, tint } from './mats.js';
import { region, txt, grunge } from './atlas.js';
import { glide, barPull, hinge } from './parts.js';

// --- printed artwork -------------------------------------------------------------------------------------------
region('arcade_screen', 256, 192, (ctx, w, h, rng) => {
  ctx.fillStyle = '#04060a'; ctx.fillRect(0, 0, w, h);
  // attract mode: a maze of yellow corridors, dots, a glowing title
  ctx.strokeStyle = '#2a48c8'; ctx.lineWidth = 5;
  for (let k = 0; k < 7; k++) { ctx.strokeRect(14 + k * 4, 34 + k * 3, w - 28 - k * 8, h - 52 - k * 6); if (k > 1) break; }
  ctx.fillStyle = '#e8d84a';
  for (let y = 58; y < h - 26; y += 16) for (let x = 30; x < w - 26; x += 16) if (rng.next() < 0.7) ctx.fillRect(x, y, 3, 3);
  ctx.beginPath(); ctx.arc(90, 110, 11, 0.6, PI * 2 - 0.6); ctx.lineTo(90, 110); ctx.fill();
  ctx.fillStyle = '#d83a2a'; ctx.beginPath(); ctx.arc(160, 98, 10, PI, 0); ctx.lineTo(170, 112); ctx.lineTo(150, 112); ctx.fill();
  txt(ctx, 'BACKROOMS', w / 2, 16, 20, '#f2c13a', { fam: 'mono' });
  txt(ctx, 'INSERT COIN', w / 2, h - 12, 12, '#e6e6e6', { fam: 'mono' });
});
region('arcade_marquee', 256, 64, (ctx, w, h, rng) => {
  const g = ctx.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#5a1a6e'); g.addColorStop(0.5, '#d0386e'); g.addColorStop(1, '#f2a43a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  txt(ctx, 'NO-CLIP', w / 2, h / 2 - 2, 34, '#fff6c8', { fam: 'mono' });
  txt(ctx, '★ 1 PLAYER · 1 COIN ★', w / 2, h - 9, 9, '#2a0a2e', { fam: 'mono' });
  grunge(ctx, w, h, rng, 120, 0.8, 2);
});
region('arcade_cpanel', 256, 96, (ctx, w, h) => {
  ctx.fillStyle = '#1b1b1e'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#d0386e'; ctx.lineWidth = 3; ctx.strokeRect(6, 6, w - 12, h - 12);
  txt(ctx, 'PUSH   ◀ ▶   JUMP', w / 2, h - 16, 12, '#c8c8c8', { fam: 'mono' });
});
region('piano_brand', 160, 28, (ctx, w, h) => {
  txt(ctx, 'Hollowell & Sons', w / 2, h / 2, 17, '#cfb27a', { fam: 'serif' });
});
region('party_banner', 512, 96, (ctx, w, h, rng) => {
  ctx.clearRect(0, 0, w, h);
  const cols = ['#d83a3a', '#f2c13a', '#3a8ad8', '#5ac85a', '#d86ad0'];
  const text = 'HAPPY 10 YEARS GARY';
  const n = text.length, pw = w / n;
  for (let k = 0; k < n; k++) {
    if (text[k] === ' ') continue;
    ctx.fillStyle = cols[k % cols.length];
    ctx.beginPath(); ctx.moveTo(k * pw + 2, 6); ctx.lineTo((k + 1) * pw - 2, 6); ctx.lineTo(k * pw + pw / 2, h - 4); ctx.closePath(); ctx.fill();
    txt(ctx, text[k], k * pw + pw / 2, 30, 22, '#fff', { fam: 'sans' });
  }
  ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(w, 6); ctx.stroke();
  grunge(ctx, w, h, rng, 80, 0.6, 2);
});
region('cake_top', 128, 128, (ctx, w, h) => {
  ctx.fillStyle = '#f4ece0'; ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 2, 0, PI * 2); ctx.fill();
  ctx.strokeStyle = '#d86aa0'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 10, 0, PI * 2); ctx.stroke();
  txt(ctx, '10', w / 2, h / 2 - 8, 30, '#3a8ad8', { fam: 'serif' });
  txt(ctx, 'YEARS', w / 2, h / 2 + 20, 14, '#d86aa0', { fam: 'serif' });
});

// ===========================================================================
// Four-drawer bedroom dresser: veneered carcass, overhanging top, plinth, brass bar pulls.
// gv 1: the top row is split into two small drawers. drawer0 (top / top-left) slides out (loot).
// ===========================================================================
def('dresser', {
  variants: 4,
  geoVariant: (v) => v % 2,
  mats: (o, v) => ({ wood: matFor(['walnut', 'teak', 'oak', 'cherry'][v]) }),
  build(b, gv) {
    const W = 0.92, H = 0.86, D = 0.46, t = 0.02;
    for (const s of [-1, 1]) b.box('wood', t, H - 0.028, D - 0.012, s * (W / 2 - t / 2), (H - 0.028) / 2, -0.004, { r: 0.003, grain: 'y', wear: 0.012 });
    b.box('wood', W + 0.03, 0.028, D + 0.016, 0, H - 0.014, 0.004, { r: 0.006, seg: 2, grain: 'x', wear: 0.016 });
    b.box('#2e241c', W - 2 * t, H - 0.06, 0.006, 0, (H - 0.028) / 2, -D / 2 + 0.004, { r: 0, wear: 0 });
    b.box('wood', W - 2 * t, 0.07, 0.02, 0, 0.035, D / 2 - 0.03, { r: 0.002, grain: 'x' });
    b.box('#1a1512', W - 2 * t, H - 0.11, 0.004, 0, (H + 0.07 - 0.028) / 2, D / 2 - 0.035, { r: 0, wear: 0 });
    const rows = gv ? [0.15, 0.19, 0.19, 0.19] : [0.13, 0.2, 0.2, 0.19];
    const fz = D / 2 - 0.012;
    let y = H - 0.028 - 0.006;
    rows.forEach((dh, i) => {
      const cy = y - dh / 2;
      const fronts = gv === 1 && i === 0 ? [[-W / 4 + 0.005, W / 2 - 0.03], [W / 4 - 0.005, W / 2 - 0.03]] : [[0, W - 2 * t - 0.012]];
      fronts.forEach(([fx, fw], k) => {
        const p = i === 0 && k === 0 ? b.part('drawer0', fx, cy, fz, { axis: 'z', maxOpen: 0.3 }) : b;
        p.box('wood', fw, dh - 0.006, 0.022, fx, cy, fz, { r: 0.004, grain: 'x', wear: 0.012 });
        barPull(p, '#c9a65a:m', fx, cy, fz + 0.011, Math.min(0.12, fw * 0.3), { d: 0.022, r: 0.0042 });
        if (p !== b) {
          // drawer box (visible when it is pulled out)
          const bd = D - 0.08, bz = fz - 0.011 - bd / 2;
          for (const s of [-1, 1]) p.box('wood', 0.01, dh - 0.04, bd, fx + s * (fw / 2 - 0.03), cy - 0.01, bz, { r: 0, grain: 'z' });
          p.box('#cdbb98', fw - 0.06, 0.006, bd, fx, cy - dh / 2 + 0.02, bz, { r: 0, wear: 0 });
          p.box('wood', fw - 0.06, dh - 0.04, 0.01, fx, cy - 0.01, fz - 0.011 - bd, { r: 0, grain: 'x' });
        }
      });
      y -= dh + 0.006;
    });
    b.decal('asset_tag', 0.07, 0.026, W / 2 + 0.0006, 0.5, 0.1, { rot: [0, HP, 0], slot: 'atlas' });
    return {
      colliders: [CB(W + 0.03, H, D + 0.02, 0, H / 2, 0.004)],
      mass: 46, material: 'wood', friction: 0.32, breakInto: ['plank', 'plank', 'plank', 'screws'],
      anchors: { top: [0, H, 0] },
    };
  },
});

// ===========================================================================
// Nightstand: one drawer over an open shelf (with a forgotten paperback), short tapered legs.
// ===========================================================================
def('nightstand', {
  variants: 3,
  mats: (o, v) => ({ wood: matFor(['walnut', 'oak', 'laminate'][v]) }),
  build(b) {
    const W = 0.46, H = 0.6, D = 0.38, legH = 0.09, t = 0.016;
    const y0 = legH;
    for (const s of [-1, 1]) b.box('wood', t, H - y0 - 0.02, D - 0.01, s * (W / 2 - t / 2), y0 + (H - y0 - 0.02) / 2, 0, { r: 0.003, grain: 'y', wear: 0.01 });
    b.box('wood', W + 0.02, 0.022, D + 0.014, 0, H - 0.011, 0.004, { r: 0.005, seg: 2, grain: 'x', wear: 0.014 });
    b.box('wood', W - 2 * t, t, D - 0.01, 0, y0 + t / 2, 0, { r: 0.002, grain: 'x' });
    b.box('wood', W - 2 * t, t, D - 0.03, 0, y0 + 0.2, -0.01, { r: 0.002, grain: 'x' });
    b.box('#2e241c', W - 2 * t, H - y0 - 0.03, 0.005, 0, y0 + (H - y0) / 2, -D / 2 + 0.004, { r: 0, wear: 0 });
    // legs
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.cyl('wood', 0.018, legH, sx * (W / 2 - 0.035), legH / 2, sz * (D / 2 - 0.035), { rt: 0.02, rb: 0.012, seg: 10 });
      glide(b, '#2a2927', sx * (W / 2 - 0.035), 0, sz * (D / 2 - 0.035), 0.01, 0.003);
    }
    // drawer (loot)
    const dh = 0.13, cy = H - 0.022 - 0.006 - dh / 2, fz = D / 2 - 0.01;
    const p = b.part('drawer0', 0, cy, fz, { axis: 'z', maxOpen: 0.22 });
    p.box('wood', W - 2 * t - 0.01, dh, 0.02, 0, cy, fz, { r: 0.004, grain: 'x', wear: 0.012 });
    p.cyl('#c9a65a:m', 0.011, 0.022, 0, cy, fz + 0.021, { axis: 'z', seg: 12, bevel: 0.004 });
    const bd = D - 0.06, bz = fz - 0.01 - bd / 2;
    for (const s of [-1, 1]) p.box('wood', 0.008, dh - 0.03, bd, s * (W / 2 - t - 0.012), cy - 0.008, bz, { r: 0 });
    p.box('#cdbb98', W - 2 * t - 0.03, 0.005, bd, 0, cy - dh / 2 + 0.012, bz, { r: 0, wear: 0 });
    // paperback on the shelf
    b.box('#8a2e24', 0.13, 0.025, 0.19, -0.05, y0 + t + 0.0125, 0.03, { r: 0.002, rot: [0, 0.3, 0] });
    b.box('#e8dfc8', 0.122, 0.02, 0.182, -0.05, y0 + t + 0.0125, 0.03, { r: 0.001, rot: [0, 0.3, 0] });
    return {
      colliders: [CB(W + 0.02, H - legH, D + 0.014, 0, legH + (H - legH) / 2, 0.004), CB(W - 0.04, legH, D - 0.04, 0, legH / 2, 0)],
      mass: 14, material: 'wood', friction: 0.35, breakInto: ['plank', 'plank', 'screws'],
      anchors: { top: [0, H, 0] },
    };
  },
});

// ===========================================================================
// Low office storage cabinet (credenza): painted steel or laminate, two hinged doors, a shelf inside.
// 'door' (left leaf, hinged on its outer edge) swings open.
// ===========================================================================
def('cabinet_low', {
  variants: 4,
  mats: (o, v) => ({ body: v < 2 ? tint('paint_beige', [0xc7bc9c, 0x8f9295][v]) : matFor(v === 2 ? 'laminate' : 'laminate_grey') }),
  build(b) {
    const W = 0.92, H = 0.8, D = 0.45, t = 0.018, y0 = 0.05;
    for (const s of [-1, 1]) b.box('body', t, H - 0.02, D - 0.01, s * (W / 2 - t / 2), (H - 0.02) / 2, 0, { r: 0.004, grain: 'y', wear: 0.012 });
    b.box('body', W + 0.012, 0.024, D + 0.012, 0, H - 0.012, 0.003, { r: 0.005, seg: 2, grain: 'x', wear: 0.014 });
    b.box('body', W - 2 * t, t, D - 0.02, 0, y0 + t / 2, 0, { r: 0.002 });
    b.box('#161514', W - 2 * t, y0, 0.016, 0, y0 / 2, D / 2 - 0.03, { r: 0.002 });
    b.box('body', W - 2 * t, H - y0 - 0.03, 0.008, 0, (H + y0) / 2 - 0.01, -D / 2 + 0.006, { r: 0 });
    b.box('body', W - 2 * t, 0.012, D - 0.05, 0, y0 + 0.36, -0.01, { r: 0.002 });
    // binders on the inner shelf
    for (let k = 0; k < 6; k++) b.box(['#2f4f7a', '#8a2e24', '#2f5e3a', '#d8b021', '#2f4f7a', '#3c3e41'][k], 0.05, 0.28, 0.24, -0.38 + k * 0.055, y0 + 0.372 + 0.14, -0.04, { r: 0.002 });
    const fz = D / 2 - 0.008, dw = (W - 2 * t) / 2 - 0.004, dh = H - y0 - 0.04, cy = y0 + 0.006 + dh / 2;
    // left door (animated): hinge at the outer left edge
    const hx = -W / 2 + t;
    const p = b.part('door', hx, cy, fz, { axis: 'y', maxOpen: -1.75 });
    p.box('body', dw, dh, 0.018, hx + dw / 2, cy, fz, { r: 0.004, grain: 'y', wear: 0.012 });
    barPull(p, '#c8ccce:m', hx + dw - 0.04, cy + 0.12, fz + 0.009, 0.12, { rot: [0, 0, HP], d: 0.024 });
    // right door (static)
    b.box('body', dw, dh, 0.018, W / 2 - t - dw / 2, cy, fz, { r: 0.004, grain: 'y', wear: 0.012 });
    barPull(b, '#c8ccce:m', W / 2 - t - dw + 0.04, cy + 0.12, fz + 0.009, 0.12, { rot: [0, 0, HP], d: 0.024 });
    for (const hy of [y0 + 0.08, H - 0.1]) { hinge(b, '#9a9c9e', hx + 0.002, hy, fz + 0.004, 0.05, 0.004, { leaves: false }); hinge(b, '#9a9c9e', W / 2 - t - 0.002, hy, fz + 0.004, 0.05, 0.004, { leaves: false }); }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) glide(b, '#2a2927', sx * (W / 2 - 0.04), 0, sz * (D / 2 - 0.05), 0.012, 0.005);
    b.decal('asset_tag', 0.07, 0.026, W / 2 + 0.0006, 0.62, 0.1, { rot: [0, HP, 0], slot: 'atlas' });
    return {
      colliders: [CB(W + 0.012, H, D + 0.012, 0, H / 2, 0.003)],
      mass: 34, material: 'metal', friction: 0.32, breakInto: ['metal_scrap', 'plank', 'screws'],
      anchors: { top: [0, H, 0] },
    };
  },
});

// ===========================================================================
// Upright arcade cabinet: profiled side panels with T-molding, glowing marquee, CRT in a bezel, control panel
// with joystick and buttons, coin door. Heavy and worth a lot at the pads.
// ===========================================================================
def('arcade_cabinet', {
  variants: 3,
  mats: (o, v) => ({ body: tint('paint_black', [0x1d1c22, 0x2a1e3a, 0x14243a][v]) }),
  build(b) {
    const W = 0.66, sideT = 0.019;
    // side profile (model z, y): front base, control panel ledge, sloped screen, marquee box, back
    const prof = [[0.34, 0.004], [0.34, 0.86], [0.44, 0.9], [0.44, 0.96], [0.2, 1.02], [0.12, 1.5], [0.24, 1.54], [0.24, 1.8], [-0.4, 1.8], [-0.4, 0.004]];
    const sh = new THREE.Shape(prof.map(([z, y]) => new THREE.Vector2(-z, y)));
    for (const s of [-1, 1]) b.ext('body', sh, sideT, s * (W / 2 - sideT / 2), 0, 0, { rot: [0, HP, 0], bevel: 0.004, bevelSeg: 1, curveSeg: 2 });
    // T-molding along the side edges (purple) = a slightly larger profile, thin
    for (const s of [-1, 1]) b.ext('#7a2a8a:g', sh, 0.006, s * (W / 2 - 0.001), 0, 0, { rot: [0, HP, 0], curveSeg: 2 });
    const iw = W - 2 * sideT;
    // front kick + coin door
    b.box('body', iw, 0.86, 0.018, 0, 0.43, 0.33, { r: 0.002, grain: 'y' });
    b.box('#3a3a3e:m', 0.28, 0.3, 0.012, 0, 0.45, 0.345, { r: 0.004 });
    for (const s of [-1, 1]) {
      b.box('#d83a2a:e', 0.026, 0.05, 0.006, s * 0.06, 0.5, 0.352, { r: 0.002 });
      b.box('#111', 0.004, 0.03, 0.004, s * 0.06, 0.5, 0.356, { r: 0 });
    }
    // control panel (sloped)
    const cpTilt = Math.atan2(0.06, 0.24);
    b.box('body', iw, 0.03, 0.27, 0, 0.935, 0.33, { r: 0.004, rot: [cpTilt, 0, 0] });
    b.decal('arcade_cpanel', iw - 0.02, 0.24, 0, 0.952, 0.33, { rot: [-HP + cpTilt, 0, 0], slot: 'atlas' });
    // joystick + buttons
    b.cyl('#1a1a1a', 0.008, 0.07, -0.14, 0.99, 0.33, { seg: 8 });
    b.sphere('#d83a2a:g', 0.02, -0.14, 1.03, 0.33, { ws: 12, hs: 8 });
    for (let k = 0; k < 3; k++) b.cyl(['#f2c13a:g', '#3a8ad8:g', '#5ac85a:g'][k], 0.016, 0.014, 0.04 + k * 0.06, 0.965, 0.34 - k * 0.006, { seg: 14, bevel: 0.003, rot: [cpTilt, 0, 0] });
    // screen: black bezel, CRT glass, attract-mode picture (glowing)
    const scrTilt = Math.atan2(0.08, 0.48);
    const sy = 1.26, sz = 0.165;
    b.box('#0b0b0d', iw, 0.5, 0.02, 0, sy, sz - 0.012, { r: 0.002, rot: [-scrTilt, 0, 0] });
    b.decal('arcade_screen', 0.42, 0.32, 0, sy, sz + 0.0005, { rot: [-scrTilt, 0, 0], slot: 'glow' });
    // marquee
    b.box('#101012', iw, 0.24, 0.02, 0, 1.67, 0.235, { r: 0.002 });
    b.decal('arcade_marquee', iw - 0.03, 0.2, 0, 1.67, 0.2465, { slot: 'glow' });
    // top + back
    b.box('body', iw, 0.018, 0.64, 0, 1.791, -0.08, { r: 0.002 });
    b.box('body', iw, 1.78, 0.018, 0, 0.89, -0.39, { r: 0.002, grain: 'y' });
    b.box('#222', 0.12, 0.08, 0.01, 0.12, 0.2, -0.402, { r: 0.002 });
    // levelling feet
    for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) b.cyl('#1a1a1a', 0.02, 0.012, sx * 0.26, 0.006, sz2 * 0.3 - 0.03, { seg: 10 });
    return {
      colliders: [CB(W, 1.8, 0.74, 0, 0.9, -0.03), CB(W, 0.1, 0.12, 0, 0.92, 0.38)],
      mass: 115, material: 'wood', friction: 0.4, breakInto: ['plank', 'plank', 'electronics', 'glass_shard', 'wire', 'screws'],
      anchors: { top: [0, 1.8, -0.08] },
    };
  },
});

// ===========================================================================
// Upright piano: lacquered case with a lid, music desk, fallboard over 52 white / 36 black keys, toe blocks,
// brass pedals and castors. Very heavy: a team job (or the trolley).
// ===========================================================================
def('piano', {
  variants: 2,
  mats: (o, v) => ({ body: tint('paint_black', v ? 0x3a2418 : 0x141313) }),
  build(b) {
    const W = 1.46, H = 1.22, D = 0.58;
    // case
    for (const s of [-1, 1]) b.box('body', 0.04, H, D, s * (W / 2 - 0.02), H / 2, 0, { r: 0.008, seg: 2, grain: 'y', wear: 0.008 });
    b.box('body', W, 0.03, D + 0.02, 0, H - 0.015, 0.0, { r: 0.008, seg: 2, grain: 'x', wear: 0.01 });
    b.box('body', W - 0.08, H - 0.7, 0.03, 0, 0.7 + (H - 0.7) / 2 - 0.02, 0.06, { r: 0.004, grain: 'x' });   // upper front panel
    b.box('body', W - 0.08, 0.56, 0.03, 0, 0.32, 0.1, { r: 0.004, grain: 'x' });                          // lower panel
    b.box('body', W - 0.08, H - 0.04, 0.02, 0, H / 2, -D / 2 + 0.01, { r: 0.002 });                       // back
    // key bed + keys
    const kz = 0.2, ky = 0.72;
    b.box('body', W - 0.08, 0.05, 0.3, 0, ky - 0.03, kz, { r: 0.004 });
    const nW = 52, kw = (W - 0.12) / nW;
    for (let k = 0; k < nW; k++) b.box('#eeeae0:g', kw - 0.0016, 0.022, 0.15, -W / 2 + 0.06 + (k + 0.5) * kw, ky + 0.006, kz + 0.06, { r: 0 });
    const pat = [1, 1, 0, 1, 1, 1, 0];
    for (let k = 0; k < nW - 1; k++) if (pat[(k + 5) % 7]) b.box('#151515:g', kw * 0.55, 0.03, 0.09, -W / 2 + 0.06 + (k + 1) * kw, ky + 0.022, kz + 0.03, { r: 0 });
    // key slip + cheek blocks, fallboard (raised), music desk
    b.box('body', W - 0.08, 0.04, 0.02, 0, ky - 0.01, kz + 0.15, { r: 0.004 });
    for (const s of [-1, 1]) b.box('body', 0.04, 0.09, 0.32, s * (W / 2 - 0.06), ky + 0.02, kz + 0.01, { r: 0.006 });
    b.box('body', W - 0.16, 0.13, 0.02, 0, ky + 0.13, kz - 0.06, { r: 0.004, rot: [-0.25, 0, 0] });
    b.decal('piano_brand', 0.22, 0.04, 0, ky + 0.15, kz - 0.044, { rot: [-0.25, 0, 0], slot: 'atlas' });
    // toe blocks + legs
    for (const s of [-1, 1]) {
      b.box('body', 0.06, 0.05, 0.36, s * (W / 2 - 0.06), 0.025, 0.12, { r: 0.006 });
      b.cyl('body', 0.03, 0.62, s * (W / 2 - 0.06), 0.36, kz + 0.1, { rt: 0.034, rb: 0.026, seg: 12 });
    }
    // pedals
    for (let k = -1; k <= 1; k++) b.box('#c9a65a:m', 0.035, 0.012, 0.09, k * 0.08, 0.07, 0.15 + 0.045, { r: 0.004, rot: [0.15, 0, 0] });
    // castors
    for (const sx of [-1, 1]) for (const sz of [-0.2, 0.2]) b.cyl('#c9a65a:m', 0.018, 0.024, sx * (W / 2 - 0.05), 0.018, sz, { axis: 'x', seg: 10 });
    return {
      colliders: [CB(W, H, D, 0, H / 2, 0), CB(W - 0.08, 0.12, 0.3, 0, ky, kz + 0.04)],
      mass: 230, material: 'wood', friction: 0.45, breakInto: ['plank', 'plank', 'plank', 'wire', 'metal_scrap'],
      anchors: { top: [0, H, 0] },
    };
  },
});

// ===========================================================================
// Party decor (frozen office party): sheet cake, helium balloon on a ribbon, cone party hat.
// ===========================================================================
def('cake', {
  ao: false,
  build(b) {
    b.box('#d8d2c4:g', 0.36, 0.008, 0.26, 0, 0.004, 0, { r: 0.002 });
    b.box('#f2ece2', 0.3, 0.09, 0.2, 0, 0.008 + 0.045, 0, { r: 0.012, seg: 2 });
    b.decal('cake_top', 0.18, 0.18, 0, 0.0985, 0, { rot: [-HP, 0, 0], slot: 'atlas' });
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * PI * 2;
      b.cyl(['#d86aa0', '#3a8ad8', '#f2c13a'][k % 3], 0.003, 0.05, Math.cos(a) * 0.11, 0.123, Math.sin(a) * 0.075, { seg: 6 });
    }
    // a slice missing: a dark wedge cut on one corner, frosting rosettes
    for (let k = 0; k < 8; k++) b.sphere('#f8f2ea', 0.012, -0.13 + k * 0.037, 0.1, 0.095, { ws: 8, hs: 5 });
    return { colliders: [CB(0.36, 0.13, 0.26, 0, 0.065, 0)], mass: 2.2, material: 'cardboard' };
  },
});
def('balloon', {
  variants: 4,
  mats: (o, v) => ({ shell: tint('plastic_red', [0xd83a3a, 0x3a8ad8, 0xf2c13a, 0x5ac85a][v]) }),
  ao: false,
  build(b) {
    b.sphere('shell', 0.15, 0, 1.4, 0, { ws: 16, hs: 12, scale: [1, 1.18, 1] });
    b.cyl('shell', 0.012, 0.025, 0, 1.4 - 0.18, 0, { rt: 0.004, rb: 0.012, seg: 8 });
    b.tube('#e8e2d2', [[0, 1.2, 0], [0.03, 0.9, 0.01], [-0.02, 0.6, -0.02], [0.02, 0.3, 0.0], [0, 0.002, 0]], 0.0015, { radial: 3 });
    b.box('#c9c4b8', 0.04, 0.004, 0.04, 0, 0.002, 0, { r: 0.001 });
    return { colliders: [CS(0.15, 0, 1.4, 0)], mass: 0.05, material: 'plastic', floatOK: true };
  },
});
def('party_hat', {
  variants: 3,
  mats: (o, v) => ({ shell: tint('plastic_red', [0xd86ad0, 0x3a8ad8, 0xf2c13a][v]) }),
  ao: false,
  build(b) {
    b.lathe('shell', [[0.07, 0], [0.004, 0.17], [0, 0.17]], 0, 0, 0, { seg: 14 });
    b.sphere('#f2ece2', 0.018, 0, 0.175, 0, { ws: 8, hs: 6 });
    return { colliders: [CC(0.06, 0.17, 0, 0.085, 0)], mass: 0.03, material: 'cardboard' };
  },
});
def('party_banner', {
  ao: false,
  build(b) {
    // a pennant string: printed flags hanging off a cord, pinned at both ends (front +Z, against a wall)
    b.decal('party_banner', 2.6, 0.48, 0, 0, 0.012, { slot: 'atlas' });
    b.tube('#e8e2d2', [[-1.35, 0.25, 0.01], [-0.6, 0.2, 0.012], [0, 0.18, 0.012], [0.6, 0.2, 0.012], [1.35, 0.25, 0.01]], 0.003, { radial: 3 });
    for (const s of [-1, 1]) b.cyl('#c0302a', 0.008, 0.012, s * 1.35, 0.25, 0.004, { axis: 'z', seg: 8 });
    return { colliders: [CB(2.7, 0.5, 0.03, 0, 0, 0.012)], mass: 0.2, material: 'cardboard', floatOK: true };
  },
});
