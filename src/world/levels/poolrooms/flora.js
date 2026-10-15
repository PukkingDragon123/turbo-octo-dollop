// Poolrooms vegetation: potted palms gone wild, ferns spilling over the coping, monstera, ivy curtains
// hanging down the giant walls and floating algae / duckweed / lily-pad mats on the water.
// Leaves are alpha-tested ribbons on a canvas-painted atlas (no image files), written straight into
// the chunk meshers so they bake and batch with the rest of the chunk (one draw call per chunk).
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// deterministic small rng
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// atlas regions [u0, v0, u1, v1] (v up)
export const LEAF = {
  PALM: [0.0, 0.0, 0.25, 1.0],
  FERN: [0.25, 0.0, 0.5, 1.0],
  MONSTERA: [0.5, 0.5, 0.75, 1.0],
  BLADE: [0.5, 0.0, 0.75, 0.5],
  IVY: [0.75, 0.0, 1.0, 1.0],
};

let _leafTex = null, _algaeTex = null;

function paintLeafAtlas() {
  const W = 1024, H = 1024;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  const R = rng(4242);
  const green = (k, dry = 0) => {
    const r = Math.round(46 + 40 * k + 90 * dry), gg = Math.round(78 + 70 * k + 30 * dry), b = Math.round(34 + 24 * k - 10 * dry);
    return `rgb(${r},${gg},${b})`;
  };
  // pinnate frond in a vertical strip: rib along the centre, leaflets angled toward the tip
  const frond = (x0, w, leafLen, n, droopy, dryTip) => {
    const cx = x0 + w / 2;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n; // 0 = base (bottom of canvas = v 0)
      const y = H - 20 - t * (H - 40);
      const len = leafLen * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.92 + 0.15) * (0.85 + R() * 0.3);
      const dry = dryTip ? Math.max(0, (t - 0.72) / 0.28) * (0.5 + R() * 0.5) : R() < 0.06 ? 0.7 : 0;
      for (const side of [-1, 1]) {
        g.save();
        g.translate(cx, y);
        g.rotate(side * (Math.PI / 2 - 0.55 - droopy * t));
        const lw = Math.max(3, len * 0.13);
        const grd = g.createLinearGradient(0, 0, 0, -len);
        grd.addColorStop(0, green(0.25, dry));
        grd.addColorStop(1, green(0.75 + R() * 0.25, dry));
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(-lw * 0.3, 0);
        g.quadraticCurveTo(-lw, -len * 0.45, 0, -len);
        g.quadraticCurveTo(lw, -len * 0.45, lw * 0.3, 0);
        g.closePath();
        g.fill();
        // midrib
        g.strokeStyle = 'rgba(200,220,150,0.35)';
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -len * 0.95); g.stroke();
        // ragged / eaten bits
        if (R() < 0.25) { g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc((R() - 0.5) * lw, -len * (0.3 + R() * 0.6), lw * (0.4 + R() * 0.5), 0, Math.PI * 2); g.fill(); g.globalCompositeOperation = 'source-over'; }
        g.restore();
      }
    }
    // rib
    g.strokeStyle = 'rgb(90,104,56)';
    g.lineWidth = 7;
    g.beginPath(); g.moveTo(cx, H); g.lineTo(cx, 12); g.stroke();
    g.strokeStyle = 'rgba(190,200,140,0.6)';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx - 1, H); g.lineTo(cx - 1, 12); g.stroke();
  };
  frond(0, 256, 128, 26, 0.35, true);
  frond(256, 256, 96, 34, 0.15, false);
  // monstera (top half of column 3)
  {
    const x0 = 512, y0 = 0, w = 256, h = 512;
    const cx = x0 + w / 2, cy = y0 + h * 0.52;
    g.fillStyle = green(0.45);
    g.beginPath();
    g.ellipse(cx, cy, w * 0.46, h * 0.46, 0, 0, Math.PI * 2);
    g.fill();
    // splits + holes
    g.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 9; k++) {
      const a = -Math.PI / 2 + (k - 4) * 0.33;
      for (const s of [-1, 1]) {
        const aa = Math.PI / 2 + s * (0.25 + k * 0.29);
        g.lineWidth = 9;
        g.beginPath();
        g.moveTo(cx + Math.cos(aa) * w * 0.28, cy + Math.sin(aa) * h * 0.28);
        g.lineTo(cx + Math.cos(aa) * w * 0.6, cy + Math.sin(aa) * h * 0.6);
        g.stroke();
        if (k % 2) { g.beginPath(); g.ellipse(cx + Math.cos(aa) * w * 0.2, cy + Math.sin(aa) * h * 0.2, 9, 14, aa, 0, Math.PI * 2); g.fill(); }
      }
      void a;
    }
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = 'rgba(170,200,120,0.55)';
    g.lineWidth = 5;
    g.beginPath(); g.moveTo(cx, y0 + h); g.lineTo(cx, cy - h * 0.42); g.stroke();
    // yellowed blotch
    g.fillStyle = 'rgba(150,130,40,0.35)';
    g.beginPath(); g.arc(cx + 40, cy - 70, 40, 0, Math.PI * 2); g.fill();
  }
  // grass-like blades (bottom half of column 3)
  for (let k = 0; k < 18; k++) {
    const bx = 512 + 20 + R() * 216, len = 260 + R() * 220, bw = 8 + R() * 10;
    g.fillStyle = green(0.3 + R() * 0.5, R() < 0.2 ? 0.6 : 0);
    g.beginPath();
    g.moveTo(bx - bw / 2, 1024);
    g.quadraticCurveTo(bx + (R() - 0.5) * 60, 1024 - len * 0.6, bx + (R() - 0.5) * 40, 1024 - len);
    g.quadraticCurveTo(bx + bw, 1024 - len * 0.5, bx + bw / 2, 1024);
    g.fill();
  }
  // ivy strip: heart-shaped leaves along a wandering stem
  {
    const x0 = 768;
    g.strokeStyle = 'rgb(70,60,40)';
    g.lineWidth = 4;
    let sx = x0 + 128;
    g.beginPath(); g.moveTo(sx, 1024);
    for (let y = 1024; y > 0; y -= 32) { sx = x0 + 128 + Math.sin(y * 0.02) * 40; g.lineTo(sx, y); }
    g.stroke();
    for (let k = 0; k < 70; k++) {
      const y = 1024 - k * 14.6 - R() * 8;
      const px = x0 + 128 + Math.sin(y * 0.02) * 40 + (R() - 0.5) * 150;
      const r = 14 + R() * 18;
      g.fillStyle = green(0.2 + R() * 0.6, R() < 0.12 ? 0.8 : 0);
      g.save();
      g.translate(px, y);
      g.rotate((R() - 0.5) * 2.4);
      g.beginPath();
      g.moveTo(0, r);
      g.bezierCurveTo(-r * 1.3, 0, -r * 0.6, -r * 1.1, 0, -r * 0.45);
      g.bezierCurveTo(r * 0.6, -r * 1.1, r * 1.3, 0, 0, r);
      g.fill();
      g.restore();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export function leafTexture() { return _leafTex || (_leafTex = paintLeafAtlas()); }

// floating algae atlas: 2x2 variants (scum blob, lily pads, slime with bubbles, duckweed)
function paintAlgaeAtlas() {
  const S = 512, c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const R = rng(777);
  const H = S / 2;
  const blob = (cx, cy, r, col, n = 18, jag = 0.35) => {
    g.fillStyle = col;
    g.beginPath();
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      const rr = r * (1 - jag * 0.5 + R() * jag);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (k) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.fill();
  };
  // 0: green scum with filaments
  for (let k = 0; k < 40; k++) blob(H / 2 + (R() - 0.5) * 140, H / 2 + (R() - 0.5) * 140, 12 + R() * 30, `rgba(${60 + R() * 40},${90 + R() * 50},${30 + R() * 20},${0.5 + R() * 0.4})`, 12, 0.6);
  g.strokeStyle = 'rgba(70,100,40,0.6)';
  for (let k = 0; k < 30; k++) { g.lineWidth = 1 + R() * 2; g.beginPath(); const x = H / 2 + (R() - 0.5) * 160, y = H / 2 + (R() - 0.5) * 160; g.moveTo(x, y); g.bezierCurveTo(x + (R() - 0.5) * 80, y + (R() - 0.5) * 80, x + (R() - 0.5) * 80, y + (R() - 0.5) * 80, x + (R() - 0.5) * 110, y + (R() - 0.5) * 110); g.stroke(); }
  // 1: lily pads
  for (let k = 0; k < 9; k++) {
    const cx = H + H / 2 + (R() - 0.5) * 150, cy = H / 2 + (R() - 0.5) * 150, r = 18 + R() * 26;
    const a0 = R() * Math.PI * 2;
    g.fillStyle = `rgb(${50 + R() * 30},${88 + R() * 40},${40 + R() * 20})`;
    g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, r, a0 + 0.25, a0 + Math.PI * 2 - 0.1); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(30,50,20,0.5)'; g.lineWidth = 1.5;
    for (let v = 0; v < 7; v++) { const a = a0 + 0.4 + v * 0.85; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9); g.stroke(); }
    if (R() < 0.4) { g.fillStyle = 'rgba(120,100,40,0.55)'; g.beginPath(); g.arc(cx + r * 0.3, cy - r * 0.2, r * 0.4, 0, Math.PI * 2); g.fill(); }
  }
  // 2: brown-green slime with bubbles
  for (let k = 0; k < 26; k++) blob(H / 2 + (R() - 0.5) * 120, H + H / 2 + (R() - 0.5) * 120, 18 + R() * 34, `rgba(${70 + R() * 30},${72 + R() * 30},${30 + R() * 14},${0.55 + R() * 0.35})`, 16, 0.5);
  for (let k = 0; k < 40; k++) { const x = H / 2 + (R() - 0.5) * 150, y = H + H / 2 + (R() - 0.5) * 150, r = 2 + R() * 6; g.fillStyle = 'rgba(200,210,170,0.6)'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.fillStyle = 'rgba(40,50,20,0.6)'; g.beginPath(); g.arc(x + r * 0.2, y + r * 0.2, r * 0.6, 0, Math.PI * 2); g.fill(); }
  // 3: duckweed
  for (let k = 0; k < 700; k++) {
    const a = R() * Math.PI * 2, d = Math.pow(R(), 0.6) * 110;
    const x = H + H / 2 + Math.cos(a) * d, y = H + H / 2 + Math.sin(a) * d;
    g.fillStyle = `rgba(${80 + R() * 50},${130 + R() * 60},${30 + R() * 20},0.95)`;
    g.beginPath(); g.ellipse(x, y, 2.5 + R() * 3, 2 + R() * 2, R() * 3, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
export function algaeTexture() { return _algaeTex || (_algaeTex = paintAlgaeAtlas()); }

// ---------------------------------------------------------------------------
// Geometry. M: a Mesher (geo.js). Leaves get their atlas uv straight through vert().
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();

// a curved, slightly V-folded ribbon along a quadratic path from p0 with direction dir (unit),
// length len, width w, droop (downward bend), region = LEAF.*
export function ribbon(M, p0, dir, len, w, droop, region, fold = 0.25, segs = 8, twist = 0) {
  const [u0, v0, u1, v1] = region;
  const side = _a.set(-dir.z, 0, dir.x);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize();
  const base = M.vcount;
  const P = new THREE.Vector3();
  for (let k = 0; k <= segs; k++) {
    const t = k / segs;
    // position along the arc: forward along dir, falling with t^2 * droop
    P.copy(p0).addScaledVector(dir, len * t);
    P.y -= droop * len * t * t;
    const ww = w * Math.sin(Math.min(1, t * 1.1 + 0.08) * Math.PI) * (t < 0.06 ? 0.4 : 1);
    const tw = twist * t;
    const sx = side.x * Math.cos(tw), sz = side.z * Math.cos(tw), sy = Math.sin(tw);
    // three verts across: left edge, rib (raised), right edge -> V fold
    for (let e = -1; e <= 1; e++) {
      const x = P.x + sx * ww * 0.5 * e, z = P.z + sz * ww * 0.5 * e;
      const y = P.y + sy * ww * 0.5 * e + (e === 0 ? fold * ww * 0.3 : 0);
      // normal: roughly up, tilted by the fold
      _n.set(-sx * e * fold, 1, -sz * e * fold).normalize();
      const u = u0 + (u1 - u0) * (0.5 + e * 0.5);
      const v = v0 + (v1 - v0) * t;
      M.vert(x, y, z, _n.x, _n.y, _n.z, u, v);
    }
  }
  for (let k = 0; k < segs; k++) {
    const a = base + k * 3;
    for (let e = 0; e < 2; e++) {
      const i0 = a + e, i1 = a + e + 1, i2 = a + 3 + e, i3 = a + 3 + e + 1;
      M.idx.push(i0, i2, i1, i1, i2, i3);
    }
  }
}

// planter pot (terrazzo trim mesher), returns collider box
function planter(B, x, z, r, h, square) {
  if (square) {
    B.trim.setTint(0.92, 0.92, 0.88);
    B.trim.roundPrism(x - r, z - r, x + r, z + r, 0, h, 0.04, 3, { top: false });
    B.trim.roundPrism(x - r - 0.03, z - r - 0.03, x + r + 0.03, z + r + 0.03, h - 0.05, h + 0.02, 0.03, 2, { top: true });
  } else {
    B.trim.setTint(0.93, 0.9, 0.84);
    B.trim.lathe([[0, 0], [r * 0.72, 0], [r * 0.8, 0.03], [r, h - 0.04], [r * 1.07, h - 0.03], [r * 1.07, h + 0.02], [r * 0.95, h + 0.02], [r * 0.92, h - 0.02]], 18, new THREE.Matrix4().makeTranslation(x, 0, z));
  }
  B.trim.setTint(1, 1, 1);
  // soil
  B.wood.setTint(0.18, 0.13, 0.09);
  B.wood.hface(h - 0.03, 1, x - r * 0.9, x + r * 0.9, z - r * 0.9, z + r * 0.9);
  B.wood.setTint(1, 1, 1);
  return { min: [x - r, 0, z - r], max: [x + r, h, z + r] };
}

export function palm(B, x, z, s, seed) {
  const R = rng(seed);
  const box = planter(B, x, z, 0.32 * Math.min(1.2, s), 0.55, R() < 0.5);
  const top = 0.55 + (1.4 + R() * 1.6) * s;
  // trunk: a leaning, ringed stem
  const lean = new THREE.Vector3((R() - 0.5) * 0.5, 0, (R() - 0.5) * 0.5);
  const pts = [];
  for (let k = 0; k <= 6; k++) {
    const t = k / 6;
    pts.push(new THREE.Vector3(x + lean.x * t * t * top, 0.5 + (top - 0.5) * t, z + lean.z * t * t * top));
  }
  B.wood.setTint(0.42, 0.33, 0.24);
  B.wood.tube(pts, 0.07 * s + 0.03, 8, true);
  B.wood.setTint(1, 1, 1);
  const crown = pts[pts.length - 1];
  const n = 9 + Math.floor(R() * 5);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + R() * 0.4;
    const up = 0.25 + R() * 0.55;
    const dir = new THREE.Vector3(Math.cos(a), up, Math.sin(a)).normalize();
    ribbon(B.leaf, crown, dir, (1.2 + R() * 0.9) * s, (0.5 + R() * 0.25) * s, 0.55 + R() * 0.5, LEAF.PALM, 0.35, 8, (R() - 0.5) * 0.6);
  }
  // a few dead fronds hanging down the trunk
  for (let k = 0; k < 3; k++) {
    const a = R() * Math.PI * 2;
    ribbon(B.leaf, crown, new THREE.Vector3(Math.cos(a) * 0.3, -0.95, Math.sin(a) * 0.3).normalize(), (0.7 + R() * 0.5) * s, 0.35 * s, 0.05, LEAF.BLADE, 0.1, 5);
  }
  return [box];
}

export function fern(B, x, z, s, seed, potted = true) {
  const R = rng(seed);
  const boxes = [];
  let y = 0.04;
  if (potted) { boxes.push(planter(B, x, z, 0.26 * Math.min(1.3, s), 0.42, R() < 0.4)); y = 0.42; }
  const n = 12 + Math.floor(R() * 8);
  const base = new THREE.Vector3(x, y, z);
  for (let k = 0; k < n; k++) {
    const a = R() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(a), 0.6 + R() * 0.9, Math.sin(a)).normalize();
    ribbon(B.leaf, base, dir, (0.6 + R() * 0.6) * s, (0.32 + R() * 0.14) * s, 0.9 + R() * 0.7, LEAF.FERN, 0.2, 7, (R() - 0.5) * 0.8);
  }
  return boxes;
}

export function monstera(B, x, z, s, seed) {
  const R = rng(seed);
  const box = planter(B, x, z, 0.3 * Math.min(1.3, s), 0.5, true);
  const n = 6 + Math.floor(R() * 4);
  for (let k = 0; k < n; k++) {
    const a = R() * Math.PI * 2;
    const h = 0.5 + (0.4 + R() * 0.9) * s;
    const tip = new THREE.Vector3(x + Math.cos(a) * 0.35 * s, h, z + Math.sin(a) * 0.35 * s);
    // stalk
    B.wood.setTint(0.3, 0.42, 0.2);
    B.wood.tube([new THREE.Vector3(x, 0.48, z), new THREE.Vector3(x + Math.cos(a) * 0.12 * s, h * 0.7, z + Math.sin(a) * 0.12 * s), tip], 0.012, 5, false);
    B.wood.setTint(1, 1, 1);
    const dir = new THREE.Vector3(Math.cos(a), 0.15 + R() * 0.3, Math.sin(a)).normalize();
    ribbon(B.leaf, tip, dir, (0.55 + R() * 0.3) * s, (0.55 + R() * 0.2) * s, 0.35, LEAF.MONSTERA, 0.15, 5);
  }
  return [box];
}

// ivy curtain hanging down a wall: (x, z) on the wall face, n = +1 (faces +z) / -1, from the top
export function vines(B, x, z, n, len, top, seed) {
  const R = rng(seed);
  const strands = 3 + Math.floor(R() * 4);
  for (let k = 0; k < strands; k++) {
    const sx = x + (R() - 0.5) * 2.4;
    const l = len * (0.5 + R() * 0.6);
    const w = 0.35 + R() * 0.3;
    const M = B.leaf;
    const base = M.vcount;
    const segs = Math.max(3, Math.round(l / 0.5));
    const [u0, v0, u1, v1] = LEAF.IVY;
    for (let j = 0; j <= segs; j++) {
      const t = j / segs;
      const y = top - l * t;
      const off = 0.03 + Math.sin(t * 7 + k) * 0.03 + t * 0.05;
      const sw = Math.sin(t * 3 + k * 2) * 0.12;
      for (let e = 0; e <= 1; e++) {
        const xx = sx + (e - 0.5) * w * (1 - t * 0.35) + sw;
        M.vert(xx, y, z + n * off, 0, 0, n, u0 + (u1 - u0) * e, v1 - (v1 - v0) * (t * l / 4.5));
      }
    }
    for (let j = 0; j < segs; j++) {
      const a = base + j * 2;
      M.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
}

// floating algae / lily-pad mat on the water: a flat disc at height y, variant 0..3
export function algaeMat(M, x, y, z, r, rot, variant, tint) {
  const cu = (variant % 2) * 0.5, cv = Math.floor(variant / 2) * 0.5;
  const segs = 10;
  M.setTint(tint);
  const base = M.vcount;
  M.vert(x, y, z, 0, 1, 0, cu + 0.25, cv + 0.25);
  for (let k = 0; k <= segs; k++) {
    const a = rot + (k / segs) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    M.vert(x + c * r, y, z + s * r, 0, 1, 0, cu + 0.25 + Math.cos(a - rot) * 0.24, cv + 0.25 + Math.sin(a - rot) * 0.24);
  }
  for (let k = 0; k < segs; k++) M.idx.push(base, base + 2 + k, base + 1 + k);
  M.setTint(1, 1, 1);
}
