// Still Lifes — parts atlas: corporate ID badges (cracked, defaced, stamped), hazard bands, duct tape,
// tank labels, twisted thread and worn metal, drawn once on canvas with a matching height->normal map.
import * as THREE from 'three';
import { RNG, TAU, clamp } from './core.js';

export const ATLAS_W = 1024, ATLAS_H = 512;
// regions in pixels [x, y, w, h] (y down)
export const REG = {
  white: [4, 4, 56, 56],
  badge0: [72, 8, 150, 236], badge1: [232, 8, 150, 236], badge2: [392, 8, 150, 236],
  hazard: [0, 256, 512, 56],
  tape: [0, 320, 512, 64],
  label: [0, 392, 384, 112],
  thread: [560, 8, 48, 240],
  metal: [624, 8, 240, 240],
  hose: [880, 8, 64, 240],
  zip: [960, 8, 56, 240],
  fabric: [392, 320, 240, 184],
  ribbed: [648, 264, 240, 240],
};
// uv rect (u0, v0, u1, v1) with v up (canvas textures are flipped on upload)
export function uvRect(name, inset = 1) {
  const [x, y, w, h] = REG[name];
  return [(x + inset) / ATLAS_W, 1 - (y + h - inset) / ATLAS_H, (x + w - inset) / ATLAS_W, 1 - (y + inset) / ATLAS_H];
}

let _tex = null;
export function atlasTextures() {
  if (_tex) return _tex;
  if (typeof document === 'undefined') {
    const w = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); w.needsUpdate = true; w.colorSpace = THREE.SRGBColorSpace;
    const n = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1); n.needsUpdate = true;
    return (_tex = { map: w, normalMap: n });
  }
  const mk = () => { const c = document.createElement('canvas'); c.width = ATLAS_W; c.height = ATLAS_H; return c; };
  const cc = mk(), hc = mk();
  const C = cc.getContext('2d'), Hh = hc.getContext('2d', { willReadFrequently: true });
  C.fillStyle = '#ffffff'; C.fillRect(0, 0, ATLAS_W, ATLAS_H);
  Hh.fillStyle = '#808080'; Hh.fillRect(0, 0, ATLAS_W, ATLAS_H);
  const r = new RNG(911);
  const font = (px, w = 'bold') => `${w} ${px}px 'IBM Plex Mono', 'Courier New', monospace`;

  // ---------------- badges
  const badge = (name, i) => {
    const [x, y, w, h] = REG[name];
    C.save(); C.translate(x, y);
    C.fillStyle = '#efeadb'; C.fillRect(0, 0, w, h);
    // header band
    C.fillStyle = '#f2c418'; C.fillRect(0, 0, w, 46);
    C.fillStyle = '#141414';
    for (let k = -40; k < w; k += 18) { C.beginPath(); C.moveTo(k, 46); C.lineTo(k + 9, 46); C.lineTo(k + 15, 40); C.lineTo(k + 6, 40); C.closePath(); C.fill(); }
    C.font = font(26); C.textAlign = 'center'; C.textBaseline = 'middle'; C.fillText('R.O.O.M.', w / 2, 20);
    C.font = font(8, 'normal'); C.fillText('REALITY OPERATIONS & ORDERLY MAINTENANCE', w / 2, 36);
    // photo of the employee: the cute doll it used to be
    C.fillStyle = '#cfc8b4'; C.fillRect(12, 56, 62, 78);
    C.fillStyle = '#c9a977'; C.beginPath(); C.roundRect(22, 62, 42, 62, 18); C.fill();
    C.fillStyle = '#f2c418'; C.fillRect(14, 116, 58, 18);
    C.fillStyle = '#0b0b0b'; C.beginPath(); C.arc(35, 84, 3.2, 0, TAU); C.arc(51, 84, 3.2, 0, TAU); C.fill();
    C.fillStyle = '#d2302b'; C.beginPath(); C.arc(43, 95, 6.5, 0, TAU); C.fill();
    C.strokeStyle = '#2e1c12'; C.lineWidth = 1.2; C.beginPath(); C.arc(43, 101, 4, 0.3, Math.PI - 0.3); C.stroke();
    // text
    C.fillStyle = '#151515'; C.textAlign = 'left';
    C.font = font(10); C.fillText('EMPLOYEE', 82, 64);
    const num = ['0417', '1182', '0093'][i];
    C.font = font(22); C.fillText('#' + num, 80, 86);
    C.font = font(8, 'normal'); C.fillText('LEVEL 0 / MAINT.', 82, 104); C.fillText('CLEARANCE: D', 82, 116);
    C.fillText('ISSUED 03-11-' + (90 + i), 82, 128);
    // barcode
    for (let k = 0, bx = 14; bx < w - 14; k++) { const bw = 1 + ((k * 7 + i * 3) % 3); C.fillRect(bx, 146, bw, 30); bx += bw + 1 + (k % 2); }
    C.font = font(8, 'normal'); C.textAlign = 'center'; C.fillText('PROPERTY OF R.O.O.M. — IF FOUND DO NOT RETURN', w / 2, 190);
    C.fillText('THIS EMPLOYEE IS ACCOUNTED FOR', w / 2, 202);
    // lanyard slot
    C.fillStyle = '#9a958a'; C.fillRect(w / 2 - 14, 214, 28, 6);
    // defacement / stamps
    if (i === 1) {
      C.strokeStyle = 'rgba(15,12,10,0.92)'; C.lineWidth = 5; C.lineCap = 'round';
      for (let k = 0; k < 9; k++) { C.beginPath(); C.moveTo(14 + r.next() * 10, 60 + k * 8 + r.next() * 4); C.lineTo(66 + r.next() * 8, 64 + k * 8 + r.next() * 6); C.stroke(); }
    }
    if (i !== 0) {
      C.save(); C.translate(w / 2, 118); C.rotate(-0.42);
      C.strokeStyle = 'rgba(168,24,20,0.85)'; C.lineWidth = 3; C.strokeRect(-66, -17, 132, 34);
      C.fillStyle = 'rgba(168,24,20,0.85)'; C.font = font(i === 1 ? 19 : 17); C.textAlign = 'center';
      C.fillText(i === 1 ? 'REASSIGNED' : 'NON-COMPLIANT', 0, 1);
      C.restore();
    }
    // grime + rust-brown stains
    for (let k = 0; k < 7; k++) {
      const sx = r.next() * w, sy = r.next() * h, sr = 6 + r.next() * 22;
      const g = C.createRadialGradient(sx, sy, 0, sx, sy, sr);
      g.addColorStop(0, `rgba(${90 + r.next() * 30},${45 + r.next() * 20},${20},${0.35 + r.next() * 0.3})`); g.addColorStop(1, 'rgba(90,50,20,0)');
      C.fillStyle = g; C.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
    }
    C.restore();
    // height: plastic sleeve edge + cracks (grooves)
    Hh.save(); Hh.translate(x, y);
    Hh.fillStyle = '#9a9a9a'; Hh.fillRect(0, 0, w, h);
    Hh.fillStyle = '#b0b0b0'; Hh.fillRect(4, 4, w - 8, h - 8);
    Hh.fillStyle = '#404040'; Hh.fillRect(w / 2 - 14, 214, 28, 6);
    const cracks = 3 + i * 2;
    for (let k = 0; k < cracks; k++) {
      let cx = r.next() * w, cy = r.next() * h, a = r.next() * TAU;
      const segs = 6 + Math.floor(r.next() * 8);
      for (let s = 0; s < segs; s++) {
        const nx = cx + Math.cos(a) * (8 + r.next() * 14), ny = cy + Math.sin(a) * (8 + r.next() * 14);
        Hh.strokeStyle = '#303030'; Hh.lineWidth = 1.6; Hh.beginPath(); Hh.moveTo(cx, cy); Hh.lineTo(nx, ny); Hh.stroke();
        C.strokeStyle = 'rgba(250,250,245,0.75)'; C.lineWidth = 1.1; C.beginPath(); C.moveTo(x + cx, y + cy); C.lineTo(x + nx, y + ny); C.stroke();
        C.strokeStyle = 'rgba(30,25,20,0.45)'; C.lineWidth = 0.6; C.beginPath(); C.moveTo(x + cx + 0.8, y + cy + 0.8); C.lineTo(x + nx + 0.8, y + ny + 0.8); C.stroke();
        cx = nx; cy = ny; a += r.range(-0.9, 0.9);
      }
    }
    Hh.restore();
  };
  badge('badge0', 0); badge('badge1', 1); badge('badge2', 2);

  // ---------------- hazard band (tank)
  {
    const [x, y, w, h] = REG.hazard;
    C.fillStyle = '#f2c418'; C.fillRect(x, y, w, h);
    C.fillStyle = '#161616';
    for (let k = -h; k < w + h; k += 32) { C.beginPath(); C.moveTo(x + k, y); C.lineTo(x + k + 16, y); C.lineTo(x + k + 16 - h, y + h); C.lineTo(x + k - h, y + h); C.closePath(); C.fill(); }
    for (let k = 0; k < 40; k++) { C.fillStyle = `rgba(${200 + r.next() * 40},${200 + r.next() * 40},${190},${0.4 + r.next() * 0.4})`; C.fillRect(x + r.next() * w, y + r.next() * h, 2 + r.next() * 18, 1 + r.next() * 2); }
  }
  // ---------------- duct tape: silver-grey, scrim grid, creases, torn ends
  {
    const [x, y, w, h] = REG.tape;
    C.fillStyle = '#9a9a96'; C.fillRect(x, y, w, h);
    for (let k = 0; k < 900; k++) { const v = 130 + r.next() * 60; C.fillStyle = `rgba(${v},${v},${v - 4},0.25)`; C.fillRect(x + r.next() * w, y + r.next() * h, 1 + r.next() * 3, 1); }
    Hh.fillStyle = '#909090'; Hh.fillRect(x, y, w, h);
    Hh.strokeStyle = 'rgba(200,200,200,0.55)'; Hh.lineWidth = 1;
    for (let k = 0; k < w; k += 6) { Hh.beginPath(); Hh.moveTo(x + k, y); Hh.lineTo(x + k, y + h); Hh.stroke(); }
    for (let k = 0; k < h; k += 5) { Hh.beginPath(); Hh.moveTo(x, y + k); Hh.lineTo(x + w, y + k); Hh.stroke(); }
    for (let k = 0; k < 26; k++) {
      const cx = x + r.next() * w; const a = (r.next() - 0.5) * 0.9;
      Hh.strokeStyle = `rgba(${r.next() < 0.5 ? 40 : 220},${r.next() < 0.5 ? 40 : 220},${120},0.6)`; Hh.lineWidth = 1 + r.next() * 2;
      Hh.beginPath(); Hh.moveTo(cx, y); Hh.lineTo(cx + Math.tan(a) * h, y + h); Hh.stroke();
      C.strokeStyle = 'rgba(60,60,58,0.25)'; C.lineWidth = 1.5; C.beginPath(); C.moveTo(cx, y); C.lineTo(cx + Math.tan(a) * h, y + h); C.stroke();
    }
    for (let k = 0; k < 10; k++) { const sx = x + r.next() * w, sy = y + r.next() * h, sr = 5 + r.next() * 16; const g = C.createRadialGradient(sx, sy, 0, sx, sy, sr); g.addColorStop(0, 'rgba(60,45,30,0.45)'); g.addColorStop(1, 'rgba(60,45,30,0)'); C.fillStyle = g; C.fillRect(sx - sr, sy - sr, sr * 2, sr * 2); }
  }
  // ---------------- tank label
  {
    const [x, y, w, h] = REG.label;
    C.fillStyle = '#e8e2d0'; C.fillRect(x, y, w, h);
    C.fillStyle = '#f2c418'; C.fillRect(x, y, w, 26);
    C.fillStyle = '#141414'; C.font = font(18); C.textAlign = 'left'; C.textBaseline = 'middle';
    C.fillText('R.O.O.M. LIFE SUPPORT', x + 8, y + 13);
    C.font = font(40); C.fillText('AIR', x + 10, y + 56);
    C.font = font(10, 'normal'); C.fillText('COMPRESSED BREATHING AIR  UN1002', x + 104, y + 46);
    C.fillText('DO NOT REMOVE MASK IN ANY LEVEL', x + 104, y + 60);
    C.fillText('CAPACITY: 6.8 L / 300 BAR', x + 104, y + 74);
    C.fillStyle = '#b02420'; C.font = font(12); C.fillText('EXPIRED', x + 10, y + 96);
    for (let k = 0; k < 6; k++) { const sx = x + r.next() * w, sy = y + r.next() * h, sr = 6 + r.next() * 20; const g = C.createRadialGradient(sx, sy, 0, sx, sy, sr); g.addColorStop(0, 'rgba(80,50,25,0.5)'); g.addColorStop(1, 'rgba(80,50,25,0)'); C.fillStyle = g; C.fillRect(sx - sr, sy - sr, sr * 2, sr * 2); }
    // peeling corner
    Hh.fillStyle = '#9c9c9c'; Hh.fillRect(x, y, w, h);
    C.fillStyle = '#7b8288'; C.beginPath(); C.moveTo(x + w, y + h); C.lineTo(x + w - 46, y + h); C.lineTo(x + w, y + h - 34); C.closePath(); C.fill();
  }
  // ---------------- thread: twisted ply (u across, v along)
  {
    const [x, y, w, h] = REG.thread;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const ply = Math.sin((xx / w) * TAU * 1.5 + (yy / h) * TAU * 14);
      const v = Math.floor(128 + ply * 90);
      Hh.fillStyle = `rgb(${v},${v},${v})`; Hh.fillRect(x + xx, y + yy, 1, 1);
    }
    C.fillStyle = '#ffffff'; C.fillRect(x, y, w, h);
  }
  // ---------------- worn metal (tank, clips): scratches + dents
  {
    const [x, y, w, h] = REG.metal;
    C.fillStyle = '#ffffff'; C.fillRect(x, y, w, h);
    for (let k = 0; k < 260; k++) { const v = 150 + r.next() * 105; C.strokeStyle = `rgba(${v},${v},${v},0.35)`; C.lineWidth = 0.5 + r.next(); const sx = x + r.next() * w, sy = y + r.next() * h, a = r.next() * TAU, l = 4 + r.next() * 30; C.beginPath(); C.moveTo(sx, sy); C.lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l); C.stroke(); }
    for (let k = 0; k < 18; k++) { const sx = x + r.next() * w, sy = y + r.next() * h, sr = 8 + r.next() * 30; const g = C.createRadialGradient(sx, sy, 0, sx, sy, sr); g.addColorStop(0, `rgba(${110 + r.next() * 30},${60},${25},${0.3 + r.next() * 0.4})`); g.addColorStop(1, 'rgba(110,60,25,0)'); C.fillStyle = g; C.fillRect(sx - sr, sy - sr, sr * 2, sr * 2); }
    for (let k = 0; k < 14; k++) { const sx = x + r.next() * w, sy = y + r.next() * h, sr = 6 + r.next() * 18; const g = Hh.createRadialGradient(sx, sy, 0, sx, sy, sr); g.addColorStop(0, 'rgba(40,40,40,0.8)'); g.addColorStop(1, 'rgba(128,128,128,0)'); Hh.fillStyle = g; Hh.fillRect(sx - sr, sy - sr, sr * 2, sr * 2); }
    for (let k = 0; k < 120; k++) { Hh.strokeStyle = 'rgba(70,70,70,0.6)'; Hh.lineWidth = 0.7; const sx = x + r.next() * w, sy = y + r.next() * h, a = r.next() * TAU, l = 3 + r.next() * 20; Hh.beginPath(); Hh.moveTo(sx, sy); Hh.lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l); Hh.stroke(); }
  }
  // ---------------- corrugated hose
  {
    const [x, y, w, h] = REG.hose;
    for (let yy = 0; yy < h; yy++) { const s = Math.sin((yy / h) * TAU * 20); const v = Math.floor(128 + s * 110); Hh.fillStyle = `rgb(${v},${v},${v})`; Hh.fillRect(x, y + yy, w, 1); const cv = Math.floor(200 + s * 40); C.fillStyle = `rgb(${cv},${cv},${cv})`; C.fillRect(x, y + yy, w, 1); }
  }
  // ---------------- zipper teeth strip
  {
    const [x, y, w, h] = REG.zip;
    C.fillStyle = '#2a2826'; C.fillRect(x, y, w, h);
    Hh.fillStyle = '#707070'; Hh.fillRect(x, y, w, h);
    for (let yy = 0; yy < h; yy += 8) {
      for (const side of [0, 1]) {
        const off = side ? 4 : 0;
        C.fillStyle = '#8f8a80'; C.fillRect(x + w / 2 - 9 + side * 9, y + yy + off, 9, 4);
        Hh.fillStyle = '#d8d8d8'; Hh.fillRect(x + w / 2 - 9 + side * 9, y + yy + off, 9, 4);
      }
    }
  }
  // ---------------- hazmat fabric patch (for loose flaps)
  {
    const [x, y, w, h] = REG.fabric;
    C.fillStyle = '#ffffff'; C.fillRect(x, y, w, h);
    for (let k = 0; k < 40; k++) { const cx = x + r.next() * w; Hh.strokeStyle = `rgba(${r.next() < 0.5 ? 60 : 200},${r.next() < 0.5 ? 60 : 200},128,0.5)`; Hh.lineWidth = 1 + r.next() * 3; Hh.beginPath(); Hh.moveTo(cx, y); Hh.bezierCurveTo(cx + r.range(-30, 30), y + h * 0.3, cx + r.range(-30, 30), y + h * 0.7, cx + r.range(-20, 20), y + h); Hh.stroke(); }
  }
  // ---------------- ribbed rubber (boot soles, glove cuffs)
  {
    const [x, y, w, h] = REG.ribbed;
    C.fillStyle = '#ffffff'; C.fillRect(x, y, w, h);
    for (let yy = 0; yy < h; yy++) { const s = Math.sin((yy / h) * TAU * 16); const v = Math.floor(128 + s * 100); Hh.fillStyle = `rgb(${v},${v},${v})`; Hh.fillRect(x, y + yy, w, 1); }
  }

  // ---- normal map from height
  const hd = Hh.getImageData(0, 0, ATLAS_W, ATLAS_H).data;
  const nc = mk(), nx = nc.getContext('2d');
  const ni = nx.createImageData(ATLAS_W, ATLAS_H), nd = ni.data;
  const S = 2.2 / 255;
  for (let yy = 0; yy < ATLAS_H; yy++) for (let xx = 0; xx < ATLAS_W; xx++) {
    const xl = Math.max(0, xx - 1), xr = Math.min(ATLAS_W - 1, xx + 1), yu = Math.max(0, yy - 1), ydn = Math.min(ATLAS_H - 1, yy + 1);
    const dx = (hd[(yy * ATLAS_W + xr) * 4] - hd[(yy * ATLAS_W + xl) * 4]) * S, dy = (hd[(ydn * ATLAS_W + xx) * 4] - hd[(yu * ATLAS_W + xx) * 4]) * S;
    const l = Math.hypot(dx, dy, 1), i = (yy * ATLAS_W + xx) * 4;
    nd[i] = clamp((-dx / l * 0.5 + 0.5) * 255, 0, 255); nd[i + 1] = clamp((dy / l * 0.5 + 0.5) * 255, 0, 255); nd[i + 2] = clamp((1 / l * 0.5 + 0.5) * 255, 0, 255); nd[i + 3] = 255;
  }
  nx.putImageData(ni, 0, 0);
  const map = new THREE.CanvasTexture(cc); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  const normalMap = new THREE.CanvasTexture(nc); normalMap.colorSpace = THREE.NoColorSpace; normalMap.anisotropy = 8;
  _tex = { map, normalMap };
  return _tex;
}
