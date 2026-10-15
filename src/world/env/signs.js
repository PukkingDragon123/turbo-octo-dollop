// Level 0 wayfinding: R.O.O.M. corporate signs (enamel plates with white lettering and arrows), big stencilled
// wall lettering and painted floor markings, all from one procedural canvas atlas so every sign in a chunk is a
// single merged mesh / draw call lit by the baked grid light (bakedMaterial with this atlas as its map).
import * as THREE from 'three';

const AW = 1024, AH = 1024;
// atlas regions [x, y, w, h] in px
const R = {
  plate: [0, 0, 32, 32],          // plain sign blue (plate edges / backs)
  pads_r: [0, 64, 512, 112],
  pads_l: [512, 64, 512, 112],
  camp_r: [0, 176, 512, 112],
  camp_l: [512, 176, 512, 112],
  pads_up: [0, 288, 512, 112],
  arrivals: [512, 288, 512, 112],
  hall: [0, 400, 1024, 160],      // stencil: TELEPORTATION PAD HALL
  sell: [0, 560, 1024, 120],      // stencil: SELL FURNITURE ON THE PADS
  camp: [0, 680, 1024, 120],      // stencil: FIELD CAMP
  hazard: [0, 800, 512, 64],      // yellow / black floor stripe
  line: [512, 800, 128, 64],      // plain yellow floor line
  arrow: [640, 800, 128, 128],    // floor arrow (points +u)
  white: [40, 0, 24, 24],
};
export const SIGN_REGIONS = R;

let _tex = null, _mat = null;
function atlas() {
  if (_tex) return _tex;
  const c = document.createElement('canvas'); c.width = AW; c.height = AH;
  const g = c.getContext('2d');
  g.fillStyle = '#26384a'; g.fillRect(0, 0, AW, AH);
  const blue = '#21405f';
  g.fillStyle = blue; g.fillRect(...R.plate);
  g.fillStyle = '#ece8dc'; g.fillRect(...R.white);
  const arrowPath = (cx, cy, s, dir) => {
    // block arrow pointing right (dir 0), left (2), up (3)
    g.save(); g.translate(cx, cy); g.rotate(dir * Math.PI / 2);
    g.beginPath();
    g.moveTo(-s * 0.55, -s * 0.16); g.lineTo(s * 0.08, -s * 0.16); g.lineTo(s * 0.08, -s * 0.42); g.lineTo(s * 0.6, 0);
    g.lineTo(s * 0.08, s * 0.42); g.lineTo(s * 0.08, s * 0.16); g.lineTo(-s * 0.55, s * 0.16); g.closePath();
    g.fill(); g.restore();
  };
  const plate = (r, text, arrow, sub) => {
    const [x, y, w, h] = r;
    g.fillStyle = blue; g.fillRect(x, y, w, h);
    g.strokeStyle = '#d9d3c2'; g.lineWidth = 5; g.strokeRect(x + 7, y + 7, w - 14, h - 14);
    g.fillStyle = '#f1ede2';
    g.font = `bold ${Math.round(h * 0.34)}px "Arial Narrow", Arial, Helvetica, sans-serif`;
    g.textBaseline = 'middle';
    const ay = y + h / 2;
    if (arrow === 'r') { g.textAlign = 'left'; g.fillText(text, x + 26, ay - (sub ? 12 : 0)); arrowPath(x + w - 62, ay, 74, 0); }
    else if (arrow === 'l') { g.textAlign = 'right'; g.fillText(text, x + w - 26, ay - (sub ? 12 : 0)); arrowPath(x + 62, ay, 74, 2); }
    else if (arrow === 'u') { g.textAlign = 'left'; g.fillText(text, x + 26, ay - (sub ? 12 : 0)); arrowPath(x + w - 62, ay, 74, 3); }
    else { g.textAlign = 'center'; g.fillText(text, x + w / 2, ay - (sub ? 12 : 0)); }
    if (sub) {
      g.font = `${Math.round(h * 0.17)}px Arial, Helvetica, sans-serif`;
      g.fillStyle = '#c9c2ae';
      if (arrow === 'l') { g.textAlign = 'right'; g.fillText(sub, x + w - 28, ay + 26); }
      else if (arrow) { g.textAlign = 'left'; g.fillText(sub, x + 28, ay + 26); }
      else { g.textAlign = 'center'; g.fillText(sub, x + w / 2, ay + 26); }
    }
  };
  plate(R.pads_r, 'TELEPORT PADS', 'r', 'SELL · DISPATCH');
  plate(R.pads_l, 'TELEPORT PADS', 'l', 'SELL · DISPATCH');
  plate(R.camp_r, 'FIELD CAMP', 'r', 'ARRIVALS · REST');
  plate(R.camp_l, 'FIELD CAMP', 'l', 'ARRIVALS · REST');
  plate(R.pads_up, 'TELEPORT PADS', 'u', 'SELL · DISPATCH');
  plate(R.arrivals, 'ARRIVALS', null, 'R.O.O.M. PERSONNEL LIFT B-0');
  // big stencils: black lettering on transparent-looking concrete grey (blended in by the wall colour)
  const stencil = (r, text, size, bg) => {
    const [x, y, w, h] = r;
    g.fillStyle = bg; g.fillRect(x, y, w, h);
    g.fillStyle = '#1b1a17';
    g.font = `bold ${size}px "Courier New", Courier, monospace`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    // stencil bridges: draw the text, then cut thin vertical gaps
    g.fillText(text, x + w / 2, y + h / 2 + 4);
    g.fillStyle = bg;
    for (let k = x + 9; k < x + w; k += 37) g.fillRect(k, y + h * 0.36, 3, h * 0.08);
    // overspray speckle
    for (let k = 0; k < 900; k++) {
      g.fillStyle = `rgba(20,18,15,${Math.random() * 0.25})`;
      g.fillRect(x + Math.random() * w, y + h * 0.15 + Math.random() * h * 0.7, 1.5, 1.5);
    }
  };
  stencil(R.hall, 'TELEPORTATION PAD HALL', 92, '#9d988c');
  stencil(R.sell, 'PLACE FURNITURE ON PADS', 76, '#9d988c');
  stencil(R.camp, 'R.O.O.M. FIELD CAMP', 80, '#c2a873');
  // floor paint
  {
    const [x, y, w, h] = R.hazard;
    g.fillStyle = '#d8b021'; g.fillRect(x, y, w, h);
    g.fillStyle = '#1c1b18';
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    for (let k = -h; k < w; k += 64) { g.beginPath(); g.moveTo(x + k, y + h); g.lineTo(x + k + 32, y + h); g.lineTo(x + k + 32 + h, y); g.lineTo(x + k + h, y); g.closePath(); g.fill(); }
    g.restore();
  }
  g.fillStyle = '#d8b021'; g.fillRect(...R.line);
  {
    const [x, y, w, h] = R.arrow;
    g.fillStyle = '#7d7768'; g.fillRect(x, y, w, h);
    g.fillStyle = '#d8b021';
    arrowPath(x + w / 2, y + h / 2, w * 0.92, 0);
  }
  // scuffs / grime over everything (signs are old)
  for (let k = 0; k < 2600; k++) {
    g.fillStyle = `rgba(${40 + Math.random() * 40},${35 + Math.random() * 30},20,${Math.random() * 0.08})`;
    const s = 1 + Math.random() * 6;
    g.fillRect(Math.random() * AW, Math.random() * AH, s, s);
  }
  _tex = new THREE.CanvasTexture(c);
  _tex.colorSpace = THREE.SRGBColorSpace;
  _tex.anisotropy = 4;
  _tex.generateMipmaps = true;
  return _tex;
}

export function signMaterial() {
  if (_mat) return _mat;
  _mat = new THREE.MeshStandardMaterial({ map: atlas(), roughness: 0.62, metalness: 0.0 });
  _mat.name = 'signs';
  return _mat;
}

// uv of a region corner fraction (u, v in 0..1 across the region; v = 0 bottom)
function ruv(r, u, v) {
  const [x, y, w, h] = R[r];
  return [(x + 2 + u * (w - 4)) / AW, 1 - (y + 2 + (1 - v) * (h - 4)) / AH];
}

// Wall plate: frame = { axis: 'x'|'z', plane (face coordinate), side: +1/-1 (outward normal) }; centred at `along`
// (coordinate along the wall) and height y; w x h metres; region: atlas key. Thin chamfered plate 1.2 cm proud.
export function wallSign(g, frame, along, y, w, h, region, depth = 0.012) {
  const { axis, plane, side } = frame;
  const f = plane + side * depth;
  const a0 = along - w / 2, a1 = along + w / 2, y0 = y - h / 2, y1 = y + h / 2;
  const n = axis === 'x' ? [0, 0, side] : [side, 0, 0];
  // the viewer's right along the wall: for a face looking +z the right is +x; for +x it is -z
  const right = axis === 'x' ? side : -side;
  const uvf = (px, py, pz) => {
    const s = axis === 'x' ? px : pz;
    let u = (s - a0) / (a1 - a0);
    if (right < 0) u = 1 - u;
    return ruv(region, u, (py - y0) / (y1 - y0));
  };
  g.ao = 1;
  if (axis === 'x') g.rectOriented([[a0, y0, f], [a1, y0, f], [a1, y1, f], [a0, y1, f]], n, uvf);
  else g.rectOriented([[f, y0, a0], [f, y0, a1], [f, y1, a1], [f, y1, a0]], n, uvf);
  // edges of the plate
  const pl = () => ruv('plate', 0.5, 0.5);
  if (depth > 0.002) {
    if (axis === 'x') {
      const zA = Math.min(plane, f), zB = Math.max(plane, f);
      g.box(a0, y0, zA, a1, y1, zB, { [side > 0 ? 'pz' : 'nz']: true, [side > 0 ? 'nz' : 'pz']: true }, 0, pl);
    } else {
      const xA = Math.min(plane, f), xB = Math.max(plane, f);
      g.box(xA, y0, a0, xB, y1, a1, { [side > 0 ? 'px' : 'nx']: true, [side > 0 ? 'nx' : 'px']: true }, 0, pl);
    }
  }
}

// painted floor quad (3 mm proud): rectangle centred at (x, z) of length L along direction (dx, dz) and width W;
// the region's u runs along the direction (repeat: tile the region every `rep` metres along the length)
export function floorPaint(g, x, z, dx, dz, L, Wd, region, rep = 0, y = 0.003) {
  const l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l, vx = -uz, vz = ux;
  const P = (a, b) => [x + ux * a + vx * b, y, z + uz * a + vz * b];
  const [rx, ry, rw, rh] = R[region];
  const u0 = (rx + 2) / AW, u1 = (rx + rw - 2) / AW, v0 = 1 - (ry + rh - 2) / AH, v1 = 1 - (ry + 2) / AH;
  const n = Math.max(1, rep > 0 ? Math.round(L / rep) : 1);
  g.ao = 1;
  for (let k = 0; k < n; k++) {
    const a0 = -L / 2 + (k * L) / n, a1 = a0 + L / n;
    const p0 = P(a0, -Wd / 2), p1 = P(a1, -Wd / 2), p2 = P(a1, Wd / 2), p3 = P(a0, Wd / 2);
    // explicit uv per corner (rect() would compute them from the position)
    g.autoCell(x, z, 0, 0);
    const base = g.vc;
    g.v(p0[0], p0[1], p0[2], 0, 1, 0, u0, v0);
    g.v(p1[0], p1[1], p1[2], 0, 1, 0, u1, v0);
    g.v(p2[0], p2[1], p2[2], 0, 1, 0, u1, v1);
    g.v(p3[0], p3[1], p3[2], 0, 1, 0, u0, v1);
    // winding: counter-clockwise seen from above
    const cx = (p1[0] - p0[0]) * (p3[2] - p0[2]) - (p1[2] - p0[2]) * (p3[0] - p0[0]);
    if (cx < 0) g.quad(base, base + 1, base + 2, base + 3); else g.quad(base, base + 3, base + 2, base + 1);
  }
}
