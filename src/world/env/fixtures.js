// Small wall fixtures for the environments: duplex outlets, light switches, exit signs, return-air
// grilles, thermostats, fire-alarm pull stations, junction boxes. All of them share one procedural
// canvas atlas (albedo + emission), so every fixture in a chunk merges into a single mesh / draw call.
// Fixtures are placed on a wall "frame": axis ('x' = wall runs along x, 'z' = along z), the face plane
// coordinate, and the outward side (+1 / -1).
import * as THREE from 'three';

const AW = 1024, AH = 512;
// atlas regions [x, y, w, h] in px
const R = {
  plain: [4, 4, 56, 56],
  plainDark: [68, 4, 56, 56],
  outlet: [128, 0, 112, 176],
  switch: [244, 0, 112, 176],
  exit: [360, 0, 300, 160],
  exitSide: [664, 0, 60, 60],
  grille: [0, 192, 384, 260],
  thermo: [388, 192, 200, 130],
  alarm: [592, 176, 150, 216],
  jbox: [748, 176, 160, 160],
  plainRed: [728, 4, 56, 56],
};

let _atlas = null;
function atlas() {
  if (_atlas) return _atlas;
  const c = document.createElement('canvas'); c.width = AW; c.height = AH;
  const e = document.createElement('canvas'); e.width = AW; e.height = AH;
  const g = c.getContext('2d', { willReadFrequently: true }), ge = e.getContext('2d');
  g.fillStyle = '#d8d2c4'; g.fillRect(0, 0, AW, AH);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, AW, AH);
  const rr = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
  const noise = (x, y, w, h, a) => { const im = g.getImageData(x, y, w, h); const d = im.data; for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * a; d[i] += n; d[i + 1] += n; d[i + 2] += n; } g.putImageData(im, x, y); };
  // plain plastics
  g.fillStyle = '#e4dfd2'; g.fillRect(...R.plain);
  g.fillStyle = '#3a3836'; g.fillRect(...R.plainDark);
  g.fillStyle = '#b8261c'; g.fillRect(...R.plainRed);
  // duplex outlet: ivory plate, two receptacles with slots + ground hole, centre screw
  {
    const [x, y, w, h] = R.outlet;
    const grad = g.createLinearGradient(x, y, x + w, y + h); grad.addColorStop(0, '#ece6d6'); grad.addColorStop(1, '#ddd5c2');
    g.fillStyle = grad; g.fillRect(x, y, w, h);
    for (const cy of [y + h * 0.3, y + h * 0.7]) {
      g.fillStyle = '#d6cdb8'; rr(g, x + w * 0.24, cy - h * 0.15, w * 0.52, h * 0.3, 14); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2; g.stroke();
      g.fillStyle = '#2a2622';
      g.fillRect(x + w * 0.36, cy - h * 0.07, w * 0.05, h * 0.09);
      g.fillRect(x + w * 0.59, cy - h * 0.07, w * 0.05, h * 0.1);
      g.beginPath(); g.arc(x + w * 0.5, cy + h * 0.07, w * 0.045, Math.PI, 0); g.lineTo(x + w * 0.545, cy + h * 0.1); g.lineTo(x + w * 0.455, cy + h * 0.1); g.fill();
    }
    g.fillStyle = '#b8b0a0'; g.beginPath(); g.arc(x + w / 2, y + h / 2, 5, 0, 7); g.fill();
    g.strokeStyle = '#7a7266'; g.beginPath(); g.moveTo(x + w / 2 - 4, y + h / 2); g.lineTo(x + w / 2 + 4, y + h / 2); g.stroke();
    noise(x, y, w, h, 6);
  }
  // light switch: plate with a toggle
  {
    const [x, y, w, h] = R.switch;
    g.fillStyle = '#e8e2d2'; g.fillRect(x, y, w, h);
    g.fillStyle = '#cfc6b2'; rr(g, x + w * 0.38, y + h * 0.3, w * 0.24, h * 0.4, 6); g.fill();
    g.fillStyle = '#f2ede2'; rr(g, x + w * 0.42, y + h * 0.33, w * 0.16, h * 0.18, 5); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + w * 0.42, y + h * 0.5, w * 0.16, 3);
    for (const sy of [y + h * 0.14, y + h * 0.86]) { g.fillStyle = '#b8b0a0'; g.beginPath(); g.arc(x + w / 2, sy, 5, 0, 7); g.fill(); }
    noise(x, y, w, h, 6);
  }
  // exit sign face: white housing, red stencil letters (emissive), chevron
  {
    const [x, y, w, h] = R.exit;
    g.fillStyle = '#e9e6dc'; g.fillRect(x, y, w, h);
    g.fillStyle = '#5a0c08'; g.fillRect(x + 10, y + 10, w - 20, h - 20);
    ge.fillStyle = '#ff3020'; ge.font = 'bold 92px "Arial Black", Arial, sans-serif'; ge.textAlign = 'center'; ge.textBaseline = 'middle';
    ge.fillText('EXIT', x + w / 2, y + h / 2 + 4);
    g.fillStyle = '#c8261a'; g.font = 'bold 92px "Arial Black", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('EXIT', x + w / 2, y + h / 2 + 4);
    ge.fillStyle = '#ff3020';
    for (const s of [-1, 1]) { ge.beginPath(); const ax = x + w / 2 + s * 125; ge.moveTo(ax, y + h / 2 - 18); ge.lineTo(ax + s * 16, y + h / 2); ge.lineTo(ax, y + h / 2 + 18); ge.fill(); }
    g.fillStyle = '#d8d4ca'; g.fillRect(...R.exitSide);
  }
  // return-air grille: frame + angled louvres
  {
    const [x, y, w, h] = R.grille;
    g.fillStyle = '#d9d4c8'; g.fillRect(x, y, w, h);
    g.fillStyle = '#1c1a17'; g.fillRect(x + 22, y + 22, w - 44, h - 44);
    const n = 14;
    for (let k = 0; k < n; k++) {
      const yy = y + 26 + (k * (h - 52)) / n;
      const gr = g.createLinearGradient(0, yy, 0, yy + (h - 52) / n);
      gr.addColorStop(0, '#f0ece2'); gr.addColorStop(0.55, '#bdb7aa'); gr.addColorStop(1, '#4a4640');
      g.fillStyle = gr; g.fillRect(x + 24, yy, w - 48, (h - 52) / n * 0.82);
    }
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3; g.strokeRect(x + 21, y + 21, w - 42, h - 42);
    for (const [sx, sy] of [[x + 11, y + 11], [x + w - 11, y + 11], [x + 11, y + h - 11], [x + w - 11, y + h - 11]]) { g.fillStyle = '#8a857a'; g.beginPath(); g.arc(sx, sy, 5, 0, 7); g.fill(); }
    noise(x, y, w, h, 10);
  }
  // thermostat: beige box, round dial, little window
  {
    const [x, y, w, h] = R.thermo;
    g.fillStyle = '#d7cdb4'; g.fillRect(x, y, w, h);
    g.fillStyle = '#c4b99c'; g.beginPath(); g.arc(x + w * 0.35, y + h * 0.5, h * 0.33, 0, 7); g.fill();
    g.strokeStyle = '#6a604c'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#3a3430'; g.fillRect(x + w * 0.35 - 2, y + h * 0.2, 4, h * 0.3);
    g.fillStyle = '#e8e2d0'; g.fillRect(x + w * 0.62, y + h * 0.3, w * 0.28, h * 0.4);
    g.fillStyle = '#2a2622'; g.font = '20px monospace'; g.fillText('68', x + w * 0.68, y + h * 0.58);
    noise(x, y, w, h, 6);
  }
  // fire alarm pull station
  {
    const [x, y, w, h] = R.alarm;
    g.fillStyle = '#c42a1e'; g.fillRect(x, y, w, h);
    g.fillStyle = '#e8e2d8'; g.font = 'bold 26px Arial, sans-serif'; g.textAlign = 'center';
    g.fillText('FIRE', x + w / 2, y + 40); g.font = 'bold 18px Arial, sans-serif'; g.fillText('PULL DOWN', x + w / 2, y + 190);
    g.fillStyle = '#8a1a12'; rr(g, x + w * 0.25, y + h * 0.32, w * 0.5, h * 0.36, 8); g.fill();
    g.fillStyle = '#e8e2d8'; rr(g, x + w * 0.32, y + h * 0.4, w * 0.36, h * 0.12, 5); g.fill();
    noise(x, y, w, h, 8);
  }
  // grey junction box cover with a knockout and screws
  {
    const [x, y, w, h] = R.jbox;
    g.fillStyle = '#8c908c'; g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 4; g.strokeRect(x + 10, y + 10, w - 20, h - 20);
    for (const [sx, sy] of [[x + 22, y + 22], [x + w - 22, y + 22], [x + 22, y + h - 22], [x + w - 22, y + h - 22]]) { g.fillStyle = '#5a5e5a'; g.beginPath(); g.arc(sx, sy, 6, 0, 7); g.fill(); }
    g.fillStyle = '#6a6e6a'; g.beginPath(); g.arc(x + w / 2, y + h / 2, 22, 0, 7); g.fill();
    noise(x, y, w, h, 14);
  }
  const mk = (cv, srgb) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; t.flipY = false; t.needsUpdate = true; return t; };
  _atlas = { map: mk(c, true), emis: mk(e, true) };
  return _atlas;
}

let _mat = null;
export function fixtureMaterial() {
  if (_mat) return _mat;
  const a = atlas();
  _mat = new THREE.MeshStandardMaterial({ map: a.map, emissiveMap: a.emis, emissive: 0xffffff, emissiveIntensity: 2.2, roughness: 0.52, metalness: 0, vertexColors: true });
  _mat.name = 'env_fixtures';
  return _mat;
}

// atlas uv for (s, t) in [0,1] inside a region (t = 0 at the bottom)
function auv(reg, s, t) { const [x, y, w, h] = R[reg]; return [(x + s * w) / AW, (y + (1 - t) * h) / AH]; }

// frame -> world helpers
function W3(fr, u, y, w) { return fr.axis === 'x' ? [u, y, fr.plane + fr.side * w] : [fr.plane + fr.side * w, y, u]; }
function rightSign(fr) { return fr.axis === 'x' ? fr.side : -fr.side; }

// a fixture body: bevelled box from the wall out to `depth`, front face mapped to an atlas region
export function fixture(F, fr, uc, yc, w, h, depth, region, opts = {}) {
  const u0 = uc - w / 2, u1 = uc + w / 2, y0 = yc - h / 2, y1 = yc + h / 2;
  const a = W3(fr, u0, y0, 0), b = W3(fr, u1, y1, depth);
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), z0 = Math.min(a[2], b[2]), z1 = Math.max(a[2], b[2]);
  const side = opts.sideRegion || 'plain';
  const pu = auv(side, 0.5, 0.5);
  if (opts.color !== undefined) F.setColor(opts.color); else F.setRGB(1, 1, 1);
  F.ao = 1;
  const bev = Math.min(opts.bevel ?? 0.004, depth * 0.45);
  const skip = fr.axis === 'x' ? (fr.side > 0 ? { nz: true } : { pz: true }) : (fr.side > 0 ? { nx: true } : { px: true });
  const front = fr.axis === 'x' ? (fr.side > 0 ? 'pz' : 'nz') : (fr.side > 0 ? 'px' : 'nx');
  F.chamferBox(x0, y0, z0, x1, y1, z1, bev, front, skip, () => pu);
  // front face overlay with the atlas region
  const rs = rightSign(fr);
  const n = fr.axis === 'x' ? [0, 0, fr.side] : [fr.side, 0, 0];
  const fw = depth + 0.0004;
  const ui0 = u0 + bev, ui1 = u1 - bev, yi0 = y0 + bev, yi1 = y1 - bev;
  const uvf = (x, y, z) => {
    const u = fr.axis === 'x' ? x : z;
    let s = (u - ui0) / (ui1 - ui0); if (rs < 0) s = 1 - s;
    return auv(region, Math.min(1, Math.max(0, s)), (y - yi0) / (yi1 - yi0));
  };
  F.rectOriented([W3(fr, ui0, yi0, fw), W3(fr, ui1, yi0, fw), W3(fr, ui1, yi1, fw), W3(fr, ui0, yi1, fw)], n, uvf);
  F.setRGB(1, 1, 1);
}

export function outlet(F, fr, u, y = 0.3) { fixture(F, fr, u, y, 0.072, 0.116, 0.007, 'outlet', { bevel: 0.0025, color: 0xfffaf0 }); }
export function lightSwitch(F, fr, u, y = 1.2) { fixture(F, fr, u, y, 0.072, 0.116, 0.007, 'switch', { bevel: 0.0025 }); }
export function exitSign(F, fr, u, y) { fixture(F, fr, u, y, 0.34, 0.19, 0.06, 'exit', { bevel: 0.006, sideRegion: 'exitSide' }); }
export function grille(F, fr, u, y) { fixture(F, fr, u, y, 0.46, 0.31, 0.018, 'grille', { bevel: 0.004 }); }
export function thermostat(F, fr, u, y = 1.5) { fixture(F, fr, u, y, 0.13, 0.085, 0.03, 'thermo', { bevel: 0.008 }); }
export function pullStation(F, fr, u, y = 1.22) { fixture(F, fr, u, y, 0.1, 0.145, 0.045, 'alarm', { bevel: 0.006, sideRegion: 'plainRed' }); }
export function junctionBox(F, fr, u, y) { fixture(F, fr, u, y, 0.12, 0.12, 0.05, 'jbox', { bevel: 0.004, sideRegion: 'plainDark', color: 0xd0d4d0 }); }
