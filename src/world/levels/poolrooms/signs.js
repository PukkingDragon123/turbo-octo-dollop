// Poolrooms signage: a canvas-generated atlas of enamel/tile signs (pool rules, pictograms,
// depth markers) drawn as baked decals on walls and on the pool coping.
import * as THREE from 'three';

const COLS = 4, ROWS = 4, CW = 512, CH = 256;
export const SIGN = {
  NO_DIVING: 0, DEPTH_SHALLOW: 1, DEPTH_DEEP: 2, DEEP_END: 3, SHALLOW_END: 4, NO_RUNNING: 5, LIFEGUARD: 6, SHOWER: 7,
  DEPTH_WADE: 8, DEPTH_LAP: 9, DEPTH_STAIRS: 10, DEPTH_DROWN: 11, CLOSED: 12, EXIT: 13, ROOM: 14, ALONE: 15,
};
export const DEPTH_TEXT = { [SIGN.DEPTH_SHALLOW]: '1.1 m', [SIGN.DEPTH_DEEP]: '1.9 m', [SIGN.DEPTH_WADE]: '0.5 m', [SIGN.DEPTH_LAP]: '1.4 m', [SIGN.DEPTH_STAIRS]: '2.2 m', [SIGN.DEPTH_DROWN]: '1.6 m' };

let tex = null;
let mat = null;

function drawSign(ctx, k, x, y, w, h) {
  const navy = '#16305e', red = '#c3241c', white = '#f4f3ee';
  ctx.save();
  ctx.translate(x, y);
  const plate = (bg, border) => {
    ctx.fillStyle = bg;
    ctx.fillRect(6, 6, w - 12, h - 12);
    if (border) { ctx.strokeStyle = border; ctx.lineWidth = 10; ctx.strokeRect(14, 14, w - 28, h - 28); }
  };
  const text = (t, size, col, yy, weight = 'bold') => {
    ctx.fillStyle = col;
    ctx.font = `${weight} ${size}px "Jolly Lodger", Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let s = size;
    while (ctx.measureText(t).width > w - 50 && s > 12) { s -= 2; ctx.font = `${weight} ${s}px "Jolly Lodger", Georgia, serif`; }
    ctx.fillText(t, w / 2, yy);
  };
  const noSymbol = (cx, cy, r) => {
    ctx.strokeStyle = red; ctx.lineWidth = r * 0.16;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - r * 0.7, cy - r * 0.7); ctx.lineTo(cx + r * 0.7, cy + r * 0.7); ctx.stroke();
  };
  switch (k) {
    case SIGN.NO_DIVING: {
      plate(white, null);
      // diver pictogram
      ctx.fillStyle = navy;
      ctx.save(); ctx.translate(110, 120); ctx.rotate(-0.7);
      ctx.beginPath(); ctx.arc(0, -46, 13, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(-7, -32, 14, 58);
      ctx.fillRect(-26, -60, 10, 40); ctx.fillRect(16, -60, 10, 40);
      ctx.restore();
      ctx.fillRect(40, 170, 150, 10);
      noSymbol(112, 120, 78);
      text('NO DIVING', 46, navy, 100);
      ctx.save(); ctx.translate(176, 0); text('SHALLOW WATER', 26, navy, 160, 'normal'); ctx.restore();
      break;
    }
    case SIGN.NO_RUNNING: {
      plate(white, null);
      ctx.fillStyle = navy;
      ctx.beginPath(); ctx.arc(112, 70, 14, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.translate(112, 120); ctx.rotate(0.35); ctx.fillRect(-7, -35, 14, 60); ctx.restore();
      ctx.save(); ctx.translate(96, 165); ctx.rotate(0.7); ctx.fillRect(-6, -28, 12, 56); ctx.restore();
      ctx.save(); ctx.translate(130, 165); ctx.rotate(-0.6); ctx.fillRect(-6, -28, 12, 56); ctx.restore();
      noSymbol(112, 125, 82);
      ctx.save(); ctx.translate(176, 0); text('NO RUNNING', 44, navy, 105); text('WET FLOORS', 26, navy, 160, 'normal'); ctx.restore();
      break;
    }
    case SIGN.DEEP_END: plate(navy, white); text('DEEP END', 76, white, h / 2); break;
    case SIGN.SHALLOW_END: plate(navy, white); text('SHALLOW END', 62, white, h / 2); break;
    case SIGN.LIFEGUARD: plate(red, white); text('LIFEGUARD', 58, white, h / 2 - 34); text('ON DUTY', 50, white, h / 2 + 38); break;
    case SIGN.SHOWER: plate(white, navy); text('PLEASE SHOWER', 46, navy, h / 2 - 34); text('BEFORE ENTERING THE POOL', 28, navy, h / 2 + 30, 'normal'); break;
    case SIGN.CLOSED: plate('#e8c21e', '#111111'); text('POOL CLOSED', 60, '#111111', h / 2 - 26); text('UNTIL FURTHER NOTICE', 26, '#111111', h / 2 + 40, 'normal'); break;
    case SIGN.EXIT: {
      plate('#1f7a3a', null);
      text('EXIT', 92, white, h / 2);
      ctx.fillStyle = white;
      ctx.beginPath(); ctx.moveTo(w - 60, h / 2); ctx.lineTo(w - 110, h / 2 - 40); ctx.lineTo(w - 110, h / 2 + 40); ctx.closePath(); ctx.fill();
      break;
    }
    case SIGN.ROOM: plate(white, navy); text('POOL 37', 88, navy, h / 2); break;
    case SIGN.ALONE: plate(white, red); text('DO NOT SWIM', 52, red, h / 2 - 30); text('ALONE', 52, red, h / 2 + 36); break;
    default: {
      // depth markers: navy numbers on a white glazed tile
      const t = DEPTH_TEXT[k];
      if (t) { plate(white, null); text(t, 118, navy, h / 2 + 4); }
      else plate(white, null);
    }
  }
  // enamel wear
  ctx.globalAlpha = 0.07;
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? '#000' : '#776';
    const rx = Math.random() * w, ry = Math.random() * h;
    ctx.beginPath(); ctx.arc(rx, ry, Math.random() * 7, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

export function signTexture() {
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = CW * COLS; c.height = CH * ROWS;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f3ee';
  ctx.fillRect(0, 0, c.width, c.height);
  for (let k = 0; k < COLS * ROWS; k++) drawSign(ctx, k, (k % COLS) * CW, Math.floor(k / COLS) * CH, CW, CH);
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

export function signBaseMaterial() {
  if (mat) return mat;
  mat = new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.28, metalness: 0, name: 'pool_signs' });
  return mat;
}

// uv rectangle of a sign slot (with a small inset against bleeding)
export function signUV(k) {
  const cx = k % COLS, cy = Math.floor(k / COLS);
  const u0 = (cx * CW + 4) / (CW * COLS), u1 = ((cx + 1) * CW - 4) / (CW * COLS);
  // canvas y is down; texture v is up (flipY)
  const v1 = 1 - (cy * CH + 4) / (CH * ROWS), v0 = 1 - ((cy + 1) * CH - 4) / (CH * ROWS);
  return [u0, v0, u1, v1];
}

// emit a sign quad: centre c, right vector r (half width), up vector u (half height), normal n
export function signQuad(M, k, c, r, u, n) {
  const [u0, v0, u1, v1] = signUV(k);
  const P = (sr, su) => [c[0] + r[0] * sr + u[0] * su, c[1] + r[1] * sr + u[1] * su, c[2] + r[2] * sr + u[2] * su];
  M.quad([P(-1, -1), P(1, -1), P(1, 1), P(-1, 1)], n, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
}
